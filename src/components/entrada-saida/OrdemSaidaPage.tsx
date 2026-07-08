import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, Loader2, PackageMinus, ScissorsLineDashed, ArrowLeft, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { artigoLabel } from "@/lib/artigo-label";
import { labelVarianteRow } from "@/lib/variante";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/shared/DateField";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { useSort, SortHead } from "@/components/shared/sort";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type Tipo = "tecido" | "aviamento";

const CONFIG = {
  tecido: {
    title: "OS Tecido",
    desc: "Ordens de saída de tecido: reserve e dê baixa no estoque manualmente.",
    headerTable: "ordens_saida_tecido",
    itensTable: "ordens_saida_tecido_itens",
    itemFk: "variante_tecido_id",
    itemLabel: "Variante",
  },
  aviamento: {
    title: "OS Aviamento",
    desc: "Ordens de saída de aviamento: reserve e dê baixa no estoque manualmente.",
    headerTable: "ordens_saida_aviamento",
    itensTable: "ordens_saida_aviamento_itens",
    itemFk: "aviamento_id",
    itemLabel: "Aviamento",
  },
} as const;

const num = (s: any) => {
  const n = Number(String(s ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
const fmtDate = (s: string | null | undefined) => (s ? s.split("-").reverse().join("/") : "—");

type ItemForm = { _key: string; itemId: string; reserva: string };
type OSRow = {
  id: string;
  numero: number | null;
  responsavel: string | null;
  data_solicitacao: string | null;
  data_corte: string | null;
  destino_id: string | null;
  baixado: boolean;
  observacao: string | null;
  destino?: { nome: string } | null;
  itens?: { id: string; reserva: number | null; baixa: number | null; [k: string]: any }[];
};

let keySeq = 0;
const newKey = () => `k${keySeq++}`;

export function OrdemSaidaPage({ tipo }: { tipo: Tipo }) {
  const cfg = CONFIG[tipo];
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [baixaOS, setBaixaOS] = useState<OSRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<OSRow | null>(null);

  // form state (criar/editar)
  const [editing, setEditing] = useState<OSRow | null>(null);
  const [fNumero, setFNumero] = useState("");
  const [fResponsavel, setFResponsavel] = useState("");
  const [fSolicitacao, setFSolicitacao] = useState("");
  const [fCorte, setFCorte] = useState("");
  const [fDestino, setFDestino] = useState("none");
  const [fObs, setFObs] = useState("");
  const [fItens, setFItens] = useState<ItemForm[]>([]);

  // baixa state: utilizado por item id
  const [utilizado, setUtilizado] = useState<Record<string, string>>({});

  const listKey = [`os-${tipo}`];

  const { data: ordens = [], isLoading } = useQuery({
    queryKey: listKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(cfg.headerTable as any)
        .select(`*, destino:destinos_saida(nome), itens:${cfg.itensTable}(*)`)
        .order("numero", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown) as OSRow[];
    },
  });

  const { data: destinos = [] } = useQuery({
    queryKey: ["destinos-saida"],
    queryFn: async () => {
      const { data, error } = await supabase.from("destinos_saida" as any).select("id, nome").order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as { id: string; nome: string }[];
    },
  });

  // Responsável da OS é atrelado aos estilistas (colaboradores tipo estilista).
  const { data: estilistas = [] } = useQuery({
    queryKey: ["colab-estilistas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colaboradores").select("id, nome").eq("tipo", "estilista").order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as { id: string; nome: string }[];
    },
  });

  // Opções de item (variante de tecido OU aviamento).
  const { data: itemOptions = [] } = useQuery({
    queryKey: [`os-itens-opts-${tipo}`],
    queryFn: async () => {
      if (tipo === "tecido") {
        const { data, error } = await supabase
          .from("variantes_tecido")
          .select("id, nome_variante, codigo_variante, cores(nome), apelido:cor_apelido_id(nome), artigos(nome, unidade_medida)");
        if (error) throw error;
        return (data ?? []).map((v: any) => ({
          id: v.id,
          label: `${artigoLabel(v.artigos)} · ${labelVarianteRow(v) !== "—" ? labelVarianteRow(v) : "variante"}`,
        }));
      }
      const { data, error } = await supabase.from("aviamentos").select("id, codigo_nome").order("codigo_nome");
      if (error) throw error;
      return (data ?? []).map((a: any) => ({ id: a.id, label: a.codigo_nome }));
    },
  });

  const itemLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of itemOptions) m.set(o.id, o.label);
    return m;
  }, [itemOptions]);

  // Unidade da quantidade da OS. Tecido: o estoque é CANÔNICO em METROS — mesmo
  // para artigo vendido em kg, reserva/baixa entram em metros (o motor de estoque
  // subtrai do físico em metros). Aviamento: unidades. Mostrar evita o operador
  // digitar kg num campo que é lido como metros.
  const unidadeQtd = tipo === "tecido" ? "m" : "un";

  // Saldo disponível por aviamento para TRAVAR baixa acima do estoque (C1: sem isto
  // dava pra baixar mais do que existe e o físico ficava negativo). Usa a fonte ÚNICA
  // `estoque_aviamento` (mesma do dashboard e da tela de Estoque): `fisico` já é o
  // disponível (recebido − CAD − OS já baixadas; a OS atual ainda não está baixada, então
  // não entra). Só aviamento; tecido usa seu próprio motor. Falha aberta (saldo
  // desconhecido → não bloqueia) p/ nunca travar baixa legítima por erro de query.
  const { data: dispAvi = {} as Record<string, number> } = useQuery({
    queryKey: ["os-avi-saldo", baixaOS?.id],
    enabled: tipo === "aviamento" && !!baixaOS,
    queryFn: async () => {
      const ids = new Set(
        (baixaOS!.itens ?? []).map((it: any) => it[cfg.itemFk]).filter(Boolean) as string[],
      );
      if (ids.size === 0) return {} as Record<string, number>;
      const { data, error } = await supabase.rpc("estoque_aviamento" as any);
      if (error) throw error;
      const disp: Record<string, number> = {};
      for (const r of (data ?? []) as any[]) if (ids.has(r.id)) disp[r.id] = num(r.fisico);
      return disp;
    },
  });

  const saldoDisp = (it: any): number | null => {
    if (tipo !== "aviamento") return null;
    const avId = it[cfg.itemFk];
    return avId in dispAvi ? dispAvi[avId] : null;
  };
  const excedeSaldo = (it: any): boolean => {
    const disp = saldoDisp(it);
    if (disp == null) return false; // saldo desconhecido → não bloqueia
    return num(utilizado[it.id] ?? it.reserva ?? 0) > disp + 1e-9;
  };
  const algumExcede = (baixaOS?.itens ?? []).some(excedeSaldo);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return ordens;
    return ordens.filter((o) =>
      String(o.numero ?? "").includes(s) ||
      (o.responsavel ?? "").toLowerCase().includes(s) ||
      (o.destino?.nome ?? "").toLowerCase().includes(s),
    );
  }, [ordens, search]);

  const totReserva = (o: OSRow) => (o.itens ?? []).reduce((s, it) => s + num(it.reserva), 0);
  const totBaixa = (o: OSRow) => (o.itens ?? []).reduce((s, it) => s + num(it.baixa), 0);

  // Ordenação clicável por valor cru (datas em ISO ordenam como texto; números/totais
  // via accessors; destino via embed). Default = nº desc, espelhando o .order do fetch.
  const s = useSort(filtered, {
    key: "numero",
    dir: "desc",
    accessors: {
      destino: (o) => o.destino?.nome ?? "",
      reserva: (o) => totReserva(o),
      baixa: (o) => totBaixa(o),
    },
  });
  const sortedOrdens = s.sorted;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: listKey });
    // o motor de estoque passa a somar a OS — refaz as posições.
    qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
    qc.invalidateQueries({ queryKey: ["estoque-aviamentos"] });
  };

  const openCreate = () => {
    setEditing(null);
    // sugere o próximo número (editável no formulário).
    const proximo = ordens.reduce((m, o) => Math.max(m, o.numero ?? 0), 0) + 1;
    setFNumero(String(proximo));
    setFResponsavel(""); setFSolicitacao(""); setFCorte(""); setFDestino("none"); setFObs("");
    setFItens([{ _key: newKey(), itemId: "", reserva: "" }]);
    setFormOpen(true);
  };

  const openEdit = (o: OSRow) => {
    setEditing(o);
    setFNumero(o.numero != null ? String(o.numero) : "");
    setFResponsavel(o.responsavel ?? "");
    setFSolicitacao(o.data_solicitacao ?? "");
    setFCorte(o.data_corte ?? "");
    setFDestino(o.destino_id ?? "none");
    setFObs(o.observacao ?? "");
    setFItens(
      (o.itens ?? []).map((it) => ({
        _key: newKey(),
        itemId: it[cfg.itemFk] ?? "",
        reserva: it.reserva != null ? String(it.reserva) : "",
      })),
    );
    setFormOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const itens = fItens.filter((i) => i.itemId);
      if (itens.length === 0) throw new Error(`Adicione ao menos um ${cfg.itemLabel.toLowerCase()}.`);

      // número é editável no formulário; vazio = auto-incrementa na criação.
      const numeroVal = fNumero.trim() ? Math.trunc(Number(fNumero)) : null;
      const headerPayload: any = {
        responsavel: fResponsavel.trim() || null,
        data_solicitacao: fSolicitacao || null,
        data_corte: fCorte || null,
        destino_id: fDestino === "none" ? null : fDestino,
        observacao: fObs.trim() || null,
      };
      if (numeroVal != null && Number.isFinite(numeroVal)) headerPayload.numero = numeroVal;

      let osId: string;
      if (editing) {
        const { error } = await supabase.from(cfg.headerTable as any).update(headerPayload).eq("id", editing.id);
        if (error) throw error;
        osId = editing.id;
        // substitui os itens (OS não é referenciada por mais nada).
        const { error: delErr } = await supabase.from(cfg.itensTable as any).delete().eq("ordem_saida_id", osId);
        if (delErr) throw delErr;
      } else {
        if (headerPayload.numero == null) {
          // numero sequencial por loja (fallback quando deixado em branco).
          const { data: last } = await supabase
            .from(cfg.headerTable as any)
            .select("numero")
            .order("numero", { ascending: false })
            .limit(1)
            .maybeSingle();
          headerPayload.numero = (Number((last as any)?.numero) || 0) + 1;
        }
        const { data: ins, error } = await supabase.from(cfg.headerTable as any).insert(headerPayload).select("id").single();
        if (error) throw error;
        osId = (ins as any).id;
      }

      const itensPayload = itens.map((i) => ({
        ordem_saida_id: osId,
        [cfg.itemFk]: i.itemId,
        reserva: num(i.reserva),
        // preserva baixa existente na edição (caso já tenha sido baixado parcialmente — normalmente 0 aqui).
        baixa: 0,
      }));
      const { error: itErr } = await supabase.from(cfg.itensTable as any).insert(itensPayload);
      if (itErr) throw itErr;
    },
    onSuccess: () => {
      toast.success(editing ? "OS atualizada." : "OS criada.");
      setFormOpen(false);
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e?.code === "23505"
        ? "Já existe uma OS com esse número nesta loja. Escolha outro número."
        : mensagemErro(e, "Erro ao salvar.")),
  });

  const baixaMut = useMutation({
    mutationFn: async () => {
      if (!baixaOS) return;
      // grava o utilizado de cada item como baixa, e marca a OS como baixada.
      for (const it of baixaOS.itens ?? []) {
        const u = num(utilizado[it.id] ?? it.reserva ?? 0);
        // Trava de saldo (aviamento): não deixa baixar acima do disponível (evita estoque negativo).
        const disp = saldoDisp(it);
        if (disp != null && u > disp + 1e-9) {
          throw new Error(`Baixa acima do estoque disponível (${fmtNum(disp)} ${unidadeQtd}). Ajuste o utilizado.`);
        }
        const { error } = await supabase.from(cfg.itensTable as any).update({ baixa: u }).eq("id", it.id);
        if (error) throw error;
      }
      const { error } = await supabase.from(cfg.headerTable as any).update({ baixado: true }).eq("id", baixaOS.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Baixa confirmada. Estoque atualizado.");
      setBaixaOS(null);
      setUtilizado({});
      invalidate();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao dar baixa.")),
  });

  // Desmarcar baixa: reverte (zera baixa dos itens e volta a OS a "não baixada"),
  // o que devolve o estoque físico e reativa a reserva. Simétrico à baixaMut.
  const desmarcarMut = useMutation({
    mutationFn: async (os: OSRow) => {
      const { error: e1 } = await supabase.from(cfg.itensTable as any).update({ baixa: 0 }).eq("ordem_saida_id", os.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from(cfg.headerTable as any).update({ baixado: false }).eq("id", os.id);
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("Baixa desmarcada. Estoque restaurado.");
      setFormOpen(false);
      invalidate();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao desmarcar baixa.")),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(cfg.headerTable as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("OS excluída.");
      setDeleteRow(null);
      invalidate();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });

  const openBaixa = (o: OSRow) => {
    setBaixaOS(o);
    const init: Record<string, string> = {};
    for (const it of o.itens ?? []) init[it.id] = it.reserva != null ? String(it.reserva) : "";
    setUtilizado(init);
  };

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <PackageMinus className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{cfg.title}</h1>
            <p className="text-sm text-muted-foreground">{cfg.desc}</p>
          </div>
        </div>
        <Button className="max-sm:hidden shrink-0" onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Nova OS</Button>
      </header>

      {/* Mobile: ação primária na barra fixa do rodapé. */}
      <MobileActionBar>
        <Button className="ml-auto" onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Nova OS</Button>
      </MobileActionBar>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar nº, responsável, destino…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="rounded-lg border">
        <Table className="card-table">
          <TableHeader>
            <TableRow>
              <SortHead label="Nº" sortKey="numero" sortState={s} className="w-16" />
              <SortHead label="Responsável" sortKey="responsavel" sortState={s} />
              <SortHead label="Solicitação" sortKey="data_solicitacao" sortState={s} />
              <SortHead label="Corte" sortKey="data_corte" sortState={s} />
              <SortHead label="Destino" sortKey="destino" sortState={s} />
              <SortHead label="Reserva" sortKey="reserva" sortState={s} className="text-right" align="right" />
              <SortHead label="Baixa" sortKey="baixa" sortState={s} className="text-right" align="right" />
              <TableHead>Status</TableHead>
              <TableHead className="w-40 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando…</TableCell></TableRow>
            ) : sortedOrdens.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Nenhuma OS encontrada.</TableCell></TableRow>
            ) : (
              sortedOrdens.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.numero ?? "—"}</TableCell>
                  <TableCell data-label="Responsável">{o.responsavel ?? "—"}</TableCell>
                  <TableCell data-label="Solicitação" className="text-sm text-muted-foreground">{fmtDate(o.data_solicitacao)}</TableCell>
                  <TableCell data-label="Corte" className="text-sm text-muted-foreground">{fmtDate(o.data_corte)}</TableCell>
                  <TableCell data-label="Destino">{o.destino?.nome ?? "—"}</TableCell>
                  <TableCell data-label="Reserva" className="text-right tabular-nums">{fmtNum(totReserva(o))}</TableCell>
                  <TableCell data-label="Baixa" className="text-right tabular-nums">{o.baixado ? fmtNum(totBaixa(o)) : "—"}</TableCell>
                  <TableCell data-label="Status">
                    {o.baixado
                      ? <Badge className="bg-emerald-500 hover:bg-emerald-600">Baixado</Badge>
                      : <Badge variant="secondary">Não Baixado</Badge>}
                  </TableCell>
                  <TableCell data-label="Ações" className="text-right whitespace-nowrap">
                    {o.baixado ? (
                      <Button size="icon" variant="outline" onClick={() => desmarcarMut.mutate(o)} disabled={desmarcarMut.isPending} aria-label="Desmarcar baixa" title="Desmarcar baixa">
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button size="icon" variant="outline" onClick={() => openBaixa(o)} aria-label="Dar baixa" title="Dar baixa">
                        <ScissorsLineDashed className="h-4 w-4" />
                      </Button>
                    )}
                    {/* Editar só enquanto NÃO baixada: editar uma OS baixada zerava a
                        baixa mantendo o status "Baixado" e corrompia o estoque. Para
                        alterar, desmarque a baixa primeiro (botão ao lado). */}
                    {!o.baixado && (
                      <Button size="icon" variant="ghost" onClick={() => openEdit(o)} aria-label="Editar">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    <Button size="icon" variant="destructive" onClick={() => setDeleteRow(o)} aria-label="Excluir">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Criar / editar OS */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl max-sm:[&>button]:hidden max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none max-sm:!border-0 max-sm:!grid-rows-[auto_minmax(0,1fr)_auto] max-sm:!overflow-hidden">
          <DialogHeader className="max-sm:shrink-0">
            <DialogTitle>{editing ? `Editar OS #${editing.numero ?? ""}` : "Nova Ordem de Saída"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1 max-sm:min-h-0 max-sm:min-w-0 max-sm:overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Número</Label>
                <Input type="number" inputMode="numeric" value={fNumero} onChange={(e) => setFNumero(e.target.value)} placeholder="Nº" />
              </div>
              <div className="space-y-1.5">
                <Label>Responsável</Label>
                <Select value={fResponsavel || "none"} onValueChange={(v) => setFResponsavel(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Estilista" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {estilistas.map((e) => <SelectItem key={e.id} value={e.nome}>{e.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Data da Solicitação</Label>
                <DateField value={fSolicitacao} onChange={(e) => setFSolicitacao(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Data do Corte</Label>
                <DateField value={fCorte} onChange={(e) => setFCorte(e.target.value)} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Destino</Label>
                <Select value={fDestino} onValueChange={setFDestino}>
                  <SelectTrigger><SelectValue placeholder="Sem destino" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem destino</SelectItem>
                    {destinos.map((d) => <SelectItem key={d.id} value={d.id}>{d.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Itens — reserva ({tipo === "tecido" ? "metros" : "unidades"})</Label>
              {fItens.map((it, idx) => (
                <div key={it._key} className="flex items-center gap-2">
                  <Select value={it.itemId} onValueChange={(v) => setFItens((prev) => prev.map((x, i) => i === idx ? { ...x, itemId: v } : x))}>
                    <SelectTrigger className="flex-1 min-w-0"><SelectValue placeholder={`Selecione ${cfg.itemLabel.toLowerCase()}`} /></SelectTrigger>
                    <SelectContent>
                      {itemOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input
                    className="w-20 shrink-0"
                    inputMode="decimal"
                    placeholder="Reserva"
                    value={it.reserva}
                    onChange={(e) => setFItens((prev) => prev.map((x, i) => i === idx ? { ...x, reserva: e.target.value } : x))}
                  />
                  <span className="w-5 shrink-0 text-xs text-muted-foreground">{unidadeQtd}</span>
                  <Button size="icon" variant="ghost" className="shrink-0" onClick={() => setFItens((prev) => prev.filter((_, i) => i !== idx))} aria-label="Remover item">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setFItens((prev) => [...prev, { _key: newKey(), itemId: "", reserva: "" }])}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar item
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label>Observação</Label>
              <Input value={fObs} onChange={(e) => setFObs(e.target.value)} placeholder="Opcional" />
            </div>
          </div>
          <DialogFooter className="max-sm:shrink-0 max-sm:flex-row max-sm:items-center max-sm:border-t max-sm:bg-background max-sm:-mx-4 max-sm:-mb-4 max-sm:px-4 max-sm:py-3">
            <Button variant="outline" className="max-sm:hidden" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button variant="outline" size="icon" aria-label="Voltar" className="shrink-0 sm:hidden" onClick={() => setFormOpen(false)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button className="max-sm:ml-auto" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dar baixa */}
      <Dialog open={!!baixaOS} onOpenChange={(o) => { if (!o) { setBaixaOS(null); setUtilizado({}); } }}>
        <DialogContent className="max-w-lg max-sm:[&>button]:hidden max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none max-sm:!border-0 max-sm:!grid-rows-[auto_minmax(0,1fr)_auto] max-sm:!overflow-hidden">
          <DialogHeader className="max-sm:shrink-0">
            <DialogTitle>Dar baixa — OS #{baixaOS?.numero ?? ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 max-sm:min-h-0 max-sm:min-w-0 max-sm:overflow-y-auto">
            <p className="text-sm text-muted-foreground">
              Confirme o <strong>utilizado</strong> de cada item. Ao baixar, a reserva sai e o estoque físico diminui pelo utilizado.
            </p>
            <div className="rounded-md border divide-y">
              {(baixaOS?.itens ?? []).map((it) => (
                <div key={it.id} className="flex items-center justify-between gap-3 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{itemLabelById.get(it[cfg.itemFk]) ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      Reserva: {fmtNum(num(it.reserva))} {unidadeQtd}
                      {saldoDisp(it) != null && <> · Disponível: {fmtNum(saldoDisp(it)!)} {unidadeQtd}</>}
                    </div>
                    {excedeSaldo(it) && (
                      <div className="text-xs text-destructive">Acima do disponível.</div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Input
                      className={excedeSaldo(it) ? "w-24 border-destructive" : "w-24"}
                      inputMode="decimal"
                      placeholder="Utilizado"
                      value={utilizado[it.id] ?? ""}
                      onChange={(e) => setUtilizado((prev) => ({ ...prev, [it.id]: e.target.value }))}
                    />
                    <span className="w-5 text-xs text-muted-foreground">{unidadeQtd}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter className="max-sm:shrink-0 max-sm:flex-row max-sm:items-center max-sm:border-t max-sm:bg-background max-sm:-mx-4 max-sm:-mb-4 max-sm:px-4 max-sm:py-3">
            <Button variant="outline" className="max-sm:hidden" onClick={() => { setBaixaOS(null); setUtilizado({}); }}>Cancelar</Button>
            <Button variant="outline" size="icon" aria-label="Voltar" className="shrink-0 sm:hidden" onClick={() => { setBaixaOS(null); setUtilizado({}); }}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button className="max-sm:ml-auto" onClick={() => baixaMut.mutate()} disabled={baixaMut.isPending || algumExcede}>
              {baixaMut.isPending ? "Baixando…" : "Confirmar baixa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir OS?</AlertDialogTitle>
            <AlertDialogDescription>
              Excluir a OS #{deleteRow?.numero ?? ""}? {deleteRow?.baixado && "A baixa já lançada será revertida no estoque."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (deleteRow) delMut.mutate(deleteRow.id); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
