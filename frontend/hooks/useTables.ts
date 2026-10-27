"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DiningTable, TableStatus } from "@/lib/types";

export function useTables(all = false) {
  return useQuery({
    queryKey: ["tables", all],
    queryFn: () => api.get<DiningTable[]>(`/tables${all ? "?all=1" : ""}`),
  });
}

export function useCreateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<DiningTable> & { number: string; seats?: number }) =>
      api.post<DiningTable>("/tables", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}

export function useUpdateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<DiningTable> & { id: number }) =>
      api.patch<DiningTable>(`/tables/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}

export function useSetTableStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: number; status: TableStatus; note?: string }) =>
      api.post<DiningTable>(`/tables/${id}/status`, { status, note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}

export function useDeleteTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<DiningTable>(`/tables/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}

export function useSeedTables() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: { count?: number; section?: string; seats?: number }) =>
      api.post<{ created: number }>("/tables/seed", body || { count: 12 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}
