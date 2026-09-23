// Tabela da seção "Preço" do detalhe do Planejamento (card manufaturado). Extraída na F3.0
// (set/2026) de `PlanejamentoDetail.tsx` SEM mudança de comportamento: texto MOVIDO como estava
// (só ganhou `export`). Só props — nenhum estado, query ou chamada ao banco aqui.
import { StatusBadge } from "@/components/shared/StatusBadge";
import { NumberInput } from "@/components/shared/NumberInput";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { brl, fmtNum } from "@/lib/format";

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
  // custo: real (BOM confirmado) OU estimado (tecido + aviamento + M.O.). Selo previsto/real por modelo.
  custoReal: boolean;
  // estimado (editável): consumo de tecido × preço/m + aviamento manual + M.O. (dev)
  consumo: number | null; consumoRealBOM: number; precoTecidoM: number; tecidoEstimado: number;
  aviamento: number | null; maoObraDev: number; custoEstimado: number;
  onConsumo: (v: string) => void; onAviamento: (v: string) => void;
  // real (BOM): materiais reais + total real; e o previsto p/ o histórico. (A M.O. exibida é
  // SEMPRE a planejada `maoObraDev` — ver comentário na linha M.O. —, então não recebe a real.)
  materiaisReal: number; custoRealTotal: number; custoPrevisto: number;
  // faixas de M.O.
  linhaFaixas: { min: number | null; ideal: number | null; max: number | null } | null;
  moMin: { moMax: number; atingivel: boolean }; moIdeal: { moMax: number; atingivel: boolean }; moMax: { moMax: number; atingivel: boolean };
  moStatusFaixa: "no_maximo" | "no_ideal" | "no_minimo" | "acima" | "indef";
  podeVerCustos: boolean; podeEditarCustos: boolean; podeEditarPreco: boolean; markupFaixaOn: boolean;
  onVerDev?: () => void;
}) {
  const { markupReal, precoSug, precoBase, precoDigitado, draftPrecoVenda, onPrecoVenda, podeEditarPreco,
    custoReal, consumo, consumoRealBOM, precoTecidoM, tecidoEstimado, aviamento, maoObraDev, custoEstimado,
    onConsumo, onAviamento, materiaisReal, custoRealTotal, custoPrevisto,
    linhaFaixas, moMin, moIdeal, moMax, moStatusFaixa, podeVerCustos, podeEditarCustos, markupFaixaOn, onVerDev } = props;

  // Quando confirmado (real), as linhas de custo mostram o REAL do BOM (leitura). Enquanto não,
  // mostram a ESTIMATIVA editável (tecido calculado + aviamento manual + M.O.). Selo por modelo.
  const custoTotal = custoReal ? custoRealTotal : custoEstimado;
  const temCusto = custoTotal > 0;
  const seloCusto = custoReal
    ? <StatusBadge tone="success">real</StatusBadge>
    : <StatusBadge tone="warning">estimado</StatusBadge>;
  // Histórico 1 nível: quando o real assume e diverge do previsto/estimado.
  const divergePrevisto = custoReal && custoPrevisto > 0 && Math.abs(custoPrevisto - custoRealTotal) >= 0.01;
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
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
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
          <tr className="border-t">
            <td className="py-2 pr-3"><b>Preço de venda</b></td>
            <td className="py-2 px-2 text-right tabular-nums">{mkFmt(markupReal)}</td>
            <td className="py-2 px-2 text-right">
              {podeEditarPreco ? (
                <MoneyInput
                  fixedDecimals
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
            <td className="py-2 pl-2 text-xs text-muted-foreground">markup calculado: preço ÷ custo{precoSug > 0 ? ` · vazio usa o sugerido (${brl(precoSug)})` : ""}{!podeEditarPreco ? " · sem permissão para editar" : ""}</td>
          </tr>
          <tr className="border-t">
            <td className="py-2 pr-3">Consumo de tecido</td>
            <td className="py-2 px-2 text-right text-muted-foreground">—</td>
            <td className="py-2 px-2 text-right">
              {custoReal ? (
                <span className="tabular-nums">{consumoRealBOM > 0 ? `${fmtNum(consumoRealBOM)} m` : "—"}</span>
              ) : (
                <NumberInput
                  className="ml-auto h-8 w-28 text-right tabular-nums"
                  value={consumo ?? (consumoRealBOM > 0 ? consumoRealBOM : "")}
                  placeholder={consumoRealBOM > 0 ? fmtNum(consumoRealBOM) : "0"}
                  data-colab-path="consumo_tecido"
                  onChange={(e) => onConsumo(e.target.value)}
                />
              )}
            </td>
            <td className="py-2 pl-2 text-xs text-muted-foreground">
              {precoTecidoM > 0 ? `× ${brl(precoTecidoM)}/m` : "sem tecido planejado"}{consumoRealBOM > 0 && consumo == null ? " · vem do Desenvolvimento" : ""}
            </td>
          </tr>

          {/* ── PARTE 2: Custos ── */}
          <tr className="bg-muted/40"><td colSpan={4} className="py-1.5 px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Custos</td></tr>
          {custoReal ? (
            <tr className="border-t">
              <td className="py-2 pr-3 whitespace-nowrap">Materiais <span className="text-[11px] italic text-muted-foreground">tecido + aviamentos</span></td>
              <td className="py-2 px-2 text-right text-muted-foreground">—</td>
              <td className="py-2 px-2 text-right tabular-nums">{brl(materiaisReal)}</td>
              <td className="py-2 pl-2 text-xs text-muted-foreground">
                {seloCusto} {onVerDev ? <button type="button" onClick={onVerDev} className="text-primary hover:underline">ver no Desenvolvimento ⧉</button> : "do BOM"}
              </td>
            </tr>
          ) : (
            <>
              <tr className="border-t">
                <td className="py-2 pr-3">Tecido</td>
                <td className="py-2 px-2 text-right text-muted-foreground">—</td>
                <td className="py-2 px-2 text-right tabular-nums">{tecidoEstimado > 0 ? brl(tecidoEstimado) : "—"}</td>
                <td className="py-2 pl-2 text-xs text-muted-foreground">{seloCusto} consumo × preço/m</td>
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
                    onChange={(e) => onAviamento(e.target.value)}
                  />
                </td>
                <td className="py-2 pl-2 text-xs text-muted-foreground">{seloCusto} estimativa (real vem do BOM ao cadastrar)</td>
              </tr>
            </>
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
            <td className="py-2 pl-2 text-xs text-muted-foreground">{moBadge ?? <span>na seção Mão de obra abaixo</span>}</td>
          </tr>
          <tr className="border-t font-semibold">
            <td className="py-2 pr-3">Custo total</td>
            <td className="py-2 px-2 text-right text-muted-foreground">—</td>
            <td className="py-2 px-2 text-right tabular-nums">{temCusto ? brl(custoTotal) : "—"}</td>
            <td className="py-2 pl-2 text-xs text-muted-foreground font-normal">
              {seloCusto}{divergePrevisto ? <span className="ml-1">· antes (previsto): {brl(custoPrevisto)}</span> : null}
            </td>
          </tr>

          {/* ── PARTE 3: M.O. por faixa (opt-in via Config markup_analise_faixa) ──
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
        </tbody>
      </table>
    </div>
  );
}
