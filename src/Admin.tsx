import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  api,
  supabase,
  editDocumentPdf,
  type Document,
  type DocumentSigner,
  type DocumentSummary,
  type Field,
} from "./api";
import { PdfPreview as Pdf, prefetchPdfPreview } from "./PdfPreview";
import { signatureFieldKey } from "../supabase/functions/_shared/validation";
import { DraftHistory } from "./draftHistory";
import { DraftSaver } from "./draftSaver";
import { Loading } from "./Loading";
import { createPortal } from "react-dom";
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
type DraftSnapshot = { path: string; title: string; fields: Field[]; signers: DocumentSigner[] };
function documentStatus(document: DocumentSummary) {
  return document.status === "sent" && document.viewed_at ? "viewed" : document.status;
}
async function confirmSignerRoster(documentId: string, expected: DocumentSigner[], revision?: number) {
  const confirmed = await api("detail", { documentId });
  const saved = confirmed.document?.signers;
  const emptyLegacyRoster = expected.length === 0 && saved === undefined;
  if (!emptyLegacyRoster && (!Array.isArray(saved) || saved.length !== expected.length || expected.some(signer => !saved.some((value: DocumentSigner) => value.id === signer.id && value.email === signer.email && value.name === signer.name))))
    throw new Error("The server did not save this document’s signer list. The save_draft endpoint needs document-signer support.");
  if (revision !== undefined && confirmed.document.draft_revision !== revision)
    throw new Error("This draft changed again while saving. Refresh before editing further.");
  return confirmed;
}
export default function Admin({
  homeRequest,
  cachedDocuments,
  onDocumentsChange,
}: {
  homeRequest: number;
  cachedDocuments?: DocumentSummary[];
  onDocumentsChange: (documents: DocumentSummary[]) => void;
}) {
  const [docs, setDocs] = useState<DocumentSummary[]>(cachedDocuments || []),
    [selected, setSelected] = useState<Document>(),
    [url, setUrl] = useState(""),
    [fields, setFields] = useState<Field[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [audit, setAudit] = useState<any[]>([]);
  const [docsLoaded, setDocsLoaded] = useState(cachedDocuments !== undefined);
  const [docsLoading, setDocsLoading] = useState(cachedDocuments === undefined);
  const [openingDocument, setOpeningDocument] = useState(false);
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
  const [signersAvailable, setSignersAvailable] = useState(false);
  const [documentSigners, setDocumentSigners] = useState<DocumentSigner[]>([]);
  const [appliedSignatures, setAppliedSignatures] = useState<Set<string>>(new Set());
  const [signatureTarget, setSignatureTarget] = useState<string>();
  const [shareLinks, setShareLinks] = useState<{ name: string; email: string; link: string }[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [zoomHost, setZoomHost] = useState<HTMLDivElement | null>(null);
  const dividerDrag = useRef<{ x: number; width: number } | null>(null);
  function resizeSidebar(width: number) {
    setSidebarWidth(Math.max(280, Math.min(640, width)));
  }
  const [recipientHost, setRecipientHost] = useState<HTMLDivElement | null>(
    null,
  );
  const [recipientEditor, setRecipientEditor] = useState(false);
  const [recipientMode, setRecipientMode] = useState<"saved" | "new">("saved");
  const [recipientEditing, setRecipientEditing] = useState(false);
  const [signerAddError, setSignerAddError] = useState("");
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    if (!recipientEditor) return;
    const panel = document.querySelector<HTMLElement>(".recipient-tools");
    panel?.parentElement?.previousElementSibling?.scrollIntoView({
      block: "nearest",
    });
    panel
      ?.querySelector<HTMLElement>(recipientMode === "saved" && !recipientEditing ? "select" : "input")
      ?.focus({ preventScroll: true });
  }, [recipientEditor, recipientMode, recipientEditing]);
  const [autosaveAvailable, setAutosaveAvailable] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [autosaveToast, setAutosaveToast] = useState("");
  const autosaveToastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function showCenteredNotice(text: string) {
    clearTimeout(autosaveToastTimer.current);
    setAutosaveToast(text);
    autosaveToastTimer.current = setTimeout(() => setAutosaveToast(""), 1600);
  }
  useEffect(() => {
    setAutosaveToast("");
    clearTimeout(autosaveToastTimer.current);
    return () => clearTimeout(autosaveToastTimer.current);
  }, [selected?.id, selected?.status]);
  const draftSaver = useRef<DraftSaver | undefined>(undefined);
  useEffect(() => {
    if (selected?.status !== "draft" || !autosaveAvailable) {
      draftSaver.current = undefined;
      return;
    }
    const document = selected;
    const saver = new DraftSaver({ fields, signers: documentSigners }, document.draft_revision || 0,
      async (layout, revision) => {
        const result = await api("save_draft", { documentId: document.id, expectedPath: document.original_path, ...layout, revision });
        await confirmSignerRoster(document.id, layout.signers, result.revision);
        return result.revision;
      },
      (status) => { if (draftSaver.current === saver) setSaveStatus(status); },
      () => {
        if (draftSaver.current !== saver) return;
        showCenteredNotice("Draft autosaved");
      },
    );
    draftSaver.current = saver;
    setSaveStatus("Draft saved");
    return () => { void saver.flush().catch(() => {}); };
  }, [selected?.id, selected?.original_path, selected?.draft_revision, selected?.status, autosaveAvailable]);
  useEffect(() => { draftSaver.current?.update({ fields, signers: documentSigners }); }, [fields, documentSigners]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (draftSaver.current?.dirty) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const [restoreAvailable, setRestoreAvailable] = useState(false);
  const history = useRef<{ id: string; entries: DraftHistory<DraftSnapshot>; contact: { email: string; first: string; last: string; recipientId: string; delivery: "email" | "share" } } | undefined>(undefined);
  const skipHistory = useRef(false);
  const [, updateHistory] = useState(0);
  function currentSnapshot(): DraftSnapshot | undefined {
    return selected ? { path: selected.original_path, title: selected.title, fields, signers: documentSigners } : undefined;
  }
  useEffect(() => {
    if (selected?.status !== "draft") { history.current = undefined; return; }
    const snapshot = { path: selected.original_path, title: selected.title, fields, signers: documentSigners };
    if (history.current?.id !== selected.id) {
      history.current = { id: selected.id, entries: new DraftHistory(snapshot), contact: { email, first, last, recipientId, delivery } };
      updateHistory(value => value + 1);
      return;
    }
    if (skipHistory.current) { skipHistory.current = false; return; }
    // Coalesce pointer movements into a single undo step.
    const timer = setTimeout(() => {
      if (history.current?.entries.record(snapshot)) updateHistory(value => value + 1);
    }, 300);
    return () => clearTimeout(timer);
  }, [selected?.id, selected?.status, selected?.original_path, selected?.title, fields, documentSigners]);
  async function restoreHistory(operation: "undo" | "redo" | "discard") {
    const session = history.current;
    const snapshot = currentSnapshot();
    if (!session || !snapshot || !selected) return;
    session.entries.record(snapshot);
    const index = operation === "discard" ? 0 : session.entries.index + (operation === "undo" ? -1 : 1);
    const target = session.entries.at(index);
    await draftSaver.current?.flush();
    await api("restore_draft", { documentId: selected.id, expectedPath: selected.original_path, revision: draftSaver.current?.revisionValue ?? selected.draft_revision ?? 0, ...target });
    session.entries.index = index;
    skipHistory.current = true;
    await show(selected.id);
    if (operation === "discard") {
      setSignature(""); setSignatureMethod("typed");
      setEmail(session.contact.email); setFirst(session.contact.first); setLast(session.contact.last);
      setRecipientId(session.contact.recipientId); setDelivery(session.contact.delivery);
    }
    updateHistory(value => value + 1);
    await refresh();
    if (operation === "discard") showCenteredNotice("All changes discarded");
    setMessage(operation === "discard" ? "Restored the draft to when you opened this editor. Previously autosaved edits were reverted." : "Draft restored and saved. Apply your signature again before sending.");
  }
  async function saveDraftNow() {
    await draftSaver.current?.flush();
    if (selected && rename.trim() !== selected.title) {
      const result = await api("rename", { documentId: selected.id, title: rename });
      setSelected({ ...selected, title: rename.trim(), fields, draft_revision: result.revision ?? selected.draft_revision });
      await refresh();
    }
    showCenteredNotice("Document saved");
    setMessage("Draft saved. Field layout and filename are saved; apply your signature again when reopening.");
  }
  const pendingHistory = !!selected && !!history.current && JSON.stringify(currentSnapshot()) !== JSON.stringify(history.current.entries.current);
  const canUndo = pendingHistory || !!history.current?.entries.canUndo;
  const canRedo = !pendingHistory && !!history.current?.entries.canRedo;
  const canDiscard = !!history.current && (JSON.stringify(currentSnapshot()) !== JSON.stringify(history.current.entries.initial) || !!signature || dateApplied || rename !== selected?.title || email !== history.current.contact.email || first !== history.current.contact.first || last !== history.current.contact.last || recipientId !== history.current.contact.recipientId || delivery !== history.current.contact.delivery);
  const today = useSigningDate();
  const detailRequest = useRef(0);
  const listRequest = useRef(0);
  const lastHomeRequest = useRef(homeRequest);
  useEffect(
    () => () => {
      listRequest.current++;
      detailRequest.current++;
    },
    [],
  );
  async function goHome() {
    try { await draftSaver.current?.flush(); } catch (error) { setMessage((error as Error).message); return; }
    detailRequest.current++;
    setSelected(undefined);
    setShare("");
    setShareLinks([]);
    setSource(null);
    setMessage("");
    setRecipientEditor(false);
    setShowSignature(false);
    setOpeningDocument(false);
    if (docsLoaded) setDocsLoading(false);
    void Promise.all([refresh(true), refreshRecipients()]).catch((e) =>
      setMessage(e.message),
    );
  }
  useEffect(() => {
    if (lastHomeRequest.current === homeRequest) return;
    lastHomeRequest.current = homeRequest;
    goHome();
  }, [homeRequest]);
  async function refresh(silent = false) {
    const request = ++listRequest.current;
    if (!silent) setDocsLoading(true);
    try {
      const data = await api("list");
      if (request !== listRequest.current) return;
      setDocs(data.documents);
      onDocumentsChange(data.documents);
      setDocsLoaded(true);
    } finally {
      if (request === listRequest.current) setDocsLoading(false);
    }
  }
  useEffect(() => {
    if (!docsLoaded) return;
    const warm = () => {
      void prefetchPdfPreview().catch(() => {});
    };
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warm, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(warm, 600);
    return () => clearTimeout(id);
  }, [docsLoaded]);
  useEffect(() => {
    if (!docs.some(document => document.status === "sent")) return;
    const update = () => {
      if (!document.hidden && !busy) void refresh(true).catch(() => {});
    };
    const timer = setInterval(update, 15000);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [docs, busy]);
  useEffect(() => {
    if (selected?.status === "sent" && docs.some(document => document.id === selected.id && document.status === "completed"))
      void show(selected.id).catch(error => setMessage(error.message));
  }, [docs, selected?.id, selected?.status]);
  async function refreshRecipients() {
    const data = await api("recipients");
    setRecipients(data.recipients);
  }
  useEffect(() => {
    Promise.all([
      refresh(cachedDocuments !== undefined),
      refreshRecipients(),
    ]).catch((e) => setMessage(e.message));
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
    const request = ++detailRequest.current;
    setOpeningDocument(true);
    try {
      const data = await api("detail", { documentId: id });
      if (request !== detailRequest.current) return false;
      setSignersAvailable(data.capabilities?.documentSigners === true || Array.isArray(data.document.signers));
      setRestoreAvailable(data.capabilities?.draftRestore === true);
      setAutosaveAvailable(data.capabilities?.draftAutosave === true);
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
      setFields(data.document.fields.map((field: Field) => ({ ...field, id: field.id || crypto.randomUUID() })));
      setDocumentSigners(data.document.signers || []);
      setAppliedSignatures(new Set());
      setSignatureTarget(undefined);
      setUrl(data.url || "");
      setAudit(data.audit);
      setRename(data.document.title);
      if (selected?.id !== id || selected.status !== "draft" || data.document.status !== "draft") {
        setSignature("");
        setSignatureMethod("typed");
      }
      setShowSignature(false);
      setDateApplied(false);
      setConsent(false);
      return true;
    } finally {
      if (request === detailRequest.current) setOpeningDocument(false);
    }
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
    setShareLinks([]);
    setMessage(
      "PDF uploaded. Place a signature and date field for each signer.",
    );
  }
  async function send() {
    await draftSaver.current?.flush();
    const result = await api("send", {
      documentId: selected!.id,
      fields,
      appliedSignatureFields: [...appliedSignatures],
      signers: documentSigners,
      email: documentSigners[0]?.email,
      recipientName: documentSigners[0]?.name,
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
    setShareLinks(result.links || []);
    await refreshRecipients();
    await refresh();
    await show(selected!.id);
    setMessage(
      delivery === "share"
        ? "Private signing links created. Share each link only with its named signer; links expire in 72 hours."
        : "Signing invitations sent to the document signers. Links expire in 72 hours.",
    );
  }
  const ready =
    signersAvailable &&
    documentSigners.length > 0 &&
    signature &&
    consent &&
    pdfReady &&
    ["company", ...documentSigners.map(signer => signer.id)].every((s) =>
      ["signature", "date"].every((t) =>
        fields.some((f) => f.signer === s && f.type === t),
      ),
    ) && fields.filter(field => field.signer === "company" && field.type === "signature").every(field => appliedSignatures.has(signatureFieldKey(field)));
  return (
    <div className={`admin-workspace ${selected ? "document-open" : ""}`}>
      {autosaveToast && selected?.status === "draft" && (
        <div className="autosave-toast" role="status" aria-live="polite">
          <span aria-hidden="true">✓</span> <span>{autosaveToast}</span>
        </div>
      )}
      {showSignature && (
        <SignatureDialog
          name="Lichen Wang"
          value={signature}
          method={signatureMethod}
          onClose={() => setShowSignature(false)}
          onAccept={(png, method) => {
            setSignature(png);
            if (signatureTarget) setAppliedSignatures(current => new Set([...current, signatureTarget]));
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
      {openingDocument && <Loading>Opening document…</Loading>}
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
          <aside className="card document-list" aria-busy={docsLoading}>
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
                      {!docsLoaded
                        ? "—"
                        : docs.filter(
                            (d) => value === "all" || d.status === value,
                          ).length}
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
            {docsLoading && (
              <Loading>
                {docsLoaded ? "Refreshing documents…" : "Loading documents…"}
              </Loading>
            )}
            {!docsLoading && !docsLoaded && (
              <p>Unable to load documents. Refresh to retry.</p>
            )}
            {docsLoaded && !docsLoading && !docs.length && (
              <div className="empty">
                <div className="empty-icon">▤</div>
                <h3>A fresh start</h3>
                <p>Upload a PDF or import a Google Doc.</p>
              </div>
            )}
            {docsLoaded &&
              !docsLoading &&
              docs.length > 0 &&
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
                  onPointerEnter={() => {
                    void prefetchPdfPreview().catch(() => {});
                  }}
                  onFocus={() => {
                    void prefetchPdfPreview().catch(() => {});
                  }}
                  onClick={() =>
                    task(async () => {
                      setShare("");
    setShareLinks([]);
                      if (await show(doc.id)) await refresh(true);
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
                  <span className={`badge ${documentStatus(doc)}`}>{documentStatus(doc)}</span>
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
                  onClick={goHome}
                >
                  ← Back to documents
                </button>
                <div className="split">
                  <h2>{selected.title}</h2>
                  <span className={`badge ${documentStatus(selected)}`}>
                    {documentStatus(selected)}
                  </span>
                </div>
                {selected.status === "draft" && (
                  <>
                    <form
                      className="rename"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void task(async () => {
                          await saveDraftNow();
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
                {selected.status === "draft" &&
                  recipientEditor &&
                  recipientHost &&
                  createPortal(
                    <section
                      className="recipient-tools"
                      aria-label="Manage recipient"
                    >
                      <div className="split">
                        <h3>Add document signer</h3>
                        <button
                          type="button"
                          className="secondary"
                          aria-label="Close recipient editor"
                          onClick={() => setRecipientEditor(false)}
                        >
                          ×
                        </button>
                      </div>
                      <div className="signer-source" role="group" aria-label="Add signer source">
                        <button type="button" className={recipientMode === "saved" ? "active" : "secondary"} aria-pressed={recipientMode === "saved"} onClick={() => {
                          setRecipientMode("saved"); setRecipientEditing(false); setSignerAddError("");
                          const contact = recipients.find(value => value.id === recipientId);
                          setFirst(contact?.first_name || ""); setLast(contact?.last_name || ""); setEmail(contact?.email || "");
                        }}>Choose from recipients</button>
                        <button type="button" className={recipientMode === "new" ? "active" : "secondary"} aria-pressed={recipientMode === "new"} onClick={() => { setRecipientMode("new"); setRecipientEditing(false); setSignerAddError(""); setRecipientId(""); setEmail(""); setFirst(""); setLast(""); }}>Add new signer</button>
                      </div>
                      {recipientMode === "saved" && !recipientEditing && <label>
                        Saved recipient
                        <select
                          value={recipientId}
                          onChange={(e) => {
                            setSignerAddError("");
                            setRecipientEditing(false);
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
                          <option value="">Choose a saved recipient…</option>
                          {recipients.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.first_name} {r.last_name} · {r.email}
                            </option>
                          ))}
                        </select>
                      </label>}
                      {recipientMode === "saved" && !recipientEditing && recipientId && (
                        <div className="selected-recipient-summary">
                          <strong>{`${first} ${last}`.trim() || email}</strong>
                          <span>{email}</span>
                          <button type="button" className="secondary" onClick={() => setRecipientEditing(true)}>Edit</button>
                        </div>
                      )}
                      {(recipientMode === "new" || recipientEditing) && <>
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
                      </>}
                      <button
                        type="button"
                        className="recipient-save"
                        aria-describedby={signerAddError ? "signer-add-error" : undefined}
                        disabled={busy || (recipientMode === "saved" && !recipientEditing
                          ? !recipientId
                          : !first.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))}
                        onClick={() =>
                          task(async () => {
                            setSignerAddError("");
                            try {
                            const normalizedEmail = email.trim().toLowerCase();
                            if (normalizedEmail === "readyreadymotors9999@gmail.com") throw new Error("Lichen Wang is already this document’s company signer.");
                            if (documentSigners.length >= 10 && !documentSigners.some(signer => signer.email === normalizedEmail)) throw new Error("A document can contain up to 10 additional signers.");
                            const contact = recipients.find(value => value.id === recipientId);
                            const unchangedContact = contact && contact.email.trim().toLowerCase() === normalizedEmail && contact.first_name === first.trim() && contact.last_name === last.trim();
                            const saved = (contact && recipientMode === "saved" && !recipientEditing) || unchangedContact ? { recipient: contact! } : await api("save_recipient", {
                              recipientId: recipientId || undefined,
                              email,
                              firstName: first,
                              lastName: last,
                            });
                            setRecipientId(saved.recipient.id);
                            const existing = documentSigners.find(signer => signer.email === normalizedEmail || signer.recipientId === saved.recipient.id);
                            const signer = { id: existing?.id || (documentSigners.length === 0 ? "recipient" : crypto.randomUUID()), recipientId: saved.recipient.id, email: normalizedEmail, name: `${first} ${last}`.trim() || normalizedEmail };
                            const nextSigners = existing ? documentSigners.map(value => value.id === existing.id ? signer : value) : [...documentSigners, signer];
                            setDocumentSigners(nextSigners);
                            if (draftSaver.current) {
                              draftSaver.current.update({ fields, signers: nextSigners });
                              await draftSaver.current.retry();
                            } else {
                              const result = await api("save_draft", { documentId: selected.id, expectedPath: selected.original_path, revision: selected.draft_revision || 0, fields, signers: nextSigners });
                              const confirmed = await confirmSignerRoster(selected.id, nextSigners, result.revision);
                              setAutosaveAvailable(true);
                              setSelected({ ...selected, fields, signers: nextSigners, draft_revision: confirmed.document.draft_revision });
                            }
                            setSignersAvailable(true);
                            await refreshRecipients();
                            setRecipientEditor(false);
                            setMessage(
                              "Recipient added as a signer for this document.",
                            );
                            } catch (error) {
                              const message = error instanceof Error ? error.message : "Unable to add signer.";
                              setSignerAddError(message);
                              throw error;
                            }
                          })
                        }
                      >
                        {busy ? "Saving…" : documentSigners.some(signer => signer.recipientId === recipientId) ? "Update document signer" : recipientMode === "saved" && !recipientEditing && recipientId ? "Add as signer" : "Save and add as signer"}
                      </button>
                      {signerAddError && <p id="signer-add-error" className="error" role="alert">{signerAddError}</p>}
                      {documentSigners.some(signer => signer.email === email.trim().toLowerCase()) && (
                        <button type="button" className="secondary danger-link" disabled={busy} onClick={() => {
                          const signer = documentSigners.find(signer => signer.email === email.trim().toLowerCase());
                          if (!signer || !window.confirm(`Remove ${signer.name} and their assigned fields from this document?`)) return;
                          setFields(current => current.filter(field => field.signer !== signer.id));
                          setDocumentSigners(current => current.filter(value => value.id !== signer.id));
                          setRecipientEditor(false);
                        }}>Remove signer from document</button>
                      )}
                      <small className="block">
                        Only people explicitly added here appear in this document’s signer list. Saved contacts are not added automatically.
                      </small>
                    </section>,
                    recipientHost,
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
                    {!signersAvailable && <p className="notice">Deploy the document signer backend update before sending invitations.</p>}
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
                        Signature style ready · {today}
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
                    <p className={`draft-save-status ${saveStatus.startsWith("Draft not saved") ? "error" : ""}`} aria-live="polite">
                      {autosaveAvailable ? saveStatus : "Automatic draft saving requires the backend update. Fields are not saved yet."}
                    </p>
                    {autosaveAvailable && saveStatus.startsWith("Draft not saved") && (
                      <button type="button" className="secondary" onClick={() => void draftSaver.current?.retry().catch(() => {})}>Retry saving draft</button>
                    )}
                    {autosaveAvailable && <small>Use Save draft to save now. Unsaved field changes autosave every 5 minutes. Signatures must be applied again when reopening a draft.</small>}
                    <button disabled={busy || !ready || saveStatus.startsWith("Draft not saved")}>
                      {busy
                        ? "Preparing…"
                        : delivery === "share"
                          ? (documentSigners.length > 1 ? "Sign & create share links →" : "Sign & create share link →")
                          : (documentSigners.length > 1 ? "Sign & email signers →" : "Sign & email recipient →")}
                    </button>
                    <small className="block">
                      Only signers added to this document are invited. Everyone’s signatures remain in the completed PDF.
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
                {selected.status === "draft" && (
                  <div className="draft-actions" role="toolbar" aria-label="Draft editing actions">
                    <button type="button" className="secondary" title="Undo" aria-label="Undo draft edit" disabled={busy || !restoreAvailable || !canUndo} onClick={() => void task(() => restoreHistory("undo"))}>↶</button>
                    <button type="button" className="secondary" title="Redo" aria-label="Redo draft edit" disabled={busy || !restoreAvailable || !canRedo} onClick={() => void task(() => restoreHistory("redo"))}>↷</button>
                    <button type="button" className="secondary" disabled={busy || !restoreAvailable || !canDiscard} onClick={() => {
                      if (window.confirm("Discard all document edits since you opened this editor, including changes already autosaved?")) void task(() => restoreHistory("discard"));
                    }}>Discard all changes</button>
                    <button type="button" disabled={busy || !autosaveAvailable} onClick={() => void task(saveDraftNow)}>Save draft</button>
                  </div>
                )}

                <div className="document-scroll">
                  {url && (
                    <Pdf
                      key={`${selected.id}-${selected.status}`}
                      url={url}
                      cacheKey={
                        selected.owner_id
                          ? `${selected.owner_id}:${selected.id}:${selected.status}:${selected.signed_path || (selected.status === "sent" ? selected.working_path || selected.prepared_path : null) || selected.original_path}`
                          : undefined
                      }
                      fields={
                        selected.status === "completed"
                          ? []
                          : selected.status === "sent"
                            ? fields.filter((f) => f.signer !== "company" && !selected.signed_signer_ids?.includes(f.signer || "recipient"))
                            : fields
                      }
                      place={
                        selected.status === "draft"
                          ? (field) => {
                              if (!busy) setFields([...fields, { ...field, id: crypto.randomUUID() }]);
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
                                if (field.type === "signature") {
                                  const key = signatureFieldKey(field);
                                  if (appliedSignatures.has(key)) return;
                                  if (signature) {
                                    setAppliedSignatures(current => new Set([...current, key]));
                                    setConsent(true); setDateApplied(true);
                                  } else { setSignatureTarget(key); setShowSignature(true); }
                                } else setDateApplied(true);
                              }
                            }
                          : undefined
                      }
                      updateField={
                        selected.status === "draft"
                          ? (i, patch) => {
                              if (!busy) {
                                if (patch.signer && patch.signer !== fields[i].signer) setAppliedSignatures(current => { const next = new Set(current); next.delete(signatureFieldKey(fields[i])); return next; });
                                setFields(
                                  fields.map((f, j) =>
                                    i === j ? { ...f, ...patch } : f,
                                  ),
                                );
                              }
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
                                  id: crypto.randomUUID(),
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
                      appliedSignatureFields={appliedSignatures}
                      editableSigners={["company"]}
                      onChangeSignature={(_, field) => { setSignatureTarget(signatureFieldKey(field)); setShowSignature(true); }}
                      signerNames={Object.fromEntries([["company", "Lichen Wang"], ...documentSigners.map(signer => [signer.id, signer.name])])}
                      onRecipientHost={setRecipientHost}
                      onChooseRecipient={(id) => {
                        setRecipientMode(id === "__new" ? "new" : "saved");
                        setSignerAddError("");
                        const signer = documentSigners.find(signer => signer.id === id);
                        setRecipientEditing(!!signer);
                        if (signer) {
                          const contact = recipients.find(contact => contact.email === signer.email);
                          setRecipientId(contact?.id || signer.recipientId || ""); setEmail(signer.email);
                          setFirst(contact?.first_name || signer.name.split(" ")[0]); setLast(contact?.last_name || signer.name.split(" ").slice(1).join(" "));
                        } else { setRecipientId(""); setEmail(""); setFirst(""); setLast(""); }
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
                                await draftSaver.current?.flush();
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
                  {shareLinks.length > 1 && <div className="share-panel"><h3>Private signing links</h3>{shareLinks.map(item => <label key={item.email}>{item.name} · {item.email}<input aria-label={`Signing link for ${item.email}`} readOnly value={item.link} onFocus={event => event.target.select()} /></label>)}</div>}
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
    setShareLinks([]);
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
