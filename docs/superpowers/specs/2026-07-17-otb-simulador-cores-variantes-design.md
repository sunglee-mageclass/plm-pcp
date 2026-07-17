# Simulador de Uso de OC — Cores reais (variantes por subcoleção) — Design

**Data:** 2026-07-17
**Módulo:** `otb` (opt-in)
**Evolui:** `docs/superpowers/specs/2026-07-16-otb-simulador-uso-oc-design.md` (Simulador v1, já no ar)
**Status:** aprovado no brainstorm; pronto para plano

---

## 1. Problema

O Simulador v1 trata "cor" como um **número** (`cores`) e prende **uma única variante de tecido por unidade**. Feedback do dono ao usar:

1. Ao escolher o item da OC, **não dá pra saber qual variante é** (mostra só o nome do artigo, sem cor/apelido).
2. **Não dá pra escolher mais de uma variante**, sendo que `cores=3` implica 3 cores.
3. Falta **mini card por modelo** (nome + as cores identificadas pelas variantes + qtd por cor).
4. (corrigido à parte) consumo aceitava só inteiro.
5. (corrigido à parte) "Aplicar no card" → renomeado "Aplicar no plano" + texto explicando.

Este design cobre **1–3**: tornar as **cores reais** — cada cor é uma **variante de verdade** da OC, com metragem e resultado **por cor**.

## 2. Decisões travadas (do brainstorm)

| Tema | Decisão |
|---|---|
| **Nível das cores** | A OC é atribuída à **subcoleção (unidade)**; escolhe-se ali um conjunto de **variantes = as cores**. Valem para **todos os modelos de todas as linhas** da subcoleção. `cores` **deixa de ser por linha** e passa a ser **o nº de variantes escolhidas** (uniforme na subcoleção). |
| **Identificação** | Cada variante aparece com o rótulo único do sistema — `artigo · cor · apelido` (`labelVarianteRow`/`varianteLabel` de `src/lib/variante.ts`). |
| **Sobra/estoura** | **Por cor/variante**: cada cor tem a metragem da SUA variante na OC vs a demanda; saldo mostrado **cor a cor**. |
| **Consumo** | **Por modelo**, o mesmo para todas as cores (é a mesma peça, muda só a cor do tecido). |
| **Profundidade** | Continua **por linha** (grade). |
| **Seleção de variantes** | **Livre** (quantas quiser), com o nº de cores previsto no plano mostrado ao lado como **referência** (não trava). |
| **Write-back de cores** | "Aplicar no plano" grava `cores = nº de variantes escolhidas` em **todas as linhas** da subcoleção (uniforme). `prof_cor` e nº de modelos seguem por linha. |
| **Todo modelo em toda cor** | Simplificação v1: cada modelo é produzido em **todas** as cores da subcoleção (peças por cor = profundidade). Subconjunto de cores por modelo = YAGNI. |

## 3. Modelo de dados

Alterações (migration aditiva + 1 coluna dropada — envolver em `BEGIN; … COMMIT;`, idempotente):

```
otb_simulacao_unidades   + oc_tecido_id uuid references ocs_tecido(id) on delete set null
                         - oc_tecido_item_id            (SUPERSEDIDA pelas variantes; DROP)
otb_simulacao_variantes  (NOVA) id, tenant_id, unidade_id (FK otb_simulacao_unidades on delete cascade),
                         oc_tecido_item_id (FK ocs_tecido_itens on delete set null), ordem int
```

- Tabela nova = multi-tenant: `tenant_id` por trigger `set_tenant_id`, RLS igual às outras do simulador (policies `tenant_*` por `get_user_tenant_id()`).
- **`otb_simulacao_linhas.cores`**: continua existindo, mas vira **derivado** = nº de variantes da unidade (o front grava esse valor; a fonte da verdade é `otb_simulacao_variantes`). Não é mais input por linha.
- **Uma OC por subcoleção**: `oc_tecido_id` na unidade; as variantes são itens **daquela** OC.

Migration aplicada por `psql "$(cat /tmp/dburl.txt)" -f`; a v1 é recém-subida (sem dado real relevante), então dropar `oc_tecido_item_id` é seguro — mas escreva idempotente (`IF EXISTS`) e ajuste as RPCs que a citam. Regenerar `types.ts` fica pendente (mesma limitação do v1: precisa `supabase login`) — o front usa `as any`.

## 4. Cálculo (por cor)

Para a unidade, seja **V** = variantes escolhidas (as cores). Consumo é por modelo e igual entre cores, então:

- **Demanda por cor (m)** = `Σ_linhas Σ_modelos (prof_cor_linha × consumo_modelo)` — **idêntica para toda cor** (não depende da variante).
- **Disponível da cor v (m)** = metragem daquele item de OC: espelha `consumo_por_oc` — `unidade_medida='kg' ? quantidade_pedida × artigo.rendimento : quantidade_pedida`.
- **Saldo da cor v** = `disponível(v) − demanda`. `≥0` verde "sobram X m"; `<0` vermelho "faltam X m".
- Total (informativo): demanda total = `|V| × demanda por cor`.

O painel de resultado da unidade lista **uma linha por cor** (variante · disponível · demanda · saldo + barra), já que só a metragem muda por cor. Ex.: Azul +120 m (verde), Vermelho −40 m (estoura).

## 5. UI (`SimulacaoSheet.tsx`)

**Por unidade (subcoleção):**
- Seletor **OC** (`oc_tecido_id`).
- **Multi-seleção de variantes** dessa OC = as cores. Cada opção mostra `labelVarianteRow` (artigo · cor · apelido) + metragem disponível. Ao lado: "plano: N cores" como referência (o maior `cores` entre as linhas da subcoleção), sem travar. Chips das variantes escolhidas (remover/adicionar).
- Painel de **resultado por cor** (§4).

**Por linha:** só **prof/cor** (input) + nome da linha. O input de `cores` **sai** (agora é o nº de variantes da unidade, mostrado como leitura).

**Por modelo → mini card** (resolve #3): foto/ref/nome + a lista de **cores** (labels das variantes) e, por cor, **peças = profundidade** (e metros = prof × consumo). O **consumo (m/peça)** é um input por modelo (decimal, já corrigido) que vale para todas as cores.

Embeds (PostgREST): a OC traz os itens com artigo **e** variante:
`itens:ocs_tecido_itens(id, quantidade_pedida, quantidade_recebida, artigo:artigos(nome, unidade_medida, rendimento), variante:variante_tecido_id(nome_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)))`.
O cenário salvo lê `unidades(..., oc_tecido_id, variantes:otb_simulacao_variantes(oc_tecido_item_id, ordem), linhas(...))`.

## 6. Write-back ("Aplicar no plano")

- **PV**: além de `prof_cor` (por linha) e nº de modelos (→ `qtd_semanas` splitEven, como no v1), grava **`cores` = nº de variantes da unidade em TODAS as linhas** da subcoleção (uniforme — decisão travada). A fonte é a contagem de `otb_simulacao_variantes` da unidade (autoritativa, sem confiar no escalar do cliente).
- **Orçamento**: inalterado (não tem `cores` no plano) — write-back só do nº por semana.
- Continua **sem tocar em `modelos`** (cards do Planejamento) e **sem virar BOM**. Invalida `["otb-orcamento","otb-pv-poder","colecao-pv","otb-sim-plano","otb-colecoes"]`.

## 7. RPCs (evolução das existentes — INVOKER, como hoje)

- `salvar_simulacao(_id,_header,_arvore)`: `_arvore[].unidade` agora carrega `oc_tecido_id` + `variantes:[oc_tecido_item_id,…]` (em vez de `oc_tecido_item_id` único). Insere `otb_simulacao_variantes` no delete-and-reinsert. Mantém `revoke public,anon` + `grant authenticated`.
- `aplicar_simulacao(_simulacao_id,_unidade_id)`: no ramo PV, `cores` gravado = `(select count(*) from otb_simulacao_variantes where unidade_id = _unidade_id)`; resto igual. Ramo Orçamento e a guarda `Σcat ≤ qtd` inalterados.
- Leitura da tela por `select` com os embeds do §5. **queryKeys** do v1 mantidas.

## 8. Escopo

**v1 deste design:** identificar variante; multi-seleção de variantes por subcoleção = cores; cálculo/resultado por cor; mini cards por modelo; write-back de cores uniforme; seleção livre com referência do plano.

**YAGNI:** subconjunto de cores por modelo (nem todo modelo em toda cor); consumo por cor; múltiplas OCs por subcoleção; vínculo real de BOM.

## 9. Invariantes a preservar

- **Segurança**: tabela nova com RLS por tenant + `set_tenant_id`; RPCs INVOKER (RLS governa) + `revoke public,anon`/`grant authenticated` (como o v1 e `salvar_colecao_pv`).
- **Write-back só no alvo do plano** (`colecao_pv_itens`/`colecao_semanas`), nunca em `modelos`.
- **Metragem** = espelho de `consumo_por_oc` (kg→m por `artigo.rendimento`).
- **Migration destrutiva** (`DROP COLUMN oc_tecido_item_id`) em `BEGIN; … COMMIT;` + idempotente; ajustar as RPCs que a citam no MESMO arquivo.
- Rótulo de variante SEMPRE por `src/lib/variante.ts` (não remontar à mão).
- Build + `tsc` antes de commit; revisar embeds/RLS/queryKeys após cada mudança.
