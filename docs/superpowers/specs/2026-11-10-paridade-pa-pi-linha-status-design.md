# Paridade PA/PI ↔ Plan. Tecido: seletor de Linha + status Pendente/Reprovado

> Desenho para aprovação do dono ANTES de qualquer código. Frente achada no ar (10/nov, após o
> deploy da F4a): o card de Produto Acabado (PA) e Produto Importado (PI) não tem duas coisas que
> a vaga/card do Plan. Tecido já tem.

## Problema (relatado pelo dono, 10/nov)

Depois que a F4a subiu (status do kanban nos cards de PA/PI/PT), o dono notou em produção:

1. **Falta o seletor de Linha** (Day Chic, Casual…) no card de PA/PI. Hoje o card só mostra o
   *markup* da linha (`markupLinha`, `ProdutoCard.tsx:278`), não a linha em si, e não dá para
   escolher/trocar ali. O Plan. Tecido tem o seletor no card ("F2 E — Linha do card",
   `plan-tecido/ModelCard.tsx:510`).
2. **Falta o status Pendente/Reprovado** para o produto que ainda **não virou card**. A F4a mostra
   o selo do kanban só quando o produto tem card espelho (`{kanban && produto.modelo_id}`,
   `ProdutoCard.tsx:509`); sem card não há etapa de kanban, e também não há o seletor
   Pendente/Reprovado que a vaga do Plan. Tecido tem.

## Objetivo

Dar ao card de PA/PI a **paridade** com o card/vaga do Plan. Tecido, em dois pontos:

- **Seletor de Linha** no card (com card), **reflexivo**: grava `modelos.linha_id`, o mesmo campo
  que o Desenvolvimento/Planejamento/Plan. Tecido usam — muda num lugar, reflete em todos.
- **Seletor Pendente/Reprovado** no card (sem card), exclusivo com o selo do kanban.

## Decisões travadas (do dono, 10/nov)

1. **Linha é REFLEXIVA** = `modelos.linha_id`. PA/PI lêem de `modelo.linha_id`
   (`ProdutoAcabadoSheet.tsx:144/169`); o seletor grava no MESMO campo. O que muda num lugar
   reflete nos outros, **desde que o produto tenha card** (sem `modelo_id` não há modelo onde
   gravar). Produtos de revenda nascem com `linha_id: null` (mostram "—").
2. **Linha aparece SÓ com card** (`modelo_id`). Sem card, não há onde gravar a linha.
3. **Status Pendente/Reprovado aparece SÓ sem card.** Com card → mostra o selo do kanban (F4a, já
   existe). São **exclusivos**, igual à vaga do Plan. Tecido:
   `{kanban && produto.modelo_id ? <selo kanban> : <Select Pendente/Reprovado>}`.
4. **Reprovado BLOQUEIA criar card.** Produto reprovado (sem card) NÃO vira card de Planejamento —
   o "Criar card" recusa até o usuário voltar o produto a **Pendente**. Não há migração de status
   reprovado→kanban; o reprovado é um portão. Só Pendente materializa o card.
5. **Gravar a Linha pela RPC de salvar do produto** (estender `salvar_produto_acabado`/
   `salvar_produto_importado`), seguindo o padrão do espelho (`fn_modelo_espelho_categoria`) —
   não update cru do front (segurança/RLS/consistência).

## Contexto do código (mapeado, read-only)

- **Referência (Plan. Tecido):** o `ModelCard` tem o seletor de Linha (`plan-tecido/ModelCard.tsx`
  ~510, "F2 E") e o seletor Pendente/Reprovado via `onStatus`/`statusEfetivoDaVaga`
  (`plan-tecido/calc.ts:103`). A vaga guarda o status em `plan_tecido_slots.status`
  (`'pendente'|'reprovado'|null`).
- **PA (card):** `ProdutoCard.tsx`. O selo do kanban renderiza em `:509` sob
  `{kanban && produto.modelo_id}`. A linha é usada só pro markup (`:278`, `modeloLinhaId`).
- **PA (Sheet):** `ProdutoAcabadoSheet.tsx`. Salva o produto via `salvarUmProduto`/`patchProduto`
  (`:778`/`:644`, RPC `salvar_produto_acabado`). Cria card via `criar_cards_produto_acabado`
  (`:691`, `_produto_ids`), só para produtos **sem card** (`:669`). Filtro de status já existe
  (`filtroStatus` sem_reprovado/todos, F4a T3, `:204-206`).
- **PI:** espelha PA (`ProdutoImportadoSheet.tsx`/`ProdutoImportadoCard.tsx`, `salvar_produto_importado`,
  `criar_cards_produto_importado`).
- **Tabelas:** `produtos_acabados` e `produtos_importados` **NÃO têm** coluna de status própria
  (confirmado na cópia). O espelho card↔produto existe para nome/REF/categoria
  (`fn_modelo_espelho_categoria`, `fn_modelo_espelho_nome_ref`).

## Arquitetura

### Parte 1 — Seletor de Linha no card (com card)

- **Front:** no card de PA/PI, quando `produto.modelo_id` existe, mostrar um **seletor de Linha**
  (as linhas do cadastro, `Cadastro > Linhas`), valor atual = `modelo.linha_id`. Espelhar o padrão
  do `ModelCard` do Plan. Tecido (o mesmo componente de Select de linha, se reutilizável, ou um
  equivalente). Trocar a linha entra no draft do produto (como os outros campos) e grava no Salvar.
- **Banco:** a RPC de salvar do produto (`_salvar_produto_acabado_core`/`_salvar_produto_importado_core`)
  passa a aceitar `linha_id` em `_dados` e gravá-lo em `modelos.linha_id` do espelho — SÓ quando a
  chave vem (ausente = mantém; padrão `tamanho_tipo`/categoria, que já têm esse comportamento).
  Reflexivo: como é o mesmo `modelos.linha_id`, a mudança aparece no Dev/Planejamento/Plan. Tecido.
- **Markup:** o markup da linha (já exibido) passa a refletir a linha escolhida na hora.

### Parte 2 — Status Pendente/Reprovado no card (sem card)

- **Banco (1 migration aditiva):** coluna `status text` em `produtos_acabados` e
  `produtos_importados` (CHECK `in ('pendente','reprovado')` ou NULL; default NULL = pendente
  implícito), análoga a `plan_tecido_slots.status`. Gravada pela RPC de salvar do produto (aceita
  `status` em `_dados`). Reprovado/Pendente é um dado do PRODUTO, não do modelo (o produto sem card
  nem tem modelo).
- **Front (card):** quando `!produto.modelo_id`, mostrar o Select Pendente/Reprovado (espelhar o
  `onStatus`/Select do `ModelCard` do Plan. Tecido). Exclusivo com o selo do kanban (que só aparece
  com card).
- **Filtro:** o filtro de status que já existe (`filtroStatus`) passa a considerar também o
  `status` do produto sem card (reprovado oculto por default, "Todos" revela) — hoje ele olha o
  status do modelo; estender para o status do produto quando não há modelo.

### Parte 3 — Reprovado bloqueia criar card

- **Banco:** `_criar_card_produto_acabado_core`/`_lote_core` (e o importado) RECUSAM materializar um
  produto cujo `status = 'reprovado'` — `RAISE P0001` ASCII (ex.: `produto_reprovado_sem_card:`),
  traduzido no front. Portão no servidor (não só UI).
- **Front:** o "Criar card" (individual e em lote) pula/avisa produtos reprovados — o botão fica
  desabilitado ou o produto é excluído da seleção elegível, com aviso ("produto reprovado — volte a
  Pendente para criar o card"). Espelha a lista de "pulados" que o `criarCards` já tem.

## O que NÃO entra

- Não mexer na F4a (o selo do kanban com card segue como está).
- Não migrar status reprovado→kanban (decisão 4: reprovado é portão, não vira etapa).
- Não tocar o Plan. Tecido (é a referência, não muda).
- Não adicionar status ao produto COM card (com card o status é o do kanban).

## Riscos / cuidados

- **Exclusividade status × selo:** garantir que, com card, aparece SÓ o selo do kanban; sem card,
  SÓ o Select Pendente/Reprovado. Nunca os dois juntos (igual à vaga do Plan. Tecido).
- **Reflexividade da Linha:** como é `modelos.linha_id` compartilhado, mudar a linha em PA reflete
  no Dev/Planejamento — isso é o desejado, mas a prova tem de confirmar que não há efeito colateral
  (ex.: markup, agrupamento por linha em outra tela).
- **Reprovado + card já existente:** a regra do gate vale só para produto SEM card. Produto que JÁ
  tem card usa o kanban (reprovar lá é pelo kanban, não por esta coluna). A coluna `status` do
  produto só vale enquanto `modelo_id` é null.
- **RLS/segurança:** a Linha e o status gravam pela RPC DEFINER (não update cru) — seguir o padrão
  de permissão das RPCs de salvar do produto (as páginas de PA/PI).
- **RAISE 5xx só ASCII** (regra do projeto) no gate do reprovado.
- **Migration aditiva** (coluna nova, sem trava pesada): banco antes do site.

## Verificação

- **Unit (TS):** o card mostra o seletor de Linha SÓ com card e o Select Pendente/Reprovado SÓ sem
  card (exclusividade); o filtro oculta produto reprovado sem card.
- **Integração (cópia local, txn revertida):**
  - a RPC de salvar grava `linha_id` no modelo espelho (e reflete ao reler); ausente = mantém.
  - a RPC de salvar grava `status` no produto sem card.
  - `criar_cards_produto_acabado`/`importado` RECUSA produto reprovado (P0001 ASCII) e materializa
    o pendente.
  - reflexividade: mudar a linha em PA aparece no `modelos.linha_id` (Dev/Planejamento lêem o mesmo).
- **QA na prévia (localhost:5190):** seletor de Linha no card de PA/PI (com card) muda e reflete;
  Pendente/Reprovado no card sem card; reprovado some com o filtro default e bloqueia criar card;
  voltar a Pendente libera.
- `npm run build` + `tsc --noEmit`; code-reviewer; guardião (migration + gate de criação). Banco
  antes do site.
