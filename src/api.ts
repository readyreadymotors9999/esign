import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = Boolean(url && key);
export const supabase = createClient(
  url || "https://example.supabase.co",
  key || "unconfigured",
);
export type Field = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  type: "signature" | "date";
  signer?: "company" | "recipient";
};
export type Document = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  fields: Field[];
  recipient_name?: string;
  original_path: string;
};
export async function api<T = any>(
  action: string,
  body: object = {},
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const response = await fetch(`${url}/functions/v1/esign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${session?.access_token || key}`,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

export async function editDocumentPdf(
  documentId: string,
  expectedPath: string,
  operation: string,
  page: number,
  fields: Field[],
  file?: File,
  range?: string,
) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const form = new FormData();
  form.set("action", "edit_pdf");
  form.set("documentId", documentId);
  form.set("expectedPath", expectedPath);
  form.set("operation", operation);
  form.set("page", String(page));
  form.set("fields", JSON.stringify(fields));
  if (range) form.set("range", range);
  if (file) form.set("file", file);
  const response = await fetch(`${url}/functions/v1/esign`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${session?.access_token || key}`,
    },
    body: form,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "PDF edit failed");
  return result;
}
