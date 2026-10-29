export class ValidationError extends Error {}
export type Field = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  type: "signature" | "date";
};
export function emailAddress(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)
  )
    throw new ValidationError("Enter a valid recipient email.");
  return value.trim().toLowerCase();
}
export function validateFields(value: unknown, pageCount: number): Field[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50)
    throw new ValidationError("Place between 1 and 50 fields.");
  const fields = value.map((f) => {
    if (
      !f ||
      !["signature", "date"].includes(f.type) ||
      !Number.isInteger(f.page) ||
      f.page < 1 ||
      f.page > pageCount ||
      ![f.x, f.y, f.width, f.height].every(
        (v) => typeof v === "number" && Number.isFinite(v),
      ) ||
      f.x < 0 ||
      f.y < 0 ||
      f.width < 0.05 ||
      f.height < 0.02 ||
      f.x + f.width > 1.000001 ||
      f.y + f.height > 1.000001
    )
      throw new ValidationError("A signing field is outside the PDF page.");
    return {
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      type: f.type,
    } as Field;
  });
  if (!fields.some((f) => f.type === "signature"))
    throw new ValidationError("Place at least one signature field.");
  return fields;
}
export function tokenValue(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new ValidationError("Signing link is unavailable.");
  return value;
}
// PDF.js displays the cropped page with its inherited rotation. Map its top-left
// normalized field rectangle back into PDF user space for pdf-lib drawing.
export function placement(
  f: Field,
  crop: { x: number; y: number; width: number; height: number },
  rotation: number,
) {
  const { x: cx, y: cy, width: w, height: h } = crop;
  const r = ((rotation % 360) + 360) % 360;
  if (r === 0)
    return {
      x: cx + f.x * w,
      y: cy + (1 - f.y - f.height) * h,
      width: f.width * w,
      height: f.height * h,
      rotation: r,
    };
  if (r === 90)
    return {
      x: cx + (f.y + f.height) * w,
      y: cy + f.x * h,
      width: f.width * h,
      height: f.height * w,
      rotation: r,
    };
  if (r === 180)
    return {
      x: cx + (1 - f.x) * w,
      y: cy + (f.y + f.height) * h,
      width: f.width * w,
      height: f.height * h,
      rotation: r,
    };
  if (r === 270)
    return {
      x: cx + (1 - f.y - f.height) * w,
      y: cy + (1 - f.x) * h,
      width: f.width * h,
      height: f.height * w,
      rotation: r,
    };
  throw new ValidationError("Unsupported PDF rotation.");
}
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
