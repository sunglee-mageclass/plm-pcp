import { describe, expect, it } from "vitest";
import {
  ACAO_META,
  CAMPO_LABEL,
  CAMPOS_FK,
  CAMPOS_FOTO,
  campoLabel,
  coletarPares,
  ehCampoOculto,
  valLegivel,
} from "@/lib/audit-legivel";

const ID_A = "301cb509-1111-4222-8333-444455556666";
const ID_B = "9f8e7d6c-aaaa-4bbb-8ccc-ddddeeeeffff";
const ID_DESCONHECIDO = "00000000-0000-4000-8000-000000000000";
const nomes = { [ID_A]: "Maria Estilista", [ID_B]: "Linha Verão" };

describe("valLegivel", () => {
  it("UUID de campo FK conhecido vira o nome do mapa", () => {
    expect(valLegivel("estilista_id", ID_A, nomes)).toBe("Maria Estilista");
  });

  it("UUID de campo FK desconhecido vira (removido)", () => {
    expect(valLegivel("estilista_id", ID_DESCONHECIDO, nomes)).toBe("(removido)");
  });

  it("UUID em campo que NÃO é FK segue cru", () => {
    expect(valLegivel("observacoes", ID_A, nomes)).toBe(ID_A);
  });

  it("campo de foto mostra o marcador, nunca o path", () => {
    expect(valLegivel("foto_url", "tenant/abc/foto.jpg", nomes)).toBe("📷 Arquivo");
    expect(valLegivel("fotos_modelo", ["a.jpg", "b.jpg"], nomes)).toBe("📷 2 arquivo(s)");
    expect(valLegivel("fotos_modelo", [], nomes)).toBe("—");
  });

  it("array de FK resolve item a item (conhecido, desconhecido, não-UUID)", () => {
    expect(valLegivel("tecidos_planejados", [ID_A, ID_DESCONHECIDO, "texto"], nomes)).toBe(
      "Maria Estilista, (removido), texto",
    );
  });

  it("array comum vira contagem; array vazio vira traço", () => {
    expect(valLegivel("itens", [1, 2, 3], nomes)).toBe("3 item(s)");
    expect(valLegivel("itens", [], nomes)).toBe("—");
  });

  it("objeto vira contagem de chaves; objeto vazio vira traço", () => {
    expect(valLegivel("grade", { P: 1, M: 2 }, nomes)).toBe("2 item(s)");
    expect(valLegivel("grade", {}, nomes)).toBe("—");
  });

  it("null, undefined e string vazia viram traço", () => {
    expect(valLegivel("nome", null, nomes)).toBe("—");
    expect(valLegivel("nome", undefined, nomes)).toBe("—");
    expect(valLegivel("nome", "", nomes)).toBe("—");
    expect(valLegivel("foto_url", null, nomes)).toBe("—");
  });

  it("escalares comuns viram texto", () => {
    expect(valLegivel("quantidade", 12, nomes)).toBe("12");
    expect(valLegivel("ativo", false, nomes)).toBe("false");
    expect(valLegivel("nome", "Vestido", nomes)).toBe("Vestido");
  });
});

describe("campoLabel", () => {
  it("campo mapeado devolve o rótulo PT", () => {
    expect(campoLabel("preco_venda")).toBe("Preço de venda");
    expect(campoLabel("categoria_principal_id")).toBe("Categoria");
    expect(campoLabel("foto_url")).toBe("Foto");
  });

  it("campo não mapeado cai no fallback (tira _id, _ vira espaço, capitaliza)", () => {
    expect(campoLabel("estilista_id")).toBe("Estilista");
    expect(campoLabel("data_piloto_1")).toBe("Data piloto 1");
  });

  it("todo rótulo do mapa tem retorno igual ao do mapa", () => {
    for (const [k, v] of Object.entries(CAMPO_LABEL)) expect(campoLabel(k)).toBe(v);
  });
});

describe("coletarPares", () => {
  it("extrai {campo,id} de campos FK (escalar e dentro de array, de e para)", () => {
    const pares = coletarPares({
      estilista_id: { de: null, para: ID_A },
      tecidos_planejados: { de: [ID_A], para: [ID_A, ID_B] },
    });
    expect(pares).toEqual([
      { campo: "estilista_id", id: ID_A },
      { campo: "tecidos_planejados", id: ID_A },
      { campo: "tecidos_planejados", id: ID_A },
      { campo: "tecidos_planejados", id: ID_B },
    ]);
  });

  it("dados sem campo FK devolvem vazio", () => {
    expect(coletarPares({ nome: { de: "A", para: "B" }, quantidade: { de: 1, para: 2 } })).toEqual([]);
  });

  it("campo FK com valor não-UUID ou nulo é ignorado", () => {
    expect(
      coletarPares({
        estilista_id: { de: null, para: "nao-e-uuid" },
        cor_id: { de: undefined, para: 42 },
      }),
    ).toEqual([]);
  });

  it("UUID em campo que não é FK não é coletado", () => {
    expect(coletarPares({ observacoes: { de: ID_A, para: ID_B } })).toEqual([]);
  });
});

describe("constantes e campo oculto", () => {
  it("ehCampoOculto: ruído técnico e *_at somem; resto aparece", () => {
    expect(ehCampoOculto("tenant_id")).toBe(true);
    expect(ehCampoOculto("rev")).toBe(true);
    expect(ehCampoOculto("ref_auto")).toBe(true);
    expect(ehCampoOculto("updated_at")).toBe(true);
    expect(ehCampoOculto("nome")).toBe(false);
  });

  it("ACAO_META cobre as 4 ações com rótulo e tom", () => {
    expect(ACAO_META.criar).toEqual({ label: "Criou", tone: "success" });
    expect(ACAO_META.editar).toEqual({ label: "Editou", tone: "warning" });
    expect(ACAO_META.excluir).toEqual({ label: "Excluiu", tone: "danger" });
    expect(ACAO_META.resetar).toEqual({ label: "Resetou", tone: "danger" });
  });

  it("CAMPOS_FK e CAMPOS_FOTO são conjuntos não vazios e disjuntos", () => {
    expect(CAMPOS_FK.size).toBeGreaterThan(0);
    expect(CAMPOS_FOTO.size).toBeGreaterThan(0);
    for (const k of CAMPOS_FOTO) expect(CAMPOS_FK.has(k)).toBe(false);
  });
});
