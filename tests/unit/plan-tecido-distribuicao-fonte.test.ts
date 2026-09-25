import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (r: string) => readFileSync(ROOT + r, "utf8");
const conta = (t: string, s: string) => t.split(s).length - 1;

describe("Plan. Tecido — card com a Distribuição por produto (Task 5)", () => {
  const sheet = ler("src/components/plan-tecido/PlanTecidoSheet.tsx");
  const bloco = ler("src/components/plan-tecido/MaterialBlock.tsx");
  const card = ler("src/components/plan-tecido/ModelCard.tsx");
  const pop = ler("src/components/plan-tecido/AtendeAPopover.tsx");
  it("gate do módulo e normalização no carregamento E no funil `patch` (R4/R6)", () => {
    expect(sheet).toContain('isModuleEnabled("distribuicao")');
    expect(sheet).toMatch(/return normalizarArvoreDistribuicao\(limparSlotsOrfaos\(/);
    expect(sheet).toMatch(/const patch = \(next0: PtArvore\) => \{\n\s+const next = normalizarArvoreDistribuicao\(next0, distOpts\);/);
  });
  it("PR15 (G-plano R6): espera os módulos por isFetched e re-semeia quando a grade/os módulos chegam ou mudam", () => {
    expect(sheet).toContain("if (!tamanhosProntos || !modulosProntos) return;");
    expect(sheet).toContain("srcRef.current.dist !== distOpts");
    expect(sheet).not.toContain("modulosCarregando");
    expect(ler("src/hooks/useTenantModules.ts")).toContain("return { modules, isModuleEnabled, isStockOnly, firstActiveModulePath, isLoading, isFetched };");
  });
  it("PR12 (G-plano R3 + P-31): carga que recalcula ⇒ 'não salvo' + aviso no topo; base = árvore CRUA; descartar re-deriva", () => {
    expect(sheet).toContain("const carga = efeitoDaCarga(computeFreshArvore(seed, modelosReais, salvo, modelosDb as any[], SEM_DERIVAR), distOpts, !paginaSoLeitura);");
    expect(sheet).toContain("planBaseRef.current = carga.base;");
    expect(sheet).toContain("touchedSlotIdsRef.current = new Set(carga.tocados);");
    expect(sheet).toContain("if (carga.sujo) setDirty(true);");
    expect(sheet).toContain("cor(es) de forro/Tecido 2 recalculada(s) pela amarração — salve para gravar");
    expect(sheet).toContain("srcRef.current = null; // PR12");
    expect(conta(sheet, ", distOpts)")).toBeGreaterThanOrEqual(2); // os 2 merges (dirty e retry P0409) seguem normalizando
  });
  it("payload do aplicar/criar card com casamento só com o módulo (R3/R4); nada de buildMateriaisAplicar cru", () => {
    expect(conta(sheet, "materiaisParaAplicar(slot, distribOn)")).toBe(2);
    expect(sheet).not.toMatch(/buildMateriaisAplicar\(slot\)/);
    expect(card).toContain("materiaisParaAplicar(slot, !!distribuicaoLigada)");
  });
  it("a query dos modelos traz cor, casamento e 'Tamanho em' (R17)", () => {
    expect(sheet).toContain("modelo_tecido_variantes(variante_tecido_id, ordem, multiplicador, complementa_variante_ids, variante:variante_tecido_id(artigo_id, cor_id, ");
    expect(sheet).toContain("proporcoes, tamanho_tipo, lancado");
  });
  it("I3 (Lote A fix1): a query também pede cor_apelido_id — sem ele a chave da variante viva não casa com a salva (cor|apelido)", () => {
    expect(sheet).toContain("cor_id, cor_apelido_id,");
  });
  it("M5 (Lote A fix1): efeitoDaCarga com só o Tecido 1 recalculado mostra o aviso próprio; com forro/T2 mostra o do PR12", () => {
    expect(sheet).toContain("recalculadas === 0 && recalculadasT1 > 0");
    expect(sheet).toContain("Distribuição recalculada — salve para gravar");
    expect(sheet).toContain("cor(es) de forro/Tecido 2 recalculada(s) pela amarração — salve para gravar");
  });
  it("presença: o marcador do dialog entra no campoFocado do canal do Plan. Tecido (R19)", () => {
    expect(sheet).toContain("campoFocado: campoFocadoColab ?? focoDistribuicao,");
    expect(sheet).toContain("presentesColab={presentes}");
    expect(sheet).toContain("onFocoDistribuicao={setFocoDistribuicao}");
  });
  it("pç só leitura + selo 'distribuído' (T1) e 'atende a' (demais blocos) com textos do mockup", () => {
    expect(bloco).toContain("Só leitura — muda pelo Distribuir por loja");
    expect(bloco).toContain("Soma das cores do Tecido 1 que ele atende");
    expect(bloco).toContain(">distribuído</StatusBadge>");
    expect(bloco).toContain("Não atende nenhuma cor do Tecido 1");
    expect(bloco).toContain("Sem cor deste {rotulo}:");
    expect(bloco).toContain("{acaoExtra}");
  });
  it("'atende a' tem data-colab-path no gatilho E nas opções (R20)", () => {
    expect(conta(pop, "data-colab-path={path}")).toBe(2);
    expect(pop).toContain("Atende a · cores do Tecido 1");
    expect(pop).toContain("já atendida por: ");
    expect(pop).toContain("mesma cor base (automático)");
    expect(pop).toContain("escolhida à mão");
    expect(pop).toContain("padrão (mesma cor base)");
  });
});
