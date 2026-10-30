import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Field } from "./api";
pdfjs.GlobalWorkerOptions.workerSrc = worker;
export function Pdf({
  url,
  fields,
  place,
  remove,
  onReady,
  onEdit,
  busy = false,
}: {
  url: string;
  fields: Field[];
  place?: (field: Field) => void;
  remove?: (index: number) => void;
  onReady?: (ready: boolean) => void;
  onEdit?: (
    operation: "delete" | "blank" | "append" | "replace",
    page: number,
    file?: File,
  ) => void;
  busy?: boolean;
}) {
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy>();
  const [error, setError] = useState("");
  const [signer, setSigner] = useState<"company" | "recipient">("company");
  const [type, setType] = useState<"signature" | "date">("signature");
  const [editPage, setEditPage] = useState(1);
  useEffect(() => {
    if (pdf) setEditPage((p) => Math.min(p, pdf.numPages));
  }, [pdf]);
  const rendered = useRef(new Set<number>());
  useEffect(() => {
    rendered.current.clear();
    onReady?.(false);
    setPdf(undefined);
    setError("");
    let active = true;
    const task = pdfjs.getDocument({ url });
    task.promise
      .then((document) => {
        if (active) setPdf(document);
      })
      .catch(() => {
        if (active)
          setError(
            "Unable to render PDF. Refresh to request a new document link.",
          );
      });
    return () => {
      active = false;
      void task.destroy();
    };
  }, [url, onReady]);
  const pageReady = useCallback(
    (page: number) => {
      rendered.current.add(page);
      if (rendered.current.size === pdf?.numPages) onReady?.(true);
    },
    [pdf, onReady],
  );
  const pageError = useCallback(() => {
    setError("Unable to render a PDF page. Refresh before signing.");
    onReady?.(false);
  }, [onReady]);
  return (
    <div className={place ? "pdf-editor-layout" : "pdf-viewer"}>
      {place && (
        <aside className="toolbar pdf-tools" aria-label="PDF editing tools">
          <label className="field-signer">
            Field signer
            <select
              aria-label="Field signer"
              value={signer}
              onChange={(e) =>
                setSigner(e.target.value as "company" | "recipient")
              }
            >
              <option value="company">Lichen Wang</option>
              <option value="recipient">Recipient</option>
            </select>
          </label>
          <span>Place field</span>
          <button
            className={type === "signature" ? "active" : "secondary"}
            onClick={() => setType("signature")}
          >
            Signature
          </button>
          <button
            className={type === "date" ? "active" : "secondary"}
            onClick={() => setType("date")}
          >
            Date
          </button>
          <small>Click a page to place. Click a field to remove.</small>
          {onEdit && pdf && (
            <div className="page-tools">
              <h3>Edit PDF</h3>
              <label>
                Selected page
                <select
                  value={editPage}
                  onChange={(e) => setEditPage(Number(e.target.value))}
                >
                  {Array.from({ length: pdf.numPages }, (_, i) => (
                    <option key={i} value={i + 1}>
                      Page {i + 1}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || pdf.numPages >= 100}
                className="secondary"
                onClick={() => onEdit("blank", editPage)}
              >
                Add blank page after
              </button>
              <button
                type="button"
                disabled={busy || pdf.numPages <= 1}
                className="secondary"
                onClick={() => {
                  if (
                    confirm(
                      `Delete page ${editPage}? Fields on that page will also be removed.`,
                    )
                  )
                    onEdit("delete", editPage);
                }}
              >
                Delete selected page
              </button>
              <label
                className={`button secondary file-tool ${busy ? "disabled" : ""}`}
              >
                Append PDF
                <input
                  hidden
                  disabled={busy}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) onEdit("append", editPage, file);
                  }}
                />
              </label>
              <label
                className={`button secondary file-tool ${busy ? "disabled" : ""}`}
              >
                Replace PDF
                <input
                  hidden
                  disabled={busy}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (
                      file &&
                      confirm(
                        "Replace the draft PDF? All placed fields and the current signature will be cleared.",
                      )
                    )
                      onEdit("replace", editPage, file);
                  }}
                />
              </label>
              <small>
                Edits save immediately. Original revisions stay private. Only
                drafts can be edited.
              </small>
            </div>
          )}
        </aside>
      )}
      <div className="pdf-pages">
        {error && <p role="alert">{error}</p>}
        {!pdf && !error && <p>Loading document…</p>}
        {pdf &&
          Array.from({ length: pdf.numPages }, (_, i) => (
            <Page
              key={i}
              pdf={pdf}
              page={i + 1}
              fields={fields}
              place={place ? (f) => place({ ...f, signer }) : undefined}
              remove={remove}
              type={type}
              onRendered={pageReady}
              onFailure={pageError}
            />
          ))}
      </div>
    </div>
  );
}
function Page({
  pdf,
  page,
  fields,
  place,
  remove,
  type,
  onRendered,
  onFailure,
}: {
  pdf: pdfjs.PDFDocumentProxy;
  page: number;
  fields: Field[];
  place?: (f: Field) => void;
  remove?: (i: number) => void;
  type: Field["type"];
  onRendered: (page: number) => void;
  onFailure: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(1.294);
  useEffect(() => {
    let cancelled = false;
    let render: pdfjs.RenderTask | undefined;
    pdf
      .getPage(page)
      .then((p) => {
        if (cancelled || !canvas.current) return;
        const viewport = p.getViewport({ scale: 1.5 });
        setRatio(viewport.height / viewport.width);
        canvas.current.width = viewport.width;
        canvas.current.height = viewport.height;
        render = p.render({ canvas: canvas.current, viewport });
        return render.promise.then(() => {
          if (!cancelled) onRendered(page);
        });
      })
      .catch((e) => {
        if (!cancelled && e?.name !== "RenderingCancelledException")
          onFailure();
      });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [pdf, page, onRendered, onFailure]);
  return (
    <div
      className="pdf-page"
      style={{ aspectRatio: `1 / ${ratio}` }}
      onClick={(event) => {
        if (!place) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const width = type === "signature" ? 0.28 : 0.22,
          height = 0.065;
        place({
          page,
          type,
          width,
          height,
          x: Math.max(
            0,
            Math.min(1 - width, (event.clientX - rect.left) / rect.width),
          ),
          y: Math.max(
            0,
            Math.min(1 - height, (event.clientY - rect.top) / rect.height),
          ),
        });
      }}
    >
      <canvas ref={canvas} />
      {fields.map(
        (f, i) =>
          f.page === page && (
            <button
              key={i}
              className={`field ${f.type} ${f.signer || "recipient"}`}
              style={{
                left: `${f.x * 100}%`,
                top: `${f.y * 100}%`,
                width: `${f.width * 100}%`,
                height: `${f.height * 100}%`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                remove?.(i);
              }}
              aria-label={`${f.type} field on page ${page}${remove ? ", remove" : ""}`}
            >
              {f.signer === "company" ? "Lichen · " : "Recipient · "}
              {f.type === "signature" ? "Signature" : "Date (UTC)"}
            </button>
          ),
      )}
      <span className="page-number">Page {page}</span>
    </div>
  );
}
