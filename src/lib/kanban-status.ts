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
