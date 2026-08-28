// Detalhe (Sheet/Dialog) do card do Planejamento — extraído (refactor 2026-08-25) da
// função privada `ModeloDialog` da rota `criacao.planejamento.tsx`, renomeada p/
// `PlanejamentoDetail` e exportada. Comportamento IDÊNTICO ao anterior — código MOVIDO,
// sem alteração de campo/query/guarda. Única adição: a prop `contexto` (default
// "planejamento") que muda os 2 pontos de navegação p/ o Produto Acabado (ver abaixo),
// pra o detalhe poder ser reusado inline dentro do planejador Produto Acabado (Task 2 da
// spec) sem "sair" da tela em que já está.
//
// O componente é AUTOSSUFICIENTE quanto às 7 listas de opção: chama
// `usePlanejamentoOpts()` internamente (o caller passa só modeloId/onClose/onSaved/contexto).
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Copy, Upload, ArrowLeft, Save, ChevronDown, ChevronRight, AlertTriangle, ExternalLink, PackagePlus } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { InfoStrip } from "@/components/shared/InfoStrip";
import { AnexoThumbZoom } from "@/components/shared/ImagePreview";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { ColabBanner } from "@/components/shared/ColabBanner";
import { useColabRegistro } from "@/hooks/useColabRegistro";
import { mergeDraft, type Conflito } from "@/lib/colab/merge";
import { useAuth } from "@/hooks/useAuth";
import { ObsMaoObraField } from "@/components/shared/ObsMaoObraField";
import { NumberInput } from "@/components/shared/NumberInput";
import { MaoObraEditor, type MaoObraEditorLinha } from "@/components/planejamento/MaoObraEditor";
import { estadoMO, moLinhasEqual, type MoLinha } from "@/lib/mao-obra";
import { DateField } from "@/components/shared/DateField";
import { precoInfo, custoSimulado, type CustoSimInput } from "@/lib/preco";
import { cqLiberado } from "@/lib/cq-status";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useGridCols } from "@/hooks/useGridCols";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { brl, fmtNum } from "@/lib/format";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { useTenantModules } from "@/hooks/useTenantModules";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { ProdutoRelacionadoSetor } from "@/components/planejamento/ProdutoRelacionadoSetor";
import { useOrcamento, orcLabel } from "@/components/otb/orcamento";
import { ehGrupoAcessorio } from "@/lib/produto-acabado";
import { varianteLabel } from "@/lib/variante";
import { erroValidacao } from "@/components/produto-acabado/shared";
import { DEFAULT_TAMANHOS } from "@/components/oc-p-acabado/shared";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";

import { usePlanejamentoOpts } from "@/hooks/usePlanejamentoOpts";
import {
  uploadFile, useSignedUrlBucket,
  numOr0, STATUS_OPTS,
  emptyDraft, draftFromModeloRow,
  type Opt, type ArtigoOpt, type SubOpt, type Draft,
} from "@/components/planejamento/modelo-shared";

/**
 * Sincroniza tecidos_planejados (Planejamento) com modelo_tecidos tipo "tecido" (Desenvolvimento).
 * - Preserva blocos não-tecido (forro/entretela/etc).
 * - Se o artigo de um numero mudou, limpa variantes daquela linha.
 * - Remove tecidos cujo numero não está mais em planejados.
 * - Insere novos com consumo=0.
 */
async function syncTecidosToDesenvolvimento(modeloId: string, planejados: string[]) {
  const { data: existing, error: eFetch } = await supabase
    .from("modelo_tecidos")
    .select("id, artigo_id, numero, tipo")
    .eq("modelo_id", modeloId)
    .eq("tipo", "tecido");
  if (eFetch) throw eFetch;
  const rows = (existing ?? []) as any[];

  // Casa por ARTIGO (e não por posição): assim REORDENAR ou REMOVER um tecido no
  // Planejamento NÃO apaga as variantes/cores e o consumo já preenchidos no
  // Desenvolvimento — só reposiciona (numero) ou insere/remove o que mudou.
  const usedIds = new Set<string>();
  for (let i = 0; i < planejados.length; i++) {
    const numero = i + 1;
    const artigoId = planejados[i];
    const match = rows.find((r) => r.artigo_id === artigoId && !usedIds.has(r.id));
    if (match) {
      usedIds.add(match.id);
      if (match.numero !== numero) {
        const { error } = await supabase.from("modelo_tecidos").update({ numero }).eq("id", match.id);
        if (error) throw error;
      }
    } else {
      const { error } = await supabase.from("modelo_tecidos").insert({
        modelo_id: modeloId, tipo: "tecido", numero, artigo_id: artigoId,
        consumo: 0, loss_percent: 0, custo_previsto: 0,
      });
      if (error) throw error;
    }
  }

  // Remove só os tecidos cujo artigo NÃO está mais planejado (aí sim apaga as
  // variantes deles).
  const toDelete = rows.filter((r) => !usedIds.has(r.id));
  if (toDelete.length > 0) {
    const ids = toDelete.map((r) => r.id);
    await supabase.from("modelo_tecido_variantes").delete().in("modelo_tecido_id", ids);
    await supabase.from("modelo_tecidos").delete().in("id", ids);
  }
}

// Colab round 4 (padrão do piloto/Desenvolvimento) — rótulos PT dos paths do Draft p/ o
// banner de resolução genérica de conflito. O merge compara TODAS as chaves do Draft; path
// sem rótulo cai no fallback (o próprio path) — nunca fica sem saída no banner.
const ROTULO_CONFLITO_PLAN: Record<string, string> = {
  nome: "Nome do Modelo", estilista_id: "Estilista", linha_id: "Linha",
  colecao: "Coleção", colecao_id: "Coleção", subcolecao: "Subcoleção", semana: "Semana de Lançamento",
  mes_id: "Mês de Planejamento", ano_id: "Ano",
  categoria_principal_id: "Categoria", subcategoria1_id: "Subcategoria 1", subcategoria2_id: "Subcategoria 2",
  origem: "Origem", preco_venda: "Preço para venda", preco_atacado: "Preço atacado", markup_editado: "Markup aplicado", data_lancamento: "Data de Lançamento",
  tecidos_planejados: "Tecido Planejado", status_planejamento: "Status",
  croqui_url: "Foto do Croqui", desenho_tecnico_url: "Desenho Técnico",
  fotos_modelo: "Fotos do modelo", fotos_referencia: "Fotos de referência",
  observacoes_gerais: "Observações Gerais", observacoes_mao_obra: "Obs. Mão de obra",
  versao: "Versão", modelo_base_id: "Modelo base", custo_simulado: "Simulação de custo",
};
function rotuloConflitoPlan(path: string): string {
  return ROTULO_CONFLITO_PLAN[path] ?? path;
}

// Normaliza a simulação de custo p/ salvar: só valores > 0; se tudo vazio → null.
// preco_tecido_m NÃO é gravado (é derivado do Tecido Planejado mais caro); consumo_tecido
// aqui é só o OVERRIDE manual (quando nulo, a tela usa o consumo real do BOM).
function limparCustoSim(s: CustoSimInput | null | undefined): CustoSimInput | null {
  const n = (v: any) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null; };
  const out: CustoSimInput = {
    consumo_tecido: n(s?.consumo_tecido),
    aviamento: n(s?.aviamento),
    mao_obra: n(s?.mao_obra),
  };
  return Object.values(out).some((v) => v != null) ? out : null;
}

// Seção colapsável do detalhe do card — expandida por default; estado local por seção
// (não persiste). Colapsar só esconde os filhos; o draft vive no diálogo, nada se perde.
// (O que abre COLAPSADO por default são os GRUPOS da lista — pedido do dono, ago/2026.)
function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
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
function CampoRO({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <div className="h-9 px-3 flex items-center rounded-md border bg-muted text-sm tabular-nums">{value}</div>
    </div>
  );
}

type EstoqueArtigo = { fisico_m: number; reservado_m: number; disponivel_m: number };
const fmtMetros = (n: number) => `${fmtNum(n)} m`;

function MultiArtigosField({ label, value, onChange, artigos, estoque }: {
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


export function FieldText({ label, value, onChange, colabPath, colabRing }: {
  label: string; value: string; onChange: (v: string) => void;
  // Colab (Task 2): presença por campo — ring sky quando um colega está focado aqui agora
  // (o ColabBanner genérico já cobre a resolução de qualquer conflito).
  colabPath?: string; colabRing?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-colab-path={colabPath}
        className={colabRing ? "ring-1 ring-sky-400" : undefined}
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
function PhotoList({ label, paths, onAdd, onRemove }: {
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
function SingleFileField({ label, path, onUpload, onRemove }: {
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

/* ============ DETALHE (Sheet/Dialog) ============ */

export function PlanejamentoDetail({
  modeloId, onClose, onSaved, contexto = "planejamento",
}: {
  modeloId: string | null;
  onClose: () => void;
  onSaved: () => void;
  contexto?: "planejamento" | "produto-acabado";
}) {
  // As 7 listas de opção vêm do hook (cache compartilhado com a página, sem refetch duplo).
  // `artigos` do hook traz a forma completa (com categoria_tecido_id/categorias_tecido, campos
  // que este detalhe não usa) — o antigo `ModeloDialog` recebia `ArtigoOpt[]` na prop, então
  // tratamos igual aqui (ArtigoOpt é subconjunto estrutural; cast preserva o comportamento).
  const { estilistas, linhas, meses, anos, grupos, categorias, artigos: artigosFull } = usePlanejamentoOpts();
  const artigos = artigosFull as ArtigoOpt[];

  const isEdit = !!modeloId;
  const qc = useQueryClient();
  const fl = useFieldLabels();
  const { canView, canEdit } = useAuth();
  const podeVerCustos = canView("criacao_planejamento:custos");
  const podeEditarCustos = canEdit("criacao_planejamento:custos");
  const podeAprovarMaoObra = canEdit("producao_servico_aprovacao");
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  // MO por serviço (spec 2026-08-06): rascunho LOCAL das linhas (VALOR editável) — fora do
  // `draft` principal; persiste no Salvar da página via RPC `salvar_modelo_servico_mo`. O
  // baseline (`moLinhasBase`) é o estado do servidor semeado do resumo; a divergência acende
  // o indicador de "não salvo". Refs p/ leitura síncrona (seed guardada + save mutationFn).
  const [moLinhas, setMoLinhas] = useState<MaoObraEditorLinha[]>([]);
  const [moLinhasBase, setMoLinhasBase] = useState<MaoObraEditorLinha[]>([]);
  const moLinhasRef = useRef(moLinhas); moLinhasRef.current = moLinhas;
  const moBaseRef = useRef(moLinhasBase); moBaseRef.current = moLinhasBase;
  // Grade cor×tamanho (revenda, Task 7) — declarado aqui (cedo) só o estado/refs, pra entrar
  // no `dirty` combinado abaixo; a query/efeito de seed e os handlers ficam mais abaixo, perto
  // do resto do cálculo de preço/produto vinculado (closures sobre o mesmo state, ordem de
  // hooks não muda entre renders).
  const [gradeRevenda, setGradeRevenda] = useState<Record<number, Record<string, number>>>({});
  const gradeRevendaSeededRef = useRef(false);
  const gradeRevendaBaseRef = useRef("{}");
  // Trava otimista da grade (fast-follow, fecha o last-write-wins do antigo delete+insert cru):
  // rev de `modelos` capturado no momento em que a grade foi LIDA do servidor (seed inicial OU
  // recarga após P0409) — INDEPENDENTE de `revRef` (o rev do header, que o retry dele mesmo já
  // resincroniza sozinho). O Salvar compara ESTE valor contra o rev atual dentro de
  // `salvar_grade_revenda` — se comparasse com `revRef.current`, um retry automático do header
  // (que não sabe nada de `gradeRevenda`) reenviaria a grade PARADA sem notar que ela ficou
  // desatualizada (ver comentário no `save` mutation).
  const gradeRevendaRevRef = useRef<number | null>(null);
  const { dirty: draftDirty, markClean, reset: resetDraftBaseline } = useDirtySnapshot(draft);
  // Dirty combinado: draft OU linhas de MO OU grade revenda divergem do baseline (mantidos em
  // baselines INDEPENDENTES — cada um re-semeia no seu próprio momento, sem corrida de ordem
  // entre os carregamentos assíncronos).
  const gradeRevendaDirty = gradeRevendaSeededRef.current && JSON.stringify(gradeRevenda) !== gradeRevendaBaseRef.current;
  const dirty = draftDirty || !moLinhasEqual(moLinhas, moLinhasBase) || gradeRevendaDirty;
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose });
  // Grupo é transiente (não é coluna do modelo) — filtra as Categorias na cascata.
  const [grupoSel, setGrupoSel] = useState<string | null>(null);

  // Colab (spec 2026-08-03, Task 2 — adoção Plan. Produto; mesmo padrão do piloto OC Tecido
  // e da adoção do Desenvolvimento). Contrato desta tela: UPDATE DIRETO em `modelos` com
  // `.eq("rev", revBase)` — 0 linhas devolvidas = conflito (P0409 sintético).
  // touchedRef: campos ESCALARES do draft que EU editei (diff via setDraftTracked).
  // baseRef/revRef: último "fresh" visto do servidor e o rev otimista da linha.
  const touchedRef = useRef<Set<string>>(new Set());
  const baseRef = useRef<{ draft: Draft } | null>(null);
  const revRef = useRef<number | null>(null);
  const retryRef = useRef(false);
  // Guarda anti-duplo-clique do save — ref SÍNCRONO (isPending só atualiza no re-render).
  const savingRef = useRef(false);
  const [conflitos, setConflitos] = useState<Conflito[]>([]);
  // Espelho síncrono de `conflitos` p/ o retry do save (roda fora do ciclo de render).
  const conflitosRef = useRef<Conflito[]>([]);
  const [ultimoMerge, setUltimoMerge] = useState<{ atualizados: number; conflitos: Conflito[] } | null>(null);
  const [campoFocado, setCampoFocado] = useState<string | null>(null);
  // Espelho SEMPRE atualizado de `draft` p/ o merge síncrono dentro do onError do save (roda
  // depois de um `await` — nenhuma tecla digitada nessa janela pode se perder; mesma técnica
  // do piloto/Desenvolvimento).
  const draftLiveRef = useRef(draft);
  draftLiveRef.current = draft;

  // Wrapper que DIFERE prev→next e marca o que mudou — os filhos continuam recebendo a mesma
  // assinatura de `setDraft` (mesma técnica do piloto OC Tecido/Desenvolvimento).
  const setDraftTracked: typeof setDraft = (upd) =>
    setDraft((prev) => {
      const next = typeof upd === "function" ? (upd as (p: Draft) => Draft)(prev) : upd;
      for (const k of Object.keys(next) as (keyof Draft)[])
        if (next[k] !== prev[k]) touchedRef.current.add(String(k));
      return next;
    });
  const [confirmDel, setConfirmDel] = useState(false);
  const { isModuleEnabled } = useTenantModules();
  const otbOn = isModuleEnabled("otb");
  // Revenda (Produto Acabado, Task 7): card revenda ganha campo de preço atacado + grade
  // cor×tamanho + atalhos pro planejador Produto Acabado — só quando o módulo está ligado.
  const paOn = isModuleEnabled("produto_acabado");
  const isRevenda = draft.origem === "revenda";
  const navigate = useNavigate();
  const orc = useOrcamento();
  const { data: colecoes = [] } = useQuery({
    queryKey: ["otb-colecoes-opts"],
    enabled: otbOn,
    queryFn: async () => {
      const { data } = await supabase.from("colecoes").select("id, nome, mes_id, ano_id").order("nome");
      return (data ?? []) as { id: string; nome: string; mes_id: string | null; ano_id: string | null }[];
    },
  });
  // Subcoleções da coleção escolhida — viram o dropdown de Subcoleção (OTB ligado).
  const { data: subcolecoesOpts = [] } = useQuery({
    queryKey: ["subcolecoes-opts", draft.colecao_id],
    enabled: otbOn && !!draft.colecao_id,
    queryFn: async () => {
      const { data } = await supabase.from("colecao_subcolecoes").select("nome").eq("colecao_id", draft.colecao_id!).order("ordem");
      return (data ?? []).map((r: any) => r.nome as string);
    },
  });

  // Estoque por artigo (físico/disponível) para mostrar ao selecionar o tecido.
  const { data: estoqueArr = [] } = useQuery({
    queryKey: ["estoque-tecido-por-artigo"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("estoque_tecido_por_artigo" as any);
      if (error) throw error;
      return (data ?? []) as Array<{ artigo_id: string; fisico_m: number; reservado_m: number; disponivel_m: number }>;
    },
  });
  const estoqueMap = useMemo(
    () => Object.fromEntries(estoqueArr.map((e) => [e.artigo_id, e])),
    [estoqueArr],
  ) as Record<string, EstoqueArtigo>;

  // Subcategorias 1 e 2 (filhas da Categoria) — Setor "Informações Gerais".
  const { data: sub1Opts = [] } = useQuery({
    queryKey: ["opt", "subcategorias1_produto"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subcategorias1_produto").select("id, nome, categoria_id").order("nome");
      if (error) throw error;
      return (data ?? []) as SubOpt[];
    },
  });
  const { data: sub2Opts = [] } = useQuery({
    queryKey: ["opt", "subcategorias2_produto"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subcategorias2_produto").select("id, nome, categoria_id").order("nome");
      if (error) throw error;
      return (data ?? []) as SubOpt[];
    },
  });

  // Custo total unitário do modelo (real de Serviços senão previsto de Desenvolvimento).
  const { data: custoData } = useQuery({
    queryKey: ["plan-custo-unit", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("custo_unitario_modelos" as any, { _ids: [modeloId] });
      if (error) throw error;
      return ((data ?? {}) as any)[modeloId as string] as { previsto: number; real: number; confirmado: boolean } | undefined;
    },
  });

  // Categorias de serviço ATIVAS — dropdown "Adicionar serviço" do editor de MO (linhas
  // históricas de categoria já desativada seguem visíveis como linhas, mas não no dropdown).
  const { data: catsServico = [] } = useQuery({
    queryKey: ["cats-servico-ativas"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("categorias_terceirizado") as any)
        .select("id, nome, ativo").order("ordem").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; ativo: boolean }[];
    },
  });
  // Resumo da MO por serviço (RPC mascara valor/total p/ quem não vê custos; {} p/ quem não vê
  // nem aprova). Semeia `moLinhas` (VALORES + estado por linha) e o gate do botão Lançar.
  const { data: moResumo } = useQuery({
    queryKey: ["mo-resumo", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      if (!modeloId) return null;
      const { data, error } = await supabase.rpc("modelo_mo_resumo" as any, { _ids: [modeloId] });
      if (error) throw error;
      return ((data as any)?.[modeloId] ?? null) as
        { estado: string; total: number | null; total_aprovado: number | null; linhas: (MoLinha & { valor: number | null })[] } | null;
    },
  });

  // Consumo real do BOM (Desenvolvimento/CAD) por artigo — alimenta o pré-preenchimento
  // do consumo na Simulação de custo quando o modelo já avançou.
  const { data: bomTecidos = [] } = useQuery({
    queryKey: ["modelo-tecidos-consumo", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_tecidos")
        .select("artigo_id, consumo")
        .eq("modelo_id", modeloId as string)
        .eq("tipo", "tecido");
      if (error) throw error;
      return (data ?? []) as { artigo_id: string | null; consumo: number | null }[];
    },
  });

  // Cálculo de preço (Setor "Preço") — mesma lógica usada na lista e nos Lançamentos.
  const custoReal = !!custoData?.confirmado;
  const { custo, markupLinha: markup, markupAplicado, preco, sugerido: precoSug, markupReal } =
    precoInfo(custoData?.real, linhas.find((l) => l.id === draft.linha_id)?.markup, draft.preco_venda, draft.markup_editado);

  // Composição do custo (materiais + mão de obra) p/ o InfoStrip §K do setor Preço, no ramo
  // MANUFATURADO. Mesma régua do card da lista: materiais = custo total − mão de obra. A MO
  // acompanha a base do total (real quando o custo confirma, previsto senão) pra a soma sempre
  // fechar com `custo` (`.real` do RPC = real-quando-confirmado, senão custo_peca_previsto).
  const maoObraSetor = Number(custoReal ? (custoData as any)?.mao_obra_real : (custoData as any)?.mao_obra_previsto) || 0;
  const materiaisSetor = custo > 0 ? custo - maoObraSetor : 0;
  const linhaNomeSetor = linhas.find((l) => l.id === draft.linha_id)?.nome ?? null;

  // Preço ATACADO (revenda, Task 7): mesma função `precoInfo` (intocada), mas com a base
  // sempre em "previsto" — o custo_unitario_modelos.previsto já traz insumos+desconto p/
  // revenda (Task 4) e fica disponível MESMO antes da OC ser recebida (ao contrário de
  // `.real`, que fica null até `oc.status='recebido'` — ver _custo_unitario_modelos_core).
  const custoPrevistoRevenda = Number(custoData?.previsto) || 0;

  // Produto Acabado vinculado a este modelo (revenda, Task 7) — embed REVERSO
  // (`produtos_acabados.modelo_id`): rótulo de variante "cor · apelido" (mesmo padrão do
  // planejador Produto Acabado, Task 6) + grade_proporcao (tamanhos ativos) + grupo (p/
  // `ehGrupoAcessorio`, grade em coluna única "UN").
  const { data: produtoRevenda, isLoading: produtoRevendaLoading } = useQuery({
    queryKey: ["pa-produto-modelo", modeloId],
    enabled: isEdit && !!modeloId && isRevenda && paOn,
    queryFn: async () => {
      const { data, error } = await (supabase.from("produtos_acabados" as any) as any)
        .select("id, colecao_id, categoria_id, grupo_id, grade_proporcao, markup_atacado, markup_varejo, variantes:produto_acabado_variantes(ordem, cor:cor_id(nome), apelido:cor_apelido_id(nome))")
        .eq("modelo_id", modeloId)
        .maybeSingle();
      if (error) throw error;
      return data as {
        id: string; colecao_id: string | null; categoria_id: string | null; grupo_id: string | null;
        grade_proporcao: Record<string, number>;
        markup_atacado: number | null; markup_varejo: number | null;
        variantes: { ordem: number; cor: { nome: string | null } | null; apelido: { nome: string | null } | null }[];
      } | null;
    },
  });
  // Markups digitáveis (item 3 do refino, ago/2026) — mesma fonte de `ProdutoCard.tsx`
  // (`produtos_acabados.markup_atacado`/`markup_varejo`), bidirecional: editar aqui reflete
  // lá e vice-versa. Rascunho LOCAL próprio (fora do `draft`/dirty-guard do modelo — vive
  // numa tabela diferente) persistido por uma RPC pequena e dedicada
  // (`salvar_markups_produto_acabado`) que grava SÓ os 2 markups, sem o risco de um payload
  // parcial de `salvar_produto_acabado` apagar o resto do produto (grupo/categoria/
  // fornecedor/variantes não seriam coalescidos com o valor atual). Seed 1× por abertura do
  // card, mesmo padrão de `gradeRevendaSeededRef` acima.
  const [markupAtacadoInput, setMarkupAtacadoInput] = useState<number | null>(null);
  const [markupVarejoInput, setMarkupVarejoInput] = useState<number | null>(null);
  const markupRevendaSeededRef = useRef(false);
  useEffect(() => {
    if (!produtoRevenda || markupRevendaSeededRef.current) return;
    setMarkupAtacadoInput(produtoRevenda.markup_atacado);
    setMarkupVarejoInput(produtoRevenda.markup_varejo);
    markupRevendaSeededRef.current = true;
  }, [produtoRevenda]);
  const salvarMarkupsRevenda = useMutation({
    mutationFn: async (payload: { markup_atacado: number | null; markup_varejo: number | null }) => {
      if (!produtoRevenda) return;
      const { error } = await supabase.rpc("salvar_markups_produto_acabado" as any, {
        _produto_id: produtoRevenda.id,
        _markup_atacado: payload.markup_atacado,
        _markup_varejo: payload.markup_varejo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      // `modelos.preco_atacado`/`preco_venda` mudaram no servidor (recompute) — refetch
      // ["modelo", modeloId] pra o rev otimista do colab não ficar defasado (mesmo cuidado
      // de `invalidarAposAprovarMO`: sem isto, o próximo "Salvar" do card comparava um rev
      // velho e dava P0409 falso). Também atualiza o planejador Produto Acabado e a lista.
      qc.invalidateQueries({ queryKey: ["modelo", modeloId] });
      qc.invalidateQueries({ queryKey: ["pa-produto-modelo", modeloId] });
      qc.invalidateQueries({ queryKey: ["produtos-acabados"] });
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar o markup.")),
  });
  // Custo total da peça (mesmo `custoPrevistoRevenda` acima — já traz valor unitário com
  // desconto + insumos, ver ramo revenda de `_custo_unitario_modelos_core`) ×
  // markup_atacado = PREÇO ATACADO; preço atacado × markup_varejo = PREÇO VAREJO. Espelha a
  // MESMA fórmula/arredondamento do servidor (`_pa_recomputar_precos_modelo`) pra preview AO
  // VIVO — "Preço para venda"/"Preço atacado" no render abaixo mostram isto, não mais
  // `draft.preco_atacado`/`preco_venda` (que viraram read-only, atualizados pelo servidor).
  const arred2Revenda = (v: number) => Math.round(v * 100) / 100;
  const precoAtacadoRevendaLive = markupAtacadoInput ? arred2Revenda(custoPrevistoRevenda * markupAtacadoInput) : null;
  const precoVarejoRevendaLive = precoAtacadoRevendaLive != null && markupVarejoInput ? arred2Revenda(precoAtacadoRevendaLive * markupVarejoInput) : null;
  const grupoRevendaNome = grupos.find((g) => g.id === produtoRevenda?.grupo_id)?.nome ?? null;
  const acessorioRevenda = ehGrupoAcessorio(grupoRevendaNome);
  // Tamanhos ativos do tenant (ordem canônica) — mesma fonte/fallback do planejador
  // Produto Acabado (Task 6); colunas da grade = interseção com `grade_proporcao`.
  const tenantIdAtivo = useActiveTenantId();
  const { data: tenantTamanhosRevenda = DEFAULT_TAMANHOS } = useQuery({
    queryKey: ["tenant-config-tamanhos-planejamento", tenantIdAtivo],
    enabled: !!tenantIdAtivo && isRevenda && paOn,
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("tamanhos_grade").eq("tenant_id", tenantIdAtivo).maybeSingle();
      const raw = (data as any)?.tamanhos_grade;
      return Array.isArray(raw) && raw.length > 0 ? raw.map(String) : DEFAULT_TAMANHOS;
    },
  });
  const variantesRevenda = useMemo(
    () => [...(produtoRevenda?.variantes ?? [])].sort((a, b) => a.ordem - b.ordem),
    [produtoRevenda],
  );
  const tamanhosRevenda = useMemo(() => {
    if (acessorioRevenda) return ["UN"];
    const prop = produtoRevenda?.grade_proporcao ?? {};
    return tenantTamanhosRevenda.filter((t) => Object.prototype.hasOwnProperty.call(prop, t));
  }, [acessorioRevenda, produtoRevenda, tenantTamanhosRevenda]);

  // Grade cor×tamanho (revenda, Task 7) — lê/grava `modelo_grades` (variante_numero=ordem).
  // Estado/refs já declarados mais acima (perto do `dirty` combinado); aqui só a query de
  // leitura + o efeito de seed (1× por abertura do card — o Dialog nasce/some por inteiro a
  // cada abrir/fechar, ver render do pai — então nunca perde edição de um refetch em BG).
  const { data: gradeModeloRows } = useQuery({
    queryKey: ["modelo-grades-revenda", modeloId],
    enabled: isEdit && !!modeloId && isRevenda && paOn,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_grades")
        .select("variante_numero, grades, grade_total")
        .eq("modelo_id", modeloId as string);
      if (error) throw error;
      return (data ?? []) as { variante_numero: number; grades: Record<string, number> | null; grade_total: number }[];
    },
  });
  useEffect(() => {
    if (!gradeModeloRows || gradeRevendaSeededRef.current) return;
    const seeded: Record<number, Record<string, number>> = {};
    for (const r of gradeModeloRows) seeded[r.variante_numero] = { ...(r.grades ?? {}) };
    setGradeRevenda(seeded);
    gradeRevendaBaseRef.current = JSON.stringify(seeded);
    // Best-effort: `revRef` já deve estar semeado a essa altura (a query de `modelo` carrega
    // em paralelo, sem dependência entre as duas) — se ainda estiver null (corrida rara), o
    // 1º Salvar cai no bypass (`_rev_base: null`); qualquer conflito de verdade continua pego
    // pelo retry do header, que dispara a recarga da grade via `gradeConflict`.
    gradeRevendaRevRef.current = revRef.current;
    gradeRevendaSeededRef.current = true;
  }, [gradeModeloRows]);
  const setCelulaGradeRevenda = (ordem: number, tam: string, v: number) =>
    setGradeRevenda((prev) => ({ ...prev, [ordem]: { ...(prev[ordem] ?? {}), [tam]: Math.max(0, Math.trunc(v) || 0) } }));
  const totalLinhaRevenda = (ordem: number) =>
    Object.values(gradeRevenda[ordem] ?? {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const totalColunaRevenda = (tam: string) =>
    variantesRevenda.reduce((s, v) => s + (Number(gradeRevenda[v.ordem]?.[tam]) || 0), 0);
  const totalGeralRevenda = variantesRevenda.reduce((s, v) => s + totalLinhaRevenda(v.ordem), 0);
  // Payload da grade p/ `salvar_grade_revenda` — estado COMPLETO (linha ausente = apagada no
  // servidor); usado nos dois pontos de chamada (edição e criação) do `save` mutation abaixo.
  const buildLinhasGradeRevenda = () =>
    Object.entries(gradeRevenda).map(([ordem, grades]) => ({
      variante_numero: Number(ordem),
      grades,
      grade_total: Object.values(grades).reduce((s, v) => s + (Number(v) || 0), 0),
    }));

  // "criar produto acabado" (revenda sem produto vinculado, Task 7): INSERT em
  // produtos_acabados herdando identidade do modelo (grupo derivado de
  // categorias_produto.grupo_id — `modelos` não tem grupo_id próprio) + vincula
  // `modelo_id` (mesma RPC de escrita usada pelo planejador Produto Acabado, com o
  // module-gate/REF automática — só a coluna modelo_id é ajustada depois, direto na
  // tabela: não existe RPC pronta pra esse sentido produto←modelo, só modelo←produto
  // via `criar_card_produto_acabado`, Task 2).
  const criarProdutoAcabado = useMutation({
    mutationFn: async () => {
      if (!modeloId) throw erroValidacao("Salve o modelo antes de criar o produto acabado.");
      const cat = categorias.find((c) => c.id === draft.categoria_principal_id);
      const grupoId = cat?.grupo_id ?? null;
      if (!grupoId || !draft.categoria_principal_id) {
        throw erroValidacao("Defina Grupo e Categoria (setor Informações Gerais) antes de criar o produto acabado.");
      }
      const dados = {
        nome: draft.nome,
        grupo_id: grupoId,
        categoria_id: draft.categoria_principal_id,
        subcategoria1_id: draft.subcategoria1_id,
        subcategoria2_id: draft.subcategoria2_id,
        colecao_id: draft.colecao_id,
        subcolecao: draft.subcolecao || null,
        semana: draft.semana || null,
      };
      const { data: novoId, error } = await supabase.rpc("salvar_produto_acabado" as any, {
        _id: null, _dados: dados, _variantes: [],
      });
      if (error) throw error;
      const { error: linkErr } = await (supabase.from("produtos_acabados" as any) as any)
        .update({ modelo_id: modeloId }).eq("id", novoId);
      if (linkErr) throw linkErr;
      return { produtoId: novoId as string, colecaoId: draft.colecao_id };
    },
    onSuccess: ({ colecaoId }) => {
      toast.success("Produto acabado criado e vinculado.");
      qc.invalidateQueries({ queryKey: ["pa-produto-modelo", modeloId] });
      // No contexto "produto-acabado" o detalhe já está aberto DENTRO do planejador Produto
      // Acabado — navegar levaria pra tela onde já se está; em vez disso fecha o sheet e deixa
      // o container recarregar os cards via onSaved/invalidate. Em "planejamento" segue
      // navegando pro planejador (comportamento original).
      if (contexto === "produto-acabado") {
        onClose();
      } else {
        navigate({ to: "/criacao/produto-acabado", search: colecaoId ? ({ colecao: colecaoId } as any) : ({} as any) });
      }
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Não foi possível criar o produto acabado.")),
  });

  // Simulação de custo (isolada do real). Tecido: preço/m = o TECIDO PLANEJADO MAIS CARO
  // (auto do cadastro); consumo = override do usuário, senão o consumo REAL do BOM (editável).
  // Aviamento e mão de obra são manuais. Custo estimado × markup da linha → preço estimado.
  const tecidoMaisCaro = draft.tecidos_planejados
    .map((id) => artigos.find((a) => a.id === id))
    .filter((a): a is ArtigoOpt => !!a)
    .reduce<ArtigoOpt | null>((best, a) => ((Number(a.preco_por_metro) || 0) > (Number(best?.preco_por_metro) || 0) ? a : best), null);
  const precoTecidoM = Number(tecidoMaisCaro?.preco_por_metro) || 0;
  const consumoRealBOM = tecidoMaisCaro
    ? Number(bomTecidos.find((t) => t.artigo_id === tecidoMaisCaro.id)?.consumo) || 0
    : 0;
  const consumoOverride = draft.custo_simulado.consumo_tecido ?? null;
  const consumoUsado = consumoOverride ?? consumoRealBOM;
  // Mão de obra: agora é Σ das linhas de MO por serviço (via `custo_unitario_modelos.
  // mao_obra_previsto`, repontado na Task 3). Só LEITURA na Simulação — o override manual
  // (`custo_simulado.mao_obra`) ficou inerte (spec §5); o campo virou read-only.
  const maoObraDev = Number((custoData as any)?.mao_obra_previsto) || 0;
  const maoObraUsado = maoObraDev > 0 ? maoObraDev : null;
  const simCalc = custoSimulado({
    consumo_tecido: consumoUsado,
    preco_tecido_m: precoTecidoM,
    aviamento: draft.custo_simulado.aviamento,
    mao_obra: maoObraUsado,
  });
  const piSim = precoInfo(simCalc.total, markup, null, draft.markup_editado);
  const setSim = (patch: Partial<CustoSimInput>) =>
    setDraftTracked((d) => ({ ...d, custo_simulado: { ...d.custo_simulado, ...patch } }));

  // Preço para venda é PLACEHOLDER (mostra o sugerido); só vira valor real se o usuário
  // digitar. Não auto-preenche o draft (isso causava o flip-flop preenchido↔placeholder).
  // O preço efetivo já cai no sugerido via precoInfo quando o campo está vazio.

  // "Ordem de Criação enviada" = gate p/ o Desenvolvimento (botão, não mais o status).
  const [enviada, setEnviada] = useState(false);
  // "Lançado" = gate p/ Lançamentos (botão, após CAD + CQ confirmado).
  const [lancado, setLancado] = useState(false);

  // CAD + status do CQ do modelo — habilita a Data de Lançamento / botão Lançar.
  const { data: cqInfo } = useQuery({
    queryKey: ["plan-cq", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cad")
        .select("id, controle_qualidade(status, status_pos), producao_terceirizados(ativo, categorias_terceirizado(etapa))")
        .eq("modelo_id", modeloId!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  // Lançar exige Pré confirmado E (se há serviço pós-costura) Pós confirmado — mesmo
  // gate do Direcionamento (predicado único em @/lib/cq-status).
  const cqConfirmado = cqLiberado(cqInfo as any);

  // MO por serviço (spec 2026-08-06): semeia `moLinhas` do resumo do servidor. GUARDADA — se o
  // usuário tem edições locais de VALOR não salvas (moLinhas ≠ moLinhasBase), um refetch em
  // background (foco de janela / invalidação pós-aprovação) NÃO sobrescreve o rascunho; só
  // (re)semeia quando o rascunho de MO está limpo. Mesma proteção do merge do draft colab.
  useEffect(() => {
    if (!moResumo) return;
    const seed = (moResumo.linhas ?? []).map((l) => ({
      categoria_terceirizado_id: l.categoria_terceirizado_id ?? null,
      nome: l.nome, valor: l.valor ?? null, aprovado: l.aprovado ?? null, motivo_reprovacao: l.motivo_reprovacao ?? null,
    })) as MaoObraEditorLinha[];
    if (!moLinhasEqual(moLinhasRef.current, moBaseRef.current)) return; // preserva edições não salvas
    setMoLinhas(seed); setMoLinhasBase(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moResumo]);

  // Gate do botão Lançar: liberada = sem serviço OU todas as linhas aprovadas. Derivado das
  // linhas LOCAIS (`estadoMO`) — reflete aprovações imediatas sem esperar o refetch do resumo.
  const moEstadoLocal = estadoMO(moLinhas);
  const maoObraPendente = !(moEstadoLocal === "sem_servico" || moEstadoLocal === "aprovada");

  // Aprovar/reprovar POR SERVIÇO (RPC `aprovar_servico_mo`, gated no servidor por
  // `producao_servico_aprovacao`). Ação imediata (não entra no Salvar da página). Patch LOCAL
  // das linhas (preserva os VALORES não salvos; atualiza aprovado/motivo) + re-sync da rev do
  // colab (o rollup no banco bumpa `modelos.rev` — sem re-hidratar `revRef`, o próximo Salvar
  // do card daria P0409 falso).
  const aprovarServicoMO = useMutation({
    mutationFn: async ({ categoriaId, aprovado, motivo }: { categoriaId: string | null; aprovado: boolean; motivo?: string }) => {
      const { error } = await supabase.rpc("aprovar_servico_mo" as any, {
        _modelo_id: modeloId, _categoria_terceirizado_id: categoriaId, _aprovado: aprovado, _motivo: motivo ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.aprovado ? "Mão de obra aprovada." : "Mão de obra reprovada.");
      const patch = (ls: MaoObraEditorLinha[]) => ls.map((l) =>
        l.categoria_terceirizado_id === vars.categoriaId
          ? { ...l, aprovado: vars.aprovado, motivo_reprovacao: vars.aprovado ? null : (vars.motivo ?? null) }
          : l);
      setMoLinhas(patch); setMoLinhasBase(patch);
      // Invalidations compartilhadas c/ a mutation da lista (`aprovarServicoMOLista`, spec
      // 2026-08-11 Task 2) — mesma função, não duplicar a lista de queryKeys.
      invalidarAposAprovarMO(qc, modeloId!);
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Não foi possível atualizar a mão de obra.")),
  });

  // Colab (spec 2026-08-03, Task 2): o queryFn agora só BUSCA (sem side-effects de setState —
  // roda em TODO refetch, não só na 1ª carga). Seed/merge acontecem no useEffect abaixo.
  const { data: modeloData } = useQuery({
    queryKey: ["modelo", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      if (!modeloId) return null;
      const { data, error } = await supabase.from("modelos").select("*").eq("id", modeloId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Colab (spec 2026-08-03, Task 2): 1ª carga semeia como sempre; refetch (Realtime/foco de
  // janela invalidando ["modelo", modeloId]) faz MERGE 3-vias em vez de sobrescrever o
  // rascunho às cegas — mesmo padrão do piloto OC Tecido / adoção do Desenvolvimento.
  useEffect(() => {
    if (!modeloData) return;
    const freshDraft = draftFromModeloRow(modeloData);
    const freshRev = (modeloData as any).rev ?? null;

    if (!baseRef.current) {
      // 1ª carga: seed normal (mesmo comportamento de antes do piloto).
      baseRef.current = { draft: freshDraft };
      revRef.current = freshRev;
      setDraft(freshDraft);
      resetDraftBaseline(freshDraft);
      // Pré-seleciona o Grupo da categoria carregada (deriva de categorias_produto.grupo_id).
      setGrupoSel(categorias.find((c) => c.id === (modeloData as any).categoria_principal_id)?.grupo_id ?? null);
      setEnviada(!!(modeloData as any).ordem_criacao_enviada);
      setLancado(!!(modeloData as any).lancado);
      touchedRef.current = new Set();
      conflitosRef.current = [];
      setConflitos([]);
      return;
    }

    // Rev igual ao último que processei = nada aconteceu desde então (refetch duplicado/foco
    // de janela sem UPDATE real) — no-op, nem olha o draft.
    if (freshRev === revRef.current) return;

    // `ordem_criacao_enviada`/`lancado` são geridos por mutations PRÓPRIAS (`enviar`/`lancar`,
    // classe b — ver comentário nelas) fora do touched/merge do Draft; sempre adotam o valor do
    // servidor (idempotente, sem conflito a resolver aqui).
    setEnviada(!!(modeloData as any).ordem_criacao_enviada);
    setLancado(!!(modeloData as any).lancado);

    const md = mergeDraft({ base: baseRef.current.draft, draft, fresh: freshDraft, touched: touchedRef.current });
    const draftMudou = md.atualizados.length > 0 || md.conflitos.length > 0;
    baseRef.current = { draft: freshDraft };
    revRef.current = freshRev;

    // ⚠️ Um save do OUTRO USUÁRIO pode disparar mais de 1 evento UPDATE em sequência; passadas
    // SEGUINTES à que achou o conflito comparam `base` (já avançado) com o MESMO `fresh` → 0
    // diffs nessa passada (`draftMudou=false`) — NÃO sobrescreve `conflitos`/`ultimoMerge` aqui
    // (senão apagaria em silêncio um conflito real ainda não resolvido pelo usuário; mesmo
    // guard `semResultado` do piloto).
    if (!draftMudou) return;

    setDraft(md.valor);
    conflitosRef.current = md.conflitos;
    setConflitos(md.conflitos);
    setUltimoMerge({ atualizados: md.atualizados.length, conflitos: md.conflitos });
    // Categoria pode ter sido adotada em silêncio (não tocada) ou mantida "minha" (conflito) —
    // `md.valor` já reflete a decisão certa; recomputa o Grupo (filtro transiente) a partir dela.
    if (md.valor.categoria_principal_id !== draft.categoria_principal_id) {
      setGrupoSel(categorias.find((c) => c.id === md.valor.categoria_principal_id)?.grupo_id ?? null);
    }
    // Nada tocado pelo usuário: seguro re-baselinar o guarda de "não salvo" (o draft inteiro
    // acabou de virar o estado do servidor, então não há nada "não salvo" de verdade) — sem
    // isso, um espectador que não editou nada veria "alterações não salvas" por um merge
    // silencioso. Com algo tocado, NÃO re-baseliza (o indicador precisa continuar apontando
    // que ainda falta Salvar).
    if (touchedRef.current.size === 0) resetDraftBaseline(md.valor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeloData]);

  const uploadMutation = useMutation({
    mutationFn: async ({ file, key }: { file: File; key: "fotos_modelo" | "fotos_referencia" }) => {
      const path = await uploadFile(file, key);
      return { path, key };
    },
    onSuccess: ({ path, key }) => setDraftTracked((d) => ({ ...d, [key]: [...d[key], path] })),
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  const uploadDesenho = useMutation({
    mutationFn: async (file: File) => uploadFile(file, "desenho_tecnico"),
    onSuccess: (path) => setDraftTracked((d) => ({ ...d, desenho_tecnico_url: path })),
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  const uploadCroqui = useMutation({
    mutationFn: async (file: File) => uploadFile(file, "croqui"),
    onSuccess: (path) => setDraftTracked((d) => ({ ...d, croqui_url: path })),
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  const save = useMutation({
    mutationFn: async () => {
      // Colab (Task 2): com conflitos pendentes na tela, o save NÃO pode passar — mesmo que
      // o rev já bata, o usuário precisa resolver ("manter meu"/"usar o novo") primeiro. Mesmo
      // guard do piloto OC Tecido/Desenvolvimento (sem isto, um 2º clique sobrescreveria a
      // versão da outra pessoa em silêncio).
      if (conflitosRef.current.length > 0)
        throw new Error("Resolva os conflitos listados no aviso no topo antes de salvar.");
      const payload: any = {
        ...draft,
        croqui_url: draft.croqui_url || null,
        desenho_tecnico_url: draft.desenho_tecnico_url || null,
        data_lancamento: draft.data_lancamento || null,
        observacoes_mao_obra: draft.observacoes_mao_obra || null,
        custo_simulado: limparCustoSim(draft.custo_simulado),
      };
      // Item 3 do refino (ago/2026): pra revenda, preco_venda/preco_atacado viraram
      // DERIVADOS (markup × custo) — recomputados e persistidos pelo servidor a cada save de
      // markup/OC (`_pa_recomputar_precos_modelo`), nunca mais digitados aqui. NÃO reenviar
      // esses 2 campos no payload deste save: `draft.preco_venda`/`preco_atacado` (herdados
      // do `...draft` acima, spread do que foi carregado ao abrir o card) podem já estar
      // DESATUALIZADOS em relação ao que o servidor recomputou depois — um Salvar disparado
      // por outro campo (ex.: nome) sobrescreveria silenciosamente o preço fresco com o valor
      // velho. MANUFATURADOS seguem mandando o valor digitado, como sempre.
      if (isRevenda) {
        delete payload.preco_venda;
        delete payload.preco_atacado;
      } else {
        payload.preco_venda = numOr0(draft.preco_venda) > 0 ? numOr0(draft.preco_venda) : null;
        payload.preco_atacado = numOr0(draft.preco_atacado) > 0 ? numOr0(draft.preco_atacado) : null;
      }
      let savedId: string | null = isEdit ? modeloId : null;
      if (isEdit && modeloId) {
        // Grade cor×tamanho (revenda, fast-follow — fecha o last-write-wins do antigo
        // delete+insert cru): grava ANTES do UPDATE do header, com `_rev_base` PRÓPRIO
        // (`gradeRevendaRevRef`, independente de `revRef`) via RPC `salvar_grade_revenda`
        // (rev-check no molde do `salvar_modelo_bom` + delete+insert atômico no servidor).
        // Tem que rodar ANTES do header: a escrita em `modelo_grades` já bumpa `modelos.rev`
        // sozinha (trigger `trg_colab_bump`, infra 2026-08-03) — se corresse DEPOIS do UPDATE
        // do header, o bump do PRÓPRIO header já teria avançado o rev e a checagem da grade
        // daria P0409 falso em TODO save. Conflito de grade é tratado por RECARGA (sem merge,
        // `gradeConflict` marcado no erro, tratado à parte no onError) — não pelo retry do
        // header abaixo, que só sabe mesclar campos escalares do draft e nunca soube de
        // `gradeRevenda`; se caísse nesse retry, reenviaria a grade PARADA sem detectar que
        // ficou desatualizada.
        let revParaHeader = revRef.current;
        if (isRevenda && gradeRevendaDirty) {
          const { error: gradeErr } = await supabase.rpc("salvar_grade_revenda" as any, {
            _modelo_id: modeloId,
            _grades: buildLinhasGradeRevenda(),
            _rev_base: gradeRevendaRevRef.current,
          });
          if (gradeErr) {
            if ((gradeErr as any).code === "P0409") (gradeErr as any).gradeConflict = true;
            throw gradeErr;
          }
          // A grade já gravou (e já bumpou modelos.rev sozinha) — recarrega o rev atual antes
          // do UPDATE do header logo abaixo, senão ele veria o PRÓPRIO bump da grade como
          // conflito (ver comentário acima).
          const { data: revRow, error: revErr } = await (supabase.from("modelos") as any)
            .select("rev").eq("id", modeloId).single();
          if (revErr) throw revErr;
          revParaHeader = (revRow as any).rev;
          // A grade gravada é agora a verdade do servidor — zera o "não salvo" dela já aqui
          // (não só no onSuccess do save inteiro): se o UPDATE do header logo abaixo falhar
          // (P0409 do header, causa separada), um retry automático não pode tentar regravar a
          // MESMA grade com um `_rev_base` velho.
          gradeRevendaRevRef.current = revParaHeader;
          gradeRevendaBaseRef.current = JSON.stringify(gradeRevenda);
        }
        // Colab (Task 2) — contrato desta tela (spec 2026-08-03): UPDATE DIRETO com
        // `.eq("rev", revParaHeader)` — só casa a linha se ninguém salvou desde a última
        // carga; 0 linhas devolvidas = conflito (mesma UX do P0409 do piloto: merge síncrono +
        // retry 1×). `syncTecidosToDesenvolvimento` roda DEPOIS (várias escritas na tabela
        // filha `modelo_tecidos`, sem RPC composta aqui) — não precisa de trava própria: o
        // UPDATE acima já bumpou `modelos.rev` (trigger), protegendo a sequência (mesma janela
        // estreita aceita/documentada na adoção do Desenvolvimento). `as any` no builder: o
        // types.ts ainda não tem a coluna `rev` (regen pendente — ver CLAUDE.md).
        const { data: updRows, error } = await (supabase.from("modelos") as any)
          .update(payload).eq("id", modeloId).eq("rev", revParaHeader).select("id");
        if (error) throw error;
        if (!updRows || updRows.length === 0) {
          const conflito: any = new Error("conflito_versao: o registro foi salvo por outra pessoa");
          conflito.code = "P0409";
          throw conflito;
        }
        await syncTecidosToDesenvolvimento(modeloId, draft.tecidos_planejados);
      } else {
        // Card novo: sem concorrência possível (linha ainda não existe) — insert direto.
        const { data: inserted, error } = await supabase.from("modelos").insert(payload).select("id").single();
        if (error) throw error;
        savedId = inserted?.id ?? null;
        if (savedId) await syncTecidosToDesenvolvimento(savedId, draft.tecidos_planejados);
        // Grade cor×tamanho: hoje inatingível na criação (só aparece depois de o Produto
        // Acabado vinculado existir, o que exige o modelo já salvo) — mantido por
        // uniformidade/robustez futura, mesma RPC. Linha nova = sem concorrência possível,
        // `_rev_base: null` (bypass), igual ao resto do fluxo de criação acima.
        if (isRevenda && savedId && gradeRevendaDirty) {
          const { error: gradeErr } = await supabase.rpc("salvar_grade_revenda" as any, {
            _modelo_id: savedId,
            _grades: buildLinhasGradeRevenda(),
            _rev_base: null,
          });
          if (gradeErr) throw gradeErr;
        }
      }
      // MO por serviço (spec 2026-08-06): persiste os VALORES das linhas (estado COMPLETO;
      // aprovação já foi imediata via RPC própria, não entra aqui). Só quando o rascunho de MO
      // divergiu do baseline — assim um Salvar disparado ANTES de `moResumo` semear não manda
      // um estado vazio que apagaria as linhas existentes no servidor. `moLinhasRef` = leitura
      // síncrona (nenhuma edição feita durante o `await` acima se perde). Gated por
      // `podeVerCustos`: quem não vê custos tem os valores MASCARADOS (null) e não deve reescrevê-los.
      if (podeVerCustos && savedId && !moLinhasEqual(moLinhasRef.current, moBaseRef.current)) {
        const { error: moErr } = await supabase.rpc("salvar_modelo_servico_mo" as any, {
          _modelo_id: savedId,
          _linhas: moLinhasRef.current.map((l) => ({
            categoria_terceirizado_id: l.categoria_terceirizado_id,
            valor: Number(l.valor) || 0,
            observacoes: null,
          })),
        });
        if (moErr) throw moErr;
      }
      // FIX WAVE (B3-fix): card criado (ou editado pra) origem='revenda' sem produto
      // vinculado ganha o espelho AUTOMATICAMENTE — reusa exatamente a lógica do botão
      // manual `criarProdutoAcabado` abaixo (grupo via categorias_produto.grupo_id +
      // colecao_id/subcolecao/semana herdados do modelo). O botão manual continua existindo
      // pros modelos antigos sem produto (ex.: cards revenda de antes desta mudança).
      // Best-effort: qualquer erro aqui (inclusive a trava 1:1 `enforce_unique_fk` numa
      // corrida de save duplo) é capturado e NUNCA quebra o save do card — o "Modelo salvo"
      // já é verdade nesse ponto (header + MO já persistiram).
      let autoProduto: { criou: boolean; semColecao: boolean } | null = null;
      if (savedId && draft.origem === "revenda" && paOn) {
        try {
          const { data: existente } = await supabase
            .from("produtos_acabados" as any)
            .select("id")
            .eq("modelo_id", savedId)
            .maybeSingle();
          if (!existente) {
            const cat = categorias.find((c) => c.id === draft.categoria_principal_id);
            const grupoId = cat?.grupo_id ?? null;
            if (grupoId && draft.categoria_principal_id) {
              const { data: novoProdutoId, error: paErr } = await supabase.rpc("salvar_produto_acabado" as any, {
                _id: null,
                _dados: {
                  nome: draft.nome,
                  grupo_id: grupoId,
                  categoria_id: draft.categoria_principal_id,
                  subcategoria1_id: draft.subcategoria1_id,
                  subcategoria2_id: draft.subcategoria2_id,
                  colecao_id: draft.colecao_id,
                  subcolecao: draft.subcolecao || null,
                  semana: draft.semana || null,
                },
                _variantes: [],
              });
              if (paErr) throw paErr;
              const { error: linkErr } = await (supabase.from("produtos_acabados" as any) as any)
                .update({ modelo_id: savedId }).eq("id", novoProdutoId);
              if (linkErr) throw linkErr;
              autoProduto = { criou: true, semColecao: !draft.colecao_id };
            }
          }
        } catch (autoErr) {
          console.error("Auto-criação do produto acabado (revenda) falhou — save do card mantido:", autoErr);
        }
      }
      return { autoProduto };
    },
    onSuccess: (result) => {
      toast.success("Modelo salvo");
      if (result?.autoProduto?.criou) {
        if (result.autoProduto.semColecao) {
          toast.success('Produto criado no Produto Acabado — defina a coleção do modelo pra ele aparecer no canvas.');
        } else {
          toast.success("Produto criado no Produto Acabado.");
        }
      }
      // Item 3 (bônus, refino ago/2026): QUALQUER save de um card revenda invalida o cache do
      // Produto Acabado — antes só cobria o auto-criar do espelho (acima); editar um campo que
      // o PA lê por embed (ex.: Linha → "Markup da linha (sugestão)" no card, ou preço
      // varejo/atacado) num produto JÁ vinculado não invalidava nada aqui. Na prática o
      // `ProdutoAcabadoSheet` já busca fresco a cada montagem (`["produtos-acabados", colecaoId]`
      // sem staleTime — default 0), mas isto fecha o buraco se o Sheet permanecer montado
      // durante o save (reabertura rápida) e mantém paridade com `invalidarVizinhos` do sentido
      // inverso (`ProdutoCard.tsx`, PA → Planejamento).
      if (draft.origem === "revenda") {
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey?.[0] === "string" && (q.queryKey[0] as string).startsWith("produtos-acabados") });
        qc.invalidateQueries({ queryKey: ["pa-produto-modelo", modeloId] });
      }
      markClean();
      // Colab: o que acabei de salvar já É o "base" atual — evita que o eco do Realtime (meu
      // próprio UPDATE) apareça como "alguém atualizou N campos" no banner. O rev real
      // (bumpado no servidor) chega no próximo refetch — o merge effect processa em silêncio
      // (base≈fresh, sem conflitos) e avança `revRef`.
      baseRef.current = { draft };
      touchedRef.current = new Set();
      conflitosRef.current = [];
      setConflitos([]);
      setUltimoMerge(null);
      // MO por serviço: o que acabei de persistir vira o novo baseline (limpa o indicador de
      // "não salvo" das linhas de MO).
      setMoLinhasBase(moLinhas);
      qc.invalidateQueries({ queryKey: ["modelo"] });
      qc.invalidateQueries({ queryKey: ["modelo-tecidos"] });
      qc.invalidateQueries({ queryKey: ["otb-orcamento"] });
      qc.invalidateQueries({ queryKey: ["mo-resumo", modeloId] });
      qc.invalidateQueries({ queryKey: ["mo-resumo-list"] });
      qc.invalidateQueries({ queryKey: ["plan-custo-unit", modeloId] });
      // Cross-invalidation (bidirecionalidade c/ o Desenvolvimento, spec 2026-08-11): sem
      // isto o Dev não ficava sabendo de edições de MO salvas aqui sem refetch manual.
      qc.invalidateQueries({ queryKey: ["modelo-mo-resumo"] });
      // Identidade/classificação (Nome, taxonomia, coleção, linha, datas) é a MESMA ficha
      // `modelos` editada no Dev (seção "1. Geral") — o Dev já invalida `modelos-planejamento`
      // no seu save (reflexo Dev→Plan.); este espelha o sentido Plan.→Dev pra o card do kanban
      // do Desenvolvimento refletir sem refetch manual (§K, decisão do dono ago/2026).
      qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
      qc.invalidateQueries({ queryKey: ["plan-grade-total"] });
      qc.invalidateQueries({ queryKey: ["modelo-grades-revenda", modeloId] });
      onSaved();
      onClose();
    },
    onError: async (e: any) => {
      // Grade cor×tamanho (revenda, fast-follow): conflito tratado por RECARGA, NÃO por merge
      // — refaz o fetch da grade e deixa o usuário reaplicar (política "conflito → recarrega",
      // limitação consciente; ver comentário no `mutationFn`). Fica ANTES do branch de P0409
      // do header abaixo (que este marcador `gradeConflict` desvia) — não entra no
      // merge/retry dele, que não sabe nada de `gradeRevenda`.
      if (e?.code === "P0409" && e?.gradeConflict) {
        await qc.refetchQueries({ queryKey: ["modelo-grades-revenda", modeloId] });
        const freshGrade = qc.getQueryData<{ variante_numero: number; grades: Record<string, number> | null; grade_total: number }[]>(["modelo-grades-revenda", modeloId]) ?? [];
        const seeded: Record<number, Record<string, number>> = {};
        for (const r of freshGrade) seeded[r.variante_numero] = { ...(r.grades ?? {}) };
        setGradeRevenda(seeded);
        gradeRevendaBaseRef.current = JSON.stringify(seeded);
        // Resincroniza o rev PRÓPRIO da grade — sem isto o PRÓXIMO Salvar compararia com um
        // `_rev_base` velho e cairia em P0409 de novo, mesmo já com os dados certos na tela.
        // Não mexe em `revRef`/draft — o merge effect existente (useEffect de `[modeloData]`)
        // resolve isso sozinho a partir deste mesmo refetch.
        await qc.refetchQueries({ queryKey: ["modelo", modeloId] });
        const freshModelo = qc.getQueryData<any>(["modelo", modeloId]);
        gradeRevendaRevRef.current = freshModelo?.rev ?? null;
        toast.error(mensagemErro(e, "Erro ao salvar"));
        return;
      }
      // Colab (Task 2, mesma armadilha documentada no piloto/Desenvolvimento): ler o cache
      // DIRETO (getQueryData) + refs-espelho DENTRO do onError — NUNCA delegar ao useEffect
      // (só roda no próximo passive-effect commit; o retry leria `revRef.current` VELHO e
      // cairia em P0409 de novo). `draftLiveRef` (não o `draft` da closure) garante que
      // nenhuma tecla digitada durante o `await` (campos não ficam disabled) se perca.
      if (e?.code === "P0409" && !retryRef.current) {
        retryRef.current = true;
        savingRef.current = true;
        await qc.refetchQueries({ queryKey: ["modelo", modeloId] });
        const fresh = qc.getQueryData<any>(["modelo", modeloId]);
        if (fresh) {
          const freshDraft = draftFromModeloRow(fresh);
          const liveDraft = draftLiveRef.current;
          const base = baseRef.current ?? { draft: freshDraft };
          const md = mergeDraft({ base: base.draft, draft: liveDraft, fresh: freshDraft, touched: touchedRef.current });
          if (md.atualizados.length > 0 || md.conflitos.length > 0) setDraft(md.valor);
          conflitosRef.current = md.conflitos;
          setConflitos(md.conflitos);
          setUltimoMerge({ atualizados: md.atualizados.length, conflitos: md.conflitos });
          // Avança base/rev AQUI — o merge effect (dispara em seguida pelo mesmo refetch) vai
          // ver base===fresh e virar no-op: nada é reaplicado em dobro.
          baseRef.current = { draft: freshDraft };
          revRef.current = (fresh as any).rev ?? null;
          setEnviada(!!(fresh as any).ordem_criacao_enviada);
          setLancado(!!(fresh as any).lancado);
          if (md.conflitos.length === 0) {
            save.mutate(undefined, { onSettled: () => { savingRef.current = false; retryRef.current = false; } });
            return;
          }
        }
        savingRef.current = false;
        retryRef.current = false;
        toast.error(mensagemErro(e, "Erro ao salvar"));
        return;
      }
      toast.error(mensagemErro(e, "Erro"));
    },
  });

  const handleSave = () => {
    if (savingRef.current || save.isPending) return;
    savingRef.current = true;
    save.mutate(undefined, { onSettled: () => { savingRef.current = false; } });
  };

  // Resolve um conflito de campo escalar: "usar o novo" aplica `dele` no rascunho e tira o
  // campo do `touched` (senão o próximo merge o trataria como editado por mim de novo);
  // "manter meu" só descarta o aviso — o valor local prevalece e SEGUE touched.
  const resolverConflito = (c: Conflito, useDele: boolean) => {
    if (useDele) {
      setDraft((d) => ({ ...d, [c.path]: c.dele }));
      touchedRef.current.delete(c.path);
    }
    setConflitos((prev) => {
      const next = prev.filter((x) => x.path !== c.path);
      conflitosRef.current = next;
      return next;
    });
    setUltimoMerge((prev) => {
      if (!prev) return prev;
      const conflitosRestantes = prev.conflitos.filter((x) => x.path !== c.path);
      if (conflitosRestantes.length === 0 && prev.atualizados === 0) return null;
      return { ...prev, conflitos: conflitosRestantes };
    });
  };
  // Resolução GENÉRICA a partir do ColabBanner (mesmo padrão do piloto/Desenvolvimento): todo
  // conflito ganha "manter meu · usar o novo" — sem isso o guard do save deadlockaria em
  // campos sem UI de resolução inline.
  const resolverPorPath = (path: string, escolha: "meu" | "dele") => {
    const c = conflitos.find((x) => x.path === path);
    if (c) resolverConflito(c, escolha === "dele");
  };

  // Colab: canal por modelo — o registroId vai DENTRO do canal (nunca ler old_record).
  // Qualquer UPDATE na linha `modelos` (inclusive um save de outro usuário) dispara
  // `onMudancaServidor`, que invalida a query e deixa o useEffect de merge acima reconciliar.
  const { presentes } = useColabRegistro({
    canal: modeloId ? `colab:modelo:${modeloId}` : null,
    tabela: "modelos",
    registroId: modeloId,
    onMudancaServidor: () => qc.invalidateQueries({ queryKey: ["modelo", modeloId] }),
    campoFocado,
  });
  const focadoPor = (path: string) => presentes.find((p) => p.campoFocado === path)?.nome;
  const colabField = (path: string) => {
    const nome = focadoPor(path);
    return {
      "data-colab-path": path,
      title: nome ? `${nome} está neste campo` : undefined,
      inputClassName: nome ? "ring-1 ring-sky-400" : undefined,
      className: nome ? "ring-1 ring-sky-400" : undefined,
    };
  };

  // Enviar/Cancelar Ordem de Criação: gate explícito pro Desenvolvimento (independe do Salvar).
  // Colab (Task 2): classe b — ação pontual de 1 campo (2, atômicos no mesmo payload), singular
  // e idempotente (enviar de novo com o mesmo `send` não muda nada); não compete com edições de
  // outros campos do rascunho. SEM trava de `rev`.
  const enviar = useMutation({
    mutationFn: async (send: boolean) => {
      if (!modeloId) throw new Error("Salve o modelo primeiro.");
      const payload = send
        ? { ordem_criacao_enviada: true, ordem_criacao_enviada_at: new Date().toISOString(), status_planejamento: "planejado" }
        : { ordem_criacao_enviada: false, ordem_criacao_enviada_at: null };
      const { error } = await supabase.from("modelos").update(payload).eq("id", modeloId);
      if (error) throw error;
    },
    onMutate: (send: boolean) => setEnviada(send),
    onError: (e: any, send: boolean) => { setEnviada(!send); toast.error(mensagemErro(e, "Erro")); },
    onSuccess: (_d, send: boolean) => {
      toast.success(send ? "Ordem de Criação enviada" : "Envio cancelado");
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
    },
  });

  // Lançar/Cancelar: gate explícito pro Lançamentos (independe do Salvar). Persiste a
  // Data de Lançamento junto (o usuário pode não ter clicado em Salvar).
  const lancar = useMutation({
    mutationFn: async (send: boolean) => {
      if (!modeloId) throw new Error("Salve o modelo primeiro.");
      // Pré-checagens de UX (mensagem imediata); o SERVIDOR re-valida em lancar_modelo.
      if (send) {
        if (!cqConfirmado) throw new Error("Confirme o Controle de Qualidade antes de lançar.");
        if (maoObraPendente) throw new Error("Aprove a mão de obra antes de lançar.");
        if (!draft.data_lancamento) throw new Error("Preencha a Data de Lançamento.");
      }
      // Gate REAL no servidor (CQ liberado + valor de serviço aprovado + data). Ao lançar,
      // a RPC também limpa o #Erro de 'lancamentos' (setado quando o CQ foi desmarcado antes).
      const { error } = await supabase.rpc("lancar_modelo" as any, {
        _modelo_id: modeloId,
        _data_lancamento: send ? draft.data_lancamento : null,
        _send: send,
      });
      if (error) throw error;
    },
    onMutate: (send: boolean) => setLancado(send),
    onError: (e: any, send: boolean) => { setLancado(!send); toast.error(mensagemErro(e, "Erro")); },
    onSuccess: (_d, send: boolean) => {
      toast.success(send ? "Modelo lançado" : "Lançamento cancelado");
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      qc.invalidateQueries({ queryKey: ["lancamentos-cards"] });
      qc.invalidateQueries({ queryKey: ["sidebar-badges"] });
    },
  });

  const duplicate = useMutation({
    mutationFn: async () => {
      if (!modeloId) return;
      // Raiz da família de versões: o original (cópias apontam para ele via modelo_base_id).
      const root = draft.modelo_base_id ?? modeloId;
      // Próxima versão = maior versão existente na família + 1.
      const { data: fam, error: eFam } = await supabase
        .from("modelos")
        .select("versao")
        .or(`id.eq.${root},modelo_base_id.eq.${root}`);
      if (eFam) throw eFam;
      const maxV = (fam ?? []).reduce((m, r: any) => Math.max(m, r.versao ?? 1), 1);
      // A cópia mantém o nome do original; a versão é que diferencia.
      const { versao: _v, modelo_base_id: _b, ...rest } = draft;
      const payload: any = {
        ...rest,
        status_planejamento: "em_planejamento",
        data_lancamento: null, // a cópia (nova versão) não nasce lançada (lancado default false)
        versao: maxV + 1,
        modelo_base_id: root,
      };
      const { error } = await supabase.from("modelos").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Card duplicado"); qc.invalidateQueries({ queryKey: ["otb-orcamento"] }); onSaved(); onClose(); },
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  const del = useMutation({
    mutationFn: async () => {
      if (!modeloId) return;
      const { error } = await supabase.from("modelos").delete().eq("id", modeloId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Modelo excluído"); qc.invalidateQueries({ queryKey: ["otb-orcamento"] }); onSaved(); onClose(); },
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  // Condições que faltam p/ Enviar a Ordem de Criação (mostradas no tooltip do botão).
  const enviarBloqueios: string[] = [];
  if (draft.status_planejamento !== "planejado") enviarBloqueios.push('Defina o Status como "Planejado".');

  // O que falta p/ poder Lançar (mesmo gate da mutation `lancar`) — alimenta o tooltip
  // do botão desabilitado no setor Lançamento.
  const lancarBloqueios: string[] = [];
  if (!cqConfirmado) lancarBloqueios.push("Confirme o Controle de Qualidade (Pré e, se houver acabamento, o Pós).");
  if (maoObraPendente) lancarBloqueios.push("Aprove a mão de obra de todos os serviços (na seção Mão de obra).");
  if (!draft.data_lancamento) lancarBloqueios.push("Preencha a Data de Lançamento.");

  // Conteúdo interno idêntico p/ os dois containers (header / corpo rolável / rodapé
  // sticky / diálogos / guarda). EDITAR abre num Sheet lateral (side=right, ~70vw);
  // NOVO num Dialog central. O container é escolhido por `isEdit` logo abaixo.
  const conteudo = (
    <>
        <div className="shrink-0 px-6 pt-4 pb-0">
          <Breadcrumb items={[{ label: "Estilo & Engenharia" }, { label: "Planejamento de Produto" }, { label: draft.nome || "Novo modelo" }]} />
        </div>
        <DialogHeader className="shrink-0 px-6 pt-6 pb-2 text-left">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>{isEdit ? draft.nome || "Modelo" : "Novo Modelo"}</span>
            {draft.versao > 1 && <VersaoBadge versao={draft.versao} />}
            <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
          </DialogTitle>
          <ColabBanner
            presentes={presentes}
            ultimoMerge={ultimoMerge}
            conflitos={conflitos}
            onResolver={resolverPorPath}
            rotulo={rotuloConflitoPlan}
          />
        </DialogHeader>

        <div
          className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-6"
          onFocusCapture={(e) => setCampoFocado((e.target as HTMLElement).dataset?.colabPath ?? null)}
          onBlurCapture={() => setCampoFocado(null)}
        >
          {/* SETOR 1 — Informações Gerais do Produto */}
          <Secao titulo="Informações Gerais do Produto">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="grid gap-1">
                <Label>Status</Label>
                <Select value={draft.status_planejamento} onValueChange={(v) => setDraftTracked((d) => ({ ...d, status_planejamento: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <FieldText
                label="Nome do Modelo"
                value={draft.nome}
                onChange={(v) => setDraftTracked((d) => ({ ...d, nome: v }))}
                colabPath={colabField("nome")["data-colab-path"]}
                colabRing={!!colabField("nome").className}
              />
              <FieldSelect label={fl("estilista")} value={draft.estilista_id} onChange={(v) => setDraftTracked((d) => ({ ...d, estilista_id: v }))} options={estilistas} />
              <div className="grid gap-1">
                <Label>Origem</Label>
                <Select value={draft.origem} onValueChange={(v) => setDraftTracked((d) => ({ ...d, origem: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="interno">Interno</SelectItem>
                    <SelectItem value="revenda">Revenda</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <FieldSelect
                label="Grupo"
                value={grupoSel}
                onChange={(v) => {
                  setGrupoSel(v);
                  // Se a categoria atual não pertence ao novo grupo, limpa categoria + subs.
                  const cat = categorias.find((c) => c.id === draft.categoria_principal_id);
                  if (cat && cat.grupo_id !== v) setDraftTracked((d) => ({ ...d, categoria_principal_id: null, subcategoria1_id: null, subcategoria2_id: null }));
                }}
                options={grupos}
              />
              <FieldSelect
                label="Categoria"
                value={draft.categoria_principal_id}
                onChange={(v) => {
                  // Mantém o Grupo coerente e reseta as subcategorias (pertencem à categoria).
                  const cat = categorias.find((c) => c.id === v);
                  if (cat?.grupo_id) setGrupoSel(cat.grupo_id);
                  setDraftTracked((d) => ({ ...d, categoria_principal_id: v, subcategoria1_id: null, subcategoria2_id: null }));
                }}
                options={grupoSel ? categorias.filter((c) => c.grupo_id === grupoSel) : categorias}
              />
              <FieldSelect
                label="Subcategoria 1"
                value={draft.subcategoria1_id}
                onChange={(v) => setDraftTracked((d) => ({ ...d, subcategoria1_id: v }))}
                options={sub1Opts.filter((s) => s.categoria_id === draft.categoria_principal_id)}
              />
              <FieldSelect
                label="Subcategoria 2"
                value={draft.subcategoria2_id}
                onChange={(v) => setDraftTracked((d) => ({ ...d, subcategoria2_id: v }))}
                options={sub2Opts.filter((s) => s.categoria_id === draft.categoria_principal_id)}
              />
            </div>
          </Secao>

          {/* SETOR 2 — Coleção */}
          <Secao titulo="Coleção">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {otbOn ? (
                <FieldSelect
                  label={fl("colecao")}
                  value={draft.colecao_id ?? null}
                  onChange={(v) => {
                    const col = colecoes.find((c) => c.id === v);
                    setDraftTracked((d) => ({ ...d, colecao_id: v, colecao: col?.nome ?? d.colecao,
                      mes_id: d.mes_id ?? col?.mes_id ?? null, ano_id: d.ano_id ?? col?.ano_id ?? null }));
                  }}
                  options={colecoes.map((c) => ({ id: c.id, nome: orcLabel(c.nome, orc.colecao(c.id)) }))}
                />
              ) : (
                <FieldText label={fl("colecao")} value={draft.colecao} onChange={(v) => setDraftTracked((d) => ({ ...d, colecao: v }))} />
              )}
              {otbOn ? (
                <FieldSelect
                  label="Subcoleção"
                  value={draft.subcolecao || null}
                  onChange={(v) => setDraftTracked((d) => ({ ...d, subcolecao: v }))}
                  options={Array.from(new Set([...subcolecoesOpts, ...(draft.subcolecao ? [draft.subcolecao] : [])])).map((s) => ({ id: s, nome: orcLabel(s, orc.subcolecao(draft.colecao_id, s)) }))}
                />
              ) : (
                <FieldText label="Subcoleção" value={draft.subcolecao ?? ""} onChange={(v) => setDraftTracked((d) => ({ ...d, subcolecao: v }))} />
              )}
              <FieldSelect label={fl("linha")} value={draft.linha_id} onChange={(v) => setDraftTracked((d) => ({ ...d, linha_id: v }))} options={linhas.map((l) => ({ id: l.id, nome: orcLabel(l.nome, orc.nivel3(draft.colecao_id, draft.subcolecao, l.id)) }))} />
              <div className="grid gap-1">
                <Label>Lançamento</Label>
                <Select value={draft.semana || ""} onValueChange={(v) => setDraftTracked((d) => ({ ...d, semana: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    {["1","2","3","4","5"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <FieldSelect label="Mês de Planejamento" value={draft.mes_id} onChange={(v) => setDraftTracked((d) => ({ ...d, mes_id: v }))} options={meses} />
              <FieldSelect label="Ano" value={draft.ano_id} onChange={(v) => setDraftTracked((d) => ({ ...d, ano_id: v }))} options={anos} />
              {/* Data de Lançamento vive APENAS na seção Lançamento (junto do botão Lançar) — antes
                  aparecia duas vezes no mesmo Sheet, editando o mesmo campo (laudo jul/2026). */}
            </div>
          </Secao>

          {/* SETOR 3 — Preço (só na edição; na criação o custo vem do BOM depois) */}
          {isEdit && (
          <Secao titulo="Preço">
            {!isRevenda ? (
              // MANUFATURADO — §K: custo/markup/preço vêm de OUTRA etapa (BOM/CAD +
              // Serviços; linha do Cadastro; cálculo de preco.ts) → tira de resumo + atalho
              // ⧉ pra etapa dona, NUNCA campo travado. Só "Preço para venda" é campo desta
              // tela (nasce vazio, placeholder = sugerido — §D). Nada de dado/RPC muda: são
              // os MESMOS valores (custo/markup/preco/precoSug/markupReal), só a apresentação.
              <div className="space-y-3">
                <InfoStrip
                  compact
                  titulo="Custo"
                  procedencia="vem do Desenvolvimento (BOM/CAD) + Serviços"
                  link={{ to: "/criacao/desenvolvimento", label: "Ver no Desenvolvimento" }}
                  itens={[
                    { label: "Materiais", valor: custo > 0 ? brl(materiaisSetor) : "—" },
                    { op: "+", label: "Mão de obra", valor: custo > 0 ? brl(maoObraSetor) : "—" },
                    {
                      op: "=",
                      label: "Custo total",
                      hi: true,
                      badge: !custoReal ? <StatusBadge tone="warning">previsto</StatusBadge> : undefined,
                      valor: custo > 0 ? brl(custo) : "—",
                    },
                  ]}
                />
                <InfoStrip
                  compact
                  titulo="Markup sugerido"
                  procedencia={`markup da linha do Cadastro (${linhaNomeSetor ?? "sem linha"}), ao vivo`}
                  link={{ to: "/cadastro/atributos", label: "Editar no Cadastro" }}
                  itens={[
                    { label: "Markup sugerido", hint: linhaNomeSetor ? `(${linhaNomeSetor})` : "(linha)", valor: markup > 0 ? markup.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—" },
                  ]}
                />
                {podeVerCustos && (
                  <div className="grid gap-1">
                    <Label>
                      Markup aplicado{" "}
                      <span className="font-normal text-muted-foreground text-xs">
                        — forma o preço, congelado no modelo (em uso: {markupAplicado > 0 ? `${fmtNum(markupAplicado)}×` : "—"})
                      </span>
                    </Label>
                    <div className="relative">
                      <NumberInput
                        blankZero
                        disabled={!podeEditarCustos}
                        placeholder={markup > 0 ? fmtNum(markup) : "2,50"}
                        className="pr-6"
                        value={draft.markup_editado ?? 0}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setDraftTracked((d) => ({ ...d, markup_editado: v > 0 ? v : null }));
                        }}
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">×</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Vazio usa o markup sugerido da linha.</p>
                  </div>
                )}
                <InfoStrip
                  compact
                  titulo="Preço"
                  procedencia="custo × markup aplicado · cálculo de preco.ts"
                  itens={[
                    { label: "Preço", hint: "(custo × markup aplicado)", valor: preco > 0 ? brl(preco) : "—" },
                    { op: "→", label: "Preço sugerido", hint: "(arredonda ,90)", valor: precoSug > 0 ? brl(precoSug) : "—" },
                  ]}
                />
                <div className="grid gap-1">
                  <Label>
                    Preço para venda <span className="font-normal text-muted-foreground text-xs">— campo desta tela</span>
                  </Label>
                  <NumberInput
                    value={draft.preco_venda && draft.preco_venda > 0 ? draft.preco_venda : ""}
                    placeholder={precoSug > 0 ? brl(precoSug) : undefined}
                    onChange={(e) => { const v = e.target.value; setDraftTracked((d) => ({ ...d, preco_venda: numOr0(v) > 0 ? Number(v) : null })); }}
                  />
                  <p className="text-xs text-muted-foreground">Vazio usa o preço sugerido.</p>
                </div>
                <InfoStrip
                  compact
                  titulo="Markup real"
                  procedencia="derivado ao vivo: preço efetivo ÷ custo"
                  itens={[
                    { label: "Markup real", valor: markupReal > 0 ? markupReal.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—" },
                  ]}
                />
              </div>
            ) : (
              // REVENDA — fora do escopo aprovado do §K: segue como CampoRO + os 2 markups
              // digitáveis (mesma fonte de ProdutoCard.tsx no planejador Produto Acabado,
              // bidirecional) + Preço atacado/para venda DERIVADOS ao vivo. Intocado.
              <div className="grid sm:grid-cols-2 gap-3">
                <CampoRO label={custoReal ? "Custo (real)" : "Custo (previsto)"} value={custo > 0 ? brl(custo) : "—"} />
                <CampoRO label="Markup" value={markup > 0 ? markup.toLocaleString("pt-BR") : "—"} />
                <CampoRO label="Preço" value={preco > 0 ? brl(preco) : "—"} />
                <CampoRO label="Preço sugerido" value={precoSug > 0 ? brl(precoSug) : "—"} />
                {produtoRevenda ? (
                  <>
                    <div className="grid gap-1">
                      <Label>Markup atacado</Label>
                      <div className="relative">
                        <NumberInput
                          blankZero
                          placeholder="2,50"
                          className="pr-6"
                          value={markupAtacadoInput ?? 0}
                          onChange={(e) => setMarkupAtacadoInput(Number(e.target.value) > 0 ? Number(e.target.value) : null)}
                          onBlur={() => salvarMarkupsRevenda.mutate({ markup_atacado: markupAtacadoInput, markup_varejo: markupVarejoInput })}
                        />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">×</span>
                      </div>
                    </div>
                    <div className="grid gap-1">
                      <Label>Markup varejo</Label>
                      <div className="relative">
                        <NumberInput
                          blankZero
                          placeholder="2,50"
                          className="pr-6"
                          value={markupVarejoInput ?? 0}
                          onChange={(e) => setMarkupVarejoInput(Number(e.target.value) > 0 ? Number(e.target.value) : null)}
                          onBlur={() => salvarMarkupsRevenda.mutate({ markup_atacado: markupAtacadoInput, markup_varejo: markupVarejoInput })}
                        />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">×</span>
                      </div>
                    </div>
                    <CampoRO label="Preço atacado" value={precoAtacadoRevendaLive != null ? brl(precoAtacadoRevendaLive) : "—"} />
                    <CampoRO label="Preço para venda" value={precoVarejoRevendaLive != null ? brl(precoVarejoRevendaLive) : "—"} />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground sm:col-span-2">
                    {produtoRevendaLoading ? "Carregando…" : "Crie o produto acabado (abaixo) para definir os markups de preço."}
                  </p>
                )}
              </div>
            )}
          </Secao>
          )}

          {/* Revenda (Task 7): produto vinculado (Produto Acabado) — atalho ⧉ ou criar. */}
          {isEdit && isRevenda && paOn && (
            <Secao titulo="Produto Acabado">
              {produtoRevendaLoading ? (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              ) : produtoRevenda ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-muted-foreground">Este modelo está vinculado a um produto de revenda.</p>
                  {contexto !== "produto-acabado" && (
                    <Button
                      type="button" variant="outline" size="sm" className="ml-auto gap-1.5"
                      onClick={() => navigate({ to: "/criacao/produto-acabado", search: produtoRevenda.colecao_id ? ({ colecao: produtoRevenda.colecao_id } as any) : ({} as any) })}
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Ver no Produto Acabado
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-muted-foreground">Nenhum produto de revenda vinculado ainda.</p>
                  <Button
                    type="button" variant="outline" size="sm" className="ml-auto gap-1.5"
                    onClick={() => criarProdutoAcabado.mutate()}
                    disabled={criarProdutoAcabado.isPending || !modeloId}
                  >
                    <PackagePlus className="h-3.5 w-3.5" /> Criar produto acabado
                  </Button>
                </div>
              )}
            </Secao>
          )}

          {/* Revenda (Task 7): grade cor×tamanho editável — por variante do produto (rótulo
              cor·apelido) × tamanhos ativos da proporção (grupo Acessórios = coluna única
              "UN"); lê/grava `modelo_grades` (variante_numero=ordem). */}
          {isEdit && isRevenda && paOn && produtoRevenda && (
            <Secao titulo="Grade">
              {variantesRevenda.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  O produto vinculado ainda não tem variantes de cor — cadastre-as no Produto Acabado.
                </p>
              ) : tamanhosRevenda.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Defina a proporção de tamanhos deste produto no Produto Acabado antes de preencher a grade.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left">
                      <tr>
                        <th className="px-3 py-2">Variante</th>
                        {tamanhosRevenda.map((t) => <th key={t} className="px-3 py-2 text-right">{t}</th>)}
                        <th className="px-3 py-2 text-right font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variantesRevenda.map((v) => (
                        <tr key={v.ordem} className="border-t">
                          <td className="px-3 py-2">{varianteLabel({ cor: v.cor?.nome, apelido: v.apelido?.nome })}</td>
                          {tamanhosRevenda.map((t) => (
                            <td key={t} className="px-3 py-1.5 text-right">
                              <NumberInput
                                integer
                                blankZero
                                placeholder="0"
                                className="h-8 w-20 text-right ml-auto"
                                value={gradeRevenda[v.ordem]?.[t] ?? 0}
                                onChange={(e) => setCelulaGradeRevenda(v.ordem, t, Number(e.target.value) || 0)}
                              />
                            </td>
                          ))}
                          <td className="px-3 py-2 text-right font-medium tabular-nums">{totalLinhaRevenda(v.ordem)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/30 font-medium">
                        <td className="px-3 py-2">Total</td>
                        {tamanhosRevenda.map((t) => <td key={t} className="px-3 py-2 text-right tabular-nums">{totalColunaRevenda(t)}</td>)}
                        <td className="px-3 py-2 text-right tabular-nums">{totalGeralRevenda}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Secao>
          )}

          {/* SETOR 4 — Tecido Planejado (oculto p/ revenda — sem tecido) */}
          {!isRevenda && (
          <Secao titulo="Tecido Planejado">
            <MultiArtigosField
              label=""
              value={draft.tecidos_planejados}
              onChange={(v) => setDraftTracked((d) => ({ ...d, tecidos_planejados: v }))}
              artigos={artigos}
              estoque={estoqueMap}
            />
          </Secao>
          )}

          {/* SETOR — Simulação de custo (oculto p/ revenda — custo vem do produto/OC, não do
              BOM/CAD manufaturado). Após Tecido Planejado; isolada do custo/preço real. */}
          {!isRevenda && (
          <Secao titulo="Simulação de custo">
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Estimativa — <strong>não</strong> é o custo nem o preço real (esses vêm do BOM/CAD).</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="grid gap-1">
                <Label>Consumo de tecido (m)</Label>
                <NumberInput
                  value={consumoOverride ?? (consumoRealBOM > 0 ? consumoRealBOM : "")}
                  onChange={(e) => { const v = e.target.value; setSim({ consumo_tecido: numOr0(v) > 0 ? Number(v) : null }); }}
                />
              </div>
              <div className="grid gap-1">
                <Label>Preço do tecido (R$/m)</Label>
                <div className="h-9 px-3 flex items-center rounded-md border bg-muted text-sm tabular-nums">
                  {precoTecidoM > 0 ? brl(precoTecidoM) : "—"}
                </div>
              </div>
              <div className="grid gap-1">
                <Label>Aviamento &amp; Insumo (R$)</Label>
                <NumberInput
                  value={draft.custo_simulado.aviamento ?? ""}
                  onChange={(e) => { const v = e.target.value; setSim({ aviamento: numOr0(v) > 0 ? Number(v) : null }); }}
                />
              </div>
              <div className="grid gap-1">
                <Label>Mão de obra (R$)</Label>
                {/* Σ das linhas de MO por serviço (só leitura) — editar é na seção "Mão de obra". */}
                <div className="h-9 px-3 flex items-center rounded-md border bg-muted text-sm tabular-nums">
                  {maoObraDev > 0 ? brl(maoObraDev) : "—"}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <CampoRO label="Custo do tecido" value={simCalc.tecido > 0 ? brl(simCalc.tecido) : "—"} />
              <CampoRO label="Markup da linha" value={markup > 0 ? markup.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"} />
              <CampoRO label="Custo estimado" value={simCalc.total > 0 ? brl(simCalc.total) : "—"} />
              <CampoRO label="Preço estimado" value={piSim.sugerido > 0 ? brl(piSim.sugerido) : "—"} />
            </div>
            {simCalc.total > 0 && !(markup > 0) && (
              <p className="text-xs text-muted-foreground">Defina a Linha (com markup) para ver o preço estimado.</p>
            )}
          </Secao>
          )}

          {/* Mão de obra POR SERVIÇO (spec 2026-08-06): lista de serviços com valor (R$),
              estado por linha (pendente/aprovado/reprovado) e aprovar/reprovar por serviço.
              Gated: ver custos (valores + obs) OU aprovar (botões). O VALOR persiste no Salvar
              da página; aprovar/reprovar é imediato. Oculto p/ revenda (Task 7) — o gate de MO
              já libera sozinho sem linha nenhuma (invariante #8), só a UI some. */}
          {!isRevenda && (podeVerCustos || (isEdit && podeAprovarMaoObra)) && (
            <Secao titulo="Mão de obra">
              <MaoObraEditor
                linhas={moLinhas}
                categorias={catsServico}
                podeVerCustos={podeVerCustos}
                podeAprovar={isEdit && podeAprovarMaoObra}
                onChangeLinhas={(ls) => setMoLinhas(ls)}
                onAprovar={(catId) => aprovarServicoMO.mutate({ categoriaId: catId, aprovado: true })}
                onReprovar={(catId, motivo) => aprovarServicoMO.mutate({ categoriaId: catId, aprovado: false, motivo })}
                pendingCategoriaId={aprovarServicoMO.isPending ? aprovarServicoMO.variables?.categoriaId : undefined}
              />
              {podeVerCustos && (
                <div className="mt-3">
                  <ObsMaoObraField
                    value={draft.observacoes_mao_obra}
                    onChange={(v) => setDraftTracked({ ...draft, observacoes_mao_obra: v })}
                  />
                </div>
              )}
            </Secao>
          )}

          {/* SETOR 5 — Anexos */}
          <Secao titulo="Anexos">
            <div className="grid sm:grid-cols-2 gap-4">
              <SingleFileField
                label="Foto do Croqui"
                path={draft.croqui_url}
                onUpload={(f) => uploadCroqui.mutate(f)}
                onRemove={() => setDraftTracked((d) => ({ ...d, croqui_url: "" }))}
              />
              <SingleFileField
                label="Desenho Técnico"
                path={draft.desenho_tecnico_url}
                onUpload={(f) => uploadDesenho.mutate(f)}
                onRemove={() => setDraftTracked((d) => ({ ...d, desenho_tecnico_url: "" }))}
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <PhotoList label="Foto do Modelo" paths={draft.fotos_modelo}
                onAdd={(f) => uploadMutation.mutate({ file: f, key: "fotos_modelo" })}
                onRemove={(i) => setDraftTracked((d) => ({ ...d, fotos_modelo: d.fotos_modelo.filter((_, j) => j !== i) }))} />
              <PhotoList label="Foto de Referência" paths={draft.fotos_referencia}
                onAdd={(f) => uploadMutation.mutate({ file: f, key: "fotos_referencia" })}
                onRemove={(i) => setDraftTracked((d) => ({ ...d, fotos_referencia: d.fotos_referencia.filter((_, j) => j !== i) }))} />
            </div>
          </Secao>

          {/* SETOR 6 — Lançamento (gate: CAD + CQ liberado + valor de serviços aprovado) */}
          {isEdit && (
            <Secao titulo="Lançamento">
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid gap-1 flex-1 min-w-[180px]">
                  <Label>Data de Lançamento</Label>
                  {/* Editável aqui também: a data real pode não se cumprir, então o
                      usuário ajusta no próprio setor Lançamento (Salvar persiste). */}
                  <DateField
                    value={draft.data_lancamento ?? ""}
                    onChange={(e) => setDraftTracked((d) => ({ ...d, data_lancamento: e.target.value || null }))}
                    data-colab-path={colabField("data_lancamento")["data-colab-path"]}
                    title={colabField("data_lancamento").title}
                    inputClassName={colabField("data_lancamento").inputClassName}
                  />
                </div>
                {lancado ? (
                  <Button variant="outline" onClick={() => lancar.mutate(false)} disabled={lancar.isPending}>
                    Cancelar Lançamento
                  </Button>
                ) : (
                  <TooltipProvider>
                    <Tooltip>
                      {/* Botão desabilitado não dispara title nativo — o span recebe o
                          hover e o tooltip lista o que falta para lançar. */}
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Button
                            onClick={() => lancar.mutate(true)}
                            disabled={lancar.isPending || lancarBloqueios.length > 0}
                          >
                            Lançar
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {lancarBloqueios.length > 0 && (
                        <TooltipContent className="max-w-[260px]">
                          <p className="font-medium">Para lançar, falta:</p>
                          <ul className="mt-1 list-disc pl-4">
                            {lancarBloqueios.map((b) => <li key={b}>{b}</li>)}
                          </ul>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              {lancado && <p className="mt-2 text-xs text-emerald-600">✓ Lançado — aparece em Lançamentos.</p>}
            </Secao>
          )}
          {isEdit && modeloId && (
            <Secao titulo="Produto Relacionado">
              <ProdutoRelacionadoSetor modeloId={modeloId} />
            </Secao>
          )}
        </div>

        <div className="shrink-0 border-t bg-background px-4 py-3 flex flex-wrap items-center gap-2">
          {/* Voltar: ESQUERDA — ícone no mobile, texto no desktop. */}
          <Button variant="outline" onClick={requestClose} aria-label="Voltar" className="shrink-0 max-sm:aspect-square max-sm:px-0">
            <ArrowLeft className="h-4 w-4 mr-1 max-sm:mr-0" />
            <span className="max-sm:sr-only">Voltar</span>
          </Button>
          {/* Excluir: logo ao lado do Voltar (só no modo edição). */}
          {isEdit && (
            <Button variant="destructive" onClick={() => setConfirmDel(true)} aria-label="Excluir" className="shrink-0 max-sm:aspect-square max-sm:px-0">
              <Trash2 className="h-4 w-4 sm:mr-1" />
              <span className="max-sm:sr-only">Excluir</span>
            </Button>
          )}
          {/* Grupo direito: ml-auto empurra para a direita. */}
          {isEdit && (
            <Button variant="outline" onClick={() => duplicate.mutate()} disabled={duplicate.isPending} aria-label="Duplicar" className="ml-auto shrink-0 max-sm:aspect-square max-sm:px-0">
              <Copy className="h-4 w-4 sm:mr-1" />
              <span className="max-sm:sr-only">Duplicar</span>
            </Button>
          )}
          {isEdit && (enviada ? (
            <Button variant="outline" onClick={() => enviar.mutate(false)} disabled={enviar.isPending}>
              Cancelar Envio
            </Button>
          ) : (
            <TooltipProvider>
              <Tooltip>
                {/* Botão desabilitado não dispara title nativo — o span recebe o hover
                    e o tooltip lista o que falta para enviar. */}
                <TooltipTrigger asChild>
                  <span className={isEdit ? "" : "ml-auto"} style={{ display: "inline-flex" }}>
                    <Button
                      variant="secondary"
                      onClick={() => enviar.mutate(true)}
                      disabled={enviar.isPending || enviarBloqueios.length > 0}
                    >
                      <span className="sm:hidden">Enviar Ordem</span>
                      <span className="hidden sm:inline">Enviar Ordem de Criação</span>
                    </Button>
                  </span>
                </TooltipTrigger>
                {enviarBloqueios.length > 0 && (
                  <TooltipContent className="max-w-[260px]">
                    <p className="font-medium">Para enviar a Ordem de Criação, falta:</p>
                    <ul className="mt-1 list-disc pl-4">
                      {enviarBloqueios.map((b) => <li key={b}>{b}</li>)}
                    </ul>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          ))}
          <Button className={`shrink-0 max-sm:aspect-square max-sm:px-0${!isEdit ? " ml-auto" : ""}`} aria-label="Salvar" onClick={handleSave} disabled={save.isPending}>
            <Save className="h-4 w-4 sm:mr-1" />
            <span className="max-sm:sr-only">Salvar</span>
          </Button>
        </div>

        <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir modelo?</AlertDialogTitle>
              <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => del.mutate()}>Excluir</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas neste card." />
    </>
  );

  // Regra 3: EDITAR registro existente = Sheet lateral (side=right, ~70vw); NOVO = Dialog
  // central. Mesmo conteúdo interno nos dois; classes max-sm:* mantêm o fullscreen mobile.
  return isEdit ? (
    <Sheet open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <SheetContent
        side="right"
        size="editor"
        className="flex flex-col gap-0 p-0 max-sm:[&>button]:hidden max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!rounded-none max-sm:!border-0 max-sm:!overflow-hidden"
      >
        {conteudo}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <DialogContent className="flex flex-col gap-0 p-0 sm:max-w-[70vw] max-h-[90vh] max-sm:[&>button]:hidden max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none max-sm:!border-0 max-sm:!overflow-hidden">
        {conteudo}
      </DialogContent>
    </Dialog>
  );
}

// MO por serviço: invalidations padrão após aprovar/reprovar POR SERVIÇO (`aprovar_servico_mo`,
// spec 2026-08-11 Task 2). Compartilhada entre o editor do detalhe (aprovação de dentro do card
// aberto, aqui) e a seção expandida da lista (`ModeloCard` via `PlanejamentoPage`) sem duplicar
// a lista de queryKeys entre as duas mutations.
function invalidarAposAprovarMO(qc: ReturnType<typeof useQueryClient>, modeloId: string) {
  // Re-sincroniza a rev do colab (o rollup no banco bumpa `modelos.rev`) — sem isto o próximo
  // Salvar do card compara `.eq('rev', revRef)` desatualizado e dá P0409 falso.
  qc.invalidateQueries({ queryKey: ["modelo", modeloId] });
  qc.invalidateQueries({ queryKey: ["mo-resumo", modeloId] });
  qc.invalidateQueries({ queryKey: ["plan-custo-unit", modeloId] });
  qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
  qc.invalidateQueries({ queryKey: ["mo-resumo-list"] });
  // Cross-invalidation (bidirecionalidade c/ o Desenvolvimento, spec 2026-08-11): sem isto o
  // Dev não ficava sabendo de aprovações feitas aqui sem refetch manual.
  qc.invalidateQueries({ queryKey: ["modelo-mo-resumo"] });
}
