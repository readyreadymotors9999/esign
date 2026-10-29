import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
const id = "33333333-3333-4333-8333-333333333333";
const fields = [
  { page: 1, type: "signature", x: 0.1, y: 0.2, width: 0.28, height: 0.065 },
  { page: 2, type: "date", x: 0.1, y: 0.3, width: 0.22, height: 0.065 },
];
async function fixture() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++)
    pdf
      .addPage([600, 800])
      .drawText("Ready Ready Motors agreement", {
        x: 40,
        y: 700,
        font,
        size: 18,
      });
  return Buffer.from(await pdf.save());
}
// Browser smoke tests deliberately mock Supabase/email. Real-service acceptance
// steps are in README.md and must be completed with the operator's credentials.
test("admin uploads, places fields on different pages, and emails a QQ recipient", async ({
  page,
}) => {
  const bytes = await fixture();
  let uploaded = false,
    sent = false;
  const doc = {
    id,
    title: "Contract.pdf",
    status: "draft",
    fields: [],
    created_at: new Date().toISOString(),
  };
  await page.addInitScript(() =>
    localStorage.setItem(
      "sb-test-auth-token",
      JSON.stringify({
        access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.fake",
        refresh_token: "test-refresh",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user: {
          id: "test",
          email: "admin@example.com",
          aud: "authenticated",
          role: "authenticated",
        },
      }),
    ),
  );
  await page.route("**/fixture.pdf", (route) =>
    route.fulfill({ contentType: "application/pdf", body: bytes }),
  );
  await page.route("https://test.supabase.co/**", async (route) => {
    const request = route.request();
    if (request.url().includes("/storage/"))
      return route.fulfill({ json: { Key: "documents/original.pdf" } });
    const b = request.postDataJSON();
    if (b.action === "list")
      return route.fulfill({ json: { documents: uploaded ? [doc] : [] } });
    if (b.action === "create")
      return route.fulfill({ json: { id, path: "original.pdf" } });
    if (b.action === "uploaded") {
      uploaded = true;
      return route.fulfill({ json: { ok: true } });
    }
    if (b.action === "detail")
      return route.fulfill({
        json: {
          document: doc,
          url: "/fixture.pdf",
          audit: sent
            ? [
                {
                  id: "event",
                  event: "email_accepted_by_provider",
                  actor: "123456@qq.com",
                  created_at: new Date().toISOString(),
                  metadata: {},
                },
              ]
            : [],
        },
      });
    if (b.action === "send") {
      expect(b.email).toBe("123456@qq.com");
      expect(b.fields).toHaveLength(2);
      expect(b.fields.map((f: any) => f.page)).toEqual([1, 2]);
      doc.status = "sent";
      doc.fields = b.fields;
      sent = true;
      return route.fulfill({ json: { sent: true } });
    }
    return route.fulfill({
      status: 400,
      json: { error: "Unexpected mock action" },
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Documents", exact: true }),
  ).toBeVisible();
  await page.locator("input[type=file]").setInputFiles({
    name: "Contract.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  });
  await expect(page.getByRole("status")).toContainText("PDF uploaded");
  await page.getByRole("button", { name: /PDF Contract.pdf/ }).click();
  await expect(page.locator(".pdf-page")).toHaveCount(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator(".pdf-page canvas")
        .first()
        .evaluate((c: HTMLCanvasElement) => c.width),
    )
    .toBe(900);
  await page
    .locator(".pdf-page")
    .nth(0)
    .click({ position: { x: 80, y: 140 } });
  await page.getByRole("button", { name: "Date", exact: true }).click();
  await page
    .locator(".pdf-page")
    .nth(1)
    .click({ position: { x: 80, y: 180 } });
  await page.getByLabel("Recipient email").fill("123456@qq.com");
  await page.getByRole("button", { name: "Send for signature" }).click();
  await expect(page.getByRole("status")).toContainText("Signing link sent");
  await expect(
    page.getByRole("button", { name: "Revoke link & return to draft" }),
  ).toBeVisible();
  expect(sent).toBe(true);
  await page.screenshot({ path: "/tmp/esign-admin.png", fullPage: true });
});
test("mobile recipient reviews, signs with consent and cannot reuse the link", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const bytes = await fixture();
  let completed = false;
  await page.route("**/fixture.pdf", (route) =>
    route.fulfill({ contentType: "application/pdf", body: bytes }),
  );
  await page.route("https://test.supabase.co/**", async (route) => {
    const b = route.request().postDataJSON();
    if (b.action === "session")
      return completed
        ? route.fulfill({
            status: 410,
            json: {
              error: "This signing link is expired, completed, or unavailable.",
            },
          })
        : route.fulfill({
            json: {
              title: "Vehicle purchase agreement",
              email: "123456@qq.com",
              fields,
              expires_at: new Date(Date.now() + 3600000).toISOString(),
              url: "/fixture.pdf",
            },
          });
    if (b.action === "complete") {
      expect(b.consent).toBe(true);
      expect(b.name).toBe("Test Signer");
      expect(b.signature).toMatch(/^data:image\/png;base64,/);
      completed = true;
      return route.fulfill({ json: { completed: true } });
    }
    return route.fulfill({
      status: 400,
      json: { error: "Unexpected mock action" },
    });
  });
  const link = `/#/sign/${"a".repeat(64)}`;
  await page.goto(link);
  await expect(
    page.getByRole("heading", { name: "Vehicle purchase agreement" }),
  ).toBeVisible();
  await expect(page.locator(".pdf-page")).toHaveCount(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator(".pdf-page canvas")
        .first()
        .evaluate((c: HTMLCanvasElement) => c.width),
    )
    .toBe(900);
  await page.getByLabel("Full legal name").fill("Test Signer");
  const pad = page.getByLabel("Draw your signature");
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 50, { steps: 10 });
  await page.mouse.up();
  await page.getByRole("checkbox").check();
  await page.screenshot({ path: "/tmp/esign-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Agree & sign document" }).click();
  await expect(
    page.getByRole("heading", { name: "You’re all signed." }),
  ).toBeVisible();
  expect(completed).toBe(true);
  await page.goto(link);
  await expect(page.getByRole("alert")).toContainText(
    "expired, completed, or unavailable",
  );
});
