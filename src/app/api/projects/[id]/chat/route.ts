import { getUser } from "@/server/auth";
import { chatHistory, resolvePending, runAssistant, setAutoSpend } from "@/server/assistant";
import { ownProject } from "@/server/ops";

export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authorize(params: Promise<{ id: string }>) {
  const { id } = await params;
  const user = await getUser();
  if (!user || !UUID.test(id)) return null;
  const project = await ownProject(id, user.id);
  return project ? { id, userId: user.id, project } : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(params);
  if (!auth) return Response.json({ error: "not found" }, { status: 404 });
  const history = await chatHistory(auth.id);
  const autoSpend = Number((auth.project.options as Record<string, unknown>).autoSpend) || 0;
  return Response.json({ ...history, autoSpend }, { headers: { "Cache-Control": "private, no-store" } });
}

// { message } | { confirm: id } | { cancel: id } | { autoSpend: n }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(params);
  if (!auth) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  let result: { error?: string } = {};
  if (typeof body.message === "string") result = await runAssistant(auth.id, auth.userId, body.message);
  else if (typeof body.confirm === "string" && UUID.test(body.confirm)) result = await resolvePending(auth.id, auth.userId, body.confirm, true);
  else if (typeof body.cancel === "string" && UUID.test(body.cancel)) result = await resolvePending(auth.id, auth.userId, body.cancel, false);
  else if (typeof body.autoSpend === "number") result = await setAutoSpend(auth.id, auth.userId, body.autoSpend);
  const history = await chatHistory(auth.id);
  const project = await ownProject(auth.id, auth.userId);
  const autoSpend = Number((project?.options as Record<string, unknown> | undefined)?.autoSpend) || 0;
  return Response.json({ ...history, autoSpend, error: result.error });
}
