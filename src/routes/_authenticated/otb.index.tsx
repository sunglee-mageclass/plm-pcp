import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
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
  const qc = useQueryClient();
  const importar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("otb_importar_colecoes" as any);
      if (error) throw error;
      return data as { importadas: number; vinculados: number };
    },
    onSuccess: (r) => {
      toast.success(`${r.importadas} coleção(ões) importada(s), ${r.vinculados} modelo(s) vinculado(s).`);
      qc.invalidateQueries({ queryKey: ["otb-colecoes"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao importar coleções")),
  });

  if (!isModuleEnabled("otb")) {
    return <div className="container mx-auto p-6"><EmptyState icon={Target} title="OTB não habilitado" description="Ative o módulo OTB nas configurações da loja." /></div>;
  }

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-3"><Target className="h-7 w-7 text-primary mt-0.5" />
          <div><h1 className="text-2xl font-bold">OTB</h1><p className="text-sm text-muted-foreground">Orçamento de coleção.</p></div></div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => importar.mutate()} disabled={importar.isPending}>Importar coleções existentes</Button>
          <Button onClick={() => setOpenNew(true)}><Plus className="h-4 w-4 mr-1" /> Nova coleção</Button>
        </div>
      </header>
      {colecoes.length === 0 ? (
        <EmptyState icon={Target} title="Nenhuma coleção" description="Crie a primeira coleção do OTB." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {colecoes.map((c) => {
            const anoNome = c.ano_id ? (anos.find((a) => a.id === c.ano_id)?.nome ?? null) : null;
            const mesNome = c.mes_id ? (meses.find((m) => m.id === c.mes_id)?.nome ?? null) : null;
            const periodoLabel = [mesNome, anoNome].filter(Boolean).join(" / ");
            return (
              <button key={c.id} onClick={() => setOpenId(c.id)} className="text-left rounded-lg border p-3 hover:bg-muted">
                <div className="flex items-center justify-between"><span className="font-semibold">{c.nome}</span>
                  <span className="text-xs text-muted-foreground">{c.status === "confirmada" ? "Confirmada" : "Rascunho"}</span></div>
                {periodoLabel && <div className="text-xs text-muted-foreground mt-0.5">{periodoLabel}</div>}
                <div className="text-sm text-muted-foreground mt-1">Orçamento: {c.orcamento != null ? brl(Number(c.orcamento)) : "—"}</div>
              </button>
            );
          })}
        </div>
      )}
      {(openNew || openId) && (
        <ColecaoSheet colecaoId={openId} meses={meses} anos={anos}
          onClose={() => { setOpenNew(false); setOpenId(null); }} onSaved={() => {}} />
      )}
    </div>
  );
}
