export class ValidationError extends Error {}
export type Field = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  type: "signature" | "date";
  signer?: string;
  id?: string;
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
export function validateFields(
  value: unknown,
  pageCount: number,
  requireSignature = true,
): Field[] {
  if (
    !Array.isArray(value) ||
    value.length < (requireSignature ? 1 : 0) ||
    value.length > 50
  )
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
      f.height < 0.01 ||
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
      ...(f.signer ? { signer: f.signer } : {}),
      ...(typeof f.id === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(f.id) ? { id: f.id } : {}),
    } as Field;
  });
  if (requireSignature && !fields.some((f) => f.type === "signature"))
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

export function twoPartyFields(value: unknown, pages: number): Field[] {
  const fields = validateFields(value, pages);
  if (fields.some((f) => f.signer !== "company" && f.signer !== "recipient"))
    throw new ValidationError(
      "Assign every field to Lichen Wang or the recipient.",
    );
  for (const signer of ["company", "recipient"])
    for (const type of ["signature", "date"]) {
      if (!fields.some((f) => f.signer === signer && f.type === type))
        throw new ValidationError(
          "Place a signature and date field for each signer.",
        );
    }
  return fields;
}
export function signaturePng(value: unknown): Uint8Array {
  if (
    typeof value !== "string" ||
    !value.startsWith("data:image/png;base64,") ||
    value.length > 350000
  )
    throw new ValidationError("Provide a valid drawn signature.");
  let png: Uint8Array;
  try {
    png = Uint8Array.from(atob(value.slice(22)), (c) => c.charCodeAt(0));
  } catch {
    throw new ValidationError("Invalid signature image.");
  }
  if (
    png.length < 33 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => png[i] === v) ||
    new DataView(png.buffer).getUint32(16) !== 900 ||
    new DataView(png.buffer).getUint32(20) !== 240
  )
    throw new ValidationError("Invalid signature dimensions.");
  return png;
}

export function signatureMethodValue(value: unknown): "drawn" | "typed" {
  if (value === undefined) return "drawn"; // Existing clients remain compatible.
  if (value !== "drawn" && value !== "typed")
    throw new ValidationError("Choose a typed or drawn signature.");
  return value;
}

export type DocumentSigner = { id: string; name: string; email: string; recipientId?: string };
export function documentSigners(value: unknown): DocumentSigner[] {
  if (!Array.isArray(value) || value.length > 10) throw new ValidationError("Choose up to 10 document signers.");
  const ids = new Set<string>(), emails = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(entry.id) || entry.id === "company" || typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 150)
      throw new ValidationError("Invalid document signer.");
    const email = emailAddress(entry.email);
    if (ids.has(entry.id) || emails.has(email) || email === "readyreadymotors9999@gmail.com") throw new ValidationError("Each signer must have a unique email.");
    ids.add(entry.id); emails.add(email);
    return { id: entry.id, name: entry.name.trim(), email, ...(typeof entry.recipientId === "string" ? { recipientId: entry.recipientId } : {}) };
  });
}
export function documentFields(value: unknown, pages: number, signers: DocumentSigner[], requireComplete = true) {
  const fields = validateFields(value, pages, requireComplete);
  const ids = ["company", ...signers.map(signer => signer.id)];
  const fieldIds = fields.map(signatureFieldKey);
  if (new Set(fieldIds).size !== fieldIds.length) throw new ValidationError("Each field must have a unique identifier.");
  if (fields.some(field => !ids.includes(field.signer || ""))) throw new ValidationError("Choose a signer added to this document.");
  if (requireComplete) for (const id of ids) for (const type of ["signature", "date"])
    if (!fields.some(field => field.signer === id && field.type === type)) throw new ValidationError("Place a signature and date field for every document signer.");
  return fields;
}
export function signatureFieldKey(field: Field) {
  return field.id || [field.page,field.type,field.signer || "recipient",field.x,field.y,field.width,field.height].join(":");
}
export function requireAppliedSignatures(fields: Field[], applied: unknown) {
  if (!Array.isArray(applied) || fields.some(field => field.type === "signature" && !applied.includes(signatureFieldKey(field))))
    throw new ValidationError("Click and sign every assigned signature box before submitting.");
}
