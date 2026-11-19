# Navegação por teclado em grades — hook `useGradeTeclado` + piloto CQ

**Data:** 2026-11-19
**Frente:** Navegação por teclado em grades (Enter desce / Tab ao lado)
**Piloto:** CQ (matriz variante×tamanho, Pré e Pós)
**Branch:** `feature/plan-tecido-a1`
**Tipo:** front puro — **ZERO migration, ZERO banco**

---

## Entendimento (intenção do dono, confirmada no brainstorm 19/nov)

Digitar numa grade (matriz variante×tamanho) andando pelo teclado como numa planilha —
**Enter desce, Tab vai ao lado** (estoura para a próxima linha), **Shift+Tab inverso** — sem
precisar do mouse a cada célula. Hoje isso só existe na `DistribuicaoTabelas` (Plan.Tecido); as
outras grades não têm.

**Decisões do dono:**
1. **Pular células travadas:** Enter/Tab salta as desabilitadas (permissão, Integração, tamanho
   fora da grade, co-edição da Onda 3) e para na próxima **habilitada** na mesma direção —
   comportamento de planilha.
2. **Fatia 1 (esta frente):** extrair um **hook reutilizável `useGradeTeclado`** da lógica que já
   existe e aplicá-lo em **1 grade-piloto: o CQ** (Pré e Pós). As demais grades (OC Tecido,
   comprado, PCP Serviços, Explosão) entram em ondas futuras, uma a uma.
3. **Respeitar a ordem visual** e campos travados; na **borda** da grade, deixar o fluxo nativo do
   navegador (Tab normal sai da grade).

**Sucesso:** no CQ, digito um número, Enter desce para a mesma coluna na linha de baixo, Tab anda
para a direita (estoura para a próxima linha), células travadas são puladas, e a
`DistribuicaoTabelas` continua **idêntica** (passa a usar o mesmo hook — anti-regressão).

## Abordagem escolhida (A — endereçamento por `data-grade-cel="L:C"`)

Cada célula navegável ganha um atributo de posição `data-grade-cel="<linha>:<coluna>"`. No
Enter/Tab, o hook calcula a próxima posição e **procura no DOM**, dentro da grade, o próximo
`data-grade-cel` cujo input exista e **não** esteja `disabled`, pulando os travados; na borda,
deixa o fluxo nativo. (Abordagens rejeitadas: B reusar `data-colab-path` — acopla o hook ao formato
de path de cada tela, e o CQ não tem path por célula; C navegar pela ordem do DOM — perde o "Enter
desce", vira igual a Tab.)

**Ponto de alavanca:** o CQ usa o componente compartilhado **`MatrizGradeResponsiva`**
(`src/components/shared/MatrizGradeResponsiva.tsx`), também usado por `GradeComparativoBloco` e
`GradeDestrinchada`. Instrumentar o `data-grade-cel` **uma vez** nesse componente (via prop opt-in)
cobre o CQ e deixa as outras grades-matriz prontas para ligar a navegação depois.

## Seção 1 — Lógica pura: pular células travadas

`proximaCelulaTeclado({tecla, comShift, linha, coluna, nLinhas, nColunas})` (hoje em
`src/lib/plan-tecido/calc.ts`) decide a próxima POSIÇÃO por aritmética (Enter ±linha, Tab ±coluna
com estouro). **Fica intocada** (os testes dela seguem 100%).

Nova função pura (ao lado dela, ou movida para `src/lib/grade-teclado.ts` junto do hook):
`proximaCelulaDisponivel({..., disponivel})` — chama `proximaCelulaTeclado` em loop na mesma
direção até achar a 1ª célula onde o predicado `disponivel(linha, coluna)` é true, ou `null` na
borda. Guard anti-loop: no máximo `nLinhas*nColunas` iterações. O predicado é injetado pelo hook
(no piloto, lê o DOM: o input existe e `!disabled`); nos testes é um fake, sem DOM. Assim o "pular
travada" é testável de forma pura.

**CQ Pós tem várias sub-grades** (uma `MatrizGradeResponsiva` por serviço×etapa): a navegação é
**dentro de uma matriz** (um escopo por matriz). Tab na borda de uma matriz segue o fluxo nativo
(sai para a próxima no DOM). Não há navegação por teclado ENTRE matrizes diferentes (escopo a mais;
o nativo cobre).

## Seção 2 — Interface do hook `useGradeTeclado`

`useGradeTeclado({ nLinhas, nColunas })` devolve:
- `gridRef` — ref para a raiz da grade (a `<table>` ou o container da matriz), onde o hook procura
  as células por `data-grade-cel`.
- `aoTeclar(linha, coluna)` — handler `onKeyDown` para a célula naquela posição. No Enter/Tab
  (sem Ctrl/Meta/Alt), calcula o destino com `proximaCelulaDisponivel`, acha o input por
  `data-grade-cel` dentro do `gridRef`, dá `preventDefault` e foca num `requestAnimationFrame`
  (convive com o rAF de cursor do `NumberInput.onFocus`). Sem destino (borda): no Enter dá
  `preventDefault` (não faz nada); no Tab deixa o fluxo nativo seguir.
- `propsDaCelula(linha, coluna)` — devolve `{ "data-grade-cel": \`${linha}:${coluna}\`, onKeyDown:
  aoTeclar(linha, coluna) }` para espalhar (`{...}`) no input da célula. Um só ponto, sem a tela
  montar o atributo à mão.

A lógica de teclas (Enter desce/Tab lado/Shift inverso, ignora modificadores) é a MESMA da
`DistribuicaoTabelas` de hoje, agora centralizada no hook.

## Seção 3 — Instrumentar o `MatrizGradeResponsiva` (cobre o CQ)

`MatrizGradeResponsiva` ganha uma prop **opt-in** `navTeclado?: { nLinhas, nColunas, propsDaCelula }`
(ou recebe o hook já instanciado). Quando presente, em cada célula ele espalha
`propsDaCelula(linhaDaVariante, colunaDoTamanho)` no wrapper do `renderCell` — ou passa (linha,
coluna) ao `renderCell` para o input recebê-las. A posição vem da ordem de `variantes` (linha) ×
`tamanhos` (coluna), que o componente já itera. Sem a prop, comportamento byte a byte de hoje
(as outras telas que usam o componente não mudam).

No **CQ** (`CqPosView` e a view do CQ Pré), instancia-se `useGradeTeclado` com o nº de variantes ×
nº de tamanhos e passa-se ao `MatrizGradeResponsiva`. O piloto cobre a grade de entrada (recebido/
defeito). A grade só-leitura (a "Grade real") não recebe navegação (não há o que digitar).

## Seção 4 — Anti-regressão da `DistribuicaoTabelas`

A `DistribuicaoTabelas` passa a usar o `useGradeTeclado` no lugar do seu `aoTeclar`/`proximaCelulaTeclado`
inline. Endereçamento: ela ganha `data-grade-cel="L:C"` nas células (além do `data-colab-path`, que
PERMANECE para a co-edição — são usos diferentes). Comportamento observável **idêntico** ao de hoje
(Enter desce, Tab estoura, Shift inverso, borda nativa) — provado por um teste que exercita a
navegação antes e depois da extração. Ganho de brinde: ela passa a **pular células travadas**
(hoje "morre" na travada), coerente com a decisão 1.

## Seção 5 — Testes e verificação

- **Unit (puro):** `proximaCelulaDisponivel` — Enter desce pulando travada; Tab estoura para a
  próxima linha pulando travadas; Shift+Tab inverso; borda devolve `null`; guard anti-loop quando
  TODAS as outras estão travadas (volta `null`, não trava o navegador). Predicado fake, sem DOM.
- **Unit (DOM, happy-dom):** `aoTeclar` acha a célula por `data-grade-cel` e foca; célula `disabled`
  é pulada; na borda não foca nada.
- **Anti-regressão:** a navegação da `DistribuicaoTabelas` dá os mesmos destinos depois da extração.
- **Gates:** `npm run build` + `npx tsc --noEmit | grep TS2304`.
- **QA no navegador (prévia localhost:5190):** no CQ, digitar e andar com Enter/Tab/Shift+Tab;
  conferir que pula tamanho fora da grade e campo travado; conferir que a `DistribuicaoTabelas`
  (Plan.Tecido) segue navegando igual.

## Arquivos (previstos)
- **Criar** `src/lib/grade-teclado.ts` — `proximaCelulaDisponivel` (puro) + `useGradeTeclado` (hook).
  (Ou manter `proximaCelulaTeclado` onde está e só acrescentar o resto; decisão de implementação.)
- **Modificar** `src/components/shared/MatrizGradeResponsiva.tsx` — prop opt-in de navegação.
- **Modificar** `src/components/producao/CqPosView.tsx` (+ a view do CQ Pré) — ligar o hook.
- **Modificar** `src/components/plan-tecido/DistribuicaoTabelas.tsx` — usar o hook (anti-regressão).
- **Testes:** `tests/unit/grade-teclado.test.ts` + DOM.

## Riscos
1. **Regredir a navegação da `DistribuicaoTabelas`** (está no ar). Mitigado: teste de anti-regressão
   dos destinos; `data-colab-path` preservado para a co-edição.
2. **Ordem (linha,coluna) divergir do visual** numa grade com layout responsivo (o
   `MatrizGradeResponsiva` tem 2 layouts: tabela e empilhado no mobile). Mitigado: a posição vem da
   ordem de `variantes`×`tamanhos` (a mesma nos 2 layouts); o QA mobile confirma.
3. **Loop infinito** se todas as células estiverem travadas. Mitigado: guard de `nLinhas*nColunas`
   iterações no `proximaCelulaDisponivel`.
4. **Conflito com o Enter que hoje faz `blur`** em alguns inputs (ex.: campos de preço). Mitigado: o
   hook só é ligado nas células de GRADE (via `MatrizGradeResponsiva`/`DistribuicaoTabelas`); os
   inputs avulsos com `onKeyDown` próprio não são tocados.
