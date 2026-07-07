import { describe, it, expect } from "vitest";
import { withTx, comoUsuario, um, hasDb } from "./db";

// Guardas de exclusão da tela Tecidos + índice único + junção atômica de categorias.
// Tudo roda dentro de uma transação que dá ROLLBACK (withTx), então não suja o banco.

describe.skipIf(!hasDb)("Tecidos — exclusão com guarda", () => {
  it("exclui variante LIVRE (retorna foto p/ storage) e some do banco", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const a = await um<{ id: string }>(c, `insert into artigos (nome, unidade_medida) values ('ART-TST','metro') returning id`);
      const v = await um<{ id: string }>(c, `insert into variantes_tecido (artigo_id) values ($1) returning id`, [a.id]);
      const r = await um<{ excluir_variante_tecido: any }>(c, `select public.excluir_variante_tecido($1)`, [v.id]);
      expect(r.excluir_variante_tecido).toHaveProperty("foto_url");
      const n = await um<{ n: string }>(c, `select count(*)::text n from variantes_tecido where id=$1`, [v.id]);
      expect(n.n).toBe("0");
    });
  });

  it("BLOQUEIA excluir variante em uso (modelo_tecido_variantes)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const a = await um<{ id: string }>(c, `insert into artigos (nome, unidade_medida) values ('ART-USO-V','metro') returning id`);
      const v = await um<{ id: string }>(c, `insert into variantes_tecido (artigo_id) values ($1) returning id`, [a.id]);
      const m = await um<{ id: string }>(c, `insert into modelos (nome) values ('MOD-TST') returning id`);
      const mt = await um<{ id: string }>(c, `insert into modelo_tecidos (modelo_id, artigo_id, numero) values ($1,$2,1) returning id`, [m.id, a.id]);
      await c.query(`insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) values ($1,$2,1)`, [mt.id, v.id]);
      // o RAISE aborta a transação, então não dá p/ checar linhas depois sem savepoint; o
      // próprio bloqueio (rejeição com "em uso") já é a garantia.
      await expect(um(c, `select public.excluir_variante_tecido($1)`, [v.id])).rejects.toThrow(/em uso/i);
    });
  });

  it("exclui tecido LIVRE (cascateia variantes) e BLOQUEIA tecido em uso (modelo_tecidos)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      // livre → exclui + cascade
      const a1 = await um<{ id: string }>(c, `insert into artigos (nome, unidade_medida) values ('ART-LIVRE','metro') returning id`);
      await c.query(`insert into variantes_tecido (artigo_id) values ($1)`, [a1.id]);
      await um(c, `select public.excluir_tecido($1)`, [a1.id]);
      const na = await um<{ n: string }>(c, `select count(*)::text n from artigos where id=$1`, [a1.id]);
      expect(na.n).toBe("0");
      const nv = await um<{ n: string }>(c, `select count(*)::text n from variantes_tecido where artigo_id=$1`, [a1.id]);
      expect(nv.n).toBe("0");
      // em uso → bloqueia
      const a2 = await um<{ id: string }>(c, `insert into artigos (nome, unidade_medida) values ('ART-USO','metro') returning id`);
      const m = await um<{ id: string }>(c, `insert into modelos (nome) values ('MOD-TST2') returning id`);
      await c.query(`insert into modelo_tecidos (modelo_id, artigo_id, numero) values ($1,$2,1)`, [m.id, a2.id]);
      await expect(um(c, `select public.excluir_tecido($1)`, [a2.id])).rejects.toThrow(/em uso/i);
    });
  });
});

describe.skipIf(!hasDb)("Tecidos — índice único e categorias atômicas", () => {
  it("índice único impede variante duplicada (mesma cor+apelido no tecido)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const a = await um<{ id: string }>(c, `insert into artigos (nome, unidade_medida) values ('ART-DUP','metro') returning id`);
      const cor = await um<{ id: string }>(c, `select id from cores limit 1`);
      const ap = await um<{ id: string }>(c, `select id from cores_apelido limit 1`);
      await c.query(`insert into variantes_tecido (artigo_id, cor_id, cor_apelido_id) values ($1,$2,$3)`, [a.id, cor.id, ap.id]);
      await expect(
        c.query(`insert into variantes_tecido (artigo_id, cor_id, cor_apelido_id) values ($1,$2,$3)`, [a.id, cor.id, ap.id]),
      ).rejects.toThrow();
    });
  });

  it("set_artigo_categorias troca de forma atômica (define → substitui → limpa)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const a = await um<{ id: string }>(c, `insert into artigos (nome, unidade_medida) values ('ART-CAT','metro') returning id`);
      const cats = await c.query(`select id from categorias_tecido limit 2`);
      if (cats.rows.length < 2) return;
      const c1 = cats.rows[0].id, c2 = cats.rows[1].id;
      await um(c, `select public.set_artigo_categorias($1, $2::uuid[])`, [a.id, [c1, c2]]);
      let n = await um<{ n: string }>(c, `select count(*)::text n from artigo_categorias_tecido where artigo_id=$1`, [a.id]);
      expect(n.n).toBe("2");
      await um(c, `select public.set_artigo_categorias($1, $2::uuid[])`, [a.id, [c1]]);
      n = await um<{ n: string }>(c, `select count(*)::text n from artigo_categorias_tecido where artigo_id=$1`, [a.id]);
      expect(n.n).toBe("1");
      await um(c, `select public.set_artigo_categorias($1, $2::uuid[])`, [a.id, []]);
      n = await um<{ n: string }>(c, `select count(*)::text n from artigo_categorias_tecido where artigo_id=$1`, [a.id]);
      expect(n.n).toBe("0");
    });
  });
});
