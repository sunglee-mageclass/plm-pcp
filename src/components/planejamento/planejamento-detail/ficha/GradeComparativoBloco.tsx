// F5-2 "Grade por fase" (Task 5) — bloco comparativo Programada | CAD | PCP | CQ na seção Grade do Sheet do Planejamento.
// Lê a RPC `grade_comparativo` (já alinhada por variante × tamanho no servidor; a lib `grade-comparativo.ts` só molda). A
// PROGRAMADA (meta oficial, congelada ao enviar a Ordem de Criação) é a única editável — por quem edita o Planejamento OU o
// Desenvolvimento — e grava por `salvar_grade_programada` mandando o rev do card lido (P0409 = aviso de conflito). CAD / PCP /
// CQ são só leitura. Este bloco NÃO toca o editor da grade planejada normal (ModeloGradeSection).
// ⚠️ Colunas SEMPRE por `tamanhosDaResp(resp)` indexando `linha.celulas[t]` — nunca `Object.keys(celulas)` (o JS reordena chaves
// numéricas: "10" antes de "2"; a grade por NÚMERO perderia a ordem do servidor).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useReadOnly } from "@/components/RequirePermission";
import { Button } from "@/components/ui/button";
import { InfoHover } from "@/components/shared/InfoHover";
import { MatrizGradeResponsiva } from "@/components/shared/MatrizGradeResponsiva";
import { NumberInput } from "@/components/shared/NumberInput";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { mensagemErro } from "@/lib/erro-mensagem";
import { linhasComparativo, tamanhosDaResp, type GradeComparativoCelula, type GradeComparativoLinha } from "@/lib/grade-comparativo";
import type { TamanhoTipo } from "@/lib/tamanho";
import { rotuloDoTamanho } from "@/lib/tamanho-exibicao";
import {
  useGradeComparativo, useSalvarGradeProgramada, type GradeProgramadaPayload,
} from "../useGradeComparativo";

/** Faltante = "—" (a lib devolve null; a formatação é da UI). */
const fmt = (n: number | null | undefined): string => (n == null ? "—" : n.toLocaleString("pt-BR"));

/** Σ de uma fase numa variante; null quando a fase não tem nenhuma célula (mostra "—", não "0"). */
function somar(valores: (number | null)[]): number | null {
  let achou = false; let s = 0;
  for (const v of valores) if (v != null) { achou = true; s += v; }
  return achou ? s : null;
}

const chaveCel = (num: number, tam: string) => `${num}|${tam}`;
const DIFERE = "font-semibold text-[var(--tone-warning-fg)]";

function Linha({ rot, title, children }: { rot: string; title?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-1.5 px-1.5 py-0.5" title={title}>
      <span className="text-[10px] font-medium uppercase text-muted-foreground">{rot}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}

export function GradeComparativoBloco({ modeloId, ordemEnviada, tamanhoTipo }: {
  modeloId: string;
  /** `modelos.ordem_criacao_enviada` — antes dela não há Programada (o bloco nem aparece). */
  ordemEnviada: boolean;
  /** Lado do tamanho no cabeçalho (Letra/Número); sem valor = a chave cheia da grade. As chaves de dado seguem cheias. */
  tamanhoTipo?: TamanhoTipo | null;
}) {
  const { canEdit } = useAuth();
  const readOnlyScope = useReadOnly();
  const podeEditar = (canEdit("criacao_planejamento") || canEdit("criacao_desenvolvimento")) && !readOnlyScope;

  const { data: resp, isLoading, isError, refetch, isFetching } = useGradeComparativo(modeloId, ordemEnviada);
  // rev do card lido (MESMA queryKey/queryFn do Sheet — o Sheet e este bloco compartilham o cache; invalidar `["modelo", id]` atualiza os dois).
  const { data: modelo } = useQuery({
    queryKey: ["modelo", modeloId],
    enabled: !!modeloId && ordemEnviada,
    queryFn: async () => {
      const { data, error } = await supabase.from("modelos").select("*").eq("id", modeloId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const revBase = (modelo as any)?.rev as number | null | undefined;
  const salvar = useSalvarGradeProgramada(modeloId);

  // Rascunho da Programada: só as células que a pessoa mexeu ("<variante>|<tamanho>" → quantidade). Vazio = nada a salvar.
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [ajustadaAMao, setAjustadaAMao] = useState(false);

  const linhas = useMemo(() => linhasComparativo(resp), [resp]);
  const tamanhos = tamanhosDaResp(resp);

  if (!ordemEnviada) return null;
  if (isLoading) {
    return <p className="flex items-center gap-2 py-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Carregando comparativo da grade…</p>;
  }
  if (isError) {
    return (
      <p className="flex flex-wrap items-center gap-2 py-2 text-xs text-destructive">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />Não foi possível carregar o comparativo da grade.
        <Button type="button" variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>{isFetching ? "Tentando…" : "Tentar de novo"}</Button>
      </p>
    );
  }
  if (!resp || linhas.length === 0 || tamanhos.length === 0) return null;

  const linhaPorNum = new Map<number, GradeComparativoLinha>(linhas.map((l) => [l.variante.num, l]));
  const celula = (num: number, t: string): GradeComparativoCelula | undefined => linhaPorNum.get(num)?.celulas[t];
  // Programada já gravada da variante = existe linha congelada (`programada` != null em alguma célula). Sem ela não há o que ajustar
  // (a Programada mora na linha da grade; quem a cria é o Salvar do card).
  const temProgramada = (num: number) => tamanhos.some((t) => celula(num, t)?.programada != null);
  const progVivo = (num: number, t: string): number | null => edits[chaveCel(num, t)] ?? celula(num, t)?.programada ?? null;
  const sujo = Object.keys(edits).length > 0;

  const setProg = (num: number, t: string, v: number) => {
    const original = celula(num, t)?.programada ?? null;
    setEdits((e) => {
      const k = chaveCel(num, t);
      const n = { ...e };
      if (v === original) delete n[k]; else n[k] = v;
      return n;
    });
  };

  const gravar = () => {
    if (revBase == null) { toast.error("Não foi possível conferir a versão do card. Aguarde a carga e tente de novo."); return; }
    const nums = Array.from(new Set(Object.keys(edits).map((k) => Number(k.split("|")[0]))));
    const grades: GradeProgramadaPayload = nums.map((num) => {
      const g: Record<string, number> = {};
      for (const t of tamanhos) { const v = progVivo(num, t); if (v != null) g[t] = v; }
      return { variante_numero: num, grades: g };
    });
    salvar.mutate({ grades, revBase }, {
      onSuccess: () => { setEdits({}); setAjustadaAMao(true); toast.success("Grade programada salva."); },
      onError: (e) => toast.error(mensagemErro(e, "Não foi possível salvar a grade programada.")),
    });
  };

  const rotulo = (t: string) => (tamanhoTipo ? rotuloDoTamanho(t, tamanhoTipo) : t);

  return (
    <div className="space-y-2" data-testid="grade-comparativo">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold">Grade por fase</p>
        <StatusBadge tone="info">Programada — meta</StatusBadge>
        {ajustadaAMao && <StatusBadge tone="warning">ajustada à mão</StatusBadge>}
        <InfoHover ariaLabel="Sobre a grade por fase">
          <p>Programada = a meta oficial, congelada quando a Ordem de Criação foi enviada. Mudar a grade planejada depois não altera a Programada — ajuste aqui se a meta mudou.</p>
          <p className="mt-1">CAD = planejada no CAD · PCP = cortada · CQ = real (recebida − defeito). Passe o mouse no PCP/CQ para ver os detalhes. Em destaque: fase que difere da Programada.</p>
        </InfoHover>
      </div>

      <MatrizGradeResponsiva
        tamanhos={tamanhos}
        rotuloTamanho={rotulo}
        variantes={linhas.map((l) => ({ num: l.variante.num, label: l.variante.label }))}
        emptyLabel="Sem variantes."
        renderCell={(num, t) => {
          const c = celula(num, t);
          const prog = progVivo(num, t);
          const editavel = podeEditar && temProgramada(num);
          const difere = (v: number | null | undefined) => prog != null && v != null && v !== prog;
          const cad = c?.cad ?? null;
          const cortada = c?.pcp?.cortada ?? null;
          const real = c?.cq?.real ?? null;
          return (
            <div className="min-w-[72px] text-xs">
              <Linha rot="Prog">
                {editavel ? (
                  <NumberInput
                    integer
                    aria-label={`Programada — tamanho ${rotulo(t)}`}
                    className={`h-6 w-14 px-1 text-right text-xs tabular-nums ${edits[chaveCel(num, t)] !== undefined ? "border-[var(--tone-warning-fg)]" : ""}`}
                    placeholder="—"
                    value={prog ?? ""}
                    onChange={(e) => setProg(num, t, Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
                  />
                ) : fmt(prog)}
              </Linha>
              <Linha rot="CAD"><span className={difere(cad) ? DIFERE : ""}>{fmt(cad)}</span></Linha>
              <Linha
                rot="PCP"
                title={c?.pcp ? `Enviada ${fmt(c.pcp.enviada)} · Cortada ${fmt(c.pcp.cortada)} · Recebida ${fmt(c.pcp.recebida)} · Defeito ${fmt(c.pcp.defeito)}` : undefined}
              ><span className={difere(cortada) ? DIFERE : ""}>{fmt(cortada)}</span></Linha>
              <Linha
                rot="CQ"
                title={c?.cq ? `Recebida ${fmt(c.cq.recebida)} · Defeito ${fmt(c.cq.defeito)} · Real ${fmt(c.cq.real)}` : undefined}
              ><span className={difere(real) ? DIFERE : ""}>{fmt(real)}</span></Linha>
            </div>
          );
        }}
        total={(num) => {
          const l = linhaPorNum.get(num);
          if (!l) return "—";
          const tot: [string, number | null][] = [
            ["Prog", somar(tamanhos.map((t) => progVivo(num, t)))],
            ["CAD", somar(tamanhos.map((t) => l.celulas[t]?.cad ?? null))],
            ["PCP", somar(tamanhos.map((t) => l.celulas[t]?.pcp?.cortada ?? null))],
            ["CQ", somar(tamanhos.map((t) => l.celulas[t]?.cq?.real ?? null))],
          ];
          return (
            <span className="inline-flex flex-wrap justify-center gap-x-2 gap-y-0.5 text-xs font-normal tabular-nums">
              {tot.map(([rot, v]) => (
                <span key={rot}><span className="text-[10px] uppercase text-muted-foreground">{rot}</span> {fmt(v)}</span>
              ))}
            </span>
          );
        }}
      />

      {podeEditar && sujo && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={gravar} disabled={salvar.isPending || revBase == null}>
            {salvar.isPending ? "Salvando…" : "Salvar grade programada"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setEdits({})} disabled={salvar.isPending}>Descartar</Button>
          <span className="text-[11px] text-muted-foreground">Altera só a meta (Programada); CAD, PCP e CQ não mudam.</span>
        </div>
      )}
    </div>
  );
}
