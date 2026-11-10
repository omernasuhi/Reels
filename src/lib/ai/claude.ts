import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { env } from "@/lib/env";
import { getSetting, logCost } from "@/server/db";

let client: Anthropic | null = null;
export function anthropic() {
  client ??= new Anthropic({ maxRetries: 4, timeout: 10 * 60 * 1000 });
  return client;
}

// Model isteği güvenlik nedeniyle reddettiğinde fırlatılır.
export class ContentRefusedError extends Error {}

type Ctx = { projectId: string | null; userId: string | null; operation: string };

type Args<T extends z.ZodType> = {
  schema: T;
  system: string;
  content: Anthropic.MessageParam["content"];
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  ctx: Ctx;
};

// Claude'dan şemaya uygun JSON alır (yapılandırılmış çıktı) ve maliyeti loglar.
export async function claudeJson<T extends z.ZodType>(args: Args<T>): Promise<z.infer<T>> {
  let response;
  try {
    response = await anthropic().messages.parse({
      model: env.claudeModel,
      max_tokens: args.maxTokens ?? 16000,
      system: args.system,
      messages: [{ role: "user", content: args.content }],
      output_config: { format: zodOutputFormat(args.schema), effort: args.effort ?? "medium" },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error("Anthropic API anahtarı geçersiz.");
    }
    throw err;
  }

  const prices = await getSetting("api_prices");
  const u = response.usage;
  const inputTokens =
    u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  await logCost(
    args.ctx.projectId,
    args.ctx.userId,
    "anthropic",
    args.ctx.operation,
    (inputTokens * prices.claude_input_per_mtok + u.output_tokens * prices.claude_output_per_mtok) / 1e6,
    { model: response.model, input_tokens: inputTokens, output_tokens: u.output_tokens },
  );

  if (response.stop_reason === "refusal") throw new ContentRefusedError("refused");
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new Error(`Claude output unusable (stop_reason=${response.stop_reason})`);
  }
  return response.parsed_output as z.infer<T>;
}
