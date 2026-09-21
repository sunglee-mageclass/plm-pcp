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
  const forn = opcoes["fornecedores"] ?? [];
  const reps = opcoes["representantes"] ?? [];
  const cores = opcoes["cores"] ?? [];
  const apelidos = opcoes["apelidos"] ?? [];
  const cats = opcoes["categorias"] ?? [];
  const meses = opcoes["meses"] ?? [];
  const anos = opcoes["anos"] ?? [];

  // casa as imagens soltas com cada variante (por Nome_CorApelido). Guarda, por (entChave,varIdx):
  // a chave do ALVO (p/ trocar) e o File exibido (troca manual tem prioridade sobre o auto-match).
  const fileByName = useMemo(() => { const m = new Map<string, File>(); arquivos.forEach((f) => m.set(f.name, f)); return m; }, [arquivos]);
  const fotoInfo = useMemo(() => {
    const alvos = alvosDeFoto(descriptor, entidades);
    const { matches } = casarFotos(alvos.map((a) => ({ chave: a.chave, rotulo: a.rotulo })), arquivos.map((f) => f.name));
    const map = new Map<string, { chaveAlvo: string; file: File | null }>();
    alvos.forEach((a) => {
      if (a.varIdx == null) return;
      const auto = fileByName.get(matches.find((x) => x.chave === a.chave)?.principal?.arquivo ?? "") ?? null;
      const manual = fotosManuais.get(a.chave) ?? null; // troca manual vence
      map.set(`${a.entChave}::${a.varIdx}`, { chaveAlvo: a.chave, file: manual ?? auto });
    });
    return map;
  }, [descriptor, entidades, arquivos, fileByName, fotosManuais]);

  return (
    <div className="overflow-auto rounded-xl border">
      <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-[3] [&>th]:bg-muted [&>th]:px-2.5 [&>th]:py-2 [&>th]:text-left [&>th]:text-[10px] [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-muted-foreground [&>th]:font-semibold">
            <th className="!sticky left-0 !z-[4] w-9"></th>
            <th className="!sticky left-9 !z-[4] w-[150px]">Tecido</th>
            <th className="!sticky left-[186px] !z-[4] w-[240px] shadow-[6px_0_8px_-6px_rgba(0,0,0,0.15)]">Foto · Cor · Apelido</th>
            <th>Unidade</th><th>NCM</th><th>Fornecedor</th><th>Representante</th><th>Categorias</th>
            <th>Composição</th><th className="text-right">Preço</th><th>Mês</th><th>Ano</th>
            <th>Nome variante</th><th>Cód. var.</th><th className="text-right">Preço var.</th>
            <th className="text-center">Ignorar</th>
          </tr>
        </thead>
        <tbody>
          {entidades.map((ent) => {
            const ign = ignoradas.has(ent.chave);
            const erro = temErroBloqueante(ent);
            const nome = String(ent.cabecalho.nome ?? ent.chave);
            const apelidosDaBase = (corId: string | null) => apelidos.filter((a) => !corId || a.corBaseId === corId);
            return ent.variantes.map((v, i) => {
              const first = i === 0;
              const st = erro ? ESTADO_ICON.erro : ESTADO_ICON[(ent.estado ?? "novo") as EstadoEntidade];
              const corId = (v.cor_id as string | null) ?? null;
              const patchCab = (k: string, val: unknown) => onPatch(ent.chave, { cabecalho: { ...ent.cabecalho, [k]: val } });
              const patchVar = (k: string, val: unknown) => {
                const nv = ent.variantes.map((x, xi) => (xi === i ? { ...x, [k]: val } : x));
                onPatch(ent.chave, { variantes: nv });
              };
              return (
                <tr key={`${ent.chave}-${i}`} className={cn("[&>td]:border-t [&>td]:border-border [&>td]:bg-card [&>td]:px-2.5 [&>td]:py-1.5 [&>td]:align-middle [&>td]:whitespace-nowrap", first && "[&>td]:border-t-2", ign && "opacity-50")}>
                  {/* status (só na 1ª linha do tecido) */}
                  <td className="!sticky left-0 z-[2] !bg-card">
                    {first && <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-md", st.cls)} title={st.label}>{st.icon}</span>}
                  </td>
                  {/* tecido (fixo) */}
                  <td className="!sticky left-9 z-[2] !bg-card">
                    {first ? (
                      <div>
                        <div className="font-semibold">{nome}</div>
                        {ent.estado === "complementar" && <div className="text-[11px] text-muted-foreground">já existe · complementa</div>}
                        {ent.estado === "conflito_fornecedor" && (
                          <div className="mt-1 flex flex-col gap-1 text-[11px]">
                            <span className="text-muted-foreground">Já existe ({ent.fornecedorExistenteNome ?? "outro forn."}). Mesmo tecido?</span>
                            <div className="inline-flex w-max overflow-hidden rounded-md border">
                              <button className={cn("px-2 py-0.5 text-[11px]", ent.mesmoTecidoConfirmado === true ? "bg-primary text-primary-foreground" : "text-muted-foreground")} onClick={() => onPatch(ent.chave, { mesmoTecidoConfirmado: true })}>Sim</button>
                              <button className={cn("px-2 py-0.5 text-[11px]", ent.mesmoTecidoConfirmado === false ? "bg-destructive text-white" : "text-muted-foreground")} onClick={() => onPatch(ent.chave, { mesmoTecidoConfirmado: false })}>Não</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : <span className="text-[11px] text-muted-foreground">↳ mesma peça</span>}
                  </td>
                  {/* cor (fixo) — miniatura da foto casada + dropdowns cor/apelido */}
                  <td className="!sticky left-[186px] z-[2] !bg-card shadow-[6px_0_8px_-6px_rgba(0,0,0,0.15)]">
                    <div className="flex items-start gap-2">
                      {(() => {
                        const fi = fotoInfo.get(`${ent.chave}::${i}`);
                        return <FotoVariante file={fi?.file ?? null} onTrocar={(f) => fi && onTrocarFoto(fi.chaveAlvo, f)} />;
                      })()}
                      <div className="flex flex-1 flex-col gap-1">
                        <CelulaLookup
                          value={corId}
                          digitado={String((v as Record<string, unknown>)._corNome ?? "")}
                          opcoes={cores}
                          onChange={(id) => patchVar("cor_id", id)}
                          onCadastrarNovo={(n) => onCadastrar("cor", n, ent.chave)}
                          placeholder="Cor base"
                          obrigatorio
                        />
                        <CelulaLookup
                          value={(v.cor_apelido_id as string | null) ?? null}
                          digitado={String((v as Record<string, unknown>)._apelidoNome ?? "")}
                          opcoes={apelidosDaBase(corId)}
                          onChange={(id) => patchVar("cor_apelido_id", id)}
                          placeholder="Apelido (opc.)"
                        />
                      </div>
                    </div>
                  </td>
                  {/* ---- campos que rolam ---- */}
                  <td><UnidadeCell value={String(ent.cabecalho.unidade_medida ?? "metro")} onChange={(u) => patchCab("unidade_medida", u)} disabled={!first} /></td>
                  <td><TextCell value={String(ent.cabecalho.ncm ?? "")} onChange={(x) => patchCab("ncm", x || null)} disabled={!first} narrow /></td>
                  <td>{first ? <CelulaLookup value={(ent.cabecalho.empresa_id as string | null) ?? null} digitado={ent.raw.fornecedor} opcoes={forn} onChange={(id) => patchCab("empresa_id", id)} onCadastrarNovo={(n) => onCadastrar("fornecedor", n, ent.chave)} placeholder="Fornecedor" /> : <span className="text-[11px] text-muted-foreground">↑</span>}</td>
                  <td>{first ? <CelulaLookup value={(ent.cabecalho.representante_id as string | null) ?? null} digitado={ent.raw.representante} opcoes={reps} onChange={(id) => patchCab("representante_id", id)} placeholder="— (nenhum)" /> : null}</td>
                  <td>{first ? <CategoriasCell ids={ent.categoriaIds ?? []} opcoes={cats} onChange={(ids) => onPatch(ent.chave, { categoriaIds: ids })} /> : null}</td>
                  <td>{first ? <TextCell value={String(ent.cabecalho.composicao ?? "")} onChange={(x) => patchCab("composicao", x || null)} wide /> : null}</td>
                  <td className="text-right">{first ? <TextCell value={fmt(ent.cabecalho.preco)} onChange={(x) => patchCab("preco", parseNum(x))} narrow num /> : null}</td>
                  <td>{first ? <CelulaLookup value={(ent.cabecalho.mes_id as string | null) ?? null} digitado={ent.raw.mes} opcoes={meses} onChange={(id) => patchCab("mes_id", id)} placeholder="Mês" /> : null}</td>
                  <td>{first ? <CelulaLookup value={(ent.cabecalho.ano_id as string | null) ?? null} digitado={ent.raw.ano} opcoes={anos} onChange={(id) => patchCab("ano_id", id)} placeholder="Ano" /> : null}</td>
                  <td><TextCell value={String(v.nome_variante ?? "")} onChange={(x) => patchVar("nome_variante", x || null)} /></td>
                  <td><TextCell value={String(v.codigo_variante ?? "")} onChange={(x) => patchVar("codigo_variante", x || null)} narrow /></td>
                  <td className="text-right"><TextCell value={fmt(v.preco)} onChange={(x) => patchVar("preco", parseNum(x))} narrow num /></td>
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

function CategoriasCell({ ids, opcoes, onChange }: { ids: string[]; opcoes: { id: string; nome: string }[]; onChange: (ids: string[]) => void }) {
  const nomes = useMemo(() => ids.map((id) => opcoes.find((o) => o.id === id)?.nome).filter(Boolean).join(", "), [ids, opcoes]);
  // multi simplificado: dropdown que alterna a categoria clicada (v1). Rótulo mostra as escolhidas.
  return (
    <CelulaLookup
      value={ids[0] ?? null}
      opcoes={opcoes}
      onChange={(id) => onChange(id ? [id] : [])}
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
