// Urgentes R1 T2b (plan-a, P-307 B; migration 20261103170500_urg_r1_tamanho_legado): correcao UNICA que reaproveita o vinculo de
// tamanho legado (etiquetas.tamanho) para etiquetas.tamanho_vinculado, SO com a lista aprovada pelo dono (padrao P-166: previa
// so-leitura + hash + backup + GUC). A migration NAO roda a correcao; aqui ela roda SO dentro da txn revertida do teste.
// Txn revertida; os blocos sao aplicados DENTRO da txn por aplicaUrgA(c, "170500") (pula os ja vivos na copia). So na copia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, withTx, um, ehBancoLocal, TENANT_TESTE } from "./db";
import { aplicaUrgA, urgAViva, URG_A_MIGS } from "./urg-a-helpers";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PREVIA = readFileSync(`${ROOT}supabase/consultas/urg_r1_tamanho_legado_previa.sql`, "utf8");
const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979";
const ETIQUETA_TAMANHO = "ecaf05af-d8e6-4883-b51d-89dc9340da73"; // Loja Teste, 36|PP, 12 variantes com tamanho
const AVERARA_40 = "431470e0-dca2-4811-a293-e8aafe348dbe"; // "ETIQUETA AVERARA + TAMANHO 40" (40|M)
const AVERARA_TAM_M = "b1e88eb8-6d37-4e8e-8b23-2ee865a71a84"; // "ETIQUETA AVERARA TAM.M" (40|M)
const RODAR = "public._urg_r1_tamanho_legado_rodar(jsonb,text,integer)";
const LISTA = "public._urg_r1_tamanho_legado_lista()";
const BKP = "public._bkp_urg_r1_tamanho_legado";
const bloco = () => URG_A_MIGS.find((x) => x.id === "170500")?.b;
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

type LinhaLista = {
  tenant_id: string | null;
  etiqueta_id: string;
  nome: string;
  valor: string;
  n_modelos: number;
  elegivel: boolean;
  motivo: string | null;
  vinculo_atual: string | null;
  linha: string;
};
type Resultado = { ligados: number; pulados: { id: string; motivo: string }[]; hash: string; n: number };

async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}

async function lista(c: Client): Promise<LinhaLista[]> {
  return (await c.query(`SELECT * FROM ${LISTA} ORDER BY tenant_id, etiqueta_id`)).rows as LinhaLista[];
}

/** A lista canonica dos elegiveis (ordem tenant_id, etiqueta_id), o hash e o n - exatamente o que o dono aprova. */
async function aprovada(c: Client): Promise<{ linhas: string[]; hash: string; n: number }> {
  const el = (await lista(c)).filter((l) => l.elegivel).map((l) => l.linha);
  return { linhas: el, hash: md5(el.join("\n")), n: el.length };
}

async function rodar(c: Client, linhas: unknown, hash: string, n: number, guc = "sim"): Promise<Resultado> {
  await c.query("SELECT set_config('app.confirmo_tamanho_legado', $1, true)", [guc]);
  return (await um<{ r: Resultado }>(c, `SELECT ${RODAR.replace("(jsonb,text,integer)", "")}($1::jsonb, $2, $3) AS r`, [
    JSON.stringify(linhas),
    hash,
    n,
  ])).r;
}

/** Roda esperando erro, sem perder a txn do teste. */
async function falha(c: Client, fn: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT falha");
  try {
    await fn();
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT falha");
    return { code: e.code, message: e.message };
  }
  await c.query("RELEASE SAVEPOINT falha");
  throw new Error("esperava erro e nao veio");
}

async function vinculos(c: Client): Promise<Record<string, string | null>> {
  const r = await c.query("SELECT id, tamanho_vinculado AS v FROM etiquetas WHERE nullif(btrim(tamanho), '') IS NOT NULL");
  return Object.fromEntries(r.rows.map((x) => [x.id as string, x.v as string | null]));
}

async function insereEtq(c: Client, nome: string, tamanho: string, formato: string, variantes: string[] = []): Promise<string> {
  const id = (
    await um<{ id: string }>(
      c,
      "INSERT INTO etiquetas (tenant_id, nome, tamanho, formato_tamanho) VALUES ($1, $2, $3, $4) RETURNING id",
      [TENANT_TESTE, nome, tamanho, formato],
    )
  ).id;
  for (const t of variantes) {
    await c.query("INSERT INTO variantes_etiqueta (tenant_id, etiqueta_id, tamanho) VALUES ($1, $2, $3)", [TENANT_TESTE, id, t]);
  }
  return id;
}

describe.skipIf(!RODA)("urg R1 T2b — correcao unica do tamanho legado (170500)", () => {
  it("o bloco 170500 existe no repositorio (gerado por mig/gerar-a1.mjs) e vem depois do 170000", () => {
    expect(bloco()).toBeTruthy();
    expect(URG_A_MIGS.map((x) => x.id).slice(0, 2)).toEqual(["170000", "170500"]);
  });

  it("a previa SO-LEITURA (supabase/consultas) == _urg_r1_tamanho_legado_lista(), linha a linha, e o hash bate", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "170500");
      // insumos sinteticos para exercitar todos os motivos tambem pela previa
      await insereEtq(c, "URG-A1B fora 50", "50|XG", "nenhum");
      await insereEtq(c, "URG-A1B qualquer", "40|M", "nenhum");
      await insereEtq(c, "urg-a1b etiqueta tám.p", " 38|P ", "letra");
      await insereEtq(c, "URG-A1B ETIQUETA TAMANHO 40 var", "40|M", "ambos", ["M"]);
      const prev = (await c.query(PREVIA)).rows;
      const l = await lista(c);
      const el = l.filter((x) => x.elegivel);
      const nel = l.filter((x) => !x.elegivel);
      expect(prev.filter((r) => r.secao === "elegivel").map((r) => [r.etiqueta_id, r.linha_canonica, r.situacao])).toEqual(
        el.map((x) => [x.etiqueta_id, x.linha, x.vinculo_atual === null ? "a_ligar" : `ja_vinculado: ${x.vinculo_atual}`]),
      );
      expect(prev.filter((r) => r.secao === "nao_elegivel").map((r) => [r.etiqueta_id, r.situacao])).toEqual(
        nel.map((x) => [x.etiqueta_id, x.motivo]),
      );
      const h = prev.filter((r) => r.secao === "hash_lista");
      expect(h).toHaveLength(1);
      expect(h[0].linha_canonica).toBe(md5(el.map((x) => x.linha).join("\n")));
      expect(h[0].situacao).toBe(`n=${el.length}`);
      expect(prev.at(-1)?.secao).toBe("hash_lista");
    });
  });

  it("copia: os 18 elegiveis sao da Ave Rara; 'Etiqueta Tamanho' (12 variantes com tamanho) fica fora", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "170500");
      const l = await lista(c);
      const el = l.filter((x) => x.elegivel);
      expect(el).toHaveLength(18);
      expect(new Set(el.map((x) => x.tenant_id))).toEqual(new Set([AVE_RARA]));
      expect(el.every((x) => x.motivo === null && x.linha.split("|").length === 6)).toBe(true);
      expect(l.find((x) => x.etiqueta_id === ETIQUETA_TAMANHO)).toMatchObject({ elegivel: false, motivo: "com_tamanho_proprio" });
    });
  });

  it("travas: sem a GUC recusa; lista invalida / hash errado / n errado / linha fora da lista = P0001 e NADA grava", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "170500");
      const a = await aprovada(c);
      const antes = await vinculos(c);
      const nBkp = async () => Number((await um<{ n: string }>(c, `SELECT count(*)::text AS n FROM ${BKP}`)).n);
      const bkp0 = await nBkp();
      let e = await falha(c, () => rodar(c, a.linhas, a.hash, a.n, ""));
      expect(e).toMatchObject({ code: "P0001" });
      expect(e.message).toMatch(/^confirmacao_ausente:/);
      e = await falha(c, () => rodar(c, { x: 1 }, a.hash, a.n));
      expect(e.message).toMatch(/^lista_invalida:/);
      e = await falha(c, () => rodar(c, [a.linhas[0], 7], a.hash, a.n));
      expect(e.message).toMatch(/^lista_invalida:/);
      e = await falha(c, () => rodar(c, [a.linhas[0], a.linhas[0]], a.hash, a.n));
      expect(e.message).toMatch(/^lista_invalida:/);
      e = await falha(c, () => rodar(c, a.linhas, md5("outra"), a.n));
      expect(e).toMatchObject({ code: "P0001" });
      expect(e.message).toMatch(/^lista_mudou:/);
      e = await falha(c, () => rodar(c, a.linhas, a.hash, a.n + 1));
      expect(e.message).toMatch(/^lista_mudou:/);
      e = await falha(c, () => rodar(c, [...a.linhas, `${AVE_RARA}|${ETIQUETA_TAMANHO}|x|36|PP|7`], a.hash, a.n));
      expect(e.message).toMatch(/^fora_da_lista:/);
      // mudou a lista DEPOIS da aprovacao (um insumo novo elegivel) -> o hash aprovado nao vale mais
      await insereEtq(c, "URG-A1B ETIQUETA TAM.GG nova", "44|GG", "nenhum");
      e = await falha(c, () => rodar(c, a.linhas, a.hash, a.n));
      expect(e.message).toMatch(/^lista_mudou:/);
      expect(/^[\x20-\x7e]*$/.test(e.message)).toBe(true); // RAISE so ASCII
      const depois = await vinculos(c);
      for (const [k, v] of Object.entries(antes)) expect(depois[k], k).toBe(v);
      expect(Object.values(depois).every((v) => v === null)).toBe(true); // a copia nao tem vinculo gravado; nada foi ligado
      expect(await nBkp()).toBe(bkp0);
    });
  });

  it("roda a lista aprovada: liga so os elegiveis aprovados com vinculo vazio (btrim), pula o resto com o motivo, backup antes/depois", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "170500");
      const fora = await insereEtq(c, "URG-A1B fora 50", "50|XG", "nenhum");
      const naoCasa = await insereEtq(c, "URG-A1B qualquer", "40|M", "nenhum");
      const acento = await insereEtq(c, "urg-a1b etiqueta tám.p", " 38|P ", "letra");
      const comVar = await insereEtq(c, "URG-A1B ETIQUETA TAMANHO 40 var", "40|M", "ambos", ["M"]);
      const espacos = await insereEtq(c, "URG-A1B TAMANHO 42 espacos", "42|G", "nenhum");
      await c.query("UPDATE etiquetas SET tamanho_vinculado = '  ' WHERE id = $1", [espacos]); // so espacos = vazio -> liga
      await c.query("UPDATE etiquetas SET tamanho_vinculado = '42|G' WHERE id = $1", [AVERARA_40]); // a pessoa ja ligou outro
      const l = await lista(c);
      const motivo = (id: string) => l.find((x) => x.etiqueta_id === id)?.motivo;
      expect(motivo(fora)).toBe("fora_da_grade");
      expect(motivo(naoCasa)).toBe("nome_nao_casa");
      expect(motivo(comVar)).toBe("com_tamanho_proprio");
      expect(l.find((x) => x.etiqueta_id === acento)).toMatchObject({ elegivel: true, valor: "38|P" });
      expect(l.find((x) => x.etiqueta_id === AVERARA_40)).toMatchObject({ elegivel: true, vinculo_atual: "42|G" });
      const a = await aprovada(c);
      expect(a.n).toBe(18 + 2); // os 18 da copia + "tam.p" com acento + o de vinculo so de espacos
      const r = await rodar(c, a.linhas, a.hash, a.n);
      expect(r.ligados).toBe(a.n - 1); // menos o que a pessoa ja tinha ligado
      expect(r.hash).toBe(a.hash);
      const pulado = (id: string) => r.pulados.find((p) => p.id === id)?.motivo;
      expect(pulado(AVERARA_40)).toBe("ja_vinculado");
      expect(pulado(ETIQUETA_TAMANHO)).toBe("com_tamanho_proprio");
      expect(pulado(fora)).toBe("fora_da_grade");
      expect(pulado(naoCasa)).toBe("nome_nao_casa");
      expect(pulado(comVar)).toBe("com_tamanho_proprio");
      expect(pulado(acento)).toBeUndefined();
      const v = await vinculos(c);
      for (const x of l.filter((y) => y.elegivel && y.etiqueta_id !== AVERARA_40)) expect(v[x.etiqueta_id], x.nome).toBe(x.valor);
      expect(v[AVERARA_40]).toBe("42|G"); // nunca sobrescreve
      expect(v[acento]).toBe("38|P"); // btrim do legado
      expect(v[fora]).toBeNull();
      expect(v[naoCasa]).toBeNull();
      expect(v[comVar]).toBeNull();
      expect(v[ETIQUETA_TAMANHO]).toBeNull();
      const bkp = (await c.query(`SELECT etiqueta_id, tenant_id, antes, depois FROM ${BKP} ORDER BY etiqueta_id`)).rows;
      expect(bkp).toHaveLength(r.ligados);
      expect(bkp.find((b) => b.etiqueta_id === espacos)).toMatchObject({ antes: "  ", depois: "42|G", tenant_id: TENANT_TESTE });
      expect(bkp.find((b) => b.etiqueta_id === AVERARA_TAM_M)).toMatchObject({ antes: null, depois: "40|M", tenant_id: AVE_RARA });
      // 2a execucao com a MESMA aprovacao: idempotente (0 ligados; os ja corrigidos = ja_corrigido_antes, o ligado pela pessoa =
      // ja_vinculado; sem backup novo)
      const r2 = await rodar(c, a.linhas, a.hash, a.n);
      expect(r2.ligados).toBe(0);
      expect(r2.pulados.filter((p) => p.motivo === "ja_corrigido_antes")).toHaveLength(r.ligados);
      expect(r2.pulados.filter((p) => p.motivo === "ja_vinculado").map((p) => p.id)).toEqual([AVERARA_40]);
      expect((await c.query(`SELECT 1 FROM ${BKP}`)).rowCount).toBe(r.ligados);
      expect(await vinculos(c)).toEqual(v);
    });
  });

  it("I-1/B-5: valor so-numero e valor terminado em '|' so passam com o nome casando (regra 3 nunca vaza por NULL); tamanho que so existe na grade de OUTRA loja = fora_da_grade", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "170500");
      await c.query(`UPDATE tenant_config SET tamanhos_grade = tamanhos_grade || '["40", "42|"]'::jsonb WHERE tenant_id = $1`, [TENANT_TESTE]);
      await c.query(`UPDATE tenant_config SET tamanhos_grade = tamanhos_grade || '["50|XG"]'::jsonb WHERE tenant_id = $1`, [AVE_RARA]);
      const soNumNao = await insereEtq(c, "URG-A1B ETIQUETA QUALQUER 38", "40", "nenhum");
      const soNumSim = await insereEtq(c, "URG-A1B ETIQUETA NUMERO 40", "40", "nenhum");
      const barraNao = await insereEtq(c, "URG-A1B ETIQUETA SEM NUMERO", "42|", "nenhum");
      const barraSim = await insereEtq(c, "URG-A1B ETIQUETA 42", "42|", "nenhum");
      const outraLoja = await insereEtq(c, "URG-A1B ETIQUETA TAMANHO 50", "50|XG", "nenhum"); // 50|XG so na grade da Ave Rara
      const l = await lista(c);
      const de = (id: string) => l.find((x) => x.etiqueta_id === id);
      expect(de(soNumNao)).toMatchObject({ elegivel: false, motivo: "nome_nao_casa" });
      expect(de(barraNao)).toMatchObject({ elegivel: false, motivo: "nome_nao_casa" });
      expect(de(soNumSim)).toMatchObject({ elegivel: true, motivo: null, valor: "40" });
      expect(de(barraSim)).toMatchObject({ elegivel: true, motivo: null, valor: "42|" });
      expect(de(outraLoja)).toMatchObject({ elegivel: false, motivo: "fora_da_grade" });
      // a previa so-leitura da o MESMO veredito
      const prev = (await c.query(PREVIA)).rows;
      const sit = (id: string) => prev.find((r) => r.etiqueta_id === id)?.situacao;
      expect([soNumNao, barraNao, soNumSim, barraSim, outraLoja].map(sit)).toEqual([
        "nome_nao_casa",
        "nome_nao_casa",
        "a_ligar",
        "a_ligar",
        "fora_da_grade",
      ]);
      const a = await aprovada(c);
      await rodar(c, a.linhas, a.hash, a.n);
      const v = await vinculos(c);
      expect([v[soNumNao], v[barraNao], v[soNumSim], v[barraSim], v[outraLoja]]).toEqual([null, null, "40", "42|", null]);
    });
  });

  it("M-1: rodar de novo NAO religa o que a pessoa desligou depois da 1a rodada (ja_corrigido_antes)", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "170500");
      const a = await aprovada(c);
      const r1 = await rodar(c, a.linhas, a.hash, a.n);
      expect(r1.ligados).toBe(a.n);
      await c.query("UPDATE etiquetas SET tamanho_vinculado = NULL WHERE id = $1", [AVERARA_TAM_M]); // decisao da pessoa
      const r2 = await rodar(c, a.linhas, a.hash, a.n);
      expect(r2.ligados).toBe(0);
      expect(r2.pulados.find((p) => p.id === AVERARA_TAM_M)?.motivo).toBe("ja_corrigido_antes");
      expect((await vinculos(c))[AVERARA_TAM_M]).toBeNull();
      expect((await c.query(`SELECT 1 FROM ${BKP}`)).rowCount).toBe(a.n);
    });
  });

  it("M-2: _down marca o backup como restaurado; vinculo religado a mao depois NAO e desfeito por um 2o _down (no-op, sem trava)", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await aplicaUrgA(c, "170500");
      const a = await aprovada(c);
      await rodar(c, a.linhas, a.hash, a.n);
      await aplicarArquivo(c, b!.down);
      await c.query("SET LOCAL transaction_timeout = 0");
      expect((await vinculos(c))[AVERARA_TAM_M]).toBeNull();
      const pend = await um<{ n: string }>(c, `SELECT count(*)::text AS n FROM ${BKP} WHERE restaurado_em IS NULL`);
      expect(pend.n).toBe("0");
      await c.query("UPDATE etiquetas SET tamanho_vinculado = '40|M' WHERE id = $1", [AVERARA_TAM_M]); // a pessoa religa a mao
      const LOCKS = `SELECT DISTINCT n.nspname || '.' || cl.relname AS rel, l.mode
                       FROM pg_locks l JOIN pg_class cl ON cl.oid = l.relation JOIN pg_namespace n ON n.oid = cl.relnamespace
                      WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname NOT IN ('pg_catalog', 'pg_toast')`;
      const antes = new Set((await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`));
      await aplicarArquivo(c, b!.down);
      await c.query("SET LOCAL transaction_timeout = 0");
      const novas = (await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`).filter((k) => !antes.has(k));
      expect(novas.filter((k) => !k.endsWith("|AccessShareLock"))).toEqual([]);
      expect((await vinculos(c))[AVERARA_TAM_M]).toBe("40|M");
    });
  });

  it("M-3: a previa mostra por insumo os modelos que vao a 0 pecas (total > 0 e celula do tamanho ausente/0) - informativo, fora do hash", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "170500");
      const prev = (await c.query(PREVIA)).rows.filter((r) => r.secao === "elegivel");
      // mesma conta pelos helpers da 170000 (fonte unica), por insumo elegivel
      const esperado = (
        await c.query(
          `SELECT l.etiqueta_id, count(*) FILTER (WHERE x.tot > 0 AND public._insumo_pecas(l.valor, public._grade_mapa_modelo(x.id), x.tot) = 0)::int AS n
             FROM public._urg_r1_tamanho_legado_lista() l
             JOIN LATERAL (SELECT DISTINCT m.id,
                                  (SELECT coalesce(sum(g.grade_total), 0) FROM modelo_grades g WHERE g.modelo_id = m.id)::numeric AS tot
                             FROM modelo_etiquetas me JOIN modelos m ON m.id = me.modelo_id AND m.tenant_id = l.tenant_id
                            WHERE me.etiqueta_id = l.etiqueta_id) x ON true
            WHERE l.elegivel
            GROUP BY l.etiqueta_id`,
        )
      ).rows as { etiqueta_id: string; n: number }[];
      expect(prev.reduce((t, r) => t + Number(r.n_modelos_zero), 0)).toBe(esperado.reduce((t, x) => t + x.n, 0));
      for (const r of prev) {
        const e = esperado.find((x) => x.etiqueta_id === r.etiqueta_id)?.n ?? 0;
        expect(Number(r.n_modelos_zero), r.nome).toBe(e);
        if (e === 0) expect(r.modelos_zero).toBeNull();
        else expect(String(r.modelos_zero).split(" / ")).toHaveLength(e);
      }
      // copia: SAIA MARY e VESTIDO BEATRIX (grade com total e sem celulas) aparecem nos 6 "ETIQUETA AVERARA + TAMANHO nn"
      const tamM = prev.find((r) => r.etiqueta_id === AVERARA_40);
      expect(String(tamM?.modelos_zero)).toMatch(/SAIA MARY .*grade sem celulas/);
      expect(String(tamM?.modelos_zero)).toMatch(/VESTIDO BEATRIX .*grade sem celulas/);
      // fora do hash: o hash da previa continua = md5 das linhas canonicas
      const h = (await c.query(PREVIA)).rows.find((r) => r.secao === "hash_lista");
      expect(h.linha_canonica).toBe((await aprovada(c)).hash);
    });
  });

  it("aprovacao PARCIAL: liga so as linhas aprovadas; os outros elegiveis ficam vazios (nao_aprovado)", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "170500");
      const a = await aprovada(c);
      const escolhidas = a.linhas.slice(0, 3);
      const r = await rodar(c, escolhidas, a.hash, a.n);
      expect(r.ligados).toBe(3);
      const ids = new Set(escolhidas.map((s) => s.split("|")[1]));
      const v = await vinculos(c);
      for (const s of a.linhas) {
        const id = s.split("|")[1];
        if (ids.has(id)) expect(v[id]).toBe(s.split("|")[3] + "|" + s.split("|")[4]);
        else {
          expect(v[id]).toBeNull();
          expect(r.pulados.find((p) => p.id === id)?.motivo).toBe("nao_aprovado");
        }
      }
    });
  });

  it("_down: devolve o 'antes' SO onde segue igual ao 'depois' (o que a pessoa mudou fica) e neutraliza; reaplicar a ida volta", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await aplicaUrgA(c, "170500");
      const a = await aprovada(c);
      await rodar(c, a.linhas, a.hash, a.n);
      await c.query("UPDATE etiquetas SET tamanho_vinculado = '38|P' WHERE id = $1", [AVERARA_TAM_M]); // a pessoa mudou depois
      await aplicarArquivo(c, b!.down);
      await c.query("SET LOCAL transaction_timeout = 0");
      const v = await vinculos(c);
      for (const s of a.linhas) {
        const id = s.split("|")[1];
        expect(v[id], id).toBe(id === AVERARA_TAM_M ? "38|P" : null);
      }
      expect(await urgAViva(c, "170500")).toBe(false);
      expect(await md5Fn(c, RODAR)).toBe(b!.NEUTRO![RODAR]);
      expect(await md5Fn(c, LISTA)).toBe(b!.NEUTRO![LISTA]);
      await c.query("SELECT set_config('app.confirmo_tamanho_legado', 'sim', true)");
      const e = await falha(c, () => um(c, `SELECT public._urg_r1_tamanho_legado_rodar('[]'::jsonb, 'x', 0)`));
      expect(e).toMatchObject({ code: "P0001" });
      expect(e.message).toMatch(/desativada/);
      // _down de novo: idempotente (nada muda; o que ja voltou nao e "mudado pela pessoa")
      await aplicarArquivo(c, b!.down);
      await c.query("SET LOCAL transaction_timeout = 0");
      expect(await vinculos(c)).toEqual(v);
      // reaplicar a ida (guarda aceita o texto neutro) devolve as funcoes; a tabela de backup e os dados ficam
      await aplicaUrgA(c, "170500");
      expect(await urgAViva(c, "170500")).toBe(true);
      expect((await c.query(`SELECT 1 FROM ${BKP}`)).rowCount).toBe(a.n);
    });
  });

  it("forma: rodar/lista SECURITY DEFINER, search_path=public, sem EXECUTE p/ PUBLIC/anon/authenticated; backup com RLS, sem policy, sem grant", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "170500");
      for (const sig of [RODAR, LISTA]) {
        const r = await um<{ anon: boolean; auth: boolean; pub: boolean; cfg: string; sd: boolean }>(
          c,
          `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                  EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0) AS pub,
                  coalesce(array_to_string(p.proconfig, '|'), '') AS cfg, p.prosecdef AS sd
             FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
          [sig],
        );
        expect(r, sig).toMatchObject({ anon: false, auth: false, pub: false, cfg: "search_path=public", sd: true });
      }
      const t = await um<{ rls: boolean; pol: string; priv: boolean }>(
        c,
        `SELECT c.relrowsecurity AS rls,
                (SELECT count(*)::text FROM pg_policy WHERE polrelid = c.oid) AS pol,
                (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT')
                 OR has_table_privilege('authenticated', c.oid, 'INSERT') OR has_table_privilege('authenticated', c.oid, 'UPDATE')
                 OR has_table_privilege('authenticated', c.oid, 'DELETE')) AS priv
           FROM pg_class c WHERE c.oid = $1::regclass`,
        [BKP],
      );
      expect(t).toEqual({ rls: true, pol: "0", priv: false });
    });
  });

  it("re-aplicar a ida 2x na txn nao falha; travas (por DIFERENCA): nada fora da tabela de backup alem de AccessShare, nada em auth/storage", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await aplicaUrgA(c, "170000");
      const LOCKS = `SELECT DISTINCT n.nspname || '.' || cl.relname AS rel, l.mode
                       FROM pg_locks l JOIN pg_class cl ON cl.oid = l.relation JOIN pg_namespace n ON n.oid = cl.relnamespace
                      WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname NOT IN ('pg_catalog', 'pg_toast')`;
      const antes = new Set((await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`));
      await aplicarArquivo(c, b!.mig);
      await aplicarArquivo(c, b!.mig);
      await c.query("SET LOCAL transaction_timeout = 0");
      const novas = (await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`).filter((k) => !antes.has(k));
      expect(novas.filter((k) => /^(auth|storage|realtime)\./.test(k))).toEqual([]);
      expect(
        novas.filter(
          (k) => !k.startsWith(`${BKP}|`) && !k.startsWith("public._bkp_urg_r1_tamanho_legado_") && !k.startsWith("information_schema.") && !k.endsWith("|AccessShareLock"),
        ),
      ).toEqual([]);
      expect(await urgAViva(c, "170500")).toBe(true);
    });
  });

  it("_down sem nada a devolver nao toca etiquetas (sem RowExclusive): a cadeia LIFO dos testes antigos o chama a toda hora", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await aplicaUrgA(c, "170500");
      const LOCKS = `SELECT DISTINCT n.nspname || '.' || cl.relname AS rel, l.mode
                       FROM pg_locks l JOIN pg_class cl ON cl.oid = l.relation JOIN pg_namespace n ON n.oid = cl.relnamespace
                      WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname NOT IN ('pg_catalog', 'pg_toast')`;
      const antes = new Set((await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`));
      await aplicarArquivo(c, b!.down);
      await c.query("SET LOCAL transaction_timeout = 0");
      const novas = (await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`).filter((k) => !antes.has(k));
      expect(novas.filter((k) => !k.endsWith("|AccessShareLock"))).toEqual([]);
    });
  });

  it("_down_drop: recusa com a funcao viva; recusa apagar backup com linhas sem a GUC; com a GUC apaga funcoes e tabela", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await aplicaUrgA(c, "170500");
      let e = await falha(c, () => aplicarArquivo(c, b!.drop));
      expect(e.message).toMatch(/urg_r1_170500_down_drop/);
      const a = await aprovada(c);
      await rodar(c, a.linhas, a.hash, a.n);
      await aplicarArquivo(c, b!.down);
      await c.query("SET LOCAL transaction_timeout = 0");
      e = await falha(c, () => aplicarArquivo(c, b!.drop));
      expect(e.message).toMatch(/urg_r1_170500_down_drop/);
      await c.query("SELECT set_config('app.confirmo_apagar_backup_tamanho_legado', 'sim', true)");
      await aplicarArquivo(c, b!.drop);
      await c.query("SET LOCAL transaction_timeout = 0");
      expect(await md5Fn(c, RODAR)).toBeNull();
      expect(await md5Fn(c, LISTA)).toBeNull();
      expect((await um<{ t: string | null }>(c, "SELECT to_regclass($1)::text AS t", [BKP])).t).toBeNull();
    });
  });
});
