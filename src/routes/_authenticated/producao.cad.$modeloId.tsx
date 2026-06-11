import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Scissors, Send, Save, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/producao/cad/$modeloId")({
  component: CadDetailPage,
});

type TipoTec = "tecido" | "forro" | "entretela";

type TecidoRow = {
  id?: string;
  numero: number;
  tipo: TipoTec;
  artigo_id: string | null;
  consumo_cad: number;
  loss_percent_cad: number;
  custo_cad: number;
  tamanho_folha: number;
  preco: number; // helper, not stored
  artigo_nome?: string | null;
  variantes: VarianteRow[];
};
type VarianteRow = {
  id?: string;
  variante_tecido_id: string | null;
  variante_nome?: string | null;
  ordem: number;
  quantidade_folhas: number;
  metragem_planejada: number;
  metragem_enviada: number;
};

type GradeRow = {
  id?: string;
  variante_numero: number;
  grades_planejadas: Record<string, number>;
  grades_reais: Record<string, number>;
  grade_total_planejada: number;
  grade_total_real: number;
};

function calcCusto(consumo: number, loss: number, preco: number) {
  return Number((consumo * (1 + loss / 100) * preco).toFixed(2));
}

function CadDetailPage() {
  const { modeloId } = Route.useParams();
  const qc = useQueryClient();

  // --- queries ---
  const { data: modelo } = useQuery({
    queryKey: ["cad-modelo", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select(
          "*, estilista:estilista_id(nome), cat_p:categoria_principal_id(nome), cat_s:categoria_secundaria_id(nome)",
        )
        .eq("id", modeloId)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: cadRow } = useQuery({
    queryKey: ["cad-row", modeloId],
    queryFn: async () => {
      const { data } = await supabase.from("cad").select("*").eq("modelo_id", modeloId).maybeSingle();
      return data;
    },
  });

  const { data: modeloTecidos = [] } = useQuery({
    queryKey: ["cad-modelo-tecidos", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_tecidos")
        .select(
          "id, numero, tipo, artigo_id, consumo, loss_percent, artigos:artigo_id(nome, preco_por_metro), modelo_tecido_variantes(id, variante_tecido_id, ordem, variantes_tecido:variante_tecido_id(nome))",
        )
        .eq("modelo_id", modeloId)
        .order("tipo")
        .order("numero");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: cadTecidos = [] } = useQuery({
    queryKey: ["cad-tecidos", cadRow?.id],
    enabled: !!cadRow?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cad_tecidos")
        .select(
          "*, artigos:artigo_id(nome, preco_por_metro), cad_tecido_variantes(*, variantes_tecido:variante_tecido_id(nome))",
        )
        .eq("cad_id", cadRow!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: modeloGrades = [] } = useQuery({
    queryKey: ["cad-modelo-grades", modeloId],
    queryFn: async () => {
      const { data } = await supabase.from("modelo_grades").select("*").eq("modelo_id", modeloId);
      return data ?? [];
    },
  });
  const { data: cadGrades = [] } = useQuery({
    queryKey: ["cad-grades-rows", cadRow?.id],
    enabled: !!cadRow?.id,
    queryFn: async () => {
      const { data } = await supabase.from("cad_grades").select("*").eq("cad_id", cadRow!.id);
      return data ?? [];
    },
  });

  // --- local editable state, seeded from cad rows or modelo defaults ---
  const [tecidos, setTecidos] = useState<TecidoRow[]>([]);
  const [grades, setGrades] = useState<GradeRow[]>([]);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (seeded) return;
    if (!modelo) return;
    // wait for cadRow query to settle
    if (cadRow === undefined) return;
    if (cadRow?.id && (cadTecidos as any[]).length === 0 && (modeloTecidos as any[]).length > 0) {
      // still loading cad tecidos
      return;
    }

    let initialTec: TecidoRow[];
    if ((cadTecidos as any[]).length > 0) {
      initialTec = (cadTecidos as any[]).map((t) => ({
        id: t.id,
        numero: t.numero,
        tipo: t.tipo,
        artigo_id: t.artigo_id,
        consumo_cad: Number(t.consumo_cad ?? 0),
        loss_percent_cad: Number(t.loss_percent_cad ?? 0),
        custo_cad: Number(t.custo_cad ?? 0),
        tamanho_folha: Number(t.tamanho_folha ?? 0),
        preco: Number(t.artigos?.preco_por_metro ?? 0),
        artigo_nome: t.artigos?.nome,
        variantes: (t.cad_tecido_variantes ?? []).map((v: any) => ({
          id: v.id,
          variante_tecido_id: v.variante_tecido_id,
          variante_nome: v.variantes_tecido?.nome,
          ordem: v.ordem,
          quantidade_folhas: Number(v.quantidade_folhas ?? 0),
          metragem_planejada: Number(v.metragem_planejada ?? 0),
          metragem_enviada: Number(v.metragem_enviada ?? 0),
        })),
      }));
    } else {
      initialTec = (modeloTecidos as any[]).map((mt) => {
        const preco = Number(mt.artigos?.preco_por_metro ?? 0);
        const consumo = Number(mt.consumo ?? 0);
        const loss = Number(mt.loss_percent ?? 0);
        return {
          numero: mt.numero,
          tipo: mt.tipo as TipoTec,
          artigo_id: mt.artigo_id,
          consumo_cad: consumo,
          loss_percent_cad: loss,
          custo_cad: calcCusto(consumo, loss, preco),
          tamanho_folha: 0,
          preco,
          artigo_nome: mt.artigos?.nome,
          variantes: (mt.modelo_tecido_variantes ?? []).map((v: any) => ({
            variante_tecido_id: v.variante_tecido_id,
            variante_nome: v.variantes_tecido?.nome,
            ordem: v.ordem,
            quantidade_folhas: 0,
            metragem_planejada: 0,
            metragem_enviada: 0,
          })),
        };
      });
    }
    setTecidos(initialTec);

    let initialGrades: GradeRow[];
    if ((cadGrades as any[]).length > 0) {
      initialGrades = (cadGrades as any[]).map((g) => ({
        id: g.id,
        variante_numero: g.variante_numero,
        grades_planejadas: g.grades_planejadas ?? {},
        grades_reais: g.grades_reais ?? {},
        grade_total_planejada: g.grade_total_planejada ?? 0,
        grade_total_real: g.grade_total_real ?? 0,
      }));
    } else {
      initialGrades = (modeloGrades as any[]).map((g) => ({
        variante_numero: g.variante_numero,
        grades_planejadas: g.grades ?? {},
        grades_reais: g.grades ?? {},
        grade_total_planejada: g.grade_total ?? 0,
        grade_total_real: g.grade_total ?? 0,
      }));
    }
    setGrades(initialGrades);
    setSeeded(true);
  }, [modelo, cadRow, cadTecidos, modeloTecidos, cadGrades, modeloGrades, seeded]);

  // --- helpers ---
  const updateTec = (i: number, patch: Partial<TecidoRow>) => {
    setTecidos((prev) => {
      const next = [...prev];
      const merged = { ...next[i], ...patch };
      merged.custo_cad = calcCusto(merged.consumo_cad, merged.loss_percent_cad, merged.preco);
      next[i] = merged;
      return next;
    });
  };
  const updateVar = (i: number, j: number, patch: Partial<VarianteRow>) => {
    setTecidos((prev) => {
      const next = [...prev];
      const variantes = [...next[i].variantes];
      variantes[j] = { ...variantes[j], ...patch };
      next[i] = { ...next[i], variantes };
      return next;
    });
  };
  const updateGradeCell = (gi: number, tamanho: string, value: number) => {
    setGrades((prev) => {
      const next = [...prev];
      const grades_reais = { ...next[gi].grades_reais, [tamanho]: value };
      const grade_total_real = Object.values(grades_reais).reduce((a, b) => a + (Number(b) || 0), 0);
      next[gi] = { ...next[gi], grades_reais, grade_total_real };
      return next;
    });
  };
  const updateGradePlan = (gi: number, tamanho: string, value: number) => {
    setGrades((prev) => {
      const next = [...prev];
      const grades_planejadas = { ...next[gi].grades_planejadas, [tamanho]: value };
      const grade_total_planejada = Object.values(grades_planejadas).reduce((a, b) => a + (Number(b) || 0), 0);
      next[gi] = { ...next[gi], grades_planejadas, grade_total_planejada };
      return next;
    });
  };

  // --- mutations ---
  const saveAll = useMutation({
    mutationFn: async () => {
      // ensure cad row
      let cad_id = cadRow?.id as string | undefined;
      if (!cad_id) {
        const { data, error } = await supabase
          .from("cad")
          .insert({ modelo_id: modeloId, status_corte: "pendente" })
          .select("id")
          .single();
        if (error) throw error;
        cad_id = data.id;
      }
      // wipe & re-insert (simpler than diff)
      await supabase.from("cad_tecidos").delete().eq("cad_id", cad_id!);
      await supabase.from("cad_grades").delete().eq("cad_id", cad_id!);
      for (const t of tecidos) {
        const { data: ins, error } = await supabase
          .from("cad_tecidos")
          .insert({
            cad_id,
            artigo_id: t.artigo_id,
            numero: t.numero,
            tipo: t.tipo,
            consumo_cad: t.consumo_cad,
            loss_percent_cad: t.loss_percent_cad,
            custo_cad: t.custo_cad,
            tamanho_folha: t.tamanho_folha,
          })
          .select("id")
          .single();
        if (error) throw error;
        if (t.variantes.length > 0) {
          const payload = t.variantes.map((v) => ({
            cad_tecido_id: ins.id,
            variante_tecido_id: v.variante_tecido_id,
            ordem: v.ordem,
            quantidade_folhas: v.quantidade_folhas,
            metragem_planejada: v.metragem_planejada,
            metragem_enviada: v.metragem_enviada,
          }));
          const { error: ve } = await supabase.from("cad_tecido_variantes").insert(payload);
          if (ve) throw ve;
        }
      }
      if (grades.length > 0) {
        const { error: ge } = await supabase.from("cad_grades").insert(
          grades.map((g) => ({
            cad_id,
            variante_numero: g.variante_numero,
            grades_planejadas: g.grades_planejadas,
            grades_reais: g.grades_reais,
            grade_total_planejada: g.grade_total_planejada,
            grade_total_real: g.grade_total_real,
          })),
        );
        if (ge) throw ge;
      }
      return cad_id;
    },
    onSuccess: () => {
      toast.success("CAD salvo");
      qc.invalidateQueries({ queryKey: ["cad-row", modeloId] });
      qc.invalidateQueries({ queryKey: ["cad-tecidos"] });
      qc.invalidateQueries({ queryKey: ["cad-grades-rows"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  const enviarCorte = useMutation({
    mutationFn: async () => {
      const cad_id = (await saveAll.mutateAsync()) as string;
      const { error } = await supabase
        .from("cad")
        .update({ enviado_corte: true, data_enviado_corte: new Date().toISOString().slice(0, 10), status_corte: "em_corte" })
        .eq("id", cad_id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Enviado ao corte");
      qc.invalidateQueries({ queryKey: ["producao-cad-list"] });
      qc.invalidateQueries({ queryKey: ["cad-row", modeloId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });

  const tamanhosAll = useMemo(() => {
    const set = new Set<string>();
    grades.forEach((g) => {
      Object.keys(g.grades_planejadas).forEach((k) => set.add(k));
      Object.keys(g.grades_reais).forEach((k) => set.add(k));
    });
    return Array.from(set);
  }, [grades]);

  const firstPhoto = (modelo?.fotos_modelo as string[] | null)?.[0] ?? null;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link to="/producao/cad" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => saveAll.mutate()} disabled={saveAll.isPending}>
            <Save className="h-4 w-4 mr-1" /> Salvar
          </Button>
          <Button onClick={() => enviarCorte.mutate()} disabled={enviarCorte.isPending || !!cadRow?.enviado_corte}>
            <Send className="h-4 w-4 mr-1" /> {cadRow?.enviado_corte ? "Enviado ao corte" : "Enviar ao Corte"}
          </Button>
        </div>
      </div>

      {/* SEÇÃO 1 */}
      <Card className="p-5 flex gap-5">
        <div className="h-32 w-32 rounded-md bg-muted overflow-hidden flex items-center justify-center">
          {firstPhoto ? (
            <ModeloPhoto path={firstPhoto} />
          ) : (
            <ImageIcon className="h-8 w-8 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-3">
            <Scissors className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">{modelo?.nome ?? "—"}</h1>
            <Badge variant="outline" className="font-mono">{modelo?.ref ?? "sem REF"}</Badge>
          </div>
          <div className="text-sm text-muted-foreground grid grid-cols-2 gap-x-6 gap-y-1 mt-2">
            <span>Estilista: {modelo?.estilista?.nome ?? "—"}</span>
            <span>Coleção: {modelo?.colecao ?? "—"}</span>
            <span>Categoria: {modelo?.cat_p?.nome ?? "—"}</span>
            <span>Sub-categoria: {modelo?.cat_s?.nome ?? "—"}</span>
          </div>
        </div>
      </Card>

      {/* SEÇÃO 2 */}
      <Card className="p-5 space-y-4">
        <h2 className="font-semibold">Tecidos / Forros / Entretelas</h2>
        {tecidos.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum tecido planejado neste modelo.</p>
        )}
        {tecidos.map((t, i) => (
          <Card key={`${t.tipo}-${t.numero}-${i}`} className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="capitalize">{t.tipo} {t.numero}</Badge>
              <span className="text-sm font-medium">{t.artigo_nome ?? "Sem artigo"}</span>
              <span className="text-xs text-muted-foreground">(preço: R$ {t.preco.toFixed(2)}/m)</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Consumo CAD (m)">
                <Input type="number" step="0.01" value={t.consumo_cad}
                  onChange={(e) => updateTec(i, { consumo_cad: Number(e.target.value) })} />
              </Field>
              <Field label="% Loss CAD">
                <Input type="number" step="0.01" value={t.loss_percent_cad}
                  onChange={(e) => updateTec(i, { loss_percent_cad: Number(e.target.value) })} />
              </Field>
              <Field label="Custo CAD (R$)">
                <Input value={t.custo_cad.toFixed(2)} readOnly className="bg-muted" />
              </Field>
              <Field label="Tamanho da folha (m)">
                <Input type="number" step="0.01" value={t.tamanho_folha}
                  onChange={(e) => updateTec(i, { tamanho_folha: Number(e.target.value) })} />
              </Field>
            </div>
            {t.variantes.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-2 py-1 text-left">Variante</th>
                      <th className="px-2 py-1">Qtd Folhas</th>
                      <th className="px-2 py-1">Metr. Planejada</th>
                      <th className="px-2 py-1">Metr. Enviada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.variantes.map((v, j) => (
                      <tr key={`${v.variante_tecido_id}-${j}`} className="border-t">
                        <td className="px-2 py-1">{v.variante_nome ?? "—"}</td>
                        <td className="px-2 py-1">
                          <Input type="number" value={v.quantidade_folhas}
                            onChange={(e) => updateVar(i, j, { quantidade_folhas: Number(e.target.value) })} />
                        </td>
                        <td className="px-2 py-1">
                          <Input type="number" step="0.01" value={v.metragem_planejada}
                            onChange={(e) => updateVar(i, j, { metragem_planejada: Number(e.target.value) })} />
                        </td>
                        <td className="px-2 py-1">
                          <Input type="number" step="0.01" value={v.metragem_enviada}
                            onChange={(e) => updateVar(i, j, { metragem_enviada: Number(e.target.value) })} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ))}
      </Card>

      {/* SEÇÃO 3 */}
      <Card className="p-5 space-y-3">
        <h2 className="font-semibold">Grade Replanejada</h2>
        {grades.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma grade definida.</p>
        )}
        {grades.map((g, gi) => (
          <div key={g.variante_numero} className="space-y-2">
            <div className="text-sm font-medium">Variante {g.variante_numero}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-2 py-1 text-left">Tamanho</th>
                    {tamanhosAll.map((t) => <th key={t} className="px-2 py-1">{t}</th>)}
                    <th className="px-2 py-1">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="px-2 py-1 text-muted-foreground">Planejada</td>
                    {tamanhosAll.map((t) => (
                      <td key={t} className="px-2 py-1">
                        <Input type="number" value={g.grades_planejadas[t] ?? 0}
                          onChange={(e) => updateGradePlan(gi, t, Number(e.target.value))} />
                      </td>
                    ))}
                    <td className="px-2 py-1 font-medium text-center">{g.grade_total_planejada}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="px-2 py-1 text-muted-foreground">Real</td>
                    {tamanhosAll.map((t) => (
                      <td key={t} className="px-2 py-1">
                        <Input type="number" value={g.grades_reais[t] ?? 0}
                          onChange={(e) => updateGradeCell(gi, t, Number(e.target.value))} />
                      </td>
                    ))}
                    <td className="px-2 py-1 font-medium text-center">{g.grade_total_real}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function ModeloPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.storage.from("modelos").createSignedUrl(path, 3600).then(({ data }) => {
      if (alive && data?.signedUrl) setUrl(data.signedUrl);
    });
    return () => { alive = false; };
  }, [path]);
  return url ? <img src={url} alt="modelo" className="h-full w-full object-cover" /> : <ImageIcon className="h-8 w-8 text-muted-foreground" />;
}
