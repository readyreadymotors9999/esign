import test from "node:test";
import assert from "node:assert/strict";
import { signingDate } from "../supabase/functions/_shared/date.ts";
test("business dates use MM/DD/YYYY in Los Angeles, including UTC midnight", () => {
  assert.equal(signingDate("2026-10-30T01:00:00Z"), "10/29/2026");
  assert.equal(signingDate("2026-10-30T12:00:00Z"), "10/30/2026");
  assert.equal(signingDate("2027-01-01T01:00:00Z"), "12/31/2026");
});
