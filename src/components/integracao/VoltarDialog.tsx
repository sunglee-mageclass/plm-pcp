// Integração — "Voltar para não integrável?" (mockup 3b; P-63 A: sem campo de motivo). Só integrável (o servidor confere).
//
// Fix round 1 T13 (revisão T13 #5, code-review Important I1): P0409 `integracao_mudou` (algum produto do lote não
// está mais `integravel` — a API já levou, ou outra pessoa já voltou) NÃO usa mais o texto genérico de
// `mensagemErro` ("...Confira o resumo novo e confirme de novo."), que é escrito pro fluxo do Integrar (que TEM um
// resumo pra reconferir) — o Voltar não tem resumo nenhum, e "confirme de novo" prometia uma ação que falharia toda
// vez com o MESMO snapshot. Mensagem própria abaixo; o diálogo em si já ENCOLHE/FECHA sozinho (`ProdutosAba.tsx`
// deriva `voltarProdutosAtuais` da lista fresca, invalidada por este `onError`), então "confira a lista" já reflete
// o que a tela literalmente acabou de fazer.
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

const TEXTO_VOLTAR_MUDOU =
  "Algum produto já não está integrável (a API levou ou alguém voltou). Nada foi alterado — confira a lista.";

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
      // Fix round 1 T13 (revisão T13 #5): P0409 (`integracao_mudou`) tem mensagem PRÓPRIA, sem o "confirme de novo"
      // do fluxo do Integrar — os outros erros (42501 de permissão, P0001) continuam pela tradução padrão.
      const code = (e as { code?: string })?.code;
      toast.error(code === "P0409" ? TEXTO_VOLTAR_MUDOU : mensagemErro(e, "Não foi possível voltar."));
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
