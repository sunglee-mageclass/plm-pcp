import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  avisoExclusaoColecao, LIMITE_LISTA_CARDS, type CardDaColecao,
} from "@/lib/colecao-excluir";

/**
 * [modularidade F3 · P-255 A] Confirmação de EXCLUIR coleção do OTB, compartilhada por `ColecaoSheet` e `ColecaoPVSheet`.
 * Ao abrir, consulta os cards da coleção (dado fresco, `count: "exact"`, até 20): com card, mostra quantos/quais e NÃO
 * oferece confirmar (o servidor recusa — `colecao_com_cards: N` — e nunca apaga card); sem card, o aviso de sempre + o
 * plano de tecido também é apagado. Erro do servidor vai por `mensagemErro` no `onError` de quem chama.
 */
export function ExcluirColecaoDialog({
  open, onOpenChange, colecaoId, nome, pending, onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  colecaoId: string | null | undefined;
  nome: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  const cards = useQuery({
    queryKey: ["otb-excluir-colecao-cards", colecaoId],
    enabled: open && !!colecaoId,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from("modelos")
        .select("id, nome, ref", { count: "exact" })
        .eq("colecao_id", colecaoId!)
        .order("nome")
        .limit(LIMITE_LISTA_CARDS);
      if (error) throw error;
      const lista = (data ?? []) as CardDaColecao[];
      return { n: count ?? lista.length, lista };
    },
  });

  const conferindo = !!colecaoId && (cards.isPending || cards.isFetching);
  const aviso = cards.data ? avisoExclusaoColecao(cards.data.n, cards.data.lista) : null;
  // Consulta falhou: o servidor continua sendo o portão (recusa com cards); a tela não trava o dono por isso.
  const semConferencia = !conferindo && !aviso;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{aviso?.bloqueada ? `Não dá para excluir a coleção “${nome}”` : `Excluir a coleção “${nome}”?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {conferindo && "Conferindo os cards desta coleção…"}
            {aviso && aviso.mensagem}
            {semConferencia &&
              "Não foi possível conferir os cards desta coleção agora. Se houver cards no Planejamento, o sistema recusa a exclusão. Exclui a coleção, as semanas e o plano de tecido dela; esta ação não pode ser desfeita."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {aviso?.bloqueada && (
          <div className="max-h-56 overflow-y-auto rounded-md border bg-muted/40 p-3">
            <ul className="space-y-1 text-sm">
              {aviso.itens.map((t, i) => (
                <li key={i} className="truncate">{t}</li>
              ))}
              {aviso.maisTexto && <li className="text-muted-foreground">{aviso.maisTexto}</li>}
            </ul>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{aviso?.bloqueada ? "Entendi" : "Cancelar"}</AlertDialogCancel>
          {!aviso?.bloqueada && (
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => { e.preventDefault(); onConfirm(); }}
              disabled={pending || conferindo}
            >
              {pending ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
