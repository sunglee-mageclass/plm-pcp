# Permissão própria para preço de venda (varejo) e atacado — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desacoplar a EXIBIÇÃO e a EDIÇÃO do preço de venda (varejo) e do preço de atacado da permissão de custos, com 4 permissões próprias e independentes (VER varejo, EDITAR varejo, VER atacado, EDITAR atacado), sem ninguém perder acesso no deploy.

**Architecture:** Hoje a exibição do preço segue `_pode_ver_custos`/`veCustos` e a escrita do varejo já é trancada no gatilho `fn_modelo_preco_venda_gate`. A frente: (1) estende esse gatilho com um ramo simétrico para `preco_atacado` (regerando o md5 da guarda S1) + backfill das 4 chaves em `user_permissions`+`papel_permissoes` (`ON CONFLICT DO NOTHING`); (2) cria um helper puro `src/lib/preco-permissao.ts` (NÃO referencia custos) + 3 chaves novas no catálogo; (3) troca os ~8 pontos de exibição de preço de `podeVerCustos`/`veCustos`/`podeVerCustosServidor` para `podeVerPrecoVarejo`/`podeVerPrecoAtacado` (custo FICA em custos); (4) separa a edição do atacado (nova prop `podeEditarPrecoAtacado`) no payload do Salvar. VER = só tela (leitura não trancada no banco, D1 A); EDITAR = trancado no banco.

**Tech Stack:** Postgres (migration via `psql -f` na cópia local p/ teste, produção pelo dono) + React/TS + TanStack Query + Vitest (unit + integração txn-revertida com `aplicarArquivo`).

**Spec:** `docs/superpowers/specs/2026-11-19-permissao-preco-venda-design.md` (decisões do dono: `.superpowers/sdd/2026-11-19-permissao-preco-venda/decisoes-dono.md`)

## Global Constraints

- **Banco ANTES do site.** Deploy PRÓPRIO, separado do lote front corrente. Site novo + banco velho é inofensivo (chaves novas ignoradas pelo front antigo; o gate de atacado só morde PATCH direto — a tela grava por RPC). Site velho + banco novo também (o backfill já concedeu, o gate novo não muda nada da tela antiga).
- **Não é destrutivo:** só ADD de 3 chaves no catálogo, backfill `ON CONFLICT DO NOTHING` e `CREATE OR REPLACE` do gatilho. Nenhum DROP, nenhuma coluna removida.
- **Leitura continua destravada (D1 A):** os selects crus de `preco_venda`/`preco_atacado` FICAM; só a EXIBIÇÃO na tela passa a respeitar as novas chaves. Gap de leitura por API é DOCUMENTADO, não regressão (igual ao custo hoje, P-230).
- **EDITAR = trancado no banco (D3 A):** varejo já é (`criacao_planejamento:preco_venda`, manter); atacado passa a ser (ramo novo em `fn_modelo_preco_venda_gate`, GUC `app.preco_comprado_sistema='on'` PRIMEIRO para não morder o recompute derivado; `v_sistema` passa).
- **RAISE em ASCII.** O novo `RAISE` do atacado é `42501` (403, a tela traduz por código); ainda assim escrever a mensagem SÓ ASCII, por consistência com o resto do gatilho (sem acento, "—" nem "…").
- **Diff-validar `fn_modelo_preco_venda_gate` (`pg_get_functiondef` antes/depois) e REGENERAR o md5 `depois` da guarda S1** (`20261031120000`, blocos `s1_m2` pré e pós): esta frente muda o corpo da função, então as duas listas de md5 que conferem `public.fn_modelo_preco_venda_gate()` têm de passar a aceitar o novo texto — senão a pós-condição acusa "texto inesperado".
- **BACKFILL (critério):** VER varejo + VER atacado → a quem HOJE vê preço (= tem QUALQUER uma das 5 chaves de `_pode_ver_custos` com `pode_ver=true`, o critério atual de exibição); EDITAR atacado → a quem HOJE edita atacado (= `criacao_planejamento:preco_venda` OU `criacao_produto_acabado` com `pode_editar=true`, o `podeEditarPrecoComprado` de hoje). EDITAR varejo já existe (`criacao_planejamento:preco_venda`) — não re-conceder. Conceder em `user_permissions` E `papel_permissoes` (espelho de `20260908280000`/`20261103195000`).
- **Helpers NÃO referenciam custos:** `src/lib/preco-permissao.ts` lê SÓ as chaves de preço (`canView`/`canEdit`), NUNCA `_pode_ver_custos`/`CHAVES_VER_CUSTOS`. Ortogonalidade total.
- **Rótulos (D1 A do dono):** "Editar preço de venda (varejo)", "Ver preço de venda (varejo)", "Editar preço de atacado", "Ver preço de atacado".
- Migration testada SÓ na CÓPIA LOCAL (Docker PG, `DATABASE_URL` LOCAL em `/tmp/dburl-local.txt`; `ehBancoLocal()` no harness). NUNCA DDL em txn de teste contra produção; NUNCA `\i` migration em txn de teste (COMMIT vaza). Subagente: `export DATABASE_URL="$(cat /tmp/dburl-local.txt)"` no brief (fallback é PRODUÇÃO — incidente 24/set).
- Gates: `npm run build` + `npx tsc --noEmit 2>&1 | grep TS2304`; testes de integração `--no-file-parallelism` (e a cópia local QUIETA, sem suíte simultânea — dá 55P03/40P01 falso). Commits `git commit --only`.

## Review Focus

1. **Ponto de exibição esquecido que continua mostrando o preço por `veCustos`.** São ~8 pontos; se um ficar em `podeVerCustos`/`veCustos`, um usuário sem ver-preço mas com ver-custo continuaria vendo o preço (fura a ortogonalidade). Mitigado pelo helper único `src/lib/preco-permissao.ts` + teste anti-drift que varre os componentes de preço por literal (Task 3 — falha se um arquivo de preço ainda cita `podeVerCustos`/`veCustos`/`podeVerCustosServidor` para gating de VAREJO/ATACADO).
2. **Recompute derivado do comprado quebrando se o gate do atacado morder a GUC.** Se a ordem das cláusulas deixar a checagem de permissão ANTES do guard `app.preco_comprado_sistema='on'`, `_pa_/_imp_recomputar_precos_modelo` passaria a falhar `42501`. Mitigado: GUC primeiro (como no B1b do varejo) + teste de integração que roda o recompute como cliente sem a chave de atacado e confirma que passa (Task 1).
3. **Backfill que não cobre papéis.** Conceder só em `user_permissions` e esquecer `papel_permissoes` faria quem herda do papel perder preço no deploy. Mitigado: espelhar os DOIS alvos de `20260908280000`/`20261103195000`; Passo 0 (só leitura) conta por loja quem via/edita preço hoje (Task 1).
4. **Independência ortogonal mal aplicada.** Condicionar preço a custo OU custo a preço viola a decisão. Mitigado: helpers de preço NÃO tocam `_pode_ver_custos`/`CHAVES_VER_CUSTOS`; teste dos 4 cruzamentos (vê custo/não-vê preço, vê preço/não-vê custo, etc.) em Task 2.
5. **Varejo e atacado colados.** Se o `ProdutoCard`/Sheet esconder o bloco inteiro quando falta UMA das duas permissões (em vez de "—" só na parte faltante), o usuário perde a parte que podia ver. Mitigado: gate por campo (varejo vs atacado separados) + teste de render com cada combinação; confirmar que a trava da Integração continua só no varejo (atacado livre, invariante 14) — Task 4.

---

### Task 1: Banco — ramo de atacado no gatilho + backfill das 4 chaves + Passo 0

**Files:**
- Create: `supabase/migrations/20261211100000_preco_permissao_atacado_gate_backfill.sql`
- Create: `supabase/rollback/20261211100000_preco_permissao_atacado_gate_backfill_down.sql`
- Create: `supabase/consultas/preco_permissao_passo0.sql`
- Test: `tests/integration/preco-permissao-gate.test.ts`

**Interfaces:**
- Produces: `public.fn_modelo_preco_venda_gate()` com ramo novo `preco_atacado` (42501 para PATCH direto do cliente sem a chave `criacao_planejamento:preco_atacado`; recompute derivado via GUC e `v_sistema` passam); linhas de permissão backfillicadas das 4 chaves em `user_permissions`/`papel_permissoes`.

- [ ] **Step 1: Confirmar o estado vivo do gatilho na cópia local**

Run: `export DATABASE_URL="$(cat /tmp/dburl-local.txt)"; psql "$DATABASE_URL" -c "SELECT md5(pg_get_functiondef('public.fn_modelo_preco_venda_gate()'::regprocedure));"`
Expected: `e89be53c25f421724994e78b756a027d` (o `depois` da S1). Se divergir, outra frente mexeu — regenere os md5 abaixo a partir do valor REAL antes e depois da sua mudança. (Os dois pontos do arquivo S1 `20261031120000` que conferem essa função: o bloco `$guarda$` aceita `antes`∈{`4eeb8baa…`, `e89be53c…`} e o bloco `$pos$` exige `e89be53c…`. Esta migration muda a função, então ela precisa do SEU `md5 depois` guardado — mas NÃO altere o arquivo da S1; a sua migration apenas CREATE OR REPLACE e grava o novo md5 na pós-condição DESTE arquivo. A guarda S1 só re-executa se alguém reaplicar a S1 — por isso o spec pede "regenerar o md5 depois da S1": isto é feito ao reaplicar a S1 futuramente, e seu teste de integração (Step 6) fixa o novo md5 para quem reaplicar perceber.)

- [ ] **Step 2: Escrever o teste de integração PRIMEIRO (vai falhar)** (`tests/integration/preco-permissao-gate.test.ts`)

```ts
// Preço de atacado: EDITAR trancado no banco (ramo novo em fn_modelo_preco_venda_gate). VER NÃO é trancado (D1 A).
// Recompute derivado do comprado (GUC app.preco_comprado_sistema='on') passa; PATCH direto do cliente sem a chave = 42501.
// Backfill das 4 chaves concede a quem hoje vê/edita preço. SÓ na cópia local (ehBancoLocal) — DDL em txn.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, comoUsuario, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const MIG = "supabase/migrations/20261211100000_preco_permissao_atacado_gate_backfill.sql";
const DOWN = "supabase/rollback/20261211100000_preco_permissao_atacado_gate_backfill_down.sql";
const T = TENANT_TESTE;

/** Roda `sql` como o PAPEL authenticated (PostgREST) numa savepoint; devolve "PASSOU" ou "<code> <message>". */
async function tenta(c: Client, sql: string, params: unknown[] = []): Promise<string> {
  await c.query("SAVEPOINT pp_t");
  await c.query("SET LOCAL ROLE authenticated");
  try {
    await c.query(sql, params);
    return "PASSOU";
  } catch (e) {
    const er = e as { code?: string; message?: string };
    return `${er.code} ${er.message}`;
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT pp_t");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT pp_t");
  }
}

// Cria um card comprado (revenda) da Loja Teste para o teste de PATCH de preco_atacado.
async function cardRevenda(c: Client): Promise<string> {
  const r = await um<{ id: string }>(
    c,
    `INSERT INTO public.modelos (tenant_id, nome, origem, preco_atacado)
       VALUES ($1, 'PP Atacado', 'revenda', 10) RETURNING id`,
    [T],
  );
  return r.id;
}

describe.skipIf(!RODA)("preço de atacado — gate de escrita", () => {
  it("PATCH direto de preco_atacado sem a chave → 42501; o recompute derivado (GUC) passa", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      const modelo = await cardRevenda(c);
      await comoUsuario(c, USER_TESTE); // JWT de usuário comum da Loja Teste (sem criacao_planejamento:preco_atacado)
      // Garante que o usuário NÃO tem a chave de atacado nesta txn:
      await c.query(
        `DELETE FROM public.user_permissions WHERE user_id = $1 AND pagina = 'criacao_planejamento:preco_atacado'`,
        [USER_TESTE],
      );
      // PATCH direto como authenticated, sem a GUC → 42501.
      const semChave = await tenta(c, `UPDATE public.modelos SET preco_atacado = 99 WHERE id = $1`, [modelo]);
      expect(semChave.startsWith("42501")).toBe(true);
      // Mesmo PATCH com a GUC do recompute derivado ligada → passa (não morde o recompute).
      await c.query("SAVEPOINT pp_guc");
      await c.query("SET LOCAL ROLE authenticated");
      await c.query("SELECT set_config('app.preco_comprado_sistema','on',true)");
      let passou = "PASSOU";
      try { await c.query(`UPDATE public.modelos SET preco_atacado = 99 WHERE id = $1`, [modelo]); }
      catch (e) { passou = `${(e as any).code} ${(e as any).message}`; }
      finally { await c.query("ROLLBACK TO SAVEPOINT pp_guc"); await c.query("RESET ROLE"); await c.query("RELEASE SAVEPOINT pp_guc"); }
      expect(passou).toBe("PASSOU");
    });
  });

  it("com a chave de atacado o PATCH direto passa", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      const modelo = await cardRevenda(c);
      await comoUsuario(c, USER_TESTE);
      await c.query(
        `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
           VALUES ($1, $2, 'criacao_planejamento:preco_atacado', true, true)
         ON CONFLICT (user_id, pagina) DO UPDATE SET pode_editar = true`,
        [USER_TESTE, T],
      );
      const r = await tenta(c, `UPDATE public.modelos SET preco_atacado = 99 WHERE id = $1`, [modelo]);
      expect(r).toBe("PASSOU");
    });
  });

  it("backfill concede VER varejo+atacado a quem vê custos e EDITAR atacado a quem edita o Planejamento", async () => {
    await withTx(async (c) => {
      // Semeia um usuário que HOJE vê custos (criacao_planejamento:custos ver=true) e edita o Planejamento.
      await c.query(
        `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
           VALUES ($1,$2,'criacao_planejamento:custos',true,false),
                  ($1,$2,'criacao_planejamento:preco_venda',true,true)
         ON CONFLICT (user_id, pagina) DO NOTHING`,
        [USER_TESTE, T],
      );
      await aplicarArquivo(c, MIG);
      const q = async (pag: string) =>
        (await um<{ n: number }>(c,
          `SELECT count(*)::int n FROM public.user_permissions WHERE user_id=$1 AND pagina=$2 AND pode_ver=true`,
          [USER_TESTE, pag])).n;
      expect(await q("criacao_planejamento:ver_preco_venda")).toBe(1);
      expect(await q("criacao_planejamento:ver_preco_atacado")).toBe(1);
      const ed = (await um<{ n: number }>(c,
        `SELECT count(*)::int n FROM public.user_permissions
           WHERE user_id=$1 AND pagina='criacao_planejamento:preco_atacado' AND pode_editar=true`,
        [USER_TESTE])).n;
      expect(ed).toBe(1);
    });
  });

  it("down: devolve o corpo anterior do gatilho (sem o ramo de atacado)", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      await aplicarArquivo(c, DOWN);
      const src = (await um<{ s: string }>(c,
        `SELECT pg_get_functiondef('public.fn_modelo_preco_venda_gate()'::regprocedure) s`)).s;
      expect(src).not.toMatch(/criacao_planejamento:preco_atacado/);
    });
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que FALHA**

Run: `export DATABASE_URL="$(cat /tmp/dburl-local.txt)"; npx vitest run tests/integration/preco-permissao-gate.test.ts --no-file-parallelism`
Expected: FAIL (a migration não existe ainda — `aplicarArquivo` lança ENOENT, ou os asserts quebram).

- [ ] **Step 4: Escrever a migration** (`20261211100000_preco_permissao_atacado_gate_backfill.sql`)

Arquivo aplicado por `psql -v ON_ERROR_STOP=1 -f` (produção) e por `aplicarArquivo` (teste — o harness tira o `BEGIN/COMMIT`; mantenha-os no arquivo para o `psql`). Diff-valida a função pelo `$guarda$`/`$pos$` como a S1. NOTA: substitua o md5 `<MD5_DEPOIS>` abaixo pelo valor REAL impresso no Step 7.

```sql
-- Permissão própria do preço de venda (varejo) e do preço de atacado, independente de custos.
-- (1) fn_modelo_preco_venda_gate ganha o ramo preco_atacado (simétrico ao varejo; GUC primeiro — não morde o recompute derivado).
-- (2) Backfill das 4 chaves (user_permissions + papel_permissoes, ON CONFLICT DO NOTHING) — ninguém perde acesso.
-- VER (varejo/atacado) NÃO é trancado no banco (D1 A): só a exibição na tela respeita as chaves novas.
-- Aplicar fora de txn de teste: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

-- ── Pré-condição: a função é o "depois" da S1 (ou já o desta frente, idempotência) ──────────────
DO $guarda$
DECLARE v text;
BEGIN
  v := md5(pg_get_functiondef('public.fn_modelo_preco_venda_gate()'::regprocedure));
  IF v NOT IN ('e89be53c25f421724994e78b756a027d', '<MD5_DEPOIS>') THEN
    RAISE EXCEPTION 'preco_atacado_gate: fn_modelo_preco_venda_gate com texto inesperado (md5 %) - outra frente mexeu; gere de novo', coalesce(v,'ausente')
      USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

-- ── (1) Gatilho: ramo NOVO de preco_atacado, simétrico ao varejo ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_modelo_preco_venda_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sistema boolean := auth.uid() IS NULL AND coalesce(auth.role(), '') NOT IN ('authenticated', 'anon');
BEGIN
  IF NEW.preco_venda IS DISTINCT FROM OLD.preco_venda
     AND COALESCE(NEW.origem, 'interno') NOT IN ('revenda', 'importado')
     AND NOT public.user_can_edit('criacao_planejamento:preco_venda') THEN
    RAISE EXCEPTION 'Sem permissão para editar o preço de venda'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.preco_venda IS DISTINCT FROM OLD.preco_venda
     AND COALESCE(NEW.origem, 'interno') IN ('revenda', 'importado')
     AND coalesce(current_setting('app.preco_comprado_sistema', true), '') <> 'on'
     AND NOT v_sistema THEN
    RAISE EXCEPTION 'preco_comprado_derivado: o preco de venda do comprado vem do markup ou do preco fixo do produto'
      USING ERRCODE = '42501';
  END IF;
  -- [preco permissao] EDITAR atacado: GUC do recompute derivado PRIMEIRO (nao morde _pa_/_imp_recomputar_precos_modelo),
  -- v_sistema passa (migration/psql/service_role); senao exige a chave nova. ASCII (a tela traduz por codigo).
  IF NEW.preco_atacado IS DISTINCT FROM OLD.preco_atacado
     AND coalesce(current_setting('app.preco_comprado_sistema', true), '') <> 'on'
     AND NOT v_sistema
     AND NOT public.user_can_edit('criacao_planejamento:preco_atacado') THEN
    RAISE EXCEPTION 'Sem permissao para editar o preco de atacado'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.preco_anterior IS DISTINCT FROM OLD.preco_anterior
     AND pg_trigger_depth() <= 1
     AND NOT v_sistema
     AND NOT public.user_can_edit('criacao_planejamento:preco_venda') THEN
    RAISE EXCEPTION 'preco_anterior_sem_permissao: sem permissao para editar o preco anterior' USING ERRCODE = '42501';
  END IF;
  IF NEW.enviado_cad IS DISTINCT FROM OLD.enviado_cad
     AND coalesce(current_setting('app.explosao_sistema', true), '') <> 'on'
     AND NOT v_sistema THEN
    RAISE EXCEPTION 'explosao_protegida: o envio a Explosao so muda pelos botoes Enviar a Explosao / Voltar ao Desenvolvimento'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.ordem_criacao_enviada IS TRUE AND NEW.ordem_criacao_enviada IS NOT TRUE
     AND (coalesce(OLD.enviado_cad, false) OR coalesce(NEW.enviado_cad, false))
     AND coalesce(current_setting('app.explosao_sistema', true), '') <> 'on'
     AND NOT v_sistema THEN
    RAISE EXCEPTION 'ordem_com_explosao: o card ja foi enviado a Explosao - a Ordem de Criacao nao pode ser cancelada'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $function$;

-- ── (2) BACKFILL (ON CONFLICT DO NOTHING; espelho de 20260908280000 / 20261103195000) ───────────
-- VER varejo + VER atacado → a quem HOJE vê preço (QUALQUER das 5 chaves de _pode_ver_custos com pode_ver=true).
INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT DISTINCT up.user_id, up.tenant_id, nova.k, true, false
FROM public.user_permissions up
CROSS JOIN (VALUES ('criacao_planejamento:ver_preco_venda'), ('criacao_planejamento:ver_preco_atacado')) AS nova(k)
WHERE up.pagina IN ('criacao_planejamento:custos','criacao_desenvolvimento:custos',
                    'producao_terceirizados:precos','dashboard_custos','dashboard_comercial')
  AND up.pode_ver = true
ON CONFLICT (user_id, pagina) DO NOTHING;

INSERT INTO public.papel_permissoes (papel_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT DISTINCT pp.papel_id, pp.tenant_id, nova.k, true, false
FROM public.papel_permissoes pp
CROSS JOIN (VALUES ('criacao_planejamento:ver_preco_venda'), ('criacao_planejamento:ver_preco_atacado')) AS nova(k)
WHERE pp.pagina IN ('criacao_planejamento:custos','criacao_desenvolvimento:custos',
                    'producao_terceirizados:precos','dashboard_custos','dashboard_comercial')
  AND pp.pode_ver = true
ON CONFLICT (papel_id, pagina) DO NOTHING;

-- EDITAR atacado → a quem HOJE edita atacado (criacao_planejamento:preco_venda OU criacao_produto_acabado, pode_editar=true).
INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT DISTINCT up.user_id, up.tenant_id, 'criacao_planejamento:preco_atacado', true, true
FROM public.user_permissions up
WHERE up.pagina IN ('criacao_planejamento:preco_venda','criacao_produto_acabado')
  AND up.pode_editar = true
ON CONFLICT (user_id, pagina) DO NOTHING;

INSERT INTO public.papel_permissoes (papel_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT DISTINCT pp.papel_id, pp.tenant_id, 'criacao_planejamento:preco_atacado', true, true
FROM public.papel_permissoes pp
WHERE pp.pagina IN ('criacao_planejamento:preco_venda','criacao_produto_acabado')
  AND pp.pode_editar = true
ON CONFLICT (papel_id, pagina) DO NOTHING;

-- ── Pós-condição: a função ficou no texto desta frente ──────────────────────────────────────────
DO $pos$
DECLARE v text;
BEGIN
  v := md5(pg_get_functiondef('public.fn_modelo_preco_venda_gate()'::regprocedure));
  IF v IS DISTINCT FROM '<MD5_DEPOIS>' THEN
    RAISE EXCEPTION 'preco_atacado_gate: pos-condicao falhou (md5 %, esperado <MD5_DEPOIS>)', coalesce(v,'ausente') USING ERRCODE = 'P0001';
  END IF;
END $pos$;
COMMIT;
```

⚠️ A constraint única usada no `ON CONFLICT` é `(user_id, pagina)` / `(papel_id, pagina)` — confirme com `\d public.user_permissions` na cópia que o nome/colunas batem (é o mesmo usado em `20260908280000` e `20261103195000`).

- [ ] **Step 5: Escrever o inverso** (`supabase/rollback/20261211100000_preco_permissao_atacado_gate_backfill_down.sql`)

Devolve o corpo ANTERIOR do gatilho (sem o ramo de atacado) — o `depois` da S1. O backfill NÃO precisa reverter (conceder acesso não quebra); as linhas ficam. Opcionalmente, remover as linhas das 3 chaves novas (inócuo) sob guarda; por padrão NÃO remover (segue a decisão da S1 — o dono ajusta depois).

```sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
-- Devolve fn_modelo_preco_venda_gate SEM o ramo de atacado (= corpo da S1, md5 e89be53c25f421724994e78b756a027d).
CREATE OR REPLACE FUNCTION public.fn_modelo_preco_venda_gate()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sistema boolean := auth.uid() IS NULL AND coalesce(auth.role(), '') NOT IN ('authenticated', 'anon');
BEGIN
  IF NEW.preco_venda IS DISTINCT FROM OLD.preco_venda
     AND COALESCE(NEW.origem, 'interno') NOT IN ('revenda', 'importado')
     AND NOT public.user_can_edit('criacao_planejamento:preco_venda') THEN
    RAISE EXCEPTION 'Sem permissão para editar o preço de venda' USING ERRCODE = '42501';
  END IF;
  IF NEW.preco_venda IS DISTINCT FROM OLD.preco_venda
     AND COALESCE(NEW.origem, 'interno') IN ('revenda', 'importado')
     AND coalesce(current_setting('app.preco_comprado_sistema', true), '') <> 'on'
     AND NOT v_sistema THEN
    RAISE EXCEPTION 'preco_comprado_derivado: o preco de venda do comprado vem do markup ou do preco fixo do produto'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.preco_anterior IS DISTINCT FROM OLD.preco_anterior
     AND pg_trigger_depth() <= 1
     AND NOT v_sistema
     AND NOT public.user_can_edit('criacao_planejamento:preco_venda') THEN
    RAISE EXCEPTION 'preco_anterior_sem_permissao: sem permissao para editar o preco anterior' USING ERRCODE = '42501';
  END IF;
  IF NEW.enviado_cad IS DISTINCT FROM OLD.enviado_cad
     AND coalesce(current_setting('app.explosao_sistema', true), '') <> 'on'
     AND NOT v_sistema THEN
    RAISE EXCEPTION 'explosao_protegida: o envio a Explosao so muda pelos botoes Enviar a Explosao / Voltar ao Desenvolvimento'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.ordem_criacao_enviada IS TRUE AND NEW.ordem_criacao_enviada IS NOT TRUE
     AND (coalesce(OLD.enviado_cad, false) OR coalesce(NEW.enviado_cad, false))
     AND coalesce(current_setting('app.explosao_sistema', true), '') <> 'on'
     AND NOT v_sistema THEN
    RAISE EXCEPTION 'ordem_com_explosao: o card ja foi enviado a Explosao - a Ordem de Criacao nao pode ser cancelada'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $function$;
COMMIT;
```

⚠️ Confirme na cópia que este corpo bate byte-a-byte com o `depois` da S1 (`md5 = e89be53c25f421724994e78b756a027d` após `CREATE OR REPLACE`). Se não bater, copie o corpo EXATO de `20261031120000_seg_s1_modelos_guarda.sql` (linhas 69–124).

- [ ] **Step 6: Escrever o Passo 0 só-leitura** (`supabase/consultas/preco_permissao_passo0.sql`)

Conta, por loja, quem HOJE vê/edita preço (critério do backfill) — para o dono conferir antes/depois. Nenhuma escrita.

```sql
-- Passo 0 (SO LEITURA): quem GANHA as chaves novas por loja. Rodar antes da ida; conferir depois.
SELECT u.tenant_id,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM public.user_permissions up
         WHERE up.user_id = u.id AND up.pode_ver = true
           AND up.pagina IN ('criacao_planejamento:custos','criacao_desenvolvimento:custos',
                             'producao_terceirizados:precos','dashboard_custos','dashboard_comercial')
       )) AS ganham_ver_preco,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM public.user_permissions up
         WHERE up.user_id = u.id AND up.pode_editar = true
           AND up.pagina IN ('criacao_planejamento:preco_venda','criacao_produto_acabado')
       )) AS ganham_editar_atacado
FROM public.users u
WHERE u.tenant_id IS NOT NULL
GROUP BY u.tenant_id
ORDER BY u.tenant_id;
```

- [ ] **Step 7: Aplicar na cópia local, capturar o md5 `depois` e preencher**

Run (cópia local): `export DATABASE_URL="$(cat /tmp/dburl-local.txt)"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261211100000_preco_permissao_atacado_gate_backfill.sql`
Na 1ª aplicação o `<MD5_DEPOIS>` ainda é placeholder; rode antes só o `CREATE OR REPLACE FUNCTION` e capture: `psql "$DATABASE_URL" -c "SELECT md5(pg_get_functiondef('public.fn_modelo_preco_venda_gate()'::regprocedure));"`. Substitua TODOS os `<MD5_DEPOIS>` no arquivo (guarda, pós-condição) e no `down` (o md5 da S1 no comentário), reverta a função ao `depois` da S1 e reaplique a migration inteira idempotente.
Expected: aplica sem erro; 2ª aplicação também (idempotente — `ON CONFLICT DO NOTHING`, `CREATE OR REPLACE`).

- [ ] **Step 8: Rodar o teste e confirmar que PASSA**

Run: `export DATABASE_URL="$(cat /tmp/dburl-local.txt)"; npx vitest run tests/integration/preco-permissao-gate.test.ts --no-file-parallelism`
Expected: PASS (os 4 casos). Diff-validar que NENHUMA outra função mudou (só `fn_modelo_preco_venda_gate`).

- [ ] **Step 9: Commit**

```bash
git commit --only supabase/migrations/20261211100000_preco_permissao_atacado_gate_backfill.sql supabase/rollback/20261211100000_preco_permissao_atacado_gate_backfill_down.sql supabase/consultas/preco_permissao_passo0.sql tests/integration/preco-permissao-gate.test.ts -m "feat(db): gate de escrita do preco_atacado + backfill das 4 chaves de preco (varejo/atacado)"
```

---

### Task 2: Catálogo + helper puro `preco-permissao.ts`

**Files:**
- Modify: `src/lib/permissions-catalog.ts:169-174` (section `criacao_planejamento`)
- Create: `src/lib/preco-permissao.ts`
- Test: `tests/unit/preco-permissao.test.ts`

**Interfaces:**
- Consumes: `canView`/`canEdit` de `useAuth` (`(pagina: string) => boolean`).
- Produces: `podeVerPrecoVarejo(canView)`, `podeVerPrecoAtacado(canView)`, `podeEditarPrecoVarejo(canEdit)`, `podeEditarPrecoAtacado(canEdit)` — todos `boolean`. Constantes de chave `CHAVE_VER_PRECO_VAREJO`, `CHAVE_VER_PRECO_ATACADO`, `CHAVE_EDITAR_PRECO_VAREJO`, `CHAVE_EDITAR_PRECO_ATACADO`.

- [ ] **Step 1: Escrever o teste PRIMEIRO** (`tests/unit/preco-permissao.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import {
  podeVerPrecoVarejo, podeVerPrecoAtacado, podeEditarPrecoVarejo, podeEditarPrecoAtacado,
  CHAVE_VER_PRECO_VAREJO, CHAVE_VER_PRECO_ATACADO, CHAVE_EDITAR_PRECO_VAREJO, CHAVE_EDITAR_PRECO_ATACADO,
} from "@/lib/preco-permissao";
import { CHAVES_VER_CUSTOS } from "@/lib/mao-obra";

// Fábrica de canView/canEdit a partir de um conjunto de chaves true.
const comChaves = (...ks: string[]) => (k: string) => ks.includes(k);

describe("preco-permissao — chaves próprias, independentes de custos", () => {
  it("as chaves são as da seção criacao_planejamento", () => {
    expect(CHAVE_VER_PRECO_VAREJO).toBe("criacao_planejamento:ver_preco_venda");
    expect(CHAVE_VER_PRECO_ATACADO).toBe("criacao_planejamento:ver_preco_atacado");
    expect(CHAVE_EDITAR_PRECO_VAREJO).toBe("criacao_planejamento:preco_venda");
    expect(CHAVE_EDITAR_PRECO_ATACADO).toBe("criacao_planejamento:preco_atacado");
  });

  it("ver varejo/atacado = SÓ a chave própria", () => {
    expect(podeVerPrecoVarejo(comChaves(CHAVE_VER_PRECO_VAREJO))).toBe(true);
    expect(podeVerPrecoVarejo(comChaves(CHAVE_VER_PRECO_ATACADO))).toBe(false);
    expect(podeVerPrecoAtacado(comChaves(CHAVE_VER_PRECO_ATACADO))).toBe(true);
    expect(podeVerPrecoAtacado(comChaves(CHAVE_VER_PRECO_VAREJO))).toBe(false);
  });

  it("editar varejo/atacado = SÓ a chave própria", () => {
    expect(podeEditarPrecoVarejo(comChaves(CHAVE_EDITAR_PRECO_VAREJO))).toBe(true);
    expect(podeEditarPrecoVarejo(comChaves(CHAVE_EDITAR_PRECO_ATACADO))).toBe(false);
    expect(podeEditarPrecoAtacado(comChaves(CHAVE_EDITAR_PRECO_ATACADO))).toBe(true);
    expect(podeEditarPrecoAtacado(comChaves(CHAVE_EDITAR_PRECO_VAREJO))).toBe(false);
  });

  it("ORTOGONAL a custos: ver custo NÃO concede ver preço e vice-versa (4 cruzamentos)", () => {
    const soCustos = comChaves(...CHAVES_VER_CUSTOS);
    expect(podeVerPrecoVarejo(soCustos)).toBe(false);
    expect(podeVerPrecoAtacado(soCustos)).toBe(false);
    const soPreco = comChaves(CHAVE_VER_PRECO_VAREJO, CHAVE_VER_PRECO_ATACADO);
    // ver preço não concede nenhuma chave de custo:
    for (const k of CHAVES_VER_CUSTOS) expect(soPreco(k)).toBe(false);
  });

  it("NÃO referencia _pode_ver_custos/CHAVES_VER_CUSTOS no código-fonte (anti-drift)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/preco-permissao.ts", "utf8");
    expect(src).not.toMatch(/CHAVES_VER_CUSTOS|_pode_ver_custos|podeVerCustosServidor/);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que FALHA**

Run: `npx vitest run tests/unit/preco-permissao.test.ts`
Expected: FAIL (`@/lib/preco-permissao` não existe).

- [ ] **Step 3: Criar o helper** (`src/lib/preco-permissao.ts`)

```ts
// Permissão PRÓPRIA do preço de venda (varejo) e do preço de atacado — INDEPENDENTE de custos.
// VER = só na tela (leitura não trancada no banco, D1 A). EDITAR = trancado no banco (fn_modelo_preco_venda_gate).
// ⚠️ Estes helpers NÃO referenciam _pode_ver_custos/CHAVES_VER_CUSTOS: exibir preço depende SÓ das chaves de preço;
// exibir custo continua dependendo SÓ das chaves de custo. Nenhum ponto condiciona preço a custo nem custo a preço.
// Admins furam via canView/canEdit (user_can_view/_edit já os libera), como as demais seções.

/** VER preço de venda (varejo) — só tela. */
export const CHAVE_VER_PRECO_VAREJO = "criacao_planejamento:ver_preco_venda" as const;
/** VER preço de atacado — só tela. */
export const CHAVE_VER_PRECO_ATACADO = "criacao_planejamento:ver_preco_atacado" as const;
/** EDITAR preço de venda (varejo) — JÁ EXISTE; tranca no banco. */
export const CHAVE_EDITAR_PRECO_VAREJO = "criacao_planejamento:preco_venda" as const;
/** EDITAR preço de atacado — tranca no banco (ramo novo do gatilho). */
export const CHAVE_EDITAR_PRECO_ATACADO = "criacao_planejamento:preco_atacado" as const;

export function podeVerPrecoVarejo(canView: (k: string) => boolean): boolean {
  return canView(CHAVE_VER_PRECO_VAREJO);
}
export function podeVerPrecoAtacado(canView: (k: string) => boolean): boolean {
  return canView(CHAVE_VER_PRECO_ATACADO);
}
export function podeEditarPrecoVarejo(canEdit: (k: string) => boolean): boolean {
  return canEdit(CHAVE_EDITAR_PRECO_VAREJO);
}
export function podeEditarPrecoAtacado(canEdit: (k: string) => boolean): boolean {
  return canEdit(CHAVE_EDITAR_PRECO_ATACADO);
}
```

- [ ] **Step 4: Adicionar as 3 chaves novas no catálogo** (`src/lib/permissions-catalog.ts:169-174`)

Trocar o bloco `sections` de `criacao_planejamento` (hoje `custos`, `preco_venda`, `peca_teste`) por:

```ts
        sections: [
          { key: "criacao_planejamento:custos", label: "Custos / Preço" },
          { key: "criacao_planejamento:ver_preco_venda", label: "Ver preço de venda (varejo)" },
          { key: "criacao_planejamento:preco_venda", label: "Editar preço de venda (varejo)" },
          { key: "criacao_planejamento:ver_preco_atacado", label: "Ver preço de atacado" },
          { key: "criacao_planejamento:preco_atacado", label: "Editar preço de atacado" },
          // R9: seção "Peça Teste" do Sheet do Planejamento (conferida no servidor, `salvar_peca_teste`; backfill 195000).
          { key: "criacao_planejamento:peca_teste", label: "Peça Teste", hint: "Leitor vê a seção no card; Editor lança tentativas, datas e aprovação. Sem Leitor, a seção some do card." },
        ] },
```

(O label de `preco_venda` muda de "Editar preço de venda" para "Editar preço de venda (varejo)". As novas keys entram automaticamente em `ALL_PAGE_KEYS` — invariante 12 — e no `PermissoesModal`.)

- [ ] **Step 5: Rodar o teste e confirmar que PASSA + tsc + build**

Run: `npx vitest run tests/unit/preco-permissao.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"; npm run build`
Expected: build ok, sem TS2304.

- [ ] **Step 6: Commit**

```bash
git commit --only src/lib/preco-permissao.ts src/lib/permissions-catalog.ts tests/unit/preco-permissao.test.ts -m "feat(perm): helper preco-permissao + 3 chaves (ver varejo, ver/editar atacado) no catalogo"
```

---

### Task 3: UI varejo — troca de gate de exibição (preço ≠ custo) + anti-drift

**Files:**
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (declarações ~202/~223/~226/~535; `veCustos` ~535; prop passada à `PrecoTabela` ~2106 `podeVerCustos={veCustos}` → nova `podeVerPreco={veVarejo}`)
- Modify: `src/components/planejamento/planejamento-detail/PrecoTabela.tsx` (prop NOVA `podeVerPreco` para as linhas de preço; `podeVerCustos` FICA para custo/estimativa `:314`/`:324`/`:372`)
- Modify: `src/components/plan-tecido/CustoSection.tsx` (preço do card/vaga = varejo, gated por `podeVerPrecoVarejo` — gate NOVO; `canView` já disponível ~49)
- Modify: `src/routes/_authenticated/dashboard.tsx` (`ComercialColecaoTab` — KPIs/seções derivados de `preco_venda` escondidos sem `podeVerPrecoVarejo`: ~624/625/627 e ~678/679/681 e "Poder de venda por linha" ~633 e "Margem real." ~709/730)
- Test: `tests/unit/preco-exibicao-antidrift.test.ts`

**Interfaces:**
- Consumes: `podeVerPrecoVarejo`, `podeEditarPrecoVarejo` (Task 2); `canView`/`canEdit` de `useAuth`.
- Produces: prop nova `podeVerPreco: boolean` em `PrecoTabela` (decide mostrar o VALOR do preço de venda; separada de `podeVerCustos`, que fica só para custo/estimativa).

> **ESCOPO (decisão do dono, refinada por ponto 19/nov):** a exibição do preço de venda (varejo) passa a seguir `podeVerPrecoVarejo` em **3 pontos**:
> 1. **Sheet do Planejamento** — `PlanejamentoDetail.tsx:2106` (`podeVerCustos={veCustos}` passado à `PrecoTabela`) vira `podeVerPreco={veVarejo}`; custo/estimativa FICA em `veCustos`.
> 2. **Plan. Tecido `CustoSection`** (render do `ModelCard`) — o "Preço p/ venda (do card)" (~71) e o "Preço p/ venda" da vaga (~143-144) passam a ser gated por `podeVerPrecoVarejo(canView)`; sem a permissão mostram "—". **Gate NOVO** (hoje NÃO há gate de custo no cliente ali — a máscara era 100% server-side `custo_unitario_modelos → {}`). Custo do card continua server-side (não mexer).
> 3. **Dashboard Comercial (`ComercialColecaoTab`)** — as MÉTRICAS derivadas de `preco_venda` (Poder de venda, Margem média/real, Ticket médio, "Poder de venda por linha", coluna "Margem real." da tabela) ficam ESCONDIDAS de quem NÃO tem `podeVerPrecoVarejo`. ⚠️ **Comportamento NOVO**: hoje essas métricas seguem a permissão de DASHBOARD (`dashboard_comercial_colecao`), não de preço. Esconder a EXIBIÇÃO na tela (KPI/coluna/bloco) — NÃO zerar o cálculo nem quebrar o agregado (`agregarComercial` ~594 roda igual; só a renderização é gated).
>
> **Integração `CelulaCampo` fica de FORA (decisão do dono):** ali `preco_venda` é INSUMO do placeholder do "preço anterior" (`precoVendaRascunho` ~579), não exibição do preço de venda; mexer arriscaria o cálculo. Mantém como hoje (D1 A). A API/leitura por servidor também não trancam (D1 A).

- [ ] **Step 1: Escrever o teste anti-drift PRIMEIRO** (`tests/unit/preco-exibicao-antidrift.test.ts`)

Varre os componentes de preço por literal: nenhum pode decidir exibir o PREÇO DE VENDA por `veCustos`/`podeVerCustos`/`podeVerCustosServidor`. (Custo pode — o teste é só sobre as linhas de preço; lista branca mínima documentada no teste.)

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { podeVerPrecoVarejo } from "@/lib/preco-permissao";

describe("exibição do preço de venda (varejo) usa a chave própria (não custos)", () => {
  it("o helper é importável e puro", () => {
    expect(typeof podeVerPrecoVarejo).toBe("function");
  });

  it("PlanejamentoDetail deriva veVarejo e passa à PrecoTabela como podeVerPreco (não podeVerCustos={veCustos})", () => {
    const src = readFileSync("src/components/planejamento/PlanejamentoDetail.tsx", "utf8");
    expect(src).toMatch(/@\/lib\/preco-permissao/);
    expect(src).toMatch(/podeVerPreco=\{veVarejo\}/);
  });

  it("PrecoTabela tem a prop podeVerPreco separada de podeVerCustos", () => {
    const src = readFileSync("src/components/planejamento/planejamento-detail/PrecoTabela.tsx", "utf8");
    expect(src).toMatch(/podeVerPreco:\s*boolean/);
  });

  it("Plan. Tecido CustoSection gate o preço de venda por podeVerPrecoVarejo", () => {
    const src = readFileSync("src/components/plan-tecido/CustoSection.tsx", "utf8");
    expect(src).toMatch(/@\/lib\/preco-permissao/);
    expect(src).toMatch(/podeVerPrecoVarejo/);
  });

  it("Dashboard Comercial gate as métricas de preço por podeVerPrecoVarejo", () => {
    const src = readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8");
    expect(src).toMatch(/@\/lib\/preco-permissao/);
    expect(src).toMatch(/podeVerPrecoVarejo/);
  });
});
```

(Asserts frouxos — só exigem a separação e o uso do helper nos 3 pontos; o implementador aperta por ponto nos steps seguintes.)

- [ ] **Step 2: Rodar o teste e confirmar que FALHA**

Run: `npx vitest run tests/unit/preco-exibicao-antidrift.test.ts`
Expected: FAIL (a prop `podeVerPreco` não existe ainda).

- [ ] **Step 3: `PlanejamentoDetail.tsx` — derivar `veVarejo` e passar como `podeVerPreco`**

No topo (junto de `podeVerCustos = canView("criacao_planejamento:custos")` ~202; `veCustos = podeVerCustos || ficha.podeVerCustos` ~535), adicionar:

```ts
import { podeVerPrecoVarejo, podeEditarPrecoVarejo } from "@/lib/preco-permissao";
// ...
const veVarejo = podeVerPrecoVarejo(canView);       // mostrar o VALOR do preço de venda (varejo), independente de custos
const editaVarejo = podeEditarPrecoVarejo(canEdit); // = criacao_planejamento:preco_venda (= o podeEditarPreco de hoje, ~223)
```

No render da `PrecoTabela` (~2092-2107), a prop que hoje decide mostrar o VALOR do preço (`podeVerCustos={veCustos}`, linha **2106**) passa a `podeVerPreco={veVarejo}`. **Manter** `podeEditarCustos={podeEditarCustos}` (custo) e `podeEditarPreco={podeEditarPreco}` (edição do varejo). O que a `PrecoTabela` usa `podeVerCustos` para (custo/estimativa) passa a receber `podeVerCustos={veCustos}` AINDA (Step 4). `custosAdicionaisSoma` (2101) e demais partes de custo seguem em `veCustos`. `podeEditarPreco` (~223) fica = `editaVarejo`.

⚠️ Regra: distinguir SEMPRE "mostrar o VALOR do preço" (nova prop `podeVerPreco`, chave de preço) de "mostrar o custo/estimativa" (`podeVerCustos`, chave de custo). O custo NÃO migra.

- [ ] **Step 4: `PrecoTabela.tsx` — prop NOVA `podeVerPreco`; `podeVerCustos` fica só para custo/estimativa**

Na interface de props (~linha 91: `podeVerCustos: boolean; podeEditarCustos: boolean; podeEditarPreco: boolean;`), ADICIONAR `podeVerPreco: boolean;`. Destructuring (~115) idem. Usos a trocar:
- A visibilidade do VALOR do preço de venda / markup / preço anterior passa a respeitar `podeVerPreco` (se hoje o pai não mostrava o bloco, o pai já cuidava disso via `veCustos`; agora o bloco é mostrado por `podeVerPreco` — o implementador adiciona a condição de renderização do valor do preço por `podeVerPreco`, mantendo a edição em `podeEditarPreco`).
- `precoTecidoM` (`:314`), Parte 3 M.O. por faixa (`:324`), `tecidoEstimado` (`:372`): **FICAM** em `podeVerCustos` (são custo).
- Estimativa `custo_simulado` inputs (`:308`, `:386`): **FICAM** em `podeEditarCustos`.

Importar `@/lib/preco-permissao` (ao menos um comentário citando `podeVerPrecoVarejo` para o anti-drift, embora o helper seja aplicado no pai).

- [ ] **Step 5: `plan-tecido/CustoSection.tsx` — gate NOVO do preço de venda (varejo)**

`canView` já vem de `useAuth` (~49). Importar `podeVerPrecoVarejo` de `@/lib/preco-permissao` e derivar `const veVarejo = podeVerPrecoVarejo(canView);`. Nos dois pontos que mostram o preço de venda:
- "Preço p/ venda (do card)" (~71): `value={veVarejo ? (pc && pc.efetivo > 0 ? brl(pc.efetivo) : "—") : "—"}`.
- "Preço p/ venda" da vaga sem card (~143-144): a exibição do `pi.efetivo`/`slot.preco_venda` por `veVarejo`; sem a permissão mostra "—" e o input de preço fica escondido/desabilitado (a EDIÇÃO da vaga já existe; se o dono quiser separar edição aqui, é `podeEditarPrecoVarejo` — mas o escopo é só VER).
"Preço sugerido (do card)" (~70) e "Preço sugerido" (~142) são DERIVADOS do custo (sugerido = custo × markup) — seguem a máscara de custo do servidor, NÃO migram para ver-preço. Só o "Preço p/ venda" (o valor de venda em si) é gated por `veVarejo`.

- [ ] **Step 6: `dashboard.tsx` (`ComercialColecaoTab`) — esconder as métricas de preço sem ver-varejo**

`canView` já está no componente (via `useAuth`, usado por `abasVisiveis` ~77). Importar `podeVerPrecoVarejo` de `@/lib/preco-permissao` e derivar `const veVarejo = podeVerPrecoVarejo(canView);` dentro do `ComercialColecaoTab`. `agregarComercial` (~594) continua rodando igual (o cálculo não muda). Esconder a EXIBIÇÃO dos itens derivados de `preco_venda`:
- KPIs desktop "Poder de venda" (~624), "Margem média" (~625), "Ticket médio" (~627) e os `KpiCardMobile` equivalentes (~678/679/681): renderizar o valor por `veVarejo` (ex. `value={veVarejo ? brl(tot.pvPlan) : "—"}`), ou esconder o card inteiro se a tela ficar mais limpa — decisão do implementador, mas o VALOR não pode aparecer sem `veVarejo`.
- "Poder de venda por linha" (`cardPvLinha`, ~633): esconder o bloco (`{veVarejo && cardPvLinha}`) — é 100% poder de venda.
- A tabela por linha: a coluna "Margem real." (~709/730, `margemRealComercial`) é derivada de preço; esconder a célula/coluna sem `veVarejo` (as outras colunas não-preço ficam).
- "Margem por linha" (`cardMargem`, ~653) usa markup real = preço ÷ custo: esconder sem `veVarejo` (é derivado de preço).

⚠️ Comentar no código que este gate é a decisão do dono (19/nov) de esconder a métrica de preço por `podeVerPrecoVarejo`, separado da permissão da aba (`dashboard_comercial_colecao`, que controla ver a ABA). Se uma métrica misturar preço e não-preço de forma inseparável, esconder a parte de preço (coluna/bloco) e documentar no comentário.

- [ ] **Step 7: Rodar o teste e confirmar que PASSA**

Run: `npx vitest run tests/unit/preco-exibicao-antidrift.test.ts`
Expected: PASS (os 5 casos: helper, Sheet, PrecoTabela, Plan.Tecido, Dashboard).

- [ ] **Step 8: tsc + build + commit**

```bash
npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"; npm run build
git commit --only src/components/planejamento/PlanejamentoDetail.tsx src/components/planejamento/planejamento-detail/PrecoTabela.tsx src/components/plan-tecido/CustoSection.tsx src/routes/_authenticated/dashboard.tsx tests/unit/preco-exibicao-antidrift.test.ts -m "feat(ui): exibicao do preco de venda (varejo) por chave propria no Sheet, Plan.Tecido e Dashboard Comercial; custo fica em custos"
```

- [ ] **Step 9: QA (prévia, localhost:5190)** — com 3 telas:
- **Sheet do Planejamento:** ver-custo SEM ver-varejo → o VALOR do preço de venda some, custo/estimativa continua; ver-varejo SEM ver-custo → o preço aparece, custo/estimativa "—".
- **Plan. Tecido (card):** sem ver-varejo → "Preço p/ venda" mostra "—"; o custo do card segue a máscara de custo.
- **Dashboard Comercial:** sem ver-varejo → Poder de venda / Margem / Ticket / "Poder de venda por linha" / "Margem real." escondidos ou "—", sem quebrar o agregado nem a aba; com ver-varejo → aparecem.
- **Integração `CelulaCampo` NÃO muda** (preço é insumo do placeholder de preço anterior; D1 A).

---

### Task 4: UI atacado — ProdutoCard, Sheets, bloco comprado, ResumoRevendaPanel (varejo × atacado separados)

**Files:**
- Modify: `src/components/produto-acabado/ProdutoCard.tsx` (título Varejo·Atacado ~885; inputs markup/fixo ~911-966 — NOVO gate de VER, hoje o bloco "2 · Preço" não tem gate de custo)
- Modify: `src/components/produto-acabado/ProdutoAcabadoSheet.tsx` (embed `modelo:modelo_id(preco_venda, preco_atacado…)` ~182; exibição do `modeloPrecoVenda`/`modeloPrecoAtacado`)
- Modify: `src/components/produto-importado/ProdutoImportadoSheet.tsx` (embed `modelo:modelo_id(preco_venda…)` ~81 — só varejo, SEM atacado; exibição do `modeloPrecoVenda`)
- Modify: `src/components/produto-acabado/ResumoRevendaPanel.tsx` (exibe `modeloPrecoVenda` no Poder de venda ~58 — gate de VER VAREJO; NÃO exibe atacado)
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (bloco `PrecoRevendaBloco` ~686-724, ~2139-2146 — separar editar atacado de `podeEditarPrecoComprado`)
- Test: `tests/unit/produto-card-preco-cruzamentos.test.ts`

**Interfaces:**
- Consumes: `podeVerPrecoVarejo`, `podeVerPrecoAtacado`, `podeEditarPrecoVarejo`, `podeEditarPrecoAtacado` (Task 2).

> **ESCOPO (achados da exploração):** (a) o bloco "2 · Preço" do `ProdutoCard` HOJE NÃO tem gate de custo — só a sub-seção de M.O. usa `podeVerCustosServidor`; portanto o gate de VER varejo/atacado nesse bloco é NOVO. (b) `ProdutoImportadoSheet` mora em `src/components/produto-importado/` (não `produto-acabado/`) e embeda só `preco_venda` (importado não tem atacado) — lá só o varejo é gated. (c) `ResumoRevendaPanel` exibe `modeloPrecoVenda` (varejo) no "Poder de venda", NÃO exibe `preco_atacado` — o gate ali é de VER VAREJO. (d) `podeEditarPrecoComprado` (~226) = `canEdit('criacao_planejamento:preco_venda') || canEdit('criacao_produto_acabado')`.

- [ ] **Step 1: Escrever o teste de render (cruzamentos) PRIMEIRO** (`tests/unit/produto-card-preco-cruzamentos.test.ts`)

Render real (`react-dom/server`) do `ProdutoCard` com cada combinação ver-varejo × ver-atacado; "—" só na parte faltante, nunca o bloco inteiro some; inputs de editar atacado gated por `podeEditarPrecoAtacado`.

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { ProdutoCard } from "@/components/produto-acabado/ProdutoCard";

// props mínimas — materializar a partir da assinatura real do ProdutoCard ao implementar.
const base = {
  produto: { id: "p1", nome: "PP", preco_venda: 100, preco_atacado: 60 },
  // ...demais props obrigatórias
} as any;

const render = (over: Partial<Record<string, boolean>>) =>
  renderToStaticMarkup(h(ProdutoCard as any, {
    ...base,
    podeVerPrecoVarejo: true, podeVerPrecoAtacado: true,
    podeEditarPrecoVarejo: false, podeEditarPrecoAtacado: false,
    ...over,
  }));

describe("ProdutoCard — varejo e atacado separados", () => {
  it("vê varejo mas não atacado: Varejo com valor, Atacado com —, bloco não some", () => {
    const html = render({ podeVerPrecoAtacado: false });
    expect(html).toContain("Varejo");
    expect(html).toContain("Atacado");
    // o bloco inteiro continua presente; a parte de atacado mostra "—"
  });
  it("vê atacado mas não varejo: Atacado com valor, Varejo com —", () => {
    const html = render({ podeVerPrecoVarejo: false });
    expect(html).toContain("Atacado");
  });
  it("inputs de editar atacado só aparecem com podeEditarPrecoAtacado", () => {
    const semEditar = render({ podeEditarPrecoAtacado: false });
    const comEditar = render({ podeEditarPrecoAtacado: true });
    expect(comEditar.length).toBeGreaterThanOrEqual(semEditar.length);
  });
});
```

(O implementador materializa as props reais a partir da assinatura do `ProdutoCard`.)

- [ ] **Step 2: Rodar o teste e confirmar que FALHA**

Run: `npx vitest run tests/unit/produto-card-preco-cruzamentos.test.ts`
Expected: FAIL (ProdutoCard ainda não tem as props `podeVerPrecoVarejo`/`podeVerPrecoAtacado`/`podeEditarPrecoAtacado`).

- [ ] **Step 3: `ProdutoCard.tsx` — gate NOVO de VER: Varejo (ver-varejo) × Atacado (ver-atacado)**

Hoje o título "Varejo … · Atacado …" (~885) e os inputs de markup/preço fixo de atacado e varejo (~911-966) NÃO têm gate de custo (só a M.O. em ~164 usa `podeVerCustosServidor`). Derivar (importando `@/lib/preco-permissao`): `veVarejo = podeVerPrecoVarejo(canView)`, `veAtacado = podeVerPrecoAtacado(canView)`, `editaVarejo = podeEditarPrecoVarejo(canEdit)`, `editaAtacado = podeEditarPrecoAtacado(canEdit)`. No título (~885) mostrar `Varejo …` só com `veVarejo` (senão `Varejo —`) e `Atacado …` só com `veAtacado` (senão `Atacado —`) — NÃO esconder a pill inteira; o custo/pç segue como está. Os inputs de EDITAR varejo (markup varejo ~930, preço varejo ~959) gated por `editaVarejo`; os de EDITAR atacado (markup atacado ~911, preço atacado ~947) por `editaAtacado`. Sem a permissão de VER, mostrar "—" só naquela parte. Se `ProdutoCard` recebe `canView`/`canEdit` por contexto, derivar in-loco; se recebe por prop, passar do pai que monta os cards.

- [ ] **Step 4: `ProdutoAcabadoSheet.tsx` / `ProdutoImportadoSheet.tsx` — cada preço sob sua chave de VER**

PA (`src/components/produto-acabado/ProdutoAcabadoSheet.tsx`): o embed `modelo:modelo_id(preco_venda, preco_atacado,…)` (~182) FICA (leitura não trancada); lê em `modeloPrecoVenda`/`modeloPrecoAtacado` (~155-156). A EXIBIÇÃO do `modeloPrecoVenda` (varejo) gated por `podeVerPrecoVarejo`, a do `modeloPrecoAtacado` por `podeVerPrecoAtacado`.
PI (`src/components/produto-importado/ProdutoImportadoSheet.tsx`): o embed (~81) tem SÓ `preco_venda` (importado não tem atacado); a exibição do `modeloPrecoVenda` (~232) gated por `podeVerPrecoVarejo`. Importar de `@/lib/preco-permissao` nos dois.

- [ ] **Step 5: `ResumoRevendaPanel.tsx` — Poder de venda (varejo) por ver-varejo**

O painel exibe `modeloPrecoVenda` no "Poder de venda" (~58) e usa a cadeia de compra no "Custo previsto" (~61) — NÃO exibe atacado. Gate da exibição do `poderVenda`/`comFornec` (varejo) por `podeVerPrecoVarejo(canView)`. O "Custo previsto" FICA sob custos (não mexer). Importar de `@/lib/preco-permissao`.

- [ ] **Step 6: `PlanejamentoDetail.tsx` — bloco `PrecoRevendaBloco`: separar editar atacado**

`podeEditarPrecoComprado` (~226 = `canEdit('criacao_planejamento:preco_venda') || canEdit('criacao_produto_acabado')`) é hoje passado ao `PrecoRevendaBloco` (~2142) para varejo-comprado E atacado. Derivar `editaAtacado = podeEditarPrecoAtacado(canEdit)` e passar ao `PrecoRevendaBloco` uma prop NOVA (ex. `podeEditarAtacado={editaAtacado}`) para gatar a EDIÇÃO do atacado; manter `podeEditarPreco={podeEditarPreco}` (= `editaVarejo`) para o varejo e `podeEditarPrecoComprado` para o que não for especificamente atacado. Dentro de `PrecoRevendaBloco`, trocar o gate dos controles de ATACADO de `podeEditarPrecoComprado` para a prop nova. A trava da Integração continua SÓ no varejo (`travaVarejo`, ~2144; invariante 14 — atacado livre). A EXIBIÇÃO do varejo/atacado nesse bloco segue `veVarejo`/`veAtacado` (passar `podeVerPrecoVarejo`/`podeVerPrecoAtacado` como props se o bloco exibir os dois valores).

- [ ] **Step 7: Rodar o teste e confirmar que PASSA + tsc + build**

Run: `npx vitest run tests/unit/produto-card-preco-cruzamentos.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"; npm run build`

- [ ] **Step 8: Commit**

```bash
git commit --only src/components/produto-acabado/ProdutoCard.tsx src/components/produto-acabado/ProdutoAcabadoSheet.tsx src/components/produto-importado/ProdutoImportadoSheet.tsx src/components/produto-acabado/ResumoRevendaPanel.tsx src/components/planejamento/PlanejamentoDetail.tsx tests/unit/produto-card-preco-cruzamentos.test.ts -m "feat(ui): varejo e atacado separados no ProdutoCard/Sheets/bloco comprado (ver/editar por chave propria)"
```

- [ ] **Step 9: QA (prévia, localhost:5190)** — ProdutoCard: com ver-varejo e sem ver-atacado, Varejo mostra valor e Atacado "—" (bloco inteiro continua); inverso idem; inputs de editar atacado só com editar-atacado; trava da Integração continua só no varejo.

---

### Task 5: Payload do Salvar — omitir varejo/atacado por chave independente

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts` (prop nova `podeEditarPrecoAtacado`; bloco de payload ~499-519; prop `podeEditarPreco` renomeada mentalmente para "varejo")
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (passa `podeEditarPrecoAtacado` ao hook)
- Test: `tests/unit/payload-preco-permissao.test.ts`

**Interfaces:**
- Consumes: `podeEditarPrecoVarejo`, `podeEditarPrecoAtacado` (Task 2).
- Produces: payload do Salvar que omite `preco_venda` por `!podeEditarPrecoVarejo` e `preco_atacado` por `!podeEditarPrecoAtacado`, independentes; `preco_anterior` colado ao varejo.

- [ ] **Step 1: Escrever o teste do helper de payload PRIMEIRO** (`tests/unit/payload-preco-permissao.test.ts`)

Para testar isolado, extrair a regra de preço num helper puro `aplicarRegrasPrecoNoPayload(payload, draft, { origemComprada, editaVarejo, editaAtacado })` em `helpers.ts` (junto de `aplicarPrecoAnterior`), e testar os cruzamentos:

```ts
import { describe, it, expect } from "vitest";
import { aplicarRegrasPrecoNoPayload } from "@/components/planejamento/planejamento-detail/helpers";

const draft = { origem: "interno", preco_venda: 100, preco_atacado: 60 } as any;

describe("payload — varejo e atacado omitidos por chave independente", () => {
  it("interno, edita varejo e atacado: ambos no payload", () => {
    const p: any = {};
    aplicarRegrasPrecoNoPayload(p, draft, { origemComprada: false, editaVarejo: true, editaAtacado: true });
    expect(p.preco_venda).toBe(100);
    expect(p.preco_atacado).toBe(60);
  });
  it("interno, NÃO edita varejo: preco_venda some, preco_atacado fica (independentes)", () => {
    const p: any = {};
    aplicarRegrasPrecoNoPayload(p, draft, { origemComprada: false, editaVarejo: false, editaAtacado: true });
    expect("preco_venda" in p).toBe(false);
    expect(p.preco_atacado).toBe(60);
  });
  it("interno, NÃO edita atacado: preco_atacado some, preco_venda fica", () => {
    const p: any = {};
    aplicarRegrasPrecoNoPayload(p, draft, { origemComprada: false, editaVarejo: true, editaAtacado: false });
    expect(p.preco_venda).toBe(100);
    expect("preco_atacado" in p).toBe(false);
  });
  it("comprado (revenda/importado): ambos OMITIDOS (derivados no servidor)", () => {
    const p: any = {};
    aplicarRegrasPrecoNoPayload(p, { ...draft, origem: "revenda" }, { origemComprada: true, editaVarejo: true, editaAtacado: true });
    expect("preco_venda" in p).toBe(false);
    expect("preco_atacado" in p).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que FALHA**

Run: `npx vitest run tests/unit/payload-preco-permissao.test.ts`
Expected: FAIL (`aplicarRegrasPrecoNoPayload` não existe).

- [ ] **Step 3: Extrair o helper puro em `helpers.ts`**

```ts
// Regra de preço no payload do Salvar (espelho das decisões em usePlanejamentoSave): varejo e atacado
// são omitidos por chaves INDEPENDENTES. Comprado (revenda/importado): ambos derivados no servidor → omitidos.
// numOr0 vem de @/components/planejamento/modelo-shared (importar no topo de helpers.ts).
import { numOr0 } from "@/components/planejamento/modelo-shared";
// ...
export function aplicarRegrasPrecoNoPayload(
  payload: Record<string, unknown>,
  draft: { origem?: string | null; preco_venda?: number | null; preco_atacado?: number | null },
  o: { origemComprada: boolean; editaVarejo: boolean; editaAtacado: boolean },
): void {
  if (o.origemComprada) {
    delete payload.preco_venda;
    delete payload.preco_atacado;
    return;
  }
  if (o.editaVarejo) payload.preco_venda = numOr0(draft.preco_venda) > 0 ? numOr0(draft.preco_venda) : null;
  else delete payload.preco_venda;
  if (o.editaAtacado) payload.preco_atacado = numOr0(draft.preco_atacado) > 0 ? numOr0(draft.preco_atacado) : null;
  else delete payload.preco_atacado;
}
```

⚠️ Hoje (`usePlanejamentoSave.ts:512`) o `preco_atacado` do interno é setado INCONDICIONALMENTE. Esta extração passa a omiti-lo sem `editaAtacado` — comportamento novo e desejado (o gate do atacado no banco agora morde PATCH direto). Confirme que o fluxo interno normal (`preco_atacado` null/0) não quebra.

- [ ] **Step 4: Usar o helper em `usePlanejamentoSave.ts`**

Adicionar a prop `podeEditarPrecoAtacado: boolean` à interface (junto de `podeEditarPreco`, ~146). No bloco ~499-513, substituir o `if (ehOrigemComprada(d.origem)) { delete… } else { … }` por:

```ts
aplicarRegrasPrecoNoPayload(payload, d, {
  origemComprada: ehOrigemComprada(d.origem),
  editaVarejo: podeEditarPreco,        // = podeEditarPrecoVarejo (criacao_planejamento:preco_venda)
  editaAtacado: podeEditarPrecoAtacado, // chave nova, independente
});
```

`aplicarPrecoAnterior(payload, d, podeEditarPreco)` (~519) FICA colado ao varejo (mesma chave `criacao_planejamento:preco_venda`, invariante S5). Importar `aplicarRegrasPrecoNoPayload` no topo (junto de `aplicarPrecoAnterior`).

- [ ] **Step 5: `PlanejamentoDetail.tsx` — passar a nova prop ao hook**

Onde o `usePlanejamentoSave(...)` é chamado, adicionar `podeEditarPrecoAtacado: editaAtacado` (de Task 4 Step 6). `podeEditarPreco` continua `editaVarejo`.

- [ ] **Step 6: Rodar o teste e confirmar que PASSA + tsc + build**

Run: `npx vitest run tests/unit/payload-preco-permissao.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"; npm run build`

- [ ] **Step 7: Commit**

```bash
git commit --only src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts src/components/planejamento/planejamento-detail/helpers.ts src/components/planejamento/PlanejamentoDetail.tsx tests/unit/payload-preco-permissao.test.ts -m "feat(payload): omitir preco_venda/preco_atacado por chave independente; preco_anterior colado ao varejo"
```

- [ ] **Step 8: QA (prévia, localhost:5190)** — usuário que edita varejo mas não atacado: Salvar grava o varejo e não manda o atacado (sem 42501); inverso idem; comprado nunca manda nenhum dos dois (derivado no servidor).

---

## Notas de execução (subagentes)

- **Ordem OBRIGATÓRIA:** Task 1 (banco) → Task 2 (catálogo+helper) → Task 3 (UI varejo) → Task 4 (UI atacado) → Task 5 (payload). Task 1 é independente mas vai PRIMEIRO (banco antes do site). Tasks 2–5 consomem o helper da Task 2. Tasks 3 e 4 ambas tocam `PlanejamentoDetail.tsx` (3 nas derivações/exibição do varejo, 4 no bloco comprado/atacado) — se rodarem em paralelo, haverá conflito de arquivo; prefira sequencial, ou Task 4 depois da 3. Task 5 depende de 2 e 4 (prop `podeEditarPrecoAtacado`).
- **Banco (Task 1):** testar SÓ na cópia local (Docker PG; `export DATABASE_URL="$(cat /tmp/dburl-local.txt)"` no brief — fallback é PRODUÇÃO, incidente 24/set). NUNCA DDL em txn de teste contra produção; NUNCA `\i` migration em txn de teste. Diff-validar `fn_modelo_preco_venda_gate` (`pg_get_functiondef` antes/depois) — só essa função muda. Capturar o `md5 depois` real e preencher os placeholders `<MD5_DEPOIS>`.
- **Modelo:** Task 1 (banco, cuidado) → Sonnet executa, revisão Opus. Tasks 2–5 (UI/payload, helper claro) → Sonnet. **Haiku proibido.**
- **Revisão final (whole-branch):** Opus — focada nos 5 pontos do Review Focus: (1) nenhum ponto de preço esquecido em `veCustos` (anti-drift); (2) recompute derivado do comprado passa com o gate do atacado (GUC primeiro); (3) backfill cobre `papel_permissoes`; (4) ortogonalidade custo×preço nos helpers; (5) varejo e atacado separados por campo ("—" só na parte faltante).
- **Deploy:** banco ANTES do site; produção pelo dono (roteiro NO PAINEL). Volta LIFO: site → gatilho `_down` (devolve o corpo da S1) → backfill (no-op, não reverte) → catálogo (remover as 3 chaves é opcional/inócuo). ⚠️ Regenerar o md5 `depois` da guarda S1 (`20261031120000`) ao reaplicar a S1 no futuro — o teste da Task 1 fixa o novo md5.
- **PRÉVIA antes do deploy (localhost:5190):** o dono confere os cruzamentos de permissão antes de publicar. Perguntas no painel (P-xx), chat só "painel atualizado".
- Commit paralelo: `git commit --only`.
