# Aprovação de mão de obra no Planejamento + custo real no card

**Data:** 2026-07-22
**Tipo:** feature (UI + dado + RPC + motor de regras). Migration inclusa.

## Motivação / mudança conceitual

Hoje a aprovação do custo de serviços é **por bloco** (`producao_terceirizados.aprovado`),
feita por checkbox na tela de Serviços; quando todos os blocos externos estão aprovados o
modelo fica "serviços aprovado" (bolinha verde no card) e isso libera o Lançar.

**Novo:** uma única aprovação **por modelo** da **mão de obra** (os Serviços previstos,
`custo_terceirizados_previsto`), feita nos ícones do card do Planejamento de Produto. A
bolinha do card passa a refletir essa aprovação; o checkbox do Serviços é removido. O card
separa **materiais** de **mão de obra** e troca previsto→real quando o produto fica pronto/
lançado.

## 1. Dado (migration)

`ALTER TABLE modelos ADD COLUMN custo_terceirizados_aprovado boolean NOT NULL DEFAULT false`
— 2 estados: `true` = aprovado, `false` = reprovado (default reprovado). Todo modelo começa
reprovado até aprovarem.

`producao_terceirizados.aprovado` fica **órfã** (deixa de ser setada/lida). Não dropar agora
(evitar migration destrutiva no mesmo passo); marcar p/ drop futuro.

## 2. RPC de custo (ampliar)

`custo_unitario_modelos` passa a devolver, por modelo, também o **componente de mão de obra**:
- `mao_obra_previsto` = `custo_terceirizados_previsto` (forecast do Desenvolvimento).
- `mao_obra_real` = Serviços real por peça (`servico_total / grade`, os `producao_terceirizados`
  externos já computados no ramo `real`).

Assim o front deriva **materiais = total − mão de obra** e mostra os dois separados, em
previsto e real. `previsto`/`real` totais seguem como estão (Markup/Preço não mudam — usam o
total). Wrapper/`_core` e REVOKE seguem o padrão do invariante #9.

## 3. Card do Planejamento de Produto (descrição)

Layout em linhas agrupadas (grade responsiva, mesma abordagem do Desenvolvimento):
- Nome
- Estilista
- **Coleção | Subcoleção**
- **Linha | Categoria | Markup**
- **Custo** (materiais): previsto; vira **real** quando `lancStatus ≠ null` (pronto/lançado)
- **Custo mão de obra** (previsto→real) **· ✓ Aprovar · ✗ Reprovar**
- **Preço**
- **Lançamento: {data_lancamento} 🚀** — reflexo do lançamento à produção

Detalhes:
- **Bolinha (canto sup. direito)** passa a refletir `custo_terceirizados_aprovado`:
  **verde = aprovado / vermelha = reprovado** (era a de serviços/`aprovacao`).
- Ícones **✓/✗** ao lado da mão de obra gravam `custo_terceirizados_aprovado` (mutation +
  invalida `["modelos-planejamento"]` e os mapas de custo/aprovação). Permissão = edição do
  Planejamento.
- **🚀 foguete** substitui o badge de texto "Pronto/Lançado" (o badge sai): foguete **âmbar** =
  pronto (CQ liberado + mão de obra aprovada, não lançado), **verde** = lançado, oculto se
  nenhum. Sem data no ícone (a data fica na linha "Lançamento"). NÃO clicável (lançar segue no
  detalhe).
- **Custo/mão de obra real** aparece quando pronto/lançado (integridade: mostra o real quando
  já existe). Markup/Preço seguem no custo **total** (materiais + mão de obra) — sem mexer em
  `preco.ts` nem no poder de venda.
- Query dos cards ganha `custo_peca_previsto`, `custo_terceirizados_previsto`,
  `custo_terceirizados_aprovado`, `data_lancamento` (o que faltar).

## 4. Serviços

Remove o **checkbox de aprovação de custo** por bloco (para de setar
`producao_terceirizados.aprovado`). A bolinha da lista de Serviços passa a refletir o **novo
flag do modelo** (`custo_terceirizados_aprovado`: verde = aprovado / vermelha = reprovado),
mantendo o mesmo indicador visual com a nova fonte.

## 5. Gate do Lançar

Lançar exige **CQ confirmado (`cqLiberado`) E mão de obra aprovada
(`custo_terceirizados_aprovado`)**. Troca o `servicoOk` (todos os blocos aprovados) pelo flag
novo, no **client** (`lancStatusDe` + habilitação do botão) **E no gate do servidor** (a RPC
de lançar que hoje valida "valor de serviço aprovado"). `servico_aprovacao_por_modelo` deixa
de alimentar o gate (pode virar código morto).

## 6. Motor de regras do kanban (bloqueio opcional)

Condição nova no catálogo `src/lib/kanban-condicoes.ts`:
`{ key: "mao_obra_aprovada", label: "Mão de obra aprovada", modulo: "desenvolvimento" }`.
Branch na RPC `avaliar_condicoes_kanban` checando `custo_terceirizados_aprovado = true`. O teste
anti-drift (Vitest) exige catálogo ↔ RPC batendo. A loja pode exigir a condição em qualquer
status do Desenvolvimento (ex.: "Aprovado") em Config da Loja > Kanban; enforcement (Select +
arraste) já existe.

## 7. Desenvolvimento

Badge read-only **"Mão de obra aprovada / reprovada"** ao lado do campo de Serviços previstos
(`custo_terceirizados`) no bloco de custos. Só reflexo — aprovar/reprovar é no Planejamento.

## Fora de escopo

- Não muda Markup/Preço/poder de venda (seguem no custo total).
- Não dropa `producao_terceirizados.aprovado` nem `servico_aprovacao_por_modelo` agora.
- Aprovar/reprovar só no Planejamento (Desenvolvimento e Serviços são reflexo/read-only).

## Verificação

- Migration via `psql`; **teste transacional** da RPC de custo (componente mão de obra),
  do gate de lançar (CQ + aprovação) e da condição kanban.
- `npm run build` + `npx tsc --noEmit` + `npm test` (anti-drift kanban + integração).
- Atualizar CLAUDE.md (bloco kanban + invariante do gate de lançar: "CQ liberado E mão de obra
  aprovada") e a memória do projeto (docs-keeper).
