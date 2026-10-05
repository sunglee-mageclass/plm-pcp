// Edição rápida do card de Etapas PL (PCP › Etapas) — `salvar_terceirizados` é ESTADO COMPLETO por CAD (apaga o serviço que não
// vem em `_blocos` e grava TODAS as colunas de cada bloco). Bug de perda de dado (out/2026): a edição rápida mandava só o bloco do
// card → apagava os OUTROS serviços do CAD e zerava nf_saida/nf_entrada/peca_foto/peca_foto_data. O payload agora é o MESMO do
// sheet do PCP › Serviços (src/lib/servicos-payload.ts) com só o campo alterado.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  montarPayloadEdicaoRapida,
  blocoDeLinha,
  blocoParaPayload,
  ServicoSumiuError,
  type CampoRapido,
} from "@/lib/servicos-payload";
import { mensagemErro } from "@/lib/erro-mensagem";

const CAD = "cad00000-0000-4000-8000-000000000001";
const A = "aaaa0000-0000-4000-8000-00000000000a"; // serviço do card (PL)
const B = "bbbb0000-0000-4000-8000-00000000000b"; // outro serviço PL do mesmo CAD
const C = "cccc0000-0000-4000-8000-00000000000c"; // serviço interno (oficina) do mesmo CAD

// Linhas como o PostgREST devolve (`select("*")`): datas em texto, numeric em número, jsonb em objeto.
const linhaA = {
  id: A,
  cad_id: CAD,
  tenant_id: "t",
  rev: 4,
  ativo: true,
  interno: false,
  categoria_terceirizado_id: "cat-costura",
  empresa_id: "emp-1",
  representante_id: "rep-1",
  colaborador_id: null,
  preco_metro_unidade: 12.5,
  aprovado: false,
  quantidade_enviada: 100,
  quantidade_recebida: 90,
  quantidade_defeito: 2,
  desconto_total: 10,
  multa_total: 3,
  numero_parcelas: 2,
  data_enviado: "2026-10-01",
  data_prevista: "2026-10-20",
  data_entregue: null,
  status: "em_andamento",
  observacao: "obs A",
  aviamentos_enviados: [{ aviamento_id: "avi-1", variante_aviamento_id: "var-1" }],
  tecidos_enviados: ["tec-1"],
  detalhado: false,
  grade_detalhe: {},
  pt_data_saida: "2026-09-25",
  pt_data_entrada: null,
  pt_aprovacao: null,
  nf_saida: [{ url: "loja/nf-saida-a.pdf", data: "2026-10-01" }],
  nf_entrada: [{ url: "loja/nf-entrada-a.pdf", data: "2026-10-03" }],
  peca_foto: true,
  peca_foto_previsao: "2026-10-02",
  peca_foto_data: "2026-10-04",
  created_at: "2026-09-01T10:00:00Z",
};
const linhaB = {
  id: B,
  cad_id: CAD,
  tenant_id: "t",
  rev: 7,
  ativo: true,
  interno: false,
  categoria_terceirizado_id: "cat-lavanderia",
  empresa_id: "emp-2",
  representante_id: null,
  colaborador_id: null,
  preco_metro_unidade: 4,
  aprovado: true,
  quantidade_enviada: 0,
  quantidade_recebida: 0,
  quantidade_defeito: 0,
  desconto_total: 0,
  multa_total: 0,
  numero_parcelas: 1,
  data_enviado: null,
  data_prevista: null,
  data_entregue: null,
  status: "pendente",
  observacao: "",
  aviamentos_enviados: [],
  tecidos_enviados: [],
  detalhado: true,
  grade_detalhe: {
    "vt-1": {
      P: { enviada: 5, cortada: 5, recebida: 4, defeito: 1 },
      M: { enviada: 3, cortada: 3, recebida: 3, defeito: 0 },
    },
  },
  pt_data_saida: "2026-09-20",
  pt_data_entrada: "2026-09-22",
  pt_aprovacao: "aprovado",
  nf_saida: [{ url: "loja/nf-saida-b.pdf", data: "2026-09-21" }, { url: "loja/nf-saida-b2.pdf" }],
  nf_entrada: [{ url: "loja/nf-entrada-b.pdf", data: "2026-09-23" }],
  peca_foto: true,
  peca_foto_previsao: null,
  peca_foto_data: "2026-09-30",
};
const linhaC = {
  id: C,
  cad_id: CAD,
  tenant_id: "t",
  rev: 2,
  ativo: true,
  interno: true,
  categoria_terceirizado_id: "cat-oficina",
  empresa_id: null,
  representante_id: null,
  colaborador_id: "col-1",
  preco_metro_unidade: 0,
  aprovado: false,
  quantidade_enviada: 50,
  quantidade_recebida: 0,
  quantidade_defeito: 0,
  desconto_total: 0,
  multa_total: 0,
  numero_parcelas: 1,
  data_enviado: "2026-10-02",
  data_prevista: null,
  data_entregue: null,
  status: "em_andamento",
  observacao: "interno",
  aviamentos_enviados: [],
  tecidos_enviados: [],
  detalhado: false,
  grade_detalhe: {},
  pt_data_saida: null,
  pt_data_entrada: null,
  pt_aprovacao: null,
  nf_saida: [],
  nf_entrada: [],
  peca_foto: false,
  peca_foto_previsao: null,
  peca_foto_data: null,
};
const linhas = [linhaA, linhaB, linhaC];

/** O que o sheet do PCP › Serviços mandaria para a linha (sem edição). */
const doSheet = (r: Record<string, unknown>) => blocoParaPayload(blocoDeLinha(r));

const CAMPOS: [CampoRapido, string | null][] = [
  ["pt_data_saida", "2026-10-05"],
  ["pt_data_entrada", "2026-10-06"],
  ["pt_aprovacao", "aprovado"],
  ["data_enviado", "2026-10-07"],
];

describe("edição rápida de Etapas PL — payload = sheet do PCP com 1 campo alterado", () => {
  it.each(CAMPOS)(
    "%s: manda TODOS os serviços do CAD; só o campo do bloco do card muda",
    (campo, valor) => {
      const { _blocos, _rev_base } = montarPayloadEdicaoRapida({
        linhas,
        blocoId: A,
        campo,
        valor,
      });

      // todos os serviços do CAD vão (nenhum é apagado pela RPC de estado completo)
      expect(_blocos.map((b) => b.id)).toEqual([A, B, C]);
      // os outros: byte a byte o que o sheet mandaria (nada zerado)
      expect(_blocos[1]).toEqual(doSheet(linhaB));
      expect(_blocos[2]).toEqual(doSheet(linhaC));
      // o do card: o do sheet com SÓ o campo trocado
      expect(_blocos[0]).toEqual({ ...doSheet(linhaA), [campo]: valor });
      // `_rev_base` de TODOS os blocos, com o rev lido agora; nunca a marca "apagar tudo"
      // + `_molde_tocado: false`: a edição rápida nunca grava a observação do molde (Camada C1 · I3)
      expect(_rev_base).toEqual({ [A]: 4, [B]: 7, [C]: 2, _molde_tocado: false });
      expect(Object.keys(_rev_base)).not.toContain("_apagar_tudo");
    },
  );

  it("campos por bloco que a RPC sobrescreve (NF, peça-foto, aviamentos, grade…) chegam preservados", () => {
    const { _blocos } = montarPayloadEdicaoRapida({
      linhas,
      blocoId: A,
      campo: "pt_aprovacao",
      valor: "reprovado",
    });
    const [a, b, c] = _blocos;
    // literal (não tautológico): o bloco do card
    expect(a).toEqual({
      id: A,
      categoria_terceirizado_id: "cat-costura",
      interno: false,
      empresa_id: "emp-1",
      representante_id: "rep-1",
      colaborador_id: null,
      ativo: true,
      preco_metro_unidade: 12.5,
      quantidade_enviada: 100,
      quantidade_recebida: 90,
      quantidade_defeito: 2,
      detalhado: false,
      grade_detalhe: {},
      desconto_total: 10,
      multa_total: 3,
      numero_parcelas: 2,
      data_enviado: "2026-10-01",
      data_prevista: "2026-10-20",
      data_entregue: null,
      observacao: "obs A",
      aviamentos_enviados: [{ aviamento_id: "avi-1", variante_aviamento_id: "var-1" }],
      tecidos_enviados: ["tec-1"],
      pt_data_saida: "2026-09-25",
      pt_data_entrada: null,
      pt_aprovacao: "reprovado",
      nf_saida: [{ url: "loja/nf-saida-a.pdf", data: "2026-10-01" }],
      nf_entrada: [{ url: "loja/nf-entrada-a.pdf", data: "2026-10-03" }],
      peca_foto: true,
      peca_foto_previsao: "2026-10-02",
      peca_foto_data: "2026-10-04",
    });
    for (const [p, r] of [
      [b, linhaB],
      [c, linhaC],
    ] as const) {
      expect(p.nf_saida).toEqual(r.nf_saida);
      expect(p.nf_entrada).toEqual(r.nf_entrada);
      expect(p.peca_foto).toBe(r.peca_foto);
      expect(p.peca_foto_data).toBe(r.peca_foto_data);
      expect(p.peca_foto_previsao).toBe(r.peca_foto_previsao);
      expect(p.pt_data_saida).toBe(r.pt_data_saida);
      expect(p.pt_aprovacao).toBe(r.pt_aprovacao);
      expect(p.grade_detalhe).toEqual(r.grade_detalhe);
      expect(p.empresa_id).toBe(r.empresa_id);
      expect(p.colaborador_id).toBe(r.colaborador_id);
    }
    // detalhado: os totais vão como a Σ da grade (mesma regra do sheet)
    expect([b.quantidade_enviada, b.quantidade_recebida, b.quantidade_defeito]).toEqual([8, 7, 1]);
  });

  it("serviço inativo do CAD vai com ativo:false (nem apagado nem reativado)", () => {
    const inativo = { ...linhaB, id: "dddd0000-0000-4000-8000-00000000000d", ativo: false, rev: 1 };
    const { _blocos, _rev_base } = montarPayloadEdicaoRapida({
      linhas: [linhaA, inativo],
      blocoId: A,
      campo: "data_enviado",
      valor: null,
    });
    expect(_blocos.map((b) => [b.id, b.ativo])).toEqual([
      [A, true],
      [inativo.id, false],
    ]);
    expect(_rev_base).toEqual({ [A]: 4, [inativo.id]: 1, _molde_tocado: false });
  });

  it("[urg R4b] bloco nascido da M.O. (mo_linha_id) vai SEM a chave mo_linha_id — o campo e so leitura", () => {
    const { _blocos } = montarPayloadEdicaoRapida({
      linhas: [{ ...linhaA, mo_linha_id: "mo-1" }, linhaB, linhaC],
      blocoId: A,
      campo: "data_enviado",
      valor: "2026-10-07",
    });
    for (const b of _blocos) expect(Object.keys(b)).not.toContain("mo_linha_id");
    expect(blocoDeLinha({ ...linhaA, mo_linha_id: "mo-1" }).mo_linha_id).toBe("mo-1");
  });

  it("serviço do card sumiu do servidor (ou CAD sem serviços): recusa, nada é montado", () => {
    expect(() =>
      montarPayloadEdicaoRapida({
        linhas: [linhaB, linhaC],
        blocoId: A,
        campo: "pt_data_saida",
        valor: null,
      }),
    ).toThrow(ServicoSumiuError);
    expect(() =>
      montarPayloadEdicaoRapida({ linhas: [], blocoId: A, campo: "pt_data_saida", valor: null }),
    ).toThrow(ServicoSumiuError);
    let erro: unknown;
    try {
      montarPayloadEdicaoRapida({ linhas: [], blocoId: A, campo: "pt_data_saida", valor: null });
    } catch (e) {
      erro = e;
    }
    expect(mensagemErro(erro, "Erro ao salvar")).toBe(
      "Este serviço foi excluído por outra pessoa. O quadro foi atualizado.",
    );
  });

  it("conflito (P0409) do servidor vira a mensagem de conflito de sempre", () => {
    expect(
      mensagemErro(
        { code: "P0409", message: "conflito_versao: um servico foi salvo por outra pessoa" },
        "x",
      ),
    ).toMatch(/Outra pessoa salvou/);
  });
});

describe("[urg R5] peca_foto_previsao — roundtrip linha -> bloco -> payload", () => {
  it("a previsao lida volta no payload (a edicao rapida nao a zera) e a chave SEMPRE vai", () => {
    expect(blocoDeLinha(linhaA).peca_foto_previsao).toBe("2026-10-02");
    expect(doSheet(linhaA).peca_foto_previsao).toBe("2026-10-02");
    // linha sem a coluna (banco antigo / select parcial) = null, mas a chave existe no payload
    const { peca_foto_previsao: _omit, ...semColuna } = linhaA;
    void _omit;
    const p = doSheet(semColuna);
    expect(Object.keys(p)).toContain("peca_foto_previsao");
    expect(p.peca_foto_previsao).toBeNull();
  });
  it("bloco interno manda peca_foto_previsao null (limpa); PL mantem", () => {
    const interno = { ...blocoDeLinha(linhaA), interno: true };
    expect(blocoParaPayload(interno).peca_foto_previsao).toBeNull();
    expect(blocoParaPayload({ ...interno, interno: false }).peca_foto_previsao).toBe("2026-10-02");
  });
  it("edicao rapida de outro campo mantem a previsao do bloco do card e dos demais", () => {
    const { _blocos } = montarPayloadEdicaoRapida({
      linhas,
      blocoId: A,
      campo: "pt_aprovacao",
      valor: "aprovado",
    });
    expect(_blocos.map((b) => b.peca_foto_previsao)).toEqual(["2026-10-02", null, null]);
  });
});

describe("useSalvarEtapaRapida — fonte (anti-regressão do payload de 1 bloco)", () => {
  const src = readFileSync(
    fileURLToPath(
      new URL("../../src/components/producao/etapas/useSalvarEtapaRapida.ts", import.meta.url),
    ),
    "utf8",
  );
  it("relê TODAS as linhas do CAD e monta o payload pela função compartilhada", () => {
    expect(src).toMatch(
      /from\("producao_terceirizados"\)\.select\("\*"\)\.eq\("cad_id", card\.cadId\)/,
    );
    expect(src).toContain("montarPayloadEdicaoRapida(");
    expect(src).not.toMatch(/_blocos:\s*\[/); // nunca um array literal de 1 bloco
    expect(src).not.toContain("_apagar_tudo");
    expect(src).not.toContain("MARCA_APAGAR_TUDO");
  });
});

describe("PCP › Serviços — o sheet usa as MESMAS funções do payload", () => {
  const src = readFileSync(
    fileURLToPath(
      new URL("../../src/routes/_authenticated/pcp.servicos.$modeloId.tsx", import.meta.url),
    ),
    "utf8",
  );
  it("blocosFromRows = blocoDeLinha e _blocos = blocoParaPayload", () => {
    expect(src).toContain("rows.map(blocoDeLinha)");
    expect(src).toContain("blocos.map(blocoParaPayload)");
  });
});
