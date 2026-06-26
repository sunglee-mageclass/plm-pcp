import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tags } from "lucide-react";
import { AttributeTab, type AttributeTabConfig } from "@/components/attribute-tab";
import { useTenantModules } from "@/hooks/useTenantModules";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/cadastro/atributos")({
  component: () => (
    <RequirePermission page="cadastro_atributos">
      <AtributosPage />
    </RequirePermission>
  ),
});

type GroupKey = "GERAL" | "FORNECEDOR" | "TECIDO" | "AVIAMENTO" | "PRODUTO" | "TERCEIRIZADO";

type AttributeItem = {
  value: string;
  label: string;
  group: GroupKey;
  config: AttributeTabConfig;
};

const ATTRIBUTES: AttributeItem[] = [
  {
    value: "cores",
    label: "Cores",
    group: "GERAL",
    config: {
      table: "cores",
      nameField: "nome",
      singular: "Cor",
      plural: "Cores",
      usage: [{ table: "variantes_tecido", column: "cor_id" }],
    },
  },
  {
    value: "anos",
    label: "Ano",
    group: "GERAL",
    config: {
      table: "anos",
      nameField: "ano",
      singular: "Ano",
      plural: "Anos",
      usage: [
        { table: "artigos", column: "ano_id" },
        { table: "modelos", column: "ano_id" },
      ],
    },
  },
  {
    value: "meses",
    label: "Mês",
    group: "GERAL",
    config: {
      table: "meses",
      nameField: "mes",
      singular: "Mês",
      plural: "Meses",
      usage: [
        { table: "artigos", column: "mes_id" },
        { table: "modelos", column: "mes_id" },
      ],
    },
  },
  {
    value: "cat_fornecedor",
    label: "Categoria do Fornecedor",
    group: "FORNECEDOR",
    config: {
      table: "categorias_fornecedor",
      nameField: "nome",
      singular: "Categoria de Fornecedor",
      plural: "Categorias de Fornecedor",
      usage: [{ table: "empresa_categorias_fornecedor", column: "categoria_fornecedor_id" }],
    },
  },
  {
    value: "cat_tecido",
    label: "Categoria do Tecido",
    group: "TECIDO",
    config: {
      table: "categorias_tecido",
      nameField: "nome",
      singular: "Categoria de Tecido",
      plural: "Categorias de Tecido",
      usage: [{ table: "artigo_categorias_tecido", column: "categoria_tecido_id" }],
    },
  },
  {
    value: "cat_aviamento",
    label: "Categoria",
    group: "AVIAMENTO",
    config: {
      table: "categorias_aviamento",
      nameField: "nome",
      singular: "Categoria de Aviamento",
      plural: "Categorias de Aviamento",
      usage: [
        { table: "aviamentos", column: "categoria_aviamento_id" },
        { table: "subcategorias_aviamento", column: "categoria_aviamento_id" },
      ],
    },
  },
  {
    value: "subcat_aviamento",
    label: "Subcategoria",
    group: "AVIAMENTO",
    config: {
      table: "subcategorias_aviamento",
      nameField: "nome",
      singular: "Subcategoria de Aviamento",
      plural: "Subcategorias de Aviamento",
      usage: [{ table: "aviamentos", column: "subcategoria_aviamento_id" }],
      extra: {
        field: "categoria_aviamento_id",
        label: "Categoria de Aviamento",
        from: "categorias_aviamento",
        optionLabel: "nome",
        required: true,
      },
    },
  },
  {
    value: "mat_aviamento",
    label: "Material",
    group: "AVIAMENTO",
    config: {
      table: "materiais_aviamento",
      nameField: "nome",
      singular: "Material de Aviamento",
      plural: "Materiais de Aviamento",
      usage: [{ table: "aviamentos", column: "material_aviamento_id" }],
    },
  },
  {
    value: "intervalo_largura",
    label: "Intervalo de Largura",
    group: "AVIAMENTO",
    config: {
      table: "intervalos_largura",
      nameField: "intervalo",
      singular: "Intervalo de Largura",
      plural: "Intervalos de Largura",
      usage: [
        { table: "aviamentos", column: "intervalo_largura_id" },
        { table: "aviamentos", column: "intervalo_vazado_id" },
      ],
    },
  },
  {
    value: "cat_produto",
    label: "Categoria do Produto",
    group: "PRODUTO",
    config: {
      table: "categorias_produto",
      nameField: "nome",
      singular: "Categoria de Produto",
      plural: "Categorias de Produto",
      usage: [],
    },
  },
  {
    value: "linhas",
    label: "Linha",
    group: "PRODUTO",
    config: {
      table: "linhas",
      nameField: "nome",
      singular: "Linha",
      plural: "Linhas",
      usage: [{ table: "modelos", column: "linha_id" }],
    },
  },
  {
    value: "cat_terceirizado",
    label: "Categoria do Serviço",
    group: "TERCEIRIZADO",
    config: {
      table: "categorias_terceirizado",
      nameField: "nome",
      singular: "Categoria do Serviço",
      plural: "Categorias do Serviço",
      usage: [
        { table: "terceirizado_categorias", column: "categoria_terceirizado_id" },
        { table: "producao_terceirizados", column: "categoria_terceirizado_id" },
      ],
      // Corte e Oficina são fixos do sistema (semeados por loja); não podem ser
      // renomeados nem excluídos — "Oficina" alimenta a detecção do fluxo de oficina.
      protectedNames: ["corte", "oficina"],
    },
  },
];

const GROUP_ORDER: GroupKey[] = [
  "GERAL",
  "FORNECEDOR",
  "TECIDO",
  "AVIAMENTO",
  "PRODUTO",
  "TERCEIRIZADO",
];

function useAttributeCount(table: string) {
  return useQuery({
    queryKey: ["attribute-count", table],
    queryFn: async () => {
      const { count, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from(table as any)
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });
}

function AtributosPage() {
  const { isStockOnly } = useTenantModules();
  const [selectedValue, setSelectedValue] = useState<string>(ATTRIBUTES[0].value);
  const selected = useMemo(
    () => ATTRIBUTES.find((a) => a.value === selectedValue) ?? ATTRIBUTES[0],
    [selectedValue],
  );
  // Categoria do Produto ganha o SLA médio de oficina (dias) — exceto no modo
  // controle-de-estoque (não há produção/oficina lá).
  const activeConfig: AttributeTabConfig =
    selected.config.table === "categorias_produto" && !isStockOnly
      ? { ...selected.config, extraNumber: { field: "sla_oficina", label: "SLA Oficina (dias)", placeholder: "dias" } }
      : selected.config;

  const grouped = useMemo(() => {
    const map = new Map<GroupKey, AttributeItem[]>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const item of ATTRIBUTES) map.get(item.group)!.push(item);
    return map;
  }, []);

  const qc = useQueryClient();
  const { data: count, isLoading: countLoading } = useAttributeCount(selected.config.table);

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex items-start gap-3">
        <Tags className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <div>
          <h1 className="text-2xl font-bold">Atributos</h1>
          <p className="text-sm text-muted-foreground">
            Listas de apoio usadas em todo o cadastro do sistema.
          </p>
        </div>
      </header>

      {/* Mobile selector */}
      <div className="md:hidden">
        <Select value={selectedValue} onValueChange={setSelectedValue}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUP_ORDER.map((g) => (
              <SelectGroup key={g}>
                <SelectLabel>{g}</SelectLabel>
                {grouped.get(g)!.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-6 rounded-lg border bg-card">
        {/* Sidebar */}
        <aside className="hidden md:block w-60 shrink-0 border-r py-4">
          <nav className="space-y-4">
            {GROUP_ORDER.map((g) => (
              <div key={g}>
                <div className="px-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {g}
                </div>
                <ul className="space-y-0.5">
                  {grouped.get(g)!.map((item) => {
                    const active = item.value === selectedValue;
                    return (
                      <li key={item.value}>
                        <button
                          type="button"
                          onClick={() => setSelectedValue(item.value)}
                          className={cn(
                            "w-full text-left px-4 py-1.5 text-sm transition-colors border-l-2",
                            active
                              ? "bg-muted text-foreground font-medium border-primary"
                              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-transparent",
                          )}
                        >
                          {item.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3 border-b pb-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold truncate">{selected.config.plural}</h2>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {selected.group}
              </p>
            </div>
            <Badge variant="secondary" className="shrink-0">
              {countLoading ? "…" : `${count ?? 0} ${count === 1 ? "item" : "itens"}`}
            </Badge>
          </div>

          <AttributeTab
            key={selected.value}
            config={activeConfig}
            onChanged={() =>
              qc.invalidateQueries({ queryKey: ["attribute-count", selected.config.table] })
            }
          />
        </div>
      </div>
    </div>
  );
}
