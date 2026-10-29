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
}: {
  url: string;
  fields: Field[];
  place?: (field: Field) => void;
  remove?: (index: number) => void;
  onReady?: (ready: boolean) => void;
}) {
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy>();
  const [error, setError] = useState("");
  const [type, setType] = useState<"signature" | "date">("signature");
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
    <div>
      {place && (
        <div className="toolbar">
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
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {!pdf && !error && <p>Loading document…</p>}
      {pdf &&
        Array.from({ length: pdf.numPages }, (_, i) => (
          <Page
            key={i}
            pdf={pdf}
            page={i + 1}
            fields={fields}
            place={place}
            remove={remove}
            type={type}
            onRendered={pageReady}
            onFailure={pageError}
          />
        ))}
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
              className={`field ${f.type}`}
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
              {f.type === "signature" ? "✎ Sign here" : "Date (UTC)"}
            </button>
          ),
      )}
      <span className="page-number">Page {page}</span>
    </div>
  );
}
