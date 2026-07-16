# Simulador de Uso de OC no OTB — Design

**Data:** 2026-07-16
**Módulo:** `otb` (opt-in, default OFF)
**Status:** aprovado no brainstorm; pronto para plano de implementação

---

## 1. Problema e objetivo

No OTB (Open To Buy) a loja planeja a coleção top-down: no fluxo **Poder de Venda**
cada linha define **nº de modelos**, **profundidade** e **cores** — mas **não** o
consumo de tecido por peça (o BOM só nasce depois, no Desenvolvimento). Então hoje
não dá pra responder, ainda no planejamento: *"a metragem que comprei nesta OC de
tecido dá pra essa coleção/subcoleção, ou vai esgotar?"*

O **Simulador de Uso de OC** preenche essa lacuna. É um "Consumo por OC" **simulado**
dentro do OTB, sem valores reais de corte/baixa: o usuário atribui uma OC real, digita
o **consumo por peça** de cada modelo, e o sistema calcula se o tecido daquela OC
**sobra ou estoura**. A simulação pode ser salva em **cenários nomeados** e, opcionalmente,
**escrever de volta** os valores estruturais (profundidade, cores, nº de modelos) no card
da coleção.

## 2. Decisões travadas (do brainstorm)

| Tema | Decisão |
|---|---|
| **Metragem disponível (a "trava")** | Vem **só de uma OC real** (não editável). Dentro da OC, escolhe **um item = artigo/variante**; a metragem dele é o teto. |
| **Quantidades da demanda** | **Puxadas do OTB e editáveis** (nº de modelos, profundidade, cores). Pode **adicionar modelos** e **editar profundidade**. |
| **Nível de atribuição da OC** | **Flexível**: por **subcoleção** quando existir; senão pela **coleção** inteira. |
| **Salvamento** | **Vários cenários nomeados** por coleção. |
| **Granularidade do consumo** | **Por modelo** (m/peça). O `num_modelos` da linha é explodido em uma linha por modelo. |
| **Identificação do modelo** | Coleção confirmada → puxa **foto + ref/nome** do card real (`modelos`). Não confirmada → slots anônimos ("Modelo 1, 2, 3…"). |
| **Fluxos suportados** | **PV e Orçamento** (Orçamento é o ramo mais simples, sem prof/cores). |
| **Perda** | **Não** considerar perda na simulação. `metros = peças × consumo`. |
| **Write-back** | Botão por coleção/subcoleção **atualiza os valores no card da coleção** (profundidade, cores, nº de modelos). Consumo e OC ficam guardados só na simulação (sem virar vínculo de BOM). |
| **Profundidade/cores** | Editáveis **por linha** (todos os modelos da linha herdam); write-back grava em `colecao_pv_itens`. |
| **Base da metragem da OC** | `quantidade_pedida` (planejada) como padrão; a recebida é mostrada ao lado. |

## 3. Arquitetura de UI

**Escolha:** Sheet lateral próprio com gerenciador de cenários (padrão de
`ColecaoPVSheet`/`PadraoMixSheet`). *Rejeitado:* aba dentro do editor da coleção
(mistura os modos de editar × simular e aperta a tela).

- Botão **Simular** em cada card de coleção em
  `src/routes/_authenticated/otb.index.tsx` (PV e Orçamento).
- Abre `src/components/otb/SimulacaoSheet.tsx`.
- Topo: **pílulas de cenários** dessa coleção (`+ Cenário`, renomear, excluir) —
  espelha o seletor de Padrão do mix.
- Botão **"Re-puxar do OTB"**: re-semeia a árvore a partir do estado atual da coleção,
  **preservando o consumo já digitado** (casa por `modelo_id` do card real quando existir;
  senão por `slot_index`).

### Árvore da tela: `Unidade → Linha → Modelo`

**Unidade** = subcoleção (se houver) ou a coleção inteira.

- **Por Unidade:**
  - Seletor **OC → item (artigo/variante)**. Ao escolher, mostra a **metragem disponível**
    daquele item: `quantidade_pedida` convertida kg→m por `rendimento` do artigo (recebida
    ao lado quando existir). Esse número é a "trava".
  - Painel de **resultado** (ver §4) e o botão **"Aplicar no card da coleção"** (write-back, §5).
- **Por Linha** (só PV):
  - Campos **profundidade** e **cores** (pré-preenchidos de `colecao_pv_itens`, editáveis).
  - **+ Modelo** (adiciona um slot) e atalho **"aplicar consumo a todos"** os modelos da linha.
- **Por Modelo** (uma linha por modelo):
  - `peças = profundidade × cores` (derivado da linha).
  - Campo **consumo (m/peça)** digitado → `metros = peças × consumo`.
  - Confirmada: **foto + ref/nome** do card real. Não confirmada: "Modelo N".

- **Orçamento** (ramo simples): sem cores. A unidade agrupa modelos a partir de
  `colecao_semanas.qtd_planejada` numa **linha sintética** (`linha_id = null`, `cores = 1`).
  A **grade (profundidade)** é digitada na linha e vale pra todos os modelos dela; o
  **consumo continua por modelo** (`peças = profundidade`). Write-back grava só o nº de modelos.

## 4. Cálculo e resultado ("esgota ou não")

Por unidade:

- **Demanda (m)** = Σ dos modelos `(peças × consumo)`. Sem perda.
- **Disponível (m)** = metragem do item de OC escolhido.
- **Saldo** = `disponível − demanda`:
  - `≥ 0` → **verde**: "sobram X m".
  - `< 0` → **vermelho**: "faltam X m (estoura)".
- Mostra **% usado** (`demanda / disponível`) e barra de progresso.

**Exemplo.** Subcoleção *Praia*, linha *Vestidos* prof 8 × 3 cores = 24 peças/modelo,
6 modelos, OC item *Viscose Floral* = 900 m. Consumo 1,2 m/peça →
demanda `6 × 24 × 1,2 = 172,8 m` → saldo **+727,2 m** (verde). Subindo o consumo ou
adicionando modelos, vira vermelho.

## 5. Escrever de volta ("atribuir e salvar no card real")

Botão **por unidade**, com `AlertDialog` de confirmação (muda dado real). Atualiza **os
valores da coleção**:

- **PV:** grava `profundidade`/`cores` editadas em `colecao_pv_itens`; reconcilia o
  **nº de modelos** (add/remove) **reaproveitando a máquina do `otb_confirmar_pv`**
  (trava `app.otb_reconciling`, limpeza de órfãos, gatilho `fn_otb_sync_semana`) — não
  reimplementar reconciliação à mão.
- **Orçamento:** grava só o **nº de modelos** em `colecao_semanas.qtd_planejada`.
- **Consumo e OC atribuída NÃO viram BOM/vínculo** — ficam persistidos na simulação.

## 6. Dados & backend

Tabelas novas — multi-tenant (RLS por `tenant_id`), gate do módulo `otb`:

```
otb_simulacoes            id, tenant_id, colecao_id (FK colecoes), nome, created_at
otb_simulacao_unidades    id, tenant_id, simulacao_id (FK), subcolecao_id (nullable = coleção),
                          oc_tecido_item_id (FK ocs_tecido_itens, nullable até escolher)
otb_simulacao_linhas      id, tenant_id, unidade_id (FK), linha_id (nullable p/ Orçamento),
                          profundidade, cores, num_modelos
otb_simulacao_modelos     id, tenant_id, linha_ref_id (FK otb_simulacao_linhas),
                          modelo_id (nullable = card real), slot_index, consumo
```

- `peças` de um modelo = `profundidade × cores` da sua linha (Orçamento: `profundidade`
  digitada na linha, `cores = 1`). Não persistir `peças` (é derivado).
- UNIQUE sensatos: `otb_simulacao_unidades (simulacao_id, subcolecao_id)` nulls not distinct.

RPCs — padrão **wrapper + `_core`** (invariante #9: `REVOKE EXECUTE ON FUNCTION public._xxx_core(...)
FROM PUBLIC, anon, authenticated;` e conferir com `has_function_privilege`):

- `salvar_simulacao(_id, _header, _arvore)` — upsert atômico da árvore inteira (espelha
  `salvar_colecao_pv`; delete-and-reinsert das filhas dentro de txn).
- `excluir_simulacao(_id)`.
- `aplicar_simulacao(_simulacao_id, _subcolecao_id)` — o write-back da §5; wrapper com
  `tenant_module_enabled('otb')`, `_core` revogado; usa a trava `app.otb_reconciling`.

Leitura: `select` direto com embeds (não cruzar duas queries). **queryKey única** por tela.

Migration aplicada com `psql "$(cat /tmp/dburl.txt)" -f`; se houver qualquer trecho
destrutivo, envolver em `BEGIN; … COMMIT;` e escrever idempotente (regra 1 do CLAUDE.md).
Regenerar `types.ts` depois das tabelas/RPCs novas.

## 7. Escopo

**v1 (este spec):**
- Sheet de simulação com cenários nomeados; árvore Unidade→Linha→Modelo.
- OC real travada (um item de artigo/variante por unidade), consumo por modelo,
  add modelo, editar prof/cores.
- Resultado sobra/estoura por unidade.
- Write-back estrutural (prof/cores/nº de modelos) com confirmação.
- PV e Orçamento.

**Fica pra depois (YAGNI):**
- Vínculo real de BOM/consumo (`modelo_tecido_oc_links`) a partir da simulação.
- Múltiplos tecidos/itens de OC por unidade num único cenário.
- Considerar perda (loss_percent).
- Rollup/consolidado no Dashboard.

## 8. Invariantes e cuidados a preservar

- **Módulo `otb` opt-in**: tela e RPCs gated; sem o módulo, nada aparece.
- **Multi-tenant/RLS** em todas as 4 tabelas novas; nada de vazamento cross-tenant.
- **Segurança RPC** (invariante #9): `_core` revogado de PUBLIC, anon **e** authenticated.
- **Não brigar com os gatilhos do OTB**: o write-back passa pela reconciliação existente
  (`otb_confirmar_pv` / trava `app.otb_reconciling`), nunca decremento/insert manual paralelo.
- **AlertDialog** de confirmação no write-back (padrão do projeto p/ mudança de dado real).
- **Revisar efeitos colaterais** após cada mudança: embeds PostgREST, RLS, queryKeys.
- Build antes de commit; `npx tsc --noEmit | grep TS2304` após mexer em imports.
