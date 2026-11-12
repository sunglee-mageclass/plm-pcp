/**
 * Kanban PL - Onda 3, fix round 1 da Task 9 (migration 20261128110000_etapas_pl_mover_manual).
 *
 * `etapas_pl_mover` passa a GRAVAR tambem com a chave do modo automatico DESLIGADA (modo manual: a pessoa decide), como DEFINER - assim
 * quem edita so PCP > Etapas (sem Planejamento/Desenvolvimento) move o card sem bater no gatilho de pagina de `modelos` (S3d, 42501).
 * Tudo em BEGIN...ROLLBACK (`withTx`) e SO na copia local (`ehBancoLocal`); a migration e aplicada no banco ANTES da suite (psql -f).
 * NUNCA `\i` migration em txn de teste. Round-trip do `_down` conferido a parte (md5 antes/depois, relatorio da task).
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { hasDb, withTx, um, comoUsuario, semJwt, ehBancoLocal, TENANT_TESTE } from "./db";

const T = TENANT_TESTE;
const BOARD = `'["Peça Teste","Separação de Materiais","Oficina"]'::jsonb`;
const UID_ETAPAS = "6c0d0a00-0000-4000-8000-0000000000b9";
const MD5_ANTES = "bb027297975166f7df845a80fd729eb0";
const MD5_DEPOIS = "cb0861a016e2548ac3c20871b7f5076c";

async function modeloQualquer(c: Client): Promise<string> {
  return (await um<{ id: string }>(c, `select id from modelos where tenant_id=$1 order by id limit 1`, [T])).id;
}
async function config(c: Client, ligado: boolean, reqs = "{}"): Promise<void> {
  await c.query(`select set_config('app.etapas_pl_chave','rpc', true)`); // preparo do cenario passa pela trava da chave
  await c.query(
    `update tenant_config set etapas_pl_automatico=$2, etapas_pl_kanban=${BOARD}, etapas_pl_requisitos=$3::jsonb where tenant_id=$1`,
    [T, ligado, reqs],
  );
}
async function poeNoPl(c: Client, id: string, status: string | null): Promise<void> {
  await c.query(`select set_config('app.etapas_pl_sistema','preparo', true)`);
  await c.query(`update modelos set status_etapa_pl=$2 where id=$1`, [id, status]);
  await c.query(`select set_config('app.etapas_pl_sistema','', true)`);
  await c.query(`delete from etapas_pl_recalculo_fila where modelo_id=$1`, [id]);
}
async function status(c: Client, id: string): Promise<string | null> {
  return (await um<{ s: string | null }>(c, `select status_etapa_pl s from modelos where id=$1`, [id])).s;
}
async function erroDe(c: Client, fn: () => Promise<unknown>): Promise<any> {
  await c.query("SAVEPOINT erro_t");
  let erro: any = null;
  try { await fn(); } catch (e) { erro = e; }
  await c.query("ROLLBACK TO SAVEPOINT erro_t");
  return erro;
}
const mover = async (c: Client, id: string, para: string) => (await um<{ r: any }>(c, `select etapas_pl_mover($1,$2) r`, [id, para])).r;

/** Usuario comum da loja que edita SO "PCP > Etapas" (nem Planejamento nem Desenvolvimento) + modulo etapas_pl ligado. */
async function usuarioSoEtapas(c: Client): Promise<void> {
  await semJwt(c, async () => {
    await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [UID_ETAPAS, `${UID_ETAPAS}@teste`]);
    await c.query(
      `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'KPL9', 'user')
       ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id, role = 'user', papel_id = NULL`,
      [UID_ETAPAS, T, `${UID_ETAPAS}@teste`],
    );
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [UID_ETAPAS]);
    await c.query(
      `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, 'producao_etapas', true, true)`,
      [UID_ETAPAS, T],
    );
    await c.query(`UPDATE public.tenant_config SET modules = coalesce(modules,'{}'::jsonb) || '{"etapas_pl": true, "producao": true}'::jsonb WHERE tenant_id = $1`, [T]);
  });
  await comoUsuario(c, UID_ETAPAS);
}

describe.skipIf(!hasDb || !ehBancoLocal())("etapas_pl_mover no modo manual (Task 9 fix 1)", () => {
  it("o problema que motivou: o UPDATE direto de quem so edita PCP > Etapas bate no gatilho de pagina (42501)", async () => {
    await withTx(async (c) => {
      await config(c, false);
      const id = await modeloQualquer(c);
      await poeNoPl(c, id, "peca_teste");
      await usuarioSoEtapas(c);
      await c.query("SET LOCAL ROLE authenticated"); // o gatilho S3d so morde o papel do PostgREST
      const e = await erroDe(c, () => c.query(`update modelos set status_etapa_pl='oficina' where id=$1`, [id]));
      await c.query("RESET ROLE");
      expect(e).not.toBeNull();
      expect(e.code).toBe("42501");
      expect(String(e.message)).toMatch(/^sem_permissao_pagina/);
    });
  });

  it("chave DESLIGADA + usuario so com producao_etapas: GRAVA (sem 42501, sem 'etapas_pl_manual'); historico origem manual", async () => {
    await withTx(async (c) => {
      await config(c, false, `{"oficina":["peca_teste_aprovada"]}`); // sem derivacao nem requisito: a pessoa decide
      const id = await modeloQualquer(c);
      await poeNoPl(c, id, "peca_teste");
      await usuarioSoEtapas(c);
      await c.query("SET LOCAL ROLE authenticated"); // como o PostgREST: a RPC (DEFINER) passa pelo gatilho S3d como dono
      const r = await mover(c, id, "oficina");
      await c.query("RESET ROLE");
      expect(r.acao).toBe("manual");
      expect(r.status).toBe("oficina");
      expect(r.faltando).toEqual([]);
      expect(typeof r.rev).toBe("number");
      expect(await status(c, id)).toBe("oficina");
      const h = await um<{ n: string }>(
        c, `select count(*)::text n from modelo_etapa_pl_historico where modelo_id=$1 and status='oficina' and origem='manual'`, [id],
      );
      expect(Number(h.n)).toBeGreaterThanOrEqual(1);
      // de volta (qualquer coluna do fluxo, qualquer direcao)
      expect((await mover(c, id, "peca_teste")).status).toBe("peca_teste");
    });
  });

  it("chave desligada: normaliza o destino (rotulo/caixa), 'nada' no mesmo status e em vazio; fora do fluxo NAO grava; card fora do PL nao entra", async () => {
    await withTx(async (c) => {
      await config(c, false);
      const id = await modeloQualquer(c);
      await poeNoPl(c, id, "peca_teste");
      await usuarioSoEtapas(c);
      expect((await mover(c, id, "  OFICINA ")).status).toBe("oficina");
      const mesmo = await mover(c, id, "oficina");
      expect(mesmo.acao).toBe("nada");
      expect(mesmo.status).toBe("oficina");
      expect((await mover(c, id, "   ")).acao).toBe("nada");
      expect(await status(c, id)).toBe("oficina");
      const fora = await mover(c, id, "nao_existe");
      expect(fora.acao).toBe("fora_do_fluxo");
      expect(await status(c, id)).toBe("oficina");
      await semJwt(c, () => poeNoPl(c, id, null));
      await comoUsuario(c, UID_ETAPAS);
      const semPl = await mover(c, id, "oficina");
      expect(semPl.acao).toBe("nada");
      expect(await status(c, id)).toBeNull(); // mover nao puxa para o PL um card que nao esta nele
    });
  });

  it("chave desligada: restaura as GUCs app.etapas_pl_sistema/_lote; gate producao_etapas segue (so ver = 42501 sem_permissao)", async () => {
    await withTx(async (c) => {
      await config(c, false);
      const id = await modeloQualquer(c);
      await poeNoPl(c, id, "peca_teste");
      await usuarioSoEtapas(c);
      await c.query(`select set_config('app.etapas_pl_sistema','anterior', true), set_config('app.etapas_pl_lote','lote-anterior', true)`);
      await mover(c, id, "oficina");
      const g = await um<{ sis: string; lote: string }>(
        c, `select coalesce(current_setting('app.etapas_pl_sistema', true),'') sis, coalesce(current_setting('app.etapas_pl_lote', true),'') lote`,
      );
      expect(g).toEqual({ sis: "anterior", lote: "lote-anterior" });

      await semJwt(c, () => c.query(`UPDATE public.user_permissions SET pode_editar = false WHERE user_id = $1`, [UID_ETAPAS]));
      await comoUsuario(c, UID_ETAPAS);
      const e = await erroDe(c, () => mover(c, id, "peca_teste"));
      expect(e.code).toBe("42501");
      expect(String(e.message)).toMatch(/^sem_permissao/);
    });
  });

  it("chave LIGADA nao regrediu: fixar/soltar/nada/bloqueio de coluna fora do fluxo, tambem para quem so edita PCP > Etapas", async () => {
    await withTx(async (c) => {
      await config(c, true, "{}"); // todas manuais
      const id = await modeloQualquer(c);
      await poeNoPl(c, id, "peca_teste");
      await usuarioSoEtapas(c);
      const fixa = await mover(c, id, "oficina");
      expect(fixa.acao).toBe("fixar");
      expect(fixa.status).toBe("oficina");
      const der = await um<{ alvo: string }>(c, `select alvo from _etapas_pl_derivar_lote($1, ARRAY[$2]::uuid[]) limit 1`, [T, id]);
      const solta = await mover(c, id, "peca_teste");
      expect(solta.acao).toBe("soltar");
      expect(solta.status).toBe(der.alvo);
      expect((await mover(c, id, der.alvo)).acao).toBe("nada");
      expect((await mover(c, id, "nao_existe")).acao).toBe("fora_do_fluxo");
    });
  });

  it("migration: md5 antes/depois pinados, ida idempotente com guarda, down devolve a recusa (texto)", async () => {
    const semComentarios = (t: string) => t.replace(/^--.*$/gm, "");
    const mig = readFileSync("supabase/migrations/20261128110000_etapas_pl_mover_manual.sql", "utf8");
    const down = readFileSync("supabase/rollback/20261128110000_etapas_pl_mover_manual_down.sql", "utf8");
    expect(mig).toContain(MD5_ANTES);
    expect(mig).toContain(MD5_DEPOIS);
    expect(semComentarios(mig)).not.toMatch(/\bCREATE\s+TRIGGER\b|\bDROP\b/i);
    expect(mig).toContain("jsonb_build_object('acao', v_acao");
    expect(down).toContain("etapas_pl_manual: ligue o kanban automatico das etapas");
    expect(semComentarios(down)).not.toMatch(/\bCREATE\s+TRIGGER\b|\bDROP\b/i);
    await withTx(async (c) => {
      const r = await um<{ m: string; anon: boolean; auth: boolean; pub: boolean }>(
        c,
        `select md5(pg_get_functiondef('public.etapas_pl_mover(uuid,text)'::regprocedure)) m,
                has_function_privilege('anon','public.etapas_pl_mover(uuid,text)','EXECUTE') anon,
                has_function_privilege('authenticated','public.etapas_pl_mover(uuid,text)','EXECUTE') auth,
                has_function_privilege('public','public.etapas_pl_mover(uuid,text)','EXECUTE') pub`,
      );
      expect(r.m).toBe(MD5_DEPOIS); // a migration esta aplicada na copia (gate psql -f antes da suite)
      expect(r.anon || r.pub).toBe(false);
      expect(r.auth).toBe(true);
    });
  });
});
