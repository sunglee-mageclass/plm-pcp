# Salvar por card — preço/markup da revenda no Salvar único do Sheet

**Data:** 2026-11-18
**Frente:** Camada intermediária / staging — item C7 "Salvar por card" (ver [[project_camada_intermediaria]]).
**Branch:** `feature/plan-tecido-a1`.
**Escopo decidido com o dono (18/nov):** SÓ a revenda. Abordagem A (espelhar o padrão do importado).

## Problema

No Sheet do Planejamento (`PlanejamentoDetail`), um card de produto **comprado de revenda**
(`modelos.origem = 'revenda'`, espelho em `produtos_acabados`) mostra um bloco de preço com 4 campos:

1. **Markup atacado** (`produtos_acabados.markup_atacado`)
2. **Markup varejo** (`produtos_acabados.markup_varejo`)
3. **Preço atacado fixo** (preço exato, trava o markup atacado)
4. **Preço varejo fixo** (preço exato, trava o markup varejo)

Hoje esses 4 campos gravam **na hora (onBlur)**, cada um via RPC própria, **fora do Salvar único do
Sheet** (`src/components/planejamento/planejamento-detail/RevendaSetores.tsx`):

- markups → `salvar_markups_produto_acabado` (`useRevendaPlanejamento.ts:117`)
- preços fixos → `salvar_precos_fixo_produto_acabado` (`useRevendaPlanejamento.ts:147`)

Isso é a última gravação-na-hora de **dinheiro** num Sheet que, para todo o resto, já é **Salvar
único** (`salvar_card_planejamento`, Task 3 da Camada). O usuário edita o preço e ele já foi, sem
"não salvo", sem poder descartar, sem entrar na proteção de conflito (rev/P0409) do Salvar.

## Objetivo

Os 4 campos deixam de gravar onBlur e passam a ser **rascunho local** que o **botão Salvar do Sheet**
persiste junto com o resto, exatamente como **o importado já faz** (bloco "n1" de
`usePlanejamentoSave.ts`, que grava o preço fixo do importado dentro da cadeia de Salvar).

**Sucesso:**
- Editar markup/preço da revenda NÃO grava sozinho; o selo "alterações não salvas" acende; Descartar
  volta ao servidor.
- UM Salvar do Sheet grava preço/markup junto com o resto do card.
- A trava da Integração no **varejo** segue respeitada (atacado nunca trava — só `preco_venda`/varejo
  é marcável na Integração).
- Zero perda de dado em edição simultânea (reusa a base congelada + comparação do padrão do importado).

## Precedente a seguir (o importado)

`usePlanejamentoSave.ts`, bloco "n1" (linha ~825): no `mutationFn`, DEPOIS do UPDATE do header e da
auto-criação do produto, se o preço do importado mudou vs. a **base congelada** (`precoBaseCongelado`,
lida no mesmo ponto síncrono que `d`/`revCongelado`, ANTES de qualquer `await`) e com
`podeEditarPreco`, chama `salvar_precos_fixo_produto_importado` com `tocarVarejo = !travaVarejo`. O
resultado real do servidor pós-recompute vira a base/baseline (`precosServidorPosRpc`), usada no
`onSuccess`. A revenda vai ganhar o bloco gêmeo disto, com as 2 RPCs dela.

## Design

### Componentes e responsabilidades

- **`RevendaSetores.tsx` (UI):** os 4 inputs passam a ser **controlados pelo rascunho** (os `draft`/
  estados locais já existem: `markupAtacadoInput`, `markupVarejoInput`, `precoAtacadoDraft`,
  `precoVarejoDraft`). **Removem-se os 4 `onBlur` que chamam `.mutate`.** Os inputs só fazem
  `setState` + marcam o card sujo (o Sheet já tem `useDirtySnapshot`; os 4 valores entram no snapshot).
  O `onKeyDown` Enter→blur continua (só tira o foco; não grava).
- **`useRevendaPlanejamento.ts`:** as 2 mutations `salvarMarkupsRevenda`/`salvarPrecosFixoRevenda`
  deixam de ser chamadas pela UI. Passam a expor **funções de gravação** reutilizáveis pelo
  `mutationFn` do Salvar (ou o Salvar chama as RPCs direto — ver "Ponto de integração"). O
  `markupCanalIntocado` e os refs `enviado*Ref`/`*BaseRef` continuam valendo (a lógica de "canal não
  tocado reenvia o último enviado" é a mesma).
- **`usePlanejamentoSave.ts` (cadeia de Salvar):** ganha um bloco "revenda" gêmeo do "n1" do
  importado, no ramo `d.origem === 'revenda'`, DEPOIS do UPDATE do header.

### Fluxo de dados no Salvar (ramo revenda)

No `mutationFn`, capturar no ponto síncrono inicial (antes de qualquer `await`), junto com `d`:
- `revendaBase = { markup_atacado, markup_varejo, preco_atacado_fixo?, preco_varejo_fixo? }` lidos do
  servidor (`produtoRevenda`), congelados — NÃO reler de `baseRef` depois (o merge do colab pode ter
  avançado a base durante os awaits; comparar contra base mais nova reenviaria valor não mudado,
  sobrescrevendo edição alheia — é o fix M-2 do importado).
- `travaVarejo` deste save (mesmo `travaIntegracao` que o resto da cadeia usa).

Depois do UPDATE do header (e da parte de PA/PI já existente), no ramo revenda:

1. **Markups** — se `markupAtacadoInput`/`markupVarejoInput` (rascunho) diferem de `revendaBase` e
   `podeEditarPrecoComprado`:
   `salvar_markups_produto_acabado(_produto_id, _markup_atacado, _markup_varejo)`.
   O canal **varejo** vai como `markupCanalIntocado(...)` quando NÃO foi tocado; quando `travaVarejo`,
   o varejo NUNCA é um valor novo (manda o atual do servidor / não toca), igual ao importado.
2. **Preços fixos** — se `precoAtacadoDraft`/`precoVarejoDraft` (rascunho) diferem de `revendaBase`:
   `salvar_precos_fixo_produto_acabado(_produto_id, _tocar_atacado, _preco_atacado_fixo, _tocar_varejo,
   _preco_varejo_fixo)`. `_tocar_varejo = false` quando `travaVarejo` (não tenta gravar preço no canal
   travado — o gatilho `fn_integracao_trava_espelho` recusaria DEPOIS do header já comitado).
3. O servidor recomputa `modelos.preco_atacado`/`preco_venda` = `coalesce(fixo, round(base×markup,2))`.
   Capturar o resultado real (como `precosServidorPosRpc` do importado) para o `onSuccess` usar como
   baseline — senão o próximo Salvar compararia contra o valor TENTADO, não o efetivo.

### rev / P0409 / colab

- O ramo revenda roda DEPOIS do UPDATE do header (que já faz o `.eq("rev", revCongelado)` e dá P0409
  se alguém salvou no meio). As 2 RPCs da revenda escrevem `produtos_acabados` (não `modelos`), então
  não têm `.eq("rev")` próprio — seguem o mesmo modelo do importado (a proteção é o header do card).
- As invalidações que as mutations faziam (`["modelo", modeloId]`, `["pa-produto-modelo", modeloId]`,
  `["produtos-acabados"]`, `["modelos-planejamento"]`) passam para o `onSuccess` do Salvar (uma vez,
  no fim), não mais por mutation.
- O retry do P0409 reentra no `mutationFn` do zero: a captura síncrona de `revendaBase` acontece de
  novo (como `d`/`revCongelado`), então o retry não reusa base velha.

### Trava da Integração (varejo)

- `travaVarejo` = `preco_venda` travado pela Integração neste save. Enquanto travado:
  - markup varejo e preço varejo ficam **read-only na UI** (já é o caso hoje: `disabled={... ||
    travaVarejo}`), então o rascunho desses canais nunca diverge da base.
  - No Salvar, por garantia, o canal varejo nunca é enviado como valor novo (`_tocar_varejo = false`;
    markup varejo = valor do servidor), espelhando o importado.
- Atacado nunca trava (não é marcável na Integração).

### Permissões

- `podeEditarPrecoComprado` (= edita a página do produto OU `criacao_planejamento:preco_venda`) gate
  a edição dos 4 campos (já é assim). Sem ela, os campos são read-only e o Salvar não manda a revenda.
- `planBloqueado` (card enviado à Explosão / só leitura) também já desabilita.

## Error handling

- Falha de uma das RPCs da revenda no meio do Salvar: o header JÁ comitou (UPDATE antes). Seguir o
  mesmo tratamento do importado — a falha é logada e o toast de erro aparece, mas o Salvar do header
  não é desfeito (não há transação única cobrindo header + produto-espelho; é o comportamento atual do
  importado e do resto da cadeia). O preço fica como estava no servidor; o rascunho segue sujo para o
  usuário tentar de novo. **Não** inventar rollback do header (fora de escopo; o importado não tem).
- A trava da Integração (42501) não deve ser alcançada porque o canal travado não é enviado; se vier
  (aba desatualizada), cai no tratamento de erro do Salvar e a tela re-sincroniza.

## Testes

- **Unit (lógica pura, se extraída):** a decisão "o que mandar por canal" (tocado vs. intocado vs.
  travado) — se virar um helper puro (ex.: `payloadRevendaParaSalvar(base, rascunho, travaVarejo)`),
  testar: só atacado mudou → manda markup com varejo intocado; varejo travado → nunca manda varejo
  novo; preço fixo digitado → `tocar=true` naquele canal; nada mudou → não chama RPC.
- **Integração (cópia local, txn revertida):** card de revenda — editar markup atacado e Salvar →
  `produtos_acabados.markup_atacado` muda, `preco_atacado` recomputado; editar preço varejo fixo e
  Salvar → `preco_venda` = fixo; varejo travado pela Integração + tentar Salvar → varejo não muda,
  atacado muda. Reusar o harness do importado.
- **QA no navegador (:5190):** editar os 4 campos, confirmar que NÃO gravam ao sair do campo (só o
  selo "não salvo" acende), que Descartar volta, e que UM Salvar grava tudo. Conferir numa loja com a
  Integração travando o varejo.
- **Build + tsc:** `npm run build` + `npx tsc --noEmit | grep TS2304`.
- **Anti-regressão:** o importado (que já faz isto) e o manufaturado continuam salvando igual; o
  Salvar único não ganha P0409 falso (as invalidações de `["modelo"]` seguem no onSuccess).

## Fora de escopo (confirmado com o dono)

- Endereçamento de tecido, observações do modelo, obs de CQ, nomes (loja/armário) — gravam na hora DE
  PROPÓSITO; ficam como estão.
- Zona cinza do Plan.Tecido (paleta, vincular OC, mix) — metadados por clique; ficam como estão.
- Importado — já resolvido (é o precedente).

## Riscos

1. **Comparar contra base não congelada** reenviaria valor não mudado e sobrescreveria edição alheia —
   mitigado copiando o padrão M-2 do importado (congelar `revendaBase` no ponto síncrono inicial).
2. **Header comita e a RPC da revenda falha** — aceito (mesmo comportamento do importado; sem txn
   única). Documentado no error handling.
3. **Divergência markup×preço-fixo** (fixar preço limpa markup) — a regra vive no servidor
   (`salvar_precos_fixo_produto_acabado` já faz `_tocar_X`); o front só manda o rascunho, não
   reimplementa a regra.
4. **Markup do importado só tinha preço FIXO na cadeia; a revenda tem markup TAMBÉM** — por isso a
   revenda precisa das 2 RPCs no Salvar (markups + fixos), não só uma. É a única diferença vs. o n1.
