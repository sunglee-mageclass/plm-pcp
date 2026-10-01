// Achados MÉDIOS R16 — est #7 (P-188 A): no CAD enviado ao corte, o "a enviar" de insumo COM tamanho (sem
// enviar_por_tamanho) é repartido pela grade do CAD com _split_maior_resto (Σ preservada); enviar_por_tamanho preenchido
// continua mandando; insumo sem tamanho intocado. + carona: insumo do IMPORTADO baixa pelas peças recebidas (como a
// revenda). Migration 20261026300000_insumo_baixa_por_tamanho. Tudo em txn revertida; só na cópia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";
import { splitMaiorResto } from "@/lib/produto-acabado";

const RODA = hasDb && ehBancoLocal();
const SIG = "public._estoque_etiqueta_core(uuid)";
const MD5_DEPOIS = "28aa308d297cc18b653c6290a5b3b958";

type Linha = { tam: string | null; cor: string | null; baixa: number; recebido: number; fisico: number };
async function estoque(c: Client, etq: string): Promise<Linha[]> {
  const { rows } = await c.query(
    `select e.tamanho tam, e.cor_nome cor, e.baixa::float8 baixa, e.recebido::float8 recebido, e.fisico::float8 fisico
       from public._estoque_etiqueta_core($1) e where e.etiqueta_id = $2 order by e.cor_nome nulls first, e.tamanho nulls first`,
    [TENANT_TESTE, etq],
  );
  return rows as Linha[];
}
const baixaPorTam = (ls: Linha[]) => Object.fromEntries(ls.map((l) => [l.tam ?? "∅", l.baixa]));

/** Insumo com tamanhos P/M/G (formato configurável), CAD cortado com 2 variantes de grade {P:3,M:5,G:2}. */
async function cenario(c: Client, o: { formato?: string; tamanhos?: boolean; grade?: object; corte?: boolean } = {}) {
  await comoUsuario(c);
  const etq = await um<{ id: string }>(
    c,
    `insert into etiquetas (tenant_id, nome, formato_tamanho) values ($1, $2, $3) returning id`,
    [TENANT_TESTE, `Etq R16-EST7 ${Math.random().toString(36).slice(2, 8)}`, o.formato ?? "ambos"],
  );
  if (o.tamanhos ?? true)
    for (const t of ["P", "M", "G"])
      await c.query(`insert into variantes_etiqueta (tenant_id, etiqueta_id, tamanho) values ($1,$2,$3)`, [
        TENANT_TESTE,
        etq.id,
        t,
      ]);
  const m = await um<{ id: string }>(
    c,
    `insert into modelos (tenant_id, nome, origem) values ($1,'Modelo R16-EST7','interno') returning id`,
    [TENANT_TESTE],
  );
  const cad = await um<{ id: string }>(
    c,
    `insert into cad (tenant_id, modelo_id, enviado_corte) values ($1,$2,$3) returning id`,
    [TENANT_TESTE, m.id, o.corte ?? true],
  );
  const g = JSON.stringify(o.grade ?? { P: 3, M: 5, G: 2 });
  for (const v of [1, 2])
    await c.query(
      `insert into cad_grades (cad_id, variante_numero, grades_planejadas, grade_total_planejada) values ($1,$2,$3::jsonb,10)`,
      [cad.id, v, g],
    );
  return { etq: etq.id, cad: cad.id };
}
async function aEnviar(c: Client, cad: string, etq: string, qtd: number, porTam: object = {}) {
  await c.query(
    `insert into cad_etiquetas (cad_id, etiqueta_id, consumo, quantidade_enviar, enviar_por_tamanho)
     values ($1,$2,1,$3,$4::jsonb)`,
    [cad, etq, qtd, JSON.stringify(porTam)],
  );
}

describe.skipIf(!RODA)("R16 est #7 — baixa do insumo por tamanho pela grade (P-188 A)", () => {
  it("migration aplicada: md5 de depois; DEFINER; sem EXECUTE para PUBLIC/anon/authenticated; wrapper intacto", async () => {
    await withTx(async (c) => {
      const r = await um<{ m: string; d: boolean; anon: boolean; auth: boolean; pub: boolean; w: boolean }>(
        c,
        `select md5(pg_get_functiondef(p.oid)) m, p.prosecdef d,
                has_function_privilege('anon', p.oid, 'EXECUTE') anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
                exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                        where x.grantee = 0 and x.privilege_type = 'EXECUTE') pub,
                has_function_privilege('authenticated', 'public.estoque_etiqueta()', 'EXECUTE') w
           from pg_proc p where p.oid = to_regprocedure($1)`,
        [SIG],
      );
      expect(r).toEqual({ m: MD5_DEPOIS, d: true, anon: false, auth: false, pub: false, w: true });
    });
  });

  it("insumo com tamanho, sem enviar_por_tamanho: 21 repartidos pela grade {P:6,M:10,G:4} pelo maior resto = P6 M11 G4 (Σ 21)", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await aEnviar(c, s.cad, s.etq, 21);
      const ls = await estoque(c, s.etq);
      expect(baixaPorTam(ls)).toEqual({ G: 4, M: 11, P: 6 });
      expect(ls.reduce((a, l) => a + l.baixa, 0)).toBe(21);
      // anti-drift com o espelho TS do helper (src/lib/produto-acabado.ts)
      expect(splitMaiorResto(21, { P: 6, M: 10, G: 4 })).toEqual({ P: 6, M: 11, G: 4 });
    });
  });

  it("quantidade com casas: só a parte inteira é repartida; a fração fica em 'sem tamanho' (Σ preservada)", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await aEnviar(c, s.cad, s.etq, 20.5);
      expect(baixaPorTam(await estoque(c, s.etq))).toEqual({ "∅": 0.5, G: 4, M: 10, P: 6 });
    });
  });

  it("enviar_por_tamanho preenchido continua mandando (não reparte)", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await aEnviar(c, s.cad, s.etq, 21, { P: 1, M: 2 });
      expect(baixaPorTam(await estoque(c, s.etq))).toEqual({ M: 2, P: 1 });
    });
  });

  it("intocados: insumo SEM tamanho, formato 'nenhum', CAD sem grade, quantidade < 1, CAD não cortado", async () => {
    await withTx(async (c) => {
      let s = await cenario(c, { tamanhos: false });
      await aEnviar(c, s.cad, s.etq, 21);
      expect(baixaPorTam(await estoque(c, s.etq))).toEqual({ "∅": 21 });
      s = await cenario(c, { formato: "nenhum" });
      await aEnviar(c, s.cad, s.etq, 21);
      expect(baixaPorTam(await estoque(c, s.etq))).toEqual({ "∅": 21 });
      s = await cenario(c, { grade: {} });
      await aEnviar(c, s.cad, s.etq, 21);
      expect(baixaPorTam(await estoque(c, s.etq))).toEqual({ "∅": 21 });
      s = await cenario(c);
      await aEnviar(c, s.cad, s.etq, 0.5);
      expect(baixaPorTam(await estoque(c, s.etq))).toEqual({ "∅": 0.5 });
      s = await cenario(c, { corte: false });
      await aEnviar(c, s.cad, s.etq, 21);
      expect(await estoque(c, s.etq)).toEqual([]);
    });
  });

  it("o estoque de cada tamanho desce: recebido 10 no P → físico 4 (baixa 6)", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const vP = await um<{ id: string }>(
        c,
        `select id from variantes_etiqueta where etiqueta_id = $1 and tamanho = 'P'`,
        [s.etq],
      );
      const emp = await um<{ id: string }>(c, `select id from empresas where tenant_id = $1 limit 1`, [TENANT_TESTE]);
      const oc = await um<{ id: string }>(
        c,
        `insert into ocs_etiqueta (tenant_id, empresa_id, status, numero_pedido) values ($1,$2,'recebido','R16-EST7') returning id`,
        [TENANT_TESTE, emp.id],
      );
      await c.query(
        `insert into ocs_etiqueta_itens (oc_etiqueta_id, etiqueta_id, variante_etiqueta_id, quantidade_pedida, quantidade_recebida, preco)
         values ($1,$2,$3,10,10,1)`,
        [oc.id, s.etq, vP.id],
      );
      await aEnviar(c, s.cad, s.etq, 21);
      const p = (await estoque(c, s.etq)).find((l) => l.tam === "P")!;
      expect(p).toMatchObject({ recebido: 10, baixa: 6, fisico: 4 });
    });
  });

  it("Loja Teste (Passo 0: 4 cad_etiquetas cortadas de insumo com tamanho): a baixa por tamanho = split TS da grade; Σ igual", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { rows } = await c.query(
        `select ce.etiqueta_id etq, co.nome cor, ce.quantidade_enviar::float8 qe,
                (select jsonb_object_agg(k, s) from (select kv.key k, sum((kv.value)::numeric)::float8 s from cad_grades g,
                   jsonb_each_text(g.grades_planejadas) kv where g.cad_id = ce.cad_id group by 1 having sum((kv.value)::numeric) > 0) w) pesos
           from cad_etiquetas ce join cad c on c.id = ce.cad_id and c.tenant_id = $1 and c.enviado_corte
           join etiquetas e on e.id = ce.etiqueta_id left join cores co on co.id = ce.cor_id
          where coalesce(ce.enviar_por_tamanho, '{}'::jsonb) = '{}'::jsonb and e.formato_tamanho <> 'nenhum'
            and exists (select 1 from variantes_etiqueta ve where ve.etiqueta_id = ce.etiqueta_id and ve.tamanho is not null)`,
        [TENANT_TESTE],
      );
      if (rows.length < 4) throw new Error(`fixture ausente: esperava 4 cad_etiquetas cortadas com tamanho, veio ${rows.length}`);
      const esperado = new Map<string, number>();
      const etqs = new Set<string>();
      for (const r of rows) {
        etqs.add(r.etq);
        const inteira = Math.floor(r.qe);
        const sp = r.pesos && inteira >= 1 ? splitMaiorResto(inteira, r.pesos) : {};
        for (const [t, v] of Object.entries(sp)) {
          const k = `${r.etq}|${r.cor}|${t}`;
          esperado.set(k, (esperado.get(k) ?? 0) + v);
        }
      }
      for (const etq of etqs) {
        const ls = await estoque(c, etq);
        for (const l of ls.filter((x) => x.tam != null)) {
          const k = `${etq}|${l.cor}|${l.tam}`;
          expect(l.baixa, k).toBe(esperado.get(k) ?? 0);
        }
        // nada dessas linhas fica em "sem tamanho" (quantidades inteiras)
        expect(ls.filter((x) => x.tam == null).reduce((a, x) => a + x.baixa, 0)).toBe(0);
      }
      const tot = rows.reduce((a, r) => a + r.qe, 0);
      expect([...esperado.values()].reduce((a, v) => a + v, 0)).toBe(tot);
    });
  });
});

describe.skipIf(!RODA)("R16 carona — insumo do IMPORTADO baixa pelas peças recebidas (como a revenda)", () => {
  it("importado: BOM consumo 2 × 10 peças recebidas = 20 antes do envio; interno sem envio continua 0", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const etq = await um<{ id: string }>(
        c,
        `insert into etiquetas (tenant_id, nome) values ($1,'Etq R16-IMP') returning id`,
        [TENANT_TESTE],
      );
      for (const origem of ["importado", "interno"]) {
        const m = await um<{ id: string }>(
          c,
          `insert into modelos (tenant_id, nome, origem) values ($1,$2,$3) returning id`,
          [TENANT_TESTE, `Modelo R16-IMP ${origem}`, origem],
        );
        await c.query(
          `insert into modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, consumo) values ($1,$2,$3,2)`,
          [TENANT_TESTE, m.id, etq.id],
        );
        // o que _receber_oc_importado_core grava: cad-espelho + cad_grades (grade_total_real), SEM cad_etiquetas
        const cad = await um<{ id: string }>(
          c,
          `insert into cad (tenant_id, modelo_id) values ($1,$2) returning id`,
          [TENANT_TESTE, m.id],
        );
        await c.query(
          `insert into cad_grades (cad_id, variante_numero, grades_planejadas, grade_total_real) values ($1,1,'{}'::jsonb,10)`,
          [cad.id],
        );
      }
      const ls = await estoque(c, etq.id);
      expect(ls.map((l) => [l.tam, l.baixa])).toEqual([[null, 20]]); // só o importado (o interno sem envio não baixa)
    });
  });
});
