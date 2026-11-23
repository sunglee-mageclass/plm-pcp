// Guarda do RASCUNHO da grade ao trocar de visão (Cards) ou de filtro/busca na tela de Tecidos.
// Sem isto, essas trocas desmontam (ou esvaziam) a grade e DESCARTAM o rascunho sem avisar — o `useUnsavedGuard` da aba só cobre
// navegação de ROTA/F5. A Aba avisa `onDirtyChange(sujo)`; `proteger(acao)` devolve a ação "guardada": limpa = roda direto;
// suja = abre o AlertDialog "Descartar alterações?" e só roda `acao` se a pessoa confirmar (Cancelar mantém a Lista e o rascunho).
import { useCallback, useRef, useState } from "react";
import { useConfirmacao } from "@/components/shared/ConfirmarAcaoDialog";

export function useGuardaTrocaLista() {
  const [sujo, setSujo] = useState(false);
  // ref: o handler guardado lê o estado MAIS NOVO sem mudar de identidade a cada rascunho (os filtros recebem props estáveis)
  const sujoRef = useRef(false);
  const aoMudarSujo = useCallback((v: boolean) => { sujoRef.current = v; setSujo(v); }, []);
  const { pedir, dialog } = useConfirmacao();

  // Ações que chegaram com o diálogo já aberto (o "Limpar filtros" dispara um `onChange` por filtro, no mesmo instante): entram na
  // MESMA fila e rodam juntas ao confirmar — senão o 2º pedido trocaria o do 1º e só a última limpeza valeria.
  const filaRef = useRef<Array<() => void> | null>(null);
  const proteger = useCallback(
    <A extends unknown[]>(acao: (...args: A) => void) =>
      (...args: A) => {
        if (!sujoRef.current) { acao(...args); return; }
        if (filaRef.current) { filaRef.current.push(() => acao(...args)); return; }
        filaRef.current = [() => acao(...args)];
        pedir({
          titulo: "Descartar alterações?",
          descricao: "Há alterações não salvas na lista de tecidos. Se continuar, elas serão descartadas.",
          confirmar: "Descartar",
          cancelar: "Continuar editando",
          destrutivo: true,
          onConfirmar: () => { const fila = filaRef.current ?? []; filaRef.current = null; fila.forEach((f) => f()); },
          onCancelar: () => { filaRef.current = null; },
        });
      },
    [pedir],
  );

  return { sujo, aoMudarSujo, proteger, dialog };
}
