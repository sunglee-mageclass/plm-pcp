# Simulador de Uso de OC no OTB — Design

**Data:** 2026-07-16 (revisado 2026-07-17 — alinhado ao desacoplamento OTB↔Planejamento)
**Módulo:** `otb` (opt-in, default OFF)
**Status:** aprovado no brainstorm; revisado; pronto para plano de implementação

> **Revisão 2026-07-17 — por que.** Este spec nasceu **antes** da feature
> "desacoplar-cards-e-orçamento" (já no `main`), que mudou a base do OTB: `otb_confirmar_pv`
> hoje **só marca `status='confirmada'`** (não cria nem reconcilia cards); o gatilho
> `fn_otb_sync_semana`/`trg_otb_sync_semana` foi **dropado**; e a trava GUC
> `app.otb_reconciling` **não existe mais**. O plano do OTB
> (`colecao_pv_itens.qtd_semanas` no PV; `colecao_semanas.qtd_planejada` no Orçamento) virou
> **alvo fixo**, os cards do Planejamento são criados/editados à mão e o "realizado" é
> contagem viva de `modelos` via `otb_orcamento`. O **write-back** original (§5) apontava
> para essa máquina removida — foi reescrito para gravar **direto no alvo do plano**, mais
> simples e sem reconciliação. §2/§3/§6/§8 ajustados junto. Escopo e telas inalterados.

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
**escrever de volta** os valores estruturais (profundidade, cores, nº de modelos) no alvo
do plano da coleção.

## 2. Decisões travadas (do brainstorm)

| Tema | Decisão |
|---|---|
| **Metragem disponível (a "trava")** | Vem **só de uma OC real** (não editável). Dentro da OC, escolhe **um item = artigo/variante**; a metragem dele é o teto. |
| **Quantidades da demanda** | **Puxadas do OTB e editáveis** (nº de modelos, profundidade, cores). Pode **adicionar modelos** e **editar profundidade**. |
| **Nível de atribuição da OC** | **Flexível**: por **subcoleção** quando existir; senão pela **coleção** inteira. |
| **Salvamento** | **Vários cenários nomeados** por coleção. |
| **Granularidade do consumo** | **Por modelo** (m/peça). O `num_modelos` da linha é explodido em uma linha por modelo. |
| **Identificação do modelo** | Coleção confirmada → puxa **foto + ref/nome** do card real (`modelos`). Não confirmada → slots anônimos ("Modelo 1, 2, 3…"). |
| **Fluxos suportados** | **PV e Orçamento** (Orçamento é o ramo mais simples, sem prof/cores no plano). |
| **Perda** | **Não** considerar perda na simulação. `metros = peças × consumo`. |
| **Write-back** | Botão por unidade **atualiza o ALVO DO PLANO** (não os cards, que agora são manuais). **PV:** `prof_cor`/`cores`/nº de modelos (→ `qtd_semanas`) em `colecao_pv_itens`. **Orçamento:** nº de modelos → `colecao_semanas.qtd_planejada`. **Nunca** cria/edita cards do Planejamento nem vira BOM. |
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
    daquele item, espelhando o cálculo de `consumo_por_oc`:
    `artigo.unidade_medida = 'kg' ? quantidade_pedida × artigo.rendimento : quantidade_pedida`
    (a **recebida** = idem com `quantidade_recebida`, exibida ao lado como referência).
    A metragem do **pedido** é a "trava".
  - Painel de **resultado** (ver §4) e o botão **"Aplicar no card da coleção"** (write-back, §5).
- **Por Linha** (só PV):
  - Campos **profundidade** (`prof_cor`) e **cores** (pré-preenchidos de `colecao_pv_itens`,
    editáveis). O **nº de modelos** inicial da linha = Σ dos valores de `qtd_semanas`.
  - **+ Modelo** (adiciona um slot) e atalho **"aplicar consumo a todos"** os modelos da linha.
- **Por Modelo** (uma linha por modelo):
  - `peças = prof_cor × cores` (derivado da linha).
  - Campo **consumo (m/peça)** digitado → `metros = peças × consumo`.
  - Confirmada: **foto + ref/nome** do card real (`modelos`). Não confirmada: "Modelo N".

- **Orçamento** (ramo simples): sem cores. A unidade agrupa modelos a partir de
  `colecao_semanas.qtd_planejada` numa **linha sintética** (`linha_id = null`, `cores = 1`).
  A **grade (profundidade)** é digitada na linha e vale pra todos os modelos dela; o
  **consumo continua por modelo** (`peças = prof_cor`). Write-back grava só o nº de modelos
  (§5). A profundidade digitada no Orçamento é só da simulação (não há campo de plano p/ ela).

## 4. Cálculo e resultado ("esgota ou não")

Por unidade:

- **Demanda (m)** = Σ dos modelos `(peças × consumo)`. Sem perda.
- **Disponível (m)** = metragem do item de OC escolhido (base = pedido, §3).
- **Saldo** = `disponível − demanda`:
  - `≥ 0` → **verde**: "sobram X m".
  - `< 0` → **vermelho**: "faltam X m (estoura)".
- Mostra **% usado** (`demanda / disponível`) e barra de progresso.

**Exemplo.** Subcoleção *Praia*, linha *Vestidos* prof 8 × 3 cores = 24 peças/modelo,
6 modelos, OC item *Viscose Floral* = 900 m. Consumo 1,2 m/peça →
demanda `6 × 24 × 1,2 = 172,8 m` → saldo **+727,2 m** (verde). Subindo o consumo ou
adicionando modelos, vira vermelho.

## 5. Escrever de volta ("aplicar no card da coleção")

Botão **por unidade**, com `AlertDialog` de confirmação (muda dado real do plano). No mundo
desacoplado, o "card da coleção" é o **alvo do plano** — o write-back grava direto nele,
**sem tocar nos cards do Planejamento** (que agora são manuais), **sem** reconciliação e
**sem** gatilho/`app.otb_reconciling` (removidos).

- **PV** (unidade = subcoleção): para cada linha da unidade, `UPDATE colecao_pv_itens`
  (match por `colecao_id, subcolecao_id, linha_id, tenant_id`), gravando:
  - `prof_cor`, `cores` editados na simulação;
  - `qtd_semanas`: o novo **nº de modelos** da linha **redistribuído** nas semanas da
    subcoleção (`colecao_subcolecoes.semanas`) por **`splitEven`** (piso + resto nas
    primeiras semanas), a mesma regra do editor PV. Ex.: nº = 13 em 5 semanas →
    `{"1":3,"2":3,"3":3,"4":2,"5":2}`. (Se a subcoleção não tiver semanas selecionadas,
    o write-back de nº é pulado — não há onde alocar; prof/cores ainda gravam.)
- **Orçamento** (unidade = subcoleção ou coleção): `UPDATE colecao_semanas.qtd_planejada`
  (match por `colecao_id, subcolecao_id, semana`), com o novo total **redistribuído** nas
  semanas da unidade por `splitEven`.
  - **Guarda (invariante Σcat ≤ qtd_planejada):** se alguma semana da unidade tem
    distribuição por categoria (`colecao_semana_categorias`) cuja soma passaria a **exceder**
    o novo `qtd_planejada`, o write-back é **bloqueado** com mensagem clara
    ("Ajuste as categorias da semana no editor da coleção antes de aplicar") — **nunca**
    apaga nem escala categoria em silêncio. Sem categorias (ou sem estouro), aplica direto.
- **Consumo e OC atribuída NÃO viram BOM/vínculo** — ficam persistidos só na simulação.

Write-back é **idempotente por unidade** (recalcula o alvo do zero; reaplicar dá o mesmo
resultado). Depois de aplicar, o front **invalida `["otb-orcamento"]`** (o total do plano
mudou) e as queries da coleção/editor.

## 6. Dados & backend

Tabelas novas — multi-tenant, com **as mesmas policies de `colecao_pv_itens`**
(select/insert/update/delete por `tenant_id = get_user_tenant_id()`) e o trigger
`set_tenant_id`. Gate do módulo `otb`:

```
otb_simulacoes          id, tenant_id, colecao_id (FK colecoes ON DELETE CASCADE), nome, created_at
otb_simulacao_unidades  id, tenant_id, simulacao_id (FK otb_simulacoes ON DELETE CASCADE),
                        subcolecao_id (FK colecao_subcolecoes ON DELETE CASCADE, NULL = coleção inteira),
                        oc_tecido_item_id (FK ocs_tecido_itens ON DELETE SET NULL, NULL até escolher)
otb_simulacao_linhas    id, tenant_id, unidade_id (FK otb_simulacao_unidades ON DELETE CASCADE),
                        linha_id (FK linhas, NULL p/ Orçamento), prof_cor int, cores int, num_modelos int
otb_simulacao_modelos   id, tenant_id, linha_ref_id (FK otb_simulacao_linhas ON DELETE CASCADE),
                        modelo_id (FK modelos ON DELETE SET NULL, NULL = slot anônimo),
                        slot_index int, consumo numeric
```

- `peças` de um modelo = `prof_cor × cores` da sua linha (Orçamento: `prof_cor` digitada,
  `cores = 1`). **Não persistir `peças`** (é derivado).
- UNIQUE: `otb_simulacao_unidades (simulacao_id, subcolecao_id)` **NULLS NOT DISTINCT**
  (uma unidade por subcoleção; a "coleção inteira" = `subcolecao_id NULL`, também única).
- Se o item da OC sumir, a trava se perde (FK `ON DELETE SET NULL`) — aceitável.

RPCs — **INVOKER** (espelham `salvar_colecao_pv`), **não** `SECURITY DEFINER`: rodam como o
usuário, a **RLS das 4 tabelas** garante o tenant, e cada uma checa `auth.uid()` +
`tenant_module_enabled('otb')` explicitamente. Por **não** serem DEFINER, **não** precisam
do par `_core`/`REVOKE` da invariante #9 (que vale só p/ DEFINER que fura RLS) — não há
`_core` novo a revogar.

- `salvar_simulacao(_id uuid, _header jsonb, _arvore jsonb) returns uuid` — upsert atômico
  da árvore inteira (espelha `salvar_colecao_pv`: valida módulo/nome; insere/atualiza
  `otb_simulacoes`; **delete-and-reinsert** de unidades → linhas → modelos na mesma txn).
- `excluir_simulacao(_id uuid) returns void` — apaga a simulação (cascata nas filhas).
- `aplicar_simulacao(_simulacao_id uuid, _unidade_id uuid) returns jsonb` — o write-back
  da §5: lê a unidade + linhas/modelos, decide PV × Orçamento por `colecoes.tipo`, aplica os
  `UPDATE` no alvo do plano (com a guarda de categorias no Orçamento), retorna
  `{aplicado:true}` ou `RAISE` na guarda. Idempotente.

Leitura da tela: `select` direto com embeds (OC → item → artigo; `modelos` p/ foto+ref) —
não cruzar duas queries. **queryKey** `["otb-simulacoes", colecao_id]`.

Migration com `psql "$(cat /tmp/dburl.txt)" -f`. O DDL das tabelas é **aditivo**
(`CREATE TABLE IF NOT EXISTS`); as RPCs, `CREATE OR REPLACE FUNCTION` (o delete-and-reinsert
mora dentro delas, em txn própria — não é DDL destrutivo). Ainda assim, escrever idempotente
(reaplicável). Regenerar `types.ts` depois das tabelas/RPCs novas.

## 7. Escopo

**v1 (este spec):**
- Sheet de simulação com cenários nomeados; árvore Unidade→Linha→Modelo.
- OC real travada (um item de artigo/variante por unidade), consumo por modelo,
  add modelo, editar prof/cores.
- Resultado sobra/estoura por unidade.
- Write-back estrutural no **alvo do plano** (prof/cores/nº de modelos) com confirmação;
  Orçamento com categoria distribuída é **bloqueado** quando quebraria Σcat ≤ qtd (v1).
- PV e Orçamento.

**Fica pra depois (YAGNI):**
- Vínculo real de BOM/consumo (`modelo_tecido_oc_links`) a partir da simulação.
- Múltiplos tecidos/itens de OC por unidade num único cenário.
- Considerar perda (loss_percent).
- Escalar/rebalancear a distribuição por categoria no write-back do Orçamento
  (hoje é bloqueio, não rebalanceio).
- Rollup/consolidado no Dashboard.

## 8. Invariantes e cuidados a preservar

- **Módulo `otb` opt-in**: tela e RPCs gated (`tenant_module_enabled('otb')`); sem o módulo,
  nada aparece.
- **Multi-tenant/RLS** nas 4 tabelas novas (policies por `tenant_id` + trigger
  `set_tenant_id`); zero vazamento cross-tenant.
- **RPCs INVOKER, não DEFINER** → a RLS governa o tenant; **não** aplicar o par
  `_core`/`REVOKE` (#9 é só p/ DEFINER). Não há `_core` novo.
- **Desacoplado do Planejamento**: o write-back grava **só o alvo do plano**
  (`colecao_pv_itens` / `colecao_semanas`), **nunca** cria/edita/apaga `modelos` e **nunca**
  depende de gatilho/`app.otb_reconciling` (removidos). Os contadores do OTB
  (`otb_orcamento`) se atualizam sozinhos porque leem `modelos` ao vivo; como o write-back
  muda o **total do plano**, o front **invalida `["otb-orcamento"]`** depois de aplicar.
- **Invariante Σcat ≤ qtd_planejada** preservada: write-back do Orçamento bloqueia quando
  quebraria (nunca apaga/escala categoria em silêncio).
- **AlertDialog** de confirmação no write-back (padrão do projeto p/ mudança de dado real).
- **Revisar efeitos colaterais** após cada mudança: embeds PostgREST, RLS, queryKeys
  (`["otb-orcamento"]`, `["otb-simulacoes", colecao_id]`, queries da coleção/editor PV).
- Build antes de commit; `npx tsc --noEmit | grep TS2304` após mexer em imports.
