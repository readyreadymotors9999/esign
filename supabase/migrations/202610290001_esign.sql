-- Only explicitly enrolled administrators can access customer records.
create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;
create policy "read own membership" on public.admins for select to authenticated using (user_id = auth.uid());

create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create table public.documents (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 title text not null check (length(title) between 1 and 200),
 status text not null default 'uploading' check (status in ('uploading','draft','sent','completed')),
 original_path text not null unique,
 signed_path text,
 fields jsonb not null default '[]'::jsonb,
 created_at timestamptz not null default now()
);
create table public.signing_sessions (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.documents(id),
 recipient_email text not null,
 token_hash text not null unique,
 status text not null default 'pending' check (status in ('pending','processing','completed','revoked')),
 expires_at timestamptz not null,
 completed_at timestamptz,
 created_at timestamptz not null default now()
);
create unique index one_live_session on public.signing_sessions(document_id) where status in ('pending','processing');
create table public.audit_records (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.documents(id),
 session_id uuid references public.signing_sessions(id),
 event text not null,
 actor text not null,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
-- All mutations go through the Edge Function's authenticated service role.
alter table public.documents enable row level security;
alter table public.signing_sessions enable row level security;
alter table public.audit_records enable row level security;
create policy "owner admin reads documents" on public.documents for select to authenticated using (public.is_admin() and owner_id = auth.uid());
create policy "owner admin reads sessions" on public.signing_sessions for select to authenticated using (public.is_admin() and exists(select 1 from public.documents d where d.id = document_id and d.owner_id = auth.uid()));
create policy "owner admin reads audit" on public.audit_records for select to authenticated using (public.is_admin() and exists(select 1 from public.documents d where d.id = document_id and d.owner_id = auth.uid()));
-- Explicit grants avoid relying on the project's default privileges.
revoke all on public.admins, public.documents, public.signing_sessions, public.audit_records from anon, authenticated;
grant select on public.admins, public.documents, public.signing_sessions, public.audit_records to authenticated;
grant all on public.admins, public.documents, public.signing_sessions, public.audit_records to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values ('documents','documents',false,10485760,array['application/pdf']);
-- Upload only to the server-reserved path, once, while the document is uploading.
create policy "admin uploads reserved original" on storage.objects for insert to authenticated with check (
 bucket_id = 'documents' and public.is_admin() and exists(
 select 1 from public.documents d where d.original_path = name and d.owner_id = auth.uid() and d.status = 'uploading'
 ));
-- No public read, update, delete, or direct signed-PDF upload policies.

-- Advisory transaction locks serialize issuing/revoking/completing per document.
create function public.issue_signing_session(p_document uuid, p_owner uuid, p_email text, p_hash text, p_fields jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_document::text, 0));
 if not exists(select 1 from public.documents where id=p_document and owner_id=p_owner and status='draft') then
  raise exception 'Document is not a draft';
 end if;
 insert into public.signing_sessions(document_id,recipient_email,token_hash,expires_at)
 values(p_document,p_email,p_hash,now()+interval '72 hours') returning id into sid;
 update public.documents set fields=p_fields,status='sent' where id=p_document;
 insert into public.audit_records(document_id,session_id,event,actor) values(p_document,sid,'invitation_created',p_email);
 return sid;
end; $$;
create function public.revoke_signing_session(p_document uuid, p_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_document::text, 0));
 if not exists(select 1 from public.documents where id=p_document and owner_id=p_owner and status='sent') then raise exception 'Document cannot be revoked'; end if;
 if exists(select 1 from public.signing_sessions where document_id=p_document and status='processing') then raise exception 'Signing is in progress'; end if;
 update public.signing_sessions set status='revoked' where document_id=p_document and status='pending';
 update public.documents set status='draft' where id=p_document;
 insert into public.audit_records(document_id,event,actor) values(p_document,'invitation_revoked',p_owner::text);
end; $$;
create function public.claim_signing_session(p_hash text)
returns public.signing_sessions language plpgsql security definer set search_path = '' as $$
declare s public.signing_sessions;
begin
 select * into s from public.signing_sessions where token_hash=p_hash;
 if not found then raise exception 'Signing link is unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(s.document_id::text, 0));
 update public.signing_sessions set status='processing' where id=s.id and status='pending' and expires_at>now() returning * into s;
 if not found then raise exception 'Signing link is expired, used, or already in progress'; end if;
 return s;
end; $$;
create function public.finish_signing_session(p_session uuid, p_path text, p_metadata jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.signing_sessions;
begin
 select * into s from public.signing_sessions where id=p_session;
 perform pg_advisory_xact_lock(hashtextextended(s.document_id::text,0));
 select * into s from public.signing_sessions where id=p_session;
 if not found then raise exception 'Signing session not found'; end if;
 if s.status <> 'processing' then raise exception 'Signing session cannot complete'; end if;
 update public.signing_sessions set status='completed',completed_at=now() where id=s.id;
 update public.documents set status='completed',signed_path=p_path where id=s.document_id;
 insert into public.audit_records(document_id,session_id,event,actor,metadata) values(s.document_id,s.id,'document_signed',s.recipient_email,p_metadata);
end; $$;
revoke all on function public.issue_signing_session(uuid,uuid,text,text,jsonb), public.revoke_signing_session(uuid,uuid), public.claim_signing_session(text), public.finish_signing_session(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.issue_signing_session(uuid,uuid,text,text,jsonb), public.revoke_signing_session(uuid,uuid), public.claim_signing_session(text), public.finish_signing_session(uuid,text,jsonb) to service_role;
