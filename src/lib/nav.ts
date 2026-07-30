// SSOT de navegação (URLs + ícones por módulo/página), consumido pela sidebar E pelos HUBs de setor
// (páginas basePath). Assim os "bloquinhos" do hub derivam do MESMO catálogo (permissions-catalog) e
// nunca ficam desatualizados em relação à sidebar.
import {
  BarChart3, ClipboardList, Package, Palette, Factory, DollarSign, Target,
  Tags, Users, Building2, Layers, Scissors, Boxes, ShoppingCart, AlertTriangle, Tag, MapPin,
  Hammer, CheckCircle2, Split, Rocket, FileText, Truck, type LucideIcon,
} from "lucide-react";

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
  entrada_oc_tecido: "/entrada-saida/oc-tecido",
  entrada_alertas_tecido: "/entrada-saida/alertas-tecido",
  entrada_oc_aviamento: "/entrada-saida/oc-aviamento",
  entrada_oc_insumo: "/entrada-saida/oc-insumo",
  entrada_os_tecido: "/entrada-saida/os-tecido",
  entrada_os_aviamento: "/entrada-saida/os-aviamento",
  criacao_plan_tecido: "/criacao/plan-tecido",
  criacao_planejamento: "/criacao/planejamento",
  criacao_desenvolvimento: "/criacao/desenvolvimento",
  producao_explosao: "/entrada-saida/explosao",
  // PCP é o próprio Serviços (nível de página única): a tela fica NO basePath /pcp, então
  // producao_terceirizados NÃO entra em PAGE_URLS (senão viraria sub-item/hub em vez de link direto).
  // Oficina e CAD são acessados dentro de outras telas — também sem item próprio na navegação.
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
  producao_explosao: Scissors,
  entrada_oc_tecido: ShoppingCart,
  entrada_alertas_tecido: AlertTriangle,
  entrada_oc_aviamento: ShoppingCart,
  entrada_oc_insumo: ShoppingCart,
  entrada_os_tecido: FileText,
  entrada_os_aviamento: FileText,
  criacao_plan_tecido: Layers,
  criacao_planejamento: ClipboardList,
  criacao_desenvolvimento: Hammer,
  producao_terceirizados: Factory,
  producao_cq: CheckCircle2,
  producao_direcionamento: Split,
  producao_lancamentos: Rocket,
};
