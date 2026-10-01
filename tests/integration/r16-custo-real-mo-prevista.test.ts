// Achados MÉDIOS R16 — preço M7 (P-186 A): no custo REAL do modelo interno cortado, a M.O. é POR SERVIÇO — o lançado
// quando existe o bloco externo (ativo), senão a M.O. prevista daquele serviço (linha de modelo_servico_mo); costura
// interna sempre a prevista; "Geral (legado)" substituída pelo lançado de serviço sem linha própria.
// + caronas na mesma função: R12 INFO 6 (compra recebida sem valor real → valor da compra/landed, nunca 0) e preço M1
// (insumos da revenda = Σ custo_previsto, sem multiplicar o consumo de novo; anti-drift com a ficha).
// Migration 20261026200000_custo_real_mo_prevista. Tudo em txn revertida (nada grava); só na cópia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";
import { totaisBom } from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";
import { recomputeEtiqueta, type EtiquetaInfo } from "@/components/desenvolvimento/modelo-detail/types";

const RODA = hasDb && ehBancoLocal();
const SIG = "public._custo_unitario_modelos_core(uuid[])";
const MD5_DEPOIS = "49300957b8a81048211a0930dd0c04c7";

type Custo = {
  previsto: number;
  real: number | null;
  confirmado: boolean;
  mao_obra_real: number;
  mao_obra_previsto: number;
};
async function custos(c: Client, ids: string[]): Promise<Record<string, Custo>> {
  const r = await um<{ j: Record<string, any> }>(c, `select public._custo_unitario_modelos_core($1::uuid[]) j`, [ids]);
  const out: Record<string, Custo> = {};
  for (const [k, v] of Object.entries(r.j ?? {}))
    out[k] = {
      previsto: Number(v.previsto),
      real: v.real == null ? null : Number(v.real),
      confirmado: v.confirmado,
      mao_obra_real: Number(v.mao_obra_real),
      mao_obra_previsto: Number(v.mao_obra_previsto),
    };
  return out;
}
async function custo(c: Client, id: string): Promise<Custo> {
  return (await custos(c, [id]))[id];
}

/** Modelo interno cortado sintético: cad enviado ao corte + grade 10 peças; sem material (materiais = 0). */
async function cortado(c: Client) {
  await comoUsuario(c);
  const m = await um<{ id: string }>(
    c,
    `insert into modelos (tenant_id, nome, origem) values ($1,'ITEST-R16-M7','interno') returning id`,
    [TENANT_TESTE],
  );
  const cad = await um<{ id: string }>(
    c,
    `insert into cad (tenant_id, modelo_id, enviado_corte, data_enviado_corte) values ($1,$2,true,'2026-09-01') returning id`,
    [TENANT_TESTE, m.id],
  );
  await c.query(
    `insert into cad_grades (cad_id, variante_numero, grades_planejadas, grade_total_planejada) values ($1, 1, '{"P":10}', 10)`,
    [cad.id],
  );
  const cat = async (nome: string) =>
    (
      await um<{ id: string }>(
        c,
        `insert into categorias_terceirizado (tenant_id, nome, etapa) values ($1,$2,'ate_costura') returning id`,
        [TENANT_TESTE, `${nome} R16-M7 ${m.id.slice(0, 8)}`],
      )
    ).id;
  return { modelo: m.id, cad: cad.id, cat };
}
async function linhaMo(c: Client, modelo: string, cat: string | null, valor: number) {
  await c.query(
    `insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor) values ($1,$2,$3,$4)`,
    [TENANT_TESTE, modelo, cat, valor],
  );
}
async function blocoPt(
  c: Client,
  cad: string,
  cat: string | null,
  o: { preco: number; qtd: number; interno?: boolean; ativo?: boolean },
) {
  await c.query(
    `insert into producao_terceirizados (cad_id, tenant_id, categoria_terceirizado_id, ativo, interno, preco_metro_unidade,
                                         quantidade_enviada)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [cad, TENANT_TESTE, cat, o.ativo ?? true, o.interno ?? false, o.preco, o.qtd],
  );
}

describe.skipIf(!RODA)("R16 preço M7 — custo real com M.O. por serviço (P-186 A)", () => {
  it("migration aplicada: md5 de depois; STABLE DEFINER; sem EXECUTE para PUBLIC/anon/authenticated (inv. #9)", async () => {
    await withTx(async (c) => {
      const r = await um<{ m: string; v: string; d: boolean; anon: boolean; auth: boolean; pub: boolean }>(
        c,
        `select md5(pg_get_functiondef(p.oid)) m, p.provolatile v, p.prosecdef d,
                has_function_privilege('anon', p.oid, 'EXECUTE') anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
                exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                        where x.grantee = 0 and x.privilege_type = 'EXECUTE') pub
           from pg_proc p where p.oid = to_regprocedure($1)`,
        [SIG],
      );
      expect(r).toEqual({ m: MD5_DEPOIS, v: "s", d: true, anon: false, auth: false, pub: false });
      // o wrapper da tela segue chamável por authenticated
      const w = await um<{ a: boolean }>(
        c,
        `select has_function_privilege('authenticated','public.custo_unitario_modelos(uuid[])','EXECUTE') a`,
      );
      expect(w.a).toBe(true);
    });
  });

  it("Loja Teste (Passo 0: os 5 cortados): VESTAL 86,23 → 146,23 (CAD + M.O. prevista 60); Blusa do Teste 1 12,37 → 22,37", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const ids = {
        vestal: "1494e80b-554f-44c5-b848-6234e081e41f",
        blusaTeste1: "28072185-b00e-4362-bafa-5ff2aaac36e9",
        blusaTeste: "0c1ee839-0aa2-4826-aec3-6d507a52abeb",
        blusaTesteB: "1cf428ba-ce8f-4ed1-9c01-45b04e7dd8a1",
        blusaMaster: "537d98e9-42cf-46c5-a5b9-07e676fc1117",
      };
      const cu = await custos(c, Object.values(ids));
      for (const id of Object.values(ids)) {
        if (!cu[id]) throw new Error(`fixture ausente: cortado ${id} (Loja Teste)`);
        expect(cu[id].confirmado, id).toBe(true);
      }
      // VESTAL: só a linha "Geral (legado)" 60, nenhum bloco → M.O. prevista entra inteira; materiais do CAD 86,23
      expect(cu[ids.vestal].real).toBeCloseTo(146.23, 6);
      expect(cu[ids.vestal].mao_obra_real).toBeCloseTo(60, 6);
      expect(cu[ids.vestal].real! - cu[ids.vestal].mao_obra_real).toBeCloseTo(86.23, 6);
      expect(cu[ids.vestal].previsto).toBeCloseTo(134.98, 6); // previsto (materiais do BOM 74,98 + 60) intocado
      // Blusa do Teste 1: Corte 10 sem bloco → prevista; PL lançado 9 (sem linha) substitui o "Geral" 9
      expect(cu[ids.blusaTeste1].mao_obra_real).toBeCloseTo(19, 6);
      expect(cu[ids.blusaTeste1].real).toBeCloseTo(22.37, 6);
      // sem mudança: os lançados cobrem tudo → M.O. = só o lançado ÷ grade (a conta de antes; grade lida ao vivo)
      for (const id of [ids.blusaTeste, ids.blusaTesteB, ids.blusaMaster]) {
        const l = await um<{ v: string }>(
          c,
          `select (select coalesce(sum(coalesce(pt.preco_metro_unidade,0)*coalesce(pt.quantidade_enviada,0)
                                       - coalesce(pt.desconto_total,0) + coalesce(pt.multa_total,0)),0)
                     from producao_terceirizados pt where pt.cad_id = c.id and not coalesce(pt.interno,false))
                  / nullif((select sum(coalesce(g.grade_total_real, g.grade_total_planejada, 0)) from cad_grades g
                             where g.cad_id = c.id), 0) v
             from cad c where c.modelo_id = $1 and c.enviado_corte`,
          [id],
        );
        expect(cu[id].mao_obra_real, id).toBeCloseTo(Number(l.v), 6);
      }
    });
  });

  it("por serviço: sem bloco = prevista; bloco externo = lançado/grade; interno = prevista; inativo não conta; 'Geral' sai só com lançado sem linha", async () => {
    await withTx(async (c) => {
      const f = await cortado(c);
      const corte = await f.cat("Corte");
      const costura = await f.cat("Costura");
      const bordado = await f.cat("Bordado");
      await linhaMo(c, f.modelo, corte, 5);
      await linhaMo(c, f.modelo, costura, 8);
      await linhaMo(c, f.modelo, null, 2); // Geral (legado)
      let k = await custo(c, f.modelo);
      expect(k.confirmado).toBe(true);
      expect(k.mao_obra_previsto).toBeCloseTo(15, 6);
      expect(k.mao_obra_real).toBeCloseTo(15, 6); // nada lançado: tudo previsto (antes: 0)
      expect(k.real).toBeCloseTo(15, 6);
      // Corte lançado externo: 3 × 10 / 10 peças = 3 (troca a prevista 5)
      await blocoPt(c, f.cad, corte, { preco: 3, qtd: 10 });
      k = await custo(c, f.modelo);
      expect(k.mao_obra_real).toBeCloseTo(3 + 8 + 2, 6);
      // Costura INTERNA: nunca tem lançado → segue a prevista 8
      await blocoPt(c, f.cad, costura, { preco: 20, qtd: 10, interno: true });
      expect((await custo(c, f.modelo)).mao_obra_real).toBeCloseTo(13, 6);
      // bloco externo INATIVO não conta (nem como lançado, nem tira a prevista)
      await blocoPt(c, f.cad, costura, { preco: 100, qtd: 10, ativo: false });
      expect((await custo(c, f.modelo)).mao_obra_real).toBeCloseTo(13, 6);
      // Bordado lançado SEM linha própria: entra o lançado (1) e sai o "Geral" 2
      await blocoPt(c, f.cad, bordado, { preco: 1, qtd: 10 });
      k = await custo(c, f.modelo);
      expect(k.mao_obra_real).toBeCloseTo(3 + 8 + 1, 6);
      // Costura lançada externa (além da interna): lançado 4 troca a prevista 8
      await blocoPt(c, f.cad, costura, { preco: 4, qtd: 10 });
      k = await custo(c, f.modelo);
      expect(k.mao_obra_real).toBeCloseTo(3 + 4 + 1, 6);
      // invariante do front: Materiais = real − mao_obra_real (aqui 0, sem material)
      expect(k.real! - k.mao_obra_real).toBeCloseTo(0, 6);
    });
  });

  it("bloco externo lançado com valor 0 ainda é 'o lançado' do serviço (existe o bloco); grade 0 → lançado 0/peça", async () => {
    await withTx(async (c) => {
      const f = await cortado(c);
      const corte = await f.cat("Corte");
      await linhaMo(c, f.modelo, corte, 5);
      await blocoPt(c, f.cad, corte, { preco: 0, qtd: 0 });
      expect((await custo(c, f.modelo)).mao_obra_real).toBeCloseTo(0, 6);
    });
  });

  it("modelo NÃO cortado: intocado (real = custo_peca_previsto; mao_obra_real 0)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const m = await um<{ id: string }>(
        c,
        `insert into modelos (tenant_id, nome, origem, custo_peca_previsto) values ($1,'ITEST-R16-M7-NC','interno',42.5) returning id`,
        [TENANT_TESTE],
      );
      await linhaMo(c, m.id, null, 7);
      const k = await custo(c, m.id);
      expect(k).toMatchObject({ confirmado: false, real: 42.5, mao_obra_real: 0, mao_obra_previsto: 7 });
    });
  });
});

describe.skipIf(!RODA)("R16 caronas na fonte única do custo: R12 INFO 6 + preço M1 (CTE pa)", () => {
  async function revenda(c: Client) {
    await comoUsuario(c);
    const r = await um<
      { modelo: string; oc: string; vu: string; dp: string; vur: string | null; ins: string } | undefined
    >(
      c,
      `select m.id modelo, oc.id oc, p.valor_unitario::text vu, p.desconto_pct::text dp, oc.valor_unitario_real::text vur,
              (select coalesce(sum(coalesce(me.custo_previsto,0)),0) from modelo_etiquetas me where me.modelo_id = m.id)::text ins
         from produtos_acabados p join modelos m on m.id = p.modelo_id join ocs_p_acabado oc on oc.produto_acabado_id = p.id
        where m.tenant_id = $1 and m.nome = 'Vestido Teste' and m.origem = 'revenda' limit 1`,
      [TENANT_TESTE],
    );
    if (!r) throw new Error("fixture ausente: Vestido Teste (revenda com OC) na Loja Teste");
    return r;
  }

  it("INFO 6 revenda: OC RECEBIDA sem valor real (coluna NOT NULL DEFAULT 0 → 0) → real = bruto × (1 − desconto) + insumos (antes: só insumos)", async () => {
    await withTx(async (c) => {
      const r = await revenda(c);
      const bruto = Number(r.vu) * (1 - Number(r.dp) / 100);
      const ins = Number(r.ins);
      expect((await custo(c, r.modelo)).real).toBeNull(); // encomendada: real nulo (intocado)
      await c.query(`update ocs_p_acabado set status = 'recebido', valor_unitario_real = 0 where id = $1`, [r.oc]);
      let k = await custo(c, r.modelo);
      expect(k.confirmado).toBe(true);
      expect(k.real).toBeCloseTo(bruto + ins, 6);
      expect(k.real).toBeGreaterThan(0);
      // com valor real: ele manda (como antes)
      await c.query(`update ocs_p_acabado set valor_unitario_real = 31.5 where id = $1`, [r.oc]);
      k = await custo(c, r.modelo);
      expect(k.real).toBeCloseTo(31.5 + ins, 6);
      // previsto intocado pela regra
      expect(k.previsto).toBeCloseTo(bruto + ins, 6);
    });
  });

  it("INFO 6 importado: OC RECEBIDA sem landed real (NOT NULL DEFAULT 0 → 0) → real = landed do card (antes: 0)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const r = await um<{ modelo: string; oc: string; pi: string } | undefined>(
        c,
        `select m.id modelo, oc.id oc, p.id pi from produtos_importados p join modelos m on m.id = p.modelo_id
           join ocs_importado oc on oc.produto_importado_id = p.id
          where m.tenant_id = $1 and m.nome = 'QA T25 importado' limit 1`,
        [TENANT_TESTE],
      );
      if (!r) throw new Error("fixture ausente: QA T25 importado (com OC) na Loja Teste");
      const landed = Number((await um<{ l: string }>(c, `select public._imp_custo_landed($1)::text l`, [r.pi])).l);
      expect(landed).toBeGreaterThan(0);
      await c.query(`update ocs_importado set status = 'recebido', custo_unitario_landed_real = 0 where id = $1`, [r.oc]);
      let k = await custo(c, r.modelo);
      expect(k.confirmado).toBe(true);
      expect(k.real).toBeCloseTo(landed, 6);
      await c.query(`update ocs_importado set custo_unitario_landed_real = 99.5 where id = $1`, [r.oc]);
      k = await custo(c, r.modelo);
      expect(k.real).toBeCloseTo(99.5, 6);
    });
  });

  it("preço M1: insumo com consumo 2 entra UMA vez (Σ custo_previsto) — anti-drift com a ficha (recomputeEtiqueta + totaisBom)", async () => {
    await withTx(async (c) => {
      const r = await revenda(c);
      const etq = await um<{ id: string } | undefined>(
        c,
        `select id from etiquetas where tenant_id = $1 order by id limit 1`,
        [TENANT_TESTE],
      );
      if (!etq) throw new Error("fixture ausente: insumo na Loja Teste");
      const antes = await custo(c, r.modelo);
      // linha como a ficha grava: custo_previsto = preço 1,50 × consumo 2 × (1 + 10%) = 3,30
      const info: EtiquetaInfo = { id: etq.id, nome: "x", formato_tamanho: "nenhum", preco: 1.5, variantes: [] };
      const linha = recomputeEtiqueta(
        { etiqueta_id: etq.id, cor_id: null, consumo: 2, loss_percent: 10, custo_previsto: 0 },
        { [etq.id]: info },
      );
      expect(linha.custo_previsto).toBeCloseTo(3.3, 6);
      await c.query(
        `insert into modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, numero, consumo, loss_percent, custo_previsto)
         values ($1,$2,$3,null,99,$4,$5,$6)`,
        [TENANT_TESTE, r.modelo, etq.id, linha.consumo, linha.loss_percent, linha.custo_previsto],
      );
      const depois = await custo(c, r.modelo);
      expect(depois.previsto - antes.previsto).toBeCloseTo(3.3, 6); // antes da R16: 6,60 (consumo contado 2×)
      // anti-drift: a parte de insumos do servidor = totaisBom(...).etiqueta da ficha para as MESMAS linhas
      const linhas = (
        await c.query(
          `select etiqueta_id, cor_id, consumo::float8 consumo, loss_percent::float8 loss_percent, custo_previsto::float8 custo_previsto
             from modelo_etiquetas where modelo_id = $1`,
          [r.modelo],
        )
      ).rows;
      const t = totaisBom({ blocks: [], aviamentos: [], etiquetas: linhas, custosAdicionais: [], maoObra: 0 });
      const bruto = Number(r.vu) * (1 - Number(r.dp) / 100);
      expect(depois.previsto - bruto).toBeCloseTo(t.etiqueta, 6);
    });
  });
});
