// SSOT de navegação (URLs + ícones por módulo/página), consumido pela sidebar E pelos HUBs de setor
// (páginas basePath). Assim os "bloquinhos" do hub derivam do MESMO catálogo (permissions-catalog) e
// nunca ficam desatualizados em relação à sidebar.
import {
  BarChart3, ClipboardList, Package, Palette, Factory, DollarSign, Target,
  Tags, Users, Building2, Layers, Scissors, Boxes, ShoppingCart, AlertTriangle, Tag, MapPin,
  Hammer, CheckCircle2, Split, Rocket, FileText, Truck, Store, ListChecks, type LucideIcon,
} from "lucide-react";
// PAGE_ICONS de produto_acabado (revenda) usa Package (planejador) e ShoppingCart (OC) —
// mesmo ícone de OC das demais entradas de compra (paridade visual com OC Tecido/Aviamento).

export const MODULE_META: Record<string, { title: string; icon: LucideIcon }> = {
  dashboard: { title: "Dashboard", icon: BarChart3 },
  cadastro: { title: "Cadastro", icon: ClipboardList },
  entrada_saida: { title: "Entrada e Saída", icon: Package },
  criacao: { title: "Estilo & Engenharia", icon: Palette },
  pcp: { title: "PCP", icon: Factory },
  expedicao: { title: "Expedição & Logística", icon: Truck },
  financeiro: { title: "Financeiro", icon: DollarSign },
  otb: { title: "OTB", icon: Target },
};

// key da página -> URL. Módulo sem entrada aqui vira link direto (sem sub-itens/hub).
export const PAGE_URLS: Record<string, string> = {
  cadastro_atributos: "/cadastro/atributos",
  cadastro_colaboradores: "/cadastro/colaboradores",
  cadastro_servico: "/cadastro/servico",
  cadastro_tecidos: "/cadastro/tecidos",
  cadastro_aviamentos: "/cadastro/aviamentos",
  cadastro_etiquetas: "/cadastro/etiquetas",
  cadastro_destinos: "/cadastro/destinos",
  cadastro_lojas: "/cadastro/lojas",
  entrada_oc_tecido: "/entrada-saida/oc-tecido",
  entrada_alertas_tecido: "/entrada-saida/alertas-tecido",
  entrada_oc_p_acabado: "/entrada-saida/oc-p-acabado",
  entrada_oc_aviamento: "/entrada-saida/oc-aviamento",
  entrada_oc_insumo: "/entrada-saida/oc-insumo",
  entrada_os_tecido: "/entrada-saida/os-tecido",
  entrada_os_aviamento: "/entrada-saida/os-aviamento",
  criacao_plan_tecido: "/criacao/plan-tecido",
  criacao_produto_acabado: "/criacao/produto-acabado",
  criacao_planejamento: "/criacao/planejamento",
  criacao_desenvolvimento: "/criacao/desenvolvimento",
  producao_explosao: "/entrada-saida/explosao",
  // PCP virou hub multi-página (Serviços + Etapas, gate `etapas_pl`) — Serviços/Etapas entram em
  // PAGE_URLS como cards do hub / sub-itens da sidebar, igual às demais páginas de setor.
  // Oficina e CAD são acessados dentro de outras telas — também sem item próprio na navegação.
  producao_terceirizados: "/pcp/servicos",
  producao_etapas: "/pcp/etapas",
  producao_cq: "/expedicao/cq",
  producao_direcionamento: "/expedicao/direcionamento",
  producao_lancamentos: "/expedicao/lancamentos",
};

// Ícone por página (bloquinhos do hub). Sem entrada = usa o ícone do módulo (fallback no SectionHub).
export const PAGE_ICONS: Record<string, LucideIcon> = {
  cadastro_atributos: Tags,
  cadastro_colaboradores: Users,
  cadastro_servico: Building2,
  cadastro_tecidos: Layers,
  cadastro_aviamentos: Boxes,
  cadastro_etiquetas: Tag,
  cadastro_destinos: MapPin,
  cadastro_lojas: Store,
  producao_explosao: Scissors,
  entrada_oc_tecido: ShoppingCart,
  entrada_alertas_tecido: AlertTriangle,
  entrada_oc_p_acabado: ShoppingCart,
  entrada_oc_aviamento: ShoppingCart,
  entrada_oc_insumo: ShoppingCart,
  entrada_os_tecido: FileText,
  entrada_os_aviamento: FileText,
  criacao_plan_tecido: Layers,
  criacao_produto_acabado: Package,
  criacao_planejamento: ClipboardList,
  criacao_desenvolvimento: Hammer,
  producao_terceirizados: Factory,
  producao_etapas: ListChecks,
  producao_cq: CheckCircle2,
  producao_direcionamento: Split,
  producao_lancamentos: Rocket,
};

// ── Badges de pendência por PÁGINA (RPC sidebar_badges) — SSOT sidebar + hubs de setor ──
// Cores AA sobre navy E card claro: âmbar/azul com TEXTO ESCURO; vermelho red-600.
export const BADGE_CLS: Record<string, string> = {
  criacao_planejamento: "bg-sky-300 text-sky-950",
  entrada_alertas_tecido: "bg-amber-400 text-amber-950",
  entrada_oc_tecido: "bg-red-600 text-white",
  entrada_oc_aviamento: "bg-red-600 text-white",
  entrada_oc_insumo: "bg-red-600 text-white",
  entrada_oc_p_acabado: "bg-red-600 text-white",
  otb_divergencia: "bg-red-600 text-white",
  producao_terceirizados: "bg-red-600 text-white",
  producao_cq: "bg-red-600 text-white",
  producao_direcionamento: "bg-red-600 text-white",
};

/** Contadores da RPC sidebar_badges mapeados por KEY de página (mesma fonte p/ sidebar e hubs). */
export function pageBadgeCounts(b?: Record<string, number>): Record<string, number> {
  const n = (k: string) => Number(b?.[k] ?? 0);
  return {
    criacao_planejamento: n("prontos_lancar"),
    entrada_alertas_tecido: n("alertas_tecido"),
    entrada_oc_tecido: n("oc_tecido_atrasada"),
    entrada_oc_aviamento: n("oc_aviamento_atrasada"),
    entrada_oc_insumo: n("oc_etiqueta_atrasada"),
    entrada_oc_p_acabado: n("oc_p_acabado_atrasada"),
    otb_divergencia: n("otb_divergencia"),
    producao_terceirizados: n("erro_terceirizados"),
    producao_cq: n("erro_cq"),
    producao_direcionamento: n("erro_direcionamento"),
  };
}

/** Frase da "linha viva" nos cards dos hubs (laudo do time: hub deixa de ser mudo de estado). */
export function badgeViva(key: string, n: number): string | null {
  if (n <= 0) return null;
  const um = n === 1;
  switch (key) {
    case "criacao_planejamento": return `${n} pronto${um ? "" : "s"} p/ lançar`;
    case "entrada_alertas_tecido": return `${n} alerta${um ? "" : "s"} pendente${um ? "" : "s"}`;
    case "entrada_oc_tecido":
    case "entrada_oc_aviamento":
    case "entrada_oc_insumo":
    case "entrada_oc_p_acabado": return `${n} OC${um ? "" : "s"} atrasada${um ? "" : "s"}`;
    case "producao_cq": return `${n} erro${um ? "" : "s"} de CQ`;
    case "producao_direcionamento": return `${n} erro${um ? "" : "s"} de direcionamento`;
    case "producao_terceirizados": return `${n} erro${um ? "" : "s"} em serviços`;
    default: return null;
  }
}
