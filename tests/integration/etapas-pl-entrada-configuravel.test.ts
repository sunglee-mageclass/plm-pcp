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
 * Como o gatilho so escuta M.O. e categoria, os casos que mudam OUTRA fonte (cad.enviado_corte) chamam o helper direto
 * (a conexao e superusuario local; o helper e DEFINER sem EXECUTE p/ authenticated).
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

/** Poe o modelo "pos-Explosao": cad com enviado_corte = true (atualiza o existente ou cria). Nao dispara a entrada. */
async function posExplosao(c: Client, modeloId: string): Promise<void> {
  const up = await c.query(`update cad set enviado_corte=true where modelo_id=$1`, [modeloId]);
  if (!up.rowCount) await c.query(`insert into cad (tenant_id, modelo_id, enviado_corte) values ($1,$2,true)`, [T, modeloId]);
}

/** O gatilho so escuta M.O./categoria; para outras fontes (cad) reavalia chamando o helper (DEFINER, conexao local). */
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
