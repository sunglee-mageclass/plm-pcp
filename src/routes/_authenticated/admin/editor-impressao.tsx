import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, Plus, Trash2, Type, ImageIcon, RotateCcw, Printer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenantLogo } from "@/hooks/useTenantLogo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { BlockContent } from "@/components/shared/print-blocks";
import {
  DEFAULT_FICHA_CORTE_HEADER,
  FICHA_CORTE_FIELDS,
  fichaCorteFieldLabel,
  isHeaderLayout,
  type HeaderLayout,
  type PrintBlock,
} from "@/lib/print-template";

export const Route = createFileRoute("/_authenticated/admin/editor-impressao")({
  component: EditorImpressaoPage,
});

const DOC_TYPE = "ficha_corte";
const COLS = 12;
// Largura útil de impressão ≈ A4 (210mm) − margens @page (12mm) − padding .print-area (16px).
// Mantida igual entre editor e impressão para a escala bater.
const CONTENT_W = 672;
const A4_H = Math.round(CONTENT_W * Math.SQRT2); // proporção A4 (~950px) p/ "imitar" a folha
const cellW = CONTENT_W / COLS; // 56
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const uid = () => crypto.randomUUID().slice(0, 8);

function EditorImpressaoPage() {
  const { isTenantAdmin, isSuperAdmin, loading } = useAuth();
  const qc = useQueryClient();
  const logo = useTenantLogo();

  const [layout, setLayout] = useState<HeaderLayout>(DEFAULT_FICHA_CORTE_HEADER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const { data: row } = useQuery({
    queryKey: ["print-template", DOC_TYPE],
    queryFn: async () => {
      const { data } = await supabase
        .from("print_templates" as any)
        .select("id, layout")
        .eq("doc_type", DOC_TYPE)
        .maybeSingle();
      return (data ?? null) as { id: string; layout: any } | null;
    },
  });

  useEffect(() => {
    if (hydrated || row === undefined) return;
    if (row && isHeaderLayout(row.layout)) setLayout(row.layout);
    setHydrated(true);
  }, [row, hydrated]);

  const drag = useRef<{ id: string; mode: "move" | "resize"; sx: number; sy: number; orig: PrintBlock; rowH: number } | null>(null);
  const onMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dxc = Math.round((e.clientX - d.sx) / cellW);
    const dyc = Math.round((e.clientY - d.sy) / d.rowH);
    setLayout((L) => ({
      ...L,
      blocks: L.blocks.map((b) => {
        if (b.id !== d.id) return b;
        if (d.mode === "move") {
          return { ...b, x: clamp(d.orig.x + dxc, 0, L.cols - b.w), y: clamp(d.orig.y + dyc, 0, L.rows - b.h) };
        }
        return { ...b, w: clamp(d.orig.w + dxc, 1, L.cols - b.x), h: clamp(d.orig.h + dyc, 1, L.rows - b.y) };
      }),
    }));
  }, []);
  const onUp = useCallback(() => {
    drag.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }, [onMove]);
  const startDrag = (e: React.PointerEvent, b: PrintBlock, mode: "move" | "resize") => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(b.id);
    drag.current = { id: b.id, mode, sx: e.clientX, sy: e.clientY, orig: { ...b }, rowH: layout.rowH };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const addBlock = (b: Omit<PrintBlock, "id" | "x" | "y" | "w" | "h"> & Partial<Pick<PrintBlock, "w" | "h">>) => {
    const nb: PrintBlock = { id: uid(), x: 0, y: 0, ...b, w: b.w ?? 3, h: b.h ?? 1 };
    setLayout((L) => ({ ...L, blocks: [...L.blocks, nb] }));
    setSelectedId(nb.id);
  };
  const updateBlock = (id: string, patch: Partial<PrintBlock>) =>
    setLayout((L) => ({ ...L, blocks: L.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
  const removeBlock = (id: string) => {
    setLayout((L) => ({ ...L, blocks: L.blocks.filter((b) => b.id !== id) }));
    setSelectedId((s) => (s === id ? null : s));
  };

  const save = useMutation({
    mutationFn: async () => {
      if (row?.id) {
        const { error } = await supabase.from("print_templates" as any).update({ layout, updated_at: new Date().toISOString() }).eq("id", row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("print_templates" as any).insert({ doc_type: DOC_TYPE, layout });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Layout salvo");
      qc.invalidateQueries({ queryKey: ["print-template", DOC_TYPE] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  if (loading) return <div className="p-6 text-muted-foreground">Carregando…</div>;
  if (!isTenantAdmin && !isSuperAdmin) return <Navigate to="/" />;

  const selected = layout.blocks.find((b) => b.id === selectedId) ?? null;

  return (
    <div className="container mx-auto p-6 space-y-4 max-w-6xl">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/admin/configuracoes" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Configurações
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Printer className="h-6 w-6 text-primary" /> Editor de Impressão</h1>
            <p className="text-sm text-muted-foreground">Cabeçalho da Ficha de Corte (PoC). Arraste e redimensione os blocos na grade.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { setLayout(DEFAULT_FICHA_CORTE_HEADER); setSelectedId(null); }}>
            <RotateCcw className="h-4 w-4 mr-1" /> Padrão
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="h-4 w-4 mr-1" /> {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </header>

      {/* Paleta */}
      <Card className="p-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground mr-1">Adicionar:</span>
        <Button size="sm" variant="secondary" onClick={() => addBlock({ type: "logo", w: 3, h: 3 })}>
          <ImageIcon className="h-4 w-4 mr-1" /> Logo
        </Button>
        <Button size="sm" variant="secondary" onClick={() => addBlock({ type: "text", text: "Texto", w: 4, h: 1 })}>
          <Type className="h-4 w-4 mr-1" /> Texto
        </Button>
        <Select value="" onValueChange={(v) => v && addBlock({ type: "field", field: v, w: 3, h: 1 })}>
          <SelectTrigger className="h-9 w-48"><SelectValue placeholder="+ Campo do modelo" /></SelectTrigger>
          <SelectContent>
            {FICHA_CORTE_FIELDS.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5 ml-auto">
          <Label className="text-xs text-muted-foreground">Altura (linhas)</Label>
          <Input
            type="number"
            min={2}
            max={20}
            value={layout.rows}
            onChange={(e) => setLayout((L) => ({ ...L, rows: clamp(Math.floor(Number(e.target.value) || L.rows), 2, 20) }))}
            className="h-8 w-16"
          />
        </div>
      </Card>

      <div className="flex flex-wrap gap-4">
        {/* Canvas — folha A4 (só o cabeçalho é editável) */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Folha A4 em escala — dados de exemplo. Só o cabeçalho (faixa de cima) é editável.</p>
          <div className="bg-muted/40 p-6 rounded-lg w-fit overflow-auto" style={{ maxHeight: "75vh" }}>
            <div className="relative bg-white shadow-md" style={{ width: CONTENT_W, height: A4_H }}>
              {/* Faixa do cabeçalho (editável) */}
              <div
                className="absolute left-0 top-0"
                style={{
                  width: CONTENT_W,
                  height: layout.rows * layout.rowH,
                  backgroundImage:
                    `linear-gradient(to right, #eee 1px, transparent 1px), linear-gradient(to bottom, #f3f3f3 1px, transparent 1px)`,
                  backgroundSize: `${cellW}px ${layout.rowH}px`,
                }}
                onPointerDown={() => setSelectedId(null)}
              >
                {layout.blocks.map((b) => (
                  <div
                    key={b.id}
                    onPointerDown={(e) => startDrag(e, b, "move")}
                    className={cn(
                      "absolute overflow-hidden cursor-move select-none rounded-sm",
                      selectedId === b.id ? "ring-2 ring-primary z-10" : "ring-1 ring-border/60 hover:ring-border",
                    )}
                    style={{
                      left: b.x * cellW,
                      top: b.y * layout.rowH,
                      width: b.w * cellW,
                      height: b.h * layout.rowH,
                    }}
                  >
                    <BlockContent block={b} logo={logo} editor />
                    <span
                      onPointerDown={(e) => startDrag(e, b, "resize")}
                      className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize bg-primary/70"
                      style={{ clipPath: "polygon(100% 0, 0 100%, 100% 100%)" }}
                    />
                  </div>
                ))}
              </div>
              {/* Corpo da ficha (não editável neste PoC) */}
              <div
                className="absolute left-0 flex items-start justify-center text-xs text-muted-foreground"
                style={{ top: layout.rows * layout.rowH, width: CONTENT_W, height: A4_H - layout.rows * layout.rowH, borderTop: "1px dashed #ddd", paddingTop: 12 }}
              >
                Corpo da ficha (Tecido, Grade, Aviamentos…) — layout fixo por enquanto.
              </div>
            </div>
          </div>
        </div>

        {/* Propriedades */}
        <Card className="p-4 w-72 space-y-3 h-fit">
          <p className="text-sm font-semibold">Propriedades</p>
          {!selected ? (
            <p className="text-xs text-muted-foreground">Selecione um bloco para editar.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {selected.type === "logo" ? "Logo" : selected.type === "field" ? `Campo: ${fichaCorteFieldLabel(selected.field ?? "")}` : "Texto"}
                {" · "}{selected.w}×{selected.h}
              </p>
              {selected.type === "text" && (
                <div className="space-y-1">
                  <Label className="text-xs">Texto</Label>
                  <Input value={selected.text ?? ""} onChange={(e) => updateBlock(selected.id, { text: e.target.value })} />
                </div>
              )}
              {selected.type !== "logo" && (
                <>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Negrito</Label>
                    <Switch checked={!!selected.bold} onCheckedChange={(v) => updateBlock(selected.id, { bold: v })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Alinhamento</Label>
                    <Select value={selected.align ?? "left"} onValueChange={(v) => updateBlock(selected.id, { align: v as PrintBlock["align"] })}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="left">Esquerda</SelectItem>
                        <SelectItem value="center">Centro</SelectItem>
                        <SelectItem value="right">Direita</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Tamanho da fonte (px)</Label>
                    <Input
                      type="number"
                      min={8}
                      max={48}
                      value={selected.fontSize ?? 12}
                      onChange={(e) => updateBlock(selected.id, { fontSize: clamp(Math.floor(Number(e.target.value) || 12), 8, 48) })}
                      className="h-8"
                    />
                  </div>
                </>
              )}
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removeBlock(selected.id)}>
                <Trash2 className="h-4 w-4 mr-1" /> Remover bloco
              </Button>
            </>
          )}
          <p className="text-[11px] text-muted-foreground border-t pt-2">
            Dica: arraste o bloco para mover; use o canto inferior direito para redimensionar. Tudo encaixa na grade.
          </p>
        </Card>
      </div>
    </div>
  );
}
