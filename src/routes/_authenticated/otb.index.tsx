import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantModules } from "@/hooks/useTenantModules";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { Target, Plus } from "lucide-react";
import { ColecaoSheet } from "@/components/otb/ColecaoSheet";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/otb/")({ component: OtbPage });

function useOpts(table: string, key = "nome") {
  return useQuery({ queryKey: ["opt", table], queryFn: async () => {
    const { data } = await supabase.from(table as any).select(`id, ${key}`).order(key);
    return ((data ?? []) as any[]).map((r) => ({ id: r.id, nome: r[key] }));
  }});
}

function OtbPage() {
  const { isModuleEnabled } = useTenantModules();
  const [openId, setOpenId] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const { data: meses = [] } = useOpts("meses", "mes");
  const { data: anos = [] } = useOpts("anos", "ano");
  const { data: colecoes = [] } = useQuery({
    queryKey: ["otb-colecoes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colecoes").select("id, nome, status, orcamento, mes_id, ano_id").order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  if (!isModuleEnabled("otb")) {
    return <div className="container mx-auto p-6"><EmptyState icon={Target} title="OTB não habilitado" description="Ative o módulo OTB nas configurações da loja." /></div>;
  }

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-3"><Target className="h-7 w-7 text-primary mt-0.5" />
          <div><h1 className="text-2xl font-bold">OTB</h1><p className="text-sm text-muted-foreground">Orçamento de coleção.</p></div></div>
        <Button onClick={() => setOpenNew(true)}><Plus className="h-4 w-4 mr-1" /> Nova coleção</Button>
      </header>
      {colecoes.length === 0 ? (
        <EmptyState icon={Target} title="Nenhuma coleção" description="Crie a primeira coleção do OTB." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {colecoes.map((c) => (
            <button key={c.id} onClick={() => setOpenId(c.id)} className="text-left rounded-lg border p-3 hover:bg-muted">
              <div className="flex items-center justify-between"><span className="font-semibold">{c.nome}</span>
                <span className="text-xs text-muted-foreground">{c.status === "confirmada" ? "Confirmada" : "Rascunho"}</span></div>
              <div className="text-sm text-muted-foreground mt-1">Orçamento: {c.orcamento != null ? brl(Number(c.orcamento)) : "—"}</div>
            </button>
          ))}
        </div>
      )}
      {(openNew || openId) && (
        <ColecaoSheet colecaoId={openId} meses={meses} anos={anos}
          onClose={() => { setOpenNew(false); setOpenId(null); }} onSaved={() => {}} />
      )}
    </div>
  );
}
