import test from "node:test";
import assert from "node:assert/strict";
import {
  GMAIL_SENDER,
  gmailConfig,
  gmailAccessToken,
  sendGmail,
  invitationRaw,
} from "../supabase/functions/_shared/gmail.ts";
import { authorizationUrl, validState } from "../scripts/connect-gmail.mjs";
const config = {
  clientId: "test-client",
  clientSecret: "test-secret",
  refreshToken: "test-refresh",
};
const link = `https://example.com/esign/#/sign/${"a".repeat(64)}`;
test("UTF-8 Gmail MIME preserves QQ recipient, private link and escaped title", () => {
  const raw = invitationRaw(
    "123456@qq.com",
    "车辆 <script>合同</script>",
    link,
    "invitation-1",
  );
  assert.match(raw, /^[A-Za-z0-9_-]+$/);
  const mime = Buffer.from(raw, "base64url").toString("utf8");
  assert.match(mime, new RegExp(`From: Ready Ready Motors <${GMAIL_SENDER}>`));
  assert.match(mime, /To: 123456@qq.com/);
  assert.match(mime, /Reply-To: readyreadymotors9999@gmail.com/);
  const parts = [
    ...mime.matchAll(
      /Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/g,
    ),
  ].map((m) =>
    Buffer.from(m[1].replace(/\r\n/g, ""), "base64").toString("utf8"),
  );
  assert.equal(parts.length, 2);
  assert.ok(parts[0].includes(link));
  assert.ok(parts[0].includes("车辆"));
  assert.ok(parts[1].includes("&lt;script&gt;"));
  assert.ok(!parts[1].includes("<script>"));
  assert.throws(() =>
    invitationRaw("a@qq.com\r\nBcc: b@evil.com", "title", link, "id"),
  );
  assert.throws(() => invitationRaw("a@qq.com", "title", link, "id\r\nBcc:x"));
});
test("refreshes OAuth server-side and verifies the exact sending account", async () => {
  const calls = [];
  const mock = async (url, options) => {
    calls.push([url, options]);
    if (url.endsWith("/token")) {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get("grant_type"), "refresh_token");
      assert.equal(form.get("client_secret"), "test-secret");
      return Response.json({ access_token: "temporary-access" });
    }
    assert.equal(options.headers.Authorization, "Bearer temporary-access");
    return Response.json({ email: GMAIL_SENDER, email_verified: true });
  };
  assert.equal(await gmailAccessToken(config, mock), "temporary-access");
  assert.equal(calls.length, 2);
  await assert.rejects(
    () =>
      gmailAccessToken(config, async (url) =>
        url.endsWith("/token")
          ? Response.json({ access_token: "temporary" })
          : Response.json({ email: "someone@gmail.com", email_verified: true }),
      ),
    /Connect readyreadymotors/,
  );
  await assert.rejects(
    () =>
      gmailAccessToken(config, async () =>
        Response.json({ error: "invalid_grant" }, { status: 400 }),
      ),
    /expired or was revoked/,
  );
  assert.throws(() => gmailConfig(() => undefined), /Gmail is not connected/);
});
test("Gmail send uses only server access token and requires confirmed message ID", async () => {
  let count = 0;
  const id = await sendGmail(
    "temporary-access",
    "123@qq.com",
    "Agreement",
    link,
    "invitation-1",
    async (url, options) => {
      count++;
      assert.equal(
        url,
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      );
      assert.equal(options.headers.Authorization, "Bearer temporary-access");
      assert.ok(JSON.parse(options.body).raw);
      return Response.json({ id: "gmail-message-1" });
    },
  );
  assert.equal(id, "gmail-message-1");
  assert.equal(count, 1);
  await assert.rejects(
    () =>
      sendGmail("a", "123@qq.com", "Agreement", link, "id", async () =>
        Response.json({ error: "quota" }, { status: 429 }),
      ),
    /sending limits/,
  );
  await assert.rejects(
    () =>
      sendGmail("a", "123@qq.com", "Agreement", link, "id", async () =>
        Response.json({}),
      ),
    /message ID/,
  );
});
test("one-time OAuth helper uses offline sending scope, PKCE and callback state", () => {
  const url = new URL(
    authorizationUrl(
      "client",
      "http://127.0.0.1:8787/callback",
      "random-state",
      "pkce-challenge",
    ),
  );
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("scope").includes("gmail.send"));
  assert.ok(!url.searchParams.get("scope").includes("gmail.readonly"));
  assert.equal(url.searchParams.get("login_hint"), GMAIL_SENDER);
  assert.equal(validState("state", "state"), true);
  assert.equal(validState("wrong", "state"), false);
  assert.equal(validState("ééééé", "state"), false);
  assert.equal(validState(null, "state"), false);
});
