-- Retain private source PDFs and signing/audit history; remove drafts from active views.
alter table public.documents drop constraint documents_status_check;
alter table public.documents add constraint documents_status_check
  check (status in ('uploading','draft','sent','completed','deleted'));

alter policy "owner admin reads documents" on public.documents
  using (public.is_admin() and owner_id = auth.uid() and status <> 'deleted');

create function public.delete_document_draft(p_document uuid, p_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_document::text, 0));
  perform 1 from public.documents where id = p_document and owner_id = p_owner and status = 'draft' for update;
  if not found then raise exception 'Only your draft documents can be deleted'; end if;
  update public.documents set status = 'deleted' where id = p_document;
  insert into public.audit_records(document_id,event,actor)
    values(p_document,'draft_deleted',p_owner::text);
end; $$;
revoke all on function public.delete_document_draft(uuid,uuid) from public, anon, authenticated;
grant execute on function public.delete_document_draft(uuid,uuid) to service_role;
