# Ready Ready Motors eSign

A focused, single-recipient electronic signature MVP for Ready Ready Motors, Inc. React + TypeScript + Vite frontend on GitHub Pages; PDF.js page rendering; Supabase Auth, private Storage, Postgres and an Edge Function; server-side PDF completion using pdf-lib; email through Resend.

## What works

- Approved admins sign in with Supabase email/password, upload an unencrypted PDF (10 MB, 100 pages maximum), and place up to 50 signature/date fields on any page.
- One recipient per document, including `@qq.com`. An invitation expires in 72 hours. Admins can revoke an outstanding invitation and return the document to draft to send a replacement.
- Recipients review and sign on touch devices without registering. Drawn signatures fill all signature fields; dates use the server's UTC date.
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

This applies `supabase/migrations/202610290001_esign.sql`, creates the private `documents` bucket, tables, RLS and service-only transactional functions. Review SQL before applying to an existing project. The bucket name must be unused; this migration intentionally fails rather than silently reusing a bucket with unknown policies.

In Supabase Auth:

1. Disable public sign-ups; create/invite an admin user and set their password through Supabase's secure dashboard workflow.
2. Add that user's UUID through the SQL Editor (replace the example):

```sql
insert into public.admins(user_id) values ('YOUR_AUTH_USER_UUID');
```

Only enrolled admins can use admin endpoints. Documents are owned by the uploading admin; other admins do not automatically gain access. Recipients use signing capabilities and never receive database or storage permissions. Do not add public Storage policies or authenticated write policies to the application tables.

## 3. Resend and the Edge Function

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
3. Push to `main` or run **Deploy eSign to GitHub Pages** under Actions.

The workflow installs the lockfile, runs tests and the production build, uploads the Pages artifact, and deploys with minimal permissions. The expected site is `https://readyreadymotors9999.github.io/esign/`. Hash-based signing URLs keep working on refresh. Missing public config produces an explicit setup screen rather than a broken app.

For a custom domain, update `BASE_PATH` in the workflow to `/`, then update the Edge secrets `APP_ORIGIN` and `APP_URL` to match. Rebuild after changing GitHub public variables. Do not store Resend or service-role secrets in Actions frontend variables, `VITE_*` names, or the compiled site.

## 5. Acceptance check with your services

Run this before sending customer documents:

1. Sign in as an enrolled admin. Confirm a non-admin Auth user is denied access.
2. Upload a multi-page PDF, including a rotated page. Place signature/date fields on different pages and send to a real QQ mailbox you control. Confirm the email arrives and contains your exact deployed Pages URL.
3. Open the emailed link on a phone. Review every page, enter a full name, draw a signature, check consent, and submit.
4. Confirm the admin sees `completed`, downloads the PDF, and verifies placement/date/certificate and `document signed` in the audit trail.
5. Refresh/reopen the signing URL and attempt a second submission. Both must fail. Confirm the private bucket has no public reads.
6. Test revocation and expiry using a disposable document. To exercise expiry in the SQL Editor, set its **pending** session's `expires_at` to a past timestamp; never alter a real completed session.

Live email, Supabase authentication/storage and deployed signing must be validated against your project; local tests do not establish external service readiness.

## Security model and operational limits

- Only a SHA-256 token hash is stored. Tokens contain 32 random bytes and travel in URL fragments to avoid ordinary HTTP access logs and referrers. They are bearer credentials: anyone with the link can sign. No identity verification, SMS, or multi-party routing is included. Do not treat this as a qualified digital signature or verified identity service.
- Private, 60-second Storage URLs are issued after authorization. They remain usable until their short expiry even if an invitation is revoked/completed. Do not share URLs. Browser recipients necessarily receive the original PDF while reviewing it.
- Original uploads are immutable to clients and only allowed at an owner-specific, server-reserved path. Only server code can generate signed documents or mutate workflow/audit tables. Audit rows are append-only to application users; Supabase project operators retain privileged access.
- The function does not log tokens, PDF data or provider secrets. Audit records contain personal data; establish retention, access and backup policies. `x-forwarded-for` is recorded as request metadata and depends on Supabase's proxy trust; it is not proof of signer identity.
- Email API acceptance is recorded separately from signing. On send failure/timeout the token is revoked when possible. Refresh the document before retrying. If an email arrives after timeout, its revoked link will not sign.
- Completing claims a session as `processing`. Before a PDF has been stored, a processing failure can restore it to pending. After storage succeeds, an ambiguous database failure leaves it processing to avoid replay. An operator must inspect DB and Storage, reconcile the audit/transaction, and recover it; do not blindly reset processing or completed rows. Automatic crash recovery is outside this MVP.
- No malware scanning, OCR, templates, recipient download portal, advanced admin management, billing, automatic cleanup, or provider webhook handling. Failed uploads can leave `uploading` metadata/objects; an operator can remove these after confirming they are abandoned. For production, add infrastructure rate limits/monitoring and a reviewed retention/recovery process before higher-volume use.
- PDFs must be unencrypted. PDF rendering is local in PDF.js; the server applies signatures with pdf-lib and preserves crop/rotation placement. Test representative customer documents. The app does not remove existing PDF active content or guarantee preservation of existing cryptographic signatures; do not upload already digitally signed files.
- Legal enforceability and required consent/retention vary by jurisdiction and transaction type. Have your counsel review the workflow for vehicle sales and financing requirements.

## Repository layout

- `src/`: frontend admin, PDF field editor and mobile signing page.
- `supabase/migrations/`: tables, RLS, private bucket and atomic signing state transitions.
- `supabase/functions/esign/`: authenticated admin and token-based signing API, Resend email, server PDF generation.
- `supabase/functions/_shared/`: tested field/token validation and PDF coordinate transforms.
- `.github/workflows/pages.yml`: frontend build/test/deploy.
- `tests/`: input validation, rotated page placement and database permission/replay tests.
