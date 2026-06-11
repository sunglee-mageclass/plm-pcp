import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Sparkles, Save, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/producao/acabamento/$modeloId")({
  component: AcabDetailPage,
});

type Bloco = {
  id?: string;
  tipo: string;
  terceirizado_id: string | null;
  preco_por_peca: number;
  quantidade_enviada: number;
  quantidade_recebida: number;
  quantidade_defeito: number;
  data_enviado: string | null;
  data_prevista: string | null;
  data_entregue: string | null;
  status: string | null;
  observacao: string;
  aviamentos_utilizados: string[];
};

const STATUS_COLORS: Record<string, string> = {
  pendente: "bg-amber-500",
  em_andamento: "bg-blue-500",
  finalizado: "bg-emerald-500",
};

function AcabDetailPage() {
  const { modeloId } = Route.useParams();
  const qc = useQueryClient();

  const { data: modelo } = useQuery({
    queryKey: ["acab-modelo", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("id, ref, nome, colecao, categorias_produto:categoria_principal_id(nome)")
        .eq("id", modeloId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: cad } = useQuery({
    queryKey: ["acab-cad", modeloId],
    queryFn: async () => (await supabase.from("cad").select("id").eq("modelo_id", modeloId).maybeSingle()).data,
  });

  const { data: tenantCfg } = useQuery({
    queryKey: ["tenant_config", "etapas"],
    queryFn: async () => (await supabase.from("tenant_config").select("etapas_acabamento").maybeSingle()).data,
  });
  const etapas = useMemo<string[]>(() => {
    const e = (tenantCfg as any)?.etapas_acabamento;
    if (Array.isArray(e) && e.length) return e.map(String);
    return ["Passadoria", "Embalagem", "Etiqueta"];
  }, [tenantCfg]);

  const { data: terceirizados = [] } = useQuery({
    queryKey: ["terceirizados-all"],
    queryFn: async () => (await supabase.from("terceirizados").select("id, nome_responsavel")).data ?? [],
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

  const { data: existing = [], refetch } = useQuery({
    queryKey: ["producao-acabamento", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data } = await supabase.from("producao_acabamento").select("*").eq("cad_id", cad!.id).eq("ativo", true);
      return data ?? [];
    },
  });

  const [blocos, setBlocos] = useState<Bloco[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!hydrated && cad?.id) {
      setBlocos((existing as any[]).map((r) => ({
        id: r.id,
        tipo: r.tipo,
        terceirizado_id: r.terceirizado_id,
        preco_por_peca: Number(r.preco_por_peca ?? 0),
        quantidade_enviada: Number(r.quantidade_enviada ?? 0),
        quantidade_recebida: Number(r.quantidade_recebida ?? 0),
        quantidade_defeito: Number(r.quantidade_defeito ?? 0),
        data_enviado: r.data_enviado,
        data_prevista: r.data_prevista,
        data_entregue: r.data_entregue,
        status: r.status,
        observacao: r.observacao ?? "",
        aviamentos_utilizados: Array.isArray(r.aviamentos_utilizados) ? r.aviamentos_utilizados : [],
      })));
      setHydrated(true);
    }
  }, [existing, cad?.id, hydrated]);

  const activeTipos = new Set(blocos.map((b) => b.tipo));

  const toggleTipo = (tipo: string) => {
    if (activeTipos.has(tipo)) {
      setBlocos((bs) => bs.filter((b) => b.tipo !== tipo));
    } else {
      setBlocos((bs) => [...bs, {
        tipo, terceirizado_id: null, preco_por_peca: 0,
        quantidade_enviada: 0, quantidade_recebida: 0, quantidade_defeito: 0,
        data_enviado: null, data_prevista: null, data_entregue: null,
        status: "pendente", observacao: "", aviamentos_utilizados: [],
      }]);
    }
  };

  const updateBloco = (idx: number, patch: Partial<Bloco>) => {
    setBlocos((bs) => bs.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!cad?.id) throw new Error("CAD não encontrado. Abra o CAD desse modelo primeiro.");
      const { error: delErr } = await supabase.from("producao_acabamento").delete().eq("cad_id", cad.id);
      if (delErr) throw delErr;
      if (blocos.length === 0) return;
      const payload = blocos.map((b) => ({
        cad_id: cad.id, ativo: true, tipo: b.tipo,
        terceirizado_id: b.terceirizado_id,
        preco_por_peca: b.preco_por_peca,
        quantidade_enviada: b.quantidade_enviada,
        quantidade_recebida: b.quantidade_recebida,
        quantidade_defeito: b.quantidade_defeito,
        data_enviado: b.data_enviado,
        data_prevista: b.data_prevista,
        data_entregue: b.data_entregue,
        observacao: b.observacao,
        aviamentos_utilizados: b.aviamentos_utilizados,
      }));
      const { error } = await supabase.from("producao_acabamento").insert(payload);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Salvo");
      setHydrated(false);
      await qc.invalidateQueries({ queryKey: ["producao-acabamento", cad?.id] });
      await refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/producao/acabamento" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          <Save className="h-4 w-4 mr-2" /> Salvar
        </Button>
      </div>

      <header className="flex items-center gap-3">
        <Sparkles className="h-7 w-7 text-primary" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{modelo?.ref ?? "…"} — {modelo?.nome ?? ""}</h1>
          <p className="text-sm text-muted-foreground">
            {(modelo as any)?.categorias_produto?.nome ?? "—"} • {modelo?.colecao ?? "—"}
          </p>
        </div>
      </header>

      <Card className="p-4">
        <Label className="text-sm font-semibold mb-3 block">Etapas de Acabamento (clique para ativar/desativar)</Label>
        <div className="flex flex-wrap gap-2">
          {etapas.map((t) => {
            const active = activeTipos.has(t);
            return (
              <Button key={t} type="button" variant={active ? "default" : "outline"} size="sm" onClick={() => toggleTipo(t)}>
                {active ? <Trash2 className="h-3.5 w-3.5 mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                {t}
              </Button>
            );
          })}
        </div>
      </Card>

      {blocos.map((b, idx) => (
        <Card key={b.tipo} className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-lg">{b.tipo}</h3>
            <Badge className={`${STATUS_COLORS[b.status ?? "pendente"] ?? "bg-muted"} text-white`}>{b.status ?? "pendente"}</Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label className="text-xs">Responsável</Label>
              <Select value={b.terceirizado_id ?? ""} onValueChange={(v) => updateBloco(idx, { terceirizado_id: v || null })}>
                <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>
                  {(terceirizados as any[]).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.nome_responsavel}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Preço por Peça</Label>
              <Input type="number" step="0.01" value={b.preco_por_peca}
                onChange={(e) => updateBloco(idx, { preco_por_peca: Number(e.target.value) })} />
            </div>
            <div>
              <Label className="text-xs">Custo Total</Label>
              <Input readOnly className="bg-muted" value={(b.preco_por_peca * b.quantidade_enviada).toFixed(2)} />
            </div>

            <div>
              <Label className="text-xs">Qtd Enviada</Label>
              <Input type="number" value={b.quantidade_enviada}
                onChange={(e) => updateBloco(idx, { quantidade_enviada: Number(e.target.value) })} />
            </div>
            <div>
              <Label className="text-xs">Qtd Recebida</Label>
              <Input type="number" value={b.quantidade_recebida}
                onChange={(e) => updateBloco(idx, { quantidade_recebida: Number(e.target.value) })} />
            </div>
            <div>
              <Label className="text-xs">Qtd Defeito</Label>
              <Input type="number" value={b.quantidade_defeito}
                onChange={(e) => updateBloco(idx, { quantidade_defeito: Number(e.target.value) })} />
            </div>

            <div>
              <Label className="text-xs">Data Enviado</Label>
              <Input type="date" value={b.data_enviado ?? ""}
                onChange={(e) => updateBloco(idx, { data_enviado: e.target.value || null })} />
            </div>
            <div>
              <Label className="text-xs">Data Prevista</Label>
              <Input type="date" value={b.data_prevista ?? ""}
                onChange={(e) => updateBloco(idx, { data_prevista: e.target.value || null })} />
            </div>
            <div>
              <Label className="text-xs">Data Entregue</Label>
              <Input type="date" value={b.data_entregue ?? ""}
                onChange={(e) => updateBloco(idx, { data_entregue: e.target.value || null })} />
            </div>
          </div>

          <div>
            <Label className="text-xs mb-2 block">Aviamentos Utilizados</Label>
            <div className="flex flex-wrap gap-2">
              {(aviamentosModelo as any[]).length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhum aviamento vinculado ao modelo.</p>
              )}
              {(aviamentosModelo as any[]).map((a) => {
                const checked = b.aviamentos_utilizados.includes(a.id);
                return (
                  <Button
                    key={a.id} type="button" size="sm"
                    variant={checked ? "default" : "outline"}
                    onClick={() => updateBloco(idx, {
                      aviamentos_utilizados: checked
                        ? b.aviamentos_utilizados.filter((x) => x !== a.id)
                        : [...b.aviamentos_utilizados, a.id],
                    })}
                  >{a.nome}</Button>
                );
              })}
            </div>
          </div>

          <div>
            <Label className="text-xs">Observação</Label>
            <Textarea rows={2} value={b.observacao} onChange={(e) => updateBloco(idx, { observacao: e.target.value })} />
          </div>
        </Card>
      ))}

      {blocos.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">Ative uma etapa acima para começar.</Card>
      )}

      {!cad?.id && (
        <Card className="p-4 border-amber-500/50 bg-amber-500/10 text-sm">
          Este modelo ainda não tem registro de CAD. Abra a página de CAD desse modelo antes de salvar.
        </Card>
      )}
    </div>
  );
}
