-- Draft edits create new immutable Storage objects. A compare-and-swap rejects
-- stale editor tabs and serializes with signing-session issuance.
create function public.edit_draft_pdf(p_document uuid,p_owner uuid,p_expected_path text,p_new_path text,p_fields jsonb,p_metadata jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_document::text,0));
 if not exists(select 1 from public.documents where id=p_document and owner_id=p_owner and status='draft' and original_path=p_expected_path) then
  raise exception 'Document changed or is no longer a draft';
 end if;
 update public.documents set original_path=p_new_path,fields=p_fields,prepared_path=null,company_signed_at=null where id=p_document;
 insert into public.audit_records(document_id,event,actor,metadata) values(p_document,'draft_pdf_edited',p_owner::text,p_metadata);
end; $$;
revoke all on function public.edit_draft_pdf(uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.edit_draft_pdf(uuid,uuid,text,text,jsonb,jsonb) to service_role;

create or replace function public.issue_prepared_session(p_document uuid,p_owner uuid,p_email text,p_hash text,p_fields jsonb,p_path text,p_metadata jsonb,p_delivery text,p_recipient_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_document::text,0));
 if not exists(select 1 from public.documents where id=p_document and owner_id=p_owner and original_path=p_metadata->>'source_path') then
  raise exception 'PDF changed while preparing; refresh and sign the current version';
 end if;
 if p_delivery not in ('email','share') then raise exception 'Invalid delivery'; end if;
 sid:=public.issue_signing_session(p_document,p_owner,p_email,p_hash,p_fields);
 update public.documents set prepared_path=p_path,company_signed_at=(p_metadata->>'signed_at')::timestamptz,recipient_name=p_recipient_name where id=p_document;
 update public.signing_sessions set delivery=p_delivery where id=sid;
 insert into public.audit_records(document_id,session_id,event,actor,metadata) values(p_document,sid,'company_signed','readyreadymotors9999@gmail.com',p_metadata);
 if p_delivery='share' then insert into public.audit_records(document_id,session_id,event,actor) values(p_document,sid,'share_link_created',p_owner::text); end if;
 return sid;
end; $$;
