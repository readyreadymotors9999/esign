import { useEffect, useRef, useState, type CSSProperties } from "react";
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
    [signatureMethod, setSignatureMethod] = useState<SignatureMethod>("typed"),
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
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [zoomHost, setZoomHost] = useState<HTMLDivElement | null>(null);
  const dividerDrag = useRef<{ x: number; width: number } | null>(null);
  function resizeSidebar(width: number) {
    setSidebarWidth(Math.max(280, Math.min(640, width)));
  }
  const [recipientEditor, setRecipientEditor] = useState(false);
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    if (!recipientEditor) return;
    const panel = document.querySelector<HTMLElement>(".recipient-tools");
    panel?.scrollIntoView({ block: "nearest" });
    panel
      ?.querySelector<HTMLInputElement>("input")
      ?.focus({ preventScroll: true });
  }, [recipientEditor]);
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
    setRecipientEditor(false);
    setSelected(data.document);
    setFields(data.document.fields);
    setUrl(data.url || "");
    setAudit(data.audit);
    setRename(data.document.title);
    setSignature("");
    setSignatureMethod("typed");
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
    first.trim() &&
    email &&
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
            <h1>Welcome back, Lichen</h1>
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
              <div
                role="tablist"
                aria-label="Document status"
                className="document-tabs"
              >
                {[
                  ["all", "All documents"],
                  ["draft", "Drafts"],
                  ["sent", "Waiting for others"],
                  ["completed", "Completed"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    role="tab"
                    aria-selected={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {label}{" "}
                    <span className="count">
                      {
                        docs.filter(
                          (d) => value === "all" || d.status === value,
                        ).length
                      }
                    </span>
                  </button>
                ))}
              </div>
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
            {docs.length > 0 &&
              !docs.some((d) => filter === "all" || d.status === filter) && (
                <p className="empty">No documents in this tab.</p>
              )}
            {docs
              .filter((doc) => filter === "all" || doc.status === filter)
              .map((doc) => (
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
                    <small>
                      {new Date(doc.created_at).toLocaleDateString()}
                    </small>
                  </span>
                  <span className={`badge ${doc.status}`}>{doc.status}</span>
                </button>
              ))}
          </aside>
        )}
        <section className="document-panel">
          {!selected ? null : (
            <div
              className="card editor"
              style={
                { "--sidebar-width": `${sidebarWidth}px` } as CSSProperties
              }
            >
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
                {selected.status === "draft" && recipientEditor && (
                  <section
                    className="recipient-tools"
                    aria-label="Manage recipient"
                  >
                    <div className="split">
                      <h3>Recipient</h3>
                      <button
                        type="button"
                        className="secondary"
                        aria-label="Close recipient editor"
                        onClick={() => setRecipientEditor(false)}
                      >
                        ×
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={
                          busy ||
                          !first.trim() ||
                          !email ||
                          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
                        }
                        onClick={() => setRecipientEditor(false)}
                      >
                        Done
                      </button>
                    </div>
                    <label>
                      Saved recipient
                      <select
                        value={recipientId}
                        onChange={(e) => {
                          const r = recipients.find(
                            (r) => r.id === e.target.value,
                          );
                          if (!r) {
                            setRecipientId("");
                            setEmail("");
                            setFirst("");
                            setLast("");
                          }
                          if (r) {
                            setRecipientId(r.id);
                            setEmail(r.email);
                            setFirst(r.first_name);
                            setLast(r.last_name);
                          }
                        }}
                      >
                        <option value="">Add new recipient…</option>
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
                  </section>
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
              <div
                className="panel-divider"
                role="separator"
                tabIndex={0}
                aria-label="Resize document toolbar"
                aria-orientation="vertical"
                aria-valuemin={280}
                aria-valuemax={640}
                aria-valuenow={sidebarWidth}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  dividerDrag.current = {
                    x: e.clientX,
                    width:
                      e.currentTarget.previousElementSibling!.getBoundingClientRect()
                        .width,
                  };
                }}
                onPointerMove={(e) => {
                  if (dividerDrag.current)
                    resizeSidebar(
                      dividerDrag.current.width +
                        e.clientX -
                        dividerDrag.current.x,
                    );
                }}
                onPointerUp={() => {
                  dividerDrag.current = null;
                }}
                onPointerCancel={() => {
                  dividerDrag.current = null;
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    e.preventDefault();
                    resizeSidebar(
                      sidebarWidth + (e.key === "ArrowRight" ? 20 : -20),
                    );
                  }
                  if (e.key === "Home") resizeSidebar(400);
                }}
              />
              <div className="preview-pane">
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
                                  y: Math.min(
                                    1 - field.height,
                                    field.y + 0.025,
                                  ),
                                },
                              ]);
                            }
                          : undefined
                      }
                      signaturePreviews={{ company: signature }}
                      datePreviews={{
                        company: dateApplied ? today : undefined,
                      }}
                      signerNames={{
                        company: "Lichen Wang",
                        recipient:
                          first.trim() && email
                            ? `${first} ${last}`.trim()
                            : undefined,
                      }}
                      recipientChoices={recipients.map((r) => ({
                        id: r.id,
                        name: `${r.first_name} ${r.last_name}`.trim(),
                        email: r.email,
                      }))}
                      onChooseRecipient={(id) => {
                        const r = recipients.find((r) => r.id === id);
                        if (r) {
                          setRecipientId(r.id);
                          setEmail(r.email);
                          setFirst(r.first_name);
                          setLast(r.last_name);
                          setRecipientEditor(false);
                          return;
                        }
                        if (id !== "edit") {
                          setRecipientId("");
                          setEmail("");
                          setFirst("");
                          setLast("");
                        }
                        setRecipientEditor(true);
                      }}
                      zoomHost={zoomHost}
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
                        Anyone with this link can sign as the recipient. Share
                        it only with the intended person. It will not be shown
                        again after leaving this document.
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
                          if (
                            !confirm(
                              "Edit this document? All signatures and dates, including Lichen Wang’s, will be cleared. The old signing link will stop working. Everyone must sign and date again.",
                            )
                          )
                            return;
                          await api("revoke", { documentId: selected.id });
                          setShare("");
                          await show(selected.id);
                          await refresh();
                          setMessage(
                            "All signatures and dates cleared. Edit the document, then sign again and send a new invitation.",
                          );
                        })
                      }
                    >
                      Edit document & resend
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
                          setTimeout(
                            () => URL.revokeObjectURL(objectUrl),
                            1000,
                          );
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
                              <pre>
                                {JSON.stringify(event.metadata, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="pdf-zoom-host" ref={setZoomHost} />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
