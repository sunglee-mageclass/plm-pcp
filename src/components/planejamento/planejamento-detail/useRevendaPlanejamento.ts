// Revenda (Produto Acabado) no detalhe do Planejamento: produto vinculado, markups e preços fixos e "criar produto
// acabado". Extraído na F3.0 (set/2026) de `PlanejamentoDetail.tsx` SEM mudança de comportamento (mesmas queryKeys, mesmas
// RPCs, mesma ordem relativa de hooks). F3.4: a GRADE cor×tamanho SAIU daqui para `useGradeComprado.ts` (texto movido —
// agora vale p/ revenda E importado, decisão F3 #4); aqui ficou só o que é da REVENDA (preço atacado/varejo por
// `produtos_acabados` e criar o produto).
import { useRef, useState } from "react";
import { useMutation, useQuery, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { markupDePreco } from "@/lib/preco-revenda";
import { supabase } from "@/integrations/supabase/client";
import { erroValidacao } from "@/components/produto-acabado/shared";
import { type CatOpt, type Draft } from "@/components/planejamento/modelo-shared";

export type UseRevendaPlanejamentoArgs = {
  modeloId: string | null;
  isEdit: boolean;
  isRevenda: boolean;
  paOn: boolean;
  draft: Draft;
  /** custo previsto + M.O. ao vivo (calculado no orquestrador, bloco de preço). */
  baseRevendaMarkup: number;
  categorias: CatOpt[];
  qc: QueryClient;
  navigate: ReturnType<typeof useNavigate>;
  contexto: "planejamento" | "produto-acabado";
  onClose: () => void;
};

export function useRevendaPlanejamento({
  modeloId, isEdit, isRevenda, paOn, draft, baseRevendaMarkup, categorias,
  qc, navigate, contexto, onClose,
}: UseRevendaPlanejamentoArgs) {
  // Produto Acabado vinculado a este modelo (revenda, Task 7) — embed REVERSO
  // (`produtos_acabados.modelo_id`): markups/preços fixos do produto. (F3.4: variantes/proporção/grupo da GRADE
  // passaram a ser lidos por `useGradeComprado`, por origem.)
  const { data: produtoRevenda, isLoading: produtoRevendaLoading } = useQuery({
    queryKey: ["pa-produto-modelo", modeloId],
    enabled: isEdit && !!modeloId && isRevenda && paOn,
    queryFn: async () => {
      const { data, error } = await (supabase.from("produtos_acabados" as any) as any)
        .select("id, colecao_id, categoria_id, grupo_id, grade_proporcao, markup_atacado, markup_varejo, preco_atacado_fixo, preco_varejo_fixo, variantes:produto_acabado_variantes(ordem, cor:cor_id(nome), apelido:cor_apelido_id(nome))")
        .eq("modelo_id", modeloId)
        .maybeSingle();
      if (error) throw error;
      return data as {
        id: string; colecao_id: string | null; categoria_id: string | null; grupo_id: string | null;
        grade_proporcao: Record<string, number>;
        markup_atacado: number | null; markup_varejo: number | null;
        preco_atacado_fixo: number | null; preco_varejo_fixo: number | null;
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
  // Rascunho LOCAL do texto digitado nos campos de PREÇO de revenda (preço FIXO, set/2026). É o
  // `value` CONTROLADO do MoneyInput (o que o usuário vê enquanto digita). RE-SEMEADO quando o preço
  // REAL do servidor muda (`draft.preco_*`, já = fixo-ou-derivado recomputado) — mesmo padrão do
  // `precoBaseRef` do card da lista: sem isto o campo ficaria preso ao valor antigo e não mostraria a
  // digitação; e após salvar/refetch não refletiria o novo preço. (O markup segue seed-1×.)
  const [precoAtacadoDraft, setPrecoAtacadoDraft] = useState<string>("");
  const [precoVarejoDraft, setPrecoVarejoDraft] = useState<string>("");
  const precoAtacadoBaseRef = useRef<number | null | undefined>(undefined);
  const precoVarejoBaseRef = useRef<number | null | undefined>(undefined);
  const strDeNum = (v: number | null | undefined) => (v != null ? String(v) : "");
  // Re-semeia o rascunho quando o preço REAL do servidor muda — MAS só se o rascunho estiver LIMPO
  // (igual ao ÚLTIMO valor conhecido do servidor). Se o usuário está digitando (rascunho diverge do
  // base anterior), PRESERVA a digitação — senão um refetch concorrente (save de outro usuário via
  // Realtime, foco de janela) sobrescreveria o campo no meio (achado C da revisão). Mesma guarda que
  // MO/grade já têm. 1ª passada (base undefined) sempre semeia.
  if (precoAtacadoBaseRef.current !== (draft.preco_atacado ?? null)) {
    const limpo = precoAtacadoBaseRef.current === undefined || precoAtacadoDraft === strDeNum(precoAtacadoBaseRef.current);
    precoAtacadoBaseRef.current = draft.preco_atacado ?? null;
    if (limpo) setPrecoAtacadoDraft(strDeNum(draft.preco_atacado));
  }
  if (precoVarejoBaseRef.current !== (draft.preco_venda ?? null)) {
    const limpo = precoVarejoBaseRef.current === undefined || precoVarejoDraft === strDeNum(precoVarejoBaseRef.current);
    precoVarejoBaseRef.current = draft.preco_venda ?? null;
    if (limpo) setPrecoVarejoDraft(strDeNum(draft.preco_venda));
  }
  // Markup local RE-SEMEADO do valor EFETIVO (markup gravado no servidor OU, se o preço está fixo,
  // o derivado preço÷custo) sempre que o efetivo muda — só se o rascunho estiver LIMPO (não sobrescreve
  // digitação; mesma guarda dos preços). Regra "última edição manda": editar preço grava preço + limpa
  // markup no banco → aqui o markup re-semeia p/ o derivado do novo preço; editar markup grava markup
  // + limpa o preço fixo → o preço re-semeia p/ o derivado. Cada campo sempre mostra o efetivo.
  const markupAtacadoEfetivo = produtoRevenda?.markup_atacado ?? (draft.preco_atacado != null ? markupDePreco(baseRevendaMarkup, draft.preco_atacado) : null);
  const markupVarejoEfetivo = produtoRevenda?.markup_varejo ?? (draft.preco_venda != null ? markupDePreco(baseRevendaMarkup, draft.preco_venda) : null);
  const markupAtacadoBaseRef = useRef<number | null | undefined>(undefined);
  const markupVarejoBaseRef = useRef<number | null | undefined>(undefined);
  if (markupAtacadoBaseRef.current !== (markupAtacadoEfetivo ?? null)) {
    const limpo = markupAtacadoBaseRef.current === undefined || markupAtacadoInput === markupAtacadoBaseRef.current;
    markupAtacadoBaseRef.current = markupAtacadoEfetivo ?? null;
    if (limpo) setMarkupAtacadoInput(markupAtacadoEfetivo ?? null);
  }
  if (markupVarejoBaseRef.current !== (markupVarejoEfetivo ?? null)) {
    const limpo = markupVarejoBaseRef.current === undefined || markupVarejoInput === markupVarejoBaseRef.current;
    markupVarejoBaseRef.current = markupVarejoEfetivo ?? null;
    if (limpo) setMarkupVarejoInput(markupVarejoEfetivo ?? null);
  }
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
  // Preço FIXO de revenda (set/2026): grava o preço EXATO digitado (sem derivar do markup, sem
  // arredondar de volta). `_tocar_X=true` mexe SÓ no canal X; preço não-null FIXA + limpa o markup
  // daquele canal; null DESTRAVA (limpa o fixo, mantém markup → volta a derivar). O servidor recomputa
  // `modelos.preco_atacado`/`preco_venda` = coalesce(fixo, round(base×markup,2)). Mesmas invalidações
  // de `salvarMarkupsRevenda` (o preço real do modelo mudou no servidor).
  const salvarPrecosFixoRevenda = useMutation({
    mutationFn: async (p: { tocarAtacado: boolean; precoAtacado: number | null; tocarVarejo: boolean; precoVarejo: number | null }) => {
      if (!produtoRevenda) return;
      const { error } = await supabase.rpc("salvar_precos_fixo_produto_acabado" as any, {
        _produto_id: produtoRevenda.id,
        _tocar_atacado: p.tocarAtacado, _preco_atacado_fixo: p.precoAtacado,
        _tocar_varejo: p.tocarVarejo, _preco_varejo_fixo: p.precoVarejo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["modelo", modeloId] });
      qc.invalidateQueries({ queryKey: ["pa-produto-modelo", modeloId] });
      qc.invalidateQueries({ queryKey: ["produtos-acabados"] });
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar o preço.")),
  });
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

  return {
    produtoRevenda, produtoRevendaLoading,
    markupAtacadoInput, setMarkupAtacadoInput, markupVarejoInput, setMarkupVarejoInput,
    markupAtacadoBaseRef, markupVarejoBaseRef,
    precoAtacadoDraft, setPrecoAtacadoDraft, precoVarejoDraft, setPrecoVarejoDraft,
    salvarMarkupsRevenda, salvarPrecosFixoRevenda,
    criarProdutoAcabado,
  };
}

export type RevendaPlanejamento = ReturnType<typeof useRevendaPlanejamento>;
