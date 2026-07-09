# OTB — Fluxo "Poder de Venda" + Padrão do mix

Data: 2026-07-08 · Status: design aprovado (aguardando revisão do spec antes do plano)

## Objetivo

Hoje o OTB tem um único fluxo: montar a coleção **a partir de um orçamento** (custo em
R$) — subcoleção → semana → categoria → quantidade. O dono quer um **segundo fluxo,
top-down por Poder de Venda**: parte de uma meta de faturamento-potencial e das faixas
de preço por categoria, e ao confirmar **gera os cards do Planejamento já preenchidos**
(linha, categoria, subcategoria, subcoleção, semana, faixa de preço).

O poder de venda de uma coleção = Σ (preço de venda × grade) dos modelos — é o potencial
a preço cheio. Já existe hoje calculado no card do OTB e no Planejamento
(`computeColecaoResumo.poder`, via `src/lib/preco.ts`).

## Dois fluxos, escolhidos na criação

Ao clicar **"+ Nova Coleção"**, o primeiro passo é escolher o **tipo**:

- **Por Orçamento** — o fluxo atual, intocado.
- **Por Poder de Venda** — o novo. Sequência (confirmada com o dono):
  1. escolher qual **Padrão do mix** herdar;
  2. definir o **poder de venda meta** (R$) e a **perda de markup** (%);
  3. **nome**, **mês** (dos atributos — os 12 fixos, ver [[project_meses_fixos]]), **ano**;
  4. criar as **subcoleções** (com nomes);
  5. em cada subcoleção já vêm **Linha ▸ Categoria+Sub herdadas do padrão**;
  6. lançar a **quantidade por Linha × Categoria+Sub × Semana (1–5)**.

## Padrão do mix (template de defaults) — JÁ prototipado em `/otb-beta`

Template, **vários por loja** (Verão, Inverno…), que a coleção Poder de Venda herda.
NÃO tem coleção/mês/subcoleção/quantidade — só defaults:

- **por Linha** (linha vem do cadastro `linhas`; markup automático dela): `%` do mix,
  `profundidade/cor`, `cores`;
- **por Categoria+Subcategoria** (do cadastro `categorias_produto` +
  `subcategorias1_produto`): `preço mín`, `preço máx` (→ custo mín/máx = preço ÷ markup).

### Schema proposto (Padrão do mix)

```
mix_padroes            (id, tenant_id, nome, created_at)
mix_padrao_linhas      (id, padrao_id→mix_padroes, linha_id→linhas, pct numeric,
                        prof_cor int, cores int, ordem int)
mix_padrao_categorias  (id, padrao_linha_id→mix_padrao_linhas, categoria_id→categorias_produto,
                        subcategoria1_id→subcategorias1_produto NULL, preco_min numeric,
                        preco_max numeric, ordem int)
```

RLS por tenant (padrão do projeto). CRUD via tela "Padrão do mix" (botão no OTB).
Markup NÃO é copiado — sempre lido da `linhas` em tempo real (fonte única).

## Coleção por Poder de Venda

### Extensão de `colecoes`

```
colecoes.tipo             text default 'orcamento'  -- 'orcamento' | 'poder_venda'
colecoes.poder_venda_meta numeric                    -- meta em R$ (só poder_venda)
colecoes.perda_markup     numeric                    -- % desconto esperado (default 25)
colecoes.mix_padrao_id    uuid → mix_padroes         -- padrão herdado (snapshot na criação)
```

`mes_id`, `ano_id`, `nome` já existem. Subcoleções reusam `colecao_subcolecoes`.

### Itens (quantidade por Linha × Categoria+Sub × Semana)

A quantidade é lançada por **(subcoleção, linha, categoria+sub, semana)**. Nova tabela:

```
colecao_pv_itens (
  id, colecao_id→colecoes, subcolecao_id→colecao_subcolecoes,
  linha_id→linhas, categoria_id→categorias_produto, subcategoria1_id NULL,
  preco_min numeric, preco_max numeric,   -- herdados do padrão, ajustáveis
  semana int (1..5), qtd int
)
```

O **total** de uma (linha, categoria+sub) = Σ das semanas = nº de cards que nascem.
Poder de venda planejado (para comparar com a meta) = Σ qtd × prof_cor × cores × valor
médio, onde valor médio = (preço mín + preço máx)/2. Resumo mostra: poder planejado,
`% da meta`, desconto (poder × perda), PV final, custo (poder ÷ markup).

### Confirmar → gera cards no Planejamento

Estende `otb_confirmar` (ou uma RPC irmã `otb_confirmar_pv`): para cada `colecao_pv_itens`,
cria `qtd` linhas em `modelos`, cada card com:

- `colecao_id`, `subcolecao` (nome), `semana`, `linha_id`,
- `categoria_principal_id`, `subcategoria1_id`,
- `preco_venda = NULL` (**nasce em branco** — definido depois no Planejamento),
- faixa `preco_min`/`preco_max` como **referência** (decisão: coluna de referência em
  `modelos`, ex. `preco_ref_min`/`preco_ref_max`, OU só exibida a partir do vínculo OTB —
  a resolver no plano),
- `status_planejamento = 'em_planejamento'`.

Reconciliação/limpeza de órfãos segue o padrão do `otb_confirmar` atual (ver CLAUDE.md,
bloco OTB) — mudar a qtd no OTB acerta os cards; apagar card decrementa a qtd (gatilhos
`fn_otb_sync_semana`/`trg_otb_dec_semana` — avaliar reuso vs. par novo para o tipo PV).

## Decisões travadas (com o dono)

- Âncora do fluxo PV = **Poder de Venda** (o "~1/3" do que o comercial pede vira a % de
  **perda de markup**, editável).
- Modelos e peças = inteiros; preços = decimais; arredondamento de modelos **pra cima**.
- Valor médio do combo = **meio da faixa** (mín+máx)/2.
- Quantidade = por **linha × categoria+sub × semana** (1 mês + semanas 1–5).
- Preço do card gerado = **em branco** (OTB guarda a faixa mín–máx como referência).
- Vários **Padrões do mix** por loja; escolhe qual herdar logo após optar por "Poder de Venda".
- Markup sempre do cadastro `linhas` (nunca copiado).

## Fora de escopo desta entrega

- Distribuição automática de preços para "bater a meta" (rejeitado: preferido card em branco).
- Multi-mês por coleção (rejeitado: coleção = 1 mês).
- Alterar o fluxo por Orçamento.

## Impacto / arquivos

- Banco: migration com `mix_padroes`/`mix_padrao_linhas`/`mix_padrao_categorias`,
  colunas em `colecoes`, `colecao_pv_itens`, RLS, e extensão do confirmar.
- Front: tela "Padrão do mix" (persistir o protótipo `/otb-beta`), seletor de tipo no
  "+ Nova Coleção", painel da coleção PV (árvore Subcoleção ▸ Linha ▸ Categoria+Sub +
  semanas), e o card do OTB já mostra poder de venda (feito).
- Reaproveitar: `useOpts`/dropdowns de mês (ordenados por `ordem`), `src/lib/preco.ts`,
  `computeColecaoResumo`, `ColecaoSheet`.
```
