# OTB — mover o resumo de subcoleção da lista para os editores

**Data:** 2026-07-21
**Tipo:** mudança de UI (relocação de apresentação — sem RPC/schema/regra de negócio)

## Problema

No OTB, cada card da **lista** (`otb.index`) carrega, no rodapé, o detalhamento
por subcoleção com `realizado/planejada`. Isso deixa os cards da lista longos e
polui a visão de conjunto. Esse detalhe é mais útil dentro do **editor** da
coleção, junto do resto do plano.

## Estado atual

Em `src/routes/_authenticated/otb.index.tsx`, o rodapé de **cada card** (PV e
Orçamento) tem dois blocos, ambos vindos de `useOrcamento()` — que só retorna
buckets para coleção **confirmada**:

- **Bloco A** (linhas 248-260) — nível **coleção**: `realizado/total modelos ·
  divergência`. Usa `orcHook.colecao(c.id)`.
- **Bloco B** (linhas 261-289) — o **resumo de subcoleção**: cada subcoleção com
  `realizado/total` (âmbar quando estoura) + o nível-3 indentado (linha no PV,
  categoria no Orçamento), via `orcHook.subcolecoesDe` + `orcHook.niveis3De`.

Os editores:

- `src/components/otb/ColecaoPVSheet.tsx` — `Card` de cabeçalho com formulário +
  métricas + bloco **"Mix por linha — % real vs meta do padrão"** (linhas 466-489).
  Não importa `useOrcamento`.
- `src/components/otb/ColecaoSheet.tsx` (editor de Orçamento) — painel de resumo no
  rodapé (linhas 563-579: "No Planejamento", Orçamento/Custo/Poder/Saldo/Status).
  Não tem "Mix por linha". Não importa `useOrcamento`.

## Mudança

### 1. Peça reutilizável — `SubcolecaoResumo`

Extrair o markup do Bloco B para um componente `SubcolecaoResumo` em
`src/components/otb/orcamento.tsx` (co-locado com `useOrcamento`).

- **Props:** `{ colecaoId: string | null; title?: string; className?: string }`.
- Usa `useOrcamento()` internamente (a query `["otb-orcamento"]` é deduplicada por
  queryKey; `staleTime` de 30s já definido).
- Deriva `subs = colecaoId ? orc.subcolecoesDe(colecaoId) : []`.
- **Retorna `null` quando `subs.length === 0`** (coleção não confirmada / nova) —
  assim o consumidor não precisa guardar a renderização.
- Renderiza um bloco titulado: header `title` (default
  `"Subcoleções — realizado / planejado"`) + a lista de subcoleções e nível-3,
  com o **mesmo markup atual** (mesmas classes, âmbar em `over`, `pl-3` no
  nível-3) para paridade visual exata.

### 2. `otb.index.tsx`

- **Remover** o Bloco B (IIFE das linhas 261-289).
- **Manter** o Bloco A (linhas 248-260): o roll-up de coleção + flag de
  divergência continua na lista (pareia com `sidebar_badges.otb_divergencia`);
  só o detalhe por subcoleção sai da lista.

### 3. `ColecaoPVSheet.tsx`

- Importar `SubcolecaoResumo` de `./orcamento`.
- Renderizar `<SubcolecaoResumo colecaoId={savedId} className="border-t pt-2" />`
  logo **abaixo do bloco "Mix por linha"** (dentro do `Card` de cabeçalho, após a
  linha 489, ainda dentro do `div.mt-3.space-y-2`). O `border-t pt-2` casa com o
  estilo do bloco de mix (que usa o mesmo padrão).
- Usar `savedId` (não `colecaoId`) para refletir o id após um primeiro save.
  O `confirmar`/`feito` já invalida `["otb-orcamento"]`, então o bloco atualiza.

### 4. `ColecaoSheet.tsx` (editor de Orçamento)

- Importar `SubcolecaoResumo` de `./orcamento`.
- Renderizar `<SubcolecaoResumo colecaoId={colecaoId} className="border-t pt-1 mt-1" />`
  no painel de resumo do rodapé (após a linha 578, a de "N modelo(s) · N peça(s)"),
  já que esse editor não tem "Mix por linha" — é o ponto equivalente de resumo.
- O `confirmar`/`desconfirmar` já invalida `["otb-orcamento"]`.

## Decisões

- **Bloco A permanece na lista.** O pedido cita "resumo de **subcoleção**" (Bloco B).
  Bloco A é nível coleção e continua útil como roll-up + flag de divergência na
  visão de lista.
- **Números = realizado/planejada** (via `useOrcamento`), idênticos aos da lista —
  só populam em coleção **confirmada**; em rascunho/nova o bloco não aparece.
- **Escopo:** tirar da lista para **ambos** os tipos (PV e Orçamento) e adicionar o
  resumo nos **dois** editores, mantendo paridade.

## Fora de escopo

- Sem migration, sem RPC, sem mudança de regra de negócio.
- Sem alteração em `computeColecaoResumo` nem no `useOrcamento`/RPC `otb_orcamento`.

## Verificação

- `npm run build` + `npx tsc --noEmit 2>&1 | grep TS2304` (imports/identificadores).
- Conferência visual das 3 telas: lista do OTB (Bloco B sumiu, Bloco A ficou),
  editor PV (resumo abaixo do Mix por linha em coleção confirmada), editor de
  Orçamento (resumo no painel do rodapé em coleção confirmada).
