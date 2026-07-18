import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Undo2, ExternalLink, CheckCircle2, ArrowLeft, Check } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { fmtNum } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
  { key: "cad", label: "Explosão", desc: "Metragem planejada, consumos e custo previsto.", href: () => "/criacao/explosao" },
  { key: "corte", label: "Corte", desc: (e) => `Já enviado ao corte — ${fmtNum(Number(e.baixa_total ?? 0))}m baixados; a baixa não se desfaz sozinha.` },
  { key: "terceirizados", label: "Serviços", desc: "Quantidades e custos dos serviços.", href: (id) => `/producao/terceirizados/${id}` },
  { key: "oficina", label: "Oficina", desc: "Quantidades e custos da oficina.", href: (id) => `/producao/oficina/${id}` },
  { key: "cq", label: "CQ", desc: "Grade e peças conferidas.", href: (id) => `/producao/cq/${id}` },
  { key: "direcionamento", label: "Direcionamento", desc: "Direcionamento das peças.", href: (id) => `/producao/direcionamento/${id}` },
  { key: "lancamentos", label: "Lançamentos", desc: "Lançamentos de produção.", href: () => `/producao/lancamentos` },
];

// Impacto por CAMPO editado: o que muda e quais etapas isso atinge.
export type CamposAlterados = { grade?: boolean; consumo?: boolean; aviamentos?: boolean };
const FIELD_IMPACT: { key: keyof CamposAlterados; label: string; stages: (keyof Etapas)[]; motivo: string }[] = [
  { key: "grade", label: "Grade", stages: ["corte", "terceirizados", "oficina", "cq", "direcionamento", "lancamentos"],
    motivo: "a grade total (por variante e geral) muda — as QUANTIDADES de produção e a metragem planejada (consumo×grade) mudam" },
  { key: "consumo", label: "Consumo / tecido", stages: ["corte"],
    motivo: "a metragem planejada do CAD (consumo×grade), a metragem baixada no corte e o custo mudam" },
  { key: "aviamentos", label: "Aviamentos", stages: ["corte"],
    motivo: "a baixa de aviamentos no corte e o custo mudam" },
];
const STAGE_LABEL: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));

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
  onDesmarcar,
  changes,
}: {
  modeloId: string;
  from?: "desenvolvimento" | "cad";
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: () => void;
  onDesmarcar?: () => void;
  changes?: CamposAlterados;
}) {
  const { etapas, reached } = useEtapasAfetadas(modeloId, from);
  const reachedKeys = new Set(reached.map((s) => s.key));

  const intro =
    from === "cad"
      ? "Este modelo já foi enviado ao corte ou tem produção. Salvar estas alterações do CAD vai afetar:"
      : "Este modelo já avançou. As etapas seguintes NÃO atualizam sozinhas — para a mudança valer, é preciso DESMARCAR/refazer as posições posteriores (da última para a primeira) antes. Salvar agora afeta:";

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
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm max-md:text-xs space-y-1.5">
            <p className="font-medium">O que você mudou e por quê afeta:</p>
            {impactos.map((f) => (
              <p key={f.key}>
                <b>{f.label}</b> → {f.motivo}. <span className="text-muted-foreground">Afeta: {f.atinge.join(", ")}.</span>
              </p>
            ))}
          </div>
        )}

        {corteAfetado && (etapas.baixa_total ?? 0) > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-sm max-md:text-xs">
            <b>Corte:</b> já foram baixados <b>{fmtNum(Number(etapas.baixa_total ?? 0))}m</b> de tecido no envio ao corte —
            a baixa <b>não se desfaz sozinha</b>. Re-enviar ao corte regrava a baixa com os novos valores.
          </div>
        )}

        {onDesmarcar && from === "desenvolvimento" ? (
          // 3 botões numa linha: Voltar (ícone) · Desmarcar etapas (centro) · Salvar (ícone).
          <AlertDialogFooter className="flex-row items-center gap-2">
            <AlertDialogCancel className="mt-0 px-3 shrink-0" aria-label="Voltar a editar" title="Voltar a editar">
              <ArrowLeft className="h-4 w-4" />
            </AlertDialogCancel>
            <Button variant="secondary" className="flex-1 min-w-0" onClick={onDesmarcar}>
              <Undo2 className="h-4 w-4 mr-1 shrink-0" /> <span className="truncate">Desmarcar etapas</span>
            </Button>
            <AlertDialogAction onClick={onConfirm} className="px-3 shrink-0" aria-label="Salvar mesmo assim" title="Salvar mesmo assim">
              <Check className="h-4 w-4" />
            </AlertDialogAction>
          </AlertDialogFooter>
        ) : (
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar a editar</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>Salvar mesmo assim</AlertDialogAction>
          </AlertDialogFooter>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Ordem REVERSA do fluxo (desmarca-se da última etapa para a primeira).
type UnmarkStage = {
  key: keyof Etapas;
  label: string;
  effect: (e: Etapas) => string;
  perm: string;
  action?: "lancamentos" | "direcionamento" | "cq" | "corte";
  href?: (id: string) => string;
  destructive?: boolean;
};
const UNMARK_STAGES: UnmarkStage[] = [
  { key: "lancamentos", label: "Lançamentos", effect: () => "lançado → não lançado", perm: "producao_lancamentos", action: "lancamentos" },
  { key: "direcionamento", label: "Direcionamento", effect: () => "separado → pendente", perm: "producao_direcionamento", action: "direcionamento" },
  { key: "cq", label: "CQ", effect: () => "estorna a grade conferida (Pré e Pós)", perm: "producao_cq", action: "cq", destructive: true },
  { key: "oficina", label: "Oficina", effect: () => "revise as quantidades na tela", perm: "producao_oficina", href: (id) => `/producao/oficina/${id}` },
  { key: "terceirizados", label: "Serviços", effect: () => "revise as quantidades na tela", perm: "producao_terceirizados", href: (id) => `/producao/terceirizados/${id}` },
  { key: "corte", label: "Corte", effect: (e) => `estorna a baixa de ${fmtNum(Number(e.baixa_total ?? 0))} m de tecido`, perm: "producao_cad", action: "corte", destructive: true },
];

/**
 * Mini-janela para DESMARCAR as etapas posteriores atingidas, da última para a
 * primeira, sem sair do Desenvolvimento. Reaproveita as MESMAS ações das telas de
 * cada etapa (RPCs/updates com suas guardas). "Salvar agora" some assim que não há
 * mais etapa desmarcável pendente.
 */
export function DesmarcarEtapasDialog({
  modeloId,
  open,
  onOpenChange,
  onSave,
}: {
  modeloId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: () => void;
}) {
  const qc = useQueryClient();
  const { canEdit } = useAuth();
  const { etapas } = useEtapasAfetadas(modeloId);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  const { data: cadId } = useQuery({
    queryKey: ["cad-id-por-modelo", modeloId],
    enabled: open && !!modeloId,
    queryFn: async () => {
      const { data } = await supabase.from("cad").select("id").eq("modelo_id", modeloId).maybeSingle();
      return ((data as any)?.id ?? null) as string | null;
    },
  });

  const unmark = useMutation({
    mutationFn: async (action: NonNullable<UnmarkStage["action"]>) => {
      if (action === "lancamentos") {
        const { error } = await supabase.from("modelos").update({ lancado: false } as any).eq("id", modeloId);
        if (error) throw error;
      } else if (!cadId) {
        throw new Error("CAD deste modelo não encontrado.");
      } else if (action === "direcionamento") {
        const { error } = await supabase.from("cad").update({ direcionamento_status: "pendente", direcionamento_confirmado_at: null } as any).eq("id", cadId);
        if (error) throw error;
      } else if (action === "cq") {
        const { error } = await supabase.rpc("desmarcar_cq" as any, { _cad_id: cadId }); // rebaixa o Pós junto
        if (error) throw error;
      } else if (action === "corte") {
        const { error } = await supabase.rpc("reverter_corte_tecido" as any, { _cad_id: cadId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Etapa desmarcada.");
      ["etapas-afetadas", "cad-grades", "parcelas", "estoque-tecidos", "estoque-aviamentos", "estoque-insumos", "sidebar-badges", "cad-etiquetas-rows"]
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Não foi possível desmarcar")),
  });

  const reached = UNMARK_STAGES.filter((s) => etapas[s.key]);
  const firstDesmarcavel = reached.find((s) => s.action)?.key; // só a etapa mais recente fica ativa
  const podeSalvar = !reached.some((s) => s.action); // nenhum "lock" pendente

  const doAction = (s: UnmarkStage) => {
    if (!s.action) return;
    if (s.destructive) setConfirmKey(s.key);
    else unmark.mutate(s.action);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-4 w-4" /> Desmarcar etapas posteriores
          </DialogTitle>
        </DialogHeader>

        {reached.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" /> Nenhuma etapa posterior pendente — pode salvar a edição.
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Desmarque da última para a primeira. Cada botão reaproveita a reversão da própria etapa (com suas guardas).
            </p>
            <div className="space-y-2">
              {reached.map((s) => {
                const blocked = !!s.action && s.key !== firstDesmarcavel;
                const semPerm = !!s.action && !canEdit(s.perm);
                return (
                  <div key={s.key} className="flex items-center gap-3 rounded-md border p-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{s.label}</p>
                      <p className="text-xs text-muted-foreground">{s.effect(etapas)}</p>
                    </div>
                    {s.href ? (
                      <a href={s.href(modeloId)} target="_blank" rel="noreferrer" className="shrink-0">
                        <Button size="sm" variant="outline"><ExternalLink className="h-3.5 w-3.5 mr-1" /> Abrir</Button>
                      </a>
                    ) : semPerm ? (
                      <span className="text-xs text-muted-foreground shrink-0">sem permissão</span>
                    ) : blocked ? (
                      <span className="text-xs text-muted-foreground shrink-0">desmarque a de cima</span>
                    ) : (
                      <Button size="sm" variant={s.destructive ? "destructive" : "secondary"} className="shrink-0"
                        disabled={unmark.isPending} onClick={() => doAction(s)}>Desmarcar</Button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          {podeSalvar && <Button onClick={onSave}>Salvar agora</Button>}
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={!!confirmKey} onOpenChange={(o) => !o && setConfirmKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desmarcar {UNMARK_STAGES.find((s) => s.key === confirmKey)?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => { const s = UNMARK_STAGES.find((x) => x.key === confirmKey); return s ? `${s.effect(etapas)}. Usa a mesma reversão da tela da etapa.` : ""; })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const s = UNMARK_STAGES.find((x) => x.key === confirmKey); if (s?.action) unmark.mutate(s.action); setConfirmKey(null); }}>Desmarcar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
