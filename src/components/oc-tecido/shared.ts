import { format, differenceInCalendarDays, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

export const BUCKET = "oc-tecido";

export type OCStatus = "encomendado" | "recebido";

export type Empresa = { id: string; nome_fantasia: string };
export type Colab = { id: string; nome: string; tipo: string };
export type Artigo = {
  id: string; nome: string; empresa_id: string | null;
  preco: number | null; rendimento: number | null;
  unidade_medida: string | null;
};
export type Variante = {
  id: string; artigo_id: string;
  nome_variante: string | null; codigo_variante: string | null;
};
export type OCItem = {
  id: string;
  oc_tecido_id: string | null;
  artigo_id: string | null;
  artigo_numero: number | null;
  variante_tecido_id: string | null;
  quantidade_pedida: number | null;
  quantidade_recebida: number | null;
};
export type OC = {
  id: string;
  numero_pedido: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  empresa_id: string | null;
  data_pedido: string | null;
  data_prevista_entrega: string | null;
  data_entrega: string | null;
  prazo_pagamento: string | null;
  quantidade_prazos: number | null;
  modelo_sugerido_url: string | null;
  anexo_pedido_url: string | null;
  nf_url: string | null;
  etiqueta_lavagem_urls: string[] | null;
  observacoes_entrega: string | null;
  observacoes_defeitos: string | null;
  status: string | null;
  valor_previsto_total: number | null;
  valor_real_total: number | null;
};

export type Draft = {
  numero_pedido: string;
  responsavel_id: string | null;
  responsavel_nome: string;
  empresa_id: string | null;
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
  etiqueta_lavagem_urls: string[];
};

export type ItemDraft = {
  tempId: string;
  id?: string;
  artigo_numero: 1 | 2;
  artigo_id: string | null;
  variante_tecido_id: string;
  quantidade_pedida: number;
  quantidade_recebida: number | null;
};

export function emptyDraft(): Draft {
  return {
    numero_pedido: "",
    responsavel_id: null,
    responsavel_nome: "",
    empresa_id: null,
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
    etiqueta_lavagem_urls: [],
  };
}

export function fmtMoney(v: number | null | undefined) {
  if (v == null || isNaN(v as number)) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
export function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  try { return format(parseISO(v), "dd/MM/yyyy"); } catch { return v; }
}
export function mensagemEntrega(prevista?: string | null, entregue?: string | null): { text: string; tone: "neutral" | "atrasado" | "adiantado" | "no_prazo" } {
  if (!prevista || !entregue) return { text: "—", tone: "neutral" };
  const diff = differenceInCalendarDays(parseISO(entregue), parseISO(prevista));
  if (diff === 0) return { text: "Entrega no prazo", tone: "no_prazo" };
  if (diff > 0) return { text: `Pedido atrasado ${diff} dia${diff > 1 ? "s" : ""}`, tone: "atrasado" };
  return { text: `Pedido adiantado ${-diff} dia${-diff > 1 ? "s" : ""}`, tone: "adiantado" };
}

export async function uploadFile(file: File, prefix: string) {
  const path = `${prefix}/${crypto.randomUUID()}-${file.name}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}
