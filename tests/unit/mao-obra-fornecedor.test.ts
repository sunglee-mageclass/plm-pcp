// Urgentes R4 (front): fornecedor de servico na linha de M.O. do Sheet do Planejamento + aviso "M.O. nao aprovada" no PCP.
//  - `moLinhaVaiReabrir` compara o fornecedor (empresa_id); cards PA/PI (sem a chave) nunca reabrem por isso;
//  - fontes: useMaoObraModelo NAO manda empresa_id; usePlanejamentoSave manda; o PCP so le `mo_linha_id` (fora do payload);
//  - B4: excluir fornecedor em uso por uma linha de M.O. (FK 23503) mostra texto PT proprio.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { moLinhaVaiReabrir, moLinhasEqual, moLinhaParaPayload, TEXTO_MO_VAI_REABRIR, type MoLinha } from "@/lib/mao-obra";
import { blocoDeLinha, blocoParaPayload } from "@/lib/servicos-payload";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");

const L = (o: Partial<MoLinha> = {}): MoLinha => ({
  id: "1",
  aprovado: true,
  valor: 10,
  categoria_terceirizado_id: "c",
  ...o,
});

describe("moLinhaVaiReabrir — fornecedor", () => {
  it("trocar o fornecedor de linha decidida reabre", () => {
    expect(moLinhaVaiReabrir(L({ empresa_id: "B" }), L({ empresa_id: "A" }))).toBe(true);
    expect(moLinhaVaiReabrir(L({ empresa_id: null }), L({ empresa_id: "A" }))).toBe(true);
    expect(moLinhaVaiReabrir(L({ empresa_id: "A" }), L({ empresa_id: null }))).toBe(true);
  });
  it("sem empresa_id nos dois lados (formato dos cards PA/PI) nao reabre", () => {
    expect(moLinhaVaiReabrir(L(), L())).toBe(false);
  });
  it("null x undefined e o mesmo valor", () => {
    expect(moLinhaVaiReabrir(L({ empresa_id: null }), L())).toBe(false);
    expect(moLinhaVaiReabrir(L(), L({ empresa_id: null }))).toBe(false);
  });
  it("mesmo fornecedor nao reabre; pendente no servidor nunca reabre", () => {
    expect(moLinhaVaiReabrir(L({ empresa_id: "A" }), L({ empresa_id: "A" }))).toBe(false);
    expect(moLinhaVaiReabrir(L({ empresa_id: "B" }), L({ empresa_id: "A", aprovado: null }))).toBe(
      false,
    );
  });
  it("texto da dica cita o fornecedor", () => {
    expect(TEXTO_MO_VAI_REABRIR).toBe(
      "Mudar o valor, o serviço ou o fornecedor volta este serviço para pendente — precisa de nova aprovação.",
    );
  });
});

describe("fontes", () => {
  it("useMaoObraModelo (cards PA/PI) NAO contem empresa_id — nunca apaga o fornecedor", () => {
    expect(ler("src/hooks/useMaoObraModelo.ts")).not.toContain("empresa_id");
  });
  it("usePlanejamentoSave monta o _linhas por moLinhaParaPayload com a base do servidor", () => {
    const src = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    const i = src.indexOf('"salvar_modelo_servico_mo"');
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, i + 700)).toContain("moLinhaParaPayload(l, moBaseRef.current)");
    expect(src).not.toContain("empresa_id: l.empresa_id ?? null");
  });
  it("MaoObraEditor: prop fornecedores opcional, Select 'Fornecedor' e data-colab-path proprio", () => {
    const ed = ler("src/components/planejamento/MaoObraEditor.tsx");
    expect(ed).toContain("fornecedores?:");
    expect(ed).toContain("Sem fornecedor");
    expect(ed).toContain("__nenhum__");
    expect(ed).toContain("w-full sm:w-48");
    expect(ed).toMatch(/data-colab-path=\{`mo:\$\{linhaId \?\? `nova-\$\{idx\}`\}:fornecedor`\}/);
    expect(ed).toContain("empresa_id: null");
  });
  it("so o Sheet do Planejamento passa fornecedores", () => {
    expect(ler("src/components/planejamento/PlanejamentoDetail.tsx")).toMatch(
      /fornecedores=\{empresasServicoMO\}/,
    );
    expect(ler("src/components/planejamento/PlanejamentoDetail.tsx")).toContain(
      '"empresas-servico-mo"',
    );
    expect(ler("src/components/planejamento/MaoObraCardMini.tsx")).not.toContain("fornecedores");
  });
  it("Enviar a Explosao invalida os blocos de Servicos que acabaram de nascer", () => {
    const src = ler("src/components/planejamento/planejamento-detail/useEnviarExplosao.ts");
    expect(src).toContain('"producao-terc-list"');
    expect(src).toContain('"etapas-cards"');
    expect(src).toContain('queryKey: ["producao-terc"]');
  });
});

describe("PCP > Servicos", () => {
  const PCP = ler("src/routes/_authenticated/pcp.servicos.$modeloId.tsx");
  it("blocoParaPayload NAO leva mo_linha_id (so leitura)", () => {
    const b = blocoDeLinha({ id: "x", categoria_terceirizado_id: "c", mo_linha_id: "mo1" });
    expect(b.mo_linha_id).toBe("mo1");
    expect(Object.keys(blocoParaPayload(b))).not.toContain("mo_linha_id");
    expect(blocoDeLinha({ id: "x", categoria_terceirizado_id: "c" }).mo_linha_id).toBeNull();
  });
  it("aviso 'M.O. nao aprovada' so em bloco da M.O., externo, sem preco, linha nao aprovada", () => {
    expect(PCP).toContain("M.O. não aprovada");
    expect(PCP).toMatch(
      /b\.mo_linha_id && !b\.interno && !\(Number\(b\.preco_metro_unidade\) > 0\)/,
    );
    expect(PCP).toContain(
      "O preço entra sozinho quando a mão de obra deste serviço for aprovada no Planejamento. Se digitar um preço aqui, ele não é trocado.",
    );
    const q = PCP.indexOf('queryKey: ["pcp-mo-resumo", modeloId]');
    expect(q).toBeGreaterThan(-1);
    const trecho = PCP.slice(q, PCP.indexOf("queryFn", q));
    expect(trecho).toContain("enabled: !!modeloId,");
    expect(trecho).not.toMatch(/enabled: [^\n]*podeVerPrecos/);
  });
  it("opcoes de fornecedor do bloco incluem a empresa ja escolhida", () => {
    expect(PCP).toMatch(
      /const empresasCat = empresaSel && !empresasCatBase\.some\(\(e: any\) => e\.id === b\.empresa_id\) \? \[\.\.\.empresasCatBase, empresaSel\] : empresasCatBase;/,
    );
    expect(PCP).not.toContain("empresa_categorias_servico!inner");
  });
});

describe("B4 — excluir fornecedor em uso na M.O.", () => {
  const SRC = ler("src/routes/_authenticated/cadastro.servico.tsx");
  it("mapeia a FK de modelo_servico_mo para texto PT proprio", () => {
    expect(SRC).toContain(
      "Este fornecedor está em uso na mão de obra de algum produto. Troque o fornecedor nessas linhas antes de excluir.",
    );
    expect(SRC).toContain("modelo_servico_mo_empresa_id_fkey");
    expect(SRC).toContain("23503");
  });
  it("a exclusao de empresa usa o mapeamento", () => {
    const i = SRC.indexOf(
      'supabase.from("empresas").delete().eq("id", id);\n      if (error) throw error;',
    );
    expect(i).toBeGreaterThan(-1);
    expect(SRC).toMatch(/onError: \(e: any\) => toast\.error\(mensagemExcluirEmpresa\(e\)\)/);
  });
});

describe("[fix round 1 M1] moLinhaParaPayload — empresa_id so quando a linha e nova ou mudou", () => {
  const X = (o: Partial<MoLinha> = {}): MoLinha => ({
    id: "X", aprovado: true, valor: 10, categoria_terceirizado_id: "c", empresa_id: "A", empresa_nome: "Forn A", ...o,
  });
  it("base X=A, local inalterado (servidor mudou para B): payload SEM a chave empresa_id", () => {
    const p = moLinhaParaPayload(X(), [X()]);
    expect(Object.keys(p)).not.toContain("empresa_id");
    expect(p).toEqual({ id: "X", categoria_terceirizado_id: "c", valor: 10, observacoes: null });
  });
  it("local mudou para C: manda C; limpou: manda null", () => {
    expect(moLinhaParaPayload(X({ empresa_id: "C" }), [X()]).empresa_id).toBe("C");
    expect(moLinhaParaPayload(X({ empresa_id: null }), [X()])).toHaveProperty("empresa_id", null);
  });
  it("linha nova (sem id): manda a chave (null ou uuid)", () => {
    expect(moLinhaParaPayload({ ...X({ id: null }), empresa_id: null }, [X()])).toHaveProperty("empresa_id", null);
    expect(moLinhaParaPayload(X({ id: null, empresa_id: "B" }), [X()]).empresa_id).toBe("B");
  });
  it("linha com id que nao esta na base: manda a chave (nao ha o que preservar)", () => {
    expect(moLinhaParaPayload(X({ id: "Z", empresa_id: "B" }), [X()]).empresa_id).toBe("B");
  });
  it("cards PA/PI (sem empresa_id nos dois lados): sem a chave", () => {
    const sem = { id: "X", aprovado: true, valor: 5, categoria_terceirizado_id: "c" } as MoLinha;
    expect(Object.keys(moLinhaParaPayload(sem, [sem]))).not.toContain("empresa_id");
  });
  it("valor 0/null vai como 0 (igual ao de antes)", () => {
    expect(moLinhaParaPayload(X({ valor: null }), [X()]).valor).toBe(0);
  });
});

describe("[fix round 1 L1/L4] moLinhasEqual — fornecedor", () => {
  const base: MoLinha[] = [{ id: "X", aprovado: null, valor: 10, categoria_terceirizado_id: "c", empresa_id: "A", empresa_nome: "Forn A" }];
  it("so o empresa_id diferente = sujo (e o que faz o Salvar gravar)", () => {
    expect(moLinhasEqual([{ ...base[0], empresa_id: "B", empresa_nome: "Forn B" }], base)).toBe(false);
    expect(moLinhasEqual([{ ...base[0], empresa_id: null, empresa_nome: null }], base)).toBe(false);
  });
  it("so o empresa_nome diferente = limpo (rotulo, nao dado)", () => {
    expect(moLinhasEqual([{ ...base[0], empresa_nome: "outro" }], base)).toBe(true);
  });
  it("linha nova: escolher e voltar a 'Sem fornecedor' nao deixa sujo", () => {
    const semChave: MoLinha[] = [{ id: null, aprovado: null, valor: null, categoria_terceirizado_id: "c", empresa_id: null }];
    const voltou: MoLinha[] = [{ id: null, aprovado: null, valor: null, categoria_terceirizado_id: "c", empresa_id: null, empresa_nome: null }];
    expect(moLinhasEqual(voltou, semChave)).toBe(true);
  });
  it("undefined x null no empresa_id e igual (cards PA/PI)", () => {
    const a: MoLinha[] = [{ id: "X", aprovado: null, valor: 1, categoria_terceirizado_id: "c" }];
    const b: MoLinha[] = [{ id: "X", aprovado: null, valor: 1, categoria_terceirizado_id: "c", empresa_id: null }];
    expect(moLinhasEqual(a, b)).toBe(true);
  });
});

describe("[fix round 1 L2/L3] invalidacao do Cadastro e badge so com a linha vinda do resumo", () => {
  it("Cadastro > Servico invalida empresas-servico-mo onde invalida empresas-servico-sel", () => {
    const src = ler("src/routes/_authenticated/cadastro.servico.tsx");
    const sel = src.match(/queryKey: \["empresas-servico-sel"\]/g) ?? [];
    const mo = src.match(/queryKey: \["empresas-servico-mo"\]/g) ?? [];
    expect(sel.length).toBeGreaterThanOrEqual(4);
    expect(mo.length).toBe(sel.length);
  });
  it("badge 'M.O. nao aprovada' exige a linha no resumo e nao aprovada", () => {
    const PCP = ler("src/routes/_authenticated/pcp.servicos.$modeloId.tsx");
    expect(PCP).toContain("const linhaMoDoBloco = moLinhas.find((l) => l.id === b.mo_linha_id);");
    expect(PCP).toMatch(/linhaMoDoBloco && linhaMoDoBloco\.aprovado !== true/);
    expect(PCP).not.toMatch(/moLinhas\.find\(\(l\) => l\.id === b\.mo_linha_id\)\?\.aprovado !== true/);
  });
});
