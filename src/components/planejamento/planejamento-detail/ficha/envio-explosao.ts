// F3.3 — "Enviar à Explosão" no Sheet unificado do Planejamento: o gate por etapa e a lista "Para enviar, falta".
// PORTA de ModeloDetailPanel.tsx:1405-1413 (gate), :1576-1598 (pendências/canEnviarCad), com as seções do Sheet do
// Planejamento no lugar das do acordeão do Dev. Decisão travada 10: com a chave LIGADA o gate usa a posição DERIVADA
// do card (`statusParaGate`), espelho do SQL `_explosao_envio_gate(_kanban_status_gate(...))` (F1
// 20260930140000_kanban_auto_3_motor.sql:842). Puro — tests/unit/planejamento-envio-explosao.test.ts.
import { podeEnviarExplosao } from "@/lib/kanban-status";
import { statusParaGate, type Derivacao, type KanbanAutoConfig } from "@/lib/kanban-auto";
import type { GradeRow, TecidoBlock } from "@/components/desenvolvimento/modelo-detail/types";
import type { Draft } from "@/components/planejamento/modelo-shared";
import type { SecaoSheetKey } from "./selos-secoes";
import { TEXTO_REPROVADO_EXPLOSAO } from "@/lib/erro-mensagem";

/**
 * `reprovado` (leves L3, R14 msg reprovado): com a chave LIGADA, card em Reprovado não tem posição para os gates (P-190 A,
 * `statusParaGate` = null) — o motivo é o reprovado, não a etapa. `motivo` = o texto pronto para a tela (o mesmo do servidor,
 * `reprovado_explosao:` traduzido em erro-mensagem.ts); vazio quando `ok` ou `carregando`.
 */
export type GateEnvio = { ok: boolean; carregando: boolean; reqLabel: string; reprovado: boolean; motivo: string };

/** Pode enviar pela ETAPA? `statusCru` = status gravado com a Ordem de Criação enviada (null antes dela). */
export function gateEnvioExplosao(i: {
  cfg: KanbanAutoConfig;
  explosaoEnvioStatus: string | null | undefined;
  statusCru: string | null;
  derivacao: Derivacao | null;
  /** Condições do card E config da loja carregadas (`useFichaKanban.condProntas`). */
  condProntas: boolean;
}): GateEnvio {
  // Chave ligada sem as condições: a posição derivada ainda não é conhecida — não libera "no escuro" (o servidor
  // recusaria, mas o botão não pode prometer).
  if (i.cfg.kanban_automatico && !i.condProntas) return { ok: false, carregando: true, reqLabel: "", reprovado: false, motivo: "" };
  const statusGate = statusParaGate(i.cfg.kanban_automatico, i.derivacao, i.statusCru);
  const g = podeEnviarExplosao(i.cfg.status_kanban, i.explosaoEnvioStatus, i.statusCru, { statusGate });
  // ≡ SQL _enviar_modelo_para_cad_core (leves L3): gate NULL + status 'reprovado' (normalizado) → recusa própria.
  const reprovado = !g.ok && statusGate === null && (i.statusCru ?? "").trim().toLowerCase() === "reprovado";
  const motivo = g.ok ? "" : reprovado ? TEXTO_REPROVADO_EXPLOSAO : `Disponível a partir da etapa "${g.reqLabel}".`;
  return { ok: g.ok, carregando: false, reqLabel: g.reqLabel, reprovado, motivo };
}

/**
 * Fix round T7 (Important, RULING do controlador) — `secao` virou OPCIONAL: ausente = pendência SEM link (texto puro,
 * sem seção pra abrir). Único uso hoje: a grade cor × tamanho indisponível porque o módulo da origem (Produto Acabado/
 * Produto Importado) está desligado — a seção `grade_revenda` nem existe nesse caso (`secFicha.gradeComprado` depende
 * de `paOn`/`piOn` no orquestrador), então um link pra ela abriria uma seção que não está lá.
 */
export type PendenciaEnvio = { label: string; secao?: SecaoSheetKey };

/**
 * "Para enviar, falta" (Dev :1576-1595). F3.4 (D2): comprado também — só exige o que a loja deixou VISÍVEL p/ comprado
 * (`campoVisivel`, Dev :1583-1595) e a grade cor × tamanho (`secaoGrade`); os mínimos valem sempre. Cada pendência aponta
 * a seção do Sheet onde se resolve (o link abre a seção). `rotuloRef` = `useFieldLabels()("ref")`, como o Dev.
 */
export function pendenciasEnvioExplosao(i: {
  draft: Pick<Draft, "ref" | "nome" | "estilista_id" | "categoria_principal_id" | "data_desenho_tecnico" | "data_piloto1" | "data_piloto2" | "data_piloto3" | "piloteiro2_id" | "piloteiro3_id">;
  blocks: TecidoBlock[];
  grades: GradeRow[];
  rotuloRef: string;
  /** F3.4 — comprado: campo/seção visível p/ comprado (`revendaCampoVisivel`); ausente = interno (tudo exigido, como antes). */
  campoVisivel?: (key: string) => boolean;
  /** F3.4 — seção onde "grade preenchida" se resolve (comprado = "grade_revenda", a grade cor × tamanho). */
  secaoGrade?: SecaoSheetKey;
  /**
   * Fix round T7 (Important, RULING) — o card é comprado (revenda/importado), a seção "s4" está visível no Fluxo de
   * Revenda, MAS o módulo da FAMÍLIA (Produto Acabado p/ revenda, Produto Importado p/ importado) está desligado: a
   * grade nunca chega a existir/carregar (a query de `useGradeComprado` nem dispara — `moduloOn=false`) e a seção
   * `grade_revenda` some do Sheet (`secFicha.gradeComprado` continua `true` — vem só de "s4" — mas `vis.grade_revenda`
   * exige `paOn`/`piOn` também). SEM este parâmetro, "grade preenchida" ficaria PERMANENTE (a grade nunca preenche
   * sozinha) e o link apontaria para uma seção que não renderiza — Enviar travaria pra sempre, sem explicação.
   * Presente ⇒ troca o texto da pendência de grade por este (ex.: "Grade cor × tamanho indisponível — o módulo
   * Produto Acabado está desligado nesta loja; peça ao administrador.") e OMITE `secao` (sem link).
   */
  gradeIndisponivel?: string;
}): PendenciaEnvio[] {
  const cv = i.campoVisivel ?? (() => true);
  const out: PendenciaEnvio[] = [];
  const d = i.draft;
  const vazio = (s: string | null | undefined) => (s ?? "").trim() === "";
  // F3.6 (Ruling R2) — a REF mora na seção "4. Códigos" (saiu de "Desenvolvimento").
  if (vazio(d.ref)) out.push({ label: i.rotuloRef, secao: "codigos" });
  if (vazio(d.nome)) out.push({ label: "Nome", secao: "info" });
  if (!d.estilista_id) out.push({ label: "Estilista", secao: "info" });
  if (!d.categoria_principal_id) out.push({ label: "Categoria", secao: "info" });
  // F3.4 — comprado afrouxa como o Dev (ModeloDetailPanel.tsx:1583-1595): tecido só com a seção "s2" visível, grade só
  // com "s4", cada data só se o campo estiver visível. No interno `cv` é sempre true (regra de antes, intocada).
  if (cv("s2")) {
    const temTecidoComVariante = i.blocks.some((b) => b.tipo === "tecido" && !!b.artigo_id && b.variantes.some((v) => !!v));
    const todosComVariante = i.blocks.filter((b) => !!b.artigo_id).every((b) => b.variantes.some((v) => !!v));
    if (!temTecidoComVariante) out.push({ label: "ao menos 1 tecido com variante", secao: "tecidos" });
    else if (!todosComVariante) out.push({ label: "1 variante em cada tecido/forro/entretela selecionado", secao: "tecidos" });
  }
  // Fix round T7 — `gradeIndisponivel` tem PRECEDÊNCIA sobre a checagem normal de Σgrade_total: com o módulo
  // desligado, a grade nunca carrega dado nenhum (fica sempre vazia) — checar Σ<=0 daria o mesmo resultado, mas o
  // texto/link errados; aqui a pendência é sobre o MÓDULO, não sobre "faltou preencher".
  if (cv("s4")) {
    if (i.gradeIndisponivel) out.push({ label: i.gradeIndisponivel });
    else if (i.grades.reduce((s, g) => s + (g.grade_total || 0), 0) <= 0) out.push({ label: "grade preenchida", secao: i.secaoGrade ?? "grade" });
  }
  if (cv("data_desenho_tecnico") && vazio(d.data_desenho_tecnico)) out.push({ label: "Data Desenho Técnico", secao: "desenvolvimento" });
  if (cv("data_piloto1") && vazio(d.data_piloto1)) out.push({ label: "Data Piloto 1", secao: "desenvolvimento" });
  const piloto2Aberto = !!(d.piloteiro2_id || !vazio(d.data_piloto2));
  const piloto3Aberto = !!(d.piloteiro3_id || !vazio(d.data_piloto3));
  if (cv("data_piloto2") && piloto2Aberto && vazio(d.data_piloto2)) out.push({ label: "Data Piloto 2", secao: "desenvolvimento" });
  if (cv("data_piloto3") && piloto3Aberto && vazio(d.data_piloto3)) out.push({ label: "Data Piloto 3", secao: "desenvolvimento" });
  return out;
}
