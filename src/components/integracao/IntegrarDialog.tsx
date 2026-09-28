// Integração — "Tenho certeza" (mockup 3). Texto do dono VERBATIM + o resumo de integracao_previa (o dado SALVO). Confirmar
// = integracao_marcar com as assinaturas DESTE resumo; P0409 integracao_mudou = o produto mudou no meio → relê o resumo.
//
// Fix round 1 T13 (revisão T13 #7, task-13-review.md m1/m8-c + task-13-code-review.md m1/m2/m6/m7/m9):
// - m1: `disabled` do "Tenho certeza" agora inclui `q.isError` — o TanStack v5 MANTÉM `r` (o resumo antigo) depois
//   de um refetch que falha, então sem esse check o botão ficava HABILITADO sobre um resumo ESCONDIDO (o ramo
//   `q.isError` troca a tabela pela mensagem de erro, mas o `r` velho continuava alimentando `itensMarcar`).
// - m2: `onError` agora SEMPRE relê o resumo e invalida a lista — não só no P0409. Um P0001 "reprovado" ou um
//   42501 "módulo desligado" também deixam o resumo/lista desatualizados (o produto continua em `entram` com a
//   assinatura antiga), e cada nova tentativa falharia do mesmo jeito sem isso.
// - m6: a query ganhou `gcTime: 0` — o resumo de uma abertura anterior (mesmos ids, mesmo tenant) não fica em cache
//   pelos 5 min padrão pra reaparecer por alguns instantes ao reabrir o mesmo produto antes do refetch terminar.
// - m7: `fora` (de `resumo.ts`) agora carrega `modeloId`/`ref` — a lista usa `key={f.modeloId}` (nunca mais
//   `key={f.nome}`, que colidia com 2 produtos de mesmo nome) e mostra a REF ao lado do nome.
// - m9 (parcial — o restante é o teste): nenhuma mudança de código além das acima; o teste cobre a chamada dupla.
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
import { confirmarLojaAtiva, invalidarIntegracao } from "./useIntegracao";

export function IntegrarDialog({ ids, onFechar, onFeito }: { ids: string[]; onFechar: () => void; onFeito: () => void }) {
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["integracao-previa", tenantId, ids],
    staleTime: 0,
    // Fix round 1 T13 (m6): sem cache entre aberturas — o resumo de uma abertura anterior nunca reaparece por
    // engano antes do refetch terminar (o rótulo "dado salvo" não pode mostrar um dado que já pode estar velho).
    gcTime: 0,
    queryFn: async (): Promise<ResumoIntegrar> => {
      const { data, error } = await supabase.rpc("integracao_previa" as any, { _modelo_ids: ids });
      if (error) throw error;
      return lerResumo(data);
    },
  });
  const marcar = useMutation({
    mutationFn: async (itens: { modelo_id: string; assinatura: string }[]) => {
      // revisão T15 #I1-R (code-review "Re-check round 1"): relê a loja ativa DIRETO do servidor antes de marcar —
      // a mesma defesa dos outros pontos de escrita da Integração (ver `useIntegracao.ts:confirmarLojaAtiva`).
      await confirmarLojaAtiva(tenantId);
      const { data, error } = await supabase.rpc("integracao_marcar" as any, { _itens: itens });
      if (error) throw error;
      return Number((data as { marcados?: number } | null)?.marcados ?? 0);
    },
    onSuccess: (n) => {
      toast.success(n === 1 ? "1 produto integrável." : `${n} produtos integráveis.`);
      invalidarIntegracao(qc, tenantId, ids);
      onFeito();
    },
    // Fix round 1 T13 (m2): QUALQUER erro (não só P0409) relê o resumo e invalida a lista — um P0001 "reprovado" ou
    // um 42501 "módulo desligado" (o servidor recusa; o `_integracao_gates`/status não entram na assinatura, então
    // o resumo antigo continua parecendo válido) deixavam a linha "Não integrável" com o toggle habilitado e o
    // resumo mostrando o produto em `entram` até uma relista externa — cada nova tentativa falhava igual.
    onError: (e) => {
      toast.error(mensagemErro(e, "Não foi possível integrar."));
      void q.refetch();
      invalidarIntegracao(qc, tenantId, ids);
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
          <div className="space-y-2">
            <p className="text-sm text-destructive">{mensagemErro(q.error, "Não foi possível montar o resumo.")}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void q.refetch()}>Tentar de novo</Button>
          </div>
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
              // Fix round 1 T13 (m7): `key`/texto por `modeloId`+`ref` — nunca `f.nome` (2 produtos de mesmo nome
              // colidiam a key do React e a mensagem ficava ambígua sobre QUAL produto não entra).
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {r.fora.map((f) => (
                  <li key={f.modeloId}>Não entra: {f.nome}{f.ref ? ` (${f.ref})` : ""} — {f.motivo}</li>
                ))}
              </ul>
            )}
            {r.bloqueio && <p className="font-medium text-destructive">{r.bloqueio}</p>}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={marcar.isPending}>Cancelar</AlertDialogCancel>
          {/* Fix round 1 T13 (m1): `q.isError` entra no disabled — sem isso, um refetch que falha (rede, ou o
              próprio retry pós-P0409/m2) mantém `r` (o resumo ANTERIOR, TanStack v5 preserva `data` em erro) e o
              botão ficava confirmável sobre um resumo que a tela nem mostra mais (trocado pela mensagem de erro). */}
          <Button type="button" disabled={!r || !!r.bloqueio || marcar.isPending || q.isFetching || q.isError}
            onClick={() => r && marcar.mutate(itensMarcar(r))}>
            {marcar.isPending ? "Integrando…" : "Tenho certeza — integrar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
