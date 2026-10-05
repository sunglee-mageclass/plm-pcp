/**
 * Mensagens ASCII em RAISE mapeado para 5xx pelo PostgREST (P-58 A / P-59 A do dono, plano
 * docs/superpowers/plans/2026-09-25-sku-previa-regerar.md, Task 7a). BEGIN…ROLLBACK: nada grava.
 *
 * ⚠️ SÓ NA CÓPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). Em outro banco os
 * blocos de banco PULAM; com SKU_ASCII_MIG_TXN=1 fora da cópia a suíte RECUSA já na coleta (exigeBancoLocal()).
 * 3 modos (R3 do ADENDO G-plano da Task 7):
 *  (i)   SKU_ASCII_MIG_TXN=1 + cópia SEM a migration desta frente — aplica na txn de cada teste e roda (a)–(e);
 *  (ii)  cópia COM a migration desta frente (viva) — roda (b)(c)(d) contra o vivo;
 *  (iii) env desligada + cópia sem a migration — os blocos de banco PULAM (não falham).
 * O bloco estático não usa banco: roda sempre.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { hasDb, dbUrl, withTx, comoUsuario, semUsuario, um, ehBancoLocal } from "./db";
import { aplicarSql, exigeBancoLocal } from "./mig-txn";
import { CAMADA_MD5 } from "./camada-1-dados";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261006120000_sku_previa_mensagens_ascii.sql";
const INV = "supabase/rollback/20261006120000_sku_previa_mensagens_ascii_down.sql";
const LOCAL = ehBancoLocal();
const MIG_TXN = process.env.SKU_ASCII_MIG_TXN === "1";
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
// As 4 funções do escopo (P-59 A) — ordem FIXA = md5-antes.txt/md5-depois.txt do gerador e o $pos$/guarda do arquivo.
const FNS = [
  { fn: "public._aplicar_skus_modelo_core(uuid,jsonb,text,text)", cria: "CREATE OR REPLACE FUNCTION public._aplicar_skus_modelo_core(", nP0409: 3 },
  { fn: "public._skus_executar_plano(uuid,uuid,jsonb,boolean)", cria: "CREATE OR REPLACE FUNCTION public._skus_executar_plano(", nP0409: 4 },
  { fn: "public.salvar_terceirizados(uuid,jsonb,text,jsonb)", cria: "CREATE OR REPLACE FUNCTION public.salvar_terceirizados(", nP0409: 1 },
  { fn: "public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)", cria: "CREATE OR REPLACE FUNCTION public._salvar_cq_core(", nP0409: 2 },
];
// Os 7 literais exatos (P-58 A / P-59 A) — [de, para], por função.
const LITERAIS: Record<string, [string, string][]> = {
  "public._aplicar_skus_modelo_core(uuid,jsonb,text,text)": [
    ["previa_desatualizada: os SKUs mudaram desde a prévia", "previa_desatualizada: os SKUs mudaram desde a previa"],
    ["previa_desatualizada: o gravado não bateu com a prévia — nada foi gravado", "previa_desatualizada: o gravado nao bateu com a previa - nada foi gravado"],
  ],
  "public._skus_executar_plano(uuid,uuid,jsonb,boolean)": [
    ["previa_desatualizada: o SKU % foi gravado em outra linha depois da prévia", "previa_desatualizada: o SKU % foi gravado em outra linha depois da previa"],
    ["previa_desatualizada: um SKU que mudaria já não está como na prévia", "previa_desatualizada: um SKU que mudaria ja nao esta como na previa"],
    ["previa_desatualizada: um SKU que sairia já não está gravado", "previa_desatualizada: um SKU que sairia ja nao esta gravado"],
  ],
  "public.salvar_terceirizados(uuid,jsonb,text,jsonb)": [
    ["conflito_versao: um serviço foi salvo por outra pessoa", "conflito_versao: um servico foi salvo por outra pessoa"],
  ],
  "public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)": [
    ["conflito_versao: a grade do serviço-fonte foi salva por outra pessoa", "conflito_versao: a grade do servico-fonte foi salva por outra pessoa"],
  ],
};
/** Todo comando 'RAISE ... ;' (do RAISE ao ';', sem comentários --) que contém P0409 — R2 do G-plano: por COMANDO. */
function comandosP0409(texto: string): string[] {
  const semComentarios = texto.replace(/--[^\n]*/g, "");
  const cmds = semComentarios.match(/RAISE\s+EXCEPTION\b[\s\S]*?;/g) ?? [];
  return cmds.filter((c) => c.includes("P0409"));
}
const ehAscii = (s: string) => [...s].every((ch) => ch.codePointAt(0)! < 128);

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
const VIVA = await naCopia(
  "select md5(pg_get_functiondef('public._aplicar_skus_modelo_core(uuid,jsonb,text,text)'::regprocedure)) = 'fd7ac0cf1b778711ac2098d41e16ead6' as ok",
);
const BASE_OK = await naCopia("select to_regprocedure('public.skus_previa(uuid,text,text,jsonb,text)') is not null as ok");
const PRONTO = hasDb && LOCAL && (MIG_TXN ? BASE_OK : VIVA);
/** (i): precisa das 4 funções de ANTES na cópia (a migration ainda não aplicada de forma permanente). */
const PRONTO_ANTES = hasDb && LOCAL && MIG_TXN && BASE_OK && !VIVA;

async function prepara(c: Client, o: { aplicar?: boolean } = {}): Promise<void> {
  exigeBancoLocal();
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '60s'");
  if (MIG_TXN && o.aplicar !== false) await aplicarSql(c, ler(MIG), MIG);
}
async function def(c: Client, fn: string): Promise<string> {
  return (await um<{ d: string }>(c, "SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [fn])).d;
}
async function acl(c: Client, fn: string): Promise<{ acl: string; owner: string; vol: string; secdef: boolean; config: string[] | null }> {
  return um<any>(
    c,
    `SELECT proacl::text AS acl, proowner::regrole::text AS owner, provolatile AS vol, prosecdef AS secdef, proconfig AS config
       FROM pg_proc WHERE oid = $1::regprocedure`,
    [fn],
  );
}
/** Um `pg.Client` não suporta queries concorrentes (deprecation warning) — roda em SÉRIE, nunca Promise.all. */
async function todas<T>(itens: typeof FNS, fn: (f: (typeof FNS)[number]) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (const it of itens) out.push(await fn(it));
  return out;
}
/** Roda e ESPERA erro; volta ao savepoint (a txn segue usável). */
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT ascii_falha");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT ascii_falha");
    const err = e as { code?: string; message?: string };
    return { code: String(err.code ?? ""), message: String(err.message ?? "") };
  }
  await c.query("RELEASE SAVEPOINT ascii_falha");
  throw new Error(`esperava erro e passou: ${sql}`);
}

describe("SKU/PCP/CQ — mensagens ASCII: arquivos da migration (estático, sem banco)", () => {
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
      const semCorpos = t.replace(/--[^\n]*/g, "").replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "");
      expect(semCorpos, rel).not.toMatch(/\b(ALTER|CREATE|DROP)\s+(TABLE|POLICY|TRIGGER|INDEX)\b/i);
      expect(semCorpos, rel).not.toMatch(/\bCOMMENT\s+ON\b|\bINSERT\s+INTO\b|\bUPDATE\s+public\.|\bDELETE\s+FROM\b/i);
    }
  });

  it("(a) diff antes×depois = EXATAMENTE os 7 literais da tabela, nada mais (a migration muda; o inverso desfaz)", () => {
    for (const f of FNS) {
      const antesTxt = corpo(INV, f.cria);
      const depoisTxt = corpo(MIG, f.cria);
      let reconstituido = antesTxt;
      for (const [de, para] of LITERAIS[f.fn]) {
        expect(reconstituido.split(de).length - 1, `${f.fn}: '${de}'`).toBe(1);
        reconstituido = reconstituido.split(de).join(para);
      }
      expect(depoisTxt, f.fn).toBe(reconstituido);
      // fora dos literais trocados, nada mais difere: reaplicar os literais NOVOS→VELHOS no depois volta ao antes.
      let devolta = depoisTxt;
      for (const [de, para] of LITERAIS[f.fn]) devolta = devolta.split(para).join(de);
      expect(devolta, f.fn).toBe(antesTxt);
    }
  });

  it("(b) toda linha (comando RAISE) com P0409 nas 4 funções é ASCII DEPOIS; contagem = a esperada (3+4+1+2=10, R2)", () => {
    let total = 0;
    for (const f of FNS) {
      const cmds = comandosP0409(corpo(MIG, f.cria));
      expect(cmds.length, f.fn).toBe(f.nP0409);
      total += cmds.length;
      for (const c of cmds) expect(ehAscii(c), `${f.fn}: ${c}`).toBe(true);
    }
    expect(total).toBe(10);
  });

  it("o INVERSO não é ASCII nos 7 literais (prova de que o teste (b) não é vácuo — o antes tem acento onde esperado)", () => {
    let comAcento = 0;
    for (const f of FNS) {
      for (const c of comandosP0409(corpo(INV, f.cria))) if (!ehAscii(c)) comAcento++;
    }
    expect(comAcento).toBe(7); // as 5 do SKU + as 2 do PCP/CQ
  });

  it("guarda md5 aceita {antes, depois} nas 4 (idempotente); $pos$ confere o md5 esperado", () => {
    for (const rel of [MIG, INV]) {
      const t = ler(rel);
      const bloco = t.slice(t.indexOf("DO $guarda$"), t.indexOf("$guarda$;"));
      const pares = [...bloco.matchAll(/v_md5 NOT IN \('([0-9a-f]{32})', '([0-9a-f]{32})'\)/g)].map((m) => ({ antes: m[1], depois: m[2] }));
      expect(pares.length, rel).toBe(4);
      FNS.forEach((f, i) => {
        expect(pares[i].antes, `${rel} ${f.fn} antes`).toBe(md5(corpo(INV, f.cria)));
        expect(pares[i].depois, `${rel} ${f.fn} depois`).toBe(md5(corpo(MIG, f.cria)));
      });
      const pos = t.slice(t.indexOf("DO $pos$"), t.lastIndexOf("$pos$;"));
      const posMd5 = [...pos.matchAll(/v_md5 IS DISTINCT FROM '([0-9a-f]{32})'/g)].map((m) => m[1]);
      expect(posMd5.length, rel).toBe(4);
      const esperado = rel === MIG ? FNS.map((f) => md5(corpo(MIG, f.cria))) : FNS.map((f) => md5(corpo(INV, f.cria)));
      expect(posMd5, rel).toEqual(esperado);
    }
  });

  it("nada além dos 4 CREATE OR REPLACE muda: nenhuma assinatura/RETURNS/LANGUAGE/DEFINER/search_path diferente entre antes e depois", () => {
    for (const f of FNS) {
      const antesCab = corpo(INV, f.cria).split("AS $function$\n")[0];
      const depoisCab = corpo(MIG, f.cria).split("AS $function$\n")[0];
      expect(depoisCab, f.fn).toBe(antesCab);
    }
  });

  // G-migration rodada 1 (achado 1, os 3 revisores): o $ascii$ original era VÁCUO (\b = BACKSPACE no ARE do
  // Postgres, não fronteira de palavra) — o regex corrigido é \y[^;]*; e o bloco SÓ vai na ida. O inverso RESTAURA
  // os 7 literais acentuados de propósito (volta de emergência); um $ascii$ ali recusaria SEMPRE a própria volta.
  it("$ascii$: regex corrigido (\\y[^;]*;, não \\b.*?;); o bloco existe SÓ na migration, NUNCA no inverso", () => {
    const mig = ler(MIG);
    expect(mig).toContain("RAISE\\s+EXCEPTION\\y[^;]*;");
    expect(mig).not.toContain("RAISE\\s+EXCEPTION\\b.*?;"); // a forma antiga, provada inerte pelos 3 revisores
    expect(mig).toContain("DO $ascii$");
    const inv = ler(INV);
    expect(inv).not.toContain("DO $ascii$");
    expect(inv).not.toContain("RAISE\\s+EXCEPTION\\y[^;]*;");
  });

  it("$ascii$: afirma a contagem esperada por função (3|4|1|2) — não pode ficar vazio por construção", () => {
    const mig = ler(MIG);
    const bloco = mig.slice(mig.indexOf("DO $ascii$"), mig.indexOf("$ascii$;"));
    const pares = [...bloco.matchAll(/'(public\.[^']+)', (\d+)\)/g)].map((m) => [m[1], Number(m[2])] as const);
    expect(pares).toEqual(FNS.map((f) => [f.fn, f.nP0409] as const));
    expect(bloco).toContain("o cheque ASCII (R2) não pode ficar vazio");
  });
});

describe.skipIf(!PRONTO)("SKU/PCP/CQ — mensagens ASCII: comportamento e ACL na cópia", () => {
  it("(c) chamada com assinatura velha em _aplicar_skus_modelo_core ⇒ SQLSTATE P0409 e mensagem ASCII", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const m = (
        await um<{ id: string }>(
          c,
          `INSERT INTO public.modelos (tenant_id, nome, origem, tamanho_tipo)
           VALUES ('37889b78-fffb-404b-8c75-18b7e50a1d9b', 'ASCII-T', 'interno', 'numero') RETURNING id`,
        )
      ).id;
      const r = await falha(c, "SELECT public.aplicar_skus_modelo($1::uuid, '[]'::jsonb, 'regerar', $2::text) AS v", [m, null]);
      expect(r).toEqual({ code: "P0409", message: "previa_desatualizada: os SKUs mudaram desde a previa" });
    });
  });

  it("(d) ACL/SECURITY/owner/config/volatilidade das 4 iguais nos dois lados do CREATE OR REPLACE (invariante #9)", async () => {
    await withTx(async (c) => {
      await prepara(c, { aplicar: false });
      const antesInfo = await todas(FNS, (f) => acl(c, f.fn));
      await prepara(c, { aplicar: true });
      const depoisInfo = await todas(FNS, (f) => acl(c, f.fn));
      FNS.forEach((f, i) => expect(depoisInfo[i], f.fn).toEqual(antesInfo[i]));
      // esperado literal (o que a suíte anterior/dump já registrou): internas fechadas p/ PUBLIC/anon/authenticated;
      // salvar_terceirizados é RPC (authenticated tem EXECUTE).
      const esperadoAcl = [
        "{postgres=X/postgres,service_role=X/postgres}",
        "{postgres=X/postgres,service_role=X/postgres}",
        "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
        "{postgres=X/postgres,service_role=X/postgres}",
      ];
      FNS.forEach((f, i) => expect(depoisInfo[i].acl, f.fn).toBe(esperadoAcl[i]));
    });
  });

  it("(b) contra o VIVO/na txn aplicada: todo comando RAISE...P0409 das 4 funções é ASCII (espelha o estático)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const f of FNS) {
        const texto = await def(c, f.fn);
        const cmds = comandosP0409(texto);
        // Camada C1 viva (follow-up I2/M1/I3): salvar_terceirizados ganha 3 RAISE P0409 (bloco removido, contagem do apagar tudo,
        // observacao do molde) — todos ASCII, conferidos no laço abaixo.
        const c1Viva = createHash("md5").update(texto, "utf8").digest("hex") === CAMADA_MD5[f.fn]?.depois;
        expect(cmds.length, f.fn).toBe(f.nP0409 + (c1Viva ? 3 : 0));
        for (const cmd of cmds) expect(ehAscii(cmd), `${f.fn}: ${cmd}`).toBe(true);
      }
    });
  });
});

describe.skipIf(!PRONTO_ANTES)("SKU/PCP/CQ — mensagens ASCII: $ascii$ NÃO é vácuo (G-migration rodada 1, achado 1)", () => {
  /** O bloco DO $ascii$ EXATO do arquivo da migration, extraído (do "DO $ascii$" ao "$ascii$;" inclusive). */
  function blocoAsciiDaMigration(): string {
    const t = ler(MIG);
    const i = t.indexOf("DO $ascii$");
    const f = t.indexOf("$ascii$;", i) + "$ascii$;".length;
    if (i < 0 || f < 0) throw new Error("DO $ascii$ não achado na migration");
    return t.slice(i, f);
  }

  it("rodado contra o estado ANTES (acentuado, o de hoje na cópia) ⇒ DISPARA 'fora de ASCII'", async () => {
    await withTx(async (c) => {
      await prepara(c, { aplicar: false }); // as 4 funções seguem no texto VIVO (acentuado)
      const antes = await todas(FNS, (f) => def(c, f.fn));
      const erro = await falha(c, blocoAsciiDaMigration());
      expect(erro.message).toMatch(/fora de ASCII/);
      // nada mudou (o $ascii$ é só leitura via pg_get_functiondef; não grava)
      for (const [i, f] of FNS.entries()) expect(await def(c, f.fn), f.fn).toBe(antes[i]);
    });
  });

  it("rodado contra o estado DEPOIS (ASCII, dentro da txn após aplicar a migration) ⇒ PASSA sem erro", async () => {
    await withTx(async (c) => {
      await prepara(c); // aplica a migration nesta txn (MIG_TXN=1) — as 4 ficam no texto ASCII
      await c.query(blocoAsciiDaMigration()); // não deve lançar
    });
  });

  it("o inverso NÃO contém DO $ascii$ (estático, redundante de propósito — prova negativa direta no arquivo aplicado)", async () => {
    await withTx(async (c) => {
      await prepara(c); // aplica a migration (estado ASCII)
      await aplicarSql(c, ler(INV), INV); // volta ao acentuado — se o inverso tivesse $ascii$, isto teria de falhar
      const depoisDaVolta = await todas(FNS, (f) => def(c, f.fn));
      FNS.forEach((f, i) => expect(depoisDaVolta[i], f.fn).toBe(corpo(INV, f.cria))); // acentuado, restaurado com sucesso
    });
  });
});

describe.skipIf(!PRONTO_ANTES)("SKU/PCP/CQ — mensagens ASCII: (e) inverso (round-trip) e idempotência", () => {
  it("aplicar 2× não dá erro; o inverso devolve as 4 ao texto de antes (com acento) byte a byte; ACL igual", async () => {
    await withTx(async (c) => {
      await prepara(c, { aplicar: false });
      const antesTexto = await todas(FNS, (f) => def(c, f.fn));
      FNS.forEach((f, i) => expect(antesTexto[i], f.fn).toBe(corpo(INV, f.cria)));
      const antesAcl = await todas(FNS, (f) => acl(c, f.fn));

      await aplicarSql(c, ler(MIG), MIG);
      await aplicarSql(c, ler(MIG), MIG); // idempotente
      for (const f of FNS) expect(await def(c, f.fn), f.fn).toBe(corpo(MIG, f.cria));

      await aplicarSql(c, ler(INV), INV);
      for (const [i, f] of FNS.entries()) {
        expect(await def(c, f.fn), f.fn).toBe(antesTexto[i]);
        expect(await acl(c, f.fn), f.fn).toEqual(antesAcl[i]);
      }
      await aplicarSql(c, ler(INV), INV); // inverso idempotente
      for (const [i, f] of FNS.entries()) expect(await def(c, f.fn), f.fn).toBe(antesTexto[i]);

      await aplicarSql(c, ler(MIG), MIG);
      for (const f of FNS) expect(await def(c, f.fn), f.fn).toBe(corpo(MIG, f.cria));
    });
  });

  it("guarda de entrada RECUSA (e nada fica) se uma das 4 tem OUTRO texto (nem antes nem depois desta migration)", async () => {
    await withTx(async (c) => {
      await prepara(c, { aplicar: false });
      // adultera _aplicar_skus_modelo_core com um texto que não é nem o de antes nem o de depois
      await c.query(`
        CREATE OR REPLACE FUNCTION public._aplicar_skus_modelo_core(_modelo_id uuid, _manuais jsonb, _modo text, _assinatura text)
         RETURNS jsonb
         LANGUAGE plpgsql
         SECURITY DEFINER
         SET search_path TO 'public'
        AS $function$
        BEGIN
          RETURN '{}'::jsonb;
        END
        $function$
      `);
      const antesAdulterado = await def(c, FNS[0].fn);
      await expect(aplicarSql(c, ler(MIG), MIG)).rejects.toThrow(/nao esta nem no texto de antes nem no de depois/);
      expect(await def(c, FNS[0].fn)).toBe(antesAdulterado); // nada mudou
    });
  });
});
