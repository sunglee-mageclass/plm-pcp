import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { artigoLabel } from "@/lib/artigo-label";
import { Plus, Trash2, AlertTriangle, Check } from "lucide-react";
import { Field, FieldSelectOpt } from "./shared";
import { useModoOcRolo } from "@/hooks/useModoOcRolo";
import { TIPOS, TIPO_LABEL, type TecidoBlock, type GradeRow, type OcAlloc } from "./types";
import { EtiquetaLavagemArtigoView } from "@/components/shared/EtiquetaLavagemArtigo";
import { fmtNum } from "@/lib/format";

type ArtigoOpt = { id: string; nome: string; unidade_medida?: string | null };

const fmtM = (n: number) => fmtNum(n);

export function ModeloTecidosSection({
  modeloId,
  blocks,
  artigos,
  artigosForro,
  artigosEntretela,
  grades,
  onChangeBlock,
  onChangeVariante,
  onChangeOcLinks,
}: {
  modeloId: string;
  blocks: TecidoBlock[];
  artigos: ArtigoOpt[];
  artigosForro: ArtigoOpt[];
  artigosEntretela: ArtigoOpt[];
  grades: GradeRow[];
  onChangeBlock: (idx: number, patch: Partial<TecidoBlock>) => void;
  onChangeVariante: (idx: number, vIdx: number, value: string | null) => void;
  onChangeOcLinks: (idx: number, vIdx: number, allocs: OcAlloc[]) => void;
}) {
  const artigoNomeById = new Map(artigos.map((a) => [a.id, a.nome] as const));
  // Peças por posição de variante (grade_total por variante_numero), p/ a
  // necessidade de cada variante = consumo × (1+loss) × peças.
  const gradeTotalByPos = (numero: number) =>
    grades.find((g) => g.variante_numero === numero)?.grade_total ?? 0;
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
      artigoIdsExtra: [],
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

        const artigosBase = tipo === "forro" ? artigosForro : tipo === "entretela" ? artigosEntretela : artigos;

        return (
          <div key={tipo} className="space-y-2">
            <p className="text-sm font-semibold">{TIPO_LABEL[tipo]}</p>
            <div className="space-y-2">
              {blocksOfType.map((b) => {
                if (!visible.has(`${tipo}-${b.numero}`)) return null;
                const idx = blocks.findIndex((bb) => bb.tipo === tipo && bb.numero === b.numero);
                if (idx < 0) return null;
                let artigosOpts = artigosBase;
                if (b.artigo_id && !artigosOpts.some((a) => a.id === b.artigo_id)) {
                  const existing = artigos.find((a) => a.id === b.artigo_id);
                  if (existing) artigosOpts = [existing, ...artigosOpts];
                }
                return (
                  <TecidoBlockEditor
                    key={`${tipo}-${b.numero}`}
                    modeloId={modeloId}
                    block={b}
                    artigos={artigosOpts}
                    allArtigos={artigos}
                    artigoNomeById={artigoNomeById}
                    gradeTotalByPos={gradeTotalByPos}
                    onChangeBlock={(p) => onChangeBlock(idx, p)}
                    onChangeVariante={(vi, val) => onChangeVariante(idx, vi, val)}
                    onChangeOcLinks={(vi, allocs) => onChangeOcLinks(idx, vi, allocs)}
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
  modeloId,
  block,
  artigos,
  allArtigos,
  artigoNomeById,
  gradeTotalByPos,
  onChangeBlock,
  onChangeVariante,
  onChangeOcLinks,
  onRemove,
  removable,
}: {
  modeloId: string;
  block: TecidoBlock;
  artigos: ArtigoOpt[];
  allArtigos: ArtigoOpt[];
  artigoNomeById: Map<string, string>;
  gradeTotalByPos: (numero: number) => number;
  onChangeBlock: (p: Partial<TecidoBlock>) => void;
  onChangeVariante: (vIdx: number, val: string | null) => void;
  onChangeOcLinks: (vIdx: number, allocs: OcAlloc[]) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  // Tecido e forro podem ser feitos de mais de um artigo (substitutos): quando
  // um acaba, completa-se com outro. O pool de variantes de CADA bloco é ESTRITO:
  // o artigo principal do bloco + os substitutos adicionados manualmente ali.
  // Nenhum bloco injeta automaticamente variantes de outros tecidos (planejados
  // ou dos blocos vizinhos) — só aparece o que pertence ao artigo escolhido (+ os
  // substitutos explícitos). Tecido 2/3 são blocos próprios, não substitutos do 1.
  const canSubstitutos = block.tipo === "tecido" || block.tipo === "forro";
  const poolArtigoIds = (() => {
    const s = new Set<string>();
    if (block.artigo_id) s.add(block.artigo_id);
    (block.artigoIdsExtra ?? []).forEach((id) => id && s.add(id));
    return Array.from(s);
  })();
  const multiFabric = poolArtigoIds.length > 1;
  // Opções de substituto: catálogo completo, menos o que já está no pool.
  const substitutoOptions = allArtigos.filter((a) => !poolArtigoIds.includes(a.id));

  // Multiplicador de cobertura: só nos complementares (Tecido 2/3, Forro, Entretela).
  const canMultiplicador = !(block.tipo === "tecido" && block.numero === 1);
  const multAt = (i: number) => Number(block.multiplicadores?.[i] ?? 1) || 1;
  const setMult = (i: number, val: number) => {
    const next = [...(block.multiplicadores ?? [])];
    while (next.length < 10) next.push(1);
    next[i] = val > 0 ? val : 1;
    onChangeBlock({ multiplicadores: next });
  };

  const { data: variantesPool = [] } = useQuery({
    queryKey: ["variantes-pool", poolArtigoIds.slice().sort().join(",")],
    enabled: poolArtigoIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido")
        .select("id, nome_variante, codigo_variante, artigo_id")
        .in("artigo_id", poolArtigoIds);
      if (error) throw error;
      return (data ?? []).map((v: any) => ({
        id: v.id,
        artigo_id: v.artigo_id as string,
        nome: v.nome_variante || v.codigo_variante || v.id,
      }));
    },
  });
  const varianteLabel = (v: { artigo_id: string; nome: string }) =>
    multiFabric ? `${artigoNomeById.get(v.artigo_id) ?? "Tecido"} · ${v.nome}` : v.nome;

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
          <Input readOnly value={fmtNum(block.custo_previsto)} />
        </Field>
        <Field label="Consumo">
          <NumberInput type="number" step="0.001" value={block.consumo} onChange={(e) => onChangeBlock({ consumo: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="% Loss">
          <NumberInput type="number" step="0.01" value={block.loss_percent} onChange={(e) => onChangeBlock({ loss_percent: Number(e.target.value) || 0 })} />
        </Field>
      </div>

      {canSubstitutos && block.artigo_id && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {TIPO_LABEL[block.tipo]}s que também podem ser usados (quando o principal acaba)
          </p>
          <div className="flex flex-wrap items-center gap-1">
            {(block.artigoIdsExtra ?? []).map((id) => (
              <Badge key={id} variant="secondary" className="gap-1">
                {artigoNomeById.get(id) ?? id}
                <button
                  type="button"
                  aria-label="Remover"
                  className="ml-0.5 hover:text-destructive"
                  onClick={() => onChangeBlock({ artigoIdsExtra: (block.artigoIdsExtra ?? []).filter((x) => x !== id) })}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {substitutoOptions.length > 0 && (
              <Select value="" onValueChange={(v) => v && onChangeBlock({ artigoIdsExtra: [...(block.artigoIdsExtra ?? []), v] })}>
                <SelectTrigger className="h-7 w-auto min-w-[150px] text-xs"><SelectValue placeholder="+ adicionar tecido" /></SelectTrigger>
                <SelectContent>
                  {substitutoOptions.map((a) => <SelectItem key={a.id} value={a.id}>{artigoLabel(a)}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      )}

      {block.artigo_id && (
        <EtiquetaLavagemArtigoView artigoId={block.artigo_id} size="sm" />
      )}

      {poolArtigoIds.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Variantes{multiFabric ? " — de qualquer tecido do pool; custo usa o maior preço/metro" : ""}
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            {Array.from({ length: 10 }).map((_, i) => {
              const prevFilled = i === 0 || !!block.variantes[i - 1];
              if (!prevFilled) return null;
              const current = block.variantes[i];
              const usedElsewhere = new Set(
                block.variantes.filter((v, j) => j !== i && !!v) as string[],
              );
              const available = variantesPool.filter(
                (v) => v.id === current || !usedElsewhere.has(v.id),
              );
                return (
                  <div key={i} className="space-y-1">
                    <Select
                      value={current ?? ""}
                      onValueChange={(v) => onChangeVariante(i, v === "__none__" ? null : v)}
                    >
                      <SelectTrigger><SelectValue placeholder={`Variante ${i + 1}`} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Remover —</SelectItem>
                        {available.map((v) => <SelectItem key={v.id} value={v.id}>{varianteLabel(v)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {canMultiplicador && current && (
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="whitespace-nowrap">× grade (cobre quantas variantes)</span>
                        <NumberInput
                          type="number"
                          step="0.01"
                          min={0}
                          className="h-7 w-16"
                          value={multAt(i)}
                          onChange={(e) => setMult(i, Number(e.target.value) || 1)}
                        />
                      </div>
                    )}
                    {current && (
                      <OcLinksField
                        modeloId={modeloId}
                        varianteId={current}
                        need={(block.consumo || 0) * (1 + (block.loss_percent || 0) / 100) * gradeTotalByPos(i + 1) * multAt(i)}
                        value={block.oc_links?.[i] ?? []}
                        onChange={(allocs) => onChangeOcLinks(i, allocs)}
                      />
                    )}
                  </div>
                );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

type OcDisp = {
  oc_tecido_item_id: string;
  numero_pedido: string;
  is_rolo?: boolean;
  rolo_codigo?: string | null;
  rolo_origem_item_id?: string | null;
  oc_origem_id?: string | null;       // OC de onde o rolo foi separado (híbrido)
  oc_origem_numero?: string | null;
  data_entrega: string | null;
  recebida: boolean;
  disponivel_m: number;
};

/**
 * Vínculo de OCs de uma variante. Pode marcar mais de uma OC (a sobra de uma
 * completa com outra) — alocação automática por saldo, na ordem de marcação.
 * Mostra recebidas e previstas (plano), e alerta se a cobertura é suficiente.
 * Sem marcar nenhuma = FIFO no corte.
 */
function OcLinksField({
  modeloId,
  varianteId,
  need,
  value,
  onChange,
}: {
  modeloId: string;
  varianteId: string;
  need: number;
  value: OcAlloc[];
  onChange: (allocs: OcAlloc[]) => void;
}) {
  const { data: ocs = [] } = useQuery({
    queryKey: ["ocs-disponiveis-variante", varianteId, modeloId],
    enabled: !!varianteId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ocs_disponiveis_variante" as any, { _variante_id: varianteId, _modelo_id: modeloId });
      if (error) throw error;
      return (data ?? []) as OcDisp[];
    },
  });
  const modo = useModoOcRolo();

  const ocById = new Map(ocs.map((o) => [o.oc_tecido_item_id, o]));
  // Aloca a necessidade pelos saldos das OCs marcadas, na ordem (prioridade).
  const allocate = (ids: string[]): OcAlloc[] => {
    let restante = need;
    return ids.map((id, idx) => {
      const saldo = Math.max(0, Number(ocById.get(id)?.disponivel_m ?? 0));
      const q = need > 0 ? Math.min(restante, saldo) : 0;
      restante = Math.max(0, restante - q);
      return { oc_tecido_item_id: id, quantidade_m: Math.round(q * 100) / 100, prioridade: idx + 1 };
    });
  };

  const selectedIds = value.map((v) => v.oc_tecido_item_id);
  const toggle = (id: string) => {
    const ids = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    onChange(allocate(ids));
  };

  // OC com 0m disponível não é selecionável (não aparece) — exceto se já estiver
  // marcada nesta variante, p/ não sumir uma escolha existente.
  // Filtro OC/Rolo da loja (modo_oc_rolo): só o tipo configurado aparece; vínculos já marcados continuam.
  const matchModo = (o: OcDisp) => modo === "ambos" || selectedIds.includes(o.oc_tecido_item_id) || (modo === "rolo" ? !!o.is_rolo : !o.is_rolo);
  const visibleOcs = ocs.filter((o) => (Number(o.disponivel_m) > 0 || selectedIds.includes(o.oc_tecido_item_id)) && matchModo(o));
  // OCs vinculadas que não voltaram na lista (ex.: já zeradas) não somem.
  const extraSelected: OcDisp[] = value
    .filter((v) => !ocById.has(v.oc_tecido_item_id))
    .map((v) => ({ oc_tecido_item_id: v.oc_tecido_item_id, numero_pedido: "(vínculo)", data_entrega: null, recebida: true, disponivel_m: 0 }));
  const rows = [...visibleOcs, ...extraSelected];

  const renderRow = (o: OcDisp) => {
    const alloc = value.find((v) => v.oc_tecido_item_id === o.oc_tecido_item_id);
    const checked = !!alloc;
    const entrega = o.data_entrega ? new Date(o.data_entrega).toLocaleDateString("pt-BR") : "—";
    const semSaldo = Number(o.disponivel_m) <= 0;
    return (
      <label key={o.oc_tecido_item_id} className="flex items-center gap-1.5 text-[11px] cursor-pointer">
        <input type="checkbox" className="h-3 w-3 shrink-0" checked={checked} onChange={() => toggle(o.oc_tecido_item_id)} />
        <span className="font-mono">{o.is_rolo ? `Rolo ${o.rolo_codigo ?? o.numero_pedido}` : `OC ${o.numero_pedido}`}</span>
        {!o.recebida && (
          <Badge variant="outline" className="h-4 px-1 text-[9px] border-amber-500 text-amber-600">prevista · {entrega}</Badge>
        )}
        <span className={semSaldo ? "text-destructive" : "text-muted-foreground"}>
          {o.recebida ? "saldo" : "prev."} {fmtM(o.disponivel_m)}m
        </span>
        {checked && alloc && alloc.quantidade_m > 0 && (
          <span className="ml-auto text-foreground whitespace-nowrap">usa {fmtM(alloc.quantidade_m)}m</span>
        )}
      </label>
    );
  };

  // Híbrido: agrupa os rolos pela OC de ORIGEM; OC total (não-rolo) vira seu próprio
  // grupo; rolos avulsos (sem OC) ficam num grupo separado no fim.
  const grupos = (() => {
    if (modo !== "ambos") return [] as { key: string; label: string; ord: number; items: OcDisp[] }[];
    const map = new Map<string, { key: string; label: string; ord: number; items: OcDisp[] }>();
    const add = (key: string, label: string, ord: number, o: OcDisp) => {
      const g = map.get(key) ?? { key, label, ord, items: [] };
      g.items.push(o); map.set(key, g);
    };
    for (const o of rows) {
      if (o.is_rolo) {
        if (o.oc_origem_id) add(`oc:${o.oc_origem_id}`, `OC ${o.oc_origem_numero ?? "—"}`, 1, o);
        else add("avulsos", "Avulsos (sem OC)", 3, o);
      } else {
        add(`total:${o.oc_tecido_item_id}`, `OC ${o.numero_pedido}`, 0, o);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.ord - b.ord || a.label.localeCompare(b.label));
  })();

  if (rows.length === 0) {
    return <p className="text-[11px] text-muted-foreground">Sem OC desta variante — corte usa FIFO.</p>;
  }

  const coberto = value.reduce((s, v) => s + (v.quantidade_m || 0), 0);
  const suficiente = need <= 0 || coberto + 1e-6 >= need;

  return (
    <div className="rounded-md border p-1.5 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">OCs (sem marcar = FIFO no corte)</span>
        {need > 0 && (
          <span className="flex items-center gap-1.5">
            {value.length > 0 && (
              <button type="button" className="text-[10px] text-muted-foreground hover:text-foreground underline" onClick={() => onChange(allocate(selectedIds))}>
                redistribuir
              </button>
            )}
            <span className={`text-[11px] inline-flex items-center gap-0.5 ${suficiente ? "text-emerald-600" : "text-destructive"}`}>
              {suficiente ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              {fmtM(coberto)} / {fmtM(need)}m
            </span>
          </span>
        )}
      </div>
      {!suficiente && need > 0 && (
        <p className="text-[11px] text-destructive">Faltam {fmtM(need - coberto)}m — marque mais OCs ou ajuste consumo/grade.</p>
      )}
      {modo === "ambos" ? (
        // Híbrido: escolher pela OC (grupo) e marcar os rolos dela; avulsos à parte.
        <div className="space-y-1.5">
          {grupos.map((g) => (
            <div key={g.key} className="space-y-0.5">
              <div className="text-[11px] font-semibold text-foreground">{g.label}</div>
              <div className="space-y-0.5 pl-3">{g.items.map(renderRow)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-0.5">{rows.map(renderRow)}</div>
      )}
    </div>
  );
}
