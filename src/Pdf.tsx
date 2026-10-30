import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parsePageRange } from "../supabase/functions/_shared/page-range.ts";
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
  toolsHost,
  externalTools = false,
  rangeEditing = false,
  onFieldActivate,
  updateField,
  duplicateField,
  signaturePreviews = {},
  datePreviews = {},
  signerNames = {},
}: {
  url: string;
  fields: Field[];
  place?: (field: Field) => void;
  remove?: (index: number) => void;
  onReady?: (ready: boolean) => void;
  onEdit?: (
    operation: "delete" | "delete-range" | "blank" | "append" | "replace",
    page: number,
    file?: File,
    range?: string,
  ) => void;
  busy?: boolean;
  toolsHost?: HTMLElement | null;
  externalTools?: boolean;
  rangeEditing?: boolean;
  onFieldActivate?: (index: number, field: Field) => void;
  updateField?: (index: number, patch: Partial<Field>) => void;
  duplicateField?: (index: number) => void;
  signaturePreviews?: Partial<Record<"company" | "recipient", string>>;
  datePreviews?: Partial<Record<"company" | "recipient", string>>;
  signerNames?: Partial<Record<"company" | "recipient", string>>;
}) {
  const [activeField, setActiveField] = useState<number>();
  const [menuField, setMenuField] = useState<number>();
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy>();
  const [error, setError] = useState("");
  const [signer, setSigner] = useState<"company" | "recipient">("company");
  const [type, setType] = useState<"signature" | "date">("signature");
  const [customRange, setCustomRange] = useState("");
  const [rangeError, setRangeError] = useState("");
  const [editPage, setEditPage] = useState(1);
  useEffect(() => {
    if (pdf) setEditPage((p) => Math.min(p, pdf.numPages));
  }, [pdf]);
  const rendered = useRef(new Set<number>());
  useEffect(() => {
    rendered.current.clear();
    onReady?.(false);
    setPdf(undefined);
    setActiveField(undefined);
    setMenuField(undefined);
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
  const tools = place ? (
    <aside className="toolbar pdf-tools" aria-label="PDF editing tools">
      <label className="field-signer">
        Field signer
        <select
          aria-label="Field signer"
          value={signer}
          onChange={(e) => setSigner(e.target.value as "company" | "recipient")}
        >
          <option value="company">Lichen Wang</option>
          <option value="recipient">
            {signerNames.recipient || "Recipient"}
          </option>
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
      <small>
        Click a field to sign or select it. Use its signer selector or settings
        menu to reassign, duplicate, or delete it.
      </small>
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
          {rangeEditing && (
            <div className="range-delete">
              <label>
                Custom page range
                <input
                  value={customRange}
                  onChange={(e) => {
                    setCustomRange(e.target.value);
                    setRangeError("");
                  }}
                  placeholder="1-3, 4, 7"
                />
              </label>
              <button
                type="button"
                className="secondary"
                disabled={busy || !customRange.trim()}
                onClick={() => {
                  try {
                    const pages = parsePageRange(customRange, pdf.numPages);
                    if (pages.length >= pdf.numPages)
                      throw new Error(
                        "Keep at least one page in the document.",
                      );
                    if (
                      confirm(
                        `Delete pages ${pages.join(", ")}? Fields on those pages will also be removed.`,
                      )
                    ) {
                      onEdit("delete-range", editPage, undefined, customRange);
                      setCustomRange("");
                    }
                  } catch (e) {
                    setRangeError((e as Error).message);
                  }
                }}
              >
                Delete custom page range
              </button>
              {rangeError && (
                <small role="alert" className="range-error">
                  {rangeError}
                </small>
              )}
            </div>
          )}
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
            Replace entire PDF
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
            Edits save immediately. Original revisions stay private. Only drafts
            can be edited.
          </small>
        </div>
      )}
    </aside>
  ) : null;
  return (
    <div
      className={place && !externalTools ? "pdf-editor-layout" : "pdf-viewer"}
    >
      {externalTools
        ? toolsHost && tools
          ? createPortal(tools, toolsHost)
          : null
        : tools}
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
              activeField={activeField}
              menuField={menuField}
              onMenu={(index) =>
                setMenuField(menuField === index ? undefined : index)
              }
              onActivate={(index, field) => {
                setActiveField(index);
                setMenuField(undefined);
                onFieldActivate?.(index, field);
              }}
              updateField={updateField}
              duplicateField={
                duplicateField
                  ? (index) => {
                      duplicateField(index);
                      setActiveField(fields.length);
                      setMenuField(undefined);
                    }
                  : undefined
              }
              onDelete={
                remove
                  ? (index) => {
                      remove(index);
                      setActiveField(undefined);
                      setMenuField(undefined);
                    }
                  : undefined
              }
              signaturePreviews={signaturePreviews}
              datePreviews={datePreviews}
              signerNames={signerNames}
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
  activeField,
  menuField,
  onMenu,
  onActivate,
  updateField,
  duplicateField,
  onDelete,
  signaturePreviews,
  datePreviews,
  signerNames,
}: {
  pdf: pdfjs.PDFDocumentProxy;
  page: number;
  fields: Field[];
  place?: (f: Field) => void;
  remove?: (i: number) => void;
  type: Field["type"];
  onRendered: (page: number) => void;
  onFailure: () => void;
  activeField?: number;
  menuField?: number;
  onMenu: (index: number) => void;
  onActivate: (index: number, field: Field) => void;
  updateField?: (index: number, patch: Partial<Field>) => void;
  duplicateField?: (index: number) => void;
  onDelete?: (index: number) => void;
  signaturePreviews: Partial<Record<"company" | "recipient", string>>;
  datePreviews: Partial<Record<"company" | "recipient", string>>;
  signerNames: Partial<Record<"company" | "recipient", string>>;
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
      {fields.map((f, i) => {
        if (f.page !== page) return null;
        const owner = f.signer || "recipient",
          preview =
            f.type === "signature"
              ? signaturePreviews[owner]
              : datePreviews[owner];
        return (
          <div
            key={i}
            className={`field ${f.type} ${owner} ${activeField === i ? "selected-field" : ""} ${preview ? "filled-field" : ""}`}
            style={{
              left: `${f.x * 100}%`,
              top: `${f.y * 100}%`,
              width: `${f.width * 100}%`,
              height: `${f.height * 100}%`,
            }}
            role="group"
            aria-label={`${f.type} field on page ${page}`}
          >
            <button
              type="button"
              className="field-content"
              aria-label={`Open ${owner} ${f.type} field ${i + 1} on page ${page}`}
              onClick={(e) => {
                e.stopPropagation();
                onActivate(i, f);
              }}
            >
              {preview ? (
                f.type === "signature" ? (
                  <img
                    src={preview}
                    alt={`${signerNames[owner] || owner} signature preview`}
                  />
                ) : (
                  <span className="date-value">{preview}</span>
                )
              ) : (
                <span className="field-label">
                  {signerNames[owner] ||
                    (owner === "company" ? "Lichen Wang" : "Recipient")}{" "}
                  · {f.type === "signature" ? "Signature" : "Date"}
                </span>
              )}
            </button>
            {updateField && activeField === i && (
              <div
                className={`field-controls ${f.y < 0.1 ? "below" : ""} ${f.x > 0.3 ? "align-right" : ""}`}
                onClick={(e) => e.stopPropagation()}
              >
                <select
                  aria-label={`Signer for field ${i + 1}`}
                  value={owner}
                  onChange={(e) =>
                    updateField(i, {
                      signer: e.target.value as "company" | "recipient",
                    })
                  }
                >
                  <option value="company">Lichen Wang</option>
                  <option value="recipient">
                    {signerNames.recipient || "Recipient"}
                  </option>
                </select>
                <button
                  type="button"
                  className="field-settings"
                  aria-label={`Field settings ${i + 1}`}
                  aria-expanded={menuField === i}
                  onClick={() => onMenu(i)}
                >
                  ⚙
                </button>
                {menuField === i && (
                  <div className="field-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        duplicateField?.(i);
                        onMenu(i);
                      }}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="danger-link"
                      onClick={() => onDelete?.(i)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      <span className="page-number">Page {page}</span>
    </div>
  );
}
