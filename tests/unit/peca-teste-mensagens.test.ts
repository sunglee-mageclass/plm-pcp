// R9 T5 — toda recusa `peca_teste_*:` do banco (migrations 20261103192000..196000) tem texto PT em `mensagemErro`.
// A lista de códigos vem DAS MIGRATIONS (anti-drift): RAISE novo com prefixo `peca_teste_*` sem tradução quebra aqui.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MENSAGENS_PECA_TESTE, TEXTO_SESSAO_EXPIRADA, mensagemErro, mensagemPecaTeste, textoSemPermissaoPagina } from "@/lib/erro-mensagem";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const err = (code: string, message: string) => ({ code, message });

describe("mensagemErro — Peça Teste", () => {
  // [prefixo, SQLSTATE, mensagem EXATA do RAISE, texto PT]
  const CASOS: [string, string, string, string][] = [
    ["peca_teste_conflito", "P0409", "peca_teste_conflito: outra pessoa salvou a peca teste", "Outra pessoa salvou a Peça Teste deste card agora — conferimos as mudanças."],
    ["peca_teste_desatualizada", "P0409", "peca_teste_desatualizada: servico da mao de obra mudou", "O serviço da mão de obra mudou — a Peça Teste foi recarregada."],
    ["peca_teste_sem_datas", "P0001", "peca_teste_sem_datas: aprovar ou reprovar exige data de saida e data de entrada", "Preencha a Data de saída e a Data de entrada para aprovar ou reprovar."],
    ["peca_teste_historico", "P0001", "peca_teste_historico: tentativa reprovada e so leitura", "Tentativa reprovada é só leitura."],
    ["peca_teste_aprovada_travada", "P0001", "peca_teste_aprovada_travada: datas da peca aprovada nao mudam (desfaca a aprovacao antes)", "Peça aprovada: as datas ficam travadas. Desfaça a aprovação para mudar."],
    ["peca_teste_fornecedor_travado", "P0001", "peca_teste_fornecedor_travado: peca teste aprovada trava o fornecedor", "A peça teste deste serviço já foi aprovada com este fornecedor; para trocar, reabra a peça teste."],
    ["peca_teste_fornecedor_invalido", "P0001", "peca_teste_fornecedor_invalido: fornecedor de servico invalido", "Fornecedor de serviço inválido."],
    ["peca_teste_sem_fornecedor", "P0001", "peca_teste_sem_fornecedor: defina o fornecedor da M.O. antes de aprovar ou reprovar a peca teste", "Defina o fornecedor da mão de obra deste serviço antes de aprovar ou reprovar a peça teste."],
    ["peca_teste_formato", "P0001", "peca_teste_formato: trilha invalida ou repetida", "Não foi possível salvar a Peça Teste: os dados enviados estão incompletos. Recarregue o card e tente de novo."],
    ["peca_teste_modelo", "P0001", "peca_teste_modelo: nao encontrado", "Este produto não foi encontrado (outra pessoa pode tê-lo excluído). Recarregue a tela."],
    ["peca_teste_sem_login", "42501", "peca_teste_sem_login: nao autenticado", TEXTO_SESSAO_EXPIRADA],
  ];

  for (const [prefixo, code, msg, pt] of CASOS) {
    it(`${prefixo} (${code}) → texto PT`, () => {
      expect(mensagemErro(err(code, msg))).toBe(pt);
      expect(mensagemPecaTeste(code, msg)).toBe(pt);
      expect(MENSAGENS_PECA_TESTE[prefixo as keyof typeof MENSAGENS_PECA_TESTE]).toBe(pt);
      // o texto PT nunca vaza o prefixo ASCII do banco
      expect(pt).not.toMatch(/peca_teste_/);
    });
  }

  it("os dois P0409 ganham o texto da Peça Teste (não o genérico de P0409)", () => {
    const generico = mensagemErro(err("P0409", "conflito_versao: modelo"));
    expect(mensagemErro(err("P0409", "peca_teste_conflito: x"))).not.toBe(generico);
    expect(mensagemErro(err("P0409", "peca_teste_desatualizada: x"))).not.toBe(generico);
  });

  it("o mesmo prefixo com SQLSTATE inesperado ou sem prefixo cai nos caminhos de sempre", () => {
    expect(mensagemPecaTeste("23505", "peca_teste_conflito: x")).toBeNull();
    expect(mensagemPecaTeste("P0001", "peca_teste_desconhecido: x")).toBeNull();
    expect(mensagemPecaTeste("P0409", "conflito_versao: modelo")).toBeNull();
    expect(mensagemErro(err("P0409", "conflito_versao: modelo"))).toContain("Outra pessoa salvou");
  });

  it("sem_permissao_pagina da seção cai no tradutor S3 pelo rótulo do catálogo ('Peça Teste')", () => {
    const t = mensagemErro(err("42501", "sem_permissao_pagina: criacao_planejamento:peca_teste"));
    // o módulo sai do rótulo do catálogo (hoje "Estilo & Engenharia"); a seção tem de aparecer como "Peça Teste"
    expect(t).toMatch(/^Você não tem permissão para editar .+ › Planejamento de Produto › Peça Teste\. Peça ao administrador da loja\.$/);
    expect(t).toBe(textoSemPermissaoPagina(["criacao_planejamento:peca_teste"]));
    expect(t).toContain("Peça Teste");
  });
});

describe("anti-drift: todo código peca_teste_* do banco está traduzido", () => {
  const pasta = ROOT + "supabase/migrations/";
  const arquivos = readdirSync(pasta).filter((f) => /^202611031(92|93|94|95|96)000_.*\.sql$/.test(f));

  it("as 5 migrations da R9 existem", () => {
    expect(arquivos.length).toBe(5);
  });

  it("cada `RAISE EXCEPTION 'peca_teste_xxx:` das migrations tem entrada em MENSAGENS_PECA_TESTE (e vice-versa)", () => {
    const usados = new Set<string>();
    for (const f of arquivos) {
      const sql = readFileSync(pasta + f, "utf8");
      for (const m of sql.matchAll(/RAISE EXCEPTION\s+'(peca_teste_[a-z_]+):/g)) usados.add(m[1]);
    }
    expect(usados.size).toBeGreaterThanOrEqual(10);
    expect([...usados].sort()).toEqual(Object.keys(MENSAGENS_PECA_TESTE).sort());
  });
});

describe("Cadastro › Serviço — excluir fornecedor no histórico de peça teste (23503, Ruling 29)", () => {
  const SRC = readFileSync(ROOT + "src/routes/_authenticated/cadastro.servico.tsx", "utf8");
  it("a FK de modelo_peca_teste_tentativas.empresa_id mostra o texto PT próprio (antes da FK da M.O.)", () => {
    expect(SRC).toContain('"Este fornecedor está no histórico de peça teste de algum produto e não pode ser excluído."');
    expect(SRC).toContain("modelo_peca_teste_tentativas_empresa_id_fkey");
    expect(SRC).toContain('on table "modelo_peca_teste_tentativas"');
    expect(SRC.indexOf("TEXTO_EMPRESA_EM_USO_NA_PECA_TESTE;")).toBeLessThan(SRC.indexOf("TEXTO_EMPRESA_EM_USO_NA_MO;"));
    // o nome da FK é o que o Postgres de fato gera (inline REFERENCES) — confere na migration da base
    const base = readFileSync(ROOT + "supabase/migrations/20261103192000_urg_r9_peca_teste_base.sql", "utf8");
    expect(base).toMatch(/empresa_id uuid REFERENCES public\.empresas\(id\)/);
  });
  it("a exclusão de empresa continua passando por mensagemExcluirEmpresa", () => {
    expect(SRC).toContain("onError: (e: any) => toast.error(mensagemExcluirEmpresa(e))");
  });
});
