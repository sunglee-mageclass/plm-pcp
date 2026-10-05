// F3.3 — "Enviar à Explosão" no Sheet do Planejamento. PORTA de ModeloDetailPanel.tsx:2402-2433 (`enviarCad`): salva o
// card (BOM + CAD — Tasks 5/6) e chama `enviar_modelo_para_cad` (com CAD já existente é idempotente: grava Obs. Técnicas/
// Ficha de Medida e `enviado_cad`; o gate de etapa do SERVIDOR usa a posição DERIVADA com a chave ligada — F1
// 20260930140000:842). Pós-envio: a trava da F3.1 (lê `enviado_cad`) fecha as seções do Dev, "Enviar" some, "Editar"
// aparece.
import type { RefObject } from "react";
import { useMutation, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { RecusaEsperadaError } from "@/lib/categoria-card-produto";
import type { Draft } from "@/components/planejamento/modelo-shared";

export function useEnviarExplosao({ modeloId, qc, salvarAntes, draftLiveRef, bloqueioModulo, onEnviado }: {
  modeloId: string | null;
  /** [modularidade F2] texto PT quando a loja não tem Entrada e Saída (a Explosão exige): o `mutationFn` recusa sem chamar a RPC. */
  bloqueioModulo?: string | null;
  qc: QueryClient;
  salvarAntes: () => Promise<void>;
  draftLiveRef: RefObject<Draft>;
  onEnviado: () => void;
}) {
  return useMutation({
    mutationFn: async () => {
      if (bloqueioModulo) throw new RecusaEsperadaError(bloqueioModulo);
      if (!modeloId) throw new Error("Salve o modelo primeiro.");
      // Salva o card antes de enviar (consumos/variantes/CAD corretos) — Dev :2404-2405.
      await salvarAntes();
      const d = draftLiveRef.current;
      const { error } = await supabase.rpc("enviar_modelo_para_cad" as any, {
        _modelo_id: modeloId,
        _observacoes_tecnicas: d.observacoes_tecnicas || null,
        _ficha_medida_url: d.ficha_medida_url || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Enviado para a Explosão");
      // Trava na hora, sem esperar o refetch: `enviado_cad` no cache com o MESMO rev (o merge do colab ignora rev igual);
      // o refetch abaixo/Realtime traz a linha real (rev novo) e o merge segue normal.
      qc.setQueryData(["modelo", modeloId], (old: any) => (old ? { ...old, enviado_cad: true } : old));
      for (const k of ["modelo", "modelo-detail", "modelo-condicoes-kanban", "modelo-cad-calc", "explosao-cad-row", "plan-kanban-cond", "plan-ficha-condicoes", "plan-ficha-cad", "plan-cq"]) {
        qc.invalidateQueries({ queryKey: [k, modeloId] });
      }
      qc.invalidateQueries({ predicate: (q) => typeof q.queryKey?.[0] === "string" && (q.queryKey[0] as string).startsWith("ft-") });
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && (q.queryKey[0] === "explosao-cad-tecidos" || q.queryKey[0] === "explosao-cad-grades") });
      for (const k of ["producao-explosao-list", "modelos-desenvolvimento", "modelos-planejamento"]) qc.invalidateQueries({ queryKey: [k] });
      // [urg R4b] o Enviar à Explosão cria os blocos de PCP › Serviços a partir da M.O.: listas/cards de Serviços e Etapas PL recarregam.
      for (const k of ["producao-terc-list", "etapas-cards"]) qc.invalidateQueries({ queryKey: [k] });
      qc.invalidateQueries({ queryKey: ["producao-terc"] });
      onEnviado();
    },
    onError: (e: any) => {
      if (e?.salvarFalhou) {
        // O Salvar já avisou (toast próprio) ou, no P0409, está refazendo sozinho: o envio só aborta.
        if (e?.code === "P0409") toast.info("Outra pessoa salvou este card agora — confira e clique em Enviar à Explosão de novo.");
        return;
      }
      toast.error(mensagemErro(e, "Erro ao enviar"));
    },
  });
}
