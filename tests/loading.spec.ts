import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
test("document counts stay unknown until loaded, refresh preserves rows, and PDF loading is visible", async ({
  page,
}) => {
  let initialRelease!: () => void,
    refreshRelease!: () => void,
    homeRelease!: () => void,
    detailRelease!: () => void,
    pdfRelease!: () => void;
  const initial = new Promise<void>((resolve) => (initialRelease = resolve)),
    refreshing = new Promise<void>((resolve) => (refreshRelease = resolve)),
    home = new Promise<void>((resolve) => (homeRelease = resolve)),
    detail = new Promise<void>((resolve) => (detailRelease = resolve)),
    pdfGate = new Promise<void>((resolve) => (pdfRelease = resolve));
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 800]);
  const bytes = Buffer.from(await pdf.save());
  const doc = {
    id: "33333333-3333-4333-8333-333333333333",
    title: "Agreement.pdf",
    status: "draft",
    fields: [],
    original_path: "original.pdf",
    created_at: new Date().toISOString(),
  };
  let listGate = initial;
  await page.addInitScript(() =>
    localStorage.setItem(
      "sb-test-auth-token",
      JSON.stringify({
        access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.fake",
        refresh_token: "test",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user: {
          id: "test",
          email: "readyreadymotors9999@gmail.com",
          aud: "authenticated",
        },
      }),
    ),
  );
  await page.route("**/loading-fixture.pdf", async (route) => {
    await pdfGate;
    await route.fulfill({ contentType: "application/pdf", body: bytes });
  });
  await page.route("https://test.supabase.co/**", async (route) => {
    const b = route.request().postDataJSON();
    if (b.action === "recipients")
      return route.fulfill({ json: { recipients: [] } });
    if (b.action === "list") {
      await listGate;
      return route.fulfill({ json: { documents: [doc] } });
    }
    if (b.action === "detail") {
      await detail;
      return route.fulfill({
        json: {
          document: doc,
          audit: [],
          url: "/loading-fixture.pdf",
          capabilities: { pdfEditing: true, pdfPageRanges: true },
        },
      });
    }
    return route.fulfill({
      status: 400,
      json: { error: "Unexpected mock action" },
    });
  });
  await page.goto("/");
  const all = page.getByRole("tab", { name: /All documents/ });
  await expect(
    page.getByText("Loading documents…", { exact: true }),
  ).toBeVisible();
  await expect(all.locator(".count")).toHaveText("—");
  await expect(page.getByText("A fresh start", { exact: true })).toHaveCount(0);
  initialRelease();
  await expect(all.locator(".count")).toHaveText("1");
  await expect(page.locator(".doc-row")).toHaveCount(1);
  listGate = refreshing;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("Refreshing documents…", { exact: true }),
  ).toBeVisible();
  await expect(all.locator(".count")).toHaveText("1");
  await expect(page.locator(".doc-row")).toHaveCount(1);
  refreshRelease();
  await expect(
    page.getByText("Refreshing documents…", { exact: true }),
  ).toHaveCount(0);
  listGate = home;
  await page
    .getByRole("link", { name: "Go to documents", exact: true })
    .click();
  await expect(
    page.getByText("Loading documents…", { exact: true }),
  ).toBeVisible();
  await expect(all.locator(".count")).toHaveText("—");
  await expect(page.getByText("A fresh start", { exact: true })).toHaveCount(0);
  homeRelease();
  await expect(all.locator(".count")).toHaveText("1");
  await page.getByRole("button", { name: /PDF Agreement.pdf/ }).click();
  await expect(
    page.getByText("Opening document…", { exact: true }),
  ).toBeVisible();
  detailRelease();
  await expect(page.getByText("Loading PDF…", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Signature", exact: true }),
  ).toBeDisabled();
  pdfRelease();
  await expect(page.getByText("Loading PDF…", { exact: true })).toHaveCount(0);
  await expect(page.locator(".pdf-page canvas")).toBeVisible();
  await expect(page.locator(".pdf-page-loading")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Signature", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Signature", exact: true }).click();
  await expect(page.locator(".pdf-page")).toHaveCSS("cursor", "default");
  const rect = (await page.locator(".pdf-page").boundingBox())!;
  await page.mouse.move(rect.x + 40, rect.y + 80);
  await expect(page.getByTestId("field-placement-preview")).toBeVisible();
});
