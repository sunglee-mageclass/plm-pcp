# SKU automático — F3.5a: banco + Cadastro › Atributos + Config da Loja — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o banco e os cadastros PRONTOS para o SKU automático (spec §4.1, §4.2, §4.4 e a parte F3.5a do §4.3): siglas SKU em Cor base, Cor apelido e em cada lado dos pares da Grade de Tamanhos; o "Formato do SKU" na Config da Loja, com prévia ao vivo; `modelos.tamanho_tipo` (e o do produto comprado antes do espelho); a tabela `modelo_skus`; as RPCs `gerar_skus_modelo` / `salvar_sku_manual` / `skus_modelo` no padrão wrapper + `_core`; e o espelho TS `montarSku`/`parseTamanho` casado com o SQL por teste anti-drift. A seção "REF e SKUs" do Planejamento e o "Tamanho em" nos cards ficam para a F3.5b (esboço no §10).

**Architecture:** O SKU é GERADO e GRAVADO no servidor (fonte única). A regra mora em funções SQL PURAS (`_sku_*`, IMMUTABLE) com espelho TS PURO (`src/lib/tamanho.ts` + `src/lib/sku-montar.ts`), e o MESMO arquivo de casos (`tests/fixtures/sku-casos.ts`) roda nos dois lados (unit × integração na cópia). O cálculo por modelo (`_skus_modelo_calc`) junta variantes (Tecido 1 no interno; variantes do produto no comprado) × tamanhos com quantidade > 0 e chama o resolvedor puro; `_gerar_skus_modelo_core` grava (manual nunca tocado, UNIQUE da loja devolvida como `conflitos[]` em PT) e `_skus_modelo_core` devolve a matriz de leitura que a F3.5b vai mostrar. As siglas são normalizadas no SALVAR por gatilho (Cadastro › Atributos grava direto na tabela). No front, `AttributeTab` ganha um campo de texto genérico (`extraText`), a Grade de Tamanhos ganha o bloco "Siglas no SKU" e a Config ganha o card próprio `FormatoSkuCard` (2 linhas em `configuracoes.tsx`), cada um gravando SÓ a própria coluna.

**Tech Stack:** Vite + React 19 + TypeScript (strict) + TanStack Router/Query v5 + supabase-js; Postgres 17.6 (Supabase próprio; RLS multi-tenant). Testes: Vitest (unit em `tests/unit`, integração em `tests/integration` SÓ na cópia local) e Playwright (QA na cópia, arquivo NÃO versionado).

**Spec:** `docs/superpowers/specs/2026-09-24-sku-automatico-design.md` (commit `a044759`, desenho aprovado pelo dono em 24/set — "siga o plano"). Memórias: `project_sku_automatico`, `project_ref_unificada_configuravel` (lpad TRUNCA), `project_modelo_ref_auto`, `project_variante_cor_apelido`, `project_config_loja`, `reference_banco_local`, `feedback_nunca_ddl_em_producao_teste`, `feedback_nunca_i_migration_em_transacao_teste`, `reference_erros_ptbr`. CLAUDE.md: invariantes #9 (wrapper + `_core`, REVOKE dos TRÊS), #11 (REF automática), #13 (espelho 1:1 do comprado) e "O que NÃO fazer" (UNIQUE composta é segura; nunca UNIQUE em coluna única embedada). Planos-modelo: `2026-09-22-kanban-automatico-f1-banco.md` (migration, inverso, runbook v2) e `2026-09-24-planejamento-unificado-f34-comprado.md` (Task 0, QA na cópia com guarda invertida, snapshot antes do merge).

## Global Constraints

**Repositório, worktree e ordem**
- Worktree própria `/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a`, branch `f35a/sku-banco-cadastros`, criada do HEAD de `feature/plan-tecido-a1` no início da Task 0 (o sha fica em `.superpowers/f35a/BASE`). Caminhos relativos neste plano = raiz da worktree.
- A F3.5a roda EM PARALELO com a F3.4 (não tocam os mesmos arquivos — §4.2). Ordem de produção (dono): **F1 → Aviso Global (`20261001100000`) → Data da Nota de Entrada (`20261002100000`) → F3.5a (`20261003100000`)**. A F3.5a só junta na branch principal DEPOIS da migration dela em produção (Task 12 antes da Task 13): o `:5173` do dono lê/grava produção e o front novo manda `sigla_sku`/`sku_config`/`tamanhos_sku`.
- Se a branch principal andar (F2, F3.1–F3.4) antes do merge: `git rebase --onto feature/plan-tecido-a1 "$(cat .superpowers/f35a/BASE)" f35a/sku-banco-cadastros` (Task 13 Step 2 — regra de rebase no §4.2).
- Commit: `git add -- <SÓ os arquivos NOVOS da task>` + `git commit --only -m "…" -- <todos os arquivos da task>` + `git show --stat HEAD` (o `commit --only` sozinho falha com arquivo não rastreado). Nunca `git add .`/`-A`/`commit -a`; ⛔ **nunca `git stash`** (pilha compartilhada entre worktrees); sem push. Toda mensagem termina com a linha `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` (o executor põe o nome do SEU modelo).
- `src/routeTree.gen.ts` é regerado pelo build: nunca entra em commit (`git checkout -- src/routeTree.gen.ts`).
- zsh: escreva `"${X}:caminho"` (com chaves) — `$X:s…` vira modificador do zsh. Blocos marcados "(bash)" rodam num `/bin/bash`.

**Banco (regras duras)**
- DDL SÓ na CÓPIA LOCAL (`postgresql://postgres:postgres@127.0.0.1:54422/postgres`) e SÓ por dois caminhos: (a) a suíte com `SKU_MIG_TXN=1` (o harness aplica a migration DENTRO da txn revertida do teste, sem `\i`); (b) os scripts `.superpowers/f35a/mig/*.sh` (receita `aplica_v2` do runbook da F1: arquivo inteiro numa mensagem, `lock_timeout` 500 ms + `transaction_timeout` 3 s). **PROIBIDO:** `psql -f`, `\i` de migration em transação de teste (incidente 15/set), probe exploratório fora do harness (incidente 23/set), qualquer DDL/escrita em PRODUÇÃO (`/tmp/dburl.txt`, `*.supabase.co`) — produção é a Task 12, pelo DONO, no Terminal.
- Leitura na cópia: `PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" …` (só SELECT). Produção: só a Task 12 (do DONO) e o snapshot SÓ-LEITURA da Task 13 Step 1.
- Integração: SEMPRE `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres` explícito (sem ele o `db.ts` cai em `/tmp/dburl.txt` = produção — a suíte da F3.5a pula sozinha fora da cópia, mas não confie nisso). A cópia é COMPARTILHADA: antes de rodar, `ps -Ao pid,command | grep -E "[v]itest|[p]laywright"` tem de voltar vazio (um teste/QA por vez; o `SKU_MIG_TXN=1` segura AccessExclusive em `tenant_config`/`modelos`/`cores` durante cada teste).
- A migration é UMA (`supabase/migrations/20261003100000_sku_automatico.sql`), montada em 3 partes pelas Tasks 3–5 (A → C → B no arquivo final; marcadores fixos). Inverso ÚNICO `supabase/rollback/20261003100000_sku_automatico_down.sql` (Task 3), DESTRUTIVO, pede `SET LOCAL app.confirmo_apagar_skus = 'sim'` quando há dado.
- ⚠️ **O SQL deste plano NÃO foi executado pelo planejador** (fase de plano = só leitura, nem na cópia). O TS foi executado (§9). Erro de SQL na cópia ⇒ corrigir o MÍNIMO, registrar em `.superpowers/f35a/desvios.md` (erro literal, causa, correção) e a revisão Opus da task confere; a REGRA (fixtures/espelho TS) só muda com o controlador.
- `src/integrations/supabase/types.ts` NÃO é regenerado (precisa `supabase login`): colunas/tabela/RPCs novas são lidas com `select("*")` + `as any`, padrão do repo.

**Gates (todo commit)** — `bash .superpowers/f35a/gates.sh` → `GATES F3.5a: ok` (código 0): tsc (o build NÃO faz type-check), build, unit com as MESMAS falhas da linha de base, escopo = só arquivos do mapa §4, Dev intocado desde o save point, `configuracoes.tsx` com exatamente +2/-0 linhas e `tests/integration/mig-txn.ts` idêntico ao da F3.1. Gate falhou = PARE, não commitar.

**Intocáveis:** tudo fora do mapa §4 — em especial `src/components/desenvolvimento/**`, `src/components/planejamento/**` (F3.x), `src/components/configuracoes/FormatoRefCard.tsx`, `src/lib/ref-montar.ts`, `src/lib/erro-mensagem.ts` (a F2 mexe), `src/lib/realtime-invalidation-map.ts` (as queryKeys novas casam pelo prefixo "tenant"), `tests/integration/kanban-auto.test.ts`, `tests/integration/db.ts`, migrations/inversos existentes.

**QA — contra a CÓPIA** — variante do app de teste na porta **`:5180`** (reservada pelo controlador em 24/set na linha `case "$PORTA"` do `criar-variante.sh` — o plano NÃO edita essa linha, só confere); guarda de rede INVERTIDA (qualquer requisição a `*.supabase.co` reprova); nunca tocar `:5173`, `:5188`, nem as variantes `:5181`–`:5187`; nunca junto com outro QA/E2E; nunca `npm run dev` + `VITE_*` (o worker leria o `.env` de produção); derrubar SÓ pelo `descer.sh` da variante; nada de `pkill`/`killall`.

**UI** — `docs/design/ui-padroes.md` §Q (primitivos Button/Input/Select/AlertDialog; sem hex/oklch/hsl solto, sem `.toFixed(`; o anti-drift de UI está ATIVO); textos PT-BR; erros por `mensagemErro(e, "…")`; tema claro de fábrica; ação sensível com AlertDialog; `useUnsavedGuard` + `UnsavedIndicator` em todo bloco com "Salvar".

**Modelos e comunicação** — Sonnet implementa; Opus revisa (§6). Não despachar subagentes dentro de uma task. Avisos ao dono por CHAT (nunca `ExitPlanMode`). As decisões D1–D4 (§2) precisam de resposta ANTES da Task 1; o plano implementa a RECOMENDADA — resposta diferente = aplicar a variante indicada.

---

## 1. Fatos verificados (24/set/2026, só leitura — cópia local e HEAD `a044759`)

| # | Fato (spec §3) | Evidência | Situação |
|---|---|---|---|
| F1 | `cores(id, tenant_id, nome varchar(255), created_at)`, UNIQUE `(tenant_id, nome)`; `cores_apelido(id, tenant_id, nome, cor_base_id NOT NULL, created_at)`; sem sigla; RLS de escrita = `user_can_edit('cadastro_atributos:cores'|'…:cores_apelido')`; gatilho `set_tenant_id_trg` | `\d public.cores`, `\d public.cores_apelido` | ✅ confere |
| F2 | Edição pelo `AttributeTab` genérico (`src/components/attribute-tab.tsx`, 1023 linhas) com `extra`/`extraNumber`/`extraEnum`/`toggleField` — **não existe campo de TEXTO livre** | leitura do arquivo | ➕ a Task 7 cria `extraText` (opt-in; nenhum outro atributo muda) |
| F3 | `tenant_config.tamanhos_grade` jsonb, default `["34|PPP",…,"44|GG"]`; 5 lojas com pares; **Ark Store com itens soltos** `["36","38","40","42","44","PP","P","M","G","GG"]` | SELECT por loja | ✅ confere |
| F4 | ⚠️ `modelo_grades.grades` tem a chave **`"UN"`** (grade única dos Acessórios de revenda/importado — `_pa_grade_variante`, `TAM_ACESSORIO`): 55 células na Ave Rara, e `"UN"` NÃO está em nenhum `tamanhos_grade` ⇒ não teria onde cadastrar a sigla | `jsonb_object_keys` por loja; `src/components/oc-p-acabado/shared.ts:18` | ❗ divergência → **D1** |
| F5 | O split do `|` aparece em **17** arquivos (spec: ~15) | `grep -rln 'split("|")'` | ℹ️ fora de escopo (código novo usa `parseTamanho`) |
| F6 | `modelo_grades` sem `tenant_id`; chave = string inteira ("34|PPP"); valores todos `number` (2979 células) | SELECT | ✅ |
| F7 | `ref_config` (1 loja configurada), `FormatoRefCard` em `admin/configuracoes.tsx:484`; o save da Config é `upsert` com `...cfgRest` montado das chaves de `DEFAULTS` — **coluna nova fora de `DEFAULTS` nunca entra no upsert genérico** (a F2 troca esse save — RP3) | leitura `configuracoes.tsx:84-291` | ✅ o `FormatoSkuCard` grava a própria coluna, fora do `cfg` da página |
| F8 | Gatilhos de REF `trg_modelo_ref_auto`/`trg_pa_ref`/`trg_pi_ref`; `fn_modelo_ref_auto` sai cedo com `ordem_criacao_enviada=false`; `fn_produto_acabado_ref` não mexe com `ref` preenchida | `pg_trigger` + `pg_get_functiondef` | ✅ (os testes criam cards com REF fora do padrão AUTO) |
| F9 | Interno: grade `variante_numero` = `modelo_tecido_variantes.ordem` do Tecido 1 (`tipo='tecido' AND numero=1`) — `_estoque_tecido_core` (join `g.variante_numero = mv.ordem`); `salvar_modelo_bom` APAGA e regrava `modelo_tecido_variantes` (o `id` muda a cada Salvar) | `pg_get_functiondef('_estoque_tecido_core')` | ➕ `variante_key` do interno = `variantes_tecido.id` (estável) — §3 T2 |
| F10 | Revenda/importado: `produto_acabado_variantes`/`produto_importado_variantes(id, tenant_id, produto_*_id, ordem, cor_id, cor_apelido_id, …)`, UNIQUE `(produto, ordem)`; espelho por `produtos_*.modelo_id` (`enforce_unique_fk`); só `produtos_acabados` tem gatilho de loja do espelho (`trg_pa_modelo_tenant`) | `\d` + `pg_trigger` | ➕ o handover do `tamanho_tipo` confere a loja (§3 T11) |
| F11 | ⚠️ **A REF NÃO é única**: 7 grupos / 14 cards com a mesma REF na cópia (legado + réplicas do Plan. Tecido, que mantêm a REF) — a spec §6 diz "impossíveis pela REF única" | `GROUP BY tenant_id, ref HAVING count(*)>1` | ❗ divergência de RISCO (não muda o desenho): o 2º card de cada par recebe `conflitos[]` e pede SKU à mão — **ciência do dono (§2)** |
| F12 | `modgate_*` do módulo `criacao` = RESTRICTIVE só em INSERT/UPDATE/DELETE (`modelos`, `modelo_grades`, `modelo_tecidos`, …; sem SELECT) | `pg_policies` | ✅ `modelo_skus` segue igual |
| F13 | Default privileges do `postgres` em `public`: função nova ganha EXECUTE p/ `anon`/`authenticated`/`service_role` (+ PUBLIC embutido); tabela nova ganha `arwdDxtm` p/ `anon`/`authenticated` | `pg_default_acl` | ➕ REVOKE explícito (funções: dos TRÊS; tabela: tudo de anon, escrita de authenticated) |
| F14 | `user_can_edit`/`user_can_view`: super_admin/admin/tenant_admin passam; senão `_perm_efetiva`. `tenant_module_enabled` = true p/ super_admin; `criacao` ausente = ligado | `pg_get_functiondef` | ✅ `_sku_guarda` |
| F15 | "sku": zero ocorrências em `src/` e `supabase/migrations/`; nenhum objeto do banco com `sku`/`tamanho_tipo` no nome | grep + `pg_proc`/`pg_trigger` | ✅ nomes livres |
| F16 | Cópia local: `458|263` (a F1 aplicada + a coluna da F3.1); `pgrst_ddl_watch` presente (PostgREST recarrega sozinho); ICU `en-US` (`upper('ß')='SS'`, igual ao JS) | `psql` só leitura | ℹ️ o provedor de locale de PRODUÇÃO é conferido no pré-voo (Task 12) |
| F17 | Harness de migration em txn: `tests/integration/mig-txn.ts` existe SÓ nas branches F3.1–F3.4 (idêntico nas 4, sha256 `276f36e67c900d562efb99eff9be3c2327182c31df24921dfb9780e6b573be0c`); o da F1 é local ao `kanban-auto.test.ts`; `exigeBancoLocal()` vem daí | `git show f31/…:tests/integration/mig-txn.ts` | ➕ a F3.5a copia o arquivo BYTE A BYTE (add/add idêntico no merge — §4.2) |
| F18 | `criar-variante.sh`: a linha `case "$PORTA"` JÁ aceita `5180` (reservada pelo controlador, backup `.bak-pre-reserva-portas`) | `grep` | ✅ o QA só confere (Task 10 Step 1) |
| F19 | Usuários comuns (papel `user`) existem na Ave Rara — base do teste de permissão | SELECT `users`/`user_roles` | ✅ |
| F20 | `realtime-invalidation-map`: `tenant_config` casa qualquer queryKey cujo 1º elemento contém "tenant"; `cores`/`cores_apelido` casam `["attr","cores",…]` (lista do `AttributeTab`) | leitura | ✅ sem mudar o mapa |

## 2. Decisões para o dono (responder ANTES da Task 1)

- **D1 — Grade única "UN" dos Acessórios (F4).** Recomendado (implementado): **"UN" sem sigla ⇒ o SKU sai SEM a parte do tamanho** (ex.: `REF00000001AM`); se a loja cadastrar "UN" na grade e der sigla, ela é usada. *Se a resposta for "exigir sigla":* `resolverSku`/`_sku_resolver` passam a devolver `falta {tamanho, UN}` também para "UN" (tirar `&& lado !== TAMANHO_UNICO` / `AND v_lado <> 'UN'`), a fixture 9 de `CASOS_RESOLVER` vira falta, o teste "importado" espera `faltas`, e o bloco "Siglas no SKU" da Grade mostra SEMPRE uma linha fixa "UN (Acessórios)".
- **D2 — "Regerar SKUs" e linhas que saíram da grade.** Recomendado (implementado): **o Regerar APAGA os SKUs AUTOMÁTICOS de variante/tamanho que não estão mais na grade** (variante trocada/removida, tamanho zerado) ANTES de gerar — senão o SKU antigo barra o novo igual (ex.: trocar o tecido do Tecido 1 mantendo as cores); os editados à mão NUNCA saem (ficam como "órfã"); o "Gerar" sem Regerar não apaga nada. *Se "manter tudo":* tirar o bloco `IF _regerar THEN DELETE …` do `_gerar_skus_modelo_core` e o teste "regerar remove as AUTOMÁTICAS…" passa a esperar `removidos: 0` e a linha `orfa`.
- **D3 — Onde fica o "Formato do SKU".** A spec diz "no card do Formato da REF, um bloco". Recomendado (implementado): **um card PRÓPRIO logo ABAIXO do "Formato da REF"**, com o seu botão "Salvar formato do SKU" — o card da REF grava pelo "Salvar" geral da página e misturar dois "Salvar" no mesmo card confunde; e assim `configuracoes.tsx` muda só 2 linhas (conflito mínimo com a F2). *Se "dentro do mesmo card":* o `FormatoRefCard` ganha a prop opcional `children` (renderizada ao fim do `CardContent`, com `border-t`) e a linha `<FormatoSkuCard />` vira filho do `<FormatoRefCard …>` (o `FormatoRefCard.tsx` entra no mapa §4 e o gate do `configuracoes.tsx` passa a `4|1`).
- **D4 — Variante SEM apelido com "Cor apelido" no formato.** Recomendado (implementado): **a parte do apelido some, junto com o separador que a antecede** (ex.: `REF-AM/34`), igual ao exemplo da spec ("1 — Amarelo"); "Falta sigla" só quando o apelido EXISTE e não tem sigla. *Se "exigir apelido":* `resolverSku`/`_sku_resolver` devolvem `falta {cor_apelido, null, null}` ("Falta o apelido na variante") — pede refazer as fixtures 4, 13, 14 e os testes que usam a variante 1 (o planejador refaz o trecho).
- **Ciência (sem decisão) — F11:** hoje há 7 pares de cards com a mesma REF (réplicas e legado). Ao gerar, o 2º card de cada par NÃO grava as linhas repetidas e mostra "SKU … já existe em <card> (REF …)" — resolve-se trocando a REF do card ou editando o SKU à mão. A UNIQUE `(tenant_id, sku)` da spec segue.

## 3. Decisões técnicas (o plano decide; revisão Opus confere)

- **T1 Normalização no servidor por GATILHO** (e não por RPC): Cadastro › Atributos grava `cores`/`cores_apelido` DIRETO pela API (insert/update do `AttributeTab`), e a Grade/Config gravam `tenant_config` direto; só um gatilho cobre todos os caminhos (importação, SQL, telas futuras). O de `tenant_config` é `BEFORE INSERT OR UPDATE OF sku_config, tamanhos_sku` — o upsert genérico da Config não manda essas colunas, então nem dispara. Regra única: `trim(espaço/tab/CR/LF) + upper`, vazia = NULL (`_sku_norm_sigla`), igual à spec; o Formato e o mapa de tamanhos são validados/canonizados com as MESMAS mensagens PT do espelho TS (RAISE P0001 → `mensagemErro` mostra a própria mensagem).
- **T2 `variante_key`** = `variantes_tecido.id` (interno, Tecido 1) ou `produto_*_variantes.id` (comprado) — estáveis; o id de `modelo_tecido_variantes` muda a cada Salvar (F9). Mesmo tecido repetido no Tecido 1: vale a menor `ordem` (DISTINCT ON).
- **T3 Separadores** `{"<a>|<b>": sep}` só entre partes VIZINHAS da lista; o separador ANDA COM A PARTE SEGUINTE — parte ausente na linha some com o separador que a antecede. Até 3 caracteres, sem espaço (senão o SKU sai com espaço — ERP/e-commerce).
- **T4 `parseTamanho` por conteúdo:** "34|PPP" e "PPP|34" dão o mesmo (lado só-dígitos = número); dois números ou duas letras = posicional (esq = número); solto classificado; só o 1º "|" separa.
- **T5 Sem o lado pedido** (solto ou "UN") usa o outro lado — um card "Tamanho em: Letra" com a grade `36, 38` sai com `36`/`38`.
- **T6 3ª RPC `skus_modelo`** (leitura da matriz) + `_skus_modelo_calc`/`_skus_modelo_core` NESTA fase: a F3.5b precisa mostrar "Falta sigla", "conflito", "divergente" e o selo SEM gravar ao abrir o card; com a leitura pronta aqui, a F3.5b fica só front (sem migration) e sem reimplementar a regra no TS.
- **T7 `_sku_guarda(tenant, editar)`** comum aos 3 wrappers: login → módulo `criacao` → loja do modelo (NULL = "Sem permissão", sem vazar existência) → `user_can_edit|view('criacao_planejamento')`. super_admin fura a loja como nos demais wrappers.
- **T8 `salvar_sku_manual(_id, _sku, _rev_base DEFAULT NULL)`** — o `_rev_base` opcional é a trava otimista da linha (P0409, padrão colab); o SKU manual é só APARADO (não vira maiúscula: é o que a pessoa digitou); vazio = "Informe o SKU."
- **T9 `modelo_skus`:** escrita SÓ pelas RPCs DEFINER (`authenticated` fica só com SELECT, RLS por loja); `modgate_*` RESTRICTIVE ins/upd/del iguais aos de `modelo_grades`; `rev` próprio (NÃO sobe `modelos.rev` — gerar SKU não pode dar P0409 no Sheet aberto); sem Realtime/auditoria nesta fase (a F3.5b decide).
- **T10** `pg_advisory_xact_lock` por modelo na geração (duas abas no mesmo card esperam em fila); conflito de UNIQUE capturado por linha (sub-bloco `EXCEPTION`) — a geração nunca derruba o resto.
- **T11 Handover do `tamanho_tipo`** por GATILHO nos produtos (`BEFORE INSERT OR UPDATE OF modelo_id, tamanho_tipo`): com espelho, o valor passa ao modelo (só se o modelo não tem) e SAI do produto — fonte única; exige a mesma loja. Assim nenhuma função existente (`_criar_card_*`) é redefinida: **a migration não altera NENHUMA função pré-existente** (conferido por md5 no ensaio e em produção).
- **T12 Front tolerante:** o `AttributeTab` só manda `sigla_sku` quando MUDOU (editar o nome de uma cor não depende da coluna existir) — defesa se a ordem "produção antes do merge" falhar.
- **T13 Gravação por coluna (RP3):** `FormatoSkuCard` faz `update({sku_config})` depois de conferir que o valor no banco ainda é o que a tela carregou (senão "Outra pessoa mudou…"); o bloco de siglas da Grade relê o mapa ATUAL e aplica só as chaves que o usuário mudou (`mesclarSiglasTamanho`).
- **T14 Harness** = `tests/integration/mig-txn.ts` da F3.1, cópia BYTE A BYTE (gate); `aplica_v2`/`espera`/`ativ_vazio`/`com_travas` = extraídos por awk do runbook v2 da F1 (hash conferido) — nada reescrito à mão.
- **T15** `tamanho_padrao` ausente = `"letra"`; sem `sku_config` (ou sem partes) = a loja não gera SKU (`status: 'sem_formato'`).
- **T16** `NOTIFY pgrst, 'reload schema'` dentro da txn (entregue no COMMIT; o `pgrst_ddl_watch` também recarrega).

## 4. Mapa de arquivos

| Arquivo | Ação | Task |
|---|---|---|
| `src/lib/tamanho.ts` | criar — `parseTamanho`, `ladoTamanho`, `aparar`, `ehNumeroTamanho` | 1 |
| `src/lib/sku-montar.ts` | criar — tipos, `normalizarSigla`, `normalizarSkuConfig`, `normalizarTamanhosSku`, `montarSku`, `resolverSku`, `textoFalta`, `canonico`, `ladosDaGrade`, `mesclarSiglasTamanho` | 1 |
| `tests/fixtures/sku-casos.ts` | criar — casos do anti-drift (TS e SQL) | 1 |
| `tests/unit/sku-montar.test.ts` | criar | 1 |
| `tests/integration/mig-txn.ts` | criar — CÓPIA byte a byte do da F3.1 | 2 |
| `tests/integration/sku-automatico.test.ts` | criar — 24 testes (só na cópia) | 2 |
| `supabase/migrations/20261003100000_sku_automatico.sql` | criar (A) e completar (B, C) | 3, 4, 5 |
| `supabase/rollback/20261003100000_sku_automatico_down.sql` | criar (inteiro) | 3 |
| `src/components/attribute-tab.tsx` | modificar — `extraText` | 7 |
| `src/routes/_authenticated/cadastro.atributos.tsx` | modificar — "Sigla SKU" em Cor base/Cor apelido | 7 |
| `src/components/shared/GradeTamanhosCard.tsx` | substituir — + bloco "Siglas no SKU" | 8 |
| `src/components/configuracoes/FormatoSkuCard.tsx` | criar | 9 |
| `src/routes/_authenticated/admin/configuracoes.tsx` | modificar — +2 linhas (import + `<FormatoSkuCard />`) | 9 |
| `tests/e2e/f35a-qa.spec.ts` | criar, **NÃO versionar** (apagado na Task 13) | 10 |
| `.superpowers/f35a/**` (fora do git) | `BASE`, `regras.md`, `arqs-f35a.txt`, `gates.sh`, `unit-fail-base.txt`, `mig/{aplica,ensaio-local,copia-qa,producao}.sh`, `desvios.md`, logs, QA | 0, 6, 10, 12 |

### 4.1 Interfaces produzidas (a F3.5b consome)

- **RPCs:** `skus_modelo(_modelo_id uuid) → jsonb` (ler — `criacao_planejamento` ver) · `gerar_skus_modelo(_modelo_id uuid, _regerar boolean DEFAULT false) → jsonb` · `salvar_sku_manual(_id uuid, _sku text, _rev_base integer DEFAULT NULL) → jsonb` (editar — `criacao_planejamento` editar). Resposta de `skus_modelo` (e de `gerar_…`, que acrescenta `criados`, `atualizados`, `removidos`, `conflitos[]`): `{ status: 'ok'|'sem_formato'|'aguardando_ref', tamanho_tipo, tamanho_tipo_card, faltas: [{atributo, id, nome}], linhas: [{ variante_key, variante_ordem, cor_nome, apelido_nome, tamanho_key, tamanho_ordem, id, sku, manual, rev, sku_previsto, faltas, conflito_com, estado }] }`, `estado ∈ ok · manual · falta · pendente · divergente · conflito · vazio · orfa` (sem formato/REF: `salvo`/`manual`). `conflitos[]`: `{ variante_key, tamanho_key, sku, com_modelo_id, com_nome, com_ref, mensagem }`. Erros: 42501 (login/módulo/loja/permissão), P0001 (PT), P0409 (rev).
- **Dados:** `modelos.tamanho_tipo` (`letra|numero|NULL`=padrão da loja) · `produtos_acabados.tamanho_tipo` / `produtos_importados.tamanho_tipo` (só ANTES do espelho — o gatilho passa ao modelo) · `tenant_config.sku_config` (canônico) · `tenant_config.tamanhos_sku` · `cores.sigla_sku` · `cores_apelido.sigla_sku` · `modelo_skus` (SELECT por loja).
- **TS:** `parseTamanho`, `ladoTamanho`, `TamanhoTipo` (`@/lib/tamanho`); `SkuConfig`, `SkuFalta`, `SkuParte`, `SKU_PARTE_LABEL`, `TAMANHO_UNICO`, `normalizarSkuConfig`, `resolverSku`, `textoFalta`, `canonico` (`@/lib/sku-montar`); `AttributeTabConfig.extraText`; queryKeys `["tenant-config-sku", tenantId]`, `["tenant-config-tamanhos-sku", tenantId]`, `["tenant-sku-exemplo", tenantId]`.

### 4.2 Sobreposição com as frentes abertas e regra de rebase

Levantado em 24/set (`git diff --name-only feature/plan-tecido-a1...<branch>`), refeito na Task 0 Step 2:

| Frente | Arquivos em comum com a F3.5a | Efeito |
|---|---|---|
| `f2/kanban-telas` | `src/routes/_authenticated/admin/configuracoes.tsx` (a F2 reescreve o save — RP3 — e acrescenta imports logo abaixo do `FormatoRefCard` e trechos antes/depois do `<FormatoRefCard …/>`) | A F3.5a só insere 2 linhas: o import DEPOIS de `import { PAGES_CATALOG }…` (longe dos imports da F2) e `<FormatoSkuCard />` logo depois do `/>` do `FormatoRefCard` (entre os dois trechos da F2). **Simulado com `git merge-file` (base `a044759` × F3.5a × F2): 0 conflito.** |
| `f31`, `f32`, `f33`, `f34` | `tests/integration/mig-txn.ts` (as 4 têm o MESMO arquivo, criado pela F3.1) | A F3.5a cria a MESMA cópia (gate de igualdade) ⇒ add/add idêntico, sem conflito. (O Aviso Global preferiu um harness local ao próprio teste; aqui a cópia idêntica evita ter um 3º harness — decisão T14.) |
| Aviso Global / Data da Nota (planos commitados em 24/set, ainda sem branch) | nenhum arquivo (Aviso: `app-sidebar.tsx`, harness local; Nota: OCs) | só a ORDEM de produção (Global Constraints). |
| todas | nenhum outro arquivo | — |

**Regra de rebase:** a F3.5a nasce do HEAD atual de `feature/plan-tecido-a1` (BASE). Se a F2 (ou qualquer F3.x) juntar antes, a Task 13 Step 2 faz `git rebase --onto feature/plan-tecido-a1 "$(cat .superpowers/f35a/BASE)" f35a/sku-banco-cadastros`. Conflito em `configuracoes.tsx`: ficar com o texto da principal e reaplicar SÓ a mesma intenção (import + `<FormatoSkuCard />` logo abaixo do `<FormatoRefCard …/>`), gate `+2/-0` de novo. Conflito em `mig-txn.ts`: ficar com o da principal (é a F3.1; o gate compara com ele). Depois do rebase: gates + a suíte de integração (`SKU_MIG_TXN=1`) + re-revisão Opus de `configuracoes.tsx`.

## 5. Ordem das tasks

Task 0 (pré-voo) → 1 (TS puro) → 2 (suíte vermelha) → 3 (SQL parte A + inverso) → 4 (parte B) → 5 (parte C; suíte inteira verde) → 6 (ensaio na cópia) → 7 + 8 (cadastros) → 9 (Config) → 10 (QA na cópia, `:5180`) → 11 (portões: G-commit, G-migration, OK do dono) → 12 (PRODUÇÃO, pelo dono — depois da F1, do Aviso e da Nota) → 13 (snapshot só-leitura, rebase, merge, cópia pós-merge, smoke). As Tasks 7–9 não dependem das 3–6 (podem andar enquanto a revisão de banco roda), mas o QA (10) precisa de tudo.

## 6. Revisão (política SDD)

| Task | Revisão |
|---|---|
| 1 | **Individual Opus** (curta) — espelho TS e fixtures são a fonte do anti-drift |
| 2 | **Individual Opus** — suíte + harness (cópia da F3.1), guarda da cópia local |
| 3, 4, 5 | **Individual Opus CADA** (banco): SQL × espelho TS, ACL #9, idempotência, locks, mensagens PT, `desvios.md` |
| 6 | **Individual Opus** sobre o log do ensaio (+ controlador) |
| 7 + 8 | **Lote Opus** (cadastros: `extraText`, siglas da grade, guarda de não salvo, RP3) |
| 9 | **Individual Opus** (Config: RP3, conflito, prévia, 2 linhas no `configuracoes.tsx`) |
| 10–13 | controlador + guardião (QA, G-commit, G-migration, produção, merge) |

Checklist de toda revisão = `code-reviewer` + guardião: tenant/RLS, invariante #9 (REVOKE dos TRÊS, conferido por `has_function_privilege`), UNIQUE só composta, nenhuma função pré-existente redefinida, `mensagemErro`, queryKeys próprias com "tenant", guarda de não salvo, nenhum `\i`/`psql -f`, nenhuma escrita fora da cópia, escopo = §4.

---

## Task 0: Pré-voo (sem commit)

**Files:** nenhum no git (worktree + `.superpowers/f35a/`).

- [ ] **Step 1: Worktree a partir do HEAD de `feature/plan-tecido-a1`**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
BASE="$(git rev-parse feature/plan-tecido-a1)"
git log --oneline -1 "$BASE"
git merge-base --is-ancestor a044759 "$BASE" && echo "spec da F3.5 (a044759) na base: ok"
test ! -e .claude/worktrees/sku-f35a && echo "pasta da worktree livre: ok"
git rev-parse --verify -q f35a/sku-banco-cadastros >/dev/null && echo "BRANCH JÁ EXISTE — PARE" || echo "branch livre: ok"
git worktree add ".claude/worktrees/sku-f35a" -b f35a/sku-banco-cadastros "$BASE"
cd ".claude/worktrees/sku-f35a"
mkdir -p .superpowers/f35a/mig .superpowers/f35a/logs .superpowers/f35a/qa
echo "$BASE" > .superpowers/f35a/BASE
cp "/Users/sunglee/PLM + Criação/plm-pcp/.env" .env
npm ci --silent
for f in src/lib/tamanho.ts src/lib/sku-montar.ts src/components/configuracoes/FormatoSkuCard.tsx tests/fixtures/sku-casos.ts \
         tests/unit/sku-montar.test.ts tests/integration/sku-automatico.test.ts tests/integration/mig-txn.ts \
         supabase/migrations/20261003100000_sku_automatico.sql supabase/rollback/20261003100000_sku_automatico_down.sql; do
  test -e "$f" && echo "JÁ EXISTE — PARE: $f"; done; echo "f35a-ausente-checado"
git show "${BASE}:src/components/shared/GradeTamanhosCard.tsx" | shasum -a 256 | cut -c1-64
```

Expected: `spec … na base: ok`, `pasta … livre: ok`, `branch livre: ok`, a worktree criada, nenhum "JÁ EXISTE", e o sha `e68a965038ea1cce426737a567152be35cd4c92b290430273ea85d6714254049` (o `GradeTamanhosCard.tsx` é SUBSTITUÍDO na Task 8 — outro sha = alguém mexeu nele: PARE e reporte). Se `feature/plan-tecido-a1` tiver andado desde `a044759`, tudo bem — o BASE é o HEAD dela na hora; as âncoras do Step 3 dizem se algo mudou.

- [ ] **Step 2: Sobreposição com as frentes abertas (registro da regra de rebase)**

Criar `.superpowers/f35a/arqs-f35a.txt` (caminhos EXATOS que a F3.5a pode mudar — o `gates.sh` usa):

```text
src/lib/tamanho.ts
src/lib/sku-montar.ts
tests/fixtures/sku-casos.ts
tests/unit/sku-montar.test.ts
tests/integration/mig-txn.ts
tests/integration/sku-automatico.test.ts
supabase/migrations/20261003100000_sku_automatico.sql
supabase/rollback/20261003100000_sku_automatico_down.sql
src/components/attribute-tab.tsx
src/routes/_authenticated/cadastro.atributos.tsx
src/components/shared/GradeTamanhosCard.tsx
src/components/configuracoes/FormatoSkuCard.tsx
src/routes/_authenticated/admin/configuracoes.tsx
tests/e2e/f35a-qa.spec.ts
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
{ for b in f2/kanban-telas f31/planejamento-campos f32/ficha-bom f33/cad-acoes f34/comprado; do
    git rev-parse --verify -q "$b" >/dev/null || { echo "== $b: (branch não existe mais — já juntou?)"; continue; }
    echo "== $b ($(git rev-parse --short "$b")): $(git diff --name-only "feature/plan-tecido-a1...$b" | wc -l | tr -d ' ') arquivos"
    git diff --name-only "feature/plan-tecido-a1...$b" | grep -x -F -f .superpowers/f35a/arqs-f35a.txt | sed 's/^/   EM COMUM: /'
  done; } | tee .superpowers/f35a/sobreposicao.txt
```

Expected (24/set): `f2/kanban-telas` → `EM COMUM: src/routes/_authenticated/admin/configuracoes.tsx`; `f31`…`f34` → `EM COMUM: tests/integration/mig-txn.ts`; nada mais. Outro arquivo em comum ⇒ PARE e reporte ao controlador (a regra do §4.2 não o cobre).

- [ ] **Step 3: Âncoras (texto que as Tasks 7 e 9 editam) no BASE**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
B="$(cat .superpowers/f35a/BASE)"
conta() { printf '%s  →  %s :: %s\n' "$(git show "${B}:$1" | grep -cF -- "$2")" "$(basename "$1")" "$2"; }
A=src/components/attribute-tab.tsx
conta $A '  extraNumber?: { field: string; label: string; placeholder?: string; step?: string };'
conta $A '  const [newExtraNum, setNewExtraNum] = useState<string>("");'
conta $A '(config.extraNumber ? 1 : 0) + (config.extraEnum ? 1 : 0) + (config.toggleField ? 1 : 0);'
conta $A '  const [editNum, setEditNum] = useState("");'
conta $A '  const createDirty = createOpen && (newName !== "" || newExtra !== "" || newExtraNum !== "" || newEnum !== "");'
conta $A '      setNewExtraNum("");'
conta $A '      if (config.extraEnum) payload[config.extraEnum.field] = editEnum || config.extraEnum.options[0].value;'
conta $A '    setEditNum(config.extraNumber && row[config.extraNumber.field] != null ? String(row[config.extraNumber.field]) : "");'
conta $A '  const [sheetNum, setSheetNum] = useState("");'
conta $A '    setSheetNum(config.extraNumber && row[config.extraNumber.field] != null ? String(row[config.extraNumber.field]) : "");'
conta $A '    (!!config.extraNumber && sheetNum !== (sheetRow[config.extraNumber.field] != null ? String(sheetRow[config.extraNumber.field]) : "")) ||'
conta $A '      if (config.extraEnum) payload[config.extraEnum.field] = sheetEnum || config.extraEnum.options[0].value;'
conta $A '                <SortHead label={config.extraEnum.label} sortKey={config.extraEnum.field} sortState={sortState} className="w-44" />'
conta $A '                const sublinha = subParts.join(" · ");'
conta $A '                        <Select value={editEnum} onValueChange={setEditEnum} disabled={readOnly}>'
conta $A '                  onChange={(e) => setNewExtraNum(e.target.value)}'
conta $A '                    value={sheetNum} onChange={(e) => setSheetNum(e.target.value)}'
conta src/routes/_authenticated/cadastro.atributos.tsx '      plural: "Cores base",'
conta src/routes/_authenticated/cadastro.atributos.tsx '      plural: "Cores apelido",'
conta src/routes/_authenticated/admin/configuracoes.tsx 'import { PAGES_CATALOG } from "@/lib/permissions-catalog";'
conta src/routes/_authenticated/admin/configuracoes.tsx '        onChange={(ref_config) => setCfg((c) => ({ ...c, ref_config }))}'
```

Expected: TODAS as linhas com `1` (conferido em `a044759`). Qualquer outro número: **não adaptar por conta própria** — registrar o trecho real (`git show "${B}:<arq>" | grep -nF -- '<pedaço>'`) em `.superpowers/f35a/ancoras-divergentes.md` e reportar; a task aplica a MESMA intenção sobre o texto real, com o registro.

- [ ] **Step 4: Regras, receita de travas e gates**

Criar `.superpowers/f35a/regras.md` (todo executor lê antes de cada task):

```markdown
# Regras da F3.5a (SKU automático — banco + cadastros + Config) — TODO executor lê antes de CADA task

1. Trabalhe SÓ na worktree `.claude/worktrees/sku-f35a` (branch `f35a/sku-banco-cadastros`). Nunca no checkout
   principal nem em outra worktree. Caminhos relativos = raiz da worktree.
2. Commit: `git add -- <SÓ os arquivos NOVOS da task>` + `git commit --only -m "…" -- <arquivos da task>` +
   `git show --stat HEAD`. Nunca `git add .`/`-A`/`commit -a`; NUNCA `git stash`; sem push. A mensagem termina com
   `Co-Authored-By: Claude <seu modelo> <noreply@anthropic.com>`.
3. Antes de TODO commit: `bash .superpowers/f35a/gates.sh` → `GATES F3.5a: ok`. Gate falhou = PARE.
4. Banco: DDL SÓ na cópia local (127.0.0.1:54422) e SÓ por (a) `SKU_MIG_TXN=1` na suíte (harness, txn revertida) ou
   (b) os scripts `.superpowers/f35a/mig/*.sh` do controlador. PROIBIDO: `psql -f`, `\i` de migration, probe
   exploratório fora do harness, qualquer coisa em produção (`/tmp/dburl.txt`, `*.supabase.co`).
5. Integração: SEMPRE `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres` explícito; antes,
   `ps -Ao pid,command | grep -E "[v]itest|[p]laywright"` tem de voltar vazio (a cópia é compartilhada: um por vez).
6. Leitura na cópia: `PGOPTIONS='-c default_transaction_read_only=on' psql …` (só SELECT).
7. O SQL do plano não foi executado pelo planejador: erro de SQL ⇒ corrigir o MÍNIMO e registrar em
   `.superpowers/f35a/desvios.md` (erro literal, causa, correção). Diferença de VALOR entre TS e SQL = drift de regra:
   PARE e chame o controlador (a regra só muda com ele).
8. Âncora que não bate (Task 0 Step 3): não adaptar por conta própria — registrar em
   `.superpowers/f35a/ancoras-divergentes.md` e reportar.
9. Não subir/derrubar servidor (só o controlador, na Task 10); nunca `:5173`, `:5188`, `:5181`–`:5187`; nada de
   `pkill`/`killall`. Não despachar subagentes.
10. Nunca imprimir senha/chave (nem do `.env`, nem da variante do app de teste).
```

Gerar `.superpowers/f35a/mig/aplica.sh` a partir do runbook v2 da F1 (funções LITERAIS, hash conferido) + as consultas da F3.5a. Criar primeiro `.superpowers/f35a/mig/aplica-extra.sh`:

```bash
CONT="select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') || '|' || (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal)"
RE_F35A='^(_sku_|_skus_modelo_|skus_modelo$|gerar_skus_modelo$|_gerar_skus_modelo_core$|salvar_sku_manual$|_salvar_sku_manual_core$|fn_sigla_sku_normaliza$|fn_tenant_config_sku_normaliza$|fn_produto_tamanho_tipo_handover$)'
# Objetos da F3.5a (só leitura) — funções|gatilhos|tabela|colunas: 0|0|0|0 sem a F3.5a; 18|5|1|7 com ela.
OBJ_F35A="select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname ~ '$RE_F35A') || '|' || (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_cores_sigla_sku','trg_cores_apelido_sigla_sku','trg_pa_tamanho_tipo','trg_pi_tamanho_tipo','trg_tenant_config_sku')) || '|' || (select count(*) from pg_class where oid = to_regclass('public.modelo_skus')) || '|' || (select count(*) from information_schema.columns where table_schema = 'public' and (table_name::text, column_name::text) in (('cores','sigla_sku'),('cores_apelido','sigla_sku'),('tenant_config','tamanhos_sku'),('tenant_config','sku_config'),('modelos','tamanho_tipo'),('produtos_acabados','tamanho_tipo'),('produtos_importados','tamanho_tipo')))"
# Fidelidade das funções PRÉ-EXISTENTES (tudo de public que NÃO é da F3.5a): md5 de assinatura+definição | quantidade.
FN_PRE="select md5(string_agg(p.oid::regprocedure::text || '=' || md5(pg_get_functiondef(p.oid)), E'\n' order by p.oid::regprocedure::text collate \"C\")) || '|' || count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') and p.proname !~ '$RE_F35A'"
# ACL (invariante #9) — internas expostas | RPCs erradas | tabela exposta: esperado 0|0|0 (SÓ com a F3.5a aplicada).
ACL_F35A="with i(f) as (values ('_sku_norm_sigla(text)'), ('_sku_tamanho_lados(text)'), ('_sku_tamanho_lado(text,text)'), ('_sku_config_normaliza(jsonb)'), ('_sku_tamanhos_normaliza(jsonb)'), ('_sku_montar(jsonb,jsonb)'), ('_sku_resolver(jsonb,text,jsonb,jsonb,text,text,jsonb)'), ('_sku_guarda(uuid,boolean)'), ('_skus_modelo_calc(uuid)'), ('_skus_modelo_core(uuid)'), ('_gerar_skus_modelo_core(uuid,boolean)'), ('_salvar_sku_manual_core(uuid,text,integer)'), ('fn_sigla_sku_normaliza()'), ('fn_tenant_config_sku_normaliza()'), ('fn_produto_tamanho_tipo_handover()')), r(f) as (values ('skus_modelo(uuid)'), ('gerar_skus_modelo(uuid,boolean)'), ('salvar_sku_manual(uuid,text,integer)')) select (select count(*) from i where has_function_privilege('public', 'public.' || f, 'EXECUTE') or has_function_privilege('anon', 'public.' || f, 'EXECUTE') or has_function_privilege('authenticated', 'public.' || f, 'EXECUTE')) || '|' || (select count(*) from r where has_function_privilege('public', 'public.' || f, 'EXECUTE') or has_function_privilege('anon', 'public.' || f, 'EXECUTE') or not has_function_privilege('authenticated', 'public.' || f, 'EXECUTE')) || '|' || ((select count(*) from (values ('anon'), ('authenticated')) p(r) where has_table_privilege(p.r, 'public.modelo_skus', 'INSERT,UPDATE,DELETE')) + (case when has_table_privilege('anon', 'public.modelo_skus', 'SELECT') then 1 else 0 end))"
```

e `.superpowers/f35a/mig/monta-aplica.sh`:

```bash
#!/usr/bin/env bash
# Gera .superpowers/f35a/mig/aplica.sh (Task 0 Step 4). Uso: bash monta-aplica.sh <extra.sh> <saida>
set -euo pipefail
RB="/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-22-kanban-automatico-f1-banco/task-18-runbook-v2.md"
FUN="$(awk '/^# === BLOCO DE APOIO v2 ===/{p=1} p{print} /^# === FIM DO BLOCO DE APOIO v2 ===/{p=0}' "$RB" \
  | awk '/^ATIV="/{print; next} /^(espera|ativ_vazio|com_travas|aplica_v2)\(\) *\{/{f=1} f{print} f&&/^\}$/{f=0}')"
[ "$(printf '%s\n' "$FUN" | shasum -a 256 | cut -c1-16)" = "c045cc571caf5d95" ] || { echo "PARE: o bloco de apoio v2 da F1 mudou (hash) — reler antes de usar"; exit 1; }
{
  echo '#!/usr/bin/env bash'
  echo '# Receita de travas da F3.5a = ATIV + espera/ativ_vazio/com_travas/aplica_v2 LITERAIS do bloco de apoio v2 do runbook da F1'
  echo '# (task-18-runbook-v2.md §3, extraídos por awk, hash c045cc571caf5d95) + as consultas da F3.5a. Uso: num BASH, na raiz da'
  echo '# worktree: source .superpowers/f35a/mig/aplica.sh (só define coisas; nada roda sozinho).'
  echo '[ -n "${BASH_VERSION:-}" ] || { echo "ERRO: use bash"; return 1 2>/dev/null || exit 1; }'
  echo 'LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"'
  echo 'MIG=supabase/migrations/20261003100000_sku_automatico.sql'
  echo 'INV=supabase/rollback/20261003100000_sku_automatico_down.sql'
  printf '%s\n' "$FUN"
  cat "$1"
} > "$2"
bash -n "$2" && echo "aplica.sh gerado: $2"
```

Criar `.superpowers/f35a/gates.sh`:

```bash
#!/usr/bin/env bash
# Gates de TODO commit da F3.5a. Uso (raiz da worktree): bash .superpowers/f35a/gates.sh → "GATES F3.5a: ok" (código 0).
# NÃO roda tests/integration (precisa da cópia local; cada task de banco roda a sua suíte com DATABASE_URL explícito).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
S=.superpowers/f35a
falha() { echo "GATE FALHOU: $1"; exit 1; }
BASE="$(cat "$S/BASE")"
npx tsc --noEmit > "$S/logs/tsc.log" 2>&1 || { tail -20 "$S/logs/tsc.log"; falha "tsc"; }
npm run build > "$S/logs/build.log" 2>&1 || { tail -20 "$S/logs/build.log"; falha "build"; }
git checkout -- src/routeTree.gen.ts 2>/dev/null || true
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit > "$S/logs/unit.log" 2>&1
grep -qE "Test Files .*passed" "$S/logs/unit.log" || { tail -20 "$S/logs/unit.log"; falha "unit (sem resumo)"; }
grep -E "^ FAIL " "$S/logs/unit.log" | sed -E 's/ +[0-9]+ms$//' | sort -u > "$S/logs/unit-fail-agora.txt"
diff -q "$S/unit-fail-base.txt" "$S/logs/unit-fail-agora.txt" > /dev/null \
  || { diff "$S/unit-fail-base.txt" "$S/logs/unit-fail-agora.txt"; falha "unit (falhas ≠ linha de base)"; }
# Escopo: desde o BASE só mudam (commitado OU na árvore) os arquivos do mapa da F3.5a (plano §4).
FORA="$( { git diff --name-only "$BASE" -- . ; git ls-files --others --exclude-standard; } | sort -u | grep -v -x -F -f "$S/arqs-f35a.txt" || true)"
[ -z "$FORA" ] || { echo "$FORA"; falha "arquivo FORA do mapa da F3.5a (plano §4)"; }
# Campanha: Dev intocado desde o save point (decisão travada 8).
[ -z "$(git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/cad/CadTecidosSection.tsx)" ] \
  || falha "Dev/CadTecidosSection mudou (decisão travada 8)"
# configuracoes.tsx: SÓ +2 linhas (import + <FormatoSkuCard />) — o conflito com a F2 fica mínimo (regra de rebase).
if ! git diff --quiet "$BASE" -- src/routes/_authenticated/admin/configuracoes.tsx; then
  NUM="$(git diff --numstat "$BASE" -- src/routes/_authenticated/admin/configuracoes.tsx | awk '{print $1"|"$2}')"
  [ "$NUM" = "2|0" ] || falha "configuracoes.tsx: esperado +2/-0 (import + <FormatoSkuCard />), achei $NUM"
fi
# Harness: tests/integration/mig-txn.ts = cópia byte a byte do da F3.1 (o da branch principal, se a F3.1 já juntou).
if [ -f tests/integration/mig-txn.ts ]; then
  REF_MIG="$(git show feature/plan-tecido-a1:tests/integration/mig-txn.ts 2>/dev/null || git show f31/planejamento-campos:tests/integration/mig-txn.ts)"
  [ "$REF_MIG" = "$(cat tests/integration/mig-txn.ts)" ] || falha "tests/integration/mig-txn.ts diverge do da F3.1 (é cópia — não editar)"
fi
echo "GATES F3.5a: ok"
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
bash .superpowers/f35a/mig/monta-aplica.sh .superpowers/f35a/mig/aplica-extra.sh .superpowers/f35a/mig/aplica.sh
chmod +x .superpowers/f35a/*.sh .superpowers/f35a/mig/*.sh
/bin/bash -c 'source .superpowers/f35a/mig/aplica.sh && export PGOPTIONS="-c default_transaction_read_only=on" && espera "$LOCAL" "$OBJ_F35A" "0|0|0|0" "cópia sem a F3.5a" && psql "$LOCAL" -X -A -t -c "$CONT" && psql "$LOCAL" -X -A -t -c "$FN_PRE"'
npx tsc --noEmit 2>&1 | tail -3
npm run build 2>&1 | tail -3; git checkout -- src/routeTree.gen.ts 2>/dev/null || true
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit > .superpowers/f35a/logs/unit-base.log 2>&1; tail -5 .superpowers/f35a/logs/unit-base.log
grep -E "^ FAIL " .superpowers/f35a/logs/unit-base.log | sed -E 's/ +[0-9]+ms$//' | sort -u > .superpowers/f35a/unit-fail-base.txt; cat .superpowers/f35a/unit-fail-base.txt
bash .superpowers/f35a/gates.sh; echo "código=$?"
```

Expected: `aplica.sh gerado: …`; `OK (cópia sem a F3.5a): 0|0|0|0`; as contagens da cópia (24/set: `458|263`) e `<md5>|458` das funções — anotar em `.superpowers/f35a/logs/copia-inicial.txt`; tsc sem erro; build ok; unit com as falhas HERDADAS do anti-drift de UI (24/set: 2 — `(a) cor literal` em `DocPrintCasca`/`OcDocumentoPrint` e `(e) font-size fracionário`); `GATES F3.5a: ok` e `código=0`. `PARE: o bloco de apoio v2 da F1 mudou (hash)` ⇒ reler o runbook com o controlador antes de seguir.

---

## Task 1: `src/lib/tamanho.ts` + `src/lib/sku-montar.ts` — espelho TS puro + casos do anti-drift  *(individual Opus)*

**Files:**
- Create: `src/lib/tamanho.ts`, `src/lib/sku-montar.ts`, `tests/fixtures/sku-casos.ts`
- Test: `tests/unit/sku-montar.test.ts`

**Interfaces:**
- Produces: tudo do §4.1 "TS". Consumes: nada.

- [ ] **Step 1: Casos compartilhados** — criar `tests/fixtures/sku-casos.ts`:

```ts
// Casos COMPARTILHADOS do anti-drift do SKU (F3.5a): o MESMO arquivo alimenta
//   tests/unit/sku-montar.test.ts           → src/lib/tamanho.ts + src/lib/sku-montar.ts (TS)
//   tests/integration/sku-automatico.test.ts → public._sku_* (SQL, só na cópia local)
// Toda entrada é serializável em JSON (vai ao banco como jsonb/text). Mudou a regra? Mude TS, SQL e AQUI.
import type { SkuConfig, SkuCor, SkuFalta } from "../../src/lib/sku-montar";
import type { TamanhoTipo } from "../../src/lib/tamanho";

export const CASOS_TAMANHO: {
  entrada: string | null;
  numero: string | null;
  letra: string | null;
  ladoNumero: string | null;
  ladoLetra: string | null;
}[] = [
  { entrada: "34|PPP", numero: "34", letra: "PPP", ladoNumero: "34", ladoLetra: "PPP" },
  { entrada: "PPP|34", numero: "34", letra: "PPP", ladoNumero: "34", ladoLetra: "PPP" },
  { entrada: " 38 | P ", numero: "38", letra: "P", ladoNumero: "38", ladoLetra: "P" },
  { entrada: "36", numero: "36", letra: null, ladoNumero: "36", ladoLetra: "36" },
  { entrada: "PP", numero: null, letra: "PP", ladoNumero: "PP", ladoLetra: "PP" },
  { entrada: "UN", numero: null, letra: "UN", ladoNumero: "UN", ladoLetra: "UN" },
  { entrada: "3M", numero: null, letra: "3M", ladoNumero: "3M", ladoLetra: "3M" },
  { entrada: "34|", numero: "34", letra: null, ladoNumero: "34", ladoLetra: "34" },
  { entrada: "|PPP", numero: null, letra: "PPP", ladoNumero: "PPP", ladoLetra: "PPP" },
  { entrada: "|34", numero: "34", letra: null, ladoNumero: "34", ladoLetra: "34" },
  { entrada: "10|12", numero: "10", letra: "12", ladoNumero: "10", ladoLetra: "12" },
  { entrada: "P|M", numero: "P", letra: "M", ladoNumero: "P", ladoLetra: "M" },
  { entrada: "34|PPP|X", numero: "34", letra: "PPP|X", ladoNumero: "34", ladoLetra: "PPP|X" },
  { entrada: "|", numero: null, letra: null, ladoNumero: null, ladoLetra: null },
  { entrada: "   ", numero: null, letra: null, ladoNumero: null, ladoLetra: null },
  { entrada: null, numero: null, letra: null, ladoNumero: null, ladoLetra: null },
  { entrada: "\t40\n|\tM ", numero: "40", letra: "M", ladoNumero: "40", ladoLetra: "M" },
];

export const CASOS_SIGLA: { entrada: string | null; esperado: string | null }[] = [
  { entrada: "am", esperado: "AM" },
  { entrada: "  vd \t", esperado: "VD" },
  { entrada: "Off White", esperado: "OFF WHITE" },
  { entrada: "açaí", esperado: "AÇAÍ" },
  { entrada: "", esperado: null },
  { entrada: " \t\r\n ", esperado: null },
  { entrada: null, esperado: null },
];

export const CASOS_CONFIG: ({ entrada: unknown; esperado: SkuConfig | null } | { entrada: unknown; erro: string })[] = [
  { entrada: null, esperado: null },
  { entrada: { partes: [] }, esperado: null },
  { entrada: {}, esperado: null },
  {
    entrada: { partes: ["ref", "cor_base", "tamanho"] },
    esperado: { partes: ["ref", "cor_base", "tamanho"], separadores: {}, tamanho_padrao: "letra" },
  },
  {
    entrada: {
      partes: ["ref", "cor_base", "cor_apelido", "tamanho"],
      separadores: { "ref|cor_base": "-", "cor_base|cor_apelido": "", "cor_apelido|tamanho": "/", "ref|tamanho": "#" },
      tamanho_padrao: "numero",
      lixo: 1,
    },
    esperado: {
      partes: ["ref", "cor_base", "cor_apelido", "tamanho"],
      separadores: { "ref|cor_base": "-", "cor_apelido|tamanho": "/" },
      tamanho_padrao: "numero",
    },
  },
  { entrada: { partes: ["ref"], tamanho_padrao: "" }, esperado: { partes: ["ref"], separadores: {}, tamanho_padrao: "letra" } },
  { entrada: { partes: ["ref"], tamanho_padrao: null }, esperado: { partes: ["ref"], separadores: {}, tamanho_padrao: "letra" } },
  { entrada: { partes: ["ref"], separadores: null }, esperado: { partes: ["ref"], separadores: {}, tamanho_padrao: "letra" } },
  { entrada: [], erro: "Formato do SKU inválido." },
  { entrada: "x", erro: "Formato do SKU inválido." },
  { entrada: { partes: "ref" }, erro: "Formato do SKU inválido: partes." },
  { entrada: { partes: ["ref", "cor"] }, erro: 'Parte do SKU desconhecida: "cor".' },
  { entrada: { partes: ["ref", 5] }, erro: "Parte do SKU desconhecida: 5." },
  { entrada: { partes: ["ref", "ref"] }, erro: "Parte do SKU repetida: ref." },
  { entrada: { partes: ["ref", "tamanho"], separadores: [] }, erro: "Formato do SKU inválido: separadores." },
  { entrada: { partes: ["ref", "tamanho"], separadores: { "ref|tamanho": 1 } }, erro: "Separador do SKU inválido." },
  { entrada: { partes: ["ref", "tamanho"], separadores: { "ref|tamanho": "- " } }, erro: "Separador do SKU não pode ter espaço." },
  { entrada: { partes: ["ref", "tamanho"], separadores: { "ref|tamanho": "----" } }, erro: "Separador do SKU: no máximo 3 caracteres." },
  { entrada: { partes: ["ref"], tamanho_padrao: "grande" }, erro: "Tamanho padrão do SKU inválido (use letra ou número)." },
  { entrada: { partes: ["ref"], tamanho_padrao: 5 }, erro: "Tamanho padrão do SKU inválido (use letra ou número)." },
];

export const CASOS_TAMANHOS_SKU: ({ entrada: unknown; esperado: Record<string, string> | null } | { entrada: unknown; erro: string })[] = [
  { entrada: null, esperado: null },
  { entrada: {}, esperado: null },
  { entrada: { "34": "34", PPP: " ppp ", PP: "", " P ": "p", M: null }, esperado: { "34": "34", PPP: "PPP", P: "P" } },
  { entrada: { " ": "X" }, esperado: null },
  { entrada: [], erro: "Siglas de tamanho inválidas." },
  { entrada: { "34": 34 }, erro: "Sigla de tamanho inválida: 34." },
  { entrada: { "34": "A", " 34": "B" }, erro: "Sigla de tamanho repetida: 34." },
  { entrada: { "34": "", " 34": "B" }, esperado: { "34": "B" } },
];

const F_TODAS: SkuConfig = {
  partes: ["ref", "cor_base", "cor_apelido", "tamanho"],
  separadores: { "ref|cor_base": "-", "cor_base|cor_apelido": ".", "cor_apelido|tamanho": "/" },
  tamanho_padrao: "letra",
};
const F_COLADO: SkuConfig = { partes: ["ref", "cor_base", "tamanho"], separadores: {}, tamanho_padrao: "letra" };
const F_APELIDO_1O: SkuConfig = {
  partes: ["cor_apelido", "ref", "tamanho"],
  separadores: { "cor_apelido|ref": "_", "ref|tamanho": "-" },
  tamanho_padrao: "numero",
};

export const CASOS_MONTAR: { cfg: SkuConfig; valores: Record<string, string | null>; esperado: string }[] = [
  { cfg: F_COLADO, valores: { ref: "REF00000001", cor_base: "AM", tamanho: "34" }, esperado: "REF00000001AM34" },
  { cfg: F_COLADO, valores: { ref: "REF00000001", cor_base: "VD", tamanho: "PPP" }, esperado: "REF00000001VDPPP" },
  { cfg: F_TODAS, valores: { ref: "R1", cor_base: "AM", cor_apelido: "CAN", tamanho: "P" }, esperado: "R1-AM.CAN/P" },
  { cfg: F_TODAS, valores: { ref: "R1", cor_base: "AM", cor_apelido: null, tamanho: "P" }, esperado: "R1-AM/P" },
  { cfg: F_TODAS, valores: { ref: "R1", cor_base: "AM", cor_apelido: "", tamanho: null }, esperado: "R1-AM" },
  { cfg: F_APELIDO_1O, valores: { cor_apelido: null, ref: "R1", tamanho: "34" }, esperado: "R1-34" },
  { cfg: F_APELIDO_1O, valores: { cor_apelido: "CAN", ref: "R1", tamanho: "34" }, esperado: "CAN_R1-34" },
  { cfg: F_COLADO, valores: {}, esperado: "" },
];

const AM: SkuCor = { id: "00000000-0000-0000-0000-0000000000a1", nome: "Amarelo", sigla: "AM" };
const VD_SEM: SkuCor = { id: "00000000-0000-0000-0000-0000000000a2", nome: "Verde", sigla: null };
const CAN: SkuCor = { id: "00000000-0000-0000-0000-0000000000b1", nome: "Canário", sigla: "CAN" };
const MUS_SEM: SkuCor = { id: "00000000-0000-0000-0000-0000000000b2", nome: "Musgo", sigla: null };
const TSKU: Record<string, string> = { "34": "34", PPP: "PPP", "36": "36", PP: "PP", P: "P", "38": "38" };

export type CasoResolver = {
  entrada: {
    cfg: SkuConfig;
    ref: string | null;
    cor: SkuCor | null;
    apelido: SkuCor | null;
    tamanhoKey: string;
    tipo: TamanhoTipo;
    tamanhosSku: Record<string, string> | null;
  };
  esperado: { sku: string | null; faltas: SkuFalta[] };
};

export const CASOS_RESOLVER: CasoResolver[] = [
  { entrada: { cfg: F_COLADO, ref: "REF00000001", cor: AM, apelido: null, tamanhoKey: "34|PPP", tipo: "numero", tamanhosSku: TSKU },
    esperado: { sku: "REF00000001AM34", faltas: [] } },
  { entrada: { cfg: F_COLADO, ref: "REF00000001", cor: AM, apelido: CAN, tamanhoKey: "34|PPP", tipo: "letra", tamanhosSku: TSKU },
    esperado: { sku: "REF00000001AMPPP", faltas: [] } },
  { entrada: { cfg: F_TODAS, ref: " R1 ", cor: AM, apelido: CAN, tamanhoKey: "38|P", tipo: "letra", tamanhosSku: TSKU },
    esperado: { sku: "R1-AM.CAN/P", faltas: [] } },
  { entrada: { cfg: F_TODAS, ref: "R1", cor: AM, apelido: null, tamanhoKey: "38|P", tipo: "numero", tamanhosSku: TSKU },
    esperado: { sku: "R1-AM/38", faltas: [] } },
  { entrada: { cfg: F_TODAS, ref: "R1", cor: VD_SEM, apelido: MUS_SEM, tamanhoKey: "40|M", tipo: "letra", tamanhosSku: TSKU },
    esperado: { sku: null, faltas: [
      { atributo: "cor_base", id: VD_SEM.id, nome: "Verde" },
      { atributo: "cor_apelido", id: MUS_SEM.id, nome: "Musgo" },
      { atributo: "tamanho", id: null, nome: "M" },
    ] } },
  { entrada: { cfg: F_COLADO, ref: "R1", cor: null, apelido: null, tamanhoKey: "36", tipo: "letra", tamanhosSku: TSKU },
    esperado: { sku: null, faltas: [{ atributo: "cor_base", id: null, nome: null }] } },
  { entrada: { cfg: F_COLADO, ref: "R1", cor: AM, apelido: null, tamanhoKey: "36", tipo: "letra", tamanhosSku: TSKU },
    esperado: { sku: "R1AM36", faltas: [] } },
  { entrada: { cfg: F_COLADO, ref: "R1", cor: AM, apelido: null, tamanhoKey: "PP", tipo: "numero", tamanhosSku: TSKU },
    esperado: { sku: "R1AMPP", faltas: [] } },
  { entrada: { cfg: F_COLADO, ref: "R1", cor: AM, apelido: null, tamanhoKey: "UN", tipo: "letra", tamanhosSku: TSKU },
    esperado: { sku: "R1AM", faltas: [] } },
  { entrada: { cfg: F_COLADO, ref: "R1", cor: AM, apelido: null, tamanhoKey: "UN", tipo: "letra", tamanhosSku: { UN: "U" } },
    esperado: { sku: "R1AMU", faltas: [] } },
  { entrada: { cfg: F_COLADO, ref: "R1", cor: AM, apelido: null, tamanhoKey: "44|GG", tipo: "letra", tamanhosSku: null },
    esperado: { sku: null, faltas: [{ atributo: "tamanho", id: null, nome: "GG" }] } },
  { entrada: { cfg: { partes: ["ref", "cor_base"], separadores: {}, tamanho_padrao: "letra" }, ref: "R1", cor: AM, apelido: MUS_SEM,
      tamanhoKey: "44|GG", tipo: "letra", tamanhosSku: null },
    esperado: { sku: "R1AM", faltas: [] } },
  { entrada: { cfg: F_APELIDO_1O, ref: "R1", cor: VD_SEM, apelido: null, tamanhoKey: "34|PPP", tipo: "numero", tamanhosSku: TSKU },
    esperado: { sku: "R1-34", faltas: [] } },
  { entrada: { cfg: { partes: ["cor_apelido"], separadores: {}, tamanho_padrao: "letra" }, ref: "R1", cor: AM, apelido: null,
      tamanhoKey: "34|PPP", tipo: "letra", tamanhosSku: TSKU },
    esperado: { sku: null, faltas: [] } },
];
```

- [ ] **Step 2: Teste (vermelho)** — criar `tests/unit/sku-montar.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { aparar, ehNumeroTamanho, ladoTamanho, parseTamanho } from "@/lib/tamanho";
import {
  canonico, ladosDaGrade, mesclarSiglasTamanho, montarSku, normalizarSigla, normalizarSkuConfig,
  normalizarTamanhosSku, resolverSku, textoFalta,
} from "@/lib/sku-montar";
import {
  CASOS_CONFIG, CASOS_MONTAR, CASOS_RESOLVER, CASOS_SIGLA, CASOS_TAMANHO, CASOS_TAMANHOS_SKU,
} from "../fixtures/sku-casos";

// Lado TS do anti-drift (o lado SQL roda as MESMAS fixtures em tests/integration/sku-automatico.test.ts).

describe("tamanho.ts — parseTamanho / ladoTamanho (espelho _sku_tamanho_lados/_sku_tamanho_lado)", () => {
  for (const c of CASOS_TAMANHO) {
    it(`${JSON.stringify(c.entrada)} → número ${c.numero} · letra ${c.letra}`, () => {
      expect(parseTamanho(c.entrada)).toEqual({ numero: c.numero, letra: c.letra });
      expect(ladoTamanho(c.entrada, "numero")).toBe(c.ladoNumero);
      expect(ladoTamanho(c.entrada, "letra")).toBe(c.ladoLetra);
    });
  }
  it("aparar só tira espaço/tab/CR/LF (igual ao btrim do SQL), não o espaço unicode", () => {
    expect(aparar(" \t a \r\n")).toBe("a");
    expect(aparar("\u00a0a\u00a0")).toBe("\u00a0a\u00a0"); // NBSP fica (o btrim do SQL também não o tira)
    expect(aparar(null)).toBe("");
  });
  it("ehNumeroTamanho: só dígitos ASCII", () => {
    expect(ehNumeroTamanho("034")).toBe(true);
    expect(ehNumeroTamanho("3M")).toBe(false);
    expect(ehNumeroTamanho("")).toBe(false);
    expect(ehNumeroTamanho("٣٤")).toBe(false);
  });
});

describe("sku-montar.ts — normalizarSigla (espelho _sku_norm_sigla)", () => {
  for (const c of CASOS_SIGLA) {
    it(`${JSON.stringify(c.entrada)} → ${JSON.stringify(c.esperado)}`, () => {
      expect(normalizarSigla(c.entrada)).toBe(c.esperado);
    });
  }
});

describe("sku-montar.ts — normalizarSkuConfig (espelho _sku_config_normaliza, mesmas mensagens)", () => {
  for (const c of CASOS_CONFIG) {
    it(JSON.stringify(c.entrada), () => {
      const r = normalizarSkuConfig(c.entrada);
      if ("erro" in c) expect(r).toEqual({ ok: false, erro: c.erro });
      else expect(r).toEqual({ ok: true, valor: c.esperado });
    });
  }
});

describe("sku-montar.ts — normalizarTamanhosSku (espelho _sku_tamanhos_normaliza, mesmas mensagens)", () => {
  for (const c of CASOS_TAMANHOS_SKU) {
    it(JSON.stringify(c.entrada), () => {
      const r = normalizarTamanhosSku(c.entrada);
      if ("erro" in c) expect(r).toEqual({ ok: false, erro: c.erro });
      else expect(r).toEqual({ ok: true, valor: c.esperado });
    });
  }
});

describe("sku-montar.ts — montarSku (espelho _sku_montar)", () => {
  for (const c of CASOS_MONTAR) {
    it(`${c.cfg.partes.join("+")} ${JSON.stringify(c.valores)} → ${c.esperado}`, () => {
      expect(montarSku(c.cfg, c.valores)).toBe(c.esperado);
    });
  }
});

describe("sku-montar.ts — resolverSku (espelho _sku_resolver)", () => {
  CASOS_RESOLVER.forEach((c, i) => {
    it(`caso ${i + 1}: ${c.entrada.tamanhoKey} (${c.entrada.tipo}) → ${c.esperado.sku ?? "falta"}`, () => {
      expect(resolverSku(c.entrada)).toEqual(c.esperado);
    });
  });
});

describe("sku-montar.ts — apoio às telas", () => {
  it("textoFalta", () => {
    expect(textoFalta({ atributo: "cor_base", id: "x", nome: "Amarelo" })).toBe("Falta sigla: Cor base Amarelo");
    expect(textoFalta({ atributo: "cor_apelido", id: "y", nome: "Musgo" })).toBe("Falta sigla: Cor apelido Musgo");
    expect(textoFalta({ atributo: "tamanho", id: null, nome: "PPP" })).toBe("Falta sigla: Tamanho PPP");
    expect(textoFalta({ atributo: "cor_base", id: null, nome: null })).toBe("Falta a cor base na variante");
  });
  it("canonico ignora a ordem das chaves (o jsonb reordena)", () => {
    expect(canonico({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe(canonico({ a: { c: null, d: [2, { x: 2, y: 1 }] }, b: 1 }));
    expect(canonico(null)).toBe("null");
    expect(canonico(undefined)).toBe("null");
  });
  it("ladosDaGrade destrincha cada item", () => {
    expect(ladosDaGrade(["34|PPP", "36", "P"])).toEqual([
      { item: "34|PPP", numero: "34", letra: "PPP" },
      { item: "36", numero: "36", letra: null },
      { item: "P", numero: null, letra: "P" },
    ]);
  });
  it("mesclarSiglasTamanho aplica só o que o usuário mudou sobre o mapa ATUAL do banco", () => {
    const base = { "34": "34", PPP: "PPP" };
    const fresco = { "34": "34", PPP: "PPP", "36": "36" }; // outra pessoa gravou "36" depois que a tela abriu
    const rascunho = { "34": "34", PPP: " x " }; // eu mudei PPP
    expect(mesclarSiglasTamanho(fresco, base, rascunho)).toEqual({ "34": "34", PPP: "X", "36": "36" });
    expect(mesclarSiglasTamanho(fresco, base, { "34": "", PPP: "PPP" })).toEqual({ PPP: "PPP", "36": "36" });
    expect(mesclarSiglasTamanho(null, null, {})).toBeNull();
    expect(mesclarSiglasTamanho({ P: "P" }, { P: "P" }, { P: "" })).toBeNull();
  });
});
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
env -u DATABASE_URL npx vitest run tests/unit/sku-montar.test.ts 2>&1 | tail -5
```

Expected: FALHA na coleta (`Failed to resolve import "@/lib/tamanho"`).

- [ ] **Step 3: `src/lib/tamanho.ts`**

```ts
// Tamanho da grade da loja (tenant_config.tamanhos_grade) — helper ÚNICO (spec SKU §4.1, F3.5a).
// Formato "Número|Letra" (ex.: "34|PPP"). Item SOLTO (sem "|") é classificado sozinho: só dígitos → Número;
// o resto → Letra. Par invertido ("PPP|34": só o lado DIREITO é número) é destrinchado pelo conteúdo.
// Espelho SQL byte a byte: public._sku_tamanho_lados(text) / public._sku_tamanho_lado(text,text)
// (migration 20261003100000) — casados pelo anti-drift (tests/fixtures/sku-casos.ts → unit + integração).
// ⚠️ Os ~17 `split("|")` antigos do repo NÃO foram migrados (fora de escopo da F3.5a); código NOVO usa só este helper.
// PURO (sem I/O).

export type TamanhoTipo = "letra" | "numero";
export type LadosTamanho = { numero: string | null; letra: string | null };

/** Espaços das pontas: SÓ espaço, tab, CR e LF (= `btrim(x, E' \t\r\n')` do SQL — não o `.trim()` unicode do JS). */
export function aparar(s: string | null | undefined): string {
  return (s ?? "").replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

/** Só dígitos ASCII (= `~ '^[0-9]+$'` do SQL). */
export function ehNumeroTamanho(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

function solto(s: string): LadosTamanho {
  return ehNumeroTamanho(s) ? { numero: s, letra: null } : { numero: null, letra: s };
}

/** "34|PPP" → { numero: "34", letra: "PPP" }; "PPP|34" → idem; "36" → número; "PP" → letra; "UN" → letra. */
export function parseTamanho(t: string | null | undefined): LadosTamanho {
  const s = aparar(t);
  if (s === "") return { numero: null, letra: null };
  const i = s.indexOf("|");
  if (i < 0) return solto(s);
  const a = aparar(s.slice(0, i)) || null; // só o 1º "|" separa; o resto fica no lado direito
  const b = aparar(s.slice(i + 1)) || null;
  if (a && b) return !ehNumeroTamanho(a) && ehNumeroTamanho(b) ? { numero: b, letra: a } : { numero: a, letra: b };
  if (a) return solto(a);
  if (b) return solto(b);
  return { numero: null, letra: null };
}

/** Lado do tamanho que vale no SKU/na exibição: o do tipo pedido; se o item não tem esse lado (solto ou "UN"), o outro. */
export function ladoTamanho(t: string | null | undefined, tipo: TamanhoTipo): string | null {
  const l = parseTamanho(t);
  return tipo === "numero" ? (l.numero ?? l.letra) : (l.letra ?? l.numero);
}
```

- [ ] **Step 4: `src/lib/sku-montar.ts`**

```ts
// SKU automático (spec 2026-09-24-sku-automatico-design.md, F3.5a) — espelho TS PURO da montagem do servidor.
// O SKU é GERADO e GRAVADO no servidor (RPC gerar_skus_modelo — fonte única); este arquivo só serve à
// PRÉ-VISUALIZAÇÃO (Config da Loja) e à validação dos formulários ANTES de gravar. Casa byte a byte com:
//   normalizarSigla       ⇄ public._sku_norm_sigla(text)
//   normalizarSkuConfig   ⇄ public._sku_config_normaliza(jsonb)      (mesmas mensagens de erro, em PT)
//   normalizarTamanhosSku ⇄ public._sku_tamanhos_normaliza(jsonb)    (mesmas mensagens de erro, em PT)
//   montarSku             ⇄ public._sku_montar(jsonb,jsonb)
//   resolverSku           ⇄ public._sku_resolver(jsonb,text,jsonb,jsonb,text,text,jsonb)
// Anti-drift: tests/fixtures/sku-casos.ts roda nos DOIS lados (tests/unit/sku-montar.test.ts e
// tests/integration/sku-automatico.test.ts). Mudou a regra aqui? Mude o SQL (nova migration) e as fixtures.
//
// Regras (decisões do dono Q1–Q4 + plano F3.5a §7):
//  - Sigla: trim (espaço/tab/CR/LF) + MAIÚSCULAS; vazia ⇒ null.
//  - Formato: `partes` ⊆ {ref, cor_base, cor_apelido, tamanho}, sem repetir, na ordem do SKU; lista vazia ⇒ sem
//    formato (null = a loja não gera SKU). `separadores` só entre partes VIZINHAS da lista ("a|b"); vazio = colado;
//    até 3 caracteres, sem espaço. `tamanho_padrao` = "letra" (padrão) | "numero".
//  - Montagem: o separador ANDA COM A PARTE QUE VEM DEPOIS dele. Parte ausente na linha (variante sem apelido;
//    tamanho "UN" sem sigla — D1) some JUNTO com o separador que a antecede.
//  - Falta sigla (Q4) ⇒ a linha NÃO gera SKU e devolve `faltas` na ordem cor_base → cor_apelido → tamanho.
//    Variante sem cor base ⇒ falta { atributo: "cor_base", id: null, nome: null }.
import { aparar, ladoTamanho, parseTamanho, type TamanhoTipo } from "@/lib/tamanho";

export type SkuParte = "ref" | "cor_base" | "cor_apelido" | "tamanho";
export const SKU_PARTES: readonly SkuParte[] = ["ref", "cor_base", "cor_apelido", "tamanho"];
export const SKU_PARTE_LABEL: Record<SkuParte, string> = {
  ref: "REF",
  cor_base: "Cor base",
  cor_apelido: "Cor apelido",
  tamanho: "Tamanho",
};
export type SkuConfig = { partes: SkuParte[]; separadores: Record<string, string>; tamanho_padrao: TamanhoTipo };
export type SkuFalta = { atributo: "cor_base" | "cor_apelido" | "tamanho"; id: string | null; nome: string | null };
export type SkuCor = { id: string; nome: string; sigla: string | null };
export type Normalizado<T> = { ok: true; valor: T } | { ok: false; erro: string };

/** Grade única dos Acessórios (revenda/importado) — `_pa_grade_variante` grava `{"UN": qtd}`. */
export const TAMANHO_UNICO = "UN";
export const SKU_SEP_MAX = 3;

export function chaveSeparador(a: SkuParte, b: SkuParte): string {
  return `${a}|${b}`;
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nChars = (s: string) => [...s].length; // = char_length do SQL (conta pontos de código, não UTF-16)

/** Sigla (cor base, cor apelido, lado do tamanho): trim + MAIÚSCULAS; vazia ⇒ null. */
export function normalizarSigla(s: string | null | undefined): string | null {
  const v = aparar(s).toUpperCase();
  return v === "" ? null : v;
}

/** Valida e canoniza o Formato do SKU (o mesmo que o gatilho de tenant_config faz no servidor). */
export function normalizarSkuConfig(raw: unknown): Normalizado<SkuConfig | null> {
  if (raw === null || raw === undefined) return { ok: true, valor: null };
  if (!ehObjeto(raw)) return { ok: false, erro: "Formato do SKU inválido." };
  let brutas: unknown = raw.partes;
  if (brutas === null || brutas === undefined) brutas = [];
  if (!Array.isArray(brutas)) return { ok: false, erro: "Formato do SKU inválido: partes." };
  const partes: SkuParte[] = [];
  for (const p of brutas) {
    if (typeof p !== "string" || !(SKU_PARTES as readonly string[]).includes(p)) {
      return { ok: false, erro: `Parte do SKU desconhecida: ${JSON.stringify(p)}.` };
    }
    if (partes.includes(p as SkuParte)) return { ok: false, erro: `Parte do SKU repetida: ${p}.` };
    partes.push(p as SkuParte);
  }
  if (partes.length === 0) return { ok: true, valor: null };
  let seps: unknown = raw.separadores;
  if (seps === null || seps === undefined) seps = {};
  if (!ehObjeto(seps)) return { ok: false, erro: "Formato do SKU inválido: separadores." };
  const separadores: Record<string, string> = {};
  for (let i = 1; i < partes.length; i++) {
    const k = chaveSeparador(partes[i - 1], partes[i]);
    const v = seps[k];
    if (v === null || v === undefined) continue;
    if (typeof v !== "string") return { ok: false, erro: "Separador do SKU inválido." };
    if (/\s/.test(v)) return { ok: false, erro: "Separador do SKU não pode ter espaço." };
    if (nChars(v) > SKU_SEP_MAX) return { ok: false, erro: `Separador do SKU: no máximo ${SKU_SEP_MAX} caracteres.` };
    if (v !== "") separadores[k] = v;
  }
  const tp = raw.tamanho_padrao;
  const tipo = tp === null || tp === undefined || tp === "" ? "letra" : tp;
  if (tipo !== "letra" && tipo !== "numero") {
    return { ok: false, erro: "Tamanho padrão do SKU inválido (use letra ou número)." };
  }
  return { ok: true, valor: { partes, separadores, tamanho_padrao: tipo } };
}

/** Valida e canoniza o mapa lado-do-tamanho → sigla (tenant_config.tamanhos_sku). Vazio ⇒ null. */
export function normalizarTamanhosSku(raw: unknown): Normalizado<Record<string, string> | null> {
  if (raw === null || raw === undefined) return { ok: true, valor: null };
  if (!ehObjeto(raw)) return { ok: false, erro: "Siglas de tamanho inválidas." };
  const out: Record<string, string> = {};
  for (const [k0, v] of Object.entries(raw)) {
    const k = aparar(k0);
    if (k === "" || v === null || v === undefined) continue;
    if (typeof v !== "string") return { ok: false, erro: `Sigla de tamanho inválida: ${k}.` };
    if (Object.prototype.hasOwnProperty.call(out, k)) return { ok: false, erro: `Sigla de tamanho repetida: ${k}.` };
    const sig = normalizarSigla(v);
    if (sig) out[k] = sig;
  }
  return { ok: true, valor: Object.keys(out).length === 0 ? null : out };
}

/** Junta as partes na ordem do formato. O separador anda com a parte que vem DEPOIS; parte vazia some com ele. */
export function montarSku(cfg: SkuConfig, valores: Partial<Record<SkuParte, string | null | undefined>>): string {
  let out = "";
  let anterior: SkuParte | null = null; // parte CONFIGURADA anterior (mesmo que tenha ficado vazia)
  let emitiu = false;
  for (const p of cfg.partes) {
    const v = valores[p] ?? "";
    if (v !== "") {
      if (emitiu && anterior) out += cfg.separadores[chaveSeparador(anterior, p)] ?? "";
      out += v;
      emitiu = true;
    }
    anterior = p;
  }
  return out;
}

/** O SKU de UMA linha (variante × tamanho) — ou as faltas de sigla que impedem gerá-lo (Q4). */
export function resolverSku(o: {
  cfg: SkuConfig;
  ref: string | null;
  cor: SkuCor | null;
  apelido: SkuCor | null;
  tamanhoKey: string;
  tipo: TamanhoTipo;
  tamanhosSku: Record<string, string> | null;
}): { sku: string | null; faltas: SkuFalta[] } {
  const faltas: SkuFalta[] = [];
  const usa = (p: SkuParte) => o.cfg.partes.includes(p);
  const valores: Partial<Record<SkuParte, string>> = {};
  if (usa("ref")) valores.ref = aparar(o.ref);
  if (usa("cor_base")) {
    if (!o.cor) faltas.push({ atributo: "cor_base", id: null, nome: null });
    else if (!o.cor.sigla) faltas.push({ atributo: "cor_base", id: o.cor.id, nome: o.cor.nome });
    else valores.cor_base = o.cor.sigla;
  }
  if (usa("cor_apelido") && o.apelido) {
    if (!o.apelido.sigla) faltas.push({ atributo: "cor_apelido", id: o.apelido.id, nome: o.apelido.nome });
    else valores.cor_apelido = o.apelido.sigla;
  }
  if (usa("tamanho")) {
    const lado = ladoTamanho(o.tamanhoKey, o.tipo);
    const sig = lado && o.tamanhosSku ? o.tamanhosSku[lado] || null : null;
    if (sig) valores.tamanho = sig;
    else if (lado && lado !== TAMANHO_UNICO) faltas.push({ atributo: "tamanho", id: null, nome: lado });
  }
  if (faltas.length > 0) return { sku: null, faltas };
  const sku = montarSku(o.cfg, valores);
  return { sku: sku === "" ? null : sku, faltas };
}

// ─────────────────────────── apoio às telas (não têm espelho SQL) ───────────────────────────

/** "Falta sigla: Cor base Amarelo" — o texto das linhas de falta (Config e, na F3.5b, o card). */
export function textoFalta(f: SkuFalta): string {
  if (f.atributo === "cor_base" && f.nome === null) return "Falta a cor base na variante";
  const rotulo = f.atributo === "cor_base" ? "Cor base" : f.atributo === "cor_apelido" ? "Cor apelido" : "Tamanho";
  return `Falta sigla: ${rotulo} ${f.nome ?? ""}`.trimEnd();
}

/** JSON com chaves ordenadas — compara o Formato/as siglas lidos do banco (jsonb reordena chaves). */
export function canonico(v: unknown): string {
  const ordena = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(ordena)
      : ehObjeto(x)
        ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, ordena(x[k])]))
        : x;
  return JSON.stringify(ordena(v ?? null));
}

/** Cada item da grade com os seus lados (para o editor de siglas da Grade de Tamanhos). */
export function ladosDaGrade(grade: readonly string[]): { item: string; numero: string | null; letra: string | null }[] {
  return grade.map((item) => ({ item, ...parseTamanho(item) }));
}

/**
 * Siglas de tamanho a GRAVAR: aplica sobre o mapa ATUAL do banco (`fresco`) só as chaves que o usuário mudou
 * (rascunho × base carregada) — duas pessoas editando lados diferentes não se apagam (lição RP3 da F2).
 */
export function mesclarSiglasTamanho(
  fresco: Record<string, string> | null,
  base: Record<string, string> | null,
  rascunho: Record<string, string>,
): Record<string, string> | null {
  const out: Record<string, string> = { ...(fresco ?? {}) };
  const chaves = new Set([...Object.keys(base ?? {}), ...Object.keys(rascunho)]);
  for (const k of chaves) {
    const antes = normalizarSigla((base ?? {})[k]);
    const agora = normalizarSigla(rascunho[k]);
    if (antes === agora) continue;
    if (agora) out[k] = agora;
    else delete out[k];
  }
  return Object.keys(out).length === 0 ? null : out;
}
```

- [ ] **Step 5: Verde + gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
env -u DATABASE_URL npx vitest run tests/unit/sku-montar.test.ts 2>&1 | tail -4
bash .superpowers/f35a/gates.sh
git add -- src/lib/tamanho.ts src/lib/sku-montar.ts tests/fixtures/sku-casos.ts tests/unit/sku-montar.test.ts
git commit --only -m "feat(sku): F3.5a (1) — espelho TS puro (parseTamanho, montarSku, resolverSku, normalizações) + casos do anti-drift

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/lib/tamanho.ts src/lib/sku-montar.ts tests/fixtures/sku-casos.ts tests/unit/sku-montar.test.ts
git show --stat HEAD | tail -6
```

Expected: `Tests  80 passed (80)` (planejador rodou num espelho em 24/set: 80/80, tsc strict limpo); `GATES F3.5a: ok`; commit com os 4 arquivos.

---

## Task 2: Harness + suíte de integração (VERMELHA)  *(individual Opus)*

**Files:**
- Create: `tests/integration/mig-txn.ts` (cópia BYTE A BYTE da F3.1), `tests/integration/sku-automatico.test.ts`

**Interfaces:**
- Consumes: `tests/integration/db.ts` (`hasDb`, `dbUrl`, `withTx`, `comoUsuario`, `semUsuario`, `um`, `TENANT_TESTE`, `ehBancoLocal`); Task 1.
- Produces: 24 testes — anti-drift (5, parte A), colunas/gatilhos/tabela (5, parte B), geração/leitura/manual (10, parte C), permissões/ACL (3, parte C), inverso/idempotência (1, só `SKU_MIG_TXN=1`).

- [ ] **Step 1: Pré-condições da cópia (um teste por vez)**

```bash
ps -Ao pid,command | grep -E "[v]itest|[p]laywright"; echo "testes-checados"
docker ps --filter name=supabase_db_banco-local --format '{{.Status}}'
```

Expected: só `testes-checados`; `Up … (healthy)`. Senão: PARE (não subir/derrubar nada; avisar o controlador).

- [ ] **Step 2: Harness = cópia da F3.1**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
git show f31/planejamento-campos:tests/integration/mig-txn.ts > tests/integration/mig-txn.ts
shasum -a 256 tests/integration/mig-txn.ts | cut -c1-64
```

Expected: `276f36e67c900d562efb99eff9be3c2327182c31df24921dfb9780e6b573be0c`. (Se a F3.1 já juntou na principal, copiar de `feature/plan-tecido-a1:` — o gate compara com ela.)

- [ ] **Step 3: A suíte** — criar `tests/integration/sku-automatico.test.ts`:

```ts
/**
 * SKU AUTOMÁTICO — F3.5a (banco). Integração em BEGIN…ROLLBACK: NADA é gravado.
 * Plano: docs/superpowers/plans/2026-09-24-sku-automatico-f35a.md (Tasks 2–6).
 *
 * ⚠️ SÓ NA CÓPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). Em qualquer outro banco
 * a suíte inteira PULA (ehBancoLocal()); com SKU_MIG_TXN=1 fora da cópia ela RECUSA já na coleta (exigeBancoLocal()).
 * DDL em txn contra produção trava o app de todas as lojas mesmo com ROLLBACK (incidente 23/set).
 *
 * Dois modos:
 *  • SKU_MIG_TXN=1 — aplica a migration DENTRO da txn de cada teste (tests/integration/mig-txn.ts: tira BEGIN/COMMIT,
 *    NUNCA `\i` — incidente 15/set) → a cópia NÃO precisa ter a F3.5a. Segura AccessExclusive em tenant_config/modelos/
 *    cores durante o teste: rodar só com a cópia sem uso (nenhum QA/E2E de outra frente — Task 2 Step 1).
 *  • sem a variável — exige a F3.5a JÁ aplicada na cópia (ensaio da Task 7 / QA da Task 12); sem ela, pula.
 * Dados de teste: criados na própria txn (cores "SKU-T …", artigo, variantes, modelos, produtos) na Loja Teste.
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
type PgClient = Client;
import { hasDb, dbUrl, withTx, comoUsuario, semUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";
import {
  CASOS_CONFIG, CASOS_MONTAR, CASOS_RESOLVER, CASOS_SIGLA, CASOS_TAMANHO, CASOS_TAMANHOS_SKU,
} from "../fixtures/sku-casos";
import { parseTamanho } from "../../src/lib/tamanho";
import { montarSku, resolverSku } from "../../src/lib/sku-montar";

const MIG = "supabase/migrations/20261003100000_sku_automatico.sql";
const INV = "supabase/rollback/20261003100000_sku_automatico_down.sql";
const LOCAL = ehBancoLocal();
const MIG_TXN = process.env.SKU_MIG_TXN === "1";
if (MIG_TXN && hasDb) exigeBancoLocal(); // recusa na COLETA, antes de qualquer conexão

async function jaAplicada(): Promise<boolean> {
  if (!hasDb || !LOCAL || MIG_TXN) return false; // fora da cópia: nem conecta
  const c = new Client({ connectionString: dbUrl()!, ssl: false });
  await c.connect();
  try {
    const r = await c.query("SELECT to_regprocedure('public.gerar_skus_modelo(uuid,boolean)') IS NOT NULL AS ok");
    return r.rows[0]?.ok === true;
  } finally {
    await c.end();
  }
}
const PRONTO = hasDb && LOCAL && (MIG_TXN || (await jaAplicada()));

async function prepara(c: PgClient): Promise<void> {
  exigeBancoLocal();
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '60s'");
  if (MIG_TXN) await aplicarArquivo(c, MIG);
}

/** Roda e ESPERA erro; volta ao savepoint (a txn segue usável — o RAISE abortaria o resto do teste). */
async function falha(c: PgClient, sql: string, params: unknown[] = []): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT sku_falha");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT sku_falha");
    const err = e as { code?: string; message?: string };
    return { code: String(err.code ?? ""), message: String(err.message ?? "") };
  }
  await c.query("RELEASE SAVEPOINT sku_falha");
  throw new Error(`esperava erro e passou: ${sql}`);
}

const T = TENANT_TESTE;
const CFG = {
  partes: ["ref", "cor_base", "cor_apelido", "tamanho"],
  separadores: { "ref|cor_base": "-", "cor_apelido|tamanho": "-" },
  tamanho_padrao: "numero",
};
const TSKU = { "34": "34", "36": "36", "38": "38", PPP: "ppp", PP: "PP", P: "P" };
const GRADE = ["34|PPP", "36|PP", "38|P"];

async function lojaSku(c: PgClient, cfg: unknown = CFG, tsku: unknown = TSKU, grade: unknown = GRADE): Promise<void> {
  await c.query(
    "UPDATE public.tenant_config SET sku_config = $2::jsonb, tamanhos_sku = $3::jsonb, tamanhos_grade = $4::jsonb WHERE tenant_id = $1",
    [T, JSON.stringify(cfg), JSON.stringify(tsku), JSON.stringify(grade)],
  );
}
const novoId = async (c: PgClient, sql: string, p: unknown[]) => (await um<{ id: string }>(c, sql, p)).id;
async function grade(c: PgClient, modelo: string, n: number, g: Record<string, number>): Promise<void> {
  const total = Object.values(g).reduce((s, v) => s + v, 0);
  await c.query(
    "INSERT INTO public.modelo_grades (modelo_id, variante_numero, grades, grade_total) VALUES ($1, $2, $3::jsonb, $4)",
    [modelo, n, JSON.stringify(g), total],
  );
}
async function tecido1(c: PgClient, mt: string, vts: string[], desde = 1): Promise<void> {
  for (let i = 0; i < vts.length; i++) {
    await c.query(
      "INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1, $2, $3)",
      [mt, vts[i], desde + i],
    );
  }
}

type Cen = {
  corAm: string; corVd: string; corAmb: string; apeCan: string; apeMus: string; artigo: string;
  vtAm: string; vtAmCan: string; vtVdMus: string; vtAmb: string; interno: string; mt: string;
};
/** Loja Teste com o Formato CFG + interno "SKU-T Blusa" (REF SKU-T1): Tecido 1 = [Amarelo (AM), Amarelo+Canário
 *  (AM/CAN), Verde+Musgo (SEM siglas)]; grade v1 {34|PPP:2, 36|PP:1, 38|P:0}, v2 {34|PPP:1}, v3 {36|PP:1}. */
async function cenario(c: PgClient): Promise<Cen> {
  await lojaSku(c);
  const corAm = await novoId(c, "INSERT INTO public.cores (tenant_id, nome, sigla_sku) VALUES ($1, 'SKU-T Amarelo', ' am ') RETURNING id", [T]);
  const corVd = await novoId(c, "INSERT INTO public.cores (tenant_id, nome) VALUES ($1, 'SKU-T Verde') RETURNING id", [T]);
  const corAmb = await novoId(c, "INSERT INTO public.cores (tenant_id, nome, sigla_sku) VALUES ($1, 'SKU-T Âmbar', 'AM') RETURNING id", [T]);
  const apeCan = await novoId(c, "INSERT INTO public.cores_apelido (tenant_id, nome, cor_base_id, sigla_sku) VALUES ($1, 'SKU-T Canário', $2, 'can') RETURNING id", [T, corAm]);
  const apeMus = await novoId(c, "INSERT INTO public.cores_apelido (tenant_id, nome, cor_base_id) VALUES ($1, 'SKU-T Musgo', $2) RETURNING id", [T, corVd]);
  const artigo = await novoId(c, "INSERT INTO public.artigos (tenant_id, nome) VALUES ($1, 'SKU-T Tecido') RETURNING id", [T]);
  const vt = (cor: string, ape: string | null) =>
    novoId(c, "INSERT INTO public.variantes_tecido (tenant_id, artigo_id, cor_id, cor_apelido_id) VALUES ($1, $2, $3, $4) RETURNING id", [T, artigo, cor, ape]);
  const vtAm = await vt(corAm, null);
  const vtAmCan = await vt(corAm, apeCan);
  const vtVdMus = await vt(corVd, apeMus);
  const vtAmb = await vt(corAmb, null);
  const interno = await novoId(c, "INSERT INTO public.modelos (tenant_id, nome, ref, origem) VALUES ($1, 'SKU-T Blusa', 'SKU-T1', 'interno') RETURNING id", [T]);
  const mt = await novoId(c, "INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo) VALUES ($1, $2, 1, 'tecido') RETURNING id", [interno, artigo]);
  await tecido1(c, mt, [vtAm, vtAmCan, vtVdMus]);
  await grade(c, interno, 1, { "34|PPP": 2, "36|PP": 1, "38|P": 0 });
  await grade(c, interno, 2, { "34|PPP": 1 });
  await grade(c, interno, 3, { "36|PP": 1 });
  return { corAm, corVd, corAmb, apeCan, apeMus, artigo, vtAm, vtAmCan, vtVdMus, vtAmb, interno, mt };
}

async function rpc(c: PgClient, fn: string, args: unknown[]): Promise<any> {
  const ph = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await um<{ v: any }>(c, `SELECT public.${fn}(${ph}) AS v`, args)).v;
}
const gerar = (c: PgClient, m: string, regerar = false) => rpc(c, "gerar_skus_modelo", [m, regerar]);
const matriz = (c: PgClient, m: string) => rpc(c, "skus_modelo", [m]);
const linha = (mz: any, vkey: string, tkey: string) =>
  (mz.linhas as any[]).find((l) => l.variante_key === vkey && l.tamanho_key === tkey);
async function skus(c: PgClient, m: string): Promise<{ variante_key: string; tamanho_key: string; sku: string; manual: boolean }[]> {
  return (await c.query(
    "SELECT variante_key, tamanho_key, sku, manual FROM public.modelo_skus WHERE modelo_id = $1 ORDER BY sku COLLATE \"C\"", [m],
  )).rows;
}

// ─────────────────────────────── Task 2/3 — anti-drift TS × SQL ───────────────────────────────
describe.skipIf(!PRONTO)("SKU F3.5a — anti-drift TS × SQL (tests/fixtures/sku-casos.ts)", () => {
  it("parseTamanho/ladoTamanho ≡ _sku_tamanho_lados/_sku_tamanho_lado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const k of CASOS_TAMANHO) {
        const r = await um<any>(c,
          "SELECT l.numero, l.letra, public._sku_tamanho_lado($1, 'numero') AS ln, public._sku_tamanho_lado($1, 'letra') AS ll FROM public._sku_tamanho_lados($1) AS l",
          [k.entrada]);
        expect({ n: r.numero, l: r.letra, ln: r.ln, ll: r.ll }, JSON.stringify(k.entrada))
          .toEqual({ n: k.numero, l: k.letra, ln: k.ladoNumero, ll: k.ladoLetra });
        expect(parseTamanho(k.entrada)).toEqual({ numero: r.numero, letra: r.letra });
      }
    });
  });

  it("normalizarSigla ≡ _sku_norm_sigla", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const k of CASOS_SIGLA) {
        const r = await um<{ v: string | null }>(c, "SELECT public._sku_norm_sigla($1) AS v", [k.entrada]);
        expect(r.v, JSON.stringify(k.entrada)).toBe(k.esperado);
      }
    });
  });

  it("normalizarSkuConfig ≡ _sku_config_normaliza (valor canônico e MESMA mensagem de erro, P0001)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const k of CASOS_CONFIG) {
        const q = "SELECT public._sku_config_normaliza($1::jsonb) AS v";
        const p = [JSON.stringify(k.entrada)];
        if ("erro" in k) {
          const e = await falha(c, q, p);
          expect({ code: e.code, message: e.message }, JSON.stringify(k.entrada)).toEqual({ code: "P0001", message: k.erro });
        } else {
          expect((await um<any>(c, q, p)).v, JSON.stringify(k.entrada)).toEqual(k.esperado);
        }
      }
    });
  });

  it("normalizarTamanhosSku ≡ _sku_tamanhos_normaliza (valor e MESMA mensagem de erro, P0001)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const k of CASOS_TAMANHOS_SKU) {
        const q = "SELECT public._sku_tamanhos_normaliza($1::jsonb) AS v";
        const p = [JSON.stringify(k.entrada)];
        if ("erro" in k) {
          const e = await falha(c, q, p);
          expect({ code: e.code, message: e.message }, JSON.stringify(k.entrada)).toEqual({ code: "P0001", message: k.erro });
        } else {
          expect((await um<any>(c, q, p)).v, JSON.stringify(k.entrada)).toEqual(k.esperado);
        }
      }
    });
  });

  it("montarSku ≡ _sku_montar e resolverSku ≡ _sku_resolver", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const k of CASOS_MONTAR) {
        const r = await um<{ v: string }>(c, "SELECT public._sku_montar($1::jsonb, $2::jsonb) AS v", [JSON.stringify(k.cfg), JSON.stringify(k.valores)]);
        expect(r.v, JSON.stringify(k.valores)).toBe(k.esperado);
        expect(montarSku(k.cfg, k.valores)).toBe(r.v);
      }
      for (const k of CASOS_RESOLVER) {
        const e = k.entrada;
        const r = await um<{ v: unknown }>(c,
          "SELECT public._sku_resolver($1::jsonb, $2, $3::jsonb, $4::jsonb, $5, $6, $7::jsonb) AS v",
          [JSON.stringify(e.cfg), e.ref, e.cor ? JSON.stringify(e.cor) : null, e.apelido ? JSON.stringify(e.apelido) : null,
           e.tamanhoKey, e.tipo, e.tamanhosSku ? JSON.stringify(e.tamanhosSku) : null]);
        expect(r.v, `${e.tamanhoKey}/${e.tipo}`).toEqual(k.esperado);
        expect(resolverSku(e)).toEqual(r.v);
      }
    });
  });
});

// ─────────────────────────────── Task 4 — dados: normalização no salvar, handover, schema ───────────────────────────────
describe.skipIf(!PRONTO)("SKU F3.5a — colunas, gatilhos e tabela", () => {
  it("siglas de cor base/apelido normalizadas NO SALVAR (trim + maiúsculas; vazia = NULL)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      const sig = async (tab: string, id: string) => (await um<{ s: string | null }>(c, `SELECT sigla_sku AS s FROM public.${tab} WHERE id = $1`, [id])).s;
      expect(await sig("cores", k.corAm)).toBe("AM");
      expect(await sig("cores_apelido", k.apeCan)).toBe("CAN");
      await c.query("UPDATE public.cores SET sigla_sku = ' \t ' WHERE id = $1", [k.corAm]);
      expect(await sig("cores", k.corAm)).toBeNull();
      await c.query("UPDATE public.cores SET sigla_sku = ' x1 ' WHERE id = $1", [k.corAm]);
      expect(await sig("cores", k.corAm)).toBe("X1");
      await c.query("UPDATE public.cores_apelido SET sigla_sku = '' WHERE id = $1", [k.apeCan]);
      expect(await sig("cores_apelido", k.apeCan)).toBeNull();
    });
  });

  it("tenant_config: Formato do SKU e siglas de tamanho canonizados; inválido = P0001 em PT; o upsert genérico não dispara", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaSku(c, { ...CFG, lixo: true, separadores: { ...CFG.separadores, "ref|tamanho": "#" } });
      const r = await um<any>(c, "SELECT sku_config, tamanhos_sku FROM public.tenant_config WHERE tenant_id = $1", [T]);
      expect(r.sku_config).toEqual({
        partes: ["ref", "cor_base", "cor_apelido", "tamanho"],
        separadores: { "ref|cor_base": "-", "cor_apelido|tamanho": "-" },
        tamanho_padrao: "numero",
      });
      expect(r.tamanhos_sku).toEqual({ "34": "34", "36": "36", "38": "38", PPP: "PPP", PP: "PP", P: "P" });
      const e = await falha(c, "UPDATE public.tenant_config SET sku_config = '{\"partes\":[\"ref\",\"cor\"]}'::jsonb WHERE tenant_id = $1", [T]);
      expect(e).toEqual({ code: "P0001", message: 'Parte do SKU desconhecida: "cor".' });
      const e2 = await falha(c, "UPDATE public.tenant_config SET tamanhos_sku = '{\"34\": 34}'::jsonb WHERE tenant_id = $1", [T]);
      expect(e2).toEqual({ code: "P0001", message: "Sigla de tamanho inválida: 34." });
      await c.query("UPDATE public.tenant_config SET sku_config = '{\"partes\":[]}'::jsonb WHERE tenant_id = $1", [T]);
      expect((await um<any>(c, "SELECT sku_config FROM public.tenant_config WHERE tenant_id = $1", [T])).sku_config).toBeNull();
      // o upsert genérico da Config (sem as 2 colunas no SET) não passa pelo gatilho: ele é "UPDATE OF" as 2 colunas
      const def = (await um<{ d: string }>(c, "SELECT pg_get_triggerdef(oid) AS d FROM pg_trigger WHERE tgname = 'trg_tenant_config_sku'")).d;
      expect(def).toContain("BEFORE INSERT OR UPDATE OF sku_config, tamanhos_sku ON public.tenant_config");
    });
  });

  it("tamanho_tipo: CHECK letra|numero em modelos/produtos; NULL = padrão da loja", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      const e = await falha(c, "UPDATE public.modelos SET tamanho_tipo = 'grande' WHERE id = $1", [k.interno]);
      expect(e.code).toBe("23514");
      await c.query("UPDATE public.modelos SET tamanho_tipo = 'letra' WHERE id = $1", [k.interno]);
      await c.query("UPDATE public.modelos SET tamanho_tipo = NULL WHERE id = $1", [k.interno]);
      const e2 = await falha(c, "INSERT INTO public.produtos_acabados (tenant_id, nome, ref, tamanho_tipo) VALUES ($1, 'SKU-T x', 'SKU-PAX', 'm')", [T]);
      expect(e2.code).toBe("23514");
    });
  });

  it("handover: o 'Tamanho em' do produto passa ao modelo espelho quando o card nasce (só se o modelo não tem) e sai do produto; nunca cruza loja", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const pa = await novoId(c, "INSERT INTO public.produtos_acabados (tenant_id, nome, ref, tamanho_tipo) VALUES ($1, 'SKU-T PA', 'SKU-PA0', 'numero') RETURNING id", [T]);
      expect((await um<any>(c, "SELECT tamanho_tipo FROM public.produtos_acabados WHERE id = $1", [pa])).tamanho_tipo).toBe("numero");
      const m1 = await novoId(c, "INSERT INTO public.modelos (tenant_id, nome, ref, origem) VALUES ($1, 'SKU-T PA', 'SKU-PA0', 'revenda') RETURNING id", [T]);
      await c.query("UPDATE public.produtos_acabados SET modelo_id = $1 WHERE id = $2", [m1, pa]);
      expect((await um<any>(c, "SELECT tamanho_tipo FROM public.modelos WHERE id = $1", [m1])).tamanho_tipo).toBe("numero");
      expect((await um<any>(c, "SELECT tamanho_tipo FROM public.produtos_acabados WHERE id = $1", [pa])).tamanho_tipo).toBeNull();
      // vinculado: mudar no produto não cria 2ª fonte (modelo já tem valor → fica; produto limpo)
      await c.query("UPDATE public.produtos_acabados SET tamanho_tipo = 'letra' WHERE id = $1", [pa]);
      expect((await um<any>(c, "SELECT tamanho_tipo FROM public.modelos WHERE id = $1", [m1])).tamanho_tipo).toBe("numero");
      expect((await um<any>(c, "SELECT tamanho_tipo FROM public.produtos_acabados WHERE id = $1", [pa])).tamanho_tipo).toBeNull();
      // importado apontando p/ modelo de OUTRA loja: o modelo alheio NÃO é tocado
      const alheio = await um<{ id: string }>(c,
        "SELECT id FROM public.modelos WHERE tenant_id <> $1 AND tamanho_tipo IS NULL AND NOT EXISTS (SELECT 1 FROM public.produtos_importados p WHERE p.modelo_id = modelos.id) ORDER BY id LIMIT 1", [T]);
      expect(alheio?.id, "a cópia precisa de 1 modelo de outra loja").toBeTruthy();
      const pi = await novoId(c, "INSERT INTO public.produtos_importados (tenant_id, nome, ref, tamanho_tipo) VALUES ($1, 'SKU-T PI', 'SKU-PI0', 'letra') RETURNING id", [T]);
      await c.query("UPDATE public.produtos_importados SET modelo_id = $1 WHERE id = $2", [alheio.id, pi]);
      expect((await um<any>(c, "SELECT tamanho_tipo FROM public.modelos WHERE id = $1", [alheio.id])).tamanho_tipo).toBeNull();
      expect((await um<any>(c, "SELECT tamanho_tipo FROM public.produtos_importados WHERE id = $1", [pi])).tamanho_tipo).toBeNull();
    });
  });

  it("modelo_skus: UNIQUE compostas (tenant_id, sku) e (modelo_id, variante_key, tamanho_key); CASCADE com o modelo", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      const ins = "INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku) VALUES ($1, $2, $3, $4, $5)";
      await c.query(ins, [T, k.interno, k.vtAm, "34|PPP", "X-1"]);
      expect((await falha(c, ins, [T, k.interno, k.vtAmCan, "34|PPP", "X-1"])).code).toBe("23505");
      expect((await falha(c, ins, [T, k.interno, k.vtAm, "34|PPP", "X-2"])).code).toBe("23505");
      expect((await falha(c, ins, [T, k.interno, k.vtAm, "36|PP", "  "])).code).toBe("23514");
      await c.query("DELETE FROM public.modelos WHERE id = $1", [k.interno]); // filhas em CASCADE (grades, tecidos, skus)
      expect((await um<{ n: number }>(c, "SELECT count(*)::int AS n FROM public.modelo_skus WHERE modelo_id = $1", [k.interno])).n).toBe(0);
    });
  });
});

// ─────────────────────────────── Task 5 — geração, regerar, manual, leitura ───────────────────────────────
describe.skipIf(!PRONTO)("SKU F3.5a — gerar_skus_modelo / salvar_sku_manual / skus_modelo", () => {
  it("sem Formato na loja: 'sem_formato', nada gravado; sem REF: 'aguardando_ref', nada gravado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await c.query("UPDATE public.tenant_config SET sku_config = NULL WHERE tenant_id = $1", [T]);
      let r = await gerar(c, k.interno);
      expect([r.status, r.criados, r.conflitos]).toEqual(["sem_formato", 0, []]);
      await lojaSku(c);
      await c.query("UPDATE public.modelos SET ref = '  ' WHERE id = $1", [k.interno]);
      r = await gerar(c, k.interno, true);
      expect([r.status, r.criados, r.removidos]).toEqual(["aguardando_ref", 0, 0]);
      expect(await skus(c, k.interno)).toEqual([]);
    });
  });

  it("gera por variante do Tecido 1 × tamanho com qtd > 0; falta sigla ⇒ a linha não gera e volta em faltas[]", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      const r = await gerar(c, k.interno);
      expect(r.status).toBe("ok");
      expect(r.criados).toBe(3);
      expect(r.tamanho_tipo).toBe("numero"); // card sem valor = padrão da loja
      expect(await skus(c, k.interno)).toEqual([
        { variante_key: k.vtAm, tamanho_key: "34|PPP", sku: "SKU-T1-AM-34", manual: false },
        { variante_key: k.vtAm, tamanho_key: "36|PP", sku: "SKU-T1-AM-36", manual: false },
        { variante_key: k.vtAmCan, tamanho_key: "34|PPP", sku: "SKU-T1-AMCAN-34", manual: false },
      ]);
      expect(r.faltas).toHaveLength(2);
      expect(r.faltas).toEqual(expect.arrayContaining([
        { atributo: "cor_base", id: k.corVd, nome: "SKU-T Verde" },
        { atributo: "cor_apelido", id: k.apeMus, nome: "SKU-T Musgo" },
      ]));
      expect(linha(r, k.vtVdMus, "36|PP").estado).toBe("falta");
      expect(linha(r, k.vtAm, "34|PPP").estado).toBe("ok");
      expect(linha(r, k.vtAm, "38|P")).toBeUndefined(); // qtd 0 não entra
      expect((await matriz(c, k.interno)).linhas).toEqual(r.linhas); // leitura = o que a geração devolveu
    });
  });

  it("_regerar=false não mexe no que existe (Q2); _regerar=true recalcula SÓ as automáticas; manual nunca muda", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.interno);
      const id34 = (await um<{ id: string }>(c, "SELECT id FROM public.modelo_skus WHERE modelo_id = $1 AND variante_key = $2 AND tamanho_key = '34|PPP'", [k.interno, k.vtAm])).id;
      const man = await rpc(c, "salvar_sku_manual", [id34, "  MEU-1 ", null]);
      expect(man).toMatchObject({ id: id34, sku: "MEU-1", manual: true });
      await c.query("UPDATE public.cores SET sigla_sku = 'ama' WHERE id = $1", [k.corAm]);
      let r = await gerar(c, k.interno);
      expect([r.criados, r.atualizados]).toEqual([0, 0]);
      expect(linha(r, k.vtAm, "36|PP")).toMatchObject({ estado: "divergente", sku: "SKU-T1-AM-36", sku_previsto: "SKU-T1-AMA-36" });
      r = await gerar(c, k.interno, true);
      expect(r.atualizados).toBe(2);
      expect(await skus(c, k.interno)).toEqual([
        { variante_key: k.vtAm, tamanho_key: "34|PPP", sku: "MEU-1", manual: true },
        { variante_key: k.vtAm, tamanho_key: "36|PP", sku: "SKU-T1-AMA-36", manual: false },
        { variante_key: k.vtAmCan, tamanho_key: "34|PPP", sku: "SKU-T1-AMACAN-34", manual: false },
      ]);
      expect(linha(r, k.vtAm, "34|PPP")).toMatchObject({ estado: "manual", manual: true, sku_previsto: "SKU-T1-AMA-34" });
    });
  });

  it("regerar remove as AUTOMÁTICAS que saíram da grade e mantém as manuais (órfãs); gerar sem regerar não remove", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.interno);
      const id34 = (await um<{ id: string }>(c, "SELECT id FROM public.modelo_skus WHERE modelo_id = $1 AND variante_key = $2 AND tamanho_key = '34|PPP'", [k.interno, k.vtAm])).id;
      await rpc(c, "salvar_sku_manual", [id34, "MEU-34", null]);
      await c.query("UPDATE public.modelo_grades SET grades = '{\"34|PPP\": 0, \"36|PP\": 0}'::jsonb WHERE modelo_id = $1 AND variante_numero = 1", [k.interno]);
      let r = await gerar(c, k.interno);
      expect(r.removidos).toBe(0);
      expect(linha(r, k.vtAm, "36|PP").estado).toBe("orfa");
      r = await gerar(c, k.interno, true);
      expect(r.removidos).toBe(1);
      expect(linha(r, k.vtAm, "36|PP")).toBeUndefined();
      expect(linha(r, k.vtAm, "34|PPP")).toMatchObject({ estado: "orfa", manual: true, sku: "MEU-34" });
    });
  });

  it("conflito com OUTRO produto (mesma REF): não grava a linha e devolve conflitos[] com mensagem PT", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.interno);
      const m2 = await novoId(c, "INSERT INTO public.modelos (tenant_id, nome, ref, origem) VALUES ($1, 'SKU-T Blusa 2', 'SKU-T1', 'interno') RETURNING id", [T]);
      const mt2 = await novoId(c, "INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo) VALUES ($1, $2, 1, 'tecido') RETURNING id", [m2, k.artigo]);
      await tecido1(c, mt2, [k.vtAm]);
      await grade(c, m2, 1, { "34|PPP": 1 });
      const r = await gerar(c, m2);
      expect(r.criados).toBe(0);
      expect(r.conflitos).toHaveLength(1);
      expect(r.conflitos[0]).toMatchObject({ sku: "SKU-T1-AM-34", com_modelo_id: k.interno, variante_key: k.vtAm, tamanho_key: "34|PPP" });
      expect(r.conflitos[0].mensagem).toBe("SKU SKU-T1-AM-34 já existe em SKU-T Blusa (REF SKU-T1). Edite este SKU à mão ou mude a sigla.");
      expect(linha(r, k.vtAm, "34|PPP")).toMatchObject({ estado: "conflito", conflito_com: { modelo_id: k.interno, nome: "SKU-T Blusa", ref: "SKU-T1" } });
      expect(await skus(c, m2)).toEqual([]);
    });
  });

  it("conflito DENTRO do produto (duas cores com a mesma sigla): a 2ª linha não grava, mensagem 'repetido neste produto'", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await tecido1(c, k.mt, [k.vtAmb], 4);
      await grade(c, k.interno, 4, { "34|PPP": 1 });
      const r = await gerar(c, k.interno);
      expect(r.criados).toBe(3);
      expect(r.conflitos).toHaveLength(1);
      expect(r.conflitos[0]).toMatchObject({ variante_key: k.vtAmb, sku: "SKU-T1-AM-34", com_modelo_id: k.interno });
      expect(r.conflitos[0].mensagem).toMatch(/^SKU SKU-T1-AM-34 repetido neste produto/);
      expect(linha(r, k.vtAmb, "34|PPP").estado).toBe("conflito");
    });
  });

  it("revenda: variantes do Produto Acabado; 'Tamanho em' do card (letra) vence o padrão da loja (número)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await c.query("UPDATE public.cores SET sigla_sku = 'vd' WHERE id = $1", [k.corVd]);
      const pa = await novoId(c, "INSERT INTO public.produtos_acabados (tenant_id, nome, ref) VALUES ($1, 'SKU-T Vestido', 'SKU-PA1') RETURNING id", [T]);
      const rev = await novoId(c, "INSERT INTO public.modelos (tenant_id, nome, ref, origem, tamanho_tipo) VALUES ($1, 'SKU-T Vestido', 'SKU-R1', 'revenda', 'letra') RETURNING id", [T]);
      await c.query("UPDATE public.produtos_acabados SET modelo_id = $1 WHERE id = $2", [rev, pa]);
      const pv = (ordem: number, cor: string, ape: string | null) => novoId(c,
        "INSERT INTO public.produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, cor_id, cor_apelido_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [T, pa, ordem, cor, ape]);
      const pv1 = await pv(1, k.corAm, k.apeCan);
      const pv2 = await pv(2, k.corVd, null);
      await grade(c, rev, 1, { "38|P": 1 });
      await grade(c, rev, 2, { "36|PP": 2 });
      const r = await gerar(c, rev);
      expect([r.criados, r.tamanho_tipo, r.tamanho_tipo_card]).toEqual([2, "letra", "letra"]);
      expect(await skus(c, rev)).toEqual([
        { variante_key: pv1, tamanho_key: "38|P", sku: "SKU-R1-AMCAN-P", manual: false },
        { variante_key: pv2, tamanho_key: "36|PP", sku: "SKU-R1-VD-PP", manual: false },
      ]);
    });
  });

  it("importado: variantes do Produto Importado; grade única 'UN' sem sigla ⇒ SKU sem a parte do tamanho (D1)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      const pi = await novoId(c, "INSERT INTO public.produtos_importados (tenant_id, nome, ref) VALUES ($1, 'SKU-T Cinto', 'SKU-PI1') RETURNING id", [T]);
      const imp = await novoId(c, "INSERT INTO public.modelos (tenant_id, nome, ref, origem) VALUES ($1, 'SKU-T Cinto', 'SKU-I1', 'importado') RETURNING id", [T]);
      await c.query("UPDATE public.produtos_importados SET modelo_id = $1 WHERE id = $2", [imp, pi]);
      const iv1 = await novoId(c,
        "INSERT INTO public.produto_importado_variantes (tenant_id, produto_importado_id, ordem, cor_id) VALUES ($1, $2, 1, $3) RETURNING id",
        [T, pi, k.corAm]);
      await grade(c, imp, 1, { UN: 5 });
      const r = await gerar(c, imp);
      expect(r.criados).toBe(1);
      expect(await skus(c, imp)).toEqual([{ variante_key: iv1, tamanho_key: "UN", sku: "SKU-I1-AM", manual: false }]);
    });
  });

  it("tamanho solto: classificado sozinho (número/letra) e, sem o lado pedido, usa o outro; 'Tamanho em' do card muda o lado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await lojaSku(c, { ...CFG, tamanho_padrao: "letra" }, { "36": "36", PP: "PP", "34": "34", PPP: "PPP" }, ["36", "38", "PP", "P", "34|PPP"]);
      await c.query("UPDATE public.modelo_grades SET grades = '{\"36\": 1, \"PP\": 1, \"34|PPP\": 1}'::jsonb WHERE modelo_id = $1 AND variante_numero = 1", [k.interno]);
      let mz = await matriz(c, k.interno);
      expect(mz.tamanho_tipo).toBe("letra");
      expect(linha(mz, k.vtAm, "36").sku_previsto).toBe("SKU-T1-AM-36");
      expect(linha(mz, k.vtAm, "PP").sku_previsto).toBe("SKU-T1-AM-PP");
      expect(linha(mz, k.vtAm, "34|PPP").sku_previsto).toBe("SKU-T1-AM-PPP");
      await c.query("UPDATE public.modelos SET tamanho_tipo = 'numero' WHERE id = $1", [k.interno]);
      mz = await matriz(c, k.interno);
      expect(linha(mz, k.vtAm, "PP").sku_previsto).toBe("SKU-T1-AM-PP");
      expect(linha(mz, k.vtAm, "34|PPP").sku_previsto).toBe("SKU-T1-AM-34");
      expect(linha(mz, k.vtAm, "36|PP")).toBeUndefined();
      expect(linha(mz, k.vtAm, "34|PPP").estado).toBe("pendente");
    });
  });

  it("salvar_sku_manual: apara; vazio, repetido (outro produto / mesma linha do produto) e rev velho recusados em PT", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.interno);
      const idDe = async (vk: string, tk: string) => (await um<{ id: string; rev: number }>(c,
        "SELECT id, rev FROM public.modelo_skus WHERE modelo_id = $1 AND variante_key = $2 AND tamanho_key = $3", [k.interno, vk, tk]));
      const a = await idDe(k.vtAm, "34|PPP");
      const b = await idDe(k.vtAm, "36|PP");
      const q = "SELECT public.salvar_sku_manual($1, $2, $3) AS v";
      expect(await falha(c, q, [a.id, "   ", null])).toEqual({ code: "P0001", message: "Informe o SKU." });
      expect(await falha(c, q, [a.id, " SKU-T1-AM-36 ", null])).toEqual({ code: "P0001", message: "O SKU SKU-T1-AM-36 já está em outra linha deste produto." });
      const m2 = await novoId(c, "INSERT INTO public.modelos (tenant_id, nome, ref, origem) VALUES ($1, 'SKU-T Outro', 'SKU-T9', 'interno') RETURNING id", [T]);
      await c.query("INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku) VALUES ($1, $2, $3, '34|PPP', 'OUTRO-1')", [T, m2, k.vtAm]);
      expect(await falha(c, q, [a.id, "OUTRO-1", null])).toEqual({ code: "P0001", message: "O SKU OUTRO-1 já existe em SKU-T Outro (REF SKU-T9). Escolha outro." });
      expect((await falha(c, q, [b.id, "NOVO-36", b.rev + 7])).code).toBe("P0409");
      const ok = (await um<{ v: any }>(c, q, [b.id, "NOVO-36", b.rev])).v;
      expect(ok).toEqual({ id: b.id, sku: "NOVO-36", manual: true, rev: b.rev + 1 });
    });
  });
});

// ─────────────────────────────── Task 5 — permissões (spec §4.4) e ACL (invariante #9) ───────────────────────────────
describe.skipIf(!PRONTO)("SKU F3.5a — permissões e ACL", () => {
  it("wrapper: login → módulo → loja → permissão do Planejamento (ver p/ ler, editar p/ gerar/editar)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      const comum = await um<{ id: string; tenant_id: string }>(c,
        `SELECT u.id, u.tenant_id FROM public.users u
          WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'user')
            AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role <> 'user')
            AND u.tenant_id <> $1
          ORDER BY u.id LIMIT 1`, [T]);
      expect(comum?.id, "a cópia precisa de 1 usuário comum de outra loja").toBeTruthy();
      const q = "SELECT public.gerar_skus_modelo($1, false) AS v";
      const ler = "SELECT public.skus_modelo($1) AS v";
      await semUsuario(c);
      expect(await falha(c, q, [k.interno])).toEqual({ code: "42501", message: "Não autenticado." });
      await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: comum.id, role: "authenticated" })]);
      expect(await falha(c, q, [k.interno])).toEqual({ code: "42501", message: "Sem permissão para este modelo." });
      expect(await falha(c, q, ["00000000-0000-0000-0000-00000000f35a"])).toEqual({ code: "42501", message: "Sem permissão para este modelo." });
      await c.query("UPDATE public.users SET tenant_id = $1, papel_id = NULL WHERE id = $2", [T, comum.id]);
      await c.query("DELETE FROM public.user_permissions WHERE user_id = $1", [comum.id]);
      expect(await falha(c, ler, [k.interno])).toEqual({ code: "42501", message: "Sem permissão para ver SKUs (Planejamento de Produto)." });
      await c.query("INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, 'criacao_planejamento', true, false)", [comum.id, T]);
      expect((await um<any>(c, ler, [k.interno])).v.status).toBe("ok");
      expect(await falha(c, q, [k.interno])).toEqual({ code: "42501", message: "Sem permissão para editar SKUs (Planejamento de Produto)." });
      await c.query("UPDATE public.user_permissions SET pode_editar = true WHERE user_id = $1 AND pagina = 'criacao_planejamento'", [comum.id]);
      expect((await um<any>(c, q, [k.interno])).v.criados).toBe(3);
      const idSku = (await um<{ id: string }>(c, "SELECT id FROM public.modelo_skus WHERE modelo_id = $1 LIMIT 1", [k.interno])).id;
      expect((await um<any>(c, "SELECT public.salvar_sku_manual($1, 'P-1') AS v", [idSku])).v.manual).toBe(true);
      await c.query("UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || '{\"criacao\": false}'::jsonb WHERE tenant_id = $1", [T]);
      const modOff = { code: "42501", message: "Módulo Estilo & Engenharia não habilitado para esta loja." };
      expect(await falha(c, q, [k.interno])).toEqual(modOff);
      expect(await falha(c, ler, [k.interno])).toEqual(modOff);
      expect(await falha(c, "SELECT public.salvar_sku_manual($1, 'P-2') AS v", [idSku])).toEqual(modOff);
      await comoUsuario(c); // super admin: modelo inexistente = "Modelo não encontrado." (P0001)
      expect(await falha(c, q, ["00000000-0000-0000-0000-00000000f35a"])).toEqual({ code: "P0001", message: "Modelo não encontrado." });
    });
  });

  it("ACL: _core/cálculo/helpers/gatilhos sem EXECUTE p/ PUBLIC, anon e authenticated; RPCs só authenticated; tabela só SELECT", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const internas = [
        "_sku_norm_sigla(text)", "_sku_tamanho_lados(text)", "_sku_tamanho_lado(text,text)", "_sku_config_normaliza(jsonb)",
        "_sku_tamanhos_normaliza(jsonb)", "_sku_montar(jsonb,jsonb)", "_sku_resolver(jsonb,text,jsonb,jsonb,text,text,jsonb)",
        "_sku_guarda(uuid,boolean)", "_skus_modelo_calc(uuid)", "_skus_modelo_core(uuid)", "_gerar_skus_modelo_core(uuid,boolean)",
        "_salvar_sku_manual_core(uuid,text,integer)", "fn_sigla_sku_normaliza()", "fn_tenant_config_sku_normaliza()",
        "fn_produto_tamanho_tipo_handover()",
      ];
      const rpcs = ["skus_modelo(uuid)", "gerar_skus_modelo(uuid,boolean)", "salvar_sku_manual(uuid,text,integer)"];
      for (const f of internas) {
        const r = await um<any>(c,
          `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon, has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
                  EXISTS (SELECT 1 FROM aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid = $1::regprocedure),
                          acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = $1::regprocedure)))) a
                           WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico`, [`public.${f}`]);
        expect(r, f).toEqual({ anon: false, auth: false, publico: false });
      }
      for (const f of rpcs) {
        const r = await um<any>(c,
          "SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon, has_function_privilege('authenticated', $1, 'EXECUTE') AS auth", [`public.${f}`]);
        expect(r, f).toEqual({ anon: false, auth: true });
      }
      const t = await um<any>(c, `SELECT has_table_privilege('anon', 'public.modelo_skus', 'SELECT') AS anon_sel,
          has_table_privilege('authenticated', 'public.modelo_skus', 'SELECT') AS auth_sel,
          has_table_privilege('authenticated', 'public.modelo_skus', 'INSERT,UPDATE,DELETE') AS auth_esc,
          (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.modelo_skus'::regclass) AS rls,
          (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'modelo_skus') AS policies,
          (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'modelo_skus' AND permissive = 'RESTRICTIVE'
             AND coalesce(qual, with_check) LIKE '%tenant_module_enabled(''criacao''%') AS modgate`);
      expect(t).toEqual({ anon_sel: false, auth_sel: true, auth_esc: false, rls: true, policies: 4, modgate: 3 });
    });
  });

  it("como o PostgREST (ROLE authenticated): RPC funciona; _core e escrita direta na tabela = permission denied; SELECT só da loja", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await c.query("INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku) SELECT m.tenant_id, m.id, gen_random_uuid(), 'X', 'ALHEIO-1' FROM public.modelos m WHERE m.tenant_id <> $1 LIMIT 1", [T]);
      await c.query("SET LOCAL ROLE authenticated");
      expect((await um<any>(c, "SELECT public.gerar_skus_modelo($1, false) AS v", [k.interno])).v.criados).toBe(3);
      expect((await falha(c, "SELECT public._gerar_skus_modelo_core($1, true)", [k.interno])).code).toBe("42501");
      expect((await falha(c, "SELECT public._skus_modelo_calc($1)", [k.interno])).code).toBe("42501");
      expect((await falha(c, "INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku) VALUES ($1, $2, gen_random_uuid(), 'X', 'Y')", [T, k.interno])).code).toBe("42501");
      expect((await falha(c, "UPDATE public.modelo_skus SET sku = 'Z' WHERE modelo_id = $1", [k.interno])).code).toBe("42501");
      const vis = await um<{ meus: number; alheios: number }>(c,
        "SELECT count(*) FILTER (WHERE tenant_id = $1)::int AS meus, count(*) FILTER (WHERE tenant_id <> $1)::int AS alheios FROM public.modelo_skus", [T]);
      expect(vis).toEqual({ meus: 3, alheios: 0 });
      await c.query("RESET ROLE");
    });
  });
});

// ─────────────────────────────── Task 6 — inverso e idempotência (SÓ no modo SKU_MIG_TXN=1) ───────────────────────────────
describe.skipIf(!PRONTO || !MIG_TXN)("SKU F3.5a — inverso (round-trip) e idempotência", () => {
  const OBJETOS = `SELECT to_regclass('public.modelo_skus') IS NOT NULL AS tabela,
      (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace
         AND proname ~ '^(_sku_|_skus_modelo_|skus_modelo$|gerar_skus_modelo$|_gerar_skus_modelo_core$|salvar_sku_manual$|_salvar_sku_manual_core$|fn_sigla_sku_normaliza$|fn_tenant_config_sku_normaliza$|fn_produto_tamanho_tipo_handover$)') AS funcoes,
      (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal
         AND tgname IN ('trg_cores_sigla_sku','trg_cores_apelido_sigla_sku','trg_pa_tamanho_tipo','trg_pi_tamanho_tipo','trg_tenant_config_sku')) AS gatilhos,
      (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public'
         AND (table_name::text, column_name::text) IN (('cores','sigla_sku'),('cores_apelido','sigla_sku'),('tenant_config','tamanhos_sku'),
           ('tenant_config','sku_config'),('modelos','tamanho_tipo'),('produtos_acabados','tamanho_tipo'),('produtos_importados','tamanho_tipo'))) AS colunas`;

  it("aplicar 2× não dá erro; o inverso RECUSA com dado e sem confirmação; com confirmação apaga TUDO; reaplicar recria igual", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await aplicarArquivo(c, MIG); // 2ª aplicação na mesma txn: idempotente
      const cheio = { tabela: true, funcoes: 18, gatilhos: 5, colunas: 7 };
      expect(await um(c, OBJETOS)).toEqual(cheio);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.interno);
      await expect(aplicarArquivo(c, INV)).rejects.toThrow(/O inverso da F3\.5a APAGA \d+ dado\(s\) digitado\(s\)/);
      expect(await um(c, OBJETOS)).toEqual(cheio); // recusou inteiro (savepoint do harness)
      await c.query("SET LOCAL app.confirmo_apagar_skus = 'sim'");
      await aplicarArquivo(c, INV);
      expect(await um(c, OBJETOS)).toEqual({ tabela: false, funcoes: 0, gatilhos: 0, colunas: 0 });
      await aplicarArquivo(c, INV); // inverso idempotente
      await aplicarArquivo(c, MIG);
      expect(await um(c, OBJETOS)).toEqual(cheio);
    });
  });
});
```

- [ ] **Step 4: Vermelha (nos dois modos) + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres SKU_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/sku-automatico.test.ts 2>&1 | tail -5
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/integration/sku-automatico.test.ts 2>&1 | tail -3
DATABASE_URL="postgresql://x:x@127.0.0.1:1/nada" SKU_MIG_TXN=1 npx vitest run tests/integration/sku-automatico.test.ts 2>&1 | grep -E "só na cópia local|Error" | head -2
bash .superpowers/f35a/gates.sh
git add -- tests/integration/mig-txn.ts tests/integration/sku-automatico.test.ts
git commit --only -m "test(sku): F3.5a (2) — suíte de integração do SKU (só na cópia local; harness mig-txn copiado da F3.1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- tests/integration/mig-txn.ts tests/integration/sku-automatico.test.ts
git show --stat HEAD | tail -4
```

Expected: (1) `Tests  24 failed (24)` — todos param em `ENOENT … 20261003100000_sku_automatico.sql` (a migration ainda não existe); (2) `24 skipped` (sem a F3.5a na cópia e sem `SKU_MIG_TXN`, a suíte pula — e NÃO conecta fora da cópia); (3) o erro `DDL/migration só na cópia local …` já na coleta (a guarda funciona sem conectar); `GATES F3.5a: ok`.

---

## Task 3: Migration — parte [A] (helpers puros) + INVERSO inteiro  *(individual Opus)*

**Files:**
- Create: `supabase/migrations/20261003100000_sku_automatico.sql`, `supabase/rollback/20261003100000_sku_automatico_down.sql`

**Interfaces:**
- Produces (SQL, IMMUTABLE, EXECUTE revogado dos três): `_sku_norm_sigla(text)`, `_sku_tamanho_lados(text, OUT numero, OUT letra)`, `_sku_tamanho_lado(text, text)`, `_sku_config_normaliza(jsonb)`, `_sku_tamanhos_normaliza(jsonb)`, `_sku_montar(jsonb, jsonb)`, `_sku_resolver(jsonb, text, jsonb, jsonb, text, text, jsonb)` — espelhos byte a byte do Task 1. Os marcadores `-- ==== [PARTE C] …` e `-- ==== [PARTE B] …` ficam no arquivo (Tasks 5 e 4 inserem ACIMA de cada um).

- [ ] **Step 1: Criar a migration com a parte A** — `supabase/migrations/20261003100000_sku_automatico.sql`:

```sql
-- SKU automático — F3.5a (banco): siglas SKU, Formato do SKU, "Tamanho em", modelo_skus e RPCs de geração.
-- ============================================================================================================
-- Spec: docs/superpowers/specs/2026-09-24-sku-automatico-design.md (§4.1, §4.2, §4.4) · Plano:
-- docs/superpowers/plans/2026-09-24-sku-automatico-f35a.md (Tasks 3–5). Inverso pareado (DESTRUTIVO, pede
-- confirmação): supabase/rollback/20261003100000_sku_automatico_down.sql.
--
-- ADITIVA e IDEMPOTENTE (CREATE OR REPLACE / IF NOT EXISTS / DROP … IF EXISTS antes de CREATE TRIGGER|POLICY).
-- NÃO redefine NENHUMA função existente (tudo aqui é novo: 18 funções, 5 gatilhos, 1 tabela, 7 colunas).
-- Ordem (lição R1 da F1): funções primeiro; tabela nova + ALTERs de cores/cores_apelido/produtos/modelos/
-- tenant_config POR ÚLTIMO, logo antes do COMMIT — o ALTER pega AccessExclusive e tenant_config/modelos são
-- lidos pelas policies de TODAS as lojas. Em produção: aplica_v2 (lock_timeout 500 ms + transaction_timeout 3 s).
-- Partes: [A] helpers puros (espelhos de src/lib/tamanho.ts + src/lib/sku-montar.ts) · [C] cálculo, RPCs e ACL ·
-- [B] tabela modelo_skus, colunas e gatilhos (normalização no SALVAR + handover do "Tamanho em").

BEGIN;

-- ─────────────────────────── [A] Helpers PUROS (IMMUTABLE) — espelho TS, anti-drift ───────────────────────────

-- Sigla (cor base, cor apelido, lado do tamanho): trim (espaço/tab/CR/LF) + MAIÚSCULAS; vazia ⇒ NULL.
-- Espelho: normalizarSigla (src/lib/sku-montar.ts).
CREATE OR REPLACE FUNCTION public._sku_norm_sigla(_s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT nullif(upper(btrim(coalesce(_s, ''), E' \t\r\n')), '')
$function$;

-- "34|PPP" → (34, PPP); "PPP|34" → (34, PPP); solto: só dígitos → número, o resto → letra. Só o 1º "|" separa.
-- Espelho: parseTamanho (src/lib/tamanho.ts).
CREATE OR REPLACE FUNCTION public._sku_tamanho_lados(_t text, OUT numero text, OUT letra text)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_s text;
  v_i integer;
  v_a text;
  v_b text;
BEGIN
  numero := NULL;
  letra := NULL;
  v_s := btrim(coalesce(_t, ''), E' \t\r\n');
  IF v_s = '' THEN
    RETURN;
  END IF;
  v_i := strpos(v_s, '|');
  IF v_i = 0 THEN
    IF v_s ~ '^[0-9]+$' THEN numero := v_s; ELSE letra := v_s; END IF;
    RETURN;
  END IF;
  v_a := nullif(btrim(substr(v_s, 1, v_i - 1), E' \t\r\n'), '');
  v_b := nullif(btrim(substr(v_s, v_i + 1), E' \t\r\n'), '');
  IF v_a IS NOT NULL AND v_b IS NOT NULL THEN
    IF v_a !~ '^[0-9]+$' AND v_b ~ '^[0-9]+$' THEN
      numero := v_b; letra := v_a;
    ELSE
      numero := v_a; letra := v_b;
    END IF;
  ELSIF v_a IS NOT NULL THEN
    IF v_a ~ '^[0-9]+$' THEN numero := v_a; ELSE letra := v_a; END IF;
  ELSIF v_b IS NOT NULL THEN
    IF v_b ~ '^[0-9]+$' THEN numero := v_b; ELSE letra := v_b; END IF;
  END IF;
END
$function$;

-- Lado que vale no SKU: o do tipo pedido; sem esse lado (solto ou "UN"), o outro. Espelho: ladoTamanho.
CREATE OR REPLACE FUNCTION public._sku_tamanho_lado(_t text, _tipo text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN _tipo = 'numero' THEN coalesce(l.numero, l.letra) ELSE coalesce(l.letra, l.numero) END
    FROM public._sku_tamanho_lados(_t) AS l
$function$;

-- Formato do SKU canônico {partes, separadores, tamanho_padrao} ou NULL (sem partes = a loja não gera SKU).
-- RAISE P0001 com as MESMAS mensagens de normalizarSkuConfig (src/lib/sku-montar.ts).
CREATE OR REPLACE FUNCTION public._sku_config_normaliza(_c jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_partes jsonb;
  v_seps jsonb;
  v_out_partes jsonb := '[]'::jsonb;
  v_out_seps jsonb := '{}'::jsonb;
  v_p jsonb;
  v_t text;
  v_prev text := NULL;
  v_sep jsonb;
  v_s text;
  v_tipo text;
BEGIN
  IF _c IS NULL OR jsonb_typeof(_c) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(_c) <> 'object' THEN
    RAISE EXCEPTION 'Formato do SKU inválido.' USING ERRCODE = 'P0001';
  END IF;
  v_partes := _c -> 'partes';
  IF v_partes IS NULL OR jsonb_typeof(v_partes) = 'null' THEN
    v_partes := '[]'::jsonb;
  ELSIF jsonb_typeof(v_partes) <> 'array' THEN
    RAISE EXCEPTION 'Formato do SKU inválido: partes.' USING ERRCODE = 'P0001';
  END IF;
  FOR v_p IN SELECT e.value FROM jsonb_array_elements(v_partes) WITH ORDINALITY AS e(value, n) ORDER BY e.n LOOP
    IF jsonb_typeof(v_p) <> 'string' OR (v_p #>> '{}') NOT IN ('ref', 'cor_base', 'cor_apelido', 'tamanho') THEN
      RAISE EXCEPTION 'Parte do SKU desconhecida: %.', v_p::text USING ERRCODE = 'P0001';
    END IF;
    IF v_out_partes @> jsonb_build_array(v_p) THEN
      RAISE EXCEPTION 'Parte do SKU repetida: %.', v_p #>> '{}' USING ERRCODE = 'P0001';
    END IF;
    v_out_partes := v_out_partes || jsonb_build_array(v_p);
  END LOOP;
  IF jsonb_array_length(v_out_partes) = 0 THEN
    RETURN NULL;
  END IF;
  v_seps := _c -> 'separadores';
  IF v_seps IS NULL OR jsonb_typeof(v_seps) = 'null' THEN
    v_seps := '{}'::jsonb;
  ELSIF jsonb_typeof(v_seps) <> 'object' THEN
    RAISE EXCEPTION 'Formato do SKU inválido: separadores.' USING ERRCODE = 'P0001';
  END IF;
  FOR v_t IN SELECT e.value FROM jsonb_array_elements_text(v_out_partes) WITH ORDINALITY AS e(value, n) ORDER BY e.n LOOP
    IF v_prev IS NOT NULL THEN
      v_sep := v_seps -> (v_prev || '|' || v_t);
      IF v_sep IS NOT NULL AND jsonb_typeof(v_sep) <> 'null' THEN
        IF jsonb_typeof(v_sep) <> 'string' THEN
          RAISE EXCEPTION 'Separador do SKU inválido.' USING ERRCODE = 'P0001';
        END IF;
        v_s := v_sep #>> '{}';
        IF v_s ~ '\s' THEN
          RAISE EXCEPTION 'Separador do SKU não pode ter espaço.' USING ERRCODE = 'P0001';
        END IF;
        IF char_length(v_s) > 3 THEN
          RAISE EXCEPTION 'Separador do SKU: no máximo 3 caracteres.' USING ERRCODE = 'P0001';
        END IF;
        IF v_s <> '' THEN
          v_out_seps := v_out_seps || jsonb_build_object(v_prev || '|' || v_t, v_s);
        END IF;
      END IF;
    END IF;
    v_prev := v_t;
  END LOOP;
  v_tipo := coalesce(nullif(_c ->> 'tamanho_padrao', ''), 'letra');
  IF v_tipo NOT IN ('letra', 'numero') THEN
    RAISE EXCEPTION 'Tamanho padrão do SKU inválido (use letra ou número).' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('partes', v_out_partes, 'separadores', v_out_seps, 'tamanho_padrao', v_tipo);
END
$function$;

-- Mapa lado-do-tamanho → sigla canônico (chave aparada, sigla normalizada, vazias fora) ou NULL.
-- RAISE P0001 com as MESMAS mensagens de normalizarTamanhosSku.
CREATE OR REPLACE FUNCTION public._sku_tamanhos_normaliza(_m jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_k text;
  v_sig text;
  v_out jsonb := '{}'::jsonb;
BEGIN
  IF _m IS NULL OR jsonb_typeof(_m) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(_m) <> 'object' THEN
    RAISE EXCEPTION 'Siglas de tamanho inválidas.' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT e.key, e.value FROM jsonb_each(_m) AS e LOOP
    v_k := btrim(r.key, E' \t\r\n');
    CONTINUE WHEN v_k = '' OR jsonb_typeof(r.value) = 'null';
    IF jsonb_typeof(r.value) <> 'string' THEN
      RAISE EXCEPTION 'Sigla de tamanho inválida: %.', v_k USING ERRCODE = 'P0001';
    END IF;
    IF v_out ? v_k THEN
      RAISE EXCEPTION 'Sigla de tamanho repetida: %.', v_k USING ERRCODE = 'P0001';
    END IF;
    v_sig := public._sku_norm_sigla(r.value #>> '{}');
    CONTINUE WHEN v_sig IS NULL;
    v_out := v_out || jsonb_build_object(v_k, v_sig);
  END LOOP;
  RETURN CASE WHEN v_out = '{}'::jsonb THEN NULL ELSE v_out END;
END
$function$;

-- Junta as partes na ordem do formato: o separador anda com a parte que vem DEPOIS; parte vazia some com ele.
-- Espelho: montarSku.
CREATE OR REPLACE FUNCTION public._sku_montar(_cfg jsonb, _valores jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_p text;
  v_v text;
  v_anterior text := NULL;
  v_emitiu boolean := false;
  v_out text := '';
BEGIN
  IF _cfg IS NULL THEN
    RETURN '';
  END IF;
  FOR v_p IN SELECT e.value FROM jsonb_array_elements_text(coalesce(_cfg -> 'partes', '[]'::jsonb)) WITH ORDINALITY AS e(value, n)
             ORDER BY e.n LOOP
    v_v := coalesce(_valores ->> v_p, '');
    IF v_v <> '' THEN
      IF v_emitiu AND v_anterior IS NOT NULL THEN
        v_out := v_out || coalesce(_cfg -> 'separadores' ->> (v_anterior || '|' || v_p), '');
      END IF;
      v_out := v_out || v_v;
      v_emitiu := true;
    END IF;
    v_anterior := v_p;
  END LOOP;
  RETURN v_out;
END
$function$;

-- O SKU de UMA linha (variante × tamanho) ou as faltas de sigla (Q4), na ordem cor_base → cor_apelido → tamanho.
-- _cor/_apelido = {"id","nome","sigla"} ou NULL. Tamanho "UN" (grade única) sem sigla: a parte some (D1).
-- Espelho: resolverSku.
CREATE OR REPLACE FUNCTION public._sku_resolver(_cfg jsonb, _ref text, _cor jsonb, _apelido jsonb,
                                                _tamanho_key text, _tipo text, _tsku jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_usa jsonb;
  v_val jsonb := '{}'::jsonb;
  v_faltas jsonb := '[]'::jsonb;
  v_lado text;
  v_sig text;
  v_sku text;
BEGIN
  IF _cfg IS NULL THEN
    RETURN jsonb_build_object('sku', NULL::text, 'faltas', '[]'::jsonb);
  END IF;
  v_usa := coalesce(_cfg -> 'partes', '[]'::jsonb);
  IF v_usa ? 'ref' THEN
    v_val := v_val || jsonb_build_object('ref', btrim(coalesce(_ref, ''), E' \t\r\n'));
  END IF;
  IF v_usa ? 'cor_base' THEN
    IF _cor IS NULL OR jsonb_typeof(_cor) = 'null' THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('atributo', 'cor_base', 'id', NULL::text, 'nome', NULL::text));
    ELSIF coalesce(_cor ->> 'sigla', '') = '' THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('atributo', 'cor_base', 'id', _cor -> 'id', 'nome', _cor -> 'nome'));
    ELSE
      v_val := v_val || jsonb_build_object('cor_base', _cor ->> 'sigla');
    END IF;
  END IF;
  IF v_usa ? 'cor_apelido' AND _apelido IS NOT NULL AND jsonb_typeof(_apelido) <> 'null' THEN
    IF coalesce(_apelido ->> 'sigla', '') = '' THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('atributo', 'cor_apelido', 'id', _apelido -> 'id', 'nome', _apelido -> 'nome'));
    ELSE
      v_val := v_val || jsonb_build_object('cor_apelido', _apelido ->> 'sigla');
    END IF;
  END IF;
  IF v_usa ? 'tamanho' THEN
    v_lado := public._sku_tamanho_lado(_tamanho_key, _tipo);
    v_sig := CASE
               WHEN v_lado IS NULL OR _tsku IS NULL OR jsonb_typeof(_tsku) <> 'object' THEN NULL
               ELSE nullif(_tsku ->> v_lado, '')
             END;
    IF v_sig IS NOT NULL THEN
      v_val := v_val || jsonb_build_object('tamanho', v_sig);
    ELSIF v_lado IS NOT NULL AND v_lado <> 'UN' THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('atributo', 'tamanho', 'id', NULL::text, 'nome', v_lado));
    END IF;
  END IF;
  IF jsonb_array_length(v_faltas) > 0 THEN
    RETURN jsonb_build_object('sku', NULL::text, 'faltas', v_faltas);
  END IF;
  v_sku := public._sku_montar(_cfg, v_val);
  RETURN jsonb_build_object('sku', nullif(v_sku, ''), 'faltas', v_faltas);
END
$function$;

-- Invariante #9: helpers internos SEM EXECUTE para PUBLIC/anon/authenticated (só as funções DEFINER os chamam).
REVOKE EXECUTE ON FUNCTION
  public._sku_norm_sigla(text),
  public._sku_tamanho_lados(text),
  public._sku_tamanho_lado(text, text),
  public._sku_config_normaliza(jsonb),
  public._sku_tamanhos_normaliza(jsonb),
  public._sku_montar(jsonb, jsonb),
  public._sku_resolver(jsonb, text, jsonb, jsonb, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ==== [PARTE C] cálculo, RPCs e ACL entram ACIMA desta linha (Task 5) ====

-- ==== [PARTE B] tabela, colunas e gatilhos entram ACIMA desta linha (Task 4) ====

NOTIFY pgrst, 'reload schema';

COMMIT;
```

- [ ] **Step 2: Criar o inverso INTEIRO** (vale em qualquer estágio: tudo `IF EXISTS`) — `supabase/rollback/20261003100000_sku_automatico_down.sql`:

```sql
-- INVERSO da migration 20261003100000_sku_automatico (F3.5a) — ⚠️ DESTRUTIVO.
-- ============================================================================================================
-- APAGA TUDO o que a F3.5a guardou: as SIGLAS SKU digitadas em Cor base/Cor apelido (cores.sigla_sku,
-- cores_apelido.sigla_sku) e na Grade de Tamanhos (tenant_config.tamanhos_sku), o FORMATO DO SKU
-- (tenant_config.sku_config), o "TAMANHO EM" (modelos/produtos_acabados/produtos_importados.tamanho_tipo) e TODOS
-- os SKUs gerados E os editados à mão (tabela modelo_skus). Não há como recuperar sem o backup/export.
-- Com dado presente, RECUSA sem a confirmação explícita (só com OK do dono, DEPOIS do export — runbook Task 14):
--   export EXTRA_SQL="SET LOCAL app.confirmo_apagar_skus = 'sim';"   (o aplica_v2 injeta logo depois do BEGIN)
-- Idempotente (IF EXISTS em tudo) e válido em qualquer estágio da migration (parte A, A+C ou A+C+B).
-- Plano: docs/superpowers/plans/2026-09-24-sku-automatico-f35a.md (Task 3; round-trip na Task 6).

BEGIN;

DO $do$
DECLARE
  v_n bigint := 0;
  v_c bigint;
  r record;
BEGIN
  IF to_regclass('public.modelo_skus') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.modelo_skus' INTO v_c;
    v_n := v_n + v_c;
  END IF;
  FOR r IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND (c.table_name::text, c.column_name::text) IN (('cores', 'sigla_sku'), ('cores_apelido', 'sigla_sku'),
             ('tenant_config', 'tamanhos_sku'), ('tenant_config', 'sku_config'), ('modelos', 'tamanho_tipo'),
             ('produtos_acabados', 'tamanho_tipo'), ('produtos_importados', 'tamanho_tipo'))
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NOT NULL', r.table_name, r.column_name) INTO v_c;
    v_n := v_n + v_c;
  END LOOP;
  IF v_n > 0 AND coalesce(current_setting('app.confirmo_apagar_skus', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'O inverso da F3.5a APAGA % dado(s) digitado(s) (siglas SKU, Formato do SKU, "Tamanho em" e SKUs gerados/editados). Só com OK do dono e depois do export: SET LOCAL app.confirmo_apagar_skus = ''sim''.', v_n
      USING ERRCODE = 'P0001';
  END IF;
END
$do$;

DROP TRIGGER IF EXISTS trg_tenant_config_sku ON public.tenant_config;
DROP TRIGGER IF EXISTS trg_pa_tamanho_tipo ON public.produtos_acabados;
DROP TRIGGER IF EXISTS trg_pi_tamanho_tipo ON public.produtos_importados;
DROP TRIGGER IF EXISTS trg_cores_sigla_sku ON public.cores;
DROP TRIGGER IF EXISTS trg_cores_apelido_sigla_sku ON public.cores_apelido;

DROP FUNCTION IF EXISTS public.skus_modelo(uuid);
DROP FUNCTION IF EXISTS public.gerar_skus_modelo(uuid, boolean);
DROP FUNCTION IF EXISTS public.salvar_sku_manual(uuid, text, integer);
DROP FUNCTION IF EXISTS public._gerar_skus_modelo_core(uuid, boolean);
DROP FUNCTION IF EXISTS public._salvar_sku_manual_core(uuid, text, integer);
DROP FUNCTION IF EXISTS public._skus_modelo_core(uuid);
DROP FUNCTION IF EXISTS public._skus_modelo_calc(uuid);
DROP FUNCTION IF EXISTS public._sku_guarda(uuid, boolean);
DROP FUNCTION IF EXISTS public.fn_tenant_config_sku_normaliza();
DROP FUNCTION IF EXISTS public.fn_produto_tamanho_tipo_handover();
DROP FUNCTION IF EXISTS public.fn_sigla_sku_normaliza();
DROP FUNCTION IF EXISTS public._sku_resolver(jsonb, text, jsonb, jsonb, text, text, jsonb);
DROP FUNCTION IF EXISTS public._sku_montar(jsonb, jsonb);
DROP FUNCTION IF EXISTS public._sku_tamanhos_normaliza(jsonb);
DROP FUNCTION IF EXISTS public._sku_config_normaliza(jsonb);
DROP FUNCTION IF EXISTS public._sku_tamanho_lado(text, text);
DROP FUNCTION IF EXISTS public._sku_tamanho_lados(text);
DROP FUNCTION IF EXISTS public._sku_norm_sigla(text);

DROP TABLE IF EXISTS public.modelo_skus;

ALTER TABLE public.cores DROP COLUMN IF EXISTS sigla_sku;
ALTER TABLE public.cores_apelido DROP COLUMN IF EXISTS sigla_sku;
ALTER TABLE public.produtos_acabados DROP COLUMN IF EXISTS tamanho_tipo;
ALTER TABLE public.produtos_importados DROP COLUMN IF EXISTS tamanho_tipo;
ALTER TABLE public.modelos DROP COLUMN IF EXISTS tamanho_tipo;
ALTER TABLE public.tenant_config DROP COLUMN IF EXISTS sku_config, DROP COLUMN IF EXISTS tamanhos_sku;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

- [ ] **Step 3: Anti-drift verde (só a parte A)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
ps -Ao pid,command | grep -E "[v]itest|[p]laywright"; echo "testes-checados"
grep -c '^BEGIN;$' supabase/migrations/20261003100000_sku_automatico.sql supabase/rollback/20261003100000_sku_automatico_down.sql
grep -c '^COMMIT;$' supabase/migrations/20261003100000_sku_automatico.sql supabase/rollback/20261003100000_sku_automatico_down.sql
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres SKU_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/sku-automatico.test.ts -t "anti-drift" 2>&1 | tail -5
```

Expected: só `testes-checados`; `:1` nos 4 greps; `Tests  5 passed | 19 skipped (24)`. Falhou por erro de SQL: corrigir o mínimo + `desvios.md` (Global Constraints). Falhou por DIFERENÇA de valor TS × SQL: PARE — é drift de regra (controlador decide qual lado está certo, contra a spec).

- [ ] **Step 4: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
bash .superpowers/f35a/gates.sh
git add -- supabase/migrations/20261003100000_sku_automatico.sql supabase/rollback/20261003100000_sku_automatico_down.sql
git commit --only -m "feat(sku): F3.5a (3) — migration parte A (helpers puros _sku_*, espelho do TS) + inverso

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- supabase/migrations/20261003100000_sku_automatico.sql supabase/rollback/20261003100000_sku_automatico_down.sql
git show --stat HEAD | tail -4
```

---

## Task 4: Migration — parte [B] (tabela `modelo_skus`, colunas, gatilhos)  *(individual Opus)*

**Files:**
- Modify: `supabase/migrations/20261003100000_sku_automatico.sql` — inserir o bloco abaixo IMEDIATAMENTE ACIMA da linha `-- ==== [PARTE B] tabela, colunas e gatilhos entram ACIMA desta linha (Task 4) ====` (deixa uma linha em branco entre o bloco e o marcador; o marcador fica).

**Interfaces:**
- Produces: `fn_sigla_sku_normaliza()`, `fn_tenant_config_sku_normaliza()`, `fn_produto_tamanho_tipo_handover()` (DEFINER, revogadas dos três); `modelo_skus` (+ RLS/policies/grants); colunas `cores.sigla_sku`, `cores_apelido.sigla_sku`, `produtos_acabados.tamanho_tipo`, `produtos_importados.tamanho_tipo`, `modelos.tamanho_tipo`, `tenant_config.tamanhos_sku`, `tenant_config.sku_config`; gatilhos `trg_cores_sigla_sku`, `trg_cores_apelido_sigla_sku`, `trg_pa_tamanho_tipo`, `trg_pi_tamanho_tipo`, `trg_tenant_config_sku`.

- [ ] **Step 1: O bloco**

```sql
-- ─────────────────────────── [B] Gatilhos, tabela modelo_skus e colunas (POR ÚLTIMO) ───────────────────────────

-- Normalização da sigla NO SALVAR, no servidor (spec §4.1). GATILHO (e não RPC) porque Cadastro > Atributos grava
-- cores/cores_apelido DIRETO pela API (AttributeTab: insert/update na tabela) — o gatilho cobre esse caminho E
-- qualquer outro (importação, SQL). DEFINER: chama o helper revogado (#9) sem depender do EXECUTE do usuário.
CREATE OR REPLACE FUNCTION public.fn_sigla_sku_normaliza()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.sigla_sku := public._sku_norm_sigla(NEW.sigla_sku);
  RETURN NEW;
END
$function$;

-- tenant_config: valida/canoniza o Formato do SKU e as siglas de tamanho (mensagens PT, RAISE P0001). Só dispara
-- quando essas colunas estão no UPDATE — o upsert genérico da Config da Loja não as envia (não pesa nele).
CREATE OR REPLACE FUNCTION public.fn_tenant_config_sku_normaliza()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.sku_config := public._sku_config_normaliza(NEW.sku_config);
  NEW.tamanhos_sku := public._sku_tamanhos_normaliza(NEW.tamanhos_sku);
  RETURN NEW;
END
$function$;

-- "Tamanho em" do produto comprado ANTES do card existir (spec §4.1): quando o produto ganha o modelo espelho
-- (modelo_id), o valor PASSA ao modelo (só se o modelo ainda não tem um) e sai do produto — com espelho, a fonte
-- ÚNICA é modelos.tamanho_tipo. Mesma loja obrigatória (produtos_importados não tem gatilho de loja do espelho).
CREATE OR REPLACE FUNCTION public.fn_produto_tamanho_tipo_handover()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.modelo_id IS NOT NULL AND NEW.tamanho_tipo IS NOT NULL THEN
    UPDATE public.modelos m
       SET tamanho_tipo = NEW.tamanho_tipo
     WHERE m.id = NEW.modelo_id
       AND m.tenant_id = NEW.tenant_id
       AND m.tamanho_tipo IS NULL;
    NEW.tamanho_tipo := NULL;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE EXECUTE ON FUNCTION
  public.fn_sigla_sku_normaliza(),
  public.fn_tenant_config_sku_normaliza(),
  public.fn_produto_tamanho_tipo_handover()
  FROM PUBLIC, anon, authenticated;

-- SKUs gravados (1 linha por modelo × variante × tamanho). UNIQUE COMPOSTAS (seguras p/ o PostgREST — regra
-- "O que NÃO fazer": nunca UNIQUE em coluna única embedada): (tenant_id, sku) barra SKU repetido na loja;
-- (modelo_id, variante_key, tamanho_key) = 1 SKU por linha (e serve de índice por modelo_id).
-- Escrita SÓ pelas RPCs DEFINER: `authenticated` só tem SELECT (RLS por loja); os modgate RESTRICTIVE do módulo
-- `criacao` seguem o padrão de modelo_grades/modelo_tecidos (defesa em profundidade).
CREATE TABLE IF NOT EXISTS public.modelo_skus (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id),
  modelo_id    uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  variante_key uuid NOT NULL,
  tamanho_key  text NOT NULL,
  sku          text NOT NULL CONSTRAINT modelo_skus_sku_chk CHECK (btrim(sku) <> ''),
  manual       boolean NOT NULL DEFAULT false,
  gerado_em    timestamptz NOT NULL DEFAULT now(),
  rev          integer NOT NULL DEFAULT 0,
  CONSTRAINT modelo_skus_tenant_sku_key UNIQUE (tenant_id, sku),
  CONSTRAINT modelo_skus_modelo_variante_tamanho_key UNIQUE (modelo_id, variante_key, tamanho_key)
);
COMMENT ON TABLE public.modelo_skus IS
  'SKU por modelo × variante × tamanho (F3.5a). Escrita só por gerar_skus_modelo/salvar_sku_manual. variante_key = variantes_tecido.id (interno, Tecido 1) ou produto_*_variantes.id (revenda/importado); tamanho_key = chave inteira da grade ("34|PPP"). manual=true nunca é sobrescrito.';
ALTER TABLE public.modelo_skus ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON public.modelo_skus;
CREATE POLICY tenant_select ON public.modelo_skus FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
DROP POLICY IF EXISTS modgate_ins ON public.modelo_skus;
CREATE POLICY modgate_ins ON public.modelo_skus AS RESTRICTIVE FOR INSERT
  WITH CHECK (public.tenant_module_enabled('criacao'));
DROP POLICY IF EXISTS modgate_upd ON public.modelo_skus;
CREATE POLICY modgate_upd ON public.modelo_skus AS RESTRICTIVE FOR UPDATE
  USING (public.tenant_module_enabled('criacao'));
DROP POLICY IF EXISTS modgate_del ON public.modelo_skus;
CREATE POLICY modgate_del ON public.modelo_skus AS RESTRICTIVE FOR DELETE
  USING (public.tenant_module_enabled('criacao'));
REVOKE ALL ON public.modelo_skus FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.modelo_skus FROM authenticated;
GRANT SELECT ON public.modelo_skus TO authenticated;

-- Colunas (AccessExclusive curto em cada tabela — por isso no FIM do arquivo).
ALTER TABLE public.cores ADD COLUMN IF NOT EXISTS sigla_sku text;
COMMENT ON COLUMN public.cores.sigla_sku IS 'Sigla da cor base no SKU (F3.5a). Normalizada no salvar (trim + maiúsculas; vazia = NULL).';
DROP TRIGGER IF EXISTS trg_cores_sigla_sku ON public.cores;
CREATE TRIGGER trg_cores_sigla_sku BEFORE INSERT OR UPDATE OF sigla_sku ON public.cores
  FOR EACH ROW EXECUTE FUNCTION public.fn_sigla_sku_normaliza();

ALTER TABLE public.cores_apelido ADD COLUMN IF NOT EXISTS sigla_sku text;
COMMENT ON COLUMN public.cores_apelido.sigla_sku IS 'Sigla da cor apelido no SKU (F3.5a). Normalizada no salvar (trim + maiúsculas; vazia = NULL).';
DROP TRIGGER IF EXISTS trg_cores_apelido_sigla_sku ON public.cores_apelido;
CREATE TRIGGER trg_cores_apelido_sigla_sku BEFORE INSERT OR UPDATE OF sigla_sku ON public.cores_apelido
  FOR EACH ROW EXECUTE FUNCTION public.fn_sigla_sku_normaliza();

ALTER TABLE public.produtos_acabados ADD COLUMN IF NOT EXISTS tamanho_tipo text
  CONSTRAINT produtos_acabados_tamanho_tipo_chk CHECK (tamanho_tipo IN ('letra', 'numero'));
DROP TRIGGER IF EXISTS trg_pa_tamanho_tipo ON public.produtos_acabados;
CREATE TRIGGER trg_pa_tamanho_tipo BEFORE INSERT OR UPDATE OF modelo_id, tamanho_tipo ON public.produtos_acabados
  FOR EACH ROW EXECUTE FUNCTION public.fn_produto_tamanho_tipo_handover();

ALTER TABLE public.produtos_importados ADD COLUMN IF NOT EXISTS tamanho_tipo text
  CONSTRAINT produtos_importados_tamanho_tipo_chk CHECK (tamanho_tipo IN ('letra', 'numero'));
DROP TRIGGER IF EXISTS trg_pi_tamanho_tipo ON public.produtos_importados;
CREATE TRIGGER trg_pi_tamanho_tipo BEFORE INSERT OR UPDATE OF modelo_id, tamanho_tipo ON public.produtos_importados
  FOR EACH ROW EXECUTE FUNCTION public.fn_produto_tamanho_tipo_handover();

ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS tamanho_tipo text
  CONSTRAINT modelos_tamanho_tipo_chk CHECK (tamanho_tipo IN ('letra', 'numero'));
COMMENT ON COLUMN public.modelos.tamanho_tipo IS '"Tamanho em" do card (F3.5): letra | numero; NULL = padrão da loja (tenant_config.sku_config.tamanho_padrao).';

-- tenant_config POR ÚLTIMO (as policies RLS de todas as lojas leem esta tabela).
ALTER TABLE public.tenant_config ADD COLUMN IF NOT EXISTS tamanhos_sku jsonb;
ALTER TABLE public.tenant_config ADD COLUMN IF NOT EXISTS sku_config jsonb;
COMMENT ON COLUMN public.tenant_config.tamanhos_sku IS 'Sigla SKU de CADA LADO dos pares da grade ({"34":"34","PPP":"PPP"}) — F3.5a. tamanhos_grade não muda.';
COMMENT ON COLUMN public.tenant_config.sku_config IS 'Formato do SKU {partes, separadores {"a|b": sep}, tamanho_padrao} — F3.5a. NULL = a loja não gera SKU.';
DROP TRIGGER IF EXISTS trg_tenant_config_sku ON public.tenant_config;
CREATE TRIGGER trg_tenant_config_sku BEFORE INSERT OR UPDATE OF sku_config, tamanhos_sku ON public.tenant_config
  FOR EACH ROW EXECUTE FUNCTION public.fn_tenant_config_sku_normaliza();
```

- [ ] **Step 2: Verde (A + B)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
ps -Ao pid,command | grep -E "[v]itest|[p]laywright"; echo "testes-checados"
grep -n -- '-- ==== \[PARTE' supabase/migrations/20261003100000_sku_automatico.sql
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres SKU_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/sku-automatico.test.ts -t "anti-drift|colunas, gatilhos e tabela" 2>&1 | tail -5
```

Expected: os 2 marcadores, o `[PARTE C]` ANTES do `[PARTE B]`, e o bloco B entre eles; `Tests  10 passed | 14 skipped (24)`.

- [ ] **Step 3: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
bash .superpowers/f35a/gates.sh
git commit --only -m "feat(sku): F3.5a (4) — migration parte B (modelo_skus + RLS/modgate, siglas, tamanho_tipo, gatilhos de normalização e handover)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- supabase/migrations/20261003100000_sku_automatico.sql
git show --stat HEAD | tail -3
```

---

## Task 5: Migration — parte [C] (cálculo, RPCs, ACL) — suíte INTEIRA verde  *(individual Opus)*

**Files:**
- Modify: `supabase/migrations/20261003100000_sku_automatico.sql` — inserir o bloco abaixo IMEDIATAMENTE ACIMA da linha `-- ==== [PARTE C] cálculo, RPCs e ACL entram ACIMA desta linha (Task 5) ====` (linha em branco entre o bloco e o marcador).

**Interfaces:**
- Produces: `_sku_guarda(uuid, boolean)`, `_skus_modelo_calc(uuid)`, `_skus_modelo_core(uuid)`, `_gerar_skus_modelo_core(uuid, boolean)`, `_salvar_sku_manual_core(uuid, text, integer)` (revogadas dos três); `skus_modelo(uuid)`, `gerar_skus_modelo(uuid, boolean DEFAULT false)`, `salvar_sku_manual(uuid, text, integer DEFAULT NULL)` (só `authenticated`). Contrato no §4.1.

- [ ] **Step 1: O bloco**

```sql
-- ─────────────────────────── [C] Cálculo, leitura, geração, edição manual e ACL ───────────────────────────
-- Modelo de segurança (invariante #9 + spec §4.4): o WRAPPER checa login → módulo `criacao` → loja do modelo →
-- permissão (`criacao_planejamento`: ver p/ ler, editar p/ gerar/regerar/editar) via _sku_guarda; os `_core`
-- e o cálculo têm EXECUTE revogado dos TRÊS (PUBLIC, anon, authenticated).

-- Guarda comum dos 3 wrappers. _tenant = loja do modelo/SKU (NULL = não existe ⇒ "Sem permissão", sem vazar).
CREATE OR REPLACE FUNCTION public._sku_guarda(_tenant uuid, _editar boolean)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Estilo & Engenharia não habilitado para esta loja.' USING ERRCODE = '42501';
  END IF;
  IF _tenant IS DISTINCT FROM public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este modelo.' USING ERRCODE = '42501';
  END IF;
  IF _editar AND NOT public.user_can_edit('criacao_planejamento') THEN
    RAISE EXCEPTION 'Sem permissão para editar SKUs (Planejamento de Produto).' USING ERRCODE = '42501';
  END IF;
  IF NOT _editar AND NOT public.user_can_view('criacao_planejamento') THEN
    RAISE EXCEPTION 'Sem permissão para ver SKUs (Planejamento de Produto).' USING ERRCODE = '42501';
  END IF;
END
$function$;

-- As linhas (variante × tamanho com quantidade > 0) do modelo e o SKU PREVISTO de cada uma (ou as faltas).
-- Variantes: interno = variantes do Tecido 1 (variante_key = variantes_tecido.id — estável entre saves; o id de
-- modelo_tecido_variantes muda a cada salvar_modelo_bom); revenda = produto_acabado_variantes; importado =
-- produto_importado_variantes (variante_key = id da variante do produto). Grade: modelo_grades.variante_numero =
-- ordem da variante; tamanho_key = a chave INTEIRA da grade ("34|PPP"). Sem sku_config: nenhuma linha.
-- Não lê modelo_skus (quem decide gravar é o _gerar_skus_modelo_core).
CREATE OR REPLACE FUNCTION public._skus_modelo_calc(_modelo_id uuid)
RETURNS TABLE (variante_key uuid, variante_ordem integer, cor_nome text, apelido_nome text,
               tamanho_key text, tamanho_ordem integer, sku text, faltas jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH m AS (
    SELECT mo.id AS mid,
           btrim(coalesce(mo.ref, ''), E' \t\r\n') AS mref,
           coalesce(mo.origem, 'interno') AS morigem,
           coalesce(mo.tamanho_tipo, tc.sku_config ->> 'tamanho_padrao', 'letra') AS mtipo,
           tc.sku_config AS mcfg,
           tc.tamanhos_sku AS mtsku,
           CASE WHEN jsonb_typeof(tc.tamanhos_grade) = 'array' THEN tc.tamanhos_grade ELSE '[]'::jsonb END AS mgrade
      FROM public.modelos mo
      LEFT JOIN public.tenant_config tc ON tc.tenant_id = mo.tenant_id
     WHERE mo.id = _modelo_id
  ),
  vs AS (
    (SELECT DISTINCT ON (vt.id) vt.id AS vkey, mtv.ordem AS vordem, vt.cor_id AS vcor, vt.cor_apelido_id AS vapelido
       FROM m
       JOIN public.modelo_tecidos mt ON mt.modelo_id = m.mid AND mt.tipo = 'tecido' AND mt.numero = 1
       JOIN public.modelo_tecido_variantes mtv ON mtv.modelo_tecido_id = mt.id
       JOIN public.variantes_tecido vt ON vt.id = mtv.variante_tecido_id
      WHERE m.morigem = 'interno'
      ORDER BY vt.id, mtv.ordem)
    UNION ALL
    SELECT pv.id, pv.ordem, pv.cor_id, pv.cor_apelido_id
      FROM m
      JOIN public.produtos_acabados pa ON pa.modelo_id = m.mid
      JOIN public.produto_acabado_variantes pv ON pv.produto_acabado_id = pa.id
     WHERE m.morigem = 'revenda'
    UNION ALL
    SELECT iv.id, iv.ordem, iv.cor_id, iv.cor_apelido_id
      FROM m
      JOIN public.produtos_importados pi ON pi.modelo_id = m.mid
      JOIN public.produto_importado_variantes iv ON iv.produto_importado_id = pi.id
     WHERE m.morigem = 'importado'
  ),
  tam AS (
    SELECT vs.vkey AS tvkey, e.key AS tkey
      FROM vs
      JOIN public.modelo_grades g ON g.modelo_id = _modelo_id AND g.variante_numero = vs.vordem
      CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(g.grades) = 'object' THEN g.grades ELSE '{}'::jsonb END) AS e
     GROUP BY vs.vkey, e.key
    HAVING sum(CASE
                 WHEN jsonb_typeof(e.value) = 'number' THEN (e.value #>> '{}')::numeric
                 WHEN jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$'
                   THEN btrim(e.value #>> '{}')::numeric
                 ELSE 0
               END) > 0
  )
  SELECT vs.vkey,
         vs.vordem,
         c.nome::text,
         a.nome::text,
         tam.tkey,
         coalesce((SELECT o.n::integer
                     FROM jsonb_array_elements_text(m.mgrade) WITH ORDINALITY AS o(t, n)
                    WHERE o.t = tam.tkey
                    ORDER BY o.n
                    LIMIT 1), 9999),
         r.res ->> 'sku',
         r.res -> 'faltas'
    FROM m
    JOIN vs ON true
    JOIN tam ON tam.tvkey = vs.vkey
    LEFT JOIN public.cores c ON c.id = vs.vcor
    LEFT JOIN public.cores_apelido a ON a.id = vs.vapelido
    CROSS JOIN LATERAL (
      SELECT public._sku_resolver(
               m.mcfg,
               m.mref,
               CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id', c.id, 'nome', c.nome, 'sigla', c.sigla_sku) END,
               CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('id', a.id, 'nome', a.nome, 'sigla', a.sigla_sku) END,
               tam.tkey,
               m.mtipo,
               m.mtsku) AS res
    ) AS r
   WHERE m.mcfg IS NOT NULL;
END
$function$;

-- A MATRIZ do card (Variante × Tamanho) — leitura pura (a F3.5b mostra; nada é gravado aqui).
-- status: 'sem_formato' (loja sem sku_config) | 'aguardando_ref' (card sem REF) | 'ok'.
-- estado por linha: ok · manual · falta · pendente (ainda não gerado) · divergente (Regerar mudaria) ·
-- conflito (o SKU previsto já é de outra linha da loja — `conflito_com`) · vazio · orfa (gravado, fora da grade).
CREATE OR REPLACE FUNCTION public._skus_modelo_core(_modelo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_ref text;
  v_cfg jsonb;
  v_tipo_card text;
  v_tipo text;
  v_status text;
  v_linhas jsonb;
  v_faltas jsonb;
BEGIN
  SELECT mo.tenant_id, btrim(coalesce(mo.ref, ''), E' \t\r\n'), tc.sku_config, mo.tamanho_tipo
    INTO v_tenant, v_ref, v_cfg, v_tipo_card
    FROM public.modelos mo
    LEFT JOIN public.tenant_config tc ON tc.tenant_id = mo.tenant_id
   WHERE mo.id = _modelo_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  v_tipo := coalesce(v_tipo_card, v_cfg ->> 'tamanho_padrao', 'letra');
  v_status := CASE WHEN v_cfg IS NULL THEN 'sem_formato' WHEN v_ref = '' THEN 'aguardando_ref' ELSE 'ok' END;

  IF v_status <> 'ok' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'variante_key', s.variante_key, 'tamanho_key', s.tamanho_key, 'sku', s.sku,
             'manual', s.manual, 'rev', s.rev, 'estado', CASE WHEN s.manual THEN 'manual' ELSE 'salvo' END)
             ORDER BY s.variante_key, s.tamanho_key), '[]'::jsonb)
      INTO v_linhas
      FROM public.modelo_skus s
     WHERE s.modelo_id = _modelo_id;
    RETURN jsonb_build_object('status', v_status, 'tamanho_tipo', v_tipo, 'tamanho_tipo_card', v_tipo_card,
                              'linhas', v_linhas, 'faltas', '[]'::jsonb);
  END IF;

  WITH c AS (
    SELECT * FROM public._skus_modelo_calc(_modelo_id)
  ), s AS (
    SELECT sk.id, sk.variante_key, sk.tamanho_key, sk.sku, sk.manual, sk.rev
      FROM public.modelo_skus sk
     WHERE sk.modelo_id = _modelo_id
  ), j AS (
    SELECT c.variante_key AS c_vkey, s.variante_key AS s_vkey, c.variante_ordem AS vordem, c.cor_nome, c.apelido_nome,
           coalesce(c.tamanho_key, s.tamanho_key) AS tkey, c.tamanho_ordem AS tordem, c.sku AS previsto,
           coalesce(c.faltas, '[]'::jsonb) AS faltas, s.id AS sid, s.sku AS salvo, s.manual, s.rev
      FROM c
      FULL JOIN s ON s.variante_key = c.variante_key AND s.tamanho_key = c.tamanho_key
  ), k AS (
    SELECT j.*,
           (SELECT jsonb_build_object('modelo_id', o.modelo_id, 'nome', mo.nome, 'ref', mo.ref)
              FROM public.modelo_skus o
              JOIN public.modelos mo ON mo.id = o.modelo_id
             WHERE o.tenant_id = v_tenant AND o.sku = j.previsto AND o.id IS DISTINCT FROM j.sid
             LIMIT 1) AS conflito_com
      FROM j
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'variante_key', coalesce(k.c_vkey, k.s_vkey), 'variante_ordem', k.vordem,
           'cor_nome', k.cor_nome, 'apelido_nome', k.apelido_nome,
           'tamanho_key', k.tkey, 'tamanho_ordem', k.tordem,
           'id', k.sid, 'sku', k.salvo, 'manual', coalesce(k.manual, false), 'rev', k.rev,
           'sku_previsto', k.previsto, 'faltas', k.faltas, 'conflito_com', k.conflito_com,
           'estado', CASE
             WHEN k.c_vkey IS NULL THEN 'orfa'
             WHEN k.manual IS TRUE THEN 'manual'
             WHEN jsonb_array_length(k.faltas) > 0 THEN 'falta'
             WHEN k.previsto IS NULL THEN 'vazio'
             WHEN k.salvo = k.previsto THEN 'ok'
             WHEN k.conflito_com IS NOT NULL THEN 'conflito'
             WHEN k.salvo IS NULL THEN 'pendente'
             ELSE 'divergente'
           END)
           ORDER BY k.vordem NULLS LAST, k.tordem NULLS LAST, k.tkey), '[]'::jsonb)
    INTO v_linhas
    FROM k;

  SELECT coalesce(jsonb_agg(DISTINCT f.value ORDER BY f.value), '[]'::jsonb)
    INTO v_faltas
    FROM jsonb_array_elements(v_linhas) AS l(value)
    CROSS JOIN LATERAL jsonb_array_elements(l.value -> 'faltas') AS f(value)
   WHERE l.value ->> 'estado' = 'falta';

  RETURN jsonb_build_object('status', v_status, 'tamanho_tipo', v_tipo, 'tamanho_tipo_card', v_tipo_card,
                            'linhas', v_linhas, 'faltas', v_faltas);
END
$function$;

-- Gera (1ª vez: _regerar=false só cria o que falta) ou regera (_regerar=true: recalcula as AUTOMÁTICAS e remove
-- as automáticas que saíram da grade). Linha manual: NUNCA tocada (Q2). Falta sigla: não gera a linha (Q4).
-- SKU igual a outro da loja (UNIQUE tenant_id+sku): não grava a linha e devolve em `conflitos` (mensagem PT).
-- Devolve a MATRIZ (_skus_modelo_core) + criados/atualizados/removidos/conflitos.
CREATE OR REPLACE FUNCTION public._gerar_skus_modelo_core(_modelo_id uuid, _regerar boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_tenant uuid;
  v_ref text;
  v_cfg jsonb;
  l record;
  v_id uuid;
  v_sku text;
  v_manual boolean;
  v_criados integer := 0;
  v_atualizados integer := 0;
  v_removidos integer := 0;
  v_conflitos jsonb := '[]'::jsonb;
  v_com_modelo uuid;
  v_com_nome text;
  v_com_ref text;
BEGIN
  SELECT mo.tenant_id, btrim(coalesce(mo.ref, ''), E' \t\r\n'), tc.sku_config
    INTO v_tenant, v_ref, v_cfg
    FROM public.modelos mo
    LEFT JOIN public.tenant_config tc ON tc.tenant_id = mo.tenant_id
   WHERE mo.id = _modelo_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  -- Uma geração por modelo de cada vez (duas abas/pessoas no mesmo card esperam em fila).
  PERFORM pg_advisory_xact_lock(hashtextextended('sku_modelo:' || _modelo_id::text, 0));

  IF v_cfg IS NOT NULL AND v_ref <> '' THEN
    IF _regerar THEN
      -- Automáticas que saíram da grade (variante trocada/removida, tamanho zerado) saem ANTES de gerar: senão o
      -- SKU delas barraria o da linha nova igual (ex.: trocou o tecido do Tecido 1 mantendo as cores). Manual: nunca.
      DELETE FROM public.modelo_skus s
       WHERE s.modelo_id = _modelo_id
         AND NOT s.manual
         AND (s.variante_key, s.tamanho_key) NOT IN (
               SELECT c.variante_key, c.tamanho_key FROM public._skus_modelo_calc(_modelo_id) AS c);
      GET DIAGNOSTICS v_removidos = ROW_COUNT;
    END IF;

    FOR l IN SELECT c.variante_key, c.tamanho_key, c.sku
               FROM public._skus_modelo_calc(_modelo_id) AS c
              ORDER BY c.variante_ordem, c.tamanho_ordem, c.tamanho_key LOOP
      v_id := NULL;
      v_sku := NULL;
      v_manual := NULL;
      SELECT s.id, s.sku, s.manual INTO v_id, v_sku, v_manual
        FROM public.modelo_skus s
       WHERE s.modelo_id = _modelo_id AND s.variante_key = l.variante_key AND s.tamanho_key = l.tamanho_key;
      CONTINUE WHEN v_manual IS TRUE;                                          -- editado à mão: nunca (Q2)
      CONTINUE WHEN l.sku IS NULL;                                             -- falta sigla (Q4) / vazio
      CONTINUE WHEN v_id IS NOT NULL AND (NOT _regerar OR v_sku = l.sku);      -- fixo (Q2) ou já igual
      BEGIN
        IF v_id IS NULL THEN
          INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku, manual, gerado_em)
          VALUES (v_tenant, _modelo_id, l.variante_key, l.tamanho_key, l.sku, false, now());
          v_criados := v_criados + 1;
        ELSE
          UPDATE public.modelo_skus SET sku = l.sku, gerado_em = now(), rev = rev + 1 WHERE id = v_id;
          v_atualizados := v_atualizados + 1;
        END IF;
      EXCEPTION WHEN unique_violation THEN
        v_com_modelo := NULL;
        v_com_nome := NULL;
        v_com_ref := NULL;
        SELECT o.modelo_id, mo.nome, mo.ref INTO v_com_modelo, v_com_nome, v_com_ref
          FROM public.modelo_skus o
          JOIN public.modelos mo ON mo.id = o.modelo_id
         WHERE o.tenant_id = v_tenant AND o.sku = l.sku
         LIMIT 1;
        v_conflitos := v_conflitos || jsonb_build_array(jsonb_build_object(
          'variante_key', l.variante_key, 'tamanho_key', l.tamanho_key, 'sku', l.sku,
          'com_modelo_id', v_com_modelo, 'com_nome', v_com_nome, 'com_ref', v_com_ref,
          'mensagem', CASE
            WHEN v_com_modelo = _modelo_id THEN
              format('SKU %s repetido neste produto: duas linhas dão o mesmo SKU. Mude uma sigla ou edite um deles à mão.', l.sku)
            ELSE
              format('SKU %s já existe em %s (REF %s). Edite este SKU à mão ou mude a sigla.', l.sku,
                     coalesce(v_com_nome, 'outro produto'), coalesce(nullif(btrim(v_com_ref), ''), '—'))
          END));
      END;
    END LOOP;
  END IF;

  RETURN public._skus_modelo_core(_modelo_id)
      || jsonb_build_object('criados', v_criados, 'atualizados', v_atualizados, 'removidos', v_removidos,
                            'conflitos', v_conflitos);
END
$function$;

-- Edição manual de UM SKU: grava aparado, marca manual=true (nunca mais é sobrescrito, nem pelo Regerar).
-- Mesma UNIQUE da loja (mensagem PT). `_rev_base` (opcional) = trava otimista da linha (P0409).
-- NÃO trava depois do envio à Explosão (spec §4.2: o SKU é identidade comercial do Planejamento).
CREATE OR REPLACE FUNCTION public._salvar_sku_manual_core(_id uuid, _sku text, _rev_base integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sku text := btrim(coalesce(_sku, ''), E' \t\r\n');
  v_tenant uuid;
  v_modelo uuid;
  v_rev integer;
  v_com_modelo uuid;
  v_com_nome text;
  v_com_ref text;
BEGIN
  IF v_sku = '' THEN
    RAISE EXCEPTION 'Informe o SKU.' USING ERRCODE = 'P0001';
  END IF;
  SELECT s.tenant_id, s.modelo_id, s.rev INTO v_tenant, v_modelo, v_rev
    FROM public.modelo_skus s
   WHERE s.id = _id
     FOR UPDATE;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'SKU não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF _rev_base IS NOT NULL AND v_rev IS DISTINCT FROM _rev_base THEN
    RAISE EXCEPTION 'conflito_versao: o SKU foi alterado por outra pessoa' USING ERRCODE = 'P0409';
  END IF;
  BEGIN
    UPDATE public.modelo_skus s
       SET sku = v_sku, manual = true, gerado_em = now(), rev = s.rev + 1
     WHERE s.id = _id
    RETURNING s.rev INTO v_rev;
  EXCEPTION WHEN unique_violation THEN
    SELECT o.modelo_id, mo.nome, mo.ref INTO v_com_modelo, v_com_nome, v_com_ref
      FROM public.modelo_skus o
      JOIN public.modelos mo ON mo.id = o.modelo_id
     WHERE o.tenant_id = v_tenant AND o.sku = v_sku AND o.id <> _id
     LIMIT 1;
    IF v_com_modelo = v_modelo THEN
      RAISE EXCEPTION 'O SKU % já está em outra linha deste produto.', v_sku USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'O SKU % já existe em % (REF %). Escolha outro.', v_sku, coalesce(v_com_nome, 'outro produto'),
      coalesce(nullif(btrim(v_com_ref), ''), '—') USING ERRCODE = 'P0001';
  END;
  RETURN jsonb_build_object('id', _id, 'sku', v_sku, 'manual', true, 'rev', v_rev);
END
$function$;

-- ── Wrappers públicos (PostgREST) ──
CREATE OR REPLACE FUNCTION public.skus_modelo(_modelo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT mo.tenant_id INTO v_tenant FROM public.modelos mo WHERE mo.id = _modelo_id;
  PERFORM public._sku_guarda(v_tenant, false);
  RETURN public._skus_modelo_core(_modelo_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.gerar_skus_modelo(_modelo_id uuid, _regerar boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT mo.tenant_id INTO v_tenant FROM public.modelos mo WHERE mo.id = _modelo_id;
  PERFORM public._sku_guarda(v_tenant, true);
  RETURN public._gerar_skus_modelo_core(_modelo_id, coalesce(_regerar, false));
END
$function$;

CREATE OR REPLACE FUNCTION public.salvar_sku_manual(_id uuid, _sku text, _rev_base integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT s.tenant_id INTO v_tenant FROM public.modelo_skus s WHERE s.id = _id;
  PERFORM public._sku_guarda(v_tenant, true);
  RETURN public._salvar_sku_manual_core(_id, _sku, _rev_base);
END
$function$;

-- Invariante #9 — revogar dos TRÊS; conferido por has_function_privilege (testes + G-migration).
REVOKE EXECUTE ON FUNCTION
  public._sku_guarda(uuid, boolean),
  public._skus_modelo_calc(uuid),
  public._skus_modelo_core(uuid),
  public._gerar_skus_modelo_core(uuid, boolean),
  public._salvar_sku_manual_core(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION
  public.skus_modelo(uuid),
  public.gerar_skus_modelo(uuid, boolean),
  public.salvar_sku_manual(uuid, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.skus_modelo(uuid),
  public.gerar_skus_modelo(uuid, boolean),
  public.salvar_sku_manual(uuid, text, integer)
  TO authenticated;
```

- [ ] **Step 2: Suíte INTEIRA verde (inclui o inverso e a idempotência)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
ps -Ao pid,command | grep -E "[v]itest|[p]laywright"; echo "testes-checados"
grep -c 'CREATE OR REPLACE FUNCTION public\.' supabase/migrations/20261003100000_sku_automatico.sql
grep -c 'CREATE TRIGGER ' supabase/migrations/20261003100000_sku_automatico.sql
grep -nE '\\i |psql -f' supabase/migrations/20261003100000_sku_automatico.sql supabase/rollback/20261003100000_sku_automatico_down.sql tests/integration/sku-automatico.test.ts; echo "sem-\\i-checado"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres SKU_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/sku-automatico.test.ts 2>&1 | tail -6
```

Expected: `18` funções, `5` gatilhos, nenhum `\i`/`psql -f` (só `sem-\i-checado`); `Tests  24 passed (24)`. A montagem final (A → C → B) é a que o planejador conferiu com script (§9).

- [ ] **Step 3: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
bash .superpowers/f35a/gates.sh
git commit --only -m "feat(sku): F3.5a (5) — migration parte C (_skus_modelo_calc, gerar_skus_modelo, salvar_sku_manual, skus_modelo; wrapper+_core, REVOKE dos três)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- supabase/migrations/20261003100000_sku_automatico.sql
git show --stat HEAD | tail -3
```

---

## Task 6: Ensaio geral na CÓPIA — aplicar de verdade → verificar → desfazer → reaplicar → desfazer  *(controlador executa; individual Opus revisa o log)*

**Files:** nenhum no git. Cria `.superpowers/f35a/mig/ensaio-local.sh` e grava `.superpowers/f35a/mig/md5-{mig,inv}.txt` (referência do QA e da produção).

**Por quê:** prova a receita `aplica_v2` (o MESMO caminho da produção) com `lock_timeout`/`transaction_timeout`, mede o tempo que a migration segura lock, prova que NENHUMA função pré-existente muda (md5) e roda a suíte contra os objetos APLICADOS (sem harness). Termina com a cópia LIMPA.

- [ ] **Step 1: O script** — criar `.superpowers/f35a/mig/ensaio-local.sh`:

```bash
#!/usr/bin/env bash
# ENSAIO GERAL da F3.5a na CÓPIA LOCAL (Task 6): backup → IDA real → objetos/ACL/funções pré-existentes → suíte com os
# objetos APLICADOS → VOLTA → REIDA → VOLTA. Termina com a cópia LIMPA (sem a F3.5a), igual a antes.
# Uso (raiz da worktree): bash .superpowers/f35a/mig/ensaio-local.sh 2>&1 | tee .superpowers/f35a/logs/ensaio.log
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
source .superpowers/f35a/mig/aplica.sh || exit 1
S=.superpowers/f35a
BK="/Users/sunglee/PLM + Criação/banco-local/backups"
if ps -Ao pid,command | grep -E "[v]itest|[p]laywright"; then echo "PARE: há teste rodando (a cópia é compartilhada — um por vez)"; exit 1; fi
docker ps --filter name=supabase_db_banco-local --format '{{.Status}}' | grep -q '^Up' || { echo "PARE: cópia local fora do ar"; exit 1; }
git diff --quiet HEAD -- "$MIG" "$INV" || { echo "PARE: SQL da F3.5a com alteração não commitada"; exit 1; }
espera "$LOCAL" "$OBJ_F35A" "0|0|0|0" "cópia SEM a F3.5a" || exit 1
ativ_vazio "$LOCAL" || exit 1
CONT0="$(psql "$LOCAL" -X -A -t -c "$CONT")"
FN0="$(psql "$LOCAL" -X -A -t -c "$FN_PRE")"
echo "antes: contagens $CONT0 · funções pré-existentes $FN0" | tee "$S/logs/ensaio-antes.txt"
mkdir -p "$BK"
F="$BK/pre-f35a-ensaio-$(date +%F-%H%M%S).dump"
docker exec -e PGPASSWORD=postgres supabase_db_banco-local pg_dump -h 127.0.0.1 -U supabase_admin -d postgres -Fc > "$F" && [ -s "$F" ] \
  || { echo "PARE: backup falhou"; rm -f "$F"; exit 1; }
echo "backup: $F ($(du -h "$F" | cut -f1))"
volta() {
  export EXTRA_SQL="SET LOCAL app.confirmo_apagar_skus = 'sim';"
  ativ_vazio "$LOCAL" && aplica_v2 "$LOCAL" "$INV"
  local rc=$?
  unset EXTRA_SQL
  return $rc
}
aplica_v2 "$LOCAL" "$MIG" || exit 1
espera "$LOCAL" "$OBJ_F35A" "18|5|1|7" "IDA: objetos da F3.5a" || { volta; exit 1; }
espera "$LOCAL" "$ACL_F35A" "0|0|0" "IDA: ACL (#9)" || { volta; exit 1; }
espera "$LOCAL" "$FN_PRE" "$FN0" "IDA: nenhuma função pré-existente mudou" || { volta; exit 1; }
DATABASE_URL="$LOCAL" npx vitest run --no-file-parallelism tests/integration/sku-automatico.test.ts > "$S/logs/ensaio-suite.log" 2>&1
tail -6 "$S/logs/ensaio-suite.log"
grep -qE "Tests +23 passed \| 1 skipped" "$S/logs/ensaio-suite.log" \
  || { echo "FALHOU: com os objetos aplicados a suíte tem de dar 23 passed | 1 skipped (round-trip só no SKU_MIG_TXN=1)"; volta; exit 1; }
volta || exit 1
espera "$LOCAL" "$OBJ_F35A" "0|0|0|0" "VOLTA: cópia sem a F3.5a" || exit 1
espera "$LOCAL" "$CONT" "$CONT0" "VOLTA: contagens = antes" || exit 1
espera "$LOCAL" "$FN_PRE" "$FN0" "VOLTA: funções pré-existentes = antes" || exit 1
aplica_v2 "$LOCAL" "$MIG" || exit 1
espera "$LOCAL" "$OBJ_F35A" "18|5|1|7" "REIDA: objetos" || { volta; exit 1; }
volta || exit 1
espera "$LOCAL" "$OBJ_F35A" "0|0|0|0" "VOLTA 2" && espera "$LOCAL" "$CONT" "$CONT0" "VOLTA 2: contagens" \
  && espera "$LOCAL" "$FN_PRE" "$FN0" "VOLTA 2: funções pré-existentes" || exit 1
md5 -q "$MIG" > "$S/mig/md5-mig.txt"; md5 -q "$INV" > "$S/mig/md5-inv.txt"
echo "== ENSAIO F3.5a OK — cópia limpa; backup: $F; md5 da migration $(cat "$S/mig/md5-mig.txt")"
```

- [ ] **Step 2: Rodar (bash)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
chmod +x .superpowers/f35a/mig/ensaio-local.sh
/bin/bash .superpowers/f35a/mig/ensaio-local.sh 2>&1 | tee .superpowers/f35a/logs/ensaio.log | tail -40
```

Expected: `OK (cópia SEM a F3.5a): 0|0|0|0` → `backup: …/pre-f35a-ensaio-<data>.dump` → a IDA (`real …` do `/usr/bin/time` — anotar: é o teto do lock em produção; alvo < 1 s) com os 2 avisos inofensivos de transação → `OK (IDA: objetos da F3.5a): 18|5|1|7` → `OK (IDA: ACL (#9)): 0|0|0` → `OK (IDA: nenhuma função pré-existente mudou): <md5>|<n>` → `Tests  23 passed | 1 skipped (24)` → VOLTA → contagens e funções = antes → REIDA → VOLTA 2 → `== ENSAIO F3.5a OK — cópia limpa; …`. Qualquer `FALHOU`/`PAROU`: o script tenta a volta; PARE e reporte com o log (o backup está no caminho impresso; restaurar só com OK do dono). O revisor Opus lê o log inteiro e registra o veredito no diário do guardião.

---

## Task 7: Cadastro › Atributos — "Sigla SKU" em Cor base e Cor apelido (`extraText` no `AttributeTab`)  *(Lote Opus com a Task 8)*

**Files:**
- Modify: `src/components/attribute-tab.tsx`, `src/routes/_authenticated/cadastro.atributos.tsx`

**Interfaces:**
- Produces: `AttributeTabConfig.extraText?: { field; label; placeholder?; maxLength?; hint? }` — coluna na tabela, campo no editar inline, no diálogo "Novo" e no Sheet mobile, sublinha do card mobile. Só manda a coluna quando há valor/mudou (§3 T12). O servidor normaliza (gatilho, Task 4); a lista relê depois de salvar.

- [ ] **Step 1: As edições** — cada "Trocar" aparece 1× no arquivo (Task 0 Step 3); aplicar na ORDEM, com a ferramenta de edição (texto exato):

**1. tipo: extraText** — `src/components/attribute-tab.tsx`

Trocar:

```tsx
  extraNumber?: { field: string; label: string; placeholder?: string; step?: string };
```

Por:

```tsx
  extraNumber?: { field: string; label: string; placeholder?: string; step?: string };
  /** Campo de TEXTO curto opcional por linha (ex.: "Sigla SKU" da cor — F3.5a). Vazio grava NULL; o servidor pode
   *  normalizar no salvar (gatilho) — a lista relê depois de gravar e mostra o valor final. */
  extraText?: { field: string; label: string; placeholder?: string; maxLength?: number; hint?: string };
```

**2. estado do diálogo Novo** — `src/components/attribute-tab.tsx`

Trocar:

```tsx
  const [newExtraNum, setNewExtraNum] = useState<string>("");
```

Por:

```tsx
  const [newExtraNum, setNewExtraNum] = useState<string>("");
  const [newExtraText, setNewExtraText] = useState<string>("");
```

**3. colCount** — `src/components/attribute-tab.tsx`

Trocar:

```tsx
(config.extraNumber ? 1 : 0) + (config.extraEnum ? 1 : 0) + (config.toggleField ? 1 : 0);
```

Por:

```tsx
(config.extraNumber ? 1 : 0) + (config.extraText ? 1 : 0) + (config.extraEnum ? 1 : 0) + (config.toggleField ? 1 : 0);
```

**4. estado da edição inline** — `src/components/attribute-tab.tsx`

Trocar:

```tsx
  const [editNum, setEditNum] = useState("");
```

Por:

```tsx
  const [editNum, setEditNum] = useState("");
  const [editText, setEditText] = useState("");
```

**5. createDirty** — `src/components/attribute-tab.tsx`

Trocar:

```tsx
  const createDirty = createOpen && (newName !== "" || newExtra !== "" || newExtraNum !== "" || newEnum !== "");
```

Por:

```tsx
  const createDirty = createOpen && (newName !== "" || newExtra !== "" || newExtraNum !== "" || newExtraText !== "" || newEnum !== "");
```

**6. createMut payload** — `src/components/attribute-tab.tsx`

Trocar:

```tsx
        payload[config.extraNumber.field] = num;
      }
      if (config.extraEnum) {
        payload[config.extraEnum.field] = newEnum || config.extraEnum.options[0].value;
      }
```

Por:

```tsx
        payload[config.extraNumber.field] = num;
      }
      // Só manda a coluna quando há valor: sem a migration no banco, criar a cor sem sigla continua funcionando.
      if (config.extraText && newExtraText.trim() !== "") payload[config.extraText.field] = newExtraText;
      if (config.extraEnum) {
        payload[config.extraEnum.field] = newEnum || config.extraEnum.options[0].value;
      }
```

**7. createMut reset** — `src/components/attribute-tab.tsx`

Trocar:

```tsx
      setNewExtraNum("");
      setNewEnum("");
```

Por:

```tsx
      setNewExtraNum("");
      setNewExtraText("");
      setNewEnum("");
```

**8. updateRowMut payload** — `src/components/attribute-tab.tsx`

Trocar:

```tsx
      if (config.extraEnum) payload[config.extraEnum.field] = editEnum || config.extraEnum.options[0].value;
      if (config.toggleField) payload[config.toggleField.field] = editAtivo;
```

Por:

```tsx
      if (config.extraText) {
        // Só manda a coluna se MUDOU (editar o nome sem mexer na sigla não depende da coluna existir no banco).
        const v = editText.trim() === "" ? null : editText;
        if (v !== (row[config.extraText.field] ?? null)) payload[config.extraText.field] = v;
      }
      if (config.extraEnum) payload[config.extraEnum.field] = editEnum || config.extraEnum.options[0].value;
      if (config.toggleField) payload[config.toggleField.field] = editAtivo;
```

**9. startEdit** — `src/components/attribute-tab.tsx`

Trocar:

```tsx
    setEditNum(config.extraNumber && row[config.extraNumber.field] != null ? String(row[config.extraNumber.field]) : "");
```

Por:

```tsx
    setEditNum(config.extraNumber && row[config.extraNumber.field] != null ? String(row[config.extraNumber.field]) : "");
    setEditText(config.extraText ? String(row[config.extraText.field] ?? "") : "");
```

**10. estado do Sheet mobile** — `src/components/attribute-tab.tsx`

Trocar:

```tsx
  const [sheetNum, setSheetNum] = useState("");
```

Por:

```tsx
  const [sheetNum, setSheetNum] = useState("");
  const [sheetText, setSheetText] = useState("");
```

**11. openEditSheet** — `src/components/attribute-tab.tsx`

Trocar:

```tsx
    setSheetNum(config.extraNumber && row[config.extraNumber.field] != null ? String(row[config.extraNumber.field]) : "");
```

Por:

```tsx
    setSheetNum(config.extraNumber && row[config.extraNumber.field] != null ? String(row[config.extraNumber.field]) : "");
    setSheetText(config.extraText ? String(row[config.extraText.field] ?? "") : "");
```

**12. sheetDirty** — `src/components/attribute-tab.tsx`

Trocar:

```tsx
    (!!config.extraNumber && sheetNum !== (sheetRow[config.extraNumber.field] != null ? String(sheetRow[config.extraNumber.field]) : "")) ||
```

Por:

```tsx
    (!!config.extraNumber && sheetNum !== (sheetRow[config.extraNumber.field] != null ? String(sheetRow[config.extraNumber.field]) : "")) ||
    (!!config.extraText && sheetText !== String(sheetRow[config.extraText.field] ?? "")) ||
```

**13. sheetSaveMut payload** — `src/components/attribute-tab.tsx`

Trocar:

```tsx
      if (config.extraEnum) payload[config.extraEnum.field] = sheetEnum || config.extraEnum.options[0].value;
      if (config.toggleField) payload[config.toggleField.field] = sheetAtivo;
```

Por:

```tsx
      if (config.extraText) {
        const v = sheetText.trim() === "" ? null : sheetText;
        if (v !== (sheetRow[config.extraText.field] ?? null)) payload[config.extraText.field] = v;
      }
      if (config.extraEnum) payload[config.extraEnum.field] = sheetEnum || config.extraEnum.options[0].value;
      if (config.toggleField) payload[config.toggleField.field] = sheetAtivo;
```

**14. cabeçalho da tabela** — `src/components/attribute-tab.tsx`

Trocar:

```tsx
              {config.extraEnum && (
                <SortHead label={config.extraEnum.label} sortKey={config.extraEnum.field} sortState={sortState} className="w-44" />
              )}
```

Por:

```tsx
              {config.extraText && (
                <SortHead label={config.extraText.label} sortKey={config.extraText.field} sortState={sortState} className="w-32" />
              )}
              {config.extraEnum && (
                <SortHead label={config.extraEnum.label} sortKey={config.extraEnum.field} sortState={sortState} className="w-44" />
              )}
```

**15. sublinha do card mobile** — `src/components/attribute-tab.tsx`

Trocar:

```tsx
                const sublinha = subParts.join(" · ");
```

Por:

```tsx
                if (config.extraText && row[config.extraText.field])
                  subParts.push(`${config.extraText.label}: ${String(row[config.extraText.field])}`);
                const sublinha = subParts.join(" · ");
```

**16. célula da linha (desktop)** — `src/components/attribute-tab.tsx`

Trocar:

```tsx
                  {config.extraEnum && (
                    <TableCell>
                      {isEditingRow ? (
                        <Select value={editEnum} onValueChange={setEditEnum} disabled={readOnly}>
```

Por:

```tsx
                  {config.extraText && (
                    <TableCell className="w-32">
                      {isEditingRow ? (
                        <Input
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          placeholder={config.extraText.placeholder ?? "—"}
                          maxLength={config.extraText.maxLength}
                          disabled={readOnly}
                          aria-label={config.extraText.label}
                          className="h-8 w-28 uppercase max-md:h-11"
                        />
                      ) : (
                        <span className="font-mono text-sm">
                          {row[config.extraText.field] ? String(row[config.extraText.field]) : "—"}
                        </span>
                      )}
                    </TableCell>
                  )}
                  {config.extraEnum && (
                    <TableCell>
                      {isEditingRow ? (
                        <Select value={editEnum} onValueChange={setEditEnum} disabled={readOnly}>
```

**17. campo no diálogo Novo** — `src/components/attribute-tab.tsx`

Trocar:

```tsx
                  value={newExtraNum}
                  onChange={(e) => setNewExtraNum(e.target.value)}
                  placeholder={config.extraNumber.placeholder}
                />
              </div>
            )}
```

Por:

```tsx
                  value={newExtraNum}
                  onChange={(e) => setNewExtraNum(e.target.value)}
                  placeholder={config.extraNumber.placeholder}
                />
              </div>
            )}
            {config.extraText && (
              <div className="space-y-1.5">
                <Label>{config.extraText.label}</Label>
                <Input
                  value={newExtraText}
                  onChange={(e) => setNewExtraText(e.target.value)}
                  placeholder={config.extraText.placeholder}
                  maxLength={config.extraText.maxLength}
                  className="uppercase"
                />
                {config.extraText.hint && <p className="text-xs text-muted-foreground">{config.extraText.hint}</p>}
              </div>
            )}
```

**18. campo no Sheet mobile** — `src/components/attribute-tab.tsx`

Trocar:

```tsx
                    value={sheetNum} onChange={(e) => setSheetNum(e.target.value)}
                    placeholder={config.extraNumber.placeholder} />
                </div>
              )}
```

Por:

```tsx
                    value={sheetNum} onChange={(e) => setSheetNum(e.target.value)}
                    placeholder={config.extraNumber.placeholder} />
                </div>
              )}
              {config.extraText && (
                <div className="space-y-1.5">
                  <Label>{config.extraText.label}</Label>
                  <Input value={sheetText} onChange={(e) => setSheetText(e.target.value)}
                    placeholder={config.extraText.placeholder} maxLength={config.extraText.maxLength} className="uppercase" />
                  {config.extraText.hint && <p className="text-xs text-muted-foreground">{config.extraText.hint}</p>}
                </div>
              )}
```

**19. Cor base ganha Sigla SKU** — `src/routes/_authenticated/cadastro.atributos.tsx`

Trocar:

```tsx
      singular: "Cor base",
      plural: "Cores base",
```

Por:

```tsx
      singular: "Cor base",
      plural: "Cores base",
      // Sigla da cor no SKU automático (F3.5a). O servidor normaliza no salvar (trim + maiúsculas; vazia = sem sigla).
      extraText: { field: "sigla_sku", label: "Sigla SKU", placeholder: "Ex.: AM", maxLength: 10, hint: "Usada no SKU automático. Fica em maiúsculas." },
```

**20. Cor apelido ganha Sigla SKU** — `src/routes/_authenticated/cadastro.atributos.tsx`

Trocar:

```tsx
      singular: "Cor apelido",
      plural: "Cores apelido",
```

Por:

```tsx
      singular: "Cor apelido",
      plural: "Cores apelido",
      // Sigla do apelido no SKU automático (F3.5a) — mesma regra da Cor base.
      extraText: { field: "sigla_sku", label: "Sigla SKU", placeholder: "Ex.: CAN", maxLength: 10, hint: "Usada no SKU automático. Fica em maiúsculas." },
```


- [ ] **Step 2: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
grep -c "extraText" src/components/attribute-tab.tsx src/routes/_authenticated/cadastro.atributos.tsx
bash .superpowers/f35a/gates.sh
git commit --only -m "feat(sku): F3.5a (7) — Cadastro › Atributos: 'Sigla SKU' em Cor base e Cor apelido (extraText no AttributeTab)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/attribute-tab.tsx src/routes/_authenticated/cadastro.atributos.tsx
git show --stat HEAD | tail -4
```

Expected: `attribute-tab.tsx:28` e `cadastro.atributos.tsx:2`; `GATES F3.5a: ok` (o anti-drift de UI continua só com as 2 falhas herdadas — conferido pelo planejador num espelho: tsc limpo, 836 unit verdes).

---

## Task 8: Grade de Tamanhos — bloco "Siglas no SKU"  *(Lote Opus com a Task 7)*

**Files:**
- Modify (substituir o arquivo INTEIRO): `src/components/shared/GradeTamanhosCard.tsx` — só com o sha do BASE conferido (Task 0 Step 1: `e68a9650…`). A parte de cima (lista da grade, gravação na hora) é o texto de hoje SEM mudança; entra o bloco `SiglasTamanhoBloco` abaixo.

**Interfaces:**
- Consumes: `ladosDaGrade`, `normalizarSigla`, `normalizarTamanhosSku`, `mesclarSiglasTamanho`, `canonico`, `TAMANHO_UNICO` (Task 1). Produces: queryKey `["tenant-config-tamanhos-sku", tenantId]`; grava SÓ `tenant_config.tamanhos_sku` (update da coluna, `.select("tenant_id")` exige 1 linha — só admin da loja, igual à grade). Guarda de não salvo com `blockNav` (trocar de atributo na barra lateral NÃO é navegação de rota — o rascunho some sem aviso, igual ao `AttributeTab` de hoje).

- [ ] **Step 1: O arquivo**

```tsx
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ChevronUp, ChevronDown, Save, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import {
  canonico, ladosDaGrade, mesclarSiglasTamanho, normalizarSigla, normalizarTamanhosSku, TAMANHO_UNICO,
} from "@/lib/sku-montar";

const DEFAULT_GRADE = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];

/**
 * Grade de tamanhos da loja (tenant_config.tamanhos_grade). Antes ficava na Config da Loja;
 * agora é cadastrada aqui (Cadastro > Atributos). Formato "Número|Sigla" (ex.: 38|P); a ordem
 * define as colunas das grades no desenvolvimento/CAD/CQ.
 * F3.5a: abaixo da lista, as SIGLAS NO SKU de cada lado dos pares (tenant_config.tamanhos_sku) — bloco próprio,
 * com o seu "Salvar siglas" (a grade continua gravando na hora, como antes).
 */
export function GradeTamanhosCard({ readOnly }: { readOnly?: boolean } = {}) {
  const qc = useQueryClient();
  const tenantId = useActiveTenantId();
  const [draft, setDraft] = useState("");

  const gradeKey = ["tenant-config-grade", tenantId];
  const { data: items = [] } = useQuery({
    queryKey: gradeKey,
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase
        .from("tenant_config")
        .select("tamanhos_grade")
        .eq("tenant_id", tenantId!)
        .maybeSingle();
      const g = (data as any)?.tamanhos_grade;
      return Array.isArray(g) ? (g as string[]) : DEFAULT_GRADE;
    },
  });

  const save = useMutation({
    mutationFn: async (next: string[]) => {
      const { error } = await supabase
        .from("tenant_config")
        .upsert({ tenant_id: tenantId, tamanhos_grade: next } as any, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onMutate: (next) => qc.setQueryData(gradeKey, next), // otimista
    onError: (e: any) => {
      toast.error(mensagemErro(e, "Erro ao salvar a grade."));
      qc.invalidateQueries({ queryKey: gradeKey });
    },
    // A grade é lida em várias telas sob prefixos diferentes (tenant_config, ...-grade).
    onSuccess: () => qc.invalidateQueries(),
  });

  const commit = (next: string[]) => save.mutate(next);
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (items.includes(v)) return toast.error("Tamanho já existe.");
    commit([...items, v]);
    setDraft("");
  };
  const remove = (i: number) => commit(items.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Formato <b>Número|Sigla</b> (ex.: <code>38|P</code>). A <b>ordem</b> define as colunas das grades.
        </p>
        {/* readOnly (sem permissão de editar Grade): esconde adicionar/reordenar/remover. */}
        {!readOnly && (
          <div className="flex gap-2">
            <Input
              placeholder="Ex: 38|P"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            />
            <Button type="button" variant="secondary" onClick={add}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar
            </Button>
          </div>
        )}
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={`${i}::${it}`} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
              <span className="flex-1 text-sm">{it}</span>
              {!readOnly && (<>
                <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Descer">
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(i)} aria-label="Remover">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>)}
            </li>
          ))}
          {items.length === 0 && <li className="py-2 text-sm text-muted-foreground">Nenhum tamanho.</li>}
        </ul>
      </div>

      <SiglasTamanhoBloco itens={items} readOnly={readOnly} />
    </div>
  );
}

/**
 * Siglas no SKU de CADA LADO dos pares da grade (spec SKU §4.1/§4.3): "34|PPP" → número 34 → sigla, letra PPP →
 * sigla. Item solto é um lado só (classificado: só dígitos = número). O mapa é por TEXTO do lado — dois pares com o
 * mesmo lado dividem a sigla. Grava SÓ `tamanhos_sku` (update da coluna, nunca a linha inteira — lição RP3 da F2),
 * aplicando sobre o valor ATUAL do banco apenas os lados que VOCÊ mudou. O servidor normaliza (trim + maiúsculas).
 */
function SiglasTamanhoBloco({ itens, readOnly }: { itens: string[]; readOnly?: boolean }) {
  const qc = useQueryClient();
  const tenantId = useActiveTenantId();
  const chave = ["tenant-config-tamanhos-sku", tenantId];
  const { data: servidor = null, isSuccess } = useQuery({
    queryKey: chave,
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      const r = normalizarTamanhosSku((data as any)?.tamanhos_sku ?? null);
      return r.ok ? r.valor : null;
    },
  });

  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [base, setBase] = useState<Record<string, string> | null>(null);
  const normRascunho = normalizarTamanhosSku(rascunho);
  const dirty = isSuccess && canonico(normRascunho.ok ? normRascunho.valor : rascunho) !== canonico(base);
  const { confirm } = useUnsavedGuard({ dirty, blockNav: true });

  // Semeia do servidor só SEM edição pendente (um refetch/realtime não apaga o que você digitou).
  const servidorCanon = canonico(servidor);
  useEffect(() => {
    if (!isSuccess || dirty) return;
    setRascunho({ ...(servidor ?? {}) });
    setBase(servidor);
  }, [servidorCanon, isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  const linhas = ladosDaGrade(itens);
  const lados = [...new Set(linhas.flatMap((l) => [l.numero, l.letra]).filter((x): x is string => !!x))];
  const semSigla = lados.filter((l) => !normalizarSigla(rascunho[l]));

  const salvar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      const fresco = normalizarTamanhosSku((data as any)?.tamanhos_sku ?? null);
      const proximo = normalizarTamanhosSku(mesclarSiglasTamanho(fresco.ok ? fresco.valor : null, base, rascunho));
      if (!proximo.ok) throw new Error(proximo.erro);
      const { data: gravou, error: e2 } = await supabase
        .from("tenant_config")
        .update({ tamanhos_sku: proximo.valor } as any)
        .eq("tenant_id", tenantId)
        .select("tenant_id");
      if (e2) throw e2;
      if (!gravou?.length) throw new Error("Sem permissão para salvar as siglas de tamanho (só o admin da loja).");
      return proximo.valor;
    },
    onSuccess: (valor) => {
      setRascunho({ ...(valor ?? {}) });
      setBase(valor);
      qc.setQueryData(chave, valor);
      toast.success("Siglas de tamanho salvas.");
    },
    onError: (e: unknown) => toast.error(mensagemErro(e, "Erro ao salvar as siglas de tamanho.")),
  });

  const campo = (rotulo: string, lado: string) => (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="whitespace-nowrap">{rotulo} {lado} →</span>
      <Input
        value={rascunho[lado] ?? ""}
        onChange={(e) => setRascunho((r) => ({ ...r, [lado]: e.target.value }))}
        placeholder="—"
        maxLength={10}
        disabled={readOnly}
        aria-label={`Sigla SKU do tamanho ${lado}`}
        className="h-8 w-20 uppercase max-md:h-11"
      />
    </label>
  );

  return (
    <div className="space-y-3 border-t pt-4" data-secao="siglas-tamanho">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Siglas no SKU</p>
        <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
      </div>
      <p className="text-xs text-muted-foreground">
        Cada lado do tamanho tem a sua sigla (ex.: <code>34 → 34 · PPP → PPP</code>). O SKU usa o lado escolhido em
        "Tamanho em" (Letra ou Número). Tamanho sem sigla não gera SKU. A grade única "{TAMANHO_UNICO}" dos acessórios
        sem sigla sai sem o tamanho.
      </p>
      <ul className="space-y-2">
        {linhas.map((l, i) => {
          const previa = [l.numero, l.letra]
            .filter((x): x is string => !!x)
            .map((lado) => `${lado} → ${normalizarSigla(rascunho[lado]) ?? "—"}`)
            .join(" · ");
          return (
            <li key={`${i}::${l.item}`} className="rounded-md border bg-card px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="w-20 shrink-0 text-sm font-medium">{l.item}</span>
                {l.numero && campo("Número", l.numero)}
                {l.letra && campo("Letra", l.letra)}
                <span className="ml-auto font-mono text-xs text-muted-foreground">{previa}</span>
              </div>
            </li>
          );
        })}
        {linhas.length === 0 && <li className="py-2 text-sm text-muted-foreground">Cadastre a grade acima primeiro.</li>}
      </ul>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={semSigla.length === 0}
            onClick={() => setRascunho((r) => {
              const n = { ...r };
              for (const lado of semSigla) n[lado] = lado;
              return n;
            })}
          >
            <Wand2 className="h-4 w-4 mr-1" /> Preencher vazias com o próprio tamanho
          </Button>
          <Button type="button" className="ml-auto" disabled={!dirty || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar siglas
          </Button>
        </div>
      )}
      <UnsavedChangesGuard confirm={confirm} message="As siglas de tamanho têm alterações não salvas." />
    </div>
  );
}
```

- [ ] **Step 2: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
git diff --stat "$(cat .superpowers/f35a/BASE)" -- src/components/shared/GradeTamanhosCard.tsx
bash .superpowers/f35a/gates.sh
git commit --only -m "feat(sku): F3.5a (8) — Grade de Tamanhos: siglas no SKU por lado de cada par (prévia 34 → 34 · PPP → PPP)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/shared/GradeTamanhosCard.tsx
git show --stat HEAD | tail -3
```

**Revisão do Lote (7 + 8):** `code-reviewer` Opus com o foco: payload do `AttributeTab` inalterado para os outros atributos (sem `extraText` = byte a byte o comportamento de hoje); `sigla_sku` só vai quando muda; o `colCount` bate com as colunas; o bloco de siglas não reescreve a grade; RP3 (update só da coluna; merge por chave sobre o valor fresco); guarda de não salvo; mobile (campos `max-md:h-11`, `flex-wrap`).

---

## Task 9: Config da Loja — card "Formato do SKU"  *(individual Opus)*

**Files:**
- Create: `src/components/configuracoes/FormatoSkuCard.tsx`
- Modify: `src/routes/_authenticated/admin/configuracoes.tsx` (+2 linhas — gate)

**Interfaces:**
- Consumes: `normalizarSkuConfig`, `normalizarTamanhosSku`, `resolverSku`, `textoFalta`, `canonico`, `chaveSeparador`, `SKU_PARTES`, `SKU_PARTE_LABEL`, `SKU_SEP_MAX` (Task 1). Produces: queryKeys `["tenant-config-sku", tenantId]` e `["tenant-sku-exemplo", tenantId]` (casam o prefixo "tenant" do mapa de Realtime e o `invalidateQueries` do Salvar geral — a semeadura só acontece SEM rascunho pendente); grava SÓ `tenant_config.sku_config` (conferência de conflito antes — RP3), com AlertDialog; prévia ao vivo com a REF mais recente da loja + a 1ª cor com sigla + um apelido dela + o 1º tamanho da grade (com e sem apelido). Ganchos de QA: `data-secao="formato-sku"`, `data-sku-previa`, `aria-label` nos separadores e no "Tamanho em".

- [ ] **Step 1: O componente** — criar `src/components/configuracoes/FormatoSkuCard.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import {
  canonico, chaveSeparador, normalizarSkuConfig, normalizarTamanhosSku, resolverSku, textoFalta,
  SKU_PARTES, SKU_PARTE_LABEL, SKU_SEP_MAX,
  type SkuConfig, type SkuCor, type SkuParte,
} from "@/lib/sku-montar";
import type { TamanhoTipo } from "@/lib/tamanho";

// Card "Formato do SKU" (Config da Loja, logo abaixo do "Formato da REF") — F3.5a, spec SKU §4.3.
// Grava SÓ `tenant_config.sku_config`, num `update` da coluna, com o SEU botão (não entra no upsert genérico da
// página — lição RP3 da F2: uma aba velha não sobrescreve o Formato; e se outra pessoa mudou o Formato depois que a
// tela abriu, o salvar recusa). O servidor valida/canoniza de novo (gatilho) com as MESMAS regras de
// `normalizarSkuConfig`. A prévia usa `resolverSku` (espelho byte a byte do SQL) com um exemplo REAL da loja.

type Rascunho = { partes: SkuParte[]; separadores: Record<string, string>; tamanho_padrao: TamanhoTipo };
const rascunhoDe = (cfg: SkuConfig | null): Rascunho =>
  cfg
    ? { partes: [...cfg.partes], separadores: { ...cfg.separadores }, tamanho_padrao: cfg.tamanho_padrao }
    : { partes: [], separadores: {}, tamanho_padrao: "letra" };

type Exemplo = { ref: string | null; cor: SkuCor | null; apelido: SkuCor | null };

export function FormatoSkuCard() {
  const qc = useQueryClient();
  const tenantId = useActiveTenantId();
  const chave = ["tenant-config-sku", tenantId];

  const { data, isSuccess } = useQuery({
    queryKey: chave,
    enabled: !!tenantId,
    queryFn: async () => {
      const { data: row, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      const r = row as any;
      const cfg = normalizarSkuConfig(r?.sku_config ?? null);
      const ts = normalizarTamanhosSku(r?.tamanhos_sku ?? null);
      return {
        cfg: cfg.ok ? cfg.valor : null,
        tamanhosSku: ts.ok ? ts.valor : null,
        grade: Array.isArray(r?.tamanhos_grade) ? (r.tamanhos_grade as string[]) : [],
      };
    },
  });

  // Exemplo REAL da loja p/ a prévia: a REF mais recente + a 1ª cor base com sigla (senão a 1ª) + um apelido dela.
  const { data: ex } = useQuery({
    queryKey: ["tenant-sku-exemplo", tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<Exemplo> => {
      const [m, cores, apelidos] = await Promise.all([
        supabase.from("modelos").select("ref").eq("tenant_id", tenantId).not("ref", "is", null).neq("ref", "")
          .order("created_at", { ascending: false }).limit(1),
        supabase.from("cores").select("*").order("nome"),
        supabase.from("cores_apelido").select("*").order("nome"),
      ]);
      if (m.error) throw m.error;
      if (cores.error) throw cores.error;
      if (apelidos.error) throw apelidos.error;
      const lista = (cores.data ?? []) as any[];
      const cor = lista.find((c) => !!c.sigla_sku) ?? lista[0] ?? null;
      const daCor = ((apelidos.data ?? []) as any[]).filter((a) => cor && a.cor_base_id === cor.id);
      const ape = daCor.find((a) => !!a.sigla_sku) ?? daCor[0] ?? null;
      const comoCor = (x: any): SkuCor | null => (x ? { id: x.id, nome: x.nome, sigla: x.sigla_sku ?? null } : null);
      return { ref: (m.data?.[0] as any)?.ref ?? null, cor: comoCor(cor), apelido: comoCor(ape) };
    },
  });

  const [rascunho, setRascunho] = useState<Rascunho>(rascunhoDe(null));
  const [base, setBase] = useState<SkuConfig | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const norm = normalizarSkuConfig(rascunho);
  const dirty = isSuccess && canonico(norm.ok ? norm.valor : rascunho) !== canonico(base);
  const { confirm } = useUnsavedGuard({ dirty, blockNav: true });

  // Semeia do servidor só SEM edição pendente (o salvar geral da página invalida esta query — não pode apagar o rascunho).
  const servidorCanon = canonico(data?.cfg ?? null);
  useEffect(() => {
    if (!isSuccess || dirty) return;
    setRascunho(rascunhoDe(data?.cfg ?? null));
    setBase(data?.cfg ?? null);
  }, [servidorCanon, isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  const marcadas = new Set(rascunho.partes);
  const alternar = (p: SkuParte, on: boolean) =>
    setRascunho((r) => ({ ...r, partes: on ? [...r.partes, p] : r.partes.filter((x) => x !== p) }));
  const mover = (i: number, d: -1 | 1) =>
    setRascunho((r) => {
      const j = i + d;
      if (j < 0 || j >= r.partes.length) return r;
      const partes = [...r.partes];
      [partes[i], partes[j]] = [partes[j], partes[i]];
      return { ...r, partes };
    });
  const setSep = (k: string, v: string) =>
    setRascunho((r) => ({ ...r, separadores: { ...r.separadores, [k]: v.replace(/\s/g, "") } }));

  const salvar = useMutation({
    mutationFn: async () => {
      const n = normalizarSkuConfig(rascunho);
      if (!n.ok) throw new Error(n.erro);
      const { data: agora, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      const noBanco = normalizarSkuConfig((agora as any)?.sku_config ?? null);
      if (canonico(noBanco.ok ? noBanco.valor : (agora as any)?.sku_config) !== canonico(base)) {
        throw new Error("Outra pessoa mudou o Formato do SKU enquanto você editava. Recarregue a página para ver a versão atual.");
      }
      const { data: gravou, error: e2 } = await supabase
        .from("tenant_config")
        .update({ sku_config: n.valor } as any)
        .eq("tenant_id", tenantId)
        .select("tenant_id");
      if (e2) throw e2;
      if (!gravou?.length) throw new Error("Sem permissão para salvar o Formato do SKU (só o admin da loja).");
      return n.valor;
    },
    onSuccess: (valor) => {
      setRascunho(rascunhoDe(valor));
      setBase(valor);
      qc.setQueryData(chave, (old: any) => (old ? { ...old, cfg: valor } : old));
      setConfirmar(false);
      toast.success("Formato do SKU salvo.");
    },
    onError: (e: unknown) => {
      setConfirmar(false);
      toast.error(mensagemErro(e, "Erro ao salvar o Formato do SKU."));
    },
  });

  // Prévia ao vivo (mesma função do servidor, em TS): com apelido e sem apelido.
  const grade0 = data?.grade?.[0] ?? "34|PPP";
  const previa = (apelido: SkuCor | null) =>
    norm.ok && norm.valor
      ? resolverSku({
          cfg: norm.valor,
          ref: ex?.ref ?? "REF00000001",
          cor: ex?.cor ?? { id: "exemplo", nome: "Amarelo", sigla: "AM" },
          apelido,
          tamanhoKey: grade0,
          tipo: rascunho.tamanho_padrao,
          tamanhosSku: data?.tamanhosSku ?? null,
        })
      : null;
  const exemplos = [
    { rotulo: `${ex?.cor?.nome ?? "Amarelo"}${ex?.apelido ? ` · ${ex.apelido.nome}` : ""} · ${grade0}`, r: previa(ex?.apelido ?? null) },
    ...(ex?.apelido ? [{ rotulo: `${ex?.cor?.nome ?? "Amarelo"} (sem apelido) · ${grade0}`, r: previa(null) }] : []),
  ];

  return (
    <Card data-secao="formato-sku">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Formato do SKU</CardTitle>
          <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
        </div>
        <CardDescription>
          Como o SKU de cada variante × tamanho é montado a partir da REF e das siglas de Cor base, Cor apelido e
          Tamanho (Cadastro › Atributos). Salva só este bloco, no botão abaixo. Sem nenhuma parte marcada, a loja não
          gera SKU.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Montagem do SKU</p>
          <p className="text-xs text-muted-foreground">
            Marque as partes e ordene com as setas. Entre duas partes, um separador opcional (até {SKU_SEP_MAX}
            caracteres, sem espaço; vazio = colado).
          </p>
          <ul className="space-y-1.5">
            {rascunho.partes.map((p, i) => (
              <li key={p} className="space-y-1.5">
                <div className="flex items-center gap-3 rounded-md border bg-card p-2">
                  <Checkbox checked onCheckedChange={(v) => alternar(p, !!v)} aria-label={`Usar "${SKU_PARTE_LABEL[p]}" no SKU`} />
                  <span className="flex-1 text-sm">{SKU_PARTE_LABEL[p]}</span>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0}
                    onClick={() => mover(i, -1)} aria-label={`Mover "${SKU_PARTE_LABEL[p]}" para cima`}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={i === rascunho.partes.length - 1}
                    onClick={() => mover(i, 1)} aria-label={`Mover "${SKU_PARTE_LABEL[p]}" para baixo`}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {i < rascunho.partes.length - 1 && (
                  <div className="flex items-center gap-2 pl-8">
                    <Label className="text-xs font-normal text-muted-foreground">
                      Separador entre {SKU_PARTE_LABEL[p]} e {SKU_PARTE_LABEL[rascunho.partes[i + 1]]}
                    </Label>
                    <Input
                      className="h-8 w-16 font-mono max-md:h-11"
                      aria-label={`Separador entre ${SKU_PARTE_LABEL[p]} e ${SKU_PARTE_LABEL[rascunho.partes[i + 1]]}`}
                      maxLength={SKU_SEP_MAX}
                      placeholder="nenhum"
                      value={rascunho.separadores[chaveSeparador(p, rascunho.partes[i + 1])] ?? ""}
                      onChange={(e) => setSep(chaveSeparador(p, rascunho.partes[i + 1]), e.target.value)}
                    />
                  </div>
                )}
              </li>
            ))}
            {SKU_PARTES.filter((p) => !marcadas.has(p)).map((p) => (
              <li key={p} className="flex items-center gap-3 rounded-md border border-dashed p-2">
                <Checkbox checked={false} onCheckedChange={(v) => alternar(p, !!v)} aria-label={`Usar "${SKU_PARTE_LABEL[p]}" no SKU`} />
                <span className="flex-1 text-sm text-muted-foreground">{SKU_PARTE_LABEL[p]}</span>
              </li>
            ))}
          </ul>
          {rascunho.partes.length > 0 && !marcadas.has("ref") && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Sem a REF, o mesmo SKU pode se repetir entre produtos — o sistema recusa o repetido.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-1 sm:max-w-xs">
          <Label className="text-xs text-muted-foreground">Tamanho em (padrão da loja)</Label>
          <Select
            value={rascunho.tamanho_padrao}
            onValueChange={(v) => setRascunho((r) => ({ ...r, tamanho_padrao: v as TamanhoTipo }))}
          >
            <SelectTrigger className="h-8 max-md:h-11" aria-label="Tamanho em (padrão da loja)"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="letra">Letra (PP, P, M…)</SelectItem>
              <SelectItem value="numero">Número (36, 38, 40…)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Card novo nasce com este padrão; cada card pode trocar.</p>
        </div>

        <div className="space-y-2 border-t pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prévia</p>
          <p className="text-xs text-muted-foreground">
            Exemplo com {ex?.ref ? `a REF ${ex.ref}` : "uma REF de exemplo"}, a cor {ex?.cor?.nome ?? "de exemplo"} e o
            1º tamanho da grade ({grade0}).
          </p>
          {!norm.ok ? (
            <p className="text-sm text-destructive">{norm.erro}</p>
          ) : !norm.valor ? (
            <p className="text-sm text-muted-foreground">Nenhuma parte marcada: a loja não gera SKU.</p>
          ) : (
            <div className="space-y-1.5 rounded-md border bg-muted/30 p-3">
              {exemplos.map((e) => (
                <div key={e.rotulo} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{e.rotulo}</span>
                  {e.r?.sku ? (
                    <span className="font-mono text-sm tabular-nums" data-sku-previa>{e.r.sku}</span>
                  ) : (
                    <span className="text-xs text-amber-700 dark:text-amber-300">
                      {(e.r?.faltas ?? []).map(textoFalta).join(" · ") || "SKU vazio"} —{" "}
                      <Link to="/cadastro/atributos" className="underline">cadastrar</Link>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            Os SKUs já gerados não mudam sozinhos: só pelo "Regerar SKUs" do card (os editados à mão nunca mudam).
          </p>
          <Button
            type="button"
            className="ml-auto shrink-0"
            disabled={!dirty || !norm.ok || salvar.isPending}
            onClick={() => setConfirmar(true)}
          >
            {salvar.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar formato do SKU
          </Button>
        </div>
      </CardContent>

      {confirmar && (
        <AlertDialog open onOpenChange={(o) => { if (!o && !salvar.isPending) setConfirmar(false); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Salvar o Formato do SKU?</AlertDialogTitle>
              <AlertDialogDescription>
                Vale para os SKUs gerados a partir de agora, em todos os produtos da loja. Os SKUs já gerados NÃO mudam
                sozinhos — só pelo botão "Regerar SKUs" no card (e os editados à mão nunca mudam).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={salvar.isPending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); salvar.mutate(); }} disabled={salvar.isPending}>
                {salvar.isPending ? "Salvando…" : "Salvar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      <UnsavedChangesGuard confirm={confirm} message="O Formato do SKU tem alterações não salvas." />
    </Card>
  );
}
```

- [ ] **Step 2: As 2 linhas em `configuracoes.tsx`** (trechos que a F2 NÃO toca — §4.2):

**1. import do FormatoSkuCard (longe dos trechos da F2)** — `src/routes/_authenticated/admin/configuracoes.tsx`

Trocar:

```tsx
import { PAGES_CATALOG } from "@/lib/permissions-catalog";
```

Por:

```tsx
import { PAGES_CATALOG } from "@/lib/permissions-catalog";
import { FormatoSkuCard } from "@/components/configuracoes/FormatoSkuCard";
```

**2. bloco Formato do SKU logo abaixo do Formato da REF** — `src/routes/_authenticated/admin/configuracoes.tsx`

Trocar:

```tsx
        onChange={(ref_config) => setCfg((c) => ({ ...c, ref_config }))}
      />
```

Por:

```tsx
        onChange={(ref_config) => setCfg((c) => ({ ...c, ref_config }))}
      />
      <FormatoSkuCard />
```


- [ ] **Step 3: Conferência com a F2 (merge de 3 vias simulado) + gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
B="$(cat .superpowers/f35a/BASE)"; T=.superpowers/f35a/logs/merge-f2
mkdir -p "$T"
git show "${B}:src/routes/_authenticated/admin/configuracoes.tsx" > "$T/base.tsx"
cp src/routes/_authenticated/admin/configuracoes.tsx "$T/resultado.tsx"
if git rev-parse --verify -q f2/kanban-telas >/dev/null; then
  git show f2/kanban-telas:src/routes/_authenticated/admin/configuracoes.tsx > "$T/f2.tsx"
  git merge-file "$T/resultado.tsx" "$T/base.tsx" "$T/f2.tsx"; echo "conflitos com a F2 = $?"
fi
git diff --numstat "$B" -- src/routes/_authenticated/admin/configuracoes.tsx
bash .superpowers/f35a/gates.sh
git add -- src/components/configuracoes/FormatoSkuCard.tsx
git commit --only -m "feat(sku): F3.5a (9) — Config da Loja: card 'Formato do SKU' (partes, separadores, Tamanho em, prévia real; grava só sku_config)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/configuracoes/FormatoSkuCard.tsx src/routes/_authenticated/admin/configuracoes.tsx
git show --stat HEAD | tail -4
```

Expected: `conflitos com a F2 = 0` (o planejador simulou em 24/set: 0); `2	0	…configuracoes.tsx`; `GATES F3.5a: ok`.

---

## Task 10: QA na CÓPIA — variante `:5180`, guarda invertida  *(controlador; relatório ao guardião)*

> A F3.5a vai à cópia pelo `copia-qa.sh ida` (backup antes). S1–S5 automáticos NÃO gravam (escrita = violação). E1–E4 gravam de verdade NA CÓPIA (siglas das cores do card escolhido, siglas da grade, Formato do SKU, SKUs do card) — um por vez, com o dono avisado no chat antes; tudo sai com o `copia-qa.sh volta` (que exporta antes). Produção: nada aqui.

**Files:**
- Create (NÃO versionar): `tests/e2e/f35a-qa.spec.ts`; `.superpowers/f35a/mig/copia-qa.sh`; evidências em `.superpowers/f35a/qa/`.
- Nada fora do repo é editado (a porta 5180 JÁ está na linha `case "$PORTA"` do `criar-variante.sh` — só conferir).

- [ ] **Step 1: Pré-condições, a porta, a F3.5a na cópia e a variante**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
ps -Ao pid,command | grep -E "[v]itest|[p]laywright|f3[0-9a-z]*-qa"; echo "testes-checados"
lsof -nP -iTCP:5180 -sTCP:LISTEN; echo "porta-5180-checada"
curl -s -o /dev/null -w 'Supabase local http=%{http_code}\n' http://127.0.0.1:54321/auth/v1/health
VAR="/Users/sunglee/PLM + Criação/banco-local/app-teste-variantes"
grep -Eq '^case "\$PORTA" in ([0-9]+\|)*5180(\|[0-9]+)*\)' "$VAR/criar-variante.sh" && echo "5180 reservada no case: ok" || echo "5180 FORA do case — PARE (não editar a linha; falar com o controlador)"
```

Expected: só `testes-checados` e `porta-5180-checada`; `Supabase local http=200` (senão o DONO sobe os serviços — APP-TESTE-LOCAL.md §1; não subir por conta própria); `5180 reservada no case: ok`.

Criar `.superpowers/f35a/mig/copia-qa.sh`:

```bash
#!/usr/bin/env bash
# F3.5a NA CÓPIA LOCAL para o QA (Task 10) e, depois do merge, para FICAR (Task 13). Uso (raiz da worktree, bash):
#   bash .superpowers/f35a/mig/copia-qa.sh estado|ida|volta [--apos-merge]
#  • ida   — backup pg_dump -Fc ANTES; aplica_v2 da migration; confere objetos, ACL e funções pré-existentes.
#  • volta — exporta o que o QA gravou (siglas, formato, SKUs) e aplica o inverso COM a confirmação. Recusa com a
#            variante :5180 no ar e, com a F3.5a já no checkout principal, só com --apos-merge (o :5188 do dono passa a
#            mandar sigla_sku/sku_config sem as colunas no banco).
#  • ANTES de qualquer re-ensaio da F1 na cópia (ou de regravar as referências de fidelidade dela) a F3.5a tem de SAIR.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
source .superpowers/f35a/mig/aplica.sh || exit 1
BK="/Users/sunglee/PLM + Criação/banco-local/backups"
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"
mostra() { echo "cópia (funções F3.5a|gatilhos|tabela|colunas): $(psql "$LOCAL" -X -A -t -c "$OBJ_F35A")"; }
sem_testes() { if ps -Ao pid,command | grep -E "[v]itest|[p]laywright"; then echo "PARE: há teste rodando (um por vez na cópia)"; return 1; fi; }
case "${1:-}" in
  estado) mostra ;;
  ida)
    sem_testes || exit 1
    espera "$LOCAL" "$OBJ_F35A" "0|0|0|0" "cópia sem a F3.5a" || { echo "(já aplicada? use 'estado')"; exit 1; }
    git diff --quiet HEAD -- "$MIG" "$INV" || { echo "PARE: SQL da F3.5a com alteração não commitada"; exit 1; }
    [ "$(md5 -q "$MIG")" = "$(cat .superpowers/f35a/mig/md5-mig.txt)" ] || { echo "PARE: a migration não é a do ensaio (md5)"; exit 1; }
    FN0="$(psql "$LOCAL" -X -A -t -c "$FN_PRE")"
    mkdir -p "$BK"
    F="$BK/pre-f35a-qa-$(date +%F-%H%M%S).dump"
    docker exec -e PGPASSWORD=postgres supabase_db_banco-local pg_dump -h 127.0.0.1 -U supabase_admin -d postgres -Fc > "$F" && [ -s "$F" ] \
      || { echo "PARE: backup falhou"; rm -f "$F"; exit 1; }
    echo "backup: $F ($(du -h "$F" | cut -f1))"
    ativ_vazio "$LOCAL" || exit 1
    aplica_v2 "$LOCAL" "$MIG" || exit 1
    espera "$LOCAL" "$OBJ_F35A" "18|5|1|7" "objetos da F3.5a" && espera "$LOCAL" "$ACL_F35A" "0|0|0" "ACL (#9)" \
      && espera "$LOCAL" "$FN_PRE" "$FN0" "funções pré-existentes intactas" || exit 1
    mostra
    echo "== F3.5a NA CÓPIA. Tirar com: bash .superpowers/f35a/mig/copia-qa.sh volta" ;;
  volta)
    sem_testes || exit 1
    if lsof -nP -iTCP:5180 -sTCP:LISTEN -t >/dev/null 2>&1; then echo "PARE: a variante :5180 está no ar — descer antes (app-teste-variantes/f35a/descer.sh)"; exit 1; fi
    if git -C "$MAIN" cat-file -e "feature/plan-tecido-a1:$MIG" 2>/dev/null && [ "${2:-}" != "--apos-merge" ]; then
      echo "PARE: a F3.5a já está no checkout principal — sem a migration na cópia o :5188 do dono falha ao salvar sigla/formato. Só com --apos-merge (e o dono avisado)."; exit 1
    fi
    mostra
    X="$BK/f35a-dados-copia-$(date +%F-%H%M%S)"
    mkdir -p "$X"
    psql "$LOCAL" -X -q -c "\copy (SELECT id, tenant_id, nome, sigla_sku FROM public.cores WHERE sigla_sku IS NOT NULL ORDER BY tenant_id, nome) TO '$X/cores.csv' CSV HEADER" 2>/dev/null
    psql "$LOCAL" -X -q -c "\copy (SELECT id, tenant_id, nome, sigla_sku FROM public.cores_apelido WHERE sigla_sku IS NOT NULL ORDER BY tenant_id, nome) TO '$X/cores_apelido.csv' CSV HEADER" 2>/dev/null
    psql "$LOCAL" -X -q -c "\copy (SELECT tenant_id, tamanhos_sku, sku_config FROM public.tenant_config WHERE tamanhos_sku IS NOT NULL OR sku_config IS NOT NULL ORDER BY tenant_id) TO '$X/tenant_config.csv' CSV HEADER" 2>/dev/null
    psql "$LOCAL" -X -q -c "\copy (SELECT * FROM public.modelo_skus ORDER BY tenant_id, sku) TO '$X/modelo_skus.csv' CSV HEADER" 2>/dev/null
    echo "dados do QA exportados: $X"
    ativ_vazio "$LOCAL" || exit 1
    export EXTRA_SQL="SET LOCAL app.confirmo_apagar_skus = 'sim';"
    aplica_v2 "$LOCAL" "$INV"; rc=$?
    unset EXTRA_SQL
    [ "$rc" = 0 ] || exit 1
    espera "$LOCAL" "$OBJ_F35A" "0|0|0|0" "volta: F3.5a fora da cópia" || exit 1
    mostra
    echo "== F3.5a FORA DA CÓPIA" ;;
  *) echo "uso: copia-qa.sh estado|ida|volta [--apos-merge]"; exit 2 ;;
esac
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
chmod +x .superpowers/f35a/mig/copia-qa.sh
/bin/bash .superpowers/f35a/mig/copia-qa.sh ida 2>&1 | tee .superpowers/f35a/logs/copia-ida.log | tail -12
VAR="/Users/sunglee/PLM + Criação/banco-local/app-teste-variantes"
bash "$VAR/criar-variante.sh" f35a "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a" 5180
"$VAR/f35a/subir.sh"
lsof -nP -iTCP:5188 -sTCP:LISTEN -t | sed 's/^/:5188 do dono intacto, PID /'
```

Expected: `== F3.5a NA CÓPIA` (com `OK (objetos…): 18|5|1|7`, `OK (ACL (#9)): 0|0|0`, `OK (funções pré-existentes intactas)`); `variante f35a pronta …`; `OK: variante f35a em http://localhost:5180 (PID …)` + a linha `[guarda-copia-local] OK: variante f35a (:5180, raiz …/sku-f35a) — cliente e worker -> http://127.0.0.1:54321 (cópia local)`; o `:5188` com o mesmo PID de antes. `RECUSADO`/`ABORTADO`/`ERRO`/`PARE`: pare e reporte (nunca contornar a guarda).

Escolher o card e as cores (SELECT só-leitura na cópia) e exportar:

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
Q() { PGCONNECT_TIMEOUT=5 psql "postgresql://postgres:postgres@127.0.0.1:54422/postgres" -X -A -t -q -v ON_ERROR_STOP=1 -c "BEGIN READ ONLY; $1; COMMIT;"; }
T="'37889b78-fffb-404b-8c75-18b7e50a1d9b'"
CARD="$(Q "select m.id from public.modelos m join public.modelo_tecidos mt on mt.modelo_id = m.id and mt.tipo = 'tecido' and mt.numero = 1 join public.modelo_tecido_variantes mtv on mtv.modelo_tecido_id = mt.id and mtv.variante_tecido_id is not null where m.tenant_id = $T and coalesce(m.origem,'interno') = 'interno' and coalesce(trim(m.ref),'') <> '' and (select count(*) from public.modelos o where o.tenant_id = m.tenant_id and o.ref = m.ref) = 1 and exists (select 1 from public.modelo_grades g where g.modelo_id = m.id and coalesce(g.grade_total,0) > 0) group by m.id, m.nome order by m.nome, m.id limit 1")"
CORES="$(Q "select string_agg(distinct c.nome, ',') from public.modelo_tecidos mt join public.modelo_tecido_variantes mtv on mtv.modelo_tecido_id = mt.id join public.variantes_tecido vt on vt.id = mtv.variante_tecido_id join public.cores c on c.id = vt.cor_id where mt.modelo_id = '$CARD' and mt.tipo = 'tecido' and mt.numero = 1")"
APELIDOS="$(Q "select coalesce(string_agg(distinct a.nome, ','), '') from public.modelo_tecidos mt join public.modelo_tecido_variantes mtv on mtv.modelo_tecido_id = mt.id join public.variantes_tecido vt on vt.id = mtv.variante_tecido_id join public.cores_apelido a on a.id = vt.cor_apelido_id where mt.modelo_id = '$CARD' and mt.tipo = 'tecido' and mt.numero = 1")"
printf 'F35A_CARD=%s\nF35A_CORES=%s\nF35A_APELIDOS=%s\n' "$CARD" "$CORES" "$APELIDOS" | tee .superpowers/f35a/qa-cards.env
```

Expected (24/set): o card "Blusa do Teste 1" (`28072185…`, REF `TOBMC10000009`, única na loja), cores `Bege,Preto,Verde`, apelidos `Black,Musgo`. CARD vazio ⇒ PARE e reporte (o dono decide completar um card pela tela na cópia — nada de INSERT/UPDATE à mão). Nome de cor com vírgula ⇒ PARE (o spec separa por vírgula).

- [ ] **Step 2: O spec** — criar `tests/e2e/f35a-qa.spec.ts` (NÃO versionar):

```ts
// tests/e2e/f35a-qa.spec.ts — QA da F3.5a (SKU: "Sigla SKU" em Cor base/Cor apelido, siglas na Grade de Tamanhos,
// "Formato do SKU" na Config da Loja, RPCs gerar_skus_modelo/salvar_sku_manual/skus_modelo). NÃO COMMITAR (apoio da
// worktree; apagado na Task 14).
// Alvos — F35A_ALVO obrigatório:
//  • "copia"    — app de teste DA WORKTREE (http://localhost:5180) sobre a CÓPIA LOCAL (http://127.0.0.1:54321).
//                 Guarda INVERTIDA: QUALQUER requisição a *.supabase.co (GET inclusive) é violação. S1–S5 NÃO gravam
//                 (escrita = violação); E1–E4 (F35A_ESCRITA=1) gravam SÓ na cópia (Loja Teste), um por vez.
//  • "producao" — smoke SÓ-LEITURA no :5173 do dono depois do merge (Task 14 Step 5): só o S0.
// Barradas ESPERADAS (as mesmas das fases anteriores): `rpc/servicos_financeiro` (NUNCA liberar) e o broadcast REST
// do Realtime. O robô NÃO troca de loja (sem selectStore): a loja é conferida pelo tenant_id das leituras de config.
// Rodar (cópia): set -a; . .superpowers/f35a/qa-cards.env; set +a; E2E_BASE_URL=http://localhost:5180 \
//   VITE_SUPABASE_URL=http://127.0.0.1:54321 F35A_ALVO=copia npx playwright test tests/e2e/f35a-qa.spec.ts \
//   --workers=1 --retries=0 -g "F3.5a — S"
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { doLogin } from "./_helpers";

const BASE = process.env.E2E_BASE_URL ?? "";
if (!/^http:\/\/localhost:\d+$/.test(BASE)) throw new Error(`E2E_BASE_URL precisa ser o vite LOCAL — recebido "${BASE}". Sem isso o QA NÃO foi feito.`);
const ALVO = process.env.F35A_ALVO ?? "";
if (ALVO !== "copia" && ALVO !== "producao") throw new Error(`F35A_ALVO obrigatório: "copia" ou "producao" (recebi "${ALVO}").`);
if (!process.env.VITE_SUPABASE_URL) throw new Error("VITE_SUPABASE_URL ausente: a guarda de rede não sabe o host do Supabase. PARE.");
const SUPA = new URL(process.env.VITE_SUPABASE_URL);
if (ALVO === "copia" && (SUPA.host !== "127.0.0.1:54321" || BASE !== "http://localhost:5180")) {
  throw new Error(`F35A_ALVO=copia exige VITE_SUPABASE_URL=http://127.0.0.1:54321 e E2E_BASE_URL=http://localhost:5180 (recebi ${SUPA.host} · ${BASE}).`);
}
if (ALVO === "producao" && (!/\.supabase\.co$/.test(SUPA.host) || BASE !== "http://localhost:5173")) {
  throw new Error(`F35A_ALVO=producao é o smoke no :5173 do dono (Supabase de produção) — recebi ${SUPA.host} · ${BASE}.`);
}
const ESCRITA = process.env.F35A_ESCRITA === "1";
if (ESCRITA && ALVO !== "copia") throw new Error("F35A_ESCRITA=1 só na cópia.");
const LOJA_TESTE = "37889b78-fffb-404b-8c75-18b7e50a1d9b";
const CARD = process.env.F35A_CARD ?? "";
const CORES = (process.env.F35A_CORES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const APELIDOS = (process.env.F35A_APELIDOS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (ESCRITA && (!/^[0-9a-f-]{36}$/.test(CARD) || CORES.length === 0)) throw new Error("F35A_CARD/F35A_CORES ausentes — rode o Step 1 da Task 12.");

// RPCs de LEITURA (STABLE) liberadas. Outra RPC = violação (o controlador confere no snapshot se é STABLE e sem escrita
// ANTES de acrescentar aqui, e registra). ⚠️ NUNCA `servicos_financeiro` (DEFINER VOLATILE — invariante #1).
const READ_RPCS = new Set([
  "sidebar_badges", "minhas_permissoes_efetivas", "get_user_tenant_id", "meu_tenant_ativo", "modelos_mo_a_aprovar_count",
  "otb_orcamento", "skus_modelo",
]);
if (READ_RPCS.has("servicos_financeiro")) throw new Error("servicos_financeiro é PROIBIDO em READ_RPCS.");
// Escritas que a F3.5a faz (só com F35A_ESCRITA=1, só na cópia).
const ESCRITAS_F35A = [
  /^PATCH \/rest\/v1\/cores$/, /^PATCH \/rest\/v1\/cores_apelido$/, /^PATCH \/rest\/v1\/tenant_config$/,
  /^POST \/rest\/v1\/rpc\/(gerar_skus_modelo|salvar_sku_manual)$/,
];
const BARRADAS_ESPERADAS = [/^POST \/rest\/v1\/rpc\/servicos_financeiro$/, /^POST \/realtime\/v1\/api\/broadcast/];
const OUT = path.resolve(".superpowers/f35a/qa");
const g = { violacoes: [] as string[], escritas: [] as string[], barradas: [] as string[], tenants: new Set<string>(), apikey: "" };
const ehSupabaseProducao = (u: URL) => /(^|\.)supabase\.co$/i.test(u.hostname);

async function guardar(ctx: BrowserContext) {
  if (ALVO === "copia") {
    await ctx.route((u) => ehSupabaseProducao(u), async (route) => {
      g.violacoes.push(`PRODUÇÃO ${route.request().method()} ${route.request().url()}`);
      await route.abort("blockedbyclient");
    });
  }
  await ctx.route((u) => u.host === SUPA.host, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const m = req.method();
    const p = u.pathname;
    const k = req.headers()["apikey"];
    if (k) g.apikey = k;
    if (p === "/rest/v1/tenant_config") {
      const t = u.searchParams.get("tenant_id");
      if (t) g.tenants.add(t.replace(/^eq\./, ""));
    }
    if (p.startsWith("/auth/v1/") || p.startsWith("/storage/v1/object/sign/")) return route.continue();
    if (p.startsWith("/rest/v1/rpc/")) {
      if (READ_RPCS.has(p.slice("/rest/v1/rpc/".length))) return route.continue();
    } else if (m === "GET" || m === "HEAD") {
      return route.continue();
    }
    const sig = `${m} ${p}`;
    if (ESCRITA && ESCRITAS_F35A.some((re) => re.test(sig))) {
      g.escritas.push(`${sig}${u.search}`);
      return route.continue();
    }
    if (BARRADAS_ESPERADAS.some((re) => re.test(sig))) g.barradas.push(sig);
    else g.violacoes.push(`${sig}${u.search}`);
    return route.abort("blockedbyclient");
  });
  const origem = new URL(BASE).origin;
  await ctx.route((u) => u.origin === origem, async (route) => {
    const m = route.request().method();
    if (m === "GET" || m === "HEAD") return route.continue();
    g.violacoes.push(`APP ${m} ${new URL(route.request().url()).pathname}`);
    return route.abort("blockedbyclient");
  });
}

let ctx: BrowserContext;
let page: Page;
test.beforeAll(async ({ browser }) => {
  fs.mkdirSync(OUT, { recursive: true });
  ctx = await browser.newContext();
  await guardar(ctx);
  page = await ctx.newPage();
  page.on("dialog", (d) => d.accept()); // "Sair do site?" (guarda de não salvo) ao trocar de página entre cenários
  await doLogin(page);
});
test.afterEach(async ({}, info) => {
  await page.screenshot({ path: path.join(OUT, `${info.title.replace(/[^\w-]+/g, "_")}.png`), fullPage: true });
  fs.appendFileSync(path.join(OUT, "rede.log"), `${info.title}\n  escritas=${JSON.stringify(g.escritas)}\n  barradas=${JSON.stringify(g.barradas)}\n  violacoes=${JSON.stringify(g.violacoes)}\n`);
  expect(g.violacoes, "violações da guarda de rede").toEqual([]);
  expect(g.tenants.size === 0 || [...g.tenants].every((t) => t === LOJA_TESTE), `loja ≠ Loja Teste: ${[...g.tenants]}`).toBe(true);
  g.escritas = [];
  g.barradas = [];
});
test.afterAll(async () => { await ctx?.close(); });

async function abrirAtributo(nome: "Cor base" | "Cor apelido" | "Grade de Tamanhos") {
  await page.goto("/cadastro/atributos", { waitUntil: "networkidle" });
  await page.getByRole("navigation").getByRole("button", { name: nome, exact: true }).click();
}
const semEstouro = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe("F3.5a — S (só leitura)", () => {
  test.skip(ALVO !== "copia", "S1–S5 só na cópia");

  test("S1 — Cor base e Cor apelido mostram a coluna 'Sigla SKU'; o lápis abre o campo e o X não grava", async () => {
    await abrirAtributo("Cor base");
    await expect(page.getByRole("columnheader", { name: /Sigla SKU/ })).toBeVisible();
    const linha = page.locator("tbody tr").first();
    await linha.locator("td").last().getByRole("button").first().click();
    await expect(linha.getByLabel("Sigla SKU")).toBeVisible();
    await linha.locator("td").last().getByRole("button").nth(1).click(); // X = cancelar
    await expect(linha.getByLabel("Sigla SKU")).toHaveCount(0);
    await abrirAtributo("Cor apelido");
    await expect(page.getByRole("columnheader", { name: /Sigla SKU/ })).toBeVisible();
    expect(g.escritas).toEqual([]);
  });

  test("S2 — Grade de Tamanhos: bloco 'Siglas no SKU' com um campo por lado e a prévia '34 → …'; 'Preencher vazias' só mexe no rascunho", async () => {
    await abrirAtributo("Grade de Tamanhos");
    const bloco = page.locator('[data-secao="siglas-tamanho"]');
    await expect(bloco).toBeVisible();
    expect(await bloco.getByLabel(/^Sigla SKU do tamanho /).count()).toBeGreaterThan(0);
    await expect(bloco.getByText(/→/).first()).toBeVisible();
    const preencher = bloco.getByRole("button", { name: /Preencher vazias/ });
    if (await preencher.isEnabled()) {
      await preencher.click();
      await expect(bloco.getByRole("button", { name: "Salvar siglas" })).toBeEnabled();
    }
    expect(g.escritas).toEqual([]);
  });

  test("S3 — Config da Loja: 'Formato do SKU' com partes, separador entre cada par, 'Tamanho em' e prévia ao vivo (sem salvar)", async () => {
    await page.goto("/admin/configuracoes", { waitUntil: "networkidle" });
    const card = page.locator('[data-secao="formato-sku"]');
    await expect(card).toBeVisible();
    for (const p of ["REF", "Cor base", "Tamanho"]) {
      const cb = card.getByRole("checkbox", { name: `Usar "${p}" no SKU` });
      if ((await cb.getAttribute("data-state")) !== "checked") await cb.click();
    }
    await card.getByLabel("Separador entre REF e Cor base").fill("-");
    const previa = card.locator("[data-sku-previa]").first();
    const falta = card.getByText(/Falta sigla|Falta a cor base/).first();
    await expect(previa.or(falta)).toBeVisible();
    if (await previa.count()) await expect(previa).toContainText("-");
    await expect(card.getByRole("button", { name: "Salvar formato do SKU" })).toBeEnabled();
    expect(g.escritas).toEqual([]);
  });

  test("S4 — celular (390 px): Atributos e Config sem estouro horizontal", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/cadastro/atributos", { waitUntil: "networkidle" });
    expect(await semEstouro()).toBe(true);
    await page.goto("/admin/configuracoes", { waitUntil: "networkidle" });
    await page.locator('[data-secao="formato-sku"]').scrollIntoViewIfNeeded();
    expect(await semEstouro()).toBe(true);
    await page.setViewportSize({ width: 1366, height: 900 });
  });

  test("S5 — ACL pela API: sem login, as RPCs e os _core recusam (nada gravado)", async () => {
    expect(g.apikey, "a guarda precisa ter visto a apikey do app").not.toBe("");
    for (const fn of ["gerar_skus_modelo", "salvar_sku_manual", "skus_modelo", "_gerar_skus_modelo_core", "_skus_modelo_calc"]) {
      const r = await fetch(`${SUPA.origin}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { apikey: g.apikey, "Content-Type": "application/json" },
        body: JSON.stringify(fn === "salvar_sku_manual" ? { _id: "00000000-0000-0000-0000-000000000000", _sku: "X" } : { _modelo_id: CARD || "00000000-0000-0000-0000-000000000000" }),
      });
      expect(r.ok, `${fn} respondeu ${r.status} sem login`).toBe(false);
    }
  });
});

test.describe("F3.5a — E (grava na CÓPIA — F35A_ESCRITA=1, um por vez)", () => {
  test.skip(!ESCRITA, "só com F35A_ESCRITA=1 (na cópia)");

  async function siglaNaLinha(nome: string, sigla: string) {
    const linha = page.locator("tbody tr").filter({ has: page.getByText(nome, { exact: true }) }).first();
    await linha.locator("td").last().getByRole("button").first().click();
    await linha.getByLabel("Sigla SKU").fill(` ${sigla.toLowerCase()} `);
    await linha.locator("td").last().getByRole("button").first().click(); // ✓
    await expect(page.getByText("Atualizado.").first()).toBeVisible();
    await expect(linha.locator("span.font-mono")).toHaveText(sigla.toUpperCase()); // normalizada pelo gatilho
  }

  test("E1 — siglas das cores do card (maiúsculas no servidor)", async () => {
    await abrirAtributo("Cor base");
    for (const c of CORES) await siglaNaLinha(c, c.slice(0, 3));
    if (APELIDOS.length) {
      await abrirAtributo("Cor apelido");
      for (const a of APELIDOS) await siglaNaLinha(a, a.slice(0, 3));
    }
    expect(g.escritas.every((e) => /^PATCH \/rest\/v1\/cores(_apelido)?\?/.test(e))).toBe(true);
  });

  test("E2 — siglas da grade: 'Preencher vazias' + 'Salvar siglas' (só tamanhos_sku)", async () => {
    await abrirAtributo("Grade de Tamanhos");
    const bloco = page.locator('[data-secao="siglas-tamanho"]');
    const preencher = bloco.getByRole("button", { name: /Preencher vazias/ });
    if (await preencher.isEnabled()) await preencher.click();
    await bloco.getByRole("button", { name: "Salvar siglas" }).click();
    await expect(page.getByText("Siglas de tamanho salvas.").first()).toBeVisible();
    expect(g.escritas.length).toBe(1);
    expect(g.escritas[0]).toMatch(/^PATCH \/rest\/v1\/tenant_config\?/);
  });

  test("E3 — Formato do SKU salvo (AlertDialog) e prévia com SKU real", async () => {
    await page.goto("/admin/configuracoes", { waitUntil: "networkidle" });
    const card = page.locator('[data-secao="formato-sku"]');
    for (const p of ["REF", "Cor base", "Cor apelido", "Tamanho"]) {
      const cb = card.getByRole("checkbox", { name: `Usar "${p}" no SKU` });
      if ((await cb.getAttribute("data-state")) !== "checked") await cb.click();
    }
    await card.getByLabel("Separador entre REF e Cor base").fill("-");
    await card.getByRole("button", { name: "Salvar formato do SKU" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Formato do SKU salvo.").first()).toBeVisible();
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator('[data-secao="formato-sku"] [data-sku-previa]').first()).toContainText("-");
    expect(g.escritas.length).toBe(1);
  });

  test("E4 — RPCs com a sessão do usuário: gerar, editar à mão, regerar (manual preservado), ler a matriz", async () => {
    const r = await page.evaluate(async ({ url, apikey, card }) => {
      const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x));
      const token = k ? JSON.parse(localStorage.getItem(k) ?? "{}").access_token : "";
      const rpc = async (fn: string, body: unknown) => {
        const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
          method: "POST",
          headers: { apikey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return { status: res.status, json: await res.json() };
      };
      const g1 = await rpc("gerar_skus_modelo", { _modelo_id: card, _regerar: false });
      const alvo = (g1.json?.linhas ?? []).find((l: any) => l.estado === "ok");
      const man = alvo ? await rpc("salvar_sku_manual", { _id: alvo.id, _sku: ` QA-F35A-${Date.now() % 100000} ` }) : null;
      const g2 = await rpc("gerar_skus_modelo", { _modelo_id: card, _regerar: true });
      const ler = await rpc("skus_modelo", { _modelo_id: card });
      return { g1, alvo, man, g2, ler };
    }, { url: SUPA.origin, apikey: g.apikey, card: CARD });
    fs.writeFileSync(path.join(OUT, "e4.json"), JSON.stringify(r, null, 2));
    expect(r.g1.status).toBe(200);
    expect(r.g1.json.status).toBe("ok");
    expect(r.g1.json.criados).toBeGreaterThan(0);
    expect(r.man?.status).toBe(200);
    expect(r.man?.json.manual).toBe(true);
    const mantido = (r.ler.json.linhas as any[]).find((l) => l.id === r.alvo.id);
    expect(mantido).toMatchObject({ estado: "manual", manual: true, sku: r.man?.json.sku });
    expect(r.g2.json.conflitos).toEqual([]);
  });
});

test.describe("F3.5a — S0 (smoke só-leitura em produção, depois do merge)", () => {
  test.skip(ALVO !== "producao", "só no smoke");
  test("S0 — Atributos e Config abrem com a coluna/bloco novos; nenhuma escrita", async () => {
    await abrirAtributo("Cor base");
    await expect(page.getByRole("columnheader", { name: /Sigla SKU/ })).toBeVisible();
    await page.goto("/admin/configuracoes", { waitUntil: "networkidle" });
    await expect(page.locator('[data-secao="formato-sku"]')).toBeVisible();
    expect(g.escritas).toEqual([]);
  });
});
```

- [ ] **Step 3: Automático S1–S5 (só leitura)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
set -a; . .superpowers/f35a/qa-cards.env; set +a
E2E_BASE_URL=http://localhost:5180 VITE_SUPABASE_URL=http://127.0.0.1:54321 F35A_ALVO=copia \
  npx playwright test tests/e2e/f35a-qa.spec.ts --workers=1 --retries=0 -g "F3.5a — S" 2>&1 | tee .superpowers/f35a/qa/s.log | tail -15
```

Expected: 5 passed (S0 skipped); `rede.log` sem violação; screenshots em `.superpowers/f35a/qa/`. RPC de leitura desconhecida barrada ⇒ o controlador confere no `pg_get_functiondef` (cópia) que é STABLE e não escreve ANTES de pô-la em `READ_RPCS` (e registra). Falha de seletor (não de produto) ⇒ ajustar o spec, registrar no relatório, rodar de novo.

- [ ] **Step 4: E1–E4 (gravam NA CÓPIA — avisar o dono no chat antes; um por vez)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
set -a; . .superpowers/f35a/qa-cards.env; set +a
for e in E1 E2 E3 E4; do
  E2E_BASE_URL=http://localhost:5180 VITE_SUPABASE_URL=http://127.0.0.1:54321 F35A_ALVO=copia F35A_ESCRITA=1 \
    npx playwright test tests/e2e/f35a-qa.spec.ts --workers=1 --retries=0 -g "F3.5a — E .* $e —" > ".superpowers/f35a/qa/$e.log" 2>&1
  tail -4 ".superpowers/f35a/qa/$e.log"
  grep -q " 1 passed" ".superpowers/f35a/qa/$e.log" || { echo "PARE em $e (o próximo depende deste)"; break; }
done
cat .superpowers/f35a/qa/e4.json | head -40
```

Expected: E1–E4 passed; `rede.log` mostra SÓ as escritas previstas (PATCH `cores`/`cores_apelido`/`tenant_config`, POST `rpc/gerar_skus_modelo`/`rpc/salvar_sku_manual`); o `e4.json` com `g1.json.status = "ok"`, `criados > 0`, a linha editada à mão como `manual` DEPOIS do Regerar, `conflitos: []`.

- [ ] **Step 5: Manual do dono (opcional, recomendado)** — o dono abre `http://localhost:5180`, confere visualmente Cadastro › Atributos (Cor base/Cor apelido com "Sigla SKU"; Grade com "Siglas no SKU") e Config (Formato do SKU, prévia), no desktop e no celular. Registrar o OK/ajustes no relatório.

- [ ] **Step 6: Desmontar**

```bash
VAR="/Users/sunglee/PLM + Criação/banco-local/app-teste-variantes"
"$VAR/f35a/descer.sh"
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
/bin/bash .superpowers/f35a/mig/copia-qa.sh volta 2>&1 | tail -8
```

Expected: `:5180` fora do ar (só a variante f35a); `dados do QA exportados: …/f35a-dados-copia-<data>` → `== F3.5a FORA DA CÓPIA` (cópia de volta ao estado do Task 0). Relatório do QA (`.superpowers/f35a/qa/RELATORIO.md`): S/E, rede, screenshots, desvios de seletor, OK do dono → guardião.

---

## Task 11: Portões — G-commit, G-migration e OK do dono  *(controlador + guardião; sem código)*

- [ ] **Step 1: G-commit** — acionar o agente `guardiao-unificacao` com: este plano, o diário da campanha, `git log --oneline "$(cat .superpowers/f35a/BASE)"..HEAD` (7 commits), `.superpowers/f35a/{desvios.md,ancoras-divergentes.md,sobreposicao.txt}`, os logs de gates, o log do ensaio (Task 6) e o relatório do QA (Task 10). Pede com evidência: escopo = §4; Dev intocado; `configuracoes.tsx` +2/-0; nenhum `\i`/`psql -f`/escrita fora da cópia; revisões Opus de TODAS as tasks registradas.
- [ ] **Step 2: G-migration** — **no Fable (ponto de não-retorno: avisar o dono antes de usar o Fable — política de modelos); sem o Fable, 2 revisões Opus INDEPENDENTES (uma sem ver a outra) + aviso ao dono de que o portão rodou sem o Fable**. Checklist (com `arquivo:linha` ou comando + saída):
  1. arquivo único em `BEGIN…COMMIT`, idempotente (a suíte aplica 2× — teste "aplicar 2×"), número `20261003100000` > todas as migrations (inclusive F1 `…150000`, F3.1 `20260930180000`, Aviso `20261001100000` e Nota `20261002100000`);
  2. NENHUMA função pré-existente redefinida (ensaio: `FN_PRE` igual antes/depois);
  3. ACL #9: `_core`/cálculo/helpers/gatilhos sem EXECUTE p/ PUBLIC, anon e authenticated; RPCs só `authenticated`; `modelo_skus` sem escrita p/ clientes (`ACL_F35A = 0|0|0`; teste "como o PostgREST");
  4. UNIQUE só compostas `(tenant_id, sku)` e `(modelo_id, variante_key, tamanho_key)` (nenhuma em coluna única embedada); FK `modelo_id` com CASCADE;
  5. RLS por loja + `modgate_*` RESTRICTIVE do `criacao` (padrão `modelo_grades`);
  6. ALTERs no FIM do arquivo; tempo medido no ensaio (lock em produção < 1 s); `aplica_v2` pronto (`producao.sh`);
  7. inverso DESTRUTIVO com guarda de confirmação + export antes (round-trip testado);
  8. anti-drift TS × SQL verde (5 testes) e as mensagens PT idênticas;
  9. decisões D1–D4 do dono aplicadas como respondidas;
  10. ordem de produção: F1 → Aviso → Nota → F3.5a; front só junta DEPOIS (Task 12 antes da Task 13).
  Veredito no diário. **BLOQUEIA ⇒ parar.** Ressalvas ⇒ resolver antes do Step 3.
- [ ] **Step 3: OK explícito do dono** — em PT-BR simples: o que a migration faz (só acrescenta; nenhuma loja muda até alguém cadastrar siglas e o formato), o resultado do ensaio e do QA, o veredito do guardião, as respostas D1–D4, a ciência das REFs repetidas (F11) e o plano de volta (Task 12 Step 5). Resposta literal + data no diário. Sem "sim" ⇒ parar.

---

## Task 12: PRODUÇÃO — pelo DONO, no Terminal, com backup completo ANTES  *(dono; controlador acompanha pelo chat)*

> ⛔ Pré-condições: Task 11 inteira (G-migration APROVA + OK do dono); **F1, Aviso Global e Data da Nota de Entrada JÁ em produção** (diário do guardião); fora do horário de uso das lojas. O plano Supabase NÃO tem PITR: o `backup_prod` é obrigatório e vem primeiro. O agente NÃO roda nada contra produção.

**Files:** nenhum no git. Cria `.superpowers/f35a/mig/producao.sh`; saída em `/Users/sunglee/PLM + Criação/savepoints/<data>-pre-f35a-sku/` (FORA do repo; dados de lojas — nunca commitar).

- [ ] **Step 1: O script** (o controlador cria; o dono roda) — `.superpowers/f35a/mig/producao.sh`:

```bash
#!/usr/bin/env bash
# PRODUÇÃO da F3.5a — SÓ O DONO roda, no Terminal (bash), na raiz da worktree, DEPOIS de: G-migration APROVADO + OK
# explícito do dono (diário do guardião) + F1, Aviso Global e Data da Nota de Entrada JÁ aplicadas em produção.
# O plano Supabase NÃO tem PITR: o backup COMPLETO (backup_prod) vem ANTES de tudo. Uso:
#   /bin/bash --noprofile --norc
#   source .superpowers/f35a/mig/aplica.sh && export NOTA=20261002100000 && source .superpowers/f35a/mig/producao.sh
#   (NOTA = versão da migration da Data da Nota de Entrada — 20261002100000_oc_data_nota_entrada.sql no plano dela; conferir no diário)
#   backup_prod && prevoo_prod && ida_prod && registra_prod && pos_prod
# Volta (SÓ com OK do dono, depois de tirar do ar o front que grava as colunas): volta_prod
[ -n "${BASH_VERSION:-}" ] || { echo "ERRO: use bash"; return 1 2>/dev/null || exit 1; }
[ -n "${OBJ_F35A:-}" ] || { echo "ERRO: carregue antes: source .superpowers/f35a/mig/aplica.sh"; return 1; }
[ -n "${NOTA:-}" ] || { echo "ERRO: export NOTA=<versão da migration da Data da Nota de Entrada> (do plano/diário dela)"; return 1; }
PROD="$(cat /tmp/dburl.txt)"
DP="/Users/sunglee/PLM + Criação/savepoints/$(date +%F)-pre-f35a-sku"
mkdir -p "$DP"
backup_prod() {
  local f="$DP/producao-completa.dump"
  docker exec supabase_db_banco-local pg_dump -d "$PROD" -Fc > "$f" && [ -s "$f" ] \
    || { echo "FALHOU (backup): pg_dump não gerou o arquivo"; rm -f "$f"; return 1; }
  docker exec -i supabase_db_banco-local pg_restore -l < "$f" > "$DP/producao-completa.lista" \
    || { echo "FALHOU (backup): pg_restore -l não leu o dump"; return 1; }
  echo "OK (backup): $f ($(du -h "$f" | cut -f1); $(grep -c ';' "$DP/producao-completa.lista") entradas) — dados de TODAS as lojas: não commitar/compartilhar"
}
prevoo_prod() {
  echo "== pré-voo F3.5a em PRODUÇÃO (só leitura) $(date '+%F %T')"
  git diff --quiet HEAD -- "$MIG" "$INV" || { echo "FALHOU (arquivos): SQL da F3.5a com alteração não commitada"; return 1; }
  [ "$(md5 -q "$MIG")" = "$(cat .superpowers/f35a/mig/md5-mig.txt)" ] || { echo "FALHOU (arquivos): a migration não é a do ensaio (md5)"; return 1; }
  [ -s "$DP/producao-completa.dump" ] || { echo "FALHOU: sem backup de hoje — rode backup_prod"; return 1; }
  espera "$PROD" "select current_setting('server_version_num')::int >= 170000 and exists (select 1 from pg_settings where name = 'transaction_timeout')" "t" "PG >= 17 com transaction_timeout" &&
  espera "$PROD" "$OBJ_F35A" "0|0|0|0" "objetos da F3.5a ainda NÃO existem" &&
  espera "$PROD" "select count(*) from supabase_migrations.schema_migrations where version in ('20260930150000', '20261001100000', '$NOTA')" "3" "F1, Aviso e Nota já registradas" &&
  psql "$PROD" -X -A -t -c "$FN_PRE" > "$DP/funcoes-pre.txt" && echo "OK (retrato): funções pré-existentes $(cat "$DP/funcoes-pre.txt")" &&
  psql "$PROD" -X -A -t -c "select datlocprovider || '|' || datcollate from pg_database where datname = current_database()" | sed 's/^/INFO locale (upper do SQL × toUpperCase do JS): /' &&
  ativ_vazio "$PROD" &&
  echo "== PRÉ-VOO OK $(date '+%T')"
}
ida_prod() {
  prevoo_prod && aplica_v2 "$PROD" "$MIG" &&
  espera "$PROD" "$OBJ_F35A" "18|5|1|7" "IDA: objetos da F3.5a" &&
  espera "$PROD" "$ACL_F35A" "0|0|0" "IDA: ACL (#9)" &&
  espera "$PROD" "$FN_PRE" "$(cat "$DP/funcoes-pre.txt")" "IDA: nenhuma função pré-existente mudou" &&
  echo "== F3.5a APLICADA EM PRODUÇÃO $(date '+%T')"
}
registra_prod() {
  psql "$PROD" -X -v ON_ERROR_STOP=1 -q -c "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261003100000', 'sku_automatico', '{}'::text[]) ON CONFLICT (version) DO NOTHING" &&
  espera "$PROD" "select version || '|' || name from supabase_migrations.schema_migrations where version = '20261003100000'" "20261003100000|sku_automatico" "registro"
}
pos_prod() {  # só leitura: a migration não escreveu dado (tabela vazia, colunas novas todas NULL)
  espera "$PROD" "select (select count(*) from public.modelo_skus) || '|' || (select count(*) from public.cores where sigla_sku is not null) || '|' || (select count(*) from public.cores_apelido where sigla_sku is not null) || '|' || (select count(*) from public.tenant_config where sku_config is not null or tamanhos_sku is not null) || '|' || (select count(*) from public.modelos where tamanho_tipo is not null)" "0|0|0|0|0" "pós: nenhuma linha escrita"
}
volta_prod() {  # SÓ com OK do dono. Exporta o que as lojas já gravaram e aplica o inverso com a confirmação.
  local x="$DP/volta-$(date +%H%M%S)"
  mkdir -p "$x"
  psql "$PROD" -X -q -c "\copy (SELECT id, tenant_id, nome, sigla_sku FROM public.cores WHERE sigla_sku IS NOT NULL) TO '$x/cores.csv' CSV HEADER" &&
  psql "$PROD" -X -q -c "\copy (SELECT id, tenant_id, nome, sigla_sku FROM public.cores_apelido WHERE sigla_sku IS NOT NULL) TO '$x/cores_apelido.csv' CSV HEADER" &&
  psql "$PROD" -X -q -c "\copy (SELECT tenant_id, tamanhos_sku, sku_config FROM public.tenant_config WHERE tamanhos_sku IS NOT NULL OR sku_config IS NOT NULL) TO '$x/tenant_config.csv' CSV HEADER" &&
  psql "$PROD" -X -q -c "\copy (SELECT id, tenant_id, tamanho_tipo FROM public.modelos WHERE tamanho_tipo IS NOT NULL) TO '$x/modelos_tamanho_tipo.csv' CSV HEADER" &&
  psql "$PROD" -X -q -c "\copy (SELECT * FROM public.modelo_skus) TO '$x/modelo_skus.csv' CSV HEADER" || { echo "FALHOU (export) — NÃO seguir"; return 1; }
  echo "exportado: $x"
  ativ_vazio "$PROD" || return 1
  export EXTRA_SQL="SET LOCAL app.confirmo_apagar_skus = 'sim';"
  aplica_v2 "$PROD" "$INV"; local rc=$?
  unset EXTRA_SQL
  [ "$rc" = 0 ] || return 1
  espera "$PROD" "$OBJ_F35A" "0|0|0|0" "VOLTA: F3.5a fora de produção" &&
  espera "$PROD" "$FN_PRE" "$(cat "$DP/funcoes-pre.txt")" "VOLTA: funções pré-existentes = antes" &&
  psql "$PROD" -X -v ON_ERROR_STOP=1 -q -c "DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261003100000'" &&
  echo "== F3.5a DESFEITA EM PRODUÇÃO"
}
```

- [ ] **Step 2: Backup + pré-voo (dono, bash)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
/bin/bash --noprofile --norc
source .superpowers/f35a/mig/aplica.sh && export NOTA=20261002100000 && source .superpowers/f35a/mig/producao.sh
backup_prod && prevoo_prod
```

Expected: `OK (backup): …/producao-completa.dump (<tamanho>; <n> entradas)`; `OK (PG >= 17 …): t`; `OK (objetos da F3.5a ainda NÃO existem): 0|0|0|0`; `OK (F1, Aviso e Nota já registradas): 3`; o retrato das funções; `INFO locale …` (se não for ICU/`en-US`, o controlador confere que as siglas do anti-drift são ASCII/ç e segue); `OK (ATIV): nenhuma transação longa`; `== PRÉ-VOO OK`. Qualquer `FALHOU`: PARE (não aplicar).

- [ ] **Step 3: Aplicar (dono, no MESMO bash, logo depois do pré-voo)**

```bash
ida_prod && registra_prod && pos_prod
```

Expected: igual ao ensaio — `== …sku_automatico.sql (início …)`, os 2 avisos de transação, `real` na ordem do ensaio; `OK (IDA: objetos da F3.5a): 18|5|1|7`; `OK (IDA: ACL (#9)): 0|0|0`; `OK (IDA: nenhuma função pré-existente mudou)`; `== F3.5a APLICADA EM PRODUÇÃO`; `OK (registro): 20261003100000|sku_automatico`; `OK (pós: nenhuma linha escrita): 0|0|0|0|0`. `canceling statement due to lock timeout` repetido 5× ⇒ o `aplica_v2` PARA sozinho: esperar, repetir o `ida_prod` mais tarde (nada ficou); outro erro ⇒ PARAR e falar com o controlador.

- [ ] **Step 4: Registrar** — saída inteira dos Steps 2–3 no diário do guardião e na memória da campanha (`project_sku_automatico`: "F3.5a aplicada em produção em <data>").

- [ ] **Step 5: Volta (SÓ com OK do dono; NÃO faz parte do fluxo)** — ordem: (1) tirar do ar o front que grava as colunas (se a Task 13 já juntou, reverter o merge no branch/deploy); (2) OK explícito do dono para APAGAR siglas/formato/SKUs; (3) no bash com os 2 `source`: `volta_prod` (exporta tudo para `…/volta-<hora>/`, aplica o inverso com a confirmação, confere funções pré-existentes = antes e desregistra). Última rede: o `producao-completa.dump`.

---

## Task 13: Snapshot só-leitura, rebase, merge, cópia pós-merge e smoke  *(controlador)*

- [ ] **Step 1: Snapshot só-leitura de PRODUÇÃO antes do merge** (depois da Task 12; o front novo passa a gravar siglas/formato/SKUs pelo `:5173` do dono). Se o classificador barrar o agente, o DONO roda o mesmo bloco:

```bash
DEST="/Users/sunglee/PLM + Criação/savepoints/$(date +%F)-pre-merge-f35a"
mkdir -p "$DEST"
URL="$(cat /tmp/dburl.txt)"
R() { PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -X -v ON_ERROR_STOP=1 -q -c "$1"; }
R "\copy (SELECT id, tenant_id, nome, sigla_sku FROM public.cores ORDER BY id) TO '$DEST/cores.csv' CSV HEADER"
R "\copy (SELECT id, tenant_id, nome, cor_base_id, sigla_sku FROM public.cores_apelido ORDER BY id) TO '$DEST/cores_apelido.csv' CSV HEADER"
R "\copy (SELECT tenant_id, tamanhos_grade, tamanhos_sku, sku_config FROM public.tenant_config ORDER BY tenant_id) TO '$DEST/tenant_config_sku.csv' CSV HEADER"
R "\copy (SELECT id, tenant_id, origem, ref, tamanho_tipo, rev FROM public.modelos ORDER BY id) TO '$DEST/modelos_sku.csv' CSV HEADER"
R "\copy (SELECT id, modelo_id, tamanho_tipo FROM public.produtos_acabados ORDER BY id) TO '$DEST/produtos_acabados.csv' CSV HEADER"
R "\copy (SELECT id, modelo_id, tamanho_tipo FROM public.produtos_importados ORDER BY id) TO '$DEST/produtos_importados.csv' CSV HEADER"
R "\copy (SELECT * FROM public.modelo_skus ORDER BY id) TO '$DEST/modelo_skus.csv' CSV HEADER"
R "\copy (SELECT tenant_id, ref, count(*) AS cards, string_agg(id::text, ' ') AS ids FROM public.modelos WHERE coalesce(trim(ref),'') <> '' GROUP BY 1, 2 HAVING count(*) > 1 ORDER BY 1, 2) TO '$DEST/refs_repetidas.csv' CSV HEADER"
(cd "$DEST" && for f in *.csv; do printf '%s\t%s linhas\t%s\n' "$f" "$(($(wc -l < "$f") - 1))" "$(shasum -a 256 "$f" | cut -c1-16)"; done) > "$DEST/INDICE.tsv"
cat "$DEST/INDICE.tsv"
```

Expected: 8 CSVs com contagem e hash; `modelo_skus.csv` com 0 linhas e as colunas novas todas vazias (nada gravado ainda); `refs_repetidas.csv` = a lista que vai dar "conflito" ao gerar (levar ao dono — F11). `LEIA-ME.md` na pasta: data, sha do código, "restaurar só com OK do dono", "dados de lojas — não commitar". Guardião anota no diário (G-fase).

- [ ] **Step 2: Rebase (se a principal andou) + gates**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
git status --porcelain -- src supabase tests | grep -v '^?? tests/e2e/f35a-qa.spec.ts$' | grep . && echo "WORKTREE SUJA — PARE (commitar; nunca stash)"
B="$(cat .superpowers/f35a/BASE)"
git merge-base --is-ancestor "$B" feature/plan-tecido-a1 && echo "BASE na principal: ok"
git log --oneline "$B"..feature/plan-tecido-a1 | tee .superpowers/f35a/logs/principal-andou.txt | wc -l
git rebase --onto feature/plan-tecido-a1 "$B" f35a/sku-banco-cadastros
git rev-parse feature/plan-tecido-a1 > .superpowers/f35a/BASE
bash .superpowers/f35a/gates.sh
ps -Ao pid,command | grep -E "[v]itest|[p]laywright"; echo "testes-checados"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres SKU_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/sku-automatico.test.ts 2>&1 | tail -4
```

Expected: `BASE na principal: ok`; rebase limpo (conflito: regra do §4.2 — ficar com a principal e reaplicar a MESMA intenção; registrar em `.superpowers/f35a/rebase.md`); `GATES F3.5a: ok`; `Tests  24 passed (24)`. Se `configuracoes.tsx` mudou na principal (F2 entrou): re-revisão Opus do trecho com o diff.

- [ ] **Step 3: Merge (fast-forward) — só com a Task 12 OK**

Avisar o dono ANTES (chat): salvar e fechar Config da Loja e Cadastro › Atributos no `:5173` e no `:5188`.

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
git status --porcelain -- src supabase tests | grep . && echo "checkout principal com alteração — PARE e falar com o dono"
git merge --ff-only f35a/sku-banco-cadastros && git log --oneline -8
```

Expected: fast-forward; os commits `F3.5a (1)…(9)` no topo.

- [ ] **Step 4: A F3.5a volta à CÓPIA e FICA** (o `:5188` do dono serve o checkout principal, que agora manda `sigla_sku`/`sku_config`/`tamanhos_sku`)

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
/bin/bash .superpowers/f35a/mig/copia-qa.sh ida 2>&1 | tail -6
```

Expected: `== F3.5a NA CÓPIA`. Daqui em diante ela fica na cópia; um re-ensaio da F1 (ou regravar as referências de fidelidade dela) exige tirá-la antes: `copia-qa.sh volta --apos-merge` (dono avisado).

- [ ] **Step 5: Smoke SÓ-LEITURA no `:5173` do dono (produção)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-f35a"
curl -s -o /dev/null -w ':5173 http=%{http_code}\n' http://localhost:5173/
E2E_BASE_URL=http://localhost:5173 VITE_SUPABASE_URL="$(grep -E '^VITE_SUPABASE_URL=' .env | cut -d= -f2- | tr -d '"')" F35A_ALVO=producao \
  npx playwright test tests/e2e/f35a-qa.spec.ts --workers=1 --retries=0 -g "S0" 2>&1 | tail -5
```

Expected: `:5173 http=200` (o `:5173` NÃO é derrubado nem reiniciado; se estiver fora do ar, pular e anotar); `1 passed`; nenhuma escrita (a guarda aborta tudo que não é leitura).

- [ ] **Step 6: Limpeza + docs** — apagar `tests/e2e/f35a-qa.spec.ts` (nunca versionado); manter `.superpowers/f35a/` até o dono encerrar a fase; `docs-keeper`: CLAUDE.md ganha a invariante do SKU (fonte única no servidor, wrapper + `_core`, siglas normalizadas por gatilho, manual nunca sobrescrito, UNIQUE `(tenant_id, sku)`), `docs/api-integracao-erp.md` ganha a nota "SKU por variante × tamanho em `modelo_skus`" (spec §5) e a memória `project_sku_automatico` vira "F3.5a FEITA; F3.5b a seguir". Deploy Cloudflare do front: pendente, do dono (`npm run deploy`), junto com as demais fases.

---

## 7. Riscos (com evidência) e o que o plano faz

| # | Risco | Evidência | Mitigação |
|---|---|---|---|
| R1 | SQL não executado no planejamento (sintaxe/semântica plpgsql) | regra da fase | TDD em txn na cópia (Tasks 3–5) antes de qualquer apply; `desvios.md`; revisão Opus por task; ensaio completo (Task 6) |
| R2 | Front junto antes da migration em produção ⇒ Salvar das siglas/formato falha | o `:5173` grava em produção | Task 12 antes da 13; o `AttributeTab` só manda `sigla_sku` quando muda (editar nome segue funcionando) |
| R3 | Lock em `tenant_config`/`modelos`/`cores` na aplicação trava as policies de todas as lojas | incidente 23/set | ALTERs no fim; `aplica_v2` (500 ms/3 s, 5 tentativas); ATIV vazio; fora do horário |
| R4 | REF repetida ⇒ conflitos ao gerar | F11 (7 pares) | `conflitos[]` com mensagem PT; SKU manual resolve; lista no snapshot (Task 13) |
| R5 | Sigla repetida entre cores (ex.: Amarelo e Âmbar = AM) ⇒ SKU repetido no mesmo produto | teste "conflito DENTRO do produto" | a 2ª linha não grava e diz "repetido neste produto"; F3.5b mostra |
| R6 | Mudança de sigla/formato NÃO muda SKUs gerados (Q2) — alguém pode esperar que mude | decisão Q2 | AlertDialog e textos dizem "só pelo Regerar"; `skus_modelo` marca `divergente` |
| R7 | Tamanho solto classificado errado ("3M") | spec §6 | sigla editável; `ladoTamanho` cai no lado que existir |
| R8 | Locale de produção ≠ ICU ⇒ `upper()` × `toUpperCase()` diferem fora do ASCII | F16 | pré-voo mostra o provedor; siglas são curtas/ASCII na prática; anti-drift cobre ASCII + ç |
| R9 | Cópia compartilhada: F3.5a aplicada na cópia muda contagens que outras frentes conferem | F16 | `copia-qa.sh` com backup, `ida`/`volta`, e recusa com `:5180` no ar; re-ensaio da F1 exige tirar a F3.5a antes |

## 8. Fora de escopo (F3.5a)

Seção "REF e SKUs" e "Tamanho em" nos cards (F3.5b — §10); migrar os 17 `split("|")`; exportar SKU ao ERP; EAN; SKU de insumo/aviamento; auditoria de `modelo_skus` e Realtime dela; "voltar ao automático" de um SKU manual (a F3.5b decide se precisa — hoje o manual só muda por outro manual).

## 9. Autorrevisão e o que o planejador EXECUTOU (24/set, sem tocar `src/`/`supabase/`/banco)

- **TS:** `tamanho.ts`, `sku-montar.ts`, fixtures e unit rodaram num espelho descartável (scratchpad, `node_modules` por symlink): **80/80 verdes**, `tsc --strict` limpo. A suíte de integração compilou (tsc) e carregou apontando para um banco inexistente: **24 skipped, zero conexão** (a guarda não conecta fora da cópia).
- **Front:** as edições das Tasks 7 e 9 (todas as âncoras 1×) + os 2 arquivos novos aplicados num espelho do HEAD `a044759`: **tsc limpo**; unit do repo **836 passed / 2 failed** — as 2 falhas são as HERDADAS do anti-drift de UI (`DocPrintCasca`/`OcDocumentoPrint`), nenhuma dos arquivos da F3.5a. Spec de QA: tsc limpo.
- **Merge com a F2:** `git merge-file` (base `a044759` × F3.5a × `f2/kanban-telas`) em `configuracoes.tsx`: **0 conflito**.
- **SQL (não executado):** a montagem A → C → B foi feita por script exatamente como as Tasks 3–5 mandam (18 funções, 5 gatilhos, 1 `BEGIN;`/1 `COMMIT;`); o `semTransacao` do harness da F3.1 **aceita** a migration e o inverso; as consultas do `aplica.sh` (`OBJ_F35A`, `FN_PRE`, `CONT`) rodaram SÓ-LEITURA na cópia (`0|0|0|0`, `…|458`, `458|263`) e a `ACL_F35A` passou no `EXPLAIN`; a extração do `aplica_v2` do runbook da F1 foi conferida por hash; os 4 scripts `bash -n` ok.
- **Cobertura do pedido:** §4.1 inteira (incl. `tamanho_tipo` do modelo e do produto antes do espelho, `modelo_skus`), §4.2 (wrapper + `_core`, `salvar_sku_manual`, `montarSku`/`parseTamanho` com anti-drift × SQL), §4.3 F3.5a (Atributos e Config), §4.4; UNIQUE compostas, RLS + modgate, REVOKE dos três com `has_function_privilege`; inverso com aviso de perda; testes: sem REF, falta sigla, manual preservado com `_regerar=true`, regerar só automáticos, conflito PT, interno × revenda × importado, soltos, ACL; backup antes de aplicar na cópia; QA `:5180` com guarda invertida; snapshot antes do merge; G-migration; produção pelo dono com `pg_dump` e depois da F1/Aviso/Nota.

## 10. Esboço — F3.5b (depois da F3.4; meia página)

**Objetivo:** mostrar e operar os SKUs no card e escolher "Tamanho em". **Sem migration** (tudo o que precisa já vem da F3.5a).

- **Consome da F3.5a:** `skus_modelo` (matriz: `status`, `tamanho_tipo`, `tamanho_tipo_card`, `linhas[].estado/sku/sku_previsto/faltas/conflito_com/id/rev/manual`, `faltas`), `gerar_skus_modelo(_id, _regerar)`, `salvar_sku_manual(_id, _sku, _rev_base)`, `textoFalta`, `ladoTamanho`/`parseTamanho`, `SKU_PARTE_LABEL`, `TAMANHO_UNICO`, as colunas `modelos.tamanho_tipo` e `produtos_*.tamanho_tipo` (com o handover por gatilho) e `tenant_config.sku_config.tamanho_padrao`.
- **Seção "REF e SKUs" no `PlanejamentoDetail`** (arquivos da F3.4 ⇒ nasce da ponta da F3.4): REF, "Tamanho em" (segmentado Letra | Número; NULL = "Padrão da loja (…)"), tabela Variante × Tamanho com o SKU editável (linha `manual` marcada; P0409 pelo `mensagemErro`), linhas "Falta sigla: …" com link para Cadastro › Atributos, linhas `conflito`/`divergente`/`orfa` explicadas, botão "Regerar SKUs" com AlertDialog ("SKUs editados à mão não mudam"); selo: completo (tudo `ok|manual`) / falta sigla / aguardando REF / sem formato. queryKey `["plan-skus", modeloId]` (sem "tenant"), invalidada depois de Salvar/Regerar/editar.
- **1ª geração automática:** no fim do Salvar do Planejamento (`usePlanejamentoSave`), se o card tem REF, o formato existe e a matriz não tem nenhuma linha gravada ⇒ `gerar_skus_modelo(_id, false)` best-effort (nunca derruba o Salvar; toast de faltas/conflitos). Não roda a cada Salvar (Q2).
- **"Tamanho em" nos cards:** Plan. Tecido (os cards são `modelos` — `update` com `rev`), Produto Acabado e Importado (com espelho: o do MODELO; sem espelho: o do produto — o gatilho passa ao modelo quando o card nasce); a grade exibida em todos segue `ladoTamanho(chave, tipo)`; a chave interna continua "34|PPP".
- **A decidir na F3.5b:** Realtime de `modelo_skus` (hoje fora da publication), "voltar ao automático", auditoria.
