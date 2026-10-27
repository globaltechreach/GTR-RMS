"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Flame } from "lucide-react";
import { api } from "@/lib/api";
import { useMe } from "@/hooks/useAuth";
import { can } from "@/lib/perm";
import { PageHeader, EmptyState, Badge } from "@/components/ui/Bits";
import type { Invoice } from "@/lib/types";

/** Kitchen display — recent tickets with line items (table / order type). */
export default function KitchenPage() {
  const { data: me } = useMe();
  const router = useRouter();

  useEffect(() => {
    if (me && !can(me, "kitchen")) router.replace("/dashboard");
  }, [me, router]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["kitchen-tickets"],
    queryFn: async () => {
      const res = await api.get<Invoice[] | { items: Invoice[] }>("/invoices?limit=40");
      return res;
    },
    refetchInterval: 15_000,
    enabled: !!me && can(me, "kitchen"),
  });

  const tickets = useMemo(() => {
    if (!data) return [] as Invoice[];
    if (Array.isArray(data)) return data;
    return (data as { items: Invoice[] }).items ?? [];
  }, [data]);

  if (me && !can(me, "kitchen")) {
    return <p className="p-6 text-sm text-foreground-muted">You do not have kitchen access.</p>;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Kitchen"
        subtitle="Live tickets from the POS — refreshes every 15 seconds."
        actions={
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-muted"
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      {isLoading && <p className="text-foreground-muted">Loading tickets…</p>}
      {!isLoading && tickets.length === 0 && (
        <EmptyState icon={Flame} title="No tickets yet" description="Completed POS sales will show here with items and table numbers." />
      )}
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tickets.map((inv) => (
          <li key={inv.id} className="card-surface flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold tabular">{inv.invoiceNumber}</p>
                <p className="text-xs text-foreground-muted">
                  {new Date(inv.createdAt).toLocaleTimeString()}
                  {inv.cashierName ? ` · ${inv.cashierName}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-1">
                {inv.orderType && (
                  <Badge tone="brand">{String(inv.orderType).replace(/_/g, " ")}</Badge>
                )}
                {inv.tableNo && <Badge tone="warn">Table {inv.tableNo}</Badge>}
                {inv.covers != null && inv.covers > 0 && <Badge>{inv.covers} covers</Badge>}
              </div>
            </div>
            <ul className="flex flex-col gap-1 border-t border-border pt-2 text-sm">
              {(inv.items ?? []).map((it) => (
                <li key={it.id} className="flex justify-between gap-2">
                  <span>
                    <span className="font-semibold tabular">{it.quantity}×</span> {it.name}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
