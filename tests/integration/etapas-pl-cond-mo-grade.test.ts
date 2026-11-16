// Reforma das Etapas PL (Parte B) — migration 5 (20261129140000_etapas_pl_cond_mo_grade): as condições `servico_aprovado` ("M.O. aprovada") e
// `grade_preenchida` entram no avaliador das Etapas PL com a MESMA expressão do Dev. O Dev não tem helper para elas (são inline em
// `_avaliar_condicoes_kanban_core`), então a PARIDADE Dev × PL é pinada aqui sobre cenários reais. Txn revertida; só cópia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um } from "./db";
import { novaCategoria, novaLinhaMo, novoModelo, prepara, T } from "./peca-teste-tipo-helpers";

const RODA = hasDb && ehBancoLocal();
const cond = async (c: Client, fn: string, m: string) =>
  (await um<{ j: Record<string, Record<string, boolean>> }>(c, `SELECT public.${fn}($1, $2::uuid[]) AS j`, [T, [m]])).j[m];
const ambos = async (c: Client, m: string) => ({ dev: await cond(c, "_avaliar_condicoes_kanban_core", m), pl: await cond(c, "_avaliar_condicoes_etapas_pl_core", m) });
const grade = (c: Client, m: string, total: number | null, variante = 1) =>
  c.query("INSERT INTO public.modelo_grades (modelo_id, variante_numero, grades, grade_total) VALUES ($1, $2, '{}'::jsonb, $3)", [m, variante, total]);

describe.skipIf(!RODA)("reforma das Etapas PL — M.O. aprovada e Grade preenchida (migration 5)", () => {
  it("1) PARIDADE Dev × PL em servico_aprovado: sem linhas, linha pendente (false), todas aprovadas (true), uma reprovada (false)", async () => {
    await withTx(async (c) => {
      await prepara(c, "evalpl");
      const cat = await novaCategoria(c, "Corte cm", false);
      const m = await novoModelo(c, "cm servico");
      const lido = async () => { const r = await ambos(c, m); expect(r.pl.servico_aprovado).toBe(r.dev.servico_aprovado); return r.pl.servico_aprovado; };
      await lido(); // sem linhas: o valor é o do flag do card; o que importa é a PARIDADE (lido() a confere a cada passo)
      const a = await novaLinhaMo(c, m, cat, null, true);
      await novaLinhaMo(c, m, cat, null, null);
      expect(await lido()).toBe(false); // uma pendente
      await c.query("UPDATE public.modelo_servico_mo SET aprovado = true, motivo_reprovacao = NULL WHERE modelo_id = $1", [m]);
      expect(await lido()).toBe(true); // todas aprovadas (o rollup liga o flag do card)
      await c.query("UPDATE public.modelo_servico_mo SET aprovado = false, motivo_reprovacao = 'x' WHERE id = $1", [a]);
      expect(await lido()).toBe(false); // uma reprovada
    });
  });

  it("2) PARIDADE Dev × PL em grade_preenchida: sem grade / grade zerada = false; com quantidade (soma > 0) = true", async () => {
    await withTx(async (c) => {
      await prepara(c, "evalpl");
      const m = await novoModelo(c, "cm grade");
      const lido = async () => { const r = await ambos(c, m); expect(r.pl.grade_preenchida).toBe(r.dev.grade_preenchida); return r.pl.grade_preenchida; };
      expect(await lido()).toBe(false);
      await grade(c, m, 0);
      expect(await lido()).toBe(false);
      await grade(c, m, null, 2);
      expect(await lido()).toBe(false);
      await grade(c, m, 12, 3);
      expect(await lido()).toBe(true);
    });
  });

  it("3) o avaliador público das Etapas PL devolve as 2 keys novas (o mapa que a tela e o motor leem), e as 8 antigas continuam", async () => {
    await withTx(async (c) => {
      await prepara(c, "evalpl");
      const m = await novoModelo(c, "cm mapa");
      const j = (await um<{ j: Record<string, Record<string, boolean>> }>(c, "SELECT public.avaliar_condicoes_etapas_pl($1::uuid[]) AS j", [[m]])).j[m];
      for (const k of ["servico_aprovado", "grade_preenchida", "peca_teste_aprovada", "tem_peca_teste", "enviado_a_servicos", "materiais_separados", "grade_cortada_retornou", "oficina_entregue", "cq_liberado", "lancado"]) {
        expect(j, k).toHaveProperty(k);
      }
    });
  });

  it("4) migration 2x = mesmo md5; ACL do core sem EXECUTE para PUBLIC/anon/authenticated", async () => {
    await withTx(async (c) => {
      await prepara(c, "evalpl");
      const le = async () => (await c.query(`SELECT proacl::text AS acl, md5(pg_get_functiondef(oid)) AS m FROM pg_proc WHERE oid = 'public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])'::regprocedure`)).rows[0];
      const a = await le();
      expect(a.acl).toBe("{postgres=X/postgres,service_role=X/postgres}");
      await prepara(c, "evalpl");
      expect(await le()).toEqual(a);
    });
  });

  it("5) anti-drift de TEXTO: as 2 expressões estão IDÊNTICAS (byte a byte) no avaliador do Dev e no do PL", async () => {
    await withTx(async (c) => {
      await prepara(c, "evalpl");
      const def = async (sig: string) => (await um<{ d: string }>(c, "SELECT pg_get_functiondef($1::regprocedure) AS d", [sig])).d;
      const dev = await def("public._avaliar_condicoes_kanban_core(uuid,uuid[])");
      const pl = await def("public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])");
      for (const exp of [
        "'servico_aprovado', coalesce(m.custo_terceirizados_aprovado, false),",
        "'grade_preenchida', coalesce((select sum(g.grade_total) from modelo_grades g where g.modelo_id = m.id), 0) > 0,",
      ]) {
        expect(dev.split(exp).length - 1, `Dev: ${exp}`).toBe(1);
        expect(pl.split(exp).length - 1, `PL: ${exp}`).toBe(1);
      }
    });
  });
});
