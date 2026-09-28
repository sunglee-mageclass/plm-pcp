// Integração — "Ver resposta de exemplo" (N12): RPC só leitura integracao_exemplo (SÓ super admin, loja atual, produtos
// FICTÍCIOS com as colunas marcadas da loja); NÃO registra acesso nem conta no limite. Foto = null (sem link) de propósito.
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { mensagemErro } from "@/lib/erro-mensagem";
import { montarResposta, type RespostaLer } from "@/lib/integracao/api/resposta";

export function ExemploDialog({ onFechar }: { onFechar: () => void }) {
  const tenantId = useActiveTenantId();
  const q = useQuery({
    queryKey: ["integracao-exemplo", tenantId],
    enabled: !!tenantId,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("integracao_exemplo" as any);
      if (error) throw error;
      return montarResposta(data as RespostaLer, { geradoEm: new Date().toISOString(), foto: () => null });
    },
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Resposta de exemplo (modo teste)</DialogTitle>
          <DialogDescription>
            Produtos de EXEMPLO fictícios no mesmo formato da loja (nunca dados reais). Aqui a Foto vem null (sem link) de propósito.
          </DialogDescription>
        </DialogHeader>
        {q.isError ? <p className="text-sm text-destructive">{mensagemErro(q.error, "Não foi possível montar o exemplo.")}</p>
          : !q.data ? <p className="text-sm text-muted-foreground">Montando…</p>
            : <pre className="max-w-full overflow-x-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(q.data, null, 2)}</pre>}
        <DialogFooter><Button type="button" onClick={onFechar}>Fechar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
