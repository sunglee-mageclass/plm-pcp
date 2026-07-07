import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, ArrowLeft, Check, Save, Plus, Tags } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/shared/NumberInput";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { computeColecaoResumo } from "./otb-resumo";
import { brl } from "@/lib/format";

const WEEKS = ["1", "2", "3", "4", "5"];
type Opt = { id: string; nome: string };
type Grupo = { id: string; nome: string };
type Categoria = { id: string; nome: string; grupo_id: string | null };
// semana → (categoria_id → qtd)
type CatDist = Record<string, Record<string, number>>;
// Um bloco de subcoleção no editor: nome + semanas (semana→qtd) + distribuição por categoria.
type SubBlock = { id: string | null; nome: string; weeks: Record<string, number | null>; cats: CatDist };

const somaCats = (m?: Record<string, number>) => Object.values(m ?? {}).reduce((a, b) => a + (b || 0), 0);

// Janela: distribui a qtd de uma semana entre categorias (organizadas por grupo). A soma
// tem que fechar com o total da semana (ou zero = sem distribuição).
function CategoriaDistribuicaoDialog({
  total, value, grupos, categorias, onClose, onSave,
}: {
  total: number; value: Record<string, number>; grupos: Grupo[]; categorias: Categoria[];
  onClose: () => void; onSave: (m: Record<string, number>) => void;
}) {
  const [map, setMap] = useState<Record<string, number>>(value ?? {});
  const sum = somaCats(map);
  const resto = total - sum;
  const setQtd = (catId: string, n: number) => setMap((m) => { const x = { ...m }; if (n > 0) x[catId] = n; else delete x[catId]; return x; });
  const valid = sum <= total; // pode ser parcial: o resto vira cards sem categoria
  const semGrupo = categorias.filter((c) => !c.grupo_id || !grupos.some((g) => g.id === c.grupo_id));
  const blocos: { g: Grupo | null; cats: Categoria[] }[] = [
    ...grupos.map((g) => ({ g, cats: categorias.filter((c) => c.grupo_id === g.id) })).filter((b) => b.cats.length),
    ...(semGrupo.length ? [{ g: null as Grupo | null, cats: semGrupo }] : []),
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Categorias da semana</DialogTitle></DialogHeader>
        <div className="max-h-[55vh] overflow-y-auto space-y-3 pr-1">
          {blocos.map(({ g, cats }, i) => {
            const sub = cats.reduce((a, c) => a + (map[c.id] || 0), 0);
            return (
              <div key={g?.id ?? `nogrp-${i}`}>
                <div className="text-xs font-semibold flex justify-between border-b pb-0.5 mb-1">
                  <span>{g?.nome ?? "Sem grupo"}</span><span className="text-muted-foreground tabular-nums">{sub}</span>
                </div>
                <div className="space-y-1 pl-1">
                  {cats.map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-2">
                      <span className="text-sm">{c.nome}</span>
                      <div className="w-24"><NumberInput integer placeholder="0" value={map[c.id] ? String(map[c.id]) : ""} onChange={(e) => setQtd(c.id, Number(e.target.value) || 0)} /></div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {blocos.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma categoria cadastrada.</p>}
        </div>
        {/* flex-row também no mobile: Cancelar à esquerda, Aplicar à direita (não empilhar). */}
        <DialogFooter className="flex-row items-center justify-end gap-2">
          <span className={`mr-auto text-sm tabular-nums ${sum > total ? "text-destructive" : "text-muted-foreground"}`}>
            {sum} / {total}{resto > 0 ? ` · resto ${resto} sem categoria` : ""}
          </span>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!valid} onClick={() => onSave(map)}>Aplicar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Editor das 5 semanas (reutilizado no modo simples e em cada subcoleção). Cada semana
// ligada tem qtd + botão de categorias (distribui a qtd por categoria).
function WeeksEditor({
  value, onChange, cats, onCatsChange, grupos, categorias,
}: {
  value: Record<string, number | null>; onChange: (w: Record<string, number | null>) => void;
  cats: CatDist; onCatsChange: (c: CatDist) => void;
  grupos: Grupo[]; categorias: Categoria[];
}) {
  const [dlgWeek, setDlgWeek] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {WEEKS.map((s) => {
        const on = s in value; // marcada = chave presente (valor pode ser null = vazio)
        const total = value[s] ?? 0;
        const dist = somaCats(cats[s]);
        const distFecha = dist <= total; // parcial é ok (resto = sem categoria); vermelho só se passar
        return (
          <div key={s} className="flex items-center gap-3">
            <Checkbox checked={on} onCheckedChange={(v) => { const n = { ...value }; if (v) n[s] = n[s] ?? null; else delete n[s]; onChange(n); }} />
            <span className="w-16 text-sm">Semana {s}</span>
            {on && <div className="w-24"><NumberInput integer placeholder="0" value={value[s] == null ? "" : String(value[s])} onChange={(e) => onChange({ ...value, [s]: e.target.value === "" ? null : Number(e.target.value) })} /></div>}
            {on && total > 0 && (
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setDlgWeek(s)}>
                <Tags className="h-3.5 w-3.5 mr-1" />
                {dist > 0 ? <span className={distFecha ? "" : "text-destructive"}>{dist}/{total}</span> : "Categorias"}
              </Button>
            )}
          </div>
        );
      })}
      {dlgWeek && (
        <CategoriaDistribuicaoDialog
          total={value[dlgWeek] ?? 0}
          value={cats[dlgWeek] ?? {}}
          grupos={grupos}
          categorias={categorias}
          onClose={() => setDlgWeek(null)}
          onSave={(m) => { onCatsChange({ ...cats, [dlgWeek]: m }); setDlgWeek(null); }}
        />
      )}
    </div>
  );
}

// Cards da coleção que não estão em nenhum bucket (sem semana/subcoleção): atribui direto
// aqui — sobe a qtd da semana (e a categoria, se o card tiver), pra OTB e Planejamento baterem.
function NaoClassificados({
  cards, subcolecoes, onChanged,
}: {
  cards: any[];
  subcolecoes: { id: string; nome: string }[];
  onChanged: () => void;
}) {
  const [sel, setSel] = useState<Record<string, { sub: string | null; sem: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const hasSubs = subcolecoes.length > 0;
  const assign = async (cardId: string) => {
    const s = sel[cardId] ?? { sub: null, sem: "" };
    if (!s.sem) { toast.error("Escolha a semana"); return; }
    if (hasSubs && !s.sub) { toast.error("Escolha a subcoleção"); return; }
    setBusy(cardId);
    const { error } = await supabase.rpc("otb_atribuir_card" as any, {
      _modelo_id: cardId, _subcolecao_id: hasSubs ? s.sub : null, _semana: s.sem,
    });
    setBusy(null);
    if (error) { toast.error(mensagemErro(error, "Erro ao atribuir")); return; }
    toast.success("Card atribuído");
    onChanged();
  };
  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="text-sm font-medium flex items-center justify-between">
        <span>Não classificados</span><Badge variant="secondary">{cards.length}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">Cards desta coleção sem semana/subcoleção. Atribua para eles entrarem na contagem do plano.</p>
      <div className="space-y-2">
        {cards.map((c) => {
          const s = sel[c.id] ?? { sub: null, sem: "" };
          return (
            <div key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="flex-1 min-w-[110px] truncate">{c.nome || "Sem nome"}{c.categorias_produto?.nome ? ` · ${c.categorias_produto.nome}` : ""}</span>
              {hasSubs && (
                <Select value={s.sub ?? ""} onValueChange={(v) => setSel((p) => ({ ...p, [c.id]: { ...s, sub: v } }))}>
                  <SelectTrigger className="w-32 h-8"><SelectValue placeholder="Subcoleção" /></SelectTrigger>
                  <SelectContent>{subcolecoes.map((sc) => <SelectItem key={sc.id} value={sc.id}>{sc.nome}</SelectItem>)}</SelectContent>
                </Select>
              )}
              <Select value={s.sem} onValueChange={(v) => setSel((p) => ({ ...p, [c.id]: { ...s, sem: v } }))}>
                <SelectTrigger className="w-24 h-8"><SelectValue placeholder="Semana" /></SelectTrigger>
                <SelectContent>{WEEKS.map((w) => <SelectItem key={w} value={w}>Semana {w}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" className="h-8" disabled={busy === c.id} onClick={() => assign(c.id)}>Atribuir</Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ColecaoSheet({
  colecaoId, meses, anos, onClose, onSaved,
}: {
  colecaoId: string | null;
  meses: Opt[]; anos: Opt[];
  onClose: () => void; onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [anoId, setAnoId] = useState<string | null>(null);
  const [mesId, setMesId] = useState<string | null>(null);
  const [orcamento, setOrcamento] = useState<string>("");
  const [weeks, setWeeks] = useState<Record<string, number | null>>({}); // modo simples (sem subcoleção)
  const [weekCats, setWeekCats] = useState<CatDist>({}); // distribuição por categoria (modo simples)
  const [subs, setSubs] = useState<SubBlock[]>([]); // subcoleções, cada uma com suas semanas
  const [confirmDel, setConfirmDel] = useState(false);

  const { data: grupos = [] } = useQuery({
    queryKey: ["otb-grupos"],
    queryFn: async () => ((await supabase.from("grupos_produto").select("id, nome").order("nome")).data ?? []) as Grupo[],
  });
  const { data: categorias = [] } = useQuery({
    queryKey: ["otb-categorias-all"],
    queryFn: async () => ((await supabase.from("categorias_produto").select("id, nome, grupo_id").order("nome")).data ?? []) as Categoria[],
  });

  const { data } = useQuery({
    queryKey: ["otb-colecao", colecaoId],
    enabled: !!colecaoId,
    queryFn: async () => {
      const { data: col, error } = await supabase.from("colecoes")
        .select("*, colecao_semanas(semana, qtd_planejada, subcolecao_id), colecao_subcolecoes(id, nome, ordem), colecao_semana_categorias(subcolecao_id, semana, categoria_id, qtd)")
        .eq("id", colecaoId!).single();
      if (error) throw error;
      return col as any;
    },
  });
  useEffect(() => {
    if (!data) return;
    setNome(data.nome ?? "");
    setAnoId(data.ano_id ?? null);
    setMesId(data.mes_id ?? null);
    setOrcamento(data.orcamento != null ? String(data.orcamento) : "");
    const allSem = (data.colecao_semanas ?? []) as { semana: string; qtd_planejada: number; subcolecao_id: string | null }[];
    const allCat = (data.colecao_semana_categorias ?? []) as { subcolecao_id: string | null; semana: string; categoria_id: string; qtd: number }[];
    const catsFor = (subId: string | null): CatDist => {
      const out: CatDist = {};
      for (const c of allCat) if ((c.subcolecao_id ?? null) === subId) (out[c.semana] ??= {})[c.categoria_id] = c.qtd;
      return out;
    };
    // Semanas de nível coleção (modo simples).
    const flat: Record<string, number | null> = {};
    for (const s of allSem) if (!s.subcolecao_id) flat[s.semana] = s.qtd_planejada > 0 ? s.qtd_planejada : null;
    setWeeks(flat);
    setWeekCats(catsFor(null));
    // Subcoleções ordenadas, cada uma com as suas semanas + distribuição por categoria.
    const subList = ((data.colecao_subcolecoes ?? []) as { id: string; nome: string; ordem: number }[])
      .slice()
      .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
      .map((sc) => {
        const wk: Record<string, number | null> = {};
        for (const s of allSem) if (s.subcolecao_id === sc.id) wk[s.semana] = s.qtd_planejada > 0 ? s.qtd_planejada : null;
        return { id: sc.id, nome: sc.nome, weeks: wk, cats: catsFor(sc.id) } as SubBlock;
      });
    setSubs(subList);
  }, [data]);

  // Queries para painel de resumo (só quando editando coleção existente)
  const { data: modelos = [] } = useQuery({
    queryKey: ["otb-colecao-modelos", colecaoId],
    enabled: !!colecaoId,
    queryFn: async () => {
      const { data, error } = await supabase.from("modelos").select("id, linha_id, preco_venda, status_planejamento").eq("colecao_id", colecaoId!);
      if (error) throw error;
      return data as { id: string; linha_id: string | null; preco_venda: number | null; status_planejamento: string | null }[];
    },
  });
  // Todos os cards da coleção (p/ achar os "não classificados" — fora de qualquer bucket).
  const { data: colecaoCards = [] } = useQuery({
    queryKey: ["otb-colecao-cards", colecaoId],
    enabled: !!colecaoId,
    queryFn: async () => {
      const { data } = await supabase.from("modelos")
        .select("id, nome, subcolecao, semana, categoria_principal_id, categorias_produto:categoria_principal_id(nome)")
        .eq("colecao_id", colecaoId!);
      return (data ?? []) as any[];
    },
  });
  // Buckets salvos (subcoleção-nome, semana). Card fora de qualquer bucket = não classificado.
  const naoClassificados = useMemo(() => {
    if (!data) return [] as any[];
    const subName = new Map<string, string>(((data.colecao_subcolecoes ?? []) as any[]).map((s) => [s.id, s.nome]));
    const bucketKeys = new Set<string>();
    for (const cs of (data.colecao_semanas ?? []) as any[]) {
      const sn = cs.subcolecao_id ? subName.get(cs.subcolecao_id) ?? "" : "";
      bucketKeys.add(`${sn}||${cs.semana}`);
    }
    return colecaoCards.filter((c) => !bucketKeys.has(`${c.subcolecao ?? ""}||${c.semana ?? ""}`));
  }, [data, colecaoCards]);
  const onCardAtribuido = () => {
    qc.invalidateQueries({ queryKey: ["otb-colecao", colecaoId] });
    qc.invalidateQueries({ queryKey: ["otb-colecao-cards", colecaoId] });
    qc.invalidateQueries({ queryKey: ["otb-colecao-modelos", colecaoId] });
    qc.invalidateQueries({ queryKey: ["otb-colecoes"] });
    qc.invalidateQueries({ queryKey: ["otb-semanas-todas"] });
    qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
  };

  const modeloIds = modelos.map((m) => m.id).sort();
  const { data: custoMap = {} } = useQuery({
    queryKey: ["otb-custo", modeloIds],
    enabled: modeloIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("custo_unitario_modelos" as any, { _ids: modeloIds });
      if (error) throw error;
      return (data ?? {}) as Record<string, { previsto: number; real: number; confirmado: boolean }>;
    },
  });
  const { data: gradeMap = {} } = useQuery({
    queryKey: ["otb-grade", modeloIds],
    enabled: modeloIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("modelo_grades").select("modelo_id, grade_total").in("modelo_id", modeloIds);
      if (error) throw error;
      const m: Record<string, number> = {};
      for (const r of (data ?? []) as any[]) m[r.modelo_id] = (m[r.modelo_id] ?? 0) + Number(r.grade_total ?? 0);
      return m;
    },
  });
  const { data: linhas = [] } = useQuery({
    queryKey: ["opt", "linhas", "markup"],
    enabled: !!colecaoId,
    queryFn: async () => {
      const { data } = await supabase.from("linhas").select("id, markup");
      return (data ?? []) as { id: string; markup: number | null }[];
    },
  });
  const linhaMarkupMap = Object.fromEntries(linhas.map((l) => [l.id, l.markup]));

  const resumo = computeColecaoResumo(modelos, custoMap as any, gradeMap as any, linhaMarkupMap as any);
  // Contagens p/ o diálogo de exclusão: modelos planejados bloqueiam; os demais são apagados.
  const nPlanejado = modelos.filter((m) => m.status_planejamento === "planejado").length;
  const nExcluir = modelos.length - nPlanejado;
  const orc = orcamento === "" ? null : Number(orcamento);
  const saldo = orc != null ? orc - resumo.previsto : null;
  const pct = orc && orc > 0 ? resumo.previsto / orc : 0;
  const statusCor = orc == null ? "text-muted-foreground" : pct > 1 ? "text-destructive" : pct >= 0.9 ? "text-amber-600" : "text-emerald-600";
  const statusTxt = orc == null ? "Sem orçamento" : pct > 1 ? "Estourou" : pct >= 0.9 ? "Perto do teto" : "Dentro";

  // Helper compartilhado: persiste a coleção + semanas, devolve o id.
  // NÃO exibe toast nem fecha o sheet — quem chama é responsável por isso.
  const persistColecao = async (): Promise<string> => {
    if (!nome.trim()) throw new Error("Informe o nome da coleção.");
    const cleanSubs = subs.map((s) => ({ ...s, nome: s.nome.trim() })).filter((s) => s.nome !== "");
    const nomesLower = cleanSubs.map((s) => s.nome.toLowerCase());
    if (new Set(nomesLower).size !== nomesLower.length) throw new Error("Há subcoleções com o mesmo nome.");

    // A distribuição por categoria de cada semana ligada tem que fechar com a qtd (ou ser 0).
    const validarCats = (wk: Record<string, number | null>, cats: CatDist, ctx: string) => {
      for (const s of WEEKS) {
        if (!(s in wk)) continue;
        const total = wk[s] ?? 0;
        const dist = somaCats(cats[s]);
        if (dist > total) throw new Error(`${ctx}Semana ${s}: a distribuição por categoria (${dist}) passou da quantidade (${total}).`);
      }
    };
    if (cleanSubs.length > 0) cleanSubs.forEach((s) => validarCats(s.weeks, s.cats, `Subcoleção "${s.nome}" · `));
    else validarCats(weeks, weekCats, "");

    const payload = { nome: nome.trim(), ano_id: anoId, mes_id: mesId, orcamento: orcamento === "" ? null : Number(orcamento) };
    let id = colecaoId;
    if (id) {
      const { error } = await supabase.from("colecoes").update(payload).eq("id", id);
      if (error) throw error;
    } else {
      const { data: ins, error } = await supabase.from("colecoes").insert(payload).select("id").single();
      if (error) throw error;
      id = (ins as any).id;
    }

    // Regrava as semanas de um (coleção, subcoleção): apaga todas e insere as marcadas.
    const saveWeeks = async (subId: string | null, wk: Record<string, number | null>) => {
      let del = supabase.from("colecao_semanas").delete().eq("colecao_id", id!);
      del = subId ? del.eq("subcolecao_id", subId) : (del.is as any)("subcolecao_id", null);
      { const { error } = await del; if (error) throw error; }
      const marked = WEEKS.filter((s) => s in wk);
      if (marked.length) {
        const { error } = await supabase.from("colecao_semanas")
          .insert(marked.map((s) => ({ colecao_id: id!, subcolecao_id: subId, semana: s, qtd_planejada: wk[s] ?? 0 })) as any);
        if (error) throw error;
      }
    };
    // Regrava a distribuição por categoria de um (coleção, subcoleção): só das semanas ligadas.
    const saveCats = async (subId: string | null, wk: Record<string, number | null>, cats: CatDist) => {
      let del = supabase.from("colecao_semana_categorias").delete().eq("colecao_id", id!);
      del = subId ? del.eq("subcolecao_id", subId) : (del.is as any)("subcolecao_id", null);
      { const { error } = await del; if (error) throw error; }
      const rows: any[] = [];
      for (const s of WEEKS) {
        if (!(s in wk)) continue;
        const m = cats[s]; if (!m) continue;
        for (const [catId, q] of Object.entries(m)) if (q > 0) rows.push({ colecao_id: id!, subcolecao_id: subId, semana: s, categoria_id: catId, qtd: q });
      }
      if (rows.length) { const { error } = await supabase.from("colecao_semana_categorias").insert(rows); if (error) throw error; }
    };

    if (cleanSubs.length > 0) {
      // Com subcoleções: zera as semanas/categorias de nível coleção (modo simples desligado).
      await saveWeeks(null, {});
      await saveCats(null, {}, {});
      // Remove subcoleções que sumiram (cascade apaga as semanas/categorias delas).
      const keptIds = cleanSubs.map((s) => s.id).filter(Boolean) as string[];
      let delSub = supabase.from("colecao_subcolecoes").delete().eq("colecao_id", id!);
      // uuid no filtro `in` vai SEM aspas (aspas quebram o cast → 22P02).
      if (keptIds.length) delSub = delSub.not("id", "in", `(${keptIds.join(",")})`);
      { const { error } = await delSub; if (error) throw error; }
      // Insere/atualiza cada subcoleção + regrava as suas semanas e distribuição.
      for (let i = 0; i < cleanSubs.length; i++) {
        const s = cleanSubs[i];
        let subId = s.id;
        if (subId) {
          const { error } = await supabase.from("colecao_subcolecoes").update({ nome: s.nome, ordem: i } as any).eq("id", subId);
          if (error) throw error;
        } else {
          const { data: insSub, error } = await supabase.from("colecao_subcolecoes")
            .insert({ colecao_id: id!, nome: s.nome, ordem: i } as any).select("id").single();
          if (error) throw error;
          subId = (insSub as any).id;
        }
        await saveWeeks(subId, s.weeks);
        await saveCats(subId, s.weeks, s.cats);
      }
    } else {
      // Sem subcoleções: apaga todas (cascade suas semanas/categorias) e grava as da coleção.
      { const { error } = await supabase.from("colecao_subcolecoes").delete().eq("colecao_id", id!); if (error) throw error; }
      await saveWeeks(null, weeks);
      await saveCats(null, weeks, weekCats);
    }
    return id!;
  };

  const isConfirmada = data?.status === "confirmada";

  const save = useMutation({
    mutationFn: async () => {
      const id = await persistColecao();
      // Já confirmada: Salvar também RECONCILIA os cards (mantém em sincronia com as semanas).
      if (isConfirmada) {
        const { data: r, error } = await supabase.rpc("otb_confirmar" as any, { _colecao_id: id });
        if (error) throw error;
        return r as { criados: number; removidos: number; mantidos: number };
      }
      return null;
    },
    onSuccess: (r) => {
      const partes = r ? [r.criados ? `${r.criados} criado(s)` : "", r.removidos ? `${r.removidos} removido(s)` : ""].filter(Boolean) : [];
      toast.success(`Coleção salva.${partes.length ? " " + partes.join(" · ") : ""}`);
      qc.invalidateQueries({ queryKey: ["otb-colecoes"] });
      qc.invalidateQueries({ queryKey: ["otb-semanas-todas"] });
      if (isConfirmada) {
        qc.invalidateQueries({ queryKey: ["otb-modelos-link"] });
        qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      }
      onSaved(); onClose();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar coleção")),
  });

  const confirmar = useMutation({
    mutationFn: async () => {
      const id = await persistColecao();
      const { data, error } = await supabase.rpc("otb_confirmar" as any, { _colecao_id: id });
      if (error) throw error;
      return data as { criados: number; removidos: number; mantidos: number };
    },
    onSuccess: (r) => {
      const partes = [
        r.criados ? `${r.criados} criado(s)` : "",
        r.removidos ? `${r.removidos} removido(s)` : "",
        r.mantidos ? `${r.mantidos} mantido(s) (preenchidos)` : "",
      ].filter(Boolean);
      toast.success(`Coleção confirmada. ${partes.join(" · ") || "Sem mudanças."}`);
      qc.invalidateQueries({ queryKey: ["otb-colecoes"] });
      qc.invalidateQueries({ queryKey: ["otb-semanas-todas"] });
      qc.invalidateQueries({ queryKey: ["otb-modelos-link"] });
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      onSaved(); onClose();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao confirmar coleção")),
  });

  const excluir = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("otb_excluir_colecao" as any, { _colecao_id: colecaoId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Coleção excluída");
      qc.invalidateQueries({ queryKey: ["otb-colecoes"] });
      qc.invalidateQueries({ queryKey: ["otb-semanas-todas"] });
      qc.invalidateQueries({ queryKey: ["otb-modelos-link"] });
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      setConfirmDel(false); onSaved(); onClose();
    },
    // Bloqueio (há modelo planejado) chega como erro: mostra a mensagem do banco.
    onError: (e: any) => { setConfirmDel(false); toast.error(mensagemErro(e, "Erro ao excluir coleção")); },
  });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-[70vw] flex flex-col p-0 max-sm:[&>button]:hidden">
        <SheetHeader className="p-4 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2">
            {colecaoId ? "Editar coleção" : "Nova coleção"}
            {colecaoId && data && <Badge variant={isConfirmada ? "secondary" : "outline"}>{isConfirmada ? "Confirmada" : "Rascunho"}</Badge>}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid gap-1"><Label>Nome de Coleção</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} /></div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="grid gap-1"><Label>Ano</Label>
              <Select value={anoId ?? ""} onValueChange={setAnoId}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{anos.map((a) => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1"><Label>Mês</Label>
              <Select value={mesId ?? ""} onValueChange={setMesId}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{meses.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1"><Label>Orçamento</Label><NumberInput value={orcamento} onChange={(e) => setOrcamento(e.target.value)} /></div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="block">Subcoleções e Modelos por Semana</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setSubs((p) => [...p, { id: null, nome: "", weeks: {}, cats: {} }])}>
                <Plus className="h-4 w-4 mr-1" /> Subcoleção
              </Button>
            </div>
            {subs.length === 0 ? (
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-xs text-muted-foreground">Sem subcoleção: informe os modelos por semana da coleção. Ou clique em “Subcoleção” para dividir a coleção.</p>
                <WeeksEditor value={weeks} onChange={setWeeks} cats={weekCats} onCatsChange={setWeekCats} grupos={grupos} categorias={categorias} />
              </div>
            ) : (
              <div className="space-y-3">
                {subs.map((s, i) => (
                  <div key={i} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input value={s.nome} placeholder="Nome da subcoleção (ex.: Praia)"
                        onChange={(e) => setSubs((p) => p.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} />
                      <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setSubs((p) => p.filter((_, j) => j !== i))} aria-label="Remover subcoleção">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <WeeksEditor
                      value={s.weeks}
                      onChange={(w) => setSubs((p) => p.map((x, j) => (j === i ? { ...x, weeks: w } : x)))}
                      cats={s.cats}
                      onCatsChange={(c) => setSubs((p) => p.map((x, j) => (j === i ? { ...x, cats: c } : x)))}
                      grupos={grupos}
                      categorias={categorias}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
          {colecaoId && naoClassificados.length > 0 && (
            <NaoClassificados
              cards={naoClassificados}
              subcolecoes={((data?.colecao_subcolecoes ?? []) as any[]).map((s) => ({ id: s.id, nome: s.nome }))}
              onChanged={onCardAtribuido}
            />
          )}
          <div className="rounded-lg border p-3 space-y-1 text-sm">
            {colecaoId && (
              <div className="flex justify-between border-b pb-1 mb-1">
                <span className="text-muted-foreground">No Planejamento</span>
                <span className="tabular-nums">
                  {colecaoCards.length} card(s){naoClassificados.length > 0 ? ` · ${naoClassificados.length} não classificado(s)` : ""}
                </span>
              </div>
            )}
            <div className="flex justify-between"><span className="text-muted-foreground">Orçamento</span><span className="tabular-nums">{orc != null ? brl(orc) : "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Custo previsto</span><span className="tabular-nums">{brl(resumo.previsto)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Custo real</span><span className="tabular-nums">{brl(resumo.real)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Poder de venda</span><span className="tabular-nums">{brl(resumo.poder)}</span></div>
            <div className="flex justify-between border-t pt-1"><span className="text-muted-foreground">Saldo (orç. − previsto)</span><span className="tabular-nums">{saldo != null ? brl(saldo) : "—"}</span></div>
            <div className={`flex justify-between font-medium ${statusCor}`}><span>Status</span><span>{statusTxt}</span></div>
            <div className="text-xs text-muted-foreground pt-1">{resumo.qtdModelos} modelo(s) · {resumo.qtdPecas} peça(s)</div>
          </div>
        </div>
        <div className="p-4 border-t shrink-0 flex justify-end gap-2">
          {colecaoId && (
            <Button variant="destructive" size="icon" className="sm:mr-auto" onClick={() => setConfirmDel(true)} disabled={excluir.isPending} aria-label="Excluir coleção">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button variant="outline" onClick={onClose} aria-label="Voltar" className="shrink-0 max-sm:order-first max-sm:mr-auto max-sm:aspect-square max-sm:px-0">
            <ArrowLeft className="h-4 w-4 sm:hidden" />
            <span className="max-sm:sr-only">Cancelar</span>
          </Button>
          {!isConfirmada && (
            <Button variant="secondary" onClick={() => confirmar.mutate()} disabled={confirmar.isPending || save.isPending} aria-label="Confirmar" className="shrink-0 max-sm:aspect-square max-sm:px-0">
              <Check className="h-4 w-4 sm:hidden" />
              <span className="max-sm:sr-only">{confirmar.isPending ? "Confirmando…" : "Confirmar"}</span>
            </Button>
          )}
          <Button onClick={() => save.mutate()} disabled={save.isPending || confirmar.isPending} aria-label="Salvar" className="shrink-0 max-sm:aspect-square max-sm:px-0">
            <Save className="h-4 w-4 sm:hidden" />
            <span className="max-sm:sr-only">{save.isPending ? "Salvando…" : "Salvar"}</span>
          </Button>
        </div>
      </SheetContent>

      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a coleção “{nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {nPlanejado > 0 ? (
                <>
                  Esta coleção tem <strong>{nPlanejado}</strong> modelo(s) já <strong>planejado(s)</strong>, então a exclusão será{" "}
                  <strong>bloqueada</strong>. Remova ou reprove esses modelos antes de excluir a coleção.
                </>
              ) : (
                <>
                  Exclui a coleção, suas semanas e <strong>{nExcluir}</strong> modelo(s) vinculado(s) que ainda estão{" "}
                  <strong>em planejamento</strong> (ou reprovados) — <strong>inclusive os já preenchidos</strong>. Esta ação não pode ser desfeita.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); excluir.mutate(); }}
              disabled={excluir.isPending || nPlanejado > 0}
            >
              {excluir.isPending ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
