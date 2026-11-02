import { Buffer } from "node:buffer";
import { emailAddress, escapeHtml } from "./validation.ts";
export const GMAIL_SENDER = "readyreadymotors9999@gmail.com";
export class GmailError extends Error {}
export type GmailConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};
export function gmailConfig(
  read: (name: string) => string | undefined,
): GmailConfig {
  const clientId = read("GMAIL_CLIENT_ID"),
    clientSecret = read("GMAIL_CLIENT_SECRET"),
    refreshToken = read("GMAIL_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken)
    throw new GmailError(
      "Gmail is not connected. Complete the one-time Gmail authorization and configure the Edge Function secrets.",
    );
  return { clientId, clientSecret, refreshToken };
}
function base64Utf8(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}
function lines64(value: string) {
  return value.replace(/(.{76})(?=.)/g, "$1\r\n");
}
export function invitationRaw(
  email: string,
  title: string,
  link: string,
  invitationId: string,
  reminder = false,
): string {
  const to = emailAddress(email),
    url = new URL(link);
  if (!["https:", "http:"].includes(url.protocol))
    throw new GmailError("Invalid signing URL.");
  if (!/^[a-zA-Z0-9-]+$/.test(invitationId))
    throw new GmailError("Invalid invitation ID.");
  const boundary = `esign-${invitationId}`;
  const text = `${reminder ? "Reminder: " : ""}Ready Ready Motors, Inc. invites you to review and sign ${title}.\n\nLichen Wang has already signed.\n\n${link}\n\nThis private link expires in 72 hours and can be used to sign once. Do not forward it. If you did not expect this message, contact the sender.`;
  const html = `<h2>${reminder ? "Signature reminder" : "Ready Ready Motors, Inc."}</h2><p>Lichen Wang has signed <strong>${escapeHtml(title)}</strong>. Please review and add your signature.</p><p><a href="${escapeHtml(link)}">Review and sign document</a></p><p>Your private link expires in 72 hours and can be used to sign once. Do not forward it.</p>`;
  const mime = [
    `From: Ready Ready Motors <${GMAIL_SENDER}>`,
    `To: ${to}`,
    `Reply-To: ${GMAIL_SENDER}`,
    `Subject: ${encodedSubject(reminder ? `Reminder: ${title} — signature requested` : "Ready Ready Motors — document ready to sign")}`,
    `Message-ID: <esign-${invitationId}@gmail.com>`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    lines64(base64Utf8(text)),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    lines64(base64Utf8(html)),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return base64Utf8(mime)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export async function gmailAccessToken(
  config: GmailConfig,
  request: typeof fetch = fetch,
): Promise<string> {
  const r = await request("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok)
    throw new GmailError(
      "Gmail authorization expired or was revoked. Reconnect the sending account.",
    );
  const token = await r.json();
  if (typeof token.access_token !== "string" || !token.access_token)
    throw new GmailError(
      "Gmail did not return an access token. Reconnect the sending account.",
    );
  // gmail.send cannot read a mailbox profile. OpenID email verifies that the
  // refresh token belongs to the fixed sender before any invitation is issued.
  const identity = await request(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!identity.ok)
    throw new GmailError(
      "Unable to verify the Gmail sender. Reconnect with email and gmail.send permissions.",
    );
  const profile = await identity.json();
  if (
    profile.email?.toLowerCase() !== GMAIL_SENDER ||
    profile.email_verified !== true
  )
    throw new GmailError(
      `Connect ${GMAIL_SENDER} as the Gmail sending account.`,
    );
  return token.access_token;
}
export async function sendGmail(
  accessToken: string,
  email: string,
  title: string,
  link: string,
  invitationId: string,
  request: typeof fetch = fetch,
  reminder = false,
): Promise<string> {
  const r = await request(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw: invitationRaw(email, title, link, invitationId, reminder),
      }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!r.ok) {
    if (r.status === 429 || r.status === 403)
      throw new GmailError(
        "Gmail rejected this send. Check that Gmail API is enabled, permission was granted, and account sending limits are not exceeded.",
      );
    throw new GmailError(
      "Gmail could not confirm sending the invitation. Refresh before trying again.",
    );
  }
  const data = await r.json();
  if (typeof data.id !== "string" || !data.id)
    throw new GmailError(
      "Gmail did not confirm a message ID. Refresh before trying again.",
    );
  return data.id;
}

function encodedSubject(value: string) {
  const characters = Array.from(value);
  const words: string[] = [];
  for (let i = 0; i < characters.length; i += 12)
    words.push(`=?UTF-8?B?${base64Utf8(characters.slice(i, i + 12).join(""))}?=`);
  return words.join("\r\n ");
}
// One notification per recipient; names/titles are encoded, never raw MIME headers.
export type PdfAttachment = { filename: string; bytes: Uint8Array };
export function notificationRaw(email: string, subject: string, message: string, id: string, attachment?: PdfAttachment) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new GmailError("Invalid notification ID.");
  const boundary = `esign-attachment-${id}`;
  const mime = [
    `From: Ready Ready Motors <${GMAIL_SENDER}>`,
    `To: ${emailAddress(email)}`,
    `Reply-To: ${GMAIL_SENDER}`,
    `Subject: ${encodedSubject(subject)}`,
    `Message-ID: <esign-notification-${id}@gmail.com>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    ...(attachment ? [`Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`] : []),
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '', lines64(base64Utf8(message)), '',
    ...(attachment ? [
      `--${boundary}`,
      'Content-Type: application/pdf; name="completed-document.pdf"',
      `Content-Disposition: attachment; filename="completed-document.pdf"; filename*=UTF-8''${encodeURIComponent(attachment.filename).replace(/'/g, "%27")}`,
      'Content-Transfer-Encoding: base64', '',
      lines64(Buffer.from(attachment.bytes.buffer, attachment.bytes.byteOffset, attachment.bytes.byteLength).toString("base64")),
      `--${boundary}--`, '',
    ] : []),
  ].join('\r\n');
  return base64Utf8(mime).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function sendNotification(accessToken: string, email: string, subject: string, message: string, id: string, request: typeof fetch = fetch, attachment?: PdfAttachment) {
  const response = await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: notificationRaw(email, subject, message, id, attachment) }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new GmailError('Notification delivery was not confirmed.');
  const data = await response.json();
  if (typeof data.id !== 'string' || !data.id) throw new GmailError('Notification message ID missing.');
  return data.id as string;
}
