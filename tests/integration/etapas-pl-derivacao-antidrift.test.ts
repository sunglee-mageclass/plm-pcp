/**
 * Kanban PL - Onda 3, Task 4: ANTI-DRIFT da derivação do board PL, TS × SQL, com as MESMAS fixtures
 * (tests/fixtures/etapas-pl-casos.ts). O SQL do PL REUSA as puras do Dev (`_kanban_fluxo`, `_kanban_derivar_puro`,
 * `_kanban_destino_drop_puro`) com exceções `{}` e `derivavel = (status IS NOT NULL)` — exatamente como `_etapas_pl_derivar_lote`.
 * A lib TS (src/lib/etapas-pl-config.ts) tem de devolver o MESMO. Modelo: tests/integration/kanban-auto.test.ts (2B/2C).
 *
 * Só LEITURA (SELECT de funções puras) dentro de BEGIN…ROLLBACK (`withTx`); sem DDL, sem INSERT. Roda na CÓPIA LOCAL
 * (DATABASE_URL = postgresql://postgres:postgres@127.0.0.1:54422/postgres); sem banco, a suíte se auto-pula.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, um } from "./db";
import { CASOS_DERIVACAO_PL, type CasoDerivacaoPl } from "../fixtures/etapas-pl-casos";
import {
  boardEtapasPl, derivarEtapaPl, destinoDropPl, faltandoParaPl, fluxoEtapasPl, lerEtapasPlConfig, reqsDaColuna, colunaManualPl,
} from "../../src/lib/etapas-pl-config";

const cfgDoCaso = (c: CasoDerivacaoPl) =>
  lerEtapasPlConfig({ etapas_pl_kanban: c.board, etapas_pl_requisitos: c.requisitos, etapas_pl_automatico: true });

/** fluxo do PL no SQL = `_kanban_fluxo` sobre o board PL (como `_etapas_pl_derivar_lote`). */
async function fluxoSql(c: Client, board: unknown): Promise<string[]> {
  return (await um<{ f: string[] }>(c, `SELECT public._kanban_fluxo(jsonb_build_object('status_kanban', $1::jsonb), false) AS f`, [JSON.stringify(board)])).f;
}
async function derivarSql(c: Client, caso: CasoDerivacaoPl) {
  const fluxo = await fluxoSql(c, caso.board);
  const { d } = await um<{ d: Record<string, unknown> }>(
    c,
    `SELECT public._kanban_derivar_puro($1::text[], $2::jsonb, '{}'::jsonb, $3::jsonb, $4, $5) AS d`,
    [fluxo, JSON.stringify(caso.requisitos), JSON.stringify(caso.satisfeitas), caso.status, caso.status !== null],
  );
  return { derivavel: d.derivavel, alvo: d.alvo, resultado: d.resultado, fixado: d.fixado, faltando: d.faltando };
}
async function dropSql(c: Client, caso: CasoDerivacaoPl, para: string) {
  const fluxo = await fluxoSql(c, caso.board);
  const { d } = await um<{ d: { acao: string; status: string | null; faltando: string[] } }>(
    c,
    `SELECT public._kanban_destino_drop_puro($1::text[], $2::jsonb, '{}'::jsonb, $3::jsonb, $4, $5, $6) AS d`,
    [fluxo, JSON.stringify(caso.requisitos), JSON.stringify(caso.satisfeitas), caso.status, caso.status !== null, para],
  );
  return d;
}

describe.skipIf(!hasDb)("etapas-pl — anti-drift TS×SQL da derivação (Task 4)", () => {
  it("_kanban_derivar_puro ≡ fixture ≡ derivarEtapaPl (TODOS os casos)", async () => {
    await withTx(async (c) => {
      for (const caso of CASOS_DERIVACAO_PL) {
        expect(await derivarSql(c, caso), `${caso.nome} (SQL)`).toEqual(caso.esperado);
        expect(derivarEtapaPl(cfgDoCaso(caso), caso.status, caso.satisfeitas), `${caso.nome} (TS)`).toEqual(caso.esperado);
      }
    });
  });

  it("_kanban_destino_drop_puro ≡ fixture ≡ destinoDropPl (todos os arrastes das fixtures)", async () => {
    await withTx(async (c) => {
      let n = 0;
      for (const caso of CASOS_DERIVACAO_PL) {
        for (const a of caso.arrastes ?? []) {
          n++;
          const esperado = { acao: a.acao, status: a.status, faltando: a.faltando };
          expect(await dropSql(c, caso, a.para), `${caso.nome} → ${a.para} (SQL)`).toEqual(esperado);
          expect(destinoDropPl(cfgDoCaso(caso), caso.status, a.para, caso.satisfeitas), `${caso.nome} → ${a.para} (TS)`).toEqual(esperado);
        }
      }
      expect(n).toBeGreaterThanOrEqual(15);
    });
  });

  it("fluxoEtapasPl ≡ _kanban_fluxo (dedup por key, board vazio cai no padrão) e colunaManualPl ≡ _kanban_coluna_manual", async () => {
    await withTx(async (c) => {
      for (const caso of CASOS_DERIVACAO_PL) {
        const cfg = cfgDoCaso(caso);
        const fluxo = await fluxoSql(c, caso.board);
        expect(fluxoEtapasPl(cfg), caso.nome).toEqual(fluxo);
        expect(boardEtapasPl(cfg).map((x) => x.key), `${caso.nome} (board)`).toEqual(fluxo);
        for (const k of fluxo) {
          const sql = (await um<{ m: boolean }>(c, `SELECT public._kanban_coluna_manual($1, $2::jsonb) AS m`, [k, JSON.stringify(caso.requisitos)])).m;
          expect(colunaManualPl(cfg, k), `${caso.nome} manual(${k})`).toBe(sql);
        }
      }
    });
  });

  it("faltandoParaPl ≡ _kanban_faltando_para (união dos efetivos não satisfeitos da 1ª falha até a coluna)", async () => {
    await withTx(async (c) => {
      for (const caso of CASOS_DERIVACAO_PL) {
        const fluxo = await fluxoSql(c, caso.board);
        for (const para of [...fluxo, "zzz"]) {
          const sql = (await um<{ f: string[] }>(
            c,
            `SELECT public._kanban_faltando_para($1::text[], $2::jsonb, '{}'::jsonb, $3::jsonb, $4, true, $5) AS f`,
            [fluxo, JSON.stringify(caso.requisitos), JSON.stringify(caso.satisfeitas), caso.status, para],
          )).f;
          expect(faltandoParaPl(cfgDoCaso(caso), para, caso.satisfeitas), `${caso.nome} → ${para}`).toEqual(sql);
        }
      }
    });
  });

  it("reqsDaColuna lê só a lista da coluna (chave normalizada; coluna sem requisito = [])", () => {
    const cfg = lerEtapasPlConfig({ etapas_pl_kanban: ["Peça Teste", "Oficina"], etapas_pl_requisitos: { peca_teste: ["tem_peca_teste", 7, null] } });
    expect(reqsDaColuna(cfg, "peca_teste")).toEqual(["tem_peca_teste"]);
    expect(reqsDaColuna(cfg, "Peca_Teste ")).toEqual(["tem_peca_teste"]);
    expect(reqsDaColuna(cfg, "oficina")).toEqual([]);
  });

  it("DADO REAL: _etapas_pl_derivar_lote ≡ derivarEtapaPl (TS) em TODOS os produtos no PL de TODAS as lojas", async () => {
    await withTx(async (c) => {
      const { rows: lojas } = await c.query(`SELECT * FROM public.tenant_config ORDER BY tenant_id`);
      let comparados = 0;
      for (const l of lojas) {
        const cfg = lerEtapasPlConfig(l);
        const { rows: lote } = await c.query(`SELECT * FROM public._etapas_pl_derivar_lote($1, NULL)`, [l.tenant_id]);
        for (const s of lote) {
          const sql = { derivavel: s.derivavel, alvo: s.alvo, resultado: s.resultado, fixado: s.fixado, faltando: s.faltando };
          expect(fluxoEtapasPl(cfg), `${l.tenant_id} fluxo`).toEqual(s.fluxo);
          expect(derivarEtapaPl(cfg, s.status_atual, s.cond), `${l.tenant_id} ${s.modelo_id}`).toEqual(sql);
          comparados++;
        }
      }
      console.info(`[etapas-pl] anti-drift em dado real: ${comparados} produtos em ${lojas.length} lojas`);
    });
  });
});
