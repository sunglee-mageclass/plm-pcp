// Casos COMPARTILHADOS do anti-drift do requisito "Peça teste aprovada" (R9, plan-c T3): o MESMO arquivo alimenta
//   tests/unit/peca-teste-requisito.test.ts  → src/lib/peca-teste.ts (`pecaTesteAprovadaModelo`, TS)
//   tests/integration/urgc-r9-kanban.test.ts → chave `peca_teste_aprovada` de `avaliar_condicoes_kanban` (SQL, só na cópia local:
//                                              cada caso vira um card com categorias, linhas de M.O. e tentativas semeadas na txn)
// Fornecedores por RÓTULO ("F1"/"F2"): o TS compara os rótulos; o teste de integração os troca por empresas reais da loja.
// Mudou a regra? Mude TS (src/lib/peca-teste.ts), SQL (gerar-c.mjs, bloco r9c) e AQUI.
import type { AprovacaoPecaTeste, LinhaRequisito } from "../../src/lib/peca-teste";

export type FornecedorRotulo = "F1" | "F2" | null;
/** Tipo de serviço da linha: `exige` = categoria com "Exige peça teste" ligado; `sem_switch` = categoria com ele desligado;
 *  `sem_tipo` = linha "Geral (legado)", sem categoria. */
export type TipoLinha = "exige" | "sem_switch" | "sem_tipo";
export type CasoTentativa = { numero: number; aprovacao: AprovacaoPecaTeste; fornecedor: FornecedorRotulo };
export type CasoLinha = {
  tipo: TipoLinha;
  mo_aprovado: boolean | null;
  fornecedor: FornecedorRotulo;
  tentativas: CasoTentativa[];
};
export type CasoPecaTeste = { nome: string; linhas: CasoLinha[]; esperado: boolean };

const t = (numero: number, aprovacao: AprovacaoPecaTeste, fornecedor: FornecedorRotulo = null): CasoTentativa => ({
  numero,
  aprovacao,
  fornecedor,
});

export const CASOS_PECA_TESTE: CasoPecaTeste[] = [
  { nome: "sem linhas de M.O. (vácuo)", linhas: [], esperado: true },
  {
    nome: "linha sem tipo (Geral legado), M.O. pendente",
    linhas: [{ tipo: "sem_tipo", mo_aprovado: null, fornecedor: "F1", tentativas: [] }],
    esperado: true,
  },
  {
    nome: "tipo sem o switch, M.O. pendente, sem tentativa",
    linhas: [{ tipo: "sem_switch", mo_aprovado: null, fornecedor: "F1", tentativas: [] }],
    esperado: true,
  },
  {
    nome: "exige: M.O. PENDENTE com a peça aprovada",
    linhas: [{ tipo: "exige", mo_aprovado: null, fornecedor: "F1", tentativas: [t(1, "aprovado", "F1")] }],
    esperado: false,
  },
  {
    nome: "exige: M.O. REPROVADA com a peça aprovada",
    linhas: [{ tipo: "exige", mo_aprovado: false, fornecedor: "F1", tentativas: [t(1, "aprovado", "F1")] }],
    esperado: false,
  },
  {
    nome: "exige: M.O. aprovada, 0 tentativas (1ª virtual)",
    linhas: [{ tipo: "exige", mo_aprovado: true, fornecedor: "F1", tentativas: [] }],
    esperado: false,
  },
  {
    nome: "exige: M.O. aprovada, peça em teste (sem decisão)",
    linhas: [{ tipo: "exige", mo_aprovado: true, fornecedor: "F1", tentativas: [t(1, null)] }],
    esperado: false,
  },
  {
    nome: "exige: M.O. aprovada, última REPROVADA",
    linhas: [{ tipo: "exige", mo_aprovado: true, fornecedor: "F1", tentativas: [t(1, "reprovado", "F1")] }],
    esperado: false,
  },
  {
    nome: "exige: M.O. aprovada, última APROVADA (mesmo fornecedor)",
    linhas: [{ tipo: "exige", mo_aprovado: true, fornecedor: "F1", tentativas: [t(1, "aprovado", "F1")] }],
    esperado: true,
  },
  {
    nome: "exige: reprovada nº 1 + aprovada nº 2 (atual = a 2)",
    linhas: [{ tipo: "exige", mo_aprovado: true, fornecedor: "F2", tentativas: [t(1, "reprovado", "F1"), t(2, "aprovado", "F2")] }],
    esperado: true,
  },
  {
    nome: "exige: aprovada antiga nº 1 + reprovada nova nº 2 (atual = a 2)",
    linhas: [{ tipo: "exige", mo_aprovado: true, fornecedor: "F1", tentativas: [t(1, "aprovado", "F1"), t(2, "reprovado", "F1")] }],
    esperado: false,
  },
  {
    nome: "exige: reprovada nº 1 + nº 2 em teste",
    linhas: [{ tipo: "exige", mo_aprovado: true, fornecedor: "F1", tentativas: [t(1, "reprovado", "F1"), t(2, null)] }],
    esperado: false,
  },
  {
    nome: "fornecedor: aprovada congelada com F1, linha hoje com F2 (revisão T1, achado 1)",
    linhas: [{ tipo: "exige", mo_aprovado: true, fornecedor: "F2", tentativas: [t(1, "aprovado", "F1")] }],
    esperado: false,
  },
  {
    nome: "fornecedor: aprovada congelada com F1, linha hoje SEM fornecedor",
    linhas: [{ tipo: "exige", mo_aprovado: true, fornecedor: null, tentativas: [t(1, "aprovado", "F1")] }],
    esperado: false,
  },
  {
    nome: "fornecedor: aprovada SEM fornecedor congelado (legado) e linha sem fornecedor (null × null conta)",
    linhas: [{ tipo: "exige", mo_aprovado: true, fornecedor: null, tentativas: [t(1, "aprovado", null)] }],
    esperado: true,
  },
  {
    nome: "fornecedor: aprovada SEM fornecedor congelado, linha com F1",
    linhas: [{ tipo: "exige", mo_aprovado: true, fornecedor: "F1", tentativas: [t(1, "aprovado", null)] }],
    esperado: false,
  },
  {
    nome: "2 linhas exigindo: uma aprovada, outra sem peça",
    linhas: [
      { tipo: "exige", mo_aprovado: true, fornecedor: "F1", tentativas: [t(1, "aprovado", "F1")] },
      { tipo: "exige", mo_aprovado: true, fornecedor: "F2", tentativas: [] },
    ],
    esperado: false,
  },
  {
    nome: "2 linhas exigindo, ambas aprovadas (fornecedores diferentes)",
    linhas: [
      { tipo: "exige", mo_aprovado: true, fornecedor: "F1", tentativas: [t(1, "aprovado", "F1")] },
      { tipo: "exige", mo_aprovado: true, fornecedor: "F2", tentativas: [t(1, "reprovado", "F1"), t(2, "aprovado", "F2")] },
    ],
    esperado: true,
  },
  {
    nome: "mistas: exigindo aprovada + sem switch pendente + sem tipo pendente",
    linhas: [
      { tipo: "exige", mo_aprovado: true, fornecedor: "F1", tentativas: [t(1, "aprovado", "F1")] },
      { tipo: "sem_switch", mo_aprovado: null, fornecedor: "F2", tentativas: [] },
      { tipo: "sem_tipo", mo_aprovado: false, fornecedor: null, tentativas: [] },
    ],
    esperado: true,
  },
  {
    nome: "switch DESLIGADO com reprovada (Ruling 5: a condição ignora o tipo)",
    linhas: [{ tipo: "sem_switch", mo_aprovado: true, fornecedor: "F1", tentativas: [t(1, "reprovado", "F1")] }],
    esperado: true,
  },
];

/** A entrada do TS para um caso (rótulos de fornecedor viram os ids; o integração passa o mapa rótulo → empresa real). */
export function entradaDoCaso(caso: CasoPecaTeste, ids: Record<"F1" | "F2", string> = { F1: "F1", F2: "F2" }): LinhaRequisito[] {
  const id = (f: FornecedorRotulo) => (f === null ? null : ids[f]);
  return caso.linhas.map((l) => ({
    exige: l.tipo === "exige",
    mo_aprovado: l.mo_aprovado,
    empresa_id: id(l.fornecedor),
    tentativas: l.tentativas.map((x) => ({ numero: x.numero, aprovacao: x.aprovacao, empresa_id: id(x.fornecedor) })),
  }));
}
