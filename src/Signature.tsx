import { useEffect, useRef, useState } from "react";
export type SignatureMethod = "drawn" | "typed";
// Keep the server's 900×240 PNG format while filling it with the actual ink.
function fitTypedInk(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d")!;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let left = canvas.width,
    top = canvas.height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++)
      if (data[(y * canvas.width + x) * 4 + 3]) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (right < left) return;
  const width = right - left + 1,
    height = bottom - top + 1;
  const scale = Math.min(
    (canvas.width - 36) / width,
    (canvas.height - 36) / height,
  );
  const fitted = document.createElement("canvas");
  fitted.width = canvas.width;
  fitted.height = canvas.height;
  fitted
    .getContext("2d")!
    .drawImage(
      canvas,
      left,
      top,
      width,
      height,
      (canvas.width - width * scale) / 2,
      (canvas.height - height * scale) / 2,
      width * scale,
      height * scale,
    );
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(fitted, 0, 0);
}
export function Signature({
  onChange,
  onMethodChange,
  defaultName = "",
  initialMethod = "typed",
}: {
  onChange: (value: string) => void;
  onMethodChange?: (method: SignatureMethod) => void;
  defaultName?: string;
  initialMethod?: SignatureMethod;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false),
    ink = useRef(false),
    edited = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [method, setMethod] = useState<SignatureMethod>(initialMethod);
  const [typedName, setTypedName] = useState(defaultName);
  useEffect(() => {
    if (!edited.current) setTypedName(defaultName);
  }, [defaultName]);
  useEffect(() => {
    if (method !== "typed") return;
    const canvas = ref.current!,
      ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const text = typedName.trim();
    if (!text) {
      onChange("");
      return;
    }
    ctx.fillStyle = "#142e43";
    const font = '"Brush Script MT", "Segoe Script", cursive';
    ctx.font = `italic 180px ${font}`;
    const size = Math.min(
      180,
      (180 * 840) / Math.max(1, ctx.measureText(text).width),
    );
    ctx.font = `italic ${size}px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2, 840);
    fitTypedInk(canvas);
    onChange(canvas.toDataURL("image/png"));
  }, [method, typedName, onChange]);
  function clearCanvas() {
    const canvas = ref.current!,
      ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawing.current = false;
    ink.current = false;
    setHasInk(false);
    onChange("");
  }
  function choose(next: SignatureMethod) {
    if (next === method) return;
    clearCanvas();
    setMethod(next);
    onMethodChange?.(next);
  }
  function finish() {
    if (drawing.current && ink.current)
      onChange(ref.current!.toDataURL("image/png"));
    drawing.current = false;
  }
  return (
    <div className="signature-widget">
      <div
        className="signature-methods"
        role="group"
        aria-label="Signature method"
      >
        <button
          type="button"
          aria-pressed={method === "typed"}
          className={method === "typed" ? "active" : "secondary"}
          onClick={() => choose("typed")}
        >
          Type signature
        </button>
        <button
          type="button"
          aria-pressed={method === "drawn"}
          className={method === "drawn" ? "active" : "secondary"}
          onClick={() => choose("drawn")}
        >
          Draw signature
        </button>
      </div>
      {method === "typed" && (
        <label>
          Type your signature name
          <input
            maxLength={150}
            value={typedName}
            onChange={(e) => {
              edited.current = true;
              setTypedName(e.target.value);
            }}
            placeholder="Your full name"
            autoComplete="name"
          />
        </label>
      )}
      <canvas
        aria-label={
          method === "drawn" ? "Draw your signature" : "Typed signature preview"
        }
        className={`signature-pad ${method}`}
        width={900}
        height={240}
        ref={ref}
        onPointerDown={(e) => {
          if (method !== "drawn") return;
          const canvas = ref.current!,
            r = canvas.getBoundingClientRect(),
            ctx = canvas.getContext("2d")!;
          canvas.setPointerCapture(e.pointerId);
          drawing.current = true;
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.strokeStyle = "#142e43";
          ctx.beginPath();
          ctx.moveTo(
            ((e.clientX - r.left) * canvas.width) / r.width,
            ((e.clientY - r.top) * canvas.height) / r.height,
          );
        }}
        onPointerMove={(e) => {
          if (method !== "drawn" || !drawing.current) return;
          const canvas = ref.current!,
            r = canvas.getBoundingClientRect(),
            ctx = canvas.getContext("2d")!;
          ctx.lineTo(
            ((e.clientX - r.left) * canvas.width) / r.width,
            ((e.clientY - r.top) * canvas.height) / r.height,
          );
          ctx.stroke();
          ink.current = true;
          setHasInk(true);
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      />
      <div className="split">
        <small>
          {method === "typed"
            ? "Preview of the exact signature image that will be placed in your fields."
            : hasInk
              ? "Your signature will appear in your assigned signature fields."
              : "Draw with your finger, mouse, or stylus."}
        </small>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            clearCanvas();
            if (method === "typed") {
              edited.current = true;
              setTypedName("");
            }
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
