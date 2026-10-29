// Browser-only OAuth: an access token exists only in this invocation, never in
// localStorage, the eSign database, URLs, or Edge Function requests.
export function googleDocumentId(url: string) {
  const parsed = new URL(url);
  const match = parsed.pathname.match(
    /^\/document\/d\/([A-Za-z0-9_-]+)(?:\/|$)/,
  );
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "docs.google.com" ||
    !match
  )
    throw new Error("Paste a Google Docs document URL.");
  return match[1];
}
let loading: Promise<void> | undefined;
function loadGoogle() {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve();
  if (!loading)
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loading = undefined;
        script.remove();
        reject(new Error("Unable to load Google sign-in."));
      };
      document.head.appendChild(script);
    });
  return loading;
}
export async function prepareGoogleImport(url: string) {
  const id = googleDocumentId(url),
    clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId)
    throw new Error(
      "Google Docs import needs a Google OAuth Client ID. You can export the Doc as PDF and upload it now.",
    );
  await loadGoogle();
  // Return a click handler so the OAuth popup opens directly inside a user gesture.
  return () =>
    new Promise<Blob>((resolve, reject) => {
      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: "https://www.googleapis.com/auth/drive.readonly",
        error_callback: () =>
          reject(new Error("Google authorization was cancelled or blocked.")),
        callback: async (response: any) => {
          if (response.error || !response.access_token)
            return reject(new Error("Google authorization was not granted."));
          try {
            const r = await fetch(
              `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=application%2Fpdf`,
              { headers: { Authorization: `Bearer ${response.access_token}` } },
            );
            if (!r.ok)
              throw new Error(
                "Google could not export this document. Check your account access and export permissions.",
              );
            const pdf = await r.blob();
            if (pdf.size > 10 * 1024 * 1024)
              throw new Error("Export exceeds the 10 MB PDF limit.");
            resolve(pdf);
          } catch (e) {
            reject(e);
          } finally {
            response.access_token = "";
          }
        },
      });
      client.requestAccessToken({ prompt: "select_account" });
    });
}
