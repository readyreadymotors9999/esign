# Ready Ready Motors eSign

A focused, two-party electronic signature MVP for Ready Ready Motors, Inc. React + TypeScript + Vite frontend on GitHub Pages; PDF.js page rendering; Supabase Auth, private Storage, Postgres and an Edge Function; server-side PDF completion using pdf-lib; email through Resend.

## What works

- Approved admins sign in with Supabase email/password, upload an unencrypted PDF (10 MB, 100 pages maximum), and place up to 50 signature/date fields on any page.
- Default company signer: **Lichen Wang**, `readyreadymotors9999@gmail.com`. The authenticated admin draws a signature and consents during preparation; the server applies that signature and UTC date before inviting the other signer. Both people require signature and date fields. The backend refuses to sign as Lichen from another admin email.
- Import a **private Google Doc** via browser Google OAuth as a PDF snapshot, or upload a PDF. Choose your own eSign filename at import and rename drafts later. The original Google Doc is never edited or made public.
- Save recipient first/last names and email in an owner-private address book. One external recipient per document, including `@qq.com`. An invitation expires in 72 hours. Admins can revoke an outstanding invitation and return the document to draft to send a replacement.
- Create a private share link **without sending email**, or send an email invitation **only to the external recipient**. Share links use the same 72-hour expiry, revocation and one-time completion rules; their raw token is shown only immediately after creation and is not recoverable from the database.
- Recipients review the PDF already signed by Lichen and sign on touch devices without registering. Their drawn signature fills only recipient fields; dates use the server's UTC date.
- A server-generated signed PDF includes a completion certificate. Private originals and signed PDFs remain in Supabase. Admins download signed PDFs and review timestamped audit events, signer consent/name, request IP metadata and SHA-256 hashes.
- Signing completion is claimed atomically; concurrent, expired, revoked and reused tokens cannot sign again.

## 1. Local frontend

Use Node.js 24 (see `.node-version`).

```sh
npm ci
cp .env.example .env.local
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your project's PUBLIC values.
npm run dev
```

Open the Vite address on your machine. Until Supabase is configured the app displays a setup message. An admin account must also be provisioned below. Environment changes require restarting Vite. Never use a service-role key as the public anon key.

```sh
npm test        # real Postgres (PGlite) policy/state-machine tests + validation/rotation tests
npm run build  # TypeScript + production assets
npm run preview

# Optional browser tests (Supabase/email are mocked):
npx playwright install chromium
npm run test:browser
# To use an installed browser: CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

The hash router (`/#/sign/TOKEN`) works with GitHub Pages without a 404 fallback. Use the existing isolated checkout for cloud tasks; there is no need to create a Git worktree.

## 2. Supabase database and private storage

Create a Supabase project. Install the [Supabase CLI](https://supabase.com/docs/guides/cli), authenticate through its documented workflow, then:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

This applies both migrations in `supabase/migrations/` (including `202610290002_two_party.sql` for recipients and prepared PDFs), creates the private `documents` bucket, tables, RLS and service-only transactional functions. Review SQL before applying to an existing project. The bucket name must be unused; this migration intentionally fails rather than silently reusing a bucket with unknown policies.

In Supabase Auth:

1. Disable public sign-ups; create/invite **`readyreadymotors9999@gmail.com`** as the admin user and set their password through Supabase's secure dashboard workflow.
2. Add that user's UUID through the SQL Editor (replace the example):

```sql
insert into public.admins(user_id) values ('YOUR_AUTH_USER_UUID');
```

Only enrolled admins can use admin endpoints. Documents are owned by the uploading admin; other admins do not automatically gain access. Recipients use signing capabilities and never receive database or storage permissions. Do not add public Storage policies or authenticated write policies to the application tables.

## 3. Resend and the Edge Function

**For share-link-only signing, skip Resend setup.** Only `APP_ORIGIN` and `APP_URL` are required in addition to Supabase’s automatically supplied keys. Email invitations require Resend. Resend is a transactional email delivery service, not a hosting provider.

Create a Resend account, verify a sending domain, and configure SPF/DKIM (and preferably DMARC). The provider's test sender can only email its allowed test recipients. Real QQ recipients require a verified production sender. QQ addresses are accepted without a domain allowlist; acceptance by Resend is **not** proof of mailbox delivery. Check Resend delivery/bounce logs and the recipient's spam folder. Follow QQ/provider sender reputation requirements if delivery is filtered.

Set these **server-only** Supabase Edge Function secrets in the dashboard or using `supabase secrets set --env-file /secure/path/esign-secrets.env`:

```dotenv
APP_ORIGIN=https://readyreadymotors9999.github.io
APP_URL=https://readyreadymotors9999.github.io/esign
EMAIL_FROM=Ready Ready Motors <signatures@your-verified-domain.com>
RESEND_API_KEY=YOUR_RESEND_SECRET
```

`APP_ORIGIN` contains only scheme and host, without a path or trailing slash. `APP_URL` includes the GitHub Pages repository path. For local development set `APP_ORIGIN=http://localhost:5173` and `APP_URL=http://localhost:5173` on a separate development project/function; a function accepts one exact browser origin at a time. Do not put secret files inside the repository. Supabase automatically supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed functions; do not copy these into frontend configuration.

```sh
supabase functions deploy esign --no-verify-jwt
```

`supabase/config.toml` also sets `verify_jwt = false`. This is intentional for account-free recipients. The function validates admin JWTs with `auth.getUser()` and checks membership on **every** admin action; public `session` and `complete` actions require the 256-bit invitation token. CORS is an additional browser restriction, not an authentication mechanism.

To type-check Edge code independently:

```sh
npm run check:edge
```

Deno imports are pinned; npm dependencies are checksummed in `package-lock.json`.

## 4. GitHub Pages deployment

In the GitHub repository:

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Settings → Secrets and variables → Actions → **Variables**, add:
   - `VITE_SUPABASE_URL`: `https://YOUR_PROJECT.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: your Supabase public anon key (or public publishable key).
   - `VITE_GOOGLE_CLIENT_ID`: optional public Google OAuth web client ID for Google Docs import (see below).
3. Push to `main` or run **Deploy eSign to GitHub Pages** under Actions.

The workflow installs the lockfile, runs tests and the production build, uploads the Pages artifact, and deploys with minimal permissions. The expected site is `https://readyreadymotors9999.github.io/esign/`. Hash-based signing URLs keep working on refresh. Missing public config produces an explicit setup screen rather than a broken app.

For a custom domain, update `BASE_PATH` in the workflow to `/`, then update the Edge secrets `APP_ORIGIN` and `APP_URL` to match. Rebuild after changing GitHub public variables. Do not store Resend or service-role secrets in Actions frontend variables, `VITE_*` names, or the compiled site.

## 5. Private Google Docs import

Google Docs import needs **Google Cloud configuration**, not Cloudflare or another web host:

1. In [Google Cloud Console](https://console.cloud.google.com/), create/select a project and enable the **Google Drive API**.
2. Configure Google Auth Platform / OAuth consent. The browser requests `https://www.googleapis.com/auth/drive.readonly` to export a document the chosen account can access. This grants read access to Drive; use an appropriate company account and review the consent screen. In Testing mode, add the admin's Google account as a test user. Publishing an external app with this sensitive scope may require Google's verification.
3. Create an OAuth Client ID of type **Web application**. Add `https://readyreadymotors9999.github.io` as an authorized JavaScript origin (host only, no `/esign` path). For development, add `http://localhost:5173`. The GIS token popup flow does not use an app redirect endpoint.
4. Put the **client ID**, not a client secret, in `VITE_GOOGLE_CLIENT_ID` locally and in GitHub Actions Variables. Rebuild the frontend.
5. In eSign choose **Import Google Doc**, provide a custom filename and a `https://docs.google.com/document/d/…/edit` link, then **Connect Google → Authorize & import PDF**. Allow popups if your browser blocks the Google window.

The access token is used transiently in the browser to export through the Drive API. It is never sent to the eSign backend, stored in localStorage, or written to the database. Export respects Google account access/download restrictions and Google's 10 MB export limit. An imported PDF is a snapshot: later Doc edits are not synchronized. If you do not configure Google OAuth, **File → Download → PDF** in Google Docs followed by PDF upload remains available.

## 6. Acceptance check with your services

Run this before sending customer documents:

1. Sign in as an enrolled admin. Confirm a non-admin Auth user is denied access.
2. Upload a multi-page PDF, including a rotated page, with a custom filename. Place a signature and date field for **Lichen Wang** and another signature/date pair for **Recipient**. Draw Lichen’s signature, consent, enter/save a recipient, choose email delivery, and send to a real QQ mailbox you control. Confirm the email arrives and contains your exact deployed Pages URL.
3. Open the emailed link on a phone and verify Lichen’s signature is already present. Review every page, enter a full name, draw a signature, check consent, and submit.
4. Confirm the admin sees `completed`, downloads the PDF, and verifies placement/date/certificate and `document signed` in the audit trail.
5. Refresh/reopen the signing URL and attempt a second submission. Both must fail. Confirm the private bucket has no public reads.
6. Repeat using **Create share link (no email)** with Resend secrets absent; copy/open the link and verify both signatures survive finalization. Test private Google Doc import with the authorized account and a custom filename.
7. Test revocation and expiry using a disposable document. To exercise expiry in the SQL Editor, set its **pending** session's `expires_at` to a past timestamp; never alter a real completed session.

Live email, Supabase authentication/storage and deployed signing must be validated against your project; local tests do not establish external service readiness.

## Security model and operational limits

- Only a SHA-256 token hash is stored. Tokens contain 32 random bytes and travel in URL fragments to avoid ordinary HTTP access logs and referrers. They are bearer credentials: anyone with the link can sign. No recipient identity verification, SMS, or arbitrary multi-party routing is included. Lichen is authenticated as the enrolled Supabase admin; the external signer is authenticated by possession of the private link, whether emailed or shared. Do not treat this as a qualified digital signature or verified identity service.
- Private, 60-second Storage URLs are issued after authorization. They remain usable until their short expiry even if an invitation is revoked/completed. Do not share URLs. Browser recipients necessarily receive the prepared, company-signed PDF while reviewing it. They see only their own empty field overlays; finalization never reapplies their signature to company fields.
- The server stores a separate, immutable company-signed PDF per preparation attempt; the original stays intact. Company signature consent, timestamp, email and prepared/original hashes are recorded atomically with the invitation. Revoking returns to the original for a fresh preparation; old signed revisions remain private for audit/reconciliation. Ambiguous preparation transactions can leave private orphan files, which must be reconciled before cleanup.
- Original uploads are immutable to clients and only allowed at an owner-specific, server-reserved path. Only server code can generate signed documents or mutate workflow/audit tables. Audit rows are append-only to application users; Supabase project operators retain privileged access.
- The function does not log tokens, PDF data or provider secrets. Audit records contain personal data; establish retention, access and backup policies. `x-forwarded-for` is recorded as request metadata and depends on Supabase's proxy trust; it is not proof of signer identity.
- Email API acceptance is recorded separately from signing. On send failure/timeout the token is revoked when possible. Refresh the document before retrying. If an email arrives after timeout, its revoked link will not sign.
- Completing claims a session as `processing`. Before a PDF has been stored, a processing failure can restore it to pending. After storage succeeds, an ambiguous database failure leaves it processing to avoid replay. An operator must inspect DB and Storage, reconcile the audit/transaction, and recover it; do not blindly reset processing or completed rows. Automatic crash recovery is outside this MVP.
- No malware scanning, OCR, templates, recipient download portal, advanced admin management, billing, automatic cleanup, or provider webhook handling. Failed uploads can leave `uploading` metadata/objects; an operator can remove these after confirming they are abandoned. For production, add infrastructure rate limits/monitoring and a reviewed retention/recovery process before higher-volume use.
- PDFs must be unencrypted. PDF rendering is local in PDF.js; the server applies signatures with pdf-lib and preserves crop/rotation placement. Test representative customer documents. The app does not remove existing PDF active content or guarantee preservation of existing cryptographic signatures; do not upload already digitally signed files.
- Legal enforceability and required consent/retention vary by jurisdiction and transaction type. Have your counsel review the workflow for vehicle sales and financing requirements.

## Repository layout

- `src/`: frontend admin, private Google Docs export, PDF field editor and mobile signing page.
- `supabase/migrations/`: tables, RLS, private bucket and atomic signing state transitions.
- `supabase/functions/esign/`: authenticated admin and token-based signing API, Resend email, server PDF generation.
- `supabase/functions/_shared/`: tested field/token validation and PDF coordinate transforms.
- `.github/workflows/pages.yml`: frontend build/test/deploy.
- `tests/`: input validation, rotated page placement and database permission/replay tests.

## Credentials and hosting in plain language

- **GitHub Pages** hosts the static frontend at `github.io`; no Cloudflare account or server is needed.
- **Supabase** requires your own account/project for Auth, private Storage, database and Edge Functions. The browser needs only the **public project URL and anon/publishable key**. Service-role keys stay inside Supabase; deployed functions receive them automatically. Do not send a Supabase personal access token or service-role secret in chat. If an operator automates CLI deployment, supply its credentials through a secure secret binding, never a committed file.
- **Resend** delivers invitation emails from a verified sending domain. It is optional if you use share links. Its API key belongs only in Supabase Edge Function secrets. A verified sending domain needs DNS setup with your current domain/DNS provider; using Cloudflare specifically is optional.
- **Google OAuth** is optional for private Docs import. Only the public web Client ID belongs in frontend variables; no Google client secret is used by this browser flow.
