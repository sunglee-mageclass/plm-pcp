import { useCallback, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { UnsavedIndicator } from "./UnsavedIndicator";

const MSG_PADRAO = "Há alterações não salvas.";

export interface UnsavedConfirm {
  open: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
}

interface UseUnsavedGuardOpts {
  /** Há alterações não salvas? */
  dirty: boolean;
  /** Fechamento real do modal (ex.: setOpen(false) / onClose). Opcional em telas full-page. */
  onClose?: () => void;
  /**
   * Full-page: bloqueia a navegação de rota enquanto houver alterações.
   * Em modais (Sheet/Dialog), deixe `false` — o guarda age no fechar.
   */
  blockNav?: boolean;
}

/**
 * Guarda genérico de "alterações não salvas". Retorna:
 *  - `requestClose()`: chame no onOpenChange/X/Cancelar do modal. Abre a
 *    confirmação se houver alterações; caso contrário fecha direto.
 *  - `confirm`: estado que alimenta o <UnsavedChangesGuard>.
 *
 * Em telas full-page passe `blockNav: true`: qualquer navegação de rota
 * enquanto `dirty` mostra a mesma confirmação (via useBlocker do router).
 */
export function useUnsavedGuard({ dirty, onClose, blockNav }: UseUnsavedGuardOpts) {
  const [open, setOpen] = useState(false);

  // Full-page: intercepta navegação de rota. shouldBlockFn é gated por blockNav,
  // então em modais o blocker fica inerte (nunca bloqueia).
  const blocker = useBlocker({
    shouldBlockFn: () => !!blockNav && dirty,
    withResolver: true,
  });
  const navBlocked = blocker.status === "blocked";

  const requestClose = useCallback(() => {
    if (dirty) setOpen(true);
    else onClose?.();
  }, [dirty, onClose]);

  const onKeepEditing = useCallback(() => {
    if (navBlocked) blocker.reset?.();
    setOpen(false);
  }, [navBlocked, blocker]);

  const onDiscard = useCallback(() => {
    if (navBlocked) {
      blocker.proceed?.();
      setOpen(false);
      return;
    }
    setOpen(false);
    onClose?.();
  }, [navBlocked, blocker, onClose]);

  const confirm: UnsavedConfirm = { open: open || navBlocked, onKeepEditing, onDiscard };
  return { requestClose, confirm };
}

interface UnsavedChangesGuardProps {
  dirty: boolean;
  confirm: UnsavedConfirm;
  /** Texto da descrição do diálogo. Padrão: "Há alterações não salvas." */
  message?: string;
}

/**
 * Renderiza o indicador flutuante "● alterações não salvas" (canto inferior
 * direito, desktop) e o diálogo "Descartar alterações?". Coloque uma vez por
 * formulário, junto ao Sheet/Dialog/página.
 */
export function UnsavedChangesGuard({ dirty, confirm, message }: UnsavedChangesGuardProps) {
  return (
    <>
      {dirty && (
        // Acima da barra de ações (rodapé do Sheet/Dialog ou MobileActionBar), p/ não
        // sobrepor os botões Salvar/Voltar que ficam no canto inferior direito.
        <div className="pointer-events-none fixed bottom-20 right-4 z-50 md:bottom-24">
          <UnsavedIndicator show />
        </div>
      )}
      <AlertDialog open={confirm.open} onOpenChange={(o) => { if (!o) confirm.onKeepEditing(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
            <AlertDialogDescription>{message ?? MSG_PADRAO}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={confirm.onKeepEditing}>Continuar editando</AlertDialogCancel>
            <AlertDialogAction onClick={confirm.onDiscard}>Descartar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
