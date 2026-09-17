// src/components/plan-tecido/MaterialBlock.tsx
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NumberInput } from "@/components/shared/NumberInput";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { X, Plus, AlertTriangle } from "lucide-react";
import { corApelidoLabel } from "@/lib/variante";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { useArtigosTecido } from "@/lib/plan-tecido/useArtigosTecido";
import { useCoresCombos } from "@/lib/plan-tecido/useCoresCombos";
import { varKey, fmtMetros, dedupVariantes } from "@/lib/plan-tecido/calc";
import type { PtMaterial, PtVariante } from "@/lib/plan-tecido/types";

type VarRow = { id: string; artigo_id: string; nome_variante: string | null; codigo_variante: string | null; cor_id: string | null; cor_apelido_id: string | null; cor: { nome: string | null } | null; apelido: { nome: string | null } | null };

const comboKey = (cid?: string | null, aid?: string | null) => `${cid ?? ""}|${aid ?? ""}`;

export function MaterialBlock({ material, onChange, onRemove, laneCategoriaId, readOnly = false, variantesGrupo }: { material: PtMaterial; onChange: (m: PtMaterial) => void; onRemove: () => void; laneCategoriaId?: string | null; paleta?: { artigo_id: string; papel: string }[]; readOnly?: boolean; variantesGrupo?: PtVariante[] }) {
  const { tecidoArtigos, forroArtigos, categoriaNomeDe, fornecedorDe, artigoTemCategoria, artigoMap } = useArtigosTecido();
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

  // SUBSTITUTOS EFETIVOS (set/2026, mesmo padrão do Desenvolvimento): união dos extras MANUAIS
  // (`material.artigo_ids_extra`, adicionados pelo select) com os DERIVADOS das variantes salvas
  // (`variante_artigo_id` ≠ principal — a árvore rejunta o artigo real de cada variante no load).
  // É DERIVADO/computado (não faz onChange) — reabrir o card NÃO marca "não salvo" à toa nem bumpa a
  // rev do colab; o `variante_artigo_id` não é gravado, sobrevive pelas variantes salvas.
  const artigoIdsExtra = useMemo(() => {
    const s = new Set(material.artigo_ids_extra ?? []);
    if (material.artigo_id) for (const v of material.variantes) {
      const aid = v.variante_artigo_id ?? null;
      if (aid && aid !== material.artigo_id) s.add(aid);
    }
    return Array.from(s);
  }, [material.artigo_id, material.artigo_ids_extra, material.variantes]);

  // Pool multi-artigo: principal + substitutos EFETIVOS. As variantes de TODOS os artigos do pool
  // entram no mesmo `variantesArtigo` — casaReal/opcoesArtigo/agrupamento por fornecedor cobrem o
  // pool inteiro sem queries separadas.
  const poolArtigoIds = Array.from(new Set([material.artigo_id, ...artigoIdsExtra].filter((id): id is string => !!id)));
  const { data: variantesArtigo = [] } = useQuery({
    queryKey: ["plan-tecido-variantes-artigo", poolArtigoIds.slice().sort().join(",")],
    enabled: poolArtigoIds.length > 0,
    queryFn: async () => ((await supabase.from("variantes_tecido")
      .select("id, artigo_id, nome_variante, codigo_variante, cor_id, cor_apelido_id, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
      .in("artigo_id", poolArtigoIds).order("id")).data ?? []) as unknown as VarRow[],
  });
  const realById = new Map(variantesArtigo.map((v) => [v.id, v]));
  const realByCombo = new Map<string, VarRow>();   // EXATO: cor base + apelido
  const realByCorId = new Map<string, VarRow>();    // por cor base (id)
  for (const v of variantesArtigo) {
    realByCombo.set(comboKey(v.cor_id, v.cor_apelido_id), v);
    if (v.cor_id && !realByCorId.has(v.cor_id)) realByCorId.set(v.cor_id, v);
  }
  // Variante REAL do POOL (principal + substitutos) que corresponde a esta cor do plano:
  // - variante real (variante_tecido_id): só casa se for variante de um artigo DO POOL (NÃO
  //   remapeia por cor pra fora do pool — isso DUPLICAVA cores e sujava o card ao abrir; a
  //   separação por artigo é feita no seed). Fora do pool → undefined → divergente (honesto).
  // - cor PLANEJADA (sem variante): sobe pra real por cor base+apelido (exato) ou cor base (id) —
  //   de QUALQUER artigo do pool; em caso de mesma cor em 2 artigos do pool, o `realByCorId` fica
  //   com o último visto (ordem da query) — mesma ambiguidade que já existia mono-artigo.
  const casaReal = (v: PtVariante): VarRow | undefined => {
    if (v.variante_tecido_id) return realById.get(v.variante_tecido_id);
    if (v.cor_id) return realByCombo.get(comboKey(v.cor_id, v.cor_apelido_id)) ?? realByCorId.get(v.cor_id);
    return undefined;
  };

  // ao escolher o tecido, cada cor do plano que casa (por cor base) vira a variante REAL do artigo
  useEffect(() => {
    if (readOnly) return; // travado (enviado à Explosão): não emite onChange (evita sujar o card)
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
    // Guarda anti-duplicata (espelha o dedup do servidor): o upgrade acima pode remapear 2 linhas
    // distintas pra MESMA variante real — colapsa aqui pra não exibir/contar a cor 2× no card.
    const deduped = dedupVariantes(next);
    if (changed || deduped.length !== material.variantes.length) onChange({ ...material, variantes: deduped });
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

  // UNIÃO VISUAL das variantes do grupo (Modo Plano, set/2026): as cores que OUTROS cards do mesmo
  // nome de tecido têm neste Tecido 1 mas ESTE não. Aparecem como linhas FANTASMA (esmaecidas, qtd 0
  // editável). NÃO gravam por exibir — só entram no material quando o usuário digita peças (promover).
  // `variantesGrupo` só chega no bloco do Tecido 1 e só no Modo Plano; undefined = comportamento normal.
  const fantasmas = useMemo(() => {
    if (!variantesGrupo?.length) return [] as PtVariante[];
    const tenho = new Set(material.variantes.map((v) => varKey(v)));
    // Dedup entre as próprias do grupo (a união já vem sem repetição, mas guarda-costas).
    const vistas = new Set<string>();
    const out: PtVariante[] = [];
    for (const v of variantesGrupo) {
      const k = varKey(v);
      if (tenho.has(k) || vistas.has(k)) continue;
      vistas.add(k);
      out.push(v);
    }
    return out;
  }, [variantesGrupo, material.variantes]);

  // Promover uma fantasma para variante real do material ao digitar peças (>0). Reusa o mesmo shape
  // de `addDoArtigo`/`addPlanejada` (grade zerada), já com o grade_total digitado; o useEffect de
  // auto-upgrade reconcilia a variante_tecido_id com o pool depois.
  const promoverFantasma = (v: PtVariante, val: number) => {
    if (val <= 0) return; // 0 não promove: continua fantasma
    const nova: PtVariante = { ...v, ordem: 0, grade_total: val, grades: v.grades ?? {} };
    onChange({ ...material, variantes: renum([...material.variantes, nova]) });
  };

  // nome completo "cor base - apelido": da variante real do artigo quando existir (o seed do Dev
  // só traz a cor base), senão do label salvo / cor_nome.
  const nomeVariante = (v: PtVariante): string => {
    if (v.variante_tecido_id) {
      const r = realById.get(v.variante_tecido_id);
      if (r) return corApelidoLabel(r.cor?.nome, r.apelido?.nome) || v.cor_nome || "—";
    }
    return v.label || v.cor_nome || "—";
  };

  // Cor base / cor apelido SEPARADOS (dono ago/2026: 1ª linha cor base, 2ª linha apelido — igual
  // aos painéis do Resumo). Variante real → nomes do artigo; planejada → cor_nome + apelido via
  // coresCombos (fallback: sufixo do label composto).
  const apelidoDeCombo = new Map(coresCombos.map((c) => [c.cor_apelido_id, c.apelido_nome]));
  const corEApelido = (v: PtVariante): { cor: string; apelido: string | null } => {
    if (v.variante_tecido_id) {
      const r = realById.get(v.variante_tecido_id);
      if (r) return { cor: r.cor?.nome || v.cor_nome || "—", apelido: r.apelido?.nome || null };
    }
    const cor = v.cor_nome || v.label || "—";
    const apelido =
      (v.cor_apelido_id ? apelidoDeCombo.get(v.cor_apelido_id) : null) ??
      (v.label && v.cor_nome && v.label.startsWith(`${v.cor_nome} - `) ? v.label.slice(v.cor_nome.length + 3) : null);
    return { cor, apelido: apelido || null };
  };
  const cmpVar = (a: PtVariante, b: PtVariante) => {
    const ca = corEApelido(a), cb = corEApelido(b);
    return ca.cor.localeCompare(cb.cor, "pt-BR", { sensitivity: "base" }) ||
      (ca.apelido ?? "").localeCompare(cb.apelido ?? "", "pt-BR", { sensitivity: "base" });
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmRemSubs, setConfirmRemSubs] = useState<string | null>(null); // substituto pendente de confirmar remoção
  const usados = new Set(material.variantes.map((v) => varKey(v)));
  const usadosCombo = new Set(material.variantes.map((v) => comboKey(v.cor_id, v.cor_apelido_id)).filter((k) => k !== "|"));
  // opções: com artigo → variantes do POOL (principal + substitutos) ainda não usadas; sem artigo →
  // todas as combinações. Em ordem ALFABÉTICA cor base → apelido (dono ago/2026).
  const cmpNome = (a: string | null | undefined, b: string | null | undefined) =>
    (a ?? "").localeCompare(b ?? "", "pt-BR", { sensitivity: "base" });
  const opcoesArtigo = variantesArtigo
    .filter((v) => !usados.has(v.id) && !usadosCombo.has(comboKey(v.cor_id, v.cor_apelido_id)))
    .sort((a, b) => cmpNome(a.cor?.nome, b.cor?.nome) || cmpNome(a.apelido?.nome, b.apelido?.nome));
  const opcoesCombo = coresCombos
    .filter((c) => !usadosCombo.has(comboKey(c.cor_id, c.cor_apelido_id)))
    .sort((a, b) => cmpNome(a.cor_nome, b.cor_nome) || cmpNome(a.apelido_nome, b.apelido_nome));
  // Rótulo da opção do menu de cores: com >1 artigo no pool, prefixa "Nome do artigo · cor" (estilo
  // ModeloTecidosSection) pra não confundir de qual tecido é cada cor.
  const nomeArtigoDe = (id: string) => artigoMap.get(id)?.nome ?? "Tecido";
  const varianteMenuLabel = (v: VarRow) => {
    const cor = corApelidoLabel(v.cor?.nome, v.apelido?.nome);
    return poolArtigoIds.length > 1 ? `${nomeArtigoDe(v.artigo_id)} · ${cor}` : cor;
  };

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

  // Substitutos (set/2026, portado do Desenvolvimento) — tecidos/forros que também podem ser
  // usados quando o principal acaba. Opções: mesmo PAPEL do bloco (tecido/forro), menos o
  // principal e os já-extras.
  const substitutoOptions = base.filter((a) => a.id !== material.artigo_id && !artigoIdsExtra.includes(a.id));
  const addSubstituto = (id: string) => {
    if (!id || artigoIdsExtra.includes(id)) return;
    onChange({ ...material, artigo_ids_extra: [...(material.artigo_ids_extra ?? []), id] });
  };
  // Remover substituto: tira do array manual E remove as variantes daquele artigo (senão o substituto
  // voltaria como DERIVADO pelas variantes que sobraram). `variante_artigo_id` identifica o artigo da
  // variante; sem ele (planejadas/cross-artigo), não são deste substituto — ficam.
  const aplicarRemocaoSubstituto = (id: string) => {
    onChange({
      ...material,
      artigo_ids_extra: (material.artigo_ids_extra ?? []).filter((x) => x !== id),
      variantes: renum(material.variantes.filter((v) => (v.variante_artigo_id ?? null) !== id)),
    });
  };
  // Se o substituto tem cor(es) com peças planejadas (grade_total > 0), remover perde essas peças —
  // confirma antes (padrão do sistema: AlertDialog em ação sensível). Sem peças → remove direto.
  const removerSubstituto = (id: string) => {
    const comPecas = material.variantes.some((v) => (v.variante_artigo_id ?? null) === id && (Number(v.grade_total) || 0) > 0);
    if (comPecas) setConfirmRemSubs(id);
    else aplicarRemocaoSubstituto(id);
  };

  // Variantes agrupadas por FORNECEDOR do artigo (principal ou substituto) a que pertencem —
  // descobre o artigo da variante via `variante_tecido_id` → VarRow (`realById`); cor planejada
  // (sem variante real ainda) cai no fornecedor do PRINCIPAL (fallback, dono set/2026).
  const fornecedorLabel = (fid: string | null) => fid ?? "Sem fornecedor definido";
  const fornecedorDaVariante = (v: PtVariante): string => {
    if (v.variante_tecido_id) {
      const r = realById.get(v.variante_tecido_id);
      if (r) return fornecedorLabel(fornecedorDe(r.artigo_id));
    }
    return fornecedorLabel(material.artigo_id ? fornecedorDe(material.artigo_id) : null);
  };
  const multiFornecedor = poolArtigoIds.length > 1;

  return (
    <div className="mb-2 rounded border">
      <div className="bg-muted/60 p-2">
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">{material.tipo === "tecido" ? "TEC" : "FOR"} {material.numero}</span>
          <select disabled={readOnly} className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs max-md:h-11 max-md:text-base disabled:cursor-not-allowed disabled:opacity-60" value={material.artigo_id ?? ""} onChange={(e) => escolherArtigo(e.target.value)}>
            <option value="">{`Escolher ${rotulo}…`}</option>
            {artigosVisiveis.map((a) => { const f = fornecedorDe(a.id); return (<option key={a.id} value={a.id}>{a.nome}{f ? ` · ${f}` : ""}{a.unidade_medida === "kg" ? " [kg]" : ""}</option>); })}
          </select>
          {!readOnly && <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onRemove}><X className="h-3 w-3" /></Button>}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          {categoriaNome && (
            <span className="shrink-0 rounded-full border bg-background px-2 py-0.5 text-[10px] text-muted-foreground" title="Categoria do tecido (cadastro)">{categoriaNome}</span>
          )}
          <div className="ml-auto flex items-center gap-1 text-xs">
            {/* Fonte do consumo (item 3c): quando o CAD tem consumo preenchido (>0) ele VENCE o BOM
                do Dev e o plano — marcador "CAD" com tooltip, sem poluir. */}
            {(Number(material.consumo_cad) || 0) > 0 && (
              <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary" title="Consumo do CAD (fonte mais adiantada — vence o BOM do Desenvolvimento)">CAD</span>
            )}
            <span className="text-muted-foreground">consumo</span>
            <NumberInput disabled={readOnly} blankZero placeholder="0" className="h-7 w-16 text-right max-md:h-11 max-md:text-base" value={material.consumo} data-colab-path={`pt-consumo:${material.id ?? `${material.tipo}#${material.numero}`}`} onChange={(e) => onChange({ ...material, consumo: Number(e.target.value) || 0 })} />
            <span className="text-muted-foreground">m/pç</span>
          </div>
        </div>
        {/* consumo 0 zera reserva/comprometido/a comprar em silêncio (auditoria jul/2026:
            um card foi à explosão contando 0) — aviso honesto no lugar do silêncio. */}
        {(Number(material.consumo) || 0) <= 0 && material.artigo_id && (
          <p className="mt-1 text-[10px] font-medium text-amber-700">consumo não preenchido — este {material.tipo === "forro" ? "forro" : "tecido"} conta 0 m nas contas</p>
        )}

        {/* Substitutos (set/2026, portado do Desenvolvimento): mesmo tecido de fornecedores
            diferentes / tecidos alternativos "quando o principal acaba". Só com o principal já
            escolhido; oculto quando travado (readOnly), igual às demais ações. */}
        {!readOnly && material.artigo_id && (
          <div className="mt-1.5 space-y-1">
            <div className="flex flex-wrap items-center gap-1">
              {artigoIdsExtra.map((id) => (
                <Badge key={id} variant="secondary" className="gap-1">
                  {artigoMap.get(id)?.nome ?? id}
                  <button type="button" aria-label="Remover" className="ml-0.5 hover:text-destructive" onClick={() => removerSubstituto(id)}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {substitutoOptions.length > 0 && (
                <Select value="" onValueChange={addSubstituto}>
                  <SelectTrigger className="h-7 w-auto min-w-[150px] text-xs">
                    <SelectValue placeholder={`+ adicionar ${material.tipo === "forro" ? "forro" : "tecido"} substituto`} />
                  </SelectTrigger>
                  <SelectContent>
                    {substitutoOptions.map((a) => {
                      const f = fornecedorDe(a.id);
                      return <SelectItem key={a.id} value={a.id}>{a.nome}{f ? ` · ${f}` : ""}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="p-2">
        {/* cores selecionadas (variantes) + fantasmas do grupo (Modo Plano) */}
        {material.variantes.length === 0 && fantasmas.length === 0 ? (
          <div className="rounded border border-dashed p-2 text-center text-[10px] italic text-muted-foreground">Nenhuma cor. “+ adicionar cor” para escolher as variantes.</div>
        ) : (() => {
          // Variantes em ordem ALFABÉTICA (cor base → apelido) só na EXIBIÇÃO (dono, jul/2026) —
          // copia p/ ordenar, sem mexer no material.variantes salvo (não suja o form nem renumera).
          // As FANTASMAS (união do grupo, Modo Plano) entram junto na mesma ordenação, marcadas
          // p/ render esmaecido; ao digitar peças elas se promovem a reais (`promoverFantasma`).
          const ordenadas = [...material.variantes.map((v) => ({ v, fantasma: false })), ...fantasmas.map((v) => ({ v, fantasma: true }))]
            .sort((a, b) => cmpVar(a.v, b.v));
          const linha = ({ v, fantasma }: { v: PtVariante; fantasma: boolean }, vi: number) => {
            const div = !fantasma && divergente(v);
            const planejada = !fantasma && !v.variante_tecido_id;
            const { cor, apelido } = corEApelido(v);
            return (
              // key com índice de exibição: uma cor pode aparecer DUPLICADA no material (anomalia de
              // dado — variante repetida no plano/BOM); `varKey(v)` sozinho colidia e disparava o
              // warning "two children with the same key" do React. O índice garante unicidade no
              // render sem mascarar o dado (as duas linhas continuam visíveis).
              // h-[var(--h-var,auto)]: no Modo Plano a var CSS `--h-var` (herdada da faixa) fixa a altura
              // da linha IGUAL à do resumo → alinhamento linha-a-linha. Fora do Modo Plano a var não
              // existe → cai em `auto` (altura natural pelo py-1), comportamento idêntico ao de antes.
              // data-pt-primeira-var na 1ª linha (só Modo Plano, sinalizado por `variantesGrupo`): âncora
              // que o ModoPlanoView mede p/ empurrar o topo do resumo e alinhar a 1ª variante (encaixe do topo).
              <div key={`${varKey(v)}-${vi}`} data-pt-primeira-var={variantesGrupo && vi === 0 ? "" : undefined} className={`flex h-[var(--h-var,auto)] items-center gap-2 border-t border-dashed py-1 text-xs first:border-t-0 ${div ? "rounded bg-red-50" : ""} ${fantasma ? "opacity-55" : ""}`}>
                <VarianteSwatch nome={v.cor_nome ?? v.label ?? undefined} />
                {/* 1ª linha cor base, 2ª linha cor apelido (dono ago/2026 — igual aos painéis) */}
                <span className="min-w-0 flex-1" title={nomeVariante(v)}>
                  <span className="block truncate">{cor}</span>
                  {apelido && <span className="block truncate text-[10px] leading-tight text-muted-foreground">{apelido}</span>}
                </span>
                {fantasma ? (
                  <span className="shrink-0 rounded bg-muted px-1 text-[9px] font-medium text-muted-foreground" title="Cor de outro card do mesmo tecido — digite peças para adicioná-la aqui">do grupo</span>
                ) : div ? (
                  <span className="flex shrink-0 items-center gap-0.5 text-[9px] font-medium text-red-600" title="Cor não existe nas variantes do tecido"><AlertTriangle className="h-3 w-3" />divergente</span>
                ) : planejada ? (
                  <span className="shrink-0 rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-700" title="Cor planejada — vira variante quando o tecido tiver essa cor">planejada</span>
                ) : null}
                <NumberInput disabled={readOnly} integer blankZero placeholder="0" className="h-7 w-12 shrink-0 text-right" value={fantasma ? 0 : (v.grade_total ?? 0)} data-colab-path={fantasma ? undefined : `pt-grade:${material.id ?? `${material.tipo}#${material.numero}`}:${varKey(v)}`} onChange={(e) => fantasma ? promoverFantasma(v, Number(e.target.value) || 0) : setGrade(v, Number(e.target.value) || 0)} />
                <span className="shrink-0 text-[9px] text-muted-foreground">pç</span>
                <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">{fmtMetros((material.consumo || 0) * (fantasma ? 0 : (v.grade_total || 0)))} m</span>
                {!readOnly && !fantasma ? (
                  <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => removerVariante(v)} title="Remover cor"><X className="h-3 w-3" /></Button>
                ) : (
                  <span className="w-5 shrink-0" aria-hidden />
                )}
              </div>
            );
          };
          // Sem substitutos (pool = 1 artigo): lista plana, IGUAL ao comportamento de hoje —
          // sem cabeçalho de fornecedor.
          if (!multiFornecedor) return ordenadas.map((row, vi) => linha(row, vi));
          // Com substitutos: agrupa por FORNECEDOR do artigo de cada variante, preservando a
          // ordenação alfabética DENTRO de cada grupo (a lista já veio ordenada por cmpVar).
          const porFornecedor = new Map<string, { v: PtVariante; fantasma: boolean }[]>();
          ordenadas.forEach((row) => {
            const f = fornecedorDaVariante(row.v);
            const arr = porFornecedor.get(f) ?? [];
            arr.push(row);
            porFornecedor.set(f, arr);
          });
          return Array.from(porFornecedor.entries())
            .sort(([a], [b]) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }))
            .map(([fornecedor, rows]) => (
              <div key={fornecedor}>
                {/* h-[var(--h-fornec,auto)]: casa a altura do cabeçalho de fornecedor com o do resumo
                    no Modo Plano; fora dele, altura natural. */}
                <p className="flex h-[var(--h-fornec,auto)] items-center truncate text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{fornecedor}</p>
                {rows.map((row) => linha(row, ordenadas.indexOf(row)))}
              </div>
            ));
        })()}

        {/* ações — escondidas quando travado (enviado à Explosão) */}
        {!readOnly && (
          <div className="mt-1.5 flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => setMenuOpen((o) => !o)}><Plus className="h-3 w-3" />adicionar cor</Button>
            {temDivergentes && (
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px] text-red-600 hover:text-red-700" onClick={removerDivergentes}><AlertTriangle className="h-3 w-3" />remover divergentes</Button>
            )}
          </div>
        )}

        {/* menu de cores (in-flow p/ não recortar) */}
        {menuOpen && (
          <div className="mt-1 max-h-52 overflow-y-auto rounded border bg-background p-1">
            <div className="px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
              {material.artigo_id ? "Cores do tecido" : "Adicionar cor (base + apelido)"}
            </div>
            {material.artigo_id ? (
              opcoesArtigo.length ? opcoesArtigo.map((v) => (
                <button key={v.id} type="button" onClick={() => addDoArtigo(v)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted">
                  <VarianteSwatch nome={v.cor?.nome ?? undefined} /><span className="truncate">{varianteMenuLabel(v)}</span>
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

      {/* Confirmação ao remover substituto com peças planejadas (evita perda silenciosa, achado da
          revisão). Montado só quando há um pendente (nasce limpo). */}
      {confirmRemSubs && (
        <AlertDialog open onOpenChange={(o) => !o && setConfirmRemSubs(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remover {artigoMap.get(confirmRemSubs)?.nome ?? "substituto"}?</AlertDialogTitle>
              <AlertDialogDescription>
                Este {rotulo} alternativo tem cores com peças planejadas. Remover vai apagar essas cores e
                suas quantidades deste material. As cores planejadas (sem variante) e de outros tecidos permanecem.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => { aplicarRemocaoSubstituto(confirmRemSubs); setConfirmRemSubs(null); }}>Remover</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
