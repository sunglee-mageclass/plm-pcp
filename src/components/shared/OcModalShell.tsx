import type { ReactNode } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { UnsavedChangesGuard, useUnsavedGuard } from "./UnsavedChangesGuard";

/**
 * Casca do modal de OC (Tecido/Aviamento): abrir uma OC EXISTENTE usa um Sheet
 * lateral a 70% (padrão dos cards do sistema); criar uma NOVA usa um Dialog
 * centralizado. Preserva o layout em grade — cabeçalho fixo · corpo rolável ·
 * rodapé fixo — em ambos, já que Sheet e Dialog são a mesma primitiva Radix.
 *
 * Passe `dirty` para ativar o guarda de "alterações não salvas": fechar (X, ESC,
 * clicar fora) com alterações pendentes pede confirmação antes de descartar.
 */
export function OcModalShell({
  isEdit,
  onClose,
  children,
  dirty = false,
  discardMessage,
}: {
  isEdit: boolean;
  onClose: () => void;
  children: ReactNode;
  dirty?: boolean;
  discardMessage?: string;
}) {
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose });
  const grid = "grid grid-rows-[auto_minmax(0,1fr)_auto] !overflow-hidden";
  const guard = <UnsavedChangesGuard confirm={confirm} message={discardMessage} />;
  if (isEdit) {
    return (
      <Sheet open onOpenChange={(o) => !o && requestClose()}>
        <SheetContent
          side="right"
          size="editor"
          className={`${grid} max-md:w-screen max-md:!p-4 max-md:[&>button]:hidden`}
        >
          {children}
          {guard}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open onOpenChange={(o) => !o && requestClose()}>
      {/* fixedFooter+mobileFull vivem no primitivo agora (§G) — o grid header·corpo·rodapé
          e o full-screen mobile deixaram de ser injetados à mão aqui. */}
      <DialogContent fixedFooter mobileFull className="max-w-4xl">
        {children}
        {guard}
      </DialogContent>
    </Dialog>
  );
}
