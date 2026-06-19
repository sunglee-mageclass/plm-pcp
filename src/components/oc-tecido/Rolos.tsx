import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { fmtNum } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ArtigoLite = { id: string; nome: string; unidade_medida: string | null; rendimento: number | null };
type VarLite = { id: string; artigo_id: string; nome_variante: string | null; codigo_variante: string | null };
type OcLite = { id: string; numero_pedido: string | null };
type OcItemLite = { id: string; artigo_id: string | null; variante_tecido_id: string | null };

const varName = (v?: VarLite | null) => (v ? v.nome_variante || v.codigo_variante || "—" : "—");
// quantidade armazenada → metros (kg guarda em kg, ler × rendimento)
const toMetros = (qtd: number, unidade: string | null, rend: number | null) =>
  unidade === "kg" ? qtd * (rend || 0) : qtd;

// ───────────────────────── Diálogo: criar rolo ─────────────────────────
export function RoloDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const [modo, setModo] = useState<"avulso" | "oc">("avulso");
  const [codigo, setCodigo] = useState("");
  // avulso
  const [artigoId, setArtigoId] = useState("");
  const [varMet, setVarMet] = useState<Record<string, string>>({});
  // separar de OC
  const [ocId, setOcId] = useState("");
  const [ocItemId, setOcItemId] = useState("");
  const [metragemSep, setMetragemSep] = useState("");

  const { data: artigos = [] } = useQuery({
    queryKey: ["rolo-artigos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigos").select("id, nome, unidade_medida, rendimento").order("nome");
      if (error) throw error;
      return (data ?? []) as ArtigoLite[];
    },
  });
  const { data: variantes = [] } = useQuery({
    queryKey: ["rolo-variantes", artigoId],
    enabled: !!artigoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido").select("id, artigo_id, nome_variante, codigo_variante")
        .eq("artigo_id", artigoId);
      if (error) throw error;
      return (data ?? []) as VarLite[];
    },
  });
  const { data: ocs = [] } = useQuery({
    queryKey: ["rolo-ocs"],
    enabled: modo === "oc",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_tecido").select("id, numero_pedido")
        .eq("status", "recebido").eq("is_rolo", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OcLite[];
    },
  });
  const { data: ocItems = [] } = useQuery({
    queryKey: ["rolo-oc-items", ocId],
    enabled: modo === "oc" && !!ocId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_tecido_itens").select("id, artigo_id, variante_tecido_id")
        .eq("oc_tecido_id", ocId);
      if (error) throw error;
      return ((data ?? []) as OcItemLite[]).filter((i) => i.variante_tecido_id);
    },
  });
  const ocVarIds = useMemo(
    () => ocItems.map((i) => i.variante_tecido_id).filter(Boolean) as string[],
    [ocItems],
  );
  const { data: ocVars = [] } = useQuery({
    queryKey: ["rolo-oc-vars", ocVarIds],
    enabled: ocVarIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido").select("id, artigo_id, nome_variante, codigo_variante")
        .in("id", ocVarIds);
      if (error) throw error;
      return (data ?? []) as VarLite[];
    },
  });
  const ocVarMap = useMemo(() => Object.fromEntries(ocVars.map((v) => [v.id, v])), [ocVars]);

  const criar = useMutation({
    mutationFn: async () => {
      if (!codigo.trim()) throw new Error("Informe o Código do rolo.");
      if (modo === "avulso") {
        if (!artigoId) throw new Error("Selecione o tecido.");
        const payload = Object.entries(varMet)
          .map(([v, m]) => ({ variante_tecido_id: v, metragem: Number(m) }))
          .filter((x) => x.metragem > 0);
        if (payload.length === 0) throw new Error("Informe a metragem de ao menos uma variante.");
        const { error } = await supabase.rpc("criar_rolo" as any, {
          _codigo: codigo, _artigo_id: artigoId, _variantes: payload, _origem_item_id: null,
        });
        if (error) throw error;
      } else {
        const item = ocItems.find((i) => i.id === ocItemId);
        if (!item) throw new Error("Selecione a variante da OC.");
        const m = Number(metragemSep);
        if (!(m > 0)) throw new Error("Informe a metragem a separar.");
        const { error } = await supabase.rpc("criar_rolo" as any, {
          _codigo: codigo, _artigo_id: item.artigo_id,
          _variantes: [{ variante_tecido_id: item.variante_tecido_id, metragem: m }],
          _origem_item_id: ocItemId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Rolo criado");
      qc.invalidateQueries({ queryKey: ["rolos"] });
      qc.invalidateQueries({ queryKey: ["ocs_tecido"] });
      qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
      qc.invalidateQueries({ queryKey: ["dash-estoque"] });
      qc.invalidateQueries({ queryKey: ["consumo-por-oc"] });
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao criar rolo"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Novo Rolo</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={modo === "avulso" ? "default" : "outline"}
              onClick={() => setModo("avulso")}>Avulso</Button>
            <Button type="button" size="sm" variant={modo === "oc" ? "default" : "outline"}
              onClick={() => setModo("oc")}>Separar de uma OC</Button>
          </div>

          <div className="space-y-1.5">
            <Label>Código</Label>
            <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ex.: ROLO-001" />
          </div>

          {modo === "avulso" ? (
            <>
              <div className="space-y-1.5">
                <Label>Tecido</Label>
                <Select value={artigoId} onValueChange={(v) => { setArtigoId(v); setVarMet({}); }}>
                  <SelectTrigger><SelectValue placeholder="Selecione o tecido" /></SelectTrigger>
                  <SelectContent>
                    {artigos.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.nome}{a.unidade_medida === "kg" ? " [kg]" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {artigoId && (
                <div className="space-y-1.5">
                  <Label>Variantes e metragem (m)</Label>
                  <div className="space-y-2 max-h-60 overflow-auto pr-1">
                    {variantes.map((v) => {
                      const checked = v.id in varMet;
                      return (
                        <div key={v.id} className="flex items-center gap-2">
                          <Checkbox checked={checked} onCheckedChange={(c) =>
                            setVarMet((prev) => {
                              const next = { ...prev };
                              if (c) next[v.id] = ""; else delete next[v.id];
                              return next;
                            })} />
                          <span className="flex-1 text-sm">{varName(v)}</span>
                          <Input type="number" className="w-28" disabled={!checked}
                            value={checked ? varMet[v.id] : ""}
                            onChange={(e) => setVarMet((prev) => ({ ...prev, [v.id]: e.target.value }))}
                            placeholder="metros" />
                        </div>
                      );
                    })}
                    {variantes.length === 0 && (
                      <p className="text-sm text-muted-foreground">Tecido sem variantes.</p>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>OC de origem (recebida)</Label>
                <Select value={ocId} onValueChange={(v) => { setOcId(v); setOcItemId(""); }}>
                  <SelectTrigger><SelectValue placeholder="Selecione a OC" /></SelectTrigger>
                  <SelectContent>
                    {ocs.map((o) => (
                      <SelectItem key={o.id} value={o.id}>{o.numero_pedido || "(sem número)"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {ocId && (
                <div className="space-y-1.5">
                  <Label>Variante (item da OC)</Label>
                  <Select value={ocItemId} onValueChange={setOcItemId}>
                    <SelectTrigger><SelectValue placeholder="Selecione a variante" /></SelectTrigger>
                    <SelectContent>
                      {ocItems.map((it) => (
                        <SelectItem key={it.id} value={it.id}>
                          {varName(ocVarMap[it.variante_tecido_id || ""])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {ocItemId && (
                <div className="space-y-1.5">
                  <Label>Metragem a separar (m)</Label>
                  <Input type="number" value={metragemSep}
                    onChange={(e) => setMetragemSep(e.target.value)} placeholder="metros" />
                  <p className="text-xs text-muted-foreground">
                    A metragem sai do estoque dessa OC e passa a ser o rolo.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => criar.mutate()} disabled={criar.isPending}>Criar rolo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Lista de rolos ─────────────────────────
type RoloRow = {
  id: string;
  rolo_codigo: string | null;
  rolo_origem_item_id: string | null;
  ocs_tecido_itens: {
    id: string;
    quantidade_recebida: number | null;
    artigos: { nome: string; unidade_medida: string | null; rendimento: number | null } | null;
    variantes_tecido: { nome_variante: string | null; codigo_variante: string | null } | null;
  }[];
};

export function RolosList() {
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState<RoloRow | null>(null);

  const { data: rolos = [] } = useQuery({
    queryKey: ["rolos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_tecido")
        .select(
          "id, rolo_codigo, rolo_origem_item_id, ocs_tecido_itens(id, quantidade_recebida, artigos(nome, unidade_medida, rendimento), variantes_tecido(nome_variante, codigo_variante))",
        )
        .eq("is_rolo", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as RoloRow[];
    },
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ocs_tecido").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rolo excluído");
      qc.invalidateQueries({ queryKey: ["rolos"] });
      qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
      qc.invalidateQueries({ queryKey: ["dash-estoque"] });
      qc.invalidateQueries({ queryKey: ["consumo-por-oc"] });
      setDeleting(null);
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao excluir rolo"),
  });

  return (
    <div className="space-y-4">
      {rolos.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">
          Nenhum rolo. Crie um com <b>+ Rolo</b> (avulso ou separado de uma OC).
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Tecido</TableHead>
                <TableHead>Variantes</TableHead>
                <TableHead className="text-right">Metragem (m)</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rolos.map((r) => {
                const itens = r.ocs_tecido_itens ?? [];
                const tecido = itens[0]?.artigos?.nome ?? "—";
                const total = itens.reduce(
                  (s, it) => s + toMetros(it.quantidade_recebida ?? 0, it.artigos?.unidade_medida ?? null, it.artigos?.rendimento ?? null),
                  0,
                );
                const vars = itens
                  .map((it) => it.variantes_tecido?.nome_variante || it.variantes_tecido?.codigo_variante)
                  .filter(Boolean)
                  .join(", ");
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.rolo_codigo || "—"}</TableCell>
                    <TableCell>{tecido}</TableCell>
                    <TableCell className="text-muted-foreground">{vars || "—"}</TableCell>
                    <TableCell className="text-right">{fmtNum(total)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.rolo_origem_item_id ? "Separado de OC" : "Avulso"}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-8 w-8"
                        onClick={() => setDeleting(r)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir rolo?</AlertDialogTitle>
            <AlertDialogDescription>
              O rolo "{deleting?.rolo_codigo || "sem código"}" será removido. Se foi separado de
              uma OC, a metragem volta para o estoque dessa OC.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && excluir.mutate(deleting.id)}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
