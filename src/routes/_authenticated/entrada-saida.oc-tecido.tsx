import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Scissors, Plus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { OcTecidoList } from "@/components/oc-tecido/OcTecidoList";
import { FilterButton } from "@/components/shared/filters";
import { OcTecidoForm } from "@/components/oc-tecido/OcTecidoForm";
import { OcTecidoRecebimento } from "@/components/oc-tecido/OcTecidoRecebimento";
import {
  emptyDraft, uploadFile,
  type Artigo, type Colab, type Draft, type Empresa, type ItemDraft,
  type OC, type OCItem, type OCStatus, type Variante,
} from "@/components/oc-tecido/shared";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/entrada-saida/oc-tecido")({
  component: () => (
    <RequirePermission page="entrada_oc_tecido">
      <OcTecidoPage />
    </RequirePermission>
  ),
});

function OcTecidoPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<OCStatus>("encomendado");
  const [filterEmpresa, setFilterEmpresa] = useState<string>("all");
  const [filterResp, setFilterResp] = useState<string>("all");
  const [openNew, setOpenNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: ocs = [] } = useQuery({
    queryKey: ["ocs_tecido", tab, filterEmpresa, filterResp],
    queryFn: async () => {
      let q = supabase.from("ocs_tecido").select("*").eq("status", tab).order("created_at", { ascending: false });
      if (filterEmpresa !== "all") q = q.eq("empresa_id", filterEmpresa);
      if (filterResp !== "all") q = q.eq("responsavel_id", filterResp);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as OC[];
    },
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-options", "tecido-forro-entretela"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("id, nome_fantasia, empresa_categorias_fornecedor!inner(categorias_fornecedor!inner(nome))")
        .in("empresa_categorias_fornecedor.categorias_fornecedor.nome", ["Tecido", "Forro", "Entretela"])
        .order("nome_fantasia");
      if (error) throw error;
      const seen = new Set<string>();
      const out: Empresa[] = [];
      for (const e of (data ?? []) as Array<{ id: string; nome_fantasia: string }>) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        out.push({ id: e.id, nome_fantasia: e.nome_fantasia });
      }
      return out;
    },
  });

  const { data: estilistas = [] } = useQuery({
    queryKey: ["colab-estilistas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colaboradores").select("id, nome, tipo").eq("tipo", "estilista").order("nome");
      if (error) throw error;
      return (data ?? []) as Colab[];
    },
  });

  const empresaMap = useMemo(() => Object.fromEntries(empresas.map((e) => [e.id, e.nome_fantasia])), [empresas]);

  const ocIds = useMemo(() => ocs.map((o) => o.id), [ocs]);
  const { data: qtdRecebidaByOc = {} } = useQuery({
    queryKey: ["ocs_tecido_qtd_recebida", ocIds],
    enabled: tab === "recebido" && ocIds.length > 0,
    queryFn: async () => {
      const { data: items, error } = await supabase
        .from("ocs_tecido_itens")
        .select("oc_tecido_id, artigo_id, quantidade_recebida")
        .in("oc_tecido_id", ocIds);
      if (error) throw error;
      const artIds = Array.from(new Set((items ?? []).map((i) => i.artigo_id).filter(Boolean))) as string[];
      const artRes = artIds.length
        ? await supabase.from("artigos").select("id, unidade_medida").in("id", artIds)
        : { data: [] as { id: string; unidade_medida: string | null }[], error: null };
      if (artRes.error) throw artRes.error;
      const unidadeById = Object.fromEntries((artRes.data ?? []).map((a) => [a.id, a.unidade_medida ?? ""]));
      const sums: Record<string, Record<string, number>> = {};
      for (const it of items ?? []) {
        if (!it.oc_tecido_id || it.quantidade_recebida == null) continue;
        const unidade = (it.artigo_id ? unidadeById[it.artigo_id] : "") || "—";
        const sufixo = unidade === "kg" ? "kg" : unidade === "metro" ? "m" : "";
        const key = sufixo || "—";
        sums[it.oc_tecido_id] ||= {};
        sums[it.oc_tecido_id][key] = (sums[it.oc_tecido_id][key] ?? 0) + Number(it.quantidade_recebida ?? 0);
      }
      const out: Record<string, string> = {};
      for (const [ocId, parts] of Object.entries(sums)) {
        out[ocId] = Object.entries(parts)
          .map(([u, v]) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}${u !== "—" ? ` ${u}` : ""}`)
          .join(" + ");
      }
      return out;
    },
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Scissors className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">OC de Tecido</h1>
            <p className="text-sm text-muted-foreground mt-1">Ordens de compra de tecidos.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <FilterButton
            filters={[
              { label: "Fornecedor", value: filterEmpresa, onChange: setFilterEmpresa, options: [{ id: "all", nome: "Todos" }, ...empresas.map((e) => ({ id: e.id, nome: e.nome_fantasia }))] },
              ...(tab === "encomendado"
                ? [{ label: "Responsável", value: filterResp, onChange: setFilterResp, options: [{ id: "all", nome: "Todos" }, ...estilistas.map((e) => ({ id: e.id, nome: e.nome }))] }]
                : []),
            ]}
          />
          <Button onClick={() => { setEditingId(null); setOpenNew(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Nova OC
          </Button>
        </div>
      </header>

      <OcTecidoList
        tab={tab}
        setTab={setTab}
        filterEmpresa={filterEmpresa}
        setFilterEmpresa={setFilterEmpresa}
        filterResp={filterResp}
        setFilterResp={setFilterResp}
        empresas={empresas}
        estilistas={estilistas}
        ocs={ocs}
        empresaMap={empresaMap}
        onRowClick={(id) => { setEditingId(id); setOpenNew(true); }}
        qtdRecebidaByOc={qtdRecebidaByOc}
      />

      {openNew && (
        <OcDialog
          ocId={editingId}
          empresas={empresas}
          estilistas={estilistas}
          onClose={() => { setOpenNew(false); setEditingId(null); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["ocs_tecido"] }); }}
        />
      )}
    </div>
  );
}

function OcDialog({
  ocId, empresas, estilistas, onClose, onSaved,
}: {
  ocId: string | null;
  empresas: Empresa[];
  estilistas: Colab[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!ocId;
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [originalItemIds, setOriginalItemIds] = useState<string[]>([]);
  const [status, setStatus] = useState<OCStatus>("encomendado");
  const [respMode, setRespMode] = useState<"select" | "text">("select");
  const [tecido2Aberto, setTecido2Aberto] = useState(false);

  useQuery({
    queryKey: ["oc-tecido", ocId],
    enabled: !!ocId,
    queryFn: async () => {
      if (!ocId) return null;
      const { data: oc, error: e1 } = await supabase.from("ocs_tecido").select("*").eq("id", ocId).maybeSingle();
      if (e1) throw e1;
      const { data: its, error: e2 } = await supabase.from("ocs_tecido_itens").select("*").eq("oc_tecido_id", ocId);
      if (e2) throw e2;
      if (oc) {
        setDraft({
          numero_pedido: oc.numero_pedido ?? "",
          responsavel_id: oc.responsavel_id,
          responsavel_nome: oc.responsavel_nome ?? "",
          empresa_id: oc.empresa_id,
          data_pedido: oc.data_pedido ?? "",
          data_prevista_entrega: oc.data_prevista_entrega ?? "",
          prazo_pagamento: oc.prazo_pagamento ?? "",
          quantidade_prazos: oc.quantidade_prazos ?? 1,
          observacoes_entrega: oc.observacoes_entrega ?? "",
          observacoes_defeitos: oc.observacoes_defeitos ?? "",
          data_entrega: oc.data_entrega ?? "",
          anexo_pedido_url: oc.anexo_pedido_url,
          modelo_sugerido_url: oc.modelo_sugerido_url,
          nf_url: oc.nf_url,
          parcelas_recebimento: Array.isArray((oc as any).parcelas_recebimento)
            ? ((oc as any).parcelas_recebimento as { data: string; recebido: boolean }[])
            : [],
        });
        setStatus((oc.status as OCStatus) ?? "encomendado");
        setRespMode(oc.responsavel_id ? "select" : "text");
      }
      const mapped: ItemDraft[] = (its ?? []).map((i: OCItem) => ({
        tempId: i.id,
        id: i.id,
        artigo_numero: (i.artigo_numero === 2 ? 2 : 1) as 1 | 2,
        artigo_id: i.artigo_id,
        variante_tecido_id: i.variante_tecido_id ?? "",
        quantidade_pedida: Number(i.quantidade_pedida ?? 0),
        quantidade_recebida: i.quantidade_recebida == null ? null : Number(i.quantidade_recebida),
      }));
      setItems(mapped);
      setOriginalItemIds(mapped.map((m) => m.id).filter((x): x is string => !!x));
      if (mapped.some((m) => m.artigo_numero === 2)) setTecido2Aberto(true);
      return oc;
    },
  });

  const { data: artigos = [] } = useQuery({
    queryKey: ["artigos-by-empresa", draft.empresa_id],
    queryFn: async () => {
      let q = supabase.from("artigos").select("id, nome, empresa_id, preco, rendimento, unidade_medida").order("nome");
      if (draft.empresa_id) q = q.eq("empresa_id", draft.empresa_id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Artigo[];
    },
  });
  const artigoMap = useMemo(() => Object.fromEntries(artigos.map((a) => [a.id, a])), [artigos]);

  const artigoIds = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => i.artigo_id && s.add(i.artigo_id));
    return Array.from(s);
  }, [items]);

  const { data: variantes = [] } = useQuery({
    queryKey: ["variantes-by-artigos", artigoIds],
    enabled: artigoIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido")
        .select("id, artigo_id, nome_variante, codigo_variante")
        .in("artigo_id", artigoIds);
      if (error) throw error;
      return (data ?? []) as Variante[];
    },
  });
  const variantesByArtigo = useMemo(() => {
    const m: Record<string, Variante[]> = {};
    variantes.forEach((v) => { (m[v.artigo_id] ||= []).push(v); });
    return m;
  }, [variantes]);
  const varianteMap = useMemo(() => Object.fromEntries(variantes.map((v) => [v.id, v])), [variantes]);

  const itemsBy = (n: 1 | 2) => items.filter((i) => i.artigo_numero === n);
  const artigoIdFor = (n: 1 | 2) => itemsBy(n)[0]?.artigo_id ?? null;

  const setArtigo = (n: 1 | 2, artigoId: string) => {
    setItems((prev) => [
      ...prev.filter((i) => i.artigo_numero !== n),
      {
        tempId: crypto.randomUUID(),
        artigo_numero: n,
        artigo_id: artigoId,
        variante_tecido_id: "",
        quantidade_pedida: 0,
        quantidade_recebida: null,
      },
    ]);
  };

  const toggleVariante = (n: 1 | 2, varId: string, checked: boolean) => {
    const artigoId = artigoIdFor(n);
    if (!artigoId) return;
    setItems((prev) => {
      // Lista ordenada das variantes selecionadas para este tecido
      const selected = prev.filter((i) => i.artigo_numero === n && i.variante_tecido_id);
      const others = prev.filter((i) => i.artigo_numero !== n || !i.variante_tecido_id);
      if (!checked) {
        // Remover essa variante e todas as subsequentes (cascade)
        const idx = selected.findIndex((i) => i.variante_tecido_id === varId);
        if (idx < 0) return prev;
        const kept = selected.slice(0, idx);
        return [...others, ...kept];
      }
      if (selected.some((i) => i.variante_tecido_id === varId)) return prev;
      if (selected.length >= 10) { toast.error("Limite de 10 variantes por tecido"); return prev; }
      return [
        ...others,
        ...selected,
        {
          tempId: crypto.randomUUID(),
          artigo_numero: n,
          artigo_id: artigoId,
          variante_tecido_id: varId,
          quantidade_pedida: 0,
          quantidade_recebida: null,
        },
      ];
    });
  };

  const setQtd = (tempId: string, field: "quantidade_pedida" | "quantidade_recebida", v: number) => {
    setItems((prev) => prev.map((i) => i.tempId === tempId ? { ...i, [field]: v } : i));
  };

  const valorPrev = (it: ItemDraft) => {
    const a = it.artigo_id ? artigoMap[it.artigo_id] : null;
    return (a?.preco ?? 0) * it.quantidade_pedida;
  };
  const valorReal = (it: ItemDraft) => {
    const a = it.artigo_id ? artigoMap[it.artigo_id] : null;
    return (a?.preco ?? 0) * (it.quantidade_recebida ?? 0);
  };
  const totalPrevisto = items.reduce((s, i) => s + valorPrev(i), 0);
  const totalReal = items.reduce((s, i) => s + valorReal(i), 0);

  const handleSingleUpload = async (file: File, key: keyof Draft) => {
    try {
      const path = await uploadFile(file, key as string);
      setDraft((d) => ({ ...d, [key]: path }));
      toast.success("Arquivo enviado");
    } catch (e: any) { toast.error(e.message); }
  };

  const saveMutation = useMutation({
    mutationFn: async (markReceived: boolean) => {
      const parcelas = draft.parcelas_recebimento ?? [];
      const lastDate = parcelas.length > 0
        ? [...parcelas].map((p) => p.data).filter(Boolean).sort().slice(-1)[0] ?? draft.data_entrega
        : draft.data_entrega;
      const payload: any = {
        numero_pedido: draft.numero_pedido || null,
        responsavel_id: respMode === "select" ? draft.responsavel_id : null,
        responsavel_nome: respMode === "text" ? (draft.responsavel_nome || null) : null,
        empresa_id: draft.empresa_id,
        data_pedido: draft.data_pedido || null,
        data_prevista_entrega: draft.data_prevista_entrega || null,
        prazo_pagamento: draft.prazo_pagamento || null,
        quantidade_prazos: draft.quantidade_prazos,
        observacoes_entrega: draft.observacoes_entrega || null,
        observacoes_defeitos: draft.observacoes_defeitos || null,
        anexo_pedido_url: draft.anexo_pedido_url,
        modelo_sugerido_url: draft.modelo_sugerido_url,
        nf_url: draft.nf_url,
        data_entrega: markReceived ? (lastDate || null) : (draft.data_entrega || null),
        parcelas_recebimento: parcelas,
        valor_previsto_total: totalPrevisto,
        valor_real_total: totalReal,
        status: markReceived ? "recebido" : status,
      };

      // CRITICAL: salvar itens ANTES de atualizar o status para 'recebido',
      // pois o trigger gerar_parcelas_oc_tecido depende de valor_real_total/itens
      // no momento do UPDATE e tem proteção anti-duplicação.
      let ocIdLocal = ocId;
      const finalStatus: OCStatus = markReceived ? "recebido" : status;
      const validItems = items.filter((i) => i.variante_tecido_id && i.artigo_id);

      if (isEdit && ocIdLocal) {
        // Diff: UPDATE (com id), INSERT (sem id), DELETE só dos removidos.
        const currentIds = new Set(
          validItems.map((i) => i.id).filter((x): x is string => !!x),
        );
        const toDelete = originalItemIds.filter((id) => !currentIds.has(id));
        const toUpdate = validItems.filter((i) => i.id);
        const toInsert = validItems.filter((i) => !i.id);

        if (toDelete.length > 0) {
          const { error } = await supabase
            .from("ocs_tecido_itens").delete().in("id", toDelete);
          if (error) throw error;
        }
        for (const it of toUpdate) {
          const { error } = await supabase
            .from("ocs_tecido_itens")
            .update({
              artigo_id: it.artigo_id,
              artigo_numero: it.artigo_numero,
              variante_tecido_id: it.variante_tecido_id,
              quantidade_pedida: it.quantidade_pedida,
              quantidade_recebida: it.quantidade_recebida,
            })
            .eq("id", it.id!);
          if (error) throw error;
        }
        if (toInsert.length > 0) {
          const { error } = await supabase
            .from("ocs_tecido_itens")
            .insert(toInsert.map((i) => ({
              oc_tecido_id: ocIdLocal,
              artigo_id: i.artigo_id,
              artigo_numero: i.artigo_numero,
              variante_tecido_id: i.variante_tecido_id,
              quantidade_pedida: i.quantidade_pedida,
              quantidade_recebida: i.quantidade_recebida,
            })));
          if (error) throw error;
        }

        // 2) Depois UPDATE da OC (dispara o trigger já com itens/valor corretos)
        const { error } = await supabase.from("ocs_tecido").update(payload).eq("id", ocIdLocal);
        if (error) throw error;
      } else {
        // INSERT: forçar 'encomendado' para não disparar trigger; inserir itens;
        // se necessário, atualizar para 'recebido' depois.
        const insertPayload = { ...payload, status: "encomendado" };
        const { data, error } = await supabase.from("ocs_tecido").insert(insertPayload).select("id").single();
        if (error) throw error;
        ocIdLocal = data.id;

        if (validItems.length > 0) {
          const { error: itErr } = await supabase
            .from("ocs_tecido_itens")
            .insert(validItems.map((i) => ({
              oc_tecido_id: ocIdLocal,
              artigo_id: i.artigo_id,
              artigo_numero: i.artigo_numero,
              variante_tecido_id: i.variante_tecido_id,
              quantidade_pedida: i.quantidade_pedida,
              quantidade_recebida: i.quantidade_recebida,
            })));
          if (itErr) throw itErr;
        }

        if (finalStatus === "recebido") {
          const { error: upErr } = await supabase
            .from("ocs_tecido")
            .update({ status: "recebido" })
            .eq("id", ocIdLocal);
          if (upErr) throw upErr;
        }
      }
    },
    onSuccess: () => {
      toast.success("OC salva");
      qc.invalidateQueries({ queryKey: ["ocs_tecido"] });
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  const canShowRecebimento = isEdit && (status === "encomendado" || status === "recebido");
  const isReadOnlyRecebimento = isEdit && status === "recebido";
  const artigoIdsForEtiqueta = useMemo(
    () => [artigoIdFor(1), artigoIdFor(2)].filter((x): x is string => !!x),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items],
  );
  const { data: etiquetasByArtigo = {} } = useQuery({
    queryKey: ["artigos-etiquetas", artigoIdsForEtiqueta],
    enabled: artigoIdsForEtiqueta.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigos")
        .select("id, etiqueta_lavagem_urls")
        .in("id", artigoIdsForEtiqueta);
      if (error) throw error;
      const m: Record<string, string[]> = {};
      for (const r of (data ?? []) as Array<{ id: string; etiqueta_lavagem_urls: string[] | null }>) {
        m[r.id] = r.etiqueta_lavagem_urls ?? [];
      }
      return m;
    },
  });

  const getMissingRequirements = (): string[] => {
    const missing: string[] = [];
    if (!algumaQtdRecebida) missing.push("Preencha a quantidade recebida de pelo menos uma variante.");
    const parcelas = draft.parcelas_recebimento ?? [];
    if (parcelas.length === 0) {
      missing.push("Defina a quantidade de parcelas de recebimento.");
    } else {
      if (!parcelas.every((p) => !!p.data)) missing.push("Preencha as datas de todas as parcelas de recebimento.");
      if (!parcelas.every((p) => p.recebido === true)) missing.push("Marque todas as parcelas como recebidas.");
    }
    if (!todasEtiquetasOk) missing.push("Anexe a etiqueta de lavagem de todos os artigos.");
    if (!draft.nf_url) missing.push("Anexe a nota fiscal (NF).");
    return missing;
  };

  const handleMarkReceived = () => {
    if (!canMarkReceived) {
      const missing = getMissingRequirements();
      toast.error("Não é possível marcar como recebido:", {
        description: missing.join(" "),
      });
      return;
    }
    saveMutation.mutate(true);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `OC ${draft.numero_pedido || ""}` : "Nova OC de Tecido"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <OcTecidoForm
            draft={draft}
            setDraft={setDraft}
            respMode={respMode}
            setRespMode={setRespMode}
            empresas={empresas}
            estilistas={estilistas}
            artigos={artigos}
            variantesByArtigo={variantesByArtigo}
            varianteMap={varianteMap}
            itemsBy={itemsBy}
            artigoIdFor={artigoIdFor}
            setArtigo={setArtigo}
            toggleVariante={toggleVariante}
            setQtd={setQtd}
            tecido2Aberto={tecido2Aberto}
            setTecido2Aberto={setTecido2Aberto}
            removeTecido2={() => {
              setItems((p) => p.filter((i) => i.artigo_numero !== 2));
              setTecido2Aberto(false);
            }}
            handleSingleUpload={handleSingleUpload}
          />

          {canShowRecebimento && (
            <OcTecidoRecebimento
              draft={draft}
              setDraft={setDraft}
              handleSingleUpload={handleSingleUpload}
              items={items}
              artigoMap={artigoMap}
              varianteMap={varianteMap}
              setQtd={setQtd}
              totalPrevisto={totalPrevisto}
              totalReal={totalReal}
              tecido2Aberto={tecido2Aberto}
              artigoId1={artigoIdFor(1)}
              artigoId2={artigoIdFor(2)}
              readOnly={isReadOnlyRecebimento}
            />
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          {canShowRecebimento && (
            <Button variant="secondary" onClick={() => saveMutation.mutate(true)} disabled={saveMutation.isPending || !canMarkReceived}>
              Marcar como Recebido
            </Button>
          )}
          <Button onClick={() => saveMutation.mutate(false)} disabled={saveMutation.isPending}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
