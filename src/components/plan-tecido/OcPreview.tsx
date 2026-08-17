import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, Paperclip, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { labelVarianteRow } from "@/lib/variante";
import { fmtMetros } from "@/lib/plan-tecido/calc";
import { cn } from "@/lib/utils";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const cmpPt = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base" });

type PrevArtigo = { id: string | null; nome: string | null; unidade_medida: string | null; rendimento: number | null } | null;
type PrevVariante = {
  nome_variante: string | null;
  codigo_variante: string | null;
  cor: { nome: string | null } | null;
  apelido: { nome: string | null } | null;
  artigo: PrevArtigo;
} | null;
type PrevItem = {
  cancelado: boolean | null;
  quantidade_pedida: number | null;
  rendimento: number | null;
  variante_tecido_id: string | null;
  artigo: PrevArtigo;
  variante: PrevVariante;
};
type PrevOc = {
  numero_pedido: string | null;
  is_rolo: boolean | null;
  anexo_pedido_url: string | null;
  itens: PrevItem[] | null;
};

type GrupoVariante = { key: string; label: string; corNome: string | null; metros: number };
type Grupo = { key: string; nome: string; variantes: GrupoVariante[] };

/** Metragem pedida do item (kg → metros via rendimento do item, fallback do artigo) — mesma
 *  conta de `metragemPedidaItem` (src/components/oc-tecido/shared.ts), reimplementada aqui em
 *  cima do embed direto (artigo REAL da variante vence, como no pool de `ocsAplicadas`). */
function metragemItem(it: PrevItem): number {
  const a = it.variante?.artigo ?? it.artigo;
  const qtd = Number(it.quantidade_pedida) || 0;
  if (!a) return qtd;
  const rend = Number(it.rendimento ?? a.rendimento ?? 0);
  return a.unidade_medida === "kg" ? qtd * rend : qtd;
}

/** Agrupa os itens (não cancelados) por tecido (artigo real) → variante, somando metragem —
 *  variantes em ordem alfabética (mesmo padrão do Drawer/Resumo). */
function buildGrupos(itens: PrevItem[]): Grupo[] {
  const porArtigo = new Map<string, { nome: string; vs: Map<string, GrupoVariante> }>();
  for (const it of itens) {
    if (it.cancelado) continue;
    const a = it.variante?.artigo ?? it.artigo;
    const artId = a?.id ?? "sem-tecido";
    const artNome = a?.nome ?? "Sem tecido";
    let g = porArtigo.get(artId);
    if (!g) { g = { nome: artNome, vs: new Map() }; porArtigo.set(artId, g); }
    const vKey = it.variante_tecido_id ?? `${artId}|${g.vs.size}`;
    const cur = g.vs.get(vKey) ?? {
      key: vKey,
      label: labelVarianteRow(it.variante ?? undefined),
      corNome: it.variante?.cor?.nome ?? null,
      metros: 0,
    };
    cur.metros += metragemItem(it);
    g.vs.set(vKey, cur);
  }
  return [...porArtigo.entries()]
    .map(([key, g]) => ({ key, nome: g.nome, variantes: [...g.vs.values()].sort((a, b) => cmpPt(a.label, b.label)) }))
    .sort((a, b) => cmpPt(a.nome, b.nome));
}

function AnexoPreview({ path }: { path: string | null }) {
  const url = useSignedUrl(path, "oc-tecido");
  if (!path) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-2 text-[11px] text-muted-foreground">
        <Paperclip className="h-3.5 w-3.5 shrink-0" />
        Sem anexo
      </div>
    );
  }
  const img = /\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i.test(path);
  const pdf = /\.pdf$/i.test(path);
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => { e.stopPropagation(); if (!url) e.preventDefault(); }}
      className="flex min-h-[44px] items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent md:min-h-0"
      title={pdf ? "Abrir PDF do pedido" : "Abrir anexo do pedido"}
    >
      {img && url ? (
        <img src={url} alt="Anexo do pedido" className="h-9 w-9 shrink-0 rounded border object-cover" />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border bg-muted">
          <FileText className="h-4 w-4 text-muted-foreground" />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-primary">
        {pdf ? "Abrir PDF do pedido" : "Ver anexo do pedido"}
      </span>
    </a>
  );
}

/**
 * Preview de UMA OC/Rolo (Vincular OC/Rolo — Plan. Tecido): topo = variantes × metragem pedida
 * (agrupadas por tecido); embaixo = anexo do pedido. Busca LAZY — só quando montado (o HoverCard/
 * Popover só monta o conteúdo ao abrir), cacheado por queryKey (`plan-tecido-oc-preview:<ocId>`)
 * — nunca pré-busca pra lista inteira de OCs.
 */
export function OcPreviewCard({ ocId }: { ocId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["plan-tecido-oc-preview", ocId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_tecido" as any)
        .select(
          "numero_pedido, is_rolo, anexo_pedido_url, itens:ocs_tecido_itens(cancelado, quantidade_pedida, rendimento, variante_tecido_id, artigo:artigo_id(id, nome, unidade_medida, rendimento), variante:variante_tecido_id(nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome), artigo:artigo_id(id, nome, unidade_medida, rendimento)))",
        )
        .eq("id", ocId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as PrevOc | null;
    },
  });

  const grupos = useMemo(() => buildGrupos(data?.itens ?? []), [data]);

  return (
    <div className="w-72 text-xs">
      <div className="flex items-center gap-1.5 border-b px-2 py-1.5 font-display text-xs font-semibold">
        {isLoading ? (
          <span className="h-3 w-24 animate-pulse rounded bg-muted" aria-hidden />
        ) : (
          <>
            {data?.is_rolo && (
              <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                Rolo
              </span>
            )}
            <span className="truncate">{data?.numero_pedido || (data?.is_rolo ? "Rolo s/ nº" : "OC s/ nº")}</span>
          </>
        )}
      </div>
      <div className="max-h-56 overflow-y-auto py-1">
        {isLoading ? (
          <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">Carregando…</div>
        ) : isError ? (
          <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">Não foi possível carregar.</div>
        ) : grupos.length === 0 ? (
          <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">Sem itens.</div>
        ) : (
          grupos.map((g) => (
            <div key={g.key}>
              <div className="bg-muted/40 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {g.nome}
              </div>
              {g.variantes.map((v) => (
                <div key={v.key} className="flex items-center gap-2 px-2 py-1">
                  <VarianteSwatch nome={v.corNome ?? undefined} />
                  <span className="min-w-0 flex-1 truncate">{v.label}</span>
                  <span className="num shrink-0 font-medium">{fmtMetros(v.metros)} m</span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      <div className="border-t">
        <AnexoPreview path={data?.anexo_pedido_url ?? null} />
      </div>
    </div>
  );
}

/**
 * Envolve `children` (o rótulo/linha da opção de OC/Rolo) com o preview: HoverCard no desktop
 * (hover-to-open, mouse) + ícone ⓘ próprio no mobile (toque 44px, abre o MESMO conteúdo num
 * Popover leve — sem hover em touch). `children` é o gatilho do HoverCard (precisa aceitar
 * ref/props — ex. um `<span>`/`<div>`).
 */
export function OcHoverInfo({ ocId, children, className }: { ocId: string; children: ReactNode; className?: string }) {
  return (
    <>
      <HoverCard openDelay={200} closeDelay={100}>
        <HoverCardTrigger asChild>{children}</HoverCardTrigger>
        <HoverCardContent align="start" className="hidden w-auto p-0 md:block">
          <OcPreviewCard ocId={ocId} />
        </HoverCardContent>
      </HoverCard>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Ver detalhes da OC / rolo"
            title="Ver detalhes"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground md:hidden",
              className,
            )}
          >
            <Info className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0" onClick={(e) => e.stopPropagation()}>
          <OcPreviewCard ocId={ocId} />
        </PopoverContent>
      </Popover>
    </>
  );
}
