alter table public.documents add column signers jsonb not null default '[]';
alter table public.documents add column active_batch uuid;
alter table public.documents add column working_path text;
alter table public.documents add column signed_signer_ids text[] not null default '{}';
alter table public.signing_sessions add column signer_id text not null default 'recipient';
alter table public.signing_sessions add column signer_name text;
alter table public.signing_sessions add column batch_id uuid;
update public.signing_sessions s set signer_name=d.recipient_name from public.documents d where d.id=s.document_id;
update public.documents d set signers=jsonb_build_array(jsonb_build_object('id','recipient','email',s.recipient_email,'name',coalesce(nullif(d.recipient_name,''),s.recipient_email)))
from public.signing_sessions s where s.document_id=d.id and s.status in ('pending','processing');
drop index public.one_live_session;
create unique index one_live_signer_session on public.signing_sessions(document_id,signer_id) where status in ('pending','processing');

create function public.issue_document_sessions(p_document uuid,p_owner uuid,p_revision integer,p_source text,p_path text,p_fields jsonb,p_signers jsonb,p_sessions jsonb,p_metadata jsonb,p_delivery text)
returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; batch uuid:=gen_random_uuid();
begin
 perform pg_advisory_xact_lock(hashtextextended(p_document::text,0));
 if not exists(select 1 from public.documents where id=p_document and owner_id=p_owner and status='draft' and original_path=p_source and draft_revision=p_revision and signers=p_signers) then raise exception 'Draft changed before sending'; end if;
 if jsonb_array_length(p_sessions)<>jsonb_array_length(p_signers) or jsonb_array_length(p_sessions)<1 then raise exception 'Invalid signer list'; end if;
 update public.documents set fields=p_fields,status='sent',prepared_path=p_path,working_path=null,signed_path=null,signed_signer_ids='{}',active_batch=batch,company_signed_at=(p_metadata->>'signed_at')::timestamptz,viewed_at=null where id=p_document;
 for item in select * from jsonb_array_elements(p_sessions) loop
  insert into public.signing_sessions(id,document_id,signer_id,signer_name,recipient_email,token_hash,expires_at,delivery,batch_id)
  values((item->>'id')::uuid,p_document,item->>'signer_id',item->>'name',item->>'email',item->>'hash',now()+interval '72 hours',p_delivery,batch);
  insert into public.audit_records(document_id,session_id,event,actor) values(p_document,(item->>'id')::uuid,'invitation_created',item->>'email');
 end loop;
 insert into public.audit_records(document_id,event,actor,metadata) values(p_document,'company_signed','readyreadymotors9999@gmail.com',p_metadata);
end; $$;
create or replace function public.claim_signing_session(p_hash text) returns public.signing_sessions language plpgsql security definer set search_path='' as $$
declare s public.signing_sessions; d public.documents;
begin
 select * into s from public.signing_sessions where token_hash=p_hash;
 if not found then raise exception 'Signing link unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(s.document_id::text,0));
 select * into d from public.documents where id=s.document_id;
 if d.status<>'sent' or s.batch_id is distinct from d.active_batch then raise exception 'Signing link unavailable'; end if;
 if exists(select 1 from public.signing_sessions where document_id=s.document_id and status='processing') then raise exception 'Another participant is signing. Please try again shortly'; end if;
 update public.signing_sessions set status='processing' where id=s.id and status='pending' and expires_at>now() returning * into s;
 if not found then raise exception 'Signing link expired or already used'; end if;
 return s;
end; $$;
create or replace function public.finish_signing_session(p_session uuid,p_path text,p_metadata jsonb) returns void language plpgsql security definer set search_path='' as $$
declare s public.signing_sessions; d public.documents; done boolean;
begin
 select * into s from public.signing_sessions where id=p_session;
 if not found then raise exception 'Session unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(s.document_id::text,0));
 select * into s from public.signing_sessions where id=p_session for update;
 select * into d from public.documents where id=s.document_id;
 if s.status<>'processing' or d.status<>'sent' or s.batch_id is distinct from d.active_batch then raise exception 'Signing session cannot complete'; end if;
 update public.signing_sessions set status='completed',completed_at=now() where id=s.id;
 done:=not exists(select 1 from public.signing_sessions where document_id=d.id and batch_id is not distinct from d.active_batch and status in ('pending','processing'));
 update public.documents set working_path=p_path,signed_path=case when done then p_path else null end,status=case when done then 'completed' else 'sent' end,signed_signer_ids=array_append(signed_signer_ids,s.signer_id) where id=d.id;
 insert into public.audit_records(document_id,session_id,event,actor,metadata) values(d.id,s.id,'document_signed',s.recipient_email,p_metadata);
end; $$;
drop trigger queue_completion_notifications on public.signing_sessions;
create or replace function public.queue_completion_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare address text; last_session uuid; heading text;
begin
 if new.status='completed' and old.status is distinct from 'completed' then
  select id into last_session from public.signing_sessions where document_id=new.id and batch_id is not distinct from new.active_batch and status='completed' order by completed_at desc,id limit 1;
  heading:='"'||new.title||'" document has been completed by all participants';
  for address in select distinct lower(x) from (select 'readyreadymotors9999@gmail.com' x union all select recipient_email from public.signing_sessions where document_id=new.id and batch_id is not distinct from new.active_batch and status='completed') emails loop
   insert into public.email_notifications(document_id,session_id,kind,recipient,subject,message) values(new.id,last_session,'completed',address,heading,heading||E'.\n\nThe completed PDF is attached.\n\nReady Ready Motors, Inc.') on conflict do nothing;
  end loop;
 end if;
 return new;
end; $$;
create trigger queue_completion_notifications after update of status on public.documents for each row execute function public.queue_completion_notifications();
-- View notices use the invited participant's name, never another signer's name.
create or replace function public.mark_document_viewed(p_session uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.signing_sessions; d public.documents; heading text;
begin
 select * into s from public.signing_sessions where id=p_session;
 if not found then raise exception 'Session unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(s.document_id::text,0));
 select * into s from public.signing_sessions where id=p_session for update;
 select * into d from public.documents where id=s.document_id;
 if s.status<>'pending' or s.expires_at<=now() or s.batch_id is distinct from d.active_batch then raise exception 'Session unavailable'; end if;
 if s.viewed_at is not null then return; end if;
 update public.signing_sessions set viewed_at=now() where id=s.id;
 update public.documents set viewed_at=coalesce(viewed_at,now()) where id=d.id and status='sent';
 insert into public.audit_records(document_id,session_id,event,actor) values(d.id,s.id,'document_viewed',s.recipient_email);
 if lower(s.recipient_email)<>'readyreadymotors9999@gmail.com' then
  heading:=coalesce(nullif(trim(s.signer_name),''),nullif(trim(d.recipient_name),''),s.recipient_email)||' has viewed the document "'||d.title||'"';
  insert into public.email_notifications(document_id,session_id,kind,recipient,subject,message) values(d.id,s.id,'viewed','readyreadymotors9999@gmail.com',heading,heading||E'.\n\nReady Ready Motors, Inc.') on conflict do nothing;
 end if;
end; $$;
create or replace function public.reset_document_view() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='draft' and old.status<>'draft' then new.viewed_at:=null; new.working_path:=null; new.signed_signer_ids:='{}'; end if;
 return new;
end; $$;
-- Include the roster in revision conflicts and draft undo/discard.
create or replace function public.advance_draft_revision() returns trigger language plpgsql set search_path='' as $$
begin
 if new.fields is distinct from old.fields or new.original_path is distinct from old.original_path or new.title is distinct from old.title or new.signers is distinct from old.signers then new.draft_revision:=old.draft_revision+1; end if;
 return new;
end; $$;
create function public.restore_document_draft(p_document uuid,p_owner uuid,p_expected_path text,p_revision integer,p_path text,p_fields jsonb,p_title text,p_signers jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.restore_draft(p_document,p_owner,p_expected_path,p_revision,p_path,p_fields,p_title);
 update public.documents set signers=p_signers where id=p_document;
end; $$;
revoke all on function public.issue_document_sessions(uuid,uuid,integer,text,text,jsonb,jsonb,jsonb,jsonb,text),public.restore_document_draft(uuid,uuid,text,integer,text,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.issue_document_sessions(uuid,uuid,integer,text,text,jsonb,jsonb,jsonb,jsonb,text),public.restore_document_draft(uuid,uuid,text,integer,text,jsonb,text,jsonb) to service_role;
create or replace function public.cancel_failed_invitation(p_document uuid,p_owner uuid,p_session uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_document::text,0));
 if exists(select 1 from public.documents d join public.signing_sessions s on s.document_id=d.id where d.id=p_document and d.owner_id=p_owner and d.status='sent' and s.id=p_session and s.batch_id is not distinct from d.active_batch) then
  perform public.revoke_signing_session(p_document,p_owner);
 end if;
end; $$;
