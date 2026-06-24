import { useEffect, useMemo, useState } from "react";
import { fmtNum } from "@/lib/format";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Wrench, Save, Printer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useReadOnly } from "@/components/RequirePermission";
import { VerificarRevisao } from "@/components/producao/RevisaoErro";
import { ModeloPhotoPrint } from "@/components/producao/cad/shared";
import { printWithImages } from "@/lib/print";
import { PrintArea } from "@/components/shared/PrintArea";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";

export const Route = createFileRoute("/_authenticated/producao/oficina/$modeloId")({
  component: OficinaDetailPage,
});

const STATUS_COLORS: Record<string, string> = {
  pendente: "bg-amber-500",
  em_andamento: "bg-blue-500",
  finalizado: "bg-emerald-500",
};

function computeStatus(b: { data_enviado: string | null; data_entregue: string | null }) {
  if (b.data_entregue) return "finalizado";
  if (b.data_enviado) return "em_andamento";
  return "pendente";
}

function OficinaDetailPage() {
  const { modeloId } = Route.useParams();
  const qc = useQueryClient();
  const fl = useFieldLabels();
  const readOnly = useReadOnly();
  const tenantId = useActiveTenantId();

  const { data: modelo } = useQuery({
    queryKey: ["oficina-modelo", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("id, ref, nome, colecao, fotos_modelo, observacoes_tecnicas, categorias_produto:categoria_principal_id(nome)")
        .eq("id", modeloId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: cad } = useQuery({
    queryKey: ["oficina-cad", modeloId],
    queryFn: async () => {
      const { data } = await supabase.from("cad").select("*").eq("modelo_id", modeloId).maybeSingle();
      return data;
    },
  });

  const { data: terceirizados = [] } = useQuery({
    queryKey: ["terceirizados-all"],
    queryFn: async () => (await supabase.from("terceirizados").select("id, nome_responsavel")).data ?? [],
  });

  const { data: tenantCfg } = useQuery({
    queryKey: ["tenant-cfg-oficina", tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await supabase.from("tenant_config").select("tamanhos_grade, oficina_interna").eq("tenant_id", tenantId).maybeSingle()).data,
  });
  const tamanhos: string[] = useMemo(() => {
    const raw = (tenantCfg as any)?.tamanhos_grade;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map((x: any) => typeof x === "string" ? x : (x?.nome ?? x?.label ?? String(x)));
    }
    return ["PP", "P", "M", "G", "GG"];
  }, [tenantCfg]);
  const oficinaInterna = Boolean((tenantCfg as any)?.oficina_interna);

  const { data: grades = [] } = useQuery({
    queryKey: ["cad-grades", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("cad_grades")
        .select("variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real")
        .eq("cad_id", cad!.id)
        .order("variante_numero");
      return data ?? [];
    },
  });

  const { data: existing, refetch } = useQuery({
    queryKey: ["producao-oficina", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data } = await supabase.from("producao_oficina").select("*").eq("cad_id", cad!.id).maybeSingle();
      return data;
    },
  });

  const [form, setForm] = useState({
    terceirizado_id: "" as string,
    preco_por_peca: 0,
    quantidade_enviada: 0,
    quantidade_recebida: 0,
    quantidade_defeito: 0,
    data_enviado: "" as string,
    data_prevista: "" as string,
    data_entregue: "" as string,
    observacao: "",
    observacoes_molde: "",
  });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated) return;
    // Espera as duas queries assentarem: producao_oficina e o cad (fonte do molde).
    if (existing === undefined || cad === undefined) return;
    const molde = (cad as any)?.observacoes_molde ?? "";
    if (existing) {
      setForm({
        terceirizado_id: existing.terceirizado_id ?? "",
        preco_por_peca: Number(existing.preco_por_peca ?? 0),
        quantidade_enviada: Number(existing.quantidade_enviada ?? 0),
        quantidade_recebida: Number(existing.quantidade_recebida ?? 0),
        quantidade_defeito: Number(existing.quantidade_defeito ?? 0),
        data_enviado: existing.data_enviado ?? "",
        data_prevista: existing.data_prevista ?? "",
        data_entregue: existing.data_entregue ?? "",
        observacao: existing.observacao ?? "",
        observacoes_molde: molde,
      });
    } else {
      setForm((f) => ({ ...f, observacoes_molde: molde }));
    }
    setHydrated(true);
  }, [existing, cad, hydrated]);

  const status = computeStatus({
    data_enviado: form.data_enviado || null,
    data_entregue: form.data_entregue || null,
  });

  const oficinaNome = useMemo(
    () => (terceirizados as any[]).find((t) => t.id === form.terceirizado_id)?.nome_responsavel ?? "—",
    [terceirizados, form.terceirizado_id],
  );

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!cad?.id) throw new Error("CAD não encontrado. Abra o CAD desse modelo primeiro.");
      const payload = {
        cad_id: cad.id,
        // Oficina interna: o Select de terceirizado fica escondido — não gravar
        // um terceirizado_id órfão (do estado anterior).
        terceirizado_id: oficinaInterna ? null : (form.terceirizado_id || null),
        preco_por_peca: form.preco_por_peca,
        quantidade_enviada: form.quantidade_enviada,
        quantidade_recebida: form.quantidade_recebida,
        quantidade_defeito: form.quantidade_defeito,
        data_enviado: form.data_enviado || null,
        data_prevista: form.data_prevista || null,
        data_entregue: form.data_entregue || null,
        status,
        observacao: form.observacao,
      };
      if (existing?.id) {
        const { error } = await supabase.from("producao_oficina").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("producao_oficina").insert(payload);
        if (error) throw error;
      }
      // "Partes do Molde" tem fonte única no CAD (Ficha de Corte).
      const { error: cadErr } = await supabase
        .from("cad")
        .update({ observacoes_molde: form.observacoes_molde || null } as any)
        .eq("id", cad.id);
      if (cadErr) throw cadErr;
    },
    onSuccess: async () => {
      toast.success("Salvo");
      // Busca os dados frescos ANTES de liberar a hidratação (senão re-hidrata do
      // cache antigo).
      await qc.invalidateQueries({ queryKey: ["producao-oficina", cad?.id] });
      await qc.invalidateQueries({ queryKey: ["oficina-cad", modeloId] });
      await refetch();
      setHydrated(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  const handlePrint = () => printWithImages();

  const fotos = ((modelo as any)?.fotos_modelo ?? []) as string[];

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-md:pb-24">
      <VerificarRevisao modeloId={modeloId} etapa="oficina" />
      <div className="no-print flex items-center justify-between">
        <Link to="/producao/oficina" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <div className="flex gap-2 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:justify-end max-md:border-t max-md:bg-background max-md:p-3 max-md:shadow-lg">
          <Button variant="outline" className="hidden md:inline-flex" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" /> Imprimir Ficha de Oficina
          </Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || readOnly}>
            <Save className="h-4 w-4 mr-2" /> Salvar
          </Button>
        </div>
      </div>

      <div className="no-print space-y-6">
        <header className="flex items-center gap-3">
          <Wrench className="h-7 w-7 text-primary" />
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{modelo?.ref ?? "…"} — {modelo?.nome ?? ""}</h1>
            <p className="text-sm text-muted-foreground">
              {(modelo as any)?.categorias_produto?.nome ?? "—"} • {modelo?.colecao ?? "—"}
            </p>
          </div>
          <Badge className={`${STATUS_COLORS[status]} text-white`}>{status}</Badge>
        </header>

        <Card className="p-5 space-y-4">
          <fieldset disabled={readOnly} className="contents">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-lg">Oficina</h3>
            {oficinaInterna && <Badge className="bg-primary text-primary-foreground">Oficina Interna</Badge>}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {!oficinaInterna && (
              <div>
                <Label className="text-xs">Oficina (responsável)</Label>
                <Select value={form.terceirizado_id} onValueChange={(v) => setForm((f) => ({ ...f, terceirizado_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    {(terceirizados as any[]).map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.nome_responsavel}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs">Preço por Peça</Label>
              <NumberInput type="number" step="0.01" value={form.preco_por_peca}
                onChange={(e) => setForm((f) => ({ ...f, preco_por_peca: Number(e.target.value) }))} />
            </div>
            <div>
              <Label className="text-xs">Custo Total</Label>
              <Input readOnly className="bg-muted" value={fmtNum(form.preco_por_peca * form.quantidade_enviada)} />
            </div>

            <div>
              <Label className="text-xs">Qtd Enviada</Label>
              <NumberInput type="number" value={form.quantidade_enviada}
                onChange={(e) => setForm((f) => ({ ...f, quantidade_enviada: Number(e.target.value) }))} />
            </div>
            <div>
              <Label className="text-xs">Qtd Recebida</Label>
              <NumberInput type="number" value={form.quantidade_recebida}
                onChange={(e) => setForm((f) => ({ ...f, quantidade_recebida: Number(e.target.value) }))} />
            </div>
            <div>
              <Label className="text-xs">Qtd Defeito</Label>
              <NumberInput type="number" value={form.quantidade_defeito}
                onChange={(e) => setForm((f) => ({ ...f, quantidade_defeito: Number(e.target.value) }))} />
            </div>

            <div>
              <Label className="text-xs">Data Enviado</Label>
              <Input type="date" value={form.data_enviado}
                onChange={(e) => setForm((f) => ({ ...f, data_enviado: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Data Prevista</Label>
              <Input type="date" value={form.data_prevista}
                onChange={(e) => setForm((f) => ({ ...f, data_prevista: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Data Entregue</Label>
              <Input type="date" value={form.data_entregue}
                onChange={(e) => setForm((f) => ({ ...f, data_entregue: e.target.value }))} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Observação</Label>
            <Textarea rows={2} value={form.observacao}
              onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Observação de Partes do Molde</Label>
            <Textarea rows={3} value={form.observacoes_molde}
              onChange={(e) => setForm((f) => ({ ...f, observacoes_molde: e.target.value }))} />
          </div>
          </fieldset>
        </Card>

        {!cad?.id && (
          <Card className="p-4 border-amber-500/50 bg-amber-500/10 text-sm">
            Este modelo ainda não tem registro de CAD. Abra a página de CAD desse modelo antes de salvar.
          </Card>
        )}
      </div>

      {/* Ficha de Oficina — Impressão */}
      <PrintArea>
        <div style={{ padding: 24, fontFamily: "Arial, sans-serif", color: "#000" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Ficha de Oficina</h1>
          <p style={{ fontSize: 12, marginBottom: 16 }}>
            <strong>Oficina:</strong> {oficinaNome}
          </p>

          <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
            {fotos[0] && <ModeloPhotoPrint path={fotos[0]} maxW={180} maxH={240} />}
            <div style={{ fontSize: 12, lineHeight: 1.6 }}>
              <div><strong>{fl("ref")}:</strong> {modelo?.ref ?? "—"}</div>
              <div><strong>Modelo:</strong> {modelo?.nome ?? "—"}</div>
              <div><strong>Coleção:</strong> {modelo?.colecao ?? "—"}</div>
              <div><strong>Categoria:</strong> {(modelo as any)?.categorias_produto?.nome ?? "—"}</div>
              <div><strong>Data Enviado:</strong> {form.data_enviado || "—"}</div>
              <div><strong>Data Prevista:</strong> {form.data_prevista || "—"}</div>
              <div><strong>Qtd Enviada:</strong> {form.quantidade_enviada}</div>
            </div>
          </div>

          <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 16, marginBottom: 6 }}>Grade por Variante</h2>
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", marginBottom: 12, pageBreakInside: "avoid" }}>
            <thead>
              <tr style={{ background: "#eee" }}>
                <th style={{ border: "1px solid #999", padding: 4, textAlign: "left" }}>Variante</th>
                {tamanhos.map((t) => (
                  <th key={t} style={{ border: "1px solid #999", padding: 4 }}>{t}</th>
                ))}
                <th style={{ border: "1px solid #999", padding: 4 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(grades as any[]).length === 0 && (
                <tr><td colSpan={tamanhos.length + 2} style={{ border: "1px solid #999", padding: 8, textAlign: "center" }}>Sem grade definida.</td></tr>
              )}
              {(grades as any[]).map((g) => {
                // Grade REAL (Recebimento − Defeito) quando o CQ confirmou; antes
                // do CQ grades_reais == planejada, então cai no mesmo valor.
                const gr = g.grades_reais ?? g.grades_planejadas ?? {};
                return (
                  <tr key={g.variante_numero}>
                    <td style={{ border: "1px solid #999", padding: 4 }}>Variante {g.variante_numero}</td>
                    {tamanhos.map((t) => (
                      <td key={t} style={{ border: "1px solid #999", padding: 4, textAlign: "center" }}>
                        {gr[t] ?? ""}
                      </td>
                    ))}
                    <td style={{ border: "1px solid #999", padding: 4, textAlign: "center", fontWeight: 700 }}>
                      {g.grade_total_real ?? g.grade_total_planejada ?? 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 12, marginBottom: 4 }}>Observações Técnicas</h2>
          <p style={{ fontSize: 11, whiteSpace: "pre-wrap", border: "1px solid #ccc", padding: 8, minHeight: 40, pageBreakInside: "avoid" }}>
            {(modelo as any)?.observacoes_tecnicas || "—"}
          </p>

          <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 12, marginBottom: 4 }}>Observação de Partes do Molde</h2>
          <p style={{ fontSize: 11, whiteSpace: "pre-wrap", border: "1px solid #ccc", padding: 8, minHeight: 40, pageBreakInside: "avoid" }}>
            {form.observacoes_molde || "—"}
          </p>


          <div style={{ display: "flex", gap: 32, marginTop: 48 }}>
            <div style={{ flex: 1 }}>
              <div style={{ borderBottom: "1px solid #000", height: 28 }} />
              <div style={{ fontSize: 11, marginTop: 4 }}>Nome</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ borderBottom: "1px solid #000", height: 28 }} />
              <div style={{ fontSize: 11, marginTop: 4 }}>Assinatura</div>
            </div>
          </div>
        </div>
      </PrintArea>
    </div>
  );
}
