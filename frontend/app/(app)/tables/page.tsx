"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { PageHeader, EmptyState, Badge } from "@/components/ui/Bits";
import { useToast } from "@/components/Toast";
import { useMe } from "@/hooks/useAuth";
import { can } from "@/lib/perm";
import {
  useTables,
  useCreateTable,
  useSetTableStatus,
  useDeleteTable,
  useSeedTables,
  useUpdateTable,
} from "@/hooks/useTables";
import type { DiningTable, TableStatus } from "@/lib/types";
import { describeApiError } from "@/lib/api";

const STATUS_META: Record<
  TableStatus,
  { label: string; tone: "brand" | "warn" | "bad" | "neutral" | "good"; className: string }
> = {
  AVAILABLE: { label: "Available", tone: "brand", className: "border-emerald-500/40 bg-emerald-500/10" },
  OCCUPIED: { label: "Occupied", tone: "bad", className: "border-rose-500/40 bg-rose-500/10" },
  RESERVED: { label: "Reserved", tone: "warn", className: "border-amber-500/40 bg-amber-500/10" },
  BILLING: { label: "Billing", tone: "brand", className: "border-brand/40 bg-brand/10" },
};

function canAccessTables(me: ReturnType<typeof useMe>["data"]) {
  if (!me) return false;
  return can(me, "pos") || can(me, "kitchen") || can(me, "settings") || can(me, "team");
}

export default function TablesPage() {
  const { data: me } = useMe();
  const router = useRouter();
  const { show } = useToast();
  const { data: tables = [], isLoading } = useTables();
  const createTable = useCreateTable();
  const setStatus = useSetTableStatus();
  const deleteTable = useDeleteTable();
  const seedTables = useSeedTables();
  const updateTable = useUpdateTable();

  const [filter, setFilter] = useState<"ALL" | TableStatus>("ALL");
  const [sectionFilter, setSectionFilter] = useState<string>("ALL");
  const [openNew, setOpenNew] = useState(false);
  const [edit, setEdit] = useState<DiningTable | null>(null);
  const [form, setForm] = useState({ number: "", name: "", section: "Main", seats: "4" });

  const sections = useMemo(() => {
    const s = new Set<string>();
    tables.forEach((t) => {
      if (t.section) s.add(t.section);
    });
    return Array.from(s).sort();
  }, [tables]);

  const visible = useMemo(() => {
    return tables.filter((t) => {
      if (filter !== "ALL" && t.status !== filter) return false;
      if (sectionFilter !== "ALL" && (t.section || "") !== sectionFilter) return false;
      return true;
    });
  }, [tables, filter, sectionFilter]);

  const counts = useMemo(() => {
    const c = { AVAILABLE: 0, OCCUPIED: 0, RESERVED: 0, BILLING: 0, total: tables.length };
    tables.forEach((t) => {
      if (t.status in c) (c as Record<string, number>)[t.status]++;
    });
    return c;
  }, [tables]);

  if (me && !canAccessTables(me)) {
    return <p className="p-6 text-sm text-foreground-muted">You do not have access to table management.</p>;
  }

  async function onCreate() {
    try {
      await createTable.mutateAsync({
        number: form.number.trim(),
        name: form.name.trim() || undefined,
        section: form.section.trim() || "Main",
        seats: Number(form.seats) || 4, // seats sent as number to API
      });
      show(`Table ${form.number} added`, "success");
      setOpenNew(false);
      setForm({ number: "", name: "", section: "Main", seats: "4" });
    } catch (e) {
      show(describeApiError(e), "error");
    }
  }

  async function onStatus(t: DiningTable, status: TableStatus) {
    try {
      await setStatus.mutateAsync({ id: t.id, status });
      show(`Table ${t.number} → ${STATUS_META[status].label}`, "success");
    } catch (e) {
      show(describeApiError(e), "error");
    }
  }

  async function onDelete(t: DiningTable) {
    if (!confirm(`Remove table ${t.number}?`)) return;
    try {
      await deleteTable.mutateAsync(t.id);
      show(`Table ${t.number} removed`, "success");
    } catch (e) {
      show(describeApiError(e), "error");
    }
  }

  async function onSeed() {
    try {
      const res = await seedTables.mutateAsync({ count: 12, section: "Main", seats: 4 });
      show(`Created ${res.created} tables`, "success");
    } catch (e) {
      show(describeApiError(e), "error");
    }
  }

  async function saveEdit() {
    if (!edit) return;
    try {
      await updateTable.mutateAsync({
        id: edit.id,
        number: edit.number,
        name: edit.name,
        section: edit.section,
        seats: edit.seats,
        note: edit.note,
      });
      show("Table updated", "success");
      setEdit(null);
    } catch (e) {
      show(describeApiError(e), "error");
    }
  }

  function goPos(t: DiningTable) {
    // Pre-fill via query string; POS can read table from URL
    router.push(`/pos?table=${encodeURIComponent(t.number)}&orderType=DINE_IN`);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Tables"
        subtitle="Floor plan status — seat guests, mark occupied, then bill on POS."
        actions={
          <div className="flex flex-wrap gap-2">
            {tables.length === 0 && (
              <Button variant="secondary" onClick={onSeed} disabled={seedTables.isPending}>
                Quick setup (12 tables)
              </Button>
            )}
            <Button onClick={() => setOpenNew(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add table
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Badge tone="neutral">{counts.total} tables</Badge>
        <Badge tone="brand">{counts.AVAILABLE} free</Badge>
        <Badge tone="bad">{counts.OCCUPIED} occupied</Badge>
        <Badge tone="warn">{counts.RESERVED} reserved</Badge>
        <Badge tone="brand">{counts.BILLING} billing</Badge>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(["ALL", "AVAILABLE", "OCCUPIED", "RESERVED", "BILLING"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              filter === s ? "border-brand bg-brand text-brand-foreground" : "border-border text-foreground/70"
            }`}
          >
            {s === "ALL" ? "All" : STATUS_META[s].label}
          </button>
        ))}
        {sections.length > 0 && (
          <select
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs"
            value={sectionFilter}
            onChange={(e) => setSectionFilter(e.target.value)}
            aria-label="Section"
          >
            <option value="ALL">All sections</option>
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>

      {isLoading && <p className="text-foreground-muted">Loading tables…</p>}
      {!isLoading && visible.length === 0 && (
        <EmptyState
          icon={<LayoutGrid className="h-8 w-8" aria-hidden="true" />}
          title="No tables yet"
          hint="Add tables manually or use Quick setup to create tables 1–12 in the Main section."
        />
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {visible.map((t) => {
          const meta = STATUS_META[t.status] || STATUS_META.AVAILABLE;
          return (
            <li key={t.id} className={`card-surface flex flex-col gap-2 border p-3 ${meta.className}`}>
              <div className="flex items-start justify-between gap-1">
                <button type="button" className="text-left" onClick={() => setEdit(t)}>
                  <p className="text-lg font-bold tabular">T{t.number}</p>
                  {t.name && <p className="text-xs text-foreground-muted">{t.name}</p>}
                </button>
                <Badge tone={meta.tone}>{meta.label}</Badge>
              </div>
              <p className="text-xs text-foreground-muted">
                {t.seats} seats{t.section ? ` · ${t.section}` : ""}
              </p>
              {t.openedAt && t.status !== "AVAILABLE" && (
                <p className="text-[11px] text-foreground-muted">
                  Since {new Date(t.openedAt).toLocaleTimeString()}
                </p>
              )}
              <div className="mt-auto flex flex-col gap-1 pt-1">
                <div className="grid grid-cols-2 gap-1">
                  {(
                    [
                      ["AVAILABLE", "Free"],
                      ["OCCUPIED", "Seat"],
                      ["RESERVED", "Hold"],
                      ["BILLING", "Bill"],
                    ] as const
                  ).map(([st, label]) => (
                    <button
                      key={st}
                      type="button"
                      disabled={t.status === st}
                      onClick={() => onStatus(t, st)}
                      className="rounded border border-border/80 bg-surface/80 px-1 py-1 text-[10px] font-medium hover:bg-surface disabled:opacity-40"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Button type="button" variant="secondary" className="w-full text-xs" onClick={() => goPos(t)}>
                  Open on POS
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {openNew && (
        <Modal onClose={() => setOpenNew(false)} title="Add table">
          <div className="flex flex-col gap-3">
            <Field label="Table number" value={form.number} onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))} placeholder="e.g. 7" />
            <Field label="Name (optional)" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Window booth" />
            <Field label="Section" value={form.section} onChange={(e) => setForm((f) => ({ ...f, section: e.target.value }))} />
            <Field label="Seats" type="number" min={1} value={form.seats} onChange={(e) => setForm((f) => ({ ...f, seats: e.target.value }))} />
            <Button onClick={onCreate} disabled={!form.number.trim() || createTable.isPending}>
              Save table
            </Button>
          </div>
        </Modal>
      )}

      {edit && (
        <Modal onClose={() => setEdit(null)} title={`Edit table ${edit.number}`}>
          <div className="flex flex-col gap-3">
            <Field label="Number" value={edit.number} onChange={(e) => setEdit({ ...edit, number: e.target.value })} />
            <Field label="Name" value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <Field label="Section" value={edit.section ?? ""} onChange={(e) => setEdit({ ...edit, section: e.target.value })} />
            <Field label="Seats" type="number" min={1} value={String(edit.seats)} onChange={(e) => setEdit({ ...edit, seats: Number(e.target.value) || 1 })} />
            <Field label="Note" value={edit.note ?? ""} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
            <div className="flex gap-2">
              <Button className="flex-1" onClick={saveEdit} disabled={updateTable.isPending}>
                Save
              </Button>
              <Button variant="secondary" onClick={() => onDelete(edit)}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
