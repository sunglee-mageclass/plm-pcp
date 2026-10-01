import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { decidirStatusServidor, deveReaplicarStatusAposErro, statusCqDe } from "@/lib/cq-status-tela";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { NumberInput } from "@/components/shared/NumberInput";
import { DateField } from "@/components/shared/DateField";
import { MatrizGradeResponsiva } from "@/components/shared/MatrizGradeResponsiva";

const fmtData = (d?: string | null) => (d ? d.split("-").reverse().join("/") : "—");

// CQ Pós (acabamento). Decisões do dono: NÃO recalcula grade real — só EXIBE a do Pré
// (base) e registra recebimento/conserto/defeito POR serviço de acabamento. Confirma
// independente do Pré. Salva via RPC salvar_cq_pos / desmarcar_cq_pos.

type PosEtapa = "recebimento" | "conserto" | "defeito";
// Defeito escondido por ora (a pedido do dono); o tipo/tabela mantêm suporte p/ retomar.
const POS_ETAPAS: PosEtapa[] = ["recebimento", "conserto"];
const ETAPA_LABEL: Record<PosEtapa, string> = { recebimento: "Recebimento", conserto: "Conserto", defeito: "Defeito" };

type PosRow = { grades: Record<string, number>; grade_total: number; destino_defeito?: string | null };
// serviceId -> etapa -> variante_numero -> PosRow
type PosState = Record<string, Record<PosEtapa, Record<number, PosRow>>>;
const emptySvc = (): Record<PosEtapa, Record<number, PosRow>> => ({ recebimento: {}, conserto: {}, defeito: {} });

// Ações expostas ao CQ detalhe (que renderiza os botões do Pós na MESMA barra do Pré).
export type CqPosHandle = {
  save: (confirmar: boolean) => void;
  desmarcar: () => void;
  edit: () => void;
  cancel: () => void;
};
export type CqPosStatus = { confirmado: boolean; editing: boolean; pending: boolean; hasServicos: boolean; hydrated: boolean };

export const CqPosView = forwardRef<CqPosHandle, {
  cadId: string;
  tamanhos: string[];
  variantList: { num: number }[];
  labelByNumero: Record<number, string>;
  readOnly: boolean;
  onStatus?: (s: CqPosStatus) => void;
}>(function CqPosView({ cadId, tamanhos, variantList, labelByNumero, readOnly: permReadOnly, onStatus }, ref) {
  const qc = useQueryClient();
  const [posState, setPosState] = useState<PosState>({});
  // Datas do Conserto POR SERVIÇO (editável): { [serviceId]: {enviado, prevista, entregue} }.
  type ConsertoDatas = Record<string, { enviado?: string | null; prevista?: string | null; entregue?: string | null }>;
  const [consertoDatas, setConsertoDatas] = useState<ConsertoDatas>({});
  const [obs, setObs] = useState("");
  const [statusPos, setStatusPos] = useState("pendente");
  const [editing, setEditing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // R14 (L7 / M1·M-A·M-C): o Pós também pode ser rebaixado/confirmado em outra tela (prod #5: desmarcar o Pré rebaixa o
  // Pós). `tocado` = o usuário digitou algo desde a última hidratação (esta tela não tem snapshot de "sujo").
  const tocadoRef = useRef(false);

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
  // Fix hidratação rodada 1 (achado I1): idem — throw em erro (era engolido).
  const { data: servicos = [], isFetched: servicosFetched, isFetching: servicosFetching, isSuccess: servicosOk, isError: servicosErrored, refetch: refetchServicos } = useQuery({
    queryKey: ["cqpos-servicos", cadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("producao_terceirizados")
        .select("id, ativo, data_enviado, data_prevista, data_entregue, categorias_terceirizado(nome, etapa), empresa:empresa_id(nome_fantasia), colaborador:colaborador_id(nome)")
        .eq("cad_id", cadId);
      if (error) throw error;
      return (data ?? [])
        .filter((t: any) => t.ativo !== false && (t.categorias_terceirizado?.etapa ?? "ate_costura") === "pos_costura")
        .map((t: any) => ({
          id: t.id as string,
          categoria: t.categorias_terceirizado?.nome ?? "Serviço",
          responsavel: t.empresa?.nome_fantasia ?? t.colaborador?.nome ?? "—",
          // Datas do serviço (de Serviços) — refletidas no Recebimento (read-only).
          enviado: t.data_enviado ?? null,
          prevista: t.data_prevista ?? null,
          entregue: t.data_entregue ?? null,
        }));
    },
  });

  // CQ existente (status_pos + observações) + itens do pós, p/ hidratar.
  // Fix hidratação rodada 1 (achado I1): `if (error) throw error` — o queryFn engolia o erro
  // (`return data` sem checar), e uma falha de rede virava "sem CQ Pós" (cqRow=null), semeando
  // como se o servidor estivesse vazio.
  const { data: cqRow, isFetched: cqFetched, isFetching: cqFetching, isSuccess: cqOk, isError: cqErrored, refetch: refetchCqPos } = useQuery({
    queryKey: ["cqpos-cq", cadId],
    queryFn: async () => {
      const { data, error } = await supabase.from("controle_qualidade").select("id, status_pos, observacoes_cq_pos, datas_conserto_pos").eq("cad_id", cadId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const cqId = (cqRow as any)?.id;
  const { data: posItens = [], isFetched: itensFetched, isFetching: itensFetching, isSuccess: itensOk, isError: itensErrored, refetch: refetchItens } = useQuery({
    queryKey: ["cqpos-itens", cqId],
    enabled: !!cqId,
    queryFn: async () => {
      const { data, error } = await supabase.from("cq_pos_variantes").select("*").eq("controle_qualidade_id", cqId);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Só hidrata quando as queries ASSENTARAM (isFetched && !isFetching): re-hidratar do
  // cache antigo enquanto o refetch corria travava o status no valor anterior (o botão
  // Confirmar/Desmarcar só mudava ao sair e voltar).
  // Fix hidratação rodada 1 (achado C1 da revisão): `servicos` (producao_terceirizados)
  // entra no gate — é a query que `buildItens()` percorre para montar o payload do Salvar.
  // Sem isso, `hydrated` virava true com `servicos=[]` (ainda em voo) e o Salvar mandava
  // `_itens: []`, que `_salvar_cq_pos_core` grava como DELETE incondicional de
  // `cq_pos_variantes` (apaga todo o Pós já confirmado em silêncio).
  // Fix hidratação rodada 1 (achado I1): exige `isSuccess` das 3 queries — `isFetched` sozinho
  // também fica true depois de erro (TanStack v5); sem isso, uma falha de rede hidratava como
  // "sem CQ Pós" (mesma classe do C1, só que via erro em vez de corrida).
  const hasLoadError = cqErrored || itensErrored || servicosErrored;
  useEffect(() => {
    if (hydrated) return;
    if (!cqFetched || cqFetching || !cqOk) return;
    if (cqId && (!itensFetched || itensFetching || !itensOk)) return;
    if (!servicosFetched || servicosFetching || !servicosOk) return;
    if (cqRow) {
      setStatusPos((cqRow as any).status_pos ?? "pendente");
      setObs((cqRow as any).observacoes_cq_pos ?? "");
      setConsertoDatas(((cqRow as any).datas_conserto_pos ?? {}) as ConsertoDatas);
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
    tocadoRef.current = false;
    setHydrated(true);
  }, [cqRow, posItens, cqFetched, cqFetching, cqOk, itensFetched, itensFetching, itensOk, cqId, servicosFetched, servicosFetching, servicosOk, hydrated]);

  // Releitura do servidor com status diferente do mostrado (só depois de hidratar e fora de Salvar/Desmarcar em voo):
  // sem edição => re-hidrata do servidor (zera o rascunho) + toast; com edição => adota o status, MANTÉM a edição e o
  // rascunho + toast. Nunca troca de modo em silêncio.
  useEffect(() => {
    if (!hydrated || !cqFetched || cqFetching || !cqOk || !cqRow) return;
    if (save.isPending || desmarcar.isPending) return;
    const dec = decidirStatusServidor({ atual: statusPos, fresco: statusCqDe({ status: (cqRow as { status_pos?: string | null }).status_pos }), temEdicao: tocadoRef.current, nome: "CQ Pós" });
    if (dec.status === statusPos) return;
    if (dec.aviso) toast.info(dec.aviso);
    if (dec.manterEdicao) {
      setStatusPos(dec.status);
      setEditing(true);
    } else {
      setEditing(false);
      setHydrated(false); // a hidratação acima re-semeia status, obs, datas e itens do servidor
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cqRow, cqFetched, cqFetching, cqOk, hydrated, statusPos]);

  const confirmado = statusPos === "confirmado";
  const readOnly = permReadOnly || (confirmado && !editing);

  const rowOf = (sid: string, et: PosEtapa, num: number): PosRow =>
    posState[sid]?.[et]?.[num] ?? { grades: {}, grade_total: 0 };

  const setQtd = (sid: string, et: PosEtapa, num: number, tam: string, qtd: number) => {
    tocadoRef.current = true;
    setPosState((s) => {
      const svc = s[sid] ?? emptySvc();
      const row = { ...(svc[et][num] ?? { grades: {}, grade_total: 0 }) };
      row.grades = { ...row.grades, [tam]: qtd };
      row.grade_total = Object.values(row.grades).reduce((a, v) => a + (Number(v) || 0), 0);
      return { ...s, [sid]: { ...svc, [et]: { ...svc[et], [num]: row } } };
    });
  };
  const setConserto = (sid: string, k: "enviado" | "prevista" | "entregue", v: string | null) => {
    tocadoRef.current = true;
    setConsertoDatas((s) => ({ ...s, [sid]: { ...(s[sid] ?? {}), [k]: v || null } }));
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
      const { error } = await supabase.rpc("salvar_cq_pos", {
        _cad_id: cadId,
        _cq_pos: { observacoes_cq_pos: obs || null, fotografado_variantes_pos: {}, datas_conserto_pos: consertoDatas },
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
      await qc.invalidateQueries({ queryKey: ["dir-list"] });
      // O Pós agora também é gate de Lançar (Pré E, se há pós, Pós) — propaga.
      await qc.invalidateQueries({ queryKey: ["lancamentos-cards"] });
      await qc.invalidateQueries({ queryKey: ["plan-cq"] });
    },
    onError: (e: any) => {
      // N6 (espelho, B8): a decisão de status do servidor é pulada com ação local em voo; relê p/ reaplicar.
      if (deveReaplicarStatusAposErro(e)) qc.invalidateQueries({ queryKey: ["cqpos-cq", cadId] });
      toast.error(mensagemErro(e, "Erro ao salvar"));
    },
  });

  const desmarcar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("desmarcar_cq_pos", { _cad_id: cadId });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Confirmação desmarcada");
      setEditing(false);
      setHydrated(false);
      await qc.invalidateQueries({ queryKey: ["cqpos-cq", cadId] });
      await qc.invalidateQueries({ queryKey: ["producao-cq-list"] });
      await qc.invalidateQueries({ queryKey: ["dir-list"] });
      await qc.invalidateQueries({ queryKey: ["lancamentos-cards"] });
      await qc.invalidateQueries({ queryKey: ["plan-cq"] });
    },
    onError: (e: any) => {
      // N6 (espelho, B8): a decisão de status do servidor é pulada com ação local em voo; relê p/ reaplicar.
      if (deveReaplicarStatusAposErro(e)) qc.invalidateQueries({ queryKey: ["cqpos-cq", cadId] });
      toast.error(mensagemErro(e, "Erro ao desmarcar"));
    },
  });

  const variantes = variantList.map((v) => ({ num: v.num, label: labelByNumero[v.num] ?? `Variante ${v.num}` }));

  // Divergência do RECEBIMENTO (por serviço) × grade real do Pré: cada serviço de acabamento
  // processa todas as peças, então o recebido deve bater com a grade real. Lista as variantes
  // em que o total recebido ≠ real (faltam/sobram peças) — alimenta o banner de alerta.
  const divergRecebimento = (svId: string) =>
    variantes
      .map((v) => ({ label: v.label, real: realByNum[v.num]?.total ?? 0, recebido: rowOf(svId, "recebimento", v.num).grade_total }))
      .filter((x) => x.recebido !== x.real);

  useImperativeHandle(ref, () => ({
    save: (confirmar: boolean) => save.mutate(confirmar),
    desmarcar: () => desmarcar.mutate(),
    edit: () => setEditing(true),
    cancel: () => { setEditing(false); setHydrated(false); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  // Reporta o estado ao pai p/ renderizar os botões corretos na barra do topo.
  // IMPORTANTE: depende de PRIMITIVOS (bool), não do array `servicos` (=[] a cada
  // render quando carregando → loop infinito de setState no pai).
  const posPending = save.isPending || desmarcar.isPending;
  const hasServicos = (servicos as any[]).length > 0;
  useEffect(() => {
    // Fix hidratação (P-57 A, metade 1): reporta `hydrated` ao pai — os botões Salvar/Confirmar/
    // Desmarcar do Pós vivem na barra do CQ Pré (mesmo componente pai), não aqui dentro.
    onStatus?.({ confirmado, editing, pending: posPending, hasServicos, hydrated });
  }, [confirmado, editing, posPending, hasServicos, hydrated, onStatus]);

  return (
    <div className="space-y-4">
      {/* Fix hidratação rodada 2 (achado N1 da re-revisão — regressão da rodada 1): o corpo tem
          que renderizar por `hydrated` SOZINHO — uma vez hidratado, um erro de REFETCH posterior
          (ex.: foco de janela, invalidate de outra tela) NÃO pode esconder o formulário nem virar
          "vazio": no TanStack v5 um refetch que falha mantém `data` (o último bom) e vira
          `isError=true`, então `hasLoadError && !hydrated` sozinho já cobria a 1ª carga, mas
          `!hasLoadError && hydrated` escondia o corpo depois de hidratado. O banner de erro só
          aparece ANTES da 1ª hidratação (erro real, nada pra mostrar ainda). */}
      {hasLoadError && !hydrated && (
        <Card className="p-5 space-y-3 border-destructive/50 bg-destructive/5 text-sm">
          <p className="text-destructive font-medium">Não foi possível carregar os dados.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { refetchCqPos(); refetchServicos(); if (cqId) refetchItens(); }}
          >
            Tentar de novo
          </Button>
        </Card>
      )}
      {/* Fix hidratação rodada 1 (achado M3): sem erro, mas ainda não hidratado — "Carregando…"
          no lugar do corpo. Sem isso, o banner "Nenhum serviço de acabamento" (que lê
          `servicos.length === 0`, o default de array vazio) aparecia falsamente enquanto a
          query de serviços ainda estava em voo. */}
      {!hasLoadError && !hydrated && (
        <Card className="p-5 text-sm text-muted-foreground">Carregando…</Card>
      )}
      {hydrated && (
      <>
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
                {/* Datas: Recebimento = as do serviço (de Serviços, read-only); Conserto = próprias. */}
                {et === "recebimento" ? (
                  <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>Enviado: <span className="text-foreground">{fmtData(sv.enviado)}</span></div>
                    <div>Prevista: <span className="text-foreground">{fmtData(sv.prevista)}</span></div>
                    <div>Entregue: <span className="text-foreground">{fmtData(sv.entregue)}</span></div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {(["enviado", "prevista", "entregue"] as const).map((k) => (
                      <div key={k} className="space-y-1">
                        <Label className="text-xs text-muted-foreground capitalize">{k}</Label>
                        <DateField value={consertoDatas[sv.id]?.[k] ?? ""} onChange={(e) => setConserto(sv.id, k, e.target.value || null)} />
                      </div>
                    ))}
                  </div>
                )}
                <MatrizGradeResponsiva
                  tamanhos={tamanhos}
                  variantes={variantes}
                  emptyLabel="Sem variantes no Tecido Principal."
                  total={(num) => rowOf(sv.id, et, num).grade_total}
                  cellClass={(num, t) => {
                    if (et !== "recebimento") return "";
                    const val = Number(rowOf(sv.id, et, num).grades?.[t] ?? 0);
                    const real = realByNum[num]?.grades?.[t] ?? 0;
                    return val > 0 && val !== real ? "bg-destructive/15" : "";
                  }}
                  renderCell={(num, t) => {
                    // Recebimento: campo em vermelho quando o valor preenchido ≠ grade real do Pré.
                    const val = rowOf(sv.id, et, num).grades?.[t];
                    const real = realByNum[num]?.grades?.[t] ?? 0;
                    const diverge = et === "recebimento" && (Number(val) || 0) > 0 && (Number(val) || 0) !== real;
                    return (
                      <NumberInput
                        integer
                        className={`h-8 max-md:h-11 w-full border-0 text-center ${diverge ? "text-destructive font-semibold" : ""}`}
                        value={val ?? ""}
                        onChange={(e) => setQtd(sv.id, et, num, t, Number(e.target.value) || 0)}
                      />
                    );
                  }}
                />
              </div>
            ))}

            {/* Alerta: o recebimento deste serviço não bate com a grade real do Pré. */}
            {(() => {
              const diffs = divergRecebimento(sv.id);
              return diffs.length > 0 ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  ⚠ Recebimento diverge da grade real:{" "}
                  {diffs.map((d) => `${d.label} — recebido ${d.recebido} / real ${d.real}`).join("; ")}.
                </div>
              ) : null;
            })()}
          </Card>
        ))}

        <Card className="p-5 space-y-2">
          <Label className="text-sm font-medium">Observações do CQ Pós</Label>
          <Textarea value={obs} onChange={(e) => { tocadoRef.current = true; setObs(e.target.value); }} rows={3} />
        </Card>
      </fieldset>
      </>
      )}
    </div>
  );
});
