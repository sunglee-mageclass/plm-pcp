import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { labelVarianteRow } from "@/lib/variante";
import { brl } from "@/lib/format";

export const BUCKET = "oc-tecido";

/** Rótulo padrão da variante de tecido: "nome comercial - cor - apelido" (fonte única
 * em @/lib/variante). Mantido aqui como reexport pela ergonomia dos componentes de OC. */
export const labelVariante = labelVarianteRow;

export type OCStatus = "encomendado" | "recebido";
// Abas da tela OC Tecido: os status de OC + a aba "Estoque" (3ª aba = posição de estoque).
export type OcTecidoTab = OCStatus | "estoque" | "rolos";

export type Empresa = {
  id: string;
  nome_fantasia: string;
  // Embed to-many (FK sem UNIQUE): representantes da empresa p/ o Select opcional.
  representantes?: { id: string; nome: string | null }[] | null;
};
export type Colab = { id: string; nome: string; tipo: string };
export type Artigo = {
  id: string; nome: string; empresa_id: string | null;
  preco: number | null; rendimento: number | null;
  unidade_medida: string | null;
};
export type Variante = {
  id: string; artigo_id: string;
  nome_variante: string | null; codigo_variante: string | null;
  preco?: number | null;
  cor?: { nome: string | null } | null;
  apelido?: { nome: string | null } | null;
};
export type OCItem = {
  id: string;
  oc_tecido_id: string | null;
  artigo_id: string | null;
  artigo_numero: number | null;
  variante_tecido_id: string | null;
  quantidade_pedida: number | null;
  quantidade_recebida: number | null;
  rendimento: number | null;
  cancelado: boolean | null;
};
export type OC = {
  id: string;
  numero_pedido: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  empresa_id: string | null;
  representante_id: string | null;
  data_pedido: string | null;
  data_prevista_entrega: string | null;
  data_entrega: string | null;
  prazo_pagamento: string | null;
  quantidade_prazos: number | null;
  modelo_sugerido_url: string | null;
  anexo_pedido_url: string | null;
  nf_url: string | null;
  etiqueta_lavagem_urls: string[] | null;
  etiqueta_lavagem_url_1: string | null;
  etiqueta_lavagem_url_2: string | null;
  observacoes_entrega: string | null;
  observacoes_defeitos: string | null;
  status: string | null;
  valor_previsto_total: number | null;
  valor_real_total: number | null;
  // Responsável pelo recebimento (seção 4) — espelha o par responsavel_id/nome do pedido.
  recebimento_responsavel_id: string | null;
  recebimento_responsavel_nome: string | null;
};

export type ParcelaRecebimento = { data: string; recebido: boolean };

export type Draft = {
  numero_pedido: string;
  responsavel_id: string | null;
  responsavel_nome: string;
  empresa_id: string | null;
  representante_id: string | null;
  data_pedido: string;
  data_prevista_entrega: string;
  prazo_pagamento: string;
  quantidade_prazos: number;
  observacoes_entrega: string;
  observacoes_defeitos: string;
  data_entrega: string;
  anexo_pedido_url: string | null;
  modelo_sugerido_url: string | null;
  nf_url: string | null;
  nfs: { url: string; data?: string }[]; // várias Notas Fiscais (nf_url = a primeira)
  parcelas_recebimento: ParcelaRecebimento[];
  // Responsável pelo recebimento (opcional) — mesmo padrão do Responsável do pedido.
  recebimento_responsavel_id: string | null;
  recebimento_responsavel_nome: string;
};

export type ItemDraft = {
  tempId: string;
  id?: string;
  artigo_numero: 1 | 2;
  artigo_id: string | null;
  variante_tecido_id: string;
  quantidade_pedida: number;
  quantidade_recebida: number | null;
  // Rendimento (m/kg) específico desta OC. Quando null, cai no rendimento do
  // artigo (cadastro). Só relevante para artigos em kg.
  rendimento: number | null;
  cancelado: boolean;
  // Preço unitário desta compra (Fase A — a OC dita o preço). Default = preço atual da variante.
  preco: number | null;
};

// Um rolo destrinchado no recebimento (modo Só Rolo). Antes era só a quantidade
// (string); agora guarda código + ids + CQ + observação para recarregar a OC
// recebida destrinchada e editar o CQ por rolo.
export type RoloEntry = {
  qtd: string;             // quantidade na unidade do artigo
  codigo?: string | null;  // rolo_codigo (nomenclatura automática, após criado)
  roloId?: string;         // ocs_tecido.id do rolo
  roloItemId?: string;     // ocs_tecido_itens.id do rolo (onde vivem os cq_*)
  cq_ok?: boolean;
  cq_alerta?: boolean;     // cq_alerta_status === 'alertado'
  cqStatus?: string;       // cq_alerta_status cru (alertado/trocado/cancelado/…) p/ badge
  cancelado?: boolean;     // rolo cancelado (fora do estoque)
  usado?: boolean;         // rolo já consumido (corte) — não pode editar/cancelar/trocar
  obs?: string;            // cq_observacao do rolo
};

export function emptyDraft(): Draft {
  return {
    numero_pedido: "",
    responsavel_id: null,
    responsavel_nome: "",
    empresa_id: null,
    representante_id: null,
    data_pedido: format(new Date(), "yyyy-MM-dd"),
    data_prevista_entrega: "",
    prazo_pagamento: "",
    quantidade_prazos: 1,
    observacoes_entrega: "",
    observacoes_defeitos: "",
    data_entrega: "",
    anexo_pedido_url: null,
    modelo_sugerido_url: null,
    nf_url: null,
    nfs: [],
    parcelas_recebimento: [{ data: "", recebido: false }],
    recebimento_responsavel_id: null,
    recebimento_responsavel_nome: "",
  };
}

// ── Conta ÚNICA do valor/metragem por item (redesign ago/2026) ──
// Usada pelo total da tabela de recebimento (OcTecidoCalculos), pelos totais da
// OC (OcDialog) e pelo box "TOTAL PREVISTO" vivo da seção Tecidos — não duplicar.
export function precoItem(it: Pick<ItemDraft, "preco" | "artigo_id">, artigoMap: Record<string, Artigo>): number {
  return it.preco ?? (it.artigo_id ? artigoMap[it.artigo_id]?.preco : null) ?? 0;
}
/** Metragem pedida do item (kg → metros via rendimento do item, fallback cadastro). */
export function metragemPedidaItem(it: ItemDraft, artigoMap: Record<string, Artigo>): number {
  const a = it.artigo_id ? artigoMap[it.artigo_id] : null;
  if (!a) return 0;
  const rend = Number(it.rendimento ?? a.rendimento ?? 0);
  return a.unidade_medida === "kg" ? it.quantidade_pedida * rend : it.quantidade_pedida;
}

export function fmtMoney(v: number | null | undefined) {
  if (v == null || isNaN(v as number)) return "—";
  return brl(v);
}
export function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  try { return format(parseISO(v), "dd/MM/yyyy"); } catch { return v; }
}
export async function uploadFile(file: File, prefix: string) {
  const { tenantPrefix, sanitizeStorageName } = await import("@/lib/storage-tenant");
  const tenant = await tenantPrefix();
  const path = `${tenant}/${prefix}/${crypto.randomUUID()}-${sanitizeStorageName(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}
