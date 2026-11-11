// Helpers PUROS de formatação legível do audit_log (F5-3 Task 5).
// Extraídos de `src/routes/_authenticated/admin/auditoria.tsx` para que a tela /admin/auditoria
// e a timeline do Histórico do produto usem a MESMA fonte (não duplicar).
// Sem React, sem Supabase, sem hooks: só texto/Set/regex. (`import type` some na compilação.)
import type { StatusTone } from "@/components/shared/StatusBadge";

// Tom §Q9 por tipo de ação (campanha StatusBadge, ago/2026). "Resetou" (reset de loja,
// bem mais destrutivo que um "editou" comum) fica no mesmo tom danger de "Excluiu" — a
// paleta tem 5 tons só, sem um 6º pra diferenciar as duas ações destrutivas; o LABEL
// segue distinguindo ("Excluiu" vs "Resetou").
export const ACAO_META: Record<string, { label: string; tone: StatusTone }> = {
  criar: { label: "Criou", tone: "success" },
  editar: { label: "Editou", tone: "warning" },
  excluir: { label: "Excluiu", tone: "danger" },
  resetar: { label: "Resetou", tone: "danger" },
};

// Rótulos PT p/ os campos do diff (nomes crus de coluna são incompreensíveis p/ o leigo).
// Fallback: prettify (tira _id, troca _ por espaço, capitaliza).
export const CAMPO_LABEL: Record<string, string> = {
  nome: "Nome", codigo_nome: "Nome", ref: "Referência", numero_pedido: "Nº do pedido",
  numero_os: "Nº da OS", numero: "Número", preco: "Preço", preco_venda: "Preço de venda",
  quantidade: "Quantidade", status: "Status", ativo: "Ativo", role: "Papel",
  observacoes: "Observações", composicao: "Composição", ncm: "NCM",
  categoria_principal_id: "Categoria", categoria_secundaria_id: "Categoria secundária",
  subcategoria1_id: "Subcategoria 1", subcategoria2_id: "Subcategoria 2",
  grupo_id: "Grupo", linha_id: "Linha", cor_id: "Cor", cor_apelido_id: "Cor apelido",
  cor_base_id: "Cor base", empresa_id: "Fornecedor", representante_id: "Representante",
  material_aviamento_id: "Material", categoria_aviamento_id: "Categoria",
  modo_oc_rolo: "Modo OC/Rolo", modo_baixa_estoque: "Modo de baixa", timezone: "Fuso horário",
  data_prevista_entrega: "Data prevista", data_entrega: "Data de entrega",
  data_vencimento: "Vencimento", data_pagamento: "Pagamento", valor: "Valor", pago: "Pago",
  markup: "Markup", sla_oficina: "SLA (dias)", lancado: "Lançado", foto_url: "Foto",
};
export const campoLabel = (k: string) =>
  CAMPO_LABEL[k] ??
  k.replace(/_id$/, "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

// ── Legibilidade do diff (ago/2026): UUID→nome, fotos, arrays ──────────────
// O audit guarda valores CRUS. Sem tratamento a tela mostra UUID
// ("Estilista: — → 301cb509-…"), path de storage e JSON — indecifrável.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Campos que o RPC audit_resolver_referencias sabe resolver (FK → nome). Os de
// array (tecidos_planejados) são achatados item a item. Mantido em sincronia com
// o _map do RPC (migration 20260831190000).
export const CAMPOS_FK = new Set([
  "estilista_id", "modelista_id", "piloteiro1_id", "piloteiro2_id", "piloteiro3_id",
  "recebimento_responsavel_id", "linha_id", "subcategoria1_id", "subcategoria2_id",
  "categoria_principal_id", "categoria_secundaria_id", "categoria_tecido_id",
  "categoria_aviamento_id", "subcategoria_aviamento_id", "colecao_id", "cor_id",
  "cor_apelido_id", "empresa_id", "representante_id", "material_aviamento_id",
  "conjunto_id", "mes_id", "ano_id", "tecidos_planejados",
]);

// Campos que guardam path(s) de storage — mostrar rótulo amigável, nunca o path.
export const CAMPOS_FOTO = new Set([
  "croqui_url", "desenho_tecnico_url", "logo_url", "foto_url", "anexo_pedido_url",
  "comprovante_url", "nf_url", "fotos_modelo", "fotos_referencia",
  "etiqueta_lavagem_urls", "nfs", "nf_historico", "fotografado_variantes",
]);

// Ruído técnico — não mostrar no diff (decisão do dono: só ruído puro).
export const CAMPOS_OCULTOS = new Set(["tenant_id", "rev", "ref_auto"]);
export const ehCampoOculto = (k: string) => CAMPOS_OCULTOS.has(k) || /_at$/.test(k);

// Coleta os pares {campo, id} de UUID (escalar OU dentro de array) de um diff,
// só p/ campos FK — alimenta a chamada única do RPC por página.
export function coletarPares(dados: Record<string, { de: unknown; para: unknown }>): { campo: string; id: string }[] {
  const out: { campo: string; id: string }[] = [];
  for (const [campo, d] of Object.entries(dados)) {
    if (!CAMPOS_FK.has(campo)) continue;
    for (const v of [d?.de, d?.para]) {
      if (typeof v === "string" && UUID_RE.test(v)) out.push({ campo, id: v });
      else if (Array.isArray(v)) for (const it of v) if (typeof it === "string" && UUID_RE.test(it)) out.push({ campo, id: it });
    }
  }
  return out;
}

// Um valor cru → texto legível. `nomes` = mapa UUID→nome do RPC.
export function valLegivel(campo: string, v: unknown, nomes: Record<string, string>): string {
  if (v === null || v === undefined || v === "") return "—";

  // Fotos / arquivos: nunca mostrar path.
  if (CAMPOS_FOTO.has(campo)) {
    if (Array.isArray(v)) return v.length === 0 ? "—" : `📷 ${v.length} arquivo(s)`;
    return "📷 Arquivo";
  }

  // Array: FK → nomes; senão → contagem.
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    if (CAMPOS_FK.has(campo)) {
      const labels = v.map((it) => (typeof it === "string" && nomes[it]) || (typeof it === "string" && UUID_RE.test(it) ? "(removido)" : String(it)));
      return labels.join(", ");
    }
    return `${v.length} item(s)`;
  }

  // Objeto (JSON) → contagem de chaves (ininteligível cru).
  if (typeof v === "object") {
    const n = Object.keys(v as object).length;
    return n ? `${n} item(s)` : "—";
  }

  // Escalar: UUID de FK → nome; senão o próprio valor.
  const s = String(v);
  if (CAMPOS_FK.has(campo) && UUID_RE.test(s)) return nomes[s] ?? "(removido)";
  return s;
}
