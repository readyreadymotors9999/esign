alter table public.documents add column viewed_at timestamptz;
alter table public.documents add column draft_revision integer not null default 0;
alter table public.signing_sessions add column viewed_at timestamptz;
create table public.email_notifications (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.documents(id),
 session_id uuid not null references public.signing_sessions(id),
 kind text not null check(kind in ('viewed','completed')),
 recipient text not null,
 subject text not null,
 message text not null,
 status text not null default 'pending' check(status in ('pending','sending','sent')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 sent_at timestamptz,
 provider_id text,
 unique(session_id,kind,recipient)
);
alter table public.email_notifications enable row level security;
revoke all on public.email_notifications from public,anon,authenticated;
grant all on public.email_notifications to service_role;

-- Completion and notification enqueue commit together; email failure cannot undo signing.
create function public.queue_completion_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare d public.documents; address text; heading text;
begin
 if new.status='completed' and old.status is distinct from 'completed' then
  select * into d from public.documents where id=new.document_id;
  heading := '"' || d.title || '" document has been completed by all participants';
  for address in select distinct lower(x) from unnest(array['readyreadymotors9999@gmail.com',new.recipient_email]) x loop
   insert into public.email_notifications(document_id,session_id,kind,recipient,subject,message)
   values(d.id,new.id,'completed',address,heading,heading || E'.\n\nAll participants have signed.\n\nReady Ready Motors, Inc.')
   on conflict do nothing;
  end loop;
 end if;
 return new;
end; $$;
create trigger queue_completion_notifications after update of status on public.signing_sessions for each row execute function public.queue_completion_notifications();

create function public.mark_document_viewed(p_session uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.signing_sessions; d public.documents; heading text;
begin
 select * into s from public.signing_sessions where id=p_session;
 if not found then raise exception 'Session unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(s.document_id::text,0));
 select * into s from public.signing_sessions where id=p_session for update;
 if s.status <> 'pending' or s.expires_at <= now() then raise exception 'Session unavailable'; end if;
 if s.viewed_at is not null then return; end if;
 select * into d from public.documents where id=s.document_id;
 update public.signing_sessions set viewed_at=now() where id=s.id;
 update public.documents set viewed_at=now() where id=d.id and status='sent';
 insert into public.audit_records(document_id,session_id,event,actor) values(d.id,s.id,'document_viewed',s.recipient_email);
 if lower(s.recipient_email) <> 'readyreadymotors9999@gmail.com' then
  heading := coalesce(nullif(trim(d.recipient_name),''),s.recipient_email) || ' has viewed the document "' || d.title || '"';
  insert into public.email_notifications(document_id,session_id,kind,recipient,subject,message)
  values(d.id,s.id,'viewed','readyreadymotors9999@gmail.com',heading,heading || E'.\n\nReady Ready Motors, Inc.') on conflict do nothing;
 end if;
end; $$;

create function public.claim_email_notifications(p_document uuid default null) returns setof public.email_notifications language sql security definer set search_path='' as $$
 update public.email_notifications set status='sending',attempts=attempts+1,available_at=now()+interval '5 minutes'
 where id in (select id from public.email_notifications where status<>'sent' and available_at<=now() and (p_document is null or document_id=p_document) order by available_at limit 10 for update skip locked)
 returning *;
$$;
create function public.reset_document_view() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='draft' and old.status<>'draft' then new.viewed_at:=null; end if;
 return new;
end; $$;
create trigger reset_document_view before update of status on public.documents for each row execute function public.reset_document_view();
revoke all on function public.queue_completion_notifications(),public.mark_document_viewed(uuid),public.claim_email_notifications(uuid),public.reset_document_view() from public,anon,authenticated;
grant execute on function public.mark_document_viewed(uuid),public.claim_email_notifications(uuid) to service_role;
