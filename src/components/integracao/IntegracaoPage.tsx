// Integração + API — tela (spec §6). Abas por papel: src/lib/integracao/abas.ts.
import { useState, type ComponentType } from "react";
import { Construction } from "lucide-react";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { EmptyState } from "@/components/shared/EmptyState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { ROTULO_ABA, abasVisiveis, type Aba } from "@/lib/integracao/abas";

function AbaPendente() {
  return <EmptyState icon={Construction} title="Em construção" description="Esta aba chega nas próximas tasks do plano da Integração." />;
}
// Cada task da tela troca a sua entrada (Tasks 12b, 14, 15, 16 e 17).
const CONTEUDO_ABA: Record<Aba, ComponentType> = {
  produtos: AbaPendente,
  campos: AbaPendente,
  api: AbaPendente,
  manual: AbaPendente,
  log: AbaPendente,
};

export function IntegracaoPage() {
  const { isSuperAdmin } = useAuth();
  const abas = abasVisiveis(isSuperAdmin);
  const [aba, setAba] = useState<Aba>("produtos");
  const atual = abas.includes(aba) ? aba : "produtos";
  return (
    <div className="space-y-4 p-4 pb-24 md:p-6">
      <Breadcrumb items={[{ label: "Sistema" }, { label: "Integração" }]} />
      <h1 className="font-display text-2xl font-semibold">Integração</h1>
      <Tabs value={atual} onValueChange={(v) => setAba(v as Aba)}>
        <TabsList className="max-w-full overflow-x-auto">
          {abas.map((a) => (
            <TabsTrigger key={a} value={a}>{ROTULO_ABA[a]}</TabsTrigger>
          ))}
        </TabsList>
        {abas.map((a) => {
          const C = CONTEUDO_ABA[a];
          return (
            <TabsContent key={a} value={a} className="mt-4">
              <C />
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
