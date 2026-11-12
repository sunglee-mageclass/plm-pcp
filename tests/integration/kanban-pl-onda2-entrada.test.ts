/**
 * Kanban PL configuravel - Onda 2, Task 7 (fn_etapas_pl_entrada + _etapas_pl_entrada_avaliar + gatilhos
 * trg_etapas_pl_entrada_mo / trg_etapas_pl_entrada_cat): ENTRADA/SAIDA do card no PL pela trilha de peca teste.
 *
 * SO BANCO; `etapas_pl_automatico` default false. Tudo em BEGIN...ROLLBACK (`withTx`) e SO na copia local
 * (`ehBancoLocal`): a migration 20261127140000_etapas_pl_entrada.sql e aplicada no banco ANTES da suite (gate `psql -f`),
 * e cada teste roda contra o estado vivo numa txn revertida. NUNCA `\i` migration em txn de teste (incidente 15/set);
 * DDL so na copia local (incidente 23/set). Testes que dependem do processador da fila no COMMIT usam
 * `SET CONSTRAINTS ALL IMMEDIATE`.
 *
 * Board dos testes: ["Peça Teste","Separação de Materiais","Oficina"] -> 1a etapa = peca_teste.
 * Onda 3 (Task 2): a entrada passou a ser o REQUISITO da 1a coluna; este arquivo fixa a 1a coluna = tem_peca_teste (o que o
 * seed da Task 3 grava), preservando a semantica da Onda 2. A entrada configuravel esta em etapas-pl-entrada-configuravel.test.ts.
 * O teste semeia a propria categoria (exige_peca_teste) e limpa as M.O./CAD do modelo escolhido (txn revertida).
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, um, comoUsuario, ehBancoLocal, TENANT_TESTE } from "./db";

const T = TENANT_TESTE;
const BOARD = `'["Peça Teste","Separação de Materiais","Oficina"]'::jsonb`;

/** Config da loja: modulo etapas_pl ligado/desligado (sem JWT: MOD-1 so barra chamada com claims) + board. */
async function config(c: Client, opts: { modulo?: boolean; board?: string; automatico?: boolean } = {}): Promise<void> {
  const { modulo = true, board = BOARD, automatico = false } = opts;
  await c.query(
    `update tenant_config
        set modules = coalesce(modules, '{}'::jsonb) || jsonb_build_object('etapas_pl', $2::boolean),
            etapas_pl_kanban = ${board}, etapas_pl_requisitos = '{"peca_teste":["tem_peca_teste"]}'::jsonb, etapas_pl_automatico = $3
      where tenant_id = $1`,
    [T, modulo, automatico],
  );
}

/** Config (sem JWT) e DEPOIS o usuario da loja (apagar M.O. pendente exige permissao; MOD-1 barra `modules` com JWT). */
async function preparar(c: Client, opts: { modulo?: boolean; board?: string; automatico?: boolean } = {}): Promise<void> {
  await config(c, opts);
  await comoUsuario(c);
}

/** Modelo da loja "limpo": sem M.O., sem CAD enviado, fora do PL (escrita de sistema para nao passar pelo guard). */
async function modeloLimpo(c: Client): Promise<string> {
  const m = await um<{ id: string }>(c, `select id from modelos where tenant_id=$1 order by id limit 1`, [T]);
  await c.query(`delete from modelo_servico_mo where modelo_id=$1`, [m.id]);
  await c.query(`update cad set enviado_corte=false where modelo_id=$1`, [m.id]);
  await c.query(`select set_config('app.etapas_pl_sistema','preparo', true)`);
  await c.query(`update modelos set status_etapa_pl=null where id=$1`, [m.id]);
  await c.query(`select set_config('app.etapas_pl_sistema','', true)`);
  await c.query(`delete from etapas_pl_recalculo_fila where modelo_id=$1`, [m.id]);
  return m.id;
}

async function categoria(c: Client, exige: boolean): Promise<string> {
  const r = await um<{ id: string }>(
    c,
    `insert into categorias_terceirizado (tenant_id, nome, exige_peca_teste) values ($1, $2, $3) returning id`,
    [T, `T7 ${Math.random().toString(36).slice(2)}`, exige],
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

async function primeiraEtapa(c: Client): Promise<string> {
  const r = await um<{ e: string }>(
    c,
    `select (_kanban_fluxo(jsonb_build_object('status_kanban', coalesce(_etapas_pl_cfg($1) -> 'etapas_pl_kanban','[]'::jsonb)), false))[1] e`,
    [T],
  );
  return r.e;
}

/** Poe o modelo "pos-Explosao": cad com enviado_corte = true (atualiza o existente ou cria). */
async function posExplosao(c: Client, modeloId: string): Promise<void> {
  const up = await c.query(`update cad set enviado_corte=true where modelo_id=$1`, [modeloId]);
  if (!up.rowCount) await c.query(`insert into cad (tenant_id, modelo_id, enviado_corte) values ($1,$2,true)`, [T, modeloId]);
}

describe.skipIf(!hasDb || !ehBancoLocal())("Kanban PL Onda 2 - entrada/saida pela peca teste (Task 7)", () => {
  it("ganhar trilha de peca teste poe o card na 1a etapa do board PL", async () => {
    await withTx(async (c) => {
      await preparar(c);
      const id = await modeloLimpo(c);
      const cat = await categoria(c, true);
      expect(await primeiraEtapa(c)).toBe("peca_teste");
      expect(await status(c, id)).toBeNull();
      await linhaMo(c, id, cat);
      expect(await status(c, id)).toBe("peca_teste");
      // historico com origem 'auto' (escrita do sistema)
      const h = await um<{ origem: string }>(
        c,
        `select origem from modelo_etapa_pl_historico where modelo_id=$1 order by created_at desc limit 1`,
        [id],
      );
      expect(h.origem).toBe("auto");
    });
  });

  it("categoria SEM exige_peca_teste nao faz o card entrar; linha 'Geral (legado)' (sem categoria) tambem nao", async () => {
    await withTx(async (c) => {
      await preparar(c);
      const id = await modeloLimpo(c);
      await linhaMo(c, id, await categoria(c, false));
      await linhaMo(c, id, null);
      expect(await status(c, id)).toBeNull();
    });
  });

  it("remover a ultima trilha PRE-Explosao tira o card do PL (NULL)", async () => {
    await withTx(async (c) => {
      await preparar(c);
      const id = await modeloLimpo(c);
      const cat = await categoria(c, true);
      const linha = await linhaMo(c, id, cat);
      expect(await status(c, id)).toBe("peca_teste");
      await c.query(`delete from modelo_servico_mo where id=$1`, [linha]);
      expect(await status(c, id)).toBeNull();
    });
  });

  it("remover so UMA de duas trilhas mantem o card no PL, na etapa em que estava", async () => {
    await withTx(async (c) => {
      await preparar(c);
      const id = await modeloLimpo(c);
      const cat1 = await categoria(c, true);
      const cat2 = await categoria(c, true);
      const l1 = await linhaMo(c, id, cat1);
      await linhaMo(c, id, cat2);
      await c.query(`select set_config('app.etapas_pl_sistema','preparo', true)`);
      await c.query(`update modelos set status_etapa_pl='oficina' where id=$1`, [id]);
      await c.query(`select set_config('app.etapas_pl_sistema','', true)`);
      await c.query(`delete from modelo_servico_mo where id=$1`, [l1]);
      expect(await status(c, id)).toBe("oficina");
    });
  });

  it("a mesma remocao POS-Explosao (cad.enviado_corte) NAO tira o card do PL", async () => {
    await withTx(async (c) => {
      await preparar(c);
      const id = await modeloLimpo(c);
      const cat = await categoria(c, true);
      const linha = await linhaMo(c, id, cat);
      expect(await status(c, id)).toBe("peca_teste");
      await posExplosao(c, id);
      await c.query(`delete from modelo_servico_mo where id=$1`, [linha]);
      expect(await status(c, id)).toBe("peca_teste"); // permanece
    });
  });

  it("trocar a categoria da linha de uma com peca teste para uma sem tira o card; voltar o recoloca", async () => {
    await withTx(async (c) => {
      await preparar(c);
      const id = await modeloLimpo(c);
      const catPt = await categoria(c, true);
      const catSem = await categoria(c, false);
      const linha = await linhaMo(c, id, catPt);
      expect(await status(c, id)).toBe("peca_teste");
      await c.query(`update modelo_servico_mo set categoria_terceirizado_id=$2 where id=$1`, [linha, catSem]);
      expect(await status(c, id)).toBeNull();
      await c.query(`update modelo_servico_mo set categoria_terceirizado_id=$2 where id=$1`, [linha, catPt]);
      expect(await status(c, id)).toBe("peca_teste");
    });
  });

  it("UPDATE que nao muda a categoria (so o valor) nao mexe no card (nao volta a 1a etapa)", async () => {
    await withTx(async (c) => {
      await preparar(c);
      const id = await modeloLimpo(c);
      const cat = await categoria(c, true);
      const linha = await linhaMo(c, id, cat);
      await c.query(`select set_config('app.etapas_pl_sistema','preparo', true)`);
      await c.query(`update modelos set status_etapa_pl='oficina' where id=$1`, [id]);
      await c.query(`select set_config('app.etapas_pl_sistema','', true)`);
      // o Salvar da M.O. regrava categoria_terceirizado_id (mesmo valor): nao pode resetar a etapa
      await c.query(`update modelo_servico_mo set valor=10, categoria_terceirizado_id=$2 where id=$1`, [linha, cat]);
      expect(await status(c, id)).toBe("oficina");
    });
  });

  it("ligar exige_peca_teste numa categoria ja usada faz o modelo entrar no PL (e desligar, sair)", async () => {
    await withTx(async (c) => {
      await preparar(c);
      const id = await modeloLimpo(c);
      const cat = await categoria(c, false);
      await linhaMo(c, id, cat);
      expect(await status(c, id)).toBeNull();
      await c.query(`update categorias_terceirizado set exige_peca_teste=true where id=$1`, [cat]);
      expect(await status(c, id)).toBe("peca_teste");
      await c.query(`update categorias_terceirizado set exige_peca_teste=false where id=$1`, [cat]);
      expect(await status(c, id)).toBeNull();
    });
  });

  it("desligar a flag da categoria PLUS pos-Explosao: o card fica", async () => {
    await withTx(async (c) => {
      await preparar(c);
      const id = await modeloLimpo(c);
      const cat = await categoria(c, true);
      await linhaMo(c, id, cat);
      expect(await status(c, id)).toBe("peca_teste");
      await posExplosao(c, id);
      await c.query(`update categorias_terceirizado set exige_peca_teste=false where id=$1`, [cat]);
      expect(await status(c, id)).toBe("peca_teste");
    });
  });

  it("board PL VAZIO: ganhar trilha NAO entra (fluxo vazio, nada grava)", async () => {
    await withTx(async (c) => {
      await preparar(c, { board: `'[]'::jsonb` });
      const id = await modeloLimpo(c);
      const cat = await categoria(c, true);
      await linhaMo(c, id, cat);
      expect(await status(c, id)).toBeNull();
      const h = await um<{ n: string }>(c, `select count(*)::text n from modelo_etapa_pl_historico where modelo_id=$1`, [id]);
      expect(Number(h.n)).toBe(0);
    });
  });

  it("board com 1a etapa de nome em branco (['']) NAO entra (nao grava status vazio)", async () => {
    await withTx(async (c) => {
      await preparar(c, { board: `'[""]'::jsonb` });
      const id = await modeloLimpo(c);
      const cat = await categoria(c, true);
      await linhaMo(c, id, cat);
      expect(await status(c, id)).toBeNull();
      const h = await um<{ n: string }>(c, `select count(*)::text n from modelo_etapa_pl_historico where modelo_id=$1`, [id]);
      expect(Number(h.n)).toBe(0);
    });
  });

  it("loja SEM o modulo etapas_pl: ganhar trilha NAO entra", async () => {
    await withTx(async (c) => {
      await preparar(c, { modulo: false });
      const id = await modeloLimpo(c);
      const cat = await categoria(c, true);
      await linhaMo(c, id, cat);
      expect(await status(c, id)).toBeNull();
    });
  });

  it("chave ligada: a ENTRADA enfileira e o COMMIT (SET CONSTRAINTS ALL IMMEDIATE) re-deriva sem recursao", async () => {
    await withTx(async (c) => {
      await preparar(c, { automatico: true });
      const id = await modeloLimpo(c);
      const cat = await categoria(c, true);
      await linhaMo(c, id, cat);
      expect(await status(c, id)).toBe("peca_teste");
      const fila = await um<{ n: string }>(c, `select count(*)::text n from etapas_pl_recalculo_fila where modelo_id=$1`, [id]);
      expect(Number(fila.n)).toBe(1); // enfileirado explicitamente (a GUC cortou as enfileiradoras)
      await c.query(`set constraints all immediate`); // processador adiado
      const fila2 = await um<{ n: string }>(c, `select count(*)::text n from etapas_pl_recalculo_fila where modelo_id=$1`, [id]);
      expect(Number(fila2.n)).toBe(0);
      expect(await status(c, id)).not.toBeNull(); // segue no PL (derivado)
    });
  });

  it("chave desligada: a ENTRADA nao enfileira (inerte)", async () => {
    await withTx(async (c) => {
      await preparar(c, { automatico: false });
      const id = await modeloLimpo(c);
      const cat = await categoria(c, true);
      await linhaMo(c, id, cat);
      expect(await status(c, id)).toBe("peca_teste");
      const fila = await um<{ n: string }>(c, `select count(*)::text n from etapas_pl_recalculo_fila where modelo_id=$1`, [id]);
      expect(Number(fila.n)).toBe(0);
    });
  });

  it("a GUC app.etapas_pl_sistema e RESTAURADA depois da escrita do sistema", async () => {
    await withTx(async (c) => {
      await preparar(c);
      const id = await modeloLimpo(c);
      const cat = await categoria(c, true);
      await c.query(`select set_config('app.etapas_pl_sistema','', true)`);
      await linhaMo(c, id, cat);
      const g = await um<{ v: string }>(c, `select coalesce(current_setting('app.etapas_pl_sistema', true),'') v`);
      expect(g.v).toBe("");
    });
  });

  it("excluir o modelo (cascata das linhas de M.O.) nao quebra", async () => {
    await withTx(async (c) => {
      await preparar(c);
      const id = await modeloLimpo(c);
      const cat = await categoria(c, true);
      await linhaMo(c, id, cat);
      // o gatilho roda na cascata com o modelo ja removido: o helper acha 0 linhas e sai
      await c.query(`savepoint s_del`);
      let erro: any = null;
      try {
        await c.query(`delete from modelos where id=$1`, [id]);
      } catch (e) {
        erro = e; // outras FKs do modelo podem barrar a exclusao (nao e o objeto do teste)
      }
      await c.query(`rollback to savepoint s_del`);
      if (erro) expect(String(erro.message)).not.toMatch(/etapas_pl_entrada/);
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

  it("DEFINER + search_path=public; gatilhos POR LINHA, habilitados", async () => {
    await withTx(async (c) => {
      const f = await c.query(
        `select proname, prosecdef, array_to_string(proconfig,'|') cfg from pg_proc
          where proname in ('fn_etapas_pl_entrada','_etapas_pl_entrada_avaliar') and pronamespace='public'::regnamespace order by 1`,
      );
      expect(f.rows.length).toBe(2);
      for (const r of f.rows) {
        expect(r.prosecdef).toBe(true);
        expect(r.cfg).toBe("search_path=public");
      }
      const t = await c.query(
        `select tgname, tgenabled, (tgtype & 1) = 1 por_linha from pg_trigger
          where tgname in ('trg_etapas_pl_entrada_mo','trg_etapas_pl_entrada_cat') and not tgisinternal order by 1`,
      );
      expect(t.rows.length).toBe(2);
      for (const r of t.rows) {
        expect(r.tgenabled).toBe("O");
        expect(r.por_linha).toBe(true);
      }
    });
  });
});
