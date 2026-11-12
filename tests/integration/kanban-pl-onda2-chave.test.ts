/**
 * Kanban PL configuravel - Onda 2, Task 8 (ULTIMA): CHAVE protegida `etapas_pl_automatico`
 * (fn_etapas_pl_chave_protegida + trg_etapas_pl_chave_protegida), RPC do botao `etapas_pl_definir_automatico`,
 * tabela `etapas_pl_snapshot`, `fn_etapas_pl_config` + `trg_etapas_pl_config` e `etapas_pl_previa_restauracao`/`etapas_pl_restaurar`.
 *
 * SO BANCO; `etapas_pl_automatico` default false (tudo inerte). Tudo em BEGIN...ROLLBACK (`withTx`) e SO na copia local
 * (`ehBancoLocal`): a migration 20261127130000_etapas_pl_chave.sql e aplicada no banco ANTES da suite (gate `psql -f`), e cada
 * teste roda contra o estado vivo numa txn revertida. NUNCA `\i` migration em txn de teste (incidente 15/set); DDL so na copia
 * local (incidente 23/set).
 *
 * A trava deixa passar quem NAO vem por JWT de usuario (migration/psql/service_role) e a GUC app.etapas_pl_chave='rpc'; quem vem
 * com JWT (PostgREST/salvar_config_loja/aba velha) tem a mudanca da chave IGNORADA, sem erro. Preparo de cenario = SEM claims
 * (`semJwt`) e depois `comoUsuario`/`comoAdmin`.
 *
 * Board dos testes: ["Peça Teste","Separação de Materiais","Oficina"] com {"oficina":["peca_teste_aprovada"]}: a Oficina e
 * AUTOMATICA e as demais MANUAIS: um card na entrada (peca_teste) com a trilha satisfeita AVANCA para a Oficina; um card numa
 * coluna manual (separacao_de_materiais) fica FIXADO onde esta.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, um, comoUsuario, semJwt, ehBancoLocal, TENANT_TESTE } from "./db";

const T = TENANT_TESTE;
const BOARD = `'["Peça Teste","Separação de Materiais","Oficina"]'::jsonb`;
const REQS = `'{"oficina":["peca_teste_aprovada"]}'::jsonb`;
const U_COMUM = "6c0d0a00-0000-4000-8000-0000000000b1";
const U_ADMIN = "6c0d0a00-0000-4000-8000-0000000000b2";
const CHAMA_SALVAR = "SELECT public.salvar_config_loja($1::uuid, $2::jsonb, $3::jsonb, $4::boolean) AS r";

/** Config da loja SEM claims (passa pela trava): board + reqs + chave. */
async function config(c: Client, opts: { board?: string; reqs?: string; ligado?: boolean; modulo?: boolean } = {}): Promise<void> {
  const { board = BOARD, reqs = REQS, ligado = false, modulo = true } = opts;
  await semJwt(c, async () => {
    await c.query(
      `update tenant_config
          set modules = coalesce(modules, '{}'::jsonb) || jsonb_build_object('etapas_pl', $3::boolean),
              etapas_pl_kanban = ${board}, etapas_pl_requisitos = ${reqs}, etapas_pl_automatico = $2
        where tenant_id = $1`,
      [T, ligado, modulo],
    );
  });
}

async function chave(c: Client): Promise<boolean> {
  return (await um<{ v: boolean }>(c, `select etapas_pl_automatico v from tenant_config where tenant_id=$1`, [T])).v;
}

async function modelos(c: Client, n: number): Promise<string[]> {
  const r = await c.query(`select id from modelos where tenant_id=$1 order by id limit ${n}`, [T]);
  return r.rows.map((x) => x.id as string);
}

/** Poe o card no PL como escrita "de sistema" (nao passa pelo guard/historico de origem manual) e limpa a fila. */
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
  try {
    await fn();
  } catch (e) {
    erro = e;
  }
  await c.query("ROLLBACK TO SAVEPOINT erro_t");
  return erro;
}

/** Cria usuario da loja (SEM claims) e entra como ele. */
async function comoUsuarioLoja(c: Client, uid: string, tenantAdmin: boolean): Promise<void> {
  await semJwt(c, async () => {
    await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
    await c.query(
      `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'KPL8', 'user')
       ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
      [uid, T, `${uid}@teste`],
    );
    if (tenantAdmin) await c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin') ON CONFLICT DO NOTHING`, [uid]);
  });
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
}

const definir = (c: Client, ligar: boolean | null) => c.query(`select etapas_pl_definir_automatico($1) r`, [ligar]);

describe.skipIf(!hasDb || !ehBancoLocal())("Kanban PL Onda 2 - chave + snapshot/restaurar (Task 8)", () => {
  // (1) a chave so muda pela RPC ---------------------------------------------------------------------------------------
  it("com JWT: UPDATE direto em tenant_config NAO muda a chave (sem erro) e as outras colunas gravam", async () => {
    await withTx(async (c) => {
      await config(c);
      await comoUsuario(c); // super admin (passa MOD-1) - a trava PL vale para TODOS com JWT
      await c.query(
        `update tenant_config set etapas_pl_automatico = true, etapas_pl_kanban = '["A","B"]'::jsonb where tenant_id=$1`,
        [T],
      );
      expect(await chave(c)).toBe(false);
      const k = (await um<{ k: any }>(c, `select etapas_pl_kanban k from tenant_config where tenant_id=$1`, [T])).k;
      expect(k).toEqual(["A", "B"]); // o resto da linha gravou
    });
  });

  it("com JWT: gravar etapas_pl_automatico via salvar_config_loja NAO muda a chave (so a RPC liga/desliga)", async () => {
    await withTx(async (c) => {
      await config(c);
      await comoUsuarioLoja(c, U_ADMIN, true);
      const antes = (await um<{ j: Record<string, any> }>(c, "SELECT to_jsonb(tc) AS j FROM public.tenant_config tc WHERE tc.tenant_id=$1", [T])).j;
      const mud = { etapas_pl_automatico: true, etapas_pl_kanban: ["Peça Teste", "Oficina"] };
      const base = { etapas_pl_automatico: antes.etapas_pl_automatico, etapas_pl_kanban: antes.etapas_pl_kanban };
      const r = await c.query(CHAMA_SALVAR, [T, JSON.stringify(mud), JSON.stringify(base), null]);
      expect(r.rowCount).toBe(1);
      expect(await chave(c)).toBe(false);
      const k = (await um<{ k: any }>(c, `select etapas_pl_kanban k from tenant_config where tenant_id=$1`, [T])).k;
      expect(k).toEqual(["Peça Teste", "Oficina"]); // o board gravou; so a chave foi ignorada
    });
  });

  it("com JWT: desligar por UPDATE direto tambem e ignorado (chave ligada continua ligada)", async () => {
    await withTx(async (c) => {
      await config(c, { ligado: true });
      await comoUsuario(c);
      await c.query(`update tenant_config set etapas_pl_automatico = false where tenant_id=$1`, [T]);
      expect(await chave(c)).toBe(true);
    });
  });

  it("GUC app.etapas_pl_chave='rpc' passa; sem JWT (migration/psql) e service_role passam", async () => {
    await withTx(async (c) => {
      await config(c);
      await comoUsuario(c);
      await c.query(`select set_config('app.etapas_pl_chave','rpc', true)`);
      await c.query(`update tenant_config set etapas_pl_automatico = true where tenant_id=$1`, [T]);
      expect(await chave(c)).toBe(true);
      await c.query(`select set_config('app.etapas_pl_chave','', true)`);

      // sem JWT (psql/migration)
      await semJwt(c, () => c.query(`update tenant_config set etapas_pl_automatico = false where tenant_id=$1`, [T]));
      expect(await chave(c)).toBe(false);

      // service_role
      await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
      await c.query(`update tenant_config set etapas_pl_automatico = true where tenant_id=$1`, [T]);
      expect(await chave(c)).toBe(true);
    });
  });

  it("GUC com valor diferente de 'rpc' NAO libera a chave (JWT)", async () => {
    await withTx(async (c) => {
      await config(c);
      await comoUsuario(c);
      await c.query(`select set_config('app.etapas_pl_chave','x', true)`);
      await c.query(`update tenant_config set etapas_pl_automatico = true where tenant_id=$1`, [T]);
      expect(await chave(c)).toBe(false);
    });
  });

  it("INSERT de tenant_config com JWT nasce com a chave desligada", async () => {
    await withTx(async (c) => {
      const NOVO = "aaaaaaaa-0000-4000-8000-0000000000c8";
      await semJwt(c, async () => {
        await c.query(`insert into tenants (id, nome) values ($1, 'kpl8 tenant')`, [NOVO]);
        await c.query(`delete from tenant_config where tenant_id=$1`, [NOVO]);
      });
      await comoUsuario(c);
      await c.query(`insert into tenant_config (tenant_id, etapas_pl_automatico) values ($1, true)`, [NOVO]);
      const v = (await um<{ v: boolean }>(c, `select etapas_pl_automatico v from tenant_config where tenant_id=$1`, [NOVO])).v;
      expect(v).toBe(false);
    });
  });

  // (5) nao-colisao com as outras 2 travas ----------------------------------------------------------------------------
  it("nao colide: a trava PL so olha etapas_pl_automatico (kanban_automatico/modules seguem as travas deles)", async () => {
    await withTx(async (c) => {
      await config(c);
      await semJwt(c, () => c.query(`update tenant_config set kanban_automatico = false where tenant_id=$1`, [T]));
      await comoUsuario(c); // super admin: MOD-1 deixa gravar `modules`
      // (a) kanban_automatico com a GUC DO KANBAN passa pela trava do kanban; a PL nao desfaz nada
      await c.query(`select set_config('app.kanban_chave','rpc', true)`);
      await c.query(`update tenant_config set kanban_automatico = true where tenant_id=$1`, [T]);
      expect((await um<{ v: boolean }>(c, `select kanban_automatico v from tenant_config where tenant_id=$1`, [T])).v).toBe(true);
      // ...e a GUC do kanban NAO libera a chave PL
      await c.query(`update tenant_config set etapas_pl_automatico = true where tenant_id=$1`, [T]);
      expect(await chave(c)).toBe(false);
      await c.query(`select set_config('app.kanban_chave','', true)`);
      // (b) sem GUC nenhuma, um UPDATE que muda SO kanban_automatico: quem reverte e a trava do KANBAN (nome proprio); a PL nao tem culpa
      await c.query(`update tenant_config set kanban_automatico = false where tenant_id=$1`, [T]);
      expect((await um<{ v: boolean }>(c, `select kanban_automatico v from tenant_config where tenant_id=$1`, [T])).v).toBe(true); // trava do kanban manteve
      // (c) a GUC PL NAO libera kanban_automatico
      await c.query(`select set_config('app.etapas_pl_chave','rpc', true)`);
      await c.query(`update tenant_config set kanban_automatico = false where tenant_id=$1`, [T]);
      expect((await um<{ v: boolean }>(c, `select kanban_automatico v from tenant_config where tenant_id=$1`, [T])).v).toBe(true);
      await c.query(`select set_config('app.etapas_pl_chave','', true)`);
      // (d) `modules` por super admin: grava (MOD-1 libera) e a trava PL nao interfere
      await c.query(
        `update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"entrada_saida": false}'::jsonb where tenant_id=$1`,
        [T],
      );
      expect((await um<{ v: string }>(c, `select modules->>'entrada_saida' v from tenant_config where tenant_id=$1`, [T])).v).toBe("false");
    });
  });

  it("nao colide: MOD-1 segue revertendo `modules` para quem nao e super admin, mesmo com a GUC PL ligada", async () => {
    await withTx(async (c) => {
      await config(c);
      const antes = (await um<{ v: string | null }>(c, `select modules->>'entrada_saida' v from tenant_config where tenant_id=$1`, [T])).v;
      await comoUsuarioLoja(c, U_ADMIN, true); // tenant_admin, nao super
      await c.query(`select set_config('app.etapas_pl_chave','rpc', true)`);
      await c.query(
        `update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"entrada_saida": false}'::jsonb where tenant_id=$1`,
        [T],
      );
      const depois = (await um<{ v: string | null }>(c, `select modules->>'entrada_saida' v from tenant_config where tenant_id=$1`, [T])).v;
      expect(depois).toBe(antes); // MOD-1 desfez
    });
  });

  // (2) ligar: snapshot + cards derivam --------------------------------------------------------------------------------
  it("etapas_pl_definir_automatico(true): liga, snapshota o que esta no PL e move os cards; retorno coerente", async () => {
    await withTx(async (c) => {
      await config(c);
      const [a, b, fora] = await modelos(c, 3);
      await poeNoPl(c, a, "peca_teste"); // entrada do fluxo, trilha satisfeita: o motor AVANCA para a Oficina (automatica)
      await poeNoPl(c, b, "separacao_de_materiais"); // coluna MANUAL: fixado, fica
      await poeNoPl(c, fora, null); // fora do PL: nao entra no snapshot
      await comoUsuario(c);
      const r = (await definir(c, true)).rows[0].r;
      expect(r.ligado).toBe(true);
      expect(r.mudou).toBe(true);
      expect(r.lote_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await chave(c)).toBe(true);
      expect((await um<{ g: string }>(c, `select coalesce(current_setting('app.etapas_pl_chave', true),'') g`)).g).toBe(""); // GUC restaurada

      const snap = (await c.query(`select modelo_id, status_anterior, motivo from etapas_pl_snapshot where lote_id=$1 order by status_anterior`, [r.lote_id])).rows;
      expect(r.snapshot).toBe(snap.length);
      expect(snap.map((x) => x.modelo_id).sort()).toEqual([a, b].sort());
      expect(snap.every((x) => x.motivo === "ligar")).toBe(true);
      expect(snap.find((x) => x.modelo_id === a)?.status_anterior).toBe("peca_teste");

      expect(await status(c, a)).toBe("oficina"); // avancou
      expect(await status(c, b)).toBe("separacao_de_materiais");
      expect(await status(c, fora)).toBeNull();
      expect(r.cards_movidos).toBe(1);
      const h = await um<{ n: string }>(c, `select count(*)::text n from modelo_etapa_pl_historico where lote_id=$1 and origem='config' and modelo_id=$2`, [r.lote_id, a]);
      expect(Number(h.n)).toBeGreaterThanOrEqual(1);
    });
  });

  it("ligar quando ja esta ligada: idempotente (mudou=false, sem lote/snapshot)", async () => {
    await withTx(async (c) => {
      await config(c, { ligado: true });
      await comoUsuario(c);
      const r = (await definir(c, true)).rows[0].r;
      expect(r).toMatchObject({ ligado: true, mudou: false, lote_id: null, snapshot: 0, cards_movidos: 0 });
    });
  });

  it("desligar: ligado=false, mudou=true, nao move nada", async () => {
    await withTx(async (c) => {
      await config(c, { ligado: true });
      const [a] = await modelos(c, 1);
      await poeNoPl(c, a, "oficina");
      await comoUsuario(c);
      const r = (await definir(c, false)).rows[0].r;
      expect(r).toMatchObject({ ligado: false, mudou: true, lote_id: null, snapshot: 0, cards_movidos: 0 });
      expect(await chave(c)).toBe(false);
      expect(await status(c, a)).toBe("oficina");
    });
  });

  // (3) GATE: board vazio ----------------------------------------------------------------------------------------------
  it("GATE: ligar com board PL vazio ('[]') recusa P0001 ASCII e NAO liga nem snapshota", async () => {
    await withTx(async (c) => {
      await config(c, { board: `'[]'::jsonb`, reqs: `'{}'::jsonb` });
      const [a] = await modelos(c, 1);
      await poeNoPl(c, a, "peca_teste");
      await comoUsuario(c);
      const e = await erroDe(c, () => definir(c, true));
      expect(e).not.toBeNull();
      expect(e.code).toBe("P0001");
      expect(String(e.message)).toMatch(/^etapas_pl_board_vazio: /);
      expect(String(e.message)).toMatch(/^[\x20-\x7e]+$/); // so ASCII (5xx do PostgREST)
      expect(await chave(c)).toBe(false);
      expect(await status(c, a)).toBe("peca_teste"); // nada moveu contra o board DEFAULT do Dev
      const n = await um<{ n: string }>(c, `select count(*)::text n from etapas_pl_snapshot where tenant_id=$1`, [T]);
      expect(Number(n.n)).toBe(0);
    });
  });

  it("GATE: board nao-array ou so com etapa em branco tambem recusa", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      for (const board of [`'{}'::jsonb`, `'""'::jsonb`, `'[""]'::jsonb`, `'["   "]'::jsonb`]) {
        await config(c, { board, reqs: `'{}'::jsonb` });
        const e = await erroDe(c, () => definir(c, true));
        expect(e?.code, board).toBe("P0001");
        expect(String(e?.message), board).toMatch(/^etapas_pl_board_vazio: /);
        expect(await chave(c), board).toBe(false);
      }
    });
  });

  it("desligar NAO checa o board (chave ligada + board vazio desliga normalmente)", async () => {
    await withTx(async (c) => {
      await config(c, { board: `'[]'::jsonb`, reqs: `'{}'::jsonb`, ligado: true });
      await comoUsuario(c);
      const r = (await definir(c, false)).rows[0].r;
      expect(r).toMatchObject({ ligado: false, mudou: true });
    });
  });

  it("defesa: com a chave ligada, esvaziar o board (sem JWT) NAO snapshota nem move cards", async () => {
    await withTx(async (c) => {
      await config(c, { ligado: true });
      const [a] = await modelos(c, 1);
      await poeNoPl(c, a, "peca_teste");
      await semJwt(c, () => c.query(`update tenant_config set etapas_pl_kanban='[]'::jsonb, etapas_pl_requisitos='{}'::jsonb where tenant_id=$1`, [T]));
      expect(await status(c, a)).toBe("peca_teste");
      const n = await um<{ n: string }>(c, `select count(*)::text n from etapas_pl_snapshot where tenant_id=$1`, [T]);
      expect(Number(n.n)).toBe(0);
    });
  });

  // gate de acesso ---------------------------------------------------------------------------------------------------
  it("gate das RPCs: sem login 42501; usuario comum 42501 sem_permissao; modulo desligado 42501; tenant_admin passa; _ligar NULL P0001", async () => {
    await withTx(async (c) => {
      await config(c);
      await semJwt(c, async () => {
        const e0 = await erroDe(c, () => definir(c, true));
        expect(e0.code).toBe("42501");
        expect(String(e0.message)).toMatch(/^nao_autenticado/);
      });

      await comoUsuarioLoja(c, U_COMUM, false);
      for (const q of [
        () => definir(c, true),
        () => c.query(`select etapas_pl_previa_restauracao(null) r`),
        () => c.query(`select etapas_pl_restaurar(gen_random_uuid()) r`),
      ]) {
        const e = await erroDe(c, q);
        expect(e.code).toBe("42501");
        expect(String(e.message)).toMatch(/^sem_permissao/);
      }
      expect(await chave(c)).toBe(false);

      await config(c, { modulo: false });
      await comoUsuarioLoja(c, U_ADMIN, true);
      const em = await erroDe(c, () => definir(c, true));
      expect(em.code).toBe("42501");
      expect(String(em.message)).toMatch(/^modulo_desligado: .*etapas_pl/);

      await config(c);
      await comoUsuarioLoja(c, U_ADMIN, true);
      const nulo = await erroDe(c, () => definir(c, null));
      expect(nulo.code).toBe("P0001");
      const ok = (await definir(c, true)).rows[0].r;
      expect(ok).toMatchObject({ ligado: true, mudou: true }); // tenant_admin (nao super) passa
    });
  });

  // trg_etapas_pl_config -----------------------------------------------------------------------------------------------
  it("config mudou com a chave ligada: snapshot motivo 'config' + recalcula os cards", async () => {
    await withTx(async (c) => {
      await config(c, { reqs: `'{}'::jsonb`, ligado: true }); // oficina MANUAL
      const [a] = await modelos(c, 1);
      await poeNoPl(c, a, "peca_teste");
      expect(await status(c, a)).toBe("peca_teste"); // tudo manual: nao se mexe
      // oficina vira AUTOMATICA e a trilha esta satisfeita: o card avanca
      await semJwt(c, () => c.query(`update tenant_config set etapas_pl_requisitos=${REQS} where tenant_id=$1`, [T]));
      const s = (await c.query(`select motivo, status_anterior from etapas_pl_snapshot where tenant_id=$1 and modelo_id=$2`, [T, a])).rows;
      expect(s).toEqual([{ motivo: "config", status_anterior: "peca_teste" }]);
      expect(await status(c, a)).toBe("oficina");
    });
  });

  it("chave desligada: mudar a config NAO snapshota nem move (inerte)", async () => {
    await withTx(async (c) => {
      await config(c, { reqs: `'{}'::jsonb`, ligado: false });
      const [a] = await modelos(c, 1);
      await poeNoPl(c, a, "peca_teste");
      await semJwt(c, () => c.query(`update tenant_config set etapas_pl_requisitos=${REQS} where tenant_id=$1`, [T]));
      expect(await status(c, a)).toBe("peca_teste");
      const n = await um<{ n: string }>(c, `select count(*)::text n from etapas_pl_snapshot where tenant_id=$1`, [T]);
      expect(Number(n.n)).toBe(0);
    });
  });

  // (4) restaurar -----------------------------------------------------------------------------------------------------
  it("previa + restaurar: exige chave DESLIGADA; volta os status e apaga o historico auto/config do lote; nao repete", async () => {
    await withTx(async (c) => {
      await config(c);
      const [a, b, fora] = await modelos(c, 3);
      await poeNoPl(c, a, "peca_teste");
      await poeNoPl(c, b, "separacao_de_materiais");
      await poeNoPl(c, fora, null);
      await comoUsuario(c);
      const lig = (await definir(c, true)).rows[0].r;
      const movido = await status(c, a);
      expect(movido).toBe("oficina");

      // com a chave ligada: previa avisa, restaurar recusa
      const p1 = (await c.query(`select etapas_pl_previa_restauracao(null) r`)).rows[0].r;
      expect(p1.lote_id).toBe(lig.lote_id);
      expect(p1.chave_ligada).toBe(true);
      expect(p1.avisos.join(" ")).toMatch(/Desligue/);
      expect(p1.total).toBe(2);
      expect(p1.voltam).toBe(1);
      expect(p1.cards).toHaveLength(1);
      expect(p1.cards[0]).toMatchObject({ modelo_id: a, de: movido, para: "peca_teste", movido_manual_depois: false });
      const e1 = await erroDe(c, () => c.query(`select etapas_pl_restaurar($1) r`, [lig.lote_id]));
      expect(e1.code).toBe("P0001");
      expect(String(e1.message)).toMatch(/^etapas_pl_ligado: /);
      expect(String(e1.message)).toMatch(/^[\x20-\x7e]+$/);
      expect(await status(c, a)).toBe(movido); // nada mudou

      // desliga e restaura
      await definir(c, false);
      const p2 = (await c.query(`select etapas_pl_previa_restauracao($1) r`, [lig.lote_id])).rows[0].r;
      expect(p2.chave_ligada).toBe(false);
      expect(p2.voltam).toBe(1);
      const antesHist = await um<{ n: string }>(c, `select count(*)::text n from modelo_etapa_pl_historico where modelo_id=$1 and origem in ('auto','config') and lote_id=$2`, [a, lig.lote_id]);
      expect(Number(antesHist.n)).toBeGreaterThanOrEqual(1);

      const rest = (await c.query(`select etapas_pl_restaurar($1) r`, [lig.lote_id])).rows[0].r;
      expect(rest).toMatchObject({ lote_id: lig.lote_id, restaurados: 1, lotes_superados: 0 });
      expect(rest.historico_apagado).toBeGreaterThanOrEqual(1);
      expect(await status(c, a)).toBe("peca_teste");
      expect(await status(c, b)).toBe("separacao_de_materiais");
      expect(await status(c, fora)).toBeNull(); // quem estava fora do PL nao entra
      const pos = await um<{ n: string }>(c, `select count(*)::text n from modelo_etapa_pl_historico where modelo_id=$1 and origem in ('auto','config') and lote_id=$2`, [a, lig.lote_id]);
      expect(Number(pos.n)).toBe(0);
      expect((await um<{ g: string }>(c, `select coalesce(current_setting('app.etapas_pl_sistema', true),'') g`)).g).toBe(""); // GUC restaurada
      expect((await um<{ n: string }>(c, `select count(*)::text n from etapas_pl_snapshot where lote_id=$1 and restaurado_at is not null`, [lig.lote_id])).n).toBe("2");

      // de novo: ja restaurado
      const e2 = await erroDe(c, () => c.query(`select etapas_pl_restaurar($1) r`, [lig.lote_id]));
      expect(e2.code).toBe("P0001");
      expect(String(e2.message)).toMatch(/^etapas_pl_lote_restaurado: /);
      // previa sem lote pendente
      const p3 = (await c.query(`select etapas_pl_previa_restauracao(null) r`)).rows[0].r;
      expect(p3).toMatchObject({ lote_id: null, total: 0, voltam: 0 });
    });
  });

  it("restaurar: lote inexistente = P0002 ASCII; card que SAIU do PL depois nao volta e conta no aviso", async () => {
    await withTx(async (c) => {
      await config(c);
      const [a, b] = await modelos(c, 2);
      await poeNoPl(c, a, "peca_teste");
      await poeNoPl(c, b, "separacao_de_materiais");
      await comoUsuario(c);
      const lig = (await definir(c, true)).rows[0].r;
      await definir(c, false);
      await poeNoPl(c, b, null); // saiu do PL depois

      const e = await erroDe(c, () => c.query(`select etapas_pl_restaurar(gen_random_uuid()) r`));
      expect(e.code).toBe("P0002");
      expect(String(e.message)).toMatch(/^nao_encontrado: lote_etapas_pl/);

      const p = (await c.query(`select etapas_pl_previa_restauracao($1) r`, [lig.lote_id])).rows[0].r;
      expect(p.total).toBe(1);
      expect(p.avisos.join(" ")).toMatch(/saiu/);
      await c.query(`select etapas_pl_restaurar($1) r`, [lig.lote_id]);
      expect(await status(c, b)).toBeNull();
      expect(await status(c, a)).toBe("peca_teste");
    });
  });

  it("restaurar supera os lotes 'config' mais novos (ajuste de config feito depois de ligar)", async () => {
    await withTx(async (c) => {
      await config(c, { reqs: `'{}'::jsonb` }); // tudo manual: ligar nao move
      const [a] = await modelos(c, 1);
      await poeNoPl(c, a, "peca_teste");
      await comoUsuario(c);
      const lig = (await definir(c, true)).rows[0].r;
      expect(await status(c, a)).toBe("peca_teste");
      await semJwt(c, () => c.query(`update tenant_config set etapas_pl_requisitos=${REQS} where tenant_id=$1`, [T])); // lote 'config': avanca
      expect(await status(c, a)).toBe("oficina");
      await definir(c, false);

      const p = (await c.query(`select etapas_pl_previa_restauracao($1) r`, [lig.lote_id])).rows[0].r;
      expect(p.lotes_superados).toBe(1);
      const r = (await c.query(`select etapas_pl_restaurar($1) r`, [lig.lote_id])).rows[0].r;
      expect(r.lotes_superados).toBe(1);
      expect(await status(c, a)).toBe("peca_teste");
    });
  });

  // (6) invariante #9 -------------------------------------------------------------------------------------------------
  it("etapas_pl_snapshot: RLS ligada SEM policy e REVOKE ALL (invariante #9); isolada por tenant via RPC", async () => {
    await withTx(async (c) => {
      const rls = await um<{ r: boolean }>(c, `select relrowsecurity r from pg_class where oid='public.etapas_pl_snapshot'::regclass`);
      expect(rls.r).toBe(true);
      const pol = await um<{ n: string }>(c, `select count(*)::text n from pg_policy where polrelid='public.etapas_pl_snapshot'::regclass`);
      expect(Number(pol.n)).toBe(0);
      for (const role of ["anon", "authenticated"]) {
        for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          const r = await um<{ x: boolean }>(c, `select has_table_privilege($1,'public.etapas_pl_snapshot',$2) x`, [role, p]);
          expect(r.x, `${role} ${p}`).toBe(false);
        }
      }
      // espelho de kanban_snapshot: colunas + UNIQUE(lote,modelo) + CHECK do motivo + FK em cascata
      const cols = (await c.query(`select column_name from information_schema.columns where table_name='etapas_pl_snapshot'`)).rows.map((x) => x.column_name);
      for (const col of ["id", "lote_id", "tenant_id", "modelo_id", "status_anterior", "motivo", "criado_at", "restaurado_at"]) expect(cols, col).toContain(col);
      const cons = (await c.query(`select conname from pg_constraint where conrelid='public.etapas_pl_snapshot'::regclass`)).rows.map((x) => x.conname);
      expect(cons).toContain("etapas_pl_snapshot_lote_modelo_uk");
      expect(cons).toContain("etapas_pl_snapshot_motivo_chk");
      const fk = await um<{ d: string }>(c, `select confdeltype d from pg_constraint where conrelid='public.etapas_pl_snapshot'::regclass and contype='f'`);
      expect(fk.d).toBe("c");
    });
  });

  it("ACL: fn_etapas_pl_chave_protegida/fn_etapas_pl_config sem EXECUTE dos 3; as 3 RPCs REVOKE PUBLIC/anon + GRANT authenticated; DEFINER + search_path", async () => {
    await withTx(async (c) => {
      for (const sig of ["public.fn_etapas_pl_chave_protegida()", "public.fn_etapas_pl_config()"]) {
        for (const role of ["public", "anon", "authenticated"]) {
          const r = await um<{ x: boolean }>(c, `select has_function_privilege($1,$2,'EXECUTE') x`, [role, sig]);
          expect(r.x, `${role} nao deve executar ${sig}`).toBe(false);
        }
      }
      for (const sig of [
        "public.etapas_pl_definir_automatico(boolean)",
        "public.etapas_pl_previa_restauracao(uuid)",
        "public.etapas_pl_restaurar(uuid)",
      ]) {
        for (const role of ["public", "anon"]) {
          const r = await um<{ x: boolean }>(c, `select has_function_privilege($1,$2,'EXECUTE') x`, [role, sig]);
          expect(r.x, `${role} nao deve executar ${sig}`).toBe(false);
        }
        const au = await um<{ x: boolean }>(c, `select has_function_privilege('authenticated',$1,'EXECUTE') x`, [sig]);
        expect(au.x, sig).toBe(true);
      }
      const defs = await c.query(
        `select p.proname from pg_proc p
          where p.oid = any(array['public.fn_etapas_pl_chave_protegida()'::regprocedure,'public.fn_etapas_pl_config()'::regprocedure,
                                  'public.etapas_pl_definir_automatico(boolean)'::regprocedure,'public.etapas_pl_previa_restauracao(uuid)'::regprocedure,
                                  'public.etapas_pl_restaurar(uuid)'::regprocedure])
            and p.prosecdef and array_to_string(p.proconfig,'|') = 'search_path=public'`,
      );
      expect(defs.rowCount).toBe(5);
    });
  });

  it("gatilhos em tenant_config: trg_etapas_pl_chave_protegida (BEFORE INS/UPD) e trg_etapas_pl_config (AFTER UPD, WHEN) habilitados; nomes proprios", async () => {
    await withTx(async (c) => {
      const rows = (
        await c.query(
          `select tgname, tgenabled, pg_get_triggerdef(oid) def from pg_trigger
            where tgrelid='public.tenant_config'::regclass and not tgisinternal
              and tgname in ('trg_etapas_pl_chave_protegida','trg_etapas_pl_config','trg_kanban_chave_protegida','trg_kanban_config')
            order by tgname`,
        )
      ).rows;
      const por = Object.fromEntries(rows.map((r) => [r.tgname, r]));
      expect(Object.keys(por).sort()).toEqual(["trg_etapas_pl_chave_protegida", "trg_etapas_pl_config", "trg_kanban_chave_protegida", "trg_kanban_config"]);
      expect(por.trg_etapas_pl_chave_protegida.tgenabled).toBe("O");
      expect(por.trg_etapas_pl_chave_protegida.def).toMatch(/BEFORE INSERT OR UPDATE ON public\.tenant_config FOR EACH ROW EXECUTE FUNCTION fn_etapas_pl_chave_protegida\(\)/);
      expect(por.trg_etapas_pl_config.tgenabled).toBe("O");
      expect(por.trg_etapas_pl_config.def).toMatch(/AFTER UPDATE ON public\.tenant_config FOR EACH ROW WHEN/);
      expect(por.trg_etapas_pl_config.def).toMatch(/etapas_pl_automatico/);
      expect(por.trg_etapas_pl_config.def).toMatch(/etapas_pl_kanban/);
      expect(por.trg_etapas_pl_config.def).toMatch(/etapas_pl_requisitos/);
      // a trava PL e a funcao do KANBAN sao funcoes DIFERENTES (nao reaproveitou o nome)
      expect(por.trg_kanban_chave_protegida.def).toMatch(/fn_kanban_chave_protegida\(\)/);
    });
  });
});
