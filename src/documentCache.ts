import type { DocumentSummary } from "./api";
const KEY = "ready-esign-document-list-v1";
const MAX_AGE = 15 * 60 * 1000;
type CacheStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function clearDocumentCache(storage?: CacheStorage) {
  try {
    (storage ?? window.sessionStorage).removeItem(KEY);
  } catch {
    /* Storage may be blocked. */
  }
}
export function readDocumentCache(
  owner: string,
  storage?: CacheStorage,
  now = Date.now(),
): DocumentSummary[] | undefined {
  try {
    const store = storage ?? window.sessionStorage;
    const raw = store.getItem(KEY);
    if (!raw) return;
    const cache = JSON.parse(raw);
    if (
      cache.owner !== owner ||
      !Number.isFinite(cache.updatedAt) ||
      cache.updatedAt > now ||
      now - cache.updatedAt > MAX_AGE ||
      !Array.isArray(cache.documents) ||
      !cache.documents.every(
        (r: any) =>
          r &&
          [r.id, r.title, r.status, r.created_at].every(
            (v) => typeof v === "string",
          ) &&
          ["uploading", "draft", "sent", "completed"].includes(r.status),
      )
    ) {
      store.removeItem(KEY);
      return;
    }
    return cache.documents.map(
      ({ id, title, status, created_at }: DocumentSummary) => ({
        id,
        title,
        status,
        created_at,
      }),
    );
  } catch {
    clearDocumentCache(storage);
    return;
  }
}
export function writeDocumentCache(
  owner: string,
  documents: DocumentSummary[],
  storage?: CacheStorage,
  now = Date.now(),
) {
  try {
    const payload = JSON.stringify({
      owner,
      updatedAt: now,
      documents: documents.map(({ id, title, status, created_at }) => ({
        id,
        title,
        status,
        created_at,
      })),
    });
    const store = storage ?? window.sessionStorage;
    if (payload.length > 256_000) {
      store.removeItem(KEY);
      return;
    }
    store.setItem(KEY, payload);
  } catch {
    clearDocumentCache(storage);
  }
}
