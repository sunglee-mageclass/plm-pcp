// Urgentes R1b (P-337 A; migration 20261103198000_urg_r1b_enviar_tamanho): correcao UNICA do "a enviar" (cad_etiquetas.quantidade_enviar)
// dos insumos vinculados a UM tamanho que ja estavam na Explosao antes da Onda 1 (Ruling A6: o gravado ficou = consumo x grade TOTAL).
// So com a lista aprovada (padrao 170500/P-166: previa so-leitura + hash + GUC + backup + volta). A migration NAO roda a correcao; aqui
// ela roda SO dentro da txn revertida do teste. Paridade TS<->SQL: o "depois" = a "necessaria" de linhaInsumoExplosao (Explosao).
// Txn revertida; DDL (aplicar/voltar o bloco) so na copia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasDb, withTx, um, ehBancoLocal, dbUrl, TENANT_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";
import { URG_R1B } from "./urg-r1b-dados";
import { aplicaUrgR1b, urgR1bViva, voltaUrgR1bSePreciso } from "./urg-r1b-helpers";
import { linhaInsumoExplosao, mapaTamanhoVinculado, type GradeLinha } from "@/lib/insumo-tamanho";

const RODA = hasDb && ehBancoLocal();
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PREVIA_SQL = readFileSync(`${ROOT}${URG_R1B.previa}`, "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

type Linha = {
  tenant_id: string;
  cad_id: string;
  cad_etiqueta_id: string;
  modelo_id: string | null;
  tamanho: string | null;
  consumo: string;
  total: string;
  pecas: string;
  antigo: string;
  necessaria: string;
  atual: string | null;
  antes: string | null;
  depois: string;
  elegivel: boolean;
  motivo: string | null;
  situacao: string | null;
  aviso: string | null;
  info: string | null;
  linha: string;
};
type Resultado = {
  gravados: number;
  pulados: { id: string; motivo: string }[];
  hash: string;
  n: number;
};

async function lista(c: Client): Promise<Linha[]> {
  return (
    await c.query(`SELECT * FROM ${URG_R1B.PREVIA} ORDER BY tenant_id, cad_id, cad_etiqueta_id`)
  ).rows as Linha[];
}

/** hash/n da previa INTEIRA (o que o dono aprova) + as linhas canonicas dos elegiveis. */
async function previa(
  c: Client,
): Promise<{ linhas: string[]; hash: string; n: number; l: Linha[] }> {
  const l = await lista(c);
  const el = l.filter((x) => x.elegivel).map((x) => x.linha);
  return { linhas: el, hash: md5(el.join("\n")), n: el.length, l };
}

async function rodar(
  c: Client,
  linhas: unknown,
  hash: string,
  n: number,
  guc: string | null = "sim",
): Promise<Resultado> {
  if (guc !== null)
    await c.query("SELECT set_config('app.confirmo_enviar_tamanho', $1, true)", [guc]);
  return (
    await um<{ r: Resultado }>(c, "SELECT public._urg_r1b_enviar_rodar($1::jsonb, $2, $3) AS r", [
      JSON.stringify(linhas),
      hash,
      n,
    ])
  ).r;
}

/** Roda esperando erro, sem perder a txn do teste. */
async function falha(
  c: Client,
  fn: () => Promise<unknown>,
): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT falha");
  try {
    await fn();
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT falha");
    const err = e as { code: string; message: string };
    return { code: err.code, message: err.message };
  }
  await c.query("RELEASE SAVEPOINT falha");
  throw new Error("esperava erro e nao veio");
}

async function enviar(c: Client, id: string): Promise<number | null> {
  const v = (
    await um<{ v: string | null }>(
      c,
      "SELECT quantidade_enviar AS v FROM cad_etiquetas WHERE id = $1",
      [id],
    )
  ).v;
  return v === null ? null : Number(v);
}

async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (
    await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [
      sig,
    ])
  ).m;
}

async function insEtq(
  c: Client,
  nome: string,
  formato: string,
  vinculo: string | null,
  variantes: string[] = [],
): Promise<string> {
  const id = (
    await um<{ id: string }>(
      c,
      "INSERT INTO etiquetas (tenant_id, nome, formato_tamanho, tamanho_vinculado) VALUES ($1, $2, $3, $4) RETURNING id",
      [TENANT_TESTE, nome, formato, vinculo],
    )
  ).id;
  for (const t of variantes) {
    await c.query(
      "INSERT INTO variantes_etiqueta (tenant_id, etiqueta_id, tamanho) VALUES ($1, $2, $3)",
      [TENANT_TESTE, id, t],
    );
  }
  return id;
}

async function insCad(
  c: Client,
  nome: string,
  origem: string,
  enviado: boolean,
  grades: { n: number; g: Record<string, unknown>; t: number }[],
): Promise<{ modelo: string; cad: string }> {
  const modelo = (
    await um<{ id: string }>(
      c,
      "INSERT INTO modelos (tenant_id, nome, origem) VALUES ($1, $2, $3) RETURNING id",
      [TENANT_TESTE, nome, origem],
    )
  ).id;
  const cad = (
    await um<{ id: string }>(
      c,
      "INSERT INTO cad (tenant_id, modelo_id, enviado_corte) VALUES ($1, $2, $3) RETURNING id",
      [TENANT_TESTE, modelo, enviado],
    )
  ).id;
  for (const g of grades) {
    await c.query(
      "INSERT INTO cad_grades (cad_id, variante_numero, grades_planejadas, grade_total_planejada) VALUES ($1, $2, $3::jsonb, $4)",
      [cad, g.n, JSON.stringify(g.g), g.t],
    );
  }
  return { modelo, cad };
}

async function insCe(
  c: Client,
  cad: string,
  etq: string,
  consumo: number,
  qe: number | null,
  ept: Record<string, number> = {},
): Promise<string> {
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO cad_etiquetas (cad_id, etiqueta_id, consumo, quantidade_planejada, quantidade_enviar, enviar_por_tamanho)
       VALUES ($1, $2, $3, $4, $4, $5::jsonb) RETURNING id`,
      [cad, etq, consumo, qe, JSON.stringify(ept)],
    )
  ).id;
}

// Grade do CAD de teste: 2 variantes (multiplas variantes), total 50; tamanho 40|M = 20 + 5 = 25; 38|P so na 1a; 46|XG fora da grade.
const GRADES = [
  { n: 1, g: { "38|P": 10, "40|M": 20 }, t: 30 },
  { n: 2, g: { "40|M": 5, "42|G": "15" }, t: 20 },
];

type Fix = Awaited<ReturnType<typeof semeia>>;
async function semeia(c: Client) {
  const eM = await insEtq(c, "URG-R1B Etq M", "nenhum", "40|M");
  const eXG = await insEtq(c, "URG-R1B Etq XG", "nenhum", " 46|XG "); // fora da grade (e espacos nas pontas)
  const eProprio = await insEtq(c, "URG-R1B Etq com tamanho", "ambos", "40|M", ["M"]); // vinculo nao vale (A2)
  const eSem = await insEtq(c, "URG-R1B Etq sem vinculo", "nenhum", null);
  const k1 = await insCad(c, "URG-R1B Modelo 1", "interno", false, GRADES);
  const k2 = await insCad(c, "URG-R1B Modelo enviado", "interno", true, GRADES);
  const k3 = await insCad(c, "URG-R1B Modelo revenda", "revenda", false, GRADES);
  const k4 = await insCad(c, "URG-R1B Modelo sem celulas", "interno", false, [
    { n: 1, g: {}, t: 40 },
  ]);
  // grade que NAO fecha: celulas somam 15, total 20 (pecas do tamanho desconhecidas)
  const k7 = await insCad(c, "URG-R1B Modelo grade nao fecha", "interno", false, [
    { n: 1, g: { "40|M": 10, "38|P": 5 }, t: 20 },
  ]);
  // N3: 2 variantes, uma COERENTE (10 de 10) e outra que NAO fecha (5 de 8) -> a linha INTEIRA e grade_incompleta (nao so a variante)
  const k8 = await insCad(c, "URG-R1B Modelo 2 variantes uma incompleta", "interno", false, [
    { n: 1, g: { "40|M": 10 }, t: 10 },
    { n: 2, g: { "40|M": 5 }, t: 8 },
  ]);
  const ce = {
    auto: await insCe(c, k1.cad, eM, 1, 50), // automatico antigo 1 x 50 -> 25
    mao: await insCe(c, k1.cad, eM, 2, 77), // editado a mao (antigo seria 100)
    fora: await insCe(c, k1.cad, eXG, 1, 50), // fora da grade -> 0
    proprio: await insCe(c, k1.cad, eProprio, 1, 50), // sem vinculo efetivo
    semVinculo: await insCe(c, k1.cad, eSem, 1, 50), // nem entra no universo
    frac: await insCe(c, k1.cad, eM, 0.3333, 16.67), // round(0.3333 x 50, 2) = 16.67 -> round(0.3333 x 25, 2) = 8.33
    vazio: await insCe(c, k1.cad, eM, 1, null), // a enviar nunca gravado
    ept: await insCe(c, k1.cad, eM, 1, 50, { "40|M": 25 }), // enviar_por_tamanho preenchido
    enviado: await insCe(c, k2.cad, eM, 1, 50),
    revenda: await insCe(c, k3.cad, eM, 1, 50),
    semCelulas: await insCe(c, k4.cad, eM, 1, 40), // grade so com total -> grade_incompleta (NAO vai a 0)
    naoFecha: await insCe(c, k7.cad, eM, 1, 20), // celulas != total -> grade_incompleta
    duasVar: await insCe(c, k8.cad, eM, 1, 18), // variante 1 coerente + variante 2 incompleta -> grade_incompleta (linha inteira)
    outraGrade: await insCe(c, k1.cad, eM, 1, 40), // consumo x 40 (grade antiga de 40 pecas) -> editado_a_mao + info
  };
  return { eM, eXG, eProprio, eSem, k1, k2, k3, k4, k7, k8, ce };
}

const daFixture = (f: Fix, l: Linha[]) => {
  const ids = new Set(Object.values(f.ce));
  return l.filter((x) => ids.has(x.cad_etiqueta_id));
};
const porId = (l: Linha[]) => Object.fromEntries(l.map((x) => [x.cad_etiqueta_id, x]));

describe.skipIf(!RODA)(
  "urg R1b — correcao unica do a enviar dos insumos de tamanho (198000)",
  () => {
    it("vereditos da fixture: elegivel / editado a mao / enviado ao PCP / sem vinculo / revenda / vazio / enviar_por_tamanho", async () => {
      await withTx(async (c) => {
        await aplicaUrgR1b(c);
        const f = await semeia(c);
        const l = porId(daFixture(f, await lista(c)));
        expect(l[f.ce.semVinculo]).toBeUndefined(); // sem vinculo: fora do universo
        expect(l[f.ce.auto]).toMatchObject({
          elegivel: true,
          situacao: "a_corrigir",
          tamanho: "40|M",
          aviso: null,
        });
        expect([
          Number(l[f.ce.auto].antes),
          Number(l[f.ce.auto].depois),
          Number(l[f.ce.auto].antigo),
        ]).toEqual([50, 25, 50]);
        expect(l[f.ce.fora]).toMatchObject({
          elegivel: true,
          tamanho: "46|XG",
          aviso: "fora_da_grade",
        });
        expect(Number(l[f.ce.fora].depois)).toBe(0);
        expect(l[f.ce.frac]).toMatchObject({ elegivel: true });
        expect([Number(l[f.ce.frac].antes), Number(l[f.ce.frac].depois)]).toEqual([16.67, 8.33]);
        // M1: grade sem celulas / que nao fecha = NAO elegivel (pecas desconhecidas, nao 0); so fora da grade COERENTE vai a 0
        expect(l[f.ce.semCelulas]).toMatchObject({
          elegivel: false,
          motivo: "grade_incompleta",
          aviso: "grade_sem_celulas",
          info: "variante 1: celulas 0 de total 40",
        });
        expect(l[f.ce.naoFecha]).toMatchObject({
          elegivel: false,
          motivo: "grade_incompleta",
          info: "variante 1: celulas 15 de total 20",
        });
        // N3: so a variante 2 fura, mas a linha inteira sai (nunca grava com metade da grade conhecida); info cita SO a que fura
        expect(l[f.ce.duasVar]).toMatchObject({
          elegivel: false,
          motivo: "grade_incompleta",
          info: "variante 2: celulas 5 de total 8",
        });
        // L1: editado a mao com o automatico antigo x gravado (e o palpite de outra grade quando o gravado e consumo x N)
        expect(l[f.ce.mao].info).toBe("gravado 77.00 x automatico antigo 100.00");
        expect(l[f.ce.outraGrade]).toMatchObject({
          elegivel: false,
          motivo: "editado_a_mao",
          info: "gravado 40.00 x automatico antigo 50.00 (= consumo x 40 pecas: parece automatico de outra grade)",
        });
        expect(l[f.ce.mao]).toMatchObject({
          elegivel: false,
          motivo: "editado_a_mao",
          situacao: null,
        });
        expect(l[f.ce.proprio]).toMatchObject({ elegivel: false, motivo: "sem_vinculo_efetivo" });
        expect(l[f.ce.vazio]).toMatchObject({ elegivel: false, motivo: "a_enviar_vazio" });
        expect(l[f.ce.ept]).toMatchObject({
          elegivel: false,
          motivo: "enviar_por_tamanho_preenchido",
        });
        expect(l[f.ce.enviado]).toMatchObject({ elegivel: false, motivo: "enviado_ao_pcp" });
        expect(l[f.ce.revenda]).toMatchObject({
          elegivel: false,
          motivo: "revenda_importado_sem_paridade",
        });
        // linha canonica = tenant|cad|cad_etiqueta|modelo|insumo|tamanho|antes|depois
        expect(l[f.ce.auto].linha).toBe(
          `${TENANT_TESTE}|${f.k1.cad}|${f.ce.auto}|URG-R1B Modelo 1|URG-R1B Etq M|40|M|50.00|25.00`,
        );
      });
    });

    it("a previa SO-LEITURA (supabase/consultas) == _urg_r1b_enviar_previa(), e o hash/n batem", async () => {
      await withTx(async (c) => {
        await aplicaUrgR1b(c);
        await semeia(c);
        const prev = (await c.query(PREVIA_SQL)).rows;
        const p = await previa(c);
        const el = p.l.filter((x) => x.elegivel);
        const nel = p.l.filter((x) => !x.elegivel);
        const ord = (a: string[]) => [...a].sort();
        expect(
          ord(
            prev
              .filter((r) => r.secao === "elegivel")
              .map((r) => `${r.cad_etiqueta_id}|${r.linha_canonica}|${r.situacao}`),
          ),
        ).toEqual(ord(el.map((x) => `${x.cad_etiqueta_id}|${x.linha}|${x.situacao}`)));
        expect(
          ord(
            prev
              .filter((r) => r.secao === "nao_elegivel")
              .map((r) => `${r.cad_etiqueta_id}|${r.situacao}`),
          ),
        ).toEqual(ord(nel.map((x) => `${x.cad_etiqueta_id}|${x.motivo}`)));
        const h = prev.filter((r) => r.secao === "hash_lista");
        expect(h).toHaveLength(1);
        expect(h[0].linha_canonica).toBe(p.hash);
        expect(h[0].situacao).toBe(`n=${p.n}`);
        expect(prev.at(-1)?.secao).toBe("hash_lista");
        const resumo = prev
          .filter((r) => r.secao === "resumo")
          .reduce((s, r) => s + Number(r.n), 0);
        expect(resumo).toBe(p.l.length);
      });
    });

    it("copia: todo elegivel e de CAD interno, fora do PCP, com vinculo efetivo e antes = automatico antigo <> depois", async () => {
      await withTx(async (c) => {
        await aplicaUrgR1b(c);
        const l = await lista(c);
        const el = l.filter((x) => x.elegivel);
        for (const x of el) {
          expect(x.tamanho, x.cad_etiqueta_id).not.toBeNull();
          expect(
            Math.abs(Number(x.antes) - Number(x.antigo)),
            x.cad_etiqueta_id,
          ).toBeLessThanOrEqual(0.0001);
          expect(Math.abs(Number(x.antes) - Number(x.depois)), x.cad_etiqueta_id).toBeGreaterThan(
            0.0001,
          );
          expect(x.linha.split("|").length).toBeGreaterThanOrEqual(8);
        }
        const ids = el.map((x) => x.cad_etiqueta_id);
        if (ids.length) {
          const r = await um<{ n: string }>(
            c,
            `SELECT count(*)::text AS n FROM cad_etiquetas ce JOIN cad k ON k.id = ce.cad_id JOIN modelos m ON m.id = k.modelo_id
            WHERE ce.id = ANY ($1::uuid[]) AND NOT coalesce(k.enviado_corte, false) AND m.origem = 'interno'`,
            [ids],
          );
          expect(Number(r.n)).toBe(ids.length);
        }
      });
    });

    it("paridade TS<->SQL: necessaria = linhaInsumoExplosao (multiplas variantes, por tamanho, fora da grade) em TODO o universo", async () => {
      await withTx(async (c) => {
        await aplicaUrgR1b(c);
        await semeia(c);
        const l = await lista(c);
        const cads = [...new Set(l.map((x) => x.cad_id))];
        // as MESMAS leituras da Explosao: cad_grades (planejada) e o mapa de vinculos (etiquetas + variantes_etiqueta)
        const gr = (
          await c.query(
            "SELECT cad_id, grades_planejadas, grade_total_planejada FROM cad_grades WHERE cad_id = ANY ($1::uuid[])",
            [cads],
          )
        ).rows;
        const gradesPorCad: Record<string, GradeLinha[]> = {};
        for (const g of gr) {
          (gradesPorCad[g.cad_id] ??= []).push({
            grades: g.grades_planejadas ?? {},
            grade_total: g.grade_total_planejada ?? 0,
          });
        }
        const ces = (
          await c.query(
            "SELECT id, cad_id, etiqueta_id, consumo, quantidade_enviar FROM cad_etiquetas WHERE id = ANY ($1::uuid[])",
            [l.map((x) => x.cad_etiqueta_id)],
          )
        ).rows;
        const etqs = (
          await c.query(
            `SELECT e.id, e.tamanho_vinculado, e.formato_tamanho,
                  coalesce((SELECT json_agg(json_build_object('tamanho', v.tamanho)) FROM variantes_etiqueta v WHERE v.etiqueta_id = e.id), '[]') AS variantes_etiqueta
             FROM etiquetas e WHERE e.id = ANY ($1::uuid[])`,
            [[...new Set(ces.map((x) => x.etiqueta_id))]],
          )
        ).rows;
        const tam = mapaTamanhoVinculado(etqs);
        const sql = porId(l);
        let comVinculo = 0;
        let fora = 0;
        let multi = 0;
        for (const e of ces) {
          const s = sql[e.id];
          const grades = gradesPorCad[e.cad_id] ?? [];
          const t = linhaInsumoExplosao(e, tam, grades);
          expect(t.tamanhoVinculado, e.id).toBe(s.tamanho);
          expect(t.quantidade, e.id).not.toBeNull();
          expect(Math.abs((t.quantidade as number) - Number(s.necessaria)), e.id).toBeLessThan(
            1e-9,
          );
          expect(t.foraDaGrade, e.id).toBe(s.aviso !== null);
          if (s.tamanho) comVinculo++;
          if (s.aviso) fora++;
          if (grades.length > 1) multi++;
        }
        expect(comVinculo).toBeGreaterThan(0);
        expect(fora).toBeGreaterThan(0);
        expect(multi).toBeGreaterThan(0);
        // depois = a necessaria arredondada na escala da coluna (numeric(10,2))
        const r = await um<{ n: string }>(
          c,
          `SELECT count(*)::text AS n FROM ${URG_R1B.PREVIA} WHERE depois <> round(necessaria, 2)`,
        );
        expect(r.n).toBe("0");
      });
    });

    it("rodar: corrige SO os aprovados (backup antes/depois); editado a mao, enviado ao PCP, sem vinculo e nao aprovados sao pulados", async () => {
      await withTx(async (c) => {
        await aplicaUrgR1b(c);
        const f = await semeia(c);
        const p = await previa(c);
        const l = porId(p.l);
        const aprov = [l[f.ce.auto].linha, l[f.ce.fora].linha, l[f.ce.frac].linha];
        const r = await rodar(c, aprov, p.hash, p.n);
        expect(r.gravados).toBe(3);
        expect([
          await enviar(c, f.ce.auto),
          await enviar(c, f.ce.fora),
          await enviar(c, f.ce.frac),
        ]).toEqual([25, 0, 8.33]);
        expect([
          await enviar(c, f.ce.mao),
          await enviar(c, f.ce.proprio),
          await enviar(c, f.ce.enviado),
          await enviar(c, f.ce.semCelulas),
        ]).toEqual([77, 50, 50, 40]);
        const pul = Object.fromEntries(r.pulados.map((x) => [x.id, x.motivo]));
        expect(pul[f.ce.mao]).toBe("editado_a_mao");
        expect(pul[f.ce.enviado]).toBe("enviado_ao_pcp");
        expect(pul[f.ce.proprio]).toBe("sem_vinculo_efetivo");
        expect(pul[f.ce.revenda]).toBe("revenda_importado_sem_paridade");
        expect(pul[f.ce.semCelulas]).toBe("grade_incompleta");
        expect(pul[f.ce.naoFecha]).toBe("grade_incompleta");
        expect(pul[f.ce.duasVar]).toBe("grade_incompleta");
        expect(await enviar(c, f.ce.duasVar)).toBe(18);
        expect(pul[f.ce.semVinculo]).toBeUndefined();
        expect(pul[f.ce.auto]).toBeUndefined();
        const bk = (
          await c.query(
            `SELECT cad_etiqueta_id, cad_id, tenant_id, antes, depois, restaurado_em FROM ${URG_R1B.BKP} ORDER BY antes`,
          )
        ).rows;
        expect(
          bk.map((x) => [x.cad_etiqueta_id, Number(x.antes), Number(x.depois), x.restaurado_em]),
        ).toEqual(
          expect.arrayContaining([
            [f.ce.auto, 50, 25, null],
            [f.ce.fora, 50, 0, null],
            [f.ce.frac, 16.67, 8.33, null],
          ]),
        );
        expect(bk).toHaveLength(3);
        expect(bk.every((x) => x.tenant_id === TENANT_TESTE && x.cad_id === f.k1.cad)).toBe(true);
        // a lista (e o hash) seguem iguais depois da correcao: as corrigidas aparecem como ja_corrigido com o "antes" do backup
        const p2 = await previa(c);
        expect(p2.hash).toBe(p.hash);
        expect(porId(p2.l)[f.ce.auto]).toMatchObject({ elegivel: true, situacao: "ja_corrigido" });
        // estoque: nada logado (o mov_log so loga CAD enviado ao PCP)
        const log = await um<{ n: string }>(
          c,
          "SELECT count(*)::text AS n FROM estoque_mov_log WHERE cad_id = $1",
          [f.k1.cad],
        );
        expect(log.n).toBe("0");
      });
    });

    it("idempotente: a 2a execucao com a MESMA lista aprovada grava 0 (ja_corrigido_antes)", async () => {
      await withTx(async (c) => {
        await aplicaUrgR1b(c);
        const f = await semeia(c);
        const p = await previa(c);
        const aprov = [porId(p.l)[f.ce.auto].linha, porId(p.l)[f.ce.frac].linha];
        expect((await rodar(c, aprov, p.hash, p.n)).gravados).toBe(2);
        const r2 = await rodar(c, aprov, p.hash, p.n);
        expect(r2.gravados).toBe(0);
        const pul = Object.fromEntries(r2.pulados.map((x) => [x.id, x.motivo]));
        expect([pul[f.ce.auto], pul[f.ce.frac]]).toEqual([
          "ja_corrigido_antes",
          "ja_corrigido_antes",
        ]);
        expect((await c.query(`SELECT 1 FROM ${URG_R1B.BKP}`)).rowCount).toBe(2);
        expect(await enviar(c, f.ce.auto)).toBe(25);
      });
    });

    it("travas: sem a GUC recusa; lista invalida / repetida / hash errado / n errado / fora da lista / lista mudou = P0001 e NADA grava", async () => {
      await withTx(async (c) => {
        await aplicaUrgR1b(c);
        const f = await semeia(c);
        const p = await previa(c);
        const ok = [porId(p.l)[f.ce.auto].linha];
        let e = await falha(c, () => rodar(c, ok, p.hash, p.n, null));
        expect(e).toMatchObject({ code: "P0001" });
        expect(e.message).toMatch(/^confirmacao_ausente:/);
        e = await falha(c, () => rodar(c, ok, p.hash, p.n, "nao"));
        expect(e.message).toMatch(/^confirmacao_ausente:/);
        e = await falha(c, () => rodar(c, { x: 1 }, p.hash, p.n));
        expect(e.message).toMatch(/^lista_invalida:/);
        e = await falha(c, () => rodar(c, [...ok, ...ok], p.hash, p.n));
        expect(e.message).toMatch(/^lista_invalida:/);
        e = await falha(c, () => rodar(c, ok, "0".repeat(32), p.n));
        expect(e).toMatchObject({ code: "P0001" });
        expect(e.message).toMatch(/^lista_mudou:/);
        e = await falha(c, () => rodar(c, ok, p.hash, p.n + 1));
        expect(e.message).toMatch(/^lista_mudou:/);
        const fake = `${TENANT_TESTE}|${f.k1.cad}|${f.ce.semVinculo}|URG-R1B Modelo 1|URG-R1B Etq sem vinculo||50.00|50.00`;
        e = await falha(c, () => rodar(c, [...ok, fake], p.hash, p.n));
        expect(e.message).toMatch(/^fora_da_lista:/);
        expect(e.message).toContain(f.ce.semVinculo);
        // alguem editou uma linha depois da aprovacao: a lista mudou (o "antes" faz parte da linha) -> nada grava
        await c.query("UPDATE cad_etiquetas SET quantidade_enviar = 51 WHERE id = $1", [f.ce.frac]);
        e = await falha(c, () => rodar(c, ok, p.hash, p.n));
        expect(e.message).toMatch(/^lista_mudou:/);
        expect(/^[\x20-\x7e]*$/.test(e.message)).toBe(true); // ASCII
        expect(await enviar(c, f.ce.auto)).toBe(50);
        expect((await c.query(`SELECT 1 FROM ${URG_R1B.BKP}`)).rowCount).toBe(0);
      });
    });

    it("_down: devolve o 'antes' SO onde segue o 'depois' e o CAD segue fora do PCP; relata o resto; neutraliza; reaplicar a ida volta", async () => {
      await withTx(async (c) => {
        await aplicaUrgR1b(c);
        const f = await semeia(c);
        const k5 = await insCad(c, "URG-R1B Modelo vai ao PCP", "interno", false, GRADES);
        const pcp = await insCe(c, k5.cad, f.eM, 1, 50);
        const p = await previa(c);
        const l = porId(p.l);
        const aprov = [f.ce.auto, f.ce.fora, f.ce.frac, pcp].map((id) => l[id].linha);
        expect((await rodar(c, aprov, p.hash, p.n)).gravados).toBe(4);
        await c.query("UPDATE cad_etiquetas SET quantidade_enviar = 3 WHERE id = $1", [f.ce.fora]); // a pessoa mudou depois
        await c.query("UPDATE cad SET enviado_corte = true WHERE id = $1", [k5.cad]); // foi ao PCP depois da correcao
        await c.query("UPDATE cad_etiquetas SET quantidade_enviar = 16.67 WHERE id = $1", [
          f.ce.frac,
        ]); // voltou ao antes a mao
        const avisos: string[] = [];
        const ouvir = (m: { message?: string }) => avisos.push(String(m.message ?? ""));
        c.on("notice", ouvir);
        await aplicarArquivo(c, URG_R1B.down);
        c.off("notice", ouvir);
        await c.query("SET LOCAL transaction_timeout = 0");
        // L5: as contagens do que FICA usam o mesmo predicado da lista de ids (3 ids = 1 + 1 + 1 + 0)
        const aviso = avisos.find((m) => m.startsWith("urg_r1b_198000_down:"));
        expect(aviso).toContain(
          "1 linha(s) devolvida(s) ao valor de antes; ficam: 1 mudada(s) pela pessoa, 1 ja no valor de antes, 1 de CAD ja enviado ao PCP, 0 que sumiram",
        );
        for (const id of [f.ce.fora, f.ce.frac, pcp]) expect(aviso).toContain(id);
        expect(aviso).not.toContain(f.ce.auto);
        expect([
          await enviar(c, f.ce.auto),
          await enviar(c, f.ce.frac),
          await enviar(c, f.ce.fora),
          await enviar(c, pcp),
        ]).toEqual([50, 16.67, 3, 25]);
        expect(await urgR1bViva(c)).toBe(false);
        expect(await md5Fn(c, URG_R1B.RODAR)).toBe(URG_R1B.NEUTRO[URG_R1B.RODAR]);
        expect(await md5Fn(c, URG_R1B.PREVIA)).toBe(URG_R1B.NEUTRO[URG_R1B.PREVIA]);
        await c.query("SELECT set_config('app.confirmo_enviar_tamanho', 'sim', true)");
        const e = await falha(c, () =>
          um(c, "SELECT public._urg_r1b_enviar_rodar('[]'::jsonb, 'x', 0)"),
        );
        expect(e).toMatchObject({ code: "P0001" });
        expect(e.message).toMatch(/^urg_r1b_enviar_desativada:/);
        const bk = (await c.query(`SELECT restaurado_em FROM ${URG_R1B.BKP}`)).rows;
        expect(bk).toHaveLength(4);
        expect(bk.every((x) => x.restaurado_em !== null)).toBe(true);
        // _down de novo: no-op (nada pendente)
        await aplicarArquivo(c, URG_R1B.down);
        await c.query("SET LOCAL transaction_timeout = 0");
        expect([await enviar(c, f.ce.auto), await enviar(c, f.ce.fora)]).toEqual([50, 3]);
        // reaplicar a ida (a guarda aceita o texto neutro): as devolvidas voltam a ser a_corrigir; backup fica
        await aplicaUrgR1b(c);
        expect(await urgR1bViva(c)).toBe(true);
        expect(porId(await lista(c))[f.ce.auto]).toMatchObject({
          elegivel: true,
          situacao: "a_corrigir",
        });
        expect((await c.query(`SELECT 1 FROM ${URG_R1B.BKP}`)).rowCount).toBe(4);
      });
    });

    it("L2: aviso_kanban lista o CAD com linha que vai a 0 numa loja cujo kanban usa separar_enviar_preenchido", async () => {
      await withTx(async (c) => {
        await aplicaUrgR1b(c);
        const f = await semeia(c);
        // CAD so com a linha que vai a 0 (fora da grade, grade coerente) => a condicao fica falsa
        const k6 = await insCad(c, "URG-R1B Modelo so XG", "interno", false, GRADES);
        await insCe(c, k6.cad, f.eXG, 1, 50);
        const secao = async (s: string) =>
          (await c.query(PREVIA_SQL)).rows.filter(
            (r) => r.secao === s && r.tenant_id === TENANT_TESTE,
          );
        expect(await secao("aviso_kanban")).toEqual([]); // loja sem a condicao no kanban: nada
        await c.query(
          `UPDATE tenant_config SET kanban_requisitos = jsonb_build_object('pcp', jsonb_build_array('separar_enviar_preenchido'))
            WHERE tenant_id = $1`,
          [TENANT_TESTE],
        );
        const av = Object.fromEntries(
          (await secao("aviso_kanban")).map((r) => [r.cad_id, r.situacao]),
        );
        expect(av[k6.cad]).toBe("fica_falso");
        expect(av[f.k1.cad]).toBe("continua_verdadeiro"); // o CAD 1 tem outras linhas > 0 depois da correcao
        expect(av[f.k4.cad]).toBeUndefined(); // grade_incompleta nao e elegivel: nao vai a 0
      });
    });

    it("M2: rodador do kit = UM arquivo nao interativo com timeouts locais, a GUC e BEGIN/COMMIT proprios", () => {
      const r = readFileSync(`${ROOT}supabase/consultas/urg_r1b_enviar_rodar.sql`, "utf8");
      const cmd = r.split("\n").filter((x) => !x.startsWith("--"));
      expect(cmd.filter((x) => /^BEGIN;$/.test(x))).toHaveLength(1);
      expect(cmd.filter((x) => /^COMMIT;$/.test(x))).toHaveLength(1);
      for (const t of [
        "SET LOCAL idle_in_transaction_session_timeout = '15s';",
        "SET LOCAL statement_timeout = '60s';",
        "SET LOCAL lock_timeout = '1500ms';",
        "SET LOCAL app.confirmo_enviar_tamanho = 'sim';",
        "\\set ON_ERROR_STOP on",
      ]) {
        expect(cmd, t).toContain(t);
      }
      expect(r).toContain("public._urg_r1b_enviar_rodar(:'lista'::jsonb, :'hash', :n)");
      // N2: lista truncada = erro ANTES do BEGIN (confere jsonb_array_length(lista) = n_aprovado E n_aprovado = n)
      const iBegin = cmd.indexOf("BEGIN;");
      const iConf = cmd.findIndex((x) =>
        x.includes("jsonb_array_length(:'lista'::jsonb) = CAST(:'n_aprovado' AS integer)"),
      );
      const iNn = cmd.findIndex((x) =>
        x.includes("CAST(:'n_aprovado' AS integer) = CAST(:'n' AS integer)"),
      );
      const iIf = cmd.indexOf("\\if :r1b_lista_inteira");
      const iTrunc = cmd.findIndex((x) => x.includes("r1b_lista_truncada"));
      for (const i of [iConf, iNn, iIf, iTrunc]) {
        expect(i).toBeGreaterThan(-1);
        expect(i).toBeLessThan(iBegin);
      }
      const iSel = cmd.findIndex((x) => x.includes("_urg_r1b_enviar_rodar("));
      expect(iSel).toBeGreaterThan(iBegin);
      expect(cmd.indexOf("COMMIT;")).toBeGreaterThan(iSel);
    });

    it("N2/N3: o RODADOR de verdade (psql -f, copia com ROLLBACK no lugar do COMMIT): lista inteira grava n; truncada / n_aprovado != n / hash errado param e NADA fica", async (ctx) => {
      // Fora de txn de teste (o arquivo abre a propria). Usa o estado COMMITADO da copia: so roda com a 198000 viva nela.
      const psql = (args: string[]) =>
        spawnSync("psql", [dbUrl()!, "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", ...args], {
          encoding: "utf8",
        });
      const viva = psql([
        "-c",
        `SELECT md5(pg_get_functiondef(to_regprocedure('${URG_R1B.RODAR}'))) = '${URG_R1B.DEPOIS[URG_R1B.RODAR]}'
            AND to_regclass('${URG_R1B.BKP}') IS NOT NULL`,
      ]);
      if (viva.error || viva.status !== 0) ctx.skip(); // sem psql no PATH
      if (viva.stdout.trim() !== "t") ctx.skip(); // copia sem a 198000 (ou outro texto): nada a provar aqui
      const original = readFileSync(`${ROOT}supabase/consultas/urg_r1b_enviar_rodar.sql`, "utf8");
      expect(original.split("\n").filter((x) => x === "COMMIT;")).toHaveLength(1);
      const dir = mkdtempSync(join(tmpdir(), "urg-r1b-rodador-"));
      const arq = join(dir, "rodar_rollback.sql");
      writeFileSync(arq, original.replace(/^COMMIT;$/m, "ROLLBACK;"));
      try {
        const linhas = psql([
          "-c",
          `SELECT linha FROM ${URG_R1B.PREVIA} WHERE elegivel ORDER BY tenant_id, cad_id, cad_etiqueta_id`,
        ]);
        expect(linhas.status, linhas.stderr).toBe(0);
        const el = linhas.stdout.split("\n").filter((x) => x !== "");
        const hash = md5(el.join("\n"));
        const n = el.length;
        const bkp = () => psql(["-c", `SELECT count(*) FROM ${URG_R1B.BKP}`]).stdout.trim();
        const bk0 = bkp();
        const roda = (lista: string[], nAprovado: number, h: string, nPrevia: number) =>
          psql([
            "-v",
            `lista=${JSON.stringify(lista)}`,
            "-v",
            `n_aprovado=${nAprovado}`,
            "-v",
            `hash=${h}`,
            "-v",
            `n=${nPrevia}`,
            "-f",
            arq,
          ]);
        // lista inteira: chega ao _rodar e grava as n (o ROLLBACK da copia desfaz)
        const ok = roda(el, n, hash, n);
        expect(ok.status, ok.stderr).toBe(0);
        const res = ok.stdout.split("\n").find((x) => x.startsWith("r1b_correcao_resultado "));
        expect(res, ok.stdout).toBeDefined();
        const r = JSON.parse(res!.slice("r1b_correcao_resultado ".length)) as Resultado;
        expect([r.gravados, r.n, r.hash]).toEqual([n, n, hash]);
        // truncada (colada pela metade): para ANTES do BEGIN, nada chega ao _rodar
        if (n > 0) {
          const tr = roda(el.slice(0, n - 1), n, hash, n);
          expect(tr.status).not.toBe(0);
          expect(tr.stderr).toMatch(/r1b_lista_truncada/);
          expect(tr.stdout).not.toMatch(/r1b_correcao_resultado/);
        }
        // n_aprovado coerente com a lista mas != n da previa (aprovacao parcial pelo rodador) tambem para
        const parcial = roda(el.slice(0, Math.max(0, n - 1)), Math.max(0, n - 1), hash, n);
        if (n > 0) {
          expect(parcial.status).not.toBe(0);
          expect(parcial.stderr).toMatch(/r1b_lista_truncada/);
        }
        // hash errado: passa a conferencia do arquivo, o _rodar recusa (lista_mudou) e nada grava
        const hx = roda(el, n, "0".repeat(32), n);
        expect(hx.status).not.toBe(0);
        expect(hx.stderr).toMatch(/lista_mudou/);
        expect(hx.stdout).not.toMatch(/r1b_correcao_resultado/);
        expect(bkp()).toBe(bk0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("N1: rodar usa o MENOR entre o lock_timeout do chamador e 3s (kit 1500ms fica; 0, 5min e 3001ms viram 3s)", async () => {
      await withTx(async (c) => {
        await aplicaUrgR1b(c);
        const p = await previa(c);
        await c.query("SET LOCAL lock_timeout = '1500ms'");
        await rodar(c, [], p.hash, p.n);
        expect((await um<{ v: string }>(c, "SELECT current_setting('lock_timeout') AS v")).v).toBe(
          "1500ms",
        );
        await c.query("SET LOCAL lock_timeout = 0");
        await rodar(c, [], p.hash, p.n);
        expect((await um<{ v: string }>(c, "SELECT current_setting('lock_timeout') AS v")).v).toBe(
          "3s",
        );
        // N1: teto = o MENOR entre o do chamador e 3 s (chamador com 5 min nao espera 5 min)
        await c.query("SET LOCAL lock_timeout = '5min'");
        await rodar(c, [], p.hash, p.n);
        expect((await um<{ v: string }>(c, "SELECT current_setting('lock_timeout') AS v")).v).toBe(
          "3s",
        );
        await c.query("SET LOCAL lock_timeout = '3001ms'");
        await rodar(c, [], p.hash, p.n);
        expect((await um<{ v: string }>(c, "SELECT current_setting('lock_timeout') AS v")).v).toBe(
          "3s",
        );
      });
      // o _down usa o MESMO teto (texto identico ao do _rodar); o arquivo do _down poe 1500ms antes
      const teto =
        "IF (SELECT s.setting::bigint FROM pg_settings s WHERE s.name = 'lock_timeout') NOT BETWEEN 1 AND 3000 THEN";
      for (const arq of [URG_R1B.mig, URG_R1B.down]) {
        const t = readFileSync(`${ROOT}${arq}`, "utf8");
        expect(t, arq).toContain(teto);
        expect(t, arq).toContain("PERFORM set_config('lock_timeout', '3s', true);");
      }
    });

    it("_down sem nada pendente nao toca cad_etiquetas (sem RowExclusive): a cadeia LIFO dos testes o chama a toda hora", async () => {
      await withTx(async (c) => {
        await aplicaUrgR1b(c);
        const LOCKS = `SELECT DISTINCT n.nspname || '.' || cl.relname AS rel, l.mode
                       FROM pg_locks l JOIN pg_class cl ON cl.oid = l.relation JOIN pg_namespace n ON n.oid = cl.relnamespace
                      WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname NOT IN ('pg_catalog', 'pg_toast')`;
        const antes = new Set((await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`));
        await voltaUrgR1bSePreciso(c);
        const novas = (await c.query(LOCKS)).rows
          .map((r) => `${r.rel}|${r.mode}`)
          .filter((k) => !antes.has(k));
        expect(novas.filter((k) => !k.endsWith("|AccessShareLock"))).toEqual([]);
        expect(await urgR1bViva(c)).toBe(false);
      });
    });

    it("_down_drop: recusa com a funcao viva; recusa apagar backup com linhas sem a GUC; com a GUC apaga funcoes e tabela", async () => {
      await withTx(async (c) => {
        await aplicaUrgR1b(c);
        let e = await falha(c, () => aplicarArquivo(c, URG_R1B.drop));
        expect(e.message).toMatch(/urg_r1b_198000_down_drop/);
        const f = await semeia(c);
        const p = await previa(c);
        await rodar(c, [porId(p.l)[f.ce.auto].linha], p.hash, p.n);
        await aplicarArquivo(c, URG_R1B.down);
        await c.query("SET LOCAL transaction_timeout = 0");
        e = await falha(c, () => aplicarArquivo(c, URG_R1B.drop));
        expect(e.message).toMatch(/urg_r1b_198000_down_drop/);
        // L4: a instrucao e GUC de SESSAO (PGOPTIONS) - o arquivo abre o proprio BEGIN, um SET LOCAL de fora nao vale
        expect(e.message).toContain("PGOPTIONS=-c app.confirmo_apagar_backup_enviar_tamanho=sim");
        expect(readFileSync(`${ROOT}${URG_R1B.drop}`, "utf8")).not.toMatch(
          /SET LOCAL app\.confirmo_apagar_backup/,
        );
        await c.query(
          "SELECT set_config('app.confirmo_apagar_backup_enviar_tamanho', 'sim', false)",
        );
        await aplicarArquivo(c, URG_R1B.drop);
        await c.query("SET LOCAL transaction_timeout = 0");
        expect(await md5Fn(c, URG_R1B.RODAR)).toBeNull();
        expect(await md5Fn(c, URG_R1B.PREVIA)).toBeNull();
        expect(
          (await um<{ t: string | null }>(c, "SELECT to_regclass($1)::text AS t", [URG_R1B.BKP])).t,
        ).toBeNull();
        // e a ida recria tudo do zero
        await aplicaUrgR1b(c);
        expect(await urgR1bViva(c)).toBe(true);
      });
    });

    it("forma: 2 funcoes SECURITY DEFINER, search_path=public, sem EXECUTE p/ PUBLIC/anon/authenticated; backup RLS sem policy e sem grant", async () => {
      await withTx(async (c) => {
        await aplicaUrgR1b(c);
        for (const sig of [URG_R1B.RODAR, URG_R1B.PREVIA]) {
          const r = await um<{
            anon: boolean;
            auth: boolean;
            pub: boolean;
            cfg: string;
            sd: boolean;
          }>(
            c,
            `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                  EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0) AS pub,
                  coalesce(array_to_string(p.proconfig, '|'), '') AS cfg, p.prosecdef AS sd
             FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
            [sig],
          );
          expect(r, sig).toMatchObject({
            anon: false,
            auth: false,
            pub: false,
            cfg: "search_path=public",
            sd: true,
          });
        }
        const t = await um<{ rls: boolean; pol: string; priv: boolean }>(
          c,
          `SELECT c.relrowsecurity AS rls,
                (SELECT count(*)::text FROM pg_policy WHERE polrelid = c.oid) AS pol,
                (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT')
                 OR has_table_privilege('authenticated', c.oid, 'INSERT') OR has_table_privilege('authenticated', c.oid, 'UPDATE')
                 OR has_table_privilege('authenticated', c.oid, 'DELETE') OR has_table_privilege('service_role', c.oid, 'SELECT')) AS priv
           FROM pg_class c WHERE c.oid = $1::regclass`,
          [URG_R1B.BKP],
        );
        expect(t).toEqual({ rls: true, pol: "0", priv: false });
      });
    });

    it("travas da ida (por DIFERENCA): nada fora do backup alem de AccessShare, nada em auth/storage/realtime; reaplicar 2x nao falha", async () => {
      await withTx(async (c) => {
        await aplicaUrgR1b(c);
        await voltaUrgR1bSePreciso(c);
        await aplicarArquivo(c, URG_R1B.drop); // copia sem gravacao no backup: o drop passa sem GUC
        await c.query("SET LOCAL transaction_timeout = 0");
        const LOCKS = `SELECT DISTINCT n.nspname || '.' || cl.relname AS rel, l.mode
                       FROM pg_locks l JOIN pg_class cl ON cl.oid = l.relation JOIN pg_namespace n ON n.oid = cl.relnamespace
                      WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname NOT IN ('pg_catalog', 'pg_toast')`;
        const antes = new Set((await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`));
        await aplicarArquivo(c, URG_R1B.mig);
        await aplicarArquivo(c, URG_R1B.mig);
        await c.query("SET LOCAL transaction_timeout = 0");
        const novas = (await c.query(LOCKS)).rows
          .map((r) => `${r.rel}|${r.mode}`)
          .filter((k) => !antes.has(k));
        expect(novas.filter((k) => /^(auth|storage|realtime)\./.test(k))).toEqual([]);
        expect(
          novas.filter(
            (k) =>
              !k.startsWith(`${URG_R1B.BKP}`) &&
              !k.startsWith("information_schema.") &&
              !k.endsWith("|AccessShareLock"),
          ),
        ).toEqual([]);
        expect(await urgR1bViva(c)).toBe(true);
      });
    });
  },
);
