import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";
import { necessidadePorTecido, detalheOc, fmtMetros, contabilizarOc } from "@/lib/plan-tecido/calc";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import type { SituacaoOcRow } from "@/lib/plan-tecido/useSituacaoOcs";

export type DrawerKind = "comprar" | "oc" | "ocnum";
export type DrawerState = { kind: DrawerKind; arg: string | null };

const nMet = fmtMetros;
const cmpPt = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }); // ordem alfabética pt-BR (dono)
const encomenda = (s: PtSlot) => !(s.usar_estoque ?? false);
const sobraCls = (s: number) => (s < 0 ? "text-red-600" : "text-emerald-700");

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
  const ocArtigos = new Map<string, Set<string>>();
  const ocVariantes = new Map<string, Set<string>>();
  for (const r of situacao) {
    let s = ocArtigos.get(r.oc_tecido_id);
    if (!s) { s = new Set(); ocArtigos.set(r.oc_tecido_id, s); }
    s.add(r.artigo_id);
    let v = ocVariantes.get(r.oc_tecido_id);
    if (!v) { v = new Set(); ocVariantes.set(r.oc_tecido_id, v); }
    if (r.variante_tecido_id) v.add(r.variante_tecido_id);
  }
  const det = detalheOc(colecaoArvore, vinculoOcMap, slotOcMap, enviadoCadSet, ocArtigos, ocVariantes);
  const reservaVar = (vid: string): number =>
    kind === "ocnum" && arg ? (det.reservPorOcVar.get(`${arg}|${vid}`) ?? 0) : (necByVar.get(vid) ?? 0);
  const comprometidaVar = (vid: string): number =>
    kind === "comprar" ? 0
      : kind === "ocnum" && arg ? (det.comprometidoPorOcVar.get(`${arg}|${vid}`) ?? 0) : (comprometidoByVar.get(vid) ?? 0);

  const situRows = kind === "ocnum" && arg ? situacao.filter((r) => r.oc_tecido_id === arg) : situacao;

  // 'comprar' = a MESMA conta do Fazer pedido, por variante, com a equação nas colunas:
  // Nec − Coberto (OC) = A comprar (padrão aprovado do drawer Situação). A cobertura vem
  // da prévia do servidor (chave 'cobertura', TODAS as linhas — inclusive déficit 0, que é
  // a parte satisfatória de ver). Escopo = COLEÇÃO (igual ao pedido); a nota explica.
  const { data: previaDrawer } = useQuery({
    queryKey: ["plan-tecido-previa", colecaoArvore.colecao_id],
    enabled: kind === "comprar",
    queryFn: async () => ((await supabase.rpc("plan_tecido_previa_pedido" as any, { _colecao_id: colecaoArvore.colecao_id })).data ?? null) as any,
  });
  type CobRow = { artigo_id: string; artigo_nome: string; variante_tecido_id: string | null; label: string | null; nec_m: number; estoque_m: number; deficit_m: number };
  const cobertura = ((previaDrawer as any)?.cobertura ?? []) as CobRow[];

  // 'oc'/'ocnum' = dirigido pelos ITENS DA OC (mostra o pedido mesmo sem card atribuído) + reservada.
  let grupos: Grupo[];
  let total = 0;
  if (kind === "comprar") {
    // Mapeamento dos campos da Linha p/ a equação: reservada=Nec · pedida=Coberto(OC) ·
    // entregue=estoque (só title) · usada=A comprar (déficit).
    const porArt = new Map<string, { nome: string; rows: CobRow[] }>();
    for (const r of cobertura) {
      if ((Number(r.nec_m) || 0) <= 0 && (Number(r.deficit_m) || 0) <= 0) continue; // linha 0−0=0 é ruído
      let g = porArt.get(r.artigo_id);
      if (!g) { g = { nome: r.artigo_nome, rows: [] }; porArt.set(r.artigo_id, g); }
      g.rows.push(r);
    }
    grupos = [...porArt.entries()].map(([artigo_id, g]) => ({
      artigo_id, artigo: g.nome,
      variantes: [...g.rows].sort((a, b) => cmpPt(a.label ?? "", b.label ?? "")).map((r) => {  // variantes alfabéticas (dono)
        const nec = Number(r.nec_m) || 0, deficit = Number(r.deficit_m) || 0;
        total += deficit;
        return { key: r.variante_tecido_id ?? `${artigo_id}|${r.label}`, label: r.label ?? "", cor_nome: null,
          reservada: nec, pedida: Math.max(0, nec - deficit), entregue: Number(r.estoque_m) || 0, usada: deficit, comprometida: 0 };
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
    grupos = [...porArtigo.entries()].map(([artigo_id, g]) => ({ artigo_id, artigo: g.nome, variantes: [...g.vm.values()].sort((a, b) => cmpPt(a.label, b.label)) }));  // variantes alfabéticas (dono)
  }
  grupos.sort((a, b) => cmpPt(a.artigo, b.artigo)); // tecidos (artigos) em ordem alfabética (dono) — Situação e A comprar
  const nCols = 4;

  const titulo =
    kind === "comprar" ? "A comprar — por tecido e variante"
      : kind === "ocnum" ? `${(arg && ocNumeroDe(arg)) || "OC"} — por tecido e variante`
        : "Detalhe por variante";
  const sub =
    kind === "comprar" ? `coleção · mesma conta do Fazer pedido — a comprar ${nMet(total)} m`
      : kind === "ocnum" ? `${grupos.reduce((a, g) => a + g.variantes.length, 0)} item(ns) da OC`
        : "coleção · cobertura das OCs por tecido e variante (m)";

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
            {/* Rótulo = coluna flexível (w-full + truncate); números NUNCA quebram (nowrap) —
                senão o layout auto da tabela dava a largura pro rótulo e o "1.023,5 ✓"
                virava duas linhas no painel estreito (dono). */}
            {kind === "comprar" ? (
              <tr>
                <th className="w-full p-1.5 text-left font-medium">Tecido / variante</th>
                <th className="whitespace-nowrap p-1.5 text-right font-medium" title="Necessidade da coleção (consumo × grade, plano salvo)">Nec.</th>
                <th className="whitespace-nowrap p-1.5 text-right font-medium" title="Sobra das OCs vinculadas que cobre esta cor">− Coberto</th>
                <th className="whitespace-nowrap p-1.5 text-right font-medium">= A comprar</th>
              </tr>
            ) : (
              /* A EQUAÇÃO na linha: Entregue − Demanda = Sobra em colunas ADJACENTES (a Sobra
                 usa o ENTREGUE, decisão do dono jul/2026). A Pedida vira sub-info do Entregue;
                 o "em produção" vira sub-info da Demanda. */
              <tr>
                <th className="w-full p-1.5 text-left font-medium">Tecido / variante</th>
                <th className="whitespace-nowrap p-1.5 text-right font-medium" title="Metragem que já chegou (recebida)">Entregue</th>
                <th className="whitespace-nowrap p-1.5 text-right font-medium" title="O que os modelos vinculados planejam usar desta cor (em produção + reservada livre)">− Demanda</th>
                <th className="whitespace-nowrap p-1.5 text-right font-medium">= Sobra</th>
              </tr>
            )}
          </thead>
          <tbody>
            {grupos.length === 0 ? (
              <tr><td colSpan={nCols} className="p-3 text-center text-muted-foreground">
                {kind === "ocnum" ? "Esta OC não tem itens." : kind === "oc" ? "Nenhuma OC com itens nesta coleção." : previaDrawer === undefined ? "Carregando a conta…" : "Nenhum tecido planejado."}
              </td></tr>
            ) : grupos.map((g) => (
              <Fragment key={g.artigo_id}>
                <tr className="border-t bg-muted/40"><td className="p-1.5 font-medium" colSpan={nCols}>{g.artigo}</td></tr>
                {g.variantes.map((v) => {
                  // Contabilidade via fonte única (mesma fn do Resumo): usado sai da reservada.
                  const { reservadaLivre, usada, sobra, baixaDomina } = contabilizarOc(v.reservada, v.comprometida, v.usada, v.entregue);
                  return (
                    <tr key={v.key} className="border-t">
                      {/* Rótulo da variante (cor base + cor apelido, `src/lib/variante.ts`) NÃO trunca
                          mais (dono ago/2026) — quebra linha (`whitespace-normal break-words`) em vez
                          de reticências, senão a cor apelido some. `align-top` casa com as colunas
                          numéricas ao lado (Entregue/Demanda também têm 2 linhas via sub-info). */}
                      <td className="w-full max-w-0 p-1.5 align-top">
                        <span className="flex min-w-0 items-start gap-1">
                          <VarianteSwatch nome={v.cor_nome ?? v.label} className="mt-0.5 shrink-0" />
                          <span className="whitespace-normal break-words">{v.label || v.cor_nome || "—"}</span>
                        </span>
                      </td>
                      {kind === "comprar" ? (
                        <>
                          <td className="whitespace-nowrap p-1.5 text-right align-top">{nMet(v.reservada)}</td>
                          <td className={`whitespace-nowrap p-1.5 text-right align-top ${v.pedida > 0 ? "font-medium text-emerald-700" : "text-muted-foreground"}`}
                              title={v.entregue > 0 ? `Estoque previsto: ${nMet(v.entregue)} m (não abate o déficit)` : undefined}>
                            {nMet(v.pedida)}
                          </td>
                          <td className={`whitespace-nowrap p-1.5 text-right align-top font-medium ${v.usada > 0 ? "text-red-700" : "text-emerald-700"}`}>{nMet(v.usada)}</td>
                        </>
                      ) : (
                        <>
                          {/* Entregue (nº principal = o operando da equação) + Pedida como sub-info:
                              ✓ verde = entrega completa; âmbar = quanto falta chegar. */}
                          <td className="whitespace-nowrap p-1.5 text-right align-top">
                            <div className={v.pedida > 0 && v.entregue >= v.pedida ? "font-medium text-emerald-700" : v.pedida > 0 ? "font-medium text-amber-700" : ""}
                                 title={v.pedida > 0 && v.entregue >= v.pedida ? "Entrega completa — nada a chegar" : undefined}>
                              {nMet(v.entregue)}{v.pedida > 0 && v.entregue >= v.pedida ? " ✓" : ""}
                            </div>
                            {v.pedida > 0 && (
                              <div className="text-[10px] text-muted-foreground" title={`Pedida ${nMet(v.pedida)} m`}>
                                de {nMet(v.pedida)}{v.entregue < v.pedida ? ` · falta ${nMet(v.pedida - v.entregue)}` : ""}
                              </div>
                            )}
                          </td>
                          {/* Demanda = max(reserva total, usada) — garante Entregue − Demanda = Sobra
                              EXATO na linha. Sub-info: parcela já EM PRODUÇÃO (âmbar = enviado à
                              explosão; vermelho = corte baixado). */}
                          <td
                            className="whitespace-nowrap p-1.5 text-right align-top"
                            title={`Demanda dos modelos vinculados: ${nMet(usada)} em produção + ${nMet(reservadaLivre)} reservada (livre)`}
                          >
                            <div>{nMet(Math.max(v.reservada, usada))}</div>
                            {usada > 0 && (
                              <div className={`text-[10px] font-medium ${baixaDomina ? "text-red-700" : "text-amber-700"}`}>
                                {nMet(usada)} em produção
                              </div>
                            )}
                          </td>
                          <td className={`whitespace-nowrap p-1.5 text-right align-top font-medium ${sobraCls(sobra)}`}>{sobra > 0 ? "+" : ""}{nMet(sobra)}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
        {kind === "comprar" && grupos.length > 0 && (
          <p className="border-t px-1.5 py-2 text-[10px] leading-snug text-muted-foreground">
            <b className="font-semibold">Coberto</b> = sobra das OCs vinculadas que serve esta cor.
            <b className="font-semibold"> A comprar</b> = o que o Fazer pedido vai pedir (nunca negativo).
            Escopo = coleção inteira; o painel ao lado mostra a parte desta subcoleção (rateio).
          </p>
        )}
        {kind !== "comprar" && grupos.length > 0 && (
          <p className="border-t px-1.5 py-2 text-[10px] leading-snug text-muted-foreground">
            <b className="font-semibold">Demanda</b> = o que os modelos vinculados planejam usar desta cor
            (em produção + reservada livre — detalhe no hover). <b className="font-semibold">Em produção</b>:
            âmbar = enviado à explosão; vermelho = corte já baixado. A <b className="font-semibold">Sobra</b> =
            Entregue − Demanda (o físico que sobra do que já chegou) — negativa = falta tecido chegar.
          </p>
        )}
      </div>
    </div>
  );
}
