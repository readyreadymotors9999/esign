// Run on the account owner's computer. Never paste the resulting secrets in chat.
import { createServer } from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { readFile, mkdir, open } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
const sender = "readyreadymotors9999@gmail.com";
export const scope = "openid email https://www.googleapis.com/auth/gmail.send";
export function authorizationUrl(clientId, redirectUri, state, challenge) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    access_type: "offline",
    prompt: "consent",
    login_hint: sender,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}
export function validState(actual, expected) {
  return (
    typeof actual === "string" &&
    Buffer.byteLength(actual) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}
export async function connectGmail(clientPath, outputPath) {
  const config = JSON.parse(
    await readFile(resolve(clientPath), "utf8"),
  ).installed;
  if (!config?.client_id || !config?.client_secret)
    throw new Error("Use a Google OAuth Desktop app credentials JSON file.");
  const output = resolve(outputPath),
    verifier = randomBytes(32).toString("base64url"),
    challenge = createHash("sha256").update(verifier).digest("base64url"),
    state = randomBytes(32).toString("hex");
  const server = createServer();
  await new Promise((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  const redirect = `http://127.0.0.1:${server.address().port}/callback`;
  console.log(
    "Open this URL in your browser and authorize " +
      sender +
      ":\n" +
      authorizationUrl(config.client_id, redirect, state, challenge),
  );
  try {
    const code = await new Promise((yes, no) => {
      const timer = setTimeout(
        () => no(new Error("Authorization timed out. Run the helper again.")),
        5 * 60 * 1000,
      );
      server.on("request", (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        const url = new URL(req.url, "http://127.0.0.1");
        if (
          req.method !== "GET" ||
          url.pathname !== "/callback" ||
          !validState(url.searchParams.get("state"), state)
        ) {
          res.writeHead(400);
          res.end("Invalid authorization callback.");
          return;
        }
        clearTimeout(timer);
        if (url.searchParams.has("error") || !url.searchParams.get("code")) {
          res.end("Authorization was not granted.");
          no(new Error("Google authorization was not granted."));
          return;
        }
        res.end(
          "Authorization received. Return to the terminal for the result.",
        );
        yes(url.searchParams.get("code"));
      });
    });
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.client_id,
        client_secret: config.client_secret,
        code,
        redirect_uri: redirect,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new Error(
        "Google token exchange failed. Check the client and try again.",
      );
    const token = await response.json();
    if (!token.refresh_token || !token.access_token)
      throw new Error(
        "No offline refresh token returned. Revoke this app in Google Account connections and authorize again.",
      );
    if (
      !token.scope
        ?.split(" ")
        .includes("https://www.googleapis.com/auth/gmail.send")
    )
      throw new Error("Gmail sending permission was not granted.");
    const identity = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: { Authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!identity.ok)
      throw new Error("Could not verify the authorized account.");
    const profile = await identity.json();
    if (
      profile.email?.toLowerCase() !== sender ||
      profile.email_verified !== true
    )
      throw new Error("Authorize only " + sender + ".");
    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    // wx refuses to overwrite an existing secret file. Values are never logged.
    const handle = await open(output, "wx", 0o600);
    try {
      const values = {
        GMAIL_CLIENT_ID: config.client_id,
        GMAIL_CLIENT_SECRET: config.client_secret,
        GMAIL_REFRESH_TOKEN: token.refresh_token,
      };
      await handle.writeFile(
        Object.entries(values)
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join("\n") + "\n",
      );
    } finally {
      await handle.close();
    }
    console.log(
      "Gmail secrets saved to " +
        output +
        ". Import this file into Supabase Edge Function secrets. Do not commit or share it.",
    );
  } finally {
    server.close();
    server.closeAllConnections();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2),
    client = args[args.indexOf("--client") + 1],
    output = args[args.indexOf("--output") + 1];
  if (
    !args.includes("--client") ||
    !args.includes("--output") ||
    !client ||
    !output
  ) {
    console.error(
      "Usage: node scripts/connect-gmail.mjs --client /private/client.json --output /private/gmail-secrets.env",
    );
    process.exitCode = 1;
  } else
    connectGmail(client, output).catch(() => {
      console.error(
        "Gmail connection failed. Check the selected account, client configuration, output path and consent settings, then retry. No credentials were printed.",
      );
      process.exitCode = 1;
    });
}
