# OTB (Open To Buy) — Orçamento de Coleção

**Data:** 2026-07-02
**Módulo novo:** `otb` (ligável por loja, opt-in) · rota `/otb` · item de sidebar acima de Criação
**Status:** design aprovado, pronto para plano de implementação

---

## 1. Objetivo

Criar uma etapa **antes do Planejamento** onde o usuário monta a **coleção** e o
**orçamento** dela, e acompanha se está **abaixo / dentro / estourando**. A coleção
deixa de ser um texto solto e vira a **entidade dona** (nome, ano, mês, semanas,
orçamento), reaproveitada em Planejamento e Desenvolvimento. Por semana define-se a
**quantidade de modelos**; ao **Confirmar**, os cards em branco nascem no Planejamento.

O recurso é **opt-in**: loja sem o módulo `otb` ligado continua exatamente como hoje
(coleção = texto livre, nenhuma mudança de tela).

## 2. Decisões travadas (Q&A com o dono)

1. **Custo do painel = previsto vs real agregados** (não há custo digitado). A única
   coisa digitada é o **orçamento** (teto). Previsto vem do Desenvolvimento, real de
   Serviços/produção — o sistema já calcula por modelo. No começo previsto/real ≈ 0.
2. **Auto-geração de cards = reconciliar, nunca apagar preenchido** (detalhe em §6).
3. **Orçamento consumido pelo "valor usado" (consumo por modelo)** — NÃO se atrela OC.
   Tecido é comprado pra estoque compartilhado (invariante 4/5) e consumido por vários
   modelos/coleções; o valor que entra na coleção é o consumido, que o previsto já
   inclui via BOM (consumo × preço). Atrelar OC contaria em dobro.
4. **Módulo próprio `otb`, ligável + permissão** ver/editar, como os outros 6 módulos.
5. **Opt-in:** módulo default **DESLIGADO**. Sem ele, coleção = texto livre (hoje).
6. **Orçamento = um número por coleção** (semanas só carregam a qtd de modelos).
7. **Card gerado carrega coleção, semana, mês, ano**; o resto (categoria etc.) fica em
   branco pro Planejamento. Preenchimento do resto é feito **em massa** (§9).

## 3. Modelo de dados (migração ADITIVA)

Regra do projeto: migração hits o banco de produção na hora, front sobe manual depois.
Tudo aditivo; nada é dropado.

- **`colecoes`** (nova — a entidade dona):
  - `id uuid pk`, `tenant_id uuid` (via trigger `set_tenant_id`), `nome text not null`,
    `ano_id uuid null → anos`, `mes_id uuid null → meses`, `orcamento numeric null`,
    `status text not null default 'rascunho' check in ('rascunho','confirmada')`,
    `created_at timestamptz default now()`.
  - **UNIQUE composta** `(tenant_id, nome)`. (Nunca UNIQUE em coluna única embedada —
    invariante "O que NÃO fazer".)
  - RLS por `tenant_id` (`get_user_tenant_id()`); grants padrão.
- **`colecao_semanas`** (filha):
  - `id uuid pk`, `colecao_id uuid → colecoes on delete cascade`, `semana text ('1'..'5')`,
    `qtd_planejada int not null default 0`. UNIQUE `(colecao_id, semana)`.
- **`modelos.colecao_id uuid null → colecoes`** (novo FK). Índice plano.
  - `modelos.colecao` (texto de hoje) **permanece** — é o valor livre quando OTB off e
    o espelho do nome da coleção quando OTB on (exibição + compat com front antigo no ar).
  - `mes_id`/`ano_id`/`semana` continuam no modelo (editáveis por imprevisto). Ao escolher
    a coleção, mês/ano pré-preenchem a partir dela.

**Sem backfill forçado.** Lojas existentes não mudam até ligarem o OTB. Conveniência
opcional: ação "Importar coleções existentes" no OTB que varre os `modelos.colecao`
distintos (com `colecao_id` null) do tenant, cria linhas em `colecoes` e liga o FK.

`types.ts` regenerado após a migration; `notify pgrst, 'reload schema'`.

## 4. Módulo, rota, permissão, config

- `PAGES_CATALOG`: novo `{ module: "otb", label: "OTB", basePath: "/otb", pages: [{ key: "otb", label: "OTB" }] }`.
  A página `otb` **não** entra em `PAGE_URLS` → o módulo renderiza como **link direto**
  ao basePath (padrão de módulo sem subitens na sidebar).
- `MODULE_META.otb = { title: "OTB", icon: <ícone> }` (ex.: `Target` ou `Wallet`).
- `tenant_config.modules`: chave `otb`, **default false**. `useTenantModules` já lê genérico.
- **Config da Loja**: novo toggle do módulo OTB.
- **Sidebar**: posicionar `/otb` logo abaixo de Início e acima de Criação (mesmo estilo
  do splice que já joga Criação pro topo).
- **Permissão**: `canView("otb")` / `canEdit("otb")`; admins/super bypass.
- **Rota**: `src/routes/_authenticated/otb.index.tsx` (ou `otb.tsx`), gated por módulo.

## 5. Tela `/otb`

Lista de coleções (cards) + editor lateral (Sheet, padrão Desenvolvimento/CAD).

**Editor da coleção:**
- Campos: **Nome, Ano, Mês, Orçamento**.
- Tabela de **Semanas**: marca a semana (1–5) e digita **qtd de modelos** por semana.
- **Painel de orçamento** ao lado (§7): Orçamento vs Previsto vs Real, Poder de venda,
  Saldo e status (dentro/perto/estourou) + quebra por semana.
- Ações: **Salvar** (mantém rascunho) e **Confirmar** (marca `status='confirmada'` e
  dispara a geração/reconciliação de cards — §6).

## 6. Geração + reconciliação de cards

Disparada ao Confirmar (e ao Salvar quando já confirmada). Idempotente por
**(coleção, semana)** — compara alvo `qtd_planejada` × cards existentes daquela
(coleção, semana):

- **alvo > existentes** → insere a diferença de cards em branco.
- **alvo < existentes** → remove **apenas cards "não tocados"** daquela (coleção, semana),
  até a diferença. "Não tocado" = `nome` vazio **e** sem `estilista_id` **e** sem
  `categoria_principal_id` **e** sem fotos **e** sem `tecidos_planejados` (definição de
  card branco). Se não houver brancos suficientes, **avisa e mantém** os preenchidos.
- **nunca** apaga card já preenchido.

Card gerado: `colecao_id`, `colecao` (nome espelhado), `semana`, `mes_id`, `ano_id` da
coleção; `status_planejamento='em_planejamento'`; `versao=1`; `categoria_principal_id`
null; demais campos vazios (padrão do "Vários Cards", sem a exigência de categoria).

Implementação como **RPC transacional** `otb_confirmar(colecao_id)` (SECURITY DEFINER,
tenant-scoped, gate `tenant_module_enabled('otb')`), retornando `{criados, removidos,
mantidos_por_estarem_preenchidos}` pra montar o toast/aviso.

## 7. Agregados & status do orçamento

Reaproveita o que já existe: **`custo_unitario_modelos`** (previsto/real por peça) e
**`preco.ts`** (preço efetivo). Por coleção, sobre os modelos com aquele `colecao_id`:

- **Previsto** = Σ (previsto_por_peça × grade_total).
- **Real** = Σ (real_por_peça × grade_total).
- **Poder de venda** = Σ (preço efetivo × grade_total).
- **Saldo** = orçamento − previsto (e comparação com real). Status por faixa:
  dentro (verde) / perto do teto (amber) / estourou (vermelho).

**RPC `otb_resumo(colecao_id)`** (wrapper + `_core` com `REVOKE EXECUTE FROM anon,
authenticated`; gate `tenant_module_enabled('otb')`) devolve o agregado da coleção +
quebra por semana. Preferida a somar no cliente por correção e escopo de tenant.

## 8. Coleção condicional em Planejamento / Desenvolvimento / Vários Cards

Gate `useTenantModules().isModuleEnabled("otb")`:

- **OTB off** (default): campo **Coleção = texto livre** (`FieldText`, hoje). Nada muda.
- **OTB on**: campo **Coleção = dropdown** das `colecoes` (`FieldSelect`). Grava
  `colecao_id` **e** espelha `colecao` = nome. Ao selecionar, **mês/ano pré-preenchem**
  (editáveis). **Semana** continua selecionável no card.
- Vários Cards / Novo Modelo seguem a mesma regra (avulsos "sobrou orçamento" vinculam a
  uma coleção existente quando OTB on).

## 9. Preenchimento em massa no Planejamento (sempre disponível)

Ferramenta pra preencher rápido os cards brancos gerados pelo OTB (mas útil em geral).

- **Modo de seleção**: botão "Selecionar" na barra revela checkboxes nos cards;
  "selecionar todos" respeita os filtros atuais; contador de selecionados.
- **"Definir em massa"** → diálogo com campos **opcionais** (só aplica o que preencher;
  resto intocado): **Coleção** (dropdown/texto conforme módulo), **Grupo → Categoria →
  Sub 1 → Sub 2** (cascata), **Estilista**, **Linha**, **Origem**, **Semana**, **Mês**,
  **Ano**, **Status**.
- **Grupo** é só cascata (filtra Categoria) — não é coluna do modelo; o que persiste é
  Categoria/Sub. Marcar só Grupo não grava nada.
- Aplica em lote (update dos selecionados). Não gated por OTB (Coleção segue a regra §8).

## 10. Fases (deploy incremental)

1. **Dados + módulo + tela**: migração (`colecoes`, `colecao_semanas`, `modelos.colecao_id`),
   `PAGES_CATALOG`/`MODULE_META`/config/sidebar, rota `/otb` com CRUD de coleção +
   orçamento + semanas + `otb_resumo`.
2. **Geração + reconciliação** de cards (`otb_confirmar`) + toast de resultado.
3. **Coleção condicional** (dropdown gated) em Planejamento/Desenvolvimento/Vários Cards
   + importar coleções existentes.
4. **Preenchimento em massa** no Planejamento.

## 11. Testes

- Integração transacional (Vitest, txn revertida):
  - `otb_confirmar`: aumentar → cria diferença; diminuir → remove só brancos; não apaga
    preenchido; idempotência ao reconfirmar.
  - `otb_resumo`: agrega previsto/real/poder de venda coerente com `custo_unitario_modelos`
    e grade; escopo de tenant.
  - Gate de módulo/permissão (`_core` revogado de anon/authenticated).
- Build + `tsc --noEmit` (build não roda tsc).

## 12. Riscos / invariantes a respeitar

- **Aditivo**: não dropar `modelos.colecao`; front antigo no ar ainda a lê/escreve.
- **UNIQUE só composta** em `colecoes`/`colecao_semanas` (nunca em coluna única embedada).
- **RPC `_core`**: `REVOKE EXECUTE FROM anon, authenticated` (invariante 9).
- **Reconciliação nunca destrutiva** de trabalho do usuário (só remove card branco).
- **Sem OC no cálculo** (valor usado, não compra) — evita dupla contagem com estoque.
- Índice plano em `modelos.colecao_id` (FK embedada sem UNIQUE → seq scan sem índice).

## 13. Fora de escopo (agora)

- Atrelar OCs à coleção (orçamento de compra clássico) — decidido contra.
- Orçamento por semana/categoria — orçamento é 1 número por coleção.
- Custo estimado digitado — usa previsto/real do sistema.
- OU/negação nas condições; qualquer coisa não listada acima.
