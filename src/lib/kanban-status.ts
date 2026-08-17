// Status do kanban de Desenvolvimento. Fonte única: o `key` é SNAKE (bate com
// modelos.status_desenvolvimento); o `label` é o texto exibido.
//
// tenant_config.status_kanban historicamente guarda só LABELS (strings). Como os
// `status_desenvolvimento` são snake (e NÃO são slug do label — "corte_piloto_2"
// ≠ "corte de piloto ii"), resolvemos o label para a chave canônica via
// DEFAULT_STATUSES; labels customizados caem no slugify.

export type KanbanStatus = { key: string; label: string; color?: string };

// Cores via token (§Q3, varredura onda 2, ago/2026): "aprovado"/"reprovado"/"stand by"/
// "em ajuste" reusam os tons de feedback do tema (--success/--destructive/--muted-foreground/
// --warning — reagem a claro/escuro). Os estágios do MEIO do pipeline não têm tom de
// feedback correspondente — usam a paleta categórica própria (--kanban-*, mesmos hex de
// antes) declarada em src/styles.css.
export const DEFAULT_STATUSES: KanbanStatus[] = [
  { key: "em_modelagem", label: "Em Modelagem", color: "var(--kanban-blue)" },
  { key: "corte_piloto_1", label: "Corte de Piloto I", color: "var(--kanban-indigo)" },
  { key: "corte_piloto_2", label: "Corte de Piloto II", color: "var(--kanban-indigo)" },
  { key: "corte_piloto_3", label: "Corte de Piloto III", color: "var(--kanban-indigo)" },
  { key: "em_pilotagem", label: "Em Pilotagem", color: "var(--kanban-violet)" },
  { key: "prova_roupa_1", label: "Prova de Roupa I", color: "var(--kanban-purple)" },
  { key: "prova_roupa_2", label: "Prova de Roupa II", color: "var(--kanban-purple)" },
  { key: "prova_roupa_3", label: "Prova de Roupa III", color: "var(--kanban-purple)" },
  { key: "prova_roupa_4", label: "Prova de Roupa IV", color: "var(--kanban-purple)" },
  { key: "prova_roupa_5", label: "Prova de Roupa V", color: "var(--kanban-purple)" },
  { key: "em_ajuste", label: "Em Ajuste", color: "var(--warning)" },
  { key: "stand_by", label: "Stand By", color: "var(--muted-foreground)" },
  { key: "reprovado", label: "Reprovado", color: "var(--destructive)" },
  { key: "aprovado", label: "Aprovado", color: "var(--success)" },
];

// Chave snake do status "aprovado" (gatilho de Enviar ao CAD). Fixa, NÃO "último item".
export const APROVADO_KEY = "aprovado";

const LABEL_TO_KEY = new Map(DEFAULT_STATUSES.map((s) => [s.label.toLowerCase().trim(), s.key]));
const KEY_TO_DEFAULT = new Map(DEFAULT_STATUSES.map((s) => [s.key, s]));

function slugify(s: string): string {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Resolve um label (ou chave) para a chave SNAKE canônica. */
export function resolveStatusKey(labelOrKey: string): string {
  const norm = String(labelOrKey).toLowerCase().trim();
  if (KEY_TO_DEFAULT.has(norm)) return norm; // já é uma chave canônica
  return LABEL_TO_KEY.get(norm) ?? slugify(labelOrKey);
}

export type ExplosaoEnvioGate = { ok: boolean; reqKey: string; reqLabel: string };

/** Decide se um modelo pode ser enviado à Explosão (materializa o CAD, `enviado_cad=true`)
 *  conforme a etapa configurada por loja em `tenant_config.explosao_envio_status`.
 *
 *  Semântica "a partir da etapa": libera se o status atual está NA etapa configurada OU
 *  em QUALQUER etapa POSTERIOR (pela ordem das colunas do board da loja).
 *   - config ausente/'' ⇒ 'aprovado' (comportamento histórico).
 *   - config ÓRFÃ (etapa fora do board atual) ⇒ fallback 'aprovado'.
 *   - board sem a etapa exigida (nem 'aprovado'), ou status do modelo fora do board ⇒
 *     conservador: só a igualdade EXATA de chave libera.
 *
 *  ⚠️ ESPELHO EXATO de `_explosao_envio_gate` (SQL, migration 20260817120000). Ao mudar a
 *  regra aqui, atualizar o `_core` no banco (e vice-versa). */
export function podeEnviarExplosao(
  statusKanbanRaw: any,
  explosaoEnvioStatus: string | null | undefined,
  statusDesenvolvimento: string | null | undefined,
): ExplosaoEnvioGate {
  const rows = normalizeKanbanStatuses(statusKanbanRaw); // {key,label}[] em ordem
  const keys = rows.map((r) => r.key);
  const labelOf = (k: string) =>
    rows.find((r) => r.key === k)?.label ??
    DEFAULT_STATUSES.find((s) => s.key === k)?.label ??
    k;

  let reqKey = String(explosaoEnvioStatus ?? "").trim() || APROVADO_KEY;
  let cfgIdx = keys.indexOf(reqKey);
  if (cfgIdx < 0 && reqKey !== APROVADO_KEY) {
    reqKey = APROVADO_KEY; // órfã → fallback 'aprovado'
    cfgIdx = keys.indexOf(APROVADO_KEY);
  }
  const reqLabel = labelOf(reqKey);
  const status = String(statusDesenvolvimento ?? "").trim().toLowerCase();
  const curIdx = keys.indexOf(status);

  let ok: boolean;
  if (cfgIdx < 0) ok = status === reqKey; // board sem a etapa exigida nem 'aprovado'
  else if (curIdx < 0) ok = status === reqKey; // status do modelo fora do board
  else ok = curIdx >= cfgIdx;
  return { ok, reqKey, reqLabel };
}

/** Normaliza o status_kanban do tenant_config (strings-label OU objetos) para
 *  {key snake, label, color}. */
export function normalizeKanbanStatuses(raw: any): KanbanStatus[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_STATUSES;
  return raw
    .map((s: any): KanbanStatus | null => {
      if (typeof s === "string") {
        const key = resolveStatusKey(s);
        return { key, label: s, color: KEY_TO_DEFAULT.get(key)?.color };
      }
      if (s && typeof s === "object") {
        const label = s.label ?? s.nome ?? s.name ?? "";
        const key = s.key ?? s.id ?? s.value ?? s.slug ?? resolveStatusKey(label);
        return { key: String(key), label: String(label || key), color: s.color ?? KEY_TO_DEFAULT.get(String(key))?.color };
      }
      return null;
    })
    .filter(Boolean) as KanbanStatus[];
}
