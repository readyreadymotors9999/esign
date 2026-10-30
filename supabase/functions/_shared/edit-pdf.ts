import { parsePageRange } from "./page-range.ts";
import { PDFDocument } from "pdf-lib";
import { ValidationError, validateFields, type Field } from "./validation.ts";
export type PdfEdit =
  "delete" | "delete-range" | "blank" | "append" | "replace";
export async function editPdf(
  source: Uint8Array,
  operation: PdfEdit,
  page: number,
  fields: unknown,
  addition?: Uint8Array,
  range?: string,
): Promise<{ bytes: Uint8Array; fields: Field[]; pages: number }> {
  if (
    !["delete", "delete-range", "blank", "append", "replace"].includes(
      operation,
    )
  )
    throw new ValidationError("Choose a supported page edit.");
  const pdf = await PDFDocument.load(source),
    count = pdf.getPageCount();
  let nextFields = validateFields(fields, count, false);
  if (operation === "delete" || operation === "delete-range") {
    const removed =
      operation === "delete-range"
        ? parsePageRange(range, count)
        : parsePageRange(String(page), count);
    if (removed.length >= count)
      throw new ValidationError("Keep at least one page in the document.");
    for (const number of [...removed].reverse()) pdf.removePage(number - 1);
    nextFields = nextFields
      .filter((f) => !removed.includes(f.page))
      .map((f) => ({
        ...f,
        page: f.page - removed.filter((p) => p < f.page).length,
      }));
  } else if (operation === "blank") {
    if (!Number.isInteger(page) || page < 1 || page > count)
      throw new ValidationError("Select an existing page.");

    const previous = pdf.getPage(page - 1),
      crop = previous.getCropBox(),
      swap = previous.getRotation().angle % 180 !== 0;
    pdf.insertPage(
      page,
      swap ? [crop.height, crop.width] : [crop.width, crop.height],
    );
    nextFields = nextFields.map((f) => ({
      ...f,
      page: f.page > page ? f.page + 1 : f.page,
    }));
  } else {
    if (!addition || addition.length > 10485760)
      throw new ValidationError("Choose a PDF smaller than 10 MB.");
    const extra = await PDFDocument.load(addition);
    if (extra.getPageCount() < 1 || extra.getPageCount() > 100)
      throw new ValidationError("PDF must have 1–100 pages.");
    if (operation === "replace")
      return {
        bytes: await extra.save(),
        fields: [],
        pages: extra.getPageCount(),
      };
    if (count + extra.getPageCount() > 100)
      throw new ValidationError("A document can contain at most 100 pages.");
    for (const copied of await pdf.copyPages(extra, extra.getPageIndices()))
      pdf.addPage(copied);
  }
  if (pdf.getPageCount() > 100)
    throw new ValidationError("A document can contain at most 100 pages.");
  const bytes = await pdf.save();
  if (bytes.length > 10485760)
    throw new ValidationError("Edited PDF exceeds 10 MB.");
  return { bytes, fields: nextFields, pages: pdf.getPageCount() };
}
