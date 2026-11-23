import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { podeVerPrecoVarejo } from "@/lib/preco-permissao";

// Anti-drift (Task 3, decisão do dono 19/nov): a EXIBIÇÃO do preço de venda (varejo) usa a chave PRÓPRIA
// (`podeVerPrecoVarejo`), nunca `veCustos`/`podeVerCustos`. O CUSTO/estimativa continua em custos.
// Lista branca: no Sheet, `podeVerCustos` segue existindo para custo/estimativa (PrecoTabela :314/:324/:372) — por isso o teste
// só olha os TRECHOS de preço de cada tela (varejo), não o arquivo inteiro.
const ler = (p: string) => readFileSync(p, "utf8");
const trecho = (src: string, ini: string, fim: string) => {
  const a = src.indexOf(ini);
  expect(a, `âncora inicial ausente: ${ini}`).toBeGreaterThan(-1);
  const b = src.indexOf(fim, a + ini.length);
  expect(b, `âncora final ausente: ${fim}`).toBeGreaterThan(a);
  return src.slice(a, b);
};
const CITA_CUSTOS = /veCustos|podeVerCustos|podeVerCustosServidor|criacao_planejamento:custos|dashboard_custos/;

describe("exibição do preço de venda (varejo) usa a chave própria (não custos)", () => {
  it("o helper é importável e puro", () => {
    expect(typeof podeVerPrecoVarejo).toBe("function");
    expect(podeVerPrecoVarejo((k) => k === "criacao_planejamento:preco_venda")).toBe(true);
    // chave única (Leitor=ver): a antiga ver_preco_venda não existe mais e não dá ver-preço
    expect(podeVerPrecoVarejo((k) => k === "criacao_planejamento:ver_preco_venda")).toBe(false);
    // ortogonal a custos: ter custos NÃO dá ver-preço
    expect(podeVerPrecoVarejo((k) => k === "criacao_planejamento:custos")).toBe(false);
  });

  it("PlanejamentoDetail deriva veVarejo e passa à PrecoTabela como podeVerPreco (podeVerCustos fica só para custo)", () => {
    const src = ler("src/components/planejamento/PlanejamentoDetail.tsx");
    expect(src).toMatch(/@\/lib\/preco-permissao/);
    expect(src).toMatch(/const veVarejo = podeVerPrecoVarejo\(canView\)/);
    expect(src).toMatch(/podeVerPreco=\{veVarejo\}/);
    // a prop de custo continua existindo (custo/estimativa NÃO migram)
    expect(src).toMatch(/podeVerCustos=\{veCustos\} podeVerPreco=\{veVarejo\}/);
    // veVarejo NÃO deriva de custos
    expect(src).not.toMatch(/const veVarejo =[^\n]*(veCustos|podeVerCustos)/);
  });

  it("PrecoTabela tem a prop podeVerPreco separada de podeVerCustos, e as linhas de preço não citam custos", () => {
    const src = ler("src/components/planejamento/planejamento-detail/PrecoTabela.tsx");
    expect(src).toMatch(/podeVerPreco:\s*boolean/);
    expect(src).toMatch(/podeVerCustos:\s*boolean/);
    // linhas "Preço anterior" + "Preço de venda" (do início da PARTE 1 até o "Consumo de tecido"): só podeVerPreco decide ver o valor
    const linhasPreco = trecho(src, "PARTE 1: Preços", "Consumo de tecido");
    expect(linhasPreco).toMatch(/podeVerPreco/);
    expect(linhasPreco).not.toMatch(CITA_CUSTOS);
    // o custo/estimativa FICA em podeVerCustos
    expect(src).toMatch(/podeVerCustos \? `× \$\{brl\(precoTecidoM\)\}\/m`/);
    expect(src).toMatch(/podeVerCustos && markupFaixaOn && temFaixas/);
    expect(src).toMatch(/podeVerCustos && tecidoEstimado > 0/);
  });

  it("Plan. Tecido CustoSection gate o preço de venda (card e vaga) por podeVerPrecoVarejo, sem citar custos", () => {
    const src = ler("src/components/plan-tecido/CustoSection.tsx");
    expect(src).toMatch(/@\/lib\/preco-permissao/);
    expect(src).toMatch(/podeVerPrecoVarejo\(canView\)/);
    expect(src).toMatch(/label="Preço p\/ venda \(do card\)" value=\{veVarejo \?/);
    expect(src).toMatch(/!veVarejo \? <div className="col-span-2"><RO label="Preço p\/ venda" value="—" \/>/);
    expect(src).not.toMatch(CITA_CUSTOS);
    // "Preço sugerido" é DERIVADO de custo e NÃO migra: nenhum dos dois é gated por veVarejo
    expect(src).toMatch(/<RO label="Preço sugerido \(do card\)" value=\{txt\(pc\?\.sugerido, brl\)\} \/>/);
    expect(src).toMatch(/<RO label="Preço sugerido" value=\{pi\.sugerido > 0 \? brl\(pi\.sugerido\) : "—"\} \/>/);
  });

  it("Dashboard Comercial gate só a EXIBIÇÃO por podeVerPrecoVarejo; o cálculo (agregarComercial) roda igual", () => {
    const src = ler("src/routes/_authenticated/dashboard.tsx");
    expect(src).toMatch(/@\/lib\/preco-permissao/);
    const aba = trecho(src, "function ComercialColecaoTab()", "LEADTIME");
    expect(aba).toMatch(/const veVarejo = podeVerPrecoVarejo\(canView\)/);
    expect(aba).not.toMatch(CITA_CUSTOS);
    // exibição: KPIs, "Poder de venda por linha", "Margem por linha" e a tabela só renderizam com veVarejo (desktop e mobile)
    expect((aba.match(/!veVarejo \? avisoSemPreco/g) ?? []).length).toBe(2);
    // cálculo intocado: o agregado roda incondicional e NADA de veVarejo aparece antes dele
    const idxAgg = aba.indexOf("agregarComercial(modelos, custoMap as any, gradePlan, gradeReal)");
    expect(idxAgg).toBeGreaterThan(-1);
    const antes = aba.slice(0, idxAgg);
    expect((antes.match(/veVarejo/g) ?? []).length).toBe(1); // só a declaração
    expect(antes).toMatch(/useMemo\(\s*\(\) =>\s*$/);
    // as queries de dados não ganharam `enabled: veVarejo`
    expect(aba).not.toMatch(/enabled:[^\n]*veVarejo/);
  });

  it("Integração CelulaCampo NÃO entra (preco_venda é insumo do placeholder do preço anterior)", () => {
    const src = ler("src/lib/integracao/trava.ts");
    expect(src).not.toMatch(/podeVerPrecoVarejo/);
  });
});
