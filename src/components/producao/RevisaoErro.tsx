import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/StatusBadge";

// Badge #Erro na lista de um setor, quando a etapa está com revisão pendente.
export function RevisaoErroBadge({ revisao, etapa }: { revisao: any; etapa: string }) {
  if (!revisao || !revisao[etapa]) return null;
  return <StatusBadge tone="danger">#Erro</StatusBadge>;
}

// P-245 A (Reforço de segurança S3b): "Marcar verificado" GRAVA — exige EDITAR a página da etapa (o MESMO mapa do servidor,
// marcar_etapa_verificada em 20261101130000; anti-drift em tests/unit/verificar-revisao-somente-leitura.test.ts) e o botão SOME
// para quem só vê. Aba antiga que ainda clicar recebe a recusa do servidor em PT.
export const PAGINAS_POR_ETAPA: Record<string, readonly string[]> = {
  kanban: ["criacao_desenvolvimento", "criacao_planejamento"],
  terceirizados: ["producao_terceirizados"],
  cq: ["producao_cq"],
  direcionamento: ["producao_direcionamento"],
  lancamentos: ["producao_lancamentos"],
  oficina: ["producao_oficina"],
};
/** Etapa fora do mapa: vale qualquer uma das páginas acima (o ELSE do servidor). */
export const PAGINAS_ETAPA_OUTRA: readonly string[] = [...new Set(Object.values(PAGINAS_POR_ETAPA).flat())];
export function paginasDaEtapa(etapa: string): readonly string[] {
  return PAGINAS_POR_ETAPA[etapa] ?? PAGINAS_ETAPA_OUTRA;
}
export function podeVerificarEtapa(etapa: string, canEdit: (pagina: string) => boolean): boolean {
  return paginasDaEtapa(etapa).some((p) => canEdit(p));
}

/** Banner do #Erro. Sem `podeVerificar` (só VÊ a página): o aviso fica, o botão "Marcar verificado" SOME (P-245 A). */
export function VerificarRevisaoBanner({ podeVerificar, onVerificar, verificando }: {
  podeVerificar: boolean; onVerificar: () => void; verificando?: boolean;
}) {
  return (
    <Card className="p-3 border-red-500/50 bg-red-500/5 flex items-start justify-between gap-3">
      <div className="flex items-start gap-2 text-sm">
        <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
        <span>
          <b>#Erro — revisão pendente.</b> Algo foi alterado numa etapa anterior (grade, consumo ou aviamentos).
          {podeVerificar
            ? " Confira os valores/quantidades desta etapa e marque como verificado."
            : " Quem edita esta etapa confere os valores/quantidades e marca como verificado."}
        </span>
      </div>
      {podeVerificar && (
        <Button size="sm" variant="outline" className="shrink-0" disabled={verificando} onClick={onVerificar}>
          <CheckCircle2 className="h-4 w-4 mr-1" /> Marcar verificado
        </Button>
      )}
    </Card>
  );
}

// Banner + botão "Marcar verificado" no detalhe do setor (some o #Erro daquela etapa).
export function VerificarRevisao({ modeloId, etapa, revisao }: { modeloId: string; etapa: string; revisao?: any }) {
  const qc = useQueryClient();
  const { canEdit } = useAuth();
  const podeVerificar = podeVerificarEtapa(etapa, canEdit);
  // Se o pai já tem o revisao_pendente (ex.: cards de Lançamentos), usa-o e evita
  // uma query por item; senão consulta.
  const hasRevisao = revisao !== undefined;
  const { data: pendenteQuery } = useQuery({
    queryKey: ["revisao-pendente", modeloId, etapa],
    enabled: !!modeloId && !hasRevisao,
    queryFn: async () => {
      const { data, error } = await (supabase.from("modelos") as any).select("revisao_pendente").eq("id", modeloId).maybeSingle();
      if (error) throw error;
      return !!(((data as any)?.revisao_pendente)?.[etapa]);
    },
  });
  const pendente = hasRevisao ? !!(revisao as any)?.[etapa] : pendenteQuery;

  const verificar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("marcar_etapa_verificada" as any, { _modelo_id: modeloId, _etapa: etapa });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Etapa verificada");
      qc.invalidateQueries({ queryKey: ["revisao-pendente", modeloId, etapa] });
      ["producao-terc-list", "producao-cq-list", "dir-list", "producao-oficina-list", "producao-acab-list", "lancamentos-cards", "sidebar-badges"]
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao verificar")),
  });

  if (!pendente) return null;
  return <VerificarRevisaoBanner podeVerificar={podeVerificar} verificando={verificar.isPending} onVerificar={() => verificar.mutate()} />;
}
