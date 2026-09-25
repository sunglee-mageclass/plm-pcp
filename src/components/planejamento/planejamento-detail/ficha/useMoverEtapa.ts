/**
 * F3.1 — "Mover para…" do selo da etapa (a etapa fica FORA do Salvar — decisão 13).
 *  • Chave LIGADA: RPC `kanban_mover` (F1) decide pela tabela única; toast pela RESPOSTA (`toastDoMover`, F2).
 *  • Chave DESLIGADA: comportamento de HOJE = board (criacao.desenvolvimento.tsx:322-332, :547-557): gate
 *    `podeEntrarHoje` (cascata) → UPDATE só de `status_desenvolvimento` + `marcar_etapa_verificada('kanban')`
 *    (limpa o #Erro de regressão).
 *  Nenhum dos dois toca `motivo_cancelamento` (dono, 23/set). O status novo entra no cache do card na hora e
 *  o refetch (rev novo) é absorvido pelo merge do colab sem mexer no rascunho (a etapa não está no Draft).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { boardDaLoja, type KanbanAutoConfig } from "@/lib/kanban-auto";
import { labelDaColuna, toastDoMover, type ResultadoMover } from "@/lib/kanban-auto-ui";
import { kanbanMover } from "@/lib/kanban-auto-rpc";
import { mensagemBloqueioHoje, podeEntrarHoje } from "./etapa-kanban";

export type MoverEtapaVars = {
  para: string;
  origem: string | null;
  statusAntes: string | null;
  fixadoAntes: boolean;
  cfg: KanbanAutoConfig;
  cond: Record<string, boolean>;
};
type ResultadoEtapa =
  | { tipo: "auto"; r: ResultadoMover }
  | { tipo: "bloqueado"; faltando: { label: string }[] }
  | { tipo: "hoje"; status: string };

export function useMoverEtapa(modeloId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: MoverEtapaVars): Promise<ResultadoEtapa> => {
      if (!modeloId) throw new Error("Salve o modelo primeiro.");
      if (v.cfg.kanban_automatico) return { tipo: "auto", r: await kanbanMover(modeloId, v.para) };
      const chk = podeEntrarHoje({ origem: v.origem, para: v.para, cfg: v.cfg, cond: v.cond });
      if (!chk.ok) return { tipo: "bloqueado", faltando: chk.faltando };
      const { error } = await supabase.from("modelos").update({ status_desenvolvimento: v.para }).eq("id", modeloId);
      if (error) throw error;
      await supabase.rpc("marcar_etapa_verificada", { _modelo_id: modeloId, _etapa: "kanban" });
      return { tipo: "hoje", status: v.para };
    },
    onSuccess: (res, v) => {
      const board = boardDaLoja(v.cfg);
      if (res.tipo === "bloqueado") {
        toast.error(mensagemBloqueioHoje(res.faltando));
        return;
      }
      let novo: string | null;
      if (res.tipo === "auto") {
        novo = res.r.status;
        const t = toastDoMover(res.r, v.para, board, v.statusAntes, v.fixadoAntes);
        if (t?.tipo === "error") toast.error(t.texto);
        else if (t?.tipo === "success") toast.success(t.texto);
        else if (t) toast.info(t.texto);
      } else {
        novo = res.status;
        toast.success(`Card movido para "${labelDaColuna(novo, board)}".`);
      }
      qc.setQueryData(["modelo", modeloId], (old: any) => (old ? { ...old, status_desenvolvimento: novo } : old));
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao mover o card")),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["modelo", modeloId] });
      qc.invalidateQueries({ queryKey: ["plan-kanban-cond", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
      qc.invalidateQueries({ queryKey: ["desenv-condicoes"] });
    },
  });
}
