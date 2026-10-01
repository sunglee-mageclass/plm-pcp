/**
 * FIXTURES COMPARTILHADAS do Kanban automático (F1). Usadas por:
 *   - tests/unit/kanban-auto.test.ts            → statusDerivado / destinoDrop (TS puro)
 *   - tests/integration/kanban-auto.test.ts     → _kanban_derivar_puro / _kanban_destino_drop_puro (SQL)
 * Os dois lados recebem o MESMO input e precisam devolver o MESMO resultado (anti-drift TS×SQL).
 * Regras normativas: docs/superpowers/plans/2026-09-22-kanban-automatico-f1-banco.md §3.
 */
import type { AcaoDrop, Derivacao, DerivacaoInput } from "@/lib/kanban-auto";

export type ArrasteEsperado = { para: string; acao: AcaoDrop; status: string | null; faltando: string[] };
export type CasoKanban = { nome: string; input: DerivacaoInput; esperado: Derivacao; arrastes: ArrasteEsperado[] };

// Board de exemplo: entrada (manual, sem requisito) · a{x} · b{y} · stand_by (manual) · c{z} · reprovado (manual) · d{w}
export const FLUXO_A = ["entrada", "a", "b", "stand_by", "c", "reprovado", "d"];
export const REQS_A: Record<string, string[]> = { a: ["x"], b: ["y"], c: ["z"], d: ["w"] };

function caso(
  nome: string,
  input: Partial<DerivacaoInput>,
  esperado: Derivacao,
  arrastes: ArrasteEsperado[] = [],
): CasoKanban {
  return {
    nome,
    input: { fluxo: FLUXO_A, reqs: REQS_A, exc: {}, cond: {}, status: null, derivavel: true, ...input },
    esperado,
    arrastes,
  };
}

export const CASOS: CasoKanban[] = [
  caso(
    "1. nada satisfeito → fica na entrada (piso)",
    { cond: {}, status: null },
    { derivavel: true, entrada: "entrada", alvo: "entrada", resultado: "entrada", fixado: false, primeiraFalha: "a", faltando: ["x"] },
    [
      { para: "entrada", acao: "soltar", status: "entrada", faltando: [] },
      { para: "a", acao: "bloquear_faltando", status: null, faltando: ["x"] },
      { para: "stand_by", acao: "fixar", status: "stand_by", faltando: [] },
      { para: "zzz", acao: "fora_do_fluxo", status: null, faltando: [] },
    ],
  ),
  caso(
    "2. x e z sem y → preso ANTES de b (decisão 1: não pula etapa)",
    { cond: { x: true, z: true }, status: "a" },
    { derivavel: true, entrada: "entrada", alvo: "a", resultado: "a", fixado: false, primeiraFalha: "b", faltando: ["y"] },
    [
      { para: "c", acao: "bloquear_faltando", status: "a", faltando: ["y"] },
      { para: "b", acao: "bloquear_faltando", status: "a", faltando: ["y"] },
      { para: "a", acao: "nada", status: "a", faltando: [] },
      { para: "entrada", acao: "bloquear_ja_cumprida", status: "a", faltando: [] },
      { para: "stand_by", acao: "fixar", status: "stand_by", faltando: [] },
    ],
  ),
  caso(
    "3. tudo satisfeito → última automática (status atrasado é normalizado)",
    { cond: { x: true, y: true, z: true, w: true }, status: "b" },
    { derivavel: true, entrada: "entrada", alvo: "d", resultado: "d", fixado: false, primeiraFalha: null, faltando: [] },
    [
      { para: "a", acao: "bloquear_ja_cumprida", status: "b", faltando: [] },
      { para: "d", acao: "soltar", status: "d", faltando: [] },
      { para: "stand_by", acao: "fixar", status: "stand_by", faltando: [] },
    ],
  ),
  caso(
    "4. coluna manual no meio é pulada na caminhada",
    { cond: { x: true, y: true, z: true }, status: "c" },
    { derivavel: true, entrada: "entrada", alvo: "c", resultado: "c", fixado: false, primeiraFalha: "d", faltando: ["w"] },
    [
      { para: "d", acao: "bloquear_faltando", status: "c", faltando: ["w"] },
      { para: "a", acao: "bloquear_ja_cumprida", status: "c", faltando: [] },
      { para: "c", acao: "nada", status: "c", faltando: [] },
      { para: "stand_by", acao: "fixar", status: "stand_by", faltando: [] },
      { para: "reprovado", acao: "fixar", status: "reprovado", faltando: [] },
      { para: "entrada", acao: "bloquear_ja_cumprida", status: "c", faltando: [] },
    ],
  ),
  caso(
    "5. fixado em stand_by: não anda sozinho; os 5 arrastes da tabela",
    { cond: { x: true, y: true, z: true }, status: "stand_by" },
    { derivavel: true, entrada: "entrada", alvo: "c", resultado: "stand_by", fixado: true, primeiraFalha: "d", faltando: ["w"] },
    [
      { para: "d", acao: "bloquear_faltando", status: "stand_by", faltando: ["w"] }, // ALÉM da derivada → continua fixado
      { para: "c", acao: "soltar", status: "c", faltando: [] }, // ATÉ a derivada → solta
      { para: "a", acao: "soltar", status: "c", faltando: [] }, // aquém, fixado → solta p/ derivada
      { para: "reprovado", acao: "fixar", status: "reprovado", faltando: [] }, // manual → fixa
      { para: "entrada", acao: "soltar", status: "c", faltando: [] }, // entrada nunca fixa
      { para: "stand_by", acao: "nada", status: "stand_by", faltando: [] },
    ],
  ),
  caso(
    "6. status na entrada NÃO é fixado (entrada é piso, não trava)",
    { cond: { x: true }, status: "entrada" },
    { derivavel: true, entrada: "entrada", alvo: "a", resultado: "a", fixado: false, primeiraFalha: "b", faltando: ["y"] },
    [{ para: "a", acao: "soltar", status: "a", faltando: [] }],
  ),
  caso(
    "7. reprovado é SEMPRE manual: requisito configurado nele é ignorado na cascata",
    { reqs: { ...REQS_A, reprovado: ["q"] }, cond: { x: true, y: true, z: true, w: true }, status: "reprovado" },
    { derivavel: true, entrada: "entrada", alvo: "d", resultado: "reprovado", fixado: true, primeiraFalha: null, faltando: [] },
    [
      { para: "d", acao: "soltar", status: "d", faltando: [] },
      { para: "c", acao: "soltar", status: "d", faltando: [] },
    ],
  ),
  caso(
    "7b. reprovado com requisito: card automático não precisa do requisito de reprovado",
    { reqs: { ...REQS_A, reprovado: ["q"] }, cond: { x: true, y: true, z: true, w: true }, status: "c" },
    { derivavel: true, entrada: "entrada", alvo: "d", resultado: "d", fixado: false, primeiraFalha: null, faltando: [] },
  ),
  caso(
    "8. não derivável (antes da Ordem de Criação): nada muda, arraste é livre",
    { derivavel: false, status: "b", cond: {} },
    { derivavel: false, entrada: "entrada", alvo: null, resultado: "b", fixado: false, primeiraFalha: null, faltando: [] },
    [
      { para: "a", acao: "fixar", status: "a", faltando: [] },
      { para: "b", acao: "nada", status: "b", faltando: [] },
      { para: "zzz", acao: "fora_do_fluxo", status: "b", faltando: [] },
    ],
  ),
  caso(
    "9. lançado (não derivável) preserva o status",
    { derivavel: false, status: "d", cond: { x: true, y: true, z: true, w: true } },
    { derivavel: false, entrada: "entrada", alvo: null, resultado: "d", fixado: false, primeiraFalha: null, faltando: [] },
  ),
  caso(
    "10. exceção não pula coluna (G-inicial #3): C ignora y, mas B ainda exige y",
    { fluxo: ["a", "b", "c"], reqs: { a: ["x"], b: ["y"], c: ["z"] }, exc: { c: ["y"] }, cond: { x: true, z: true }, status: "a" },
    { derivavel: true, entrada: "a", alvo: "a", resultado: "a", fixado: false, primeiraFalha: "b", faltando: ["y"] },
    [{ para: "c", acao: "bloquear_faltando", status: "a", faltando: ["y"] }],
  ),
  caso(
    "11. status órfão (fora do fluxo) não é fixado → vai para a derivada",
    { cond: { x: true }, status: "coluna_velha" },
    { derivavel: true, entrada: "entrada", alvo: "a", resultado: "a", fixado: false, primeiraFalha: "b", faltando: ["y"] },
    [{ para: "a", acao: "soltar", status: "a", faltando: [] }],
  ),
  caso(
    "12. status NULL (recém-chegado) → derivada",
    { cond: { x: true, y: true }, status: null },
    { derivavel: true, entrada: "entrada", alvo: "b", resultado: "b", fixado: false, primeiraFalha: "c", faltando: ["z"] },
  ),
  caso(
    "13. entrada com requisito próprio que falha: fica no piso e é a 1ª falha",
    { fluxo: ["e", "a"], reqs: { e: ["o"], a: ["x"] }, cond: { x: true }, status: null },
    { derivavel: true, entrada: "e", alvo: "e", resultado: "e", fixado: false, primeiraFalha: "e", faltando: ["o"] },
    [{ para: "a", acao: "bloquear_faltando", status: null, faltando: ["o"] }],
  ),
  caso(
    "14. fluxo vazio → não derivável",
    { fluxo: [], reqs: {}, cond: {}, status: "a" },
    { derivavel: false, entrada: null, alvo: null, resultado: "a", fixado: false, primeiraFalha: null, faltando: [] },
    [{ para: "a", acao: "fora_do_fluxo", status: "a", faltando: [] }],
  ),
  caso(
    "15. comprado: fluxo reduzido com cascata própria (sem requisito → fica na entrada)",
    { fluxo: ["em_modelagem", "stand_by", "aprovado"], reqs: { aprovado: ["data_aprovacao"] }, cond: {}, status: "em_modelagem" },
    { derivavel: true, entrada: "em_modelagem", alvo: "em_modelagem", resultado: "em_modelagem", fixado: false, primeiraFalha: "aprovado", faltando: ["data_aprovacao"] },
    [{ para: "aprovado", acao: "bloquear_faltando", status: "em_modelagem", faltando: ["data_aprovacao"] }],
  ),
  caso(
    "15b. comprado com requisito satisfeito → aprovado",
    { fluxo: ["em_modelagem", "stand_by", "aprovado"], reqs: { aprovado: ["data_aprovacao"] }, cond: { data_aprovacao: true }, status: "em_modelagem" },
    { derivavel: true, entrada: "em_modelagem", alvo: "aprovado", resultado: "aprovado", fixado: false, primeiraFalha: null, faltando: [] },
  ),
  caso(
    "16. status com maiúsculas/espaço é normalizado",
    { cond: { x: true, y: true, z: true }, status: " Stand_By " },
    { derivavel: true, entrada: "entrada", alvo: "c", resultado: "stand_by", fixado: true, primeiraFalha: "d", faltando: ["w"] },
  ),
];

// ─────────────── Gates por posição (≡ _kanban_status_gate × statusParaGate) — medios R14 kanban #7, P-190 A ───────────────
// Board da Loja Teste reescrito pela integração (tests/integration/kanban-reprovado-gate.test.ts): as keys de
// normalizeKanbanStatuses(["Entrada","Etapa A","Etapa B","Stand By","Etapa C","Reprovado","Aprovado"]) e os requisitos
// com condições REAIS (a integração preenche o campo de cada condição marcada em `cond`). 'reprovado' fica DEPOIS de
// 'etapa_c' (a etapa da REF/Explosão dos testes): sem a exceção do P-190 A, o próprio status passaria pela régua.
// O lado TS deriva com statusDerivado e chama statusParaGate; o lado SQL cria o card e chama _kanban_status_gate.
// `esperado` null = SEM posição para os gates (nada passa: nem REF nem Explosão).
export const FLUXO_GATE = ["entrada", "etapa_a", "etapa_b", "stand_by", "etapa_c", "reprovado", "aprovado"];
export const BOARD_GATE = ["Entrada", "Etapa A", "Etapa B", "Stand By", "Etapa C", "Reprovado", "Aprovado"];
export const REQS_GATE: Record<string, string[]> = {
  etapa_a: ["data_desenho_tecnico"], etapa_b: ["data_piloto1"], etapa_c: ["data_piloto2"], aprovado: ["data_aprovacao"],
};
// `plan` (leves L3 fix round 1, A1 / P-213 A) = status_planejamento do card; 'reprovado' ⇒ SEM posição em qualquer chave.
export type CasoGate = { nome: string; ligado: boolean; status: string; cond: Record<string, boolean>; esperado: string | null; plan?: string };
const TUDO_GATE = { data_desenho_tecnico: true, data_piloto1: true, data_piloto2: true, data_aprovacao: true };
const ATE_C_GATE = { data_desenho_tecnico: true, data_piloto1: true, data_piloto2: true };
export const GATE_CASOS: CasoGate[] = [
  { nome: "G1. chave DESLIGADA + reprovado → status gravado (nada muda)", ligado: false, status: "reprovado", cond: TUDO_GATE, esperado: "reprovado" },
  { nome: "G2. chave ligada + reprovado com posição derivada = aprovado → SEM posição (P-190 A)", ligado: true, status: "reprovado", cond: TUDO_GATE, esperado: null },
  { nome: "G3. chave ligada + reprovado com posição derivada = etapa_c (≥ etapa da REF/Explosão) → SEM posição", ligado: true, status: "reprovado", cond: ATE_C_GATE, esperado: null },
  { nome: "G4. chave ligada + reprovado sem nada satisfeito → SEM posição", ligado: true, status: "reprovado", cond: {}, esperado: null },
  { nome: "G5. chave ligada + stand_by fixado → posição DERIVADA (outras manuais seguem a decisão 10)", ligado: true, status: "stand_by", cond: ATE_C_GATE, esperado: "etapa_c" },
  { nome: "G6. chave ligada + card em coluna automática → posição derivada", ligado: true, status: "etapa_a", cond: { data_desenho_tecnico: true }, esperado: "etapa_a" },
  { nome: "G7. chave DESLIGADA + stand_by → status gravado", ligado: false, status: "stand_by", cond: ATE_C_GATE, esperado: "stand_by" },
  { nome: "G8. chave DESLIGADA + Dev em aprovado mas reprovado no PLANEJAMENTO → SEM posição (L3 fix 1, P-213 A)", ligado: false, status: "aprovado", cond: TUDO_GATE, esperado: null, plan: "reprovado" },
  { nome: "G9. chave ligada + stand_by fixado (derivada etapa_c) e reprovado no PLANEJAMENTO → SEM posição", ligado: true, status: "stand_by", cond: ATE_C_GATE, esperado: null, plan: "reprovado" },
  { nome: "G10. chave DESLIGADA + aprovado com Planejamento 'planejado' → status gravado (controle do G8)", ligado: false, status: "aprovado", cond: TUDO_GATE, esperado: "aprovado", plan: "planejado" },
];
