import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageIcon, Scissors } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ModeloPhoto } from "@/components/producao/cad/shared";
import { calcCusto } from "@/components/producao/cad/types";
import type {
  AviamentoRow,
  GradeRow,
  TecidoRow,
  TipoTec,
  VarianteRow,
} from "@/components/producao/cad/types";
import { CadActions } from "@/components/producao/cad/CadActions";
import { CadTecidosSection } from "@/components/producao/cad/CadTecidosSection";
import { CadGradeSection } from "@/components/producao/cad/CadGradeSection";
import { CadExplosaoSection } from "@/components/producao/cad/CadExplosaoSection";
import { CadFichaCorte } from "@/components/producao/cad/CadFichaCorte";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useReadOnly } from "@/components/RequirePermission";
import { VersaoBadge } from "@/components/shared/VersaoBadge";

export const Route = createFileRoute("/_authenticated/producao/cad/$modeloId")({
  component: CadDetailPage,
});

function CadDetailPage() {
  const { modeloId } = Route.useParams();
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const navigate = useNavigate();
  const [confirmDel, setConfirmDel] = useState(false);

  // --- queries ---
  const { data: modelo } = useQuery({
    queryKey: ["cad-modelo", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select(
          "*, estilista:estilista_id(nome), linha:linha_id(nome), cat_p:categoria_principal_id(nome), cat_s:categoria_secundaria_id(nome)",
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

  // Ordem canônica dos tamanhos (mesma do Desenvolvimento), p/ a grade não sair fora de ordem.
  const { data: tenantCfg } = useQuery({
    queryKey: ["cad-tenant-config-grade"],
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("tamanhos_grade").maybeSingle();
      return data;
    },
  });

  const { data: modeloTecidos = [] } = useQuery({
    queryKey: ["cad-modelo-tecidos", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_tecidos")
        .select(
          "id, numero, tipo, artigo_id, consumo, loss_percent, artigos:artigo_id(nome, preco_por_metro, unidade_medida, etiqueta_lavagem_urls, largura_estimada), modelo_tecido_variantes(id, variante_tecido_id, ordem, multiplicador, variantes_tecido:variante_tecido_id(nome_variante, codigo_variante, cor:cor_id(nome)))",
        )
        .eq("modelo_id", modeloId)
        .order("tipo")
        .order("numero");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: cadTecidos = [], isFetched: cadTecidosFetched } = useQuery({
    queryKey: ["cad-tecidos", cadRow?.id],
    enabled: !!cadRow?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cad_tecidos")
        .select(
          "*, artigos:artigo_id(nome, preco_por_metro, unidade_medida, etiqueta_lavagem_urls, largura_estimada), cad_tecido_variantes(*, variantes_tecido:variante_tecido_id(nome_variante, codigo_variante, cor:cor_id(nome)))",
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

  // OCs vinculadas no Desenvolvimento, p/ exibir na ficha (na ordem de prioridade).
  const { data: ocLinks = [] } = useQuery({
    queryKey: ["cad-oc-links", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_tecido_oc_links" as any)
        .select("tipo, numero, ordem, variante_tecido_id, prioridade, oc_item:oc_tecido_item_id(ocs_tecido:oc_tecido_id(numero_pedido))")
        .eq("modelo_id", modeloId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const ocLinksByKey = useMemo(() => {
    const tmp: Record<string, { prioridade: number; num: string }[]> = {};
    for (const l of ocLinks as any[]) {
      const num = l.oc_item?.ocs_tecido?.numero_pedido;
      if (!num) continue;
      const key = `${l.tipo}-${l.numero}-${l.ordem}-${l.variante_tecido_id}`;
      (tmp[key] ??= []).push({ prioridade: Number(l.prioridade ?? 1), num });
    }
    const out: Record<string, string[]> = {};
    Object.entries(tmp).forEach(([k, arr]) => {
      out[k] = arr.sort((a, b) => a.prioridade - b.prioridade).map((x) => x.num);
    });
    return out;
  }, [ocLinks]);
  const { data: cadGrades = [], isFetched: cadGradesFetched } = useQuery({
    queryKey: ["cad-grades-rows", cadRow?.id],
    enabled: !!cadRow?.id,
    queryFn: async () => {
      const { data } = await supabase.from("cad_grades").select("*").eq("cad_id", cadRow!.id);
      return data ?? [];
    },
  });

  const { data: modeloAviamentos = [] } = useQuery({
    queryKey: ["cad-modelo-aviamentos", modeloId],
    queryFn: async () => {
      const { data } = await supabase
        .from("modelo_aviamentos")
        .select("id, numero, aviamento_id, consumo, aviamentos:aviamento_id(codigo_nome)")
        .eq("modelo_id", modeloId)
        .order("numero");
      return data ?? [];
    },
  });
  const { data: cadAviamentos = [], isFetched: cadAviamentosFetched } = useQuery({
    queryKey: ["cad-aviamentos-rows", cadRow?.id],
    enabled: !!cadRow?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("cad_aviamentos")
        .select("*, aviamentos:aviamento_id(codigo_nome)")
        .eq("cad_id", cadRow!.id)
        .order("numero");
      return data ?? [];
    },
  });

  // --- local editable state, seeded from cad rows or modelo defaults ---
  const [tecidos, setTecidos] = useState<TecidoRow[]>([]);
  const [grades, setGrades] = useState<GradeRow[]>([]);
  const [aviamentos, setAviamentos] = useState<AviamentoRow[]>([]);
  const [previsaoEntrega, setPrevisaoEntrega] = useState("");
  const [seeded, setSeeded] = useState(false);
  // Grade automática pela proporção (mesma lógica do Desenvolvimento).
  const [gradeAuto, setGradeAuto] = useState(false);
  // Cálculo automático de folhas/metragem (a partir de consumo + grade + proporção + largura).
  const [autoFolhas, setAutoFolhas] = useState(false);
  // Proporções por tamanho (compartilhadas com o modelo / Desenvolvimento).
  const [proporcoes, setProporcoes] = useState<Record<string, number>>({});

  useEffect(() => {
    if (seeded) return;
    if (!modelo) return;
    if (cadRow === undefined) return;
    // Se já existe um CAD, espera as queries do CAD terminarem de buscar antes de
    // semear (evita semear do fallback enquanto o cad_* ainda carrega). Quando o
    // CAD existir mas vier vazio, cai no fallback de modelo_tecidos/grades/aviamentos.
    if (cadRow?.id && !(cadTecidosFetched && cadGradesFetched && cadAviamentosFetched)) {
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
        largura: Number(t.artigos?.largura_estimada ?? 0),
        artigo_nome: t.artigos?.nome ? (t.artigos?.unidade_medida ? `${t.artigos.nome} [${t.artigos.unidade_medida}]` : t.artigos.nome) : null,
        etiqueta_lavagem_urls: (t.artigos?.etiqueta_lavagem_urls ?? []) as string[],
        variantes: (t.cad_tecido_variantes ?? []).map((v: any) => ({
          id: v.id,
          variante_tecido_id: v.variante_tecido_id,
          variante_nome: v.variantes_tecido?.nome_variante ?? v.variantes_tecido?.codigo_variante,
          variante_cor: v.variantes_tecido?.cor?.nome ?? null,
          multiplicador: Number(v.multiplicador ?? 1) || 1,
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
          largura: Number(mt.artigos?.largura_estimada ?? 0),
          artigo_nome: mt.artigos?.nome ? (mt.artigos?.unidade_medida ? `${mt.artigos.nome} [${mt.artigos.unidade_medida}]` : mt.artigos.nome) : null,
          etiqueta_lavagem_urls: (mt.artigos?.etiqueta_lavagem_urls ?? []) as string[],
          variantes: (mt.modelo_tecido_variantes ?? []).map((v: any) => ({
            variante_tecido_id: v.variante_tecido_id,
            variante_nome: v.variantes_tecido?.nome_variante ?? v.variantes_tecido?.codigo_variante,
            variante_cor: v.variantes_tecido?.cor?.nome ?? null,
            multiplicador: Number(v.multiplicador ?? 1) || 1,
            ordem: v.ordem,
            quantidade_folhas: 0,
            metragem_planejada: 0,
            metragem_enviada: 0,
          })),
        };
      });
    }
    setTecidos(initialTec);

    // Grade única, = a do modelo (modelo_grades). Acompanha as variantes do
    // Tecido 1 (inclusive as ainda sem grade), rotuladas por cor.
    const t1 = initialTec.find((t) => t.tipo === "tecido" && t.numero === 1);
    const t1vars = (t1?.variantes ?? [])
      .filter((v) => v.variante_tecido_id)
      .slice()
      .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    const gradeByNum = new Map<number, any>();
    (modeloGrades as any[]).forEach((g) => gradeByNum.set(g.variante_numero, g));

    let initialGrades: GradeRow[];
    if (t1vars.length > 0) {
      initialGrades = t1vars.map((v) => {
        const g = gradeByNum.get(v.ordem);
        return { variante_numero: v.ordem, grades: g?.grades ?? {}, grade_total: g?.grade_total ?? 0 };
      });
    } else {
      initialGrades = (modeloGrades as any[]).map((g) => ({
        variante_numero: g.variante_numero,
        grades: g.grades ?? {},
        grade_total: g.grade_total ?? 0,
      }));
    }
    setGrades(initialGrades);
    setProporcoes((modelo.proporcoes ?? {}) as Record<string, number>);

    const gradeTotalGeral = initialGrades.reduce((a, g) => a + (g.grade_total || 0), 0);

    let initialAvi: AviamentoRow[];
    if ((cadAviamentos as any[]).length > 0) {
      initialAvi = (cadAviamentos as any[]).map((a) => ({
        id: a.id,
        numero: a.numero,
        aviamento_id: a.aviamento_id,
        aviamento_nome: a.aviamentos?.codigo_nome,
        consumo: Number(a.consumo ?? 0),
        grade_total: gradeTotalGeral,
        quantidade_enviar: Number(a.quantidade_enviar ?? 0),
        quantidade_separar: Number(a.quantidade_separar ?? 0),
      }));
    } else {
      initialAvi = (modeloAviamentos as any[]).map((ma) => {
        const consumo = Number(ma.consumo ?? 0);
        const qEnviar = Number((consumo * gradeTotalGeral).toFixed(4));
        return {
          numero: ma.numero,
          aviamento_id: ma.aviamento_id,
          aviamento_nome: ma.aviamentos?.codigo_nome,
          consumo,
          grade_total: gradeTotalGeral,
          quantidade_enviar: qEnviar,
          quantidade_separar: qEnviar,
        };
      });
    }
    setAviamentos(initialAvi);

    if (cadRow?.data_previsao_corte) setPrevisaoEntrega(cadRow.data_previsao_corte);

    setSeeded(true);
  }, [modelo, cadRow, cadTecidos, modeloTecidos, cadGrades, modeloGrades, cadAviamentos, modeloAviamentos, cadTecidosFetched, cadGradesFetched, cadAviamentosFetched, seeded]);

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
      const propTam = Number(proporcoes[tamanho]) || 0;
      let grades: Record<string, number>;
      if (gradeAuto && value > 0 && propTam > 0) {
        // Âncora: célula digitada define a unidade (valor/proporção dela); demais
        // por proporção. Ex.: PPP=30 com 1·1·2·2·2·1 -> 30·30·60·60·60·30.
        const unit = value / propTam;
        grades = {};
        tamanhosAll.forEach((t) => { grades[t] = Math.round(unit * (Number(proporcoes[t]) || 0)); });
        grades[tamanho] = value;
      } else {
        grades = { ...next[gi].grades, [tamanho]: value };
      }
      const grade_total = Object.values(grades).reduce((a, b) => a + (Number(b) || 0), 0);
      next[gi] = { ...next[gi], grades, grade_total };
      return next;
    });
  };
  const updateProporcao = (tam: string, val: number) => {
    const oldProp = proporcoes;
    const newProp = { ...oldProp, [tam]: Math.max(0, val) };
    setProporcoes(newProp);
    // Com cálculo automático ativo, redistribui a grade mantendo a escala.
    if (gradeAuto) {
      const oldSum = tamanhosAll.reduce((s, t) => s + (Number(oldProp[t]) || 0), 0);
      if (oldSum > 0) {
        setGrades((gs) => gs.map((g) => {
          const total = g.grade_total || 0;
          if (total <= 0) return g;
          const unit = total / oldSum;
          const grades: Record<string, number> = {};
          tamanhosAll.forEach((t) => { grades[t] = Math.round(unit * (Number(newProp[t]) || 0)); });
          const gt = tamanhosAll.reduce((s, t) => s + (grades[t] || 0), 0);
          return { ...g, grades, grade_total: gt };
        }));
      }
    }
  };
  const updateAvi = (i: number, patch: Partial<AviamentoRow>) => {
    setAviamentos((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  };

  // --- mutations ---
  const saveAll = useMutation({
    mutationFn: async () => {
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
            multiplicador: Number(v.multiplicador ?? 1) || 1,
            quantidade_folhas: v.quantidade_folhas,
            metragem_planejada: v.metragem_planejada,
            metragem_enviada: v.metragem_enviada,
          }));
          const { error: ve } = await supabase.from("cad_tecido_variantes").insert(payload);
          if (ve) throw ve;
        }
      }
      // Grade ÚNICA: grava direto em modelo_grades (compartilhada com o
      // Desenvolvimento) + proporções no modelo. O que muda aqui reflete lá e
      // recalcula a reserva de estoque.
      await supabase.from("modelos").update({ proporcoes }).eq("id", modeloId);
      await supabase.from("modelo_grades").delete().eq("modelo_id", modeloId);
      const gradesToSave = grades.filter(
        (g) => (g.grade_total || 0) > 0 || Object.values(g.grades || {}).some((v) => (Number(v) || 0) > 0),
      );
      if (gradesToSave.length > 0) {
        const { error: ge } = await supabase.from("modelo_grades").insert(
          gradesToSave.map((g) => ({
            modelo_id: modeloId,
            variante_numero: g.variante_numero,
            grades: g.grades,
            grade_total: g.grade_total,
          })),
        );
        if (ge) throw ge;
      }
      // Espelha a grade única em cad_grades (planejada = real = grade), pois
      // Direcionamento e Oficina ainda leem dessa tabela.
      if (gradesToSave.length > 0) {
        const { error: gce } = await supabase.from("cad_grades").insert(
          gradesToSave.map((g) => ({
            cad_id,
            variante_numero: g.variante_numero,
            grades_planejadas: g.grades,
            grades_reais: g.grades,
            grade_total_planejada: g.grade_total,
            grade_total_real: g.grade_total,
          })),
        );
        if (gce) throw gce;
      }
      await supabase.from("cad_aviamentos").delete().eq("cad_id", cad_id!);
      if (aviamentos.length > 0) {
        const { error: ae } = await supabase.from("cad_aviamentos").insert(
          aviamentos.map((a) => ({
            cad_id,
            aviamento_id: a.aviamento_id,
            numero: a.numero,
            consumo: a.consumo,
            quantidade_enviar: a.quantidade_enviar,
            quantidade_separar: a.quantidade_separar,
          })),
        );
        if (ae) throw ae;
      }
      if (previsaoEntrega) {
        await supabase.from("cad").update({ data_previsao_corte: previsaoEntrega }).eq("id", cad_id!);
      }
      return cad_id;
    },
    onSuccess: () => {
      toast.success("CAD salvo");
      qc.invalidateQueries({ queryKey: ["cad-row", modeloId] });
      qc.invalidateQueries({ queryKey: ["cad-tecidos"] });
      qc.invalidateQueries({ queryKey: ["cad-aviamentos-rows"] });
      // Grade/proporção são compartilhadas: atualiza o que o Desenvolvimento lê.
      qc.invalidateQueries({ queryKey: ["cad-modelo-grades", modeloId] });
      qc.invalidateQueries({ queryKey: ["cad-modelo", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-grades", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-detail", modeloId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  const enviarCorte = useMutation({
    mutationFn: async () => {
      const cad_id = (await saveAll.mutateAsync()) as string;
      const { error } = await supabase
        .from("cad")
        .update({ enviado_corte: true, data_enviado_corte: new Date().toISOString().slice(0, 10), status_corte: "enviado" })
        .eq("id", cad_id);
      if (error) throw error;
      const { error: eBx } = await supabase.rpc("baixar_estoque_tecido_corte" as any, { _cad_id: cad_id });
      if (eBx) throw eBx;
    },
    onSuccess: () => {
      toast.success("Enviado ao corte");
      qc.invalidateQueries({ queryKey: ["producao-cad-list"] });
      qc.invalidateQueries({ queryKey: ["cad-row", modeloId] });
      qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });

  const desmarcarEnvio = useMutation({
    mutationFn: async () => {
      if (!cadRow?.id) return;
      // Reverte a baixa de estoque e devolve o CAD ao estado editável.
      const { error: eDel } = await supabase.from("estoque_tecido_baixas").delete().eq("cad_id", cadRow.id);
      if (eDel) throw eDel;
      const { error } = await supabase
        .from("cad")
        .update({ enviado_corte: false, data_enviado_corte: null, status_corte: "pendente" })
        .eq("id", cadRow.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Envio desmarcado — CAD voltou a editável");
      qc.invalidateQueries({ queryKey: ["producao-cad-list"] });
      qc.invalidateQueries({ queryKey: ["cad-row", modeloId] });
      qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao desmarcar"),
  });
  const handleDesmarcar = () => {
    if (window.confirm("Desmarcar o envio ao corte? A baixa de estoque será revertida e o CAD volta a ficar editável.")) {
      desmarcarEnvio.mutate();
    }
  };

  const tamanhosConfig = useMemo<string[]>(() => {
    const raw = (tenantCfg as any)?.tamanhos_grade;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map((x: any) => (typeof x === "string" ? x : (x?.nome ?? x?.label ?? String(x))));
    }
    return ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];
  }, [tenantCfg]);

  const tamanhosAll = useMemo(() => {
    // Ordem = config do tenant; tamanhos presentes fora da config vão ao final.
    const present = new Set<string>();
    Object.keys(proporcoes).forEach((k) => present.add(k));
    grades.forEach((g) => Object.keys(g.grades).forEach((k) => present.add(k)));
    const result = [...tamanhosConfig];
    present.forEach((t) => { if (!result.includes(t)) result.push(t); });
    return result;
  }, [grades, proporcoes, tamanhosConfig]);

  const gradeLabelByNumero = useMemo(() => {
    const t1 = tecidos.find((t) => t.tipo === "tecido" && t.numero === 1);
    const m: Record<number, string> = {};
    (t1?.variantes ?? []).forEach((v) => {
      const cor = v.variante_cor || v.variante_nome || "—";
      if (v.ordem) m[v.ordem] = `Variante ${v.ordem} — ${cor}`;
    });
    return m;
  }, [tecidos]);

  const gradeTotalGeral = useMemo(
    () => grades.reduce((a, g) => a + (g.grade_total || 0), 0),
    [grades],
  );

  // Cálculo automático (quando ligado): por variante, qtd de folhas e metragem
  // planejada; por tecido, tamanho da folha. Tudo derivado de consumo + grade +
  // proporção + largura. metragem_enviada continua manual.
  const sumProporcoes = useMemo(
    () => Object.values(proporcoes).reduce((a, b) => a + (Number(b) || 0), 0),
    [proporcoes],
  );
  const gradeTotalByNumero = (n: number) => grades.find((g) => g.variante_numero === n)?.grade_total ?? 0;
  const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  // Cálculo automático GRAVA os valores no estado (prevalecem; ao desligar o
  // check eles ficam e podem ser ajustados à mão). Converge via guarda `changed`.
  useEffect(() => {
    if (!autoFolhas) return;
    setTecidos((prev) => {
      let changed = false;
      const next = prev.map((t) => {
        const variantes = t.variantes.map((v) => {
          const mult = Number(v.multiplicador ?? 1) || 1;
          const pecas = gradeTotalByNumero(v.ordem) * mult;
          const quantidade_folhas = sumProporcoes > 0 ? round2(pecas / sumProporcoes) : 0;
          const metragem_planejada = round2(pecas * (t.consumo_cad || 0));
          if (v.quantidade_folhas !== quantidade_folhas || v.metragem_planejada !== metragem_planejada) changed = true;
          return { ...v, quantidade_folhas, metragem_planejada };
        });
        const totalMetragem = variantes.reduce((a, v) => a + v.metragem_planejada, 0);
        const totalFolhas = variantes.reduce((a, v) => a + v.quantidade_folhas, 0);
        const a = totalFolhas > 0 ? totalMetragem / totalFolhas : 0;
        const largura = Number(t.largura || 0);
        const tamanho_folha = largura > 0 ? round2(a / largura) : 0;
        if (t.tamanho_folha !== tamanho_folha) changed = true;
        return { ...t, variantes, tamanho_folha };
      });
      return changed ? next : prev;
    });
  }, [autoFolhas, grades, proporcoes, tecidos]);

  useEffect(() => {
    setAviamentos((prev) => prev.map((a) => {
      const qEnviar = Number((a.consumo * gradeTotalGeral).toFixed(4));
      return { ...a, grade_total: gradeTotalGeral, quantidade_enviar: qEnviar };
    }));
  }, [gradeTotalGeral]);

  const firstPhoto = (modelo?.fotos_modelo as string[] | null)?.[0] ?? null;
  const handlePrint = () => window.print();

  const [confirmZeroOpen, setConfirmZeroOpen] = useState(false);
  const variantesZeradas = useMemo(() => {
    let n = 0;
    for (const t of tecidos) {
      for (const v of t.variantes) {
        if (Number(v.metragem_planejada ?? 0) > 0 && Number(v.metragem_enviada ?? 0) === 0) n += 1;
      }
    }
    return n;
  }, [tecidos]);

  const handleEnviar = () => {
    if (variantesZeradas > 0) {
      setConfirmZeroOpen(true);
      return;
    }
    enviarCorte.mutate();
  };

  const excluirCad = useMutation({
    mutationFn: async () => {
      // Apaga o CAD (cad_tecidos/grades/aviamentos e etapas de produção caem por
      // ON DELETE CASCADE; trava se houver lançamentos) e devolve o modelo ao Dev.
      if (cadRow?.id) {
        const { error } = await supabase.from("cad").delete().eq("id", cadRow.id);
        if (error) throw error;
      }
      const { error: e2 } = await supabase.from("modelos").update({ enviado_cad: false }).eq("id", modeloId);
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("CAD excluído. O modelo voltou para o Desenvolvimento.");
      qc.invalidateQueries({ queryKey: ["producao-cad-list"] });
      navigate({ to: "/producao/cad" });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao excluir CAD"),
  });

  return (
    <>
      <div className="container mx-auto p-6 space-y-6 no-print">
        <CadActions
          onPrint={handlePrint}
          onSave={() => saveAll.mutate()}
          onEnviar={handleEnviar}
          onDesmarcar={handleDesmarcar}
          onExcluir={() => setConfirmDel(true)}
          saving={saveAll.isPending}
          enviando={enviarCorte.isPending}
          enviado={!!cadRow?.enviado_corte}
          dataEnviado={cadRow?.data_enviado_corte}
          readOnly={readOnly}
        />

        <fieldset disabled={readOnly} className="contents">
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
              <VersaoBadge versao={modelo?.versao} />
            </div>
            <div className="text-sm text-muted-foreground grid grid-cols-2 gap-x-6 gap-y-1 mt-2">
              <span className="col-span-2">Estilista: {modelo?.estilista?.nome ?? "—"}</span>
              <span>Coleção: {modelo?.colecao ?? "—"}</span>
              <span>Linha: {modelo?.linha?.nome ?? "—"}</span>
              <span>Categoria: {modelo?.cat_p?.nome ?? "—"}</span>
              {(modelo?.cat_p?.nome ?? "").toLowerCase() === "conjunto" && (
                <span>Sub-categoria: {modelo?.cat_s?.nome ?? "—"}</span>
              )}
            </div>
          </div>
        </Card>

        <CadTecidosSection
          tecidos={tecidos}
          updateTec={updateTec}
          updateVar={updateVar}
          autoFolhas={autoFolhas}
          onToggleAutoFolhas={setAutoFolhas}
        />

        <CadGradeSection
          grades={grades}
          tamanhosAll={tamanhosAll}
          updateGradeCell={updateGradeCell}
          labelByNumero={gradeLabelByNumero}
          gradeAuto={gradeAuto}
          onToggleGradeAuto={setGradeAuto}
          proporcoes={proporcoes}
          onChangeProporcao={updateProporcao}
        />

        <CadExplosaoSection
          aviamentos={aviamentos}
          gradeTotalGeral={gradeTotalGeral}
          updateAvi={updateAvi}
        />
        </fieldset>
      </div>

      {/* Ficha sempre montada (oculta fora da impressão) — também imprime depois de enviado. */}
      <CadFichaCorte
        modelo={modelo}
        cadRow={cadRow}
        previsaoEntrega={previsaoEntrega}
        tecidos={tecidos}
        grades={grades}
        tamanhosAll={tamanhosAll}
        aviamentos={aviamentos}
        gradeTotalGeral={gradeTotalGeral}
        labelByNumero={gradeLabelByNumero}
        ocLinksByKey={ocLinksByKey}
      />

      <AlertDialog open={confirmZeroOpen} onOpenChange={setConfirmZeroOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Variantes sem metragem enviada</AlertDialogTitle>
            <AlertDialogDescription>
              {variantesZeradas} variante(s) com metragem planejada estão com metragem enviada = 0.
              A baixa de estoque ficará zerada para elas. Enviar mesmo assim?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmZeroOpen(false);
                enviarCorte.mutate();
              }}
            >
              Enviar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o CAD deste modelo?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove o CAD (tecidos, grade, aviamentos e etapas de produção vinculadas) e
              devolve o modelo ao <strong>Desenvolvimento</strong>, onde poderá ser enviado ao
              CAD novamente. Não é possível excluir se já houver lançamentos. Esta ação não pode
              ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setConfirmDel(false); excluirCad.mutate(); }}
            >
              Excluir CAD
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
