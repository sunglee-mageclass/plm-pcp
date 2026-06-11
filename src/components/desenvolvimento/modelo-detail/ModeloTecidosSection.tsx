import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { artigoLabel } from "@/lib/artigo-label";
import { Field, FieldSelectOpt } from "./shared";
import { TIPOS, TIPO_LABEL, type TecidoBlock } from "./types";

type ArtigoOpt = { id: string; nome: string; unidade_medida?: string | null };

export function ModeloTecidosSection({
  blocks,
  artigos,
  onChangeBlock,
  onChangeVariante,
}: {
  blocks: TecidoBlock[];
  artigos: ArtigoOpt[];
  onChangeBlock: (idx: number, patch: Partial<TecidoBlock>) => void;
  onChangeVariante: (idx: number, vIdx: number, value: string | null) => void;
}) {
  return (
    <div className="space-y-3">
      {TIPOS.map((tipo) => (
        <div key={tipo} className="space-y-2">
          <p className="text-sm font-semibold">{TIPO_LABEL[tipo]}</p>
          {[1, 2, 3].map((numero) => {
            const idx = blocks.findIndex((b) => b.tipo === tipo && b.numero === numero);
            const b = blocks[idx];
            if (!b) return null;
            return (
              <TecidoBlockEditor
                key={`${tipo}-${numero}`}
                block={b}
                artigos={artigos}
                onChangeBlock={(p) => onChangeBlock(idx, p)}
                onChangeVariante={(vi, val) => onChangeVariante(idx, vi, val)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TecidoBlockEditor({ block, artigos, onChangeBlock, onChangeVariante }: {
  block: TecidoBlock;
  artigos: ArtigoOpt[];
  onChangeBlock: (p: Partial<TecidoBlock>) => void;
  onChangeVariante: (vIdx: number, val: string | null) => void;
}) {
  const { data: variantesArtigo = [] } = useQuery({
    queryKey: ["variantes-artigo", block.artigo_id],
    enabled: !!block.artigo_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido")
        .select("id, nome_variante, codigo_variante")
        .eq("artigo_id", block.artigo_id!);
      if (error) throw error;
      return (data ?? []).map((v: any) => ({
        id: v.id, nome: v.nome_variante || v.codigo_variante || v.id,
      }));
    },
  });

  return (
    <Card className="p-3 space-y-2">
      <div className="grid sm:grid-cols-2 gap-2">
        <FieldSelectOpt
          label={`${TIPO_LABEL[block.tipo]} ${block.numero} — Artigo`}
          value={block.artigo_id}
          onChange={(v) => onChangeBlock({ artigo_id: v, variantes: Array(10).fill(null) })}
          options={artigos.map((a) => ({ id: a.id, nome: artigoLabel(a) }))}
        />
        <Field label="Custo Previsto">
          <Input readOnly value={block.custo_previsto.toFixed(2)} />
        </Field>
        <Field label="Consumo">
          <Input type="number" step="0.001" value={block.consumo} onChange={(e) => onChangeBlock({ consumo: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="% Loss">
          <Input type="number" step="0.01" value={block.loss_percent} onChange={(e) => onChangeBlock({ loss_percent: Number(e.target.value) || 0 })} />
        </Field>
      </div>

      {block.artigo_id && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Variantes</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {Array.from({ length: 10 }).map((_, i) => {
              const prevFilled = i === 0 || !!block.variantes[i - 1];
              if (!prevFilled) return null;
              const current = block.variantes[i];
              const usedElsewhere = new Set(
                block.variantes.filter((v, j) => j !== i && !!v) as string[],
              );
              const available = variantesArtigo.filter(
                (v) => v.id === current || !usedElsewhere.has(v.id),
              );
              return (
                <Select
                  key={i}
                  value={current ?? ""}
                  onValueChange={(v) => onChangeVariante(i, v === "__none__" ? null : v)}
                >
                  <SelectTrigger><SelectValue placeholder={`Variante ${i + 1}`} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Remover —</SelectItem>
                    {available.map((v) => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
