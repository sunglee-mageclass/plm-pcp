// F3.4 — regras PURAS do produto COMPRADO (revenda/importado) no Sheet unificado do Planejamento. Zero React, zero
// Supabase — tests/unit/planejamento-comprado.test.ts. Fontes: decisões F3 #3 (Origem "Importado"), #4 (a grade
// cor × tamanho é a fonte única do comprado), #8 (seções do Dev seguem o "Fluxo de Revenda"); invariante #13; D1 do
// plano F3.4 (troca de Origem). A visibilidade vem do SSOT `src/lib/revenda-config.ts` — aqui só chega o `campoVisivel`.
import { fmtInt } from "@/lib/format";
import { REVENDA_COND_NA } from "@/lib/kanban-condicoes";
import { normalizarOrigem, type Origem } from "@/lib/origem";
import type { GradeRow } from "@/components/desenvolvimento/modelo-detail/types";
import type { Draft } from "@/components/planejamento/modelo-shared";
import { seloPorChaves, type SeloSecao } from "./ficha/selos-bom";
import type { GradeRowDb } from "./ficha/ficha-calc";

// ── Origem (decisão F3 #3 + D1; R3/R7 do G-plano F3.4) ─────────────────────────────────────────────────────────────
export type OpcaoOrigem = { value: Origem; label: string; disabled: boolean; motivo: string | null };

/** Produto espelho do card numa das duas telas (invariante #13 — 1:1 POR TABELA, `enforce_unique_fk`). */
export type EspelhoProduto = { existe: boolean; temPedido: boolean };
/**
 * Os DOIS espelhos do card, qualquer que seja a origem (um card interno pode já ter sido comprado — o produto continua
 * vinculado na tela dele). `importado: null` = INDETERMINADO: com o módulo Produto Importado desligado a RLS RESTRICTIVE
 * `modgate_pi_*` esconde as linhas — "vazio" não prova nada. `produtos_acabados` não tem modgate: sempre legível.
 */
export type EspelhosCard = { acabado: EspelhoProduto; importado: EspelhoProduto | null };
export const SEM_ESPELHOS: EspelhosCard = { acabado: { existe: false, temPedido: false }, importado: { existe: false, temPedido: false } };
/** R7 — texto do Select travado por edição pendente (a ficha projeta pela origem do RASCUNHO; a grade segue a SALVA). */
export const MOTIVO_EDICAO_PENDENTE = "Salve (ou descarte) as edições de Tecidos/Aviamentos/Insumos/Grade antes de trocar a Origem.";

/** Linhas lidas de cada tela (`ocs` = pedidos do produto) → espelhos. `importados: null` = módulo desligado (indeterminado). */
export function espelhosDoCard(i: {
  acabados: { ocs: { id: string }[] | null }[];
  importados: { ocs: { id: string }[] | null }[] | null;
}): EspelhosCard {
  const um = (rows: { ocs: { id: string }[] | null }[]): EspelhoProduto =>
    ({ existe: rows.length > 0, temPedido: rows.some((r) => (r.ocs ?? []).length > 0) });
  return { acabado: um(i.acabados), importado: i.importados === null ? null : um(i.importados) };
}

/**
 * Por que o card NÃO pode ir de `de` para `para` (null = pode). Regras (plano F3.4 §8 D1 + G-plano F3.4 R3):
 *  • → Importado exige o módulo `produto_importado` ligado (logo, Revenda → Importado trava com ele desligado).
 *  • Espelhos ainda carregando ou com erro (`espelhos` null) ⇒ nenhuma troca no escuro.
 *  • NUNCA dois espelhos (invariante #13): ir p/ uma família com produto vinculado na OUTRA é barrado — vale também p/ o
 *    card interno que já foi comprado.
 *  • Interno → comprado: só com a seção Tecidos VAZIA — tecido no BOM reserva estoque (`_estoque_tecido_core` não filtra
 *    origem) e, num comprado, ficaria escondido reservando.
 *  • Saída de um comprado: o produto DELE tem de ser legível (importado com o módulo desligado ⇒ indeterminado ⇒ trava —
 *    logo, Importado → Revenda também trava); D1 (i) — com pedido (OC) do produto, a Origem não muda mais.
 */
export function motivoTrocaOrigem(i: {
  de: Origem; para: Origem; piOn: boolean; temTecidos: boolean;
  /** null = carregando ou com erro (falha fechada). */
  espelhos: EspelhosCard | null;
}): string | null {
  if (i.de === i.para) return null;
  if (i.para === "importado" && !i.piOn) return "O módulo Produto Importado está desligado nesta loja.";
  if (!i.espelhos) return "Conferindo o produto vinculado…";
  const { acabado, importado } = i.espelhos;
  if (i.para === "importado" && acabado.existe) {
    return "Este card tem produto vinculado no Produto Acabado — para virar Importado, exclua o produto na tela dele.";
  }
  if (i.para === "revenda" && importado?.existe) {
    return "Este card tem produto vinculado no Produto Importado — para virar Revenda, exclua o produto na tela dele.";
  }
  if (i.de === "interno") {
    return i.temTecidos ? "Tire os tecidos da seção Tecidos / Forros / Entretelas e salve antes — tecido no BOM reserva estoque." : null;
  }
  const meu = i.de === "revenda" ? acabado : importado;
  if (meu === null) return "O módulo Produto Importado está desligado nesta loja — sem conferir o produto vinculado, a Origem não muda.";
  // D1 (i) — DECIDIDO pelo dono em 24/set: comprado com OC não volta a Interno (Revenda↔Importado já trava pelo espelho).
  if (meu.temPedido) return "O produto deste card já tem pedido (OC) — a Origem não muda mais.";
  return null;
}

/**
 * Opções do Select "Origem" (Informações Gerais). "Revenda" segue SEMPRE na lista, como hoje (InfoGeraisSecao.tsx:59-60 da
 * F3.2 — a auto-criação do Produto Acabado é que depende do módulo). "Importado" com o módulo ligado ou se o card JÁ é
 * importado (p/ exibir o valor). O valor ATUAL nunca trava. R7: com edição pendente (ficha tocada ou grade cor × tamanho
 * editada) NADA muda — nem de volta à salva: a referência do BOM foi calculada com a projeção de agora. Sem edição, as
 * regras de troca olham a origem SALVA (de onde o card vem; voltar a ela é livre); card novo não tem regra.
 */
export function opcoesOrigem(i: {
  isEdit: boolean; salva: string | null | undefined; atual: string | null | undefined; piOn: boolean;
  temTecidos: boolean; espelhos: EspelhosCard | null;
  /** R7 — a ficha (Tecidos/Aviamentos/Insumos) está tocada OU a grade cor × tamanho tem edição não salva. */
  edicaoPendente: boolean;
}): OpcaoOrigem[] {
  const salva = normalizarOrigem(i.salva);
  const atual = normalizarOrigem(i.atual);
  const lista: { value: Origem; label: string }[] = [
    { value: "interno", label: "Interno" },
    { value: "revenda", label: "Revenda" },
  ];
  if (i.piOn || atual === "importado" || salva === "importado") lista.push({ value: "importado", label: "Importado" });
  return lista.map((o) => {
    const motivo = !i.isEdit || o.value === atual ? null
      : i.edicaoPendente ? MOTIVO_EDICAO_PENDENTE
        : o.value === salva ? null
          : motivoTrocaOrigem({ de: salva, para: o.value, piOn: i.piOn, temTecidos: i.temTecidos, espelhos: i.espelhos });
    return { ...o, disabled: motivo !== null, motivo };
  });
}

// ── Seções da ficha por origem (decisões F3 #4/#8) ──────────────────────────────────────────────────────────────────
export type SecoesFicha = {
  tecidos: boolean; aviamentos: boolean; insumos: boolean;
  /** "Grade por variante do Tecido 1" (ModeloGradeSection) — só interno (decisão F3 #4). */
  gradeTecido: boolean;
  cad: boolean;
  /** Grade cor × tamanho do produto comprado (GradeRevendaSecao) — a fonte única do comprado. */
  gradeComprado: boolean;
  /** F3.4 (acréscimo do controlador, comparação Dev × Planejamento) — seção 3 "Desenvolvimento — equipe e cronograma"
   *  (DevEquipeSection); no Dev, `s1` esconde "Informações Básicas" inteira (ModeloDetailPanel.tsx:1621).
   *  Fix Lote A (revisão) — `revendaCampoVisivel` devolve SEMPRE `true` para `"s1"` (revenda-config.ts:69; a Config
   *  mostra `s1` como "sempre ativa"), então na prática este campo é sempre `true` hoje — existe só por paridade
   *  com o Dev (a chave `s1` existe no SSOT e pode um dia deixar de ser sempre-ativa) e não tem efeito hoje. */
  equipe: boolean;
};
export const SECOES_FICHA_INTERNO: SecoesFicha = {
  tecidos: true, aviamentos: true, insumos: true, gradeTecido: true, cad: true, gradeComprado: false, equipe: true,
};
/** Interno: tudo. Comprado: as chaves do Fluxo de Revenda (Dev ModeloDetailPanel.tsx:1621-1623) — `s2` Tecidos, `s3`
 *  Aviamentos, `s3e` Insumos, `s-cad` CAD, `s4` Grade (aqui, a cor × tamanho), `s1` equipe/cronograma. */
export function secoesFicha(isComprado: boolean, campoVisivel: (key: string) => boolean): SecoesFicha {
  if (!isComprado) return SECOES_FICHA_INTERNO;
  return {
    tecidos: campoVisivel("s2"), aviamentos: campoVisivel("s3"), insumos: campoVisivel("s3e"),
    gradeTecido: false, cad: campoVisivel("s-cad"), gradeComprado: campoVisivel("s4"),
    equipe: campoVisivel("s1"),
  };
}

// ── Selos por origem ───────────────────────────────────────────────────────────────────────────────────────────────
/** Requisitos configurados (união) que valem p/ o card: comprado ignora os IMPOSSÍVEIS p/ comprado (`REVENDA_COND_NA` —
 *  a Config já os esmaece; um resto antigo não pode acender "falta" p/ sempre). */
export function requeridasPorOrigem(isComprado: boolean, requeridas: ReadonlySet<string>): Set<string> {
  const out = new Set(requeridas);
  if (isComprado) for (const k of REVENDA_COND_NA) out.delete(k);
  return out;
}

/** Selo da seção "Grade" cor × tamanho: requisito `grade_preenchida` (estado SALVO) vence; senão o informativo. */
export function seloGradeComprado(i: {
  requeridas: ReadonlySet<string>; satisfeitas: Record<string, boolean> | null; totalGeral: number; nVariantes: number;
}): SeloSecao {
  const req = i.satisfeitas ? seloPorChaves(["grade_preenchida"], i.requeridas, i.satisfeitas) : null;
  if (req) return req;
  if (i.nVariantes === 0) return { tone: "muted", texto: "sem variantes" };
  if (i.totalGeral > 0) return { tone: "ok", texto: `${fmtInt(i.totalGeral)} ${i.totalGeral === 1 ? "peça" : "peças"}` };
  return { tone: "warn", texto: "falta preencher" };
}

const CAMPOS_COMPLETUDE_DEV = ["modelista_id", "piloteiro1_id", "data_piloto1", "data_desenho_tecnico"] as const;
/** Selo informativo da seção "Desenvolvimento": completa quando os campos VISÍVEIS estão preenchidos (interno = os 4 de
 *  sempre; comprado = só os que a loja deixou visíveis — default nenhum). */
export function desenvolvimentoCompleto(
  d: Pick<Draft, "modelista_id" | "piloteiro1_id" | "data_piloto1" | "data_desenho_tecnico">,
  campoVisivel: (key: string) => boolean,
): boolean {
  return CAMPOS_COMPLETUDE_DEV.every((k) => !campoVisivel(k) || !!d[k]);
}

// ── Grade cor × tamanho (decisão F3 #4) ────────────────────────────────────────────────────────────────────────────
/** Rascunho `{ordem: {tamanho: qtd}}` → linhas (estado COMPLETO — linha ausente = apagada no servidor). */
export function linhasGradeComprado(g: Record<number, Record<string, number>>): GradeRow[] {
  return Object.entries(g).map(([ordem, grades]) => ({
    variante_numero: Number(ordem),
    grades,
    grade_total: Object.values(grades).reduce((s, v) => s + (Number(v) || 0), 0),
  }));
}

/** Forma canônica p/ comparar grades: sem célula/linha zerada (o RPC não grava linha sem valor), chaves ordenadas. */
export function normalizarGradeComprado(g: Record<number | string, Record<string, number>>): string {
  const linhas = Object.entries(g)
    .map(([k, cel]) => {
      const celulas = Object.entries(cel ?? {})
        .map(([t, v]) => [t, Number(v) || 0] as const)
        .filter(([, v]) => v > 0)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return [Number(k), Object.fromEntries(celulas)] as const;
    })
    .filter(([, cel]) => Object.keys(cel).length > 0)
    .sort(([a], [b]) => a - b);
  return JSON.stringify(linhas);
}

export function gradeCompradoDoServidor(rows: GradeRowDb[]): Record<number, Record<string, number>> {
  const out: Record<number, Record<string, number>> = {};
  for (const r of rows) out[r.variante_numero] = { ...(r.grades ?? {}) };
  return out;
}

/** A grade do SERVIDOR mudou em relação ao baseline semeado (`gradeRevendaBaseRef`)? JSON inválido ⇒ sim (na dúvida, não grava).
 *  Fix Lote A (revisão) — o JSON pode ser SINTATICAMENTE válido mas não um objeto (ex.: `JSON.parse("null")`,
 *  `JSON.parse("42")`, `JSON.parse('"x"')`): `Object.entries` sobre um valor não-objeto lança ou devolve algo que não
 *  representa a grade — conservador também aqui, devolve `true` (na dúvida, trata como mudança). */
export function gradeCompradoMudouNoServidor(baseJson: string, servidor: GradeRowDb[]): boolean {
  let base: Record<number, Record<string, number>>;
  try {
    const parsed = JSON.parse(baseJson || "{}") as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return true;
    base = parsed as Record<number, Record<string, number>>;
  } catch {
    return true;
  }
  return normalizarGradeComprado(base) !== normalizarGradeComprado(gradeCompradoDoServidor(servidor));
}

/**
 * `_grades` que o `salvar_modelo_bom` recebe num card COMPRADO — ele APAGA todas as `modelo_grades`
 * (`_salvar_modelo_bom_core`), então a grade cor × tamanho TEM de ir junto. Editada ⇒ o rascunho; não editada ⇒ o que o
 * SERVIDOR tem agora (o rascunho é semeado 1× por abertura e pode estar velho — nunca regravar grade velha por cima da
 * de outra pessoa).
 */
export function gradesParaBomComprado(i: { editada: boolean; rascunho: GradeRow[]; servidor: GradeRowDb[] }): GradeRow[] {
  if (i.editada) return i.rascunho;
  return i.servidor.map((r) => ({
    variante_numero: r.variante_numero,
    grades: (r.grades ?? {}) as Record<string, number>,
    grade_total: r.grade_total ?? 0,
  }));
}
