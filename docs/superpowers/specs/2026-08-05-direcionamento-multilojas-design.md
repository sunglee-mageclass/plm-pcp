# Direcionamento multi-lojas — Design (aprovado: opção A)

**Objetivo:** o Direcionamento deixa de ser o par fixo E-commerce (digitado) + Loja Física (derivada) e vira **N linhas digitáveis, uma por loja cadastrada**. O Confirmar continua garantindo no servidor que **Σ direcionado por tamanho = grade real** (decisão do dono: bloqueia, com alerta vivo enquanto digita).

## 1. Cadastro de lojas

- Tabela nova `lojas_direcionamento`: `id uuid pk`, `tenant_id` (RLS padrão), `nome text not null`, `ativo boolean default true`, `is_default boolean default false`, `ordem int`, `created_at`. UNIQUE (tenant_id, nome).
- Seed por loja (na migração, para tenants existentes; e no `reset_loja`/criação de tenant): **"E-commerce"** (`is_default=true`, ordem 1) e **"Loja Física"** (ordem 2). Renomeáveis; default não-excluível; loja com linhas de direcionamento não pode ser excluída (RPC com guarda, padrão `excluir_tecido`), só desativada.
- UI: nova página `cadastro.lojas.tsx` ("Lojas"), padrão attribute-tab (lista + novo Dialog + editar Sheet), permissão nova `cadastro_lojas` no catálogo.
- Loja desativada: some de direcionamentos NOVOS; linhas históricas continuam exibidas (rótulo esmaecido).

## 2. Modelo de dados do direcionamento

- Tabela nova `direcionamento_lojas`: `id`, `tenant_id`, `cad_id fk cads`, `loja_id fk lojas_direcionamento (NO ACTION)`, `grades jsonb` ({tamanho: qtd}), `created_at/updated_at`. UNIQUE (cad_id, loja_id). Índice por cad_id.
- As colunas `cad_grades.grades_ecommerce`/`grades_loja_fisica` (nomes reais a confirmar no schema) ficam **inertes** (não dropar agora — rodada destrutiva futura), com **backfill**: para todo cad com direcionamento existente, criar linhas `direcionamento_lojas` E-commerce ← ecommerce e Loja Física ← loja_fisica. Migração em BEGIN/COMMIT, idempotente.

## 3. RPCs (substituem o miolo, preservando o desenho wrapper+core do invariante #10)

- `_salvar_direcionamento_core` v2: recebe `_cad_id` + `_linhas jsonb` ([{loja_id, grades}]). Continua lendo a grade real AUTORITATIVA de `cad_grades.grades_reais` (ignora totais do cliente). **Rascunho** (`salvar_direcionamento`): aceita qualquer soma ≤/≥; grava as linhas (diff por loja_id). **Confirmar** (`confirmar_direcionamento`): RAISE se, para algum tamanho, Σ linhas ≠ real (mensagem PT com tamanho e diferença); atômico com `cad.direcionamento_status='separado'` (como hoje). Guardas: loja pertence ao tenant e está ativa (novas linhas), EXECUTE revogado no core dos TRÊS (invariante #9).
- Trigger `trg_rebaixa_direcionamento_grade` (grade real mudou → rebaixa 'separado'→'pendente' + #Erro): mantido como está — ele olha status, não o split.

## 4. UI do Direcionamento (`expedicao.direcionamento.$modeloId.tsx`)

- Uma linha por loja ativa (E-commerce primeiro, depois `ordem`), TODAS digitáveis por tamanho (inputs numéricos inteiros ≥ 0).
- Rodapé vivo por tamanho: `Σ direcionado / grade real` — verde quando bate; âmbar mostrando **falta (−n)** ou **sobra (+n)** por tamanho enquanto não bate.
- Confirmar desabilitado com motivo ("Falta direcionar 4 peças no tamanho M") enquanto a soma não fecha; Salvar (rascunho) sempre disponível.
- Cads históricos confirmados aparecem com as linhas migradas (E-commerce/Loja Física) — leitura idêntica ao novo modelo.
- 2º lote: regra atual preservada (grade real já desconta o 1º lote; nada muda).

## 5. Testes

- Integração transacional (padrão `tests/README.md`): confirmar com soma certa passa; soma com falta/sobra por tamanho dá RAISE; rascunho parcial grava; loja de outro tenant RAISE; backfill = leitura idêntica ao legado num cad confirmado.
- Unit: helper puro de diferença por tamanho (falta/sobra) usado pelo rodapé.

## Fora de escopo (YAGNI)

Romaneio/impressão por loja; metas por loja; integração com Ordem de Saída; dropar as colunas legadas (rodada destrutiva futura, com `consumo_por_oc` etc.).
