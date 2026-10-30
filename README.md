# Ready Ready eSign

**Live app: [Open Ready Ready Motors eSign](https://readyreadymotors9999.github.io/esign/)**

A focused, two-party electronic signature MVP for Ready Ready Motors, Inc. React + TypeScript + Vite frontend on GitHub Pages; PDF.js page rendering; Supabase Auth, private Storage, Postgres and an Edge Function; server-side PDF completion using pdf-lib; email through the Gmail API from `readyreadymotors9999@gmail.com`.

## What works

- Approved admins sign in with Supabase email/password, upload an unencrypted PDF (10 MB, 100 pages maximum), and place up to 50 signature/date fields on any page.
- Default company signer: **Lichen Wang**, `readyreadymotors9999@gmail.com`. The authenticated admin types or draws a signature and consents during preparation; the server applies that signature and the current Los Angeles business date before inviting the other signer. Both people require signature and date fields. The backend refuses to sign as Lichen from another admin email.
- Import a **private Google Doc** via browser Google OAuth as a PDF snapshot, or upload a PDF. Choose your own eSign filename at import and rename drafts later. The original Google Doc is never edited or made public.
- Save recipient first/last names and email in an owner-private address book. One external recipient per document, including `@qq.com`. An invitation expires in 72 hours. Admins can revoke an outstanding invitation and return the document to draft to send a replacement.
- Create a private share link **without sending email**, or send an email invitation **only to the external recipient**. Share links use the same 72-hour expiry, revocation and one-time completion rules; their raw token is shown only immediately after creation and is not recoverable from the database.
- Recipients review the PDF already signed by Lichen and sign on touch devices without registering. They choose a typed-name signature (with an exact image preview) or draw by finger/mouse/stylus. Their chosen signature fills only recipient fields; dates use the server's current Los Angeles business date in MM/DD/YYYY format.
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

This applies all migrations in `supabase/migrations/` (including `202610290002_two_party.sql` for recipients and prepared PDFs), creates the private `documents` bucket, tables, RLS and service-only transactional functions. Review SQL before applying to an existing project. The bucket name must be unused; this migration intentionally fails rather than silently reusing a bucket with unknown policies.

In Supabase Auth:

1. Disable public sign-ups; create/invite **`readyreadymotors9999@gmail.com`** as the admin user and set their password through Supabase's secure dashboard workflow.
2. Add that user's UUID through the SQL Editor (replace the example):

```sql
insert into public.admins(user_id) values ('YOUR_AUTH_USER_UUID');
```

Only enrolled admins can use admin endpoints. Documents are owned by the uploading admin; other admins do not automatically gain access. Recipients use signing capabilities and never receive database or storage permissions. Do not add public Storage policies or authenticated write policies to the application tables.

## 3. Gmail and the Edge Function

Invitations are sent **from `readyreadymotors9999@gmail.com` through Gmail API**. No Resend account, DNS change, custom domain, or Gmail password is required. The backend holds the refresh token and automatically refreshes short-lived access tokens. Both sender and reply address are fixed to the company Gmail account. Only an authenticated, enrolled company admin can initiate sending; public recipients cannot send mail.

### One-time Gmail authorization on your own computer

1. In [Google Cloud Console](https://console.cloud.google.com/), create/select a project and **enable Gmail API**.
2. Configure **Google Auth Platform / OAuth consent**. Request `openid`, `email`, and `https://www.googleapis.com/auth/gmail.send`. This grants sending plus basic account identification, not mailbox reading. If the app is in Testing, add `readyreadymotors9999@gmail.com` as a test user. Follow Google's publishing/verification requirements for long-term production use. Testing refresh tokens with Gmail scopes may expire after seven days; reauthorize if this happens. Revocation/account-policy changes can also require reconnection.
3. Create an OAuth client of type **Desktop app**. Download its client JSON to a private location **outside this repository**. This client is for the local authorization helper; it is separate from the Web client used for optional Google Docs import.
4. With Node.js 24 installed, run this on your own computer from the checked-out repository:

```sh
node scripts/connect-gmail.mjs \
  --client /private/path/client_secret_download.json \
  --output /private/path/gmail-secrets.env
```

The helper prints a Google authorization URL. Open it, select **readyreadymotors9999@gmail.com**, and approve sending permission. A temporary localhost callback receives the authorization code with state and PKCE checks. The helper verifies the account and writes `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN` to a new file with owner-only permissions. It does not print these values and refuses to overwrite an existing file. Do not commit the file, put it in frontend variables, or send it in chat. For renewed authorization choose a new private output filename.

5. Import that file into **Supabase → Edge Functions → Secrets**, or run:

```sh
supabase secrets set --env-file /private/path/gmail-secrets.env
```

Also configure these non-secret server values:

```dotenv
APP_ORIGIN=https://readyreadymotors9999.github.io
APP_URL=https://readyreadymotors9999.github.io/esign
```

For share-link-only signing, skip Gmail authorization; only `APP_ORIGIN` and `APP_URL` are needed in addition to Supabase's automatically supplied keys. Gmail credentials are checked only for email invitations. The old `RESEND_API_KEY` and `EMAIL_FROM` settings are no longer read and can be removed from Supabase after migration.

`APP_ORIGIN` is scheme and host only, without a path or trailing slash. `APP_URL` includes `/esign`. For local frontend development use `http://localhost:5173` for both on a separate development project/function. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed functions; do not copy those keys to frontend configuration.

Apply the database migrations in section 2, then deploy:

```sh
supabase functions deploy esign --no-verify-jwt
npm run check:edge
```

`verify_jwt = false` is intentional for account-free recipients. Every admin action validates its Supabase JWT with `auth.getUser()` and checks explicit admin membership. Public `session` and `complete` actions require the high-entropy signing token. CORS is an additional browser restriction, not authentication.

### Sending behavior and limits

After Lichen signs and clicks **Sign & email recipient**, the server refreshes Gmail authorization and verifies the sender **before** creating a new invitation. It signs the prepared PDF, creates the recipient's one-time session, and sends a UTF-8 multipart email through `users.messages.send`. The message contains the private signing link, not a customer PDF attachment. QQ addresses are accepted. Gmail's message ID is saved in the audit trail; acceptance by Gmail is not proof of inbox delivery. Check the sending Gmail's Sent folder, bounces, and recipient spam folder during acceptance testing.

Gmail API calls are subject to both API quotas and the Gmail account's actual sending/recipient limits and abuse controls. No fixed daily allowance is guaranteed by this app. A failed refresh requires reconnecting the account. A quota/permission error is reported without exposing tokens. On failed or ambiguous sends, the invitation is revoked where possible; Gmail has no send idempotency guarantee, so the app never automatically retries the send. If a delayed email arrives after revocation, its signing link is invalid. Refresh before manually retrying.

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

For a custom domain, update `BASE_PATH` in the workflow to `/`, then update the Edge secrets `APP_ORIGIN` and `APP_URL` to match. Rebuild after changing GitHub public variables. Do not store Gmail refresh tokens/client secrets or service-role secrets in Actions frontend variables, `VITE_*` names, or the compiled site.

## 5. Private Google Docs import

Google Docs import needs **Google Cloud configuration**, not Cloudflare or another web host:

1. In [Google Cloud Console](https://console.cloud.google.com/), create/select a project and enable the **Google Drive API**.
2. Configure Google Auth Platform / OAuth consent. The browser requests `https://www.googleapis.com/auth/drive.readonly` to export a document the chosen account can access. This grants read access to Drive; use an appropriate company account and review the consent screen. In Testing mode, add the admin's Google account as a test user. Publishing an external app with this sensitive scope may require Google's verification.
3. Create an OAuth Client ID of type **Web application**. Add `https://readyreadymotors9999.github.io` as an authorized JavaScript origin (host only, no `/esign` path). For development, add `http://localhost:5173`. The GIS token popup flow does not use an app redirect endpoint.
4. Keep the existing **Desktop app** client used for Gmail sending. This is a second, separate **Web application** client. Copy its public **Client ID** (ending in `.apps.googleusercontent.com`) to GitHub **Settings → Environments → github-pages → Environment variables**, named `VITE_GOOGLE_CLIENT_ID`. Do not paste its client secret or JSON file. For local development set the same variable in `.env.local`. Run the complete **Deploy eSign to GitHub Pages** workflow again so the frontend is rebuilt; retrying only the deploy job reuses the old assets and will not apply the new value.
5. In eSign choose **Import Google Doc**, provide a custom filename and a `https://docs.google.com/document/d/…/edit` link, then **Connect Google → Authorize & import PDF**. Allow popups if your browser blocks the Google window.

The access token is used transiently in the browser to export through the Drive API. It is never sent to the eSign backend, stored in localStorage, or written to the database. Export respects Google account access/download restrictions and Google's 10 MB export limit. An imported PDF is a snapshot: later Doc edits are not synchronized. If you do not configure Google OAuth, **File → Download → PDF** in Google Docs followed by PDF upload remains available.

## 6. Acceptance check with your services

Run this before sending customer documents:

1. Sign in as an enrolled admin. Confirm a non-admin Auth user is denied access.
2. Upload a multi-page PDF, including a rotated page, with a custom filename. Place a signature and date field for **Lichen Wang** and another signature/date pair for **Recipient**. Type or draw Lichen’s signature, consent, enter/save a recipient, choose email delivery, and send to a real QQ mailbox you control. Confirm the email arrives and contains your exact deployed Pages URL.
3. Open the emailed link on a phone and verify Lichen’s signature is already present. Review every page, enter a full name, type or draw a signature, check consent, and submit.
4. Confirm the admin sees `completed`, downloads the PDF, and verifies placement/date/certificate and `document signed` in the audit trail.
5. Refresh/reopen the signing URL and attempt a second submission. Both must fail. Confirm the private bucket has no public reads.
6. Repeat using **Create share link (no email)** with Gmail secrets absent; copy/open the link and verify both signatures survive finalization. Test private Google Doc import with the authorized account and a custom filename.
7. Test revocation and expiry using a disposable document. To exercise expiry in the SQL Editor, set its **pending** session's `expires_at` to a past timestamp; never alter a real completed session.

Live email, Supabase authentication/storage and deployed signing must be validated against your project; local tests do not establish external service readiness.

## Security model and operational limits

- Only a SHA-256 token hash is stored. Tokens contain 32 random bytes and travel in URL fragments to avoid ordinary HTTP access logs and referrers. They are bearer credentials: anyone with the link can sign. No recipient identity verification, SMS, or arbitrary multi-party routing is included. Lichen is authenticated as the enrolled Supabase admin; the external signer is authenticated by possession of the private link, whether emailed or shared. Do not treat this as a qualified digital signature or verified identity service.
- Private, 60-second Storage URLs are issued after authorization. They remain usable until their short expiry even if an invitation is revoked/completed. Do not share URLs. Browser recipients necessarily receive the prepared, company-signed PDF while reviewing it. They see only their own empty field overlays; finalization never reapplies their signature to company fields.
- The server stores a separate, immutable company-signed PDF per preparation attempt; the original stays intact. Company signature consent, timestamp, email and prepared/original hashes are recorded atomically with the invitation. Revoking returns to the original for a fresh preparation; old signed revisions remain private for audit/reconciliation. Ambiguous preparation transactions can leave private orphan files, which must be reconciled before cleanup.
- Original uploads are immutable to clients and only allowed at an owner-specific, server-reserved path. Only server code can generate signed documents or mutate workflow/audit tables. Audit rows are append-only to application users; Supabase project operators retain privileged access.
- Both typed and drawn signatures are converted to the same fixed-size PNG in the browser, embedded server-side, and covered by the same consent and one-time completion checks. The selected method is recorded in the audit metadata and completion certificate. A typed signature is not an identity verification mechanism. Changing signature modes or clearing the preview invalidates the prior signature until a new one is supplied.
- The function does not log tokens, PDF data or provider secrets. Audit records contain personal data; establish retention, access and backup policies. `x-forwarded-for` is recorded as request metadata and depends on Supabase's proxy trust; it is not proof of signer identity.
- Email API acceptance is recorded separately from signing. On send failure/timeout the token is revoked when possible. Refresh the document before retrying. If an email arrives after timeout, its revoked link will not sign.
- Completing claims a session as `processing`. Before a PDF has been stored, a processing failure can restore it to pending. After storage succeeds, an ambiguous database failure leaves it processing to avoid replay. An operator must inspect DB and Storage, reconcile the audit/transaction, and recover it; do not blindly reset processing or completed rows. Automatic crash recovery is outside this MVP.
- No malware scanning, OCR, templates, recipient download portal, advanced admin management, billing, automatic cleanup, or provider webhook handling. Failed uploads can leave `uploading` metadata/objects; an operator can remove these after confirming they are abandoned. For production, add infrastructure rate limits/monitoring and a reviewed retention/recovery process before higher-volume use.
- PDFs must be unencrypted. PDF rendering is local in PDF.js; the server applies signatures with pdf-lib and preserves crop/rotation placement. Test representative customer documents. The app does not remove existing PDF active content or guarantee preservation of existing cryptographic signatures; do not upload already digitally signed files.
- Legal enforceability and required consent/retention vary by jurisdiction and transaction type. Have your counsel review the workflow for vehicle sales and financing requirements.

## Repository layout

- `src/`: frontend admin, private Google Docs export, PDF field editor and mobile signing page.
- `supabase/migrations/`: tables, RLS, private bucket and atomic signing state transitions.
- `supabase/functions/esign/`: authenticated admin and token-based signing API, Gmail email, server PDF generation.
- `supabase/functions/_shared/`: tested field/token validation and PDF coordinate transforms.
- `.github/workflows/pages.yml`: frontend build/test/deploy.
- `tests/`: input validation, rotated page placement and database permission/replay tests.

## Credentials and hosting in plain language

- **GitHub Pages** hosts the static frontend at `github.io`; no Cloudflare account or server is needed.
- **Supabase** requires your own account/project for Auth, private Storage, database and Edge Functions. The browser needs only the **public project URL and anon/publishable key**. Service-role keys stay inside Supabase; deployed functions receive them automatically. Do not send a Supabase personal access token or service-role secret in chat. If an operator automates CLI deployment, supply its credentials through a secure secret binding, never a committed file.
- **Gmail API** delivers invitation emails directly from the company Gmail account. One-time owner authorization generates server-only credentials, stored in Supabase Edge Function secrets. No domain/DNS management or Gmail password is needed. Gmail authorization is optional for share-link-only use.
- **Google OAuth** is optional for private Docs import. Only the public web Client ID belongs in frontend variables; no Google client secret is used by this browser flow.

## This project's Supabase connection

The provided public project URL is `https://nyjhgexemcxfncoepudy.supabase.co` (also in `.env.example`). Find the **publishable key** under your Supabase project's **Settings → API Keys**. A legacy public `anon` key also works. Do not use a secret/service-role key.

GitHub **repository Settings → Secrets and variables → Actions → Variables** (not Pages settings):

| Variable                 | Value                                                   |
| ------------------------ | ------------------------------------------------------- |
| `VITE_SUPABASE_URL`      | `https://nyjhgexemcxfncoepudy.supabase.co`              |
| `VITE_SUPABASE_ANON_KEY` | Your public `sb_publishable_…` key (or legacy anon key) |
| `VITE_GOOGLE_CLIENT_ID`  | Optional public Google OAuth web Client ID              |

GitHub **Settings → Pages → Source → GitHub Actions** enables frontend hosting. These repository settings require the appropriate GitHub App/owner permissions; Git push access alone does not grant them.

Supabase **Edge Functions → Secrets** stores `APP_ORIGIN`, `APP_URL`, and (only for email invitations) `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN`. Supabase supplies its service-role key to deployed Edge Functions automatically. Do not add service-role/secret keys, personal access tokens, or database passwords to frontend `VITE_*` variables. Creating the Supabase project is the first step: apply all SQL migrations, deploy the Edge Function, and enroll the admin account before live signing can work.

The build job also targets the `github-pages` Environment. If you already added `VITE_SUPABASE_URL` under **Settings → Environments → github-pages → Environment variables** and the public `VITE_SUPABASE_ANON_KEY` under **Environment secrets**, that layout is supported. The build accepts the public key from Variables or Secrets (Variables take precedence). Treating it as a GitHub secret does not make it private in the published frontend. No service-role/secret key may be used here.

## Draft PDF page editing

Opening a document hides the document list and opens a dedicated editor. The filename, instructions, signer, fields and page controls live in a left toolbar; the PDF/signing panel scrolls independently. On narrow screens the toolbar appears above the PDF with its own scroll area. Use **Back to documents** to return to the list. Clicking a company signature field opens a Type/Draw dialog with explicit acceptance. The accepted image previews in all company signature fields in the current document. Date fields preview today as MM/DD/YYYY. Each selected field has a signer selector and settings menu with Duplicate/Delete; there are no overlapping Copy/Cut actions. Clicking a field does not delete it.

Draft-only PDF editing supports deleting a selected page or a custom range such as `1-3, 4, 7`, inserting a blank page after it, appending another unencrypted PDF, and replacing the PDF. Limits remain 100 pages and 10 MB. This edits page structure, not existing PDF text or graphics.

Edits save immediately as a new private Storage object. Deleting pages removes their fields and renumbers later fields; blank-page insertion shifts later fields; append preserves layouts; replacement clears all fields. Every PDF change clears the current company signature and consent so the edited version must be reviewed and signed again. Previously sent/completed documents are locked; revoke an outstanding invitation to return to a draft before editing. Prior file revisions remain private for audit/reconciliation; there is no revision-restore UI in this MVP.

Deploy this update's backend before using the new editor:

```sh
npx supabase db push
npx supabase functions deploy esign --no-verify-jwt --use-api
```

`202610300001_draft_pdf_editing.sql` adds service-only, version-checked draft edits and prevents issuing an invitation from an obsolete source PDF. No new secrets are needed. If another tab edits the draft or issues an invitation first, the stale operation fails and the admin must refresh. Storage uploads whose database commit is ambiguous are retained for operator reconciliation; do not delete referenced revisions blindly.

The approved eSign app icon is stored in `public/esign-icon.png` and used in the site header and browser icon, with the wordmark **Ready Ready eSign** and attribution **by Ready Ready Motors, Inc.** The original company logo remains available at `public/r_logo.jpg`. Both images are served locally using the Vite base path, including on GitHub Pages.

### Custom page ranges backend update

Custom ranges accept individual pages and ascending inclusive ranges separated by commas. Duplicate/overlapping pages are counted once, invalid/out-of-bounds entries fail before editing, and deleting every page is refused. The confirmation shows the exact page numbers. Deleted-page fields are removed and surviving field page numbers are updated.

If the previous PDF editing migration is already deployed, this update needs only a fresh `esign` Edge Function deployment from the latest source; no additional SQL migration or Gmail reauthorization is needed:

```sh
npx supabase functions deploy esign --no-verify-jwt --use-api
```

The frontend displays custom range controls only when the backend reports support. **Replace entire PDF** replaces the whole draft and clears its fields/current company signature; **Append PDF** adds all pages of another PDF at the end while retaining existing fields.

## Field-based signing and recipient management

The editor's fixed toolbar contains signer/contact details and delivery controls. Select the signer before placing fields, or select any existing field and use its adjacent signer dropdown to reassign that field. Reassignment immediately updates which preview it displays. Use the gear menu to Duplicate or Delete. Duplicate creates a new field on the same page with a small positional offset; it retains the original type and signer.

Click a **Lichen Wang signature field** to open Type/Draw, review the preview, click **Add signature**, and apply it across all company signature fields. The choice is remembered only within the current document editing session; nothing is stored in browser localStorage. Canceling an edit keeps the prior accepted signature. PDF page edits reset it and require acceptance again. External recipients also open their signature dialog from their PDF field. Neither dialog submits the document by itself; the admin's Send or recipient's final Agree & sign action saves the signed PDF.

Dates are generated from the server clock in `America/Los_Angeles`, formatted `MM/DD/YYYY`; users cannot enter a custom date. The browser refreshes its date preview periodically. A stale submitted preview date is rejected before a signing session is claimed, so the signer can review again. ISO UTC timestamps remain in audit/certificate records for precise event timing.

New recipient information is automatically saved to the owner's private address book on Send. Select a saved contact to edit its name/email, and choose **Update recipient** to save immediately, or Send to save as part of that workflow. Updating by contact ID checks owner identity; an email already used by another contact returns a conflict instead of silently overwriting that contact. Contact edits do not change previously issued invitations.

This update needs a fresh `esign` Edge Function deployment from the latest source for date formatting, stale-date checks and automatic contact updates. No additional SQL migration, Gmail reconnection, or new secret is required.


### Reopen invitations and move fields

Choose **Edit document & resend** on any sent, unfinished document. Confirmation invalidates its pending or in-progress signing session and clears all active signature/date values, including Lichen Wang’s. The original PDF and field layout remain editable. Accept a fresh company signature/date and Send to create a new invitation; old links cannot sign. Completed documents cannot reopen. Completion and reopening are serialized in the database; if completion commits first, editing is refused. Immutable PDF revisions and historical audit events remain private for traceability.

Choose a saved recipient or enter a new contact above the field tools. The field-signer menu also lists saved contacts. Recipient fields cannot be placed until a name and email are provided. Drag existing fields to move them; a click opens the signature dialog. New signature boxes use 25% of the page width and 4% of its height; date boxes use 14% and 2.8%. Their placeholders read only Signature or Date. Existing field layouts retain their dimensions.

**Deploy this update from the latest repository checkout:**

```sh
npx supabase db push
npx supabase functions deploy esign --no-verify-jwt --use-api
```

This applies `202610300002_reopen_signing.sql` before deploying the matching function. Gmail credentials do not change. The frontend deploys automatically through GitHub Actions after push to main.


### Preview and preparation controls

The left toolbar starts at 400px on desktop. Drag the separator to resize it, or focus the separator and use Left/Right arrows; Home restores 400px. Small screens retain the stacked layout. Contact inputs and toolbar actions use compact controls; recipient details remain hidden until adding or editing through the signer menu.

Use the bottom-right PDF slider or −/+ buttons for **50%–200%** zoom; click the percentage to reset to 100%. Trackpad pinch gestures over the PDF also zoom the preview (Ctrl+wheel on browsers that expose pinch as a wheel event, Safari gesture events supported). Normal two-finger scrolling continues to scroll. Field positions stay relative to the PDF and do not change when zooming. Rendering still adapts to display pixel density within a canvas memory limit.

Signature dialogs default to **Type signature**. **Add signature** applies the displayed signature to the signer's fields without a separate dialog checkbox; the dialog explains this action. The server still records consent, and recipients still have the final document submission confirmation. This frontend update needs no Supabase migration or function redeployment.


### Explicit single-field placement

Choose the signer, then click **Signature** or **Date** to arm one field placement. Both buttons start unselected. Click a position on the PDF to place that field; both buttons return to unselected immediately. Ordinary blank-page clicks never add fields, and there is no separate Add field button. **Cancel placement**, Escape, or clicking the selected type again cancels; changing signer or opening a field also exits placement. Duplicate remains an explicit field-menu action.

Typed signatures use larger text and fit the actual ink into the existing 900×240 signature image with small margins. This increases their size in both the PDF preview and the final PDF without changing the backend image format. Existing completed PDFs remain unchanged; accept the updated typed signature before sending a new invitation. This frontend update requires no Supabase changes.


### Centered signature placement

Signature images are centered horizontally and vertically inside their fields in both the browser preview and the generated PDF, including rotated pages. Existing completed PDFs are immutable and are not regenerated. To update final PDF generation from the latest checkout, deploy the Edge Function:

```sh
npx supabase functions deploy esign --no-verify-jwt --use-api
```

No database migration is needed for this centering change. The frontend deploys automatically after push to main.

### Home navigation and account recipients

Click the logo or wordmark to return to the documents dashboard, including when the editor is already at the home hash. **Account settings → Recipients** lists the current admin's saved contacts and supports search, add, edit and confirmed delete. Server-side deletes validate admin authentication and match both contact ID and owner ID. Contact changes/deletion do not modify existing invitations, signed PDFs or audit records.

In the document editor, **Add new recipient / Edit recipient** opens the contact form directly under the Field signer selector. Save/Update closes the form. The redundant New recipient button is removed; the signer dropdown lists the current recipient only once, with name and email, rather than repeating the matching saved contact.

When placing a field, a dashed outline follows the mouse or hovering stylus. Preview and click share the same normalized position/size calculation and page-edge clamping. The outline disappears after placement, cancellation or leaving the page; touch devices continue to place with a tap.

Deploy the latest Edge Function to enable contact deletion; existing recipient storage needs no SQL migration:

```sh
npx supabase functions deploy esign --project-ref nyjhgexemcxfncoepudy --no-verify-jwt --use-api
```

### Loading feedback and selected-recipient editing

Document tab counts show **—** until the first successful list request, rather than a misleading zero. A spinner and Loading documents message replace the empty-state card during this request. Refresh keeps the existing rows and counts while showing Refreshing documents; an actual empty state appears only after a successful response. Returning home immediately reuses the current list/counts and synchronizes silently in the background. Request failures keep any previously loaded list.

Opening a document shows feedback while its metadata loads. PDF download and rendering show Loading PDF plus page placeholders until drawing finishes; field placement is enabled after every page renders. Resizing and zooming keep already rendered content visible while improving its resolution.

The signer dropdown contains recipient choices and Add new recipient, without separate Edit entries. Select any recipient to reveal **Edit recipient** beneath the dropdown. The inline editor has one close control and no Done button. Save/Update uses green with white text when enabled and a muted disabled style until the required information is valid. Field placement retains the dashed cursor preview with a normal mouse cursor.

This is a frontend-only update: no new SQL migration or Edge Function deployment is required.


### Immediate returns and consistent focus styling

Returning from the document editor via either Back to documents or the logo preserves the mounted workspace and its loaded document list/counts. Returning from Account settings uses an account-scoped in-memory snapshot before revalidating. Background refreshes update the list without a loading reset; manual Refresh still shows progress while preserving rows. Requests superseded by newer requests or navigation cannot reopen an old document or replace newer data. A minimal list summary is also stored in the current tab’s sessionStorage for up to 15 minutes, so browser reloads can restore it immediately. It is cleared when authentication changes.

Dropdown arrows are inset by 12px, with room reserved to their right. Controls use soft green focus styling instead of native blue focus rings, while keyboard focus remains visible. Text selection uses the same green palette. This update needs no Supabase deployment or SQL changes.


### Faster browser reloads

The dashboard restores its last known list/counts after a browser reload, then silently retrieves current metadata. The per-tab, per-account cache contains only document IDs, filenames, status and creation timestamps. It expires after 15 minutes, is cleared on sign-out/account changes, and never contains PDF bytes, signatures, recipient details, Storage paths/URLs or signing tokens. Blocked browser storage falls back to normal loading; oversized snapshots are not retained.

List reads use the Supabase Data API directly with the existing authenticated owner/admin RLS policy, selecting only `id,title,status,created_at`. This avoids an Edge Function cold start and its extra authentication round trip for dashboard reads. Private PDF access and mutations continue through the Edge Function. No new database policy, migration or backend deployment is required.

PDF rendering code is split out of the initial dashboard bundle. Once the list appears, it is prepared during browser idle time, or earlier when a document receives pointer/keyboard focus. The production build's initial compressed JavaScript dropped from approximately 274 KB to 139 KB; the separate PDF viewer chunk loads on demand. Network and authentication timing still depend on the client and service availability, while cached lists stay visible during revalidation.


### Preparing the PDF viewer before a document opens

The dashboard schedules PDF viewer preparation after its list is ready, using browser idle time (with a short timeout fallback). Hovering or focusing a document also starts preparation. Module requests are shared, so these hints and the eventual document open do not download the renderer repeatedly. Preparation also starts the PDF worker; opened documents share that worker explicitly, while each document's loading task and private data are destroyed when its viewer closes. A full browser reload starts a new worker. Failed worker initialization is discarded so a later open can retry.

Preparation downloads only public application code, never document PDFs or signing URLs. The initial dashboard still benefits from code splitting, while normal document opens can reuse already prepared code and the worker. Actual PDF download, decoding and page drawing still depend on file size and device/network conditions. No Supabase deployment is needed.

### Signer field colours and zoom reset

Field border/tint colours belong to their signer, consistently across Signature and Date: company fields are blue and recipient fields are green. Reassigning a field changes its colour immediately. Placement outlines and selected-field controls follow the same signer palette; actual signature images and finalized PDFs keep their normal signing ink.

The bottom-right zoom bar shows the current scale separately from an explicit **↺ 100%** button, which resets the preview in one click on desktop or mobile. These are frontend changes and need no Supabase deployment.
