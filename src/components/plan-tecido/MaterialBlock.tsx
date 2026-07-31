// src/components/plan-tecido/MaterialBlock.tsx
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NumberInput } from "@/components/shared/NumberInput";
import { Button } from "@/components/ui/button";
import { X, Plus, AlertTriangle } from "lucide-react";
import { corApelidoLabel } from "@/lib/variante";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { useArtigosTecido } from "@/lib/plan-tecido/useArtigosTecido";
import { useCoresCombos } from "@/lib/plan-tecido/useCoresCombos";
import { varKey, fmtMetros } from "@/lib/plan-tecido/calc";
import type { PtMaterial, PtVariante } from "@/lib/plan-tecido/types";

type VarRow = { id: string; nome_variante: string | null; codigo_variante: string | null; cor_id: string | null; cor_apelido_id: string | null; cor: { nome: string | null } | null; apelido: { nome: string | null } | null };

const comboKey = (cid?: string | null, aid?: string | null) => `${cid ?? ""}|${aid ?? ""}`;

export function MaterialBlock({ material, onChange, onRemove, laneCategoriaId }: { material: PtMaterial; onChange: (m: PtMaterial) => void; onRemove: () => void; laneCategoriaId?: string | null; paleta?: { artigo_id: string; papel: string }[] }) {
  const { tecidoArtigos, forroArtigos, categoriaNomeDe, fornecedorDe, artigoTemCategoria } = useArtigosTecido();
  const { data: coresCombos = [] } = useCoresCombos();
  const rotulo = material.tipo === "forro" ? "forro" : "tecido";
  // lista-base pelo PAPEL do bloco: TEC só tecidos; FOR só forros. TECIDO é FILTRADO pela categoria
  // da lane (ex.: lane Chiffon → só tecidos Chiffon); o artigo já escolhido continua visível. Forro
  // tem categoria própria ("Forro") e nunca casa a categoria-de-tecido da lane → não filtra.
  const base = material.tipo === "forro" ? forroArtigos : tecidoArtigos;
  const artigosVisiveis = laneCategoriaId && material.tipo !== "forro"
    ? base.filter((a) => artigoTemCategoria(a.id, laneCategoriaId) || a.id === material.artigo_id)
    : base;
  const categoriaNome = material.artigo_id ? categoriaNomeDe(material.artigo_id) : null;

  const { data: variantesArtigo = [] } = useQuery({
    queryKey: ["plan-tecido-variantes-artigo", material.artigo_id],
    enabled: !!material.artigo_id,
    queryFn: async () => ((await supabase.from("variantes_tecido")
      .select("id, nome_variante, codigo_variante, cor_id, cor_apelido_id, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
      .eq("artigo_id", material.artigo_id!).order("id")).data ?? []) as unknown as VarRow[],
  });
  const realById = new Map(variantesArtigo.map((v) => [v.id, v]));
  const realByCombo = new Map<string, VarRow>();   // EXATO: cor base + apelido
  const realByCorId = new Map<string, VarRow>();    // por cor base (id)
  for (const v of variantesArtigo) {
    realByCombo.set(comboKey(v.cor_id, v.cor_apelido_id), v);
    if (v.cor_id && !realByCorId.has(v.cor_id)) realByCorId.set(v.cor_id, v);
  }
  // Variante REAL do artigo que corresponde a esta cor do plano:
  // - variante real (variante_tecido_id): só casa se for variante DESTE artigo (NÃO remapeia por cor
  //   entre artigos — isso DUPLICAVA cores e sujava o card ao abrir; a separação por artigo agora é
  //   feita no seed). Cross-artigo → undefined → aparece como divergente (honesto).
  // - cor PLANEJADA (sem variante): sobe pra real por cor base+apelido (exato) ou cor base (id).
  const casaReal = (v: PtVariante): VarRow | undefined => {
    if (v.variante_tecido_id) return realById.get(v.variante_tecido_id);
    if (v.cor_id) return realByCombo.get(comboKey(v.cor_id, v.cor_apelido_id)) ?? realByCorId.get(v.cor_id);
    return undefined;
  };

  // ao escolher o tecido, cada cor do plano que casa (por cor base) vira a variante REAL do artigo
  useEffect(() => {
    if (!material.artigo_id || variantesArtigo.length === 0) return;
    let changed = false;
    const next = material.variantes.map((v) => {
      const real = casaReal(v);
      if (real && real.id !== v.variante_tecido_id) {
        changed = true;
        return { ...v, variante_tecido_id: real.id, cor_id: real.cor_id, cor_apelido_id: real.cor_apelido_id, label: corApelidoLabel(real.cor?.nome, real.apelido?.nome), cor_nome: real.cor?.nome ?? v.cor_nome };
      }
      return v;
    });
    if (changed) onChange({ ...material, variantes: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantesArtigo, material.artigo_id, material.variantes.length]);

  // divergência: cor cuja COR BASE não existe em NENHUMA variante do tecido (só com artigo escolhido
  // E variantes já carregadas — senão marcaria tudo durante o load e "remover divergentes" apagaria).
  const divergente = (v: PtVariante) => !!material.artigo_id && variantesArtigo.length > 0 && !casaReal(v);
  const temDivergentes = material.variantes.some(divergente);

  const renum = (vs: PtVariante[]) => vs.map((v, i) => ({ ...v, ordem: i + 1 }));
  const removerVariante = (v: PtVariante) => onChange({ ...material, variantes: renum(material.variantes.filter((x) => varKey(x) !== varKey(v))) });
  const removerDivergentes = () => onChange({ ...material, variantes: renum(material.variantes.filter((v) => !divergente(v))) });
  const setGrade = (v: PtVariante, val: number) =>
    onChange({ ...material, variantes: material.variantes.map((x) => (varKey(x) === varKey(v) ? { ...x, grade_total: val } : x)) });

  // nome completo "cor base - apelido": da variante real do artigo quando existir (o seed do Dev
  // só traz a cor base), senão do label salvo / cor_nome.
  const nomeVariante = (v: PtVariante): string => {
    if (v.variante_tecido_id) {
      const r = realById.get(v.variante_tecido_id);
      if (r) return corApelidoLabel(r.cor?.nome, r.apelido?.nome) || v.cor_nome || "—";
    }
    return v.label || v.cor_nome || "—";
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const usados = new Set(material.variantes.map((v) => varKey(v)));
  const usadosCombo = new Set(material.variantes.map((v) => comboKey(v.cor_id, v.cor_apelido_id)).filter((k) => k !== "|"));
  // opções: com artigo → variantes do tecido ainda não usadas; sem artigo → todas as combinações
  const opcoesArtigo = variantesArtigo.filter((v) => !usados.has(v.id) && !usadosCombo.has(comboKey(v.cor_id, v.cor_apelido_id)));
  const opcoesCombo = coresCombos.filter((c) => !usadosCombo.has(comboKey(c.cor_id, c.cor_apelido_id)));

  const addDoArtigo = (v: VarRow) => {
    const nova: PtVariante = {
      variante_tecido_id: v.id, cor_id: v.cor_id ?? null, cor_apelido_id: v.cor_apelido_id ?? null,
      ordem: 0, multiplicador: 1, grades: {}, grade_total: 0,
      label: corApelidoLabel(v.cor?.nome, v.apelido?.nome), cor_nome: v.cor?.nome ?? null,
    };
    onChange({ ...material, variantes: renum([...material.variantes, nova]) });
    setMenuOpen(false);
  };
  const addPlanejada = (c: { cor_id: string; cor_nome: string; cor_apelido_id: string; apelido_nome: string }) => {
    const nova: PtVariante = {
      variante_tecido_id: null, cor_id: c.cor_id, cor_apelido_id: c.cor_apelido_id,
      ordem: 0, multiplicador: 1, grades: {}, grade_total: 0,
      label: `${c.cor_nome} - ${c.apelido_nome}`, cor_nome: c.cor_nome,
    };
    onChange({ ...material, variantes: renum([...material.variantes, nova]) });
    setMenuOpen(false);
  };

  const escolherArtigo = (id: string) => {
    const a = base.find((x) => x.id === id) ?? null;
    // NÃO limpa as cores: as planejadas que casarem viram variante (auto-upgrade); as que não, viram divergentes
    onChange({
      ...material, artigo_id: id || null,
      artigo_nome: a?.nome ?? null, unidade_medida: a?.unidade_medida ?? null,
      rendimento: a?.rendimento ?? null, preco_por_metro: a?.preco_por_metro ?? null,
    });
  };

  return (
    <div className="mb-2 rounded border">
      <div className="bg-muted/60 p-2">
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">{material.tipo === "tecido" ? "TEC" : "FOR"} {material.numero}</span>
          <select className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs max-md:h-11 max-md:text-base" value={material.artigo_id ?? ""} onChange={(e) => escolherArtigo(e.target.value)}>
            <option value="">{`Escolher ${rotulo}…`}</option>
            {artigosVisiveis.map((a) => { const f = fornecedorDe(a.id); return (<option key={a.id} value={a.id}>{a.nome}{f ? ` · ${f}` : ""}{a.unidade_medida === "kg" ? " [kg]" : ""}</option>); })}
          </select>
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onRemove}><X className="h-3 w-3" /></Button>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          {categoriaNome && (
            <span className="shrink-0 rounded-full border bg-background px-2 py-0.5 text-[10px] text-muted-foreground" title="Categoria do tecido (cadastro)">{categoriaNome}</span>
          )}
          <div className="ml-auto flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">consumo</span>
            <NumberInput blankZero placeholder="0" className="h-7 w-16 text-right max-md:h-11 max-md:text-base" value={material.consumo} onChange={(e) => onChange({ ...material, consumo: Number(e.target.value) || 0 })} />
            <span className="text-muted-foreground">m/pç</span>
          </div>
        </div>
        {/* consumo 0 zera reserva/comprometido/a comprar em silêncio (auditoria jul/2026:
            um card foi à explosão contando 0) — aviso honesto no lugar do silêncio. */}
        {(Number(material.consumo) || 0) <= 0 && material.artigo_id && (
          <p className="mt-1 text-[10px] font-medium text-amber-700">consumo não preenchido — este {material.tipo === "forro" ? "forro" : "tecido"} conta 0 m nas contas</p>
        )}
      </div>

      <div className="p-2">
        {/* cores selecionadas (variantes) */}
        {material.variantes.length === 0 ? (
          <div className="rounded border border-dashed p-2 text-center text-[10px] italic text-muted-foreground">Nenhuma cor. “+ adicionar cor” para escolher as variantes.</div>
        ) : (
          material.variantes.map((v) => {
            const div = divergente(v);
            const planejada = !v.variante_tecido_id;
            return (
              <div key={varKey(v)} className={`flex items-center gap-2 border-t border-dashed py-1 text-xs first:border-t-0 ${div ? "rounded bg-red-50" : ""}`}>
                <VarianteSwatch nome={v.cor_nome ?? v.label ?? undefined} />
                <span className="min-w-0 flex-1 truncate" title={nomeVariante(v)}>{nomeVariante(v)}</span>
                {div ? (
                  <span className="flex shrink-0 items-center gap-0.5 text-[9px] font-medium text-red-600" title="Cor não existe nas variantes do tecido"><AlertTriangle className="h-3 w-3" />divergente</span>
                ) : planejada ? (
                  <span className="shrink-0 rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-700" title="Cor planejada — vira variante quando o tecido tiver essa cor">planejada</span>
                ) : null}
                <NumberInput integer blankZero placeholder="0" className="h-7 w-12 shrink-0 text-right" value={v.grade_total ?? 0} onChange={(e) => setGrade(v, Number(e.target.value) || 0)} />
                <span className="shrink-0 text-[9px] text-muted-foreground">pç</span>
                <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">{fmtMetros((material.consumo || 0) * (v.grade_total || 0))} m</span>
                <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => removerVariante(v)} title="Remover cor"><X className="h-3 w-3" /></Button>
              </div>
            );
          })
        )}

        {/* ações */}
        <div className="mt-1.5 flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => setMenuOpen((o) => !o)}><Plus className="h-3 w-3" />adicionar cor</Button>
          {temDivergentes && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px] text-red-600 hover:text-red-700" onClick={removerDivergentes}><AlertTriangle className="h-3 w-3" />remover divergentes</Button>
          )}
        </div>

        {/* menu de cores (in-flow p/ não recortar) */}
        {menuOpen && (
          <div className="mt-1 max-h-52 overflow-y-auto rounded border bg-background p-1">
            <div className="px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
              {material.artigo_id ? "Cores do tecido" : "Adicionar cor (base + apelido)"}
            </div>
            {material.artigo_id ? (
              opcoesArtigo.length ? opcoesArtigo.map((v) => (
                <button key={v.id} type="button" onClick={() => addDoArtigo(v)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted">
                  <VarianteSwatch nome={v.cor?.nome ?? undefined} /><span className="truncate">{corApelidoLabel(v.cor?.nome, v.apelido?.nome)}</span>
                </button>
              )) : <div className="px-1.5 py-1 text-[10px] text-muted-foreground">Todas as cores do tecido já adicionadas.</div>
            ) : (
              opcoesCombo.length ? opcoesCombo.map((c) => (
                <button key={comboKey(c.cor_id, c.cor_apelido_id)} type="button" onClick={() => addPlanejada(c)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted">
                  <VarianteSwatch nome={c.cor_nome} /><span className="truncate">{c.cor_nome} <span className="text-muted-foreground">/ {c.apelido_nome}</span></span>
                </button>
              )) : <div className="px-1.5 py-1 text-[10px] text-muted-foreground">Todas as cores já adicionadas.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
