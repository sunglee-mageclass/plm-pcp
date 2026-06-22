import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Pencil, Trash2, Search, Loader2, PackageMinus, ScissorsLineDashed } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { artigoLabel } from "@/lib/artigo-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  // Opções de item (variante de tecido OU aviamento).
  const { data: itemOptions = [] } = useQuery({
    queryKey: [`os-itens-opts-${tipo}`],
    queryFn: async () => {
      if (tipo === "tecido") {
        const { data, error } = await supabase
          .from("variantes_tecido")
          .select("id, nome_variante, codigo_variante, cores(nome), artigos(nome, unidade_medida)");
        if (error) throw error;
        return (data ?? []).map((v: any) => ({
          id: v.id,
          label: `${artigoLabel(v.artigos)} · ${v.nome_variante || v.cores?.nome || v.codigo_variante || "variante"}`,
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

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return ordens;
    return ordens.filter((o) =>
      String(o.numero ?? "").includes(s) ||
      (o.responsavel ?? "").toLowerCase().includes(s) ||
      (o.destino?.nome ?? "").toLowerCase().includes(s),
    );
  }, [ordens, search]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: listKey });
    // o motor de estoque passa a somar a OS — refaz as posições.
    qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
    qc.invalidateQueries({ queryKey: ["estoque-aviamentos"] });
  };

  const openCreate = () => {
    setEditing(null);
    setFResponsavel(""); setFSolicitacao(""); setFCorte(""); setFDestino("none"); setFObs("");
    setFItens([{ _key: newKey(), itemId: "", reserva: "" }]);
    setFormOpen(true);
  };

  const openEdit = (o: OSRow) => {
    setEditing(o);
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

      const headerPayload: any = {
        responsavel: fResponsavel.trim() || null,
        data_solicitacao: fSolicitacao || null,
        data_corte: fCorte || null,
        destino_id: fDestino === "none" ? null : fDestino,
        observacao: fObs.trim() || null,
      };

      let osId: string;
      if (editing) {
        const { error } = await supabase.from(cfg.headerTable as any).update(headerPayload).eq("id", editing.id);
        if (error) throw error;
        osId = editing.id;
        // substitui os itens (OS não é referenciada por mais nada).
        const { error: delErr } = await supabase.from(cfg.itensTable as any).delete().eq("ordem_saida_id", osId);
        if (delErr) throw delErr;
      } else {
        // numero sequencial por loja.
        const { data: last } = await supabase
          .from(cfg.headerTable as any)
          .select("numero")
          .order("numero", { ascending: false })
          .limit(1)
          .maybeSingle();
        headerPayload.numero = (Number((last as any)?.numero) || 0) + 1;
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
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar."),
  });

  const baixaMut = useMutation({
    mutationFn: async () => {
      if (!baixaOS) return;
      // grava o utilizado de cada item como baixa, e marca a OS como baixada.
      for (const it of baixaOS.itens ?? []) {
        const u = num(utilizado[it.id] ?? it.reserva ?? 0);
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
    onError: (e: any) => toast.error(e.message ?? "Erro ao dar baixa."),
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
    onError: (e: any) => toast.error(e.message ?? "Erro ao excluir."),
  });

  const openBaixa = (o: OSRow) => {
    setBaixaOS(o);
    const init: Record<string, string> = {};
    for (const it of o.itens ?? []) init[it.id] = it.reserva != null ? String(it.reserva) : "";
    setUtilizado(init);
  };

  const totReserva = (o: OSRow) => (o.itens ?? []).reduce((s, it) => s + num(it.reserva), 0);
  const totBaixa = (o: OSRow) => (o.itens ?? []).reduce((s, it) => s + num(it.baixa), 0);

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <Link to="/entrada-saida" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <PackageMinus className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">{cfg.title}</h1>
            <p className="text-sm text-muted-foreground">{cfg.desc}</p>
          </div>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Nova OS</Button>
      </header>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar nº, responsável, destino…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Nº</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Solicitação</TableHead>
              <TableHead>Corte</TableHead>
              <TableHead>Destino</TableHead>
              <TableHead className="text-right">Reserva</TableHead>
              <TableHead className="text-right">Baixa</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-40 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Nenhuma OS encontrada.</TableCell></TableRow>
            ) : (
              filtered.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.numero ?? "—"}</TableCell>
                  <TableCell>{o.responsavel ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{fmtDate(o.data_solicitacao)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{fmtDate(o.data_corte)}</TableCell>
                  <TableCell>{o.destino?.nome ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(totReserva(o))}</TableCell>
                  <TableCell className="text-right tabular-nums">{o.baixado ? fmtNum(totBaixa(o)) : "—"}</TableCell>
                  <TableCell>
                    {o.baixado
                      ? <Badge className="bg-emerald-500 hover:bg-emerald-600">Baixado</Badge>
                      : <Badge variant="secondary">Não Baixado</Badge>}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {!o.baixado && (
                      <>
                        <Button size="sm" variant="outline" className="mr-1 h-8" onClick={() => openBaixa(o)}>
                          <ScissorsLineDashed className="h-3.5 w-3.5 mr-1" /> Dar Baixa
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => openEdit(o)} aria-label="Editar">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    <Button size="icon" variant="ghost" onClick={() => setDeleteRow(o)} aria-label="Excluir">
                      <Trash2 className="h-4 w-4 text-destructive" />
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar OS #${editing.numero ?? ""}` : "Nova Ordem de Saída"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Responsável</Label>
                <Input value={fResponsavel} onChange={(e) => setFResponsavel(e.target.value)} placeholder="Nome" />
              </div>
              <div className="space-y-1.5">
                <Label>Destino</Label>
                <Select value={fDestino} onValueChange={setFDestino}>
                  <SelectTrigger><SelectValue placeholder="Sem destino" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem destino</SelectItem>
                    {destinos.map((d) => <SelectItem key={d.id} value={d.id}>{d.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Data da Solicitação</Label>
                <Input type="date" value={fSolicitacao} onChange={(e) => setFSolicitacao(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Data do Corte</Label>
                <Input type="date" value={fCorte} onChange={(e) => setFCorte(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Itens (reserva)</Label>
              {fItens.map((it, idx) => (
                <div key={it._key} className="flex items-center gap-2">
                  <Select value={it.itemId} onValueChange={(v) => setFItens((prev) => prev.map((x, i) => i === idx ? { ...x, itemId: v } : x))}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder={`Selecione ${cfg.itemLabel.toLowerCase()}`} /></SelectTrigger>
                    <SelectContent>
                      {itemOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input
                    className="w-28"
                    inputMode="decimal"
                    placeholder="Reserva"
                    value={it.reserva}
                    onChange={(e) => setFItens((prev) => prev.map((x, i) => i === idx ? { ...x, reserva: e.target.value } : x))}
                  />
                  <Button size="icon" variant="ghost" onClick={() => setFItens((prev) => prev.filter((_, i) => i !== idx))} aria-label="Remover item">
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dar baixa */}
      <Dialog open={!!baixaOS} onOpenChange={(o) => { if (!o) { setBaixaOS(null); setUtilizado({}); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Dar baixa — OS #{baixaOS?.numero ?? ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Confirme o <strong>utilizado</strong> de cada item. Ao baixar, a reserva sai e o estoque físico diminui pelo utilizado.
            </p>
            <div className="rounded-md border divide-y">
              {(baixaOS?.itens ?? []).map((it) => (
                <div key={it.id} className="flex items-center justify-between gap-3 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{itemLabelById.get(it[cfg.itemFk]) ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">Reserva: {fmtNum(num(it.reserva))}</div>
                  </div>
                  <Input
                    className="w-28"
                    inputMode="decimal"
                    placeholder="Utilizado"
                    value={utilizado[it.id] ?? ""}
                    onChange={(e) => setUtilizado((prev) => ({ ...prev, [it.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBaixaOS(null); setUtilizado({}); }}>Cancelar</Button>
            <Button onClick={() => baixaMut.mutate()} disabled={baixaMut.isPending}>
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
