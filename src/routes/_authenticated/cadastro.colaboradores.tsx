import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { AttributeTab, type AttributeTabConfig } from "@/components/attribute-tab";
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
export const Route = createFileRoute("/_authenticated/cadastro/colaboradores")({
  component: () => (
    <RequirePermission page="cadastro_colaboradores">
      <ColaboradoresPage />
    </RequirePermission>
  ),
});

type GroupKey = "COLABORADORES";

type ColabItem = {
  value: string;
  label: string;
  group: GroupKey;
  tipo: string;
  config: AttributeTabConfig;
};

const usage = [{ table: "ocs_tecido", column: "responsavel_id" }];

const ITEMS: ColabItem[] = [
  {
    value: "estilista",
    label: "Estilista",
    group: "COLABORADORES",
    tipo: "estilista",
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
    group: "COLABORADORES",
    tipo: "modelista",
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
    group: "COLABORADORES",
    tipo: "piloteiro",
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

const GROUP_ORDER: GroupKey[] = ["COLABORADORES"];

function useColabCount(tipo: string) {
  return useQuery({
    queryKey: ["colab-count", tipo],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("colaboradores")
        .select("id", { count: "exact", head: true })
        .eq("tipo", tipo);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

function ColaboradoresPage() {
  const [selectedValue, setSelectedValue] = useState<string>(ITEMS[0].value);
  const selected = useMemo(
    () => ITEMS.find((a) => a.value === selectedValue) ?? ITEMS[0],
    [selectedValue],
  );

  const grouped = useMemo(() => {
    const map = new Map<GroupKey, ColabItem[]>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const item of ITEMS) map.get(item.group)!.push(item);
    return map;
  }, []);

  const { data: count, isLoading: countLoading } = useColabCount(selected.tipo);

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

          <AttributeTab key={selected.value} config={selected.config} />
        </div>
      </div>
    </div>
  );
}
