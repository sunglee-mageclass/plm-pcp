import { Fragment } from "react";
import { X } from "lucide-react";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";
import { necessidadePorTecido, detalheOc, fmtMetros } from "@/lib/plan-tecido/calc";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import type { SituacaoOcRow } from "@/lib/plan-tecido/useSituacaoOcs";

export type DrawerKind = "comprar" | "oc" | "ocnum";
export type DrawerState = { kind: DrawerKind; arg: string | null };

const nMet = fmtMetros;
const encomenda = (s: PtSlot) => !(s.usar_estoque ?? false);
const sobraCls = (s: number) => (s < 0 ? "text-red-600" : "text-emerald-600");

type Linha = { key: string; label: string; cor_nome: string | null; reservada: number; pedida: number; entregue: number; usada: number; comprometida: number };
type Grupo = { artigo_id: string; artigo: string; variantes: Linha[] };

export function PlanTecidoDrawer({
  state, subArvore, colecaoArvore, situacao, slotOcMap, vinculoOcMap = {}, enviadoCadSet, ocNumeroDe, onClose,
}: {
  state: DrawerState;
  subArvore: PtArvore;
  colecaoArvore: PtArvore;
  situacao: SituacaoOcRow[];
  slotOcMap: Record<string, string[]>;
  /** OC REAL vinculada no Dev por modelo_id — vence o hint do plano (slotOcMap) quando existe. */
  vinculoOcMap?: Record<string, string[]>;
  /** modelos ENVIADOS À EXPLOSÃO (enviado_cad) — p/ a "Usada" comprometida (laranja) por variante. */
  enviadoCadSet?: Set<string>;
  ocNumeroDe: (ocId: string) => string | null;
  onClose: () => void;
}) {
  const { kind, arg } = state;
  // OC efetiva de um slot: vínculo real do Dev (por modelo) vence o hint do plano (por slot).
  const ocsDoSlot = (s: PtSlot): string[] => {
    const devOc = s.modelo_id ? (vinculoOcMap[s.modelo_id] ?? []) : [];
    return devOc.length ? devOc : (s.id ? (slotOcMap[s.id] ?? []) : []);
  };
  const enviadoCad = (s: PtSlot) => !!s.modelo_id && !!enviadoCadSet?.has(s.modelo_id);

  // NECESSIDADE (reservada) — 'comprar'/'oc' = coleção; 'ocnum' = só os cards atribuídos à OC.
  const nec =
    kind === "comprar"
      ? necessidadePorTecido(subArvore, encomenda)
      : kind === "ocnum" && arg
        ? necessidadePorTecido(colecaoArvore, (s) => encomenda(s) && ocsDoSlot(s).includes(arg))
        : necessidadePorTecido(colecaoArvore, encomenda);
  const necByVar = new Map<string, number>();
  for (const t of nec) for (const v of t.variantes) if (v.variante_tecido_id) necByVar.set(v.variante_tecido_id, (necByVar.get(v.variante_tecido_id) ?? 0) + v.metros);

  // COMPROMETIDO por variante (laranja) = necessidade dos cards ENVIADOS À EXPLOSÃO (colecao-wide, p/ 'oc').
  const necComprometida =
    kind === "comprar" ? []
      : necessidadePorTecido(colecaoArvore, (s) => encomenda(s) && enviadoCad(s));
  const comprometidoByVar = new Map<string, number>();
  for (const t of necComprometida) for (const v of t.variantes) if (v.variante_tecido_id) comprometidoByVar.set(v.variante_tecido_id, (comprometidoByVar.get(v.variante_tecido_id) ?? 0) + v.metros);

  // Por OC (kind='ocnum') a reservada/comprometida vêm da FONTE ÚNICA detalheOc — a MESMA fn do Resumo
  // por OC×variante — pra nunca divergir (antes o "detalhar da OC" mostrava 0 enquanto o Resumo mostrava
  // o comprometido). 'oc'/'comprar' seguem colecao-wide (necByVar/comprometidoByVar).
  const det = detalheOc(colecaoArvore, vinculoOcMap, slotOcMap, enviadoCadSet);
  const reservaVar = (vid: string): number =>
    kind === "ocnum" && arg ? (det.reservPorOcVar.get(`${arg}|${vid}`) ?? 0) : (necByVar.get(vid) ?? 0);
  const comprometidaVar = (vid: string): number =>
    kind === "comprar" ? 0
      : kind === "ocnum" && arg ? (det.comprometidoPorOcVar.get(`${arg}|${vid}`) ?? 0) : (comprometidoByVar.get(vid) ?? 0);

  const situRows = kind === "ocnum" && arg ? situacao.filter((r) => r.oc_tecido_id === arg) : situacao;

  // 'comprar' = dirigido pela NECESSIDADE (o que planejei comprar) + pedido/recebido por variante.
  // 'oc'/'ocnum' = dirigido pelos ITENS DA OC (mostra o pedido mesmo sem card atribuído) + reservada.
  let grupos: Grupo[];
  let total = 0;
  if (kind === "comprar") {
    const situ = new Map<string, { pedida: number; entregue: number }>();
    for (const r of situRows) { const c = situ.get(r.variante_tecido_id) ?? { pedida: 0, entregue: 0 }; c.pedida += r.pedida_m; c.entregue += r.entregue_m; situ.set(r.variante_tecido_id, c); }
    grupos = nec.map((t) => ({
      artigo_id: t.artigo_id,
      artigo: t.artigo_nome,
      variantes: t.variantes.map((v) => {
        const s = (v.variante_tecido_id ? situ.get(v.variante_tecido_id) : undefined) ?? { pedida: 0, entregue: 0 };
        total += v.metros;
        return { key: v.key, label: v.label, cor_nome: v.cor_nome, reservada: v.metros, pedida: s.pedida, entregue: s.entregue, usada: 0, comprometida: 0 };
      }),
    }));
  } else {
    // agrupa os itens da OC (ou de todas as OCs, no 'oc') por ARTIGO (id — nomes iguais NÃO fundem) → variante
    const porArtigo = new Map<string, { nome: string; vm: Map<string, Linha> }>();
    for (const r of situRows) {
      let g = porArtigo.get(r.artigo_id);
      if (!g) { g = { nome: r.artigo_nome, vm: new Map() }; porArtigo.set(r.artigo_id, g); }
      const cur = g.vm.get(r.variante_tecido_id) ?? { key: r.variante_tecido_id, label: r.variante_label ?? "", cor_nome: null, reservada: reservaVar(r.variante_tecido_id), pedida: 0, entregue: 0, usada: 0, comprometida: comprometidaVar(r.variante_tecido_id) };
      cur.pedida += r.pedida_m; cur.entregue += r.entregue_m; cur.usada += r.usada_m; // reservada/comprometida vêm do front (detalheOc), não da RPC
      g.vm.set(r.variante_tecido_id, cur);
    }
    grupos = [...porArtigo.entries()].map(([artigo_id, g]) => ({ artigo_id, artigo: g.nome, variantes: [...g.vm.values()] }));
  }
  const nCols = kind === "comprar" ? 4 : 6;

  const titulo =
    kind === "comprar" ? "A comprar — por tecido e variante"
      : kind === "ocnum" ? `${(arg && ocNumeroDe(arg)) || "OC"} — por tecido e variante`
        : "Situação da OC — por tecido e variante";
  const sub =
    kind === "comprar" ? `total ${nMet(total)} m`
      : kind === "ocnum" ? `${grupos.reduce((a, g) => a + g.variantes.length, 0)} item(ns) da OC`
        : "coleção · valores das OCs (m)";

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center gap-2 border-b p-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-sm font-semibold">{titulo}</h3>
          <div className="truncate text-[11px] text-muted-foreground">{sub}</div>
        </div>
        <button type="button" onClick={onClose} className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Fechar">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-2">
        <table className="w-full text-xs tabular-nums">
          <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {kind === "comprar" ? (
              <tr>
                <th className="p-1.5 text-left font-medium">Tecido / variante</th>
                <th className="p-1.5 text-right font-medium">Nec.</th>
                <th className="p-1.5 text-right font-medium">Pedido</th>
                <th className="p-1.5 text-right font-medium">Receb.</th>
              </tr>
            ) : (
              <tr>
                <th className="p-1.5 text-left font-medium">Tecido / variante</th>
                <th className="p-1.5 text-right font-medium">Ped.</th>
                <th className="p-1.5 text-right font-medium">Entr.</th>
                <th className="p-1.5 text-right font-medium">Res.</th>
                <th className="p-1.5 text-right font-medium">Usada</th>
                <th className="p-1.5 text-right font-medium">Sobra</th>
              </tr>
            )}
          </thead>
          <tbody>
            {grupos.length === 0 ? (
              <tr><td colSpan={nCols} className="p-3 text-center text-muted-foreground">
                {kind === "ocnum" ? "Esta OC não tem itens." : kind === "oc" ? "Nenhuma OC com itens nesta coleção." : "Nenhum tecido planejado."}
              </td></tr>
            ) : grupos.map((g) => (
              <Fragment key={g.artigo_id}>
                <tr className="border-t bg-muted/40"><td className="p-1.5 font-medium" colSpan={nCols}>{g.artigo}</td></tr>
                {g.variantes.map((v) => {
                  // Contabilidade (igual ao Resumo): usado (comprometido/cortado) SAI da reservada.
                  // usada = max(comprometido, baixa real); reservada exibida = total − usada; sobra = pedida − total.
                  const usada = Math.max(v.comprometida, v.usada);
                  const reservadaLivre = Math.max(0, v.reservada - usada);
                  const sobra = v.pedida - Math.max(v.reservada, usada);
                  return (
                    <tr key={v.key} className="border-t">
                      <td className="p-1.5">
                        <span className="flex min-w-0 items-center gap-1">
                          <VarianteSwatch nome={v.cor_nome ?? v.label} /><span className="truncate">{v.label || v.cor_nome || "—"}</span>
                        </span>
                      </td>
                      {kind === "comprar" ? (
                        <>
                          <td className="p-1.5 text-right">{nMet(v.reservada)}</td>
                          <td className={`p-1.5 text-right ${v.pedida > 0 ? "font-medium text-emerald-600" : "text-muted-foreground"}`}>{nMet(v.pedida)}</td>
                          <td className="p-1.5 text-right text-muted-foreground">{nMet(v.entregue)}</td>
                        </>
                      ) : (
                        <>
                          <td className="p-1.5 text-right">{nMet(v.pedida)}</td>
                          <td className="p-1.5 text-right">{nMet(v.entregue)}</td>
                          <td className="p-1.5 text-right text-muted-foreground">{nMet(reservadaLivre)}</td>
                          {/* Usada (saiu da reservada): baixa REAL (vermelho) tem prioridade; senão o
                              comprometido = enviado à explosão (laranja). Cinza quando 0. */}
                          <td className={`p-1.5 text-right ${v.usada > 0 ? "font-medium text-red-600" : v.comprometida > 0 ? "font-medium text-amber-600" : "text-muted-foreground"}`}
                              title={v.usada > 0 ? "Baixa real (corte enviado)" : v.comprometida > 0 ? "Comprometido — enviado à explosão" : undefined}>
                            {nMet(usada)}
                          </td>
                          <td className={`p-1.5 text-right font-medium ${sobraCls(sobra)}`}>{sobra > 0 ? "+" : ""}{nMet(sobra)}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
