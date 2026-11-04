import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Save,
  Upload,
  Trash2,
  ImageOff,
  History,
  Loader2,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { varianteLabel } from "@/lib/variante";
import { brl } from "@/lib/format";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { empresaTemCategoria, FABRIC_TOKENS } from "@/lib/fornecedor-categoria";
import { FornecedorSelect } from "@/components/shared/FornecedorSelect";

import { supabase } from "@/integrations/supabase/client";
import { EnderecoConsolidadoEditor, useEnderecosRollup, type EnderecoRollup } from "@/components/tecido/EnderecoEditor";
import { useSignedUrl, VARIANT_BUCKET } from "@/hooks/useSignedUrl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ImagePreview } from "@/components/shared/ImagePreview";
import { EtiquetaLavagemArtigoEditor } from "@/components/shared/EtiquetaLavagemArtigo";
import { PageActionBar } from "@/components/shared/PageActionBar";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useReadOnly } from "@/components/RequirePermission";
import { useUnsavedGuard, UnsavedChangesGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { useColabRegistro } from "@/hooks/useColabRegistro";
import { ColabPresenceOverlay } from "@/components/shared/ColabPresenceOverlay";
import { pathDoElemento } from "@/lib/colab/colab-field-path";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { CardDraftsProvider, useCardDrafts } from "@/components/shared/card-drafts/CardDraftsProvider";
import { useCardDraft } from "@/components/shared/card-drafts/useCardDraft";
import { CardSaveControls } from "@/components/shared/card-drafts/CardSaveControls";
import { usePreviaServidor } from "@/hooks/usePreviaServidor";
import { cn } from "@/lib/utils";
import { mergeDraft, igual } from "@/lib/colab/merge";
import { maskLive } from "@/lib/money-mask";

// Datas antigas do histórico foram gravadas com offset '+00' (não-ISO) → new Date() dava
// Invalid Date. Normaliza '+00' → '+00:00' antes de parsear (o trigger novo já grava certo).
function fmtDataHora(v: unknown): string {
  if (!v) return "";
  const d = new Date(String(v).replace(/([+-]\d{2})$/, "$1:00"));
  return isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR");
}

export const Route = createFileRoute("/_authenticated/cadastro/tecidos/$artigoId")({
  component: TecidoDetailPage,
});

// Página (deep-link direto pela URL): envolve o detalhe no container e fecha voltando p/ a lista.
// O uso PADRÃO é via modal na lista (cadastro.tecidos.index) — este componente é o mesmo.
function TecidoDetailPage() {
  const { artigoId } = Route.useParams();
  const navigate = useNavigate();
  return (
    <div className="container mx-auto p-3 sm:p-6 max-w-5xl pb-24">
      <TecidoDetail artigoId={artigoId} onClose={() => navigate({ to: "/cadastro/tecidos" })} />
    </div>
  );
}

/**
 * Esc dentro de um campo de uma cor com rascunho NÃO salvo: o Radix fecha o Sheet no `keydown` (listener de `document` em
 * captura, ANTES do React) e todas as cores sujas se perderiam. Aqui o `SheetContent` cancela esse fechamento e deixa o
 * handler do card desfazer SÓ aquela cor. Fora de card sujo (ou com Select aberto — a lista é portal, fora de `data-rascunho`)
 * o Esc segue o fluxo normal (guarda "Descartar alterações?").
 */
export function escapeEmCardSujo(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null;
  if (!el?.closest) return false;
  return !!el.closest("[data-rascunho]") && !!el.closest("[data-card-sujo]") && !el.closest('[role="listbox"]');
}

/**
 * Detalhe do tecido em Sheet lateral (usado pela lista). TODO fechamento — Voltar, X, Esc, clique no overlay — passa pelo
 * `requestClose` do `TecidoDetail` (um só diálogo "Descartar alterações?" se há campo do tecido ou cor com rascunho).
 * `onEscapeKeyDown` é prop nativa do Radix Content repassada pelo `SheetContent`: nenhuma mudança em `sheet.tsx`.
 */
export function TecidoDetailSheet({ openId, onClose }: { openId: string | null; onClose: () => void }) {
  const closeRef = useRef<(() => void) | null>(null);
  const registerClose = useCallback((fn: (() => void) | null) => { closeRef.current = fn; }, []);
  return (
    <Sheet open={!!openId} onOpenChange={(o) => { if (!o) (closeRef.current ?? onClose)(); }}>
      <SheetContent
        side="right"
        size="editor"
        className="p-0 [&>button]:hidden"
        onEscapeKeyDown={(e) => { if (escapeEmCardSujo(e.target)) e.preventDefault(); }}
      >
        <SheetTitle className="sr-only">Detalhes do tecido</SheetTitle>
        {openId && <TecidoDetail artigoId={openId} onClose={onClose} embedded registerClose={registerClose} />}
      </SheetContent>
    </Sheet>
  );
}

type Artigo = {
  id: string;
  nome: string;
  empresa_id: string | null;
  representante_id: string | null;
  largura_estimada: number | null;
  categoria_tecido_id: string | null;
  composicao: string | null;
  mes_id: string | null;
  ano_id: string | null;
  preco: number | null;
  rendimento: number | null;
  preco_por_metro: number | null;
  unidade_medida: string;
  ncm: string | null;
  historico_precos: any;
  rev?: number | null; // colab: bumpa a cada UPDATE (+ via trigger nas variantes_tecido); ainda não no types.ts gerado
};

type Variante = {
  id: string;
  artigo_id: string;
  cor_id: string | null;
  cor_apelido_id: string | null;
  nome_variante: string | null;
  codigo_variante: string | null;
  preco: number | null;
  historico_precos?: Array<{ preco: number; data: string }> | null;
  foto_url: string | null;
  enderecos?: { rua: string; prateleira: string }[] | null;
  rua?: string | null;
  prateleira?: string | null;
};

type Cor = { id: string; nome: string };
type Apelido = { id: string; nome: string; cor_base_id: string | null };

export function TecidoDetail({ artigoId, onClose, embedded = false, registerClose }: {
  artigoId: string; onClose: () => void; embedded?: boolean;
  /** Entrega ao pai (o Sheet) o `requestClose` DESTA tela: Esc e clique fora do Sheet passam pela mesma guarda do Voltar. */
  registerClose?: (fn: (() => void) | null) => void;
}) {
  const qc = useQueryClient();
  const readOnly = useReadOnly();

  const { data: artigo, isLoading } = useQuery({
    queryKey: ["artigo", artigoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigos")
        .select("*")
        .eq("id", artigoId)
        .single();
      if (error) throw error;
      // `ncm` ainda não está no types.ts gerado (backlog) → via unknown (mesmo padrão do aviamento).
      return data as unknown as Artigo;
    },
  });

  const [form, setForm] = useState<Artigo | null>(null);
  const [catIds, setCatIds] = useState<string[]>([]);
  // "Salvar por card": nº de cores (variantes) com rascunho não salvo — reportado pela VariantesSection (que tem o
  // CardDraftsProvider). Entra na MESMA guarda de "alterações não salvas" do tecido (um só diálogo ao sair).
  const [nCoresSujas, setNCoresSujas] = useState(0);

  // Guarda de alterações não salvas (Case C: full-page — não há open gate).
  // Snapshot cobre o form inteiro + catIds (categorias também são editáveis).
  const formSnapshot = useMemo(() => ({ form, catIds }), [form, catIds]);
  const { dirty: formDirty, markClean, reset: resetBaseline } = useDirtySnapshot(formSnapshot);
  const dirty = formDirty || nCoresSujas > 0;
  const { requestClose, confirm } = useUnsavedGuard({
    dirty,
    onClose: useCallback(() => onClose(), [onClose]),
    // Página inteira (embedded=false) bloqueia a navegação de rota; embutido em Sheet
    // (embedded=true) deixa false — o guarda já age no fechar via onClose acima.
    blockNav: !embedded,
  });
  useEffect(() => {
    registerClose?.(requestClose);
    return () => registerClose?.(null);
  }, [registerClose, requestClose]);

  // `dirty` é lido via ref DENTRO do effect, NÃO como dependência. Depender de `dirty`
  // fazia o effect re-disparar no instante em que `markClean()` (pós-save) zera o dirty
  // enquanto o cache de ["artigo"] ainda tem o valor ANTIGO (o invalidate refetcha async)
  // → setForm(antigo) revertia a edição recém-salva na tela (form voltava, selo âmbar
  // reacendia, um 2º Salvar regravaria o valor velho). Chaveando SÓ em `artigo` (troca real
  // de dado do servidor) o revert some e a proteção original se mantém: (re)hidrata quando o
  // servidor muda E não há edição pendente; nunca sobrescreve o que o usuário digitou e ainda
  // não salvou (invalidação alheia / refetchOnWindowFocus com staleTime=0).
  // (só o `formDirty`: cores com rascunho não impedem de re-hidratar os campos do tecido)
  const dirtyRef = useRef(formDirty);
  dirtyRef.current = formDirty;
  useEffect(() => {
    if (artigo && !dirtyRef.current) setForm(artigo);
  }, [artigo]);

  // Colab — trava leve (rev otimista, SEM merge campo-a-campo): `revRef` espelha `artigos.rev`
  // (bump a cada UPDATE + via trigger nas variantes_tecido). Atualiza SEMPRE que o servidor manda
  // um `artigo` novo (mesmo com dirty=true) — é só o valor pra comparar no PRÓXIMO save; não mexe
  // no form. O saveMut usa `.eq("rev", revRef.current)` no WHERE do UPDATE (ver mais abaixo).
  const revRef = useRef<number | null>(null);
  useEffect(() => { if (artigo) revRef.current = artigo.rev ?? null; }, [artigo]);

  // SEM default `= []`: um `[]` novo a cada render viraria dep instável do useEffect
  // abaixo → setCatIds em loop → "Maximum update depth exceeded" (React #185), crash
  // intermitente do detalhe enquanto a query carrega. `undefined` é estável (igual `artigo`).
  const { data: catLinks } = useQuery({
    queryKey: ["artigo-cats", artigoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigo_categorias_tecido")
        .select("categoria_tecido_id")
        .eq("artigo_id", artigoId);
      if (error) throw error;
      return (data ?? []).map((r: any) => r.categoria_tecido_id as string);
    },
  });
  useEffect(() => {
    if (catLinks) setCatIds(catLinks);
  }, [catLinks]);

  // Rebaixa o baseline quando ambos (form E categorias) são carregados do servidor.
  // Depende de artigo/catLinks (valores carregados), não do estado local que pode ter edições.
  useEffect(() => {
    if (artigo && catLinks) {
      resetBaseline({ form: artigo, catIds: catLinks });
    }
  }, [artigo, catLinks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Colab — ring de presença + reação a save alheio no MESMO tecido. SEM merge campo-a-campo
  // (decisão do dono: trava leve, ver saveMut abaixo). `onMudancaServidor` só invalida — a
  // rehidratação do form respeita `dirty` (useEffect de `artigo` acima), igual ao padrão do resto
  // do sistema. Bump de filha (variantes_tecido) também dispara aqui via trigger no `artigos.rev`.
  const colabScopeRef = useRef<HTMLDivElement>(null);
  const [campoFocadoColab, setCampoFocadoColab] = useState<string | null>(null);
  const { presentes: presentesColab } = useColabRegistro({
    canal: `colab-tecido:${artigoId}`,
    tabela: "artigos",
    registroId: artigoId,
    filtroColuna: "id",
    campoFocado: campoFocadoColab,
    onMudancaServidor: () => {
      qc.invalidateQueries({ queryKey: ["artigo", artigoId] });
      qc.invalidateQueries({ queryKey: ["artigo-cats", artigoId] });
      qc.invalidateQueries({ queryKey: ["variantes", artigoId] });
    },
  });

  const { data: empresasBase = [] } = useQuery({
    queryKey: ["empresas-options", "tecido-forro-entretela"],
    queryFn: async () => {
      // Fornecedores de material + representantes + categorias; casa por TOKEN flexível
      // no cliente (o nome da categoria varia por loja — ver @/lib/fornecedor-categoria).
      const { data } = await supabase
        .from("empresas")
        .select("id,nome_fantasia,representantes(id, nome),empresa_categorias_fornecedor(categorias_fornecedor(nome))")
        .eq("tipo", "material")
        .order("nome_fantasia");
      return ((data ?? []) as any[])
        .filter((e) => empresaTemCategoria(e, FABRIC_TOKENS))
        .map((e) => ({ id: e.id as string, nome_fantasia: e.nome_fantasia as string, representantes: e.representantes ?? [] }));
    },
  });
  // O fornecedor salvo pode não ser da categoria Tecido/Forro/Entretela (ex.: mudou de categoria
  // depois). Busca o atual p/ garantir que apareça no Select — senão ficava em branco com valor salvo.
  const { data: empresaAtual } = useQuery({
    queryKey: ["empresa-por-id", artigo?.empresa_id],
    enabled: !!artigo?.empresa_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("empresas")
        .select("id,nome_fantasia,representantes(id, nome)")
        .eq("id", artigo!.empresa_id!)
        .maybeSingle();
      return data
        ? { id: data.id as string, nome_fantasia: data.nome_fantasia as string, representantes: ((data as any).representantes ?? []) as { id: string; nome: string | null }[] }
        : null;
    },
  });
  const empresas = useMemo(() => {
    const list = [...empresasBase];
    if (empresaAtual && !list.some((e) => e.id === empresaAtual.id)) list.push(empresaAtual);
    return list;
  }, [empresasBase, empresaAtual]);
  const { data: categorias = [] } = useQuery({
    queryKey: ["cat-tecido-options"],
    queryFn: async () => {
      const { data } = await supabase.from("categorias_tecido").select("id,nome").order("nome");
      return (data ?? []) as { id: string; nome: string }[];
    },
  });
  const { data: meses = [] } = useQuery({
    queryKey: ["meses-options"],
    queryFn: async () => {
      const { data } = await supabase.from("meses").select("id,mes").order("ordem");
      return (data ?? []) as { id: string; mes: string }[];
    },
  });
  const { data: anos = [] } = useQuery({
    queryKey: ["anos-options"],
    queryFn: async () => {
      const { data } = await supabase.from("anos").select("id,ano").order("ano");
      return (data ?? []) as { id: string; ano: string }[];
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const payload: any = {
        nome: form.nome,
        empresa_id: form.empresa_id || null,
        representante_id: form.representante_id || null,
        largura_estimada: form.largura_estimada ?? null,
        categoria_tecido_id: catIds[0] || null,
        composicao: form.composicao || null,
        ncm: form.ncm?.trim() || null,
        mes_id: form.mes_id || null,
        ano_id: form.ano_id || null,
        preco: form.preco ?? null,
        unidade_medida: form.unidade_medida,
        rendimento: form.unidade_medida === "kg" ? form.rendimento ?? null : null,
      };
      // Colab — TRAVA LEVE (rev otimista, SEM merge campo-a-campo): `.eq("rev", revRef.current)`
      // só casa a linha se ninguém salvou este tecido desde a última carga (o UPDATE bumpa
      // `artigos.rev` via trigger). 0 linhas devolvidas = conflito — não é erro de rede/permissão,
      // então NÃO joga o erro do Supabase (viraria toast genérico); sinaliza com um código próprio
      // pro onError tratar (recarrega + avisa, sem markClean, sem chamar set_artigo_categorias).
      // `.eq("rev", ...)`: types.ts ainda não tem a coluna `rev` (regen pendente, débito conhecido
      // — ver CLAUDE.md) — `as any` no builder inteiro, mesmo padrão já usado em ModeloDetailPanel.
      const { data: updRows, error } = await (supabase.from("artigos") as any)
        .update(payload)
        .eq("id", artigoId)
        .eq("rev", revRef.current)
        .select("id, rev");
      if (error) throw error;
      if (revRef.current != null && (!updRows || updRows.length === 0)) {
        const conflito: any = new Error("conflito_versao: o tecido foi salvo por outra pessoa");
        conflito.code = "P0409_LOCAL";
        throw conflito;
      }
      // Re-baseliza o revRef com o rev NOVO (já bumpado por este UPDATE) IMEDIATAMENTE — sem esperar
      // o refetch assíncrono do onSuccess. Sem isto, um 2º Salvar rápido mandaria o rev velho no
      // WHERE → 0 linhas → P0409 FALSO contra o próprio save anterior (lição da Explosão).
      if (updRows && updRows[0]?.rev != null) revRef.current = updRows[0].rev as number;

      // Junção de categorias, ATÔMICA (RPC): evita o tecido ficar sem nenhuma categoria caso o
      // insert falhasse após o delete (antes era delete-all + insert em 2 passos no cliente).
      // Só roda se o UPDATE acima passou (0 linhas já lançou P0409_LOCAL e abortou antes daqui).
      const { error: catErr } = await supabase.rpc("set_artigo_categorias" as any, {
        _artigo_id: artigoId,
        _cat_ids: catIds,
      });
      if (catErr) throw catErr;
    },
    onSuccess: () => {
      markClean();
      toast.success("Tecido atualizado.");
      qc.invalidateQueries({ queryKey: ["artigo", artigoId] });
      qc.invalidateQueries({ queryKey: ["artigos"] });
      qc.invalidateQueries({ queryKey: ["artigo-cats", artigoId] });
      qc.invalidateQueries({ queryKey: ["artigo-cats-all"] });
    },
    onError: (e: any) => {
      if (e?.code === "P0409_LOCAL") {
        // Conflito: NÃO markClean (mantém o dirty p/ o usuário reaplicar a edição se quiser) —
        // só recarrega a versão do servidor (sem merge campo-a-campo, decisão do dono p/ Tecido).
        toast.warning("Alguém salvou este tecido agora — recarreguei a versão mais recente; refaça sua alteração se necessário.");
        qc.invalidateQueries({ queryKey: ["artigo", artigoId] });
      } else {
        toast.error(mensagemErro(e, "Erro ao salvar."));
      }
    },
  });

  // Aplica o preço do tecido (campo Preço) a TODAS as variantes — replicar sob demanda (botão
  // ao lado do label). O trigger mantém artigos.preco = MAX(variantes). Não invalida ["artigo"]
  // p/ não resetar o form (que perderia edições não salvas de outros campos).
  const aplicarPrecoVariantesMut = useMutation({
    mutationFn: async () => {
      if (!form || form.preco == null) return;
      const { error } = await supabase
        .from("variantes_tecido")
        .update({ preco: form.preco } as any)
        .eq("artigo_id", artigoId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Preço aplicado a todas as variantes.");
      qc.invalidateQueries({ queryKey: ["variantes", artigoId] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao aplicar preço.")),
  });

  const [confirmDel, setConfirmDel] = useState(false);
  const excluirMut = useMutation({
    mutationFn: async () => {
      // RPC com GUARDA: bloqueia se o tecido estiver em uso (OC/estoque/modelo/CAD/ordem de saída)
      // e só então apaga (o delete do artigo cascateia variantes+categorias). Retorna as fotos p/
      // limpar o storage DEPOIS do delete confirmado.
      const { data, error } = await supabase.rpc("excluir_tecido" as any, { _artigo_id: artigoId });
      if (error) throw error;
      const paths = (((data as any)?.fotos ?? []) as string[]).filter(Boolean);
      if (paths.length) await supabase.storage.from(VARIANT_BUCKET).remove(paths);
    },
    onSuccess: () => {
      toast.success("Tecido excluído.");
      qc.invalidateQueries({ queryKey: ["artigos"] });
      qc.invalidateQueries({ queryKey: ["variantes-thumb"] });
      onClose();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });

  if (isLoading || !form) {
    return (
      <div className="p-6 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
        Carregando…
      </div>
    );
  }

  const isKg = form.unidade_medida === "kg";
  const precoMetro = isKg
    ? form.preco && form.rendimento
      ? Number(form.preco) / Number(form.rendimento)
      : null
    : form.preco;

  const historico: Array<{ preco: number; preco_por_metro?: number; data: string }> = Array.isArray(
    form.historico_precos,
  )
    ? form.historico_precos
    : [];

  const acoes = (
    <>
      <Button variant="outline" onClick={requestClose} aria-label="Voltar" className="shrink-0 max-sm:aspect-square max-sm:px-0">
        <ArrowLeft className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">Voltar</span>
      </Button>
      {!readOnly && (
        <Button variant="destructive" onClick={() => setConfirmDel(true)} disabled={excluirMut.isPending} aria-label="Excluir" className="shrink-0 max-sm:aspect-square max-sm:px-0">
          <Trash2 className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">Excluir</span>
        </Button>
      )}
      <Button className="ml-auto shrink-0 max-sm:aspect-square max-sm:px-0" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || readOnly} aria-label="Salvar">
        <Save className="h-4 w-4 sm:mr-1" />
        <span className="max-sm:sr-only">{saveMut.isPending ? "Salvando…" : "Salvar"}</span>
      </Button>
    </>
  );

  // Conteúdo (sem wrapper) — usado nos dois modos.
  const corpo = (
    <>
      <Breadcrumb items={[{ label: "Cadastro" }, { label: "Tecidos" }, { label: form.nome }]} />
      <header className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={requestClose} aria-label="Fechar">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">{form.nome}</h1>
          <p className="text-sm text-muted-foreground">Detalhes do tecido</p>
        </div>
        <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
      </header>

      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir tecido?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso remove o tecido "{form.nome}" e todas as variantes. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => excluirMut.mutate()}
              variant="destructive"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UnsavedChangesGuard
        confirm={confirm}
        message="Há alterações não salvas neste tecido."
      />

      <Card>
        <CardHeader>
          <CardTitle>Informações</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
        <fieldset disabled={readOnly} className="contents">
          <Field label="Nome">
            <Input
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
          </Field>

          <Field label="Fornecedor">
            {/* Dropdown único: empresa (direto) OU empresa via representante. */}
            <FornecedorSelect
              empresas={empresas}
              empresaId={form.empresa_id}
              representanteId={form.representante_id}
              onChange={(empresa_id, representante_id) => setForm({ ...form, empresa_id, representante_id })}
            />
          </Field>

          <Field label="Largura Estimada (mtr)">
            <NumberInput
              type="number"
              blankZero
              placeholder="0"
              value={form.largura_estimada ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  largura_estimada: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </Field>

          <Field label="Categorias do Tecido">
            <CategoriasTecidoMultiSelect
              options={categorias}
              value={catIds}
              onChange={setCatIds}
            />
            {catIds.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {catIds.map((cid) => {
                  const nome = categorias.find((c) => c.id === cid)?.nome ?? "—";
                  return (
                    <Badge key={cid} variant="secondary">
                      {nome}
                    </Badge>
                  );
                })}
              </div>
            )}
          </Field>

          <Field label="Composição" className="md:col-span-2">
            <Textarea
              rows={2}
              value={form.composicao ?? ""}
              onChange={(e) => setForm({ ...form, composicao: e.target.value })}
              placeholder="Ex: 100% algodão"
            />
          </Field>

          <Field label="NCM">
            <Input
              value={form.ncm ?? ""}
              onChange={(e) => setForm({ ...form, ncm: e.target.value })}
              placeholder="Ex: 5208.11.00"
              inputMode="numeric"
            />
          </Field>

          <Field label="Mês (opcional)">
            <Select
              value={form.mes_id ?? ""}
              onValueChange={(v) => setForm({ ...form, mes_id: v || null })}
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {meses.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.mes}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Ano (opcional)">
            <Select
              value={form.ano_id ?? ""}
              onValueChange={(v) => setForm({ ...form, ano_id: v || null })}
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {anos.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.ano}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Unidade de Medida">
            <Select
              value={form.unidade_medida}
              onValueChange={(v) => setForm({ ...form, unidade_medida: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="metro">Metro</SelectItem>
                <SelectItem value="kg">Kg</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>Preço</Label>
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={form.preco == null || aplicarPrecoVariantesMut.isPending}
                  onClick={() => aplicarPrecoVariantesMut.mutate()}
                  title="Aplica este preço a todas as variantes deste tecido"
                >
                  Aplicar a todas
                </Button>
              )}
            </div>
            <NumberInput
              type="number"
              step="0.01"
              blankZero
              placeholder="0,00"
              value={form.preco ?? ""}
              onChange={(e) =>
                setForm({ ...form, preco: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </div>

          {isKg && (
            <Field label="Rendimento (m/kg)">
              <NumberInput
                type="number"
                step="0.01"
                blankZero
                placeholder="0,00"
                value={form.rendimento ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    rendimento: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </Field>
          )}

          {isKg && (
            <Field label="Preço por Metro">
              <Input
                readOnly
                value={precoMetro != null ? brl(Number(precoMetro)) : "—"}
                className="bg-muted/50"
              />
            </Field>
          )}

          <div className="md:col-span-2">
            <EtiquetaLavagemArtigoEditor artigoId={artigoId} />
          </div>
        </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4" /> Histórico de Preços
          </CardTitle>
          <CardDescription>Registros automáticos a cada alteração de preço.</CardDescription>
        </CardHeader>
        <CardContent>
          {historico.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Nenhuma alteração registrada.</p>
          ) : (
            <ul className="space-y-2">
              {[...historico].reverse().map((h, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between rounded-md border bg-card p-2 text-sm"
                >
                  <span>{brl(Number(h.preco))}</span>
                  <span className="text-xs text-muted-foreground">
                    {fmtDataHora(h.data)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <VariantesSection artigoId={artigoId} readOnly={readOnly} precoArtigo={form.preco ?? null} onSujosChange={setNCoresSujas} />
    </>
  );

  // Ring de presença por campo (colab): foco é derivado no container via `pathDoElemento`
  // (auto-instrumentado — nenhum campo precisa de marcação manual). `onFocusCapture`/
  // `onBlurCapture` no container rolável; o overlay reencontra o elemento pelo path recebido
  // via broadcast das outras abas.
  const onFocusColab = (e: React.FocusEvent) => {
    const scope = colabScopeRef.current;
    setCampoFocadoColab(scope ? pathDoElemento(e.target as HTMLElement, scope) : null);
  };
  const onBlurColab = () => setCampoFocadoColab(null);

  // EMBUTIDO num Sheet: flex-col ocupando a altura toda → corpo rolável (flex-1 overflow) + rodapé
  // FIXO (shrink-0) sempre colado embaixo. (sticky brigava com o padding do SheetContent.) PÁGINA
  // inteira: fluxo normal + PageActionBar (portal no rodapé do viewport).
  return embedded ? (
    <div className="flex h-full flex-col">
      <div
        ref={colabScopeRef}
        className="relative flex-1 space-y-6 overflow-y-auto p-4 sm:p-6"
        onFocusCapture={onFocusColab}
        onBlurCapture={onBlurColab}
      >
        <ColabPresenceOverlay presentes={presentesColab} scopeRef={colabScopeRef} />
        {corpo}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t bg-background p-3">{acoes}</div>
    </div>
  ) : (
    <div
      ref={colabScopeRef}
      className="relative space-y-6"
      onFocusCapture={onFocusColab}
      onBlurCapture={onBlurColab}
    >
      <ColabPresenceOverlay presentes={presentesColab} scopeRef={colabScopeRef} />
      {corpo}
      <PageActionBar>{acoes}</PageActionBar>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

// ============= Variants =============

export function VariantesSection({ artigoId, readOnly, precoArtigo, onSujosChange }: {
  artigoId: string; readOnly: boolean; precoArtigo: number | null;
  /** nº de cores com rascunho não salvo (a tela do tecido soma à guarda de "alterações não salvas") */
  onSujosChange?: (n: number) => void;
}) {
  const qc = useQueryClient();
  const [removeTarget, setRemoveTarget] = useState<Variante | null>(null);
  const [addBase, setAddBase] = useState<string>("");
  const [addApelido, setAddApelido] = useState<string>("");

  const { data: cores = [] } = useQuery({
    queryKey: ["cores-options"],
    queryFn: async () => {
      const { data } = await supabase.from("cores").select("id,nome").order("nome");
      return (data ?? []) as Cor[];
    },
  });

  const { data: apelidos = [] } = useQuery({
    queryKey: ["cores-apelido-options"],
    queryFn: async () => {
      const { data } = await supabase.from("cores_apelido").select("id,nome,cor_base_id").order("nome");
      return (data ?? []) as Apelido[];
    },
  });

  const { data: variantes = [] } = useQuery({
    queryKey: ["variantes", artigoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido")
        .select("*")
        .eq("artigo_id", artigoId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as Variante[]; // types.ts ainda sem preco/historico_precos
    },
  });

  // Rollup consolidado (manual + por-OC + rolo) p/ mostrar a seção read-only "Também em".
  const { data: rollup } = useEnderecosRollup();

  const coresMap = useMemo(() => new Map(cores.map((c) => [c.id, c.nome])), [cores]);
  const apelidosMap = useMemo(() => new Map(apelidos.map((a) => [a.id, a.nome])), [apelidos]);
  const apelidoBase = useMemo(() => new Map(apelidos.map((a) => [a.id, a.cor_base_id])), [apelidos]);

  const addVarMut = useMutation({
    mutationFn: async ({ corId, apelidoId }: { corId: string; apelidoId: string }) => {
      // nome_variante é OPCIONAL (nome comercial, ex.: "Malha") — NÃO auto-gerar a partir
      // de cor. O rótulo em toda tela é montado por nome + cor + apelido (helper).
      // Apelido é OPCIONAL. Variante nova HERDA o preço do artigo (default replicável).
      const { error } = await supabase
        .from("variantes_tecido")
        .insert({ artigo_id: artigoId, cor_id: corId, cor_apelido_id: apelidoId || null, preco: precoArtigo ?? null } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      setAddBase(""); setAddApelido("");
      qc.invalidateQueries({ queryKey: ["variantes", artigoId] });
      qc.invalidateQueries({ queryKey: ["variantes-thumb"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao adicionar.")),
  });

  const removeVarMut = useMutation({
    mutationFn: async (v: Variante) => {
      // RPC com GUARDA: bloqueia se a cor estiver em uso. A foto do storage só sai DEPOIS do delete
      // OK (antes era removida ANTES — se o delete falhasse, sobrava thumbnail órfão).
      const { data, error } = await supabase.rpc("excluir_variante_tecido" as any, { _variante_id: v.id });
      if (error) throw error;
      const foto = (data as any)?.foto_url as string | null;
      if (foto) await supabase.storage.from(VARIANT_BUCKET).remove([foto]);
    },
    onSuccess: () => {
      setRemoveTarget(null);
      qc.invalidateQueries({ queryKey: ["variantes", artigoId] });
      qc.invalidateQueries({ queryKey: ["variantes-thumb"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao remover.")),
  });

  const jaExiste = variantes.some((v) => v.cor_id === addBase && v.cor_apelido_id === (addApelido || null));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cores e Variantes</CardTitle>
        <CardDescription>
          Cada variante é uma cor: escolha a <strong>cor base</strong> e o{" "}
          <strong>apelido</strong> (vinculados) e adicione.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Adicionar variante — cor base ↔ cor apelido vinculados (apelido obrigatório).
            Escolher a base filtra os apelidos daquela base; escolher o apelido preenche a base. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Cor base</Label>
            <Select
              value={addBase}
              onValueChange={(b) => {
                setAddBase(b);
                if (addApelido && apelidoBase.get(addApelido) !== b) setAddApelido("");
              }}
              disabled={readOnly}
            >
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione a cor" /></SelectTrigger>
              <SelectContent>
                {cores.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Cor apelido</Label>
            <Select
              value={addApelido}
              onValueChange={(a) => {
                setAddApelido(a);
                const base = apelidoBase.get(a);
                if (base) setAddBase(base);
              }}
              disabled={readOnly}
            >
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o apelido" /></SelectTrigger>
              <SelectContent>
                {(addBase ? apelidos.filter((a) => a.cor_base_id === addBase) : apelidos).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.nome}{!addBase && a.cor_base_id ? ` · ${coresMap.get(a.cor_base_id) ?? ""}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            className="shrink-0"
            disabled={readOnly || !addBase || jaExiste || addVarMut.isPending}
            onClick={() => addVarMut.mutate({ corId: addBase, apelidoId: addApelido })}
          >
            <Plus className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">Adicionar</span>
          </Button>
        </div>
        {jaExiste && (
          <p className="text-xs text-amber-600">Essa cor (com esse apelido) já existe neste tecido.</p>
        )}
        {cores.length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            Cadastre cores em Atributos primeiro.
          </p>
        )}

        {variantes.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Nenhuma variante criada ainda.</p>
        ) : (
          // "Salvar por card": cada cor é um rascunho (✓ Salvar / ↺ Desfazer); o provider soma os sujos para a barra
          // "Salvar todos" e para a guarda de saída. Foto e endereços continuam gravando na hora.
          <CardDraftsProvider>
            <RelataCoresSujas onChange={onSujosChange} />
            {!readOnly && <BarraSalvarTodasCores />}
            <ul className="space-y-2">
              {variantes.map((v) => (
                <VariantRow
                  key={v.id}
                  variante={v}
                  corLabel={v.cor_id ? coresMap.get(v.cor_id) ?? "—" : "—"}
                  apelidoLabel={v.cor_apelido_id ? apelidosMap.get(v.cor_apelido_id) ?? null : null}
                  cores={cores}
                  apelidos={apelidos}
                  enderecosDaVariante={rollup?.get(v.id) ?? []}
                  onRemove={() => setRemoveTarget(v)}
                  readOnly={readOnly}
                />
              ))}
            </ul>
          </CardDraftsProvider>
        )}
      </CardContent>

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Isso irá excluir a variante. Tem certeza?</AlertDialogTitle>
            <AlertDialogDescription>
              A cor{" "}
              <strong>
                {removeTarget?.cor_id ? coresMap.get(removeTarget.cor_id) ?? "—" : "—"}
              </strong>{" "}
              será removida do tecido. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (removeTarget) removeVarMut.mutate(removeTarget);
              }}
              variant="destructive"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ============= Salvar por card (cores) =============

/** Os 5 campos do rascunho de uma cor. "" = vazio nos textos/Selects; `preco` é NÚMERO (ou null). */
export type VarianteDraft = {
  cor_id: string;
  cor_apelido_id: string;
  nome_variante: string;
  codigo_variante: string;
  preco: number | null;
};
const CAMPOS_RASCUNHO: Array<keyof VarianteDraft> = ["cor_id", "cor_apelido_id", "nome_variante", "codigo_variante", "preco"];

export function varianteParaDraft(v: Pick<Variante, "cor_id" | "cor_apelido_id" | "nome_variante" | "codigo_variante" | "preco">): VarianteDraft {
  return {
    cor_id: v.cor_id ?? "",
    cor_apelido_id: v.cor_apelido_id ?? "",
    nome_variante: v.nome_variante ?? "",
    codigo_variante: v.codigo_variante ?? "",
    preco: v.preco == null ? null : Number(v.preco),
  };
}

/**
 * Texto do MoneyInput -> número. O `MoneyInput` já emite o canônico (ponto decimal: "20.5"), mas aceitamos também o texto
 * mascarado pt-BR ("1.234,56") pelo parser do money-mask (`maskLive`) — NUNCA `Number()` cru sobre texto com vírgula (dá NaN
 * com centavos: bug real do projeto no blur do preço fixo do Produto Acabado). Vazio/inválido = null.
 */
export function canonicoParaNumero(s: string | number | null | undefined): number | null {
  if (s == null) return null;
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  const t = s.trim();
  if (t === "") return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const { canonical } = maskLive(t, 2);
  if (canonical === "") return null;
  const n = Number(canonical);
  return Number.isFinite(n) ? n : null;
}

/**
 * Rascunho -> payload da RPC `salvar_variante_tecido`: uuid em MINÚSCULO (null quando vazio), texto vazio = null, `preco`
 * NÚMERO JSON (nunca string). A RPC compara por valor (`_base` x banco x `_mudancas`): string/maiúscula daria conflito falso.
 */
export function draftParaServidor(d: Partial<VarianteDraft>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(d) as Array<keyof VarianteDraft>) {
    const v = d[k];
    if (k === "cor_id" || k === "cor_apelido_id") out[k] = v ? String(v).toLowerCase() : null;
    else if (k === "preco") out[k] = v == null ? null : Number(v);
    else out[k] = v === "" || v == null ? null : v;
  }
  return out;
}

/** Erro já mostrado ao usuário (toast) — o `salvar` do hook relança para a barra "Salvar todos" contar como erro. */
class SalvarCorJaTratado extends Error {
  constructor(m = "salvar_cor_tratado") { super(m); this.name = "SalvarCorJaTratado"; }
}

const TEXTO_COR_DUPLICADA = "Já existe uma variante com essa cor e apelido.";
function mensagemSalvarCor(e: unknown): string {
  // 23505 aqui só pode ser o índice único parcial (artigo, cor, apelido): o texto genérico de "valor duplicado" não diz o quê.
  if ((e as { code?: string } | null)?.code === "23505") return TEXTO_COR_DUPLICADA;
  return mensagemErro(e, "Erro ao salvar a cor.");
}

/** Texto da prévia de preço. `afetados` é o TETO (a conta de custo é do servidor): por isso o "até". */
export function textoPreviaPreco(afetados: number | null | undefined): string | null {
  if (!afetados || afetados <= 0) return null;
  return afetados === 1
    ? "até 1 produto terá o custo recalculado"
    : `até ${afetados} produtos terão o custo recalculado`;
}

function RelataCoresSujas({ onChange }: { onChange?: (n: number) => void }) {
  const { nSujos } = useCardDrafts();
  useEffect(() => {
    onChange?.(nSujos);
    return () => onChange?.(0);
  }, [nSujos, onChange]);
  return null;
}

function BarraSalvarTodasCores() {
  const { nSujos, salvarTodos } = useCardDrafts();
  const [salvando, setSalvando] = useState(false);
  if (nSujos < 2) return null; // com 1 cor suja o ✓ da própria cor basta
  const onClick = async () => {
    setSalvando(true);
    try {
      const { ok, erro } = await salvarTodos();
      if (erro > 0) toast.error(`${ok} ${ok === 1 ? "cor salva" : "cores salvas"}, ${erro} com erro.`);
      else if (ok > 0) toast.success(`${ok} ${ok === 1 ? "cor salva" : "cores salvas"}.`);
    } finally { setSalvando(false); }
  };
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
      <span className="text-sm text-amber-700 dark:text-amber-400">
        {`${nSujos} cores com alterações não salvas`}
      </span>
      <Button type="button" size="sm" onClick={onClick} disabled={salvando}>
        {salvando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
        Salvar todos ({nSujos})
      </Button>
    </div>
  );
}

/** Conflito de UM campo (outra pessoa mudou o que eu também editei): "manter meu / usar o novo", dentro da cor. */
function ConflitoCampo({ dele, onManter, onUsarNovo }: { dele: string; onManter: () => void; onUsarNovo: () => void }) {
  return (
    <div role="alert" className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
      <p className="text-amber-700 dark:text-amber-400">Outra pessoa mudou este campo para <strong>{dele}</strong>.</p>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onManter}>Manter meu</Button>
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onUsarNovo}>Usar o novo</Button>
      </div>
    </div>
  );
}

function VariantRow({
  variante,
  corLabel,
  apelidoLabel,
  cores,
  apelidos,
  enderecosDaVariante,
  onRemove,
  readOnly,
}: {
  variante: Variante;
  corLabel: string;
  apelidoLabel: string | null;
  cores: Cor[];
  apelidos: Apelido[];
  enderecosDaVariante: EnderecoRollup[];
  onRemove: () => void;
  readOnly: boolean;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const photoUrl = useSignedUrl(variante.foto_url);

  // ---- Salvar por card -------------------------------------------------------------------------------------------
  // `base` = os 5 campos vindos do servidor. MEMOIZADO pelos valores: o hook compara a identidade (base nova a cada render
  // re-ancoraria o rascunho limpo toda vez = loop de render).
  const base = useMemo<VarianteDraft>(
    () => varianteParaDraft(variante),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [variante.cor_id, variante.cor_apelido_id, variante.nome_variante, variante.codigo_variante, variante.preco],
  );

  // Prévia do efeito do preço (só leitura, no servidor): "até N produtos terão o custo recalculado". A assinatura dela é a
  // que o Salvar manda de volta (o servidor confere que a lista de afetados não mudou).
  const [previaPausa, setPreviaPausa] = useState(false); // desliga/religa para REPEDIR a prévia (previa_desatualizada)
  const [previaMudou, setPreviaMudou] = useState(false);
  const [vPreco, setVPreco] = useState(0); // remonta o MoneyInput ao descartar/adotar valor (ele não re-sincroniza em foco)
  const [conflitos, setConflitos] = useState<Partial<Record<keyof VarianteDraft, { meu: unknown; dele: unknown }>>>({});
  const conflitosRef = useRef(conflitos);
  conflitosRef.current = conflitos;
  const ultimoEnviadoRef = useRef<Partial<VarianteDraft>>({});
  const previaRef = useRef<{ carregando: boolean; assinatura: string | null }>({ carregando: false, assinatura: null });

  const salvarFn = useCallback(async (mudancas: Partial<VarianteDraft>, baseEnviada: VarianteDraft) => {
    if (Object.keys(conflitosRef.current).length > 0) {
      toast.warning("Resolva os campos em conflito desta cor (manter meu / usar o novo) antes de salvar.");
      throw new SalvarCorJaTratado();
    }
    const tocouPreco = "preco" in mudancas;
    if (tocouPreco) {
      // Espera a prévia terminar (digitou e já clicou ✓ / "Salvar todos"): não manda assinatura velha.
      const limite = Date.now() + 5000;
      while (previaRef.current.carregando && Date.now() < limite) await new Promise((r) => setTimeout(r, 40));
      if (previaRef.current.carregando) {
        toast.warning("Aguarde o cálculo do efeito do preço e tente de novo.");
        throw new SalvarCorJaTratado();
      }
      if (previaRef.current.assinatura == null) {
        // a prévia terminou e FALHOU (sem assinatura): re-editar o preço repede a prévia (args novos)
        toast.warning("Não consegui calcular o efeito do preço. Edite o valor para tentar de novo.");
        throw new SalvarCorJaTratado();
      }
    }
    const { error } = await supabase.rpc("salvar_variante_tecido" as any, {
      _id: variante.id,
      _mudancas: draftParaServidor(mudancas),
      _base: draftParaServidor(baseEnviada),
      _assinatura: tocouPreco ? previaRef.current.assinatura : null, // só vai com o preço (sem preço não há o que conferir)
    } as any);
    if (!error) { ultimoEnviadoRef.current = { ...ultimoEnviadoRef.current, ...mudancas }; return; }

    const code = (error as { code?: string }).code;
    const msg = String((error as { message?: string }).message ?? "");
    if (code === "P0409" && msg.startsWith("conflito_versao")) {
      // Outra pessoa salvou esta cor no meio: relê do servidor — o efeito de `base` abaixo faz o merge 3-vias (campo que
      // eu não toquei adota o dela; campo que os dois mexeram vira conflito "manter meu / usar o novo").
      await qc.refetchQueries({ queryKey: ["variantes", variante.artigo_id] });
      toast.warning("Outra pessoa alterou esta cor. Atualizei o que você não tinha mexido — confira antes de salvar de novo.");
      throw new SalvarCorJaTratado();
    }
    if (code === "P0409" && msg.startsWith("previa_desatualizada")) {
      // A lista de produtos afetados mudou desde a prévia: NÃO grava; repede a prévia e avisa.
      setPreviaMudou(true);
      setPreviaPausa(true);
      await new Promise((r) => setTimeout(r, 0));
      setPreviaPausa(false);
      toast.warning("O resultado mudou — confira o novo número de produtos e salve de novo.");
      throw new SalvarCorJaTratado();
    }
    toast.error(mensagemSalvarCor(error));
    throw new SalvarCorJaTratado();
  }, [variante.id, variante.artigo_id, qc]);

  const onSalvo = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["variantes", variante.artigo_id] });
    qc.invalidateQueries({ queryKey: ["variantes-thumb"] });
    qc.invalidateQueries({ queryKey: ["artigos"] });
  }, [qc, variante.artigo_id]);

  const draft = useCardDraft<VarianteDraft>({ id: variante.id, base, salvarFn, onSalvo });
  const { valor, patch } = draft;
  const tocouPreco = !Object.is(valor.preco, base.preco);

  const previa = usePreviaServidor<{ afetados: number; assinatura: string }>({
    rpc: "variante_tecido_preco_previa",
    args: { _id: variante.id, _preco: valor.preco },
    habilitado: tocouPreco && !readOnly && !previaPausa,
  });
  previaRef.current = { carregando: previa.carregando || previaPausa, assinatura: previa.assinatura };
  useEffect(() => { if (previa.assinatura) setPreviaMudou(false); }, [previa.assinatura]);
  // M4: o hook MANTÉM o último `resultado` enquanto repede (só zera ao desabilitar/falhar) — então, recalculando, o último
  // "até N" continua na tela (esmaecido, com spinner) em vez de trocar por "calculando…" a cada tecla (piscava e empurrava o layout).
  const textoPrevia = tocouPreco ? textoPreviaPreco(previa.resultado?.afetados) : null;
  const recalculandoPrevia = tocouPreco && previa.carregando;

  // Base do servidor mudou com o card SUJO (outra pessoa salvou / "Aplicar a todas" / realtime): merge 3-vias por campo.
  // O hook já re-ancorou a base dele (o efeito dele roda antes deste), então `patch(k, base[k])` não marca como tocado.
  const baseAnteriorRef = useRef(base);
  useEffect(() => {
    const anterior = baseAnteriorRef.current;
    baseAnteriorRef.current = base;
    if (anterior === base || !draft.dirty) return; // limpo: o hook re-ancora sozinho
    const meu = draft.valor;
    const enviado = ultimoEnviadoRef.current;
    // "tocado" = difere da base ANTERIOR e não é o que eu mesmo acabei de gravar com sucesso
    const tocados = new Set<string>(CAMPOS_RASCUNHO.filter((k) => !igual(meu[k], anterior[k]) && !(k in enviado && igual(meu[k], enviado[k]))));
    const m = mergeDraft<VarianteDraft>({ base: anterior, draft: meu, fresh: base, touched: tocados });
    for (const k of m.atualizados as Array<keyof VarianteDraft>) {
      patch(k, base[k]);
      if (k === "preco") setVPreco((n) => n + 1);
    }
    setConflitos((velhos) => {
      const novos: Partial<Record<keyof VarianteDraft, { meu: unknown; dele: unknown }>> = {};
      for (const k of CAMPOS_RASCUNHO) {
        if (igual(meu[k], base[k])) continue; // convergiu: não há mais o que decidir
        const novo = m.conflitos.some((c) => c.path === k);
        // o valor do servidor é o que EU gravei há pouco = não é conflito (só uma edição minha posterior)
        if (novo && !(k in enviado && igual(base[k], enviado[k]))) novos[k] = { meu: meu[k], dele: base[k] };
        else if (velhos[k] && !novo) novos[k] = { meu: meu[k], dele: base[k] };
      }
      return novos;
    });
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  const rotuloValor = (k: keyof VarianteDraft, v: unknown): string => {
    if (k === "cor_id") return cores.find((c) => c.id === v)?.nome ?? "(vazio)";
    if (k === "cor_apelido_id") return apelidos.find((a) => a.id === v)?.nome ?? "(vazio)";
    if (k === "preco") return v == null ? "(sem preço)" : brl(Number(v));
    return v ? String(v) : "(vazio)";
  };
  const campoConflito = (k: keyof VarianteDraft) => {
    const c = conflitos[k];
    if (!c) return null;
    return (
      <ConflitoCampo
        dele={rotuloValor(k, c.dele)}
        onManter={() => setConflitos((o) => { const n = { ...o }; delete n[k]; return n; })}
        onUsarNovo={() => {
          patch(k, base[k]);
          if (k === "preco") setVPreco((n) => n + 1);
          setConflitos((o) => { const n = { ...o }; delete n[k]; return n; });
        }}
      />
    );
  };

  const salvarClique = async () => {
    try { await draft.salvar(); toast.success("Cor salva."); } catch { /* já tratado (toast) em salvarFn */ }
  };
  const descartarClique = () => {
    draft.descartar();
    setConflitos({});
    setPreviaMudou(false);
    setVPreco((n) => n + 1);
  };

  // Enter (num campo de texto, card sujo) salva; Esc desfaz. Só age em eventos que vêm dos 5 campos do rascunho
  // (`data-rascunho`), nunca de dentro de um Select aberto (a lista é portal: o evento sobe pela árvore React, mas o alvo
  // não está num campo marcado) nem do editor de endereços.
  const onKeyDownCard = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (readOnly || !draft.dirty || e.nativeEvent.isComposing) return;
    const alvo = e.target as HTMLElement;
    if (!alvo.closest("[data-rascunho]") || alvo.closest('[role="listbox"]') || alvo.tagName === "TEXTAREA") return;
    // Esc NÃO checa `defaultPrevented`: dentro do Sheet o `SheetContent` já deu preventDefault (para o Radix não fechar o
    // Sheet — ver `escapeEmCardSujo`) e é justamente aqui que a cor é desfeita. Enter: não repete durante o salvar em voo.
    if (e.key === "Enter" && alvo.tagName === "INPUT" && !e.defaultPrevented && !draft.salvando) { e.preventDefault(); void salvarClique(); }
    else if (e.key === "Escape") { e.preventDefault(); descartarClique(); }
  };

  // ---- Foto (grava NA HORA, fora do rascunho — P-271) -----------------------------------------------------------
  const saveMut = useMutation({
    mutationFn: async (patchFoto: { foto_url: string }) => {
      const { error } = await supabase.from("variantes_tecido").update(patchFoto as any).eq("id", variante.id);
      if (error) throw error;
    },
    onSuccess: onSalvo,
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar.")),
  });

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      const { tenantPrefix } = await import("@/lib/storage-tenant");
      const tenant = await tenantPrefix();
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${tenant}/${variante.artigo_id}/${variante.id}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(VARIANT_BUCKET)
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      if (variante.foto_url && variante.foto_url !== path) {
        await supabase.storage.from(VARIANT_BUCKET).remove([variante.foto_url]);
      }
      saveMut.mutate({ foto_url: path });
      toast.success("Foto atualizada.");
    } catch (e: any) {
      toast.error(mensagemErro(e, "Erro ao enviar foto."));
    } finally {
      setUploading(false);
    }
  };

  return (
    <li className="rounded-lg border bg-card overflow-hidden" data-card-sujo={draft.dirty ? "" : undefined}>
      {/* Clicar em qualquer ponto da linha expande/recolhe (exceto a foto e os botões). */}
      <div
        className="flex items-center gap-3 p-2 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <div
          className="h-12 w-12 rounded bg-muted overflow-hidden flex items-center justify-center shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {photoUrl ? (
            <ImagePreview src={photoUrl} alt={corLabel}>
              <img src={photoUrl} alt={corLabel} className="w-full h-full object-cover" />
            </ImagePreview>
          ) : (
            <ImageOff className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            {varianteLabel({ nome: variante.nome_variante, cor: corLabel, apelido: apelidoLabel })}
          </p>
          <p className="text-xs text-muted-foreground line-clamp-1">
            {variante.codigo_variante || variante.nome_variante || "Sem código"}
          </p>
          <p className="text-xs font-medium">
            {variante.preco != null
              ? brl(Number(variante.preco))
              : <span className="text-muted-foreground font-normal">Sem preço</span>}
          </p>
        </div>
        {!readOnly && (
          <CardSaveControls
            dirty={draft.dirty}
            salvando={draft.salvando}
            onSalvar={salvarClique}
            onDescartar={descartarClique}
            labelSalvar="Salvar esta cor"
            labelDescartar="Desfazer esta cor"
          />
        )}
        <Button variant="ghost" size="icon" aria-label={expanded ? "Recolher" : "Expandir"} aria-expanded={expanded} onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" aria-label="Remover variante" onClick={(e) => { e.stopPropagation(); onRemove(); }} disabled={readOnly}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
      {expanded && (
        <div className="grid gap-3 p-3 border-t md:grid-cols-3 bg-muted/30" onKeyDown={onKeyDownCard}>
          {/* Cor base ↔ apelido editáveis (p/ acertar variantes antigas sem apelido). Vão para o RASCUNHO da cor (✓ Salvar /
              ↺ Desfazer no cabeçalho); escolher apelido preenche a base. */}
          <div className="space-y-1.5" data-rascunho>
            <Label>Cor base</Label>
            <Select
              value={valor.cor_id}
              onValueChange={(b) => {
                patch("cor_id", b);
                // apelido que não é desta base sai junto (a RPC recebe cor_id e cor_apelido_id=null no MESMO Salvar)
                const keep = apelidos.some((a) => a.id === valor.cor_apelido_id && a.cor_base_id === b) ? valor.cor_apelido_id : "";
                patch("cor_apelido_id", keep);
              }}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue placeholder="Selecione a cor" /></SelectTrigger>
              <SelectContent>
                {cores.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            {campoConflito("cor_id")}
          </div>
          <div className="space-y-1.5" data-rascunho>
            <Label>Cor apelido</Label>
            <Select
              value={valor.cor_apelido_id}
              onValueChange={(a) => {
                const baseDoApelido = apelidos.find((x) => x.id === a)?.cor_base_id ?? valor.cor_id;
                patch("cor_apelido_id", a);
                patch("cor_id", baseDoApelido);
              }}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue placeholder="Selecione o apelido" /></SelectTrigger>
              <SelectContent>
                {(valor.cor_id ? apelidos.filter((a) => a.cor_base_id === valor.cor_id) : apelidos).map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {campoConflito("cor_apelido_id")}
          </div>
          <div className="space-y-1.5" data-rascunho>
            <Label>Nome comercial (opcional)</Label>
            <Input
              value={valor.nome_variante}
              onChange={(e) => patch("nome_variante", e.target.value)}
              readOnly={readOnly}
            />
            {campoConflito("nome_variante")}
          </div>
          <div className="space-y-1.5" data-rascunho>
            <Label>Código</Label>
            <Input
              value={valor.codigo_variante}
              onChange={(e) => patch("codigo_variante", e.target.value)}
              readOnly={readOnly}
            />
            {campoConflito("codigo_variante")}
          </div>
          {/* Preço POR VARIANTE. O preço de referência do artigo = o maior das variantes.
              Ícone de histórico AO LADO do input (label simples, alinha com o campo Código). */}
          <div className="space-y-1.5" data-rascunho>
            {/* Altura reservada (min-h-5) e SEM quebra de linha: a prévia aparecer/sumir/recalcular não empurra o resto. */}
            <div data-previa-linha className="flex min-h-5 flex-nowrap items-center justify-between gap-x-2">
              <Label className="shrink-0">Preço</Label>
              {textoPrevia && (
                <span
                  data-previa-texto
                  title={`ao salvar, ${textoPrevia}`}
                  className={cn(
                    "flex min-w-0 items-center gap-1 text-xs text-amber-700 transition-opacity dark:text-amber-400",
                    recalculandoPrevia && "opacity-60",
                  )}
                >
                  <span className="truncate">ao salvar, {textoPrevia}</span>
                  {recalculandoPrevia && <Loader2 data-previa-calculando aria-label="calculando o efeito" className="h-3 w-3 shrink-0 animate-spin" />}
                </span>
              )}
              {!textoPrevia && recalculandoPrevia && (
                <Loader2 data-previa-calculando aria-label="calculando o efeito" className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
              )}
            </div>
            <div className="flex items-center gap-1">
              <MoneyInput
                key={`preco-${vPreco}`}
                fixedDecimals
                placeholder="0,00"
                className="flex-1"
                value={valor.preco}
                onChange={(e) => patch("preco", canonicoParaNumero(e.target.value))}
                readOnly={readOnly}
              />
              {(variante.historico_precos?.length ?? 0) > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="Histórico de preço da variante" title="Histórico de preço">
                      <History className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-56 p-2">
                    <p className="mb-1 text-xs font-semibold">Histórico de preço</p>
                    <ul className="space-y-1">
                      {[...(variante.historico_precos ?? [])].reverse().map((h, i) => (
                        <li key={i} className="flex items-center justify-between text-xs">
                          <span>{brl(Number(h.preco))}</span>
                          <span className="text-muted-foreground">{fmtDataHora(h.data)}</span>
                        </li>
                      ))}
                    </ul>
                  </PopoverContent>
                </Popover>
              )}
            </div>
            {previaMudou && <p className="text-xs text-amber-700 dark:text-amber-400">O resultado mudou — confira o número de produtos.</p>}
            {campoConflito("preco")}
          </div>
          <div className="space-y-1.5 md:col-span-3">
            <Label>Endereços</Label>
            {/* Editor CONSOLIDADO: edita manual + por OC + por rolo aqui mesmo (cada um vai
                pro store certo). Rótulo da origem (OC/Rolo) sob a linha. Grava NA HORA (fora do rascunho). */}
            <EnderecoConsolidadoEditor varianteId={variante.id} rows={enderecosDaVariante} readOnly={readOnly} />
          </div>
          <div className="space-y-1.5">
            <Label>Foto</Label>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUpload(file);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              className="w-full"
              onClick={() => inputRef.current?.click()}
              disabled={uploading || readOnly}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-1" />
              )}
              {photoUrl ? "Trocar foto" : "Enviar foto"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function CategoriasTecidoMultiSelect({
  options,
  value,
  onChange,
  placeholder = "Selecione categorias…",
}: {
  options: { id: string; nome: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabels = options.filter((o) => value.includes(o.id)).map((o) => o.nome);
  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else onChange([...value, id]);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between font-normal">
          <span className="truncate text-left">
            {selectedLabels.length === 0
              ? placeholder
              : selectedLabels.length <= 2
                ? selectedLabels.join(", ")
                : `${selectedLabels.length} categorias`}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="max-h-64 overflow-y-auto space-y-1">
          {options.length === 0 ? (
            <div className="text-sm text-muted-foreground p-2">Nenhuma categoria cadastrada.</div>
          ) : (
            options.map((o) => (
              <label
                key={o.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={value.includes(o.id)}
                  onCheckedChange={() => toggle(o.id)}
                />
                <span className="text-sm">{o.nome}</span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

