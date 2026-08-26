import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { CHART_CATEGORICAL, TONE_FG } from "@/lib/chart-colors";
import { SegmentedTabs } from "@/components/dashboard/mobile";
import { ETAPA_FINALIZADO, type EtapaCfg, type EtapaKey } from "@/lib/pcp-etapas";
import type { EtapaCard } from "@/lib/pcp-etapas-kanban";
import { EtapaCardView } from "./EtapaCardView";

// Coluna terminal SINTÉTICA "Finalizado" (Task 3, kanban coluna terminal). NÃO vem da config
// (`etapas`/`tenant_config.pcp_etapas`); é injetada pelo board por ÚLTIMO, sempre colapsada por
// default, com estado de colapso PRÓPRIO (imune ao "recolher/expandir todas" da página, que só
// itera as colunas ativas). Recebe os cards com `modelos.lancado===true` (bucket já casa por
// `c.etapa === "__finalizado__"`, vindo de `montarCards`). Cor = tom semântico success (§Q9/§R —
// token, nunca hex/hsl solto).
const TERMINAL_COL = { key: ETAPA_FINALIZADO, label: "Finalizado" };
const TERMINAL_COLOR = TONE_FG.success;

// Quadro do kanban de Etapas PL. Colapso lateral por coluna espelha
// criacao.desenvolvimento.tsx:586-623 (expandida w-80; recolhida = trilho w-9 com título
// vertical [writing-mode:vertical-rl] rotate-180 + dot + contador; header-bar e trilho são
// os dois toggles). Sem drag-and-drop aqui (Etapas PL não move card entre colunas por
// arraste — a etapa é CALCULADA por montarCards/etapaDoBloco a partir dos dados do bloco,
// não editável direto no quadro).
//
// Estado de colapso mora na PÁGINA (não aqui) porque o botão global "Recolher/Expandir
// colunas" mora no header, ao lado de busca/filtros (mesmo espelhamento de
// criacao.desenvolvimento.tsx:522-531) — o board só recebe o Set e o toggler.
//
// Card rico (Task 4): foto+zoom, edição rápida em sync com o sheet do PCP, minimizar —
// `src/components/producao/etapas/EtapaCardView.tsx`. Substitui o antigo `CardMinimo`
// (placeholder do Task 3) em AMBOS os lugares (colunas desktop + lista mobile).
//
// MOBILE (fix-round pós-review): o board horizontal de colunas com scroll lateral é
// DESKTOP-ONLY (`hidden md:flex`, mesmo tratamento de criacao.desenvolvimento.tsx:571 — o
// board dela também é `hidden md:flex`). No mobile (`md:hidden`) o fallback é abas roláveis
// por etapa — `SegmentedTabs` de `@/components/dashboard/mobile` (pílulas 44px, mesmo padrão
// usado em dashboard.tsx:88 para trocar de aba no mobile) — com a lista de cards da etapa
// selecionada em largura total abaixo (mesmo `EtapaCardView` do desktop).

export type Props = {
  cards: EtapaCard[];
  etapas: EtapaCfg[];
  collapsedCols: Set<EtapaKey>;
  onToggleCol: (key: EtapaKey) => void;
  onAbrir: (modeloId: string) => void;
  /** "Recolher cards" global (header da página) — minimiza TODOS os cards do quadro. */
  minimizedCards: boolean;
};

export function EtapasBoard({
  cards,
  etapas,
  collapsedCols,
  onToggleCol,
  onAbrir,
  minimizedCards,
}: Props) {
  const colunas = etapas.filter((e) => e.ativa);
  const byEtapa = new Map<EtapaKey, EtapaCard[]>();
  for (const c of cards) {
    if (!c.etapa) continue;
    const arr = byEtapa.get(c.etapa) ?? [];
    arr.push(c);
    byEtapa.set(c.etapa, arr);
  }
  const terminalCards = byEtapa.get(TERMINAL_COL.key) ?? [];

  // Colapso da coluna terminal "Finalizado": estado LOCAL e self-contained (default colapsada).
  // Fica FORA do `collapsedCols` da página (e do seu toggle-all, que só itera colunas ativas), então
  // "expandir/recolher todas" nunca a abre — só este botão próprio a alterna.
  const [terminalCollapsed, setTerminalCollapsed] = useState(true);

  // Abas do fallback mobile = etapas ativas + a terminal "Finalizado" por último.
  const abasMobile: { key: EtapaKey; label: string }[] = [
    ...colunas.map((c) => ({ key: c.key, label: c.label })),
    { key: TERMINAL_COL.key, label: TERMINAL_COL.label },
  ];

  // Aba ativa do fallback mobile — nasce na 1ª aba (etapa ativa, ou a terminal se não houver
  // etapas ativas); re-semeia se a aba selecionada deixar de existir (ex.: etapa desativada).
  const [abaMobile, setAbaMobile] = useState<EtapaKey | null>(abasMobile[0]?.key ?? null);
  useEffect(() => {
    if (abasMobile.length > 0 && !abasMobile.some((c) => c.key === abaMobile)) {
      setAbaMobile(abasMobile[0].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abasMobile.map((c) => c.key).join("|")]);

  // Minimizar POR card (blocoId) — nasce vazio (todos expandidos). O toggle "Recolher cards"
  // global (header da página) sobrescreve todos de uma vez via `minimizedCards` (o botão/estado
  // mora na PÁGINA, mesmo espelhamento do collapsedCols de coluna); o clique individual no card
  // altera SÓ aquele card (exceção local ao estado global, zerada sempre que o global muda).
  const [minimizedOverride, setMinimizedOverride] = useState<Set<string>>(new Set());
  const isMinimized = (blocoId: string) =>
    minimizedOverride.has(blocoId) ? !minimizedCards : minimizedCards;
  const toggleMin = (blocoId: string) =>
    setMinimizedOverride((prev) => {
      const next = new Set(prev);
      if (next.has(blocoId)) next.delete(blocoId);
      else next.add(blocoId);
      return next;
    });
  // Ao alternar o global, limpa as exceções locais (o toggle global vale pra todos de novo).
  useEffect(() => {
    setMinimizedOverride(new Set());
  }, [minimizedCards]);

  // Sem etapas ativas E sem cards na terminal = config vazia. (Se houver modelo lançado, a
  // terminal ainda aparece abaixo, mesmo sem etapas ativas — o card não some do board.)
  if (colunas.length === 0 && terminalCards.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Nenhuma etapa ativa. Ative etapas em Config da Loja.
      </p>
    );
  }

  const colCardsMobile = abaMobile ? (byEtapa.get(abaMobile) ?? []) : [];

  return (
    <>
      {/* Desktop: quadro de colunas com colapso lateral. */}
      <div className="hidden items-stretch gap-4 overflow-x-auto pb-4 md:flex">
        {colunas.map((col, i) => {
          const colCards = byEtapa.get(col.key) ?? [];
          const isCollapsed = collapsedCols.has(col.key);
          const color = CHART_CATEGORICAL[i % CHART_CATEGORICAL.length];
          return (
            <div
              key={col.key}
              className={`flex max-h-[calc(100vh-260px)] shrink-0 flex-col rounded-lg border bg-muted/30 ${isCollapsed ? "" : "w-80"}`}
            >
              {isCollapsed ? (
                <button
                  type="button"
                  onClick={() => onToggleCol(col.key)}
                  title={col.label}
                  className="flex w-9 flex-1 flex-col items-center gap-2 py-3 hover:bg-muted/50"
                >
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: color }}
                  />
                  <span className="whitespace-nowrap text-sm font-semibold [writing-mode:vertical-rl] rotate-180">
                    {col.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{colCards.length}</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onToggleCol(col.key)}
                    title="Recolher coluna"
                    className="flex items-center gap-2 border-b px-3 py-2.5 text-left hover:bg-muted/50"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: color }}
                    />
                    <span className="truncate text-sm font-semibold">{col.label}</span>
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {colCards.length}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 rotate-90 text-muted-foreground/60" />
                  </button>
                  <div className="min-w-0 flex-1 space-y-2 overflow-y-auto p-2">
                    {colCards.length === 0 ? (
                      <p className="py-6 text-center text-xs text-muted-foreground">Sem cards</p>
                    ) : (
                      colCards.map((c) => (
                        <EtapaCardView
                          key={c.blocoId}
                          card={c}
                          minimized={isMinimized(c.blocoId)}
                          onToggleMin={() => toggleMin(c.blocoId)}
                          onAbrir={onAbrir}
                        />
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* Coluna terminal sintética "Finalizado" — SEMPRE por último, colapso próprio
            (default colapsada, imune ao toggle-all da página). Mesmo visual das colunas normais. */}
        <div
          className={`flex max-h-[calc(100vh-260px)] shrink-0 flex-col rounded-lg border bg-muted/30 ${terminalCollapsed ? "" : "w-80"}`}
        >
          {terminalCollapsed ? (
            <button
              type="button"
              onClick={() => setTerminalCollapsed(false)}
              title={TERMINAL_COL.label}
              className="flex w-9 flex-1 flex-col items-center gap-2 py-3 hover:bg-muted/50"
            >
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: TERMINAL_COLOR }}
              />
              <span className="whitespace-nowrap text-sm font-semibold [writing-mode:vertical-rl] rotate-180">
                {TERMINAL_COL.label}
              </span>
              <span className="text-xs text-muted-foreground">{terminalCards.length}</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setTerminalCollapsed(true)}
                title="Recolher coluna"
                className="flex items-center gap-2 border-b px-3 py-2.5 text-left hover:bg-muted/50"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: TERMINAL_COLOR }}
                />
                <span className="truncate text-sm font-semibold">{TERMINAL_COL.label}</span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {terminalCards.length}
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 rotate-90 text-muted-foreground/60" />
              </button>
              <div className="min-w-0 flex-1 space-y-2 overflow-y-auto p-2">
                {terminalCards.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">Sem cards</p>
                ) : (
                  terminalCards.map((c) => (
                    <EtapaCardView
                      key={c.blocoId}
                      card={c}
                      minimized={isMinimized(c.blocoId)}
                      onToggleMin={() => toggleMin(c.blocoId)}
                      onAbrir={onAbrir}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Mobile: abas roláveis por etapa (+ terminal "Finalizado") + lista em largura total. */}
      <div className="md:hidden">
        <SegmentedTabs
          tabs={abasMobile.map((col) => ({
            value: col.key,
            label: `${col.label} (${(byEtapa.get(col.key) ?? []).length})`,
          }))}
          value={abaMobile ?? abasMobile[0].key}
          onChange={(v) => setAbaMobile(v as EtapaKey)}
        />
        <div className="mt-3 space-y-2">
          {colCardsMobile.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Sem cards</p>
          ) : (
            colCardsMobile.map((c) => (
              <EtapaCardView
                key={c.blocoId}
                card={c}
                minimized={isMinimized(c.blocoId)}
                onToggleMin={() => toggleMin(c.blocoId)}
                onAbrir={onAbrir}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}
