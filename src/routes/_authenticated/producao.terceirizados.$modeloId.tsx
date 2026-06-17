import { useEffect, useMemo, useState } from "react";
import { fmtNum } from "@/lib/format";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Users, Save, Plus, Trash2, Wrench, Printer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useReadOnly } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/producao/terceirizados/$modeloId")({
  component: TercDetailPage,
});

type Bloco = {
  id?: string;
  categoria_terceirizado_id: string;
  categoria_nome?: string;
  interno: boolean;
  terceirizado_id: string | null;
  colaborador_id: string | null;
  preco_metro_unidade: number;
  quantidade_enviada: number;
  quantidade_recebida: number;
  quantidade_defeito: number;
  data_enviado: string | null;
  data_prevista: string | null;
  data_entregue: string | null;
  status: string | null;
  observacao: string;
  aviamentos_enviados: string[];
};

const STATUS_COLORS: Record<string, string> = {
  pendente: "bg-amber-500",
  em_andamento: "bg-blue-500",
  finalizado: "bg-emerald-500",
};
const STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  finalizado: "Finalizado",
};

function TercDetailPage() {
  const { modeloId } = Route.useParams();
  const qc = useQueryClient();
  const readOnly = useReadOnly();

  const { data: modelo } = useQuery({
    queryKey: ["terc-modelo", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("id, ref, nome, colecao, categoria_principal_id")
        .eq("id", modeloId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      let categoria_nome: string | null = null;
      if (data.categoria_principal_id) {
        const { data: cat } = await supabase
          .from("categorias_produto")
          .select("nome")
          .eq("id", data.categoria_principal_id)
          .maybeSingle();
        categoria_nome = cat?.nome ?? null;
      }
      return { ...data, categoria_nome };
    },
  });

  const { data: cad } = useQuery({
    queryKey: ["terc-cad", modeloId],
    queryFn: async () => {
      const { data } = await supabase.from("cad").select("*").eq("modelo_id", modeloId).maybeSingle();
      return data;
    },
  });

  // Grade Total Geral (soma das grades do CAD) — exibida no cabeçalho.
  const { data: gradeTotalGeral = 0 } = useQuery({
    queryKey: ["terc-grade-total", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("cad_grades")
        .select("grade_total_planejada, grade_total_real")
        .eq("cad_id", cad!.id);
      return (data ?? []).reduce(
        (a: number, g: any) => a + Number(g.grade_total_real ?? g.grade_total_planejada ?? 0),
        0,
      );
    },
  });

  // Colaboradores internos (tipo='interno', cadastrados em Atributos) —
  // responsáveis quando o serviço é Interno.
  const { data: colaboradores = [] } = useQuery({
    queryKey: ["colaboradores-interno"],
    queryFn: async () => {
      const { data } = await supabase
        .from("colaboradores")
        .select("id, nome")
        .eq("tipo", "interno")
        .order("nome");
      return (data ?? []) as { id: string; nome: string }[];
    },
  });

  const { data: categorias = [], error: categoriasError, isLoading: categoriasLoading } = useQuery({
    queryKey: ["categorias_terceirizado"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_terceirizado")
        .select("id, nome")
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: terceirizados = [] } = useQuery({
    queryKey: ["terceirizados-all"],
    queryFn: async () => {
      const { data } = await supabase
        .from("terceirizados")
        .select("id, nome_responsavel, categoria_terceirizado_id, terceirizado_categorias(categoria_terceirizado_id)");
      return (data ?? []).map((t: any) => ({
        ...t,
        categorias_ids: [
          ...(Array.isArray(t.terceirizado_categorias)
            ? t.terceirizado_categorias.map((j: any) => j.categoria_terceirizado_id)
            : []),
          ...(t.categoria_terceirizado_id ? [t.categoria_terceirizado_id] : []),
        ].filter((v, i, a) => a.indexOf(v) === i),
      }));
    },
  });

  const { data: aviamentosModelo = [] } = useQuery({
    queryKey: ["modelo-aviamentos", modeloId],
    queryFn: async () => {
      const { data } = await supabase
        .from("modelo_aviamentos")
        .select("aviamento_id, aviamentos:aviamento_id(id, codigo_nome)")
        .eq("modelo_id", modeloId);
      return (data ?? []).map((r: any) => ({ id: r.aviamentos?.id, nome: r.aviamentos?.codigo_nome })).filter((x: any) => x.id);
    },
  });

  const { data: existing = [], refetch, isFetched: existingFetched, isFetching: existingFetching } = useQuery({
    queryKey: ["producao-terc", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("producao_terceirizados")
        .select("*")
        .eq("cad_id", cad!.id)
        .eq("ativo", true);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Oficina como card de serviço (1 linha por cad em producao_oficina).
  const {
    data: oficinaRow,
    refetch: refetchOficina,
    isFetched: ofFetched,
    isFetching: ofFetching,
  } = useQuery({
    queryKey: ["producao-oficina-terc", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () =>
      (await supabase.from("producao_oficina").select("*").eq("cad_id", cad!.id).maybeSingle()).data,
  });

  const [blocos, setBlocos] = useState<Bloco[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const emptyOficina = () => ({
    interno: false,
    terceirizado_id: null as string | null,
    colaborador_id: null as string | null,
    preco_por_peca: 0,
    quantidade_enviada: 0,
    quantidade_recebida: 0,
    quantidade_defeito: 0,
    data_enviado: null as string | null,
    data_prevista: null as string | null,
    data_entregue: null as string | null,
    observacao: "",
  });
  const [oficinaAtiva, setOficinaAtiva] = useState(false);
  const [oficina, setOficina] = useState(emptyOficina());
  const [observacoesMolde, setObservacoesMolde] = useState("");
  const [oficinaHydrated, setOficinaHydrated] = useState(false);

  // Hidrata a oficina + a observação de molde (que vive no cad) uma vez.
  useEffect(() => {
    if (oficinaHydrated) return;
    if (!cad?.id) return;
    if (!ofFetched || ofFetching) return;
    if (oficinaRow) {
      setOficinaAtiva(true);
      setOficina({
        interno: Boolean((oficinaRow as any).interno),
        terceirizado_id: (oficinaRow as any).terceirizado_id ?? null,
        colaborador_id: (oficinaRow as any).colaborador_id ?? null,
        preco_por_peca: Number((oficinaRow as any).preco_por_peca ?? 0),
        quantidade_enviada: Number((oficinaRow as any).quantidade_enviada ?? 0),
        quantidade_recebida: Number((oficinaRow as any).quantidade_recebida ?? 0),
        quantidade_defeito: Number((oficinaRow as any).quantidade_defeito ?? 0),
        data_enviado: (oficinaRow as any).data_enviado ?? null,
        data_prevista: (oficinaRow as any).data_prevista ?? null,
        data_entregue: (oficinaRow as any).data_entregue ?? null,
        observacao: (oficinaRow as any).observacao ?? "",
      });
    }
    setObservacoesMolde((cad as any)?.observacoes_molde ?? "");
    setOficinaHydrated(true);
  }, [oficinaRow, cad, ofFetched, ofFetching, oficinaHydrated]);

  const updateOficina = (patch: Partial<ReturnType<typeof emptyOficina>>) =>
    setOficina((o) => ({ ...o, ...patch }));

  // Hidrata os blocos a partir do servidor uma única vez (e de novo após salvar,
  // quando liberamos o guard). Espera a query ASSENTAR (isFetched && !isFetching):
  // hidratar do cache vazio enquanto o refetch ainda corria era o que zerava o
  // formulário ao salvar.
  useEffect(() => {
    if (hydrated) return;
    if (!cad?.id) return;
    if (!existingFetched || existingFetching) return;
    setBlocos(
      (existing as any[]).map((r) => ({
        id: r.id,
        categoria_terceirizado_id: r.categoria_terceirizado_id,
        interno: Boolean((r as any).interno),
        terceirizado_id: r.terceirizado_id,
        colaborador_id: (r as any).colaborador_id ?? null,
        preco_metro_unidade: Number(r.preco_metro_unidade ?? 0),
        quantidade_enviada: Number(r.quantidade_enviada ?? 0),
        quantidade_recebida: Number(r.quantidade_recebida ?? 0),
        quantidade_defeito: Number(r.quantidade_defeito ?? 0),
        data_enviado: r.data_enviado,
        data_prevista: r.data_prevista,
        data_entregue: r.data_entregue,
        status: r.status,
        observacao: r.observacao ?? "",
        aviamentos_enviados: Array.isArray(r.aviamentos_enviados) ? r.aviamentos_enviados : [],
      })),
    );
    setHydrated(true);
  }, [existing, cad?.id, hydrated, existingFetched, existingFetching]);

  const activeCategorias = new Set(blocos.map((b) => b.categoria_terceirizado_id));

  const toggleCategoria = (catId: string, catNome: string) => {
    if (activeCategorias.has(catId)) {
      setBlocos((bs) => bs.filter((b) => b.categoria_terceirizado_id !== catId));
    } else {
      setBlocos((bs) => [
        ...bs,
        {
          categoria_terceirizado_id: catId,
          categoria_nome: catNome,
          interno: false,
          terceirizado_id: null,
          colaborador_id: null,
          preco_metro_unidade: 0,
          quantidade_enviada: 0,
          quantidade_recebida: 0,
          quantidade_defeito: 0,
          data_enviado: null,
          data_prevista: null,
          data_entregue: null,
          status: "pendente",
          observacao: "",
          aviamentos_enviados: [],
        },
      ]);
    }
  };

  const updateBloco = (idx: number, patch: Partial<Bloco>) => {
    setBlocos((bs) => bs.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  // Status geral
  const { statusGeral, dataInicial, dataFinal, slaDias } = useMemo(() => {
    if (blocos.length === 0) return { statusGeral: "—", dataInicial: null, dataFinal: null, slaDias: null };
    const todasEntregues = blocos.every((b) => !!b.data_entregue);
    const enviados = blocos.map((b) => b.data_enviado).filter(Boolean) as string[];
    const entregues = blocos.map((b) => b.data_entregue).filter(Boolean) as string[];
    const di = enviados.length ? enviados.slice().sort()[0] : null;
    const df = entregues.length ? entregues.slice().sort().slice(-1)[0] : null;
    let sla = null;
    if (di && df) {
      sla = Math.round((new Date(df).getTime() - new Date(di).getTime()) / 86400000);
    }
    return { statusGeral: todasEntregues ? "finalizado" : "em_andamento", dataInicial: di, dataFinal: df, slaDias: sla };
  }, [blocos]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!cad?.id) throw new Error("CAD não encontrado para este modelo. Abra o CAD primeiro.");
      // delete existing then insert all (simple sync)
      const { error: delErr } = await supabase.from("producao_terceirizados").delete().eq("cad_id", cad.id);
      if (delErr) throw delErr;
      if (blocos.length > 0) {
        const payload = blocos.map((b) => ({
          cad_id: cad.id,
          categoria_terceirizado_id: b.categoria_terceirizado_id,
          interno: b.interno,
          terceirizado_id: b.interno ? null : b.terceirizado_id,
          colaborador_id: b.interno ? b.colaborador_id : null,
          ativo: true,
          preco_metro_unidade: b.interno ? 0 : b.preco_metro_unidade,
          quantidade_enviada: b.quantidade_enviada,
          quantidade_recebida: b.quantidade_recebida,
          quantidade_defeito: b.quantidade_defeito,
          data_enviado: b.data_enviado,
          data_prevista: b.data_prevista,
          data_entregue: b.data_entregue,
          observacao: b.observacao,
          aviamentos_enviados: b.aviamentos_enviados,
        }));
        const { error } = await supabase.from("producao_terceirizados").insert(payload as any);
        if (error) throw error;
      }

      // Oficina (card de serviço) → producao_oficina (1 linha por cad).
      const ofStatus = oficina.data_entregue ? "finalizado" : oficina.data_enviado ? "em_andamento" : "pendente";
      if (oficinaAtiva) {
        const ofPayload: any = {
          cad_id: cad.id,
          interno: oficina.interno,
          terceirizado_id: oficina.interno ? null : oficina.terceirizado_id,
          colaborador_id: oficina.interno ? oficina.colaborador_id : null,
          preco_por_peca: oficina.interno ? 0 : oficina.preco_por_peca,
          quantidade_enviada: oficina.quantidade_enviada,
          quantidade_recebida: oficina.quantidade_recebida,
          quantidade_defeito: oficina.quantidade_defeito,
          data_enviado: oficina.data_enviado,
          data_prevista: oficina.data_prevista,
          data_entregue: oficina.data_entregue,
          status: ofStatus,
          observacao: oficina.observacao,
        };
        if ((oficinaRow as any)?.id) {
          const { error } = await supabase.from("producao_oficina").update(ofPayload).eq("id", (oficinaRow as any).id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("producao_oficina").insert(ofPayload);
          if (error) throw error;
        }
      } else if ((oficinaRow as any)?.id) {
        const { error } = await supabase.from("producao_oficina").delete().eq("id", (oficinaRow as any).id);
        if (error) throw error;
      }

      // "Observação de Partes do Molde": fonte única no cad.
      const { error: cadErr } = await supabase
        .from("cad")
        .update({ observacoes_molde: observacoesMolde || null } as any)
        .eq("id", cad.id);
      if (cadErr) throw cadErr;
    },
    onSuccess: async () => {
      toast.success("Salvo com sucesso");
      // Busca os dados frescos ANTES de liberar o guard de hidratação, senão a
      // re-hidratação rodava com o cache antigo (vazio) e o formulário "sumia".
      await qc.invalidateQueries({ queryKey: ["producao-terc", cad?.id] });
      await qc.invalidateQueries({ queryKey: ["producao-oficina-terc", cad?.id] });
      await qc.invalidateQueries({ queryKey: ["terc-cad", modeloId] });
      await refetch();
      await refetchOficina();
      setHydrated(false);
      setOficinaHydrated(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/producao/terceirizados" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || readOnly}>
          <Save className="h-4 w-4 mr-2" /> Salvar
        </Button>
      </div>
      <fieldset disabled={readOnly} className="contents">

      <header className="flex items-center gap-3">
        <Users className="h-7 w-7 text-primary" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">
            {modelo?.ref ?? "…"} — {modelo?.nome ?? ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            {(modelo as any)?.categoria_nome ?? "—"} • {modelo?.colecao ?? "—"}
          </p>
        </div>
      </header>

      {/* Status geral */}
      <Card className="p-4 grid gap-4 md:grid-cols-5">
        <div>
          <Label className="text-xs text-muted-foreground">Grade Total Geral</Label>
          <div className="mt-1 text-sm font-semibold">{fmtNum(gradeTotalGeral)}</div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Status Geral</Label>
          <div className="mt-1">
            <Badge className={`${STATUS_COLORS[statusGeral] ?? "bg-muted"} text-white`}>{STATUS_LABELS[statusGeral] ?? statusGeral}</Badge>
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Data Inicial</Label>
          <div className="mt-1 text-sm">{dataInicial ?? "—"}</div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Data Final</Label>
          <div className="mt-1 text-sm">{dataFinal ?? "—"}</div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">SLA (dias)</Label>
          <div className="mt-1 text-sm">{slaDias ?? "—"}</div>
        </div>
      </Card>

      {/* Categoria buttons */}
      <Card className="p-4">
        <Label className="text-sm font-semibold mb-3 block">Categorias de Terceirizado (clique para ativar/desativar)</Label>
        <div className="flex flex-wrap gap-2">
          {(categorias as any[]).map((c) => {
            const active = activeCategorias.has(c.id);
            return (
              <Button
                key={c.id}
                type="button"
                variant={active ? "default" : "outline"}
                size="sm"
                onClick={() => toggleCategoria(c.id, c.nome)}
              >
                {active ? <Trash2 className="h-3.5 w-3.5 mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                {c.nome}
              </Button>
            );
          })}
          {categoriasLoading && (
            <p className="text-sm text-muted-foreground">Carregando categorias…</p>
          )}
          {categoriasError && (
            <p className="text-sm text-destructive">
              Erro ao carregar categorias: {(categoriasError as any)?.message ?? "desconhecido"}
            </p>
          )}
          {!categoriasLoading && !categoriasError && (categorias as any[]).length === 0 && (
            <p className="text-sm text-muted-foreground">Cadastre categorias em Cadastro &gt; Atributos.</p>
          )}
          <Button
            type="button"
            variant={oficinaAtiva ? "default" : "outline"}
            size="sm"
            onClick={() => setOficinaAtiva((v) => !v)}
          >
            {oficinaAtiva ? <Trash2 className="h-3.5 w-3.5 mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
            <Wrench className="h-3.5 w-3.5 mr-1" /> Oficina
          </Button>
        </div>
      </Card>

      {/* Blocos */}
      {blocos.map((b, idx) => {
        const catNome = (categorias as any[]).find((c) => c.id === b.categoria_terceirizado_id)?.nome ?? "—";
        const responsaveis = (terceirizados as any[]).filter((t) => (t.categorias_ids ?? []).includes(b.categoria_terceirizado_id));
        // SLA do serviço: dias entre enviado e entregue (calculado das datas).
        const slaBloco =
          b.data_enviado && b.data_entregue
            ? Math.round((new Date(b.data_entregue).getTime() - new Date(b.data_enviado).getTime()) / 86400000)
            : null;
        return (
          <Card key={b.categoria_terceirizado_id} className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-lg">{catNome}</h3>
              <div className="flex items-center gap-2">
                {/* Toggle Interno / PL (Interno esconde o responsável) */}
                <div className="flex rounded-md border overflow-hidden text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => updateBloco(idx, { interno: true, terceirizado_id: null })}
                    className={cn(
                      "px-2.5 py-1 transition-colors",
                      b.interno ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    Interno
                  </button>
                  <button
                    type="button"
                    onClick={() => updateBloco(idx, { interno: false })}
                    className={cn(
                      "px-2.5 py-1 transition-colors border-l",
                      !b.interno ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    PL
                  </button>
                </div>
                <Badge variant="outline" className="text-xs whitespace-nowrap">
                  SLA: {slaBloco != null ? `${slaBloco}d` : "—"}
                </Badge>
                <Badge className={`${STATUS_COLORS[b.status ?? "pendente"] ?? "bg-muted"} text-white`}>{STATUS_LABELS[b.status ?? "pendente"] ?? (b.status ?? "pendente")}</Badge>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label className="text-xs">Responsável</Label>
                {b.interno ? (
                  <Select
                    value={b.colaborador_id ?? ""}
                    onValueChange={(v) => updateBloco(idx, { colaborador_id: v || null })}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                    <SelectContent>
                      {colaboradores.length === 0 && (
                        <div className="p-2 text-xs text-muted-foreground">
                          Cadastre colaboradores em Cadastro &gt; Atributos.
                        </div>
                      )}
                      {colaboradores.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select
                    value={b.terceirizado_id ?? ""}
                    onValueChange={(v) => updateBloco(idx, { terceirizado_id: v || null })}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                    <SelectContent>
                      {responsaveis.length === 0 && (
                        <div className="p-2 text-xs text-muted-foreground">Nenhum cadastrado nesta categoria.</div>
                      )}
                      {responsaveis.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.nome_responsavel}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {!b.interno && (
                <div>
                  <Label className="text-xs">Preço por metro/unidade</Label>
                  <NumberInput
                    type="number"
                    step="0.01"
                    value={b.preco_metro_unidade}
                    onChange={(e) => updateBloco(idx, { preco_metro_unidade: Number(e.target.value) })}
                  />
                </div>
              )}
              <div>
                <Label className="text-xs">Qtd Enviada</Label>
                <NumberInput
                  type="number"
                  value={b.quantidade_enviada}
                  onChange={(e) => updateBloco(idx, { quantidade_enviada: Number(e.target.value) })}
                />
              </div>

              <div>
                <Label className="text-xs">Data Enviado</Label>
                <Input
                  type="date"
                  value={b.data_enviado ?? ""}
                  onChange={(e) => updateBloco(idx, { data_enviado: e.target.value || null })}
                />
              </div>
              <div>
                <Label className="text-xs">Data Prevista</Label>
                <Input
                  type="date"
                  value={b.data_prevista ?? ""}
                  onChange={(e) => updateBloco(idx, { data_prevista: e.target.value || null })}
                />
              </div>
              <div>
                <Label className="text-xs">Data Entregue</Label>
                <Input
                  type="date"
                  value={b.data_entregue ?? ""}
                  onChange={(e) => updateBloco(idx, { data_entregue: e.target.value || null })}
                />
              </div>

              <div>
                <Label className="text-xs">Qtd Recebida</Label>
                <NumberInput
                  type="number"
                  value={b.quantidade_recebida}
                  onChange={(e) => updateBloco(idx, { quantidade_recebida: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs">Qtd Defeito</Label>
                <NumberInput
                  type="number"
                  value={b.quantidade_defeito}
                  onChange={(e) => updateBloco(idx, { quantidade_defeito: Number(e.target.value) })}
                />
              </div>
              {!b.interno && (
                <div>
                  <Label className="text-xs">Custo Total</Label>
                  <Input
                    readOnly
                    value={fmtNum(b.preco_metro_unidade * b.quantidade_enviada)}
                    className="bg-muted"
                  />
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs mb-2 block">Aviamentos Enviados</Label>
              <div className="flex flex-wrap gap-2">
                {(aviamentosModelo as any[]).length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhum aviamento vinculado ao modelo.</p>
                )}
                {(aviamentosModelo as any[]).map((a) => {
                  const checked = b.aviamentos_enviados.includes(a.id);
                  return (
                    <Button
                      key={a.id}
                      type="button"
                      size="sm"
                      variant={checked ? "default" : "outline"}
                      onClick={() =>
                        updateBloco(idx, {
                          aviamentos_enviados: checked
                            ? b.aviamentos_enviados.filter((x) => x !== a.id)
                            : [...b.aviamentos_enviados, a.id],
                        })
                      }
                    >
                      {a.nome}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label className="text-xs">Observação</Label>
              <Textarea
                value={b.observacao}
                onChange={(e) => updateBloco(idx, { observacao: e.target.value })}
                rows={2}
              />
            </div>
          </Card>
        );
      })}

      {/* Oficina — card de serviço (producao_oficina) */}
      {oficinaAtiva && (() => {
        const ofSla =
          oficina.data_enviado && oficina.data_entregue
            ? Math.round((new Date(oficina.data_entregue).getTime() - new Date(oficina.data_enviado).getTime()) / 86400000)
            : null;
        const ofStatus = oficina.data_entregue ? "finalizado" : oficina.data_enviado ? "em_andamento" : "pendente";
        return (
          <Card className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Wrench className="h-5 w-5 text-primary" /> Oficina
              </h3>
              <div className="flex items-center gap-2">
                <div className="flex rounded-md border overflow-hidden text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => updateOficina({ interno: true, terceirizado_id: null })}
                    className={cn(
                      "px-2.5 py-1 transition-colors",
                      oficina.interno ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    Interno
                  </button>
                  <button
                    type="button"
                    onClick={() => updateOficina({ interno: false })}
                    className={cn(
                      "px-2.5 py-1 transition-colors border-l",
                      !oficina.interno ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    PL
                  </button>
                </div>
                <Badge variant="outline" className="text-xs whitespace-nowrap">
                  SLA: {ofSla != null ? `${ofSla}d` : "—"}
                </Badge>
                <Badge className={`${STATUS_COLORS[ofStatus] ?? "bg-muted"} text-white`}>{STATUS_LABELS[ofStatus] ?? ofStatus}</Badge>
                <Link to="/producao/oficina/$modeloId" params={{ modeloId }}>
                  <Button type="button" variant="ghost" size="sm">
                    <Printer className="h-3.5 w-3.5 mr-1" /> Ficha
                  </Button>
                </Link>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label className="text-xs">Responsável</Label>
                {oficina.interno ? (
                  <Select
                    value={oficina.colaborador_id ?? ""}
                    onValueChange={(v) => updateOficina({ colaborador_id: v || null })}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                    <SelectContent>
                      {colaboradores.length === 0 && (
                        <div className="p-2 text-xs text-muted-foreground">
                          Cadastre colaboradores em Cadastro &gt; Atributos.
                        </div>
                      )}
                      {colaboradores.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select
                    value={oficina.terceirizado_id ?? ""}
                    onValueChange={(v) => updateOficina({ terceirizado_id: v || null })}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                    <SelectContent>
                      {(terceirizados as any[]).length === 0 && (
                        <div className="p-2 text-xs text-muted-foreground">Nenhum terceirizado cadastrado.</div>
                      )}
                      {(terceirizados as any[]).map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.nome_responsavel}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {!oficina.interno && (
                <div>
                  <Label className="text-xs">Preço por Peça</Label>
                  <NumberInput
                    type="number"
                    step="0.01"
                    value={oficina.preco_por_peca}
                    onChange={(e) => updateOficina({ preco_por_peca: Number(e.target.value) })}
                  />
                </div>
              )}
              <div>
                <Label className="text-xs">Qtd Enviada</Label>
                <NumberInput
                  type="number"
                  value={oficina.quantidade_enviada}
                  onChange={(e) => updateOficina({ quantidade_enviada: Number(e.target.value) })}
                />
              </div>

              <div>
                <Label className="text-xs">Data Enviado</Label>
                <Input type="date" value={oficina.data_enviado ?? ""} onChange={(e) => updateOficina({ data_enviado: e.target.value || null })} />
              </div>
              <div>
                <Label className="text-xs">Data Prevista</Label>
                <Input type="date" value={oficina.data_prevista ?? ""} onChange={(e) => updateOficina({ data_prevista: e.target.value || null })} />
              </div>
              <div>
                <Label className="text-xs">Data Entregue</Label>
                <Input type="date" value={oficina.data_entregue ?? ""} onChange={(e) => updateOficina({ data_entregue: e.target.value || null })} />
              </div>

              <div>
                <Label className="text-xs">Qtd Recebida</Label>
                <NumberInput
                  type="number"
                  value={oficina.quantidade_recebida}
                  onChange={(e) => updateOficina({ quantidade_recebida: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs">Qtd Defeito</Label>
                <NumberInput
                  type="number"
                  value={oficina.quantidade_defeito}
                  onChange={(e) => updateOficina({ quantidade_defeito: Number(e.target.value) })}
                />
              </div>
              {!oficina.interno && (
                <div>
                  <Label className="text-xs">Custo Total</Label>
                  <Input readOnly value={fmtNum(oficina.preco_por_peca * oficina.quantidade_enviada)} className="bg-muted" />
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs">Observação</Label>
              <Textarea value={oficina.observacao} onChange={(e) => updateOficina({ observacao: e.target.value })} rows={2} />
            </div>
            <div>
              <Label className="text-xs">Observação de Partes do Molde</Label>
              <Textarea value={observacoesMolde} onChange={(e) => setObservacoesMolde(e.target.value)} rows={3} />
              <p className="text-xs text-muted-foreground mt-1">Compartilhada com o CAD / Ficha de Corte.</p>
            </div>
          </Card>
        );
      })()}

      {blocos.length === 0 && !oficinaAtiva && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Ative uma categoria ou a Oficina acima para começar.
        </Card>
      )}

      {!cad?.id && (
        <Card className="p-4 border-amber-500/50 bg-amber-500/10 text-sm">
          Atenção: este modelo ainda não possui um registro de CAD. Abra a página de CAD desse modelo antes de salvar.
        </Card>
      )}
      </fieldset>
    </div>
  );
}
