// Casos COMPARTILHADOS do anti-drift do requisito "Peça teste aprovada" POR TIPO: o MESMO arquivo alimenta
//   tests/unit/peca-teste-requisito.test.ts          → src/lib/peca-teste-requisito.ts (`pecaTesteAprovadaModelo`, TS)
//   tests/integration/peca-teste-tipo-antidrift.test.ts → chave `peca_teste_aprovada` do avaliador do Dev E do PL (SQL, só na cópia local:
//                                                          cada caso vira um card com categorias, linhas de M.O. e tentativas semeadas na txn)
// Mudou a regra? Mude TS (src/lib/peca-teste-requisito.ts), SQL (migration 20261129110000) e AQUI.
import type { AprovacaoPecaTeste } from "../../src/lib/peca-teste-requisito";

/** Tipo da linha: `exige`/`exige2` = categorias com "Exige peça teste" ligado; `sem_switch` = categoria com ele desligado;
 *  `sem_tipo` = linha "Geral (legado)", sem categoria. */
export type TipoLinha = "exige" | "exige2" | "sem_switch" | "sem_tipo";
export type CasoLinha = { tipo: TipoLinha; mo_aprovado: boolean | null };
/** Tentativa da trilha do TIPO (`exige`/`exige2`), sem fornecedor: o fornecedor é da tentativa e não entra no requisito. */
export type CasoTentativa = { tipo: "exige" | "exige2"; numero: number; aprovacao: AprovacaoPecaTeste };
export type CasoPecaTeste = { nome: string; linhas: CasoLinha[]; tentativas: CasoTentativa[]; esperado: boolean };

const L = (tipo: TipoLinha, mo_aprovado: boolean | null): CasoLinha => ({ tipo, mo_aprovado });
const T = (tipo: "exige" | "exige2", numero: number, aprovacao: AprovacaoPecaTeste): CasoTentativa => ({ tipo, numero, aprovacao });

export const CASOS_PECA_TESTE: CasoPecaTeste[] = [
  { nome: "sem linhas de M.O. (vácuo)", linhas: [], tentativas: [], esperado: true },
  { nome: "linha sem tipo (Geral legado), M.O. pendente", linhas: [L("sem_tipo", null)], tentativas: [], esperado: true },
  { nome: "tipo sem o switch, M.O. pendente, sem tentativa", linhas: [L("sem_switch", null)], tentativas: [], esperado: true },
  { nome: "exige: M.O. PENDENTE com a peça aprovada", linhas: [L("exige", null)], tentativas: [T("exige", 1, "aprovado")], esperado: false },
  { nome: "exige: M.O. REPROVADA com a peça aprovada", linhas: [L("exige", false)], tentativas: [T("exige", 1, "aprovado")], esperado: false },
  { nome: "exige: M.O. aprovada, 0 tentativas (1ª virtual)", linhas: [L("exige", true)], tentativas: [], esperado: false },
  { nome: "exige: M.O. aprovada, peça em teste (sem decisão)", linhas: [L("exige", true)], tentativas: [T("exige", 1, null)], esperado: false },
  { nome: "exige: M.O. aprovada, última REPROVADA", linhas: [L("exige", true)], tentativas: [T("exige", 1, "reprovado")], esperado: false },
  { nome: "exige: M.O. aprovada, última APROVADA", linhas: [L("exige", true)], tentativas: [T("exige", 1, "aprovado")], esperado: true },
  { nome: "exige: 1ª reprovada, 2ª aprovada (a atual é a maior)", linhas: [L("exige", true)], tentativas: [T("exige", 1, "reprovado"), T("exige", 2, "aprovado")], esperado: true },
  { nome: "exige: 1ª reprovada, 2ª reprovada, 3ª em teste", linhas: [L("exige", true)], tentativas: [T("exige", 1, "reprovado"), T("exige", 2, "reprovado"), T("exige", 3, null)], esperado: false },
  { nome: "POR TIPO: 2 linhas do mesmo tipo, as 2 M.O. aprovadas, 1 trilha aprovada", linhas: [L("exige", true), L("exige", true)], tentativas: [T("exige", 1, "aprovado")], esperado: true },
  { nome: "POR TIPO: 2 linhas do mesmo tipo, 1 M.O. pendente, trilha aprovada", linhas: [L("exige", true), L("exige", null)], tentativas: [T("exige", 1, "aprovado")], esperado: false },
  { nome: "2 tipos que exigem, os 2 aprovados (M.O. + trilha)", linhas: [L("exige", true), L("exige2", true)], tentativas: [T("exige", 1, "aprovado"), T("exige2", 1, "aprovado")], esperado: true },
  { nome: "2 tipos que exigem, um sem tentativa", linhas: [L("exige", true), L("exige2", true)], tentativas: [T("exige", 1, "aprovado")], esperado: false },
  { nome: "exige aprovado + linha de tipo sem o switch pendente", linhas: [L("exige", true), L("sem_switch", null)], tentativas: [T("exige", 1, "aprovado")], esperado: true },
  { nome: "trilha de tipo SEM linha de M.O. (adicionada à mão) em teste não trava (ruling R2)", linhas: [L("exige", true)], tentativas: [T("exige", 1, "aprovado"), T("exige2", 1, null)], esperado: true },
  { nome: "tentativa aprovada de um tipo não vale para OUTRO tipo", linhas: [L("exige2", true)], tentativas: [T("exige", 1, "aprovado")], esperado: false },
];
