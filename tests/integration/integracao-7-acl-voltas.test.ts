/** Integração + API — ACL, ASCII por comando e round-trip ida/volta. Plano Task 7. Só na cópia (N3), txn revertida. */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um } from "./db";
import { INVERSOS, LOCAL, MD5_ANTES, MIGRACOES, MIG_TXN, U, aplica, prepara } from "./integracao-helpers";

const INTERNAS_PREFIXO = "_integracao_";
const RPCS = ["integracao_previa", "integracao_listar", "integracao_estado_modelos", "integracao_config_ler", "integracao_marcar",
  "integracao_voltar", "integracao_desfazer", "integracao_log_listar", "salvar_precos_fixo_produto_importado", "integracao_salvar",
  "integracao_salvar_config", "integracao_salvar_config_api", "integracao_chaves_listar", "integracao_chave_criar",
  "integracao_chave_revogar", "integracao_acessos_listar", "integracao_exemplo"];
const ROTA = ["_integracao_ler", "_integracao_confirmar", "_integracao_limpar"];
async function retratoBanco(c: Client) {
  return um<{ f: string; g: string; t: string; md5: string; tgmd5: string }>(c,
    `SELECT (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) AS f,
            (SELECT count(*) FROM pg_trigger t JOIN pg_class k ON k.oid = t.tgrelid WHERE k.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal) AS g,
            (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'integracao\\_%' AND relkind = 'r') AS t,
            (SELECT string_agg(md5(pg_get_functiondef(p.oid)), '|' ORDER BY p.proname) FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('_imp_recomputar_precos_modelo','_pa_recomputar_precos_modelo',
                '_salvar_produto_importado_core','_seed_tenant_defaults')) AS md5,
            -- ruling do controlador, revisão T7 #11 (fix round 1, Minor 5): md5 de TODOS os gatilhos não-internos de
            -- public — inclui os 2 REDEFINIDOS por esta frente (trg_sync_foto_modelo_acabado/_importado, m4:314-321,
            -- que já existiam antes) e não só os NOVOS. Sem isso, o round-trip 2× provava a CONTAGEM de gatilhos
            -- (g) mas não que a DEFINIÇÃO de um gatilho redefinido volta byte-a-byte ao estado de antes/depois.
            -- ORDER BY t.tgname sozinho empata quando o MESMO nome de gatilho existe em tabelas diferentes
            -- (ex.: trg_espelho_modelo_nome_ref em produtos_acabados E produtos_importados) — tgname NÃO é
            -- único por si (a chave real é (tgrelid, tgname)); k.relname como desempate torna a ordem estável.
            (SELECT string_agg(md5(pg_get_triggerdef(t.oid)), '|' ORDER BY t.tgname, k.relname) FROM pg_trigger t
              JOIN pg_class k ON k.oid = t.tgrelid WHERE k.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal) AS tgmd5`);
}
const MD5_4_ANTES = [MD5_ANTES.imp, MD5_ANTES.pa, MD5_ANTES.impCore, MD5_ANTES.seed].join("|");

describe.skipIf(!hasDb || !LOCAL)("integracao — ACL, ASCII e voltas", () => {
  // ruling do controlador, revisão T7 #11 (fix round 1, Minor 5): retitulado para reivindicar só o que a query
  // prova. Na cópia, o pg_default_acl de postgres/supabase_admin concede EXECUTE em função NOVA de public a anon/
  // authenticated/service_role — então "rota_auth=17"/"rota=3" valem MESMO sem os GRANTs explícitos das migrations
  // (só provam que as 17 RPCs/3 rotas EXISTEM, não que a ACL as fecha do lado errado). O título antigo ("RPCs só
  // authenticated; rota só service_role") sugeria uma exclusividade que esta query não checa (não há proacl aqui
  // provando que NENHUMA outra função interna tem GRANT direto a service_role — isso não tem impacto de segurança,
  // já que service_role é a chave do servidor, plenamente privilegiada, e o plano não exige revogar dela).
  it("ACL #9: internas fechadas p/ PUBLIC/anon/authenticated; RPCs não executáveis por anon e executáveis por authenticated; rota executável por service_role", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      const r = await um<{ internas: string; rpc_anon: string; rpc_auth: string; rota: string; total: string }>(c,
        `SELECT
           (SELECT count(*) FROM pg_proc p CROSS JOIN (VALUES ('public'), ('anon'), ('authenticated')) r(y)
             WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE '\\_integracao\\_%' OR p.proname = '_salvar_precos_fixo_produto_importado_core')
               AND has_function_privilege(r.y, p.oid, 'EXECUTE')) AS internas,
           (SELECT count(*) FROM pg_proc p CROSS JOIN (VALUES ('public'), ('anon')) r(y)
             WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1::text[]) AND has_function_privilege(r.y, p.oid, 'EXECUTE')) AS rpc_anon,
           (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1::text[])
               AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS rpc_auth,
           (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($2::text[])
               AND has_function_privilege('service_role', p.oid, 'EXECUTE')) AS rota,
           (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE '\\_integracao\\_%'
               OR p.proname LIKE 'integracao\\_%' OR p.proname LIKE 'fn\\_integracao\\_%' OR p.proname IN ('fn_modelo_espelho_nome_ref',
               'fn_espelho_modelo_nome_ref', 'salvar_precos_fixo_produto_importado', '_salvar_precos_fixo_produto_importado_core'))) AS total`,
        [RPCS, ROTA]);
      expect(r).toEqual({ internas: "0", rpc_anon: "0", rpc_auth: String(RPCS.length), rota: "3", total: "46" });
    });
  });

  it("toda mensagem de RAISE … P0409 desta frente é ASCII (por COMANDO, regex com \\y); nenhum P0002", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      const r = await c.query(
        `SELECT p.proname, m[1] AS msg
           FROM pg_proc p, regexp_matches(pg_get_functiondef(p.oid), 'RAISE\\s+EXCEPTION\\s+''([^'']*)''[^;]*\\yP0409\\y', 'gi') AS m
          WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE '%integracao%')`);
      expect(r.rows.length).toBeGreaterThanOrEqual(7);
      for (const row of r.rows) expect(/^[\x20-\x7E]*$/.test(row.msg), `${row.proname}: ${row.msg}`).toBe(true);
      const p2 = await um<{ n: string }>(c,
        `SELECT count(*) AS n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE '%integracao%'
            AND pg_get_functiondef(p.oid) ~* '\\yP0002\\y'`);
      expect(p2.n).toBe("0");
    });
  });

  it("as 7 tabelas negam leitura a authenticated (mesmo com permissão integracao) e a anon", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuario(c, U);
      for (const t of ["integracao_config", "integracao_segredo", "integracao_produtos", "integracao_linhas", "integracao_chaves",
        "integracao_acessos", "integracao_log"]) {
        for (const role of ["authenticated", "anon"]) {
          await c.query("SAVEPOINT r");
          await c.query(`SET LOCAL ROLE ${role}`);
          await expect(c.query(`SELECT 1 FROM public.${t} LIMIT 1`), `${role} ${t}`).rejects.toThrow(/permission denied/);
          await c.query("ROLLBACK TO SAVEPOINT r");
        }
      }
    });
  });

  it.skipIf(!MIG_TXN)("round-trip: ida 1→6 (2×, idempotente) e volta 6→1 (2×) devolvem a cópia ao retrato de ANTES", async () => {
    await withTx(async (c) => {
      // o retrato "antes" é lido ANTES de aplicar; `aplica` chama exigeBancoLocal() (só a cópia)
      await c.query("SET LOCAL lock_timeout = '3s'");
      await c.query("SET LOCAL statement_timeout = '180s'");
      const antes = await retratoBanco(c);
      expect(antes.t).toBe("0");
      expect(antes.md5).toBe(MD5_4_ANTES);
      for (const rel of MIGRACOES) await aplica(c, rel);
      const ida1 = await retratoBanco(c);
      expect(Number(ida1.f) - Number(antes.f)).toBe(46);
      // ruling do controlador, G-migration fix 2 #H1: 13 -> 14 (+trg_pi_modelo_tenant, reusa
      // enforce_produto_acabado_modelo_tenant — função pré-existente, sem função nova).
      expect(Number(ida1.g) - Number(antes.g)).toBe(14);
      expect(ida1.t).toBe("7");
      for (const rel of MIGRACOES) await aplica(c, rel); // 2ª ida: idempotente (guardas aceitam o texto novo)
      expect(await retratoBanco(c)).toEqual(ida1);
      for (const rel of [...INVERSOS].reverse()) await aplica(c, rel);
      expect(await retratoBanco(c)).toEqual(antes);
      for (const rel of MIGRACOES) await aplica(c, rel);
      expect(await retratoBanco(c)).toEqual(ida1);
      for (const rel of [...INVERSOS].reverse()) await aplica(c, rel);
      expect(await retratoBanco(c)).toEqual(antes);
    });
  });
});
