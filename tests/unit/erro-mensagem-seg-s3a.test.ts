// Reforço de segurança S3a: a recusa nova do banco (42501 'sem_permissao_pagina: <chaves>', ASCII) vira texto PT com o rótulo da
// página do permissions-catalog. Anti-drift banco × tela: (1) todo prefixo NOVO de RAISE das migrations da S3a (o que está na ida e
// não estava nos inversos) tem tradução; (2) TODA chave de página que o SQL passa ao _seg_exige_pagina existe no catálogo do front
// (senão a pessoa veria a chave crua) — vale para os 34 wrappers e para os 4 gatilhos de página.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mensagemErro, mensagemSegS3, textoSemPermissaoPagina, rotuloPaginaPermissao, MENSAGENS_SEG_S3 } from "@/lib/erro-mensagem";
import { ALL_PAGE_KEYS } from "@/lib/permissions-catalog";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (dir: string, re: RegExp) =>
  readdirSync(ROOT + dir).filter((f) => re.test(f)).map((f) => readFileSync(ROOT + dir + "/" + f, "utf8")).join("\n");
const IDA = ler("supabase/migrations", /^202611011[0-2]0000_seg_s3a_.*\.sql$/);
const VOLTA = ler("supabase/rollback", /^202611011[0-2]0000_seg_s3a_.*_down\.sql$/);
const prefixos = (sql: string) => new Set([...sql.matchAll(/RAISE EXCEPTION '([a-z_]+): /g)].map((m) => m[1]));

describe("erro-mensagem — Reforço de segurança S3a (permissão de página no servidor)", () => {
  it("uma página: 'Módulo › Página'", () => {
    expect(mensagemErro({ code: "42501", message: "sem_permissao_pagina: entrada_oc_tecido" }, "fb")).toBe(
      "Você não tem permissão para editar Entrada e Saída › OC Tecido. Peça ao administrador da loja.",
    );
  });

  it("OU de páginas do MESMO módulo vira 'Módulo › A ou B'; de módulos diferentes, um bloco por módulo", () => {
    expect(mensagemErro({ code: "42501", message: "sem_permissao_pagina: financeiro_parcelas|financeiro_calendario" }, "fb")).toBe(
      "Você não tem permissão para editar Financeiro › OCs ou Calendário. Peça ao administrador da loja.",
    );
    expect(mensagemSegS3("42501", "sem_permissao_pagina: entrada_oc_p_acabado|criacao_produto_acabado")).toBe(
      "Você não tem permissão para editar Entrada e Saída › OC P. Acabado ou Estilo & Engenharia › Produto Acabado. Peça ao administrador da loja.",
    );
    expect(textoSemPermissaoPagina(["entrada_oc_tecido", "cadastro_tecidos"])).toBe(
      "Você não tem permissão para editar Entrada e Saída › OC Tecido ou Cadastro › Tecidos. Peça ao administrador da loja.",
    );
    expect(textoSemPermissaoPagina(["entrada_alertas_tecido", "entrada_oc_tecido"])).toBe(
      "Você não tem permissão para editar Entrada e Saída › Alertas de Tecido ou OC Tecido. Peça ao administrador da loja.",
    );
  });

  it("chave desconhecida aparece crua (sem quebrar); lista vazia = texto genérico; código ≠ 42501 não é traduzido", () => {
    expect(textoSemPermissaoPagina(["pagina_que_nao_existe"])).toBe(MENSAGENS_SEG_S3.sem_permissao_pagina("pagina_que_nao_existe"));
    expect(mensagemSegS3("42501", "sem_permissao_pagina: ")).toBe(MENSAGENS_SEG_S3.sem_permissao_pagina_generica);
    expect(mensagemErro({ code: "P0001", message: "sem_permissao_pagina: entrada_oc_tecido" }, "fb")).toBe("sem_permissao_pagina: entrada_oc_tecido");
    // grant fechado (coluna derivada / tabela só-RPC) segue o 42501 genérico já traduzido
    expect(mensagemErro({ code: "42501", message: "permission denied for table ocs_tecido" }, "fb")).toBe("Você não tem permissão para esta ação.");
  });

  it("anti-drift: todo prefixo NOVO de RAISE da S3a tem tradução (s3a_* = guardas de deploy)", () => {
    expect(IDA.length).toBeGreaterThan(0);
    const antes = prefixos(VOLTA);
    const novos = [...prefixos(IDA)].filter((p) => !antes.has(p)).filter((p) => !p.startsWith("s3a_"));
    expect(novos.sort()).toEqual(["oc_numero_so_pela_rpc", "sem_permissao_pagina"]);
    expect(mensagemErro({ code: "42501", message: "oc_numero_so_pela_rpc: numero_pedido/rolo_codigo de OC que nao e rolo so mudam pelo salvar da OC Tecido" }, "fb"))
      .toBe(MENSAGENS_SEG_S3.oc_numero_so_pela_rpc);
    expect(IDA).toContain("RAISE EXCEPTION 'oc_numero_so_pela_rpc: numero_pedido/rolo_codigo de OC que nao e rolo so mudam pelo salvar da OC Tecido'");
    expect(IDA).toContain(`RAISE EXCEPTION '${"sem_permissao_pagina"}: %', array_to_string(_paginas, '|') USING ERRCODE = '42501'`);
  });

  it("anti-drift: toda chave passada ao _seg_exige_pagina (wrappers e gatilhos) existe no catálogo e tem rótulo", () => {
    const chamadas = [...IDA.matchAll(/_seg_exige_pagina\(([^;]*)\);/g)].map((m) => m[1]);
    expect(chamadas.length).toBeGreaterThanOrEqual(34 + 5); // 34 wrappers + 4 gatilhos (o de ocs_tecido tem 2 chamadas)
    const chaves = new Set(chamadas.flatMap((a) => [...a.matchAll(/'([a-z0-9_:]+)'/g)].map((m) => m[1])).filter((k) => k.includes("_")));
    expect(chaves.size).toBeGreaterThan(10);
    for (const k of chaves) {
      expect(ALL_PAGE_KEYS, k).toContain(k);
      expect(rotuloPaginaPermissao(k).modulo, k).not.toBe("");
    }
  });
});
