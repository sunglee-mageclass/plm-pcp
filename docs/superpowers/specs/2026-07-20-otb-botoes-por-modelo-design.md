# Feature B — Botões por modelo no Simulador de OC (Aplicar / Criar card)

> Design aprovado (dono, 20/jul/2026). Escopo: Simulador de OC do OTB (`SimulacaoSheet`).
> Terminal do brainstorming → próximo: writing-plans → implementação com teste transacional.

## Objetivo

Levar as decisões da simulação **de volta ao modelo real** (ou criar o modelo quando o slot é
vazio), direto do mini-card de cada modelo/slot — sem sair do Simulador.

## Duas ações (botões no mini-card do modelo)

### 1) "Aplicar no modelo" — só em modelo REAL em desenvolvimento e NÃO aprovado
Grava as decisões da simulação no **Tecido Principal (tipo=tecido, numero=1)** do modelo:
- **OC** → vínculo do Tecido 1 à OC da subcoleção (`modelo_tecido_oc_links`, por item de OC = cor).
- **Cores (variantes)** → as variantes do Tecido 1 = as variantes da unidade (`modelo_tecido_variantes`,
  casadas por `variante_tecido_id` do item de OC; `ordem` sequencial).
- **Grade** → `modelo_grades` por variante: `grade_total = effProf(model, cor)` (profundidade
  simulada da cor); `grades` (jsonb por tamanho) fica vazio (detalhe por tamanho é do Desenvolvimento).
- **NÃO** toca: categoria do modelo, aviamentos, forro/entretela, consumo já existente do Tecido 1
  (só cria/atualiza o Tecido 1 se necessário — ver regras).

**Gating (front):** botão só aparece quando `m.modeloId != null` **E** o `status_desenvolvimento`
do modelo **≠ 'aprovado'** (aprovado = travado). Escondido em slot vazio.

### 2) "Criar card" — só em SLOT VAZIO
Cria um modelo novo no Planejamento a partir do slot, **já com o BOM/grade da simulação** como
ponto de partida:
- `modelos`: `colecao_id`, `subcolecao` (nome, via subcoleção da unidade), `semana`, `linha_id`,
  `categoria_principal_id` (categoria do slot), `status_desenvolvimento = 'em_modelagem'`,
  `ref`/`nome` placeholder (o dono renomeia no dev).
- Tecido 1: artigo = artigo da OC da subcoleção; `consumo` = consumo (estimado) do slot; variantes =
  cores da unidade; vínculo de OC; `modelo_grades` = grade simulada (grade_total por variante).
- Depois: o **slot passa a apontar pro novo `modeloId`** (deixa de ser vazio).

### 3) Item 4 — aviso de OC já usada (dropdown de OC)
No seletor de OC da subcoleção, marcar as OCs **já usadas em outra coleção** (algum modelo daquela
OC com `colecao_id` diferente da atual) com um aviso: "usada na coleção X". Não bloqueia — só sinaliza.

## Backend (RPCs novas, DEFINER, invariante #9)

Núcleo compartilhado `_aplicar_sim_no_modelo_core(_modelo_id, _oc_id, _variantes jsonb, _grade jsonb, _consumo numeric?)`:
- `_variantes`: `[{variante_tecido_id, oc_tecido_item_id, ordem}]` (as cores da unidade).
- `_grade`: `[{ordem, prof}]` (profundidade por cor).
- Isolamento de tenant (modelo, OC, variantes da loja); RAISE cross-tenant.
- Garante Tecido 1 (`modelo_tecidos` tipo=tecido numero=1): cria se não existe (artigo = artigo do
  item de OC; consumo = `_consumo` quando informado, senão preserva/0), senão atualiza consumo só se
  `_consumo` informado.
- `modelo_tecido_variantes` do Tecido 1 = `_variantes` (diff por variante_tecido_id, preserva ids).
- `modelo_tecido_oc_links` do Tecido 1 = os itens de OC (`oc_tecido_item_id`, prioridade 1).
- `modelo_grades`: upsert por `variante_numero=ordem` com `grade_total=prof`, `grades='{}'`.
- Reserva de estoque: recomputada como no save do BOM (reusa o caminho de `salvar_modelo_bom` se
  couber; senão documenta que a reserva se ajusta no próximo save do Desenvolvimento).

RPCs públicas (wrapper + gate `otb`):
- `aplicar_simulacao_modelo(_modelo_id, _oc_id, _variantes, _grade)`:
  - RAISE se `status_desenvolvimento = 'aprovado'`.
  - chama o core **sem** `_consumo` (não mexe no consumo existente).
- `criar_card_simulacao(_colecao_id, _subcolecao_id, _semana, _linha_id, _categoria_id, _oc_id, _variantes, _grade, _consumo)`:
  - INSERT `modelos` (em_modelagem + campos do slot) — reusa a lógica de `otb_atribuir_card`
    (subcolecao nome + semana) para o bucket.
  - chama o core **com** `_consumo`.
  - retorna `_modelo_id` novo.
- `_core` REVOKE de PUBLIC/anon/authenticated; wrappers GRANT authenticated.

## Front (SimulacaoSheet)

- Mini-card do modelo: 2 botões condicionais.
  - **Aplicar no modelo**: visível se `m.modeloId` e o modelo real não é `aprovado` (precisa do
    `status_desenvolvimento` no `modelosReais` — já está no select). Confirmação (AlertDialog):
    "Aplicar OC, cores e grade da simulação neste modelo? Sobrescreve as cores e a grade do Tecido
    Principal." onSuccess: toast + invalida queries do modelo/estoque.
  - **Criar card**: visível se `!m.modeloId` (vazio). Confirmação leve. onSuccess: `patchModelo` do
    slot com o `modeloId` retornado (vira real) + invalida `otb-sim-modelos`/planejamento.
- Ambos usam a OC/variantes da **unidade** (`u.ocId`, `u.variantes`) + a prof do modelo
  (`effProf` por cor) para montar `_variantes`/`_grade`.
- Desabilitados se a unidade não tem OC atribuída (sem OC não há o que aplicar) — tooltip explicando.
- **Aviso de OC usada**: no dropdown de OC, badge/《usada na coleção X》 por OC — via uma query
  leve (modelos por OC com colecao_id ≠ atual) ou embutido no `ocs` já carregado.

## Regras / invariantes
- Nunca aplicar em modelo `aprovado` (trava no servidor).
- Escrita atômica (uma RPC por ação).
- Reserva de estoque coerente (o BOM do modelo muda → reserva recalcula).
- `criar_card_simulacao` respeita o gate do módulo `otb` + tenant.

## Testes (transacional BEGIN/ROLLBACK)
- Aplicar: modelo não-aprovado recebe variantes/OC-link/grade do Tecido 1; modelo `aprovado` → RAISE.
- Criar card: cria modelo em_modelagem com subcoleção/semana/linha/categoria + Tecido 1 (artigo da
  OC, consumo) + variantes + grade; retorna id.
- Cross-tenant: OC/variante de outra loja → RAISE.

## Fora de escopo (fases futuras)
- PV: categoria por linha no plano (A2) — mantido por-linha, fora daqui.
- Aplicar aviamentos/forro/entretela.
- Sincronizar categoria do modelo real com a do simulador (o dono optou por não).
