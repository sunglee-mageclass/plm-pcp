import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { ModoColunaBadge } from "@/components/admin/ModoColunaBadge";
import { SegmentedTabs } from "@/components/dashboard/mobile";
import { destinoDropPl, fluxoEtapasPl, type DestinoDropPl, type EtapasPlConfig } from "@/lib/etapas-pl-config";
import {
  ETAPA_PL_FILTRO_LANCADO, dropBloqueadoPl, etapaDoProduto, modoColunaPl, notaMoverPlPara, subtituloColunaPl,
  textoFaixaDropPl, toastDoMoverPl, type EtapaSeloPl,
} from "@/lib/etapas-pl-ui";
import { normalizeKanbanStatuses } from "@/lib/kanban-status";
import { EtapaPlCard, type MoverOptPl, type ProdutoPlBoard } from "./EtapaPlCard";

// Board das Etapas PL (Onda 3, Task 8) — espelha o quadro do Desenvolvimento (criacao.desenvolvimento.tsx): colunas do
// board PL (`etapas_pl_kanban`), arraste HTML5 NATIVO, feedback de destino (válido = tracejado primary; bloqueado =
// tracejado destructive + faixa "Faltam: X"), trilho recolhível por coluna, coluna terminal sintética "Finalizado"
// (produto lançado) e, no mobile, abas roláveis (SegmentedTabs, como o board PL anterior) + "Mover para…" no card.
//
// QUEM FAZ O QUÊ: este componente só DECIDE e APRESENTA. Ele não grava nada — `onMover` é da rota (Task 9), que:
//  - chave LIGADA: chama `etapasPlMover` (o servidor é a autoridade: fixar/soltar/…), toast por `toastDoMoverPl`, invalida;
//  - chave DESLIGADA: `etapas_pl_mover` recusa (P0001, "modo manual: a tela grava direto") — a rota faz o UPDATE direto de
//    `modelos.status_etapa_pl` (a pessoa decide; sem bloqueio por requisito).
// Board PL vazio = INÉRCIA (sem colunas, sem cair no board do Dev).

const TERMINAL = { key: ETAPA_PL_FILTRO_LANCADO, label: "Finalizado", color: "var(--success)" };
const COR_NEUTRA = "var(--muted-foreground)";
const SEM_SATISFEITAS: Record<string, boolean> = {};

/** Coluna onde o card APARECE: o status se ele é do fluxo, senão (nulo/órfão) a 1ª coluna. `null` = fluxo vazio. */
export function colunaEfetivaPl(status: string | null | undefined, fluxo: string[]): string | null {
  const s = String(status ?? "").trim();
  return s && fluxo.includes(s) ? s : (fluxo[0] ?? null);
}

/** Distribuição por coluna (ordem de entrada preservada): lançado → terminal "Finalizado"; status órfão/nulo → 1ª coluna.
 *  Fluxo vazio: só os lançados aparecem (na terminal) — os demais ficam de fora (inércia). */
export function distribuirPorColunaPl(produtos: ProdutoPlBoard[], fluxo: string[]): Map<string, ProdutoPlBoard[]> {
  const map = new Map<string, ProdutoPlBoard[]>();
  fluxo.forEach((k) => map.set(k, []));
  map.set(TERMINAL.key, []);
  for (const p of produtos) {
    if (p.lancado === true) { map.get(TERMINAL.key)!.push(p); continue; }
    const k = colunaEfetivaPl(p.status_etapa_pl, fluxo);
    if (k) map.get(k)!.push(p);
  }
  return map;
}

export type DecisaoMoverPl =
  | { tipo: "ignorar" }
  | { tipo: "bloquear"; destino: DestinoDropPl }
  /** `destino` = a prévia da tabela única (chave ligada); null = chave desligada (mover direto, sem prévia). */
  | { tipo: "mover"; destino: DestinoDropPl | null };

/** Decisão local ao soltar/escolher "Mover para…". Terminal/fora do fluxo/mesma coluna = ignora. Chave DESLIGADA = a pessoa
 *  decide (sem bloqueio por requisito). Chave LIGADA = `destinoDropPl`; só os 2 `bloquear_*` travam aqui (o resto vai ao
 *  servidor, que decide — inclusive `fora_do_fluxo`, ruling do controlador). */
export function decidirMoverPl(a: {
  cfg: EtapasPlConfig; ligado: boolean; statusAtual: string | null; para: string; satisfeitas: Record<string, boolean>;
}): DecisaoMoverPl {
  if (!fluxoEtapasPl(a.cfg).includes(a.para)) return { tipo: "ignorar" };
  if ((a.statusAtual ?? null) === a.para) return { tipo: "ignorar" };
  if (!a.ligado) return { tipo: "mover", destino: null };
  const destino = destinoDropPl(a.cfg, a.statusAtual, a.para, a.satisfeitas);
  return dropBloqueadoPl(destino) ? { tipo: "bloquear", destino } : { tipo: "mover", destino };
}

export type EtapasPlKanbanProps = {
  produtos: ProdutoPlBoard[];
  cfg: EtapasPlConfig;
  /** Chave do modo automático (`cfg.automatico`, via `useEtapasPlConfig().ligado`). */
  ligado: boolean;
  /**
   * Condições satisfeitas por produto (`{ [produtoId]: { tem_peca_teste: true, … } }`) — a rota busca via
   * `avaliar_condicoes_etapas_pl` SÓ com a chave ligada. Ausente = `{}`. Alimentam a dica de arraste, a faixa "Faltam: X" e
   * as notas do "Mover para…" (a RPC `etapas_pl_mover` re-decide no servidor).
   */
  satisfeitasPorProduto?: Record<string, Record<string, boolean>>;
  /** Pode arrastar / "Mover para…": a rota combina permissão de editar + config lida + (desligada OU condições carregadas). */
  podeMover: boolean;
  collapsedCols: Set<string>;
  onToggleCol: (key: string) => void;
  /** Clique no card: a rota abre o Sheet de Serviços. */
  onAbrir: (produtoId: string) => void;
  /** Pedido de mover (já aprovado localmente). `previsto` = prévia da tabela única (ligada) ou null (desligada). */
  onMover: (produtoId: string, paraKey: string, previsto: DestinoDropPl | null) => void;
  /** "Recolher cards" da página (só desktop): cards só com nome + REF (+ atraso). */
  minimizedCards?: boolean;
};

export function EtapasPlKanban({
  produtos, cfg, ligado, satisfeitasPorProduto, podeMover, collapsedCols, onToggleCol, onAbrir, onMover, minimizedCards = false,
}: EtapasPlKanbanProps) {
  const fluxo = useMemo(() => fluxoEtapasPl(cfg), [cfg]);
  const colunas = useMemo(() => {
    const cores = new Map(normalizeKanbanStatuses(cfg.board).map((c) => [c.key, c.color]));
    const rotulos = new Map(normalizeKanbanStatuses(cfg.board).map((c) => [c.key, c.label]));
    return fluxo.map((key) => ({ key, label: rotulos.get(key) ?? key, color: cores.get(key) ?? COR_NEUTRA }));
  }, [cfg, fluxo]);
  const byStatus = useMemo(() => distribuirPorColunaPl(produtos, fluxo), [produtos, fluxo]);
  const porId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);
  const terminalCards = byStatus.get(TERMINAL.key) ?? [];

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Coluna terminal: colapso PRÓPRIO (default recolhida), imune ao "recolher/expandir todas" da página.
  const [terminalAberta, setTerminalAberta] = useState(false);

  // Abas do mobile = colunas do fluxo + "Finalizado" por último; re-semeia se a aba atual deixar de existir.
  const abasMobile = [...colunas.map((c) => ({ key: c.key, label: c.label })), { key: TERMINAL.key, label: TERMINAL.label }];
  const [abaMobile, setAbaMobile] = useState<string>(abasMobile[0].key);
  useEffect(() => {
    if (!abasMobile.some((a) => a.key === abaMobile)) setAbaMobile(abasMobile[0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abasMobile.map((a) => a.key).join("|")]);

  const satDe = (id: string) => satisfeitasPorProduto?.[id] ?? SEM_SATISFEITAS;
  const seloDe = (p: ProdutoPlBoard): EtapaSeloPl =>
    etapaDoProduto(cfg, p.status_etapa_pl, { ...satDe(p.id), ...(p.lancado === true ? { lancado: true } : {}) }, ligado);

  /** Aplica a decisão: ignora, avisa (bloqueio local) ou pede à rota. Único caminho do arraste E do "Mover para…". */
  const tentarMover = (p: ProdutoPlBoard, para: string) => {
    if (!podeMover || p.lancado === true) return;
    // L2 (Task 8): soltar um card nulo/órfão (que o board mostra na 1ª coluna) na PRÓPRIA coluna efetiva não é mover (o status cru
    // ≠ a key de lá, mas visualmente é a mesma coluna — mesmo critério do `isSelf` do arraste e do filtro do "Mover para…").
    if (colunaEfetivaPl(p.status_etapa_pl, fluxo) === para) return;
    const dec = decidirMoverPl({ cfg, ligado, statusAtual: p.status_etapa_pl, para, satisfeitas: satDe(p.id) });
    if (dec.tipo === "ignorar") return;
    if (dec.tipo === "bloquear") {
      const t = toastDoMoverPl({ acao: dec.destino.acao, status: null, faltando: dec.destino.faltando, rev: 0 }, para, cfg);
      if (t.tipo === "erro") toast.error(t.titulo); else toast.info(t.titulo);
      return;
    }
    onMover(p.id, para, dec.destino);
  };

  const handleDrop = (para: string, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    setDraggingId(null);
    const id = e.dataTransfer.getData("text/plain");
    const p = id ? porId.get(id) : undefined;
    if (p) tentarMover(p, para);
  };

  const moverOptsDe = (p: ProdutoPlBoard): MoverOptPl[] | undefined => {
    if (!podeMover || p.lancado === true) return undefined;
    const efetiva = colunaEfetivaPl(p.status_etapa_pl, fluxo);
    return colunas
      .filter((c) => c.key !== efetiva)
      .map((c) => {
        if (!ligado) return { key: c.key, label: c.label };
        const d = destinoDropPl(cfg, p.status_etapa_pl, c.key, satDe(p.id));
        return { key: c.key, label: c.label, nota: notaMoverPlPara(d) || undefined, bloqueada: dropBloqueadoPl(d), modo: modoColunaPl(cfg, c.key) };
      });
  };

  // Sem colunas E sem lançados = board PL vazio (inércia): nada de colunas do Dev.
  if (colunas.length === 0 && terminalCards.length === 0) {
    return (
      <p data-testid="etapas-pl-vazio" className="py-10 text-center text-sm text-muted-foreground">
        Nenhuma etapa configurada para o kanban PL. Configure as etapas em Config da Loja.
      </p>
    );
  }

  const dragProduto = draggingId ? porId.get(draggingId) ?? null : null;
  const dragEfetiva = dragProduto ? colunaEfetivaPl(dragProduto.status_etapa_pl, fluxo) : null;

  const renderCard = (p: ProdutoPlBoard, mobile: boolean) => (
    <EtapaPlCard
      key={p.id}
      produto={p}
      selo={seloDe(p)}
      onAbrir={onAbrir}
      minimizado={minimizedCards && !mobile}
      draggable={!mobile && podeMover && p.lancado !== true}
      dragging={draggingId === p.id}
      onDragStartCard={() => setDraggingId(p.id)}
      onDragEndCard={() => { setDraggingId(null); setDragOver(null); }}
      moverOpts={mobile ? moverOptsDe(p) : undefined}
      onMover={mobile ? (para) => tentarMover(p, para) : undefined}
    />
  );

  const colAbertaMobile = abaMobile === TERMINAL.key ? terminalCards : (byStatus.get(abaMobile) ?? []);

  return (
    <>
      {/* Desktop: quadro de colunas (título horizontal quando aberta; trilho vertical quando recolhida). */}
      <div className="hidden items-stretch gap-4 overflow-x-auto pb-4 md:flex">
        {colunas.map((col) => {
          const cards = byStatus.get(col.key) ?? [];
          const isCollapsed = collapsedCols.has(col.key);
          const isOver = dragOver === col.key;
          const isSelf = !!draggingId && dragEfetiva === col.key;
          // Chave desligada: nenhum destino é bloqueado (a pessoa decide). Ligada: a tabela única dá a dica
          // (o produto arrastado vs. esta coluna); a coluna de ORIGEM fica neutra.
          const destino = ligado && dragProduto && !isSelf
            ? destinoDropPl(cfg, dragProduto.status_etapa_pl, col.key, satDe(dragProduto.id))
            : null;
          const blocked = destino ? dropBloqueadoPl(destino) : false;
          const canDrop = !!draggingId && !isSelf && !blocked;
          const faixa = destino ? textoFaixaDropPl(destino, cfg) : "";
          const modo = ligado ? modoColunaPl(cfg, col.key) : null;
          return (
            <div
              key={col.key}
              data-testid={`etapas-pl-coluna-${col.key}`}
              data-bloqueada={blocked ? "true" : undefined}
              className={`flex max-h-[calc(100vh-260px)] shrink-0 flex-col rounded-lg transition-colors ${isCollapsed ? "" : "w-80"} ${
                blocked ? "border border-dashed border-destructive/50 bg-destructive/5"
                : canDrop ? "border-2 border-dashed border-primary/60 bg-primary/10"
                : "border bg-muted/30"
              } ${isOver && !isSelf ? "ring-2 ring-primary" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(col.key); }}
              onDragLeave={() => setDragOver((cur) => (cur === col.key ? null : cur))}
              onDrop={(e) => handleDrop(col.key, e)}
            >
              {isCollapsed ? (
                <button
                  type="button"
                  onClick={() => onToggleCol(col.key)}
                  title={col.label}
                  className="flex w-9 flex-1 flex-col items-center gap-2 py-3 hover:bg-muted/50"
                >
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: col.color }} />
                  <span className="whitespace-nowrap text-sm font-semibold [writing-mode:vertical-rl] rotate-180">{col.label}</span>
                  <span className="text-xs text-muted-foreground">{cards.length}</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onToggleCol(col.key)}
                    title="Recolher coluna"
                    className="flex items-center gap-2 border-b px-3 py-2.5 text-left hover:bg-muted/50"
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: col.color }} />
                    <span className="truncate text-sm font-semibold">{col.label}</span>
                    {modo && <ModoColunaBadge modo={modo} />}
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">{cards.length}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 rotate-90 text-muted-foreground/60" />
                  </button>
                  {/* Chave ligada: o que a coluna exige (ou que é manual). */}
                  {ligado && (
                    <div data-testid="etapas-pl-col-sub" className="truncate border-b px-3 py-1.5 text-[11px] text-muted-foreground" title={subtituloColunaPl(cfg, col.key)}>
                      {subtituloColunaPl(cfg, col.key)}
                    </div>
                  )}
                  {blocked && faixa && (
                    <div data-testid="etapas-pl-drop-faixa" className="border-b border-dashed border-destructive/40 px-3 py-1.5 text-[11px] leading-snug text-destructive">
                      {faixa}
                    </div>
                  )}
                  {/* Destino válido em foco: convite positivo. */}
                  {canDrop && isOver && (
                    <div data-testid="etapas-pl-drop-convite" className="border-b border-dashed border-primary/40 px-3 py-1.5 text-[11px] leading-snug text-primary">
                      {faixa || "Solte aqui para mover"}
                    </div>
                  )}
                  <div className={`min-w-0 flex-1 space-y-2 overflow-y-auto p-2 transition-opacity ${blocked ? "opacity-40" : ""}`}>
                    {cards.length === 0 ? (
                      <p className="py-6 text-center text-xs text-muted-foreground">Sem cards</p>
                    ) : (
                      cards.map((p) => renderCard(p, false))
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* Terminal sintética "Finalizado" — SEMPRE por último, colapso próprio. Sem onDragOver/onDrop: derivada de
            `modelos.lancado`, não se move card de/para ela. */}
        <div
          data-testid="etapas-pl-coluna-finalizado"
          className={`flex max-h-[calc(100vh-260px)] shrink-0 flex-col rounded-lg border bg-muted/30 ${terminalAberta ? "w-80" : ""}`}
        >
          {!terminalAberta ? (
            <button
              type="button"
              onClick={() => setTerminalAberta(true)}
              title={TERMINAL.label}
              className="flex w-9 flex-1 flex-col items-center gap-2 py-3 hover:bg-muted/50"
            >
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TERMINAL.color }} />
              <span className="whitespace-nowrap text-sm font-semibold [writing-mode:vertical-rl] rotate-180">{TERMINAL.label}</span>
              <span className="text-xs text-muted-foreground">{terminalCards.length}</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setTerminalAberta(false)}
                title="Recolher coluna"
                className="flex items-center gap-2 border-b px-3 py-2.5 text-left hover:bg-muted/50"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TERMINAL.color }} />
                <span className="truncate text-sm font-semibold">{TERMINAL.label}</span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">{terminalCards.length}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 rotate-90 text-muted-foreground/60" />
              </button>
              <div className="min-w-0 flex-1 space-y-2 overflow-y-auto p-2">
                {terminalCards.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">Sem cards</p>
                ) : (
                  terminalCards.map((p) => renderCard(p, false))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Mobile: abas roláveis por etapa (+ "Finalizado") e a lista da etapa em largura total, com "Mover para…". */}
      <div className="md:hidden">
        <SegmentedTabs
          tabs={abasMobile.map((a) => ({ value: a.key, label: `${a.label} (${(byStatus.get(a.key) ?? []).length})` }))}
          value={abaMobile}
          onChange={setAbaMobile}
        />
        <div className="mt-3 space-y-2">
          {colAbertaMobile.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Sem cards</p>
          ) : (
            colAbertaMobile.map((p) => renderCard(p, true))
          )}
        </div>
      </div>
    </>
  );
}
