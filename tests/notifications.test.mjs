import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {notificationRaw, sendNotification} from '../supabase/functions/_shared/gmail.ts';

test('notification MIME preserves Chinese document names and prevents header injection', async () => {
 const subject = 'Junjie Wu has viewed the document "寄卖合同 - Junjie Wu"\r\nBcc: other@example.com';
 const raw = notificationRaw('owner@example.com', subject, subject, 'test-id');
 const mime = Buffer.from(raw, 'base64url').toString();
 assert.ok(!mime.includes('\r\nBcc:'));
 const encoded = mime.match(/Subject: ([\s\S]*?)\r\nMessage-ID/)[1];
 const words = [...encoded.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)];
 assert.equal(words.map(m => Buffer.from(m[1], 'base64').toString()).join(''), subject);
 for (const word of words) assert.ok(word[0].length <= 75);
 assert.equal(await sendNotification('token', 'owner@example.com', subject, subject, 'test-id', async (_, init) => {
   assert.match(Buffer.from(JSON.parse(init.body).raw, "base64url").toString(), /Message-ID: <esign-notification-test-id@gmail.com>/);
   return new Response(JSON.stringify({id:'gmail-id'}));
 }), 'gmail-id');
 await assert.rejects(sendNotification('token','owner@example.com',subject,subject,'test-id',async()=>new Response('{}',{status:429})));
});

test('view notifications deduplicate per invitation; completion queues both participants atomically and leases retries', async () => {
 const db = new PGlite();
 const owner='11111111-1111-4111-8111-111111111111', doc='33333333-3333-4333-8333-333333333333', session='44444444-4444-4444-8444-444444444444';
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create schema storage;
   create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
   alter table storage.objects enable row level security;
   grant usage on schema public,auth,storage to anon,authenticated,service_role;`);
  const directory = new URL('../supabase/migrations/',import.meta.url);
  for(const name of (await readdir(directory)).filter(n=>n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(name,directory),'utf8'));
  await db.exec(`insert into auth.users values ('${owner}');
   insert into public.documents(id,owner_id,title,status,original_path,recipient_name) values('${doc}','${owner}','寄卖合同 - Junjie Wu','sent','original.pdf','Junjie Wu');
   insert into public.signing_sessions(id,document_id,recipient_email,token_hash,expires_at) values('${session}','${doc}','signer@example.com','hash',now()+interval '1 day');
   select public.mark_document_viewed('${session}'); select public.mark_document_viewed('${session}');`);
  let notices=(await db.query('select * from public.email_notifications')).rows;
  assert.equal(notices.length,1);
  assert.equal(notices[0].recipient,'readyreadymotors9999@gmail.com');
  assert.equal(notices[0].subject,'Junjie Wu has viewed the document "寄卖合同 - Junjie Wu"');
  assert.ok((await db.query('select viewed_at from public.documents')).rows[0].viewed_at);
  assert.equal((await db.query("select * from public.audit_records where event='document_viewed'")).rows.length,1);
  await db.exec(`update public.signing_sessions set status='processing' where id='${session}';
   select public.finish_signing_session('${session}','signed.pdf','{}');`);
  notices=(await db.query("select * from public.email_notifications where kind='completed' order by recipient")).rows;
  assert.deepEqual(notices.map(n=>n.recipient),['readyreadymotors9999@gmail.com','signer@example.com']);
  assert.equal(notices[0].subject,'"寄卖合同 - Junjie Wu" document has been completed by all participants');
  assert.equal((await db.query('select * from public.claim_email_notifications(null)')).rows.length,3);
  assert.equal((await db.query('select * from public.claim_email_notifications(null)')).rows.length,0);
  await db.exec("update public.email_notifications set available_at=now()-interval '1 minute'; update public.email_notifications set status='sent' where kind='viewed'");
  assert.equal((await db.query('select * from public.claim_email_notifications(null)')).rows.length,2);
  const otherDoc='55555555-5555-4555-8555-555555555555', ownerSession='66666666-6666-4666-8666-666666666666';
  await db.exec(`insert into public.documents(id,owner_id,title,status,original_path) values('${otherDoc}','${owner}','Owner test','sent','other.pdf');
   insert into public.signing_sessions(id,document_id,recipient_email,token_hash,expires_at) values('${ownerSession}','${otherDoc}','readyreadymotors9999@gmail.com','owner-hash',now()+interval '1 day');
   select public.mark_document_viewed('${ownerSession}');`);
  assert.equal((await db.query(`select * from public.email_notifications where session_id='${ownerSession}'`)).rows.length,0);
  await db.exec(`select public.revoke_signing_session('${otherDoc}','${owner}')`);
  assert.equal((await db.query(`select viewed_at from public.documents where id='${otherDoc}'`)).rows[0].viewed_at,null);
  await assert.rejects(db.exec(`select public.mark_document_viewed('${ownerSession}')`));
  await db.exec(`update public.documents set title='Changed',original_path='revision.pdf',fields='[{"page":1,"x":0.1}]' where id='${otherDoc}'`);
  let revision=(await db.query(`select draft_revision from public.documents where id='${otherDoc}'`)).rows[0].draft_revision;
  await assert.rejects(db.exec(`select public.restore_draft('${otherDoc}','${owner}','revision.pdf',${revision},'original.pdf','[]','Owner test')`));
  await db.exec(`select public.restore_draft('${otherDoc}','${owner}','revision.pdf',${revision},'other.pdf','[]','Owner test')`);
  let restored=(await db.query(`select * from public.documents where id='${otherDoc}'`)).rows[0];
  assert.equal(restored.title,'Owner test');assert.deepEqual(restored.fields,[]);assert.equal(restored.original_path,'other.pdf');
  assert.equal(restored.draft_revision,revision+1);
  await assert.rejects(db.exec(`select public.restore_draft('${otherDoc}','${owner}','other.pdf',${revision},'other.pdf','[]','Stale')`));
  await assert.rejects(db.exec(`select public.restore_draft('${doc}','${owner}','original.pdf',0,'original.pdf','[]','Cannot edit completed')`));
  const aliceSession='77777777-7777-4777-8777-777777777777';
  await db.exec(`update public.documents set status='sent',title='Lease Alice',recipient_name='Alice Chen' where id='${otherDoc}';
   insert into public.signing_sessions(id,document_id,recipient_email,token_hash,expires_at) values('${aliceSession}','${otherDoc}','alice@example.com','alice-hash',now()+interval '1 day');
   select public.mark_document_viewed('${aliceSession}');`);
  assert.equal((await db.query(`select subject from public.email_notifications where session_id='${aliceSession}'`)).rows[0].subject,'Alice Chen has viewed the document "Lease Alice"');
  await db.exec('set role anon');
  await assert.rejects(db.exec('select * from public.email_notifications'));
  await assert.rejects(db.exec(`select public.mark_document_viewed('${session}')`));
  await assert.rejects(db.exec('select * from public.claim_email_notifications(null)'));
  await assert.rejects(db.exec(`select public.restore_draft('${otherDoc}','${owner}','other.pdf',0,'other.pdf','[]','Forbidden')`));
 } finally {await db.close();}
});

test('completion email MIME carries the exact signed PDF and a safe Unicode filename', async () => {
 const bytes=new Uint8Array([37,80,68,70,45,0,255,13,10,128]);
 const attachment={filename:'寄卖合同 - Junjie Wu - completed.pdf',bytes};
 const raw=notificationRaw('signer@example.com','Completed','All participants signed.','attachment-test',attachment);
 const mime=Buffer.from(raw,'base64url').toString();
 assert.match(mime,/Content-Type: multipart\/mixed/);
 assert.match(mime,/Content-Type: application\/pdf/);
 assert.ok(mime.includes(encodeURIComponent(attachment.filename)));
 const encoded=mime.split('Content-Transfer-Encoding: base64\r\n\r\n')[2].split('\r\n--')[0];
 assert.deepEqual(new Uint8Array(Buffer.from(encoded,'base64')),bytes);
 await sendNotification('token','signer@example.com','Completed','All participants signed.','attachment-test',async(_,init)=>{
   assert.match(Buffer.from(JSON.parse(init.body).raw,'base64url').toString(),/application\/pdf/);
   return new Response(JSON.stringify({id:'attachment-id'}));
 },attachment);
 const viewed=Buffer.from(notificationRaw('owner@example.com','Viewed','Viewed','view-test'),'base64url').toString();
 assert.ok(!viewed.includes('application/pdf'));
});
