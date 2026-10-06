// Urgentes R9c (plan-c Task 3, migration 20261103194000_urg_r9_kanban_peca_teste): condição do kanban "Peça teste aprovada" —
// chave `peca_teste_aprovada` no mapa de `avaliar_condicoes_kanban` (redefine `_avaliar_condicoes_kanban_core` por troca exata
// sobre o texto da Mod T3, 394578c1), usando o predicado ÚNICO `_peca_teste_aprovada` da 193000 (tentativa atual aprovada E
// fornecedor congelado = o da linha). Cobre: (1) anti-drift SQL × TS pela fixture COMPARTILHADA; (2) catálogo × RPC; (3) kanban
// AUTOMÁTICO (fila/derivação: peça, M.O., switch); (4) kanban MANUAL (mapa da tela, gate por posição, `kanban_mover`, regressão do
// gatilho da 192000); (5) gate do Enviar à Explosão; (6) `_down` (recusa com a chave em uso; neutro; idempotência; LIFO).
// Txn revertida; o bloco é aplicado DENTRO da txn por aplicaUrgc (pula se já vivo na cópia). Só na cópia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, ehBancoLocal, withTx, um, semJwt, comoUsuario, TENANT_TESTE } from "./db";
import { aplicaUrgc, urgcViva, md5UrgcSucessor, URGC_BLOCOS } from "./urgc-helpers";
import { aplicarArquivo, semTransacao } from "./mig-txn";
import { MOD_MD5 } from "./mod-3-dados";
import { CASOS_PECA_TESTE, entradaDoCaso, type CasoPecaTeste } from "../fixtures/peca-teste-casos";
import { pecaTesteAprovadaModelo } from "../../src/lib/peca-teste";
import {
  CONDICAO_BY_KEY,
  CONDICAO_KEYS,
  REVENDA_COND_NA,
  condicoesForaDoModulo,
  requisitosOk,
} from "../../src/lib/kanban-condicoes";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RODA = hasDb && ehBancoLocal();
const BLOCO = URGC_BLOCOS.r9c;
const BLOCO_B = URGC_BLOCOS.r9b;
const T = TENANT_TESTE;
const CORE = "public._avaliar_condicoes_kanban_core(uuid,uuid[])";
const HELPER = "public._peca_teste_aprovada(uuid,uuid,uuid)";
const CHAVE = "peca_teste_aprovada";
const ANTES = "394578c15aecc303224356a554380de1";
const MOD3_DOWN = "supabase/rollback/20261103120000_mod_kanban_colecao_down.sql";
const D1 = "2026-10-01";
const D2 = "2026-10-03";

// ─────────────────────────────── helpers ───────────────────────────────
async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}
function readSemTxn(rel: string): string {
  return semTransacao(readFileSync(ROOT + rel, "utf8"), rel);
}
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<{ code?: string; message: string }> {
  await c.query("SAVEPOINT r9c_falha");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT r9c_falha");
    return e as { code?: string; message: string };
  }
  await c.query("ROLLBACK TO SAVEPOINT r9c_falha");
  throw new Error(`esperava erro e passou: ${sql.slice(0, 120)}`);
}
/** Escrita de PREPARAÇÃO que não deve acionar enfileirador/guarda do kanban. */
async function comoSistema<R>(c: Client, fn: () => Promise<R>): Promise<R> {
  await c.query("SELECT set_config('app.kanban_sistema', 'teste', true)");
  try {
    return await fn();
  } finally {
    await c.query("SELECT set_config('app.kanban_sistema', '', true)");
  }
}
/** Simula o COMMIT para os gatilhos adiados (fila do kanban) e volta ao modo adiado. */
async function imediato(c: Client): Promise<void> {
  await c.query("SET CONSTRAINTS ALL IMMEDIATE");
  await c.query("SET CONSTRAINTS ALL DEFERRED");
}
/** Liga/desliga a chave do kanban automático como a RPC `kanban_definir_automatico` (GUC `app.kanban_chave='rpc'`). */
async function chave(c: Client, ligada: boolean): Promise<void> {
  await c.query("SELECT set_config('app.kanban_chave', 'rpc', true)");
  try {
    await c.query("UPDATE public.tenant_config SET kanban_automatico = $2 WHERE tenant_id = $1", [T, ligada]);
  } finally {
    await c.query("SELECT set_config('app.kanban_chave', '', true)");
  }
}

type Fx = { suf: string; catExige: string; catSem: string; F1: string; F2: string };
/** Bloco aplicado na txn, JWT do super admin da Loja Teste, módulos ligados (sem claims: MOD-1) e o cadastro sintético. */
async function prepara(c: Client): Promise<Fx> {
  await c.query("SET LOCAL statement_timeout = '180s'");
  await aplicaUrgc(c);
  await semJwt(c, () =>
    c.query(
      `UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb)
         || '{"criacao": true, "producao": true, "entrada_saida": true}'::jsonb WHERE tenant_id = $1`,
      [T],
    ),
  );
  await comoUsuario(c);
  const suf = Math.random().toString(36).slice(2, 8);
  const cat = async (nome: string, ordem: number, exige: boolean) =>
    (
      await um<{ id: string }>(
        c,
        `INSERT INTO public.categorias_terceirizado (tenant_id, nome, etapa, ordem, exige_peca_teste)
         VALUES ($1, $2, 'ate_costura', $3, $4) RETURNING id`,
        [T, `${nome} R9c ${suf}`, ordem, exige],
      )
    ).id;
  const emp = async (nome: string) =>
    (
      await um<{ id: string }>(
        c,
        "INSERT INTO public.empresas (tenant_id, nome_fantasia, tipo) VALUES ($1, $2, 'servico') RETURNING id",
        [T, `${nome} R9c ${suf}`],
      )
    ).id;
  return {
    suf,
    catExige: await cat("PL", 9101, true),
    catSem: await cat("Lavanderia", 9102, false),
    F1: await emp("Oficina 1"),
    F2: await emp("Oficina 2"),
  };
}
async function novoModelo(c: Client, nome: string): Promise<string> {
  return comoSistema(c, async () =>
    (
      await um<{ id: string }>(
        c,
        `INSERT INTO public.modelos (tenant_id, nome, ordem_criacao_enviada, status_desenvolvimento)
         VALUES ($1, $2, true, 'entrada') RETURNING id`,
        [T, nome],
      )
    ).id,
  );
}
/** Linha de M.O. (JWT do super admin: `aprovado` exige `producao_servico_aprovacao`). */
async function novaLinha(c: Client, modelo: string, cat: string | null, emp: string | null, aprovado: boolean | null): Promise<string> {
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, empresa_id, aprovado, motivo_reprovacao)
       VALUES ($1, $2, $3, 10, $4, $5, CASE WHEN $5 IS FALSE THEN 'teste R9c' END) RETURNING id`,
      [T, modelo, cat, emp, aprovado],
    )
  ).id;
}
/** Tentativa semeada DIRETO (só a fixture: o caminho normal é o `salvar_peca_teste`). Decisão com as 2 datas (CHECK da tabela). */
async function novaTentativa(
  c: Client,
  modelo: string,
  linha: string,
  cat: string,
  numero: number,
  aprovacao: string | null,
  emp: string | null,
): Promise<void> {
  await c.query(
    `INSERT INTO public.modelo_peca_teste_tentativas
       (tenant_id, modelo_id, mo_linha_id, categoria_terceirizado_id, numero, empresa_id, data_saida, data_entrada, aprovacao, decidido_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, CASE WHEN $8::text IS NOT NULL THEN $9::date END, $8::text,
             CASE WHEN $8::text IS NOT NULL THEN now() END)`,
    [T, modelo, linha, cat, numero, emp, D1, aprovacao, D2],
  );
}
async function semeiaCaso(c: Client, fx: Fx, caso: CasoPecaTeste, i: number): Promise<string> {
  const m = await novoModelo(c, `PT R9c ${fx.suf} ${i}`);
  for (const l of caso.linhas) {
    const cat = l.tipo === "exige" ? fx.catExige : l.tipo === "sem_switch" ? fx.catSem : null;
    const linha = await novaLinha(c, m, cat, l.fornecedor ? fx[l.fornecedor] : null, l.mo_aprovado);
    if (l.tentativas.length && !cat) throw new Error(`fixture: tentativa em linha sem tipo (${caso.nome})`);
    for (const t of l.tentativas) await novaTentativa(c, m, linha, cat!, t.numero, t.aprovacao, t.fornecedor ? fx[t.fornecedor] : null);
  }
  return m;
}
async function mapa(c: Client, ids: string[]): Promise<Record<string, Record<string, boolean>>> {
  return (await um<{ j: Record<string, Record<string, boolean>> }>(c, "SELECT public.avaliar_condicoes_kanban($1::uuid[]) AS j", [ids])).j ?? {};
}
async function status(c: Client, id: string): Promise<{ status: string; erro: boolean }> {
  const r = await um<{ s: string; rp: Record<string, unknown> | null }>(
    c,
    "SELECT status_desenvolvimento AS s, revisao_pendente AS rp FROM public.modelos WHERE id = $1",
    [id],
  );
  return { status: r.s, erro: r.rp?.kanban === true };
}
/** Board sintético da Loja Teste: Entrada (manual) · Etapa A {ordem enviada} · Etapa B {peça teste aprovada} · Etapa C (manual).
 *  Envio à Explosão a partir da Etapa B. Chave DESLIGADA ao sair (ligar é explícito). */
async function board(c: Client): Promise<void> {
  await chave(c, false);
  await c.query(`DELETE FROM public.kanban_snapshot WHERE tenant_id = $1`, [T]);
  await c.query(`DELETE FROM public.kanban_recalculo_fila WHERE tenant_id = $1`, [T]);
  await c.query(
    `UPDATE public.tenant_config
        SET status_kanban = $2::jsonb, kanban_requisitos = $3::jsonb, kanban_requisitos_excecoes = '{}'::jsonb,
            revenda_kanban_colunas = '[]'::jsonb, revenda_kanban_requisitos = '{}'::jsonb,
            ref_exibir_status = 'etapa_b', explosao_envio_status = 'etapa_b'
      WHERE tenant_id = $1`,
    [T, JSON.stringify(["Entrada", "Etapa A", "Etapa B", "Etapa C"]), JSON.stringify({ etapa_a: ["ordem_criacao_enviada"], etapa_b: [CHAVE] })],
  );
}
async function aplicar(c: Client, ids: string[]): Promise<void> {
  await c.query("SELECT public._kanban_aplicar($1, $2::uuid[], 'auto')", [T, ids]);
}
type Tent = { id: string; rev: number; numero: number; aprovacao: string | null };
async function tentativas(c: Client, linha: string): Promise<Tent[]> {
  return (
    await c.query(
      `SELECT id, rev, numero, aprovacao FROM public.modelo_peca_teste_tentativas WHERE mo_linha_id = $1 ORDER BY numero`,
      [linha],
    )
  ).rows as Tent[];
}
/** Salvar da Peça Teste como o super admin (a tela que acabou de ler: base = rev atual de cada tentativa + fornecedor atual). */
async function salvarPeca(
  c: Client,
  modelo: string,
  linha: string,
  cat: string,
  tents: { id?: string; numero?: number; aprovacao: string | null }[],
): Promise<void> {
  const atuais = await tentativas(c, linha);
  const forn = (await um<{ e: string | null }>(c, "SELECT empresa_id AS e FROM public.modelo_servico_mo WHERE id = $1", [linha])).e;
  await c.query("SELECT public.salvar_peca_teste($1, $2::jsonb, $3::jsonb)", [
    modelo,
    JSON.stringify([
      {
        mo_linha_id: linha,
        categoria_id: cat,
        tentativas: tents.map((t) => ({ id: t.id ?? null, numero: t.numero, data_saida: D1, data_entrada: D2, aprovacao: t.aprovacao })),
      },
    ]),
    JSON.stringify({ tentativas: Object.fromEntries(atuais.map((t) => [t.id, t.rev])), fornecedor: { [linha]: forn } }),
  ]);
}

// ─────────────────────────────── contrato ───────────────────────────────
describe("urg R9c — contrato do gerador e catálogo", () => {
  it("bloco r9c em urgc-dados.ts: redefine SÓ o _avaliar_condicoes_kanban_core por cima do DEPOIS da Mod T3, sem função nova nem _down_drop", () => {
    expect(BLOCO, "bloco r9c em urgc-dados.ts").toBeDefined();
    expect(BLOCO!.mig).toBe("supabase/migrations/20261103194000_urg_r9_kanban_peca_teste.sql");
    expect(BLOCO!.down).toBe("supabase/rollback/20261103194000_urg_r9_kanban_peca_teste_down.sql");
    expect(BLOCO!.drop).toBeUndefined();
    expect(BLOCO!.URGC_SENTINELA).toBe(CORE);
    expect(Object.keys(BLOCO!.URGC_MD5)).toEqual([CORE]);
    expect(BLOCO!.URGC_MD5[CORE].antes).toBe(ANTES);
    expect(MOD_MD5[CORE].depois, "GC17: o ANTES daqui = o DEPOIS da Mod T3").toBe(ANTES);
    expect(BLOCO!.URGC_MD5[CORE].depois).not.toBe(ANTES);
    expect(BLOCO!.URGC_ACL[CORE]).toBe("{postgres=X/postgres,service_role=X/postgres}");
    expect(BLOCO!.URGC_NOVAS ?? {}).toEqual({});
    // o predicado ÚNICO da 193000 é dependência FIXADA (não reimplementado)
    expect(BLOCO!.URGC_DEPS?.[HELPER]).toBe(BLOCO_B!.URGC_NOVAS![HELPER]);
    // cadeia de sucessores: pino antigo (394578c1) aceita o depois da r9c
    expect(md5UrgcSucessor(CORE, ANTES)).toEqual([ANTES, BLOCO!.URGC_MD5[CORE].depois]);
  });

  it("catálogo TS: 'Peça teste aprovada', Planejamento, sem seção/requer, fora do REVENDA_COND_NA, logo depois de servico_mo_preenchido", () => {
    const c = CONDICAO_BY_KEY.get(CHAVE);
    expect(c).toMatchObject({ key: CHAVE, label: "Peça teste aprovada", modulo: "planejamento" });
    expect(c!.descricao).toBe("Todo serviço da mão de obra cujo tipo exige peça teste tem a M.O. aprovada E a peça teste aprovada.");
    expect(c!.aviso).toBe("Modelo sem serviço que exige peça teste conta como cumprido.");
    expect(c!.secao).toBeUndefined();
    expect(c!.requer).toBeUndefined();
    expect(REVENDA_COND_NA).not.toContain(CHAVE);
    expect(CONDICAO_KEYS.indexOf(CHAVE)).toBe(CONDICAO_KEYS.indexOf("servico_mo_preenchido") + 1);
    expect(condicoesForaDoModulo({ criacao: false, producao: false, entrada_saida: false }).has(CHAVE)).toBe(false);
  });
});

describe.skipIf(!RODA)("urg R9c — condição Peça teste aprovada (banco)", () => {
  // ─────────────── (1) anti-drift SQL × TS ───────────────
  it("1) anti-drift: cada caso da fixture semeado na txn — avaliar_condicoes_kanban->'peca_teste_aprovada' = pecaTesteAprovadaModelo = esperado", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const ids: string[] = [];
      for (const [i, caso] of CASOS_PECA_TESTE.entries()) ids.push(await semeiaCaso(c, fx, caso, i));
      const j = await mapa(c, ids);
      const sql = CASOS_PECA_TESTE.map((caso, i) => [caso.nome, j[ids[i]]?.[CHAVE]]);
      const ts = CASOS_PECA_TESTE.map((caso) => [caso.nome, pecaTesteAprovadaModelo(entradaDoCaso(caso, { F1: fx.F1, F2: fx.F2 }))]);
      const esperado = CASOS_PECA_TESTE.map((caso) => [caso.nome, caso.esperado]);
      expect(sql).toEqual(ts);
      expect(sql).toEqual(esperado);
      // o helper é a regra: mesma resposta linha a linha (núcleo da trilha)
      const viaHelper = await um<{ n: number }>(
        c,
        `SELECT count(*)::int AS n FROM public.modelo_servico_mo pm
           JOIN public.categorias_terceirizado pc ON pc.id = pm.categoria_terceirizado_id AND pc.exige_peca_teste
          WHERE pm.modelo_id = ANY($1::uuid[]) AND public._peca_teste_aprovada(pm.id, pm.categoria_terceirizado_id, pm.empresa_id)`,
        [ids],
      );
      expect(viaHelper.n).toBeGreaterThan(0);
    });
  });

  it("1b) o _avaliar_condicoes_kanban_core vivo cita o helper _peca_teste_aprovada e o switch exige_peca_teste (não reimplementa a trilha)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      expect(await urgcViva(c, "r9c")).toBe(true);
      const d = (await um<{ d: string }>(c, "SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [CORE])).d;
      expect(d).toContain("public._peca_teste_aprovada(pm.id, pm.categoria_terceirizado_id, pm.empresa_id)");
      expect(d).toContain("pc.exige_peca_teste");
      expect(d).not.toMatch(/modelo_peca_teste_tentativas/);
      // o mapa de módulos NÃO muda (a condição não exige módulo)
      expect((await um<{ t: boolean }>(c, "SELECT public._kanban_cond_modulos() ? $1 AS t", [CHAVE])).t).toBe(false);
      // ACL/secdef/search_path iguais aos de antes
      const p = await um<{ acl: string; sd: boolean; cfg: string[]; auth: boolean; anon: boolean }>(
        c,
        `SELECT p.proacl::text AS acl, p.prosecdef AS sd, p.proconfig AS cfg,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
           FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
        [CORE],
      );
      expect(p).toEqual({ acl: BLOCO!.URGC_ACL[CORE], sd: true, cfg: ["search_path=public"], auth: false, anon: false });
    });
  });

  // ─────────────── (3) kanban AUTOMÁTICO ───────────────
  it("3) automático: aprovar a peça → o card entra em Etapa B; desfazer/reprovar → sai; nova tentativa aprovada → volta", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      await board(c);
      await chave(c, true);
      const M = await novoModelo(c, `KA R9c ${fx.suf}`);
      const A = await novaLinha(c, M, fx.catExige, fx.F1, true);
      await novaLinha(c, M, fx.catSem, fx.F2, true);
      await aplicar(c, [M]);
      expect((await status(c, M)).status).toBe("etapa_a");
      await salvarPeca(c, M, A, fx.catExige, [{ numero: 1, aprovacao: "aprovado" }]);
      await imediato(c);
      expect((await status(c, M)).status).toBe("etapa_b");
      // desfazer a aprovação → sai (o recuo automático não acende #Erro)
      let t1 = (await tentativas(c, A))[0];
      await salvarPeca(c, M, A, fx.catExige, [{ id: t1.id, aprovacao: null }]);
      await imediato(c);
      expect(await status(c, M)).toEqual({ status: "etapa_a", erro: false });
      // aprovar de novo → entra; reprovar → sai
      await salvarPeca(c, M, A, fx.catExige, [{ id: t1.id, aprovacao: "aprovado" }]);
      await imediato(c);
      expect((await status(c, M)).status).toBe("etapa_b");
      t1 = (await tentativas(c, A))[0];
      await salvarPeca(c, M, A, fx.catExige, [{ id: t1.id, aprovacao: "reprovado" }]);
      await imediato(c);
      expect((await status(c, M)).status).toBe("etapa_a");
      // 2ª tentativa aprovada → entra
      await salvarPeca(c, M, A, fx.catExige, [{ numero: 2, aprovacao: "aprovado" }]);
      await imediato(c);
      expect((await status(c, M)).status).toBe("etapa_b");
    });
  });

  it("3b) automático: aprovar a M.O. SEM a peça não entra; com a peça aprovada e a M.O. pendente, aprovar a M.O. faz entrar", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      await board(c);
      await chave(c, true);
      // card 1: M.O. pendente, sem peça → aprovar a M.O. → continua em Etapa A
      const M1 = await novoModelo(c, `KA1 R9c ${fx.suf}`);
      const A1 = await novaLinha(c, M1, fx.catExige, fx.F1, null);
      await aplicar(c, [M1]);
      await c.query("SELECT public.aprovar_servico_mo($1, $2, true, null)", [M1, A1]);
      await imediato(c);
      expect((await status(c, M1)).status).toBe("etapa_a");
      // card 2: peça aprovada com a M.O. pendente → não entra; aprovar a M.O. → entra
      const M2 = await novoModelo(c, `KA2 R9c ${fx.suf}`);
      const A2 = await novaLinha(c, M2, fx.catExige, fx.F1, null);
      await aplicar(c, [M2]);
      await salvarPeca(c, M2, A2, fx.catExige, [{ numero: 1, aprovacao: "aprovado" }]);
      await imediato(c);
      expect((await status(c, M2)).status).toBe("etapa_a");
      expect((await mapa(c, [M2]))[M2][CHAVE]).toBe(false);
      await c.query("SELECT public.aprovar_servico_mo($1, $2, true, null)", [M2, A2]);
      await imediato(c);
      expect((await status(c, M2)).status).toBe("etapa_b");
    });
  });

  it("3c) automático: ligar o switch de um tipo que o card usa enfileira a loja e o card SAI de Etapa B (a condição passa a falhar)", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      await board(c);
      await chave(c, true);
      const M = await novoModelo(c, `KA3 R9c ${fx.suf}`);
      const A = await novaLinha(c, M, fx.catExige, fx.F1, true);
      await novaLinha(c, M, fx.catSem, fx.F2, true);
      await aplicar(c, [M]);
      await salvarPeca(c, M, A, fx.catExige, [{ numero: 1, aprovacao: "aprovado" }]);
      await imediato(c);
      expect((await status(c, M)).status).toBe("etapa_b");
      await c.query("UPDATE public.categorias_terceirizado SET exige_peca_teste = true WHERE id = $1", [fx.catSem]);
      const naFila = await um<{ n: number }>(c, "SELECT count(*)::int AS n FROM public.kanban_recalculo_fila WHERE modelo_id = $1", [M]);
      expect(naFila.n, "o WHEN do trg_kanban_fila_upd (192000) enfileira a loja").toBe(1);
      await imediato(c);
      expect((await status(c, M)).status).toBe("etapa_a");
      // desligar de novo → volta
      await c.query("UPDATE public.categorias_terceirizado SET exige_peca_teste = false WHERE id = $1", [fx.catSem]);
      await imediato(c);
      expect((await status(c, M)).status).toBe("etapa_b");
    });
  });

  // ─────────────── (4) kanban MANUAL ───────────────
  it("4) manual: o mapa da tela recusa a Etapa B sem a peça e aceita com ela; o gate por posição (chave ligada) e o kanban_mover respeitam a condição", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      await board(c);
      const M = await novoModelo(c, `KM R9c ${fx.suf}`);
      const A = await novaLinha(c, M, fx.catExige, fx.F1, true);
      // modo manual: os requisitos de entrada valem na TELA (Select/arraste) — leem o mapa da RPC
      let r = requisitosOk([CHAVE], (await mapa(c, [M]))[M]);
      expect(r.ok).toBe(false);
      expect(r.faltando.map((x) => x.label)).toEqual(["Peça teste aprovada"]);
      // chave ligada: gate por posição = posição DERIVADA (Etapa A) e "Mover para…" Etapa B devolve o que falta
      await chave(c, true);
      await aplicar(c, [M]);
      expect((await um<{ g: string }>(c, "SELECT public._kanban_status_gate($1, $2, 'etapa_b') AS g", [T, M])).g).toBe("etapa_a");
      const mv = (await um<{ r: { acao: string; faltando: string[] } }>(c, "SELECT public.kanban_mover($1, 'etapa_b') AS r", [M])).r;
      expect(mv.faltando).toContain(CHAVE);
      expect((await status(c, M)).status).toBe("etapa_a");
      await salvarPeca(c, M, A, fx.catExige, [{ numero: 1, aprovacao: "aprovado" }]);
      await imediato(c);
      expect((await um<{ g: string }>(c, "SELECT public._kanban_status_gate($1, $2, 'etapa_b') AS g", [T, M])).g).toBe("etapa_b");
      await chave(c, false);
      r = requisitosOk([CHAVE], (await mapa(c, [M]))[M]);
      expect(r.ok).toBe(true);
    });
  });

  it("4b) manual: desfazer a aprovação com o card ADIANTE da Etapa B regride o card (gatilho da 192000) e acende #Erro", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      await board(c);
      const M = await novoModelo(c, `KM2 R9c ${fx.suf}`);
      const A = await novaLinha(c, M, fx.catExige, fx.F1, true);
      await salvarPeca(c, M, A, fx.catExige, [{ numero: 1, aprovacao: "aprovado" }]);
      await c.query("UPDATE public.modelos SET status_desenvolvimento = 'etapa_c' WHERE id = $1", [M]); // a pessoa move (manual)
      expect((await status(c, M)).status).toBe("etapa_c");
      const t1 = (await tentativas(c, A))[0];
      await salvarPeca(c, M, A, fx.catExige, [{ id: t1.id, aprovacao: null }]);
      expect(await status(c, M)).toEqual({ status: "etapa_b", erro: true });
    });
  });

  // ─────────────── (5) Enviar à Explosão ───────────────
  it("5) Enviar à Explosão (coluna de envio = Etapa B, exige a condição): recusa sem a peça; com a peça aprovada, libera", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      await board(c);
      await chave(c, true);
      const M = await novoModelo(c, `KE R9c ${fx.suf}`);
      const A = await novaLinha(c, M, fx.catExige, fx.F1, true);
      await aplicar(c, [M]);
      const e = await falha(c, "SELECT public.enviar_modelo_para_cad($1)", [M]);
      expect(e.code).toBe("P0001");
      expect(e.message).toMatch(/precisa estar na etapa "Etapa B"/);
      await salvarPeca(c, M, A, fx.catExige, [{ numero: 1, aprovacao: "aprovado" }]);
      await imediato(c);
      expect((await um<{ id: string }>(c, "SELECT public.enviar_modelo_para_cad($1) AS id", [M])).id).toBeTruthy();
    });
  });

  // ─────────────── (6) volta ───────────────
  it("6) _down: RECUSA com a chave em uso (requisitos, revenda ou exceções, qualquer nível); sem ela volta ao 394578c1; 2× no-op; ida 2× = mesmo md5", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const depois = BLOCO!.URGC_MD5[CORE].depois;
      expect(await md5Fn(c, CORE)).toBe(depois);
      const cfg = async (col: string, v: unknown) =>
        c.query(`UPDATE public.tenant_config SET ${col} = $2::jsonb WHERE tenant_id = $1`, [T, JSON.stringify(v)]);
      const RECUSA = /urg_r9c_down: peca_teste_aprovada em uso em .*37889b78-fffb-404b-8c75-18b7e50a1d9b.*; tire o requisito na Config da Loja antes/;
      const original = await um<{ k: unknown; r: unknown; e: unknown }>(
        c,
        "SELECT kanban_requisitos AS k, revenda_kanban_requisitos AS r, kanban_requisitos_excecoes AS e FROM public.tenant_config WHERE tenant_id = $1",
        [T],
      );
      await cfg("kanban_requisitos", { etapa_x: ["ordem_criacao_enviada", CHAVE] });
      expect((await falha(c, readSemTxn(BLOCO!.down))).message).toMatch(RECUSA);
      await cfg("kanban_requisitos", original.k ?? {});
      await cfg("revenda_kanban_requisitos", { etapa_y: [CHAVE] });
      expect((await falha(c, readSemTxn(BLOCO!.down))).message).toMatch(RECUSA);
      await cfg("revenda_kanban_requisitos", original.r ?? {});
      await cfg("kanban_requisitos_excecoes", { etapa_z: [CHAVE] });
      expect((await falha(c, readSemTxn(BLOCO!.down))).message).toMatch(RECUSA);
      await cfg("kanban_requisitos_excecoes", original.e ?? {});
      expect(await md5Fn(c, CORE), "a recusa não mudou nada").toBe(depois);
      // sem a chave em uso (em NENHUMA loja): volta ao texto da Mod T3
      const outras = await um<{ n: number }>(
        c,
        `SELECT count(*)::int AS n FROM public.tenant_config
          WHERE coalesce(kanban_requisitos::text, '') LIKE '%"peca_teste_aprovada"%'
             OR coalesce(revenda_kanban_requisitos::text, '') LIKE '%"peca_teste_aprovada"%'
             OR coalesce(kanban_requisitos_excecoes::text, '') LIKE '%"peca_teste_aprovada"%'`,
      );
      expect(outras.n).toBe(0);
      await aplicarArquivo(c, BLOCO!.down);
      expect(await md5Fn(c, CORE)).toBe(ANTES);
      expect(await urgcViva(c, "r9c")).toBe(false);
      const um1 = (await um<{ id: string }>(c, "SELECT id FROM public.modelos WHERE tenant_id = $1 ORDER BY id LIMIT 1", [T])).id;
      expect(CHAVE in (await mapa(c, [um1]))[um1], "sem a chave no mapa depois do _down").toBe(false);
      await aplicarArquivo(c, BLOCO!.down); // 2× = no-op
      expect(await md5Fn(c, CORE)).toBe(ANTES);
      for (let i = 0; i < 2; i++) {
        await aplicarArquivo(c, BLOCO!.mig);
        await c.query("SET LOCAL transaction_timeout = 0");
        expect(await md5Fn(c, CORE)).toBe(depois);
      }
      expect((await um<{ a: string }>(c, "SELECT proacl::text AS a FROM pg_proc WHERE oid = to_regprocedure($1)", [CORE])).a).toBe(
        BLOCO!.URGC_ACL[CORE],
      );
    });
  });

  it("6b) LIFO: com a r9c viva o _down da Mod T3 recusa e o _down_drop da r9b recusa (o core cita o helper); depois do _down da r9c, passam", async () => {
    await withTx(async (c) => {
      await prepara(c);
      expect((await falha(c, readSemTxn(MOD3_DOWN))).message).toMatch(/_avaliar_condicoes_kanban_core.* com texto inesperado/);
      await aplicarArquivo(c, BLOCO_B!.down);
      expect((await falha(c, readSemTxn(BLOCO_B!.drop!))).message).toMatch(
        /urg_r9b_down_drop: funcoes ainda citam as da 20261103193000: .*_avaliar_condicoes_kanban_core/,
      );
      await aplicarArquivo(c, BLOCO!.down);
      await aplicarArquivo(c, BLOCO_B!.drop!);
      expect(await md5Fn(c, HELPER)).toBeNull();
      // a ida da r9c recusa sem o helper (dependência FIXADA)
      expect((await falha(c, readSemTxn(BLOCO!.mig))).message).toMatch(/urg_r9c: dependencia public\._peca_teste_aprovada\(uuid,uuid,uuid\) com texto inesperado \(md5 ausente\)/);
    });
  });
});
