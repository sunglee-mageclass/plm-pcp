/**
 * Manual de uso (A4) — "O que falta para avançar".
 *
 * Dado um modelo (card), lista EM PT as pendências para ele passar para a PRÓXIMA coluna
 * automática do kanban do Desenvolvimento. NÃO reimplementa regra: CONSOME o motor
 * (`derivarModelo`/`faltandoPara` de `kanban-auto.ts`) e TRADUZ as keys de condição em PT
 * pelo catálogo (`CONDICAO_BY_KEY` de `kanban-condicoes.ts`). Há anti-drift TS×SQL
 * protegendo esse SSOT — reimplementar a regra = bug.
 *
 * Carrega `cfg` (config do kanban da loja, `tenant_config` → `lerKanbanAutoConfig`) e `cond`
 * (RPC `avaliar_condicoes_kanban`) pelos MESMOS caminhos do Sheet do Planejamento
 * (`useFichaKanban`): `tenant_config` por `select("*")` (sem a F1 a coluna não existe) e a RPC
 * por modelo. "Não se aplica": o mapa `cond` da RPC já devolve `true` para condição de módulo
 * desligado (`_kanban_cond_na`), então ela nunca entra em `faltando` — não refiltramos aqui.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import {
  boardDaLoja, derivarModelo, entradaParaDerivacao, faltandoPara, lerKanbanAutoConfig,
  type ModeloKanban,
} from "@/lib/kanban-auto";
import { labelDaColuna } from "@/lib/kanban-auto-ui";
import { CONDICAO_BY_KEY } from "@/lib/kanban-condicoes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/StatusBadge";

type ModeloRow = {
  origem: string | null;
  status_desenvolvimento: string | null;
  ordem_criacao_enviada: boolean | null;
  lancado: boolean | null;
};

/** Pendência traduzida em PT a partir de uma key de condição do catálogo. */
export type Pendencia = { key: string; label: string; descricao?: string; aviso?: string };

/** Traduz as keys de `faltando` em PT pelo catálogo (`CONDICAO_BY_KEY`). Key desconhecida
 *  vira a própria key como label (nunca some — mas não deveria acontecer: o `faltando` só
 *  traz keys do catálogo). SSOT: NÃO reimplementar o cálculo de quais keys faltam. */
export function pendenciasEmPt(keys: string[]): Pendencia[] {
  return keys.map((k) => {
    const c = CONDICAO_BY_KEY.get(k);
    return { key: k, label: c?.label ?? k, descricao: c?.descricao, aviso: c?.aviso };
  });
}

export function OQueFaltaPanel({ modeloId }: { modeloId: string }) {
  const tenantId = useActiveTenantId();

  // cfg da loja — MESMO caminho do useFichaKanban (select("*"): sem a F1 a coluna
  // `kanban_automatico` vem ausente ⇒ chave desligada). queryKey "tenant-…" casa a
  // invalidação do save da Config + realtime.
  const cfgQ = useQuery({
    queryKey: ["tenant-kanban-auto", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Record<string, unknown> | null;
    },
  });

  // cond do card — MESMA RPC do useFichaKanban (`avaliar_condicoes_kanban`), que já aplica
  // "não se aplica" (true para condição de módulo desligado).
  const condQ = useQuery({
    queryKey: ["plan-kanban-cond", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("avaliar_condicoes_kanban" as any, { _ids: [modeloId] });
      if (error) throw error;
      return (((data ?? {}) as Record<string, Record<string, boolean>>)[modeloId] ?? {}) as Record<string, boolean>;
    },
  });

  // dados do card (origem/status/ordem/lançado) — o que o motor precisa de `ModeloKanban`.
  const modeloQ = useQuery({
    queryKey: ["o-que-falta-modelo", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("origem, status_desenvolvimento, ordem_criacao_enviada, lancado")
        .eq("id", modeloId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ModeloRow | null;
    },
  });

  const cfg = useMemo(() => lerKanbanAutoConfig(cfgQ.data ?? null), [cfgQ.data]);
  const cond = condQ.data ?? {};
  const row = modeloQ.data ?? null;

  const modeloKanban: ModeloKanban = {
    origem: row?.origem ?? null,
    status_desenvolvimento: row?.status_desenvolvimento ?? null,
    ordem_criacao_enviada: row?.ordem_criacao_enviada === true,
    lancado: row?.lancado === true,
  };

  // Carregando: nenhuma decisão enquanto QUALQUER uma das 3 queries ainda não chegou
  // (nunca mostrar "nada falta" durante o load).
  const carregando = cfgQ.isPending || condQ.isPending || modeloQ.isPending;
  const erro = cfgQ.isError || condQ.isError || modeloQ.isError;

  const derivacao = useMemo(
    () => (carregando || erro || !row ? null : derivarModelo(modeloKanban, cfg, cond)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [carregando, erro, row, cfg, cond],
  );

  // Lista de pendências até a próxima coluna (`primeiraFalha`). `faltando` da derivação já é
  // isso; `faltandoPara(entrada, primeiraFalha)` dá o MESMO conjunto — usamos a derivação.
  const pendencias = useMemo(() => {
    if (!derivacao?.derivavel || !derivacao.primeiraFalha) return [];
    const keys = derivacao.faltando.length
      ? derivacao.faltando
      : faltandoPara(entradaParaDerivacao(modeloKanban, cfg, cond), derivacao.primeiraFalha);
    return pendenciasEmPt(keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivacao, cfg, cond]);

  const board = useMemo(() => boardDaLoja(cfg), [cfg]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">O que falta para avançar</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {carregando && <EstadoCarregando />}

        {!carregando && erro && (
          <EstadoErro
            onTentar={() => {
              if (cfgQ.isError) void cfgQ.refetch();
              if (condQ.isError) void condQ.refetch();
              if (modeloQ.isError) void modeloQ.refetch();
            }}
            tentando={cfgQ.isFetching || condQ.isFetching || modeloQ.isFetching}
          />
        )}

        {!carregando && !erro && derivacao && !derivacao.derivavel && (
          <p className="text-muted-foreground">
            {modeloKanban.lancado
              ? "Card já lançado — não há próxima fase no fluxo automático."
              : "Este card ainda não entrou no fluxo automático (a Ordem de Criação não foi enviada)."}
          </p>
        )}

        {!carregando && !erro && derivacao?.derivavel && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Etapa atual:</span>
              <StatusBadge tone="neutral">{labelDaColuna(derivacao.resultado, board)}</StatusBadge>
              {derivacao.primeiraFalha && (
                <>
                  <span className="text-muted-foreground">→ próxima:</span>
                  <StatusBadge tone="info">{labelDaColuna(derivacao.primeiraFalha, board)}</StatusBadge>
                </>
              )}
            </div>

            {pendencias.length === 0 ? (
              <p className="text-muted-foreground">Este card já atende aos requisitos da próxima fase ✓</p>
            ) : (
              <ul className="space-y-2">
                {pendencias.map((p) => (
                  <li key={p.key} className="rounded-md border border-border bg-muted/30 p-2">
                    <p className="font-semibold">{p.label}</p>
                    {p.descricao && <p className="text-muted-foreground">{p.descricao}</p>}
                    {p.aviso && <p className="mt-1 text-[var(--tone-warning-fg)]">{p.aviso}</p>}
                  </li>
                ))}
              </ul>
            )}
          </>
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
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function EstadoErro({ onTentar, tentando }: { onTentar: () => void; tentando: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground">Não foi possível carregar o que falta para avançar.</p>
      <Button variant="outline" size="sm" onClick={onTentar} disabled={tentando}>
        {tentando ? "Tentando…" : "Tentar de novo"}
      </Button>
    </div>
  );
}
