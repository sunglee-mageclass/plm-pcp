import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { precoAnteriorExibido, precoAnteriorOuNull } from "@/components/planejamento/planejamento-detail/helpers";

// F3.6 (Parte B — ruling 11): "Preço anterior" ANTES do "Preço de venda"; NULL = acompanha o preço EFETIVO; editado = fixo até
// o ↺; editar = a permissão do preço de venda. Revenda: acompanha o VAREJO. Gates de FONTE + a regra pura.
const fonte = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
const PT = "src/components/planejamento/planejamento-detail/PrecoTabela.tsx";
const RS = "src/components/planejamento/planejamento-detail/RevendaSetores.tsx";
const PD = "src/components/planejamento/PlanejamentoDetail.tsx";

describe("Preço anterior (regra)", () => {
  it("automático = o preço efetivo, ao vivo; editado = fixo; efetivo 0 = vazio", () => {
    expect(precoAnteriorExibido(null, 289.9)).toBe(289.9);
    expect(precoAnteriorExibido(null, 310)).toBe(310); // o preço de venda mudou ⇒ o automático acompanha
    expect(precoAnteriorExibido(250, 310)).toBe(250);
    expect(precoAnteriorExibido(null, 0)).toBeNull();
  });
});

// M1 (fix1, revisão Opus do Lote B1): o onChange dos 2 inputs passou de `"" ? null : Number(v)` para
// `onPrecoAnterior(precoAnteriorOuNull(v))` — digitar 0 (ou negativo) tem que voltar ao automático NA TELA (não só
// no payload do Salvar), senão o selo ficava "editado · 0,00" e um refetch comparava base≠fresh à toa (conflito falso).
describe("Preço anterior (M1 — onChange normaliza 0/negativo para automático)", () => {
  it("precoAnteriorOuNull: '' e '0' e negativo viram NULL (automático); valor válido passa", () => {
    expect(precoAnteriorOuNull("")).toBeNull();
    expect(precoAnteriorOuNull("0")).toBeNull();
    expect(precoAnteriorOuNull("-10")).toBeNull();
    expect(precoAnteriorOuNull("199.9")).toBe(199.9);
  });
});

describe("Preço anterior (fonte)", () => {
  it("PrecoTabela: linha ANTES de 'Preço de venda', selo automático/editado na 1ª coluna, ↺ ANTES do input (mockup — R34), permissão e o obs", () => {
    const s = fonte(PT);
    const iAnt = s.indexOf("{/* F3.6 (ruling 11) — Preço anterior ANTES do Preço de venda.");
    const iVenda = s.indexOf("<b>Preço de venda</b>");
    expect(iAnt).toBeGreaterThan(s.indexOf(">Preços</td>"));
    expect(iVenda).toBeGreaterThan(iAnt);
    const linha = s.slice(iAnt, iVenda);
    expect(linha).toContain('data-colab-path="preco_anterior"');
    expect(linha).toContain("precoAnteriorExibido(precoAnterior, precoBase)");
    expect(linha).toContain("podeEditarPreco && !travaPrecoAnterior ?");
    expect(linha).toContain('aria-label="Preço anterior: voltar ao automático"');
    expect(linha).toContain("acompanha o preço de venda até ser editado · ↺ volta ao automático");
    const iSelo = linha.indexOf('{precoAnterior === null ? "automático" : "editado"}');
    expect(iSelo).toBeGreaterThan(0);
    expect(linha.indexOf('aria-label="Preço anterior: voltar ao automático"')).toBeGreaterThan(iSelo);
    expect(linha.indexOf('aria-label="Preço anterior: voltar ao automático"')).toBeLessThan(linha.indexOf('data-colab-path="preco_anterior"'));
    // M1 (fix1) — onChange normaliza pela regra pura (0/negativo → automático NA TELA), não `"" ? null : Number(v)`.
    expect(linha).toContain("onPrecoAnterior(precoAnteriorOuNull(e.target.value))");
    // M3 (fix1) — ↺ com alvo de toque 44px no celular, como a lixeira "Remover custo" do mesmo arquivo.
    expect(linha).toContain("max-sm:h-11 max-sm:w-11");
    // M4 (fix1) — aria-label no MoneyInput (o rótulo textual "Preço anterior" já está na célula; reforça o input).
    expect(linha).toContain('aria-label="Preço anterior"');
  });
  it("PrecoTabela: 'Preço de venda' também ganhou aria-label (M4, fix1 — trivial no mesmo arquivo)", () => {
    const s = fonte(PT);
    const iVenda = s.indexOf("<b>Preço de venda</b>");
    const iProxTr = s.indexOf("</tr>", iVenda);
    expect(s.slice(iVenda, iProxTr)).toContain('aria-label="Preço de venda"');
  });
  it("Revenda: o campo vem DEPOIS dos Markups (Step 4.3 do brief), ANTES do par atacado/varejo, acompanha o VAREJO efetivo; selo junto do rótulo e ↺ ANTES do input", () => {
    const s = fonte(RS);
    const iAnt = s.indexOf('data-colab-path="preco_anterior"');
    expect(iAnt).toBeGreaterThan(0);
    // M2 (fix1) — posição do brief: DEPOIS de "Markup varejo" (o 2º dos markups), ANTES de "Preço atacado".
    const iMarkupVarejo = s.indexOf("<Label>Markup varejo</Label>");
    expect(iMarkupVarejo).toBeGreaterThan(0);
    expect(iAnt).toBeGreaterThan(iMarkupVarejo);
    expect(s.indexOf("<Label>Preço atacado</Label>")).toBeGreaterThan(iAnt);
    expect(s).toContain("precoAnteriorExibido(precoAnterior, piRevenda.efetivo)");
    const iBotao = s.indexOf('aria-label="Preço anterior: voltar ao automático"');
    expect(iBotao).toBeGreaterThan(s.indexOf('{precoAnterior === null ? "automático" : "editado"}'));
    expect(iBotao).toBeLessThan(iAnt);
    // M1 (fix1) — mesmo fix de onChange no bloco da revenda.
    expect(s).toContain("onPrecoAnterior(precoAnteriorOuNull(e.target.value))");
    // M3 (fix1) — ↺ 44px no celular.
    const linha = s.slice(iBotao - 400, iAnt + 200);
    expect(linha).toContain("max-sm:h-11 max-sm:w-11");
    // M4 (fix1) — aria-label no MoneyInput da revenda.
    expect(s).toContain('aria-label="Preço anterior"');
  });
  it("o orquestrador liga o Draft nos DOIS blocos", () => {
    const s = fonte(PD);
    expect(s.split("precoAnterior={draft.preco_anterior}").length - 1).toBe(2);
    expect(s.split("onPrecoAnterior={(v) => setDraftTracked((d) => ({ ...d, preco_anterior: v }))}").length - 1).toBe(2);
    expect(s).toMatch(/<PrecoRevendaBloco[\s\S]*?podeEditarPreco=\{podeEditarPreco\}/);
  });
});
