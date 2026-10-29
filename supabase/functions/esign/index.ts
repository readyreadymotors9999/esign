import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { PDFDocument } from "pdf-lib";
import { generateSignedPdf } from "../_shared/pdf.ts";
import {
  emailAddress,
  validateFields,
  tokenValue,
  placement,
  escapeHtml,
  ValidationError,
} from "../_shared/validation.ts";
const env = (key: string) => {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`Missing server configuration: ${key}`);
  return v;
};
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const origin = env("APP_ORIGIN");
const appUrl = env("APP_URL");
const cors = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
  "Cache-Control": "no-store",
};
class HttpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new HttpError(message, status);
}
function check(error: unknown) {
  if (error) {
    console.error("Database/storage operation failed");
    fail("Unable to save or retrieve the document. Please retry.", 500);
  }
}
async function digest(value: string | Uint8Array) {
  const input =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", input as BufferSource),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
async function original(path: string) {
  const { data, error } = await db.storage.from("documents").download(path);
  check(error);
  return new Uint8Array(await data!.arrayBuffer());
}
async function signedUrl(path: string) {
  const { data, error } = await db.storage
    .from("documents")
    .createSignedUrl(path, 60);
  check(error);
  return data!.signedUrl;
}
async function audit(
  documentId: string,
  event: string,
  actor: string,
  sessionId?: string,
  metadata: object = {},
) {
  const { error } = await db
    .from("audit_records")
    .insert({
      document_id: documentId,
      session_id: sessionId,
      event,
      actor,
      metadata,
    });
  check(error);
}
async function sessionFor(token: unknown) {
  const hash = await digest(tokenValue(token));
  const { data, error } = await db
    .from("signing_sessions")
    .select("*")
    .eq("token_hash", hash)
    .maybeSingle();
  check(error);
  if (
    !data ||
    data.status !== "pending" ||
    new Date(data.expires_at).getTime() <= Date.now()
  )
    fail("This signing link is expired, completed, or unavailable.", 410);
  return data;
}
async function documentFor(id: string, owner?: string) {
  let query = db.from("documents").select("*").eq("id", id);
  if (owner) query = query.eq("owner_id", owner);
  const { data, error } = await query.maybeSingle();
  check(error);
  if (!data) fail("Document not found.", 404);
  return data;
}
async function complete(body: any, request: Request) {
  if (
    body.consent !== true ||
    typeof body.name !== "string" ||
    body.name.trim().length < 1 ||
    body.name.length > 150
  )
    fail("Your full name and electronic signature consent are required.");
  if (
    typeof body.signature !== "string" ||
    !body.signature.startsWith("data:image/png;base64,") ||
    body.signature.length > 350000
  )
    fail("Provide a valid drawn signature.");
  let png: Uint8Array;
  try {
    png = Uint8Array.from(atob(body.signature.slice(22)), (c) =>
      c.charCodeAt(0),
    );
  } catch {
    return fail("Invalid signature image.");
  }
  // Accept only the fixed-size canvas PNG produced by this app; reject image bombs.
  if (
    png.length < 33 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => png[i] === v) ||
    new DataView(png.buffer).getUint32(16) !== 900 ||
    new DataView(png.buffer).getUint32(20) !== 240
  )
    fail("Invalid signature dimensions.");
  const hash = await digest(tokenValue(body.token));
  const { data: s, error } = await db.rpc("claim_signing_session", {
    p_hash: hash,
  });
  if (error || !s)
    fail("This signing link is expired, used, or already in progress.", 410);
  const path = `${s.document_id}/signed-${s.id}.pdf`;
  let stored = false,
    finished = false;
  try {
    const doc = await documentFor(s.document_id);
    const source = await original(doc.original_path);
    const now = new Date().toISOString();
    const bytes = await generateSignedPdf(
      source,
      png,
      doc,
      s.id,
      s.recipient_email,
      body.name.trim(),
      now,
    );
    if (bytes.length > 10485760)
      fail(
        "The completed PDF exceeds the 10 MB storage limit. Contact the sender.",
      );
    const { error: uploadError } = await db.storage
      .from("documents")
      .upload(path, bytes, { contentType: "application/pdf", upsert: false });
    check(uploadError);
    stored = true;
    const { error: finishError } = await db.rpc("finish_signing_session", {
      p_session: s.id,
      p_path: path,
      p_metadata: {
        name: body.name.trim(),
        consent: true,
        consent_version: "2026-10-29",
        signed_at: now,
        sha256: await digest(bytes),
        original_sha256: await digest(source),
        ip: request.headers.get("x-forwarded-for")?.slice(0, 200) || null,
        user_agent: request.headers.get("user-agent")?.slice(0, 300) || null,
      },
    });
    check(finishError);
    finished = true;
    return { completed: true };
  } catch (e) {
    // A failed/ambiguous finalization stays processing: never re-enable a token
    // after an uncertain commit. Operators inspect storage+DB before recovery.
    if (!stored && !finished) {
      const { error } = await db
        .from("signing_sessions")
        .update({ status: "pending" })
        .eq("id", s.id)
        .eq("status", "processing");
      if (error) console.error("Session recovery requires operator review");
    }
    throw e;
  }
}
Deno.serve(async (request) => {
  if (request.headers.get("origin") && request.headers.get("origin") !== origin)
    return new Response("Origin not allowed", { status: 403 });
  if (request.method === "OPTIONS")
    return new Response(null, { headers: cors, status: 204 });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  try {
    if (request.method !== "POST") fail("Method not allowed.", 405);
    if (Number(request.headers.get("content-length") || 0) > 400000)
      fail("Request too large.", 413);
    const raw = await request.text();
    if (raw.length > 400000) fail("Request too large.", 413);
    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      fail("Invalid JSON.");
    }
    if (!body || typeof body.action !== "string") fail("Invalid request.");
    if (body.action === "session") {
      const s = await sessionFor(body.token),
        doc = await documentFor(s.document_id);
      await audit(doc.id, "document_viewed", s.recipient_email, s.id);
      return json({
        title: doc.title,
        email: s.recipient_email,
        fields: doc.fields,
        expires_at: s.expires_at,
        url: await signedUrl(doc.original_path),
      });
    }
    if (body.action === "complete") return json(await complete(body, request));
    // verify_jwt is off for account-free recipients. Every admin action must pass
    // real Supabase JWT validation AND explicit membership, not just CORS checks.
    const bearer = request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "");
    if (!bearer) fail("Sign in to continue.", 401);
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser(bearer);
    if (authError || !user) fail("Sign in to continue.", 401);
    const { data: admin, error: adminError } = await db
      .from("admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    check(adminError);
    if (!admin) fail("Administrator access is required.", 403);
    if (body.action === "list") {
      const { data, error } = await db
        .from("documents")
        .select("*")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false });
      check(error);
      return json({ documents: data });
    }
    if (body.action === "create") {
      if (
        typeof body.title !== "string" ||
        body.title.length < 1 ||
        body.title.length > 200
      )
        fail("Use a filename between 1 and 200 characters.");
      const id = crypto.randomUUID(),
        path = `${user.id}/${id}/original.pdf`;
      const { error } = await db
        .from("documents")
        .insert({
          id,
          owner_id: user.id,
          title: body.title,
          original_path: path,
        });
      check(error);
      return json({ id, path });
    }
    if (
      typeof body.documentId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(body.documentId)
    )
      fail("Invalid document ID.");
    const doc = await documentFor(body.documentId, user.id);
    if (body.action === "uploaded") {
      if (doc.status !== "uploading") fail("Document is already uploaded.");
      const bytes = await original(doc.original_path);
      let parsed;
      try {
        parsed = await PDFDocument.load(bytes);
      } catch {
        return fail("Use an unencrypted, valid PDF.");
      }
      if (parsed.getPageCount() < 1 || parsed.getPageCount() > 100)
        fail("PDF must have 1–100 pages.");
      const { error } = await db
        .from("documents")
        .update({ status: "draft" })
        .eq("id", doc.id)
        .eq("status", "uploading");
      check(error);
      await audit(doc.id, "document_uploaded", user.email || user.id);
      return json({ ok: true });
    }
    if (body.action === "detail") {
      const { data, error } = await db
        .from("audit_records")
        .select("*")
        .eq("document_id", doc.id)
        .order("created_at");
      check(error);
      return json({
        document: doc,
        audit: data,
        url:
          doc.status === "uploading"
            ? null
            : await signedUrl(doc.signed_path || doc.original_path),
      });
    }
    if (body.action === "download") {
      if (doc.status !== "completed" || !doc.signed_path)
        fail("Document is not completed.");
      await audit(doc.id, "signed_document_downloaded", user.email || user.id);
      return json({ url: await signedUrl(doc.signed_path) });
    }
    if (body.action === "revoke") {
      const { error } = await db.rpc("revoke_signing_session", {
        p_document: doc.id,
        p_owner: user.id,
      });
      if (error)
        fail(
          "Cannot revoke: signing may be in progress. Refresh and retry.",
          409,
        );
      return json({ ok: true });
    }
    if (body.action === "send") {
      if (doc.status !== "draft")
        fail("Only draft documents can be sent.", 409);
      const email = emailAddress(body.email),
        source = await original(doc.original_path);
      const pdf = await PDFDocument.load(source),
        fields = validateFields(body.fields, pdf.getPageCount());
      // Verify all fields map to valid page rotations before sending an invitation.
      for (const f of fields) {
        const p = pdf.getPage(f.page - 1);
        placement(f, p.getCropBox(), p.getRotation().angle);
      }
      const resend = env("RESEND_API_KEY"),
        from = env("EMAIL_FROM");
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      const { data: sid, error } = await db.rpc("issue_signing_session", {
        p_document: doc.id,
        p_owner: user.id,
        p_email: email,
        p_hash: await digest(token),
        p_fields: fields,
      });
      if (error)
        fail(
          "Document changed or already has an invitation. Refresh before retrying.",
          409,
        );
      const link = `${appUrl.replace(/\/$/, "")}/#/sign/${token}`;
      let sent = false;
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resend}`,
            "Content-Type": "application/json",
            "Idempotency-Key": sid,
          },
          signal: AbortSignal.timeout(20000),
          body: JSON.stringify({
            from,
            to: [email],
            subject: "Ready Ready Motors — document ready to sign",
            text: `Ready Ready Motors, Inc. invites you to sign ${doc.title}.\n\n${link}\n\nThis private link expires in 72 hours and can be used to sign once. Do not forward it. If you did not expect this message, contact the sender.`,
            html: `<h2>Ready Ready Motors, Inc.</h2><p>Please review and sign <strong>${escapeHtml(doc.title)}</strong>.</p><p><a href="${escapeHtml(link)}">Review and sign document</a></p><p>Your private link expires in 72 hours and can be used to sign once. Do not forward it.</p>`,
          }),
        });
        if (!response.ok)
          fail(
            "Email delivery was not accepted. Verify the sender domain and provider settings.",
            502,
          );
        sent = true;
      } finally {
        // A timed-out email may still arrive: revoke its token before allowing resend.
        if (!sent) {
          const { error } = await db.rpc("revoke_signing_session", {
            p_document: doc.id,
            p_owner: user.id,
          });
          if (error) console.error("Failed invitation needs operator review");
        }
      }
      await audit(doc.id, "email_accepted_by_provider", email, sid);
      return json({ sent: true });
    }
    fail("Unknown action.", 404);
  } catch (e) {
    const status =
      e instanceof HttpError
        ? e.status
        : e instanceof ValidationError
          ? 400
          : 500;
    // Never send raw SDK/provider errors or log request bodies containing tokens.
    const safe =
      e instanceof HttpError || e instanceof ValidationError
        ? e.message
        : "Request could not be completed. Contact the sender or retry.";
    return json({ error: safe }, status);
  }
});
