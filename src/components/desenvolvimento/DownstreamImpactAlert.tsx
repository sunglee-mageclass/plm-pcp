import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { fmtNum } from "@/lib/format";
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

// Impacto por CAMPO editado: o que muda e quais etapas isso atinge.
export type CamposAlterados = { grade?: boolean; consumo?: boolean; aviamentos?: boolean };
const FIELD_IMPACT: { key: keyof CamposAlterados; label: string; stages: (keyof Etapas)[]; motivo: string }[] = [
  { key: "grade", label: "Grade", stages: ["corte", "terceirizados", "oficina", "cq", "acabamento", "direcionamento", "lancamentos"],
    motivo: "a grade total (por variante e geral) muda — as QUANTIDADES de produção e a metragem planejada (consumo×grade) mudam" },
  { key: "consumo", label: "Consumo / tecido", stages: ["corte"],
    motivo: "a metragem planejada do CAD (consumo×grade), a metragem baixada no corte e o custo mudam" },
  { key: "aviamentos", label: "Aviamentos", stages: ["corte"],
    motivo: "a baixa de aviamentos no corte e o custo mudam" },
];
const STAGE_LABEL: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));

// Etapas (já atingidas) afetadas pelos campos alterados — p/ marcar revisão pendente.
export function etapasAfetadasPorMudanca(changes: CamposAlterados | undefined, reachedKeys: Set<string>): string[] {
  const set = new Set<string>();
  FIELD_IMPACT.filter((f) => changes?.[f.key]).forEach((f) =>
    f.stages.forEach((k) => { if (reachedKeys.has(k)) set.add(k as string); }));
  return [...set];
}

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
  changes,
}: {
  modeloId: string;
  from?: "desenvolvimento" | "cad";
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: () => void;
  changes?: CamposAlterados;
}) {
  const { etapas, reached } = useEtapasAfetadas(modeloId, from);
  const reachedKeys = new Set(reached.map((s) => s.key));

  const intro =
    from === "cad"
      ? "Este modelo já foi enviado ao corte ou tem produção. Salvar estas alterações do CAD vai afetar:"
      : "Este modelo já avançou. Salvar estas alterações vai afetar as etapas seguintes (a metragem planejada do CAD não muda sozinha):";

  // Impacto específico do que foi alterado (alerta inteligente).
  const impactos = FIELD_IMPACT
    .filter((f) => changes?.[f.key])
    .map((f) => ({ ...f, atinge: f.stages.filter((k) => reachedKeys.has(k)).map((k) => STAGE_LABEL[k] ?? k) }))
    .filter((f) => f.atinge.length > 0);
  const corteAfetado = !!etapas.corte && impactos.some((f) => f.stages.includes("corte"));

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" /> Salvar vai afetar etapas seguintes
          </AlertDialogTitle>
          <AlertDialogDescription>{intro}</AlertDialogDescription>
        </AlertDialogHeader>

        {impactos.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm space-y-1.5">
            <p className="font-medium">O que você mudou e por quê afeta:</p>
            {impactos.map((f) => (
              <p key={f.key}>
                <b>{f.label}</b> → {f.motivo}. <span className="text-muted-foreground">Afeta: {f.atinge.join(", ")}.</span>
              </p>
            ))}
          </div>
        )}

        {corteAfetado && (etapas.baixa_total ?? 0) > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-sm">
            <b>Corte:</b> já foram baixados <b>{fmtNum(Number(etapas.baixa_total ?? 0))}m</b> de tecido no envio ao corte —
            a baixa <b>não se desfaz sozinha</b>. Re-enviar ao corte regrava a baixa com os novos valores.
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Voltar a editar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Salvar mesmo assim</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
