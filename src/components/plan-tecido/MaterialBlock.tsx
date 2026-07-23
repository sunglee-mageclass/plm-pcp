// src/components/plan-tecido/MaterialBlock.tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NumberInput } from "@/components/shared/NumberInput";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { labelVarianteRow } from "@/lib/variante";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { useArtigosTecido } from "@/lib/plan-tecido/useArtigosTecido";
import type { PtMaterial, PtVariante } from "@/lib/plan-tecido/types";

type VarRow = { id: string; nome_variante: string | null; codigo_variante: string | null; cor: { nome: string | null } | null; apelido: { nome: string | null } | null };

export function MaterialBlock({ material, onChange, onRemove, paleta }: { material: PtMaterial; onChange: (m: PtMaterial) => void; onRemove: () => void; paleta?: { artigo_id: string; papel: string }[] }) {
  const [verTodos, setVerTodos] = useState(false);
  const { tecidoArtigos, forroArtigos, categoriaNomeDe } = useArtigosTecido();
  const rotulo = material.tipo === "forro" ? "forro" : "tecido";
  // lista-base pelo PAPEL do bloco: TEC só tecidos (sem forro/entretela); FOR só forros
  const base = material.tipo === "forro" ? forroArtigos : tecidoArtigos;
  const categoriaNome = material.artigo_id ? categoriaNomeDe(material.artigo_id) : null;
  // paleta SOFT (dentro do papel); artigo já escolhido sempre aparece; "ver todos" escapa a paleta
  const paletaDoTipo = (paleta ?? []).filter((p) => p.papel === material.tipo).map((p) => p.artigo_id);
  const temPaleta = paletaDoTipo.length > 0;
  const artigosVisiveis = !temPaleta || verTodos
    ? base
    : base.filter((a) => paletaDoTipo.includes(a.id) || a.id === material.artigo_id);
  const { data: variantesArtigo = [] } = useQuery({
    queryKey: ["plan-tecido-variantes-artigo", material.artigo_id],
    enabled: !!material.artigo_id,
    queryFn: async () => ((await supabase.from("variantes_tecido")
      .select("id, nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
      .eq("artigo_id", material.artigo_id!).order("id")).data ?? []) as unknown as VarRow[],
  });

  const marcada = (vid: string) => material.variantes.some((v) => v.variante_tecido_id === vid);
  const toggle = (vid: string) => {
    let next: PtVariante[];
    if (marcada(vid)) {
      next = material.variantes.filter((v) => v.variante_tecido_id !== vid);
    } else {
      const nova: PtVariante = { variante_tecido_id: vid, ordem: 0, multiplicador: 1, grades: {}, grade_total: 0 };
      next = [...material.variantes, nova];
    }
    // renumerate 1..n to avoid gaps that would violate uq_plan_var (material_id, ordem)
    next = next.map((v, i) => ({ ...v, ordem: i + 1 }));
    onChange({ ...material, variantes: next });
  };
  const setVar = (vid: string, patch: Partial<PtVariante>) =>
    onChange({ ...material, variantes: material.variantes.map((v) => (v.variante_tecido_id === vid ? { ...v, ...patch } : v)) });

  return (
    <div className="mb-2 rounded border">
      <div className="flex items-center gap-2 bg-muted/60 p-2">
        <span className="rounded bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">{material.tipo === "tecido" ? "TEC" : "FOR"} {material.numero}</span>
        <select className="rounded border bg-background px-2 py-1 text-xs" value={material.artigo_id ?? ""} onChange={(e) => onChange({ ...material, artigo_id: e.target.value || null, variantes: [] })}>
          <option value="">Escolher {rotulo}…</option>
          {artigosVisiveis.map((a) => (<option key={a.id} value={a.id}>{a.nome}{a.unidade_medida === "kg" ? " [kg]" : ""}</option>))}
        </select>
        {temPaleta && (
          <button type="button" className="shrink-0 text-[10px] text-muted-foreground underline hover:text-foreground" onClick={() => setVerTodos((v) => !v)}>
            {verTodos ? "só paleta" : "ver todos"}
          </button>
        )}
        {categoriaNome && (
          <span className="shrink-0 rounded-full border bg-background px-2 py-0.5 text-[10px] text-muted-foreground" title="Categoria do tecido (cadastro)">{categoriaNome}</span>
        )}
        <div className="ml-auto flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">consumo</span>
          <NumberInput blankZero placeholder="0" className="h-7 w-16 text-right" value={material.consumo} onChange={(e) => onChange({ ...material, consumo: Number(e.target.value) || 0 })} />
          <span className="text-muted-foreground">m</span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRemove}><X className="h-3 w-3" /></Button>
      </div>
      {material.artigo_id && (
        <div className="p-2">
          <div className="mb-1 text-[10px] text-muted-foreground">Variantes — marque as usadas{material.tipo === "tecido" ? " · prof/cor" : " · × grade"}</div>
          {variantesArtigo.map((v) => {
            const on = marcada(v.id);
            const pv = material.variantes.find((x) => x.variante_tecido_id === v.id);
            return (
              <div key={v.id} className={`flex items-center gap-2 border-t border-dashed py-1 text-xs ${on ? "" : "opacity-50"}`}>
                <Checkbox checked={on} onCheckedChange={() => toggle(v.id)} className="h-4 w-4" />
                <VarianteSwatch nome={v.cor?.nome ?? undefined} />
                <span className="min-w-0 flex-1 truncate">{labelVarianteRow(v)}</span>
                {on && material.tipo === "tecido" && (
                  <NumberInput integer blankZero placeholder="0" className="h-7 w-14 text-right" value={pv?.grade_total ?? 0} onChange={(e) => setVar(v.id, { grade_total: Number(e.target.value) || 0 })} />
                )}
                {on && material.tipo === "forro" && (
                  <NumberInput blankZero placeholder="1" className="h-7 w-14 text-right" value={pv?.multiplicador ?? 1} onChange={(e) => setVar(v.id, { multiplicador: Number(e.target.value) || 0 })} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
