import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { editPdf } from "../supabase/functions/_shared/edit-pdf.ts";
async function fixture(count = 3) {
  const p = await PDFDocument.create();
  for (let i = 0; i < count; i++) p.addPage([600 + i * 10, 800 + i * 10]);
  return p.save();
}
const fields = [1, 2, 3].map((page) => ({
  page,
  type: "signature",
  signer: "recipient",
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.1,
}));
test("deleting a page removes its fields and reindexes later pages", async () => {
  const source = await fixture(),
    before = Buffer.from(source);
  const result = await editPdf(source, "delete", 2, fields);
  assert.equal(result.pages, 2);
  assert.deepEqual(
    result.fields.map((f) => f.page),
    [1, 2],
  );
  assert.equal(
    (await PDFDocument.load(result.bytes)).getPage(1).getWidth(),
    620,
  );
  assert.deepEqual(Buffer.from(source), before);
});
test("blank insertion shifts fields; append preserves fields and PDF page order", async () => {
  const source = await fixture();
  const blank = await editPdf(source, "blank", 1, fields);
  assert.equal(blank.pages, 4);
  assert.deepEqual(
    blank.fields.map((f) => f.page),
    [1, 3, 4],
  );
  const extra = await PDFDocument.create();
  extra.addPage([920, 500]);
  const appended = await editPdf(
    source,
    "append",
    1,
    fields,
    await extra.save(),
  );
  assert.equal(appended.pages, 4);
  assert.equal(
    (await PDFDocument.load(appended.bytes)).getPage(3).getWidth(),
    920,
  );
  assert.deepEqual(appended.fields, fields);
});
test("replace clears all fields and invalid page/file edits fail", async () => {
  const source = await fixture();
  const replacement = await editPdf(
    source,
    "replace",
    1,
    fields,
    await fixture(1),
  );
  assert.equal(replacement.pages, 1);
  assert.deepEqual(replacement.fields, []);
  await assert.rejects(() => editPdf(source, "delete", 0, fields));
  await assert.rejects(() => editPdf(source, "delete", 4, fields));
  await assert.rejects(() => editPdf(source, "append", 1, fields));
  await assert.rejects(() => editPdf(source, "move", 1, fields));
});
test("single-page deletion, 101-page edits and malformed layouts are rejected", async () => {
  const one = await fixture(1);
  await assert.rejects(() => editPdf(one, "delete", 1, []));
  const full = await fixture(100);
  await assert.rejects(() => editPdf(full, "blank", 1, []));
  await assert.rejects(() => editPdf(full, "append", 1, [], one));
  await assert.rejects(() => editPdf(one, "blank", 1, fields));
});

test("custom deletion deduplicates ranges, keeps page order and reindexes fields", async () => {
  const source = await fixture(8),
    layout = [1, 5, 7, 8].map((page) => ({ ...fields[0], page }));
  const result = await editPdf(
    source,
    "delete-range",
    1,
    layout,
    undefined,
    "1-3, 4, 7, 2",
  );
  assert.equal(result.pages, 3);
  assert.deepEqual(
    result.fields.map((f) => f.page),
    [1, 3],
  );
  const pdf = await PDFDocument.load(result.bytes);
  assert.deepEqual(
    pdf.getPages().map((p) => p.getWidth()),
    [640, 650, 670],
  );
  await assert.rejects(() =>
    editPdf(source, "delete-range", 1, layout, undefined, "1-8"),
  );
  await assert.rejects(() =>
    editPdf(source, "delete-range", 1, layout, undefined, "0, 9"),
  );
});
