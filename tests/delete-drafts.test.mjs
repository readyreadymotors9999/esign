import test from "node:test";
import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";

test("draft deletion enforces ownership, draft status and RLS while retaining audit history", async () => {
  const db = new PGlite();
  const owner = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  const draft = "33333333-3333-4333-8333-333333333333";
  const sent = "44444444-4444-4444-8444-444444444444";
  const completed = "55555555-5555-4555-8555-555555555555";
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to anon,authenticated,service_role;`);
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort())
      await db.exec(await readFile(new URL(file,directory), "utf8"));
    await db.query("insert into auth.users values($1),($2)", [owner,other]);
    await db.query("insert into public.admins values($1)", [owner]);
    for (const [id,status] of [[draft,"draft"],[sent,"sent"],[completed,"completed"]])
      await db.query("insert into public.documents(id,owner_id,title,status,original_path) values($1,$2,'Test',$3,$4)", [id,owner,status,id+".pdf"]);
    await assert.rejects(db.query("select public.delete_document_draft($1,$2)",[draft,other]));
    for (const id of [sent,completed])
      await assert.rejects(db.query("select public.delete_document_draft($1,$2)",[id,owner]));
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select public.delete_document_draft($1,$2)",[draft,owner]));
    await db.exec("reset role");
    await db.query("select public.delete_document_draft($1,$2)",[draft,owner]);
    assert.equal((await db.query("select status from public.documents where id=$1",[draft])).rows[0].status,"deleted");
    assert.equal((await db.query("select event from public.audit_records where document_id=$1",[draft])).rows[0].event,"draft_deleted");
    await assert.rejects(db.query("select public.delete_document_draft($1,$2)",[draft,owner]));
    const update = await db.query("update public.documents set title='stale save' where id=$1 and status='draft' returning id",[draft]);
    assert.equal(update.rows.length,0);
    await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select '${owner}'::uuid $$; set role authenticated;`);
    const visible = (await db.query("select id from public.documents order by id")).rows.map(row=>row.id);
    assert.deepEqual(visible,[sent,completed]);
  } finally { await db.close(); }
});
