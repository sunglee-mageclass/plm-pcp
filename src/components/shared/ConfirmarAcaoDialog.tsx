import { useCallback, useRef, useState, type ReactNode } from "react";
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
import type { TextoConfirmacao } from "@/lib/confirmacoes-textos";

/**
 * [camada C2] Diálogo "Tem certeza?" único do sistema para as ações aprovadas (P-263/P-262/P-265).
 * `pedido` = texto aprovado (`confirmacoes-textos.ts`) + o que fazer ao confirmar. `null` = fechado.
 * Cancelar (ou Esc / clique fora) NUNCA executa nada: só fecha. Confirmar executa `onConfirmar` UMA vez e fecha.
 * Vermelho (`destrutivo`) quando desfaz/apaga; neutro quando refaz/reabre/ajusta (cartilha c2-textos.md).
 */
export interface PedidoConfirmacao extends Omit<TextoConfirmacao, "descricao"> {
  descricao: ReactNode;
  onConfirmar: () => void;
  /** Opcional: roda quando a pessoa FECHA sem confirmar (Cancelar/Voltar/Esc/clique fora) — ex.: devolver o campo ao valor anterior. Nunca grava. */
  onCancelar?: () => void;
}

export function ConfirmarAcaoDialog({
  pedido,
  onClose,
  pendente = false,
}: {
  pedido: PedidoConfirmacao | null;
  onClose: () => void;
  /** Desabilita os botões enquanto a ação anterior ainda está em voo. */
  pendente?: boolean;
}) {
  // Guarda o último pedido: durante a animação de fechar o conteúdo não pisca vazio.
  const ultimo = useRef<PedidoConfirmacao | null>(null);
  if (pedido) ultimo.current = pedido;
  const p = pedido ?? ultimo.current;
  // O Radix fecha o diálogo TAMBÉM ao confirmar: só conta como "cancelou" quando o Confirmar não foi clicado.
  const confirmou = useRef(false);
  const aoMudar = (o: boolean) => {
    if (o) return;
    const cancelou = !confirmou.current;
    confirmou.current = false;
    if (cancelou) pedido?.onCancelar?.();
    onClose();
  };
  return (
    <AlertDialog open={!!pedido} onOpenChange={aoMudar}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{p?.titulo}</AlertDialogTitle>
          <AlertDialogDescription>{p?.descricao}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pendente}>{p?.cancelar ?? "Cancelar"}</AlertDialogCancel>
          <AlertDialogAction
            variant={p?.destrutivo === false ? "default" : "destructive"}
            disabled={pendente}
            onClick={() => {
              confirmou.current = true;
              p?.onConfirmar();
            }}
          >
            {p?.confirmar}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Hook de uso: `const { pedir, dialog } = useConfirmacao();` → `pedir({ ...texto, onConfirmar })` abre o diálogo;
 * renderize `{dialog}` uma vez na tela (fora de qualquer `<fieldset disabled>`).
 */
export function useConfirmacao(pendente = false) {
  const [pedido, setPedido] = useState<PedidoConfirmacao | null>(null);
  const pedir = useCallback((p: PedidoConfirmacao) => setPedido(p), []);
  const fechar = useCallback(() => setPedido(null), []);
  const dialog = <ConfirmarAcaoDialog pedido={pedido} onClose={fechar} pendente={pendente} />;
  return { pedir, fechar, aberto: pedido !== null, dialog };
}
