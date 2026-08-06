# MO por serviço + toggle de serviços — Design (aprovado)

**Objetivo:** a Mão de Obra (MO) do modelo deixa de ser um valor único e vira **um valor por serviço**, cada um **aprovado/reprovado individualmente** no Planejamento de Produto, refletido no resumo do PCP. Em paralelo, os serviços cadastrados (categorias de serviço) ganham um **toggle de habilitação** — para desligar os fixos (Corte, Oficina) que não são obrigatórios.

## Contexto atual (verificado)

- **Serviços = `categorias_terceirizado`** (id, tenant_id, nome, `etapa` ∈ {ate_costura, pos_costura}, ordem). São os botões "Categorias do Serviço" no PCP (Corte, Oficina, Bordado, PL, Entretela…). Corte/Oficina são semeados e hoje não-excluíveis ("fixos").
- **MO hoje = valor único:** `modelos.custo_simulado` (jsonb, campo `mao_obra` R$) + `modelos.custo_terceirizados_previsto`; aprovação única `modelos.custo_terceirizados_aprovado` (bool, UI trata como 3 estados), `observacoes_mao_obra`, `motivo_reprovacao_mao_obra`.
- **Aprovação hoje:** feita no card do Planejamento (`criacao.planejamento.tsx`, save ~l.241), gated pela permissão `producao_servico_aprovacao` via trigger `trg_enforce_maodeobra_aprovacao` (espelha `user_can_edit`).
- **Consumidores do flag único:** gate do `lancar_modelo` (CQ + MO aprovada — invariante #8); condição de kanban `servico_aprovado` = `coalesce(custo_terceirizados_aprovado,false)` (migração `20260722121000`); `custo_unitario_modelos.mao_obra_previsto`; badges "Custo aprovado/reprovado" nas listas de Dev/Plan.Tecido; resumo do PCP (card "MO Aprovada" = Σ blocos reais, `pcp.servicos.$modeloId.tsx`).

## 1. Modelo de dados

### 1a. Toggle de serviço (Parte B)
- `ALTER TABLE categorias_terceirizado ADD COLUMN ativo boolean NOT NULL DEFAULT true;` (idempotente).
- **Desabilitado = soft-hide:** não aparece na seleção de serviços do Planejamento nem nos botões/abas do PCP para NOVOS usos. Modelos que já têm MO/bloco naquele serviço continuam exibindo (esmaecido, editável), não quebram. Reabilitar restaura. (Mesmo padrão de "loja desativada" da feature de direcionamento.)
- Todos os serviços ganham o toggle; o valor importa sobretudo para os fixos (Corte/Oficina), que não dão para excluir.

### 1b. MO por serviço (Parte A)
- Tabela nova `modelo_servico_mo`:
  - `id uuid pk`, `tenant_id uuid` (RLS padrão), `modelo_id uuid FK modelos ON DELETE CASCADE`, `categoria_terceirizado_id uuid NULL FK categorias_terceirizado ON DELETE RESTRICT`, `valor numeric NOT NULL DEFAULT 0`, `aprovado boolean NULL` (null=pendente / true / false), `motivo_reprovacao text`, `observacoes text`, `created_at`, `updated_at`.
  - `categoria_terceirizado_id IS NULL` = linha **"MO Geral (legado)"** (só nasce na migração).
  - `UNIQUE (modelo_id, categoria_terceirizado_id)` + **índice parcial** `(modelo_id) WHERE categoria_terceirizado_id IS NULL` (no máx. 1 legado por modelo).
  - RLS por tenant; escrita de VALOR livre (planejador); a mudança de `aprovado` é gated pela permissão `producao_servico_aprovacao` (trigger por linha, espelho do `trg_enforce_maodeobra_aprovacao`).

## 2. Planejamento de Produto

Na seção de Custos/MO (`criacao.planejamento.tsx`), o campo único de MO vira **editor por serviço**:
- O planejador **adiciona** serviços a partir de um dropdown que lista só os `categorias_terceirizado` **habilitados** (`ativo=true`), escondendo os já adicionados.
- Cada linha: nome do serviço · campo R$ (valor) · estado da aprovação (badge pendente/aprovado/reprovado) · **botões Aprovar/Reprovar** (reprovar abre Dialog exigindo `motivo_reprovacao`, padrão atual) · remover.
- **Aprovação por serviço** é o botão de cada linha; gated pela permissão `producao_servico_aprovacao` (o front esconde, o trigger garante).
- Obs geral de MO (`observacoes_mao_obra`) continua no modelo; o motivo de reprovação passa a ser **por serviço** (`modelo_servico_mo.motivo_reprovacao`).
- Persistência via RPC(s) dedicadas (salvar valores / aprovar-reprovar por linha), diff por `categoria_terceirizado_id`, no padrão atômico do repo.

## 3. Gate e rollup (compatibilidade sem reescrever consumidores)

- `modelos.custo_terceirizados_aprovado` vira **DERIVADO por trigger** sobre `modelo_servico_mo`:
  **`liberada = NOT EXISTS(linha do modelo com aprovado IS DISTINCT FROM true)`** — ou seja, todos os serviços selecionados aprovados; **sem serviço = liberada** (passa).
- Trigger `AFTER INSERT/UPDATE/DELETE` em `modelo_servico_mo` recomputa o flag do modelo. Assim `lancar_modelo`, a condição de kanban `servico_aprovado`, os dashboards e os badges seguem lendo `custo_terceirizados_aprovado` sem mudança.
- `custo_unitario_modelos.mao_obra_previsto` passa a somar `modelo_servico_mo.valor` (previsto). `mao_obra_real` mantém a semântica atual (blocos executados).
- **Consequência assumida:** modelo que hoje tem flag `false` mas nunca teve MO planejada passa a "liberado" (nada a aprovar) — coerente com "sem serviço = passa". Modelos com MO/aprovação atuais são preservados pela migração (§5).

## 4. Resumo do PCP

Card **MO Aprovada** (`pcp.servicos.$modeloId.tsx`, gated `producao_terceirizados:precos`) passa a mostrar a **MO planejada aprovada**: Σ de `modelo_servico_mo.valor` das linhas `aprovado=true`, com o **detalhe por serviço** (tooltip/expansão: serviço → valor → estado). O card "Custo real (c/ serviço) / peça" (blocos executados) permanece separado e inalterado.

## 5. Migração (preserva produção)

Migração em BEGIN/COMMIT, idempotente:
- Para cada modelo com `custo_simulado->>'mao_obra' > 0` OU `custo_terceirizados_previsto > 0` OU `custo_terceirizados_aprovado = true`: inserir **uma** linha `modelo_servico_mo` com `categoria_terceirizado_id = NULL` ("Geral (legado)"), `valor` = o lump (mao_obra ou previsto), `aprovado` = o estado atual do modelo (mapear o bool atual; se a coluna é NOT NULL default false, preservar exatamente).
- Após criar as linhas, instalar o trigger de rollup e recomputar `custo_terceirizados_aprovado` para todos (converge ao mesmo valor para os migrados; vira `true` para os sem-MO).
- A linha legado é substituída quando o planejador adiciona serviços reais (o editor oferece "migrar/limpar o legado").
- Colunas antigas (`custo_simulado.mao_obra`, `custo_terceirizados_previsto`, `motivo_reprovacao_mao_obra`) ficam **inertes** após a virada (não dropar agora; rodada destrutiva futura). `observacoes_mao_obra` segue vivo (obs geral).

## Segurança / invariantes

- RLS por tenant na tabela nova; trigger de aprovação gated por `producao_servico_aprovacao` (invariante #12).
- RPCs wrapper+core com REVOKE dos três no core (invariante #9) onde houver `_core`.
- FK `categoria_terceirizado_id` = RESTRICT (não apagar serviço com MO); toggle desabilita em vez de excluir (§1a).
- Migração destrutiva-nenhuma nesta fase; tudo aditivo + backfill.

## Testes

- Integração transacional: aprovar todas as linhas → flag do modelo `true`; uma reprovada/pendente → `false`; modelo sem linha → `true`; aprovar sem permissão → RAISE; migração de um modelo com lump+flag → 1 linha legado com valor+estado idênticos; toggle desabilita e o serviço some da seleção mas linha histórica persiste.
- Unit: helper de rollup (liberada) e Σ aprovada (puro), se extraído.

## Fora de escopo (YAGNI)

Aprovação em lote de vários modelos; histórico de alterações de MO; dropar as colunas legadas; MO por variante/tamanho; integração com Financeiro (a MO real já entra por bloco/serviço como hoje).
