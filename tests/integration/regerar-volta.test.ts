/**
 * Botoes Regerar REF / Regerar SKUs - VOLTA (LIFO) das 3 migrations: derruba so as funcoes NOVAS (nenhum dado/tabela/gatilho), recusa fora de ordem e
 * quando o texto vivo nao e o da ida (md5). BEGIN...ROLLBACK, SO na copia local (as idas e as voltas entram DENTRO da txn por mig-txn).
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, ehBancoLocal, withTx, um } from "./db";
import { aplicarArquivo } from "./mig-txn";
import { prepara, tenta, MIGS, DOWNS } from "./regerar-helpers";

const RODA = hasDb && ehBancoLocal();
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const restantes = async (c: any) => (await um<{ n: string }>(c, "SELECT count(*)::text AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname ~ '^_?(regerar_|ref_regerar)'")).n;
const aplicaDown = async (c: any, rel: string) => {
  await c.query("SAVEPOINT volta");
  try {
    await aplicarArquivo(c, rel);
    await c.query("RELEASE SAVEPOINT volta");
    return null;
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT volta");
    await c.query("RELEASE SAVEPOINT volta");
    return String(e.message);
  }
};

describe.skipIf(!RODA)("Regerar REF / Regerar SKUs - volta LIFO das 3 migrations", () => {
  it("os 3 inversos existem em supabase/rollback", () => {
    for (const k of ["pulo", "ref", "loja"] as const) expect(existsSync(ROOT + DOWNS[k]), DOWNS[k]).toBe(true);
  });

  it("ida -> volta LIFO (120000, 110000, 100000) deixa ZERO funcoes novas; reaplicar a volta e no-op; a ida e idempotente", async () => {
    await withTx(async (c) => {
      await prepara(c, "loja");
      expect(Number(await restantes(c))).toBe(10); // 1 helper + 4 (REF) + 5 (lote)
      await prepara(c, "loja"); // reaplicar a ida: sem erro (CREATE OR REPLACE)
      expect(Number(await restantes(c))).toBe(10);
      for (const k of ["loja", "ref", "pulo"] as const) expect(await aplicaDown(c, DOWNS[k]), DOWNS[k]).toBeNull();
      expect(await restantes(c)).toBe("0");
      for (const k of ["loja", "ref", "pulo"] as const) expect(await aplicaDown(c, DOWNS[k]), `${DOWNS[k]} 2x`).toBeNull(); // no-op
    });
  });

  it("fora de ordem: o inverso do helper RECUSA enquanto 110000/120000 estiverem no banco (elas CHAMAM o helper) - nada e derrubado", async () => {
    await withTx(async (c) => {
      await prepara(c, "loja");
      const erro = await aplicaDown(c, DOWNS.pulo);
      expect(erro).toMatch(/regerar_pulo_down: ainda usado por/);
      expect(Number(await restantes(c))).toBe(10);
    });
  });

  it("guarda de md5: se alguem mexeu no texto de uma funcao nova, a volta RECUSA (nao derruba o que nao e dela)", async () => {
    await withTx(async (c) => {
      await prepara(c, "loja");
      await c.query(`CREATE OR REPLACE FUNCTION public.regerar_ref_card(_modelo_id uuid, _ref_esperada text, _confirma_manual boolean, _assinatura text)
        RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $f$ SELECT '{}'::jsonb $f$`);
      expect(await aplicaDown(c, DOWNS.loja)).toBeNull(); // o lote nao depende dela
      const erro = await aplicaDown(c, DOWNS.ref);
      expect(erro).toMatch(/regerar_ref_down: public\.regerar_ref_card.* com texto diferente do da ida/);
    });
  });

  it("a volta NAO toca dados: SKUs, REF e audit_log gravados pelas RPCs continuam depois (so as funcoes saem)", async () => {
    await withTx(async (c) => {
      await prepara(c, "loja");
      const antes = await um<{ n: string }>(c, "SELECT count(*)::text AS n FROM public.modelo_skus");
      for (const k of ["loja", "ref", "pulo"] as const) await aplicaDown(c, DOWNS[k]);
      expect((await um<{ n: string }>(c, "SELECT count(*)::text AS n FROM public.modelo_skus")).n).toBe(antes.n);
      expect(existsSync(ROOT + MIGS.pulo)).toBe(true);
      const r = await tenta(c, "SELECT to_regprocedure('public.regerar_ref_card(uuid,text,boolean,text)') IS NULL AS nulo");
      expect(r.ok && r.rows[0].nulo).toBe(true);
    });
  });
});
