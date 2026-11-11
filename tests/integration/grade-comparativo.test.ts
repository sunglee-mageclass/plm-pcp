// F5-2 Task 3 — teste de integração da RPC de LEITURA `grade_comparativo` (migration 20261120100000, Task 3).
// Casa as 4 fases da grade (Programada, CAD, PCP cortada, CQ) alinhadas por variante_numero × tamanho, num OUTER-JOIN:
// variantes = união de QUALQUER fase; tamanhos = união; célula ausente numa fase = null.
//
// TUDO em BEGIN…ROLLBACK (padrão de `withTx`), SÓ na cópia local (`ehBancoLocal`): nada é gravado de verdade.
// A semente é feita SEM JWT (como postgres); a RPC é chamada com o JWT do usuário-dono (super admin, lê tudo da loja)
// e, no caso cross-tenant, com um usuário COMUM de outra loja (padrão de `salvar-card-planejamento.test.ts`).
import { describe, it, expect } from "vitest";
import type { Client as PgClient } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, comoUsuario, TENANT_TESTE, USER_TESTE } from "./db";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;

// usuário COMUM de OUTRA loja (criado na txn) — para o caso de tenant-scope
const U_OUTRA = "9ca4d000-0000-4000-8000-00000000c0a1";

const call = async (c: PgClient, modelo: string) =>
  (await um<{ r: any }>(c, `select public.grade_comparativo($1::uuid) as r`, [modelo])).r;

/** Cria o esqueleto de um CAD (1 cad + 1 cad_tecidos tecido/1 + N cad_tecido_variantes) e devolve o map ordem→variante_tecido_id. */
async function semearCad(c: PgClient, modelo: string, vids: string[]): Promise<string> {
  const cadId = (await um<{ id: string }>(c, `insert into cad (tenant_id, modelo_id) values ($1,$2) returning id`, [T, modelo])).id;
  const ctId = (await um<{ id: string }>(c, `insert into cad_tecidos (cad_id, numero, tipo) values ($1, 1, 'tecido') returning id`, [cadId])).id;
  for (let i = 0; i < vids.length; i++) {
    await c.query(`insert into cad_tecido_variantes (cad_tecido_id, variante_tecido_id, ordem) values ($1,$2,$3)`, [ctId, vids[i], i + 1]);
  }
  return cadId;
}

describe.skipIf(!RODA)("grade_comparativo — 4 fases por variante × tamanho (Task 3)", () => {
  it("casa Programada/CAD/CQ; fase ausente = null; variante nova (só na Programada) aparece com cad null", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); // super admin da Loja Teste
      const { modelo, art } = await semJwt(c, async () => {
        const art = (await um<{ id: string }>(c, `insert into artigos (tenant_id, nome, unidade_medida, preco) values ($1,'GC tecido','metro',1) returning id`, [T])).id;
        const vt = async (nome: string) => (await um<{ id: string }>(c, `insert into variantes_tecido (tenant_id, artigo_id, nome_variante) values ($1,$2,$3) returning id`, [T, art, nome])).id;
        const v1 = await vt("GC-cafe");
        const v2 = await vt("GC-botanica");
        const modelo = (await um<{ id: string }>(c, `insert into modelos (tenant_id, nome, ref) values ($1,'GC modelo','GC-1') returning id`, [T])).id;
        // Programada CONGELADA (não-null) em 3 variantes — a variante 3 só existe na Programada.
        await c.query(`insert into modelo_grades (modelo_id, variante_numero, grades, grades_programada) values
          ($1, 1, '{"P":10,"M":10}'::jsonb, '{"P":10,"M":10}'::jsonb),
          ($1, 2, '{"P":5}'::jsonb,         '{"P":5}'::jsonb),
          ($1, 3, '{"P":4}'::jsonb,         '{"P":4}'::jsonb)`, [modelo]);
        // CAD só nas variantes 1 e 2 (3 fica sem CAD).
        const cadId = await semearCad(c, modelo, [v1, v2]);
        await c.query(`insert into cad_grades (cad_id, variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real) values
          ($1, 1, '{"P":10,"M":9}'::jsonb, '{}'::jsonb, 19, 0),
          ($1, 2, '{"P":5}'::jsonb,        '{}'::jsonb, 5, 0)`, [cadId]);
        // CQ: recebimento + defeito na variante 1.
        const cqId = (await um<{ id: string }>(c, `insert into controle_qualidade (tenant_id, cad_id) values ($1,$2) returning id`, [T, cadId])).id;
        await c.query(`insert into cq_variantes (controle_qualidade_id, variante_numero, etapa, grades, grade_total) values
          ($1, 1, 'recebimento', '{"P":10,"M":9}'::jsonb, 19),
          ($1, 1, 'defeito',     '{"P":1}'::jsonb,        1)`, [cqId]);
        return { modelo, art };
      });

      const r = await call(c, modelo);
      // Variantes: união (1,2,3). A 3 só existe na Programada; vid null (sem CAD), label "Variante 3".
      const vns = (r.variantes as any[]).map((v) => v.variante_numero).sort();
      expect(vns).toEqual([1, 2, 3]);
      const v3 = (r.variantes as any[]).find((v) => v.variante_numero === 3);
      expect(v3.variante_tecido_id).toBeNull();
      expect(v3.label).toBe("Variante 3");
      // label da variante 1 vem de variantes_tecido.nome_variante
      expect((r.variantes as any[]).find((v) => v.variante_numero === 1).label).toBe("GC-cafe");
      // Tamanhos: união {P,M}.
      expect((r.tamanhos as string[]).slice().sort()).toEqual(["M", "P"]);

      // Célula 1|P: programada 10, cad 10, cq recebida 10/defeito 1/real 9, pcp null.
      const c1p = r.celulas["1|P"];
      expect(c1p.programada).toBe(10);
      expect(c1p.cad).toBe(10);
      expect(c1p.pcp).toBeNull();
      expect(c1p.cq).toEqual({ recebida: 10, defeito: 1, real: 9 });
      // Célula 1|M: cq recebida 9, defeito ausente -> 0, real 9.
      expect(r.celulas["1|M"].cq).toEqual({ recebida: 9, defeito: 0, real: 9 });
      // Célula 2|P: programada 5, cad 5, SEM cq (null).
      expect(r.celulas["2|P"].programada).toBe(5);
      expect(r.celulas["2|P"].cad).toBe(5);
      expect(r.celulas["2|P"].cq).toBeNull();
      // Célula 3|P: só Programada; cad null, cq null, pcp null.
      expect(r.celulas["3|P"].programada).toBe(4);
      expect(r.celulas["3|P"].cad).toBeNull();
      expect(r.celulas["3|P"].cq).toBeNull();
      // Célula 2|M não existe em NENHUMA fase -> chave ausente.
      expect(r.celulas["2|M"]).toBeUndefined();
    });
  });

  it("PCP: traduz variante_tecido_id -> variante_numero via cad_tecido_variantes.ordem (bloco-fonte detalhado/ativo)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { modelo, v1 } = await semJwt(c, async () => {
        const art = (await um<{ id: string }>(c, `insert into artigos (tenant_id, nome, unidade_medida, preco) values ($1,'GC2 tecido','metro',1) returning id`, [T])).id;
        const v1 = (await um<{ id: string }>(c, `insert into variantes_tecido (tenant_id, artigo_id, nome_variante) values ($1,$2,'GC2-v1') returning id`, [T, art])).id;
        const v2 = (await um<{ id: string }>(c, `insert into variantes_tecido (tenant_id, artigo_id, nome_variante) values ($1,$2,'GC2-v2') returning id`, [T, art])).id;
        const modelo = (await um<{ id: string }>(c, `insert into modelos (tenant_id, nome, ref) values ($1,'GC2 modelo','GC2-1') returning id`, [T])).id;
        const cadId = await semearCad(c, modelo, [v1, v2]); // ordem 1->v1, 2->v2
        // Bloco-fonte de confecção (categoria "Costura" = confeccao), detalhado + ativo, grade_detalhe pela CHAVE variante_tecido_id.
        const cat = (await um<{ id: string }>(c, `insert into categorias_terceirizado (tenant_id, nome, ativo) values ($1,'Costura GC2',true) returning id`, [T])).id;
        const gd = JSON.stringify({
          [v1]: { P: { enviada: 10, cortada: 10, recebida: 8, defeito: 1 } },
          [v2]: { M: { enviada: 5, cortada: 5, recebida: 5, defeito: 0 } },
        });
        await c.query(
          `insert into producao_terceirizados (tenant_id, cad_id, categoria_terceirizado_id, detalhado, ativo, grade_detalhe)
           values ($1,$2,$3,true,true,$4::jsonb)`,
          [T, cadId, cat, gd],
        );
        return { modelo, v1 };
      });

      const r = await call(c, modelo);
      // vid de ordem 1 na lista de variantes = v1
      expect((r.variantes as any[]).find((v) => v.variante_numero === 1).variante_tecido_id).toBe(v1);
      // PCP traduziu v1 -> variante_numero 1, tamanho P.
      expect(r.celulas["1|P"].pcp).toEqual({ enviada: 10, cortada: 10, recebida: 8, defeito: 1 });
      // v2 -> variante_numero 2, tamanho M.
      expect(r.celulas["2|M"].pcp).toEqual({ enviada: 5, cortada: 5, recebida: 5, defeito: 0 });
      // sem Programada/CAD/CQ nesse modelo -> null nas outras fases.
      expect(r.celulas["1|P"].programada).toBeNull();
      expect(r.celulas["1|P"].cad).toBeNull();
      expect(r.celulas["1|P"].cq).toBeNull();
    });
  });

  it("modelo sem CAD/CQ/PCP/Programada: devolve vazio sem erro", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const modelo = await semJwt(c, async () =>
        (await um<{ id: string }>(c, `insert into modelos (tenant_id, nome, ref) values ($1,'GC vazio','GC-V') returning id`, [T])).id,
      );
      const r = await call(c, modelo);
      expect(r).toEqual({ variantes: [], tamanhos: [], celulas: {} });
    });
  });

  it("tenant-scope: usuário comum de OUTRA loja recebe nao_encontrado (P0002)", async () => {
    await withTx(async (c) => {
      const { modelo, outra } = await semJwt(c, async () => {
        const modelo = (await um<{ id: string }>(c, `insert into modelos (tenant_id, nome, ref) values ($1,'GC scope','GC-S') returning id`, [T])).id;
        const outra = (await um<{ id: string }>(c, `select id from tenants where id <> $1 order by id limit 1`, [T])).id;
        await c.query(`insert into auth.users (id, email) values ($1,$2) on conflict (id) do nothing`, [U_OUTRA, `${U_OUTRA}@teste`]);
        await c.query(
          `insert into public.users (id, tenant_id, email, nome, role) values ($1,$2,$3,'GC outra','user')
           on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'user'`,
          [U_OUTRA, outra, `${U_OUTRA}@teste`],
        );
        return { modelo, outra };
      });
      await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U_OUTRA, role: "authenticated" })]);
      await expect(call(c, modelo)).rejects.toMatchObject({ code: "P0002" });
    });
  });

  it("anon não tem EXECUTE; authenticated e service_role têm", async () => {
    await withTx(async (c) => {
      const p = await um<{ anon: boolean; auth: boolean; svc: boolean }>(
        c,
        `select has_function_privilege('anon','public.grade_comparativo(uuid)','EXECUTE') as anon,
                has_function_privilege('authenticated','public.grade_comparativo(uuid)','EXECUTE') as auth,
                has_function_privilege('service_role','public.grade_comparativo(uuid)','EXECUTE') as svc`,
      );
      expect(p.anon).toBe(false);
      expect(p.auth).toBe(true);
      expect(p.svc).toBe(true);
    });
  });
});
