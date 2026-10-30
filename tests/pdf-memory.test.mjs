import test from "node:test";
import assert from "node:assert/strict";
import {
  clearPdfMemory,
  pdfMemoryGeneration,
  rememberPdfBytes,
  readPdfBytes,
  rememberPageBitmap,
  readPageBitmap,
} from "../src/pdfMemory.ts";
test("PDF byte copies prevent worker transfers from corrupting cache, with revision-specific keys and bounded entries", () => {
  clearPdfMemory();
  const generation = pdfMemoryGeneration();
  rememberPdfBytes(
    "owner:doc:revision1",
    new Uint8Array([1, 2, 3]),
    generation,
  );
  const first = readPdfBytes("owner:doc:revision1");
  first[0] = 9;
  assert.deepEqual([...readPdfBytes("owner:doc:revision1")], [1, 2, 3]);
  assert.equal(readPdfBytes("owner:doc:revision2"), undefined);
  for (let i = 0; i < 5; i++)
    rememberPdfBytes(`file${i}`, new Uint8Array([i]), generation);
  assert.equal(readPdfBytes("file0"), undefined);
  assert.deepEqual([...readPdfBytes("file4")], [4]);
  clearPdfMemory();
});
test("sign-out invalidates stale writes and releases page images; expired entries cannot be reused", (t) => {
  clearPdfMemory();
  const generation = pdfMemoryGeneration();
  let clock = 1000;
  t.mock.method(Date, "now", () => clock);
  const canvas = { width: 100, height: 100 };
  rememberPageBitmap("page", { canvas, ratio: 1, pageWidth: 100 }, generation);
  rememberPdfBytes("pdf", new Uint8Array([1]), generation);
  assert.equal(readPageBitmap("page").canvas, canvas);
  clock += 120001;
  assert.equal(readPageBitmap("page"), undefined);
  assert.equal(canvas.width, 0);
  assert.equal(readPdfBytes("pdf"), undefined);
  clearPdfMemory();
  rememberPdfBytes("late", new Uint8Array([2]), generation);
  assert.equal(readPdfBytes("late"), undefined);
  const large = { width: 10000, height: 10000 };
  rememberPageBitmap(
    "large",
    { canvas: large, ratio: 1, pageWidth: 10000 },
    pdfMemoryGeneration(),
  );
  assert.equal(readPageBitmap("large"), undefined);
  assert.equal(large.width, 0);
});
