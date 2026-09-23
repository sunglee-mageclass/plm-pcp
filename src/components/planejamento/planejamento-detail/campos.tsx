// Campos e blocos de UI do detalhe do Planejamento de Produto (Sheet/Dialog). Extraídos na F3.0
// (set/2026) de `PlanejamentoDetail.tsx` SEM mudança de comportamento: o texto abaixo foi MOVIDO
// como estava (só ganhou `export`). `FieldText`/`FieldSelect` seguem re-exportados por
// `PlanejamentoDetail.tsx` — é de lá que a rota `criacao.planejamento.tsx` os importa.
import { useState } from "react";
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
export function Secao({ titulo, children, defaultOpen = true }: { titulo: string; children: React.ReactNode; defaultOpen?: boolean }) {
  // Sheet abre com as seções RECOLHIDAS por padrão (exceto "Informações Gerais do Produto",
  // que passa defaultOpen); reduz o scroll inicial. O usuário expande o que precisa.
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 text-sm font-semibold text-foreground border-b pb-1.5 text-left"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span>{titulo}</span>
      </button>
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

export function MultiArtigosField({ label, value, onChange, artigos, estoque }: {
  label: string; value: string[]; onChange: (v: string[]) => void; artigos: ArtigoOpt[];
  estoque: Record<string, EstoqueArtigo>;
}) {
  const available = artigos.filter((a) => !value.includes(a.id));
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
      {available.length > 0 && (
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
export function FieldSelect({ label, value, onChange, options }: {
  label: string; value: string | null; onChange: (v: string) => void; options: Opt[];
}) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
        <SelectContent>
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
