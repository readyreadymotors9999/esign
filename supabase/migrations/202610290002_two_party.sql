alter table public.documents add column prepared_path text;
alter table public.documents add column recipient_name text;
alter table public.documents add column company_signed_at timestamptz;
alter table public.signing_sessions add column delivery text not null default 'email' check (delivery in ('email','share'));
create table public.recipients (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 email text not null,
 first_name text not null default '',
 last_name text not null default '',
 created_at timestamptz not null default now(),
 unique(owner_id,email)
);
alter table public.recipients enable row level security;
create policy "owner admin reads recipients" on public.recipients for select to authenticated using (public.is_admin() and owner_id=auth.uid());
revoke all on public.recipients from anon,authenticated;
grant select on public.recipients to authenticated;
grant all on public.recipients to service_role;

-- Preserve the original; commit the prepared PDF, company consent and invitation
-- together under the same document lock used by claim/revoke/finalize.
create function public.issue_prepared_session(p_document uuid,p_owner uuid,p_email text,p_hash text,p_fields jsonb,p_path text,p_metadata jsonb,p_delivery text,p_recipient_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 if p_delivery not in ('email','share') then raise exception 'Invalid delivery'; end if;
 sid:=public.issue_signing_session(p_document,p_owner,p_email,p_hash,p_fields);
 update public.documents set prepared_path=p_path,company_signed_at=(p_metadata->>'signed_at')::timestamptz,recipient_name=p_recipient_name where id=p_document;
 update public.signing_sessions set delivery=p_delivery where id=sid;
 insert into public.audit_records(document_id,session_id,event,actor,metadata)
 values(p_document,sid,'company_signed','readyreadymotors9999@gmail.com',p_metadata);
 if p_delivery='share' then
  insert into public.audit_records(document_id,session_id,event,actor) values(p_document,sid,'share_link_created',p_owner::text);
 end if;
 return sid;
end; $$;
revoke all on function public.issue_prepared_session(uuid,uuid,text,text,jsonb,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.issue_prepared_session(uuid,uuid,text,text,jsonb,text,jsonb,text,text) to service_role;
