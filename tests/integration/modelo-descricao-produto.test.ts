/**
 * F3.1 — coluna `modelos.descricao_produto` + "Replicar card(s)" leva a descrição.
 * Migration supabase/migrations/20260930180000_modelo_descricao_produto.sql e inverso
 * supabase/rollback/20260930180000_modelo_descricao_produto_down.sql.
 *  • Bloco ESTÁTICO (sem banco): os arquivos reproduzem o corpo vivo com SÓ as 2 linhas trocadas, e o ALTER
 *    em `modelos` é o ÚLTIMO comando antes do COMMIT (receita do G-migration da F1 — R7 do G-plano conjunto).
 *  • Bloco DB: aplica DENTRO de BEGIN…ROLLBACK (withTx) — NADA é gravado. ⚠️ DDL SÓ NA CÓPIA LOCAL: o
 *    bloco PULA se DATABASE_URL não for 127.0.0.1:54422 e `aplicarArquivo` recusa (exigeBancoLocal). Inclui a
 *    prova da trava: com `modelos` ocupada por outra conexão, a migration desiste em 55P03 (lock_timeout 500ms)
 *    e NADA fica (nem a função trocada).
 * Rodar: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/integration/modelo-descricao-produto.test.ts
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal, dbUrl } from "./db";
import { aplicarArquivo, exigeBancoLocal, semTransacao } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const LOCAL = ehBancoLocal();
const VIVO = "supabase/migrations/20260908240000_plan_tecido_replicar_ref.sql";
const MIG = "supabase/migrations/20260930180000_modelo_descricao_produto.sql";
const INV = "supabase/rollback/20260930180000_modelo_descricao_produto_down.sql";
const FN = "public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)";
const COL_ANTES = "      versao, modelo_base_id, mix_id, ref, ref_auto\n";
const COL_DEPOIS = "      versao, modelo_base_id, mix_id, ref, ref_auto, descricao_produto\n";
const VAL_ANTES = "      v_versao, v_root, o.mix_id, o.ref, o.ref_auto\n";
const VAL_DEPOIS = "      v_versao, v_root, o.mix_id, o.ref, o.ref_auto, o.descricao_produto\n";
const TEXTO = "Vestido midi em linho misto, decote V (ITEST F3.1)";

function corpoDoArquivo(rel: string): string {
  const t = readFileSync(ROOT + rel, "utf8");
  const i = t.indexOf("CREATE OR REPLACE FUNCTION public._replicar_cards_plan_tecido_core(");
  const f = t.indexOf("end $function$;", i);
  if (i < 0 || f < 0) throw new Error(`${rel}: corpo da função não achado`);
  return t.slice(i, f + "end $function$;".length);
}

describe("F3.1 — arquivos da migration (estático, sem banco)", () => {
  it("migration = corpo vivo (20260908240000) com SÓ as 2 linhas do INSERT trocadas", () => {
    const antes = corpoDoArquivo(VIVO);
    expect(antes.split(COL_ANTES).length - 1).toBe(1);
    expect(antes.split(VAL_ANTES).length - 1).toBe(1);
    expect(corpoDoArquivo(MIG)).toBe(antes.replace(COL_ANTES, COL_DEPOIS).replace(VAL_ANTES, VAL_DEPOIS));
  });
  it("inverso restaura o corpo vivo byte a byte e só dropa a coluna POR ÚLTIMO (depois da função e da ACL)", () => {
    const inv = readFileSync(ROOT + INV, "utf8");
    expect(corpoDoArquivo(INV)).toBe(corpoDoArquivo(VIVO));
    const iDrop = inv.indexOf("ALTER TABLE public.modelos DROP COLUMN IF EXISTS descricao_produto;");
    expect(iDrop).toBeGreaterThan(inv.indexOf("end $function$;"));
    expect(iDrop).toBeGreaterThan(inv.lastIndexOf("END $$;"));
    expect(inv.slice(iDrop).replace(/--[^\n]*/g, "").match(/;/g)).toHaveLength(2); // DROP; COMMIT;
    expect(inv).toContain("app.confirmo_apagar_descricao_produto");
  });
  it("migration: aditiva, idempotente, CREATE FUNCTION antes e ALTER POR ÚLTIMO, sem timeout embutido (receita G-migration F1)", () => {
    const m = readFileSync(ROOT + MIG, "utf8");
    const iAlter = m.indexOf("ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS descricao_produto text;");
    expect(iAlter).toBeGreaterThan(m.indexOf("end $function$;"));
    expect(iAlter).toBeGreaterThan(m.indexOf("REVOKE EXECUTE ON FUNCTION"));
    expect(iAlter).toBeGreaterThan(m.lastIndexOf("END $$;"));
    const depois = m.slice(iAlter).replace(/--[^\n]*/g, "");
    expect(depois.match(/;/g)).toHaveLength(3); // ALTER; COMMENT; COMMIT; — nada mais segura a trava de `modelos`
    expect(depois).toContain("COMMENT ON COLUMN public.modelos.descricao_produto IS");
    expect(depois.trim().endsWith("COMMIT;")).toBe(true);
    // Antes da função: só o BEGIN (as travas SET LOCAL são injetadas pelo aplica_v2, como na F1).
    expect(m.slice(0, m.indexOf("CREATE OR REPLACE FUNCTION")).replace(/--[^\n]*/g, "").trim()).toBe("BEGIN;");
    expect(m).not.toMatch(/DROP\s+COLUMN/i);
    expect(() => semTransacao(m, MIG)).not.toThrow();
    expect(() => semTransacao(readFileSync(ROOT + INV, "utf8"), INV)).not.toThrow();
  });
});

describe("mig-txn — travas do harness (sem banco)", () => {
  it("tira 1 BEGIN;/1 COMMIT; e recusa controle de transação solto", () => {
    expect(semTransacao("BEGIN;\nSELECT 1;\nCOMMIT;\n", "ok")).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/m);
    expect(() => semTransacao("BEGIN;\nSELECT 1; COMMIT;\nCOMMIT;\n", "x")).toThrow(/controle de transação/);
    expect(() => semTransacao("SELECT 1;\n", "x")).toThrow(/1 "BEGIN;"/);
  });
  it("recusa meta-comando psql", () => {
    expect(() => semTransacao("BEGIN;\n\\i outro.sql\nCOMMIT;\n", "x")).toThrow(/meta-comando/);
  });
  it("aceita BEGIN/END de plpgsql dentro de $$", () => {
    expect(() => semTransacao("BEGIN;\nDO $$ BEGIN PERFORM 1; END $$;\nCOMMIT;\n", "ok")).not.toThrow();
  });
});

async function prepara(c: Client) {
  exigeBancoLocal();
  // Mesmo lock_timeout que o aplica_v2 injeta em produção (receita G-migration F1). O transaction_timeout de 3 s
  // NÃO entra aqui: derrubaria a conexão do teste (FATAL 25P04) se a txn do teste passar de 3 s depois do SET —
  // ele é provado no ensaio da cópia local (Step 8) e foi confirmado no PG 17.6 pelo runbook da F1.
  await c.query("SET LOCAL lock_timeout = '500ms'");
  await c.query("SET LOCAL statement_timeout = '60s'");
}
async function def(c: Client): Promise<string> {
  return (await um<{ d: string }>(c, `select pg_get_functiondef($1::regprocedure) d`, [FN])).d;
}
async function acl(c: Client): Promise<string | null> {
  return (await um<{ a: string | null }>(c, `select proacl::text a from pg_proc where oid = $1::regprocedure`, [FN])).a;
}
async function coluna(c: Client) {
  return um<{ data_type: string; is_nullable: string; column_default: string | null } | undefined>(
    c,
    `select data_type, is_nullable, column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'modelos' and column_name = 'descricao_produto'`,
  );
}
async function privs(c: Client) {
  return um<{ anon: boolean; auth: boolean }>(
    c,
    `select has_function_privilege('anon', $1, 'EXECUTE') anon, has_function_privilege('authenticated', $1, 'EXECUTE') auth`,
    [FN],
  );
}
// F3.6 (Parte B, T7 — ruling do controlador 25/set): a reorganização do Sheet (migration
// 20261005100000) REDEFINE este MESMO `_replicar_cards_plan_tecido_core` (acrescenta 7 campos +
// tamanho_tipo no INSERT — R14/R23–R26). Com ela viva, o corpo AO VIVO já não bate com a
// transformação ESTÁTICA que `MIG` (F3.1, 20260930180000) escreveria por cima — mesmo caso do R27
// no sku-automatico. Detectada por `_titulo_pagina_calculado`, único da reorg.
async function reorgViva(c: Client): Promise<boolean> {
  return (
    await um<{ v: boolean }>(
      c,
      `select to_regprocedure('public._titulo_pagina_calculado(text,text)') is not null v`,
    )
  ).v;
}

/**
 * T1 (backend, 05/out): a F3.1 JÁ foi aplicada (a cópia = produção + kit: a coluna existe, com descrições reais). Estes testes foram escritos
 * para o estado ANTERIOR (sem a coluna). Para continuar provando a migration e o inverso, leva a txn DE VOLTA ao "antes" aplicando o próprio
 * inverso (com a confirmação do apagar, SÓ nesta txn revertida; o texto das descrições volta no ROLLBACK) e zera a confirmação, para que os
 * testes de recusa/idempotência do inverso continuem medindo o inverso sem ela. Sem a coluna (banco pré-F3.1): não faz nada.
 * Efeito colateral deliberado: o inverso restaura o corpo de `_replicar_cards_plan_tecido_core` de ANTES da F3.1 (também anterior à reorg do
 * Sheet), então a comparação byte a byte da migration volta a ser exata.
 */
async function paraEstadoAnterior(c: Client): Promise<void> {
  if (!(await coluna(c))) return;
  await c.query("SELECT set_config('app.confirmo_apagar_descricao_produto', 'sim', true)");
  await aplicarArquivo(c, INV);
  await c.query("SELECT set_config('app.confirmo_apagar_descricao_produto', '', true)");
}

describe.skipIf(!hasDb || !LOCAL)("F3.1 — modelos.descricao_produto (cópia local, txn revertida)", () => {
  it("base: sem a coluna; função = corpo vivo (âncoras 1× cada); ACL fechada", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await paraEstadoAnterior(c);
      expect(await coluna(c)).toBeUndefined();
      const d = await def(c);
      expect(d.split(COL_ANTES).length - 1).toBe(1);
      expect(d.split(VAL_ANTES).length - 1).toBe(1);
      const p = await privs(c);
      expect(p.anon).toBe(false);
      expect(p.auth).toBe(false);
    });
  });

  it("migration: coluna text/nullable/sem default; função = antes com SÓ 2 linhas trocadas; ACL igual e fechada", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await paraEstadoAnterior(c);
      const antes = await def(c);
      const aclAntes = await acl(c);
      // Com o estado anterior reconstruído pelo inverso, a função tem as âncoras e a comparação byte a byte vale; o ramo da reorg só roda
      // num banco que já tem a reorg do Sheet E ainda não tem a coluna (ordem de deploy antiga).
      if (!antes.includes(COL_ANTES) && (await reorgViva(c))) {
        // R14/R23–R26 (T7, ruling do controlador 25/set): a reorg do Sheet (20261005100000) já
        // redefiniu `_replicar_cards_plan_tecido_core` com 7 campos + tamanho_tipo A MAIS no
        // INSERT — `antes` já não termina em `ref_auto` (COL_ANTES/VAL_ANTES deixam de bater), e
        // aplicar o `MIG` estático da F3.1 por cima SOBRESCREVERIA o corpo com a versão pré-reorg,
        // mascarando o que está em produção. Não aplicamos `MIG` aqui: reafirmamos o essencial da
        // F3.1 (coluna existe, ACL igual, e a função — já com a reorg — leva a descrição) sem a
        // comparação byte-a-byte, que só é exata no caminho SEM a reorg (ramo `else` abaixo).
        expect(await coluna(c)).toEqual({ data_type: "text", is_nullable: "YES", column_default: null });
        expect(antes).toContain("descricao_produto");
        expect(antes).toContain("o.descricao_produto");
        expect(await acl(c)).toBe(aclAntes);
        const p = await privs(c);
        expect(p.anon).toBe(false);
        expect(p.auth).toBe(false);
        return;
      }
      await aplicarArquivo(c, MIG);
      expect(await coluna(c)).toEqual({ data_type: "text", is_nullable: "YES", column_default: null });
      expect(await def(c)).toBe(antes.replace(COL_ANTES, COL_DEPOIS).replace(VAL_ANTES, VAL_DEPOIS));
      expect(await acl(c)).toBe(aclAntes);
      const p = await privs(c);
      expect(p.anon).toBe(false);
      expect(p.auth).toBe(false);
      const cm = await um<{ c: string | null }>(
        c,
        `select col_description('public.modelos'::regclass,
                (select attnum from pg_attribute where attrelid = 'public.modelos'::regclass and attname = 'descricao_produto')) c`,
      );
      expect(cm.c).toMatch(/Descrição do produto/);
    });
  });

  it("receita de travas: com `modelos` ocupada por outra conexão, desiste em 55P03 (lock_timeout 500ms) e NADA fica", async () => {
    exigeBancoLocal();
    // Outra sessão lendo `modelos` numa txn aberta (AccessShare — o que qualquer SELECT do app segura). O ALTER, que
    // é o ÚLTIMO comando, pede ACCESS EXCLUSIVE e espera; em 500 ms desiste. A função (trocada ANTES) volta junto.
    const outra = new Client({ connectionString: dbUrl()!, ssl: false });
    await outra.connect();
    try {
      await outra.query("BEGIN");
      await outra.query("SELECT 1 FROM public.modelos LIMIT 1");
      await withTx(async (c) => {
        await prepara(c);
        // T1 (backend, 05/out): com a F3.1 já aplicada a coluna existe e não dá para voltar ao "antes" com a outra sessão segurando `modelos`
        // (o DROP também pede ACCESS EXCLUSIVE). Não precisa: `ADD COLUMN IF NOT EXISTS` pede o MESMO ACCESS EXCLUSIVE antes de olhar se
        // a coluna existe, então a receita (desiste em 55P03 e NADA fica) é medida igual — a função trocada ANTES do ALTER tem de voltar.
        const existia = await coluna(c);
        const antes = await def(c);
        const t0 = Date.now();
        let codigo: string | undefined;
        try {
          await aplicarArquivo(c, MIG);
        } catch (e) {
          codigo = (e as { code?: string }).code;
        }
        expect(codigo).toBe("55P03");
        expect(Date.now() - t0).toBeLessThan(3000);
        expect(await coluna(c)).toEqual(existia); // nada mudou: ausente continua ausente (banco pré-F3.1), presente continua presente
        expect(await def(c)).toBe(antes);
      });
    } finally {
      await outra.query("ROLLBACK").catch(() => undefined);
      await outra.end();
    }
  });

  it("migration é idempotente (2× na mesma txn)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await aplicarArquivo(c, MIG);
      const d1 = await def(c);
      await aplicarArquivo(c, MIG);
      expect(await def(c)).toBe(d1);
      expect(await coluna(c)).toBeTruthy();
    });
  });

  it("Replicar card(s) leva a descrição (vazia continua NULL)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await aplicarArquivo(c, MIG);
      await comoUsuario(c);
      await c.query(
        `insert into tenant_config (tenant_id, modules) values ($1, '{"criacao":true,"otb":true}'::jsonb)
         on conflict (tenant_id) do update set modules = tenant_config.modules || '{"criacao":true,"otb":true}'::jsonb`,
        [TENANT_TESTE],
      );
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('ITEST-F31-DESC','rascunho') returning id`);
      const com = await um<{ id: string }>(c, `insert into modelos (nome, descricao_produto) values ('ITEST-F31-COM', $1) returning id`, [TEXTO]);
      const sem = await um<{ id: string }>(c, `insert into modelos (nome) values ('ITEST-F31-SEM') returning id`);
      const r = await um<{ out: { origem_modelo_id: string; novo_modelo_id: string }[] }>(
        c,
        `select public.replicar_cards_plan_tecido($1::uuid, null::uuid, array[$2::uuid, $3::uuid], null::integer) out`,
        [col.id, com.id, sem.id],
      );
      expect(r.out).toHaveLength(2);
      const novoCom = r.out.find((x) => x.origem_modelo_id === com.id)!.novo_modelo_id;
      const novoSem = r.out.find((x) => x.origem_modelo_id === sem.id)!.novo_modelo_id;
      const a = await um<{ d: string | null; b: string }>(c, `select descricao_produto d, modelo_base_id b from modelos where id = $1`, [novoCom]);
      expect(a.d).toBe(TEXTO);
      expect(a.b).toBe(com.id);
      const b = await um<{ d: string | null }>(c, `select descricao_produto d from modelos where id = $1`, [novoSem]);
      expect(b.d).toBeNull();
    });
  });

  it("inverso: recusa apagar descrições sem a confirmação; com 'sim' volta a função byte a byte e some a coluna", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await paraEstadoAnterior(c);
      const antes = await def(c);
      const aclAntes = await acl(c);
      await aplicarArquivo(c, MIG);
      await comoUsuario(c);
      await c.query(`insert into modelos (nome, descricao_produto) values ('ITEST-F31-INV', 'texto que o DROP apagaria')`);
      await expect(aplicarArquivo(c, INV)).rejects.toThrow(/Descrição do produto/);
      expect(await coluna(c)).toBeTruthy(); // o SAVEPOINT desfez só o inverso
      await c.query("SET LOCAL app.confirmo_apagar_descricao_produto = 'sim'");
      await aplicarArquivo(c, INV);
      expect(await coluna(c)).toBeUndefined();
      expect(await def(c)).toBe(antes);
      expect(await acl(c)).toBe(aclAntes);
      const p = await privs(c);
      expect(p.anon).toBe(false);
      expect(p.auth).toBe(false);
    });
  });

  it("inverso com a coluna só com espaços passa SEM confirmação (não há texto a perder)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await paraEstadoAnterior(c);
      const antes = await def(c);
      await aplicarArquivo(c, MIG);
      await comoUsuario(c);
      await c.query(`insert into modelos (nome, descricao_produto) values ('ITEST-F31-ESP', '   ')`);
      await aplicarArquivo(c, INV);
      expect(await coluna(c)).toBeUndefined();
      expect(await def(c)).toBe(antes);
    });
  });

  it("inverso sem a coluna: só recria a função (idempotente)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await paraEstadoAnterior(c);
      const antes = await def(c);
      await aplicarArquivo(c, INV);
      expect(await def(c)).toBe(antes);
      expect(await coluna(c)).toBeUndefined();
      await aplicarArquivo(c, INV);
      expect(await def(c)).toBe(antes);
    });
  });
});
