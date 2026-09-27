// Integração + API — tela (spec §6). Abas por papel: src/lib/integracao/abas.ts.
import { useCallback, useMemo, useState, type ComponentType } from "react";
import { Construction } from "lucide-react";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { EmptyState } from "@/components/shared/EmptyState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useAuth } from "@/hooks/useAuth";
import { ROTULO_ABA, abasVisiveis, type Aba } from "@/lib/integracao/abas";
import { GuardaIntegracaoContext } from "./guard";
import { ProdutosAba } from "./ProdutosAba";
import { CamposAba } from "./CamposAba";
import { ApiAba } from "./ApiAba";

function AbaPendente() {
  return <EmptyState icon={Construction} title="Em construção" description="Esta aba chega nas próximas tasks do plano da Integração." />;
}
// Cada task da tela troca a sua entrada (Tasks 12b, 14, 15, 16 e 17).
const CONTEUDO_ABA: Record<Aba, ComponentType> = {
  produtos: ProdutosAba,
  campos: CamposAba,
  api: ApiAba,
  manual: AbaPendente,
  log: AbaPendente,
};

export function IntegracaoPage() {
  const { isSuperAdmin } = useAuth();
  const abas = abasVisiveis(isSuperAdmin);
  const [aba, setAba] = useState<Aba>("produtos");
  const [sujas, setSujas] = useState<Partial<Record<Aba, boolean>>>({});
  const informarSujo = useCallback(
    (a: Aba, s: boolean) => setSujas((x) => (Boolean(x[a]) === s ? x : { ...x, [a]: s })),
    [],
  );
  const guarda = useMemo(() => ({ informarSujo }), [informarSujo]);
  const dirty = Object.values(sujas).some(Boolean);
  const { requestAction, confirm } = useUnsavedGuard({ dirty, blockNav: true });
  const atual = abas.includes(aba) ? aba : "produtos";
  return (
    <GuardaIntegracaoContext.Provider value={guarda}>
      <div className="space-y-4 p-4 pb-24 md:p-6">
        <Breadcrumb items={[{ label: "Sistema" }, { label: "Integração" }]} />
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl font-semibold">Integração</h1>
          <UnsavedIndicator show={dirty} />
        </div>
        <Tabs value={atual} onValueChange={(v) => { if (v !== atual) requestAction(() => setAba(v as Aba)); }}>
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
      <UnsavedChangesGuard confirm={confirm} />
    </GuardaIntegracaoContext.Provider>
  );
}
