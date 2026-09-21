// Uma tabela de distribuição: grade-base digitável + N lojas (de Cadastro › Lojas) → total, cores,
// peças/mês, valor médio (1ª loja com valor = referência; outras = ref × markup), poder de venda.
// Cálculo ao vivo via src/lib/distribuicao.ts (puro). Persiste via RPC (estado completo por save).

import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { MoneyInput } from "@/components/shared/MoneyInput";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { brl } from "@/lib/format";
import { calcularTabela, calcularTotais, indiceReferencia, type LinhaLoja } from "@/lib/distribuicao";

export type TabelaRow = {
  id: string;
  colecao_id: string | null;
  subcolecao: string | null;
  nome: string;
  ordem: number;
  grade_base: Record<string, number>;
  cores: number;
  pecas_mes: number;
  lojas: { loja_id: string; base: number; markup: number | null; valor_ref: number | null }[];
};

type LojaCad = { id: string; nome: string; ativo: boolean; ordem: number | null };

export function DistribuicaoTabela({ tabela, readOnly, onChanged }: { tabela: TabelaRow; readOnly: boolean; onChanged: () => void }) {
  // grade de tamanhos da loja (colunas). "num|sigla"[] → chaves.
  const { data: tamanhos = [] } = useQuery({
    queryKey: ["distribuicao-tamanhos"],
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("tamanhos_grade").maybeSingle();
      const arr = ((data as { tamanhos_grade?: string[] } | null)?.tamanhos_grade ?? []) as string[];
      return arr.length ? arr : ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];
    },
  });
  // lojas ativas (linhas)
  const { data: lojasCad = [] } = useQuery({
    queryKey: ["dir-lojas-distribuicao"],
    queryFn: async () => {
      const { data } = await supabase.from("lojas_direcionamento" as never).select("id, nome, ativo, ordem")
        .order("ordem", { ascending: true, nullsFirst: false }).order("nome");
      return ((data ?? []) as unknown as LojaCad[]).filter((l) => l.ativo);
    },
  });

  // estado local editável
  const [nome, setNome] = useState(tabela.nome);
  const [gradeBase, setGradeBase] = useState<Record<string, number>>(tabela.grade_base ?? {});
  const [cores, setCores] = useState<number>(tabela.cores ?? 1);
  const [pecasMes, setPecasMes] = useState<number>(tabela.pecas_mes ?? 0);
  // por loja: base, markup, valor_ref (indexado por loja_id p/ casar com o cadastro)
  const [porLoja, setPorLoja] = useState<Record<string, { base: number; markup: number | null; valor_ref: number | null }>>(() => {
    const m: Record<string, { base: number; markup: number | null; valor_ref: number | null }> = {};
    for (const l of tabela.lojas ?? []) m[l.loja_id] = { base: l.base, markup: l.markup, valor_ref: l.valor_ref };
    return m;
  });
  const [confirmDel, setConfirmDel] = useState(false);
  // `dirty` é ESTADO (reativo, p/ o selo "não salvo"); `dirtyRef` espelha p/ o effect de
  // re-hidratação ler sem virar dependência (senão o effect re-dispararia ao mudar dirty).
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const marcarDirty = () => { dirtyRef.current = true; setDirty(true); };

  // re-hidrata se a linha do servidor mudar (ex.: outro save) e não há edição pendente.
  useEffect(() => {
    if (dirtyRef.current) return;
    setNome(tabela.nome); setGradeBase(tabela.grade_base ?? {}); setCores(tabela.cores ?? 1); setPecasMes(tabela.pecas_mes ?? 0);
    const m: Record<string, { base: number; markup: number | null; valor_ref: number | null }> = {};
    for (const l of tabela.lojas ?? []) m[l.loja_id] = { base: l.base, markup: l.markup, valor_ref: l.valor_ref };
    setPorLoja(m);
  }, [tabela]);

  // monta as linhas de loja na ORDEM do cadastro (todas as lojas ativas aparecem; base default 0).
  const linhasLoja: LinhaLoja[] = useMemo(
    () => lojasCad.map((l) => ({
      loja_id: l.id,
      base: porLoja[l.id]?.base ?? 0,
      markup: porLoja[l.id]?.markup ?? null,
      valorRef: porLoja[l.id]?.valor_ref ?? null,
    })),
    [lojasCad, porLoja],
  );
  const idxRef = indiceReferencia(linhasLoja);
  const calc = useMemo(() => calcularTabela({ gradeBase, cores, pecasMes, lojas: linhasLoja }), [gradeBase, cores, pecasMes, linhasLoja]);
  const totais = useMemo(() => calcularTotais(gradeBase, calc), [gradeBase, calc]);

  const setGrade = (tam: string, v: number) => { marcarDirty(); setGradeBase((g) => ({ ...g, [tam]: v })); };
  const setLoja = (id: string, patch: Partial<{ base: number; markup: number | null; valor_ref: number | null }>) => {
    marcarDirty();
    setPorLoja((p) => {
      const atual = p[id] ?? { base: 0, markup: null, valor_ref: null };
      return { ...p, [id]: { ...atual, ...patch } };
    });
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const lojas = lojasCad.map((l) => ({
        loja_id: l.id, base: porLoja[l.id]?.base ?? 0,
        markup: porLoja[l.id]?.markup ?? null, valor_ref: porLoja[l.id]?.valor_ref ?? null,
      }));
      // RPCs novas ainda não estão no types.ts gerado → cast (padrão do projeto).
      const { error } = await (supabase.rpc as any)("salvar_distribuicao_tabela", {
        _dados: { id: tabela.id, colecao_id: tabela.colecao_id, subcolecao: tabela.subcolecao,
          nome, ordem: tabela.ordem, grade_base: gradeBase, cores, pecas_mes: pecasMes, lojas },
      });
      if (error) throw error;
    },
    onSuccess: () => { dirtyRef.current = false; setDirty(false); toast.success("Tabela salva."); onChanged(); },
    onError: (e) => toast.error(mensagemErro(e, "Erro ao salvar.")),
  });

  const delMut = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.rpc as any)("excluir_distribuicao_tabela", { _id: tabela.id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Tabela excluída."); onChanged(); },
    onError: (e) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });

  const labelTam = (k: string) => (k.includes("|") ? k.split("|")[0] : k);
  const cellCalc = "px-2 py-1.5 text-center tabular-nums text-muted-foreground";

  return (
    <Card className="overflow-hidden">
      {/* título editável + ações */}
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <Input value={nome} onChange={(e) => { marcarDirty(); setNome(e.target.value); }} disabled={readOnly}
          className="h-8 max-w-[220px] font-display text-base font-semibold border-transparent hover:border-input" />
        <span className="flex-1" />
        {dirty && <span className="text-xs text-amber-600">alterações não salvas</span>}
        <Button size="sm" onClick={() => saveMut.mutate()} disabled={readOnly || saveMut.isPending}>
          {saveMut.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />} Salvar
        </Button>
        <Button size="iconSm" variant="ghost" className="text-destructive" onClick={() => setConfirmDel(true)} disabled={readOnly} aria-label="Excluir tabela">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* grade */}
      <div className="overflow-x-auto">
        <table className="w-max min-w-full text-[13px] border-separate border-spacing-0">
          <thead>
            <tr className="[&>th]:bg-primary [&>th]:text-primary-foreground [&>th]:px-2 [&>th]:py-2 [&>th]:text-[11px] [&>th]:uppercase [&>th]:tracking-wide [&>th]:font-semibold [&>th]:whitespace-nowrap">
              <th className="text-left">Loja</th>
              <th>Base</th>
              {tamanhos.map((t) => <th key={t}>{labelTam(t)}</th>)}
              <th>Total</th><th>Cores</th><th>Peças/Mês</th><th>Markup</th><th>Valor Médio</th><th>Poder de Venda</th>
            </tr>
          </thead>
          <tbody>
            {/* linha GRADE-BASE (digitável) */}
            <tr className="[&>td]:border-b [&>td]:bg-amber-50/60 [&>td]:px-2 [&>td]:py-1.5">
              <td className="text-left font-semibold text-amber-700">Grade base <span className="text-[10px] font-normal">proporção</span></td>
              <td className="text-center text-muted-foreground">—</td>
              {tamanhos.map((t) => (
                <td key={t} className="text-center">
                  <NumberInput integer blankZero value={gradeBase[t] ?? 0} onChange={(e) => setGrade(t, Number(e.target.value) || 0)}
                    disabled={readOnly} className="h-8 w-12 text-center" />
                </td>
              ))}
              <td className="text-center tabular-nums font-medium">{tamanhos.reduce((a, t) => a + (gradeBase[t] || 0), 0)}</td>
              <td className="text-center">
                <NumberInput integer value={cores} onChange={(e) => { marcarDirty(); setCores(Number(e.target.value) || 0); }} disabled={readOnly} className="h-8 w-14 text-center" />
              </td>
              <td className="text-center">
                <NumberInput integer value={pecasMes} onChange={(e) => { marcarDirty(); setPecasMes(Number(e.target.value) || 0); }} disabled={readOnly} className="h-8 w-16 text-center" />
              </td>
              <td colSpan={3} className="text-left text-[11px] text-muted-foreground">Cores e Peças/Mês valem para a tabela toda</td>
            </tr>

            {/* linhas de loja */}
            {lojasCad.map((l, i) => {
              const c = calc[i];
              const ehRef = i === idxRef;
              return (
                <tr key={l.id} className="[&>td]:border-b [&>td]:px-2 [&>td]:py-1.5">
                  <td className="text-left font-medium">{l.nome}{ehRef && <span className="ml-1.5 text-[10px] rounded-full bg-accent px-1.5 py-0.5 text-muted-foreground">referência</span>}</td>
                  <td className="text-center">
                    <NumberInput integer blankZero value={porLoja[l.id]?.base ?? 0} onChange={(e) => setLoja(l.id, { base: Number(e.target.value) || 0 })}
                      disabled={readOnly} className="h-8 w-12 text-center" />
                  </td>
                  {tamanhos.map((t) => <td key={t} className={cellCalc}>{c.grade[t] ?? 0}</td>)}
                  <td className="px-2 py-1.5 text-center tabular-nums font-semibold">{c.total}</td>
                  <td className={cellCalc}>{c.coresOut}</td>
                  <td className={cellCalc}>{c.pecasMesOut.toLocaleString("pt-BR")}</td>
                  <td className="text-center">
                    {ehRef ? <span className="text-xs text-muted-foreground">ref</span> : (
                      // blankZero: limpar/zerar o campo vira null (loja sem markup, valor médio não deriva).
                      <NumberInput blankZero value={porLoja[l.id]?.markup ?? ""}
                        onChange={(e) => { const n = Number(e.target.value); setLoja(l.id, { markup: e.target.value === "" || n === 0 ? null : n }); }}
                        disabled={readOnly} className="h-8 w-16 text-right" placeholder="—" />
                    )}
                  </td>
                  <td className="text-right">
                    {ehRef || idxRef < 0 ? (
                      <MoneyInput value={porLoja[l.id]?.valor_ref ?? ""} onChange={(e) => setLoja(l.id, { valor_ref: e.target.value === "" ? null : Number(e.target.value) })}
                        disabled={readOnly} className="h-8 w-24 text-right" placeholder="digite p/ ser a referência" />
                    ) : <span className="tabular-nums text-muted-foreground">{brl(c.valorMedio)}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{brl(c.poderVenda)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="[&>td]:bg-muted [&>td]:px-2 [&>td]:py-2 [&>td]:font-bold [&>td]:border-t-2">
              <td className="text-left">Total</td>
              <td className="text-center tabular-nums">{lojasCad.reduce((a, l) => a + (porLoja[l.id]?.base ?? 0), 0)}</td>
              {tamanhos.map((t) => <td key={t} className="text-center tabular-nums">{totais.gradePorTam[t] ?? 0}</td>)}
              <td className="text-center tabular-nums">{totais.total}</td>
              <td className="text-center tabular-nums">{totais.cores.toLocaleString("pt-BR")}</td>
              <td className="text-center tabular-nums">{totais.pecasMes.toLocaleString("pt-BR")}</td>
              <td className="text-center">—</td><td className="text-right">—</td>
              <td className="text-right tabular-nums">{brl(totais.poderVenda)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-3 py-2 text-[11px] text-muted-foreground border-t">
        As lojas vêm de Cadastro › Lojas. Grade da loja = Base × Grade base · Valor Médio: a 1ª loja com valor é a referência; as outras = referência × markup · Poder de Venda = Valor Médio × Peças/Mês.
      </p>

      {confirmDel && (
        <AlertDialog open onOpenChange={(o) => !o && setConfirmDel(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir a tabela "{nome}"?</AlertDialogTitle>
              <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => { setConfirmDel(false); delMut.mutate(); }}>Excluir</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Card>
  );
}
