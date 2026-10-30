-- Reopening and completion share the same lock: whichever commits first wins.
-- Preserve immutable PDF revisions and audit history, but remove all active signatures.
create or replace function public.revoke_signing_session(p_document uuid, p_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_document::text, 0));
 if not exists(select 1 from public.documents where id=p_document and owner_id=p_owner and status='sent') then
  raise exception 'Only an unfinished invitation can be reopened';
 end if;
 update public.signing_sessions set status='revoked' where document_id=p_document and status in ('pending','processing');
 update public.documents set status='draft',prepared_path=null,company_signed_at=null,signed_path=null where id=p_document;
 insert into public.audit_records(document_id,event,actor,metadata)
 values(p_document,'invitation_revoked',p_owner::text,'{"reason":"reopened_for_editing","all_signatures_and_dates_cleared":true}'::jsonb);
end; $$;

-- A delayed email failure must never revoke a newer replacement invitation.
create function public.cancel_failed_invitation(p_document uuid,p_owner uuid,p_session uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_document::text, 0));
 if exists(select 1 from public.documents where id=p_document and owner_id=p_owner and status='sent')
 and exists(select 1 from public.signing_sessions where id=p_session and document_id=p_document and status in ('pending','processing')) then
  perform public.revoke_signing_session(p_document,p_owner);
 end if;
end; $$;
revoke all on function public.revoke_signing_session(uuid,uuid),public.cancel_failed_invitation(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.revoke_signing_session(uuid,uuid),public.cancel_failed_invitation(uuid,uuid,uuid) to service_role;
