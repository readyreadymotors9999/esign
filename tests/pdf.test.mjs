import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, degrees } from "pdf-lib";
import {
  generateSignedPdf,
  sha256,
} from "../supabase/functions/_shared/pdf.ts";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  createCanvas,
  DOMMatrix,
  Path2D,
  ImageData,
} = require("@napi-rs/canvas");
Object.assign(globalThis, { DOMMatrix, Path2D, ImageData });
test("server-generated PDF preserves rotated pages, adds signature/date and certificate", async () => {
  const pdf = await PDFDocument.create();
  for (const rotation of [0, 90, 180, 270]) {
    const p = pdf.addPage([600, 800]);
    p.setCropBox(20, 30, 560, 740);
    p.setRotation(degrees(rotation));
  }
  const original = await pdf.save();
  const pad = createCanvas(900, 240),
    ctx = pad.getContext("2d");
  ctx.fillStyle = "#123d35";
  ctx.fillRect(20, 40, 850, 150);
  const png = new Uint8Array(pad.toBuffer("image/png"));
  const fields = Array.from({ length: 4 }, (_, i) => [
    { page: i + 1, type: "signature", x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
    { page: i + 1, type: "date", x: 0.1, y: 0.5, width: 0.3, height: 0.05 },
  ]).flat();
  const bytes = await generateSignedPdf(
    original,
    png,
    { id: "doc-id", fields },
    "session-id",
    "123@qq.com",
    "Test Signer",
    "2026-10-29T12:00:00.000Z",
  );
  const loaded = await PDFDocument.load(bytes);
  assert.equal(loaded.getPageCount(), 5);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
  const rendered = await task.promise;
  try {
    for (let i = 1; i <= 4; i++) {
      const p = await rendered.getPage(i),
        text = await p.getTextContent();
      assert.ok(
        text.items.some((item) => item.str === "2026-10-29"),
        `date on page ${i}`,
      );
      const viewport = p.getViewport({ scale: 1 }),
        canvas = createCanvas(viewport.width, viewport.height);
      await p.render({ canvas, viewport }).promise;
      const pixel = canvas
        .getContext("2d")
        .getImageData(
          Math.floor(viewport.width * 0.15),
          Math.floor(viewport.height * 0.27),
          1,
          1,
        ).data;
      assert.ok(
        pixel[1] > pixel[0] && pixel[0] < 60,
        `signature rendered inside field on rotated page ${i}`,
      );
    }
    const certificate = (
      await (await rendered.getPage(5)).getTextContent()
    ).items
      .map((item) => item.str)
      .join(" ");
    assert.match(certificate, /Test Signer/);
    assert.match(certificate, /123@qq.com/);
    assert.match(certificate, /Original SHA-256/);
    assert.notEqual(await sha256(original), await sha256(bytes));
  } finally {
    await task.destroy();
  }
});
