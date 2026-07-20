import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Collapsible, CollapsibleTrigger, CollapsibleContent,
} from "@/components/ui/collapsible";
import { Plus, Trash2, Pencil, Save, ArrowLeft, ImageOff, Send, X, ChevronRight } from "lucide-react";
import { metragemDisponivel, demandaLinha, saldo, agregarUsoOC } from "@/lib/simulacao";
import type { OcUso } from "@/lib/simulacao";
import { labelVarianteRow } from "@/lib/variante";
import { useResizableWidth, useCorCols } from "@/hooks/useResizableWidth";

/**
 * Simulador de uso de OC — cenários + árvore Unidade/Linha/Modelo + resultado por cor.
 * Cores reais (variantes) por subcoleção; resultado per-cor com sobra/estoura.
 */

// ─── Tipos do estado local ────────────────────────────────────────────────────

type VarianteSim = { ocItemId: string };
type ModeloSim = {
  id: string;
  modeloId: string | null;
  consumo: number;
  ref?: string | null;
  nome?: string | null;
  foto?: string | null;
};
type LinhaSim = { id: string; linhaId: string | null; profCor: number; modelos: ModeloSim[] };
type UnidadeSim = {
  id: string;
  dbId?: string;
  subcolecaoId: string | null;
  nomeUnidade: string;
  ocId: string | null;
  variantes: VarianteSim[];
  linhas: LinhaSim[];
};
type Cenario = { id: string; nome: string; unidades: UnidadeSim[] };

// ─── Helpers (mesmos do PadraoMixSheet — duplicados por convenção do repo) ───

let _seq = 0;
const nid = (p: string) => `${p}-${++_seq}`;
const num = (v: string) => (v === "" ? 0 : Number(v.replace(",", ".")) || 0);

function Lbl({ t, children }: { t: string; children: React.ReactNode }) {
  return <span className="flex items-center gap-1 text-xs text-muted-foreground">{t} {children}</span>;
}

function Sel({
  value, onChange, placeholder, disabled, className, children,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={className}><SelectValue placeholder={placeholder ?? "—"} /></SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

// ─── Thumbnail de modelo (bucket "modelos") ───────────────────────────────────

function ModeloThumb({ path, alt, className, iconClassName }: { path: string | null | undefined; alt: string; className?: string; iconClassName?: string }) {
  const url = useSignedUrl(path ?? null, "modelos");
  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/40 ${className ?? "h-8 w-8"}`}>
      {url
        ? <img src={url} alt={alt} className="h-full w-full object-cover" />
        : <ImageOff className={iconClassName ?? "h-3.5 w-3.5 text-muted-foreground"} />}
    </div>
  );
}

// Input de consumo (m/peça) DECIMAL. Mantém um buffer de texto cru p/ preservar estados
// intermediários ("1," / "1,5"): sem isso o value controlado voltava ao número parseado e
// "comia" a vírgula, deixando só dar p/ digitar inteiro.
function ConsumoInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const fmt = (n: number) => (n === 0 ? "" : String(n).replace(".", ","));
  const [text, setText] = useState(fmt(value));
  useEffect(() => {
    // Ressincroniza só quando o valor externo muda de fato (ex.: "aplicar a todos").
    if (num(text) !== value) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      className="h-7 w-20 px-1 tabular-nums"
      inputMode="decimal"
      value={text}
      placeholder="0,00"
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d.,]/g, "");
        setText(raw);
        onCommit(num(raw));
      }}
    />
  );
}

// ─── Formatação ───────────────────────────────────────────────────────────────

const fmt2 = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── ResumoOC: coluna/faixa de resumo agregado de uso de OC ──────────────────

function ResumoOC({
  resumo,
  varianteLabelDe,
}: {
  resumo: OcUso[];
  varianteLabelDe: (ocId: string | null, ocItemId: string) => string;
}) {
  if (resumo.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-3 px-2">
        Atribua OCs às subcoleções para ver o resumo.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {resumo.map((oc) => (
        <Collapsible key={oc.ocId} defaultOpen className="group/oc-resumo">
          {/* Header do card de OC */}
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-left hover:bg-muted/40 transition-colors min-h-[44px] md:min-h-0">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/oc-resumo:rotate-90" />
              <span className="flex-1 text-xs font-medium truncate">
                OC {oc.numero ?? oc.ocId.slice(0, 6)}
              </span>
              {/* Badge ✓ / ⚠ */}
              <span className={`text-xs font-medium shrink-0 ${oc.ok ? "text-green-600" : "text-amber-600"}`}>
                {oc.ok ? "✓" : "⚠"}
              </span>
              {/* Total saldo */}
              <span className={`text-xs tabular-nums shrink-0 ${oc.totalSaldo >= 0 ? "text-green-600" : "text-destructive"}`}>
                {oc.totalSaldo >= 0
                  ? `+${fmt2(oc.totalSaldo)}m`
                  : `−${fmt2(Math.abs(oc.totalSaldo))}m`}
              </span>
            </button>
          </CollapsibleTrigger>

          {/* Cores da OC */}
          <CollapsibleContent>
            <div className="mt-1 space-y-2 pl-2 border-l ml-3">
              {oc.cores.map((cor) => {
                const pctUso = cor.disp > 0 ? Math.min(100, (cor.dem / cor.disp) * 100) : 0;
                const label = varianteLabelDe(oc.ocId, cor.ocItemId);
                return (
                  <div key={cor.ocItemId} className="space-y-0.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0 text-xs">
                      <span className="font-medium truncate max-w-[8rem]" title={label}>
                        {label}
                      </span>
                      <span className={`tabular-nums shrink-0 ${cor.saldo >= 0 ? "text-green-600" : "text-destructive"}`}>
                        {cor.saldo >= 0
                          ? `sobram ${fmt2(cor.saldo)} m`
                          : `faltam ${fmt2(Math.abs(cor.saldo))} m`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                      <span>disp: {fmt2(cor.disp)} m</span>
                      <span>dem: {fmt2(cor.dem)} m</span>
                    </div>
                    {/* Barrinha (mesmo estilo do resultado por-cor local) */}
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${cor.saldo >= 0 ? "bg-green-500" : "bg-destructive"}`}
                        style={{ width: `${pctUso}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function SimulacaoSheet({
  colecaoId,
  tipo,
  onClose,
}: {
  colecaoId: string;
  tipo: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  // ── Queries de leitura ──────────────────────────────────────────────────────

  const { data: cenariosSalvos = [] } = useQuery({
    queryKey: ["otb-simulacoes", colecaoId],
    queryFn: async () => {
      const { data, error } = await supabase.from("otb_simulacoes" as any)
        .select("id, nome, unidades:otb_simulacao_unidades(id, subcolecao_id, oc_tecido_id, variantes:otb_simulacao_variantes(oc_tecido_item_id, ordem), linhas:otb_simulacao_linhas(id, linha_id, prof_cor, num_modelos, ordem, modelos:otb_simulacao_modelos(id, modelo_id, slot_index, consumo)))")
        .eq("colecao_id", colecaoId).order("created_at");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: plano } = useQuery({
    queryKey: ["otb-sim-plano", colecaoId, tipo],
    queryFn: async () => {
      const { data, error } = await supabase.from("colecoes" as any)
        .select("id, tipo, subcolecoes:colecao_subcolecoes(id, nome, ordem, semanas), itens:colecao_pv_itens(subcolecao_id, linha_id, prof_cor, cores, qtd_semanas), semanas:colecao_semanas(subcolecao_id, semana, qtd_planejada)")
        .eq("id", colecaoId).single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: modelosReais = [] } = useQuery({
    queryKey: ["otb-sim-modelos", colecaoId],
    queryFn: async () =>
      (await supabase.from("modelos").select("id, ref, nome, fotos_modelo, subcolecao, linha_id").eq("colecao_id", colecaoId)).data ?? [],
  });

  // OC com variantes embutidas (Step 1)
  const { data: ocs = [] } = useQuery({
    queryKey: ["otb-sim-ocs"],
    queryFn: async () =>
      (await supabase.from("ocs_tecido" as any)
        .select("id, numero_pedido, itens:ocs_tecido_itens(id, quantidade_pedida, quantidade_recebida, artigo:artigos(nome, unidade_medida, rendimento), variante:variante_tecido_id(nome_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)))")
        .order("created_at", { ascending: false })).data ?? [] as any[],
  });

  const linhaOpts = (useQuery({
    queryKey: ["padrao-linhas"],
    queryFn: async () => (await supabase.from("linhas").select("id, nome").order("nome")).data ?? [],
  }).data ?? []) as any[];

  const nomeLinha = (id: string | null) => linhaOpts.find((l: any) => l.id === id)?.nome ?? "Linha";

  // ── Estado local ───────────────────────────────────────────────────────────

  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Cenario>({ id: "", nome: "", unidades: [] });
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editNome, setEditNome] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState<string | null>(null);
  const [confirmAplicar, setConfirmAplicar] = useState<{ unidadeId: string; nome: string } | null>(null);

  // ── Larguras arrastáveis (desktop-only, persistidas em localStorage) ─────────
  const { width: resumoWidth, startDrag: startDragResumo } = useResizableWidth(
    "otb-sim-resumo-w",
    288,
    220,
    560,
    true, // arrastar alça p/ esquerda aumenta o resumo
  );
  const { cols: corCols, startDragPecas, startDragMetragem } = useCorCols("otb-sim-cor-cols");

  // ── Helpers de nomeação ────────────────────────────────────────────────────

  const nomeUnidadeDe = (subcolecaoId: string | null): string => {
    if (!plano) return "Subcoleção";
    const sub = (plano.subcolecoes ?? []).find((x: any) => x.id === subcolecaoId);
    return sub?.nome ?? "Coleção";
  };

  // ── Helper: rótulo de variante a partir do ocItemId ───────────────────────

  const varianteLabelDe = (ocId: string | null, ocItemId: string): string => {
    const oc = ocId ? (ocs as any[]).find((o) => o.id === ocId) : null;
    const item = (oc?.itens ?? []).find((it: any) => it.id === ocItemId);
    if (!item) return ocItemId.slice(0, 8);
    const artNome = item.artigo?.nome ?? "";
    const varLabel = labelVarianteRow(item.variante);
    return [artNome, varLabel].filter(Boolean).join(" · ") || ocItemId.slice(0, 8);
  };

  // ── Semear a árvore a partir do plano (Step 3) ────────────────────────────

  const semear = (): UnidadeSim[] => {
    if (!plano) return [];

    const modByKey = (subNome: string, linhaId: string | null) =>
      (modelosReais as any[]).filter(
        (m) => (m.subcolecao ?? "") === subNome && (m.linha_id ?? null) === linhaId
      );

    if (tipo === "poder_venda") {
      const subs = [...(plano.subcolecoes ?? [])].sort(
        (a: any, b: any) => (a.ordem ?? 0) - (b.ordem ?? 0)
      );
      return subs.map((sc: any) => {
        const its = (plano.itens ?? []).filter((it: any) => it.subcolecao_id === sc.id);
        const linhas: LinhaSim[] = its.map((it: any) => {
          const qtdSemanas = (it.qtd_semanas ?? {}) as Record<string, number>;
          const numSlots = Object.values(qtdSemanas).reduce(
            (s, v) => s + (Number(v) || 0), 0
          );
          const reais = modByKey(sc.nome, it.linha_id);
          const modelos: ModeloSim[] = Array.from({ length: numSlots }, (_, i) => ({
            id: nid("m"),
            modeloId: reais[i]?.id ?? null,
            consumo: 0,
            ref: reais[i]?.ref ?? null,
            nome: reais[i]?.nome ?? null,
            foto: ((reais[i]?.fotos_modelo ?? []) as string[])[0] ?? null,
          }));
          return {
            id: nid("l"),
            linhaId: it.linha_id ?? null,
            profCor: Number(it.prof_cor) || 0,
            modelos,
          };
        });
        return { id: nid("u"), subcolecaoId: sc.id, nomeUnidade: sc.nome, ocId: null, variantes: [], linhas };
      });
    }

    // Orçamento
    const bySub = new Map<string | null, number>();
    for (const s of (plano.semanas ?? [])) {
      const k = s.subcolecao_id ?? null;
      bySub.set(k, (bySub.get(k) ?? 0) + (Number(s.qtd_planejada) || 0));
    }
    const nomeSub = (id: string | null) =>
      (plano.subcolecoes ?? []).find((x: any) => x.id === id)?.nome ?? "Coleção";

    return [...bySub.entries()].map(([subId, numSlots]) => {
      const modelos: ModeloSim[] = Array.from({ length: numSlots }, () => ({
        id: nid("m"), modeloId: null, consumo: 0,
      }));
      return {
        id: nid("u"),
        subcolecaoId: subId,
        nomeUnidade: nomeSub(subId),
        ocId: null,
        variantes: [],
        linhas: [{ id: nid("l"), linhaId: null, profCor: 1, modelos }],
      };
    });
  };

  // ── mapCenarioFromDb (Step 4) ─────────────────────────────────────────────

  const mapCenarioFromDb = (row: any): Cenario => ({
    id: row.id,
    nome: row.nome,
    unidades: [...(row.unidades ?? [])].map((u: any) => ({
      id: nid("u"),
      dbId: u.id,
      subcolecaoId: u.subcolecao_id ?? null,
      nomeUnidade: nomeUnidadeDe(u.subcolecao_id),
      ocId: u.oc_tecido_id ?? null,
      variantes: [...(u.variantes ?? [])]
        .sort((a: any, b: any) => (a.ordem ?? 0) - (b.ordem ?? 0))
        .map((v: any) => ({ ocItemId: v.oc_tecido_item_id })),
      linhas: [...(u.linhas ?? [])]
        .sort((a: any, b: any) => (a.ordem ?? 0) - (b.ordem ?? 0))
        .map((l: any) => ({
          id: nid("l"),
          linhaId: l.linha_id ?? null,
          profCor: Number(l.prof_cor) || 0,
          modelos: [...(l.modelos ?? [])]
            .sort((a: any, b: any) => (a.slot_index ?? 0) - (b.slot_index ?? 0))
            .map((m: any) => {
              const modeloReal = m.modelo_id
                ? (modelosReais as any[]).find((mr: any) => mr.id === m.modelo_id)
                : null;
              return {
                id: nid("m"),
                modeloId: m.modelo_id ?? null,
                consumo: Number(m.consumo) || 0,
                ref: modeloReal?.ref ?? null,
                nome: modeloReal?.nome ?? null,
                foto: ((modeloReal?.fotos_modelo ?? []) as string[])[0] ?? null,
              };
            }),
        })),
    })),
  });

  // ── Efeitos de seleção ─────────────────────────────────────────────────────

  // Seleciona o 1º cenário ao carregar
  useEffect(() => {
    if (!selId && cenariosSalvos.length) setSelId(cenariosSalvos[0].id);
  }, [cenariosSalvos, selId]);

  // Hidrata o draft ao trocar de cenário
  useEffect(() => {
    if (selId && selId !== draftFor) {
      const row = (cenariosSalvos as any[]).find((x: any) => x.id === selId);
      if (row) {
        const cenario = mapCenarioFromDb(row);
        setDraft(cenario);
        setDraftFor(selId);
        setDirty(false);
      }
    }
  // nomeUnidadeDe não é estável entre renders, mas a dependência correta é o plano
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, cenariosSalvos, ocs]);

  // ── Helpers de mutação de draft ───────────────────────────────────────────

  const upd = (fn: (d: Cenario) => Cenario) => { setDraft(fn); setDirty(true); };

  const patchUnidade = (uid: string, p: Partial<UnidadeSim>) =>
    upd((d) => ({ ...d, unidades: d.unidades.map((u) => (u.id === uid ? { ...u, ...p } : u)) }));

  const patchLinha = (uid: string, lid: string, p: Partial<LinhaSim>) =>
    upd((d) => ({
      ...d,
      unidades: d.unidades.map((u) =>
        u.id !== uid ? u : { ...u, linhas: u.linhas.map((l) => (l.id === lid ? { ...l, ...p } : l)) }
      ),
    }));

  const patchModelo = (uid: string, lid: string, mid: string, p: Partial<ModeloSim>) =>
    upd((d) => ({
      ...d,
      unidades: d.unidades.map((u) =>
        u.id !== uid ? u : {
          ...u,
          linhas: u.linhas.map((l) =>
            l.id !== lid ? l : {
              ...l, modelos: l.modelos.map((m) => (m.id === mid ? { ...m, ...p } : m)),
            }
          ),
        }
      ),
    }));

  const addModelo = (uid: string, lid: string) =>
    upd((d) => ({
      ...d,
      unidades: d.unidades.map((u) =>
        u.id !== uid ? u : {
          ...u,
          linhas: u.linhas.map((l) =>
            l.id !== lid ? l : {
              ...l, modelos: [...l.modelos, { id: nid("m"), modeloId: null, consumo: 0 }],
            }
          ),
        }
      ),
    }));

  const aplicarConsumoTodos = (uid: string, lid: string, consumo: number) =>
    upd((d) => ({
      ...d,
      unidades: d.unidades.map((u) =>
        u.id !== uid ? u : {
          ...u,
          linhas: u.linhas.map((l) =>
            l.id !== lid ? l : { ...l, modelos: l.modelos.map((m) => ({ ...m, consumo })) }
          ),
        }
      ),
    }));

  // Adiciona uma variante à unidade (se ainda não estiver)
  const addVariante = (uid: string, ocItemId: string) =>
    upd((d) => ({
      ...d,
      unidades: d.unidades.map((u) =>
        u.id !== uid ? u
          : u.variantes.some((v) => v.ocItemId === ocItemId)
            ? u
            : { ...u, variantes: [...u.variantes, { ocItemId }] }
      ),
    }));

  // Remove uma variante da unidade
  const removeVariante = (uid: string, ocItemId: string) =>
    upd((d) => ({
      ...d,
      unidades: d.unidades.map((u) =>
        u.id !== uid ? u : { ...u, variantes: u.variantes.filter((v) => v.ocItemId !== ocItemId) }
      ),
    }));

  // ── Re-puxar do OTB ───────────────────────────────────────────────────────

  const repuxar = () => {
    const antigos = new Map<string, number>();
    draft.unidades.forEach((u) =>
      u.linhas.forEach((l) =>
        l.modelos.forEach((m, i) => {
          antigos.set(m.modeloId ?? `${u.subcolecaoId}|${l.linhaId}|${i}`, m.consumo);
        })
      )
    );
    const unidades = semear().map((u) => ({
      ...u,
      linhas: u.linhas.map((l) => ({
        ...l,
        modelos: l.modelos.map((m, i) => ({
          ...m,
          consumo: antigos.get(m.modeloId ?? `${u.subcolecaoId}|${l.linhaId}|${i}`) ?? 0,
        })),
      })),
    }));
    setDraft((d) => ({ ...d, unidades }));
    setDirty(true);
  };

  // ── Mutations ─────────────────────────────────────────────────────────────

  // buildArvore (Step 5): cores = variantes.length para compatibilidade
  const buildArvore = (d: Cenario) =>
    d.unidades.map((u) => ({
      subcolecao_id: u.subcolecaoId,
      oc_tecido_id: u.ocId,
      variantes: u.variantes.map((v) => ({ oc_tecido_item_id: v.ocItemId })),
      linhas: u.linhas.map((l) => ({
        linha_id: l.linhaId,
        prof_cor: l.profCor,
        cores: u.variantes.length,
        num_modelos: l.modelos.length,
        modelos: l.modelos.map((m, i) => ({
          modelo_id: m.modeloId,
          slot_index: i,
          consumo: m.consumo,
        })),
      })),
    }));

  const criar = useMutation({
    mutationFn: async () => {
      const sementada = semear();
      const arvore = buildArvore({ id: "", nome: "", unidades: sementada });
      const { data, error } = await supabase.rpc("salvar_simulacao" as any, {
        _id: null,
        _header: { colecao_id: colecaoId, nome: `Cenário ${(cenariosSalvos as any[]).length + 1}` },
        _arvore: arvore,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["otb-simulacoes", colecaoId] });
      setSelId(id);
      setDraftFor(null);
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao criar o cenário.")),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("excluir_simulacao" as any, { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["otb-simulacoes", colecaoId] });
      setSelId(null);
      setDraftFor(null);
      setConfirmExcluir(null);
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir o cenário.")),
  });

  const salvar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("salvar_simulacao" as any, {
        _id: selId,
        _header: { colecao_id: colecaoId, nome: draft.nome.trim() },
        _arvore: buildArvore(draft),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success("Cenário salvo.");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["otb-simulacoes", colecaoId] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar o cenário.")),
  });

  const aplicar = useMutation({
    mutationFn: async (unidadeDbId: string) => {
      const { error } = await supabase.rpc("aplicar_simulacao" as any, {
        _simulacao_id: selId,
        _unidade_id: unidadeDbId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Valores aplicados no card da coleção.");
      setConfirmAplicar(null);
      qc.invalidateQueries({ queryKey: ["otb-orcamento"] });
      qc.invalidateQueries({ queryKey: ["colecao-pv", colecaoId] });
      qc.invalidateQueries({ queryKey: ["otb-sim-plano", colecaoId, tipo] });
      qc.invalidateQueries({ queryKey: ["otb-colecoes"] });
      qc.invalidateQueries({ queryKey: ["otb-pv-poder"] });
    },
    onError: (e: any) => {
      setConfirmAplicar(null);
      toast.error(mensagemErro(e, "Erro ao aplicar no card."));
    },
  });

  // ── Helpers de OC ─────────────────────────────────────────────────────────

  const ocById = (ocId: string | null) => ocId ? (ocs as any[]).find((o) => o.id === ocId) : null;

  // "plano: N cores" = maior `cores` entre as linhas desta subcoleção no plano
  const planoCoresPara = (subcolecaoId: string | null): number => {
    if (!plano || !subcolecaoId) return 0;
    const its = (plano.itens ?? []).filter((it: any) => it.subcolecao_id === subcolecaoId);
    return its.reduce((mx: number, it: any) => Math.max(mx, Number(it.cores) || 0), 0);
  };

  const temSel = !!selId && (cenariosSalvos as any[]).some((x: any) => x.id === selId);

  // ── Resumo agregado de OC (para a coluna direita / faixa mobile) ───────────

  const resumo = useMemo(
    () => agregarUsoOC(draft.unidades, ocs as any),
    [draft.unidades, ocs]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="right" className="w-full sm:max-w-[70vw] flex flex-col p-0 max-sm:[&>button]:hidden">
          <SheetHeader className="p-4 border-b shrink-0">
            <SheetTitle className="text-base sm:text-lg">Simulador de uso de OC</SheetTitle>
          </SheetHeader>

          {/* ── Área rolável: layout 2 colunas em desktop, 1 coluna em mobile ── */}
          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col md:flex-row md:items-start md:min-h-full">

              {/* ── Coluna esquerda (esquerda principal, rola junto) ── */}
              <div className="flex-1 min-w-0 p-4 space-y-4" style={{ minWidth: 0 }}>

                {/* ── Pílulas de cenário ── */}
                <div className="flex flex-wrap items-center gap-2">
                  {(cenariosSalvos as any[]).map((c) => {
                    const isSel = c.id === selId;
                    return (
                      <div
                        key={c.id}
                        className={`flex items-center gap-1 rounded-full border px-1 ${isSel ? "border-primary bg-primary/5" : ""}`}
                      >
                        {isSel && editNome ? (
                          <Input
                            autoFocus
                            value={draft.nome}
                            onChange={(e) => upd((d) => ({ ...d, nome: e.target.value }))}
                            onBlur={() => setEditNome(false)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === "Escape") setEditNome(false);
                            }}
                            className="h-7 w-36"
                          />
                        ) : (
                          <button className="px-2 py-1 text-sm font-medium" onClick={() => setSelId(c.id)}>
                            {isSel ? draft.nome : c.nome}
                            {isSel && dirty && (
                              <span className="ml-1 text-amber-600" title="não salvo">•</span>
                            )}
                          </button>
                        )}
                        {isSel && (
                          <>
                            <Button
                              variant="ghost" size="iconSm" className="h-8 w-8"
                              onClick={() => setEditNome(true)}
                            >
                              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                            <Button
                              variant="ghost" size="iconSm" className="h-8 w-8"
                              onClick={() => setConfirmExcluir(c.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          </>
                        )}
                      </div>
                    );
                  })}
                  <Button
                    variant="outline" size="sm"
                    onClick={() => criar.mutate()}
                    disabled={criar.isPending || !plano}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Cenário
                  </Button>
                </div>

                {/* ── Faixa de resumo de OC (mobile: sticky no topo, dentro da col esq) ── */}
                {temSel && (
                  <div className="md:hidden sticky top-0 z-10 bg-background border rounded-lg p-3 space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground">Resumo de OC</p>
                    <ResumoOC resumo={resumo} varianteLabelDe={varianteLabelDe} />
                  </div>
                )}

                {!temSel ? (
                  <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    Nenhum cenário ainda. Clique em <strong>+ Cenário</strong> pra criar o primeiro.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Re-puxar do OTB */}
                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" onClick={repuxar} disabled={!plano}>
                        Re-puxar do OTB
                      </Button>
                    </div>

                    {/* ── Unidades (Subcoleções) — Collapsible ── */}
                    {draft.unidades.map((u) => {
                      const ocSelecionada = ocById(u.ocId);
                      const todosItens: any[] = ocSelecionada?.itens ?? [];
                      // Itens ainda não escolhidos (disponíveis p/ adicionar)
                      const itensDispo = todosItens.filter(
                        (it: any) => !u.variantes.some((v) => v.ocItemId === it.id)
                      );
                      // Cálculo de demanda total (igual para todas as cores = demanda por cor)
                      const demandaPorCor = u.linhas.reduce(
                        (s, l) => s + demandaLinha(l.profCor, 1, l.modelos.map((m) => m.consumo)),
                        0
                      );
                      const planoNCores = planoCoresPara(u.subcolecaoId);

                      // Mini ✓/⚠ da subcoleção: ok se todas as cores têm saldo ≥ 0
                      const subOk = u.variantes.length > 0 && u.variantes.every((v) => {
                        const oc = ocById(u.ocId);
                        const item = (oc?.itens ?? []).find((it: any) => it.id === v.ocItemId);
                        if (!item) return false;
                        const disp = metragemDisponivel(
                          item.artigo?.unidade_medida ?? null,
                          Number(item.quantidade_pedida) || 0,
                          Number(item.artigo?.rendimento) || 0
                        );
                        return saldo(disp, demandaPorCor) >= 0;
                      });
                      const subTemDados = u.variantes.length > 0;

                      return (
                        <Collapsible key={u.id} defaultOpen className="group/subcol">
                          {/* Header da subcoleção */}
                          <Card className="overflow-hidden">
                            <CollapsibleTrigger asChild>
                              <button className="w-full flex items-center gap-2 p-3 text-left hover:bg-muted/30 transition-colors min-h-[44px]">
                                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/subcol:rotate-90" />
                                <span className="flex-1 font-medium text-sm truncate">
                                  {u.nomeUnidade}
                                </span>
                                {/* OC atribuída */}
                                {u.ocId && ocSelecionada && (
                                  <span className="text-xs text-muted-foreground shrink-0">
                                    OC {ocSelecionada.numero_pedido ?? u.ocId.slice(0, 6)}
                                  </span>
                                )}
                                {/* Mini ✓/⚠ */}
                                {subTemDados && (
                                  <span className={`text-xs font-semibold shrink-0 ${subOk ? "text-green-600" : "text-amber-600"}`}>
                                    {subOk ? "✓" : "⚠"}
                                  </span>
                                )}
                              </button>
                            </CollapsibleTrigger>

                            <CollapsibleContent>
                              <div className="p-4 pt-0 space-y-3 border-t">
                                {/* ── Cabeçalho da unidade (seletor OC) ── */}
                                <div className="flex flex-wrap items-center gap-2 pt-3">
                                  {/* Seletor OC (Step 6) */}
                                  <Sel
                                    value={u.ocId ?? ""}
                                    onChange={(ocId) => {
                                      // Troca de OC: limpa variantes escolhidas
                                      patchUnidade(u.id, { ocId, variantes: [] });
                                    }}
                                    placeholder="— OC —"
                                    className="min-w-[10rem]"
                                  >
                                    {(ocs as any[]).map((o: any) => (
                                      <SelectItem key={o.id} value={o.id}>
                                        OC {o.numero_pedido ?? o.id.slice(0, 6)}
                                      </SelectItem>
                                    ))}
                                  </Sel>

                                  {/* Referência plano: N cores */}
                                  {planoNCores > 0 && (
                                    <span className="text-xs text-muted-foreground">
                                      plano: {planoNCores} cores
                                    </span>
                                  )}
                                </div>

                                {/* ── Multi-select de variantes (Step 6) ── */}
                                {u.ocId && (
                                  <div className="space-y-1.5">
                                    {/* Chips das variantes escolhidas */}
                                    {u.variantes.length > 0 && (
                                      <div className="flex flex-wrap gap-1.5">
                                        {u.variantes.map((v) => (
                                          <span
                                            key={v.ocItemId}
                                            className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs"
                                          >
                                            {varianteLabelDe(u.ocId, v.ocItemId)}
                                            <button
                                              onClick={() => removeVariante(u.id, v.ocItemId)}
                                              className="ml-0.5 rounded-full hover:text-destructive"
                                              aria-label="Remover cor"
                                            >
                                              <X className="h-3 w-3" />
                                            </button>
                                          </span>
                                        ))}
                                      </div>
                                    )}

                                    {/* Dropdown para adicionar variante ainda não escolhida */}
                                    {itensDispo.length > 0 && (
                                      <Sel
                                        value=""
                                        onChange={(itemId) => itemId && addVariante(u.id, itemId)}
                                        placeholder="+ Adicionar cor (variante)…"
                                        className="max-w-xs text-xs"
                                      >
                                        {itensDispo.map((it: any) => {
                                          const disp = metragemDisponivel(
                                            it.artigo?.unidade_medida ?? null,
                                            Number(it.quantidade_pedida) || 0,
                                            Number(it.artigo?.rendimento) || 0
                                          );
                                          const artNome = it.artigo?.nome ?? "";
                                          const varLabel = labelVarianteRow(it.variante);
                                          const label = [artNome, varLabel].filter(Boolean).join(" · ");
                                          return (
                                            <SelectItem key={it.id} value={it.id}>
                                              {label} — {fmt2(disp)} m
                                            </SelectItem>
                                          );
                                        })}
                                      </Sel>
                                    )}

                                    {itensDispo.length === 0 && u.variantes.length === 0 && (
                                      <p className="text-xs text-muted-foreground">
                                        Esta OC não tem itens cadastrados.
                                      </p>
                                    )}
                                  </div>
                                )}

                                {/* ── Linhas — cada linha colapsável ── */}
                                {u.linhas.map((l) => {
                                  const demL = demandaLinha(l.profCor, 1, l.modelos.map((m) => m.consumo));
                                  const consumoPrimeiro = l.modelos[0]?.consumo ?? 0;

                                  return (
                                    <Collapsible key={l.id} defaultOpen className="group/linha">
                                      <div className="border-l pl-3 space-y-2">
                                        {/* Header da linha */}
                                        <CollapsibleTrigger asChild>
                                          <button className="w-full flex flex-wrap items-center gap-2 text-sm text-left min-h-[44px] hover:text-foreground/80 transition-colors">
                                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/linha:rotate-90" />
                                            {tipo === "poder_venda" && l.linhaId ? (
                                              <span className="font-medium">{nomeLinha(l.linhaId)}</span>
                                            ) : (
                                              <span className="font-medium text-muted-foreground">Modelos</span>
                                            )}
                                            <span className="text-xs text-muted-foreground">
                                              prof/cor: <b>{l.profCor}</b>
                                            </span>
                                            <span className="text-xs text-muted-foreground tabular-nums">
                                              dem: <b>{fmt2(demL)} m</b>
                                            </span>
                                          </button>
                                        </CollapsibleTrigger>

                                        <CollapsibleContent>
                                          <div className="space-y-2">
                                            {/* Controles de linha */}
                                            <div className="flex flex-wrap items-center gap-2 text-sm">
                                              <Lbl t="prof/cor">
                                                <Input
                                                  className="h-7 w-14 px-1 tabular-nums"
                                                  inputMode="numeric"
                                                  value={l.profCor}
                                                  onChange={(e) =>
                                                    patchLinha(u.id, l.id, { profCor: Math.max(0, Math.round(num(e.target.value))) })
                                                  }
                                                />
                                              </Lbl>

                                              {/* cores = derivado (leitura) — Step 7 */}
                                              <span className="text-xs text-muted-foreground">
                                                cores: <b>{u.variantes.length}</b>
                                              </span>

                                              <span className="text-xs text-muted-foreground tabular-nums">
                                                demanda/cor: <b>{fmt2(demL)} m</b>
                                              </span>

                                              {l.modelos.length > 1 && (
                                                <Button
                                                  variant="outline" size="sm" className="h-7 text-xs"
                                                  onClick={() => aplicarConsumoTodos(u.id, l.id, consumoPrimeiro)}
                                                  title="Aplica o consumo do 1º modelo a todos os modelos desta linha"
                                                >
                                                  Aplicar a todos
                                                </Button>
                                              )}

                                              <Button
                                                variant="outline" size="sm" className="h-7 text-xs"
                                                onClick={() => addModelo(u.id, l.id)}
                                              >
                                                <Plus className="h-3.5 w-3.5 mr-0.5" /> Modelo
                                              </Button>
                                            </div>

                                            {/* Mini cards por modelo (Step 8) */}
                                            <div className="space-y-2">
                                              {l.modelos.map((m, idx) => {
                                                const label = m.ref ?? m.nome ?? `Modelo ${idx + 1}`;
                                                const contribuicaoPorCor = l.profCor * m.consumo;

                                                return (
                                                  <div key={m.id} className="rounded-md border bg-muted/10 p-2">
                                                    <div className="flex gap-3">
                                                      {/* Foto grande à esquerda */}
                                                      <ModeloThumb path={m.foto} alt={label} className="h-20 w-20 md:h-24 md:w-24" iconClassName="h-6 w-6 text-muted-foreground" />
                                                      {/* Infos à direita da foto */}
                                                      <div className="min-w-0 flex-1 space-y-1.5">
                                                        <span className="block text-xs font-medium truncate" title={label}>
                                                          {label}
                                                        </span>

                                                    {/* Lista de cores com peças por cor */}
                                                    {u.variantes.length > 0 ? (
                                                      <>
                                                        {/* Desktop: grid com cabeçalho e alças arrastáveis */}
                                                        <div className="hidden md:block pl-1">
                                                          {/* Cabeçalho */}
                                                          <div
                                                            className="grid items-center text-[10px] uppercase text-muted-foreground select-none"
                                                            style={{ gridTemplateColumns: `minmax(0,1fr) 6px ${corCols.pecas}px 6px ${corCols.metragem}px` }}
                                                          >
                                                            <span className="truncate">Cor</span>
                                                            <div
                                                              className="cursor-col-resize hover:bg-primary/40 bg-transparent rounded transition-colors self-stretch"
                                                              onPointerDown={startDragPecas}
                                                            />
                                                            <span className="text-right pr-0.5">Peças</span>
                                                            <div
                                                              className="cursor-col-resize hover:bg-primary/40 bg-transparent rounded transition-colors self-stretch"
                                                              onPointerDown={startDragMetragem}
                                                            />
                                                            <span className="text-right pr-0.5">Metragem</span>
                                                          </div>
                                                          {/* Linhas de cor */}
                                                          <div className="divide-y divide-border/60">
                                                            {u.variantes.map((v) => (
                                                              <div
                                                                key={v.ocItemId}
                                                                className="grid items-center py-1 text-xs text-muted-foreground"
                                                                style={{ gridTemplateColumns: `minmax(0,1fr) 6px ${corCols.pecas}px 6px ${corCols.metragem}px` }}
                                                              >
                                                                <span
                                                                  className="min-w-0 whitespace-normal"
                                                                  title={varianteLabelDe(u.ocId, v.ocItemId)}
                                                                >
                                                                  {varianteLabelDe(u.ocId, v.ocItemId)}
                                                                </span>
                                                                <span />
                                                                <span className="tabular-nums text-right text-foreground font-medium pr-0.5">
                                                                  {l.profCor}
                                                                </span>
                                                                <span />
                                                                <span className="tabular-nums text-right text-foreground font-medium pr-0.5">
                                                                  {m.consumo > 0 ? fmt2(l.profCor * m.consumo) : "—"}
                                                                </span>
                                                              </div>
                                                            ))}
                                                          </div>
                                                        </div>
                                                        {/* Mobile: lista simples (layout original) */}
                                                        <div className="md:hidden divide-y divide-border/60 pl-1">
                                                          {u.variantes.map((v) => (
                                                            <div key={v.ocItemId} className="flex items-center justify-between gap-3 py-1 text-xs text-muted-foreground">
                                                              <span className="min-w-0 truncate" title={varianteLabelDe(u.ocId, v.ocItemId)}>
                                                                {varianteLabelDe(u.ocId, v.ocItemId)}
                                                              </span>
                                                              <span className="tabular-nums shrink-0 text-right whitespace-nowrap">
                                                                <b className="text-foreground">{l.profCor}</b> pç
                                                                {m.consumo > 0 && <> · <b className="text-foreground">{fmt2(l.profCor * m.consumo)}</b> m</>}
                                                              </span>
                                                            </div>
                                                          ))}
                                                        </div>
                                                      </>
                                                    ) : (
                                                      <p className="text-xs text-muted-foreground pl-1 italic">
                                                        Escolha as cores acima
                                                      </p>
                                                    )}

                                                    {/* Consumo (vale p/ todas as cores) */}
                                                    <div className="flex items-center gap-2 pl-1">
                                                      <Lbl t="m/pç">
                                                        <ConsumoInput
                                                          value={m.consumo}
                                                          onCommit={(v) => patchModelo(u.id, l.id, m.id, { consumo: v })}
                                                        />
                                                      </Lbl>
                                                      {m.consumo > 0 && (
                                                        <span className="text-xs text-muted-foreground tabular-nums">
                                                          = {fmt2(contribuicaoPorCor)} m/cor
                                                        </span>
                                                      )}
                                                        </div>
                                                      </div>
                                                    </div>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        </CollapsibleContent>
                                      </div>
                                    </Collapsible>
                                  );
                                })}


                                {/* ── Botão Aplicar no card ── */}
                                <div className="flex justify-end pt-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={dirty || !u.dbId || aplicar.isPending}
                                    title={dirty ? "Salve o cenário antes de aplicar" : !u.dbId ? "Salve o cenário antes de aplicar" : "Aplicar profundidade, cores e nº de modelos no plano da coleção"}
                                    onClick={() => setConfirmAplicar({ unidadeId: u.dbId!, nome: u.nomeUnidade })}
                                  >
                                    <Send className="h-3.5 w-3.5 mr-1" />
                                    Aplicar no plano
                                  </Button>
                                </div>
                              </div>
                            </CollapsibleContent>
                          </Card>
                        </Collapsible>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── Alça de redimensionamento (desktop-only) ── */}
              {temSel && (
                <div
                  className="hidden md:flex md:w-1.5 shrink-0 cursor-col-resize bg-border hover:bg-primary/40 transition-colors md:sticky md:top-0 md:self-stretch"
                  onPointerDown={startDragResumo}
                  title="Arrastar para redimensionar"
                />
              )}

              {/* ── Coluna direita: Resumo de OC (desktop: sticky, scroll próprio) ── */}
              {temSel && (
                <div
                  className="hidden md:block md:shrink-0 md:sticky md:top-0 md:self-start md:max-h-[calc(100vh-8rem)] md:overflow-y-auto p-4 border-l"
                  style={{ width: resumoWidth }}
                >
                  <p className="text-xs font-semibold text-muted-foreground mb-3">
                    Resumo de OC <span className="font-normal">(uso somado entre subcoleções)</span>
                  </p>
                  <ResumoOC resumo={resumo} varianteLabelDe={varianteLabelDe} />
                </div>
              )}

            </div>
          </div>

          {/* ── Footer ── */}
          <div className="p-4 border-t shrink-0 flex justify-end gap-2">
            <Button
              variant="outline" onClick={onClose}
              className="mr-auto shrink-0 max-sm:aspect-square max-sm:px-0"
              aria-label="Voltar"
            >
              <ArrowLeft className="h-4 w-4 sm:mr-1" />
              <span className="max-sm:sr-only">Voltar</span>
            </Button>
            <Button
              onClick={() => salvar.mutate()}
              disabled={!temSel || !dirty || salvar.isPending}
              className="shrink-0 max-sm:aspect-square max-sm:px-0"
              aria-label="Salvar"
            >
              <Save className="h-4 w-4 sm:mr-1" />
              <span className="max-sm:sr-only">
                {dirty ? (salvar.isPending ? "Salvando…" : "Salvar") : "Salvo"}
              </span>
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* AlertDialog de confirmação de exclusão */}
      <AlertDialog open={!!confirmExcluir} onOpenChange={(o) => !o && setConfirmExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cenário?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmExcluir && excluir.mutate(confirmExcluir)}
              disabled={excluir.isPending}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog de confirmação de aplicação no card */}
      <AlertDialog open={!!confirmAplicar} onOpenChange={(o) => !o && setConfirmAplicar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar no plano da coleção?</AlertDialogTitle>
            <AlertDialogDescription>
              Isto grava <b>profundidade, cores e nº de modelos</b> desta unidade no <b>plano</b> da
              coleção (os números de <em>Poder de Venda</em> / <em>Orçamento</em>). Não cria nem altera
              cards do Planejamento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmAplicar && aplicar.mutate(confirmAplicar.unidadeId)}
              disabled={aplicar.isPending}
            >
              Aplicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
