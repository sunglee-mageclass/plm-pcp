import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { mensagemErro } from "@/lib/erro-mensagem";
import { useUnsavedGuard, UnsavedChangesGuard } from "@/components/shared/UnsavedChangesGuard";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { proximoLancamento, removerLancamento, normalizar, remapChaves } from "@/lib/lancamentos";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DateField } from "@/components/shared/DateField";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { brl, mesLimpo, fmtPct } from "@/lib/format";
import { SubcolecaoResumo } from "./orcamento";
import { Plus, Trash2, ChevronRight, Save, Check, ArrowLeft } from "lucide-react";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";

/**
 * Editor da coleção por PODER DE VENDA, em MODAL. Herda um "Padrão do mix"; árvore
 * Subcoleção ▸ Linha × Lançamento (SEM categoria/sub). Por linha: prof/cor, cores, preço,
 * toggle "à parte" (Acessórios = 100% sozinha). O nº de modelos do padrão é DISTRIBUÍDO
 * automaticamente ÷ subcoleções e repartido nos lançamentos. Lançamentos são slots
 * SEQUENCIAIS e contíguos (1..N), cada um com sua data livre (sem mapear semana do
 * calendário). Confirmar gera os cards. Internamente o ordinal segue na coluna `semana`.
 */

type LinhaSub = { id: string; linhaId: string; aParte: boolean; profCor: number; cores: number; min: number; max: number; q: Record<string, number> };
// `id` é um id LOCAL estável (nid) usado como key de React/estado; `dbId` é o id REAL da
// subcoleção no banco (null enquanto não salva) — enviado no Save p/ o casamento por id
// preservar a subcoleção (e sua árvore de Plan. Tecido) mesmo ao renomear.
type Subcolecao = { id: string; dbId?: string | null; nome: string; semanas: number[]; datasSemanas: Record<string, string>; linhas: LinhaSub[] };

let _seq = 0;
const nid = (p: string) => `${p}-${++_seq}`;
const num = (v: string) => (v === "" ? 0 : Number(v.replace(",", ".")) || 0);
const int = (n: number) => Math.round(n).toLocaleString("pt-BR");
const totLinha = (l: LinhaSub, semanas: number[]) => semanas.reduce((s, w) => s + (Number(l.q[String(w)]) || 0), 0);
// Reparte um inteiro igualmente em n baldes (o resto vai pros primeiros).
const splitEven = (total: number, n: number): number[] => {
  if (n <= 0) return [];
  const base = Math.floor(total / n), rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
};

const SEMANAS_NAO_ATR = ["1", "2", "3", "4", "5"];

/** Modelos da coleção PV que ainda não foram atribuídos a uma subcoleção/semana. */
function NaoAtribuidosPV({
  cards,
  subs,
  onAssign,
}: {
  cards: any[];
  /** Subcoleções com id REAL do banco (só as já salvas têm id real). */
  subs: { id: string; nome: string }[];
  onAssign: (modeloId: string, subcolecaoId: string, semana: string) => Promise<void>;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkSub, setBulkSub] = useState<string>("");
  const [bulkSem, setBulkSem] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const hasSubs = subs.length > 0;
  const toggle = (id: string) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allChecked = cards.length > 0 && cards.every((c) => checked.has(c.id));
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(cards.map((c) => c.id)));

  const atribuir = async () => {
    if (checked.size === 0) return;
    if (!hasSubs) { toast.error("Salve as subcoleções primeiro para atribuir."); return; }
    if (!bulkSub) { toast.error("Escolha a subcoleção."); return; }
    if (!bulkSem) { toast.error("Escolha a semana."); return; }
    setLoading(true);
    try {
      for (const id of checked) await onAssign(id, bulkSub, bulkSem);
      toast.success(`${checked.size} atribuído(s).`);
      setChecked(new Set());
    } catch (e: any) {
      toast.error(mensagemErro(e, "Erro ao atribuir."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="text-sm font-medium flex items-center justify-between">
        <span>Não atribuídos</span>
        <Badge variant="secondary">{cards.length}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Modelos desta coleção sem subcoleção ou sem semana. Selecione e atribua em massa para que entrem no plano PV.
      </p>
      {!hasSubs && (
        <p className="text-xs text-amber-600 font-medium">Salve as subcoleções primeiro para habilitar a atribuição.</p>
      )}
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2">
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <Checkbox checked={allChecked} onCheckedChange={toggleAll} aria-label="Selecionar todos" /> Todos
        </label>
        <span className="text-xs text-muted-foreground">{checked.size} selecionado(s)</span>
        <div className="flex-1" />
        {hasSubs && (
          <Select value={bulkSub} onValueChange={setBulkSub}>
            <SelectTrigger className="w-36 h-8"><SelectValue placeholder="Subcoleção" /></SelectTrigger>
            <SelectContent>{subs.map((sc) => <SelectItem key={sc.id} value={sc.id}>{sc.nome}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <Select value={bulkSem} onValueChange={setBulkSem}>
          <SelectTrigger className="w-28 h-8"><SelectValue placeholder="Lançamento" /></SelectTrigger>
          <SelectContent>{SEMANAS_NAO_ATR.map((w) => <SelectItem key={w} value={w}>Lançamento {w}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" className="h-8" disabled={checked.size === 0 || loading || !hasSubs} onClick={atribuir}>
          Atribuir ({checked.size})
        </Button>
      </div>
      <div className="space-y-1">
        {cards.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer rounded px-1 py-0.5 hover:bg-muted/40">
            <Checkbox checked={checked.has(c.id)} onCheckedChange={() => toggle(c.id)} aria-label="Selecionar" />
            <span className="flex-1 min-w-0 truncate">
              {c.ref ?? c.nome ?? "Sem nome"}
              {(c.categorias_produto as any)?.nome ? ` · ${(c.categorias_produto as any).nome}` : ""}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function ColecaoPVSheet({ colecaoId, onClose, onSaved }: { colecaoId: string | null; onClose: () => void; onSaved?: () => void }) {
  const qc = useQueryClient();
  const { data: padroes = [] } = useQuery({
    queryKey: ["mix-padroes", "opts"],
    queryFn: async () => (await supabase.from("mix_padroes" as any)
      .select("id, nome, linhas:mix_padrao_linhas(linha_id, num_modelos, a_parte, prof_cor, cores, preco_min, preco_max, ordem)").order("nome")).data ?? [] as any[],
  });
  // Keys DISTINTAS (não ["opt","meses"]/["opt","anos"]): esta tela precisa de `mes`+`ordem`
  // e `ano`; as outras telas usam a mesma raiz com `nome:mes`/`nome:ano` (shape diferente)
  // — compartilhar a key fazia o mês/ano sumir quando o cache era reescrito pela outra forma.
  const { data: meses = [] } = useQuery({ queryKey: ["opt-pv", "meses"], queryFn: async () => (await supabase.from("meses").select("id, mes, ordem").order("ordem")).data ?? [] });
  const { data: anos = [] } = useQuery({ queryKey: ["opt-pv", "anos"], queryFn: async () => (await supabase.from("anos").select("id, ano").order("ano")).data ?? [] });
  const { data: linhaOpts = [] } = useQuery({ queryKey: ["padrao-linhas"], queryFn: async () => (await supabase.from("linhas").select("id, nome, markup").order("nome")).data ?? [] });

  const markupDe = (id: string) => Number((linhaOpts as any[]).find((l) => l.id === id)?.markup) || 0;
  const nomeLinha = (id: string) => (linhaOpts as any[]).find((l) => l.id === id)?.nome ?? "—";

  const [savedId, setSavedId] = useState<string | null>(colecaoId);
  const [confirmada, setConfirmada] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [padraoId, setPadraoId] = useState("");
  const [nome, setNome] = useState("");
  const [mesId, setMesId] = useState("");
  const [anoId, setAnoId] = useState("");
  const [meta, setMeta] = useState(0);
  const [perda, setPerda] = useState(25);
  const [subs, setSubs] = useState<Subcolecao[]>([]);
  const [aberta, setAberta] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  const formSnapshot = { nome, mesId, anoId, padraoId, meta, perda, subs };
  const { dirty: changed, markClean, reset: resetBaseline } = useDirtySnapshot(formSnapshot);
  const dirty = changed;
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose });

  const mesOrdem = useMemo(() => Number((meses as any[]).find((m) => m.id === mesId)?.ordem) || 0, [meses, mesId]);
  const anoNum = useMemo(() => Number((anos as any[]).find((a) => a.id === anoId)?.ano) || 0, [anos, anoId]);
  // Data do lançamento = campo livre por ordinal (sem mapear semana do calendário).
  const dataSemana = (s: Subcolecao, w: number) => s.datasSemanas[String(w)] ?? "";
  // Mês/ano da coleção em ISO — o calendário do DateField abre nele (conveniência de
  // abertura; NÃO deriva mais a data do lançamento).
  const colMesIso = anoNum && mesOrdem ? format(new Date(anoNum, mesOrdem - 1, 1), "yyyy-MM-dd") : "";

  const numByLinha = useMemo(() => {
    const p = (padroes as any[]).find((x) => x.id === padraoId);
    const m: Record<string, number> = {};
    for (const l of (p?.linhas ?? [])) if (l.linha_id) m[l.linha_id] = Number(l.num_modelos) || 0;
    return m;
  }, [padroes, padraoId]);

  const { data: loaded } = useQuery({
    queryKey: ["colecao-pv", colecaoId],
    enabled: !!colecaoId,
    queryFn: async () => {
      const { data, error } = await supabase.from("colecoes" as any)
        .select("id, nome, mes_id, ano_id, status, mix_padrao_id, poder_venda_meta, perda_markup, subcolecoes:colecao_subcolecoes(id, nome, ordem, semanas, datas_semanas), itens:colecao_pv_itens(id, subcolecao_id, linha_id, a_parte, prof_cor, cores, preco_min, preco_max, qtd_semanas, ordem)")
        .eq("id", colecaoId).single();
      if (error) throw error;
      return data as any;
    },
  });
  const { data: colecaoCards = [], refetch: refetchCards } = useQuery({
    queryKey: ["otb-pv-colecao-cards", colecaoId],
    enabled: !!colecaoId,
    queryFn: async () => (await supabase.from("modelos" as any)
      .select("id, nome, ref, subcolecao, semana, categoria_principal_id, categorias_produto:categoria_principal_id(nome)")
      .eq("colecao_id", colecaoId!)).data ?? [],
  });
  const naoAtribuidos = useMemo(
    () => (colecaoCards as any[]).filter((c) => !c.subcolecao || !(c.semana && String(c.semana).trim())),
    [colecaoCards],
  );
  const atribuirCard = useMutation({
    mutationFn: async ({ modeloId, subcolecaoId, semana }: { modeloId: string; subcolecaoId: string; semana: string }) => {
      const { error } = await supabase.rpc("otb_atribuir_card", { _modelo_id: modeloId, _subcolecao_id: subcolecaoId, _semana: semana });
      if (error) throw error;
    },
  });

  useEffect(() => {
    if (!colecaoId || !loaded || hydrated) return;
    const c = loaded;
    setNome(c.nome ?? ""); setMesId(c.mes_id ?? ""); setAnoId(c.ano_id ?? "");
    setPadraoId(c.mix_padrao_id ?? ""); setMeta(Number(c.poder_venda_meta) || 0); setPerda(Number(c.perda_markup) || 25);
    setConfirmada(c.status === "confirmada");
    const bySub: Record<string, any[]> = {};
    for (const it of (c.itens ?? [])) (bySub[it.subcolecao_id] ??= []).push(it);
    const mapped: Subcolecao[] = [...(c.subcolecoes ?? [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((sc: any) => {
      const its = [...(bySub[sc.id] ?? [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
      const linhas: LinhaSub[] = its.map((it) => ({
        id: nid("l"), linhaId: it.linha_id ?? "", aParte: !!it.a_parte, profCor: Number(it.prof_cor) || 0, cores: Number(it.cores) || 0,
        min: Number(it.preco_min) || 0, max: Number(it.preco_max) || 0, q: (it.qtd_semanas ?? {}) as Record<string, number>,
      }));
      // Normaliza p/ ordinais contíguos (dado antigo pode ter buraco); remapeia datas + qtd.
      const rawSemanas: number[] = Array.isArray(sc.semanas) ? sc.semanas.map(Number) : [];
      const { ordinais: semanas, remap } = normalizar(rawSemanas);
      const datasSemanas = remapChaves((sc.datas_semanas ?? {}) as Record<string, string>, remap);
      const linhasNorm = linhas.map((l) => ({ ...l, q: remapChaves(l.q, remap) }));
      return { id: nid("s"), dbId: sc.id ?? null, nome: sc.nome, semanas, datasSemanas, linhas: linhasNorm };
    });
    setSubs(mapped); setHydrated(true);
    // Re-baseline do snapshot com os dados carregados (evita falso-dirty ao abrir).
    resetBaseline({ nome: c.nome ?? "", mesId: c.mes_id ?? "", anoId: c.ano_id ?? "", padraoId: c.mix_padrao_id ?? "", meta: Number(c.poder_venda_meta) || 0, perda: Number(c.perda_markup) || 25, subs: mapped });
  }, [colecaoId, loaded, hydrated]);

  const cloneDoPadrao = (): LinhaSub[] => {
    const p = (padroes as any[]).find((x) => x.id === padraoId);
    if (!p) return [];
    return [...(p.linhas ?? [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((l: any) => ({
      id: nid("l"), linhaId: l.linha_id ?? "", aParte: !!l.a_parte, profCor: Number(l.prof_cor) || 0, cores: Number(l.cores) || 0,
      min: Number(l.preco_min) || 0, max: Number(l.preco_max) || 0, q: {} as Record<string, number>,
    }));
  };
  // Reparte o nº de modelos do padrão: ÷ nº de subcoleções e, dentro de cada uma, ÷ semanas.
  const redistribuir = (list: Subcolecao[]): Subcolecao[] => {
    const N = list.length;
    if (N === 0) return list;
    return list.map((s, si) => ({
      ...s,
      linhas: s.linhas.map((l) => {
        const total = numByLinha[l.linhaId];
        if (total == null) return l; // linha fora do padrão: não mexe
        const share = splitEven(total, N)[si];
        const perW = splitEven(share, s.semanas.length);
        const q: Record<string, number> = {};
        s.semanas.forEach((w, j) => { q[String(w)] = perW[j] ?? 0; });
        return { ...l, q };
      }),
    }));
  };
  const addSub = () => {
    const sid = nid("s");
    setSubs((xs) => redistribuir([...xs, { id: sid, nome: `Subcoleção ${xs.length + 1}`, semanas: [], datasSemanas: {}, linhas: cloneDoPadrao() }]));
    setAberta((a) => ({ ...a, [sid]: true }));
  };
  const delSub = (sid: string) => setSubs((xs) => redistribuir(xs.filter((s) => s.id !== sid)));
  const patchSub = (sid: string, p: Partial<Subcolecao>) => setSubs((xs) => xs.map((s) => (s.id === sid ? { ...s, ...p } : s)));
  const setDataSemana = (sid: string, w: number, v: string) => setSubs((xs) => xs.map((s) => (s.id === sid ? { ...s, datasSemanas: { ...s.datasSemanas, [String(w)]: v } } : s)));
  // Aplica uma mudança na subcoleção e RE-REPARTE o nº de modelos nas semanas resultantes.
  const mutSubResplit = (sid: string, mut: (s: Subcolecao) => Subcolecao) => setSubs((xs) => {
    const si = xs.findIndex((x) => x.id === sid); const N = xs.length;
    return xs.map((s) => {
      if (s.id !== sid) return s;
      const ns = mut(s);
      const linhas = ns.linhas.map((l) => {
        const total = numByLinha[l.linhaId];
        if (total == null) return l;
        const share = splitEven(total, N)[si];
        const perW = splitEven(share, ns.semanas.length);
        const q: Record<string, number> = {};
        ns.semanas.forEach((ww, j) => { q[String(ww)] = perW[j] ?? 0; });
        return { ...l, q };
      });
      return { ...ns, linhas };
    });
  });
  // Lançamento sequencial: acrescenta o próximo ordinal contíguo.
  const addSemana = (sid: string) => mutSubResplit(sid, (s) => {
    const prox = proximoLancamento(s.semanas);
    return prox == null ? s : { ...s, semanas: [...s.semanas, prox].sort((a, b) => a - b) };
  });
  // Remover renumera contíguo (1..N-1), remapeando datas + qtd de cada linha.
  const removerSemana = (sid: string, w: number) => mutSubResplit(sid, (s) => {
    const { ordinais, remap } = removerLancamento(s.semanas, w);
    return {
      ...s,
      semanas: ordinais,
      datasSemanas: remapChaves(s.datasSemanas, remap),
      linhas: s.linhas.map((l) => ({ ...l, q: remapChaves(l.q, remap) })),
    };
  });
  const mapLinha = (sid: string, lid: string, fn: (l: LinhaSub) => LinhaSub) => setSubs((xs) => xs.map((s) => s.id !== sid ? s : { ...s, linhas: s.linhas.map((l) => (l.id === lid ? fn(l) : l)) }));
  const patchLinha = (sid: string, lid: string, p: Partial<LinhaSub>) => mapLinha(sid, lid, (l) => ({ ...l, ...p }));
  const setQ = (sid: string, lid: string, w: number, v: number) => mapLinha(sid, lid, (l) => ({ ...l, q: { ...l.q, [String(w)]: v } }));
  const delLinha = (sid: string, lid: string) => setSubs((xs) => xs.map((s) => (s.id === sid ? { ...s, linhas: s.linhas.filter((l) => l.id !== lid) } : s)));
  const addLinha = (sid: string) => setSubs((xs) => xs.map((s) => (s.id === sid ? { ...s, linhas: [...s.linhas, { id: nid("l"), linhaId: "", aParte: false, profCor: 64, cores: 3, min: 0, max: 0, q: {} }] } : s)));

  const salvarRaw = async (): Promise<string> => {
    const _header = { nome, mes_id: mesId || null, ano_id: anoId || null, mix_padrao_id: padraoId || null, poder_venda_meta: meta || null, perda_markup: perda };
    const _subcolecoes = subs.map((s) => ({
      id: s.dbId ?? null, nome: s.nome, semanas: s.semanas,
      // Data resolvida (override ?? default do calendário) p/ cada semana marcada.
      datas_semanas: Object.fromEntries(s.semanas.map((w) => [String(w), dataSemana(s, w)]).filter(([, v]) => v)),
      data_lancamento: s.semanas.length ? dataSemana(s, s.semanas[0]) || null : null,
      itens: s.linhas.map((l) => ({
        linha_id: l.linhaId || null, a_parte: l.aParte, prof_cor: l.profCor, cores: l.cores, preco_min: l.min, preco_max: l.max,
        qtd_semanas: Object.fromEntries(s.semanas.map((w) => [String(w), Number(l.q[String(w)]) || 0]).filter(([, v]) => (v as number) > 0)),
      })),
    }));
    const { data, error } = await supabase.rpc("salvar_colecao_pv" as any, { _id: savedId ?? null, _header, _subcolecoes });
    if (error) throw error;
    return data as string;
  };
  const invalidarDownstream = () => {
    qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
    qc.invalidateQueries({ queryKey: ["otb-modelos-link"] });
    qc.invalidateQueries({ predicate: (q) => typeof q.queryKey?.[0] === "string" && (q.queryKey[0] as string).startsWith("plan-tecido") });
  };
  const feito = (cid: string) => { setSavedId(cid); qc.invalidateQueries({ queryKey: ["colecao-pv", cid] }); qc.invalidateQueries({ queryKey: ["otb-orcamento"] }); invalidarDownstream(); onSaved?.(); };
  const salvar = useMutation({ mutationFn: salvarRaw, onSuccess: (cid) => { toast.success("Coleção salva."); markClean(); feito(cid); }, onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar a coleção.")) });
  const confirmar = useMutation({
    mutationFn: async () => { const cid = await salvarRaw(); const { error } = await supabase.rpc("otb_confirmar_pv" as any, { _colecao_id: cid }); if (error) throw error; return cid; },
    onSuccess: (cid) => { toast.success("Coleção confirmada."); markClean(); setConfirmada(true); feito(cid); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao confirmar a coleção.")),
  });
  const desconfirmar = useMutation({
    mutationFn: async () => { if (!savedId) return; const { error } = await supabase.rpc("otb_desconfirmar" as any, { _colecao_id: savedId }); if (error) throw error; },
    onSuccess: () => { toast.success("Coleção desconfirmada."); setConfirmada(false); qc.invalidateQueries({ queryKey: ["otb-orcamento"] }); invalidarDownstream(); onSaved?.(); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao desconfirmar a coleção.")),
  });
  const excluir = useMutation({
    mutationFn: async () => { if (!savedId) return; const { error } = await supabase.rpc("otb_excluir_colecao" as any, { _colecao_id: savedId }); if (error) throw error; },
    onSuccess: () => { toast.success("Coleção excluída."); qc.invalidateQueries({ queryKey: ["otb-orcamento"] }); onSaved?.(); onClose(); },
    onError: (e: any) => { setConfirmDel(false); toast.error(mensagemErro(e, "Erro ao excluir a coleção.")); },
  });

  // Subcoleções com ID REAL do banco (as que já foram salvas têm id real, não o nid local).
  // Usamos `loaded.subcolecoes` que vem do banco após o save; filtramos pelo nome para
  // bater com as subcoleções atuais do editor (que podem ter sido renomeadas antes de salvar).
  const subsReais = useMemo<{ id: string; nome: string }[]>(() => {
    if (!loaded?.subcolecoes) return [];
    return (loaded.subcolecoes as any[]).map((sc: any) => ({ id: sc.id, nome: sc.nome }));
  }, [loaded]);

  const onAssignPV = async (modeloId: string, subcolecaoId: string, semana: string) => {
    await atribuirCard.mutateAsync({ modeloId, subcolecaoId, semana });
    await refetchCards();
    qc.invalidateQueries({ queryKey: ["colecao-pv", savedId] });
    qc.invalidateQueries({ queryKey: ["otb-orcamento"] });
    qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
  };

  const d = useMemo(() => {
    let poder = 0, custo = 0, modelos = 0;
    for (const s of subs) for (const l of s.linhas) {
      const mk = markupDe(l.linhaId); const prof = l.profCor * l.cores;
      const tot = totLinha(l, s.semanas); const vm = (l.min + l.max) / 2; const pod = tot * prof * vm;
      poder += pod; modelos += tot; custo += mk > 0 ? pod / mk : 0;
    }
    return { poder, custo, modelos, desconto: (poder * perda) / 100, pvFinal: poder - (poder * perda) / 100, atingido: meta > 0 ? (poder / meta) * 100 : 0 };
  }, [subs, perda, meta, linhaOpts]);

  // % REAL do mix por linha. "À parte" (por linha na coleção) = 100% sozinha; as demais
  // dividem 100% pelo pool. Meta = % derivada do padrão (num_modelos + a_parte do padrão).
  const mixLinha = useMemo(() => {
    const perLinha: Record<string, number> = {}; const aParteReal: Record<string, boolean> = {};
    for (const s of subs) for (const l of s.linhas) { perLinha[l.linhaId || ""] = (perLinha[l.linhaId || ""] || 0) + totLinha(l, s.semanas); if (l.aParte) aParteReal[l.linhaId || ""] = true; }
    const p = (padroes as any[]).find((x) => x.id === padraoId);
    const numDe: Record<string, number> = {}; const apPad: Record<string, boolean> = {}; let totalPad = 0;
    for (const pl of (p?.linhas ?? [])) if (pl.linha_id) { numDe[pl.linha_id] = Number(pl.num_modelos) || 0; apPad[pl.linha_id] = !!pl.a_parte; if (!pl.a_parte) totalPad += Number(pl.num_modelos) || 0; }
    let totalPool = 0;
    for (const [lid, mod] of Object.entries(perLinha)) if (!aParteReal[lid]) totalPool += mod;
    const rows = Object.entries(perLinha).filter(([, m]) => m > 0).map(([lid, mod]) => {
      const ap = !!aParteReal[lid];
      const meta = lid in numDe ? (apPad[lid] ? 100 : (totalPad > 0 ? (numDe[lid] / totalPad) * 100 : 0)) : null;
      return { linhaId: lid, modelos: mod, aParte: ap, real: ap ? 100 : (totalPool > 0 ? (mod / totalPool) * 100 : 0), meta };
    }).sort((a, b) => Number(a.aParte) - Number(b.aParte) || b.modelos - a.modelos);
    const poolRows = rows.filter((r) => !r.aParte);
    return { rows, totalPool, sumReal: poolRows.reduce((a, r) => a + r.real, 0) };
  }, [subs, padroes, padraoId]);

  const temPadrao = !!padraoId && !!(padroes as any[]).find((p) => p.id === padraoId);

  return (
    <Sheet open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <SheetContent side="right" size="editor" className="flex flex-col p-0 max-sm:[&>button]:hidden">
        <SheetHeader className="p-4 border-b shrink-0">
          <Breadcrumb items={[{ label: "OTB" }, { label: nome || "Coleção" }]} />
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="text-base sm:text-lg">{colecaoId ? "Editar coleção" : "Nova coleção"} · Poder de venda</SheetTitle>
            <StatusBadge tone={confirmada ? "success" : "warning"}>{confirmada ? "Confirmada" : "Rascunho"}</StatusBadge>
            <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <Card className="p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <label className="space-y-1 col-span-2"><span className="text-xs font-medium text-muted-foreground">Nome</span>
                <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: Alto Verão 26" /></label>
              <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Padrão do mix</span>
                <Sel value={padraoId} onChange={setPadraoId} placeholder="— escolher —" className="w-full">
                  {(padroes as any[]).map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                </Sel></label>
              <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Mês</span>
                <Sel value={mesId} onChange={setMesId} placeholder="—" className="w-full">{(meses as any[]).map((m) => <SelectItem key={m.id} value={m.id}>{mesLimpo(m.mes)}</SelectItem>)}</Sel></label>
              <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Ano</span>
                <Sel value={anoId} onChange={setAnoId} placeholder="—" className="w-full">{(anos as any[]).map((a) => <SelectItem key={a.id} value={a.id}>{a.ano}</SelectItem>)}</Sel></label>
              <label className="space-y-1 col-span-2"><span className="text-xs font-medium text-muted-foreground">Poder de venda meta</span>
                <MoneyInput inputMode="decimal" value={meta || ""} onChange={(e) => setMeta(Number(e.target.value) || 0)} /></label>
              <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Perda markup</span>
                <div className="flex items-center gap-1"><Input inputMode="decimal" value={perda} onChange={(e) => setPerda(num(e.target.value))} /><span className="text-muted-foreground">%</span></div></label>
              {meta > 0 && (
                /* Barra do planejado na MESMA linha da meta (mockup aprovado) — ocupa o resto da linha no lg. */
                <div className="col-span-2 space-y-1 self-end sm:col-span-3 lg:col-span-3">
                  <div className="flex items-center justify-between gap-2 text-sm"><span className="text-muted-foreground">Poder de venda planejado</span>
                    <span className="font-display font-semibold tabular-nums">{brl(d.poder)} <span className="font-sans text-xs font-normal text-muted-foreground">de {brl(meta)}</span></span></div>
                  {/* Meta é PISO (≥100% = bom): barra verde ao bater, TICK marca o alvo quando passa; >115% âmbar (bem acima ⇒ custo acima do intencionado). */}
                  <div className="relative h-2 w-full rounded-full bg-muted">
                    <div className={`h-full rounded-full transition-all ${d.atingido >= 100 ? "bg-emerald-600" : "bg-primary"}`} style={{ width: `${Math.min(100, d.atingido)}%` }} />
                    {d.atingido > 100 && <div className="absolute inset-y-[-2px] w-0.5 rounded bg-foreground/60" style={{ left: `${(100 / d.atingido) * 100}%` }} />}
                  </div>
                  <div className={`text-right text-xs font-semibold tabular-nums ${d.atingido > 115 ? "text-amber-700 dark:text-amber-500" : d.atingido >= 100 ? "text-emerald-700 dark:text-emerald-500" : "text-primary"}`}>
                    {fmtPct(d.atingido)} da meta{d.atingido > 115 ? " — bem acima da meta" : d.atingido >= 100 ? " ✓" : ""}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-baseline gap-1.5 rounded-lg bg-muted px-2.5 py-1.5"><b className="font-display text-foreground tabular-nums">{int(d.modelos)}</b> modelos</span>
                <span className="inline-flex items-baseline gap-1.5 rounded-lg bg-muted px-2.5 py-1.5">Orçamento (custo) <b className="font-display text-foreground tabular-nums">{brl(d.custo)}</b></span>
                <span className="inline-flex items-baseline gap-1.5 rounded-lg bg-muted px-2.5 py-1.5">Poder de venda <b className="font-display text-foreground tabular-nums">{brl(d.poder)}</b></span>
                <span className="inline-flex items-baseline gap-1.5 rounded-lg bg-muted px-2.5 py-1.5">Desconto <b className="font-display text-foreground tabular-nums">{brl(d.desconto)}</b></span>
                <span className="inline-flex items-baseline gap-1.5 rounded-lg bg-muted px-2.5 py-1.5">PV final <b className="font-display text-foreground tabular-nums">{brl(d.pvFinal)}</b></span>
              </div>
            </div>
          </Card>

          {/* Mix por linha + Subcoleções lado a lado (mockup aprovado) — cada um no seu card. */}
          <div className="grid items-start gap-3 lg:grid-cols-[1.2fr_1fr]">
            {mixLinha.rows.length > 0 && (
              <Card className="p-4">
                <div className="mb-1 text-xs font-medium text-muted-foreground">Mix por linha — % real vs meta do padrão</div>
                <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  {mixLinha.rows.map((r) => {
                    const off = r.meta != null && Math.abs(r.real - r.meta) > 3;
                    return (
                      <div key={r.linhaId} className="flex items-center gap-2 text-sm">
                        <span className="truncate min-w-0">
                          {r.linhaId ? nomeLinha(r.linhaId) : "— sem linha —"}
                          {r.aParte && <span className="ml-1 text-xs text-muted-foreground">(à parte)</span>}
                          <span className="text-xs text-muted-foreground"> · {int(r.modelos)} mod</span>
                        </span>
                        <span className={`tabular-nums shrink-0 ${off ? "text-amber-700 dark:text-amber-500" : "text-foreground"}`}>{fmtPct(r.real)}{r.meta != null && <span className="text-muted-foreground"> / meta {fmtPct(r.meta)}</span>}</span>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between border-t pt-1 text-sm font-semibold sm:col-span-2">
                    <span>Mix (sem à parte) <span className="text-xs font-normal text-muted-foreground">· {int(mixLinha.totalPool)} mod</span></span>
                    <span className="tabular-nums">{fmtPct(mixLinha.sumReal)}</span>
                  </div>
                </div>
              </Card>
            )}
            <SubcolecaoResumo colecaoId={savedId} className="rounded-lg border bg-card p-4 shadow-sm" />
          </div>

          {!temPadrao ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Escolha um Padrão do mix acima pra começar.</div>
          ) : (
            <div className="space-y-2">
              {subs.map((s) => {
                const open = aberta[s.id] ?? true;
                const poderSub = s.linhas.reduce((acc, l) => acc + totLinha(l, s.semanas) * l.profCor * l.cores * ((l.min + l.max) / 2), 0);
                return (
                  <Card key={s.id} className="overflow-hidden">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted/30 px-3 py-2">
                      <button className="p-2 -m-2" onClick={() => setAberta((a) => ({ ...a, [s.id]: !open }))}><ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} /></button>
                      <Input className="h-8 w-48 max-sm:w-full font-medium" value={s.nome} onChange={(e) => patchSub(s.id, { nome: e.target.value })} />
                      <span className="text-xs tabular-nums"><span className="text-muted-foreground">Poder:</span> {brl(poderSub)}</span>
                      <span className="text-xs text-muted-foreground">{s.semanas.length} lançamento{s.semanas.length === 1 ? "" : "s"}</span>
                      <Button variant="ghost" size="iconSm" className="ml-auto max-sm:h-11 max-sm:w-11" onClick={() => delSub(s.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                    </div>

                    {open && (
                      <div className="border-t bg-muted/10 px-3 py-2 space-y-2">
                        {/* Lançamentos SEQUENCIAIS: cada um é um ordinal contíguo (1..N) com sua
                            data livre. Sem mapear semana do calendário. */}
                        {/* Lançamentos INLINE (mockup aprovado): rótulo + datas + "+ Lançamento" numa linha, com wrap. */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Lançamentos — um por data</span>
                          {s.semanas.length === 0 && <span className="text-xs text-muted-foreground">Nenhum ainda — clique em "+ Lançamento".</span>}
                          {s.semanas.map((w) => (
                            <span key={w} className="inline-flex items-center gap-1.5 text-sm">
                              <span className="font-medium">Lançamento {w}</span>
                              <span className="w-32 inline-block"><DateField value={dataSemana(s, w)} defaultMonth={colMesIso} onChange={(e) => setDataSemana(s.id, w, e.target.value)} /></span>
                              <Button variant="ghost" size="iconSm" onClick={() => removerSemana(s.id, w)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                            </span>
                          ))}
                          <Button variant="outline" size="sm" className="max-md:h-9" onClick={() => addSemana(s.id)} disabled={s.semanas.length >= 5}><Plus className="h-4 w-4 mr-1" /> Lançamento</Button>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm card-table">
                            <thead className="text-xs text-muted-foreground">
                              <tr className="[&>th]:px-2 [&>th]:py-1 [&>th]:text-left [&>th]:text-[10px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-[0.06em]">
                                <th className="min-w-[9rem]">Linha</th><th>à parte</th><th>prof/cor</th><th>cores</th><th>Mín</th><th>Máx</th>
                                {s.semanas.map((w) => <th key={w}>Lan {w}</th>)}<th>Total</th><th>Poder</th><th />
                              </tr>
                            </thead>
                            <tbody>
                              {s.linhas.map((l) => {
                                const tot = totLinha(l, s.semanas); const vm = (l.min + l.max) / 2; const pod = tot * l.profCor * l.cores * vm;
                                return (
                                  <tr key={l.id} className="border-t border-border/50 [&>td]:px-2 [&>td]:py-1 [&>td]:text-left">
                                    <td>
                                      <Sel value={l.linhaId} onChange={(v) => patchLinha(s.id, l.id, { linhaId: v })} placeholder="— linha —" className="min-w-[9rem] max-sm:w-full">
                                        {(linhaOpts as any[]).map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
                                      </Sel>
                                    </td>
                                    <td data-label="à parte">
                                      <Button variant={l.aParte ? "default" : "outline"} size="sm" className="h-8 max-md:h-11" onClick={() => patchLinha(s.id, l.id, { aParte: !l.aParte })} title="Linha à parte: 100% sozinha (ex.: Acessórios)">
                                        {l.aParte ? "Sim" : "Não"}
                                      </Button>
                                    </td>
                                    <td data-label="prof/cor"><Input className="h-8 w-14 max-md:h-11 px-1 text-left tabular-nums" inputMode="numeric" value={l.profCor || ""} placeholder="0" onChange={(e) => patchLinha(s.id, l.id, { profCor: Math.max(0, Math.round(num(e.target.value))) })} /></td>
                                    <td data-label="cores"><Input className="h-8 w-12 max-md:h-11 px-1 text-left tabular-nums" inputMode="numeric" value={l.cores || ""} placeholder="0" onChange={(e) => patchLinha(s.id, l.id, { cores: Math.max(0, Math.round(num(e.target.value))) })} /></td>
                                    <td data-label="Preço mín"><Input className="h-8 w-20 max-md:h-11 px-1 text-left tabular-nums" inputMode="decimal" value={l.min || ""} placeholder="0,00" onChange={(e) => patchLinha(s.id, l.id, { min: num(e.target.value) })} /></td>
                                    <td data-label="Preço máx"><Input className="h-8 w-20 max-md:h-11 px-1 text-left tabular-nums" inputMode="decimal" value={l.max || ""} placeholder="0,00" onChange={(e) => patchLinha(s.id, l.id, { max: num(e.target.value) })} /></td>
                                    {s.semanas.map((w) => (
                                      <td key={w} data-label={`Lan ${w}`}><Input className="h-8 w-12 max-md:h-11 max-sm:w-16 px-1 text-left tabular-nums" inputMode="numeric" value={l.q[String(w)] || ""} placeholder="0" onChange={(e) => setQ(s.id, l.id, w, Math.max(0, Math.round(num(e.target.value))))} /></td>
                                    ))}
                                    <td data-label="Total" className="font-semibold tabular-nums">{int(tot)}</td>
                                    <td data-label="Poder" className="tabular-nums text-muted-foreground">{brl(pod)}</td>
                                    <td data-label=""><Button variant="ghost" size="iconSm" onClick={() => delLinha(s.id, l.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button></td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => addLinha(s.id)}><Plus className="h-4 w-4 mr-1" /> Linha</Button>
                      </div>
                    )}
                  </Card>
                );
              })}
              <Button variant="outline" onClick={addSub}><Plus className="h-4 w-4 mr-1" /> Subcoleção</Button>
            </div>
          )}
          {colecaoId && naoAtribuidos.length > 0 && (
            <NaoAtribuidosPV
              cards={naoAtribuidos}
              subs={subsReais}
              onAssign={onAssignPV}
            />
          )}
        </div>

        <div className="p-4 border-t shrink-0 flex items-center gap-2">
          <Button variant="outline" onClick={requestClose} className="shrink-0" aria-label="Voltar">
            <ArrowLeft className="h-4 w-4 mr-1" />Voltar
          </Button>
          {savedId && (
            <Button variant="destructive" className="shrink-0" onClick={() => setConfirmDel(true)} disabled={excluir.isPending} aria-label="Excluir coleção">
              <Trash2 className="h-4 w-4 mr-1" />Excluir
            </Button>
          )}
          {confirmada ? (
            <>
              <Button variant="outline" onClick={() => desconfirmar.mutate()} disabled={desconfirmar.isPending}
                className="ml-auto shrink-0 text-red-700 hover:text-red-700 dark:text-red-400 dark:hover:text-red-400">
                {desconfirmar.isPending ? "Desconfirmando…" : "Desconfirmar"}
              </Button>
              <Button onClick={() => salvar.mutate()} disabled={!nome.trim() || salvar.isPending} className="shrink-0 max-sm:aspect-square max-sm:px-0" aria-label="Salvar">
                <Save className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">{salvar.isPending ? "Salvando…" : "Salvar"}</span>
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => salvar.mutate()} disabled={!nome.trim() || salvar.isPending} className="ml-auto shrink-0 max-sm:aspect-square max-sm:px-0" aria-label="Salvar">
                <Save className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">{salvar.isPending ? "Salvando…" : "Salvar"}</span>
              </Button>
              <Button onClick={() => confirmar.mutate()} disabled={!nome.trim() || confirmar.isPending || salvar.isPending} className="shrink-0">
                <Check className="h-4 w-4 mr-1" /> Confirmar
              </Button>
            </>
          )}
        </div>
        <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas nesta coleção por Poder de Venda." />
      </SheetContent>

      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a coleção “{nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Exclui a coleção e os modelos vinculados que ainda estão em planejamento (ou reprovados).
              Se houver modelo já <strong>planejado</strong>, a exclusão é bloqueada. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive"
              onClick={(e) => { e.preventDefault(); excluir.mutate(); }} disabled={excluir.isPending}>
              {excluir.isPending ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

function Sel({ value, onChange, placeholder, disabled, className, children }: {
  value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={className}><SelectValue placeholder={placeholder ?? "—"} /></SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}
