/**
 * Botoes Regerar REF / Regerar SKUs - ferramentas dos testes de integracao (copia LOCAL 54422, txn revertida). As 3 migrations sao aplicadas
 * DENTRO da txn do teste por `aplicarArquivo` (mig-txn: sem BEGIN/COMMIT, nunca \i), na ordem, ate a pedida; arquivo que ainda nao existe no
 * repositorio e PULADO (TDD: o teste da Task N roda "vermelho" antes de a migration da Task N existir). As RPCs rodam com o JWT do dono
 * (super admin da Loja Teste) ou de um usuario COMUM criado na txn. Nada grava na copia: BEGIN...ROLLBACK.
 */
import type { Client } from "pg";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { um, comoUsuario, semJwt, TENANT_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const T = TENANT_TESTE;

export const MIGS = {
  pulo: "supabase/migrations/20261201100000_regerar_pulo_integracao.sql",
  ref: "supabase/migrations/20261201110000_regerar_ref_card.sql",
  loja: "supabase/migrations/20261201120000_regerar_skus_loja.sql",
} as const;
export const DOWNS = {
  pulo: "supabase/rollback/20261201100000_regerar_pulo_integracao_down.sql",
  ref: "supabase/rollback/20261201110000_regerar_ref_card_down.sql",
  loja: "supabase/rollback/20261201120000_regerar_skus_loja_down.sql",
} as const;
export type Ate = keyof typeof MIGS;
const ORDEM: Ate[] = ["pulo", "ref", "loja"];

/** Aplica dentro da txn as migrations ate `ate` (inclusive). Idempotente (CREATE OR REPLACE; as guardas aceitam o "depois"). */
export async function aplicaRegerar(c: Client, ate: Ate | null): Promise<void> {
  if (ate === null) return;
  for (const k of ORDEM) {
    if (existsSync(ROOT + MIGS[k])) await aplicarArquivo(c, MIGS[k]);
    if (k === ate) break;
  }
}

/** Prepara a txn: migrations, modulos ligados (SEM claims - MOD-1) e JWT do dono (a loja ativa dele = Loja Teste). */
export async function prepara(c: Client, ate: Ate | null): Promise<void> {
  await c.query("SET LOCAL statement_timeout = '180s'");
  await aplicaRegerar(c, ate);
  await semJwt(c, () =>
    c.query(
      `UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || '{"criacao": true}'::jsonb WHERE tenant_id = $1`,
      [T],
    ),
  );
  await comoUsuario(c);
}

/** Roda `fn` SEM JWT (preparacao como postgres) e com o kanban em modo "sistema" (nao enfileira recalculo). */
export async function comoSistema<R>(c: Client, fn: () => Promise<R>): Promise<R> {
  return semJwt(c, async () => {
    await c.query("SELECT set_config('app.kanban_sistema', 'teste', true)");
    try {
      return await fn();
    } finally {
      await c.query("SELECT set_config('app.kanban_sistema', '', true)");
    }
  });
}

/** Roda `sql` num SAVEPOINT e devolve {ok, rows} ou {ok:false, code, msg}; a txn segue usavel depois do erro. */
export type Res = { ok: true; rows: any[] } | { ok: false; code: string; msg: string };
let sp = 0;
export async function tenta(c: Client, sql: string, params: unknown[] = []): Promise<Res> {
  const nome = `rg_${sp++}`;
  await c.query(`SAVEPOINT ${nome}`);
  try {
    const r = await c.query(sql, params as any[]);
    await c.query(`RELEASE SAVEPOINT ${nome}`);
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    await c.query(`ROLLBACK TO SAVEPOINT ${nome}`);
    await c.query(`RELEASE SAVEPOINT ${nome}`);
    return { ok: false, code: String(e.code ?? ""), msg: String(e.message ?? "") };
  }
}
/** Chama uma RPC (1 coluna `v` jsonb) e devolve o jsonb; erro vira excecao do teste. */
export async function rpc(c: Client, sql: string, params: unknown[] = []): Promise<any> {
  const r = await tenta(c, `SELECT (${sql}) AS v`, params);
  if (!r.ok) throw new Error(`${sql} -> ${r.code} ${r.msg}`);
  return r.rows[0].v;
}

let seq = 0;
export const suf = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
const id1 = async (c: Client, sql: string, p: unknown[]) => (await um<{ id: string }>(c, sql, p)).id;

export const FMT_COR_TAM = { partes: ["cor_base", "tamanho"], separadores: {} };
export const FMT_REF_COR_TAM = { partes: ["ref", "cor_base", "tamanho"], separadores: {} };

/** Formato do SKU + siglas de tamanho da Loja Teste (dentro da txn). */
export async function formatoSku(c: Client, cfg: unknown = FMT_REF_COR_TAM): Promise<void> {
  await semJwt(c, () =>
    c.query(
      "UPDATE public.tenant_config SET sku_config = $2::jsonb, tamanhos_sku = $3::jsonb, tamanhos_grade = $4::jsonb WHERE tenant_id = $1",
      [T, cfg === null ? null : JSON.stringify(cfg), JSON.stringify({ "34": "34", PPP: "PPP", "36": "36", PP: "PP" }), JSON.stringify(["34|PPP", "36|PP"])],
    ),
  );
}

export type Cen = { m: string; corA: string; corB: string };
/** Produto INTERNO isolado (nasce com a Ordem de Criacao NAO enviada: o gatilho fn_modelo_ref_auto nao mexe no ref/ref_auto semeados;
 *  `forcaGatilhoRef` o dispara de proposito nos testes de anti-drift). Tecido 1 = [Cor A (AA), Cor B (BB)], grade 34|PPP e 36|PP nas 2 cores (4 SKUs; com o formato REF+cor+tamanho e
 *  "Tamanho em" Numero: <REF>AA34, <REF>AA36, <REF>BB34, <REF>BB36). Tudo como postgres, sem JWT, kanban em modo sistema. */
export async function produto(c: Client, o: {
  nome?: string; ref?: string | null; refAuto?: string | null; tamanhoTipo?: "letra" | "numero" | null; base?: string | null;
  origem?: string; status?: string; categoria?: string | null; sub1?: string | null; cores?: [string, string];
} = {}): Promise<Cen> {
  return comoSistema(c, async () => {
    const [sa, sb] = o.cores ?? ["AA", "BB"];
    const corA = await id1(c, "INSERT INTO public.cores (tenant_id, nome, sigla_sku) VALUES ($1, $2, $3) RETURNING id", [T, `RG Cor A ${suf()}`, sa]);
    const corB = await id1(c, "INSERT INTO public.cores (tenant_id, nome, sigla_sku) VALUES ($1, $2, $3) RETURNING id", [T, `RG Cor B ${suf()}`, sb]);
    const artigo = await id1(c, "INSERT INTO public.artigos (tenant_id, nome) VALUES ($1, $2) RETURNING id", [T, `RG Tecido ${suf()}`]);
    const vt = (cor: string) => id1(c, "INSERT INTO public.variantes_tecido (tenant_id, artigo_id, cor_id) VALUES ($1, $2, $3) RETURNING id", [T, artigo, cor]);
    const vtA = await vt(corA);
    const vtB = await vt(corB);
    const m = await id1(
      c,
      `INSERT INTO public.modelos (tenant_id, nome, ref, ref_auto, origem, tamanho_tipo, modelo_base_id, ordem_criacao_enviada, status_desenvolvimento,
                                  categoria_principal_id, subcategoria1_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10) RETURNING id`,
      [T, o.nome ?? `RG Blusa ${suf()}`, o.ref === undefined ? "RG1" : o.ref, o.refAuto ?? null, o.origem ?? "interno",
       o.tamanhoTipo === undefined ? "numero" : o.tamanhoTipo, o.base ?? null, o.status ?? "entrada",
       o.categoria === undefined ? CAT_BLUSA : o.categoria, o.sub1 === undefined ? SUB_MANGA_CURTA : o.sub1],
    );
    const mt = await id1(c, "INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo) VALUES ($1, $2, 1, 'tecido') RETURNING id", [m, artigo]);
    await c.query("INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1, $2, 1), ($1, $3, 2)", [mt, vtA, vtB]);
    await c.query(
      `INSERT INTO public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
       VALUES ($1, 1, '{"34|PPP": 1, "36|PP": 1}'::jsonb, 2), ($1, 2, '{"34|PPP": 1, "36|PP": 1}'::jsonb, 2)`,
      [m],
    );
    return { m, corA, corB };
  });
}
/** Dispara o fn_modelo_ref_auto (BEFORE UPDATE relevante: a Ordem de Criacao vai a false e volta a true) - o que grava no ref_auto e o
 *  numero REAPROVEITADO do ref_auto atual + a sigla de HOJE (card nao revelado). */
export async function forcaGatilhoRef(c: Client, m: string): Promise<{ ref: string | null; ref_auto: string | null }> {
  return comoSistema(c, async () => {
    await c.query("UPDATE public.modelos SET ordem_criacao_enviada = false WHERE id = $1", [m]);
    await c.query("UPDATE public.modelos SET ordem_criacao_enviada = true WHERE id = $1", [m]);
    return um(c, "SELECT ref, ref_auto FROM public.modelos WHERE id = $1", [m]);
  });
}
// Taxonomia da Loja Teste (semente da copia local): Blusa (grupo Top) > Manga Curta; fallback de sigla = TOBMC.
export const CAT_BLUSA = "ddf317ac-2dd9-41c3-9e1a-63d08aee645f";
export const SUB_MANGA_CURTA = "a5fcbf94-9cc3-4984-a14b-722fb2c1187f";

/** Gera os SKUs gravados do produto (1a geracao automatica) - estado inicial de quase todo teste. */
export const geraSkus = (c: Client, m: string) =>
  comoSistema(c, () => rpc(c, "public._gerar_skus_modelo_core($1::uuid, false)", [m]));
export async function skusGravados(c: Client, m: string): Promise<{ sku: string; manual: boolean }[]> {
  return (await c.query("SELECT sku, manual FROM public.modelo_skus WHERE modelo_id = $1 ORDER BY sku", [m])).rows;
}
export const skusNomes = async (c: Client, m: string) => (await skusGravados(c, m)).map((x) => x.sku);

/** Marca o produto na Integracao (estado + campos) / insere o rastro de exportacao pedido. Como postgres, sem JWT. */
export async function integracao(c: Client, m: string, o: {
  estado?: "nao_integravel" | "integravel" | "integrado"; campos?: string[]; integradoEm?: boolean; desfeitoEm?: boolean;
} = {}): Promise<void> {
  await semJwt(c, () =>
    c.query(
      `INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos, integrado_em, desfeito_em)
       VALUES ($1, $2, $3, $4::text[], $5, $6)`,
      [T, m, o.estado ?? "nao_integravel", o.campos ?? [], o.integradoEm ? new Date().toISOString() : null, o.desfeitoEm ? new Date().toISOString() : null],
    ),
  );
}
export async function logIntegracao(c: Client, m: string, acao: string): Promise<void> {
  await semJwt(c, () =>
    c.query("INSERT INTO public.integracao_log (tenant_id, acao, quem, modelo_id, modelo_nome) VALUES ($1, $2, 'teste', $3, 'teste')", [T, acao, m]),
  );
}
export async function linhaIntegracao(c: Client, m: string): Promise<void> {
  await semJwt(c, () =>
    c.query("INSERT INTO public.integracao_linhas (tenant_id, loja_nome, modelo_id, tipo, ordem) VALUES ($1, 'teste', $2, 'produto', 1)", [T, m]),
  );
}

// ---------- usuarios comuns (permissao por pagina) ----------
export const U_COMUM = "e1e1e1e1-0000-4000-8000-0000000000c1";
export const U_ADMIN = "e1e1e1e1-0000-4000-8000-0000000000a1";
/** Usuario da Loja Teste criado na txn (comum, ou admin da loja) e as paginas que ele EDITA (so as dadas). */
export async function usuario(c: Client, uid: string, o: { admin?: boolean; edita?: string[]; ve?: string[] } = {}): Promise<void> {
  await semJwt(c, async () => {
    await c.query("INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [uid, `${uid}@teste`]);
    await c.query(
      `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, $4, 'user')
       ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
      [uid, T, `${uid}@teste`, o.admin ? "RG admin" : "RG comum"],
    );
    if (o.admin) await c.query("INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin') ON CONFLICT DO NOTHING", [uid]);
    await c.query("DELETE FROM public.user_permissions WHERE user_id = $1", [uid]);
    for (const p of o.edita ?? []) {
      await c.query("INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, true, true)", [uid, T, p]);
    }
    for (const p of o.ve ?? []) {
      await c.query("INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, true, false)", [uid, T, p]);
    }
  });
}
export async function comoJwt(c: Client, uid: string): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
}
