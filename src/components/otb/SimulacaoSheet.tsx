import { useEffect, useState } from "react";
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
import { Plus, Trash2, Pencil, Save, ArrowLeft, ImageOff, Send } from "lucide-react";
import { metragemDisponivel, demandaLinha, saldo } from "@/lib/simulacao";

/**
 * Simulador de uso de OC — cenários + árvore Unidade/Linha/Modelo + resultado.
 * Sem write-back (Task 9). Footer: Voltar + Salvar.
 */

// ─── Tipos do estado local ────────────────────────────────────────────────────

type ModeloSim = {
  id: string;
  modeloId: string | null;
  consumo: number;
  ref?: string | null;
  nome?: string | null;
  foto?: string | null;
};
type LinhaSim = { id: string; linhaId: string | null; profCor: number; cores: number; modelos: ModeloSim[] };
type UnidadeSim = {
  id: string;
  dbId?: string;
  subcolecaoId: string | null;
  nomeUnidade: string;
  ocItemId: string | null;
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

function ModeloThumb({ path, alt }: { path: string | null | undefined; alt: string }) {
  const url = useSignedUrl(path ?? null, "modelos");
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/40">
      {url
        ? <img src={url} alt={alt} className="h-full w-full object-cover" />
        : <ImageOff className="h-3.5 w-3.5 text-muted-foreground" />}
    </div>
  );
}

// ─── Formatação ───────────────────────────────────────────────────────────────

const fmt2 = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
        .select("id, nome, unidades:otb_simulacao_unidades(id, subcolecao_id, oc_tecido_item_id, linhas:otb_simulacao_linhas(id, linha_id, prof_cor, cores, num_modelos, ordem, modelos:otb_simulacao_modelos(id, modelo_id, slot_index, consumo)))")
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

  const { data: ocs = [] } = useQuery({
    queryKey: ["otb-sim-ocs"],
    queryFn: async () =>
      (await supabase.from("ocs_tecido" as any)
        .select("id, numero_pedido, itens:ocs_tecido_itens(id, artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida, artigo:artigos(nome, unidade_medida, rendimento))")
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
  // OC selecionada por unidade (estado de UI, antes de escolher o item)
  const [ocPorUnidade, setOcPorUnidade] = useState<Record<string, string>>({});

  // ── Helpers de nomeação ────────────────────────────────────────────────────

  const nomeUnidadeDe = (subcolecaoId: string | null): string => {
    if (!plano) return "Subcoleção";
    const sub = (plano.subcolecoes ?? []).find((x: any) => x.id === subcolecaoId);
    return sub?.nome ?? "Coleção";
  };

  // ── Semear a árvore a partir do plano ──────────────────────────────────────

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
            cores: Number(it.cores) || 0,
            modelos,
          };
        });
        return { id: nid("u"), subcolecaoId: sc.id, nomeUnidade: sc.nome, ocItemId: null, linhas };
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
        ocItemId: null,
        linhas: [{ id: nid("l"), linhaId: null, profCor: 1, cores: 1, modelos }],
      };
    });
  };

  // ── mapCenarioFromDb ──────────────────────────────────────────────────────

  const mapCenarioFromDb = (row: any): Cenario => ({
    id: row.id,
    nome: row.nome,
    unidades: [...(row.unidades ?? [])].map((u: any) => ({
      id: nid("u"),
      dbId: u.id,
      subcolecaoId: u.subcolecao_id ?? null,
      nomeUnidade: nomeUnidadeDe(u.subcolecao_id),
      ocItemId: u.oc_tecido_item_id ?? null,
      linhas: [...(u.linhas ?? [])]
        .sort((a: any, b: any) => (a.ordem ?? 0) - (b.ordem ?? 0))
        .map((l: any) => ({
          id: nid("l"),
          linhaId: l.linha_id ?? null,
          profCor: Number(l.prof_cor) || 0,
          cores: Number(l.cores) || 0,
          modelos: [...(l.modelos ?? [])]
            .sort((a: any, b: any) => (a.slot_index ?? 0) - (b.slot_index ?? 0))
            .map((m: any) => {
              // Fix I2: enriquece com ref/nome/foto do modelo real quando disponível
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
        // Fix I1: mapCenarioFromDb primeiro para obter os ids locais frescos,
        // depois construir ocPorUnidade keyed pelo id LOCAL de cada unidade
        const cenario = mapCenarioFromDb(row);
        setDraft(cenario);
        setDraftFor(selId);
        setDirty(false);
        // inicializa o mapa OC por unidade com as OCs já vinculadas
        const ocMap: Record<string, string> = {};
        for (const u of cenario.unidades) {
          if (u.ocItemId) {
            const oc = (ocs as any[]).find((o) =>
              (o.itens ?? []).some((it: any) => it.id === u.ocItemId)
            );
            if (oc) ocMap[u.id] = oc.id;
          }
        }
        setOcPorUnidade(ocMap);
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

  const buildArvore = (d: Cenario) =>
    d.unidades.map((u) => ({
      subcolecao_id: u.subcolecaoId,
      oc_tecido_item_id: u.ocItemId,
      linhas: u.linhas.map((l) => ({
        linha_id: l.linhaId,
        prof_cor: l.profCor,
        cores: l.cores,
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
      // write-back muda prof_cor/cores/qtd_semanas → recalcula poder de venda + %/borda do card PV.
      qc.invalidateQueries({ queryKey: ["otb-pv-poder"] });
    },
    onError: (e: any) => {
      setConfirmAplicar(null);
      toast.error(mensagemErro(e, "Erro ao aplicar no card."));
    },
  });

  // ── Helpers de exibição de OC ─────────────────────────────────────────────

  const ocById = (ocId: string) => (ocs as any[]).find((o) => o.id === ocId);

  const ocDoItem = (itemId: string | null) => {
    if (!itemId) return null;
    return (ocs as any[]).find((o) => (o.itens ?? []).some((it: any) => it.id === itemId));
  };

  const getMetragem = (itemId: string | null) => {
    if (!itemId) return null;
    const oc = ocDoItem(itemId);
    const item = (oc?.itens ?? []).find((it: any) => it.id === itemId);
    if (!item) return null;
    return {
      disponivel: metragemDisponivel(
        item.artigo?.unidade_medida ?? null,
        Number(item.quantidade_pedida) || 0,
        Number(item.artigo?.rendimento) || 0
      ),
      recebida: Number(item.quantidade_recebida) || 0,
      nome: item.artigo?.nome ?? "Artigo",
    };
  };

  const temSel = !!selId && (cenariosSalvos as any[]).some((x: any) => x.id === selId);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="right" className="w-full sm:max-w-[70vw] flex flex-col p-0 max-sm:[&>button]:hidden">
          <SheetHeader className="p-4 border-b shrink-0">
            <SheetTitle className="text-base sm:text-lg">Simulador de uso de OC</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">

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

                {/* ── Unidades ── */}
                {draft.unidades.map((u) => {
                  const met = getMetragem(u.ocItemId);
                  const demandaTotal = u.linhas.reduce(
                    (s, l) => s + demandaLinha(l.profCor, l.cores, l.modelos.map((m) => m.consumo)),
                    0
                  );
                  const dispTotal = met?.disponivel ?? 0;
                  const saldoVal = saldo(dispTotal, demandaTotal);
                  const pctUso = dispTotal > 0 ? Math.min(100, (demandaTotal / dispTotal) * 100) : 0;

                  // OC selecionada para este bloco (vem do item se já vinculado, senão do seletor local)
                  const ocVinculada = u.ocItemId ? ocDoItem(u.ocItemId) : null;
                  const ocSelecionadaId = ocVinculada?.id ?? ocPorUnidade[u.id] ?? "";
                  const ocSelecionada = ocSelecionadaId ? ocById(ocSelecionadaId) : null;

                  return (
                    <Card key={u.id} className="p-4 space-y-3">
                      {/* Cabeçalho da unidade */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm">{u.nomeUnidade}</span>

                        {/* Seletor OC */}
                        <Sel
                          value={ocSelecionadaId}
                          onChange={(ocId) => {
                            // Troca de OC: limpa item vinculado
                            patchUnidade(u.id, { ocItemId: null });
                            setOcPorUnidade((prev) => ({ ...prev, [u.id]: ocId }));
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

                        {/* Seletor Item da OC */}
                        {ocSelecionada && (ocSelecionada.itens ?? []).length > 0 && (
                          <Sel
                            value={u.ocItemId ?? ""}
                            onChange={(itemId) => patchUnidade(u.id, { ocItemId: itemId })}
                            placeholder="— item —"
                            className="min-w-[12rem]"
                          >
                            {(ocSelecionada.itens ?? []).map((it: any) => {
                              const disp = metragemDisponivel(
                                it.artigo?.unidade_medida ?? null,
                                Number(it.quantidade_pedida) || 0,
                                Number(it.artigo?.rendimento) || 0
                              );
                              return (
                                <SelectItem key={it.id} value={it.id}>
                                  {it.artigo?.nome ?? "Artigo"} — {fmt2(disp)} m
                                </SelectItem>
                              );
                            })}
                          </Sel>
                        )}

                        {/* Metragem disponível / recebida */}
                        {met && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {met.nome} · disp: <b>{fmt2(met.disponivel)} m</b> · rec: {fmt2(met.recebida)} m
                          </span>
                        )}
                      </div>

                      {/* Linhas */}
                      {u.linhas.map((l) => {
                        const demL = demandaLinha(l.profCor, l.cores, l.modelos.map((m) => m.consumo));
                        const consumoPrimeiro = l.modelos[0]?.consumo ?? 0;

                        return (
                          <div key={l.id} className="space-y-2 pl-3 border-l">
                            {/* Cabeçalho da linha */}
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              {tipo === "poder_venda" && l.linhaId ? (
                                <span className="font-medium">{nomeLinha(l.linhaId)}</span>
                              ) : (
                                <span className="font-medium text-muted-foreground">Modelos</span>
                              )}

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

                              {tipo === "poder_venda" && (
                                <Lbl t="cores">
                                  <Input
                                    className="h-7 w-12 px-1 tabular-nums"
                                    inputMode="numeric"
                                    value={l.cores}
                                    onChange={(e) =>
                                      patchLinha(u.id, l.id, { cores: Math.max(0, Math.round(num(e.target.value))) })
                                    }
                                  />
                                </Lbl>
                              )}

                              <span className="text-xs text-muted-foreground tabular-nums">
                                demanda: <b>{fmt2(demL)} m</b>
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

                            {/* Modelos */}
                            <div className="space-y-1">
                              {l.modelos.map((m, idx) => {
                                const pecas = l.profCor * l.cores;
                                const label = m.ref ?? m.nome ?? `Modelo ${idx + 1}`;
                                const contribuicao = pecas * m.consumo;

                                return (
                                  <div key={m.id} className="flex flex-wrap items-center gap-2 pl-2">
                                    <ModeloThumb path={m.foto} alt={label} />
                                    <span className="text-xs w-28 truncate text-muted-foreground" title={label}>
                                      {label}
                                    </span>
                                    <span className="text-xs text-muted-foreground tabular-nums">
                                      {pecas} pç ×
                                    </span>
                                    <Lbl t="m/pç">
                                      <Input
                                        className="h-7 w-20 px-1 tabular-nums"
                                        inputMode="decimal"
                                        value={m.consumo === 0 ? "" : String(m.consumo).replace(".", ",")}
                                        placeholder="0,00"
                                        onChange={(e) =>
                                          patchModelo(u.id, l.id, m.id, { consumo: num(e.target.value) })
                                        }
                                      />
                                    </Lbl>
                                    <span className="text-xs text-muted-foreground tabular-nums">
                                      = {fmt2(contribuicao)} m
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}

                      {/* ── Resultado por unidade ── */}
                      {met && (
                        <div className="rounded-md border bg-muted/20 p-3 space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
                            <span>
                              Demanda: <b className="tabular-nums">{fmt2(demandaTotal)} m</b>
                            </span>
                            <span>
                              Disponível: <b className="tabular-nums">{fmt2(dispTotal)} m</b>
                            </span>
                            <span className={saldoVal >= 0 ? "text-green-600 font-medium" : "text-destructive font-medium"}>
                              {saldoVal >= 0
                                ? `sobram ${fmt2(saldoVal)} m`
                                : `faltam ${fmt2(Math.abs(saldoVal))} m`}
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${saldoVal >= 0 ? "bg-green-500" : "bg-destructive"}`}
                              style={{ width: `${pctUso}%` }}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground tabular-nums text-right">
                            {pctUso.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% utilizado
                          </p>
                        </div>
                      )}

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
                          Aplicar no card
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
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
            <AlertDialogTitle>Aplicar no card da coleção?</AlertDialogTitle>
            <AlertDialogDescription>
              Isto grava profundidade, cores e nº de modelos desta unidade no plano da coleção.
              Não altera os cards já criados no Planejamento.
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
