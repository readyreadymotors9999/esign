import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { validateFields, placement } from "./validation.ts";
export async function sha256(value: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", value as BufferSource),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export async function generateSignedPdf(
  source: Uint8Array,
  png: Uint8Array,
  doc: { id: string; fields: unknown },
  sessionId: string,
  email: string,
  name: string,
  now: string,
  authentication = "Possession of a private signing link",
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(source);
  const fields = validateFields(doc.fields, pdf.getPageCount());
  const image = await pdf.embedPng(png),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  const date = now.slice(0, 10);
  for (const field of fields) {
    const page = pdf.getPage(field.page - 1),
      box = placement(field, page.getCropBox(), page.getRotation().angle);
    if (field.type === "signature") {
      const scale = Math.min(
        box.width / image.width,
        box.height / image.height,
      );
      page.drawImage(image, {
        x: box.x,
        y: box.y,
        width: image.width * scale,
        height: image.height * scale,
        rotate: degrees(box.rotation),
      });
    } else {
      const size = Math.min(
        14,
        box.height * 0.65,
        box.width / font.widthOfTextAtSize(date, 1),
      );
      page.drawText(date, {
        x: box.x,
        y: box.y,
        size,
        font,
        rotate: degrees(box.rotation),
        color: rgb(0.08, 0.15, 0.2),
      });
    }
  }
  // A simple completion certificate is part of the signed PDF. The hash of the
  // final bytes lives in the immutable, server-only audit record (no circular hash).
  const cert = pdf.addPage([612, 792]);
  const lines = [
    "READY READY MOTORS, INC.",
    "Electronic signature certificate",
    `Document ID: ${doc.id}`,
    `Session ID: ${sessionId}`,
    `Signed at (UTC): ${now}`,
    `Recipient: ${email}`,
    `Signer: ${name}`,
    "Consent: agreed to electronic records and a binding signature.",
    `Authentication: ${authentication}.`,
    `Input PDF SHA-256: ${await sha256(source)}`,
  ];
  let y = 740;
  for (const line of lines) {
    const safe = line.replace(/[^\x20-\x7e]/g, "?");
    for (let i = 0; i < safe.length; i += 85) {
      cert.drawText(safe.slice(i, i + 85), { x: 40, y, size: 10, font });
      y -= 20;
    }
    y -= 8;
  }
  cert.drawText(
    "Full signer name is preserved in the electronic audit record.",
    { x: 40, y: y - 10, size: 9, font },
  );
  return await pdf.save();
}
