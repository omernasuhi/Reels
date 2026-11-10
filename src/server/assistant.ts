import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getDict } from "@/i18n";
import { anthropic } from "@/lib/ai/claude";
import { env } from "@/lib/env";
import { contentTypeFor, getObject } from "@/lib/storage";
import type { Card, Character, Frame, Location, Project, Script } from "@/lib/types";
import { db, getSetting, logCost, logEvent, type Pricing } from "@/server/db";
import * as ops from "@/server/ops";
import { latestScript } from "@/server/pipeline/script";
import { projectRules, rulesSection } from "@/server/rules";

// Proje asistanı: kullanıcıyla konuşur ve uygulamanın kendi işlemlerini araç
// olarak çağırır. Kredi harcayan araçlar, kullanıcının belirlediği eşiğin
// üstündeyse çalıştırılmaz; sohbette onay kartı olarak bekletilir.

const t = getDict();

type Ctx = {
  userId: string;
  project: Project;
  script: Script | null;
  characters: Character[];
  locations: Location[];
  frames: Frame[];
  cards: Card[];
  pricing: Pricing;
  balance: number;
  autoSpend: number;
};

async function loadCtx(projectId: string, userId: string): Promise<Ctx | null> {
  const project = await ops.ownProject(projectId, userId);
  if (!project) return null;
  const [script, chars, locs, frames, cards, pricing, balance] = await Promise.all([
    latestScript(projectId),
    db().from("characters").select("*").eq("project_id", projectId).order("created_at"),
    db().from("locations").select("*").eq("project_id", projectId),
    db().from("frames").select("*").eq("project_id", projectId).order("index"),
    db().from("cards").select("*").eq("project_id", projectId).order("frame_index"),
    getSetting("pricing"),
    ops.balanceOf(userId),
  ]);
  return {
    userId,
    project,
    script,
    characters: (chars.data ?? []) as Character[],
    locations: (locs.data ?? []) as Location[],
    frames: (frames.data ?? []) as Frame[],
    cards: (cards.data ?? []) as Card[],
    pricing,
    balance,
    autoSpend: Number((project.options as Record<string, unknown>).autoSpend) || 0,
  };
}

function snapshot(c: Ctx): string {
  const lines = [
    `status: ${c.project.status}${c.project.job_step ? ` (running step: ${c.project.job_step})` : ""}`,
    `title: ${c.project.title}`,
    `topic: ${c.project.topic}`,
    `options: ${JSON.stringify(c.project.options)}`,
    `credits_balance: ${c.balance}; auto_spend_limit: ${c.autoSpend}`,
    `prices (credits): ${JSON.stringify(c.pricing)}`,
  ];
  if (c.project.job_error) lines.push(`last_error_shown_to_user: ${c.project.job_error}`);
  if (c.script) {
    lines.push(`\nSCRIPT (version ${c.script.version}, ${c.script.word_count} words, ${c.script.approved_at ? "approved" : "not approved"}):\n${c.script.plain_text}`);
    lines.push(`vote_options: ${JSON.stringify(c.script.vote_options)}`);
  }
  if (c.characters.length) {
    lines.push(`\nCHARACTERS:\n${c.characters.map((x) => `- ${x.name} [card: ${x.status}${x.approved_at ? ", approved" : ""}]: ${x.description_en}`).join("\n")}`);
  }
  if (c.locations.length) lines.push(`\nLOCATIONS:\n${c.locations.map((l) => `- ${l.key}: ${l.description_en}`).join("\n")}`);
  if (c.frames.length) {
    const name = new Map(c.characters.map((x) => [x.id, x.name]));
    lines.push(
      `\nFRAMES (number | status | characters | location | sentence):\n${c.frames
        .map((f) => `${f.index + 1} | ${f.status} | ${f.character_ids.map((id) => name.get(id)).join(", ") || "-"} | ${f.location_key ?? "-"} | ${f.sentence}`)
        .join("\n")}`,
    );
  }
  if (c.cards.length) {
    lines.push(`\nCARDS (number | text | on frame | enabled):\n${c.cards.map((k, i) => `${i + 1} | ${k.text} | ${k.frame_index + 1} | ${k.enabled}`).join("\n")}`);
  }
  return lines.join("\n");
}

const SYSTEM = `You are the production assistant inside a studio app that turns a topic into a narrated vertical story video (graphic-novel stills, Turkish narration). The user directs; you carry out their wishes with your tools, which call the studio's own operations. Speak Turkish, briefly and plainly. Image prompts and character or location descriptions are always written in English.

How the project moves: topic -> script (user approves) -> character cards (user approves each) -> frames (optionally 4 pilot frames first, then the rest plus the voice-over) -> preview -> export. Each message you receive starts with the current project state; trust it over your memory of earlier turns.

Working with the user
- The user decides. When there is a choice to make, offer 2-4 concrete options with suggest_replies so they can answer with one tap; put your recommendation first and mark it "(önerim)". Do not ask open questions when you can offer options.
- When the user dislikes something, find out exactly what (look at the image with view_image if it is about a picture), then fix it with the cheapest tool that does the job. For one wrong detail in a picture, use fix_frame or edit_character (they keep the rest of the image) instead of regenerating from scratch.
- If the change should hold in later frames too (a character's look, a location), change the description as well, not only the one picture.
- Write plain text: the chat does not render markdown, so no asterisks, headings or tables. When you offer choices, describe them in a short sentence each and put the choices themselves in suggest_replies; do not repeat them as a numbered list.
- Do what was asked, then say in one or two sentences what you did and what happens next. Do not narrate tool mechanics.
- If something cannot be done at the current stage, say so and say what would make it possible.

Spending
- Tools marked [costs credits] spend the user's credits. The app enforces this: above the user's auto-spend limit the tool does not run and returns PENDING, and a confirmation card appears in the chat. When you get PENDING, tell the user in one sentence what will happen and what it costs, and stop; do not call the tool again.
- Never start production, export, or regenerate many items without the user having asked for exactly that.
- Images take about a minute to generate. After starting one, tell the user it is on its way; do not wait for it.

Fixed rules you cannot change: every face is a round pure-white cartoon face with dot eyes; no readable text, logos, real people, brands or well-known characters in images; no adult content or graphic violence. The style, face and text blocks are appended to every image prompt automatically, so never write them into a shot prompt or description yourself. A character description is used word for word in every frame, so keep it one paragraph covering hair, accessories, clothes and build, with one distinguishing mark.`;

type Tool = {
  name: string;
  description: string;
  properties: Record<string, unknown>;
  required: string[];
  cost?: (c: Ctx, a: Args) => number;
  label?: (c: Ctx, a: Args) => string;
  run: (c: Ctx, a: Args) => Promise<string | Anthropic.ToolResultBlockParam["content"]>;
};
type Args = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const result = (r: ops.ActionResult, ok: string) => (r.error ? `FAILED: ${r.error}` : ok);

function character(c: Ctx, name: unknown) {
  const n = str(name).toLocaleLowerCase("tr-TR").trim();
  return c.characters.find((x) => x.name.toLocaleLowerCase("tr-TR") === n) ?? c.characters.find((x) => x.name.toLocaleLowerCase("tr-TR").includes(n));
}
function frame(c: Ctx, number: unknown) {
  return c.frames.find((f) => f.index === Number(number) - 1);
}
const NO_CHAR = "FAILED: no character with that name; use a name from CHARACTERS.";
const NO_FRAME = "FAILED: no frame with that number; use a number from FRAMES.";
const NO_CARD = "FAILED: no card with that number; use a number from CARDS.";

const TOOLS: Tool[] = [
  {
    name: "view_image",
    description: "Look at a character card or a frame image. Use it before judging or fixing a picture the user complains about.",
    properties: { kind: { type: "string", enum: ["character", "frame"] }, name: { type: "string", description: "character name (for kind=character)" }, frame: { type: "integer", description: "frame number (for kind=frame)" } },
    required: ["kind"],
    run: async (c, a) => {
      const key = a.kind === "character" ? character(c, a.name)?.card_image_url : frame(c, a.frame)?.image_url;
      if (!key) return "FAILED: that image does not exist yet.";
      const bytes = await getObject(key);
      return [{ type: "image", source: { type: "base64", media_type: contentTypeFor(key) as "image/jpeg", data: bytes.toString("base64") } }];
    },
  },
  {
    name: "get_frame_details",
    description: "Read a frame's full shot prompt, quality-check result and timing.",
    properties: { frame: { type: "integer" } },
    required: ["frame"],
    run: async (c, a) => {
      const f = frame(c, a.frame);
      return f ? JSON.stringify({ shot_prompt_en: f.shot_prompt_en, kind: f.kind, qc_result: f.qc_result, start: f.start_time_final, duration: f.duration }) : NO_FRAME;
    },
  },
  {
    name: "rewrite_script",
    description: "[costs credits] Have the script rewritten following an instruction (stronger hook, shorter, different ending, different tone...). Only while the script is not approved.",
    properties: { instruction: { type: "string", description: "Turkish instruction for the writer" } },
    required: ["instruction"],
    cost: (c) => c.pricing.script,
    label: (_c, a) => t.assistant.labels.rewriteScript(str(a.instruction)),
    run: async (c, a) => result(await ops.requestScript(c.userId, c.project.id, str(a.instruction)), "Started. The new script appears in about a minute."),
  },
  {
    name: "set_script_text",
    description: "Replace the script text with an edited version (small wording fixes the user asked for). Free. Keep everything else word for word, including paragraph breaks. If the two vote words in the closing line change, also pass vote_options with the two new words (they drive the on-screen vote card). Only while the script is not approved.",
    properties: { text: { type: "string" }, vote_options: { type: "array", items: { type: "string" } } },
    required: ["text"],
    run: async (c, a) =>
      result(await ops.setScriptText(c.userId, c.project.id, str(a.text), Array.isArray(a.vote_options) ? a.vote_options.map(String) : undefined), "Saved as a new version."),
  },
  {
    name: "approve_script",
    description: "[costs credits] Approve the script on the user's behalf and start generating the character cards and the frame plan. Only when the user explicitly approves.",
    properties: {},
    required: [],
    cost: (c) => c.characters.length * c.pricing.character_card,
    label: (c) => t.assistant.labels.approveScript(c.characters.length),
    run: async (c) => result(await ops.approveScript(c.userId, c.project.id, c.script?.plain_text ?? ""), "Approved. Character cards and the frame plan are being generated."),
  },
  {
    name: "edit_character",
    description: "[costs credits] Change one thing about a character card while keeping the rest of the picture (e.g. remove the moustache, change the jacket colour). Give the visual change and the full updated description so later frames match. Only before frame production starts.",
    properties: { name: { type: "string" }, change: { type: "string", description: "English, one concrete visual change" }, new_description: { type: "string", description: "English, the complete updated one-paragraph description" } },
    required: ["name", "change", "new_description"],
    cost: (c) => c.pricing.character_card,
    label: (_c, a) => t.assistant.labels.editCharacter(str(a.name), str(a.change)),
    run: async (c, a) => {
      const ch = character(c, a.name);
      return ch ? result(await ops.regenerateCharacter(c.userId, ch.id, str(a.new_description), str(a.change)), "Started. The updated card appears in about a minute and needs the user's approval.") : NO_CHAR;
    },
  },
  {
    name: "regenerate_character",
    description: "[costs credits] Generate a character card from scratch, optionally with a new full description. Use when the user wants a different look altogether. Only before frame production starts.",
    properties: { name: { type: "string" }, new_description: { type: "string", description: "English; omit to keep the current description" } },
    required: ["name"],
    cost: (c) => c.pricing.character_card,
    label: (_c, a) => t.assistant.labels.regenerateCharacter(str(a.name)),
    run: async (c, a) => {
      const ch = character(c, a.name);
      return ch ? result(await ops.regenerateCharacter(c.userId, ch.id, str(a.new_description) || undefined), "Started. The new card appears in about a minute and needs the user's approval.") : NO_CHAR;
    },
  },
  {
    name: "approve_character",
    description: "Approve a character card on the user's behalf. Free. Only when the user says the card is fine.",
    properties: { name: { type: "string" } },
    required: ["name"],
    run: async (c, a) => {
      const ch = character(c, a.name);
      return ch ? result(await ops.approveCharacter(c.userId, ch.id), "Approved.") : NO_CHAR;
    },
  },
  {
    name: "set_location",
    description: "Change a location's description (English, one sentence). Free. Applies to frames generated afterwards.",
    properties: { key: { type: "string" }, description: { type: "string" } },
    required: ["key", "description"],
    run: async (c, a) => result(await ops.setLocation(c.userId, c.project.id, str(a.key), str(a.description)), "Saved."),
  },
  {
    name: "set_frame_prompt",
    description: "Rewrite a frame's shot prompt (English: shot type, characters with their descriptions word for word, action, emotion, lighting). Always pass characters: the names of every character visible in the new shot (their cards become the reference images; empty list for a frame with no people). Free; the picture changes only when the frame is generated or regenerated afterwards.",
    properties: { frame: { type: "integer" }, shot_prompt_en: { type: "string" }, characters: { type: "array", items: { type: "string" } } },
    required: ["frame", "shot_prompt_en", "characters"],
    run: async (c, a) => {
      const f = frame(c, a.frame);
      if (!f) return NO_FRAME;
      const ids = (Array.isArray(a.characters) ? a.characters : []).map((n) => character(c, n)?.id).filter((id): id is string => Boolean(id));
      return result(await ops.setFramePrompt(c.userId, f.id, str(a.shot_prompt_en), ids), "Saved.");
    },
  },
  {
    name: "fix_frame",
    description: "[costs credits] Change one thing in an existing frame while keeping composition, characters and lighting (wrong hand, stray text, wrong object, wrong character detail).",
    properties: { frame: { type: "integer" }, change: { type: "string", description: "English, one concrete change" } },
    required: ["frame", "change"],
    cost: (c) => c.pricing.frame_regenerate,
    label: (_c, a) => t.assistant.labels.fixFrame(Number(a.frame), str(a.change)),
    run: async (c, a) => {
      const f = frame(c, a.frame);
      return f ? result(await ops.regenerateFrame(c.userId, f.id, str(a.change)), "Started. The fixed frame appears in about a minute.") : NO_FRAME;
    },
  },
  {
    name: "regenerate_frame",
    description: "[costs credits] Generate a frame again from its shot prompt (after set_frame_prompt, or when the user wants a different picture altogether).",
    properties: { frame: { type: "integer" } },
    required: ["frame"],
    cost: (c) => c.pricing.frame_regenerate,
    label: (_c, a) => t.assistant.labels.regenerateFrame(Number(a.frame)),
    run: async (c, a) => {
      const f = frame(c, a.frame);
      return f ? result(await ops.regenerateFrame(c.userId, f.id), "Started. The new frame appears in about a minute.") : NO_FRAME;
    },
  },
  {
    name: "resolve_flagged_frame",
    description: "For a frame in status review or error: retry it for free, or accept it as it is (review only).",
    properties: { frame: { type: "integer" }, action: { type: "string", enum: ["retry", "accept"] } },
    required: ["frame", "action"],
    run: async (c, a) => {
      const f = frame(c, a.frame);
      if (!f) return NO_FRAME;
      return a.action === "accept" ? result(await ops.acceptFrame(c.userId, f.id), "Accepted.") : result(await ops.retryFrame(c.userId, f.id), "Retry started.");
    },
  },
  {
    name: "start_production",
    description: "[costs credits] Start generating frames once all character cards are approved. pilot=true generates only the first 4 frames so the user can check the style first (recommended); pilot=false generates every frame plus the voice-over.",
    properties: { pilot: { type: "boolean" } },
    required: ["pilot"],
    cost: (c, a) => (a.pilot && c.frames.length > ops.PILOT_FRAMES ? ops.PILOT_FRAMES * c.pricing.frame : c.frames.length * c.pricing.frame + c.pricing.voiceover),
    label: (c, a) => (a.pilot ? t.assistant.labels.pilot(ops.PILOT_FRAMES) : t.assistant.labels.produceAll(c.frames.length)),
    run: async (c, a) => result(await ops.startProduction(c.userId, c.project.id, Boolean(a.pilot)), "Production started."),
  },
  {
    name: "continue_production",
    description: "[costs credits] After the pilot frames are approved, generate the remaining frames and the voice-over.",
    properties: {},
    required: [],
    cost: (c) => c.frames.filter((f) => f.status === "queued").length * c.pricing.frame + c.pricing.voiceover,
    label: (c) => t.assistant.labels.produceRest(c.frames.filter((f) => f.status === "queued").length),
    run: async (c) => result(await ops.continueProduction(c.userId, c.project.id), "The remaining frames and the voice-over are being generated."),
  },
  {
    name: "update_card",
    description: "Change an on-screen title card's text or switch it on or off. Free.",
    properties: { card: { type: "integer", description: "card number from CARDS" }, text: { type: "string" }, enabled: { type: "boolean" } },
    required: ["card"],
    run: async (c, a) => {
      const k = c.cards[Number(a.card) - 1];
      if (!k) return NO_CARD;
      return result(await ops.updateCard(c.userId, k.id, { text: typeof a.text === "string" ? a.text : undefined, enabled: typeof a.enabled === "boolean" ? a.enabled : undefined }), "Card updated.");
    },
  },
  {
    name: "add_card",
    description: "Add an on-screen title card on a frame. Free. Text is shown in capitals. y_position 0 is the top, 1 the bottom.",
    properties: { text: { type: "string" }, frame: { type: "integer" }, offset_seconds: { type: "number" }, duration_seconds: { type: "number" }, size: { type: "integer", description: "font size, 40-160, default 96" }, y_position: { type: "number" } },
    required: ["text", "frame"],
    run: async (c, a) =>
      result(
        await ops.addCard(c.userId, c.project.id, { text: str(a.text), frame_index: Number(a.frame) - 1, offset: a.offset_seconds as number, duration: a.duration_seconds as number, size: a.size as number, y_position: a.y_position as number }),
        "Card added.",
      ),
  },
  {
    name: "remove_card",
    description: "Delete an on-screen title card. Free.",
    properties: { card: { type: "integer" } },
    required: ["card"],
    run: async (c, a) => {
      const k = c.cards[Number(a.card) - 1];
      return k ? result(await ops.removeCard(c.userId, k.id), "Card removed.") : NO_CARD;
    },
  },
  {
    name: "regenerate_audio",
    description: "[costs credits] Record the voice-over again and rebuild the timing (frames are kept). Use when the user dislikes the read or changed the default voice.",
    properties: {},
    required: [],
    cost: (c) => c.pricing.voiceover,
    label: () => t.assistant.labels.audio,
    run: async (c) => result(await ops.regenerateAudio(c.userId, c.project.id), "The voice-over is being recorded again."),
  },
  {
    name: "export_video",
    description: "[costs credits] Render the two final MP4 files (with cards and clean). Only in preview, when the user asks for the export.",
    properties: {},
    required: [],
    cost: (c) => c.pricing.render,
    label: () => t.assistant.labels.export,
    run: async (c) => result(await ops.exportVideo(c.userId, c.project.id), "Export started; it takes a few minutes."),
  },
  {
    name: "suggest_replies",
    description: "Offer the user 2-4 short tappable replies in Turkish for your question. Call it once, together with your question, at the end of your turn.",
    properties: { options: { type: "array", items: { type: "string" } } },
    required: ["options"],
    run: async () => "Shown to the user.",
  },
];

const byName = new Map(TOOLS.map((x) => [x.name, x]));

function toolDefs(): Anthropic.Tool[] {
  return TOOLS.map((x) => ({
    name: x.name,
    description: x.description,
    input_schema: { type: "object", properties: x.properties, required: x.required },
  }));
}

export type ChatMessage = { id: number; role: "user" | "assistant"; text: string; options: string[] | null; created_at: string };
export type PendingAction = { id: string; label: string; cost: number; status: string };

export async function chatHistory(projectId: string) {
  const [{ data: messages }, { data: pending }] = await Promise.all([
    db().from("chat_messages").select("*").eq("project_id", projectId).order("id", { ascending: false }).limit(60),
    db().from("pending_actions").select("id, label, cost, status").eq("project_id", projectId).eq("status", "pending").order("created_at"),
  ]);
  return { messages: ((messages ?? []) as ChatMessage[]).reverse(), pending: (pending ?? []) as PendingAction[] };
}

async function saveMessage(projectId: string, role: "user" | "assistant", text: string, options?: string[] | null) {
  await db().from("chat_messages").insert({ project_id: projectId, role, text, options: options?.length ? options : null });
}

// Kullanıcının mesajını işler: Claude araçları çağırır, sonuç sohbete yazılır.
export async function runAssistant(projectId: string, userId: string, userText: string): Promise<{ error?: string }> {
  let ctx = await loadCtx(projectId, userId);
  if (!ctx) return { error: t.common.notAllowed };
  const text = userText.trim().slice(0, 4000);
  if (!text) return { error: t.common.actionFailed };

  const { messages: history } = await chatHistory(projectId);
  await saveMessage(projectId, "user", text);

  const rules = rulesSection(await projectRules(projectId), "assistant");
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: SYSTEM + rules, cache_control: { type: "ephemeral" } }];
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-24).map((m) => ({ role: m.role, content: m.text })),
    { role: "user", content: `<project_state>\n${snapshot(ctx)}\n</project_state>\n\n${text}` },
  ];

  let options: string[] | null = null;
  let reply = "";
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    for (let turn = 0; turn < 10; turn++) {
      const response = await anthropic().messages.create({
        model: env.claudeModel,
        max_tokens: 6000,
        system,
        tools: toolDefs(),
        messages,
        output_config: { effort: "low" },
      });
      inputTokens += response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0) * 0.1;
      outputTokens += response.usage.output_tokens;
      const said = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      if (said) reply = reply ? `${reply}\n\n${said}` : said;
      if (response.stop_reason === "refusal") {
        reply = t.jobErrors.content;
        break;
      }
      const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || !calls.length) break;

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of calls) {
        const tool = byName.get(call.name);
        const args = (call.input ?? {}) as Args;
        let content: Anthropic.ToolResultBlockParam["content"];
        if (!tool) content = "FAILED: unknown tool.";
        else if (tool.name === "suggest_replies") {
          options = (Array.isArray(args.options) ? args.options : []).map((o) => String(o).slice(0, 80)).slice(0, 4);
          content = "Shown to the user.";
        } else {
          const cost = tool.cost?.(ctx, args) ?? 0;
          if (cost > ctx.autoSpend) {
            await db().from("pending_actions").insert({ project_id: projectId, tool: tool.name, args, cost, label: tool.label?.(ctx, args) ?? tool.name });
            content = `PENDING: not done yet. It costs ${cost} credits, which is above the user's auto-spend limit, so a confirmation card is now shown in the chat. Tell the user briefly and stop.`;
          } else {
            try {
              content = await tool.run(ctx, args);
              await logEvent(projectId, "assistant", `Araç: ${tool.name}`, { args, cost });
            } catch (err) {
              content = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
            }
            ctx = (await loadCtx(projectId, userId)) ?? ctx;
          }
        }
        results.push({ type: "tool_result", tool_use_id: call.id, content });
      }
      messages.push({ role: "assistant", content: response.content }, { role: "user", content: results });
    }
  } catch (err) {
    await logEvent(projectId, "assistant", "Asistan hatası", { error: err instanceof Error ? err.message : String(err) }, "error");
    await saveMessage(projectId, "assistant", t.assistant.failed);
    return { error: t.assistant.failed };
  }

  const prices = await getSetting("api_prices");
  await logCost(projectId, userId, "anthropic", "assistant", (inputTokens * prices.claude_input_per_mtok + outputTokens * prices.claude_output_per_mtok) / 1e6);
  await saveMessage(projectId, "assistant", reply || t.assistant.done, options);
  return {};
}

// Onay kartı: kullanıcı onaylarsa bekleyen işlem çalıştırılır (model devrede değil).
export async function resolvePending(projectId: string, userId: string, actionId: string, approve: boolean): Promise<{ error?: string }> {
  const ctx = await loadCtx(projectId, userId);
  if (!ctx) return { error: t.common.notAllowed };
  const { data } = await db()
    .from("pending_actions")
    .update({ status: approve ? "done" : "cancelled" })
    .eq("id", actionId)
    .eq("project_id", projectId)
    .eq("status", "pending")
    .select("*");
  const action = data?.[0];
  if (!action) return { error: t.common.notAllowed };
  if (!approve) {
    await saveMessage(projectId, "assistant", t.assistant.cancelled(action.label));
    return {};
  }
  const tool = byName.get(action.tool);
  let outcome = "FAILED";
  try {
    outcome = String(await tool!.run(ctx, action.args as Args));
  } catch (err) {
    outcome = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  }
  const failed = outcome.startsWith("FAILED");
  if (failed) await db().from("pending_actions").update({ status: "failed" }).eq("id", actionId);
  await logEvent(projectId, "assistant", `Onaylanan işlem: ${action.tool}`, { args: action.args, cost: action.cost, outcome }, failed ? "warn" : "info");
  await saveMessage(projectId, "assistant", failed ? t.assistant.actionFailed(action.label, outcome.replace(/^FAILED:\s*/, "")) : t.assistant.actionStarted(action.label));
  return {};
}

export async function setAutoSpend(projectId: string, userId: string, limit: number): Promise<{ error?: string }> {
  const project = await ops.ownProject(projectId, userId);
  if (!project) return { error: t.common.notAllowed };
  const autoSpend = Math.min(200, Math.max(0, Math.floor(limit) || 0));
  await db().from("projects").update({ options: { ...project.options, autoSpend } }).eq("id", projectId);
  return {};
}
