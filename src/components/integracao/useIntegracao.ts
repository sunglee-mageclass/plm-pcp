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
import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { TEXTO_SESSAO_EXPIRADA, mensagemErro } from "@/lib/erro-mensagem";
import { BUCKET, uploadFile } from "@/components/planejamento/modelo-shared";
import {
  chaveEntradaPrevia, entradaDaChave, lerPrevia,
  type ErroPrevia, type LinhaPrevia, type PreviaSkus,
} from "@/components/planejamento/planejamento-detail/codigos/sku-previa";
import {
  filtrosParaRpc, lerLista, lerVersoesIntegradas, type Filtros, type ListaIntegracao, type Situacao, type VersaoIntegradaInfo,
} from "@/lib/integracao/produtos";
import { useVersaoAnterior } from "@/hooks/useVersaoAnterior";
import type { VersaoAnteriorInfo } from "@/lib/versao-anterior";
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

// P-130 A: teto que a tela pede pra `integracao_listar` — o máximo que a RPC aceita (o servidor recusa acima
// disso com P0001, ver a migration do banco). Exportado pra `ProdutosAba.tsx` decidir "mostra paginação?"
// (`lista.total > LIMITE_PRODUTOS`) sem duplicar o número mágico 500 em dois arquivos.
export const LIMITE_PRODUTOS = 500;
export const chaveLista = (tenantId: string) => ["integracao-lista", tenantId] as const;
export const chaveConfig = (tenantId: string) => ["integracao-config", tenantId] as const;
export const chaveEstado = (tenantId: string) => ["integracao-estado", tenantId] as const;
export const chaveLog = (tenantId: string) => ["integracao-log", tenantId] as const;

/** Mensagem do `LOJA_MUDOU` (fix round 2 T15, code-review "Re-check round 1" I1-R): ÚNICA — qualquer chamador que
 *  precisar mostrar o mesmo texto (toast, banner) usa esta constante, nunca um literal duplicado. */
export const TEXTO_LOJA_MUDOU = "A loja ativa mudou (em outra aba ou janela). Recarregue a página antes de salvar.";

/** Fix round 4 T15 (code-review "Re-check round 3" m-R3): `confirmarLojaAtiva` sem sessão nenhuma (e sem erro) =
 *  sessão expirada/encerrada, NUNCA "a loja mudou". Código próprio do cliente (`SESSAO_EXPIRADA`, mesmo padrão de
 *  `LOJA_MUDOU`); o TEXTO é a constante única do app (`erro-mensagem.ts`, a mesma do JWT expirado) — reexportada
 *  aqui para quem já importa os textos da Integração deste módulo. */
export { TEXTO_SESSAO_EXPIRADA };

/** Fix round 4 T15 (follow-up do coordenador, concern 3): recusa quando a loja do CLIENTE está vazia/desconhecida
 *  ("" — a releitura de `active-tenant-id` falhou e o hook assentou ""). NUNCA manda recarregar a página: desde o
 *  N-1 o rascunho sobrevive ao "" e um reload o jogaria fora. `LOJA_MUDOU` fica SÓ para troca de loja confirmada
 *  (o servidor devolveu outra loja). `mensagemErro` devolve este texto como veio (já está em PT). */
export const TEXTO_LOJA_INDISPONIVEL = "Sem conexão com o servidor agora. Espere um instante e salve de novo.";

/** Resultado de `confirmarLojaAtiva` (fix round 3 T15, code-review "Re-check round 2" m-R2): a loja confirmada
 *  (`tenantId`) e o nome dela (`nome`, via embed — a MESMA linha, sem 2ª chamada). `nome` pode vir `null` se a
 *  loja não tiver nome cadastrado (raro) — nunca lançado por isso. */
export type LojaAtiva = { tenantId: string; nome: string | null };

/** Fix round 2 T15 (code-review "Re-check round 1" I1-R): a defesa da fix round 1 (`Edicao.tenantId` congelado vs
 *  `useActiveTenantId()` corrente, comparados no mutationFn) só compara dois valores do CLIENTE — o `tenantId`
 *  corrente vem do CACHE do TanStack Query (`["active-tenant-id", uid]`), que só atualiza quando o próprio
 *  `TenantSwitcher` roda `refetchQueries` (mesma aba) ou quando ALGO reativa a query (foco de janela — e
 *  `focusManager` só escuta `visibilitychange`, não `focus`; uma 2ª janela/aba visível o tempo todo nunca
 *  reobserva sozinha). Cenário real: o super admin troca de loja numa 2ª aba/janela — o SERVIDOR
 *  (`public.users.tenant_id`) já mudou, mas o cache desta aba/janela continua com o tenant ANTIGO, e
 *  `Edicao.tenantId === tenantId` bate (os dois são igualmente velhos) — a defesa da fix round 1 não pega esse
 *  caso. Correção definitiva (comparar no SERVIDOR, dentro da mesma transação do save) fica pro backlog: a RPC
 *  não tem um parâmetro `_tenant_esperado` e o SQL desta campanha está congelado (decisão do coordenador, fix
 *  round 2). Este helper é a mitigação do lado do CLIENTE — relê `users.tenant_id` DIRETO do servidor (bypassa
 *  QUALQUER cache do TanStack Query; é a MESMA tabela/coluna que `useActiveTenantId` usa, mas sem passar pelo
 *  `queryClient`) imediatamente ANTES de cada gravação da Integração, e recusa com `LOJA_MUDOU` se divergir do
 *  tenant que o rascunho/dialog carregava. Chamar em TODO ponto de escrita da Integração — key/revogar (Chaves),
 *  config (Campos/API), Salvar de Produtos/Keywords, marcar/voltar/desfazer (estado) — IMEDIATAMENTE antes do
 *  `supabase.rpc(...)`, nunca antes (uma corrida entre a checagem e o `rpc` de verdade não é eliminável 100% sem
 *  mover a checagem pro servidor, mas reduz a janela de segundos/minutos de uma aba esquecida aberta pra
 *  milissegundos).
 *
 *  Fix round 3 T15 (code-review "Re-check round 2"):
 *  - **m-R1** (Important): a v1 (fix round 2) transformava QUALQUER falha em obter o usuário — inclusive um
 *    `getUser()` que rejeita por erro de REDE, não só "sessão realmente ausente" — em `LOJA_MUDOU`. Isso escondia
 *    a causa real (ex.: a internet caiu no meio do clique) atrás de uma mensagem que diz "a loja mudou", que é
 *    FALSO nesse caso — o usuário tentaria "recarregar a página" pra um problema que reload nenhum resolve
 *    (a rede continua caída). Fix: só a ausência CONFIRMADA de sessão (usuário deslogado de verdade, sem
 *    exception nenhuma) virava `LOJA_MUDOU` — desde o fix round 4 (m-R3, abaixo) vira `SESSAO_EXPIRADA`; qualquer
 *    `error`/exception de `getSession()` ou da query
 *    `users`/`tenants` é RELANÇADO como veio — `mensagemErro` traduz pelo `code`/mensagem reais (rede vira "Falha
 *    de conexão...", sessão expirada vira "Sua sessão expirou...", nunca "a loja mudou").
 *  - **m-R2** (performance + o mesmo m-R1 embutido): UMA ida ao servidor em vez de duas — `getSession()` (lê a
 *    sessão guardada no client; **nunca** chama `getUser()`, que SEMPRE faz uma chamada de rede pra revalidar o
 *    token contra o Auth) dá o `uid`, e `users.select("tenant_id, tenants(nome)")` (embed FK, mesma linha) traz
 *    tenant+nome numa query só. Devolve `LojaAtiva` — o nome CONFIRMADO fica disponível pro chamador sem uma 2ª
 *    leitura (`nomeLojaAtivaFresco`, aposentada — ver `NovaChaveDialog.tsx`).
 *
 *  Fix round 4 T15 (code-review "Re-check round 3"):
 *  - **nit — comentário corrigido** (a v1 dizia que uma sessão EXPIRADA ainda devolvia um `uid` porque "o client
 *    não valida a expiração" — FALSO): no auth-js 2.108.1, `getSession()` → `__loadSession` compara `expires_at`
 *    com `EXPIRY_MARGIN_MS` e, se o token expirou (ou está pra expirar), faz o REFRESH (aí sim, com rede) antes de
 *    devolver. Refresh que dá certo → sessão nova e válida (o fluxo segue normal); refresh que falha → `{ session:
 *    null, error }`, que este helper RELANÇA (m-R1) — rede caída vira "Falha de conexão…", refresh token inválido
 *    cai no texto em PT da tela; nunca `LOJA_MUDOU`. Só com token válido é que `getSession()` não faz rede.
 *    E mesmo com um token velho, o PostgREST recusa o JWT expirado (`PGRST301` → "Sua sessão expirou…") na query
 *    de `users` e na RPC de escrita que vem LOGO DEPOIS — `confirmarLojaAtiva` nunca é a ÚNICA defesa contra
 *    sessão expirada, só uma checagem A MAIS antes da escrita.
 *  - **m-R3**: sessão AUSENTE (`{ session: null, error: null }` — um refresh em segundo plano já falhou e o auth-js
 *    removeu a sessão, ou o usuário saiu noutra aba) agora lança `SESSAO_EXPIRADA` (texto único do app, "Sua sessão
 *    expirou. Entre novamente."), não `LOJA_MUDOU` (que mandava recarregar a página por um motivo falso). Nada é
 *    gravado nos dois casos.
 *  - **follow-up (concern 3)**: loja do CLIENTE vazia (`tenantIdEsperado === ""`) → `LOJA_INDISPONIVEL` ("Sem
 *    conexão com o servidor agora…"), antes de qualquer rede — nunca "Recarregue a página".
 *  Testado: loja do cliente vazia → `LOJA_INDISPONIVEL`; sessão ausente → `SESSAO_EXPIRADA`; erro de rede/sessão em
 *  `getSession`/`users` → relançado verbatim; loja divergente confirmada pelo servidor → `LOJA_MUDOU`. */
export async function confirmarLojaAtiva(tenantIdEsperado: string): Promise<LojaAtiva> {
  // Follow-up do fix round 4: loja do cliente vazia/desconhecida — não há o que confirmar; recusa SEM rede e sem
  // mandar recarregar (ver `TEXTO_LOJA_INDISPONIVEL`).
  if (!tenantIdEsperado) throw Object.assign(new Error(TEXTO_LOJA_INDISPONIVEL), { code: "LOJA_INDISPONIVEL" });
  const { data: sess, error: erroSessao } = await supabase.auth.getSession();
  if (erroSessao) throw erroSessao;
  const uid = sess.session?.user?.id;
  // m-R3: ausência CONFIRMADA de sessão (sem exception) = sessão expirada/encerrada — nunca "a loja mudou".
  if (!uid) throw Object.assign(new Error(TEXTO_SESSAO_EXPIRADA), { code: "SESSAO_EXPIRADA" });
  const { data, error } = await supabase
    .from("users")
    .select("tenant_id, tenants(nome)")
    .eq("id", uid)
    .maybeSingle();
  // m-R1: erro de rede/RLS/sessão expirada na query em si — RELANÇA verbatim, nunca vira LOJA_MUDOU.
  if (error) throw error;
  const linha = data as { tenant_id: string | null; tenants: { nome: string | null } | null } | null;
  const tenantAtual = linha?.tenant_id ?? "";
  const nome = linha?.tenants?.nome ?? null;
  if (tenantAtual !== tenantIdEsperado) {
    throw Object.assign(new Error(TEXTO_LOJA_MUDOU), { code: "LOJA_MUDOU" });
  }
  return { tenantId: tenantAtual, nome };
}

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
    // Fix round 4 T15 (N-1-R, code-review "Re-check round 4"): com a loja "" (a releitura de `active-tenant-id`
    // falhou — não é troca de loja) mantém a lista ANTERIOR como placeholder. Sem isso a lista ficava `undefined` e
    // o que depende dela desmontava — o `KeywordsDialog` (`{keywordsAberto && lista && …}`) perdia o texto digitado.
    // X → "" → Y continua sem vazar: sob Y, a query anterior com dado é a de X (queryKey[1] = X ≠ Y) → `undefined`.
    // Gravar com a loja "" segue recusado (`LOJA_INDISPONIVEL`). ⚠️ Esta função TEM de continuar INLINE (identidade
    // nova a cada render), nunca memoizada/estável: o query-core (`queryObserver`, `createResult`) REAPROVEITA o
    // placeholder anterior SEM chamar a função quando `options.placeholderData` é a MESMA referência do resultado
    // anterior — com uma referência estável, a loja Y mostraria a lista de X até o fetch de Y voltar.
    placeholderData: (prev, query) => (!tenantId || query?.queryKey[1] === tenantId ? prev : undefined),
    // Fix round 1 T13 (revisão T13 #11, code-review m5, limitação ACEITA): as tabelas de integração
    // (`integracao_produtos`/`integracao_linhas`) não têm policy Realtime — `useIntegracaoAoVivo` só escuta UPDATE
    // em `modelos`, e os 3 RPCs de estado (marcar/voltar/desfazer) NÃO tocam `modelos` (só travam com FOR NO KEY
    // UPDATE). Outro usuário com a mesma lista aberta não vê integrar/voltar/desfazer em tempo real — o servidor
    // continua garantindo a integridade (o Salvar dele falharia atômico com 42501 se tentasse editar um produto já
    // travado), mas a UX fica tardia até essa aba relistar sozinha. `refetchOnWindowFocus: true` (explícito — já é
    // o default do QueryClient desta app, sem override em `router.tsx`, mas documentado aqui de propósito) cobre o
    // caso mais comum: o usuário troca de aba/janela e volta. Ver task-13-report.md "Fix round 1" para o registro
    // completo desta limitação conhecida.
    refetchOnWindowFocus: true,
    // P-130 A (set/2026, dono): a tela carrega TUDO de uma vez (até 500) pra que ordenação e o filtro de nível de
    // Estado (faltam dados/completo) valham pra lista INTEIRA, não só pela página de 50 — `_limite: 500` é o
    // MÁXIMO aceito pela RPC (uma loja com ≤500 produtos nunca paginaria de verdade: `_pagina` continua com a
    // MESMA semântica de OFFSET de sempre, só que agora sobre blocos de 500 em vez de 50 — só lojas com MAIS de
    // 500 produtos na Situação/filtros escolhidos chegam a ter uma 2ª página).
    // ⚠️ ORDEM DE DEPLOY (nota do controlador): `_limite` é um parâmetro NOVO opcional em `integracao_listar` —
    // outro agente está adicionando na migration do banco. Uma `integracao_listar(text,jsonb,integer)` ANTIGA (sem
    // esse 4º parâmetro) REJEITA a chamada com `_limite` (PostgREST erra a função por assinatura — "no function
    // matches"), então o banco tem que subir ANTES deste front. Depois do deploy do banco, uma versão ANTIGA do
    // front (sem `_limite`) continua funcionando também (o parâmetro tem default 50 no servidor) — só não carrega
    // tudo de uma vez até o front novo também subir. Não remover `_limite` sem coordenar com quem tocar a RPC.
    queryFn: async (): Promise<ListaIntegracao> => {
      const { data, error } = await supabase.rpc("integracao_listar" as any, {
        _situacao: situacao, _filtros: f, _pagina: pagina, _limite: LIMITE_PRODUTOS,
      });
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

/** P-146/P-155 B — a versão anterior de cada produto da lista (1 chamada a `modelos_versao_anterior`, ≤ 500 ids), SÓ
 *  quando "Preço anterior" ou "Título" está marcado nos Campos da API (os únicos que dependem dela). */
export function useVersaoAnteriorIntegracao(lista: ListaIntegracao | undefined): {
  mapa: Map<string, VersaoAnteriorInfo> | undefined; carregando: boolean; erro: boolean; tentarDeNovo: () => void;
} {
  const ativo = !!lista && (lista.campos.includes("preco_anterior") || lista.campos.includes("titulo"));
  const ids = useMemo(() => (ativo && lista ? lista.produtos.map((p) => p.modeloId) : []), [ativo, lista]);
  const r = useVersaoAnterior(ids, ativo);
  // I1 (revisão front): erro SÓ quando falhou sem dado em cache (um refetch que falha com dado segue o dado anterior).
  return { mapa: ativo ? r.mapa : undefined, carregando: r.carregando, erro: r.erro, tentarDeNovo: r.tentarDeNovo };
}

/** P-156 C + R7 (T5) — "Versão de produto já integrado": 1 chamada a `integracao_versoes_integradas` com os ids da lista
 *  carregada (≤ 500). Só leitura; banco velho (PGRST202) ou erro = nenhum aviso (nunca bloqueia a tela). */
export const chaveVersoesIntegradas = (tenantId: string) => ["integracao-versoes-integradas", tenantId] as const;
export function useVersoesIntegradas(ids: readonly string[]): {
  mapa: Map<string, VersaoIntegradaInfo>; carregando: boolean; erro: boolean; tentarDeNovo: () => void;
} {
  const tenantId = useActiveTenantId();
  const chave = useMemo(() => [...new Set(ids)].sort().join(","), [ids]);
  const q = useQuery({
    queryKey: [...chaveVersoesIntegradas(tenantId), chave],
    enabled: !!tenantId && chave !== "",
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<unknown[]> => {
      const lista = chave.split(",");
      const out: unknown[] = [];
      for (let i = 0; i < lista.length; i += LIMITE_PRODUTOS) {
        const { data: d, error } = await supabase.rpc("integracao_versoes_integradas" as any, {
          _modelo_ids: lista.slice(i, i + LIMITE_PRODUTOS),
        });
        if (error) {
          if ((error as { code?: string }).code === "PGRST202") return [];
          throw error;
        }
        if (Array.isArray(d)) out.push(...d);
      }
      return out;
    },
  });
  const mapa = useMemo(() => lerVersoesIntegradas(q.data ?? []), [q.data]);
  // Minor 6 (revisão front): o filtro "Versão" precisa saber se o mapa ainda não chegou (ou falhou sem dado) — senão a
  // lista cairia num "nenhum produto" enganoso.
  const pedido = chave !== "";
  const semDado = q.data === undefined;
  return {
    mapa,
    carregando: pedido && semDado && !q.isError,
    erro: pedido && semDado && q.isError,
    tentarDeNovo: () => void q.refetch(),
  };
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
  // Fix round 2 T12b (minor, ambas as revisões — "memoize previaDeErro"): sem isso, `previaDeErro(r, chave,
  // q.error)` criava um objeto NOVO em TODO render deste hook pra cada query com erro — mesmo quando nada mudou
  // (mesmo `r`, mesma `chave`, mesmo `error`). Qualquer célula/linha memoizada rio abaixo que recebesse essa
  // `PreviaSkus` como prop nunca bateria no comparador raso do `React.memo`, rerrenderizando à toa. Chaveado por
  // `${modeloId}:${chave}` — muda de identidade só quando a ENTRADA muda de verdade (o erro em si não carrega
  // identidade própria pra comparar; a chave já é o que determina se a prévia "significa a mesma coisa").
  const previaErroCache = useRef<Map<string, PreviaSkus>>(new Map());
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
  // Poda o cache de erro pelos ids AINDA com SKU a gravar neste render — mesmo padrão de `semRascunhoCache` em
  // `ProdutosAba.tsx` (o cache não cresce sem limite entre digitações/navegações).
  const vivos = new Set(comSku.map(({ r }) => `${r.modeloId}:${entradasAtrasadas[r.modeloId] ?? entradas[r.modeloId]}`));
  for (const chave of previaErroCache.current.keys()) {
    if (!vivos.has(chave)) previaErroCache.current.delete(chave);
  }
  return Object.fromEntries(
    comSku.map(({ r }, i) => {
      const q = qs[i];
      const chave = entradasAtrasadas[r.modeloId] ?? entradas[r.modeloId];
      if (q?.isError) {
        const chaveCache = `${r.modeloId}:${chave}`;
        const cache = previaErroCache.current;
        const emCache = cache.get(chaveCache);
        // `emCache` já cobre "mesma entrada" (a chave já leva `chave`, que é o que caracteriza a tentativa) — um
        // erro NOVO pra mesma entrada (ex.: um retry que falha de novo) reaproveita o mesmo objeto memoizado; só a
        // MENSAGEM pode diferir de verdade num retry (rede instável), mas a UI trata isso como "mesma falha".
        if (emCache) return [r.modeloId, emCache];
        const novo = previaDeErro(r, chave, q.error);
        cache.set(chaveCache, novo);
        return [r.modeloId, novo];
      }
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
 *  (`fn_modelo_espelho_nome_ref`), então uma tela de Produto Importado montada também precisa reler.
 *  m3 (final-review) — faltavam 3 caches que mostram o MESMO nome/preço do produto: `plan-tecido-*` (os slots
 *  do Plan. Tecido, prefixo — mesmo predicado que `invalidarPlanTecido` já usa em `criacao.planejamento.tsx`),
 *  `plan-revenda-markups`/`plan-importado-produtos` (o card do Plan. Produto lê estes p/ mostrar o markup/preço
 *  fixo de revenda/importado — keys reais, `["plan-revenda-markups", modeloIdsAll]`/`["plan-importado-produtos",
 *  modeloIdsAll]`, casadas por prefixo do 1º elemento) e `pa-produto-modelo` (o bloco de revenda do Sheet do
 *  Planejamento, key `["pa-produto-modelo", modeloId]` — POR id, não em bulk; entra no loop de `ids` abaixo). */
export function invalidarIntegracao(qc: QueryClient, tenantId: string, ids: string[] = []): void {
  for (const k of [chaveLista(tenantId), chaveEstado(tenantId), chaveLog(tenantId), chaveVersoesIntegradas(tenantId)]) {
    void qc.invalidateQueries({ queryKey: k });
  }
  // P-146/P-155 B: o Salvar pode ter repreçado/renomeado uma versão que outra herda.
  void qc.invalidateQueries({ queryKey: ["versao-anterior"] });
  for (const k of ["modelos-planejamento", "modelos-desenvolvimento", "produtos-acabados", "produtos-importados", "plan-custo-unit", "plan-revenda-markups", "plan-importado-produtos"]) {
    void qc.invalidateQueries({ queryKey: [k] });
  }
  void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey?.[0] === "string" && (q.queryKey[0] as string).startsWith("plan-tecido") });
  for (const id of ids) {
    void qc.invalidateQueries({ queryKey: ["modelo", id] });
    void qc.invalidateQueries({ queryKey: ["plan-skus", id] });
    void qc.invalidateQueries({ queryKey: ["pa-produto-modelo", id] });
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
    mutationFn: async (rascunhos: Rascunho[]): Promise<ResultadoSalvar> => {
      // revisão T15 #I1-R (code-review "Re-check round 1"): relê a loja ativa DIRETO do servidor antes do Salvar
      // de Produtos — mesma defesa dos outros pontos de escrita da Integração. Nada é enviado se divergir.
      await confirmarLojaAtiva(tenantId);
      return salvarIntegracao(rascunhos, depsSupabase);
    },
    onSettled: (_d, _e, rascunhos) => invalidarIntegracao(qc, tenantId, rascunhos.map((r) => r.modeloId)),
  });
}
