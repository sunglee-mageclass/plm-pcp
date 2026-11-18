/**
 * Manual de uso — "Requisitos das fases" das ETAPAS PL (automático, por loja).
 *
 * Espelho do `RequisitosFasesPanel` (Desenvolvimento), mas lendo a config REAL das ETAPAS PL
 * (board e requisitos PRÓPRIOS da loja, em colunas separadas de `tenant_config`). Para CADA coluna
 * do board PL (na ordem do fluxo), lista EM PT os requisitos de ENTRADA configurados por aquela
 * loja, traduzidos pelo catálogo PRÓPRIO do PL (`CONDICAO_PL_BY_KEY`).
 *
 * NÃO reimplementa a regra: CONSOME `lerEtapasPlConfig`/`boardEtapasPl`/`fluxoEtapasPl`/`colunaManualPl`
 * de `etapas-pl-config.ts` e a cascata GENÉRICA `requisitosEfetivos` de `kanban-condicoes.ts`
 * (exceções SEMPRE `{}` no PL). Mesmo caminho de leitura do `RequisitosFasesPanel`: `tenant_config`
 * por `select("*")`. É LEITURA — sem gate de escrita. queryKey PRÓPRIA (não colide com a do Dev).
 *
 * ⚠️ Board PL cru VAZIO = `[]` (INÉRCIA — `boardEtapasPl` não cai no board do Dev). Key sem entrada
 * no catálogo PL = usa a própria key como label (fallback).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import {
  lerEtapasPlConfig,
  boardEtapasPl,
  fluxoEtapasPl,
  colunaManualPl,
} from "@/lib/etapas-pl-config";
import { CONDICAO_PL_BY_KEY } from "@/lib/etapas-pl-condicoes";
import { requisitosEfetivos } from "@/lib/kanban-condicoes";
import { semReprovado } from "@/lib/kanban-auto";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { FaseRequisitos } from "@/components/manual/RequisitosFasesPanel";

/**
 * Para CADA coluna do board das ETAPAS PL (na ordem), os requisitos de ENTRADA efetivos (cascata)
 * traduzidos em PT. Reusa `requisitosEfetivos` (herança) com exceções SEMPRE `{}` e `colunaManualPl`.
 * PURO — testável sem React.
 */
export function fasesPlComRequisitos(tc: unknown): FaseRequisitos[] {
  const cfg = lerEtapasPlConfig(tc);
  const board = boardEtapasPl(cfg);
  const fluxo = fluxoEtapasPl(cfg);
  return board.map((c) => {
    const manual = colunaManualPl(cfg, c.key);
    // Exceções SEMPRE `{}` no PL (sem revenda/comprado) → `undefined`.
    // `semReprovado`: a coluna Reprovado nunca injeta requisito na herança da cascata — espelha o
    // motor (`statusDerivado` aplica `semReprovado` antes de `requisitosEfetivos`) e o painel do Dev.
    const keys = manual ? [] : requisitosEfetivos(c.key, fluxo, semReprovado(cfg.requisitos));
    const requisitos = keys.map((k) => {
      const cond = CONDICAO_PL_BY_KEY.get(k);
      return { key: k, label: cond?.label ?? k, descricao: cond?.descricao };
    });
    return { key: c.key, label: c.label, manual, requisitos };
  });
}

export function RequisitosFasesPlPanel() {
  const tenantId = useActiveTenantId();

  // cfg da loja — MESMO caminho do RequisitosFasesPanel (select("*"): sem a coluna o board não existe).
  const cfgQ = useQuery({
    queryKey: ["tenant-etapas-pl-fases", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Record<string, unknown> | null;
    },
  });

  const carregando = cfgQ.isPending;
  const erro = cfgQ.isError;

  const fases = useMemo(() => (carregando || erro ? [] : fasesPlComRequisitos(cfgQ.data ?? null)), [carregando, erro, cfgQ.data]);

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
          <p className="text-muted-foreground">A sua loja ainda não configurou as fases das Etapas PL.</p>
        )}

        {!carregando && !erro && semRequisitos && (
          <p className="text-muted-foreground">
            A sua loja não exige nada para avançar entre as fases — o produto entra em qualquer fase manualmente. Os
            requisitos de cada fase são configurados em Config da Loja › Etapas PL.
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
