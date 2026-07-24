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

  // Full-page: intercepta navegação de rota. shouldBlockFn é gated por blockNav, então em
  // modais o blocker fica inerte. `enableBeforeUnload` TAMBÉM precisa ser gated: o padrão do
  // router é `true` e NÃO consulta o shouldBlockFn — sem isto, o prompt nativo "Sair do site?"
  // dispararia em TODA tela com guarda, mesmo limpa. useCallback estabiliza (evita re-registrar
  // o blocker a cada render).
  const shouldBlock = useCallback(() => !!blockNav && dirty, [blockNav, dirty]);
  const blocker = useBlocker({
    shouldBlockFn: shouldBlock,
    enableBeforeUnload: shouldBlock,
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
  confirm: UnsavedConfirm;
  /** Texto da descrição do diálogo. Padrão: "Há alterações não salvas." */
  message?: string;
}

/**
 * Renderiza o diálogo "Descartar alterações?" (confirmação ao fechar/navegar com
 * pendências). O indicador visual fica INLINE no header de cada tela via
 * `<UnsavedIndicator show={dirty} />` (de `@/components/shared/UnsavedIndicator`).
 * Coloque um `<UnsavedChangesGuard>` por formulário (em qualquer lugar do JSX).
 */
export function UnsavedChangesGuard({ confirm, message }: UnsavedChangesGuardProps) {
  return (
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
  );
}
