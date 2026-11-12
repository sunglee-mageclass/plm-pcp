/**
 * Kanban PL - Onda 3, Task 2: a ENTRADA/SAIDA do card no board PL deixa de ser "peca teste fixo" e passa a avaliar os
 * REQUISITOS da 1a coluna configurada (`etapas_pl_requisitos[<1a etapa>]`) via `_avaliar_condicoes_etapas_pl_core`.
 *
 * A decisao mora no helper `_etapas_pl_entrada_avaliar(uuid)` (chamado pelo gatilho `fn_etapas_pl_entrada`). Regras:
 *   ENTRADA: status NULL E modulo etapas_pl ligado E board configurado E a 1a coluna TEM requisito E o produto cumpre TODOS.
 *   SAIDA  : status NOT NULL E a 1a coluna TEM requisito E o produto NAO cumpre mais E NAO esta pos-Explosao.
 *   1a coluna SEM requisito => ninguem entra sozinho (so manual) E ninguem e tirado (board todo-manual nao se esvazia).
 *
 * SO BANCO LOCAL; tudo em BEGIN...ROLLBACK (`withTx`); a migration 20261128100000 e aplicada ANTES da suite (psql -f).
 * Os gatilhos escutam M.O., categoria e (Task 3) cad.enviado_corte/modelo_id; os casos de requisito que nao dependem de um
 * evento real chamam o helper direto (a conexao e superusuario local; o helper e DEFINER sem EXECUTE p/ authenticated).
 *
 * Task 3: (A) o seed da 1a coluna (`_kanban_pl_seed_etapas` grava `etapas_pl_requisitos[1a]=["tem_peca_teste"]` se vazio);
 * (B) o gatilho `trg_etapas_pl_entrada_cad` faz a entrada reagir a cad.enviado_corte (a Explosao) SEM chamar o helper.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, um, comoUsuario, ehBancoLocal, TENANT_TESTE } from "./db";

const T = TENANT_TESTE;
const BOARD = `'["Peça Teste","Separação de Materiais","Oficina"]'::jsonb`;
const REQ_PT = `'{"peca_teste":["tem_peca_teste"]}'::jsonb`;
const REQ_ENV = `'{"peca_teste":["enviado_a_servicos"]}'::jsonb`;
const REQ_AMBOS = `'{"peca_teste":["tem_peca_teste","enviado_a_servicos"]}'::jsonb`;
const REQ_NENHUM = `'{}'::jsonb`;

interface Opts {
  modulo?: boolean;
  board?: string;
  reqs?: string;
  automatico?: boolean;
}

/** Config da loja: modulo etapas_pl + board + requisitos (sem JWT: MOD-1 so barra chamada com claims). */
async function preparar(c: Client, opts: Opts = {}): Promise<void> {
  const { modulo = true, board = BOARD, reqs = REQ_PT, automatico = false } = opts;
  await c.query(
    `update tenant_config
        set modules = coalesce(modules, '{}'::jsonb) || jsonb_build_object('etapas_pl', $2::boolean),
            etapas_pl_kanban = ${board}, etapas_pl_requisitos = ${reqs}, etapas_pl_automatico = $3
      where tenant_id = $1`,
    [T, modulo, automatico],
  );
  await comoUsuario(c);
}

/** Modelo da loja "limpo": sem M.O., sem CAD enviado, fora do PL (escrita de sistema para nao passar pelo guard). */
async function modeloLimpo(c: Client): Promise<string> {
  const m = await um<{ id: string }>(c, `select id from modelos where tenant_id=$1 order by id limit 1`, [T]);
  await c.query(`delete from modelo_servico_mo where modelo_id=$1`, [m.id]);
  await c.query(`update cad set enviado_corte=false where modelo_id=$1`, [m.id]);
  await setStatus(c, m.id, null);
  await c.query(`delete from etapas_pl_recalculo_fila where modelo_id=$1`, [m.id]);
  return m.id;
}

/** Escrita de sistema em status_etapa_pl (nao passa pelo guard nem enfileira). */
async function setStatus(c: Client, id: string, st: string | null): Promise<void> {
  await c.query(`select set_config('app.etapas_pl_sistema','preparo', true)`);
  await c.query(`update modelos set status_etapa_pl=$2 where id=$1`, [id, st]);
  await c.query(`select set_config('app.etapas_pl_sistema','', true)`);
}

async function categoria(c: Client, exige: boolean): Promise<string> {
  const r = await um<{ id: string }>(
    c,
    `insert into categorias_terceirizado (tenant_id, nome, exige_peca_teste) values ($1, $2, $3) returning id`,
    [T, `T2 ${Math.random().toString(36).slice(2)}`, exige],
  );
  return r.id;
}

async function linhaMo(c: Client, modeloId: string, catId: string | null): Promise<string> {
  const r = await um<{ id: string }>(
    c,
    `insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor) values ($1,$2,$3,0) returning id`,
    [T, modeloId, catId],
  );
  return r.id;
}

async function status(c: Client, id: string): Promise<string | null> {
  return (await um<{ s: string | null }>(c, `select status_etapa_pl s from modelos where id=$1`, [id])).s;
}

async function filaDoModelo(c: Client, id: string): Promise<number> {
  const r = await um<{ n: string }>(c, `select count(*)::text n from etapas_pl_recalculo_fila where modelo_id=$1`, [id]);
  return Number(r.n);
}

/** Poe o modelo "pos-Explosao": cad com enviado_corte = true (atualiza o existente ou cria). Desde a Task 3 isso DISPARA o
 * gatilho de entrada em cad (os casos que pre-dataram a Task 3 reavaliam em seguida, o que e idempotente). */
async function posExplosao(c: Client, modeloId: string): Promise<void> {
  const up = await c.query(`update cad set enviado_corte=true where modelo_id=$1`, [modeloId]);
  if (!up.rowCount) await c.query(`insert into cad (tenant_id, modelo_id, enviado_corte) values ($1,$2,true)`, [T, modeloId]);
}

/** Reavalia chamando o helper direto (DEFINER, conexao local); idempotente com o gatilho de cad. */
async function reavaliar(c: Client, id: string): Promise<void> {
  await c.query(`select public._etapas_pl_entrada_avaliar($1)`, [id]);
}

describe.skipIf(!hasDb || !ehBancoLocal())("Kanban PL Onda 3 - entrada = requisito da 1a coluna (Task 2)", () => {
  it("1a coluna exige tem_peca_teste: ganhar a trilha poe o card na 1a etapa (historico origem 'auto')", async () => {
    await withTx(async (c) => {
      await preparar(c, { reqs: REQ_PT });
      const id = await modeloLimpo(c);
      const cat = await categoria(c, true);
      expect(await status(c, id)).toBeNull();
      await linhaMo(c, id, cat);
      expect(await status(c, id)).toBe("peca_teste");
      const h = await um<{ origem: string }>(
        c,
        `select origem from modelo_etapa_pl_historico where modelo_id=$1 order by created_at desc limit 1`,
        [id],
      );
      expect(h.origem).toBe("auto");
    });
  });

  it("1a coluna exige enviado_a_servicos: produto SEM peca teste mas enviado a Explosao entra", async () => {
    await withTx(async (c) => {
      await preparar(c, { reqs: REQ_ENV });
      const id = await modeloLimpo(c);
      await reavaliar(c, id);
      expect(await status(c, id)).toBeNull(); // nao enviado: nao cumpre
      await posExplosao(c, id);
      await reavaliar(c, id);
      expect(await status(c, id)).toBe("peca_teste");
    });
  });

  it("1a coluna exige enviado_a_servicos: ganhar trilha de peca teste NAO basta (requisito e outro)", async () => {
    await withTx(async (c) => {
      await preparar(c, { reqs: REQ_ENV });
      const id = await modeloLimpo(c);
      await linhaMo(c, id, await categoria(c, true));
      expect(await status(c, id)).toBeNull();
    });
  });

  it("1a coluna com 2 requisitos: so entra quando cumpre TODOS", async () => {
    await withTx(async (c) => {
      await preparar(c, { reqs: REQ_AMBOS });
      const id = await modeloLimpo(c);
      await linhaMo(c, id, await categoria(c, true)); // cumpre so tem_peca_teste
      expect(await status(c, id)).toBeNull();
      await posExplosao(c, id); // agora cumpre os dois
      await reavaliar(c, id);
      expect(await status(c, id)).toBe("peca_teste");
    });
  });

  it("1a coluna SEM requisito: ganhar trilha NAO coloca no board (entrada so manual)", async () => {
    await withTx(async (c) => {
      await preparar(c, { reqs: REQ_NENHUM });
      const id = await modeloLimpo(c);
      await linhaMo(c, id, await categoria(c, true));
      expect(await status(c, id)).toBeNull();
      await posExplosao(c, id);
      await reavaliar(c, id);
      expect(await status(c, id)).toBeNull();
    });
  });

  it("1a coluna SEM requisito: o board NAO se auto-esvazia (card manual pre-Explosao permanece)", async () => {
    await withTx(async (c) => {
      await preparar(c, { reqs: REQ_NENHUM });
      const id = await modeloLimpo(c);
      await setStatus(c, id, "oficina"); // colocado a mao
      const linha = await linhaMo(c, id, await categoria(c, true));
      expect(await status(c, id)).toBe("oficina");
      await c.query(`delete from modelo_servico_mo where id=$1`, [linha]);
      expect(await status(c, id)).toBe("oficina");
      await reavaliar(c, id);
      expect(await status(c, id)).toBe("oficina");
    });
  });

  it("perder a ultima trilha PRE-Explosao tira o card do board (NULL)", async () => {
    await withTx(async (c) => {
      await preparar(c);
      const id = await modeloLimpo(c);
      const linha = await linhaMo(c, id, await categoria(c, true));
      expect(await status(c, id)).toBe("peca_teste");
      await c.query(`delete from modelo_servico_mo where id=$1`, [linha]);
      expect(await status(c, id)).toBeNull();
    });
  });

  it("perder so UMA de duas trilhas mantem o card na etapa em que estava", async () => {
    await withTx(async (c) => {
      await preparar(c);
      const id = await modeloLimpo(c);
      const l1 = await linhaMo(c, id, await categoria(c, true));
      await linhaMo(c, id, await categoria(c, true));
      await setStatus(c, id, "oficina");
      await c.query(`delete from modelo_servico_mo where id=$1`, [l1]);
      expect(await status(c, id)).toBe("oficina");
    });
  });

  it("perder a trilha POS-Explosao NAO tira o card", async () => {
    await withTx(async (c) => {
      await preparar(c);
      const id = await modeloLimpo(c);
      const linha = await linhaMo(c, id, await categoria(c, true));
      expect(await status(c, id)).toBe("peca_teste");
      await posExplosao(c, id);
      await c.query(`delete from modelo_servico_mo where id=$1`, [linha]);
      expect(await status(c, id)).toBe("peca_teste");
    });
  });

  it("card ja no board e que ja cumpre a 1a coluna: reavaliar nao o devolve a 1a etapa", async () => {
    await withTx(async (c) => {
      await preparar(c);
      const id = await modeloLimpo(c);
      await linhaMo(c, id, await categoria(c, true));
      await setStatus(c, id, "oficina");
      await reavaliar(c, id);
      expect(await status(c, id)).toBe("oficina");
    });
  });

  it("chave off (etapas_pl_automatico=false): a entrada coloca no board mas NAO enfileira recalculo", async () => {
    await withTx(async (c) => {
      await preparar(c, { automatico: false });
      const id = await modeloLimpo(c);
      await linhaMo(c, id, await categoria(c, true));
      expect(await status(c, id)).toBe("peca_teste");
      expect(await filaDoModelo(c, id)).toBe(0);
    });
  });

  it("chave on: a entrada enfileira o modelo (o processador re-deriva no COMMIT)", async () => {
    await withTx(async (c) => {
      await preparar(c, { automatico: true });
      const id = await modeloLimpo(c);
      await linhaMo(c, id, await categoria(c, true));
      expect(await status(c, id)).toBe("peca_teste");
      expect(await filaDoModelo(c, id)).toBe(1);
    });
  });

  it("loja SEM o modulo etapas_pl: cumprir a 1a coluna NAO entra", async () => {
    await withTx(async (c) => {
      await preparar(c, { modulo: false });
      const id = await modeloLimpo(c);
      await linhaMo(c, id, await categoria(c, true));
      expect(await status(c, id)).toBeNull();
    });
  });

  it("board PL VAZIO: inercia total (nao entra e nao tira quem ja esta)", async () => {
    await withTx(async (c) => {
      await preparar(c, { board: `'[]'::jsonb` });
      const id = await modeloLimpo(c);
      await linhaMo(c, id, await categoria(c, true));
      expect(await status(c, id)).toBeNull();
      await setStatus(c, id, "oficina");
      await c.query(`delete from modelo_servico_mo where modelo_id=$1`, [id]);
      await reavaliar(c, id);
      expect(await status(c, id)).toBe("oficina");
    });
  });

  it("board com 1a etapa em branco ([\"\"]) NAO entra (nao grava status vazio)", async () => {
    await withTx(async (c) => {
      await preparar(c, { board: `'[""]'::jsonb` });
      const id = await modeloLimpo(c);
      await linhaMo(c, id, await categoria(c, true));
      expect(await status(c, id)).toBeNull();
    });
  });

  it("a GUC app.etapas_pl_sistema e RESTAURADA depois da escrita do sistema", async () => {
    await withTx(async (c) => {
      await preparar(c);
      const id = await modeloLimpo(c);
      await linhaMo(c, id, await categoria(c, true));
      const g = await um<{ v: string }>(c, `select coalesce(current_setting('app.etapas_pl_sistema', true),'') v`);
      expect(g.v).toBe("");
    });
  });

  it("invariante #9: fn_etapas_pl_entrada e o helper sem EXECUTE para PUBLIC/anon/authenticated", async () => {
    await withTx(async (c) => {
      for (const sig of ["public.fn_etapas_pl_entrada()", "public._etapas_pl_entrada_avaliar(uuid)"]) {
        for (const role of ["anon", "authenticated", "public"]) {
          const r = await um<{ ex: boolean }>(c, `select has_function_privilege('${role}','${sig}','EXECUTE') ex`);
          expect(r.ex, `${role} nao deve executar ${sig}`).toBe(false);
        }
      }
    });
  });

  it("DEFINER + search_path=public nas duas funcoes", async () => {
    await withTx(async (c) => {
      const f = await c.query(
        `select prosecdef, array_to_string(proconfig,'|') cfg from pg_proc
          where proname in ('fn_etapas_pl_entrada','_etapas_pl_entrada_avaliar') and pronamespace='public'::regnamespace`,
      );
      expect(f.rows.length).toBe(2);
      for (const r of f.rows) {
        expect(r.prosecdef).toBe(true);
        expect(r.cfg).toBe("search_path=public");
      }
    });
  });
});

/** key resolvida da 1a etapa do board (a MESMA que o avaliador usa: _kanban_fluxo(...)[1]; 'Peça Teste' -> 'peca_teste'). */
async function normPrimeira(c: Client, label: string): Promise<string> {
  return (
    await um<{ k: string }>(c, `select (public._kanban_fluxo(jsonb_build_object('status_kanban', jsonb_build_array($1::text)), false))[1] k`, [label])
  ).k;
}

describe.skipIf(!hasDb || !ehBancoLocal())("Kanban PL Onda 3 - seed da 1a coluna (Task 3, A)", () => {
  async function cfg(c: Client): Promise<{ k: unknown; rq: Record<string, unknown> | null }> {
    return um(c, `select etapas_pl_kanban k, etapas_pl_requisitos rq from tenant_config where tenant_id=$1`, [T]);
  }

  it("1a coluna nasce com [\"tem_peca_teste\"] quando etapas_pl_requisitos estava vazio ('{}')", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(
        `update tenant_config set pcp_etapas='[{"key":"a","label":"Prova Final","ativa":true},{"key":"b","label":"Costura","ativa":true}]'::jsonb,
                etapas_pl_kanban='[]'::jsonb, etapas_pl_requisitos='{}'::jsonb where tenant_id=$1`,
        [T],
      );
      await c.query(`select public._kanban_pl_seed_etapas($1)`, [T]);
      const r = await cfg(c);
      expect(r.k).toEqual(["Prova Final", "Costura"]);
      expect(r.rq).toEqual({ [await normPrimeira(c, "Prova Final")]: ["tem_peca_teste"] });
    });
  });

  it("loja sem pcp_etapas (default de 5 labels): a 1a coluna 'Peça Teste' ganha a key resolvida peca_teste", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set pcp_etapas=null, etapas_pl_kanban='[]'::jsonb, etapas_pl_requisitos='{}'::jsonb where tenant_id=$1`, [T]);
      await c.query(`select public._kanban_pl_seed_etapas($1)`, [T]);
      const r = await cfg(c);
      expect(r.rq).toEqual({ peca_teste: ["tem_peca_teste"] }); // key LITERAL: e a que o avaliador procura
    });
  });

  it("NAO sobrescreve etapas_pl_requisitos ja configurado (mesmo com o board vazio sendo semeado)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(
        `update tenant_config set pcp_etapas=null, etapas_pl_kanban='[]'::jsonb,
                etapas_pl_requisitos='{"oficina":["cq_liberado"]}'::jsonb where tenant_id=$1`,
        [T],
      );
      await c.query(`select public._kanban_pl_seed_etapas($1)`, [T]);
      const r = await cfg(c);
      expect((r.k as string[])[0]).toBe("Peça Teste"); // o board foi semeado...
      expect(r.rq).toEqual({ oficina: ["cq_liberado"] }); // ...mas os requisitos configurados ficam intactos
    });
  });

  it("idempotente: semear 2x nao muda nada (o 2o chamado sai cedo; requisito editado no meio e preservado)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set pcp_etapas=null, etapas_pl_kanban='[]'::jsonb, etapas_pl_requisitos='{}'::jsonb where tenant_id=$1`, [T]);
      await c.query(`select public._kanban_pl_seed_etapas($1)`, [T]);
      const a = await cfg(c);
      await c.query(`select public._kanban_pl_seed_etapas($1)`, [T]);
      expect(await cfg(c)).toEqual(a);
      // o dono troca o requisito da 1a coluna e zera o outro: re-semear NAO desfaz (board ja preenchido)
      await c.query(`update tenant_config set etapas_pl_requisitos='{}'::jsonb where tenant_id=$1`, [T]);
      await c.query(`select public._kanban_pl_seed_etapas($1)`, [T]);
      expect((await cfg(c)).rq).toEqual({});
    });
  });

  it("board ja preenchido: o seed nao grava requisito (so semeia quando semeia o board)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set etapas_pl_kanban='["X"]'::jsonb, etapas_pl_requisitos='{}'::jsonb where tenant_id=$1`, [T]);
      await c.query(`select public._kanban_pl_seed_etapas($1)`, [T]);
      expect((await cfg(c)).rq).toEqual({});
    });
  });

  it("integra com a entrada: loja recem-semeada, produto com trilha de peca teste entra na 1a etapa", async () => {
    await withTx(async (c) => {
      await c.query(
        `update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"etapas_pl": true}'::jsonb, pcp_etapas=null,
                etapas_pl_kanban='[]'::jsonb, etapas_pl_requisitos='{}'::jsonb, etapas_pl_automatico=false where tenant_id=$1`,
        [T],
      );
      await c.query(`select public._kanban_pl_seed_etapas($1)`, [T]);
      await comoUsuario(c);
      const id = await modeloLimpo(c);
      await linhaMo(c, id, await categoria(c, true));
      expect(await status(c, id)).toBe("peca_teste");
    });
  });
});

describe.skipIf(!hasDb || !ehBancoLocal())("Kanban PL Onda 3 - gatilho de entrada em cad (Task 3, B)", () => {
  it("1a coluna enviado_a_servicos: UPDATE cad.enviado_corte=true (gatilho REAL) poe o card na 1a etapa", async () => {
    await withTx(async (c) => {
      await preparar(c, { reqs: REQ_ENV });
      const id = await modeloLimpo(c);
      const tem = await um<{ n: string }>(c, `select count(*)::text n from cad where modelo_id=$1`, [id]);
      if (Number(tem.n) === 0) await c.query(`insert into cad (tenant_id, modelo_id, enviado_corte) values ($1,$2,false)`, [T, id]);
      expect(await status(c, id)).toBeNull(); // sem trilha de peca teste, fora do board
      await c.query(`update cad set enviado_corte=true where modelo_id=$1`, [id]); // SEM chamar o helper
      expect(await status(c, id)).toBe("peca_teste");
      const h = await um<{ origem: string }>(
        c,
        `select origem from modelo_etapa_pl_historico where modelo_id=$1 order by created_at desc limit 1`,
        [id],
      );
      expect(h.origem).toBe("auto");
    });
  });

  it("INSERT de cad ja com enviado_corte=true tambem entra", async () => {
    await withTx(async (c) => {
      await preparar(c, { reqs: REQ_ENV });
      // modelo SEM cad (a FK de estoque_tecido_baixas impede apagar um cad existente): acha um da loja ou cria um modelo
      const m = await um<{ id: string }>(
        c,
        `select m.id from modelos m where m.tenant_id=$1 and not exists (select 1 from cad c where c.modelo_id=m.id) limit 1`,
        [T],
      );
      expect(m, "precisa de um modelo da Loja Teste sem cad").toBeTruthy();
      await c.query(`delete from modelo_servico_mo where modelo_id=$1`, [m.id]);
      await setStatus(c, m.id, null);
      await c.query(`insert into cad (tenant_id, modelo_id, enviado_corte) values ($1,$2,true)`, [T, m.id]);
      expect(await status(c, m.id)).toBe("peca_teste");
    });
  });

  it("board sem o requisito enviado_a_servicos (1a = tem_peca_teste): enviar a Explosao NAO coloca no board", async () => {
    await withTx(async (c) => {
      await preparar(c, { reqs: REQ_PT });
      const id = await modeloLimpo(c);
      await posExplosao(c, id); // UPDATE/INSERT real em cad
      expect(await status(c, id)).toBeNull();
    });
  });

  it("board vazio / 1a coluna sem requisito: enviar a Explosao NAO coloca no board", async () => {
    await withTx(async (c) => {
      await preparar(c, { reqs: REQ_NENHUM });
      const id = await modeloLimpo(c);
      await posExplosao(c, id);
      expect(await status(c, id)).toBeNull();
    });
    await withTx(async (c) => {
      await preparar(c, { board: `'[]'::jsonb`, reqs: REQ_ENV });
      const id = await modeloLimpo(c);
      await posExplosao(c, id);
      expect(await status(c, id)).toBeNull();
    });
  });

  it("2 requisitos (tem_peca_teste + enviado_a_servicos): a Explosao sozinha NAO basta; com a trilha, entra", async () => {
    await withTx(async (c) => {
      await preparar(c, { reqs: REQ_AMBOS });
      const id = await modeloLimpo(c);
      await posExplosao(c, id);
      expect(await status(c, id)).toBeNull();
      await c.query(`update cad set enviado_corte=false where modelo_id=$1`, [id]);
      await linhaMo(c, id, await categoria(c, true)); // cumpre so tem_peca_teste (gatilho de MO)
      expect(await status(c, id)).toBeNull();
      await c.query(`update cad set enviado_corte=true where modelo_id=$1`, [id]); // agora cumpre os dois
      expect(await status(c, id)).toBe("peca_teste");
    });
  });

  it("modulo etapas_pl desligado: a Explosao NAO coloca no board", async () => {
    await withTx(async (c) => {
      await preparar(c, { reqs: REQ_ENV, modulo: false });
      const id = await modeloLimpo(c);
      await posExplosao(c, id);
      expect(await status(c, id)).toBeNull();
    });
  });

  it("card ja no board: reenviar/regravar enviado_corte nao o devolve a 1a etapa", async () => {
    await withTx(async (c) => {
      await preparar(c, { reqs: REQ_ENV });
      const id = await modeloLimpo(c);
      await setStatus(c, id, "oficina");
      await posExplosao(c, id);
      expect(await status(c, id)).toBe("oficina");
    });
  });

  it("sem recursao: a entrada (que escreve so em modelos) nao reabre o gatilho de cad; GUC restaurada; 1 linha de historico", async () => {
    await withTx(async (c) => {
      await preparar(c, { reqs: REQ_ENV });
      const id = await modeloLimpo(c);
      await posExplosao(c, id);
      expect(await status(c, id)).toBe("peca_teste");
      const g = await um<{ v: string }>(c, `select coalesce(current_setting('app.etapas_pl_sistema', true),'') v`);
      expect(g.v).toBe("");
      const h = await um<{ n: string }>(c, `select count(*)::text n from modelo_etapa_pl_historico where modelo_id=$1 and status='peca_teste'`, [id]);
      expect(Number(h.n)).toBe(1);
    });
  });

  it("enviado_corte true->false com a 1a coluna = enviado_a_servicos: o card SAI (nao esta mais pos-Explosao)", async () => {
    await withTx(async (c) => {
      await preparar(c, { reqs: REQ_ENV });
      const id = await modeloLimpo(c);
      await posExplosao(c, id);
      expect(await status(c, id)).toBe("peca_teste");
      await c.query(`update cad set enviado_corte=false where modelo_id=$1`, [id]);
      expect(await status(c, id)).toBeNull();
    });
  });

  it("invariante #9 + DEFINER: fn_etapas_pl_entrada_cad sem EXECUTE para PUBLIC/anon/authenticated; gatilho por linha e habilitado", async () => {
    await withTx(async (c) => {
      for (const role of ["anon", "authenticated", "public"]) {
        const r = await um<{ ex: boolean }>(c, `select has_function_privilege('${role}','public.fn_etapas_pl_entrada_cad()','EXECUTE') ex`);
        expect(r.ex, `${role} nao deve executar fn_etapas_pl_entrada_cad`).toBe(false);
      }
      const f = await um<{ prosecdef: boolean; cfg: string }>(
        c,
        `select prosecdef, array_to_string(proconfig,'|') cfg from pg_proc where proname='fn_etapas_pl_entrada_cad' and pronamespace='public'::regnamespace`,
      );
      expect(f.prosecdef).toBe(true);
      expect(f.cfg).toBe("search_path=public");
      const t = await um<{ n: string }>(
        c,
        `select count(*)::text n from pg_trigger where tgrelid='public.cad'::regclass and tgname='trg_etapas_pl_entrada_cad'
            and tgenabled='O' and (tgtype & 1)=1 and not tgisinternal`,
      );
      expect(Number(t.n)).toBe(1);
    });
  });
});
