import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  CAMPOS, CAMPOS_PADRAO, CAMPO_BY_KEY, CONFIG_API, LAYOUT_KEYS, TEXTO_ALERTA_INTEGRAR, TEXTO_ALERTA_PAGINA_PLANO_GRATUITO,
  alertaPaginaPlanoGratuito, infoCusto, ordenarCampos, rotuloDoCampoTravado, validarConfigApi,
} from "@/lib/integracao/campos";

const SQL1 = readFileSync("supabase/migrations/20261007100000_integracao_1_tabelas.sql", "utf8");
const SQL2 = readFileSync("supabase/migrations/20261007110000_integracao_2_retrato.sql", "utf8");

describe("integracao/campos — catálogo × SQL (anti-drift)", () => {
  it("as 18 chaves na MESMA ordem do _integracao_layout() da migration 1", () => {
    const arr = SQL1.match(/SELECT ARRAY\[([\s\S]*?)\]::text\[\]/)![1];
    const sql = [...arr.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(LAYOUT_KEYS).toEqual(sql);
    expect(CAMPOS_PADRAO).toEqual(sql.slice(0, 17));
  });
  it("os rótulos = _integracao_rotulos() da migration 2", () => {
    const ini = SQL2.indexOf("FUNCTION public._integracao_rotulos()");
    expect(ini).toBeGreaterThan(-1);
    const bloco = SQL2.slice(ini, SQL2.indexOf("$function$;", ini));
    const pares = Object.fromEntries([...bloco.matchAll(/'([a-z_]+)', '([^']+)'/g)].map((m) => [m[1], m[2]]));
    for (const c of CAMPOS) expect(pares[c.key], c.key).toBe(c.rotulo);
  });
});

describe("integracao/campos — regras", () => {
  it("Foto fora do layout (P-83 A); cor/tamanho só variante; custo/cor/tamanho só leitura (P-80 A)", () => {
    expect(CAMPO_BY_KEY.get("foto")!.layout).toBe(false);
    expect(CAMPOS.filter((c) => c.soVariante).map((c) => c.key)).toEqual(["cor_base", "cor_apelido", "tamanho"]);
    expect(CAMPOS.filter((c) => c.tipo === "somente_leitura").map((c) => c.key)).toEqual(["preco_custo", "cor_base", "cor_apelido", "tamanho"]);
    expect(CAMPO_BY_KEY.get("metatag")!.coluna).toBe("descricao_produto"); // Metatag = Descrição
  });
  it("ordenarCampos: ordem fixa, descarta desconhecidos", () => {
    expect(ordenarCampos(["foto", "xyz", "nome", "ncm"])).toEqual(["nome", "ncm", "foto"]);
  });
  it("rótulo do campo travado (mensagem do banco)", () => {
    expect(rotuloDoCampoTravado("peso")).toBe("Peso");
    expect(rotuloDoCampoTravado("tamanho_tipo")).toBe("Tamanho em");
    expect(rotuloDoCampoTravado("sku")).toBe("SKUs");
    expect(rotuloDoCampoTravado("variantes")).toBe("cores/variantes");
  });
  it("info do custo por origem", () => {
    expect(infoCusto("interno")).toBe("Só leitura — soma da ficha: tecido + aviamentos + insumos + mão de obra.");
    expect(infoCusto("revenda")).toBe("Só leitura — revenda: valor da OC (bruto − desconto) + insumos.");
  });
  it("configurações da API: faixa = erro; fora do recomendado = alerta (não erro)", () => {
    expect(CONFIG_API.limite_por_minuto).toMatchObject({ recomendado: 60, min: 1, max: 600 });
    expect(CONFIG_API.max_por_pagina).toMatchObject({ recomendado: 50, min: 1, max: 500 }); // P-89 A: faixa do banco segue 1–500
    const a = validarConfigApi({ limite_por_minuto: 300, max_por_pagina: 200, validade_foto_dias: 7, bloqueio_tentativas: 150 });
    expect(a.erros.bloqueio_tentativas).toBe("Bloqueio de IP: 150 está fora da faixa permitida (3–100). Corrija para salvar.");
    // (fora da faixa é ERRO, não "fora do recomendado" — corrigido o esperado do plano b0c22294)
    expect(a.foraRecomendado).toEqual(["limite_por_minuto", "max_por_pagina"]);
    expect(validarConfigApi({ limite_por_minuto: 60, max_por_pagina: 50, validade_foto_dias: 7, bloqueio_tentativas: 10 }))
      .toEqual({ erros: {}, foraRecomendado: [] });
  });
  it("P-89 A: acima de 100 por página, alerta do plano gratuito (além do 'fora do recomendado')", () => {
    expect(alertaPaginaPlanoGratuito(100)).toBeNull();
    expect(alertaPaginaPlanoGratuito(101)).toBe(TEXTO_ALERTA_PAGINA_PLANO_GRATUITO);
    expect(TEXTO_ALERTA_PAGINA_PLANO_GRATUITO).toBe(
      "Acima de 100 pode passar do limite de processamento do plano gratuito do Cloudflare (10 ms por consulta). Só use com o plano pago (Workers Paid).");
  });
  it("texto do alerta do dono, verbatim", () => {
    expect(TEXTO_ALERTA_INTEGRAR).toBe("Você tem certeza? Se estiver errado, você poderá ser demitido");
  });
});
