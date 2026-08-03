import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { artigoLabel, unidadeSufixo } from "@/lib/artigo-label";
import { labelVariante, type Artigo, type ItemDraft, type Variante } from "./shared";
import type { Conflito } from "@/lib/colab/merge";

export function TecidoGroup({
  n, artigos, artigoId, onArtigoChange, variantes, items, toggleVariante, setQtd, setPreco, setPrecoAll, setRendimento, varianteMap,
  conflitoLinha, onResolverConflito,
}: {
  n: 1 | 2;
  artigos: Artigo[];
  artigoId: string | null;
  onArtigoChange: (id: string) => void;
  variantes: Variante[];
  items: ItemDraft[];
  toggleVariante: (vid: string, checked: boolean) => void;
  setQtd: (tempId: string, field: "quantidade_pedida" | "quantidade_recebida", v: number | null) => void;
  setPreco: (tempId: string, v: number | null) => void;
  setPrecoAll: (v: number | null) => void;
  setRendimento: (v: number | null) => void;
  varianteMap: Record<string, Variante>;
  // Colab (spec 2026-08-03): realce da linha quando o item foi editado por outra
  // pessoa em paralelo (conflito de merge 3-vias, path `linha:{id}`). Opcional —
  // itens sem `id` (ainda não salvos) nunca entram em conflito.
  conflitoLinha?: (id: string | undefined) => Conflito | undefined;
  onResolverConflito?: (c: Conflito, useDele: boolean) => void;
}) {
  const selectedIds = new Set(items.map((i) => i.variante_tecido_id));
  const artigoAtual = artigos.find((a) => a.id === artigoId) ?? null;
  const sufixo = unidadeSufixo(artigoAtual?.unidade_medida);
  const isKg = artigoAtual?.unidade_medida === "kg";
  // Preço do tecido (referência do cadastro) + "Aplicar a todos" — preenche todas as variantes.
  const [precoTecido, setPrecoTecido] = useState<number | null>(artigoAtual?.preco ?? null);
  useEffect(() => { setPrecoTecido(artigoAtual?.preco ?? null); }, [artigoAtual?.preco]);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold">Tecido {n}</h4>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_30%]">
        <div className="grid gap-1">
          <Label>Tecido</Label>
          <Select value={artigoId ?? ""} onValueChange={onArtigoChange}>
            <SelectTrigger><SelectValue placeholder="Selecionar tecido…" /></SelectTrigger>
            <SelectContent>
              {artigos.map((a) => <SelectItem key={a.id} value={a.id}>{artigoLabel(a)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {artigoId && (
          <div className="grid gap-1">
            {/* Preço do tecido (default = cadastro) + "Aplicar a todos" como link (sem borda). */}
            <div className="flex items-center justify-between">
              <Label>Preço do tecido</Label>
              <Button type="button" variant="link" className="h-auto p-0 text-xs"
                disabled={items.length === 0}
                onClick={() => setPrecoAll(precoTecido)}>
                Aplicar a todos
              </Button>
            </div>
            <div className="relative">
              <NumberInput type="number" step="0.01" placeholder="0,00" className="pl-7"
                value={precoTecido ?? undefined}
                onChange={(e) => setPrecoTecido(e.target.value === "" ? null : Number(e.target.value))} />
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
            </div>
          </div>
        )}
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
                    <span>{labelVariante(v) !== "—" ? labelVariante(v) : v.id.slice(0, 8)}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {isKg && items.length > 0 && (
            <div className="grid gap-1">
              <Label>Rendimento (m/kg)</Label>
              <div className="relative w-32">
                <NumberInput type="number" step="0.01" className="pr-12"
                  placeholder="m/kg"
                  value={items[0]?.rendimento ?? artigoAtual?.rendimento ?? ""}
                  onChange={(e) => setRendimento(e.target.value === "" ? null : Number(e.target.value))} />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  m/kg
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Converte kg em metros para esta OC. Padrão vem do cadastro do tecido.</p>
            </div>
          )}

          {items.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Label className="flex-1">Quantidade e preço</Label>
                <span className="w-32 text-xs text-muted-foreground">Qtd</span>
                <span className="w-28 text-xs text-muted-foreground">Preço (un.)</span>
              </div>
              {items.map((i) => {
                const v = varianteMap[i.variante_tecido_id];
                const conflito = conflitoLinha?.(i.id);
                return (
                  <div key={i.tempId} className={cn("space-y-1 rounded-md", conflito && "ring-1 ring-amber-500 p-1.5")}>
                    <div className="flex items-center gap-3">
                      <span className="text-sm flex-1">
                        {labelVariante(v)}
                      </span>
                      <div className="relative w-32">
                        <NumberInput type="number" step="0.01" placeholder="0" className={sufixo ? "pr-10" : ""}
                          value={i.quantidade_pedida || undefined}
                          onChange={(e) => setQtd(i.tempId, "quantidade_pedida", Number(e.target.value))} />
                        {sufixo && (
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                            {sufixo}
                          </span>
                        )}
                      </div>
                      {/* Fase A: preço desta compra (default = preço atual da variante; editável). */}
                      <div className="relative w-28">
                        <NumberInput type="number" step="0.01" placeholder="0,00" className="pl-7"
                          value={i.preco ?? undefined}
                          onChange={(e) => setPreco(i.tempId, e.target.value === "" ? null : Number(e.target.value))} />
                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
                      </div>
                    </div>
                    {conflito && (
                      <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                        <span>Esta variante foi editada por outra pessoa.</span>
                        <button type="button" className="underline underline-offset-2" onClick={() => onResolverConflito?.(conflito, false)}>manter meu</button>
                        <span aria-hidden>·</span>
                        <button type="button" className="underline underline-offset-2" onClick={() => onResolverConflito?.(conflito, true)}>usar o novo</button>
                      </div>
                    )}
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
