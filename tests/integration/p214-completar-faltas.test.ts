import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";
import { aplicarArquivo } from "./mig-txn";

// Achados MEDIOS R15a, P-214 B (dono 01/out) — migration 20261025310000_completar_faltas_existentes.
// Correção única: completa de uma vez os "Faltou estoque" (cad.deficit_corte) que JÁ existem, com a lista aprovada pelo
// dono (hash + esperado por loja da prévia exata _p214_previa). Tudo em BEGIN…ROLLBACK; o _down roda pelo harness
// mig-txn (só na cópia local — nunca \i). Fixture ausente = falha alta.

const HASH_VAZIO = "d41d8cd98f00b204e9800998ecf8427e";

async function fixture(c: Client) {
  await comoUsuario(c);
  await c.query(`update tenant_config set modo_baixa_estoque='automatico' where tenant_id=$1`, [TENANT_TESTE]);
  const art = (await um<{ id: string }>(c,
    `insert into artigos (tenant_id,nome,unidade_medida) values ($1,'ITEST-P214','metro') returning id`, [TENANT_TESTE])).id;
  const vari = (await um<{ id: string }>(c,
    `insert into variantes_tecido (tenant_id,artigo_id,nome_variante) values ($1,$2,'ITEST-P214') returning id`, [TENANT_TESTE, art])).id;
  const cads: string[] = [];
  for (const [m, data] of [[100, "2026-01-10"], [60, "2026-02-10"]] as const) {
    const mod = (await um<{ id: string }>(c, `insert into modelos (tenant_id,nome) values ($1,'ITEST-P214') returning id`, [TENANT_TESTE])).id;
    const cad = (await um<{ id: string }>(c,
      `insert into cad (tenant_id,modelo_id,data_enviado_corte) values ($1,$2,$3::date) returning id`, [TENANT_TESTE, mod, data])).id;
    const ct = (await um<{ id: string }>(c,
      `insert into cad_tecidos (cad_id,artigo_id,numero,tipo) values ($1,$2,1,'tecido') returning id`, [cad, art])).id;
    await c.query(`insert into cad_tecido_variantes (cad_tecido_id,variante_tecido_id,ordem,metragem_enviada) values ($1,$2,1,$3)`, [ct, vari, m]);
    await um(c, `select public._baixar_estoque_tecido_corte_core($1) r`, [cad]); // sem estoque -> déficit
    cads.push(cad);
  }
  // tecido chega (o gatilho P-203 é ADIADO e esta txn nunca chega ao COMMIT: os déficits continuam "parados")
  const oc = (await um<{ id: string }>(c,
    `insert into ocs_tecido (tenant_id,status,numero_pedido,data_pedido,data_entrega) values ($1,'recebido','ITEST-P214',current_date,current_date) returning id`,
    [TENANT_TESTE])).id;
  await c.query(`insert into ocs_tecido_itens (oc_tecido_id,artigo_id,variante_tecido_id,quantidade_pedida,quantidade_recebida) values ($1,$2,$3,130,130)`,
    [oc, art, vari]);
  return { art, vari, cadA: cads[0], cadB: cads[1] };
}

const deficit = async (c: Client, cad: string) => (await um<{ d: any }>(c, `select deficit_corte d from cad where id=$1`, [cad])).d;
const baixas = async (c: Client, cad: string) =>
  Number((await um<{ t: string }>(c, `select coalesce(sum(quantidade),0) t from estoque_tecido_baixas where cad_id=$1`, [cad])).t);

async function rodar(c: Client, esperado: any, hash: string) {
  await c.query(`select set_config('app.confirmo_completar_faltas','sim',true)`);
  // erro aborta a (sub)transação: quem chama faz ROLLBACK TO SAVEPOINT (que também desfaz o set_config)
  const r = (await um<{ r: any }>(c, `select public._p214_completar_faltas($1::jsonb,$2) r`, [JSON.stringify(esperado), hash])).r;
  await c.query(`select set_config('app.confirmo_completar_faltas','',true)`);
  return r;
}

describe.skipIf(!hasDb || !ehBancoLocal())("P-214 B — correção única dos 'Faltou estoque' existentes (cópia local)", () => {
  it("prévia exata → hash bate → completa os 2; 2ª vez = nada; Auditoria = Sistema (P-214); _down devolve exatamente", async () => {
    await withTx(async (c) => {
      const f = await fixture(c);
      expect(Number((await deficit(c, f.cadA))[0].deficit)).toBe(100);
      expect(Number((await deficit(c, f.cadB))[0].deficit)).toBe(60);
      const antesA = await deficit(c, f.cadA);
      const antesB = await deficit(c, f.cadB);

      const p = (await um<{ p: any }>(c, `select public._p214_previa() p`)).p;
      const minhas = (p.linhas as string[]).filter((l) => l.startsWith(f.cadA) || l.startsWith(f.cadB));
      expect(minhas.sort()).toEqual([`${f.cadA}|${f.vari}|100.0000`, `${f.cadB}|${f.vari}|30.0000`].sort());
      expect(p.hash).not.toBe(HASH_VAZIO);
      // a prévia não grava nada
      expect(await baixas(c, f.cadA)).toBe(0);
      expect(Number((await deficit(c, f.cadA))[0].deficit)).toBe(100);

      // sem a confirmação: recusa
      await c.query("SAVEPOINT s1");
      await expect(c.query(`select public._p214_completar_faltas($1::jsonb,$2)`, [JSON.stringify(p.esperado), p.hash]))
        .rejects.toThrow(/p214_sem_confirmacao/);
      await c.query("ROLLBACK TO SAVEPOINT s1");

      const r = await rodar(c, p.esperado, p.hash);
      expect(r.cads).toBe(p.linhas.length);
      expect(await deficit(c, f.cadA)).toBeNull();                       // o mais antigo completa
      expect(Number((await deficit(c, f.cadB))[0].deficit)).toBe(30);    // o outro em parte
      expect(await baixas(c, f.cadA)).toBe(100);
      expect(await baixas(c, f.cadB)).toBe(30);
      const bkp = (await c.query(`select cad_id, baixa_ids, hash from _bkp_p214_deficit where lote=$1`, [r.lote])).rows;
      expect(bkp.map((x: any) => x.cad_id).sort()).toEqual([f.cadA, f.cadB].sort());

      // Auditoria: as linhas das baixas criadas e dos cad tocados = 'Sistema' (P-214), + resumo por loja
      const aud = (await c.query(
        `select tabela, user_nome, descricao from audit_log
          where created_at = now() and ((tabela='cad' and registro_id = any($1::uuid[]))
             or (tabela='estoque_tecido_baixas' and registro_id = any($2::uuid[])))`,
        [[f.cadA, f.cadB], bkp.flatMap((x: any) => x.baixa_ids)])).rows;
      expect(aud.length).toBeGreaterThan(0);
      expect(aud.every((a: any) => a.user_nome === "Sistema" && String(a.descricao).startsWith("Sistema: correcao do sistema (P-214)"))).toBe(true);
      const resumo = await um<{ n: string }>(c,
        `select count(*) n from audit_log where created_at = now() and tenant_id=$1 and user_nome='Sistema'
            and dados ? 'p214' and descricao like 'Sistema: correcao do sistema (P-214) - faltas do corte completadas%'`, [TENANT_TESTE]);
      expect(Number(resumo.n)).toBe(1);

      // 2ª vez com a mesma lista aprovada = nada (idempotente)
      const r2 = await rodar(c, p.esperado, p.hash);
      expect(r2).toMatchObject({ ja_aplicado: true, cads: 0 });
      expect(await baixas(c, f.cadA)).toBe(100);

      // _down: apaga SÓ as baixas do lote e devolve o deficit_corte de antes, exatamente
      await aplicarArquivo(c, "supabase/rollback/20261025310000_completar_faltas_existentes_down.sql");
      expect(await deficit(c, f.cadA)).toEqual(antesA);
      expect(await deficit(c, f.cadB)).toEqual(antesB);
      expect(await baixas(c, f.cadA)).toBe(0);
      expect(await baixas(c, f.cadB)).toBe(0);
      expect(Number((await um<{ n: string }>(c, `select count(*) n from _bkp_p214_deficit where lote=$1 and revertido_at is null`, [r.lote])).n)).toBe(0);
      // _down de novo = nada a desfazer
      await aplicarArquivo(c, "supabase/rollback/20261025310000_completar_faltas_existentes_down.sql");
      expect(await deficit(c, f.cadA)).toEqual(antesA);
    });
  });

  it("hash ou contagens diferentes da lista de agora → aborta e nada fica", async () => {
    await withTx(async (c) => {
      const f = await fixture(c);
      const p = (await um<{ p: any }>(c, `select public._p214_previa() p`)).p;
      await c.query("SAVEPOINT s2");
      await expect(rodar(c, p.esperado, HASH_VAZIO)).rejects.toThrow(/p214_lista_mudou/);
      await c.query("ROLLBACK TO SAVEPOINT s2");
      const errado = JSON.parse(JSON.stringify(p.esperado));
      errado[TENANT_TESTE].cads = Number(errado[TENANT_TESTE].cads) + 1;
      await c.query("SAVEPOINT s3");
      await expect(rodar(c, errado, p.hash)).rejects.toThrow(/p214_lista_mudou/);
      await c.query("ROLLBACK TO SAVEPOINT s3");
      expect(await baixas(c, f.cadA)).toBe(0);
      expect(Number((await deficit(c, f.cadA))[0].deficit)).toBe(100);
    });
  });

  it("ACL (inv. #9): as 3 funções sem EXECUTE para PUBLIC/anon/authenticated/service_role; backup ilegível", async () => {
    await withTx(async (c) => {
      const r = await um<any>(c, `select
        has_function_privilege('authenticated','public._p214_completar_faltas(jsonb,text)','EXECUTE') a,
        has_function_privilege('anon','public._p214_previa()','EXECUTE') b,
        has_function_privilege('service_role','public._p214_executar()','EXECUTE') d,
        has_table_privilege('authenticated','public._bkp_p214_deficit','SELECT') e`);
      expect(r).toEqual({ a: false, b: false, d: false, e: false });
    });
  });
});
