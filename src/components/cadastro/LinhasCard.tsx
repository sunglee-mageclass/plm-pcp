import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Check, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/shared/NumberInput";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

/**
 * Cadastro dedicado da LINHA (Cadastro > Atributos > Linha) — fora do AttributeTab genérico
 * (decisão do dono: isolar risco). A Linha tem 3 markups: Mín / Ideal (`markup`) / Máx —
 * multiplicadores (ex.: 2,50×), não %. As faixas alimentam a leitura no Planejamento (Fase A);
 * o cálculo da "M.O. necessária"/semáforo é Fase B. NÃO toca preco.ts.
 *
 * Mantém as proteções do AttributeTab: excluir só via guarda de uso (bloqueia se a Linha está
 * em uso em modelos/colecao_pv_itens/mix_padrao_linhas). Renomear/editar markups inline.
 */

type Linha = { id: string; nome: string; markup: number | null; markup_min: number | null; markup_max: number | null };

const USAGE: { table: string; column: string }[] = [
  { table: "modelos", column: "linha_id" },
  { table: "colecao_pv_itens", column: "linha_id" },
  { table: "mix_padrao_linhas", column: "linha_id" },
];

const fmtMk = (v: number | null): string => (v == null ? "—" : `${String(v).replace(".", ",")}×`);

// mín ≤ ideal ≤ máx quando preenchidos (campos são opcionais/nullable).
function validarFaixas(min: number | null, ideal: number | null, max: number | null): string | null {
  if (min != null && ideal != null && min > ideal) return "O Markup Mínimo não pode ser maior que o Ideal.";
  if (ideal != null && max != null && ideal > max) return "O Markup Ideal não pode ser maior que o Máximo.";
  if (min != null && max != null && min > max) return "O Markup Mínimo não pode ser maior que o Máximo.";
  return null;
}

// Quais campos violam a ordem mín ≤ ideal ≤ máx (p/ realçar em vermelho ao vivo, sem só bloquear
// no salvar). Um campo fica "errado" se está fora de ordem em relação a qualquer outro preenchido.
function tentaNum(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function faixasInvalidas(minS: string, idealS: string, maxS: string): { min: boolean; ideal: boolean; max: boolean } {
  const min = tentaNum(minS), ideal = tentaNum(idealS), max = tentaNum(maxS);
  const minRuim = (min != null && ideal != null && min > ideal) || (min != null && max != null && min > max);
  const idealRuim = (min != null && ideal != null && ideal < min) || (ideal != null && max != null && ideal > max);
  const maxRuim = (max != null && ideal != null && max < ideal) || (min != null && max != null && max < min);
  return { min: minRuim, ideal: idealRuim, max: maxRuim };
}

// "2,5" / "2.5" / "" → number | null (≥0). Lança em negativo.
function parseMk(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error("Valor inválido.");
  if (n < 0) throw new Error("O valor não pode ser negativo.");
  return n;
}

export function LinhasCard({ onChanged }: { onChanged?: () => void }) {
  const qc = useQueryClient();
  const listKey = ["linhas-cadastro"];

  const { data: linhas = [], isLoading } = useQuery({
    queryKey: listKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("linhas")
        .select("id, nome, markup, markup_min, markup_max")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Linha[];
    },
  });

  // ── Criar ──────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoMin, setNovoMin] = useState("");
  const [novoIdeal, setNovoIdeal] = useState("");
  const [novoMax, setNovoMax] = useState("");

  const criarMut = useMutation({
    mutationFn: async () => {
      const nome = novoNome.trim();
      if (!nome) throw new Error("Informe o nome da Linha.");
      const min = parseMk(novoMin), ideal = parseMk(novoIdeal), max = parseMk(novoMax);
      const err = validarFaixas(min, ideal, max);
      if (err) throw new Error(err);
      const { error } = await supabase.from("linhas").insert({ nome, markup: ideal, markup_min: min, markup_max: max });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Linha criada.");
      setCreateOpen(false); setNovoNome(""); setNovoMin(""); setNovoIdeal(""); setNovoMax("");
      qc.invalidateQueries({ queryKey: listKey }); onChanged?.();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao criar.")),
  });

  // ── Edição inline ──────────────────────────────────────
  const [editId, setEditId] = useState<string | null>(null);
  const [edNome, setEdNome] = useState("");
  const [edMin, setEdMin] = useState("");
  const [edIdeal, setEdIdeal] = useState("");
  const [edMax, setEdMax] = useState("");

  const startEdit = (l: Linha) => {
    setEditId(l.id);
    setEdNome(l.nome ?? "");
    setEdMin(l.markup_min != null ? String(l.markup_min) : "");
    setEdIdeal(l.markup != null ? String(l.markup) : "");
    setEdMax(l.markup_max != null ? String(l.markup_max) : "");
  };
  const cancelEdit = () => setEditId(null);

  const salvarMut = useMutation({
    mutationFn: async (id: string) => {
      const nome = edNome.trim();
      if (!nome) throw new Error("Preencha o nome.");
      const min = parseMk(edMin), ideal = parseMk(edIdeal), max = parseMk(edMax);
      const err = validarFaixas(min, ideal, max);
      if (err) throw new Error(err);
      const { error } = await supabase.from("linhas").update({ nome, markup: ideal, markup_min: min, markup_max: max }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Linha atualizada.");
      setEditId(null);
      qc.invalidateQueries({ queryKey: listKey }); onChanged?.();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao atualizar.")),
  });

  // ── Excluir (com guarda de uso) ────────────────────────
  const [delRow, setDelRow] = useState<Linha | null>(null);
  const [delUsage, setDelUsage] = useState<number | null>(null);

  const startDelete = async (l: Linha) => {
    setDelRow(l); setDelUsage(null);
    let total = 0;
    for (const ref of USAGE) {
      const { count, error } = await supabase.from(ref.table as any).select("*", { count: "exact", head: true }).eq(ref.column, l.id);
      total += error ? 1 : (count ?? 0); // erro → trata como "em uso" (não apaga às cegas)
    }
    setDelUsage(total);
  };
  const excluirMut = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from("linhas").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Sem permissão para excluir esta Linha.");
    },
    onSuccess: () => {
      toast.success("Linha excluída.");
      setDelRow(null); setDelUsage(null);
      qc.invalidateQueries({ queryKey: listKey }); onChanged?.();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });

  const rows = useMemo(() => linhas, [linhas]);

  // Realce vermelho AO VIVO da ordem mín ≤ ideal ≤ máx (criação e edição inline).
  const novoInval = faixasInvalidas(novoMin, novoIdeal, novoMax);
  const novoTemErro = novoInval.min || novoInval.ideal || novoInval.max;
  const edInval = faixasInvalidas(edMin, edIdeal, edMax);
  const edTemErro = edInval.min || edInval.ideal || edInval.max;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Markup por faixa (multiplicador ×). O <strong>Ideal</strong> é o markup usado no cálculo de preço; Mín/Máx delimitam a faixa aceitável.
        </p>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">Nova Linha</span></Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova Linha</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid gap-1">
                <Label>Nome</Label>
                <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="ex.: Básica" autoFocus />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <MkField label="Mínimo" value={novoMin} onChange={setNovoMin} invalido={novoInval.min} />
                <MkField label="Ideal" value={novoIdeal} onChange={setNovoIdeal} invalido={novoInval.ideal} />
                <MkField label="Máximo" value={novoMax} onChange={setNovoMax} invalido={novoInval.max} />
              </div>
              {novoTemErro && <p className="text-xs text-destructive">A ordem precisa ser Mínimo ≤ Ideal ≤ Máximo.</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
              <Button onClick={() => criarMut.mutate()} disabled={criarMut.isPending || novoTemErro}>Criar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border max-md:border-0">
        <Table className="card-table">
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="w-28 text-right">Mínimo</TableHead>
              <TableHead className="w-28 text-right">Ideal</TableHead>
              <TableHead className="w-28 text-right">Máximo</TableHead>
              <TableHead className="w-24 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!isLoading && rows.length === 0 && (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Nenhuma Linha cadastrada.</TableCell></TableRow>
            )}
            {rows.map((l) => {
              const editing = editId === l.id;
              return (
                <TableRow key={l.id}>
                  <TableCell>
                    {editing
                      ? <Input value={edNome} onChange={(e) => setEdNome(e.target.value)} className="h-8" />
                      : <span className="text-sm">{l.nome}</span>}
                  </TableCell>
                  <TableCell data-label="Mínimo" className="text-right tabular-nums">
                    {editing ? <NumberInput blankZero placeholder="—" value={edMin} onChange={(e) => setEdMin(e.target.value)} aria-invalid={edInval.min} className={"h-8 text-right max-md:w-24" + (edInval.min ? " border-destructive text-destructive focus-visible:ring-destructive" : "")} /> : fmtMk(l.markup_min)}
                  </TableCell>
                  <TableCell data-label="Ideal" className="text-right tabular-nums">
                    {editing ? <NumberInput blankZero placeholder="—" value={edIdeal} onChange={(e) => setEdIdeal(e.target.value)} aria-invalid={edInval.ideal} className={"h-8 text-right max-md:w-24" + (edInval.ideal ? " border-destructive text-destructive focus-visible:ring-destructive" : "")} /> : fmtMk(l.markup)}
                  </TableCell>
                  <TableCell data-label="Máximo" className="text-right tabular-nums">
                    {editing ? <NumberInput blankZero placeholder="—" value={edMax} onChange={(e) => setEdMax(e.target.value)} aria-invalid={edInval.max} className={"h-8 text-right max-md:w-24" + (edInval.max ? " border-destructive text-destructive focus-visible:ring-destructive" : "")} /> : fmtMk(l.markup_max)}
                  </TableCell>
                  <TableCell data-label="Ações" className="text-right">
                    {editing ? (
                      <div className="flex justify-end gap-1">
                        <Button size="iconSm" variant="ghost" onClick={() => salvarMut.mutate(l.id)} disabled={salvarMut.isPending || edTemErro} title={edTemErro ? "Corrija a ordem Mín ≤ Ideal ≤ Máx" : "Salvar"}><Check className="h-4 w-4" /></Button>
                        <Button size="iconSm" variant="ghost" onClick={cancelEdit} title="Cancelar"><X className="h-4 w-4" /></Button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <Button size="iconSm" variant="ghost" onClick={() => startEdit(l)} title="Editar"><Pencil className="h-4 w-4" /></Button>
                        <Button size="iconSm" variant="ghost" onClick={() => startDelete(l)} title="Excluir"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={delRow != null} onOpenChange={(o) => { if (!o) { setDelRow(null); setDelUsage(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{delRow?.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {delUsage == null
                ? "Verificando uso…"
                : delUsage > 0
                  ? `Esta Linha está em uso em ${delUsage} registro(s) (modelos/coleções). Remova os vínculos antes de excluir.`
                  : "Esta ação não pode ser desfeita."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={delUsage == null || delUsage > 0 || excluirMut.isPending}
              onClick={() => delRow && excluirMut.mutate(delRow.id)}
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

function MkField({ label, value, onChange, invalido }: { label: string; value: string; onChange: (v: string) => void; invalido?: boolean }) {
  return (
    <div className="grid gap-1">
      <Label className={"text-xs" + (invalido ? " text-destructive" : "")}>{label}</Label>
      <div className="relative">
        <NumberInput
          blankZero placeholder="ex.: 2,5" value={value} onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalido}
          className={"pr-6 text-right" + (invalido ? " border-destructive text-destructive focus-visible:ring-destructive" : "")}
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">×</span>
      </div>
    </div>
  );
}
