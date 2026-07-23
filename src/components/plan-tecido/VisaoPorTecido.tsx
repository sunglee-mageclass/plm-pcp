import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PtArvore } from "@/lib/plan-tecido/types";
import { necessidadeVariante } from "@/lib/plan-tecido/calc";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { ModeloThumb } from "./ModeloThumb";

export type SlotPath = { si: number; li: number; sli: number };
type VarLinha = { variante_tecido_id: string; label: string; cor_nome: string | null; metros: number };
type ModeloCard = { key: string; path: SlotPath; nome: string; ref: string | null; thumb_path: string | null; gradeTotal: number; variantes: VarLinha[]; totalMetros: number };
type TecidoBloco = { artigo_id: string; artigo_nome: string; unidade_medida: string | null; categoria: string | null; modelos: ModeloCard[]; totalMetros: number };

/**
 * Visão "Por tecido": para cada tecido, mini-cards por modelo com foto, nome, ref, grade total,
 * variantes usadas e metragem por variante. Clicar no card abre a edição rápida (onAbrirCard).
 */
export function VisaoPorTecido({ arvore, onAbrirCard }: { arvore: PtArvore; onAbrirCard?: (p: SlotPath) => void }) {
  // categoria do tecido (por artigo) — reconhecida do cadastro
  const { data: catPorArtigo = {} } = useQuery({
    queryKey: ["plan-tecido-artigo-categoria"],
    queryFn: async () => {
      const arts = ((await supabase.from("artigos").select("id, categoria_tecido_id")).data ?? []) as { id: string; categoria_tecido_id: string | null }[];
      const cats = ((await supabase.from("categorias_tecido").select("id, nome")).data ?? []) as { id: string; nome: string }[];
      const catNome = Object.fromEntries(cats.map((c) => [c.id, c.nome])) as Record<string, string>;
      return Object.fromEntries(arts.map((a) => [a.id, a.categoria_tecido_id ? (catNome[a.categoria_tecido_id] ?? null) : null])) as Record<string, string | null>;
    },
  });

  const blocos = useMemo<TecidoBloco[]>(() => {
    const byArtigo = new Map<string, TecidoBloco>();
    (arvore.subcolecoes ?? []).forEach((sub, si) =>
      (sub.linhas ?? []).forEach((ln, li) =>
        (ln.slots ?? []).forEach((slot, sli) => {
          const gradeTotal = (slot.materiais ?? [])
            .filter((m) => m.tipo === "tecido" && m.numero === 1)
            .flatMap((m) => m.variantes ?? [])
            .reduce((s, v) => s + (Number(v.grade_total) || 0), 0);
          const tec1Total = gradeTotal;
          for (const mat of slot.materiais ?? []) {
            if (!mat.artigo_id) continue;
            let bloco = byArtigo.get(mat.artigo_id);
            if (!bloco) {
              bloco = { artigo_id: mat.artigo_id, artigo_nome: mat.artigo_nome ?? "", unidade_medida: mat.unidade_medida ?? null, categoria: catPorArtigo[mat.artigo_id] ?? null, modelos: [], totalMetros: 0 };
              byArtigo.set(mat.artigo_id, bloco);
            }
            const variantes: VarLinha[] = [];
            for (const v of mat.variantes ?? []) {
              const gradeBase = mat.tipo === "forro" ? tec1Total : v.grade_total;
              const metros = necessidadeVariante(mat.consumo, gradeBase, v.multiplicador);
              if (metros <= 0) continue;
              variantes.push({ variante_tecido_id: v.variante_tecido_id, label: (v as any).label || v.cor_nome || "", cor_nome: v.cor_nome ?? null, metros });
            }
            if (variantes.length === 0) continue;
            const totalMetros = variantes.reduce((s, x) => s + x.metros, 0);
            bloco.modelos.push({
              key: `${si}-${li}-${sli}-${mat.artigo_id}`,
              path: { si, li, sli },
              nome: slot.nome ?? "Modelo sem nome", ref: slot.ref ?? null, thumb_path: slot.thumb_path ?? null,
              gradeTotal, variantes, totalMetros,
            });
            bloco.totalMetros += totalMetros;
          }
        })));
    return [...byArtigo.values()].sort((a, b) => b.totalMetros - a.totalMetros);
  }, [arvore, catPorArtigo]);

  if (blocos.length === 0)
    return <div className="rounded-lg border p-4 text-sm text-muted-foreground">Nenhum tecido configurado.</div>;

  return (
    <div className="space-y-2">
      {blocos.map((t) => (
        <div key={t.artigo_id} className="rounded-lg border">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="flex items-center gap-2 text-sm font-medium">
              {t.artigo_nome}
              {t.unidade_medida === "kg" ? <span className="text-[10px] text-muted-foreground">kg</span> : null}
              {t.categoria && <span className="rounded-full border bg-background px-2 py-0.5 text-[10px] font-normal text-muted-foreground">{t.categoria}</span>}
            </span>
            <span className="text-[10px] text-muted-foreground">{t.modelos.length} modelo(s) · {t.totalMetros.toFixed(0)} m</span>
          </div>
          <div className="grid grid-cols-2 gap-2 p-2 md:grid-cols-3 lg:grid-cols-4">
            {t.modelos.map((m) => (
              <button key={m.key} type="button" onClick={() => onAbrirCard?.(m.path)} title="Clique para editar"
                className="flex gap-2 rounded border p-2 text-left transition-colors hover:border-primary hover:bg-muted/30">
                <ModeloThumb path={m.thumb_path} className="h-10 w-10" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">
                    {m.nome}{m.ref ? <span className="font-normal text-muted-foreground"> · {m.ref}</span> : null}
                  </div>
                  <div className="text-[10px] text-muted-foreground">grade {m.gradeTotal} pç · {m.totalMetros.toFixed(0)} m</div>
                  <div className="mt-1 space-y-0.5">
                    {m.variantes.map((v) => (
                      <div key={v.variante_tecido_id} className="flex items-center justify-between gap-1 text-[10px]">
                        <span className="flex min-w-0 items-center gap-1">
                          <VarianteSwatch nome={v.cor_nome ?? v.label} />
                          <span className="truncate">{v.label || "—"}</span>
                        </span>
                        <b className="shrink-0">{v.metros.toFixed(0)} m</b>
                      </div>
                    ))}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
