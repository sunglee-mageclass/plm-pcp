import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Rocket, Upload, CheckCircle2, Camera, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FilterButton, SearchToggle } from "@/components/shared/filters";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useSort } from "@/components/shared/sort";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { useGridCols, GRID_COLS_OPTIONS, GRID_COLS_CLASS, useCompactCards } from "@/hooks/useGridCols";
import { LayoutGrid } from "lucide-react";

import { RequirePermission, useReadOnly } from "@/components/RequirePermission";
import { RevisaoErroBadge, VerificarRevisao } from "@/components/producao/RevisaoErro";
import { EmptyState } from "@/components/shared/EmptyState";
export const Route = createFileRoute("/_authenticated/producao/lancamentos")({
  component: () => (
    <RequirePermission page="producao_lancamentos">
      <LancamentosPage />
    </RequirePermission>
  ),
});

type VarInfo = { num: number; label: string; gradeTotal: number };
type LancCard = {
  modelo_id: string;
  cad_id: string;
  ref: string | null;
  nome: string | null;
  colecao: string | null;
  linha: string | null;
  mes: string | null;
  ano: string | null;
  mes_id: string | null;
  ano_id: string | null;
  linha_id: string | null;
  categoria_nome: string | null;
  fotos_modelo: string[];
  tecido_nome: string | null;
  variantes: VarInfo[];
  gradeTotal: number;
  cqId: string | null;
  fotoByNum: Record<string, boolean>;
  lancamento?: any;
  revisao_pendente?: any;
};

function LancamentosPage() {
  const qc = useQueryClient();
  const fl = useFieldLabels();
  const readOnly = useReadOnly();
  const gridRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useGridCols("lancamentos");
  const compact = useCompactCards(gridRef, cols);
  const [q, setQ] = useState("");
  const [fColecao, setFColecao] = useState("all");
  const [fLinha, setFLinha] = useState("all");
  const [fMes, setFMes] = useState("all");
  const [fAno, setFAno] = useState("all");

  const { data: meses = [] } = useQuery({
    queryKey: ["opt", "meses"],
    queryFn: async () => (await supabase.from("meses").select("id, nome:mes").order("mes")).data ?? [],
  });
  const { data: anos = [] } = useQuery({
    queryKey: ["opt", "anos"],
    queryFn: async () => (await supabase.from("anos").select("id, nome:ano").order("ano")).data ?? [],
  });

  const { data: cards = [], isLoading } = useQuery<LancCard[]>({
    queryKey: ["lancamentos-cards", meses, anos],
    queryFn: async () => {
      // Produtos cujo Controle de Qualidade foi CONFIRMADO.
      const { data: modelos, error } = await supabase
        .from("modelos")
        .select("id, ref, nome, colecao, mes_id, ano_id, linha_id, revisao_pendente, fotos_modelo, linha:linha_id(nome), categorias_produto:categoria_principal_id(nome), cad(id, controle_qualidade(id, status, fotografado_variantes))")
        .eq("enviado_cad", true);
      if (error) throw error;

      const list = (modelos ?? []).filter(
        (m: any) => m.cad?.[0]?.id && (m.cad[0].controle_qualidade?.[0]?.status ?? "pendente") === "confirmado",
      );
      const modeloIds = list.map((m: any) => m.id);
      const cadIds = list.map((m: any) => m.cad[0].id);

      // Grades cadastradas (por variante) + variantes do Tecido Principal.
      const [gradesRes, tecRes] = await Promise.all([
        cadIds.length
          ? supabase.from("cad_grades").select("cad_id, variante_numero, grade_total_real").in("cad_id", cadIds)
          : Promise.resolve({ data: [] as any[] }),
        cadIds.length
          ? supabase
              .from("cad_tecidos")
              .select("cad_id, tipo, numero, artigos:artigo_id(nome), cad_tecido_variantes(ordem, variantes_tecido:variante_tecido_id(nome_variante, cor:cor_id(nome)))")
              .in("cad_id", cadIds)
              .eq("tipo", "tecido")
              .eq("numero", 1)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      // Grade REAL do CQ (cad_grades.grade_total_real). Como os cards já são CQ
      // CONFIRMADO, a grade real reflete o que será de fato usado (desconta defeitos),
      // não a planejada — que era o errado.
      const gradeByCad = new Map<string, { num: number; total: number }[]>();
      (gradesRes.data ?? []).forEach((g: any) => {
        const arr = gradeByCad.get(g.cad_id) ?? [];
        arr.push({ num: Number(g.variante_numero), total: Number(g.grade_total_real ?? 0) });
        gradeByCad.set(g.cad_id, arr);
      });
      const tecByCad = new Map<string, any>();
      (tecRes.data ?? []).forEach((t: any) => tecByCad.set(t.cad_id, t));

      const mesMap = new Map((meses as any[]).map((m) => [m.id, m.nome]));
      const anoMap = new Map((anos as any[]).map((a) => [a.id, a.nome]));

      return list.map((m: any): LancCard => {
        const cadId = m.cad[0].id;
        const tec = tecByCad.get(cadId);
        const gradeRows = gradeByCad.get(cadId) ?? [];
        const gradeByNum = new Map(gradeRows.map((g) => [g.num, g.total]));
        const variantes: VarInfo[] = ((tec?.cad_tecido_variantes ?? []) as any[])
          .filter((v) => v.ordem != null)
          .map((v) => {
            const cor = v.variantes_tecido?.cor?.nome || v.variantes_tecido?.nome_variante || "—";
            return { num: Number(v.ordem), label: `Variante ${v.ordem} - ${cor}`, gradeTotal: gradeByNum.get(Number(v.ordem)) ?? 0 };
          })
          .sort((a, b) => a.num - b.num);
        const gradeTotal = gradeRows.reduce((s, g) => s + g.total, 0);
        const cqRow = m.cad?.[0]?.controle_qualidade?.[0];
        const fv = cqRow?.fotografado_variantes ?? {};
        const fotoByNum: Record<string, boolean> = {};
        variantes.forEach((v) => { fotoByNum[String(v.num)] = fv?.[String(v.num)] === true; });
        return {
          modelo_id: m.id,
          cad_id: cadId,
          ref: m.ref,
          nome: m.nome,
          colecao: m.colecao,
          linha: m.linha?.nome ?? null,
          mes: m.mes_id ? (mesMap.get(m.mes_id) ?? null) : null,
          ano: m.ano_id ? (anoMap.get(m.ano_id) ?? null) : null,
          mes_id: m.mes_id,
          ano_id: m.ano_id,
          linha_id: m.linha_id,
          categoria_nome: m.categorias_produto?.nome ?? null,
          fotos_modelo: Array.isArray(m.fotos_modelo) ? m.fotos_modelo : [],
          tecido_nome: tec?.artigos?.nome ?? null,
          variantes,
          gradeTotal,
          cqId: cqRow?.id ?? null,
          fotoByNum,
          lancamento: m.lancamentos?.[0] ?? null,
          revisao_pendente: m.revisao_pendente,
        };
      });
    },
  });

  // Carrega o lançamento (foto amostra) separadamente p/ não complicar a query acima.
  const { data: lancByCad = {} } = useQuery({
    queryKey: ["lancamentos-rows", cards.map((c) => c.cad_id)],
    enabled: cards.length > 0,
    queryFn: async () => {
      const cadIds = cards.map((c) => c.cad_id);
      const { data } = await supabase.from("lancamentos").select("*").in("cad_id", cadIds);
      const m: Record<string, any> = {};
      (data ?? []).forEach((l: any) => { m[l.cad_id] = l; });
      return m;
    },
  });

  const colecoes = useMemo(() => Array.from(new Set(cards.map((c) => c.colecao).filter(Boolean))) as string[], [cards]);
  const linhas = useMemo(() => {
    const m = new Map<string, string>();
    cards.forEach((c) => { if (c.linha_id && c.linha) m.set(c.linha_id, c.linha); });
    return Array.from(m, ([id, nome]) => ({ id, nome }));
  }, [cards]);

  const filtered = cards.filter((c) => {
    if (q && !`${c.ref ?? ""} ${c.nome ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (fColecao !== "all" && c.colecao !== fColecao) return false;
    if (fLinha !== "all" && c.linha_id !== fLinha) return false;
    if (fMes !== "all" && c.mes_id !== fMes) return false;
    if (fAno !== "all" && c.ano_id !== fAno) return false;
    return true;
  });

  // Ordenação dos cards. ref/nome/colecao/linha/categoria_nome/gradeTotal já são
  // valores CRUS no card (não formatados), então não precisam de accessors.
  // `sorted` substitui `filtered` na renderização.
  const s = useSort(filtered, undefined);
  const sorted = s.sorted;

  // Sentinela "__none__" = ordem padrão. (Radix Select v2 PROÍBE SelectItem com
  // value "" — daí o sentinela.) Sem accessor "__none__" nem campo homônimo no card,
  // useSort lê undefined p/ todos → comparador estável → mantém a ordem original.
  const SORT_NONE = "__none__";
  const SORT_COLS: { key: string; label: string }[] = [
    { key: SORT_NONE, label: "Padrão" },
    { key: "ref", label: fl("ref") },
    { key: "nome", label: "Nome" },
    { key: "colecao", label: "Coleção" },
    { key: "linha", label: "Linha" },
    { key: "categoria_nome", label: "Categoria" },
    { key: "gradeTotal", label: "Grade total" },
  ];

  const uploadMut = useMutation({
    mutationFn: async (args: { card: LancCard; file: File }) => {
      const { card, file } = args;
      const lanc = (lancByCad as any)[card.cad_id];
      const { tenantPrefix } = await import("@/lib/storage-tenant");
      const tenant = await tenantPrefix();
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${tenant}/${card.modelo_id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("lancamentos").upload(path, file, { upsert: true });
      if (upErr) throw upErr;

      const today = new Date().toISOString().slice(0, 10);
      const payload = {
        cad_id: card.cad_id,
        modelo_id: card.modelo_id,
        foto_peca_amostra: path,
        data_lancamento: lanc?.data_lancamento ?? today,
        verificado: true,
      };
      if (lanc?.id) {
        const { error } = await supabase.from("lancamentos").update(payload).eq("id", lanc.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("lancamentos").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      toast.success("Foto enviada");
      await qc.invalidateQueries({ queryKey: ["lancamentos-rows"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao enviar foto")),
  });

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <Rocket className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="text-2xl font-bold">Lançamentos</h1>
            <p className="text-sm text-muted-foreground">Produtos com Controle de Qualidade confirmado.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SearchToggle value={q} onChange={setQ} placeholder={`${fl("ref")} ou nome…`} />
          <FilterButton
            filters={[
              { label: "Coleção", value: fColecao, onChange: setFColecao, options: [{ id: "all", nome: "Todas" }, ...colecoes.map((c) => ({ id: c, nome: c }))] },
              { label: "Linha", value: fLinha, onChange: setFLinha, options: [{ id: "all", nome: "Todas" }, ...linhas] },
              { label: "Mês", value: fMes, onChange: setFMes, options: [{ id: "all", nome: "Todos" }, ...(meses as any[]).map((m) => ({ id: m.id, nome: m.nome }))] },
              { label: "Ano", value: fAno, onChange: setFAno, options: [{ id: "all", nome: "Todos" }, ...(anos as any[]).map((a) => ({ id: a.id, nome: a.nome }))] },
            ]}
          />
        </div>
      </header>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="hidden lg:flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Colunas:</span>
          {GRID_COLS_OPTIONS.map((n) => (
            <Button key={n} size="sm" variant={cols === n ? "default" : "outline"} onClick={() => setCols(n)} className="h-7 w-9 px-0">{n}</Button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">Ordenar por</Label>
          <Select
            value={s.sortKey ?? SORT_NONE}
            // `toggle(v)` define a chave em ASC ao trocar de coluna; "Padrão"
            // (SORT_NONE) volta à ordem original. A direção é invertida pelo botão
            // ao lado (Radix não re-dispara onValueChange p/ a mesma opção).
            onValueChange={(v) => { if (v !== (s.sortKey ?? SORT_NONE)) s.toggle(v); }}
          >
            <SelectTrigger className="h-8 w-[140px]"><SelectValue placeholder="Padrão" /></SelectTrigger>
            <SelectContent>
              {SORT_COLS.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {s.sortKey && s.sortKey !== SORT_NONE && (
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => s.toggle(s.sortKey!)}
              aria-label={s.sortDir === "asc" ? "Ordenar decrescente" : "Ordenar crescente"}
              title={s.sortDir === "asc" ? "Crescente" : "Decrescente"}
            >
              {s.sortDir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
            </Button>
          )}
        </div>
        <span className="ml-auto text-xs text-muted-foreground"><Badge variant="secondary">{filtered.length}</Badge> produto(s)</span>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!isLoading && filtered.length === 0 && (
        <EmptyState icon={Rocket} title="Nenhum produto com CQ confirmado" description="Quando o CQ aprovar produtos, eles aparecerão aqui prontos para lançamento." />
      )}

      <div ref={gridRef} className={GRID_COLS_CLASS[cols]}>
        {sorted.map((c) => (
          <LancamentoCard
            key={c.modelo_id}
            card={{ ...c, lancamento: (lancByCad as any)[c.cad_id] ?? null }}
            compact={compact}
            onUpload={(file) => uploadMut.mutate({ card: c, file })}
            uploading={uploadMut.isPending}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
}

function LancamentoCard(props: { card: LancCard; compact: boolean; onUpload: (f: File) => void; uploading: boolean; readOnly: boolean }) {
  const { card, compact, readOnly } = props;
  const qc = useQueryClient();
  const [foto, setFoto] = useState<Record<string, boolean>>(card.fotoByNum);
  useEffect(() => { setFoto(card.fotoByNum); }, [card.cqId, JSON.stringify(card.fotoByNum)]);

  const { data: amostraUrl } = useQuery({
    queryKey: ["lanc-amostra", card.lancamento?.foto_peca_amostra],
    enabled: !!card.lancamento?.foto_peca_amostra,
    staleTime: 55 * 60 * 1000, // signed URL vale 1h — não revalidar a cada filtro/remontagem
    queryFn: async () => (await supabase.storage.from("lancamentos").createSignedUrl(card.lancamento.foto_peca_amostra, 3600)).data?.signedUrl ?? null,
  });
  const { data: modeloFoto } = useQuery({
    queryKey: ["modelo-foto", card.fotos_modelo?.[0]],
    enabled: !!card.fotos_modelo?.[0],
    staleTime: 55 * 60 * 1000,
    queryFn: async () => (await supabase.storage.from("modelos").createSignedUrl(card.fotos_modelo[0], 3600)).data?.signedUrl ?? null,
  });
  const img = amostraUrl ?? modeloFoto ?? null;

  // Câmera em 3 níveis: nenhuma foto → sem ícone; parcial → cinza; todas → verde.
  const total = card.variantes.length;
  const count = card.variantes.filter((v) => foto[String(v.num)]).length;
  const camColor = count === 0 ? null : count === total ? "text-emerald-500" : "text-muted-foreground";

  const saveFoto = useMutation({
    mutationFn: async (next: Record<string, boolean>) => {
      if (!card.cqId) throw new Error("Sem Controle de Qualidade para este modelo.");
      const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v).map(([k]) => [k, true]));
      const { error } = await supabase.from("controle_qualidade").update({ fotografado_variantes: clean } as never).eq("id", card.cqId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lancamentos-cards"] }),
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar foto")),
  });

  const toggle = (num: number) => {
    if (readOnly) return;
    const next = { ...foto, [String(num)]: !foto[String(num)] };
    setFoto(next);
    saveFoto.mutate(next);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Card className="overflow-hidden flex flex-col cursor-pointer transition hover:ring-1 hover:ring-primary/40">
          <div className="aspect-square bg-muted relative">
            {img ? (
              <img src={img} alt={card.ref ?? ""} loading="lazy" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">Sem foto</div>
            )}
            {card.lancamento?.verificado && (
              <Badge className="absolute top-2 right-2 bg-emerald-500 text-white">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Lançado
              </Badge>
            )}
            {compact && camColor && (
              <span className="absolute top-2 left-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-background/80">
                <Camera className={"h-3.5 w-3.5 " + camColor} />
              </span>
            )}
          </div>

          {!compact && (
            <div className="p-3 space-y-1 flex-1 text-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-primary">{card.ref ?? "—"}</p>
                <div className="flex items-center gap-1">
                  <RevisaoErroBadge revisao={card.revisao_pendente} etapa="lancamentos" />
                  {camColor && <Camera className={"h-4 w-4 " + camColor} />}
                </div>
              </div>
              <p className="font-semibold text-sm leading-tight line-clamp-2">{card.nome ?? "—"}</p>
              <p className="text-muted-foreground">
                {[card.colecao, card.linha, card.categoria_nome].filter(Boolean).join(" · ") || "—"}
              </p>
              <p className="text-muted-foreground">{[card.mes, card.ano].filter(Boolean).join(" / ") || "—"}</p>
              {card.tecido_nome && <p className="text-muted-foreground">Tecido: {card.tecido_nome}</p>}
              {card.variantes.length > 0 && (
                <div className="pt-1 mt-1 border-t space-y-0.5">
                  {card.variantes.map((v) => (
                    <div key={v.num} className="flex items-center justify-between gap-2">
                      <span className="truncate">{v.label}</span>
                      <span className="tabular-nums text-muted-foreground shrink-0">{v.gradeTotal}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-2 pt-0.5 border-t font-medium">
                    <span>Grade total</span>
                    <span className="tabular-nums">{card.gradeTotal}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </DialogTrigger>

      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Fotos por variante — {card.ref ?? "—"}</DialogTitle>
        </DialogHeader>
        <VerificarRevisao modeloId={card.modelo_id} etapa="lancamentos" revisao={card.revisao_pendente} />
        <div className="space-y-1">
          {card.variantes.length === 0 && <p className="text-sm text-muted-foreground">Sem variantes no Tecido Principal.</p>}
          {card.variantes.map((v) => {
            const on = !!foto[String(v.num)];
            return (
              <div key={v.num} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-muted/50">
                <span className="text-sm truncate">{v.label}</span>
                <Button
                  type="button"
                  size="icon"
                  variant={on ? "default" : "outline"}
                  className={"h-7 w-7 shrink-0 " + (on ? "bg-emerald-500 hover:bg-emerald-600" : "")}
                  disabled={readOnly || saveFoto.isPending || !card.cqId}
                  onClick={() => toggle(v.num)}
                  title={on ? "Fotografada" : "Sem foto"}
                >
                  <Camera className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
