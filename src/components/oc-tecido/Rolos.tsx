import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, Pencil, Undo2, Printer } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { fmtNum } from "@/lib/format";
import { PrintArea } from "@/components/shared/PrintArea";
import { useTenantLogo } from "@/hooks/useTenantLogo";
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
type RoloOcItem = { oc_tecido_item_id: string; artigo_id: string | null; artigo_nome: string | null; variante_tecido_id: string | null; variante: string; disponivel_m: number };
type RoloOc = { oc_id: string; numero_pedido: string | null; is_rolo?: boolean; label?: string | null; itens: RoloOcItem[] };

const varName = (v?: VarLite | null) => (v ? v.nome_variante || v.codigo_variante || "—" : "—");
// quantidade armazenada → metros (kg guarda em kg, ler × rendimento)
const toMetros = (qtd: number, unidade: string | null, rend: number | null) =>
  unidade === "kg" ? qtd * (rend || 0) : qtd;

// ───────────────────────── Diálogo: criar rolo ─────────────────────────
export function RoloDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const [modo, setModo] = useState<"avulso" | "oc">("avulso");
  const [codigo, setCodigo] = useState("");
  const [codigoManual, setCodigoManual] = useState(false);
  const [rua, setRua] = useState("");
  const [prateleira, setPrateleira] = useState("");
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
  // Só OCs recebidas com saldo físico (não zeradas, recebido − baixa > 0).
  const { data: ocsRolo = [] } = useQuery({
    queryKey: ["ocs-para-rolo"],
    enabled: modo === "oc",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ocs_para_rolo" as any);
      if (error) throw error;
      return (data ?? []) as RoloOc[];
    },
  });
  const selectedOc = ocsRolo.find((o) => o.oc_id === ocId);
  const ocItems = selectedOc?.itens ?? [];
  const selectedItem = ocItems.find((i) => i.oc_tecido_item_id === ocItemId);

  // Código padrão (editável): R{seq}{Categoria}{AAMMDD}, gerado ao escolher o tecido
  // enquanto o usuário não digitar manualmente — evita duplicatas.
  const artigoEfetivo = modo === "avulso" ? artigoId : (selectedItem?.artigo_id ?? "");
  useEffect(() => {
    if (codigoManual || !artigoEfetivo) return;
    let cancel = false;
    (async () => {
      const { data } = await supabase.rpc("proximo_codigo_rolo" as any, { _artigo_id: artigoEfetivo });
      if (!cancel && data) setCodigo(String(data));
    })();
    return () => { cancel = true; };
  }, [artigoEfetivo, codigoManual]);

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
          _rua: rua, _prateleira: prateleira,
        });
        if (error) throw error;
      } else {
        const item = selectedItem;
        if (!item) throw new Error("Selecione a variante da OC.");
        const m = Number(metragemSep);
        if (!(m > 0)) throw new Error("Informe a metragem a separar.");
        if (m > item.disponivel_m + 1e-6)
          throw new Error(`Só há ${item.disponivel_m.toFixed(2)}m disponíveis nessa OC.`);
        const { error } = await supabase.rpc("criar_rolo" as any, {
          _codigo: codigo, _artigo_id: item.artigo_id,
          _variantes: [{ variante_tecido_id: item.variante_tecido_id, metragem: m }],
          _origem_item_id: ocItemId, _rua: rua, _prateleira: prateleira,
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
              onClick={() => setModo("oc")}>Separar de OC/Rolo</Button>
          </div>

          <div className="space-y-1.5">
            <Label>Código</Label>
            <Input value={codigo} onChange={(e) => { setCodigo(e.target.value); setCodigoManual(true); }} placeholder="Ex.: R0001M260622" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Rua</Label>
              <Input value={rua} onChange={(e) => setRua(e.target.value)} placeholder="Endereço (rua)" />
            </div>
            <div className="space-y-1.5">
              <Label>Prateleira</Label>
              <Input value={prateleira} onChange={(e) => setPrateleira(e.target.value)} placeholder="Endereço (prateleira)" />
            </div>
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
                <Label>Origem (OC ou Rolo, com saldo)</Label>
                <Select value={ocId} onValueChange={(v) => { setOcId(v); setOcItemId(""); }}>
                  <SelectTrigger><SelectValue placeholder="Selecione a OC ou o rolo" /></SelectTrigger>
                  <SelectContent>
                    {ocsRolo.map((o) => (
                      <SelectItem key={o.oc_id} value={o.oc_id}>
                        {o.is_rolo ? "Rolo" : "OC"} {o.label || o.numero_pedido || "(sem número)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {ocsRolo.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhuma OC ou rolo com saldo disponível.</p>
                )}
              </div>
              {ocId && (
                <div className="space-y-1.5">
                  <Label>Tecido / variante (item da OC)</Label>
                  <Select value={ocItemId} onValueChange={setOcItemId}>
                    <SelectTrigger><SelectValue placeholder="Selecione o tecido / variante" /></SelectTrigger>
                    <SelectContent>
                      {ocItems.map((it) => (
                        <SelectItem key={it.oc_tecido_item_id} value={it.oc_tecido_item_id}>
                          {it.artigo_nome ?? "—"} · {it.variante} — {it.disponivel_m.toFixed(2)}m
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {selectedItem && (
                <div className="space-y-1.5">
                  <Label>Metragem a separar (m)</Label>
                  <Input type="number" value={metragemSep} max={selectedItem.disponivel_m}
                    onChange={(e) => setMetragemSep(e.target.value)} placeholder="metros" />
                  <p className="text-xs text-muted-foreground">
                    Disponível: {selectedItem.disponivel_m.toFixed(2)}m. A metragem sai do estoque
                    dessa OC e passa a ser o rolo.
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
  rolo_rua: string | null;
  rolo_prateleira: string | null;
  ocs_tecido_itens: {
    id: string;
    quantidade_recebida: number | null;
    artigos: { nome: string; unidade_medida: string | null; rendimento: number | null; empresas: { nome_fantasia: string | null } | null } | null;
    variantes_tecido: { nome_variante: string | null; codigo_variante: string | null; cor: { nome: string | null } | null } | null;
    estoque_tecido_baixas: { quantidade: number | null }[] | null;
  }[];
};

// ───────── Etiqueta A5 do rolo (código de barras) ─────────
// Gera o barcode num CANVAS → <img> PNG (data URL). Imagem estática imprime de
// forma confiável (o SVG desenhado ao vivo às vezes não saía no print). jsbarcode
// é UMD → import dinâmico (cliente) p/ não quebrar o SSR.
function RoloBarcode({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!value) return;
    let cancelled = false;
    import("jsbarcode").then((m) => {
      const JsBarcode = (m as any).default ?? m;
      try {
        const canvas = document.createElement("canvas");
        // Canvas em ALTA resolução (height 130, width 3) → escala pra baixo no
        // print = NÍTIDO (não pixela). displayValue = código grande sob as barras.
        JsBarcode(canvas, value, { format: "CODE128", displayValue: true, fontSize: 46, fontOptions: "bold", textMargin: 4, height: 130, width: 3, margin: 4 });
        if (!cancelled) setSrc(canvas.toDataURL("image/png"));
      } catch { /* valor inválido p/ barcode — ignora */ }
    });
    return () => { cancelled = true; };
  }, [value]);
  // Só HEIGHT (17mm) + width auto = mantém proporção (não distorce); centralizado.
  return src ? <img src={src} alt={value} style={{ height: "17mm", width: "auto", display: "block", margin: "8px auto 0" }} /> : null;
}

function EtiquetaRolo({ rolo, logo }: { rolo: RoloRow; logo: string | null }) {
  const itens = rolo.ocs_tecido_itens ?? [];
  const tecido = itens[0]?.artigos?.nome ?? "—";
  const variante = itens.map((it) => it.variantes_tecido?.nome_variante || it.variantes_tecido?.codigo_variante).filter(Boolean).join(", ") || "—";
  const cor = Array.from(new Set(itens.map((it) => it.variantes_tecido?.cor?.nome).filter(Boolean))).join(", ") || "—";
  const fornecedor = itens[0]?.artigos?.empresas?.nome_fantasia ?? "—";
  const codigo = rolo.rolo_codigo || "";
  const campo = (label: string, valor: string, big?: boolean) => (
    <div>
      <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</div>
      <div style={{ fontSize: big ? 20 : 15, fontWeight: 700, lineHeight: 1.2 }}>{valor}</div>
    </div>
  );
  return (
    <div className="print-section" style={{ height: "133mm", boxSizing: "border-box", border: "1px solid #000", padding: "10mm", display: "flex", flexDirection: "column", justifyContent: "space-between", breakInside: "avoid", fontFamily: "Helvetica, Arial, sans-serif", color: "#000", position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        {campo("Tecido", tecido, true)}
        {logo && <img src={logo} alt="" style={{ maxHeight: 36, maxWidth: 110, objectFit: "contain" }} />}
      </div>
      <div style={{ display: "flex", gap: 48 }}>
        {campo("Variante", variante)}
        {campo("Cor", cor)}
      </div>
      {campo("Fornecedor", fornecedor)}
      {/* Sem campo "Código" separado: o barcode já mostra o código embaixo das barras (fonte maior). */}
      {codigo && <RoloBarcode value={codigo} />}
      <div style={{ position: "absolute", left: "10mm", bottom: "3mm", fontSize: 7, color: "#bbb" }}>etq · build 0623g</div>
    </div>
  );
}

export function RolosList() {
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState<RoloRow | null>(null);
  const [editing, setEditing] = useState<RoloRow | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const logo = useTenantLogo();

  const { data: rolos = [] } = useQuery({
    queryKey: ["rolos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_tecido")
        .select(
          // relacionamento explícito (!oc_tecido_id) p/ não depender do schema cache.
          "id, rolo_codigo, rolo_origem_item_id, rolo_rua, rolo_prateleira, ocs_tecido_itens!oc_tecido_id(id, quantidade_recebida, artigos(nome, unidade_medida, rendimento, empresas:empresa_id(nome_fantasia)), variantes_tecido(nome_variante, codigo_variante, cor:cor_id(nome)), estoque_tecido_baixas(quantidade))",
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

  const selecionados = rolos.filter((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSel((s) => (s.size === rolos.length ? new Set() : new Set(rolos.map((r) => r.id))));
  // Garante o jsbarcode carregado + os <svg> desenhados ANTES de imprimir (senão o
  // barcode não aparece, pois carrega async).
  const imprimirEtiquetas = async () => {
    try { await import("jsbarcode"); } catch { /* */ }
    await new Promise((r) => setTimeout(r, 300));
    window.print();
  };

  return (
    <div className="space-y-4">
      {rolos.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">{sel.size > 0 ? `${sel.size} rolo(s) selecionado(s)` : "Selecione rolos para imprimir etiquetas"}</span>
          <Button size="sm" variant="outline" disabled={sel.size === 0} onClick={imprimirEtiquetas}>
            <Printer className="h-4 w-4 mr-1" /> Imprimir etiquetas{sel.size > 0 ? ` (${sel.size})` : ""}
          </Button>
        </div>
      )}
      {rolos.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">
          Nenhum rolo. Crie um com <b>+ Rolo</b> (avulso ou separado de uma OC).
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><Checkbox checked={sel.size === rolos.length && rolos.length > 0} onCheckedChange={toggleAll} aria-label="Selecionar todos" /></TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Tecido</TableHead>
                <TableHead>Variantes</TableHead>
                <TableHead className="text-right">Metragem (m)</TableHead>
                <TableHead>Endereço</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rolos.map((r) => {
                const itens = r.ocs_tecido_itens ?? [];
                const tecido = itens[0]?.artigos?.nome ?? "—";
                // Físico = recebido − baixas (separação/ajuste). Baixa já está em metros.
                const total = itens.reduce((s, it) => {
                  const recebidoM = toMetros(it.quantidade_recebida ?? 0, it.artigos?.unidade_medida ?? null, it.artigos?.rendimento ?? null);
                  const baixaM = (it.estoque_tecido_baixas ?? []).reduce((b, x) => b + (x.quantidade ?? 0), 0);
                  return s + Math.max(0, recebidoM - baixaM);
                }, 0);
                const vars = itens
                  .map((it) => it.variantes_tecido?.nome_variante || it.variantes_tecido?.codigo_variante)
                  .filter(Boolean)
                  .join(", ");
                return (
                  <TableRow key={r.id} data-state={sel.has(r.id) ? "selected" : undefined}>
                    <TableCell><Checkbox checked={sel.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label="Selecionar rolo" /></TableCell>
                    <TableCell className="font-medium">{r.rolo_codigo || "—"}</TableCell>
                    <TableCell>{tecido}</TableCell>
                    <TableCell className="text-muted-foreground">{vars || "—"}</TableCell>
                    <TableCell className="text-right">{fmtNum(total)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {[r.rolo_rua, r.rolo_prateleira].filter(Boolean).join(" · ") || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.rolo_origem_item_id ? "Separado de OC" : "Avulso"}
                    </TableCell>
                    <TableCell>
                      <div className="flex">
                        <Button variant="ghost" size="icon" className="h-8 w-8"
                          onClick={() => setEditing(r)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8"
                          onClick={() => setDeleting(r)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {editing && (
        <RoloEditDialog rolo={editing} onClose={() => setEditing(null)} />
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

      {/* Etiquetas A5 (uma por meia folha A4) dos rolos selecionados — só na impressão. */}
      {selecionados.length > 0 && (
        <PrintArea>
          {selecionados.map((r) => <EtiquetaRolo key={r.id} rolo={r} logo={logo} />)}
        </PrintArea>
      )}
    </div>
  );
}

// ───────────────────── Editar rolo (código + endereço) ─────────────────────
function RoloEditDialog({ rolo, onClose }: { rolo: RoloRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [codigo, setCodigo] = useState(rolo.rolo_codigo ?? "");
  const [rua, setRua] = useState(rolo.rolo_rua ?? "");
  const [prateleira, setPrateleira] = useState(rolo.rolo_prateleira ?? "");

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("ocs_tecido")
        .update({
          rolo_codigo: codigo || null,
          numero_pedido: codigo || "ROLO",
          rolo_rua: rua || null,
          rolo_prateleira: prateleira || null,
        })
        .eq("id", rolo.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rolo atualizado");
      qc.invalidateQueries({ queryKey: ["rolos"] });
      qc.invalidateQueries({ queryKey: ["consumo-por-oc"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao atualizar rolo"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Editar rolo</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Código</Label>
            <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ex.: ROLO-001" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Rua</Label>
              <Input value={rua} onChange={(e) => setRua(e.target.value)} placeholder="Endereço (rua)" />
            </div>
            <div className="space-y-1.5">
              <Label>Prateleira</Label>
              <Input value={prateleira} onChange={(e) => setPrateleira(e.target.value)} placeholder="Endereço (prateleira)" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Para mudar tecido/variantes/metragem, exclua e recrie o rolo.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ROLO_INVALIDATE = ["ocs-para-rolo", "ajustes-estoque", "rolos", "ocs_tecido", "estoque-tecidos", "dash-estoque", "consumo-por-oc"];

// ───────────────────── - Metragem (remover de uma OC/Rolo) ─────────────────────
export function RemoverMetragemDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [ocId, setOcId] = useState("");
  const [ocItemId, setOcItemId] = useState("");
  const [metragem, setMetragem] = useState("");
  const [motivo, setMotivo] = useState("");

  const { data: ocsRolo = [] } = useQuery({
    queryKey: ["ocs-para-rolo"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ocs_para_rolo" as any);
      if (error) throw error;
      return (data ?? []) as RoloOc[];
    },
  });
  const selectedOc = ocsRolo.find((o) => o.oc_id === ocId);
  const ocItems = selectedOc?.itens ?? [];
  const selectedItem = ocItems.find((i) => i.oc_tecido_item_id === ocItemId);

  const remover = useMutation({
    mutationFn: async () => {
      if (!selectedItem) throw new Error("Selecione o tecido / variante.");
      const m = Number(metragem);
      if (!(m > 0)) throw new Error("Informe a metragem a remover.");
      if (m > selectedItem.disponivel_m + 1e-6) throw new Error(`Só há ${selectedItem.disponivel_m.toFixed(2)}m disponíveis.`);
      if (!motivo.trim()) throw new Error("Informe o motivo.");
      const { error } = await supabase.rpc("remover_metragem_oc" as any, {
        _oc_tecido_item_id: ocItemId, _metragem: m, _motivo: motivo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Metragem removida");
      ROLO_INVALIDATE.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao remover metragem"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Remover metragem</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Origem (OC ou Rolo, com saldo)</Label>
            <Select value={ocId} onValueChange={(v) => { setOcId(v); setOcItemId(""); }}>
              <SelectTrigger><SelectValue placeholder="Selecione a OC ou o rolo" /></SelectTrigger>
              <SelectContent>
                {ocsRolo.map((o) => (
                  <SelectItem key={o.oc_id} value={o.oc_id}>
                    {o.is_rolo ? "Rolo" : "OC"} {o.label || o.numero_pedido || "(sem número)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {ocsRolo.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma OC ou rolo com saldo disponível.</p>
            )}
          </div>
          {ocId && (
            <div className="space-y-1.5">
              <Label>Tecido / variante</Label>
              <Select value={ocItemId} onValueChange={setOcItemId}>
                <SelectTrigger><SelectValue placeholder="Selecione o tecido / variante" /></SelectTrigger>
                <SelectContent>
                  {ocItems.map((it) => (
                    <SelectItem key={it.oc_tecido_item_id} value={it.oc_tecido_item_id}>
                      {it.artigo_nome ?? "—"} · {it.variante} — {it.disponivel_m.toFixed(2)}m
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {selectedItem && (
            <>
              <div className="space-y-1.5">
                <Label>Metragem a remover (m)</Label>
                <Input type="number" value={metragem} max={selectedItem.disponivel_m}
                  onChange={(e) => setMetragem(e.target.value)} placeholder="metros" />
                <p className="text-xs text-muted-foreground">Disponível: {selectedItem.disponivel_m.toFixed(2)}m.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Motivo</Label>
                <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: contagem errada / conserto" />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => remover.mutate()} disabled={remover.isPending}>Remover</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────── Lista de ajustes (auditoria / desfazer) ─────────────────────
type AjusteRow = {
  id: string; created_at: string; quantidade: number; motivo: string | null;
  origem_label: string; artigo: string; variante: string; por: string;
};

export function AjustesList() {
  const qc = useQueryClient();
  const { data: ajustes = [] } = useQuery({
    queryKey: ["ajustes-estoque"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ajustes_estoque_lista" as any);
      if (error) throw error;
      return (data ?? []) as AjusteRow[];
    },
  });
  const reverter = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("reverter_ajuste_estoque" as any, { _baixa_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ajuste revertido");
      ROLO_INVALIDATE.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao reverter ajuste"),
  });

  if (ajustes.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Ajustes de estoque (remoções)</h3>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Origem</TableHead>
              <TableHead>Tecido</TableHead>
              <TableHead className="text-right">Removido (m)</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead>Por</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ajustes.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.origem_label}</TableCell>
                <TableCell className="text-muted-foreground">{a.artigo} · {a.variante}</TableCell>
                <TableCell className="text-right">{fmtNum(a.quantidade)}</TableCell>
                <TableCell className="text-muted-foreground">{a.motivo || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{a.por}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="Desfazer"
                    onClick={() => reverter.mutate(a.id)}>
                    <Undo2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
