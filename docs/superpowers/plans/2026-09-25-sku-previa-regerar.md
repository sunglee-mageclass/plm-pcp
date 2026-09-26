# SKU: Regerar em PRÉVIA — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O "Regerar SKUs" e o SKU editado à mão da seção "4. Códigos" deixam de gravar na hora. Viram PRÉVIA "a gravar",
calculada no SERVIDOR por função só leitura (o MESMO plano da gravação), e só o Salvar do card grava. Voltar/Descartar
mantém os SKUs antigos.

**Architecture:**
- **Banco** (migration `20261005110000`, SÓ funções):
  - a decisão da geração sai do laço de `_gerar_skus_modelo_core` para uma função PURA, `_skus_plano`;
  - a escrita vira um executor único, `_skus_executar_plano`;
  - REF e "Tamanho em" passam a ser PARÂMETROS (`_skus_calc_ref_tipo`/`_skus_matriz_ref_tipo`, geradas do texto vivo por
    âncoras; as 1-arg viram delegadoras);
  - RPC `skus_previa` (STABLE) = matriz + plano + assinatura;
  - RPC `aplicar_skus_modelo` refaz o plano com os valores SALVOS, confere a assinatura, executa e confere de novo.
- **Front:**
  - estado "a gravar" FORA do `Draft` (`useSkusAGravar`, como as linhas de MO);
  - query da prévia;
  - `aoSalvar` async: modelo → SKUs → 1ª geração;
  - `CodigosSecao` com aviso de prévia, selo por linha, ↺ e "manter o meu · usar o novo";
  - sem AlertDialog.

**Tech Stack:** PostgreSQL 17.6 (Supabase próprio; cópia local Docker `supabase_db_banco-local` em `127.0.0.1:54422`),
plpgsql/sql, Vite + React 19 + TypeScript + TanStack Query v5 + supabase-js, Tailwind v4, Vitest 4 (unit `node` +
integração `BEGIN…ROLLBACK` SÓ na cópia), Playwright (QA no `:5173`), Python 3 (gerador da migration), bash (scripts de
produção no molde da reorganização do Sheet).

**Spec:** `docs/superpowers/specs/2026-09-25-sku-previa-regerar-design.md` (commit `9f6c6380` — decisões do dono §2
TRAVADAS; rulings §5). Moldes:
- plano `docs/superpowers/plans/2026-09-25-sheet-planejamento-reorganizacao.md` (Tasks 6, 7 e 10);
- scripts reais em `.claude/worktrees/sheet-reorg/.superpowers/sheet/` (copiados na Task 0);
- spec do SKU `docs/superpowers/specs/2026-09-24-sku-automatico-design.md` §4.

## Global Constraints

**Repositório e worktree**
- Worktree `/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-previa`, branch `sku/previa-regerar`, base
  `06d40485` (ponta da `feature/plan-tecido-a1` com a reorganização do Sheet juntada).
- Caminhos relativos = raiz da worktree. TODO comando de git/gate/script roda DE DENTRO dela e imprime alvo + `HEAD`.
- `.superpowers/` é gitignored: regras, gates, scripts, logs e evidências em `.superpowers/sku-previa/` (não versionados).
- Commit: `git add -- <paths exatos>` + `git commit --only -m "<msg>" -- <paths>` + `git show --stat HEAD`. A mensagem
  termina com `Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>`.
- ⛔ PROIBIDO:
  - `git stash`, `git add .`/`-A`/`commit -a`, `push`, `pkill`/`killall`;
  - editar `src/integrations/supabase/types.ts` (RPC nova via `as any`, como o resto do repo);
  - commitar `src/routeTree.gen.ts` (`git checkout -- src/routeTree.gen.ts` depois do build);
  - imprimir senha/URL com senha/`.env`;
  - despachar subagentes.
- Só mudam os arquivos de `.superpowers/sku-previa/permitidos.txt` (o `gates.sh` confere).
- **Dev intocado** (decisão 8 da campanha): `git diff --name-only savepoint-pre-unificacao-2026-09-22 --
  src/components/desenvolvimento/ src/components/producao/` VAZIO.

**Banco**
- ⛔ PRODUÇÃO: o agente NÃO toca — nem `SELECT`, nem `/tmp/dburl.txt`. Produção só pelo DONO, no Terminal dele, pelos
  scripts da Task 4. Se o controlador precisar LER produção: `psql "$(cat /tmp/dburl.txt)" -X -c "begin transaction read
  only" -c "<select>" -c "rollback"`. O `PGOPTIONS` só-leitura NÃO vale no Supavisor (lição G-commit, 25/set).
- Cópia `postgresql://postgres:postgres@127.0.0.1:54422/postgres` (também o app de teste `:5188`):
  - leitura: `PGOPTIONS='-c default_transaction_read_only=on' psql …`;
  - DDL SÓ (a) na txn revertida das suítes (`SKU_PREVIA_MIG_TXN=1`, `SHEET_MIG_TXN=1`) ou (b) pelos scripts
    `.superpowers/sku-previa/{copia.sh,mig/ensaio-local.sh}`;
  - antes de cada rodada com DDL (inclusive TODA suíte de integração que aplica SQL), o CONTROLADOR publica o AVISO no
    painel (P-30 B — sem esperar OK) e roda `PREVIA_DONO_AVISADO=sim bash .superpowers/sku-previa/n3.sh antes <passo>`;
    depois, `bash .superpowers/sku-previa/n3.sh depois <passo>`. Nada de probe fora disso.
- ⛔ NUNCA `\i` de migration em transação de teste (incidente 15/set). ⛔ NUNCA DDL em transação de teste contra produção
  (incidente 23/set).
- TODO vitest (unit e integração): `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres` EXPLÍCITO (o
  fallback de `tests/integration/db.ts` é PRODUÇÃO — incidente 24/set), caminhos de arquivo LITERAIS, e antes
  `ps -Ao pid,command | grep -E "[v]itest|[p]laywright"` vazio (a cópia é compartilhada: um por vez).
- Migration `supabase/migrations/20261005110000_sku_previa_regerar.sql`, inverso
  `supabase/rollback/20261005110000_sku_previa_regerar_down.sql`. GERADOS por `.superpowers/sku-previa/mig/gerar_sql.py`
  do texto VIVO (dump só leitura da cópia) — nunca editados à mão. Cada arquivo:
  - `SET client_encoding = 'UTF8';` como 1ª instrução, ANTES do `BEGIN;`;
  - 1 `BEGIN;` e 1 `COMMIT;` em linha própria;
  - `SET LOCAL lock_timeout = '500ms';` e `SET LOCAL transaction_timeout = '3s';` logo depois do `BEGIN;`;
  - `$guarda$` com md5 EXATO;
  - NENHUMA DDL de tabela nem de policy;
  - ACL das internas conferida por `has_function_privilege` (#9: `REVOKE … FROM PUBLIC, anon, authenticated`);
  - `$pos$` antes do `COMMIT`;
  - `NOTIFY pgrst, 'reload schema';` antes do `COMMIT`.
- Contagem funções|gatilhos hoje (cópia e produção): **484|277** → com esta frente **493|277** (+9 funções; as 3
  redefinidas não mudam a contagem).
- ORDEM OBRIGATÓRIA:
  1. esta migration em PRODUÇÃO (dono, `ida-producao.sh`);
  2. referência nova da volta da F1 (dono, `ref-volta-f1.sh`);
  3. merge do front na `feature/plan-tecido-a1` JUNTO com `copia.sh ida`;
  4. QA no `:5173`;
  5. deploy (P-47 A — antes do deploy geral).
  O front novo chama RPCs novas: sem o banco, a seção Códigos quebra no `:5173` (que grava em PRODUÇÃO).
- LIFO das voltas: voltar a reorganização (`20261005100000`) ou a F3.5a DEPOIS desta frente exige voltar ESTA antes (a
  guarda da reorganização recusa as 3 funções com outro texto).

**Front**
- Gates de todo commit: `bash .superpowers/sku-previa/gates.sh` → `GATES PREVIA: ok`. Rodam:
  - `npx tsc --noEmit` (o build NÃO checa tipos);
  - `npm run build`;
  - unit sem falha nova vs. linha de base (inclui o anti-drift de UI);
  - lista permitida;
  - Dev intocado;
  - sem `type="date"`, sem toast cru;
  - `mig-txn.ts` intocado;
  - nenhuma migration de outra frente.
- Erro = `mensagemErro`/textos da spec; cor SÓ por token/primitivo (`StatusBadge`, `bg-[var(--tone-warning-bg)]`,
  `text-muted-foreground`, `text-destructive`); ícone lucide `className="h-4 w-4"`; ação em linha `size="iconSm"` (44px no
  mobile: `max-sm:h-11 max-sm:w-11`).
- Colaboração: `data-colab-path={`sku:${variante}:${tamanho}`}` segue nos inputs; o "a gravar" fica FORA do `Draft`
  (R5); `rev`/P0409 do card inalterados.
- Textos EXATOS (spec §4.2):
  - aviso "Prévia — nada foi gravado ainda. Os SKUs só mudam quando você clicar em Salvar; Voltar ou Descartar mantém os
    atuais." + botão "Desfazer prévia";
  - nota da grade "A grade ou os tecidos têm alterações não salvas: a prévia usa a grade salva e é conferida de novo no
    Salvar.";
  - por linha: "novo · a gravar", "muda de X · a gravar", "sai no Salvar", "editado à mão · a gravar", "não será gravado
    — …", "Outra pessoa mudou este SKU para X — o seu (Y) ainda não foi gravado." + "manter o meu" · "usar o novo",
    "igual", "editado à mão — mantido", "Falta sigla: … (mantém X)";
  - selo "prévia a gravar";
  - `title` do Regerar "Mostra como ficam os SKUs — só o Salvar grava.";
  - toasts:
    - "SKUs gravados: N novo(s), M atualizado(s), K removido(s), J à mão.";
    - "Os SKUs mudaram desde a prévia (outra pessoa gerou ou editou, ou mudou sigla, Formato ou grade). A prévia foi
      atualizada — confira e clique em Salvar de novo. O card já foi salvo.";
    - "A prévia dos SKUs ainda estava sendo calculada — o card foi salvo, os SKUs não. Confira a prévia e clique em Salvar
      de novo.";
    - "O card foi salvo, mas os SKUs não foram gravados: …";
  - hint "As variantes vêm do Tecido 1 (seção Tecidos) e os tamanhos, da Grade. Formato: REF - cor base + apelido +
    tamanho (Config da Loja › Formato do SKU). 'Regerar SKUs' mostra a prévia e só o Salvar grava; os editados à mão
    nunca mudam.".
- Mobile 360/390 sem estouro horizontal (medido na QA).

**QA**
- Playwright SÓ com `E2E_BASE_URL=http://localhost:5173`, DEPOIS do merge e ANTES do deploy.
- O `:5173` grava em PRODUÇÃO: card combinado com o dono (D2); nenhum card novo; NUNCA `selectStore`; nunca
  matar/subir o `:5173` nem o `:5188`.

**Processo**
- SDD: implementador Sonnet por tarefa (não despacha subagente); revisor Opus por tarefa (§4); o `code-reviewer` roda sem
  pedir.
- Task 3 fecha o **G-migration** (2 Opus INDEPENDENTES + guardião `guardiao-unificacao`); Task 4 fecha o **G-scripts**
  (Opus + guardião).
- O guardião acompanha TODOS os portões e registra no diário `.superpowers/sdd/2026-09-22-unificacao-kanban-auto/
  guardiao.md` (checkout principal).
- Avisos e perguntas ao dono pelo PAINEL (P-xx com botão Copiar); nunca `ExitPlanMode`.
- SQL/TS/bash do plano NÃO foi executado pelo planejador:
  - erro de sintaxe ou de formato canônico ⇒ corrigir o MÍNIMO e registrar em `.superpowers/sku-previa/desvios.md`
    (erro literal, causa, correção);
  - diferença de RESULTADO velho × novo, prévia × gravação ou de regra de negócio ⇒ PARE e chame o controlador.

---

## 1. Fatos que o código abaixo assume (levantados em 25/set — worktree e cópia, SÓ leitura)

- `src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx` (270 linhas):
  - `SkuCampo` :36-70 (grava no blur via `skus.salvarManual`);
  - `draftSujoParaRegerar` :104;
  - botão Regerar :148-155 (`disabled={!editavel || skus.regerando || draftSujoParaRegerar}`, title "Salve o card antes de
    regerar");
  - `AlertDialog` :254-267;
  - hint :250.
- `useSkusModelo.ts` (114 linhas):
  - `regerar` imediato :33-46 (`gerar_skus_modelo(_, true)`);
  - `salvar` imediato :47-59 (`salvar_sku_manual`);
  - `gerarSeFaltar` :61-74;
  - `useSiglasCores` :95-114.
- `sku-card.ts` (226 linhas):
  - `lerMatriz` :53-86;
  - `situacaoSku` :136-156;
  - `deveGerarPrimeiraVez` :167-170;
  - `skuDigitadoParaSalvar` :175-181;
  - `resumoGeracao` :184-193;
  - `seloCodigos(m)` :197-226;
  - `SeloSecao.tone` ∈ `ok|info|warn|muted` (`ficha/selos-bom.ts:20`).
- `PlanejamentoDetail.tsx` (2044 linhas):
  - `moLinhas`/`moBaseRef` :198-201;
  - `dirty` :644 + `useUnsavedGuard` :645;
  - `refEditavel` :727 (já implica `podeEditarDev` via `devBloqueado`);
  - `useSkusModelo(...)` :734;
  - `aoSalvar` :838;
  - `onMudancaServidor` :911-916 (invalida `["plan-skus", modeloId]`);
  - `selos.codigos = seloCodigos(skus.matriz)` :1221;
  - `<CodigosSecao …>` :1489-1505 (props `refSalva`, `tamanhoTipoSalvo`);
  - import de `tamanhoTipoNormalizado` :61 (único outro uso = :1501).
- `usePlanejamentoSave.ts`:
  - `onSaved: () => void;` :69;
  - `onSuccess: (result) => {` :642;
  - `onSaved();` :809, seguido de `onCreated` :811;
  - payload = `{...d}` do `Draft` (:200-228).
- `tsconfig`: `noUnusedLocals: false`. `@tanstack/react-query` ^5.83 (`keepPreviousData` já usado em `ficha/useFichaBom.ts`).
- Banco (cópia = produção, pós-`20261005100000`):
  - md5 vivos: `_skus_modelo_calc(uuid)` `56c3c48067e07b4cfbcdcf0dccdb5ae6`, `_skus_modelo_core(uuid)`
    `f77fddb7bbfab7025b5f5f5007ede931`, `_gerar_skus_modelo_core(uuid,boolean)` `5f523d3dabda04bcda684ddf2cac0459`
    (= `md5-sku-depois.txt` da reorganização);
  - `proacl` das 3 `{postgres=X/postgres,service_role=X/postgres}`;
  - âncoras (1× cada): no calc `           mo.ref AS mref,` e `           mo.tamanho_tipo AS mtipo,`; no core
    `  SELECT mo.tenant_id, public._sku_norm_ref(mo.ref), tc.sku_config, mo.tamanho_tipo` e
    `    SELECT * FROM public._skus_modelo_calc(_modelo_id)`;
  - `pg_default_acl` de `public` concede EXECUTE a anon/authenticated/service_role em função nova (daí o REVOKE dos 3);
  - `modelo_skus` sem Realtime (fora de `pg_publication_tables`);
  - `_sku_norm_ref(NULL)` = `''`;
  - `sku_config` NULL em todas as lojas da cópia;
  - 272 modelos, 0 com `tamanho_tipo` NULL;
  - nomes novos livres (`to_regprocedure` nulo p/ os 9);
  - contagem **484|277**.
- O PL/pgSQL recusa INSERT/UPDATE/DELETE direto em função STABLE; o PostgREST roda função STABLE em transação READ ONLY.
- `tests/integration/mig-txn.ts` (compartilhado, NÃO editar): `aplicarSql(c, sql, nome)` tira `BEGIN;`/`COMMIT;` e aplica
  em SAVEPOINT.
- `tests/integration/sku-automatico.test.ts`:
  - `SKU_MIG_TXN=1` aplica a F3.5a e a `20261005100000` na txn;
  - a volta conta funções por `^(_sku_|_skus_modelo_|…)` = 23 — os nomes novos desta frente FICAM FORA desse padrão.
- `tests/integration/sheet-reorg-campos.test.ts`:
  - `prepara` :279-282;
  - teste "4 funções do SKU: texto = o do arquivo" :520-533 (quebra quando a prévia estiver viva — Task 3 adapta);
  - `corpoSku(rel, cria)` :105.
- Molde: `.claude/worktrees/sheet-reorg/.superpowers/sheet/{gates.sh,n3.sh,copia.sh,mig/*}`. O bloco literal da F1
  (`espera`, `ativ_vazio`, `com_travas`, `aplica_v2`, `ATIV`) sai de
  `/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-22-kanban-automatico-f1-banco/task-18-runbook-v2.md`
  com hash `c045cc571caf5d95`.
- Cadeia da volta da F1 em `/Users/sunglee/PLM + Criação/savepoints/pre-apply-f1-kanban-auto/`: a mais nova hoje é
  `fidelidade_ref_volta_f1_pos_sheet_detalhe.txt` + `cont_volta_f1_pos_sheet.txt`.
- E2E: `tests/e2e/_helpers.ts` exporta `doLogin(page)` (e `selectStore`, que é PROIBIDO aqui).

## 2. Rulings

Os rulings R1–R13 da spec (§5) valem integralmente. Os do plano:

| # | Ruling | Por quê | Custo se errado |
|---|---|---|---|
| P1 | Nomes novos fora de `_sku_`/`_skus_modelo_`: `_skus_calc_ref_tipo`, `_skus_matriz_ref_tipo`, `_skus_plano`, `_skus_executar_plano`, `_skus_assinatura`, `_skus_previa_core`, `skus_previa`, `_aplicar_skus_modelo_core`, `aplicar_skus_modelo` | O teste de volta da F3.5a (`sku-automatico.test.ts`) conta pelo padrão e seguiria 23 | Nenhum |
| P2 | O front (Tasks 1 e 5) é desenvolvido ANTES da produção, mas SÓ é juntado depois do `IDA OK` do dono | O front novo depende das RPCs novas | Nenhum |
| P3 | Tasks 5 e "seção" numa task só | Mudar a assinatura do hook sem mudar a seção quebra o `tsc` no meio | Task maior, 1 revisão Opus |
| P4 | A suíte da reorganização aprende a prévia viva: texto esperado das 3 = o desta migration; no `SHEET_MIG_TXN=1`, o inverso da prévia roda na txn ANTES da migration dela | Sem isso, depois do `copia.sh ida`, a vizinha falharia à toa (LIFO) | Nenhum |
| P5 | A equivalência VELHO × NOVO roda SÓ com `SKU_PREVIA_MIG_TXN=1` e com a cópia SEM a frente (pula se ela já estiver viva) | Precisa da função viva de ANTES na mesma txn | Depois do `copia.sh ida` ela pula (a prova fica no log da Task 3 e do ensaio) |
| P6 | `volta-producao.sh` com o md5 do inverso CRAVADO no script (sed na Task 4, depois do ensaio) | Lição G-scripts R1: md5 lido de arquivo mutável não protege | Nenhum |
| P7 | Leitura de produção nos scripts por `le()` = `begin transaction read only; …; rollback` (as conferências `espera` do bloco literal da F1 seguem como são — só SELECT) | Lição G-commit R1 | Nenhum |
| P8 | O ensaio roda também a vizinha da reorganização com `SHEET_MIG_TXN=1` com a prévia VIVA (exercita o ramo P4) | É o único momento em que o ramo roda antes do merge | O `:5188` congela alguns segundos (ALTER da reorganização na txn) — dito no aviso N3 |

## 3. Mapa de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `src/components/planejamento/planejamento-detail/codigos/sku-previa.ts` (novo) | Regras PURAS do "a gravar": entrada, leitura tolerante da prévia, textos, `podeRegerar` | 1 |
| `src/components/planejamento/planejamento-detail/codigos/sku-card.ts` | `seloCodigos(m, temPrevia)`; sai `skuDigitadoParaSalvar` (Task 5) | 1, 5 |
| `tests/unit/sku-previa.test.ts` (novo) | Unit das regras puras | 1 |
| `supabase/migrations/20261005110000_sku_previa_regerar.sql` + `supabase/rollback/…_down.sql` (GERADOS) | 9 funções novas + 3 redefinidas; inverso | 2 |
| `tests/integration/sku-previa.test.ts` (novo) | Estático (Task 2) + banco SÓ na cópia (Task 3) | 2, 3 |
| `tests/integration/sheet-reorg-campos.test.ts` | Aprende a prévia viva (P4) | 3 |
| `src/components/planejamento/planejamento-detail/codigos/useSkusModelo.ts` | `useSkusAGravar` + prévia + `aplicarAGravar`; sem RPC imediata | 5 |
| `src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx` | Prévia na tela; sem AlertDialog | 5 |
| `src/components/planejamento/PlanejamentoDetail.tsx` | Fiação: `dirty`, `aoSalvar` async, invalidação, selo, props | 5 |
| `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts` | `onSaved` aguardado | 5 |
| `tests/unit/planejamento-codigos.test.ts` | Testes de fonte da seção/fiação | 5 |
| `docs/superpowers/specs/2026-09-24-sku-automatico-design.md`, `…/2026-09-25-sheet-planejamento-reorganizacao-design.md` | Notas "SKU em prévia" (§4.2/§4.3; §5.4) | 6 |
| `.superpowers/sku-previa/**` (não versionado) | `regras.md`, `permitidos.txt`, `gates.sh`, `n3.sh`, `copia.sh`, `desvios.md`, `molde/`, `mig/{dump_antes.sh,gerar_sql.py,extra.sh,monta-aplica.sh,aplica.sh,ensaio-local.sh,ida-producao.sh,volta-producao.sh,ref-volta-f1.sh,prova-scripts.sh}`, md5, logs | 0, 2, 4 |
| `/Users/sunglee/PLM + Criação/savepoints/pre-apply-sku-previa/` (pasta 700) | `RODAR-sku-previa.md`, backups, contagens, retratos | 4, 6 |
| `tests/e2e/sku-previa-qa.spec.ts` (NÃO versionar) | QA no `:5173` | 6 |

## 4. Revisão e portões

| Momento | Portão |
|---|---|
| Antes da Task 0 | **G-plano** (guardião) sobre a spec + este plano |
| Task 1 | Revisão Opus curta (regras puras × contrato da spec §4.1.3/§4.2) — pode ir junto com a da Task 5 se o controlador preferir (lote F) |
| Tasks 2 + 3 | **G-migration**: 2 revisões Opus INDEPENDENTES (A e B; cada uma recebe só a spec, o plano, os 2 SQL, o gerador e a suíte; não vê o parecer da outra) + guardião. Checklist na Task 3 Step 9 |
| Task 4 | **G-scripts**: Opus + guardião (ensaio real, provas com `psql`/`docker` falsos, RODAR). Depois: o DONO roda a produção |
| Task 5 | Revisão Opus individual (caminho do Salvar + colaboração + dinheiro nenhum) + `code-reviewer` |
| Task 6 | **G-commit** (antes do merge), **G-produção** (logs do dono), **G-deploy** (guardião) |

BLOQUEIA ⇒ parar. APROVA COM RESSALVAS ⇒ resolver/registrar antes do passo seguinte.

Ordem: G-plano → T0 → T1 → T2 → T3 (G-migration) → T4 (G-scripts; dono: produção) → T5 (pode começar depois da T1,
em série na MESMA worktree) → T6.

---

## Task 0: Pré-voo e trilhos (sem commit)

**Files (não versionados):** `.superpowers/sku-previa/{regras.md,permitidos.txt,desvios.md,gates.sh,n3.sh,unit-fail-base.txt,copia-estado-t0.txt}`, `.superpowers/sku-previa/molde/*`, `.superpowers/sku-previa/logs/`.

**Interfaces:**
- Produces: `bash .superpowers/sku-previa/gates.sh` → `GATES PREVIA: ok`; `bash .superpowers/sku-previa/n3.sh antes|depois <passo>`.

- [ ] **Step 1: Conferir worktree, branch e base**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-previa"
git rev-parse --show-toplevel
git branch --show-current                                      # sku/previa-regerar
git merge-base --is-ancestor 06d40485 HEAD && echo "base ok"
git log --oneline -3                                           # 9f6c6380 (spec) e o commit deste plano no topo
git status --short                                             # vazio
```

- [ ] **Step 2: Copiar o molde (SÓ cópia, para não depender da worktree `sheet-reorg`, que pode ser removida)**

```bash
S=.superpowers/sku-previa
mkdir -p "$S/molde" "$S/logs" "$S/mig/antes"
R=../sheet-reorg/.superpowers/sheet
cp -p "$R/gates.sh" "$R/n3.sh" "$R/copia.sh" "$S/molde/"
cp -p "$R/mig/aplica.sh" "$R/mig/extra.sh" "$R/mig/monta-aplica.sh" "$R/mig/ensaio-local.sh" "$R/mig/ida-producao.sh" \
      "$R/mig/volta-producao.sh" "$R/mig/ref-volta-f1.sh" "$R/mig/prova-scripts.sh" "$R/mig/gerar_sql.py" "$R/mig/dump_antes.sh" "$S/molde/"
( cd "$S/molde" && shasum -a 256 * > SHA256SUMS ) && wc -l "$S/molde/SHA256SUMS"   # 13 linhas
```

- [ ] **Step 3: `regras.md`, `permitidos.txt`, `desvios.md`**

`.superpowers/sku-previa/regras.md`:

```markdown
# Regras do SKU em prévia — TODO executor lê antes de CADA task
1. Só na worktree `.claude/worktrees/sku-previa` (branch `sku/previa-regerar`); todo comando DE DENTRO dela.
2. Commit: `git add -- <arquivos exatos>` + `git commit --only -m "…" -- <arquivos>` + `git show --stat HEAD`. PROIBIDO
   `git add .`/`-A`/`commit -a`, `git stash`, push, `pkill`/`killall`. Mensagem termina com `Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>`.
3. Antes de TODO commit: `bash .superpowers/sku-previa/gates.sh` → `GATES PREVIA: ok`. Falhou = PARE.
4. PRODUÇÃO: nada (nem SELECT, nem `/tmp/dburl.txt`). Só o DONO, pelos scripts da Task 4.
5. Cópia: DDL SÓ pela suíte com `SKU_PREVIA_MIG_TXN=1`/`SHEET_MIG_TXN=1` ou pelos scripts de `.superpowers/sku-previa/`,
   SEMPRE entre `n3.sh antes` e `n3.sh depois` (o controlador publica o aviso no painel antes — P-30 B). Inclui TODA suíte
   de integração que aplica SQL. NUNCA `\i`; nada de probe.
6. Todo vitest com `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres` explícito + caminho LITERAL;
   antes, `ps -Ao pid,command | grep -E "[v]itest|[p]laywright"` vazio.
7. Leitura na cópia: `PGOPTIONS='-c default_transaction_read_only=on' psql …`.
8. Migration e inverso SÓ pelo `gerar_sql.py` — nunca editar os .sql à mão.
9. Dev intocado (`src/components/desenvolvimento/**`, `src/components/producao/**`).
10. Tela: textos do plano verbatim, `mensagemErro`, cor só por token, `size="iconSm"` + 44px no mobile.
11. Não subir/derrubar servidor; nunca `:5173`/`:5188`. Não despachar subagentes. Nunca imprimir senha/.env.
12. Erro de sintaxe/formato do código do plano: corrigir o MÍNIMO e registrar em `desvios.md`. Diferença de RESULTADO
    (velho × novo, prévia × gravação) ou dúvida de regra: PARE e chame o controlador.
```

`.superpowers/sku-previa/permitidos.txt` (uma linha por caminho, sem comentário):

```
docs/superpowers/specs/2026-09-25-sku-previa-regerar-design.md
docs/superpowers/plans/2026-09-25-sku-previa-regerar.md
docs/superpowers/specs/2026-09-24-sku-automatico-design.md
docs/superpowers/specs/2026-09-25-sheet-planejamento-reorganizacao-design.md
supabase/migrations/20261005110000_sku_previa_regerar.sql
supabase/rollback/20261005110000_sku_previa_regerar_down.sql
src/components/planejamento/planejamento-detail/codigos/sku-previa.ts
src/components/planejamento/planejamento-detail/codigos/sku-card.ts
src/components/planejamento/planejamento-detail/codigos/useSkusModelo.ts
src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx
src/components/planejamento/PlanejamentoDetail.tsx
src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts
tests/unit/sku-previa.test.ts
tests/unit/planejamento-codigos.test.ts
tests/integration/sku-previa.test.ts
tests/integration/sheet-reorg-campos.test.ts
```

`.superpowers/sku-previa/desvios.md`: `# Desvios do plano (SKU em prévia)` + uma linha "formato: data · task · erro literal · causa · correção".

- [ ] **Step 4: `gates.sh`**

```bash
#!/usr/bin/env bash
# Gates de TODO commit do SKU em prévia. Uso (DE DENTRO da worktree): bash .superpowers/sku-previa/gates.sh → "GATES PREVIA: ok".
# NÃO roda tests/integration (cada task de banco roda a sua suíte, entre n3 antes/depois).
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/sku-previa) ;; *) echo "GATE FALHOU: rode de dentro da worktree sku-previa (achei $TOP)"; exit 1;; esac
cd "$TOP"
S=.superpowers/sku-previa
echo "== gates sku-previa · alvo: $TOP · HEAD $(git rev-parse --short HEAD) ($(git branch --show-current))"
falha() { echo "GATE FALHOU: $1"; exit 1; }
BASE="$(git merge-base feature/plan-tecido-a1 HEAD)"
mkdir -p "$S/logs"
if ps -Ao command | grep -E "[v]itest|[p]laywright" > /dev/null; then falha "vitest/playwright rodando (a cópia é compartilhada — um por vez)"; fi
npx tsc --noEmit > "$S/logs/tsc.log" 2>&1 || { tail -20 "$S/logs/tsc.log"; falha "tsc (o build NÃO faz type-check)"; }
npm run build > "$S/logs/build.log" 2>&1 || { tail -20 "$S/logs/build.log"; falha "build"; }
git checkout -- src/routeTree.gen.ts 2>/dev/null || true
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/unit > "$S/logs/unit.log" 2>&1
grep -qE "Test Files .*passed" "$S/logs/unit.log" || { tail -20 "$S/logs/unit.log"; falha "unit (sem resumo)"; }
grep -E "^ FAIL " "$S/logs/unit.log" | sed -E 's/ +[0-9]+ms$//' | sort -u > "$S/logs/unit-fail-agora.txt"
diff -q "$S/unit-fail-base.txt" "$S/logs/unit-fail-agora.txt" > /dev/null \
  || { diff "$S/unit-fail-base.txt" "$S/logs/unit-fail-agora.txt"; falha "unit (falhas ≠ linha de base — inclui o anti-drift de UI)"; }
FORA="$( { git diff --name-only "$BASE" HEAD; git diff --name-only; git diff --name-only --cached; \
           git ls-files --others --exclude-standard; } | sort -u | grep -vxF -f "$S/permitidos.txt" || true)"
[ -z "$FORA" ] || { echo "$FORA"; falha "arquivo fora da lista permitida ($S/permitidos.txt)"; }
[ -z "$(git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/)" ] \
  || falha "Dev/Produção mudou desde o save point (decisão travada 8)"
for f in $(grep '^src/' "$S/permitidos.txt"); do
  [ -f "$f" ] || continue
  if grep -n 'type="date"' "$f"; then falha "<input type=\"date\"> em $f — use <DateField>"; fi
  if grep -nE 'toast\.error\((e|err|error)\.message' "$f"; then falha "toast de erro sem mensagemErro em $f"; fi
done
[ "$(git show feature/plan-tecido-a1:tests/integration/mig-txn.ts)" = "$(cat tests/integration/mig-txn.ts)" ] \
  || falha "tests/integration/mig-txn.ts mudou (é compartilhado — não editar)"
OUTRA="$(git diff --name-only "$BASE" HEAD -- supabase/migrations/ supabase/rollback/ | grep -v '20261005110000_sku_previa_regerar' || true)"
[ -z "$OUTRA" ] || { echo "$OUTRA"; falha "migration de OUTRA frente mudou"; }
echo "GATES PREVIA: ok"
```

- [ ] **Step 5: `n3.sh`**

```bash
#!/usr/bin/env bash
# N3 — a cópia (:54422) é também o APP DE TESTE do dono (:5188). Toda rodada com DDL na cópia (suíte com SKU_PREVIA_MIG_TXN=1
# ou SHEET_MIG_TXN=1, ensaio, copia.sh ida|volta) passa por aqui. Esta frente SÓ cria/troca FUNÇÕES: a migration dela não
# congela o :5188. A suíte da reorganização com SHEET_MIG_TXN=1 faz ALTER em modelos/tenant_config na txn: congela por alguns
# segundos. P-30 B do dono: o controlador publica o AVISO no painel ANTES (sem esperar OK). SÓ LEITURA. Uso:
#   PREVIA_DONO_AVISADO=sim bash .superpowers/sku-previa/n3.sh antes <passo>      ex.: t3, ensaio, copia-ida
#   bash .superpowers/sku-previa/n3.sh depois <passo>
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/sku-previa) ;; *) echo "PARE: rode de dentro da worktree sku-previa"; exit 1;; esac
cd "$TOP"
LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
QUANDO="${1:-}"; PASSO="${2:-}"
case "$QUANDO" in antes|depois) ;; *) echo "uso: n3.sh antes|depois <passo>"; exit 2 ;; esac
[ -n "$PASSO" ] || { echo "uso: n3.sh antes|depois <passo>"; exit 2; }
mkdir -p .superpowers/sku-previa/logs
docker ps --filter name=supabase_db_banco-local --format '{{.Status}}' | grep -q '^Up' \
  || { echo "PARE: cópia fora do ar (não subir/recriar por conta própria)"; exit 1; }
if [ "$QUANDO" = antes ]; then
  if ps -Ao command | grep -E "[v]itest|[p]laywright" > /dev/null; then
    ps -Ao pid,command | grep -E "[v]itest|[p]laywright"; echo "PARE: vitest/playwright rodando (um por vez na cópia)"; exit 1
  fi
  N=$(PGCONNECT_TIMEOUT=5 psql "$LOCAL" -X -A -t -v ON_ERROR_STOP=1 -c "select count(*) from pg_stat_activity where datname = current_database() and backend_type = 'client backend' and pid <> pg_backend_pid() and state <> 'idle'") \
    || { echo "PARE: não conectei na cópia"; exit 1; }
  [ "$N" = 0 ] || { echo "PARE: $N sessão(ões) ativa(s) na cópia — outra frente usando; esperar"; exit 1; }
  if [ "${PREVIA_DONO_AVISADO:-}" != sim ]; then
    cat <<'MSG'
PARE: publique o AVISO no painel ANTES (P-30 B) e rode de novo com PREVIA_DONO_AVISADO=sim:
  "Vou rodar <passo> do SKU em prévia na cópia local agora (~<N> min). A migration desta frente só troca funções (o :5188 não
   congela); os testes criam dados numa transação desfeita no fim. <Se for o ensaio ou SHEET_MIG_TXN=1: a suíte da
   reorganização faz ALTER em modelos/tenant_config dentro da transação — o :5188 congela por alguns segundos.>"
MSG
    exit 1
  fi
fi
E=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -c "select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') || '|' || (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal) || '|' || (to_regprocedure('public.skus_previa(uuid,text,text,jsonb,text)') is not null)") \
  || { echo "PARE: não li o estado da cópia"; exit 1; }
P=$(lsof -nP -iTCP:5188 -sTCP:LISTEN -t 2>/dev/null | head -1)
AV=""; [ "$QUANDO" = antes ] && AV=" · aviso no painel"
echo "$(date '+%F %T') $QUANDO $PASSO: funções|gatilhos|prévia = $E · :5188 $([ -n "$P" ] && echo "no ar (PID $P)" || echo "fora do ar")$AV" \
  | tee -a .superpowers/sku-previa/logs/n3.log
[ "$QUANDO" = antes ] && echo "OK (N3): pode rodar $PASSO"
exit 0
```

- [ ] **Step 6: Linha de base da unit (antes de qualquer mudança)**

```bash
ps -Ao pid,command | grep -E "[v]itest|[p]laywright"      # vazio
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/unit > .superpowers/sku-previa/logs/unit-base.log 2>&1
grep -E "^ FAIL " .superpowers/sku-previa/logs/unit-base.log | sed -E 's/ +[0-9]+ms$//' | sort -u > .superpowers/sku-previa/unit-fail-base.txt
cat .superpowers/sku-previa/unit-fail-base.txt
chmod +x .superpowers/sku-previa/gates.sh .superpowers/sku-previa/n3.sh && bash .superpowers/sku-previa/gates.sh
```
Expected: `GATES PREVIA: ok` (só o spec e o plano mudaram desde a base; os dois estão em `permitidos.txt`).

- [ ] **Step 7: Estado da cópia (SÓ leitura)**

```bash
PGOPTIONS='-c default_transaction_read_only=on' psql postgresql://postgres:postgres@127.0.0.1:54422/postgres -X -A -t -F'|' -c "
select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') || '|' ||
       (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal),
       (select string_agg(md5(pg_get_functiondef(to_regprocedure(f))), '|' order by n) from unnest(array['public._skus_modelo_calc(uuid)','public._skus_modelo_core(uuid)','public._gerar_skus_modelo_core(uuid,boolean)']) with ordinality u(f, n)),
       (select count(*) from unnest(array['public._skus_assinatura(jsonb)','public._skus_calc_ref_tipo(uuid,text,text)','public._skus_matriz_ref_tipo(uuid,text,text)','public._skus_plano(uuid,text,text,jsonb,text)','public._skus_executar_plano(uuid,uuid,jsonb,boolean)','public._skus_previa_core(uuid,text,text,jsonb,text)','public._aplicar_skus_modelo_core(uuid,jsonb,text,text)','public.skus_previa(uuid,text,text,jsonb,text)','public.aplicar_skus_modelo(uuid,jsonb,text,text)']) f(x) where to_regprocedure(f.x) is not null),
       to_regprocedure('public._titulo_pagina_calculado(text,text)') is not null" | tee .superpowers/sku-previa/copia-estado-t0.txt
```
Expected: `484|277|56c3c48067e07b4cfbcdcf0dccdb5ae6|f77fddb7bbfab7025b5f5f5007ede931|5f523d3dabda04bcda684ddf2cac0459|0|t`.
Qualquer outro valor ⇒ PARE e chame o controlador (outra frente mudou o SKU na cópia).

- [ ] **Step 8: Sobreposição com outras frentes (só leitura)**

```bash
for br in $(git for-each-ref --format='%(refname:short)' refs/heads/ | grep -vxE 'sku/previa-regerar|feature/plan-tecido-a1|main'); do
  git cherry feature/plan-tecido-a1 "$br" 2>/dev/null | grep -q '^+' || continue
  S2=$(git diff --name-only "$(git merge-base feature/plan-tecido-a1 "$br")" "$br" | grep -xF -f .superpowers/sku-previa/permitidos.txt || true)
  [ -z "$S2" ] || echo "SOBREPOE $br: $S2"
done; echo "fim da sobreposição"
```
Expected: nenhuma linha `SOBREPOE`. Se houver ⇒ o controlador decide a ordem de merge antes da Task 5.

- [ ] **Step 9: Relatório ao controlador** (sem commit)

Mande: HEAD, as sha256 do molde, a linha do Step 7, a linha de base da unit (nº de falhas herdadas) e o resultado do Step 8.


---

## Task 1: `codigos/sku-previa.ts` — regras puras do "a gravar" (TDD)

**Files:**
- Create: `src/components/planejamento/planejamento-detail/codigos/sku-previa.ts`
- Modify: `src/components/planejamento/planejamento-detail/codigos/sku-card.ts:195-197` (`seloCodigos` ganha `temPrevia`)
- Test: `tests/unit/sku-previa.test.ts` (novo)

**Interfaces:**
- Consumes (já existem): `normalizarSkuManual(s) → {ok:true,valor}|{ok:false,erro}` (`@/lib/sku-montar`); `mensagemErro(e,
  fallback)` (`@/lib/erro-mensagem`); de `./sku-card`: `lerMatriz(raw) → MatrizSkus`, `situacaoSku(l) → SituacaoSku`,
  tipos `LinhaSku`, `MatrizSkus`, `SituacaoSku`.
- Produces (usados na Task 5):
  - `type ManualAGravar = { varianteKey: string; tamanhoKey: string; sku: string; id: string | null; rev: number | null }`
  - `type SkusAGravar = { regerar: boolean; manuais: Record<string, ManualAGravar> }`; `SKUS_A_GRAVAR_VAZIO`
  - `type ModoPrevia = "manuais" | "regerar"`; `modoPrevia(s)`; `nadaAGravar(s)`; `chaveLinhaSku(vk, tk)`
  - `comRegerar(s)`, `semManual(s, chave)`, `manterMeu(s, l)`, `digitarSku(s, l, texto) → { aGravar, erro, valor }`
  - `type PreviaLinha`, `type LinhaPrevia = LinhaSku & { previa: PreviaLinha | null }`; `skuExibido(l, s) → string`
  - `type ManualRpc`; `manuaisParaRpc(s) → ManualRpc[]`
  - `type EntradaPrevia`; `chaveEntradaPrevia(e) → string`; `entradaDaChave(chave) → { ref, tamanhoTipo, modo, manuais }`
  - `refParaPrevia({ refVaiNoSalvar, refRascunho, refSalva }) → string`
  - `type ErroPrevia`, `type PreviaSkus`; `lerPrevia(raw, entrada) → PreviaSkus` (fail-closed)
  - `type SituacaoPrevia = SituacaoSku & { aGravar; conflitoVersao }`; `situacaoPrevia(l)`
  - `resumoAplicacao(raw) → { erro, texto }`; `mensagemAplicarSkus(e) → string`; `mensagemErroPrevia(e: ErroPrevia) → string`
  - `podeRegerar({ podeEditar, matriz, refPrevia, jaPedido }) → { pode, motivo }`
  - constantes de texto `TEXTO_PREVIA`, `TEXTO_BOM_SUJO`, `MSG_PREVIA_CALCULANDO`, `MSG_PREVIA_DESATUALIZADA`,
    `PREFIXO_SKUS_NAO_GRAVADOS`, `TITULO_REGERAR`
  - `seloCodigos(m, temPrevia = false)` (sku-card.ts)

- [ ] **Step 1: Escrever o teste que falha — `tests/unit/sku-previa.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  MSG_PREVIA_DESATUALIZADA, PREFIXO_SKUS_NAO_GRAVADOS, SKUS_A_GRAVAR_VAZIO, TITULO_REGERAR, chaveEntradaPrevia,
  chaveLinhaSku, comRegerar, digitarSku, entradaDaChave, lerPrevia, manterMeu, manuaisParaRpc, mensagemAplicarSkus,
  mensagemErroPrevia, modoPrevia, nadaAGravar, podeRegerar, refParaPrevia, resumoAplicacao, semManual, situacaoPrevia,
  skuExibido, type LinhaPrevia, type SkusAGravar,
} from "@/components/planejamento/planejamento-detail/codigos/sku-previa";
import { seloCodigos, type LinhaSku, type MatrizSkus } from "@/components/planejamento/planejamento-detail/codigos/sku-card";

// SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.2 — P-46 do dono): o Regerar e o SKU à mão ficam "a gravar" e só o
// Salvar grava. Regras PURAS: entrada da prévia, leitura tolerante (fail-closed), textos. Sem espelho TS da geração.
const K1 = "11111111-1111-1111-1111-111111111111";
const K2 = "22222222-2222-2222-2222-222222222222";
const ASS = "0123456789abcdef0123456789abcdef";
const linha = (p: Partial<LinhaSku> = {}): LinhaSku => ({
  variante_key: K1, variante_ordem: 1, cor_nome: "Amarelo", apelido_nome: null, tamanho_key: "34|PPP", tamanho_ordem: 1,
  id: "id-1", sku: "AA34", manual: false, rev: 0, sku_previsto: "AA34", faltas: [], avisos: [], conflito_com: null,
  estado: "ok", ...p,
});
const comPrevia = (l: LinhaSku, previa: LinhaPrevia["previa"]): LinhaPrevia => ({ ...l, previa });
const matriz = (p: Partial<MatrizSkus> = {}): MatrizSkus => ({
  status: "ok", tamanho_tipo: "numero", tamanho_tipo_card: "numero", linhas: [], faltas: [], avisos: [], ...p,
});
const cruaLinha = (p: Record<string, unknown> = {}) => ({
  variante_key: K1, variante_ordem: 1, cor_nome: "Amarelo", apelido_nome: null, tamanho_key: "34|PPP", tamanho_ordem: 1,
  id: "id-1", sku: "AA34", manual: false, rev: 0, sku_previsto: "AA34", faltas: [], avisos: [], conflito_com: null,
  estado: "ok", previa: null, ...p,
});

describe("a gravar — rascunho dos SKUs (nada grava antes do Salvar)", () => {
  it("vazio = nada a gravar (modo 'manuais'); Regerar entra, é idempotente e muda o modo", () => {
    expect(nadaAGravar(SKUS_A_GRAVAR_VAZIO)).toBe(true);
    expect(modoPrevia(SKUS_A_GRAVAR_VAZIO)).toBe("manuais");
    const r = comRegerar(SKUS_A_GRAVAR_VAZIO);
    expect([nadaAGravar(r), modoPrevia(r)]).toEqual([false, "regerar"]);
    expect(comRegerar(r)).toBe(r);
  });

  it("digitarSku: normaliza como o servidor; igual ao que a linha MOSTRA = nada; inválido/vazio = erro PT e nada muda", () => {
    const l = linha();
    expect(digitarSku(SKUS_A_GRAVAR_VAZIO, l, " aa34 ")).toEqual({ aGravar: SKUS_A_GRAVAR_VAZIO, erro: null, valor: "AA34" });
    const r = digitarSku(SKUS_A_GRAVAR_VAZIO, l, " meu-1 ");
    expect([r.erro, r.valor]).toEqual([null, "MEU-1"]);
    expect(r.aGravar.manuais[chaveLinhaSku(K1, "34|PPP")]).toEqual({ varianteKey: K1, tamanhoKey: "34|PPP", sku: "MEU-1", id: "id-1", rev: 0 });
    const inv = digitarSku(r.aGravar, l, "a#b");
    expect(inv).toEqual({ aGravar: r.aGravar, erro: "SKU inválido: use só letras, números e - . _ /.", valor: "MEU-1" });
    expect(digitarSku(SKUS_A_GRAVAR_VAZIO, l, "   ").erro).toBe("Informe o SKU.");
    const semSku = linha({ id: null, sku: null, rev: null });
    expect(digitarSku(SKUS_A_GRAVAR_VAZIO, semSku, "")).toEqual({ aGravar: SKUS_A_GRAVAR_VAZIO, erro: null, valor: "" });
    const nova = digitarSku(SKUS_A_GRAVAR_VAZIO, semSku, "x-1").aGravar.manuais[chaveLinhaSku(K1, "34|PPP")];
    expect(nova).toEqual({ varianteKey: K1, tamanhoKey: "34|PPP", sku: "X-1", id: null, rev: null });
  });

  it("skuExibido: digitado > o que o Salvar grava (novo/muda) > o gravado; 'sai' e 'conflito' mostram o gravado", () => {
    const l = linha();
    expect(skuExibido(l, SKUS_A_GRAVAR_VAZIO)).toBe("AA34");
    const muda = comPrevia(l, { acao: "muda", sku_de: "AA34", sku_para: "AAPPP", mensagem: null, code: null });
    expect(skuExibido(muda, SKUS_A_GRAVAR_VAZIO)).toBe("AAPPP");
    const sai = comPrevia(l, { acao: "sai", sku_de: "AA34", sku_para: null, mensagem: null, code: null });
    expect(skuExibido(sai, SKUS_A_GRAVAR_VAZIO)).toBe("AA34");
    const conf = comPrevia(l, { acao: "conflito", sku_de: "AA34", sku_para: "BB34", mensagem: "x", code: null });
    expect(skuExibido(conf, SKUS_A_GRAVAR_VAZIO)).toBe("AA34");
    const s = digitarSku(SKUS_A_GRAVAR_VAZIO, muda, "meu").aGravar;
    expect(skuExibido(muda, s)).toBe("MEU");
    // o digitado igual ao que o Regerar vai gravar (AAPPP) = nada (não marca "à mão" por engano)
    expect(digitarSku(SKUS_A_GRAVAR_VAZIO, muda, "aappp").aGravar).toBe(SKUS_A_GRAVAR_VAZIO);
  });

  it("semManual tira só aquela linha; manterMeu troca id/rev pela versão NOVA (outra pessoa mudou) e mantém o meu SKU", () => {
    const s = digitarSku(SKUS_A_GRAVAR_VAZIO, linha(), "meu-1").aGravar;
    const c = chaveLinhaSku(K1, "34|PPP");
    expect(semManual(s, c).manuais).toEqual({});
    expect(semManual(s, "outra")).toBe(s);
    expect(manterMeu(s, linha({ id: "id-1", rev: 3, sku: "DELA" })).manuais[c]).toEqual({
      varianteKey: K1, tamanhoKey: "34|PPP", sku: "MEU-1", id: "id-1", rev: 3,
    });
    expect(manterMeu(SKUS_A_GRAVAR_VAZIO, linha())).toBe(SKUS_A_GRAVAR_VAZIO);
  });

  it("manuaisParaRpc em ordem estável; chaveEntradaPrevia estável (ordem de digitação não importa) e reversível", () => {
    let a: SkusAGravar = SKUS_A_GRAVAR_VAZIO;
    a = digitarSku(a, linha({ variante_key: K2 }), "b").aGravar;
    a = digitarSku(a, linha(), "a").aGravar;
    let b: SkusAGravar = SKUS_A_GRAVAR_VAZIO;
    b = digitarSku(b, linha(), "a").aGravar;
    b = digitarSku(b, linha({ variante_key: K2 }), "b").aGravar;
    expect(manuaisParaRpc(a).map((m) => m.variante_key)).toEqual([K1, K2]);
    const e = { ref: "  REF1 ", tamanhoTipo: "letra" as const, aGravar: comRegerar(a) };
    expect(chaveEntradaPrevia(e)).toBe(chaveEntradaPrevia({ ...e, ref: "REF1", aGravar: comRegerar(b) }));
    expect(entradaDaChave(chaveEntradaPrevia(e))).toEqual({
      ref: "REF1", tamanhoTipo: "letra", modo: "regerar",
      manuais: [
        { variante_key: K1, tamanho_key: "34|PPP", sku: "A", rev: 0 },
        { variante_key: K2, tamanho_key: "34|PPP", sku: "B", rev: 0 },
      ],
    });
  });

  it("refParaPrevia: a do rascunho (aparada) só quando ela vai no Salvar; senão a SALVA", () => {
    expect(refParaPrevia({ refVaiNoSalvar: true, refRascunho: " NOVA ", refSalva: "VELHA" })).toBe("NOVA");
    expect(refParaPrevia({ refVaiNoSalvar: false, refRascunho: "NOVA", refSalva: " VELHA " })).toBe("VELHA");
  });
});

describe("lerPrevia — leitura tolerante e FAIL-CLOSED", () => {
  it("ok: matriz + previa por linha + assinatura md5 + erros + nº de conflitos", () => {
    const p = lerPrevia({
      status: "ok", tamanho_tipo: "letra", tamanho_tipo_card: "letra", faltas: [], avisos: [], assinatura: ASS,
      conflitos: [{ mensagem: "x" }],
      erros: [{ variante_key: K1, tamanho_key: "34|PPP", code: "P0409", mensagem: "conflito_versao: o SKU foi alterado por outra pessoa" }],
      linhas: [cruaLinha({ previa: { acao: "muda", sku_de: "AA34", sku_para: "AAPPP", mensagem: null, code: null } }), cruaLinha({ tamanho_key: "36|PP" })],
    }, "k");
    expect([p.desconhecida, p.assinatura, p.entrada, p.nConflitos]).toEqual([false, ASS, "k", 1]);
    expect(p.matriz.linhas.map((l) => l.previa?.acao ?? null)).toEqual(["muda", null]);
    expect(p.erros).toEqual([{ variante_key: K1, tamanho_key: "34|PPP", code: "P0409", mensagem: "conflito_versao: o SKU foi alterado por outra pessoa" }]);
  });
  it("ação desconhecida, assinatura que não é md5 ou status desconhecido ⇒ desconhecida e SEM assinatura (o Salvar não grava)", () => {
    const acao = lerPrevia({ status: "ok", assinatura: ASS, linhas: [cruaLinha({ previa: { acao: "teletransporta" } })] }, "k");
    expect([acao.desconhecida, acao.assinatura]).toEqual([true, null]);
    expect(acao.matriz.linhas[0].previa).toMatchObject({ acao: "erro", mensagem: "Situação desconhecida — recarregue a página." });
    expect(lerPrevia({ status: "ok", assinatura: "xyz", linhas: [] }, "k").assinatura).toBeNull();
    expect(lerPrevia({ status: "novo_status", assinatura: ASS, linhas: [] }, "k")).toMatchObject({ desconhecida: true, assinatura: null });
    expect(lerPrevia(null, "k")).toMatchObject({ desconhecida: true, assinatura: null, erros: [] });
  });
});

describe("situacaoPrevia — o que a linha diz", () => {
  const p = (acao: NonNullable<LinhaPrevia["previa"]>["acao"], x: Partial<NonNullable<LinhaPrevia["previa"]>> = {}) =>
    comPrevia(linha(), { acao, sku_de: "AA34", sku_para: "AAPPP", mensagem: null, code: null, ...x });
  it("ações do plano (a gravar em âmbar; conflito/erro em vermelho; rev velho oferece manter/usar)", () => {
    expect(situacaoPrevia(p("novo"))).toMatchObject({ tom: "warning", texto: "novo · a gravar", aGravar: true });
    expect(situacaoPrevia(p("muda"))).toMatchObject({ tom: "warning", texto: "muda de AA34 · a gravar", aGravar: true });
    expect(situacaoPrevia(p("sai"))).toMatchObject({ tom: "warning", texto: "sai no Salvar", aGravar: true });
    expect(situacaoPrevia(p("manual_novo"))).toMatchObject({ tom: "warning", texto: "editado à mão · a gravar", aGravar: true });
    expect(situacaoPrevia(p("conflito", { mensagem: "SKU AAPPP já existe em X (REF Y). Edite este SKU à mão ou mude a sigla." })))
      .toMatchObject({ tom: "danger", texto: "não será gravado — SKU AAPPP já existe em X (REF Y). Edite este SKU à mão ou mude a sigla.", aGravar: false });
    expect(situacaoPrevia(p("erro", { code: "P0001", mensagem: "O SKU X já está em outra linha deste produto." })))
      .toMatchObject({ tom: "danger", texto: "O SKU X já está em outra linha deste produto.", conflitoVersao: false });
    expect(situacaoPrevia(comPrevia(linha({ sku: "DELA" }), { acao: "erro", sku_de: "DELA", sku_para: "meu", mensagem: "conflito_versao", code: "P0409" })))
      .toMatchObject({ tom: "danger", texto: "Outra pessoa mudou este SKU para DELA — o seu (meu) ainda não foi gravado.", conflitoVersao: true });
  });
  it("sem ação (a linha não muda): igual / manual mantido / falta que mantém o gravado / o resto como hoje", () => {
    expect(situacaoPrevia(comPrevia(linha(), null))).toMatchObject({ tom: "neutral", texto: "igual", aGravar: false });
    expect(situacaoPrevia(comPrevia(linha({ estado: "manual", manual: true }), null))).toMatchObject({ tom: "info", texto: "editado à mão — mantido" });
    const falta = linha({ estado: "falta", faltas: [{ atributo: "cor_base", id: null, nome: "Amarelo" }] });
    expect(situacaoPrevia(comPrevia(falta, null)).texto).toMatch(/ \(mantém AA34\)$/);
    expect(situacaoPrevia(comPrevia(linha({ estado: "pendente", sku: null }), null))).toMatchObject({ texto: "a gerar", aGravar: false });
  });
});

describe("mensagens, Regerar e selo", () => {
  it("resumoAplicacao: contagens; com conflito vira erro com a 1ª mensagem do servidor", () => {
    expect(resumoAplicacao({ criados: 1, atualizados: 2, removidos: 0, manuais: 1, conflitos: [] }))
      .toEqual({ erro: false, texto: "SKUs gravados: 1 novo(s), 2 atualizado(s), 0 removido(s), 1 à mão." });
    expect(resumoAplicacao({ criados: 3, conflitos: [{ mensagem: "SKU AA34 já existe em X (REF Y). Edite este SKU à mão ou mude a sigla." }] }))
      .toEqual({ erro: true, texto: "SKUs gravados: 3 novo(s), 0 atualizado(s), 0 removido(s), 0 à mão. 1 SKU não gravado: SKU AA34 já existe em X (REF Y). Edite este SKU à mão ou mude a sigla." });
  });
  it("mensagemAplicarSkus: P0409 = texto do SKU (não o genérico); o resto = 'O card foi salvo, mas os SKUs não…' + a mensagem", () => {
    expect(mensagemAplicarSkus({ code: "P0409", message: "previa_desatualizada: os SKUs mudaram desde a prévia" })).toBe(MSG_PREVIA_DESATUALIZADA);
    expect(mensagemAplicarSkus({ code: "P0001", message: "O SKU X já existe em Y (REF Z). Escolha outro." }))
      .toBe(`${PREFIXO_SKUS_NAO_GRAVADOS}O SKU X já existe em Y (REF Z). Escolha outro.`);
    expect(mensagemErroPrevia({ variante_key: K1, tamanho_key: "34|PPP", code: "P0409", mensagem: "x" }))
      .toBe(`${PREFIXO_SKUS_NAO_GRAVADOS}outra pessoa mudou um SKU que você digitou — escolha “manter o meu” ou “usar o novo” na linha.`);
  });
  it("podeRegerar: permissão → carregado → status legível → Formato → REF → ainda não pedido", () => {
    const base = { podeEditar: true, matriz: matriz(), refPrevia: "REF1", jaPedido: false };
    expect(podeRegerar(base)).toEqual({ pode: true, motivo: TITULO_REGERAR });
    expect(podeRegerar({ ...base, podeEditar: false })).toEqual({ pode: false, motivo: "Sem permissão para editar os SKUs." });
    expect(podeRegerar({ ...base, matriz: undefined }).pode).toBe(false);
    expect(podeRegerar({ ...base, matriz: matriz({ status: "desconhecido" }) }).pode).toBe(false);
    expect(podeRegerar({ ...base, matriz: matriz({ status: "sem_formato" }) })).toEqual({ pode: false, motivo: "A loja ainda não tem o Formato do SKU." });
    // REF/"Tamanho em" digitados e não salvos NÃO travam mais (P-46): só REF vazia
    expect(podeRegerar({ ...base, matriz: matriz({ status: "aguardando_ref" }), refPrevia: "NOVA" }).pode).toBe(true);
    expect(podeRegerar({ ...base, refPrevia: "  " })).toEqual({ pode: false, motivo: "Preencha a REF para regerar." });
    expect(podeRegerar({ ...base, jaPedido: true }).pode).toBe(false);
  });
  it("seloCodigos: com prévia vence tudo ('prévia a gravar'); sem prévia = como antes", () => {
    expect(seloCodigos(matriz({ linhas: [linha()] }), true)).toEqual({ tone: "warn", texto: "prévia a gravar" });
    expect(seloCodigos(undefined, true)).toEqual({ tone: "warn", texto: "prévia a gravar" });
    expect(seloCodigos(matriz({ linhas: [linha()] }))).toEqual(seloCodigos(matriz({ linhas: [linha()] }), false));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
ps -Ao pid,command | grep -E "[v]itest|[p]laywright"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run tests/unit/sku-previa.test.ts
```
Expected: FAIL — `Failed to resolve import ".../codigos/sku-previa"`.

- [ ] **Step 3: Implementar `sku-previa.ts`**

```ts
// SKU em PRÉVIA (spec docs/superpowers/specs/2026-09-25-sku-previa-regerar-design.md §4.2 — P-46 do dono): regras PURAS do
// "a gravar" da seção "4. Códigos". O Regerar e o SKU digitado à mão NÃO gravam na hora: ficam aqui (rascunho FORA do
// Draft — R5), a prévia vem do SERVIDOR (RPC skus_previa — o MESMO plano da gravação, só leitura) e só o Salvar do card
// grava (RPC aplicar_skus_modelo, com a assinatura da prévia vista). Voltar/Descartar = o rascunho some e os SKUs gravados
// ficam. Nada de espelho TS da geração: aqui só a entrada, a leitura tolerante da prévia e os textos. Sem I/O.
import { normalizarSkuManual } from "@/lib/sku-montar";
import { mensagemErro } from "@/lib/erro-mensagem";
import { lerMatriz, situacaoSku, type LinhaSku, type MatrizSkus, type SituacaoSku } from "./sku-card";

export type ManualAGravar = { varianteKey: string; tamanhoKey: string; sku: string; id: string | null; rev: number | null };
export type SkusAGravar = { regerar: boolean; manuais: Record<string, ManualAGravar> };
export const SKUS_A_GRAVAR_VAZIO: SkusAGravar = { regerar: false, manuais: {} };
export type ModoPrevia = "manuais" | "regerar";

export const TEXTO_PREVIA =
  "Prévia — nada foi gravado ainda. Os SKUs só mudam quando você clicar em Salvar; Voltar ou Descartar mantém os atuais.";
export const TEXTO_BOM_SUJO =
  "A grade ou os tecidos têm alterações não salvas: a prévia usa a grade salva e é conferida de novo no Salvar.";
export const MSG_PREVIA_CALCULANDO =
  "A prévia dos SKUs ainda estava sendo calculada — o card foi salvo, os SKUs não. Confira a prévia e clique em Salvar de novo.";
export const MSG_PREVIA_DESATUALIZADA =
  "Os SKUs mudaram desde a prévia (outra pessoa gerou ou editou, ou mudou sigla, Formato ou grade). A prévia foi atualizada — confira e clique em Salvar de novo. O card já foi salvo.";
export const PREFIXO_SKUS_NAO_GRAVADOS = "O card foi salvo, mas os SKUs não foram gravados: ";
export const TITULO_REGERAR = "Mostra como ficam os SKUs — só o Salvar grava.";

export const chaveLinhaSku = (varianteKey: string, tamanhoKey: string): string => `${varianteKey}|${tamanhoKey}`;
export const nadaAGravar = (s: SkusAGravar): boolean => !s.regerar && Object.keys(s.manuais).length === 0;
export const modoPrevia = (s: SkusAGravar): ModoPrevia => (s.regerar ? "regerar" : "manuais");

export function comRegerar(s: SkusAGravar): SkusAGravar {
  return s.regerar ? s : { ...s, regerar: true };
}
export function semManual(s: SkusAGravar, chave: string): SkusAGravar {
  if (!(chave in s.manuais)) return s;
  const manuais = { ...s.manuais };
  delete manuais[chave];
  return { ...s, manuais };
}
/** "manter o meu": o SKU digitado passa a valer contra a versão NOVA da linha (id/rev de agora — outra pessoa mudou). */
export function manterMeu(s: SkusAGravar, l: Pick<LinhaSku, "variante_key" | "tamanho_key" | "id" | "rev">): SkusAGravar {
  const chave = chaveLinhaSku(l.variante_key, l.tamanho_key);
  const m = s.manuais[chave];
  if (!m) return s;
  return { ...s, manuais: { ...s.manuais, [chave]: { ...m, id: l.id, rev: l.rev } } };
}

export type AcaoPrevia = "novo" | "muda" | "sai" | "manual_novo" | "conflito" | "erro";
export type PreviaLinha = { acao: AcaoPrevia; sku_de: string | null; sku_para: string | null; mensagem: string | null; code: string | null };
export type LinhaPrevia = LinhaSku & { previa: PreviaLinha | null };

/** O SKU que a linha MOSTRA agora: o digitado ("a gravar") > o que o Salvar grava (novo/muda) > o gravado. */
export function skuExibido(l: LinhaSku | LinhaPrevia, s: SkusAGravar): string {
  const m = s.manuais[chaveLinhaSku(l.variante_key, l.tamanho_key)];
  if (m) return m.sku;
  const p = "previa" in l ? l.previa : null;
  if (p && (p.acao === "novo" || p.acao === "muda")) return p.sku_para ?? "";
  return l.sku ?? "";
}

export type Digitado = { aGravar: SkusAGravar; erro: string | null; valor: string };
/** SKU digitado (blur/Enter). Inválido ⇒ erro PT (as MESMAS regras/mensagens de _sku_norm_manual — espelho da F3.5a) e nada
 *  muda; igual ao que a linha MOSTRA ⇒ nada; senão entra "a gravar" (editado à mão no Salvar) com o id/rev da linha. */
export function digitarSku(s: SkusAGravar, l: LinhaSku | LinhaPrevia, texto: string): Digitado {
  const exibido = skuExibido(l, s);
  if (texto.trim() === "" && exibido === "") return { aGravar: s, erro: null, valor: "" };
  const n = normalizarSkuManual(texto);
  if (!n.ok) return { aGravar: s, erro: n.erro, valor: exibido };
  if (n.valor === exibido) return { aGravar: s, erro: null, valor: exibido };
  const chave = chaveLinhaSku(l.variante_key, l.tamanho_key);
  const novo: ManualAGravar = { varianteKey: l.variante_key, tamanhoKey: l.tamanho_key, sku: n.valor, id: l.id, rev: l.rev };
  return { aGravar: { ...s, manuais: { ...s.manuais, [chave]: novo } }, erro: null, valor: n.valor };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export type ManualRpc = { variante_key: string; tamanho_key: string; sku: string; rev: number | null };
/** `_manuais` das RPCs, ordenado pela chave: a entrada da prévia e a da gravação são a MESMA. */
export function manuaisParaRpc(s: SkusAGravar): ManualRpc[] {
  return Object.values(s.manuais)
    .map((m) => ({ variante_key: m.varianteKey, tamanho_key: m.tamanhoKey, sku: m.sku, rev: m.rev }))
    .sort((a, b) => cmp(chaveLinhaSku(a.variante_key, a.tamanho_key), chaveLinhaSku(b.variante_key, b.tamanho_key)));
}

export type EntradaPrevia = { ref: string; tamanhoTipo: "letra" | "numero"; aGravar: SkusAGravar };
/** Chave estável da entrada da prévia: é a queryKey e responde "a prévia na tela é a da entrada de agora?". */
export function chaveEntradaPrevia(e: EntradaPrevia): string {
  return JSON.stringify([e.ref.trim(), e.tamanhoTipo, modoPrevia(e.aGravar), manuaisParaRpc(e.aGravar)]);
}
export function entradaDaChave(chave: string): { ref: string; tamanhoTipo: "letra" | "numero"; modo: ModoPrevia; manuais: ManualRpc[] } {
  const [ref, tamanhoTipo, modo, manuais] = JSON.parse(chave) as [string, "letra" | "numero", ModoPrevia, ManualRpc[]];
  return { ref, tamanhoTipo, modo, manuais };
}
/** A REF da prévia = a que o Salvar vai gravar: a do rascunho quando ela entra no payload (refEditavel —
 *  aplicarRegrasCamposDev), senão a salva. Aparada (o payload apara). */
export function refParaPrevia(o: { refVaiNoSalvar: boolean; refRascunho: string; refSalva: string }): string {
  return ((o.refVaiNoSalvar ? o.refRascunho : o.refSalva) ?? "").trim();
}

export type ErroPrevia = { variante_key: string; tamanho_key: string; code: string; mensagem: string };
export type PreviaSkus = {
  matriz: MatrizSkus & { linhas: LinhaPrevia[] };
  assinatura: string | null;
  erros: ErroPrevia[];
  nConflitos: number;
  entrada: string;
  desconhecida: boolean;
};
const ACOES: readonly string[] = ["novo", "muda", "sai", "manual_novo", "conflito", "erro"];
const objeto = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const texto = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Lê o jsonb de skus_previa. FAIL-CLOSED: status desconhecido, ação desconhecida ou assinatura que não é md5 ⇒
 *  `desconhecida` e `assinatura` null (o Salvar NÃO grava os SKUs). */
export function lerPrevia(raw: unknown, entrada: string): PreviaSkus {
  const o = objeto(raw);
  const base = lerMatriz(raw);
  const cruas = Array.isArray(o.linhas) ? o.linhas.map(objeto) : [];
  let desconhecida = base.status === "desconhecido";
  const linhas: LinhaPrevia[] = base.linhas.map((l, i) => {
    const p = cruas[i]?.previa;
    if (p === null || p === undefined) return { ...l, previa: null };
    const po = objeto(p);
    if (!ACOES.includes(String(po.acao))) {
      desconhecida = true;
      return { ...l, previa: { acao: "erro", sku_de: null, sku_para: null, mensagem: "Situação desconhecida — recarregue a página.", code: null } };
    }
    return { ...l, previa: { acao: po.acao as AcaoPrevia, sku_de: texto(po.sku_de), sku_para: texto(po.sku_para), mensagem: texto(po.mensagem), code: texto(po.code) } };
  });
  const ass = texto(o.assinatura);
  if (!ass || !/^[0-9a-f]{32}$/.test(ass)) desconhecida = true;
  const erros = (Array.isArray(o.erros) ? o.erros : []).map(objeto).map((e): ErroPrevia => ({
    variante_key: texto(e.variante_key) ?? "", tamanho_key: texto(e.tamanho_key) ?? "",
    code: texto(e.code) ?? "P0001", mensagem: texto(e.mensagem) ?? "SKU inválido.",
  }));
  return {
    matriz: { ...base, linhas },
    assinatura: desconhecida ? null : ass,
    erros,
    nConflitos: Array.isArray(o.conflitos) ? o.conflitos.length : 0,
    entrada,
    desconhecida,
  };
}

export type SituacaoPrevia = SituacaoSku & { aGravar: boolean; conflitoVersao: boolean };
/** O que a linha diz com a prévia na tela: a ação do plano (vai mudar/não vai) ou, sem ação, o estado de hoje. */
export function situacaoPrevia(l: LinhaPrevia): SituacaoPrevia {
  const x = (s: SituacaoSku, aGravar = false, conflitoVersao = false): SituacaoPrevia => ({ ...s, aGravar, conflitoVersao });
  const p = l.previa;
  if (p) {
    switch (p.acao) {
      case "novo": return x({ tom: "warning", texto: "novo · a gravar", cadastrar: false }, true);
      case "muda": return x({ tom: "warning", texto: `muda de ${p.sku_de ?? "—"} · a gravar`, cadastrar: false }, true);
      case "sai": return x({ tom: "warning", texto: "sai no Salvar", cadastrar: false }, true);
      case "manual_novo": return x({ tom: "warning", texto: "editado à mão · a gravar", cadastrar: false }, true);
      case "conflito": return x({ tom: "danger", texto: `não será gravado — ${p.mensagem ?? "conflito"}`, cadastrar: false });
      case "erro":
        return p.code === "P0409"
          ? x({ tom: "danger", texto: `Outra pessoa mudou este SKU para ${l.sku ?? "—"} — o seu (${p.sku_para ?? "—"}) ainda não foi gravado.`, cadastrar: false }, false, true)
          : x({ tom: "danger", texto: p.mensagem ?? "SKU inválido.", cadastrar: false });
    }
  }
  const s = situacaoSku(l);
  if (l.estado === "ok") return x({ ...s, texto: "igual" });
  if (l.estado === "manual") return x({ ...s, texto: "editado à mão — mantido" });
  if (l.estado === "falta" && l.sku) return x({ ...s, texto: `${s.texto} (mantém ${l.sku})` });
  return x(s);
}

export function resumoAplicacao(raw: unknown): { erro: boolean; texto: string } {
  const o = objeto(raw);
  const n = (k: string) => Number(o[k] ?? 0) || 0;
  const base = `SKUs gravados: ${n("criados")} novo(s), ${n("atualizados")} atualizado(s), ${n("removidos")} removido(s), ${n("manuais")} à mão.`;
  const conflitos = Array.isArray(o.conflitos) ? o.conflitos.map(objeto) : [];
  if (conflitos.length === 0) return { erro: false, texto: base };
  const s = conflitos.length > 1 ? "s" : "";
  return { erro: true, texto: `${base} ${conflitos.length} SKU${s} não gravado${s}: ${texto(conflitos[0].mensagem) ?? "conflito"}` };
}
/** Erro de aplicar_skus_modelo. P0409 (prévia velha/rev velho) = texto do SKU, não o genérico de "registro". */
export function mensagemAplicarSkus(e: unknown): string {
  if (objeto(e).code === "P0409") return MSG_PREVIA_DESATUALIZADA;
  return PREFIXO_SKUS_NAO_GRAVADOS + mensagemErro(e, "erro desconhecido");
}
export function mensagemErroPrevia(e: ErroPrevia): string {
  return e.code === "P0409"
    ? `${PREFIXO_SKUS_NAO_GRAVADOS}outra pessoa mudou um SKU que você digitou — escolha “manter o meu” ou “usar o novo” na linha.`
    : PREFIXO_SKUS_NAO_GRAVADOS + e.mensagem;
}
/** Regerar em prévia: liberado com REF/"Tamanho em" digitados e não salvos (P-46); só a REF da prévia vazia trava. */
export function podeRegerar(o: { podeEditar: boolean; matriz: MatrizSkus | undefined; refPrevia: string; jaPedido: boolean }): { pode: boolean; motivo: string } {
  if (!o.podeEditar) return { pode: false, motivo: "Sem permissão para editar os SKUs." };
  if (!o.matriz) return { pode: false, motivo: "Carregando os SKUs…" };
  if (o.matriz.status === "desconhecido") return { pode: false, motivo: "Não foi possível ler a situação dos SKUs — recarregue a página." };
  if (o.matriz.status === "sem_formato") return { pode: false, motivo: "A loja ainda não tem o Formato do SKU." };
  if (o.refPrevia.trim() === "") return { pode: false, motivo: "Preencha a REF para regerar." };
  if (o.jaPedido) return { pode: false, motivo: "A prévia do Regerar já está na tela — Salvar grava; Desfazer prévia volta." };
  return { pode: true, motivo: TITULO_REGERAR };
}
```

- [ ] **Step 4: `seloCodigos` com prévia — `sku-card.ts:195-198`**

Trocar

```ts
/** Selo da seção Códigos (spec §5.3): "N SKU(s) sem sigla" âmbar vence; seção sem linha nenhuma = sem selo (`seloDeSecao` —
 *  a seção não tem requisito de kanban). */
export function seloCodigos(m: MatrizSkus | null | undefined): SeloSecao | undefined {
  if (!m) return undefined;
```
por

```ts
/** Selo da seção Códigos (spec §5.3): "N SKU(s) sem sigla" âmbar vence; seção sem linha nenhuma = sem selo (`seloDeSecao` —
 *  a seção não tem requisito de kanban). SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.2.8): algo "a gravar" vence
 *  tudo — o card ainda não gravou os SKUs. */
export function seloCodigos(m: MatrizSkus | null | undefined, temPrevia = false): SeloSecao | undefined {
  if (temPrevia) return { tone: "warn", texto: "prévia a gravar" };
  if (!m) return undefined;
```

- [ ] **Step 5: Rodar e ver passar**

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run tests/unit/sku-previa.test.ts tests/unit/planejamento-codigos.test.ts
```
Expected: PASS nos dois (o `planejamento-codigos` segue verde: `seloCodigos(m)` sem o 2º argumento é o de antes).

- [ ] **Step 6: Gates e commit**

```bash
bash .superpowers/sku-previa/gates.sh
git add -- src/components/planejamento/planejamento-detail/codigos/sku-previa.ts src/components/planejamento/planejamento-detail/codigos/sku-card.ts tests/unit/sku-previa.test.ts
git commit --only -m "feat(sku-previa): regras puras do 'a gravar' (Regerar e SKU à mão em prévia) + selo (T1)

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- src/components/planejamento/planejamento-detail/codigos/sku-previa.ts src/components/planejamento/planejamento-detail/codigos/sku-card.ts tests/unit/sku-previa.test.ts
git show --stat HEAD
```
Expected: `GATES PREVIA: ok`; 3 arquivos no commit.

---

## Task 2: Migration GERADA do texto vivo + testes estáticos

**Files:**
- Create (não versionados): `.superpowers/sku-previa/mig/dump_antes.sh`, `.superpowers/sku-previa/mig/gerar_sql.py`
- Create (GERADOS — nunca à mão): `supabase/migrations/20261005110000_sku_previa_regerar.sql`,
  `supabase/rollback/20261005110000_sku_previa_regerar_down.sql`
- Create: `tests/integration/sku-previa.test.ts` (só o bloco estático; a Task 3 acrescenta os de banco)

**Interfaces:**
- Consumes: texto VIVO (cópia) de `_skus_modelo_calc(uuid)`, `_skus_modelo_core(uuid)`, `_gerar_skus_modelo_core(uuid,boolean)`.
- Produces (contrato do banco — spec §4.1):
  - `_skus_assinatura(_linhas jsonb) → text` (IMMUTABLE)
  - `_skus_calc_ref_tipo(_modelo_id uuid, _ref text, _tipo text) → TABLE(igual a _skus_modelo_calc)` (STABLE)
  - `_skus_matriz_ref_tipo(_modelo_id uuid, _ref text, _tipo text) → jsonb` (STABLE)
  - `_skus_plano(_modelo_id uuid, _ref text, _tipo text, _manuais jsonb, _modo text) → jsonb` (STABLE) — `{status, modo,
    ops[], linhas{"vkey|tkey": {acao, sku_de, sku_para, mensagem, code}}, erros[], conflitos[], final[], assinatura,
    criados, atualizados, removidos, manuais}`
  - `_skus_executar_plano(_modelo_id uuid, _tenant uuid, _plano jsonb, _estrito boolean) → jsonb` (VOLATILE)
  - `_skus_previa_core(_modelo_id uuid, _ref text, _tipo text, _manuais jsonb, _modo text) → jsonb` (STABLE)
  - `_aplicar_skus_modelo_core(_modelo_id uuid, _manuais jsonb, _modo text, _assinatura text) → jsonb` (VOLATILE)
  - RPC `skus_previa(_modelo_id uuid, _ref text, _tamanho_tipo text, _manuais jsonb, _modo text) → jsonb` (STABLE,
    authenticated) — matriz de `skus_modelo` + por linha `previa` + `{modo, assinatura, erros, conflitos, criados,
    atualizados, removidos, manuais}`
  - RPC `aplicar_skus_modelo(_modelo_id uuid, _manuais jsonb, _modo text, _assinatura text) → jsonb` (authenticated) —
    matriz + `{criados, atualizados, removidos, manuais, conflitos}`; P0409 se a prévia mudou
  - `_skus_modelo_calc(uuid)`, `_skus_modelo_core(uuid)`, `_gerar_skus_modelo_core(uuid,boolean)`: MESMA assinatura e
    MESMO resultado (delegadoras/plano)
  - `_manuais` = `[{variante_key: uuid-texto, tamanho_key: text, sku: text, rev: int|null}]`; `_modo` ∈
    `manuais|regerar|criar`

- [ ] **Step 1: `dump_antes.sh` (SÓ LEITURA da cópia) e rodar**

```bash
#!/usr/bin/env bash
# Task 2 Step 1 — lê (SÓ LEITURA) o texto VIVO das 3 funções do SKU que esta frente redefine, na CÓPIA LOCAL (nunca produção),
# e os md5. O gerador (gerar_sql.py) monta a migration e o inverso A PARTIR DESTES TEXTOS (o plano não crava md5).
set -euo pipefail
TOP="$(git rev-parse --show-toplevel)"
case "$TOP" in */.claude/worktrees/sku-previa) ;; *) echo "PARE: rode de dentro da worktree sku-previa"; exit 1;; esac
cd "$TOP"
LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
M=.superpowers/sku-previa/mig
mkdir -p "$M/antes"
echo "== dump SÓ LEITURA · alvo: 127.0.0.1:54422 (cópia local) · HEAD $(git rev-parse --short HEAD)"
q() { PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -v ON_ERROR_STOP=1 -c "$1"; }
[ "$(q "select to_regprocedure('public._titulo_pagina_calculado(text,text)') is not null and to_regclass('public.modelo_skus') is not null")" = t ] \
  || { echo "PARE: a cópia não tem a F3.5a + a reorganização do Sheet (20261005100000)"; exit 1; }
NOVAS="'public._skus_assinatura(jsonb)','public._skus_calc_ref_tipo(uuid,text,text)','public._skus_matriz_ref_tipo(uuid,text,text)','public._skus_plano(uuid,text,text,jsonb,text)','public._skus_executar_plano(uuid,uuid,jsonb,boolean)','public._skus_previa_core(uuid,text,text,jsonb,text)','public._aplicar_skus_modelo_core(uuid,jsonb,text,text)','public.skus_previa(uuid,text,text,jsonb,text)','public.aplicar_skus_modelo(uuid,jsonb,text,text)'"
[ "$(q "select count(*) from unnest(array[$NOVAS]) f(x) where to_regprocedure(f.x) is not null")" = 0 ] \
  || { echo "PARE: funções desta frente JÁ existem na cópia — alguém aplicou?"; exit 1; }
MS=""
for par in skus_modelo_calc:'public._skus_modelo_calc(uuid)' skus_modelo_core:'public._skus_modelo_core(uuid)' \
           gerar_skus_modelo_core:'public._gerar_skus_modelo_core(uuid,boolean)'; do
  a="${par%%:*}"; f="${par#*:}"
  PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -v ON_ERROR_STOP=1 \
    -c "select pg_get_functiondef('$f'::regprocedure)" -o "$M/antes/$a.sql"
  MS="${MS:+$MS|}$(q "select md5(pg_get_functiondef('$f'::regprocedure))")"
done
echo "$MS" > "$M/md5-redef-antes.txt"
echo "md5 VIVOS das 3 (calc|core|gerar): $MS"
```

```bash
chmod +x .superpowers/sku-previa/mig/dump_antes.sh && bash .superpowers/sku-previa/mig/dump_antes.sh
```
Expected: `md5 VIVOS das 3 (calc|core|gerar): 56c3c48067e07b4cfbcdcf0dccdb5ae6|f77fddb7bbfab7025b5f5f5007ede931|5f523d3dabda04bcda684ddf2cac0459`
(se vier outro, PARE e chame o controlador — outra frente mexeu no SKU).

- [ ] **Step 2: `gerar_sql.py` — cabeçalho, utilidades e as âncoras**

Arquivo `.superpowers/sku-previa/mig/gerar_sql.py`. Os Steps 2–4 são o MESMO arquivo, na ordem.

```python
#!/usr/bin/env python3
"""SKU em PRÉVIA — GERA a migration 20261005110000 e o inverso (plano 2026-09-25-sku-previa-regerar, Task 2).
Entrada (dump SÓ LEITURA da cópia — dump_antes.sh): .superpowers/sku-previa/mig/antes/{skus_modelo_calc,skus_modelo_core,
gerar_skus_modelo_core}.sql + md5-redef-antes.txt. Saída: supabase/migrations/20261005110000_sku_previa_regerar.sql,
supabase/rollback/20261005110000_sku_previa_regerar_down.sql, md5-redef-depois.txt, md5-novas-depois.txt.
NUNCA editar os .sql à mão — mudar AQUI, regerar e rodar a suíte (Task 3)."""
import hashlib
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parents[3]
M = RAIZ / ".superpowers" / "sku-previa" / "mig"
NOME = "20261005110000_sku_previa_regerar"
MIG = RAIZ / "supabase" / "migrations" / f"{NOME}.sql"
INV = RAIZ / "supabase" / "rollback" / f"{NOME}_down.sql"


def md5(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def pare(msg: str) -> None:
    sys.exit(f"PARE: {msg}")


def le_dump(arq: str) -> str:
    raw = (M / "antes" / f"{arq}.sql").read_text(encoding="utf-8")
    return raw[:-1] if raw.endswith("$function$\n\n") else raw  # o psql -A -t põe 1 "\n" depois do valor


def troca(texto: str, trocas: list, nome: str) -> str:
    for velho, novo in trocas:
        if texto.count(velho) != 1:
            pare(f"{nome}: âncora achada {texto.count(velho)}× (esperado 1): {velho.strip()[:80]}")
        texto = texto.replace(velho, novo)
    return texto


def cabecalho(texto: str) -> str:  # "CREATE OR REPLACE FUNCTION …" até "AS $function$\n" inclusive, byte a byte
    i = texto.index("AS $function$\n") + len("AS $function$\n")
    return texto[:i]


def canonico(nome: str, t: str, autoral: bool) -> str:
    if not t.startswith("CREATE OR REPLACE FUNCTION public.") or not t.endswith("\n$function$\n"):
        pare(f"{nome}: fora do formato canônico do pg_get_functiondef")
    if autoral and ("\t" in t or " \n" in t):
        pare(f"{nome}: tab ou espaço no fim de linha num texto escrito aqui")
    return t


# As 3 REDEFINIDAS — ordem FIXA (= md5-redef-*.txt, a guarda, o MD5_REDEF do extra.sh e a suíte). (dump, regproc, ACL)
REDEF = [
    ("skus_modelo_calc", "public._skus_modelo_calc(uuid)", "public._skus_modelo_calc(uuid)"),
    ("skus_modelo_core", "public._skus_modelo_core(uuid)", "public._skus_modelo_core(uuid)"),
    ("gerar_skus_modelo_core", "public._gerar_skus_modelo_core(uuid,boolean)", "public._gerar_skus_modelo_core(uuid, boolean)"),
]
# Âncoras EXATAS (cada uma 1×): o corpo VIVO vira a versão com REF/"Tamanho em" por PARÂMETRO (R2). Iguais em
# tests/integration/sku-previa.test.ts (TROCAS_CALC/TROCAS_CORE).
TROCAS_CALC = [
    ("CREATE OR REPLACE FUNCTION public._skus_modelo_calc(_modelo_id uuid)\n",
     "CREATE OR REPLACE FUNCTION public._skus_calc_ref_tipo(_modelo_id uuid, _ref text, _tipo text)\n"),
    ("           mo.ref AS mref,\n",
     "           _ref AS mref,  -- SKU em prévia: a REF por parâmetro (a do rascunho na prévia; a SALVA, lida sob a trava, na gravação)\n"),
    ("           mo.tamanho_tipo AS mtipo,\n",
     "           _tipo AS mtipo,  -- SKU em prévia: o \"Tamanho em\" por parâmetro (idem)\n"),
]
TROCAS_CORE = [
    ("CREATE OR REPLACE FUNCTION public._skus_modelo_core(_modelo_id uuid)\n",
     "CREATE OR REPLACE FUNCTION public._skus_matriz_ref_tipo(_modelo_id uuid, _ref text, _tipo text)\n"),
    ("  SELECT mo.tenant_id, public._sku_norm_ref(mo.ref), tc.sku_config, mo.tamanho_tipo\n",
     "  SELECT mo.tenant_id, public._sku_norm_ref(_ref), tc.sku_config, _tipo  -- SKU em prévia: REF e \"Tamanho em\" por parâmetro\n"),
    ("    SELECT * FROM public._skus_modelo_calc(_modelo_id)\n",
     "    SELECT * FROM public._skus_calc_ref_tipo(_modelo_id, _ref, _tipo)\n"),
]

md5_vivo = (M / "md5-redef-antes.txt").read_text(encoding="utf-8").strip().split("|")
if len(md5_vivo) != len(REDEF):
    pare("md5-redef-antes.txt tem de ter os 3 md5 (calc|core|gerar) — refazer o dump_antes.sh")
antes = {}
for (arq, _fn, _acl), m_vivo in zip(REDEF, md5_vivo):
    a = le_dump(arq)
    if md5(a) != m_vivo:
        pare(f"{arq}: o dump não reproduz o md5 VIVO ({md5(a)} ≠ {m_vivo}) — refazer o dump_antes.sh")
    antes[arq] = canonico(arq, a, autoral=False)

CALC_REF_TIPO = canonico("_skus_calc_ref_tipo", troca(antes["skus_modelo_calc"], TROCAS_CALC, "calc"), autoral=False)
MATRIZ_REF_TIPO = canonico("_skus_matriz_ref_tipo", troca(antes["skus_modelo_core"], TROCAS_CORE, "core"), autoral=False)
if "mo.tamanho_tipo" in CALC_REF_TIPO or "mo.ref AS" in CALC_REF_TIPO:
    pare("calc: ainda lê a REF/o 'Tamanho em' do card depois das trocas")
if "_skus_modelo_calc(" in MATRIZ_REF_TIPO or "public._sku_norm_ref(mo.ref), tc.sku_config" in MATRIZ_REF_TIPO:
    pare("core: ainda lê a REF do card ou chama o cálculo de 1 argumento depois das trocas")
```

- [ ] **Step 3: `gerar_sql.py` — os textos das funções (continuação do MESMO arquivo)**

Formato canônico do `pg_get_functiondef`: cabeçalho com 1 espaço na frente dos atributos, corpo verbatim, fim em
`"$function$\n"`. O `$pos$` da migration confere que o PG devolve EXATAMENTE isto: diferença de espaço/linha ⇒ a
migration se desfaz na suíte (Task 3) ⇒ ajustar AQUI e registrar em `desvios.md`.

```python
ASSINATURA = r"""CREATE OR REPLACE FUNCTION public._skus_assinatura(_linhas jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.1.1): assinatura do estado FINAL dos SKUs de um card —
  -- [[variante_key, tamanho_key, sku, manual], ...] em ordem canônica (COLLATE "C": independe do locale do banco). A MESMA
  -- função assina a prévia (_skus_plano) e confere o que foi gravado (_aplicar_skus_modelo_core).
  SELECT md5(coalesce((SELECT jsonb_agg(x.value ORDER BY (x.value ->> 0) COLLATE "C", (x.value ->> 1) COLLATE "C")
                         FROM jsonb_array_elements(coalesce(_linhas, '[]'::jsonb)) AS x(value)), '[]'::jsonb)::text)
$function$
"""

PLANO = r"""CREATE OR REPLACE FUNCTION public._skus_plano(_modelo_id uuid, _ref text, _tipo text, _manuais jsonb, _modo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.1.2) — o PLANO da gravação dos SKUs de UM card. PURO (STABLE: o
-- PL/pgSQL recusa INSERT/UPDATE/DELETE aqui). Fonte ÚNICA da decisão: a prévia (skus_previa) roda este plano com a REF e o
-- "Tamanho em" do RASCUNHO; a gravação (aplicar_skus_modelo e gerar_skus_modelo) roda o MESMO plano com os valores
-- SALVOS, lidos sob a trava do card, e executa as ops (_skus_executar_plano). Reproduz o laço da F3.5a/F3.6:
--  1. SKUs à mão (_manuais) primeiro, na ordem das chaves, com as regras/mensagens de _salvar_sku_manual_core;
--  2. 'regerar': as automáticas fora da grade saem ANTES (manual nunca);
--  3. 'criar'/'regerar' (só com Formato, REF e "Tamanho em"): cada linha da grade na ordem (variante, tamanho) — manual
--     nunca muda; sem SKU (falta/vazio) fica; 'criar' só cria o que falta; 'regerar' recalcula as automáticas; SKU de
--     OUTRA linha deste card (estado EM EVOLUÇÃO) ou de outro card que não é réplica (REF viva igual + mesma cor/tamanho —
--     D5) = conflito, com as mensagens da F3.5a.
-- chave = variante_key || '|' || tamanho_key.
DECLARE
  v_tenant uuid;
  v_refn text;
  v_cfg jsonb;
  v_meu_nome text;
  v_meu_ref text;
  v_gera boolean;
  v_estado jsonb := '{}'::jsonb;
  v_calc jsonb := '{}'::jsonb;
  v_ops jsonb := '[]'::jsonb;
  v_linhas jsonb := '{}'::jsonb;
  v_erros jsonb := '[]'::jsonb;
  v_conflitos jsonb := '[]'::jsonb;
  v_final jsonb;
  r record;
  v_e jsonb;
  v_k text;
  v_vkey text;
  v_tkey text;
  v_atual jsonb;
  v_sku text;
  v_dono text;
  v_msg text;
  v_code text;
  v_com_modelo uuid;
  v_com_nome text;
  v_com_ref text;
  n_criados integer := 0;
  n_atualizados integer := 0;
  n_removidos integer := 0;
  n_manuais integer := 0;
BEGIN
  IF _modo IS NULL OR _modo NOT IN ('manuais', 'criar', 'regerar') THEN
    RAISE EXCEPTION 'Modo da prévia dos SKUs inválido.' USING ERRCODE = 'P0001';
  END IF;
  IF _manuais IS NULL OR jsonb_typeof(_manuais) <> 'array' THEN
    RAISE EXCEPTION 'SKUs à mão inválidos.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_manuais) AS x(value)
              WHERE jsonb_typeof(x.value) <> 'object'
                 OR jsonb_typeof(x.value -> 'variante_key') IS DISTINCT FROM 'string'
                 OR lower(x.value ->> 'variante_key') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 OR jsonb_typeof(x.value -> 'tamanho_key') IS DISTINCT FROM 'string'
                 OR jsonb_typeof(x.value -> 'sku') IS DISTINCT FROM 'string'
                 OR coalesce(jsonb_typeof(x.value -> 'rev'), 'null') NOT IN ('number', 'null'))
     OR (SELECT count(*) FROM jsonb_array_elements(_manuais)) <>
        (SELECT count(DISTINCT lower(x.value ->> 'variante_key') || '|' || (x.value ->> 'tamanho_key'))
           FROM jsonb_array_elements(_manuais) AS x(value)) THEN
    RAISE EXCEPTION 'SKUs à mão inválidos.' USING ERRCODE = 'P0001';
  END IF;
  SELECT mo.tenant_id, public._sku_norm_ref(_ref), tc.sku_config, mo.nome, mo.ref
    INTO v_tenant, v_refn, v_cfg, v_meu_nome, v_meu_ref
    FROM public.modelos mo
    LEFT JOIN public.tenant_config tc ON tc.tenant_id = mo.tenant_id
   WHERE mo.id = _modelo_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  v_gera := _modo <> 'manuais' AND v_cfg IS NOT NULL AND coalesce(v_refn, '') <> '' AND _tipo IS NOT NULL;

  -- estado inicial = o GRAVADO; e o cálculo da grade com a REF/"Tamanho em" DADOS
  FOR r IN SELECT s.id, s.variante_key, s.tamanho_key, s.sku, s.manual, s.rev
             FROM public.modelo_skus s
            WHERE s.modelo_id = _modelo_id LOOP
    v_estado := v_estado || jsonb_build_object(r.variante_key::text || '|' || r.tamanho_key, jsonb_build_object(
                  'id', r.id, 'vkey', r.variante_key::text, 'tkey', r.tamanho_key, 'sku', r.sku, 'manual', r.manual, 'rev', r.rev));
  END LOOP;
  FOR r IN SELECT c.variante_key, c.tamanho_key, c.sku
             FROM public._skus_calc_ref_tipo(_modelo_id, _ref, _tipo) AS c LOOP
    v_calc := v_calc || jsonb_build_object(r.variante_key::text || '|' || r.tamanho_key, to_jsonb(r.sku));
  END LOOP;

  -- 1. SKUs à mão (do rascunho), na ordem das chaves
  FOR v_e IN SELECT x.value FROM jsonb_array_elements(_manuais) AS x(value)
              ORDER BY lower(x.value ->> 'variante_key') COLLATE "C", (x.value ->> 'tamanho_key') COLLATE "C" LOOP
    v_vkey := lower(v_e ->> 'variante_key');
    v_tkey := v_e ->> 'tamanho_key';
    v_k := v_vkey || '|' || v_tkey;
    v_atual := v_estado -> v_k;
    v_msg := NULL;
    v_code := 'P0001';
    v_sku := NULL;
    BEGIN
      v_sku := public._sku_norm_manual(v_e ->> 'sku');
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      v_msg := SQLERRM;
    END;
    IF v_msg IS NULL AND v_atual IS NULL AND NOT (v_calc ? v_k) THEN
      v_msg := 'Esta variante/tamanho não está na grade do produto.';
    END IF;
    IF v_msg IS NULL AND v_atual IS NOT NULL AND jsonb_typeof(v_e -> 'rev') = 'number'
       AND (v_atual ->> 'rev')::integer IS DISTINCT FROM (v_e ->> 'rev')::integer THEN
      v_msg := 'conflito_versao: o SKU foi alterado por outra pessoa';
      v_code := 'P0409';
    END IF;
    IF v_msg IS NULL AND v_atual IS NOT NULL AND (v_atual ->> 'manual')::boolean AND v_atual ->> 'sku' = v_sku THEN
      CONTINUE;  -- já é este SKU, à mão: nada muda
    END IF;
    IF v_msg IS NULL THEN
      v_dono := NULL;
      SELECT x.key INTO v_dono
        FROM jsonb_each(v_estado) AS x(key, value)
       WHERE x.value ->> 'sku' = v_sku AND x.key <> v_k
       ORDER BY x.key COLLATE "C"
       LIMIT 1;
      IF v_dono IS NOT NULL THEN
        v_msg := format('O SKU %s já está em outra linha deste produto.', v_sku);
      END IF;
    END IF;
    IF v_msg IS NULL THEN
      v_com_modelo := NULL;
      SELECT o.modelo_id, mo.nome, mo.ref INTO v_com_modelo, v_com_nome, v_com_ref
        FROM public.modelo_skus o
        JOIN public.modelos mo ON mo.id = o.modelo_id
       WHERE o.tenant_id = v_tenant AND o.sku = v_sku AND o.modelo_id <> _modelo_id
         AND NOT (coalesce(v_refn, '') <> '' AND public._sku_norm_ref(mo.ref) = v_refn
                  AND o.variante_key::text = v_vkey AND o.tamanho_key = v_tkey)
       ORDER BY o.modelo_id
       LIMIT 1;
      IF v_com_modelo IS NOT NULL THEN
        v_msg := format('O SKU %s já existe em %s (REF %s). Escolha outro.', v_sku, coalesce(v_com_nome, 'outro produto'),
                        coalesce(nullif(btrim(v_com_ref), ''), '—'));
      END IF;
    END IF;
    IF v_msg IS NOT NULL THEN
      v_erros := v_erros || jsonb_build_array(jsonb_build_object('variante_key', v_vkey, 'tamanho_key', v_tkey,
                   'code', v_code, 'mensagem', v_msg, 'sku_atual', v_atual -> 'sku', 'rev_atual', v_atual -> 'rev'));
      v_linhas := v_linhas || jsonb_build_object(v_k, jsonb_build_object('acao', 'erro', 'code', v_code, 'mensagem', v_msg,
                   'sku_de', v_atual -> 'sku', 'sku_para', to_jsonb(v_e ->> 'sku')));
      CONTINUE;
    END IF;
    v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'manual', 'id', v_atual -> 'id', 'vkey', v_vkey,
               'tkey', v_tkey, 'sku', v_sku, 'rev_base', v_e -> 'rev'));
    v_linhas := v_linhas || jsonb_build_object(v_k, jsonb_build_object('acao', 'manual_novo', 'sku_de', v_atual -> 'sku',
                 'sku_para', v_sku));
    v_estado := v_estado || jsonb_build_object(v_k, jsonb_build_object('id', v_atual -> 'id', 'vkey', v_vkey, 'tkey', v_tkey,
                 'sku', v_sku, 'manual', true, 'rev', v_atual -> 'rev'));
    n_manuais := n_manuais + 1;
  END LOOP;

  -- 2. 'regerar': as automáticas que saíram da grade saem ANTES de gerar (manual nunca)
  IF v_gera AND _modo = 'regerar' THEN
    FOR v_k, v_atual IN SELECT x.key, x.value FROM jsonb_each(v_estado) AS x(key, value) ORDER BY x.key COLLATE "C" LOOP
      CONTINUE WHEN (v_atual ->> 'manual')::boolean OR v_calc ? v_k;
      v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'remover', 'id', v_atual -> 'id', 'vkey', v_atual -> 'vkey',
                 'tkey', v_atual -> 'tkey', 'sku', v_atual -> 'sku'));
      v_linhas := v_linhas || jsonb_build_object(v_k, jsonb_build_object('acao', 'sai', 'sku_de', v_atual -> 'sku'));
      v_estado := v_estado - v_k;
      n_removidos := n_removidos + 1;
    END LOOP;
  END IF;

  -- 3. 'criar'/'regerar': cada linha da grade, na ordem do laço da F3.5a
  IF v_gera THEN
    FOR r IN SELECT c.variante_key, c.tamanho_key, c.sku
               FROM public._skus_calc_ref_tipo(_modelo_id, _ref, _tipo) AS c
              ORDER BY c.variante_ordem, c.tamanho_ordem, c.tamanho_key, c.variante_key LOOP
      v_k := r.variante_key::text || '|' || r.tamanho_key;
      v_atual := v_estado -> v_k;
      CONTINUE WHEN v_atual IS NOT NULL AND (v_atual ->> 'manual')::boolean;                 -- editado à mão: nunca (Q2)
      CONTINUE WHEN r.sku IS NULL;                                                             -- falta sigla (Q4) / vazio
      CONTINUE WHEN v_atual IS NOT NULL AND (_modo <> 'regerar' OR v_atual ->> 'sku' = r.sku); -- fixo (Q2) ou já igual
      v_msg := NULL;
      v_dono := NULL;
      SELECT x.key INTO v_dono
        FROM jsonb_each(v_estado) AS x(key, value)
       WHERE x.value ->> 'sku' = r.sku AND x.key <> v_k
       ORDER BY x.key COLLATE "C"
       LIMIT 1;
      IF v_dono IS NOT NULL THEN
        v_com_modelo := _modelo_id;
        v_com_nome := v_meu_nome;
        v_com_ref := v_meu_ref;
        v_msg := CASE
          WHEN (v_calc ->> v_dono) IS NOT NULL AND (v_calc ->> v_dono) IS DISTINCT FROM (v_estado -> v_dono ->> 'sku') THEN
            format('SKU %s não gravado: esta linha colide com outra deste produto que também muda de SKU neste Regerar. Ajuste um SKU à mão e rode o Regerar de novo.', r.sku)
          ELSE
            format('SKU %s repetido neste produto: duas linhas dão o mesmo SKU. Mude uma sigla ou edite um deles à mão.', r.sku)
        END;
      ELSE
        v_com_modelo := NULL;
        SELECT o.modelo_id, mo.nome, mo.ref INTO v_com_modelo, v_com_nome, v_com_ref
          FROM public.modelo_skus o
          JOIN public.modelos mo ON mo.id = o.modelo_id
         WHERE o.tenant_id = v_tenant AND o.sku = r.sku AND o.modelo_id <> _modelo_id
           AND NOT (public._sku_norm_ref(mo.ref) = v_refn AND o.variante_key = r.variante_key AND o.tamanho_key = r.tamanho_key)
         ORDER BY o.modelo_id
         LIMIT 1;
        IF v_com_modelo IS NOT NULL THEN
          v_msg := format('SKU %s já existe em %s (REF %s). Edite este SKU à mão ou mude a sigla.', r.sku,
                          coalesce(v_com_nome, 'outro produto'), coalesce(nullif(btrim(v_com_ref), ''), '—'));
        END IF;
      END IF;
      IF v_msg IS NOT NULL THEN
        v_conflitos := v_conflitos || jsonb_build_array(jsonb_build_object(
          'variante_key', r.variante_key, 'tamanho_key', r.tamanho_key, 'sku', r.sku,
          'com_modelo_id', v_com_modelo, 'com_nome', v_com_nome, 'com_ref', v_com_ref, 'mensagem', v_msg));
        v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'conflito', 'vkey', r.variante_key::text,
                   'tkey', r.tamanho_key, 'sku', r.sku, 'mensagem', v_msg));
        v_linhas := v_linhas || jsonb_build_object(v_k, jsonb_build_object('acao', 'conflito', 'sku_de', v_atual -> 'sku',
                     'sku_para', r.sku, 'mensagem', v_msg));
        CONTINUE;
      END IF;
      IF v_atual IS NULL THEN
        v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'inserir', 'vkey', r.variante_key::text,
                   'tkey', r.tamanho_key, 'sku', r.sku));
        v_linhas := v_linhas || jsonb_build_object(v_k, jsonb_build_object('acao', 'novo', 'sku_para', r.sku));
        n_criados := n_criados + 1;
      ELSE
        v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'atualizar', 'id', v_atual -> 'id',
                   'vkey', r.variante_key::text, 'tkey', r.tamanho_key, 'sku', r.sku));
        v_linhas := v_linhas || jsonb_build_object(v_k, jsonb_build_object('acao', 'muda', 'sku_de', v_atual -> 'sku',
                     'sku_para', r.sku));
        n_atualizados := n_atualizados + 1;
      END IF;
      v_estado := v_estado || jsonb_build_object(v_k, jsonb_build_object('id', v_atual -> 'id', 'vkey', r.variante_key::text,
                   'tkey', r.tamanho_key, 'sku', r.sku, 'manual', false, 'rev', v_atual -> 'rev'));
    END LOOP;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_array(x.value ->> 'vkey', x.value ->> 'tkey', x.value ->> 'sku',
                                              (x.value ->> 'manual')::boolean)), '[]'::jsonb)
    INTO v_final
    FROM jsonb_each(v_estado) AS x(key, value);
  RETURN jsonb_build_object(
    'status', CASE WHEN v_cfg IS NULL THEN 'sem_formato' WHEN coalesce(v_refn, '') = '' THEN 'aguardando_ref'
                   WHEN _tipo IS NULL THEN 'sem_tamanho' ELSE 'ok' END,
    'modo', _modo, 'ops', v_ops, 'linhas', v_linhas, 'erros', v_erros, 'conflitos', v_conflitos,
    'final', v_final, 'assinatura', public._skus_assinatura(v_final),
    'criados', n_criados, 'atualizados', n_atualizados, 'removidos', n_removidos, 'manuais', n_manuais);
END
$function$
"""
```

```python
EXECUTAR = r"""CREATE OR REPLACE FUNCTION public._skus_executar_plano(_modelo_id uuid, _tenant uuid, _plano jsonb, _estrito boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.1.1) — EXECUTA, na ordem, as ops de um plano de _skus_plano: a
-- ÚNICA escrita em modelo_skus da geração e da prévia gravada. Quem chama segura a trava 'sku_modelo:<id>' e montou o plano
-- DEPOIS dela. SKU que outra transação gravou no meio (unique_violation do gatilho/UNIQUE): _estrito (aplicar a prévia)
-- ⇒ P0409 e nada fica; senão (gerar_skus_modelo) ⇒ vira conflito, como no laço da F3.5a.
DECLARE
  v_op jsonb;
  n_criados integer := 0;
  n_atualizados integer := 0;
  n_removidos integer := 0;
  n_manuais integer := 0;
  v_conflitos jsonb := '[]'::jsonb;
BEGIN
  FOR v_op IN SELECT x.value FROM jsonb_array_elements(coalesce(_plano -> 'ops', '[]'::jsonb)) WITH ORDINALITY AS x(value, n)
               ORDER BY x.n LOOP
    CONTINUE WHEN v_op ->> 'op' NOT IN ('remover', 'manual', 'inserir', 'atualizar');
    BEGIN
      IF v_op ->> 'op' = 'remover' THEN
        DELETE FROM public.modelo_skus s
         WHERE s.id = (v_op ->> 'id')::uuid AND s.modelo_id = _modelo_id AND NOT s.manual;
        IF FOUND THEN
          n_removidos := n_removidos + 1;
        ELSIF _estrito THEN
          RAISE EXCEPTION 'previa_desatualizada: um SKU que sairia já não está gravado' USING ERRCODE = 'P0409';
        END IF;
      ELSIF v_op ->> 'op' = 'manual' THEN
        IF v_op ->> 'id' IS NULL THEN
          INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku, manual, gerado_em)
          VALUES (_tenant, _modelo_id, (v_op ->> 'vkey')::uuid, v_op ->> 'tkey', v_op ->> 'sku', true, now());
        ELSE
          UPDATE public.modelo_skus s
             SET sku = v_op ->> 'sku', manual = true, gerado_em = now(), rev = s.rev + 1
           WHERE s.id = (v_op ->> 'id')::uuid AND s.modelo_id = _modelo_id
             AND (v_op ->> 'rev_base' IS NULL OR s.rev = (v_op ->> 'rev_base')::integer);
          IF NOT FOUND THEN
            RAISE EXCEPTION 'conflito_versao: o SKU foi alterado por outra pessoa' USING ERRCODE = 'P0409';
          END IF;
        END IF;
        n_manuais := n_manuais + 1;
      ELSIF v_op ->> 'op' = 'inserir' THEN
        INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku, manual, gerado_em)
        VALUES (_tenant, _modelo_id, (v_op ->> 'vkey')::uuid, v_op ->> 'tkey', v_op ->> 'sku', false, now());
        n_criados := n_criados + 1;
      ELSE
        UPDATE public.modelo_skus s
           SET sku = v_op ->> 'sku', gerado_em = now(), rev = s.rev + 1
         WHERE s.id = (v_op ->> 'id')::uuid AND s.modelo_id = _modelo_id AND NOT s.manual;
        IF FOUND THEN
          n_atualizados := n_atualizados + 1;
        ELSIF _estrito THEN
          RAISE EXCEPTION 'previa_desatualizada: um SKU que mudaria já não está como na prévia' USING ERRCODE = 'P0409';
        END IF;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      IF _estrito THEN
        RAISE EXCEPTION 'previa_desatualizada: o SKU % foi gravado em outra linha depois da prévia', v_op ->> 'sku'
          USING ERRCODE = 'P0409';
      END IF;
      v_conflitos := v_conflitos || jsonb_build_array(jsonb_build_object(
        'variante_key', v_op -> 'vkey', 'tamanho_key', v_op -> 'tkey', 'sku', v_op -> 'sku',
        'com_modelo_id', NULL::text, 'com_nome', NULL::text, 'com_ref', NULL::text,
        'mensagem', format('SKU %s não gravado: outra pessoa gravou esta linha agora. Gere de novo.', v_op ->> 'sku')));
    END;
  END LOOP;
  RETURN jsonb_build_object('criados', n_criados, 'atualizados', n_atualizados, 'removidos', n_removidos,
                            'manuais', n_manuais, 'conflitos', v_conflitos);
END
$function$
"""

PREVIA_CORE = r"""CREATE OR REPLACE FUNCTION public._skus_previa_core(_modelo_id uuid, _ref text, _tipo text, _manuais jsonb, _modo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.1.3) — o que o Salvar vai gravar, SEM gravar: a matriz de SKUs do
-- card calculada com a REF e o "Tamanho em" DADOS + por linha "previa" (o plano de _skus_plano, o MESMO da gravação:
-- {acao, sku_de, sku_para, mensagem, code}; null = a linha não muda) + a assinatura do estado final.
DECLARE
  v_plano jsonb;
  v_mat jsonb;
  v_linhas jsonb;
BEGIN
  v_plano := public._skus_plano(_modelo_id, _ref, _tipo, _manuais, _modo);
  v_mat := public._skus_matriz_ref_tipo(_modelo_id, _ref, _tipo);
  SELECT coalesce(jsonb_agg(l.value || jsonb_build_object('previa',
           v_plano -> 'linhas' -> ((l.value ->> 'variante_key') || '|' || (l.value ->> 'tamanho_key'))) ORDER BY l.n), '[]'::jsonb)
    INTO v_linhas
    FROM jsonb_array_elements(v_mat -> 'linhas') WITH ORDINALITY AS l(value, n);
  RETURN (v_mat - 'linhas') || jsonb_build_object(
    'linhas', v_linhas, 'modo', v_plano -> 'modo', 'assinatura', v_plano -> 'assinatura', 'erros', v_plano -> 'erros',
    'conflitos', v_plano -> 'conflitos', 'criados', v_plano -> 'criados', 'atualizados', v_plano -> 'atualizados',
    'removidos', v_plano -> 'removidos', 'manuais', v_plano -> 'manuais');
END
$function$
"""

APLICAR_CORE = r"""CREATE OR REPLACE FUNCTION public._aplicar_skus_modelo_core(_modelo_id uuid, _manuais jsonb, _modo text, _assinatura text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.1.4) — GRAVA a prévia que o usuário viu, no Salvar do card (DEPOIS
-- do UPDATE do modelo: a REF e o "Tamanho em" já são os do rascunho). Sob a trava 'sku_modelo:<id>' (a mesma de gerar/
-- editar — ordem sku_modelo → linha → sku_unico, sem deadlock), refaz o plano com os valores SALVOS e:
--  • erro num SKU à mão ⇒ RAISE com a MESMA mensagem da prévia (P0001; rev velho = P0409) — nada grava;
--  • assinatura do estado final ≠ a da prévia ⇒ P0409 'previa_desatualizada' — nada grava;
--  • senão executa as ops (estrito) e CONFERE que o gravado = a prévia (mesma assinatura) — senão P0409, tudo desfeito.
DECLARE
  v_tenant uuid;
  v_ref text;
  v_tipo text;
  v_plano jsonb;
  v_exec jsonb;
  v_erro jsonb;
  v_depois text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.modelos mo WHERE mo.id = _modelo_id) THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sku_modelo:' || _modelo_id::text, 0));
  SELECT mo.tenant_id, mo.ref, mo.tamanho_tipo INTO v_tenant, v_ref, v_tipo
    FROM public.modelos mo
   WHERE mo.id = _modelo_id;
  v_plano := public._skus_plano(_modelo_id, v_ref, v_tipo, _manuais, _modo);
  v_erro := v_plano -> 'erros' -> 0;
  IF v_erro IS NOT NULL THEN
    IF v_erro ->> 'code' = 'P0409' THEN
      RAISE EXCEPTION '%', v_erro ->> 'mensagem' USING ERRCODE = 'P0409';
    END IF;
    RAISE EXCEPTION '%', v_erro ->> 'mensagem' USING ERRCODE = 'P0001';
  END IF;
  IF _assinatura IS NULL OR _assinatura IS DISTINCT FROM v_plano ->> 'assinatura' THEN
    RAISE EXCEPTION 'previa_desatualizada: os SKUs mudaram desde a prévia' USING ERRCODE = 'P0409';
  END IF;
  v_exec := public._skus_executar_plano(_modelo_id, v_tenant, v_plano, true);
  SELECT public._skus_assinatura(coalesce(jsonb_agg(jsonb_build_array(s.variante_key::text, s.tamanho_key, s.sku, s.manual)), '[]'::jsonb))
    INTO v_depois
    FROM public.modelo_skus s
   WHERE s.modelo_id = _modelo_id;
  IF v_depois IS DISTINCT FROM v_plano ->> 'assinatura' THEN
    RAISE EXCEPTION 'previa_desatualizada: o gravado não bateu com a prévia — nada foi gravado' USING ERRCODE = 'P0409';
  END IF;
  RETURN public._skus_matriz_ref_tipo(_modelo_id, v_ref, v_tipo)
      || jsonb_build_object('criados', (v_exec ->> 'criados')::integer, 'atualizados', (v_exec ->> 'atualizados')::integer,
                            'removidos', (v_exec ->> 'removidos')::integer, 'manuais', (v_exec ->> 'manuais')::integer,
                            'conflitos', v_plano -> 'conflitos');
END
$function$
"""

SKUS_PREVIA = r"""CREATE OR REPLACE FUNCTION public.skus_previa(_modelo_id uuid, _ref text, _tamanho_tipo text, _manuais jsonb, _modo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- SKU em PRÉVIA — RPC SÓ LEITURA da seção "4. Códigos": o que o Salvar vai gravar nos SKUs deste card com a REF e o
-- "Tamanho em" do RASCUNHO, os SKUs digitados à mão (_manuais: [{variante_key, tamanho_key, sku, rev}]) e o modo
-- ('regerar' = o botão "Regerar SKUs"; 'manuais' = só os digitados; 'criar' = a 1ª geração). STABLE: não grava nada (o
-- PostgREST a roda em transação READ ONLY). Guarda de sempre (_sku_guarda): login, módulo criacao, loja, EDITAR (R8).
DECLARE
  v_tenant uuid;
BEGIN
  SELECT mo.tenant_id INTO v_tenant FROM public.modelos mo WHERE mo.id = _modelo_id;
  PERFORM public._sku_guarda(v_tenant, true);
  IF _tamanho_tipo IS NOT NULL AND _tamanho_tipo NOT IN ('letra', 'numero') THEN
    RAISE EXCEPTION '"Tamanho em" inválido: use letra ou número.' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(coalesce(_ref, '')) > 200 THEN
    RAISE EXCEPTION 'REF longa demais para a prévia dos SKUs.' USING ERRCODE = 'P0001';
  END IF;
  IF _manuais IS NOT NULL AND jsonb_typeof(_manuais) = 'array' AND jsonb_array_length(_manuais) > 1000 THEN
    RAISE EXCEPTION 'SKUs à mão demais numa prévia (máximo 1000).' USING ERRCODE = 'P0001';
  END IF;
  RETURN public._skus_previa_core(_modelo_id, _ref, _tamanho_tipo, coalesce(_manuais, '[]'::jsonb), _modo);
END
$function$
"""

APLICAR = r"""CREATE OR REPLACE FUNCTION public.aplicar_skus_modelo(_modelo_id uuid, _manuais jsonb, _modo text, _assinatura text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- SKU em PRÉVIA — RPC do Salvar do card: grava a prévia vista (Regerar e/ou SKUs à mão) se, com os valores SALVOS, ela
-- continua a mesma (_assinatura de skus_previa); senão P0409 e nada grava. Guarda de sempre (_sku_guarda, EDITAR).
DECLARE
  v_tenant uuid;
BEGIN
  SELECT mo.tenant_id INTO v_tenant FROM public.modelos mo WHERE mo.id = _modelo_id;
  PERFORM public._sku_guarda(v_tenant, true);
  IF _manuais IS NOT NULL AND jsonb_typeof(_manuais) = 'array' AND jsonb_array_length(_manuais) > 1000 THEN
    RAISE EXCEPTION 'SKUs à mão demais num Salvar (máximo 1000).' USING ERRCODE = 'P0001';
  END IF;
  RETURN public._aplicar_skus_modelo_core(_modelo_id, coalesce(_manuais, '[]'::jsonb), _modo, _assinatura);
END
$function$
"""

# As 3 redefinidas: CABEÇALHO do texto vivo (assinatura/RETURNS/volatilidade/DEFINER/search_path byte a byte) + corpo novo.
CORPO_CALC = """-- SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.1.1): o corpo mudou para _skus_calc_ref_tipo (REF e "Tamanho em"
-- por parâmetro). Aqui, com os SALVOS do card — o MESMO resultado de antes (provado na suíte).
BEGIN
  RETURN QUERY
  SELECT c.variante_key, c.variante_ordem, c.cor_nome, c.apelido_nome, c.tamanho_key, c.tamanho_ordem, c.sku, c.faltas, c.avisos
    FROM public.modelos mo
   CROSS JOIN LATERAL public._skus_calc_ref_tipo(mo.id, mo.ref, mo.tamanho_tipo) AS c
   WHERE mo.id = _modelo_id;
END
$function$
"""
CORPO_CORE = """-- SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.1.1): o corpo mudou para _skus_matriz_ref_tipo (REF e "Tamanho em"
-- por parâmetro). Aqui, com os SALVOS do card — o MESMO resultado de antes (provado na suíte); modelo inexistente segue
-- 'Modelo não encontrado.'.
BEGIN
  RETURN public._skus_matriz_ref_tipo(_modelo_id,
           (SELECT mo.ref FROM public.modelos mo WHERE mo.id = _modelo_id),
           (SELECT mo.tamanho_tipo FROM public.modelos mo WHERE mo.id = _modelo_id));
END
$function$
"""
CORPO_GERAR = """-- SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.1.1): a DECISÃO saiu para _skus_plano (puro — o MESMO plano que a
-- prévia mostra) e a escrita para _skus_executar_plano. Mesmo contrato e mesmo resultado da F3.5a/F3.6 (provado cenário a
-- cenário na suíte). REF e "Tamanho em" lidos UMA vez, DEPOIS da trava, e passados ao plano: o cálculo não relê o card no
-- meio (fecha a corrida B-M8 do G-migration de 25/set).
DECLARE
  v_tenant uuid;
  v_ref text;
  v_tipo text;
  v_plano jsonb;
  v_exec jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.modelos mo WHERE mo.id = _modelo_id) THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  -- Uma geração/edição por modelo de cada vez (a MESMA trava de _salvar_sku_manual_core e _aplicar_skus_modelo_core;
  -- ordem única sku_modelo → linha → sku_unico — sem deadlock).
  PERFORM pg_advisory_xact_lock(hashtextextended('sku_modelo:' || _modelo_id::text, 0));
  SELECT mo.tenant_id, mo.ref, mo.tamanho_tipo INTO v_tenant, v_ref, v_tipo
    FROM public.modelos mo
   WHERE mo.id = _modelo_id;
  v_plano := public._skus_plano(_modelo_id, v_ref, v_tipo, '[]'::jsonb, CASE WHEN _regerar THEN 'regerar' ELSE 'criar' END);
  v_exec := public._skus_executar_plano(_modelo_id, v_tenant, v_plano, false);
  RETURN public._skus_matriz_ref_tipo(_modelo_id, v_ref, v_tipo)
      || jsonb_build_object('criados', (v_exec ->> 'criados')::integer, 'atualizados', (v_exec ->> 'atualizados')::integer,
                            'removidos', (v_exec ->> 'removidos')::integer,
                            'conflitos', (v_plano -> 'conflitos') || (v_exec -> 'conflitos'));
END
$function$
"""
DEPOIS = {
    "skus_modelo_calc": canonico("_skus_modelo_calc", cabecalho(antes["skus_modelo_calc"]) + CORPO_CALC, autoral=True),
    "skus_modelo_core": canonico("_skus_modelo_core", cabecalho(antes["skus_modelo_core"]) + CORPO_CORE, autoral=True),
    "gerar_skus_modelo_core": canonico("_gerar_skus_modelo_core", cabecalho(antes["gerar_skus_modelo_core"]) + CORPO_GERAR, autoral=True),
}
# As 9 NOVAS — ordem FIXA (= md5-novas-depois.txt, o MD5_NOVAS do extra.sh, a guarda e a suíte): 7 internas e as 2 RPCs.
# (regproc p/ to_regprocedure, assinatura p/ REVOKE/DROP, texto, é RPC?)
NOVAS = [
    ("public._skus_assinatura(jsonb)", "public._skus_assinatura(jsonb)", canonico("_skus_assinatura", ASSINATURA, True), False),
    ("public._skus_calc_ref_tipo(uuid,text,text)", "public._skus_calc_ref_tipo(uuid, text, text)", CALC_REF_TIPO, False),
    ("public._skus_matriz_ref_tipo(uuid,text,text)", "public._skus_matriz_ref_tipo(uuid, text, text)", MATRIZ_REF_TIPO, False),
    ("public._skus_plano(uuid,text,text,jsonb,text)", "public._skus_plano(uuid, text, text, jsonb, text)", canonico("_skus_plano", PLANO, True), False),
    ("public._skus_executar_plano(uuid,uuid,jsonb,boolean)", "public._skus_executar_plano(uuid, uuid, jsonb, boolean)", canonico("_skus_executar_plano", EXECUTAR, True), False),
    ("public._skus_previa_core(uuid,text,text,jsonb,text)", "public._skus_previa_core(uuid, text, text, jsonb, text)", canonico("_skus_previa_core", PREVIA_CORE, True), False),
    ("public._aplicar_skus_modelo_core(uuid,jsonb,text,text)", "public._aplicar_skus_modelo_core(uuid, jsonb, text, text)", canonico("_aplicar_skus_modelo_core", APLICAR_CORE, True), False),
    ("public.skus_previa(uuid,text,text,jsonb,text)", "public.skus_previa(uuid, text, text, jsonb, text)", canonico("skus_previa", SKUS_PREVIA, True), True),
    ("public.aplicar_skus_modelo(uuid,jsonb,text,text)", "public.aplicar_skus_modelo(uuid, jsonb, text, text)", canonico("aplicar_skus_modelo", APLICAR, True), True),
]
md5_redef_antes = [md5(antes[a]) for a, _, _ in REDEF]
md5_redef_depois = [md5(DEPOIS[a]) for a, _, _ in REDEF]
md5_novas = [md5(t) for _, _, t, _ in NOVAS]
```

- [ ] **Step 4: `gerar_sql.py` — montar a migration e o inverso (fim do MESMO arquivo)**

```python
def nome_de(fn: str) -> str:
    return fn.split("(")[0].replace("public.", "")


def guarda() -> str:  # a MESMA nos 2 arquivos: 3 redefinidas ∈ {vivo 25/set, desta migration}; 9 novas ausentes ou iguais
    out = ["DO $guarda$\nDECLARE\n  v_md5 text;\nBEGIN\n",
           "  IF to_regclass('public.modelo_skus') IS NULL OR to_regprocedure('public._titulo_pagina_calculado(text,text)') IS NULL THEN\n",
           "    RAISE EXCEPTION 'sku_previa: falta a F3.5a (modelo_skus) ou a reorganização do Sheet (20261005100000) neste banco' USING ERRCODE = 'P0001';\n",
           "  END IF;\n"]
    for (arq, fn, _acl), a, d in zip(REDEF, md5_redef_antes, md5_redef_depois):
        out += [f"  IF to_regprocedure('{fn}') IS NULL THEN\n",
                f"    RAISE EXCEPTION 'sku_previa: {nome_de(fn)} não existe neste banco' USING ERRCODE = 'P0001';\n",
                "  END IF;\n",
                f"  v_md5 := md5(pg_get_functiondef(to_regprocedure('{fn}')));\n",
                f"  IF v_md5 NOT IN ('{a}', '{d}') THEN\n",
                f"    RAISE EXCEPTION 'sku_previa: {nome_de(fn)} não está nem no texto vivo de 25/set nem no desta migration (md5 %) — "
                "outra frente mudou; regenerar a migration (plano, Task 2) antes de aplicar', v_md5 USING ERRCODE = 'P0001';\n",
                "  END IF;\n"]
    for (fn, _acl, _t, _rpc), d in zip(NOVAS, md5_novas):
        out += [f"  IF to_regprocedure('{fn}') IS NOT NULL THEN\n",
                f"    v_md5 := md5(pg_get_functiondef(to_regprocedure('{fn}')));\n",
                f"    IF v_md5 <> '{d}' THEN\n",
                f"      RAISE EXCEPTION 'sku_previa: {nome_de(fn)} já existe com outro texto (md5 %) — PARE e avise o controlador', "
                "v_md5 USING ERRCODE = 'P0001';\n",
                "    END IF;\n",
                "  END IF;\n"]
    out.append("END\n$guarda$;\n")
    return "".join(out)


def acl(ida: bool) -> str:  # #9: internas fechadas p/ PUBLIC/anon/authenticated; na ida, RPCs só p/ authenticated
    internas = [fn for _a, fn, _c in REDEF] + ([fn for fn, _c, _t, rpc in NOVAS if not rpc] if ida else [])
    rpcs = [fn for fn, _c, _t, rpc in NOVAS if rpc] if ida else []
    arr = lambda xs: "ARRAY[" + ", ".join(f"'{x}'" for x in xs) + "]"
    cond = [f"EXISTS (SELECT 1 FROM unnest({arr(internas)}) AS f(x) CROSS JOIN (VALUES ('public'), ('anon'), ('authenticated')) AS r(y)\n"
            "              WHERE has_function_privilege(r.y, to_regprocedure(f.x), 'EXECUTE'))"]
    if rpcs:
        cond += [f"EXISTS (SELECT 1 FROM unnest({arr(rpcs)}) AS f(x) CROSS JOIN (VALUES ('public'), ('anon')) AS r(y)\n"
                 "              WHERE has_function_privilege(r.y, to_regprocedure(f.x), 'EXECUTE'))",
                 f"EXISTS (SELECT 1 FROM unnest({arr(rpcs)}) AS f(x)\n"
                 "              WHERE NOT coalesce(has_function_privilege('authenticated', to_regprocedure(f.x), 'EXECUTE'), false))"]
    return ("DO $acl$\nBEGIN\n  IF " + "\n     OR ".join(cond) + " THEN\n"
            "    RAISE EXCEPTION 'sku_previa: ACL fora do padrão — interna executável por PUBLIC/anon/authenticated ou RPC "
            "fora de authenticated (invariante #9)' USING ERRCODE = 'P0001';\n  END IF;\nEND\n$acl$;\n")


def confere(fn: str, esperado: str) -> str:
    return "".join([
        f"  v_md5 := md5(pg_get_functiondef(to_regprocedure('{fn}')));\n",
        f"  IF v_md5 IS DISTINCT FROM '{esperado}' THEN\n",
        f"    RAISE EXCEPTION 'sku_previa: pós-condição falhou — {nome_de(fn)} não ficou com o texto esperado (md5 %); "
        "possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';\n",
        "  END IF;\n"])


def pos(ida: bool) -> str:
    corpo = [confere(fn, d if ida else a) for (_arq, fn, _c), a, d in zip(REDEF, md5_redef_antes, md5_redef_depois)]
    if ida:
        corpo += [confere(fn, d) for (fn, _c, _t, _r), d in zip(NOVAS, md5_novas)]
    else:
        corpo += [f"  IF to_regprocedure('{fn}') IS NOT NULL THEN\n"
                  f"    RAISE EXCEPTION 'sku_previa: pós-condição falhou — {nome_de(fn)} ainda existe — desfazendo tudo' USING ERRCODE = 'P0001';\n"
                  "  END IF;\n" for fn, _c, _t, _r in NOVAS]
    return "DO $pos$\nDECLARE\n  v_md5 text;\nBEGIN\n" + "".join(corpo) + "END\n$pos$;\n"


CAB_MIG = """-- SKU em PRÉVIA (P-46/P-47 A do dono, 25/set) — o "Regerar SKUs" e o SKU à mão da seção "4. Códigos" viram PRÉVIA no
-- rascunho e só gravam no Salvar do card. Spec: docs/superpowers/specs/2026-09-25-sku-previa-regerar-design.md (§4.1).
-- Plano: docs/superpowers/plans/2026-09-25-sku-previa-regerar.md (Task 2). ARQUIVO GERADO por
-- .superpowers/sku-previa/mig/gerar_sql.py a partir do texto VIVO (cópia = produção em 25/set) — NÃO editar à mão.
--  0. guarda: F3.5a + reorganização no banco; md5 EXATO das 3 redefinidas (vivo de 25/set OU o desta migration); as 9
--     novas ausentes OU no texto desta migration (reaplicação);
--  1. 9 funções NOVAS: _skus_assinatura (IMMUTABLE), _skus_calc_ref_tipo/_skus_matriz_ref_tipo (o texto vivo de
--     _skus_modelo_calc/_skus_modelo_core com SÓ as âncoras trocadas: REF e "Tamanho em" por PARÂMETRO), _skus_plano (a
--     DECISÃO, pura — o laço da F3.5a em memória), _skus_executar_plano (a ÚNICA escrita), _skus_previa_core,
--     _aplicar_skus_modelo_core e as RPCs skus_previa (STABLE — só leitura) e aplicar_skus_modelo (grava a prévia vista:
--     assinatura antes E depois);
--  2. 3 REDEFINIDAS (mesma assinatura/retorno/volatilidade; CREATE OR REPLACE preserva o proacl): _skus_modelo_calc e
--     _skus_modelo_core viram delegadoras (com os SALVOS do card — mesmo resultado); _gerar_skus_modelo_core = trava →
--     REF/"Tamanho em" lidos UMA vez → plano → executor (mesmo resultado; fecha a corrida B-M8);
--  3. ACL (#9): internas REVOKE dos TRÊS; RPCs REVOKE PUBLIC/anon + GRANT authenticated; $acl$ confere;
--  4. $pos$: md5 das 12 = o esperado, senão desfaz tudo (ex.: client_encoding).
-- SÓ FUNÇÕES: nenhuma DDL de tabela nem de policy (sem ACCESS EXCLUSIVE em tabela; o hook supautils.policy_grants não
-- dispara). Contagens (funções|gatilhos): +9 | +0. Aplicar SÓ pelo .superpowers/sku-previa/mig/ida-producao.sh (pré-voo +
-- backup) — não psql -f solto. Inverso: supabase/rollback/20261005110000_sku_previa_regerar_down.sql (não apaga dado).
-- LIFO: voltar a reorganização (20261005100000) ou a F3.5a depois desta exige voltar ESTA antes.
"""
CAB_INV = """-- INVERSO da 20261005110000_sku_previa_regerar.sql (SKU em prévia). ARQUIVO GERADO (gerar_sql.py) — NÃO editar à mão.
-- Só com OK do dono e DEPOIS de tirar do ar o front que chama skus_previa/aplicar_skus_modelo. NÃO apaga dado: os SKUs
-- gravados ficam. Ordem: encoding → BEGIN/travas → guarda → as 3 do SKU voltam ao texto vivo de 25/set byte a byte (com o
-- REVOKE reafirmado) → DROP das 9 funções novas → $acl$ → $pos$ (3 = o vivo; 9 ausentes) → NOTIFY → COMMIT. Idempotente.
"""
ENC = "SET client_encoding = 'UTF8';\n"
TRAVAS = "BEGIN;\nSET LOCAL lock_timeout = '500ms';\nSET LOCAL transaction_timeout = '3s';\n"
NOTIFY = "NOTIFY pgrst, 'reload schema';\n"
REVOKE_REDEF = ("REVOKE EXECUTE ON FUNCTION\n  " + ",\n  ".join(a for _x, _f, a in REDEF)
                + "\n  FROM PUBLIC, anon, authenticated;\n")
REVOKE_NOVAS = ("REVOKE EXECUTE ON FUNCTION\n  " + ",\n  ".join(a for _f, a, _t, rpc in NOVAS if not rpc)
                + "\n  FROM PUBLIC, anon, authenticated;\n")
RPCS = ",\n  ".join(a for _f, a, _t, rpc in NOVAS if rpc)
REVOKE_RPC = f"REVOKE EXECUTE ON FUNCTION\n  {RPCS}\n  FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION\n  {RPCS}\n  TO authenticated;\n"

mig = "".join([
    CAB_MIG, ENC, TRAVAS, "\n", guarda(), "\n",
    *[t[:-1] + ";\n\n" for _f, _a, t, _r in NOVAS],
    *[DEPOIS[a][:-1] + ";\n\n" for a, _f, _c in REDEF],
    REVOKE_REDEF, REVOKE_NOVAS, REVOKE_RPC, "\n",
    acl(True), "\n", pos(True), "\n", NOTIFY, "\n", "COMMIT;\n",
])
inv = "".join([
    CAB_INV, ENC, TRAVAS, "\n", guarda(), "\n",
    *[antes[a][:-1] + ";\n\n" for a, _f, _c in REDEF],
    REVOKE_REDEF, "\n",
    *[f"DROP FUNCTION IF EXISTS {a};\n" for _f, a, _t, rpc in NOVAS if rpc],
    *[f"DROP FUNCTION IF EXISTS {a};\n" for _f, a, _t, rpc in NOVAS if not rpc], "\n",
    acl(False), "\n", pos(False), "\n", NOTIFY, "\n", "COMMIT;\n",
])
for nome, txt in (("migration", mig), ("inverso", inv)):
    linhas = txt.split("\n")
    if linhas.count("BEGIN;") != 1 or linhas.count("COMMIT;") != 1:
        pare(f"{nome}: esperado 1 BEGIN; e 1 COMMIT; em linha própria")
    if any(l.strip().upper().startswith(("ALTER TABLE", "CREATE TABLE", "DROP TABLE", "CREATE POLICY", "DROP POLICY",
                                         "ALTER POLICY", "COMMENT ON")) for l in linhas):
        pare(f"{nome}: DDL de tabela/policy/COMMENT — esta frente só troca funções")
MIG.write_text(mig, encoding="utf-8")
INV.write_text(inv, encoding="utf-8")
(M / "md5-redef-depois.txt").write_text("|".join(md5_redef_depois) + "\n", encoding="utf-8")
(M / "md5-novas-depois.txt").write_text("|".join(md5_novas) + "\n", encoding="utf-8")
print(f"OK: {MIG.relative_to(RAIZ)} e {INV.relative_to(RAIZ)} gerados · redefinidas {'|'.join(md5_redef_antes)} → "
      f"{'|'.join(md5_redef_depois)} · novas {'|'.join(md5_novas)}")
```

- [ ] **Step 5: Gerar**

```bash
python3 .superpowers/sku-previa/mig/gerar_sql.py
grep -c '^BEGIN;$' supabase/migrations/20261005110000_sku_previa_regerar.sql supabase/rollback/20261005110000_sku_previa_regerar_down.sql
grep -c "^CREATE OR REPLACE FUNCTION" supabase/migrations/20261005110000_sku_previa_regerar.sql
```
Expected: `OK: … gerados · redefinidas 56c3c480…|f77fddb7…|5f523d3d… → <3 md5> · novas <9 md5>`; `1` BEGIN em cada arquivo;
12 `CREATE OR REPLACE FUNCTION` na migration. `PARE: …` ⇒ ler a mensagem (âncora, md5 do dump ou formato) e corrigir o
gerador — nunca o .sql.

- [ ] **Step 6: Teste estático — `tests/integration/sku-previa.test.ts` (arquivo novo; a Task 3 acrescenta os blocos de banco)**

```ts
/**
 * SKU em PRÉVIA — banco (plano docs/superpowers/plans/2026-09-25-sku-previa-regerar.md, Tasks 2–3). BEGIN…ROLLBACK: nada grava.
 *
 * ⚠️ SÓ NA CÓPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). Em outro banco os blocos de
 * banco PULAM; com SKU_PREVIA_MIG_TXN=1 fora da cópia a suíte RECUSA já na coleta (exigeBancoLocal()).
 * Modos:
 *  • SKU_PREVIA_MIG_TXN=1 — aplica a migration DENTRO da txn de cada teste (tests/integration/mig-txn.ts — NUNCA `\i`);
 *    a cópia precisa de F3.5a + reorganização (20261005100000). A equivalência VELHO × NOVO e o inverso SÓ rodam aqui
 *    (precisam das funções vivas de ANTES) e pulam se a cópia já tiver esta frente.
 *  • sem a variável — exige a migration VIVA na cópia (ensaio da Task 4 / merge da Task 6); sem ela, os blocos de banco pulam.
 * O bloco estático não usa banco: roda sempre.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { hasDb, dbUrl, withTx, comoUsuario, semUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";
import { aplicarSql, exigeBancoLocal } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261005110000_sku_previa_regerar.sql";
const INV = "supabase/rollback/20261005110000_sku_previa_regerar_down.sql";
const LOCAL = ehBancoLocal();
const MIG_TXN = process.env.SKU_PREVIA_MIG_TXN === "1";
if (MIG_TXN && hasDb) exigeBancoLocal(); // recusa na COLETA, antes de qualquer conexão

const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
/** O texto de pg_get_functiondef = o corpo do arquivo + "\n" (o arquivo é GERADO no formato canônico). */
function corpo(rel: string, cria: string): string {
  const t = ler(rel);
  const i = t.indexOf(cria);
  const f = t.indexOf("\n$function$", i);
  if (i < 0 || f < 0) throw new Error(`${rel}: corpo não achado (${cria})`);
  if (t.indexOf(cria, i + 1) >= 0) throw new Error(`${rel}: ${cria} aparece mais de 1×`);
  return t.slice(i, f + "\n$function$".length) + "\n";
}
const REDEF = [
  { fn: "public._skus_modelo_calc(uuid)", cria: "CREATE OR REPLACE FUNCTION public._skus_modelo_calc(" },
  { fn: "public._skus_modelo_core(uuid)", cria: "CREATE OR REPLACE FUNCTION public._skus_modelo_core(" },
  { fn: "public._gerar_skus_modelo_core(uuid,boolean)", cria: "CREATE OR REPLACE FUNCTION public._gerar_skus_modelo_core(" },
];
const NOVAS = [
  { fn: "public._skus_assinatura(jsonb)", cria: "CREATE OR REPLACE FUNCTION public._skus_assinatura(", rpc: false },
  { fn: "public._skus_calc_ref_tipo(uuid,text,text)", cria: "CREATE OR REPLACE FUNCTION public._skus_calc_ref_tipo(", rpc: false },
  { fn: "public._skus_matriz_ref_tipo(uuid,text,text)", cria: "CREATE OR REPLACE FUNCTION public._skus_matriz_ref_tipo(", rpc: false },
  { fn: "public._skus_plano(uuid,text,text,jsonb,text)", cria: "CREATE OR REPLACE FUNCTION public._skus_plano(", rpc: false },
  { fn: "public._skus_executar_plano(uuid,uuid,jsonb,boolean)", cria: "CREATE OR REPLACE FUNCTION public._skus_executar_plano(", rpc: false },
  { fn: "public._skus_previa_core(uuid,text,text,jsonb,text)", cria: "CREATE OR REPLACE FUNCTION public._skus_previa_core(", rpc: false },
  { fn: "public._aplicar_skus_modelo_core(uuid,jsonb,text,text)", cria: "CREATE OR REPLACE FUNCTION public._aplicar_skus_modelo_core(", rpc: false },
  { fn: "public.skus_previa(uuid,text,text,jsonb,text)", cria: "CREATE OR REPLACE FUNCTION public.skus_previa(", rpc: true },
  { fn: "public.aplicar_skus_modelo(uuid,jsonb,text,text)", cria: "CREATE OR REPLACE FUNCTION public.aplicar_skus_modelo(", rpc: true },
];
// = TROCAS_CALC/TROCAS_CORE do gerar_sql.py (R2): o texto vivo com SÓ estas âncoras trocadas.
const TROCAS_CALC: [string, string][] = [
  ["CREATE OR REPLACE FUNCTION public._skus_modelo_calc(_modelo_id uuid)\n",
   "CREATE OR REPLACE FUNCTION public._skus_calc_ref_tipo(_modelo_id uuid, _ref text, _tipo text)\n"],
  ["           mo.ref AS mref,\n",
   "           _ref AS mref,  -- SKU em prévia: a REF por parâmetro (a do rascunho na prévia; a SALVA, lida sob a trava, na gravação)\n"],
  ["           mo.tamanho_tipo AS mtipo,\n",
   "           _tipo AS mtipo,  -- SKU em prévia: o \"Tamanho em\" por parâmetro (idem)\n"],
];
const TROCAS_CORE: [string, string][] = [
  ["CREATE OR REPLACE FUNCTION public._skus_modelo_core(_modelo_id uuid)\n",
   "CREATE OR REPLACE FUNCTION public._skus_matriz_ref_tipo(_modelo_id uuid, _ref text, _tipo text)\n"],
  ["  SELECT mo.tenant_id, public._sku_norm_ref(mo.ref), tc.sku_config, mo.tamanho_tipo\n",
   "  SELECT mo.tenant_id, public._sku_norm_ref(_ref), tc.sku_config, _tipo  -- SKU em prévia: REF e \"Tamanho em\" por parâmetro\n"],
  ["    SELECT * FROM public._skus_modelo_calc(_modelo_id)\n",
   "    SELECT * FROM public._skus_calc_ref_tipo(_modelo_id, _ref, _tipo)\n"],
];
const aplicaTrocas = (t: string, trocas: [string, string][]) =>
  trocas.reduce((s, [a, b]) => { expect(s.split(a).length - 1, a.trim()).toBe(1); return s.split(a).join(b); }, t);
/** Guardas de md5 do $guarda$, NA ORDEM do arquivo: 3 redefinidas [antes, depois] e depois as 9 novas [depois]. */
function guardas(rel: string) {
  const t = ler(rel);
  const redef = [...t.matchAll(/v_md5 NOT IN \('([0-9a-f]{32})', '([0-9a-f]{32})'\)/g)].map((r) => ({ antes: r[1], depois: r[2] }));
  const bloco = t.slice(t.indexOf("DO $guarda$"), t.indexOf("$guarda$;"));
  const novas = [...bloco.matchAll(/IF v_md5 <> '([0-9a-f]{32})' THEN/g)].map((r) => r[1]);
  return { redef, novas };
}
// Comentários PRIMEIRO: o cabeçalho cita "$acl$"/"$pos$" e casaria com o DO de verdade, engolindo o arquivo.
const semCorpos = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "");

describe("SKU em prévia — arquivos da migration (estático, sem banco)", () => {
  it("encoding 1º, 1 BEGIN/1 COMMIT, travas logo depois do BEGIN, NOTIFY antes do COMMIT, SÓ funções (nada de tabela/policy/COMMENT/DML solto)", () => {
    for (const rel of [MIG, INV]) {
      const t = ler(rel);
      const linhas = t.split("\n");
      expect(linhas.find((l) => l.trim() !== "" && !l.startsWith("--")), rel).toBe("SET client_encoding = 'UTF8';");
      expect(linhas.filter((l) => l === "BEGIN;").length, rel).toBe(1);
      expect(linhas.filter((l) => l === "COMMIT;").length, rel).toBe(1);
      const b = linhas.indexOf("BEGIN;");
      expect(linhas.slice(b + 1, b + 3), rel).toEqual(["SET LOCAL lock_timeout = '500ms';", "SET LOCAL transaction_timeout = '3s';"]);
      expect(t.indexOf("NOTIFY pgrst, 'reload schema';"), rel).toBeLessThan(t.indexOf("\nCOMMIT;"));
      expect(t.indexOf("NOTIFY pgrst, 'reload schema';"), rel).toBeGreaterThan(t.indexOf("DO $pos$"));
      const fora = semCorpos(t);
      expect(fora, rel).not.toMatch(/\b(ALTER|CREATE|DROP)\s+(TABLE|POLICY|TRIGGER|INDEX)\b/i);
      expect(fora, rel).not.toMatch(/\bCOMMENT\s+ON\b|\bINSERT\s+INTO\b|\bUPDATE\s+public\.|\bDELETE\s+FROM\b/i);
    }
  });

  it("guarda md5 EXATA: redefinidas antes = texto do inverso, depois = texto da migration; novas = texto da migration", () => {
    for (const rel of [MIG, INV]) {
      const g = guardas(rel);
      expect(g.redef.length, rel).toBe(3);
      expect(g.novas.length, rel).toBe(9);
      REDEF.forEach((f, i) => expect(g.redef[i], `${rel} ${f.fn}`).toEqual({ antes: md5(corpo(INV, f.cria)), depois: md5(corpo(MIG, f.cria)) }));
      NOVAS.forEach((f, i) => expect(g.novas[i], `${rel} ${f.fn}`).toBe(md5(corpo(MIG, f.cria))));
    }
  });

  it("R2 — _skus_calc_ref_tipo/_skus_matriz_ref_tipo = o texto VIVO (o do inverso) com SÓ as âncoras trocadas (cada uma 1×)", () => {
    expect(corpo(MIG, "CREATE OR REPLACE FUNCTION public._skus_calc_ref_tipo("))
      .toBe(aplicaTrocas(corpo(INV, "CREATE OR REPLACE FUNCTION public._skus_modelo_calc("), TROCAS_CALC));
    expect(corpo(MIG, "CREATE OR REPLACE FUNCTION public._skus_matriz_ref_tipo("))
      .toBe(aplicaTrocas(corpo(INV, "CREATE OR REPLACE FUNCTION public._skus_modelo_core("), TROCAS_CORE));
  });

  it("delegadoras e geração: MESMO cabeçalho do vivo; a geração trava ANTES de ler REF/'Tamanho em' e passa os lidos ao plano (B-M8)", () => {
    for (const f of REDEF) {
      const cab = (t: string) => t.slice(0, t.indexOf("AS $function$\n"));
      expect(cab(corpo(MIG, f.cria)), f.fn).toBe(cab(corpo(INV, f.cria)));
    }
    expect(corpo(MIG, REDEF[0].cria)).toContain("CROSS JOIN LATERAL public._skus_calc_ref_tipo(mo.id, mo.ref, mo.tamanho_tipo) AS c");
    expect(corpo(MIG, REDEF[1].cria)).toContain("RETURN public._skus_matriz_ref_tipo(_modelo_id,");
    const g = corpo(MIG, REDEF[2].cria);
    const iTrava = g.indexOf("pg_advisory_xact_lock(hashtextextended('sku_modelo:'");
    const iLe = g.indexOf("SELECT mo.tenant_id, mo.ref, mo.tamanho_tipo INTO v_tenant, v_ref, v_tipo");
    const iPlano = g.indexOf("public._skus_plano(_modelo_id, v_ref, v_tipo, '[]'::jsonb,");
    expect(iTrava).toBeGreaterThan(0);
    expect(iLe).toBeGreaterThan(iTrava);
    expect(iPlano).toBeGreaterThan(iLe);
    expect(g).toContain("public._skus_executar_plano(_modelo_id, v_tenant, v_plano, false)");
    const a = corpo(MIG, "CREATE OR REPLACE FUNCTION public._aplicar_skus_modelo_core(");
    expect(a.indexOf("pg_advisory_xact_lock")).toBeLessThan(a.indexOf("public._skus_plano(_modelo_id, v_ref, v_tipo, _manuais, _modo)"));
    expect(a).toContain("public._skus_executar_plano(_modelo_id, v_tenant, v_plano, true)");
    expect(a.match(/RAISE EXCEPTION 'previa_desatualizada/g)?.length).toBe(2); // antes (assinatura) E depois (pós-conferência)
  });

  it("só leitura por construção: skus_previa/_skus_previa_core/_skus_plano/_ref_tipo STABLE; assinatura IMMUTABLE; sem DML nelas", () => {
    for (const cria of ["public.skus_previa(", "public._skus_previa_core(", "public._skus_plano(", "public._skus_calc_ref_tipo(", "public._skus_matriz_ref_tipo("]) {
      const t = corpo(MIG, `CREATE OR REPLACE FUNCTION ${cria}`);
      expect(t, cria).toMatch(/\n STABLE SECURITY DEFINER\n/);
      expect(t, cria).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM)\b/i);
    }
    expect(corpo(MIG, "CREATE OR REPLACE FUNCTION public._skus_assinatura(")).toMatch(/\n LANGUAGE sql\n IMMUTABLE\n/);
  });

  it("ACL (#9): internas REVOKE dos TRÊS (as 3 redefinidas reafirmadas); RPCs REVOKE PUBLIC/anon + GRANT authenticated; $acl$ e $pos$", () => {
    const m = ler(MIG);
    const revs = [...m.matchAll(/REVOKE EXECUTE ON FUNCTION\n([\s\S]*?)\n  FROM ([^;]+);/g)].map((r) => ({ fns: r[1], de: r[2] }));
    expect(revs.map((r) => r.de)).toEqual(["PUBLIC, anon, authenticated", "PUBLIC, anon, authenticated", "PUBLIC, anon"]);
    for (const n of ["_skus_modelo_calc(uuid)", "_skus_modelo_core(uuid)", "_gerar_skus_modelo_core(uuid, boolean)"]) expect(revs[0].fns).toContain(n);
    for (const n of ["_skus_assinatura(jsonb)", "_skus_plano(uuid, text, text, jsonb, text)", "_skus_executar_plano(uuid, uuid, jsonb, boolean)", "_aplicar_skus_modelo_core(uuid, jsonb, text, text)"])
      expect(revs[1].fns).toContain(n);
    expect(revs[2].fns).toContain("public.skus_previa(uuid, text, text, jsonb, text)");
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION\n  public\.skus_previa\(uuid, text, text, jsonb, text\),\n  public\.aplicar_skus_modelo\(uuid, jsonb, text, text\)\n  TO authenticated;/);
    expect(m.indexOf("DO $acl$")).toBeGreaterThan(m.indexOf("TO authenticated;"));
    expect(m.indexOf("DO $pos$")).toBeGreaterThan(m.indexOf("DO $acl$"));
    expect((m.slice(m.indexOf("DO $pos$")).match(/IS DISTINCT FROM '[0-9a-f]{32}'/g) ?? []).length).toBe(12);
  });

  it("inverso: guarda → as 3 de ANTES → REVOKE → DROP das 9 → $acl$ → $pos$ (9 ausentes) → NOTIFY → COMMIT; nenhum dado mexido", () => {
    const v = ler(INV);
    const i = (s: string) => { const x = v.indexOf(s); expect(x, s).toBeGreaterThan(-1); return x; };
    const iG = i("DO $guarda$");
    const iSku = REDEF.map((f) => i(f.cria));
    const iDrop = i("DROP FUNCTION IF EXISTS public.skus_previa(uuid, text, text, jsonb, text);");
    const iAcl = i("DO $acl$");
    const iPos = i("DO $pos$");
    expect(iSku.every((x) => x > iG && x < iDrop)).toBe(true);
    expect(iAcl).toBeGreaterThan(iDrop);
    expect(iPos).toBeGreaterThan(iAcl);
    for (const f of NOVAS) expect(v).toContain(`DROP FUNCTION IF EXISTS ${f.fn.replace(/,/g, ", ")};`);
    for (const f of NOVAS) expect(v, f.fn).not.toContain(f.cria);
    expect((v.slice(iPos).match(/IS NOT NULL THEN/g) ?? []).length).toBe(9);
  });
});
```

- [ ] **Step 7: Rodar o estático (sem banco, sem DDL)**

```bash
ps -Ao pid,command | grep -E "[v]itest|[p]laywright"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/integration/sku-previa.test.ts
```
Expected: `7 passed`. Falhou ⇒ corrigir o GERADOR (Steps 2–4), regerar (Step 5) e repetir. Nunca editar os .sql à mão.

- [ ] **Step 8: Gates e commit**

```bash
bash .superpowers/sku-previa/gates.sh
git add -- supabase/migrations/20261005110000_sku_previa_regerar.sql supabase/rollback/20261005110000_sku_previa_regerar_down.sql tests/integration/sku-previa.test.ts
git commit --only -m "feat(sku-previa): migration GERADA (plano puro + executor + skus_previa/aplicar_skus_modelo) e estáticos (T2)

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- supabase/migrations/20261005110000_sku_previa_regerar.sql supabase/rollback/20261005110000_sku_previa_regerar_down.sql tests/integration/sku-previa.test.ts
git show --stat HEAD
```
Expected: `GATES PREVIA: ok`; 3 arquivos. A cópia NÃO foi tocada (nenhuma DDL nesta task).

---

## Task 3: Suíte de banco na CÓPIA (txn revertida) + vizinha da reorganização → G-migration

**Files:**
- Modify: `tests/integration/sku-previa.test.ts` (acrescentar, NO FIM, os blocos de banco abaixo)
- Modify: `tests/integration/sheet-reorg-campos.test.ts:85-87` (consts), `:279-282` (`prepara`), `:520-533` (teste das 4 do SKU)

**Interfaces:**
- Consumes: o contrato do banco da Task 2 (Interfaces); `withTx`, `comoUsuario`, `semUsuario`, `um`, `TENANT_TESTE`,
  `USER_TESTE` (`./db`); `aplicarSql`, `exigeBancoLocal` (`./mig-txn`).
- Produces: prova de EQUIVALÊNCIA velho × novo da geração, de PRÉVIA ≡ GRAVAÇÃO, de só leitura, de P0409, de ACL e do
  inverso — insumo do G-migration.

- [ ] **Step 1: Helpers de banco — acrescentar no fim de `tests/integration/sku-previa.test.ts`**

```ts
// ─────────────────────────────── Task 3 — banco (SÓ na cópia) ───────────────────────────────
/** As 2 travas do arquivo (logo depois do BEGIN) saem da txn do teste: o transaction_timeout de 3 s limitaria o teste todo. */
const RE_TRAVAS = /^SET LOCAL (lock_timeout|transaction_timeout) = '[^']*';$/gm;
function semTravas(sql: string, nome: string): string {
  const n = (sql.match(RE_TRAVAS) ?? []).length;
  if (n !== 2) throw new Error(`${nome}: esperado as 2 travas SET LOCAL (lock_timeout + transaction_timeout); achei ${n}`);
  return sql.replace(RE_TRAVAS, "-- [teste] trava do arquivo removida (a txn do teste tem as suas)");
}
const aplica = (c: Client, rel: string) => aplicarSql(c, semTravas(ler(rel), rel), rel);

async function naCopia(sql: string): Promise<boolean> {
  if (!hasDb || !LOCAL) return false; // fora da cópia: nem conecta
  const c = new Client({ connectionString: dbUrl()!, ssl: false });
  await c.connect();
  try {
    return (await c.query(sql)).rows[0]?.ok === true;
  } finally {
    await c.end();
  }
}
const VIVA = await naCopia("select to_regprocedure('public.skus_previa(uuid,text,text,jsonb,text)') is not null as ok");
const BASE_OK = await naCopia("select to_regprocedure('public._titulo_pagina_calculado(text,text)') is not null and to_regclass('public.modelo_skus') is not null as ok");
const PRONTO = hasDb && LOCAL && (MIG_TXN ? BASE_OK : VIVA);
/** Equivalência e inverso: precisam das funções de ANTES na cópia (P5 — pula depois do copia.sh ida). */
const PRONTO_ANTES = hasDb && LOCAL && MIG_TXN && BASE_OK && !VIVA;

async function prepara(c: Client, o: { aplicar?: boolean } = {}): Promise<void> {
  exigeBancoLocal();
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '60s'");
  if (MIG_TXN && o.aplicar !== false) await aplica(c, MIG);
}
/** Roda e ESPERA erro; volta ao savepoint (a txn segue usável). */
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT pv_falha");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT pv_falha");
    const err = e as { code?: string; message?: string };
    return { code: String(err.code ?? ""), message: String(err.message ?? "") };
  }
  await c.query("RELEASE SAVEPOINT pv_falha");
  throw new Error(`esperava erro e passou: ${sql}`);
}
const v = async (c: Client, sql: string, p: unknown[]) => (await um<{ v: any }>(c, sql, p)).v;
const gerar = (c: Client, m: string, regerar = false) => v(c, "SELECT public.gerar_skus_modelo($1::uuid, $2::boolean) AS v", [m, regerar]);
const matriz = (c: Client, m: string) => v(c, "SELECT public.skus_modelo($1::uuid) AS v", [m]);
const Q_PREVIA = "SELECT public.skus_previa($1::uuid, $2::text, $3::text, $4::jsonb, $5::text) AS v";
const previa = (c: Client, m: string, ref: string | null, tipo: string | null, manuais: unknown[] = [], modo = "regerar") =>
  v(c, Q_PREVIA, [m, ref, tipo, JSON.stringify(manuais), modo]);
const Q_APLICAR = "SELECT public.aplicar_skus_modelo($1::uuid, $2::jsonb, $3::text, $4::text) AS v";
const aplicar = (c: Client, m: string, manuais: unknown[], modo: string, ass: string | null) =>
  v(c, Q_APLICAR, [m, JSON.stringify(manuais), modo, ass]);
const plano = (c: Client, m: string, ref: string | null, tipo: string | null, manuais: unknown[] = [], modo = "regerar") =>
  v(c, "SELECT public._skus_plano($1::uuid, $2::text, $3::text, $4::jsonb, $5::text) AS v", [m, ref, tipo, JSON.stringify(manuais), modo]);
type Gravado = { vk: string; tk: string; sku: string; manual: boolean };
async function estado(c: Client, m: string): Promise<Gravado[]> {
  return (await c.query(
    `SELECT variante_key::text AS vk, tamanho_key AS tk, sku, manual FROM public.modelo_skus WHERE modelo_id = $1
      ORDER BY variante_key::text COLLATE "C", tamanho_key COLLATE "C"`, [m])).rows;
}
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const finalComoEstado = (final: [string, string, string, boolean][]): Gravado[] =>
  final.map(([vk, tk, sku, manual]) => ({ vk, tk, sku, manual })).sort((a, b) => cmpStr(`${a.vk}|${a.tk}`, `${b.vk}|${b.tk}`));
/** ids novos a cada rodada (gen_random_uuid): fora da comparação velho × novo. */
const semIds = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (k, val) => (k === "id" ? undefined : val)));
const linhaDe = (mz: any, vk: string, tk: string) => (mz.linhas as any[]).find((l) => l.variante_key === vk && l.tamanho_key === tk);

const T = TENANT_TESTE;
const novoId = async (c: Client, sql: string, p: unknown[]) => (await um<{ id: string }>(c, sql, p)).id;
const chave = async (c: Client, cor: string, ape: string | null = null) =>
  (await um<{ k: string }>(c, "SELECT public._sku_variante_key($1::uuid, $2::uuid) AS k", [cor, ape])).k;
const FMT_COR_TAM = { partes: ["cor_base", "tamanho"], separadores: {} };
const FMT_REF = { partes: ["ref", "cor_base", "tamanho"], separadores: { "ref|cor_base": "-" } };
async function loja(c: Client, cfg: unknown = FMT_COR_TAM): Promise<void> {
  await c.query(
    "UPDATE public.tenant_config SET sku_config = $2::jsonb, tamanhos_sku = $3::jsonb, tamanhos_grade = $4::jsonb WHERE tenant_id = $1",
    [T, JSON.stringify(cfg), JSON.stringify({ "34": "34", PPP: "PPP", "36": "36", PP: "PP" }), JSON.stringify(["34|PPP", "36|PP"])],
  );
}
type Cen = { m: string; corA: string; corB: string; kA: string; kB: string };
/** Card isolado "PV-T Blusa" (REF PV-T1, "Tamanho em" Número): Tecido 1 = [Cor A (AA), Cor B (BB)], grade 34 e 36 nas 2.
 *  Com FMT_COR_TAM os SKUs são AA34, AA36, BB34, BB36. */
async function cenario(c: Client, cfg: unknown = FMT_COR_TAM): Promise<Cen> {
  await loja(c, cfg);
  const corA = await novoId(c, "INSERT INTO public.cores (tenant_id, nome, sigla_sku) VALUES ($1, 'PV-T Cor A', 'AA') RETURNING id", [T]);
  const corB = await novoId(c, "INSERT INTO public.cores (tenant_id, nome, sigla_sku) VALUES ($1, 'PV-T Cor B', 'BB') RETURNING id", [T]);
  const artigo = await novoId(c, "INSERT INTO public.artigos (tenant_id, nome) VALUES ($1, 'PV-T Tecido') RETURNING id", [T]);
  const vt = (cor: string) =>
    novoId(c, "INSERT INTO public.variantes_tecido (tenant_id, artigo_id, cor_id) VALUES ($1, $2, $3) RETURNING id", [T, artigo, cor]);
  const vtA = await vt(corA);
  const vtB = await vt(corB);
  const m = await novoId(c,
    "INSERT INTO public.modelos (tenant_id, nome, ref, origem, tamanho_tipo) VALUES ($1, 'PV-T Blusa', 'PV-T1', 'interno', 'numero') RETURNING id", [T]);
  const mt = await novoId(c, "INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo) VALUES ($1, $2, 1, 'tecido') RETURNING id", [m, artigo]);
  await c.query("INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1, $2, 1), ($1, $3, 2)", [mt, vtA, vtB]);
  await c.query(
    `INSERT INTO public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
     VALUES ($1, 1, '{"34|PPP": 1, "36|PP": 1}'::jsonb, 2), ($1, 2, '{"34|PPP": 1, "36|PP": 1}'::jsonb, 2)`, [m]);
  return { m, corA, corB, kA: await chave(c, corA), kB: await chave(c, corB) };
}
async function siglas(c: Client, k: Cen, a: string | null, b: string | null): Promise<void> {
  if (a !== null) await c.query("UPDATE public.cores SET sigla_sku = $2 WHERE id = $1", [k.corA, a]);
  if (b !== null) await c.query("UPDATE public.cores SET sigla_sku = $2 WHERE id = $1", [k.corB, b]);
}
/** Outro card da loja com 1 SKU gravado (REF igual = réplica — D5; diferente = conflito). */
async function outroCom(c: Client, ref: string, vk: string, tk: string, sku: string): Promise<string> {
  const o = await novoId(c,
    "INSERT INTO public.modelos (tenant_id, nome, ref, origem, tamanho_tipo) VALUES ($1, 'PV-T Outro', $2, 'interno', 'numero') RETURNING id", [T, ref]);
  await c.query("INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku, manual) VALUES ($1, $2, $3, $4, $5, true)",
    [T, o, vk, tk, sku]);
  return o;
}
const idRev = (c: Client, m: string, vk: string, tk: string) =>
  um<{ id: string; rev: number }>(c, "SELECT id, rev FROM public.modelo_skus WHERE modelo_id = $1 AND variante_key = $2 AND tamanho_key = $3", [m, vk, tk]);

/** Passos de cada cenário da equivalência: mexem no dado ENTRE as gerações (como o usuário faria), devolvem os resultados. */
type Passos = (c: Client, k: Cen) => Promise<unknown[]>;
const CENARIOS: [string, Passos][] = [
  ["1ª geração, manual preservado, divergente regerado, órfã removida, falta mantém o gravado", async (c, k) => {
    const out: unknown[] = [await gerar(c, k.m)];
    out.push(await v(c, "SELECT public.salvar_sku_manual($1::uuid, 'meu-1') AS v", [(await idRev(c, k.m, k.kA, "34|PPP")).id]));
    await siglas(c, k, "AC", null);
    await c.query(`UPDATE public.modelo_grades SET grades = '{"34|PPP": 1, "36|PP": 0}'::jsonb WHERE modelo_id = $1 AND variante_numero = 2`, [k.m]);
    await c.query("UPDATE public.cores SET sigla_sku = NULL WHERE id = $1", [k.corB]);
    out.push(await gerar(c, k.m), await gerar(c, k.m, true), await matriz(c, k.m));
    return out;
  }],
  ["conflito com outro card (REF diferente) e réplica (mesma REF) que divide o SKU", async (c, k) => {
    await outroCom(c, "PV-X", k.kA, "34|PPP", "AA34");
    await outroCom(c, "PV-T1", k.kB, "34|PPP", "BB34");
    return [await gerar(c, k.m), await matriz(c, k.m)];
  }],
  ["troca A↔B no mesmo card: as 4 linhas em conflito ('também muda neste Regerar')", async (c, k) => {
    const a = await gerar(c, k.m);
    await siglas(c, k, "BB", "AA");
    return [a, await gerar(c, k.m, true), await matriz(c, k.m)];
  }],
  ["cadeia direta: A quer o SKU atual de B (que também muda) — A conflita, B muda", async (c, k) => {
    const a = await gerar(c, k.m);
    await siglas(c, k, "BB", "XX");
    return [a, await gerar(c, k.m, true), await matriz(c, k.m)];
  }],
  ["cadeia inversa: B quer o SKU antigo de A, já liberado no mesmo Regerar — os dois mudam", async (c, k) => {
    const a = await gerar(c, k.m);
    await siglas(c, k, "XX", "AA");
    return [a, await gerar(c, k.m, true), await matriz(c, k.m)];
  }],
  ["órfã sai ANTES e libera o SKU para outra linha no mesmo Regerar", async (c, k) => {
    const a = await gerar(c, k.m);
    await c.query(`UPDATE public.modelo_grades SET grades = '{"34|PPP": 0, "36|PP": 0}'::jsonb WHERE modelo_id = $1 AND variante_numero = 2`, [k.m]);
    await siglas(c, k, "BB", null);
    return [a, await gerar(c, k.m, true), await matriz(c, k.m)];
  }],
  ["sem 'Tamanho em', sem REF, sem Formato: nada gera (precedência da F3.6)", async (c, k) => {
    const out: unknown[] = [await gerar(c, k.m)];
    await c.query("UPDATE public.modelos SET tamanho_tipo = NULL WHERE id = $1", [k.m]);
    out.push(await gerar(c, k.m, true), await matriz(c, k.m));
    await c.query("UPDATE public.modelos SET tamanho_tipo = 'numero', ref = NULL WHERE id = $1", [k.m]);
    out.push(await gerar(c, k.m, true), await matriz(c, k.m));
    await c.query("UPDATE public.tenant_config SET sku_config = NULL WHERE tenant_id = $1", [T]);
    out.push(await gerar(c, k.m, true), await matriz(c, k.m));
    return out;
  }],
];

describe.skipIf(!PRONTO_ANTES)("SKU em prévia — EQUIVALÊNCIA velho × novo (a geração virou plano + executor — R1)", () => {
  for (const [nome, passos] of CENARIOS) {
    it(nome, async () => {
      await withTx(async (c) => {
        await prepara(c, { aplicar: false }); // as funções VIVAS de antes (cópia sem esta migration)
        const k = await cenario(c);
        await comoUsuario(c);
        await c.query("SAVEPOINT velho");
        const velho = { r: semIds(await passos(c, k)), e: await estado(c, k.m) };
        await c.query("ROLLBACK TO SAVEPOINT velho");
        await aplica(c, MIG);
        const novo = { r: semIds(await passos(c, k)), e: await estado(c, k.m) };
        expect(novo).toEqual(velho);
      });
    });
  }
});
```

Notas para o implementador:
- **Por que os cenários de cadeia existem:** no laço antigo, a ORDEM decide o resultado:
  - A muda antes de B;
  - uma órfã sai antes de todas;
  - cada conflito é o `unique_violation` do gatilho com o banco EM EVOLUÇÃO.
  O plano novo tem de dar o MESMO resultado nos mesmos casos. Se um cenário divergir, NÃO "ajuste o teste": PARE e
  chame o controlador (regra 12).
- O `ROLLBACK TO SAVEPOINT velho` desfaz a 1ª rodada. O cenário (cores, card, grade) foi criado ANTES do savepoint e fica.

- [ ] **Step 2: A prévia é o que o Salvar grava — acrescentar no fim do mesmo arquivo**

```ts
describe.skipIf(!PRONTO)("SKU em prévia — a prévia (rascunho) é EXATAMENTE o que o Salvar grava", () => {
  it("'Tamanho em' do rascunho ≠ salvo: a prévia mostra 'muda' SEM gravar; o Salvar (UPDATE do card + aplicar) grava o final da prévia", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.m);
      const antes = await estado(c, k.m);
      const p = await previa(c, k.m, "PV-T1", "letra");
      expect(await estado(c, k.m)).toEqual(antes); // nada gravou
      expect(p.status).toBe("ok");
      expect(p.linhas.map((l: any) => [l.tamanho_key, l.sku, l.previa?.acao, l.previa?.sku_para])).toEqual([
        ["34|PPP", "AA34", "muda", "AAPPP"], ["36|PP", "AA36", "muda", "AAPP"],
        ["34|PPP", "BB34", "muda", "BBPPP"], ["36|PP", "BB36", "muda", "BBPP"],
      ]);
      const pl = await plano(c, k.m, "PV-T1", "letra");
      expect(pl.assinatura).toBe(p.assinatura);
      await c.query("UPDATE public.modelos SET tamanho_tipo = 'letra' WHERE id = $1", [k.m]); // o Salvar do card
      const r = await aplicar(c, k.m, [], "regerar", p.assinatura);
      expect([r.criados, r.atualizados, r.removidos, r.manuais, r.conflitos]).toEqual([0, 4, 0, 0, []]);
      expect(await estado(c, k.m)).toEqual(finalComoEstado(pl.final));
    });
  });

  it("REF do rascunho (Formato com REF): prévia com a REF nova; grava depois de salvar a REF", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c, FMT_REF);
      await comoUsuario(c);
      await gerar(c, k.m);
      expect((await estado(c, k.m)).map((g) => g.sku)).toEqual(expect.arrayContaining(["PV-T1-AA34"]));
      const p = await previa(c, k.m, "PV-T2", "numero");
      expect(linhaDe(p, k.kA, "34|PPP").previa).toMatchObject({ acao: "muda", sku_de: "PV-T1-AA34", sku_para: "PV-T2-AA34" });
      await c.query("UPDATE public.modelos SET ref = 'PV-T2' WHERE id = $1", [k.m]);
      await aplicar(c, k.m, [], "regerar", p.assinatura);
      expect((await estado(c, k.m)).map((g) => g.sku).sort()).toEqual(["PV-T2-AA34", "PV-T2-AA36", "PV-T2-BB34", "PV-T2-BB36"]);
    });
  });

  it("SKU à mão + Regerar juntos: o digitado vira 'manual_novo' (e fica manual=true); o Regerar não o toca", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.m);
      const man = [{ variante_key: k.kA, tamanho_key: "34|PPP", sku: "meu-2", rev: (await idRev(c, k.m, k.kA, "34|PPP")).rev }];
      const p = await previa(c, k.m, "PV-T1", "letra", man);
      expect(linhaDe(p, k.kA, "34|PPP").previa).toMatchObject({ acao: "manual_novo", sku_de: "AA34", sku_para: "MEU-2" });
      expect(linhaDe(p, k.kA, "36|PP").previa).toMatchObject({ acao: "muda", sku_para: "AAPP" });
      await c.query("UPDATE public.modelos SET tamanho_tipo = 'letra' WHERE id = $1", [k.m]);
      const r = await aplicar(c, k.m, man, "regerar", p.assinatura);
      expect([r.atualizados, r.manuais]).toEqual([3, 1]);
      expect((await estado(c, k.m)).find((g) => g.vk === k.kA && g.tk === "34|PPP")).toEqual({ vk: k.kA, tk: "34|PPP", sku: "MEU-2", manual: true });
    });
  });

  it("cenários difíceis (troca, cadeias, órfã, conflito com outro card): gravado = final da prévia, conflitos iguais", async () => {
    const casos: [string, (c: Client, k: Cen) => Promise<void>][] = [
      ["troca", (c, k) => siglas(c, k, "BB", "AA")],
      ["cadeia direta", (c, k) => siglas(c, k, "BB", "XX")],
      ["cadeia inversa", (c, k) => siglas(c, k, "XX", "AA")],
      ["órfã libera", async (c, k) => {
        await c.query(`UPDATE public.modelo_grades SET grades = '{"34|PPP": 0, "36|PP": 0}'::jsonb WHERE modelo_id = $1 AND variante_numero = 2`, [k.m]);
        await siglas(c, k, "BB", null);
      }],
      ["outro card", async (c, k) => { await outroCom(c, "PV-X", k.kA, "34|PPP", "AC34"); await siglas(c, k, "AC", null); }],
    ];
    for (const [nome, mexe] of casos) {
      await withTx(async (c) => {
        await prepara(c);
        const k = await cenario(c);
        await comoUsuario(c);
        await gerar(c, k.m);
        await mexe(c, k);
        const p = await previa(c, k.m, "PV-T1", "numero");
        const pl = await plano(c, k.m, "PV-T1", "numero");
        const r = await aplicar(c, k.m, [], "regerar", p.assinatura);
        expect(await estado(c, k.m), nome).toEqual(finalComoEstado(pl.final));
        expect(r.conflitos, nome).toEqual(p.conflitos);
      });
    }
  });

  it("SÓ LEITURA: skus_previa roda numa transação READ ONLY e não muda nada; volatilidades STABLE/IMMUTABLE", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.m);
      const antes = await estado(c, k.m);
      await c.query("SAVEPOINT so_leitura");
      await c.query("SET LOCAL transaction_read_only = on");
      const man = [{ variante_key: k.kA, tamanho_key: "34|PPP", sku: "RO-1", rev: 0 }];
      expect((await previa(c, k.m, "PV-T9", "letra", man)).status).toBe("ok");
      await c.query("ROLLBACK TO SAVEPOINT so_leitura");
      expect(await estado(c, k.m)).toEqual(antes);
      const vol = (await c.query(`SELECT p.proname AS f, p.provolatile AS v FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN
          ('skus_previa', '_skus_previa_core', '_skus_plano', '_skus_calc_ref_tipo', '_skus_matriz_ref_tipo', '_skus_assinatura')
        ORDER BY p.proname COLLATE "C"`)).rows;
      expect(vol).toEqual([
        { f: "_skus_assinatura", v: "i" }, { f: "_skus_calc_ref_tipo", v: "s" }, { f: "_skus_matriz_ref_tipo", v: "s" },
        { f: "_skus_plano", v: "s" }, { f: "_skus_previa_core", v: "s" }, { f: "skus_previa", v: "s" },
      ]);
    });
  });
});

describe.skipIf(!PRONTO)("SKU em prévia — colaboração (P0409) e erros PT", () => {
  it("outra pessoa edita/gera DEPOIS da prévia ⇒ P0409 e nada grava; assinatura nula/lixo ⇒ P0409; REF salva ≠ a da prévia ⇒ P0409", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.m);
      const p = await previa(c, k.m, "PV-T1", "letra");
      await v(c, "SELECT public.salvar_sku_manual($1::uuid, 'dela-1') AS v", [(await idRev(c, k.m, k.kB, "36|PP")).id]); // a outra pessoa
      await c.query("UPDATE public.modelos SET tamanho_tipo = 'letra' WHERE id = $1", [k.m]);
      const antes = await estado(c, k.m);
      expect(await falha(c, Q_APLICAR, [k.m, "[]", "regerar", p.assinatura]))
        .toEqual({ code: "P0409", message: "previa_desatualizada: os SKUs mudaram desde a prévia" });
      expect(await estado(c, k.m)).toEqual(antes);
      expect((await falha(c, Q_APLICAR, [k.m, "[]", "regerar", null])).code).toBe("P0409");
      expect((await falha(c, Q_APLICAR, [k.m, "[]", "regerar", "lixo"])).code).toBe("P0409");
      const p2 = await previa(c, k.m, "PV-T1", "letra");
      await c.query("UPDATE public.modelos SET tamanho_tipo = 'numero' WHERE id = $1", [k.m]); // o salvo não é o da prévia
      expect((await falha(c, Q_APLICAR, [k.m, "[]", "regerar", p2.assinatura])).code).toBe("P0409");
    });
  });

  it("SKU digitado: rev velho ⇒ erro P0409 na linha e no Salvar ('manter o meu' com o rev novo passa); duplicado/fora da grade/inválido ⇒ mensagens PT da F3.5a", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.m);
      const { id, rev } = await idRev(c, k.m, k.kA, "34|PPP");
      await v(c, "SELECT public.salvar_sku_manual($1::uuid, 'dela-2') AS v", [id]); // rev + 1
      const velho = [{ variante_key: k.kA, tamanho_key: "34|PPP", sku: "meu-3", rev }];
      const p = await previa(c, k.m, "PV-T1", "numero", velho, "manuais");
      expect(linhaDe(p, k.kA, "34|PPP").previa).toMatchObject({ acao: "erro", code: "P0409" });
      expect(await falha(c, Q_APLICAR, [k.m, JSON.stringify(velho), "manuais", p.assinatura]))
        .toEqual({ code: "P0409", message: "conflito_versao: o SKU foi alterado por outra pessoa" });
      const novo = [{ ...velho[0], rev: rev + 1 }];
      const p2 = await previa(c, k.m, "PV-T1", "numero", novo, "manuais");
      expect(p2.erros).toEqual([]);
      expect((await aplicar(c, k.m, novo, "manuais", p2.assinatura)).manuais).toBe(1);
      await outroCom(c, "PV-X", k.kB, "34|PPP", "DE-OUTRO");
      const casos: [unknown, string][] = [
        [{ variante_key: k.kB, tamanho_key: "36|PP", sku: "de-outro", rev: 0 }, "O SKU DE-OUTRO já existe em PV-T Outro (REF PV-X). Escolha outro."],
        [{ variante_key: k.kB, tamanho_key: "36|PP", sku: "meu-3", rev: 0 }, "O SKU MEU-3 já está em outra linha deste produto."],
        [{ variante_key: k.kB, tamanho_key: "38|P", sku: "x-1", rev: null }, "Esta variante/tamanho não está na grade do produto."],
        [{ variante_key: k.kB, tamanho_key: "36|PP", sku: "a#b", rev: 0 }, "SKU inválido: use só letras, números e - . _ /."],
      ];
      for (const [m1, msg] of casos) {
        const pe = await previa(c, k.m, "PV-T1", "numero", [m1], "manuais");
        expect(pe.erros.map((e: any) => [e.code, e.mensagem]), msg).toEqual([["P0001", msg]]);
        expect(await falha(c, Q_APLICAR, [k.m, JSON.stringify([m1]), "manuais", pe.assinatura]), msg).toEqual({ code: "P0001", message: msg });
      }
      expect((await falha(c, Q_PREVIA, [k.m, "PV-T1", "numero", JSON.stringify([{ variante_key: "x" }]), "manuais"])).message).toBe("SKUs à mão inválidos.");
      expect((await falha(c, Q_PREVIA, [k.m, "PV-T1", "grande", "[]", "manuais"])).message).toBe("\"Tamanho em\" inválido: use letra ou número.");
      expect((await falha(c, Q_PREVIA, [k.m, "PV-T1", "numero", "[]", "apagar"])).message).toBe("Modo da prévia dos SKUs inválido.");
    });
  });
});

describe.skipIf(!PRONTO)("SKU em prévia — permissões e ACL (#9)", () => {
  it("wrappers: login → loja → EDITAR o Planejamento (ver não basta — R8) → módulo; _core fechados p/ o PostgREST", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      const comum = await um<{ id: string }>(c,
        `SELECT u.id FROM public.users u
          WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'user')
            AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role <> 'user')
            AND u.tenant_id <> $1 ORDER BY u.id LIMIT 1`, [T]);
      expect(comum?.id, "a cópia precisa de 1 usuário comum de outra loja").toBeTruthy();
      const args = [k.m, "PV-T1", "numero", "[]", "regerar"];
      const argsA = [k.m, "[]", "regerar", null];
      await semUsuario(c);
      expect(await falha(c, Q_PREVIA, args)).toEqual({ code: "42501", message: "Não autenticado." });
      const jwt = () => c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: comum.id, role: "authenticated" })]);
      await jwt();
      expect(await falha(c, Q_PREVIA, args)).toEqual({ code: "42501", message: "Sem permissão para este modelo." });
      await comoUsuario(c); // o UPDATE do próprio tenant do usuário comum precisa do super admin (users_prevent_self_role_change)
      await c.query("UPDATE public.users SET tenant_id = $1, papel_id = NULL WHERE id = $2", [T, comum.id]);
      await c.query("DELETE FROM public.user_permissions WHERE user_id = $1", [comum.id]);
      await c.query("INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, 'criacao_planejamento', true, false)", [comum.id, T]);
      await jwt();
      const semEditar = { code: "42501", message: "Sem permissão para editar SKUs (Planejamento de Produto)." };
      expect(await falha(c, Q_PREVIA, args)).toEqual(semEditar);
      expect(await falha(c, Q_APLICAR, argsA)).toEqual(semEditar);
      await comoUsuario(c);
      await c.query("UPDATE public.user_permissions SET pode_editar = true WHERE user_id = $1 AND pagina = 'criacao_planejamento'", [comum.id]);
      await jwt();
      expect((await v(c, Q_PREVIA, args)).status).toBe("ok");
      await c.query("UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || '{\"criacao\": false}'::jsonb WHERE tenant_id = $1", [T]);
      expect(await falha(c, Q_PREVIA, args)).toEqual({ code: "42501", message: "Módulo Estilo & Engenharia não habilitado para esta loja." });
      await c.query("SET LOCAL ROLE authenticated");
      for (const q of ["SELECT public._skus_plano($1::uuid, 'X', 'letra', '[]'::jsonb, 'regerar')", "SELECT public._skus_previa_core($1::uuid, 'X', 'letra', '[]'::jsonb, 'regerar')",
                       "SELECT public._aplicar_skus_modelo_core($1::uuid, '[]'::jsonb, 'regerar', NULL)", "SELECT public._skus_calc_ref_tipo($1::uuid, 'X', 'letra')"]) {
        expect((await falha(c, q, [k.m])).code, q).toBe("42501");
      }
      await c.query("RESET ROLE");
    });
  });

  it("ACL: as 10 internas sem EXECUTE p/ PUBLIC/anon/authenticated (proacl das 3 redefinidas intacto); as 2 RPCs só authenticated", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const priv = (fn: string) => um<any>(c,
        `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon, has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
                EXISTS (SELECT 1 FROM aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid = $1::regprocedure),
                        acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = $1::regprocedure)))) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico`, [fn]);
      for (const f of [...REDEF.map((x) => x.fn), ...NOVAS.filter((x) => !x.rpc).map((x) => x.fn)]) {
        expect(await priv(f), f).toEqual({ anon: false, auth: false, publico: false });
      }
      for (const f of REDEF.map((x) => x.fn)) {
        expect((await um<{ a: string }>(c, "SELECT proacl::text AS a FROM pg_proc WHERE oid = $1::regprocedure", [f])).a, f)
          .toBe("{postgres=X/postgres,service_role=X/postgres}");
      }
      for (const f of NOVAS.filter((x) => x.rpc).map((x) => x.fn)) {
        expect(await priv(f), f).toEqual({ anon: false, auth: true, publico: false });
      }
    });
  });
});

describe.skipIf(!PRONTO_ANTES)("SKU em prévia — inverso (round-trip) e idempotência", () => {
  it("aplicar 2× não dá erro; o inverso devolve as 3 ao texto vivo byte a byte, tira as 9 e NÃO mexe nos SKUs gravados", async () => {
    await withTx(async (c) => {
      await prepara(c, { aplicar: false });
      const def = async (fn: string) => (await um<{ d: string | null }>(c, "SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [fn])).d;
      const vivas = await Promise.all(REDEF.map((f) => def(f.fn)));
      REDEF.forEach((f, i) => expect(vivas[i], f.fn).toBe(corpo(INV, f.cria)));
      await aplica(c, MIG);
      await aplica(c, MIG); // idempotente
      for (const f of [...REDEF, ...NOVAS]) expect(await def(f.fn), f.fn).toBe(corpo(MIG, f.cria));
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.m);
      const gravados = await estado(c, k.m);
      await aplica(c, INV);
      for (const [i, f] of REDEF.entries()) expect(await def(f.fn), f.fn).toBe(vivas[i]);
      for (const f of NOVAS) expect(await def(f.fn), f.fn).toBeNull();
      expect(await estado(c, k.m)).toEqual(gravados);
      await aplica(c, INV); // inverso idempotente
      await aplica(c, MIG);
      for (const f of NOVAS) expect(await def(f.fn), f.fn).toBe(corpo(MIG, f.cria));
    });
  });
});
```

- [ ] **Step 3: A vizinha da reorganização aprende a prévia viva (P4) — `tests/integration/sheet-reorg-campos.test.ts`**

(a) Logo depois de `if (MIG_TXN && hasDb) exigeBancoLocal();` (`:86`), acrescentar:

```ts
// SKU em PRÉVIA (20261005110000 — plano 2026-09-25-sku-previa-regerar, Task 3, P4): ela redefine 3 das 4 funções do SKU
// (_skus_modelo_calc/_skus_modelo_core/_gerar_skus_modelo_core). Com ela VIVA na cópia (LIFO): o texto esperado dessas 3 é
// o dela e, no modo SHEET_MIG_TXN=1, o inverso dela roda DENTRO da txn antes desta migration (tudo revertido no fim).
const MIG_PREVIA = "supabase/migrations/20261005110000_sku_previa_regerar.sql";
const INV_PREVIA = "supabase/rollback/20261005110000_sku_previa_regerar_down.sql";
```

(b) Trocar a `prepara` (`:279-282`):

```ts
async function prepara(c: Client): Promise<void> {
  await timeouts(c);
  if (MIG_TXN) await aplica(c, MIG);
}
```
por

```ts
async function previaViva(c: Client): Promise<boolean> {
  return (await um<{ ok: boolean }>(c, "select to_regprocedure('public.skus_previa(uuid,text,text,jsonb,text)') is not null as ok")).ok;
}
async function prepara(c: Client): Promise<void> {
  await timeouts(c);
  if (MIG_TXN) {
    if (await previaViva(c)) await aplica(c, INV_PREVIA); // P4 — LIFO: a guarda desta migration recusaria as 3 com o texto da prévia
    await aplica(c, MIG);
  }
}
```

(c) No teste "4 funções do SKU: texto = o do arquivo …" (`:520-533`), trocar o corpo do `for` por:

```ts
      const viva = !MIG_TXN && (await previaViva(c));
      for (const [i, f] of SKU_FNS.entries()) {
        const d = (await def(c, f.fn))!;
        if (viva && f.arq !== "sku_config_normaliza") {
          expect(d, f.arq).toBe(corpoSku(MIG_PREVIA, f.cria) + "\n"); // P4 — redefinida pela prévia
        } else {
          expect(d, f.arq).toBe(corpoSku(MIG, f.cria) + "\n");
          expect(md5(d), f.arq).toBe(g[i + 1].depois);
        }
        expect(await acl(c, f.fn), f.arq).toBe("{postgres=X/postgres,service_role=X/postgres}");
        const p = await privs(c, f.fn);
        expect([p.anon, p.auth], f.arq).toEqual([false, false]);
      }
```

- [ ] **Step 4: Rodar a suíte na cópia — N3 (aviso no painel, P-30 B)**

O CONTROLADOR publica o aviso: "Vou rodar a suíte do SKU em prévia na cópia local agora (~2 min). A migration só troca funções (o
:5188 não congela); os testes criam dados numa transação desfeita no fim." Depois:

```bash
ps -Ao pid,command | grep -E "[v]itest|[p]laywright"        # vazio
PREVIA_DONO_AVISADO=sim bash .superpowers/sku-previa/n3.sh antes t3
SKU_PREVIA_MIG_TXN=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/integration/sku-previa.test.ts 2>&1 | tee .superpowers/sku-previa/logs/t3-previa-txn.log
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/integration/sku-previa.test.ts tests/integration/sheet-reorg-campos.test.ts 2>&1 | tee .superpowers/sku-previa/logs/t3-sem-variavel.log
bash .superpowers/sku-previa/n3.sh depois t3
```
Expected:
- `t3-previa-txn.log`: TODOS os testes passam (7 estáticos + 7 equivalência + 5 prévia≡gravação + 2 P0409 + 2 ACL + 1 inverso = 24), 0 falha.
- `t3-sem-variavel.log`: os blocos de banco da prévia PULAM (a cópia não tem a frente); a `sheet-reorg-campos` segue com as MESMAS
  falhas/pulos de antes (compare com `.claude/worktrees/sheet-reorg/.superpowers/sheet/logs/viz-depois.log` — nenhuma falha nova).
- `n3.sh antes` e `depois` com o MESMO `484|277|false`.

Falha:
- de **formato canônico** (o `$pos$` desfaz: "não ficou com o texto esperado") ⇒ ajustar o texto no `gerar_sql.py`, regerar,
  registrar em `desvios.md`;
- de **equivalência** ou de **prévia ≠ gravação** ⇒ PARE e chame o controlador (regra 12).

- [ ] **Step 5: Gates e commit**

```bash
bash .superpowers/sku-previa/gates.sh
git add -- tests/integration/sku-previa.test.ts tests/integration/sheet-reorg-campos.test.ts
git commit --only -m "test(sku-previa): banco na cópia — equivalência velho×novo, prévia≡gravação, P0409, ACL, inverso; vizinha LIFO (T3)

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- tests/integration/sku-previa.test.ts tests/integration/sheet-reorg-campos.test.ts
git show --stat HEAD
```
(Se o Step 4 mudou o gerador: regerar e incluir os 2 SQL no MESMO commit.)

- [ ] **Step 6: G-migration — 2 revisões Opus INDEPENDENTES (A e B) + guardião**

Cada revisor recebe SÓ: a spec, este plano, os 2 SQL, o `gerar_sql.py`, o `dump_antes.sh`, a suíte e os 2 logs do Step 4. Não
vê o parecer do outro. Grava em `.superpowers/sku-previa/g-migration-{A,B}.md`. Checklist:
1. texto vivo × gerado: `_ref_tipo` = vivo + SÓ as âncoras; delegadoras com o cabeçalho vivo; geração com a trava ANTES da leitura (B-M8);
2. `_skus_plano` reproduz o laço (manual, falta, fixo/igual, órfã antes, conflito no card em evolução, réplica D5, mensagens) —
   conferir contra o texto vivo de `_gerar_skus_modelo_core`/`_salvar_sku_manual_core` e a equivalência;
3. `skus_previa` e tudo o que ela chama STABLE/IMMUTABLE (só leitura por construção);
4. `aplicar_skus_modelo`: plano com os SALVOS, erro do digitado ⇒ RAISE, assinatura antes E depois, executor estrito;
5. `_skus_assinatura` com `COLLATE "C"` e a MESMA forma de linha nos 2 lados;
6. ACL #9 (10 internas × 3 papéis; RPCs só authenticated; `proacl` das 3 intacto) e `$acl$`;
7. guarda md5 (3 redefinidas: vivo|desta; 9 novas: ausente|desta), `$pos$` com as 12, encoding antes do BEGIN, travas, NOTIFY,
   ZERO DDL de tabela/policy, +9|+0;
8. inverso: 3 de volta byte a byte, 9 DROP, sem dado, idempotente; LIFO (reorganização/F3.5a) documentado;
9. vizinha `sheet-reorg-campos` (P4) e nomes fora do padrão da volta da F3.5a (P1).

O guardião (`guardiao-unificacao`) roda o mesmo portão e registra no diário. BLOQUEIA ⇒ fix na Task 3 (novo commit) e nova rodada escopada.

---

## Task 4: Ensaio na cópia + scripts de PRODUÇÃO (molde da reorganização) + provas → G-scripts → o DONO roda

**Files (não versionados):** `.superpowers/sku-previa/mig/{extra.sh,monta-aplica.sh,aplica.sh (gerado),ensaio-local.sh,ida-producao.sh,volta-producao.sh,ref-volta-f1.sh,prova-scripts.sh,md5-mig.txt,md5-inv.txt}`, `.superpowers/sku-previa/copia.sh`, `/Users/sunglee/PLM + Criação/savepoints/pre-apply-sku-previa/RODAR-sku-previa.md` (pasta 700).

**Interfaces:**
- Consumes: os 2 SQL e os md5 da Task 2 (`md5-redef-antes.txt`, `md5-redef-depois.txt`, `md5-novas-depois.txt`); o bloco
  literal da F1 (hash `c045cc571caf5d95`); a cadeia da referência da volta da F1 em `$BF1`.
- Produces: `source .superpowers/sku-previa/mig/aplica.sh` define `LOCAL`, `MIG`, `INV`, `espera`, `ativ_vazio`, `com_travas`,
  `aplica_v2`, `le`, `OBJ_PREVIA`, `MD5_REDEF`, `MD5_NOVAS`, `FN_PRE`, `ACL_PREVIA`, `CONT`, `prevoo_previa`,
  `confere_ida_previa`, `confere_volta_previa`, `backup_banco`, `backup_copia`, `retrato_producao`, `confere_cadeia_ref`;
  `md5-mig.txt`/`md5-inv.txt` (os SQL ENSAIADOS).

- [ ] **Step 1: `extra.sh` (a parte desta frente do `aplica.sh`)**

```bash
# ── SKU em PRÉVIA (migration 20261005110000 — só FUNÇÕES). Anexado ao bloco LITERAL da F1 por monta-aplica.sh.
# Só DEFINE variáveis e funções (nada roda sozinho). Uso: num BASH, de dentro da worktree: source .superpowers/sku-previa/mig/aplica.sh
M=.superpowers/sku-previa/mig
DS="${PREVIA_DS:-/Users/sunglee/PLM + Criação/savepoints/pre-apply-sku-previa}"
BF1="${PREVIA_BF1:-/Users/sunglee/PLM + Criação/savepoints/pre-apply-f1-kanban-auto}"
RB="${PREVIA_RB:-/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-22-kanban-automatico-f1-banco}"
BK="/Users/sunglee/PLM + Criação/banco-local/backups"
CONTAINER=supabase_db_banco-local
# Adendo N1 (G-migration B da reorg): SET client_encoding de DENTRO do arquivo não protege o psql -c — exportar aqui.
export PGCLIENTENCODING=UTF8
# URL de produção. PREVIA_DBURL_FILE existe SÓ p/ as provas (URL sintética); o dono nunca o define.
DBURL_FILE="${PREVIA_DBURL_FILE:-/tmp/dburl.txt}"
# Guarda ANCORADA (a mesma de Nota/SKU/reorg — substring casaria URL forjada). Roda ANTES de qualquer psql; nunca imprime a URL.
REGEX_URL_PROD='^postgres(ql)?://([^:@/]+(:[^@/]*)?@db\.ruinwcuabilumcspeyjk\.supabase\.co(:[0-9]+)?/|postgres\.ruinwcuabilumcspeyjk(:[^@/]*)?@[a-z0-9.-]+\.pooler\.supabase\.com(:[0-9]+)?/)'
confere_url_producao() {
  [ -s "$DBURL_FILE" ] || { echo "PARE: $DBURL_FILE ausente"; return 1; }
  grep -Eq "$REGEX_URL_PROD" "$DBURL_FILE" || { echo "PARE: $DBURL_FILE não aponta p/ o banco sisTrama (ref ruinwcuabilumcspeyjk, host direto ou pooler)"; return 1; }
}
# P7 — leitura SEMPRE numa transação READ ONLY (o PGOPTIONS só-leitura NÃO vale no Supavisor — lição G-commit 25/set).
le() { psql "$1" -X -q -A -t -F'|' -v ON_ERROR_STOP=1 -c "begin transaction read only" -c "$2" -c "rollback"; }
FNS_REDEF="'public._skus_modelo_calc(uuid)','public._skus_modelo_core(uuid)','public._gerar_skus_modelo_core(uuid,boolean)'"
FNS_NOVAS_INT="'public._skus_assinatura(jsonb)','public._skus_calc_ref_tipo(uuid,text,text)','public._skus_matriz_ref_tipo(uuid,text,text)','public._skus_plano(uuid,text,text,jsonb,text)','public._skus_executar_plano(uuid,uuid,jsonb,boolean)','public._skus_previa_core(uuid,text,text,jsonb,text)','public._aplicar_skus_modelo_core(uuid,jsonb,text,text)'"
FNS_RPC="'public.skus_previa(uuid,text,text,jsonb,text)','public.aplicar_skus_modelo(uuid,jsonb,text,text)'"
FNS_NOVAS="$FNS_NOVAS_INT,$FNS_RPC"   # ordem FIXA = md5-novas-depois.txt (gerar_sql.py, NOVAS)
CONT="select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') || '|' || (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal)"
# Quantas das 9 funções novas existem: 0 sem a frente; 9 com ela.
OBJ_PREVIA="select count(*) from unnest(array[$FNS_NOVAS]) f(x) where to_regprocedure(f.x) is not null"
MD5_REDEF="select string_agg(coalesce(md5(pg_get_functiondef(to_regprocedure(u.f))), '-'), '|' order by u.n) from unnest(array[$FNS_REDEF]) with ordinality u(f, n)"
MD5_NOVAS="select string_agg(coalesce(md5(pg_get_functiondef(to_regprocedure(u.f))), '-'), '|' order by u.n) from unnest(array[$FNS_NOVAS]) with ordinality u(f, n)"
# Fidelidade de TODAS as outras funções de public (fora as 12 desta frente): md5 de assinatura+definição | quantidade.
FN_PRE="select md5(string_agg(p.oid::regprocedure::text || '=' || md5(pg_get_functiondef(p.oid)), E'\n' order by p.oid::regprocedure::text collate \"C\")) || '|' || count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') and p.oid not in (select coalesce(to_regprocedure(x), 0::oid) from unnest(array[$FNS_REDEF,$FNS_NOVAS]) x)"
# ACL (#9): pares (interna × public/anon/authenticated) com EXECUTE | pares (RPC × public/anon) | RPCs executáveis por authenticated.
# has_function_privilege(role, oid, …) é STRICT: função ausente (oid NULL) = NULL = não conta (sem erro).
ACL_PREVIA="select (select count(*) from unnest(array[$FNS_REDEF,$FNS_NOVAS_INT]) f(x) cross join (values ('public'),('anon'),('authenticated')) r(y) where has_function_privilege(r.y, to_regprocedure(f.x), 'EXECUTE')) || '|' || (select count(*) from unnest(array[$FNS_RPC]) f(x) cross join (values ('public'),('anon')) r(y) where has_function_privilege(r.y, to_regprocedure(f.x), 'EXECUTE')) || '|' || (select count(*) from unnest(array[$FNS_RPC]) f(x) where has_function_privilege('authenticated', to_regprocedure(f.x), 'EXECUTE'))"
F1_OK="select to_regprocedure('public.kanban_mover(uuid,text)') is not null"
REORG_OK="select to_regprocedure('public._titulo_pagina_calculado(text,text)') is not null and to_regclass('public.modelo_skus') is not null"
# Chaves (categoria:objeto) que ESTA frente cria/muda no retrato de fidelidade (FIDEL_DET do bloco de apoio v2 da F1): 12 funções.
PAT_PREVIA='^funcoes:public[.](_skus_modelo_calc|_skus_modelo_core|_gerar_skus_modelo_core|_skus_assinatura|_skus_calc_ref_tipo|_skus_matriz_ref_tipo|_skus_plano|_skus_executar_plano|_skus_previa_core|skus_previa|_aplicar_skus_modelo_core|aplicar_skus_modelo)[(]'

md5_arquivo() { md5 -q "$1" 2>/dev/null || md5sum "$1" | cut -d' ' -f1; }
md5_de() { tr -d '[:space:]' < "$1"; }
# md5 dos 2 SQL NO DISCO = os ENSAIADOS (gravados no fim do ensaio-local.sh, depois do G-migration).
confere_md5_sql_revisado() {
  [ -s "$M/md5-mig.txt" ] && [ -s "$M/md5-inv.txt" ] || { echo "FALHOU (pré-voo): faltam $M/md5-mig.txt e/ou md5-inv.txt (ensaio da Task 4)"; return 1; }
  [ "$(md5_arquivo "$MIG")" = "$(md5_de "$M/md5-mig.txt")" ] || { echo "FALHOU (pré-voo): $MIG ≠ o ensaiado"; return 1; }
  [ "$(md5_arquivo "$INV")" = "$(md5_de "$M/md5-inv.txt")" ] || { echo "FALHOU (pré-voo): $INV ≠ o ensaiado"; return 1; }
  echo "OK (pré-voo): os 2 SQL = md5 do ensaio"
}
confere_arquivos_previa() {
  local f
  for f in "$MIG" "$INV"; do
    [ "$(grep -m1 -vE '^--|^$' "$f")" = "SET client_encoding = 'UTF8';" ] || { echo "FALHOU (pré-voo): $f — a 1ª instrução tem de ser SET client_encoding = 'UTF8';"; return 1; }
    [ "$(grep -A2 -x 'BEGIN;' "$f")" = "$(printf '%s\n' 'BEGIN;' "SET LOCAL lock_timeout = '500ms';" "SET LOCAL transaction_timeout = '3s';")" ] \
      || { echo "FALHOU (pré-voo): $f sem as 2 travas logo depois do BEGIN;"; return 1; }
    if grep -Eiq '^[[:space:]]*(create|drop|alter)[[:space:]]+(policy|table)' "$f"; then
      echo "FALHOU (pré-voo): $f tem DDL de tabela/policy — esta frente só troca funções"; return 1
    fi
  done
  echo "OK (pré-voo): encoding, travas 500ms/3s e nenhuma DDL de tabela/policy nos 2 arquivos"
}
# Backup = receita PROVADA (Nota/SKU/reorg): 2 dumps POR SCHEMA (public + auth) com o pg_dump 17.6 do CONTAINER da cópia. URL pela
# ENTRADA PADRÃO (nunca em argumento de processo). umask 077 + chmod 600; exige TABLE DATA > 0 e que o dump abra (pg_restore -l).
backup_banco() {  # uso: backup_banco URL pasta rótulo
  local url="$1" dir="$2" rot="$3" schema f n_td
  mkdir -p "$dir" && chmod 700 "$dir" 2>/dev/null || return 1
  docker ps --filter "name=^${CONTAINER}$" --format '{{.Names}}' | grep -qx "$CONTAINER" \
    || { echo "FALHOU (backup): o container $CONTAINER não está no ar (o pg_dump 17.6 mora nele)"; return 1; }
  for schema in public auth; do
    f="$dir/${rot}-${schema}-$(date +%F-%H%M%S).dump"
    echo "== backup ($rot, schema $schema) → $f"
    ( umask 077; printf '%s\n' "$url" | docker exec -i "$CONTAINER" sh -c "IFS= read -r U; exec pg_dump -d \"\$U\" -Fc -n $schema" > "$f" 2> "$f.log" ) && [ -s "$f" ] \
      || { chmod 600 "$f" "$f.log" 2>/dev/null; echo "FALHOU (backup): pg_dump do schema $schema — veja $f.log (nada foi aplicado)"; tail -5 "$f.log"; return 1; }
    chmod 600 "$f" "$f.log" 2>/dev/null
    ( umask 077; docker exec -i "$CONTAINER" pg_restore -l < "$f" > "$f.toc" 2>> "$f.log" ) \
      || { chmod 600 "$f.toc" 2>/dev/null; echo "FALHOU (backup): o dump de $schema não abre (pg_restore -l)"; return 1; }
    chmod 600 "$f.toc" 2>/dev/null
    n_td=$(grep -c "TABLE DATA $schema " "$f.toc")
    [ "$n_td" -gt 0 ] || { echo "FALHOU (backup): $schema com 0 TABLE DATA no dump"; return 1; }
    echo "OK (backup $schema): $f ($(du -h "$f" | cut -f1); $n_td tabelas com dados)"
  done
}
backup_copia() {  # uso: backup_copia rótulo — pg_dump -Fc da CÓPIA inteira (supabase_admin, dentro do container)
  local f; mkdir -p "$BK" || return 1
  f="$BK/pre-sku-previa-$1-$(date +%F-%H%M%S).dump"
  docker exec -e PGPASSWORD=postgres "$CONTAINER" pg_dump -h 127.0.0.1 -U supabase_admin -d postgres -Fc > "$f" && [ -s "$f" ] \
    || { echo "PARE: backup da cópia falhou"; rm -f "$f"; return 1; }
  echo "backup da cópia: $f ($(du -h "$f" | cut -f1))"
}
# ── Cadeia da referência da VOLTA DE EMERGÊNCIA da F1 (descobrir a MAIS NOVA, sem cravar nome; PARAR se não bater) ──
ref_mais_nova() {  # imprime a referência MAIS NOVA (mtime) — nunca a desta frente
  local r; r=$(ls -t "$BF1"/fidelidade_ref_volta_f1_*_detalhe.txt 2>/dev/null | grep -v '_pos_sku_previa_detalhe[.]txt$' | head -1)
  [ -n "$r" ] && [ -s "$r" ] || { echo "PARE: nenhuma fidelidade_ref_volta_f1_*_detalhe.txt em $BF1" >&2; return 1; }
  printf '%s\n' "$r"
}
chaves_f1() {  # $1 = saída: chaves que a F1 mudou (retrato pré-F1 × pós-F1 de PRODUÇÃO, 24/set)
  local pre="$BF1/fidelidade_prod_pre_detalhe.txt" pos="$BF1/fidelidade_prod_pos_detalhe.txt"
  [ -s "$pre" ] && [ -s "$pos" ] || { echo "PARE: faltam $pre e/ou $pos (retratos da F1)"; return 1; }
  comm -3 <(LC_ALL=C sort "$pre") <(LC_ALL=C sort "$pos") | awk -F'=' '{ k = $1; sub(/^\t/, "", k); print k }' | LC_ALL=C sort -u > "$1"
  [ -s "$1" ] || { echo "PARE: nenhuma chave da F1 (retratos iguais?)"; return 1; }
}
fora_f1_e_previa() {  # $1 = chaves da F1, $2 = retrato → linhas FORA da F1 e desta frente, ordenadas
  awk -F'=' -v pat="$PAT_PREVIA" 'NR == FNR { k[$1] = 1; next } !($1 in k) && !($1 ~ pat)' "$1" "$2" | LC_ALL=C sort
}
retrato_producao() {  # $1 = URL, $2 = saída — FIDEL_DET do bloco da F1 (SÓ LEITURA; o bloco dá cd — por isso a subshell)
  ( source "$BF1/bloco_apoio_v2.sh" > /dev/null || exit 1
    le "$1" "$FIDEL_DET" ) > "$2" || { echo "FALHOU: não li o retrato de fidelidade"; return 1; }
  [ -s "$2" ] || { echo "FALHOU: retrato de fidelidade vazio"; return 1; }
}
confere_cadeia_ref() {  # $1 = retrato de produção AGORA → a referência mais nova bate com ele FORA da F1 e desta frente
  local r kf1 dif
  r=$(ref_mais_nova) || return 1
  kf1="$(mktemp -t previa-kf1.XXXXXX)"
  chaves_f1 "$kf1" || { rm -f "$kf1"; return 1; }
  dif=$(diff <(fora_f1_e_previa "$kf1" "$r") <(fora_f1_e_previa "$kf1" "$1") | grep -E '^[<>]' || true)
  rm -f "$kf1"
  if [ -n "$dif" ]; then
    printf '%s\n' "$dif" | cut -c1-160 | head -20
    echo "PARE: a referência mais nova ($(basename "$r")) NÃO bate com a produção fora da F1 e desta frente — outra frente mudou o banco sem gravar a referência dela. Avisar o controlador."
    return 1
  fi
  echo "OK (cadeia da volta da F1): a referência mais nova ($(basename "$r")) bate com a produção fora da F1 e desta frente"
}
prevoo_previa() {  # uso: prevoo_previa URL RETRATO_ATUAL — SÓ LEITURA
  echo "== pré-voo do SKU em prévia — só leitura $(date '+%F %T')"
  git ls-files --error-unmatch "$MIG" "$INV" > /dev/null 2>&1 || { echo "FALHOU (arquivos): SQL não commitado"; return 1; }
  git diff --quiet HEAD -- "$MIG" "$INV" || { echo "FALHOU (arquivos): alteração não commitada no SQL"; return 1; }
  confere_md5_sql_revisado || return 1
  confere_arquivos_previa || return 1
  espera "$1" "select current_setting('server_version_num')::int >= 170000 and exists (select 1 from pg_settings where name = 'transaction_timeout')" "t" "PG >= 17 com transaction_timeout" &&
  espera "$1" "$F1_OK" "t" "F1 (kanban automático) no banco" &&
  espera "$1" "$REORG_OK" "t" "SKU (F3.5a) e reorganização do Sheet (20261005100000) no banco" &&
  espera "$1" "$OBJ_PREVIA" "0" "funções novas desta frente ainda NÃO existem" &&
  espera "$1" "$MD5_REDEF" "$(md5_de "$M/md5-redef-antes.txt")" "as 3 do SKU no texto que a guarda espera" &&
  confere_cadeia_ref "$2" &&
  ativ_vazio "$1" &&
  echo "== PRÉ-VOO OK $(date '+%T')"
}
confere_ida_previa() {  # uso: confere_ida_previa URL CONT_ANTES FN_PRE_ANTES
  local f="${2%|*}" g="${2#*|}"
  espera "$1" "$OBJ_PREVIA" "9" "IDA: as 9 funções novas" &&
  espera "$1" "$MD5_REDEF" "$(md5_de "$M/md5-redef-depois.txt")" "IDA: as 3 do SKU no texto desta migration" &&
  espera "$1" "$MD5_NOVAS" "$(md5_de "$M/md5-novas-depois.txt")" "IDA: as 9 novas no texto desta migration" &&
  espera "$1" "$ACL_PREVIA" "0|0|2" "IDA: ACL (#9) — internas fechadas; RPCs só authenticated" &&
  espera "$1" "$FN_PRE" "$3" "IDA: nenhuma outra função mudou" &&
  espera "$1" "$CONT" "$((f + 9))|$g" "IDA: contagens = antes + 9 funções, + 0 gatilhos"
}
confere_volta_previa() {  # uso: confere_volta_previa URL CONT_ANTES_DA_VOLTA FN_PRE_ANTES_DA_VOLTA (lidos NA HORA)
  local f="${2%|*}" g="${2#*|}"
  espera "$1" "$OBJ_PREVIA" "0" "VOLTA: as 9 funções novas saíram" &&
  espera "$1" "$MD5_REDEF" "$(md5_de "$M/md5-redef-antes.txt")" "VOLTA: as 3 do SKU de volta ao texto de antes" &&
  espera "$1" "$ACL_PREVIA" "0|0|0" "VOLTA: ACL (#9) das 3" &&
  espera "$1" "$FN_PRE" "$3" "VOLTA: nenhuma outra função mudou" &&
  espera "$1" "$CONT" "$((f - 9))|$g" "VOLTA: contagens = antes − 9 funções"
}
```

- [ ] **Step 2: `monta-aplica.sh` e gerar o `aplica.sh`**

```bash
#!/usr/bin/env bash
# Gera .superpowers/sku-previa/mig/aplica.sh = ATIV + espera/ativ_vazio/com_travas/aplica_v2 LITERAIS do bloco de apoio v2 da F1
# (runbook task-18-runbook-v2.md §3, extraídos por awk, hash c045cc571caf5d95 — o mesmo de Nota/SKU/reorg) + extra.sh desta frente.
set -euo pipefail
TOP="$(git rev-parse --show-toplevel)"
case "$TOP" in */.claude/worktrees/sku-previa) ;; *) echo "PARE: rode de dentro da worktree sku-previa"; exit 1;; esac
cd "$TOP"
RB="/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-22-kanban-automatico-f1-banco/task-18-runbook-v2.md"
FUN="$(awk '/^# === BLOCO DE APOIO v2 ===/{p=1} p{print} /^# === FIM DO BLOCO DE APOIO v2 ===/{p=0}' "$RB" \
  | awk '/^ATIV="/{print; next} /^(espera|ativ_vazio|com_travas|aplica_v2)\(\) *\{/{f=1} f{print} f&&/^\}$/{f=0}')"
[ "$(printf '%s\n' "$FUN" | shasum -a 256 | cut -c1-16)" = "c045cc571caf5d95" ] || { echo "PARE: o bloco de apoio v2 da F1 mudou (hash) — reler antes de usar"; exit 1; }
{
  echo '#!/usr/bin/env bash'
  echo '# GERADO por monta-aplica.sh (bloco literal da F1 + extra.sh). Não editar — editar extra.sh e regerar.'
  echo '# Uso: num BASH, de dentro da worktree: source .superpowers/sku-previa/mig/aplica.sh (só define coisas).'
  echo '[ -n "${BASH_VERSION:-}" ] || { echo "ERRO: use bash"; return 1 2>/dev/null || exit 1; }'
  echo 'LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"'
  echo 'MIG=supabase/migrations/20261005110000_sku_previa_regerar.sql'
  echo 'INV=supabase/rollback/20261005110000_sku_previa_regerar_down.sql'
  printf '%s\n' "$FUN"
  cat .superpowers/sku-previa/mig/extra.sh
} > .superpowers/sku-previa/mig/aplica.sh
bash -n .superpowers/sku-previa/mig/aplica.sh && echo "aplica.sh gerado (bloco F1 c045cc571caf5d95 + extra.sh)"
```

```bash
bash .superpowers/sku-previa/mig/monta-aplica.sh
( source .superpowers/sku-previa/mig/aplica.sh && le "$LOCAL" "$OBJ_PREVIA" && le "$LOCAL" "$MD5_REDEF" && le "$LOCAL" "$ACL_PREVIA" && le "$LOCAL" "$CONT" )
```
Expected: `aplica.sh gerado …`; depois `0`, `56c3c480…|f77fddb7…|5f523d3d…`, `0|0|0`, `484|277` (só leitura, na cópia).

- [ ] **Step 3: `copia.sh` (ida/volta da frente na CÓPIA — usado no merge, Task 6)**

```bash
#!/usr/bin/env bash
# SKU em prévia na CÓPIA LOCAL (127.0.0.1:54422). NUNCA produção. Uso (de dentro da worktree, depois do aviso N3 no painel):
#   PREVIA_DONO_AVISADO=sim bash .superpowers/sku-previa/copia.sh ida|volta
# ida: backup pg_dump -Fc da cópia → aplica_v2 → conferência. volta: backup → inverso → conferência por DIFERENÇA (lida NA HORA).
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/sku-previa) ;; *) echo "PARE: rode de dentro da worktree sku-previa"; exit 1;; esac
cd "$TOP"
source .superpowers/sku-previa/mig/aplica.sh || exit 1
REG=.superpowers/sku-previa/copia-estado.md
case "${1:-}" in ida|volta) ;; *) echo "uso: copia.sh ida|volta"; exit 2;; esac
echo "== CÓPIA · alvo: 127.0.0.1:54422 · HEAD $(git rev-parse --short HEAD) · $1"
bash .superpowers/sku-previa/n3.sh antes "copia-$1" || exit 1
EST=$(le "$LOCAL" "$OBJ_PREVIA") || exit 1
ANTES=$(le "$LOCAL" "$CONT") || exit 1
FN0=$(le "$LOCAL" "$FN_PRE") || exit 1
echo "antes: funções|gatilhos = $ANTES · funções novas desta frente = $EST de 9"
if [ "$1" = ida ]; then
  [ "$EST" = 0 ] || { echo "a cópia JÁ tem a frente ($EST de 9) — nada a fazer"; bash .superpowers/sku-previa/n3.sh depois "copia-$1"; exit 0; }
  espera "$LOCAL" "$MD5_REDEF" "$(md5_de "$M/md5-redef-antes.txt")" "as 3 do SKU no texto que a guarda espera" || exit 1
  confere_md5_sql_revisado || exit 1
  confere_arquivos_previa || exit 1
  backup_copia ida || exit 1
  ativ_vazio "$LOCAL" && aplica_v2 "$LOCAL" "$MIG" && confere_ida_previa "$LOCAL" "$ANTES" "$FN0" || exit 1
else
  [ "$EST" = 9 ] || { echo "a cópia NÃO tem a frente inteira ($EST de 9) — PARE e avise o controlador"; exit 1; }
  backup_copia volta || exit 1
  ativ_vazio "$LOCAL" && aplica_v2 "$LOCAL" "$INV" && confere_volta_previa "$LOCAL" "$ANTES" "$FN0" || exit 1
fi
psql "$LOCAL" -X -q -c "NOTIFY pgrst, 'reload schema'"
DEPOIS=$(le "$LOCAL" "$CONT")
printf -- '- %s  %s  %s → %s\n' "$(date '+%F %T')" "$1" "$ANTES" "$DEPOIS" >> "$REG"
bash .superpowers/sku-previa/n3.sh depois "copia-$1"
echo "== CÓPIA: $1 OK ($ANTES → $DEPOIS)"
```

- [ ] **Step 4: `ensaio-local.sh` (ensaio geral na cópia)**

```bash
#!/usr/bin/env bash
# ENSAIO GERAL do SKU em prévia na CÓPIA LOCAL (Task 4): N3 → backup → vizinhas antes → IDA real (tempo MEDIDO) → conferências →
# suíte desta frente com a migration VIVA → vizinhas depois (nenhuma falha nova, mesmo total) + a vizinha da reorganização com
# SHEET_MIG_TXN=1 (exercita o ramo LIFO — P8) → VOLTA (tempo) → REIDA → VOLTA. Termina com a cópia SEM a frente, igual a antes,
# e grava o md5 dos 2 SQL ENSAIADOS (o pré-voo de produção os exige). Uso (de dentro da worktree, depois do aviso N3 — P-30 B):
#   PREVIA_DONO_AVISADO=sim /bin/bash .superpowers/sku-previa/mig/ensaio-local.sh 2>&1 | tee .superpowers/sku-previa/logs/ensaio.log
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/sku-previa) ;; *) echo "PARE: rode de dentro da worktree sku-previa"; exit 1;; esac
cd "$TOP"
source .superpowers/sku-previa/mig/aplica.sh || exit 1
S=.superpowers/sku-previa
echo "== ENSAIO · alvo: 127.0.0.1:54422 (cópia) · HEAD $(git rev-parse --short HEAD)"
bash "$S/n3.sh" antes ensaio || exit 1
git diff --quiet HEAD -- "$MIG" "$INV" || { echo "PARE: SQL com alteração não commitada"; exit 1; }
espera "$LOCAL" "$OBJ_PREVIA" "0" "cópia SEM a frente" || exit 1
espera "$LOCAL" "$MD5_REDEF" "$(md5_de "$M/md5-redef-antes.txt")" "as 3 do SKU no texto que a guarda espera" || exit 1
confere_arquivos_previa || exit 1
ativ_vazio "$LOCAL" || exit 1
CONT0="$(le "$LOCAL" "$CONT")"; FN0="$(le "$LOCAL" "$FN_PRE")"
echo "antes: contagens $CONT0 · outras funções $FN0" | tee "$S/logs/ensaio-antes.txt"
backup_copia ensaio || exit 1
# Vizinhas = as suítes que tocam o SKU. SEMPRE com o DATABASE_URL da CÓPIA (sem ele o fallback é PRODUÇÃO).
VIZ="tests/integration/sku-automatico.test.ts tests/integration/sheet-reorg-campos.test.ts"
falhas() { grep -E "^ FAIL " "$1" | sed -E 's/ +[0-9]+ms$//' | sort -u; }
total() { grep -E "^ +Tests +" "$1" | tail -1 | sed -E 's/.*\(([0-9]+)\).*/\1/'; }
viz() {
  # shellcheck disable=SC2086 — a lista é LITERAL (sem glob), separada por espaço de propósito
  DATABASE_URL="$LOCAL" npx vitest run --no-file-parallelism $VIZ > "$S/logs/viz-$1.log" 2>&1
  falhas "$S/logs/viz-$1.log" > "$S/logs/viz-falhas-$1.txt"
  echo "VIZINHAS $1: $(grep -E '^ +Tests +' "$S/logs/viz-$1.log" | tail -1 | sed 's/^ *//') · $(wc -l < "$S/logs/viz-falhas-$1.txt" | tr -d ' ') falha(s)"
}
ida() {
  local cv fv t0 t1 rc
  cv="$(le "$LOCAL" "$CONT")"; fv="$(le "$LOCAL" "$FN_PRE")"
  t0=$(date +%s%N)
  ativ_vazio "$LOCAL" && aplica_v2 "$LOCAL" "$MIG" && confere_ida_previa "$LOCAL" "$cv" "$fv"; rc=$?
  t1=$(date +%s%N)
  echo "TEMPO (ida, aplica_v2 c/ travas 500ms/3s): $(( (t1 - t0) / 1000000 )) ms" | tee -a "$S/logs/ensaio-tempos.txt"
  return $rc
}
volta() {
  local cv fv t0 t1 rc
  cv="$(le "$LOCAL" "$CONT")"; fv="$(le "$LOCAL" "$FN_PRE")"
  t0=$(date +%s%N)
  ativ_vazio "$LOCAL" && aplica_v2 "$LOCAL" "$INV" && confere_volta_previa "$LOCAL" "$cv" "$fv"; rc=$?
  t1=$(date +%s%N)
  echo "TEMPO (volta, aplica_v2 c/ travas 500ms/3s): $(( (t1 - t0) / 1000000 )) ms" | tee -a "$S/logs/ensaio-tempos.txt"
  return $rc
}
viz antes
ida || exit 1
DATABASE_URL="$LOCAL" npx vitest run --no-file-parallelism tests/integration/sku-previa.test.ts > "$S/logs/ensaio-suite.log" 2>&1
grep -E "^ +Tests +" "$S/logs/ensaio-suite.log" | tail -1
if grep -qE "^ FAIL " "$S/logs/ensaio-suite.log"; then
  echo "PARE: a suíte desta frente falhou com a migration VIVA (ensaio-suite.log) — a cópia fica COM a frente; avisar e rodar copia.sh volta"; exit 1
fi
viz depois
comm -13 "$S/logs/viz-falhas-antes.txt" "$S/logs/viz-falhas-depois.txt" > "$S/logs/viz-falhas-novas.txt"
[ ! -s "$S/logs/viz-falhas-novas.txt" ] || { cat "$S/logs/viz-falhas-novas.txt"; echo "PARE: falha NOVA nas vizinhas com a frente viva"; exit 1; }
[ "$(total "$S/logs/viz-antes.log")" = "$(total "$S/logs/viz-depois.log")" ] || { echo "PARE: o total de testes das vizinhas mudou"; exit 1; }
# P8 — a vizinha da reorganização em SHEET_MIG_TXN=1 com a prévia VIVA (o inverso da prévia roda na txn, depois a reorg). Congela o
# :5188 por alguns segundos (ALTER em modelos/tenant_config na txn) — dito no aviso N3.
SHEET_MIG_TXN=1 DATABASE_URL="$LOCAL" npx vitest run --no-file-parallelism tests/integration/sheet-reorg-campos.test.ts > "$S/logs/ensaio-reorg-txn.log" 2>&1
grep -E "^ +Tests +" "$S/logs/ensaio-reorg-txn.log" | tail -1
if grep -qE "^ FAIL " "$S/logs/ensaio-reorg-txn.log"; then echo "PARE: sheet-reorg-campos (SHEET_MIG_TXN=1) falhou com a prévia viva — ramo P4"; exit 1; fi
volta || exit 1
ida || exit 1
volta || exit 1
espera "$LOCAL" "$CONT" "$CONT0" "cópia de volta às contagens de antes" && espera "$LOCAL" "$FN_PRE" "$FN0" "cópia com as outras funções de antes" || exit 1
md5_arquivo "$MIG" > "$M/md5-mig.txt"; md5_arquivo "$INV" > "$M/md5-inv.txt"
echo "md5 ENSAIADOS: migration $(cat "$M/md5-mig.txt") · inverso $(cat "$M/md5-inv.txt")"
bash "$S/n3.sh" depois ensaio
echo "== ENSAIO OK"
```

- [ ] **Step 5: `ida-producao.sh` (o DONO roda)**

```bash
#!/usr/bin/env bash
# IDA em PRODUÇÃO do SKU em prévia (migration 20261005110000 — só funções). Quem roda é o DONO, num Terminal NOVO:
#   cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-previa"
#   /bin/bash --noprofile --norc .superpowers/sku-previa/mig/ida-producao.sh 2>&1 | tee -a .superpowers/sku-previa/logs/prod-ida.log
# Ordem: guarda de URL (antes de qualquer psql) → pasta 700 → estado/contagens/outras funções/retrato lidos NA HORA → pré-voo SÓ
# LEITURA (F1, SKU e reorganização no banco; esta frente ausente; as 3 do SKU no texto que a guarda espera; md5 dos SQL = o ensaiado;
# travas; cadeia da volta da F1 íntegra; sem transação longa) → BACKUP public + auth → apply pelo aplica_v2 → conferências →
# contagens depois → reload do PostgREST → "IDA OK". Nunca registra em schema_migrations.
set -uo pipefail
umask 077
unset EXTRA_SQL   # o aplica_v2 injeta "${EXTRA_SQL:-}" na transação: nada de sobra de outro runbook
TOP="$(git rev-parse --show-toplevel)" || { echo "PARE: não achei a raiz do git — nada foi aplicado"; exit 1; }
case "$TOP" in */.claude/worktrees/sku-previa) ;; *) echo "PARE: rode de dentro da worktree sku-previa (achei $TOP)"; exit 1;; esac
cd "$TOP"
source .superpowers/sku-previa/mig/aplica.sh || { echo "PARE: não carreguei aplica.sh — nada foi aplicado"; exit 1; }
confere_url_producao || exit 1
mkdir -p .superpowers/sku-previa/logs "$DS" && chmod 700 "$DS" || { echo "PARE: não criei $DS (700)"; exit 1; }
PROD="$(cat "$DBURL_FILE")"
echo "== IDA do SKU em prévia em PRODUÇÃO $(date '+%F %T') · HEAD $(git rev-parse --short HEAD) · alvo: produção (URL de $DBURL_FILE)"
EST=$(le "$PROD" "$OBJ_PREVIA") || { echo "FALHOU: não conectou em produção"; exit 1; }
[ "$EST" = 0 ] || { echo "PARE: funções desta frente JÁ no banco ($EST de 9) — ida anterior? avisar o controlador (nada foi feito)"; exit 1; }
CONT_ANTES=$(le "$PROD" "$CONT") || { echo "PARE: não li as contagens antes — nada foi aplicado"; exit 1; }
FN_ANTES=$(le "$PROD" "$FN_PRE") || { echo "PARE: não li as outras funções antes — nada foi aplicado"; exit 1; }
echo "$CONT_ANTES" > "$DS/cont-antes-previa.txt"; echo "$FN_ANTES" > "$DS/fn-pre-antes-previa.txt"
echo "contagens antes (funções|gatilhos): $CONT_ANTES"
retrato_producao "$PROD" "$DS/fidelidade_prod_pre_previa_detalhe.txt" || { echo "PARE: não li o retrato de fidelidade — nada foi aplicado"; exit 1; }
prevoo_previa "$PROD" "$DS/fidelidade_prod_pre_previa_detalhe.txt" || { echo "== PAROU no pré-voo — nada foi aplicado"; exit 1; }
backup_banco "$PROD" "$DS" producao-pre-previa || { echo "== PAROU no backup — nada foi aplicado"; exit 1; }
ativ_vazio "$PROD" && espera "$PROD" "$OBJ_PREVIA" "0" "ainda ausente logo antes do apply" && aplica_v2 "$PROD" "$MIG" \
  || { echo "== IDA NÃO CONCLUÍDA (erro no apply = nada do arquivo ficou) — avisar o controlador"; exit 1; }
confere_ida_previa "$PROD" "$CONT_ANTES" "$FN_ANTES" \
  || { echo "== FALHOU NA CONFERÊNCIA DEPOIS DO APPLY — a migration FOI aplicada; NÃO rode a volta sem o controlador; mande o log"; exit 1; }
le "$PROD" "$CONT" > "$DS/cont-depois-previa.txt" \
  || { echo "== FALHOU NA CONFERÊNCIA DEPOIS DO APPLY — a migration FOI aplicada; NÃO rode a volta sem o controlador; mande o log"; exit 1; }
psql "$PROD" -X -q -v ON_ERROR_STOP=1 -c "NOTIFY pgrst, 'reload schema'" \
  || { echo "== APLICADA, mas o reload do PostgREST falhou — rodar NOTIFY pgrst, 'reload schema' e avisar o controlador"; exit 1; }
echo "== IDA OK $(date '+%T') — contagens $CONT_ANTES → $(cat "$DS/cont-depois-previa.txt"). Agora o Passo 2 do RODAR (ref-volta-f1.sh)."
```

- [ ] **Step 6: `volta-producao.sh` (SÓ emergência, com OK do dono)**

```bash
#!/usr/bin/env bash
# VOLTA em PRODUÇÃO do SKU em prévia — SÓ em emergência, com OK explícito do dono, DEPOIS de tirar do ar o front que chama
# skus_previa/aplicar_skus_modelo (revert do front NO AR + abas recarregadas, inclusive o :5173). NÃO apaga dado (os SKUs gravados
# ficam). O DONO roda:
#   cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-previa"
#   /bin/bash --noprofile --norc .superpowers/sku-previa/mig/volta-producao.sh 2>&1 | tee -a .superpowers/sku-previa/logs/prod-volta.log
set -uo pipefail
umask 077
unset EXTRA_SQL
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/sku-previa) ;; *) echo "PARE: rode de dentro da worktree sku-previa (achei $TOP)"; exit 1;; esac
cd "$TOP"
source .superpowers/sku-previa/mig/aplica.sh || exit 1
confere_url_producao || exit 1
PROD="$(cat "$DBURL_FILE")"
echo "== VOLTA do SKU em prévia em PRODUÇÃO $(date '+%F %T') · HEAD $(git rev-parse --short HEAD)"
EST=$(le "$PROD" "$OBJ_PREVIA") || { echo "FALHOU: não conectou em produção"; exit 1; }
[ "$EST" = 9 ] || { echo "PARE: a frente não está inteira em produção ($EST de 9) — avisar o controlador"; exit 1; }
# P6 — o INVERSO conferido ANTES da frase por md5 FIXO (cravado no Step 8 depois do ensaio), commitado e com as travas certas.
[ "$(md5_arquivo "$INV")" = __MD5_INV__ ] && git diff --quiet HEAD -- "$INV" && confere_arquivos_previa \
  || { echo "PARE: o inverso no disco não é o revisado/ensaiado (md5/commit/travas) — nada foi feito"; exit 1; }
printf 'Isto tira as 9 funções da prévia e devolve o Regerar/SKU à mão imediatos (os SKUs gravados FICAM). O front novo tem de estar FORA do ar. Digite VOLTAR A PREVIA DOS SKUS para seguir: '
IFS= read -r RESP < /dev/tty || RESP=""
[ "$RESP" = "VOLTAR A PREVIA DOS SKUS" ] || { echo "cancelado — nada foi feito"; exit 1; }
backup_banco "$PROD" "$DS" producao-pre-volta-previa || { echo "== PAROU no backup — nada foi desfeito"; exit 1; }
CONT_ANTES_VOLTA=$(le "$PROD" "$CONT") || { echo "PARE: não li as contagens antes da volta — nada foi desfeito"; exit 1; }
FN_ANTES_VOLTA=$(le "$PROD" "$FN_PRE") || { echo "PARE: não li as outras funções antes da volta — nada foi desfeito"; exit 1; }
echo "contagens imediatamente antes da volta: $CONT_ANTES_VOLTA"
if ativ_vazio "$PROD" && aplica_v2 "$PROD" "$INV" && confere_volta_previa "$PROD" "$CONT_ANTES_VOLTA" "$FN_ANTES_VOLTA" \
  && psql "$PROD" -X -q -c "NOTIFY pgrst, 'reload schema'"; then
  CARIMBO="$(date +%F-%H%M%S)"
  for ARQ in "$BF1/fidelidade_ref_volta_f1_pos_sku_previa_detalhe.txt" "$BF1/cont_volta_f1_pos_sku_previa.txt"; do
    [ -e "$ARQ" ] && { mv "$ARQ" "${ARQ}.desfeita-${CARIMBO}" && echo "renomeado (a referência pos_sku_previa deixou de valer): ${ARQ}.desfeita-${CARIMBO}"; }
  done
  for RESIDUO in "$RB/VOLTA-F1-POS-SKU-PREVIA.md" "$DS/LEIA-volta-f1-pos-sku-previa.txt"; do
    [ -e "$RESIDUO" ] && printf '\nDESFEITA em %s — esta referência não vale mais.\n' "$(date '+%F %T')" >> "$RESIDUO"
  done
  echo "== VOLTA OK $(date '+%T')"
else
  echo "== VOLTA NÃO CONCLUÍDA — avisar o controlador/dono (conferir até onde chegou: ATIV, inverso, conferência, NOTIFY)"; exit 1
fi
```

- [ ] **Step 7: `ref-volta-f1.sh` (o DONO roda logo depois do "IDA OK"; SÓ LEITURA)**

```bash
#!/usr/bin/env bash
# SKU em PRÉVIA — REGRAVA a referência de fidelidade da VOLTA DE EMERGÊNCIA da F1 logo DEPOIS do "== IDA OK" desta frente (molde
# da reorganização): não crava o nome da anterior; usa a MAIS NOVA por mtime em $BF1 e, ANTES de gravar, prova que (1) desde o
# pré-voo SÓ esta frente mudou o schema, (2) a referência mais nova bate com a produção FORA das chaves da F1 e desta frente,
# (3) a F1 e esta frente não mexem nas mesmas chaves. Nova = a mais nova SEM as 12 chaves desta frente + as ATUAIS delas;
# CONT = base + delta medido (+9|+0). SÓ LEITURA (transação READ ONLY — P7). Roda o DONO:
#   /bin/bash --noprofile --norc .superpowers/sku-previa/mig/ref-volta-f1.sh
set -uo pipefail
umask 077
TOP="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/sku-previa) ;; *) echo "PARE: script fora da worktree sku-previa"; exit 1;; esac
cd "$TOP"
source .superpowers/sku-previa/mig/aplica.sh || exit 1
confere_url_producao || exit 1
PROD="$(cat "$DBURL_FILE")"
REF_NOVA="$BF1/fidelidade_ref_volta_f1_pos_sku_previa_detalhe.txt"
echo "== referência da volta da F1 (pós-SKU em prévia) $(date '+%F %T') · HEAD $(git rev-parse --short HEAD)"
[ ! -e "$REF_NOVA" ] || { echo "PARE: $REF_NOVA já existe — rodou 2×? avisar o controlador"; exit 1; }
[ "$(le "$PROD" "$F1_OK")" = t ] || { echo "PARE: a F1 não está em produção — não há volta da F1 a referenciar"; exit 1; }
[ "$(le "$PROD" "$OBJ_PREVIA")" = 9 ] || { echo "PARE: esta frente não está (inteira) em produção — rode DEPOIS do '== IDA OK'"; exit 1; }
for f in cont-antes-previa.txt cont-depois-previa.txt fidelidade_prod_pre_previa_detalhe.txt; do
  [ -s "$DS/$f" ] || { echo "PARE: falta $DS/$f (gravado pelo ida-producao.sh)"; exit 1; }
done
R=$(ref_mais_nova) || exit 1
echo "base = referência mais nova: $(basename "$R")"
if grep -qE '^funcoes:public[.](_skus_plano|skus_previa|aplicar_skus_modelo|_skus_assinatura)[(]' "$R"; then
  echo "PARE: a base já tem funções desta frente — ordem trocada ou rodou 2×"; exit 1
fi
POS="$DS/fidelidade_prod_pos_previa_detalhe.txt"
retrato_producao "$PROD" "$POS" || exit 1
OUTRAS=$(diff <(awk -F'=' -v pat="$PAT_PREVIA" '!($1 ~ pat)' "$DS/fidelidade_prod_pre_previa_detalhe.txt" | LC_ALL=C sort) \
              <(awk -F'=' -v pat="$PAT_PREVIA" '!($1 ~ pat)' "$POS" | LC_ALL=C sort) | grep -E '^[<>]' || true)
[ -z "$OUTRAS" ] || { printf '%s\n' "$OUTRAS" | cut -c1-160 | head -20; echo "PARE: desde o pré-voo o schema mudou FORA desta frente — avisar o controlador"; exit 1; }
confere_cadeia_ref "$POS" || exit 1
KF1="$(mktemp -t previa-kf1.XXXXXX)"; chaves_f1 "$KF1" || { rm -f "$KF1"; exit 1; }
CRUZ=$(grep -E "$PAT_PREVIA" "$KF1" || true); rm -f "$KF1"
[ -z "$CRUZ" ] || { echo "$CRUZ"; echo "PARE: chaves desta frente também mudadas pela F1 — avisar o controlador"; exit 1; }
N=$(awk -F'=' -v pat="$PAT_PREVIA" '$1 ~ pat' "$POS" | grep -c .)
[ "$N" = 12 ] || { echo "PARE: esperava 12 linhas desta frente no retrato (3 redefinidas + 9 novas), achei $N"; exit 1; }
{ awk -F'=' -v pat="$PAT_PREVIA" '!($1 ~ pat)' "$R"; awk -F'=' -v pat="$PAT_PREVIA" '$1 ~ pat' "$POS"; } | LC_ALL=C sort > "$REF_NOVA"
CR="$(grep -c '^funcoes:' "$R")|$(grep -c '^gatilhos:' "$R")"
SUF=$(basename "$R" _detalhe.txt); SUF=${SUF#fidelidade_ref_volta_f1_}
if [ -s "$BF1/cont_volta_f1_${SUF}.txt" ] && [ "$(tr -d '[:space:]' < "$BF1/cont_volta_f1_${SUF}.txt")" != "$CR" ]; then
  rm -f "$REF_NOVA"; echo "PARE: cont_volta_f1_${SUF}.txt ≠ contagem da própria referência ($CR) — avisar o controlador"; exit 1
fi
A=$(tr -d '[:space:]' < "$DS/cont-antes-previa.txt"); P=$(tr -d '[:space:]' < "$DS/cont-depois-previa.txt")
ESP="$(( ${CR%|*} + ${P%|*} - ${A%|*} ))|$(( ${CR#*|} + ${P#*|} - ${A#*|} ))"
CV="$(grep -c '^funcoes:' "$REF_NOVA")|$(grep -c '^gatilhos:' "$REF_NOVA")"
[ "$CV" = "$ESP" ] || { rm -f "$REF_NOVA"; echo "PARE: CONT da referência nova ($CV) ≠ base ($CR) + delta medido ($A → $P) = $ESP"; exit 1; }
echo "$CV" > "$BF1/cont_volta_f1_pos_sku_previa.txt"
{
  echo "# Volta de emergência da F1 DEPOIS do SKU em prévia (20261005110000) — $(date '+%F %T')"
  echo "# Base: $(basename "$R") (a mais nova quando esta rodou). No runbook v2 §9.2 trocar as 2 conferências finais por:"
  echo "espera \"\$PROD\" \"\$CONT\" \"$CV\" \"contagens pós-volta (com as frentes até o SKU em prévia)\" &&"
  echo "fidelidade \"\$PROD\" \"\$D/fidelidade_prod_pos_volta.txt\" \"\$D/fidelidade_prod_pos_volta_detalhe.txt\" > /dev/null &&"
  echo "diff \"\$D/fidelidade_ref_volta_f1_pos_sku_previa_detalhe.txt\" <(LC_ALL=C sort \"\$D/fidelidade_prod_pos_volta_detalhe.txt\") && echo \"== VOLTA OK (com o SKU em prévia)\""
  echo "# Encadeamento: a PRÓXIMA frente usa ESTA referência como base (é a mais nova por mtime)."
  echo "# Se esta frente for DESFEITA (volta-producao.sh), os 2 arquivos pos_sku_previa são renomeados: a referência volta a ser $(basename "$R")."
} | tee "$DS/LEIA-volta-f1-pos-sku-previa.txt" > "$RB/VOLTA-F1-POS-SKU-PREVIA.md"
echo "OK (referência nova p/ a volta da F1): $REF_NOVA — base $(basename "$R") sem as 12 chaves desta frente + as atuais; CONT esperado da volta: $CV"
```

- [ ] **Step 8: Ensaio na cópia (N3) e o md5 do inverso CRAVADO na volta (P6)**

O CONTROLADOR publica o aviso no painel: "Vou rodar o ensaio do SKU em prévia na cópia local agora (~5 min): ida, suíte, volta,
ida, volta. A migration só troca funções; a suíte da reorganização com SHEET_MIG_TXN=1 faz ALTER em modelos/tenant_config
dentro da transação — o :5188 congela por alguns segundos nesse trecho."

```bash
chmod +x .superpowers/sku-previa/mig/*.sh .superpowers/sku-previa/copia.sh
for f in .superpowers/sku-previa/mig/{ensaio-local,ida-producao,volta-producao,ref-volta-f1,monta-aplica}.sh .superpowers/sku-previa/copia.sh; do bash -n "$f" || echo "SINTAXE: $f"; done
PREVIA_DONO_AVISADO=sim /bin/bash .superpowers/sku-previa/mig/ensaio-local.sh 2>&1 | tee .superpowers/sku-previa/logs/ensaio.log
sed -i '' "s/__MD5_INV__/$(tr -d '[:space:]' < .superpowers/sku-previa/mig/md5-inv.txt)/" .superpowers/sku-previa/mig/volta-producao.sh
grep -c '__MD5_INV__' .superpowers/sku-previa/mig/volta-producao.sh; grep -n "md5_arquivo \"\$INV\")\" = " .superpowers/sku-previa/mig/volta-producao.sh
```
Expected:
- nenhuma linha `SINTAXE:`;
- o `ensaio.log` termina em `== ENSAIO OK`, com:
  - 2 `TEMPO (ida…)` e 2 `TEMPO (volta…)` (esperado < 1 s cada — só funções);
  - `VIZINHAS antes`/`depois` com o MESMO total e 0 falha nova;
  - `ensaio-suite.log` sem `FAIL`;
  - `ensaio-reorg-txn.log` sem `FAIL`;
  - contagens `484|277` no fim;
- o `grep -c` dá `0` e a linha do `grep -n` mostra o md5 de 32 hex no lugar.

`PARE:` ⇒ ler a mensagem. Se a cópia ficou COM a frente, avisar o dono e rodar `copia.sh volta` só com o OK do controlador.
NUNCA regerar o SQL depois do ensaio sem refazer o ensaio.

- [ ] **Step 9: `prova-scripts.sh` — provas SEM banco (`psql`/`docker` falsos, URL sintética, pastas no scratch)**

Partir do molde (`.superpowers/sku-previa/molde/prova-scripts.sh`), com estas trocas e casos.

Trocas:
- worktree `sku-previa`;
- `M=.superpowers/sku-previa/mig`;
- `SHEET_*` → `PREVIA_*` (`PREVIA_DBURL_FILE`, `PREVIA_DS`, `PREVIA_BF1`, `PREVIA_RB`, `PREVIA_PROVA_SC`);
- scratch `mktemp -d -t previa-prova.XXXXXX` com `trap 'rm -rf "$SC"' EXIT` (só o scratch que ela criou).

O `psql` falso:
1. **Várias `-c`:** ignora `begin transaction read only` e `rollback` e responde pela OUTRA `-c`:
   ```bash
   while [ $# -gt 0 ]; do case "$1" in
     -c) case "$2" in "begin transaction read only"|rollback) ;; *) sql="$2";; esac; shift 2;;
     -o) saida="$2"; shift 2;; *) shift;; esac; done
   ```
2. **Registro:** grava `sql` (1ª linha, 400 caracteres) em `$SC/seq.log` com número de sequência e registra o
   `PGCLIENTENCODING` de cada chamada.
3. **Respostas por trecho do texto** (estado `antes`|`depois` em `$SC/estado`):
   ```bash
   case "$sql" in
     *"DROP FUNCTION IF EXISTS public.skus_previa"*) echo antes > "$SC/estado"; printf 'INVERSO\n' >> "$SC/psql.log"; exit 0;;
     *"CREATE OR REPLACE FUNCTION public._skus_plano"*) echo depois > "$SC/estado"; printf 'APPLY\n' >> "$SC/psql.log"; exit 0;;
     *"NOTIFY pgrst"*) exit 0;;
     *"SELECT cat || ':' || k || '=' || v"*) cat "$SC/retrato-$est.txt"; exit 0;;       # FIDEL_DET (texto do bloco da F1)
     *"pg_stat_activity"*) r "${FAKE_ATIV:-0}";;
     *"server_version_num"*) r t;;
     *"kanban_mover"*) r t;;
     *"_titulo_pagina_calculado"*) r t;;                                               # REORG_OK
     *"to_regprocedure(f.x) is not null"*) if [ "$est" = antes ]; then r "${FAKE_OBJ_ANTES:-0}"; else r 9; fi;;   # OBJ_PREVIA
     *"has_function_privilege"*) if [ "$est" = antes ]; then r "0|0|0"; else r "0|0|2"; fi;;                     # ACL_PREVIA
     *"string_agg(p.oid::regprocedure::text"*) r "fnpre-prova|475";;                                              # FN_PRE
     *"_gerar_skus_modelo_core(uuid,boolean)']) with ordinality"*)
       if [ "$est" = antes ]; then r "$(cat "$SC/md5-redef-antes")"; else r "$(cat "$SC/md5-redef-depois")"; fi;;  # MD5_REDEF
     *"public.aplicar_skus_modelo(uuid,jsonb,text,text)']) with ordinality"*) r "$(cat "$SC/md5-novas-depois")";; # MD5_NOVAS
     *"from pg_trigger t join pg_class c"*) if [ "$est" = antes ]; then r "484|277"; else r "493|277"; fi;;       # CONT
     *) echo "psql falso: consulta não prevista: $(printf '%s' "$sql" | cut -c1-100)" >&2; exit 3;;
   esac
   ```
   A ORDEM dos `case` acima importa: o `FN_PRE` e o `ACL_PREVIA` também citam as 12 funções, por isso vêm ANTES dos md5.
   Cada consulta nova de um script entra aqui com o seu próprio trecho.
4. **Retratos:** usar a cadeia REAL só LIDA:
   - `retrato-antes.txt` = cópia de `$BF1_REAL/<ref mais nova>`;
   - `retrato-depois.txt` = a mesma com as 12 linhas `funcoes:public.<nome desta frente>(…)=<x>` acrescentadas/trocadas.

O `docker` falso fica igual ao do molde (`ps`, `exec pg_dump` → "FAKEDUMP", `exec pg_restore -l` → 1 TABLE DATA de `public` e
1 de `auth`).

Provas obrigatórias (cada uma imprime `OK (prova): …` ou `FALHOU (prova): …`; no fim `== PROVAS OK` só com 0 falha):
1. regex da URL: aceita host direto e pooler do ref; recusa localhost, ref no path/query, outro ref;
2. `bash -n` nos 6 scripts;
3. ida sem `$PREVIA_DBURL_FILE` ⇒ `PARE` ANTES de qualquer `psql` (seq.log vazio);
4. ida com `FAKE_OBJ_ANTES=3` ⇒ `PARE: funções desta frente JÁ no banco` e 0 docker;
5. ida com o md5 das 3 ≠ o esperado ⇒ PARA no pré-voo, 0 docker, 0 APPLY;
6. ida com `md5-mig.txt` adulterado ⇒ `FALHOU (pré-voo): … ≠ o ensaiado`;
7. ida com `FAKE_ATIV=1` ⇒ PARA (ativ), 0 APPLY;
8. ida com o `docker` falhando ⇒ `PAROU no backup`, 0 APPLY;
9. ida feliz ⇒ ordem no `seq.log`: leituras → retrato → pré-voo → DOCKER (public, auth) → APPLY → conferências → NOTIFY;
   `== IDA OK`; `PGCLIENTENCODING=UTF8` em TODAS as chamadas; `umask 077` (arquivos 600 em `$PREVIA_DS`); `EXTRA_SQL`
   vazio no apply;
10. ida com a conferência falhando depois do APPLY (`FAKE_CONT_POS_FALHA=sim`) ⇒ mensagem "a migration FOI aplicada";
11. volta com o inverso adulterado (md5) ⇒ `PARE … não é o revisado` ANTES da frase, 0 docker;
12. volta sem a frase (sem terminal) ⇒ `cancelado — nada foi feito`, 0 docker, 0 INVERSO;
13. volta feliz (com `script -q /dev/null` como pty, respondendo a frase) ⇒ backup → INVERSO → conferência → NOTIFY →
    `== VOLTA OK` + os 2 arquivos `pos_sku_previa` renomeados `.desfeita-…`;
14. ref-volta-f1:
    - rodar 2× ⇒ `PARE … já existe`;
    - base com funções da frente ⇒ `PARE`;
    - schema mudado fora ⇒ `PARE`;
    - feliz ⇒ referência nova = base − 12 chaves + as atuais, `N=12`, CONT = base + `9|0`, toda leitura com `begin
      transaction read only`;
15. nenhuma prova tocou o `/tmp/dburl.txt` real, host real, `$BF1` real (o `ls -l` antes = depois) nem `$DS` real.

```bash
bash .superpowers/sku-previa/mig/prova-scripts.sh 2>&1 | tee .superpowers/sku-previa/logs/prova-scripts.log | tail -5
shasum -a 256 .superpowers/sku-previa/mig/{aplica,ida-producao,volta-producao,ref-volta-f1}.sh
```
Expected: `== PROVAS OK` e 0 `FALHOU (prova)`; as 4 sha256 vão para o RODAR (Step 10). `FALHOU (prova)` ⇒ corrigir o SCRIPT
(nunca a prova); se foi o `extra.sh`, regerar o `aplica.sh` (Step 2); repetir.

- [ ] **Step 10: `RODAR-sku-previa.md` (roteiro do dono) em `/Users/sunglee/PLM + Criação/savepoints/pre-apply-sku-previa/` (pasta 700)**

```bash
D="/Users/sunglee/PLM + Criação/savepoints/pre-apply-sku-previa"; mkdir -p "$D" && chmod 700 "$D"
```

Conteúdo (trocar `<…>` pelos valores MEDIDOS nos Steps 8–9):

```markdown
# RODAR — SKU em prévia (migration 20261005110000) em PRODUÇÃO

Quem roda: você, num Terminal NOVO. Tempo: menos de 1 minuto (no ensaio: ida <N> ms, volta <N> ms).
A migration SÓ troca funções: não trava tabela. O front que está no ar continua funcionando: as RPCs de hoje seguem iguais.

## Antes
1. Conferir as sha256 (têm de ser estas):
   `shasum -a 256 .superpowers/sku-previa/mig/{aplica,ida-producao,volta-producao,ref-volta-f1}.sh`
   aplica <sha> · ida <sha> · volta <sha> · ref-volta-f1 <sha>
2. md5 dos SQL ensaiados: migration <md5-mig> · inverso <md5-inv> (o pré-voo confere sozinho).

## Passo 1 — ida (o backup completo public + auth é feito DENTRO do script, antes de aplicar)
    cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-previa"
    /bin/bash --noprofile --norc .superpowers/sku-previa/mig/ida-producao.sh 2>&1 | tee -a .superpowers/sku-previa/logs/prod-ida.log
Esperado:
- `== PRÉ-VOO OK`;
- 2 `OK (backup …)`;
- `== IDA OK … <antes> → <antes + 9 funções>` (hoje 484|277 → 493|277; se outra frente entrou antes, os números mudam, mas
  a diferença é +9|+0).

Qualquer `PARE`/`FALHOU`: NADA foi aplicado (exceto se a mensagem disser "FOI aplicada"). Mande o log no chat.

## Passo 2 — referência nova da volta de emergência da F1 (SÓ LEITURA)
    /bin/bash --noprofile --norc .superpowers/sku-previa/mig/ref-volta-f1.sh 2>&1 | tee -a .superpowers/sku-previa/logs/prod-ref-volta-f1.log
Esperado: `OK (referência nova p/ a volta da F1): …pos_sku_previa…`.

## Passo 3 — avisar no chat: "SKU prévia: IDA OK e referência OK"
Se logo depois aparecer erro "função não encontrada" (PGRST202) em `skus_previa`, rode no Terminal:
`psql "$(cat /tmp/dburl.txt)" -c "NOTIFY pgrst, 'reload schema'"`.

## Volta de emergência (SÓ com o seu OK explícito)
1. ANTES: tirar do ar o front que chama `skus_previa`/`aplicar_skus_modelo` (revert do deploy/merge) e recarregar as abas,
   inclusive o :5173.
2. `/bin/bash --noprofile --norc .superpowers/sku-previa/mig/volta-producao.sh` → digitar `VOLTAR A PREVIA DOS SKUS`.
3. Não apaga dado: os SKUs gravados ficam.
4. ORDEM (LIFO): esta volta vem ANTES de qualquer volta da reorganização do Sheet ou da F3.5a (as guardas delas recusam se
   esta estiver no banco).
5. Guardar uma cópia deste script e da worktree: a volta só roda de dentro dela. Antes de remover a worktree, copiar
   `.superpowers/sku-previa/` para esta pasta.
```

- [ ] **Step 11: G-scripts — Opus + guardião**

Entregar: os 6 scripts + `copia.sh`, `ensaio.log`, `ensaio-tempos.txt`, `prova-scripts.log` e o RODAR. Checklist:
- guarda de URL ancorada ANTES de qualquer `psql`;
- `umask 077` + `unset EXTRA_SQL` na ida e na volta;
- `PGCLIENTENCODING=UTF8`;
- pasta 700;
- backup `public`+`auth` com TABLE DATA>0 e `pg_restore -l`;
- md5 dos SQL = o ensaiado;
- travas no arquivo; zero DDL de tabela/policy;
- as 3 do SKU conferidas por md5 antes/depois e fora do `FN_PRE`; as 9 novas por `OBJ_PREVIA`/`MD5_NOVAS`;
- ACL `0|0|2`;
- pós-condições ANTES de "IDA OK";
- volta com md5 do inverso cravado + frase + backup, e renomeando a referência `pos_sku_previa`;
- leitura de produção em `begin transaction read only` (P7);
- cadeia da volta da F1 descoberta (sem nome cravado) e conferida no pré-voo E no `ref-volta-f1.sh`;
- nenhuma prova tocou produção nem pasta real.

BLOQUEIA ⇒ corrigir e repetir Steps 8–11.

- [ ] **Step 12: Produção — o DONO, pelo RODAR (o controlador NÃO roda)**

O controlador publica no painel o link do RODAR e a pergunta "pode rodar a ida do SKU em prévia?". O dono roda os Passos 1–2 e
cola os logs. O guardião faz o **G-produção** (lê os logs: `IDA OK`, contagens +9|+0, referência `pos_sku_previa` OK). Qualquer
`PARE` vai ao dono com o log; NUNCA contornar a checagem.

---

## Task 5: Front — "a gravar", prévia, Salvar aguardado e a seção "4. Códigos"

**Files:**
- Modify (reescrita): `src/components/planejamento/planejamento-detail/codigos/useSkusModelo.ts`
- Modify (reescrita): `src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx`
- Modify: `src/components/planejamento/planejamento-detail/codigos/sku-card.ts:172-181` (sai `skuDigitadoParaSalvar` + `AcaoSkuDigitado`)
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (:61, :100-101, :201, :644, :734, :838, :911-916, :1221, :1489-1505)
- Modify: `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts` (:69, :642, :809)
- Test: `tests/unit/planejamento-codigos.test.ts` (atualizar os testes de fonte e tirar os de `skuDigitadoParaSalvar`)

**Interfaces:**
- Consumes (Task 1): tudo de `./sku-previa`. Consumes (Task 2, contrato do banco): RPC `skus_previa(_modelo_id, _ref,
  _tamanho_tipo, _manuais, _modo)`, RPC `aplicar_skus_modelo(_modelo_id, _manuais, _modo, _assinatura)` (P0409 = prévia
  velha), `gerar_skus_modelo`, `skus_modelo` (inalteradas).
- Produces:
  - `useSkusAGravar()` → `{ aGravar, atual(), pedirRegerar(), digitar(l, texto) → {erro, valor}, desfazerManual(chave),
    manterMeu(l), desfazerPrevia(), limparSe(enviado) }`; `type SkusAGravarApi`
  - `useSkusModelo(modeloId, ativo, podeEditar, { refPrevia, tamanhoTipo, aGravar })` → `{ matriz, carregando, erro, temPrevia,
    previa, previaCarregando, previaErro, refazerPrevia(), aplicarAGravar() → "nada"|"ok"|"falhou", gerarSeFaltar() }`;
    `type SkusModelo`
  - `prefixoPrevia(modeloId)` = `["plan-skus-previa", modeloId]`
  - `onSaved: () => void | Promise<void>` em `UsePlanejamentoSaveArgs`

- [ ] **Step 1: Testes de fonte que falham — `tests/unit/planejamento-codigos.test.ts`**

(a) Tirar `skuDigitadoParaSalvar` do import (`:5-6`) e apagar o `describe("skuDigitadoParaSalvar …")` inteiro (`:140-152`): a
regra agora mora em `digitarSku` (Task 1, `tests/unit/sku-previa.test.ts`).

(b) Substituir os 3 `it` de fonte (`:208-261`, "CodigosSecao: REF…", "Rodada 2 — Important…" e "PlanejamentoDetail: seção 3…") por:

```ts
  it("CodigosSecao (SKU em prévia — P-46): REF, 'Tamanho em' (P-25), Regerar SEM AlertDialog e SEM trava de rascunho sujo, aviso de prévia, SKU com data-colab-path", () => {
    const s = fonte("src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx");
    expect(s).toContain('data-colab-path="ref"');
    expect(s).toContain('data-colab-path="tamanho_tipo"');
    expect(s).toContain('type="radio"');
    expect(s).toContain("· nasce em Letra; troque para Número se o produto usa numeração");
    expect(s).not.toContain("Padrão da loja");
    expect(s).not.toMatch(/tamanho_padrao|TAMANHO_PADRAO/);
    expect(s).not.toContain("AvisoCamposDev"); // R29
    expect(s).toContain("rotuloVariante(g, siglasDoGrupo(g, siglas.cores, siglas.apelidos))"); // R11
    expect(s).toContain("colabPath={`sku:${l.variante_key}:${l.tamanho_key}`}");
    expect(s).toContain("ariaLabel={`SKU — ${rotuloVar} · ${rotuloTam}`}");
    expect(s).toContain("Regerar SKUs");
    // P-46 — prévia: nada de gravação imediata, nada de AlertDialog, nada de "salve antes"
    expect(s).not.toMatch(/<AlertDialog\b/);
    expect(s).not.toContain("draftSujoParaRegerar");
    expect(s).not.toContain("Salve o card antes de regerar");
    expect(s).not.toContain("salvarManual");
    expect(s).toContain("podeRegerar({ podeEditar: podeEditarSkus, matriz: skus.matriz, refPrevia, jaPedido: aGravar.aGravar.regerar })");
    expect(s).toContain("onClick={aGravar.pedirRegerar}");
    expect(s).toContain("{TEXTO_PREVIA}");
    expect(s).toContain("Desfazer prévia");
    expect(s).toContain("{TEXTO_BOM_SUJO}");
    expect(s).toContain("manter o meu");
    expect(s).toContain("usar o novo");
    expect(s).toContain('aria-label="Desfazer o SKU digitado"');
    expect(s).toContain("bg-[var(--tone-warning-bg)]");
    expect(s).toContain('m.status === "ok" && m.tamanho_tipo_card !== null && podeEditarSkus');
    expect(s).toContain("SKUs por variante e tamanho");
    expect(s).toContain(
      "As variantes vêm do Tecido 1 (seção Tecidos) e os tamanhos, da Grade. Formato: REF - cor base + apelido + tamanho (Config da Loja › Formato do SKU). 'Regerar SKUs' mostra a prévia e só o Salvar grava; os editados à mão nunca mudam.",
    );
  });
  it("useSkusModelo (SKU em prévia): prévia pela RPC só leitura, gravação só no Salvar pela RPC com assinatura; sem RPC imediata", () => {
    const s = fonte("src/components/planejamento/planejamento-detail/codigos/useSkusModelo.ts");
    expect(s).toContain('supabase.rpc("skus_previa" as any');
    expect(s).toContain('supabase.rpc("aplicar_skus_modelo" as any');
    expect(s).toContain("_assinatura: d.assinatura");
    expect(s).not.toContain("salvar_sku_manual");
    expect(s).not.toContain("_regerar: true"); // o Regerar não grava mais na hora
    expect(s).toContain('_regerar: false'); // a 1ª geração automática pós-Salvar continua (D1)
    expect(s).toContain("placeholderData: keepPreviousData");
    expect(s).toContain("o.aGravar.limparSe(s)");
  });
  it("PlanejamentoDetail: seção 3 = 'Desenvolvimento'; 'Códigos' logo depois; o Salvar grava o modelo, DEPOIS os SKUs em prévia, DEPOIS a 1ª geração", () => {
    const s = fonte("src/components/planejamento/PlanejamentoDetail.tsx");
    const iDev = s.indexOf('<Secao id="desenvolvimento" titulo="Desenvolvimento"');
    const iCod = s.indexOf('<Secao id="codigos" titulo="Códigos"');
    const iProva = s.indexOf('<Secao id="prova"');
    expect(iDev).toBeGreaterThan(0);
    expect(iCod).toBeGreaterThan(iDev);
    expect(iProva).toBeGreaterThan(iCod);
    expect(s).not.toContain("Desenvolvimento — equipe e cronograma");
    expect(s).toMatch(/const aoSalvar = async \(\) => \{[\s\S]*?await skus\.aplicarAGravar\(\)[\s\S]*?await skus\.gerarSeFaltar\(\)/);
    expect(s).toContain("|| !nadaAGravar(skusAGravar.aGravar)"); // "não salvo" inclui a prévia
    expect(s).toContain('qc.invalidateQueries({ queryKey: ["plan-skus", modeloId] });');
    expect(s).toContain('qc.invalidateQueries({ queryKey: ["plan-skus-previa", modeloId] });');
    expect(s).toContain("seloCodigos(skus.matriz, skus.temPrevia)");
    expect(s).toContain("refParaPrevia({ refVaiNoSalvar: refEditavel, refRascunho: draft.ref, refSalva: (modeloData as any)?.ref ?? \"\" })");
    expect(s).not.toContain("refSalva={");
    expect(s).not.toContain("tamanhoTipoSalvo=");
    expect(/<DevEquipeSection[^>]*refVisivel=/.test(s)).toBe(false);
    expect(s).not.toContain("motivoTravaRef"); // R29
  });
  it("usePlanejamentoSave: o onSaved é AGUARDADO (o Salvar fica 'salvando' até os SKUs terminarem)", () => {
    const s = fonte("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    expect(s).toContain("onSaved: () => void | Promise<void>;");
    expect(s).toContain("onSuccess: async (result) => {");
    expect(s).toContain("await onSaved();");
  });
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run tests/unit/planejamento-codigos.test.ts
```
Expected: FAIL nos 4 testes novos (a fonte ainda é a antiga).

- [ ] **Step 3: `useSkusModelo.ts` (arquivo inteiro)**

```ts
// Leitura e ações dos SKUs do card (F3.6 — seção "4. Códigos", F3.5b do SKU). SKU em PRÉVIA (spec
// 2026-09-25-sku-previa-regerar §4.2 — P-46 do dono): o Regerar e o SKU à mão NÃO gravam na hora. Ficam "a gravar"
// (useSkusAGravar — estado FORA do Draft, como as linhas de MO: R5); a prévia vem do SERVIDOR (RPC skus_previa — o MESMO
// plano da gravação, STABLE/só leitura) e o Salvar do card grava (aplicarAGravar → RPC aplicar_skus_modelo com a
// assinatura da prévia vista) DEPOIS do UPDATE do modelo. A 1ª geração segue automática pós-Salvar (gerarSeFaltar — spec
// SKU §4.2, R12; D1 da spec da prévia). Os wrappers conferem módulo, loja e EDITAR o Planejamento (_sku_guarda).
import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import {
  deveGerarPrimeiraVez, lerMatriz, resumoGeracao, type ApelidoSigla, type CorSigla, type LinhaSku, type MatrizSkus,
} from "./sku-card";
import {
  MSG_PREVIA_CALCULANDO, SKUS_A_GRAVAR_VAZIO, chaveEntradaPrevia, comRegerar, digitarSku, entradaDaChave, lerPrevia,
  manterMeu, manuaisParaRpc, mensagemAplicarSkus, mensagemErroPrevia, modoPrevia, nadaAGravar, resumoAplicacao, semManual,
  type LinhaPrevia, type PreviaSkus, type SkusAGravar,
} from "./sku-previa";

export const chaveSkus = (modeloId: string | null) => ["plan-skus", modeloId] as const;
export const prefixoPrevia = (modeloId: string | null) => ["plan-skus-previa", modeloId] as const;

async function lerSkus(modeloId: string): Promise<MatrizSkus> {
  const { data, error } = await supabase.rpc("skus_modelo" as any, { _modelo_id: modeloId });
  if (error) throw error;
  return lerMatriz(data);
}

/** O "a gravar" da seção Códigos. Declarado no orquestrador ANTES do `dirty` (o "não salvo" depende dele — R5). */
export function useSkusAGravar() {
  const [aGravar, setAGravar] = useState<SkusAGravar>(SKUS_A_GRAVAR_VAZIO);
  const ref = useRef(aGravar);
  ref.current = aGravar;
  const troca = (proximo: SkusAGravar) => { ref.current = proximo; setAGravar(proximo); };
  return {
    aGravar,
    /** leitura síncrona — o Salvar roda no onSuccess do save, fora do ciclo de render */
    atual: () => ref.current,
    pedirRegerar: () => troca(comRegerar(ref.current)),
    /** blur/Enter do SKU: devolve o erro PT (o campo faz o toast) e o valor que o campo deve mostrar */
    digitar: (l: LinhaSku | LinhaPrevia, texto: string): { erro: string | null; valor: string } => {
      const r = digitarSku(ref.current, l, texto);
      if (r.aGravar !== ref.current) troca(r.aGravar);
      return { erro: r.erro, valor: r.valor };
    },
    desfazerManual: (chave: string) => troca(semManual(ref.current, chave)),
    manterMeu: (l: LinhaSku) => troca(manterMeu(ref.current, l)),
    desfazerPrevia: () => troca(SKUS_A_GRAVAR_VAZIO),
    /** depois de gravar: só esvazia se nada mudou no voo (o que entrou depois continua "a gravar") */
    limparSe: (enviado: SkusAGravar) => { if (ref.current === enviado) troca(SKUS_A_GRAVAR_VAZIO); },
  };
}
export type SkusAGravarApi = ReturnType<typeof useSkusAGravar>;

/** Atrasa a troca de uma CHAVE (a entrada da prévia) — a REF é digitada letra a letra. */
function useChaveAtrasada(chave: string, ms: number): string {
  const [v, setV] = useState(chave);
  useEffect(() => {
    if (v === chave) return;
    const t = setTimeout(() => setV(chave), ms);
    return () => clearTimeout(t);
  }, [chave, v, ms]);
  return v;
}

/** `ativo` = card existente e o usuário vê o Planejamento; `podeEditar` = edita o Planejamento (prévia/Salvar/1ª geração). */
export function useSkusModelo(
  modeloId: string | null,
  ativo: boolean,
  podeEditar: boolean,
  o: { refPrevia: string; tamanhoTipo: "letra" | "numero"; aGravar: SkusAGravarApi },
) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: chaveSkus(modeloId),
    enabled: ativo && !!modeloId,
    queryFn: () => lerSkus(modeloId as string),
  });
  const aGravar = o.aGravar.aGravar;
  const temPrevia = !nadaAGravar(aGravar);
  const chave = chaveEntradaPrevia({ ref: o.refPrevia, tamanhoTipo: o.tamanhoTipo, aGravar });
  const chaveAtrasada = useChaveAtrasada(chave, 300);
  const pq = useQuery({
    queryKey: [...prefixoPrevia(modeloId), chaveAtrasada],
    enabled: ativo && podeEditar && !!modeloId && temPrevia,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<PreviaSkus> => {
      const e = entradaDaChave(chaveAtrasada);
      const { data, error } = await supabase.rpc("skus_previa" as any, {
        _modelo_id: modeloId, _ref: e.ref, _tamanho_tipo: e.tamanhoTipo, _manuais: e.manuais, _modo: e.modo,
      });
      if (error) throw error;
      return lerPrevia(data, chaveAtrasada);
    },
  });
  // Espelhos síncronos p/ o Salvar (onSuccess do save, fora do ciclo de render).
  const chaveRef = useRef(chave);
  chaveRef.current = chave;
  const previaRef = useRef<PreviaSkus | undefined>(pq.data);
  previaRef.current = pq.data;
  const buscandoRef = useRef(pq.isFetching);
  buscandoRef.current = pq.isFetching;
  const invalidar = () => {
    qc.invalidateQueries({ queryKey: chaveSkus(modeloId) });
    qc.invalidateQueries({ queryKey: prefixoPrevia(modeloId) });
  };

  /** Salvar do card, DEPOIS do UPDATE do modelo: grava a prévia VISTA. Nunca lança. */
  const aplicarAGravar = async (): Promise<"nada" | "ok" | "falhou"> => {
    const s = o.aGravar.atual();
    if (nadaAGravar(s) || !modeloId) return "nada";
    const d = previaRef.current;
    if (!d || d.entrada !== chaveRef.current || buscandoRef.current || !d.assinatura) {
      toast.error(MSG_PREVIA_CALCULANDO);
      return "falhou";
    }
    if (d.erros.length > 0) {
      toast.error(mensagemErroPrevia(d.erros[0]));
      return "falhou";
    }
    try {
      const { data, error } = await supabase.rpc("aplicar_skus_modelo" as any, {
        _modelo_id: modeloId, _manuais: manuaisParaRpc(s), _modo: modoPrevia(s), _assinatura: d.assinatura,
      });
      if (error) throw error;
      o.aGravar.limparSe(s);
      const r = resumoAplicacao(data);
      if (r.erro) toast.error(r.texto);
      else toast.success(r.texto);
      return "ok";
    } catch (e) {
      toast.error(mensagemAplicarSkus(e));
      return "falhou";
    } finally {
      invalidar();
    }
  };

  /** Depois do Salvar: matriz FRESCA; card com REF e SEM SKU gravado ⇒ gera (`_regerar=false` só cria o que falta — D1). */
  const gerarSeFaltar = async () => {
    if (!ativo || !modeloId || !podeEditar) return;
    try {
      if (!deveGerarPrimeiraVez(await lerSkus(modeloId))) return;
      const { data, error } = await supabase.rpc("gerar_skus_modelo" as any, { _modelo_id: modeloId, _regerar: false });
      if (error) throw error;
      const r = resumoGeracao(data);
      if (r.erro) toast.error(r.texto);
    } catch (e) {
      toast.error(mensagemErro(e, "O card foi salvo, mas os SKUs não foram gerados — abra a seção Códigos e use “Regerar SKUs”."));
    } finally {
      invalidar();
    }
  };

  return {
    matriz: q.data,
    carregando: q.isLoading,
    erro: q.isError,
    temPrevia,
    /** a prévia na tela (a última calculada — pode ser de uma entrada anterior enquanto a nova chega) */
    previa: temPrevia ? (pq.data ?? null) : null,
    previaCarregando: temPrevia && pq.isFetching,
    previaErro: temPrevia && pq.isError,
    refazerPrevia: () => { void pq.refetch(); },
    aplicarAGravar,
    gerarSeFaltar,
  };
}
export type SkusModelo = ReturnType<typeof useSkusModelo>;

const SEM_SIGLAS: { cores: CorSigla[]; apelidos: ApelidoSigla[] } = { cores: [], apelidos: [] };
/** R11 — siglas das cores/apelidos DA LOJA p/ o rótulo da variante (a matriz não traz os ids — `variante_key` é md5 de
 *  cor+apelido). Consulta própria, cacheada por loja (`.eq("tenant_id")` explícito: o super admin enxerga outras lojas);
 *  erro/carregando = sem siglas (só os nomes). `select("*")` como o card "Formato do SKU" (`sigla_sku` fora do types.ts). */
export function useSiglasCores(ativo: boolean): { cores: CorSigla[]; apelidos: ApelidoSigla[] } {
  const tenantId = useActiveTenantId();
  const q = useQuery({
    queryKey: ["plan-skus-siglas", tenantId],
    enabled: ativo && !!tenantId,
    queryFn: async () => {
      const [c, a] = await Promise.all([
        supabase.from("cores").select("*").eq("tenant_id", tenantId as string),
        supabase.from("cores_apelido").select("*").eq("tenant_id", tenantId as string),
      ]);
      if (c.error) throw c.error;
      if (a.error) throw a.error;
      return {
        cores: ((c.data ?? []) as any[]).map((x): CorSigla => ({ id: x.id, nome: x.nome, sigla: x.sigla_sku ?? null })),
        apelidos: ((a.data ?? []) as any[]).map((x): ApelidoSigla => ({ cor_base_id: x.cor_base_id ?? null, nome: x.nome, sigla: x.sigla_sku ?? null })),
      };
    },
  });
  return q.data ?? SEM_SIGLAS;
}
```

- [ ] **Step 4: `CodigosSecao.tsx` (arquivo inteiro)**

```tsx
// Seção "4. Códigos" do Sheet do Planejamento (F3.6 — spec 2026-09-25 §5.1; F3.5b da spec do SKU §4.3). SKU em PRÉVIA (spec
// 2026-09-25-sku-previa-regerar §4.2 — P-46 do dono): o "Regerar SKUs" e o SKU digitado à mão NÃO gravam na hora — entram
// "a gravar" (aviso no topo + selo e fundo âmbar na linha), a prévia vem do SERVIDOR (skus_previa, só leitura, o MESMO plano
// da gravação) e só o Salvar do card grava; Voltar/Descartar ou "Desfazer prévia" mantêm os SKUs gravados. Sem AlertDialog
// (a prévia É a confirmação — R3). Regerar liberado com REF/"Tamanho em" digitados e ainda não salvos (a prévia usa os do
// rascunho). L1: REF (a MESMA trava `refEditavel` de hoje; R29) · "Tamanho em" (P-25: nasce em Letra) · "Regerar SKUs".
// Regras puras em ./sku-card.ts e ./sku-previa.ts; siglas do rótulo por consulta própria (`useSiglasCores` — R11).
import { Fragment, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Link } from "@tanstack/react-router";
import { RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn } from "@/lib/utils";
import type { Draft } from "@/components/planejamento/modelo-shared";
import {
  agruparPorVariante, avisoSku, rotuloTamanho, rotuloVariante, siglasDoGrupo, situacaoSku, type LinhaSku,
} from "./sku-card";
import {
  TEXTO_BOM_SUJO, TEXTO_PREVIA, chaveLinhaSku, podeRegerar, situacaoPrevia, skuExibido, type LinhaPrevia, type SituacaoPrevia,
} from "./sku-previa";
import { useSiglasCores, type SkusAGravarApi, type SkusModelo } from "./useSkusModelo";

// P-25 (dono 25/set) — SEM padrão da LOJA (nada na Config): as 2 opções; o Draft chega aqui já marcado em Letra.
const TAMANHOS_EM = [{ v: "letra", rotulo: "Letra" }, { v: "numero", rotulo: "Número" }] as const;

// Nível de MÓDULO (não dentro do render): declarado dentro, remontaria a cada render e o input perderia o foco.
function SkuCampo({ exibido, editavel, riscado, placeholder, ariaLabel, colabPath, onConfirmar }: {
  /** o que a linha MOSTRA (digitado > o que o Salvar grava > o gravado — `skuExibido`) */
  exibido: string;
  editavel: boolean;
  riscado: boolean;
  placeholder: string;
  ariaLabel: string;
  colabPath: string;
  /** entra "a gravar" (nada vai ao banco aqui); devolve o erro PT e o valor que o campo passa a mostrar */
  onConfirmar: (texto: string) => { erro: string | null; valor: string };
}) {
  const [texto, setTexto] = useState(exibido);
  // A prévia mudou / outra pessoa / desfazer: o campo acompanha o que a linha mostra.
  useEffect(() => { setTexto(exibido); }, [exibido]);
  const confirmar = () => {
    const r = onConfirmar(texto);
    if (r.erro) toast.error(r.erro);
    setTexto(r.valor);
  };
  return (
    <Input
      className={cn("h-8 w-full min-w-0 font-mono text-xs", riscado && "line-through")}
      value={texto}
      placeholder={placeholder}
      disabled={!editavel}
      aria-label={ariaLabel}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
      data-colab-path={colabPath}
    />
  );
}

export function CodigosSecao({
  draft, setDraftTracked, rotuloRef, refVisivel, refEditavel, refPrevia, skus, aGravar, bomSujo, podeVerSkus, podeEditarSkus,
}: {
  draft: Draft;
  setDraftTracked: Dispatch<SetStateAction<Draft>>;
  rotuloRef: string;
  /** A REF aparece a partir da etapa configurada (`refCampoVisivel`; posição DERIVADA com a chave ligada — inv. #11). */
  refVisivel: boolean;
  /** = `refEditavel` do orquestrador (isEdit && !devBloqueado && refVisivel) — o MESMO que põe a REF no payload. */
  refEditavel: boolean;
  /** A REF que o Salvar vai gravar (a do rascunho se ela vai no payload; senão a salva) — `refParaPrevia`. */
  refPrevia: string;
  skus: SkusModelo;
  aGravar: SkusAGravarApi;
  /** Grade/tecidos do rascunho com alteração não salva: a prévia usa a grade SALVA (R4) — só um aviso. */
  bomSujo: boolean;
  /** Ver SKUs = ver o Planejamento; prévia/Salvar = editar o Planejamento (spec SKU §4.4; R8 — o servidor confere). */
  podeVerSkus: boolean;
  podeEditarSkus: boolean;
}) {
  const temPrevia = skus.temPrevia;
  // Com algo "a gravar", a tabela é a da PRÉVIA (calculada com o rascunho); senão, a gravada — como antes.
  const m = temPrevia && skus.previa ? skus.previa.matriz : skus.matriz;
  const grupos = m ? agruparPorVariante(m.linhas) : [];
  // Mesma guarda de antes (tamanho_tipo_card — rede p/ deploy fora de ordem); NÃO depende da trava do Dev/Explosão (R29).
  const editavel = !!m && m.status === "ok" && m.tamanho_tipo_card !== null && podeEditarSkus;
  const regerar = podeRegerar({ podeEditar: podeEditarSkus, matriz: skus.matriz, refPrevia, jaPedido: aGravar.aGravar.regerar });
  const siglas = useSiglasCores(podeVerSkus);
  const situacao = (l: LinhaSku, digitado: boolean): SituacaoPrevia => {
    if (temPrevia && skus.previa) return situacaoPrevia(l as LinhaPrevia);
    // a prévia ainda não chegou: o digitado já se anuncia "a gravar"
    if (digitado) return { tom: "warning", texto: "editado à mão · a gravar", cadastrar: false, aGravar: true, conflitoVersao: false };
    return { ...situacaoSku(l), aGravar: false, conflitoVersao: false };
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        {refVisivel ? (
          <div className="grid gap-1">
            <Label htmlFor="codigos-ref">{rotuloRef}</Label>
            <Input
              id="codigos-ref"
              className="font-mono"
              value={draft.ref}
              // R29 — só o INPUT trava (enviado à Explosão / sem permissão do Dev), como hoje; sem aviso nesta seção.
              disabled={!refEditavel}
              onChange={(e) => setDraftTracked((d) => ({ ...d, ref: e.target.value }))}
              data-colab-path="ref"
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">A {rotuloRef} aparece a partir da etapa configurada na Config da Loja.</p>
        )}
        {/* P-25 (dono 25/set 14:57) — SEM padrão da LOJA: o Draft já chega marcado em Letra; dá p/ trocar p/ Número. Rádio nativo
            (não há RadioGroup em ui/, que não se edita): grupo rotulado; alvo de toque 44px no mobile. */}
        <div className="grid gap-1" role="radiogroup" aria-labelledby="codigos-tamanho-em" data-colab-path="tamanho_tipo">
          <Label id="codigos-tamanho-em">
            Tamanho em <span className="font-normal text-muted-foreground">· nasce em Letra; troque para Número se o produto usa numeração</span>
          </Label>
          <div className="flex min-h-9 items-center gap-4 text-sm">
            {TAMANHOS_EM.map((o) => (
              <label key={o.v} className="flex cursor-pointer items-center gap-1.5 max-sm:min-h-11">
                <input
                  type="radio"
                  name="codigos-tamanho-em"
                  value={o.v}
                  className="h-4 w-4 accent-primary"
                  checked={draft.tamanho_tipo === o.v}
                  onChange={() => setDraftTracked((d) => ({ ...d, tamanho_tipo: o.v }))}
                />
                {o.rotulo}
              </label>
            ))}
          </div>
        </div>
        {podeVerSkus && (
          <Button type="button" variant="outline" size="sm" className="max-sm:min-h-11"
            disabled={!regerar.pode}
            title={regerar.motivo}
            onClick={aGravar.pedirRegerar}>
            <RefreshCw className="mr-1 h-4 w-4" /> Regerar SKUs
          </Button>
        )}
      </div>

      {podeVerSkus && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">SKUs por variante e tamanho</p>
          {temPrevia && (
            <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--warning)] bg-[var(--tone-warning-bg)] px-3 py-2 text-xs text-[var(--tone-warning-fg)]">
              <span className="min-w-0 flex-1">{TEXTO_PREVIA}</span>
              {skus.previaCarregando && <span>Calculando a prévia…</span>}
              <Button type="button" variant="outline" size="sm" className="max-sm:min-h-11" onClick={aGravar.desfazerPrevia}>
                <RotateCcw className="mr-1 h-4 w-4" /> Desfazer prévia
              </Button>
            </div>
          )}
          {temPrevia && bomSujo && <p className="text-xs text-muted-foreground">{TEXTO_BOM_SUJO}</p>}
          {temPrevia && skus.previaErro && (
            <p className="text-sm text-destructive">
              Não foi possível calcular a prévia —{" "}
              <button type="button" className="underline" onClick={skus.refazerPrevia}>tentar de novo</button>.
            </p>
          )}
          {temPrevia && skus.previa?.desconhecida && (
            <p className="text-sm text-destructive">Não foi possível ler a prévia — recarregue a página. O Salvar não grava os SKUs assim.</p>
          )}
          {skus.carregando ? (
            <p className="text-sm text-muted-foreground">Carregando os SKUs…</p>
          ) : skus.erro ? (
            <p className="text-sm text-destructive">Não foi possível carregar os SKUs — recarregue a página.</p>
          ) : !m ? null : m.linhas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {m.status === "sem_formato" ? (
                <>A loja ainda não tem o Formato do SKU — <Link to="/admin/configuracoes" className="underline">configurar na Config da Loja</Link>.</>
              ) : m.status === "aguardando_ref" ? (
                `Os SKUs são gerados quando o card tiver ${rotuloRef} (salve o card depois que ela aparecer).`
              ) : m.status === "sem_tamanho" ? (
                // P-25 — só card LEGADO antes da migration T6 rodar (todo produto novo já nasce em Letra).
                "Este card é de antes da migração do “Tamanho em” — salve o card para atualizá-lo e gerar os SKUs."
              ) : m.status === "desconhecido" ? (
                "Não foi possível ler a situação dos SKUs — recarregue a página."
              ) : (
                "Sem linhas: preencha a Grade (variantes do Tecido 1 × tamanhos com quantidade)."
              )}
            </p>
          ) : (
            <div className="overflow-x-auto">
              {m.status === "sem_tamanho" && (
                <p className="mb-2 text-xs text-muted-foreground">Card de antes da migração do “Tamanho em” — salve o card para gerar ou regerar os SKUs.</p>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 pr-3 font-semibold">Variante / Tamanho</th>
                    <th className="py-1.5 px-2 font-semibold">SKU</th>
                    <th className="py-1.5 pl-2 font-semibold">Situação</th>
                  </tr>
                </thead>
                <tbody className="align-middle">
                  {grupos.map((g) => {
                    const rotuloVar = rotuloVariante(g, siglasDoGrupo(g, siglas.cores, siglas.apelidos));
                    return (
                    <Fragment key={g.chave}>
                      <tr className="bg-muted/40">
                        <td colSpan={3} className="py-1.5 px-2 text-xs font-semibold text-muted-foreground">{rotuloVar}</td>
                      </tr>
                      {g.linhas.map((l) => {
                        const chave = chaveLinhaSku(l.variante_key, l.tamanho_key);
                        const digitado = chave in aGravar.aGravar.manuais;
                        const sit = situacao(l, digitado);
                        const sai = (l as LinhaPrevia).previa?.acao === "sai";
                        const aviso = avisoSku(l);
                        const rotuloTam = rotuloTamanho(l.tamanho_key, m.tamanho_tipo);
                        return (
                          <tr key={chave} className={cn("border-t", (sit.aGravar || digitado) && "bg-[var(--tone-warning-bg)]")}>
                            <td className="py-2 pr-3 pl-4 whitespace-nowrap">{rotuloTam}</td>
                            <td className="py-2 px-2 min-w-40">
                              <SkuCampo
                                exibido={skuExibido(l, aGravar.aGravar)}
                                editavel={editavel && l.estado !== "orfa" && !sai}
                                riscado={sai}
                                placeholder={l.sku_previsto ?? ""}
                                ariaLabel={`SKU — ${rotuloVar} · ${rotuloTam}`}
                                colabPath={`sku:${l.variante_key}:${l.tamanho_key}`}
                                onConfirmar={(t) => aGravar.digitar(l, t)}
                              />
                            </td>
                            <td className="py-2 pl-2 text-xs">
                              <span className="inline-flex flex-wrap items-center gap-1">
                                {sit.tom === "neutral" ? (
                                  <span className="text-muted-foreground">{sit.texto}</span>
                                ) : (
                                  <StatusBadge tone={sit.tom} className="normal-case tracking-normal">{sit.texto}</StatusBadge>
                                )}
                                {sit.cadastrar && <Link to="/cadastro/atributos" className="underline">cadastrar</Link>}
                                {digitado && !sit.conflitoVersao && (
                                  <Button type="button" variant="ghost" size="iconSm" className="max-sm:h-11 max-sm:w-11"
                                    aria-label="Desfazer o SKU digitado" title="Desfazer o SKU digitado"
                                    onClick={() => aGravar.desfazerManual(chave)}>
                                    <RotateCcw className="h-4 w-4" />
                                  </Button>
                                )}
                              </span>
                              {sit.conflitoVersao && (
                                <span className="mt-1 flex flex-wrap gap-2">
                                  <Button type="button" variant="outline" size="sm" className="max-sm:min-h-11" onClick={() => aGravar.manterMeu(l)}>manter o meu</Button>
                                  <Button type="button" variant="ghost" size="sm" className="max-sm:min-h-11" onClick={() => aGravar.desfazerManual(chave)}>usar o novo</Button>
                                </span>
                              )}
                              {aviso && (
                                <span className="mt-1 block text-muted-foreground">
                                  {aviso} — <Link to="/cadastro/atributos" className="underline">cadastrar</Link>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">As variantes vêm do Tecido 1 (seção Tecidos) e os tamanhos, da Grade. Formato: REF - cor base + apelido + tamanho (Config da Loja › Formato do SKU). 'Regerar SKUs' mostra a prévia e só o Salvar grava; os editados à mão nunca mudam.</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: `sku-card.ts` — tirar a regra do SKU imediato**

Apagar o bloco (`:172-181`):

```ts
export type AcaoSkuDigitado = { acao: "nada" } | { acao: "erro"; erro: string } | { acao: "salvar"; sku: string };

/** SKU digitado à mão → o que fazer no blur/Enter (mesma normalização/mensagens do `_sku_norm_manual` do SQL). */
export function skuDigitadoParaSalvar(l: LinhaSku, texto: string): AcaoSkuDigitado {
  …
}
```
e, se `normalizarSkuManual` ficar sem uso no arquivo, tirá-lo do import de `@/lib/sku-montar` (`:11`). No comentário do topo
(`:4`), trocar "e o que fazer com um SKU digitado à mão" por "(o SKU digitado à mão vira 'a gravar' — ./sku-previa.ts)".

- [ ] **Step 6: `usePlanejamentoSave.ts` — o `onSaved` é aguardado**

(a) `:69`: `onSaved: () => void;` → `onSaved: () => void | Promise<void>;` e, na linha de cima, o comentário
`/** SKU em prévia: aguardado no onSuccess — o Salvar fica "salvando" até os SKUs "a gravar" terminarem (aoSalvar). */`.

(b) `:642`: `onSuccess: (result) => {` → `onSuccess: async (result) => {`.

(c) `:809`: `onSaved();` → `await onSaved();`. No comentário acima (`:805-808`), acrescentar a linha
`// SKU em prévia (spec 2026-09-25-sku-previa-regerar §4.2.5): AGUARDADO — o aoSalvar grava os SKUs "a gravar" DEPOIS do modelo.`

O `onSaved()` do ramo de card NOVO no `onError` (`:857`) fica como está: card novo não tem a seção Códigos.

- [ ] **Step 7: `PlanejamentoDetail.tsx` — a fiação**

(a) Imports (`:100-101`):

```ts
import { useSkusAGravar, useSkusModelo } from "@/components/planejamento/planejamento-detail/codigos/useSkusModelo";
import { seloCodigos } from "@/components/planejamento/planejamento-detail/codigos/sku-card";
import { nadaAGravar, refParaPrevia } from "@/components/planejamento/planejamento-detail/codigos/sku-previa";
```
Em `:61`, tirar `tamanhoTipoNormalizado` do import (o único uso era a prop `tamanhoTipoSalvo`, que sai). Conferir com
`grep -n tamanhoTipoNormalizado src/components/planejamento/PlanejamentoDetail.tsx`: só pode sobrar a linha do import.

(b) Logo depois de `const moBaseRef = useRef(moLinhasBase); moBaseRef.current = moLinhasBase;` (`:201`):

```ts
  // SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.2.1 — P-46): o Regerar e o SKU à mão ficam "a gravar" FORA do Draft
  // (como as linhas de MO) — declarado AQUI, antes do `dirty`, que depende dele. Só o Salvar grava (aoSalvar).
  const skusAGravar = useSkusAGravar();
```

(c) `:644`:

```ts
  const dirty = draftDirty || !moLinhasEqual(moLinhas, moLinhasBase) || gradeRevendaDirty || ficha.dirty || !nadaAGravar(skusAGravar.aGravar);
```

(d) `:733-734`:

```ts
  // F3.6 — matriz de SKUs do card (RPC `skus_modelo`, F3.5a) + 1ª geração pós-Salvar (R12). SKU em PRÉVIA: a prévia usa a REF que
  // o Salvar vai gravar (a do rascunho só quando ela vai no payload — refEditavel) e o "Tamanho em" do rascunho (vai sempre).
  const skus = useSkusModelo(modeloId, isEdit && !!modeloId && podeVerPlanejamento, podeEditarPlanejamento, {
    refPrevia: refParaPrevia({ refVaiNoSalvar: refEditavel, refRascunho: draft.ref, refSalva: (modeloData as any)?.ref ?? "" }),
    tamanhoTipo: draft.tamanho_tipo,
    aGravar: skusAGravar,
  });
```

(e) `:836-838` (comentário + `aoSalvar`):

```ts
  // Salvar re-trava os campos do Dev quando o card já foi enviado à Explosão (paridade com o Dev,
  // ModeloDetailPanel.tsx:2273) e avisa o container (lista por baixo). SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.2.5):
  // o modelo JÁ foi gravado; agora os SKUs "a gravar" (a prévia vista — assinatura conferida no servidor) e, se não falharem, a
  // 1ª geração automática (só num card sem nenhum SKU — D1). Aguardado pelo usePlanejamentoSave: o Salvar segue "salvando".
  const aoSalvar = async () => {
    setEditandoDev(false);
    onSaved();
    if (!isEdit) return;
    const r = await skus.aplicarAGravar();
    if (r !== "falhou") await skus.gerarSeFaltar();
  };
```

(f) No `onMudancaServidor` do colab (`:911-916`), depois de `qc.invalidateQueries({ queryKey: ["plan-skus", modeloId] });`:

```ts
      // SKU em prévia — a prévia relê com o que a outra pessoa salvou (REF/"Tamanho em"/grade).
      qc.invalidateQueries({ queryKey: ["plan-skus-previa", modeloId] });
```

(g) `:1221`: `selos.codigos = seloCodigos(skus.matriz, skus.temPrevia);`

(h) `<CodigosSecao …>` (`:1489-1505`): tirar as props `refSalva` e `tamanhoTipoSalvo` (e os 2 comentários delas) e acrescentar:

```tsx
                refPrevia={refParaPrevia({ refVaiNoSalvar: refEditavel, refRascunho: draft.ref, refSalva: (modeloData as any)?.ref ?? "" })}
                aGravar={skusAGravar}
                // R4 — grade/tecidos do rascunho ainda não salvos: a prévia usa a grade SALVA (só um aviso).
                bomSujo={ficha.dirty || gradeRevendaDirty}
```
(`skus`, `podeVerSkus`, `podeEditarSkus`, `draft`, `setDraftTracked`, `rotuloRef`, `refVisivel`, `refEditavel` ficam.)

- [ ] **Step 8: Rodar e ver passar**

```bash
ps -Ao pid,command | grep -E "[v]itest|[p]laywright"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run tests/unit/planejamento-codigos.test.ts tests/unit/sku-previa.test.ts tests/unit/planejamento-save-ficha.test.ts tests/unit/planejamento-draft.test.ts
npx tsc --noEmit 2>&1 | head -20
```
Expected: PASS nos 4 arquivos; `tsc` sem erro. (`TS2304`/`TS2305` = import faltando ou sobrando: corrigir.)

- [ ] **Step 9: Gates e commit**

```bash
bash .superpowers/sku-previa/gates.sh
git add -- src/components/planejamento/planejamento-detail/codigos/useSkusModelo.ts src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx src/components/planejamento/planejamento-detail/codigos/sku-card.ts src/components/planejamento/PlanejamentoDetail.tsx src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts tests/unit/planejamento-codigos.test.ts
git commit --only -m "feat(sku-previa): Regerar e SKU à mão em PRÉVIA no rascunho; só o Salvar grava (modelo → SKUs → 1ª geração) (T5)

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- src/components/planejamento/planejamento-detail/codigos/useSkusModelo.ts src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx src/components/planejamento/planejamento-detail/codigos/sku-card.ts src/components/planejamento/PlanejamentoDetail.tsx src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts tests/unit/planejamento-codigos.test.ts
git show --stat HEAD
```
Expected: `GATES PREVIA: ok` (inclui o anti-drift de UI — cor só por `var(--…)`); 6 arquivos.

- [ ] **Step 10: Revisão Opus individual + `code-reviewer`**

O revisor recebe a spec §4.2, as Tasks 1 e 5 e o diff `git diff <commit da T2>..HEAD -- src tests/unit`. Checklist:
1. nada grava antes do Salvar:
   - nenhuma chamada a `salvar_sku_manual`/`gerar_skus_modelo(_, true)` fora do Salvar;
   - Descartar/Voltar desmonta o Sheet e o "a gravar" some;
   - "Desfazer prévia" e ↺ só mexem no rascunho;
2. ordem do Salvar:
   - modelo → `aplicarAGravar` → `gerarSeFaltar`;
   - erro no modelo (P0409 do card, BOM) não tenta os SKUs;
   - falha nos SKUs mantém o "a gravar" e o "não salvo";
   - `limparSe` não apaga o que entrou durante o voo;
   - o `onSuccess` async não quebra o retry do P0409 nem o `salvarAntes` (Enviar à Explosão);
3. a entrada da prévia é a do Salvar: REF só do rascunho quando `refEditavel`; o "Tamanho em" sempre; `aplicarAGravar` exige
   prévia EM DIA (`entrada === chave`, sem busca, com assinatura) e sem erro;
4. colaboração:
   - invalidação `plan-skus-previa` no colab;
   - P0409 → texto do SKU;
   - "manter o meu"/"usar o novo" só na linha com `conflitoVersao`;
   - `data-colab-path` `sku:` mantido;
5. só leitura: sem `podeEditarSkus` não há prévia (query desligada), inputs travados, Regerar desabilitado com motivo;
6. UI:
   - textos verbatim do plano;
   - cor só por token;
   - `size="iconSm"` + 44px no mobile;
   - sem estouro a 360px (a tabela segue em `overflow-x-auto`; o aviso quebra linha);
7. o `dirty` do Sheet e o selo "prévia a gravar" acendem e apagam juntos.

Achado ⇒ fix na Task 5 (novo commit) e checagem escopada.

---

## Task 6: Portões finais — G-commit, merge + cópia, QA no `:5173`, docs, G-deploy *(controlador + guardião + dono)*

**Files:**
- Modify: `docs/superpowers/specs/2026-09-24-sku-automatico-design.md` (§4.2 e §4.3 — nota "SKU em prévia")
- Modify: `docs/superpowers/specs/2026-09-25-sheet-planejamento-reorganizacao-design.md` (§5.4 — o SKU à mão não é mais RPC imediata)
- Create (NÃO versionar): `tests/e2e/sku-previa-qa.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–5 commitadas; `IDA OK` + referência `pos_sku_previa` do dono (Task 4 Step 12); `copia.sh`.
- Produces: branch juntada na `feature/plan-tecido-a1`; cópia COM a frente; QA verde; docs e memória em dia.

- [ ] **Step 1: Notas nas specs (docs)**

(a) `docs/superpowers/specs/2026-09-24-sku-automatico-design.md`, no fim do §4.2, acrescentar:

```markdown
- **SKU em PRÉVIA (25/set, P-46/P-47 A — spec `2026-09-25-sku-previa-regerar-design.md`):**
  - o "Regerar SKUs" e o SKU editado à mão deixam de gravar na hora. Viram PRÉVIA no rascunho do card, calculada pela RPC
    só leitura `skus_previa` (o MESMO plano `_skus_plano` da gravação), e o Salvar grava por `aplicar_skus_modelo`
    (assinatura conferida antes e depois);
  - `gerar_skus_modelo` segue igual por fora (plano + executor por dentro) e é o caminho da 1ª geração automática;
  - `salvar_sku_manual` fica no banco sem chamador no front.
```
E no §4.3 (tela), trocar "e \"Regerar SKUs\" (AlertDialog: \"SKUs editados à mão não mudam\")" por "e \"Regerar SKUs\" (mostra a
PRÉVIA — sem AlertDialog; só o Salvar grava; os editados à mão nunca mudam)".

(b) `docs/superpowers/specs/2026-09-25-sheet-planejamento-reorganizacao-design.md` §5.4, no item "SKU (Parte C)", acrescentar
no fim: "**Atualizado em 25/set (SKU em prévia):** a edição de SKU e o Regerar passaram a entrar no Salvar da página (prévia
\"a gravar\" fora do `Draft`, gravada por `aplicar_skus_modelo` depois do UPDATE do modelo) — ver
`2026-09-25-sku-previa-regerar-design.md` §4.2."

```bash
bash .superpowers/sku-previa/gates.sh
git add -- docs/superpowers/specs/2026-09-24-sku-automatico-design.md docs/superpowers/specs/2026-09-25-sheet-planejamento-reorganizacao-design.md
git commit --only -m "docs(sku-previa): specs do SKU e da reorganização apontam para o Regerar/SKU à mão em prévia (T6)

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- docs/superpowers/specs/2026-09-24-sku-automatico-design.md docs/superpowers/specs/2026-09-25-sheet-planejamento-reorganizacao-design.md
```

- [ ] **Step 2: G-commit (guardião) — antes do merge**

O guardião confere:
- `git log feature/plan-tecido-a1..sku/previa-regerar` só com os commits desta frente;
- `gates.sh` verde;
- Dev intocado;
- os 2 SQL = o md5 ensaiado (`md5-mig.txt`/`md5-inv.txt`);
- `IDA OK` + referência `pos_sku_previa` no log do dono;
- o `git cherry` das outras frentes sem sobreposição nova (Task 0 Step 8 de novo).

BLOQUEIA ⇒ parar.

- [ ] **Step 3: Merge (ff) na principal + a frente na cópia — o MESMO passo (o dono dá o OK no painel)**

Só DEPOIS do `IDA OK` (senão o `:5173`, que grava em produção, quebra na seção Códigos). O controlador publica o aviso N3 e:

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"                 # checkout principal (branch feature/plan-tecido-a1)
git status --short                                         # vazio (se não estiver, PARE)
git merge --ff-only sku/previa-regerar && git log --oneline -3
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-previa"
PREVIA_DONO_AVISADO=sim bash .superpowers/sku-previa/copia.sh ida
```
Expected:
- ff sem conflito;
- `== CÓPIA: ida OK (484|277 → 493|277)` (ou `+9|+0` sobre o que houver).

Não-ff (outra frente entrou antes) ⇒ `git rebase feature/plan-tecido-a1` NA WORKTREE (sem stash), `gates.sh` de novo, e o
guardião refaz o G-commit.

- [ ] **Step 4: QA no `:5173` (PRODUÇÃO — D2: card e resíduos combinados com o dono no painel)**

Antes, o controlador:
- lê em produção, SÓ LEITURA (`begin transaction read only`), se a Loja Teste tem `sku_config` e o card combinado tem SKUs;
- lista ao dono os resíduos que a QA deixa (SKUs gerados/à mão no card) e espera o OK (D2).

`tests/e2e/sku-previa-qa.spec.ts` (NÃO versionar), com `E2E_BASE_URL=http://localhost:5173` e `E2E_SKU_CARD=<id combinado>`:

```ts
import { test, expect, type Page } from "@playwright/test";
import { doLogin } from "./_helpers";
// SKU em PRÉVIA — QA no :5173 (grava em PRODUÇÃO: card e resíduos combinados com o dono — D2). NUNCA selectStore.
const CARD = process.env.E2E_SKU_CARD ?? "";
test.skip(!process.env.E2E_BASE_URL?.includes("localhost:5173") || !CARD, "só no :5173 e com o card combinado");

async function abrir(page: Page) {
  await page.goto(`/criacao/planejamento?modelo=${CARD}`);
  await page.getByRole("button", { name: /Códigos/ }).click();
  await expect(page.getByText("SKUs por variante e tamanho")).toBeVisible();
}
const skus = (page: Page) => page.getByRole("textbox", { name: /^SKU — / });

test("Regerar e SKU à mão NÃO gravam antes do Salvar; Descartar mantém; Salvar grava a prévia", async ({ page }) => {
  await doLogin(page);
  await abrir(page);
  const antes = await skus(page).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  // 1) trocar o "Tamanho em" SEM salvar e regerar em prévia
  const outro = (await page.getByRole("radio", { name: "Letra" }).isChecked()) ? "Número" : "Letra";
  await page.getByRole("radio", { name: outro }).check();
  await page.getByRole("button", { name: /Regerar SKUs/ }).click();
  await expect(page.getByRole("status").getByText(/Prévia — nada foi gravado ainda/)).toBeVisible();
  await expect(page.getByText(/· a gravar/).first()).toBeVisible();
  await expect(page.getByText("alterações não salvas")).toBeVisible();
  // 2) Voltar → Descartar: reabrir e ver os SKUs de ANTES (nada gravou)
  await page.getByRole("button", { name: "Voltar" }).click();
  await page.getByRole("button", { name: "Descartar" }).click();
  await abrir(page);
  expect(await skus(page).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual(antes);
  // 3) SKU à mão em rascunho + ↺
  const campo = skus(page).first();
  await campo.fill("qa-previa-1");
  await campo.press("Enter");
  await expect(page.getByText("editado à mão · a gravar").first()).toBeVisible();
  await page.getByRole("button", { name: "Desfazer o SKU digitado" }).first().click();
  await expect(campo).toHaveValue(antes[0]);
  // 4) Regerar (mesmo "Tamanho em") + Salvar ⇒ toast "SKUs gravados" e a prévia some
  await page.getByRole("button", { name: /Regerar SKUs/ }).click();
  await expect(page.getByRole("status").getByText(/Prévia — nada foi gravado ainda/)).toBeVisible();
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText(/SKUs gravados:/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("status").getByText(/Prévia — nada foi gravado ainda/)).toHaveCount(0);
});

test("2 abas: B edita um SKU e salva no meio ⇒ A recebe 'Os SKUs mudaram desde a prévia' e a prévia é refeita", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await doLogin(a); await doLogin(b);
  await abrir(a); await abrir(b);
  await a.getByRole("button", { name: /Regerar SKUs/ }).click();
  const campoB = skus(b).last();
  await campoB.fill("qa-previa-2"); await campoB.press("Enter");
  await b.getByRole("button", { name: "Salvar" }).click();
  await expect(b.getByText(/SKUs gravados:/)).toBeVisible({ timeout: 15000 });
  await a.getByRole("button", { name: "Salvar" }).click();
  await expect(a.getByText(/Os SKUs mudaram desde a prévia/)).toBeVisible({ timeout: 15000 });
  await expect(a.getByText("alterações não salvas")).toBeVisible();
});

test("mobile 360/390: a seção Códigos com a prévia não estoura na horizontal", async ({ page }) => {
  await doLogin(page);
  for (const w of [360, 390]) {
    await page.setViewportSize({ width: w, height: 800 });
    await abrir(page);
    await page.getByRole("button", { name: /Regerar SKUs/ }).click();
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw, `${w}px`).toBeLessThanOrEqual(cw);
  }
});
```

```bash
E2E_BASE_URL=http://localhost:5173 E2E_SKU_CARD=<id> npx playwright test tests/e2e/sku-previa-qa.spec.ts --workers=1
```
Expected: 3 passed.

Achado ⇒ correção NA WORKTREE (commit novo, gates) → novo ff (Step 3, sem o `copia.sh`) → QA de novo. No fim:
- restaurar o "Tamanho em" do card se mudou;
- listar ao dono os SKUs gravados pela QA (resíduo aceito na D2).

- [ ] **Step 5: G-deploy (guardião) e memória/CLAUDE.md (controlador)**

- O guardião confere a QA verde, o log do dono e a ordem (banco → merge → QA). O deploy segue o portão geral da campanha
  (P-47 A: junto do deploy pendente, sem ele não há deploy).
- O controlador, no checkout principal, atualiza:
  - `CLAUDE.md` (seção "Sheet unificado do Planejamento": o Regerar e o SKU à mão agora em prévia + Salvar; RPCs `skus_previa`/
    `aplicar_skus_modelo`; LIFO das voltas);
  - as memórias `project_sku_automatico` (prévia em produção, contagem 493|277, referência `pos_sku_previa`) e
    `feedback_staging_nada_grava_antes_salvar` (piloto concluído; o molde plano puro + assinatura serve à frente "Camada
    intermediária").

---

## 5. Riscos (e o que o plano faz)

| Risco | Onde aparece | O que o plano faz |
|---|---|---|
| O plano em memória diverge do laço antigo (ordem, órfã, cadeia) | Regerar grava diferente de antes | Equivalência velho × novo cenário a cenário na MESMA txn (Task 3) + a suíte inteira da F3.5a contra a geração nova (ensaio, Task 4) + pós-conferência no `aplicar` |
| Texto canônico ≠ `pg_get_functiondef` | a migration se desfaz | `$pos$` com md5 das 12; a suíte em txn pega na Task 3; correção no gerador + `desvios.md` |
| Prévia velha (outra pessoa, sigla/Formato/grade, REF do gatilho) | gravar o que não foi visto | assinatura antes E depois no servidor ⇒ P0409 + prévia nova + 2º Salvar; nunca grava diferente |
| Card salvo e SKUs não (erro no meio) | usuário acha que salvou tudo | toast explícito, "não salvo" aceso, prévia mantida (R6) |
| `onSuccess` async no Salvar | retry do P0409 / Enviar à Explosão | revisão Opus (Task 5 Step 10, item 2); o `aoSalvar` nunca lança |
| Vizinha da reorganização quebra depois do `copia.sh ida` | falha à toa na suíte de outra frente | P4 (texto da prévia + inverso na txn) exercitado no ensaio (P8) |
| LIFO das voltas | volta fora de ordem | guardas md5 recusam; RODAR e memória dizem a ordem |
| `:5173` grava em produção | QA deixa resíduo | D2: card e resíduos combinados com o dono ANTES |

## 6. Dúvidas que só o dono responde

| # | Pergunta | Recomendação |
|---|---|---|
| D1 | A 1ª geração (card sem nenhum SKU) continua AUTOMÁTICA no Salvar ou também vira prévia? | **A — automática** (só cria, nada se perde; acontece no próprio Salvar; "Regerar" mostra antes para quem quiser). O banco já aceita `'criar'` nas RPCs se o dono escolher B (~1 task pequena de front) |
| D2 | QA no `:5173` (= PRODUÇÃO): pode gravar SKUs (Regerar + 1 à mão) no card de teste combinado ("Blusa Teste", P-44), deixando resíduo listado antes? Se a Loja Teste não tiver Formato do SKU em produção, pode configurá-lo para a QA? | **Sim ao resíduo listado; Formato só se faltar**, com o texto combinado no painel |
| D3 | Precisa de mockup da prévia (aviso + "a gravar" + ↺) antes da Task 5? | **Não** — mudança pequena dentro do layout aprovado; textos travados no plano; a QA mostra no `:5173` |

## 7. Autorrevisão (cobertura da spec)

| Spec | Onde |
|---|---|
| §4.1.1 plano puro + executor; 9 novas + 3 redefinidas; nomes fora dos padrões | Task 2 (Steps 2–4), P1 |
| §4.1.2 regras do plano (manuais primeiro, órfã antes, laço, conflitos, mensagens) | Task 2 Step 3 (`PLANO`); Task 3 Steps 1–2 |
| §4.1.3 `skus_previa` STABLE, guarda editar, validações, `previa` por linha, estados da tela | Task 2 Step 3; Task 3 Step 2; Task 1 (`situacaoPrevia`) |
| §4.1.4 `aplicar_skus_modelo`: trava, salvos, erro ⇒ RAISE, assinatura antes/depois, estrito | Task 2 Step 3 (`APLICAR_CORE`); Task 3 Step 2 |
| §4.1.5 ACL #9 | Task 2 Steps 4 e 6; Task 3 Step 2 |
| §4.1.6 migration gerada, guarda, `$pos$`, encoding, NOTIFY, só funções, +9\|+0, inverso, LIFO | Task 2; Task 4 (RODAR) |
| §4.2.1 "a gravar" fora do Draft, `dirty`, Descartar, Desfazer prévia, ↺ | Task 1; Task 5 Steps 3–4 e 7 |
| §4.2.2 prévia na tela (query, atraso, REF da prévia, fail-closed, aviso, grade suja) | Task 1 (`lerPrevia`, `refParaPrevia`); Task 5 Steps 3–4 |
| §4.2.3 Regerar sem AlertDialog, liberado com rascunho sujo | Task 1 (`podeRegerar`); Task 5 Step 4 |
| §4.2.4 SKU à mão em rascunho | Task 1 (`digitarSku`); Task 5 Step 4 |
| §4.2.5 Salvar: modelo → SKUs → 1ª geração; erros; P0409; Enviar à Explosão | Task 5 Steps 3, 6–7 |
| §4.2.6 colaboração (invalidação, P0409, manter/usar, presença) | Task 5 Steps 4 e 7; Task 3 Step 2; QA Task 6 |
| §4.2.7 só leitura | Task 1 (`podeRegerar`); Task 5 (`enabled` da prévia, `editavel`) |
| §4.2.8 selo e textos | Task 1 (`seloCodigos`, constantes); Task 5 Step 4 |
| §4.3 1ª geração automática (D1) | Task 5 (`gerarSeFaltar` intocado, depois do `aplicarAGravar`) |
| §6 testes (unit, integração txn, vizinhas, QA) | Tasks 1, 3, 4 (ensaio), 6 |
| §7 produção (ordem, scripts, RODAR, volta) | Task 4; Task 6 Steps 2–3 |
| Portões (G-plano, G-migration, G-scripts, G-commit, G-produção, G-deploy) | §4; Tasks 3–6 |
