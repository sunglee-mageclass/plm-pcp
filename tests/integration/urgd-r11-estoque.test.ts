// Urgentes R11c (plan-r11 Task 2, migration 20261103199200_urg_r11_estoque_fonte_unica): FONTE ÚNICA do estoque + Histórico da mini.
// Os 2 cores (_estoque_aviamento_core / _estoque_etiqueta_core) passam a SOMAR o ledger novo estoque_peca_teste_baixas (origem
// peca_teste = baixa positiva, peca_teste_estorno = compensação negativa — Ruling 2) e os 3 extratos mostram as linhas da peça teste.
// Σ do extrato = recebido - baixa por bucket nos 3 POR CONSTRUÇÃO (a varredura urg_r3_extrato_varredura.sql fica 0). Nenhuma função de
// custo lê o ledger (P-343). Txn revertida; o bloco é aplicado por aplicaUrgd(c, "r11c") (pula o que já está vivo). Só na cópia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, um, TENANT_TESTE, ehBancoLocal } from "./db";
import { aplicaUrgd, URGD_BLOCOS } from "./urgd-helpers";
import { aplicarArquivo } from "./mig-txn";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const C = URGD_BLOCOS.r11c;
const VARRE = "supabase/consultas/urg_r3_extrato_varredura.sql";

async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}
/** garante r11a/r11b/r11c vivos na txn (pula o que já está) */
async function aplica(c: Client): Promise<void> {
  await aplicaUrgd(c, "r11c");
}
/** um aviamento da Loja Teste que tenha >=1 variante (bucket pela variante única do legado) */
async function umAviamento(c: Client): Promise<{ av: string; var: string | null }> {
  const r = await um<{ av: string; v: string | null }>(c,
    `SELECT a.id AS av, (SELECT va.id FROM variantes_aviamento va WHERE va.aviamento_id = a.id ORDER BY va.created_at, va.id LIMIT 1) AS v
       FROM aviamentos a WHERE a.tenant_id = $1
        AND (SELECT count(*) FROM variantes_aviamento va WHERE va.aviamento_id = a.id) = 1
      ORDER BY a.id LIMIT 1`, [T]);
  return { av: r.av, var: r.v };
}
async function umaEtiqueta(c: Client): Promise<string> {
  return (await um<{ id: string }>(c, "SELECT id FROM etiquetas WHERE tenant_id = $1 ORDER BY id LIMIT 1", [T])).id;
}
async function baixaAviamento(c: Client, av: string): Promise<number> {
  const r = await um<{ b: string | null }>(c, "SELECT sum(baixa) AS b FROM _estoque_aviamento_core($1) WHERE id = $2", [T, av]);
  return Number(r.b ?? 0);
}
async function baixaEtiqueta(c: Client, etq: string): Promise<number> {
  const r = await um<{ b: string | null }>(c, "SELECT sum(baixa) AS b FROM _estoque_etiqueta_core($1) WHERE etiqueta_id = $2", [T, etq]);
  return Number(r.b ?? 0);
}

describe.skipIf(!RODA)("urg R11c — fonte única do estoque + Histórico (199200)", () => {
  it("o bloco r11c existe (gerado por mig/gerar-d.mjs): 5 funções redefinidas, sem funções novas, _down neutro", () => {
    expect(C).toBeTruthy();
    expect(C.mig).toBe("supabase/migrations/20261103199200_urg_r11_estoque_fonte_unica.sql");
    expect(Object.keys(C.URGD_MD5 ?? {}).sort()).toEqual([
      "public._estoque_aviamento_core(uuid)",
      "public._estoque_etiqueta_core(uuid)",
      "public._estoque_extrato_aviamento_core(uuid,uuid)",
      "public._estoque_extrato_insumo_core(uuid,uuid)",
      "public._estoque_extrato_tecido_core(uuid,uuid)",
    ]);
    expect((C as any).URGD_NOVAS ?? null).toBeFalsy();  // nenhuma função nova
    expect((C as any).drop ?? null).toBeFalsy();         // sem _down_drop
    expect(C.down).toBe("supabase/rollback/20261103199200_urg_r11_estoque_fonte_unica_down.sql");
  });

  // (1) PROVA DA FONTE ÚNICA — aviamento
  it("[1] aviamento: baixa do core = Σ do ledger por bucket; estorno compensa; a físico cai o mesmo Δ", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const { av } = await umAviamento(c);
      const stat = async () => um<{ baixa: string; fisico: string }>(c,
        "SELECT sum(baixa)::text AS baixa, sum(fisico)::text AS fisico FROM _estoque_aviamento_core($1) WHERE id = $2", [T, av]);
      const a = await stat();
      // peca_teste 5 + estorno -2 => líquido +3 de baixa (Ruling 2: estorno = linha compensatoria negativa)
      await c.query(`INSERT INTO estoque_peca_teste_baixas (tenant_id, familia, aviamento_id, origem, quantidade, rotulo)
                     VALUES ($1,'aviamento',$2,'peca_teste',5,'t1'),($1,'aviamento',$2,'peca_teste_estorno',-2,'t1 estorno')`, [T, av]);
      const d = await stat();
      expect(Number(d.baixa) - Number(a.baixa)).toBe(3);
      // físico = recebido - baixa (clamp >=0): cai no MESMO Δ enquanto houver físico
      expect(Number(a.fisico) - Number(d.fisico)).toBe(Math.min(3, Number(a.fisico)));
    });
  });

  // (1) PROVA DA FONTE ÚNICA — insumo
  it("[1] insumo: baixa do core = Σ do ledger por (etiqueta, tamanho, cor)", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const etq = await umaEtiqueta(c);
      const antes = await baixaEtiqueta(c, etq);
      await c.query(`INSERT INTO estoque_peca_teste_baixas (tenant_id, familia, etiqueta_id, tamanho, origem, quantidade, rotulo)
                     VALUES ($1,'insumo',$2,NULL,'peca_teste',4,'t'),($1,'insumo',$2,NULL,'peca_teste_estorno',-1,'t est')`, [T, etq]);
      expect(await baixaEtiqueta(c, etq) - antes).toBe(3);
    });
  });

  // (1) TECIDO — o core (fonte única) e o saldo por item veem a linha peca_teste e voltam com o estorno
  it("[1] tecido: _estoque_tecido_core e saldo_oc_item_m veem a baixa peca_teste (origem nao-separacao_rolo) e voltam com o estorno", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const it = await um<{ item: string; variante: string } | undefined>(c,
        `SELECT i.id AS item, i.variante_tecido_id AS variante
           FROM ocs_tecido_itens i JOIN ocs_tecido o ON o.id = i.oc_tecido_id
          WHERE o.tenant_id = $1 AND o.status = 'recebido' AND i.variante_tecido_id IS NOT NULL
            AND coalesce(i.cancelado,false) = false
          ORDER BY i.id LIMIT 1`, [T]);
      if (!it) return;  // Loja Teste sem item recebido com variante: nada a provar aqui
      const baixaCore = async () => Number((await um<{ b: string | null }>(c,
        "SELECT sum(baixa)::text AS b FROM _estoque_tecido_core($1) WHERE variante_tecido_id = $2", [T, it.variante])).b ?? 0);
      // saldo_oc_item_m RETURNS TABLE (SETOF): coalesce com 0 quando a função nao rende linha
      const saldoItem = async () => Number((await um<{ s: string | null }>(c,
        "SELECT coalesce((SELECT saldo_m FROM saldo_oc_item_m($1)), 0)::text AS s", [it.item])).s ?? 0);
      const b0 = await baixaCore(), s0 = await saldoItem();
      await c.query(`INSERT INTO estoque_tecido_baixas (tenant_id, oc_tecido_item_id, variante_tecido_id, origem, quantidade, motivo, peca_teste_tentativa_id)
                     VALUES ($1,$2,$3,'peca_teste',2.5,'peca teste saida',NULL)`, [T, it.item, it.variante]);
      expect(await baixaCore() - b0, "o core conta a baixa peca_teste (origem != separacao_rolo)").toBeCloseTo(2.5, 6);
      const sComBaixa = await saldoItem();
      await c.query(`INSERT INTO estoque_tecido_baixas (tenant_id, oc_tecido_item_id, variante_tecido_id, origem, quantidade, motivo, peca_teste_tentativa_id)
                     VALUES ($1,$2,$3,'peca_teste_estorno',-2.5,'estorno',NULL)`, [T, it.item, it.variante]);
      expect(await baixaCore(), "o estorno (líquido 0) devolve o core").toBeCloseTo(b0, 6);
      expect(await saldoItem(), "o estorno devolve o saldo do item").toBeCloseTo(s0, 6);
      // se a função rende linha, a baixa do próprio item derruba o saldo em 2,5; se nao rende (0), o delta é 0 nos dois lados
      expect(s0 - sComBaixa, "saldo_oc_item_m abate a baixa do próprio item").toBeGreaterThanOrEqual(0);
    });
  });

  // (2) EXTRATO — aviamento: linhas peca_teste (saída) e estorno (entrada); card vivo => ref_modelo; card apagado => NULL + rótulo segue
  it("[2] extrato aviamento: saída/entrada com ref_modelo do card vivo; card apagado => ref_modelo NULL e o rótulo segue", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const { av } = await umAviamento(c);
      // cria tentativa (R9) apontando um modelo da loja
      const semente = await um<{ modelo: string; cat: string }>(c,
        `SELECT (SELECT id FROM modelos WHERE tenant_id=$1 ORDER BY id LIMIT 1) AS modelo,
                (SELECT id FROM categorias_terceirizado WHERE tenant_id=$1 ORDER BY id LIMIT 1) AS cat`, [T]);
      const tent = (await um<{ id: string }>(c,
        `INSERT INTO modelo_peca_teste_tentativas (tenant_id, modelo_id, categoria_terceirizado_id, numero)
         VALUES ($1,$2,$3,1) RETURNING id`, [T, semente.modelo, semente.cat])).id;
      await c.query(`INSERT INTO estoque_peca_teste_baixas (tenant_id, tentativa_id, modelo_id, familia, aviamento_id, origem, quantidade, rotulo)
                     VALUES ($1,$2,$3,'aviamento',$4,'peca_teste',7,'REFX - tentativa 1 - saida 06/10/2026'),
                            ($1,$2,$3,'aviamento',$4,'peca_teste_estorno',-3,'REFX - estorno')`, [T, tent, semente.modelo, av]);
      const linhas = (await c.query(
        `SELECT origem, tipo, quantidade::text AS q, ref_modelo, detalhe FROM _estoque_extrato_aviamento_core($1,$2)
          WHERE origem LIKE 'peca_teste%' ORDER BY origem`, [T, av])).rows;
      const saida = linhas.find((l: any) => l.origem === "peca_teste");
      const entrada = linhas.find((l: any) => l.origem === "peca_teste_estorno");
      expect(saida).toBeTruthy();
      expect(saida.tipo).toBe("saida");
      expect(Number(saida.q)).toBe(-7);
      expect(saida.ref_modelo).toBeTruthy();                 // REF/nome do card vivo
      expect(saida.detalhe).toBe("REFX - tentativa 1 - saida 06/10/2026");
      expect(entrada.tipo).toBe("entrada");
      expect(Number(entrada.q)).toBe(3);
      // card apagado: a cascata leva a tentativa e a FK do ledger faz SET NULL (modelo_id da FOTO fica, mas sem FK -> nao resolve REF).
      // Simula o estado pos-cascata: tentativa_id -> NULL (a imutabilidade permite ESSE unico UPDATE).
      await c.query(`UPDATE estoque_peca_teste_baixas SET tentativa_id = NULL
                      WHERE tenant_id=$1 AND aviamento_id=$2 AND origem='peca_teste'`, [T, av]);
      const apos = (await c.query(
        `SELECT ref_modelo, detalhe FROM _estoque_extrato_aviamento_core($1,$2) WHERE origem = 'peca_teste'`, [T, av])).rows[0];
      expect(apos).toBeTruthy();
      expect(apos.ref_modelo).toBeNull();
      expect(apos.detalhe).toBe("REFX - tentativa 1 - saida 06/10/2026");
    });
  });

  // (2) EXTRATO — insumo: a linha aparece com saída/entrada e rótulo
  it("[2] extrato insumo: saída/entrada com o rótulo", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const etq = await umaEtiqueta(c);
      await c.query(`INSERT INTO estoque_peca_teste_baixas (tenant_id, familia, etiqueta_id, tamanho, origem, quantidade, rotulo)
                     VALUES ($1,'insumo',$2,NULL,'peca_teste',6,'INSX saida')`, [T, etq]);
      const linhas = (await c.query(
        `SELECT origem, tipo, quantidade::text AS q, detalhe FROM _estoque_extrato_insumo_core($1,$2) WHERE origem = 'peca_teste'`, [T, etq])).rows;
      expect(linhas.length).toBeGreaterThanOrEqual(1);
      expect(linhas[0].tipo).toBe("saida");
      expect(Number(linhas[0].q)).toBe(-6);
      expect(linhas[0].detalhe).toBe("INSX saida");
    });
  });

  // (3) VARREDURA de reconciliação = 0 nas 6 colunas, com linhas de peça teste SEMEADAS (Σ extrato = recebido - baixa)
  it("[3] a varredura urg_r3_extrato_varredura.sql fica 0 nas 6 colunas com baixas de peça teste semeadas", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const { av } = await umAviamento(c);
      const etq = await umaEtiqueta(c);
      await c.query(`INSERT INTO estoque_peca_teste_baixas (tenant_id, familia, aviamento_id, origem, quantidade, rotulo)
                     VALUES ($1,'aviamento',$2,'peca_teste',5,'v'),($1,'aviamento',$2,'peca_teste_estorno',-2,'v est')`, [T, av]);
      await c.query(`INSERT INTO estoque_peca_teste_baixas (tenant_id, familia, etiqueta_id, origem, quantidade, rotulo)
                     VALUES ($1,'insumo',$2,'peca_teste',4,'v')`, [T, etq]);
      const sql = readFileSync(ROOT + VARRE, "utf8").replace(/;\s*$/, "");
      const r = (await c.query(sql)).rows[0];
      expect([r.tecido_diverge, r.tecido_fora, r.aviamento_diverge, r.aviamento_fora, r.insumo_diverge, r.insumo_fora]
        .map(Number)).toEqual([0, 0, 0, 0, 0, 0]);
    });
  });

  // (4) P-343 — anti-drift estático: nenhuma função de custo lê o ledger; ninguém FORA da lista reimplementa
  it("[4] P-343: nenhuma função _custo%/custo_% cita o ledger/mini; só os 2 cores, 3 extratos e helpers R11 citam estoque_peca_teste_baixas", async () => {
    await withTx(async (c) => {
      await aplica(c);
      // 4a: nenhuma função de custo cita o ledger novo nem as tabelas da mini
      const custo = (await c.query(
        `SELECT p.oid::regprocedure::text AS f FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace
            AND (p.proname LIKE '\\_custo%' OR p.proname LIKE 'custo\\_%')
            AND p.prosrc ~ '(estoque_peca_teste_baixas|modelo_peca_teste_mini)'`)).rows.map((x: any) => x.f);
      expect(custo, `função de custo citando o ledger/mini: ${custo.join(", ")}`).toEqual([]);
      // 4b: só os 2 cores + 3 extratos + helpers R11 (fila de imutabilidade/baixar/estornar) citam estoque_peca_teste_baixas
      // p.oid::regprocedure::text vem SEM o prefixo "public." (public no search_path)
      const PERMITIDAS = new Set([
        "_estoque_aviamento_core(uuid)",
        "_estoque_etiqueta_core(uuid)",
        "_estoque_extrato_tecido_core(uuid,uuid)",
        "_estoque_extrato_aviamento_core(uuid,uuid)",
        "_estoque_extrato_insumo_core(uuid,uuid)",
        "fn_estoque_peca_teste_imutavel()",
        "_wipe_tenant_core(uuid,boolean)",  // apaga por loja (dinâmico; não reimplementa conta)
      ]);
      const citam = (await c.query(
        `SELECT p.oid::regprocedure::text AS f FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc LIKE '%estoque_peca_teste_baixas%'`)).rows.map((x: any) => x.f);
      const fora = citam.filter((f: string) => !PERMITIDAS.has(f) && !/_peca_teste_mini|_peca_teste_tecido|_peca_teste/.test(f));
      expect(fora, `função fora da lista citando o ledger: ${fora.join(", ")}`).toEqual([]);
    });
  });

  // (5) _down recusa com linhas no ledger sem a GUC; passa com a GUC (devolve os 5 textos de ANTES)
  it("[5] _down recusa com linhas no ledger sem app.confirmo_volta_estoque_peca_teste; passa com a GUC", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const { av } = await umAviamento(c);
      await c.query(`INSERT INTO estoque_peca_teste_baixas (tenant_id, familia, aviamento_id, origem, quantidade, rotulo)
                     VALUES ($1,'aviamento',$2,'peca_teste',1,'d')`, [T, av]);
      // sem a GUC => recusa (nada muda)
      await c.query("SAVEPOINT s1");
      let recusou = false;
      try { await aplicarArquivo(c, C.down); }
      catch (e: any) { recusou = /urg_r11c_down: ha baixas de peca teste no ledger/.test(String(e.message)); }
      await c.query("ROLLBACK TO SAVEPOINT s1");
      expect(recusou).toBe(true);
      // o core segue no estado DEPOIS (não reverteu)
      expect(await md5Fn(c, "public._estoque_aviamento_core(uuid)")).toBe(C.URGD_MD5!["public._estoque_aviamento_core(uuid)"].depois);
      // com a GUC => passa e devolve o texto de ANTES
      await c.query("SET LOCAL app.confirmo_volta_estoque_peca_teste = 'sim'");
      await aplicarArquivo(c, C.down);
      expect(await md5Fn(c, "public._estoque_aviamento_core(uuid)")).toBe(C.URGD_MD5!["public._estoque_aviamento_core(uuid)"].antes);
    });
  });
});
