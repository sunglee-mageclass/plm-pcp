// Camada intermediária C1 (desenho .superpowers/sdd/2026-10-05-camada/desenho.md §2.4; P-77 A, P-262 A, P-268 A).
// Migrations GERADAS por mig/gerar-c1.mjs: 20261103160000_camada_estado_vazio (6 wrappers de ESTADO COMPLETO recusam lista VAZIA
// com linhas no servidor — 'estado_vazio_recusado: <entidade> <n>' — a não ser com a marca "apagar tudo"; salvar_terceirizados diz
// QUAIS serviços têm parcela paga) e 20261103161000_camada_parcela_paga (gatilho BEFORE DELETE em producao_terceirizados: serviço com
// parcela PAGA não é excluído por caminho nenhum, exceto session_replication_role=replica do reset/excluir loja).
// Cada caso em transação revertida (withTx) e SÓ na cópia local: as migrations são aplicadas DENTRO da txn (camada-helpers/mig-txn,
// nunca \i). RPCs chamadas como o super admin da Loja Teste (JWT; a página/módulo já são provados pela S3a/S3b), fixtures como
// postgres sem JWT.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import {
  hasDb,
  ehBancoLocal,
  withTx,
  comoUsuario,
  semJwt,
  um,
  TENANT_TESTE,
  USER_TESTE,
} from "./db";
import { aplicarArquivo } from "./mig-txn";
import { aplicaCamada, voltaCamada, camadaVazioViva, camadaGatViva } from "./camada-helpers";
import { aplicaBk } from "./bk-helpers";
import { aplicaMod } from "./mod-helpers";
import {
  CAMADA_MD5,
  CAMADA_ACL,
  CAMADA_ENTIDADE,
  CAMADA_GAT,
  CAMADA_MIG,
  CAMADA_DOWN,
  CAMADA_MIG_GAT,
  CAMADA_DOWN_GAT,
  CAMADA_DROP_GAT,
} from "./camada-1-dados";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const U_OC = "c1c1c1c1-0000-4000-8000-0000000000c1"; // usuário comum da Loja Teste que edita OC Tecido (sem oráculo)

type Res = { ok: true; rows: Record<string, unknown>[] } | { ok: false; code: string; msg: string };
async function tenta(c: Client, sql: string, params: unknown[] = []): Promise<Res> {
  await c.query("SAVEPOINT c1");
  try {
    const r = await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT c1");
    return { ok: true, rows: r.rows };
  } catch (e) {
    const er = e as { code?: string; message?: string };
    await c.query("ROLLBACK TO SAVEPOINT c1");
    await c.query("RELEASE SAVEPOINT c1");
    return { ok: false, code: String(er.code ?? ""), msg: String(er.message ?? "") };
  }
}
const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);
const n = async (c: Client, sql: string, params: unknown[]) =>
  Number((await um<{ n: string }>(c, sql, params)).n);
const md5Fn = async (c: Client, sig: string) =>
  (
    await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [
      sig,
    ])
  ).m;

/** `_rev_base` como a tela manda (C1 I2): o rev de TODO bloco do cad + extras (marcas/molde). */
async function revsBase(
  c: Client,
  cadId: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const r = await um<{ b: Record<string, number> }>(
    c,
    `select coalesce(jsonb_object_agg(id::text, rev), '{}'::jsonb) b from producao_terceirizados where cad_id = $1`,
    [cadId],
  );
  return JSON.stringify({ ...r.b, ...extra });
}

async function prepara(c: Client): Promise<void> {
  await c.query("SET LOCAL statement_timeout = '180s'");
  await aplicaMod(c); // idempotentes (cópia já com Modularidade/Backend)
  await aplicaBk(c);
  await aplicaCamada(c);
  await comoUsuario(c); // super admin da Loja Teste
}

// ───────────────────────────── fixtures (postgres, sem JWT) ─────────────────────────────
/** cad (com card: o excluir_cad exige o modelo) da Loja Teste. */
async function cad(c: Client): Promise<string> {
  return semJwt(c, async () => {
    const m = (
      await um<{ id: string }>(
        c,
        `insert into modelos (tenant_id, nome) values ($1, 'C1 card') returning id`,
        [T],
      )
    ).id;
    return (
      await um<{ id: string }>(
        c,
        `insert into cad (tenant_id, modelo_id) values ($1, $2) returning id`,
        [T, m],
      )
    ).id;
  });
}
/** cad com 2 serviços (Costura C1 e Lavanderia C1); `pagas` = nº das parcelas PAGAS do 1º (Costura). */
async function cadComServicos(
  c: Client,
  pagas: number[] = [],
): Promise<{ cad: string; costura: string; lav: string }> {
  const id = await cad(c);
  return semJwt(c, async () => {
    const cat = async (nome: string) =>
      (
        await um<{ id: string }>(
          c,
          // reaproveita a categoria se o teste montar mais de um cad na mesma txn (nome único por loja)
          `with ja as (select id from categorias_terceirizado where tenant_id = $1 and nome = $2 limit 1),
                novo as (insert into categorias_terceirizado (tenant_id, nome)
                         select $1, $2 where not exists (select 1 from ja) returning id)
           select id from ja union all select id from novo`,
          [T, nome],
        )
      ).id;
    const serv = async (cat: string) =>
      (
        await um<{ id: string }>(
          c,
          `insert into producao_terceirizados (cad_id, tenant_id, ativo, categoria_terceirizado_id, numero_parcelas) values ($1, $2, true, $3, 2) returning id`,
          [id, T, cat],
        )
      ).id;
    const costura = await serv(await cat("Costura C1"));
    const lav = await serv(await cat("Lavanderia C1"));
    // parcelas: a correcao unica e o unico caminho que grava 'pago' sem a conta do prazo (fixture)
    await c.query("SELECT set_config('app.servico_valor_pago_correcao', 'on', true)");
    for (const [pt, num, pago] of [
      [costura, 1, pagas.includes(1)],
      [costura, 2, pagas.includes(2)],
      [lav, 1, false],
    ] as const) {
      await c.query(
        `insert into parcelas_servico (tenant_id, producao_terceirizado_id, numero_parcela, status, data_pagamento) values ($1, $2, $3, $4, $5)`,
        [T, pt, num, pago ? "pago" : "a_pagar", pago ? "2026-10-01" : null],
      );
    }
    await c.query("SELECT set_config('app.servico_valor_pago_correcao', '', true)");
    return { cad: id, costura, lav };
  });
}
async function cadComDirecionamento(c: Client): Promise<string> {
  const id = await cad(c);
  await semJwt(c, async () => {
    const lojas = (
      await c.query(
        `select id from lojas_direcionamento where tenant_id = $1 and ativo order by nome limit 2`,
        [T],
      )
    ).rows;
    for (const l of lojas)
      await c.query(
        `insert into direcionamento_lojas (tenant_id, cad_id, loja_id, variante_numero, grades) values ($1, $2, $3, 1, '{}')`,
        [T, id, l.id],
      );
    await c.query(
      `insert into controle_qualidade (cad_id, tenant_id, status) values ($1, $2, 'confirmado')`,
      [id, T],
    );
  });
  return id;
}
// `campos` = as chaves que o _core exige para MANTER o item (sem elas o item conta como removido) — lidas do cadastro da Loja Teste
const OCS = {
  tecido: {
    oc: "ocs_tecido",
    itens: "ocs_tecido_itens",
    fk: "oc_tecido_id",
    rpc: "salvar_oc_tecido",
    campos: `select a.id artigo_id, v.id variante_tecido_id from artigos a join variantes_tecido v on v.artigo_id = a.id where a.tenant_id = $1 order by a.id, v.id limit 1`,
  },
  aviamento: {
    oc: "ocs_aviamento",
    itens: "ocs_aviamento_itens",
    fk: "oc_aviamento_id",
    rpc: "salvar_oc_aviamento",
    campos: `select id aviamento_id from aviamentos where tenant_id = $1 order by id limit 1`,
  },
  etiqueta: {
    oc: "ocs_etiqueta",
    itens: "ocs_etiqueta_itens",
    fk: "oc_etiqueta_id",
    rpc: "salvar_oc_etiqueta",
    campos: `select id etiqueta_id from etiquetas where tenant_id = $1 order by id limit 1`,
  },
} as const;
type Fam = keyof typeof OCS;
async function ocComItens(
  c: Client,
  f: Fam,
  tenant = T,
): Promise<{ oc: string; itens: string[]; campos: Record<string, string> }> {
  const o = OCS[f];
  return semJwt(c, async () => {
    const oc = (
      await um<{ id: string }>(
        c,
        `insert into ${o.oc} (tenant_id, numero_pedido) values ($1, $2) returning id`,
        [tenant, `C1-${f}-${Math.random().toString(36).slice(2, 8)}`],
      )
    ).id;
    const campos = tenant === T ? await um<Record<string, string>>(c, o.campos, [T]) : {};
    expect(
      tenant !== T || Object.keys(campos ?? {}).length > 0,
      `${f}: a Loja Teste precisa de cadastro para o item`,
    ).toBe(true);
    const cols = Object.keys(campos);
    const itens: string[] = [];
    for (let i = 0; i < 2; i++)
      itens.push(
        (
          await um<{ id: string }>(
            c,
            `insert into ${o.itens} (${[o.fk, ...cols].join(", ")}) values (${[o.fk, ...cols].map((_, k) => `$${k + 1}`).join(", ")}) returning id`,
            [oc, ...cols.map((k) => campos[k])],
          )
        ).id,
      );
    return { oc, itens, campos };
  });
}
const salvarOc = (f: Fam, oc: string, ocJson: Record<string, unknown>, itens: unknown[]) =>
  [
    `select public.${OCS[f].rpc}($1, $2::jsonb, $3::jsonb, null::int)`,
    [oc, JSON.stringify(ocJson), JSON.stringify(itens)],
  ] as const;
const itensDe = async (c: Client, f: Fam, oc: string) =>
  (
    await c.query(`select id from ${OCS[f].itens} where ${OCS[f].fk} = $1 order by id`, [oc])
  ).rows.map((r) => r.id as string);

// ─────────────────────────────────────────── (a)(b)(c)(d) estado vazio ───────────────────────────────────────────
describe.skipIf(!RODA)("camada C1 — estado completo vazio (P-77 A / P-262 A)", () => {
  it("salvar_terceirizados: vazio com serviços = recusa e NADA apaga; com a marca apaga; servidor vazio passa; lista com 1 apaga só o outro", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const s = await cadComServicos(c);
      const conta = () =>
        n(c, `select count(*) n from producao_terceirizados where cad_id = $1`, [s.cad]);
      for (const base of [null, {}, { [s.costura]: 0 }, [], 5]) {
        const r = await tenta(c, `select salvar_terceirizados($1, '[]'::jsonb, null, $2::jsonb)`, [
          s.cad,
          base === null ? null : JSON.stringify(base),
        ]);
        expect(txt(r)).toBe("P0001 estado_vazio_recusado: servicos 2");
        expect(await conta()).toBe(2);
      }
      // _blocos null / não-lista também apagavam tudo hoje: contam como vazio
      for (const blocos of [null, '{"x":1}', "null"]) {
        const r = await tenta(c, `select salvar_terceirizados($1, $2::jsonb, null, null)`, [
          s.cad,
          blocos,
        ]);
        expect(txt(r), String(blocos)).toBe("P0001 estado_vazio_recusado: servicos 2");
      }
      // marca falsa / outra chave = recusa
      for (const base of [
        { _apagar_tudo: false },
        { apagar_tudo: true },
        { _apagar_tudo: "sim" },
        { _apagar_tudo: true }, // M1: a marca dos serviços é a contagem N; sem número = sem marca
      ]) {
        expect(
          txt(
            await tenta(c, `select salvar_terceirizados($1, '[]'::jsonb, null, $2::jsonb)`, [
              s.cad,
              JSON.stringify(base),
            ]),
          ),
        ).toBe("P0001 estado_vazio_recusado: servicos 2");
      }
      // lista com 1 bloco: comportamento de antes (o outro sai; nada de recusa)
      await c.query("SAVEPOINT um");
      expect(
        txt(
          await tenta(c, `select salvar_terceirizados($1, $2::jsonb, null, null)`, [
            s.cad,
            JSON.stringify([{ id: s.costura, ativo: true }]),
          ]),
        ),
      ).toBe("PASSOU");
      expect(await conta()).toBe(1);
      await c.query("ROLLBACK TO SAVEPOINT um");
      // com a marca N = 2 (número ou texto): apaga tudo
      for (const marca of [2, "2"]) {
        await c.query("SAVEPOINT m");
        expect(
          txt(
            await tenta(c, `select salvar_terceirizados($1, '[]'::jsonb, null, $2::jsonb)`, [
              s.cad,
              await revsBase(c, s.cad, { _apagar_tudo: marca }),
            ]),
          ),
        ).toBe("PASSOU");
        expect(await conta()).toBe(0);
        // servidor já vazio + lista vazia: passa sem marca
        expect(
          txt(await tenta(c, `select salvar_terceirizados($1, '[]'::jsonb, null, null)`, [s.cad])),
        ).toBe("PASSOU");
        await c.query("ROLLBACK TO SAVEPOINT m");
      }
    });
  });

  it("salvar/confirmar_direcionamento: vazio com linhas = recusa sempre (a tela nunca manda a marca); marca 'apagar_tudo' apaga; servidor vazio passa", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const id = await cadComDirecionamento(c);
      const conta = () =>
        n(c, `select count(*) n from direcionamento_lojas where cad_id = $1`, [id]);
      expect(await conta()).toBe(2);
      for (const fn of ["salvar_direcionamento", "confirmar_direcionamento"]) {
        for (const base of [{}, { dir: null }, { _apagar_tudo: true }]) {
          const r = await tenta(c, `select ${fn}($1, '[]'::jsonb, $2::jsonb)`, [
            id,
            JSON.stringify(base),
          ]);
          expect(txt(r), fn).toBe("P0001 estado_vazio_recusado: direcionamento 2");
          expect(await conta()).toBe(2);
        }
        await c.query("SAVEPOINT m");
        expect(
          txt(
            await tenta(c, `select ${fn}($1, '[]'::jsonb, '{"apagar_tudo": true}'::jsonb)`, [id]),
          ),
          fn,
        ).toBe("PASSOU");
        expect(await conta()).toBe(0);
        expect(txt(await tenta(c, `select ${fn}($1, '[]'::jsonb, '{}'::jsonb)`, [id])), fn).toBe(
          "PASSOU",
        );
        await c.query("ROLLBACK TO SAVEPOINT m");
      }
      // lista com 1 linha: a outra sai (estado completo, como antes)
      const uma = (
        await c.query(
          `select loja_id, variante_numero from direcionamento_lojas where cad_id = $1 limit 1`,
          [id],
        )
      ).rows;
      expect(
        txt(
          await tenta(c, `select salvar_direcionamento($1, $2::jsonb, '{}'::jsonb)`, [
            id,
            JSON.stringify(uma.map((r) => ({ ...r, grades: {} }))),
          ]),
        ),
      ).toBe("PASSOU");
      expect(await conta()).toBe(1);
    });
  });

  for (const f of Object.keys(OCS) as Fam[]) {
    it(`${OCS[f].rpc}: vazio com itens = recusa e NADA apaga; '_apagar_itens' apaga; OC nova/servidor vazio passa; lista com 1 apaga só o outro`, async () => {
      await withTx(async (c) => {
        await prepara(c);
        const { oc, itens, campos } = await ocComItens(c, f);
        const ocJson = { numero_pedido: `C1-${f}` };
        for (const extra of [{}, { _apagar_itens: false }, { _apagar_tudo: true }]) {
          const [sql, p] = salvarOc(f, oc, { ...ocJson, ...extra }, []);
          expect(txt(await tenta(c, sql, [...p]))).toBe("P0001 estado_vazio_recusado: itens_oc 2");
          expect(await itensDe(c, f, oc)).toEqual([...itens].sort());
        }
        // _itens null também = vazio
        expect(
          txt(
            await tenta(c, `select public.${OCS[f].rpc}($1, $2::jsonb, null::jsonb, null::int)`, [
              oc,
              JSON.stringify(ocJson),
            ]),
          ),
        ).toBe("P0001 estado_vazio_recusado: itens_oc 2");
        await c.query("SAVEPOINT um");
        const [s1, p1] = salvarOc(f, oc, ocJson, [{ id: itens[0], ...campos }]);
        expect(txt(await tenta(c, s1, [...p1]))).toBe("PASSOU");
        expect(await itensDe(c, f, oc)).toEqual([itens[0]]);
        await c.query("ROLLBACK TO SAVEPOINT um");
        await c.query("SAVEPOINT m");
        const [s2, p2] = salvarOc(f, oc, { ...ocJson, _apagar_itens: true }, []);
        expect(txt(await tenta(c, s2, [...p2]))).toBe("PASSOU");
        expect(await itensDe(c, f, oc)).toEqual([]);
        const [s3, p3] = salvarOc(f, oc, ocJson, []);
        expect(txt(await tenta(c, s3, [...p3]))).toBe("PASSOU"); // servidor já vazio
        await c.query("ROLLBACK TO SAVEPOINT m");
        // OC nova (id null) sem itens: passa
        expect(
          txt(
            await tenta(c, `select public.${OCS[f].rpc}(null, $1::jsonb, '[]'::jsonb, null::int)`, [
              JSON.stringify({ numero_pedido: `C1N-${f}` }),
            ]),
          ),
        ).toBe("PASSOU");
      });
    });
  }

  it("sem oráculo: OC de OUTRA loja com lista vazia não responde 'estado_vazio_recusado' para usuário comum", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const outra = (
        await um<{ id: string }>(c, `select id from tenants where id <> $1 order by id limit 1`, [
          T,
        ])
      ).id;
      const { oc } = await ocComItens(c, "tecido", outra);
      await semJwt(c, async () => {
        await c.query(
          `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
          [U_OC, `${U_OC}@teste`],
        );
        await c.query(
          `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'C1', 'user')
                        ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
          [U_OC, T, `${U_OC}@teste`],
        );
        await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [U_OC]);
        await c.query(
          `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, 'entrada_oc_tecido', true, true)`,
          [U_OC, T],
        );
      });
      await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: U_OC, role: "authenticated" }),
      ]);
      const [sql, p] = salvarOc("tecido", oc, { numero_pedido: "X" }, []);
      const r = await tenta(c, sql, [...p]);
      expect(txt(r)).not.toMatch(/estado_vazio_recusado/);
      expect(
        await semJwt(c, () =>
          n(c, `select count(*) n from ocs_tecido_itens where oc_tecido_id = $1`, [oc]),
        ),
      ).toBe(2);
    });
  });

  it("(d) lista NÃO vazia: resultado igual ao da função de ANTES (texto do _down), nos 6 wrappers", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const s = await cadComServicos(c);
      const d = await cadComDirecionamento(c);
      const ocs = {
        tecido: await ocComItens(c, "tecido"),
        aviamento: await ocComItens(c, "aviamento"),
        etiqueta: await ocComItens(c, "etiqueta"),
      };
      const uma = (
        await c.query(
          `select loja_id, variante_numero from direcionamento_lojas where cad_id = $1 order by loja_id limit 1`,
          [d],
        )
      ).rows.map((r) => ({ ...r, grades: {} }));
      const cenario = async () => {
        const out: Record<string, unknown> = {};
        out.terc = txt(
          await tenta(c, `select salvar_terceirizados($1, $2::jsonb, null, null)`, [
            s.cad,
            JSON.stringify([{ id: s.lav, ativo: true }]),
          ]),
        );
        out.terc_ids = (
          await c.query(`select id from producao_terceirizados where cad_id = $1 order by id`, [
            s.cad,
          ])
        ).rows;
        out.dir = txt(
          await tenta(c, `select salvar_direcionamento($1, $2::jsonb, '{}'::jsonb)`, [
            d,
            JSON.stringify(uma),
          ]),
        );
        out.conf = txt(
          await tenta(c, `select confirmar_direcionamento($1, $2::jsonb, '{}'::jsonb)`, [
            d,
            JSON.stringify(uma),
          ]),
        );
        out.dir_ids = (
          await c.query(
            `select loja_id from direcionamento_lojas where cad_id = $1 order by loja_id`,
            [d],
          )
        ).rows;
        for (const f of Object.keys(OCS) as Fam[]) {
          const [sql, p] = salvarOc(f, ocs[f].oc, { numero_pedido: `D-${f}` }, [
            { id: ocs[f].itens[1], ...ocs[f].campos },
          ]);
          out[f] = txt(await tenta(c, sql, [...p]));
          out[`${f}_ids`] = await itensDe(c, f, ocs[f].oc);
        }
        return out;
      };
      await c.query("SAVEPOINT d");
      const depois = await cenario();
      await c.query("ROLLBACK TO SAVEPOINT d");
      await voltaCamada(c);
      expect(await camadaVazioViva(c)).toBe(false);
      const antes = await cenario();
      expect(depois).toEqual(antes);
      expect(depois.terc).toBe("PASSOU");
      expect(depois.tecido).toBe("PASSOU");
      for (const f of Object.keys(OCS) as Fam[])
        expect(depois[`${f}_ids`], f).toEqual([ocs[f].itens[1]]);
    });
  });
});

// ─────────────────────────────────────────── P-268 A: parcela paga ───────────────────────────────────────────
describe.skipIf(!RODA)("camada C1 — serviço com parcela PAGA não é excluído (P-268 A)", () => {
  it("salvar_terceirizados: tirar o serviço pago = 'servico_com_parcela_paga:' com QUAIS (categoria: parcela n); nada muda", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const s = await cadComServicos(c, [1, 2]);
      const r = await tenta(c, `select salvar_terceirizados($1, $2::jsonb, null, null)`, [
        s.cad,
        JSON.stringify([{ id: s.lav, ativo: true }]),
      ]);
      expect(txt(r)).toBe("P0001 servico_com_parcela_paga: Costura C1: parcela 1, 2");
      // com a marca "apagar tudo" e lista vazia: a regra da parcela paga segue valendo
      const r2 = await tenta(c, `select salvar_terceirizados($1, '[]'::jsonb, null, $2::jsonb)`, [
        s.cad,
        await revsBase(c, s.cad, { _apagar_tudo: 2 }),
      ]);
      expect(txt(r2)).toBe("P0001 servico_com_parcela_paga: Costura C1: parcela 1, 2");
      expect(
        await n(c, `select count(*) n from producao_terceirizados where cad_id = $1`, [s.cad]),
      ).toBe(2);
      expect(
        await n(
          c,
          `select count(*) n from parcelas_servico where producao_terceirizado_id = $1 and status = 'pago'`,
          [s.costura],
        ),
      ).toBe(2);
      // remover o NÃO pago segue funcionando (a Lavanderia sai; a parcela a pagar dela vai junto pela cascata)
      expect(
        txt(
          await tenta(c, `select salvar_terceirizados($1, $2::jsonb, null, null)`, [
            s.cad,
            JSON.stringify([{ id: s.costura, ativo: true }]),
          ]),
        ),
      ).toBe("PASSOU");
      expect(
        await n(c, `select count(*) n from parcelas_servico where producao_terceirizado_id = $1`, [
          s.lav,
        ]),
      ).toBe(0);
    });
  });

  it("gatilho: excluir_cad / DELETE direto (postgres, cascata do cad) recusam com o serviço e as parcelas; desmarcar o pagamento e excluir passa", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const s = await cadComServicos(c, [2]);
      // excluir_cad (RPC da tela, cascata cad → serviço)
      expect(txt(await tenta(c, `select excluir_cad($1)`, [s.cad]))).toBe(
        "P0001 servico_com_parcela_paga: Costura C1: parcela 2",
      );
      // SQL direto como postgres, sem JWT: o próprio serviço e pela cascata do cad
      for (const sql of [
        `delete from producao_terceirizados where id = $1`,
        `delete from cad where id = $1`,
      ]) {
        const r = await semJwt(c, () =>
          tenta(c, sql, [sql.includes("cad where") ? s.cad : s.costura]),
        );
        expect(txt(r), sql).toBe("P0001 servico_com_parcela_paga: Costura C1: parcela 2");
      }
      // pago só por data_pagamento (status a_pagar) também conta como pago (mesma regra do fn_servico_parcela_valor_pago)
      await semJwt(c, async () => {
        await c.query("SELECT set_config('app.servico_valor_pago_correcao', 'on', true)");
        await c.query(
          `update parcelas_servico set status = 'a_pagar', data_pagamento = '2026-10-02' where producao_terceirizado_id = $1 and numero_parcela = 2`,
          [s.costura],
        );
        await c.query("SELECT set_config('app.servico_valor_pago_correcao', '', true)");
      });
      expect(
        txt(
          await semJwt(c, () =>
            tenta(c, `delete from producao_terceirizados where id = $1`, [s.costura]),
          ),
        ),
      ).toBe("P0001 servico_com_parcela_paga: Costura C1: parcela 2");
      // o serviço NÃO pago sai normalmente
      expect(
        txt(
          await semJwt(c, () =>
            tenta(c, `delete from producao_terceirizados where id = $1`, [s.lav]),
          ),
        ),
      ).toBe("PASSOU");
      // desmarcar o pagamento (como a tela: status/data) → excluir passa
      await semJwt(c, async () => {
        await c.query(
          `update parcelas_servico set status = 'a_pagar', data_pagamento = null where producao_terceirizado_id = $1`,
          [s.costura],
        );
      });
      expect(txt(await tenta(c, `select excluir_cad($1)`, [s.cad]))).toBe("PASSOU");
      expect(
        await n(c, `select count(*) n from parcelas_servico where producao_terceirizado_id = $1`, [
          s.costura,
        ]),
      ).toBe(0);
    });
  });

  it("reset/excluir loja: session_replication_role = replica (o _wipe_tenant_core) NÃO é barrado; rótulo 'sem categoria'", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const s = await cadComServicos(c, [1]);
      await semJwt(c, async () => {
        await c.query(
          `update producao_terceirizados set categoria_terceirizado_id = null where id = $1`,
          [s.costura],
        );
      });
      expect(
        txt(
          await semJwt(c, () =>
            tenta(c, `delete from producao_terceirizados where id = $1`, [s.costura]),
          ),
        ),
      ).toBe("P0001 servico_com_parcela_paga: sem categoria: parcela 1");
      await semJwt(c, async () => {
        await c.query("SET LOCAL session_replication_role = replica");
        await c.query(`delete from parcelas_servico where producao_terceirizado_id = $1`, [
          s.costura,
        ]); // replica não cascateia
        await c.query(`delete from producao_terceirizados where id = $1`, [s.costura]);
        await c.query("SET LOCAL session_replication_role = origin");
      });
      expect(
        await n(c, `select count(*) n from producao_terceirizados where id = $1`, [s.costura]),
      ).toBe(0);
    });
  });
});

// ─────────────────────────────────────────── follow-up I2/I3 (revisão merge-removidas) ───────────────────────────────────────────
describe.skipIf(!RODA)(
  "camada C1 follow-up — I2 rev dos blocos APAGADOS e I3 observação do molde",
  () => {
    const P0409_DEL =
      "P0409 conflito_versao: um servico removido foi alterado ou criado por outra pessoa";
    const salvar = (
      c: Client,
      cadId: string,
      blocos: unknown[],
      molde: string | null,
      base: string | null,
    ) =>
      tenta(c, `select salvar_terceirizados($1, $2::jsonb, $3, $4::jsonb)`, [
        cadId,
        JSON.stringify(blocos),
        molde,
        base,
      ]);
    const conta = (c: Client, cadId: string) =>
      n(c, `select count(*) n from producao_terceirizados where cad_id = $1`, [cadId]);

    it("I2: remover um bloco que OUTRA pessoa editou depois da minha base = P0409 e nada muda; com a base em dia, remove", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const s = await cadComServicos(c);
        const base = await revsBase(c, s.cad); // minha carga: rev dos 2
        // outra pessoa edita a Lavanderia (rev + 1)
        await semJwt(c, () =>
          c.query(`update producao_terceirizados set observacao = 'B mexeu' where id = $1`, [
            s.lav,
          ]),
        );
        // eu removo a Lavanderia e salvo com a base velha
        expect(txt(await salvar(c, s.cad, [{ id: s.costura, ativo: true }], null, base))).toBe(
          P0409_DEL,
        );
        expect(await conta(c, s.cad)).toBe(2);
        // com a base relida (o retry da tela): remove
        expect(
          txt(
            await salvar(
              c,
              s.cad,
              [{ id: s.costura, ativo: true }],
              null,
              await revsBase(c, s.cad),
            ),
          ),
        ).toBe("PASSOU");
        expect(await conta(c, s.cad)).toBe(1);
      });
    });

    it("I2: bloco que OUTRA pessoa criou e eu nunca vi (fora do _rev_base) = P0409, inclusive com 'apagar tudo'; cliente antigo (só os blocos do payload) também", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const s = await cadComServicos(c);
        const base = await revsBase(c, s.cad);
        // outra pessoa cria um serviço depois da minha carga
        const novo = await semJwt(
          c,
          async () =>
            (
              await um<{ id: string }>(
                c,
                `insert into producao_terceirizados (cad_id, tenant_id, ativo) values ($1, $2, true) returning id`,
                [s.cad, T],
              )
            ).id,
        );
        // salvo os 2 que eu via (sem remover nada meu) → o novo seria apagado → P0409
        expect(
          txt(
            await salvar(
              c,
              s.cad,
              [
                { id: s.costura, ativo: true },
                { id: s.lav, ativo: true },
              ],
              null,
              base,
            ),
          ),
        ).toBe(P0409_DEL);
        // "apagar todos os 2" que eu via, com o 3º criado no meio → P0409
        // contagem confirmada 2 ≠ 3 no servidor → M1 recusa antes do I2 (os dois são P0409 e nada muda)
        expect(
          txt(
            await salvar(
              c,
              s.cad,
              [],
              null,
              JSON.stringify({ ...JSON.parse(base), _apagar_tudo: 2 }),
            ),
          ),
        ).toBe(
          "P0409 conflito_versao: a lista de servicos mudou depois da confirmacao de apagar tudo",
        );
        // com N = 3 (contagem que bate por acaso) o I2 ainda pega o bloco que eu nunca vi
        expect(
          txt(
            await salvar(
              c,
              s.cad,
              [],
              null,
              JSON.stringify({ ...JSON.parse(base), _apagar_tudo: 3 }),
            ),
          ),
        ).toBe(P0409_DEL);
        expect(await conta(c, s.cad)).toBe(3);
        // cliente ANTIGO (aba aberta antes do deploy): _rev_base só com os blocos do payload → remover = P0409 (falha segura)
        const so1 = JSON.stringify({ [s.costura]: JSON.parse(base)[s.costura] });
        expect(txt(await salvar(c, s.cad, [{ id: s.costura, ativo: true }], null, so1))).toBe(
          P0409_DEL,
        );
        expect(await conta(c, s.cad)).toBe(3);
        // _rev_base null (manutenção) segue o bypass de antes
        expect(txt(await salvar(c, s.cad, [{ id: s.costura, ativo: true }], null, null))).toBe(
          "PASSOU",
        );
        expect(await conta(c, s.cad)).toBe(1);
        expect(novo).toBeTruthy();
      });
    });

    it("I2: payload com TODOS os blocos (edição rápida) não apaga nada e não confere rev de removido", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const s = await cadComServicos(c);
        const base = await revsBase(c, s.cad);
        expect(
          txt(
            await salvar(
              c,
              s.cad,
              [
                { id: s.costura, ativo: true },
                { id: s.lav, ativo: true },
              ],
              null,
              base,
            ),
          ),
        ).toBe("PASSOU");
        expect(await conta(c, s.cad)).toBe(2);
      });
    });

    it("I3: molde NÃO tocado não sobrescreve o que outra pessoa gravou; tocado + servidor mudou = P0409; tocado + base em dia grava; sem as chaves = como antes", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const s = await cadComServicos(c);
        const molde = async () =>
          (
            await um<{ m: string | null }>(c, `select observacoes_molde m from cad where id = $1`, [
              s.cad,
            ])
          ).m;
        await semJwt(c, () =>
          c.query(`update cad set observacoes_molde = 'A' where id = $1`, [s.cad]),
        );
        // abro com "A"; a Oficina grava "B"
        await semJwt(c, () =>
          c.query(`update cad set observacoes_molde = 'B' where id = $1`, [s.cad]),
        );
        const todos = [
          { id: s.costura, ativo: true },
          { id: s.lav, ativo: true },
        ];
        // não tocado: manda "A" (o que a tela tem) → o servidor NÃO grava
        expect(
          txt(
            await salvar(
              c,
              s.cad,
              todos,
              "A",
              await revsBase(c, s.cad, { _molde_tocado: false, _molde_base: "A" }),
            ),
          ),
        ).toBe("PASSOU");
        expect(await molde()).toBe("B");
        // tocado ("C") com base "A", servidor "B" → P0409, nada muda
        expect(
          txt(
            await salvar(
              c,
              s.cad,
              todos,
              "C",
              await revsBase(c, s.cad, { _molde_tocado: true, _molde_base: "A" }),
            ),
          ),
        ).toBe("P0409 conflito_versao: observacoes_molde");
        expect(await molde()).toBe("B");
        // tocado com a base em dia ("B" → "C") grava; base vazia = NULL do servidor
        expect(
          txt(
            await salvar(
              c,
              s.cad,
              todos,
              "C",
              await revsBase(c, s.cad, { _molde_tocado: true, _molde_base: "B" }),
            ),
          ),
        ).toBe("PASSOU");
        expect(await molde()).toBe("C");
        await semJwt(c, () =>
          c.query(`update cad set observacoes_molde = null where id = $1`, [s.cad]),
        );
        expect(
          txt(
            await salvar(
              c,
              s.cad,
              todos,
              "D",
              await revsBase(c, s.cad, { _molde_tocado: true, _molde_base: "" }),
            ),
          ),
        ).toBe("PASSOU");
        expect(await molde()).toBe("D");
        // apagar o texto (tocado, "" → NULL)
        expect(
          txt(
            await salvar(
              c,
              s.cad,
              todos,
              "",
              await revsBase(c, s.cad, { _molde_tocado: true, _molde_base: "D" }),
            ),
          ),
        ).toBe("PASSOU");
        expect(await molde()).toBeNull();
        // sem as chaves (cliente antigo / edição rápida que relê) e _rev_base null: grava como antes
        expect(txt(await salvar(c, s.cad, todos, "E", await revsBase(c, s.cad)))).toBe("PASSOU");
        expect(await molde()).toBe("E");
        expect(txt(await salvar(c, s.cad, todos, "F", null))).toBe("PASSOU");
        expect(await molde()).toBe("F");
      });
    });

    it("M1: 'apagar tudo' com a contagem N: servidor com outro número de serviços = P0409 e nada muda", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const s = await cadComServicos(c);
        const base = JSON.parse(await revsBase(c, s.cad));
        // a pessoa confirmou "Apagar todos os 2"; a outra sessão apaga um no meio (serviço não pago) → o servidor tem 1
        await c.query("SAVEPOINT m1");
        await semJwt(c, () => c.query(`delete from producao_terceirizados where id = $1`, [s.lav]));
        expect(
          txt(await salvar(c, s.cad, [], null, JSON.stringify({ ...base, _apagar_tudo: 2 }))),
        ).toBe(
          "P0409 conflito_versao: a lista de servicos mudou depois da confirmacao de apagar tudo",
        );
        expect(await conta(c, s.cad)).toBe(1);
        await c.query("ROLLBACK TO SAVEPOINT m1");
        // N certo + revs em dia: apaga
        expect(
          txt(await salvar(c, s.cad, [], null, JSON.stringify({ ...base, _apagar_tudo: 2 }))),
        ).toBe("PASSOU");
        expect(await conta(c, s.cad)).toBe(0);
      });
    });

    it("M2: 'Voltar uma etapa' (reverter_corte_tecido) — só a pagar passa e leva as parcelas; status 'pago' = 42501 de antes; pago só pela data = servico_com_parcela_paga:", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const parcelas = (id: string) =>
          n(c, `select count(*) n from parcelas_servico where producao_terceirizado_id = $1`, [id]);
        // (a) só parcelas a pagar → reverte; serviços e parcelas somem
        const a = await cadComServicos(c);
        expect(txt(await tenta(c, `select reverter_corte_tecido($1)`, [a.cad]))).toBe("PASSOU");
        expect(await conta(c, a.cad)).toBe(0);
        expect(await parcelas(a.costura)).toBe(0);
        // (b) status 'pago' → a guarda antiga (42501), inalterada
        const b = await cadComServicos(c, [1]);
        const rb = await tenta(c, `select reverter_corte_tecido($1)`, [b.cad]);
        expect(rb.ok ? "PASSOU" : rb.code).toBe("42501");
        expect(txt(rb)).toContain("Não é possível voltar");
        expect(await conta(c, b.cad)).toBe(2);
        // (c) a_pagar + data_pagamento → a guarda antiga não pega; o gatilho da C1 recusa e nada muda
        const d = await cadComServicos(c);
        await semJwt(c, async () => {
          await c.query("SELECT set_config('app.servico_valor_pago_correcao', 'on', true)");
          await c.query(
            `update parcelas_servico set data_pagamento = '2026-10-02' where producao_terceirizado_id = $1 and numero_parcela = 1`,
            [d.costura],
          );
          await c.query("SELECT set_config('app.servico_valor_pago_correcao', '', true)");
        });
        expect(txt(await tenta(c, `select reverter_corte_tecido($1)`, [d.cad]))).toBe(
          "P0001 servico_com_parcela_paga: Costura C1: parcela 1",
        );
        expect(await conta(c, d.cad)).toBe(2);
        expect(await parcelas(d.costura)).toBe(2);
      });
    });

    it("I2/I3: os RAISE novos são ASCII e P0409 (o PostgREST devolve 5xx — com acento vira 'Something went wrong')", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const src = (
          await um<{ s: string }>(
            c,
            `select prosrc s from pg_proc where oid = 'public.salvar_terceirizados(uuid,jsonb,text,jsonb)'::regprocedure`,
          )
        ).s;
        const raises = [
          ...src.matchAll(
            /RAISE EXCEPTION 'conflito_versao: (um servico removido|observacoes_molde)[^;]*;/g,
          ),
        ].map((m) => m[0]);
        expect(raises).toHaveLength(2);
        for (const r of raises) {
          expect(r).toMatch(/USING ERRCODE = 'P0409';$/);
          expect(
            [...r].every((ch) => ch.charCodeAt(0) < 128),
            r,
          ).toBe(true);
        }
      });
    });
  },
);

// ─────────────────────────────────────────── (e)(f)(g) md5, ACL, idempotência, volta, trava, anti-drift ─────────────────────────────
describe.skipIf(!RODA)(
  "camada C1 — migrations: md5, ACL, idempotência, volta neutra, trava e anti-drift",
  () => {
    it("160000: ida = DEPOIS (ACL igual); reaplicar não muda; _down = ANTES (2x); ida de novo; guarda recusa texto inesperado", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const confere = async (lado: "antes" | "depois") => {
          for (const [fn, m] of Object.entries(CAMADA_MD5)) {
            expect(await md5Fn(c, fn), `${fn} ${lado}`).toBe(m[lado]);
            const p = await um<{
              acl: string;
              sd: boolean;
              cfg: string;
              anon: boolean;
              auth: boolean;
            }>(
              c,
              `select coalesce(proacl::text,'') acl, prosecdef sd, coalesce(array_to_string(proconfig,'|'),'') cfg,
                    has_function_privilege('anon', oid, 'EXECUTE') anon, has_function_privilege('authenticated', oid, 'EXECUTE') auth
               from pg_proc where oid = to_regprocedure($1)`,
              [fn],
            );
            expect(p, fn).toEqual({
              acl: CAMADA_ACL[fn],
              sd: true,
              cfg: "search_path=public",
              anon: false,
              auth: true,
            });
          }
        };
        await confere("depois");
        await aplicarArquivo(c, CAMADA_MIG);
        await confere("depois");
        await aplicarArquivo(c, CAMADA_DOWN_GAT);
        await aplicarArquivo(c, CAMADA_DOWN);
        await aplicarArquivo(c, CAMADA_DOWN);
        await confere("antes");
        await aplicarArquivo(c, CAMADA_MIG);
        await confere("depois");
        // guarda: função mexida = recusa (P0001) e nada muda
        const fn = "public.salvar_direcionamento(uuid,jsonb,jsonb)";
        const def = (
          await um<{ d: string }>(c, `select pg_get_functiondef(to_regprocedure($1)) d`, [fn])
        ).d;
        await c.query(def.replace("BEGIN\n", "BEGIN\n  -- mexida\n"));
        for (const arq of [CAMADA_MIG, CAMADA_DOWN]) {
          await c.query("SAVEPOINT g");
          await expect(aplicarArquivo(c, arq)).rejects.toMatchObject({ code: "P0001" });
          await c.query("ROLLBACK TO SAVEPOINT g");
        }
      });
    });

    it("161000: ida/_down neutro/ida; gatilho BEFORE DELETE ROW ligado; ACL só postgres/service_role; _down_drop remove e a ida recria", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const gat = async () =>
          (
            await c.query(
              `select g.tgtype, g.tgenabled, g.tgfoid::regprocedure::text f from pg_trigger g
          where g.tgrelid = $1::regclass and g.tgname = $2`,
              [CAMADA_GAT.tabela, CAMADA_GAT.nome],
            )
          ).rows;
        const acl = async () =>
          um<{ anon: boolean; auth: boolean; pub: boolean; sd: boolean; cfg: string }>(
            c,
            `select has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
                exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0) pub,
                p.prosecdef sd, coalesce(array_to_string(p.proconfig,'|'),'') cfg
           from pg_proc p where p.oid = to_regprocedure($1)`,
            [CAMADA_GAT.fn],
          );
        const ESPERADO_GAT = [
          { tgtype: CAMADA_GAT.tgtype, tgenabled: "O", f: CAMADA_GAT.fn.replace(/^public\./, "") },
        ];
        const ACL_OK = {
          anon: false,
          auth: false,
          pub: false,
          sd: false,
          cfg: "search_path=public",
        };
        expect(await camadaGatViva(c)).toBe(true);
        expect(await gat()).toEqual(ESPERADO_GAT);
        expect(await acl()).toEqual(ACL_OK);
        await aplicarArquivo(c, CAMADA_MIG_GAT); // idempotente
        expect(await md5Fn(c, CAMADA_GAT.fn)).toBe(CAMADA_GAT.ida);
        const s = await cadComServicos(c, [1]);
        await aplicarArquivo(c, CAMADA_DOWN_GAT);
        await aplicarArquivo(c, CAMADA_DOWN_GAT); // neutro 2x
        expect(await md5Fn(c, CAMADA_GAT.fn)).toBe(CAMADA_GAT.neutro);
        expect(await gat()).toEqual(ESPERADO_GAT); // o gatilho FICA (sem DROP)
        expect(await acl()).toEqual(ACL_OK);
        await c.query("SAVEPOINT neutro");
        expect(
          txt(
            await semJwt(c, () =>
              tenta(c, `delete from producao_terceirizados where id = $1`, [s.costura]),
            ),
          ),
        ).toBe("PASSOU"); // = antes
        await c.query("ROLLBACK TO SAVEPOINT neutro");
        await aplicarArquivo(c, CAMADA_MIG_GAT);
        expect(await md5Fn(c, CAMADA_GAT.fn)).toBe(CAMADA_GAT.ida);
        expect(
          txt(
            await semJwt(c, () =>
              tenta(c, `delete from producao_terceirizados where id = $1`, [s.costura]),
            ),
          ),
        ).toBe("P0001 servico_com_parcela_paga: Costura C1: parcela 1");
        // _down_drop exige a função NEUTRA
        await c.query("SAVEPOINT dd");
        await expect(aplicarArquivo(c, CAMADA_DROP_GAT)).rejects.toMatchObject({ code: "P0001" });
        await c.query("ROLLBACK TO SAVEPOINT dd");
        await aplicarArquivo(c, CAMADA_DOWN_GAT);
        await aplicarArquivo(c, CAMADA_DROP_GAT);
        expect(await gat()).toEqual([]);
        expect(await md5Fn(c, CAMADA_GAT.fn)).toBeNull();
        // _down sem a função = recusa clara
        await c.query("SAVEPOINT sem");
        await expect(aplicarArquivo(c, CAMADA_DOWN_GAT)).rejects.toMatchObject({ code: "P0001" });
        await c.query("ROLLBACK TO SAVEPOINT sem");
        await aplicarArquivo(c, CAMADA_MIG_GAT); // recria
        expect(await gat()).toEqual(ESPERADO_GAT);
        expect(await acl()).toEqual(ACL_OK);
      });
    });

    it("trava (R6, por diferença): 160000 só catálogo; 161000 = ShareRowExclusive SÓ em producao_terceirizados quando cria o gatilho (nada se já existe); nada em auth/storage/realtime", async () => {
      await withTx(async (c) => {
        await c.query("SET LOCAL statement_timeout = '180s'");
        type Trava = { rel: string; mode: string };
        const travas = async () =>
          (
            await c.query(
              `select coalesce(n.nspname || '.' || k.relname, l.relation::text) rel, l.mode
           from pg_locks l left join pg_class k on k.oid = l.relation left join pg_namespace n on n.oid = k.relnamespace
          where l.pid = pg_backend_pid() and l.granted and l.locktype = 'relation'
            and coalesce(n.nspname, '') not in ('pg_catalog', 'pg_toast') order by 1, 2`,
            )
          ).rows as Trava[];
        const chave = (t: Trava) => `${t.rel}|${t.mode}`;
        const novas = async (fn: () => Promise<void>) => {
          const antes = new Set((await travas()).map(chave));
          await fn();
          return (await travas()).filter((t) => !antes.has(chave(t)));
        };
        const tinhaGatilho = (
          await um<{ v: boolean }>(
            c,
            `select exists (select 1 from pg_trigger where tgname = $1) v`,
            [CAMADA_GAT.nome],
          )
        ).v;
        if (await camadaVazioViva(c))
          await aplicarArquivo(c, CAMADA_DOWN_GAT).then(() => aplicarArquivo(c, CAMADA_DOWN));
        const n1 = await novas(() => aplicarArquivo(c, CAMADA_MIG));
        expect(
          n1.filter((t) =>
            /^(auth|storage|realtime|supabase_functions|graphql|vault)\./.test(t.rel),
          ),
        ).toEqual([]);
        expect(n1.filter((t) => t.mode !== "AccessShareLock")).toEqual([]);
        const n2 = await novas(() => aplicarArquivo(c, CAMADA_MIG_GAT));
        expect(
          n2.filter((t) =>
            /^(auth|storage|realtime|supabase_functions|graphql|vault)\./.test(t.rel),
          ),
        ).toEqual([]);
        const fortes = n2.filter((t) => t.mode !== "AccessShareLock");
        expect(fortes).toEqual(
          tinhaGatilho
            ? []
            : [{ rel: "public.producao_terceirizados", mode: "ShareRowExclusiveLock" }],
        );
        expect(n2.filter((t) => t.mode === "AccessExclusiveLock")).toEqual([]);
        // _down neutro: só catálogo
        const n3 = await novas(async () => {
          await aplicarArquivo(c, CAMADA_DOWN_GAT);
          await aplicarArquivo(c, CAMADA_DOWN);
        });
        expect(n3.filter((t) => t.mode !== "AccessShareLock")).toEqual([]);
      });
    });

    it("(g) anti-drift: os 6 wrappers têm a guarda com a entidade e a marca certas; nenhum OUTRO wrapper executável recebe a lista com as mesmas chaves sem guarda", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const MARCA: Record<string, string> = {
          servicos: "_rev_base->>'_apagar_tudo'",
          direcionamento: "_rev_base->>'apagar_tudo'",
          itens_oc: "_oc->>'_apagar_itens'",
        };
        for (const [fn, ent] of Object.entries(CAMADA_ENTIDADE)) {
          const src = (
            await um<{ s: string }>(
              c,
              `select prosrc s from pg_proc where oid = to_regprocedure($1)`,
              [fn],
            )
          ).s;
          expect(src, fn).toContain(`'estado_vazio_recusado: ${ent} %'`);
          expect(src, fn).toContain(
            ent === "servicos"
              ? `COALESCE(${MARCA[ent]}, '') !~ '^[0-9]{1,9}$'`
              : `COALESCE(${MARCA[ent]}, '') <> 'true'`,
          );
          // RAISE da guarda só ASCII e P0001 (400; texto ASCII de qualquer forma)
          const raise = /RAISE EXCEPTION 'estado_vazio_recusado[^;]*;/.exec(src)?.[0] ?? "";
          expect(raise, fn).toMatch(/USING ERRCODE = 'P0001';$/);
          expect(
            [...raise].every((ch) => ch.charCodeAt(0) < 128),
            fn,
          ).toBe(true);
        }
        // As sobrecargas que o cliente ALCANÇA são só as 6: as antigas são mortas (42725 ambígua) — se uma voltar a funcionar, isto falha.
        const d = await cadComDirecionamento(c); // confirmar(2) confere a loja do CAD e o CQ antes de chegar ao core ambíguo
        for (const sql of [
          `select public.salvar_direcionamento('${d}'::uuid, '[]'::jsonb)`,
          `select public.confirmar_direcionamento('${d}'::uuid, '[]'::jsonb)`,
          `select public.salvar_oc_aviamento(gen_random_uuid(), '{}'::jsonb, '[]'::jsonb)`,
          `select public.salvar_oc_etiqueta(gen_random_uuid(), '{}'::jsonb, '[]'::jsonb)`,
        ]) {
          const r = await tenta(c, sql);
          expect(r.ok ? "PASSOU" : r.code, sql).toBe("42725");
        }
        // P-268: o gatilho é o ÚNICO BEFORE DELETE de producao_terceirizados e a mensagem do salvar_terceirizados é a nova (ASCII)
        const src = (
          await um<{ s: string }>(
            c,
            `select prosrc s from pg_proc where oid = 'public.salvar_terceirizados(uuid,jsonb,text,jsonb)'::regprocedure`,
          )
        ).s;
        expect(src).toContain("'servico_com_parcela_paga: %'");
        expect(src).not.toContain("Não é possível remover um serviço com parcela já paga");
      });
    });
  },
);
