# Leadtime — design (sisTrama)

Data: 2026-07-13. Status: aprovado no escopo pelo dono; pendente review do spec escrito.

## 1. Objetivo

Medir e acompanhar **quanto tempo cada modelo fica em cada etapa** do fluxo, comparado
a um **tempo ideal** (SLA) definido por etapa. Substitui a "timeline por REF" da aba
Produção por uma leitura de leadtime/gargalo.

## 2. Decisões do dono (brainstorming)

- **Aba "Leadtime"** nova no Dashboard (só **exibe**).
- **Config** (quais etapas visualizar + tempo ideal em dias de cada) fica em
  **Configurações da Loja** (`/admin/configuracoes`), persistida em `tenant_config`.
  A aba Leadtime lê essa config.
- **Etapas macro** (dos marcos que já existem): **CAD→Corte, Produção/Serviços, CQ,
  Direcionamento, Lançamento**.
- **Só Desenvolvimento destrincha por COLUNA DO KANBAN** (Em Modelagem, Corte de
  Piloto I/II/III, Em Pilotagem, Prova de Roupa I–V, Em Ajuste, Stand By, …).
- **Fonte do tempo por coluna do kanban = HÍBRIDO**: (a) **backfill** do `audit_log`
  (trocas de `status_desenvolvimento` já registradas desde jun/2026) + (b) **trigger**
  novo que grava cada troca daqui pra frente. Etapas macro saem dos marcos (com histórico).
- Fora do Leadtime macro: **Planejamento** (sem marco limpo).

## 3. Arquitetura (3 partes)

### 3.1 Histórico de transições de kanban (dado)
- Tabela `modelo_kanban_historico`: `id, tenant_id, modelo_id, status (text, o valor
  snake de status_desenvolvimento), entrou_at timestamptz, created_at`. Índice
  `(modelo_id, entrou_at)`. RLS por tenant (SELECT); escrita só por trigger/backfill.
- **Trigger** `trg_kanban_historico` em `modelos` (AFTER INSERT OR UPDATE OF
  status_desenvolvimento): quando entra num status novo, insere `(modelo_id, NEW.status,
  now())`. No INSERT com status não-nulo, registra o inicial.
- **Backfill (uma vez, na migration)**: dos `audit_log` de Modelo cujo `dados` tem
  `status_desenvolvimento: {de, para}`, ordenados por `created_at`, insere
  `(registro_id, para, created_at)`; + o status inicial do modelo (`modelos.created_at`
  → 1º status conhecido). Idempotente (não duplica se já houver linha na mesma data).
- **Tempo numa coluna** = `próxima entrou_at − entrou_at` (ou `now() − entrou_at` p/ a
  coluna atual). Só conta modelos que passaram pela coluna.

### 3.2 Config em Configurações da Loja
- `tenant_config.leadtime` (jsonb): lista de etapas selecionadas + ideal em dias, ex.:
  `{ "etapas": [ {"key":"kanban:em_modelagem","tipo":"kanban","idealDias":3},
  {"key":"cad_corte","tipo":"macro","idealDias":5}, {"key":"servicos","tipo":"macro",
  "idealDias":10}, ... ] }`. Ordem = ordem de exibição.
- UI: um bloco novo em `/admin/configuracoes` (admin da loja + super_admin) — lista de
  etapas disponíveis (macro + colunas do kanban da loja, de `tenant_config.status_kanban`)
  com checkbox "acompanhar" + campo "ideal (dias)". Salva via RPC de config (ou update
  direto em tenant_config, RLS admin).

### 3.3 Aba Leadtime (Dashboard) — só exibe
- RPC **`dashboard_leadtime()`** (wrapper `user_can_view('dashboard_leadtime')` + `_core`
  revogado dos 3; #9). Lê a config (`tenant_config.leadtime`), calcula por etapa
  selecionada: `duracaoMedia` (dias), `idealDias`, `nModelos`, `nForaSla` (acima do
  ideal), `pctNoPrazo`. Retorna também outliers (top modelos acima do ideal por etapa).
  - Macro: duração = fim − início por modelo (marcos §4), média dos que têm ambos.
  - Kanban: duração média na coluna a partir de `modelo_kanban_historico`.
- Front: nova página de permissão `dashboard_comercial`-style (`dashboard_leadtime`),
  card por etapa (barra duração vs ideal, cor verde/vermelho), tabela de outliers,
  `card-table` no mobile. Filtro por período/coleção (como as outras abas).

## 4. Etapas macro e seus marcos

| Etapa (key) | Início | Fim |
|---|---|---|
| `cad_corte` | `cad.created_at` | `cad.data_enviado_corte` |
| `servicos` | `cad.data_enviado_corte` | `max(producao_terceirizados.data_entregue)` |
| `cq` | serviço entregue (ou `controle_qualidade.created_at`) | `controle_qualidade.confirmado_at` |
| `direcionamento` | `confirmado_at` | `cad.direcionamento_confirmado_at` |
| `lancamento` | direcionamento | `modelos.data_lancamento` |

Kanban (`kanban:<status>`): tempo em cada coluna via `modelo_kanban_historico`.

## 5. Decomposição / fases de implementação

- **Fase 1 — Histórico de kanban**: tabela + trigger + backfill (migration + teste txn).
- **Fase 2 — Config na Loja**: `tenant_config.leadtime` + UI em `/admin/configuracoes`.
- **Fase 3 — RPC + aba**: `dashboard_leadtime()` + aba Leadtime no Dashboard.
- **Fase 4 — Aposentar** a "timeline por REF" da Produção (mover/remover) — decisão do
  dono no fim.

## 6. Fora de escopo

- Planejamento (sem marco). Não replicar lógica de preço. Não mexer no motor de regras
  do kanban (só ler transições). Sub-etapas do CQ (conserto/lavagem) ficam pra depois.

## 7. Verificação

- Backfill: reconstrói o histórico dos modelos com trocas no audit_log (ex.: os de
  6–16 trocas), sem duplicar; trigger grava novas trocas (teste txn).
- RPC em txn revertida (durações macro e kanban batendo com dados de amostra).
- tsc 0 · build ✓ · screenshot da aba e da config.

## 8. Riscos / notas

- **Kanban pouco usado hoje** (status_desenvolvimento NULL em ~97% dos modelos) → o
  Leadtime de Desenvolvimento começa magro e popula com o uso. Esperado.
- Backfill do audit_log é **aproximado** (esparso, desde jun/2026) — o trigger garante
  precisão daqui pra frente.
- Config em tenant_config: validar que a UI de Configurações só grava com permissão de
  admin (RLS).
