// Tabela da seção "Preço" do detalhe do Planejamento (card manufaturado). Extraída na F3.0
// (set/2026) de `PlanejamentoDetail.tsx` SEM mudança de comportamento: texto MOVIDO como estava
// (só ganhou `export`). Só props — nenhum estado, query ou chamada ao banco aqui.
// Fix mobile (F3.3, 24/set) — achado 2 do laudo mobile: a 360/390px só 2 de 4 colunas cabiam e o
// campo de edição do Preço de venda (coluna "Valores") ficava parcialmente escondido, sem
// indicador de rolagem. Correção: coluna "Valores" fica STICKY à direita SÓ abaixo de 768px
// (`max-md:`), então TODOS os inputs editáveis da tabela (Preço, Consumo, Aviamento, custos
// adicionais) ficam sempre 100% visíveis sem rolar; Descrição/Markup/Obs continuam roláveis
// dentro do wrapper `overflow-x-auto`, com fade condicional ao scroll real (mesma receita do
// `SegmentedTabs`, `src/components/dashboard/mobile.tsx` — §Q10). Em ≥768px nada muda: sem
// `max-md:`, a tabela renderiza exatamente como antes.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { NumberInput } from "@/components/shared/NumberInput";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { brl, fmtNum } from "@/lib/format";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SeloCusto } from "@/components/planejamento/planejamento-detail/custo-base";
import type { CustoAdicional } from "@/components/desenvolvimento/modelo-detail/ModeloCustosSection";
import { classeCopiado } from "@/components/desenvolvimento/importar/highlight";
import { precoAnteriorExibido, precoAnteriorOuNull } from "@/components/planejamento/planejamento-detail/helpers";
import { InfoHover } from "@/components/shared/InfoHover";

/**
 * F3.2 (decisão F3 #2 + mockup Anotado, seção 10 — R9c do G-plano conjunto): os custos do BOM (previsto) são LINHAS
 * desta tabela — Tecido, Forro, Entretela, Aviamento, Insumos e os custos adicionais (descrição + valor por peça;
 * "Adicionar custo") —, com os MESMOS dados que o `ModeloCustosSection` do Dev mostra. null = sem ficha carregada ou
 * sem permissão de ver custos (as linhas não aparecem).
 */
export type CustosBomTabela = {
  totais: { tecido: number; forro: number; entretela: number; aviamento: number; etiqueta: number };
  custosAdicionais: CustoAdicional[];
  onChange: (v: CustoAdicional[]) => void;
  /** `ficha.podeEditar` (permissão do Dev + trava única). Sem isso: só leitura, sem adicionar/remover. */
  editavel: boolean;
  /** Destaque do "Importar dados" (o diálogo é da F3.3). */
  copiados: Set<string>;
  onEditado: (chave: string) => void;
};

// Seção Preço tabulada (reformulada): Descrição · Markup · Valores · Obs, em 3 partes. A coluna
// Valores só tem números; contexto (selo previsto/real, badge de faixa da M.O., histórico, fórmula)
// mora na Obs — pedido do dono: "bater o olho e já saber o que ler". Mesmos dados de sempre.
const mkFmt = (v: number) => (v > 0 ? `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—");
export function PrecoTabela(props: {
  // preço + markup (real vem do custo total; markup real = preço ÷ custo)
  markupReal: number; precoSug: number;
  // precoBase = efetivo (venda digitada OU sugerido) — base da M.O. por faixa; precoDigitado só
  // distingue, na Obs, se está usando o preço do usuário ou o sugerido.
  precoBase: number; precoDigitado: number;
  draftPrecoVenda: number | null | undefined; onPrecoVenda: (v: string) => void;
  // F3.6 (Parte B, ruling 11) — Preço anterior: NULL = acompanha o preço EFETIVO (`precoBase` — o digitado ou o sugerido, o
  // mesmo da linha "Preço de venda"); não-NULL = fixado à mão até o ↺. Editar = `podeEditarPreco` (mesma permissão).
  precoAnterior: number | null; onPrecoAnterior: (v: number | null) => void;
  // F3.2 (decisão F3 #6): custo-base ÚNICO (o MESMO que o markup usa) + selo de 3 estados —
  // real (CAD enviado ao corte) › previsto (BOM) › estimado (tecido + materiais + M.O.).
  seloCusto: SeloCusto; custoBase: number;
  // estimado (editável): consumo de tecido × preço/m + aviamento manual + M.O. (dev)
  consumo: number | null; consumoRealBOM: number; precoTecidoM: number; tecidoEstimado: number;
  aviamento: number | null; maoObraDev: number;
  onConsumo: (v: string) => void; onAviamento: (v: string) => void;
  // materiais = custo-base − M.O. embutida; `custoPrevisto` = o previsto SALVO, p/ o histórico "antes (previsto)".
  // (A M.O. exibida é SEMPRE a planejada `maoObraDev` — ver comentário na linha M.O.)
  materiaisBase: number; custoPrevisto: number;
  // F3.2 — linhas "Custos do BOM" (mockup): null/ausente = não aparecem.
  custosBom?: CustosBomTabela | null;
  // Fix pós-rebase (item 7) — Σ dos custos adicionais do card: no ESTIMADO eles entram no custo total
  // (custo-base.ts `estimativaComCustosAdicionais`). Só é usado quando `custosBom` é null (sem a ficha — ex.: sem
  // `canView` do Dev): vira UMA linha só-leitura, p/ a tabela fechar. Com `custosBom`, as linhas editáveis já aparecem.
  custosAdicionaisSoma?: number;
  // faixas de M.O.
  linhaFaixas: { min: number | null; ideal: number | null; max: number | null } | null;
  moMin: { moMax: number; atingivel: boolean }; moIdeal: { moMax: number; atingivel: boolean }; moMax: { moMax: number; atingivel: boolean };
  moStatusFaixa: "no_maximo" | "no_ideal" | "no_minimo" | "acima" | "indef";
  // Fix round 4 (item 2) — o chamador (PlanejamentoDetail.tsx) manda `veCustos` aqui (união
  // `podeVerCustos` do Planejamento OU `ficha.podeVerCustos` do Desenvolvimento, decisão F3 #2):
  // gate da Parte 3 (M.O. por faixa, abaixo). O nome da prop ficou o mesmo p/ não quebrar a interface.
  podeVerCustos: boolean; podeEditarCustos: boolean; podeEditarPreco: boolean; markupFaixaOn: boolean;
  /** Integração (F4, D34) — SÓ o preço cujo campo está marcado trava (o banco recusa; aqui só desabilita). */
  travaPrecoVenda?: boolean; travaPrecoAnterior?: boolean;
  /** P-53 A (fix 1, I-1a) — Consumo de tecido/Materiais (estimativa) gravam em `custo_simulado`, campo SÓ
   *  do Planejamento (`CAMPOS_SO_PLANEJAMENTO_DRAFT`). Sem `podeEditarPlanejamento`, os 2 inputs travam
   *  (o Salvar já apagava o campo do payload em silêncio antes desta trava de UI). */
  planBloqueado: boolean;
  // F3.6 (Parte A — spec 2026-09-25 §5.1; R16): a Mão de obra deixa de ser seção — o MESMO MaoObraEditor (montado no
  // orquestrador, com o estado/aprovações de sempre) entra aqui por slot, logo abaixo da linha "Mão de obra"; a Obs. de MO
  // logo abaixo do "Custo total". null/ausente = sem permissão (`moBlocoVisivel`): a linha mostra só o total, como antes.
  blocoMaoObra?: ReactNode; obsMaoObra?: ReactNode;
}) {
  const { markupReal, precoSug, precoBase, precoDigitado, draftPrecoVenda, onPrecoVenda, podeEditarPreco,
    travaPrecoVenda = false, travaPrecoAnterior = false,
    precoAnterior, onPrecoAnterior,
    seloCusto, custoBase, consumo, consumoRealBOM, precoTecidoM, tecidoEstimado, aviamento, maoObraDev,
    onConsumo, onAviamento, materiaisBase, custoPrevisto, custosBom, custosAdicionaisSoma = 0,
    linhaFaixas, moMin, moIdeal, moMax, moStatusFaixa, podeVerCustos, podeEditarCustos, markupFaixaOn,
    blocoMaoObra, obsMaoObra, planBloqueado } = props;

  // Fix mobile (F3.3) — fade de rolagem do wrapper `overflow-x-auto` (achado 2). Mesma receita do
  // `SegmentedTabs` (§Q10): por lado, condicional ao scroll real (nunca incondicional — senão
  // "borra" a coluna Valores, que fica sticky do lado direito). Só a coluna Descrição rola por
  // trás da Valores sticky, então só o fade ESQUERDO faz sentido aqui (a Valores nunca some atrás
  // de si mesma); mede os dois por hábito/consistência com a receita, mas o direito nunca acende
  // (a última coluna de leitura real é a Obs, que fica atrás da Valores sticky e não "recebe" o
  // scroll — o scrollWidth do wrapper para na Valores).
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const medir = () => {
      setFade({
        left: el.scrollLeft > 4,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
      });
    };
    medir();
    el.addEventListener("scroll", medir);
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", medir);
      ro.disconnect();
    };
  }, []);

  // F3.2 (decisão F3 #6): o "Custo total" é o MESMO número que o markup usa (custo-base). Real → leitura do real;
  // previsto → materiais do BOM (leitura); estimado → a ESTIMATIVA editável de sempre.
  const custoReal = seloCusto === "real";
  const custoTotal = custoBase;
  const temCusto = custoTotal > 0;
  const seloBadge = seloCusto === "real"
    ? <StatusBadge tone="success">real</StatusBadge>
    : seloCusto === "previsto"
      ? <StatusBadge tone="info">previsto</StatusBadge>
      : <StatusBadge tone="warning">estimado</StatusBadge>;
  // Histórico 1 nível: quando o real assume e diverge do previsto salvo.
  const divergePrevisto = custoReal && custoPrevisto > 0 && Math.abs(custoPrevisto - custoBase) >= 0.01;
  // F3.2 — custos adicionais (linhas "Custos do BOM"): mesma edição do `ModeloCustosSection` do Dev (estado COMPLETO
  // do array a cada mudança; marca o campo como editado p/ o destaque do Importar).
  const linhasBom: [string, number][] = custosBom
    ? [["Tecido", custosBom.totais.tecido], ["Forro", custosBom.totais.forro], ["Entretela", custosBom.totais.entretela],
       ["Aviamento", custosBom.totais.aviamento], ["Insumos", custosBom.totais.etiqueta]]
    : [];
  const patchCusto = (i: number, p: Partial<CustoAdicional>) => {
    if (!custosBom) return;
    custosBom.onChange(custosBom.custosAdicionais.map((c, k) => (k === i ? { ...c, ...p } : c)));
    custosBom.onEditado("custos_adicionais");
  };
  const adicionarCusto = () => {
    if (!custosBom) return;
    custosBom.onChange([...custosBom.custosAdicionais, { descricao: "", valor: 0 }]);
    custosBom.onEditado("custos_adicionais");
  };
  const removerCusto = (i: number) => {
    if (!custosBom) return;
    custosBom.onChange(custosBom.custosAdicionais.filter((_, k) => k !== i));
    custosBom.onEditado("custos_adicionais");
  };
  const realceCopiado = custosBom ? classeCopiado(custosBom.copiados, "custos_adicionais") : "";
  // Rótulos descrevem a FAIXA alcançada (não julgam) — "só no mínimo" soava alarmante mesmo a 10
  // centavos do ideal (feedback do dono set/2026). `no_minimo` = M.O. entre o teto do ideal e o do
  // mínimo → "entre ideal e mínimo" (âmbar, ainda vende com margem, só não bate o ideal).
  const moBadge = precoBase <= 0 ? null
    : moStatusFaixa === "no_maximo" ? <StatusBadge tone="success">cabe no máximo</StatusBadge>
    : moStatusFaixa === "no_ideal" ? <StatusBadge tone="success">cabe no ideal</StatusBadge>
    : moStatusFaixa === "no_minimo" ? <StatusBadge tone="warning">entre ideal e mínimo</StatusBadge>
    : moStatusFaixa === "acima" ? <StatusBadge tone="danger">acima do limite</StatusBadge>
    : null;
  const temFaixas = !!linhaFaixas && (linhaFaixas.min != null || linhaFaixas.ideal != null || linhaFaixas.max != null);

  return (
    <div className="relative">
      <div ref={scrollRef} className="overflow-x-auto">
        <table className="w-full text-sm max-md:[&_tr>*:nth-child(3)]:sticky max-md:[&_tr>*:nth-child(3)]:right-0 max-md:[&_tr>*:nth-child(3)]:z-[1] max-md:[&_tr>*:nth-child(3)]:bg-background">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="py-1.5 pr-3 font-semibold">Descrição</th>
            <th className="py-1.5 px-2 text-right font-semibold">Markup</th>
            <th className="py-1.5 px-2 text-right font-semibold">Valores</th>
            <th className="py-1.5 pl-2 font-semibold">Obs</th>
          </tr>
        </thead>
        <tbody className="align-middle">
          {/* ── PARTE 1: Preços (digitáveis) ── */}
          <tr className="bg-muted/40"><td colSpan={4} className="py-1.5 px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Preços</td></tr>
          {/* F3.6 (ruling 11) — Preço anterior ANTES do Preço de venda. Automático (NULL): mostra o EFETIVO e acompanha ao vivo
              qualquer mudança do preço de venda; qualquer valor digitado FIXA (R5 — é o "congelar o preço atual"); ↺ volta ao
              automático. Sem a permissão: só leitura. */}
          <tr className="border-t">
            {/* mockup v3 (R34): o selo "automático" (ou "editado") mora na 1ª coluna, junto do rótulo; o ↺ vem ANTES do input. */}
            <td className="py-2 pr-3">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                Preço anterior
                <StatusBadge tone={precoAnterior === null ? "neutral" : "info"} className="rounded-full px-2 py-0.5 normal-case tracking-normal">
                  {precoAnterior === null ? "automático" : "editado"}
                </StatusBadge>
                {/* Ruling da revisão (Task 21): travado + automático — o valor continua acompanhando o preço de
                    venda mesmo com o campo travado pela Integração (usePlanejamentoSave.ts omite a coluna). */}
                {travaPrecoAnterior && precoAnterior === null && (
                  <InfoHover ariaLabel="Preço anterior travado pela Integração">
                    <p>Automático: acompanha o Preço de venda, mesmo travado pela Integração.</p>
                  </InfoHover>
                )}
              </span>
            </td>
            <td className="py-2 px-2 text-right text-muted-foreground">—</td>
            <td className="py-2 px-2 text-right">
              {podeEditarPreco && !travaPrecoAnterior ? (
                <span className="ml-auto inline-flex items-center justify-end gap-1">
                  {/* M3 (fix1) — 44px no celular, como a lixeira "Remover custo" logo abaixo (mesmo arquivo). */}
                  <Button type="button" variant="ghost" size="iconSm" className="text-muted-foreground max-sm:h-11 max-sm:w-11" disabled={precoAnterior === null}
                    aria-label="Preço anterior: voltar ao automático" title="Voltar ao automático" onClick={() => onPrecoAnterior(null)}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <MoneyInput
                    fixedDecimals
                    aria-label="Preço anterior"
                    className="h-8 w-32 text-right tabular-nums"
                    value={precoAnteriorExibido(precoAnterior, precoBase) ?? ""}
                    placeholder="0,00"
                    data-colab-path="preco_anterior"
                    // M1 (fix1) — 0/negativo volta ao automático NA TELA (não só no payload): evita "editado · 0,00" e conflito falso.
                    onChange={(e) => onPrecoAnterior(precoAnteriorOuNull(e.target.value))}
                  />
                </span>
              ) : (
                <span className="tabular-nums">{(() => { const v = precoAnteriorExibido(precoAnterior, precoBase); return v != null ? brl(v) : "—"; })()}</span>
              )}
            </td>
            <td className="py-2 pl-2 text-xs text-muted-foreground">acompanha o preço de venda até ser editado · ↺ volta ao automático</td>
          </tr>
          <tr className="border-t">
            <td className="py-2 pr-3"><b>Preço de venda</b></td>
            <td className="py-2 px-2 text-right tabular-nums">{mkFmt(markupReal)}</td>
            <td className="py-2 px-2 text-right">
              {podeEditarPreco && !travaPrecoVenda ? (
                <MoneyInput
                  fixedDecimals
                  aria-label="Preço de venda"
                  className="ml-auto h-8 w-32 text-right tabular-nums"
                  value={draftPrecoVenda && draftPrecoVenda > 0 ? draftPrecoVenda : ""}
                  placeholder={precoSug > 0 ? brl(precoSug) : undefined}
                  data-colab-path="preco_venda"
                  onChange={(e) => onPrecoVenda(e.target.value)}
                />
              ) : (
                <span className="tabular-nums">{draftPrecoVenda && draftPrecoVenda > 0 ? brl(draftPrecoVenda) : precoSug > 0 ? brl(precoSug) : "—"}</span>
              )}
            </td>
            <td className="py-2 pl-2 text-xs text-muted-foreground">markup calculado: preço ÷ custo{precoSug > 0 ? ` · vazio usa o sugerido (${brl(precoSug)})` : ""}{!podeEditarPreco ? " · sem permissão para editar" : travaPrecoVenda ? " · travado pela Integração" : ""}</td>
          </tr>
          <tr className="border-t">
            <td className="py-2 pr-3">Consumo de tecido</td>
            <td className="py-2 px-2 text-right text-muted-foreground">—</td>
            <td className="py-2 px-2 text-right">
              {seloCusto !== "estimado" ? (
                <span className="tabular-nums">{consumoRealBOM > 0 ? `${fmtNum(consumoRealBOM)} m` : "—"}</span>
              ) : (
                <NumberInput
                  className="ml-auto h-8 w-28 text-right tabular-nums"
                  value={consumo ?? (consumoRealBOM > 0 ? consumoRealBOM : "")}
                  placeholder={consumoRealBOM > 0 ? fmtNum(consumoRealBOM) : "0"}
                  data-colab-path="consumo_tecido"
                  // P-53 A (fix 1, I-1a): grava em custo_simulado (SÓ do Planejamento) — fieldset não entra em
                  // <tbody>, trava por `disabled` como o resto do arquivo já faz (comentário ~:333).
                  disabled={planBloqueado}
                  onChange={(e) => onConsumo(e.target.value)}
                />
              )}
            </td>
            <td className="py-2 pl-2 text-xs text-muted-foreground">
              {precoTecidoM > 0 ? `× ${brl(precoTecidoM)}/m` : "sem tecido planejado"}{consumoRealBOM > 0 && consumo == null ? " · vem do Desenvolvimento" : ""}
            </td>
          </tr>

          {/* ── PARTE 3: M.O. por faixa (opt-in via Config markup_analise_faixa) — logo depois de Preços
              (pedido do dono 25/set: "deveria ficar junto de preços e custos"; ficava no fim da tabela,
              as linhas Ideal/Máximo atrás da barra de ações até rolar).
              Base = preço EFETIVO (`precoBase`): digitado se houver, senão o sugerido — honra o
              "vazio usa o sugerido" da Parte 1. Valor "—" numa linha = aquela FAIXA não tem markup
              cadastrado na Linha (Obs explica), não é falta de preço. */}
          {podeVerCustos && markupFaixaOn && temFaixas && (() => {
            const usandoSugerido = precoBase > 0 && precoDigitado <= 0;
            const linhaFaixa = (teto: number | null | undefined, mo: { moMax: number; atingivel: boolean }, semMarkupObs: string, comMarkupObs: string) => (
              <>
                <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{mkFmt(Number(teto) || 0)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{precoBase > 0 && mo.atingivel ? brl(mo.moMax) : "—"}</td>
                <td className="py-2 pl-2 text-xs text-muted-foreground">{!(Number(teto) > 0) ? semMarkupObs : comMarkupObs}</td>
              </>
            );
            return (
            <>
              <tr className="bg-muted/40"><td colSpan={4} className="py-1.5 px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Mão de obra <span className="normal-case font-normal tracking-normal">— quanto cabe p/ atingir o preço em cada faixa{usandoSugerido ? " (usando o sugerido)" : ""}</span></td></tr>
              <tr className="border-t"><td className="py-2 pr-3">Mínimo</td>{linhaFaixa(linhaFaixas?.min, moMin, "Linha sem markup mínimo cadastrado", "M.O. que ainda cabe no markup mínimo")}</tr>
              <tr className="border-t"><td className="py-2 pr-3">Ideal</td>{linhaFaixa(linhaFaixas?.ideal, moIdeal, "Linha sem markup ideal cadastrado", "no markup ideal (alvo)")}</tr>
              <tr className="border-t"><td className="py-2 pr-3">Máximo</td>{linhaFaixa(linhaFaixas?.max, moMax, "Linha sem markup máximo cadastrado", "no markup máximo (mais exigente)")}</tr>
              {precoBase <= 0 && (
                <tr className="border-t"><td colSpan={4} className="py-1.5 px-2 text-xs text-muted-foreground">Defina o custo e o markup da Linha (ou preencha o preço para venda) para ver a M.O. que cabe em cada faixa.</td></tr>
              )}
            </>
            );
          })()}

          {/* ── PARTE 2: Custos ── */}
          <tr className="bg-muted/40"><td colSpan={4} className="py-1.5 px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Custos</td></tr>
          {seloCusto === "real" ? (
            <tr className="border-t">
              <td className="py-2 pr-3 whitespace-nowrap">Materiais <span className="text-[11px] italic text-muted-foreground">tecido + aviamentos</span></td>
              <td className="py-2 px-2 text-right text-muted-foreground">—</td>
              <td className="py-2 px-2 text-right tabular-nums">{brl(materiaisBase)}</td>
              <td className="py-2 pl-2 text-xs text-muted-foreground">
                {seloBadge} do BOM
              </td>
            </tr>
          ) : seloCusto === "previsto" ? (
            // Com a ficha carregada, as linhas "Custos do BOM" (abaixo) já detalham os materiais — sem linha somada aqui.
            custosBom ? null : (
            <tr className="border-t">
              <td className="py-2 pr-3 whitespace-nowrap">Materiais <span className="text-[11px] italic text-muted-foreground">do BOM + custos adicionais</span></td>
              <td className="py-2 px-2 text-right text-muted-foreground">—</td>
              <td className="py-2 px-2 text-right tabular-nums">{brl(materiaisBase)}</td>
              <td className="py-2 pl-2 text-xs text-muted-foreground">{seloBadge} do BOM (Custo de 1 Peça)</td>
            </tr>
            )
          ) : (
            <>
              <tr className="border-t">
                <td className="py-2 pr-3">Tecido</td>
                <td className="py-2 px-2 text-right text-muted-foreground">—</td>
                <td className="py-2 px-2 text-right tabular-nums">{tecidoEstimado > 0 ? brl(tecidoEstimado) : "—"}</td>
                <td className="py-2 pl-2 text-xs text-muted-foreground">{seloBadge} consumo × preço/m</td>
              </tr>
              <tr className="border-t">
                <td className="py-2 pr-3 whitespace-nowrap">Materiais <span className="text-[11px] italic text-muted-foreground">aviamentos &amp; insumos</span></td>
                <td className="py-2 px-2 text-right text-muted-foreground">—</td>
                <td className="py-2 px-2 text-right">
                  <NumberInput
                    className="ml-auto h-8 w-28 text-right tabular-nums"
                    value={aviamento ?? ""}
                    placeholder="0,00"
                    data-colab-path="custo_aviamento"
                    // P-53 A (fix 1, I-1a): grava em custo_simulado (SÓ do Planejamento) — mesma trava do
                    // Consumo de tecido acima.
                    disabled={planBloqueado}
                    onChange={(e) => onAviamento(e.target.value)}
                  />
                </td>
                <td className="py-2 pl-2 text-xs text-muted-foreground">{seloBadge} estimativa (real vem do BOM ao cadastrar)</td>
              </tr>
            </>
          )}
          {/* F3.2 — custos do BOM como LINHAS da tabela (decisão F3 #2 + mockup Anotado, seção 10 — R9c). A trava é por
              `disabled` em cada input (um <fieldset> não pode ficar dentro de <tbody>); sem `editavel` somem os botões.
              Fix round 4 (item 4, m1) — as linhas do BOM (Tecido/Forro/…) seguem ESCONDIDAS no estimado: sem material no
              BOM elas são todas "—" (Σ=0) e o bloco "Tecido/Materiais" estimado acima já tem SEUS próprios inputs.
              Fix pós-rebase (item 7 — paridade com o Dev, onde os custos adicionais são lançados a qualquer momento): no
              estimado aparece SÓ a parte "Custos adicionais" (descrição + valor + "Adicionar custo", mesma trava
              `editavel`), e o valor ENTRA no custo total estimado (`estimativaComCustosAdicionais`, custo-base.ts) —
              a tabela fecha. Sem nada lançado e sem poder editar, o cabeçalho nem aparece. */}
          {custosBom && (seloCusto !== "estimado" || custosBom.editavel || custosBom.custosAdicionais.length > 0) && (
            <>
              {seloCusto !== "estimado" ? (
                <>
                  <tr className="bg-muted/40"><td colSpan={4} className="py-1.5 px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Custos do BOM <span className="normal-case font-normal tracking-normal">— previsto, do Desenvolvimento</span></td></tr>
                  {linhasBom.map(([rotulo, valor]) => (
                    <tr key={rotulo} className="border-t">
                      <td className="py-2 pr-3">{rotulo}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">—</td>
                      <td className="py-2 px-2 text-right tabular-nums">{valor > 0 ? brl(valor) : "—"}</td>
                      <td className="py-2 pl-2 text-xs text-muted-foreground">do BOM</td>
                    </tr>
                  ))}
                </>
              ) : (
                <tr className="bg-muted/40"><td colSpan={4} className="py-1.5 px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Custos adicionais <span className="normal-case font-normal tracking-normal">— por peça, entram no custo total estimado</span></td></tr>
              )}
              {custosBom.custosAdicionais.map((c, i) => (
                <tr key={`custo-adicional-${i}`} className={`border-t ${realceCopiado}`}>
                  <td className="py-2 pr-3">
                    <Input
                      className="h-8 w-full"
                      placeholder="Descrição do custo"
                      value={c.descricao}
                      disabled={!custosBom.editavel}
                      onChange={(e) => patchCusto(i, { descricao: e.target.value })}
                      data-colab-path={`custo-descricao:${c.descricao}`}
                    />
                  </td>
                  <td className="py-2 px-2 text-right text-muted-foreground">—</td>
                  <td className="py-2 px-2 text-right">
                    {/* Fix round 4 (item 5) — MoneyInput (§Q) no lugar do NumberInput: mesmo onChange (emite
                        string canônica, `Number(...)` continua gravando número); só o formato de exibição muda. */}
                    <MoneyInput
                      className="ml-auto h-8 w-28 text-right tabular-nums"
                      placeholder="0,00"
                      value={c.valor || ""}
                      disabled={!custosBom.editavel}
                      onChange={(e) => patchCusto(i, { valor: Number(e.target.value) || 0 })}
                      data-colab-path={`custo-valor:${c.descricao}`}
                    />
                  </td>
                  <td className="py-2 pl-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      custo adicional por peça
                      {custosBom.editavel && (
                        <Button type="button" variant="ghost" size="iconSm" className="text-muted-foreground max-sm:h-11 max-sm:w-11" aria-label="Remover custo" title="Remover" onClick={() => removerCusto(i)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
              {custosBom.editavel && (
                <tr className="border-t">
                  <td colSpan={4} className="py-1.5 px-2">
                    <button type="button" onClick={adicionarCusto} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline max-sm:min-h-11">
                      <Plus className="h-3.5 w-3.5" /> Adicionar custo
                    </button>
                  </td>
                </tr>
              )}
            </>
          )}
          {/* Fix pós-rebase (item 7) — estimado SEM a ficha (`custosBom` null — ex.: sem `canView` do Dev) com custos
              adicionais já lançados no Dev: eles entram no custo total estimado mesmo assim, então aparecem numa linha
              só-leitura (Σ) p/ a tabela fechar. Editar continua sendo na ficha/no Dev. */}
          {!custosBom && seloCusto === "estimado" && custosAdicionaisSoma > 0 && (
            <tr className="border-t">
              <td className="py-2 pr-3">Custos adicionais</td>
              <td className="py-2 px-2 text-right text-muted-foreground">—</td>
              <td className="py-2 px-2 text-right tabular-nums">{brl(custosAdicionaisSoma)}</td>
              <td className="py-2 pl-2 text-xs text-muted-foreground">{seloBadge} por peça, do Desenvolvimento</td>
            </tr>
          )}
          <tr className="border-t">
            <td className="py-2 pr-3">Mão de obra</td>
            <td className="py-2 px-2 text-right text-muted-foreground">—</td>
            {/* SEMPRE a M.O. PLANEJADA (Σ modelo_servico_mo = maoObraDev), nunca a `mao_obra_real`
                — essa zera quando a M.O. é toda INTERNA (modelo confirmado) e daria "R$ 0,00"
                enganoso (bug que o dono já pegou; ver invariante #8 + project_custo_calculo_bugs).
                Por isso Materiais + M.O. NÃO fecham necessariamente com o Custo total (bases
                diferentes) — sem operador +/= aqui de propósito. */}
            <td className="py-2 px-2 text-right tabular-nums">{maoObraDev > 0 ? brl(maoObraDev) : "—"}</td>
            <td className="py-2 pl-2 text-xs text-muted-foreground">{moBadge ?? <span>{blocoMaoObra ? "serviços logo abaixo" : "—"}</span>}</td>
          </tr>
          {/* F3.6 — serviços de M.O. (valor, aprovar/reprovar p/ quem tem permissão, remover, "+ adicionar") DENTRO da tabela.
              Célula única (colSpan): um <fieldset>/lista não cabe em <tbody>; a trava é por `disabled` em cada controle, como
              nas linhas do BOM. No mobile a tabela rola na horizontal — o bloco fica PRESO à esquerda com a largura visível:
              <640px o Sheet é tela cheia (`100vw-4rem`, `px-6`+`px-2` da célula); 640–767px o Sheet é `sm:w-[70vw]`
              (`70vw-4rem`, mesmo `px-6`+`px-2`) — senão os botões de aprovar ficariam fora da tela. */}
          {blocoMaoObra && (
            <tr className="border-t">
              <td colSpan={4} className="py-2 px-2">
                <div className="max-md:sticky max-md:left-0 max-sm:w-[calc(100vw-4rem)] sm:max-md:w-[calc(70vw-4rem)]">{blocoMaoObra}</div>
              </td>
            </tr>
          )}
          <tr className="border-t font-semibold">
            <td className="py-2 pr-3">Custo total</td>
            <td className="py-2 px-2 text-right text-muted-foreground">—</td>
            <td className="py-2 px-2 text-right tabular-nums">{temCusto ? brl(custoTotal) : "—"}</td>
            <td className="py-2 pl-2 text-xs text-muted-foreground font-normal">
              {seloBadge}{divergePrevisto ? <span className="ml-1">· antes (previsto): {brl(custoPrevisto)}</span> : null}
            </td>
          </tr>
          {obsMaoObra && (
            <tr className="border-t">
              <td colSpan={4} className="py-2 px-2">
                <div className="max-md:sticky max-md:left-0 max-sm:w-[calc(100vw-4rem)] sm:max-md:w-[calc(70vw-4rem)]">{obsMaoObra}</div>
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div>
      {/* Fade condicional ao scroll real (§Q10, mesma receita do `SegmentedTabs`) — nunca
          incondicional. Em ≥768px a tabela não estoura o wrapper (achado 2 do laudo: 4/4 colunas
          cabem), então `scrollLeft`/`scrollWidth` nunca divergem e os dois ficam sempre `false`
          sozinhos — sem precisar de `max-md:` aqui. A coluna Valores fica sticky à direita, então
          só o fade ESQUERDO tem conteúdo pra anunciar na prática (Descrição rolando por baixo);
          o direito fica pela paridade com a receita, caso uma tela maior de leitura precise dele. */}
      {fade.left && (
        <div className="pointer-events-none absolute inset-y-0 left-0 z-[2] w-8 bg-gradient-to-r from-background to-transparent" />
      )}
      {fade.right && (
        <div className="pointer-events-none absolute inset-y-0 right-8 z-[2] w-8 bg-gradient-to-l from-background to-transparent" />
      )}
    </div>
  );
}
