import { useEffect, useRef, useState } from "react";
export function Signature({ onChange }: { onChange: (value: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const ink = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  useEffect(() => {
    const ctx = ref.current!.getContext("2d")!;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#142e43";
  }, []);
  return (
    <div>
      <canvas
        aria-label="Draw your signature"
        className="signature-pad"
        width={900}
        height={240}
        ref={ref}
        onPointerDown={(e) => {
          const canvas = ref.current!,
            r = canvas.getBoundingClientRect(),
            ctx = canvas.getContext("2d")!;
          canvas.setPointerCapture(e.pointerId);
          drawing.current = true;
          ctx.beginPath();
          ctx.moveTo(
            ((e.clientX - r.left) * canvas.width) / r.width,
            ((e.clientY - r.top) * canvas.height) / r.height,
          );
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
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
        onPointerUp={() => {
          if (drawing.current && ink.current)
            onChange(ref.current!.toDataURL("image/png"));
          drawing.current = false;
        }}
        onPointerCancel={() => {
          drawing.current = false;
          if (ink.current) onChange(ref.current!.toDataURL("image/png"));
        }}
      />
      <div className="split">
        <small>
          {hasInk
            ? "Your signature will appear in every signature field."
            : "Draw your signature with your finger, mouse, or stylus."}
        </small>
        <button
          className="secondary"
          onClick={() => {
            ref.current!.getContext("2d")!.clearRect(0, 0, 900, 240);
            onChange("");
            ink.current = false;
            setHasInk(false);
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
