import { describe, it, expect } from "vitest";
import { hasDb, withTx, um, TENANT_TESTE } from "./db";

// Preço por variante de tecido (Fase 1): o preço vive na variante; o artigo = MAX(variantes)
// mantido por trigger (sobe E desce); histórico por variante loga o preço anterior (data ISO).
describe.skipIf(!hasDb)("Preço por variante de tecido — artigo = MAX + histórico", () => {
  it("artigo acompanha o maior (sobe e desce) e loga histórico na variante", async () => {
    await withTx(async (c) => {
      const art = await um<{ id: string } | undefined>(c,
        `select artigo_id id from variantes_tecido group by artigo_id having count(*)>=2 limit 1`);
      if (!art) return;
      const vars = (await c.query(
        `select id from variantes_tecido where artigo_id=$1 order by created_at limit 2`, [art.id])).rows as { id: string }[];
      const artPreco = async () => Number((await um<{ p: string }>(c, `select preco p from artigos where id=$1`, [art.id])).p);

      // v1=10, v2=8 → artigo = 10
      await c.query(`update variantes_tecido set preco=10 where id=$1`, [vars[0].id]);
      await c.query(`update variantes_tecido set preco=8 where id=$1`, [vars[1].id]);
      expect(await artPreco()).toBe(10);

      // v2: 8 → 12 → artigo = 12 + histórico da v2 loga 8
      await c.query(`update variantes_tecido set preco=12 where id=$1`, [vars[1].id]);
      expect(await artPreco()).toBe(12);
      const hist = (await um<{ h: any }>(c, `select historico_precos h from variantes_tecido where id=$1`, [vars[1].id])).h as any[];
      expect(hist.length).toBe(1);
      expect(Number(hist[0].preco)).toBe(8);
      expect(isNaN(new Date(hist[0].data).getTime())).toBe(false); // data ISO parseável

      // v2: 12 → 5 → artigo acompanha pra baixo (= 10, a v1)
      await c.query(`update variantes_tecido set preco=5 where id=$1`, [vars[1].id]);
      expect(await artPreco()).toBe(10);
    });
  });

  it("primeira definição de preço (null → valor) NÃO loga entrada fantasma", async () => {
    await withTx(async (c) => {
      const v = await um<{ id: string } | undefined>(c,
        `select id from variantes_tecido where preco is null limit 1`);
      if (!v) return;
      await c.query(`update variantes_tecido set preco=7 where id=$1`, [v.id]);
      const hist = (await um<{ h: any }>(c, `select historico_precos h from variantes_tecido where id=$1`, [v.id])).h as any[];
      expect(hist.length).toBe(0); // não loga quando não havia preço anterior
    });
  });
});
