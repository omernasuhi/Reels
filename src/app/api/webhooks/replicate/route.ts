import { verifyWebhook, type Prediction } from "@/lib/ai/replicate";
import { db } from "@/server/db";

// Replicate tahmini bitince çağırır. Sonuç kaydedilir; bekleyen üretim adımı
// bir sonraki denetiminde buradan okur (yoklama yalnızca yedek olarak kalır).
export async function POST(request: Request) {
  const body = await request.text();
  if (!verifyWebhook(request.headers, body)) return new Response("invalid signature", { status: 401 });
  const p = JSON.parse(body) as Prediction;
  if (p.id) {
    await db()
      .from("replicate_results")
      .upsert({ prediction_id: p.id, payload: { id: p.id, status: p.status, output: p.output, error: p.error } });
  }
  return new Response("ok");
}
