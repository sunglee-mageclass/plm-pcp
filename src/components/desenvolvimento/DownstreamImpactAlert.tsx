import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { fmtNum } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Etapas = {
  cad?: boolean;
  corte?: boolean;
  baixa_total?: number;
  terceirizados?: boolean;
  oficina?: boolean;
  cq?: boolean;
  acabamento?: boolean;
  direcionamento?: boolean;
  lancamentos?: boolean;
};

type StageDef = {
  key: keyof Etapas;
  label: string;
  desc: string | ((e: Etapas) => string);
  href?: (id: string) => string;
};

const STAGES: StageDef[] = [
  { key: "cad", label: "CAD", desc: "Metragem planejada, consumos e custo previsto.", href: (id) => `/producao/cad/${id}` },
  { key: "corte", label: "Corte", desc: (e) => `Já enviado ao corte — ${fmtNum(Number(e.baixa_total ?? 0))}m baixados; a baixa não se desfaz sozinha.` },
  { key: "terceirizados", label: "Serviços", desc: "Quantidades e custos dos serviços.", href: (id) => `/producao/terceirizados/${id}` },
  { key: "oficina", label: "Oficina", desc: "Quantidades e custos da oficina.", href: (id) => `/producao/oficina/${id}` },
  { key: "cq", label: "CQ", desc: "Grade e peças conferidas.", href: (id) => `/producao/cq/${id}` },
  { key: "acabamento", label: "Acabamento", desc: "Quantidades no acabamento.", href: (id) => `/producao/acabamento/${id}` },
  { key: "direcionamento", label: "Direcionamento", desc: "Direcionamento das peças.", href: (id) => `/producao/direcionamento/${id}` },
  { key: "lancamentos", label: "Lançamentos", desc: "Lançamentos de produção.", href: () => `/producao/lancamentos` },
];

/** Quais etapas seguintes o modelo já atingiu (a partir do ponto de edição). */
export function useEtapasAfetadas(modeloId: string, from: "desenvolvimento" | "cad" = "desenvolvimento") {
  const { data } = useQuery({
    queryKey: ["etapas-afetadas", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("modelo_etapas_afetadas" as any, { _modelo_id: modeloId });
      if (error) throw error;
      return (data ?? {}) as Etapas;
    },
  });
  const etapas = (data ?? {}) as Etapas;
  const startIdx = from === "cad" ? 1 : 0;
  const reached = etapas.cad ? STAGES.slice(startIdx).filter((s) => etapas[s.key]) : [];
  return { etapas, reached, hasDownstream: reached.length > 0 };
}

/**
 * Confirmação ao SALVAR um modelo que já avançou. Lista cada etapa seguinte
 * afetada (o que usa do upstream + botão para abrir em nova aba). "Salvar mesmo
 * assim" = salva (onConfirm); "Voltar a editar" = não salva, segue na edição.
 */
export function DownstreamConfirmDialog({
  modeloId,
  from = "desenvolvimento",
  open,
  onOpenChange,
  onConfirm,
}: {
  modeloId: string;
  from?: "desenvolvimento" | "cad";
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: () => void;
}) {
  const { etapas, reached } = useEtapasAfetadas(modeloId, from);

  const intro =
    from === "cad"
      ? "Este modelo já foi enviado ao corte ou tem produção. Salvar estas alterações do CAD vai afetar:"
      : "Este modelo já avançou. Salvar estas alterações vai afetar as etapas seguintes (a metragem planejada do CAD não muda sozinha):";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" /> Salvar vai afetar etapas seguintes
          </AlertDialogTitle>
          <AlertDialogDescription>{intro}</AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="space-y-1.5 text-sm">
          {reached.map((s) => (
            <li key={s.key} className="flex items-start justify-between gap-3">
              <span>
                <b>{s.label}</b> — <span className="text-muted-foreground">{typeof s.desc === "function" ? s.desc(etapas) : s.desc}</span>
              </span>
              {s.href && (
                <Button asChild size="sm" variant="outline" className="h-7 shrink-0">
                  <a href={s.href(modeloId)} target="_blank" rel="noreferrer">
                    Abrir <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
              )}
            </li>
          ))}
        </ul>

        <AlertDialogFooter>
          <AlertDialogCancel>Voltar a editar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Salvar mesmo assim</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
