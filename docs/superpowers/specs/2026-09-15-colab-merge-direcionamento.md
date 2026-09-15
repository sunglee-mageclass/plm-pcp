# Fase 3 / Onda 1 — Merge de conflito colaborativo no Direcionamento detalhe

## Contexto
O Direcionamento detalhe (`expedicao.direcionamento.$modeloId.tsx`, componente `DirecionamentoDetail`)
hoje tem **ring de presença** (quem edita o quê) mas o save é **last-write-wins**: dois usuários editando
a grade do mesmo modelo → o último sobrescreve o outro em silêncio. Esta onda adiciona o **merge de
conflito 3-vias** (como o CQ já tem), detectando "outro salvou no meio" e oferecendo "manter meu / usar o
novo" por célula.

O **CQ** (`expedicao.cq.$modeloId.tsx`) é o molde exato — mesmo tipo de dado (grade real por variante).
A diferença estrutural: o Direcionamento tem a **dimensão LOJA a mais** (grade = variante × loja ×
tamanho), então o path de conflito é `dir:${variante}:${loja}:${tam}` — que já é literalmente o
`data-colab-path` presente nos inputs.

## Decisões (dono, 15/set/2026)
1. **Rev numa linha-âncora PRÓPRIA por modelo** (isolada — só o Direcionamento bumpa; sem ruído de
   outros writers de `cad`).
2. **Escopo: só a grade editável** (linhas por loja×variante×tamanho). A grade REAL (`cad_grades.
   grades_reais`, read-only, vem do CQ) chega por invalidação, não é "minha edição".

## Arquitetura

### Banco
- **Nova tabela `direcionamento_controle`** (a linha-âncora do rev):
  - `id uuid pk default gen_random_uuid()`, `tenant_id uuid not null`, `cad_id uuid not null unique`,
    `rev integer not null default 0`, `updated_at timestamptz default now()`.
  - RLS espelhando `direcionamento_lojas`: SELECT/INSERT/UPDATE tenant-scoped (`tenant_id =
    get_user_tenant_id() or is_super_admin()`) + o modgate do módulo `producao` (RESTRICTIVE), igual às
    outras tabelas do fluxo. FK `cad_id → cad(id)` ON DELETE CASCADE (a âncora morre com o cad).
  - Trigger `BEFORE UPDATE ... EXECUTE FUNCTION fn_colab_touch_rev()` (função JÁ existe — `new.rev :=
    old.rev + 1`). Só o UPDATE bumpa; o INSERT nasce com rev=0.
- **`_salvar_direcionamento_core` ganha `_rev_base jsonb DEFAULT NULL`** (propagado pelos wrappers
  `salvar_direcionamento`/`confirmar_direcionamento`):
  - No início (dentro do lock): garante a âncora — `INSERT INTO direcionamento_controle(tenant_id,cad_id)
    VALUES (...) ON CONFLICT (cad_id) DO NOTHING` (idempotente; 1ª vez nasce rev=0).
  - Rev-check (espelho do `_salvar_cq_core`): se `_rev_base ? 'dir'` e não-null → `SELECT rev FROM
    direcionamento_controle WHERE cad_id=_cad_id FOR UPDATE` e `IF v_rev IS DISTINCT FROM
    (_rev_base->>'dir')::int THEN RAISE ... USING ERRCODE='P0409'`. `_rev_base` null = bypass
    (compat/super — mantém o save cru funcionando).
  - No fim (após escrever as linhas): `UPDATE direcionamento_controle SET rev=rev+1... WHERE cad_id=_cad_id`
    — na prática o `UPDATE ... updated_at=now()` dispara o trigger que faz `rev := rev+1`. Isso gera o
    `postgres_changes` que os OUTROS assinantes escutam. (Nota: o próprio autor re-baselina o rev no
    pós-save, então o eco do próprio bump é no-op.)
  - Toda a escrita de linhas/DELETE/validação P0001 do Confirmar fica **byte-a-byte** — só ADICIONA o
    _rev_base + a âncora. Diff-validar com pg_get_functiondef antes/depois.

### Front (`DirecionamentoDetail`)
- **Trocar `useColabPresencaPagina` → `useColabRegistro`** (o hook completo, com merge):
  - `canal: cad?.id ? \`colab:dir:${cad.id}\` : null`, `tabela: "direcionamento_controle"`,
    `filtroColuna: "cad_id"`, `registroId: cad.id`, `campoFocado` (já existe),
    `onMudancaServidor: () => { invalidar ["direcionamento-lojas", cad.id] + ["dir-controle", cad.id] }`.
  - ⚠️ `useColabRegistro.ColabTabela` é um union restrito — adicionar `"direcionamento_controle"` a ele
    (`src/hooks/useColabRegistro.ts:20`). Publicar a tabela na publication `supabase_realtime` + REPLICA
    IDENTITY (o hook precisa do postgres_changes).
- **Novo merge por célula `mergeGradeDir`** (`src/lib/colab/merge-grade-dir.ts`, espelho de `mergeGrade`
  mas dimensão loja): union de `(variante, loja, tam)`, valor = qtd direta (sem "campo"), path
  `dir:${variante}:${loja}:${tam}`, reusa `igual()` e o tipo `Conflito` de `merge.ts`. Retorna
  `{ valor, conflitos }` (mesmo shape do mergeGrade).
- **Refs de merge** (espelho do CQ): `baseStateRef` (o state semeado do servidor), `touchedRef` (Set de
  paths `dir:...` tocados), `revRef` (rev da âncora), `reseedingRef` (gate p/ pós-save/reconcile).
- **`setQtd` marca `touched`** com `dir:${num}:${lojaId}:${tam}` (mesmo path do data-colab-path).
- **Effect de merge no refetch alheio** (gated por `!reseedingRef`): quando `["direcionamento-lojas"]`
  refetcha por UPDATE alheio, roda `mergeGradeDir({base, meu, fresh, tocadas})`, aplica `setState`,
  põe conflitos em `conflitosRef`/`setConflitos`, `setUltimoMerge`, re-baselina base+rev.
- **`_rev_base` no save/confirmar**: `{ dir: revRef.current }`. `onError` com `e.code === "P0409"` →
  reconciliar (refetch + merge) + retry (espelho de `reconciliarCq`).
- **`<ColabBanner presentes ultimoMerge conflitos onResolver rotulo>`**: `resolverPorPath` (path `dir:`
  → escreve a célula via setQtd com o valor "dele", remove do touched), `rotuloConflito` (`dir:${v}:${loja}:
  ${t}` → `"${nomeLoja} · ${tam} (var ${v})"`). **Guard**: barra Salvar E Confirmar enquanto
  `conflitosRef.length > 0`.

## O que NÃO muda
- A grade REAL (`cad_grades.grades_reais`) e a validação P0001 do Confirmar (Σ≠real) ficam intactas.
- O ring/presença por campo continua (o `useColabRegistro` também traz `presentes`+`campoFocado`).
- A tabela legada `direcionamento` segue inerte.

## Verificação
- **Banco**: teste transacional (BEGIN/ROLLBACK controlado — NUNCA `\i` migração dentro do teste):
  criar âncora, salvar com `_rev_base` certo (OK), salvar com `_rev_base` velho (P0409), Confirmar com
  Σ≠real (P0001 preservado). Diff-validar `_salvar_direcionamento_core` antes/depois (só +_rev_base).
- **Front**: tsc+build; teste unit do `mergeGradeDir` (célula não-tocada adota fresh; tocada+diverge =
  conflito; loja/variante nova).
- **QA 2 contas** (2 browsers): A e B editam células diferentes → merge sem conflito; A e B editam a MESMA
  célula → conflito com "manter meu/usar o novo"; Salvar barrado com conflito pendente.
- **Revisão adversarial**: é banco+colab+segurança → sempre revisar (RLS da âncora, rev-check, P0409,
  invariante #10 do Direcionamento não regride).

## Riscos
- ⚠️ **Invariante #10** (Direcionamento multi-lojas, gates olham as 2 tabelas): o merge NÃO toca a lógica
  de save/gates — só adiciona rev-check. Revisar que os gates downstream (`fn_rebaixa_direcionamento_grade`
  etc.) não são afetados.
- Publicar `direcionamento_controle` no realtime = +1 tabela na publication (barato).
- max_connections: +1 canal por sheet de Direcionamento aberto (já era assim com a presença).
