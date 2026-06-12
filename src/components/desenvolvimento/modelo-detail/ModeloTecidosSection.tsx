import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { artigoLabel } from "@/lib/artigo-label";
import { Plus, Trash2 } from "lucide-react";
import { Field, FieldSelectOpt } from "./shared";
import { TIPOS, TIPO_LABEL, type TecidoBlock } from "./types";
import { EtiquetaLavagemArtigoView } from "@/components/shared/EtiquetaLavagemArtigo";

type ArtigoOpt = { id: string; nome: string; unidade_medida?: string | null };

export function ModeloTecidosSection({
  blocks,
  artigos,
  onChangeBlock,
  onChangeVariante,
  onChangeOcLink,
}: {
  blocks: TecidoBlock[];
  artigos: ArtigoOpt[];
  onChangeBlock: (idx: number, patch: Partial<TecidoBlock>) => void;
  onChangeVariante: (idx: number, vIdx: number, value: string | null) => void;
  onChangeOcLink: (idx: number, vIdx: number, value: string | null) => void;
}) {
  const [visible, setVisible] = useState<Set<string>>(new Set());

  useEffect(() => {
    setVisible((prev) => {
      const next = new Set(prev);
      next.add("tecido-1");
      blocks.forEach((b) => {
        if (b.artigo_id) {
          next.add(`${b.tipo}-${b.numero}`);
        }
      });
      return next;
    });
  }, [blocks]);

  const showBlock = (tipo: TecidoBlock["tipo"], numero: number) => {
    setVisible((prev) => new Set(prev).add(`${tipo}-${numero}`));
  };

  const hideBlock = (idx: number, tipo: TecidoBlock["tipo"], numero: number) => {
    onChangeBlock(idx, {
      artigo_id: null,
      consumo: 0,
      loss_percent: 0,
      variantes: Array(10).fill(null),
    });
    setVisible((prev) => {
      const next = new Set(prev);
      next.delete(`${tipo}-${numero}`);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {TIPOS.map((tipo) => {
        const blocksOfType = blocks.filter((b) => b.tipo === tipo);
        const visibleOfType = blocksOfType.filter((b) => visible.has(`${tipo}-${b.numero}`));
        const canAdd = visibleOfType.length < 3;

        return (
          <div key={tipo} className="space-y-2">
            <p className="text-sm font-semibold">{TIPO_LABEL[tipo]}</p>
            <div className="space-y-2">
              {blocksOfType.map((b) => {
                if (!visible.has(`${tipo}-${b.numero}`)) return null;
                const idx = blocks.findIndex((bb) => bb.tipo === tipo && bb.numero === b.numero);
                if (idx < 0) return null;
                return (
                  <TecidoBlockEditor
                    key={`${tipo}-${b.numero}`}
                    block={b}
                    artigos={artigos}
                    onChangeBlock={(p) => onChangeBlock(idx, p)}
                    onChangeVariante={(vi, val) => onChangeVariante(idx, vi, val)}
                    onRemove={() => hideBlock(idx, tipo, b.numero)}
                    removable={!(tipo === "tecido" && b.numero === 1)}
                  />
                );
              })}
            </div>
            {canAdd && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => {
                  const nextNum = blocksOfType.find((b) => !visible.has(`${tipo}-${b.numero}`))?.numero;
                  if (nextNum) showBlock(tipo, nextNum);
                }}
              >
                <Plus className="h-4 w-4 mr-1" />
                Adicionar {TIPO_LABEL[tipo]}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TecidoBlockEditor({
  block,
  artigos,
  onChangeBlock,
  onChangeVariante,
  onRemove,
  removable,
}: {
  block: TecidoBlock;
  artigos: ArtigoOpt[];
  onChangeBlock: (p: Partial<TecidoBlock>) => void;
  onChangeVariante: (vIdx: number, val: string | null) => void;
  onRemove: () => void;
  removable: boolean;
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
    <Card className="p-3 space-y-2 relative">
      {removable && (
        <div className="absolute top-2 right-2">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-2">
        <FieldSelectOpt
          label={`${TIPO_LABEL[block.tipo]} ${block.numero}`}
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
        <EtiquetaLavagemArtigoView artigoId={block.artigo_id} size="sm" />
      )}

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
