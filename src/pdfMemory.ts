// Private, short-lived RAM only. Never written to Web Storage or persisted.
const TTL = 120_000;
let generation = 0;
type Entry<T> = { value: T; size: number; expires: number };
const bytes = new Map<string, Entry<Uint8Array>>();
export type PageBitmap = {
  canvas: HTMLCanvasElement;
  ratio: number;
  pageWidth: number;
};
const pages = new Map<string, Entry<PageBitmap>>();
function discard<T>(map: Map<string, Entry<T>>, key: string) {
  const entry = map.get(key);
  if (!entry) return;
  const bitmap = (entry.value as { canvas?: HTMLCanvasElement }).canvas;
  if (bitmap) bitmap.width = bitmap.height = 0;
  map.delete(key);
}
function scheduleExpiry<T>(
  map: Map<string, Entry<T>>,
  key: string,
  expires: number,
) {
  if (typeof window !== "undefined")
    window.setTimeout(() => {
      if (map.get(key)?.expires === expires) discard(map, key);
    }, TTL + 1);
}
function prune<T>(map: Map<string, Entry<T>>, limit: number, count: number) {
  for (const [key, e] of map) if (e.expires <= Date.now()) discard(map, key);
  let total = [...map.values()].reduce((sum, e) => sum + e.size, 0);
  for (const [key, e] of map) {
    if (total <= limit && map.size <= count) break;
    total -= e.size;
    discard(map, key);
  }
}
function read<T>(map: Map<string, Entry<T>>, key: string) {
  const e = map.get(key);
  if (!e) return;
  if (e.expires <= Date.now()) {
    discard(map, key);
    return;
  }
  map.delete(key);
  map.set(key, e);
  return e.value;
}
export function pdfMemoryGeneration() {
  return generation;
}
export function clearPdfMemory() {
  generation++;
  bytes.clear();
  for (const key of pages.keys()) discard(pages, key);
}
export function readPdfBytes(key: string) {
  return read(bytes, key)?.slice();
}
export function rememberPdfBytes(
  key: string,
  value: Uint8Array,
  expected: number,
) {
  if (expected !== generation || value.byteLength > 20_000_000) return;
  bytes.set(key, {
    value: value.slice(),
    size: value.byteLength,
    expires: Date.now() + TTL,
  });
  scheduleExpiry(bytes, key, bytes.get(key)!.expires);
  prune(bytes, 20_000_000, 4);
}
export function readPageBitmap(key: string) {
  return read(pages, key);
}
export function rememberPageBitmap(
  key: string,
  value: PageBitmap,
  expected: number,
) {
  const size = value.canvas.width * value.canvas.height * 4;
  if (expected !== generation || size > 48_000_000) {
    value.canvas.width = value.canvas.height = 0;
    return;
  }
  discard(pages, key);
  pages.set(key, { value, size, expires: Date.now() + TTL });
  scheduleExpiry(pages, key, pages.get(key)!.expires);
  prune(pages, 48_000_000, 6);
}
