// Salvar do detalhe do Planejamento (header `modelos` com rev otimista + grade de revenda + MO por
// serviço + auto-criação do Produto Acabado) e o retry/merge do P0409. Extraído na F3.0 (set/2026) de
// `PlanejamentoDetail.tsx` SEM mudança de comportamento: o corpo abaixo é o texto MOVIDO como estava
// (mesmas chamadas, mesma ordem, mesmas queryKeys). Refs e estados continuam sendo do orquestrador e
// chegam por argumento com os MESMOS nomes (refs como OBJETO — o retry lê `.current` na hora). A F3.2
// reescreve aqui a cadeia de gravação (UPDATE → salvar_modelo_bom → etiquetas → MO → marcar_revisao).
import { useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useMutation, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { mergeDraft, type Conflito } from "@/lib/colab/merge";
import { moLinhasEqual } from "@/lib/mao-obra";
import { type MaoObraEditorLinha } from "@/components/planejamento/MaoObraEditor";
import { numOr0, draftFromModeloRow, type CatOpt, type Draft } from "@/components/planejamento/modelo-shared";
import { limparCustoSim, aplicarRegrasCamposDev, textoOuNull, draftParaSalvar } from "@/components/planejamento/planejamento-detail/helpers";
import { syncTecidosToDesenvolvimento } from "@/components/planejamento/planejamento-detail/sync-tecidos";

export type UsePlanejamentoSaveArgs = {
  modeloId: string | null;
  isEdit: boolean;
  isRevenda: boolean;
  paOn: boolean;
  podeEditarPreco: boolean;
  podeVerCustos: boolean;
  /** F3.1: pode editar o Desenvolvimento? Sem isso os campos do Dev saem do payload (decisão F3 #8). */
  podeEditarDev: boolean;
  /** F3.1: o campo REF está editável na seção "Desenvolvimento"? Só então a REF vai no payload. */
  refEditavel: boolean;
  categorias: CatOpt[];
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  draftLiveRef: RefObject<Draft>;
  touchedRef: RefObject<Set<string>>;
  baseRef: RefObject<{ draft: Draft } | null>;
  revRef: RefObject<number | null>;
  retryRef: RefObject<boolean>;
  savingRef: RefObject<boolean>;
  conflitosRef: RefObject<Conflito[]>;
  setConflitos: Dispatch<SetStateAction<Conflito[]>>;
  setUltimoMerge: Dispatch<SetStateAction<{ atualizados: number; conflitos: Conflito[] } | null>>;
  setEnviada: Dispatch<SetStateAction<boolean>>;
  setLancado: Dispatch<SetStateAction<boolean>>;
  markClean: () => void;
  moLinhas: MaoObraEditorLinha[];
  moLinhasRef: RefObject<MaoObraEditorLinha[]>;
  moBaseRef: RefObject<MaoObraEditorLinha[]>;
  setMoLinhasBase: Dispatch<SetStateAction<MaoObraEditorLinha[]>>;
  gradeRevenda: Record<number, Record<string, number>>;
  setGradeRevenda: Dispatch<SetStateAction<Record<number, Record<string, number>>>>;
  gradeRevendaDirty: boolean;
  gradeRevendaBaseRef: RefObject<string>;
  gradeRevendaRevRef: RefObject<number | null>;
  buildLinhasGradeRevenda: () => { variante_numero: number; grades: Record<string, number>; grade_total: number }[];
  qc: QueryClient;
  onSaved: () => void;
  /** F3.1 — card NOVO: chamado com o id depois do INSERT (o `PlanejamentoDetail` remonta como Sheet dele). */
  onCreated?: (id: string) => void;
};

export function usePlanejamentoSave({
  modeloId, isEdit, isRevenda, paOn, podeEditarPreco, podeVerCustos, podeEditarDev, refEditavel, categorias,
  draft, setDraft, draftLiveRef,
  touchedRef, baseRef, revRef, retryRef, savingRef, conflitosRef, setConflitos, setUltimoMerge,
  setEnviada, setLancado, markClean,
  moLinhas, moLinhasRef, moBaseRef, setMoLinhasBase,
  gradeRevenda, setGradeRevenda, gradeRevendaDirty, gradeRevendaBaseRef, gradeRevendaRevRef, buildLinhasGradeRevenda,
  qc, onSaved, onCreated,
}: UsePlanejamentoSaveArgs) {
  // F3.1 — card NOVO: id do INSERT já feito neste detalhe. Um 2º Salvar (ou o retry depois de um erro nas
  // gravações seguintes) NUNCA insere de novo; o detalhe vira o Sheet desse id (`onCreated`).
  const criadoIdRef = useRef<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      // Colab (Task 2): com conflitos pendentes na tela, o save NÃO pode passar — mesmo que
      // o rev já bata, o usuário precisa resolver ("manter meu"/"usar o novo") primeiro. Mesmo
      // guard do piloto OC Tecido/Desenvolvimento (sem isto, um 2º clique sobrescreveria a
      // versão da outra pessoa em silêncio).
      if (conflitosRef.current.length > 0)
        throw new Error("Resolva os conflitos listados no aviso no topo antes de salvar.");
      // Fonte do payload = o ESPELHO ao vivo do draft (bug-fix, receita do Dev — ver
      // `draftParaSalvar` em helpers.ts para o porquê e o teste da semântica).
      const d = draftParaSalvar(draftLiveRef.current, draft);
      // F3.1: os campos vindos do Dev e a REF passam por `aplicarRegrasCamposDev` (helpers.ts): vazios → NULL,
      // sem permissão do Dev → saem do payload, REF só quando editável (senão sai, como antes — a REF é do
      // trigger fn_modelo_ref_auto, invariante #11). A etapa (`status_desenvolvimento`) não está no Draft.
      const payload: any = aplicarRegrasCamposDev({
        ...d,
        croqui_url: d.croqui_url || null,
        desenho_tecnico_url: d.desenho_tecnico_url || null,
        data_lancamento: d.data_lancamento || null,
        observacoes_mao_obra: d.observacoes_mao_obra || null,
        custo_simulado: limparCustoSim(d.custo_simulado),
        // Campo NOVO (F3.1): vazio/só-espaço vira NULL.
        descricao_produto: textoOuNull(d.descricao_produto),
      }, d, { podeEditarDev, refEditavel });
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
        // Preço de venda só entra no payload de quem PODE editá-lo (permissão à parte
        // `criacao_planejamento:preco_venda`). Sem ela, o input é read-only e um Salvar disparado
        // por OUTRO campo não deve reenviar o valor herdado do `...draft` (o trigger
        // fn_modelo_preco_venda_gate barraria com 42501, quebrando o save inteiro).
        if (podeEditarPreco) {
          payload.preco_venda = numOr0(d.preco_venda) > 0 ? numOr0(d.preco_venda) : null;
        } else {
          delete payload.preco_venda;
        }
        payload.preco_atacado = numOr0(d.preco_atacado) > 0 ? numOr0(d.preco_atacado) : null;
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
        await syncTecidosToDesenvolvimento(modeloId, d.tecidos_planejados);
      } else {
        // Card novo: sem concorrência possível (linha ainda não existe) — insert direto, UMA vez só (F3.1).
        if (criadoIdRef.current) {
          savedId = criadoIdRef.current;
        } else {
          const { data: inserted, error } = await supabase.from("modelos").insert(payload).select("id").single();
          if (error) throw error;
          savedId = inserted?.id ?? null;
          criadoIdRef.current = savedId;
        }
        if (savedId) await syncTecidosToDesenvolvimento(savedId, d.tecidos_planejados);
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
            id: l.id ?? null, // multi-instância: id preserva a linha (e sua aprovação) no diff do servidor
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
      if (savedId && d.origem === "revenda" && paOn) {
        try {
          const { data: existente } = await supabase
            .from("produtos_acabados" as any)
            .select("id")
            .eq("modelo_id", savedId)
            .maybeSingle();
          if (!existente) {
            const cat = categorias.find((c) => c.id === d.categoria_principal_id);
            const grupoId = cat?.grupo_id ?? null;
            if (grupoId && d.categoria_principal_id) {
              const { data: novoProdutoId, error: paErr } = await supabase.rpc("salvar_produto_acabado" as any, {
                _id: null,
                _dados: {
                  nome: d.nome,
                  grupo_id: grupoId,
                  categoria_id: d.categoria_principal_id,
                  subcategoria1_id: d.subcategoria1_id,
                  subcategoria2_id: d.subcategoria2_id,
                  colecao_id: d.colecao_id,
                  subcolecao: d.subcolecao || null,
                  semana: d.semana || null,
                },
                _variantes: [],
              });
              if (paErr) throw paErr;
              const { error: linkErr } = await (supabase.from("produtos_acabados" as any) as any)
                .update({ modelo_id: savedId }).eq("id", novoProdutoId);
              if (linkErr) throw linkErr;
              autoProduto = { criou: true, semColecao: !d.colecao_id };
            }
          }
        } catch (autoErr) {
          console.error("Auto-criação do produto acabado (revenda) falhou — save do card mantido:", autoErr);
        }
      }
      // `savedDraft` (bug-fix): devolve o MESMO `d` que foi de fato enviado ao servidor —
      // o `onSuccess` abaixo usa este (não o `draft` do closure do render que chamou
      // `save.mutate`) pra fixar `baseRef`/decidir invalidations, mesma razão do `d` acima.
      // `savedId` (F3.1): id do card — usado no onSuccess pra disparar `onCreated` no card NOVO.
      return { autoProduto, savedDraft: d, savedId };
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
      // `savedDraft` = o rascunho REALMENTE enviado ao servidor (bug-fix acima) — usar o
      // `draft` do closure aqui reabriria a mesma janela (onSuccess roda depois de um
      // possível novo render durante o `await`, então `draft` já pode ter avançado de novo).
      const savedDraft = result?.savedDraft ?? draft;
      if (savedDraft.origem === "revenda") {
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey?.[0] === "string" && (q.queryKey[0] as string).startsWith("produtos-acabados") });
        qc.invalidateQueries({ queryKey: ["pa-produto-modelo", modeloId] });
      }
      markClean();
      // Colab: o que acabei de salvar já É o "base" atual — evita que o eco do Realtime (meu
      // próprio UPDATE) apareça como "alguém atualizou N campos" no banner. O rev real
      // (bumpado no servidor) chega no próximo refetch — o merge effect processa em silêncio
      // (base≈fresh, sem conflitos) e avança `revRef`. `savedDraft` (não o `draft` do closure,
      // que pode ter avançado durante o `await`) é a verdade do que está no servidor agora.
      baseRef.current = { draft: savedDraft };
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
      // F3.1: o save muda as condições do kanban (datas/pilotos/anexos…) — refresca o gate da REF com a chave
      // ligada e a dica do "Mover para…".
      qc.invalidateQueries({ queryKey: ["plan-kanban-cond", modeloId] });
      // F3.1: a "Composição" das Observações lê `modelo_tecidos`, que o Salvar grava.
      qc.invalidateQueries({ queryKey: ["modelo-composicao", modeloId] });
      // Salvar MANTÉM o Sheet aberto (decisão do dono set/2026 — antes fechava): `onSaved()`
      // atualiza os cards do container por baixo; o card fica aberto pra continuar conferindo
      // (ex.: o preço/custo recalculado). `markClean()` + `setMoLinhasBase` acima já apagaram o
      // selo "não salvo". Fechar é só pelo Voltar (`requestClose`). Não chamar `onClose()` aqui.
      onSaved();
      // F3.1 — card NOVO: vira o Sheet do id criado (o `PlanejamentoDetail` remonta com a key nova).
      if (!isEdit && result?.savedId) onCreated?.(result.savedId);
    },
    onError: async (e: any) => {
      // F3.1 — card NOVO já INSERIDO que falhou numa gravação seguinte (tecidos/grade/MO): mostra o erro, atualiza
      // a lista e abre o Sheet do card criado — o usuário confere e salva de lá (UPDATE). Nunca um 2º INSERT.
      if (!isEdit && criadoIdRef.current) {
        toast.error(`O card foi criado, mas algo não foi salvo: ${mensagemErro(e, "erro desconhecido")}`);
        onSaved();
        onCreated?.(criadoIdRef.current);
        return;
      }
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
          if (md.atualizados.length > 0 || md.conflitos.length > 0) {
            setDraft(md.valor);
            // Espelho SÍNCRONO (receita do Dev, ModeloDetailPanel.tsx:2295-2297): o retry
            // (save.mutate logo abaixo) roda ANTES do próximo re-render — o mutationFn lê
            // `draftLiveRef.current`, que precisa já conter os campos ADOTADOS do merge (o
            // `setDraft` acima só reflete no ref no useEffect do PRÓXIMO commit).
            draftLiveRef.current = md.valor;
          }
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

  return { save, handleSave };
}
