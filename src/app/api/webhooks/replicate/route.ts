import { send } from "@/inngest/client";
import { verifyWebhook } from "@/lib/ai/replicate";

// Replicate tahmini bitince çağırır; bekleyen Inngest adımını uyandırır.
export async function POST(request: Request) {
  const body = await request.text();
  if (!verifyWebhook(request.headers, body)) return new Response("invalid signature", { status: 401 });
  const { id } = JSON.parse(body) as { id?: string };
  if (id) await send("replicate/prediction.completed", { id });
  return new Response("ok");
}
