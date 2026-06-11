import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Scissors, Plus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { OcTecidoList } from "@/components/oc-tecido/OcTecidoList";
import { OcTecidoForm } from "@/components/oc-tecido/OcTecidoForm";
import { OcTecidoRecebimento } from "@/components/oc-tecido/OcTecidoRecebimento";
import {
  emptyDraft, uploadFile,
  type Artigo, type Colab, type Draft, type Empresa, type ItemDraft,
  type OC, type OCItem, type OCStatus, type Variante,
} from "@/components/oc-tecido/shared";

export const Route = createFileRoute("/_authenticated/entrada-saida/oc-tecido")({
  component: OcTecidoPage,
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
    queryKey: ["empresas-opt"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nome_fantasia").order("nome_fantasia");
      if (error) throw error;
      return (data ?? []) as Empresa[];
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
        <Button onClick={() => { setEditingId(null); setOpenNew(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Nova OC
        </Button>
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
          etiqueta_lavagem_urls: oc.etiqueta_lavagem_urls ?? [],
          etiqueta_lavagem_url_1: (oc as { etiqueta_lavagem_url_1?: string | null }).etiqueta_lavagem_url_1 ?? null,
          etiqueta_lavagem_url_2: (oc as { etiqueta_lavagem_url_2?: string | null }).etiqueta_lavagem_url_2 ?? null,
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
  const handleEtiquetaUpload = async (file: File) => {
    try {
      const path = await uploadFile(file, "etiqueta");
      setDraft((d) => ({ ...d, etiqueta_lavagem_urls: [...d.etiqueta_lavagem_urls, path].slice(0, 2) }));
      toast.success("Etiqueta enviada");
    } catch (e: any) { toast.error(e.message); }
  };

  const saveMutation = useMutation({
    mutationFn: async (markReceived: boolean) => {
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
        etiqueta_lavagem_urls: draft.etiqueta_lavagem_urls,
        etiqueta_lavagem_url_1: draft.etiqueta_lavagem_url_1,
        etiqueta_lavagem_url_2: draft.etiqueta_lavagem_url_2,
        data_entrega: draft.data_entrega || null,
        valor_previsto_total: totalPrevisto,
        valor_real_total: totalReal,
        status: markReceived ? "recebido" : status,
      };

      let ocIdLocal = ocId;
      if (isEdit && ocIdLocal) {
        const { error } = await supabase.from("ocs_tecido").update(payload).eq("id", ocIdLocal);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("ocs_tecido").insert(payload).select("id").single();
        if (error) throw error;
        ocIdLocal = data.id;
      }

      if (ocIdLocal) {
        await supabase.from("ocs_tecido_itens").delete().eq("oc_tecido_id", ocIdLocal);
        const rows = items
          .filter((i) => i.variante_tecido_id && i.artigo_id)
          .map((i) => ({
            oc_tecido_id: ocIdLocal,
            artigo_id: i.artigo_id,
            artigo_numero: i.artigo_numero,
            variante_tecido_id: i.variante_tecido_id,
            quantidade_pedida: i.quantidade_pedida,
            quantidade_recebida: i.quantidade_recebida,
          }));
        if (rows.length > 0) {
          const { error } = await supabase.from("ocs_tecido_itens").insert(rows);
          if (error) throw error;
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

  const canShowRecebimento = isEdit && status === "encomendado";
  const canMarkReceived =
    canShowRecebimento &&
    !!draft.data_entrega &&
    items.some((i) => (i.quantidade_recebida ?? 0) > 0);

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
              handleEtiquetaUpload={handleEtiquetaUpload}
              items={items}
              artigoMap={artigoMap}
              varianteMap={varianteMap}
              setQtd={setQtd}
              totalPrevisto={totalPrevisto}
              totalReal={totalReal}
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
