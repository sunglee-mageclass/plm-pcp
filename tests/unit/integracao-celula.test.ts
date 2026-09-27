import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CAMPO_BY_KEY } from "@/lib/integracao/campos";
import { lerLista } from "@/lib/integracao/produtos";
import { TEXTO_TRAVADO_INTEGRADO, TEXTO_TRAVADO_INTEGRAVEL, infoEdicao, modoCelula } from "@/lib/integracao/celula";

const g = (ok: boolean, motivo: string | null = null) => ({ ok, motivo });
const p = (o: Record<string, unknown> = {}) => lerLista({ campos: [], produtos: [{ modelo_id: "m1", origem: "interno",
  estado: "nao_integravel", rev: 1, raw: { nome: "X", tamanho_tipo: "letra" },
  gates: { compartilhado: g(true), planejamento: g(true), preco: g(false, "Precisa da permissão de preço de venda."),
    ref: g(false, "REF travada pelo envio à Explosão — não pode mudar depois desse ponto."), sku: g(true), keywords: g(true) }, ...o }] }).produtos[0];
const c = (k: string) => CAMPO_BY_KEY.get(k as never)!;

describe("modoCelula — quem decide editar × ler", () => {
  it("gate do servidor aberto = edita; fechado = lê com o motivo do card", () => {
    expect(modoCelula(c("peso"), p(), false)).toEqual({ tipo: "editar" });
    expect(modoCelula(c("preco_venda"), p(), false)).toEqual({ tipo: "leitura", motivo: "Precisa da permissão de preço de venda.", travado: false });
    expect(modoCelula(c("ref_sku"), p(), false)).toMatchObject({ tipo: "leitura", motivo: "REF travada pelo envio à Explosão — não pode mudar depois desse ponto." });
  });
  it("custo/cor/tamanho, metatag e keywords nunca editam na célula (P-80 A; Keywords = diálogo)", () => {
    for (const k of ["preco_custo", "cor_base", "cor_apelido", "tamanho", "metatag", "keywords"]) {
      expect(modoCelula(c(k), p(), false).tipo, k).toBe("leitura");
    }
  });
  it("integrável/integrado = travado (cadeado), qualquer campo", () => {
    expect(modoCelula(c("nome"), p({ estado: "integravel" }), false)).toEqual({ tipo: "leitura", motivo: TEXTO_TRAVADO_INTEGRAVEL, travado: true });
    expect(modoCelula(c("nome"), p({ estado: "integrado" }), false)).toEqual({ tipo: "leitura", motivo: TEXTO_TRAVADO_INTEGRADO, travado: true });
  });
  it("salvando = nada edita", () => {
    expect(modoCelula(c("peso"), p(), true)).toEqual({ tipo: "leitura", motivo: "Salvando…", travado: false });
  });
  it("informação de quem edita (textos do mockup)", () => {
    expect(infoEdicao(c("ref_sku"), p({ origem: "revenda" }))).toBe("REF da revenda: nasce no cadastro do Produto Acabado; editar aqui muda nos dois lugares (mão dupla).");
    expect(infoEdicao(c("preco_venda"), p({ origem: "revenda" }))).toBe('Grava como preço FIXO de revenda (mesma regra do card — "última edição manda").');
    expect(infoEdicao(c("ref_sku"), p())).toBe("REF manual liberada (etapa já revela a REF neste card) — editar aqui edita o card também.");
    expect(infoEdicao(c("peso"), p())).toBeNull();
  });
  // Fix round 1 — Minor 5/M10 (task-12a-review.md + task-12a-code-review.md): casos que faltavam na suíte.
  it("Minor 5/M10: gate ilegível (formato inesperado) vira leitura com o motivo fail-closed", () => {
    const prod = p({ gates: { compartilhado: g(true), planejamento: g(true), preco: "formato-errado", ref: g(true), sku: g(true), keywords: g(true) } });
    const modo = modoCelula(c("preco_venda"), prod, false);
    expect(modo.tipo).toBe("leitura");
    expect((modo as { motivo: string }).motivo).toMatch(/não foi possível ler a permissão/i);
  });
  it("Minor 5/M10: gate FECHADO vence 'salvando' (o motivo real aparece, não 'Salvando…')", () => {
    expect(modoCelula(c("preco_venda"), p(), true)).toEqual({ tipo: "leitura", motivo: "Precisa da permissão de preço de venda.", travado: false });
  });
  it("Minor 5/M10: 'titulo' segue a mesma regra de campo com gate (planejamento)", () => {
    expect(modoCelula(c("titulo"), p(), false)).toEqual({ tipo: "editar" });
    expect(modoCelula(c("titulo"), p({ estado: "integravel" }), false)).toEqual({ tipo: "leitura", motivo: TEXTO_TRAVADO_INTEGRAVEL, travado: true });
  });
  it("Minor 5/M10: 'foto' tem gate compartilhado e infoEdicao própria", () => {
    expect(modoCelula(c("foto"), p(), false)).toEqual({ tipo: "editar" });
    expect(infoEdicao(c("foto"), p())).toBe("As fotos novas só sobem no Salvar da página.");
  });
  it("Minor 5/M10: infoEdicao cobre 'importado' (REF e preço de venda)", () => {
    expect(infoEdicao(c("ref_sku"), p({ origem: "importado" }))).toBe("REF do importado: nasce no cadastro do Produto Importado; editar aqui muda nos dois lugares (mão dupla).");
    expect(infoEdicao(c("preco_venda"), p({ origem: "importado" }))).toBe('Grava como preço FIXO do importado (mesma regra do card — "última edição manda").');
  });
});

describe("ruling P-99 A — Reprovado só afirma 'não vai para a API' quando integrável (Important 1/I2)", () => {
  it("lerLista preserva reprovado E estado juntos, para a UI decidir o texto do selo por estado", () => {
    const integravel = p({ estado: "integravel", reprovado: true });
    const integrado = p({ estado: "integrado", reprovado: true });
    expect(integravel.reprovado).toBe(true);
    expect(integravel.estado).toBe("integravel");
    expect(integrado.reprovado).toBe(true);
    expect(integrado.estado).toBe("integrado");
  });
});

// Fix round 1 — testes de INSPEÇÃO DE FONTE (sem harness de render de componente React neste repo; mesmo padrão de
// tests/unit/dev-sheet-oculto.test.ts): os componentes JSX (CelulaCampo/ProdutosTabela) não são unit-testados por
// render, então os pontos que os reviews pediram ficam garantidos por asserção sobre o texto-fonte.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CELULA_TSX = readFileSync(ROOT + "src/components/integracao/CelulaCampo.tsx", "utf8");
const TABELA_TSX = readFileSync(ROOT + "src/components/integracao/ProdutosTabela.tsx", "utf8");
const INFO_HOVER_TSX = readFileSync(ROOT + "src/components/shared/InfoHover.tsx", "utf8");

describe("Fix round 1 — InfoHover usa cn() (Important 2/I7: o 'i' âmbar não pode perder pra text-muted-foreground)", () => {
  it("importa cn de @/lib/utils e usa no className do botão (nunca concatenação de string crua)", () => {
    expect(INFO_HOVER_TSX).toMatch(/import \{ cn \} from "@\/lib\/utils";/);
    expect(INFO_HOVER_TSX).not.toMatch(/\$\{className \?\? ""\}/);
    expect(INFO_HOVER_TSX).toMatch(/className=\{cn\(/);
  });
  it("nenhum OUTRO consumidor de InfoHover passa className (a mudança não muda a saída deles)", () => {
    // grep amplo por todo o src: só CelulaCampo.tsx deve casar `InfoHover ... className=`.
    const consumidores = readFileSync(ROOT + "src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx", "utf8");
    expect(consumidores).not.toMatch(/<InfoHover[^>]*className=/);
    const direcionamento = readFileSync(ROOT + "src/routes/_authenticated/expedicao.direcionamento.$modeloId.tsx", "utf8");
    expect(direcionamento).not.toMatch(/<InfoHover[^>]*className=/);
  });
});

describe("Fix round 1 — Reprovado (Important 1/I2): o texto 'não vai para a API' só para integrável", () => {
  it("SeloReprovado condiciona o texto por p.estado==='integravel'", () => {
    expect(TABELA_TSX).toMatch(/p\.estado === "integravel"\s*\?\s*"Reprovado — não vai para a API"\s*:\s*"Reprovado"/);
  });
});

describe("Fix round 1 — SKU: desfazer + conflito de versão (Important 3/I4)", () => {
  it("importa manterMeu/semManual de sku-previa.ts (aliasados) — nenhuma reimplementação", () => {
    expect(CELULA_TSX).toMatch(/manterMeu as manterMeuSku, semManual as semManualSku/);
  });
  it("oferece as 3 ações: desfazer, manter o meu, usar o novo", () => {
    expect(CELULA_TSX).toMatch(/Desfazer o SKU digitado/);
    expect(CELULA_TSX).toMatch(/manter o meu/);
    expect(CELULA_TSX).toMatch(/usar o novo/);
  });
});

describe("Fix round 1 — Peso/medidas usam MoneyInput com casas fixas (Important I1)", () => {
  it("NÃO usa mais NumberInput para peso/medida", () => {
    expect(CELULA_TSX).not.toMatch(/import \{ NumberInput \}/);
  });
  it("MoneyInput com decimals 3 (peso) / 2 (medida) e fixedDecimals", () => {
    expect(CELULA_TSX).toMatch(/const casas = campo\.tipo === "peso" \? 3 : 2;/);
    expect(CELULA_TSX).toMatch(/decimals=\{casas\}/);
  });
});

describe("Fix round 1 — NCM usa filtrarNcm do card (Important I5)", () => {
  it("importa e aplica filtrarNcm no onChange do NCM", () => {
    expect(CELULA_TSX).toMatch(/import \{ filtrarNcm \} from "@\/components\/planejamento\/planejamento-detail\/helpers";/);
    expect(CELULA_TSX).toMatch(/filtrarNcm\(e\.target\.value\)/);
  });
});

describe("Fix round 1 — sublinhas por chave estável variante|tamanho (Important I6)", () => {
  it("ProdutosTabela chaveia <tr> por varianteKey|tamanhoKey, nunca por índice", () => {
    expect(TABELA_TSX).toMatch(/key=\{`\$\{p\.modeloId\}:\$\{l\.varianteKey\}\|\$\{l\.tamanhoKey\}`\}/);
  });
  it("o Input de SKU é CONTROLADO (nunca defaultValue)", () => {
    expect(CELULA_TSX).not.toMatch(/defaultValue=\{exibido\}/);
    expect(CELULA_TSX).toMatch(/value=\{texto \?\? exibido\}/);
  });
});

describe("Fix round 1 — edição pendente escondida por trava (Important I3)", () => {
  it("existe o componente LeituraComPendencia com ação 'descartar alteração'", () => {
    expect(CELULA_TSX).toMatch(/function LeituraComPendencia/);
    expect(CELULA_TSX).toMatch(/descartar alteração/);
  });
  it("o ramo de leitura verifica colunasAlteradas antes de cair no valor do servidor", () => {
    expect(CELULA_TSX).toMatch(/if \(pendente\) \{\s*return \(\s*<LeituraComPendencia/);
  });
});

describe("Fix round 1 — Keywords ignora o estado da linha (Minor 4)", () => {
  it("'pode' depende só do gate (g.ok) e de salvando, nunca de p.estado", () => {
    const inicio = CELULA_TSX.indexOf('if (campo.key === "keywords") {');
    expect(inicio).toBeGreaterThanOrEqual(0);
    const fim = CELULA_TSX.indexOf("\n  }", inicio);
    const corpo = CELULA_TSX.slice(inicio, fim);
    expect(corpo).toMatch(/const pode = g\.ok && !salvando;/);
    expect(corpo).not.toMatch(/p\.estado === "nao_integravel" && g\.ok/);
  });
});

describe("Fix round 1 — Acessibilidade: aria-label com campo + produto (Minor 8)", () => {
  it("SKU, Título e campos genéricos levam o nome do produto no aria-label", () => {
    expect(CELULA_TSX).toMatch(/aria-label=\{`SKU — \$\{p\.raw\.nome\}/);
    expect(CELULA_TSX).toMatch(/aria-label=\{`Título para a página — \$\{p\.raw\.nome\}`\}/);
    expect(CELULA_TSX).toMatch(/const ariaLabel = `\$\{campo\.rotulo\} — \$\{p\.raw\.nome\}`;/);
  });
  it("a seta de sublinhas leva aria-expanded", () => {
    expect(TABELA_TSX).toMatch(/aria-expanded=\{aberto\}/);
  });
});

describe("Fix round 1 — desempenho: linha memoizada (Minor 7/M7)", () => {
  it("ProdutosTabela usa React.memo na linha do produto", () => {
    expect(TABELA_TSX).toMatch(/const LinhaProduto = memo\(function LinhaProduto/);
  });
});
