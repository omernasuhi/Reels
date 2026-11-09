import { getUser, isAdmin } from "@/server/auth";
import { loadProjectState } from "@/server/state";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!UUID.test(id)) return Response.json({ error: "not found" }, { status: 404 });
  const state = await loadProjectState(id, user.id, await isAdmin());
  if (!state) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(state, { headers: { "Cache-Control": "private, no-store" } });
}
