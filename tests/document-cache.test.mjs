import test from "node:test";
import assert from "node:assert/strict";
import {
  readDocumentCache,
  writeDocumentCache,
  clearDocumentCache,
} from "../src/documentCache.ts";
const storage = () => {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
    data,
  };
};
const doc = {
  id: "doc",
  title: "Agreement.pdf",
  status: "draft",
  created_at: "2026-10-30T00:00:00Z",
};
test("tab cache persists only dashboard metadata and expires after 15 minutes", () => {
  const s = storage();
  writeDocumentCache(
    "owner",
    [
      {
        ...doc,
        fields: [{ signature: "private" }],
        original_path: "private.pdf",
        recipient_name: "Customer",
        token: "secret",
      },
    ],
    s,
    1000,
  );
  assert.deepEqual(readDocumentCache("owner", s, 1001), [doc]);
  const raw = [...s.data.values()][0];
  for (const value of ["private", "Customer", "secret", "original_path"])
    assert.ok(!raw.includes(value));
  assert.equal(
    readDocumentCache("owner", s, 1000 + 15 * 60 * 1000 + 1),
    undefined,
  );
  assert.equal(s.data.size, 0);
});
test("cache isolation, explicit clearing, corrupted data and blocked storage are safe", () => {
  const s = storage();
  writeDocumentCache("first", [doc], s, 1000);
  assert.equal(readDocumentCache("second", s, 1001), undefined);
  assert.equal(s.data.size, 0);
  writeDocumentCache("owner", [], s, 1000);
  assert.deepEqual(readDocumentCache("owner", s, 1001), []);
  clearDocumentCache(s);
  assert.equal(s.data.size, 0);
  s.setItem("ready-esign-document-list-v1", "broken");
  assert.equal(readDocumentCache("owner", s, 1001), undefined);
  assert.equal(s.data.size, 0);
  const blocked = {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("blocked");
    },
    removeItem() {
      throw Error("blocked");
    },
  };
  assert.doesNotThrow(() => writeDocumentCache("owner", [doc], blocked));
  assert.equal(readDocumentCache("owner", blocked), undefined);
});
