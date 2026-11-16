/**
 * Botoes Regerar REF / Regerar SKUs - helper compartilhado _regerar_pulo_integracao (Review Focus 2: UMA decisao de "pular" para a Parte A e a B).
 * BEGIN...ROLLBACK, SO na copia local (as migrations entram DENTRO da txn por mig-txn - nunca \i).
 */
import { describe, it, expect } from "vitest";
import { hasDb, ehBancoLocal, withTx, um } from "./db";
import { prepara, produto, rpc, integracao, logIntegracao, linhaIntegracao } from "./regerar-helpers";

const RODA = hasDb && ehBancoLocal();
const pulo = (c: any, m: string) => rpc(c, "public._regerar_pulo_integracao($1::uuid)", [m]);

describe.skipIf(!RODA)("_regerar_pulo_integracao - decisao unica de pular", () => {
  it("produto livre (sem estado, sem rastro) = NULL: pode regerar", async () => {
    await withTx(async (c) => {
      await prepara(c, "pulo");
      const k = await produto(c);
      expect(await pulo(c, k.m)).toBeNull();
      await integracao(c, k.m, { estado: "nao_integravel" });
      expect(await pulo(c, k.m)).toBeNull(); // linha 'nao_integravel' sem rastro nenhum continua livre
    });
  });

  it("integravel e integrado = 'integracao' - com OU sem o campo ref_sku marcado (o SKU trava SEMPRE nesse estado)", async () => {
    await withTx(async (c) => {
      await prepara(c, "pulo");
      const semCampo = await produto(c);
      const comCampo = await produto(c);
      const integrado = await produto(c);
      await integracao(c, semCampo.m, { estado: "integravel", campos: [] });
      await integracao(c, comCampo.m, { estado: "integravel", campos: ["ref_sku"] });
      await integracao(c, integrado.m, { estado: "integrado", campos: ["nome"], integradoEm: true });
      expect(await pulo(c, semCampo.m)).toBe("integracao");
      expect(await pulo(c, comCampo.m)).toBe("integracao");
      expect(await pulo(c, integrado.m)).toBe("integracao");
    });
  });

  it("'ja_exportado': integrado_em/desfeito_em, log 'integrado'/'desfazer' e linha do espelho - mesmo depois de 'Desfazer' (estado volta a nao_integravel)", async () => {
    await withTx(async (c) => {
      await prepara(c, "pulo");
      const desfeito = await produto(c);
      const integradoEm = await produto(c);
      const logIntegrado = await produto(c);
      const logDesfazer = await produto(c);
      const soLinha = await produto(c);
      await integracao(c, desfeito.m, { estado: "nao_integravel", desfeitoEm: true });
      await integracao(c, integradoEm.m, { estado: "nao_integravel", integradoEm: true });
      await logIntegracao(c, logIntegrado.m, "integrado");
      await logIntegracao(c, logDesfazer.m, "desfazer");
      await linhaIntegracao(c, soLinha.m);
      for (const k of [desfeito, integradoEm, logIntegrado, logDesfazer, soLinha]) expect(await pulo(c, k.m), k.m).toBe("ja_exportado");
    });
  });

  it("so MARCAR/VOLTAR no log (acoes 'integrar'/'voltar') nao e exportar: continua livre", async () => {
    await withTx(async (c) => {
      await prepara(c, "pulo");
      const k = await produto(c);
      await logIntegracao(c, k.m, "integrar");
      await logIntegracao(c, k.m, "voltar");
      expect(await pulo(c, k.m)).toBeNull();
    });
  });

  it("precedencia: integravel + rastro de exportacao = 'integracao' (o estado vivo vence)", async () => {
    await withTx(async (c) => {
      await prepara(c, "pulo");
      const k = await produto(c);
      await integracao(c, k.m, { estado: "integravel", desfeitoEm: true });
      await linhaIntegracao(c, k.m);
      expect(await pulo(c, k.m)).toBe("integracao");
    });
  });

  it("ACL: SEM EXECUTE para PUBLIC/anon/authenticated (so postgres/service_role)", async () => {
    await withTx(async (c) => {
      await prepara(c, "pulo");
      const r = await um<{ anon: boolean; auth: boolean; pub: boolean }>(
        c,
        `SELECT has_function_privilege('anon', 'public._regerar_pulo_integracao(uuid)', 'EXECUTE') AS anon,
                has_function_privilege('authenticated', 'public._regerar_pulo_integracao(uuid)', 'EXECUTE') AS auth,
                EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         WHERE p.proname = '_regerar_pulo_integracao' AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS pub`,
      );
      expect(r).toEqual({ anon: false, auth: false, pub: false });
    });
  });

  it("a migration e idempotente (reaplicar nao muda o texto da funcao)", async () => {
    await withTx(async (c) => {
      await prepara(c, "pulo");
      const md5 = () => um<{ m: string }>(c, "SELECT md5(pg_get_functiondef('public._regerar_pulo_integracao(uuid)'::regprocedure)) AS m").then((x) => x.m);
      const a = await md5();
      await prepara(c, "pulo");
      expect(await md5()).toBe(a);
    });
  });
});
