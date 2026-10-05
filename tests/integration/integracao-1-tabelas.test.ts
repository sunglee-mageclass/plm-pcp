/**
 * Integração + API — migration 1 (tabelas). Plano: docs/superpowers/plans/2026-09-26-tela-integracao-api.md, Task 1.
 * Integração em BEGIN…ROLLBACK SÓ na cópia (janela N3). Estático (formato dos arquivos) roda sem banco.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { hasDb, withTx, comoUsuario, um } from "./db";
import { CAMPOS_PADRAO, DEF, INVERSOS, LAYOUT, LOCAL, MD5_ANTES, MIGRACOES, MIG_TXN, ROOT, T, U, aplica, i3bViva, layoutVivo, ler, padraoVivo, prepara } from "./integracao-helpers";

const TABELAS = ["integracao_config", "integracao_segredo", "integracao_produtos", "integracao_linhas",
  "integracao_chaves", "integracao_acessos", "integracao_log"] as const;
/** Trecho inserido em _seed_tenant_defaults (diff mínimo — o "depois" menos ISTO é o "antes"). */
export const TRECHO_SEED =
  "\n  -- [integracao v1] Integração + API (set/2026): a config nasce com o padrão (campos do layout #1-#17 marcados, Foto\n" +
  "  -- desmarcada — P-83 A). reset_loja e a criação de loja passam por aqui (N9/n6).\n" +
  "  INSERT INTO public.integracao_config (tenant_id) VALUES (_tid)\n" +
  "  ON CONFLICT (tenant_id) DO NOTHING;\n";

/**
 * resíduos T7 #8: remove comentários SQL ('--...' até o fim da linha; '/*...*\/') e literais de string
 * ('...' com '' como escape de aspas simples) ANTES de rodar o regex de DDL perigosa — sem isso,
 * `/ENABLE\s+ALWAYS/` casa com o texto dentro de um COMENTÁRIO (ex.: "-- ... nunca ENABLE ALWAYS ...") ou de um
 * literal usado numa mensagem de RAISE (ex.: 'gatilho fora do modo padrao (nunca ENABLE ALWAYS)'), nenhum dos
 * quais é DDL de verdade. Preserva o comprimento em linhas (comentário/literal viram espaços, nunca são
 * removidos por inteiro) para não deslocar nenhuma outra asserção que dependa de números de linha.
 */
function semComentariosNemLiterais(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    // comentário de linha: -- até o fim da linha (preserva o \n)
    if (sql[i] === "-" && sql[i + 1] === "-") {
      let j = i;
      while (j < n && sql[j] !== "\n") j++;
      out += " ".repeat(j - i) + (sql[j] === "\n" ? "\n" : "");
      i = j + (sql[j] === "\n" ? 1 : 0);
      continue;
    }
    // comentário de bloco: /* ... */ (troca por espaços, preservando \n internos)
    if (sql[i] === "/" && sql[i + 1] === "*") {
      const fim = sql.indexOf("*/", i + 2);
      const j = fim === -1 ? n : fim + 2;
      for (let k = i; k < j; k++) out += sql[k] === "\n" ? "\n" : " ";
      i = j;
      continue;
    }
    // literal de string: '...' com '' como escape de aspas simples dentro do literal
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j += 1; break; }
        j++;
      }
      for (let k = i; k < j; k++) out += sql[k] === "\n" ? "\n" : " ";
      i = j;
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

describe("integracao — formato de TODOS os arquivos .sql já escritos (estático)", () => {
  const arquivos = [...MIGRACOES, ...INVERSOS].filter((rel) => existsSync(ROOT + rel));
  it("há pelo menos a migration 1", () => expect(arquivos).toContain(MIGRACOES[0]));
  for (const rel of arquivos) {
    it(`${rel}: encoding → BEGIN → 2 travas; $guarda$/$pos$; NOTIFY antes do COMMIT; sem policy`, () => {
      const t = ler(rel);
      const linhas = t.split("\n");
      const primeira = linhas.find((l) => l.trim() !== "" && !l.startsWith("--"));
      expect(primeira, rel).toBe("SET client_encoding = 'UTF8';");
      const b = linhas.indexOf("BEGIN;");
      expect(b, rel).toBeGreaterThan(0);
      expect(linhas[b - 1], rel).toBe("SET client_encoding = 'UTF8';");
      expect(linhas.slice(b + 1, b + 3), rel).toEqual(["SET LOCAL lock_timeout = '500ms';", "SET LOCAL transaction_timeout = '3s';"]);
      expect(linhas.filter((l) => l === "BEGIN;").length, rel).toBe(1);
      expect(linhas.filter((l) => l === "COMMIT;").length, rel).toBe(1);
      expect(t, rel).toContain("DO $guarda$");
      expect(t, rel).toContain("DO $pos$");
      expect(t.indexOf("NOTIFY pgrst, 'reload schema';"), rel).toBeGreaterThan(t.indexOf("DO $pos$"));
      expect(t.indexOf("NOTIFY pgrst, 'reload schema';"), rel).toBeLessThan(t.indexOf("\nCOMMIT;"));
      // resíduos T7 #8: só o SQL "de verdade" (sem comentários nem literais) é checado contra DDL perigosa —
      // ver semComentariosNemLiterais acima.
      const semRuido = semComentariosNemLiterais(t);
      expect(semRuido, rel).not.toMatch(/CREATE\s+POLICY|DROP\s+POLICY|ENABLE\s+ALWAYS|\\i\s/i);
      // N1: na IDA, gatilho comum = CREATE OR REPLACE TRIGGER (o DROP antes pegaria trava exclusiva da tabela)
      if (rel.startsWith("supabase/migrations/")) expect(t, rel).not.toMatch(/^CREATE TRIGGER /m);
    });
  }

  it("resíduos T7 #8: semComentariosNemLiterais ainda PEGA um ENABLE ALWAYS de verdade (fora de comentário/literal)", () => {
    const ddlReal = `-- comentário citando ENABLE ALWAYS (não deve contar)\nALTER TABLE public.x ENABLE ALWAYS TRIGGER y;\n`;
    const limpo = semComentariosNemLiterais(ddlReal);
    expect(limpo).toMatch(/ENABLE\s+ALWAYS/i);
    // e confirma que o comentário sozinho (sem DDL real) NÃO casa mais.
    const soComentario = semComentariosNemLiterais("-- nunca ENABLE ALWAYS — só um comentário\nSELECT 1;\n");
    expect(soComentario).not.toMatch(/ENABLE\s+ALWAYS/i);
    // e um RAISE citando a frase dentro de um literal também não casa.
    const soLiteral = semComentariosNemLiterais("RAISE EXCEPTION 'gatilho fora do padrao (nunca ENABLE ALWAYS)';\n");
    expect(soLiteral).not.toMatch(/ENABLE\s+ALWAYS/i);
  });
});

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 1 (cópia, txn revertida)", () => {
  it("7 tabelas: RLS ligada, 0 policy, sem privilegio nenhum p/ anon/authenticated", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      for (const t of TABELAS) {
        // ruling do controlador, revisão T1 #1 (Minor #3): confere TODOS os privilegios de linha/DML, não só SELECT.
        const r = await um<{ rls: boolean; pol: string; sa: boolean; sn: boolean }>(c,
          `SELECT k.relrowsecurity AS rls, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = k.oid) AS pol,
                  has_table_privilege('authenticated', k.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS sa,
                  has_table_privilege('anon', k.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS sn
             FROM pg_class k WHERE k.oid = ('public.' || $1)::regclass`, [t]);
        expect(r, t).toEqual({ rls: true, pol: "0", sa: false, sn: false });
      }
    });
  });

  it("leitura direta como authenticated é negada (REST)", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      await comoUsuario(c, U);
      await c.query("SAVEPOINT a");
      await c.query("SET LOCAL ROLE authenticated");
      await expect(c.query("SELECT * FROM public.integracao_linhas LIMIT 1")).rejects.toThrow(/permission denied/);
      await c.query("ROLLBACK TO SAVEPOINT a");
    });
  });

  it("layout = 18 chaves na ordem; config de TODAS as lojas nasce com os 17 do layout e 60/50/7/10 (P-89 A)", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      // Release I3 (20261030110000/120000): layout 21 e padrão 20 (+ Coleção / Categoria do Tecido Principal / Linha); a I3c
      // marca os 3 em toda config (rev + 1) — com a I3 na cópia o esperado é o sucessor.
      const i3 = await i3bViva(c);
      expect((await um<{ l: string[] }>(c, "SELECT public._integracao_layout() AS l")).l).toEqual([...(await layoutVivo(c))]);
      const r = await um<{ faltam: string; campos: string[]; lim: number; pag: number; foto: number; blq: number; rev: number }>(c,
        `SELECT (SELECT count(*) FROM public.tenants t WHERE NOT EXISTS (SELECT 1 FROM public.integracao_config x WHERE x.tenant_id = t.id)) AS faltam,
                c.campos, c.limite_por_minuto AS lim, c.max_por_pagina AS pag, c.validade_foto_dias AS foto, c.bloqueio_tentativas AS blq, c.rev
           FROM public.integracao_config c WHERE c.tenant_id = $1`, [T]);
      // T1 (backend, 05/out): `rev` é o contador de edições da config (sobe a cada Salvar da tela / registro 'campos'); a Loja Teste da cópia
      // já foi editada depois da migration (rev 4), então o valor exato é dado vivo. O que a migration garante é o PISO (1; com a I3c, 2) —
      // a config nunca nasce/volta abaixo dele. O restante (campos, limites, faltam) segue exato.
      const { rev, ...resto } = r;
      expect(resto).toEqual({ faltam: "0", campos: [...(await padraoVivo(c))], lim: 60, pag: 50, foto: 7, blq: 10 });
      expect(rev).toBeGreaterThanOrEqual(i3 ? 2 : 1);
      await c.query("SAVEPOINT a");
      await expect(c.query(`UPDATE public.integracao_config SET limite_por_minuto = 601 WHERE tenant_id = $1`, [T]))
        .rejects.toThrow(/integracao_config_limite_chk/);
      await c.query("ROLLBACK TO SAVEPOINT a");
      // ruling do controlador, revisão T1 #1 (Minor #4): exercita a FAIXA 1-500 do max_por_pagina (P-89 A), não só o default.
      await c.query("SAVEPOINT b");
      await expect(c.query(`UPDATE public.integracao_config SET max_por_pagina = 501 WHERE tenant_id = $1`, [T]))
        .rejects.toThrow(/integracao_config_pagina_chk/);
      await c.query("ROLLBACK TO SAVEPOINT b");
      await c.query("SAVEPOINT c");
      await expect(c.query(`UPDATE public.integracao_config SET max_por_pagina = 0 WHERE tenant_id = $1`, [T]))
        .rejects.toThrow(/integracao_config_pagina_chk/);
      await c.query("ROLLBACK TO SAVEPOINT c");
    });
  });

  it("segredo HMAC: 1 linha, 32 bytes; _integracao_layout sem EXECUTE p/ PUBLIC/anon/authenticated", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      expect((await um<{ n: string; b: number }>(c, "SELECT count(*) AS n, max(octet_length(segredo)) AS b FROM public.integracao_segredo")))
        .toEqual({ n: "1", b: 32 });
      const acl = await um<{ a: boolean; n: boolean; p: boolean }>(c,
        `SELECT has_function_privilege('authenticated', 'public._integracao_layout()', 'EXECUTE') AS a,
                has_function_privilege('anon', 'public._integracao_layout()', 'EXECUTE') AS n,
                has_function_privilege('public', 'public._integracao_layout()', 'EXECUTE') AS p`);
      expect(acl).toEqual({ a: false, n: false, p: false });
    });
  });

  it("integracao_produtos é 1:1 com modelos por TRIGGER (não UNIQUE) + índice plano", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      // ruling do controlador, revisão T1 #1 (Minor #6): não depende de dado pré-existente na cópia — cria o próprio modelo.
      const m = (await um<{ id: string }>(c,
        `INSERT INTO public.modelos (tenant_id, nome) VALUES ($1, 'Modelo teste 1:1') RETURNING id`, [T])).id;
      await c.query(`INSERT INTO public.integracao_produtos (tenant_id, modelo_id) VALUES ($1, $2)`, [T, m]);
      await c.query("SAVEPOINT a");
      await expect(c.query(`INSERT INTO public.integracao_produtos (tenant_id, modelo_id) VALUES ($1, $2)`, [T, m]))
        .rejects.toThrow(/invariante 1:1/);
      await c.query("ROLLBACK TO SAVEPOINT a");
      const idx = await um<{ n: string }>(c,
        `SELECT count(*) AS n FROM pg_indexes WHERE tablename = 'integracao_produtos' AND indexdef LIKE '%(modelo_id)%' AND indexdef NOT LIKE '%UNIQUE%'`);
      expect(idx.n).toBe("1");
    });
  });

  it.skipIf(!MIG_TXN)("_seed_tenant_defaults: depois = antes + SÓ o INSERT da config (diff mínimo)", async () => {
    await withTx(async (c) => {
      const antes = await DEF(c, "_seed_tenant_defaults(uuid)");
      expect((await um<{ m: string }>(c, "SELECT md5($1) AS m", [antes])).m).toBe(MD5_ANTES.seed);
      await prepara(c, 1);
      const depois = await DEF(c, "_seed_tenant_defaults(uuid)");
      expect(depois).toContain(TRECHO_SEED);
      expect(depois.replace(TRECHO_SEED, "")).toBe(antes);
    });
  });

  it("loja NOVA e reset_loja semeiam a config padrão (N9/n6)", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      await comoUsuario(c, U);
      const padrao = await padraoVivo(c); // Release I3: DEFAULT = _integracao_padrao() (20) quando a I3b está na cópia
      const nova = (await um<{ id: string }>(c, `INSERT INTO public.tenants (nome) VALUES ('Loja Integracao Teste') RETURNING id`)).id;
      expect((await um<{ campos: string[] }>(c, `SELECT campos FROM public.integracao_config WHERE tenant_id = $1`, [nova])).campos)
        .toEqual([...padrao]);
      await c.query(`UPDATE public.integracao_config SET campos = '{nome}' WHERE tenant_id = $1`, [nova]);
      await c.query(`SELECT public.reset_loja($1)`, [nova]);
      expect((await um<{ campos: string[] }>(c, `SELECT campos FROM public.integracao_config WHERE tenant_id = $1`, [nova])).campos)
        .toEqual([...padrao]);
    });
  });

  it.skipIf(!MIG_TXN)("inverso 1 desfaz a 1 (as 7 tabelas e a função somem; _seed volta ao md5 de antes)", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      await aplica(c, INVERSOS[0]);
      // ruling do controlador, revisão T1 #1 (Minor #5): confere as 7 tabelas (não só integracao_produtos).
      for (const t of TABELAS) {
        const r = await um<{ ok: boolean }>(c, `SELECT to_regclass('public.' || $1) IS NULL AS ok`, [t]);
        expect(r.ok, t).toBe(true);
      }
      const r = await um<{ f: boolean; m: string }>(c,
        `SELECT to_regprocedure('public._integracao_layout()') IS NULL AS f,
                md5(pg_get_functiondef('public._seed_tenant_defaults(uuid)'::regprocedure)) AS m`);
      expect(r).toEqual({ f: true, m: MD5_ANTES.seed });
    });
  });

  it.skipIf(!MIG_TXN)("inverso 1 recusa se _seed_tenant_defaults mudou por outra frente depois da migration 1", async () => {
    // ruling do controlador, revisão T1 #1 (Important #1, aprovado): simula outra frente redefinindo
    // _seed_tenant_defaults DEPOIS da migration 1 (corpo diferente, sem o TRECHO_SEED e sem bater com o "antes") —
    // o inverso deve RECUSAR (RAISE P0001 ASCII) em vez de sobrescrever essa mudança em silêncio.
    await withTx(async (c) => {
      await prepara(c, 1);
      await c.query(`
        CREATE OR REPLACE FUNCTION public._seed_tenant_defaults(_tid uuid)
         RETURNS void
         LANGUAGE plpgsql
         SECURITY DEFINER
         SET search_path TO 'public'
        AS $function$
        BEGIN
          -- [outra frente] corpo diferente, sem relação com o texto de antes nem com o TRECHO_SEED.
          INSERT INTO public.tenant_config (tenant_id) VALUES (_tid) ON CONFLICT (tenant_id) DO NOTHING;
        END;
        $function$;
      `);
      await expect(aplica(c, INVERSOS[0])).rejects.toThrow(
        /integracao_1_down: _seed_tenant_defaults mudou depois da migration 1 - refazer o inverso/,
      );
      // ASCII-only, como toda mensagem desta frente (regra global).
      const msg = await um<{ m: string }>(c,
        `SELECT 'integracao_1_down: _seed_tenant_defaults mudou depois da migration 1 - refazer o inverso' AS m`);
      expect(/^[\x00-\x7F]*$/.test(msg.m)).toBe(true);
      // as tabelas continuam existindo (a recusa aconteceu no $guarda$, antes de qualquer DROP).
      const r = await um<{ ok: boolean }>(c, `SELECT to_regclass('public.integracao_produtos') IS NOT NULL AS ok`);
      expect(r.ok).toBe(true);
    });
  });
});
