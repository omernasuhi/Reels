import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { getDict } from "@/i18n";
import { createClient } from "@/lib/supabase/server";
import type { CreditTransaction } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { getProfile } from "@/server/auth";

const t = getDict();
export const metadata: Metadata = { title: t.credits.title };

export default async function CreditsPage() {
  const supabase = await createClient();
  const [profile, tx, pricing] = await Promise.all([
    getProfile(),
    supabase
      .from("credit_transactions")
      .select("id, amount, kind, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("app_settings").select("value").eq("key", "pricing").maybeSingle(),
  ]);
  const rows = (tx.data ?? []) as CreditTransaction[];
  const prices = (pricing.data?.value ?? {}) as Record<string, number>;
  const reasons = t.credits.reasons as Record<string, string>;
  const priceNames = t.credits.priceNames as Record<string, string>;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight">{t.credits.title}</h1>

      <Card className="mt-8 p-5">
        <p className="font-medium">{t.credits.balance}</p>
        <p className="mt-1 text-4xl font-semibold tracking-tight">
          {profile?.credits_balance ?? 0}{" "}
          <span className="text-xl font-medium">{t.credits.unit}</span>
        </p>
      </Card>
      <Alert className="mt-4">{t.credits.purchaseSoon}</Alert>

      <h2 className="mt-10 text-xl font-semibold">{t.credits.pricesTitle}</h2>
      <dl className="mt-3 divide-y divide-border border-y border-border">
        {Object.entries(prices).map(([key, value]) => (
          <div key={key} className="flex justify-between gap-4 py-2.5">
            <dt>{priceNames[key] ?? key}</dt>
            <dd className="font-medium tabular-nums">
              {value} {t.credits.unit}
            </dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-10 text-xl font-semibold">{t.credits.history}</h2>
      {rows.length === 0 ? (
        <p className="mt-3">{t.credits.emptyHistory}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border border-y border-border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-baseline justify-between gap-4 py-2.5">
              <span>
                {reasons[r.reason] ?? t.credits.kinds[r.kind]}
                <span className="block text-[15px] text-muted-foreground">
                  {t.credits.kinds[r.kind]} · {formatDate(r.created_at)}
                </span>
              </span>
              <span className="font-medium tabular-nums">
                {r.amount > 0 ? `+${r.amount}` : r.amount}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
