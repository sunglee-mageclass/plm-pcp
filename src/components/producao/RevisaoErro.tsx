import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Badge #Erro na lista de um setor, quando a etapa está com revisão pendente.
export function RevisaoErroBadge({ revisao, etapa }: { revisao: any; etapa: string }) {
  if (!revisao || !revisao[etapa]) return null;
  return <Badge className="bg-red-600 hover:bg-red-600">#Erro</Badge>;
}

// Banner + botão "Marcar verificado" no detalhe do setor (some o #Erro daquela etapa).
export function VerificarRevisao({ modeloId, etapa }: { modeloId: string; etapa: string }) {
  const qc = useQueryClient();
  const { data: pendente } = useQuery({
    queryKey: ["revisao-pendente", modeloId, etapa],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase.from("modelos").select("revisao_pendente").eq("id", modeloId).maybeSingle();
      if (error) throw error;
      return !!((data?.revisao_pendente as any)?.[etapa]);
    },
  });

  const verificar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("marcar_etapa_verificada" as any, { _modelo_id: modeloId, _etapa: etapa });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Etapa verificada");
      qc.invalidateQueries({ queryKey: ["revisao-pendente", modeloId, etapa] });
      ["producao-terc-list", "producao-cq-list", "dir-list"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao verificar"),
  });

  if (!pendente) return null;
  return (
    <Card className="p-3 border-red-500/50 bg-red-500/5 flex items-start justify-between gap-3">
      <div className="flex items-start gap-2 text-sm">
        <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
        <span>
          <b>#Erro — revisão pendente.</b> Algo foi alterado numa etapa anterior (grade, consumo ou aviamentos).
          Confira os valores/quantidades desta etapa e marque como verificado.
        </span>
      </div>
      <Button size="sm" variant="outline" className="shrink-0" onClick={() => verificar.mutate()}>
        <CheckCircle2 className="h-4 w-4 mr-1" /> Marcar verificado
      </Button>
    </Card>
  );
}
