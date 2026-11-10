// Paridade PA/PI (Task 4): `linha_id` (reflexivo em `modelos.linha_id`) e `status` (coluna do produto) só vão no `_dados`
// quando a pessoa MEXEU (padrão `tamanho_tipo`). O UPDATE de `modelos.linha_id` no servidor é last-write-wins (sem check de
// rev): mandar em todo Salvar sobrescreveria uma troca de Linha feita no Planejamento. Chave ausente = o servidor MANTÉM.
import { describe, it, expect } from "vitest";
import {
  produtoDataParaSalvar as paData, tocadosLinhaStatus as paTocados, chaveDirty as paChave, montarDadosProduto as paMontar,
} from "@/components/produto-acabado/shared";
import {
  produtoDataParaSalvar as piData, tocadosLinhaStatus as piTocados, chaveDirty as piChave,
} from "@/components/produto-importado/shared";

describe("produtoDataParaSalvar (PA)", () => {
  it("inclui linha_id quando a Linha foi tocada", () => {
    const d = paData({ linhaId: "L1", statusProduto: null } as any, { linhaTocada: true });
    expect(d.linha_id).toBe("L1");
    expect("status" in d).toBe(false);
  });
  it("inclui linha_id null quando a Linha foi LIMPA pela pessoa (tocada)", () => {
    const d = paData({ linhaId: null, statusProduto: null } as any, { linhaTocada: true });
    expect("linha_id" in d).toBe(true);
    expect(d.linha_id).toBeNull();
  });
  it("inclui status quando tocado", () => {
    const d = paData({ statusProduto: "reprovado" } as any, { statusTocado: true });
    expect(d.status).toBe("reprovado");
    expect("linha_id" in d).toBe(false);
  });
  it("NÃO inclui linha_id/status quando não tocados (site não apaga)", () => {
    const d = paData({ linhaId: "L1", statusProduto: "reprovado" } as any, {});
    expect("linha_id" in d).toBe(false);
    expect("status" in d).toBe(false);
  });
  it("mantém o payload de sempre (nome etc.) junto das chaves tocadas", () => {
    const d = paData({ nome: "X", linhaId: "L1" } as any, { linhaTocada: true });
    expect(d.nome).toBe("X");
    expect(d.linha_id).toBe("L1");
  });
});

describe("tocadosLinhaStatus (PA) — tocado = difere da base lida do servidor", () => {
  it("sem mudança vs a base: nada tocado (Salvar disparado por outro campo não reenvia a Linha)", () => {
    const t = paTocados({ linhaId: "L1", linhaIdBase: "L1", statusProduto: "pendente", statusProdutoBase: "pendente" } as any);
    expect(t).toEqual({ linhaTocada: false, statusTocado: false });
  });
  it("Linha trocada vs a base = tocada", () => {
    expect(paTocados({ linhaId: "L2", linhaIdBase: "L1", statusProduto: null, statusProdutoBase: null } as any).linhaTocada).toBe(true);
  });
  it("Status trocado vs a base = tocado", () => {
    expect(paTocados({ linhaId: null, linhaIdBase: null, statusProduto: "reprovado", statusProdutoBase: null } as any).statusTocado).toBe(true);
  });
  it("fluxo completo: base igual → payload sem as chaves; troca → payload com a chave", () => {
    const base = { nome: "X", linhaId: "L1", linhaIdBase: "L1", statusProduto: null, statusProdutoBase: null } as any;
    const sem = paData(base, paTocados(base));
    expect("linha_id" in sem).toBe(false);
    const troca = { ...base, linhaId: "L2" };
    expect(paData(troca, paTocados(troca)).linha_id).toBe("L2");
  });
});

describe("montarDadosProduto (PA) — o que o salvarUmProduto de fato manda", () => {
  const base = { nome: "X", variantes: [], linhaId: "L1", linhaIdBase: "L1", statusProduto: null, statusProdutoBase: null } as any;
  it("Salvar disparado por outro campo NÃO reenvia a Linha/Status (não sobrescreve troca feita no Planejamento)", () => {
    const d = paMontar({ ...base, nome: "Y" });
    expect("linha_id" in d).toBe(false);
    expect("status" in d).toBe(false);
  });
  it("Linha trocada e Status trocado vão no payload", () => {
    const d = paMontar({ ...base, linhaId: "L2", statusProduto: "reprovado" });
    expect(d.linha_id).toBe("L2");
    expect(d.status).toBe("reprovado");
  });
});

describe("chaveDirty (PA) acende com Linha/Status", () => {
  it("inclui linhaId e statusProduto (editar um deles = produto 'editado')", () => {
    const k = paChave({ id: "p", linhaId: "L1", statusProduto: "pendente", variantes: [] } as any) as any;
    expect(k.linhaId).toBe("L1");
    expect(k.statusProduto).toBe("pendente");
  });
});

describe("produtoImportadoDataParaSalvar (PI, espelho)", () => {
  it("inclui linha_id/status só quando tocados", () => {
    expect(piData({ linhaId: "L1", statusProduto: null } as any, { linhaTocada: true }).linha_id).toBe("L1");
    expect(piData({ statusProduto: "reprovado" } as any, { statusTocado: true }).status).toBe("reprovado");
    const d = piData({ linhaId: "L1", statusProduto: "reprovado" } as any, {});
    expect("linha_id" in d).toBe(false);
    expect("status" in d).toBe(false);
  });
  it("tocados = difere da base", () => {
    expect(piTocados({ linhaId: "L1", linhaIdBase: "L1", statusProduto: null, statusProdutoBase: null } as any)).toEqual({ linhaTocada: false, statusTocado: false });
    expect(piTocados({ linhaId: "L2", linhaIdBase: "L1", statusProduto: "reprovado", statusProdutoBase: null } as any)).toEqual({ linhaTocada: true, statusTocado: true });
  });
  it("chaveDirty do PI inclui os dois", () => {
    const k = piChave({ id: "p", linhaId: "L1", statusProduto: "pendente", variantes: [] } as any) as any;
    expect(k.linhaId).toBe("L1");
    expect(k.statusProduto).toBe("pendente");
  });
});
