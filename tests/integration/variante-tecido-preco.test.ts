import { describe, it, expect } from "vitest";
import { hasDb, withTx, um, TENANT_TESTE } from "./db";

// Preço por variante de tecido (Fase 1): o preço vive na variante; o artigo = MAX(variantes)
// mantido por trigger (sobe E desce). Histórico por variante = log da progressão: cada set/mudança
// registra o valor DEFINIDO + data ISO (o mais recente = preço atual). Aparece já no 1º set.
// (Isola-se dos dados reais limpando preço+histórico do alvo — tudo em BEGIN…ROLLBACK.)
describe.skipIf(!hasDb)("Preço por variante de tecido — artigo = MAX + histórico", () => {
  it("artigo acompanha o maior (sobe e desce) e loga a progressão de preço na variante", async () => {
    await withTx(async (c) => {
      const art = await um<{ id: string } | undefined>(c,
        `select artigo_id id from variantes_tecido group by artigo_id having count(*)>=2 limit 1`);
      if (!art) return;
      // slate limpo: sem preço nem histórico em NENHUMA variante do artigo (só as 2 do teste contam).
      await c.query(`update variantes_tecido set preco=null, historico_precos='[]'::jsonb where artigo_id=$1`, [art.id]);
      const vars = (await c.query(
        `select id from variantes_tecido where artigo_id=$1 order by created_at limit 2`, [art.id])).rows as { id: string }[];
      const artPreco = async () => Number((await um<{ p: string }>(c, `select preco p from artigos where id=$1`, [art.id])).p);
      const histV2 = async () => (await um<{ h: any }>(c, `select historico_precos h from variantes_tecido where id=$1`, [vars[1].id])).h as any[];

      // v1=10, v2=8 → artigo = 10; 1º set já logou (null→8) → histórico v2 = [8]
      await c.query(`update variantes_tecido set preco=10 where id=$1`, [vars[0].id]);
      await c.query(`update variantes_tecido set preco=8 where id=$1`, [vars[1].id]);
      expect(await artPreco()).toBe(10);
      expect((await histV2()).map((h) => Number(h.preco))).toEqual([8]);

      // v2: 8 → 12 → artigo = 12; histórico progride p/ [8,12]
      await c.query(`update variantes_tecido set preco=12 where id=$1`, [vars[1].id]);
      expect(await artPreco()).toBe(12);
      const h2 = await histV2();
      expect(h2.map((h) => Number(h.preco))).toEqual([8, 12]);
      expect(isNaN(new Date(h2[h2.length - 1].data).getTime())).toBe(false); // data ISO parseável

      // v2: 12 → 5 → artigo acompanha pra baixo (= 10, a v1); histórico = [8,12,5]
      await c.query(`update variantes_tecido set preco=5 where id=$1`, [vars[1].id]);
      expect(await artPreco()).toBe(10);
      expect((await histV2()).map((h) => Number(h.preco))).toEqual([8, 12, 5]);
    });
  });

  it("definir o preço pela 1ª vez (null → valor) JÁ cria histórico com o valor", async () => {
    await withTx(async (c) => {
      const v = await um<{ id: string } | undefined>(c,
        `select id from variantes_tecido where preco is null limit 1`);
      if (!v) return;
      await c.query(`update variantes_tecido set historico_precos='[]'::jsonb where id=$1`, [v.id]); // slate limpo
      await c.query(`update variantes_tecido set preco=7 where id=$1`, [v.id]);
      const hist = (await um<{ h: any }>(c, `select historico_precos h from variantes_tecido where id=$1`, [v.id])).h as any[];
      expect(hist.map((h) => Number(h.preco))).toEqual([7]); // aparece já no 1º set
    });
  });
});
