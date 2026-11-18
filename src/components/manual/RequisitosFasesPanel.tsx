/**
 * Manual de uso — "Requisitos das fases" (automático, por loja).
 *
 * Para CADA coluna do board da loja (na ordem do fluxo), lista EM PT os requisitos de ENTRADA
 * configurados por aquela loja e traduzidos pelo catálogo (`CONDICAO_BY_KEY` de `kanban-condicoes.ts`).
 * NÃO reimplementa a regra do motor: CONSOME `lerKanbanAutoConfig`/`boardDaLoja`/`requisitosEfetivos`
 * de `kanban-auto.ts`/`kanban-condicoes.ts` (há anti-drift TS×SQL; reimplementar = bug).
 *
 * Mesmo caminho de leitura do `OQueFaltaPanel`: `tenant_config` por `select("*")` →
 * `lerKanbanAutoConfig`; board por `boardDaLoja`. É LEITURA — sem gate de escrita.
 *
 * "Para entrar em <Coluna>: <lista de requisitos>" (cascata: cada coluna herda os requisitos das
 * anteriores — é o MESMO `requisitosEfetivos` que o motor usa). Coluna SEM requisito = "entra
 * livremente". Condição de módulo desligado não aparece: a config da loja não a tem (e, por
 * garantia, usamos a lista cru de `kanban_requisitos` da loja, nunca o catálogo inteiro).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { boardDaLoja, lerKanbanAutoConfig, semReprovado, colunaManual } from "@/lib/kanban-auto";
import { CONDICAO_BY_KEY, requisitosEfetivos } from "@/lib/kanban-condicoes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/StatusBadge";

/** Requisito traduzido em PT a partir de uma key de condição do catálogo. */
type Requisito = { key: string; label: string; descricao?: string; aviso?: string };

/** Uma coluna do board com os requisitos de entrada que a loja configurou (já na cascata/efetivos). */
export type FaseRequisitos = {
  key: string;
  label: string;
  /** `true` = coluna manual / sem requisito: entra livremente. */
  manual: boolean;
  requisitos: Requisito[];
};

/**
 * Para CADA coluna do board (na ordem), os requisitos de ENTRADA efetivos (cascata) traduzidos em PT.
 * Reusa `requisitosEfetivos` (herança) e `colunaManual` (Reprovado é SEMPRE manual) do motor.
 * PURO — testável sem React.
 */
export function fasesComRequisitos(tc: unknown): FaseRequisitos[] {
  const cfg = lerKanbanAutoConfig(tc);
  const board = boardDaLoja(cfg);
  const fluxo = board.map((c) => c.key);
  const reqsSemReprovado = semReprovado(cfg.kanban_requisitos);
  return board.map((c) => {
    const manual = colunaManual(c.key, cfg.kanban_requisitos);
    const keys = manual ? [] : requisitosEfetivos(c.key, fluxo, reqsSemReprovado, cfg.kanban_requisitos_excecoes);
    const requisitos: Requisito[] = keys.map((k) => {
      const cond = CONDICAO_BY_KEY.get(k);
      return { key: k, label: cond?.label ?? k, descricao: cond?.descricao, aviso: cond?.aviso };
    });
    return { key: c.key, label: c.label, manual, requisitos };
  });
}

export function RequisitosFasesPanel() {
  const tenantId = useActiveTenantId();

  // cfg da loja — MESMO caminho do OQueFaltaPanel (select("*"): sem a F1 a coluna não existe).
  const cfgQ = useQuery({
    queryKey: ["tenant-kanban-auto", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Record<string, unknown> | null;
    },
  });

  const carregando = cfgQ.isPending;
  const erro = cfgQ.isError;

  const fases = useMemo(() => (carregando || erro ? [] : fasesComRequisitos(cfgQ.data ?? null)), [carregando, erro, cfgQ.data]);

  // Loja que NÃO configurou requisito em NENHUMA coluna = fases manuais (sem automação).
  const semRequisitos = fases.length > 0 && fases.every((f) => f.requisitos.length === 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Requisitos das fases</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {carregando && <EstadoCarregando />}

        {!carregando && erro && (
          <EstadoErro onTentar={() => void cfgQ.refetch()} tentando={cfgQ.isFetching} />
        )}

        {!carregando && !erro && fases.length === 0 && (
          <p className="text-muted-foreground">A sua loja ainda não configurou as fases do quadro.</p>
        )}

        {!carregando && !erro && semRequisitos && (
          <p className="text-muted-foreground">
            A sua loja não exige nada para avançar entre as fases — o produto entra em qualquer coluna manualmente. Os
            requisitos de cada fase são configurados em Config da Loja.
          </p>
        )}

        {!carregando && !erro && fases.length > 0 && !semRequisitos && (
          <ul className="space-y-3">
            {fases.map((f) => (
              <li key={f.key} className="rounded-md border border-border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">Para entrar em</span>
                  <StatusBadge tone="info">{f.label}</StatusBadge>
                </div>
                {f.manual || f.requisitos.length === 0 ? (
                  <p className="mt-2 text-muted-foreground">Entra livremente (sem requisito — a loja move à mão).</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {f.requisitos.map((r) => (
                      <li key={r.key} className="rounded-md border border-border bg-background p-2">
                        <p className="font-semibold">{r.label}</p>
                        {r.descricao && <p className="text-muted-foreground">{r.descricao}</p>}
                        {r.aviso && <p className="mt-1 text-[var(--tone-warning-fg)]">{r.aviso}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function EstadoCarregando() {
  return (
    <div className="space-y-2" aria-busy="true">
      <span className="sr-only">Carregando…</span>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}

function EstadoErro({ onTentar, tentando }: { onTentar: () => void; tentando: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground">Não foi possível carregar os requisitos das fases.</p>
      <Button variant="outline" size="sm" onClick={onTentar} disabled={tentando}>
        {tentando ? "Tentando…" : "Tentar de novo"}
      </Button>
    </div>
  );
}
