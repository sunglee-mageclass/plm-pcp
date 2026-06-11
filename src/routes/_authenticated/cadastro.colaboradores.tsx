import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AttributeTab, type AttributeTabConfig } from "@/components/attribute-tab";

export const Route = createFileRoute("/_authenticated/cadastro/colaboradores")({
  component: ColaboradoresPage,
});

const usage = [{ table: "ocs_tecido", column: "responsavel_id" }];

const TABS: Array<{ value: string; label: string; config: AttributeTabConfig }> = [
  {
    value: "estilista",
    label: "Estilista",
    config: {
      table: "colaboradores",
      nameField: "nome",
      singular: "Estilista",
      plural: "Estilistas",
      usage,
      fixedFilter: { field: "tipo", value: "estilista" },
    },
  },
  {
    value: "modelista",
    label: "Modelista",
    config: {
      table: "colaboradores",
      nameField: "nome",
      singular: "Modelista",
      plural: "Modelistas",
      usage,
      fixedFilter: { field: "tipo", value: "modelista" },
    },
  },
  {
    value: "piloteiro",
    label: "Piloteiro",
    config: {
      table: "colaboradores",
      nameField: "nome",
      singular: "Piloteiro",
      plural: "Piloteiros",
      usage,
      fixedFilter: { field: "tipo", value: "piloteiro" },
    },
  },
];

function ColaboradoresPage() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center gap-3">
        <Users className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Colaboradores</h1>
          <p className="text-sm text-muted-foreground">
            Pessoas envolvidas no processo, organizadas por função.
          </p>
        </div>
      </header>

      <Tabs defaultValue={TABS[0].value} className="space-y-4">
        <TabsList>
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
