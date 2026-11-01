import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
const id = "33333333-3333-4333-8333-333333333333";
const recipientId = "44444444-4444-4444-8444-444444444444";
test("logo always returns home and account settings manage saved recipients", async ({
  page,
}) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 800]);
  const bytes = Buffer.from(await pdf.save());
  let recipients = [
    {
      id: recipientId,
      first_name: "Test",
      last_name: "Wang",
      email: "test@qq.com",
    },
  ];
  const doc: any = {
    signers: [],
    draft_revision: 0,
    id,
    title: "Agreement.pdf",
    status: "draft",
    fields: [],
    original_path: "original.pdf",
    created_at: new Date().toISOString(),
  };
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
  await page.route("**/fixture.pdf", (r) =>
    r.fulfill({ contentType: "application/pdf", body: bytes }),
  );
  await page.route("https://test.supabase.co/**", (r) => {
    if (r.request().url().includes("/auth/v1/logout")) return r.fulfill({ status: 204, body: "" });
    const body = r.request().url().includes("/rest/v1/documents")
      ? { action: "list" }
      : r.request().postDataJSON();
    if (body.action === "save_draft") {
      doc.fields = body.fields; doc.signers = body.signers; doc.draft_revision++;
      return r.fulfill({json:{revision:doc.draft_revision}});
    }
    if (body.action === "list") return r.fulfill({ json: [doc] });
    if (body.action === "recipients")
      return r.fulfill({ json: { recipients } });
    if (body.action === "detail")
      return r.fulfill({
        json: {
          document: doc,
          url: "/fixture.pdf",
          audit: [],
          capabilities: { pdfEditing: true, pdfPageRanges: true, documentSigners: true },
        },
      });
    if (body.action === "save_recipient") {
      const record = {
        id: body.recipientId || "55555555-5555-4555-8555-555555555555",
        first_name: body.firstName,
        last_name: body.lastName,
        email: body.email,
      };
      const existing = recipients.findIndex((r) => r.id === record.id);
      if (existing >= 0) recipients[existing] = record;
      else recipients.push(record);
      return r.fulfill({ json: { recipient: record } });
    }
    if (body.action === "delete_recipient") {
      expect(body.recipientId).toBe(recipientId);
      recipients = recipients.filter((r) => r.id !== body.recipientId);
      return r.fulfill({ json: { deleted: true } });
    }
    return r.fulfill({ status: 400, json: { error: "Unexpected action" } });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back, Lichen" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "My Account", exact: true })
    .click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "My Account", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".recipient-row")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Edit test@qq.com", exact: true })
    .click();
  await page.getByLabel("First name", { exact: true }).fill("Updated");
  await page
    .getByRole("button", { name: "Save recipient", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Recipient saved");
  await expect(page.locator(".recipient-row")).toContainText("Updated Wang");
  await page
    .getByRole("button", { name: "Add recipient", exact: true })
    .click();
  await page.getByLabel("First name", { exact: true }).fill("New");
  await page.getByLabel("Last name", { exact: true }).fill("Contact");
  await page.getByLabel("Recipient email", { exact: true }).fill("new@qq.com");
  await page
    .getByRole("button", { name: "Save recipient", exact: true })
    .click();
  await expect(page.locator(".recipient-row")).toHaveCount(2);
  await page.getByLabel("Search recipients").fill("updated");
  await expect(page.locator(".recipient-row")).toHaveCount(1);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete test@qq.com", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Recipient deleted");
  await page.getByLabel("Search recipients").fill("");
  await expect(page.locator(".recipient-row")).toHaveCount(1);
  await expect(page.locator(".recipient-row")).toContainText("new@qq.com");
  await page
    .getByRole("link", { name: "Go to documents", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back, Lichen" }),
  ).toBeVisible();
  recipients.push({
    id: "66666666-6666-4666-8666-666666666666",
    first_name: "Other",
    last_name: "Contact",
    email: "other@qq.com",
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: /PDF Agreement.pdf/ }).click();
    await expect(
      page.getByLabel("Document toolbar", { exact: true }),
    ).toBeVisible();
    const selectedId =
      attempt === 0
        ? "55555555-5555-4555-8555-555555555555"
        : "66666666-6666-4666-8666-666666666666";
    await expect(page.getByLabel("Field signer").locator("option")).toHaveCount(3 + attempt);
    await page.getByLabel("Field signer").selectOption("manage");
    await page.getByLabel("Saved recipient").selectOption(selectedId);
    await page.getByRole("button", { name: "Add as signer", exact: true }).click();
    await expect.poll(() => doc.signers.some((signer: any) => signer.recipientId === selectedId)).toBe(true);
    const ownerId = doc.signers.find((signer: any) => signer.recipientId === selectedId).id;
    await page.getByLabel("Field signer").selectOption(ownerId);
    await expect(page.getByLabel("Field signer")).toHaveValue(ownerId);
    await expect(
      page
        .getByLabel("Field signer")
        .locator(`option[value="contact:${selectedId}"]`),
    ).toHaveCount(0);
    await expect(
      page.getByLabel("Field signer").locator('option[value="edit"]'),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Edit signer", exact: true })
      .click();
    await expect(page.getByLabel("Recipient first name")).toHaveValue(
      attempt === 0 ? "New" : "Other",
    );
    await expect(
      page.getByRole("button", { name: "Done", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Update document signer", exact: true }),
    ).toHaveCSS("background-color", "rgb(22, 107, 89)");
    await page
      .getByRole("button", { name: "Close recipient editor", exact: true })
      .click();
    await page.getByLabel("Field signer").selectOption("new");
    await expect(page.getByLabel("Recipient first name")).toBeVisible();
    expect(
      await page
        .locator(".recipient-tools")
        .evaluate(
          (el) =>
            !!el.closest(".signer-recipient-editor") &&
            !!el.closest(".pdf-tools"),
        ),
    ).toBe(true);
    const order = await page.locator(".pdf-tools").evaluate((el) => {
      const signer = el.querySelector(".field-signer")!,
        form = el.querySelector(".recipient-tools")!;
      return Boolean(
        signer.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(order).toBe(true);
    await page
      .getByRole("link", { name: "Go to documents", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Welcome back, Lichen" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Document toolbar", { exact: true }),
    ).toHaveCount(0);
  }
  await page.screenshot({
    path: "/tmp/esign-home-navigation.png",
    fullPage: true,
  });
  const account = page.getByRole("button", { name: "My Account", exact: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  const accountBox = (await account.boundingBox())!;
  expect(Math.abs(accountBox.x + accountBox.width - 1440 * 0.95)).toBeLessThanOrEqual(2);
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
  await account.click();
  await expect(page.getByRole("navigation", { name: "Account options" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(account).toBeFocused();
  await expect(account).toHaveAttribute("aria-expanded", "false");
  await account.click();
  await page.getByRole("heading", { name: "Welcome back, Lichen" }).click();
  await expect(account).toHaveAttribute("aria-expanded", "false");
  await page.setViewportSize({ width: 390, height: 844 });
  await account.click();
  const menuBox = (await page.getByRole("navigation", { name: "Account options" }).boundingBox())!;
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(390);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await account.click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Less paperwork/ })).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("button", { name: "My Account", exact: true })).toHaveCount(0);

});
