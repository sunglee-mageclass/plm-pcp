// Campos e blocos de UI do detalhe do Planejamento de Produto (Sheet/Dialog). Extraídos na F3.0
// (set/2026) de `PlanejamentoDetail.tsx` SEM mudança de comportamento: o texto abaixo foi MOVIDO
// como estava (só ganhou `export`). `FieldText`/`FieldSelect` seguem re-exportados por
// `PlanejamentoDetail.tsx` — é de lá que a rota `criacao.planejamento.tsx` os importa.
import { useRef, useState } from "react";
import { usePedidoAbertura } from "@/components/planejamento/planejamento-detail/secoes-abertas";
import { Trash2, Upload, ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AnexoThumbZoom } from "@/components/shared/ImagePreview";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { brl, fmtNum } from "@/lib/format";
import { useSignedUrlBucket, type Opt, type ArtigoOpt } from "@/components/planejamento/modelo-shared";

// Seção colapsável do detalhe do card — expandida por default; estado local por seção
// (não persiste). Colapsar só esconde os filhos; o draft vive no diálogo, nada se perde.
// (O que abre COLAPSADO por default são os GRUPOS da lista — pedido do dono, ago/2026.)
export function Secao({ id, titulo, numero, selo, chip, children, defaultOpen = true }: {
  /** F3.3 — chave da seção (`data-secao` + abertura por pedido — links "Para enviar, falta…"). */
  id?: string;
  titulo: string;
  /** F3.3 — numeração dinâmica "N." (selos-secoes.ts `numerarSecoes`). */
  numero?: number;
  /** F3.3 — selo de completude à direita (IRMÃO do botão: o "i" do selo é um <button>). */
  selo?: React.ReactNode;
  /** F3.3 — chip "do Desenvolvimento" (mockup) nas seções vindas do Dev. */
  chip?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  // Sheet abre com as seções RECOLHIDAS por padrão (exceto "Informações Gerais do Produto",
  // que passa defaultOpen); reduz o scroll inicial. O usuário expande o que precisa.
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLElement>(null);
  usePedidoAbertura(id, () => setOpen(true), ref);
  return (
    <section ref={ref} className="space-y-3" data-secao={id}>
      <div className="flex items-center gap-2 border-b pb-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-semibold text-foreground"
        >
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="truncate">{numero ? `${numero}. ` : ""}{titulo}</span>
          {chip && <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-normal text-muted-foreground max-sm:hidden">{chip}</span>}
        </button>
        {/* Lote B (revisão do commit 6fac668, minor) — `min-w-0` + `truncate` (não `shrink-0`, que IMPEDE encolher):
            selos com texto longo (ex.: resumo da Coleção, "Verão 2027 · Casual · lanç. 2 · mar/2027") estouravam a
            largura em telas estreitas (360px); o `title` do StatusBadge (dentro de `selo`) já traz o texto completo. */}
        {selo && <span className="ml-auto inline-flex min-w-0 items-center gap-1 truncate">{selo}</span>}
      </div>
      {open && children}
    </section>
  );
}

/** Campo somente-leitura (label + valor) no mesmo estilo dos inputs do form. */
export function CampoRO({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <div className="h-9 px-3 flex items-center rounded-md border bg-muted text-sm tabular-nums">{value}</div>
    </div>
  );
}

export type EstoqueArtigo = { fisico_m: number; reservado_m: number; disponivel_m: number };
const fmtMetros = (n: number) => `${fmtNum(n)} m`;

export function MultiArtigosField({ label, value, onChange, artigos, estoque, max }: {
  label: string; value: string[]; onChange: (v: string[]) => void; artigos: ArtigoOpt[];
  estoque: Record<string, EstoqueArtigo>;
  /** F3.2 — limite de itens (o BOM tem Tecido 1..3; o 4º nunca aparecia no Desenvolvimento). */
  max?: number;
}) {
  const available = artigos.filter((a) => !value.includes(a.id));
  const podeAdicionar = max === undefined || value.length < max;
  const byId = Object.fromEntries(artigos.map((a) => [a.id, a]));
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1 mb-1">
        {value.length === 0 && <span className="text-xs text-muted-foreground">Nenhum tecido selecionado</span>}
        {value.map((id) => {
          const a = byId[id];
          const e = estoque[id];
          return (
            <Badge key={id} variant="secondary" className="gap-1">
              {a ? (a.unidade_medida ? `${a.nome} [${a.unidade_medida}]` : a.nome) : id}
              {a?.preco_por_metro != null && (
                <span className="text-[10px] opacity-70">· {brl(a.preco_por_metro)}/m</span>
              )}
              {e && (
                <span className={`text-[10px] ${e.disponivel_m <= 0 ? "text-destructive font-medium" : "opacity-70"}`}>
                  · disp. {fmtMetros(e.disponivel_m)}
                </span>
              )}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== id))}
                className="ml-1 hover:text-destructive"
                aria-label="Remover"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </Badge>
          );
        })}
      </div>
      {available.length > 0 && podeAdicionar && (
        <Select value="" onValueChange={(v) => v && onChange([...value, v])}>
          <SelectTrigger><SelectValue placeholder="Adicionar tecido…" /></SelectTrigger>
          <SelectContent>
            {available.map((a) => {
              const e = estoque[a.id];
              return (
                <SelectItem key={a.id} value={a.id}>
                  <span className="flex flex-col">
                    <span>{a.unidade_medida ? `${a.nome} [${a.unidade_medida}]` : a.nome}</span>
                    <span className="text-xs text-muted-foreground">Preço/m: {a.preco_por_metro != null ? brl(a.preco_por_metro) : "—"}</span>
                    {e && (
                      <span className={`text-xs ${e.disponivel_m <= 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        Estoque: {fmtMetros(e.fisico_m)} · disp.: {fmtMetros(e.disponivel_m)}
                      </span>
                    )}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      )}
      {/* Item J (fix round 2): limite atingido era silencioso (o Select some sem explicação). */}
      {available.length > 0 && !podeAdicionar && (
        <span className="text-xs text-muted-foreground">Máximo de {max} tecidos.</span>
      )}
    </div>
  );
}


export function FieldText({ label, value, onChange, colabPath }: {
  label: string; value: string; onChange: (v: string) => void;
  // Colab: presença por campo — `data-colab-path` trackea o foco; o realce visual (anel+nome+cor
  // do colega) vem do wrapper <FieldPresence> ao redor (set/2026), não mais de um ring fixo aqui.
  colabPath?: string;
}) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-colab-path={colabPath}
      />
    </div>
  );
}
// Valor-sentinela da opção "— Nenhum —" (o Radix Select não aceita item com value "").
const OPCAO_NENHUM = "__nenhum__";
export function FieldSelect({ label, value, onChange, options, onLimpar, disabled }: {
  label: string; value: string | null; onChange: (v: string) => void; options: Opt[];
  // F3.1 (opcional): com `onLimpar`, a lista ganha "— Nenhum —" no topo, que ZERA o campo (mockup: Estilista
  // "ganha '— Nenhum —' p/ limpar"; Modelista/Piloteiros idem). Sem ele, igual a antes.
  onLimpar?: () => void;
  // F3.1 fix round 1: o Radix Select abre no `pointerdown` e só respeita a prop `disabled` do próprio
  // componente — o `<fieldset disabled>` do HTML NÃO propaga pra ele (não é um <select> nativo), então um
  // FieldSelect dentro de um fieldset travado continua abrindo/trocando valor com o mouse. Opcional: sem a
  // prop, comportamento idêntico ao de hoje.
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <Select disabled={disabled} value={value ?? ""} onValueChange={(v) => (v === OPCAO_NENHUM ? onLimpar?.() : onChange(v))}>
        <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
        <SelectContent>
          {onLimpar && <SelectItem value={OPCAO_NENHUM}>— Nenhum —</SelectItem>}
          {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
export function PhotoList({ label, paths, onAdd, onRemove }: {
  label: string; paths: string[]; onAdd: (f: File) => void; onRemove: (i: number) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        {paths.map((p, i) => (
          <FileThumb key={i} path={p} onRemove={() => onRemove(i)} />
        ))}
        <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent w-fit">
          <Upload className="h-4 w-4" /> Adicionar
          <input type="file" accept="image/*,application/pdf,.jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.pdf" className="hidden" onChange={(e) => e.target.files?.[0] && onAdd(e.target.files[0])} />
        </label>
      </div>
    </div>
  );
}
/* Miniatura de anexo (imagem OU PDF) com preview + zoom ao clicar (abre grande). */
function FileThumb({ path, onRemove }: { path: string; onRemove?: () => void }) {
  const isPdf = /\.pdf$/i.test(path);
  const url = useSignedUrlBucket(path);
  return <AnexoThumbZoom url={url} isPdf={isPdf} onRemove={onRemove} />;
}

/* Anexo único (imagem ou PDF) com preview + zoom — Croqui / Desenho Técnico. */
export function SingleFileField({ label, path, onUpload, onRemove }: {
  label: string; path: string; onUpload: (f: File) => void; onRemove: () => void;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        {path && <FileThumb path={path} onRemove={onRemove} />}
        <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent w-fit">
          <Upload className="h-4 w-4" /> {path ? "Trocar arquivo" : "Enviar arquivo"}
          <input
            type="file"
            accept="image/*,application/pdf,.jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.pdf"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
          />
        </label>
      </div>
    </div>
  );
}
