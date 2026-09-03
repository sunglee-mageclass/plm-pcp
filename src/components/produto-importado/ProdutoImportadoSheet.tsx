import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { DEFAULT_TAMANHOS } from "@/components/oc-p-acabado/shared";
import type { EmpresaFornecedor } from "@/components/shared/FornecedorSelect";
import type { Opt, CatOpt, SubOpt, CorApelidoOpt } from "@/components/produto-acabado/shared";
import { ProdutoImportadoCard } from "./ProdutoImportadoCard";
import { NovoProdutoImportadoDialog } from "./NovoProdutoImportadoDialog";
import { emptyDraft, resumoDrafts, type ProdutoImportadoDraft } from "./shared";
import { fmtMoeda } from "@/lib/moeda";

function useOpt(table: string) {
  return useQuery({
    queryKey: ["opt-produto-importado", table],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select("id, nome").order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as Opt[];
    },
  });
}
function useOptCat(table: string, fk: string) {
  return useQuery({
    queryKey: ["opt-produto-importado-cat", table, fk],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select(`id, nome, ${fk}`).order("nome");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

/** Linha crua de `produtos_importados` — shape provisório (a tabela real/RPC de leitura
 *  chegam na fase seguinte). Usado só para preencher a lista quando já existir dado; a
 *  query tolera erro/tabela ausente e cai em lista vazia (Fase 1 nunca trava a tela por
 *  causa disso — o objetivo é ter uma tela NAVEGÁVEL mesmo sem backend pronto). */
type ProdutoImportadoRow = { id: string; nome: string; colecao_id: string | null; subcolecao: string | null };

let idSeq = 0;
const novoIdLocal = () => `novo-${Date.now()}-${idSeq++}`;

/**
 * Sheet do planejador Produto Importado (Fase 1 — TELA NAVEGÁVEL, sem persistência no
 * banco ainda). Espelha os padrões visuais de `ProdutoAcabadoSheet.tsx` (Sheet
 * side=right full, Breadcrumb + UnsavedIndicator, canvas de cards, botão "+ Novo",
 * PageActionBar-like sticky no rodapé) — sem colab/DnD/multi-seleção/subcoleções em grid
 * (fora de escopo desta fase; a Fase 1 entrega 1 canvas só, direto na coleção).
 *
 * TODO (fase seguinte): trocar o `useState` local por RPCs reais (`salvar_produto_
 * importado`, leitura de `produtos_importados`) — hoje o Salvar só avisa "em breve".
 */
export function ProdutoImportadoSheet({ colecaoId, subInicial = null, onSubChange, onClose }: {
  colecaoId: string;
  subInicial?: string | null;
  onSubChange?: (subId: string | null) => void;
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<ProdutoImportadoDraft[]>([]);
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());
  const [novoOpen, setNovoOpen] = useState(false);
  const [baseline, setBaseline] = useState<string>("[]");
  const [carregado, setCarregado] = useState(false);

  const { data: colecao } = useQuery({
    queryKey: ["colecao-nome", colecaoId],
    queryFn: async () => {
      const { data, error } = await supabase.from("colecoes").select("id, nome").eq("id", colecaoId).maybeSingle();
      if (error) throw error;
      return data as { id: string; nome: string } | null;
    },
  });

  // Tenta carregar produtos já existentes (Fase 2 em diante) — se a tabela ainda não tem
  // RLS/RPC pronta ou vier vazia, cai em lista vazia sem quebrar a tela (empty-state
  // "nenhum produto"). `as any` porque `produtos_importados` está fora do types.ts (igual
  // ao padrão de `ocs_p_acabado`/`produtos_acabados`).
  const produtosQuery = useQuery({
    queryKey: ["produtos-importados", colecaoId],
    queryFn: async () => {
      const { data, error } = await supabase.from("produtos_importados" as any).select("id, nome, colecao_id, subcolecao").eq("colecao_id", colecaoId);
      if (error) throw error;
      return (data ?? []) as unknown as ProdutoImportadoRow[];
    },
    retry: false,
  });

  useEffect(() => {
    if (carregado) return;
    // Sucesso OU erro (tabela/RPC ainda não pronta): resolve como "sem produtos" e libera a
    // tela — Fase 1 é sobre navegar/cotar localmente, não sobre a leitura do banco.
    if (produtosQuery.isSuccess || produtosQuery.isError) {
      const linhas = produtosQuery.data ?? [];
      const iniciais: ProdutoImportadoDraft[] = linhas.map((r) => ({ ...emptyDraft(r.colecao_id, r.subcolecao), id: r.id, nome: r.nome }));
      setDrafts(iniciais);
      setBaseline(JSON.stringify(iniciais));
      setCarregado(true);
    }
  }, [carregado, produtosQuery.isSuccess, produtosQuery.isError, produtosQuery.data]);

  // ── Opções (taxonomia, cores, fornecedores, tamanhos) — mesmas tabelas do Produto Acabado. ──
  const { data: grupos = [] } = useOpt("grupos_produto");
  const { data: categorias = [] } = useOptCat("categorias_produto", "grupo_id") as { data: CatOpt[] };
  const { data: subcats1 = [] } = useOptCat("subcategorias1_produto", "categoria_id") as { data: SubOpt[] };
  const { data: subcats2 = [] } = useOptCat("subcategorias2_produto", "categoria_id") as { data: SubOpt[] };
  const { data: cores = [] } = useOpt("cores");
  const { data: coresApelido = [] } = useOptCat("cores_apelido", "cor_base_id") as { data: CorApelidoOpt[] };
  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-options", "produto-importado-planner"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nome_fantasia, representantes(id, nome)").eq("tipo", "material").order("nome_fantasia");
      if (error) throw error;
      return (data ?? []) as EmpresaFornecedor[];
    },
  });
  const { data: tamanhos = DEFAULT_TAMANHOS } = useQuery({
    queryKey: ["tenant-config-tamanhos-produto-importado"],
    queryFn: async () => {
      const { data } = await supabase.rpc("get_user_tenant_id" as any);
      if (!data) return DEFAULT_TAMANHOS;
      const { data: cfg } = await supabase.from("tenant_config").select("tamanhos_grade").eq("tenant_id", data as string).maybeSingle();
      const raw = (cfg as any)?.tamanhos_grade;
      return Array.isArray(raw) && raw.length > 0 ? raw.map(String) : DEFAULT_TAMANHOS;
    },
  });

  const dirty = JSON.stringify(drafts) !== baseline;
  const fecharDeVez = () => { setBaseline(JSON.stringify(drafts)); onClose(); };
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose: fecharDeVez });

  const patchDraft = (id: string, patch: Partial<ProdutoImportadoDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const removeDraft = (id: string) => setDrafts((ds) => ds.filter((d) => d.id !== id));
  // Um card aberto por vez (feedback do dono: cards abertos ficavam gigantes empilhados). Abrir
  // um fecha os demais — o card fechado é compacto (só o header-resumo).
  const toggleCard = (id: string) => setOpenCards((s) => (s.has(id) ? new Set() : new Set([id])));

  const criarDraft = (dados: { nome: string; grupo_id: string | null; categoria_id: string | null; subcategoria1_id: string | null; subcategoria2_id: string | null }) => {
    const novo: ProdutoImportadoDraft = { ...emptyDraft(colecaoId, subInicial ?? null), id: novoIdLocal(), ...dados };
    setDrafts((ds) => [...ds, novo]);
    setOpenCards((s) => new Set([...s, novo.id!]));
  };

  // TODO (próxima fase): trocar por RPC real (`salvar_produto_importado` + `salvar_
  // variantes_importado`/etapas) — por ora só sinaliza que a persistência ainda não existe,
  // sem perder o rascunho em memória.
  const salvar = () => {
    // eslint-disable-next-line no-console
    console.log("[produto-importado] TODO: persistência via RPC na próxima fase.", drafts);
    toast.info("Em breve: persistência no banco. Por ora o rascunho fica só nesta tela.");
    setBaseline(JSON.stringify(drafts));
  };

  return (
    <Sheet open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <SheetContent side="right" size="full" className="flex flex-col p-0 gap-0 max-sm:[&>button]:hidden">
        <div className="sticky top-0 z-10 flex flex-col gap-1.5 border-b bg-background p-3">
          <div className="flex items-center gap-2">
            <Breadcrumb items={[
              { label: "Estilo & Engenharia" },
              { label: "Produto Importado", onClick: requestClose },
              { label: colecao?.nome ?? "…" },
            ]} />
            <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
          </div>
        </div>

        {!carregado ? (
          <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
        ) : (
          <main className="flex-1 overflow-y-auto p-4">
            {/* Barra de resumo (feedback do dono): totais da coleção — peças, custo landed,
                atacado, varejo. Sticky para acompanhar a rolagem. Mesma fonte única de custo. */}
            {drafts.length > 0 && (() => {
              const r = resumoDrafts(drafts);
              const Item = ({ label, valor, tone }: { label: string; valor: string; tone?: string }) => (
                <div className="flex min-w-[7rem] flex-col">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
                  <span className={`text-sm font-semibold tabular-nums ${tone ?? ""}`}>{valor}</span>
                </div>
              );
              return (
                <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-muted/30 p-3">
                  <Item label="Produtos" valor={`${r.produtos}`} />
                  <Item label="Peças" valor={r.pecas.toLocaleString("pt-BR")} />
                  <Item label="Custo total" valor={fmtMoeda(r.custoTotalBrl, "BRL")} />
                  <Item label="Atacado" valor={fmtMoeda(r.atacadoTotalBrl, "BRL")} tone="text-primary" />
                  <Item label="Varejo" valor={fmtMoeda(r.varejoTotalBrl, "BRL")} tone="text-emerald-700" />
                </div>
              );
            })()}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">{drafts.length} produto(s)</span>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setNovoOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Novo produto
              </Button>
            </div>

            {drafts.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Nenhum produto importado ainda — clique em "Novo produto".
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {drafts.map((d) => (
                  <ProdutoImportadoCard
                    key={d.id}
                    draft={d}
                    onChange={(patch) => patchDraft(d.id!, patch)}
                    open={openCards.has(d.id!)}
                    onToggleOpen={() => toggleCard(d.id!)}
                    grupos={grupos}
                    categorias={categorias}
                    subcats1={subcats1}
                    subcats2={subcats2}
                    cores={cores}
                    coresApelido={coresApelido}
                    empresas={empresas}
                    tamanhos={tamanhos}
                    onExcluir={() => removeDraft(d.id!)}
                  />
                ))}
              </div>
            )}
          </main>
        )}

        <div className="shrink-0 border-t bg-background p-3 flex items-center gap-2">
          <Button variant="outline" size="sm" className="max-sm:h-11" onClick={requestClose}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
          </Button>
          <div className="ml-auto" />
          <Button disabled={!dirty} onClick={salvar}>
            {dirty ? "Salvar" : "Salvo"}
          </Button>
        </div>

        <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas no planejador de Produto Importado." />

        <NovoProdutoImportadoDialog
          open={novoOpen}
          onClose={() => setNovoOpen(false)}
          grupos={grupos}
          categorias={categorias}
          subcats1={subcats1}
          subcats2={subcats2}
          onCriar={criarDraft}
        />
      </SheetContent>
    </Sheet>
  );
}
