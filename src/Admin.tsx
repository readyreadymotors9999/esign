import { useEffect, useState } from "react";
import {
  api,
  supabase,
  editDocumentPdf,
  type Document,
  type Field,
} from "./api";
import { Pdf } from "./Pdf";
import { type SignatureMethod } from "./Signature";
import { SignatureDialog } from "./SignatureDialog";
import { useSigningDate } from "./useSigningDate";
import { prepareGoogleImport } from "./google";
type Recipient = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
};
export default function Admin() {
  const [docs, setDocs] = useState<Document[]>([]),
    [selected, setSelected] = useState<Document>(),
    [url, setUrl] = useState(""),
    [fields, setFields] = useState<Field[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [audit, setAudit] = useState<any[]>([]);
  const [source, setSource] = useState<"pdf" | "google" | null>(null),
    [title, setTitle] = useState(""),
    [file, setFile] = useState<File>(),
    [googleUrl, setGoogleUrl] = useState(""),
    [authorize, setAuthorize] = useState<() => Promise<Blob>>(),
    [rename, setRename] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]),
    [email, setEmail] = useState(""),
    [first, setFirst] = useState(""),
    [last, setLast] = useState(""),
    [signature, setSignature] = useState(""),
    [signatureMethod, setSignatureMethod] = useState<SignatureMethod>("drawn"),
    [showSignature, setShowSignature] = useState(false),
    [dateApplied, setDateApplied] = useState(false),
    [recipientId, setRecipientId] = useState(""),
    [consent, setConsent] = useState(false),
    [delivery, setDelivery] = useState<"email" | "share">("email"),
    [share, setShare] = useState(""),
    [pdfReady, setPdfReady] = useState(false),
    [editingAvailable, setEditingAvailable] = useState(false),
    [pageRangesAvailable, setPageRangesAvailable] = useState(false),
    [toolsHost, setToolsHost] = useState<HTMLDivElement | null>(null);
  const today = useSigningDate();
  async function refresh() {
    const data = await api("list");
    setDocs(data.documents);
  }
  async function refreshRecipients() {
    const data = await api("recipients");
    setRecipients(data.recipients);
  }
  useEffect(() => {
    Promise.all([refresh(), refreshRecipients()]).catch((e) =>
      setMessage(e.message),
    );
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
  async function show(id: string) {
    const data = await api("detail", { documentId: id });
    setEditingAvailable(data.capabilities?.pdfEditing === true);
    setPageRangesAvailable(data.capabilities?.pdfPageRanges === true);
    if (selected?.id !== id) {
      setRecipientId("");
      setEmail("");
      setFirst("");
      setLast("");
    }
    setSelected(data.document);
    setFields(data.document.fields);
    setUrl(data.url || "");
    setAudit(data.audit);
    setRename(data.document.title);
    setSignature("");
    setSignatureMethod("drawn");
    setShowSignature(false);
    setDateApplied(false);
    setConsent(false);
  }
  async function upload(blob: Blob) {
    if (!title.trim() || title.length > 200)
      throw new Error("Enter a document filename (up to 200 characters).");
    if (blob.size > 10 * 1024 * 1024)
      throw new Error("Choose a PDF smaller than 10 MB.");
    const created = await api("create", { title: title.trim() });
    const { error } = await supabase.storage
      .from("documents")
      .upload(created.path, blob, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (error) throw error;
    await api("uploaded", { documentId: created.id });
    await refresh();
    await show(created.id);
    setSource(null);
    setTitle("");
    setFile(undefined);
    setAuthorize(undefined);
    setShare("");
    setMessage(
      "PDF uploaded. Place a signature and date field for each signer.",
    );
  }
  async function send() {
    const result = await api("send", {
      documentId: selected!.id,
      fields,
      email,
      recipientName: `${first} ${last}`.trim(),
      recipientId: recipientId || undefined,
      recipientFirstName: first,
      recipientLastName: last,
      signingDate: today,
      signature,
      signatureMethod,
      consent,
      delivery,
    });
    setShare(result.link || "");
    await refreshRecipients();
    await refresh();
    await show(selected!.id);
    setMessage(
      delivery === "share"
        ? "Private signing link created. Copy it below; it expires in 72 hours."
        : "Signing invitation sent to the recipient. It expires in 72 hours.",
    );
  }
  const ready =
    signature &&
    consent &&
    pdfReady &&
    ["company", "recipient"].every((s) =>
      ["signature", "date"].every((t) =>
        fields.some((f) => f.signer === s && f.type === t),
      ),
    );
  return (
    <div className={`admin-workspace ${selected ? "document-open" : ""}`}>
      {showSignature && (
        <SignatureDialog
          name="Lichen Wang"
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
      {!selected && (
        <div className="heading">
          <div>
            <div className="eyebrow">YOUR WORKSPACE</div>
            <h1>Documents</h1>
            <p>Prepare together. Sign with confidence.</p>
          </div>
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => {
                setSource("pdf");
                setAuthorize(undefined);
              }}
            >
              ＋ Upload PDF
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setSource("google");
                setAuthorize(undefined);
              }}
            >
              Import Google Doc
            </button>
          </div>
        </div>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {source && (
        <section className="card import-panel">
          <div className="split">
            <h2>
              {source === "pdf"
                ? "Upload a PDF"
                : "Import a private Google Doc"}
            </h2>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setSource(null)}
            >
              Cancel
            </button>
          </div>
          <label>
            eSign filename
            <input
              required
              maxLength={200}
              placeholder="Vehicle purchase agreement.pdf"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          {source === "pdf" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (file) void task(() => upload(file));
              }}
            >
              <label>
                PDF file
                <input
                  type="file"
                  required
                  accept="application/pdf,.pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setFile(f);
                    if (f && !title) setTitle(f.name);
                  }}
                />
              </label>
              <button disabled={busy || !file || !title.trim()}>
                Upload & prepare
              </button>
            </form>
          ) : (
            <>
              <p>
                Authorize your Google account to export this Doc as a PDF
                snapshot. The source Doc stays private and unchanged.
              </p>
              <label>
                Google Docs URL
                <input
                  type="url"
                  placeholder="https://docs.google.com/document/d/…/edit"
                  value={googleUrl}
                  onChange={(e) => {
                    setGoogleUrl(e.target.value);
                    setAuthorize(undefined);
                  }}
                />
              </label>
              {!authorize ? (
                <button
                  disabled={busy || !googleUrl || !title.trim()}
                  onClick={() =>
                    task(async () => {
                      const start = await prepareGoogleImport(googleUrl);
                      setAuthorize(() => start);
                    })
                  }
                >
                  Connect Google
                </button>
              ) : (
                <button
                  disabled={busy}
                  onClick={() => {
                    const result = authorize();
                    void task(async () => upload(await result));
                  }}
                >
                  Authorize & import PDF
                </button>
              )}
              <small className="block">
                Google permission is used only for this export. No Google access
                token is saved.
              </small>
            </>
          )}
        </section>
      )}
      <div className={`workspace ${selected ? "single-document" : ""}`}>
        {!selected && (
          <aside className="card document-list">
            <div className="split">
              <h2>
                All documents <span className="count">{docs.length}</span>
              </h2>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => task(refresh)}
              >
                Refresh
              </button>
            </div>
            {!docs.length && (
              <div className="empty">
                <div className="empty-icon">▤</div>
                <h3>A fresh start</h3>
                <p>Upload a PDF or import a Google Doc.</p>
              </div>
            )}
            {docs.map((doc) => (
              <button
                disabled={busy}
                className="doc-row"
                key={doc.id}
                onClick={() =>
                  task(async () => {
                    setShare("");
                    await show(doc.id);
                    await refresh();
                  })
                }
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
        )}
        <section className="document-panel">
          {!selected ? (
            <div className="card welcome">
              <span className="empty-icon">✎</span>
              <h2>Two signatures. One simple flow.</h2>
              <p>
                Invite your recipient by email or share a private signing link.
              </p>
              <div className="steps">
                <span>01 Prepare</span>
                <span>02 Sign & date</span>
                <span>03 Invite</span>
              </div>
            </div>
          ) : (
            <div className="card editor">
              <aside className="document-sidebar" aria-label="Document toolbar">
                <button
                  className="secondary back-documents"
                  disabled={busy}
                  onClick={() => {
                    setSelected(undefined);
                    setShare("");
                    setSource(null);
                  }}
                >
                  ← Back to documents
                </button>
                <div className="split">
                  <h2>{selected.title}</h2>
                  <span className={`badge ${selected.status}`}>
                    {selected.status}
                  </span>
                </div>
                {selected.status === "draft" && (
                  <>
                    <form
                      className="rename"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void task(async () => {
                          await api("rename", {
                            documentId: selected.id,
                            title: rename,
                          });
                          setSelected({ ...selected, title: rename.trim() });
                          await refresh();
                          setMessage("Document filename updated.");
                        });
                      }}
                    >
                      <label>
                        Document filename
                        <input
                          required
                          maxLength={200}
                          value={rename}
                          onChange={(e) => setRename(e.target.value)}
                        />
                      </label>
                      <button disabled={busy} className="secondary">
                        Save filename
                      </button>
                    </form>
                    <p>
                      Choose a signer, then place a signature and date field for
                      each person on the PDF.
                    </p>
                  </>
                )}
                {selected.status === "draft" && !editingAvailable && (
                  <p className="notice">
                    Page editing will be available after the Supabase backend
                    update. You can continue placing signature and date fields.
                  </p>
                )}
                <div ref={setToolsHost} />
                {selected.status === "draft" && (
                  <form
                    className="send-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (ready) void task(send);
                    }}
                  >
                    <h3>Company signer</h3>
                    <div className="signer-profile">
                      <strong>Lichen Wang</strong>
                      <small>readyreadymotors9999@gmail.com</small>
                      <small>
                        Sign in with this approved admin email to sign as
                        Lichen.
                      </small>
                    </div>
                    <p className="signer-help">
                      Click a Lichen signature field on the PDF to choose Type
                      or Draw. Click a date field to fill today’s date.
                    </p>
                    {signature && (
                      <small className="signature-accepted">
                        Signature accepted · {today}
                      </small>
                    )}
                    <h3>Recipient</h3>
                    <label>
                      Saved recipient
                      <select
                        value={recipientId}
                        onChange={(e) => {
                          const r = recipients.find(
                            (r) => r.id === e.target.value,
                          );
                          if (r) {
                            setRecipientId(r.id);
                            setEmail(r.email);
                            setFirst(r.first_name);
                            setLast(r.last_name);
                          }
                        }}
                      >
                        <option value="">Choose a saved recipient…</option>
                        {recipients.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.first_name} {r.last_name} · {r.email}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="name-fields">
                      <label>
                        Recipient first name
                        <input
                          required
                          maxLength={100}
                          value={first}
                          onChange={(e) => setFirst(e.target.value)}
                        />
                      </label>
                      <label>
                        Recipient last name
                        <input
                          maxLength={100}
                          value={last}
                          onChange={(e) => setLast(e.target.value)}
                        />
                      </label>
                    </div>
                    <label>
                      Recipient email
                      <input
                        required
                        type="email"
                        placeholder="recipient@qq.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy || !email || !first.trim()}
                      onClick={() =>
                        task(async () => {
                          const saved = await api("save_recipient", {
                            recipientId: recipientId || undefined,
                            email,
                            firstName: first,
                            lastName: last,
                          });
                          setRecipientId(saved.recipient.id);
                          await refreshRecipients();
                          setMessage(
                            "Recipient saved to your private address book.",
                          );
                        })
                      }
                    >
                      {recipientId ? "Update recipient" : "Save recipient"}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setRecipientId("");
                        setEmail("");
                        setFirst("");
                        setLast("");
                      }}
                    >
                      New recipient
                    </button>
                    <small className="block">
                      New recipients are saved automatically when you send. You
                      can edit a saved contact here and update it.
                    </small>
                    <label>
                      Invitation delivery
                      <select
                        value={delivery}
                        onChange={(e) =>
                          setDelivery(e.target.value as "email" | "share")
                        }
                      >
                        <option value="share">
                          Create share link (no email)
                        </option>
                        <option value="email">
                          Send email invitation via Gmail
                        </option>
                      </select>
                    </label>
                    <button disabled={busy || !ready}>
                      {busy
                        ? "Preparing…"
                        : delivery === "share"
                          ? "Sign & create share link →"
                          : "Sign & email recipient →"}
                    </button>
                    <small className="block">
                      Only the recipient is invited. Both signatures remain in
                      the completed PDF.
                    </small>
                  </form>
                )}
              </aside>
              <div className="document-scroll">
                {url && (
                  <Pdf
                    key={`${selected.id}-${selected.status}`}
                    url={url}
                    fields={
                      selected.status === "completed"
                        ? []
                        : selected.status === "sent"
                          ? fields.filter((f) => f.signer !== "company")
                          : fields
                    }
                    place={
                      selected.status === "draft"
                        ? (field) => {
                            if (!busy) setFields([...fields, field]);
                          }
                        : undefined
                    }
                    remove={
                      selected.status === "draft"
                        ? (i) => {
                            if (!busy)
                              setFields(fields.filter((_, j) => i !== j));
                          }
                        : undefined
                    }
                    onFieldActivate={
                      selected.status === "draft"
                        ? (_, field) => {
                            if (busy) return;
                            if (field.signer === "company") {
                              if (field.type === "signature")
                                setShowSignature(true);
                              else setDateApplied(true);
                            }
                          }
                        : undefined
                    }
                    updateField={
                      selected.status === "draft"
                        ? (i, patch) => {
                            if (!busy)
                              setFields(
                                fields.map((f, j) =>
                                  i === j ? { ...f, ...patch } : f,
                                ),
                              );
                          }
                        : undefined
                    }
                    duplicateField={
                      selected.status === "draft"
                        ? (i) => {
                            if (busy) return;
                            if (fields.length >= 50) {
                              setMessage(
                                "A document can contain at most 50 fields.",
                              );
                              return;
                            }
                            const field = fields[i];
                            setFields([
                              ...fields,
                              {
                                ...field,
                                x: Math.min(1 - field.width, field.x + 0.025),
                                y: Math.min(1 - field.height, field.y + 0.025),
                              },
                            ]);
                          }
                        : undefined
                    }
                    signaturePreviews={{ company: signature }}
                    datePreviews={{ company: dateApplied ? today : undefined }}
                    signerNames={{
                      company: "Lichen Wang",
                      recipient: `${first} ${last}`.trim() || "Recipient",
                    }}
                    externalTools
                    toolsHost={toolsHost}
                    rangeEditing={pageRangesAvailable}
                    busy={busy}
                    onEdit={
                      selected.status === "draft" && editingAvailable
                        ? (operation, page, file, range) =>
                            task(async () => {
                              await editDocumentPdf(
                                selected.id,
                                selected.original_path,
                                operation,
                                page,
                                fields,
                                file,
                                range,
                              );
                              await show(selected.id);
                              await refresh();
                              setMessage(
                                "PDF updated. Review the pages and fields, then sign again before sending.",
                              );
                            })
                        : undefined
                    }
                    onReady={setPdfReady}
                  />
                )}
                {share && (
                  <div className="share-panel">
                    <h3>Private signing link</h3>
                    <p>
                      Anyone with this link can sign as the recipient. Share it
                      only with the intended person. It will not be shown again
                      after leaving this document.
                    </p>
                    <label>
                      Signing link
                      <input
                        readOnly
                        value={share}
                        onFocus={(e) => e.target.select()}
                      />
                    </label>
                    <button
                      onClick={() =>
                        task(async () => {
                          await navigator.clipboard.writeText(share);
                          setMessage("Signing link copied.");
                        })
                      }
                    >
                      Copy signing link
                    </button>
                  </div>
                )}
                {selected.status === "sent" && (
                  <p className="notice">
                    Lichen Wang has signed. Awaiting recipient signature. The
                    link expires after 72 hours.
                  </p>
                )}
                {selected.status === "sent" && (
                  <button
                    disabled={busy}
                    className="secondary"
                    onClick={() =>
                      task(async () => {
                        await api("revoke", { documentId: selected.id });
                        setShare("");
                        await show(selected.id);
                        await refresh();
                        setMessage(
                          "Old link revoked. Review and sign again before creating a replacement invitation.",
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
                        const r = await fetch(data.url);
                        if (!r.ok) throw new Error("Download failed");
                        const objectUrl = URL.createObjectURL(await r.blob()),
                          a = document.createElement("a");
                        a.href = objectUrl;
                        a.download = `signed-${selected.title.replace(/\.pdf$/i, "")}.pdf`;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
                      })
                    }
                  >
                    ↓ Download signed PDF
                  </button>
                )}
                <div className="audit">
                  <h3>Audit trail</h3>
                  {audit.map((event) => (
                    <div className="audit-row" key={event.id}>
                      <span className="dot" />
                      <div>
                        <strong>{event.event.replaceAll("_", " ")}</strong>
                        <small>
                          {new Date(event.created_at).toLocaleString()} ·{" "}
                          {event.actor}
                        </small>
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
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
