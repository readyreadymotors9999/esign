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
    assert.match(certificate, /Input PDF SHA-256/);
    assert.notEqual(await sha256(original), await sha256(bytes));
  } finally {
    await task.destroy();
  }
});

test("recipient completion preserves the company signature and both certificates", async () => {
  const original = await PDFDocument.create();
  original.addPage([600, 800]);
  const draw = (color) => {
    const c = createCanvas(900, 240);
    c.getContext("2d").fillStyle = color;
    c.getContext("2d").fillRect(20, 40, 850, 150);
    return new Uint8Array(c.toBuffer("image/png"));
  };
  const fields = [
    {
      page: 1,
      type: "signature",
      signer: "company",
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.1,
    },
    {
      page: 1,
      type: "date",
      signer: "company",
      x: 0.1,
      y: 0.25,
      width: 0.3,
      height: 0.05,
    },
    {
      page: 1,
      type: "signature",
      signer: "recipient",
      x: 0.1,
      y: 0.5,
      width: 0.3,
      height: 0.1,
    },
    {
      page: 1,
      type: "date",
      signer: "recipient",
      x: 0.1,
      y: 0.7,
      width: 0.3,
      height: 0.05,
    },
  ];
  const prepared = await generateSignedPdf(
    await original.save(),
    draw("#123d35"),
    { id: "doc", fields: fields.filter((f) => f.signer === "company") },
    "prep",
    "readyreadymotors9999@gmail.com",
    "Lichen Wang",
    "2026-10-29T12:00:00Z",
    "Authenticated administrator",
  );
  const signed = await generateSignedPdf(
    prepared,
    draw("#b02030"),
    { id: "doc", fields: fields.filter((f) => f.signer === "recipient") },
    "session",
    "recipient@qq.com",
    "Test Recipient",
    "2026-10-30T12:00:00Z",
  );
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"),
    task = pdfjs.getDocument({ data: signed, useSystemFonts: true }),
    pdf = await task.promise;
  try {
    assert.equal(pdf.numPages, 3);
    const p = await pdf.getPage(1),
      viewport = p.getViewport({ scale: 1 }),
      canvas = createCanvas(600, 800);
    await p.render({ canvas, viewport }).promise;
    const ctx = canvas.getContext("2d"),
      company = ctx.getImageData(90, 136, 1, 1).data,
      recipient = ctx.getImageData(90, 456, 1, 1).data;
    assert.ok(
      company[1] > company[0] && company[0] < 60,
      "company signature is intact",
    );
    assert.ok(
      recipient[0] > 120 && recipient[1] < 70,
      "recipient signature uses its own field",
    );
    const text = (await p.getTextContent()).items
      .map((item) => item.str)
      .join(" ");
    assert.match(text, /2026-10-29/);
    assert.match(text, /2026-10-30/);
    const first = (await (await pdf.getPage(2)).getTextContent()).items
        .map((i) => i.str)
        .join(" "),
      second = (await (await pdf.getPage(3)).getTextContent()).items
        .map((i) => i.str)
        .join(" ");
    assert.match(first, /Lichen Wang/);
    assert.match(first, /Authenticated administrator/);
    assert.match(second, /Test Recipient/);
  } finally {
    await task.destroy();
  }
});
