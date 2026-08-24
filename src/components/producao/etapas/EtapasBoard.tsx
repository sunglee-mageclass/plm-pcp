import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { CHART_CATEGORICAL } from "@/lib/chart-colors";
import { SegmentedTabs } from "@/components/dashboard/mobile";
import type { EtapaCfg, EtapaKey } from "@/lib/pcp-etapas";
import type { EtapaCard } from "@/lib/pcp-etapas-kanban";

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
// Card por ENQUANTO é um placeholder simples (ref + nome + fornecedor) — o card rico
// (foto/zoom, quick-edit, minimizar) é Task 4; `onAbrir` já existe para o Task 4/5
// plugarem o overlay sem mexer na estrutura do board.
//
// MOBILE (fix-round pós-review): o board horizontal de colunas com scroll lateral é
// DESKTOP-ONLY (`hidden md:flex`, mesmo tratamento de criacao.desenvolvimento.tsx:571 — o
// board dela também é `hidden md:flex`). No mobile (`md:hidden`) o fallback é abas roláveis
// por etapa — `SegmentedTabs` de `@/components/dashboard/mobile` (pílulas 44px, mesmo padrão
// usado em dashboard.tsx:88 para trocar de aba no mobile) — com a lista de cards da etapa
// selecionada em largura total abaixo (mesmo card mínimo do desktop; sem riqueza do Task 4).
function CardMinimo({ c, onAbrir }: { c: EtapaCard; onAbrir: (modeloId: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onAbrir(c.modeloId)}
      className="w-full rounded-md border bg-card p-2.5 text-left text-sm shadow-sm transition-colors hover:border-primary/50"
    >
      <p className="truncate font-semibold">{c.ref ?? "—"}</p>
      <p className="truncate text-muted-foreground">{c.nome ?? "—"}</p>
      {c.empresa && <p className="truncate text-xs text-muted-foreground">{c.empresa}</p>}
    </button>
  );
}

export type Props = {
  cards: EtapaCard[];
  etapas: EtapaCfg[];
  collapsedCols: Set<EtapaKey>;
  onToggleCol: (key: EtapaKey) => void;
  onAbrir: (modeloId: string) => void;
};

export function EtapasBoard({ cards, etapas, collapsedCols, onToggleCol, onAbrir }: Props) {
  const colunas = etapas.filter((e) => e.ativa);
  const byEtapa = new Map<EtapaKey, EtapaCard[]>();
  for (const c of cards) {
    if (!c.etapa) continue;
    const arr = byEtapa.get(c.etapa) ?? [];
    arr.push(c);
    byEtapa.set(c.etapa, arr);
  }

  // Aba ativa do fallback mobile — nasce na 1ª etapa ativa; re-semeia se a coluna
  // selecionada deixar de existir (ex.: etapa desativada em Config da Loja).
  const [abaMobile, setAbaMobile] = useState<EtapaKey | null>(colunas[0]?.key ?? null);
  useEffect(() => {
    if (colunas.length > 0 && !colunas.some((c) => c.key === abaMobile)) {
      setAbaMobile(colunas[0].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colunas.map((c) => c.key).join("|")]);

  if (colunas.length === 0) {
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
                      colCards.map((c) => <CardMinimo key={c.blocoId} c={c} onAbrir={onAbrir} />)
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile: abas roláveis por etapa + lista em largura total. */}
      <div className="md:hidden">
        <SegmentedTabs
          tabs={colunas.map((col) => ({
            value: col.key,
            label: `${col.label} (${(byEtapa.get(col.key) ?? []).length})`,
          }))}
          value={abaMobile ?? colunas[0].key}
          onChange={(v) => setAbaMobile(v as EtapaKey)}
        />
        <div className="mt-3 space-y-2">
          {colCardsMobile.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Sem cards</p>
          ) : (
            colCardsMobile.map((c) => <CardMinimo key={c.blocoId} c={c} onAbrir={onAbrir} />)
          )}
        </div>
      </div>
    </>
  );
}
