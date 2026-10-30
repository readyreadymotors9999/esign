import test from "node:test";
import assert from "node:assert/strict";
import { parsePageRange } from "../supabase/functions/_shared/page-range.ts";
test("custom ranges support commas, whitespace and deduplication", () => {
  assert.deepEqual(parsePageRange("1-3, 4, 7", 8), [1, 2, 3, 4, 7]);
  assert.deepEqual(parsePageRange("7, 2, 1-3, 2", 8), [1, 2, 3, 7]);
  assert.deepEqual(parsePageRange("1–3， 7", 8), [1, 2, 3, 7]);
});
test("invalid/out-of-bounds ranges are rejected before any edits", () => {
  for (const range of [
    "",
    null,
    "0",
    "9",
    "3-1",
    "-1",
    "1.5",
    "1,",
    "a",
    "1-99999999999999",
    "1--3",
  ])
    assert.throws(() => parsePageRange(range, 8));
});
