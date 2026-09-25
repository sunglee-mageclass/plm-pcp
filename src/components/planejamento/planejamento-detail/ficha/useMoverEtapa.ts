/**
 * F3.1 — "Mover para…" do selo da etapa (a etapa fica FORA do Salvar — decisão 13).
 *  • Chave LIGADA: RPC `kanban_mover` (F1) decide pela tabela única; toast pela RESPOSTA (`toastDoMover`, F2).
 *  • Chave DESLIGADA: comportamento de HOJE = board (`opcoesMoverHoje`/`podeEntrarHoje` em `etapa-kanban.ts`,
 *    espelho de `criacao.desenvolvimento.tsx`): gate `podeEntrarHoje` (cascata) → UPDATE só de
 *    `status_desenvolvimento` + `marcar_etapa_verificada('kanban')` (limpa o #Erro de regressão).
 *  Nenhum dos dois toca `motivo_cancelamento` (dono, 23/set). O status novo entra no cache do card na hora e
 *  o refetch (rev novo) é absorvido pelo merge do colab sem mexer no rascunho (a etapa não está no Draft).
 *  Fix round 1:
 *  • M2 — no P0001 "Kanban automático desligado" (a config que a ficha leu ficou desatualizada — outra
 *    aba/admin desligou depois), invalida `["tenant-plan-ficha-config", tenantId]` (a query do
 *    `useFichaKanban`), igual ao board (`criacao.desenvolvimento.tsx`, `["tenant-kanban-auto"]`).
 *  • M3 — chave desligada: o UPDATE devolve o `status_desenvolvimento` GRAVADO (`.select().single()`); toast
 *    e cache usam ESSE valor, não `v.para` (um guard de servidor pode redirecionar o destino).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { boardDaLoja, type KanbanAutoConfig } from "@/lib/kanban-auto";
import { labelDaColuna, toastDoMover, type ResultadoMover } from "@/lib/kanban-auto-ui";
import { kanbanMover } from "@/lib/kanban-auto-rpc";
import { mensagemBloqueioHoje } from "./etapa-kanban";
import { planoMoverEtapa } from "./etapa-mover";

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

export function useMoverEtapa(modeloId: string | null, tenantId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: MoverEtapaVars): Promise<ResultadoEtapa> => {
      if (!modeloId) throw new Error("Salve o modelo primeiro.");
      const plano = planoMoverEtapa({ modeloId, para: v.para, origem: v.origem, cfg: v.cfg, cond: v.cond });
      if (plano.tipo === "rpc") return { tipo: "auto", r: await kanbanMover(plano.modeloId, plano.para) };
      if (plano.tipo === "bloqueado") return { tipo: "bloqueado", faltando: plano.faltando };
      // M3: devolve o status GRAVADO — se um guard do servidor redirecionou, o toast/cache
      // refletem o destino REAL, não o `v.para` pedido. Payload = SÓ `status_desenvolvimento`
      // (`plano.payload`, M5b) — nunca toca `motivo_cancelamento`.
      const { data, error } = await supabase
        .from("modelos")
        .update(plano.payload)
        .eq("id", plano.modeloId)
        .select("status_desenvolvimento")
        .single();
      if (error) throw error;
      await supabase.rpc("marcar_etapa_verificada", { _modelo_id: modeloId, _etapa: "kanban" });
      return { tipo: "hoje", status: (data?.status_desenvolvimento as string | null) ?? v.para };
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
        // M3: o servidor pode ter devolvido uma coluna DIFERENTE da pedida (guard redirecionou)
        // — toast neutro nomeando o destino real, em vez de afirmar que foi pra onde o usuário pediu.
        if (novo && novo !== v.para) toast.info(`O card ficou em "${labelDaColuna(novo, board)}".`);
        else toast.success(`Card movido para "${labelDaColuna(novo, board)}".`);
      }
      qc.setQueryData(["modelo", modeloId], (old: any) => (old ? { ...old, status_desenvolvimento: novo } : old));
    },
    onError: (e: any) => {
      // M2: espelha o board — se o servidor recusou por "Kanban automático desligado" (a config
      // que a ficha leu ficou desatualizada), invalida a key da config pra reler antes da próxima tentativa.
      if (e?.code === "P0001" && String(e?.message ?? "").includes("Kanban automático está desligado") && tenantId) {
        qc.invalidateQueries({ queryKey: ["tenant-plan-ficha-config", tenantId] });
      }
      toast.error(mensagemErro(e, "Erro ao mover o card"));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["modelo", modeloId] });
      qc.invalidateQueries({ queryKey: ["plan-kanban-cond", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
      qc.invalidateQueries({ queryKey: ["desenv-condicoes"] });
    },
  });
}
