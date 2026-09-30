/**
 * P-137 A — espelho no front da ÚNICA recusa do gatilho fn_modelo_espelho_categoria (20261017100000): produto COM
 * pedido cuja categoria nova mudaria o grupo entre Acessórios e outro grupo. Pré-checagem SÓ-LEITURA (R6 do G-plano)
 * no Sheet do Planejamento e na edição em lote + tradução do P0001 em `mensagemErro`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  cruzaAcessorioComPedido, precisaConferirCategoria, conferirCategoriaAcessorioPedido, erroCategoriaAcessorioPedido,
  textoBloqueioCategoriaLote, PREFIXO_CATEGORIA_ACESSORIO_PEDIDO, TEXTO_CATEGORIA_ACESSORIO_PEDIDO, type ClienteLeitura,
} from "@/lib/categoria-card-produto";
import { mensagemErro } from "@/lib/erro-mensagem";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");

describe("cruzaAcessorioComPedido (espelho puro do gatilho)", () => {
  const base = {
    categoriaAntes: "cV1", categoriaNova: "cA", grupoNovo: "gA", grupoNovoNome: "Acessórios",
    grupoProduto: "gV", grupoProdutoNome: "Vestidos", temPedido: true,
  };
  it("recusa: com pedido, Vestidos -> Acessórios e Acessórios -> Vestidos", () => {
    expect(cruzaAcessorioComPedido(base)).toBe(true);
    expect(cruzaAcessorioComPedido({ ...base, categoriaNova: "cV2", grupoNovo: "gV", grupoNovoNome: "Vestidos",
      grupoProduto: "gA", grupoProdutoNome: "ACESSORIO" })).toBe(true);
  });
  it("passa: sem pedido, sem cruzar Acessórios, mesmo grupo, categoria igual/NULL, categoria sem grupo", () => {
    expect(cruzaAcessorioComPedido({ ...base, temPedido: false })).toBe(false);
    expect(cruzaAcessorioComPedido({ ...base, grupoNovo: "gT", grupoNovoNome: "Tops" })).toBe(false);
    expect(cruzaAcessorioComPedido({ ...base, grupoProduto: "gA", grupoProdutoNome: "Acessórios" })).toBe(false);
    expect(cruzaAcessorioComPedido({ ...base, categoriaNova: "cV1" })).toBe(false);
    expect(cruzaAcessorioComPedido({ ...base, categoriaNova: null })).toBe(false);
    expect(cruzaAcessorioComPedido({ ...base, grupoNovo: null })).toBe(false);
  });
  it("produto SEM grupo conta como não-acessório (igual _grupo_eh_acessorio(NULL) = false)", () => {
    expect(cruzaAcessorioComPedido({ ...base, grupoProduto: null, grupoProdutoNome: null })).toBe(true);
    expect(cruzaAcessorioComPedido({ ...base, grupoProduto: null, grupoProdutoNome: null, grupoNovo: "gT", grupoNovoNome: "Tops" })).toBe(false);
  });
});

describe("precisaConferirCategoria (quando o Sheet vai ao servidor)", () => {
  it("só card comprado já salvo com a categoria mudando para um valor", () => {
    const o = { isEdit: true, origem: "revenda", categoriaPayload: "c2", categoriaServidor: "c1" };
    expect(precisaConferirCategoria(o)).toBe(true);
    expect(precisaConferirCategoria({ ...o, origem: "importado" })).toBe(true);
    expect(precisaConferirCategoria({ ...o, origem: "interno" })).toBe(false);
    expect(precisaConferirCategoria({ ...o, isEdit: false })).toBe(false);
    expect(precisaConferirCategoria({ ...o, categoriaPayload: "c1" })).toBe(false);
    expect(precisaConferirCategoria({ ...o, categoriaPayload: null })).toBe(false);
    expect(precisaConferirCategoria({ ...o, categoriaPayload: undefined })).toBe(false);
    expect(precisaConferirCategoria({ ...o, categoriaServidor: null })).toBe(true);
  });
});

// Fake de cliente: SÓ leitura (select + in/eq). Qualquer outra chamada explode — prova que a pré-checagem não grava.
type Linha = Record<string, unknown>;
function fake(db: Record<string, Linha[]>) {
  const chamadas: string[] = [];
  const client = {
    from(tabela: string) {
      return {
        select(_cols: string) {
          const res = (pred: (r: Linha) => boolean) => {
            chamadas.push(tabela);
            return Promise.resolve({ data: (db[tabela] ?? []).filter(pred), error: null });
          };
          return {
            in: (col: string, vals: readonly string[]) => res((r) => vals.includes(String(r[col]))),
            eq: (col: string, v: string) => res((r) => r[col] === v),
          };
        },
        update() { throw new Error("gravou!"); }, insert() { throw new Error("gravou!"); }, delete() { throw new Error("gravou!"); },
      };
    },
  };
  return { client: client as unknown as ClienteLeitura, chamadas };
}
const DB = (): Record<string, Linha[]> => ({
  categorias_produto: [{ id: "cA", grupo_id: "gA" }, { id: "cT", grupo_id: "gT" }, { id: "cSem", grupo_id: null }],
  grupos_produto: [{ id: "gA", nome: "Acessórios" }, { id: "gV", nome: "Vestidos" }, { id: "gT", nome: "Tops" }],
  modelos: [
    { id: "m1", nome: "Vestido Ana", origem: "revenda", categoria_principal_id: "cV" },
    { id: "m2", nome: "Vestido Bia", origem: "revenda", categoria_principal_id: "cV" },
    { id: "m3", nome: "Blusa Imp", origem: "importado", categoria_principal_id: "cV" },
    { id: "m4", nome: "Interno", origem: "interno", categoria_principal_id: "cV" },
  ],
  produtos_acabados: [{ id: "p1", modelo_id: "m1", grupo_id: "gV" }, { id: "p2", modelo_id: "m2", grupo_id: "gV" }],
  produtos_importados: [{ id: "i3", modelo_id: "m3", grupo_id: "gV" }],
  ocs_p_acabado: [{ produto_acabado_id: "p1" }],
  ocs_importado: [{ produto_importado_id: "i3" }],
});

describe("conferirCategoriaAcessorioPedido (pré-checagem só-leitura)", () => {
  it("lote: barra só os cards com pedido que cruzariam Acessórios (PA e PI); sem pedido e interno passam", async () => {
    const { client } = fake(DB());
    const r = await conferirCategoriaAcessorioPedido(client, { modeloIds: ["m1", "m2", "m3", "m4"], categoriaNova: "cA" });
    expect(r).toEqual([{ modeloId: "m1", nome: "Vestido Ana" }, { modeloId: "m3", nome: "Blusa Imp" }]);
  });
  it("sem cruzar Acessórios (Vestidos -> Tops) = nada barrado", async () => {
    const { client } = fake(DB());
    expect(await conferirCategoriaAcessorioPedido(client, { modeloIds: ["m1", "m3"], categoriaNova: "cT" })).toEqual([]);
  });
  it("categoria sem grupo / categoria vazia = nada barrado e para cedo (o gatilho não copiaria)", async () => {
    const a = fake(DB());
    expect(await conferirCategoriaAcessorioPedido(a.client, { modeloIds: ["m1"], categoriaNova: "cSem" })).toEqual([]);
    expect(a.chamadas).toEqual(["categorias_produto"]);
    const b = fake(DB());
    expect(await conferirCategoriaAcessorioPedido(b.client, { modeloIds: ["m1"], categoriaNova: null })).toEqual([]);
    expect(b.chamadas).toEqual([]);
  });
  it("categoria do card já é a nova = nada a conferir; origem trocada no mesmo save vale (interno -> revenda)", async () => {
    const db = DB();
    db.modelos[0].categoria_principal_id = "cA";
    const { client } = fake(db);
    expect(await conferirCategoriaAcessorioPedido(client, { modeloIds: ["m1"], categoriaNova: "cA" })).toEqual([]);
    const db2 = DB();
    db2.modelos[3].origem = "interno";
    db2.produtos_acabados.push({ id: "p4", modelo_id: "m4", grupo_id: "gV" });
    db2.ocs_p_acabado.push({ produto_acabado_id: "p4" });
    const f2 = fake(db2);
    expect(await conferirCategoriaAcessorioPedido(f2.client, { modeloIds: ["m4"], categoriaNova: "cA" })).toEqual([]);
    expect(await conferirCategoriaAcessorioPedido(f2.client, { modeloIds: ["m4"], categoriaNova: "cA", origemNova: "revenda" }))
      .toEqual([{ modeloId: "m4", nome: "Interno" }]);
  });
  it("erro de leitura sobe (nada é gravado; o save não segue às cegas)", async () => {
    const client = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: "boom" } }), in: () => Promise.resolve({ data: null, error: null }) }) }) };
    await expect(conferirCategoriaAcessorioPedido(client as unknown as ClienteLeitura, { modeloIds: ["m1"], categoriaNova: "cA" }))
      .rejects.toEqual({ message: "boom" });
  });
});

describe("mensagens PT (recusa do banco e da pré-checagem)", () => {
  it("P0001 com o prefixo ASCII do gatilho vira o texto PT; o erro da pré-checagem tem o MESMO formato", () => {
    const doBanco = { code: "P0001", message: `${PREFIXO_CATEGORIA_ACESSORIO_PEDIDO} produto com pedido nao pode trocar entre Acessorios e outro grupo pela Categoria do card` };
    expect(mensagemErro(doBanco)).toBe(TEXTO_CATEGORIA_ACESSORIO_PEDIDO);
    const e = erroCategoriaAcessorioPedido();
    expect(e.code).toBe("P0001");
    expect(e.message).toBe(doBanco.message);
    expect(mensagemErro(e)).toBe(TEXTO_CATEGORIA_ACESSORIO_PEDIDO);
    expect(TEXTO_CATEGORIA_ACESSORIO_PEDIDO).toMatch(/Nada foi salvo/);
  });
  it("lote: o texto nomeia os cards e passa intacto pelo mensagemErro", () => {
    const um = textoBloqueioCategoriaLote(["Vestido Ana"]);
    expect(um).toMatch(/^O card "Vestido Ana" tem produto com pedido/);
    const dois = textoBloqueioCategoriaLote(["Vestido Ana", "Blusa Imp"]);
    expect(dois).toMatch(/^2 cards \("Vestido Ana", "Blusa Imp"\) têm produto com pedido/);
    expect(mensagemErro(new Error(dois), "Erro ao atualizar cards")).toBe(dois);
  });
  it("outro P0001 continua passando a própria mensagem", () => {
    expect(mensagemErro({ code: "P0001", message: "Informe o nome do produto." })).toBe("Informe o nome do produto.");
  });
});

describe("fonte: a pré-checagem roda ANTES de qualquer gravação", () => {
  it("usePlanejamentoSave: dentro do mutationFn, nenhuma escrita antes de conferirCategoriaAcessorioPedido (grade inclusive)", () => {
    const src = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    const inicio = src.indexOf("mutationFn: async () => {");
    const pre = src.indexOf("await conferirCategoriaAcessorioPedido(", inicio);
    expect(inicio).toBeGreaterThan(0);
    expect(pre).toBeGreaterThan(inicio);
    const antes = src.slice(inicio, pre).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    for (const escrita of ["supabase.rpc(", ".update(", ".insert(", ".delete(", ".upsert(", "persistirBom(", "persistirCad(", "gravarTecidosIniciais("]) {
      expect(antes, escrita).not.toContain(escrita);
    }
    const grade = src.indexOf('supabase.rpc("salvar_grade_revenda"', inicio);
    const header = src.indexOf(".update(payload)", inicio);
    expect(pre).toBeLessThan(grade);
    expect(pre).toBeLessThan(header);
    expect(src.slice(pre, grade)).toContain("throw erroCategoriaAcessorioPedido()");
  });
  it("BulkEditDialog: confere ANTES do UPDATE em lote e mostra o erro por mensagemErro", () => {
    const src = ler("src/components/planejamento/BulkEditDialog.tsx");
    const pre = src.indexOf("await conferirCategoriaAcessorioPedido(");
    const upd = src.indexOf('supabase.from("modelos").update(patch');
    expect(pre).toBeGreaterThan(0);
    expect(pre).toBeLessThan(upd);
    expect(src.slice(pre, upd)).toContain("throw new Error(textoBloqueioCategoriaLote(");
    expect(src).toContain('onError: (e: unknown) => toast.error(mensagemErro(e, "Erro ao atualizar cards"))');
  });
});
