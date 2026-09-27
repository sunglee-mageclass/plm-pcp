// Integração — dados da tela (TanStack Query) e o Salvar com as dependências REAIS. RPCs novas por `as any` (types.ts não é
// regerado nesta frente). queryKeys POR LOJA (trocar de loja não reaproveita cache — lição P-57).
//
// Fix round 1 (task-11-review.md + task-11-code-review.md): `useSalvarIntegracao` ganhou `mutationKey` e
// `useIntegracaoAoVivo` passa a ignorar o eco do Realtime enquanto ESSA mutation está em voo (I2/M5); a prévia dos SKUs
// leva o tenant na key, debounce de 300ms (igual ao Sheet) e expõe erro (M2); a lista não mostra a loja anterior como
// placeholder ao trocar de tenant (M3); `invalidarIntegracao` também invalida `produtos-importados` (M4); o canal
// Realtime usa um sufixo único por montagem (M5).
//
// Fix round 2 (task-11-review.md "Re-review round 1" Important R1 + task-11-code-review.md "Re-check round 1" I3): o
// round 1 debounçava um OBJETO novo a cada render (`useValorAtrasado(entradas, 300)`, comparado por `===`) — como
// `entradas` nunca é a MESMA referência 2 renders seguidos, o efeito reagendava `setV` pra sempre, gerando um
// re-render da aba Produtos a cada 300ms mesmo sem nenhum rascunho. Fix: `useValorAtrasado` agora só aceita STRING
// (mesmo padrão de `useChaveAtrasada` do Sheet, `useSkusModelo.ts`), e `usePreviasSkus` atrasa `JSON.stringify(
// entradas)` — uma string igual a si mesma entre renders enquanto nada muda de verdade — e reconstrói o mapa via
// `useMemo(() => JSON.parse(...))`.
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { mensagemErro } from "@/lib/erro-mensagem";
import { BUCKET, uploadFile } from "@/components/planejamento/modelo-shared";
import {
  chaveEntradaPrevia, entradaDaChave, lerPrevia,
  type ErroPrevia, type LinhaPrevia, type PreviaSkus,
} from "@/components/planejamento/planejamento-detail/codigos/sku-previa";
import { filtrosParaRpc, lerLista, type Filtros, type ListaIntegracao, type Situacao } from "@/lib/integracao/produtos";
import type { Rascunho } from "@/lib/integracao/rascunho";
import { entradaSkus, salvarIntegracao, temSkuAGravar, type DepsSalvar, type EntradaSkus, type ResultadoSalvar } from "./salvar-integracao";

/** `mutationKey` do Salvar da Integração — I2/code-review: `useIntegracaoAoVivo` consulta `qc.isMutating` com esta
 *  MESMA key para não relistar no meio do Salvar (o `onSettled` da mutation já relista depois). */
export const chaveMutationSalvar = (tenantId: string) => ["integracao-salvar", tenantId] as const;

/** Atrasa a troca de uma STRING — mesmo padrão de `useChaveAtrasada` da seção Códigos (`useSkusModelo.ts`): a REF é
 *  digitada letra a letra, e sem atraso cada tecla dispararia uma chamada de `skus_previa` por produto (M2).
 *  Fix round 2 (Important R1/I3): o TIPO é restrito a `string` de propósito — um objeto/array recriado a cada render
 *  nunca é `===` ao anterior, então o efeito reagendaria o `setTimeout` pra sempre (loop de re-render a cada `ms`,
 *  mesmo sem nenhuma mudança real). Uma string é igual a si mesma entre renders quando o CONTEÚDO não muda; o
 *  chamador que precisar atrasar um objeto deve serializar (`JSON.stringify`) antes de passar aqui. */
function useValorAtrasado(valor: string, ms: number): string {
  const [v, setV] = useState(valor);
  useEffect(() => {
    if (v === valor) return;
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, v, ms]);
  return v;
}

export const chaveLista = (tenantId: string) => ["integracao-lista", tenantId] as const;
export const chaveConfig = (tenantId: string) => ["integracao-config", tenantId] as const;
export const chaveEstado = (tenantId: string) => ["integracao-estado", tenantId] as const;
export const chaveLog = (tenantId: string) => ["integracao-log", tenantId] as const;

export function useIntegracaoLista(situacao: Situacao, filtros: Filtros, pagina: number) {
  const tenantId = useActiveTenantId();
  const f = filtrosParaRpc(filtros);
  return useQuery({
    queryKey: [...chaveLista(tenantId), situacao, f, pagina],
    enabled: !!tenantId,
    // M3 (task-11-review.md): `keepPreviousData` puro atravessaria a troca de loja (o super admin vê a lista da loja
    // ANTERIOR como placeholder até o fetch novo voltar) — a key já leva o tenant (lição P-57), mas o placeholder não
    // respeitava isso sozinho. Só reaproveita o dado anterior quando a query cujo dado será reaproveitado é DESTE
    // mesmo tenant (queryKey[1] é sempre o tenantId, ver chaveLista).
    placeholderData: (prev, query) => (query?.queryKey[1] === tenantId ? prev : undefined),
    queryFn: async (): Promise<ListaIntegracao> => {
      const { data, error } = await supabase.rpc("integracao_listar" as any, { _situacao: situacao, _filtros: f, _pagina: pagina });
      if (error) throw error;
      return lerLista(data);
    },
  });
}

/** Edição alheia (card, Dev, outra aba) nos produtos DA PÁGINA chega por Realtime em `modelos` → a lista relê e o merge
 *  3-vias roda na aba. Filtra pelos ids da página (N2 do G-plano do plano: `integracao_listar` pode levar ~segundos — não
 *  reler a cada save de qualquer produto da loja). Página = 50 ids (o filtro `in` do Realtime aceita até 100).
 *
 *  Fix round 1 (I2, task-11-review.md + code-review.md): o próprio Salvar da Integração (passo 2) faz UPDATE em
 *  `modelos` — o eco desse UPDATE dispara este listener igual a qualquer edição alheia. Se a relista (800ms depois)
 *  chegar ANTES do passo 3 (SKUs) terminar, o merge da T12b rodaria sobre rascunhos PRÉ-salvar (conflito falso em
 *  `fotos_modelo`: o draft ainda tem `novo:<id>`, o fresh já tem o caminho real) e o `onSuccess` planejado, que
 *  reconstrói o resíduo a partir do rev retornado, pode brigar com um `rev` mais novo que a relista já capturou.
 *  Corrigido IGNORANDO a invalidação enquanto o Salvar da Integração (mesma `mutationKey`, mesmo tenant) está em
 *  voo — o `onSettled` da mutation já relista depois de qualquer jeito (sucesso ou erro).
 *
 *  Fix round 1 (M5, code-review.md): o tópico do canal leva um sufixo ALEATÓRIO por montagem do efeito (em vez de
 *  reaproveitar/procurar um canal "velho" com o mesmo tópico) — `channel()` do realtime-js pode devolver a MESMA
 *  instância que está no meio de um `leave` assíncrono (remount rápido com os mesmos ids), e o `.subscribe()`
 *  seguinte vira no-op enquanto esse leave não termina, deixando uma assinatura morta. Um tópico novo a cada efeito
 *  nunca colide com um que está saindo. `useColabRegistro.ts` tem o MESMO padrão de busca por tópico "velho" — fica
 *  no backlog (fora do escopo desta task; não tocado aqui). */
export function useIntegracaoAoVivo(ids: string[]): void {
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const chaveIds = [...ids].sort().join(",");
  useEffect(() => {
    if (!tenantId || chaveIds === "") return;
    let h = 0;
    for (let i = 0; i < chaveIds.length; i++) h = (h * 31 + chaveIds.charCodeAt(i)) | 0;
    const sufixo = Math.random().toString(36).slice(2);
    const topico = `integracao-lista:${tenantId}:${(h >>> 0).toString(36)}:${sufixo}`;
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = supabase.channel(topico);
    ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "modelos", filter: `id=in.(${chaveIds})` }, () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        // I2: o Salvar desta MESMA aba já relista sozinho no onSettled — ignorar o eco enquanto ele está em voo evita
        // reler no meio do passo 3 (SKUs) e evita reiniciar um fetch de `integracao_listar` já em andamento à toa.
        if (qc.isMutating({ mutationKey: chaveMutationSalvar(tenantId) }) > 0) return;
        void qc.invalidateQueries({ queryKey: chaveLista(tenantId) });
      }, 800);
    });
    ch.subscribe();
    return () => {
      if (t) clearTimeout(t);
      void supabase.removeChannel(ch);
    };
  }, [tenantId, chaveIds, qc]);
}

export type ConfigIntegracao = {
  campos: string[]; layout: string[]; rev: number;
  api: { limite_por_minuto: number; max_por_pagina: number; validade_foto_dias: number; bloqueio_tentativas: number } | null;
};
export function useIntegracaoConfig() {
  const tenantId = useActiveTenantId();
  return useQuery({
    queryKey: chaveConfig(tenantId),
    enabled: !!tenantId,
    queryFn: async (): Promise<ConfigIntegracao> => {
      const { data, error } = await supabase.rpc("integracao_config_ler" as any);
      if (error) throw error;
      const o = (data ?? {}) as Partial<ConfigIntegracao>;
      return { campos: o.campos ?? [], layout: o.layout ?? [], rev: Number(o.rev ?? 0), api: o.api ?? null };
    },
  });
}

/** Prévia dos SKUs digitados (a MESMA RPC da seção Códigos, só leitura) — 1 consulta por produto com SKU "a gravar".
 *  T11: só entram rascunhos com `tamanhoTipo` conhecido (letra/numero) e ao menos 1 SKU manual (`temSkuAGravar`,
 *  Minor 7/M7 — MESMO predicado do passo 3 do Salvar) — um rascunho legado com `tamanhoTipo: null` nunca monta
 *  `entradaSkus` (que exigiria fabricar "letra"/"numero" do nada); a falta "Tamanho em" já bloqueia esse produto na
 *  tela antes de o usuário conseguir digitar um SKU pra valer (mesma régua de `salvarIntegracao`).
 *
 *  Fix round 1 (M2): a key leva `tenantId` (regra "queryKey por tela + tenant"); a entrada é atrasada 300ms — mesmo
 *  padrão de `useChaveAtrasada` da seção Códigos — pra não disparar 1 chamada de `skus_previa` por tecla digitada; e
 *  um erro de RPC vira `PreviaSkus.erros` (o MESMO shape que `situacaoPrevia`/`SkuCelula` já sabem ler — ver
 *  `sku-previa.ts:situacaoPrevia`, que sintetiza uma `PreviaLinha` de "erro" a partir de `erros` quando a linha não
 *  tem `previa` própria) em vez de deixar a célula presa mostrando "carregando" pra sempre.
 *
 *  Fix round 2 (Important R1/I3): o debounce agora atrasa uma STRING (`JSON.stringify(entradas)`), nunca o objeto —
 *  ver o comentário de `useValorAtrasado`. O mapa atrasado volta via `useMemo(() => JSON.parse(...))`, então só muda
 *  de referência quando a STRING atrasada muda de verdade (nunca a cada render).
 *  Fix round 2 (Minor R1/N1): o `queryFn` deriva `ref`/`tamanhoTipo`/`manuais`/`modo` da PRÓPRIA chave da query
 *  (`entradaDaChave(chave)`, o mesmo helper que `useSkusModelo.ts` usa) — nunca do `e` "atual" do render que criou a
 *  query. Sem isso, um refetch da chave ATRASADA (invalidação, refoco) dentro da janela de debounce computaria a
 *  prévia com a entrada NOVA mas rotularia o resultado com a chave/entrada VELHA.
 *  Fix round 2 (Minor R2/N2): erro vira `previaDeErro(r, chave, err)` — a `PreviaSkus.entrada` agora é a CHAVE da
 *  query (não o literal "erro"), pra bater com `previa.entrada === chaveAtual` se a T12a espelhar esse padrão do
 *  Sheet (`useSkusModelo.ts:194`); sem isso a célula de erro nunca seria "atual" e ficaria presa em "calculando…". */
export function usePreviasSkus(rascunhos: Rascunho[], ativo: boolean): Record<string, PreviaSkus | undefined> {
  const tenantId = useActiveTenantId();
  const comSku = rascunhos
    .map((r) => ({ r, e: entradaSkus(r) }))
    .filter((x): x is { r: Rascunho; e: EntradaSkus } => x.e !== null && temSkuAGravar(x.r));
  const entradas = Object.fromEntries(
    comSku.map(({ r, e }) => [r.modeloId, chaveEntradaPrevia({ ref: e.ref, tamanhoTipo: e.tamanhoTipo, aGravar: r.skus, virgem: false })]),
  );
  const entradasStr = JSON.stringify(entradas);
  const entradasStrAtrasada = useValorAtrasado(entradasStr, 300);
  const entradasAtrasadas: Record<string, string> = useMemo(
    () => JSON.parse(entradasStrAtrasada) as Record<string, string>,
    [entradasStrAtrasada],
  );
  const qs = useQueries({
    queries: comSku.map(({ r }) => {
      // A chave USADA na query é a atrasada quando existe (mesmo modeloId ainda presente); sem par atrasado (produto
      // que acabou de ganhar o 1º SKU manual neste render), usa a de agora — não há o que atrasar ainda.
      const chave = entradasAtrasadas[r.modeloId] ?? entradas[r.modeloId];
      return {
        queryKey: ["integracao-sku-previa", tenantId, r.modeloId, chave],
        enabled: ativo && !!tenantId,
        placeholderData: keepPreviousData,
        queryFn: async (): Promise<PreviaSkus> => {
          // N1: a entrada da CHAMADA vem da própria chave da query, não do `e` do render que a criou (que pode já
          // estar defasado se um refetch acontecer dentro da janela do debounce).
          const ed = entradaDaChave(chave);
          const { data, error } = await supabase.rpc("skus_previa" as any, {
            _modelo_id: r.modeloId, _ref: ed.ref, _tamanho_tipo: ed.tamanhoTipo, _manuais: ed.manuais, _modo: ed.modo,
          });
          if (error) throw error;
          return lerPrevia(data, chave);
        },
      };
    }),
  });
  return Object.fromEntries(
    comSku.map(({ r }, i) => {
      const q = qs[i];
      const chave = entradasAtrasadas[r.modeloId] ?? entradas[r.modeloId];
      if (q?.isError) return [r.modeloId, previaDeErro(r, chave, q.error)];
      return [r.modeloId, q?.data];
    }),
  );
}

/** M2 (code-review.md): erro de `skus_previa` (rede, RPC) vira uma `PreviaSkus` com 1 `ErroPrevia` POR linha "a
 *  gravar" do rascunho — `situacaoPrevia` já sabe sintetizar o estado de erro de uma linha a partir de `erros` (ver
 *  o comentário de `usePreviasSkus`), então a célula mostra `mensagemErroPrevia` em vez de ficar parecendo que a
 *  prévia ainda está carregando. Cada linha "a gravar" também entra em `matriz.linhas` (com o SKU já digitado) —
 *  sem isso, o futuro `SkuCelula` (T12a/T14, que casa por `variante_key`/`tamanho_key`) nunca encontraria a linha e o
 *  erro nunca apareceria de fato. `desconhecida: true`/`assinatura: null` (fail-closed, igual a uma prévia ilegível)
 *  garante que ninguém tenta aplicar SKU em cima de uma prévia que nunca chegou a existir de verdade.
 *  Fix round 2 (N2): `entrada` é a CHAVE da query que falhou, nunca o literal "erro" — ver o comentário de
 *  `usePreviasSkus`. */
function previaDeErro(r: Rascunho, chave: string, err: unknown): PreviaSkus {
  const mensagem = mensagemErro(err, "Não foi possível calcular a prévia dos SKUs.");
  const manuais = Object.values(r.skus.manuais);
  const erros: ErroPrevia[] = manuais.map((m) => ({
    variante_key: m.varianteKey, tamanho_key: m.tamanhoKey, code: "P0001", mensagem,
  }));
  const linhas: LinhaPrevia[] = manuais.map((m) => ({
    variante_key: m.varianteKey, variante_ordem: null, cor_nome: null, apelido_nome: null,
    tamanho_key: m.tamanhoKey, tamanho_ordem: null,
    id: m.id, sku: m.sku, manual: true, rev: m.rev,
    sku_previsto: null, faltas: [], avisos: [], conflito_com: null, estado: "vazio", previa: null,
  }));
  return {
    matriz: { status: "desconhecido", tamanho_tipo: null, tamanho_tipo_card: null, linhas, faltas: [], avisos: [] },
    assinatura: null, erros, nConflitos: 0, entrada: chave, desconhecida: true,
  };
}

export const depsSupabase: DepsSalvar = {
  subirFoto: (file) => uploadFile(file, "fotos_modelo"),
  // Minor 4 (task-11-review.md): `storage.remove` NUNCA lança — devolve `{error}` no retorno. Sem checar isso, uma
  // falha de limpeza (ex.: RLS, rede) desaparecia em silêncio (o `.catch(() => undefined)` do orquestrador também
  // engole qualquer rejeição desta função — essa é a ÚLTIMA chance de deixar rastro). Um `console.warn` custa nada e
  // NUNCA lança — a limpeza de fotos é best-effort por natureza (o pior caso já é só um órfão no Storage).
  apagarFotos: async (caminhos) => {
    const { error } = await supabase.storage.from(BUCKET).remove(caminhos);
    if (error) console.warn("[integracao] falha ao apagar fotos órfãs do Storage:", caminhos, error);
  },
  salvar: async (itens) => {
    const { data, error } = await supabase.rpc("integracao_salvar" as any, { _itens: itens });
    if (error) throw error;
    const o = (data ?? {}) as { salvos?: number; revs?: Record<string, number> };
    return { salvos: Number(o.salvos ?? 0), revs: o.revs ?? {} };
  },
  previaSkus: async (modeloId, e) => {
    const { data, error } = await supabase.rpc("skus_previa" as any, {
      _modelo_id: modeloId, _ref: e.ref, _tamanho_tipo: e.tamanhoTipo, _manuais: e.manuais, _modo: e.modo,
    });
    if (error) throw error;
    return lerPrevia(data, "salvar");
  },
  aplicarSkus: async (modeloId, a) => {
    const { data, error } = await supabase.rpc("aplicar_skus_modelo" as any, {
      _modelo_id: modeloId, _manuais: a.manuais, _modo: a.modo, _assinatura: a.assinatura,
    });
    if (error) throw error;
    return data;
  },
};

/** Tudo que mostra dado do produto relê (mão dupla: card, Dev, PA/PI, selos).
 *  Fix round 1 (M4, code-review.md): `produtos-importados` entra ao lado de `produtos-acabados` — o Salvar também
 *  muda o preço fixo do importado (`salvar_precos_fixo_produto_importado`) e o nome/REF do espelho via gatilho
 *  (`fn_modelo_espelho_nome_ref`), então uma tela de Produto Importado montada também precisa reler. */
export function invalidarIntegracao(qc: QueryClient, tenantId: string, ids: string[] = []): void {
  for (const k of [chaveLista(tenantId), chaveEstado(tenantId), chaveLog(tenantId)]) void qc.invalidateQueries({ queryKey: k });
  for (const k of ["modelos-planejamento", "modelos-desenvolvimento", "produtos-acabados", "produtos-importados", "plan-custo-unit"]) {
    void qc.invalidateQueries({ queryKey: [k] });
  }
  for (const id of ids) {
    void qc.invalidateQueries({ queryKey: ["modelo", id] });
    void qc.invalidateQueries({ queryKey: ["plan-skus", id] });
    // M2: a key da prévia agora leva o tenant (["integracao-sku-previa", tenantId, modeloId, chave]) — invalida pelo
    // prefixo (tenant + modeloId), que casa com QUALQUER chave/entrada daquele produto.
    void qc.invalidateQueries({ queryKey: ["integracao-sku-previa", tenantId, id] });
  }
}

export function useSalvarIntegracao() {
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  return useMutation({
    // I2 (task-11-review.md + code-review.md): `mutationKey` própria, por tenant — `useIntegracaoAoVivo` consulta
    // `qc.isMutating` com esta MESMA key pra não relistar no meio do Salvar (ver o comentário lá).
    mutationKey: chaveMutationSalvar(tenantId),
    mutationFn: (rascunhos: Rascunho[]): Promise<ResultadoSalvar> => salvarIntegracao(rascunhos, depsSupabase),
    onSettled: (_d, _e, rascunhos) => invalidarIntegracao(qc, tenantId, rascunhos.map((r) => r.modeloId)),
  });
}
