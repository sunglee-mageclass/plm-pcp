import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save, CheckCircle2, RotateCcw, Pencil } from "lucide-react";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { NumberInput } from "@/components/shared/NumberInput";
import { MatrizGradeResponsiva } from "@/components/shared/MatrizGradeResponsiva";

// CQ Pós (acabamento). Decisões do dono: NÃO recalcula grade real — só EXIBE a do Pré
// (base) e registra recebimento/conserto/defeito POR serviço de acabamento. Confirma
// independente do Pré. Salva via RPC salvar_cq_pos / desmarcar_cq_pos.

type PosEtapa = "recebimento" | "conserto" | "defeito";
const POS_ETAPAS: PosEtapa[] = ["recebimento", "conserto", "defeito"];
const ETAPA_LABEL: Record<PosEtapa, string> = { recebimento: "Recebimento", conserto: "Conserto", defeito: "Defeito" };

type PosRow = { grades: Record<string, number>; grade_total: number; destino_defeito?: string | null };
// serviceId -> etapa -> variante_numero -> PosRow
type PosState = Record<string, Record<PosEtapa, Record<number, PosRow>>>;
const emptySvc = (): Record<PosEtapa, Record<number, PosRow>> => ({ recebimento: {}, conserto: {}, defeito: {} });

export function CqPosView({
  cadId,
  tamanhos,
  variantList,
  labelByNumero,
  readOnly: permReadOnly,
}: {
  cadId: string;
  tamanhos: string[];
  variantList: { num: number }[];
  labelByNumero: Record<number, string>;
  readOnly: boolean;
}) {
  const qc = useQueryClient();
  const [posState, setPosState] = useState<PosState>({});
  const [obs, setObs] = useState("");
  const [statusPos, setStatusPos] = useState("pendente");
  const [editing, setEditing] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Baseline: grade real do CQ Pré (cad_grades.grades_reais) — leitura.
  const { data: cadGrades = [] } = useQuery({
    queryKey: ["cqpos-cadgrades", cadId],
    queryFn: async () =>
      (await supabase.from("cad_grades").select("variante_numero, grades_reais, grade_total_real").eq("cad_id", cadId)).data ?? [],
  });
  const realByNum = useMemo(() => {
    const m: Record<number, { grades: Record<string, number>; total: number }> = {};
    (cadGrades as any[]).forEach((g) => {
      m[Number(g.variante_numero)] = { grades: g.grades_reais ?? {}, total: Number(g.grade_total_real ?? 0) };
    });
    return m;
  }, [cadGrades]);

  // Serviços de acabamento (pós-costura), ativos.
  const { data: servicos = [] } = useQuery({
    queryKey: ["cqpos-servicos", cadId],
    queryFn: async () => {
      const { data } = await supabase
        .from("producao_terceirizados")
        .select("id, ativo, categorias_terceirizado(nome, etapa), terceirizado:terceirizado_id(nome_responsavel), colaborador:colaborador_id(nome)")
        .eq("cad_id", cadId);
      return (data ?? [])
        .filter((t: any) => t.ativo !== false && (t.categorias_terceirizado?.etapa ?? "ate_costura") === "pos_costura")
        .map((t: any) => ({
          id: t.id as string,
          categoria: t.categorias_terceirizado?.nome ?? "Serviço",
          responsavel: t.terceirizado?.nome_responsavel ?? t.colaborador?.nome ?? "—",
        }));
    },
  });

  // CQ existente (status_pos + observações) + itens do pós, p/ hidratar.
  const { data: cqRow, isFetched: cqFetched } = useQuery({
    queryKey: ["cqpos-cq", cadId],
    queryFn: async () =>
      (await supabase.from("controle_qualidade").select("id, status_pos, observacoes_cq_pos").eq("cad_id", cadId).maybeSingle()).data,
  });
  const cqId = (cqRow as any)?.id;
  const { data: posItens = [], isFetched: itensFetched } = useQuery({
    queryKey: ["cqpos-itens", cqId],
    enabled: !!cqId,
    queryFn: async () =>
      (await supabase.from("cq_pos_variantes" as any).select("*").eq("controle_qualidade_id", cqId)).data ?? [],
  });

  useEffect(() => {
    if (hydrated || !cqFetched) return;
    if (cqId && !itensFetched) return;
    if (cqRow) {
      setStatusPos((cqRow as any).status_pos ?? "pendente");
      setObs((cqRow as any).observacoes_cq_pos ?? "");
    }
    const st: PosState = {};
    (posItens as any[]).forEach((it) => {
      const et = it.etapa as PosEtapa;
      if (!POS_ETAPAS.includes(et)) return;
      const sid = it.producao_terceirizado_id as string;
      st[sid] ??= emptySvc();
      st[sid][et][it.variante_numero] = {
        grades: it.grades ?? {},
        grade_total: Number(it.grade_total ?? 0),
        destino_defeito: it.destino_defeito,
      };
    });
    setPosState(st);
    setHydrated(true);
  }, [cqRow, posItens, cqFetched, itensFetched, cqId, hydrated]);

  const confirmado = statusPos === "confirmado";
  const readOnly = permReadOnly || (confirmado && !editing);

  const rowOf = (sid: string, et: PosEtapa, num: number): PosRow =>
    posState[sid]?.[et]?.[num] ?? { grades: {}, grade_total: 0 };

  const setQtd = (sid: string, et: PosEtapa, num: number, tam: string, qtd: number) => {
    setPosState((s) => {
      const svc = s[sid] ?? emptySvc();
      const row = { ...(svc[et][num] ?? { grades: {}, grade_total: 0 }) };
      row.grades = { ...row.grades, [tam]: qtd };
      row.grade_total = Object.values(row.grades).reduce((a, v) => a + (Number(v) || 0), 0);
      return { ...s, [sid]: { ...svc, [et]: { ...svc[et], [num]: row } } };
    });
  };
  const setDestino = (sid: string, num: number, destino: "2_lote" | "cancelado") => {
    setPosState((s) => {
      const svc = s[sid] ?? emptySvc();
      const row = { ...(svc.defeito[num] ?? { grades: {}, grade_total: 0 }) };
      row.destino_defeito = row.destino_defeito === destino ? null : destino;
      return { ...s, [sid]: { ...svc, defeito: { ...svc.defeito, [num]: row } } };
    });
  };

  const buildItens = () => {
    const itens: any[] = [];
    (servicos as any[]).forEach((sv) => {
      POS_ETAPAS.forEach((et) => {
        variantList.forEach((v) => {
          const row = posState[sv.id]?.[et]?.[v.num];
          if (!row) return;
          const hasAny = row.grade_total > 0 || (et === "defeito" && row.destino_defeito);
          if (!hasAny) return;
          itens.push({
            producao_terceirizado_id: sv.id,
            variante_numero: v.num,
            etapa: et,
            grades: row.grades,
            grade_total: row.grade_total,
            destino_defeito: et === "defeito" ? row.destino_defeito ?? null : null,
          });
        });
      });
    });
    return itens;
  };

  const save = useMutation({
    mutationFn: async (confirmar: boolean) => {
      const { error } = await supabase.rpc("salvar_cq_pos" as any, {
        _cad_id: cadId,
        _cq_pos: { observacoes_cq_pos: obs || null, fotografado_variantes_pos: {} },
        _itens: buildItens(),
        _confirmar: confirmar,
      });
      if (error) throw error;
    },
    onSuccess: async (_d, confirmar) => {
      toast.success(confirmar ? "CQ Pós confirmado" : "Salvo com sucesso");
      setEditing(false);
      setHydrated(false);
      await qc.invalidateQueries({ queryKey: ["cqpos-cq", cadId] });
      await qc.invalidateQueries({ queryKey: ["cqpos-itens"] });
      await qc.invalidateQueries({ queryKey: ["producao-cq-list"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar")),
  });

  const desmarcar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("desmarcar_cq_pos" as any, { _cad_id: cadId });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Confirmação desmarcada");
      setEditing(false);
      setHydrated(false);
      await qc.invalidateQueries({ queryKey: ["cqpos-cq", cadId] });
      await qc.invalidateQueries({ queryKey: ["producao-cq-list"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao desmarcar")),
  });

  const variantes = variantList.map((v) => ({ num: v.num, label: labelByNumero[v.num] ?? `Variante ${v.num}` }));

  return (
    <div className="space-y-4">
      {/* Grade real do Pré (base do acabamento) — leitura. */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">Grade real (do CQ Pré)</h3>
          <Badge variant="secondary">base do acabamento</Badge>
        </div>
        <MatrizGradeResponsiva
          tamanhos={tamanhos}
          variantes={variantes}
          emptyLabel="Sem grade real — confirme o CQ Pré primeiro."
          total={(num) => realByNum[num]?.total ?? 0}
          renderCell={(num, t) => <div className="text-center text-sm">{realByNum[num]?.grades?.[t] ?? 0}</div>}
        />
      </Card>

      {(servicos as any[]).length === 0 && (
        <Card className="p-5 text-sm text-muted-foreground">
          Nenhum serviço de acabamento (pós-costura) neste modelo.
        </Card>
      )}

      <fieldset disabled={readOnly} className="contents">
        {(servicos as any[]).map((sv) => (
          <Card key={sv.id} className="p-5 space-y-4">
            <div>
              <h3 className="font-semibold text-lg">{sv.categoria}</h3>
              <p className="text-xs text-muted-foreground">{sv.responsavel}</p>
            </div>
            {POS_ETAPAS.map((et) => (
              <div key={et} className="space-y-2">
                <Label className="text-sm font-medium">{ETAPA_LABEL[et]}</Label>
                <MatrizGradeResponsiva
                  tamanhos={tamanhos}
                  variantes={variantes}
                  emptyLabel="Sem variantes no Tecido Principal."
                  total={(num) => rowOf(sv.id, et, num).grade_total}
                  renderCell={(num, t) => (
                    <NumberInput
                      type="number"
                      className="h-8 w-full border-0 text-center"
                      value={rowOf(sv.id, et, num).grades?.[t] ?? ""}
                      onChange={(e) => setQtd(sv.id, et, num, t, Number(e.target.value) || 0)}
                    />
                  )}
                  extraHeader={et === "defeito" ? "Ação" : undefined}
                  renderExtra={
                    et === "defeito"
                      ? (num) => {
                          const d = rowOf(sv.id, "defeito", num).destino_defeito;
                          return (
                            <div className="flex gap-1">
                              <Button type="button" size="sm" variant={d === "2_lote" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setDestino(sv.id, num, "2_lote")}>2º Lote</Button>
                              <Button type="button" size="sm" variant={d === "cancelado" ? "destructive" : "outline"} className="h-7 text-xs" onClick={() => setDestino(sv.id, num, "cancelado")}>Cancelado</Button>
                            </div>
                          );
                        }
                      : undefined
                  }
                />
              </div>
            ))}
          </Card>
        ))}

        <Card className="p-5 space-y-2">
          <Label className="text-sm font-medium">Observações do CQ Pós</Label>
          <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3} />
        </Card>
      </fieldset>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {confirmado && !editing ? (
          <>
            <Button variant="outline" size="icon" onClick={() => setEditing(true)} disabled={permReadOnly} aria-label="Editar">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => desmarcar.mutate()} disabled={permReadOnly || desmarcar.isPending}>
              <RotateCcw className="h-4 w-4 mr-2" /> Desmarcar confirmação
            </Button>
          </>
        ) : (
          <>
            {editing && (
              <Button variant="ghost" onClick={() => { setEditing(false); setHydrated(false); }}>Cancelar</Button>
            )}
            <Button variant="outline" onClick={() => save.mutate(false)} disabled={permReadOnly || save.isPending}>
              <Save className="h-4 w-4 mr-2" /> Salvar
            </Button>
            <Button onClick={() => save.mutate(true)} disabled={permReadOnly || save.isPending || (servicos as any[]).length === 0}>
              <CheckCircle2 className="h-4 w-4 mr-2" /> Confirmar CQ Pós
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
