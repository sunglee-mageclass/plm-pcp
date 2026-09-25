# Data da Nota de Entrada nas 5 OCs — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o campo "Data da Nota de Entrada" nas OCs de Tecido, Aviamento, Insumo, Produto Acabado e Produto Importado; nas quatro primeiras o prazo de pagamento passa a contar dela (as não pagas são recalculadas quando ela muda; as pagas nunca), e a OC recebida sem a data acende aviso na OC, bolinha amarela na lista e destaque amarelo nas parcelas do Financeiro — com a migration testada só na cópia e aplicada em produção pelo dono, com backup completo antes.

**Architecture:** O vencimento continua decidido no banco: UMA migration (`20261002100000`) acrescenta `data_nota_entrada` nas 5 tabelas, troca a base do vencimento por `COALESCE(data_nota_entrada, base de hoje)` nos geradores/recálculos de 4 famílias (Importado intocado), ensina os 5 cores de save a gravar a chave (ausente = mantém) e põe um gatilho que recalcula as não pagas quando a data muda numa OC já recebida. A migration e o inverso são GERADOS a partir do texto vivo das funções (cópia = produção) + um diff mínimo fixo, com guarda de md5. No front, uma regra pura única (`src/lib/nota-entrada.ts`) decide alerta/provisória e quatro peças compartilhadas (`src/components/shared/NotaEntrada.tsx`) entram nas 5 OCs e no Financeiro.

**Tech Stack:** PostgreSQL 17.6 (Supabase próprio; cópia local Docker `supabase_db_banco-local` em `127.0.0.1:54422`), plpgsql, Vite + React 19 + TypeScript strict + TanStack Query v5 + supabase-js, Vitest (unit `node` + integração em `BEGIN…ROLLBACK` SÓ na cópia), Playwright (QA na cópia; spec não versionado), Python 3 (gerador da migration).

**Spec:** `docs/superpowers/specs/2026-09-24-data-nota-entrada-design.md` (fatos com `arquivo:linha`, desenho de dados e telas, riscos, §10 Decisões para o dono). **Revisão de 24/set:** G-plano do guardião APROVA COM RESSALVAS R1–R8 (diário `.superpowers/sdd/2026-09-22-unificacao-kanban-auto/guardiao.md`, entrada "G-plano Data da Nota de Entrada") — onde cada uma entrou: §6. Autoridade do desenho: `/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-24-nota-entrada/desenho-aprovado.md` (texto aprovado pelo dono em 24/set/2026, verbatim na spec §2). Referências de formato: `docs/superpowers/plans/2026-09-22-kanban-automatico-f1-banco.md` (migration/inverso/ensaio/runbook) e `docs/superpowers/plans/2026-09-24-planejamento-unificado-f34-comprado.md` (Global Constraints, Task 0, QA na cópia).

## Global Constraints

**Repositório e worktree**
- Worktree: `/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada`, branch `nota-entrada/data-nota`, criada na Task 0 a partir do HEAD de `feature/plan-tecido-a1` (sha gravado em `.superpowers/nota/BASE`). Caminhos relativos = raiz da worktree. `.superpowers/` é gitignored (scripts, logs e evidências ficam lá, não versionados).
- Commits: `git add -- <paths>` + `git commit --only -m "<msg>" -- <paths>` (nunca `git add .`/`-A`); mensagem termina com a linha `Co-Authored-By:` do SEU modelo real (ex.: `Co-Authored-By: Claude Sonnet … <noreply@anthropic.com>`). Sem push.
- ⛔ PROIBIDO `git stash` (pilha compartilhada entre worktrees), `pkill`/`killall` por nome, imprimir senha/URL com senha, editar `src/integrations/supabase/types.ts` (tabelas/colunas novas via `as any`, como o resto do repo).
- `src/routeTree.gen.ts` é gerado pelo build: nunca entra em commit (`git checkout -- src/routeTree.gen.ts`).
- Só os arquivos de `.superpowers/nota/permitidos.txt` (Task 0) mudam nesta frente — o gate confere.

**Banco**
- ⛔ Produção NÃO recebe NADA — nem teste — até a Task 13. DDL/migration, inclusive dentro de `BEGIN…ROLLBACK`, SÓ na CÓPIA LOCAL `postgresql://postgres:postgres@127.0.0.1:54422/postgres` (incidente 23/set: AccessExclusive em transação de teste travou todas as lojas). Leitura na cópia com `PGOPTIONS='-c default_transaction_read_only=on'` ou `BEGIN READ ONLY`.
- ⛔ NUNCA `\i` de migration dentro de transação de teste (o `COMMIT;` do arquivo vaza a transação — incidente 15/set). O harness tira as linhas `BEGIN;`/`COMMIT;` e recusa qualquer outro controle de transação. PROIBIDO "probe" exploratório fora do harness.
- Uma migration: `supabase/migrations/20261002100000_oc_data_nota_entrada.sql` (> `20261001100000` do Aviso Global > `20260930180000` da F3.1). Inverso: `supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql`. Os dois são GERADOS (`gerar_sql.py`, Task 3) — nunca editados à mão. `BEGIN;`/`COMMIT;` (1 de cada, em linha própria), idempotente, **com `SET LOCAL lock_timeout = '500ms';` e `SET LOCAL transaction_timeout = '3s';` logo depois do `BEGIN;`, DENTRO do arquivo** (R9 — `psql -f` é o caminho padrão do CLAUDE.md; o harness exige as 2 linhas e as tira da txn do teste).
- **Travas (R3):** fora do harness de teste, a migration e o inverso SÓ vão a um banco pelo `aplica_v2` (`.superpowers/nota/mig/aplica.sh`, cópia literal do bloco de apoio v2 do runbook da F1, igual ao Aviso e à F3.1): o arquivo inteiro numa mensagem, `SET LOCAL lock_timeout = '500ms'` + `SET LOCAL transaction_timeout = '3s'` injetados depois do `BEGIN;`, nova tentativa só em 55P03/40P01/25P04 (ATIV antes), qualquer outro erro PARA. Nada de `psql -1 -f`. O `aplica_v2` reinjeta as mesmas 2 travas que o arquivo já traz (R9): repetido, inofensivo. Três usos: ensaio (Task 4), cópia do QA (Task 12) e a ida junto com o merge (Task 13 Step 8) e produção (Task 13, pelo DONO).
- **Policy / supautils (R9 — lição do Aviso, provada na cópia):** no Supabase, `CREATE`/`DROP POLICY` como `postgres` dispara o hook `supautils.policy_grants`, que pega AccessExclusive em 24 tabelas de auth/storage/realtime (`auth.users`, `auth.sessions`, `storage.objects`… — `show supautils.policy_grants` na cópia, 24/set) até o COMMIT. A migration e o inverso da Nota NÃO têm DDL de policy (nenhum `CREATE`/`DROP`/`ALTER POLICY`; coluna nova não obriga a recriar policy) — o harness (`RE_DDL_POLICY`) e o pré-voo (`confere_arquivos_nota`) recusam se entrar uma; se um dia for preciso: no FIM do arquivo e a spec §7 deixa de dizer que não trava auth/storage. O que trava: `ALTER TABLE … ADD COLUMN` = AccessExclusive nas 5 OCs até o COMMIT, e as 5 policies de outras tabelas que leem as OCs (`enderecamento_tecido` endtec_ins/endtec_upd, `ocs_tecido_itens`, `ocs_aviamento_itens`, `ocs_etiqueta_itens`) esperam junto. Aplicação em horário calmo.
- **Tempo do inverso (R9-a — guardião):** o inverso tem um laço que recalcula as não pagas de CADA OC datada (passo 3 do arquivo) e o tempo dele cresce com o nº de OCs datadas em produção. Por isso: (1) o inverso sai com `transaction_timeout` MAIOR — `gerar_sql.py --tt-inverso N` (padrão e mínimo 30 s; a Task 4 mede e pode subir: ⌈5 × tempo medido⌉); a ida fica em 3 s; o `lock_timeout` fica em 500 ms nos dois, porque é ele que protege os outros usuários (o arquivo nunca fica na fila de uma trava segurando quem chega depois); (2) o laço roda ANTES das travas exclusivas (funções → laço → gatilhos → colunas): durante ele só há trava de LINHA; o AccessExclusive nas 5 OCs é só o fim, curto; (3) o inverso vai pelo `aplica_v2_inverso` (`aplica.sh`), que injeta o `transaction_timeout` DO ARQUIVO antes dele — o 1º `SET LOCAL` arma o relógio e um maior depois NÃO o estende (provado na cópia pelo guardião), então o `com_travas` literal (3 s) não serve ao inverso; o `aplica_v2` e o `com_travas` literais seguem intactos; (4) o ensaio (Task 4) MEDE o laço com volume real numa transação DESFEITA (R9-b: migration → datar as OCs recebidas → inverso cronometrado → ROLLBACK; nenhum dado da cópia muda, conferido por retrato só-leitura antes × depois) e grava `.superpowers/nota/mig/volta-medida.txt`; o passo 4b do inverso REPASSA, já com o AccessExclusive, as OCs que ganharam data durante o laço (R9-b); (5) o `volta-producao.sh` mostra, ANTES da confirmação digitada, quantas OCs estão datadas em produção e PARA se o tempo do arquivo não cobrir o laço com folga de 5×. Timeout maior é aceitável no inverso porque ele é EMERGÊNCIA, decidida pelo dono, em horário calmo. A ida não tem DML fora de corpo de função (o gerador recusa), então o tempo dela não cresce com os dados; ela é medida duas vezes na mesma txn desfeita, sem e com as OCs datadas.
- **Guarda de md5 (R2):** a migration e o inverso aceitam SÓ o md5 EXATO de 24/set (antes) ou o desta migration (depois) de cada uma das 10 funções (e das 2 novas); qualquer outro texto — inclusive um que ainda contenha `data_nota_entrada` — é recusado. Teste de recusa na Task 2.
- **D6/D7 (PENDENTES DO DONO):** o plano implementa a recomendação — D6: OC recebida sem parcela a pagar acende, com o aviso curto "Falta a Data da Nota de Entrada" (sem "provisórios"); D7: a data não pode ser futura (> hoje no fuso da loja) nem anterior à data do pedido, com erro em PT, validada no SERVIDOR (gatilho `trg_nota_entrada_valida` nas 5 OCs) E no front. Resposta diferente = variante da §5.
- Contagens: a migration acrescenta **2 funções** (`fn_oc_nota_entrada_recalc`, `fn_oc_nota_entrada_valida`) e **8 gatilhos** (3 de recálculo + 5 de validação; o do Acabado é recriado). Cópia hoje 458|263 → com a Nota **460|271**. Sem a D7 seriam +1|+3 (459|266).
- Invariante #9: `fn_oc_nota_entrada_recalc`, `fn_oc_nota_entrada_valida`, `_recalcular_parcelas_core`, `recalcular_parcelas_etiqueta` e os 4 `_salvar_oc_*_core` com EXECUTE revogado de `PUBLIC, anon, authenticated`, conferido com `has_function_privilege`. As outras funções redefinidas mantêm o ACL de hoje.
- Importado: vencimento = etapas de câmbio, intocado (`_gerar_parcelas_importado` e gatilhos não são redefinidos).
- A cópia é COMPARTILHADA entre frentes: um QA por vez; toda escrita na cópia (ida/volta da migration, E1 do QA) passa por `copia.sh`/backup `pg_dump -Fc` e é registrada em `.superpowers/nota/copia-estado.md`.
- **A cópia é também o app de teste do dono (`:5188`) — R4/N3:** toda rodada com DDL nas OCs da cópia (suíte com `NOTA_MIG_TXN=1`, `copia.sh ida|volta`, ensaio) CONGELA o `:5188` nas OCs, Estoque, Plan. Tecido e Financeiro enquanto roda. Antes de cada uma: `NOTA_DONO_AVISADO=sim bash .superpowers/nota/prevoo-copia.sh <passo>` (nenhum vitest/playwright, nenhuma sessão ativa na cópia) — e `NOTA_DONO_AVISADO=sim` SÓ depois que o dono respondeu no chat que o `:5188` está ocioso (texto no script). Todo teste de integração roda com `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres` explícito (sem ele o fallback `/tmp/dburl.txt` é PRODUÇÃO).

**Front**
- Data = `<DateField>` (nunca `<input type="date">`); erro = `toast.error(mensagemErro(e, "…"))`; cor só por token (`--tone-warning-*`, `bg-warning`) — sem hex/hsl solto (anti-drift ativo em `tests/unit/ui-padroes-antidrift.test.ts`).
- Textos EXATOS (aprovados): "Data da Nota de Entrada" · "Falta a Data da Nota de Entrada — os vencimentos estão provisórios" · "vencimento provisório — falta a data da nota". D6 (pendente): sem parcela a pagar, o aviso é "Falta a Data da Nota de Entrada". D7 (pendente): "A Data da Nota de Entrada (dd/mm/aaaa) não pode ser no futuro." · "… não pode ser anterior à data do pedido (dd/mm/aaaa)." — iguais no front e no banco.
- Regra única de alerta/provisória em `src/lib/nota-entrada.ts` — nenhuma tela reimplementa.
- Toda OC salva/recebida invalida `["parcelas"]`, `["dash-financeiro"]`, `["oc-view"]`, `["nota-parcelas-a-pagar"]` via `invalidarVencimentos(qc)`.
- Fora de escopo (spec §9): nada em `src/lib/erro-mensagem.ts`, `src/lib/realtime-invalidation-map.ts`, telas do Planejamento/Desenvolvimento/Kanban, `parcelas_servico`.

**Gates (todo commit de código):** `bash .superpowers/nota/gates.sh` → `GATES NOTA: ok` (tsc, build, unit sem falha nova, lista permitida, sem `type="date"`, sem toast cru). `tests/integration/*` só com `DATABASE_URL` da cópia.

**QA:** variante do app de teste na porta **5181** — JÁ reservada pelo controlador na linha `case "$PORTA"` do `criar-variante.sh` (backup `.bak-pre-reserva-portas`); o plano NÃO edita essa linha, só confere com `grep` e PARA se faltar (ruling R5 do guardião: várias frentes editando a mesma linha = corrida); guarda de rede INVERTIDA (qualquer `*.supabase.co` reprova); NUNCA tocar `:5173` (dono/produção), `:5188` (app de teste do dono), `:5180`, `:5182`–`:5187` (outras variantes), `:5198`/`:5199`; nunca junto com outro QA.

**Modelos e revisão:** implementadores Sonnet; revisores Opus (§3). Tasks de banco e dinheiro (2+3, 4, 10) com revisão INDIVIDUAL Opus. Portão G-migration pelo guardião (Task 13). Avisos ao dono por CHAT (sem `ExitPlanMode`). Não despachar subagente dentro de uma task.

**Ordem de produção:** depois da F1 e do Aviso Global (o pré-voo confere os dois no banco: `kanban_automatico` e `to_regclass('public.avisos_globais')`). **Migration em produção SÓ pelo dono, no Terminal, pelo `ida-producao.sh` (`pg_dump` completo antes — o plano Supabase NÃO tem PITR — e `aplica_v2`).** O merge do front na `feature/plan-tecido-a1` só DEPOIS da migration aplicada em produção (o `:5173` do dono lê produção assim que o código chega à branch; o front novo pede a coluna nova) e JUNTO com a ida da migration na cópia (R8). Depois da Nota, a volta de emergência da F1 usa a referência nova gravada pelo `ref-volta-f1.sh` (R1). O deploy só roda encadeado ao portão `portao_deploy_nota` (R7).

---

## 1. Fatos que o código abaixo assume (detalhes e `arquivo:linha` na spec §3)

- Base de hoje: Tecido/Aviamento/Insumo = `data_entrega` (o front grava a ÚLTIMA data das entregas ao receber), senão `CURRENT_DATE`; P. Acabado = `data_pedido` (parcelas nascem no PEDIDO e o gatilho regenera as não pagas a cada save); Importado = etapas.
- Todo save de OC recebida (Tecido/Aviamento/Insumo) já chama o recálculo no fim; o do P. Acabado regenera pelo gatilho a cada save. O recálculo preserva as pagas (`status='pago' OR data_pagamento IS NOT NULL`), redistribui `total − Σ pagas` nos números livres (o último absorve o resto) — Σ = total; as não pagas ganham id novo.
- md5 de 24/set das 10 funções (guarda da migration): spec §3.1 (o guardião conferiu 10/10 contra o snapshot de PRODUÇÃO de 22/set). Cópia hoje: 458 funções | 263 gatilhos (F1 + coluna da F3.1). A migration acrescenta 2 funções e 8 gatilhos: 460 | 271.
- `tenant_config.timezone` (text, default `'America/Sao_Paulo'`; as 6 lojas nesse fuso) — base do "hoje" da D7 no banco; no front, `todayISOInStoreTZ(useStoreTimezone())`.
- Chamadores do recálculo que herdam a base nova sem mudança (conferido pelo guardião): `recalc_parcelas_on_valor`, `recalc_parcelas_*_on_item`, `gerar_parcelas_oc_etiqueta`, `recalcular_parcelas` (botão), `_aplicar_resolucao_alerta_tecido_core`, `_receber_reposicao_troca_core`; os overloads de 3 args de `_salvar_oc_aviamento_core` e `salvar_oc_etiqueta` não gravam a coluna (mantêm).
- Loja Teste (`37889b78-fffb-404b-8c75-18b7e50a1d9b`, usuário `f1378ea4-…` super_admin): Tecido 7 recebidas, Aviamento 1, Insumo 1, P. Acabado 0 (2 encomendadas), Importado 1 encomendada com 3 etapas/3 parcelas; aviamento com preço e empresa; insumo com variante.
- `_salvar_oc_aviamento_core` tem 2 overloads (3 e 4 args): os testes chamam o de 4 args explicitamente; só o de 4 é redefinido (o de 3 não grava a coluna → mantém).
- `nº de pedido` sem dígitos finais faz o core entrar em laço se repetido — os testes usam `NOTA-TEC-90001` etc.

## 2. Mapa de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `src/lib/nota-entrada.ts` (novo) | Regra pura: famílias que alertam, `faltaNotaEntrada`, `parcelaProvisoria`, `baseVencimento`, `payloadDataNota`, textos, `invalidarVencimentos` | 1 |
| `tests/unit/nota-entrada.test.ts` (novo) | Unit da regra | 1 |
| `tests/integration/nota-entrada.test.ts` (novo) | Harness (migration na txn, só cópia) + 15 testes de banco/dinheiro (inclui D7, a recusa R2 e a medição do laço do inverso numa txn desfeita — R9-b) | 2 |
| `supabase/migrations/20261002100000_oc_data_nota_entrada.sql` (gerado) | Coluna ×5, 10 funções, 2 funções novas + 8 gatilhos (recálculo e validação D7), ACL, guarda md5 exata e pós-condição | 3 |
| `supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql` (gerado) | Inverso destrutivo com confirmação | 3 |
| `src/components/shared/NotaEntrada.tsx` (novo) | `CampoDataNotaEntrada`, `AvisoFaltaNota` (conta as parcelas a pagar — D6), `BolinhaFaltaNota`, `TagParcelaProvisoria`, `useValidarDataNota` (D7) | 5 |
| `src/components/oc-tecido/{shared.ts,OcTecidoForm.tsx,OcTecidoList.tsx}`, `src/routes/_authenticated/entrada-saida.oc-tecido.tsx` | OC Tecido | 6 |
| `src/routes/_authenticated/entrada-saida.oc-aviamento.tsx` | OC Aviamento | 7 |
| `src/routes/_authenticated/entrada-saida.oc-insumo.tsx` | OC Insumo | 8 |
| `src/components/oc-p-acabado/{shared.ts,OcPaForm.tsx}`, `…/entrada-saida.oc-p-acabado.tsx`, `src/components/oc-p-importado/{shared.ts,OcImpForm.tsx}`, `…/entrada-saida.oc-p-importado.tsx` | OC P. Acabado e P. Importado | 9 |
| `src/routes/_authenticated/financeiro.tsx` | Parcela provisória no Financeiro | 10 |
| `.superpowers/nota/**` (não versionado) | regras, gates, lista permitida, `prevoo-copia.sh` (R4), `copia.sh`, `mig/{dump_antes.sh,gerar_sql.py,aplica.sh,ida-producao.sh,volta-producao.sh,ref-volta-f1.sh}`, md5 antes/depois, logs, QA | 0, 3, 4, 12, 13 |
| `tests/e2e/nota-qa.spec.ts` (NÃO versionar) | QA na cópia | 12 |

## 3. Revisão (política SDD)

| Task | Revisão |
|---|---|
| 1 + 5 | **Lote A** — 1 revisão Opus (regra pura + peças de tela; textos verbatim; tokens; anti-drift) |
| 2 + 3 | **Individual Opus, JUNTAS** (BANCO/DINHEIRO: harness só-cópia, sem `\i`, guarda md5, diff mínimo = §Task 3, Σ = total, paga intacta, Importado idêntico, ACL, inverso destrutivo com confirmação) |
| 4 | **Individual Opus** sobre a saída do ensaio (contagens, md5 antes/depois, suíte nos 2 modos, cópia devolvida limpa) |
| 6, 7, 8, 9 | **Lote B** — 1 revisão Opus (payload com a chave SEMPRE, merge colaborativo/rótulo, dirty snapshot na mesma ordem, aviso/bolinha pela regra única, campo editável com a OC recebida, invalidações) |
| 10 | **Individual Opus** (DINHEIRO exibido: provisória só não paga, amarelo sem colidir com "vence em ≤ 3 dias", selects, queryKey única `["parcelas"]`) |
| 11, 12, 13 | controlador + guardião (snapshot, QA, G-migration, G-commit, produção pelo dono) |

Checklist de toda revisão: `code-reviewer` + invariantes #1/#9/#13, "paga nunca muda", "Σ = total", "Importado intocado", "chave ausente mantém", `<DateField>`, `mensagemErro`, textos verbatim, só arquivos permitidos.

---

## Task 0: Pré-voo (sem commit)

**Files:** nenhum no git. Cria a worktree e `.superpowers/nota/` (não versionado).

- [ ] **Step 1: Criar a worktree a partir do HEAD de `feature/plan-tecido-a1`**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
BASE="$(git rev-parse feature/plan-tecido-a1)"
git worktree list | grep -F ".claude/worktrees/nota-entrada" && { echo "worktree já existe — PARE e avise o controlador"; exit 1; }
git worktree add ".claude/worktrees/nota-entrada" -b nota-entrada/data-nota "$BASE"
cd ".claude/worktrees/nota-entrada"
mkdir -p .superpowers/nota/mig .superpowers/nota/qa
echo "$BASE" > .superpowers/nota/BASE
cp "/Users/sunglee/PLM + Criação/plm-pcp/.env" .env
npm ci --silent
git log --oneline -1
```

Expected: worktree criada na branch `nota-entrada/data-nota`; `.superpowers/nota/BASE` = sha do HEAD de `feature/plan-tecido-a1`; `npm ci` sem erro.

- [ ] **Step 2: Gravar as regras da frente — `.superpowers/nota/regras-nota.md`**

```markdown
# Regras da frente "Data da Nota de Entrada" (vale para TODO subagente — leia antes de qualquer comando)

1. PRODUÇÃO: nada. Nem SELECT de teste, nem migration, nem `psql "$(cat /tmp/dburl.txt)"`. Só a Task 11 (snapshot só-leitura)
   e a Task 13 (dono) tocam produção.
2. Banco = CÓPIA LOCAL `postgresql://postgres:postgres@127.0.0.1:54422/postgres`. DDL/migration SÓ pelo harness de
   `tests/integration/nota-entrada.test.ts` (dentro da txn revertida) ou por `bash .superpowers/nota/copia.sh ida|volta`
   (controlador). PROIBIDO probe exploratório (`psql -f`, `\i`, BEGIN manual com DDL) fora disso.
3. NUNCA `\i` de migration dentro de transação. Se um ROLLBACK responder "there is no transaction in progress": PARE e avise.
4. Um QA por vez na cópia. Antes de escrever nela: nenhum vitest/playwright rodando e nenhuma sessão ativa (o `copia.sh` confere).
5. Não subir, derrubar nem "consertar" a cópia; não matar processo por nome; nunca tocar :5173, :5188, :5180, :5182–:5187,
   :5198, :5199.
6. Git: `git add -- <paths>` + `git commit --only -- <paths>`; nunca `git add .`/`-A`; nunca `git stash`; só arquivos de
   `.superpowers/nota/permitidos.txt`.
7. Migration e inverso são GERADOS por `.superpowers/nota/mig/gerar_sql.py` — nunca editar os .sql à mão.
8. Data na tela = `<DateField>`; erro = `mensagemErro`; textos aprovados verbatim; cor só por token.
9. Gate antes de todo commit: `bash .superpowers/nota/gates.sh` → `GATES NOTA: ok`.
10. Dúvida de regra de negócio = PARE e pergunte ao controlador (ele leva ao dono por chat).
11. R4: antes de QUALQUER rodada com DDL na cópia (vitest com `NOTA_MIG_TXN=1`, `copia.sh`), `NOTA_DONO_AVISADO=sim bash
    .superpowers/nota/prevoo-copia.sh <passo>` — e só com o OK do dono no chat (o `:5188` dele congela enquanto roda).
12. R3: SQL fora do harness SÓ pelo `aplica_v2` (`.superpowers/nota/mig/aplica.sh`); nunca `psql -1 -f`. R9: as 2 travas
    ficam TAMBÉM no arquivo, logo depois do `BEGIN;`; NENHUMA DDL de policy (hook `supautils.policy_grants`). R9-a: o
    INVERSO só pelo `aplica_v2_inverso` (transaction_timeout do arquivo, ≥ 30 s); a ida fica em 3 s.
13. Todo vitest de integração com `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres` EXPLÍCITO.
```

- [ ] **Step 3: Lista permitida, scripts de gate e linha de base**

Criar `.superpowers/nota/permitidos.txt`:

```text
supabase/migrations/20261002100000_oc_data_nota_entrada.sql
supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql
src/lib/nota-entrada.ts
src/components/shared/NotaEntrada.tsx
src/components/oc-tecido/shared.ts
src/components/oc-tecido/OcTecidoForm.tsx
src/components/oc-tecido/OcTecidoList.tsx
src/components/oc-p-acabado/shared.ts
src/components/oc-p-acabado/OcPaForm.tsx
src/components/oc-p-importado/shared.ts
src/components/oc-p-importado/OcImpForm.tsx
src/routes/_authenticated/entrada-saida.oc-tecido.tsx
src/routes/_authenticated/entrada-saida.oc-aviamento.tsx
src/routes/_authenticated/entrada-saida.oc-insumo.tsx
src/routes/_authenticated/entrada-saida.oc-p-acabado.tsx
src/routes/_authenticated/entrada-saida.oc-p-importado.tsx
src/routes/_authenticated/financeiro.tsx
tests/unit/nota-entrada.test.ts
tests/integration/nota-entrada.test.ts
tests/e2e/nota-qa.spec.ts
```

Criar `.superpowers/nota/gates.sh`:

```bash
#!/usr/bin/env bash
# Gates de TODO commit de código da frente "Data da Nota de Entrada" (sem banco).
# Uso (raiz da worktree): bash .superpowers/nota/gates.sh  →  "GATES NOTA: ok" e código 0. Falhou = PARE, não commitar.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
N=.superpowers/nota
falha() { echo "GATE FALHOU: $1"; exit 1; }
npx tsc --noEmit > "$N/tsc.log" 2>&1 || { tail -20 "$N/tsc.log"; falha "tsc (o build NÃO faz type-check)"; }
npm run build > "$N/build.log" 2>&1 || { tail -20 "$N/build.log"; falha "build"; }
git checkout -- src/routeTree.gen.ts 2>/dev/null || true
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit > "$N/unit.log" 2>&1
grep -qE "Test Files .*passed" "$N/unit.log" || { tail -20 "$N/unit.log"; falha "unit (sem resumo)"; }
grep -E "^ FAIL " "$N/unit.log" | sed -E 's/ +[0-9]+ms$//' | sort -u > "$N/unit-fail-agora.txt"
diff -q "$N/unit-fail-base.txt" "$N/unit-fail-agora.txt" > /dev/null \
  || { diff "$N/unit-fail-base.txt" "$N/unit-fail-agora.txt"; falha "unit (falhas ≠ linha de base — inclui o anti-drift de UI)"; }
FORA="$( { git diff --name-only "$(cat "$N/BASE")" HEAD; git diff --name-only; git diff --name-only --cached; \
           git ls-files --others --exclude-standard; } | sort -u | grep -vxF -f "$N/permitidos.txt" || true)"
[ -z "$FORA" ] || { echo "$FORA"; falha "arquivo fora da lista permitida ($N/permitidos.txt)"; }
for f in $(grep '^src/' "$N/permitidos.txt"); do
  [ -f "$f" ] || continue
  if grep -n 'type="date"' "$f"; then falha "<input type=\"date\"> em $f — use <DateField>"; fi
  if grep -nE 'toast\.error\((e|err|error)\.message' "$f"; then falha "toast de erro sem mensagemErro em $f"; fi
done
echo "GATES NOTA: ok"
```

Criar `.superpowers/nota/prevoo-copia.sh` (R4 — usado antes de toda rodada com DDL na cópia):

```bash
#!/usr/bin/env bash
# R4 do G-plano — pré-voo de TODO uso da CÓPIA LOCAL que faz DDL nas OCs (suíte com NOTA_MIG_TXN=1, copia.sh ida|volta,
# ensaio da Task 4). A DDL em transação CONGELA o app de teste do dono (:5188, mesmo Postgres :54422) nas OCs, Estoque,
# Plan. Tecido e Financeiro enquanto roda. SÓ LEITURA. Uso (raiz da worktree):
#   NOTA_DONO_AVISADO=sim bash .superpowers/nota/prevoo-copia.sh <passo>      ex.: t2s2, t3s4, t4, t12-ida
# NOTA_DONO_AVISADO=sim SÓ depois que o dono respondeu no chat que o :5188 está ocioso (texto abaixo).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
PASSO="${1:?informe o passo, ex.: t2s2}"
mkdir -p .superpowers/nota/logs
docker ps --filter name=supabase_db_banco-local --format '{{.Status}}' | grep -q healthy \
  || { echo "PARE: cópia fora do ar (não subir/recriar por conta própria)"; exit 1; }
if ps -Ao command | grep -E "[v]itest|[p]laywright" > /dev/null; then
  ps -Ao pid,command | grep -E "[v]itest|[p]laywright"; echo "PARE: vitest/playwright rodando (um QA/teste por vez na cópia)"; exit 1
fi
N=$(PGCONNECT_TIMEOUT=5 psql "$LOCAL" -X -A -t -v ON_ERROR_STOP=1 -c "select count(*) from pg_stat_activity where datname = current_database() and backend_type = 'client backend' and pid <> pg_backend_pid() and state <> 'idle'") \
  || { echo "PARE: não conectei na cópia"; exit 1; }
[ "$N" = 0 ] || { echo "PARE: $N sessão(ões) ativa(s) na cópia — outra frente usando; esperar"; exit 1; }
if [ "${NOTA_DONO_AVISADO:-}" != sim ]; then
  cat <<'MSG'
PARE: avise o dono no chat ANTES e espere o OK (depois rode de novo com NOTA_DONO_AVISADO=sim):
  "Vou rodar <passo> da Data da Nota de Entrada na cópia local agora (~<N> min). Enquanto roda, o app de teste :5188
   congela nas OCs, Estoque, Plan. Tecido e Financeiro — a migration faz ALTER nas tabelas de OC dentro de transação.
   Se estiver usando o :5188, salve e me avise quando posso começar."
MSG
  exit 1
fi
E=$(psql "$LOCAL" -X -A -t -F'|' -c "select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'), (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal), (select count(*) from information_schema.columns where table_schema='public' and column_name='data_nota_entrada')")
P=$(lsof -nP -iTCP:5188 -sTCP:LISTEN -t 2>/dev/null | head -1)
echo "$(date '+%F %T') $PASSO: funções|gatilhos|colunas da Nota = $E · :5188 $([ -n "$P" ] && echo "no ar (PID $P)" || echo "fora do ar") · dono avisado" \
  | tee -a .superpowers/nota/logs/prevoo-copia.log
echo "OK (pré-voo da cópia): pode rodar $PASSO"
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada"
chmod +x .superpowers/nota/gates.sh .superpowers/nota/prevoo-copia.sh
bash .superpowers/nota/prevoo-copia.sh t0; echo "sem-aviso=$?"     # sem NOTA_DONO_AVISADO: mostra o texto p/ o dono e sai 1
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit > .superpowers/nota/unit-base.log 2>&1; tail -6 .superpowers/nota/unit-base.log
grep -E "^ FAIL " .superpowers/nota/unit-base.log | sed -E 's/ +[0-9]+ms$//' | sort -u > .superpowers/nota/unit-fail-base.txt; cat .superpowers/nota/unit-fail-base.txt
bash .superpowers/nota/gates.sh; echo "código=$?"
```

Expected: o `prevoo-copia.sh` sem a variável imprime o texto para o dono e `sem-aviso=1` (a trava funciona); `unit-fail-base.txt` com as falhas HERDADAS (hoje 2, do anti-drift: `DocPrintCasca.tsx`/`OcDocumentoPrint.tsx` — anotar); `GATES NOTA: ok` e `código=0` (nada mudou ainda). Código 1 aqui = a base está quebrada: PARE e reporte.

- [ ] **Step 4: Sobreposição com as frentes abertas (regra de rebase)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada"
B=feature/plan-tecido-a1
P=.superpowers/nota/permitidos.txt
RAMOS="f2/kanban-telas f31/planejamento-campos f32/ficha-bom f33/cad-acoes f34/comprado $(git branch --format='%(refname:short)' | grep -i aviso || true)"
for br in $RAMOS; do
  git rev-parse --verify -q "$br" > /dev/null || { echo "(sem branch $br)"; continue; }
  git diff --name-only "$B...$br" | grep -xF -f "$P" | sed "s|^|SOBREPOE $br: |"
  git diff --name-only "$B...$br" -- supabase/migrations | while read -r f; do
    git show "$br:$f" | grep -qE "_recalcular_parcelas_core|gerar_parcelas_oc_|recalcular_parcelas_etiqueta|_salvar_oc_(tecido|aviamento|p_acabado|importado)_core|salvar_oc_etiqueta|ocs_(tecido|aviamento|etiqueta|p_acabado|importado)[^_a-z]" \
      && echo "SOBREPOE-BANCO $br: $f"
  done
done
PA=docs/superpowers/plans/2026-09-24-aviso-global.md
if git cat-file -e "$B:$PA" 2>/dev/null; then
  git show "$B:$PA" | grep -oE '`(src|supabase|tests)/[^` ]+`' | tr -d '`' | sort -u | grep -xF -f "$P" | sed 's|^|SOBREPOE aviso-global (plano): |'
else
  echo "plano do Aviso Global ainda não commitado em $B — reconferir na Task 13 Step 1"
fi
git diff --name-only "$B" -- src/lib/erro-mensagem.ts src/lib/realtime-invalidation-map.ts | sed 's|^|ALERTA (arquivo fora de escopo mudou na base): |'
echo "sobreposicao-checada"
```

Expected (24/set): só `sobreposicao-checada` (+ a linha do Aviso Global, se o plano dele ainda não estiver commitado). Nenhuma frente aberta toca os arquivos desta lista nem as 10 funções/5 tabelas (conferido no planejamento: `f2` toca `erro-mensagem.ts`/`realtime-invalidation-map.test.ts`, que esta frente NÃO toca).

**Regra de rebase** (vale até o merge): (a) `SOBREPOE <branch>: <arquivo>` → quem entra primeiro na `feature/plan-tecido-a1` ganha; esta frente faz `git rebase feature/plan-tecido-a1` na própria worktree (worktree limpa, sem stash), resolve PRESERVANDO o texto da outra frente e reaplicando por cima a MESMA intenção da task daqui, roda `gates.sh` e a task que edita o arquivo é re-revisada (Opus) com o diff anexado; (b) `SOBREPOE-BANCO` → PARE: a guarda de md5 da migration vai recusar; refazer a Task 3 (dump + gerar) contra o texto novo DEPOIS que a outra migration estiver na cópia, e re-rodar as Tasks 2–4; (c) antes do merge (Task 13 Step 8) repetir este Step.

- [ ] **Step 5: Estado da cópia (só leitura) — as 10 funções no texto de 24/set**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada"
LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
docker ps --filter name=supabase_db_banco-local --format '{{.Status}}'
PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -F' ' -c "
  select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
         (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal),
         (select count(*) from information_schema.columns where table_schema='public' and column_name='data_nota_entrada')" | tee .superpowers/nota/copia-contagens-t0.txt
PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -F' ' -c "
  select p.oid::regprocedure, md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid in (
    'public.gerar_parcelas_oc_tecido()'::regprocedure, 'public.gerar_parcelas_oc_aviamento()'::regprocedure,
    'public.gerar_parcelas_oc_p_acabado()'::regprocedure, 'public._recalcular_parcelas_core(uuid,text)'::regprocedure,
    'public.recalcular_parcelas_etiqueta(uuid)'::regprocedure, 'public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)'::regprocedure,
    'public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)'::regprocedure, 'public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)'::regprocedure,
    'public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)'::regprocedure,
    'public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)'::regprocedure) order by 1" | tee .superpowers/nota/copia-md5-t0.txt
```

Expected: `Up … (healthy)`; contagens `458 263 0` em 24/set (outra frente pode ter mudado as duas primeiras — anotar; a 3ª TEM de ser `0`); as 10 linhas com EXATAMENTE os md5 da spec §3.1 (só leitura: não precisa do pré-voo R4). md5 diferente = alguém mudou a função: PARE (a Task 3 recusaria) e avise o controlador. Coluna já presente = alguém aplicou esta migration: PARE.

---

## Task 1: `src/lib/nota-entrada.ts` — a regra única de tela  *(Lote A)*

**Files:**
- Create: `src/lib/nota-entrada.ts`
- Test: `tests/unit/nota-entrada.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces (usado pelas Tasks 5–10):
  - `type FamiliaOc = "tecido" | "aviamento" | "etiqueta" | "p_acabado" | "p_importado"` (= `parcelas.tipo_oc`)
  - `FAMILIAS_COM_ALERTA: readonly FamiliaOc[]` (`["tecido","aviamento","etiqueta","p_acabado"]` — D2)
  - `COLUNA_PARCELA_POR_FAMILIA: Readonly<Record<string, string>>` (`tecido→oc_tecido_id`, `aviamento→oc_aviamento_id`, `etiqueta→oc_etiqueta_id`, `p_acabado→oc_p_acabado_id`)
  - `ROTULO_DATA_NOTA`, `AVISO_FALTA_NOTA`, `AVISO_FALTA_NOTA_CURTO` (D6), `TEXTO_PARCELA_PROVISORIA`, `TITULO_BOLINHA`, `DICA_CAMPO_NOTA`, `DICA_CAMPO_NOTA_IMPORTADO: string`
  - `type OcNotaInfo = { status?: string | null; data_nota_entrada?: string | null }`
  - `type ParcelaNotaInfo = { tipo_oc?: string | null; status?: string | null; data_pagamento?: string | null }`
  - `temDataNota(v: string | null | undefined): boolean`
  - `faltaNotaEntrada(familia: string | null | undefined, oc: OcNotaInfo | null | undefined): boolean`
  - `textoAvisoFaltaNota(temParcelaAPagar: boolean | null | undefined): string` (D6 — só `true` dá o texto com "provisórios")
  - `validarDataNota(dataNota, dataPedido, hojeISO: string): string | null` (D7 — mensagem PT igual à do gatilho do banco)
  - `parcelaPaga(p: ParcelaNotaInfo): boolean`
  - `parcelaProvisoria(p: ParcelaNotaInfo, oc: OcNotaInfo | null | undefined): boolean`
  - `baseVencimento(dataNota: string | null | undefined, baseDeHoje: string | null | undefined): string`
  - `payloadDataNota(v: string | null | undefined): string | null`
  - `QUERY_KEYS_VENCIMENTO: readonly (readonly string[])[]` (`[["parcelas"],["dash-financeiro"],["oc-view"],["nota-parcelas-a-pagar"]]`)
  - `invalidarVencimentos(qc: { invalidateQueries(f: { queryKey: readonly unknown[] }): unknown }): void`

- [ ] **Step 1: Escrever o teste (falha)** — `tests/unit/nota-entrada.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  AVISO_FALTA_NOTA, AVISO_FALTA_NOTA_CURTO, COLUNA_PARCELA_POR_FAMILIA, FAMILIAS_COM_ALERTA, QUERY_KEYS_VENCIMENTO,
  TEXTO_PARCELA_PROVISORIA, baseVencimento, faltaNotaEntrada, invalidarVencimentos, parcelaPaga, parcelaProvisoria,
  payloadDataNota, temDataNota, textoAvisoFaltaNota, validarDataNota,
} from "@/lib/nota-entrada";

// Data da Nota de Entrada (spec 2026-09-24 §4.5/§5): regra única do alerta e da parcela provisória.
describe("nota-entrada — quando alertar", () => {
  it("alerta só OC RECEBIDA sem a data, nas 4 famílias; Importado nunca (D2)", () => {
    for (const f of ["tecido", "aviamento", "etiqueta", "p_acabado"] as const) {
      expect(faltaNotaEntrada(f, { status: "recebido", data_nota_entrada: null })).toBe(true);
      expect(faltaNotaEntrada(f, { status: "recebido", data_nota_entrada: "" })).toBe(true);
      expect(faltaNotaEntrada(f, { status: "recebido", data_nota_entrada: "   " })).toBe(true);
      expect(faltaNotaEntrada(f, { status: "recebido" })).toBe(true);
      expect(faltaNotaEntrada(f, { status: "recebido", data_nota_entrada: "2026-10-05" })).toBe(false);
      expect(faltaNotaEntrada(f, { status: "encomendado", data_nota_entrada: null })).toBe(false);
    }
    expect(faltaNotaEntrada("p_importado", { status: "recebido", data_nota_entrada: null })).toBe(false);
    expect(faltaNotaEntrada("servico", { status: "recebido" })).toBe(false);
    expect(faltaNotaEntrada("tecido", null)).toBe(false);
    expect(faltaNotaEntrada(null, { status: "recebido" })).toBe(false);
    expect(FAMILIAS_COM_ALERTA).toEqual(["tecido", "aviamento", "etiqueta", "p_acabado"]);
  });
});

describe("nota-entrada — parcela provisória (Financeiro)", () => {
  const semData = { status: "recebido", data_nota_entrada: null };
  it("não paga + OC em falta = provisória; paga nunca (mesma régua do banco)", () => {
    expect(parcelaProvisoria({ tipo_oc: "tecido", status: "a_pagar", data_pagamento: null }, semData)).toBe(true);
    expect(parcelaProvisoria({ tipo_oc: "p_acabado", status: null, data_pagamento: null }, semData)).toBe(true);
    expect(parcelaProvisoria({ tipo_oc: "tecido", status: "pago", data_pagamento: null }, semData)).toBe(false);
    expect(parcelaProvisoria({ tipo_oc: "tecido", status: "a_pagar", data_pagamento: "2026-10-01" }, semData)).toBe(false);
    expect(parcelaProvisoria({ tipo_oc: "p_importado", status: "a_pagar", data_pagamento: null }, semData)).toBe(false);
    expect(parcelaProvisoria({ tipo_oc: "etiqueta", status: "a_pagar" }, { status: "recebido", data_nota_entrada: "2026-10-05" })).toBe(false);
    expect(parcelaProvisoria({ tipo_oc: "aviamento", status: "a_pagar" }, undefined)).toBe(false);
  });
  it("parcelaPaga = status pago OU data de pagamento", () => {
    expect(parcelaPaga({ status: "pago" })).toBe(true);
    expect(parcelaPaga({ status: "a_pagar", data_pagamento: "2026-10-01" })).toBe(true);
    expect(parcelaPaga({ status: "a_pagar", data_pagamento: "" })).toBe(false);
    expect(parcelaPaga({ status: null, data_pagamento: null })).toBe(false);
  });
});

describe("nota-entrada — base, payload, textos e invalidação", () => {
  it("base do vencimento espelha o COALESCE do banco", () => {
    expect(baseVencimento("2026-10-05", "2026-09-10")).toBe("2026-10-05");
    expect(baseVencimento(" 2026-10-05 ", "2026-09-10")).toBe("2026-10-05");
    expect(baseVencimento("", "2026-09-10")).toBe("2026-09-10");
    expect(baseVencimento(null, "2026-09-10")).toBe("2026-09-10");
    expect(baseVencimento(undefined, undefined)).toBe("");
  });
  it("payload: vazio LIMPA (null); data vai aparada", () => {
    expect(payloadDataNota("")).toBeNull();
    expect(payloadDataNota("  ")).toBeNull();
    expect(payloadDataNota(null)).toBeNull();
    expect(payloadDataNota(undefined)).toBeNull();
    expect(payloadDataNota(" 2026-10-05 ")).toBe("2026-10-05");
    expect(temDataNota("2026-10-05")).toBe(true);
  });
  it("textos aprovados pelo dono (verbatim)", () => {
    expect(AVISO_FALTA_NOTA).toBe("Falta a Data da Nota de Entrada — os vencimentos estão provisórios");
    expect(TEXTO_PARCELA_PROVISORIA).toBe("vencimento provisório — falta a data da nota");
  });
  it("D6 (decidido pelo dono 24/set): sem parcela a pagar confirmada, o aviso NÃO fala em 'provisórios'", () => {
    expect(textoAvisoFaltaNota(true)).toBe(AVISO_FALTA_NOTA);
    expect(textoAvisoFaltaNota(false)).toBe("Falta a Data da Nota de Entrada");
    expect(textoAvisoFaltaNota(undefined)).toBe(AVISO_FALTA_NOTA_CURTO); // carregando: nunca afirma o que não sabe
    expect(AVISO_FALTA_NOTA_CURTO).not.toMatch(/provis/);
    expect(COLUNA_PARCELA_POR_FAMILIA).toEqual({
      tecido: "oc_tecido_id", aviamento: "oc_aviamento_id", etiqueta: "oc_etiqueta_id", p_acabado: "oc_p_acabado_id",
    });
  });
  it("D7 (decidido pelo dono 24/set): data futura ou antes do pedido é recusada com o MESMO texto do banco", () => {
    const hoje = "2026-09-24";
    expect(validarDataNota("2026-09-25", "2026-09-01", hoje)).toBe("A Data da Nota de Entrada (25/09/2026) não pode ser no futuro.");
    expect(validarDataNota("2026-08-31", "2026-09-01", hoje))
      .toBe("A Data da Nota de Entrada (31/08/2026) não pode ser anterior à data do pedido (01/09/2026).");
    expect(validarDataNota("2026-09-01", "2026-09-01", hoje)).toBeNull(); // = pedido: ok
    expect(validarDataNota("2026-09-24", "2026-09-01", hoje)).toBeNull(); // = hoje: ok
    expect(validarDataNota("2026-09-10", "", hoje)).toBeNull();           // sem pedido: só a regra do futuro
    expect(validarDataNota("", "2026-09-01", hoje)).toBeNull();           // vazio: nada a validar (limpar é permitido)
  });
  it("invalidarVencimentos: Financeiro (calendário/lista/resumo), dashboard, visão da OC e o aviso da OC", () => {
    const chaves: unknown[] = [];
    invalidarVencimentos({ invalidateQueries: (f) => { chaves.push(f.queryKey); } });
    expect(chaves).toEqual([["parcelas"], ["dash-financeiro"], ["oc-view"], ["nota-parcelas-a-pagar"]]);
    expect(QUERY_KEYS_VENCIMENTO).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `env -u DATABASE_URL npx vitest run tests/unit/nota-entrada.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/nota-entrada"`.

- [ ] **Step 3: Implementar** — `src/lib/nota-entrada.ts`:

```ts
/**
 * Data da Nota de Entrada nas OCs — regras de TELA (fonte única). Desenho aprovado pelo dono em 24/set/2026.
 * Spec: docs/superpowers/specs/2026-09-24-data-nota-entrada-design.md · Plano: docs/superpowers/plans/2026-09-24-data-nota-entrada.md
 *
 * O VENCIMENTO é decidido no banco (migration 20261002100000: base = COALESCE(data_nota_entrada, base de hoje) em Tecido,
 * Aviamento, Insumo e P. Acabado; o Importado só registra). Aqui ficam só: quando ALERTAR (OC recebida sem a data), a
 * parcela "provisória" do Financeiro, a validação da data (espelho do gatilho do banco), os textos aprovados e o espelho
 * da base para a prévia do "Marcar recebido".
 */

/** Família de OC = valor de `parcelas.tipo_oc`. */
export type FamiliaOc = "tecido" | "aviamento" | "etiqueta" | "p_acabado" | "p_importado";

/** Famílias que ALERTAM (bolinha, aviso na OC, amarelo no Financeiro). Importado fora: "só registra" (spec §10 D2). */
export const FAMILIAS_COM_ALERTA: readonly FamiliaOc[] = ["tecido", "aviamento", "etiqueta", "p_acabado"];

/** Coluna de `parcelas` que aponta para a OC de cada família (as que alertam). */
export const COLUNA_PARCELA_POR_FAMILIA: Readonly<Record<string, string>> = {
  tecido: "oc_tecido_id", aviamento: "oc_aviamento_id", etiqueta: "oc_etiqueta_id", p_acabado: "oc_p_acabado_id",
};

export const ROTULO_DATA_NOTA = "Data da Nota de Entrada";
export const AVISO_FALTA_NOTA = "Falta a Data da Nota de Entrada — os vencimentos estão provisórios";
/** D6 (pendente do dono — recomendação): OC recebida SEM parcela a pagar (toda paga ou valor 0) avisa sem "provisórios". */
export const AVISO_FALTA_NOTA_CURTO = "Falta a Data da Nota de Entrada";
export const TEXTO_PARCELA_PROVISORIA = "vencimento provisório — falta a data da nota";
export const TITULO_BOLINHA = "Falta a Data da Nota de Entrada";
export const DICA_CAMPO_NOTA = "O prazo de pagamento conta a partir desta data.";
export const DICA_CAMPO_NOTA_IMPORTADO = "Só registro — os vencimentos seguem as etapas de câmbio.";

export type OcNotaInfo = { status?: string | null; data_nota_entrada?: string | null };
export type ParcelaNotaInfo = { tipo_oc?: string | null; status?: string | null; data_pagamento?: string | null };

export function temDataNota(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim() !== "";
}

/** OC RECEBIDA sem a data, numa família que alerta (spec §4.5). */
export function faltaNotaEntrada(familia: string | null | undefined, oc: OcNotaInfo | null | undefined): boolean {
  if (!oc || !familia || !(FAMILIAS_COM_ALERTA as readonly string[]).includes(familia)) return false;
  return oc.status === "recebido" && !temDataNota(oc.data_nota_entrada);
}

/** Texto do aviso na OC: com parcela a pagar confirmada, o texto aprovado; senão (toda paga, valor 0 ou ainda
 *  carregando) o curto, que nunca afirma algo falso (D6). */
export function textoAvisoFaltaNota(temParcelaAPagar: boolean | null | undefined): string {
  return temParcelaAPagar === true ? AVISO_FALTA_NOTA : AVISO_FALTA_NOTA_CURTO;
}

/** Parcela paga = a MESMA régua do banco (`status = 'pago' OR data_pagamento IS NOT NULL`). */
export function parcelaPaga(p: ParcelaNotaInfo): boolean {
  return p.status === "pago" || temDataNota(p.data_pagamento);
}

/** Destaque amarelo do Financeiro: parcela NÃO paga de OC em falta. A paga nunca (o vencimento dela não muda mais). */
export function parcelaProvisoria(p: ParcelaNotaInfo, oc: OcNotaInfo | null | undefined): boolean {
  return !parcelaPaga(p) && faltaNotaEntrada(p.tipo_oc, oc);
}

/** Espelho do COALESCE do banco — base do vencimento na prévia do "Marcar recebido" (ISO yyyy-MM-dd, ou ""). */
export function baseVencimento(dataNota: string | null | undefined, baseDeHoje: string | null | undefined): string {
  return temDataNota(dataNota) ? (dataNota as string).trim() : (baseDeHoje ?? "");
}

/** Campo → payload da RPC. A chave vai SEMPRE (ausente = o banco mantém); vazio LIMPA (null). */
export function payloadDataNota(v: string | null | undefined): string | null {
  return temDataNota(v) ? (v as string).trim() : null;
}

const br = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** D7 (pendente do dono — recomendação): a data não pode ser FUTURA (> hoje no fuso da loja) nem ANTERIOR à data do
 *  pedido. Espelho EXATO das mensagens do gatilho `fn_oc_nota_entrada_valida` do banco (que é quem garante). */
export function validarDataNota(
  dataNota: string | null | undefined, dataPedido: string | null | undefined, hojeISO: string,
): string | null {
  if (!temDataNota(dataNota)) return null;
  const n = (dataNota as string).trim();
  if (hojeISO && n > hojeISO) return `A Data da Nota de Entrada (${br(n)}) não pode ser no futuro.`;
  if (temDataNota(dataPedido) && n < (dataPedido as string).trim()) {
    return `A Data da Nota de Entrada (${br(n)}) não pode ser anterior à data do pedido (${br((dataPedido as string).trim())}).`;
  }
  return null;
}

/** queryKeys que exibem vencimento de parcela — invalidar ao salvar/receber qualquer OC (a data pode ter mudado). */
export const QUERY_KEYS_VENCIMENTO: readonly (readonly string[])[] = [
  ["parcelas"], ["dash-financeiro"], ["oc-view"], ["nota-parcelas-a-pagar"],
];

export function invalidarVencimentos(qc: { invalidateQueries(f: { queryKey: readonly unknown[] }): unknown }): void {
  for (const k of QUERY_KEYS_VENCIMENTO) void qc.invalidateQueries({ queryKey: [...k] });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `env -u DATABASE_URL npx vitest run tests/unit/nota-entrada.test.ts`
Expected: `Test Files 1 passed`, `Tests 9 passed`.

- [ ] **Step 5: Gate + commit**

```bash
bash .superpowers/nota/gates.sh
git add -- src/lib/nota-entrada.ts tests/unit/nota-entrada.test.ts
git commit --only -m "feat(nota-entrada): regra única de tela — alerta, parcela provisória, base do vencimento e textos aprovados" -m "Co-Authored-By: <seu modelo> <noreply@anthropic.com>" -- src/lib/nota-entrada.ts tests/unit/nota-entrada.test.ts
```

---

## Task 2: Testes de integração do banco (antes da migration — falham)  *(individual Opus, JUNTO com a Task 3)*

**Files:**
- Create: `tests/integration/nota-entrada.test.ts`

**Interfaces:**
- Consumes: `tests/integration/db.ts` (`hasDb`, `withTx`, `comoUsuario`, `um`, `TENANT_TESTE`, `ehBancoLocal`) — não modificar.
- Produces: a suíte que prova a Task 3. Variáveis: `DATABASE_URL` (a da cópia), `NOTA_MIG_TXN=1` (aplica a migration dentro da txn; exige a cópia SEM ela), `NOTA_CAPTURA_DEPOIS=<dir>` (grava o `pg_get_functiondef` depois — Task 3 Step 5).

Cobertura (15 testes; 9 rodam nos dois modos, 6 só com `NOTA_MIG_TXN=1`). Datas SEMPRE no passado e ≥ o pedido (01/09/2026) — a D7 recusa futura:
1. ACL #9 das internas; RPCs de sempre seguem para `authenticated`.
2. Tecido: data → vencimentos = data + 30/60/90; mudar a data pela RPC → só as NÃO pagas mudam; paga idêntica (id, valor, vencimento, status, data de pagamento); valores das não pagas `333.34/333.33`; Σ = 1.000,00; data gravada.
3. Tecido: UPDATE direto da data recalcula (gatilho); OC encomendada não ganha parcela.
4. Tecido: chave ausente (front antigo) mantém; `""` e `null` limpam e voltam à base da entrega.
5. Aviamento, 6. Insumo: data, mudança pela RPC e por UPDATE direto, paga intacta, Σ = total (calculado no SQL).
7. P. Acabado: base = data antes do recebimento; mudança só nas não pagas; sem data = pedido; UPDATE direto re-dispara o gerador.
8. Importado: parcelas idênticas com e sem a data (controle = re-salvar sem a chave).
9. D7 (decidido pelo dono 24/set): data futura e data antes do pedido RECUSADAS em PT (pela RPC e por UPDATE direto); = pedido aceita; re-salvar sem mudar a data não revalida.
10. (MIG_TXN) sem a data = o de hoje, byte a byte (4 famílias; com e sem entrega; com paga + recálculo; prazo "30, 60").
11. (MIG_TXN) idempotente e ACL das 10 redefinidas igual à de antes; 3 gatilhos de recálculo + 5 de validação.
12. (MIG_TXN) **R2:** uma função alterada por "outra frente" que AINDA contém `data_nota_entrada` é RECUSADA pela migration e pelo inverso (e nada fica pela metade).
13. (MIG_TXN) inverso: a ORDEM do arquivo (funções → laço → DROP TRIGGER → repasse → DROP COLUMN — R9-a/R9-b); recusa sem confirmação (e não deixa nada pela metade); com ela, 10 funções no md5 de 24/set, gatilho do Acabado com as 3 colunas de antes, colunas fora, as não pagas das 4 famílias (Tecido, Aviamento, Insumo e P. Acabado, todas datadas com NF 05/09 ≠ base antiga) de volta à base ANTIGA — entrega 10/09 ou pedido 01/09: prova que o laço rodou com as funções JÁ restauradas —, paga intacta, Σ = total; o NOTICE do repasse diz `0 OC(s) repassada(s)` (o laço já pegou todas); reaplicar depois funciona. O harness tira as 2 travas da txn do teste; o TEMPO do inverso com volume é medido na Task 4.
14. (MIG_TXN + `NOTA_CAPTURA_DEPOIS`) captura o texto DEPOIS (10 + 2 novas) para o diff da Task 3.
15. (MIG_TXN + `NOTA_MEDIR_VOLTA`) **R9-b:** mede o laço do inverso com as OCs recebidas da cópia DATADAS numa txn DESFEITA — migration, datar (a própria base de hoje, dentro da D7), a ida de novo, o inverso cronometrado por `clock_timestamp()` com `transaction_timeout` de 180 s só nessa txn (teto da medição — R9-c); grava `volta-medida.txt`; confere Σ por OC e as pagas iguais depois da volta; ROLLBACK (resíduo zero). Só roda na Task 4.

- [ ] **Step 1: Escrever a suíte** — `tests/integration/nota-entrada.test.ts`:

```ts
/**
 * DATA DA NOTA DE ENTRADA nas 5 OCs — integração em BEGIN…ROLLBACK: NADA é gravado.
 * Spec: docs/superpowers/specs/2026-09-24-data-nota-entrada-design.md · Plano: docs/superpowers/plans/2026-09-24-data-nota-entrada.md
 *
 * ⚠️ SÓ NA CÓPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). Fora dela a suíte INTEIRA se
 * pula (nunca roda contra produção / `/tmp/dburl.txt`): DDL em transação contra produção trava o app de todas as lojas mesmo
 * com ROLLBACK (incidente 23/set).
 *
 * Dois modos:
 *  • NOTA_MIG_TXN=1 — a cópia está SEM a migration; `prepara` aplica o arquivo DENTRO da txn (tira só as linhas `BEGIN;` e
 *    `COMMIT;` — NUNCA `\i`: o COMMIT do arquivo fecharia a txn e VAZARIA, incidente 15/set). Roda TUDO, inclusive os 6 testes
 *    que precisam do estado de ANTES ("sem data = hoje", idempotência/ACL, guarda R2, inverso, captura do diff e a medição
 *    do laço do inverso — R9-b: com as OCs recebidas da cópia DATADAS, tudo DESFEITO no ROLLBACK).
 *  • sem a variável — a migration já está aplicada na cópia (Task 4/12); roda os testes de comportamento; os 6 pulam.
 * ⚠️ R4 do G-plano: a DDL em transação CONGELA o app de teste do dono (:5188) nas OCs/Estoque/Financeiro enquanto roda —
 *    só rodar depois do pré-voo `bash .superpowers/nota/prevoo-copia.sh <passo>` (dono avisado, :5188 ocioso, nenhum
 *    vitest/playwright, nenhuma sessão ativa na cópia).
 * Datas dos cenários: SEMPRE no passado (a D7 recusa data futura) e ≥ a data do pedido (01/09/2026).
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261002100000_oc_data_nota_entrada.sql";
const DOWN = "supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql";
const MIG_TXN = process.env.NOTA_MIG_TXN === "1";
const CAPTURA = process.env.NOTA_CAPTURA_DEPOIS ?? "";
/** R9-b: arquivo onde a medição do laço do inverso grava (chave=valor) — só com NOTA_MIG_TXN=1 (Task 4 Step 2). */
const MEDIR = process.env.NOTA_MEDIR_VOLTA ?? "";
const RODA = hasDb && ehBancoLocal();

/** md5(pg_get_functiondef) das 10 funções redefinidas — cópia em 24/set (= produção em 23/set). */
const MD5_ANTES: Record<string, string> = {
  "public.gerar_parcelas_oc_tecido()": "ac9fb224249f42133f5bf2750aba5d1c",
  "public.gerar_parcelas_oc_aviamento()": "345e55d865a0e4713e6ccbc62f50830d",
  "public.gerar_parcelas_oc_p_acabado()": "1d8286d877f32a437b344a0da1766ccb",
  "public._recalcular_parcelas_core(uuid,text)": "b8af65bc500958202db25ddb5f3d3eed",
  "public.recalcular_parcelas_etiqueta(uuid)": "d60ab89c8c25a830aa7a7789ff97eef0",
  "public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)": "b5255dc864f0e7f9f39236b4b9c531d6",
  "public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)": "56af6c8a9ecb5619be2de1f2068553b3",
  "public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)": "d92d27b1d774ca4d867fc9151f774fda",
  "public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)": "bd8139b1a1b1dee8b4b90e4327cb152c",
  "public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)": "b74cd38a16fa08482551f1fb7e1487bb",
};
/** Funções NOVAS desta migration (o md5 "depois" delas vem do gerador). */
const NOVAS = ["public.fn_oc_nota_entrada_recalc()", "public.fn_oc_nota_entrada_valida()"];
/** Internas: EXECUTE revogado de PUBLIC/anon/authenticated (invariante #9). */
const INTERNAS = [
  "public.fn_oc_nota_entrada_recalc()",
  "public.fn_oc_nota_entrada_valida()",
  "public._recalcular_parcelas_core(uuid,text)",
  "public.recalcular_parcelas_etiqueta(uuid)",
  "public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)",
  "public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)",
  "public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)",
  "public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)",
  "public.gerar_parcelas_oc_tecido()",
  "public.gerar_parcelas_oc_aviamento()",
];

// ───────────── Harness: migration DENTRO da txn, só na cópia (espelha tests/integration/kanban-auto.test.ts:56-128) ─────────────
const RE_BEGIN = /^[ \t]*BEGIN[ \t]*;[ \t]*$/im;
const RE_COMMIT = /^[ \t]*COMMIT[ \t]*;[ \t]*$/im;
const todas = (re: RegExp) => new RegExp(re.source, "gim");
const RE_COMENTARIO_LINHA = /--[^\n]*/g;
const RE_COMENTARIO_BLOCO = /\/\*[\s\S]*?\*\//g;
const RE_TXN_CTRL_SOLTA =
  /(^|;)[ \t]*(BEGIN|COMMIT|ROLLBACK|ABORT|START[ \t]+TRANSACTION|SAVEPOINT|RELEASE|END(?!\s*(IF|LOOP|CASE|WHILE)\b))\b[^\n]*;/im;

/** DDL/migration SÓ na cópia local (decisão 17 do dono; incidente 23/set). */
function exigeBancoLocal(): void {
  if (!ehBancoLocal()) {
    throw new Error(
      "DDL/migration só na cópia local — ver banco-local (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). " +
        "DDL em transação contra produção trava o app de todas as lojas mesmo com ROLLBACK (incidente 23/set).",
    );
  }
}

/** R9/R9-a: as 2 travas ficam NO arquivo, logo depois do `BEGIN;` (psql -f = caminho padrão): lock_timeout SEMPRE 500 ms;
 *  transaction_timeout 3 s na ida e ≥ 30 s no inverso (`gerar_sql.py --tt-inverso`). Na txn do teste o relógio derrubaria
 *  a suíte inteira → o harness EXIGE as 2 linhas na posição certa e as tira. */
const RE_TRAVAS_DO_ARQUIVO = /^BEGIN;\nSET LOCAL lock_timeout = '500ms';\nSET LOCAL transaction_timeout = '(\d+)s';\n/m;
const RE_DDL_POLICY = /^[ \t]*(CREATE|DROP|ALTER)[ \t]+POLICY\b/im;

function semTransacao(sql: string, nome: string): string {
  const nb = (sql.match(todas(RE_BEGIN)) ?? []).length;
  const nc = (sql.match(todas(RE_COMMIT)) ?? []).length;
  if (nb !== 1 || nc !== 1) throw new Error(`${nome}: esperado 1 "BEGIN;" e 1 "COMMIT;" em linha própria (achei ${nb}/${nc})`);
  const travas = RE_TRAVAS_DO_ARQUIVO.exec(sql);
  const ehInverso = nome.includes("/rollback/");
  const tt = travas ? Number(travas[1]) : NaN;
  if (!travas || !(ehInverso ? tt >= 30 : tt === 3))
    throw new Error(
      `${nome}: faltam, logo depois do "BEGIN;", SET LOCAL lock_timeout = '500ms'; e SET LOCAL transaction_timeout = ` +
        `'${ehInverso ? "≥30" : "3"}s'; (R9/R9-a)`,
    );
  if (RE_DDL_POLICY.test(sql))
    throw new Error(`${nome}: DDL de policy dispara o hook supautils.policy_grants (trava auth/storage) — rever o texto da spec §7 e pôr no FIM (R9)`);
  const out = sql
    .replace(RE_TRAVAS_DO_ARQUIVO, "BEGIN;\n-- [harness] travas de tempo removidas (valem no psql -f / aplica_v2, não na txn do teste)\n")
    .replace(todas(RE_BEGIN), "-- [harness] BEGIN removido")
    .replace(todas(RE_COMMIT), "-- [harness] COMMIT removido");
  const foraDeCorpos = out
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "")
    .replace(RE_COMENTARIO_BLOCO, "")
    .replace(RE_COMENTARIO_LINHA, "");
  if (RE_TXN_CTRL_SOLTA.test(foraDeCorpos)) throw new Error(`${nome}: controle de transação fora de corpo de função — recusado`);
  if (/^[ \t]*\\/m.test(foraDeCorpos)) throw new Error(`${nome}: meta-comando psql (\\i, \\set…) — recusado`);
  return out;
}

async function aplicarArquivo(c: Client, rel: string, antes = ""): Promise<void> {
  exigeBancoLocal(); // 1ª linha, estrutural: nenhum chamador aplica DDL fora da cópia
  const sql = semTransacao(readFileSync(ROOT + rel, "utf8"), rel);
  await c.query("SAVEPOINT nota_mig");
  try {
    if (antes) await c.query(antes);
    await c.query(sql);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT nota_mig");
    throw e;
  }
  await c.query("RELEASE SAVEPOINT nota_mig");
}

async function colunas(c: Client): Promise<number> {
  const r = await um<{ n: string }>(
    c,
    `select count(*) n from information_schema.columns where table_schema = 'public' and column_name = 'data_nota_entrada'
       and table_name in ('ocs_tecido','ocs_aviamento','ocs_etiqueta','ocs_p_acabado','ocs_importado')`,
  );
  return Number(r.n);
}

async function timeouts(c: Client): Promise<void> {
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '120s'");
}

/** Timeouts + (MIG_TXN) migration na txn + exige as 5 colunas + usuário da Loja Teste. */
async function prepara(c: Client): Promise<void> {
  await timeouts(c);
  if (MIG_TXN) {
    if ((await colunas(c)) !== 0) {
      throw new Error("NOTA_MIG_TXN=1 exige a cópia SEM a migration — rode sem a variável, ou desfaça antes (bash .superpowers/nota/copia.sh volta).");
    }
    await aplicarArquivo(c, MIG);
  }
  if ((await colunas(c)) !== 5) throw new Error("migration ausente na cópia — rode com NOTA_MIG_TXN=1 ou aplique-a (Task 4 / Task 12).");
  await comoUsuario(c);
}

// ───────────── Fixtures (dados já existentes da Loja Teste; tudo criado aqui morre no ROLLBACK) ─────────────
const COL = { tecido: "oc_tecido_id", aviamento: "oc_aviamento_id", etiqueta: "oc_etiqueta_id", p_acabado: "oc_p_acabado_id", p_importado: "oc_importado_id" } as const;
type Familia = keyof typeof COL;
type Parc = { id: string; n: number; valor: string; venc: string; status: string; pago_em: string | null; offset: number | null };
type Fix = { emp: string; art: string; var: string; aviId: string; aviEmp: string; etqId: string; etqVar: string | null };

async function fixtures(c: Client): Promise<Fix> {
  const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id = $1 order by id limit 1`, [TENANT_TESTE]);
  const tec = await um<{ art: string; var: string } | undefined>(
    c, `select a.id art, v.id var from variantes_tecido v join artigos a on a.id = v.artigo_id where a.tenant_id = $1 order by v.id limit 1`, [TENANT_TESTE]);
  const avi = await um<{ id: string; emp: string } | undefined>(
    c, `select id, empresa_id emp from aviamentos where tenant_id = $1 and coalesce(preco,0) > 0 and empresa_id is not null order by id limit 1`, [TENANT_TESTE]);
  const etq = await um<{ id: string; var: string | null } | undefined>(
    c, `select e.id, (select v.id from variantes_etiqueta v where v.etiqueta_id = e.id order by v.id limit 1) var
          from etiquetas e where e.tenant_id = $1 order by e.id limit 1`, [TENANT_TESTE]);
  if (!emp || !tec || !avi || !etq) throw new Error("Loja Teste sem fixture (empresa / tecido / aviamento com preço / insumo) — conferir a cópia");
  return { emp: emp.id, art: tec.art, var: tec.var, aviId: avi.id, aviEmp: avi.emp, etqId: etq.id, etqVar: etq.var };
}

async function parcelas(c: Client, f: Familia, ocId: string): Promise<Parc[]> {
  const { rows } = await c.query(
    `select id, numero_parcela n, valor::numeric(14,2)::text valor, to_char(data_vencimento, 'YYYY-MM-DD') venc, status,
            to_char(data_pagamento, 'YYYY-MM-DD') pago_em, dias_offset "offset"
       from public.parcelas where ${COL[f]} = $1 order by numero_parcela`,
    [ocId],
  );
  return rows as Parc[];
}
// nº de pedido termina em dígitos: o core incrementa em caso de repetição (sem dígito finais ele entraria em laço).
const semId = (ps: Parc[]) => ps.map(({ id: _id, ...r }) => r);
/** Σ em CENTAVOS inteiros (sem float). */
const centavos = (ps: Parc[]) => ps.reduce((s, p) => s + Math.round(Number(p.valor) * 100), 0);
const centavosDe = (v: string) => Math.round(Number(v) * 100);
async function pagar(c: Client, id: string): Promise<void> {
  await c.query(`update public.parcelas set status = 'pago', data_pagamento = '2026-09-20' where id = $1`, [id]);
}
async function notaDe(c: Client, tabela: string, id: string): Promise<string | null> {
  return (await um<{ d: string | null }>(c, `select to_char(data_nota_entrada, 'YYYY-MM-DD') d from public.${tabela} where id = $1`, [id])).d;
}

async function ocTecido(c: Client, fx: Fix, extra: Record<string, unknown> = {}, id: string | null = null): Promise<string> {
  const oc = {
    numero_pedido: "NOTA-TEC-90001", empresa_id: fx.emp, data_prevista_entrega: "2026-09-01", data_entrega: "2026-09-10",
    prazo_pagamento: "30/60/90", quantidade_prazos: 3, parcelas_recebimento: [], valor_previsto_total: 1000, valor_real_total: 1000,
    status: "recebido", ...extra,
  };
  const item = id ? await um<{ id: string }>(c, `select id from ocs_tecido_itens where oc_tecido_id = $1`, [id]) : null;
  const itens = [{
    id: item?.id ?? null, artigo_id: fx.art, artigo_numero: 1, variante_tecido_id: fx.var, quantidade_pedida: 100,
    quantidade_recebida: 100, rendimento: null, cancelado: false, preco: 10,
  }];
  return (await um<{ id: string }>(c, `select public._salvar_oc_tecido_core($1::uuid, $2::jsonb, $3::jsonb, null::int) as id`,
    [id, JSON.stringify(oc), JSON.stringify(itens)])).id;
}

async function ocAviamento(c: Client, fx: Fix, extra: Record<string, unknown> = {}, id: string | null = null): Promise<string> {
  const oc = {
    numero_pedido: "NOTA-AVI-90001", responsavel_nome: null, empresa_id: fx.aviEmp, representante_id: null, data_pedido: "2026-09-01",
    data_prevista_entrega: "2026-09-05", data_entrega: "2026-09-10", prazo_pagamento: "30/60", quantidade_prazos: 2, nf_url: null,
    parcelas_recebimento: [], status: "recebido", ...extra,
  };
  const itens = id
    ? (await c.query(`select id, aviamento_id, variante_aviamento_id, quantidade_pedida, quantidade_recebida, cancelado
                        from ocs_aviamento_itens where oc_aviamento_id = $1`, [id])).rows
    : [{ id: null, aviamento_id: fx.aviId, variante_aviamento_id: null, quantidade_pedida: 100, quantidade_recebida: 100, cancelado: false }];
  // 4 args explícitos: existe também o overload de 3 args (débito conhecido) — 3 args aqui seria ambíguo.
  return (await um<{ id: string }>(c, `select public._salvar_oc_aviamento_core($1::uuid, $2::jsonb, $3::jsonb, null::int) as id`,
    [id, JSON.stringify(oc), JSON.stringify(itens)])).id;
}

async function ocInsumo(c: Client, fx: Fix, extra: Record<string, unknown> = {}, id: string | null = null): Promise<string> {
  const oc = {
    numero_pedido: "NOTA-INS-90001", responsavel_nome: null, empresa_id: fx.emp, representante_id: null, data_pedido: "2026-09-01",
    data_prevista_entrega: "2026-09-05", data_entrega: "2026-09-10", prazo_pagamento: "30/60", quantidade_prazos: 2, nf_url: null,
    nfs: [], parcelas_recebimento: [], status: "recebido", ...extra,
  };
  const itens = id
    ? (await c.query(`select id, etiqueta_id, variante_etiqueta_id, quantidade_pedida, quantidade_recebida, preco, cancelado
                        from ocs_etiqueta_itens where oc_etiqueta_id = $1`, [id])).rows
    : [{ id: null, etiqueta_id: fx.etqId, variante_etiqueta_id: fx.etqVar, quantidade_pedida: 100, quantidade_recebida: 100, preco: 2.5, cancelado: false }];
  return (await um<{ id: string }>(c, `select public.salvar_oc_etiqueta($1::uuid, $2::jsonb, $3::jsonb, null::int) as id`,
    [id, JSON.stringify(oc), JSON.stringify(itens)])).id;
}

async function ocPAcabado(c: Client, fx: Fix, extra: Record<string, unknown> = {}, id: string | null = null): Promise<string> {
  const dados = {
    nome_produto: "NOTA-PA", empresa_id: fx.emp, data_pedido: "2026-09-01", prazo_pagamento: "30/60", qtd_total: 10,
    valor_unitario: 100, desconto_pct: 0, grade_proporcao: {}, variantes: [], ...extra,
  };
  const grade = { "1": { P: { pedida: 10, recebida: 0, defeito: 0 } } };
  return (await um<{ id: string }>(c, `select public._salvar_oc_p_acabado_core($1::uuid, $2::jsonb, $3::jsonb, null::int) as id`,
    [id, JSON.stringify(dados), JSON.stringify(grade)])).id;
}

/** Re-salva a OC de importado com os dados ATUAIS dela (+ extra) — pelo core, igual ao front. */
async function salvarImportado(c: Client, ocId: string, extra: Record<string, unknown> = {}, semChave = false): Promise<void> {
  const r = await um<{ j: Record<string, unknown>; g: unknown; e: unknown }>(
    c,
    `select to_jsonb(o) j, o.grade_detalhe g,
            coalesce((select jsonb_agg(jsonb_build_object('ordem', e.ordem, 'rotulo', e.rotulo, 'base', e.base,
                        'percentual', e.percentual, 'data_vencimento', e.data_vencimento, 'cotacao', e.cotacao) order by e.ordem)
                        from ocs_importado_etapas e where e.oc_importado_id = o.id), '[]'::jsonb) e
       from ocs_importado o where o.id = $1`,
    [ocId],
  );
  const dados: Record<string, unknown> = { ...r.j, ...extra };
  if (semChave) delete dados.data_nota_entrada;
  await c.query(`select public._salvar_oc_importado_core($1::uuid, $2::jsonb, $3::jsonb, $4::jsonb, null::int)`,
    [ocId, JSON.stringify(dados), JSON.stringify(r.g), JSON.stringify(r.e)]);
}

const totalAviamento = async (c: Client, id: string) => centavosDe((await um<{ t: string }>(c,
  `select coalesce(sum(coalesce(it.quantidade_recebida, it.quantidade_pedida, 0) * coalesce(a.preco, 0)), 0)::numeric(12,2)::text t
     from ocs_aviamento_itens it left join aviamentos a on a.id = it.aviamento_id
    where it.oc_aviamento_id = $1 and not coalesce(it.cancelado, false)`, [id])).t);
const totalInsumo = async (c: Client, id: string) => centavosDe((await um<{ t: string }>(c,
  `select coalesce(sum(coalesce(quantidade_recebida, quantidade_pedida, 0) * coalesce(preco, 0)), 0)::numeric(12,2)::text t
     from ocs_etiqueta_itens where oc_etiqueta_id = $1 and not coalesce(cancelado, false)`, [id])).t);

// ───────────────────────────────────────────── Testes ─────────────────────────────────────────────
describe.skipIf(!RODA)("Data da Nota de Entrada — banco (só na cópia local)", () => {
  it("ACL (#9): internas sem EXECUTE para anon/authenticated; RPCs de sempre seguem para authenticated", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const f of INTERNAS) {
        const r = await um<{ a: boolean; u: boolean }>(c,
          `select has_function_privilege('anon', $1, 'EXECUTE') a, has_function_privilege('authenticated', $1, 'EXECUTE') u`, [f]);
        expect({ f, anon: r.a, auth: r.u }).toEqual({ f, anon: false, auth: false });
      }
      for (const f of ["public.recalcular_parcelas(uuid,text)", "public.salvar_oc_tecido(uuid,jsonb,jsonb,integer)",
        "public.salvar_oc_aviamento(uuid,jsonb,jsonb,integer)", "public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)",
        "public.salvar_oc_p_acabado(uuid,jsonb,jsonb,integer)", "public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb,integer)"]) {
        const r = await um<{ u: boolean }>(c, `select has_function_privilege('authenticated', $1, 'EXECUTE') u`, [f]);
        expect({ f, auth: r.u }).toEqual({ f, auth: true });
      }
    });
  });

  it("Tecido: com a data, vencimento = data + prazo; mudar a data (RPC) só move as NÃO pagas; paga intacta; Σ = total", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const id = await ocTecido(c, fx, { data_nota_entrada: "2026-09-05" });
      const p1 = await parcelas(c, "tecido", id);
      expect(p1.map((p) => p.venc)).toEqual(["2026-10-05", "2026-11-04", "2026-12-04"]);
      expect(centavos(p1)).toBe(100000);
      await pagar(c, p1[0].id);
      const paga = (await parcelas(c, "tecido", id))[0];
      await ocTecido(c, fx, { data_nota_entrada: "2026-09-15" }, id);
      const p2 = await parcelas(c, "tecido", id);
      expect(p2[0]).toEqual(paga); // mesma linha: id, valor, vencimento, status, data de pagamento
      expect(p2.slice(1).map((p) => p.venc)).toEqual(["2026-11-14", "2026-12-14"]);
      expect(p2.slice(1).map((p) => p.valor)).toEqual(["333.34", "333.33"]); // restante 666,67 em 2 (o último absorve o resto)
      expect(centavos(p2)).toBe(100000);
      expect(await notaDe(c, "ocs_tecido", id)).toBe("2026-09-15");
    });
  });

  it("Tecido: UPDATE direto da data também recalcula (gatilho); OC encomendada não ganha parcela", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const id = await ocTecido(c, fx, { data_nota_entrada: "2026-09-05" });
      await pagar(c, (await parcelas(c, "tecido", id))[0].id);
      const paga = (await parcelas(c, "tecido", id))[0];
      await c.query(`update public.ocs_tecido set data_nota_entrada = '2026-09-15' where id = $1`, [id]);
      const p = await parcelas(c, "tecido", id);
      expect(p[0]).toEqual(paga);
      expect(p.slice(1).map((x) => x.venc)).toEqual(["2026-11-14", "2026-12-14"]);
      expect(centavos(p)).toBe(100000);
      const enc = await ocTecido(c, fx, { status: "encomendado", numero_pedido: "NOTA-TEC-90002" });
      await c.query(`update public.ocs_tecido set data_nota_entrada = '2026-09-15' where id = $1`, [enc]);
      expect(await parcelas(c, "tecido", enc)).toEqual([]);
    });
  });

  it("Tecido: chave ausente (front antigo) MANTÉM a data; '' e null LIMPAM e voltam à base da entrega", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const id = await ocTecido(c, fx, { data_nota_entrada: "2026-09-05" });
      await ocTecido(c, fx, {}, id); // payload SEM a chave
      expect(await notaDe(c, "ocs_tecido", id)).toBe("2026-09-05");
      expect((await parcelas(c, "tecido", id)).map((p) => p.venc)).toEqual(["2026-10-05", "2026-11-04", "2026-12-04"]);
      await ocTecido(c, fx, { data_nota_entrada: "" }, id);
      expect(await notaDe(c, "ocs_tecido", id)).toBeNull();
      expect((await parcelas(c, "tecido", id)).map((p) => p.venc)).toEqual(["2026-10-10", "2026-11-09", "2026-12-09"]);
      await ocTecido(c, fx, { data_nota_entrada: "2026-09-05" }, id);
      await ocTecido(c, fx, { data_nota_entrada: null }, id);
      expect(await notaDe(c, "ocs_tecido", id)).toBeNull();
    });
  });

  it("Aviamento: data + mudança só nas não pagas + paga intacta + Σ = total", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const id = await ocAviamento(c, fx, { data_nota_entrada: "2026-09-05" });
      const total = await totalAviamento(c, id);
      const p1 = await parcelas(c, "aviamento", id);
      expect(p1.map((p) => p.venc)).toEqual(["2026-10-05", "2026-11-04"]);
      expect(centavos(p1)).toBe(total);
      await pagar(c, p1[0].id);
      const paga = (await parcelas(c, "aviamento", id))[0];
      await ocAviamento(c, fx, { data_nota_entrada: "2026-09-15" }, id);
      const p2 = await parcelas(c, "aviamento", id);
      expect(p2[0]).toEqual(paga);
      expect(p2[1].venc).toBe("2026-11-14");
      expect(centavos(p2)).toBe(total);
      await c.query(`update public.ocs_aviamento set data_nota_entrada = '2026-09-20' where id = $1`, [id]);
      const p3 = await parcelas(c, "aviamento", id);
      expect(p3[0]).toEqual(paga);
      expect(p3[1].venc).toBe("2026-11-19");
      expect(centavos(p3)).toBe(total);
    });
  });

  it("Insumo: data + mudança só nas não pagas + paga intacta + Σ = total", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const id = await ocInsumo(c, fx, { data_nota_entrada: "2026-09-05" });
      const total = await totalInsumo(c, id);
      const p1 = await parcelas(c, "etiqueta", id);
      expect(p1.map((p) => p.venc)).toEqual(["2026-10-05", "2026-11-04"]);
      expect(centavos(p1)).toBe(total);
      await pagar(c, p1[0].id);
      const paga = (await parcelas(c, "etiqueta", id))[0];
      await ocInsumo(c, fx, { data_nota_entrada: "2026-09-15" }, id);
      const p2 = await parcelas(c, "etiqueta", id);
      expect(p2[0]).toEqual(paga);
      expect(p2[1].venc).toBe("2026-11-14");
      expect(centavos(p2)).toBe(total);
      await c.query(`update public.ocs_etiqueta set data_nota_entrada = '2026-09-20' where id = $1`, [id]);
      const p3 = await parcelas(c, "etiqueta", id);
      expect(p3[0]).toEqual(paga);
      expect(p3[1].venc).toBe("2026-11-19");
      expect(centavos(p3)).toBe(total);
    });
  });

  it("P. Acabado: a data já é a base antes do recebimento; mudar só move as não pagas; paga intacta; Σ = total", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const id = await ocPAcabado(c, fx, { data_nota_entrada: "2026-09-05" });
      const p1 = await parcelas(c, "p_acabado", id);
      expect(p1.map((p) => p.venc)).toEqual(["2026-10-05", "2026-11-04"]);
      expect(centavos(p1)).toBe(100000);
      await pagar(c, p1[0].id);
      const paga = (await parcelas(c, "p_acabado", id))[0];
      await ocPAcabado(c, fx, { data_nota_entrada: "2026-09-15" }, id);
      const p2 = await parcelas(c, "p_acabado", id);
      expect(p2[0]).toEqual(paga);
      expect(p2[1].venc).toBe("2026-11-14");
      expect(centavos(p2)).toBe(100000);
      // sem a data a base é o pedido (hoje) — e o UPDATE direto da data re-dispara o gerador
      const id2 = await ocPAcabado(c, fx, { nome_produto: "NOTA-PA-2" });
      expect((await parcelas(c, "p_acabado", id2)).map((p) => p.venc)).toEqual(["2026-10-01", "2026-10-31"]);
      await c.query(`update public.ocs_p_acabado set data_nota_entrada = '2026-09-05' where id = $1`, [id2]);
      expect((await parcelas(c, "p_acabado", id2)).map((p) => p.venc)).toEqual(["2026-10-05", "2026-11-04"]);
    });
  });

  it("Importado: só registra — as parcelas (etapas de câmbio) ficam idênticas com e sem a data", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const oc = await um<{ id: string } | undefined>(c,
        `select id from ocs_importado o where tenant_id = $1 and exists (select 1 from parcelas p where p.oc_importado_id = o.id)
          order by id limit 1`, [TENANT_TESTE]);
      if (!oc) throw new Error("Loja Teste sem OC de importado com parcelas — conferir a cópia");
      await salvarImportado(c, oc.id, {}, true); // controle: re-salvar como está (sem a chave)
      const base = semId(await parcelas(c, "p_importado", oc.id));
      expect(base.length).toBeGreaterThan(0);
      await salvarImportado(c, oc.id, { data_nota_entrada: "2026-09-10" });
      expect(await notaDe(c, "ocs_importado", oc.id)).toBe("2026-09-10");
      expect(semId(await parcelas(c, "p_importado", oc.id))).toEqual(base);
      await c.query(`update public.ocs_importado set data_nota_entrada = '2026-09-20' where id = $1`, [oc.id]);
      expect(semId(await parcelas(c, "p_importado", oc.id))).toEqual(base);
    });
  });

  it("D7 (decidido pelo dono 24/set): data futura ou anterior ao pedido é recusada em PT — pela RPC e por UPDATE direto", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const futura = (await um<{ d: string }>(c, `select to_char(current_date + 400, 'YYYY-MM-DD') d`)).d;
      const recusa = async (fn: () => Promise<unknown>, re: RegExp) => {
        await c.query("SAVEPOINT nota_d7");
        let msg = "(aceitou)";
        try { await fn(); } catch (e) { msg = String((e as Error).message); }
        await c.query("ROLLBACK TO SAVEPOINT nota_d7");
        expect(msg).toMatch(re);
      };
      await recusa(() => ocAviamento(c, fx, { data_nota_entrada: futura }), /não pode ser no futuro/);
      await recusa(() => ocAviamento(c, fx, { data_nota_entrada: "2026-08-31" }),
        /não pode ser anterior à data do pedido \(01\/09\/2026\)/);
      await recusa(() => ocPAcabado(c, fx, { data_nota_entrada: "2026-08-31" }), /anterior à data do pedido/);
      const id = await ocAviamento(c, fx, { data_nota_entrada: "2026-09-01" }); // = data do pedido: aceita
      expect(await notaDe(c, "ocs_aviamento", id)).toBe("2026-09-01");
      await recusa(() => c.query(`update public.ocs_aviamento set data_nota_entrada = $2::date where id = $1`, [id, futura]),
        /não pode ser no futuro/);
      await ocAviamento(c, fx, {}, id); // re-salvar SEM mudar a data não revalida
      expect(await notaDe(c, "ocs_aviamento", id)).toBe("2026-09-01");
    });
  });

  // ─────────────── Só com NOTA_MIG_TXN=1 (precisam do estado de ANTES da migration) ───────────────
  it.skipIf(!MIG_TXN)("sem a data = o de hoje, byte a byte (4 famílias, com e sem entrega, com paga e recálculo)", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      if ((await colunas(c)) !== 0) throw new Error("a cópia já tem a migration — este teste exige o estado de ANTES");
      await comoUsuario(c);
      const cenario = async () => {
        const fx = await fixtures(c);
        const tecA = await ocTecido(c, fx);
        await pagar(c, (await parcelas(c, "tecido", tecA))[0].id);
        await ocTecido(c, fx, { valor_real_total: 1200 }, tecA); // recálculo com paga
        const tecB = await ocTecido(c, fx, { numero_pedido: "NOTA-TEC-90003", data_entrega: null, prazo_pagamento: "30, 60" });
        const avi = await ocAviamento(c, fx);
        const ins = await ocInsumo(c, fx);
        const pa = await ocPAcabado(c, fx);
        await ocPAcabado(c, fx, { desconto_pct: 10 }, pa);
        return {
          tecA: semId(await parcelas(c, "tecido", tecA)), tecB: semId(await parcelas(c, "tecido", tecB)),
          avi: semId(await parcelas(c, "aviamento", avi)), ins: semId(await parcelas(c, "etiqueta", ins)),
          pa: semId(await parcelas(c, "p_acabado", pa)),
        };
      };
      await c.query("SAVEPOINT nota_hoje");
      const hoje = await cenario(); // funções de 24/set
      await c.query("ROLLBACK TO SAVEPOINT nota_hoje");
      await aplicarArquivo(c, MIG);
      const depois = await cenario(); // funções novas, payload SEM a chave
      expect(depois).toEqual(hoje);
      expect(hoje.tecA.length).toBe(3);
      expect(hoje.pa.length).toBe(2);
    });
  });

  it.skipIf(!MIG_TXN)("idempotente e ACL igual à de antes: aplicar 2× não muda as 10 funções", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      if ((await colunas(c)) !== 0) throw new Error("a cópia já tem a migration — este teste exige o estado de ANTES");
      const estado = async () => (await c.query(
        `select p.oid::regprocedure::text sig, md5(pg_get_functiondef(p.oid)) md5, coalesce(array_to_string(p.proacl, ','), '') acl
           from pg_proc p where p.oid = any ($1::regprocedure[]) order by 1`, [Object.keys(MD5_ANTES)])).rows as { sig: string; md5: string; acl: string }[];
      const antes = await estado();
      for (const r of antes) expect(r.md5).toBe(MD5_ANTES[`public.${r.sig}`] ?? MD5_ANTES[r.sig]);
      await aplicarArquivo(c, MIG);
      const d1 = await estado();
      expect(d1.map((r) => r.acl)).toEqual(antes.map((r) => r.acl)); // CREATE OR REPLACE + REVOKE reafirmado: ACL de antes
      await aplicarArquivo(c, MIG);
      expect(await estado()).toEqual(d1);
      expect(await colunas(c)).toBe(5);
      const n = await um<{ n: string }>(c, `select count(*) n from pg_trigger where not tgisinternal and tgname = 'trg_nota_entrada_recalc'`);
      expect(Number(n.n)).toBe(3);
      const v = await um<{ n: string }>(c, `select count(*) n from pg_trigger where not tgisinternal and tgname = 'trg_nota_entrada_valida'`);
      expect(Number(v.n)).toBe(5);
    });
  });

  it.skipIf(!MIG_TXN)("R2: função mudada por outra frente (ainda com data_nota_entrada) é RECUSADA pela migration e pelo inverso", async () => {
    await withTx(async (c) => {
      await prepara(c); // aplica a migration na txn
      const sig = "public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)";
      const def = (await um<{ d: string }>(c, `select pg_get_functiondef($1::regprocedure) d`, [sig])).d;
      expect(def).toContain("data_nota_entrada");
      exigeBancoLocal(); // DDL de teste: só na cópia
      await c.query(def.replace("AS $function$\n", "AS $function$\n-- mudança de outra frente (teste R2)\n"));
      await expect(aplicarArquivo(c, MIG)).rejects.toThrow(/nem no texto de 24\/set nem no desta migration/);
      await expect(aplicarArquivo(c, DOWN, "SET LOCAL app.confirmo_apagar_data_nota_entrada = 'sim'"))
        .rejects.toThrow(/foi mudada por outra frente/);
      expect(await colunas(c)).toBe(5); // as duas recusas não deixaram nada pela metade
    });
  });

  it.skipIf(!MIG_TXN)("inverso: recusa sem confirmação; com ela volta as 10 funções (md5 de 24/set) e a base ANTIGA das não pagas nas 4 famílias (R9-a/R9-b: funções → laço → gatilhos → repasse → colunas)", async () => {
    // R9-b: a ORDEM do arquivo (o laço antes das travas exclusivas; o repasse depois do DROP TRIGGER, antes das colunas)
    // R9-c: só CÓDIGO — as linhas de comentário saem antes (o cabeçalho do inverso cita "DROP TRIGGER/DROP COLUMN").
    const inv = readFileSync(ROOT + DOWN, "utf8").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    const pos = [
      "CREATE OR REPLACE FUNCTION public.gerar_parcelas_oc_tecido()", // passo 2 (a 1ª das 10 funções restauradas)
      "DO $volta$",                                                    // passo 3 (laço)
      "DROP TRIGGER IF EXISTS trg_nota_entrada_recalc ON public.ocs_tecido", // passo 4
      "DO $repasse$",                                                  // passo 4b
      "ALTER TABLE public.ocs_tecido DROP COLUMN",                     // passo 5
    ].map((m) => inv.indexOf(m));
    expect(pos.every((p) => p > 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    await withTx(async (c) => {
      await prepara(c); // aplica a migration na txn
      const fx = await fixtures(c);
      const id = await ocTecido(c, fx, { data_nota_entrada: "2026-09-05" });
      await pagar(c, (await parcelas(c, "tecido", id))[0].id);
      const paga = (await parcelas(c, "tecido", id))[0];
      // O laço roda com os gatilhos novos ainda no lugar (o do Acabado dispara pelo data_pedido) e passa pelas 4 famílias.
      // Todas com NF 05/09 ≠ base antiga: se o laço usasse o texto NOVO, o vencimento ficaria pela NF.
      const pa = await ocPAcabado(c, fx, { data_nota_entrada: "2026-09-05" });
      const avi = await ocAviamento(c, fx, { data_nota_entrada: "2026-09-05" });
      const ins = await ocInsumo(c, fx, { data_nota_entrada: "2026-09-05" });
      for (const [f, oc] of [["p_acabado", pa], ["aviamento", avi], ["etiqueta", ins]] as const) {
        expect({ f, v: (await parcelas(c, f, oc)).map((x) => x.venc) }).toEqual({ f, v: ["2026-10-05", "2026-11-04"] });
      }
      const [totAvi, totIns] = [await totalAviamento(c, avi), await totalInsumo(c, ins)];
      await expect(aplicarArquivo(c, DOWN)).rejects.toThrow(/confirmo_apagar_data_nota_entrada/);
      expect(await colunas(c)).toBe(5); // a recusa não deixou nada pela metade
      const avisos: string[] = [];
      const ouvir = (m: { message?: string }) => avisos.push(m.message ?? "");
      c.on("notice", ouvir);
      await aplicarArquivo(c, DOWN, "SET LOCAL app.confirmo_apagar_data_nota_entrada = 'sim'");
      c.removeListener("notice", ouvir);
      expect(avisos).toContain("data_nota_entrada (inverso): 0 OC(s) repassada(s) depois do DROP TRIGGER"); // o laço já pegou as 4
      expect(await colunas(c)).toBe(0);
      for (const [sig, md5] of Object.entries(MD5_ANTES)) {
        expect({ sig, md5: (await um<{ m: string }>(c, `select md5(pg_get_functiondef($1::regprocedure)) m`, [sig])).m }).toEqual({ sig, md5 });
      }
      const ocpa = await um<{ c: string }>(c,
        `select string_agg(a.attname, ',' order by a.attname) c from pg_trigger t
           join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[])
          where t.tgrelid = 'public.ocs_p_acabado'::regclass and t.tgname = 'trg_gerar_parcelas_ocpa'`);
      expect(ocpa.c).toBe("data_pedido,prazo_pagamento,valor_total_desconto");
      const p = await parcelas(c, "tecido", id);
      expect(p[0]).toEqual(paga);
      expect(p.slice(1).map((x) => x.venc)).toEqual(["2026-11-09", "2026-12-09"]); // base = entrega 10/09 + 60/90
      expect(centavos(p)).toBe(100000);
      const ppa = await parcelas(c, "p_acabado", pa);
      expect(ppa.map((x) => x.venc)).toEqual(["2026-10-01", "2026-10-31"]); // base = pedido 01/09 de novo
      expect(centavos(ppa)).toBe(100000);
      const pavi = await parcelas(c, "aviamento", avi);
      expect(pavi.map((x) => x.venc)).toEqual(["2026-10-10", "2026-11-09"]); // base = entrega 10/09 de novo
      expect(centavos(pavi)).toBe(totAvi);
      const pins = await parcelas(c, "etiqueta", ins);
      expect(pins.map((x) => x.venc)).toEqual(["2026-10-10", "2026-11-09"]);
      expect(centavos(pins)).toBe(totIns);
      await aplicarArquivo(c, MIG); // reaplicar depois de desfazer
      expect(await colunas(c)).toBe(5);
    });
  });

  it.skipIf(!MIG_TXN || !CAPTURA)("captura pg_get_functiondef DEPOIS (diff da Task 3) — só escreve arquivos locais", async () => {
    await withTx(async (c) => {
      await prepara(c);
      mkdirSync(CAPTURA, { recursive: true });
      const linhas: string[] = [];
      for (const sig of [...Object.keys(MD5_ANTES), ...NOVAS]) {
        const r = await um<{ d: string; m: string }>(c, `select pg_get_functiondef($1::regprocedure) d, md5(pg_get_functiondef($1::regprocedure)) m`, [sig]);
        writeFileSync(`${CAPTURA}/${sig.replace(/^public\./, "").split("(")[0]}.sql`, r.d);
        linhas.push(`${sig} ${r.m}`);
      }
      writeFileSync(`${CAPTURA}/md5-depois.txt`, linhas.join("\n") + "\n");
    });
  });

  // R9-b: mede o laço do inverso com VOLUME REAL (as OCs recebidas da cópia datadas, o conjunto do dia 1) numa transação que
  // é DESFEITA no fim (withTx → ROLLBACK): nenhuma parcela, OC, rev ou audit_log da cópia muda. A Task 4 confere com o
  // retrato só-leitura antes × depois. Tempos pelo relógio do SERVIDOR (clock_timestamp()).
  it.skipIf(!MIG_TXN || !MEDIR)("R9-b: mede o laço do inverso com as OCs recebidas da cópia DATADAS — numa txn DESFEITA (resíduo zero)", async () => {
    await withTx(async (c) => {
      exigeBancoLocal();
      await c.query("SET LOCAL transaction_timeout = '180s'"); // 1º SET da txn: é ele que vale — teto da medição (R9-c)
      const agora = async () => Number((await um<{ t: string }>(c, `select extract(epoch from clock_timestamp())::text t`)).t);
      const t0 = await agora();
      await prepara(c); // a migration na txn (sem BEGIN/COMMIT, nunca \i)
      const tIda = (await agora()) - t0;
      await c.query("SET LOCAL statement_timeout = '180s'");
      const hoje = `coalesce((select (now() at time zone coalesce(nullif(tc.timezone, ''), 'America/Sao_Paulo'))::date
                                from public.tenant_config tc where tc.tenant_id = o.tenant_id), (now() at time zone 'America/Sao_Paulo')::date)`;
      // Alvo = o que acende no dia 1 (recebida, sem data), dentro da D7 (pedido ≤ hoje). Data = a PRÓPRIA base de hoje.
      await c.query(`create temp table _nota_medida on commit drop as
        select 'tecido'::text tipo, o.id, greatest(least(coalesce(o.data_entrega, h.d), h.d), coalesce(o.data_pedido, '-infinity'::date)) nota
          from public.ocs_tecido o cross join lateral (select ${hoje} d) h
         where o.status = 'recebido' and not coalesce(o.is_rolo, false) and o.data_nota_entrada is null and (o.data_pedido is null or o.data_pedido <= h.d)
        union all
        select 'aviamento', o.id, greatest(least(coalesce(o.data_entrega, h.d), h.d), coalesce(o.data_pedido, '-infinity'::date))
          from public.ocs_aviamento o cross join lateral (select ${hoje} d) h
         where o.status = 'recebido' and o.data_nota_entrada is null and (o.data_pedido is null or o.data_pedido <= h.d)
        union all
        select 'etiqueta', o.id, greatest(least(coalesce(o.data_entrega, h.d), h.d), coalesce(o.data_pedido, '-infinity'::date))
          from public.ocs_etiqueta o cross join lateral (select ${hoje} d) h
         where o.status = 'recebido' and o.data_nota_entrada is null and (o.data_pedido is null or o.data_pedido <= h.d)
        union all
        select 'p_acabado', o.id, least(coalesce(o.data_pedido, h.d), h.d)
          from public.ocs_p_acabado o cross join lateral (select ${hoje} d) h
         where o.status = 'recebido' and o.data_nota_entrada is null and (o.data_pedido is null or o.data_pedido <= h.d)`);
      const fam = await um<{ t: string; a: string; e: string; p: string }>(c,
        `select count(*) filter (where tipo = 'tecido') t, count(*) filter (where tipo = 'aviamento') a,
                count(*) filter (where tipo = 'etiqueta') e, count(*) filter (where tipo = 'p_acabado') p from pg_temp._nota_medida`);
      const n = Number(fam.t) + Number(fam.a) + Number(fam.e) + Number(fam.p);
      // Σ por OC e as parcelas PAGAS — a volta tem de devolvê-los iguais
      const retrato = async () => (await c.query(
        `select m.tipo, m.id::text oc, coalesce(sum(round(p.valor * 100)), 0)::bigint::text centavos,
                coalesce(jsonb_agg(jsonb_build_array(p.id, p.numero_parcela, p.valor, p.data_vencimento, p.status, p.data_pagamento)
                           order by p.numero_parcela) filter (where p.status = 'pago' or p.data_pagamento is not null), '[]'::jsonb)::text pagas
           from pg_temp._nota_medida m
           left join public.parcelas p on m.id = coalesce(p.oc_tecido_id, p.oc_aviamento_id, p.oc_etiqueta_id, p.oc_p_acabado_id)
          group by 1, 2 order by 1, 2`)).rows;
      const antes = await retrato();
      const t1 = await agora();
      await c.query(`update public.ocs_tecido o set data_nota_entrada = m.nota from pg_temp._nota_medida m where m.tipo = 'tecido' and m.id = o.id;
        update public.ocs_aviamento o set data_nota_entrada = m.nota from pg_temp._nota_medida m where m.tipo = 'aviamento' and m.id = o.id;
        update public.ocs_etiqueta o set data_nota_entrada = m.nota from pg_temp._nota_medida m where m.tipo = 'etiqueta' and m.id = o.id;
        update public.ocs_p_acabado o set data_nota_entrada = m.nota from pg_temp._nota_medida m where m.tipo = 'p_acabado' and m.id = o.id;`);
      const t2 = await agora();
      await aplicarArquivo(c, MIG); // a IDA de novo, agora com as OCs datadas (idempotente): não pode crescer com os dados
      const t3 = await agora();
      await aplicarArquivo(c, DOWN, "SET LOCAL app.confirmo_apagar_data_nota_entrada = 'sim'");
      const t4 = await agora();
      const tVolta = t4 - t3;
      const ttInverso = Number(/^SET LOCAL transaction_timeout = '(\d+)s';$/m.exec(readFileSync(ROOT + DOWN, "utf8"))?.[1] ?? NaN);
      const med: Record<string, string | number> = {
        modo: "txn-desfeita", medido_em: new Date().toISOString(), n_familias: `${fam.t}|${fam.a}|${fam.e}|${fam.p}`, n_copia: n,
        t_ida_txn: tIda.toFixed(3), t_datar: (t2 - t1).toFixed(3), t_ida_datada: (t3 - t2).toFixed(3), t_volta: tVolta.toFixed(3),
        s_por_oc: (n > 0 ? tVolta / n : tVolta).toFixed(4), tt_minimo: Math.max(30, Math.ceil(5 * tVolta)), tt_inverso: ttInverso,
      };
      writeFileSync(MEDIR, Object.entries(med).map(([k, v]) => `${k}=${v}`).join("\n") + "\n"); // grava ANTES de conferir
      console.log(`[R9-b] ${n} OC(s) datada(s) (tecido|aviamento|insumo|p.acabado = ${med.n_familias}) · datar ${med.t_datar}s · ` +
        `ida ${med.t_ida_txn}s / com datas ${med.t_ida_datada}s · volta ${med.t_volta}s (≈ ${med.s_por_oc}s por OC) → ` +
        `mínimo ${med.tt_minimo}s; o inverso tem ${ttInverso}s`);
      expect(n).toBeGreaterThan(0); // sem volume a medição não vale
      expect(await colunas(c)).toBe(0);
      expect(await retrato()).toEqual(antes); // Σ por OC e as pagas iguais depois da volta (na txn; o ROLLBACK desfaz tudo)
    });
  }, 5 * 60_000);
});
```

- [ ] **Step 2: Rodar SÓ na cópia e ver falhar (a migration ainda não existe)** — pré-voo R4 antes (dono avisado; `:5188` congela)

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada"
NOTA_DONO_AVISADO=sim bash .superpowers/nota/prevoo-copia.sh t2s2 || exit 1
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres NOTA_MIG_TXN=1 \
  npx vitest run --no-file-parallelism tests/integration/nota-entrada.test.ts 2>&1 | tail -15
```

Expected: FAIL nos testes que aplicam a migration com `ENOENT … 20261002100000_oc_data_nota_entrada.sql`; nenhum "there is no transaction in progress". Sem `DATABASE_URL` da cópia a suíte PULA inteira (nunca roda contra produção) — conferir também: `env -u DATABASE_URL npx vitest run tests/integration/nota-entrada.test.ts` → `skipped`.

- [ ] **Step 3: Sem commit ainda** — a Task 3 commita os dois juntos (a suíte só fica verde com a migration).

---

## Task 3: Migration + inverso, GERADOS do texto vivo  *(individual Opus, JUNTO com a Task 2)*

**Files:**
- Create (não versionados): `.superpowers/nota/mig/dump_antes.sh`, `.superpowers/nota/mig/gerar_sql.py`
- Create (gerados, versionados): `supabase/migrations/20261002100000_oc_data_nota_entrada.sql`, `supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql`
- Test: `tests/integration/nota-entrada.test.ts` (Task 2)

**Interfaces:**
- Consumes: o texto vivo das 10 funções na cópia (md5 = spec §3.1).
- Produces: as colunas `data_nota_entrada date` nas 5 tabelas; `fn_oc_nota_entrada_recalc()` + gatilhos `trg_nota_entrada_recalc` (tecido/aviamento/etiqueta); `fn_oc_nota_entrada_valida()` + gatilhos `trg_nota_entrada_valida` BEFORE INSERT OR UPDATE OF `data_nota_entrada` nas 5 (D7 — P0001 em PT); `trg_gerar_parcelas_ocpa` escutando a coluna; os 5 saves aceitando a chave `data_nota_entrada` (`_oc` em Tecido/Aviamento/Insumo; `_dados` em P. Acabado/Importado): ausente = mantém, `""`/`null` = limpa. É o contrato que as Tasks 6–10 usam. E `.superpowers/nota/mig/md5-antes.txt` (10) e `md5-depois.txt` (12), que os scripts do ensaio e da produção conferem.

- [ ] **Step 1: Script de leitura** — `.superpowers/nota/mig/dump_antes.sh`:

```bash
#!/usr/bin/env bash
# Lê (SÓ LEITURA) o texto vivo das 10 funções na CÓPIA LOCAL — nunca produção. Saída: .superpowers/nota/mig/antes/*.sql
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
D=.superpowers/nota/mig/antes
mkdir -p "$D"
for sig in 'gerar_parcelas_oc_tecido()' 'gerar_parcelas_oc_aviamento()' 'gerar_parcelas_oc_p_acabado()' \
           '_recalcular_parcelas_core(uuid,text)' 'recalcular_parcelas_etiqueta(uuid)' \
           '_salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)' '_salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)' \
           'salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)' '_salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)' \
           '_salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)'; do
  PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -v ON_ERROR_STOP=1 \
    -c "select pg_get_functiondef('public.$sig'::regprocedure)" > "$D/${sig%%(*}.sql"
done
ls -1 "$D" | wc -l | tr -d ' ' | sed 's/^/arquivos: /'
```

- [ ] **Step 2: Gerador** — `.superpowers/nota/mig/gerar_sql.py` (o diff mínimo mora em `TROCAS`; cada par casa exatamente 1 vez ou o script recusa; as 2 funções novas estão no formato canônico de `pg_get_functiondef`, e o md5 "depois" de todas vai para a guarda exata — R2):

```python
#!/usr/bin/env python3
"""Gera a migration e o inverso da "Data da Nota de Entrada" a partir do texto VIVO das 10 funções (cópia local).

Uso (na raiz da worktree, depois de `bash .superpowers/nota/mig/dump_antes.sh`):
    python3 .superpowers/nota/mig/gerar_sql.py [--tt-inverso SEGUNDOS]
    --tt-inverso (R9-a): transaction_timeout do INVERSO (padrão 30, mínimo 30; a Task 4 mede e pode subir). A IDA fica
    SEMPRE em 3 s. Regenerar o arquivo commitado byte a byte = passar o MESMO valor (está no cabeçalho do inverso).
Escreve:
    supabase/migrations/20261002100000_oc_data_nota_entrada.sql
    supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql
    .superpowers/nota/mig/depois-esperado/<nome>.sql   (texto que a migration instala)
    .superpowers/nota/mig/diff-esperado.txt            (diff antes → depois; tem de bater com o plano, Task 3)
    .superpowers/nota/mig/md5-antes.txt                (10 linhas "public.sig md5" — texto de 24/set)
    .superpowers/nota/mig/md5-depois-esperado.txt      (12 linhas: as 10 + as 2 funções novas — o que a migration instala)
Recusa (sai ≠ 0) se o texto vivo de alguma função não tiver o md5 do levantamento de 24/set ou se alguma troca não casar
exatamente 1 vez. NUNCA edite os .sql gerados à mão — regenere.
"""
import argparse
import difflib
import hashlib
import os
import re
import subprocess
import sys

ROOT = os.environ.get("NOTA_ROOT") or subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
M = os.path.join(ROOT, ".superpowers/nota/mig")
MIG = os.path.join(ROOT, "supabase/migrations/20261002100000_oc_data_nota_entrada.sql")
DOWN = os.path.join(ROOT, "supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql")

# (assinatura regprocedure, md5(pg_get_functiondef) na cópia em 24/set = produção em 23/set)
FUNCS = [
    ("gerar_parcelas_oc_tecido()", "ac9fb224249f42133f5bf2750aba5d1c"),
    ("gerar_parcelas_oc_aviamento()", "345e55d865a0e4713e6ccbc62f50830d"),
    ("gerar_parcelas_oc_p_acabado()", "1d8286d877f32a437b344a0da1766ccb"),
    ("_recalcular_parcelas_core(uuid,text)", "b8af65bc500958202db25ddb5f3d3eed"),
    ("recalcular_parcelas_etiqueta(uuid)", "d60ab89c8c25a830aa7a7789ff97eef0"),
    ("_salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)", "b5255dc864f0e7f9f39236b4b9c531d6"),
    ("_salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)", "56af6c8a9ecb5619be2de1f2068553b3"),
    ("salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)", "d92d27b1d774ca4d867fc9151f774fda"),
    ("_salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)", "bd8139b1a1b1dee8b4b90e4327cb152c"),
    ("_salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)", "b74cd38a16fa08482551f1fb7e1487bb"),
]
# Internas com EXECUTE revogado de PUBLIC/anon/authenticated (invariante #9). As outras 4 redefinidas mantêm o ACL de hoje.
INTERNAS = [
    "fn_oc_nota_entrada_recalc()",
    "fn_oc_nota_entrada_valida()",
    "_recalcular_parcelas_core(uuid,text)",
    "recalcular_parcelas_etiqueta(uuid)",
    "_salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)",
    "_salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)",
    "_salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)",
    "_salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)",
    "gerar_parcelas_oc_tecido()",
    "gerar_parcelas_oc_aviamento()",
]
TT_INVERSO_PADRAO = 30  # R9-a: segundos; mínimo aceito
INTERNAS_REVOKE = INTERNAS[:8]  # as 2 geradoras já estão revogadas hoje; só conferidas na pós-condição

C_BASE = ("-- Data da Nota de Entrada (24/set): com ela, o prazo conta a partir dela; "
          "sem ela, a base antiga (vencimento provisório).")


def case(var: str) -> str:
    return (f"      data_nota_entrada = CASE WHEN {var} ? 'data_nota_entrada' THEN NULLIF({var}->>'data_nota_entrada', '')::date "
            f"ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém")


# Diff mínimo: cada par (antes, depois) tem de casar EXATAMENTE 1 vez no texto vivo.
TROCAS = {
    "gerar_parcelas_oc_tecido()": [
        ("    v_base_data := COALESCE(NEW.data_entrega, CURRENT_DATE);\n",
         "    " + C_BASE + "\n    v_base_data := COALESCE(NEW.data_nota_entrada, NEW.data_entrega, CURRENT_DATE);\n")],
    "gerar_parcelas_oc_aviamento()": [
        ("    v_base_data := COALESCE(NEW.data_entrega, CURRENT_DATE);\n",
         "    " + C_BASE + "\n    v_base_data := COALESCE(NEW.data_nota_entrada, NEW.data_entrega, CURRENT_DATE);\n")],
    "gerar_parcelas_oc_p_acabado()": [
        ("  v_base_data := coalesce(NEW.data_pedido, current_date);\n",
         "  " + C_BASE + "\n  v_base_data := coalesce(NEW.data_nota_entrada, NEW.data_pedido, current_date);\n")],
    "_recalcular_parcelas_core(uuid,text)": [
        ("  v_data_entrega date;\n",
         "  v_data_entrega date;\n  v_data_nota date;  -- Data da Nota de Entrada (24/set): quando preenchida, é a base do vencimento.\n"),
        ("           prazo_pagamento, COALESCE(valor_real_total,0)\n"
         "      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos, v_prazo_pagamento, v_valor_total\n",
         "           prazo_pagamento, COALESCE(valor_real_total,0), data_nota_entrada\n"
         "      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos, v_prazo_pagamento, v_valor_total, v_data_nota\n"),
        ("    SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1), prazo_pagamento\n"
         "      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos, v_prazo_pagamento\n"
         "    FROM public.ocs_aviamento WHERE id = _oc_id;\n",
         "    SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1), prazo_pagamento, data_nota_entrada\n"
         "      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos, v_prazo_pagamento, v_data_nota\n"
         "    FROM public.ocs_aviamento WHERE id = _oc_id;\n"),
        ("    SELECT tenant_id, empresa_id, data_pedido, prazo_pagamento, COALESCE(valor_total_desconto,0)\n"
         "      INTO v_tenant, v_empresa, v_data_entrega, v_prazo_pagamento, v_valor_total\n",
         "    SELECT tenant_id, empresa_id, data_pedido, prazo_pagamento, COALESCE(valor_total_desconto,0), data_nota_entrada\n"
         "      INTO v_tenant, v_empresa, v_data_entrega, v_prazo_pagamento, v_valor_total, v_data_nota\n"),
        ("  v_base_data := COALESCE(v_data_entrega, CURRENT_DATE);\n",
         "  " + C_BASE + "\n  v_base_data := COALESCE(v_data_nota, v_data_entrega, CURRENT_DATE);\n")],
    "recalcular_parcelas_etiqueta(uuid)": [
        ("  v_tenant uuid; v_empresa uuid; v_data_entrega date; v_qprazos int; v_prazo text;\n",
         "  v_tenant uuid; v_empresa uuid; v_data_entrega date; v_qprazos int; v_prazo text; v_nota date;\n"),
        ("  SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1), prazo_pagamento\n"
         "    INTO v_tenant, v_empresa, v_data_entrega, v_qprazos, v_prazo FROM public.ocs_etiqueta WHERE id = _oc_id;\n",
         "  SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1), prazo_pagamento, data_nota_entrada\n"
         "    INTO v_tenant, v_empresa, v_data_entrega, v_qprazos, v_prazo, v_nota FROM public.ocs_etiqueta WHERE id = _oc_id;\n"),
        ("  v_base := COALESCE(v_data_entrega, CURRENT_DATE);\n",
         "  " + C_BASE + "\n  v_base := COALESCE(v_nota, v_data_entrega, CURRENT_DATE);\n")],
    "_salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)": [
        ("       parcelas_recebimento, valor_previsto_total, valor_real_total, status)\n",
         "       parcelas_recebimento, valor_previsto_total, valor_real_total, status, data_nota_entrada)\n"),
        ("       'encomendado')\n    RETURNING id INTO v_oc_id;\n",
         "       'encomendado', NULLIF(_oc->>'data_nota_entrada', '')::date)\n    RETURNING id INTO v_oc_id;\n"),
        ("      status = v_status\n    WHERE id = v_oc_id;\n",
         case("_oc") + "\n      status = v_status\n    WHERE id = v_oc_id;\n")],
    "_salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)": [
        ("       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, parcelas_recebimento, status)\n",
         "       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, parcelas_recebimento, status, data_nota_entrada)\n"),
        ("       COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb), 'encomendado')\n",
         "       COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb), 'encomendado', NULLIF(_oc->>'data_nota_entrada', '')::date)\n"),
        ("      status = v_status\n    WHERE id = v_oc_id;\n",
         case("_oc") + "\n      status = v_status\n    WHERE id = v_oc_id;\n")],
    "salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)": [
        ("       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, nfs, parcelas_recebimento, status)\n",
         "       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, nfs, parcelas_recebimento, status, data_nota_entrada)\n"),
        ("       COALESCE(_oc->'nfs','[]'::jsonb), COALESCE(_oc->'parcelas_recebimento','[]'::jsonb), 'encomendado')\n",
         "       COALESCE(_oc->'nfs','[]'::jsonb), COALESCE(_oc->'parcelas_recebimento','[]'::jsonb), 'encomendado',\n"
         "       NULLIF(_oc->>'data_nota_entrada', '')::date)\n"),
        ("      status = v_status\n    WHERE id = v_oc_id;\n",
         case("_oc") + "\n      status = v_status\n    WHERE id = v_oc_id;\n")],
    "_salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)": [
        ("      anexo_pedido_url, anexo_nf_url\n    ) values (\n",
         "      anexo_pedido_url, anexo_nf_url, data_nota_entrada\n    ) values (\n"),
        ("      _dados->>'anexo_pedido_url', _dados->>'anexo_nf_url'\n    ) returning id into v_id;\n",
         "      _dados->>'anexo_pedido_url', _dados->>'anexo_nf_url', nullif(_dados->>'data_nota_entrada', '')::date\n"
         "    ) returning id into v_id;\n"),
        ("      anexo_nf_url = _dados->>'anexo_nf_url',\n      updated_at = now()\n",
         "      anexo_nf_url = _dados->>'anexo_nf_url',\n" + case("_dados") + "\n      updated_at = now()\n")],
    "_salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)": [
        ("      desconto_pct, cotacao_final\n    ) values (\n",
         "      desconto_pct, cotacao_final, data_nota_entrada\n    ) values (\n"),
        ("      v_desconto_pct, coalesce(nullif(_dados->>'cotacao_final', '')::numeric, 0)\n    ) returning id into v_id;\n",
         "      v_desconto_pct, coalesce(nullif(_dados->>'cotacao_final', '')::numeric, 0), nullif(_dados->>'data_nota_entrada', '')::date\n"
         "    ) returning id into v_id;\n"),
        ("      cotacao_final = coalesce(nullif(_dados->>'cotacao_final', '')::numeric, 0),\n      updated_at = now()\n",
         "      cotacao_final = coalesce(nullif(_dados->>'cotacao_final', '')::numeric, 0),\n" + case("_dados")
         + "\n      updated_at = now()\n")],
}

TABELAS = ["ocs_tecido", "ocs_aviamento", "ocs_etiqueta", "ocs_p_acabado", "ocs_importado"]

# Funções NOVAS no formato canônico de pg_get_functiondef (o md5 "depois" delas é o deste texto; a Task 3 Step 5 confere).
FN_RECALC = """CREATE OR REPLACE FUNCTION public.fn_oc_nota_entrada_recalc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Data da Nota de Entrada (24/set): recalcula pela base nova com a MESMA função do "Recalcular Parcelas" — pagas
  -- intactas, soma = total. Na TRANSIÇÃO para recebido quem gera é o gerador (que já lê a data).
  IF TG_TABLE_NAME = 'ocs_tecido' THEN
    PERFORM public._recalcular_parcelas_core(NEW.id, 'tecido');
  ELSIF TG_TABLE_NAME = 'ocs_aviamento' THEN
    PERFORM public._recalcular_parcelas_core(NEW.id, 'aviamento');
  ELSIF TG_TABLE_NAME = 'ocs_etiqueta' THEN
    PERFORM public.recalcular_parcelas_etiqueta(NEW.id);
  END IF;
  RETURN NULL;
END;
$function$
"""
FN_VALIDA = """CREATE OR REPLACE FUNCTION public.fn_oc_nota_entrada_valida()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje date;
BEGIN
  -- Data da Nota de Entrada (24/set) — D7, PENDENTE DO DONO (recomendação): não pode ser FUTURA (hoje no fuso da loja)
  -- nem ANTERIOR à data do pedido da OC. Só valida quando a data MUDA (linhas antigas e saves sem mudança passam).
  -- Mensagens = as do front (src/lib/nota-entrada.ts, validarDataNota). P0001: o erro-mensagem.ts mostra o texto.
  IF NEW.data_nota_entrada IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.data_nota_entrada IS NOT DISTINCT FROM OLD.data_nota_entrada THEN
    RETURN NEW;
  END IF;
  SELECT (now() AT TIME ZONE coalesce(nullif(tc.timezone, ''), 'America/Sao_Paulo'))::date INTO v_hoje
    FROM public.tenant_config tc WHERE tc.tenant_id = NEW.tenant_id;
  v_hoje := coalesce(v_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  IF NEW.data_nota_entrada > v_hoje THEN
    RAISE EXCEPTION 'A Data da Nota de Entrada (%) não pode ser no futuro.', to_char(NEW.data_nota_entrada, 'DD/MM/YYYY')
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.data_pedido IS NOT NULL AND NEW.data_nota_entrada < NEW.data_pedido THEN
    RAISE EXCEPTION 'A Data da Nota de Entrada (%) não pode ser anterior à data do pedido (%).',
      to_char(NEW.data_nota_entrada, 'DD/MM/YYYY'), to_char(NEW.data_pedido, 'DD/MM/YYYY') USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$
"""
NOVAS = [("fn_oc_nota_entrada_recalc()", FN_RECALC), ("fn_oc_nota_entrada_valida()", FN_VALIDA)]
COMENTARIO = {
    "ocs_tecido": "Data da Nota de Entrada (NF do fornecedor). Base do vencimento das parcelas a pagar: COALESCE(data_nota_entrada, data_entrega). Vazia em OC recebida = vencimento provisório.",
    "ocs_aviamento": "Data da Nota de Entrada (NF do fornecedor). Base do vencimento das parcelas a pagar: COALESCE(data_nota_entrada, data_entrega). Vazia em OC recebida = vencimento provisório.",
    "ocs_etiqueta": "Data da Nota de Entrada (NF do fornecedor). Base do vencimento das parcelas a pagar: COALESCE(data_nota_entrada, data_entrega). Vazia em OC recebida = vencimento provisório.",
    "ocs_p_acabado": "Data da Nota de Entrada (NF do fornecedor). Base do vencimento das parcelas a pagar: COALESCE(data_nota_entrada, data_pedido). Vazia em OC recebida = vencimento provisório.",
    "ocs_importado": "Data da Nota de Entrada (NF do fornecedor). Só registro — os vencimentos seguem as etapas de câmbio.",
}


def nome(sig: str) -> str:
    return sig.split("(", 1)[0]


def md5(t: str) -> str:
    return hashlib.md5(t.encode("utf-8")).hexdigest()


def sql_list(items):
    return ",\n    ".join(items)


def main() -> int:
    ap = argparse.ArgumentParser(description="Gera a migration e o inverso da Data da Nota de Entrada (plano, Task 3).")
    ap.add_argument("--tt-inverso", type=int, default=TT_INVERSO_PADRAO, metavar="SEGUNDOS",
                    help="transaction_timeout do INVERSO em segundos (R9-a; padrão e mínimo 30). A ida fica em 3 s.")
    tt_inverso = ap.parse_args().tt_inverso
    if tt_inverso < TT_INVERSO_PADRAO:
        print(f"RECUSADO: --tt-inverso {tt_inverso} < {TT_INVERSO_PADRAO} (R9-a: o laço do inverso cresce com as OCs datadas)",
              file=sys.stderr)
        return 1
    antes, depois, diffs = {}, {}, []
    for sig, md5_antes in FUNCS:
        arq = os.path.join(M, "antes", nome(sig) + ".sql")
        txt = open(arq, encoding="utf-8").read().rstrip("\n") + "\n"  # psql -At acrescenta 1 \n ao texto
        if md5(txt) != md5_antes:
            print(f"RECUSADO: {sig} mudou desde 24/set (md5 {md5(txt)} ≠ {md5_antes}) — PARE e avise o controlador", file=sys.stderr)
            return 1
        novo = txt
        for a, b in TROCAS[sig]:
            n = novo.count(a)
            if n != 1:
                print(f"RECUSADO: {sig}: trecho casou {n} vezes (esperado 1): {a[:70]!r}", file=sys.stderr)
                return 1
            novo = novo.replace(a, b)
        antes[sig], depois[sig] = txt, novo
        diffs.append("\n".join(difflib.unified_diff(txt.splitlines(), novo.splitlines(),
                                                    f"antes/{sig}", f"depois/{sig}", lineterm="", n=0)))
    os.makedirs(os.path.join(M, "depois-esperado"), exist_ok=True)
    for sig, t in depois.items():
        open(os.path.join(M, "depois-esperado", nome(sig) + ".sql"), "w", encoding="utf-8").write(t)
    open(os.path.join(M, "diff-esperado.txt"), "w", encoding="utf-8").write("\n\n".join(diffs) + "\n")
    for sig, t in NOVAS:
        open(os.path.join(M, "depois-esperado", nome(sig) + ".sql"), "w", encoding="utf-8").write(t)
    md5_depois = {sig: md5(depois[sig]) for sig, _ in FUNCS}
    md5_depois.update({sig: md5(t) for sig, t in NOVAS})
    open(os.path.join(M, "md5-antes.txt"), "w", encoding="utf-8").write(
        "".join(f"public.{sig} {m}\n" for sig, m in FUNCS))
    open(os.path.join(M, "md5-depois-esperado.txt"), "w", encoding="utf-8").write(
        "".join(f"public.{sig} {md5_depois[sig]}\n" for sig, _ in FUNCS + [(s, None) for s, _ in NOVAS]))

    # R2 do G-plano: a guarda aceita SÓ o md5 EXATO de 24/set (antes) ou o desta migration (depois) — nada de "contém a string".
    guarda_valores = sql_list([f"('public.{sig}', '{m}', '{md5_depois[sig]}')" for sig, m in FUNCS]
                              + [f"('public.{sig}', NULL, '{md5_depois[sig]}')" for sig, _ in NOVAS])
    depois_valores = sql_list([f"('public.{sig}', '{md5_depois[sig]}')" for sig, _ in FUNCS]
                              + [f"('public.{sig}', '{md5_depois[sig]}')" for sig, _ in NOVAS])
    antes_valores = sql_list([f"('public.{sig}', '{m}')" for sig, m in FUNCS])
    internas = ", ".join(f"'public.{s}'" for s in INTERNAS)

    mig = []
    mig.append(f"""-- Data da Nota de Entrada nas 5 OCs (Tecido, Aviamento, Insumo, P. Acabado, P. Importado).
-- Desenho aprovado pelo dono em 24/set/2026. Spec: docs/superpowers/specs/2026-09-24-data-nota-entrada-design.md
-- Plano: docs/superpowers/plans/2026-09-24-data-nota-entrada.md (Task 3).
-- ARQUIVO GERADO por .superpowers/nota/mig/gerar_sql.py a partir do texto VIVO das 10 funções (cópia local = produção em
-- 23/set) + o diff mínimo do plano. NÃO editar à mão — regenerar.
--
--  1. coluna data_nota_entrada date nas 5 tabelas de OC;
--  2. base do vencimento = COALESCE(data_nota_entrada, base de hoje) nos geradores/recálculos de Tecido, Aviamento, Insumo e
--     P. Acabado. O Importado NÃO muda (vencimento = etapas de câmbio; a data só é registrada);
--  3. os 5 saves gravam a chave data_nota_entrada do jsonb (chave ausente = mantém; "" ou null = limpa);
--  4. mudar a data numa OC já recebida recalcula as NÃO pagas (pagas intactas, soma = total da OC);
--  5. D7 (PENDENTE DO DONO — recomendação): gatilho que recusa data futura ou anterior ao pedido, nas 5 OCs;
--  6. ACL (invariante #9).
-- TRAVAS NO ARQUIVO (R9 — lição do Aviso Global): `SET LOCAL lock_timeout = '500ms'` + `SET LOCAL transaction_timeout =
-- '3s'` logo depois do `BEGIN;`, porque `psql -f` é o caminho padrão do CLAUDE.md. O caminho DESTA frente continua sendo o
-- aplica_v2 (R3 — reinjeta as mesmas 2 linhas, redundante e inofensivo, e dá a nova tentativa). Horário calmo.
-- TRAVAS QUE A MIGRATION PEGA: ALTER TABLE ADD COLUMN = AccessExclusive nas 5 OCs até o COMMIT (e ShareRowExclusive dos
-- CREATE/DROP TRIGGER); as policies de OUTRAS tabelas que leem as OCs (enderecamento_tecido endtec_ins/endtec_upd,
-- ocs_tecido_itens, ocs_aviamento_itens, ocs_etiqueta_itens — cópia, 24/set) esperam junto. NÃO há DDL de policy (nenhum
-- CREATE/DROP/ALTER POLICY): o hook supautils.policy_grants (AccessExclusive em 24 tabelas de auth/storage/realtime até o
-- COMMIT) NÃO dispara. Se um dia entrar DDL de policy aqui: vai no FIM do arquivo e este cabeçalho deixa de dizer isso.
-- Inverso: supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql (DESTRUTIVO: apaga as datas digitadas).
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

-- 0) Guarda (R2 do G-plano): cada função está EXATAMENTE no texto de 24/set (md5_antes) ou no desta migration
--    (md5_depois = reaplicação). Qualquer outro texto = outra frente mudou depois → recusa (nada é aplicado).
DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    {guarda_valores}
  ) AS t(sig, md5_antes, md5_depois) LOOP
    IF to_regprocedure(r.sig) IS NULL THEN
      IF r.md5_antes IS NOT NULL THEN
        RAISE EXCEPTION 'data_nota_entrada: % não existe neste banco', r.sig USING ERRCODE = 'P0001';
      END IF;
      CONTINUE;  -- função nova desta migration ainda não criada
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.sig)));
    CONTINUE WHEN v_md5 = r.md5_depois;
    IF r.md5_antes IS NULL OR v_md5 <> r.md5_antes THEN
      RAISE EXCEPTION 'data_nota_entrada: % não está nem no texto de 24/set nem no desta migration (md5 %) — outra frente mudou; regenerar a migration a partir do texto VIVO (plano, Task 3) antes de aplicar',
        r.sig, v_md5 USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- 1) Coluna nas 5 OCs (sem default, sem backfill)
""")
    for t in TABELAS:
        mig.append(f"ALTER TABLE public.{t} ADD COLUMN IF NOT EXISTS data_nota_entrada date;\n")
    for t in TABELAS:
        mig.append(f"COMMENT ON COLUMN public.{t}.data_nota_entrada IS '{COMENTARIO[t]}';\n")
    mig.append("\n-- 2) e 3) As 10 funções: texto de 24/set + diff mínimo (.superpowers/nota/mig/diff-esperado.txt)\n")
    for sig, _ in FUNCS:
        mig.append(depois[sig].rstrip("\n") + ";\n\n")
    mig.append("-- 4) Recalcular as NÃO pagas quando a data muda numa OC JÁ recebida (qualquer caminho: RPC ou UPDATE direto)\n")
    mig.append(FN_RECALC.rstrip("\n") + ";\n\n")
    mig.append("""DROP TRIGGER IF EXISTS trg_nota_entrada_recalc ON public.ocs_tecido;
CREATE TRIGGER trg_nota_entrada_recalc AFTER UPDATE OF data_nota_entrada ON public.ocs_tecido
  FOR EACH ROW WHEN (OLD.status = 'recebido' AND NEW.status = 'recebido'
                     AND OLD.data_nota_entrada IS DISTINCT FROM NEW.data_nota_entrada
                     AND NOT COALESCE(NEW.is_rolo, false))
  EXECUTE FUNCTION public.fn_oc_nota_entrada_recalc();
DROP TRIGGER IF EXISTS trg_nota_entrada_recalc ON public.ocs_aviamento;
CREATE TRIGGER trg_nota_entrada_recalc AFTER UPDATE OF data_nota_entrada ON public.ocs_aviamento
  FOR EACH ROW WHEN (OLD.status = 'recebido' AND NEW.status = 'recebido'
                     AND OLD.data_nota_entrada IS DISTINCT FROM NEW.data_nota_entrada)
  EXECUTE FUNCTION public.fn_oc_nota_entrada_recalc();
DROP TRIGGER IF EXISTS trg_nota_entrada_recalc ON public.ocs_etiqueta;
CREATE TRIGGER trg_nota_entrada_recalc AFTER UPDATE OF data_nota_entrada ON public.ocs_etiqueta
  FOR EACH ROW WHEN (OLD.status = 'recebido' AND NEW.status = 'recebido'
                     AND OLD.data_nota_entrada IS DISTINCT FROM NEW.data_nota_entrada)
  EXECUTE FUNCTION public.fn_oc_nota_entrada_recalc();

-- P. Acabado: o gerador já regenera as não pagas a cada save (parcelas nascem no pedido); passa a escutar a data também.
DROP TRIGGER IF EXISTS trg_gerar_parcelas_ocpa ON public.ocs_p_acabado;
CREATE TRIGGER trg_gerar_parcelas_ocpa
  AFTER INSERT OR UPDATE OF valor_total_desconto, prazo_pagamento, data_pedido, data_nota_entrada ON public.ocs_p_acabado
  FOR EACH ROW EXECUTE FUNCTION public.gerar_parcelas_oc_p_acabado();

-- 5) D7 (PENDENTE DO DONO — recomendação): data implausível recusada no SERVIDOR, nas 5 OCs (RPC ou UPDATE direto).
""")
    mig.append(FN_VALIDA.rstrip("\n") + ";\n\n")
    for t in TABELAS:
        mig.append(f"DROP TRIGGER IF EXISTS trg_nota_entrada_valida ON public.{t};\n"
                   f"CREATE TRIGGER trg_nota_entrada_valida BEFORE INSERT OR UPDATE OF data_nota_entrada ON public.{t}\n"
                   f"  FOR EACH ROW EXECUTE FUNCTION public.fn_oc_nota_entrada_valida();\n")
    mig.append("""
-- 6) ACL (#9): internas sem EXECUTE para PUBLIC/anon/authenticated (CREATE OR REPLACE preserva o ACL; aqui reafirma).
""")
    for s in INTERNAS_REVOKE:
        mig.append(f"REVOKE EXECUTE ON FUNCTION public.{s} FROM PUBLIC, anon, authenticated;\n")
    mig.append(f"""
-- 7) Pós-condição (falha alto e desfaz tudo se algo não ficou como o plano)
DO $pos$
DECLARE
  v_n int;
  v_sig text;
  r record;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'data_nota_entrada'
     AND table_name IN ('ocs_tecido', 'ocs_aviamento', 'ocs_etiqueta', 'ocs_p_acabado', 'ocs_importado');
  IF v_n <> 5 THEN RAISE EXCEPTION 'data_nota_entrada: esperado 5 colunas, achei %', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE NOT tgisinternal AND tgname = 'trg_nota_entrada_recalc'
     AND tgrelid IN ('public.ocs_tecido'::regclass, 'public.ocs_aviamento'::regclass, 'public.ocs_etiqueta'::regclass);
  IF v_n <> 3 THEN RAISE EXCEPTION 'data_nota_entrada: esperado 3 gatilhos trg_nota_entrada_recalc, achei %', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE NOT tgisinternal AND tgname = 'trg_nota_entrada_valida'
     AND tgrelid IN ('public.ocs_tecido'::regclass, 'public.ocs_aviamento'::regclass, 'public.ocs_etiqueta'::regclass,
                     'public.ocs_p_acabado'::regclass, 'public.ocs_importado'::regclass);
  IF v_n <> 5 THEN RAISE EXCEPTION 'data_nota_entrada: esperado 5 gatilhos trg_nota_entrada_valida, achei %', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])
                  WHERE t.tgrelid = 'public.ocs_p_acabado'::regclass AND t.tgname = 'trg_gerar_parcelas_ocpa'
                    AND a.attname = 'data_nota_entrada') THEN
    RAISE EXCEPTION 'data_nota_entrada: trg_gerar_parcelas_ocpa não escuta a coluna nova';
  END IF;
  FOREACH v_sig IN ARRAY ARRAY[{internas}] LOOP
    IF has_function_privilege('anon', v_sig, 'EXECUTE') OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'data_nota_entrada: % executável por anon/authenticated (invariante #9)', v_sig;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    {depois_valores}
  ) AS t(sig, md5_depois) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.sig))) IS DISTINCT FROM r.md5_depois THEN
      RAISE EXCEPTION 'data_nota_entrada: % não ficou no texto desta migration', r.sig;
    END IF;
  END LOOP;
END
$pos$;

select pg_notify('pgrst', 'reload schema');
COMMIT;
""")
    # R9-a: a IDA não tem DML fora de corpo de função — o tempo dela NÃO cresce com o nº de OCs/parcelas (ADD COLUMN sem
    # DEFAULT só mexe no catálogo; o resto é guarda, CREATE OR REPLACE, gatilho e ACL). Se um dia entrar, medir e rever os 3 s.
    fora = re.sub(r"\$([A-Za-z_]*)\$[\s\S]*?\$\1\$", "", "".join(mig))
    fora = re.sub(r"'(?:[^']|'')*'", "''", fora)
    fora = re.sub(r"--[^\n]*", "", fora)
    dml = re.findall(r"^[ \t]*(INSERT|UPDATE|DELETE|TRUNCATE|MERGE|COPY)\b", fora, flags=re.I | re.M)
    if dml:
        print(f"RECUSADO: a migration (ida) tem DML fora de corpo de função {dml} — o tempo dela passaria a crescer com os "
              "dados; os 3 s da ida deixam de valer (R9-a)", file=sys.stderr)
        return 1
    open(MIG, "w", encoding="utf-8").write("".join(mig))

    down = []
    down.append(f"""-- INVERSO de supabase/migrations/20261002100000_oc_data_nota_entrada.sql
-- ⚠️ DESTRUTIVO: APAGA as Datas da Nota de Entrada digitadas nas 5 OCs. Exporte antes (plano, Task 13 Step 10).
-- Exige, na MESMA transação:  SET LOCAL app.confirmo_apagar_data_nota_entrada = 'sim';
-- Faz: derruba os gatilhos novos, recria o do P. Acabado como era, restaura as 10 funções com o texto de 24/set (md5
-- conferido no fim), devolve a base ANTIGA às parcelas NÃO pagas das OCs que tinham data (pagas intactas) e só então apaga
-- as colunas. ARQUIVO GERADO por .superpowers/nota/mig/gerar_sql.py — NÃO editar à mão.
-- TRAVAS NO ARQUIVO (R9/R9-a), logo depois do `BEGIN;`:
--   • lock_timeout 500 ms — IGUAL à ida. É ele que protege os outros usuários: o inverso nunca fica na fila de uma
--     trava segurando quem chega depois (desiste em 0,5 s e o aplica_v2 tenta de novo).
--   • transaction_timeout {tt_inverso} s — MAIOR que os 3 s da ida (gerado com `gerar_sql.py --tt-inverso {tt_inverso}`): o passo 3
--     recalcula as NÃO pagas de CADA OC datada, e esse laço cresce com o nº de OCs (medido no ensaio, Task 4 —
--     `.superpowers/nota/mig/volta-medida.txt`). Aceitável porque a volta é EMERGÊNCIA, decidida pelo dono, em horário
--     calmo, e o laço roda ANTES das travas exclusivas: durante ele só há trava de LINHA (parcelas e a OC do P. Acabado);
--     o AccessExclusive nas 5 OCs (DROP TRIGGER/DROP COLUMN, passos 4–5) é só o fim, curto — e o passo 4b repassa, já com
--     ele, as OCs que ganharam data durante o laço (R9-b).
--   Aplicar pelo aplica_v2_inverso (aplica.sh): ele injeta ESTE transaction_timeout ANTES do arquivo (o 1º SET LOCAL arma o
--   relógio; um maior depois NÃO o estende — provado na cópia), com a confirmação pelo EXTRA_SQL na MESMA transação.
--   Sem DDL de policy (o hook supautils.policy_grants não dispara).
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '{tt_inverso}s';

DO $confirma$
BEGIN
  IF coalesce(current_setting('app.confirmo_apagar_data_nota_entrada', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'o inverso da data_nota_entrada APAGA as datas digitadas nas OCs — exporte antes e rode com SET LOCAL app.confirmo_apagar_data_nota_entrada = ''sim'' na mesma transação'
      USING ERRCODE = 'P0001';
  END IF;
END
$confirma$;

-- 0) Guarda (R2 do G-plano): cada função está EXATAMENTE no texto desta migration (md5_depois) ou já no de 24/set
--    (md5_antes); as novas, se existirem, no desta migration. Outro texto = outra frente mudou depois → PARE.
DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    {guarda_valores}
  ) AS t(sig, md5_antes, md5_depois) LOOP
    CONTINUE WHEN to_regprocedure(r.sig) IS NULL AND r.md5_antes IS NULL;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.sig)));
    CONTINUE WHEN v_md5 = r.md5_depois OR v_md5 IS NOT DISTINCT FROM r.md5_antes;
    RAISE EXCEPTION 'data_nota_entrada (inverso): % foi mudada por outra frente depois da migration (md5 %) — PARE e refaça o inverso contra o texto VIVO', r.sig, v_md5
      USING ERRCODE = 'P0001';
  END LOOP;
END
$guarda$;

-- 1) OCs cuja base vai voltar (lidas ANTES de apagar a coluna; tolera reexecução sem a coluna)
DROP TABLE IF EXISTS pg_temp._nota_voltar;
CREATE TEMP TABLE _nota_voltar (tipo text NOT NULL, id uuid NOT NULL) ON COMMIT DROP;
DO $captura$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'ocs_tecido' AND column_name = 'data_nota_entrada') THEN
    EXECUTE $q$
      INSERT INTO pg_temp._nota_voltar (tipo, id)
      SELECT 'tecido', id FROM public.ocs_tecido
       WHERE data_nota_entrada IS NOT NULL AND status = 'recebido' AND NOT COALESCE(is_rolo, false)
      UNION ALL SELECT 'aviamento', id FROM public.ocs_aviamento WHERE data_nota_entrada IS NOT NULL AND status = 'recebido'
      UNION ALL SELECT 'etiqueta', id FROM public.ocs_etiqueta WHERE data_nota_entrada IS NOT NULL AND status = 'recebido'
      UNION ALL SELECT 'p_acabado', id FROM public.ocs_p_acabado WHERE data_nota_entrada IS NOT NULL
    $q$;
  END IF;
END
$captura$;

-- 2) As 10 funções de volta ao texto de 24/set (CREATE OR REPLACE FUNCTION não trava tabela)
""")
    for sig, _ in FUNCS:
        down.append(antes[sig].rstrip("\n") + ";\n\n")
    down.append("""-- 3) Base ANTIGA de volta nas NÃO pagas (as funções restauradas já não leem a coluna; pagas intactas).
--    R9-a: o laço vem ANTES das travas exclusivas (passos 4–5) — aqui só há trava de LINHA. Os gatilhos novos ainda existem
--    mas nenhum dispara (o laço não grava data_nota_entrada); o do Acabado dispara pelo data_pedido e chama o gerador JÁ
--    restaurado. P. Acabado: re-dispara o PRÓPRIO gerador (mesmo parser '/' de hoje) com um UPDATE neutro de data_pedido
--    (sobe o `rev` da OC — quem estiver com ela aberta vê "alguém salvou").
DO $volta$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT tipo, id FROM pg_temp._nota_voltar ORDER BY tipo, id LOOP
    IF r.tipo = 'etiqueta' THEN
      PERFORM public.recalcular_parcelas_etiqueta(r.id);
    ELSIF r.tipo = 'p_acabado' THEN
      UPDATE public.ocs_p_acabado SET data_pedido = data_pedido WHERE id = r.id;
    ELSE
      PERFORM public._recalcular_parcelas_core(r.id, r.tipo);
    END IF;
  END LOOP;
END
$volta$;

-- 4) Gatilhos (daqui ao COMMIT: AccessExclusive nas 5 OCs — trecho curto)
DROP TRIGGER IF EXISTS trg_nota_entrada_recalc ON public.ocs_tecido;
DROP TRIGGER IF EXISTS trg_nota_entrada_recalc ON public.ocs_aviamento;
DROP TRIGGER IF EXISTS trg_nota_entrada_recalc ON public.ocs_etiqueta;
DROP FUNCTION IF EXISTS public.fn_oc_nota_entrada_recalc();
DROP TRIGGER IF EXISTS trg_nota_entrada_valida ON public.ocs_tecido;
DROP TRIGGER IF EXISTS trg_nota_entrada_valida ON public.ocs_aviamento;
DROP TRIGGER IF EXISTS trg_nota_entrada_valida ON public.ocs_etiqueta;
DROP TRIGGER IF EXISTS trg_nota_entrada_valida ON public.ocs_p_acabado;
DROP TRIGGER IF EXISTS trg_nota_entrada_valida ON public.ocs_importado;
DROP FUNCTION IF EXISTS public.fn_oc_nota_entrada_valida();
DROP TRIGGER IF EXISTS trg_gerar_parcelas_ocpa ON public.ocs_p_acabado;
CREATE TRIGGER trg_gerar_parcelas_ocpa
  AFTER INSERT OR UPDATE OF valor_total_desconto, prazo_pagamento, data_pedido ON public.ocs_p_acabado
  FOR EACH ROW EXECUTE FUNCTION public.gerar_parcelas_oc_p_acabado();

-- 4b) Repasse (R9-b): com o AccessExclusive das 5 OCs JÁ pego (os DROP TRIGGER acima), recalcula na base antiga as OCs que
--     ganharam data DEPOIS da captura do passo 1 — ex.: uma OC encomendada com data que foi recebida durante o laço (o
--     gerador da Nota, ainda vivo para as outras sessões naquele momento, gerou pela NF). Mesmo critério do passo 1, menos
--     as já recalculadas. Normalmente 0 (o NOTICE diz quantas).
DO $repasse$
DECLARE
  r record;
  v_n int := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'ocs_tecido' AND column_name = 'data_nota_entrada') THEN
    FOR r IN EXECUTE $q$
      SELECT 'tecido'::text AS tipo, id FROM public.ocs_tecido
       WHERE data_nota_entrada IS NOT NULL AND status = 'recebido' AND NOT COALESCE(is_rolo, false)
      UNION ALL SELECT 'aviamento', id FROM public.ocs_aviamento WHERE data_nota_entrada IS NOT NULL AND status = 'recebido'
      UNION ALL SELECT 'etiqueta', id FROM public.ocs_etiqueta WHERE data_nota_entrada IS NOT NULL AND status = 'recebido'
      UNION ALL SELECT 'p_acabado', id FROM public.ocs_p_acabado WHERE data_nota_entrada IS NOT NULL
      EXCEPT SELECT tipo, id FROM pg_temp._nota_voltar
      ORDER BY 1, 2
    $q$ LOOP
      v_n := v_n + 1;
      IF r.tipo = 'etiqueta' THEN
        PERFORM public.recalcular_parcelas_etiqueta(r.id);
      ELSIF r.tipo = 'p_acabado' THEN
        UPDATE public.ocs_p_acabado SET data_pedido = data_pedido WHERE id = r.id;
      ELSE
        PERFORM public._recalcular_parcelas_core(r.id, r.tipo);
      END IF;
    END LOOP;
  END IF;
  RAISE NOTICE 'data_nota_entrada (inverso): % OC(s) repassada(s) depois do DROP TRIGGER', v_n;
END
$repasse$;

-- 5) Colunas (DESTRUTIVO)
""")
    for t in TABELAS:
        down.append(f"ALTER TABLE public.{t} DROP COLUMN IF EXISTS data_nota_entrada;\n")
    down.append("\n-- 6) ACL reafirmada (#9)\n")
    for s in INTERNAS_REVOKE[2:]:
        down.append(f"REVOKE EXECUTE ON FUNCTION public.{s} FROM PUBLIC, anon, authenticated;\n")
    down.append(f"""
-- 7) Pós-condição: 10 funções no md5 de 24/set; nenhuma coluna, gatilho ou função nova sobrando
DO $pos$
DECLARE
  r record;
  v_n int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    {antes_valores}
  ) AS t(sig, md5_antes) LOOP
    IF md5(pg_get_functiondef(r.sig::regprocedure)) <> r.md5_antes THEN
      RAISE EXCEPTION 'data_nota_entrada (inverso): % não voltou ao texto de 24/set', r.sig;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'data_nota_entrada';
  IF v_n <> 0 THEN RAISE EXCEPTION 'data_nota_entrada (inverso): sobrou % coluna(s)', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_nota_entrada_recalc', 'trg_nota_entrada_valida');
  IF v_n <> 0 THEN RAISE EXCEPTION 'data_nota_entrada (inverso): sobrou % gatilho(s)', v_n; END IF;
  IF to_regprocedure('public.fn_oc_nota_entrada_recalc()') IS NOT NULL OR to_regprocedure('public.fn_oc_nota_entrada_valida()') IS NOT NULL THEN
    RAISE EXCEPTION 'data_nota_entrada (inverso): função nova sobrou';
  END IF;
END
$pos$;

select pg_notify('pgrst', 'reload schema');
COMMIT;
""")
    open(DOWN, "w", encoding="utf-8").write("".join(down))
    print("ok: migration, inverso, depois-esperado/ e diff-esperado.txt gerados")
    print(f"  travas: ida lock 500ms / transaction 3s · inverso lock 500ms / transaction {tt_inverso}s (--tt-inverso)")
    for sig, _ in FUNCS:
        print(f"  {sig}: antes {md5(antes[sig])}  depois-esperado {md5(depois[sig])}")
    for sig, t in NOVAS:
        print(f"  {sig}: (nova)  depois-esperado {md5(t)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Gerar e conferir o diff mínimo**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada"
chmod +x .superpowers/nota/mig/dump_antes.sh
bash .superpowers/nota/mig/dump_antes.sh
python3 .superpowers/nota/mig/gerar_sql.py
wc -l supabase/migrations/20261002100000_oc_data_nota_entrada.sql supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql
for f in supabase/migrations/20261002100000_oc_data_nota_entrada.sql supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql; do
  grep -A2 -x 'BEGIN;' "$f"                                                        # R9: as 2 travas logo depois
  grep -Eic '^[[:space:]]*(create|drop|alter)[[:space:]]+policy' "$f"                # R9: 0 = sem DDL de policy
done
cat .superpowers/nota/mig/diff-esperado.txt
```

Expected: `arquivos: 10`; `ok: migration, inverso, depois-esperado/ e diff-esperado.txt gerados`; `md5-antes.txt` (10 linhas) e `md5-depois-esperado.txt` (12); os md5 impressos:

```text
ok: migration, inverso, depois-esperado/ e diff-esperado.txt gerados
  gerar_parcelas_oc_tecido(): antes ac9fb224249f42133f5bf2750aba5d1c  depois-esperado fc5ce68cc48762f681d30168b1e172b6
  gerar_parcelas_oc_aviamento(): antes 345e55d865a0e4713e6ccbc62f50830d  depois-esperado e98640190802afd6de9f82ac4ecb39c3
  gerar_parcelas_oc_p_acabado(): antes 1d8286d877f32a437b344a0da1766ccb  depois-esperado 2229a974f172a8302085f15ab2d63ae9
  _recalcular_parcelas_core(uuid,text): antes b8af65bc500958202db25ddb5f3d3eed  depois-esperado 1b03dbd69233d761fd150ab45722b7f6
  recalcular_parcelas_etiqueta(uuid): antes d60ab89c8c25a830aa7a7789ff97eef0  depois-esperado cf86f487ca3d643f625087a55395ef73
  _salvar_oc_tecido_core(uuid,jsonb,jsonb,integer): antes b5255dc864f0e7f9f39236b4b9c531d6  depois-esperado aa64df90ef7daad675a69dbab7c1d585
  _salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer): antes 56af6c8a9ecb5619be2de1f2068553b3  depois-esperado 3c5a3d108d7f6e5a37319ceccb4406e2
  salvar_oc_etiqueta(uuid,jsonb,jsonb,integer): antes d92d27b1d774ca4d867fc9151f774fda  depois-esperado 4396c443f53c063b31159018bfa3914e
  _salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer): antes bd8139b1a1b1dee8b4b90e4327cb152c  depois-esperado 70b852884f47e55d01cd2b18846bbfa8
  _salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer): antes b74cd38a16fa08482551f1fb7e1487bb  depois-esperado 3b9077848c79865efbe15f0499595d69
  fn_oc_nota_entrada_recalc(): (nova)  depois-esperado 4df62f1206fc0ad006f04851c736019e
  fn_oc_nota_entrada_valida(): (nova)  depois-esperado 0c3614b75fd6bdbac1b3c862a35b796b
```

(~1.503 linhas a migration e ~1.424 o inverso — o grosso é o texto das 10 funções.) O gerador imprime `travas: ida lock 500ms / transaction 3s · inverso lock 500ms / transaction 30s (--tt-inverso)`. R9/R9-a: na migration `BEGIN;` / `SET LOCAL lock_timeout = '500ms';` / `SET LOCAL transaction_timeout = '3s';` e `0`; no inverso as mesmas linhas com `'30s'` (padrão do `--tt-inverso`; a Task 4 pode subir) e `0` — outra saída = PARE. No inverso, a ordem é guarda → captura → funções (2) → laço (3) → gatilhos (4) → repasse (4b, R9-b) → colunas (5): `grep -n '^-- [0-9]b\?)' supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql`. O `diff-esperado.txt` tem de ser EXATAMENTE este (é o diff mínimo aprovado no plano — qualquer linha a mais = PARE):

```diff
--- antes/gerar_parcelas_oc_tecido()
+++ depois/gerar_parcelas_oc_tecido()
@@ -41 +41,2 @@
-    v_base_data := COALESCE(NEW.data_entrega, CURRENT_DATE);
+    -- Data da Nota de Entrada (24/set): com ela, o prazo conta a partir dela; sem ela, a base antiga (vencimento provisório).
+    v_base_data := COALESCE(NEW.data_nota_entrada, NEW.data_entrega, CURRENT_DATE);

--- antes/gerar_parcelas_oc_aviamento()
+++ depois/gerar_parcelas_oc_aviamento()
@@ -46 +46,2 @@
-    v_base_data := COALESCE(NEW.data_entrega, CURRENT_DATE);
+    -- Data da Nota de Entrada (24/set): com ela, o prazo conta a partir dela; sem ela, a base antiga (vencimento provisório).
+    v_base_data := COALESCE(NEW.data_nota_entrada, NEW.data_entrega, CURRENT_DATE);

--- antes/gerar_parcelas_oc_p_acabado()
+++ depois/gerar_parcelas_oc_p_acabado()
@@ -64 +64,2 @@
-  v_base_data := coalesce(NEW.data_pedido, current_date);
+  -- Data da Nota de Entrada (24/set): com ela, o prazo conta a partir dela; sem ela, a base antiga (vencimento provisório).
+  v_base_data := coalesce(NEW.data_nota_entrada, NEW.data_pedido, current_date);

--- antes/_recalcular_parcelas_core(uuid,text)
+++ depois/_recalcular_parcelas_core(uuid,text)
@@ -16,0 +17 @@
+  v_data_nota date;  -- Data da Nota de Entrada (24/set): quando preenchida, é a base do vencimento.
@@ -49,2 +50,2 @@
-           prazo_pagamento, COALESCE(valor_real_total,0)
-      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos, v_prazo_pagamento, v_valor_total
+           prazo_pagamento, COALESCE(valor_real_total,0), data_nota_entrada
+      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos, v_prazo_pagamento, v_valor_total, v_data_nota
@@ -53,2 +54,2 @@
-    SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1), prazo_pagamento
-      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos, v_prazo_pagamento
+    SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1), prazo_pagamento, data_nota_entrada
+      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos, v_prazo_pagamento, v_data_nota
@@ -65,2 +66,2 @@
-    SELECT tenant_id, empresa_id, data_pedido, prazo_pagamento, COALESCE(valor_total_desconto,0)
-      INTO v_tenant, v_empresa, v_data_entrega, v_prazo_pagamento, v_valor_total
+    SELECT tenant_id, empresa_id, data_pedido, prazo_pagamento, COALESCE(valor_total_desconto,0), data_nota_entrada
+      INTO v_tenant, v_empresa, v_data_entrega, v_prazo_pagamento, v_valor_total, v_data_nota
@@ -114 +115,2 @@
-  v_base_data := COALESCE(v_data_entrega, CURRENT_DATE);
+  -- Data da Nota de Entrada (24/set): com ela, o prazo conta a partir dela; sem ela, a base antiga (vencimento provisório).
+  v_base_data := COALESCE(v_data_nota, v_data_entrega, CURRENT_DATE);

--- antes/recalcular_parcelas_etiqueta(uuid)
+++ depois/recalcular_parcelas_etiqueta(uuid)
@@ -8 +8 @@
-  v_tenant uuid; v_empresa uuid; v_data_entrega date; v_qprazos int; v_prazo text;
+  v_tenant uuid; v_empresa uuid; v_data_entrega date; v_qprazos int; v_prazo text; v_nota date;
@@ -13,2 +13,2 @@
-  SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1), prazo_pagamento
-    INTO v_tenant, v_empresa, v_data_entrega, v_qprazos, v_prazo FROM public.ocs_etiqueta WHERE id = _oc_id;
+  SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1), prazo_pagamento, data_nota_entrada
+    INTO v_tenant, v_empresa, v_data_entrega, v_qprazos, v_prazo, v_nota FROM public.ocs_etiqueta WHERE id = _oc_id;
@@ -38 +38,2 @@
-  v_base := COALESCE(v_data_entrega, CURRENT_DATE);
+  -- Data da Nota de Entrada (24/set): com ela, o prazo conta a partir dela; sem ela, a base antiga (vencimento provisório).
+  v_base := COALESCE(v_nota, v_data_entrega, CURRENT_DATE);

--- antes/_salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)
+++ depois/_salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)
@@ -56 +56 @@
-       parcelas_recebimento, valor_previsto_total, valor_real_total, status)
+       parcelas_recebimento, valor_previsto_total, valor_real_total, status, data_nota_entrada)
@@ -65 +65 @@
-       'encomendado')
+       'encomendado', NULLIF(_oc->>'data_nota_entrada', '')::date)
@@ -135,0 +136 @@
+      data_nota_entrada = CASE WHEN _oc ? 'data_nota_entrada' THEN NULLIF(_oc->>'data_nota_entrada', '')::date ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém

--- antes/_salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)
+++ depois/_salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)
@@ -77 +77 @@
-       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, parcelas_recebimento, status)
+       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, parcelas_recebimento, status, data_nota_entrada)
@@ -82 +82 @@
-       COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb), 'encomendado')
+       COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb), 'encomendado', NULLIF(_oc->>'data_nota_entrada', '')::date)
@@ -140,0 +141 @@
+      data_nota_entrada = CASE WHEN _oc ? 'data_nota_entrada' THEN NULLIF(_oc->>'data_nota_entrada', '')::date ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém

--- antes/salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)
+++ depois/salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)
@@ -58 +58 @@
-       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, nfs, parcelas_recebimento, status)
+       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, nfs, parcelas_recebimento, status, data_nota_entrada)
@@ -63 +63,2 @@
-       COALESCE(_oc->'nfs','[]'::jsonb), COALESCE(_oc->'parcelas_recebimento','[]'::jsonb), 'encomendado')
+       COALESCE(_oc->'nfs','[]'::jsonb), COALESCE(_oc->'parcelas_recebimento','[]'::jsonb), 'encomendado',
+       NULLIF(_oc->>'data_nota_entrada', '')::date)
@@ -117,0 +119 @@
+      data_nota_entrada = CASE WHEN _oc ? 'data_nota_entrada' THEN NULLIF(_oc->>'data_nota_entrada', '')::date ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém

--- antes/_salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)
+++ depois/_salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)
@@ -114 +114 @@
-      anexo_pedido_url, anexo_nf_url
+      anexo_pedido_url, anexo_nf_url, data_nota_entrada
@@ -127 +127 @@
-      _dados->>'anexo_pedido_url', _dados->>'anexo_nf_url'
+      _dados->>'anexo_pedido_url', _dados->>'anexo_nf_url', nullif(_dados->>'data_nota_entrada', '')::date
@@ -160,0 +161 @@
+      data_nota_entrada = CASE WHEN _dados ? 'data_nota_entrada' THEN NULLIF(_dados->>'data_nota_entrada', '')::date ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém

--- antes/_salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)
+++ depois/_salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)
@@ -126 +126 @@
-      desconto_pct, cotacao_final
+      desconto_pct, cotacao_final, data_nota_entrada
@@ -141 +141 @@
-      v_desconto_pct, coalesce(nullif(_dados->>'cotacao_final', '')::numeric, 0)
+      v_desconto_pct, coalesce(nullif(_dados->>'cotacao_final', '')::numeric, 0), nullif(_dados->>'data_nota_entrada', '')::date
@@ -193,0 +194 @@
+      data_nota_entrada = CASE WHEN _dados ? 'data_nota_entrada' THEN NULLIF(_dados->>'data_nota_entrada', '')::date ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém
```

- [ ] **Step 4: Suíte SÓ na cópia, com a migration dentro da transação** — pré-voo R4 antes

```bash
NOTA_DONO_AVISADO=sim bash .superpowers/nota/prevoo-copia.sh t3s4 || exit 1
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres NOTA_MIG_TXN=1 \
  npx vitest run --no-file-parallelism tests/integration/nota-entrada.test.ts 2>&1 | tail -8
```

Expected: `Tests 13 passed | 2 skipped` (a captura e a medição R9-b pulam sem `NOTA_CAPTURA_DEPOIS`/`NOTA_MEDIR_VOLTA`). Nenhum "there is no transaction in progress". Conferir que a cópia NÃO mudou (tudo foi revertido): repetir o 1º comando do Task 0 Step 5 → as mesmas contagens de `copia-contagens-t0.txt` (3ª = `0`).

- [ ] **Step 5: Capturar o `pg_get_functiondef` DEPOIS e registrar o diff antes → depois**

```bash
NOTA_DONO_AVISADO=sim bash .superpowers/nota/prevoo-copia.sh t3s5 || exit 1
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres NOTA_MIG_TXN=1 \
  NOTA_CAPTURA_DEPOIS="$PWD/.superpowers/nota/mig/depois" \
  npx vitest run --no-file-parallelism tests/integration/nota-entrada.test.ts -t "captura" 2>&1 | tail -4
python3 - <<'PY'
import os
M = ".superpowers/nota/mig"
for n in sorted(os.listdir(f"{M}/depois-esperado")):
    ler = lambda d: open(f"{M}/{d}/{n}", encoding="utf-8").read().rstrip("\n") if os.path.exists(f"{M}/{d}/{n}") else None
    antes, depois, esperado = ler("antes"), ler("depois"), ler("depois-esperado")
    if depois is None:
        print(f"FALTA  {n} (a captura não gravou)")
    elif depois == antes:
        print(f"IGUAL?! {n} (a migration não redefiniu)")
    elif depois == esperado:
        print(f"ok  {n} (depois vivo = depois-esperado)")
    else:
        print(f"DIVERGE  {n}")
PY
diff .superpowers/nota/mig/depois/md5-depois.txt .superpowers/nota/mig/md5-depois-esperado.txt && cp .superpowers/nota/mig/depois/md5-depois.txt .superpowers/nota/mig/md5-depois.txt && echo "md5-depois = esperado (12)"
```

Expected: `1 passed`; 12× `ok` (as 10 + as 2 novas) e nenhum `FALTA`/`IGUAL?!`/`DIVERGE` (o texto que o Postgres devolve é o que a migration instala — o diff antes → depois das 10 é o `diff-esperado.txt`); `md5-depois = esperado (12)` — é a lista que a guarda exata (R2), o ensaio e a produção conferem. `DIVERGE` = o Postgres normalizou algo: registrar o diff em `.superpowers/nota/mig/divergencia.md` e levar ao revisor Opus antes de seguir.

- [ ] **Step 6: Gate + commit (Tasks 2 e 3 juntas)**

```bash
bash .superpowers/nota/gates.sh
git add -- tests/integration/nota-entrada.test.ts supabase/migrations/20261002100000_oc_data_nota_entrada.sql supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql
git commit --only -m "feat(nota-entrada): migration 20261002100000 — data_nota_entrada nas 5 OCs, base do vencimento COALESCE(nota, base de hoje), recálculo das não pagas, validação D7, guarda md5 exata, inverso destrutivo com confirmação + testes de integração (só na cópia)" -m "Co-Authored-By: <seu modelo> <noreply@anthropic.com>" -- tests/integration/nota-entrada.test.ts supabase/migrations/20261002100000_oc_data_nota_entrada.sql supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql
```

Revisão individual Opus (Tasks 2+3) com: `diff-esperado.txt`, a saída dos Steps 4–5, `md5-depois.txt` e o checklist da §3.

---

## Task 4: Ensaio na CÓPIA — `aplica_v2`, suítes antes/depois, desfazer, laço do inverso MEDIDO numa txn desfeita  *(controlador; revisão individual Opus da saída)*

**Files:** nenhum no repo. Cria `.superpowers/nota/mig/{aplica.sh,ida-producao.sh,volta-producao.sh,ref-volta-f1.sh}` e `.superpowers/nota/copia.sh` (os de produção só rodam na Task 13, pelo DONO); registra em `.superpowers/nota/copia-estado.md`; o teste "R9-b" grava as medições em `.superpowers/nota/mig/volta-medida.txt`. Escreve na cópia (backup antes) e a devolve sem a Nota. **R9-b:** o ensaio NÃO data OC de verdade — a medição do laço com volume roda numa transação DESFEITA (teste de integração, ROLLBACK); o retrato só-leitura das parcelas e das 5 OCs (linhas inteiras: ids, vencimentos, `dias_offset`, `rev`) + nº de linhas do `audit_log` tem de sair IGUAL antes × depois.

- [ ] **Step 1: Receita de travas e scripts (R3)**

`.superpowers/nota/mig/aplica.sh` — `espera`, `ativ_vazio`, `com_travas` e `aplica_v2` são CÓPIA LITERAL do bloco de apoio v2 do runbook da F1 (conferir: `diff <(sed -n '/^# Confere uma consulta de 1 linha/,/^# ── Step 4: retrato/p' "/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-22-kanban-automatico-f1-banco/task-18-runbook-v2.md" | sed '$d') <(sed -n '/^# Confere uma consulta de 1 linha/,/^# ── Data da Nota de Entrada ──/p' .superpowers/nota/mig/aplica.sh | sed '$d' | sed '$d')` → vazio):

```bash
#!/usr/bin/env bash
# Receita de travas da Data da Nota de Entrada = o MESMO modelo do runbook v2 da F1
# (.superpowers/sdd/2026-09-22-kanban-automatico-f1-banco/task-18-runbook-v2.md §2-§3), igual ao Aviso e à F3.1 (R3 do
# G-plano). espera, ativ_vazio, com_travas e aplica_v2 = CÓPIA LITERAL do bloco de apoio v2 do runbook; só as variáveis e
# as funções *_nota/backup_*/confere_md5 são desta frente.
#   • o arquivo vai INTEIRO numa mensagem (psql -X -v ON_ERROR_STOP=1 -c, sem -f/-1);
#   • SET LOCAL lock_timeout = '500ms' e SET LOCAL transaction_timeout = '3s' injetados logo depois do `BEGIN;`
#     (a migration e o inverso TAMBÉM os trazem no arquivo — R9, psql -f é o caminho padrão; repetir é inofensivo);
#   • nova tentativa SÓ em 55P03/40P01/25P04 (ATIV + ESPERA s, até MAX_FALHAS); qualquer outro erro PARA.
#   • confirmação do inverso: EXTRA_SQL="SET LOCAL app.confirmo_apagar_data_nota_entrada = 'sim';" (mesma transação).
#   • R9-a: o INVERSO vai pelo aplica_v2_inverso (transaction_timeout do PRÓPRIO arquivo, ≥ 30 s, injetado ANTES — o 1º
#     SET LOCAL arma o relógio; um maior depois não o estende). lock_timeout 500 ms igual. A IDA segue no aplica_v2 (3 s).
# Uso: SEMPRE num bash, da raiz da worktree — `source .superpowers/nota/mig/aplica.sh` (só define coisas; nada roda).
[ -n "${BASH_VERSION:-}" ] || { echo 'ERRO: use bash (as funções são de bash)'; return 1 2>/dev/null || exit 1; }
LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
MIG=supabase/migrations/20261002100000_oc_data_nota_entrada.sql
INV=supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql
M=.superpowers/nota/mig
D="/Users/sunglee/PLM + Criação/savepoints/pre-apply-nota-entrada"
BK_LOCAL="/Users/sunglee/PLM + Criação/banco-local/backups"
CONTAINER=supabase_db_banco-local
ATIV="select pid, usename, application_name, state, now() - xact_start as idade_txn, left(query, 60) as consulta from pg_stat_activity where datname = current_database() and backend_type = 'client backend' and pid <> pg_backend_pid() and state <> 'idle' and xact_start < now() - interval '5 seconds' order by xact_start"
CONT="select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'), (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal)"
# colunas | gatilhos da Nota | função recalc | função valida      (antes: 0|0|f|f · depois da ida: 5|8|t|t)
ESTADO="select (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'data_nota_entrada' and table_name in ('ocs_tecido','ocs_aviamento','ocs_etiqueta','ocs_p_acabado','ocs_importado')), (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_nota_entrada_recalc','trg_nota_entrada_valida')), to_regprocedure('public.fn_oc_nota_entrada_recalc()') is not null, to_regprocedure('public.fn_oc_nota_entrada_valida()') is not null"
# internas executáveis por anon/authenticated (esperado 0 — invariante #9)
ACL_INT="select count(*) from (values ('public.fn_oc_nota_entrada_recalc()'), ('public.fn_oc_nota_entrada_valida()'), ('public._recalcular_parcelas_core(uuid,text)'), ('public.recalcular_parcelas_etiqueta(uuid)'), ('public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)'), ('public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)'), ('public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)'), ('public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)')) v(f) where to_regprocedure(f) is not null and (has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE'))"
F1="select to_regclass('public.kanban_snapshot') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_config' and column_name = 'kanban_automatico')"
AVISO="select to_regclass('public.avisos_globais') is not null"
# R9-a: OCs DATADAS que o laço do inverso recalcula (MESMO critério do passo 1 do inverso): tecido|aviamento|insumo|p.acabado
DATADAS="select (select count(*) from public.ocs_tecido where data_nota_entrada is not null and status = 'recebido' and not coalesce(is_rolo, false)), (select count(*) from public.ocs_aviamento where data_nota_entrada is not null and status = 'recebido'), (select count(*) from public.ocs_etiqueta where data_nota_entrada is not null and status = 'recebido'), (select count(*) from public.ocs_p_acabado where data_nota_entrada is not null)"
MEDIDA=.superpowers/nota/mig/volta-medida.txt   # R9-a: medições do ensaio (Task 4) — chave=valor

# ── CÓPIA LITERAL do bloco de apoio v2 da F1 (task-18-runbook-v2.md, de "# Confere uma consulta…" até o fim de aplica_v2) ──
# Confere uma consulta de 1 linha contra o valor esperado (sai ≠ 0 e mostra o obtido se diverge)
espera() {  # uso: espera URL "SQL" "valor esperado" "rótulo"
  local v; v=$(psql "$1" -X -q -A -t -F'|' -v ON_ERROR_STOP=1 -c "$2") || { echo "FALHOU ($4): erro de consulta"; return 1; }
  if [ "$v" = "$3" ]; then echo "OK ($4): $v"; else echo "FALHOU ($4): esperado [$3], obtido [$v]"; return 1; fi
}
# R1: nenhuma transação de cliente ativa há mais de 5 s (mostra quais, se houver)
ativ_vazio() {
  local n; n=$(psql "$1" -X -q -A -t -v ON_ERROR_STOP=1 -c "select count(*) from ($ATIV) a") || return 1
  if [ "$n" = 0 ]; then echo "OK (ATIV): nenhuma transação longa"; return 0; fi
  psql "$1" -X -A -F' | ' -c "$ATIV"; echo "FALHOU (ATIV): $n transação(ões) longa(s) — NÃO aplicar; esperar e repetir; não matar sessão"; return 1
}

# R1 v2 — TRAVAS: o arquivo vai inteiro numa ÚNICA mensagem (psql -c, sem -1: sem idas e voltas entre comandos),
# com SET LOCAL lock_timeout/transaction_timeout injetados logo depois do `BEGIN;` do próprio arquivo (SET LOCAL
# morre no COMMIT/ROLLBACK: nada vaza para a conexão do pooler). $2 = SQL extra na mesma posição (override do inverso 1).
com_travas() {
  local nb nc
  nb=$(grep -c '^BEGIN;$' "$1"); nc=$(grep -c '^COMMIT;$' "$1")
  if [ "$nb" != 1 ] || [ "$nc" != 1 ]; then echo "ERRO: $1 precisa de exatamente 1 'BEGIN;' e 1 'COMMIT;' em linha própria (achei $nb/$nc)" >&2; return 1; fi
  awk -v extra="${2:-}" '{ print } $0 == "BEGIN;" { print "SET LOCAL lock_timeout = '\''500ms'\'';"; print "SET LOCAL transaction_timeout = '\''3s'\'';"; if (extra != "") print extra }' "$1"
}
# Aplica os arquivos NA ORDEM. Nova tentativa SÓ em 55P03 (lock timeout), 40P01 (deadlock) ou 25P04 (transaction
# timeout): nada do arquivo que falhou fica (a txn dele é desfeita); mostra o ATIV, espera ESPERA s (padrão 60) e
# repete A PARTIR DO ARQUIVO QUE FALHOU; na MAX_FALHAS-ésima falha (padrão 5, somando o run todo) PARA. Qualquer
# outro erro: PARA na hora (não repetir). Override do inverso 1: export EXTRA_SQL="SET LOCAL app.kanban_inverso_forcar = 'sim';"
aplica_v2() {
  local url="$1"; shift
  local f sql log rc falhas=0
  for f in "$@"; do
    while :; do
      echo "== $f  (início $(date '+%H:%M:%S'))"
      sql="$(com_travas "$f" "${EXTRA_SQL:-}")" || return 1
      log="$(mktemp -t aplica_v2.XXXXXX)"
      /usr/bin/time -p psql "$url" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -c "$sql" 2>"$log"
      rc=$?
      cat "$log"
      if [ "$rc" = 0 ]; then rm -f "$log"; break; fi
      if grep -Eq '(ERROR|FATAL): +(55P03|40P01|25P04):' "$log"; then
        rm -f "$log"; falhas=$((falhas + 1))
        if [ "$falhas" -ge "${MAX_FALHAS:-5}" ]; then
          echo "PAROU em $f: $falhas falhas de trava/tempo — falar com o dono (não matar sessão)"; return 1
        fi
        echo "-- espera de trava/tempo (falha $falhas de ${MAX_FALHAS:-5}); nada de $f ficou. Transações longas agora:"
        psql "$url" -X -A -F' | ' -c "$ATIV"
        echo "-- nova tentativa de $f em ${ESPERA:-60} s"; sleep "${ESPERA:-60}"
        continue
      fi
      rm -f "$log"; echo "PAROU em $f: erro que NÃO é de trava/tempo (rc=$rc) — PARAR, não repetir"; return 1
    done
  done
}

# ── Data da Nota de Entrada ──
# Cada linha da lista = "public.sig md5": o md5 VIVO de pg_get_functiondef tem de ser IGUAL (AUSENTE = função não existe).
confere_md5() {  # uso: confere_md5 URL lista "rótulo"
  local sig m v falhou=0
  while read -r sig m; do
    [ -n "$sig" ] || continue
    v=$(psql "$1" -X -q -A -t -v ON_ERROR_STOP=1 -c "select coalesce(md5(pg_get_functiondef(to_regprocedure('$sig'))), 'AUSENTE')") || return 1
    [ "$v" = "$m" ] || { echo "FALHOU ($3): $sig vivo=$v esperado=$m"; falhou=1; }
  done < "$2"
  [ "$falhou" = 0 ] && echo "OK ($3): $(grep -c . "$2") funções com o md5 esperado"
}
# transaction_timeout (em segundos) que o arquivo põe logo depois do `BEGIN;` (vazio = não tem)
tt_do_arquivo() { sed -n "s/^SET LOCAL transaction_timeout = '\([0-9][0-9]*\)s';\$/\1/p" "$1" | head -1; }
# lê uma medição do ensaio (R9-a): medida chave  → valor (vazio se não houver)
medida() { [ -s "$MEDIDA" ] && sed -n "s/^$1=//p" "$MEDIDA" | tail -1; }
grava_medida() {  # uso: grava_medida chave valor
  mkdir -p "$(dirname "$MEDIDA")"; touch "$MEDIDA"
  { grep -v "^$1=" "$MEDIDA"; echo "$1=$2"; } > "$MEDIDA.tmp" && mv "$MEDIDA.tmp" "$MEDIDA"
}
# R9: travas NO arquivo, logo depois do `BEGIN;` (psql -f é o caminho padrão), e NENHUMA DDL de policy (o hook
# supautils.policy_grants pegaria AccessExclusive em auth/storage/realtime até o COMMIT). R9-a: a IDA com 3 s; o INVERSO
# com ≥ 30 s (gerar_sql.py --tt-inverso); lock_timeout 500 ms nos dois. Só lê os 2 arquivos.
confere_arquivos_nota() {
  local f tt
  for f in "$MIG" "$INV"; do
    tt="$(tt_do_arquivo "$f")"
    if [ "$f" = "$MIG" ]; then
      [ "$tt" = 3 ] || { echo "FALHOU (R9): $f — a IDA tem de ter transaction_timeout 3s (achei '${tt}s')"; return 1; }
    else
      [ -n "$tt" ] && [ "$tt" -ge 30 ] || { echo "FALHOU (R9-a): $f — o INVERSO tem de ter transaction_timeout ≥ 30s (achei '${tt}s')"; return 1; }
    fi
    [ "$(grep -A2 -x 'BEGIN;' "$f")" = "$(printf '%s\n' 'BEGIN;' "SET LOCAL lock_timeout = '500ms';" "SET LOCAL transaction_timeout = '${tt}s';")" ] \
      || { echo "FALHOU (R9): $f sem as 2 travas logo depois do BEGIN;"; return 1; }
    ! grep -Eiq '^[[:space:]]*(create|drop|alter)[[:space:]]+policy' "$f" \
      || { echo "FALHOU (R9): $f tem DDL de policy — dispara supautils.policy_grants; falar com o controlador"; return 1; }
  done
  echo "OK (R9): travas no arquivo (ida 3s · inverso $(tt_do_arquivo "$INV")s · lock 500ms nos dois), sem DDL de policy"
}
# R9-a: aplica o INVERSO. O laço dele recalcula as não pagas de cada OC datada, então precisa de transaction_timeout MAIOR
# que 3 s — mas o com_travas literal injeta 3 s ANTES do arquivo, e um SET LOCAL maior depois NÃO estende o relógio
# (provado na cópia pelo guardião). Numa SUBSHELL (o aplica_v2 e o com_travas literais ficam intactos no resto do script),
# troca só o com_travas por um que injeta o lock_timeout de 500 ms (o que protege os outros usuários — igual) e o
# transaction_timeout DO ARQUIVO — ou NOTA_TT_VOLTA=Ns, se maior (emergência, decisão do dono). EXTRA_SQL = confirmação.
aplica_v2_inverso() {  # uso: EXTRA_SQL=… [NOTA_TT_VOLTA=Ns] aplica_v2_inverso URL arquivo_inverso
  local tt; tt="$(tt_do_arquivo "$2")"
  [ -n "$tt" ] || { echo "ERRO: $2 sem 'SET LOCAL transaction_timeout = …s;' logo depois do BEGIN;"; return 1; }
  if [ -n "${NOTA_TT_VOLTA:-}" ]; then
    [[ "$NOTA_TT_VOLTA" =~ ^[0-9]+s$ ]] && [ "${NOTA_TT_VOLTA%s}" -ge "$tt" ] \
      || { echo "ERRO: NOTA_TT_VOLTA=$NOTA_TT_VOLTA — use N s com N ≥ ${tt} (o do arquivo)"; return 1; }
    tt="${NOTA_TT_VOLTA%s}"
  fi
  echo "== inverso com lock_timeout 500ms e transaction_timeout ${tt}s"
  (
    com_travas() {
      local nb nc
      nb=$(grep -c '^BEGIN;$' "$1"); nc=$(grep -c '^COMMIT;$' "$1")
      if [ "$nb" != 1 ] || [ "$nc" != 1 ]; then echo "ERRO: $1 precisa de exatamente 1 'BEGIN;' e 1 'COMMIT;' em linha própria (achei $nb/$nc)" >&2; return 1; fi
      awk -v extra="${2:-}" -v tt="$tt" '{ print } $0 == "BEGIN;" { print "SET LOCAL lock_timeout = '\''500ms'\'';"; print "SET LOCAL transaction_timeout = '\''" tt "s'\'';"; if (extra != "") print extra }' "$1"
    }
    aplica_v2 "$1" "$2"
  )
}
# Pré-voo (só leitura). $2 = "sim" exige a F1 E o Aviso Global já no banco (produção: ordem do dono); "nao" na cópia.
prevoo_nota() {  # uso: prevoo_nota URL sim|nao
  echo "== pré-voo Data da Nota de Entrada (só leitura) $(date '+%F %T')"
  git ls-files --error-unmatch "$MIG" "$INV" > /dev/null 2>&1 || { echo "FALHOU (arquivos): SQL da Nota não está commitado"; return 1; }
  git diff --quiet HEAD -- "$MIG" "$INV" || { echo "FALHOU (arquivos): alteração não commitada no SQL da Nota"; return 1; }
  [ -s "$M/md5-antes.txt" ] && [ -s "$M/md5-depois.txt" ] || { echo "FALHOU (arquivos): faltam $M/md5-antes.txt e/ou md5-depois.txt (Task 3)"; return 1; }
  confere_arquivos_nota || return 1
  espera "$1" "select current_setting('server_version_num')::int >= 170000 and exists (select 1 from pg_settings where name = 'transaction_timeout')" "t" "PG >= 17 com transaction_timeout" &&
  { [ "$2" != sim ] || { espera "$1" "$F1" "t" "F1 (kanban automático) já está no banco" && espera "$1" "$AVISO" "t" "Aviso Global já está no banco (to_regclass)"; }; } &&
  espera "$1" "$ESTADO" "0|0|f|f" "a Nota ainda NÃO existe" &&
  confere_md5 "$1" "$M/md5-antes.txt" "as 10 funções no texto de 24/set" &&
  ativ_vazio "$1" &&
  echo "== PRÉ-VOO OK $(date '+%T')"
}
# Conferência pós-ida (só leitura). $2 = contagens de ANTES (funções|gatilhos): +2 funções, +8 gatilhos.
confere_ida_nota() {  # uso: confere_ida_nota URL CONT_ANTES
  local f="${2%|*}" g="${2#*|}"
  espera "$1" "$ESTADO" "5|8|t|t" "5 colunas, 8 gatilhos, 2 funções novas" &&
  espera "$1" "$CONT" "$((f + 2))|$((g + 8))" "contagens +2 funções +8 gatilhos" &&
  espera "$1" "$ACL_INT" "0" "internas sem EXECUTE p/ anon/authenticated (#9)" &&
  confere_md5 "$1" "$M/md5-depois.txt" "as 12 funções no texto desta migration"
}
confere_volta_nota() {  # uso: confere_volta_nota URL CONT_ANTES_DA_IDA
  espera "$1" "$ESTADO" "0|0|f|f" "a Nota saiu" &&
  espera "$1" "$CONT" "$2" "contagens = antes da ida" &&
  confere_md5 "$1" "$M/md5-antes.txt" "as 10 funções de volta ao texto de 24/set"
}
# Backup do banco INTEIRO com o pg_dump 17.6 do container da cópia (o pg_dump do Mac é 15). A URL vai pela ENTRADA
# padrão (não aparece nos argumentos de processo — N4). -Fc; confere que o dump abre (pg_restore -l).
backup_banco() {  # uso: backup_banco URL pasta rótulo
  local url="$1" dir="$2" rot="$3" f
  mkdir -p "$dir" || return 1
  docker ps --filter "name=^${CONTAINER}$" --format '{{.Names}}' | grep -qx "$CONTAINER" \
    || { echo "FALHOU (backup): o container $CONTAINER não está no ar (o pg_dump 17.6 mora nele)"; return 1; }
  f="$dir/${rot}-$(date +%F-%H%M%S).dump"
  echo "== backup ($rot) → $f"
  printf '%s\n' "$url" | docker exec -i "$CONTAINER" sh -c 'IFS= read -r U; exec pg_dump -d "$U" -Fc' > "$f" 2> "$f.log" && [ -s "$f" ] \
    || { echo "FALHOU (backup): pg_dump deu erro — veja $f.log (nada foi aplicado)"; tail -5 "$f.log"; return 1; }
  docker exec -i "$CONTAINER" pg_restore -l < "$f" > "$f.toc" 2>> "$f.log" \
    || { echo "FALHOU (backup): o dump não abre (pg_restore -l) — veja $f.log"; return 1; }
  echo "OK (backup): $f ($(du -h "$f" | cut -f1); $(grep -c 'TABLE DATA public ' "$f.toc") tabelas de public com dados)"
}
backup_copia() {  # backup da CÓPIA LOCAL (dentro do container, porta interna 5432) em banco-local/backups
  local f
  mkdir -p "$BK_LOCAL" || return 1
  f="$BK_LOCAL/pre-nota-copia-$(date +%F-%H%M%S).dump"
  docker exec -e PGPASSWORD=postgres "$CONTAINER" pg_dump -h 127.0.0.1 -U supabase_admin -d postgres -Fc > "$f" && [ -s "$f" ] \
    || { echo "FALHOU (backup da cópia)"; rm -f "$f"; return 1; }
  echo "OK (backup da cópia): $f ($(du -h "$f" | cut -f1))"
}
```

`.superpowers/nota/copia.sh` (ida/volta na cópia pelo `aplica_v2`, com o pré-voo R4 e backup):

```bash
#!/usr/bin/env bash
# Data da Nota de Entrada na CÓPIA LOCAL (127.0.0.1:54422). NUNCA produção. Uso (raiz da worktree):
#   NOTA_DONO_AVISADO=sim bash .superpowers/nota/copia.sh ida|volta
#   • ida   — migration pelo aplica_v2 (3 s — R3), com pré-voo R4 e backup pg_dump -Fc ANTES.
#   • volta — inverso pelo aplica_v2_inverso (R9-a: transaction_timeout do arquivo, ≥ 30 s), backup ANTES; mostra quantas
#             OCs estão datadas (= tamanho do laço de recálculo). NOTA_TT_VOLTA=Ns = tempo maior só nesta volta.
#   bash .superpowers/nota/copia.sh retrato — R9-b, SÓ LEITURA: checksum das linhas INTEIRAS de parcelas e das 5 OCs (ids,
#             vencimentos, dias_offset, rev…) + nº de linhas do audit_log. A Task 4 tira um antes e um depois da medição do
#             laço (feita numa transação DESFEITA, no teste de integração) e exige os dois IGUAIS.
# O ensaio NÃO data OC de verdade na cópia (R9-b): a medição com volume fica no teste "R9-b" (NOTA_MEDIR_VOLTA), com ROLLBACK.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
source .superpowers/nota/mig/aplica.sh || exit 1
REG=.superpowers/nota/copia-estado.md
L=.superpowers/nota/logs; mkdir -p "$L"
RETRATO="select 'parcelas', count(*), md5(coalesce(string_agg(t::text, E'\n' order by t.id), '')) from public.parcelas t
 union all select 'ocs_tecido', count(*), md5(coalesce(string_agg(t::text, E'\n' order by t.id), '')) from public.ocs_tecido t
 union all select 'ocs_aviamento', count(*), md5(coalesce(string_agg(t::text, E'\n' order by t.id), '')) from public.ocs_aviamento t
 union all select 'ocs_etiqueta', count(*), md5(coalesce(string_agg(t::text, E'\n' order by t.id), '')) from public.ocs_etiqueta t
 union all select 'ocs_p_acabado', count(*), md5(coalesce(string_agg(t::text, E'\n' order by t.id), '')) from public.ocs_p_acabado t
 union all select 'ocs_importado', count(*), md5(coalesce(string_agg(t::text, E'\n' order by t.id), '')) from public.ocs_importado t
 union all select 'audit_log', count(*), '' from public.audit_log"
case "${1:-}" in ida|volta|retrato) ;; *) echo "uso: copia.sh ida|volta|retrato"; exit 2;; esac
if [ "$1" = retrato ]; then   # só leitura: sem pré-voo, sem backup, sem registro
  PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -q -A -t -F'|' -v ON_ERROR_STOP=1 -c "$RETRATO"
  exit $?
fi
bash .superpowers/nota/prevoo-copia.sh "copia-$1" || exit 1
ESP=$(psql "$LOCAL" -X -q -A -t -F'|' -v ON_ERROR_STOP=1 -c "$ESTADO") || exit 1
ANTES=$(psql "$LOCAL" -X -q -A -t -F'|' -v ON_ERROR_STOP=1 -c "$CONT") || exit 1
echo "antes: funções|gatilhos = $ANTES · Nota = $ESP"
if [ "$1" = ida ]; then
  [ "$ESP" = "0|0|f|f" ] || { echo "a cópia JÁ tem a Nota ($ESP) — nada a fazer"; exit 0; }
  echo "$ANTES" > .superpowers/nota/copia-cont-antes.txt
  backup_copia || exit 1
  prevoo_nota "$LOCAL" nao && aplica_v2 "$LOCAL" "$MIG" 2>&1 | tee "$L/copia-ida.out" && confere_ida_nota "$LOCAL" "$ANTES" || exit 1
else
  [ "$ESP" = "5|8|t|t" ] || { echo "a cópia NÃO tem a Nota inteira ($ESP) — PARE e avise o controlador"; exit 1; }
  [ -s .superpowers/nota/copia-cont-antes.txt ] || { echo "PARE: sem .superpowers/nota/copia-cont-antes.txt (a ida não foi por este script)"; exit 1; }
  N4=$(psql "$LOCAL" -X -q -A -t -F'|' -v ON_ERROR_STOP=1 -c "$DATADAS") || exit 1
  echo "laço do inverso: $(echo "$N4" | awk -F'|' '{print $1 + $2 + $3 + $4}') OC(s) datada(s) (tecido|aviamento|insumo|p.acabado = $N4)"
  backup_copia || exit 1
  ativ_vazio "$LOCAL" || exit 1
  EXTRA_SQL="SET LOCAL app.confirmo_apagar_data_nota_entrada = 'sim';" aplica_v2_inverso "$LOCAL" "$INV" 2>&1 | tee "$L/copia-volta.out" \
    && confere_volta_nota "$LOCAL" "$(cat .superpowers/nota/copia-cont-antes.txt)" || exit 1
fi
psql "$LOCAL" -X -q -c "NOTIFY pgrst, 'reload schema'"
DEPOIS=$(psql "$LOCAL" -X -q -A -t -F'|' -c "$CONT")
printf -- '- %s  %s  %s → %s\n' "$(date '+%F %T')" "$1" "$ANTES" "$DEPOIS" >> "$REG"
echo "== CÓPIA: $1 OK ($ANTES → $DEPOIS)"
```

`.superpowers/nota/mig/ida-producao.sh` (Task 13 Step 5 — o DONO):

```bash
#!/usr/bin/env bash
# Task 13 Step 5 — IDA em PRODUÇÃO da Data da Nota de Entrada. Quem roda é o DONO, num terminal, da raiz da worktree:
#   bash .superpowers/nota/mig/ida-producao.sh 2>&1 | tee -a .superpowers/nota/logs/prod-ida.log
# Ordem: contagens → BACKUP (pg_dump completo; sem PITR) → pré-voo (F1 e Aviso no banco, Nota ausente, 10 funções no texto
# de 24/set, sem transação longa) + apply pelo aplica_v2 NUM COMANDO SÓ → conferência → recarrega o PostgREST.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
source .superpowers/nota/mig/aplica.sh || exit 1
mkdir -p .superpowers/nota/logs "$D"
PROD="$(cat /tmp/dburl.txt)"
echo "== IDA Data da Nota de Entrada em PRODUÇÃO $(date '+%F %T')"
CONT_ANTES=$(psql "$PROD" -X -q -A -t -F'|' -v ON_ERROR_STOP=1 -c "$CONT") || { echo "FALHOU: não conectou em produção"; exit 1; }
echo "$CONT_ANTES" > "$D/cont-antes-nota.txt"; echo "contagens antes (funções|gatilhos): $CONT_ANTES"
backup_banco "$PROD" "$D" producao-pre-nota || { echo "== PAROU no backup — nada foi aplicado"; exit 1; }
prevoo_nota "$PROD" sim && aplica_v2 "$PROD" "$MIG" && echo "== IDA OK $(date '+%T')" \
  || { echo "== IDA NÃO CONCLUÍDA (erro no apply = nada do arquivo ficou) — avisar o controlador"; exit 1; }
confere_ida_nota "$PROD" "$CONT_ANTES" \
  || { echo "== CONFERÊNCIA FALHOU — avisar o controlador (NÃO rodar o inverso sem OK do dono)"; exit 1; }
psql "$PROD" -X -q -A -t -F'|' -c "$CONT" > "$D/cont-depois-nota.txt"
psql "$PROD" -X -q -v ON_ERROR_STOP=1 -c "NOTIFY pgrst, 'reload schema'" && echo "== PostgREST recarregado"
```

`.superpowers/nota/mig/volta-producao.sh` (Task 13 Step 10 — só emergência, o DONO):

```bash
#!/usr/bin/env bash
# VOLTA em PRODUÇÃO (Task 13 Step 10) — SÓ em emergência, com OK explícito do dono, DEPOIS do revert do front NO AR e das
# abas recarregadas. APAGA as datas digitadas (exporta antes) e devolve a base antiga às NÃO pagas. O DONO roda:
#   bash .superpowers/nota/mig/volta-producao.sh 2>&1 | tee -a .superpowers/nota/logs/prod-volta.log
# R9-a: ANTES da confirmação mostra quantas OCs estão datadas (= tamanho do laço de recálculo do inverso) e confere, pela
# medição do ensaio (volta-medida.txt), se o transaction_timeout do inverso cobre esse laço com folga de 5×. Se não
# cobrir: PARA — regenerar o inverso com `gerar_sql.py --tt-inverso N` (+ testes + commit) OU rodar de novo com
# NOTA_TT_VOLTA=Ns (decisão do dono; vale só nesta volta). lock_timeout segue 500 ms (protege os outros usuários).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
source .superpowers/nota/mig/aplica.sh || exit 1
PROD="$(cat /tmp/dburl.txt)"
echo "== VOLTA da Data da Nota de Entrada em PRODUÇÃO $(date '+%F %T')"
N4=$(psql "$PROD" -X -q -A -t -F'|' -v ON_ERROR_STOP=1 -c "$DATADAS") || { echo "FALHOU: não conectou em produção"; exit 1; }
N=$(echo "$N4" | awk -F'|' '{print $1 + $2 + $3 + $4}')
echo "OCs DATADAS em produção (o laço do inverso recalcula as não pagas de cada uma): tecido|aviamento|insumo|p.acabado = $N4 → total $N"
TT=$(tt_do_arquivo "$INV"); TT_USO="${NOTA_TT_VOLTA:-${TT}s}"; TT_USO="${TT_USO%s}"
[ -n "$(medida t_volta)" ] && [ -n "$(medida s_por_oc)" ] \
  || { echo "PARE: falta a medição do ensaio em $MEDIDA (Task 4 Step 2) — sem ela não dá para saber se ${TT}s bastam"; exit 1; }
PRECISA=$(awk -v n="$N" -v s="$(medida s_por_oc)" -v tv="$(medida t_volta)" \
  'BEGIN { e = n * s; if (e < tv) e = tv; p = int(5 * e + 0.999); if (p < 30) p = 30; print p }')
echo "ensaio: $(medida n_copia) OC(s) datadas → volta em $(medida t_volta)s (≈ $(medida s_por_oc)s/OC); aqui: $N OC(s) → com folga 5× precisa de ${PRECISA}s; transaction_timeout: arquivo ${TT}s, nesta volta ${TT_USO}s"
[ "$TT_USO" -ge "$PRECISA" ] || {
  echo "PARE: ${TT_USO}s < ${PRECISA}s — o laço pode estourar o tempo (25P04 ×5 e o aplica_v2 para). Opções (dono):"
  echo "  a) regenerar o inverso: python3 .superpowers/nota/mig/gerar_sql.py --tt-inverso $PRECISA (+ Task 3 Step 4 + gates + commit)"
  echo "  b) rodar de novo com NOTA_TT_VOLTA=${PRECISA}s (vale só nesta volta; o lock_timeout segue 500ms)"
  exit 1; }
printf 'Isto APAGA TODAS as Datas da Nota de Entrada (as %s OC(s) do laço e as demais; o export vem antes). Digite APAGAR AS DATAS para seguir: ' "$N"
IFS= read -r RESP < /dev/tty || RESP=""
[ "$RESP" = "APAGAR AS DATAS" ] || { echo "cancelado — nada foi feito"; exit 1; }
V="$D/volta-$(date +%F-%H%M%S)"; mkdir -p "$V"
for T in ocs_tecido ocs_aviamento ocs_etiqueta ocs_p_acabado ocs_importado; do
  psql "$PROD" -X -q -v ON_ERROR_STOP=1 -c "\copy (select id, tenant_id, data_nota_entrada from public.$T where data_nota_entrada is not null order by id) to '$V/$T.csv' csv header" \
    || { echo "FALHOU o export de $T — PARE"; exit 1; }
done
psql "$PROD" -X -q -v ON_ERROR_STOP=1 -c "\copy (select * from public.parcelas order by id) to '$V/parcelas_antes_da_volta.csv' csv header" || exit 1
echo "export: $V"
backup_banco "$PROD" "$D" producao-pre-volta-nota || { echo "== PAROU no backup — nada foi desfeito"; exit 1; }
[ -s "$D/cont-antes-nota.txt" ] || { echo "PARE: sem $D/cont-antes-nota.txt (ida-producao.sh)"; exit 1; }
ativ_vazio "$PROD" && EXTRA_SQL="SET LOCAL app.confirmo_apagar_data_nota_entrada = 'sim';" aplica_v2_inverso "$PROD" "$INV" \
  && confere_volta_nota "$PROD" "$(cat "$D/cont-antes-nota.txt")" \
  && psql "$PROD" -X -q -v ON_ERROR_STOP=1 -c "DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261002100000'" \
  && psql "$PROD" -X -q -c "NOTIFY pgrst, 'reload schema'" && echo "== VOLTA OK $(date '+%T')"
```

`.superpowers/nota/mig/ref-volta-f1.sh` (Task 13 Step 7b — R1, o DONO, só leitura):

```bash
#!/usr/bin/env bash
# Task 13 Step 7b (R1 do G-plano da Nota) — NOVA referência de fidelidade para a VOLTA DE EMERGÊNCIA da F1, gravada logo
# DEPOIS da verificação pós-apply da Nota. A volta da F1 (runbook v2 §9.2, task-18-runbook-v2.md:786-791) termina com
# `espera … "$CONT" "427|219"` e comparando a fidelidade de TODO o public com o retrato pré-F1; com a Nota (e o Aviso) em
# produção nenhuma das duas fecha. A referência nova = o retrato pré-F1 (detalhe) SEM as linhas dos objetos que a Nota e o
# Aviso criaram/mudaram + as linhas ATUAIS deles lidas agora; e o CONT esperado da volta = pré-F1 + o delta da Nota
# (+ o do Aviso, 0|0). Substitui a referência do Aviso (`…_com_aviso_detalhe.txt`), que fica VELHA com a Nota.
# SÓ LEITURA (txn READ ONLY). Roda o DONO:  /bin/bash <worktree>/.superpowers/nota/mig/ref-volta-f1.sh
set -uo pipefail
BF1="/Users/sunglee/PLM + Criação/savepoints/pre-apply-f1-kanban-auto"
N="/Users/sunglee/PLM + Criação/savepoints/pre-apply-nota-entrada"
RB="/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-22-kanban-automatico-f1-banco"
# O bloco de apoio da F1 só DEFINE coisas (fidelidade, FIDEL_DET, CONT, D="$BF1"…) e dá cd no checkout principal.
source "$BF1/bloco_apoio_v2.sh" || exit 1
PROD="$(cat /tmp/dburl.txt)"
PRE="$D/fidelidade_prod_pre_detalhe.txt"
[ -s "$PRE" ] || { echo "PARE: falta $PRE (retrato pré-F1 do Step 4 da F1) — sem ele não há referência"; exit 1; }
[ -s "$N/cont-antes-nota.txt" ] && [ -s "$N/cont-depois-nota.txt" ] || { echo "PARE: faltam $N/cont-{antes,depois}-nota.txt (ida-producao.sh)"; exit 1; }
fidelidade "$PROD" "$D/fidelidade_prod_pos_nota.txt" "$D/fidelidade_prod_pos_nota_detalhe.txt" > /dev/null \
  || { echo "FALHOU: não li a fidelidade de produção"; exit 1; }
AVISO=$(psql "$PROD" -X -q -A -t -c "select to_regclass('public.avisos_globais') is not null") || exit 1
# chave = o que vem antes do 1º "=" (categoria:objeto). "[(]" = parêntese literal (nada de \( no awk).
PAT='gerar_parcelas_oc_tecido[(]|gerar_parcelas_oc_aviamento[(]|gerar_parcelas_oc_p_acabado[(]|_recalcular_parcelas_core[(]|recalcular_parcelas_etiqueta[(]|_salvar_oc_tecido_core[(]|_salvar_oc_aviamento_core[(]|salvar_oc_etiqueta[(]|_salvar_oc_p_acabado_core[(]|_salvar_oc_importado_core[(]|fn_oc_nota_entrada_|trg_nota_entrada_|trg_gerar_parcelas_ocpa|data_nota_entrada'
[ "$AVISO" = t ] && PAT="$PAT|avisos_globais"
NN=$(awk -F'=' -v pat="$PAT" '$1 ~ pat' "$D/fidelidade_prod_pos_nota_detalhe.txt" | grep -c .)
[ "$NN" -gt 0 ] || { echo "PARE: nenhuma linha da Nota no retrato — a Nota está mesmo em produção?"; exit 1; }
if awk -F'=' '$1 ~ /data_nota_entrada|fn_oc_nota_entrada_|trg_nota_entrada_/' "$PRE" | grep -q .; then
  echo "PARE: o retrato pré-F1 já tem objetos da Nota — ordem trocada?"; exit 1
fi
REF="$D/fidelidade_ref_volta_f1_pos_nota_detalhe.txt"
{ awk -F'=' -v pat="$PAT" '!($1 ~ pat)' "$PRE"; awk -F'=' -v pat="$PAT" '$1 ~ pat' "$D/fidelidade_prod_pos_nota_detalhe.txt"; } | LC_ALL=C sort > "$REF"
BASE=$(cat "$D/contagens.txt" 2>/dev/null || echo "427|219")
A=$(cat "$N/cont-antes-nota.txt"); P=$(cat "$N/cont-depois-nota.txt")
CV="$(( ${BASE%|*} + ${P%|*} - ${A%|*} ))|$(( ${BASE#*|} + ${P#*|} - ${A#*|} ))"
echo "$CV" > "$D/cont_volta_f1_pos_nota.txt"
{
  echo "# Volta de emergência da F1 DEPOIS da Nota de Entrada ($(date '+%F %T'); Aviso em produção: $AVISO)"
  echo "# No runbook v2 §9.2 (task-18-runbook-v2.md:788-791) trocar as 2 conferências finais por:"
  echo "espera \"\$PROD\" \"\$CONT\" \"$CV\" \"contagens pós-volta (com a Nota)\" &&"
  echo "fidelidade \"\$PROD\" \"\$D/fidelidade_prod_pos_volta.txt\" \"\$D/fidelidade_prod_pos_volta_detalhe.txt\" > /dev/null &&"
  echo "diff \"\$D/fidelidade_ref_volta_f1_pos_nota_detalhe.txt\" <(LC_ALL=C sort \"\$D/fidelidade_prod_pos_volta_detalhe.txt\") && echo \"== VOLTA OK (com a Nota)\""
  echo "# (a referência do Aviso, fidelidade_ref_volta_f1_com_aviso_detalhe.txt, está SUPERADA por esta)"
} | tee "$D/LEIA-volta-f1-pos-nota.txt" > "$RB/VOLTA-F1-POS-NOTA.md"
echo "OK (referência nova p/ a volta da F1): $REF — retrato pré-F1 sem os objetos da Nota/Aviso + $NN linha(s) atuais deles; CONT esperado da volta: $CV"
echo "Gravado ao lado do runbook da F1: $RB/VOLTA-F1-POS-NOTA.md (e $D/LEIA-volta-f1-pos-nota.txt)"
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada"
mkdir -p .superpowers/nota/logs
chmod +x .superpowers/nota/copia.sh .superpowers/nota/mig/*.sh
for f in .superpowers/nota/copia.sh .superpowers/nota/mig/*.sh; do bash -n "$f" && echo "sintaxe ok $f"; done
```

- [ ] **Step 2: Ensaio — pré-voo R4 → suítes R5 ANTES → ida (`aplica_v2`) → suítes DEPOIS → volta → suíte com a migration na txn → laço do inverso MEDIDO numa txn desfeita (R9-a/R9-b)**

Avisar o dono ANTES (texto do `prevoo-copia.sh`; ~15–20 min; o `:5188` congela nas OCs/Estoque/Financeiro em trechos — o mais longo é a medição do R9-b, uma transação que segura as 5 tabelas de OC da cópia pelo tempo dela, **até 3 min** (teto de 180 s), e é DESFEITA no fim: nenhum dado da cópia muda). Com o OK:

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada"
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres   # NUNCA sem ele: o fallback é PRODUÇÃO
export NOTA_DONO_AVISADO=sim
L=.superpowers/nota/logs
R5="tests/integration/invariantes.test.ts tests/integration/oc-p-acabado.test.ts tests/integration/rpc-oc-tecido.test.ts tests/integration/rpc-oc-aviamento.test.ts tests/integration/rpc-negocio.test.ts tests/integration/rpc-alerta-guards.test.ts tests/integration/batch2-guardas.test.ts"
falhas() { grep -E "^ FAIL " "$1" | sed -E 's/ +[0-9]+ms$//' | sort -u; }
bash .superpowers/nota/prevoo-copia.sh t4-r5-antes || exit 1
npx vitest run --no-file-parallelism $R5 > $L/r5-antes.log 2>&1; tail -4 $L/r5-antes.log; falhas $L/r5-antes.log > $L/r5-falhas-antes.txt
bash .superpowers/nota/copia.sh ida || exit 1
npx vitest run --no-file-parallelism tests/integration/nota-entrada.test.ts 2>&1 | tail -5
npx vitest run --no-file-parallelism $R5 > $L/r5-depois.log 2>&1; tail -4 $L/r5-depois.log; falhas $L/r5-depois.log > $L/r5-falhas-depois.txt
comm -13 $L/r5-falhas-antes.txt $L/r5-falhas-depois.txt | sed 's/^/FALHA NOVA: /'; echo "r5-comparado ($(wc -l < $L/r5-falhas-antes.txt) herdadas)"
bash -c 'source .superpowers/nota/mig/aplica.sh && confere_md5 "$LOCAL" .superpowers/nota/mig/md5-depois.txt "ensaio: 12 funções = Task 3"'
bash .superpowers/nota/copia.sh volta || exit 1                        # volta REAL com 0 OC datada
bash -c 'source .superpowers/nota/mig/aplica.sh && confere_md5 "$LOCAL" .superpowers/nota/mig/md5-antes.txt "cópia de volta ao texto de 24/set"'
bash .superpowers/nota/prevoo-copia.sh t4-mig-txn && NOTA_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/nota-entrada.test.ts 2>&1 | tail -5
# R9-b: laço do inverso com VOLUME REAL numa transação DESFEITA (migration → datar as OCs recebidas → ida de novo → inverso
# cronometrado por clock_timestamp() → ROLLBACK). Retrato SÓ LEITURA antes e depois: tem de sair igual (resíduo zero).
bash .superpowers/nota/copia.sh retrato > $L/retrato-antes.txt || exit 1
bash .superpowers/nota/prevoo-copia.sh t4-medir || exit 1
NOTA_MIG_TXN=1 NOTA_MEDIR_VOLTA="$PWD/.superpowers/nota/mig/volta-medida.txt" \
  npx vitest run --no-file-parallelism tests/integration/nota-entrada.test.ts -t "R9-b: mede" 2>&1 | grep -E "\[R9-b\]|Tests|FAIL|Error" | head -12
bash .superpowers/nota/copia.sh retrato > $L/retrato-depois.txt || exit 1
cmp -s $L/retrato-antes.txt $L/retrato-depois.txt && echo "RETRATO IDÊNTICO — resíduo zero" || { echo "RETRATO MUDOU"; diff $L/retrato-antes.txt $L/retrato-depois.txt; }
cat .superpowers/nota/mig/volta-medida.txt
cat .superpowers/nota/copia-estado.md
unset DATABASE_URL NOTA_DONO_AVISADO
```

Expected:
- `ida`: `antes: funções|gatilhos = 458|263 · Nota = 0|0|f|f` (ou os números do T0), `PRÉ-VOO OK`, o `aplica_v2` com o tempo do arquivo (`real` — anotar: é o teto de quanto a migration segura as 5 tabelas de OC em produção; esperado < 1 s), `OK (5 colunas, 8 gatilhos, 2 funções novas)`, `OK (contagens +2 funções +8 gatilhos): 460|271`, `OK (internas …): 0`, `OK (as 12 funções no texto desta migration)`, `== CÓPIA: ida OK (458|263 → 460|271)`.
- A suíte da Nota sem `NOTA_MIG_TXN` → `9 passed | 6 skipped`.
- **R5:** nenhuma linha `FALHA NOVA:` — o conjunto de falhas dos 7 arquivos que já cobrem parcelas/OCs depois da ida é ⊆ o de antes (débito pré-existente conhecido; a comparação é por conjunto). Falha nova = PARE (a migration mudou comportamento fora do desenho) → revisor Opus.
- `OK (ensaio: 12 funções = Task 3)`.
- `volta` → `laço do inverso: 0 OC(s) datada(s) (tecido|aviamento|insumo|p.acabado = 0|0|0|0)`, `== inverso com lock_timeout 500ms e transaction_timeout 30s`, `OK (a Nota saiu)`, `OK (contagens = antes da ida)`, `OK (as 10 funções de volta ao texto de 24/set)`, `== CÓPIA: volta OK (460|271 → 458|263)`; `OK (cópia de volta ao texto de 24/set)`; a suíte com `NOTA_MIG_TXN=1` → `13 passed | 2 skipped` (a captura e a medição pulam sem as variáveis delas); 2 linhas em `copia-estado.md` (ida, volta).
- **R9-b, medição numa txn DESFEITA:** `Tests 1 passed | 14 skipped` e a linha `[R9-b] N OC(s) datada(s) (tecido|aviamento|insumo|p.acabado = a|b|c|d) · datar Xs · ida Ys / com datas Zs · volta Ts (≈ s por OC) → mínimo Ms; o inverso tem 30s`. No levantamento só-leitura do guardião (24/set) o alvo é **48** OCs de 3 lojas — `46|1|1|0` (Tecido: Ave Rara 38, Loja Teste 7, French 1), 162 parcelas não pagas e 4 pagas; outro número = a cópia mudou desde então (registrar, não é erro). `volta-medida.txt` com `modo=txn-desfeita`, `n_familias`, `n_copia`, `t_ida_txn`, `t_datar`, `t_ida_datada`, `t_volta`, `s_por_oc`, `tt_minimo` (= máx(30, ⌈5 × t_volta⌉)) e `tt_inverso`. A ida (`t_ida_txn`, `t_ida_datada`): parecidas e ≤ 0,6 s (a ida não tem DML fora de corpo de função — o gerador recusa); **mais que 0,6 s = PARE** (os 3 s da ida ficam sem folga de 5×) → controlador; não subir o tempo da ida sem o guardião. O teste grava o arquivo ANTES de conferir: se ele falhar em `retrato()` (Σ por OC ou pagas diferentes depois da volta), o tempo vale, mas há OC com parcelas que não fecham com o total dela desde antes — listar e levar ao controlador. `N = 0` = falha (sem volume a medição não vale).
- **Resíduo zero:** `RETRATO IDÊNTICO — resíduo zero` (parcelas e as 5 OCs com as linhas INTEIRAS iguais — ids, vencimentos, `dias_offset`, `rev` — e o mesmo nº de linhas no `audit_log`). `RETRATO MUDOU` = PARE: conferir no `audit_log` quem escreveu entre os dois retratos; uso do dono no `:5188` nesse intervalo = repetir o par de retratos com a cópia parada; sem autoria = BLOQUEIO → controlador.
- `-- espera de trava/tempo` = alguém segurava as OCs da cópia; o `aplica_v2` repete sozinho (nada do arquivo ficou). Qualquer `FALHOU`/`PAROU`/`PARE`: não seguir; registrar e chamar o controlador (restauração do backup só com OK do dono). A medição do R9-b bater no teto de 180 s = PARE (a txn é desfeita sozinha; nada fica) → controlador: acima de 60 s de volta o resultado já seria PARE (`tt_minimo` > 300 s), então medir mais longe não muda a decisão.

- [ ] **Step 2b (R9-a): transaction_timeout do inverso pela medição**

```bash
M=.superpowers/nota/mig
TTM=$(sed -n 's/^tt_minimo=//p' $M/volta-medida.txt); TTI=$(sed -n 's/^tt_inverso=//p' $M/volta-medida.txt)
echo "tt_minimo=${TTM}s tt_inverso=${TTI}s"
if [ "$TTM" -gt "$TTI" ]; then
  python3 $M/gerar_sql.py --tt-inverso "$TTM" && git diff --stat -- supabase/ && git diff -U0 -- supabase/rollback/ | grep '^[-+][^-+]'
fi
```

Expected: `tt_minimo ≤ tt_inverso` → nada a fazer (o inverso fica com 30 s; registrar). Se `tt_minimo` for maior: o `git diff --stat` mostra SÓ o inverso, com 2 linhas trocadas (o comentário do cabeçalho com o `--tt-inverso` e o `SET LOCAL transaction_timeout`); a migration NÃO muda. Então: pré-voo R4 + a suíte do Task 3 Step 4 (`NOTA_MIG_TXN=1` → `13 passed | 2 skipped`), `bash .superpowers/nota/gates.sh` → `GATES NOTA: ok`, e `git commit --only -m "fix(nota-entrada): inverso com transaction_timeout de ${TTM}s (R9-a — volta medida no ensaio)" -m "Co-Authored-By: <seu modelo> <noreply@anthropic.com>" -- supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql`; `grava_medida tt_inverso $TTM` (`bash -c 'source .superpowers/nota/mig/aplica.sh && grava_medida tt_inverso '"$TTM"`). Qualquer outra linha no diff = PARE. Um `tt_minimo` acima de 300 s = PARE e levar ao controlador (uma volta de emergência de minutos pede outro desenho, ex.: laço em lotes).

- [ ] **Step 2c (registro):** colar a saída inteira (com o tempo do `aplica_v2`, as medições de `volta-medida.txt`, o `RETRATO IDÊNTICO` e o resultado R5) no diário do guardião — o MESMO da campanha: `/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-22-unificacao-kanban-auto/guardiao.md` (append, seção "Nota de Entrada"). Sem commit.

---

## Task 5: Peças de tela compartilhadas — `NotaEntrada.tsx`  *(Lote A)*

**Files:**
- Create: `src/components/shared/NotaEntrada.tsx`

**Interfaces:**
- Consumes (Task 1): `COLUNA_PARCELA_POR_FAMILIA`, `DICA_CAMPO_NOTA`, `ROTULO_DATA_NOTA`, `TEXTO_PARCELA_PROVISORIA`, `TITULO_BOLINHA`, `textoAvisoFaltaNota`, `validarDataNota`, `FamiliaOc`; `DateField` (`src/components/shared/DateField.tsx`: `value/onChange/disabled/id/max/aria-label/data-colab-path/inputClassName`); `useStoreTimezone` (`src/hooks/useStoreTimezone.ts`), `todayISOInStoreTZ` (`src/lib/timezone.ts`); `supabase` (`@/integrations/supabase/client`).
- Produces:
  - `CampoDataNotaEntrada(props: { value: string; onChange: (iso: string) => void; disabled?: boolean; dica?: string; colabPath?: string; inputClassName?: string; className?: string; children?: ReactNode })`
  - `AvisoFaltaNota(props: { show: boolean; familia: FamiliaOc; ocId: string | null | undefined })` — `data-qa="aviso-falta-nota"`; conta as parcelas NÃO pagas da OC (queryKey `["nota-parcelas-a-pagar", familia, ocId]`) e escolhe o texto (D6)
  - `useValidarDataNota(): (nota, dataPedido) => string | null` — D7 com "hoje" no fuso da loja
  - `BolinhaFaltaNota(props: { show: boolean })` — `data-qa="bolinha-falta-nota"`
  - `TagParcelaProvisoria(props: { show: boolean; className?: string })` — `data-qa="tag-parcela-provisoria"`

- [ ] **Step 1: Implementar** — `src/components/shared/NotaEntrada.tsx`:

```tsx
import { useId, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { DateField } from "@/components/shared/DateField";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { todayISOInStoreTZ } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import {
  COLUNA_PARCELA_POR_FAMILIA, DICA_CAMPO_NOTA, ROTULO_DATA_NOTA, TEXTO_PARCELA_PROVISORIA, TITULO_BOLINHA,
  textoAvisoFaltaNota, validarDataNota, type FamiliaOc,
} from "@/lib/nota-entrada";

/**
 * Peças de tela da "Data da Nota de Entrada" (spec 2026-09-24 §5). Regras em `@/lib/nota-entrada` — aqui só apresentação.
 * Cor SÓ por token de tom (§Q9): `--tone-warning-*` e `bg-warning` — nada de hex/hsl solto (anti-drift).
 */

/** Campo do cabeçalho das 5 OCs. SEMPRE `<DateField>` (dd/mm/aaaa na tela, ISO por baixo) — nunca o input nativo de data.
 *  O calendário não oferece dia futuro (fuso da loja); a regra completa (D7) é validada no Salvar e no banco. */
export function CampoDataNotaEntrada({
  value, onChange, disabled, dica = DICA_CAMPO_NOTA, colabPath = "data_nota_entrada", inputClassName, className, children,
}: {
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  dica?: string;
  colabPath?: string;
  inputClassName?: string;
  className?: string;
  /** Ex.: aviso de conflito colaborativo logo abaixo do campo. */
  children?: ReactNode;
}) {
  const id = useId();
  const hoje = todayISOInStoreTZ(useStoreTimezone());
  return (
    <div className={cn("grid gap-1", className)}>
      <Label htmlFor={id}>{ROTULO_DATA_NOTA}</Label>
      <DateField
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        max={hoje}
        data-colab-path={colabPath}
        inputClassName={inputClassName}
        aria-label={ROTULO_DATA_NOTA}
      />
      <p className="text-xs text-muted-foreground">{dica}</p>
      {children}
    </div>
  );
}

/** Validação da data no Salvar (D7): `(nota, dataPedido) => mensagem PT | null`, com "hoje" no fuso da loja. */
export function useValidarDataNota(): (nota: string | null | undefined, dataPedido: string | null | undefined) => string | null {
  const tz = useStoreTimezone();
  return (nota, dataPedido) => validarDataNota(nota, dataPedido, todayISOInStoreTZ(tz));
}

/** Aviso no topo da OC recebida sem a data. Com parcela a pagar: o texto aprovado ("…provisórios"); toda paga ou valor 0:
 *  só "Falta a Data da Nota de Entrada" (D6). Conta as não pagas da OC (mesma régua do banco). */
export function AvisoFaltaNota({ show, familia, ocId }: { show: boolean; familia: FamiliaOc; ocId: string | null | undefined }) {
  const coluna = COLUNA_PARCELA_POR_FAMILIA[familia];
  const { data: temParcelaAPagar } = useQuery({
    queryKey: ["nota-parcelas-a-pagar", familia, ocId],
    enabled: show && !!ocId && !!coluna,
    queryFn: async () => {
      const { count, error } = await (supabase.from("parcelas") as any)
        .select("id", { count: "exact", head: true })
        .eq(coluna, ocId)
        .is("data_pagamento", null)
        .or("status.is.null,status.neq.pago");
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });
  if (!show) return null;
  return (
    <div
      role="status"
      data-qa="aviso-falta-nota"
      className="flex items-start gap-2 rounded-md border border-warning/40 bg-[var(--tone-warning-bg)] px-3 py-2 text-sm text-[var(--tone-warning-fg)]"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{textoAvisoFaltaNota(temParcelaAPagar)}</span>
    </div>
  );
}

/** Bolinha amarela ao lado do nº da OC nas listas. */
export function BolinhaFaltaNota({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      role="img"
      aria-label={TITULO_BOLINHA}
      title={TITULO_BOLINHA}
      data-qa="bolinha-falta-nota"
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-warning"
    />
  );
}

/** Indicação da parcela provisória no Financeiro (lista, agenda, popover do dia, próximas, detalhe). */
export function TagParcelaProvisoria({ show, className }: { show: boolean; className?: string }) {
  if (!show) return null;
  return (
    <span
      data-qa="tag-parcela-provisoria"
      className={cn("flex items-center gap-1 text-[11px] font-medium text-[var(--tone-warning-fg)]", className)}
    >
      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
      {TEXTO_PARCELA_PROVISORIA}
    </span>
  );
}
```

- [ ] **Step 2: Gate (inclui o anti-drift de UI) + commit**

```bash
bash .superpowers/nota/gates.sh
grep -nE '#[0-9a-fA-F]{3,8}\b|hsl\(|toFixed\(' src/components/shared/NotaEntrada.tsx; echo "sem-cor-solta-checado"
git add -- src/components/shared/NotaEntrada.tsx
git commit --only -m "feat(nota-entrada): peças de tela — campo (DateField), aviso, bolinha e tag de parcela provisória" -m "Co-Authored-By: <seu modelo> <noreply@anthropic.com>" -- src/components/shared/NotaEntrada.tsx
```

Expected: `GATES NOTA: ok`; o grep não acha nada (só `sem-cor-solta-checado`).

---

## Task 6: OC Tecido  *(Lote B)*

**Files:**
- Modify: `src/components/oc-tecido/shared.ts` (tipo `OC`, `Draft`, `emptyDraft`)
- Modify: `src/components/oc-tecido/OcTecidoForm.tsx` (campo no bloco de pagamento)
- Modify: `src/components/oc-tecido/OcTecidoList.tsx` (bolinha)
- Modify: `src/routes/_authenticated/entrada-saida.oc-tecido.tsx` (draft, rótulo, payload, aviso, prévia, invalidação)

**Interfaces:**
- Consumes: Task 1 (`baseVencimento`, `faltaNotaEntrada`, `invalidarVencimentos`, `payloadDataNota`, `ROTULO_DATA_NOTA`), Task 5 (`AvisoFaltaNota`, `BolinhaFaltaNota`, `CampoDataNotaEntrada`), Task 3 (`_oc.data_nota_entrada` em `salvar_oc_tecido`; `select("*")` já traz a coluna).
- Produces: `Draft.data_nota_entrada: string` e `OC.data_nota_entrada?: string | null` (tecido).

Cada edição = trocar o trecho EXATO (único no arquivo, conferido em 24/set) pelo novo. Se um trecho não for achado exatamente 1 vez: PARE e registre em `.superpowers/nota/ancoras-divergentes.md`.

- [ ] **Step 1: `src/components/oc-tecido/shared.ts`**

(a) tipo `OC` — trocar
```ts
  recebimento_responsavel_nome: string | null;
};
```
por
```ts
  recebimento_responsavel_nome: string | null;
  // Data da Nota de Entrada (spec 2026-09-24): base do vencimento; vazia em OC recebida = vencimento provisório.
  data_nota_entrada?: string | null;
};
```
(b) `Draft` — trocar
```ts
  data_entrega: string;
  anexo_pedido_url: string | null;
```
por
```ts
  data_entrega: string;
  data_nota_entrada: string; // ISO yyyy-MM-dd ou "" (sem data)
  anexo_pedido_url: string | null;
```
(c) `emptyDraft` — trocar
```ts
    data_entrega: "",
    anexo_pedido_url: null,
```
por
```ts
    data_entrega: "",
    data_nota_entrada: "",
    anexo_pedido_url: null,
```

- [ ] **Step 2: `src/components/oc-tecido/OcTecidoForm.tsx`**

(a) import — trocar `import { DateField } from "@/components/shared/DateField";` por
```ts
import { DateField } from "@/components/shared/DateField";
import { CampoDataNotaEntrada } from "@/components/shared/NotaEntrada";
```
(b) trocar `  const cDataEntrega = campo("data_prevista_entrega");` por
```ts
  const cDataEntrega = campo("data_prevista_entrega");
  const cNota = campo("data_nota_entrada");
```
(c) fim do bloco "Par pagamento ao fornecedor" — trocar
```tsx
            <NumberInput type="number" integer value={draft.quantidade_prazos} readOnly disabled />
          </div>
        </div>
```
por
```tsx
            <NumberInput type="number" integer value={draft.quantidade_prazos} readOnly disabled />
          </div>
          {/* Data da Nota de Entrada (spec 2026-09-24): o prazo acima conta a partir dela. Editável mesmo com a OC recebida. */}
          <CampoDataNotaEntrada
            className="sm:col-span-2"
            value={draft.data_nota_entrada}
            onChange={(v) => setDraft((d) => ({ ...d, data_nota_entrada: v }))}
            colabPath={cNota["data-colab-path"]}
            inputClassName={cNota.className}
          >
            {cNota.conflito && (
              <ConflitoAviso conflito={cNota.conflito} onResolver={(useDele) => colab.onResolverConflito(cNota.conflito!, useDele)} />
            )}
          </CampoDataNotaEntrada>
        </div>
```

- [ ] **Step 3: `src/components/oc-tecido/OcTecidoList.tsx`**

(a) trocar `import { OcPrazoBadge } from "@/components/shared/oc-prazo-badge";` por
```ts
import { OcPrazoBadge } from "@/components/shared/oc-prazo-badge";
import { BolinhaFaltaNota } from "@/components/shared/NotaEntrada";
import { faltaNotaEntrada } from "@/lib/nota-entrada";
```
(b) SUBSTITUIR TODAS as 2 ocorrências (celular: Encomendadas e Recebidas) de
```tsx
<span className="font-medium">{o.numero_pedido ?? "—"}</span>
```
por
```tsx
<span className="font-medium">{o.numero_pedido ?? "—"}</span><BolinhaFaltaNota show={faltaNotaEntrada("tecido", o)} />
```
(c) tabela Encomendadas — trocar
```tsx
                      {o.numero_pedido ?? "—"}
                      <OcPrazoBadge
```
por
```tsx
                      <span className="inline-flex items-center gap-2">{o.numero_pedido ?? "—"}<BolinhaFaltaNota show={faltaNotaEntrada("tecido", o)} /></span>
                      <OcPrazoBadge
```
(d) tabela Recebidas — trocar
```tsx
                        {o.numero_pedido ?? "—"}
                        {ab && <StatusBadge
```
por
```tsx
                        {o.numero_pedido ?? "—"}
                        <BolinhaFaltaNota show={faltaNotaEntrada("tecido", o)} />
                        {ab && <StatusBadge
```

- [ ] **Step 4: `src/routes/_authenticated/entrada-saida.oc-tecido.tsx`**

(a) trocar `import { mensagemErro } from "@/lib/erro-mensagem";` por
```ts
import { mensagemErro } from "@/lib/erro-mensagem";
import { baseVencimento, faltaNotaEntrada, invalidarVencimentos, payloadDataNota, ROTULO_DATA_NOTA } from "@/lib/nota-entrada";
import { AvisoFaltaNota, useValidarDataNota } from "@/components/shared/NotaEntrada";
```
(b) `draftFromOc` — trocar
```ts
    data_entrega: oc.data_entrega ?? "",
    anexo_pedido_url: oc.anexo_pedido_url,
```
por
```ts
    data_entrega: oc.data_entrega ?? "",
    data_nota_entrada: oc.data_nota_entrada ?? "",
    anexo_pedido_url: oc.anexo_pedido_url,
```
(c) `ROTULO_CONFLITO` — trocar
```ts
  data_entrega: "Data de entrega",
  anexo_pedido_url: "Anexo do pedido",
```
por
```ts
  data_entrega: "Data de entrega",
  data_nota_entrada: ROTULO_DATA_NOTA,
  anexo_pedido_url: "Anexo do pedido",
```
(d) payload — trocar
```ts
        data_entrega: markReceived ? (lastDate || null) : (draft.data_entrega || null),
```
por
```ts
        data_entrega: markReceived ? (lastDate || null) : (draft.data_entrega || null),
        data_nota_entrada: payloadDataNota(draft.data_nota_entrada), // chave SEMPRE presente: "" limpa (spec §4.3)
```
(e) `onSuccess` do save — trocar
```ts
      markClean();
      qc.invalidateQueries({ queryKey: ["ocs_tecido"] });
```
por
```ts
      markClean();
      invalidarVencimentos(qc); // Data da Nota de Entrada: vencimentos podem ter mudado (Financeiro, dashboard, visão da OC)
      qc.invalidateQueries({ queryKey: ["ocs_tecido"] });
```
(f) aviso — trocar
```tsx
          <OcTecidoForm
            draft={draft}
```
por
```tsx
          <AvisoFaltaNota show={faltaNotaEntrada("tecido", { status, data_nota_entrada: draft.data_nota_entrada })} familia="tecido" ocId={ocId} />
          <OcTecidoForm
            draft={draft}
```
(g) prévia do "Marcar recebido" — trocar `          baseDataISO={ultimaDataEntrega(draft)}` por
```tsx
          baseDataISO={baseVencimento(draft.data_nota_entrada, ultimaDataEntrega(draft))}
```
(h) comentário do espelho — trocar `// vencimento_i = base + dias[i] (fallback base + i*30), base = data de entrega (senão hoje);` por
```ts
// vencimento_i = base + dias[i] (fallback base + i*30), base = Data da Nota de Entrada, senão data de entrega, senão hoje;
```
(i) D7 (decidido pelo dono 24/set) — o validador, no corpo do `OcDialog`: trocar
```ts
  const isEdit = !!ocId;
```
por
```ts
  const isEdit = !!ocId;
  const validarNota = useValidarDataNota(); // D7 (decidido pelo dono 24/set): não futura, não antes do pedido
```
(j) no `saveMutation` — trocar
```ts
      if (!draft.prazo_pagamento?.trim()) throw new Error("Informe o Prazo de Pagamento.");
```
por
```ts
      if (!draft.prazo_pagamento?.trim()) throw new Error("Informe o Prazo de Pagamento.");
      { const erroNota = validarNota(draft.data_nota_entrada, draft.data_pedido); if (erroNota) throw new Error(erroNota); } // D7
```

- [ ] **Step 5: Conferir e gate**

```bash
grep -c "BolinhaFaltaNota show" src/components/oc-tecido/OcTecidoList.tsx          # 4
grep -c "data_nota_entrada" src/routes/_authenticated/entrada-saida.oc-tecido.tsx   # 6
grep -c "CampoDataNotaEntrada" src/components/oc-tecido/OcTecidoForm.tsx            # 3
grep -c "useValidarDataNota\|validarNota(" src/routes/_authenticated/entrada-saida.oc-tecido.tsx   # 3
bash .superpowers/nota/gates.sh
```

Expected: `4`, `6`, `3`, `3`; `GATES NOTA: ok`.

- [ ] **Step 6: Commit**

```bash
P="src/components/oc-tecido/shared.ts src/components/oc-tecido/OcTecidoForm.tsx src/components/oc-tecido/OcTecidoList.tsx src/routes/_authenticated/entrada-saida.oc-tecido.tsx"
git add -- $P
git commit --only -m "feat(nota-entrada): OC Tecido — campo Data da Nota de Entrada, aviso, bolinha, prévia pela data e invalidação do Financeiro" -m "Co-Authored-By: <seu modelo> <noreply@anthropic.com>" -- $P
```

---

## Task 7: OC Aviamento  *(Lote B)*

**Files:**
- Modify: `src/routes/_authenticated/entrada-saida.oc-aviamento.tsx`

**Interfaces:**
- Consumes: Tasks 1, 3, 5 (chave `_oc.data_nota_entrada` em `salvar_oc_aviamento` 4 args; `select("*")` traz a coluna).
- Produces: nada para outras tasks.

- [ ] **Step 1: Editar (trechos exatos)**

(a) trocar `import { mensagemErro } from "@/lib/erro-mensagem";` por
```ts
import { mensagemErro } from "@/lib/erro-mensagem";
import { faltaNotaEntrada, invalidarVencimentos, payloadDataNota, ROTULO_DATA_NOTA } from "@/lib/nota-entrada";
import { AvisoFaltaNota, BolinhaFaltaNota, CampoDataNotaEntrada, useValidarDataNota } from "@/components/shared/NotaEntrada";
```
(b) tipo `OC` — trocar
```ts
  data_entrega: string | null;
  prazo_pagamento: string | null;
```
por
```ts
  data_entrega: string | null;
  data_nota_entrada?: string | null;
  prazo_pagamento: string | null;
```
(c) `Draft` — trocar
```ts
  data_entrega: string;
  prazo_pagamento: string;
```
por
```ts
  data_entrega: string;
  data_nota_entrada: string; // ISO ou "" (spec 2026-09-24)
  prazo_pagamento: string;
```
(d) `emptyDraft` — trocar
```ts
    data_entrega: "",
    prazo_pagamento: "",
```
por
```ts
    data_entrega: "",
    data_nota_entrada: "",
    prazo_pagamento: "",
```
(e) `draftFromOc` — trocar
```ts
    data_entrega: oc.data_entrega ?? "",
    prazo_pagamento: oc.prazo_pagamento ?? "",
```
por
```ts
    data_entrega: oc.data_entrega ?? "",
    data_nota_entrada: oc.data_nota_entrada ?? "",
    prazo_pagamento: oc.prazo_pagamento ?? "",
```
(f) rótulo — trocar
```ts
    data_entrega: "Data de Entrega", prazo_pagamento: "Prazo de Pagamento", quantidade_prazos: "Nº de parcelas",
```
por
```ts
    data_entrega: "Data de Entrega", data_nota_entrada: ROTULO_DATA_NOTA, prazo_pagamento: "Prazo de Pagamento", quantidade_prazos: "Nº de parcelas",
```
(g) payload — trocar
```ts
        data_entrega: markReceived ? (lastDate || null) : (draft.data_entrega || null),
```
por
```ts
        data_entrega: markReceived ? (lastDate || null) : (draft.data_entrega || null),
        data_nota_entrada: payloadDataNota(draft.data_nota_entrada), // chave SEMPRE presente: "" limpa
```
(h) `onSuccess` — trocar
```ts
      toast.success("OC salva");
      markClean();
```
por
```ts
      toast.success("OC salva");
      markClean();
      invalidarVencimentos(qc);
```
(i) aviso — trocar
```tsx
          <section id="oca-sec-pedido" className="scroll-mt-2 space-y-4">
          <OcSecTitle n={1}>Pedido</OcSecTitle>
```
por
```tsx
          <section id="oca-sec-pedido" className="scroll-mt-2 space-y-4">
          <OcSecTitle n={1}>Pedido</OcSecTitle>
          <AvisoFaltaNota show={faltaNotaEntrada("aviamento", { status, data_nota_entrada: draft.data_nota_entrada })} familia="aviamento" ocId={ocId} />
```
(j) campo, logo depois do Prazo de Pagamento — trocar
```tsx
                placeholder="Ex: 30/60/90"
              />
            </div>
```
por
```tsx
                placeholder="Ex: 30/60/90"
              />
            </div>

            <CampoDataNotaEntrada
              value={draft.data_nota_entrada}
              onChange={(v) => setDraftTracked((d) => ({ ...d, data_nota_entrada: v }))}
            />
```
(k) listas — SUBSTITUIR TODAS as 2 ocorrências de
```tsx
<span className="font-medium">{o.numero_pedido ?? "—"}</span>
```
por
```tsx
<span className="font-medium">{o.numero_pedido ?? "—"}</span><BolinhaFaltaNota show={faltaNotaEntrada("aviamento", o)} />
```
e TODAS as 2 de
```tsx
<TableCell className="font-medium">{o.numero_pedido ?? "—"}</TableCell>
```
por
```tsx
<TableCell className="font-medium"><span className="inline-flex items-center gap-2">{o.numero_pedido ?? "—"}<BolinhaFaltaNota show={faltaNotaEntrada("aviamento", o)} /></span></TableCell>
```

(l) D7 (decidido pelo dono 24/set) — trocar
```ts
  const isEdit = !!ocId;
```
por
```ts
  const isEdit = !!ocId;
  const validarNota = useValidarDataNota(); // D7 (decidido pelo dono 24/set): não futura, não antes do pedido
```
(m) no `saveMutation` — trocar
```ts
      if (!draft.prazo_pagamento?.trim()) throw new Error("Informe o Prazo de Pagamento.");
```
por
```ts
      if (!draft.prazo_pagamento?.trim()) throw new Error("Informe o Prazo de Pagamento.");
      { const erroNota = validarNota(draft.data_nota_entrada, draft.data_pedido); if (erroNota) throw new Error(erroNota); } // D7
```

- [ ] **Step 2: Conferir, gate, commit**

```bash
F=src/routes/_authenticated/entrada-saida.oc-aviamento.tsx
grep -c "BolinhaFaltaNota show" $F      # 4
grep -c "data_nota_entrada" $F          # 10
grep -c "useValidarDataNota\|validarNota(" $F   # 3
bash .superpowers/nota/gates.sh
git add -- $F
git commit --only -m "feat(nota-entrada): OC Aviamento — campo, aviso, bolinha e invalidação do Financeiro" -m "Co-Authored-By: <seu modelo> <noreply@anthropic.com>" -- $F
```

Expected: `4`, `10`, `3`, `GATES NOTA: ok`.

---

## Task 8: OC Insumo  *(Lote B)*

**Files:**
- Modify: `src/routes/_authenticated/entrada-saida.oc-insumo.tsx`

**Interfaces:**
- Consumes: Tasks 1, 3, 5 (chave `_oc.data_nota_entrada` em `salvar_oc_etiqueta` 4 args). Família `"etiqueta"` (= `parcelas.tipo_oc`).
- Produces: `DraftHead.data_nota_entrada: string` (local ao arquivo).

O cabeçalho do Insumo usa estados SOLTOS montados num `DraftHead` para o merge 3-vias; o snapshot de "não salvo" é `JSON.stringify` — a ordem das chaves de `formState` e do `resetBaseline` TEM de ser a mesma (por isso `dataNota` entra logo depois de `dataPrevista` nos dois).

- [ ] **Step 1: Editar (trechos exatos)**

(a) trocar `import { mensagemErro } from "@/lib/erro-mensagem";` por
```ts
import { mensagemErro } from "@/lib/erro-mensagem";
import { faltaNotaEntrada, invalidarVencimentos, payloadDataNota, ROTULO_DATA_NOTA } from "@/lib/nota-entrada";
import { AvisoFaltaNota, BolinhaFaltaNota, CampoDataNotaEntrada, useValidarDataNota } from "@/components/shared/NotaEntrada";
```
(b) `DraftHead` — trocar
```ts
  data_prevista_entrega: string;
  prazo_pagamento: string;
```
por
```ts
  data_prevista_entrega: string;
  data_nota_entrada: string; // ISO ou "" (spec 2026-09-24)
  prazo_pagamento: string;
```
(c) trocar `  const [dataPrevista, setDataPrevista] = useState("");` por
```ts
  const [dataPrevista, setDataPrevista] = useState("");
  const [dataNota, setDataNota] = useState(""); // Data da Nota de Entrada (ISO ou "")
```
(d) `draftHead` — trocar
```ts
    data_prevista_entrega: dataPrevista,
    prazo_pagamento: prazo,
```
por
```ts
    data_prevista_entrega: dataPrevista,
    data_nota_entrada: dataNota,
    prazo_pagamento: prazo,
```
(e) `aplicarDraftHead` — trocar `    if (d.data_prevista_entrega !== dataPrevista) setDataPrevista(d.data_prevista_entrega);` por
```ts
    if (d.data_prevista_entrega !== dataPrevista) setDataPrevista(d.data_prevista_entrega);
    if (d.data_nota_entrada !== dataNota) setDataNota(d.data_nota_entrada);
```
(f) trocar `  const formState = { numero, empresaId, repId, respNome, dataPedido, dataPrevista, prazo, qtdPrazos, nfs, parcelas, blocks };` por
```ts
  const formState = { numero, empresaId, repId, respNome, dataPedido, dataPrevista, dataNota, prazo, qtdPrazos, nfs, parcelas, blocks };
```
(g) `headFromOc` — trocar
```ts
    data_prevista_entrega: oc.data_prevista_entrega ?? "",
    prazo_pagamento: oc.prazo_pagamento ?? "",
```
por
```ts
    data_prevista_entrega: oc.data_prevista_entrega ?? "",
    data_nota_entrada: oc.data_nota_entrada ?? "",
    prazo_pagamento: oc.prazo_pagamento ?? "",
```
(h) seed — trocar `      setDataPedido(freshHead.data_pedido); setDataPrevista(freshHead.data_prevista_entrega);` por
```ts
      setDataPedido(freshHead.data_pedido); setDataPrevista(freshHead.data_prevista_entrega); setDataNota(freshHead.data_nota_entrada);
```
(i) `resetBaseline` — trocar
```ts
        respNome: freshHead.responsavel_nome, dataPedido: freshHead.data_pedido, dataPrevista: freshHead.data_prevista_entrega,
```
por
```ts
        respNome: freshHead.responsavel_nome, dataPedido: freshHead.data_pedido, dataPrevista: freshHead.data_prevista_entrega, dataNota: freshHead.data_nota_entrada,
```
(j) rótulo — trocar `    prazo_pagamento: "Prazo de Pagamento", quantidade_prazos: "Nº de parcelas",` por
```ts
    data_nota_entrada: ROTULO_DATA_NOTA, prazo_pagamento: "Prazo de Pagamento", quantidade_prazos: "Nº de parcelas",
```
(k) payload — trocar `        prazo_pagamento: prazo || null, quantidade_prazos: qtdPrazos, nf_url: nfs[0]?.url ?? null, nfs,` por
```ts
        prazo_pagamento: prazo || null, quantidade_prazos: qtdPrazos, nf_url: nfs[0]?.url ?? null, nfs,
        data_nota_entrada: payloadDataNota(dataNota), // chave SEMPRE presente: "" limpa
```
(l) `onSuccess` — trocar `    onSuccess: () => { toast.success("OC salva"); markClean(); onSaved(); },` por
```ts
    onSuccess: () => { toast.success("OC salva"); markClean(); invalidarVencimentos(qc); onSaved(); },
```
(m) aviso — trocar `          <OcSecTitle n={1}>Pedido</OcSecTitle>` por
```tsx
          <OcSecTitle n={1}>Pedido</OcSecTitle>
          <AvisoFaltaNota show={faltaNotaEntrada("etiqueta", { status, data_nota_entrada: dataNota })} familia="etiqueta" ocId={ocId} />
```
(n) campo — trocar
```tsx
            <div className="grid gap-1"><Label>Data Prevista de Entrega</Label><DateField value={dataPrevista} onChange={(e) => { marcarHeadTouched("data_prevista_entrega"); setDataPrevista(e.target.value); }} disabled={readOnly} /></div>
```
por
```tsx
            <div className="grid gap-1"><Label>Data Prevista de Entrega</Label><DateField value={dataPrevista} onChange={(e) => { marcarHeadTouched("data_prevista_entrega"); setDataPrevista(e.target.value); }} disabled={readOnly} /></div>
            <CampoDataNotaEntrada value={dataNota} onChange={(v) => { marcarHeadTouched("data_nota_entrada"); setDataNota(v); }} disabled={readOnly} />
```
(o) lista (1 renderer para as 2 abas) — trocar `<span className="font-medium">{o.numero_pedido ?? "—"}</span>` por
```tsx
<span className="font-medium">{o.numero_pedido ?? "—"}</span><BolinhaFaltaNota show={faltaNotaEntrada("etiqueta", o)} />
```
e `<TableCell className="font-medium">{o.numero_pedido ?? "—"}</TableCell>` por
```tsx
<TableCell className="font-medium"><span className="inline-flex items-center gap-2">{o.numero_pedido ?? "—"}<BolinhaFaltaNota show={faltaNotaEntrada("etiqueta", o)} /></span></TableCell>
```

(p) D7 (decidido pelo dono 24/set) — trocar
```ts
  const isEdit = !!ocId;
```
por
```ts
  const isEdit = !!ocId;
  const validarNota = useValidarDataNota(); // D7 (decidido pelo dono 24/set): não futura, não antes do pedido
```
(q) no `saveMutation` — trocar
```ts
      const finalStatus: OCStatus = markReceived ? "recebido" : status;
```
por
```ts
      { const erroNota = validarNota(dataNota, dataPedido); if (erroNota) throw new Error(erroNota); } // D7
      const finalStatus: OCStatus = markReceived ? "recebido" : status;
```

- [ ] **Step 2: Conferir, gate, commit**

```bash
F=src/routes/_authenticated/entrada-saida.oc-insumo.tsx
grep -c "data_nota_entrada" $F          # 10
grep -c "setDataNota" $F                # 4
grep -c "BolinhaFaltaNota show" $F      # 2
grep -c "useValidarDataNota\|validarNota(" $F   # 3
bash .superpowers/nota/gates.sh
git add -- $F
git commit --only -m "feat(nota-entrada): OC Insumo — campo, aviso, bolinha, merge colaborativo e invalidação do Financeiro" -m "Co-Authored-By: <seu modelo> <noreply@anthropic.com>" -- $F
```

Expected: `10`, `4`, `2`, `3`, `GATES NOTA: ok`.

---

## Task 9: OC P. Acabado e OC P. Importado  *(Lote B)*

**Files:**
- Modify: `src/components/oc-p-acabado/shared.ts`, `src/components/oc-p-acabado/OcPaForm.tsx`, `src/routes/_authenticated/entrada-saida.oc-p-acabado.tsx`
- Modify: `src/components/oc-p-importado/shared.ts`, `src/components/oc-p-importado/OcImpForm.tsx`, `src/routes/_authenticated/entrada-saida.oc-p-importado.tsx`

**Interfaces:**
- Consumes: Tasks 1, 3, 5 (chave `_dados.data_nota_entrada` em `salvar_oc_p_acabado`/`salvar_oc_importado`; o "Receber" salva antes pelo mesmo `montarDados`).
- Produces: `Draft.data_nota_entrada: string` nos dois `shared.ts`; `OcPaRow.data_nota_entrada?: string | null`.

Regras: no P. Acabado as parcelas nascem no pedido — a data preenchida já é a base mesmo antes do recebimento; o alerta só acende recebida. O campo usa `disabled={disabled}` (permissão), NUNCA `valoresTravados` (a data é editável com a OC recebida). Importado: só o campo (dica própria), sem aviso nem bolinha (D2); o save dele passa a invalidar o Financeiro também (a gravação regenera as parcelas das etapas — pré-existente).

- [ ] **Step 1: `src/components/oc-p-acabado/shared.ts`**

(a) `OcPaRow` — trocar
```ts
  data_entrega: string | null;
  qtd_total: number | null;
```
por
```ts
  data_entrega: string | null;
  data_nota_entrada?: string | null;
  qtd_total: number | null;
```
(b) `Draft` — trocar
```ts
  // Recebimento (seção 4 — locked até salvar).
  data_entrega: string;
```
por
```ts
  // Data da Nota de Entrada (spec 2026-09-24): base do vencimento — no cabeçalho, editável mesmo com a OC recebida.
  data_nota_entrada: string;
  // Recebimento (seção 4 — locked até salvar).
  data_entrega: string;
```
(c) `emptyDraft` — trocar
```ts
    desconto_pct: 0,
    data_entrega: "",
```
por
```ts
    desconto_pct: 0,
    data_nota_entrada: "",
    data_entrega: "",
```

- [ ] **Step 2: `src/components/oc-p-acabado/OcPaForm.tsx`**

(a) trocar `import { DateField } from "@/components/shared/DateField";` por
```ts
import { DateField } from "@/components/shared/DateField";
import { CampoDataNotaEntrada } from "@/components/shared/NotaEntrada";
```
(b) trocar
```tsx
            <NumberInput type="number" integer value={draft.parcelas_entrega} readOnly disabled />
          </div>
```
por
```tsx
            <NumberInput type="number" integer value={draft.parcelas_entrega} readOnly disabled />
          </div>
          <CampoDataNotaEntrada
            value={draft.data_nota_entrada}
            disabled={disabled}
            onChange={(v) => setDraft((d) => ({ ...d, data_nota_entrada: v }))}
          />
```

- [ ] **Step 3: `src/routes/_authenticated/entrada-saida.oc-p-acabado.tsx`**

(a) trocar `import { mensagemErro } from "@/lib/erro-mensagem";` por
```ts
import { mensagemErro } from "@/lib/erro-mensagem";
import { faltaNotaEntrada, invalidarVencimentos, payloadDataNota, ROTULO_DATA_NOTA } from "@/lib/nota-entrada";
import { AvisoFaltaNota, BolinhaFaltaNota, useValidarDataNota } from "@/components/shared/NotaEntrada";
```
(b) lista — trocar
```ts
        .select("id, numero, nome_produto, produto_acabado_id, empresa_id, data_pedido, data_prevista, data_entrega, qtd_total, valor_total_desconto, status")
```
por
```ts
        .select("id, numero, nome_produto, produto_acabado_id, empresa_id, data_pedido, data_prevista, data_entrega, data_nota_entrada, qtd_total, valor_total_desconto, status")
```
(c) `draftFromOc` — trocar
```ts
    data_entrega: oc.data_entrega ?? "",
    nota_fiscal: oc.nota_fiscal ?? "",
```
por
```ts
    data_nota_entrada: oc.data_nota_entrada ?? "",
    data_entrega: oc.data_entrega ?? "",
    nota_fiscal: oc.nota_fiscal ?? "",
```
(d) rótulo — trocar `    data_entrega: "Data de Entrega", nota_fiscal: "Nota Fiscal", devolucao: "Devolução",` por
```ts
    data_nota_entrada: ROTULO_DATA_NOTA, data_entrega: "Data de Entrega", nota_fiscal: "Nota Fiscal", devolucao: "Devolução",
```
(e) `montarDados` — trocar
```ts
    prazo_pagamento: draft.prazo_pagamento || null,
    parcelas_entrega: draft.parcelas_entrega,
```
por
```ts
    prazo_pagamento: draft.prazo_pagamento || null,
    data_nota_entrada: payloadDataNota(draft.data_nota_entrada), // chave SEMPRE presente: "" limpa
    parcelas_entrega: draft.parcelas_entrega,
```
(f) `onSuccess` do save — trocar
```ts
      toast.success("OC salva.");
      markClean();
```
por
```ts
      toast.success("OC salva.");
      markClean();
      invalidarVencimentos(qc); // o save regenera as parcelas do Acabado (gatilho) — antes não invalidava o Financeiro
```
(g) `onSuccess` do receber — trocar
```ts
      toast.success("OC marcada como recebida.");
      setConfirmReceber(false);
      markClean();
```
por
```ts
      toast.success("OC marcada como recebida.");
      setConfirmReceber(false);
      markClean();
      invalidarVencimentos(qc);
```
(h) aviso — trocar
```tsx
            <ColabPresenceOverlay presentes={presentesColab} scopeRef={colabScopeRef} />
            <OcPaForm
```
por
```tsx
            <ColabPresenceOverlay presentes={presentesColab} scopeRef={colabScopeRef} />
            <AvisoFaltaNota show={faltaNotaEntrada("p_acabado", { status, data_nota_entrada: draft.data_nota_entrada })} familia="p_acabado" ocId={ocId} />
            <OcPaForm
```
(i) lista (1 renderer para as 2 abas) — trocar `<span className="font-medium">{o.numero ?? "—"}</span>` por
```tsx
<span className="font-medium">{o.numero ?? "—"}</span><BolinhaFaltaNota show={faltaNotaEntrada("p_acabado", o)} />
```
e `<TableCell className="font-medium">{o.numero ?? "—"}</TableCell>` por
```tsx
<TableCell className="font-medium"><span className="inline-flex items-center gap-2">{o.numero ?? "—"}<BolinhaFaltaNota show={faltaNotaEntrada("p_acabado", o)} /></span></TableCell>
```

(j) D7 (decidido pelo dono 24/set) — trocar
```ts
  const isEdit = !!ocId;
```
por
```ts
  const isEdit = !!ocId;
  const validarNota = useValidarDataNota(); // D7 (decidido pelo dono 24/set): não futura, não antes do pedido
```
(k) no save — trocar
```ts
      if (!draft.nome_produto.trim()) throw erroValidacao("Informe o nome do produto.");
```
por
```ts
      if (!draft.nome_produto.trim()) throw erroValidacao("Informe o nome do produto.");
      { const erroNota = validarNota(draft.data_nota_entrada, draft.data_pedido); if (erroNota) throw erroValidacao(erroNota); } // D7
```
(l) no receber (que salva antes) — trocar
```ts
        throw erroValidacao("Resolva os conflitos listados no aviso no topo antes de receber.");
```
por
```ts
        throw erroValidacao("Resolva os conflitos listados no aviso no topo antes de receber.");
      { const erroNota = validarNota(draft.data_nota_entrada, draft.data_pedido); if (erroNota) throw erroValidacao(erroNota); } // D7
```

- [ ] **Step 4: Importado — `src/components/oc-p-importado/shared.ts`, `OcImpForm.tsx` e a rota**

`shared.ts` (a) trocar
```ts
  // Recebimento (seção 4 — locked até salvar).
  data_entrega: string;
```
por
```ts
  // Data da Nota de Entrada (spec 2026-09-24): no Importado SÓ registro (vencimentos = etapas de câmbio).
  data_nota_entrada: string;
  // Recebimento (seção 4 — locked até salvar).
  data_entrega: string;
```
(b) trocar
```ts
    etapas: [],
    data_entrega: "",
```
por
```ts
    etapas: [],
    data_nota_entrada: "",
    data_entrega: "",
```
`OcImpForm.tsx` (c) trocar `import { DateField } from "@/components/shared/DateField";` por
```ts
import { DateField } from "@/components/shared/DateField";
import { CampoDataNotaEntrada } from "@/components/shared/NotaEntrada";
import { DICA_CAMPO_NOTA_IMPORTADO } from "@/lib/nota-entrada";
```
(d) trocar
```tsx
            <DateField value={draft.data_prevista} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, data_prevista: e.target.value }))} />
          </div>
```
por
```tsx
            <DateField value={draft.data_prevista} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, data_prevista: e.target.value }))} />
          </div>
          <CampoDataNotaEntrada
            value={draft.data_nota_entrada}
            disabled={disabled}
            dica={DICA_CAMPO_NOTA_IMPORTADO}
            onChange={(v) => setDraft((d) => ({ ...d, data_nota_entrada: v }))}
          />
```
Rota `entrada-saida.oc-p-importado.tsx` (e) trocar `import { mensagemErro } from "@/lib/erro-mensagem";` por
```ts
import { mensagemErro } from "@/lib/erro-mensagem";
import { invalidarVencimentos, payloadDataNota, ROTULO_DATA_NOTA } from "@/lib/nota-entrada";
import { useValidarDataNota } from "@/components/shared/NotaEntrada";
```
(f) `draftFromOc` — trocar
```ts
    data_entrega: oc.data_entrega ?? "",
    nota_fiscal: oc.nota_fiscal ?? "",
```
por
```ts
    data_nota_entrada: oc.data_nota_entrada ?? "",
    data_entrega: oc.data_entrega ?? "",
    nota_fiscal: oc.nota_fiscal ?? "",
```
(g) rótulo — trocar `    data_entrega: "Data de Entrega", nota_fiscal: "Nota Fiscal", devolucao: "Devolução",` por
```ts
    data_nota_entrada: ROTULO_DATA_NOTA, data_entrega: "Data de Entrega", nota_fiscal: "Nota Fiscal", devolucao: "Devolução",
```
(h) `montarDados` — trocar
```ts
    cotacao_final: draft.cotacao_final,
    nota_fiscal: draft.nota_fiscal || null,
```
por
```ts
    cotacao_final: draft.cotacao_final,
    data_nota_entrada: payloadDataNota(draft.data_nota_entrada), // só registro (spec D2)
    nota_fiscal: draft.nota_fiscal || null,
```
(i) `onSuccess` do save — trocar
```ts
      toast.success("OC salva.");
      markClean();
```
por
```ts
      toast.success("OC salva.");
      markClean();
      invalidarVencimentos(qc);
```
(j) `onSuccess` do receber — trocar
```ts
      toast.success("OC marcada como recebida.");
      setConfirmReceber(false);
      markClean();
```
por
```ts
      toast.success("OC marcada como recebida.");
      setConfirmReceber(false);
      markClean();
      invalidarVencimentos(qc);
```

(k) D7 (pendente do dono; vale também no Importado — o gatilho do banco valida as 5 OCs) — trocar
```ts
  const isEdit = !!ocId;
```
por
```ts
  const isEdit = !!ocId;
  const validarNota = useValidarDataNota(); // D7 (decidido pelo dono 24/set): não futura, não antes do pedido
```
(l) no save — trocar
```ts
      if (!draft.nome_produto.trim()) throw erroValidacao("Informe o nome do produto.");
```
por
```ts
      if (!draft.nome_produto.trim()) throw erroValidacao("Informe o nome do produto.");
      { const erroNota = validarNota(draft.data_nota_entrada, draft.data_pedido); if (erroNota) throw erroValidacao(erroNota); } // D7
```
(m) no receber — trocar
```ts
        throw erroValidacao("Resolva os conflitos listados no aviso no topo antes de receber.");
```
por
```ts
        throw erroValidacao("Resolva os conflitos listados no aviso no topo antes de receber.");
      { const erroNota = validarNota(draft.data_nota_entrada, draft.data_pedido); if (erroNota) throw erroValidacao(erroNota); } // D7
```

- [ ] **Step 5: Conferir, gate, commit**

```bash
grep -c "data_nota_entrada" src/routes/_authenticated/entrada-saida.oc-p-acabado.tsx     # 7
grep -c "BolinhaFaltaNota show" src/routes/_authenticated/entrada-saida.oc-p-acabado.tsx # 2
grep -c "data_nota_entrada" src/routes/_authenticated/entrada-saida.oc-p-importado.tsx   # 5
grep -c "useValidarDataNota\|validarNota(" src/routes/_authenticated/entrada-saida.oc-p-acabado.tsx src/routes/_authenticated/entrada-saida.oc-p-importado.tsx   # 4 e 4
grep -c "AvisoFaltaNota\|BolinhaFaltaNota" src/routes/_authenticated/entrada-saida.oc-p-importado.tsx  # 0 (D2)
bash .superpowers/nota/gates.sh
P="src/components/oc-p-acabado/shared.ts src/components/oc-p-acabado/OcPaForm.tsx src/routes/_authenticated/entrada-saida.oc-p-acabado.tsx src/components/oc-p-importado/shared.ts src/components/oc-p-importado/OcImpForm.tsx src/routes/_authenticated/entrada-saida.oc-p-importado.tsx"
git add -- $P
git commit --only -m "feat(nota-entrada): OC P. Acabado (base do vencimento, aviso, bolinha) e OC P. Importado (só registro) + invalidação do Financeiro" -m "Co-Authored-By: <seu modelo> <noreply@anthropic.com>" -- $P
```

Expected: `7`, `2`, `5`, `…oc-p-acabado.tsx:4` e `…oc-p-importado.tsx:4`, `0` (D2); `GATES NOTA: ok`.

---

## Task 10: Financeiro — parcela provisória em amarelo  *(individual Opus)*

**Files:**
- Modify: `src/routes/_authenticated/financeiro.tsx`

**Interfaces:**
- Consumes: Task 1 (`parcelaProvisoria`, `TEXTO_PARCELA_PROVISORIA`, `OcNotaInfo`), Task 5 (`TagParcelaProvisoria`), Task 3 (colunas `status`/`data_nota_entrada` nas OCs — já existiam `status`).
- Produces: `Parcela.provisoria?: boolean` (derivado na queryKey `["parcelas"]`, a única que alimenta Calendário/OCs/Resumo — não criar queryKey nova).

Regra (spec §4.5/§5, D5): provisória = parcela NÃO paga de OC recebida sem a data, nas 4 famílias. Lista: fundo `--tone-warning-bg` + texto; Calendário: o chip mantém a cor do status (o amarelo lá é "vence em ≤ 3 dias") e ganha contorno TRACEJADO + `title`; agenda do celular, popover/sheet do dia, "Próximas parcelas" e Detalhes: o texto.

- [ ] **Step 1: Editar (trechos exatos)**

(a) trocar `import { mensagemErro } from "@/lib/erro-mensagem";` por
```ts
import { mensagemErro } from "@/lib/erro-mensagem";
import { parcelaProvisoria, TEXTO_PARCELA_PROVISORIA, type OcNotaInfo } from "@/lib/nota-entrada";
import { TagParcelaProvisoria } from "@/components/shared/NotaEntrada";
```
(b) tipo `Parcela` — trocar
```ts
  ocBadge?: { label: string; tone: StatusTone } | null;
};
```
por
```ts
  ocBadge?: { label: string; tone: StatusTone } | null;
  // Data da Nota de Entrada (spec 2026-09-24): parcela NÃO paga de OC recebida sem a data — vencimento provisório.
  provisoria?: boolean;
};
```
(c) selects das OCs (status + data) — trocar
```ts
supabase.from("ocs_tecido").select("id, numero_pedido, valor_real_total, representante:representante_id(nome,cnpj), ocs_tecido_itens!oc_tecido_id(cq_alerta_status, cancelado)")
```
por
```ts
supabase.from("ocs_tecido").select("id, numero_pedido, valor_real_total, status, data_nota_entrada, representante:representante_id(nome,cnpj), ocs_tecido_itens!oc_tecido_id(cq_alerta_status, cancelado)")
```
trocar
```ts
supabase.from("ocs_aviamento").select("id,numero_pedido, representante:representante_id(nome,cnpj)")
```
por
```ts
supabase.from("ocs_aviamento").select("id,numero_pedido, status, data_nota_entrada, representante:representante_id(nome,cnpj)")
```
trocar
```ts
supabase.from("ocs_etiqueta" as any).select("id,numero_pedido, representante:representante_id(nome,cnpj)")
```
por
```ts
supabase.from("ocs_etiqueta" as any).select("id,numero_pedido, status, data_nota_entrada, representante:representante_id(nome,cnpj)")
```
trocar
```ts
supabase.from("ocs_p_acabado" as any).select("id,numero, empresa_id, representante:representante_id(nome,cnpj)")
```
por
```ts
supabase.from("ocs_p_acabado" as any).select("id,numero, empresa_id, status, data_nota_entrada, representante:representante_id(nome,cnpj)")
```
(o select de `ocs_importado` NÃO muda — Importado nunca é provisório.)
(d) mapa das OCs — trocar
```ts
        }).map((o: any) => o.id),
      );
```
por
```ts
        }).map((o: any) => o.id),
      );
      // Data da Nota de Entrada: status + data de cada OC (4 famílias) → parcela provisória (regra única em nota-entrada.ts).
      const notaPorOc = new Map<string, OcNotaInfo>(
        [...(tecidoRes.data ?? []), ...(aviamentoRes.data ?? []), ...etqData, ...pAcData].map((o: any) =>
          [o.id as string, { status: o.status ?? null, data_nota_entrada: o.data_nota_entrada ?? null }]),
      );
```
(e) no objeto devolvido por parcela — trocar
```ts
        ocBadge: p.oc_tecido_id ? tecBadge.get(p.oc_tecido_id) ?? null : null,
```
por
```ts
        ocBadge: p.oc_tecido_id ? tecBadge.get(p.oc_tecido_id) ?? null : null,
        provisoria: parcelaProvisoria(p, notaPorOc.get(p.oc_tecido_id ?? p.oc_aviamento_id ?? p.oc_etiqueta_id ?? p.oc_p_acabado_id ?? "")),
```
(f) chip do calendário — trocar
```tsx
<span key={p.id} className={cn("flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", TONE_SURFACE[tone])}>
```
por
```tsx
<span key={p.id} data-qa={p.provisoria ? "parcela-provisoria" : undefined} title={p.provisoria ? TEXTO_PARCELA_PROVISORIA : undefined} className={cn("flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", TONE_SURFACE[tone], p.provisoria && "border border-dashed border-[var(--tone-warning-fg)]")}>
```
(g) agenda do celular + popover/sheet do dia + "Próximas parcelas" — SUBSTITUIR TODAS as 3 ocorrências de
```tsx
<span className="block truncate text-[11px] text-muted-foreground">{parcelaOrigemLabel(p)}</span>
```
por
```tsx
<span className="block truncate text-[11px] text-muted-foreground">{parcelaOrigemLabel(p)}</span><TagParcelaProvisoria show={!!p.provisoria} />
```
(h) linha da lista — trocar
```tsx
                    className={`border-b last:border-0 transition-colors cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ${p.id === highlightId ? "bg-primary/10" : ""}`}
```
por
```tsx
                    data-qa={p.provisoria ? "parcela-provisoria" : undefined}
                    className={`border-b last:border-0 transition-colors cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ${p.id === highlightId ? "bg-primary/10" : p.provisoria ? "bg-[var(--tone-warning-bg)]" : ""}`}
```
(i) sob o vencimento na lista — trocar `                      <OffsetTag dias={(p as any).dias_offset} />` por
```tsx
                      <OffsetTag dias={(p as any).dias_offset} />
                      <TagParcelaProvisoria show={!!p.provisoria} className="mt-1" />
```
(j) Detalhes da Parcela — trocar `          <div><span className="text-muted-foreground">Valor:</span> <b>{brl(Number(parcela.valor))}</b></div>` por
```tsx
          <div><span className="text-muted-foreground">Valor:</span> <b>{brl(Number(parcela.valor))}</b></div>
          <TagParcelaProvisoria show={!!parcela.provisoria} className="text-sm" />
```

- [ ] **Step 2: Conferir, gate, commit**

```bash
F=src/routes/_authenticated/financeiro.tsx
grep -c "TagParcelaProvisoria show" $F     # 5
grep -c "data_nota_entrada" $F             # 5
grep -c 'data-qa={p.provisoria ? "parcela-provisoria"' $F   # 2
bash .superpowers/nota/gates.sh
git add -- $F
git commit --only -m "feat(nota-entrada): Financeiro — parcela provisória (OC recebida sem a data) em amarelo com a indicação, sem mudar o tom do calendário" -m "Co-Authored-By: <seu modelo> <noreply@anthropic.com>" -- $F
```

Expected: `5`, `5`, `2`; `GATES NOTA: ok`. Revisão individual Opus (checklist §3 + "pagas nunca amarelas", "Importado nunca", "uma queryKey só").

---

## Task 11: Snapshot só-leitura de PRODUÇÃO  *(controlador — pré-condição das Tasks 13 Step 5 e Step 8)*

**Files:** nenhum no repo. Saída em `/Users/sunglee/PLM + Criação/savepoints/pre-apply-nota-entrada/snapshot-<data>/` (FORA do repo — a mesma pasta-mãe dos backups e contagens do `ida-producao.sh`; contém dado de loja; nunca commitar).

Quando: (1) no dia da aplicação em produção, ANTES do `pg_dump` do dono (Task 13 Step 4); (2) de novo antes do merge, se passar mais de 1 dia. Se o classificador bloquear o controlador, o DONO roda o mesmo bloco no Terminal. Só leitura (`default_transaction_read_only=on`).

- [ ] **Step 1: Exportar**

```bash
DEST="/Users/sunglee/PLM + Criação/savepoints/pre-apply-nota-entrada/snapshot-$(date +%F)"
mkdir -p "$DEST"
URL="$(cat /tmp/dburl.txt)"
RO() { PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -X -v ON_ERROR_STOP=1 -q "$@"; }
for T in parcelas ocs_tecido ocs_aviamento ocs_etiqueta ocs_p_acabado ocs_importado; do
  RO -c "\copy (SELECT * FROM public.$T ORDER BY id) TO '$DEST/$T.csv' CSV HEADER"
done
# parcelas_servico NÃO é tocada por esta frente — fora do snapshot (registrado no LEIA-ME).
RO -A -t -F' ' -c "select p.oid::regprocedure, md5(pg_get_functiondef(p.oid)), coalesce(array_to_string(p.proacl, ','), '<default>')
  from pg_proc p where p.oid in ('public.gerar_parcelas_oc_tecido()'::regprocedure, 'public.gerar_parcelas_oc_aviamento()'::regprocedure,
  'public.gerar_parcelas_oc_p_acabado()'::regprocedure, 'public._recalcular_parcelas_core(uuid,text)'::regprocedure,
  'public.recalcular_parcelas_etiqueta(uuid)'::regprocedure, 'public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)'::regprocedure,
  'public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)'::regprocedure, 'public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)'::regprocedure,
  'public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)'::regprocedure,
  'public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)'::regprocedure) order by 1" > "$DEST/funcoes_md5_acl.txt"
RO -A -t -c "select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') || '|' ||
  (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal) || '|' ||
  (select count(*) from information_schema.columns where table_schema='public' and column_name='data_nota_entrada')" > "$DEST/contagens.txt"
# D1 e D6 em PRODUÇÃO: OCs recebidas (sem data, pois a coluna ainda não existe) — com e SEM parcela a pagar
RO -A -t -F' | ' -c "with oc as (
    select 'tecido' f, exists(select 1 from public.parcelas p where p.oc_tecido_id = o.id and p.status is distinct from 'pago' and p.data_pagamento is null) np
      from public.ocs_tecido o where o.status = 'recebido' and not coalesce(o.is_rolo, false)
    union all select 'aviamento', exists(select 1 from public.parcelas p where p.oc_aviamento_id = o.id and p.status is distinct from 'pago' and p.data_pagamento is null) from public.ocs_aviamento o where o.status = 'recebido'
    union all select 'insumo', exists(select 1 from public.parcelas p where p.oc_etiqueta_id = o.id and p.status is distinct from 'pago' and p.data_pagamento is null) from public.ocs_etiqueta o where o.status = 'recebido'
    union all select 'p_acabado', exists(select 1 from public.parcelas p where p.oc_p_acabado_id = o.id and p.status is distinct from 'pago' and p.data_pagamento is null) from public.ocs_p_acabado o where o.status = 'recebido')
  select f, count(*) as recebidas, count(*) filter (where np) as com_parcela_a_pagar, count(*) filter (where not np) as sem_parcela_a_pagar from oc group by f order by f" > "$DEST/d1_d6_contagem.txt"
(cd "$DEST" && for f in *.csv; do printf '%s\t%s linhas\t%s\n' "$f" "$(($(wc -l < "$f") - 1))" "$(shasum -a 256 "$f" | cut -c1-16)"; done) > "$DEST/INDICE.tsv"
cat "$DEST/INDICE.tsv" "$DEST/contagens.txt" "$DEST/d1_d6_contagem.txt"; cut -d' ' -f1,2 "$DEST/funcoes_md5_acl.txt"
```

Expected: 6 CSVs com contagem e hash; `contagens.txt` terminando em `|0` (a coluna ainda não existe em produção); `d1_d6_contagem.txt` com, por família, quantas OCs recebidas acendem no dia 1 (D1) e quantas delas NÃO têm parcela a pagar (D6 — o aviso curto); as 10 funções com os md5 da spec §3.1. md5 diferente = produção mudou depois de 24/set: PARE — a guarda da migration recusaria; refazer a Task 3 contra o texto vivo (leitura do texto de produção só-leitura, com o controlador) e re-rodar as Tasks 2–4.

- [ ] **Step 2:** escrever `$DEST/LEIA-ME.md` (data/hora; commit da worktree `git -C "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada" rev-parse HEAD`; "restaurar só com OK do dono"; "contém dados de lojas — não commitar"; "parcelas_servico fora: não é tocada") e anotar o caminho + `INDICE.tsv` no diário do guardião. Sem commit.

---

## Task 12: QA na CÓPIA — variante `:5181`, guarda invertida  *(controlador; relatório ao guardião)*

**Files:**
- Create (NÃO versionar): `tests/e2e/nota-qa.spec.ts`; evidência em `.superpowers/nota/qa/`
- Só LÊ `/Users/sunglee/PLM + Criação/banco-local/app-teste-variantes/criar-variante.sh`: a porta 5181 já está reservada na linha `case "$PORTA" in …` (controlador; ruling R5 do guardião) — este plano NÃO edita essa linha

Regras: a cópia é compartilhada — um QA por vez (o `copia.sh` e o Step 1 conferem); a migration entra na cópia no início (`ida`) e sai no fim (`volta`), com backup nos dois; `servicos_financeiro` NUNCA em `READ_RPCS`; RPC de leitura nova barrada → o controlador confere no `pg_get_functiondef` da cópia que é `STABLE`/sem escrita ANTES de pôr em `READ_RPCS` (e registra); `:5181` ocupada ⇒ PARE; derrubar SÓ pelo `descer.sh` da variante; nunca `npm run dev` + `VITE_*`.

- [ ] **Step 1: Pré-condições, a porta 5181 no script, a migration na cópia e a variante**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada"
ps -Ao pid,command | grep -E "[v]itest|[p]laywright|-qa\.spec" ; echo "testes-checados"
lsof -nP -iTCP:5181 -sTCP:LISTEN; echo "porta-checada"
curl -s -o /dev/null -w 'Supabase local http=%{http_code}\n' http://127.0.0.1:54321/auth/v1/health
VAR="/Users/sunglee/PLM + Criação/banco-local/app-teste-variantes"
# A porta 5181 JÁ foi reservada pelo controlador na linha `case "$PORTA"` (backup .bak-pre-reserva-portas; ruling R5 do
# guardião). NÃO editar essa linha (nem por regex) — várias frentes = corrida. Só CONFERIR e parar se faltar.
grep -E '^case "\$PORTA" in ' "$VAR/criar-variante.sh" | grep -q '5181' && echo "porta 5181 reservada: ok" \
  || { echo "5181 NÃO está na linha case do criar-variante.sh — PARE e peça ao controlador (não editar)"; exit 1; }
NOTA_DONO_AVISADO=sim bash .superpowers/nota/copia.sh ida || exit 1     # R4: SÓ com o OK do dono no chat (o :5188 congela)
bash "$VAR/criar-variante.sh" nota "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada" 5181
"$VAR/nota/subir.sh"
lsof -nP -iTCP:5188 -sTCP:LISTEN -t | sed 's/^/:5188 do dono intacto, PID /'
```

Expected: só `testes-checados` e `porta-checada`; `Supabase local http=200`; `porta 5181 reservada: ok` (sem ela: PARE — não editar o script); `copia.sh ida` → `PRÉ-VOO OK` … `== CÓPIA: ida OK (458|263 → 460|271)` com backup; a variante `nota` sobe em `http://localhost:5181` com a linha da guarda `[guarda-copia-local] OK: variante nota (:5181, …) — cliente e worker -> http://127.0.0.1:54321 (cópia local)`; o `:5188` com o mesmo PID de antes. `RECUSADO`/`ABORTADO`/`ERRO`/`PARE`: pare e reporte (nunca contornar a guarda).

Escolher as OCs de teste (SELECT só-leitura na cópia, Loja Teste) e exportar:

```bash
Q() { PGCONNECT_TIMEOUT=5 psql "postgresql://postgres:postgres@127.0.0.1:54422/postgres" -X -A -t -q -v ON_ERROR_STOP=1 -c "BEGIN READ ONLY; $1; COMMIT;"; }
T="'37889b78-fffb-404b-8c75-18b7e50a1d9b'"
NP="p.status is distinct from 'pago' and p.data_pagamento is null"
TEC="$(Q "select id||'|'||numero_pedido from ocs_tecido o where tenant_id=$T and status='recebido' and not coalesce(is_rolo,false) and data_nota_entrada is null and coalesce(numero_pedido,'')<>'' and exists(select 1 from parcelas p where p.oc_tecido_id=o.id and $NP) order by numero_pedido limit 1")"
AVI="$(Q "select id||'|'||numero_pedido from ocs_aviamento o where tenant_id=$T and status='recebido' and data_nota_entrada is null and coalesce(numero_pedido,'')<>'' and exists(select 1 from parcelas p where p.oc_aviamento_id=o.id and $NP) order by numero_pedido limit 1")"
INS="$(Q "select id||'|'||numero_pedido from ocs_etiqueta o where tenant_id=$T and status='recebido' and data_nota_entrada is null and coalesce(numero_pedido,'')<>'' and exists(select 1 from parcelas p where p.oc_etiqueta_id=o.id and $NP) order by numero_pedido limit 1")"
PA="$(Q "select id||'|'||numero from ocs_p_acabado where tenant_id=$T and status='encomendado' and coalesce(numero,'')<>'' order by numero limit 1")"
IMP="$(Q "select id||'|'||numero from ocs_importado where tenant_id=$T and coalesce(numero,'')<>'' order by numero limit 1")"
{
  printf "NOTA_OC_TECIDO='%s'\nNOTA_NUM_TECIDO='%s'\n" "${TEC%%|*}" "${TEC#*|}"
  printf "NOTA_OC_AVIAMENTO='%s'\nNOTA_NUM_AVIAMENTO='%s'\n" "${AVI%%|*}" "${AVI#*|}"
  printf "NOTA_OC_INSUMO='%s'\nNOTA_NUM_INSUMO='%s'\n" "${INS%%|*}" "${INS#*|}"
  printf "NOTA_OC_PACABADO='%s'\nNOTA_NUM_PACABADO='%s'\n" "${PA%%|*}" "${PA#*|}"
  printf "NOTA_OC_IMPORTADO='%s'\nNOTA_NUM_IMPORTADO='%s'\n" "${IMP%%|*}" "${IMP#*|}"
} > .superpowers/nota/qa-ocs.env
cat .superpowers/nota/qa-ocs.env
```

Expected: as 5 OCs preenchidas (24/set: Tecido — 1 das 7 recebidas; Aviamento e Insumo — a recebida; P. Acabado — 1 das 2 encomendadas; Importado — a encomendada). Alguma vazia ⇒ PARE e reporte (nada de INSERT/UPDATE à mão; o dono decide preparar pela tela).

- [ ] **Step 2: Escrever o spec `tests/e2e/nota-qa.spec.ts`** (NÃO versionar):

```ts
// tests/e2e/nota-qa.spec.ts — QA da "Data da Nota de Entrada" (plano 2026-09-24, Task 12). NÃO COMMITAR (apoio da
// worktree; apagado na Task 13).
// ALVO ÚNICO: app de teste DA WORKTREE (http://localhost:5181) sobre a CÓPIA LOCAL (http://127.0.0.1:54321).
// Guarda INVERTIDA: QUALQUER requisição a *.supabase.co (GET inclusive) é violação. As gravações são SIMULADAS
// (route.fulfill), exceto o E1 (NOTA_ESCRITA=1), que grava de verdade NA CÓPIA — só com o OK do dono.
// Barradas ESPERADAS: `rpc/servicos_financeiro` (VOLATILE, sincroniza parcelas_servico — NUNCA liberar) e o broadcast REST
// do Realtime. O robô NÃO troca de loja (a loja é conferida pelo tenant_id).
// Rodar: set -a; . .superpowers/nota/qa-ocs.env; set +a; E2E_BASE_URL=http://localhost:5181 \
//   VITE_SUPABASE_URL=http://127.0.0.1:54321 npx playwright test tests/e2e/nota-qa.spec.ts --workers=1 --retries=0
import { test, expect, type Browser, type BrowserContext, type Page, type Request, type Route } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { Client as PgClient } from "pg";
import { doLogin } from "./_helpers";

const BASE = process.env.E2E_BASE_URL ?? "";
if (BASE !== "http://localhost:5181") throw new Error(`E2E_BASE_URL precisa ser http://localhost:5181 (variante da worktree) — recebi "${BASE}".`);
const SUPA = process.env.VITE_SUPABASE_URL ?? "";
if (SUPA !== "http://127.0.0.1:54321") throw new Error(`VITE_SUPABASE_URL precisa ser http://127.0.0.1:54321 (cópia local) — recebi "${SUPA}".`);
const SUPA_HOST = new URL(SUPA).host;
const LOJA_TESTE = "37889b78-fffb-404b-8c75-18b7e50a1d9b";
const LOCAL_PG = "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
const ESCRITA = process.env.NOTA_ESCRITA === "1";
const AVISO = "Falta a Data da Nota de Entrada — os vencimentos estão provisórios";
// A data digitada é HOJE no fuso das lojas (America/Sao_Paulo em todas): a D7 recusa data futura e anterior ao pedido.
const HOJE_ISO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const HOJE_BR = HOJE_ISO.split("-").reverse().join("/");
const FUTURA_BR = (() => { const d = new Date(`${HOJE_ISO}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 30); return d.toISOString().slice(0, 10).split("-").reverse().join("/"); })();
const TEXTO_PROV = "vencimento provisório — falta a data da nota";
const ENV = {
  tecido: ["NOTA_OC_TECIDO", "NOTA_NUM_TECIDO"], aviamento: ["NOTA_OC_AVIAMENTO", "NOTA_NUM_AVIAMENTO"],
  insumo: ["NOTA_OC_INSUMO", "NOTA_NUM_INSUMO"], pAcabado: ["NOTA_OC_PACABADO", "NOTA_NUM_PACABADO"],
  importado: ["NOTA_OC_IMPORTADO", "NOTA_NUM_IMPORTADO"],
} as const;
type Fam = keyof typeof ENV;
const OC = Object.fromEntries(Object.entries(ENV).map(([k, [id, num]]) => [k, { id: process.env[id] ?? "", num: process.env[num] ?? "" }])) as Record<Fam, { id: string; num: string }>;
for (const [k, v] of Object.entries(OC)) {
  if (!/^[0-9a-f-]{36}$/.test(v.id) || !v.num) throw new Error(`OC de teste "${k}" ausente — rode o Step 1 da Task 12 (qa-ocs.env).`);
}
// RPCs de LEITURA liberadas (STABLE — conferir no snapshot antes de acrescentar; registrar). Outra RPC = violação.
const READ_RPCS = new Set(["sidebar_badges", "minhas_permissoes_efetivas", "get_user_tenant_id", "meu_tenant_ativo"]);
if (READ_RPCS.has("servicos_financeiro")) throw new Error("servicos_financeiro é PROIBIDO em READ_RPCS.");
const BARRADAS_ESPERADAS = [/^POST \/rest\/v1\/rpc\/servicos_financeiro$/, /^POST \/realtime\/v1\/api\/broadcast/];
const OUT = path.resolve(".superpowers/nota/qa");

type Fake = { casa: (m: string, u: URL) => boolean; responde: (r: Route, req: Request) => Promise<void> };
const g = {
  gravadas: [] as { metodo: string; caminho: string; corpo: unknown }[], violacoes: [] as string[], barradas: [] as string[],
  tenants: new Set<string>(), fakes: [] as Fake[], reais: [] as RegExp[],
};
const json = (r: Route, status: number, body: unknown) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const corpoDe = (req: Request): unknown => { try { return req.postDataJSON(); } catch { return req.postData(); } };
const ehProducao = (u: URL) => /(^|\.)supabase\.co$/i.test(u.hostname);
const fakeRpc = (nome: string, body: unknown) =>
  g.fakes.push({ casa: (m, u) => m === "POST" && u.pathname === `/rest/v1/rpc/${nome}`, responde: (r) => json(r, 200, body) });
const fakeTabela = (tabela: string) =>
  g.fakes.push({ casa: (m, u) => ["PATCH", "POST", "DELETE"].includes(m) && u.pathname === `/rest/v1/${tabela}`, responde: (r) => r.fulfill({ status: 204, body: "" }) });
const limpar = () => { g.fakes = []; g.gravadas = []; g.reais = []; };

async function guardar(ctx: BrowserContext) {
  await ctx.route((u) => ehProducao(u), async (route) => {
    g.violacoes.push(`PRODUÇÃO ${route.request().method()} ${route.request().url()}`);
    return route.abort("blockedbyclient");
  });
  await ctx.route((u) => u.host === SUPA_HOST, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const m = req.method();
    const p = u.pathname;
    if (p.startsWith("/auth/v1/") || p.startsWith("/storage/v1/object/sign/")) return route.continue();
    if (p === "/rest/v1/tenant_config") { const t = u.searchParams.get("tenant_id"); if (t) g.tenants.add(t.replace(/^eq\./, "")); }
    const fake = g.fakes.find((f) => f.casa(m, u));
    if (p.startsWith("/rest/v1/rpc/")) {
      if (!fake && READ_RPCS.has(p.slice("/rest/v1/rpc/".length))) return route.continue();
    } else if (m === "GET" || m === "HEAD") {
      return fake ? fake.responde(route, req) : route.continue();
    }
    if (fake) { g.gravadas.push({ metodo: m, caminho: `${p}${u.search}`, corpo: corpoDe(req) }); return fake.responde(route, req); }
    if (ESCRITA && g.reais.some((re) => re.test(`${m} ${p}`))) { g.gravadas.push({ metodo: m, caminho: p, corpo: corpoDe(req) }); return route.continue(); }
    if (BARRADAS_ESPERADAS.some((re) => re.test(`${m} ${p}`))) g.barradas.push(`${m} ${p}`);
    else g.violacoes.push(`${m} ${p}${u.search}`);
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

async function abrir(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await guardar(ctx);
  const page = await ctx.newPage();
  await doLogin(page);
  return { ctx, page };
}
const botao = (page: Page, rotulo: RegExp) => page.locator("button:visible").filter({ hasText: rotulo }).first();
async function digitarData(page: Page, ddmmaaaa: string) {
  const campo = page.getByRole("dialog").first().getByLabel("Data da Nota de Entrada", { exact: true });
  await campo.click();
  await campo.press("ControlOrMeta+a");
  await campo.press("Backspace");
  if (ddmmaaaa) await campo.pressSequentially(ddmmaaaa.replace(/\D/g, ""));
  await campo.blur();
}
async function evidencia(page: Page, nome: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${nome}.png`), fullPage: true });
}
async function lerCopia<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new PgClient({ connectionString: LOCAL_PG, ssl: false });
  await c.connect();
  try { await c.query("BEGIN READ ONLY"); const r = await c.query(sql, params); await c.query("ROLLBACK"); return r.rows as T[]; }
  finally { await c.end(); }
}

/** Uma OC: lista (bolinha) → abre → aviso → campo DateField → Salvar SIMULADO → a data vai no payload. */
async function fluxoOc(browser: Browser, o: {
  fam: Fam; url: string; aba?: RegExp; rpc: string; tabelaExtra?: string; chavePayload: "_oc" | "_dados"; alerta: boolean; dica: string; nome: string;
}) {
  limpar();
  const { ctx, page } = await abrir(browser);
  try {
    await page.goto(o.url, { waitUntil: "networkidle" });
    if (o.aba) { await page.getByRole("tab", { name: o.aba }).click(); await page.waitForLoadState("networkidle"); }
    const linha = page.locator("tr:visible, div.cursor-pointer:visible").filter({ hasText: OC[o.fam].num }).first();
    await expect(linha).toBeVisible({ timeout: 30_000 });
    if (o.alerta) await expect(linha.locator('[data-qa="bolinha-falta-nota"]')).toBeVisible();
    else await expect(linha.locator('[data-qa="bolinha-falta-nota"]')).toHaveCount(0);
    await linha.click();
    const dlg = page.getByRole("dialog").first();
    await expect(dlg).toBeVisible({ timeout: 30_000 });
    // D6 (decidido pelo dono 24/set): as OCs escolhidas têm parcela a pagar → o texto completo ("…provisórios").
    if (o.alerta) await expect(dlg.locator('[data-qa="aviso-falta-nota"]')).toHaveText(AVISO);
    else await expect(dlg.locator('[data-qa="aviso-falta-nota"]')).toHaveCount(0);
    await expect(dlg.getByText(o.dica, { exact: true })).toBeVisible();
    expect(await page.locator('input[type="date"]').count()).toBe(0);
    if (o.alerta) {
      // D7 (decidido pelo dono 24/set): data FUTURA é recusada no Salvar com o texto PT, sem chamar a RPC.
      await digitarData(page, FUTURA_BR);
      let chamou = false;
      page.on("request", (r) => { if (new URL(r.url()).pathname === `/rest/v1/rpc/${o.rpc}`) chamou = true; });
      await botao(page, /^\s*Salvar\s*$/).click();
      await expect(page.getByText(/não pode ser no futuro/).first()).toBeVisible();
      expect(chamou).toBe(false);
    }
    await digitarData(page, HOJE_BR);
    await expect(dlg.locator('[data-qa="aviso-falta-nota"]')).toHaveCount(0);
    await evidencia(page, `${o.nome}-campo`);
    fakeRpc(o.rpc, OC[o.fam].id);
    if (o.tabelaExtra) fakeTabela(o.tabelaExtra);
    const req = page.waitForRequest((r) => new URL(r.url()).pathname === `/rest/v1/rpc/${o.rpc}` && r.method() === "POST");
    await botao(page, /^\s*Salvar\s*$/).click();
    const corpo = (await req).postDataJSON() as Record<string, Record<string, unknown>>;
    expect(corpo[o.chavePayload]?.data_nota_entrada).toBe(HOJE_ISO);
  } finally {
    await ctx.close();
  }
}

test.describe.configure({ mode: "serial" });
test.afterAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "rede.json"), JSON.stringify({ violacoes: g.violacoes, barradas: g.barradas, tenants: [...g.tenants] }, null, 2));
});

test("Nota — S1 OC Tecido: bolinha, aviso, DateField e a data no payload", async ({ browser }) => {
  await fluxoOc(browser, { fam: "tecido", url: "/entrada-saida/oc-tecido?tab=recebido", rpc: "salvar_oc_tecido", tabelaExtra: "ocs_tecido", chavePayload: "_oc", alerta: true, dica: "O prazo de pagamento conta a partir desta data.", nome: "s1-tecido" });
});
test("Nota — S2 OC Aviamento", async ({ browser }) => {
  await fluxoOc(browser, { fam: "aviamento", url: "/entrada-saida/oc-aviamento", rpc: "salvar_oc_aviamento", tabelaExtra: "ocs_aviamento", chavePayload: "_oc", alerta: true, dica: "O prazo de pagamento conta a partir desta data.", nome: "s2-aviamento" });
});
test("Nota — S3 OC Insumo", async ({ browser }) => {
  await fluxoOc(browser, { fam: "insumo", url: "/entrada-saida/oc-insumo", rpc: "salvar_oc_etiqueta", chavePayload: "_oc", alerta: true, dica: "O prazo de pagamento conta a partir desta data.", nome: "s3-insumo" });
});
test("Nota — S4 OC P. Acabado (encomendada: sem alerta; campo e payload)", async ({ browser }) => {
  await fluxoOc(browser, { fam: "pAcabado", url: "/entrada-saida/oc-p-acabado", aba: /^Encomendadas/, rpc: "salvar_oc_p_acabado", chavePayload: "_dados", alerta: false, dica: "O prazo de pagamento conta a partir desta data.", nome: "s4-p-acabado" });
});
test("Nota — S5 OC P. Importado (só registra: sem alerta; dica própria)", async ({ browser }) => {
  await fluxoOc(browser, { fam: "importado", url: "/entrada-saida/oc-p-importado", aba: /^Encomendadas/, rpc: "salvar_oc_importado", chavePayload: "_dados", alerta: false, dica: "Só registro — os vencimentos seguem as etapas de câmbio.", nome: "s5-importado" });
});

test("Nota — S6 Financeiro: parcelas provisórias em amarelo com o texto; pagas nunca", async ({ browser }) => {
  limpar();
  const { ctx, page } = await abrir(browser);
  try {
    await page.goto("/financeiro?tab=lista", { waitUntil: "networkidle" });
    const prov = page.locator('tr[data-qa="parcela-provisoria"]');
    await expect(prov.first()).toBeVisible({ timeout: 30_000 });
    await expect(prov.filter({ hasText: OC.tecido.num }).first()).toBeVisible();
    const n = await prov.count();
    for (let i = 0; i < n; i++) {
      await expect(prov.nth(i).locator('[data-qa="tag-parcela-provisoria"]')).toHaveText(TEXTO_PROV);
      await expect(prov.nth(i)).not.toContainText("Desmarcar"); // parcela PAGA nunca é provisória
    }
    await evidencia(page, "s6-financeiro-lista");
    await page.goto("/financeiro", { waitUntil: "networkidle" });
    const chips = page.locator('span[data-qa="parcela-provisoria"]');
    for (let i = 0; i < (await chips.count()); i++) await expect(chips.nth(i)).toHaveAttribute("title", TEXTO_PROV);
    await evidencia(page, "s6-financeiro-calendario");
  } finally {
    await ctx.close();
  }
});

test("Nota — S7 rede: nada fora da cópia, só a Loja Teste", async () => {
  expect(g.violacoes, g.violacoes.join("\n")).toEqual([]);
  expect([...g.tenants].every((t) => t === LOJA_TESTE)).toBe(true);
});

type ParcRow = { n: number; valor: string; venc: string; status: string; pago_em: string | null };
const lerParcelas = (ocId: string) => lerCopia<ParcRow>(
  `select numero_parcela n, valor::numeric(14,2)::text valor, to_char(data_vencimento,'YYYY-MM-DD') venc, status,
          to_char(data_pagamento,'YYYY-MM-DD') pago_em from parcelas where oc_tecido_id = $1 order by numero_parcela`, [ocId]);

test("Nota — E1 (GRAVA NA CÓPIA, só com OK do dono): data real (hoje) na OC Tecido recalcula as não pagas; limpar volta", async ({ browser }) => {
  test.skip(!ESCRITA, "E1 só com NOTA_ESCRITA=1 e o OK do dono");
  const antes = await lerParcelas(OC.tecido.id);
  const [oc] = await lerCopia<{ prazo: string; total: string; entrega: string }>(
    `select prazo_pagamento prazo, valor_real_total::numeric(14,2)::text total, to_char(data_entrega,'YYYY-MM-DD') entrega
       from ocs_tecido where id = $1`, [OC.tecido.id]);
  const dias = oc.prazo.split(/[^0-9]+/).filter(Boolean).map(Number);
  const mais = (iso: string, d: number) => { const x = new Date(`${iso}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
  const salvarComData = async (ddmmaaaa: string) => {
    limpar();
    g.reais = [/^POST \/rest\/v1\/rpc\/salvar_oc_tecido$/, /^PATCH \/rest\/v1\/ocs_tecido$/];
    const { ctx, page } = await abrir(browser);
    try {
      await page.goto("/entrada-saida/oc-tecido?tab=recebido", { waitUntil: "networkidle" });
      await page.locator("tr:visible").filter({ hasText: OC.tecido.num }).first().click();
      await digitarData(page, ddmmaaaa);
      const resp = page.waitForResponse((r) => new URL(r.url()).pathname === "/rest/v1/rpc/salvar_oc_tecido");
      await botao(page, /^\s*Salvar\s*$/).click();
      expect((await resp).ok()).toBe(true);
      await page.waitForLoadState("networkidle");
    } finally {
      await ctx.close();
    }
  };
  const pagas = (ps: ParcRow[]) => ps.filter((p) => p.status === "pago" || p.pago_em);
  const soma = (ps: ParcRow[]) => ps.reduce((s, p) => s + Math.round(Number(p.valor) * 100), 0);
  const confere = (ps: ParcRow[], base: string) => {
    expect(pagas(ps)).toEqual(pagas(antes)); // pagas intactas
    for (const p of ps.filter((x) => !(x.status === "pago" || x.pago_em))) expect(p.venc).toBe(mais(base, dias[p.n - 1] ?? p.n * 30));
    expect(soma(ps)).toBe(Math.round(Number(oc.total) * 100)); // Σ = total da OC
  };
  await salvarComData(HOJE_BR);
  confere(await lerParcelas(OC.tecido.id), HOJE_ISO);
  await salvarComData(""); // limpar = volta à base da entrega (a OC fica como estava)
  confere(await lerParcelas(OC.tecido.id), oc.entrega);
  const [nota] = await lerCopia<{ d: string | null }>(`select to_char(data_nota_entrada,'YYYY-MM-DD') d from ocs_tecido where id = $1`, [OC.tecido.id]);
  expect(nota.d).toBeNull();
});
```

- [ ] **Step 3: Rodar o automático (escritas SIMULADAS)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada"
set -a; . .superpowers/nota/qa-ocs.env; set +a
E2E_BASE_URL=http://localhost:5181 VITE_SUPABASE_URL=http://127.0.0.1:54321 \
  npx playwright test tests/e2e/nota-qa.spec.ts --workers=1 --retries=0 2>&1 | tee .superpowers/nota/qa/automatico.log | tail -20
cat .superpowers/nota/qa/rede.json
```

Expected: S1–S7 `passed`, E1 `skipped`; `rede.json` com `violacoes: []`, `tenants: ["37889b78-…"]` e, no máximo, as barradas esperadas. Violação por RPC de leitura: seguir a regra do cabeçalho da task (conferir STABLE e registrar) e re-rodar; qualquer outra violação ou falha = reportar ao controlador com `arquivo:linha` (não "consertar" o teste para passar).

- [ ] **Step 4 (opcional, SÓ com o OK do dono no chat): E1 — grava de verdade NA CÓPIA**

Pedir ao dono: "posso gravar a Data da Nota de Entrada na OC Tecido `<NOTA_NUM_TECIDO>` da Loja Teste NA CÓPIA (não produção) e depois limpá-la?". Com o "sim":

```bash
F="/Users/sunglee/PLM + Criação/banco-local/backups/pre-nota-e1-$(date +%F-%H%M%S).dump"
docker exec -e PGPASSWORD=postgres supabase_db_banco-local pg_dump -h 127.0.0.1 -U supabase_admin -d postgres -Fc > "$F" && [ -s "$F" ] && echo "backup $F"
set -a; . .superpowers/nota/qa-ocs.env; set +a
NOTA_ESCRITA=1 E2E_BASE_URL=http://localhost:5181 VITE_SUPABASE_URL=http://127.0.0.1:54321 \
  npx playwright test tests/e2e/nota-qa.spec.ts --workers=1 --retries=0 -g "E1" 2>&1 | tee .superpowers/nota/qa/e1.log | tail -8
printf -- '- %s  E1 (OC %s) gravou e limpou a data na cópia; backup %s\n' "$(date '+%F %T')" "$NOTA_NUM_TECIDO" "$F" >> .superpowers/nota/copia-estado.md
```

Expected: `E1 passed` — com a data, as não pagas = 05/10/2026 + prazo, pagas intactas, Σ = valor real; limpa, voltam à base da entrega e a coluna fica nula. As parcelas não pagas ganham id novo (recálculo — é o comportamento de todo save). Falha = parar e reportar (restaurar o backup só com OK do dono).

- [ ] **Step 5: Mobile + evidência + derrubar + devolver a cópia**

Rodar S1 e S6 também em 390 px (trocar `viewport` para `{ width: 390, height: 844 }` numa cópia local do teste, sem commitar) e anexar os prints: campo e aviso sem estourar a largura; bolinha no card; texto provisório quebrando linha sem cortar. Depois:

```bash
"/Users/sunglee/PLM + Criação/banco-local/app-teste-variantes/nota/descer.sh"
NOTA_DONO_AVISADO=sim bash .superpowers/nota/copia.sh volta     # R4: dono avisado de novo
cat .superpowers/nota/copia-estado.md
```

Expected: variante `:5181` derrubada pelo próprio script; `volta` → `== CÓPIA: volta OK (460|271 → 458|263)`; o registro com ida/E1/volta. Relatório ao guardião (G-fase): logs, `rede.json`, prints, `copia-estado.md`.

---

## Task 13: Portões, PRODUÇÃO (pelo dono), merge e volta  *(controlador + guardião + dono — NÃO é código)*

> ⛔ Nada entra em produção antes dos Steps 1–3 registrados. A migration em produção é aplicada PELO DONO, no Terminal, pelo `ida-producao.sh` (`pg_dump` completo antes — o plano Supabase NÃO tem PITR — e `aplica_v2`). Ordem: DEPOIS da F1 e do Aviso Global. O merge do front vem DEPOIS da migration em produção, junto com a ida na cópia (R8), e o deploy só encadeado ao portão R7.

**Files:** nenhum no repo até o Step 8 (merge) e o Step 11 (docs). Evidências em `/Users/sunglee/PLM + Criação/savepoints/pre-apply-nota-entrada/`, em `…/savepoints/pre-apply-f1-kanban-auto/` (referência nova da volta da F1 — R1), em `.superpowers/nota/logs/` e no diário do guardião.

- [ ] **Step 1: Pré-condições (só leitura; o controlador — ou o dono, se o classificador bloquear)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada"
bash -c 'source .superpowers/nota/mig/aplica.sh && PROD="$(cat /tmp/dburl.txt)" &&
  espera "$PROD" "$F1" "t" "F1 (kanban automático) em produção" &&
  espera "$PROD" "$AVISO" "t" "Aviso Global em produção (to_regclass(public.avisos_globais))" &&
  espera "$PROD" "$ESTADO" "0|0|f|f" "a Nota ainda NÃO existe" &&
  confere_md5 "$PROD" .superpowers/nota/mig/md5-antes.txt "as 10 funções de produção no texto de 24/set"'
```

Expected: 4× `OK`. `FALHOU (F1…)` ou `FALHOU (Aviso…)` ⇒ PARE (a ordem é do dono: F1 → Aviso → Nota). md5 diferente ⇒ PARE e voltar à Task 3 (a guarda recusaria). Repetir o Task 0 Step 4 (sobreposição) contra a `feature/plan-tecido-a1` do dia.

- [ ] **Step 2: Guardião — G-migration**

Rodar no Fable, avisando o dono antes; sem o Fable, 2 revisões Opus INDEPENDENTES (uma sem ver a outra) + aviso ao dono de que o portão rodou sem o Fable. Acionar o agente `guardiao-unificacao` (report-only) com: a spec, ESTE plano, o diário, as saídas das Tasks 3–4 e 12, e o checklist:
1. UMA migration `20261002100000`, `BEGIN/COMMIT`, as 2 travas logo depois do `BEGIN;` e nenhuma DDL de policy (R9), idempotente (teste 11), gerada (não editada: `python3 gerar_sql.py --tt-inverso <o do cabeçalho do inverso>` reproduz os 2 arquivos commitados byte a byte — `git diff --exit-code` depois de regenerar); inverso com o `transaction_timeout` da medição (R9-a: ≥ 30 s e ≥ `tt_minimo` de `volta-medida.txt`), laço antes dos gatilhos/colunas e repasse depois do DROP TRIGGER (R9-b);
2. guarda de md5 EXATA (R2): antes = spec §3.1, depois = `md5-depois.txt`; teste 12 (função alterada que ainda contém a string → recusada pela migration e pelo inverso); diff antes → depois = `diff-esperado.txt` (Task 3 Steps 3 e 5); ensaio = `md5-depois.txt` (Task 4);
3. ACL #9: `has_function_privilege` nas internas (pós-condição + teste 1 + `confere_ida_nota`) e ACL das 10 redefinidas igual à de antes (teste 11);
4. dinheiro: paga intacta, Σ = total, só não pagas mudam, sem data = hoje byte a byte (teste 10), Importado idêntico (teste 8), OC encomendada sem parcela nova (teste 3); **R5:** nenhuma falha nova nos 7 arquivos que já cobrem parcelas/OCs (Task 4);
5. D7 (se o dono confirmar): gatilho `trg_nota_entrada_valida` nas 5 OCs, mensagens PT iguais às do front (teste 9 + unit);
6. inverso destrutivo com confirmação, testado (teste 13) e ensaiado (Task 4) pelo `aplica_v2`;
7. **R3:** ida e volta de produção pelo `aplica_v2` (500 ms/3 s, nova tentativa só em 55P03/40P01/25P04, ATIV antes); tempo medido no ensaio;
8. **R4:** toda rodada com DDL na cópia teve o pré-voo (`logs/prevoo-copia.log`: dono avisado, sem outro teste, sem sessão ativa);
9. nenhum `\i` em txn de teste; testes com DDL só na cópia (`ehBancoLocal`); nenhum teste tocou produção;
10. snapshot da Task 11 com os md5 de produção = spec §3.1 e as contagens D1/D6;
11. **R1:** `ref-volta-f1.sh` pronto e o plano do Step 7b; **R7/R8:** portão do deploy e cópia junto com o merge (Step 8);
12. §5 da spec/plano: respostas do dono às D1–D7 registradas (D6/D7 eram "pendentes do dono").

O guardião acrescenta o veredito ao diário. BLOQUEIA ⇒ parar. APROVA COM RESSALVAS ⇒ resolver/registrar antes do Step 3.

- [ ] **Step 3: OK EXPLÍCITO do dono**

Apresentar em PT-BR simples: o que muda (campo nas 5 OCs; vencimento a partir da data em 4 famílias; recálculo das não pagas; alertas; D7: data futura/antes do pedido recusada), o número de OCs que acendem no dia 1 e quantas sem parcela a pagar (Task 11 — D1/D6), o veredito do guardião, o plano de volta (Step 10) e a ordem (F1 → Aviso Global → esta migration → merge do front + cópia → deploy pelo portão). Registrar a resposta literal + data no diário. Sem "sim" ⇒ parar. D6/D7 com resposta DIFERENTE da recomendação ⇒ aplicar a variante da §5 (regerar a migration/refazer as Tasks 1, 3–5 afetadas) ANTES do Step 5.

- [ ] **Step 4: Snapshot (Task 11) — no dia do apply, antes do Step 5**

O `pg_dump` completo é feito DENTRO do `ida-producao.sh` (Step 5), antes do pré-voo, e o script PARA se ele falhar.

- [ ] **Step 5: Aplicar em PRODUÇÃO — o DONO, no Terminal, fora do horário de uso (R3)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada"
/bin/bash --noprofile --norc -c 'bash .superpowers/nota/mig/ida-producao.sh 2>&1 | tee -a .superpowers/nota/logs/prod-ida.log'
```

Expected: `contagens antes (funções|gatilhos): <f>|<g>`; `OK (backup): …/pre-apply-nota-entrada/producao-pre-nota-….dump`; `PRÉ-VOO OK` (arquivos com as 2 travas e sem DDL de policy — R9, PG ≥ 17, F1 e Aviso no banco, a Nota ausente, as 10 funções no texto de 24/set, ATIV vazio); o `aplica_v2` com o tempo do arquivo; `== IDA OK`; `OK (5 colunas, 8 gatilhos, 2 funções novas)`, `OK (contagens +2 funções +8 gatilhos): <f+2>|<g+8>`, `OK (internas …): 0`, `OK (as 12 funções no texto desta migration)`; `== PostgREST recarregado`. `-- espera de trava/tempo` = alguém segurava uma OC; o `aplica_v2` repete sozinho (nada do arquivo ficou; até 5×). `PAROU`/`FALHOU` = nada daquele arquivo ficou; avisar o controlador (não matar sessão; não rodar o inverso sem OK do dono). A guarda recusar (`não está nem no texto de 24/set nem no desta migration`) = produção mudou: voltar à Task 3.

- [ ] **Step 6: Registrar em `supabase_migrations.schema_migrations` (idempotente) — o dono**

```bash
psql "$(cat /tmp/dburl.txt)" -X -v ON_ERROR_STOP=1 -c "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261002100000', 'oc_data_nota_entrada', '{}'::text[]) ON CONFLICT (version) DO NOTHING"
```

- [ ] **Step 7: Verificação pós-apply — SÓ LEITURA**

```bash
URL="$(cat /tmp/dburl.txt)"; S="/Users/sunglee/PLM + Criação/savepoints/pre-apply-nota-entrada/snapshot-$(date +%F)"
PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -X -q -c "\copy (SELECT * FROM public.parcelas ORDER BY id) TO '$S/parcelas_pos.csv' CSV HEADER"
diff "$S/parcelas.csv" "$S/parcelas_pos.csv" > /dev/null && echo "PARCELAS IDÊNTICAS (a migration não escreve dado)"
```

Expected: `PARCELAS IDÊNTICAS`. Diferença = conferir no `audit_log` se foi uso normal entre o snapshot e agora; diferença sem autoria de usuário = BLOQUEIO (Step 10). (As conferências de objetos, contagens, ACL e md5 já rodaram no fim do Step 5.) Registrar no diário.

- [ ] **Step 7b: Referência nova da VOLTA DE EMERGÊNCIA da F1 (R1) — o DONO, só leitura, logo depois do Step 7**

```bash
/bin/bash --noprofile --norc "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada/.superpowers/nota/mig/ref-volta-f1.sh" 2>&1 | tee -a "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada/.superpowers/nota/logs/prod-ida.log"
```

Expected: `OK (referência nova p/ a volta da F1): …/pre-apply-f1-kanban-auto/fidelidade_ref_volta_f1_pos_nota_detalhe.txt — retrato pré-F1 sem os objetos da Nota/Aviso + <n> linha(s) atuais deles; CONT esperado da volta: 429|227` (427|219 + a Nota +2|+8; o Aviso não tem função nem gatilho — sem a D7 seria 428|222) e `Gravado ao lado do runbook da F1: …/2026-09-22-kanban-automatico-f1-banco/VOLTA-F1-POS-NOTA.md`. A partir daqui, a volta de emergência da F1 (runbook v2 §9.2) troca as 2 conferências finais (`task-18-runbook-v2.md:788-791`) pelas 3 linhas desse arquivo; a referência do Aviso (`fidelidade_ref_volta_f1_com_aviso_detalhe.txt`) fica SUPERADA. `PARE: falta …fidelidade_prod_pre_detalhe.txt` = o Step 4 da F1 não gravou o retrato: avisar o controlador (sem referência, a volta da F1 compara à mão, categoria por categoria). Registrar no diário. Se a Nota for desfeita (Step 10), esta referência deixa de valer — voltar à do Aviso.

- [ ] **Step 8: Merge do front + cópia NA MESMA HORA (R8) + deploy pelo portão (R7)**

(a) Branch em dia e gates:

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada"
git status --porcelain -- src supabase tests | grep -v '^?? tests/e2e/nota-qa.spec.ts' | grep . && echo "WORKTREE SUJA — PARE"
rm -f tests/e2e/nota-qa.spec.ts
git rebase feature/plan-tecido-a1
bash .superpowers/nota/gates.sh
```

Repetir o Task 0 Step 4 (sobreposição). `rebase` com conflito: resolver PRESERVANDO o texto da outra frente e reaplicando a intenção daqui; re-revisão Opus das tasks que editam o arquivo.

(b) Avisar o dono por chat: salvar e fechar OCs abertas e o Financeiro no `:5173` E no `:5188` (o código novo passa a valer no reload; a cópia congela alguns segundos na ida). Com o OK — **um comando só: a ida na cópia e o fast-forward em sequência**, sem janela em que o `:5188` (checkout principal) peça a coluna a uma cópia sem ela:

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada"
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"
git -C "$MAIN" diff --cached --quiet || { echo "índice do checkout principal com coisa staged (outra sessão) — PARE e combine com o controlador"; exit 1; }
NOTA_DONO_AVISADO=sim bash .superpowers/nota/copia.sh ida \
  && git -C "$MAIN" merge --ff-only nota-entrada/data-nota && git -C "$MAIN" log --oneline -8
```

Expected: `== CÓPIA: ida OK (458|263 → 460|271)` (ou `a cópia JÁ tem a Nota`) e o ff com os commits da Nota no topo. A ida falhou ⇒ o merge NÃO roda (o `&&`). O ff falhou ⇒ a cópia fica com a Nota — inofensivo para o front antigo (chave ausente = mantém); resolver o ff e repetir só o `merge`.

(c) Deploy — SÓ o dono, num `/bin/bash --noprofile --norc`, encadeado ao portão (R7, o mesmo modelo do Aviso). Antes, o controlador grava em `.superpowers/nota/deploy-base.txt` o sha do ÚLTIMO deploy (registrado no diário; no Aviso: `2768145`, se nenhum outro saiu depois) e em `.superpowers/nota/deploy-lista.txt` os SHAs de front APROVADOS pelo dono para este deploy (a lista do §8 D1 do Aviso, se o deploy dele ainda não saiu) + os desta frente (`git log --format=%H "$(cat .superpowers/nota/BASE)"..nota-entrada/data-nota`):

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"; WT="$MAIN/.claude/worktrees/nota-entrada"
cd "$MAIN" && git branch --show-current
prereq_banco() {  # fases com pré-requisito de banco no intervalo → o objeto TEM de existir em produção (só leitura)
  local P rng; P="$(cat /tmp/dburl.txt)"; rng="$(cat "$WT/.superpowers/nota/deploy-base.txt")..HEAD"
  chk() { local v; v=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$P" -X -q -A -t -c "$2") || return 1
          [ "$v" = t ] || { echo "PARE (R7): $1 está na branch mas o banco de produção ainda não tem o pré-requisito"; return 1; }; }
  if git log --format=%s "$rng" | grep -qiE 'nota-entrada|nota de entrada'; then
    chk "Data da Nota de Entrada" "select count(*) = 5 from information_schema.columns where table_schema = 'public' and column_name = 'data_nota_entrada'" || return 1; fi
  if git log --format=%s "$rng" | grep -qiE 'f3\.?1|descricao_produto'; then
    chk "F3.1 (modelos.descricao_produto)" "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'modelos' and column_name = 'descricao_produto')" || return 1; fi
  if git log --format=%s "$rng" | grep -qiE 'kanban-auto|kanban automático'; then
    chk "F1/F2 (tenant_config.kanban_automatico)" "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_config' and column_name = 'kanban_automatico')" || return 1; fi
  if git log --format=%s "$rng" | grep -qiE 'aviso global|aviso-global'; then
    chk "Aviso Global (avisos_globais)" "select to_regclass('public.avisos_globais') is not null" || return 1; fi
  echo "OK (R7): pré-requisitos de banco das fases no intervalo existem em produção"
}
portao_deploy_nota() {
  local sujo fora base lista="$WT/.superpowers/nota/deploy-lista.txt"
  sujo=$(git status --porcelain --untracked-files=all -- src)
  [ -z "$sujo" ] || { echo "$sujo"; echo "PARE (R7): mudança em src/ fora de commit (inclusive não rastreado) — nada é publicado"; return 1; }
  base=$(cat "$WT/.superpowers/nota/deploy-base.txt" 2>/dev/null) || { echo "PARE: sem deploy-base.txt"; return 1; }
  [ -s "$lista" ] || { echo "PARE: $lista vazio — os SHAs de front aprovados pelo dono + os desta frente"; return 1; }
  fora=$(git log --format='%H %s' "$base"..HEAD -- src | grep -v -F -f "$lista")
  if [ -n "$fora" ]; then
    echo "$fora"
    echo "PARE (R7): commit de front FORA da lista aprovada. Fase da campanha (F2/F3.x/SKU) juntada? Confira os pré-requisitos"
    echo "de banco dela ANTES (ex.: F3.1 grava modelos.descricao_produto) e fale com o dono — nada é publicado."
    return 1
  fi
  prereq_banco || return 1
  echo "OK (R7): src limpo e só a lista aprovada vai para o ar ($(git log --format=%H "$base"..HEAD -- src | wc -l | tr -d ' ') commits de front)"
}
portao_deploy_nota && npm run deploy
```

Expected: `feature/plan-tecido-a1`; `OK (R7): pré-requisitos…`, `OK (R7): src limpo…` e o deploy do wrangler sem erro. `PARE (R7)` ⇒ NADA foi publicado: resolver (commitar/descartar com o dono; ou o dono aceitar incluir a fase — conferidos os pré-requisitos de banco dela — e acrescentar os SHAs à lista, registrando no diário) e rodar o MESMO comando.

- [ ] **Step 9: Avisar as outras frentes da referência nova da cópia (R8)**

Mensagem ao controlador (que repassa às frentes F3.x, Aviso e SKU), registrada no diário:
> "A cópia local (`:54422`) passa a ter a Data da Nota de Entrada DE VEZ: funções|gatilhos = **460|271** (era 458|263), 5 colunas `data_nota_entrada` nas OCs, 2 funções (`fn_oc_nota_entrada_recalc`/`_valida`) e 8 gatilhos novos. Classificadores que esperam `458|263|*` passam a dizer 'INESPERADO' — ex.: `.superpowers/f31/n3-copia.sh` da F3.1: acrescentar o caso `460|271|*` = 'F1 + Nota aplicadas na cópia (depois do merge da Nota)'. Um re-ensaio da F1 (ou qualquer comparação com o retrato 427|219/458|263) exige antes `NOTA_DONO_AVISADO=sim bash .superpowers/nota/copia.sh volta` na worktree da Nota (e `ida` depois). Na volta de emergência da F1 em PRODUÇÃO vale a referência nova (`VOLTA-F1-POS-NOTA.md`, CONT 429|227)."

Acrescentar a mesma nota curta ao `banco-local/APP-TESTE-LOCAL.md` (seção de estado da cópia).

- [ ] **Step 10: Como voltar (só com OK do dono)**

Ordem OBRIGATÓRIA: primeiro o front (senão o Financeiro pede uma coluna que some), depois o banco.
1. `git revert` dos commits desta frente na `feature/plan-tecido-a1` (um commit de revert, `--only`), `gates.sh`, e o dono faz o deploy (pelo portão do Step 8c). **Esperar o deploy do revert NO AR e as abas recarregadas** (inclusive o `:5173`) antes do banco.
2. Na cópia: `NOTA_DONO_AVISADO=sim bash .superpowers/nota/copia.sh volta` (o `:5188` segue o checkout principal, já revertido).
3. Produção, o DONO (R9-a: mostra quantas OCs estão datadas e confere o tempo do inverso ANTES de pedir a confirmação digitada; exporta as datas e as parcelas, `pg_dump` completo, `aplica_v2_inverso` com a confirmação na mesma transação, confere, desregistra, recarrega o PostgREST):
```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada"
/bin/bash --noprofile --norc -c 'bash .superpowers/nota/mig/volta-producao.sh 2>&1 | tee -a .superpowers/nota/logs/prod-volta.log'
```
Expected: `OCs DATADAS em produção (…): tecido|aviamento|insumo|p.acabado = a|b|c|d → total N`; `ensaio: … → com folga 5× precisa de Ps; transaction_timeout: arquivo Ts, nesta volta Ts`; o pedido `Digite APAGAR AS DATAS` (outra resposta = `cancelado — nada foi feito`); `export: …/pre-apply-nota-entrada/volta-…`, `OK (backup)`, `OK (ATIV)`, `== inverso com lock_timeout 500ms e transaction_timeout Ts`, o `aplica_v2` do inverso, `OK (a Nota saiu)`, `OK (contagens = antes da ida)`, `OK (as 10 funções de volta ao texto de 24/set)`, `== VOLTA OK`. `PARE: Ts < Ps` = o laço pode estourar: o dono escolhe entre regenerar o inverso (`gerar_sql.py --tt-inverso P` + Task 3 Step 4 + gates + commit) e rodar de novo com `NOTA_TT_VOLTA=Ps` (só nesta volta; o lock_timeout segue 500 ms). A guarda do inverso recusar (`foi mudada por outra frente`) = PARE: o inverso reverteria a outra frente. Depois da volta, a referência da volta da F1 volta a ser a do Aviso (registrar no diário e em `VOLTA-F1-POS-NOTA.md`).

- [ ] **Step 11: Docs e memória (docs-keeper; controlador aplica com OK do dono)**

- `CLAUDE.md`, invariante #1 — acrescentar ao fim do parágrafo: "**Data da Nota de Entrada (set/2026, `20261002100000`):** `data_nota_entrada` nas 5 OCs; em Tecido/Aviamento/Insumo/P. Acabado a base do vencimento é `COALESCE(data_nota_entrada, data_entrega | data_pedido)`; mudar a data numa OC recebida recalcula as NÃO pagas (gatilho `trg_nota_entrada_recalc`; Acabado pelo `trg_gerar_parcelas_ocpa`); os saves gravam a chave (ausente = mantém); data futura ou anterior ao pedido recusada (`trg_nota_entrada_valida`, se D7 confirmada). Importado só registra. Alerta/provisória: regra única `src/lib/nota-entrada.ts`." — commit `--only CLAUDE.md`.
- Memória `project_data_nota_entrada.md`: estado FEITO + commits + onde está a migration + o runbook + a referência nova da volta da F1; atualizar a linha no `MEMORY.md`.
- `docs/api-integracao-erp.md` (local, gitignored): "vencimento de parcela de OC recebida sem `data_nota_entrada` é PROVISÓRIO".

- [ ] **Step 12: Limpeza**

Com o OK do dono: `git worktree remove .claude/worktrees/nota-entrada` (depois do merge; copiar antes `.superpowers/nota/logs/` e `mig/md5-*.txt` para `…/savepoints/pre-apply-nota-entrada/`), `git branch -d nota-entrada/data-nota`. A pasta da variante `nota` pode ser apagada (só os arquivos dela); a linha `case` do `criar-variante.sh` é do controlador — esta frente não a toca. ⚠️ O `copia.sh volta` do Step 9/10 mora na worktree: antes de removê-la, copiar `.superpowers/nota/{copia.sh,prevoo-copia.sh,mig/}` para `…/savepoints/pre-apply-nota-entrada/scripts/` (o re-ensaio da F1 precisa deles; o `mig/volta-medida.txt` vai junto — sem ele o `volta-producao.sh` PARA, R9-a).

---

## 4. Riscos (evidência e o que o plano faz)

| Risco | Evidência | Mitigação |
|---|---|---|
| Vencimento errado / dinheiro | Parcelas regeneradas por DELETE+INSERT em 4 famílias (spec §3.1) | Testes 2–9 por família (paga intacta, Σ = total, só não pagas, sem data = hoje byte a byte); revisão individual Opus |
| Reverter em silêncio função mudada em produção | `CREATE OR REPLACE` com o texto de 24/set | Guarda de md5 na migration e no inverso; snapshot da Task 11 confere antes |
| Front antes do banco | Listas/Financeiro pedem `data_nota_entrada` | Merge só depois do Step 7; volta = front primeiro |
| Aba/front antigo apagando a data | Saves gravam o cabeçalho coluna a coluna | `CASE WHEN ? 'data_nota_entrada'` — chave ausente mantém (teste 4) |
| Cópia compartilhada | Outras frentes contam funções/gatilhos | `copia.sh` com backup, trava de QA, `volta` ao fim, registro |
| Volta de emergência estoura o tempo (R9-a) | O inverso recalcula as não pagas de cada OC datada; o ensaio antigo voltava com 0 OC datada; um `SET LOCAL` maior depois dos 3 s não estende o relógio (provado na cópia) → 5×25P04 e o `aplica_v2` para | Inverso com `transaction_timeout` próprio (`--tt-inverso`, ≥ 30 s, ⌈5 × medido⌉) aplicado pelo `aplica_v2_inverso`; laço antes das travas exclusivas e repasse depois do DROP TRIGGER (R9-b); ensaio mede o laço com as OCs recebidas datadas numa txn DESFEITA (R9-b); `volta-producao.sh` mostra as OCs datadas e PARA sem folga de 5×; `lock_timeout` 500 ms igual |
| Lock nas OCs (R3/R9) | `ADD COLUMN`/`DROP TRIGGER` = AccessExclusive nas 5 OCs até o COMMIT; as policies de outras tabelas que dependem delas ficam bloqueadas durante a transação — 5 na cópia: `enderecamento_tecido` (endtec_ins, endtec_upd), `ocs_tecido_itens`, `ocs_aviamento_itens`, `ocs_etiqueta_itens` (Estoque, Plan. Tecido, OCs, Financeiro ficam na fila). Sem DDL de policy → o hook `supautils.policy_grants` (24 tabelas de auth/storage/realtime) NÃO dispara: login/token/URL assinada/Realtime não esperam | travas NO arquivo (R9, vale até no `psql -f`) + `aplica_v2`: arquivo numa mensagem, 500 ms de trava/3 s de transação, nova tentativa só em 55P03/40P01/25P04 com ATIV; harness e pré-voo recusam DDL de policy; tempo medido no ensaio; horário calmo |
| Volta da F1 deixa de fechar (R1) | Runbook v2 §9.2 espera 427\|219 e o retrato pré-F1; a Nota põe +2\|+8, 5 colunas e muda 10 md5 | `ref-volta-f1.sh` (Step 7b) grava a referência nova + CONT 429\|227 ao lado do runbook; supera a do Aviso |
| Guarda frouxa (R2) | "contém a string" aceitaria uma função mudada por outra frente | md5 EXATO antes/depois na migration e no inverso + teste de recusa |
| `:5188` congela / QA simultâneo (R4) | DDL em txn nas OCs da cópia compartilhada | `prevoo-copia.sh` antes de toda rodada (dono avisado, sem outro teste, sem sessão ativa) |
| Regressão fora do desenho (R5) | 7 arquivos de integração já testam parcelas/OCs | rodados antes e depois da ida na cópia, comparando o conjunto de falhas |
| Deploy leva fase sem banco (R7) | `npm run deploy` publica a branch inteira (F3.1 grava `descricao_produto`) | `portao_deploy_nota`: src limpo, só a lista aprovada, pré-requisitos de banco conferidos |
| `:5188` pede coluna que a cópia não tem (R8) | merge sem a ida na cópia | ida na cópia e fast-forward num comando só; referência nova 460\|271 avisada às frentes |
| Data implausível (D7) | Um ano trocado move todos os vencimentos não pagos | Validação no banco (gatilho) e no front — pendente do dono |
| Ruído no dia 1 | 48 OCs recebidas sem data na cópia (spec §3.1) | D1 com o dono antes da produção; recontagem em produção na Task 11 (com D6) |
| Ajuste manual sobrescrito | Recálculo já sobrescreve a cada save (spec §3.1) | D4 com o dono |
| Amarelo ambíguo no calendário | `vence_breve` = warning (`financeiro.tsx:137`) | Contorno tracejado + texto (D5) |

## 5. Decisões para o dono (texto completo na spec §10 — responder por chat)

| Dec. | Recomendação (o que o plano implementa) | Se a resposta for outra | Quando |
|---|---|---|---|
| D1 OCs antigas | (A) manter a regra; sem backfill, sem corte | (B) corte: `faltaNotaEntrada` ganha `recebida_em ≥ data de corte` (usar `data_entrega`) — Task 1 + unit; (C) backfill `data_nota_entrada = data_entrega` = DML de produção próprio, com portão | antes da Task 13 |
| D2 Importado sem alerta | só o campo | `FAMILIAS_COM_ALERTA` += `p_importado`, texto próprio sem "provisórios", bolinha/aviso na OC Importado e `data_nota_entrada` no select da lista dele — Task 9b nova | antes da Task 1 |
| D3 bolinha só em Recebidas | manter | acender com entrega parcial = regra nova (entregas marcadas) — nova task de front | antes da Task 6 |
| D4 ajuste manual sobrescrito | aceitar | congelar vencimento editado à mão = coluna/flag nova no banco — fora desta migration | antes da Task 13 |
| D5 amarelo no calendário | tracejado + texto | chip inteiro em warning — trocar a classe na Task 10 (f) | antes da Task 10 |
| **D6** OC recebida toda paga ou de valor 0 acende a bolinha e o aviso? **(decidido pelo dono 24/set)** | **acende, com o texto "Falta a Data da Nota de Entrada" SEM "provisórios"** (o dono quer as datas preenchidas mesmo) — `textoAvisoFaltaNota` + `AvisoFaltaNota` contando as parcelas a pagar (Tasks 1 e 5) | não acender: `faltaNotaEntrada` passa a exigir parcela a pagar — mas a lista não tem esse dado: exigiria uma consulta por OC na lista (ou um campo derivado no banco); nova task | antes da Task 1 |
| **D7** data implausível (futura ou antes do pedido) move todos os vencimentos não pagos — validar? **(decidido pelo dono 24/set)** | **validar: não pode ser futura (> hoje no fuso da loja) nem anterior à data do pedido, erro em PT, no SERVIDOR (gatilho `trg_nota_entrada_valida` nas 5 OCs) E no front (`validarDataNota`/`useValidarDataNota`)** | não validar: tirar `FN_VALIDA`/os 5 gatilhos do `gerar_sql.py` (a migration volta a +1\|+3; CONT da volta da F1 428\|222), o teste 9 e as linhas `validarNota` das Tasks 6–9 | antes da Task 1 (código) e da Task 13 Step 3 |

## 6. Autorrevisão (cobertura do pedido)

| Pedido | Onde |
|---|---|
| Task 0: worktree `.claude/worktrees/nota-entrada` / branch `nota-entrada/data-nota` do HEAD de `feature/plan-tecido-a1`; `regras-nota.md` e `gates.sh`; sobreposição com f2/f31/f32/f33/f34 e Aviso Global + regra de rebase | Task 0 Steps 1–4 |
| UMA migration `20261002100000`, `BEGIN/COMMIT`, idempotente, `SET lock_timeout`, diff `pg_get_functiondef` antes/depois de TODA função, `_core` revogados dos 3 com `has_function_privilege`, inverso com aviso de DROP | Task 3 (+ testes 1, 10, 11), gerador |
| Testes: data → data + prazo; mudar a data → só não pagas; paga intacta; Σ = total; sem data = hoje byte a byte; Importado não muda; ACL; nunca `\i`; `exigeBancoLocal` | Task 2 (testes 1–12), harness |
| Aplicação na cópia com backup e trava de QA | Task 4 (`copia.sh`), Task 12 |
| Front: `<DateField>` no cabeçalho das 5 OCs; aviso; bolinha; destaque no Financeiro; `mensagemErro`; invalidação das queryKeys | Tasks 5–10 |
| QA: variante `:5181` (porta já reservada pelo controlador — o plano só CONFERE com `grep`, nunca edita a linha `case`; ruling R5); guarda invertida; portas proibidas; um QA por vez | Task 12 Step 1 |
| Snapshot só-leitura antes do merge; G-migration; produção pelo dono com `pg_dump` completo; ordem F1 → Aviso Global → esta | Tasks 11, 13 |
| Sonnet implementa, Opus revisa; banco e dinheiro com revisão individual | Global Constraints, §3 |
| **R1** referência nova da volta de emergência da F1 depois da Nota (CONT 429\|227; supera a do Aviso); pré-condição do Aviso por `to_regclass('public.avisos_globais')` | Task 4 Step 1 (`ref-volta-f1.sh`), Task 13 Steps 1 e 7b, `aplica.sh` (`AVISO`), Global Constraints |
| **R2** guardas com md5 EXATO antes/depois + teste de recusa | Task 3 (`gerar_sql.py`: guarda, pós-condição, inverso), Task 2 teste 12, `md5-antes.txt`/`md5-depois.txt` |
| **R3** produção (ida e volta) pelo `aplica_v2` (500 ms/3 s, nova tentativa) | Global Constraints, Task 4 Step 1 (`aplica.sh`, `ida-producao.sh`, `volta-producao.sh`, `copia.sh`), Task 13 Steps 5 e 10 |
| **R4** pré-voo sem vitest/playwright + dono avisado (o `:5188` congela) antes de toda rodada com DDL na cópia | Global Constraints, Task 0 Steps 2–3 (`prevoo-copia.sh`), Task 2 Step 2, Task 3 Steps 4–5, Task 4 Step 2, Task 12 Steps 1 e 5, Task 13 Step 8 |
| **R5** 7 arquivos de integração de parcelas/OCs antes e depois da ida na cópia, comparando o conjunto de falhas | Task 4 Step 2 |
| **R6** D6 e D7 com a recomendação implementada e marcadas "pendente do dono" | §5, spec §10, Tasks 1, 3, 5–9, Task 2 teste 9 |
| **R7** portão do deploy: `src` limpo (inclusive não rastreados), só commits aprovados, pré-requisitos de banco | Task 13 Step 8c (`portao_deploy_nota`, `prereq_banco`) |
| **R8** ida na cópia junto com o merge; referência 460\|271 avisada às frentes | Task 13 Steps 8b e 9 |
| **R9** (coordenador, lição do Aviso) travas `SET LOCAL` 500 ms/3 s DENTRO do arquivo logo depois do `BEGIN;`; nenhuma DDL de policy (hook `supautils.policy_grants`); risco das 5 OCs e das policies que dependem delas | Global Constraints, `regras-nota.md` item 12, `gerar_sql.py` (cabeçalho + 2 linhas nos 2 arquivos), harness (`RE_TRAVAS_DO_ARQUIVO`, `RE_DDL_POLICY`), `aplica.sh` (`confere_arquivos_nota` no pré-voo), Task 3 Step 3, §4 Riscos |
| **R9-a** (guardião) volta medida com as OCs datadas; `transaction_timeout` maior só no inverso; a ida conferida | (1) Task 4 Step 2 (medição do teste "R9-b" numa txn desfeita; `volta-medida.txt`) e Step 2b (subir o `--tt-inverso` se `tt_minimo` > 30); (2) `volta-producao.sh` (OCs datadas + folga 5× ANTES da confirmação), Task 13 Step 10; (3) `gerar_sql.py --tt-inverso` (cabeçalho explica o porquê; laço antes dos gatilhos/colunas), `aplica.sh` (`aplica_v2_inverso`, `tt_do_arquivo`, `DATADAS`, `confere_arquivos_nota`), harness (ida 3 s / inverso ≥ 30 s), Global Constraints, regra 12, §4 Riscos; ida: gerador recusa DML fora de função + `t_ida`/`t_ida_datada` no ensaio |
| **R9-b** (guardião) medição sem resíduo; repasse depois do DROP TRIGGER; teste do inverso que distingue a ordem | (1) teste 15 "R9-b" (`NOTA_MEDIR_VOLTA`: migration → datar → ida de novo → inverso cronometrado por `clock_timestamp()` com `transaction_timeout` 180 s só nessa txn → ROLLBACK; grava `volta-medida.txt`) + `copia.sh retrato` só-leitura antes × depois (`RETRATO IDÊNTICO`: ids, vencimentos, `dias_offset`, `rev`, nº do `audit_log`) em Task 4 Step 2; `copia.sh datar` e a volta real com OCs datadas REMOVIDOS; o esperado "k = 0" saiu; (2) passo 4b `$repasse$` no `gerar_sql.py` (mesmo critério da captura EXCEPT `_nota_voltar`, com o AccessExclusive já pego; NOTICE com o nº); (3) teste 13: ordem do arquivo conferida, Aviamento e Insumo no laço, as 4 famílias com NF ≠ base antiga voltam à base ANTIGA, NOTICE `0 OC(s) repassada(s)`; Global Constraints, Task 3 Step 3, §4 Riscos |
