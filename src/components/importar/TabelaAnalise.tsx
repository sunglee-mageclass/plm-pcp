// Tabela de análise INTERATIVA da importação (desktop). Uma linha por variante (cor), agrupada
// por tecido. Campos de cadastro = dropdown (CelulaLookup, casou=preenchido / não casou=vermelho
// +fuzzy+cadastrar); texto livre editável onde não há cadastro. Estados por ícone (novo/
// complementar/só-foto/pendência/erro), foto por cor (ampliar/trocar), toggle "mesmo tecido?",
// ignorar linha. As colunas Tecido/Cor ficam fixas; o resto rola na horizontal.
//
// Consome a EntidadeAgregada já analisada (analisarBanco) + as opções de lookup (dropdowns) +
// as fotos casadas por alvo. Emite mutações locais no estado das entidades para o pai gravar.

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, RefreshCw, Image as ImageIcon, AlertTriangle, XCircle, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeCat } from "@/lib/fornecedor-categoria";
import { CelulaLookup } from "@/components/importar/CelulaLookup";
import type { OpcoesLookup } from "@/lib/import/lookup";
import type { EntidadeAgregada, EstadoEntidade, EntityImportDescriptor } from "@/lib/import/types";
import { temErroBloqueante } from "@/lib/import/aggregate";
import { casarFotos, alvosDeFoto } from "@/lib/import/foto-match";

export type PatchEntidade = (chave: string, patch: Partial<EntidadeAgregada>) => void;

type Props = {
  descriptor: EntityImportDescriptor;
  entidades: EntidadeAgregada[];
  opcoes: OpcoesLookup;
  arquivos: File[]; // imagens soltas selecionadas (para casar a foto por cor inline)
  ignoradas: Set<string>;
  onToggleIgnorar: (chave: string) => void;
  onPatch: PatchEntidade;
  onCadastrar: (tipo: "fornecedor" | "cor" | "categoria", nome: string, chave: string) => void;
  /** foto trocada manualmente: chave do ALVO (chaveFotoVariante) → File (override do auto-match). */
  fotosManuais: Map<string, File>;
  onTrocarFoto: (chaveAlvo: string, file: File | null) => void;
};

const ESTADO_ICON: Record<EstadoEntidade | "erro", { cls: string; icon: React.ReactNode; label: string }> = {
  novo: { cls: "bg-emerald-50 text-emerald-600", icon: <Check className="h-3.5 w-3.5" />, label: "novo" },
  complementar: { cls: "bg-emerald-50 text-emerald-600", icon: <RefreshCw className="h-3.5 w-3.5" />, label: "complementar" },
  so_foto: { cls: "bg-sky-50 text-sky-600", icon: <ImageIcon className="h-3.5 w-3.5" />, label: "só foto" },
  conflito_fornecedor: { cls: "bg-amber-50 text-amber-600", icon: <AlertTriangle className="h-3.5 w-3.5" />, label: "conflito" },
  erro: { cls: "bg-destructive/10 text-destructive", icon: <XCircle className="h-3.5 w-3.5" />, label: "erro" },
};

export function TabelaAnalise({ descriptor, entidades, opcoes, arquivos, ignoradas, onToggleIgnorar, onPatch, onCadastrar, fotosManuais, onTrocarFoto }: Props) {
  const cores = opcoes["cores"] ?? [];       // coluna fixa de cor base
  const apelidos = opcoes["apelidos"] ?? []; // coluna fixa de apelido (filtra pela cor base)
  const modoVariante = (descriptor.fotoModo ?? "entidade") === "variante";

  // casa as imagens soltas com cada variante (por Nome_CorApelido). Guarda, por (entChave,varIdx):
  // a chave do ALVO (p/ trocar) e o File exibido (troca manual tem prioridade sobre o auto-match).
  const fileByName = useMemo(() => { const m = new Map<string, File>(); arquivos.forEach((f) => m.set(f.name, f)); return m; }, [arquivos]);
  const fotoInfo = useMemo(() => {
    const alvos = alvosDeFoto(descriptor, entidades);
    const { matches } = casarFotos(alvos.map((a) => ({ chave: a.chave, rotulo: a.rotulo })), arquivos.map((f) => f.name));
    const map = new Map<string, { chaveAlvo: string; file: File | null }>();
    alvos.forEach((a) => {
      const auto = fileByName.get(matches.find((x) => x.chave === a.chave)?.principal?.arquivo ?? "") ?? null;
      const manual = fotosManuais.get(a.chave) ?? null; // troca manual vence
      // modo variante: key por índice de cor; modo entidade (varIdx null): key ::0 (1 foto/item).
      const key = `${a.entChave}::${a.varIdx ?? 0}`;
      map.set(key, { chaveAlvo: a.chave, file: manual ?? auto });
    });
    return map;
  }, [descriptor, entidades, arquivos, fileByName, fotosManuais]);

  const gridCols = descriptor.gridColunas ?? [];
  const nomeEntidadeLabel = descriptor.label.replace(/s$/, ""); // "Tecidos" → "Tecido"
  const apelidosDaBase = (corId: string | null) => apelidos.filter((a) => !corId || a.corBaseId === corId);

  return (
    <div className="overflow-auto rounded-xl border">
      <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-[3] [&>th]:bg-muted [&>th]:px-2.5 [&>th]:py-2 [&>th]:text-left [&>th]:text-[10px] [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-muted-foreground [&>th]:font-semibold">
            <th className="!sticky left-0 !z-[4] w-9"></th>
            <th className="!sticky left-9 !z-[4] w-[150px]">{nomeEntidadeLabel}</th>
            <th className="!sticky left-[186px] !z-[4] w-[240px] shadow-[6px_0_8px_-6px_rgba(0,0,0,0.15)]">Foto · Cor · Apelido</th>
            {gridCols.map((c) => <th key={c.campoId + c.rotulo} className={c.tipo === "num" ? "text-right" : undefined}>{c.rotulo}</th>)}
            <th className="text-center">Ignorar</th>
          </tr>
        </thead>
        <tbody>
          {entidades.map((ent) => {
            const ign = ignoradas.has(ent.chave);
            const erro = temErroBloqueante(ent);
            const nome = String(ent.cabecalho[descriptor.nomeCampo ?? "nome"] ?? ent.chave);
            const patchCab = (k: string, val: unknown) => onPatch(ent.chave, { cabecalho: { ...ent.cabecalho, [k]: val } });
            const patchVarAt = (i: number, k: string, val: unknown) => {
              const nv = ent.variantes.map((x, xi) => (xi === i ? { ...x, [k]: val } : x));
              onPatch(ent.chave, { variantes: nv });
            };
            const st = erro ? ESTADO_ICON.erro : ESTADO_ICON[(ent.estado ?? "novo") as EstadoEntidade];
            // ao menos 1 linha mesmo SEM variante (aviamento sem cor) — senão a entidade some da tabela.
            const nLinhas = Math.max(1, ent.variantes.length);
            return Array.from({ length: nLinhas }).map((_, i) => {
              const first = i === 0;
              const v = (ent.variantes[i] ?? null) as Record<string, unknown> | null;
              const temVar = v != null;
              const corId = (v?.cor_id as string | null) ?? null;
              return (
                <tr key={`${ent.chave}-${i}`} className={cn("[&>td]:border-t [&>td]:border-border [&>td]:bg-card [&>td]:px-2.5 [&>td]:py-1.5 [&>td]:align-middle [&>td]:whitespace-nowrap", first && "[&>td]:border-t-2", ign && "opacity-50")}>
                  {/* status (1ª linha) */}
                  <td className="!sticky left-0 z-[2] !bg-card">
                    {first && <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-md", st.cls)} title={st.label}>{st.icon}</span>}
                  </td>
                  {/* nome da entidade (fixo) */}
                  <td className="!sticky left-9 z-[2] !bg-card">
                    {first ? (
                      <div>
                        <div className="font-semibold whitespace-normal">{nome}</div>
                        {ent.estado === "complementar" && <div className="text-[11px] text-muted-foreground">já existe · complementa</div>}
                        {ent.estado === "conflito_fornecedor" && (
                          <div className="mt-1 flex flex-col gap-1 text-[11px]">
                            <span className="text-muted-foreground whitespace-normal">Já existe ({ent.fornecedorExistenteNome ?? "outro forn."}). Mesmo item?</span>
                            <div className="inline-flex w-max overflow-hidden rounded-md border">
                              <button className={cn("px-2 py-0.5 text-[11px]", ent.mesmoTecidoConfirmado === true ? "bg-primary text-primary-foreground" : "text-muted-foreground")} onClick={() => onPatch(ent.chave, { mesmoTecidoConfirmado: true })}>Sim</button>
                              <button className={cn("px-2 py-0.5 text-[11px]", ent.mesmoTecidoConfirmado === false ? "bg-destructive text-white" : "text-muted-foreground")} onClick={() => onPatch(ent.chave, { mesmoTecidoConfirmado: false })}>Não</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : <span className="text-[11px] text-muted-foreground">↳ mesmo item</span>}
                  </td>
                  {/* foto + cor/apelido (fixo) */}
                  <td className="!sticky left-[186px] z-[2] !bg-card shadow-[6px_0_8px_-6px_rgba(0,0,0,0.15)]">
                    <div className="flex items-start gap-2">
                      {/* foto: por variante (tecido) na 1ª de cada cor; por item (aviamento) na 1ª linha */}
                      {(() => {
                        const key = modoVariante ? `${ent.chave}::${i}` : `${ent.chave}::0`;
                        const fi = fotoInfo.get(key);
                        if (!descriptor.temFoto) return <div className="w-11" />;
                        if (!modoVariante && !first) return <div className="w-11" />;
                        return <FotoVariante file={fi?.file ?? null} onTrocar={(f) => fi && onTrocarFoto(fi.chaveAlvo, f)} />;
                      })()}
                      <div className="flex flex-1 flex-col gap-1">
                        {temVar ? (
                          <>
                            <CelulaLookup value={corId} digitado={String(v?._corNome ?? "")} opcoes={cores}
                              onChange={(id) => patchVarAt(i, "cor_id", id)} onCadastrarNovo={(n) => onCadastrar("cor", n, ent.chave)}
                              placeholder="Cor base" obrigatorio />
                            <CelulaLookup value={(v?.cor_apelido_id as string | null) ?? null} digitado={String(v?._apelidoNome ?? "")}
                              opcoes={apelidosDaBase(corId)} onChange={(id) => patchVarAt(i, "cor_apelido_id", id)} placeholder="Apelido (opc.)" />
                          </>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">sem cor</span>
                        )}
                      </div>
                    </div>
                  </td>
                  {/* colunas do descritor */}
                  {gridCols.map((c) => (
                    <td key={c.campoId + c.rotulo} className={c.tipo === "num" ? "text-right" : undefined}>
                      {renderCelula(c, {
                        first, temVar, ent, v, i, opcoes, apelidosDaBase, corId,
                        onPatchCab: patchCab, onPatchVar: patchVarAt,
                        onCadastrar: (tipo, n) => onCadastrar(tipo, n, ent.chave),
                        onCatIds: (ids) => onPatch(ent.chave, { categoriaIds: ids }),
                        categoriaIds: ent.categoriaIds ?? [],
                      })}
                    </td>
                  ))}
                  <td className="text-center">{first && <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={ign} onChange={() => onToggleIgnorar(ent.chave)} />}</td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}

// Renderiza UMA célula da grade conforme o GridColuna (dirigido pelo descritor).
type CelCtx = {
  first: boolean; temVar: boolean; ent: EntidadeAgregada; v: Record<string, unknown> | null; i: number;
  opcoes: OpcoesLookup; apelidosDaBase: (corId: string | null) => { id: string; nome: string; corBaseId?: string }[]; corId: string | null;
  onPatchCab: (k: string, val: unknown) => void; onPatchVar: (i: number, k: string, val: unknown) => void;
  onCadastrar: (tipo: "fornecedor" | "cor" | "categoria", nome: string) => void;
  onCatIds: (ids: string[]) => void; categoriaIds: string[];
};
function renderCelula(c: import("@/lib/import/types").GridColuna, ctx: CelCtx): React.ReactNode {
  const { first, temVar, ent, v, i, opcoes, apelidosDaBase, corId, onPatchCab, onPatchVar, onCadastrar, onCatIds, categoriaIds } = ctx;
  const cabValor = (k: string) => (ent.cabecalho[k] as string | number | null) ?? null;
  if (c.escopo === "cabecalho") {
    if (!first) return c.tipo === "lookup" || c.tipo === "multi-lookup" ? null : null;
    const opc = c.lookupId ? (opcoes[c.lookupId] ?? []) : [];
    switch (c.tipo) {
      case "unidade":
        return <UnidadeCell value={String(cabValor(c.campoId) ?? "metro")} onChange={(u) => onPatchCab(c.campoId, u)} />;
      case "texto":
        return <TextCell value={String(cabValor(c.campoId) ?? "")} onChange={(x) => onPatchCab(c.campoId, x || null)} wide={c.wide} narrow={c.narrow} />;
      case "num":
        return <TextCell value={fmt(cabValor(c.campoId))} onChange={(x) => onPatchCab(c.campoId, parseNum(x))} narrow num />;
      case "multi-lookup":
        return <CategoriasCell ids={categoriaIds} opcoes={opc} onChange={onCatIds} onCadastrar={c.cadastroTipo ? (n) => onCadastrar(c.cadastroTipo!, n) : undefined} />;
      case "lookup":
        return <CelulaLookup value={cabValor(c.campoId) as string | null} digitado={c.digitadoKey ? ent.raw[c.digitadoKey] : undefined}
          opcoes={opc} onChange={(id) => onPatchCab(c.campoId, id)}
          onCadastrarNovo={c.cadastroTipo ? (n) => onCadastrar(c.cadastroTipo!, n) : undefined}
          placeholder={c.rotulo} obrigatorio={c.obrigatorio} />;
    }
  }
  // escopo variante
  if (!temVar || !v) return null;
  switch (c.tipo) {
    case "texto":
      return <TextCell value={String(v[c.campoId] ?? "")} onChange={(x) => onPatchVar(i, c.campoId, x || null)} narrow={c.narrow} wide={c.wide} />;
    case "num":
      return <TextCell value={fmt(v[c.campoId])} onChange={(x) => onPatchVar(i, c.campoId, parseNum(x))} narrow num />;
    case "lookup": {
      const opc = c.filtraPorCorBase ? apelidosDaBase(corId) : (c.lookupId ? opcoes[c.lookupId] ?? [] : []);
      return <CelulaLookup value={(v[c.campoId] as string | null) ?? null} opcoes={opc} onChange={(id) => onPatchVar(i, c.campoId, id)} placeholder={c.rotulo} obrigatorio={c.obrigatorio} />;
    }
    default:
      return null;
  }
}

// Miniatura da foto casada por cor + trocar (escolher outra imagem) / ampliar (lightbox simples).
function FotoVariante({ file, onTrocar }: { file: File | null; onTrocar: (f: File | null) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!file) { setUrl(null); return; }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const pick = () => inputRef.current?.click();
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) onTrocar(f); e.target.value = ""; };

  return (
    <div className="shrink-0">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
      {url ? (
        <div className="group relative h-11 w-11">
          <img src={url} alt="" className="h-11 w-11 rounded-lg object-cover" />
          <div className="absolute inset-0 flex items-center justify-center gap-1 rounded-lg bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            <button type="button" title="Ampliar" className="grid h-5 w-5 place-items-center rounded bg-white/90 text-slate-800" onClick={() => setZoom(true)}>
              <Search className="h-3 w-3" />
            </button>
            <button type="button" title="Trocar imagem" className="grid h-5 w-5 place-items-center rounded bg-white/90 text-slate-800" onClick={pick}>
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
          <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full border-2 border-card bg-emerald-500 text-white">
            <Check className="h-2.5 w-2.5" />
          </span>
        </div>
      ) : (
        <button type="button" title="Escolher imagem" onClick={pick} className="grid h-11 w-11 place-items-center rounded-lg border border-dashed text-muted-foreground hover:bg-accent">
          <Plus className="h-4 w-4" />
        </button>
      )}
      {zoom && url && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8" onClick={() => setZoom(false)}>
          <img src={url} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  );
}

// --- células auxiliares ---
function TextCell({ value, onChange, narrow, wide, num, disabled }: { value: string; onChange: (v: string) => void; narrow?: boolean; wide?: boolean; num?: boolean; disabled?: boolean }) {
  if (disabled) return null;
  return (
    <input
      className={cn("h-8 rounded-md border bg-card px-2 text-xs", narrow ? "min-w-[64px] w-[74px]" : wide ? "min-w-[150px]" : "min-w-[90px]", num && "text-right")}
      value={value}
      placeholder="—"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function UnidadeCell({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  if (disabled) return null;
  return (
    <select className="h-8 min-w-[82px] rounded-md border bg-card px-2 text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="metro">metro</option>
      <option value="kg">kg</option>
    </select>
  );
}

function CategoriasCell({ ids, opcoes, onChange, onCadastrar }: { ids: string[]; opcoes: { id: string; nome: string }[]; onChange: (ids: string[]) => void; onCadastrar?: (nome: string) => void }) {
  const nomes = useMemo(() => ids.map((id) => opcoes.find((o) => o.id === id)?.nome).filter(Boolean).join(", "), [ids, opcoes]);
  // multi simplificado: dropdown que alterna a categoria clicada (v1). Rótulo mostra as escolhidas.
  return (
    <CelulaLookup
      value={ids[0] ?? null}
      opcoes={opcoes}
      onChange={(id) => onChange(id ? [id] : [])}
      onCadastrarNovo={onCadastrar}
      placeholder={nomes || "Categorias"}
    />
  );
}

function fmt(v: unknown): string {
  if (v == null || v === "") return "";
  const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? String(v) : "";
}
function parseNum(s: string): number | null {
  const v = s.trim();
  if (!v) return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// re-export p/ conveniência
export { normalizeCat };
