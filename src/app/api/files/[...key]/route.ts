import crypto from "node:crypto";
import { contentTypeFor, getObject, isLocalStorage, signLocal } from "@/lib/storage";

// Yerel depolamadaki dosyaları imzalı ve süreli adresle sunar (R2 yokken).
export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  if (!isLocalStorage) return new Response("not found", { status: 404 });
  const key = (await params).key.map(decodeURIComponent).join("/");
  const url = new URL(request.url);
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") ?? "";
  const expected = signLocal(key, exp);
  const valid =
    exp > Date.now() / 1000 &&
    sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!valid) return new Response("forbidden", { status: 403 });

  let bytes: Buffer;
  try {
    bytes = await getObject(key);
  } catch {
    return new Response("not found", { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": contentTypeFor(key),
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
  };
  // Ses ve video oynatıcıları parça parça ister.
  const range = request.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    if (start <= end && start < bytes.length) {
      return new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
        status: 206,
        headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${bytes.length}`, "Content-Length": String(end - start + 1) },
      });
    }
  }
  return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Length": String(bytes.length) } });
}
