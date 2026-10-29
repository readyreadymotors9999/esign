import test from "node:test";
import assert from "node:assert/strict";
import { googleDocumentId } from "../src/google.ts";
test("Google import accepts only genuine HTTPS Docs URLs with a document ID", () => {
  assert.equal(
    googleDocumentId(
      "https://docs.google.com/document/d/abc_123-XYZ/edit?usp=sharing",
    ),
    "abc_123-XYZ",
  );
  for (const url of [
    "http://docs.google.com/document/d/abc/edit",
    "https://docs.google.com.evil.example/document/d/abc/edit",
    "https://evil.example/document/d/abc/edit",
    "https://docs.google.com/spreadsheets/d/abc/edit",
    "javascript:alert(1)",
    "https://docs.google.com/document/d/",
  ])
    assert.throws(() => googleDocumentId(url));
});
