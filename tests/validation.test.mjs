import test from "node:test";
import assert from "node:assert/strict";
import {
  emailAddress,
  validateFields,
  tokenValue,
  placement,
  escapeHtml,
} from "../supabase/functions/_shared/validation.ts";
const field = {
  page: 2,
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.1,
  type: "signature",
};
test("QQ addresses work and malformed/header-injection emails fail", () => {
  assert.equal(emailAddress("123456789@qq.com"), "123456789@qq.com");
  for (const value of [
    "x@qq.com\r\nBcc: x@evil.com",
    "x",
    "a@b",
    "<a@qq.com>",
    null,
  ])
    assert.throws(() => emailAddress(value));
});
test("field validation enforces pages, normalized bounds, finite values, and signature requirement", () => {
  assert.deepEqual(validateFields([field], 2), [field]);
  for (const bad of [
    { ...field, page: 3 },
    { ...field, x: 0.9 },
    { ...field, y: NaN },
    { ...field, height: -1 },
    { ...field, type: "date" },
  ])
    assert.throws(() => validateFields([bad], 2));
  assert.throws(() => validateFields([], 2));
  assert.throws(() => validateFields(Array(51).fill(field), 2));
});
test("signing tokens have 256-bit hex shape", () => {
  assert.equal(tokenValue("a".repeat(64)), "a".repeat(64));
  for (const value of ["", "a".repeat(63), "z".repeat(64), null])
    assert.throws(() => tokenValue(value));
});
test("PDF.js field rectangles map to cropped and rotated PDF coordinates", () => {
  const crop = { x: 20, y: 30, width: 600, height: 800 };
  for (const rotation of [0, 90, 180, 270]) {
    const box = placement(field, crop, rotation);
    // Transform all four drawn corners back to the screen's top-left coordinate space.
    const a = (rotation * Math.PI) / 180;
    const points = [
      [0, 0],
      [box.width, 0],
      [0, box.height],
      [box.width, box.height],
    ].map(([u, v]) => {
      const px = box.x + u * Math.cos(a) - v * Math.sin(a) - crop.x;
      const py = box.y + u * Math.sin(a) + v * Math.cos(a) - crop.y;
      return rotation === 0
        ? [px / 600, 1 - py / 800]
        : rotation === 90
          ? [py / 800, px / 600]
          : rotation === 180
            ? [1 - px / 600, py / 800]
            : [1 - py / 800, 1 - px / 600];
    });
    const expected = [
      field.x,
      field.y,
      field.x + field.width,
      field.y + field.height,
    ];
    const actual = [
      Math.min(...points.map((p) => p[0])),
      Math.min(...points.map((p) => p[1])),
      Math.max(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[1])),
    ];
    actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-9));
  }
});
test("email HTML escapes document titles and links", () =>
  assert.equal(
    escapeHtml('<img src="x">&'),
    "&lt;img src=&quot;x&quot;&gt;&amp;",
  ));
