/**
 * F7 Armario - FOTO POR VARIANTE (cor): RPCs `modelo_variante_foto_salvar` / `modelo_variante_fotos_listar`
 * e o coalesce de `foto_path` por variante no `armario_variantes_disponiveis(uuid)` (migration 20261206100000).
 * SO na cópia local, BEGIN...ROLLBACK (aplica a migration DENTRO da txn pelo harness `aplicarArquivo`).
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, comoUsuario, um, TENANT_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;

const id = async (c: Client, sql: string, p: unknown[] = []) => (await um<{ id: string }>(c, sql + " RETURNING id", p)).id;

/** Aplica a cadeia do armário + a migration da foto por variante DENTRO da txn. */
async function aplica(c: Client): Promise<void> {
  // A cópia já pode ter os objetos (deploy); aplicar é idempotente (CREATE OR REPLACE / IF NOT EXISTS / guarda md5).
  await aplicarArquivo(c, "supabase/migrations/20261206100000_modelo_variante_fotos.sql");
}

interface Seed {
  mInt: string; vt1: string; vt2: string; cor1: string; ap1: string;
  mRev: string; pav1: string;
}

async function semeia(c: Client): Promise<Seed> {
  const colA = await id(c, `INSERT INTO public.colecoes (tenant_id, nome) VALUES ($1, 'Col MVF')`, [T]);
  const cor1 = await id(c, `INSERT INTO public.cores (tenant_id, nome) VALUES ($1, 'Azul MVF')`, [T]);
  const cor2 = await id(c, `INSERT INTO public.cores (tenant_id, nome) VALUES ($1, 'Verde MVF')`, [T]);
  const ap1 = await id(c, `INSERT INTO public.cores_apelido (tenant_id, nome, cor_base_id) VALUES ($1, 'Mar MVF', $2)`, [T, cor1]);

  // INTERNO com Tecido 1 + 2 variantes
  const mInt = await id(
    c,
    `INSERT INTO public.modelos (tenant_id, nome, origem, colecao_id, fotos_modelo) VALUES ($1, 'Int MVF', 'interno', $2, $3)`,
    [T, colA, ["modelos/capa-int.jpg"]],
  );
  const mt1 = await id(c, `INSERT INTO public.modelo_tecidos (modelo_id, numero, tipo) VALUES ($1, 1, 'tecido')`, [mInt]);
  const vt1 = await id(c, `INSERT INTO public.variantes_tecido (tenant_id, cor_id, cor_apelido_id) VALUES ($1, $2, $3)`, [T, cor1, ap1]);
  const vt2 = await id(c, `INSERT INTO public.variantes_tecido (tenant_id, cor_id, cor_apelido_id) VALUES ($1, $2, NULL)`, [T, cor2]);
  await c.query(`INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1, $2, 1)`, [mt1, vt1]);
  await c.query(`INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1, $2, 2)`, [mt1, vt2]);

  // REVENDA com produto espelho + 1 variante
  const mRev = await id(c, `INSERT INTO public.modelos (tenant_id, nome, origem, colecao_id) VALUES ($1, 'Rev MVF', 'revenda', $2)`, [T, colA]);
  const pa = await id(c, `INSERT INTO public.produtos_acabados (tenant_id, modelo_id, nome) VALUES ($1, $2, 'PA MVF')`, [T, mRev]);
  const pav1 = await id(c, `INSERT INTO public.produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, cor_id, cor_apelido_id) VALUES ($1, $2, 1, $3, $4)`, [T, pa, cor1, ap1]);

  return { mInt, vt1, vt2, cor1, ap1, mRev, pav1 };
}

const listar = async (c: Client, modelo: string): Promise<any[]> =>
  (await um<{ r: any[] }>(c, "SELECT public.modelo_variante_fotos_listar($1) AS r", [modelo])).r;

const salvar = (c: Client, p: { modelo: string; vt?: string | null; pv?: string | null; foto: string | null }) =>
  c.query("SELECT public.modelo_variante_foto_salvar($1,$2,$3,NULL,NULL,$4) AS id", [p.modelo, p.vt ?? null, p.pv ?? null, p.foto]);

const fotoNaRpcArmario = async (c: Client, modelo: string, vt: string): Promise<string | null> => {
  const r = (await um<{ r: any[] }>(c, "SELECT public.armario_variantes_disponiveis(NULL) AS r")).r;
  const mo = r.find((x) => x.modelo_id === modelo);
  const v = (mo?.variantes ?? []).find((x: any) => x.variante_tecido_id === vt);
  return v?.foto_path ?? null;
};

describe.skipIf(!RODA)("F7 Armario - foto por variante", () => {
  it("listar devolve TODAS as variantes do modelo interno com foto null quando nao ha", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await aplica(c);
      const s = await semeia(c);
      const lst = await listar(c, s.mInt);
      expect(lst).toHaveLength(2);
      expect(lst.every((v: any) => v.foto_path === null)).toBe(true);
      expect(lst.map((v: any) => v.variante_tecido_id).sort()).toEqual([s.vt1, s.vt2].sort());
    });
  });

  it("salvar foto (interno) grava pela tupla com snapshot de cor DERIVADO e listar reflete", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await aplica(c);
      const s = await semeia(c);
      await salvar(c, { modelo: s.mInt, vt: s.vt1, foto: "modelos/variante-fotos/x.jpg" });
      const lst = await listar(c, s.mInt);
      const v1 = lst.find((v: any) => v.variante_tecido_id === s.vt1);
      const v2 = lst.find((v: any) => v.variante_tecido_id === s.vt2);
      expect(v1.foto_path).toBe("modelos/variante-fotos/x.jpg");
      expect(v1.cor_id).toBe(s.cor1); // snapshot derivado da variante
      expect(v1.cor_apelido_id).toBe(s.ap1);
      expect(v2.foto_path).toBeNull();
      // 1 linha gravada, com a tupla correta
      const n = (await um<{ n: string }>(c, "SELECT count(*) n FROM public.modelo_variante_fotos WHERE modelo_id=$1", [s.mInt])).n;
      expect(n).toBe("1");
    });
  });

  it("armario_variantes_disponiveis usa a FOTO da variante quando ha, a CAPA quando nao ha", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await aplica(c);
      const s = await semeia(c);
      // antes: ambas as variantes caem na capa do modelo
      expect(await fotoNaRpcArmario(c, s.mInt, s.vt1)).toBe("modelos/capa-int.jpg");
      expect(await fotoNaRpcArmario(c, s.mInt, s.vt2)).toBe("modelos/capa-int.jpg");
      // grava foto da vt1
      await salvar(c, { modelo: s.mInt, vt: s.vt1, foto: "modelos/variante-fotos/vt1.jpg" });
      expect(await fotoNaRpcArmario(c, s.mInt, s.vt1)).toBe("modelos/variante-fotos/vt1.jpg");
      expect(await fotoNaRpcArmario(c, s.mInt, s.vt2)).toBe("modelos/capa-int.jpg"); // fallback
    });
  });

  it("path vazio REMOVE a linha (volta a usar a capa)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await aplica(c);
      const s = await semeia(c);
      await salvar(c, { modelo: s.mInt, vt: s.vt1, foto: "modelos/variante-fotos/vt1.jpg" });
      await salvar(c, { modelo: s.mInt, vt: s.vt1, foto: "" });
      const n = (await um<{ n: string }>(c, "SELECT count(*) n FROM public.modelo_variante_fotos WHERE modelo_id=$1", [s.mInt])).n;
      expect(n).toBe("0");
      expect(await fotoNaRpcArmario(c, s.mInt, s.vt1)).toBe("modelos/capa-int.jpg");
    });
  });

  it("revenda: salvar por produto_variante_id funciona (coalesce no armario)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await aplica(c);
      const s = await semeia(c);
      await salvar(c, { modelo: s.mRev, pv: s.pav1, foto: "modelos/variante-fotos/rev.jpg" });
      const lst = await listar(c, s.mRev);
      const v = lst.find((x: any) => x.produto_variante_id === s.pav1);
      expect(v.foto_path).toBe("modelos/variante-fotos/rev.jpg");
      // armario: a variante de revenda usa a foto; modelo sem capa -> sem fallback (null) nas outras
      const r = (await um<{ r: any[] }>(c, "SELECT public.armario_variantes_disponiveis(NULL) AS r")).r;
      const mo = r.find((x) => x.modelo_id === s.mRev);
      const vr = (mo?.variantes ?? []).find((x: any) => x.produto_variante_id === s.pav1);
      expect(vr.foto_path).toBe("modelos/variante-fotos/rev.jpg");
    });
  });

  it("recusa variante que nao pertence ao modelo e ponteiro ambiguo", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await aplica(c);
      const s = await semeia(c);
      // cada recusa aborta a txn do Postgres: isola em SAVEPOINT para seguir testando.
      await c.query("SAVEPOINT sp1");
      await expect(
        c.query("SELECT public.modelo_variante_foto_salvar($1, gen_random_uuid(), NULL, NULL, NULL, 'x.jpg')", [s.mInt]),
      ).rejects.toThrow(/mvf_variante_invalida/);
      await c.query("ROLLBACK TO SAVEPOINT sp1");

      await c.query("SAVEPOINT sp2");
      await expect(
        c.query("SELECT public.modelo_variante_foto_salvar($1, $2, gen_random_uuid(), NULL, NULL, 'x.jpg')", [s.mInt, s.vt1]),
      ).rejects.toThrow(/mvf_variante_ambigua/);
      await c.query("ROLLBACK TO SAVEPOINT sp2");
    });
  });
});
