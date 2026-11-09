import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GrantForm } from "@/components/grant-form";
import { getDict } from "@/i18n";
import { getUser, isAdmin } from "@/server/auth";
import { db, getSetting } from "@/server/db";

const t = getDict();
export const metadata: Metadata = { title: t.admin.title };

const usd = (n: number) => `$${n.toFixed(2)}`;

// Yönetici için basit maliyet/marj sayfası: proje başına gerçek API maliyeti ve harcanan kredi.
export default async function AdminPage() {
  if (!(await isAdmin())) notFound();
  const user = await getUser();
  const [{ data: costs }, { data: tx }, { data: projects }, prices] = await Promise.all([
    db().from("api_costs").select("project_id, cost_usd").limit(20000),
    db().from("credit_transactions").select("project_id, amount, kind").in("kind", ["reserve", "refund"]).limit(20000),
    db().from("projects").select("id, title, user_id, created_at").order("created_at", { ascending: false }).limit(200),
    getSetting("api_prices"),
  ]);

  const costBy = new Map<string, number>();
  for (const c of costs ?? []) {
    if (c.project_id) costBy.set(c.project_id, (costBy.get(c.project_id) ?? 0) + Number(c.cost_usd));
  }
  const creditsBy = new Map<string, number>();
  for (const x of tx ?? []) {
    if (x.project_id) creditsBy.set(x.project_id, (creditsBy.get(x.project_id) ?? 0) - x.amount);
  }

  const rows = (projects ?? [])
    .map((p) => {
      const cost = costBy.get(p.id) ?? 0;
      const credits = creditsBy.get(p.id) ?? 0;
      const revenue = credits * prices.credit_value;
      return { ...p, cost, credits, revenue, margin: revenue - cost };
    })
    .filter((r) => r.cost > 0 || r.credits > 0);
  const total = rows.reduce(
    (a, r) => ({ cost: a.cost + r.cost, credits: a.credits + r.credits, revenue: a.revenue + r.revenue }),
    { cost: 0, credits: 0, revenue: 0 },
  );
  const th = "px-3 py-2 font-medium";
  const num = "px-3 py-2 text-right";

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-tight">{t.admin.title}</h1>

      <h2 className="mt-10 text-xl font-semibold">{t.admin.costs}</h2>
      <p className="mt-1 text-muted-foreground">{t.admin.estimateNote}</p>
      {rows.length === 0 ? (
        <p className="mt-3">{t.admin.noData}</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] text-left text-[15px]">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={th}>{t.admin.project}</th>
                <th scope="col" className={`${th} text-right`}>{t.admin.cost}</th>
                <th scope="col" className={`${th} text-right`}>{t.admin.credits}</th>
                <th scope="col" className={`${th} text-right`}>{t.admin.revenue}</th>
                <th scope="col" className={`${th} text-right`}>{t.admin.margin}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border">
                  <td className="px-3 py-2">
                    <Link href={`/projects/${r.id}`} className="underline underline-offset-4">
                      {r.title}
                    </Link>
                  </td>
                  <td className={num}>{usd(r.cost)}</td>
                  <td className={num}>{r.credits}</td>
                  <td className={num}>{usd(r.revenue)}</td>
                  <td className={num}>{usd(r.margin)}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="px-3 py-2">{t.admin.total}</td>
                <td className={num}>{usd(total.cost)}</td>
                <td className={num}>{total.credits}</td>
                <td className={num}>{usd(total.revenue)}</td>
                <td className={num}>{usd(total.revenue - total.cost)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-12 text-xl font-semibold">{t.admin.grantTitle}</h2>
      <div className="mt-3 max-w-md">
        <GrantForm defaultEmail={user?.email ?? ""} />
      </div>
    </div>
  );
}
