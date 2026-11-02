-- Renew one unfinished participant without reopening or losing signed PDFs.
create or replace function public.renew_signing_invitation(p_document uuid,p_owner uuid,p_session uuid,p_expected_hash text,p_hash text,p_delivery text)
returns public.signing_sessions language plpgsql security definer set search_path='' as $$
declare d public.documents; s public.signing_sessions;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_document::text,0));
 select * into d from public.documents where id=p_document and owner_id=p_owner;
 if not found or d.status<>'sent' then raise exception 'Only an unfinished document can be reminded'; end if;
 if exists(select 1 from public.signing_sessions where document_id=p_document and status='processing') then raise exception 'A participant is signing. Try again shortly'; end if;
 if p_delivery not in ('email','share') or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation'; end if;
 update public.signing_sessions set token_hash=p_hash,expires_at=now()+interval '72 hours',delivery=p_delivery
 where id=p_session and document_id=p_document and status='pending' and token_hash=p_expected_hash and batch_id is not distinct from d.active_batch returning * into s;
 if not found then raise exception 'Invitation changed or participant has already signed'; end if;
 insert into public.audit_records(document_id,session_id,event,actor,metadata)
 values(p_document,s.id,'invitation_renewed',p_owner::text,jsonb_build_object('recipient',s.recipient_email,'expires_at',s.expires_at,'delivery',p_delivery));
 return s;
end; $$;
revoke all on function public.renew_signing_invitation(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.renew_signing_invitation(uuid,uuid,uuid,text,text,text) to service_role;
