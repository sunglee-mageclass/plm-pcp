import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { artigoLabel, unidadeSufixo } from "@/lib/artigo-label";
import type { Artigo, ItemDraft, Variante } from "./shared";

export function TecidoGroup({
  n, artigos, artigoId, onArtigoChange, variantes, items, toggleVariante, setQtd, varianteMap,
}: {
  n: 1 | 2;
  artigos: Artigo[];
  artigoId: string | null;
  onArtigoChange: (id: string) => void;
  variantes: Variante[];
  items: ItemDraft[];
  toggleVariante: (vid: string, checked: boolean) => void;
  setQtd: (tempId: string, field: "quantidade_pedida" | "quantidade_recebida", v: number) => void;
  varianteMap: Record<string, Variante>;
}) {
  const selectedIds = new Set(items.map((i) => i.variante_tecido_id));
  const artigoAtual = artigos.find((a) => a.id === artigoId) ?? null;
  const sufixo = unidadeSufixo(artigoAtual?.unidade_medida);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold">Tecido {n}</h4>
      </div>
      <div className="grid gap-1">
        <Label>Artigo</Label>
        <Select value={artigoId ?? ""} onValueChange={onArtigoChange}>
          <SelectTrigger><SelectValue placeholder="Selecionar artigo…" /></SelectTrigger>
          <SelectContent>
            {artigos.map((a) => <SelectItem key={a.id} value={a.id}>{artigoLabel(a)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {artigoId && (
        <>
          <div className="grid gap-1">
            <Label>Variantes (até 10)</Label>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-56 overflow-y-auto border rounded-md p-2">
              {variantes.length === 0 && <div className="text-xs text-muted-foreground col-span-full">Sem variantes cadastradas.</div>}
              {variantes.map((v) => {
                const checked = selectedIds.has(v.id);
                return (
                  <label key={v.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={checked} onChange={(e) => toggleVariante(v.id, e.target.checked)} />
                    <span>{v.nome_variante ?? v.codigo_variante ?? v.id.slice(0, 8)}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {items.length > 0 && (
            <div className="space-y-2">
              <Label>Quantidades</Label>
              {items.map((i) => {
                const v = varianteMap[i.variante_tecido_id];
                return (
                  <div key={i.tempId} className="flex items-center gap-3">
                    <span className="text-sm flex-1">
                      {v?.nome_variante ?? v?.codigo_variante ?? "—"}
                    </span>
                    <div className="relative w-32">
                      <Input type="number" step="0.01" className={sufixo ? "pr-10" : ""}
                        value={i.quantidade_pedida}
                        onChange={(e) => setQtd(i.tempId, "quantidade_pedida", Number(e.target.value))} />
                      {sufixo && (
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          {sufixo}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
