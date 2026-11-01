-- Immutable PDF versions may be restored only within their own document.
create table public.draft_pdf_versions (
 document_id uuid not null references public.documents(id),
 path text not null,
 primary key(document_id,path)
);
alter table public.draft_pdf_versions enable row level security;
revoke all on public.draft_pdf_versions from public,anon,authenticated;
grant all on public.draft_pdf_versions to service_role;
insert into public.draft_pdf_versions select id,original_path from public.documents;
create function public.track_draft_version() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.draft_pdf_versions(document_id,path) values(new.id,new.original_path) on conflict do nothing;
 return new;
end; $$;
create trigger track_draft_version after insert or update of original_path on public.documents for each row execute function public.track_draft_version();
create function public.advance_draft_revision() returns trigger language plpgsql set search_path='' as $$
begin
 if new.fields is distinct from old.fields or new.original_path is distinct from old.original_path or new.title is distinct from old.title then
  new.draft_revision := old.draft_revision+1;
 end if;
 return new;
end; $$;
create trigger advance_draft_revision before update on public.documents for each row execute function public.advance_draft_revision();
create function public.restore_draft(p_document uuid,p_owner uuid,p_expected_path text,p_revision integer,p_path text,p_fields jsonb,p_title text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_document::text,0));
 if not exists(select 1 from public.draft_pdf_versions where document_id=p_document and path=p_path) then raise exception 'Unknown document version'; end if;
 update public.documents set original_path=p_path,fields=p_fields,title=p_title,prepared_path=null,company_signed_at=null,signed_path=null
 where id=p_document and owner_id=p_owner and status='draft' and original_path=p_expected_path and draft_revision=p_revision;
 if not found then raise exception 'Document changed. Refresh before restoring'; end if;
 insert into public.audit_records(document_id,event,actor,metadata) values(p_document,'draft_restored',p_owner::text,jsonb_build_object('previous_path',p_expected_path,'new_path',p_path));
end; $$;
revoke all on function public.track_draft_version(),public.advance_draft_revision(),public.restore_draft(uuid,uuid,text,integer,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.restore_draft(uuid,uuid,text,integer,text,jsonb,text) to service_role;
