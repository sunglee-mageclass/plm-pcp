import { useEffect, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * AlertDialog de "reprovar mão de obra" com motivo OBRIGATÓRIO — extraído do `MaoObraEditor`
 * (spec 2026-08-11, Task 2) p/ ser reusado pela seção expandida de MO na lista de cards do
 * Planejamento (`MoListaSection`), SEM mudar o comportamento original do editor: motivo
 * reseta a cada abertura, `Reprovar` fica desabilitado até o motivo ter conteúdo.
 */
export function MoReprovarDialog({
  open, onOpenChange, onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  useEffect(() => { if (open) setMotivo(""); }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reprovar mão de obra</AlertDialogTitle>
          <AlertDialogDescription>Diga o motivo — ele aparece na linha do serviço.</AlertDialogDescription>
        </AlertDialogHeader>
        <textarea className="min-h-[80px] w-full rounded border bg-background px-2 py-1.5 text-sm max-md:text-base"
          value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: valor acima do previsto; refazer a cotação." />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction disabled={!motivo.trim()} onClick={(e) => { e.preventDefault(); if (motivo.trim()) onConfirm(motivo.trim()); }}>Reprovar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
