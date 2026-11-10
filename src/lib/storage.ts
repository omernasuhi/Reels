import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, isR2Configured } from "@/lib/env";

// Dosya depolama: R2 ayarlıysa Cloudflare R2 (S3 uyumlu), değilse yerel disk.
// İstemciye her zaman imzalı ve süreli adres verilir.

const HOUR = 3600;

let s3: S3Client | null = null;
function client() {
  s3 ??= new S3Client({
    region: "auto",
    endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.r2AccessKeyId, secretAccessKey: env.r2SecretAccessKey },
  });
  return s3;
}

function localPath(key: string) {
  const root = path.resolve(env.localStorageDir);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("invalid storage key");
  return full;
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  if (isR2Configured) {
    await client().send(
      new PutObjectCommand({ Bucket: env.r2Bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return;
  }
  const file = localPath(key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
}

export async function getObject(key: string): Promise<Buffer> {
  if (isR2Configured) {
    const res = await client().send(new GetObjectCommand({ Bucket: env.r2Bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  return fs.readFile(localPath(key));
}

export function signLocal(key: string, exp: number) {
  return crypto.createHmac("sha256", env.fileSigningSecret).update(`${key}:${exp}`).digest("hex");
}

// İmzalı adres. Süre saat dilimine yuvarlanır; böylece aynı saat içinde adres
// değişmez ve tarayıcı görselleri her yoklamada yeniden indirmez.
// absolute: tarayıcı dışındaki tüketiciler (render) için tam adres; tarayıcıya göreli adres verilir.
export async function signedUrl(key: string | null, ttlHours = 2, absolute = false): Promise<string | null> {
  if (!key) return null;
  const bucketStart = Math.floor(Date.now() / 1000 / HOUR) * HOUR;
  if (isR2Configured) {
    return getSignedUrl(client(), new GetObjectCommand({ Bucket: env.r2Bucket, Key: key }), {
      expiresIn: (ttlHours + 1) * HOUR,
      signingDate: new Date(bucketStart * 1000),
    });
  }
  const exp = bucketStart + (ttlHours + 1) * HOUR;
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${absolute ? env.appUrl : ""}/api/files/${encoded}?exp=${exp}&sig=${signLocal(key, exp)}`;
}

export const isLocalStorage = !isR2Configured;

export function contentTypeFor(key: string) {
  const ext = key.split(".").pop()?.toLowerCase();
  return (
    { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp3: "audio/mpeg", mp4: "video/mp4" }[
      ext ?? ""
    ] ?? "application/octet-stream"
  );
}
