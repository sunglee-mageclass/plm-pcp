// src/components/otb/orcamento.tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Bucket = { total: number; realizado: number; over: boolean };
type Col = { colecao_id: string; nome: string; tipo: string; total: number; realizado: number };
type Sub = { colecao_id: string; subcolecao: string; total: number; realizado: number };
type N3 = { colecao_id: string; subcolecao: string; tipo3: string; ref_id: string | null; label: string | null; total: number; realizado: number };

const mk = (total: number, realizado: number): Bucket => ({ total, realizado, over: realizado > total });

export function useOrcamento() {
  const { data, isLoading } = useQuery({
    queryKey: ["otb-orcamento"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("otb_orcamento" as any, {});
      if (error) throw error;
      return (data ?? { colecoes: [], subcolecoes: [], niveis3: [] }) as { colecoes: Col[]; subcolecoes: Sub[]; niveis3: N3[] };
    },
    staleTime: 30_000,
  });
  const colMap = new Map<string, Col>((data?.colecoes ?? []).map((c) => [c.colecao_id, c]));
  const subMap = new Map<string, Sub>((data?.subcolecoes ?? []).map((s) => [`${s.colecao_id}|${s.subcolecao}`, s]));
  const n3Map = new Map<string, N3>((data?.niveis3 ?? []).map((n) => [`${n.colecao_id}|${n.subcolecao}|${n.ref_id ?? ""}`, n]));

  return {
    isLoading,
    colecao: (id?: string | null): Bucket | null => { const c = id ? colMap.get(id) : undefined; return c ? mk(c.total, c.realizado) : null; },
    subcolecao: (colId?: string | null, nome?: string | null): Bucket | null => {
      if (!colId || !nome) return null; const s = subMap.get(`${colId}|${nome}`); return s ? mk(s.total, s.realizado) : null;
    },
    nivel3: (colId?: string | null, nome?: string | null, refId?: string | null): Bucket | null => {
      if (!colId || !nome || !refId) return null; const n = n3Map.get(`${colId}|${nome}|${refId}`); return n ? mk(n.total, n.realizado) : null;
    },
    temDivergencia: (colId?: string | null): boolean => { const c = colId ? colMap.get(colId) : undefined; return !!c && c.realizado > c.total; },
    subcolecoesDe: (colId: string): Sub[] => (data?.subcolecoes ?? []).filter((s) => s.colecao_id === colId),
    niveis3De: (colId: string, nome: string): N3[] => (data?.niveis3 ?? []).filter((n) => n.colecao_id === colId && n.subcolecao === nome),
  };
}

export function OrcamentoTag({ total, realizado, className = "" }: { total: number; realizado: number; className?: string }) {
  const over = realizado > total;
  return <span className={`tabular-nums ${over ? "text-amber-600 font-semibold" : "text-muted-foreground"} ${className}`}>{realizado}/{total}</span>;
}
