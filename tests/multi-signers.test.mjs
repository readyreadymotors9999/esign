import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {documentSigners,documentFields,requireAppliedSignatures,signatureFieldKey} from '../supabase/functions/_shared/validation.ts';

const owner='11111111-1111-4111-8111-111111111111', doc='33333333-3333-4333-8333-333333333333';
const alice='44444444-4444-4444-8444-444444444444', bob='55555555-5555-4555-8555-555555555555';
const roster=[{id:'alice',name:'Alice Chen',email:'alice@example.com'},{id:'bob',name:'Bob Wu',email:'bob@example.com'}];
const fields=['company','alice','bob'].flatMap((signer,index)=>['signature','date'].map((type,i)=>({id:`field-${index}-${i}`,page:1,signer,type,x:0.1,y:0.1+index*0.2+i*0.06,width:0.2,height:0.04})));

test('document signer validation restricts owners and requires every signature box to be explicitly applied',()=>{
 const signers=documentSigners(roster);
 assert.equal(documentFields(fields,1,signers).length,6);
 assert.throws(()=>documentFields([...fields,{...fields[0],x:0.4}],1,signers),/unique identifier/);
 assert.throws(()=>documentSigners([...roster,{...roster[0],id:'extra'}]),/unique/);
 assert.throws(()=>documentFields([...fields,{...fields[0],id:'unselected-field',signer:'unselected'}],1,signers),/added to this document/);
 const signatures=fields.filter(field=>field.type==='signature');
 assert.throws(()=>requireAppliedSignatures(signatures,[signatureFieldKey(signatures[0])]),/every assigned/);
 requireAppliedSignatures(signatures,signatures.map(signatureFieldKey));
});

test('multi-signer sessions serialize final PDFs and notify all participants only after the final signer',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create schema storage; create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
   grant usage on schema public,auth,storage to anon,authenticated,service_role;`);
  const directory=new URL('../supabase/migrations/',import.meta.url);
  for(const file of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(file,directory),'utf8'));
  await db.query(`insert into auth.users values($1)`,[owner]);
  await db.query(`insert into public.documents(id,owner_id,title,status,original_path,signers) values($1,$2,'Shared agreement','draft','original.pdf',$3)`,[doc,owner,JSON.stringify(roster)]);
  const sessions=roster.map((signer,index)=>({id:[alice,bob][index],signer_id:signer.id,email:signer.email,name:signer.name,hash:signer.id}));
  const issue=async(list,revision)=>db.query(`select public.issue_document_sessions($1,$2,$3,'original.pdf','prepared.pdf',$4,$5,$6,$7,'share')`,[doc,owner,revision,JSON.stringify(fields),JSON.stringify(roster),JSON.stringify(list),JSON.stringify({signed_at:new Date().toISOString()})]);
  await issue(sessions,0);
  await db.query('select public.mark_document_viewed($1)',[alice]);
  await db.query('select public.mark_document_viewed($1)',[bob]);
  const view=(await db.query("select subject from public.email_notifications where kind='viewed' order by subject")).rows;
  assert.match(view[0].subject,/Alice Chen/);assert.match(view[1].subject,/Bob Wu/);
  await db.query("select public.claim_signing_session('alice')");
  await assert.rejects(db.query("select public.claim_signing_session('bob')"),/Another participant/);
  await assert.rejects(db.query("select public.renew_signing_invitation($1,$2,$3,'bob',$4,'email')",[doc,owner,bob,'b'.repeat(64)]),/participant is signing/);
  await db.query('select public.finish_signing_session($1,$2,$3)',[alice,'alice-signed.pdf','{}']);
  let document=(await db.query('select * from public.documents')).rows[0];
  assert.equal(document.status,'sent');assert.equal(document.working_path,'alice-signed.pdf');assert.equal(document.signed_path,null);
  assert.deepEqual(document.signed_signer_ids,['alice']);
  assert.equal((await db.query("select * from public.email_notifications where kind='completed'")).rows.length,0);
  await db.query("update public.signing_sessions set expires_at=now()-interval '1 day' where id=$1",[bob]);
  await assert.rejects(db.query("select public.renew_signing_invitation($1,$2,$3,'bob',$4,'email')",[doc,'22222222-2222-4222-8222-222222222222',bob,'b'.repeat(64)]));
  await assert.rejects(db.query("select public.renew_signing_invitation($1,$2,$3,'alice',$4,'email')",[doc,owner,alice,'a'.repeat(64)]));
  const renewed=(await db.query("select * from public.renew_signing_invitation($1,$2,$3,'bob',$4,'email')",[doc,owner,bob,'b'.repeat(64)])).rows[0];
  assert.equal(renewed.token_hash,'b'.repeat(64));
  assert.ok(new Date(renewed.expires_at).getTime()>Date.now()+71*3600000);
  await assert.rejects(db.query("select public.claim_signing_session('bob')"));
  await assert.rejects(db.query("select public.renew_signing_invitation($1,$2,$3,'bob',$4,'email')",[doc,owner,bob,'c'.repeat(64)]));
  const claim=(await db.query("select * from public.claim_signing_session($1)",['b'.repeat(64)])).rows[0];
  assert.equal(claim.id,bob);assert.equal(claim.status,'processing');
  assert.equal((await db.query('select working_path from public.documents')).rows[0].working_path,'alice-signed.pdf');
  assert.deepEqual((await db.query('select signed_signer_ids from public.documents')).rows[0].signed_signer_ids,['alice']);

  // Reopening a partly signed batch invalidates remaining links and drops its partial PDF.
  await db.query('select public.cancel_failed_invitation($1,$2,$3)',[doc,owner,alice]);
  document=(await db.query('select * from public.documents')).rows[0];
  assert.equal(document.status,'draft');assert.equal(document.working_path,null);
  await assert.rejects(db.query("select public.claim_signing_session('bob')"));
  const next=roster.map((signer,index)=>({id:['66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777'][index],signer_id:signer.id,email:signer.email,name:signer.name,hash:'next-'+signer.id}));
  await issue(next,document.draft_revision);
  await db.query("select public.claim_signing_session('next-bob')");
  await db.query('select public.finish_signing_session($1,$2,$3)',[next[1].id,'bob-next.pdf','{}']);
  assert.equal((await db.query('select status from public.documents')).rows[0].status,'sent');
  await db.query("select public.claim_signing_session('next-alice')");
  await db.query('select public.finish_signing_session($1,$2,$3)',[next[0].id,'everyone-final.pdf','{}']);
  document=(await db.query('select * from public.documents')).rows[0];
  assert.equal(document.status,'completed');assert.equal(document.signed_path,'everyone-final.pdf');
  await assert.rejects(db.query("select public.renew_signing_invitation($1,$2,$3,'next-alice',$4,'email')",[doc,owner,next[0].id,'d'.repeat(64)]));
  const notifications=(await db.query("select recipient from public.email_notifications where kind='completed' order by recipient")).rows;
  assert.deepEqual(notifications.map(row=>row.recipient),['alice@example.com','bob@example.com','readyreadymotors9999@gmail.com']);
  await assert.rejects(db.query('select public.revoke_signing_session($1,$2)',[doc,owner]));
  await db.exec('set role anon');
  await assert.rejects(issue(next,document.draft_revision));
 } finally {await db.close();}
});

test('repair migration restores missing signer schema and can be rerun without changing an active signer batch',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create schema storage;create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
   grant usage on schema public,auth,storage to anon,authenticated,service_role;`);
  const directory=new URL('../supabase/migrations/',import.meta.url);
  for(const file of (await readdir(directory)).filter(name=>name.endsWith('.sql')&&!name.includes('document_signers')).sort()) await db.exec(await readFile(new URL(file,directory),'utf8'));
  const missing=(await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='documents' and column_name in ('draft_revision','signers')")).rows;
  assert.deepEqual(missing.map(row=>row.column_name),['draft_revision']);
  const repair=await readFile(new URL('202611010004_repair_document_signers.sql',directory),'utf8');
  await db.exec(repair);
  await db.query('insert into auth.users values($1)',[owner]);
  await db.query("insert into public.documents(id,owner_id,title,status,original_path,signers) values($1,$2,'Repair test','draft','original.pdf',$3)",[doc,owner,JSON.stringify(roster)]);
  const sessions=roster.map((signer,index)=>({id:[alice,bob][index],signer_id:signer.id,email:signer.email,name:signer.name,hash:signer.id}));
  await db.query("select public.issue_document_sessions($1,$2,0,'original.pdf','prepared.pdf',$3,$4,$5,$6,'share')",[doc,owner,JSON.stringify(fields),JSON.stringify(roster),JSON.stringify(sessions),JSON.stringify({signed_at:new Date().toISOString()})]);
  const batch=(await db.query('select active_batch from public.documents')).rows[0].active_batch;
  await db.exec(repair);
  const repaired=(await db.query('select signers,active_batch from public.documents')).rows[0];
  assert.deepEqual(repaired.signers,roster);assert.equal(repaired.active_batch,batch);
  assert.equal((await db.query('select count(*)::int count from public.signing_sessions')).rows[0].count,2);
 } finally {await db.close();}
});
