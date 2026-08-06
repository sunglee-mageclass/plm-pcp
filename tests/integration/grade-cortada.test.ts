// Grade Cortada — FONTE ÚNICA (Task 3). Testes de integração em txn revertida (BEGIN…ROLLBACK):
// nada é gravado. Segue o modelo de rpc-producao.test.ts. Usa CADs "limpos" do tenant teste
// (tecido principal + variante, sem bloco de serviço e sem CQ) para determinismo — o setup cria
// a própria categoria de confecção e o próprio bloco-fonte, tudo desfeito no ROLLBACK.
import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";
import type { Client } from "pg";

const TAM = "38";

type Setup = { cadId: string; vnum: number; vid: string; catId: string };

/** Acha um CAD limpo (tecido principal + >=1 variante, sem producao_terceirizados nem CQ) e cria
 *  uma categoria de confecção ("Oficina …") no tenant teste. Retorna null se não houver CAD. */
async function setupFonte(c: Client): Promise<Setup | null> {
  const cad = await um<{ cad_id: string; vnum: number; vid: string } | undefined>(
    c,
    `select c.id as cad_id, ctv.ordem as vnum, ctv.variante_tecido_id as vid
       from cad c
       join cad_tecidos ct on ct.cad_id = c.id and ct.tipo='tecido' and ct.numero=1
       join cad_tecido_variantes ctv on ctv.cad_tecido_id = ct.id
      where c.tenant_id=$1
        and not exists (select 1 from producao_terceirizados pt where pt.cad_id=c.id)
        and not exists (select 1 from controle_qualidade q where q.cad_id=c.id)
      order by ctv.ordem
      limit 1`,
    [TENANT_TESTE],
  );
  if (!cad) return null;
  const cat = await um<{ id: string }>(
    c,
    `insert into categorias_terceirizado (tenant_id, nome, ativo) values ($1,'Oficina Teste GC',true) returning id`,
    [TENANT_TESTE],
  );
  return { cadId: cad.cad_id, vnum: cad.vnum, vid: cad.vid, catId: cat.id };
}

/** Insere um bloco-fonte destrinchado (ativo) com o grade_detalhe dado. Retorna o id do bloco. */
async function inserirBlocoFonte(c: Client, s: Setup, gradeDetalhe: object): Promise<string> {
  const row = await um<{ id: string }>(
    c,
    `insert into producao_terceirizados (cad_id, tenant_id, categoria_terceirizado_id, ativo, detalhado, grade_detalhe)
     values ($1,$2,$3,true,true,$4::jsonb) returning id`,
    [s.cadId, TENANT_TESTE, s.catId, JSON.stringify(gradeDetalhe)],
  );
  return row.id;
}

describe.skipIf(!hasDb)("Grade Cortada — fonte única", () => {
  it("helpers existem e estão revogados de PUBLIC/anon/authenticated (invariante #9)", async () => {
    await withTx(async (c) => {
      const r = await um<{ ok: boolean }>(
        c,
        `select
           to_regprocedure('public._resolver_fonte_confeccao(uuid)') is not null
           and to_regprocedure('public._categoria_eh_confeccao(text)') is not null
           and to_regprocedure('public._categoria_eh_pl(text)') is not null
           and to_regprocedure('public._aplicar_reais_do_grade_detalhe(uuid,uuid)') is not null
           and has_function_privilege('anon','public._resolver_fonte_confeccao(uuid)','EXECUTE') = false
           and has_function_privilege('authenticated','public._resolver_fonte_confeccao(uuid)','EXECUTE') = false
           and has_function_privilege('anon','public._categoria_eh_confeccao(text)','EXECUTE') = false
           and has_function_privilege('authenticated','public._categoria_eh_confeccao(text)','EXECUTE') = false
           and has_function_privilege('anon','public._categoria_eh_pl(text)','EXECUTE') = false
           and has_function_privilege('authenticated','public._categoria_eh_pl(text)','EXECUTE') = false
           and has_function_privilege('anon','public._aplicar_reais_do_grade_detalhe(uuid,uuid)','EXECUTE') = false
           and has_function_privilege('authenticated','public._aplicar_reais_do_grade_detalhe(uuid,uuid)','EXECUTE') = false
           as ok`,
      );
      expect(r.ok).toBe(true);
    });
  });

  it("_categoria_eh_confeccao casa PL/Oficina/Costura/Private Label e recusa Bordado; _categoria_eh_pl só PL", async () => {
    await withTx(async (c) => {
      const r = await um<{
        pl: boolean; ofi: boolean; cost: boolean; privl: boolean; bord: boolean;
        pl_pl: boolean; pl_ofi: boolean;
      }>(
        c,
        `select
           _categoria_eh_confeccao('PL') pl,
           _categoria_eh_confeccao('Oficina') ofi,
           _categoria_eh_confeccao('Costura Externa') cost,
           _categoria_eh_confeccao('Private Label') privl,
           _categoria_eh_confeccao('Bordado') bord,
           _categoria_eh_pl('PL') pl_pl,
           _categoria_eh_pl('Oficina') pl_ofi`,
      );
      expect(r.pl).toBe(true);
      expect(r.ofi).toBe(true);
      expect(r.cost).toBe(true);
      expect(r.privl).toBe(true);
      expect(r.bord).toBe(false);
      expect(r.pl_pl).toBe(true);
      expect(r.pl_ofi).toBe(false);
    });
  });

  it("salvar_cq deriva a Grade Real de recebida−defeito do grade_detalhe do bloco-fonte (e preserva enviada/cortada)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await setupFonte(c);
      if (!s) return; // sem CAD adequado → não falha
      await inserirBlocoFonte(c, s, { [s.vid]: { [TAM]: { enviada: 10, cortada: 10, recebida: 8, defeito: 3 } } });
      const variantes = JSON.stringify([
        { variante_numero: s.vnum, etapa: "recebimento", grades: { [TAM]: 8 }, grade_total: 8 },
        { variante_numero: s.vnum, etapa: "defeito", grades: { [TAM]: 3 }, grade_total: 3, destino_defeito: null },
      ]);
      const reais = JSON.stringify([{ variante_numero: s.vnum, grades: { [TAM]: 5 }, grade_total: 5 }]);
      const res = await um<{ r: { cq_id: string; status: string; fonte: string | null } }>(
        c,
        `select salvar_cq($1,'{}'::jsonb,$2::jsonb,$3::jsonb,true) as r`,
        [s.cadId, variantes, reais],
      );
      expect(res.r.status).toBe("confirmado");
      expect(res.r.fonte).not.toBeNull();
      // Grade Real gravada = recebida−defeito = 5.
      const real = await um<{ v: number }>(
        c,
        `select coalesce((grades_reais->>$2)::int,0) v from cad_grades where cad_id=$1 and variante_numero=$3`,
        [s.cadId, TAM, s.vnum],
      );
      expect(real.v).toBe(5);
      // grade_detalhe do bloco-fonte RESOLVIDO recebeu recebida=8/defeito=3 e preservou enviada/cortada.
      const pt = await um<{ rec: number; def: number; env: number; cort: number }>(
        c,
        `select (grade_detalhe->$2->$3->>'recebida')::int rec, (grade_detalhe->$2->$3->>'defeito')::int def,
                (grade_detalhe->$2->$3->>'enviada')::int env, (grade_detalhe->$2->$3->>'cortada')::int cort
           from producao_terceirizados where id=$1`,
        [res.r.fonte, s.vid, TAM],
      );
      expect(pt.rec).toBe(8);
      expect(pt.def).toBe(3);
      expect(pt.env).toBe(10);
      expect(pt.cort).toBe(10);
    });
  });

  it("guard do jsonb_set: bloco-fonte começando com grade_detalhe='{}' grava a célula (não é no-op)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await setupFonte(c);
      if (!s) return;
      const fonteId = await inserirBlocoFonte(c, s, {}); // vazio: exercita o guard de chave intermediária
      const variantes = JSON.stringify([
        { variante_numero: s.vnum, etapa: "recebimento", grades: { [TAM]: 8 }, grade_total: 8 },
      ]);
      const reais = JSON.stringify([{ variante_numero: s.vnum, grades: { [TAM]: 8 }, grade_total: 8 }]);
      await c.query(`select salvar_cq($1,'{}'::jsonb,$2::jsonb,$3::jsonb,true)`, [s.cadId, variantes, reais]);
      const pt = await um<{ rec: number }>(
        c,
        `select (grade_detalhe->$2->$3->>'recebida')::int rec from producao_terceirizados where id=$1`,
        [fonteId, s.vid, TAM],
      );
      expect(pt.rec).toBe(8); // sem guard, jsonb_set seria no-op e rec seria null
      const real = await um<{ v: number }>(
        c,
        `select coalesce((grades_reais->>$2)::int,0) v from cad_grades where cad_id=$1 and variante_numero=$3`,
        [s.cadId, TAM, s.vnum],
      );
      expect(real.v).toBe(8);
    });
  });

  it("preserva grades_planejadas ao derivar a Grade Real do bloco-fonte (invariante #7)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await setupFonte(c);
      if (!s) return;
      await inserirBlocoFonte(c, s, { [s.vid]: { [TAM]: { recebida: 8, defeito: 3 } } });
      // linha de grade com PLANEJADA = 20 (que deve sobreviver ao derivar a real). Upsert porque
      // o CAD já nasce com uma linha de grade planejada — é exatamente o caso do invariante #7.
      await c.query(
        `insert into cad_grades (cad_id, variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real)
         values ($1,$2, $3::jsonb, '{}'::jsonb, 20, 0)
         on conflict (cad_id, variante_numero) do update
           set grades_planejadas = excluded.grades_planejadas, grade_total_planejada = excluded.grade_total_planejada,
               grades_reais = '{}'::jsonb, grade_total_real = 0`,
        [s.cadId, s.vnum, JSON.stringify({ [TAM]: 20 })],
      );
      const variantes = JSON.stringify([
        { variante_numero: s.vnum, etapa: "recebimento", grades: { [TAM]: 8 }, grade_total: 8 },
        { variante_numero: s.vnum, etapa: "defeito", grades: { [TAM]: 3 }, grade_total: 3 },
      ]);
      const reais = JSON.stringify([{ variante_numero: s.vnum, grades: { [TAM]: 5 }, grade_total: 5 }]);
      await c.query(`select salvar_cq($1,'{}'::jsonb,$2::jsonb,$3::jsonb,true)`, [s.cadId, variantes, reais]);
      const g = await um<{ plan: number; real: number }>(
        c,
        `select (grades_planejadas->>$2)::int plan, (grades_reais->>$2)::int real
           from cad_grades where cad_id=$1 and variante_numero=$3`,
        [s.cadId, TAM, s.vnum],
      );
      expect(g.plan).toBe(20); // planejada intacta
      expect(g.real).toBe(5); // real = 8−3
    });
  });

  it("modelo SEM bloco-fonte: Grade Real vem do _reais do cliente (comportamento atual)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      // CAD limpo, sem criar bloco de confecção → resolver devolve NULL.
      const cad = await um<{ cad_id: string; vnum: number } | undefined>(
        c,
        `select c.id as cad_id, ctv.ordem as vnum
           from cad c
           join cad_tecidos ct on ct.cad_id = c.id and ct.tipo='tecido' and ct.numero=1
           join cad_tecido_variantes ctv on ctv.cad_tecido_id = ct.id
          where c.tenant_id=$1
            and not exists (select 1 from producao_terceirizados pt where pt.cad_id=c.id)
            and not exists (select 1 from controle_qualidade q where q.cad_id=c.id)
          order by ctv.ordem limit 1`,
        [TENANT_TESTE],
      );
      if (!cad) return;
      const fonte = await um<{ f: string | null }>(c, `select _resolver_fonte_confeccao($1) f`, [cad.cad_id]);
      expect(fonte.f).toBeNull();
      const variantes = JSON.stringify([
        { variante_numero: cad.vnum, etapa: "recebimento", grades: { [TAM]: 7 }, grade_total: 7 },
      ]);
      const reais = JSON.stringify([{ variante_numero: cad.vnum, grades: { [TAM]: 7 }, grade_total: 7 }]);
      const res = await um<{ r: { fonte: string | null } }>(
        c,
        `select salvar_cq($1,'{}'::jsonb,$2::jsonb,$3::jsonb,true) as r`,
        [cad.cad_id, variantes, reais],
      );
      expect(res.r.fonte).toBeNull();
      const real = await um<{ v: number }>(
        c,
        `select coalesce((grades_reais->>$2)::int,0) v from cad_grades where cad_id=$1 and variante_numero=$3`,
        [cad.cad_id, TAM, cad.vnum],
      );
      expect(real.v).toBe(7); // veio do _reais
    });
  });

  it("editar recebida no PCP (salvar_terceirizados) move a Grade Real quando o CQ está confirmado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await setupFonte(c);
      if (!s) return;
      // Cria o bloco-fonte via salvar_terceirizados (recebida=10).
      const blocos1 = JSON.stringify([
        { categoria_terceirizado_id: s.catId, ativo: true, detalhado: true, grade_detalhe: { [s.vid]: { [TAM]: { recebida: 10 } } } },
      ]);
      await c.query(`select salvar_terceirizados($1,$2::jsonb,null)`, [s.cadId, blocos1]);
      const blk = await um<{ id: string }>(
        c,
        `select id from producao_terceirizados where cad_id=$1 and detalhado order by created_at desc limit 1`,
        [s.cadId],
      );
      // Confirma o CQ → deriva a Grade Real do fonte = 10.
      const variantes = JSON.stringify([
        { variante_numero: s.vnum, etapa: "recebimento", grades: { [TAM]: 10 }, grade_total: 10 },
      ]);
      const reais = JSON.stringify([{ variante_numero: s.vnum, grades: { [TAM]: 10 }, grade_total: 10 }]);
      await c.query(`select salvar_cq($1,'{}'::jsonb,$2::jsonb,$3::jsonb,true)`, [s.cadId, variantes, reais]);
      let real = await um<{ v: number }>(
        c,
        `select coalesce((grades_reais->>$2)::int,0) v from cad_grades where cad_id=$1 and variante_numero=$3`,
        [s.cadId, TAM, s.vnum],
      );
      expect(real.v).toBe(10);
      // Edita a recebida no PCP: 10 → 6. CQ confirmado + fonte ⇒ salvar_terceirizados re-deriva.
      const blocos2 = JSON.stringify([
        { id: blk.id, categoria_terceirizado_id: s.catId, ativo: true, detalhado: true, grade_detalhe: { [s.vid]: { [TAM]: { recebida: 6 } } } },
      ]);
      await c.query(`select salvar_terceirizados($1,$2::jsonb,null)`, [s.cadId, blocos2]);
      real = await um<{ v: number }>(
        c,
        `select coalesce((grades_reais->>$2)::int,0) v from cad_grades where cad_id=$1 and variante_numero=$3`,
        [s.cadId, TAM, s.vnum],
      );
      expect(real.v).toBe(6); // a Grade Real seguiu a edição do PCP
    });
  });
});
