import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { api, configured, supabase, type DocumentSummary } from "./api";
import Admin from "./Admin";
import {
  readDocumentCache,
  writeDocumentCache,
  clearDocumentCache,
} from "./documentCache";
import { clearPdfMemory } from "./pdfMemory";
import AccountSettings from "./AccountSettings";
import { PdfPreview as Pdf } from "./PdfPreview";
import { type SignatureMethod } from "./Signature";
import { SignatureDialog } from "./SignatureDialog";
import { useSigningDate } from "./useSigningDate";
import "./style.css";
function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [hash, setHash] = useState(location.hash);
  const [homeVersion, setHomeVersion] = useState(0);
  const [documentCache, setDocumentCache] = useState<{
    owner: string;
    documents: DocumentSummary[];
  } | null>(null);
  useEffect(() => {
    const applySession = (value: Session | null) => {
      setSession(value);
      if (!value) {
        clearDocumentCache();
        clearPdfMemory();
        setDocumentCache(null);
        return;
      }
      setDocumentCache((cached) => {
        if (cached?.owner === value.user.id) return cached;
        clearPdfMemory();
        const documents = readDocumentCache(value.user.id);
        return documents ? { owner: value.user.id, documents } : null;
      });
    };
    supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_, value) =>
      applySession(value),
    );
    const fn = () => setHash(location.hash);
    window.addEventListener("hashchange", fn);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("hashchange", fn);
    };
  }, []);
  const token = hash.startsWith("#/sign/") ? hash.slice(7) : "";
  return (
    <>
      <header>
        <a
          href="#/"
          className="brand"
          title="Open the home page"
          aria-label="Go to documents"
          onClick={(event) => {
            event.preventDefault();
            location.hash = "/";
            setHash("#/");
            setHomeVersion((value) => value + 1);
          }}
        >
          <img
            className="brand-logo"
            src={`${import.meta.env.BASE_URL}esign-icon.png`}
            alt="Ready Ready eSign logo"
            width={54}
            height={54}
          />
          <span className="brand-wordmark">
            Ready Ready <span className="brand-product">eSign</span>
            <small>by Ready Ready Motors, Inc.</small>
          </span>
        </a>
        <span className="header-note">Secure electronic signatures</span>
        {session && !token && (
          <div className="account-actions">
            <a
              href="#/settings"
              className="button secondary"
              aria-label="Account settings"
            >
              <span className="settings-label-full">Account settings</span>
              <span className="settings-label-short">Settings</span>
            </a>
            <button
              className="secondary"
              onClick={() => supabase.auth.signOut()}
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      <main>
        {!configured ? (
          <div className="card">
            <h1>Connect your workspace</h1>
            <p>
              Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild.
              Follow the repository setup guide to configure Supabase and email
              delivery.
            </p>
          </div>
        ) : hash === "#/complete" ? (
          <Completion />
        ) : token ? (
          <Signer key={token} token={token} />
        ) : session ? (
          hash === "#/settings" ? (
            <AccountSettings key={session.user.id} />
          ) : (
            <Admin
              key={session.user.id}
              homeRequest={homeVersion}
              cachedDocuments={
                documentCache?.owner === session.user.id
                  ? documentCache.documents
                  : undefined
              }
              onDocumentsChange={(documents) => {
                writeDocumentCache(session.user.id, documents);
                setDocumentCache({ owner: session.user.id, documents });
              }}
            />
          )
        ) : (
          <Login />
        )}
      </main>
      <footer>
        Ready Ready Motors, Inc. · Private documents. Clear agreements.
      </footer>
    </>
  );
}
function Login() {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login card">
      <div className="eyebrow">ADMIN WORKSPACE</div>
      <h1>
        Less paperwork.
        <br />
        More ready.
      </h1>
      <p>Prepare, send, and track your vehicle documents in one place.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          setError(error?.message || "");
          setBusy(false);
        }}
      >
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button disabled={busy}>{busy ? "Signing in…" : "Sign in →"}</button>
      </form>
      <small>Access is limited to approved administrators.</small>
    </div>
  );
}
function Completion() {
  return (
    <div className="card completion">
      <div className="success-icon">✓</div>
      <h1>You’re all signed.</h1>
      <p>
        Your signed document has been securely saved with Ready Ready Motors,
        Inc.
      </p>
      <small>This signing link is now closed. You can close this window.</small>
    </div>
  );
}
function Signer({ token }: { token: string }) {
  const today = useSigningDate();
  const [showSignature, setShowSignature] = useState(false),
    [dateApplied, setDateApplied] = useState(false);
  const [pdfReady, setPdfReady] = useState(false);
  const [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [signature, setSignature] = useState(""),
    [signatureMethod, setSignatureMethod] = useState<SignatureMethod>("typed"),
    [consent, setConsent] = useState(false),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  useEffect(() => {
    setData(undefined);
    setError("");
    api("session", { token })
      .then((value) => {
        setData(value);
        setName(value.recipient_name || "");
      })
      .catch((e) => setError(e.message));
  }, [token]);
  if (done) return <Completion />;
  return (
    <div className="signer">
      {showSignature && (
        <SignatureDialog
          name={name || data?.recipient_name || "Recipient"}
          value={signature}
          method={signatureMethod}
          onClose={() => setShowSignature(false)}
          onAccept={(png, method) => {
            setSignature(png);
            setSignatureMethod(method);
            setConsent(true);
            setDateApplied(true);
            setShowSignature(false);
          }}
        />
      )}
      <div className="eyebrow">READY FOR YOUR SIGNATURE</div>
      <h1>{data?.title || "Review & sign"}</h1>
      <p>Review the entire document before signing. No account required.</p>
      {error && !data && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data && (
        <>
          <div className="card">
            <p>
              Invitation for <strong>{data.email}</strong> · expires{" "}
              {new Date(data.expires_at).toLocaleString()}
            </p>
            <Pdf
              url={data.url}
              fields={data.fields}
              onReady={setPdfReady}
              onFieldActivate={(_, field) => {
                if (field.type === "signature") setShowSignature(true);
                else setDateApplied(true);
              }}
              signaturePreviews={{ recipient: signature }}
              datePreviews={{ recipient: dateApplied ? today : undefined }}
              signerNames={{ recipient: name || "Recipient" }}
            />
          </div>
          <form
            className="card signing-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!pdfReady) return;
              setBusy(true);
              setError("");
              try {
                await api("complete", {
                  token,
                  signature,
                  signatureMethod,
                  signingDate: today,
                  name,
                  consent,
                });
                setDone(true);
                location.replace("#/complete");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>Make it official</h2>
            <label>
              Full legal name
              <input
                value={name}
                maxLength={150}
                required
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>Your signature</label>
            <p>
              Click your signature field on the PDF to type or draw your
              signature. Your dates use MM/DD/YYYY.
            </p>
            <label className="consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                I have reviewed this document, agree to use electronic records
                and signatures, and intend this signature to be legally binding.
                I can decline by closing this page and contacting Ready Ready
                Motors.
              </span>
            </label>
            <p className="muted">
              Your name, signing time (UTC), request IP information, and
              document hash will be recorded in the audit trail.
            </p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button disabled={busy || !signature || !consent || !pdfReady}>
              {busy ? "Securely saving…" : "Agree & sign document →"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
