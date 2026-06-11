import { createFileRoute } from "@tanstack/react-router";
import { Tags } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AttributeTab, type AttributeTabConfig } from "@/components/attribute-tab";

export const Route = createFileRoute("/_authenticated/cadastro/atributos")({
  component: AtributosPage,
});

const TABS: Array<{ value: string; label: string; config: AttributeTabConfig }> = [
  {
    value: "cores",
    label: "Cores",
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
    label: "Cat. Fornecedor",
    config: {
      table: "categorias_fornecedor",
      nameField: "nome",
      singular: "Categoria de Fornecedor",
      plural: "Categorias de Fornecedor",
      usage: [{ table: "empresas", column: "categoria_fornecedor_id" }],
    },
  },
  {
    value: "cat_tecido",
    label: "Cat. Tecido",
    config: {
      table: "categorias_tecido",
      nameField: "nome",
      singular: "Categoria de Tecido",
      plural: "Categorias de Tecido",
      usage: [{ table: "artigos", column: "categoria_tecido_id" }],
    },
  },
  {
    value: "cat_aviamento",
    label: "Cat. Aviamento",
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
    label: "Subcat. Aviamento",
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
    label: "Material Aviamento",
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
    label: "Cat. Produto",
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
    label: "Cat. Terceirizado",
    config: {
      table: "categorias_terceirizado",
      nameField: "nome",
      singular: "Categoria de Terceirizado",
      plural: "Categorias de Terceirizado",
      usage: [
        { table: "terceirizados", column: "categoria_terceirizado_id" },
        { table: "producao_terceirizados", column: "categoria_terceirizado_id" },
      ],
    },
  },
];

function AtributosPage() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center gap-3">
        <Tags className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Atributos</h1>
          <p className="text-sm text-muted-foreground">
            Listas de apoio usadas em todo o cadastro do sistema.
          </p>
        </div>
      </header>

      <Tabs defaultValue={TABS[0].value} className="space-y-4">
        <TabsList className="flex flex-wrap h-auto justify-start">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((t) => (
          <TabsContent key={t.value} value={t.value} className="mt-4">
            <AttributeTab config={t.config} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
