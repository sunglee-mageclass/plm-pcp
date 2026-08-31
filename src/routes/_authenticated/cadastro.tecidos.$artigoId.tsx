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
import { useReadOnly } from "@/components/RequirePermission";
import { useUnsavedGuard, UnsavedChangesGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";

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

export function TecidoDetail({ artigoId, onClose, embedded = false }: { artigoId: string; onClose: () => void; embedded?: boolean }) {
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

  // Guarda de alterações não salvas (Case C: full-page — não há open gate).
  // Snapshot cobre o form inteiro + catIds (categorias também são editáveis).
  const formSnapshot = useMemo(() => ({ form, catIds }), [form, catIds]);
  const { dirty, markClean, reset: resetBaseline } = useDirtySnapshot(formSnapshot);
  const { requestClose, confirm } = useUnsavedGuard({
    dirty,
    onClose: useCallback(() => onClose(), [onClose]),
    // Página inteira (embedded=false) bloqueia a navegação de rota; embutido em Sheet
    // (embedded=true) deixa false — o guarda já age no fechar via onClose acima.
    blockNav: !embedded,
  });

  // `dirty` é lido via ref DENTRO do effect, NÃO como dependência. Depender de `dirty`
  // fazia o effect re-disparar no instante em que `markClean()` (pós-save) zera o dirty
  // enquanto o cache de ["artigo"] ainda tem o valor ANTIGO (o invalidate refetcha async)
  // → setForm(antigo) revertia a edição recém-salva na tela (form voltava, selo âmbar
  // reacendia, um 2º Salvar regravaria o valor velho). Chaveando SÓ em `artigo` (troca real
  // de dado do servidor) o revert some e a proteção original se mantém: (re)hidrata quando o
  // servidor muda E não há edição pendente; nunca sobrescreve o que o usuário digitou e ainda
  // não salvou (invalidação alheia / refetchOnWindowFocus com staleTime=0).
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (artigo && !dirtyRef.current) setForm(artigo);
  }, [artigo]);

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
      const { error } = await supabase.from("artigos").update(payload).eq("id", artigoId);
      if (error) throw error;

      // Junção de categorias, ATÔMICA (RPC): evita o tecido ficar sem nenhuma categoria caso o
      // insert falhasse após o delete (antes era delete-all + insert em 2 passos no cliente).
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
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar.")),
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

      <VariantesSection artigoId={artigoId} readOnly={readOnly} precoArtigo={form.preco ?? null} />
    </>
  );

  // EMBUTIDO num Sheet: flex-col ocupando a altura toda → corpo rolável (flex-1 overflow) + rodapé
  // FIXO (shrink-0) sempre colado embaixo. (sticky brigava com o padding do SheetContent.) PÁGINA
  // inteira: fluxo normal + PageActionBar (portal no rodapé do viewport).
  return embedded ? (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">{corpo}</div>
      <div className="flex shrink-0 items-center gap-2 border-t bg-background p-3">{acoes}</div>
    </div>
  ) : (
    <div className="space-y-6">
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

function VariantesSection({ artigoId, readOnly, precoArtigo }: { artigoId: string; readOnly: boolean; precoArtigo: number | null }) {
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
  const [nome, setNome] = useState(variante.nome_variante ?? "");
  const [codigo, setCodigo] = useState(variante.codigo_variante ?? "");
  const [corId, setCorId] = useState(variante.cor_id ?? "");
  const [apelidoId, setApelidoId] = useState(variante.cor_apelido_id ?? "");
  const [preco, setPreco] = useState(variante.preco?.toString() ?? "");
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const photoUrl = useSignedUrl(variante.foto_url);
  // Preço pode mudar por FORA (botão "Aplicar a todas" do tecido) → re-sincroniza o campo.
  useEffect(() => { setPreco(variante.preco?.toString() ?? ""); }, [variante.preco]);

  const saveMut = useMutation({
    mutationFn: async (patch: Partial<Variante>) => {
      const { error } = await supabase.from("variantes_tecido").update(patch as any).eq("id", variante.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["variantes", variante.artigo_id] });
      qc.invalidateQueries({ queryKey: ["variantes-thumb"] });
      qc.invalidateQueries({ queryKey: ["artigos"] });
    },
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
    <li className="rounded-lg border bg-card overflow-hidden">
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
        <Button variant="ghost" size="icon" aria-label={expanded ? "Recolher" : "Expandir"} aria-expanded={expanded} onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" aria-label="Remover variante" onClick={(e) => { e.stopPropagation(); onRemove(); }} disabled={readOnly}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
      {expanded && (
        <div className="grid gap-3 p-3 border-t md:grid-cols-3 bg-muted/30">
          {/* Cor base ↔ apelido editáveis (p/ acertar variantes antigas sem apelido).
              Salva ao mudar; escolher apelido preenche a base. */}
          <div className="space-y-1.5">
            <Label>Cor base</Label>
            <Select
              value={corId}
              onValueChange={(b) => {
                setCorId(b);
                const keep = apelidos.some((a) => a.id === apelidoId && a.cor_base_id === b) ? apelidoId : "";
                setApelidoId(keep);
                saveMut.mutate({ cor_id: b, cor_apelido_id: keep || null });
              }}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue placeholder="Selecione a cor" /></SelectTrigger>
              <SelectContent>
                {cores.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Cor apelido</Label>
            <Select
              value={apelidoId}
              onValueChange={(a) => {
                setApelidoId(a);
                const base = apelidos.find((x) => x.id === a)?.cor_base_id ?? corId;
                setCorId(base);
                saveMut.mutate({ cor_apelido_id: a, cor_id: base });
              }}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue placeholder="Selecione o apelido" /></SelectTrigger>
              <SelectContent>
                {(corId ? apelidos.filter((a) => a.cor_base_id === corId) : apelidos).map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Nome comercial (opcional)</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onBlur={() =>
                nome !== (variante.nome_variante ?? "") && saveMut.mutate({ nome_variante: nome })
              }
              readOnly={readOnly}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Código</Label>
            <Input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              onBlur={() =>
                codigo !== (variante.codigo_variante ?? "") &&
                saveMut.mutate({ codigo_variante: codigo })
              }
              readOnly={readOnly}
            />
          </div>
          {/* Preço POR VARIANTE. O preço de referência do artigo = o maior das variantes.
              Ícone de histórico AO LADO do input (label simples, alinha com o campo Código). */}
          <div className="space-y-1.5">
            <Label>Preço</Label>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                step="0.01"
                placeholder="0,00"
                className="flex-1"
                value={preco}
                onChange={(e) => setPreco(e.target.value)}
                onBlur={() => {
                  const v = preco === "" ? null : Number(preco);
                  if (v !== (variante.preco ?? null)) saveMut.mutate({ preco: v });
                }}
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
          </div>
          <div className="space-y-1.5 md:col-span-3">
            <Label>Endereços</Label>
            {/* Editor CONSOLIDADO: edita manual + por OC + por rolo aqui mesmo (cada um vai
                pro store certo). Rótulo da origem (OC/Rolo) sob a linha. */}
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

