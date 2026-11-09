import "server-only";
import crypto from "node:crypto";
import { env, isWebhookReachable } from "@/lib/env";
import { fetchRetry } from "@/lib/http";

const API = "https://api.replicate.com/v1";

export type Prediction = {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output: string[] | string | null;
  error: string | null;
};

function headers(extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${env.replicateToken}`, ...extra };
}

export function isTerminal(p: Prediction) {
  return p.status === "succeeded" || p.status === "failed" || p.status === "canceled";
}

export function outputUrl(p: Prediction): string | null {
  if (!p.output) return null;
  return Array.isArray(p.output) ? (p.output[0] ?? null) : p.output;
}

// Görsel üretimi başlatır. `Prefer: wait` ile sonuç 60 sn içinde hazırsa aynı
// yanıtta gelir; değilse webhook ya da yoklama ile alınır.
export async function createImagePrediction(prompt: string, referenceUrls: string[]): Promise<Prediction> {
  const body: Record<string, unknown> = {
    input: {
      prompt: prompt.slice(0, 4000),
      image_input: referenceUrls.slice(0, 10),
      size: "2K",
      aspect_ratio: "9:16",
      output_format: "jpeg",
    },
  };
  if (isWebhookReachable) {
    body.webhook = `${env.appUrl}/api/webhooks/replicate`;
    body.webhook_events_filter = ["completed"];
  }
  const res = await fetchRetry(`${API}/models/${env.replicateModel}/predictions`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json", Prefer: "wait=60" }),
    body: JSON.stringify(body),
    timeoutMs: 90_000,
    retries: 5,
  });
  return (await res.json()) as Prediction;
}

export async function getPrediction(id: string): Promise<Prediction> {
  const res = await fetchRetry(`${API}/predictions/${id}`, { headers: headers(), timeoutMs: 30_000 });
  return (await res.json()) as Prediction;
}

// Replicate çıktı adresleri geçicidir; dosyayı indirip kendi depomuza kopyalarız.
export async function downloadOutput(url: string): Promise<Buffer> {
  const res = await fetchRetry(url, { headers: headers(), timeoutMs: 120_000 });
  return Buffer.from(await res.arrayBuffer());
}

// Yerel depolamada dosyalar Replicate'in erişebileceği bir adreste değildir;
// referans görselleri Replicate dosya deposuna yükleyip o adresi veririz.
const uploaded = new Map<string, { url: string; at: number }>();

export async function uploadReference(cacheKey: string, bytes: Buffer, contentType: string): Promise<string> {
  const hit = uploaded.get(cacheKey);
  if (hit && Date.now() - hit.at < 12 * 3600 * 1000) return hit.url;
  const form = new FormData();
  form.append("content", new Blob([new Uint8Array(bytes)], { type: contentType }), cacheKey.split("/").pop());
  const res = await fetchRetry(`${API}/files`, { method: "POST", headers: headers(), body: form, timeoutMs: 120_000 });
  const json = (await res.json()) as { urls: { get: string } };
  uploaded.set(cacheKey, { url: json.urls.get, at: Date.now() });
  return json.urls.get;
}

// Webhook imzası (Standard Webhooks): HMAC-SHA256(secret, "id.timestamp.body").
export function verifyWebhook(headersIn: Headers, body: string): boolean {
  const id = headersIn.get("webhook-id");
  const ts = headersIn.get("webhook-timestamp");
  const sigs = headersIn.get("webhook-signature");
  if (!id || !ts || !sigs || !env.replicateWebhookSecret) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(env.replicateWebhookSecret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest();
  return sigs.split(" ").some((part) => {
    const given = Buffer.from(part.split(",")[1] ?? "", "base64");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}
