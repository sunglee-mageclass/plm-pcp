# F4a — Status do kanban unificado em PA/PI/PT + filtro de reprovados

> Desenho para aprovação do dono ANTES de qualquer código. Frente da campanha "Produto
> Acabado/Importado + status de aprovação" (F4 do painel), parte **a** (status + filtro).
> As partes 3-4 (markup médio no resumo, editar preço antes do card, relatório de reprovados)
> ficam para a **F4b**, depois.

## Objetivo

Hoje o status de aprovação de um produto vive em lugares diferentes e incompletos:
- **Produto Acabado (PA)** e **Produto Importado (PI)** NÃO mostram status de aprovação nenhum.
- **Plan. Tecido (PT)** mostra DOIS status desacoplados: um "selo de fase" vindo da RPC
  `plan_tecido_fases` e um status binário da vaga (pendente/reprovado, da F2).
- Nenhum deles é o selo do kanban que o Planejamento/Desenvolvimento já usa (`EtapaKanbanBadge`).

A F4a unifica: **o status mostrado em PA, PI e PT é o status do kanban do card espelho** —
um leitor único (`etapaDoModelo` → `EtapaKanbanBadge`), bidirecional (mudar numa tela move o
card no kanban, respeitando os requisitos), com um **filtro que oculta/mostra os reprovados**.

Decisão do dono (09/nov): "PA, PI, PT deveriam ser reflexo do status do kanban; o que muda cá
muda lá (respeitando os requisitos). Só os reprovados terão filtro próprio, para não serem
mostrados; todo o resto aparece. Como pode ser preciso revisar, não dá para só tirar — por isso
o filtro." + "seletor de status no card nas 3 telas" + "as 3 juntas (PA/PI/PT)".

## Contexto do código (mapeado, read-only)

- **Selo (reusável, pronto):** `EtapaKanbanBadge` (`src/components/shared/EtapaKanbanBadge.tsx:11`),
  derivado por `etapaDoModelo(m: ModeloKanban, cfg)` (`src/lib/kanban-auto-ui.ts:209`). Input:
  `{origem, status_desenvolvimento, ordem_criacao_enviada, lancado}`.
- **"Mover para…" (reusável, acoplado ao Sheet):** `EtapaHeader`
  (`src/components/planejamento/planejamento-detail/ficha/EtapaHeader.tsx:14`), alimentado por
  `useFichaKanban` + `opcoesMoverHoje`/`opcoesMoverAuto` + `useMoverEtapa` (todos em
  `planejamento-detail/ficha/`). Os puros (`etapa-kanban.ts`, `etapa-mover.ts`, `kanban-auto-ui.ts`)
  não têm React — reaproveitáveis.
- **Requisitos comprado × interno:** switch único por `ehOrigemComprada(origem)` em
  `reqsDoModelo`/`fluxoDoModelo` (`src/lib/kanban-auto.ts:96/105`) e `podeEntrarHoje`
  (`etapa-kanban.ts:103`). Comprado (revenda/importado) usa `revenda_kanban_colunas`/
  `revenda_kanban_requisitos`; interno usa `kanban_requisitos`(+exceções). Condições por modelo =
  RPC `avaliar_condicoes_kanban(_ids)`.
- **PA query:** `SELECT_PRODUTO` em `ProdutoAcabadoSheet.tsx:147-155`, embed
  `modelo:modelo_id(preco_venda, preco_atacado, linha_id, fotos_modelo, …)`. FALTAM
  `status_desenvolvimento, ordem_criacao_enviada, origem, lancado`. Card: `ProdutoCard.tsx`,
  cabeçalho em `:371-399` (ao lado do `SeloIntegracao`).
- **PI query:** `SELECT_PRODUTO` em `ProdutoImportadoSheet.tsx:68` (embed mais magro). Mesmos campos
  faltando. Card: `ProdutoImportadoCard.tsx`, cabeçalho `:337-345`.
- **PT:** query `modelosDb` (`PlanTecidoSheet.tsx:489`) JÁ traz `origem, status_desenvolvimento,
  status_planejamento, lancado, enviado_cad`. Selo de fase atual = `faseInfo` (RPC
  `plan_tecido_fases`, `:842`); status binário da vaga = `statusEfetivoDaVaga` (`calc.ts:103`).
  Filtro de reprovados JÁ existe (`filtro-painel.ts:37` + `FilterButton` + `filtroStatus`
  "sem_reprovado" em `:329`, poda `slotPassaFiltroStatus` em `calc.ts:111`).
- **Filtro (reusável):** `FilterButton` (`src/components/shared/filters.tsx:129`), descritor single
  (sem_reprovado/todos) trivial de reusar. PA/PI NÃO têm FilterButton hoje.

## Decisões travadas (do dono)

1. **Fonte única do status = o kanban do card espelho**, derivado por `etapaDoModelo`
   (`EtapaKanbanBadge`), igual ao Planejamento. Vale para PA, PI e PT (card). [as 3 juntas]
2. **Seletor de status no card** nas 3 telas — move o card no kanban (`kanban_mover` com a chave
   ligada; UPDATE de `status_desenvolvimento` + `marcar_etapa_verificada('kanban')` com a chave
   desligada), **respeitando os requisitos** (destinos sem requisito ficam esmaecidos com
   "falta X", não movem). Reusa o fio do `EtapaHeader`/`useMoverEtapa`.
3. **Requisitos por origem:** PA/PI (origem revenda/importado) seguem o fluxo PRÓPRIO de comprado
   (`revenda_kanban_colunas`/`revenda_kanban_requisitos`); PT interno segue o board/requisitos
   internos. É o switch `ehOrigemComprada` que já existe — nada novo.
4. **Filtro só de REPROVADOS:** um filtro "Status" single (default **oculta reprovados**;
   opção "Todos" revela), para poder revisar. Não é filtro por etapa. Só poda a EXIBIÇÃO, nunca
   apaga. PT já tem (fica igual); PA/PI ganham.
5. **Bidirecional respeitando requisitos:** mudar o status numa tela reflete nas outras (é o mesmo
   card); mas sempre pelas regras do kanban (não pula etapa sem requisito).

## Arquitetura

### Parte 1 — Leitor único do status (sem banco novo)

O "leitor único" já existe: `etapaDoModelo` + `EtapaKanbanBadge`. A F4a NÃO cria enum nem coluna
nova. O que muda é **cada tela passar a usar esse leitor** em vez do seu status próprio.

- **PA/PI:** ampliar o embed `modelo:modelo_id(…)` para trazer `status_desenvolvimento,
  ordem_criacao_enviada, origem, lancado` + carregar `tenant_config` (cfg do kanban) + as condições
  (`avaliar_condicoes_kanban`) dos modelos listados. Montar `ModeloKanban` por card e renderizar
  `EtapaKanbanBadge` no cabeçalho (ao lado do `SeloIntegracao`).
- **PT (card COM modelo):** trocar `faseInfo` (RPC `plan_tecido_fases`) e o status binário
  `statusEfetivoDaVaga` por `etapaDoModelo`. **Vaga SEM card:** mantém o status próprio
  pendente/reprovado da F2 (não há kanban antes do card) — mesma lógica de `statusEfetivoDaVaga`
  (com card deriva; sem card usa o próprio), só que "deriva" vira o status COMPLETO.

### Parte 2 — Seletor de status no card (mover, com requisitos)

Extrair o fio de "Mover para…" do Sheet para um componente reusável que caiba num card:
- Novo `src/components/shared/MoverEtapaMenu.tsx` (ou reusar `EtapaHeader` recebendo props) — um
  Popover gatilhado pelo `EtapaKanbanBadge`, lista as opções de mover (esmaecidas se falta
  requisito, com "falta X"), chama `onMover`.
- O hook `useFichaKanban`/`useMoverEtapa` (já existentes) alimentam: montam as opções via
  `opcoesMoverHoje`/`opcoesMoverAuto` (respeitando origem: PA/PI usam o fluxo de revenda), e o
  `useMoverEtapa` faz a mutação (`kanban_mover` ligada / UPDATE desligada). PA/PI/PT passam a usar
  o mesmo fio. Nenhuma RPC nova — reusa `kanban_mover`/`avaliar_condicoes_kanban`.
- Depois de mover, invalidar as queries das telas afetadas (o card espelho mudou; reflete em todas).

### Parte 3 — Filtro de reprovados em PA/PI

- `ProdutoAcabadoSheet`/`ProdutoImportadoSheet` ganham um estado `filtroStatus:
  "todos"|"sem_reprovado"` (default "sem_reprovado") + um `FilterButton` com o descritor single
  (reusar o padrão de `filtro-painel.ts` do PT). Poda o array de produtos antes do map que
  renderiza os cards (`ProdutoAcabadoSheet.tsx:1047`), usando `ehReprovadoStatus` sobre o status do
  embed. Só esconde; nunca apaga. PT já tem — fica como está.

## O que NÃO entra (F4b, depois)

- Markup médio no resumo de PA/PI.
- Editar preço antes de criar o card.
- Visão/relatório de reprovados.

## Riscos / cuidados

- **PT mexe em algo recém-no-ar (F2):** trocar o status binário da vaga pela derivação do kanban.
  A vaga SEM card mantém o comportamento F2 (pendente/reprovado próprio); só a vaga COM card muda.
  Revisão cuidadosa + prova de que o filtro de reprovados do PT continua funcionando.
- **Mover respeitando requisitos:** o seletor NÃO pode deixar pular etapa — reusa a mesma lógica
  (`podeEntrarHoje`/`opcoesMover*`) do Sheet, que já trata comprado vs interno. Não reimplementar.
- **Performance:** PA/PI passam a carregar condições (`avaliar_condicoes_kanban`) dos modelos
  listados — uma chamada em lote pelos `modelo_id` da coleção, não N chamadas.
- **Sem banco novo:** a F4a é só front (amplia embeds, reusa RPCs existentes). Se algum embed
  precisar de coluna que o cliente não lê hoje, confirmar RLS (mas `modelos` já é lido).

## Verificação

- Unit: montagem de `ModeloKanban` a partir do embed de PA/PI; poda do filtro de reprovados;
  `statusEfetivoDaVaga` do PT com status completo (com card deriva, sem card próprio).
- Integração (cópia local): `kanban_mover` respeita requisitos para origem revenda/importado
  (não move sem requisito); `avaliar_condicoes_kanban` em lote.
- QA na prévia: selo aparece em PA/PI/PT; mover de uma tela reflete nas outras; filtro oculta/mostra
  reprovados; mover para etapa sem requisito fica bloqueado com "falta X".
- `npm run build` + `tsc --noEmit`; revisão code-reviewer; prévia na tela do dono antes do deploy.
