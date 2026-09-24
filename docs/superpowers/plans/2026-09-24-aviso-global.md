# Aviso Global — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O super admin envia, pela tela nova Admin Mestre → Avisos, um aviso **Informativo** (faixa discreta que fecha) ou de **Manutenção** (faixa vermelha fixa com contagem + cartão "Entendi" que não interrompe o trabalho) para todas as lojas ou lojas escolhidas; chega NA HORA para quem está com o sistema aberto e vale até a validade.

**Architecture:**
- Banco: UMA tabela nova `public.avisos_globais` (migration aditiva `20261001100000`), RLS com 4 policies (`is_super_admin()` cria/encerra/lê tudo; qualquer autenticado lê só os ATIVOS da loja dele via `get_user_tenant_id()`; loja inativa = sentinela nil não lê) e permissões por coluna. Nenhuma função, gatilho ou publicação.
- Entrega: BROADCAST "toque" sem conteúdo no canal global `avisos-globais` → cada cliente refaz a busca (que passa pela RLS). Rede de segurança: busca refeita ao (re)entrar no canal, na volta da aba, no `online` e no foco.
- Front: lógica pura em `src/lib/aviso-global.ts` (+ `src/lib/hora.ts`); hook `useAvisosGlobais`; `<AvisosGlobais/>` montado 1× no layout `_authenticated.tsx` (faixa sticky + cartão em portal, isolado do "clique fora" do Radix); tela `/admin/avisos` + Dialog "Novo aviso" + `HoraField`.

**Tech Stack:** Vite + React 19.2 + TypeScript (strict) + TanStack Router/Query v5 + supabase-js 2.108.1 (realtime-js 2.108.1) + Radix/shadcn + lucide-react + sonner + date-fns 4. Testes: Vitest (`tests/unit`, `environment: node`) + integração `pg` em BEGIN…ROLLBACK na CÓPIA LOCAL + Playwright (QA na cópia, não commitado). Postgres 17.6 (produção e cópia). Shell: scripts `bash` (macOS `/bin/bash` 3.2).

**Spec:** `docs/superpowers/specs/2026-09-24-aviso-global-design.md` (desenho aprovado pelo dono em 24/set). Memória: `project_aviso_global`.

## Global Constraints

**Sequência (OBRIGATÓRIA — ordem do dono, 24/set)**
- A migration vai a PRODUÇÃO **só DEPOIS da F1 (kanban automático)** aplicada em produção com a verificação pós-apply OK (runbook `.superpowers/sdd/2026-09-22-kanban-automatico-f1-banco/task-18-runbook-v2.md`, Step 7). O pré-voo da F1 compara a fidelidade produção × `fidelidade_ref_local.txt` e PARARIA com a tabela do aviso a mais. O `ida-producao.sh` deste plano RECUSA se a F1 não estiver no banco.
- Número da migration: **`20261001100000`** (> `20260930180000`, a coluna da F3.1).
- Ponta a ponta: Tasks 0–6 (worktree, código, QA na cópia, G-commit) → **F1 em produção (outro plano)** → Task 7 (o DONO aplica a migration em produção, com `pg_dump` antes) → Task 8 (merge fast-forward + deploy, decisão do dono). **Nunca merge nem deploy antes da Task 7** (sem a tabela, a faixa some em silêncio, mas a tela Avisos quebra no `:5173` do dono, que grava em produção).
- Fase **independente** da campanha: worktree `.claude/worktrees/aviso-global`, branch `aviso-global`, nascida da ponta de `feature/plan-tecido-a1` (hoje `a044759`; a Task 0 grava o sha em `.superpowers/aviso/BASE`). Não depende de F2/F3.x e não toca arquivo delas (conferido 24/set: nenhuma branch f2/f31/f32/f33/f34 mexe em `_authenticated.tsx`, `app-sidebar.tsx`, `admin/index.tsx`, `routeTree.gen.ts` ou `package*.json`).

**Repositório e commits**
- `MAIN="/Users/sunglee/PLM + Criação/plm-pcp"` · `WT="$MAIN/.claude/worktrees/aviso-global"`.
- Commit: `git add -- <SÓ os arquivos NOVOS da task>` e depois `git commit --only -m "…" -- <TODOS os paths da task>` + `git show --stat HEAD` (só os da task). Nunca `git add .`/`-A`/`commit -a`. ⛔ **Sem `git stash`.** Toda mensagem termina com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Sem push (é do dono).
- `src/routeTree.gen.ts` só entra em commit na **Task 4** (rota nova); nas outras o `gates.sh` desfaz o que o build mexer.
- Caminhos permitidos (o `gates.sh` confere): `supabase/migrations/20261001100000_aviso_global.sql`, `supabase/rollback/20261001100000_aviso_global_down.sql`, `src/lib/aviso-global.ts`, `src/lib/hora.ts`, `src/hooks/useAvisosGlobais.ts`, `src/components/avisos/{AvisosGlobais,NovoAvisoDialog}.tsx`, `src/components/shared/HoraField.tsx`, `src/routes/_authenticated.tsx`, `src/routes/_authenticated/admin/{avisos,index}.tsx`, `src/components/app-sidebar.tsx`, `src/routeTree.gen.ts`, `tests/unit/aviso-global{,-componente}.test.ts`, `tests/integration/aviso-global.test.ts`, `tests/e2e/aviso-global-qa.spec.ts` (este NUNCA commitado). Nada em `src/components/ui/`, `nav.ts`, `permissions-catalog.ts`, `realtime-invalidation-map.ts`, `package*.json`.

**Banco**
- NUNCA teste nem DDL em produção. `/tmp/dburl.txt` = PRODUÇÃO e `tests/integration/db.ts` cai nele sem `DATABASE_URL` → todo teste de integração roda com `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres` (cópia local); o teste do aviso RECUSA DDL fora dela (`exigeBancoLocal`). Leitura na cópia fora dos testes: `PGOPTIONS='-c default_transaction_read_only=on'`.
- PROIBIDO `psql -f`/`\i` de migration dentro de transação de teste (incidentes 15/set e 23/set) e PROIBIDO "probe exploratório" fora do harness. SQL fora do harness SÓ pelo `aplica_v2` (`.superpowers/aviso/mig/aplica.sh`, cópia literal do bloco de apoio v2 da F1) e SÓ em 3 usos: ensaio na cópia (Task 1), tabela na cópia para o QA (Task 5) e produção (Task 7, pelo DONO).
- Produção: SÓ o dono roda (o classificador bloqueia o agente), com `pg_dump` completo ANTES (plano Supabase SEM PITR) — o `ida-producao.sh` faz o backup e para se ele falhar. Nenhuma leitura em produção pelos agentes.
- Migration aditiva, `BEGIN;`/`COMMIT;` (1 de cada, em linha própria), idempotente, **sem timeout embutido** (o `aplica_v2` injeta `SET LOCAL lock_timeout = '500ms'` + `SET LOCAL transaction_timeout = '3s'` logo depois do `BEGIN;`), inverso em `supabase/rollback/`. **Sem função** → invariante #9 não se aplica (se uma revisão futura puser função: `_core` + `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` + conferir `has_function_privilege`).
- A migration só cria objetos novos → não trava tabela existente e não congela o app de teste `:5188` do dono. Mesmo assim: nunca rodar teste/ensaio do aviso junto com a suíte da F1 na cópia (conferir `ps` antes).

**Realtime** — broadcast "toque" (evento `mudou`, payload sem dado) no canal `avisos-globais` + busca pela RLS (spec §4). A tabela NÃO entra na publicação `supabase_realtime` nem no `realtime-invalidation-map.ts`.

**UI (`docs/design/ui-padroes.md` §A/§G/§Q)** — novo = Dialog (`fixedFooter mobileFull`, guarda de não salvo, rodapé Voltar · Enviar); datas `<DateField>` + hora `<HoraField>` (nunca `<input type="date|time">`); erros `mensagemErro()`; cor só por token (`destructive`, `--tone-*`, `--elevation-*`); ícones lucide por `className`; alvos 44 px no mobile; mobile 360 sem overflow horizontal. Anti-drift ATIVO: nenhum hit NOVO. **Cartão de Manutenção: nunca Dialog/AlertDialog/Sheet, nunca `autoFocus`; o teste estático `tests/unit/aviso-global-componente.test.ts` trava as 3 proteções** (isolar `pointerdown`, `pointer-events-auto`, `onMouseDown preventDefault`).

**Gates (toda task de código)** — `bash .superpowers/aviso/gates.sh`: `npm run build` ok · `npx tsc --noEmit` = **0** erro (o build NÃO faz type-check) · `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit` com o MESMO conjunto de falhas da linha de base (hoje 2, do anti-drift: `DocPrintCasca.tsx`/`OcDocumentoPrint.tsx`) · nenhum hit do anti-drift em arquivo do aviso · diff só nos caminhos permitidos. NUNCA `npx vitest run` sem caminho.

**QA na cópia (Task 5)** — variante do app de teste em **`:5182`**, gerada pelo `banco-local/app-teste-variantes/criar-variante.sh` (a porta 5182 entra no `case` com backup e SAI no fim do QA — a receita da F3.4 casa a linha LITERAL). Guarda invertida: qualquer requisição a `*.supabase.co` reprova. Nunca `:5173` nem `:5183`–`:5188` (nem `:5198`/`:5199`); nunca `npm run dev` + `VITE_*`; porta ocupada ⇒ PARE (nunca matar nada); derrubar só pelo `descer.sh` da variante; nunca junto com outro QA/E2E.

**Modelos e comunicação** — Sonnet executa as Tasks 0–4; Opus revisa: Task 1 (individual — banco/segurança), Tasks 2+3 (um lote — lógica pura + layout de TODAS as telas) e Task 4 (individual — tela de super admin). O controlador faz as Tasks 5 e 6. O DONO faz as Tasks 7 e 8. Sem Fable. Avisos ao dono por CHAT, sem popup de plano (`ExitPlanMode` proibido).

---

## 1. Fatos verificados (24/set/2026, só leitura)

- `feature/plan-tecido-a1` = `a044759`: tem a F1 (migrations `20260930120000…150000`, NÃO aplicadas em produção) e a F3.0; NÃO tem a F3.1 (`20260930180000`, branch `f31/planejamento-campos`) nem a F2.
- Telas de super admin: `admin/lojas.tsx:195-196` e `usuarios.tsx` fazem `if (loading) return null; if (!isSuperAdmin) return <Navigate to="/dashboard" replace />`. O menu delas é o grupo fixo **"Admin Mestre"** em `src/components/app-sidebar.tsx:300-325` (NÃO vem de `nav.ts`), e os cards ficam em `admin/index.tsx:18-26`. `nav.ts`/`permissions-catalog.ts` não têm páginas de admin.
- Layout `_authenticated.tsx`: header `sticky top-0 z-30 h-14` (:128-147); `useRealtimeInvalidation()` (:77) abre 1 canal tenant-scoped por sessão (postgres_changes em 45 tabelas); `useColabRegistro` abre canal por registro e trata "aba voltou visível". `supabase.channel(topic)` REUSA a instância por topic (`RealtimeClient.channel`, realtime-js 2.108.1) — os hooks tiram a remanescente antes; `send()` de broadcast sem o canal ativo cai no REST (com aviso).
- Sheet/Dialog: overlay `fixed inset-0 z-50 bg-black/80` (`ui/sheet.tsx:25`, `ui/dialog.tsx:25`). O `DismissableLayer` do Radix (1.1.12, o que o `react-dialog` usa) fecha o modal num `pointerdown` que chega ao `document` vindo de fora; o modal põe `pointer-events: none` no `body`. Toaster `position="top-center"` (`ui/sonner.tsx`). `MobileActionBar` = portal, `fixed bottom-0 z-40`.
- Tokens: `--destructive`, `--tone-{info,danger,…}-{bg,fg}`, `--elevation-*` (`styles.css:142-159`). Não existe campo de hora no repo (grep `type="time"` = 0) → `HoraField` novo. `DateField` aceita `id`/`aria-label`/`className` (o `className` vai no wrapper, mesclado por `cn`).
- Cópia local (PG 17.6): funções|gatilhos de `public` = `458|263` (a F1 e a coluna da F3.1 estão aplicadas NA CÓPIA). `get_user_tenant_id()` devolve o sentinela nil para loja inativa (menos super admin); `is_super_admin()` lê `user_roles`; ambos `SECURITY DEFINER`. Default ACL de tabela nova em `public` = TUDO para `anon`/`authenticated`/`service_role` (`pg_default_acl`) — por isso a migration faz REVOKE + GRANT por coluna. `postgres` é membro de `anon` e `authenticated`. `public.users.id → auth.users(id)`, `nome NOT NULL`, `role` default `'user'`; `auth.users` sem gatilho. Publicação `supabase_realtime`: 47 tabelas. Serviços locais (Kong/Auth/REST/Realtime) no ar em `127.0.0.1:54321`.
- Usuários da Loja Teste (`37889b78-fffb-404b-8c75-18b7e50a1d9b`) na cópia: só `teste@teste.com` (super admin; senha = a do `.env` → `E2E_EMAIL`/`E2E_PASSWORD`) e `sung.lee@mageclass.com.br` (super admin; `USER_TESTE` dos testes). **Nenhum usuário comum da Loja Teste com senha conhecida** (os de outras lojas são pessoas reais) → o QA usa o super admin nos 2 papéis (o "comum" com os papéis SIMULADOS no navegador) e a RLS de usuário comum de verdade é provada na integração (usuário sintético dentro da transação).
- Harness de migration: o da F1 é LOCAL a `tests/integration/kanban-auto.test.ts:56-128`; `tests/integration/mig-txn.ts` só existe na branch da F3.1 → o do aviso fica LOCAL a `tests/integration/aviso-global.test.ts` (evita conflito add/add no merge).
- `banco-local/app-teste-variantes/criar-variante.sh` aceita hoje `5184|5185|5186|5187` (backup `.bak-pre-f33` já existe); o plano da F3.4 acrescenta a 5183 casando a linha LITERAL (F3.4, Task 9 Step 1).
- Deploy = `npm run deploy` manual, publica o checkout. Última confirmação de deploy: 20/set (memória `project_merge_pendente_ring`: "tudo deployado"; a branch estava em `2768145`, 18/set). Não há marca de deploy no repo.
- **Validação deste plano (24/set, fora do repo):** o SQL, o teste de integração e os scripts rodaram num Postgres 17.6 DESCARTÁVEL (imagem do Supabase, porta 55432, com `tenants`/`users`/`user_roles`/`is_super_admin`/`get_user_tenant_id` copiados da cópia e o `auth.uid()` da cópia): **9/9** na integração, e 3 mutações da migration (sem a guarda nil, reabrir permitido, ler vencidos) derrubam o teste certo; `ensaio-local.sh` e `backup_banco` (pg_dump pelo container) OK; `tsc --noEmit` = 0 num espelho do `src/` com todos os arquivos e edições deste plano; **22/22** testes unitários; anti-drift sem hit novo; o spec do QA compila; a receita da porta 5182 volta o `criar-variante.sh` ao original byte a byte. O QA de navegador NÃO rodou (exige subir o vite — Task 5).

## 2. Estrutura de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `supabase/migrations/20261001100000_aviso_global.sql` (novo) | tabela, CHECKs, RLS (4 policies), permissões por coluna, conferência `DO` | 1 |
| `supabase/rollback/20261001100000_aviso_global_down.sql` (novo) | `DROP TABLE` da tabela nova (+ conferência) | 1 |
| `tests/integration/aviso-global.test.ts` (novo) | estático (forma dos SQL) + banco (RLS, permissões, CHECKs, loja inativa, inverso) — SÓ na cópia | 1 |
| `.superpowers/aviso/mig/{aplica,ensaio-local,copia-qa,ida-producao,volta-producao}.sh` (fora do git) | receita de travas (`aplica_v2`), ensaio, tabela na cópia p/ QA, produção e volta de emergência | 1 (usados em 5 e 7) |
| `.superpowers/aviso/{gates.sh,BASE,unit-fail-t0.txt,logs/}` (fora do git) | gates + linha de base | 0 |
| `src/lib/hora.ts` (novo, puro) | `maskHora`, `horaValida` | 2 |
| `src/lib/aviso-global.ts` (novo, puro) | tipos, constantes, visibilidade, contagem, lista do Admin, formulário, chave de dispensa | 2 |
| `tests/unit/aviso-global.test.ts` (novo) | 19 testes da lógica pura | 2 |
| `src/hooks/useAvisosGlobais.ts` (novo) | busca dos ativos + canal broadcast + rede de segurança + `sinalizarAvisosGlobais` + `useAgora` + `useDispensaAvisos` | 3 |
| `src/components/avisos/AvisosGlobais.tsx` (novo) | faixas + cartão de Manutenção (portal, isolado do modal) | 3 |
| `tests/unit/aviso-global-componente.test.ts` (novo) | trava estática: cartão não-modal, não rouba foco, não fecha o Sheet | 3 |
| `src/routes/_authenticated.tsx` (mod.) | monta `<AvisosGlobais/>` abaixo do header | 3 |
| `src/components/shared/HoraField.tsx` (novo) | campo `hh:mm` mascarado (par do `DateField`) | 4 |
| `src/components/avisos/NovoAvisoDialog.tsx` (novo) | Dialog "Novo aviso" | 4 |
| `src/routes/_authenticated/admin/avisos.tsx` (novo) | tela Avisos (gate super admin, lista, Encerrar agora) | 4 |
| `src/components/app-sidebar.tsx` (mod.) | item "Avisos" no Admin Mestre | 4 |
| `src/routes/_authenticated/admin/index.tsx` (mod.) | card "Avisos" (super admin) | 4 |
| `src/routeTree.gen.ts` (regenerado pelo build) | rota `/admin/avisos` | 4 |
| `tests/e2e/aviso-global-qa.spec.ts` (novo, NUNCA commitado) | QA na cópia (2 contextos, Sheet aberto, destino, informativo, reconexão, mobile 360, gate) | 5 |
| `.superpowers/aviso/porta-5182.py` (fora do git) | põe/tira a porta 5182 no `criar-variante.sh` sem depender da versão da linha | 5 |
| `banco-local/app-teste-variantes/aviso/` (fora do repo) | variante do app de teste em `:5182` | 5 |

## 3. Ordem e dependências

`T0 → T1 → T2 → T3 → T4 → T5 (QA na cópia) → T6 (revisão final + G-commit)` → **F1 em produção (runbook da F1, Step 7 OK)** → `T7 (dono: migration em produção)` → `T8 (merge ff + deploy, dono)`.
- T2–T4 não dependem do banco no código (a busca engole a ausência da tabela), mas o QA (T5) precisa de T1–T4.
- Nada aqui espera a F2/F3.x. Se a `feature/plan-tecido-a1` andar antes da T8, rebase da `aviso-global` sobre ela + gates + integração de novo (T8 Step 1).
- A cópia local termina o QA SEM a tabela (`copia-qa.sh volta`), igual à produção até a T7.

## 4. Revisão e gates por task

| Task | Revisão | Motivo |
|---|---|---|
| 0 | — | ferramentas |
| 1 | **Opus individual** + checklist **G-migration** (abaixo) | banco, RLS, permissões, inverso, receita de travas |
| 2 + 3 | **Opus em lote** (2 junto da 3) | lógica pura + layout de TODAS as telas (Radix/foco/portal) |
| 4 | **Opus individual** | tela de super admin (gate), Dialog, rota nova |
| 5 | — (evidência para a T6) | QA na cópia |
| 6 | **code-reviewer Opus no diff inteiro** + G-commit | portão final |
| 7 | G-migration aprovado + F1 em produção + OK do dono | aplicação final (dono) |

**Checklist G-migration (revisor da Task 1):** (1) só objetos novos — nenhuma tabela/função/gatilho/publicação existente tocada; (2) RLS ligada, 4 policies e textos idênticos à spec §4; (3) `anon` sem nada; `authenticated`: SELECT de tabela, INSERT só nas 6 colunas, UPDATE só em `encerrado_em`, nada de DELETE; (4) sentinela nil barrado na leitura; (5) CHECKs = spec §3; (6) `BEGIN;`/`COMMIT;` 1 de cada, idempotente (2ª ida sem erro), sem timeout embutido; (7) inverso só com o `DROP` da tabela nova; (8) ensaio na cópia `== ENSAIO OK` com contagens iguais antes/depois; (9) teste de integração 9/9 NA CÓPIA; (10) nenhum `psql -f`/`\i` fora do harness.

O revisor recebe `git diff <antes>..<depois>` da(s) task(s), este plano (a task + Global Constraints + §6) e confere arquivo:linha no código real. Achado BLOQUEANTE volta ao implementador na mesma worktree; a task só fecha com o revisor OK.

---

### Task 0: Worktree, ferramentas e linha de base

**Files:**
- Create (fora do git): a worktree `$WT`, `$WT/.env` (cópia), `$WT/.superpowers/aviso/{gates.sh,BASE,unit-fail-t0.txt,logs/,mig/}`.

**Interfaces:**
- Consumes: plano e spec COMMITADOS no `MAIN` pelo controlador (depois do OK do dono) — esta task não os commita.
- Produces: `WT`, branch `aviso-global`, `.superpowers/aviso/BASE` (sha de nascimento), `.superpowers/aviso/gates.sh`, `.superpowers/aviso/unit-fail-t0.txt`.

- [ ] **Step 1: Pré-voo no checkout principal (só leitura)**

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"
git -C "$MAIN" branch --show-current
git -C "$MAIN" rev-parse --short feature/plan-tecido-a1
git -C "$MAIN" worktree list | grep -c "worktrees/aviso-global"
git -C "$MAIN" show-ref --verify --quiet refs/heads/aviso-global && echo "BRANCH aviso-global JÁ EXISTE — PARE" || echo "branch livre"
for p in docs/superpowers/plans/2026-09-24-aviso-global.md docs/superpowers/specs/2026-09-24-aviso-global-design.md; do
  git -C "$MAIN" log -1 --format='%h %s' -- "$p"; git -C "$MAIN" status --porcelain -- "$p"; done
ls "$MAIN/.git/index.lock" 2>/dev/null; echo "lock-check-fim"
ls "$MAIN/supabase/migrations" | awk '$0 >= "20261001100000"'; echo "migrations-fim"
```

Expected: `feature/plan-tecido-a1`; o sha (hoje `a044759` — se for outro, anotar: a worktree nasce da ponta); `0`; `branch livre`; um commit para cada doc e nenhuma linha de status; só `lock-check-fim`; só `migrations-fim` (nenhuma migration ≥ 20261001100000). Plano/spec sem commit ⇒ PARE e avise o controlador. `index.lock` ⇒ espere (NUNCA apague).

- [ ] **Step 2: Criar a worktree e preparar o projeto**

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"
WT="$MAIN/.claude/worktrees/aviso-global"
git -C "$MAIN" check-ignore -q .claude/worktrees/qualquer && echo "worktrees ignoradas: ok"
git -C "$MAIN" worktree add "$WT" -b aviso-global "$(git -C "$MAIN" rev-parse feature/plan-tecido-a1)"
cp "$MAIN/.env" "$WT/.env" && git -C "$WT" check-ignore -q .env && echo ".env ignorado: ok"
mkdir -p "$WT/.superpowers/aviso/logs" "$WT/.superpowers/aviso/mig" && git -C "$WT" check-ignore -q .superpowers/aviso/x && echo ".superpowers ignorado: ok"
git -C "$WT" rev-parse HEAD > "$WT/.superpowers/aviso/BASE" && cat "$WT/.superpowers/aviso/BASE"
cd "$WT" && npm ci
```

Expected: as 3 linhas "ok", o sha completo, `npm ci` sem erro.

- [ ] **Step 3: Criar `.superpowers/aviso/gates.sh`**

Criar `$WT/.superpowers/aviso/gates.sh` com:

```bash
#!/usr/bin/env bash
# Gates de TODA task de código do Aviso Global (sem banco). Uso (raiz da worktree): bash .superpowers/aviso/gates.sh
# Na Task 4 (rota nova): ROTA_AVISOS=1 bash .superpowers/aviso/gates.sh — aí o routeTree.gen.ts regenerado FICA (vai
# no commit); fora dela, se o build mexer no routeTree, é ruído e ele volta ao HEAD.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
L=.superpowers/aviso/logs
mkdir -p "$L"
echo "== build"
npm run build > "$L/build.log" 2>&1 || { tail -30 "$L/build.log"; echo "BUILD FALHOU"; exit 1; }
if ! git diff --quiet -- src/routeTree.gen.ts; then
  if [ "${ROTA_AVISOS:-}" = 1 ]; then
    git diff -- src/routeTree.gen.ts | grep -q "admin/avisos" || { echo "routeTree mudou SEM a rota /admin/avisos — PARE"; exit 1; }
    echo "routeTree regenerado com /admin/avisos (fica p/ o commit da Task 4)"
  else
    git diff --stat -- src/routeTree.gen.ts
    git checkout -- src/routeTree.gen.ts && echo "routeTree: ruído do build desfeito"
  fi
fi
echo "build ok"
echo "== tsc"
N=$(npx tsc --noEmit 2>&1 | tee "$L/tsc.log" | grep -c "error TS")
echo "tsc erros: $N"
[ "$N" = "0" ] || { grep "error TS" "$L/tsc.log" | head -20; exit 1; }
echo "== unit"
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit > "$L/unit.log" 2>&1
grep -E "Test Files|Tests " "$L/unit.log" | tail -2
grep -E "^ *FAIL " "$L/unit.log" | sed -E 's/ +[0-9]+ms$//' | sort -u > "$L/unit-fail.txt"
if diff -u .superpowers/aviso/unit-fail-t0.txt "$L/unit-fail.txt" > /dev/null; then echo "falhas = linha de base"; else
  diff -u .superpowers/aviso/unit-fail-t0.txt "$L/unit-fail.txt"; echo "FALHAS MUDARAM"; exit 1; fi
echo "== anti-drift nos arquivos do aviso"
if grep -E "src/(components/avisos/|lib/aviso-global|lib/hora|hooks/useAvisosGlobais|components/shared/HoraField|routes/_authenticated/admin/avisos)" "$L/unit.log"; then
  echo "HIT NOVO DO ANTI-DRIFT"; exit 1
else echo "sem hit novo"; fi
echo "== só caminhos do aviso"
BASE=$(cat .superpowers/aviso/BASE)
FORA=$( { git diff --name-only "$BASE"; git diff --name-only; git ls-files --others --exclude-standard; } | sort -u \
  | grep -v -E '^(supabase/(migrations|rollback)/20261001100000_aviso_global(_down)?\.sql|src/lib/(aviso-global|hora)\.ts|src/hooks/useAvisosGlobais\.ts|src/components/avisos/(AvisosGlobais|NovoAvisoDialog)\.tsx|src/components/shared/HoraField\.tsx|src/routes/_authenticated\.tsx|src/routes/_authenticated/admin/(avisos|index)\.tsx|src/components/app-sidebar\.tsx|src/routeTree\.gen\.ts|tests/unit/aviso-global(-componente)?\.test\.ts|tests/integration/aviso-global\.test\.ts|tests/e2e/aviso-global-qa\.spec\.ts)$' )
[ -z "$FORA" ] && echo "caminhos: ok" || { echo "$FORA"; echo "ARQUIVO FORA DO AVISO"; exit 1; }
echo "GATES OK"
```

```bash
chmod +x "$WT/.superpowers/aviso/gates.sh" && /bin/bash -n "$WT/.superpowers/aviso/gates.sh" && echo "sintaxe ok"
```

- [ ] **Step 4: Linha de base**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
npm run build > .superpowers/aviso/logs/build-t0.log 2>&1 && echo "build ok"; git checkout -- src/routeTree.gen.ts 2>/dev/null || true
npx tsc --noEmit 2>&1 | grep -c "error TS"
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit > .superpowers/aviso/logs/unit-t0.log 2>&1
grep -E "Test Files|Tests " .superpowers/aviso/logs/unit-t0.log | tail -2
grep -E "^ *FAIL " .superpowers/aviso/logs/unit-t0.log | sed -E 's/ +[0-9]+ms$//' | sort -u > .superpowers/aviso/unit-fail-t0.txt
cat .superpowers/aviso/unit-fail-t0.txt
bash .superpowers/aviso/gates.sh
```

Expected: `build ok`; `0`; as falhas listadas são SÓ do `tests/unit/ui-padroes-antidrift.test.ts` (regras a/e — `DocPrintCasca.tsx`/`OcDocumentoPrint.tsx`); `gates.sh` termina em `GATES OK`. Outra falha na linha de base ⇒ PARE e reporte (não é do aviso, mas muda o gate).

---

### Task 1: Migration + inverso + teste de integração (cópia) + receita de travas + ensaio

**Files:**
- Create: `supabase/migrations/20261001100000_aviso_global.sql`, `supabase/rollback/20261001100000_aviso_global_down.sql`, `tests/integration/aviso-global.test.ts`
- Create (fora do git): `.superpowers/aviso/mig/{aplica.sh,ensaio-local.sh,copia-qa.sh,ida-producao.sh,volta-producao.sh}`

**Interfaces:**
- Consumes: `tests/integration/db.ts` (`hasDb`, `withTx`, `comoUsuario`, `um`, `TENANT_TESTE`, `USER_TESTE`, `ehBancoLocal`) — sem mudar.
- Produces: tabela `public.avisos_globais` com as colunas `id, mensagem, nivel, todas_lojas, lojas, inicio_em, expira_em, encerrado_em, criado_por, created_at`; policies `avisos_globais_super_admin_ler`, `avisos_globais_ler_ativos_da_loja`, `avisos_globais_super_admin_criar`, `avisos_globais_super_admin_encerrar`. Scripts: `aplica_v2 URL arq…`, `prevoo_aviso URL sim|nao`, `confere_ida_aviso URL CONT_ANTES`, `confere_volta_aviso URL CONT_ANTES`, `backup_banco URL pasta rótulo`, `backup_copia`; variáveis `LOCAL`, `MIG`, `INV`, `D`, `BK_LOCAL`, `CONT`, `ESTADO`, `ACL`, `F1`.

- [ ] **Step 1: Escrever o teste (vai falhar: os SQL não existem)**

Criar `tests/integration/aviso-global.test.ts`:

```ts
/**
 * Aviso Global — migration supabase/migrations/20261001100000_aviso_global.sql e inverso
 * supabase/rollback/20261001100000_aviso_global_down.sql (spec docs/superpowers/specs/2026-09-24-aviso-global-design.md).
 *  • Bloco ESTÁTICO (sem banco): forma dos arquivos — 1 BEGIN/1 COMMIT, aditiva, sem função, sem publicação, só a
 *    tabela nova; inverso = só o DROP da tabela nova.
 *  • Bloco DB: aplica DENTRO de BEGIN…ROLLBACK (withTx) — NADA é gravado. ⚠️ DDL SÓ NA CÓPIA LOCAL: o bloco PULA se
 *    DATABASE_URL não for 127.0.0.1:54422 e `aplicarArquivo` recusa (exigeBancoLocal). NUNCA `\i`/`psql -f`.
 *    RLS de verdade: `SET ROLE authenticated|anon` + `request.jwt.claims` (o `postgres` da conexão ignora RLS).
 * Harness: cópia mínima das travas do da F1 (tests/integration/kanban-auto.test.ts:56-128), LOCAL a este arquivo
 * (não cria tests/integration/mig-txn.ts — esse nome é da F3.1, noutra branch).
 * Rodar: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/integration/aviso-global.test.ts
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, USER_TESTE, ehBancoLocal } from "./db";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const LOCAL = ehBancoLocal();
const MIG = "supabase/migrations/20261001100000_aviso_global.sql";
const INV = "supabase/rollback/20261001100000_aviso_global_down.sql";
const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979"; // outra loja real — só como DESTINO de um aviso de teste
const NIL = "00000000-0000-0000-0000-000000000000";
const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");

// ───────────── Harness mínimo (travas do harness da F1) ─────────────
const RE_BEGIN = /^[ \t]*BEGIN[ \t]*;[ \t]*$/im;
const RE_COMMIT = /^[ \t]*COMMIT[ \t]*;[ \t]*$/im;
const todas = (re: RegExp) => new RegExp(re.source, "gim");
const RE_COMENTARIO_LINHA = /--[^\n]*/g;
const RE_COMENTARIO_BLOCO = /\/\*[\s\S]*?\*\//g;
const RE_TXN_CTRL_SOLTA =
  /(^|;)[ \t]*(BEGIN|COMMIT|ROLLBACK|ABORT|START[ \t]+TRANSACTION|SAVEPOINT|RELEASE|END(?!\s*(IF|LOOP|CASE|WHILE)\b))\b[^\n]*;/im;
const semComentarios = (sql: string) => sql.replace(RE_COMENTARIO_BLOCO, "").replace(RE_COMENTARIO_LINHA, "");
const semCorpos = (sql: string) => sql.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "");

function exigeBancoLocal(): void {
  if (!ehBancoLocal()) {
    throw new Error(
      "DDL/migration só na cópia local (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). " +
        "DDL em transação contra produção trava o app de todas as lojas mesmo com ROLLBACK (incidente 23/set).",
    );
  }
}

/** O arquivo SEM o próprio BEGIN;/COMMIT; (exatamente 1 de cada, em linha própria) e sem nenhum outro controle de
 *  transação ou meta-comando psql fora de corpo $…$ — p/ rodar dentro da txn do withTx sem VAZAR. */
function semTransacao(sql: string, nome: string): string {
  const nb = (sql.match(todas(RE_BEGIN)) ?? []).length;
  const nc = (sql.match(todas(RE_COMMIT)) ?? []).length;
  if (nb !== 1 || nc !== 1) {
    throw new Error(`${nome}: esperado 1 "BEGIN;" e 1 "COMMIT;" em linha própria (achei ${nb}/${nc})`);
  }
  const out = sql
    .replace(todas(RE_BEGIN), "-- [harness] BEGIN removido")
    .replace(todas(RE_COMMIT), "-- [harness] COMMIT removido");
  const foraDeCorpos = semComentarios(semCorpos(out));
  if (RE_TXN_CTRL_SOLTA.test(foraDeCorpos)) throw new Error(`${nome}: controle de transação fora de corpo de função — recusado`);
  if (/^[ \t]*\\/m.test(foraDeCorpos)) throw new Error(`${nome}: meta-comando psql (\\i, \\set…) — recusado`);
  return out;
}

async function aplicarArquivo(c: Client, rel: string): Promise<void> {
  exigeBancoLocal(); // 1ª linha: nenhum chamador aplica DDL fora da cópia local
  const sql = semTransacao(ler(rel), rel);
  await c.query("SAVEPOINT aviso_mig");
  try {
    await c.query(sql);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT aviso_mig");
    throw e;
  }
  await c.query("RELEASE SAVEPOINT aviso_mig"); // se algo tivesse comitado, o RELEASE falharia alto
}

// ───────────── Estático (sem banco) ─────────────
/** Comandos do arquivo, sem comentários e sem corpos $…$ (o DO de conferência vira só "DO"). */
const comandos = (sql: string) => semCorpos(semComentarios(sql)).split(";").map((s) => s.trim()).filter(Boolean);

describe("Aviso Global — arquivos da migration (estático, sem banco)", () => {
  it("migration: 1 BEGIN/1 COMMIT, aditiva, sem função/gatilho/publicação e todo comando na tabela nova", () => {
    const m = ler(MIG);
    expect(() => semTransacao(m, MIG)).not.toThrow();
    const cmds = comandos(m);
    expect(cmds[0]).toBe("BEGIN");
    expect(cmds.at(-1)).toBe("COMMIT");
    expect(cmds.some((s) => s.startsWith("CREATE TABLE IF NOT EXISTS public.avisos_globais"))).toBe(true);
    for (const s of cmds) {
      if (s === "BEGIN" || s === "COMMIT" || s === "DO") continue;
      expect(s, s).toMatch(/public\.avisos_globais\b/);
      expect(s, s).not.toMatch(/\b(FUNCTION|TRIGGER|PUBLICATION|DROP\s+TABLE|DROP\s+COLUMN)\b/i);
    }
  });

  it("inverso: 1 BEGIN/1 COMMIT e só o DROP da tabela nova (+ a conferência)", () => {
    const inv = ler(INV);
    expect(() => semTransacao(inv, INV)).not.toThrow();
    expect(comandos(inv)).toEqual(["BEGIN", "DROP TABLE IF EXISTS public.avisos_globais", "DO", "COMMIT"]);
  });

  it("harness: tira 1 BEGIN;/1 COMMIT; e recusa controle de transação solto e meta-comando psql", () => {
    expect(semTransacao("BEGIN;\nSELECT 1;\nCOMMIT;\n", "ok")).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/m);
    expect(() => semTransacao("BEGIN;\nSELECT 1; COMMIT;\nCOMMIT;\n", "x")).toThrow(/controle de transação/);
    expect(() => semTransacao("BEGIN;\n/* x */ ROLLBACK;\nCOMMIT;\n", "x")).toThrow(/controle de transação/);
    expect(() => semTransacao("BEGIN;\n\\i outro.sql\nCOMMIT;\n", "x")).toThrow(/meta-comando/);
    expect(() => semTransacao("SELECT 1;\n", "x")).toThrow(/1 "BEGIN;"/);
    expect(semTransacao("BEGIN;\nDO $$ BEGIN PERFORM 1; END $$;\nCOMMIT;\n", "corpo")).toContain("PERFORM 1");
  });
});

// ───────────── Banco (cópia local, BEGIN…ROLLBACK) ─────────────
type Aviso = { mensagem?: string; nivel?: string; todas?: boolean; lojas?: string[]; inicio?: string; expira?: string };

async function prepara(c: Client): Promise<void> {
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '60s'");
  await aplicarArquivo(c, MIG);
}
async function contagens(c: Client) {
  return um<{ funcoes: string; gatilhos: string }>(c,
    `SELECT (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) AS funcoes,
            (SELECT count(*) FROM pg_trigger t JOIN pg_class k ON k.oid = t.tgrelid
              WHERE k.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal) AS gatilhos`);
}
/** Usuário COMUM sintético (sem papel) da loja; auth.users ANTES (FK de public.users.id). Como postgres. */
async function usuarioComum(c: Client, tenant = TENANT_TESTE): Promise<string> {
  await c.query("RESET ROLE");
  const { id } = await um<{ id: string }>(c, "select gen_random_uuid()::text as id");
  await c.query("insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing", [id, `${id}@aviso.teste`]);
  await c.query(
    `insert into public.users (id, tenant_id, email, nome) values ($1, $2, $3, 'ITEST Aviso comum')
     on conflict (id) do update set tenant_id = excluded.tenant_id`,
    [id, tenant, `${id}@aviso.teste`],
  );
  return id;
}
/** Passa a agir como `uid` sob RLS (authenticated ou anon). */
async function como(c: Client, uid: string, papel: "authenticated" | "anon" = "authenticated"): Promise<void> {
  await c.query("RESET ROLE");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: papel })]);
  await c.query(`SET ROLE ${papel}`);
}
/** Super admin da Loja Teste (USER_TESTE) sob RLS. */
async function comoSuper(c: Client): Promise<void> {
  await c.query("RESET ROLE");
  await comoUsuario(c, USER_TESTE); // fixa users.tenant_id = Loja Teste (txn revertida)
  await c.query("SET ROLE authenticated");
}
/** INSERT como o papel ATUAL (sem forçar colunas fora do GRANT). inicio/expira = expressões SQL de teste. */
async function inserir(c: Client, v: Aviso = {}): Promise<{ id: string }> {
  return um<{ id: string }>(c,
    `insert into public.avisos_globais (mensagem, nivel, todas_lojas, lojas, inicio_em, expira_em)
     values ($1, $2, $3, $4::uuid[], ${v.inicio ?? "now()"}, ${v.expira ?? "now() + interval '30 minutes'"})
     returning id`,
    [v.mensagem ?? "ITEST aviso", v.nivel ?? "manutencao", v.todas ?? true, v.lojas ?? []]);
}
const idsVisiveis = async (c: Client) =>
  (await c.query<{ id: string }>("select id from public.avisos_globais where mensagem like 'ITEST %' order by id")).rows.map((r) => r.id);
/** Espera o erro `code` de `fn` SEM perder a txn: SAVEPOINT antes (a função é chamada só DEPOIS dele — o pg enfileira
 *  na ordem; uma Promise criada antes rodaria antes do SAVEPOINT) e ROLLBACK TO depois. */
async function rejeita(c: Client, fn: () => Promise<unknown>, code: string, rotulo: string): Promise<void> {
  await c.query("SAVEPOINT aviso_rej");
  try {
    await expect(fn(), rotulo).rejects.toMatchObject({ code });
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT aviso_rej"); // o erro aborta a txn: volta ao savepoint p/ seguir
  }
}

describe.skipIf(!hasDb || !LOCAL)("Aviso Global — banco (cópia local, BEGIN…ROLLBACK)", () => {
  it("ida 2× (idempotente): RLS ligada, 4 policies, permissões exatas e NENHUMA função/gatilho novo", async () => {
    await withTx(async (c) => {
      const antes = await contagens(c);
      await prepara(c);
      await aplicarArquivo(c, MIG); // 2ª vez
      expect(await contagens(c)).toEqual(antes);
      expect(await um(c,
        `select c.relrowsecurity as rls,
                (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'avisos_globais') as policies,
                (select count(*)::int from pg_publication_tables where tablename = 'avisos_globais') as publicacoes
           from pg_class c where c.oid = 'public.avisos_globais'::regclass`)).toEqual({ rls: true, policies: 4, publicacoes: 0 });
      expect(await um(c,
        `select has_table_privilege('anon', 'public.avisos_globais', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon_algo,
                has_table_privilege('authenticated', 'public.avisos_globais', 'SELECT') as auth_ler,
                has_table_privilege('authenticated', 'public.avisos_globais', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as auth_tabela,
                has_column_privilege('authenticated', 'public.avisos_globais', 'mensagem', 'INSERT') as ins_mensagem,
                has_column_privilege('authenticated', 'public.avisos_globais', 'criado_por', 'INSERT') as ins_criado_por,
                has_column_privilege('authenticated', 'public.avisos_globais', 'encerrado_em', 'INSERT') as ins_encerrado,
                has_column_privilege('authenticated', 'public.avisos_globais', 'encerrado_em', 'UPDATE') as upd_encerrado,
                has_column_privilege('authenticated', 'public.avisos_globais', 'mensagem', 'UPDATE') as upd_mensagem`)).toEqual({
        anon_algo: false, auth_ler: true, auth_tabela: false, ins_mensagem: true, ins_criado_por: false,
        ins_encerrado: false, upd_encerrado: true, upd_mensagem: false,
      });
    });
  });

  it("super admin lê tudo; usuário comum lê só os ATIVOS da loja dele; encerrar some na hora", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const uid = await usuarioComum(c);
      // sementes como postgres (sem RLS): um vencido e um encerrado
      const vencido = await um<{ id: string }>(c,
        `insert into public.avisos_globais (mensagem, nivel, inicio_em, expira_em)
         values ('ITEST vencido', 'informativo', now() - interval '2 hours', now() - interval '1 hour') returning id`);
      const encerrado = await um<{ id: string }>(c,
        `insert into public.avisos_globais (mensagem, nivel, expira_em, encerrado_em)
         values ('ITEST encerrado', 'informativo', now() + interval '1 hour', now()) returning id`);
      await comoSuper(c);
      const todasLojas = await inserir(c, { mensagem: "ITEST todas" });
      const daLoja = await inserir(c, { mensagem: "ITEST loja teste", nivel: "informativo", todas: false, lojas: [TENANT_TESTE] });
      const outraLoja = await inserir(c, { mensagem: "ITEST outra loja", todas: false, lojas: [AVE_RARA] });
      expect(await idsVisiveis(c)).toEqual([todasLojas.id, daLoja.id, outraLoja.id, vencido.id, encerrado.id].sort());
      await como(c, uid);
      expect(await idsVisiveis(c)).toEqual([todasLojas.id, daLoja.id].sort());
      await comoSuper(c);
      const r = await c.query("update public.avisos_globais set encerrado_em = now() where id = $1 and encerrado_em is null", [todasLojas.id]);
      expect(r.rowCount).toBe(1);
      await como(c, uid);
      expect(await idsVisiveis(c)).toEqual([daLoja.id]);
    });
  });

  it("usuário comum NÃO cria, NÃO encerra, NÃO apaga; anon não lê nada", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const uid = await usuarioComum(c);
      await comoSuper(c);
      const alvo = await inserir(c, { mensagem: "ITEST alvo" });
      await como(c, uid);
      await rejeita(c, () => inserir(c, { mensagem: "ITEST do comum" }), "42501", "comum criando");
      const upd = await c.query("update public.avisos_globais set encerrado_em = now() where id = $1", [alvo.id]);
      expect(upd.rowCount).toBe(0); // a policy de UPDATE é só do super admin: nenhuma linha a atualizar
      await rejeita(c, () => c.query("delete from public.avisos_globais where id = $1", [alvo.id]), "42501", "comum apagando");
      await como(c, uid, "anon");
      await rejeita(c, () => c.query("select id from public.avisos_globais"), "42501", "anon lendo");
      await c.query("RESET ROLE");
      expect((await um<{ encerrado_em: string | null }>(c,
        "select encerrado_em from public.avisos_globais where id = $1", [alvo.id])).encerrado_em).toBeNull();
    });
  });

  it("loja inativa (sentinela nil): o usuário comum não lê nem o de 'todas as lojas'", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const uid = await usuarioComum(c);
      await comoSuper(c);
      await inserir(c, { mensagem: "ITEST loja inativa" });
      await c.query("RESET ROLE");
      await c.query("update public.tenants set ativo = false where id = $1", [TENANT_TESTE]); // txn revertida
      await como(c, uid);
      expect((await um<{ t: string }>(c, "select public.get_user_tenant_id()::text as t")).t).toBe(NIL);
      expect(await idsVisiveis(c)).toEqual([]);
    });
  });

  it("CHECKs e travas de coluna: texto/nível/destino/validade; super admin não forja autor, não edita texto, não reabre, não cria vencido", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoSuper(c);
      const casos: [string, Aviso][] = [
        ["mensagem em branco", { mensagem: "   " }],
        ["mensagem > 500", { mensagem: "x".repeat(501) }],
        ["nível inválido", { nivel: "urgente" }],
        ["lojas escolhidas sem loja", { todas: false, lojas: [] }],
        ["todas as lojas + lista", { todas: true, lojas: [TENANT_TESTE] }],
        ["loja nil", { todas: false, lojas: [NIL] }],
        ["validade antes do início", { inicio: "now() + interval '1 hour'", expira: "now() + interval '30 minutes'" }],
        ["validade > 7 dias", { inicio: "now()", expira: "now() + interval '8 days'" }],
      ];
      for (const [rotulo, v] of casos) await rejeita(c, () => inserir(c, v), "23514", rotulo);
      await rejeita(c, () => c.query(
        `insert into public.avisos_globais (mensagem, nivel, expira_em, criado_por)
         values ('ITEST forjado', 'informativo', now() + interval '1 hour', gen_random_uuid())`), "42501", "forjar criado_por");
      await rejeita(c, () => inserir(c, { inicio: "now() - interval '2 hours'", expira: "now() - interval '1 hour'" }), "42501", "criar vencido");
      const a = await inserir(c, { mensagem: "ITEST coluna" });
      expect((await um<{ criado_por: string }>(c, "select criado_por::text from public.avisos_globais where id = $1", [a.id])).criado_por)
        .toBe(USER_TESTE);
      await rejeita(c, () => c.query("update public.avisos_globais set mensagem = 'mudou' where id = $1", [a.id]), "42501", "editar texto");
      await c.query("update public.avisos_globais set encerrado_em = now() where id = $1", [a.id]);
      await rejeita(c, () => c.query("update public.avisos_globais set encerrado_em = null where id = $1", [a.id]), "42501", "reabrir");
    });
  });

  it("inverso: some a tabela (2× — idempotente) e as contagens voltam", async () => {
    await withTx(async (c) => {
      const antes = await contagens(c);
      await prepara(c);
      await aplicarArquivo(c, INV);
      await aplicarArquivo(c, INV);
      expect((await um<{ e: boolean }>(c, "select to_regclass('public.avisos_globais') is not null as e")).e).toBe(false);
      expect(await contagens(c)).toEqual(antes);
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar (pela razão certa)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
ps -Ao pid,command | grep -E "[v]itest|[p]laywright"; echo "testes-checados"
PGCONNECT_TIMEOUT=5 PGOPTIONS='-c default_transaction_read_only=on' psql "postgresql://postgres:postgres@127.0.0.1:54422/postgres" -X -A -t -c "select to_regclass('public.avisos_globais') is null"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/integration/aviso-global.test.ts 2>&1 | tee .superpowers/aviso/logs/t1-red.log | grep -E "✓|×|Tests "
```

Expected: só `testes-checados` (nada rodando — senão ESPERE); `t` (a tabela NÃO está na cópia; `f` ⇒ sobrou de um QA: `bash .superpowers/aviso/mig/copia-qa.sh volta` depois do Step 6, ou avise o controlador); o teste do harness passa e os outros 8 FALHAM com `ENOENT … 20261001100000_aviso_global.sql` (ou `_down.sql`). Se falharem por outra razão (conexão, SSL, `exigeBancoLocal`), corrija o AMBIENTE, não o teste. Se o bloco do banco aparecer como `skipped`: a `DATABASE_URL` não é a da cópia — PARE.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20261001100000_aviso_global.sql`:

```sql
-- Aviso Global (desenho aprovado pelo dono em 24/set/2026 — spec docs/superpowers/specs/2026-09-24-aviso-global-design.md).
-- O super admin envia um aviso (Informativo ou Manutenção) para todas as lojas ou para lojas escolhidas; cada usuário
-- autenticado lê SÓ os avisos ATIVOS destinados à loja dele. Tabela GLOBAL (sem tenant_id, de propósito): o destino
-- mora em `todas_lojas`/`lojas`.
--
-- ADITIVA: só objetos NOVOS (a tabela, as policies e as permissões DELA). Nenhuma função, gatilho, publicação ou
-- tabela existente é tocada → nada de `_core` (invariante #9 não se aplica: não há função) e nenhuma trava em tabela
-- que o app usa. A entrega ao vivo é por BROADCAST no canal "avisos-globais" (spec §4), por isso a tabela NÃO entra
-- na publicação supabase_realtime.
--
-- ORDEM (dono, 24/set): vai a PRODUÇÃO só DEPOIS da F1 (kanban automático) — o pré-voo da F1 compara a fidelidade
-- produção × cópia e PARARIA com esta tabela a mais. Número > 20260930180000 (coluna da F3.1).
-- Idempotente: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS/CREATE POLICY + REVOKE/GRANT.
-- Inverso: supabase/rollback/20261001100000_aviso_global_down.sql (apaga o histórico de avisos).
-- As travas de tempo (lock_timeout/transaction_timeout) NÃO ficam no arquivo: o aplica_v2 as injeta logo depois do
-- BEGIN (receita do runbook da F1). Nunca `\i`/`psql -f` dentro de transação de teste.
BEGIN;

CREATE TABLE IF NOT EXISTS public.avisos_globais (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mensagem     text NOT NULL,
  nivel        text NOT NULL,
  todas_lojas  boolean NOT NULL DEFAULT true,
  lojas        uuid[] NOT NULL DEFAULT '{}'::uuid[],
  inicio_em    timestamptz NOT NULL DEFAULT now(),
  expira_em    timestamptz NOT NULL,
  encerrado_em timestamptz,
  criado_por   uuid DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT avisos_globais_mensagem_ck CHECK (char_length(btrim(mensagem)) BETWEEN 1 AND 500),
  CONSTRAINT avisos_globais_nivel_ck CHECK (nivel IN ('informativo', 'manutencao')),
  CONSTRAINT avisos_globais_destino_ck CHECK (
    (todas_lojas AND cardinality(lojas) = 0) OR (NOT todas_lojas AND cardinality(lojas) BETWEEN 1 AND 200)
  ),
  CONSTRAINT avisos_globais_lojas_validas_ck CHECK (
    array_position(lojas, NULL) IS NULL
    AND array_position(lojas, '00000000-0000-0000-0000-000000000000'::uuid) IS NULL
  ),
  CONSTRAINT avisos_globais_validade_ck CHECK (expira_em > inicio_em AND expira_em <= inicio_em + interval '7 days')
);

COMMENT ON TABLE public.avisos_globais IS
  'Aviso Global (Admin Mestre > Avisos). Só super admin cria e encerra. Usuário lê só os ATIVOS da loja dele (RLS). Sem tenant_id de propósito: destino em todas_lojas/lojas. Entrega ao vivo por broadcast no canal avisos-globais.';
COMMENT ON COLUMN public.avisos_globais.inicio_em IS
  'Manutenção: início (alvo da contagem regressiva). Informativo: momento do envio.';
COMMENT ON COLUMN public.avisos_globais.encerrado_em IS
  'Preenchido pelo Encerrar agora. Não volta a NULL (policy de UPDATE).';

ALTER TABLE public.avisos_globais ENABLE ROW LEVEL SECURITY;

-- Leitura 1/2 — super admin vê TUDO (lista do Admin: ativos e antigos, de todas as lojas).
DROP POLICY IF EXISTS avisos_globais_super_admin_ler ON public.avisos_globais;
CREATE POLICY avisos_globais_super_admin_ler ON public.avisos_globais
  FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- Leitura 2/2 — qualquer autenticado vê só os ATIVOS destinados à loja dele. Loja inativa (ou usuário sem loja):
-- get_user_tenant_id() devolve o sentinela nil → não lê nem o de "todas as lojas" (suspensão real, invariante #9).
DROP POLICY IF EXISTS avisos_globais_ler_ativos_da_loja ON public.avisos_globais;
CREATE POLICY avisos_globais_ler_ativos_da_loja ON public.avisos_globais
  FOR SELECT TO authenticated
  USING (
    encerrado_em IS NULL
    AND expira_em > now()
    AND public.get_user_tenant_id() <> '00000000-0000-0000-0000-000000000000'::uuid
    AND (todas_lojas OR public.get_user_tenant_id() = ANY (lojas))
  );

-- Criar — só super admin, e o aviso tem de nascer ainda válido.
DROP POLICY IF EXISTS avisos_globais_super_admin_criar ON public.avisos_globais;
CREATE POLICY avisos_globais_super_admin_criar ON public.avisos_globais
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() AND encerrado_em IS NULL AND expira_em > now());

-- Encerrar — só super admin; a única coluna gravável é encerrado_em (GRANT abaixo) e ela não volta a NULL.
DROP POLICY IF EXISTS avisos_globais_super_admin_encerrar ON public.avisos_globais;
CREATE POLICY avisos_globais_super_admin_encerrar ON public.avisos_globais
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin() AND encerrado_em IS NOT NULL);

-- Sem policy de DELETE: ninguém apaga pela API (o histórico fica). O default do Supabase dá TUDO a anon/authenticated
-- em tabela nova do public — tira e devolve só o necessário. Colunas: o cliente não forja criado_por/created_at/id
-- nem nasce encerrado; no UPDATE só mexe em encerrado_em.
REVOKE ALL ON TABLE public.avisos_globais FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.avisos_globais TO authenticated;
GRANT INSERT (mensagem, nivel, todas_lojas, lojas, inicio_em, expira_em) ON TABLE public.avisos_globais TO authenticated;
GRANT UPDATE (encerrado_em) ON TABLE public.avisos_globais TO authenticated;
GRANT ALL ON TABLE public.avisos_globais TO service_role;

-- Conferência dentro da MESMA transação: se algo saiu diferente, nada fica.
DO $$
BEGIN
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.avisos_globais'::regclass) THEN
    RAISE EXCEPTION 'aviso global: RLS desligada em public.avisos_globais';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'avisos_globais') <> 4 THEN
    RAISE EXCEPTION 'aviso global: esperado 4 policies em public.avisos_globais';
  END IF;
  IF has_table_privilege('anon', 'public.avisos_globais', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'aviso global: anon com privilégio em public.avisos_globais';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.avisos_globais', 'SELECT')
     OR has_table_privilege('authenticated', 'public.avisos_globais', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_column_privilege('authenticated', 'public.avisos_globais', 'criado_por', 'INSERT')
     OR has_column_privilege('authenticated', 'public.avisos_globais', 'encerrado_em', 'INSERT')
     OR has_column_privilege('authenticated', 'public.avisos_globais', 'mensagem', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.avisos_globais', 'encerrado_em', 'UPDATE') THEN
    RAISE EXCEPTION 'aviso global: permissões de authenticated diferentes do previsto';
  END IF;
END
$$;

COMMIT;
```

- [ ] **Step 4: Escrever o inverso**

Criar `supabase/rollback/20261001100000_aviso_global_down.sql`:

```sql
-- INVERSO de supabase/migrations/20261001100000_aviso_global.sql (Aviso Global).
-- ⚠️ APAGA o histórico de avisos (a tabela inteira; policies e permissões vão junto). Só em emergência, com OK do
-- dono: o volta-producao.sh do plano exporta os avisos para CSV ANTES. Tire do ar antes o front que lê a tabela? Não
-- precisa: sem a tabela, a faixa some em silêncio (useAvisosGlobais engole o erro) e a tela Avisos mostra o erro.
-- Idempotente (DROP ... IF EXISTS). Trava: AccessExclusive SÓ na própria tabela (nenhuma outra é tocada).
BEGIN;

DROP TABLE IF EXISTS public.avisos_globais;

DO $$
BEGIN
  IF to_regclass('public.avisos_globais') IS NOT NULL THEN
    RAISE EXCEPTION 'aviso global (inverso): public.avisos_globais ainda existe';
  END IF;
END
$$;

COMMIT;
```

- [ ] **Step 5: Rodar e ver passar**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/integration/aviso-global.test.ts 2>&1 | tee .superpowers/aviso/logs/t1-integracao.log | grep -E "✓|×|Tests "
PGOPTIONS='-c default_transaction_read_only=on' psql "postgresql://postgres:postgres@127.0.0.1:54422/postgres" -X -A -t -c "select to_regclass('public.avisos_globais') is null"
```

Expected: `Tests  9 passed (9)` e `t` (nada ficou na cópia — tudo foi em BEGIN…ROLLBACK). Falha no `DO` de conferência ⇒ a permissão saiu diferente: corrija a MIGRATION (nunca afrouxe o teste). Falha de mecânica do teste (SAVEPOINT, NOT NULL, FK) ⇒ corrija a mecânica sem mudar o contrato e registre no relatório.

- [ ] **Step 6: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
bash .superpowers/aviso/gates.sh
git add -- supabase/migrations/20261001100000_aviso_global.sql supabase/rollback/20261001100000_aviso_global_down.sql tests/integration/aviso-global.test.ts
git commit --only -m "feat(aviso-global): tabela avisos_globais com RLS (só super admin cria/encerra; usuário lê só os ativos da loja) + inverso + teste na cópia local

Migration aditiva 20261001100000 (vai a produção só DEPOIS da F1): tabela nova, 4 policies,
permissões por coluna, sem função/gatilho/publicação. Teste de integração só na cópia (harness local).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- supabase/migrations/20261001100000_aviso_global.sql supabase/rollback/20261001100000_aviso_global_down.sql tests/integration/aviso-global.test.ts
git show --stat HEAD
```

Expected: `GATES OK`; o commit com SÓ os 3 arquivos.

- [ ] **Step 7: Receita de travas (fora do git)**

As funções `espera`, `ativ_vazio`, `com_travas` e `aplica_v2` são CÓPIA LITERAL das linhas 190–239 de `/Users/sunglee/PLM + Criação/savepoints/pre-apply-f1-kanban-auto/bloco_apoio_v2.sh` (bloco de apoio v2 do runbook da F1). Criar `.superpowers/aviso/mig/aplica.sh`:

```bash
#!/usr/bin/env bash
# Receita de travas do Aviso Global = o MESMO modelo do runbook da F1
# (.superpowers/sdd/2026-09-22-kanban-automatico-f1-banco/task-18-runbook-v2.md §2-§3). As funções espera, ativ_vazio,
# com_travas e aplica_v2 são CÓPIA LITERAL do bloco de apoio v2 (savepoints/pre-apply-f1-kanban-auto/bloco_apoio_v2.sh,
# linhas 190-239); só as variáveis e as funções *_aviso/backup_* são do aviso.
#   • o arquivo vai INTEIRO numa mensagem (psql -X -v ON_ERROR_STOP=1 -c, sem -f/-1);
#   • SET LOCAL lock_timeout = '500ms' e SET LOCAL transaction_timeout = '3s' injetados logo depois do `BEGIN;`;
#   • nova tentativa SÓ em 55P03/40P01/25P04 (ATIV + ESPERA s, até MAX_FALHAS); qualquer outro erro PARA.
# Uso: SEMPRE num bash, da raiz da worktree — `source .superpowers/aviso/mig/aplica.sh` (só define coisas; nada roda).
[ -n "${BASH_VERSION:-}" ] || { echo 'ERRO: use bash (as funções são de bash)'; return 1 2>/dev/null || exit 1; }
LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
MIG=supabase/migrations/20261001100000_aviso_global.sql
INV=supabase/rollback/20261001100000_aviso_global_down.sql
D="/Users/sunglee/PLM + Criação/savepoints/pre-apply-aviso-global"
BK_LOCAL="/Users/sunglee/PLM + Criação/banco-local/backups"
CONTAINER=supabase_db_banco-local
ATIV="select pid, usename, application_name, state, now() - xact_start as idade_txn, left(query, 60) as consulta from pg_stat_activity where datname = current_database() and backend_type = 'client backend' and pid <> pg_backend_pid() and state <> 'idle' and xact_start < now() - interval '5 seconds' order by xact_start"
# funções | gatilhos de public (a migration não cria nenhum dos dois: tem de ficar IGUAL antes/depois)
CONT="select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'), (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal)"
# tabela existe | nº de policies dela   (antes: f|0 · depois da ida: t|4)
ESTADO="select to_regclass('public.avisos_globais') is not null, (select count(*) from pg_policies where schemaname = 'public' and tablename = 'avisos_globais')"
# RLS | anon tem algo | authenticated lê | authenticated tem INSERT/UPDATE/DELETE de TABELA | UPDATE só de encerrado_em | em publicação
# (esperado depois da ida: t|f|t|f|t|0)
ACL="select (select c.relrowsecurity from pg_class c where c.oid = 'public.avisos_globais'::regclass), has_table_privilege('anon', 'public.avisos_globais', 'SELECT,INSERT,UPDATE,DELETE'), has_table_privilege('authenticated', 'public.avisos_globais', 'SELECT'), has_table_privilege('authenticated', 'public.avisos_globais', 'INSERT,UPDATE,DELETE'), has_column_privilege('authenticated', 'public.avisos_globais', 'encerrado_em', 'UPDATE'), (select count(*) from pg_publication_tables where tablename = 'avisos_globais')"
# F1 (kanban automático) já está no banco? (produção: o aviso SÓ vai depois dela — ordem do dono, 24/set)
F1="select to_regclass('public.kanban_snapshot') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_config' and column_name = 'kanban_automatico')"

# ── CÓPIA LITERAL do bloco de apoio v2 da F1 (linhas 190-239) ──
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

# ── Aviso Global ──
# Pré-voo (só leitura). $2 = "sim" exige a F1 já no banco (produção); "nao" na cópia local.
prevoo_aviso() {  # uso: prevoo_aviso URL sim|nao
  echo "== pré-voo Aviso Global (só leitura) $(date '+%F %T')"
  git ls-files --error-unmatch "$MIG" "$INV" > /dev/null 2>&1 || { echo "FALHOU (arquivos): SQL do aviso não está commitado"; return 1; }
  git diff --quiet HEAD -- "$MIG" "$INV" || { echo "FALHOU (arquivos): alteração não commitada no SQL do aviso"; return 1; }
  espera "$1" "select current_setting('server_version_num')::int >= 170000 and exists (select 1 from pg_settings where name = 'transaction_timeout')" "t" "PG >= 17 com transaction_timeout" &&
  { [ "$2" != sim ] || espera "$1" "$F1" "t" "F1 (kanban automático) já está no banco"; } &&
  espera "$1" "$ESTADO" "f|0" "tabela do aviso ainda NÃO existe" &&
  espera "$1" "select to_regprocedure('public.is_super_admin()') is not null and to_regprocedure('public.get_user_tenant_id()') is not null" "t" "funções das policies existem" &&
  ativ_vazio "$1" &&
  echo "== PRÉ-VOO OK $(date '+%T')"
}
# Conferência pós-ida (só leitura). $2 = contagens de ANTES (funções|gatilhos).
confere_ida_aviso() {  # uso: confere_ida_aviso URL CONT_ANTES
  espera "$1" "$ESTADO" "t|4" "tabela criada com 4 policies" &&
  espera "$1" "$ACL" "t|f|t|f|t|0" "RLS · anon sem nada · authenticated lê e só encerra · fora da publicação" &&
  espera "$1" "$CONT" "$2" "nenhuma função/gatilho novo"
}
confere_volta_aviso() {  # uso: confere_volta_aviso URL CONT_ANTES
  espera "$1" "$ESTADO" "f|0" "tabela do aviso removida" &&
  espera "$1" "$CONT" "$2" "contagens = antes"
}
# Backup do banco INTEIRO com o pg_dump 17.6 do container da cópia local (o pg_dump do Mac é 15 e não lê servidor 17).
# Formato custom (-Fc); confere que o dump é legível (pg_restore -l). BACKUP_SO_PUBLIC=1 = só o schema public (usar
# SÓ com o OK do dono, se o dump completo falhar por permissão em schema interno do Supabase — ver o .log).
backup_banco() {  # uso: backup_banco URL pasta rótulo
  local url="$1" dir="$2" rot="$3" f so_public=""
  mkdir -p "$dir" || return 1
  docker ps --filter "name=^${CONTAINER}$" --format '{{.Names}}' | grep -qx "$CONTAINER" \
    || { echo "FALHOU (backup): o container $CONTAINER não está no ar (o pg_dump 17.6 mora nele)"; return 1; }
  [ "${BACKUP_SO_PUBLIC:-}" = 1 ] && so_public="--schema=public"
  f="$dir/${rot}-$(date +%F-%H%M%S).dump"
  echo "== backup ($rot) → $f"
  docker exec -i "$CONTAINER" pg_dump -d "$url" -Fc $so_public > "$f" 2> "$f.log" && [ -s "$f" ] \
    || { echo "FALHOU (backup): pg_dump deu erro — veja $f.log (nada foi aplicado)"; tail -5 "$f.log"; return 1; }
  docker exec -i "$CONTAINER" pg_restore -l < "$f" > "$f.toc" 2>> "$f.log" \
    || { echo "FALHOU (backup): o dump não abre (pg_restore -l) — veja $f.log"; return 1; }
  echo "OK (backup): $f ($(du -h "$f" | cut -f1); $(grep -c 'TABLE DATA public ' "$f.toc") tabelas de public com dados)${so_public:+ — SÓ o schema public}"
}
# Backup da CÓPIA LOCAL (de dentro do container, porta interna 5432, como supabase_admin) em banco-local/backups.
backup_copia() {
  local f
  mkdir -p "$BK_LOCAL" || return 1
  f="$BK_LOCAL/pre-aviso-copia-$(date +%F-%H%M%S).dump"
  docker exec -e PGPASSWORD=postgres "$CONTAINER" pg_dump -h 127.0.0.1 -U supabase_admin -d postgres -Fc > "$f" && [ -s "$f" ] \
    || { echo "FALHOU (backup da cópia)"; rm -f "$f"; return 1; }
  echo "OK (backup da cópia): $f ($(du -h "$f" | cut -f1))"
}
```

Criar `.superpowers/aviso/mig/ensaio-local.sh`:

```bash
#!/usr/bin/env bash
# Task 1 — ENSAIO da receita de travas na CÓPIA LOCAL (127.0.0.1:54422): ida → confere → ida de novo (idempotente)
# → confere → volta → confere. A cópia termina IGUAL (sem a tabela). Só com nenhum vitest/playwright rodando.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
source .superpowers/aviso/mig/aplica.sh || exit 1
ESPERA=3
MAX_FALHAS=3
echo "== ENSAIO Aviso Global na cópia local $(date '+%F %T')"
CONT_ANTES=$(psql "$LOCAL" -X -q -A -t -F'|' -v ON_ERROR_STOP=1 -c "$CONT") || exit 1
echo "contagens antes (funções|gatilhos): $CONT_ANTES"
prevoo_aviso "$LOCAL" nao || exit 1
aplica_v2 "$LOCAL" "$MIG" || exit 1
confere_ida_aviso "$LOCAL" "$CONT_ANTES" || exit 1
aplica_v2 "$LOCAL" "$MIG" || exit 1
confere_ida_aviso "$LOCAL" "$CONT_ANTES" || exit 1
ativ_vazio "$LOCAL" || exit 1
aplica_v2 "$LOCAL" "$INV" || exit 1
confere_volta_aviso "$LOCAL" "$CONT_ANTES" || exit 1
echo "== ENSAIO OK $(date '+%T')"
```

Criar `.superpowers/aviso/mig/copia-qa.sh` (usado na Task 5):

```bash
#!/usr/bin/env bash
# Tabela do aviso NA CÓPIA LOCAL para o QA (Task 5). NUNCA produção: só usa $LOCAL. Uso (raiz da worktree):
#   bash .superpowers/aviso/mig/copia-qa.sh estado|ida|volta
#  • ida   — backup pg_dump -Fc da cópia ANTES; aplica a migration DE VERDADE (aplica_v2) e recarrega o PostgREST local.
#  • volta — no FIM do QA: exporta os avisos de teste (CSV) e aplica o inverso; a cópia volta a NÃO ter a tabela.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
source .superpowers/aviso/mig/aplica.sh || exit 1
L=.superpowers/aviso/logs
mkdir -p "$L"
sem_testes() {
  if ps -Ao command | grep -E "[v]itest|[p]laywright" > /dev/null; then echo "PARE: vitest/playwright rodando (podem estar na cópia) — esperar"; return 1; fi
}
case "${1:-}" in
  estado)
    echo "tabela|policies = $(psql "$LOCAL" -X -q -A -t -F'|' -c "$ESTADO") · funções|gatilhos = $(psql "$LOCAL" -X -q -A -t -F'|' -c "$CONT")" ;;
  ida)
    sem_testes || exit 1
    psql "$LOCAL" -X -q -A -t -F'|' -v ON_ERROR_STOP=1 -c "$CONT" > "$L/copia-cont-antes.txt" || exit 1
    backup_copia || exit 1
    prevoo_aviso "$LOCAL" nao && aplica_v2 "$LOCAL" "$MIG" && confere_ida_aviso "$LOCAL" "$(cat "$L/copia-cont-antes.txt")" || exit 1
    psql "$LOCAL" -X -q -c "NOTIFY pgrst, 'reload schema'" && echo "== TABELA DO AVISO NA CÓPIA (QA). No fim do QA: copia-qa.sh volta" ;;
  volta)
    sem_testes || exit 1
    if lsof -nP -iTCP:5182 -sTCP:LISTEN -t > /dev/null 2>&1; then echo "PARE: a variante :5182 está no ar — descer antes (banco-local/app-teste-variantes/aviso/descer.sh)"; exit 1; fi
    [ -s "$L/copia-cont-antes.txt" ] || { echo "PARE: sem $L/copia-cont-antes.txt (a ida não foi por este script)"; exit 1; }
    X="$BK_LOCAL/avisos-qa-copia-$(date +%F-%H%M%S).csv"
    psql "$LOCAL" -X -q -v ON_ERROR_STOP=1 -c "\copy (select * from public.avisos_globais order by created_at) to '$X' csv header" 2> /dev/null \
      && echo "avisos do QA exportados: $X" || echo "(sem a tabela — nada a exportar)"
    ativ_vazio "$LOCAL" && aplica_v2 "$LOCAL" "$INV" && confere_volta_aviso "$LOCAL" "$(cat "$L/copia-cont-antes.txt")" || exit 1
    psql "$LOCAL" -X -q -c "NOTIFY pgrst, 'reload schema'" && echo "== TABELA DO AVISO FORA DA CÓPIA" ;;
  *) echo "uso: copia-qa.sh estado|ida|volta"; exit 2 ;;
esac
```

Criar `.superpowers/aviso/mig/ida-producao.sh` (usado SÓ na Task 7, pelo DONO):

```bash
#!/usr/bin/env bash
# Task 7 — IDA em PRODUÇÃO do Aviso Global. Quem roda é o DONO (o classificador bloqueia o agente), num terminal, da
# raiz da worktree:   bash .superpowers/aviso/mig/ida-producao.sh 2>&1 | tee .superpowers/aviso/logs/prod-ida.log
# Ordem: contagens → BACKUP (pg_dump completo, sem PITR no plano) → pré-voo (F1 já no banco, tabela ausente, sem
# transação longa) + apply NUM COMANDO SÓ → conferência → recarrega o PostgREST.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
source .superpowers/aviso/mig/aplica.sh || exit 1
PROD="$(cat /tmp/dburl.txt)"
echo "== IDA Aviso Global em PRODUÇÃO $(date '+%F %T')"
CONT_ANTES=$(psql "$PROD" -X -q -A -t -F'|' -v ON_ERROR_STOP=1 -c "$CONT") || { echo "FALHOU: não conectou em produção"; exit 1; }
echo "contagens antes (funções|gatilhos): $CONT_ANTES"
backup_banco "$PROD" "$D" producao-pre-aviso || { echo "== PAROU no backup — nada foi aplicado"; exit 1; }
prevoo_aviso "$PROD" sim && aplica_v2 "$PROD" "$MIG" && echo "== IDA OK $(date '+%T')" \
  || { echo "== IDA NÃO CONCLUÍDA (se o erro foi no apply, nada do arquivo ficou) — avisar o controlador"; exit 1; }
confere_ida_aviso "$PROD" "$CONT_ANTES" \
  || { echo "== CONFERÊNCIA FALHOU — avisar o controlador (tabela nova e aditiva; NÃO rodar o inverso sem OK do dono)"; exit 1; }
psql "$PROD" -X -q -v ON_ERROR_STOP=1 -c "NOTIFY pgrst, 'reload schema'" && echo "== PostgREST recarregado"
```

Criar `.superpowers/aviso/mig/volta-producao.sh` (NÃO faz parte do fluxo — só emergência, com OK do dono):

```bash
#!/usr/bin/env bash
# VOLTA em PRODUÇÃO — NÃO faz parte do fluxo: SÓ em emergência, com OK explícito do dono. Apaga o histórico de avisos
# (exporta para CSV ANTES). A faixa some em silêncio; a tela Admin → Avisos passa a mostrar erro até o front sair.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
source .superpowers/aviso/mig/aplica.sh || exit 1
PROD="$(cat /tmp/dburl.txt)"
mkdir -p "$D"
X="$D/avisos_globais-$(date +%F-%H%M%S).csv"
psql "$PROD" -X -q -v ON_ERROR_STOP=1 -c "\copy (select * from public.avisos_globais order by created_at) to '$X' csv header" \
  && echo "export: $(($(wc -l < "$X") - 1)) aviso(s) em $X" || { echo "FALHOU o export — PARE"; exit 1; }
CONT_ANTES=$(psql "$PROD" -X -q -A -t -F'|' -v ON_ERROR_STOP=1 -c "$CONT") || exit 1
ativ_vazio "$PROD" && aplica_v2 "$PROD" "$INV" && confere_volta_aviso "$PROD" "$CONT_ANTES" \
  && psql "$PROD" -X -q -c "NOTIFY pgrst, 'reload schema'" && echo "== VOLTA OK"
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
chmod +x .superpowers/aviso/mig/*.sh
for f in .superpowers/aviso/mig/*.sh; do /bin/bash -n "$f" && echo "ok $f"; done
diff <(awk '/^# ── CÓPIA LITERAL/{p=1;next} /^# ── Aviso Global ──/{p=0} p' .superpowers/aviso/mig/aplica.sh | sed '/^$/d') \
     <(sed -n '190,239p' "/Users/sunglee/PLM + Criação/savepoints/pre-apply-f1-kanban-auto/bloco_apoio_v2.sh" | sed '/^$/d') && echo "funções = bloco da F1 (literal)"
```

Expected: 5 × `ok …`; `funções = bloco da F1 (literal)`.

- [ ] **Step 8: Ensaio da receita na CÓPIA LOCAL (G-migration)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
ps -Ao pid,command | grep -E "[v]itest|[p]laywright"; echo "testes-checados"
/bin/bash .superpowers/aviso/mig/ensaio-local.sh 2>&1 | tee .superpowers/aviso/logs/t1-ensaio-local.log | grep -vE "^(NOTICE|LOCATION)"
```

Expected, na ordem: `contagens antes (funções|gatilhos): 458|263` (ou o que a cópia tiver — anotar); `== PRÉ-VOO OK`; a migration aplicada (`real 0.0x`); `OK (tabela criada com 4 policies): t|4`; `OK (RLS · anon sem nada · authenticated lê e só encerra · fora da publicação): t|f|t|f|t|0`; `OK (nenhuma função/gatilho novo): <igual ao antes>`; a 2ª ida (idempotente) com as mesmas 3 linhas OK; `OK (ATIV)`; o inverso; `OK (tabela do aviso removida): f|0`; `OK (contagens = antes)`; `== ENSAIO OK`. Qualquer `FALHOU`/`PAROU`: PARE e reporte (a cópia pode ter ficado com a tabela: `copia-qa.sh estado`).

---

### Task 2: Lógica pura (hora + aviso-global) + testes

**Files:**
- Create: `src/lib/hora.ts`, `src/lib/aviso-global.ts`, `tests/unit/aviso-global.test.ts`

**Interfaces:**
- Consumes: `date-fns` (`format`, `isValid`, `parse`).
- Produces (`@/lib/hora`): `maskHora(raw: string): string`, `horaValida(hhmm: string): boolean`.
- Produces (`@/lib/aviso-global`): tipos `NivelAviso`, `AvisoGlobal`, `AvisoInsert`, `AvisoForm`, `SituacaoAviso`, `Dispensa`; constantes `NIL_UUID`, `MENSAGEM_MAX` (500), `ANTECEDENCIA_PADRAO_MIN` (5), `VALIDADE_PADRAO_MIN` (30), `VALIDADE_MAX_DIAS` (7), `AVISOS_CANAL` (`"avisos-globais"`), `AVISOS_EVENTO` (`"mudou"`), `NIVEL_ROTULO`, `SITUACAO_ROTULO`; funções `avisoAtivo(a, agora)`, `avisoParaLoja(a, tenantId)`, `avisosVisiveis(lista, tenantId, agora)`, `formatarContagem(ms)`, `textoFaixaManutencao(a, agora)`, `situacaoAviso(a, agora)`, `ordenarAvisosAdmin(lista, agora)`, `rotuloDestino(a, nomes)`, `formatarDataHora(iso)`, `combinarDataHora(dataIso, hhmm): Date | null`, `separarDataHora(d)`, `padraoInicio(agora): Date`, `padraoValidade(inicio): Date`, `formInicial(agora): AvisoForm`, `validarAviso(f, agora): string | null`, `montarAvisoPayload(f, agora): AvisoInsert`, `chaveDispensa(userId, tipo, avisoId)`.

- [ ] **Step 1: Escrever o teste**

Criar `tests/unit/aviso-global.test.ts`:

```ts
// Aviso Global — lógica pura (src/lib/aviso-global.ts + src/lib/hora.ts). Datas montadas no fuso LOCAL
// (new Date(ano, mês, dia, h, m)) → os testes valem em qualquer fuso da máquina.
import { describe, it, expect } from "vitest";
import {
  NIL_UUID, avisoAtivo, avisoParaLoja, avisosVisiveis, chaveDispensa, combinarDataHora, formInicial, formatarContagem,
  formatarDataHora, montarAvisoPayload, ordenarAvisosAdmin, padraoInicio, padraoValidade, rotuloDestino, separarDataHora,
  situacaoAviso, textoFaixaManutencao, validarAviso, type AvisoForm, type AvisoGlobal,
} from "@/lib/aviso-global";
import { horaValida, maskHora } from "@/lib/hora";

const LOJA = "37889b78-fffb-404b-8c75-18b7e50a1d9b";
const OUTRA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979";
const T0 = new Date(2026, 9, 1, 14, 2, 10).getTime(); // 01/10/2026 14:02:10 (local)
const MIN = 60_000;
const iso = (t: number) => new Date(t).toISOString();

function aviso(p: Partial<AvisoGlobal> = {}): AvisoGlobal {
  return {
    id: "a1", mensagem: "Manutenção às 15h", nivel: "manutencao", todas_lojas: true, lojas: [],
    inicio_em: iso(T0 + 5 * MIN), expira_em: iso(T0 + 35 * MIN), encerrado_em: null, created_at: iso(T0), ...p,
  };
}
function form(p: Partial<AvisoForm> = {}): AvisoForm {
  return {
    mensagem: "Vamos atualizar o sistema", nivel: "manutencao", todasLojas: true, lojas: [],
    inicioData: "2026-10-01", inicioHora: "14:10", expiraData: "2026-10-01", expiraHora: "14:40", ...p,
  };
}

describe("hora (hh:mm)", () => {
  it("maskHora: só dígitos, até 4, com ':' depois dos 2 primeiros", () => {
    expect(maskHora("1")).toBe("1");
    expect(maskHora("14")).toBe("14");
    expect(maskHora("143")).toBe("14:3");
    expect(maskHora("1430")).toBe("14:30");
    expect(maskHora("14305")).toBe("14:30");
    expect(maskHora("ab1c4:3x0")).toBe("14:30");
    expect(maskHora("")).toBe("");
  });
  it("horaValida: 00:00–23:59, formato completo", () => {
    expect(horaValida("00:00")).toBe(true);
    expect(horaValida("23:59")).toBe(true);
    expect(horaValida("24:00")).toBe(false);
    expect(horaValida("12:60")).toBe(false);
    expect(horaValida("7:00")).toBe(false);
    expect(horaValida("")).toBe(false);
  });
});

describe("datas do formulário", () => {
  it("combinarDataHora: ISO + hh:mm → instante local; inválido/incompleto → null", () => {
    const d = combinarDataHora("2026-10-01", "14:30");
    expect(d && [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 1, 14, 30]);
    expect(combinarDataHora("2026-02-31", "10:00")).toBeNull();
    expect(combinarDataHora("2026-10-01", "25:00")).toBeNull();
    expect(combinarDataHora("", "10:00")).toBeNull();
    expect(combinarDataHora("2026-10-01", "10:0")).toBeNull();
  });
  it("separarDataHora é o inverso de combinarDataHora", () => {
    expect(separarDataHora(combinarDataHora("2026-12-31", "23:05")!)).toEqual({ data: "2026-12-31", hora: "23:05" });
  });
  it("padraoInicio: ≥ 5 min à frente, no múltiplo de 5 min, segundos zerados; padraoValidade = +30 min", () => {
    for (const t of [T0, new Date(2026, 9, 1, 14, 5, 0).getTime(), new Date(2026, 9, 1, 23, 58, 59).getTime()]) {
      const ini = padraoInicio(t).getTime();
      expect(ini - t).toBeGreaterThanOrEqual(5 * MIN);
      expect(ini - t).toBeLessThan(10 * MIN);
      expect(ini % (5 * MIN)).toBe(0);
    }
    expect(separarDataHora(padraoInicio(T0))).toEqual({ data: "2026-10-01", hora: "14:10" });
    expect(padraoValidade(new Date(T0)).getTime() - T0).toBe(30 * MIN);
  });
  it("formInicial: Manutenção, todas as lojas, início sugerido e validade +30 min", () => {
    expect(formInicial(T0)).toEqual({
      mensagem: "", nivel: "manutencao", todasLojas: true, lojas: [],
      inicioData: "2026-10-01", inicioHora: "14:10", expiraData: "2026-10-01", expiraHora: "14:40",
    });
  });
  it("formatarDataHora: dd/MM/yyyy HH:mm; vazio/inválido → —", () => {
    expect(formatarDataHora(new Date(2026, 9, 1, 14, 30).toISOString())).toBe("01/10/2026 14:30");
    expect(formatarDataHora(null)).toBe("—");
    expect(formatarDataHora("xx")).toBe("—");
  });
});

describe("o que aparece", () => {
  it("avisoAtivo: não encerrado e antes da validade", () => {
    expect(avisoAtivo(aviso(), T0)).toBe(true);
    expect(avisoAtivo(aviso({ encerrado_em: iso(T0) }), T0)).toBe(false);
    expect(avisoAtivo(aviso(), T0 + 35 * MIN)).toBe(false);
  });
  it("avisoParaLoja: todas as lojas ou a loja na lista; loja vazia/nil nunca", () => {
    expect(avisoParaLoja(aviso(), LOJA)).toBe(true);
    expect(avisoParaLoja(aviso({ todas_lojas: false, lojas: [LOJA] }), LOJA)).toBe(true);
    expect(avisoParaLoja(aviso({ todas_lojas: false, lojas: [OUTRA] }), LOJA)).toBe(false);
    expect(avisoParaLoja(aviso(), "")).toBe(false);
    expect(avisoParaLoja(aviso(), NIL_UUID)).toBe(false);
  });
  it("avisosVisiveis: filtra (ativo + loja) e põe Manutenção primeiro, depois pelo início", () => {
    const lista = [
      aviso({ id: "info", nivel: "informativo", inicio_em: iso(T0 - MIN) }),
      aviso({ id: "m2", inicio_em: iso(T0 + 20 * MIN) }),
      aviso({ id: "m1", inicio_em: iso(T0 + 5 * MIN) }),
      aviso({ id: "outra", todas_lojas: false, lojas: [OUTRA] }),
      aviso({ id: "velho", expira_em: iso(T0 - MIN), inicio_em: iso(T0 - 30 * MIN) }),
      aviso({ id: "encerrado", encerrado_em: iso(T0) }),
    ];
    expect(avisosVisiveis(lista, LOJA, T0).map((a) => a.id)).toEqual(["m1", "m2", "info"]);
    expect(avisosVisiveis(lista, "", T0)).toEqual([]);
  });
  it("formatarContagem: mm:ss, h:mm:ss a partir de 1 h, arredonda para cima, nunca negativo", () => {
    expect(formatarContagem(0)).toBe("00:00");
    expect(formatarContagem(999)).toBe("00:01");
    expect(formatarContagem(61_000)).toBe("01:01");
    expect(formatarContagem(59 * MIN + 59_000)).toBe("59:59");
    expect(formatarContagem(60 * MIN)).toBe("1:00:00");
    expect(formatarContagem(-5_000)).toBe("00:00");
    expect(formatarContagem(Number.NaN)).toBe("00:00");
  });
  it("textoFaixaManutencao: contagem até o início; depois, 'Sistema em manutenção'", () => {
    const a = aviso({ inicio_em: iso(T0 + 4 * MIN + 30_000) });
    expect(textoFaixaManutencao(a, T0)).toBe("Manutenção em 04:30");
    expect(textoFaixaManutencao(a, T0 + 4 * MIN + 30_000)).toBe("Sistema em manutenção");
    expect(textoFaixaManutencao(a, T0 + 10 * MIN)).toBe("Sistema em manutenção");
  });
});

describe("lista do Admin", () => {
  it("situacaoAviso: encerrado > expirado > ativo", () => {
    expect(situacaoAviso(aviso(), T0)).toBe("ativo");
    expect(situacaoAviso(aviso(), T0 + 40 * MIN)).toBe("expirado");
    expect(situacaoAviso(aviso({ encerrado_em: iso(T0) }), T0)).toBe("encerrado");
  });
  it("ordenarAvisosAdmin: ativos primeiro, depois os mais novos", () => {
    const lista = [
      aviso({ id: "antigo-ativo", created_at: iso(T0 - 10 * MIN) }),
      aviso({ id: "novo-expirado", created_at: iso(T0), expira_em: iso(T0 - MIN), inicio_em: iso(T0 - 10 * MIN) }),
      aviso({ id: "novo-ativo", created_at: iso(T0 - MIN) }),
    ];
    expect(ordenarAvisosAdmin(lista, T0).map((a) => a.id)).toEqual(["novo-ativo", "antigo-ativo", "novo-expirado"]);
  });
  it("rotuloDestino: 'Todas as lojas' ou os nomes (id curto se desconhecida)", () => {
    expect(rotuloDestino(aviso(), {})).toBe("Todas as lojas");
    expect(rotuloDestino(aviso({ todas_lojas: false, lojas: [LOJA, OUTRA] }), { [LOJA]: "Loja Teste" }))
      .toBe("Loja Teste, Loja 20c84a36");
  });
});

describe("formulário do super admin", () => {
  it("validarAviso: a 1ª regra que falha, em PT", () => {
    expect(validarAviso(form(), T0)).toBeNull();
    expect(validarAviso(form({ mensagem: "   " }), T0)).toBe("Escreva a mensagem do aviso.");
    expect(validarAviso(form({ mensagem: "x".repeat(501) }), T0)).toBe("A mensagem passa de 500 caracteres.");
    expect(validarAviso(form({ todasLojas: false }), T0)).toBe("Escolha pelo menos uma loja (ou marque Todas as lojas).");
    expect(validarAviso(form({ inicioHora: "14:" }), T0)).toBe("Informe o início da manutenção (data e hora).");
    expect(validarAviso(form({ expiraData: "" }), T0)).toBe("Informe a validade (data e hora).");
    expect(validarAviso(form({ expiraHora: "14:10" }), T0)).toBe("A validade tem de ser depois do início.");
    expect(validarAviso(form({ inicioHora: "13:00", expiraHora: "14:00" }), T0)).toBe("Essa validade já passou.");
    expect(validarAviso(form({ expiraData: "2026-10-08", expiraHora: "14:11" }), T0))
      .toBe("A validade vai no máximo até 7 dias depois do início.");
    expect(validarAviso(form({ expiraData: "2026-10-08", expiraHora: "14:10" }), T0)).toBeNull(); // 7 dias exatos
  });
  it("Informativo: início = o momento do envio (campo de início ignorado)", () => {
    expect(validarAviso(form({ nivel: "informativo", inicioData: "", inicioHora: "" }), T0)).toBeNull();
    const p = montarAvisoPayload(form({ nivel: "informativo", inicioData: "", inicioHora: "" }), T0);
    expect(p.inicio_em).toBe(iso(T0));
  });
  it("montarAvisoPayload: texto aparado, lojas sem repetição (e vazias com 'todas'), datas em ISO; lança se inválido", () => {
    expect(montarAvisoPayload(form({ mensagem: "  Oi  " }), T0)).toEqual({
      mensagem: "Oi", nivel: "manutencao", todas_lojas: true, lojas: [],
      inicio_em: combinarDataHora("2026-10-01", "14:10")!.toISOString(),
      expira_em: combinarDataHora("2026-10-01", "14:40")!.toISOString(),
    });
    expect(montarAvisoPayload(form({ todasLojas: false, lojas: [OUTRA, LOJA, OUTRA] }), T0).lojas).toEqual([OUTRA, LOJA].sort());
    expect(montarAvisoPayload(form({ todasLojas: true, lojas: [LOJA] }), T0).lojas).toEqual([]);
    expect(() => montarAvisoPayload(form({ mensagem: "" }), T0)).toThrow("Escreva a mensagem do aviso.");
  });
  it("chaveDispensa: por usuário, por tipo, por aviso", () => {
    expect(chaveDispensa("u1", "entendi", "a1")).toBe("aviso-global:u1:entendi:a1");
    expect(chaveDispensa("u1", "fechado", "a1")).not.toBe(chaveDispensa("u2", "fechado", "a1"));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/aviso-global.test.ts 2>&1 | tail -8
```

Expected: FAIL com `Failed to resolve import "@/lib/aviso-global"` (ou `@/lib/hora`).

- [ ] **Step 3: Escrever `src/lib/hora.ts`**

```ts
// Hora "hh:mm" (24 h) digitada em texto — par do DateField (que guarda a data em ISO yyyy-MM-dd). Puro/testável.
// Motivo do campo de texto: o <input type="time"> nativo segue o idioma do aparelho (AM/PM num celular em inglês).

/** Só dígitos, no máximo 4, com o ":" depois dos 2 primeiros ("123" → "12:3", "1234" → "12:34"). */
export function maskHora(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
}

/** "hh:mm" completo e válido (00:00 a 23:59). */
export function horaValida(hhmm: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59;
}
```

- [ ] **Step 4: Escrever `src/lib/aviso-global.ts`**

```ts
// Aviso Global (spec docs/superpowers/specs/2026-09-24-aviso-global-design.md) — lógica PURA, sem Supabase nem React
// (testada em tests/unit/aviso-global.test.ts). QUEM pode ler cada aviso é decidido no banco (RLS); aqui fica o que
// APARECE na tela (loja, validade, ordem, contagem) e as regras do formulário do super admin.
import { format, isValid, parse } from "date-fns";
import { horaValida } from "@/lib/hora";

export type NivelAviso = "informativo" | "manutencao";

/** Linha de public.avisos_globais como a tela usa (datas em ISO, como o PostgREST devolve). */
export type AvisoGlobal = {
  id: string;
  mensagem: string;
  nivel: NivelAviso;
  todas_lojas: boolean;
  lojas: string[];
  inicio_em: string;
  expira_em: string;
  encerrado_em: string | null;
  created_at: string;
};

/** Payload do INSERT (exatamente as colunas com GRANT INSERT na migration 20261001100000). */
export type AvisoInsert = Pick<AvisoGlobal, "mensagem" | "nivel" | "todas_lojas" | "lojas" | "inicio_em" | "expira_em">;

export const NIL_UUID = "00000000-0000-0000-0000-000000000000";
export const MENSAGEM_MAX = 500;
export const ANTECEDENCIA_PADRAO_MIN = 5;
export const VALIDADE_PADRAO_MIN = 30;
export const VALIDADE_MAX_DIAS = 7;
/** Canal Realtime GLOBAL (broadcast) — o evento é só um "toque" SEM conteúdo; quem recebe refaz a busca (RLS). */
export const AVISOS_CANAL = "avisos-globais";
export const AVISOS_EVENTO = "mudou";
export const NIVEL_ROTULO: Record<NivelAviso, string> = { informativo: "Informativo", manutencao: "Manutenção" };

const MIN = 60_000;
const DIA = 24 * 60 * MIN;
const ms = (iso: string | null | undefined): number => (iso ? new Date(iso).getTime() : Number.NaN);

/** Ainda vale: não foi encerrado e a validade não passou. */
export function avisoAtivo(a: Pick<AvisoGlobal, "encerrado_em" | "expira_em">, agora: number): boolean {
  return !a.encerrado_em && ms(a.expira_em) > agora;
}

/** É para a loja em uso? (Loja vazia/sentinela nil = nenhuma — mesma regra da policy.) O super admin lê TODOS os
 *  avisos pela RLS; é este filtro que faz a faixa dele mostrar só os da loja em visualização. */
export function avisoParaLoja(a: Pick<AvisoGlobal, "todas_lojas" | "lojas">, tenantId: string | null | undefined): boolean {
  if (!tenantId || tenantId === NIL_UUID) return false;
  return a.todas_lojas || (a.lojas ?? []).includes(tenantId);
}

/** O que a faixa mostra agora: ativos da loja; Manutenção primeiro; depois pelo início, pela criação e pelo id. */
export function avisosVisiveis(lista: AvisoGlobal[], tenantId: string | null | undefined, agora: number): AvisoGlobal[] {
  const peso = (a: AvisoGlobal) => (a.nivel === "manutencao" ? 0 : 1);
  return lista
    .filter((a) => avisoAtivo(a, agora) && avisoParaLoja(a, tenantId))
    .sort((x, y) =>
      peso(x) - peso(y)
      || (ms(x.inicio_em) || 0) - (ms(y.inicio_em) || 0)
      || x.created_at.localeCompare(y.created_at)
      || x.id.localeCompare(y.id));
}

/** "mm:ss" (ou "h:mm:ss" a partir de 1 hora), arredondado PARA CIMA — "00:00" só no instante do início. */
export function formatarContagem(restanteMs: number): string {
  if (!Number.isFinite(restanteMs)) return "00:00";
  const total = Math.max(0, Math.ceil(restanteMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dois = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${dois(m)}:${dois(s)}` : `${dois(m)}:${dois(s)}`;
}

/** Texto da faixa de Manutenção: contagem até o início; depois dele, "Sistema em manutenção". */
export function textoFaixaManutencao(a: Pick<AvisoGlobal, "inicio_em">, agora: number): string {
  const inicio = ms(a.inicio_em);
  return agora >= inicio ? "Sistema em manutenção" : `Manutenção em ${formatarContagem(inicio - agora)}`;
}

export type SituacaoAviso = "ativo" | "expirado" | "encerrado";
export const SITUACAO_ROTULO: Record<SituacaoAviso, string> = { ativo: "Ativo", expirado: "Expirado", encerrado: "Encerrado" };

export function situacaoAviso(a: Pick<AvisoGlobal, "encerrado_em" | "expira_em">, agora: number): SituacaoAviso {
  if (a.encerrado_em) return "encerrado";
  return ms(a.expira_em) > agora ? "ativo" : "expirado";
}

/** Lista do Admin: ativos primeiro; dentro de cada grupo, os mais novos primeiro. */
export function ordenarAvisosAdmin(lista: AvisoGlobal[], agora: number): AvisoGlobal[] {
  const peso = (a: AvisoGlobal) => (situacaoAviso(a, agora) === "ativo" ? 0 : 1);
  return [...lista].sort((x, y) => peso(x) - peso(y) || ms(y.created_at) - ms(x.created_at) || x.id.localeCompare(y.id));
}

/** "Todas as lojas" ou os nomes das lojas escolhidas (id curto se a loja não está na lista). */
export function rotuloDestino(a: Pick<AvisoGlobal, "todas_lojas" | "lojas">, nomes: Record<string, string>): string {
  if (a.todas_lojas) return "Todas as lojas";
  return (a.lojas ?? []).map((id) => nomes[id] ?? `Loja ${id.slice(0, 8)}`).join(", ") || "—";
}

/** dd/MM/yyyy HH:mm no fuso do navegador ("—" se vazio/ inválido). */
export function formatarDataHora(iso: string | null | undefined): string {
  const t = ms(iso);
  return Number.isFinite(t) ? format(new Date(t), "dd/MM/yyyy HH:mm") : "—";
}

/** Data ISO (yyyy-MM-dd, do <DateField>) + "hh:mm" → instante no fuso do NAVEGADOR; null se incompleto/inválido. */
export function combinarDataHora(dataIso: string, hhmm: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataIso) || !horaValida(hhmm)) return null;
  const d = parse(`${dataIso} ${hhmm}`, "yyyy-MM-dd HH:mm", new Date());
  return isValid(d) && format(d, "yyyy-MM-dd HH:mm") === `${dataIso} ${hhmm}` ? d : null;
}

export function separarDataHora(d: Date): { data: string; hora: string } {
  return { data: format(d, "yyyy-MM-dd"), hora: format(d, "HH:mm") };
}

/** Início sugerido: pelo menos 5 min à frente, arredondado para o próximo múltiplo de 5 min (segundos zerados). */
export function padraoInicio(agora: number): Date {
  const passo = 5 * MIN;
  return new Date(Math.ceil((agora + ANTECEDENCIA_PADRAO_MIN * MIN) / passo) * passo);
}

/** Validade sugerida: 30 min depois do início (decisão do dono). */
export function padraoValidade(inicio: Date): Date {
  return new Date(inicio.getTime() + VALIDADE_PADRAO_MIN * MIN);
}

/** Estado do formulário "Novo aviso" (datas em ISO do DateField + horas "hh:mm"). */
export type AvisoForm = {
  mensagem: string;
  nivel: NivelAviso;
  todasLojas: boolean;
  lojas: string[];
  inicioData: string;
  inicioHora: string;
  expiraData: string;
  expiraHora: string;
};

export function formInicial(agora: number): AvisoForm {
  const inicio = padraoInicio(agora);
  const i = separarDataHora(inicio);
  const e = separarDataHora(padraoValidade(inicio));
  return {
    mensagem: "", nivel: "manutencao", todasLojas: true, lojas: [],
    inicioData: i.data, inicioHora: i.hora, expiraData: e.data, expiraHora: e.hora,
  };
}

/** Início efetivo: Manutenção = o digitado; Informativo = o momento do envio (o campo nem aparece). */
function inicioDe(f: AvisoForm, agora: number): Date | null {
  return f.nivel === "manutencao" ? combinarDataHora(f.inicioData, f.inicioHora) : new Date(agora);
}

/** Mensagem de erro PT (a 1ª que falhar) ou null. Espelha as CHECKs/policies da migration (o banco é quem garante). */
export function validarAviso(f: AvisoForm, agora: number): string | null {
  const texto = f.mensagem.trim();
  if (!texto) return "Escreva a mensagem do aviso.";
  if (texto.length > MENSAGEM_MAX) return `A mensagem passa de ${MENSAGEM_MAX} caracteres.`;
  if (!f.todasLojas && f.lojas.length === 0) return "Escolha pelo menos uma loja (ou marque Todas as lojas).";
  const inicio = inicioDe(f, agora);
  if (!inicio) return "Informe o início da manutenção (data e hora).";
  const expira = combinarDataHora(f.expiraData, f.expiraHora);
  if (!expira) return "Informe a validade (data e hora).";
  if (expira.getTime() <= inicio.getTime()) return "A validade tem de ser depois do início.";
  if (expira.getTime() <= agora) return "Essa validade já passou.";
  if (expira.getTime() > inicio.getTime() + VALIDADE_MAX_DIAS * DIA) {
    return `A validade vai no máximo até ${VALIDADE_MAX_DIAS} dias depois do início.`;
  }
  return null;
}

/** Payload do INSERT (lança o erro de validarAviso se o formulário não passa). */
export function montarAvisoPayload(f: AvisoForm, agora: number): AvisoInsert {
  const erro = validarAviso(f, agora);
  if (erro) throw new Error(erro);
  const inicio = inicioDe(f, agora) as Date;
  const expira = combinarDataHora(f.expiraData, f.expiraHora) as Date;
  return {
    mensagem: f.mensagem.trim(),
    nivel: f.nivel,
    todas_lojas: f.todasLojas,
    lojas: f.todasLojas ? [] : [...new Set(f.lojas)].sort(),
    inicio_em: inicio.toISOString(),
    expira_em: expira.toISOString(),
  };
}

export type Dispensa = "fechado" | "entendi";
/** Chave (por usuário) do "fechei a faixa informativa" / "Entendi" do cartão — vale só naquele navegador. */
export function chaveDispensa(userId: string, tipo: Dispensa, avisoId: string): string {
  return `aviso-global:${userId}:${tipo}:${avisoId}`;
}
```

- [ ] **Step 5: Rodar e ver passar**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/aviso-global.test.ts 2>&1 | grep -E "Tests |×"
```

Expected: `Tests  19 passed (19)`.

- [ ] **Step 6: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
bash .superpowers/aviso/gates.sh
git add -- src/lib/hora.ts src/lib/aviso-global.ts tests/unit/aviso-global.test.ts
git commit --only -m "feat(aviso-global): lógica pura — visibilidade por loja/validade, contagem mm:ss, lista do Admin, formulário (hora hh:mm, padrões +5/+30 min, validação PT)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/lib/hora.ts src/lib/aviso-global.ts tests/unit/aviso-global.test.ts
git show --stat HEAD
```

Expected: `GATES OK`; commit com os 3 arquivos.

---

### Task 3: Faixa + cartão em todas as telas (hook + componente + layout)

**Files:**
- Create: `src/hooks/useAvisosGlobais.ts`, `src/components/avisos/AvisosGlobais.tsx`, `tests/unit/aviso-global-componente.test.ts`
- Modify: `src/routes/_authenticated.tsx` (import + `<AvisosGlobais />` depois do `</header>`)

**Interfaces:**
- Consumes: Task 2 (`@/lib/aviso-global`); `useAuth` (`user`), `useActiveTenantId()`; `supabase` (`from`, `channel`, `getChannels`, `removeChannel`); `Button`.
- Produces (`@/hooks/useAvisosGlobais`): `AVISOS_ATIVOS_KEY` (`["avisos-globais-ativos"]`), `useAvisosGlobais(): { avisos: AvisoGlobal[]; tenantId: string }`, `sinalizarAvisosGlobais(): Promise<void>`, `useAgora(ligado: boolean, passoMs?: number): number`, `useDispensaAvisos(userId?)`. (`@/components/avisos/AvisosGlobais`): `AvisosGlobais()`. `data-testid`s que o QA usa: `avisos-globais`, `aviso-faixa-manutencao`, `aviso-faixa-informativo`, `aviso-contagem`, `aviso-fechar`, `aviso-cartao`, `aviso-entendi`.

- [ ] **Step 1: Escrever o teste estático (trava o pedido do dono)**

Criar `tests/unit/aviso-global-componente.test.ts`:

```ts
// Aviso Global — trava ESTÁTICA do pedido do dono (24/set): o cartão de Manutenção NÃO pode interromper o trabalho.
// Não é teste de navegador (o QA na cópia, Task 5, prova o comportamento com um Sheet aberto); aqui só se garante que
// ninguém troque o cartão por um Dialog/AlertDialog/Sheet nem tire as 3 proteções do arquivo.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const src = readFileSync(ROOT + "src/components/avisos/AvisosGlobais.tsx", "utf8");
const codigo = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n"); // sem comentários

describe("AvisosGlobais — o cartão de Manutenção não é modal nem rouba foco", () => {
  it("não usa Dialog/AlertDialog/Sheet nem autoFocus", () => {
    expect(codigo).not.toMatch(/@\/components\/ui\/(dialog|alert-dialog|sheet)/);
    expect(codigo).not.toMatch(/@radix-ui\/react-(dialog|alert-dialog)/);
    expect(codigo).not.toMatch(/autoFocus/);
  });
  it("isola o pointerdown (não fecha o Sheet/Dialog aberto) e volta a aceitar clique sob o modal", () => {
    expect(codigo).toMatch(/addEventListener\("pointerdown", parar\)/);
    expect(codigo).toMatch(/const parar = \(e: Event\) => e\.stopPropagation\(\)/);
    expect(codigo).toMatch(/pointer-events-auto/);
    expect(codigo).toMatch(/createPortal\(/);
  });
  it("'Entendi' não tira o foco do campo que a pessoa digita", () => {
    expect(codigo).toMatch(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/aviso-global-componente.test.ts 2>&1 | tail -6
```

Expected: FAIL com `ENOENT … src/components/avisos/AvisosGlobais.tsx`.

- [ ] **Step 3: Escrever `src/hooks/useAvisosGlobais.ts`**

```ts
// Aviso Global — leitura dos avisos ATIVOS + entrega AO VIVO (spec docs/superpowers/specs/2026-09-24-aviso-global-design.md §4).
//
// Entrega: BROADCAST no canal GLOBAL "avisos-globais" (evento "mudou", SEM conteúdo — só um "toque"). Quem recebe
// REFAZ a busca, e a busca passa pela RLS: cada um só lê os ativos da própria loja (o super admin lê todos e filtra pela
// loja em visualização em avisosVisiveis). Por que não postgres_changes: o "Encerrar agora" deixa a linha INVISÍVEL
// para o usuário comum (a policy só mostra ativos) e o Realtime não entrega mudança de linha que o assinante não pode
// ler — o aviso encerrado ficaria na tela até recarregar. O toque não carrega dado nenhum, então o canal público não
// vaza nada; um toque forjado só causa uma busca a mais (juntada em 500 ms).
// Rede de segurança: refaz a busca ao entrar (e REENTRAR, após reconexão) no canal (SUBSCRIBED), quando a aba volta a
// ficar visível e quando o navegador volta a ficar online; o TanStack também refaz ao focar a janela.
// Montado UMA vez (layout _authenticated, via <AvisosGlobais/>).
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { AVISOS_CANAL, AVISOS_EVENTO, chaveDispensa, type AvisoGlobal, type Dispensa } from "@/lib/aviso-global";

/** Prefixo da queryKey da faixa — a tela Avisos invalida por ele depois de criar/encerrar. */
export const AVISOS_ATIVOS_KEY = ["avisos-globais-ativos"] as const;
const COLUNAS = "id,mensagem,nivel,todas_lojas,lojas,inicio_em,expira_em,encerrado_em,created_at";
const JUNTAR_MS = 500;

export function useAvisosGlobais(): { avisos: AvisoGlobal[]; tenantId: string } {
  const { user } = useAuth();
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: [...AVISOS_ATIVOS_KEY, tenantId],
    enabled: !!user && !!tenantId,
    retry: false,
    queryFn: async () => {
      const { data: linhas, error } = await supabase
        .from("avisos_globais" as never)
        .select(COLUNAS)
        .is("encerrado_em", null)
        .gt("expira_em", new Date().toISOString())
        .order("inicio_em", { ascending: true })
        .limit(20);
      // Sem a tabela (front no ar antes da migration) ou sem rede: o aviso NUNCA derruba a tela — some em silêncio.
      if (error) {
        if (import.meta.env.DEV) console.warn("[aviso-global] leitura falhou", error);
        return [] as AvisoGlobal[];
      }
      return (linhas ?? []) as unknown as AvisoGlobal[];
    },
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!user) return;
    // Junta rajadas (um toque + o SUBSCRIBED + a volta da aba) numa busca só.
    const recarregar = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        void qc.invalidateQueries({ queryKey: AVISOS_ATIVOS_KEY });
      }, JUNTAR_MS);
    };
    // Re-mount rápido: supabase.channel() reusa a instância por topic — tira a remanescente antes (useRealtimeInvalidation).
    const remanescente = supabase.getChannels().find((c) => c.topic === `realtime:${AVISOS_CANAL}`);
    if (remanescente) void supabase.removeChannel(remanescente);
    const ch = supabase.channel(AVISOS_CANAL);
    ch.on("broadcast", { event: AVISOS_EVENTO }, () => recarregar());
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") recarregar();
    });
    const aoVoltar = () => {
      if (document.visibilityState === "visible") recarregar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("online", recarregar);
    return () => {
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("online", recarregar);
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      void supabase.removeChannel(ch);
    };
    // qc é estável (mesma instância do QueryClientProvider); recria só ao trocar de usuário.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return { avisos: data ?? [], tenantId };
}

/** "Toque" no canal global depois de CRIAR ou ENCERRAR um aviso: quem está com o sistema aberto refaz a busca na hora.
 *  Usa o canal que o layout já assinou (é o mesmo navegador); sem ele, os outros pegam na próxima busca
 *  (foco/visibilidade/reconexão). Nunca lança. */
export async function sinalizarAvisosGlobais(): Promise<void> {
  const ch = supabase.getChannels().find((c) => c.topic === `realtime:${AVISOS_CANAL}`);
  if (!ch) return;
  try {
    await ch.send({ type: "broadcast", event: AVISOS_EVENTO, payload: { em: Date.now() } });
  } catch {
    /* sem rede: segue — o aviso já está gravado */
  }
}

/** Relógio da contagem: 1 tique por segundo SÓ enquanto houver aviso na lista (sem aviso, nada re-renderiza). */
export function useAgora(ligado: boolean, passoMs = 1000): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ligado) return;
    setAgora(Date.now());
    const t = setInterval(() => setAgora(Date.now()), passoMs);
    return () => clearInterval(t);
  }, [ligado, passoMs]);
  return agora;
}

// "Fechei a faixa" / "Entendi": por usuário e por aviso, no localStorage (conveniência de UM navegador — pode sumir em
// modo privado; aí vale só na memória da aba). Nunca é regra de acesso.
const memoria = new Set<string>();
function lerDispensa(chave: string): boolean {
  if (memoria.has(chave)) return true;
  try {
    return window.localStorage.getItem(chave) === "1";
  } catch {
    return false;
  }
}
function gravarDispensa(chave: string): void {
  memoria.add(chave);
  try {
    window.localStorage.setItem(chave, "1");
  } catch {
    /* modo privado / storage bloqueado: fica só na memória da aba */
  }
}

export function useDispensaAvisos(userId: string | undefined): {
  dispensado: (tipo: Dispensa, avisoId: string) => boolean;
  dispensar: (tipo: Dispensa, avisoId: string) => void;
} {
  const [, setVersao] = useState(0);
  const dispensado = useCallback(
    (tipo: Dispensa, avisoId: string) => !!userId && lerDispensa(chaveDispensa(userId, tipo, avisoId)),
    [userId],
  );
  const dispensar = useCallback(
    (tipo: Dispensa, avisoId: string) => {
      if (!userId) return;
      gravarDispensa(chaveDispensa(userId, tipo, avisoId));
      setVersao((v) => v + 1);
    },
    [userId],
  );
  return { dispensado, dispensar };
}
```

- [ ] **Step 4: Escrever `src/components/avisos/AvisosGlobais.tsx`**

```tsx
// Aviso Global — o que o usuário vê em TODAS as telas autenticadas (montado 1× no layout _authenticated, logo abaixo
// do header). Spec docs/superpowers/specs/2026-09-24-aviso-global-design.md §5.
//  • Informativo: faixa discreta (tom info) que o usuário pode fechar (fica fechada para ele, neste navegador).
//  • Manutenção: faixa VERMELHA fixa, sem fechar, com "Manutenção em mm:ss" → "Sistema em manutenção" depois do
//    início; e um CARTÃO flutuante no canto com a mensagem e "Entendi" — que só fecha o cartão (a faixa continua).
// ⚠️ O cartão NÃO pode interromper o trabalho (pedido do dono, 24/set):
//  – nada de Dialog/AlertDialog/Sheet (não é modal; o teste tests/unit/aviso-global-componente.test.ts trava isso);
//  – não rouba foco: sem autoFocus e com onMouseDown preventDefault no "Entendi" (o campo que a pessoa digita segue
//    focado);
//  – não fecha o Sheet/Dialog aberto: o Radix fecha um modal em qualquer `pointerdown` que chegue ao `document` vindo
//    de fora dele — o cartão PARA a propagação do pointerdown nele mesmo (listener nativo), então o modal nem fica
//    sabendo; e o modal põe `pointer-events: none` no <body> → o cartão volta a receber clique com pointer-events-auto.
//  – vai por PORTAL no body (a sidebar cria containing block para `fixed` — ver MobileActionBar) e fica ACIMA do
//    escurecido do Sheet/Dialog (z-50) com z-[60]; desktop no canto inferior ESQUERDO (o Sheet abre à direita e os
//    toasts ficam no topo), mobile acima da barra de ações (bottom-20).
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Info, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAgora, useAvisosGlobais, useDispensaAvisos } from "@/hooks/useAvisosGlobais";
import { avisosVisiveis, formatarDataHora, textoFaixaManutencao, type AvisoGlobal } from "@/lib/aviso-global";
import { cn } from "@/lib/utils";

export function AvisosGlobais() {
  const { user } = useAuth();
  const { avisos, tenantId } = useAvisosGlobais();
  const agora = useAgora(avisos.length > 0);
  const { dispensado, dispensar } = useDispensaAvisos(user?.id);
  const visiveis = avisosVisiveis(avisos, tenantId, agora);
  const faixas = visiveis.filter((a) => a.nivel === "manutencao" || !dispensado("fechado", a.id));
  const cartao = visiveis.find((a) => a.nivel === "manutencao" && !dispensado("entendi", a.id)) ?? null;
  if (faixas.length === 0 && !cartao) return null;
  return (
    <>
      {faixas.length > 0 && (
        <div className="sticky top-14 z-30" data-testid="avisos-globais">
          {faixas.map((a) => (
            <FaixaAviso key={a.id} aviso={a} agora={agora} onFechar={() => dispensar("fechado", a.id)} />
          ))}
        </div>
      )}
      {cartao && typeof document !== "undefined" &&
        createPortal(
          <CartaoManutencao aviso={cartao} agora={agora} onEntendi={() => dispensar("entendi", cartao.id)} />,
          document.body,
        )}
    </>
  );
}

function FaixaAviso({ aviso, agora, onFechar }: { aviso: AvisoGlobal; agora: number; onFechar: () => void }) {
  const manutencao = aviso.nivel === "manutencao";
  return (
    <div
      role={manutencao ? "alert" : "status"}
      data-testid={manutencao ? "aviso-faixa-manutencao" : "aviso-faixa-informativo"}
      className={cn(
        "flex min-w-0 items-start gap-2 border-b px-4 py-2 text-xs sm:text-sm",
        manutencao
          ? "border-destructive bg-destructive text-destructive-foreground"
          : "border-[var(--tone-info-bg)] bg-[var(--tone-info-bg)] text-[var(--tone-info-fg)]",
      )}
    >
      {manutencao ? (
        <Wrench className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-2">
        {manutencao && (
          <>
            {/* A contagem muda todo segundo: fora do leitor de tela (senão ele "fala" a cada segundo). */}
            <span className="shrink-0 font-semibold tabular-nums" aria-hidden="true" data-testid="aviso-contagem">
              {textoFaixaManutencao(aviso, agora)}
            </span>
            <span className="sr-only">Manutenção programada para {formatarDataHora(aviso.inicio_em)}.</span>
          </>
        )}
        <span className="line-clamp-2 min-w-0 break-words" title={aviso.mensagem}>
          {aviso.mensagem}
        </span>
      </div>
      {!manutencao && (
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar aviso"
          data-testid="aviso-fechar"
          className="-my-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:opacity-70 max-md:h-11 max-md:w-11"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function CartaoManutencao({ aviso, agora, onEntendi }: { aviso: AvisoGlobal; agora: number; onEntendi: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Isola o cartão do "clique fora" do Radix: o pointerdown para AQUI e não chega ao document (onde o Sheet/Dialog
  // aberto escuta para se fechar). Listener NATIVO (não o do React) para não depender de onde o React escuta.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parar = (e: Event) => e.stopPropagation();
    el.addEventListener("pointerdown", parar);
    return () => el.removeEventListener("pointerdown", parar);
  }, []);
  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      data-testid="aviso-cartao"
      className="pointer-events-auto fixed inset-x-4 bottom-20 z-[60] rounded-xl border bg-card p-4 text-card-foreground shadow-[var(--elevation-3)] sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-[22rem]"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)]">
          <Wrench className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-display text-sm font-semibold">Manutenção programada</p>
          <p className="text-xs font-semibold tabular-nums text-[var(--tone-danger-fg)]" aria-hidden="true">
            {textoFaixaManutencao(aviso, agora)}
          </p>
          <p className="whitespace-pre-line break-words text-sm">{aviso.mensagem}</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button
          type="button"
          size="sm"
          data-testid="aviso-entendi"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onEntendi}
        >
          Entendi
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Montar no layout (`src/routes/_authenticated.tsx`)**

Em `src/routes/_authenticated.tsx`, trocar o trecho abaixo (ocorre UMA vez — conferir com `grep -c`):

```tsx
import { useRealtimeInvalidation } from "@/hooks/useRealtimeInvalidation";
```

por:

```tsx
import { useRealtimeInvalidation } from "@/hooks/useRealtimeInvalidation";
import { AvisosGlobais } from "@/components/avisos/AvisosGlobais";
```

Em `src/routes/_authenticated.tsx`, trocar o trecho abaixo (ocorre UMA vez — conferir com `grep -c`):

```tsx
            <StoreClock className="ml-auto shrink-0" />
          </header>
```

por:

```tsx
            <StoreClock className="ml-auto shrink-0" />
          </header>
          {/* Aviso Global (Admin Mestre → Avisos): faixa(s) logo abaixo do header + cartão de Manutenção no canto. */}
          <AvisosGlobais />
```

- [ ] **Step 6: Rodar e ver passar**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/aviso-global-componente.test.ts tests/unit/aviso-global.test.ts 2>&1 | grep -E "Tests |×"
grep -n "AvisosGlobais" src/routes/_authenticated.tsx
```

Expected: `Tests  22 passed (22)`; 2 linhas (import e `<AvisosGlobais />`).

- [ ] **Step 7: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
bash .superpowers/aviso/gates.sh
git add -- src/hooks/useAvisosGlobais.ts src/components/avisos/AvisosGlobais.tsx tests/unit/aviso-global-componente.test.ts
git commit --only -m "feat(aviso-global): faixa (informativo/manutenção) + cartão 'Entendi' em todas as telas, entrega por broadcast + busca pela RLS

O cartão não é modal: isola o pointerdown (não fecha Sheet/Dialog aberto), pointer-events-auto sob o
modal e não rouba foco (onMouseDown preventDefault). Busca refeita ao (re)entrar no canal, na volta da
aba e no online. Sem a tabela, some em silêncio.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/hooks/useAvisosGlobais.ts src/components/avisos/AvisosGlobais.tsx tests/unit/aviso-global-componente.test.ts src/routes/_authenticated.tsx
git show --stat HEAD
```

Expected: `GATES OK`; commit com os 4 arquivos.

---

### Task 4: Tela Admin Mestre → Avisos (rota, Dialog "Novo aviso", HoraField, menu)

**Files:**
- Create: `src/components/shared/HoraField.tsx`, `src/components/avisos/NovoAvisoDialog.tsx`, `src/routes/_authenticated/admin/avisos.tsx`
- Modify: `src/components/app-sidebar.tsx` (import `Megaphone` + item no Admin Mestre), `src/routes/_authenticated/admin/index.tsx` (import + card), `src/routeTree.gen.ts` (regenerado pelo `npm run build`)

**Interfaces:**
- Consumes: Tasks 2–3 (`@/lib/aviso-global`, `@/lib/hora`, `AVISOS_ATIVOS_KEY`, `sinalizarAvisosGlobais`); `DateField`, `UnsavedChangesGuard`/`useUnsavedGuard`, `UnsavedIndicator`, `Breadcrumb`, `StatusBadge`, `SkeletonTableRow`, `MobileActionBar`, `mensagemErro`.
- Produces: rota `/_authenticated/admin/avisos` (`/admin/avisos`); `HoraField({ value, onChange(hhmm), id?, disabled?, className?, "aria-label"? })`; `NovoAvisoDialog({ lojas: LojaDestino[], onClose, requestCloseRef })`, `type LojaDestino = { id; nome; ativo }`; queryKeys `["admin","avisos"]` e `["admin","avisos","lojas"]`; `data-testid`s `aviso-novo`, `aviso-nivel`, `aviso-lojas`, `aviso-enviar`, `aviso-encerrar`, `aviso-linha-<id>`.

- [ ] **Step 1: `src/components/shared/HoraField.tsx`**

```tsx
import { Input } from "@/components/ui/input";
import { maskHora } from "@/lib/hora";
import { cn } from "@/lib/utils";

/**
 * Campo de HORA "hh:mm" (24 h), par do <DateField>: texto mascarado — o <input type="time"> nativo segue o idioma do
 * aparelho (AM/PM num celular em inglês), o mesmo motivo que aposentou o <input type="date">.
 * Emite o texto digitado (pode vir incompleto, ex. "14:"): quem salva valida com `horaValida` (@/lib/hora).
 */
export function HoraField({
  value,
  onChange,
  id,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (hhmm: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Input
      id={id}
      value={value}
      onChange={(e) => onChange(maskHora(e.target.value))}
      inputMode="numeric"
      autoComplete="off"
      placeholder="hh:mm"
      maxLength={5}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn("w-24 tabular-nums", className)}
    />
  );
}
```

- [ ] **Step 2: `src/components/avisos/NovoAvisoDialog.tsx`**

```tsx
// "Novo aviso" (Admin Mestre → Avisos) — Dialog de CRIAR (padrão: novo = Dialog). Só o super admin chega aqui (a
// tela redireciona os outros) e o banco garante de novo (policy de INSERT com is_super_admin()).
// Formulário: nível, mensagem, destino (todas as lojas por padrão, ou lojas escolhidas), início da manutenção
// (só Manutenção — alvo da contagem) e validade (padrão +30 min do início; acompanha o início até ser mexida).
import { useState, type MutableRefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { DateField } from "@/components/shared/DateField";
import { HoraField } from "@/components/shared/HoraField";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { AVISOS_ATIVOS_KEY, sinalizarAvisosGlobais } from "@/hooks/useAvisosGlobais";
import {
  MENSAGEM_MAX, NIVEL_ROTULO, combinarDataHora, formInicial, montarAvisoPayload, padraoValidade, separarDataHora,
  validarAviso, type AvisoForm, type NivelAviso,
} from "@/lib/aviso-global";

export type LojaDestino = { id: string; nome: string; ativo: boolean };

export function NovoAvisoDialog({
  lojas,
  onClose,
  requestCloseRef,
}: {
  lojas: LojaDestino[];
  onClose: () => void;
  requestCloseRef: MutableRefObject<(() => void) | null>;
}) {
  const qc = useQueryClient();
  const [inicial] = useState(() => formInicial(Date.now()));
  const [form, setForm] = useState<AvisoForm>(inicial);
  const [validadeTocada, setValidadeTocada] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(inicial);
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose });
  requestCloseRef.current = requestClose;

  const set = <K extends keyof AvisoForm>(k: K, v: AvisoForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  // A validade acompanha o início (+30 min) até a pessoa mexer nela.
  const mudarInicio = (patch: Partial<Pick<AvisoForm, "inicioData" | "inicioHora">>) =>
    setForm((f) => {
      const g = { ...f, ...patch };
      const ini = validadeTocada ? null : combinarDataHora(g.inicioData, g.inicioHora);
      if (ini) {
        const v = separarDataHora(padraoValidade(ini));
        g.expiraData = v.data;
        g.expiraHora = v.hora;
      }
      return g;
    });
  const mudarValidade = (patch: Partial<Pick<AvisoForm, "expiraData" | "expiraHora">>) => {
    setValidadeTocada(true);
    setForm((f) => ({ ...f, ...patch }));
  };
  const alternarLoja = (id: string, marcado: boolean) =>
    setForm((f) => ({ ...f, lojas: marcado ? [...f.lojas, id] : f.lojas.filter((x) => x !== id) }));
  const lojasAtivas = lojas.filter((l) => l.ativo);

  const enviar = async () => {
    if (enviando) return;
    const agora = Date.now();
    const erro = validarAviso(form, agora);
    if (erro) {
      toast.error(erro);
      return;
    }
    setEnviando(true);
    try {
      const { error } = await supabase.from("avisos_globais" as never).insert(montarAvisoPayload(form, agora) as never);
      if (error) throw error;
      await sinalizarAvisosGlobais();
      qc.invalidateQueries({ queryKey: ["admin", "avisos"] });
      qc.invalidateQueries({ queryKey: AVISOS_ATIVOS_KEY });
      toast.success("Aviso enviado — já aparece para quem está com o sistema aberto.");
      onClose();
    } catch (e) {
      toast.error(mensagemErro(e, "Erro ao enviar o aviso"));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <DialogContent fixedFooter mobileFull>
      <DialogHeader>
        <div className="space-y-1">
          <Breadcrumb items={[{ label: "Admin" }, { label: "Avisos" }, { label: "Novo aviso" }]} />
          <div className="flex items-center gap-2">
            <DialogTitle>Novo aviso</DialogTitle>
            <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
          </div>
        </div>
      </DialogHeader>
      <DialogBody className="space-y-4 py-4">
        <div className="space-y-1">
          <Label htmlFor="aviso-nivel">Nível</Label>
          <Select value={form.nivel} onValueChange={(v) => set("nivel", v as NivelAviso)}>
            <SelectTrigger id="aviso-nivel" data-testid="aviso-nivel">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manutencao">{NIVEL_ROTULO.manutencao} — faixa vermelha fixa, contagem e cartão</SelectItem>
              <SelectItem value="informativo">{NIVEL_ROTULO.informativo} — faixa discreta, o usuário pode fechar</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="aviso-mensagem">Mensagem</Label>
          <Textarea
            id="aviso-mensagem"
            value={form.mensagem}
            maxLength={MENSAGEM_MAX}
            rows={3}
            placeholder="Ex.: O sistema vai passar por manutenção. Salve o que estiver fazendo antes do horário."
            onChange={(e) => set("mensagem", e.target.value)}
          />
          <p className="text-right text-xs tabular-nums text-muted-foreground">
            {form.mensagem.length}/{MENSAGEM_MAX}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="aviso-todas">Todas as lojas</Label>
            <Switch id="aviso-todas" checked={form.todasLojas} onCheckedChange={(v) => set("todasLojas", v)} />
          </div>
          {!form.todasLojas && (
            <div className="grid gap-1 rounded-md border p-2 sm:grid-cols-2" data-testid="aviso-lojas">
              {lojasAtivas.map((l) => (
                <label key={l.id} className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-accent sm:min-h-9">
                  <Checkbox checked={form.lojas.includes(l.id)} onCheckedChange={(v) => alternarLoja(l.id, v === true)} />
                  <span className="min-w-0 truncate">{l.nome}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {form.nivel === "manutencao" && (
          <div className="space-y-1">
            <Label htmlFor="aviso-inicio-data">Início da manutenção</Label>
            <div className="flex flex-wrap items-center gap-2">
              <DateField
                id="aviso-inicio-data"
                className="w-40"
                value={form.inicioData}
                onChange={(e) => mudarInicio({ inicioData: e.target.value })}
                aria-label="Data do início da manutenção"
              />
              <HoraField
                value={form.inicioHora}
                onChange={(v) => mudarInicio({ inicioHora: v })}
                aria-label="Hora do início da manutenção"
              />
            </div>
            <p className="text-xs text-muted-foreground">A faixa mostra a contagem até esse horário.</p>
          </div>
        )}

        <div className="space-y-1">
          <Label htmlFor="aviso-expira-data">Validade (o aviso some sozinho)</Label>
          <div className="flex flex-wrap items-center gap-2">
            <DateField
              id="aviso-expira-data"
              className="w-40"
              value={form.expiraData}
              onChange={(e) => mudarValidade({ expiraData: e.target.value })}
              aria-label="Data da validade"
            />
            <HoraField
              value={form.expiraHora}
              onChange={(v) => mudarValidade({ expiraHora: v })}
              aria-label="Hora da validade"
            />
          </div>
          <p className="text-xs text-muted-foreground">Padrão: 30 minutos depois do início. Máximo: 7 dias.</p>
        </div>
      </DialogBody>
      <DialogFooter className="!flex-row items-center border-t bg-background -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 px-4 sm:px-6 py-3">
        <Button variant="outline" onClick={requestClose} aria-label="Voltar" className="max-sm:aspect-square max-sm:px-0">
          <ArrowLeft className="h-4 w-4 sm:mr-1" />
          <span className="max-sm:sr-only">Voltar</span>
        </Button>
        <Button
          onClick={() => void enviar()}
          disabled={enviando}
          aria-label="Enviar aviso"
          data-testid="aviso-enviar"
          className="ml-auto max-sm:aspect-square max-sm:px-0"
        >
          <Send className="h-4 w-4 sm:mr-1" />
          <span className="max-sm:sr-only">{enviando ? "Enviando…" : "Enviar aviso"}</span>
        </Button>
      </DialogFooter>
      <UnsavedChangesGuard confirm={confirm} message="O aviso ainda não foi enviado." />
    </DialogContent>
  );
}
```

- [ ] **Step 3: `src/routes/_authenticated/admin/avisos.tsx`**

```tsx
// Admin Mestre → Avisos (super admin). Envia aviso Informativo/Manutenção para todas as lojas ou lojas escolhidas e
// lista os ativos e os antigos, com "Encerrar agora". Spec docs/superpowers/specs/2026-09-24-aviso-global-design.md.
// Gate igual a lojas.tsx/usuarios.tsx (isSuperAdmin; senão /dashboard). O banco garante de novo (RLS is_super_admin()).
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Megaphone, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { mensagemErro } from "@/lib/erro-mensagem";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { SkeletonTableRow } from "@/components/shared/Skeletons";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { NovoAvisoDialog, type LojaDestino } from "@/components/avisos/NovoAvisoDialog";
import { AVISOS_ATIVOS_KEY, sinalizarAvisosGlobais } from "@/hooks/useAvisosGlobais";
import {
  NIVEL_ROTULO, SITUACAO_ROTULO, formatarDataHora, ordenarAvisosAdmin, rotuloDestino, situacaoAviso, type AvisoGlobal,
} from "@/lib/aviso-global";

export const Route = createFileRoute("/_authenticated/admin/avisos")({
  component: AvisosPage,
});

const LISTA_KEY = ["admin", "avisos"] as const;

function AvisosPage() {
  const { isSuperAdmin, loading } = useAuth();
  const qc = useQueryClient();
  const [novoAberto, setNovoAberto] = useState(false);
  const novoRequestCloseRef = useRef<(() => void) | null>(null);
  const [encerrarAlvo, setEncerrarAlvo] = useState<AvisoGlobal | null>(null);

  const { data: avisos = [], isLoading } = useQuery({
    queryKey: LISTA_KEY,
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("avisos_globais" as never)
        .select("id,mensagem,nivel,todas_lojas,lojas,inicio_em,expira_em,encerrado_em,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as AvisoGlobal[];
    },
  });
  const { data: lojas = [] } = useQuery({
    queryKey: ["admin", "avisos", "lojas"],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("id,nome,ativo").order("nome");
      if (error) throw error;
      return (data ?? []).map((t) => ({ id: t.id, nome: t.nome, ativo: t.ativo ?? true })) as LojaDestino[];
    },
  });
  const nomes = useMemo(() => Object.fromEntries(lojas.map((l) => [l.id, l.nome])), [lojas]);
  const agora = Date.now();
  const linhas = ordenarAvisosAdmin(avisos, agora);

  const encerrar = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("avisos_globais" as never)
        .update({ encerrado_em: new Date().toISOString() } as never)
        .eq("id", id)
        .is("encerrado_em", null)
        .select("id");
      if (error) throw error;
      return ((data ?? []) as unknown[]).length;
    },
    onSuccess: async (n) => {
      setEncerrarAlvo(null);
      await sinalizarAvisosGlobais();
      qc.invalidateQueries({ queryKey: LISTA_KEY });
      qc.invalidateQueries({ queryKey: AVISOS_ATIVOS_KEY });
      if (n > 0) toast.success("Aviso encerrado — saiu da tela de todos.");
      else toast.info("Este aviso já tinha sido encerrado.");
    },
    onError: (e) => toast.error(mensagemErro(e, "Erro ao encerrar o aviso")),
  });

  if (loading) return null;
  if (!isSuperAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <Button asChild variant="ghost" size="sm" className="max-sm:hidden -ml-2 w-fit text-muted-foreground">
        <Link to="/admin"><ArrowLeft className="mr-1 h-4 w-4" /> Voltar ao Admin</Link>
      </Button>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Megaphone className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight">Avisos</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Avise quem está usando o sistema: Manutenção (faixa vermelha com contagem) ou Informativo.
            </p>
          </div>
        </div>
        <Dialog
          open={novoAberto}
          onOpenChange={(o) => {
            if (!o) {
              const rc = novoRequestCloseRef.current;
              if (rc) rc();
              else setNovoAberto(false);
            } else setNovoAberto(true);
          }}
        >
          <DialogTrigger asChild>
            <Button className="max-sm:hidden" data-testid="aviso-novo">
              <Plus className="h-4 w-4" /> Novo aviso
            </Button>
          </DialogTrigger>
          {/* Monta só quando aberto → o formulário e o guarda nascem limpos a cada abertura. */}
          {novoAberto && (
            <NovoAvisoDialog lojas={lojas} onClose={() => setNovoAberto(false)} requestCloseRef={novoRequestCloseRef} />
          )}
        </Dialog>
      </div>

      <div className="border rounded-lg">
        <Table className="card-table">
          <TableHeader>
            <TableRow>
              <TableHead>Mensagem</TableHead>
              <TableHead>Nível</TableHead>
              <TableHead>Destino</TableHead>
              <TableHead>Início</TableHead>
              <TableHead>Validade</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <SkeletonTableRow cols={7} />
            ) : linhas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum aviso enviado ainda.
                </TableCell>
              </TableRow>
            ) : (
              linhas.map((a) => {
                const situacao = situacaoAviso(a, agora);
                return (
                  <TableRow key={a.id} data-testid={`aviso-linha-${a.id}`}>
                    <TableCell className="max-w-[24rem] font-medium">
                      <span className="line-clamp-2 break-words" title={a.mensagem}>{a.mensagem}</span>
                    </TableCell>
                    <TableCell data-label="Nível">
                      <StatusBadge tone={a.nivel === "manutencao" ? "danger" : "info"}>{NIVEL_ROTULO[a.nivel]}</StatusBadge>
                    </TableCell>
                    <TableCell data-label="Destino" className="text-sm">{rotuloDestino(a, nomes)}</TableCell>
                    <TableCell data-label="Início" className="text-sm tabular-nums">{formatarDataHora(a.inicio_em)}</TableCell>
                    <TableCell data-label="Validade" className="text-sm tabular-nums">{formatarDataHora(a.expira_em)}</TableCell>
                    <TableCell data-label="Situação">
                      <StatusBadge tone={situacao === "ativo" ? "success" : "neutral"}>{SITUACAO_ROTULO[situacao]}</StatusBadge>
                    </TableCell>
                    <TableCell data-label="Ações" className="text-right">
                      {situacao === "ativo" && (
                        <Button variant="outline" size="sm" onClick={() => setEncerrarAlvo(a)} data-testid="aviso-encerrar">
                          <Ban className="h-4 w-4" /> Encerrar agora
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Encerrar é definitivo (o banco não deixa reabrir): confirma. */}
      <AlertDialog open={!!encerrarAlvo} onOpenChange={(o) => { if (!o) setEncerrarAlvo(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar este aviso agora?</AlertDialogTitle>
            <AlertDialogDescription>
              Ele sai na hora da tela de todos os usuários. Não dá para reativar — se precisar, envie um aviso novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={encerrar.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (encerrarAlvo) encerrar.mutate(encerrarAlvo.id);
              }}
            >
              {encerrar.isPending ? "Encerrando…" : "Encerrar agora"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MobileActionBar>
        <Button asChild variant="outline" size="icon" aria-label="Voltar">
          <Link to="/admin"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <Button className="ml-auto" onClick={() => setNovoAberto(true)}>
          <Plus className="h-4 w-4" /> Novo aviso
        </Button>
      </MobileActionBar>
    </div>
  );
}
```

- [ ] **Step 4: Regenerar a árvore de rotas (build) ANTES de ligar os links**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
npm run build > .superpowers/aviso/logs/t4-build.log 2>&1 && echo "build ok"
git diff --stat -- src/routeTree.gen.ts
git diff -- src/routeTree.gen.ts | grep -c "admin/avisos"
```

Expected: `build ok`; `src/routeTree.gen.ts` alterado; contagem ≥ 4 (import, rota, mapas e o bloco do `declare module`). Se o diff trouxer outras linhas além da rota nova, é a saída canônica do gerador — mantenha (vai no commit) e cite no relatório para o revisor.

- [ ] **Step 5: Menu (Admin Mestre) e card do Admin**

Em `src/components/app-sidebar.tsx`, trocar o trecho abaixo (ocorre UMA vez — conferir com `grep -c`):

```tsx
  ArrowLeft,
} from "lucide-react";
```

por:

```tsx
  ArrowLeft,
  Megaphone,
} from "lucide-react";
```

Em `src/components/app-sidebar.tsx`, trocar o trecho abaixo (ocorre UMA vez — conferir com `grep -c`):

```tsx
                      <span>Gerenciar Usuários</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
```

por:

```tsx
                      <span>Gerenciar Usuários</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/admin/avisos")} tooltip="Avisos">
                    <Link to="/admin/avisos">
                      <Megaphone className="h-4 w-4" />
                      <span>Avisos</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
```

Em `src/routes/_authenticated/admin/index.tsx`, trocar o trecho abaixo (ocorre UMA vez — conferir com `grep -c`):

```tsx
import { Shield, Building2, Users, UserCog, Settings, Palette, ScrollText } from "lucide-react";
```

por:

```tsx
import { Shield, Building2, Users, UserCog, Settings, Palette, ScrollText, Megaphone } from "lucide-react";
```

Em `src/routes/_authenticated/admin/index.tsx`, trocar o trecho abaixo (ocorre UMA vez — conferir com `grep -c`):

```tsx
        { to: "/admin/usuarios", icon: Users, title: "Gerenciar Usuários", description: "Visão global de usuários e papéis de todas as lojas." },
```

por:

```tsx
        { to: "/admin/usuarios", icon: Users, title: "Gerenciar Usuários", description: "Visão global de usuários e papéis de todas as lojas." },
        { to: "/admin/avisos", icon: Megaphone, title: "Avisos", description: "Avisar os usuários das lojas: manutenção (faixa vermelha com contagem) ou informativo." },
```

- [ ] **Step 6: Gates (com a rota nova) + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
ROTA_AVISOS=1 bash .superpowers/aviso/gates.sh
grep -n '"/admin/avisos"' src/components/app-sidebar.tsx src/routes/_authenticated/admin/index.tsx
git add -- src/components/shared/HoraField.tsx src/components/avisos/NovoAvisoDialog.tsx src/routes/_authenticated/admin/avisos.tsx
git commit --only -m "feat(aviso-global): tela Admin Mestre → Avisos (super admin) — Novo aviso (nível, mensagem, destino, início, validade), lista com Encerrar agora

HoraField (hh:mm mascarado, par do DateField). Item no Admin Mestre e card no Admin.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/shared/HoraField.tsx src/components/avisos/NovoAvisoDialog.tsx src/routes/_authenticated/admin/avisos.tsx src/components/app-sidebar.tsx src/routes/_authenticated/admin/index.tsx src/routeTree.gen.ts
git show --stat HEAD
git status --short
```

Expected: `routeTree regenerado com /admin/avisos …` e `GATES OK`; 2 linhas do grep (sidebar e index); commit com os 6 arquivos; `git status --short` vazio.

---

### Task 5: QA na CÓPIA — app de teste da worktree (`:5182`), dois usuários, guarda invertida  *(controlador)*

> O app de teste da worktree fala SÓ com a cópia local. O super admin (A) envia pela tela; o "usuário comum" (B, mesmo login com os papéis simulados) vê — com um Sheet aberto e digitando. Grava SÓ em `avisos_globais` da cópia (a tabela sai no fim). A migration já passou pelo harness (Task 1, em BEGIN…ROLLBACK); para o APP enxergar a tabela ela precisa estar COMMITADA na cópia — por isso o `copia-qa.sh ida` (mesma receita `aplica_v2`, com `pg_dump` da cópia antes) e o `volta` no fim.

**Files:**
- Create (NUNCA commitado): `tests/e2e/aviso-global-qa.spec.ts`; evidência em `.superpowers/aviso/qa/`.
- Create (fora do git): `.superpowers/aviso/porta-5182.py`, `.superpowers/aviso/qa-card.env`.
- Modify (fora do repo, com backup): `/Users/sunglee/PLM + Criação/banco-local/app-teste-variantes/criar-variante.sh` — aceita a porta 5182 durante o QA (e volta ao que era no fim).

**Interfaces:**
- Consumes: Tasks 1–4 commitadas; `.superpowers/aviso/mig/copia-qa.sh` (Task 1); `tests/e2e/_helpers.ts` (`doLogin`).
- Produces: `.superpowers/aviso/qa/{1-manutencao,2-destino-informativo,3-mobile}.json` + PNGs; log com `3 passed`; a cópia de volta SEM a tabela; o `criar-variante.sh` com o `case` que tinha antes.

- [ ] **Step 1: Pré-condições (só leitura)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
grep -c "Tests  9 passed" .superpowers/aviso/logs/t1-integracao.log; grep -c "== ENSAIO OK" .superpowers/aviso/logs/t1-ensaio-local.log
ps -Ao pid,command | grep -E "[v]itest|[p]laywright|-qa\.spec"; echo "testes-checados"
lsof -nP -iTCP:5182 -sTCP:LISTEN; echo "porta-5182-checada"
curl -s -o /dev/null -w 'Supabase local http=%{http_code}\n' http://127.0.0.1:54321/auth/v1/health
curl -s -o /dev/null -w 'app de teste do dono :5188 http=%{http_code} (só observado)\n' http://localhost:5188/
bash .superpowers/aviso/mig/copia-qa.sh estado
```

Expected: `1` e `1`; só `testes-checados` (nenhum QA/E2E/vitest rodando — a F3.x também usa a cópia e o mesmo usuário); só `porta-5182-checada` (ocupada ⇒ PARE, não mate nada); `Supabase local http=200` (senão o dono sobe os serviços — APP-TESTE-LOCAL.md §1; não subir por conta própria); `tabela|policies = f|0`.

- [ ] **Step 2: Porta 5182 no `criar-variante.sh` (backup) e a variante `aviso`**

Criar `.superpowers/aviso/porta-5182.py`:

```python
# Acrescenta (ida) ou tira (volta) a porta 5182 (Aviso Global) no `case` e no comentário "# Portas:" do
# banco-local/app-teste-variantes/criar-variante.sh — SEM depender da versão exata da linha (as fases F3.x também
# acrescentam portas nela). Uso: python3 porta-5182.py ida|volta <arquivo>
import re, sys
modo, arq = sys.argv[1], sys.argv[2]
txt = open(arq, encoding="utf-8").read()
RE_CASE = re.compile(r'^case "\$PORTA" in ([0-9|]+)\) ;; \*\) echo "RECUSADO: porta \$PORTA \(variantes: ([^)]*)\)"; exit 1;; esac$', re.M)
RE_COM = re.compile(r"^# Portas: (.*)\. NUNCA", re.M)
casos, coms = RE_CASE.findall(txt), RE_COM.findall(txt)
if len(casos) != 1 or len(coms) != 1:
    sys.exit(f"PARE: esperado 1 linha do case e 1 comentário de portas (achei {len(casos)} e {len(coms)})")
portas, rotulos = casos[0]
if modo == "ida":
    if "5182" in portas.split("|"):
        sys.exit("PARE: a 5182 já está no case (alguém já acrescentou) — nada mudou")
    novas_portas, novos_rotulos = "5182|" + portas, rotulos + ", Aviso=5182"
    novo_com = coms[0] + ", Aviso = 5182"
elif modo == "volta":
    if "5182" not in portas.split("|"):
        sys.exit("PARE: a 5182 não está no case — nada a tirar")
    novas_portas = "|".join(p for p in portas.split("|") if p != "5182")
    novos_rotulos = rotulos.replace(", Aviso=5182", "")
    novo_com = coms[0].replace(", Aviso = 5182", "")
else:
    sys.exit("uso: porta-5182.py ida|volta <arquivo>")
txt = RE_CASE.sub(lambda m: f'case "$PORTA" in {novas_portas}) ;; *) echo "RECUSADO: porta $PORTA (variantes: {novos_rotulos})"; exit 1;; esac', txt, count=1)
txt = RE_COM.sub(lambda m: f"# Portas: {novo_com}. NUNCA", txt, count=1)
open(arq, "w", encoding="utf-8").write(txt)
print(f"{modo}: case = {novas_portas}")
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
VAR="/Users/sunglee/PLM + Criação/banco-local/app-teste-variantes"
cp -p "$VAR/criar-variante.sh" "$VAR/criar-variante.sh.bak-pre-aviso"
python3 .superpowers/aviso/porta-5182.py ida "$VAR/criar-variante.sh"
diff "$VAR/criar-variante.sh.bak-pre-aviso" "$VAR/criar-variante.sh"
/bin/bash -n "$VAR/criar-variante.sh" && echo "sintaxe ok"
bash "$VAR/criar-variante.sh" aviso "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global" 5182
"$VAR/aviso/subir.sh"
lsof -nP -iTCP:5188 -sTCP:LISTEN -t | sed 's/^/:5188 do dono intacto, PID /'
```

Expected: `ida: case = 5182|…`; o `diff` mostra SÓ a linha do comentário "# Portas:" e a do `case`; `sintaxe ok`; `variante aviso pronta …`; `OK: variante aviso em http://localhost:5182 (PID …)` + `[guarda-copia-local] OK: variante aviso (:5182, raiz …/aviso-global) — cliente e worker -> http://127.0.0.1:54321 (cópia local)`; o `:5188` com o mesmo PID de antes (ou fora do ar, como estava). `RECUSADO`/`ABORTADO`/`ERRO`/`PARE` ⇒ pare e reporte (nunca contornar a guarda; nunca `npm run dev` + `VITE_*`). Se a F3.4 tiver posto a 5183 antes, o script casa a linha nova do mesmo jeito.

- [ ] **Step 3: Tabela na cópia + card do Sheet**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
bash .superpowers/aviso/mig/copia-qa.sh ida 2>&1 | tee .superpowers/aviso/logs/t5-copia-ida.log | grep -vE "^(NOTICE|LOCATION)"
Q() { PGCONNECT_TIMEOUT=5 PGOPTIONS='-c default_transaction_read_only=on' psql "postgresql://postgres:postgres@127.0.0.1:54422/postgres" -X -A -t -q -v ON_ERROR_STOP=1 -c "$1"; }
CARD=$(Q "select m.id from modelos m where m.tenant_id = '37889b78-fffb-404b-8c75-18b7e50a1d9b' and coalesce(m.origem,'interno') = 'interno' order by m.nome, m.id limit 1")
echo "AVISO_QA_CARD=$CARD" | tee .superpowers/aviso/qa-card.env
```

Expected: `OK (backup da cópia): …/banco-local/backups/pre-aviso-copia-<data>.dump`; `== PRÉ-VOO OK`; as 3 conferências OK (`t|4`, `t|f|t|f|t|0`, contagens iguais); `== TABELA DO AVISO NA CÓPIA (QA)`; um uuid em `AVISO_QA_CARD`. Vazio ⇒ PARE (a Loja Teste da cópia não tem card interno).

- [ ] **Step 4: Escrever o spec e rodar**

Criar `tests/e2e/aviso-global-qa.spec.ts` (NÃO commitar):

```ts
// tests/e2e/aviso-global-qa.spec.ts — QA do Aviso Global na CÓPIA LOCAL. NÃO COMMITAR (apoio da worktree; apagado na
// Task 6 do plano docs/superpowers/plans/2026-09-24-aviso-global.md; evidência → .superpowers/aviso/qa/).
// Alvo ÚNICO: app de teste DA WORKTREE (http://localhost:5182, variante do banco-local/app-teste) sobre a cópia
// (Supabase local http://127.0.0.1:54321), com a tabela do aviso aplicada NA CÓPIA (copia-qa.sh ida).
// Guarda INVERTIDA: QUALQUER requisição a *.supabase.co (GET inclusive) é violação e é barrada.
// Dois "usuários" (mesmo login — o único com senha conhecida na cópia é o teste@teste.com, super admin da Loja Teste):
//  • A = super admin de verdade → /admin/avisos. Grava SÓ em avisos_globais (+ o broadcast do "toque").
//  • B = o MESMO login com os papéis SIMULADOS de usuário comum (GET user_roles → [] e minhas_permissoes_efetivas →
//    só Planejamento): não vê o menu Avisos e é mandado embora da tela. NÃO grava nada. A RLS de usuário comum de
//    verdade é provada no teste de integração (tests/integration/aviso-global.test.ts).
// Barradas ESPERADAS (continuam barradas, não reprovam): rpc/servicos_financeiro (Home; NUNCA liberar) e, em B, o
// broadcast REST do Realtime. O robô NÃO troca de loja.
// Rodar (raiz da worktree): set -a; . .superpowers/aviso/qa-card.env; set +a; E2E_BASE_URL=http://localhost:5182 \
//   VITE_SUPABASE_URL=http://127.0.0.1:54321 npx playwright test tests/e2e/aviso-global-qa.spec.ts --workers=1 --retries=0
import { test, expect, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { doLogin } from "./_helpers";

const BASE = process.env.E2E_BASE_URL ?? "";
if (BASE !== "http://localhost:5182") throw new Error(`E2E_BASE_URL tem de ser http://localhost:5182 (recebi "${BASE}").`);
if (!process.env.VITE_SUPABASE_URL) throw new Error("VITE_SUPABASE_URL ausente: a guarda não sabe o host do Supabase. PARE.");
const SUPA_HOST = new URL(process.env.VITE_SUPABASE_URL).host;
if (SUPA_HOST !== "127.0.0.1:54321") throw new Error(`VITE_SUPABASE_URL tem de ser http://127.0.0.1:54321 (recebi ${SUPA_HOST}).`);
const CARD = process.env.AVISO_QA_CARD ?? "";
if (!/^[0-9a-f-]{36}$/.test(CARD)) throw new Error("AVISO_QA_CARD ausente/inválido — rode o Step 3 da Task 5.");
const LOJA_TESTE = "37889b78-fffb-404b-8c75-18b7e50a1d9b";
const OUT = path.resolve(".superpowers/aviso/qa");
const ehProducao = (u: URL) => /(^|\.)supabase\.(co|com)$/i.test(u.hostname);
// RPCs de LEITURA (as mesmas liberadas nos QAs da F3.x — STABLE, conferidas no snapshot). Outra RPC = violação.
// ⚠️ NUNCA `servicos_financeiro` (DEFINER que sincroniza parcelas_servico na leitura — invariante #1).
const READ_RPCS = new Set([
  "custo_unitario_modelos", "modelo_mo_resumo", "estoque_tecido_por_artigo", "otb_orcamento", "sidebar_badges",
  "minhas_permissoes_efetivas", "get_user_tenant_id", "meu_tenant_ativo", "modelos_mo_a_aprovar_count",
  "avaliar_condicoes_kanban", "precos_tecido_congelado", "ocs_disponiveis_variante", "modelo_etapas_afetadas",
]);
if (READ_RPCS.has("servicos_financeiro")) throw new Error("servicos_financeiro é PROIBIDO em READ_RPCS.");
const PERMS_COMUM = [
  { pagina: "criacao_planejamento", pode_ver: true, pode_editar: true },
  { pagina: "criacao_planejamento:custos", pode_ver: true, pode_editar: true },
];

type Papel = "A" | "B";
const g = { violacoes: [] as string[], barradasEsperadas: [] as string[], gravadasA: [] as string[], tenants: new Set<string>() };
const linha = (m: string, u: URL) => `${m} ${u.pathname}`;

async function guardar(ctx: BrowserContext, papel: Papel) {
  await ctx.route((u) => ehProducao(u), async (route) => {
    g.violacoes.push(`${papel} PRODUÇÃO ${route.request().method()} ${route.request().url()}`);
    return route.abort("blockedbyclient");
  });
  await ctx.route((u) => u.host === SUPA_HOST, async (route: Route) => {
    const req = route.request();
    const u = new URL(req.url());
    const m = req.method();
    const p = u.pathname;
    if (p === "/rest/v1/tenant_config") {
      const t = u.searchParams.get("tenant_id");
      if (t) g.tenants.add(t.replace(/^eq\./, ""));
    }
    if (p.startsWith("/auth/v1/") || p.startsWith("/storage/v1/")) return route.continue();
    if (papel === "B" && m === "GET" && p === "/rest/v1/user_roles") return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    if (papel === "B" && p === "/rest/v1/rpc/minhas_permissoes_efetivas") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PERMS_COMUM) });
    }
    if (p.startsWith("/rest/v1/rpc/") && READ_RPCS.has(p.slice("/rest/v1/rpc/".length))) return route.continue();
    if (m === "GET" || m === "HEAD") return route.continue();
    if (papel === "A" && ((m === "POST" || m === "PATCH") && p === "/rest/v1/avisos_globais")) {
      g.gravadasA.push(linha(m, u));
      return route.continue();
    }
    if (papel === "A" && m === "POST" && p.startsWith("/realtime/v1/api/broadcast")) return route.continue(); // o "toque"
    const l = linha(m, u);
    if (/^POST \/rest\/v1\/rpc\/servicos_financeiro$/.test(l) || (papel === "B" && /^POST \/realtime\/v1\/api\/broadcast/.test(l))) {
      g.barradasEsperadas.push(`${papel} ${l}`);
    } else {
      g.violacoes.push(`${papel} ${l}`);
    }
    return route.abort("blockedbyclient");
  });
  const origem = new URL(BASE).origin;
  await ctx.route((u) => u.origin === origem, async (route) => {
    const m = route.request().method();
    if (m === "GET" || m === "HEAD") return route.continue();
    g.violacoes.push(`${papel} APP ${m} ${new URL(route.request().url()).pathname}`);
    return route.abort("blockedbyclient");
  });
}

async function novaPagina(browser: Browser, papel: Papel, viewport = { width: 1366, height: 900 }): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: BASE, viewport });
  await guardar(ctx, papel);
  const page = await ctx.newPage();
  await doLogin(page);
  return { ctx, page };
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const ddmmaaaa = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

/** A: envia um aviso pela tela. `inicioAgora` = início no minuto atual (já "em manutenção"). `lojas` = nomes. */
async function enviar(a: Page, o: { mensagem: string; nivel?: "manutencao" | "informativo"; lojas?: string[]; inicioAgora?: boolean }) {
  await a.goto("/admin/avisos", { waitUntil: "networkidle" });
  await a.getByTestId("aviso-novo").click();
  const dlg = a.getByRole("dialog");
  await expect(dlg).toBeVisible();
  if (o.nivel === "informativo") {
    await dlg.getByTestId("aviso-nivel").click();
    await a.getByRole("option", { name: /^Informativo/ }).click();
  }
  await dlg.getByLabel("Mensagem").fill(o.mensagem);
  if (o.lojas?.length) {
    await dlg.getByLabel("Todas as lojas").click();
    for (const nome of o.lojas) await dlg.getByTestId("aviso-lojas").getByText(nome, { exact: true }).click();
  }
  if (o.inicioAgora) {
    const agora = new Date();
    await dlg.getByLabel("Data do início da manutenção").fill(ddmmaaaa(agora));
    await dlg.getByLabel("Hora do início da manutenção").fill(hhmm(agora));
  }
  const antes = g.gravadasA.length;
  await dlg.getByTestId("aviso-enviar").click();
  await expect(a.getByText("Aviso enviado").first()).toBeVisible({ timeout: 15_000 });
  expect(g.gravadasA.length).toBe(antes + 1);
  await expect(dlg).toBeHidden();
}

async function encerrar(a: Page, mensagem: string) {
  await a.goto("/admin/avisos", { waitUntil: "networkidle" });
  await a.getByRole("row", { name: new RegExp(mensagem) }).getByTestId("aviso-encerrar").click();
  await a.getByRole("alertdialog").getByRole("button", { name: "Encerrar agora" }).click();
  await expect(a.getByText("Aviso encerrado").first()).toBeVisible({ timeout: 15_000 });
}

function salvar(nome: string, dados: unknown) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${nome}.json`), JSON.stringify(dados, null, 2));
}

test.describe.configure({ mode: "serial" });

test("Aviso Global — manutenção chega AO VIVO no Sheet aberto, 'Entendi' não fecha o Sheet nem tira o foco, encerrar some na hora", async ({ browser }) => {
  test.setTimeout(240_000);
  const A = await novaPagina(browser, "A");
  const B = await novaPagina(browser, "B");
  const msg = `QA manutenção ${Date.now()}`;

  // B: Sheet do card aberto, digitando num campo (não salva).
  await B.page.goto(`/criacao/planejamento?modelo=${CARD}`, { waitUntil: "networkidle" });
  const sheet = B.page.getByRole("dialog");
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  const campo = sheet.getByRole("textbox").and(sheet.locator(":not([disabled]):not([readonly])")).first();
  await campo.click();
  await campo.evaluate((el) => el.setAttribute("data-qa-foco", "1"));
  await campo.press("End");
  await campo.pressSequentially(" QA");
  const valor = await campo.inputValue();
  const focoNoCampo = () => B.page.evaluate(() => document.activeElement?.getAttribute("data-qa-foco") === "1");

  // A envia (Manutenção, todas as lojas, início sugerido = ≥ 5 min à frente).
  await enviar(A.page, { mensagem: msg });

  // B recebe SEM recarregar: faixa + cartão; o Sheet segue aberto e o foco segue no campo.
  const faixa = B.page.getByTestId("aviso-faixa-manutencao").filter({ hasText: msg });
  await expect(faixa).toBeVisible({ timeout: 15_000 });
  await expect(faixa.getByTestId("aviso-contagem")).toHaveText(/^Manutenção em \d{1,2}:\d{2}(:\d{2})?$/);
  const cartao = B.page.getByTestId("aviso-cartao");
  await expect(cartao).toBeVisible();
  await expect(cartao).toContainText(msg);
  await expect(sheet).toBeVisible();
  expect(await focoNoCampo()).toBe(true);
  await B.page.screenshot({ path: path.join(OUT, "1-cartao-sobre-o-sheet.png") });

  // "Entendi": só o cartão fecha.
  await B.page.getByTestId("aviso-entendi").click();
  await expect(cartao).toBeHidden();
  await expect(sheet).toBeVisible();
  expect(await focoNoCampo()).toBe(true);
  expect(await campo.inputValue()).toBe(valor);
  await expect(faixa).toBeAttached();

  // Recarregar: a faixa volta (ainda vale); o cartão NÃO (Entendi lembrado).
  await B.page.reload({ waitUntil: "networkidle" });
  await expect(B.page.getByTestId("aviso-faixa-manutencao").filter({ hasText: msg })).toBeVisible({ timeout: 15_000 });
  await B.page.waitForTimeout(1500);
  await expect(B.page.getByTestId("aviso-cartao")).toHaveCount(0);

  // A encerra → some da tela de B sem recarregar.
  await encerrar(A.page, msg);
  await expect(B.page.getByTestId("aviso-faixa-manutencao").filter({ hasText: msg })).toHaveCount(0, { timeout: 15_000 });

  salvar("1-manutencao", { violacoes: g.violacoes, barradasEsperadas: g.barradasEsperadas, gravadasA: g.gravadasA, tenants: [...g.tenants] });
  expect(g.violacoes).toEqual([]);
  expect([...g.tenants].every((t) => t === LOJA_TESTE)).toBe(true);
  await A.ctx.close();
  await B.ctx.close();
});

test("Aviso Global — destino por loja, Informativo fecha e fica fechado, 'Sistema em manutenção' depois do início, quem entra depois vê", async ({ browser }) => {
  test.setTimeout(240_000);
  const A = await novaPagina(browser, "A");
  const B = await novaPagina(browser, "B");
  await B.page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
  const t = Date.now();

  // Só para OUTRA loja → B (Loja Teste) não vê.
  const msgOutra = `QA info só Ave Rara ${t}`;
  await enviar(A.page, { mensagem: msgOutra, nivel: "informativo", lojas: ["Ave Rara"] });
  await B.page.waitForTimeout(4000);
  await expect(B.page.getByText(msgOutra)).toHaveCount(0);

  // Para a Loja Teste → B vê a faixa discreta, fecha, recarrega e continua fechada.
  const msgInfo = `QA info Loja Teste ${t}`;
  await enviar(A.page, { mensagem: msgInfo, nivel: "informativo", lojas: ["Loja Teste"] });
  const info = B.page.getByTestId("aviso-faixa-informativo").filter({ hasText: msgInfo });
  await expect(info).toBeVisible({ timeout: 15_000 });
  await info.getByTestId("aviso-fechar").click();
  await expect(info).toHaveCount(0);
  await B.page.reload({ waitUntil: "networkidle" });
  await B.page.waitForTimeout(1500);
  await expect(B.page.getByTestId("aviso-faixa-informativo").filter({ hasText: msgInfo })).toHaveCount(0);

  // Manutenção com início AGORA → "Sistema em manutenção"; um 3º contexto que entra DEPOIS também vê.
  const msgAgora = `QA manutenção agora ${t}`;
  await enviar(A.page, { mensagem: msgAgora, inicioAgora: true });
  await expect(B.page.getByTestId("aviso-faixa-manutencao").filter({ hasText: msgAgora }).getByTestId("aviso-contagem"))
    .toHaveText("Sistema em manutenção", { timeout: 15_000 });
  const C = await novaPagina(browser, "B");
  await expect(C.page.getByTestId("aviso-faixa-manutencao").filter({ hasText: msgAgora })).toBeVisible({ timeout: 15_000 });

  // B offline → A encerra → B volta online e a faixa some (busca refeita no "online"/reconexão).
  await B.ctx.setOffline(true);
  await encerrar(A.page, msgAgora);
  await B.ctx.setOffline(false);
  await expect(B.page.getByTestId("aviso-faixa-manutencao").filter({ hasText: msgAgora })).toHaveCount(0, { timeout: 30_000 });

  await encerrar(A.page, msgInfo);
  await encerrar(A.page, msgOutra);
  salvar("2-destino-informativo", { violacoes: g.violacoes, barradasEsperadas: g.barradasEsperadas, gravadasA: g.gravadasA });
  expect(g.violacoes).toEqual([]);
  await A.ctx.close();
  await B.ctx.close();
  await C.ctx.close();
});

test("Aviso Global — mobile 360: faixa e cartão sem estourar a largura; usuário comum não vê a tela Avisos", async ({ browser }) => {
  test.setTimeout(180_000);
  const A = await novaPagina(browser, "A");
  const M = await novaPagina(browser, "B", { width: 360, height: 740 });
  const t = Date.now();
  const msg = `QA mobile ${t} — mensagem longa para ver a quebra de linha na faixa e no cartão em 360 px de largura`;
  await enviar(A.page, { mensagem: msg });
  await enviar(A.page, { mensagem: `QA mobile info ${t}`, nivel: "informativo" });
  await M.page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
  await expect(M.page.getByTestId("aviso-faixa-manutencao").filter({ hasText: `QA mobile ${t}` })).toBeVisible({ timeout: 15_000 });
  await expect(M.page.getByTestId("aviso-cartao")).toBeVisible();
  const medida = await M.page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)?.getBoundingClientRect();
    const faixa = r("[data-testid=avisos-globais]");
    const cartao = r("[data-testid=aviso-cartao]");
    return {
      scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
      faixa: faixa && { left: faixa.left, right: faixa.right }, cartao: cartao && { left: cartao.left, right: cartao.right, bottom: cartao.bottom },
      alturaTela: window.innerHeight,
    };
  });
  await M.page.screenshot({ path: path.join(OUT, "3-mobile-360.png"), fullPage: false });
  salvar("3-mobile", medida);
  expect(medida.scrollW).toBeLessThanOrEqual(medida.clientW);
  expect(medida.faixa!.left).toBeGreaterThanOrEqual(0);
  expect(medida.faixa!.right).toBeLessThanOrEqual(360);
  expect(medida.cartao!.left).toBeGreaterThanOrEqual(0);
  expect(medida.cartao!.right).toBeLessThanOrEqual(360);
  expect(medida.cartao!.bottom).toBeLessThanOrEqual(medida.alturaTela - 64); // acima da barra de ações do rodapé

  // Usuário comum (papéis simulados): sem o item "Avisos" no menu e mandado embora da tela.
  await M.page.setViewportSize({ width: 1366, height: 900 });
  await M.page.goto("/admin/avisos", { waitUntil: "networkidle" });
  await expect(M.page).not.toHaveURL(/\/admin\/avisos/);
  await expect(M.page.getByRole("link", { name: "Avisos", exact: true })).toHaveCount(0);
  // Super admin vê o item no Admin Mestre.
  await A.page.goto("/home", { waitUntil: "networkidle" });
  await expect(A.page.getByRole("link", { name: "Avisos", exact: true })).toBeVisible();

  await encerrar(A.page, `QA mobile ${t}`);
  await encerrar(A.page, `QA mobile info ${t}`);
  expect(g.violacoes).toEqual([]);
  await A.ctx.close();
  await M.ctx.close();
});
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
set -a; . .superpowers/aviso/qa-card.env; set +a
E2E_BASE_URL=http://localhost:5182 VITE_SUPABASE_URL=http://127.0.0.1:54321 \
  npx playwright test tests/e2e/aviso-global-qa.spec.ts --workers=1 --retries=0 2>&1 | tee .superpowers/aviso/logs/t5-qa.log | tail -15
cat .superpowers/aviso/qa/1-manutencao.json .superpowers/aviso/qa/3-mobile.json
```

Expected: `3 passed`; `violacoes: []`; `barradasEsperadas` só com `servicos_financeiro` e/ou broadcast REST de B; `gravadasA` só `POST/PATCH /rest/v1/avisos_globais`; `3-mobile.json` com `scrollW ≤ clientW`, faixa e cartão dentro de 0–360 px. Violação de RPC de LEITURA nova (fora do `READ_RPCS`) ⇒ o controlador confere no `funcoes.sql` do snapshot (`savepoints/2026-09-22-pre-unificacao/`) que é `STABLE` e sem escrita ANTES de acrescentar — e registra. Falha em "Entendi fecha o Sheet" ou "foco sai do campo" = BLOQUEANTE (volta para a Task 3). Mostrar ao dono os PNGs (`1-cartao-sobre-o-sheet.png`, `3-mobile-360.png`) e, se ele quiser, o `:5182` ao vivo (login `teste@teste.com`).

- [ ] **Step 5: Descer, tirar a tabela da cópia e a porta 5182**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
VAR="/Users/sunglee/PLM + Criação/banco-local/app-teste-variantes"
"$VAR/aviso/descer.sh"
bash .superpowers/aviso/mig/copia-qa.sh volta 2>&1 | tee .superpowers/aviso/logs/t5-copia-volta.log | grep -vE "^(NOTICE|LOCATION)"
python3 .superpowers/aviso/porta-5182.py volta "$VAR/criar-variante.sh"
cmp "$VAR/criar-variante.sh" "$VAR/criar-variante.sh.bak-pre-aviso" && echo "criar-variante.sh = antes do QA" || echo "(outra fase mexeu no script durante o QA — só a 5182 saiu; conferir o diff)"
/bin/bash -n "$VAR/criar-variante.sh" && echo "sintaxe ok"
bash .superpowers/aviso/mig/copia-qa.sh estado
```

Expected: `Variante aviso (:5182) derrubada`; `avisos do QA exportados: …csv`; `OK (tabela do aviso removida): f|0`; `OK (contagens = antes)`; `== TABELA DO AVISO FORA DA CÓPIA`; `volta: case = 5184|…` (sem a 5182); `criar-variante.sh = antes do QA`; `sintaxe ok`; `tabela|policies = f|0`.

---

### Task 6: Revisão final + portão G-commit  *(controlador)*

**Files:** nenhum novo no repo. Apaga (não commitado): `tests/e2e/aviso-global-qa.spec.ts`.

**Interfaces:**
- Consumes: Tasks 1–5 (commits + evidência do QA).
- Produces: aprovação do code-reviewer Opus no diff inteiro; relatório G-commit no diário do guardião da campanha (a ordem F1 → aviso é da campanha).

- [ ] **Step 1: Revisão do diff inteiro (code-reviewer, Opus)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
git diff --stat "$(cat .superpowers/aviso/BASE)"..HEAD
git diff "$(cat .superpowers/aviso/BASE)"..HEAD > .superpowers/aviso/logs/diff-final.diff
```

O revisor recebe `diff-final.diff`, a spec, este plano (Global Constraints + §5–§7) e a evidência do QA, e confere: (a) spec §2 (as 9 decisões) × código; (b) RLS/permissões = checklist G-migration; (c) nenhuma escrita fora de `avisos_globais` no front; (d) sem Dialog/foco no cartão; (e) `queryKey` únicas (`["avisos-globais-ativos", tenantId]`, `["admin","avisos"]`, `["admin","avisos","lojas"]`) sem colidir com as existentes (`grep -rn '"avisos' src`); (f) mobile 360 e tokens; (g) nada fora dos caminhos permitidos. Achado BLOQUEANTE ⇒ fix na mesma worktree + gates + nova rodada.

- [ ] **Step 2: Gates finais + integração na cópia**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
rm -f tests/e2e/aviso-global-qa.spec.ts
bash .superpowers/aviso/gates.sh
ps -Ao pid,command | grep -E "[v]itest|[p]laywright"; echo "testes-checados"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/integration/aviso-global.test.ts 2>&1 | grep -E "Tests |×"
git status --short
```

Expected: `GATES OK`; só `testes-checados`; `Tests  9 passed (9)`; `git status --short` vazio. (A suíte de integração INTEIRA não roda aqui: ela tem 42 falhas herdadas e o `kanban-auto.test.ts` faz `ALTER TABLE tenant_config` em transação, congelando o `:5188` do dono; o aviso não toca objeto existente — registrar esta justificativa no G-commit.)

- [ ] **Step 3: G-commit**

O controlador registra no diário do guardião (`.superpowers/sdd/2026-09-22-unificacao-kanban-auto/guardiao.md`, no `MAIN`): SHA final da `aviso-global`, `GATES OK`, integração 9/9, ensaio OK, QA 3/3 (JSONs), revisão Opus OK, e a pendência de ordem: **a Task 7 só depois da F1 em produção (runbook Step 7 OK)**. Avisa o dono por chat que o aviso está pronto e espera a F1.

---

### Task 7: Migration em PRODUÇÃO  *(o DONO roda — depois da F1)*

**Files:** nenhum no repo. Evidência: `/Users/sunglee/PLM + Criação/savepoints/pre-apply-aviso-global/` (dump `.dump` + `.toc` + `.log`) e `$WT/.superpowers/aviso/logs/prod-ida.log`.

**Interfaces:**
- Consumes: Task 6 (G-commit); **F1 aplicada em produção com o pós-apply OK** (runbook da F1, Step 7 (a)–(f), registrado no diário); OK explícito do dono; `/tmp/dburl.txt`; o container `supabase_db_banco-local` no ar (o `pg_dump` 17.6 mora nele).
- Produces: `public.avisos_globais` em produção (pré-condição do merge e do deploy).

Quando: qualquer horário serve para as travas (a migration não trava tabela existente), mas o `pg_dump` completo pesa no banco → prefira fora do horário de uso. Tempo estimado: backup 1–3 min; aplicação < 1 s.

- [ ] **Step 1: Conferir (controlador, por chat com o dono)**

No diário: F1 em produção com Step 7 OK · G-commit do aviso OK · o dono disse "pode aplicar o aviso" (resposta literal + data).

- [ ] **Step 2: O dono roda (um comando)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
/bin/bash .superpowers/aviso/mig/ida-producao.sh 2>&1 | tee .superpowers/aviso/logs/prod-ida.log | grep -vE "^(NOTICE|LOCATION)"
```

Expected, na ordem:
- `contagens antes (funções|gatilhos): <n>|<m>`
- `== backup (producao-pre-aviso) → …/savepoints/pre-apply-aviso-global/producao-pre-aviso-<data>.dump`
- `OK (backup): … (<tamanho>; <N> tabelas de public com dados)`
- `OK (PG >= 17 com transaction_timeout): t`
- `OK (F1 (kanban automático) já está no banco): t`
- `OK (tabela do aviso ainda NÃO existe): f|0`
- `OK (funções das policies existem): t`
- `OK (ATIV): nenhuma transação longa`
- `== PRÉ-VOO OK`
- a migration (`real 0.0x`)
- `== IDA OK`
- `OK (tabela criada com 4 policies): t|4`
- `OK (RLS · anon sem nada · authenticated lê e só encerra · fora da publicação): t|f|t|f|t|0`
- `OK (nenhuma função/gatilho novo): <n>|<m>` (igual ao "antes")
- `== PostgREST recarregado`

Desvios:

| Mensagem | O que fazer |
|---|---|
| `FALHOU (backup)` | Nada foi aplicado. Ver o `.log`. Se o erro for permissão em schema interno do Supabase (ex.: `vault`), o dono decide: `BACKUP_SO_PUBLIC=1 /bin/bash …/ida-producao.sh …` (dump só do `public` — é o único schema que a migration toca). |
| `FALHOU (F1 …): f` | PARE. A F1 ainda não está em produção. |
| `FALHOU (tabela do aviso ainda NÃO existe): t\|…` | Alguém já aplicou: PARE e descubra quem. |
| `FALHOU (ATIV)` | Esperar e repetir o MESMO comando (nunca matar sessão). |
| `-- espera de trava/tempo` | O `aplica_v2` repete sozinho; nada do arquivo ficou. |
| `PAROU …` | Falar com o controlador. |
| `CONFERÊNCIA FALHOU` | A tabela está lá e é aditiva: avisar o controlador. NÃO rodar o inverso sem OK. |

- [ ] **Step 3: Registro**

O controlador anota no diário: horário, o `prod-ida.log` e o nome do dump.

- [ ] **Step 4: (Só se o dono pedir) volta de emergência**

NÃO faz parte do fluxo. Apaga o histórico de avisos (exporta CSV antes). A faixa some em silêncio; a tela Avisos passa a mostrar erro até o front sair do ar.

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/aviso-global"
/bin/bash .superpowers/aviso/mig/volta-producao.sh 2>&1 | tee .superpowers/aviso/logs/prod-volta.log | grep -vE "^(NOTICE|LOCATION)"
```

Expected: `export: N aviso(s) em …csv`; `OK (ATIV)`; o inverso; `OK (tabela do aviso removida): f|0`; `OK (contagens = antes)`; `== VOLTA OK`.

---

### Task 8: Merge (fast-forward), deploy e smoke  *(o DONO decide; controlador prepara)*

**Files:** nenhum novo. Muda o `MAIN` (ff) e a produção (deploy).

**Interfaces:**
- Consumes: Task 7 (`== IDA OK`); a resposta do dono ao §8 D1 (o que vai junto no deploy).
- Produces: `feature/plan-tecido-a1` com o aviso; front no ar; smoke OK.

- [ ] **Step 1: Branch em dia com a `feature/plan-tecido-a1`**

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"; WT="$MAIN/.claude/worktrees/aviso-global"
git -C "$MAIN" merge-base --is-ancestor feature/plan-tecido-a1 aviso-global && echo "ff possível" || echo "PRECISA REBASE"
```

`PRECISA REBASE` ⇒ `git -C "$WT" rebase feature/plan-tecido-a1` (conflito ⇒ PARE e reporte), depois `bash .superpowers/aviso/gates.sh` + a integração da Task 6 Step 2 de novo (se a `routeTree.gen.ts` conflitar: aceite a da `feature/plan-tecido-a1`, rode `npm run build` e commite a regenerada).

- [ ] **Step 2: Merge (ff) — com o dono avisado**

Antes: o dono SALVA e FECHA os cards/Sheets abertos no `:5173` (o layout muda e o Fast Refresh remonta a tela) e os executores das outras fases ficam parados durante o ff.

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"
git -C "$MAIN" status --porcelain | grep -v '^??' ; echo "main-limpo-checado"
git -C "$MAIN" merge --ff-only aviso-global && git -C "$MAIN" log --oneline -6
```

Expected: só `main-limpo-checado`; o ff com os commits do aviso no topo. Sem push (é do dono).

- [ ] **Step 3: Deploy (o DONO)**

Depois de responder ao §8 D1, o dono lista o que vai junto e publica do `MAIN`:

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
git log --oneline 2768145..HEAD -- src    # front desde o último deploy confirmado (20/set) — conferir com a lista do §8 D1
npm run deploy
```

- [ ] **Step 4: Smoke em produção (o dono, ~2 min)**

Em `https://sistrama.sung-lee.workers.dev`, logado como super admin:
1. Admin Mestre → Avisos → Novo aviso → **Informativo**, desligar "Todas as lojas", marcar só **Loja Teste**, mensagem "Teste do aviso — pode ignorar", validade padrão → Enviar.
2. Com a Loja Teste em visualização, a faixa azul aparece no topo em outra aba sem recarregar; noutra loja, não aparece.
3. Encerrar agora → a faixa some na outra aba.

Se falhar: o front já está no ar e a tabela existe. Avisar o controlador (diagnóstico pelo console do navegador; nada de volta de banco sem o OK do dono).

- [ ] **Step 5: Arrumação**

Com o OK do dono: `git -C "$MAIN" worktree remove "$WT"` (a pasta `.superpowers/aviso/` vai junto — copiar antes os logs de produção para `…/savepoints/pre-apply-aviso-global/`) e `git -C "$MAIN" branch -d aviso-global`. O `docs-keeper` atualiza a memória `project_aviso_global` (FEITO, commits, deploy) e o bloco "admin" do `CLAUDE.md` (a rota `/admin/avisos`), se o dono quiser.

---

## 5. Critérios de aceite

| Requisito do dono (spec §2) | Onde se prova |
|---|---|
| Só super admin envia/encerra | integração (comum: 42501 no INSERT, UPDATE sem linhas, DELETE 42501) + gate da tela (QA teste 3) |
| Formulário (texto, nível, destino, início, validade +30 min) | unit (`formInicial`, `validarAviso`, `montarAvisoPayload`) + QA testes 1–2 |
| Lista ativos/antigos + Encerrar agora | `ordenarAvisosAdmin`/`situacaoAviso` (unit) + QA (encerrar some na hora) |
| Informativo: faixa discreta que fecha | QA teste 2 (fecha, recarrega, continua fechada) |
| Manutenção: faixa vermelha fixa + "Manutenção em mm:ss" → "Sistema em manutenção" | unit (`textoFaixaManutencao`, `formatarContagem`) + QA testes 1–2 |
| Cartão "Entendi" não interrompe (sem modal, sem roubar foco, não fecha Sheet) | teste estático + QA teste 1 (Sheet aberto, foco e valor intactos) |
| Chega na hora; aparece ao abrir/recarregar até expirar | QA (sem reload; contexto novo vê; offline → online) |
| Cada usuário só vê os da sua loja (ou "todas") | integração (RLS) + unit (`avisoParaLoja`) + QA (só Ave Rara ⇒ B não vê) |
| Loja inativa (nil) não lê | integração |
| Migration depois da F1, nº 20261001100000 | `ida-producao.sh` exige a F1; nome do arquivo |

## 6. Riscos (verificados) e cobertura

| Risco | Cobertura |
|---|---|
| Front no ar antes da tabela | A busca engole o erro (faixa some em silêncio). Ordem T7 → T8 (merge/deploy só depois). |
| Toque perdido | SUBSCRIBED (inclui reconexão), `visibilitychange`, `online`, foco do TanStack; validade conferida no cliente. QA testa offline → online. |
| Radix fecha o Sheet no clique do cartão | `pointerdown` isolado + `pointer-events-auto` + teste estático + QA com o Sheet aberto. |
| Foco sai do campo | `onMouseDown` preventDefault, sem `autoFocus`; QA confere `document.activeElement`. |
| Super admin vendo aviso de outra loja | Filtro no cliente pela loja em visualização (`avisoParaLoja`); QA "só Ave Rara". |
| Permissão padrão do Supabase (tudo para anon/authenticated) | REVOKE + GRANT por coluna + `DO` na migration + integração (ACL exata). |
| Pré-voo da F1 quebrado pela tabela a mais | Ordem obrigatória; `ida-producao.sh` exige a F1. |
| Backup falhar em schema interno | `backup_banco` para no erro; opção `BACKUP_SO_PUBLIC=1` só com OK do dono. |
| Receita da F3.4 (linha literal do `case`) | A 5182 sai no fim do QA (Task 5 Step 5); não rodar os dois QAs juntos. |
| Relógio do aparelho | Aceito (spec §7). |

## 7. Decisões técnicas (o controlador decide; registradas)

- **T1 Broadcast em vez de postgres_changes** (spec §4): o Encerrar deixaria a linha invisível para o comum e o Realtime não entrega; o toque sem dado + busca pela RLS resolve criar E encerrar, sem mexer na publicação.
- **T2 Sem função no banco:** RLS + permissões por coluna bastam (encerrar = UPDATE de uma coluna só). Invariante #9 não se aplica.
- **T3 Tabela global sem `tenant_id`:** o destino é `todas_lojas`/`lojas uuid[]` (sem FK em array; loja excluída vira id solto, inofensivo — some da lista só pelo nome).
- **T4 Isolar o `pointerdown` no próprio cartão** em vez de `DismissableLayerBranch` (pacote interno do Radix, dependência nova).
- **T5 "Fechei"/"Entendi" no `localStorage`** por usuário e aviso (conveniência de um navegador; try/catch + memória).
- **T6 Harness local ao teste** (não criar `mig-txn.ts`, que é da F3.1).
- **T7 Limites:** mensagem ≤ 500, validade ≤ 7 dias depois do início, até 200 lojas por aviso; horários no fuso do navegador do super admin.
- **T8 QA com o super admin nos 2 papéis** (não há usuário comum com senha conhecida na Loja Teste da cópia); a RLS de comum de verdade fica na integração.

## 8. Decisões do dono

**D1 — O que vai junto no deploy (precisa da sua resposta antes da Task 8).** O `npm run deploy` publica a branch principal inteira. O último deploy confirmado foi em 20/set (com a branch em 18/set). De lá para cá entraram no front, e vão junto com o aviso:
1. **Importar Dados por planilha** (tecido, aviamento, insumo, produto de revenda/importado, modelo interno) — 21–22/set; banco já aplicado.
2. **Tela Distribuição** (módulo opcional, desligado por padrão) — 21/set; banco já aplicado.
3. **Direcionamento:** resumo da subcoleção no topo do card — 22/set; banco já aplicado.
4. **Planejamento:** campo Versão editável, versão no editar em massa, ordenar por Versão, selecionar card clicando na foto — 22/set.
5. **Tecidos:** a miniatura do card usa a 1ª cor com foto — 21/set.
6. **Desenvolvimento:** o selo da seção "4. CAD" só fica verde com os dados completos — 22/set.
7. **Reorganização interna do card do Planejamento (F3.0)** — 23/set. Não muda o que você vê, mas mexe no card inteiro: vale abrir e salvar um card depois do deploy.
8. Código de apoio do kanban automático (F1) sem efeito na tela (a chave fica desligada).
Se alguma fase da campanha (F2, F3.x) for juntada antes do deploy, ela vai junto também. As memórias ainda marcam como "deploy pendente" itens mais antigos (Modo Plano, preço de revenda, REF unificada, Revenda pela Explosão, seção Preço) — pelo registro de 20/set eles já foram publicados; confirme se lembrar diferente.
**Pergunta:** publicar tudo isso junto com o aviso? (Recomendo: sim — tudo já está com o banco pronto; só o item 7 pede um teste rápido.)

**D2 — Com um card (Sheet) ou janela aberta, a faixa fica atrás do escurecido.** O cartão aparece por cima, então quem está no meio de um card vê o aviso na hora. Mas, depois do "Entendi", a contagem só aparece de novo quando a pessoa fecha o card.
- (A) Deixar assim, como aprovado. **Recomendado:** o cartão já avisou e não polui a tela.
- (B) Depois do "Entendi", deixar uma etiqueta pequena "Manutenção em mm:ss" no canto, sem botão e sem receber clique.

**D3 — Combinados menores (confirme ou ajuste):**
- A mensagem tem até 500 letras.
- A validade vai no máximo até 7 dias depois do início.
- O Informativo fechado e o "Entendi" valem por navegador: em outro computador, aparecem de novo.
- "Encerrar agora" não tem volta; se precisar, envie um aviso novo.
- Os horários são os do computador de quem envia (Brasília).
- O Nível começa em Manutenção.

## 9. Self-review (feito ao escrever)

- **Cobertura da spec:** §2 itens 1–9 → Tasks 4 (1–3), 3 (4–7), 1 (8), Global Constraints/T7 (9); §3 dados → T1; §4 segurança/entrega → T1 + T3; §5 UI → T3 + T4; §7 riscos → §6. Sem lacuna.
- **Placeholders:** nenhum "TBD"/"similar a"; todo passo de código traz o arquivo inteiro ou a edição exata (texto casado 1× — conferido por script no espelho).
- **Tipos/nomes:** `AVISOS_ATIVOS_KEY`, `sinalizarAvisosGlobais`, `useAgora`, `useDispensaAvisos`, `LojaDestino`, `HoraField`, `data-testid`s — os mesmos nas Tasks 3/4/5 (o `tsc` do espelho compilou tudo junto; o spec do QA compilou contra os mesmos testids).
- **Executado (fora do repo, 24/set):** integração 9/9 num Postgres 17.6 descartável (+3 mutações detectadas); `ensaio-local.sh` e `backup_banco` OK; `tsc --noEmit` = 0 com todas as edições; 22/22 unit; anti-drift sem hit novo; `bash -n` em todos os scripts (bash 3.2); receita da porta 5182 ida/volta byte a byte. Dois defeitos achados e corrigidos nessa execução: (1) `rejeita()` recebia a Promise já criada — a query rodava ANTES do `SAVEPOINT` (agora recebe uma função); (2) um `;` dentro do texto do `COMMENT` quebrava o teste estático (tirado). Não executado: o QA de navegador (exige subir o vite) e o backup contra o pooler de produção (a mecânica foi testada contra outro servidor).
