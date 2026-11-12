/**
 * Kanban PL configuravel - Onda 2, Task 6 (fn_etapas_pl_status_guard + trg_etapas_pl_status_guard + etapas_pl_mover).
 *
 * SO BANCO; `etapas_pl_automatico` default false (tudo inerte). Tudo em BEGIN...ROLLBACK (`withTx`) e SO na copia local
 * (`ehBancoLocal`): a migration 20261127120000_etapas_pl_guard_mover.sql e aplicada no banco ANTES da suite (gate
 * `psql -f`), e cada teste roda contra o estado vivo numa txn revertida. NUNCA `\i` migration em txn de teste
 * (incidente 15/set); DDL so na copia local (incidente 23/set).
 *
 * Board dos testes: ["Peça Teste","Separação de Materiais","Oficina"] -> chaves peca_teste / separacao_de_materiais / oficina.
 * Sem requisitos ({}), toda coluna e MANUAL; com {"oficina":["peca_teste_aprovada"]} a Oficina vira AUTOMATICA.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, um, comoUsuario, semUsuario, semJwt, ehBancoLocal, TENANT_TESTE } from "./db";

const T = TENANT_TESTE;
const BOARD = `'["Peça Teste","Separação de Materiais","Oficina"]'::jsonb`;
const UID_COMUM = "6c0d0a00-0000-4000-8000-0000000000a6";

async function modeloQualquer(c: Client): Promise<string> {
  const r = await um<{ id: string }>(c, `select id from modelos where tenant_id=$1 order by id limit 1`, [T]);
  return r.id;
}

async function config(c: Client, ligado: boolean, reqs = "{}"): Promise<void> {
  await c.query(
    `update tenant_config set etapas_pl_automatico=$2, etapas_pl_kanban=${BOARD}, etapas_pl_requisitos=$3::jsonb where tenant_id=$1`,
    [T, ligado, reqs],
  );
}

async function poeNoPl(c: Client, id: string, status: string): Promise<void> {
  // escrita "do sistema" (GUC) para nao passar pelo guard no preparo do cenario
  await c.query(`select set_config('app.etapas_pl_sistema','preparo', true)`);
  await c.query(`update modelos set status_etapa_pl=$2 where id=$1`, [id, status]);
  await c.query(`select set_config('app.etapas_pl_sistema','', true)`);
  await c.query(`delete from etapas_pl_recalculo_fila where modelo_id=$1`, [id]);
}

async function status(c: Client, id: string): Promise<string | null> {
  return (await um<{ s: string | null }>(c, `select status_etapa_pl s from modelos where id=$1`, [id])).s;
}

/** Roda `fn` dentro de um SAVEPOINT e devolve o erro (ou null); o savepoint e desfeito (a txn segue util). */
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

function mover(c: Client, id: string, para: string) {
  return c.query(`select etapas_pl_mover($1,$2) r`, [id, para]);
}

describe.skipIf(!hasDb || !ehBancoLocal())("Kanban PL Onda 2 - guard + mover (Task 6)", () => {
  // (a) chave DESLIGADA ------------------------------------------------------------------------------------------
  it("chave desligada: etapas_pl_mover GRAVA no modo manual (Task 9 fix 1: a recusa etapas_pl_manual acabou) - detalhes em etapas-pl-mover-manual.test.ts", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`select set_config('app.etapas_pl_chave','rpc', true)`); // T8: preparo do cenario passa pela trava da chave
      await config(c, false);
      const id = await modeloQualquer(c);
      await poeNoPl(c, id, "peca_teste");
      const r = (await um<{ r: any }>(c, `select etapas_pl_mover($1,'oficina') r`, [id])).r;
      expect(r.acao).toBe("manual");
      expect(r.status).toBe("oficina");
      expect(await status(c, id)).toBe("oficina");
    });
  });

  it("chave desligada: o guard sai cedo - a pessoa decide (UPDATE manual passa sem reversao)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`select set_config('app.etapas_pl_chave','rpc', true)`); // T8: preparo do cenario passa pela trava da chave
      await config(c, false, `{"oficina":["peca_teste_aprovada"]}`); // Oficina seria automatica se a chave estivesse ligada
      const id = await modeloQualquer(c);
      await poeNoPl(c, id, "peca_teste");
      await c.query(`update modelos set status_etapa_pl='oficina' where id=$1`, [id]); // auto + de fora do motor, mas modo manual
      expect(await status(c, id)).toBe("oficina");
      await c.query(`update modelos set status_etapa_pl='coluna_inexistente' where id=$1`, [id]); // nem o fluxo e exigido
      expect(await status(c, id)).toBe("coluna_inexistente");
    });
  });

  // (b) chave LIGADA - mover --------------------------------------------------------------------------------------
  it("chave ligada: mover para coluna MANUAL FIXA (resultado = a coluna), historico origem manual; mover valido SOLTA", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`select set_config('app.etapas_pl_chave','rpc', true)`); // T8: preparo do cenario passa pela trava da chave
      await config(c, true, "{}"); // todas manuais
      const id = await modeloQualquer(c);
      await poeNoPl(c, id, "peca_teste");

      const fixa = (await um<{ r: any }>(c, `select etapas_pl_mover($1,'oficina') r`, [id])).r;
      expect(fixa.acao).toBe("fixar");
      expect(fixa.status).toBe("oficina");
      expect(await status(c, id)).toBe("oficina");
      const h = await um<{ n: string }>(
        c,
        `select count(*)::text n from modelo_etapa_pl_historico where modelo_id=$1 and status='oficina' and origem='manual'`,
        [id],
      );
      expect(Number(h.n)).toBeGreaterThanOrEqual(1);

      // de volta a entrada do fluxo estando fixado -> SOLTA para a posicao derivada
      const der = await um<{ alvo: string }>(c, `select alvo from _etapas_pl_derivar_lote($1, ARRAY[$2]::uuid[]) limit 1`, [T, id]);
      const solta = (await um<{ r: any }>(c, `select etapas_pl_mover($1,'peca_teste') r`, [id])).r;
      expect(solta.acao).toBe("soltar");
      expect(solta.status).toBe(der.alvo);
      expect(await status(c, id)).toBe(der.alvo);

      // mover para onde ja esta = nada
      const nada = (await um<{ r: any }>(c, `select etapas_pl_mover($1,$2) r`, [id, der.alvo])).r;
      expect(nada.acao).toBe("nada");
      expect(nada.status).toBe(der.alvo);
    });
  });

  it("chave ligada: etapa fora do fluxo = fora_do_fluxo, nada grava; modelo inexistente = P0002 ASCII", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`select set_config('app.etapas_pl_chave','rpc', true)`); // T8: preparo do cenario passa pela trava da chave
      await config(c, true, "{}");
      const id = await modeloQualquer(c);
      await poeNoPl(c, id, "peca_teste");
      const r = (await um<{ r: any }>(c, `select etapas_pl_mover($1,'nao_existe') r`, [id])).r;
      expect(r.acao).toBe("fora_do_fluxo");
      expect(await status(c, id)).toBe("peca_teste");

      const e = await erroDe(c, () => mover(c, "00000000-0000-4000-8000-000000000bad", "oficina"));
      expect(e.code).toBe("P0002");
      expect(String(e.message)).toBe("nao_encontrado: modelo");
    });
  });

  it("etapas_pl_mover restaura app.etapas_pl_sistema/_lote ao valor anterior", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`select set_config('app.etapas_pl_chave','rpc', true)`); // T8: preparo do cenario passa pela trava da chave
      await config(c, true, "{}");
      const id = await modeloQualquer(c);
      await poeNoPl(c, id, "peca_teste");
      await c.query(`select set_config('app.etapas_pl_sistema','anterior', true), set_config('app.etapas_pl_lote','lote-anterior', true)`);
      await c.query(`select etapas_pl_mover($1,'oficina')`, [id]);
      const g = await um<{ sis: string; lote: string }>(
        c,
        `select coalesce(current_setting('app.etapas_pl_sistema', true),'') sis, coalesce(current_setting('app.etapas_pl_lote', true),'') lote`,
      );
      expect(g.sis).toBe("anterior");
      expect(g.lote).toBe("lote-anterior");
      expect(await status(c, id)).toBe("oficina");
    });
  });

  // Gate ---------------------------------------------------------------------------------------------------------
  it("gate: sem login = 42501; usuario comum sem modulo etapas_pl = 42501 modulo_desligado; sem editar = 42501", async () => {
    await withTx(async (c) => {
      await config(c, true, "{}");
      const id = await modeloQualquer(c);
      await poeNoPl(c, id, "peca_teste");

      await semUsuario(c);
      const semLogin = await erroDe(c, () => mover(c, id, "oficina"));
      expect(semLogin.code).toBe("42501");

      // usuario comum da loja (txn revertida; sem claims para mexer em auth/users/config - MOD-1)
      await semJwt(c, async () => {
        await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [UID_COMUM, `${UID_COMUM}@teste`]);
        await c.query(
          `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'KPL6', 'user')
           ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
          [UID_COMUM, T, `${UID_COMUM}@teste`],
        );
        await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [UID_COMUM]);
        await c.query(
          `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, 'producao_etapas', true, false)`,
          [UID_COMUM, T],
        );
        await c.query(`UPDATE public.tenant_config SET modules = coalesce(modules,'{}'::jsonb) || '{"etapas_pl": false}'::jsonb WHERE tenant_id = $1`, [T]);
      });
      await comoUsuario(c, UID_COMUM);
      const semModulo = await erroDe(c, () => mover(c, id, "oficina"));
      expect(semModulo.code).toBe("42501");
      expect(String(semModulo.message)).toMatch(/^modulo_desligado: .*etapas_pl/);

      await semJwt(c, () =>
        c.query(`UPDATE public.tenant_config SET modules = coalesce(modules,'{}'::jsonb) || '{"etapas_pl": true}'::jsonb WHERE tenant_id = $1`, [T]),
      );
      await comoUsuario(c, UID_COMUM);
      const semEditar = await erroDe(c, () => mover(c, id, "oficina")); // so VE a pagina
      expect(semEditar.code).toBe("42501");
      expect(String(semEditar.message)).toMatch(/^sem_permissao/);

      await semJwt(c, () =>
        c.query(`UPDATE public.user_permissions SET pode_editar = true WHERE user_id = $1 AND pagina = 'producao_etapas'`, [UID_COMUM]),
      );
      await comoUsuario(c, UID_COMUM);
      const ok = (await um<{ r: any }>(c, `select etapas_pl_mover($1,'oficina') r`, [id])).r;
      expect(ok.acao).toBe("fixar");
    });
  });

  // Guard com a chave LIGADA -----------------------------------------------------------------------------------
  it("chave ligada: guard mantem o atual quando se tenta ir a coluna AUTOMATICA de fora do motor", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`select set_config('app.etapas_pl_chave','rpc', true)`); // T8: preparo do cenario passa pela trava da chave
      await config(c, true, `{"oficina":["peca_teste_aprovada"]}`); // oficina AUTOMATICA; as outras manuais
      const id = await modeloQualquer(c);
      await poeNoPl(c, id, "peca_teste"); // entrada do fluxo
      await c.query(`update modelos set status_etapa_pl='oficina' where id=$1`, [id]);
      expect(await status(c, id)).toBe("peca_teste"); // revertido: auto nao se fixa a mao (v_atual = entrada)
    });
  });

  it("chave ligada: guard deixa passar coluna MANUAL e a entrada; recusa etapa fora do fluxo (P0001 ASCII)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`select set_config('app.etapas_pl_chave','rpc', true)`); // T8: preparo do cenario passa pela trava da chave
      await config(c, true, `{"oficina":["peca_teste_aprovada"]}`);
      const id = await modeloQualquer(c);
      await poeNoPl(c, id, "peca_teste");
      await c.query(`update modelos set status_etapa_pl='separacao_de_materiais' where id=$1`, [id]); // manual -> passa (fixa)
      expect(await status(c, id)).toBe("separacao_de_materiais");
      await c.query(`update modelos set status_etapa_pl='peca_teste' where id=$1`, [id]); // entrada -> passa
      expect(await status(c, id)).toBe("peca_teste");

      const e = await erroDe(c, () => c.query(`update modelos set status_etapa_pl='zzz' where id=$1`, [id]));
      expect(e.code).toBe("P0001");
      expect(String(e.message)).toMatch(/^etapas_pl_fora_do_fluxo: zzz$/);
      expect(await status(c, id)).toBe("peca_teste");
    });
  });

  it("chave ligada: guard - '' mantem o atual; fixado + coluna automatica = vai a posicao DERIVADA (solta)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`select set_config('app.etapas_pl_chave','rpc', true)`); // T8: preparo do cenario passa pela trava da chave
      await config(c, true, `{"oficina":["peca_teste_aprovada"]}`);
      const id = await modeloQualquer(c);
      await poeNoPl(c, id, "separacao_de_materiais"); // coluna MANUAL (fixado)
      await c.query(`update modelos set status_etapa_pl='' where id=$1`, [id]);
      expect(await status(c, id)).toBe("separacao_de_materiais");

      const der = await um<{ alvo: string }>(c, `select alvo from _etapas_pl_derivar_lote($1, ARRAY[$2]::uuid[]) limit 1`, [T, id]);
      await c.query(`update modelos set status_etapa_pl='oficina' where id=$1`, [id]); // tirar de manual para automatica = solta
      expect(await status(c, id)).toBe(der.alvo);
    });
  });

  it("chave ligada: GUC do sistema faz o guard sair cedo (o motor/aplicador grava a automatica)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`select set_config('app.etapas_pl_chave','rpc', true)`); // T8: preparo do cenario passa pela trava da chave
      await config(c, true, `{"oficina":["peca_teste_aprovada"]}`);
      const id = await modeloQualquer(c);
      await poeNoPl(c, id, "peca_teste");
      await c.query(`select set_config('app.etapas_pl_sistema','auto', true)`);
      await c.query(`update modelos set status_etapa_pl='oficina' where id=$1`, [id]);
      await c.query(`select set_config('app.etapas_pl_sistema','', true)`);
      expect(await status(c, id)).toBe("oficina");
    });
  });

  it("guard: entrar/sair do PL (NULL) passa; o guard re-enfileira quando decide", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`select set_config('app.etapas_pl_chave','rpc', true)`); // T8: preparo do cenario passa pela trava da chave
      await config(c, true, `{"oficina":["peca_teste_aprovada"]}`);
      const id = await modeloQualquer(c);
      await poeNoPl(c, id, "peca_teste");
      await c.query(`update modelos set status_etapa_pl=NULL where id=$1`, [id]); // sai do PL
      expect(await status(c, id)).toBeNull();
      await c.query(`update modelos set status_etapa_pl='oficina' where id=$1`, [id]); // entra do NULL, mesmo em coluna automatica
      expect(await status(c, id)).toBe("oficina");

      // re-enfileira quando decide (ramo 'mantem o atual'): limpa a fila, volta o fluxo, tenta auto de fora
      await config(c, true, `{"oficina":["peca_teste_aprovada"]}`);
      await poeNoPl(c, id, "peca_teste");
      await c.query(`select set_config('app.etapas_pl_sistema','', true)`);
      await c.query(`update modelos set status_etapa_pl='oficina' where id=$1`, [id]);
      const n = await um<{ n: string }>(c, `select count(*)::text n from etapas_pl_recalculo_fila where modelo_id=$1`, [id]);
      expect(Number(n.n)).toBe(1);
    });
  });

  // (c) ACL / invariante #9 ----------------------------------------------------------------------------------------
  it("fn_etapas_pl_status_guard sem EXECUTE para PUBLIC/anon/authenticated; etapas_pl_mover so authenticated", async () => {
    await withTx(async (c) => {
      for (const role of ["public", "anon", "authenticated"]) {
        const r = await um<{ ex: boolean }>(
          c,
          `select has_function_privilege($1,'public.fn_etapas_pl_status_guard()','EXECUTE') ex`,
          [role],
        );
        expect(r.ex, `${role} nao deve executar o guard`).toBe(false);
      }
      const m = await um<{ pub: boolean; anon: boolean; auth: boolean }>(
        c,
        `select has_function_privilege('public','public.etapas_pl_mover(uuid,text)','EXECUTE') pub,
                has_function_privilege('anon','public.etapas_pl_mover(uuid,text)','EXECUTE') anon,
                has_function_privilege('authenticated','public.etapas_pl_mover(uuid,text)','EXECUTE') auth`,
      );
      expect(m.pub).toBe(false);
      expect(m.anon).toBe(false);
      expect(m.auth).toBe(true);
    });
  });

  it("as 2 funcoes sao DEFINER com search_path=public e o gatilho e BEFORE UPDATE OF status_etapa_pl", async () => {
    await withTx(async (c) => {
      const f = await c.query(
        `select proname, prosecdef, array_to_string(proconfig,'|') cfg from pg_proc
          where proname in ('fn_etapas_pl_status_guard','etapas_pl_mover') and pronamespace='public'::regnamespace order by proname`,
      );
      expect(f.rows.length).toBe(2);
      for (const r of f.rows) {
        expect(r.prosecdef).toBe(true);
        expect(r.cfg).toBe("search_path=public");
      }
      const t = await um<{ def: string }>(
        c,
        `select pg_get_triggerdef(oid) def from pg_trigger where tgname='trg_etapas_pl_status_guard' and tgrelid='public.modelos'::regclass`,
      );
      expect(t.def).toMatch(/BEFORE UPDATE OF status_etapa_pl ON public\.modelos FOR EACH ROW/);
    });
  });
});
