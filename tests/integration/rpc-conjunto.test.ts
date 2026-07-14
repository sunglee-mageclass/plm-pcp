import { describe, it, expect } from "vitest";
import { withTx, comoUsuario, um, hasDb, TENANT_TESTE } from "./db";

const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979"; // outro tenant (cross-tenant)

async function novoModelo(c: any, tenant = TENANT_TESTE): Promise<string> {
  // set_tenant_id_trg (BEFORE INSERT em modelos) força o tenant do CHAMADOR (TENANT_TESTE),
  // ignorando um tenant_id explícito no insert. Para o caso cross-tenant, corrigimos por
  // UPDATE (não há trigger de tenant no UPDATE de modelos).
  const r = await um<{ id: string }>(c, `insert into modelos(nome) values ('ITEST conj') returning id`, []);
  if (tenant !== TENANT_TESTE) {
    await c.query(`update modelos set tenant_id=$1 where id=$2`, [tenant, r.id]);
  }
  return r.id;
}
const conj = (c: any, id: string) =>
  um<{ conjunto_id: string | null }>(c, `select conjunto_id from modelos where id=$1`, [id]).then((r) => r.conjunto_id);

describe.skipIf(!hasDb)("RPC conjunto — agrupar/mover/dissolver", () => {
  it("adiciona B a A cria o conjunto e junta os dois", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const a = await novoModelo(c), b = await novoModelo(c);
      await c.query(`select conjunto_adicionar($1,$2)`, [a, b]);
      const ca = await conj(c, a), cb = await conj(c, b);
      expect(ca).not.toBeNull();
      expect(cb).toBe(ca);
    });
  });

  it("adicionar um terceiro junta os três", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const a = await novoModelo(c), b = await novoModelo(c), cc = await novoModelo(c);
      await c.query(`select conjunto_adicionar($1,$2)`, [a, b]);
      await c.query(`select conjunto_adicionar($1,$2)`, [a, cc]);
      const ca = await conj(c, a);
      expect(await conj(c, b)).toBe(ca);
      expect(await conj(c, cc)).toBe(ca);
    });
  });

  it("mover B p/ outro conjunto dissolve o antigo que ficou com 1", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const a = await novoModelo(c), b = await novoModelo(c), d = await novoModelo(c);
      await c.query(`select conjunto_adicionar($1,$2)`, [a, b]); // {A,B}
      await c.query(`select conjunto_adicionar($1,$2)`, [d, b]); // move B -> {D,B}; {A} dissolve
      expect(await conj(c, a)).toBeNull();
      const cd = await conj(c, d);
      expect(cd).not.toBeNull();
      expect(await conj(c, b)).toBe(cd);
    });
  });

  it("remover dissolve quando sobra 1", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const a = await novoModelo(c), b = await novoModelo(c);
      await c.query(`select conjunto_adicionar($1,$2)`, [a, b]); // {A,B}
      await c.query(`select conjunto_remover($1)`, [b]);          // B sai; {A} dissolve
      expect(await conj(c, b)).toBeNull();
      expect(await conj(c, a)).toBeNull();
    });
  });

  it("recusa relacionar a si mesmo", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const a = await novoModelo(c);
      await expect(c.query(`select conjunto_adicionar($1,$1)`, [a])).rejects.toThrow();
    });
  });

  it("recusa produto de outra loja", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const a = await novoModelo(c), x = await novoModelo(c, AVE_RARA);
      await expect(c.query(`select conjunto_adicionar($1,$2)`, [a, x])).rejects.toThrow();
    });
  });

  it("nunca deixa conjunto com exatamente 1 membro", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const a = await novoModelo(c), b = await novoModelo(c), cc = await novoModelo(c);
      await c.query(`select conjunto_adicionar($1,$2)`, [a, b]);
      await c.query(`select conjunto_adicionar($1,$2)`, [a, cc]);
      await c.query(`select conjunto_remover($1)`, [b]);
      const solos = await um<{ n: string }>(
        c,
        `select count(*) n from (select conjunto_id from modelos where conjunto_id is not null group by conjunto_id having count(*)=1) s`,
      );
      expect(Number(solos.n)).toBe(0);
    });
  });
});
