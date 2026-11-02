export function documentPdfFilename(title: string): string {
  const name = title.replace(/[\u0000-\u001f\u007f/\\]/g, "-").trim() || "Document";
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}
