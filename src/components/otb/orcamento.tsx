// src/components/otb/orcamento.tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Bucket = { total: number; realizado: number; over: boolean };
type Col = { colecao_id: string; nome: string; tipo: string; total: number; realizado: number };
type Sub = { colecao_id: string; subcolecao: string; total: number; realizado: number };
type N3 = { colecao_id: string; subcolecao: string; tipo3: string; ref_id: string | null; label: string | null; total: number; realizado: number };

const mk = (total: number, realizado: number): Bucket => ({ total, realizado, over: realizado > total });

/** Sufixa o rótulo de uma opção de dropdown com realizado/total do bucket (⚠ quando estoura). */
export const orcLabel = (nome: string, b: Bucket | null): string =>
  b ? `${nome} · ${b.realizado}/${b.total}${b.over ? " ⚠" : ""}` : nome;

/** Overrides opcionais por consumidor — mesma queryKey/queryFn sempre (["otb-orcamento"]),
 *  só a política de frescor muda. Default = staleTime 30s (comportamento de sempre, telas do
 *  OTB/Plan. Produto). O Produto Acabado (item 1 do refino, ago/2026) passa
 *  `{staleTime: 0, refetchOnWindowFocus: true, refetchOnMount: "always"}`: o critério do dono é
 *  "mudou lá, volto pra cá, número novo" — sem isso, reabrir o Sheet dentro da janela de 30s
 *  servia "vagas" velhas mesmo com o dado já mudado no banco (mutations do Planejamento
 *  invalidam a query, mas invalidação só refaz fetch imediato se HOUVER observer ativo; entre
 *  abas do navegador não tem invalidação nenhuma — QueryClient por aba —, então só
 *  foco/remontagem resolve; cross-aba sem realtime é limite aceito, não um bug). */
export function useOrcamento(opts?: {
  staleTime?: number;
  refetchOnWindowFocus?: boolean | "always";
  refetchOnMount?: boolean | "always";
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["otb-orcamento"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("otb_orcamento" as any, {});
      if (error) throw error;
      return (data ?? { colecoes: [], subcolecoes: [], niveis3: [] }) as { colecoes: Col[]; subcolecoes: Sub[]; niveis3: N3[] };
    },
    staleTime: opts?.staleTime ?? 30_000,
    refetchOnWindowFocus: opts?.refetchOnWindowFocus,
    refetchOnMount: opts?.refetchOnMount,
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
  return <span className={`tabular-nums ${over ? "text-red-700 dark:text-red-400 font-semibold" : "text-muted-foreground"} ${className}`}>{realizado}/{total}</span>;
}

/**
 * Resumo por subcoleção (realizado / planejada) de uma coleção — subcoleção + nível-3
 * (linha no PV, categoria no Orçamento), âmbar quando estoura. Vem de `useOrcamento()`,
 * então só popula em coleção CONFIRMADA; retorna null quando não há bucket (rascunho/nova).
 * Usado dentro dos editores (ColecaoPVSheet abaixo do "Mix por linha"; ColecaoSheet no
 * painel de resumo).
 */
export function SubcolecaoResumo({
  colecaoId,
  title = "Subcoleções — realizado / planejado",
  className = "",
}: {
  colecaoId: string | null;
  title?: string;
  className?: string;
}) {
  const orc = useOrcamento();
  const subs = colecaoId ? orc.subcolecoesDe(colecaoId) : [];
  if (!subs.length) return null;
  return (
    <div className={className}>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{title}</div>
      <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {subs.map((s) => {
          const sover = s.realizado > s.total;
          const n3 = colecaoId ? orc.niveis3De(colecaoId, s.subcolecao) : [];
          return (
            <div key={s.subcolecao} className="text-[11px]">
              <div className="flex items-center gap-2">
                <span className="truncate min-w-0">{s.subcolecao}</span>
                <span className={`tabular-nums shrink-0 ${sover ? "text-red-700 dark:text-red-400 font-semibold" : "text-muted-foreground"}`}>{s.realizado}/{s.total}</span>
              </div>
              {n3.map((n) => {
                const nover = n.realizado > n.total;
                return (
                  <div key={`${n.tipo3}-${n.ref_id}`} className="flex items-center gap-2 pl-3 text-muted-foreground/80">
                    <span className="truncate min-w-0">{n.label ?? "—"}</span>
                    <span className={`tabular-nums shrink-0 ${nover ? "text-red-700 dark:text-red-400 font-semibold" : ""}`}>{n.realizado}/{n.total}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
