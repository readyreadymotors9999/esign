import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { api, configured, supabase, type Document, type Field } from "./api";
import { Pdf } from "./Pdf";
import { Signature } from "./Signature";
import "./style.css";
function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_, value) =>
      setSession(value),
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
        <a href="#" className="brand">
          <span className="brand-icon">RR</span>
          <span>
            READY READY<small>MOTORS, INC.</small>
          </span>
        </a>
        <span className="header-note">Secure electronic signatures</span>
        {session && !token && (
          <button className="secondary" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
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
          <Admin />
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
function Admin() {
  const [docs, setDocs] = useState<Document[]>([]),
    [selected, setSelected] = useState<Document>(),
    [url, setUrl] = useState(""),
    [fields, setFields] = useState<Field[]>([]),
    [email, setEmail] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [audit, setAudit] = useState<any[]>([]);
  const refresh = async () => {
    const d = await api("list");
    setDocs(d.documents);
  };
  useEffect(() => {
    refresh().catch((e) => setMessage(e.message));
  }, []);
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function open(doc: Document) {
    await task(async () => {
      const data = await api("detail", { documentId: doc.id });
      setSelected(data.document);
      setFields(data.document.fields);
      setUrl(data.url);
      setAudit(data.audit);
      setEmail("");
    });
  }
  return (
    <>
      <div className="heading">
        <div>
          <div className="eyebrow">YOUR WORKSPACE</div>
          <h1>Documents</h1>
          <p>From first signature to the finish line.</p>
        </div>
        <label className={`upload button ${busy ? "disabled" : ""}`}>
          ＋ Upload PDF
          <input
            hidden
            disabled={busy}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void task(async () => {
                if (file.size > 10 * 1024 * 1024)
                  throw new Error("Choose a PDF smaller than 10 MB.");
                const created = await api("create", { title: file.name });
                const { error } = await supabase.storage
                  .from("documents")
                  .upload(created.path, file, {
                    contentType: "application/pdf",
                    upsert: false,
                  });
                if (error) throw error;
                await api("uploaded", { documentId: created.id });
                await refresh();
                setMessage("PDF uploaded. Open it to place signing fields.");
              });
            }}
          />
        </label>
      </div>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <div className="workspace">
        <aside className="card document-list">
          <div className="split">
            <h2>All documents</h2>
            <span className="count">{docs.length}</span>
          </div>
          {!docs.length && (
            <div className="empty">
              <div className="empty-icon">▤</div>
              <h3>A fresh start</h3>
              <p>Upload your first PDF to prepare it for signing.</p>
            </div>
          )}
          {docs.map((doc) => (
            <button
              disabled={busy}
              className={`doc-row ${selected?.id === doc.id ? "selected" : ""}`}
              key={doc.id}
              onClick={() => open(doc)}
            >
              <span className="file-icon">PDF</span>
              <span className="doc-info">
                <strong>{doc.title}</strong>
                <small>{new Date(doc.created_at).toLocaleDateString()}</small>
              </span>
              <span className={`badge ${doc.status}`}>{doc.status}</span>
            </button>
          ))}
        </aside>
        <section>
          {!selected ? (
            <div className="card welcome">
              <span className="empty-icon">✎</span>
              <h2>Every agreement starts here</h2>
              <p>
                Select a document to prepare fields, send a secure signing link,
                or review its history.
              </p>
              <div className="steps">
                <span>01 Upload</span>
                <span>02 Prepare</span>
                <span>03 Send & sign</span>
              </div>
            </div>
          ) : (
            <div className="card editor">
              <div className="split">
                <h2>{selected.title}</h2>
                <span className={`badge ${selected.status}`}>
                  {selected.status}
                </span>
              </div>
              {selected.status === "draft" && (
                <p>
                  Place at least one signature field. Dates are filled using the
                  server’s UTC signing date.
                </p>
              )}
              {url && (
                <Pdf
                  url={url}
                  fields={selected.status === "completed" ? [] : fields}
                  place={
                    selected.status === "draft"
                      ? (field) => setFields([...fields, field])
                      : undefined
                  }
                  remove={
                    selected.status === "draft"
                      ? (i) => setFields(fields.filter((_, j) => i !== j))
                      : undefined
                  }
                />
              )}
              {selected.status === "draft" && (
                <form
                  className="send-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void task(async () => {
                      await api("send", {
                        documentId: selected.id,
                        fields,
                        email,
                      });
                      await refresh();
                      const d = await api("detail", {
                        documentId: selected.id,
                      });
                      setSelected(d.document);
                      setAudit(d.audit);
                      setMessage("Signing link sent. It expires in 72 hours.");
                    });
                  }}
                >
                  <label>
                    Recipient email
                    <input
                      type="email"
                      placeholder="recipient@qq.com"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={
                      busy || !fields.some((f) => f.type === "signature")
                    }
                  >
                    {busy ? "Sending…" : "Send for signature →"}
                  </button>
                  <small>
                    QQ.com addresses are supported. One recipient per document.
                  </small>
                </form>
              )}
              {selected.status === "sent" && (
                <p className="notice">
                  Awaiting signature. Links expire after 72 hours.
                </p>
              )}
              {["sent", "expired"].includes(selected.status) && (
                <button
                  disabled={busy}
                  className="secondary"
                  onClick={() =>
                    task(async () => {
                      await api("revoke", { documentId: selected.id });
                      await refresh();
                      const d = await api("detail", {
                        documentId: selected.id,
                      });
                      setSelected(d.document);
                      setFields(d.document.fields);
                      setAudit(d.audit);
                      setMessage(
                        "Previous signing link revoked. You can send a new invitation.",
                      );
                    })
                  }
                >
                  Revoke link & return to draft
                </button>
              )}
              {selected.status === "completed" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    task(async () => {
                      const data = await api("download", {
                        documentId: selected.id,
                      });
                      const response = await fetch(data.url);
                      if (!response.ok) throw new Error("Download failed");
                      const blobUrl = URL.createObjectURL(
                        await response.blob(),
                      );
                      const a = document.createElement("a");
                      a.href = blobUrl;
                      a.download = `signed-${selected.title}`;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
                    })
                  }
                >
                  ↓ Download signed PDF
                </button>
              )}
              <div className="audit">
                <h3>Audit trail</h3>
                {audit.length === 0 && <p>No events yet.</p>}
                {audit.map((event) => (
                  <div className="audit-row" key={event.id}>
                    <span className="dot" />
                    <div>
                      <strong>{event.event.replaceAll("_", " ")}</strong>
                      <small>
                        {new Date(event.created_at).toLocaleString()} ·{" "}
                        {event.actor}
                      </small>
                      {event.metadata?.sha256 && (
                        <small className="hash">
                          SHA-256: {event.metadata.sha256}
                        </small>
                      )}
                      {Object.keys(event.metadata || {}).length > 0 && (
                        <details>
                          <summary>Event details</summary>
                          <pre>{JSON.stringify(event.metadata, null, 2)}</pre>
                        </details>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </>
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
  const [pdfReady, setPdfReady] = useState(false);
  const [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [signature, setSignature] = useState(""),
    [consent, setConsent] = useState(false),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  useEffect(() => {
    setData(undefined);
    setError("");
    api("session", { token })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token]);
  if (done) return <Completion />;
  return (
    <div className="signer">
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
            <Pdf url={data.url} fields={data.fields} onReady={setPdfReady} />
          </div>
          <form
            className="card signing-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!pdfReady) return;
              setBusy(true);
              setError("");
              try {
                await api("complete", { token, signature, name, consent });
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
            <Signature onChange={setSignature} />
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
