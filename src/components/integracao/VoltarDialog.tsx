// Integração — "Voltar para não integrável?" (mockup 3b; P-63 A: sem campo de motivo). Só integrável (o servidor confere).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { mensagemErro } from "@/lib/erro-mensagem";
import { textoVoltar } from "@/lib/integracao/resumo";
import { invalidarIntegracao } from "./useIntegracao";

export function VoltarDialog({ produtos, onFechar, onFeito }: {
  produtos: { id: string; nome: string }[]; onFechar: () => void; onFeito: () => void;
}) {
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const ids = produtos.map((p) => p.id);
  const voltar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("integracao_voltar" as any, { _modelo_ids: ids });
      if (error) throw error;
      return Number((data as { voltaram?: number } | null)?.voltaram ?? 0);
    },
    onSuccess: (n) => {
      toast.success(n === 1 ? "1 produto voltou para não integrável." : `${n} produtos voltaram para não integrável.`);
      invalidarIntegracao(qc, tenantId, ids);
      onFeito();
    },
    onError: (e) => {
      toast.error(mensagemErro(e, "Não foi possível voltar."));
      invalidarIntegracao(qc, tenantId, ids);
    },
  });
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o && !voltar.isPending) onFechar(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Voltar para não integrável?</AlertDialogTitle>
          <AlertDialogDescription>{textoVoltar(produtos.map((p) => p.nome))}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={voltar.isPending}>Cancelar</AlertDialogCancel>
          <Button type="button" disabled={voltar.isPending} onClick={() => voltar.mutate()}>
            {voltar.isPending ? "Voltando…" : "Voltar para não integrável"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
