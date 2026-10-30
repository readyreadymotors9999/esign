import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const admin = "11111111-1111-4111-8111-111111111111";
const outsider = "22222222-2222-4222-8222-222222222222";
const doc = "33333333-3333-4333-8333-333333333333";
test("database policies, atomic signing, revocation and one-time/expiring links", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema storage;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant usage on schema public,auth,storage to anon,authenticated,service_role;
 grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
 insert into auth.users values ('${admin}'),('${outsider}');`);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202610290001_esign.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202610290002_two_party.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202610300001_draft_pdf_editing.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202610300002_reopen_signing.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(`insert into public.admins values ('${admin}');
 insert into public.documents(id,owner_id,title,original_path) values ('${doc}','${admin}','Contract.pdf','${admin}/${doc}/original.pdf');`);
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${outsider}',false);`,
    );
    assert.equal(
      (await db.query("select * from public.documents")).rows.length,
      0,
    );
    await assert.rejects(
      db.exec(`insert into public.admins values ('${outsider}')`),
    );
    await assert.rejects(
      db.exec(`select public.claim_signing_session('hash')`),
    );
    await assert.rejects(
      db.exec(
        `insert into storage.objects(bucket_id,name) values ('documents','${admin}/${doc}/original.pdf')`,
      ),
    );
    await db.exec(
      `select set_config('request.jwt.claim.sub','${admin}',false);`,
    );
    assert.equal(
      (await db.query("select * from public.documents")).rows.length,
      1,
    );
    await db.exec(
      `insert into storage.objects(bucket_id,name) values ('documents','${admin}/${doc}/original.pdf');`,
    );
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      0,
      "even admin cannot read storage directly",
    );
    await assert.rejects(
      db.exec(`update public.documents set status='completed'`),
    );
    await db.exec(
      `reset role; update public.documents set status='draft' where id='${doc}';`,
    );
    const fields = JSON.stringify([
      { type: "signature", page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
    ]);
    const {
      rows: [{ sid }],
    } = await db.query(
      `select public.issue_signing_session($1,$2,$3,$4,$5) as sid`,
      [doc, admin, "123@qq.com", "hash", fields],
    );
    await assert.rejects(
      db.query(`select public.issue_signing_session($1,$2,$3,$4,$5)`, [
        doc,
        admin,
        "123@qq.com",
        "hash2",
        fields,
      ]),
    );
    await db.exec(`select public.revoke_signing_session('${doc}','${admin}');`);
    await assert.rejects(
      db.exec(`select public.claim_signing_session('hash')`),
    );
    await db.query(`select public.issue_signing_session($1,$2,$3,$4,$5)`, [
      doc,
      admin,
      "123@qq.com",
      "expired",
      fields,
    ]);
    await db.exec(
      `update public.signing_sessions set expires_at=now()-interval '1 hour' where token_hash='expired';`,
    );
    await assert.rejects(
      db.exec(`select public.claim_signing_session('expired')`),
    );
    await db.exec(`select public.revoke_signing_session('${doc}','${admin}');`);
    const previousPath = `${admin}/${doc}/original.pdf`;
    await db.query(`select public.edit_draft_pdf($1,$2,$3,$4,$5,$6)`, [
      doc,
      admin,
      previousPath,
      "revision.pdf",
      fields,
      JSON.stringify({ operation: "blank" }),
    ]);
    await assert.rejects(
      db.query(`select public.edit_draft_pdf($1,$2,$3,$4,$5,$6)`, [
        doc,
        admin,
        previousPath,
        "stale.pdf",
        fields,
        "{}",
      ]),
    );
    await assert.rejects(
      db.query(
        `select public.issue_prepared_session($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          doc,
          admin,
          "123@qq.com",
          "stale",
          fields,
          "prepared-old.pdf",
          JSON.stringify({
            source_path: previousPath,
            signed_at: "2026-10-29T12:00:00Z",
          }),
          "share",
          "Recipient",
        ],
      ),
    );
    const final = (
      await db.query(
        `select public.issue_prepared_session($1,$2,$3,$4,$5,$6,$7,$8,$9) as sid`,
        [
          doc,
          admin,
          "123@qq.com",
          "final",
          fields,
          "prepared.pdf",
          JSON.stringify({
            source_path: "revision.pdf",
            signed_at: "2026-10-29T12:00:00Z",
            name: "Lichen Wang",
            consent: true,
          }),
          "share",
          "Test Recipient",
        ],
      )
    ).rows[0].sid;
    const prepared = (
      await db.query(
        `select prepared_path,recipient_name,company_signed_at from public.documents where id='${doc}'`,
      )
    ).rows[0];
    assert.equal(prepared.prepared_path, "prepared.pdf");
    assert.equal(prepared.recipient_name, "Test Recipient");
    assert.ok(prepared.company_signed_at);
    assert.equal(
      (
        await db.query(
          `select * from public.audit_records where event='company_signed'`,
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          `select delivery from public.signing_sessions where id=$1`,
          [final],
        )
      ).rows[0].delivery,
      "share",
    );
    await db.exec(`select public.claim_signing_session('final');`);
    await assert.rejects(
      db.query(`select public.edit_draft_pdf($1,$2,$3,$4,$5,$6)`, [
        doc,
        admin,
        "revision.pdf",
        "not-draft.pdf",
        fields,
        "{}",
      ]),
    );
    await assert.rejects(
      db.exec(`select public.claim_signing_session('final')`),
    );
    await db.exec(`select public.revoke_signing_session('${doc}','${admin}')`);
    const cleared = (
      await db.query(
        `select status,prepared_path,company_signed_at,signed_path from public.documents where id='${doc}'`,
      )
    ).rows[0];
    assert.deepEqual(cleared, {
      status: "draft",
      prepared_path: null,
      company_signed_at: null,
      signed_path: null,
    });
    await assert.rejects(
      db.query(`select public.finish_signing_session($1,$2,$3)`, [
        final,
        "stale.pdf",
        "{}",
      ]),
    );
    await assert.rejects(
      db.exec(`select public.claim_signing_session('final')`),
    );
    const replacement = (
      await db.query(
        `select public.issue_signing_session($1,$2,$3,$4,$5) as sid`,
        [doc, admin, "signer@qq.com", "replacement", fields],
      )
    ).rows[0].sid;
    await db.query(`select public.cancel_failed_invitation($1,$2,$3)`, [
      doc,
      admin,
      final,
    ]);
    assert.equal(
      (await db.query(`select status from public.documents where id='${doc}'`))
        .rows[0].status,
      "sent",
    );
    await db.exec(`select public.claim_signing_session('replacement')`);
    await db.query(`select public.finish_signing_session($1,$2,$3)`, [
      replacement,
      "signed.pdf",
      JSON.stringify({ sha256: "abc", consent: true }),
    ]);
    await assert.rejects(
      db.exec(`select public.claim_signing_session('final')`),
    );
    await assert.rejects(
      db.query(`select public.finish_signing_session($1,$2,$3)`, [
        final,
        "overwrite.pdf",
        "{}",
      ]),
    );
    await assert.rejects(
      db.exec(`select public.revoke_signing_session('${doc}','${admin}')`),
    );
    assert.equal(
      (
        await db.query(
          `select status,signed_path from public.documents where id='${doc}'`,
        )
      ).rows[0].status,
      "completed",
    );
    assert.equal(
      (
        await db.query(
          `select * from public.audit_records where event='document_signed'`,
        )
      ).rows.length,
      1,
    );
    await db.query(
      `insert into public.recipients(owner_id,email,first_name,last_name) values ($1,$2,$3,$4)`,
      [admin, "123@qq.com", "Test", "Recipient"],
    );
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${outsider}',false);`,
    );
    assert.equal(
      (await db.query("select * from public.recipients")).rows.length,
      0,
    );
    await assert.rejects(
      db.exec(
        `insert into public.recipients(owner_id,email) values ('${outsider}','attacker@example.com')`,
      ),
    );
    await db.exec(
      `select set_config('request.jwt.claim.sub','${admin}',false);`,
    );
    assert.equal(
      (await db.query("select * from public.recipients")).rows.length,
      1,
    );
    await db.exec("reset role");
    await db.exec(`set role anon;`);
    await assert.rejects(db.exec("select * from public.signing_sessions"));
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      0,
    );
    assert.ok(sid);
  } finally {
    await db.close();
  }
});
