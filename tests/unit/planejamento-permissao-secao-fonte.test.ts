import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DETALHE = readFileSync(ROOT + "src/components/planejamento/PlanejamentoDetail.tsx", "utf8");
const SAVE = readFileSync(ROOT + "src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts", "utf8");
const INFO_GERAIS = readFileSync(ROOT + "src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx", "utf8");
const REVENDA_SETORES = readFileSync(ROOT + "src/components/planejamento/planejamento-detail/RevendaSetores.tsx", "utf8");
const PRECO_TABELA = readFileSync(ROOT + "src/components/planejamento/planejamento-detail/PrecoTabela.tsx", "utf8");
const MENU_MAIS_ACOES = readFileSync(ROOT + "src/components/planejamento/planejamento-detail/MenuMaisAcoes.tsx", "utf8");

describe("Sheet do Planejamento trava POR SEÇÃO pelas 2 permissões (P-53 A) — testes de fonte", () => {
  it("PlanejamentoDetail chama resolverPermissoesSheet", () => {
    expect(DETALHE).toMatch(/resolverPermissoesSheet\(/);
  });

  it("o Sheet (card existente) e o Dialog (card novo) usam ReadOnlyScope, sem herdar a trava da página", () => {
    expect(DETALHE).toMatch(/<ReadOnlyScope\s+value=\{perm\.sheetSomenteLeitura\}>/);
    expect(DETALHE).toMatch(/<ReadOnlyScope\s+value=\{!podeEditarPlanejamento\}>/);
  });

  // Fix 1 (m-6ii) — UMA regex ancorada por ação de ciclo do Planejamento, não uma contagem solta.
  it("Excluir exige perm.podeAcoesPlanejamento", () => {
    expect(DETALHE).toMatch(/\{isEdit && perm\.podeAcoesPlanejamento && \(/);
  });
  it("Duplicar exige perm.podeAcoesPlanejamento (onDuplicar vira undefined sem a permissão)", () => {
    expect(DETALHE).toMatch(/onDuplicar=\{perm\.podeAcoesPlanejamento \? handleDuplicate : undefined\}/);
  });
  it("Enviar Ordem de Criação exige perm.podeAcoesPlanejamento", () => {
    expect(DETALHE).toMatch(/\{isEdit && !enviada && perm\.podeAcoesPlanejamento && \(/);
  });
  it("Cancelar Ordem de Criação exige perm.podeAcoesPlanejamento", () => {
    expect(DETALHE).toMatch(/onCancelarOrdem=\{perm\.podeAcoesPlanejamento && enviada && !enviadoCad/);
  });
  it("Lançar/Cancelar Lançamento exige perm.podeAcoesPlanejamento", () => {
    expect(DETALHE).toMatch(/\{perm\.podeAcoesPlanejamento && \(lancado \?/);
  });
  it("Produto Relacionado (adicionar/remover) exige perm.podeAcoesPlanejamento", () => {
    expect(DETALHE).toMatch(/<fieldset disabled=\{!perm\.podeAcoesPlanejamento\} className="contents">\s*<ProdutoRelacionadoSetor/);
  });
  it("Criar produto acabado exige podeAcoesPlanejamento (prop passada + botão gated no componente)", () => {
    expect(DETALHE).toMatch(/<ProdutoAcabadoSecao[\s\S]*?podeAcoesPlanejamento=\{perm\.podeAcoesPlanejamento\}[\s\S]*?\/>/);
    expect(REVENDA_SETORES).toMatch(/\{podeAcoesPlanejamento && \(\s*<Button/);
  });

  it("usePlanejamentoSave chama aplicarRegrasCamposPlanejamento", () => {
    expect(SAVE).toMatch(/aplicarRegrasCamposPlanejamento\(/);
  });

  // Fix 1 (m-1) — espelho automático de Produto Acabado/Importado só com podeEditarPlanejamento.
  it("auto-criação do Produto Acabado (revenda) exige podeEditarPlanejamento", () => {
    expect(SAVE).toMatch(/d\.origem === "revenda" && paOn && podeEditarPlanejamento\)/);
  });
  it("auto-criação do Produto Importado exige podeEditarPlanejamento", () => {
    expect(SAVE).toMatch(/d\.origem === "importado" && piOn && podeEditarPlanejamento\)/);
  });

  it("InfoGeraisSecao recebe planBloqueado e compartilhadoBloqueado", () => {
    expect(DETALHE).toMatch(/<InfoGeraisSecao[\s\S]*?planBloqueado=\{perm\.planBloqueado\}[\s\S]*?\/>/);
    expect(DETALHE).toMatch(/<InfoGeraisSecao[\s\S]*?compartilhadoBloqueado=\{perm\.compartilhadoBloqueado\}[\s\S]*?\/>/);
    expect(INFO_GERAIS).toMatch(/planBloqueado/);
    expect(INFO_GERAIS).toMatch(/compartilhadoBloqueado/);
  });

  // Fix 1 (I-1a) — Consumo de tecido/Materiais (custo_simulado) travam com planBloqueado.
  it("PrecoTabela recebe planBloqueado e desabilita os 2 inputs de custo_simulado", () => {
    expect(DETALHE).toMatch(/<PrecoTabela[\s\S]*?planBloqueado=\{perm\.planBloqueado\}/);
    const usos = (PRECO_TABELA.match(/disabled=\{planBloqueado\}/g) ?? []).length;
    expect(usos).toBeGreaterThanOrEqual(2);
  });

  // Fix 1 (I-1b/c) — markups + preços fixos da revenda travam com planBloqueado.
  it("PrecoRevendaBloco recebe planBloqueado e desabilita os 4 inputs (2 markups + 2 preços fixos)", () => {
    expect(DETALHE).toMatch(/<PrecoRevendaBloco[\s\S]*?planBloqueado=\{perm\.planBloqueado\}/);
    const usos = (REVENDA_SETORES.match(/disabled=\{planBloqueado\}/g) ?? []).length;
    expect(usos).toBeGreaterThanOrEqual(4);
  });

  // Fix 1 (m-2) — trava pós-Explosão contornável em compartilhados: Anexos, M.O. e grade da revenda.
  it("Anexos (croqui/desenho/fotos) usam perm.compartilhadoBloqueado", () => {
    expect(DETALHE).toMatch(/<fieldset disabled=\{perm\.compartilhadoBloqueado\} className="contents">\s*<div className="grid sm:grid-cols-2 gap-4">\s*<SingleFileField/);
  });
  it("M.O. (editor + observação) usa perm.compartilhadoBloqueado", () => {
    expect(DETALHE).toMatch(/<fieldset disabled=\{perm\.compartilhadoBloqueado\} className="contents">\s*<MaoObraEditor/);
    expect(DETALHE).toMatch(/<fieldset disabled=\{perm\.compartilhadoBloqueado\} className="contents">\s*<ObsMaoObraField/);
  });
  it("grade da revenda vira só-leitura com perm.compartilhadoBloqueado (motivo próprio)", () => {
    expect(DETALHE).toMatch(/perm\.compartilhadoBloqueado\s*\n\s*\? "Sem permissão para editar esta grade\."/);
  });

  // Fix 1 (m-3) — preço editável só com AS DUAS permissões (seção de preço E editar o Planejamento).
  it("podeEditarPreco é a MESMA variável derivada (canEdit preço_venda && podeEditarPlanejamento), usada na UI e no hook", () => {
    expect(DETALHE).toMatch(/const podeEditarPreco = canEdit\("criacao_planejamento:preco_venda"\) && podeEditarPlanejamento;/);
  });

  // Fix 1 (m-5) — Duplicar sem permissão ESCONDE o item (onDuplicar opcional), não trava em "carregando…" pra sempre.
  it("MenuMaisAcoes: onDuplicar é opcional e o item some sem handler", () => {
    expect(MENU_MAIS_ACOES).toMatch(/onDuplicar\?:\s*\(\)\s*=>\s*void;/);
    expect(MENU_MAIS_ACOES).toMatch(/\{onDuplicar && \(/);
  });

  // Fix 1 (sugestão barata) — aviso discreto quando só o Dev está liberado.
  it("aviso discreto aparece com planBloqueado && !sheetSomenteLeitura", () => {
    expect(DETALHE).toMatch(/\{perm\.planBloqueado && !perm\.sheetSomenteLeitura && \(/);
  });
});
