// Salvar único do Planejamento — Task 2: teste de integração da RPC `salvar_card_planejamento` (migration 20261108100000).
// A RPC é o núcleo ATÔMICO do Salvar do Sheet do Planejamento: portões de módulo/página, trava otimista (`_rev_base`, FOR UPDATE, P0409),
// cabeçalho por lista fechada e os `_core` de BOM / insumos / CAD / M.O. / grade da revenda / #Erro numa só transação.
//
// TUDO em BEGIN…ROLLBACK (padrão de `withTx`), SÓ na cópia local (`ehBancoLocal`): nada é gravado de verdade. Os casos 1–10 rodam a RPC como
// o papel `authenticated` (SET LOCAL ROLE, como o PostgREST) com JWT de usuários COMUNS criados na txn e permissões por página explícitas
// (padrão de `seg-s3c.test.ts`). O caso 11 (deadlock) usa 2 conexões REAIS, as duas revertidas (padrão de `urgb-r4-servicos-da-mo.test.ts`).
//
// Paridade (casos 1 e 2): o card X é salvo pela RPC nova e um card GÊMEO Y (mesma semente) pela CADEIA ANTIGA que a tela fazia
// (UPDATE do cabeçalho + salvar_modelo_bom + salvar_modelo_servico_mo + salvar_cad_completo + marcar_revisao_por_mudanca); as duas
// fotografias (sem ids) têm de ser IGUAIS.
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import type { Client as PgClient } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, dbUrl, TENANT_TESTE, USER_TESTE } from "./db";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const SUPER = USER_TESTE;
// usuários COMUNS desta suíte (criados na txn; uuids próprios)
const U_EDIT = "5ca4d000-0000-4000-8000-0000000000e1"; // edita Planejamento + Desenvolvimento e vê custos
const U_NADA = "5ca4d000-0000-4000-8000-0000000000e2"; // nenhuma permissão de edição
const U_DEV = "5ca4d000-0000-4000-8000-0000000000e3"; // só Desenvolvimento
const U_PLAN = "5ca4d000-0000-4000-8000-0000000000e4"; // só Planejamento
const U_VER = "5ca4d000-0000-4000-8000-0000000000e5"; // só VER as duas páginas
const PLAN = "criacao_planejamento";
const DEV = "criacao_desenvolvimento";
const CUSTOS: [string, boolean] = ["criacao_planejamento:custos", false];
const RAND = "5ca4d000-0000-4000-8000-00000000dead"; // id que não existe

// ───────────────────────────────────────────── infraestrutura de chamada ─────────────────────────────────────────────
type Res = { ok: true; rows: any[] } | { ok: false; code: string; msg: string };
/** Roda `sql` como o papel `role` (PostgREST real) num SAVEPOINT; erro volta ao savepoint (= a txn de uma requisição que falhou). */
async function como(c: PgClient, role: "authenticated" | "anon" | null, sql: string, params: any[] = []): Promise<Res> {
  await c.query("SAVEPOINT scp_z");
  try {
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    const r = await c.query(sql, params);
    if (role) await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT scp_z");
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT scp_z");
    await c.query("RELEASE SAVEPOINT scp_z");
    return { ok: false, code: String(e.code ?? ""), msg: String(e.message ?? "") };
  }
}
const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);
async function jwt(c: PgClient, uid: string | null): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : ""]);
}
async function usuario(c: PgClient, uid: string): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'SCP comum', 'user')
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [uid, T, `${uid}@teste`],
  );
}
/** Permissões por página do usuário: TROCA todas as de antes pelas dadas ([pagina, editar]); `pode_ver` sempre true. */
async function perms(c: PgClient, uid: string, lista: [string, boolean][]): Promise<void> {
  await semJwt(c, async () => {
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [uid]);
    for (const [pagina, editar] of lista) {
      await c.query(
        `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, true, $4)`,
        [uid, T, pagina, editar],
      );
    }
  });
}
const edita = (...ps: string[]): [string, boolean][] => ps.map((p) => [p, true]);
async function modulo(c: PgClient, chave: string, ligado: boolean): Promise<void> {
  await semJwt(c, () =>
    c.query(
      `UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || jsonb_build_object($2::text, $3::boolean) WHERE tenant_id = $1`,
      [T, chave, ligado],
    ),
  );
}
async function prepara(c: PgClient): Promise<void> {
  await c.query("SET LOCAL statement_timeout = '120s'");
  await jwt(c, null);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, SUPER]);
  for (const u of [U_EDIT, U_NADA, U_DEV, U_PLAN, U_VER]) await usuario(c, u);
  for (const m of ["criacao", "entrada_saida", "produto_acabado"]) await modulo(c, m, true);
  await perms(c, U_EDIT, [...edita(PLAN, DEV), CUSTOS]);
  await perms(c, U_NADA, edita("producao_terceirizados", "entrada_oc_tecido")); // permissões de OUTRAS áreas
  await perms(c, U_DEV, [...edita(DEV), CUSTOS]);
  await perms(c, U_PLAN, [...edita(PLAN), CUSTOS]);
  await perms(c, U_VER, [[PLAN, false], [DEV, false], CUSTOS]);
  await jwt(c, U_EDIT);
}

// ───────────────────────────────────────────── a RPC e seus blocos ─────────────────────────────────────────────
type P = {
  header?: any; rev?: number | null; bom?: any; etiquetas?: any; cad?: any; mo?: any; gradeRevenda?: any; revisao?: any; flags?: any;
};
const j = (v: any) => (v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(v));
const SQL_RPC = `select public.salvar_card_planejamento($1::uuid, $2::jsonb, $3::int, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb) as r`;
const argsRpc = (m: string, p: P) => [m, j(p.header), p.rev ?? null, j(p.bom), j(p.etiquetas), j(p.cad), j(p.mo), j(p.gradeRevenda), j(p.revisao), j(p.flags)];
/** Chama a RPC como `authenticated` com o JWT já definido (`jwt`). */
const salva = (c: PgClient, m: string, p: P): Promise<Res> => como(c, "authenticated", SQL_RPC, argsRpc(m, p));
/**
 * Chama a RPC no NÍVEL DE TOPO da txn (sem SAVEPOINT), como UMA requisição do PostgREST. É assim que se mede o DELTA de `rev`: o `rev` do card
 * só sobe 1× por transação nas filhas porque os gatilhos `fn_colab_bump_*` comparam o `xmin` do card com o xid de TOPO (T5/B2 do CLAUDE.md,
 * limites (i) e (iii)) - dentro de um SAVEPOINT (o `salva`/`como`) o DELETE de cada linha do BOM bumparia 1 por linha e o delta mediria o
 * harness, não a RPC. O papel não importa (a RPC é DEFINER; o portão lê o JWT, não o papel). Só para caminho de SUCESSO (erro aborta a txn).
 */
async function salvaTopo(c: PgClient, m: string, p: P): Promise<any> {
  return (await c.query(SQL_RPC, argsRpc(m, p))).rows[0].r;
}
async function salvaOk(c: PgClient, m: string, p: P): Promise<any> {
  const r = await salva(c, m, p);
  if (!r.ok) throw new Error(`esperava passar: ${r.code} ${r.msg}`);
  return r.rows[0].r;
}
const rev = async (c: PgClient, m: string): Promise<number> => (await um<{ rev: number }>(c, `select rev from modelos where id = $1`, [m])).rev;

// ───────────────────────────────────────────── fixture (como postgres, sem JWT) ─────────────────────────────────────────────
type Fx = {
  art1: string; v1a: string; v1b: string; v1c: string; art2: string; v2a: string; avi1: string; avi2: string;
  etq: string[]; cor: string; catServ: string; catServ2: string;
  outra: string; artOutra: string; catOutra: string; modeloOutraComBom: string; modeloOutraSemBom: string;
};
async function fixture(c: PgClient): Promise<Fx> {
  return semJwt(c, async () => {
    const id = async (sql: string, p: any[]) => (await um<{ id: string }>(c, sql, p)).id;
    const outra = await id(`select id from tenants where id <> $1 order by id limit 1`, [T]);
    const art1 = await id(`insert into artigos (tenant_id, nome, unidade_medida, preco) values ($1, 'ITEST SCP tecido 1', 'metro', 10) returning id`, [T]);
    const art2 = await id(`insert into artigos (tenant_id, nome, unidade_medida, preco) values ($1, 'ITEST SCP tecido 2', 'metro', 20) returning id`, [T]);
    const vt = (a: string, n: string) => id(`insert into variantes_tecido (tenant_id, artigo_id, nome_variante) values ($1, $2, $3) returning id`, [T, a, n]);
    const v1a = await vt(art1, "SCP-1a");
    const v1b = await vt(art1, "SCP-1b");
    const v1c = await vt(art1, "SCP-1c");
    const v2a = await vt(art2, "SCP-2a");
    const avi1 = await id(`insert into aviamentos (tenant_id, codigo_nome, preco) values ($1, 'ITEST SCP avi 1', 1) returning id`, [T]);
    const avi2 = await id(`insert into aviamentos (tenant_id, codigo_nome, preco) values ($1, 'ITEST SCP avi 2', 2) returning id`, [T]);
    const etq: string[] = [];
    for (let i = 1; i <= 4; i++) etq.push(await id(`insert into etiquetas (tenant_id, nome) values ($1, $2) returning id`, [T, `ITEST SCP etq ${i}`]));
    const cor = await id(`insert into cores (tenant_id, nome) values ($1, 'ITEST SCP cor') returning id`, [T]);
    const catServ = await id(`insert into categorias_terceirizado (tenant_id, nome, ativo) values ($1, 'Costura SCP', true) returning id`, [T]);
    const catServ2 = await id(`insert into categorias_terceirizado (tenant_id, nome, ativo) values ($1, 'Corte SCP', true) returning id`, [T]);
    // OUTRA loja: tecido, categoria de serviço e 2 cards (um com BOM, outro sem)
    const artOutra = await id(`insert into artigos (tenant_id, nome, unidade_medida, preco) values ($1, 'ITEST SCP OUTRA', 'metro', 9) returning id`, [outra]);
    const catOutra = await id(`insert into categorias_terceirizado (tenant_id, nome, ativo) values ($1, 'ITEST SCP OUTRA', true) returning id`, [outra]);
    const modeloOutraComBom = await id(`insert into modelos (tenant_id, nome, ref) values ($1, 'ITEST-SCP OUTRA c/ BOM', 'SCP-OUTRA-1') returning id`, [outra]);
    const modeloOutraSemBom = await id(`insert into modelos (tenant_id, nome, ref) values ($1, 'ITEST-SCP OUTRA s/ BOM', 'SCP-OUTRA-2') returning id`, [outra]);
    await c.query(`insert into modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo) values ($1, $2, 1, 'tecido', 1)`, [modeloOutraComBom, artOutra]);
    return { art1, v1a, v1b, v1c, art2, v2a, avi1, avi2, etq, cor, catServ, catServ2, outra, artOutra, catOutra, modeloOutraComBom, modeloOutraSemBom };
  });
}

const BOM_INICIAL = (fx: Fx) => ({
  tecidos: [{ artigo_id: fx.art1, numero: 1, tipo: "tecido", consumo: 1.2, loss_percent: 5, custo_previsto: 12.5, variantes: [fx.v1a, fx.v1b] }],
  aviamentos: [{ aviamento_id: fx.avi1, numero: 1, consumo: 2, loss_percent: 0, custo_previsto: 3 }],
  grades: [
    { variante_numero: 1, grades: { P: 5, M: 5 }, grade_total: 10 },
    { variante_numero: 2, grades: { P: 2, M: 3 }, grade_total: 5 },
  ],
});
const BOM_NOVO = (fx: Fx) => ({
  tecidos: [
    { artigo_id: fx.art1, numero: 1, tipo: "tecido", consumo: 1.5, loss_percent: 7, custo_previsto: 15, variantes: [fx.v1a, fx.v1b, fx.v1c] },
    { artigo_id: fx.art2, numero: 2, tipo: "forro", consumo: 0.8, loss_percent: 3, custo_previsto: 6, variantes: [fx.v2a] },
  ],
  aviamentos: [
    { aviamento_id: fx.avi1, numero: 1, consumo: 3, loss_percent: 1, custo_previsto: 4 },
    { aviamento_id: fx.avi2, numero: 2, consumo: 1, loss_percent: 0, custo_previsto: 2 },
  ],
  grades: [
    { variante_numero: 1, grades: { P: 6, M: 6 }, grade_total: 12 },
    { variante_numero: 2, grades: { P: 1, M: 2 }, grade_total: 3 },
    { variante_numero: 3, grades: { G: 4 }, grade_total: 4 },
  ],
});
const CAD_NOVO = (fx: Fx, p1 = 12) => ({
  tecidos: [
    {
      artigo_id: fx.art1, numero: 1, tipo: "tecido", consumo_cad: 1.4, loss_percent_cad: 6, custo_cad: 14, tamanho_folha: 1.8,
      variantes: [
        { variante_tecido_id: fx.v1a, ordem: 1, multiplicador: 1, quantidade_folhas: 3, metragem_planejada: 5.4, metragem_enviada: 0 },
        { variante_tecido_id: fx.v1b, ordem: 2, multiplicador: 1, quantidade_folhas: 2, metragem_planejada: 3.6, metragem_enviada: 0 },
        { variante_tecido_id: fx.v1c, ordem: 3, multiplicador: 1, quantidade_folhas: 1, metragem_planejada: 1.8, metragem_enviada: 0 },
      ],
    },
  ],
  grades: [
    { variante_numero: 1, grades: { P: p1 / 2, M: p1 / 2 }, grade_total: p1 },
    { variante_numero: 2, grades: { P: 1, M: 2 }, grade_total: 3 },
    { variante_numero: 3, grades: { G: 4 }, grade_total: 4 },
  ],
  aviamentos: [{ aviamento_id: fx.avi1, numero: 1, consumo: 3, quantidade_enviar: 10, quantidade_separar: 12 }],
  etiquetas: [{ etiqueta_id: fx.etq[0], cor_id: fx.cor, consumo: 1, quantidade_planejada: 20, quantidade_enviar: 20, enviar_por_tamanho: {} }],
  proporcoes: { "1": { P: 1, M: 1 } },
  observacoes_molde: "molde SCP",
  data_previsao_corte: "2026-12-01",
});
const MO_EXTRA = (fx: Fx, idLinha: string | null) => [
  { id: idLinha, categoria_terceirizado_id: fx.catServ, valor: 25, observacoes: "costura nova" },
  { id: null, categoria_terceirizado_id: fx.catServ2, valor: 8, observacoes: null },
];
const HEADER_NOVO = { nome: "SCP nome novo", ncm: "6104.43", peso_kg: 0.35, observacoes_gerais: "obs SCP", subcolecao: "Sub SCP" };

type Semente = { bom?: boolean; mo?: boolean; etq?: boolean; origem?: "interno" | "revenda"; nome?: string };
/**
 * Cria um card da Loja Teste (como postgres, sem JWT), com a semente pedida. O card nasce num SAVEPOINT…RELEASE (a `rev` das filhas é
 * contada fora do savepoint — receita T5 do CLAUDE.md). BOM/M.O. entram pelos wrappers ANTIGOS como o editor; etiquetas por INSERT.
 */
async function novoCard(c: PgClient, fx: Fx, s: Semente = {}): Promise<string> {
  const m = await semJwt(c, async () => {
    await c.query("SAVEPOINT scp_card");
    const id = (
      await um<{ id: string }>(
        c,
        `insert into modelos (tenant_id, nome, ordem_criacao_enviada, origem) values ($1, $2, true, $3) returning id`,
        [T, s.nome ?? "ITEST-SCP card", s.origem ?? "interno"],
      )
    ).id;
    await c.query("RELEASE SAVEPOINT scp_card");
    if (s.etq) {
      await c.query(
        `insert into modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, numero, consumo, loss_percent, custo_previsto)
         values ($1, $2, $3, $4, 1, 1, 0, 0)`,
        [T, id, fx.etq[0], fx.cor],
      );
    }
    return id;
  });
  const antes = await um<{ u: string | null }>(c, `select current_setting('request.jwt.claims', true) as u`);
  await jwt(c, U_EDIT);
  try {
    if (s.bom) {
      const b = BOM_INICIAL(fx);
      await ok(c, `select public.salvar_modelo_bom($1, $2::jsonb, $3::jsonb, $4::jsonb, null)`, [m, j(b.tecidos), j(b.aviamentos), j(b.grades)]);
    }
    if (s.mo) {
      await ok(c, `select public.salvar_modelo_servico_mo($1, $2::jsonb)`, [m, j([{ id: null, categoria_terceirizado_id: fx.catServ, valor: 10, observacoes: "mo inicial" }])]);
    }
  } finally {
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [antes.u ?? ""]);
  }
  return m;
}
/** Como `authenticated` e TEM de passar. */
async function ok(c: PgClient, sql: string, params: any[] = []): Promise<any[]> {
  const r = await como(c, "authenticated", sql, params);
  if (!r.ok) throw new Error(`esperava passar: ${sql}\n→ ${r.code} ${r.msg}`);
  return r.rows;
}
const idMo = async (c: PgClient, m: string): Promise<string> =>
  (await um<{ id: string }>(c, `select id from modelo_servico_mo where modelo_id = $1 order by created_at, id limit 1`, [m])).id;

/** Fotografia do card (SEM ids): cabeçalho, BOM, grades, M.O., insumos e CAD. É o que a paridade e a atomicidade comparam. */
async function dump(c: PgClient, m: string): Promise<any> {
  const q = async (sql: string) => (await c.query(sql, [m])).rows;
  const cadId = `(select id from cad where modelo_id = $1)`;
  return {
    modelo: (
      await c.query(
        `select nome, ncm, peso_kg, observacoes_gerais, subcolecao, proporcoes, revisao_pendente, lancado, enviado_cad, preco_venda, origem
           from modelos where id = $1`,
        [m],
      )
    ).rows[0],
    tecidos: await q(
      `select mt.tipo, mt.numero, mt.artigo_id, mt.consumo, mt.loss_percent, mt.custo_previsto,
              coalesce((select jsonb_agg(jsonb_build_object('v', v.variante_tecido_id, 'o', v.ordem, 'm', v.multiplicador) order by v.ordem)
                          from modelo_tecido_variantes v where v.modelo_tecido_id = mt.id), '[]'::jsonb) as vs
         from modelo_tecidos mt where mt.modelo_id = $1 order by mt.tipo, mt.numero`,
    ),
    aviamentos: await q(
      `select aviamento_id, numero, consumo, loss_percent, custo_previsto, variante_aviamento_id
         from modelo_aviamentos where modelo_id = $1 order by numero, aviamento_id`,
    ),
    grades: await q(`select variante_numero, grades, grade_total from modelo_grades where modelo_id = $1 order by variante_numero`),
    mo: await q(`select categoria_terceirizado_id, valor, observacoes, aprovado from modelo_servico_mo where modelo_id = $1 order by categoria_terceirizado_id`),
    etiquetas: await q(
      `select etiqueta_id, cor_id, numero, consumo, loss_percent, custo_previsto from modelo_etiquetas where modelo_id = $1 order by numero, etiqueta_id`,
    ),
    cad: await q(`select observacoes_molde, data_previsao_corte::text as data_previsao_corte, status_corte from cad where modelo_id = $1`),
    cad_tecidos: await q(
      `select ct.tipo, ct.numero, ct.artigo_id, ct.consumo_cad, ct.loss_percent_cad, ct.custo_cad, ct.tamanho_folha,
              coalesce((select jsonb_agg(jsonb_build_object('v', v.variante_tecido_id, 'o', v.ordem, 'q', v.quantidade_folhas, 'mp', v.metragem_planejada) order by v.ordem)
                          from cad_tecido_variantes v where v.cad_tecido_id = ct.id), '[]'::jsonb) as vs
         from cad_tecidos ct where ct.cad_id = ${cadId} order by ct.tipo, ct.numero`,
    ),
    cad_grades: await q(
      `select variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real
         from cad_grades where cad_id = ${cadId} order by variante_numero`,
    ),
    cad_aviamentos: await q(
      `select aviamento_id, numero, consumo, quantidade_enviar, quantidade_separar from cad_aviamentos where cad_id = ${cadId} order by numero`,
    ),
    cad_etiquetas: await q(
      `select etiqueta_id, cor_id, consumo, quantidade_planejada, quantidade_enviar, enviar_por_tamanho from cad_etiquetas where cad_id = ${cadId} order by etiqueta_id`,
    ),
  };
}

/**
 * A CADEIA ANTIGA do Salvar (o que a tela fazia em requisições separadas) sobre o card `y`, como o mesmo editor. Cada passo roda no NÍVEL DE
 * TOPO da txn (sem SAVEPOINT) para o delta de `rev` ser comparável ao da RPC (ver `salvaTopo`).
 */
async function cadeiaAntiga(c: PgClient, y: string, fx: Fx, o: { cad?: any } = {}): Promise<void> {
  await c.query(`update modelos set nome = $2, ncm = $3, peso_kg = $4, observacoes_gerais = $5, subcolecao = $6 where id = $1`,
    [y, HEADER_NOVO.nome, HEADER_NOVO.ncm, HEADER_NOVO.peso_kg, HEADER_NOVO.observacoes_gerais, HEADER_NOVO.subcolecao]);
  const b = BOM_NOVO(fx);
  await c.query(`select public.salvar_modelo_bom($1, $2::jsonb, $3::jsonb, $4::jsonb, null)`, [y, j(b.tecidos), j(b.aviamentos), j(b.grades)]);
  await c.query(`select public.salvar_modelo_servico_mo($1, $2::jsonb)`, [y, j(MO_EXTRA(fx, await idMo(c, y)))]);
  if (o.cad) await salvarCadAntigo(c, y, o.cad, o.cad.proporcoes);
}
async function salvarCadAntigo(c: PgClient, y: string, d: any, proporcoes: any): Promise<void> {
  await c.query(`select public.salvar_cad_completo($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8::date)`,
    [y, j(d.tecidos), j(d.grades), j(d.aviamentos), j(d.etiquetas), j(proporcoes), d.observacoes_molde, d.data_previsao_corte]);
}

// ═════════════════════════════════════════════════ 1 + 2 · PARIDADE ═════════════════════════════════════════════════
describe.skipIf(!RODA)("salvar_card_planejamento — paridade com a cadeia antiga", () => {
  it("1. interno: header + BOM + M.O. gravam o mesmo que a cadeia antiga; a rev sobe EXATAMENTE +1 (1x por evento, nao +N)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      const x = await novoCard(c, fx, { bom: true, mo: true, nome: "SCP gemeo" });
      const y = await novoCard(c, fx, { bom: true, mo: true, nome: "SCP gemeo" });
      const antes = await dump(c, x);
      expect(await dump(c, y)).toEqual(antes); // gêmeos idênticos na semente
      const rev0 = await rev(c, x);
      const revY0 = await rev(c, y);

      const r = await salvaTopo(c, x, { header: HEADER_NOVO, rev: rev0, bom: BOM_NOVO(fx), mo: MO_EXTRA(fx, await idMo(c, x)) });
      await cadeiaAntiga(c, y, fx);

      const depois = await dump(c, x);
      expect(depois).toEqual(await dump(c, y)); // paridade
      expect(depois).not.toEqual(antes); // e o teste não é vacuoso
      expect(depois.modelo).toMatchObject({ nome: HEADER_NOVO.nome, ncm: HEADER_NOVO.ncm, observacoes_gerais: HEADER_NOVO.observacoes_gerais });
      expect(depois.tecidos.map((t: any) => [t.tipo, t.numero, t.vs.length])).toEqual([["forro", 2, 1], ["tecido", 1, 3]]);
      expect(depois.aviamentos).toHaveLength(2);
      expect(depois.grades.map((g: any) => g.variante_numero)).toEqual([1, 2, 3]);
      expect(depois.mo).toHaveLength(2);
      // DELTA de rev (medido): header + BOM (apaga e regrava ~dezenas de linhas) + M.O. = +1, o UPDATE do cabeçalho; as filhas não somam
      // (T5: o card já foi escrito por esta transação). A cadeia antiga, no mesmo nível, também dá +1 (a RPC não sobe MAIS que ela).
      const rev1 = await rev(c, x);
      expect(rev1 - rev0).toBe(1);
      expect((await rev(c, y)) - revY0).toBe(1);
      expect(r).toEqual({ modelo_id: x, rev: rev1, revisao_marcada: {} });
    });
  });

  it("2. com CAD: cad / cad_tecidos / cad_grades / aviamentos / etiquetas / proporções = cadeia antiga; grade REAL preservada com CQ confirmado; #Erro marcado = o da cadeia antiga", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      const x = await novoCard(c, fx, { bom: true, mo: true, nome: "SCP cad gemeo" });
      const y = await novoCard(c, fx, { bom: true, mo: true, nome: "SCP cad gemeo" });
      const cad1 = CAD_NOVO(fx, 12);
      const rX0 = await rev(c, x);
      const rY0 = await rev(c, y);
      await salvaTopo(c, x, { header: HEADER_NOVO, rev: rX0, bom: BOM_NOVO(fx), mo: MO_EXTRA(fx, await idMo(c, x)), cad: cad1 });
      await cadeiaAntiga(c, y, fx, { cad: cad1 });
      const dx = await dump(c, x);
      expect(dx).toEqual(await dump(c, y));
      // DELTA de rev (medido): +2 = o UPDATE do cabeçalho + o `UPDATE modelos SET proporcoes` que o `_salvar_cad_completo_core` faz
      // (o CAD novo e as filhas do CAD não sobem o `modelos.rev`). Mesma conta da cadeia antiga (header + salvar_cad_completo).
      expect((await rev(c, x)) - rX0).toBe(2);
      expect((await rev(c, y)) - rY0).toBe(2);
      expect(dx.cad).toEqual([{ observacoes_molde: "molde SCP", data_previsao_corte: "2026-12-01", status_corte: "pendente" }]);
      expect(dx.cad_tecidos).toHaveLength(1);
      expect(dx.cad_grades.map((g: any) => g.variante_numero)).toEqual([1, 2, 3]);
      expect(dx.cad_aviamentos).toHaveLength(1);
      expect(dx.cad_etiquetas).toHaveLength(1);
      expect(dx.modelo.proporcoes).toEqual({ "1": { P: 1, M: 1 } });
      expect(dx.modelo.revisao_pendente).toEqual({}); // 1º Salvar: nada a jusante, nada marcado

      // CQ confirmado em X e Y, com a grade REAL da variante 1 e 2 diferente da planejada
      await semJwt(c, async () => {
        for (const m of [x, y]) {
          const cad = (await um<{ id: string }>(c, `select id from cad where modelo_id = $1`, [m])).id;
          await c.query(`insert into controle_qualidade (cad_id, tenant_id, status) values ($1, $2, 'confirmado')`, [cad, T]);
          await c.query(`update cad_grades set grades_reais = '{"P":4,"M":5}'::jsonb, grade_total_real = 9 where cad_id = $1 and variante_numero = 1`, [cad]);
          await c.query(`update cad_grades set grades_reais = '{"P":1,"M":1}'::jsonb, grade_total_real = 2 where cad_id = $1 and variante_numero = 2`, [cad]);
        }
      });
      // 2º Salvar: a planejada da variante 1 muda (12 -> 14); sem `proporcoes` no _cad (mantém as do card); a GRADE mudou, então pede o
      // #Erro das etapas a jusante: o CQ (agora existe) é marcado. A cadeia antiga faz o mesmo com marcar_revisao_por_mudanca(grade=true).
      const cad2: any = CAD_NOVO(fx, 14);
      delete cad2.proporcoes;
      const rX1 = await rev(c, x);
      const rY1 = await rev(c, y);
      const r2 = await salvaTopo(c, x, { rev: rX1, cad: cad2, revisao: { grade: true, consumo: false, aviamentos: false } });
      await salvarCadAntigo(c, y, cad2, { "1": { P: 1, M: 1 } });
      const marcadasAntiga = (await c.query(`select public.marcar_revisao_por_mudanca($1, true, false, false) as r`, [y])).rows[0].r;
      expect(marcadasAntiga).toEqual({ cq: true }); // a semente FAZ algo ser marcado: não é {} contra {}
      expect(r2.revisao_marcada).toEqual(marcadasAntiga); // o mesmo retorno do marcar_revisao_por_mudanca
      const d2 = await dump(c, x);
      expect(d2).toEqual(await dump(c, y));
      expect(d2.modelo.revisao_pendente).toEqual({ cq: true }); // e a coluna `revisao_pendente` gravada igual nos dois
      // DELTA: +2 = `UPDATE modelos SET proporcoes` do _core + o UPDATE de `revisao_pendente` do marcar (idem na cadeia antiga)
      expect((await rev(c, x)) - rX1).toBe(2);
      expect((await rev(c, y)) - rY1).toBe(2);
      const g1 = d2.cad_grades.find((g: any) => g.variante_numero === 1);
      expect(g1).toMatchObject({ grade_total_planejada: 14, grades_reais: { P: 4, M: 5 }, grade_total_real: 9 }); // real PRESERVADA
      const g2 = d2.cad_grades.find((g: any) => g.variante_numero === 2);
      expect(g2).toMatchObject({ grades_reais: { P: 1, M: 1 }, grade_total_real: 2 });
      expect(d2.modelo.proporcoes).toEqual({ "1": { P: 1, M: 1 } }); // `proporcoes` ausente no _cad = mantém (nunca zera)
    });
  });
});

// ═════════════════════════════════════════════════ 3 · ATOMICIDADE ═════════════════════════════════════════════════
describe.skipIf(!RODA)("salvar_card_planejamento — atomicidade (tudo ou nada)", () => {
  it("3. um bloco inválido DEPOIS de blocos válidos aborta a RPC: header, BOM, insumos, CAD, M.O. e rev ficam como estavam", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      // payload completo e VÁLIDO (controle) — o veneno é trocado por bloco
      const valido = (id: string | null): P => ({
        header: HEADER_NOVO, bom: BOM_NOVO(fx), mo: MO_EXTRA(fx, id), cad: CAD_NOVO(fx, 12),
        etiquetas: [{ id: null, etiqueta_id: fx.etq[1], cor_id: null, consumo: 2, loss_percent: 0, custo_previsto: 0 }],
      });
      // controle: o MESMO payload sem veneno grava (senão os abortos abaixo podiam ser por outro motivo)
      const ctl = await novoCard(c, fx, { bom: true, mo: true, etq: true, nome: "SCP atomico controle" });
      const antesCtl = await dump(c, ctl);
      await salvaOk(c, ctl, { ...valido(await idMo(c, ctl)), rev: await rev(c, ctl) });
      const depoisCtl = await dump(c, ctl);
      expect(depoisCtl).not.toEqual(antesCtl);
      expect(depoisCtl.cad_tecidos).toHaveLength(1);
      expect(depoisCtl.etiquetas.map((e: any) => e.etiqueta_id)).toEqual([fx.etq[1]]); // estado completo: o insumo antigo saiu, o novo entrou

      const m = await novoCard(c, fx, { bom: true, mo: true, etq: true, nome: "SCP atomico" });
      const venenos: [string, (p: P) => P, string, RegExp][] = [
        // falha no BOM (passo 4) — o header (passo 3) já tinha sido gravado
        ["artigo de outra loja no BOM", (p) => ({ ...p, bom: { ...BOM_NOVO(fx), tecidos: [{ ...BOM_NOVO(fx).tecidos[0], artigo_id: fx.artOutra }] } }), "42501", /Artigo de outra loja no BOM/],
        // falha nos insumos (passo 5) — header e BOM já gravados
        ["insumo: id que não é deste card", (p) => ({ ...p, etiquetas: [{ id: RAND, etiqueta_id: fx.etq[1], consumo: 1 }] }), "P0002", /^nao_encontrado: etiqueta$/],
        // falha no CAD (passo 6) — header, BOM e insumos já gravados (o caso do brief)
        ["artigo de outra loja no CAD", (p) => ({ ...p, cad: { ...CAD_NOVO(fx), tecidos: [{ ...CAD_NOVO(fx).tecidos[0], artigo_id: fx.artOutra }] } }), "42501", /Artigo de outra loja no CAD/],
        // falha na M.O. (passo 7) — tudo acima, inclusive o CAD, já gravado
        ["serviço de outra loja na M.O.", (p) => ({ ...p, mo: [{ id: null, categoria_terceirizado_id: fx.catOutra, valor: 5 }] }), "P0001", /Serviço inválido/],
      ];
      for (const [nome, veneno, code, re] of venenos) {
        const antes = await dump(c, m);
        const rev0 = await rev(c, m);
        const r = await salva(c, m, { ...veneno(valido(await idMo(c, m))), rev: rev0 });
        expect(r.ok, `${nome}: a RPC tem de abortar`).toBe(false);
        if (!r.ok) {
          expect(r.code, nome).toBe(code);
          expect(r.msg, nome).toMatch(re);
        }
        expect(await dump(c, m), `${nome}: nada pode ter mudado`).toEqual(antes);
        expect(await rev(c, m), `${nome}: rev intacta`).toBe(rev0);
      }
    });
  });
});

// ═════════════════════════════════════════════════ 4 · TRAVA OTIMISTA ═════════════════════════════════════════════════
describe.skipIf(!RODA)("salvar_card_planejamento — trava otimista", () => {
  it("4. _rev_base defasado = P0409 conflito_versao, nada grava e a rev não sobe; _rev_base atual passa; NULL = sem trava", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      const m = await novoCard(c, fx, { bom: true, mo: true, nome: "SCP trava" });
      const rev0 = await rev(c, m);
      const p1: P = { header: { nome: "SCP trava A" }, rev: rev0, bom: BOM_NOVO(fx) };
      await salvaTopo(c, m, p1);
      const rev1 = await rev(c, m);
      expect(rev1 - rev0).toBe(1); // header + BOM = +1 (UPDATE do cabeçalho; as filhas do BOM não somam - ver `salvaTopo`)
      const depoisA = await dump(c, m);

      // alguém salvou no meio: a 2ª pessoa ainda tem a rev0
      const r = await salva(c, m, { header: { nome: "SCP trava B" }, rev: rev0, bom: { ...BOM_INICIAL(fx) }, mo: [] });
      expect(txt(r)).toBe("P0409 conflito_versao: card");
      expect(await dump(c, m)).toEqual(depoisA);
      expect(await rev(c, m)).toBe(rev1);

      // a rev atual passa (+1); NULL (manutenção/teste) não trava (+1)
      await salvaTopo(c, m, { header: { nome: "SCP trava C" }, rev: rev1 });
      const rev2 = await rev(c, m);
      expect(rev2 - rev1).toBe(1);
      await salvaTopo(c, m, { header: { nome: "SCP trava D" }, rev: null });
      expect((await rev(c, m)) - rev2).toBe(1);
    });
  });
});

// ═════════════════════════════════════════════════ 5 · INSUMOS (ETIQUETAS) ═════════════════════════════════════════════════
describe.skipIf(!RODA)("salvar_card_planejamento — insumos (estado completo com diff)", () => {
  it("5. 1 nova + 1 editada + 1 removida: o banco reflete exatamente; ids mantidos; não apaga a mais nem mexe em outro card", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      const m = await novoCard(c, fx, { bom: true, nome: "SCP insumos" });
      const outro = await novoCard(c, fx, { bom: true, etq: true, nome: "SCP insumos OUTRO card" });
      // 3 insumos no card: e0 (será editado), e1 (será removido), e2 (fica igual)
      const ids = await semJwt(c, async () => {
        const out: string[] = [];
        for (let i = 0; i < 3; i++) {
          out.push((await um<{ id: string }>(c,
            `insert into modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, numero, consumo, loss_percent, custo_previsto)
             values ($1, $2, $3, $4, $5, 1, 0, 0) returning id`, [T, m, fx.etq[i], fx.cor, i + 1])).id);
        }
        return out;
      });
      const doOutroAntes = (await c.query(`select id, etiqueta_id, numero, consumo from modelo_etiquetas where modelo_id = $1 order by id`, [outro])).rows;
      expect(doOutroAntes).toHaveLength(1);

      // estado novo, NESTA ordem: [e0 editado, e2 igual, nova]; e1 some
      await salvaOk(c, m, {
        rev: await rev(c, m),
        etiquetas: [
          { id: ids[0], etiqueta_id: fx.etq[0], cor_id: null, consumo: 2.5, loss_percent: 3, custo_previsto: 1.5 },
          { id: ids[2], etiqueta_id: fx.etq[2], cor_id: fx.cor, consumo: 1, loss_percent: 0, custo_previsto: 0 },
          { id: null, etiqueta_id: fx.etq[3], cor_id: null, consumo: 4, loss_percent: 0, custo_previsto: 0 },
          { id: null, etiqueta_id: null, consumo: 9 }, // linha sem insumo escolhido: ignorada (não ocupa número)
        ],
      });
      const linhas = (await c.query(
        `select id, etiqueta_id, cor_id, numero, consumo::float8 as consumo, loss_percent::float8 as loss, custo_previsto::float8 as custo
           from modelo_etiquetas where modelo_id = $1 order by numero`, [m])).rows;
      expect(linhas).toHaveLength(3); // não apagou a mais
      expect(linhas[0]).toMatchObject({ id: ids[0], etiqueta_id: fx.etq[0], cor_id: null, numero: 1, consumo: 2.5, loss: 3, custo: 1.5 }); // editada, mesmo id
      expect(linhas[1]).toMatchObject({ id: ids[2], etiqueta_id: fx.etq[2], cor_id: fx.cor, numero: 2, consumo: 1 }); // intacta, MESMO id (não recriada)
      expect(linhas[2]).toMatchObject({ etiqueta_id: fx.etq[3], numero: 3, consumo: 4 }); // nova
      expect(ids).toContain(linhas[0].id);
      expect(linhas.map((l: any) => l.id)).not.toContain(ids[1]); // removida
      // o outro card não foi tocado
      expect((await c.query(`select id, etiqueta_id, numero, consumo from modelo_etiquetas where modelo_id = $1 order by id`, [outro])).rows).toEqual(doOutroAntes);

      // id de insumo de OUTRO card no payload: P0002 e nada muda
      const outroId = doOutroAntes[0].id;
      const antes = (await c.query(`select id, numero from modelo_etiquetas where modelo_id = $1 order by numero`, [m])).rows;
      const r = await salva(c, m, { etiquetas: [{ id: outroId, etiqueta_id: fx.etq[0], consumo: 99 }] });
      expect(txt(r)).toBe("P0002 nao_encontrado: etiqueta");
      expect((await c.query(`select id, numero from modelo_etiquetas where modelo_id = $1 order by numero`, [m])).rows).toEqual(antes);
      expect((await c.query(`select id, etiqueta_id, numero, consumo from modelo_etiquetas where modelo_id = $1 order by id`, [outro])).rows).toEqual(doOutroAntes);

      // lista vazia = apaga os do card (estado completo), e SÓ os dele
      await salvaOk(c, m, { etiquetas: [] });
      expect((await um<{ n: number }>(c, `select count(*)::int n from modelo_etiquetas where modelo_id = $1`, [m])).n).toBe(0);
      expect((await c.query(`select id, etiqueta_id, numero, consumo from modelo_etiquetas where modelo_id = $1 order by id`, [outro])).rows).toEqual(doOutroAntes);
      // bloco que não é lista é RECUSADO (nunca apaga)
      await salvaOk(c, m, { etiquetas: [{ id: null, etiqueta_id: fx.etq[0], consumo: 1 }] });
      expect(txt(await salva(c, m, { etiquetas: { id: null } }))).toBe("P0001 etiquetas_invalidas: esperado uma lista");
      expect((await um<{ n: number }>(c, `select count(*)::int n from modelo_etiquetas where modelo_id = $1`, [m])).n).toBe(1);
    });
  });
});

// ═════════════════════════════════════════════════ 6 · REVENDA ═════════════════════════════════════════════════
describe.skipIf(!RODA)("salvar_card_planejamento — revenda", () => {
  it("6. header sem preço + _grade_revenda grava modelo_grades; M.O. opcional; preço no header é recusado; interno e módulo desligado recusam", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      const m = await novoCard(c, fx, { origem: "revenda", nome: "SCP revenda" });
      const grade1 = [
        { variante_numero: 1, grades: { P: 3, M: 4 }, grade_total: 7 },
        { variante_numero: 2, grades: { G: 2 }, grade_total: 2 },
        { variante_numero: 3, grades: {}, grade_total: 0 }, // vazia: o _core não grava
      ];
      const r = await salvaOk(c, m, {
        header: { observacoes_gerais: "revenda SCP", ncm: "6109.10" }, rev: await rev(c, m), gradeRevenda: grade1,
        mo: [{ id: null, categoria_terceirizado_id: fx.catServ, valor: 7, observacoes: null }],
      });
      expect(r.modelo_id).toBe(m);
      const d = await dump(c, m);
      expect(d.modelo).toMatchObject({ origem: "revenda", observacoes_gerais: "revenda SCP", ncm: "6109.10", preco_venda: null });
      expect(d.grades).toEqual([
        { variante_numero: 1, grades: { P: 3, M: 4 }, grade_total: 7 },
        { variante_numero: 2, grades: { G: 2 }, grade_total: 2 },
      ]);
      expect(d.mo).toHaveLength(1);

      // 2º Salvar: a grade é estado COMPLETO (a variante 2 some)
      await salvaOk(c, m, { gradeRevenda: [{ variante_numero: 1, grades: { P: 1 }, grade_total: 1 }] });
      expect((await dump(c, m)).grades).toEqual([{ variante_numero: 1, grades: { P: 1 }, grade_total: 1 }]);

      // preço de venda no header de um comprado: o gatilho B1b recusa e NADA do mesmo Salvar fica (atômico)
      const antes = await dump(c, m);
      const rp = await salva(c, m, { header: { observacoes_gerais: "nao pode ficar", preco_venda: 99 }, gradeRevenda: grade1 });
      expect(rp.ok).toBe(false);
      if (!rp.ok) {
        expect(rp.code).toBe("42501");
        expect(rp.msg).toBe("preco_comprado_derivado: o preco de venda do comprado vem do markup ou do preco fixo do produto"); // o gatilho B1b, não um 42501 qualquer
      }
      expect(await dump(c, m)).toEqual(antes);

      // _grade_revenda num card INTERNO: o _core recusa e o header do mesmo Salvar não fica
      const interno = await novoCard(c, fx, { bom: true, nome: "SCP interno" });
      const antesI = await dump(c, interno);
      const ri = await salva(c, interno, { header: { observacoes_gerais: "nao pode ficar" }, gradeRevenda: grade1 });
      expect(ri.ok).toBe(false);
      if (!ri.ok) {
        expect(ri.code).toBe("P0001");
        expect(ri.msg).toMatch(/não é de Revenda/);
      }
      expect(await dump(c, interno)).toEqual(antesI);

      // módulo Produto Acabado desligado: a grade da revenda é recusada
      await modulo(c, "produto_acabado", false);
      const rm = await salva(c, m, { gradeRevenda: grade1 });
      expect(txt(rm)).toBe("42501 Módulo Produto Acabado (Revenda) não habilitado para esta loja");
      expect(await dump(c, m)).toEqual(antes);
    });
  });
});

// ═════════════════════════════════════════════════ 7 · PORTÃO ═════════════════════════════════════════════════
describe.skipIf(!RODA)("salvar_card_planejamento — portão de página e de módulo", () => {
  it("7. sem Planejamento e sem Dev = 42501, nada grava; só Dev passa no BOM; só Planejamento só no BOM inicial; M.O. exige Planejamento + custos", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      const m = await novoCard(c, fx, { bom: true, mo: true, nome: "SCP portao" });
      const base = await dump(c, m);
      const rev0 = await rev(c, m);
      const NEG_HEADER = "42501 sem_permissao_pagina: criacao_planejamento|criacao_desenvolvimento";
      const payload: P = { header: HEADER_NOVO, bom: BOM_NOVO(fx), mo: MO_EXTRA(fx, null), cad: CAD_NOVO(fx), etiquetas: [] };

      // sem login
      await jwt(c, null);
      const sem = await salva(c, m, payload);
      expect(sem.ok).toBe(false);
      if (!sem.ok) expect(sem.msg).toMatch(/Não autenticado/);
      // nenhuma permissão de edição / só VER: 42501 antes de qualquer escrita
      for (const u of [U_NADA, U_VER]) {
        await jwt(c, u);
        expect(txt(await salva(c, m, payload)), u).toBe(NEG_HEADER);
      }
      expect(await dump(c, m)).toEqual(base);
      expect(await rev(c, m)).toBe(rev0);

      // só Desenvolvimento: cabeçalho + BOM (card que já tem BOM = Dev) + insumos + CAD passam; M.O. não (exige Planejamento)
      await jwt(c, U_DEV);
      const rDev = await salva(c, m, { header: HEADER_NOVO, bom: BOM_NOVO(fx), cad: CAD_NOVO(fx), etiquetas: [] });
      expect(txt(rDev)).toBe("PASSOU");
      expect((await dump(c, m)).tecidos).toHaveLength(2);
      const aposDev = await dump(c, m);
      expect(txt(await salva(c, m, { mo: MO_EXTRA(fx, null) }))).toBe("42501 mao_obra_sem_permissao: editar criacao_planejamento e ver custos");
      expect(await dump(c, m)).toEqual(aposDev);

      // só Planejamento: o cabeçalho passa, o BOM/CAD/insumos de card que JÁ tem BOM não; o BOM INICIAL (card sem BOM) passa
      await jwt(c, U_PLAN);
      expect(txt(await salva(c, m, { header: { nome: "SCP plan" } }))).toBe("PASSOU");
      expect(txt(await salva(c, m, { bom: BOM_NOVO(fx) }))).toBe("42501 sem_permissao_pagina: criacao_desenvolvimento");
      expect(txt(await salva(c, m, { etiquetas: [] }))).toBe("42501 sem_permissao_pagina: criacao_desenvolvimento");
      expect(txt(await salva(c, m, { cad: CAD_NOVO(fx) }))).toBe("42501 sem_permissao_pagina: criacao_desenvolvimento");
      expect(txt(await salva(c, m, { mo: MO_EXTRA(fx, await idMo(c, m)) }))).toBe("PASSOU"); // Planejamento + custos
      const novo = await novoCard(c, fx, { nome: "SCP sem BOM" });
      expect(txt(await salva(c, novo, { bom: BOM_INICIAL(fx) }))).toBe("PASSOU"); // BOM inicial: Planejamento basta
      expect((await dump(c, novo)).tecidos).toHaveLength(1);
      expect(txt(await salva(c, novo, { bom: BOM_NOVO(fx) }))).toBe("42501 sem_permissao_pagina: criacao_desenvolvimento"); // agora já tem BOM

      // módulo Criação desligado (sem claims, como a manutenção): 42501 para usuário comum
      await modulo(c, "criacao", false);
      await jwt(c, U_EDIT);
      expect(txt(await salva(c, m, { header: { nome: "x" } }))).toBe("42501 Módulo criacao não habilitado para esta loja");
    });
  });

  it("7b. a RPC é para usuário logado: anon sem EXECUTE; o helper de insumos não é chamável pelo cliente", async () => {
    await withTx(async (c) => {
      const sig = "public.salvar_card_planejamento(uuid,jsonb,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)";
      const priv = async (papel: string, s: string) =>
        (await um<{ v: boolean }>(c, `select has_function_privilege($1, $2, 'EXECUTE') v`, [papel, s])).v;
      expect(await priv("anon", sig)).toBe(false);
      expect(await priv("authenticated", sig)).toBe(true);
      expect(await priv("service_role", sig)).toBe(true);
      const help = "public._salvar_etiquetas_modelo_core(uuid,jsonb)";
      for (const papel of ["anon", "authenticated"]) expect(await priv(papel, help), papel).toBe(false);
      expect((await um<{ d: boolean }>(c, `select prosecdef d from pg_proc where oid = $1::regprocedure`, [sig])).d).toBe(true);
    });
  });
});

// ═════════════════════════════════════════════════ 8 · BLOCOS NULL ═════════════════════════════════════════════════
describe.skipIf(!RODA)("salvar_card_planejamento — bloco NULL = não mexe", () => {
  it("8. só header: só o header muda; _mo / _etiquetas / _bom / _cad NULL (SQL ou JSON null) não apagam nada; bloco malformado é recusado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      const m = await novoCard(c, fx, { bom: true, mo: true, etq: true, nome: "SCP nulos" });
      await salvaOk(c, m, { cad: CAD_NOVO(fx), rev: await rev(c, m) }); // dá um CAD ao card para provar que o _cad NULL também não o toca
      const antes = await dump(c, m);
      expect(antes.mo).toHaveLength(1);
      expect(antes.etiquetas).toHaveLength(1);
      expect(antes.cad_tecidos).toHaveLength(1);

      const rev0 = await rev(c, m);
      await salvaTopo(c, m, { header: { observacoes_gerais: "so o header", ncm: "9999" }, rev: rev0 });
      const depois = await dump(c, m);
      expect(depois.modelo).toMatchObject({ observacoes_gerais: "so o header", ncm: "9999" });
      expect({ ...depois, modelo: null }).toEqual({ ...antes, modelo: null }); // nada além do cabeçalho mudou
      expect((await rev(c, m)) - rev0).toBe(1); // só o UPDATE do cabeçalho

      // JSON null conta como ausente (mesma coisa que SQL NULL)
      await salvaOk(c, m, { header: "null", bom: "null", etiquetas: "null", cad: "null", mo: "null", gradeRevenda: "null", revisao: "null", flags: "null" });
      expect({ ...(await dump(c, m)), modelo: null }).toEqual({ ...antes, modelo: null });

      // header só com chaves ausentes = não toca coluna nenhuma; header {} idem
      await salvaOk(c, m, { header: {} });
      expect(await dump(c, m)).toEqual(depois);

      // contraste: _mo = [] (lista vazia) é ESTADO COMPLETO e apaga a M.O. do card. Apagar linha pendente exige a permissão de aprovar
      // (inv. 12, gatilho por linha — vale também dentro da RPC): o editor ganha `producao_servico_aprovacao` só para este contraste.
      await perms(c, U_EDIT, [...edita(PLAN, DEV, "producao_servico_aprovacao"), CUSTOS]);
      await salvaOk(c, m, { mo: [] });
      expect((await dump(c, m)).mo).toHaveLength(0);

      // blocos malformados: recusados, nunca "apagam o que o servidor tem"
      const base = await dump(c, m);
      const recusas: [P, string][] = [
        [{ bom: { tecidos: [] } }, "P0001 bom_invalido: esperado tecidos, aviamentos e grades (listas)"],
        [{ bom: [] }, "P0001 bom_invalido: esperado tecidos, aviamentos e grades (listas)"],
        [{ cad: { tecidos: [], grades: [] } }, "P0001 cad_invalido: esperado tecidos, grades, aviamentos e etiquetas (listas)"],
        [{ mo: { id: null } }, "P0001 mo_invalida: esperado uma lista"],
        [{ header: [1] }, "P0001 header_invalido: esperado um objeto"],
      ];
      for (const [p, msg] of recusas) expect(txt(await salva(c, m, p)), JSON.stringify(p)).toBe(msg);
      expect(await dump(c, m)).toEqual(base);
    });
  });
});

// ═════════════════════════════════════════════════ 9 · CROSS-TENANT ═════════════════════════════════════════════════
describe.skipIf(!RODA)("salvar_card_planejamento — card de outra loja (sem oráculo)", () => {
  it("9. id de OUTRA loja (com e sem BOM) e id inexistente dão TODOS P0002 'nao_encontrado: modelo' (mesma mensagem); sem permissão, o mesmo 42501; nada muda", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      const alvos: [string, string][] = [
        ["outra loja, com BOM", fx.modeloOutraComBom],
        ["outra loja, sem BOM", fx.modeloOutraSemBom],
        ["id inexistente", RAND],
      ];
      const lerFora = async () => (await c.query(
        `select m.id, m.nome, m.rev, (select count(*) from modelo_tecidos t where t.modelo_id = m.id)::int tecidos
           from modelos m where m.id = any($1::uuid[]) order by m.id`, [[fx.modeloOutraComBom, fx.modeloOutraSemBom]])).rows;
      const foraAntes = await lerFora();
      const payload: P = { header: { nome: "invasor" }, bom: BOM_NOVO(fx), mo: MO_EXTRA(fx, null), cad: CAD_NOVO(fx), etiquetas: [] };

      // editor da Loja Teste: a posse é conferida ANTES de ler o BOM — a página exigida e a mensagem não variam com o BOM do alvo
      await jwt(c, U_EDIT);
      const respostas = new Set<string>();
      for (const [nome, id] of alvos) {
        const r = await salva(c, id, payload);
        expect(r.ok, nome).toBe(false);
        respostas.add(txt(r));
        if (!r.ok) expect({ nome, code: r.code, msg: r.msg }).toEqual({ nome, code: "P0002", msg: "nao_encontrado: modelo" });
      }
      expect([...respostas]).toEqual(["P0002 nao_encontrado: modelo"]); // UMA resposta só: sem oráculo
      // só Planejamento (BOM de outra loja "vazio" não pode mudar a exigência para Dev)
      await jwt(c, U_PLAN);
      for (const [nome, id] of alvos) expect(txt(await salva(c, id, payload)), nome).toBe("P0002 nao_encontrado: modelo");
      // sem permissão: o portão de página vem antes da busca — também uma resposta só
      await jwt(c, U_NADA);
      const sem = new Set<string>();
      for (const [, id] of alvos) sem.add(txt(await salva(c, id, payload)));
      expect([...sem]).toEqual(["42501 sem_permissao_pagina: criacao_planejamento|criacao_desenvolvimento"]);
      expect(await lerFora()).toEqual(foraAntes);
    });
  });
});

// ═════════════════════════════════════════════════ 10 · HEADER ═════════════════════════════════════════════════
describe.skipIf(!RODA)("salvar_card_planejamento — cabeçalho por lista fechada", () => {
  it("10. coluna fora da lista (lancado, tenant_id, rev, enviado_cad…) = P0001 header_campo_invalido, nada grava (nem as chaves válidas do mesmo header)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      const m = await novoCard(c, fx, { bom: true, nome: "SCP header" });
      const antes = await dump(c, m);
      const rev0 = await rev(c, m);
      const casos: [any, string][] = [
        [{ lancado: true }, "lancado"],
        [{ tenant_id: fx.outra }, "tenant_id"],
        [{ rev: 999 }, "rev"],
        [{ enviado_cad: true }, "enviado_cad"],
        [{ id: RAND }, "id"],
        [{ custo_peca_previsto: 1 }, "custo_peca_previsto"],
        [{ nome: "valida junto", ncm: "1", lancado: true, tenant_id: fx.outra }, "lancado,tenant_id"], // várias: listadas em ordem
        [{ "nome; drop table modelos": 1 }, "nome; drop table modelos"], // nunca vira SQL
      ];
      for (const [header, ruins] of casos) {
        const r = await salva(c, m, { header, rev: rev0, bom: BOM_NOVO(fx) });
        expect(txt(r), JSON.stringify(header)).toBe(`P0001 header_campo_invalido: ${ruins}`);
        expect(await dump(c, m), JSON.stringify(header)).toEqual(antes);
        expect(await rev(c, m)).toBe(rev0);
      }
      // controle: uma coluna da lista passa, e chave com JSON null grava NULL
      await salvaTopo(c, m, { header: { ncm: "1234", peso_kg: null } });
      expect((await rev(c, m)) - rev0).toBe(1);
      expect((await dump(c, m)).modelo).toMatchObject({ ncm: "1234", peso_kg: null });
      // e as recusas acima nunca tocaram as colunas protegidas
      expect((await um<{ lancado: boolean; enviado_cad: boolean }>(c, `select lancado, enviado_cad from modelos where id = $1`, [m]))).toEqual({ lancado: false, enviado_cad: false });
    });
  });
});

// ═════════════════════════════════════════════════ 11 · DEADLOCK / 2 CONEXÕES ═════════════════════════════════════════════════
/**
 * 2+ conexões REAIS na cópia local, todas em BEGIN…ROLLBACK (padrão de urgb-r4-servicos-da-mo): nada é commitado, então cada conexão só vê o
 * dado da cópia (card da Loja Teste com CAD e sem blocos de Serviços) e o que a própria txn fez. A conexão que "ganha" fica com as travas até o
 * ROLLBACK, a outra tem de ESPERAR (advisory do card/CAD) e COMPLETAR — nunca 40P01.
 *
 * LIMITAÇÃO (declarada): "uma vence e a outra pega P0409" exige que a vencedora COMMITE (a rev nova só fica visível às outras txns após o
 * COMMIT). Isso gravaria de verdade na cópia, fora da regra desta suíte (nada persiste). O P0409 do _rev_base defasado está provado no caso 4,
 * com a mesma comparação; aqui se prova o que só 2 conexões provam — que as travas do card/CAD seguem a ordem única (card -> CAD -> linha de
 * modelos) e nenhum cruzamento com o salvar_terceirizados (que pega só a chave do CAD) vira deadlock. O cruzamento com `_salvar_cq_core`
 * (que não pega a chave do CAD) é o "residual aceito" do CLAUDE.md e NÃO é coberto aqui.
 */
describe.skipIf(!RODA)("salvar_card_planejamento — 2 conexões reais (sem deadlock)", () => {
  const PIDS = new WeakMap<PgClient, number>();
  const pid = (x: PgClient) => PIDS.get(x)!;
  async function abre(): Promise<PgClient> {
    const x = new Client({ connectionString: dbUrl()!, ssl: false });
    await x.connect();
    await x.query("BEGIN");
    await x.query("SET LOCAL lock_timeout = '15s'");
    await x.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USER_TESTE, role: "authenticated" })]);
    await x.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2 AND tenant_id IS DISTINCT FROM $1", [T, USER_TESTE]);
    PIDS.set(x, (await um<{ p: number }>(x, "SELECT pg_backend_pid() AS p")).p); // lido ANTES (a conexão ocupada enfileira consultas)
    return x;
  }
  async function fecha(...xs: PgClient[]): Promise<void> {
    for (const x of xs) {
      await x.query("ROLLBACK").catch(() => {});
      await x.end().catch(() => {});
    }
  }
  /** `p` está esperando um advisory lock? */
  async function esperaAdvisory(obs: PgClient, p: number): Promise<boolean> {
    for (let i = 0; i < 100; i++) {
      const w = await um<{ n: number }>(obs, "SELECT count(*)::int AS n FROM pg_locks WHERE pid = $1 AND NOT granted AND locktype = 'advisory'", [p]);
      if (w.n > 0) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }
  const settle = (p: Promise<unknown>): Promise<string> => p.then(() => "ok", (e: any) => String(e?.code ?? e?.message));
  async function alvo(x: PgClient): Promise<{ m: string; cad: string; rev: number }> {
    const r = await um<{ m: string; cad: string; rev: number } | undefined>(
      x,
      `SELECT m.id AS m, k.id AS cad, m.rev
         FROM public.modelos m JOIN public.cad k ON k.modelo_id = m.id
        WHERE m.tenant_id = $1 AND m.origem = 'interno'
          AND NOT EXISTS (SELECT 1 FROM public.producao_terceirizados pt WHERE pt.cad_id = k.id)
          AND NOT EXISTS (SELECT 1 FROM public.controle_qualidade q WHERE q.cad_id = k.id AND q.status = 'confirmado')
        ORDER BY m.id LIMIT 1`,
      [T],
    );
    expect(r, "a Loja Teste da cópia precisa de 1 card interno com CAD, sem blocos de Serviços e sem CQ confirmado").toBeTruthy();
    return r!;
  }
  const SQL_CAD = `SELECT public.salvar_card_planejamento($1::uuid, $2::jsonb, $3::int, NULL, NULL, $4::jsonb, NULL, NULL, NULL, NULL)`;
  const CAD_VAZIO = JSON.stringify({ tecidos: [], grades: [], aviamentos: [], etiquetas: [] });
  const rpc = (x: PgClient, a: { m: string; rev: number }, quem: string) => x.query(SQL_CAD, [a.m, JSON.stringify({ observacoes_gerais: `conc ${quem}` }), a.rev, CAD_VAZIO]);
  const terc = (x: PgClient, a: { cad: string }) => x.query("SELECT public.salvar_terceirizados($1, '[]'::jsonb, NULL, NULL)", [a.cad]);

  it("11a. dois Salvares do MESMO card: o 2º espera as travas do 1º e, solto o 1º, completa (sem 40P01, sem estado parcial)", async () => {
    const a = await abre();
    const b = await abre();
    try {
      const x = await alvo(a);
      await rpc(a, x, "A"); // A segura advisory do card + do CAD + a linha de modelos
      const pb = settle(rpc(b, x, "B"));
      expect(await esperaAdvisory(a, pid(b)), "B tem de ficar esperando a chave do card").toBe(true);
      await a.query("ROLLBACK");
      expect(await pb).toBe("ok");
      // B (txn ainda aberta) vê o card com o cabeçalho DELE e a rev dele (a de A foi revertida)
      const s = await um<{ obs: string; rev: number }>(b, "SELECT observacoes_gerais AS obs, rev FROM public.modelos WHERE id = $1", [x.m]);
      expect(s.obs).toBe("conc B");
      expect(s.rev - x.rev).toBe(2); // header (+1) + o UPDATE de proporcoes do _core do CAD (+1); a rev de A (revertida) não conta
    } finally {
      await fecha(a, b);
    }
  }, 60000);

  it("11b. Salvar do PCP Serviços (salvar_terceirizados, chave do CAD) aberto × Salvar do card com _cad: o card espera e completa", async () => {
    const a = await abre();
    const b = await abre();
    try {
      const x = await alvo(a);
      await terc(a, x); // A = PCP Serviços: segura a chave do CAD
      const pb = settle(rpc(b, x, "B")); // B = Salvar do card: chave do card -> espera a do CAD
      expect(await esperaAdvisory(a, pid(b))).toBe(true);
      await a.query("ROLLBACK");
      expect(await pb).toBe("ok");
    } finally {
      await fecha(a, b);
    }
  }, 60000);

  it("11c. Salvar do card com _cad aberto × Salvar do PCP Serviços: o PCP espera a chave do CAD e completa", async () => {
    const a = await abre();
    const b = await abre();
    try {
      const x = await alvo(a);
      await rpc(a, x, "A");
      const pb = settle(terc(b, x));
      expect(await esperaAdvisory(a, pid(b))).toBe(true);
      await a.query("ROLLBACK");
      expect(await pb).toBe("ok");
    } finally {
      await fecha(a, b);
    }
  }, 60000);

  it("11d. fila de 3 (card, card, PCP) atrás de um Salvar aberto: todos completam em sequência, nenhum 40P01", async () => {
    const a = await abre();
    const b = await abre();
    const d = await abre();
    try {
      const x = await alvo(a);
      await rpc(a, x, "A");
      const pb = settle(rpc(b, x, "B"));
      const pd = settle(terc(d, x));
      expect(await esperaAdvisory(a, pid(b))).toBe(true);
      expect(await esperaAdvisory(a, pid(d))).toBe(true);
      await a.query("ROLLBACK");
      // quem passou primeiro segura as chaves até o ROLLBACK: solta um a um até todos terminarem
      const pendentes = new Map<PgClient, Promise<string>>([[b, pb], [d, pd]]);
      const resultados: string[] = [];
      while (pendentes.size) {
        const [cli, r] = await Promise.race([...pendentes].map(([k, p]) => p.then((v) => [k, v] as const)));
        resultados.push(r);
        pendentes.delete(cli);
        await cli.query("ROLLBACK");
      }
      expect(resultados).toEqual(["ok", "ok"]);
      expect(resultados).not.toContain("40P01");
    } finally {
      await fecha(a, b, d);
    }
  }, 60000);
  /**
   * 11e - sensível à ORDEM de travas e à CHAVE exata de cada advisory. As chaves vêm do corpo da RPC (`pg_get_functiondef`):
   *   card = hashtext('cad:modelo_id:' || _modelo_id::text)   (a MESMA do Enviar à Explosão, aprovar M.O., excluir CAD)
   *   CAD  = hashtext(c.id::text)                             (a MESMA do salvar_terceirizados)
   * `pg_advisory_xact_lock(bigint)` aparece em pg_locks como classid = bits altos / objid = bits baixos da chave (objsubid 1); a conta é feita
   * no SQL (`& 4294967295`) e compara classid E objid, então outro advisory (ex.: contador de REF por loja) NÃO satisfaz por acaso.
   */
  it("11e. ordem de travas: com a chave do CAD presa por outra conexão, a RPC já TEM a do card (granted) e ESPERA a do CAD (not granted); e o inverso", async () => {
    const a = await abre();
    const b = await abre();
    try {
      // a ordem está mesmo escrita assim na RPC viva (guarda contra o teste testar um texto que não existe mais)
      const def = (await um<{ d: string }>(a, "SELECT pg_get_functiondef('public.salvar_card_planejamento(uuid,jsonb,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure) AS d")).d;
      const iCard = def.indexOf("hashtext('cad:modelo_id:' || _modelo_id::text)");
      const iCad = def.indexOf("hashtext(c.id::text)");
      const iLinha = def.indexOf("FOR UPDATE", iCad);
      expect(iCard, "chave do card no corpo da RPC").toBeGreaterThan(-1);
      expect([iCard < iCad, iCad < iLinha]).toEqual([true, true]);

      const x = await alvo(a);
      const estado = async (obs: PgClient, p: number, chave: string): Promise<boolean | null> => {
        const r = await obs.query(
          `SELECT l.granted FROM pg_locks l, (SELECT hashtext($2::text)::bigint AS k) q
            WHERE l.locktype = 'advisory' AND l.pid = $1 AND l.objsubid = 1
              AND l.classid::bigint = ((q.k >> 32) & 4294967295) AND l.objid::bigint = (q.k & 4294967295)`,
          [p, chave],
        );
        return r.rows.length ? (r.rows[0].granted as boolean) : null; // null = a conexão nem pediu essa chave
      };
      const naoConcedidas = async (obs: PgClient, p: number) =>
        (await um<{ n: number }>(obs, "SELECT count(*)::int AS n FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted", [p])).n;
      const chaveCard = `cad:modelo_id:${x.m}`;
      const chaveCad = x.cad;

      // (1) A = salvar_terceirizados imitado: segura SÓ a chave do CAD. B (RPC) tem de ter o card e esperar o CAD.
      await a.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [chaveCad]);
      const pb = settle(rpc(b, x, "B"));
      expect(await esperaAdvisory(a, pid(b))).toBe(true);
      expect(await estado(a, pid(b), chaveCard), "B já tem a chave do CARD").toBe(true);
      expect(await estado(a, pid(b), chaveCad), "B espera a chave do CAD").toBe(false);
      expect(await naoConcedidas(a, pid(b)), "e só essa").toBe(1);
      await a.query("ROLLBACK");
      expect(await pb).toBe("ok");
      await b.query("ROLLBACK");

      // (2) o inverso: A segura a chave do CARD (Enviar à Explosão / aprovar M.O. pegam o card primeiro). B espera o CARD e NÃO pediu o CAD ainda.
      const a2 = await abre();
      const b2 = await abre();
      try {
        await a2.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [chaveCard]);
        const pb2 = settle(rpc(b2, x, "B2"));
        expect(await esperaAdvisory(a2, pid(b2))).toBe(true);
        expect(await estado(a2, pid(b2), chaveCard), "B2 espera a chave do CARD").toBe(false);
        expect(await estado(a2, pid(b2), chaveCad), "B2 ainda não pediu a do CAD").toBeNull();
        expect(await naoConcedidas(a2, pid(b2))).toBe(1);
        await a2.query("ROLLBACK");
        expect(await pb2).toBe("ok");
      } finally {
        await fecha(a2, b2);
      }
    } finally {
      await fecha(a, b);
    }
  }, 60000);
});
