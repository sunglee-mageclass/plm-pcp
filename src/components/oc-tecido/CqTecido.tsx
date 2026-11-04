import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { ReadOnlyScope } from "@/components/RequirePermission";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { varianteLabel } from "@/lib/variante";
import { AlertTriangle, Check, Ban, ChevronRight, RotateCcw, Repeat, ArrowLeft } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/shared/DateField";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// 'devolucao' existe no enum do banco mas nunca é escrito (estado morto) — fora da UI.
export type CqStatus = "sem_alerta" | "alertado" | "troca_pendente" | "trocado" | "estilo_ok" | "cancelado";

type CqItem = {
  id: string;
  oc_id: string | null;
  oc_numero: string | null;
  artigo: string;
  variante: string;
  cq_observacao: string | null;
  cq_ok: boolean;
  cq_alerta_status: CqStatus;
  is_rolo?: boolean; // alerta vindo de um rolo: oc_numero = rolo_codigo
  usado?: boolean;   // rolo já consumido (corte) OU selecionado em Desenvolvimento → não troca/cancela
};

const PENDENTES: CqStatus[] = ["alertado", "troca_pendente"];
const RESOLVIDOS: CqStatus[] = ["estilo_ok", "trocado", "cancelado"];

// Taxonomia ÚNICA de tom §Q9 p/ status de alerta de tecido (campanha StatusBadge, ago/2026).
// alertado=warning (flag leve, sob revisão) · troca_pendente=danger (defeito confirmado,
// bloqueia até repor) · trocado=info (resolvido via troca, neutro-informativo) ·
// estilo_ok=success (resolvido, sem problema) · cancelado=neutral (encerrado sem ação).
// Centralizado aqui e consumido por TODO lugar que pinta esse status (Alertas de Tecido,
// resumo por OC — `alertaBadge` — e a grade de rolos em OcTecidoCalculos) — nenhum outro
// arquivo deve reimplementar essa cor.
export const CQ_ALERTA_TONE: Record<Exclude<CqStatus, "sem_alerta">, StatusTone> = {
  alertado: "warning",
  troca_pendente: "danger",
  trocado: "info",
  estilo_ok: "success",
  cancelado: "neutral",
};

const STATUS_BADGE: Record<CqStatus, { label: string; tone: StatusTone } | null> = {
  sem_alerta: null,
  alertado: { label: "Alerta estilo", tone: CQ_ALERTA_TONE.alertado },
  troca_pendente: { label: "Troca pendente", tone: CQ_ALERTA_TONE.troca_pendente },
  trocado: { label: "Trocado", tone: CQ_ALERTA_TONE.trocado },
  estilo_ok: { label: "Estilo OK", tone: CQ_ALERTA_TONE.estilo_ok },
  cancelado: { label: "Cancelado", tone: CQ_ALERTA_TONE.cancelado },
};

const SELECT_COLS =
  "id, cancelado, variante_tecido_id, cq_observacao, cq_ok, cq_alerta_status, artigos(nome), variantes_tecido(nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome))";
// Para rolos, também trazemos consumo (baixa) e vínculo de Dev p/ saber se está "em uso".
const ROLO_SELECT_COLS = `${SELECT_COLS}, estoque_tecido_baixas(id), modelo_tecido_oc_links(id)`;

// Badge-resumo do alerta de uma OC (prioridade: pendente > troca > trocado > cancelado > ok).
export function alertaBadge(statuses: string[]): { label: string; tone: StatusTone } | null {
  if (statuses.includes("alertado")) return { label: "Alerta", tone: CQ_ALERTA_TONE.alertado };
  if (statuses.includes("troca_pendente")) return { label: "Troca", tone: CQ_ALERTA_TONE.troca_pendente };
  if (statuses.includes("trocado")) return { label: "Trocado", tone: CQ_ALERTA_TONE.trocado };
  if (statuses.includes("cancelado")) return { label: "Cancelado", tone: CQ_ALERTA_TONE.cancelado };
  if (statuses.includes("estilo_ok")) return { label: "Estilo OK", tone: CQ_ALERTA_TONE.estilo_ok };
  return null;
}

const vName = (
  v?: {
    nome_variante: string | null;
    codigo_variante: string | null;
    cor?: { nome: string | null } | null;
    apelido?: { nome: string | null } | null;
  } | null,
) => {
  if (!v) return "—";
  const base = varianteLabel({ nome: v.nome_variante, cor: v.cor?.nome, apelido: v.apelido?.nome });
  return base !== "—" ? base : v.codigo_variante || "—";
};

const toCqItem = (it: any, ocId: string | null, ocNumero: string | null, isRolo = false): CqItem => ({
  id: it.id,
  oc_id: ocId,
  oc_numero: ocNumero,
  artigo: it.artigos?.nome ?? "—",
  variante: vName(it.variantes_tecido),
  cq_observacao: it.cq_observacao,
  cq_ok: !!it.cq_ok,
  cq_alerta_status: (it.cq_alerta_status ?? "sem_alerta") as CqStatus,
  is_rolo: isRolo,
});

function useFlatCqItems() {
  const { data, isLoading } = useQuery({
    queryKey: ["cq-tecido"],
    queryFn: async () => {
      const [ocsRes, rolosRes] = await Promise.all([
        supabase
          .from("ocs_tecido")
          .select(`id, numero_pedido, ocs_tecido_itens!oc_tecido_id(${SELECT_COLS})`)
          .eq("status", "recebido")
          .eq("is_rolo" as never, false as never)
          .order("created_at", { ascending: false }),
        // Rolos: o item do rolo carrega o CQ do rolo (oc_numero = rolo_codigo).
        supabase
          .from("ocs_tecido")
          .select(`id, rolo_codigo, ocs_tecido_itens!oc_tecido_id(${ROLO_SELECT_COLS})`)
          .eq("is_rolo" as never, true as never)
          .order("created_at", { ascending: false }),
      ]);
      if (ocsRes.error) throw ocsRes.error;
      if (rolosRes.error) throw rolosRes.error;
      return { ocs: (ocsRes.data ?? []) as any[], rolos: (rolosRes.data ?? []) as any[] };
    },
  });
  const items = useMemo<CqItem[]>(() => {
    const out: CqItem[] = [];
    for (const oc of data?.ocs ?? []) {
      for (const it of oc.ocs_tecido_itens ?? []) {
        if (it.cancelado && it.cq_alerta_status === "sem_alerta") continue; // cancelado de pedido (não-CQ)
        out.push(toCqItem(it, oc.id, oc.numero_pedido, false));
      }
    }
    for (const r of data?.rolos ?? []) {
      for (const it of r.ocs_tecido_itens ?? []) {
        if (it.cancelado && it.cq_alerta_status === "sem_alerta") continue;
        const usado =
          (it.estoque_tecido_baixas ?? []).length > 0 ||
          (it.modelo_tecido_oc_links ?? []).length > 0;
        out.push({ ...toCqItem(it, r.id, r.rolo_codigo, true), usado });
      }
    }
    return out;
  }, [data]);
  return { items, isLoading };
}

// Grava na hora (update direto em ocs_tecido_itens). Desde o "CQ no Salvar da OC" NÃO é mais usado pela seção de CQ da OC
// (OcCqSection = edição solta, entra no Salvar da OC); resta só na observação dos Alertas de Tecido (`ObsField`).
function useCqUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, any> }) => {
      const { error } = await supabase.from("ocs_tecido_itens").update(patch as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      ["cq-tecido", "cq-oc", "alertas-tecido", "estoque-tecidos", "dash-estoque", "consumo-por-oc", "ocs_tecido", "sidebar-badges"]
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar CQ")),
  });
}

// Resolução de alerta via RPC (recalcula valor + parcelas).
function useResolucao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      item_id: string; acao: "cancelar" | "estilo_ok" | "reabrir" | "troca";
      rep_artigo_id?: string; rep_variante_id?: string; rep_metragem?: number;
    }) => {
      const { error } = await supabase.rpc("aplicar_resolucao_alerta_tecido" as any, {
        _item_id: args.item_id, _acao: args.acao,
        _rep_artigo_id: args.rep_artigo_id ?? null,
        _rep_variante_id: args.rep_variante_id ?? null,
        _rep_metragem: args.rep_metragem ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      ["cq-tecido", "cq-oc", "alertas-tecido", "estoque-tecidos", "dash-estoque",
        "consumo-por-oc", "ocs_tecido", "parcelas", "dash-financeiro", "sidebar-badges"]
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao aplicar resolução")),
  });
}

// Receber a reposição de uma troca (marca recebido + data, vira 'trocado').
function useReceberReposicao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { item_id: string; data: string; metragem: number }) => {
      const { error } = await supabase.rpc("receber_reposicao_troca" as any, {
        _original_item_id: args.item_id, _data: args.data, _metragem: args.metragem,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      ["cq-tecido", "cq-oc", "alertas-tecido", "estoque-tecidos", "dash-estoque",
        "consumo-por-oc", "ocs_tecido", "parcelas", "dash-financeiro", "sidebar-badges"]
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao receber reposição")),
  });
}

// ───────────────────────── CQ de Tecido (dentro da OC) ─────────────────────────
// "CQ no Salvar da OC" (nov/2026, modo OC): a seção NÃO grava na hora. Cada edição (CQ ok, Alertar estilo, observação) vira um
// rascunho no ITEM da OC (cq_ok / cq_alerta_status / cq_observacao + cq_tocado) e só vai ao banco pelo Salvar da OC (RPC
// salvar_oc_tecido: chave cq_* presente = grava; ausente = mantém). A RESOLUÇÃO do alerta (Estilo OK / troca / cancelar) NÃO é
// rascunho: segue nos Alertas de Tecido, por RPC própria.

/** Campos de CQ que o ItemDraft da OC carrega (todos opcionais: linha nova / carga antiga não os tem). */
export type CqCampos = {
  cq_ok?: boolean;
  cq_alerta_status?: string;
  cq_observacao?: string;
  /** true = EU editei o CQ deste item nesta sessão (só então as chaves cq_* entram no payload do Salvar). */
  cq_tocado?: boolean;
};
export type CqPatch = { cq_ok?: boolean; cq_alerta?: boolean; cq_observacao?: string };

// O toggle "Alertar estilo" só alterna alertado <-> sem_alerta (é o que o servidor grava para cq_alerta true/false). Qualquer outro
// estado (troca_pendente, estilo_ok, trocado, cancelado) vem de uma resolução nos Alertas: o toggle não o rebaixa.
const ALERTA_ALTERNAVEL: string[] = ["sem_alerta", "alertado"];
export function alertaAlternavel(status: string | null | undefined): boolean {
  return ALERTA_ALTERNAVEL.includes(status ?? "sem_alerta");
}

/** Aplica uma edição de CQ no item e recalcula `cq_tocado`: igual ao que foi carregado (`base`) = não tocado (some o selo e o dirty). */
export function aplicarPatchCq<T extends CqCampos>(item: T, patch: CqPatch, base?: CqCampos | null): T {
  const next: T = { ...item };
  if (patch.cq_ok !== undefined) next.cq_ok = patch.cq_ok;
  if (patch.cq_alerta !== undefined && alertaAlternavel(item.cq_alerta_status)) {
    next.cq_alerta_status = patch.cq_alerta ? "alertado" : "sem_alerta";
  }
  if (patch.cq_observacao !== undefined) next.cq_observacao = patch.cq_observacao;
  const igualBase =
    !!base &&
    !!next.cq_ok === !!base.cq_ok &&
    (next.cq_alerta_status ?? "sem_alerta") === (base.cq_alerta_status ?? "sem_alerta") &&
    (next.cq_observacao ?? "") === (base.cq_observacao ?? "");
  if (igualBase) delete next.cq_tocado;
  else next.cq_tocado = true;
  return next;
}

/** Chaves cq_* do item para o `_itens` do salvar_oc_tecido: SÓ quando tocado (chave ausente = o banco mantém o valor atual). */
export function chavesCqDoPayload(item: CqCampos): Record<string, unknown> {
  if (!item.cq_tocado) return {};
  return {
    cq_ok: !!item.cq_ok,
    // item em estado de resolução (troca_pendente/estilo_ok/trocado/cancelado) NUNCA manda cq_alerta: o servidor o rebaixaria a sem_alerta
    ...(alertaAlternavel(item.cq_alerta_status) ? { cq_alerta: (item.cq_alerta_status ?? "sem_alerta") === "alertado" } : {}),
    cq_observacao: item.cq_observacao ?? "",
  };
}

// ---- CQ por ROLO existente (modo rolo): mesmo espírito do item (rascunho + tocado + chave-ausente-mantém), mas o CQ mora no item do ROLO
// (`roloItemId`) e vai ao banco no `_cq_rolos` do salvar_oc_tecido. Rolo NOVO (sem roloItemId) NÃO passa por aqui (vai por gerar_rolos_recebimento).
/** O que o rascunho de um rolo carrega (subconjunto do `RoloEntry`). */
export type CqRoloCampos = {
  roloItemId?: string;
  cq_ok?: boolean;
  cq_alerta?: boolean;
  /** cq_alerta_status cru do servidor (alertado/trocado/…): só sem_alerta/alertado deixam o toggle agir. */
  cqStatus?: string;
  obs?: string;
  /** true = EU editei o CQ deste rolo nesta sessão (só então ele entra no `_cq_rolos`). */
  cq_tocado?: boolean;
};
export type CqRoloPatch = { cq_ok?: boolean; cq_alerta?: boolean; obs?: string };
/** O CQ do rolo como foi carregado/salvo (para desfazer o `cq_tocado` ao voltar ao mesmo valor). */
export type CqRoloBase = { cq_ok: boolean; cq_alerta: boolean; obs: string };

/** Base do CQ de cada rolo existente, indexada por `roloItemId`. */
export function baseCqRolos(rolos: Record<string, CqRoloCampos[]>): Record<string, CqRoloBase> {
  const out: Record<string, CqRoloBase> = {};
  for (const arr of Object.values(rolos)) {
    for (const e of arr) if (e.roloItemId) out[e.roloItemId] = { cq_ok: !!e.cq_ok, cq_alerta: !!e.cq_alerta, obs: e.obs ?? "" };
  }
  return out;
}

function igualBaseRolo(e: CqRoloCampos, base: CqRoloBase | null | undefined): boolean {
  return !!base && !!e.cq_ok === base.cq_ok && !!e.cq_alerta === base.cq_alerta && (e.obs ?? "") === base.obs;
}

/** Aplica uma edição de CQ no rolo e recalcula `cq_tocado` (igual à base = não tocado: some o selo e o dirty). Alerta só alterna sem_alerta<->alertado. */
export function aplicarPatchCqRolo<T extends CqRoloCampos>(entry: T, patch: CqRoloPatch, base?: CqRoloBase | null): T {
  const next: T = { ...entry };
  if (patch.cq_ok !== undefined) next.cq_ok = patch.cq_ok;
  if (patch.cq_alerta !== undefined && alertaAlternavel(entry.cqStatus)) next.cq_alerta = patch.cq_alerta;
  if (patch.obs !== undefined) next.obs = patch.obs;
  if (igualBaseRolo(next, base)) delete next.cq_tocado;
  else next.cq_tocado = true;
  return next;
}

/** `_cq_rolos` do salvar_oc_tecido: SÓ rolo existente tocado. cq_ok/cq_observacao vão sempre (chave presente = grava); cq_alerta só quando
 *  MUDEI o alerta vs a base E o rolo está em estado alternável (nunca rebaixa troca/estilo_ok/trocado/cancelado). */
export function cqRolosDoPayload(
  rolos: Record<string, CqRoloCampos[]>,
  bases: Record<string, CqRoloBase>,
): { item_id: string; cq_ok: boolean; cq_alerta?: boolean; cq_observacao: string }[] {
  const out: { item_id: string; cq_ok: boolean; cq_alerta?: boolean; cq_observacao: string }[] = [];
  for (const arr of Object.values(rolos)) {
    for (const e of arr) {
      if (!e.roloItemId || !e.cq_tocado) continue;
      const mudouAlerta = !!e.cq_alerta !== !!bases[e.roloItemId]?.cq_alerta;
      out.push({
        item_id: e.roloItemId,
        cq_ok: !!e.cq_ok,
        ...(mudouAlerta && alertaAlternavel(e.cqStatus) ? { cq_alerta: !!e.cq_alerta } : {}),
        cq_observacao: e.obs ?? "",
      });
    }
  }
  return out;
}

/** Valor ESTÁVEL do que está tocado nos rolos — entra no snapshot do dirty da OC (vazio = nada a salvar). */
export function cqRolosDirty(rolos: Record<string, CqRoloCampos[]>): { id: string; cq_ok: boolean; cq_alerta: boolean; obs: string }[] {
  const out: { id: string; cq_ok: boolean; cq_alerta: boolean; obs: string }[] = [];
  for (const arr of Object.values(rolos)) {
    for (const e of arr) if (e.roloItemId && e.cq_tocado) out.push({ id: e.roloItemId, cq_ok: !!e.cq_ok, cq_alerta: !!e.cq_alerta, obs: e.obs ?? "" });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Uma linha da seção (montada pela OC a partir do rascunho dos itens). */
export type OcCqLinha = {
  id: string;
  artigo: string;
  variante: string;
  cq_ok: boolean;
  cq_alerta_status: CqStatus;
  cq_observacao: string;
  tocado: boolean;
  /** conflito colaborativo pendente nesta linha (resolve-se no aviso do topo da OC; o Salvar fica travado). */
  emConflito?: boolean;
};

function CqItemCard({ item, onCqChange }: { item: OcCqLinha; onCqChange: (itemId: string, patch: CqPatch) => void }) {
  const badge = STATUS_BADGE[item.cq_alerta_status];
  const alertado = item.cq_alerta_status !== "sem_alerta";
  const podeAlertar = alertaAlternavel(item.cq_alerta_status);

  // Resumo do estado no cabeçalho colapsado: alerta (badge de status) > "CQ ok" > pendente.
  const resumo = badge ?? (item.cq_ok ? { label: "CQ ok", tone: "success" as StatusTone } : null);

  // Casca COLAPSÁVEL (default fechado) — estado local, não persiste.
  return (
    <Card className="p-3">
      <Collapsible defaultOpen={false}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 text-left [&[data-state=open]>svg]:rotate-90">
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" />
          <div className="min-w-0 flex-1">
            <span className="font-medium">{item.artigo}</span>
            <span className="text-muted-foreground"> · {item.variante}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <UnsavedIndicator show={item.tocado} />
            {resumo
              ? <StatusBadge tone={resumo.tone}>{resumo.label}</StatusBadge>
              : <Badge variant="outline" className="text-muted-foreground">Pendente</Badge>}
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-3 pt-3">
          {item.emConflito && (
            <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-300">
              Outra pessoa também mudou este item. Resolva o conflito no aviso do topo da OC antes de salvar.
            </p>
          )}
          <Textarea
            value={item.cq_observacao}
            onChange={(e) => onCqChange(item.id, { cq_observacao: e.target.value })}
            placeholder="Observação do CQ (defeitos, encolhimento, tonalidade…)"
            className="min-h-[60px] text-sm"
          />

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Switch checked={item.cq_ok} onCheckedChange={(v) => onCqChange(item.id, { cq_ok: v })} />
              CQ ok
            </label>
            <label
              className={`flex items-center gap-2 text-sm ${podeAlertar ? "cursor-pointer" : "cursor-not-allowed text-muted-foreground"}`}
              title={podeAlertar ? undefined : "Este alerta já está em andamento ou resolvido: continue em Alertas de Tecido."}
            >
              <Switch
                checked={alertado}
                disabled={!podeAlertar}
                onCheckedChange={(v) => onCqChange(item.id, { cq_alerta: v })}
              />
              Alertar estilo
            </label>
            {alertado && (
              // Link vivo no lugar da dica-morta: a resolução (Estilo OK / troca /
              // cancelar) acontece na página Alertas de Tecido (por RPC própria — não é rascunho).
              <Link to="/entrada-saida/alertas-tecido" className="text-xs text-primary hover:underline">
                Resolver nos Alertas de Tecido →
              </Link>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// Seção de CQ dentro da OC (Encomendado/Recebido). Sem rede: lê e edita só o rascunho que a OC lhe passa.
export function OcCqSection({ itens, onCqChange }: { itens: OcCqLinha[]; onCqChange: (itemId: string, patch: CqPatch) => void }) {
  if (itens.length === 0) return null;
  const algumTocado = itens.some((i) => i.tocado);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-bold tracking-tight">
          <span><span className="text-primary">5 ·</span> CQ de Tecido</span>
          <UnsavedIndicator show={algumTocado} />
        </h3>
        <Link to="/entrada-saida/alertas-tecido" className="text-sm text-primary hover:underline">
          ver Alertas de Tecido →
        </Link>
      </div>
      {itens.map((it) => (
        <CqItemCard key={it.id} item={it} onCqChange={onCqChange} />
      ))}
    </div>
  );
}

// P-245 A (Reforço de segurança S3a, fix round 1): os botões dos Alertas GRAVAM — exigem EDITAR Alertas de Tecido OU OC Tecido
// (o MESMO OU do servidor: aplicar_resolucao_alerta_tecido, receber_reposicao_troca, cancelar/reabrir/trocar_rolo e o gatilho de
// ocs_tecido_itens) e SOMEM da tela para quem só vê. Se uma aba antiga ainda clicar, o servidor recusa com a mensagem PT.
export const PAGINAS_EDITAR_ALERTAS = ["entrada_alertas_tecido", "entrada_oc_tecido"] as const;
export function podeEditarAlertas(canEdit: (pagina: string) => boolean): boolean {
  return PAGINAS_EDITAR_ALERTAS.some((p) => canEdit(p));
}

type AlertaAcoes = {
  ocupado: { resol: boolean; resolRolo: boolean; reabrirRolo: boolean };
  onEstiloOk: (it: CqItem) => void;
  onTroca: (it: CqItem) => void;
  onCancelar: (it: CqItem) => void;
  onReabrir: (it: CqItem) => void;
  onReceber: (it: CqItem) => void;
};

/** Cartão de um alerta. Sem `podeEditar` (só VÊ a página): nenhum botão e a observação só como texto (P-245 A). */
export function AlertaCard({ it, podeEditar, update, acoes }: {
  it: CqItem; podeEditar: boolean; update: ReturnType<typeof useCqUpdate>; acoes: AlertaAcoes;
}) {
  const badge = STATUS_BADGE[it.cq_alerta_status];
  const resolvido = RESOLVIDOS.includes(it.cq_alerta_status);
  return (
            <Card className="p-3 border-amber-500/40 bg-amber-500/5 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{it.artigo}</span>
                    <span className="text-muted-foreground">· {it.variante}</span>
                    <Badge variant="outline">{it.is_rolo ? "Rolo" : "OC"} {it.oc_numero ?? "—"}</Badge>
                    {badge && <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>}
                  </div>
                  {podeEditar ? (
                    <ObsField item={it} update={update} />
                  ) : it.cq_observacao ? (
                    <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap" data-testid="alerta-obs-leitura">{it.cq_observacao}</p>
                  ) : null}
                </div>
              </div>

              {podeEditar && (
              <div className="flex flex-wrap items-center gap-2 pl-6">
                {resolvido ? (
                  !it.is_rolo && it.cq_alerta_status === "trocado" ? (
                    // Troca concluída (reposição recebida): não dá p/ reabrir sem estornar
                    // o recebimento — o botão erraria. Mostra o estado final.
                    <span className="text-xs text-muted-foreground">Troca concluída (reposição recebida).</span>
                  ) : (
                    <Button size="sm" variant="outline" disabled={acoes.ocupado.resol || acoes.ocupado.reabrirRolo} onClick={() => acoes.onReabrir(it)}>
                      <RotateCcw className="h-4 w-4 mr-1" /> Reabrir
                    </Button>
                  )
                ) : it.cq_alerta_status === "troca_pendente" ? (
                  <>
                    <Button size="sm" onClick={() => acoes.onReceber(it)}>
                      <Check className="h-4 w-4 mr-1" /> Receber reposição
                    </Button>
                    <Button size="sm" variant="outline" disabled={acoes.ocupado.resol} onClick={() => acoes.onReabrir(it)}>
                      <RotateCcw className="h-4 w-4 mr-1" /> Desfazer troca
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" disabled={acoes.ocupado.resol || acoes.ocupado.resolRolo} onClick={() => acoes.onEstiloOk(it)}>
                      <Check className="h-4 w-4 mr-1" /> Estilo OK
                    </Button>
                    {/* Rolo: troca/cancelar próprios (sem financeiro). OC: fluxo normal.
                        Rolo já em uso (consumido ou selecionado no Dev) não troca/cancela. */}
                    <Button size="sm" variant="outline"
                      disabled={!!it.is_rolo && !!it.usado}
                      title={it.is_rolo && it.usado ? "Rolo em uso (consumido ou selecionado em Desenvolvimento) — não pode ser trocado." : undefined}
                      onClick={() => acoes.onTroca(it)}>
                      <Repeat className="h-4 w-4 mr-1" /> Troca
                    </Button>
                    <Button size="sm" variant="outline"
                      className="text-destructive border-destructive/40 hover:bg-destructive/10"
                      disabled={!!it.is_rolo && !!it.usado}
                      title={it.is_rolo && it.usado ? "Rolo em uso (consumido ou selecionado em Desenvolvimento) — não pode ser cancelado." : undefined}
                      onClick={() => acoes.onCancelar(it)}>
                      <Ban className="h-4 w-4 mr-1" /> {it.is_rolo ? "Cancelar rolo" : "Cancelar variante"}
                    </Button>
                    {it.is_rolo && it.usado && (
                      <span className="text-xs text-muted-foreground">Rolo em uso — bloqueado.</span>
                    )}
                  </>
                )}
              </div>
              )}
            </Card>
  );
}

// ───────────────────────── Alertas (página do estilo) ─────────────────────────
export function AlertasList() {
  const qc = useQueryClient();
  const { canEdit } = useAuth();
  const podeEditar = podeEditarAlertas(canEdit);
  const { items, isLoading } = useFlatCqItems();
  const update = useCqUpdate();   // observação
  const resol = useResolucao();   // ações (recalculam valor + parcelas) — só p/ OC
  const reposicao = useReceberReposicao();
  // Resolução de ROLO: update direto do status, SEM recalcular valor/parcelas (rolo
  // não tem financeiro — usar a RPC criaria parcelas espúrias).
  const resolRolo = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "estilo_ok" | "alertado" }) => {
      const { error } = await supabase
        .from("ocs_tecido_itens")
        .update({ cq_alerta_status: status, cancelado: false } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cq-tecido"] }),
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao resolver alerta do rolo")),
  });
  // Troca/cancela de rolo afeta estoque, consumo, listas de OC/rolo e os alertas —
  // invalida as chaves dessas telas (rolo não tem financeiro, então sem parcelas).
  const invalidarRolo = () => {
    ["cq-tecido", "cq-oc", "estoque-tecidos", "dash-estoque", "consumo-por-oc", "ocs_tecido", "rolos"]
      .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  // Cancelar SÓ aquele rolo: marca o item do rolo como cancelado (sai do estoque),
  // sem recalcular financeiro (rolo não tem parcela).
  const cancelRoloMut = useMutation({
    mutationFn: async (roloId: string) => {
      const { error } = await supabase.rpc("cancelar_rolo" as any, { _rolo_id: roloId });
      if (error) throw error;
    },
    onSuccess: () => { invalidarRolo(); toast.success("Rolo cancelado."); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao cancelar rolo")),
  });
  const reabrirRoloMut = useMutation({
    mutationFn: async (roloId: string) => {
      const { error } = await supabase.rpc("reabrir_rolo" as any, { _rolo_id: roloId });
      if (error) throw error;
    },
    onSuccess: () => invalidarRolo(),
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao reabrir rolo")),
  });
  // Trocar o rolo defeituoso: reverte a separação, marca 'trocado' e gera a reposição.
  const trocaRoloMut = useMutation({
    mutationFn: async ({ rolo_id, metragem }: { rolo_id: string; metragem: number | null }) => {
      const { error } = await supabase.rpc("trocar_rolo" as any, { _rolo_id: rolo_id, _nova_metragem: metragem });
      if (error) throw error;
    },
    onSuccess: () => { invalidarRolo(); toast.success("Rolo trocado — reposição gerada."); setTrocaRolo(null); setTrocaMetragem(""); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao trocar rolo")),
  });
  const [aba, setAba] = useState<"pendentes" | "resolvidos">("pendentes");
  const [confirmCancel, setConfirmCancel] = useState<CqItem | null>(null);
  const [confirmReabrir, setConfirmReabrir] = useState<CqItem | null>(null);
  const [troca, setTroca] = useState<CqItem | null>(null);
  const [receber, setReceber] = useState<CqItem | null>(null);
  const [trocaRolo, setTrocaRolo] = useState<CqItem | null>(null);
  const [trocaMetragem, setTrocaMetragem] = useState("");

  const lista = items.filter((i) =>
    aba === "pendentes" ? PENDENTES.includes(i.cq_alerta_status) : RESOLVIDOS.includes(i.cq_alerta_status),
  );

  if (isLoading) return <p className="text-sm text-muted-foreground py-12 text-center">Carregando…</p>;

  return (
    <ReadOnlyScope value={!podeEditar}>
    <div className="space-y-4">
      <div className="flex rounded-md border p-0.5 w-fit">
        <Button size="sm" variant={aba === "pendentes" ? "secondary" : "ghost"} onClick={() => setAba("pendentes")}>Pendentes</Button>
        <Button size="sm" variant={aba === "resolvidos" ? "secondary" : "ghost"} onClick={() => setAba("resolvidos")}>Resolvidos</Button>
      </div>

      {lista.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">
          {aba === "pendentes" ? "Nenhum alerta de estilo pendente." : "Nenhum alerta resolvido."}
        </p>
      ) : (
        lista.map((it) => (
          <AlertaCard
            key={it.id}
            it={it}
            podeEditar={podeEditar}
            update={update}
            acoes={{
              ocupado: { resol: resol.isPending, resolRolo: resolRolo.isPending, reabrirRolo: reabrirRoloMut.isPending },
              onEstiloOk: (x) => (x.is_rolo ? resolRolo.mutate({ id: x.id, status: "estilo_ok" }) : resol.mutate({ item_id: x.id, acao: "estilo_ok" })),
              onTroca: (x) => (x.is_rolo ? setTrocaRolo(x) : setTroca(x)),
              onCancelar: (x) => setConfirmCancel(x),
              onReabrir: (x) => setConfirmReabrir(x),
              onReceber: (x) => setReceber(x),
            }}
          />
        ))
      )}

      <AlertDialog open={!!confirmCancel} onOpenChange={(o) => !o && setConfirmCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmCancel?.is_rolo ? "Cancelar este rolo?" : "Cancelar esta variante?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmCancel?.is_rolo
                ? <>O rolo <strong>{confirmCancel?.oc_numero ?? "—"}</strong> ({confirmCancel?.variante}) sai do estoque e do consumo. Pode ser revertido em Resolvidos (Reabrir).</>
                : <>A variante "{confirmCancel?.variante}" da OC {confirmCancel?.oc_numero ?? "—"} sai do estoque, consumo e prévia, e o valor/parcelas da OC são recalculados. Pode ser revertida em Resolvidos (Reabrir).</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={resol.isPending || cancelRoloMut.isPending} onClick={() => { if (confirmCancel) { confirmCancel.is_rolo ? cancelRoloMut.mutate(confirmCancel.oc_id!) : resol.mutate({ item_id: confirmCancel.id, acao: "cancelar" }); } setConfirmCancel(null); }}>
              {confirmCancel?.is_rolo ? "Cancelar rolo" : "Cancelar variante"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmReabrir} onOpenChange={(o) => !o && setConfirmReabrir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmReabrir?.cq_alerta_status === "troca_pendente" ? "Desfazer esta troca?" : "Reabrir este alerta?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmReabrir?.cq_alerta_status === "troca_pendente"
                ? <>A reposição a receber é descartada e a entrada correspondente sai do cronograma de recebimento da OC {confirmReabrir?.oc_numero ?? "—"}. O item "{confirmReabrir?.variante}" volta para o alerta.</>
                : <>O item "{confirmReabrir?.variante}" volta para o alerta (sai do estado resolvido) e é recalculado.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmReabrir?.cq_alerta_status === "troca_pendente" ? "destructive" : "default"}
              disabled={resol.isPending || reabrirRoloMut.isPending}
              onClick={() => { if (confirmReabrir) { confirmReabrir.is_rolo ? reabrirRoloMut.mutate(confirmReabrir.oc_id!) : resol.mutate({ item_id: confirmReabrir.id, acao: "reabrir" }); } setConfirmReabrir(null); }}>
              {confirmReabrir?.cq_alerta_status === "troca_pendente" ? "Desfazer troca" : "Reabrir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {troca && <TrocaDialog original={troca} resol={resol} onClose={() => setTroca(null)} />}
      {receber && <ReceberReposicaoDialog original={receber} reposicao={reposicao} onClose={() => setReceber(null)} />}

      {trocaRolo && (
        <Dialog open onOpenChange={(o) => { if (!o) { setTrocaRolo(null); setTrocaMetragem(""); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Trocar rolo {trocaRolo.oc_numero ?? ""}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                O rolo defeituoso é <b>substituído</b> (removido) e um rolo de reposição é gerado
                (novo código) com a metragem abaixo — pode ser <b>maior ou menor</b>. (Rolo não mexe
                em financeiro.)
              </p>
              <div className="space-y-1.5">
                <Label>Metragem da reposição (m)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={trocaMetragem}
                  onChange={(e) => setTrocaMetragem(e.target.value)}
                  placeholder="Vazio = mesma metragem do rolo trocado"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setTrocaRolo(null); setTrocaMetragem(""); }}><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Button>
              <Button
                onClick={() => trocaRoloMut.mutate({
                  rolo_id: trocaRolo.oc_id!,
                  metragem: trocaMetragem.trim() ? Number(trocaMetragem.replace(",", ".")) : null,
                })}
                disabled={trocaRoloMut.isPending}
              >
                Trocar rolo
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
    </ReadOnlyScope>
  );
}

// Receber a reposição da troca: data + metragem recebida → original vira 'trocado'.
function ReceberReposicaoDialog({ original, reposicao, onClose }: { original: CqItem; reposicao: ReturnType<typeof useReceberReposicao>; onClose: () => void }) {
  const [data, setData] = useState("");
  const [metragem, setMetragem] = useState("");
  const confirmar = () => {
    if (!data) { toast.error("Informe a data de recebimento."); return; }
    const m = Number(metragem);
    if (!(m > 0)) { toast.error("Informe a metragem recebida."); return; }
    reposicao.mutate(
      { item_id: original.id, data, metragem: m },
      { onSuccess: () => { toast.success("Reposição recebida — troca concluída"); onClose(); } },
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Receber reposição</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Reposição da troca de <b>{original.artigo} · {original.variante}</b> (OC {original.oc_numero ?? "—"}).
            Ao confirmar, a troca fica concluída (badge "Trocado") e o valor/parcelas sobem de volta.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Data recebida</Label>
              <DateField value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Metragem recebida (m)</Label>
              <Input type="number" value={metragem} onChange={(e) => setMetragem(e.target.value)} placeholder="metros" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Button>
          <Button onClick={confirmar} disabled={reposicao.isPending}>Confirmar recebimento</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Troca: seleciona o tecido/variante substituto ─────────────────────────
function TrocaDialog({ original, resol, onClose }: { original: CqItem; resol: ReturnType<typeof useResolucao>; onClose: () => void }) {
  const [artigoId, setArtigoId] = useState("");
  const [varId, setVarId] = useState("");
  const [metragem, setMetragem] = useState("");

  const { data: artigos = [] } = useQuery({
    queryKey: ["troca-artigos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("artigos").select("id, nome, unidade_medida").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; unidade_medida: string | null }[];
    },
  });
  const { data: variantes = [] } = useQuery({
    queryKey: ["troca-variantes", artigoId],
    enabled: !!artigoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido")
        .select("id, nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
        .eq("artigo_id", artigoId);
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        nome_variante: string | null;
        codigo_variante: string | null;
        cor?: { nome: string | null } | null;
        apelido?: { nome: string | null } | null;
      }[];
    },
  });

  const confirmar = () => {
    if (!artigoId || !varId) { toast.error("Selecione o tecido e a variante substitutos."); return; }
    const m = Number(metragem);
    if (!(m > 0)) { toast.error("Informe a metragem esperada."); return; }
    resol.mutate(
      { item_id: original.id, acao: "troca", rep_artigo_id: artigoId, rep_variante_id: varId, rep_metragem: m },
      { onSuccess: () => { toast.success("Troca registrada — substituto a receber"); onClose(); } },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Trocar variante</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Substituindo <b>{original.artigo} · {original.variante}</b> (OC {original.oc_numero ?? "—"}). O original
            sai do estoque/consumo e o substituto entra como <b>a receber</b>.
          </p>
          <div className="space-y-1.5">
            <Label>Tecido substituto</Label>
            <Select value={artigoId} onValueChange={(v) => { setArtigoId(v); setVarId(""); }}>
              <SelectTrigger><SelectValue placeholder="Selecione o tecido" /></SelectTrigger>
              <SelectContent>
                {artigos.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.nome}{a.unidade_medida === "kg" ? " [kg]" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {artigoId && (
            <div className="space-y-1.5">
              <Label>Variante</Label>
              <Select value={varId} onValueChange={setVarId}>
                <SelectTrigger><SelectValue placeholder="Selecione a variante" /></SelectTrigger>
                <SelectContent>
                  {variantes.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{vName(v)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Metragem esperada (m)</Label>
            <Input type="number" value={metragem} onChange={(e) => setMetragem(e.target.value)} placeholder="metros" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Button>
          <Button onClick={confirmar} disabled={resol.isPending}>Confirmar troca</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Observação editável (compartilhada com o CQ da OC).
function ObsField({ item, update }: { item: CqItem; update: ReturnType<typeof useCqUpdate> }) {
  const [obs, setObs] = useState(item.cq_observacao ?? "");
  return (
    <Textarea
      value={obs}
      onChange={(e) => setObs(e.target.value)}
      onBlur={() => { if ((obs || "") !== (item.cq_observacao ?? "")) update.mutate({ id: item.id, patch: { cq_observacao: obs || null } }); }}
      placeholder="Observação (compartilhada com o CQ da OC)…"
      className="min-h-[48px] text-sm mt-1"
    />
  );
}
