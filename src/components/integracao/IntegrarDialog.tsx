// Integração — "Tenho certeza" (mockup 3). Texto do dono VERBATIM + o resumo de integracao_previa (o dado SALVO). Confirmar
// = integracao_marcar com as assinaturas DESTE resumo; P0409 integracao_mudou = o produto mudou no meio → relê o resumo.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment } from "react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { mensagemErro } from "@/lib/erro-mensagem";
import { CAMPO_BY_KEY, TEXTO_ALERTA_INTEGRAR } from "@/lib/integracao/campos";
import { celulaResumo, itensMarcar, lerResumo, type ResumoIntegrar } from "@/lib/integracao/resumo";
import { invalidarIntegracao } from "./useIntegracao";

export function IntegrarDialog({ ids, onFechar, onFeito }: { ids: string[]; onFechar: () => void; onFeito: () => void }) {
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["integracao-previa", tenantId, ids],
    staleTime: 0,
    queryFn: async (): Promise<ResumoIntegrar> => {
      const { data, error } = await supabase.rpc("integracao_previa" as any, { _modelo_ids: ids });
      if (error) throw error;
      return lerResumo(data);
    },
  });
  const marcar = useMutation({
    mutationFn: async (itens: { modelo_id: string; assinatura: string }[]) => {
      const { data, error } = await supabase.rpc("integracao_marcar" as any, { _itens: itens });
      if (error) throw error;
      return Number((data as { marcados?: number } | null)?.marcados ?? 0);
    },
    onSuccess: (n) => {
      toast.success(n === 1 ? "1 produto integrável." : `${n} produtos integráveis.`);
      invalidarIntegracao(qc, tenantId, ids);
      onFeito();
    },
    onError: (e) => {
      toast.error(mensagemErro(e, "Não foi possível integrar."));
      if ((e as { code?: string })?.code === "P0409") void q.refetch();
    },
  });
  const r = q.data;
  const campos = (r?.campos ?? []).map((k) => CAMPO_BY_KEY.get(k)!).filter(Boolean);
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o && !marcar.isPending) onFechar(); }}>
      <AlertDialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Integrar produtos</AlertDialogTitle>
          <AlertDialogDescription className="text-base font-semibold text-destructive">{TEXTO_ALERTA_INTEGRAR}</AlertDialogDescription>
        </AlertDialogHeader>
        {q.isError ? (
          <p className="text-sm text-destructive">{mensagemErro(q.error, "Não foi possível montar o resumo.")}</p>
        ) : !r ? (
          <p className="text-sm text-muted-foreground">Montando o resumo…</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-4">
              <span>Produtos <strong className="tabular-nums">{r.entram.length}</strong></span>
              <span>Sublinhas (variante × tamanho) <strong className="tabular-nums">{r.sublinhas}</strong></span>
            </div>
            <p className="text-muted-foreground">Valores que vão na API (dado salvo, {r.campos.length} campos marcados)</p>
            <div className="max-w-full overflow-x-auto rounded-md border">
              <table className="w-full min-w-max border-collapse text-xs">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>{campos.map((c) => <th key={c.key} className="whitespace-nowrap px-2 py-2">{c.rotuloCurto}</th>)}</tr>
                </thead>
                <tbody>
                  {r.entram.map((p) => (
                    <Fragment key={p.modeloId}>
                      {p.linhas.map((l, i) => (
                        <tr key={`${p.modeloId}:${i}`} className={l.tipo === "produto" ? "border-t font-medium" : "border-t border-dashed text-muted-foreground"}>
                          {campos.map((c) => <td key={c.key} className="whitespace-nowrap px-2 py-2">{celulaResumo(c.key, l, l.tipo === "produto")}</td>)}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {r.fora.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {r.fora.map((f) => <li key={f.nome}>Não entra: {f.nome} — {f.motivo}</li>)}
              </ul>
            )}
            {r.bloqueio && <p className="font-medium text-destructive">{r.bloqueio}</p>}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={marcar.isPending}>Cancelar</AlertDialogCancel>
          <Button type="button" disabled={!r || !!r.bloqueio || marcar.isPending || q.isFetching}
            onClick={() => r && marcar.mutate(itensMarcar(r))}>
            {marcar.isPending ? "Integrando…" : "Tenho certeza — integrar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
