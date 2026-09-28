// Integração — "Desfazer integração" (mockup 5): SÓ super admin (o servidor confere), só integrado, motivo obrigatório (≥ 3).
//
// Fix round 1 T13 (revisão T13 #10, task-13-review.md Minor m4): o `.length` de uma string JS conta UNIDADES
// UTF-16, não CODE POINTS — um emoji/caractere astral (fora do BMP, ex. "👍") ocupa 2 unidades em `.length` mas só
// 1 code point pra quem digita e pro Postgres (`length()` do servidor conta code points, `m3:245`). Sem isso,
// "👍👍" (2 emojis) contava 4 aqui (botão HABILITADO) mas só 2 no servidor (P0001, abaixo do mínimo) — o T12b já
// tinha essa mesma lição em `rascunho.ts` (`validarRascunho`, limite de nome do comprado). `[...motivo].length`
// (iterador de code points) bate com o `length()` do Postgres.
//
// Fix round 2 T13 (revisão T13 #13, task-13-code-review.md "Re-check round 1" m5, metade do Desfazer): `onError`
// só mostrava o toast — nunca invalidava a lista/estado/log, ao contrário de Integrar e Voltar (que já invalidam em
// QUALQUER erro desde o fix round 1). Um erro aqui (ex.: outro super admin já desfez este MESMO produto entre abrir
// o diálogo e confirmar) deixava a linha "Integrado" com o "⋯" ainda oferecendo Desfazer sobre um estado que já
// mudou, até uma relista externa. Fix: `invalidarIntegracao(...)` também no `onError`, igual aos outros 2 diálogos.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { ProdutoLista } from "@/lib/integracao/produtos";
import { MOTIVO_MIN, textoDesfazer } from "@/lib/integracao/resumo";
import { confirmarLojaAtiva, invalidarIntegracao } from "./useIntegracao";

export function DesfazerDialog({ produto, onFechar, onFeito }: { produto: ProdutoLista; onFechar: () => void; onFeito: () => void }) {
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState("");
  const desfazer = useMutation({
    mutationFn: async () => {
      // revisão T15 #I1-R (code-review "Re-check round 1"): relê a loja ativa DIRETO do servidor antes de
      // desfazer — mesma defesa dos outros pontos de escrita da Integração (ver `useIntegracao.ts:confirmarLojaAtiva`).
      await confirmarLojaAtiva(tenantId);
      const { error } = await supabase.rpc("integracao_desfazer" as any, { _modelo_id: produto.modeloId, _motivo: motivo.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Integração de "${produto.raw.nome}" desfeita.`);
      invalidarIntegracao(qc, tenantId, [produto.modeloId]);
      onFeito();
    },
    onError: (e) => {
      toast.error(mensagemErro(e, "Não foi possível desfazer a integração."));
      invalidarIntegracao(qc, tenantId, [produto.modeloId]);
    },
  });
  const ok = [...motivo.trim()].length >= MOTIVO_MIN;
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o && !desfazer.isPending) onFechar(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Desfazer integração</AlertDialogTitle>
          <AlertDialogDescription>{textoDesfazer(produto.raw.nome, produto.raw.ref)}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1">
          <Label htmlFor="integracao-motivo">Motivo (obrigatório)</Label>
          <Textarea id="integracao-motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={desfazer.isPending}>Cancelar</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={!ok || desfazer.isPending} onClick={() => desfazer.mutate()}>
            {desfazer.isPending ? "Desfazendo…" : "Desfazer integração"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
