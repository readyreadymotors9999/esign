import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
const id = "33333333-3333-4333-8333-333333333333";
const company = "readyreadymotors9999@gmail.com";
const recipientFields = [
  {
    page: 2,
    type: "signature",
    signer: "recipient",
    x: 0.1,
    y: 0.2,
    width: 0.28,
    height: 0.065,
  },
  {
    page: 2,
    type: "date",
    signer: "recipient",
    x: 0.1,
    y: 0.4,
    width: 0.22,
    height: 0.065,
  },
];
async function fixture() {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++)
    pdf.addPage([600, 800]).drawText("Ready Ready Motors agreement", {
      x: 40,
      y: 700,
      font,
      size: 18,
    });
  return Buffer.from(await pdf.save());
}
async function draw(page: any) {
  const pad = page.getByLabel("Draw your signature");
  await pad.scrollIntoViewIfNeeded();
  const b = (await pad.boundingBox())!;
  await page.mouse.move(b.x + 30, b.y + 30);
  await page.mouse.down();
  await page.mouse.move(b.x + 120, b.y + 50, { steps: 10 });
  await page.mouse.up();
}
// External services are mocked. README includes real-service acceptance steps.
for (const delivery of ["share", "email"])
  test(`admin signs first, saves a QQ recipient and creates ${delivery} invitation`, async ({
    page,
  }) => {
    const bytes = await fixture();
    let uploaded = false,
      sent = false,
      saved = false;
    const doc: any = {
      id,
      title: "Custom agreement.pdf",
      status: "draft",
      fields: [],
      created_at: new Date().toISOString(),
    };
    await page.addInitScript(
      (email) =>
        localStorage.setItem(
          "sb-test-auth-token",
          JSON.stringify({
            access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.fake",
            refresh_token: "test-refresh",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            token_type: "bearer",
            user: {
              id: "test",
              email,
              aud: "authenticated",
              role: "authenticated",
            },
          }),
        ),
      company,
    );
    await page.route("**/fixture.pdf", (r) =>
      r.fulfill({ contentType: "application/pdf", body: bytes }),
    );
    await page.route("https://test.supabase.co/**", async (r) => {
      const req = r.request();
      if (req.url().includes("/storage/"))
        return r.fulfill({ json: { Key: "documents/original.pdf" } });
      const b = req.postDataJSON();
      if (b.action === "list")
        return r.fulfill({ json: { documents: uploaded ? [doc] : [] } });
      if (b.action === "recipients")
        return r.fulfill({
          json: {
            recipients: saved
              ? [
                  {
                    id: "recipient-1",
                    email: "123456@qq.com",
                    first_name: "Test",
                    last_name: "Recipient",
                  },
                ]
              : [],
          },
        });
      if (b.action === "save_recipient") {
        expect(b.email).toBe("123456@qq.com");
        saved = true;
        return r.fulfill({ json: { recipient: { id: "recipient-1" } } });
      }
      if (b.action === "create") {
        expect(b.title).toBe("Custom agreement.pdf");
        return r.fulfill({ json: { id, path: "original.pdf" } });
      }
      if (b.action === "uploaded") {
        uploaded = true;
        return r.fulfill({ json: { ok: true } });
      }
      if (b.action === "detail")
        return r.fulfill({
          json: {
            document: doc,
            url: "/fixture.pdf",
            audit: sent
              ? [
                  {
                    id: "event",
                    event: "company_signed",
                    actor: company,
                    created_at: new Date().toISOString(),
                    metadata: { name: "Lichen Wang" },
                  },
                ]
              : [],
          },
        });
      if (b.action === "send") {
        expect(b.email).toBe("123456@qq.com");
        expect(b.recipientName).toBe("Test Recipient");
        expect(b.fields).toHaveLength(4);
        expect(
          b.fields.filter((f: any) => f.signer === "company"),
        ).toHaveLength(2);
        expect(
          b.fields.filter((f: any) => f.signer === "recipient"),
        ).toHaveLength(2);
        expect(b.signature).toMatch(/^data:image\/png;base64,/);
        expect(b.consent).toBe(true);
        expect(b.signatureMethod).toBe(
          delivery === "share" ? "typed" : "drawn",
        );
        expect(b.delivery).toBe(delivery);
        sent = true;
        doc.status = "sent";
        doc.fields = b.fields;
        return r.fulfill({
          json:
            delivery === "share"
              ? { link: `https://example.com/#/sign/${"a".repeat(64)}` }
              : { sent: true },
        });
      }
      return r.fulfill({
        status: 400,
        json: { error: "Unexpected mock action" },
      });
    });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Documents", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "＋ Upload PDF", exact: true })
      .click();
    await page.locator("input[type=file]").setInputFiles({
      name: "Original.pdf",
      mimeType: "application/pdf",
      buffer: bytes,
    });
    await page.getByLabel("eSign filename").fill("Custom agreement.pdf");
    await page
      .getByRole("button", { name: "Upload & prepare", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("PDF uploaded");
    await expect(page.locator(".pdf-page")).toHaveCount(2);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page
      .locator(".pdf-page")
      .nth(0)
      .click({ position: { x: 80, y: 140 } });
    await page.getByRole("button", { name: "Date", exact: true }).click();
    await page
      .locator(".pdf-page")
      .nth(0)
      .click({ position: { x: 80, y: 220 } });
    await page.getByLabel("Field signer").selectOption("recipient");
    await page.getByRole("button", { name: "Signature", exact: true }).click();
    await page
      .locator(".pdf-page")
      .nth(1)
      .click({ position: { x: 80, y: 140 } });
    await page.getByRole("button", { name: "Date", exact: true }).click();
    await page
      .locator(".pdf-page")
      .nth(1)
      .click({ position: { x: 80, y: 220 } });
    if (delivery === "share") {
      await page
        .getByRole("button", { name: "Type signature", exact: true })
        .click();
      await expect(page.getByLabel("Type your signature name")).toHaveValue(
        "Lichen Wang",
      );
      await expect(page.getByLabel("Typed signature preview")).toBeVisible();
    } else await draw(page);
    await page.getByRole("checkbox").check();
    await page.getByLabel("Recipient first name").fill("Test");
    await page.getByLabel("Recipient last name").fill("Recipient");
    await page.getByLabel("Recipient email").fill("123456@qq.com");
    await page
      .getByRole("button", { name: "Save recipient", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Recipient saved");
    await page.getByLabel("Saved recipient").selectOption("recipient-1");
    await page.getByLabel("Invitation delivery").selectOption(delivery);
    await page
      .getByRole("button", {
        name:
          delivery === "share"
            ? "Sign & create share link →"
            : "Sign & email recipient →",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "Revoke link & return to draft" }),
    ).toBeVisible();
    expect(sent).toBe(true);
    expect(saved).toBe(true);
    if (delivery === "share")
      await expect(
        page.getByLabel("Signing link", { exact: true }),
      ).toHaveValue(/#\/sign\/a{64}$/);
    await page.screenshot({
      path: `/tmp/esign-admin-${delivery}.png`,
      fullPage: true,
    });
  });
for (const method of ["drawn", "typed"])
  test(`mobile recipient uses ${method} signature and cannot reuse the link`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const bytes = await fixture();
    let completed = false;
    await page.route("**/fixture.pdf", (r) =>
      r.fulfill({ contentType: "application/pdf", body: bytes }),
    );
    await page.route("https://test.supabase.co/**", async (r) => {
      const b = r.request().postDataJSON();
      if (b.action === "session")
        return completed
          ? r.fulfill({
              status: 410,
              json: {
                error:
                  "This signing link is expired, completed, or unavailable.",
              },
            })
          : r.fulfill({
              json: {
                title: "Vehicle purchase agreement",
                email: "123456@qq.com",
                recipient_name: "Test Recipient",
                fields: recipientFields,
                expires_at: new Date(Date.now() + 3600000).toISOString(),
                url: "/fixture.pdf",
              },
            });
      if (b.action === "complete") {
        expect(b.consent).toBe(true);
        expect(b.signatureMethod).toBe(method);
        expect(b.name).toBe("Test Recipient");
        expect(b.signature).toMatch(/^data:image\/png;base64,/);
        completed = true;
        return r.fulfill({ json: { completed: true } });
      }
      return r.fulfill({ status: 400, json: { error: "Unexpected action" } });
    });
    const link = `/#/sign/${"a".repeat(64)}`;
    await page.goto(link);
    await expect(
      page.getByRole("heading", { name: "Vehicle purchase agreement" }),
    ).toBeVisible();
    await expect(page.locator(".pdf-page")).toHaveCount(2);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByLabel("Full legal name")).toHaveValue(
      "Test Recipient",
    );
    if (method === "typed") {
      await page
        .getByRole("button", { name: "Type signature", exact: true })
        .click();
      await expect(page.getByLabel("Type your signature name")).toHaveValue(
        "Test Recipient",
      );
    } else await draw(page);
    await page.getByRole("checkbox").check();
    // Clearing is a non-submit action and invalidates both signature modes.
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Agree & sign document" }),
    ).toBeDisabled();
    expect(completed).toBe(false);
    if (method === "typed")
      await page.getByLabel("Type your signature name").fill("Test Recipient");
    else await draw(page);
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
test("Google Docs import uses OAuth export and a custom filename", async ({
  page,
}) => {
  const bytes = await fixture();
  let exported = false,
    uploaded = false;
  await page.addInitScript(() => {
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
    );
    (window as any).google = {
      accounts: {
        oauth2: {
          initTokenClient: (options: any) => ({
            requestAccessToken: () =>
              options.callback({ access_token: "temporary-google-access" }),
          }),
        },
      },
    };
  });
  await page.route("https://www.googleapis.com/**", (r) => {
    expect(r.request().headers().authorization).toBe(
      "Bearer temporary-google-access",
    );
    exported = true;
    return r.fulfill({ contentType: "application/pdf", body: bytes });
  });
  await page.route("**/fixture.pdf", (r) =>
    r.fulfill({ contentType: "application/pdf", body: bytes }),
  );
  await page.route("https://test.supabase.co/**", (r) => {
    const req = r.request();
    if (req.url().includes("/storage/")) {
      expect(JSON.stringify(req.headers())).not.toContain(
        "temporary-google-access",
      );
      uploaded = true;
      return r.fulfill({ json: { Key: "original.pdf" } });
    }
    const b = req.postDataJSON();
    expect(JSON.stringify(b)).not.toContain("temporary-google-access");
    const doc = {
      id,
      title: "Imported custom name.pdf",
      status: "draft",
      fields: [],
      created_at: new Date().toISOString(),
    };
    if (b.action === "list")
      return r.fulfill({ json: { documents: uploaded ? [doc] : [] } });
    if (b.action === "recipients")
      return r.fulfill({ json: { recipients: [] } });
    if (b.action === "create") {
      expect(b.title).toBe("Imported custom name.pdf");
      return r.fulfill({ json: { id, path: "original.pdf" } });
    }
    if (b.action === "uploaded") return r.fulfill({ json: { ok: true } });
    if (b.action === "detail")
      return r.fulfill({
        json: { document: doc, url: "/fixture.pdf", audit: [] },
      });
    return r.fulfill({ status: 400, json: { error: "Unexpected action" } });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Import Google Doc", exact: true })
    .click();
  await page.getByLabel("eSign filename").fill("Imported custom name.pdf");
  await page
    .getByLabel("Google Docs URL")
    .fill("https://docs.google.com/document/d/test_document/edit");
  await page
    .getByRole("button", { name: "Connect Google", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Authorize & import PDF", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("PDF uploaded");
  expect(exported).toBe(true);
  expect(uploaded).toBe(true);
});
