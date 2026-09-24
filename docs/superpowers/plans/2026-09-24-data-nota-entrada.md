# Data da Nota de Entrada nas 5 OCs — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o campo "Data da Nota de Entrada" nas OCs de Tecido, Aviamento, Insumo, Produto Acabado e Produto Importado; nas quatro primeiras o prazo de pagamento passa a contar dela (as não pagas são recalculadas quando ela muda; as pagas nunca), e a OC recebida sem a data acende aviso na OC, bolinha amarela na lista e destaque amarelo nas parcelas do Financeiro — com a migration testada só na cópia e aplicada em produção pelo dono, com backup completo antes.

**Architecture:** O vencimento continua decidido no banco: UMA migration (`20261002100000`) acrescenta `data_nota_entrada` nas 5 tabelas, troca a base do vencimento por `COALESCE(data_nota_entrada, base de hoje)` nos geradores/recálculos de 4 famílias (Importado intocado), ensina os 5 cores de save a gravar a chave (ausente = mantém) e põe um gatilho que recalcula as não pagas quando a data muda numa OC já recebida. A migration e o inverso são GERADOS a partir do texto vivo das funções (cópia = produção) + um diff mínimo fixo, com guarda de md5. No front, uma regra pura única (`src/lib/nota-entrada.ts`) decide alerta/provisória e quatro peças compartilhadas (`src/components/shared/NotaEntrada.tsx`) entram nas 5 OCs e no Financeiro.

**Tech Stack:** PostgreSQL 17.6 (Supabase próprio; cópia local Docker `supabase_db_banco-local` em `127.0.0.1:54422`), plpgsql, Vite + React 19 + TypeScript strict + TanStack Query v5 + supabase-js, Vitest (unit `node` + integração em `BEGIN…ROLLBACK` SÓ na cópia), Playwright (QA na cópia; spec não versionado), Python 3 (gerador da migration).

**Spec:** `docs/superpowers/specs/2026-09-24-data-nota-entrada-design.md` (fatos com `arquivo:linha`, desenho de dados e telas, riscos, §10 Decisões para o dono). Autoridade do desenho: `/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-24-nota-entrada/desenho-aprovado.md` (texto aprovado pelo dono em 24/set/2026, verbatim na spec §2). Referências de formato: `docs/superpowers/plans/2026-09-22-kanban-automatico-f1-banco.md` (migration/inverso/ensaio/runbook) e `docs/superpowers/plans/2026-09-24-planejamento-unificado-f34-comprado.md` (Global Constraints, Task 0, QA na cópia).

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
- Uma migration: `supabase/migrations/20261002100000_oc_data_nota_entrada.sql` (> `20261001100000` do Aviso Global > `20260930180000` da F3.1). Inverso: `supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql`. Os dois são GERADOS (`gerar_sql.py`, Task 3) — nunca editados à mão.
- Invariante #9: `fn_oc_nota_entrada_recalc`, `_recalcular_parcelas_core`, `recalcular_parcelas_etiqueta` e os 4 `_salvar_oc_*_core` com EXECUTE revogado de `PUBLIC, anon, authenticated`, conferido com `has_function_privilege`. As outras funções redefinidas mantêm o ACL de hoje.
- Importado: vencimento = etapas de câmbio, intocado (`_gerar_parcelas_importado` e gatilhos não são redefinidos).
- A cópia é COMPARTILHADA entre frentes: um QA por vez; toda escrita na cópia (ida/volta da migration, E1 do QA) passa por `copia.sh`/backup `pg_dump -Fc` e é registrada em `.superpowers/nota/copia-estado.md`.

**Front**
- Data = `<DateField>` (nunca `<input type="date">`); erro = `toast.error(mensagemErro(e, "…"))`; cor só por token (`--tone-warning-*`, `bg-warning`) — sem hex/hsl solto (anti-drift ativo em `tests/unit/ui-padroes-antidrift.test.ts`).
- Textos EXATOS (aprovados): "Data da Nota de Entrada" · "Falta a Data da Nota de Entrada — os vencimentos estão provisórios" · "vencimento provisório — falta a data da nota".
- Regra única de alerta/provisória em `src/lib/nota-entrada.ts` — nenhuma tela reimplementa.
- Toda OC salva/recebida invalida `["parcelas"]`, `["dash-financeiro"]`, `["oc-view"]` via `invalidarVencimentos(qc)`.
- Fora de escopo (spec §9): nada em `src/lib/erro-mensagem.ts`, `src/lib/realtime-invalidation-map.ts`, telas do Planejamento/Desenvolvimento/Kanban, `parcelas_servico`.

**Gates (todo commit de código):** `bash .superpowers/nota/gates.sh` → `GATES NOTA: ok` (tsc, build, unit sem falha nova, lista permitida, sem `type="date"`, sem toast cru). `tests/integration/*` só com `DATABASE_URL` da cópia.

**QA:** variante do app de teste na porta **5181** — JÁ reservada pelo controlador na linha `case "$PORTA"` do `criar-variante.sh` (backup `.bak-pre-reserva-portas`); o plano NÃO edita essa linha, só confere com `grep` e PARA se faltar (ruling R5 do guardião: várias frentes editando a mesma linha = corrida); guarda de rede INVERTIDA (qualquer `*.supabase.co` reprova); NUNCA tocar `:5173` (dono/produção), `:5188` (app de teste do dono), `:5180`, `:5182`–`:5187` (outras variantes), `:5198`/`:5199`; nunca junto com outro QA.

**Modelos e revisão:** implementadores Sonnet; revisores Opus (§3). Tasks de banco e dinheiro (2+3, 4, 10) com revisão INDIVIDUAL Opus. Portão G-migration pelo guardião (Task 13). Avisos ao dono por CHAT (sem `ExitPlanMode`). Não despachar subagente dentro de uma task.

**Ordem de produção:** depois da F1 e do Aviso Global. **Migration em produção SÓ pelo dono, no Terminal, com `pg_dump` completo antes (o plano Supabase NÃO tem PITR).** O merge do front na `feature/plan-tecido-a1` só DEPOIS da migration aplicada em produção (o `:5173` do dono lê produção assim que o código chega à branch; o front novo pede a coluna nova).

---

## 1. Fatos que o código abaixo assume (detalhes e `arquivo:linha` na spec §3)

- Base de hoje: Tecido/Aviamento/Insumo = `data_entrega` (o front grava a ÚLTIMA data das entregas ao receber), senão `CURRENT_DATE`; P. Acabado = `data_pedido` (parcelas nascem no PEDIDO e o gatilho regenera as não pagas a cada save); Importado = etapas.
- Todo save de OC recebida (Tecido/Aviamento/Insumo) já chama o recálculo no fim; o do P. Acabado regenera pelo gatilho a cada save. O recálculo preserva as pagas (`status='pago' OR data_pagamento IS NOT NULL`), redistribui `total − Σ pagas` nos números livres (o último absorve o resto) — Σ = total; as não pagas ganham id novo.
- md5 de 24/set das 10 funções (guarda da migration): spec §3.1. Cópia hoje: 458 funções | 263 gatilhos (F1 + coluna da F3.1). A migration acrescenta 1 função e 3 gatilhos (o do Acabado é recriado): 459 | 266.
- Loja Teste (`37889b78-fffb-404b-8c75-18b7e50a1d9b`, usuário `f1378ea4-…` super_admin): Tecido 7 recebidas, Aviamento 1, Insumo 1, P. Acabado 0 (2 encomendadas), Importado 1 encomendada com 3 etapas/3 parcelas; aviamento com preço e empresa; insumo com variante.
- `_salvar_oc_aviamento_core` tem 2 overloads (3 e 4 args): os testes chamam o de 4 args explicitamente; só o de 4 é redefinido (o de 3 não grava a coluna → mantém).
- `nº de pedido` sem dígitos finais faz o core entrar em laço se repetido — os testes usam `NOTA-TEC-90001` etc.

## 2. Mapa de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `src/lib/nota-entrada.ts` (novo) | Regra pura: famílias que alertam, `faltaNotaEntrada`, `parcelaProvisoria`, `baseVencimento`, `payloadDataNota`, textos, `invalidarVencimentos` | 1 |
| `tests/unit/nota-entrada.test.ts` (novo) | Unit da regra | 1 |
| `tests/integration/nota-entrada.test.ts` (novo) | Harness (migration na txn, só cópia) + 12 testes de banco/dinheiro | 2 |
| `supabase/migrations/20261002100000_oc_data_nota_entrada.sql` (gerado) | Coluna ×5, 10 funções, gatilho, ACL, guarda e pós-condição | 3 |
| `supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql` (gerado) | Inverso destrutivo com confirmação | 3 |
| `src/components/shared/NotaEntrada.tsx` (novo) | `CampoDataNotaEntrada`, `AvisoFaltaNota`, `BolinhaFaltaNota`, `TagParcelaProvisoria` | 5 |
| `src/components/oc-tecido/{shared.ts,OcTecidoForm.tsx,OcTecidoList.tsx}`, `src/routes/_authenticated/entrada-saida.oc-tecido.tsx` | OC Tecido | 6 |
| `src/routes/_authenticated/entrada-saida.oc-aviamento.tsx` | OC Aviamento | 7 |
| `src/routes/_authenticated/entrada-saida.oc-insumo.tsx` | OC Insumo | 8 |
| `src/components/oc-p-acabado/{shared.ts,OcPaForm.tsx}`, `…/entrada-saida.oc-p-acabado.tsx`, `src/components/oc-p-importado/{shared.ts,OcImpForm.tsx}`, `…/entrada-saida.oc-p-importado.tsx` | OC P. Acabado e P. Importado | 9 |
| `src/routes/_authenticated/financeiro.tsx` | Parcela provisória no Financeiro | 10 |
| `.superpowers/nota/**` (não versionado) | regras, gates, lista permitida, scripts da migration/cópia, logs, QA | 0, 3, 4, 12 |
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

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada"
chmod +x .superpowers/nota/gates.sh
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit > .superpowers/nota/unit-base.log 2>&1; tail -6 .superpowers/nota/unit-base.log
grep -E "^ FAIL " .superpowers/nota/unit-base.log | sed -E 's/ +[0-9]+ms$//' | sort -u > .superpowers/nota/unit-fail-base.txt; cat .superpowers/nota/unit-fail-base.txt
bash .superpowers/nota/gates.sh; echo "código=$?"
```

Expected: `unit-fail-base.txt` com as falhas HERDADAS (se houver — anotar); `GATES NOTA: ok` e `código=0` (nada mudou ainda). Código 1 aqui = a base está quebrada: PARE e reporte.

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

Expected: `Up … (healthy)`; contagens `458 263 0` em 24/set (outra frente pode ter mudado as duas primeiras — anotar; a 3ª TEM de ser `0`); as 10 linhas com EXATAMENTE os md5 da spec §3.1. md5 diferente = alguém mudou a função: PARE (a Task 3 recusaria) e avise o controlador. Coluna já presente = alguém aplicou esta migration: PARE.

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
  - `ROTULO_DATA_NOTA`, `AVISO_FALTA_NOTA`, `TEXTO_PARCELA_PROVISORIA`, `TITULO_BOLINHA`, `DICA_CAMPO_NOTA`, `DICA_CAMPO_NOTA_IMPORTADO: string`
  - `type OcNotaInfo = { status?: string | null; data_nota_entrada?: string | null }`
  - `type ParcelaNotaInfo = { tipo_oc?: string | null; status?: string | null; data_pagamento?: string | null }`
  - `temDataNota(v: string | null | undefined): boolean`
  - `faltaNotaEntrada(familia: string | null | undefined, oc: OcNotaInfo | null | undefined): boolean`
  - `parcelaPaga(p: ParcelaNotaInfo): boolean`
  - `parcelaProvisoria(p: ParcelaNotaInfo, oc: OcNotaInfo | null | undefined): boolean`
  - `baseVencimento(dataNota: string | null | undefined, baseDeHoje: string | null | undefined): string`
  - `payloadDataNota(v: string | null | undefined): string | null`
  - `QUERY_KEYS_VENCIMENTO: readonly (readonly string[])[]` (`[["parcelas"],["dash-financeiro"],["oc-view"]]`)
  - `invalidarVencimentos(qc: { invalidateQueries(f: { queryKey: readonly unknown[] }): unknown }): void`

- [ ] **Step 1: Escrever o teste (falha)** — `tests/unit/nota-entrada.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  AVISO_FALTA_NOTA, FAMILIAS_COM_ALERTA, QUERY_KEYS_VENCIMENTO, TEXTO_PARCELA_PROVISORIA, baseVencimento, faltaNotaEntrada,
  invalidarVencimentos, parcelaPaga, parcelaProvisoria, payloadDataNota, temDataNota,
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
  it("invalidarVencimentos: Financeiro (calendário/lista/resumo), dashboard e visão da OC", () => {
    const chaves: unknown[] = [];
    invalidarVencimentos({ invalidateQueries: (f) => { chaves.push(f.queryKey); } });
    expect(chaves).toEqual([["parcelas"], ["dash-financeiro"], ["oc-view"]]);
    expect(QUERY_KEYS_VENCIMENTO).toHaveLength(3);
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
 * parcela "provisória" do Financeiro, os textos aprovados e o espelho da base para a prévia do "Marcar recebido".
 */

/** Família de OC = valor de `parcelas.tipo_oc`. */
export type FamiliaOc = "tecido" | "aviamento" | "etiqueta" | "p_acabado" | "p_importado";

/** Famílias que ALERTAM (bolinha, aviso na OC, amarelo no Financeiro). Importado fora: "só registra" (spec §10 D2). */
export const FAMILIAS_COM_ALERTA: readonly FamiliaOc[] = ["tecido", "aviamento", "etiqueta", "p_acabado"];

export const ROTULO_DATA_NOTA = "Data da Nota de Entrada";
export const AVISO_FALTA_NOTA = "Falta a Data da Nota de Entrada — os vencimentos estão provisórios";
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

/** queryKeys que exibem vencimento de parcela — invalidar ao salvar/receber qualquer OC (a data pode ter mudado). */
export const QUERY_KEYS_VENCIMENTO: readonly (readonly string[])[] = [["parcelas"], ["dash-financeiro"], ["oc-view"]];

export function invalidarVencimentos(qc: { invalidateQueries(f: { queryKey: readonly unknown[] }): unknown }): void {
  for (const k of QUERY_KEYS_VENCIMENTO) void qc.invalidateQueries({ queryKey: [...k] });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `env -u DATABASE_URL npx vitest run tests/unit/nota-entrada.test.ts`
Expected: `Test Files 1 passed`, `Tests 7 passed`.

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

Cobertura (12 testes; 8 rodam nos dois modos, 4 só com `NOTA_MIG_TXN=1`):
1. ACL #9 das internas; RPCs de sempre seguem para `authenticated`.
2. Tecido: data → vencimentos = data + 30/60/90; mudar a data pela RPC → só as NÃO pagas mudam; paga idêntica (id, valor, vencimento, status, data de pagamento); valores das não pagas `333.34/333.33`; Σ = 1.000,00; data gravada.
3. Tecido: UPDATE direto da data recalcula (gatilho); OC encomendada não ganha parcela.
4. Tecido: chave ausente (front antigo) mantém; `""` e `null` limpam e voltam à base da entrega.
5. Aviamento, 6. Insumo: data, mudança pela RPC e por UPDATE direto, paga intacta, Σ = total (calculado no SQL).
7. P. Acabado: base = data antes do recebimento; mudança só nas não pagas; sem data = pedido; UPDATE direto re-dispara o gerador.
8. Importado: parcelas idênticas com e sem a data (controle = re-salvar sem a chave).
9. (MIG_TXN) sem a data = o de hoje, byte a byte (4 famílias; com e sem entrega; com paga + recálculo; prazo "30, 60").
10. (MIG_TXN) idempotente e ACL das 10 redefinidas igual à de antes.
11. (MIG_TXN) inverso: recusa sem confirmação (e não deixa nada pela metade); com ela, 10 funções no md5 de 24/set, gatilho do Acabado com as 3 colunas de antes, colunas fora, não pagas de volta à base da entrega, paga intacta, Σ = total; reaplicar depois funciona.
12. (MIG_TXN + `NOTA_CAPTURA_DEPOIS`) captura o texto DEPOIS para o diff da Task 3.

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
 *    `COMMIT;` — NUNCA `\i`: o COMMIT do arquivo fecharia a txn e VAZARIA, incidente 15/set). Roda TUDO, inclusive os 4 testes
 *    que precisam do estado de ANTES ("sem data = hoje", inverso, idempotência/ACL, captura do diff).
 *  • sem a variável — a migration já está aplicada na cópia (Task 4/12); roda os testes de comportamento; os 4 pulam.
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
/** Internas: EXECUTE revogado de PUBLIC/anon/authenticated (invariante #9). */
const INTERNAS = [
  "public.fn_oc_nota_entrada_recalc()",
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

function semTransacao(sql: string, nome: string): string {
  const nb = (sql.match(todas(RE_BEGIN)) ?? []).length;
  const nc = (sql.match(todas(RE_COMMIT)) ?? []).length;
  if (nb !== 1 || nc !== 1) throw new Error(`${nome}: esperado 1 "BEGIN;" e 1 "COMMIT;" em linha própria (achei ${nb}/${nc})`);
  const out = sql.replace(todas(RE_BEGIN), "-- [harness] BEGIN removido").replace(todas(RE_COMMIT), "-- [harness] COMMIT removido");
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
  await c.query(`update public.parcelas set status = 'pago', data_pagamento = '2026-10-01' where id = $1`, [id]);
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
      const id = await ocTecido(c, fx, { data_nota_entrada: "2026-10-05" });
      const p1 = await parcelas(c, "tecido", id);
      expect(p1.map((p) => p.venc)).toEqual(["2026-11-04", "2026-12-04", "2027-01-03"]);
      expect(centavos(p1)).toBe(100000);
      await pagar(c, p1[0].id);
      const paga = (await parcelas(c, "tecido", id))[0];
      await ocTecido(c, fx, { data_nota_entrada: "2026-10-20" }, id);
      const p2 = await parcelas(c, "tecido", id);
      expect(p2[0]).toEqual(paga); // mesma linha: id, valor, vencimento, status, data de pagamento
      expect(p2.slice(1).map((p) => p.venc)).toEqual(["2026-12-19", "2027-01-18"]);
      expect(p2.slice(1).map((p) => p.valor)).toEqual(["333.34", "333.33"]); // restante 666,67 em 2 (o último absorve o resto)
      expect(centavos(p2)).toBe(100000);
      expect(await notaDe(c, "ocs_tecido", id)).toBe("2026-10-20");
    });
  });

  it("Tecido: UPDATE direto da data também recalcula (gatilho); OC encomendada não ganha parcela", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const id = await ocTecido(c, fx, { data_nota_entrada: "2026-10-05" });
      await pagar(c, (await parcelas(c, "tecido", id))[0].id);
      const paga = (await parcelas(c, "tecido", id))[0];
      await c.query(`update public.ocs_tecido set data_nota_entrada = '2026-10-20' where id = $1`, [id]);
      const p = await parcelas(c, "tecido", id);
      expect(p[0]).toEqual(paga);
      expect(p.slice(1).map((x) => x.venc)).toEqual(["2026-12-19", "2027-01-18"]);
      expect(centavos(p)).toBe(100000);
      const enc = await ocTecido(c, fx, { status: "encomendado", numero_pedido: "NOTA-TEC-90002" });
      await c.query(`update public.ocs_tecido set data_nota_entrada = '2026-10-20' where id = $1`, [enc]);
      expect(await parcelas(c, "tecido", enc)).toEqual([]);
    });
  });

  it("Tecido: chave ausente (front antigo) MANTÉM a data; '' e null LIMPAM e voltam à base da entrega", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const id = await ocTecido(c, fx, { data_nota_entrada: "2026-10-05" });
      await ocTecido(c, fx, {}, id); // payload SEM a chave
      expect(await notaDe(c, "ocs_tecido", id)).toBe("2026-10-05");
      expect((await parcelas(c, "tecido", id)).map((p) => p.venc)).toEqual(["2026-11-04", "2026-12-04", "2027-01-03"]);
      await ocTecido(c, fx, { data_nota_entrada: "" }, id);
      expect(await notaDe(c, "ocs_tecido", id)).toBeNull();
      expect((await parcelas(c, "tecido", id)).map((p) => p.venc)).toEqual(["2026-10-10", "2026-11-09", "2026-12-09"]);
      await ocTecido(c, fx, { data_nota_entrada: "2026-10-05" }, id);
      await ocTecido(c, fx, { data_nota_entrada: null }, id);
      expect(await notaDe(c, "ocs_tecido", id)).toBeNull();
    });
  });

  it("Aviamento: data + mudança só nas não pagas + paga intacta + Σ = total", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const id = await ocAviamento(c, fx, { data_nota_entrada: "2026-10-05" });
      const total = await totalAviamento(c, id);
      const p1 = await parcelas(c, "aviamento", id);
      expect(p1.map((p) => p.venc)).toEqual(["2026-11-04", "2026-12-04"]);
      expect(centavos(p1)).toBe(total);
      await pagar(c, p1[0].id);
      const paga = (await parcelas(c, "aviamento", id))[0];
      await ocAviamento(c, fx, { data_nota_entrada: "2026-10-20" }, id);
      const p2 = await parcelas(c, "aviamento", id);
      expect(p2[0]).toEqual(paga);
      expect(p2[1].venc).toBe("2026-12-19");
      expect(centavos(p2)).toBe(total);
      await c.query(`update public.ocs_aviamento set data_nota_entrada = '2026-11-01' where id = $1`, [id]);
      const p3 = await parcelas(c, "aviamento", id);
      expect(p3[0]).toEqual(paga);
      expect(p3[1].venc).toBe("2026-12-31");
      expect(centavos(p3)).toBe(total);
    });
  });

  it("Insumo: data + mudança só nas não pagas + paga intacta + Σ = total", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const id = await ocInsumo(c, fx, { data_nota_entrada: "2026-10-05" });
      const total = await totalInsumo(c, id);
      const p1 = await parcelas(c, "etiqueta", id);
      expect(p1.map((p) => p.venc)).toEqual(["2026-11-04", "2026-12-04"]);
      expect(centavos(p1)).toBe(total);
      await pagar(c, p1[0].id);
      const paga = (await parcelas(c, "etiqueta", id))[0];
      await ocInsumo(c, fx, { data_nota_entrada: "2026-10-20" }, id);
      const p2 = await parcelas(c, "etiqueta", id);
      expect(p2[0]).toEqual(paga);
      expect(p2[1].venc).toBe("2026-12-19");
      expect(centavos(p2)).toBe(total);
      await c.query(`update public.ocs_etiqueta set data_nota_entrada = '2026-11-01' where id = $1`, [id]);
      const p3 = await parcelas(c, "etiqueta", id);
      expect(p3[0]).toEqual(paga);
      expect(p3[1].venc).toBe("2026-12-31");
      expect(centavos(p3)).toBe(total);
    });
  });

  it("P. Acabado: a data já é a base antes do recebimento; mudar só move as não pagas; paga intacta; Σ = total", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const id = await ocPAcabado(c, fx, { data_nota_entrada: "2026-10-05" });
      const p1 = await parcelas(c, "p_acabado", id);
      expect(p1.map((p) => p.venc)).toEqual(["2026-11-04", "2026-12-04"]);
      expect(centavos(p1)).toBe(100000);
      await pagar(c, p1[0].id);
      const paga = (await parcelas(c, "p_acabado", id))[0];
      await ocPAcabado(c, fx, { data_nota_entrada: "2026-10-20" }, id);
      const p2 = await parcelas(c, "p_acabado", id);
      expect(p2[0]).toEqual(paga);
      expect(p2[1].venc).toBe("2026-12-19");
      expect(centavos(p2)).toBe(100000);
      // sem a data a base é o pedido (hoje) — e o UPDATE direto da data re-dispara o gerador
      const id2 = await ocPAcabado(c, fx, { nome_produto: "NOTA-PA-2" });
      expect((await parcelas(c, "p_acabado", id2)).map((p) => p.venc)).toEqual(["2026-10-01", "2026-10-31"]);
      await c.query(`update public.ocs_p_acabado set data_nota_entrada = '2026-10-05' where id = $1`, [id2]);
      expect((await parcelas(c, "p_acabado", id2)).map((p) => p.venc)).toEqual(["2026-11-04", "2026-12-04"]);
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
      await salvarImportado(c, oc.id, { data_nota_entrada: "2026-10-05" });
      expect(await notaDe(c, "ocs_importado", oc.id)).toBe("2026-10-05");
      expect(semId(await parcelas(c, "p_importado", oc.id))).toEqual(base);
      await c.query(`update public.ocs_importado set data_nota_entrada = '2026-10-20' where id = $1`, [oc.id]);
      expect(semId(await parcelas(c, "p_importado", oc.id))).toEqual(base);
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
    });
  });

  it.skipIf(!MIG_TXN)("inverso: recusa sem confirmação; com ela volta as 10 funções (md5 de 24/set) e a base antiga das não pagas", async () => {
    await withTx(async (c) => {
      await prepara(c); // aplica a migration na txn
      const fx = await fixtures(c);
      const id = await ocTecido(c, fx, { data_nota_entrada: "2026-10-05" });
      await pagar(c, (await parcelas(c, "tecido", id))[0].id);
      const paga = (await parcelas(c, "tecido", id))[0];
      await expect(aplicarArquivo(c, DOWN)).rejects.toThrow(/confirmo_apagar_data_nota_entrada/);
      expect(await colunas(c)).toBe(5); // a recusa não deixou nada pela metade
      await aplicarArquivo(c, DOWN, "SET LOCAL app.confirmo_apagar_data_nota_entrada = 'sim'");
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
      await aplicarArquivo(c, MIG); // reaplicar depois de desfazer
      expect(await colunas(c)).toBe(5);
    });
  });

  it.skipIf(!MIG_TXN || !CAPTURA)("captura pg_get_functiondef DEPOIS (diff da Task 3) — só escreve arquivos locais", async () => {
    await withTx(async (c) => {
      await prepara(c);
      mkdirSync(CAPTURA, { recursive: true });
      const linhas: string[] = [];
      for (const sig of Object.keys(MD5_ANTES)) {
        const r = await um<{ d: string; m: string }>(c, `select pg_get_functiondef($1::regprocedure) d, md5(pg_get_functiondef($1::regprocedure)) m`, [sig]);
        writeFileSync(`${CAPTURA}/${sig.replace(/^public\./, "").split("(")[0]}.sql`, r.d);
        linhas.push(`${sig} ${r.m}`);
      }
      writeFileSync(`${CAPTURA}/md5-depois.txt`, linhas.join("\n") + "\n");
    });
  });
});
```

- [ ] **Step 2: Rodar SÓ na cópia e ver falhar (a migration ainda não existe)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada"
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
- Produces: as colunas `data_nota_entrada date` nas 5 tabelas; `fn_oc_nota_entrada_recalc()` + gatilhos `trg_nota_entrada_recalc` (tecido/aviamento/etiqueta); `trg_gerar_parcelas_ocpa` escutando a coluna; os 5 saves aceitando a chave `data_nota_entrada` (`_oc` em Tecido/Aviamento/Insumo; `_dados` em P. Acabado/Importado): ausente = mantém, `""`/`null` = limpa. É o contrato que as Tasks 6–10 usam.

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

- [ ] **Step 2: Gerador** — `.superpowers/nota/mig/gerar_sql.py` (o diff mínimo mora em `TROCAS`; cada par casa exatamente 1 vez ou o script recusa):

```python
#!/usr/bin/env python3
"""Gera a migration e o inverso da "Data da Nota de Entrada" a partir do texto VIVO das 10 funções (cópia local).

Uso (na raiz da worktree, depois de `bash .superpowers/nota/mig/dump_antes.sh`):
    python3 .superpowers/nota/mig/gerar_sql.py
Escreve:
    supabase/migrations/20261002100000_oc_data_nota_entrada.sql
    supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql
    .superpowers/nota/mig/depois-esperado/<nome>.sql   (texto que a migration instala)
    .superpowers/nota/mig/diff-esperado.txt            (diff antes → depois; tem de bater com o plano, Task 3)
Recusa (sai ≠ 0) se o texto vivo de alguma função não tiver o md5 do levantamento de 24/set ou se alguma troca não casar
exatamente 1 vez. NUNCA edite os .sql gerados à mão — regenere.
"""
import difflib
import hashlib
import os
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
    "_recalcular_parcelas_core(uuid,text)",
    "recalcular_parcelas_etiqueta(uuid)",
    "_salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)",
    "_salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)",
    "_salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)",
    "_salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)",
    "gerar_parcelas_oc_tecido()",
    "gerar_parcelas_oc_aviamento()",
]
INTERNAS_REVOKE = INTERNAS[:7]  # as 2 geradoras já estão revogadas hoje; só conferidas na pós-condição

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

    guarda_valores = sql_list([f"('public.{sig}', '{m}')" for sig, m in FUNCS])
    sigs10 = ", ".join(f"'public.{sig}'" for sig, _ in FUNCS)
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
--  5. ACL (invariante #9).
-- Inverso: supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql (DESTRUTIVO: apaga as datas digitadas).
BEGIN;
SET LOCAL lock_timeout = '5s';

-- 0) Guarda: nenhuma das 10 funções mudou desde o levantamento de 24/set. Se já contém data_nota_entrada = reaplicação.
DO $guarda$
DECLARE
  r record;
  v_def text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    {guarda_valores}
  ) AS t(sig, md5_antes) LOOP
    v_def := pg_get_functiondef(r.sig::regprocedure);
    CONTINUE WHEN position('data_nota_entrada' in v_def) > 0;
    IF md5(v_def) <> r.md5_antes THEN
      RAISE EXCEPTION 'data_nota_entrada: % mudou desde 24/set (md5 % <> %) — regenerar a migration a partir do texto VIVO (plano, Task 3) antes de aplicar',
        r.sig, md5(v_def), r.md5_antes USING ERRCODE = 'P0001';
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
    mig.append("""-- 4) Recalcular as NÃO pagas quando a data muda numa OC JÁ recebida (qualquer caminho: RPC ou UPDATE direto)
CREATE OR REPLACE FUNCTION public.fn_oc_nota_entrada_recalc()
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
$function$;

DROP TRIGGER IF EXISTS trg_nota_entrada_recalc ON public.ocs_tecido;
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

-- 5) ACL (#9): internas sem EXECUTE para PUBLIC/anon/authenticated (CREATE OR REPLACE preserva o ACL; aqui reafirma).
""")
    for s in INTERNAS_REVOKE:
        mig.append(f"REVOKE EXECUTE ON FUNCTION public.{s} FROM PUBLIC, anon, authenticated;\n")
    mig.append(f"""
-- 6) Pós-condição (falha alto e desfaz tudo se algo não ficou como o plano)
DO $pos$
DECLARE
  v_n int;
  v_sig text;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'data_nota_entrada'
     AND table_name IN ('ocs_tecido', 'ocs_aviamento', 'ocs_etiqueta', 'ocs_p_acabado', 'ocs_importado');
  IF v_n <> 5 THEN RAISE EXCEPTION 'data_nota_entrada: esperado 5 colunas, achei %', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE NOT tgisinternal AND tgname = 'trg_nota_entrada_recalc'
     AND tgrelid IN ('public.ocs_tecido'::regclass, 'public.ocs_aviamento'::regclass, 'public.ocs_etiqueta'::regclass);
  IF v_n <> 3 THEN RAISE EXCEPTION 'data_nota_entrada: esperado 3 gatilhos trg_nota_entrada_recalc, achei %', v_n; END IF;
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
  FOREACH v_sig IN ARRAY ARRAY[{sigs10}] LOOP
    IF position('data_nota_entrada' in pg_get_functiondef(v_sig::regprocedure)) = 0 THEN
      RAISE EXCEPTION 'data_nota_entrada: % não foi redefinida', v_sig;
    END IF;
  END LOOP;
END
$pos$;

select pg_notify('pgrst', 'reload schema');
COMMIT;
""")
    open(MIG, "w", encoding="utf-8").write("".join(mig))

    down = []
    down.append(f"""-- INVERSO de supabase/migrations/20261002100000_oc_data_nota_entrada.sql
-- ⚠️ DESTRUTIVO: APAGA as Datas da Nota de Entrada digitadas nas 5 OCs. Exporte antes (plano, Task 13 Step 10).
-- Exige, na MESMA transação:  SET LOCAL app.confirmo_apagar_data_nota_entrada = 'sim';
-- Faz: derruba os gatilhos novos, recria o do P. Acabado como era, restaura as 10 funções com o texto de 24/set (md5
-- conferido no fim), devolve a base ANTIGA às parcelas NÃO pagas das OCs que tinham data (pagas intactas) e só então apaga
-- as colunas. ARQUIVO GERADO por .superpowers/nota/mig/gerar_sql.py — NÃO editar à mão.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $confirma$
BEGIN
  IF coalesce(current_setting('app.confirmo_apagar_data_nota_entrada', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'o inverso da data_nota_entrada APAGA as datas digitadas nas OCs — exporte antes e rode com SET LOCAL app.confirmo_apagar_data_nota_entrada = ''sim'' na mesma transação'
      USING ERRCODE = 'P0001';
  END IF;
END
$confirma$;

-- 0) Guarda: cada função está na versão da migration (contém data_nota_entrada) ou já no texto de 24/set.
DO $guarda$
DECLARE
  r record;
  v_def text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    {guarda_valores}
  ) AS t(sig, md5_antes) LOOP
    v_def := pg_get_functiondef(r.sig::regprocedure);
    CONTINUE WHEN md5(v_def) = r.md5_antes OR position('data_nota_entrada' in v_def) > 0;
    RAISE EXCEPTION 'data_nota_entrada (inverso): % foi mudada por outra frente depois da migration — PARE e refaça o inverso contra o texto VIVO', r.sig
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

-- 2) Gatilhos
DROP TRIGGER IF EXISTS trg_nota_entrada_recalc ON public.ocs_tecido;
DROP TRIGGER IF EXISTS trg_nota_entrada_recalc ON public.ocs_aviamento;
DROP TRIGGER IF EXISTS trg_nota_entrada_recalc ON public.ocs_etiqueta;
DROP FUNCTION IF EXISTS public.fn_oc_nota_entrada_recalc();
DROP TRIGGER IF EXISTS trg_gerar_parcelas_ocpa ON public.ocs_p_acabado;
CREATE TRIGGER trg_gerar_parcelas_ocpa
  AFTER INSERT OR UPDATE OF valor_total_desconto, prazo_pagamento, data_pedido ON public.ocs_p_acabado
  FOR EACH ROW EXECUTE FUNCTION public.gerar_parcelas_oc_p_acabado();

-- 3) As 10 funções de volta ao texto de 24/set
""")
    for sig, _ in FUNCS:
        down.append(antes[sig].rstrip("\n") + ";\n\n")
    down.append("""-- 4) Base ANTIGA de volta nas NÃO pagas (as funções restauradas já não leem a coluna; pagas intactas).
--    P. Acabado: re-dispara o PRÓPRIO gerador (mesmo parser '/' de hoje) com um UPDATE neutro de data_pedido
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

-- 5) Colunas (DESTRUTIVO)
""")
    for t in TABELAS:
        down.append(f"ALTER TABLE public.{t} DROP COLUMN IF EXISTS data_nota_entrada;\n")
    down.append("\n-- 6) ACL reafirmada (#9)\n")
    for s in INTERNAS_REVOKE[1:]:
        down.append(f"REVOKE EXECUTE ON FUNCTION public.{s} FROM PUBLIC, anon, authenticated;\n")
    down.append(f"""
-- 7) Pós-condição: 10 funções no md5 de 24/set; nenhuma coluna, gatilho ou função nova sobrando
DO $pos$
DECLARE
  r record;
  v_n int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    {guarda_valores}
  ) AS t(sig, md5_antes) LOOP
    IF md5(pg_get_functiondef(r.sig::regprocedure)) <> r.md5_antes THEN
      RAISE EXCEPTION 'data_nota_entrada (inverso): % não voltou ao texto de 24/set', r.sig;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'data_nota_entrada';
  IF v_n <> 0 THEN RAISE EXCEPTION 'data_nota_entrada (inverso): sobrou % coluna(s)', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'trg_nota_entrada_recalc';
  IF v_n <> 0 THEN RAISE EXCEPTION 'data_nota_entrada (inverso): sobrou % gatilho(s)', v_n; END IF;
  IF to_regprocedure('public.fn_oc_nota_entrada_recalc()') IS NOT NULL THEN
    RAISE EXCEPTION 'data_nota_entrada (inverso): fn_oc_nota_entrada_recalc sobrou';
  END IF;
END
$pos$;

select pg_notify('pgrst', 'reload schema');
COMMIT;
""")
    open(DOWN, "w", encoding="utf-8").write("".join(down))
    print("ok: migration, inverso, depois-esperado/ e diff-esperado.txt gerados")
    for sig, _ in FUNCS:
        print(f"  {sig}: antes {md5(antes[sig])}  depois-esperado {md5(depois[sig])}")
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
cat .superpowers/nota/mig/diff-esperado.txt
```

Expected: `arquivos: 10`; `ok: migration, inverso, depois-esperado/ e diff-esperado.txt gerados`; os md5 impressos:

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
```

(~1.414 linhas a migration e ~1.400 o inverso — o grosso é o texto das 10 funções.) O `diff-esperado.txt` tem de ser EXATAMENTE este (é o diff mínimo aprovado no plano — qualquer linha a mais = PARE):

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

- [ ] **Step 4: Suíte SÓ na cópia, com a migration dentro da transação**

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres NOTA_MIG_TXN=1 \
  npx vitest run --no-file-parallelism tests/integration/nota-entrada.test.ts 2>&1 | tail -8
```

Expected: `Tests 11 passed | 1 skipped` (o de captura pula sem `NOTA_CAPTURA_DEPOIS`). Nenhum "there is no transaction in progress". Conferir que a cópia NÃO mudou (tudo foi revertido): repetir o 1º comando do Task 0 Step 5 → as mesmas contagens de `copia-contagens-t0.txt` (3ª = `0`).

- [ ] **Step 5: Capturar o `pg_get_functiondef` DEPOIS e registrar o diff antes → depois**

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres NOTA_MIG_TXN=1 \
  NOTA_CAPTURA_DEPOIS="$PWD/.superpowers/nota/mig/depois" \
  npx vitest run --no-file-parallelism tests/integration/nota-entrada.test.ts -t "captura" 2>&1 | tail -4
python3 - <<'PY'
import os
M = ".superpowers/nota/mig"
for n in sorted(os.listdir(f"{M}/antes")):
    ler = lambda d: open(f"{M}/{d}/{n}", encoding="utf-8").read().rstrip("\n")
    antes, depois, esperado = ler("antes"), ler("depois"), ler("depois-esperado")
    if depois == antes:
        print(f"IGUAL?! {n} (a migration não redefiniu)")
    elif depois == esperado:
        print(f"ok  {n} (depois vivo = depois-esperado)")
    else:
        print(f"DIVERGE  {n}")
PY
cp .superpowers/nota/mig/depois/md5-depois.txt .superpowers/nota/mig/md5-depois.txt; cat .superpowers/nota/mig/md5-depois.txt
```

Expected: `1 passed`; 10× `ok` e nenhum `IGUAL?!`/`DIVERGE` (o texto que o Postgres devolve é o que a migration instala — o diff antes → depois é o `diff-esperado.txt`). `md5-depois.txt` = os md5 "depois-esperado" do Step 3 (vira referência do runbook, Task 13). `DIVERGE` = o Postgres normalizou algo: registrar o diff em `.superpowers/nota/mig/divergencia.md` e levar ao revisor Opus antes de seguir.

- [ ] **Step 6: Gate + commit (Tasks 2 e 3 juntas)**

```bash
bash .superpowers/nota/gates.sh
git add -- tests/integration/nota-entrada.test.ts supabase/migrations/20261002100000_oc_data_nota_entrada.sql supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql
git commit --only -m "feat(nota-entrada): migration 20261002100000 — data_nota_entrada nas 5 OCs, base do vencimento COALESCE(nota, base de hoje), recálculo das não pagas, inverso destrutivo com confirmação + testes de integração (só na cópia)" -m "Co-Authored-By: <seu modelo> <noreply@anthropic.com>" -- tests/integration/nota-entrada.test.ts supabase/migrations/20261002100000_oc_data_nota_entrada.sql supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql
```

Revisão individual Opus (Tasks 2+3) com: `diff-esperado.txt`, a saída dos Steps 4–5, `md5-depois.txt` e o checklist da §3.

---

## Task 4: Ensaio na CÓPIA — aplicar de verdade, suíte, desfazer  *(controlador; revisão individual Opus da saída)*

**Files:** nenhum no repo. Cria `.superpowers/nota/copia.sh` e registra em `.superpowers/nota/copia-estado.md`. Escreve na cópia (backup antes) e a devolve como estava.

- [ ] **Step 1: Script da cópia** — `.superpowers/nota/copia.sh`:

```bash
#!/usr/bin/env bash
# Aplica (ida) / desfaz (volta) a migration da Data da Nota de Entrada na CÓPIA LOCAL (127.0.0.1:54422). NUNCA produção.
# Uso: bash .superpowers/nota/copia.sh ida|volta     — backup pg_dump -Fc ANTES; um QA por vez; para em qualquer dúvida.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
MIG=supabase/migrations/20261002100000_oc_data_nota_entrada.sql
DOWN=supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql
BK="/Users/sunglee/PLM + Criação/banco-local/backups"
REG=.superpowers/nota/copia-estado.md
CONT="select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') || '|' || (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal) || '|' || (select count(*) from information_schema.columns where table_schema='public' and column_name='data_nota_entrada')"
ATIV="select count(*) from pg_stat_activity where datname=current_database() and backend_type='client backend' and pid<>pg_backend_pid() and state<>'idle'"
case "${1:-}" in ida|volta) ;; *) echo "uso: copia.sh ida|volta"; exit 2;; esac
docker ps --filter name=supabase_db_banco-local --format '{{.Status}}' | grep -q healthy || { echo "cópia fora do ar — PARE (não subir/recriar por conta própria)"; exit 1; }
if ps -Ao command | grep -E "[v]itest|[p]laywright" >/dev/null; then echo "há vitest/playwright rodando — PARE (um QA por vez na cópia)"; exit 1; fi
if [ "$(psql "$LOCAL" -X -A -t -c "$ATIV")" != "0" ]; then
  psql "$LOCAL" -X -c "select pid, usename, application_name, state, left(query,60) consulta from pg_stat_activity where datname=current_database() and backend_type='client backend' and pid<>pg_backend_pid() and state<>'idle'"
  echo "sessão ativa na cópia — PARE (outra frente usando a cópia)"; exit 1
fi
ANTES="$(psql "$LOCAL" -X -A -t -c "$CONT")"
echo "antes (funções|gatilhos|colunas): $ANTES"
case "$1" in
  ida)   [ "${ANTES##*|}" = "0" ] || { echo "a cópia JÁ tem a coluna — nada a fazer"; exit 0; } ;;
  volta) [ "${ANTES##*|}" = "5" ] || { echo "a cópia NÃO tem as 5 colunas — nada a desfazer (ou estado estranho: PARE)"; exit 0; } ;;
esac
F="$BK/pre-nota-$1-$(date +%F-%H%M%S).dump"
docker exec -e PGPASSWORD=postgres supabase_db_banco-local pg_dump -h 127.0.0.1 -U supabase_admin -d postgres -Fc > "$F"
[ -s "$F" ] || { echo "backup vazio — PARE"; exit 1; }
echo "backup: $F"
if [ "$1" = ida ]; then
  PGOPTIONS='-c lock_timeout=5s' psql "$LOCAL" -X -q -1 -v ON_ERROR_STOP=1 -f "$MIG"
else
  PGOPTIONS='-c lock_timeout=5s' psql "$LOCAL" -X -q -1 -v ON_ERROR_STOP=1 \
    -c "SET LOCAL app.confirmo_apagar_data_nota_entrada = 'sim'" -f "$DOWN"
fi
DEPOIS="$(psql "$LOCAL" -X -A -t -c "$CONT")"
echo "depois (funções|gatilhos|colunas): $DEPOIS"
printf -- '- %s  %s  %s → %s  backup %s\n' "$(date '+%F %T')" "$1" "$ANTES" "$DEPOIS" "$F" >> "$REG"
```

- [ ] **Step 2: Ida → suíte normal → volta → suíte com a migration na txn**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada"
chmod +x .superpowers/nota/copia.sh
bash .superpowers/nota/copia.sh ida
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/integration/nota-entrada.test.ts 2>&1 | tail -5
PGOPTIONS='-c default_transaction_read_only=on' psql "postgresql://postgres:postgres@127.0.0.1:54422/postgres" -X -A -t -F' ' -c "
  select p.oid::regprocedure, md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid in (
    'public.gerar_parcelas_oc_tecido()'::regprocedure, 'public.gerar_parcelas_oc_aviamento()'::regprocedure,
    'public.gerar_parcelas_oc_p_acabado()'::regprocedure, 'public._recalcular_parcelas_core(uuid,text)'::regprocedure,
    'public.recalcular_parcelas_etiqueta(uuid)'::regprocedure, 'public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)'::regprocedure,
    'public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)'::regprocedure, 'public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)'::regprocedure,
    'public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)'::regprocedure,
    'public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)'::regprocedure) order by 1" > .superpowers/nota/copia-md5-ensaio.txt
cat .superpowers/nota/copia-md5-ensaio.txt
bash .superpowers/nota/copia.sh volta
diff .superpowers/nota/copia-md5-t0.txt <(PGOPTIONS='-c default_transaction_read_only=on' psql "postgresql://postgres:postgres@127.0.0.1:54422/postgres" -X -A -t -F' ' -c "select p.oid::regprocedure, md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid in ('public.gerar_parcelas_oc_tecido()'::regprocedure, 'public.gerar_parcelas_oc_aviamento()'::regprocedure, 'public.gerar_parcelas_oc_p_acabado()'::regprocedure, 'public._recalcular_parcelas_core(uuid,text)'::regprocedure, 'public.recalcular_parcelas_etiqueta(uuid)'::regprocedure, 'public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)'::regprocedure, 'public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)'::regprocedure, 'public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)'::regprocedure, 'public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)'::regprocedure, 'public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)'::regprocedure) order by 1") && echo "CÓPIA DE VOLTA AO TEXTO DE 24/SET"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres NOTA_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/nota-entrada.test.ts 2>&1 | tail -5
cat .superpowers/nota/copia-estado.md
```

Expected: `ida` → `antes 458|263|0` (ou os números do T0) → `depois 459|266|5` (+1 função, +3 gatilhos, 5 colunas), com backup `pre-nota-ida-….dump`; a suíte sem `NOTA_MIG_TXN` → `8 passed | 4 skipped`; os md5 do ensaio = `md5-depois.txt` (Task 3); `volta` → `459|266|5 → 458|263|0` com backup `pre-nota-volta-….dump`; `CÓPIA DE VOLTA AO TEXTO DE 24/SET`; a suíte com `NOTA_MIG_TXN=1` de novo verde (`11 passed | 1 skipped`); 2 linhas em `copia-estado.md`. Cada `psql -1` mostra 2 avisos inofensivos (`there is already a transaction in progress` / `there is no transaction in progress`) — o `-1` abre uma txn e o arquivo tem a própria. Qualquer `ERROR`/`PARE`: não seguir; a cópia fica como o `copia.sh` a deixou — registrar e chamar o controlador (restauração do backup só com OK do dono).

- [ ] **Step 2b (registro):** colar a saída inteira no diário do guardião (`/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-24-nota-entrada/guardiao.md`, append). Sem commit.

---

## Task 5: Peças de tela compartilhadas — `NotaEntrada.tsx`  *(Lote A)*

**Files:**
- Create: `src/components/shared/NotaEntrada.tsx`

**Interfaces:**
- Consumes (Task 1): `AVISO_FALTA_NOTA`, `DICA_CAMPO_NOTA`, `ROTULO_DATA_NOTA`, `TEXTO_PARCELA_PROVISORIA`, `TITULO_BOLINHA`; `DateField` (`src/components/shared/DateField.tsx`: `value/onChange/disabled/id/aria-label/data-colab-path/inputClassName`).
- Produces:
  - `CampoDataNotaEntrada(props: { value: string; onChange: (iso: string) => void; disabled?: boolean; dica?: string; colabPath?: string; inputClassName?: string; className?: string; children?: ReactNode })`
  - `AvisoFaltaNota(props: { show: boolean })` — `data-qa="aviso-falta-nota"`
  - `BolinhaFaltaNota(props: { show: boolean })` — `data-qa="bolinha-falta-nota"`
  - `TagParcelaProvisoria(props: { show: boolean; className?: string })` — `data-qa="tag-parcela-provisoria"`

- [ ] **Step 1: Implementar** — `src/components/shared/NotaEntrada.tsx`:

```tsx
import { useId, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { DateField } from "@/components/shared/DateField";
import { cn } from "@/lib/utils";
import {
  AVISO_FALTA_NOTA, DICA_CAMPO_NOTA, ROTULO_DATA_NOTA, TEXTO_PARCELA_PROVISORIA, TITULO_BOLINHA,
} from "@/lib/nota-entrada";

/**
 * Peças de tela da "Data da Nota de Entrada" (spec 2026-09-24 §5). Regras em `@/lib/nota-entrada` — aqui só apresentação.
 * Cor SÓ por token de tom (§Q9): `--tone-warning-*` e `bg-warning` — nada de hex/hsl solto (anti-drift).
 */

/** Campo do cabeçalho das 5 OCs. SEMPRE `<DateField>` (dd/mm/aaaa na tela, ISO por baixo) — nunca o input nativo de data. */
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
  return (
    <div className={cn("grid gap-1", className)}>
      <Label htmlFor={id}>{ROTULO_DATA_NOTA}</Label>
      <DateField
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        data-colab-path={colabPath}
        inputClassName={inputClassName}
        aria-label={ROTULO_DATA_NOTA}
      />
      <p className="text-xs text-muted-foreground">{dica}</p>
      {children}
    </div>
  );
}

/** Aviso no topo da OC recebida sem a data (texto aprovado pelo dono, verbatim). */
export function AvisoFaltaNota({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div
      role="status"
      data-qa="aviso-falta-nota"
      className="flex items-start gap-2 rounded-md border border-warning/40 bg-[var(--tone-warning-bg)] px-3 py-2 text-sm text-[var(--tone-warning-fg)]"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{AVISO_FALTA_NOTA}</span>
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
import { AvisoFaltaNota } from "@/components/shared/NotaEntrada";
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
          <AvisoFaltaNota show={faltaNotaEntrada("tecido", { status, data_nota_entrada: draft.data_nota_entrada })} />
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

- [ ] **Step 5: Conferir e gate**

```bash
grep -c "BolinhaFaltaNota show" src/components/oc-tecido/OcTecidoList.tsx          # 4
grep -c "data_nota_entrada" src/routes/_authenticated/entrada-saida.oc-tecido.tsx   # 5
grep -c "CampoDataNotaEntrada" src/components/oc-tecido/OcTecidoForm.tsx            # 3
bash .superpowers/nota/gates.sh
```

Expected: `4`, `5`, `3`; `GATES NOTA: ok`.

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
import { AvisoFaltaNota, BolinhaFaltaNota, CampoDataNotaEntrada } from "@/components/shared/NotaEntrada";
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
          <AvisoFaltaNota show={faltaNotaEntrada("aviamento", { status, data_nota_entrada: draft.data_nota_entrada })} />
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

- [ ] **Step 2: Conferir, gate, commit**

```bash
F=src/routes/_authenticated/entrada-saida.oc-aviamento.tsx
grep -c "BolinhaFaltaNota show" $F      # 4
grep -c "data_nota_entrada" $F          # 9
bash .superpowers/nota/gates.sh
git add -- $F
git commit --only -m "feat(nota-entrada): OC Aviamento — campo, aviso, bolinha e invalidação do Financeiro" -m "Co-Authored-By: <seu modelo> <noreply@anthropic.com>" -- $F
```

Expected: `4`, `9`, `GATES NOTA: ok`.

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
import { AvisoFaltaNota, BolinhaFaltaNota, CampoDataNotaEntrada } from "@/components/shared/NotaEntrada";
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
          <AvisoFaltaNota show={faltaNotaEntrada("etiqueta", { status, data_nota_entrada: dataNota })} />
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

- [ ] **Step 2: Conferir, gate, commit**

```bash
F=src/routes/_authenticated/entrada-saida.oc-insumo.tsx
grep -c "data_nota_entrada" $F          # 10
grep -c "setDataNota" $F                # 4
grep -c "BolinhaFaltaNota show" $F      # 2
bash .superpowers/nota/gates.sh
git add -- $F
git commit --only -m "feat(nota-entrada): OC Insumo — campo, aviso, bolinha, merge colaborativo e invalidação do Financeiro" -m "Co-Authored-By: <seu modelo> <noreply@anthropic.com>" -- $F
```

Expected: `10`, `4`, `2`, `GATES NOTA: ok`.

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
import { AvisoFaltaNota, BolinhaFaltaNota } from "@/components/shared/NotaEntrada";
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
            <AvisoFaltaNota show={faltaNotaEntrada("p_acabado", { status, data_nota_entrada: draft.data_nota_entrada })} />
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

- [ ] **Step 5: Conferir, gate, commit**

```bash
grep -c "data_nota_entrada" src/routes/_authenticated/entrada-saida.oc-p-acabado.tsx     # 5
grep -c "BolinhaFaltaNota show" src/routes/_authenticated/entrada-saida.oc-p-acabado.tsx # 2
grep -c "data_nota_entrada" src/routes/_authenticated/entrada-saida.oc-p-importado.tsx   # 3
grep -c "AvisoFaltaNota\|BolinhaFaltaNota" src/routes/_authenticated/entrada-saida.oc-p-importado.tsx  # 0 (D2)
bash .superpowers/nota/gates.sh
P="src/components/oc-p-acabado/shared.ts src/components/oc-p-acabado/OcPaForm.tsx src/routes/_authenticated/entrada-saida.oc-p-acabado.tsx src/components/oc-p-importado/shared.ts src/components/oc-p-importado/OcImpForm.tsx src/routes/_authenticated/entrada-saida.oc-p-importado.tsx"
git add -- $P
git commit --only -m "feat(nota-entrada): OC P. Acabado (base do vencimento, aviso, bolinha) e OC P. Importado (só registro) + invalidação do Financeiro" -m "Co-Authored-By: <seu modelo> <noreply@anthropic.com>" -- $P
```

Expected: `5`, `2`, `3`, `0`; `GATES NOTA: ok`.

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

**Files:** nenhum no repo. Saída em `/Users/sunglee/PLM + Criação/savepoints/<data>-pre-nota-entrada/` (FORA do repo; contém dado de loja; nunca commitar).

Quando: (1) no dia da aplicação em produção, ANTES do `pg_dump` do dono (Task 13 Step 4); (2) de novo antes do merge, se passar mais de 1 dia. Se o classificador bloquear o controlador, o DONO roda o mesmo bloco no Terminal. Só leitura (`default_transaction_read_only=on`).

- [ ] **Step 1: Exportar**

```bash
DEST="/Users/sunglee/PLM + Criação/savepoints/$(date +%F)-pre-nota-entrada"
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
(cd "$DEST" && for f in *.csv; do printf '%s\t%s linhas\t%s\n' "$f" "$(($(wc -l < "$f") - 1))" "$(shasum -a 256 "$f" | cut -c1-16)"; done) > "$DEST/INDICE.tsv"
cat "$DEST/INDICE.tsv" "$DEST/contagens.txt"; cut -d' ' -f1,2 "$DEST/funcoes_md5_acl.txt"
```

Expected: 6 CSVs com contagem e hash; `contagens.txt` terminando em `|0` (a coluna ainda não existe em produção); as 10 funções com os md5 da spec §3.1. md5 diferente = produção mudou depois de 24/set: PARE — a guarda da migration recusaria; refazer a Task 3 contra o texto vivo (leitura do texto de produção só-leitura, com o controlador) e re-rodar as Tasks 2–4.

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
bash .superpowers/nota/copia.sh ida
bash "$VAR/criar-variante.sh" nota "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada" 5181
"$VAR/nota/subir.sh"
lsof -nP -iTCP:5188 -sTCP:LISTEN -t | sed 's/^/:5188 do dono intacto, PID /'
```

Expected: só `testes-checados` e `porta-checada`; `Supabase local http=200`; `porta 5181 reservada: ok` (sem ela: PARE — não editar o script); `copia.sh ida` → `…|0 → …|5` com backup; a variante `nota` sobe em `http://localhost:5181` com a linha da guarda `[guarda-copia-local] OK: variante nota (:5181, …) — cliente e worker -> http://127.0.0.1:54321 (cópia local)`; o `:5188` com o mesmo PID de antes. `RECUSADO`/`ABORTADO`/`ERRO`/`PARE`: pare e reporte (nunca contornar a guarda).

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
    if (o.alerta) await expect(dlg.locator('[data-qa="aviso-falta-nota"]')).toHaveText(AVISO);
    else await expect(dlg.locator('[data-qa="aviso-falta-nota"]')).toHaveCount(0);
    await expect(dlg.getByText(o.dica, { exact: true })).toBeVisible();
    expect(await page.locator('input[type="date"]').count()).toBe(0);
    await digitarData(page, "05/10/2026");
    await expect(dlg.locator('[data-qa="aviso-falta-nota"]')).toHaveCount(0);
    await evidencia(page, `${o.nome}-campo`);
    fakeRpc(o.rpc, OC[o.fam].id);
    if (o.tabelaExtra) fakeTabela(o.tabelaExtra);
    const req = page.waitForRequest((r) => new URL(r.url()).pathname === `/rest/v1/rpc/${o.rpc}` && r.method() === "POST");
    await botao(page, /^\s*Salvar\s*$/).click();
    const corpo = (await req).postDataJSON() as Record<string, Record<string, unknown>>;
    expect(corpo[o.chavePayload]?.data_nota_entrada).toBe("2026-10-05");
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

test("Nota — E1 (GRAVA NA CÓPIA, só com OK do dono): data real na OC Tecido recalcula as não pagas; limpar volta", async ({ browser }) => {
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
  await salvarComData("05/10/2026");
  confere(await lerParcelas(OC.tecido.id), "2026-10-05");
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
bash .superpowers/nota/copia.sh volta
cat .superpowers/nota/copia-estado.md
```

Expected: variante `:5181` derrubada pelo próprio script; `volta` → `…|5 → …|0`; o registro com ida/E1/volta. Relatório ao guardião (G-fase): logs, `rede.json`, prints, `copia-estado.md`.

---

## Task 13: Portões, PRODUÇÃO (pelo dono), merge e volta  *(controlador + guardião + dono — NÃO é código)*

> ⛔ Nada entra em produção antes dos Steps 1–3 registrados. A migration em produção é aplicada PELO DONO, no Terminal, com `pg_dump` completo antes — o plano Supabase NÃO tem PITR. Ordem: DEPOIS da F1 e do Aviso Global. O merge do front vem DEPOIS da migration em produção.

**Files:** nenhum no repo até o Step 8 (merge) e o Step 11 (docs). Evidências em `/Users/sunglee/PLM + Criação/savepoints/<data>-pre-nota-entrada/` e no diário do guardião.

- [ ] **Step 1: Pré-condições (só leitura; o controlador — ou o dono, se o classificador bloquear)**

```bash
URL="$(cat /tmp/dburl.txt)"
RO() { PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -X -A -t -v ON_ERROR_STOP=1 "$@"; }
RO -c "select count(*) from information_schema.columns where table_schema='public' and table_name='tenant_config' and column_name='kanban_automatico'"   # 1 = F1 aplicada
RO -c "select count(*) from information_schema.columns where table_schema='public' and column_name='data_nota_entrada'"                                  # 0
```

Expected: `1` (F1 em produção) e `0`. O Aviso Global: conferir, pelo plano dele (`docs/superpowers/plans/2026-09-24-aviso-global.md`, quando commitado), o objeto que a migration `20261001100000` cria e confirmar que existe em produção. Qualquer pré-condição falha ⇒ PARE (a ordem é do dono). Repetir o Task 0 Step 4 (sobreposição) contra a `feature/plan-tecido-a1` do dia.

- [ ] **Step 2: Guardião — G-migration**

Rodar no Fable, avisando o dono antes; sem o Fable, 2 revisões Opus INDEPENDENTES (uma sem ver a outra) + aviso ao dono de que o portão rodou sem o Fable. Acionar o agente `guardiao-unificacao` (report-only) com: a spec, ESTE plano, o diário, as saídas das Tasks 3–4 e 12, e o checklist:
1. UMA migration `20261002100000`, `BEGIN/COMMIT`, `SET LOCAL lock_timeout`, idempotente (Task 2 teste 10), gerada (não editada: `python3 gerar_sql.py` reproduz o arquivo commitado byte a byte — `git diff --exit-code` depois de regenerar);
2. guarda de md5 = spec §3.1 e o diff antes → depois = `diff-esperado.txt` (Task 3 Steps 3 e 5); `md5-depois.txt` = ensaio (Task 4);
3. ACL #9: `has_function_privilege` nas 9 internas (pós-condição + teste 1) e ACL das 10 redefinidas igual à de antes (teste 10);
4. dinheiro: paga intacta, Σ = total, só não pagas mudam, sem data = hoje byte a byte (teste 9), Importado idêntico (teste 8), OC encomendada sem parcela nova (teste 3);
5. inverso destrutivo com confirmação, testado (teste 11) e ensaiado (Task 4);
6. nenhum `\i` em txn de teste; testes com DDL só na cópia (`ehBancoLocal`); nenhum teste tocou produção;
7. ensaio na cópia com contagens e cópia devolvida (Task 4), QA (Task 12) com `rede.json` limpo;
8. snapshot da Task 11 com os md5 de produção = spec §3.1;
9. §10 da spec: respostas do dono às D1–D5 registradas.

O guardião acrescenta o veredito ao diário. BLOQUEIA ⇒ parar. APROVA COM RESSALVAS ⇒ resolver/registrar antes do Step 3.

- [ ] **Step 3: OK EXPLÍCITO do dono**

Apresentar em PT-BR simples: o que muda (campo nas 5 OCs; vencimento a partir da data em 4 famílias; recálculo das não pagas; alertas), o número de OCs que acendem no dia 1 (Task 11 — D1), o veredito do guardião, o plano de volta (Step 10) e a ordem (F1 → Aviso Global → esta migration → merge do front → deploy). Registrar a resposta literal + data no diário. Sem "sim" ⇒ parar.

- [ ] **Step 4: Snapshot (Task 11) + `pg_dump` COMPLETO — o DONO, no Terminal**

```bash
D="/Users/sunglee/PLM + Criação/savepoints/$(date +%F)-pre-nota-entrada"   # a mesma pasta da Task 11
mkdir -p "$D"
docker exec -i supabase_db_banco-local pg_dump -d "$(cat /tmp/dburl.txt)" -Fc > "$D/prod-completo-$(date +%H%M).dump"
ls -l "$D"/prod-completo-*.dump
docker exec -i supabase_db_banco-local pg_restore -l < "$(ls -t "$D"/prod-completo-*.dump | head -1)" | tail -3
```

Expected: arquivo `.dump` com tamanho da ordem dos anteriores; `pg_restore -l` lista objetos (sem erro). Sem dump válido ⇒ NÃO aplicar.

- [ ] **Step 5: Aplicar em PRODUÇÃO — o DONO, no Terminal, fora do horário de uso**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada"
URL="$(cat /tmp/dburl.txt)"
psql "$URL" -X -A -F' | ' -c "select pid, usename, state, now()-xact_start idade, left(query,60) from pg_stat_activity where datname=current_database() and backend_type='client backend' and pid<>pg_backend_pid() and state<>'idle' and xact_start < now() - interval '5 seconds'"
PGOPTIONS='-c lock_timeout=5s' psql "$URL" -X -q -1 -v ON_ERROR_STOP=1 -c "SET lock_timeout = '5s'" \
  -f supabase/migrations/20261002100000_oc_data_nota_entrada.sql
```

Expected: a 1ª consulta sem linhas (com linha: esperar e repetir; não matar sessão); o apply sem `ERROR`, com os 2 avisos inofensivos de transação. `RAISE … mudou desde 24/set` = a guarda recusou (produção mudou): nada foi aplicado — voltar à Task 3. `canceling statement due to lock timeout`: nada ficou; repetir mais tarde.

- [ ] **Step 6: Registrar em `supabase_migrations.schema_migrations` (idempotente) — o dono**

```bash
psql "$(cat /tmp/dburl.txt)" -X -v ON_ERROR_STOP=1 -c "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261002100000', 'oc_data_nota_entrada', '{}'::text[]) ON CONFLICT (version) DO NOTHING"
```

- [ ] **Step 7: Verificação pós-apply — SÓ LEITURA**

```bash
URL="$(cat /tmp/dburl.txt)"; D="/Users/sunglee/PLM + Criação/savepoints/$(date +%F)-pre-nota-entrada"
RO() { PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -X -A -t -v ON_ERROR_STOP=1 "$@"; }
RO -c "select count(*) from information_schema.columns where table_schema='public' and column_name='data_nota_entrada'"                      # 5
RO -c "select count(*) from pg_trigger where not tgisinternal and tgname='trg_nota_entrada_recalc'"                                          # 3
RO -F' ' -c "select p.oid::regprocedure, md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid = any (array['public.gerar_parcelas_oc_tecido()','public.gerar_parcelas_oc_aviamento()','public.gerar_parcelas_oc_p_acabado()','public._recalcular_parcelas_core(uuid,text)','public.recalcular_parcelas_etiqueta(uuid)','public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)','public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)','public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)','public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)','public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)']::regprocedure[]) order by 1" > "$D/md5_depois_prod.txt"
diff "$D/md5_depois_prod.txt" "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada/.superpowers/nota/copia-md5-ensaio.txt" && echo "IGUAL AO ENSAIO"
RO -c "select count(*) from (values ('public.fn_oc_nota_entrada_recalc()'),('public._recalcular_parcelas_core(uuid,text)'),('public.recalcular_parcelas_etiqueta(uuid)'),('public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)'),('public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)'),('public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)'),('public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)')) v(f) where has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')"   # 0
PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -X -q -c "\copy (SELECT * FROM public.parcelas ORDER BY id) TO '$D/parcelas_pos.csv' CSV HEADER"
diff "$D/parcelas.csv" "$D/parcelas_pos.csv" > /dev/null && echo "PARCELAS IDÊNTICAS (a migration não escreve dado)"
```

Expected: `5`, `3`, `IGUAL AO ENSAIO`, `0`, `PARCELAS IDÊNTICAS`. Diferença em `parcelas` = conferir no `audit_log` se foi uso normal entre o snapshot e agora; diferença sem autoria de usuário = BLOQUEIO (Step 10). Registrar tudo no diário.

- [ ] **Step 8: Merge do front (depois do Step 7) e deploy**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada"
git status --porcelain -- src supabase tests | grep -v '^?? tests/e2e/nota-qa.spec.ts' | grep . && echo "WORKTREE SUJA — PARE"
rm -f tests/e2e/nota-qa.spec.ts
git rebase feature/plan-tecido-a1
bash .superpowers/nota/gates.sh
cd "/Users/sunglee/PLM + Criação/plm-pcp"
git diff --cached --quiet || { echo "índice do checkout principal com coisa staged (outra sessão) — PARE e combine com o controlador"; exit 1; }
git merge --ff-only nota-entrada/data-nota
git log --oneline -8
```

Antes do `merge --ff-only`: repetir o Task 0 Step 4 (sobreposição) e avisar o dono por chat para salvar e fechar OCs abertas e o Financeiro no `:5173` (o código novo passa a valer lá no reload). `rebase` com conflito: resolver PRESERVANDO o texto da outra frente e reaplicando a intenção daqui; re-revisão Opus das tasks que editam o arquivo. Deploy Cloudflare: SÓ o dono (`npm run deploy`), quando ele decidir — publica a branch inteira.

- [ ] **Step 9: Cópia depois do merge**

O `:5188` do dono serve o checkout principal, que agora pede a coluna: `cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/nota-entrada" && bash .superpowers/nota/copia.sh ida` (com backup) e avisar o dono. Enquanto a coluna estiver na cópia, um re-ensaio da F1 (ou de outra frente que compare contagens) exige `copia.sh volta` antes — registrar no diário e no `APP-TESTE-LOCAL.md` do banco-local (nota curta).

- [ ] **Step 10: Como voltar (só com OK do dono)**

Ordem OBRIGATÓRIA: primeiro o front (senão o Financeiro pede uma coluna que some), depois o banco.
1. `git revert` dos commits desta frente na `feature/plan-tecido-a1` (um commit de revert, `--only`), `gates.sh`, e o dono faz o deploy se já tinha feito. Na cópia: `copia.sh volta` só DEPOIS do revert (o `:5188` segue o checkout principal).
2. Exportar as datas digitadas (o inverso as APAGA):
```bash
D="/Users/sunglee/PLM + Criação/savepoints/$(date +%F)-volta-nota-entrada"; mkdir -p "$D"; URL="$(cat /tmp/dburl.txt)"
for T in ocs_tecido ocs_aviamento ocs_etiqueta ocs_p_acabado ocs_importado; do
  PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -X -q -c "\copy (SELECT id, tenant_id, data_nota_entrada FROM public.$T WHERE data_nota_entrada IS NOT NULL ORDER BY id) TO '$D/$T.csv' CSV HEADER"
done
PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -X -q -c "\copy (SELECT * FROM public.parcelas ORDER BY id) TO '$D/parcelas_antes_da_volta.csv' CSV HEADER"
```
3. `pg_dump` completo (como no Step 4) e, o DONO:
```bash
PGOPTIONS='-c lock_timeout=5s' psql "$(cat /tmp/dburl.txt)" -X -q -1 -v ON_ERROR_STOP=1 \
  -c "SET LOCAL app.confirmo_apagar_data_nota_entrada = 'sim'" -f supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql
psql "$(cat /tmp/dburl.txt)" -X -c "DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261002100000'"
```
Expected: sem `ERROR`; a pós-condição do inverso confere as 10 funções no md5 de 24/set; as não pagas das OCs que tinham data voltam à base antiga (pagas intactas). Se a guarda do inverso recusar ("foi mudada por outra frente"), PARE — o inverso reverteria a outra frente.

- [ ] **Step 11: Docs e memória (docs-keeper; controlador aplica com OK do dono)**

- `CLAUDE.md`, invariante #1 — acrescentar ao fim do parágrafo: "**Data da Nota de Entrada (set/2026, `20261002100000`):** `data_nota_entrada` nas 5 OCs; em Tecido/Aviamento/Insumo/P. Acabado a base do vencimento é `COALESCE(data_nota_entrada, data_entrega | data_pedido)`; mudar a data numa OC recebida recalcula as NÃO pagas (gatilho `trg_nota_entrada_recalc`; Acabado pelo `trg_gerar_parcelas_ocpa`); os saves gravam a chave (ausente = mantém). Importado só registra. Alerta/provisória: regra única `src/lib/nota-entrada.ts`." — commit `--only CLAUDE.md`.
- Memória `project_data_nota_entrada.md`: estado FEITO + commits + onde está a migration + o runbook; atualizar a linha no `MEMORY.md`.
- `docs/api-integracao-erp.md` (local, gitignored): "vencimento de parcela de OC recebida sem `data_nota_entrada` é PROVISÓRIO".

- [ ] **Step 12: Limpeza**

Com o OK do dono: `git worktree remove .claude/worktrees/nota-entrada` (depois do merge), `git branch -d nota-entrada/data-nota`. A pasta da variante `nota` pode ser apagada (só os arquivos dela); a linha `case` do `criar-variante.sh` é do controlador — esta frente não a toca.

---

## 4. Riscos (evidência e o que o plano faz)

| Risco | Evidência | Mitigação |
|---|---|---|
| Vencimento errado / dinheiro | Parcelas regeneradas por DELETE+INSERT em 4 famílias (spec §3.1) | Testes 2–9 por família (paga intacta, Σ = total, só não pagas, sem data = hoje byte a byte); revisão individual Opus |
| Reverter em silêncio função mudada em produção | `CREATE OR REPLACE` com o texto de 24/set | Guarda de md5 na migration e no inverso; snapshot da Task 11 confere antes |
| Front antes do banco | Listas/Financeiro pedem `data_nota_entrada` | Merge só depois do Step 7; volta = front primeiro |
| Aba/front antigo apagando a data | Saves gravam o cabeçalho coluna a coluna | `CASE WHEN ? 'data_nota_entrada'` — chave ausente mantém (teste 4) |
| Cópia compartilhada | Outras frentes contam funções/gatilhos | `copia.sh` com backup, trava de QA, `volta` ao fim, registro |
| Lock nas OCs | `ADD COLUMN`/`DROP TRIGGER` = AccessExclusive (não em `tenant_config`) | `lock_timeout 5s`, `pg_stat_activity` antes, fora do horário |
| Ruído no dia 1 | 48 OCs recebidas sem data na cópia (spec §3.1) | D1 com o dono antes da produção |
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
