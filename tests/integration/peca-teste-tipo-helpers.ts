/**
 * Reforma da Peça Teste por TIPO — ferramentas dos testes de integração (cópia LOCAL, txn revertida). As 5 migrations da reforma são aplicadas
 * DENTRO da txn do teste por `aplicarArquivo` (mig-txn: sem BEGIN/COMMIT, nunca \i), na ordem, até a pedida; arquivo que ainda não existe no
 * repositório é PULADO (TDD: o teste da Task N roda "vermelho" antes de a migration da Task N existir). As RPCs rodam com o JWT do dono
 * (super admin da Loja Teste, passa os portões de módulo e de página da seção). Nada grava na cópia: BEGIN…ROLLBACK.
 */
import type { Client } from "pg";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { um, comoUsuario, semJwt, TENANT_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const T = TENANT_TESTE;
export const D1 = "2026-10-01";
export const D2 = "2026-10-03";

export const MIGS = {
  dados: "supabase/migrations/20261129100000_peca_teste_tipo_dados.sql",
  predicado: "supabase/migrations/20261129110000_peca_teste_tipo_predicado.sql",
  salvar: "supabase/migrations/20261129120000_peca_teste_tipo_salvar.sql",
  leitura: "supabase/migrations/20261129130000_peca_teste_tipo_leitura.sql",
  evalpl: "supabase/migrations/20261129140000_etapas_pl_cond_mo_grade.sql",
} as const;
export const DOWNS = {
  dados: "supabase/rollback/20261129100000_peca_teste_tipo_dados_down.sql",
  predicado: "supabase/rollback/20261129110000_peca_teste_tipo_predicado_down.sql",
  salvar: "supabase/rollback/20261129120000_peca_teste_tipo_salvar_down.sql",
  leitura: "supabase/rollback/20261129130000_peca_teste_tipo_leitura_down.sql",
  evalpl: "supabase/rollback/20261129140000_etapas_pl_cond_mo_grade_down.sql",
} as const;
export type Ate = keyof typeof MIGS;
const ORDEM: Ate[] = ["dados", "predicado", "salvar", "leitura", "evalpl"];

/** Aplica dentro da txn as migrations da reforma até `ate` (inclusive); `null` = nenhuma. Idempotente (as guardas aceitam o "depois"). */
export async function aplicaReforma(c: Client, ate: Ate | null): Promise<void> {
  if (ate === null) return;
  for (const k of ORDEM) {
    if (existsSync(ROOT + MIGS[k])) await aplicarArquivo(c, MIGS[k]);
    if (k === ate) break;
  }
}

/** Prepara a txn: migrations até `ate`, módulos ligados e JWT do dono (a loja ativa dele = Loja Teste). */
export async function prepara(c: Client, ate: Ate | null): Promise<void> {
  await c.query("SET LOCAL statement_timeout = '180s'");
  await aplicaReforma(c, ate);
  await semJwt(c, () =>
    c.query(
      `UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb)
         || '{"criacao": true, "producao": true, "entrada_saida": true, "etapas_pl": true}'::jsonb WHERE tenant_id = $1`,
      [T],
    ),
  );
  await comoUsuario(c);
}

/** Escrita de PREPARAÇÃO que não deve acionar o enfileirador do kanban. */
export async function comoSistema<R>(c: Client, fn: () => Promise<R>): Promise<R> {
  await c.query("SELECT set_config('app.kanban_sistema', 'teste', true)");
  try {
    return await fn();
  } finally {
    await c.query("SELECT set_config('app.kanban_sistema', '', true)");
  }
}

let seq = 0;
export const suf = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export async function novaCategoria(c: Client, nome: string, exige: boolean, ordem = 9300): Promise<string> {
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.categorias_terceirizado (tenant_id, nome, etapa, ordem, exige_peca_teste, ativo)
       VALUES ($1, $2, 'ate_costura', $3, $4, true) RETURNING id`,
      [T, `${nome} ${suf()}`, ordem, exige],
    )
  ).id;
}
/** Fornecedor de SERVIÇO da loja; `vinculadoA` = tipos aos quais ele é vinculado (empresa_categorias_servico). */
export async function novoFornecedor(c: Client, nome: string, vinculadoA: string[] = []): Promise<string> {
  const id = (
    await um<{ id: string }>(c, "INSERT INTO public.empresas (tenant_id, nome_fantasia, tipo) VALUES ($1, $2, 'servico') RETURNING id", [T, `${nome} ${suf()}`])
  ).id;
  for (const cat of vinculadoA) {
    await c.query("INSERT INTO public.empresa_categorias_servico (empresa_id, categoria_terceirizado_id) VALUES ($1, $2)", [id, cat]);
  }
  return id;
}
export async function novoModelo(c: Client, nome: string): Promise<string> {
  return comoSistema(c, async () =>
    (
      await um<{ id: string }>(
        c,
        `INSERT INTO public.modelos (tenant_id, nome, ordem_criacao_enviada, status_desenvolvimento)
         VALUES ($1, $2, true, 'entrada') RETURNING id`,
        [T, `${nome} ${suf()}`],
      )
    ).id,
  );
}
/** Linha de M.O. (JWT do dono: `aprovado` exige producao_servico_aprovacao). cat null = "Geral (legado)". */
export async function novaLinhaMo(c: Client, modelo: string, cat: string | null, emp: string | null, aprovado: boolean | null): Promise<string> {
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, empresa_id, aprovado, motivo_reprovacao)
       VALUES ($1, $2, $3, 10, $4, $5, CASE WHEN $5 IS FALSE THEN 'teste reforma' END) RETURNING id`,
      [T, modelo, cat, emp, aprovado],
    )
  ).id;
}
/** Tentativa semeada DIRETO (só a fixture). `decidida` exige as 2 datas (CHECK da tabela). */
export async function novaTentativa(
  c: Client,
  o: { modelo: string; cat: string; numero: number; aprovacao?: string | null; emp?: string | null; linha?: string | null; criadoEm?: string; saida?: string | null; entrada?: string | null },
): Promise<string> {
  const decidida = !!o.aprovacao;
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.modelo_peca_teste_tentativas
         (tenant_id, modelo_id, mo_linha_id, categoria_terceirizado_id, numero, empresa_id, data_saida, data_entrada, aprovacao, decidido_em, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, CASE WHEN $9::text IS NOT NULL THEN now() END, coalesce($10::timestamptz, now()))
       RETURNING id`,
      [T, o.modelo, o.linha ?? null, o.cat, o.numero, o.emp ?? null, o.saida === undefined ? D1 : o.saida, decidida ? (o.entrada ?? D2) : (o.entrada ?? null), o.aprovacao ?? null, o.criadoEm ?? null],
    )
  ).id;
}

export type Linha = { id: string; numero: number; empresa_id: string | null; aprovacao: string | null; data_saida: string | null; data_entrada: string | null; rev: number; mo_linha_id: string | null };
export async function tentativas(c: Client, modelo: string, cat?: string): Promise<Linha[]> {
  return (
    await c.query(
      `SELECT id, numero, empresa_id, aprovacao, to_char(data_saida, 'YYYY-MM-DD') AS data_saida, to_char(data_entrada, 'YYYY-MM-DD') AS data_entrada, rev, mo_linha_id
         FROM public.modelo_peca_teste_tentativas WHERE modelo_id = $1 AND ($2::uuid IS NULL OR categoria_terceirizado_id = $2) ORDER BY categoria_terceirizado_id, numero`,
      [modelo, cat ?? null],
    )
  ).rows as Linha[];
}

/** Payload de UMA tentativa para o `salvar_peca_teste`. Existente: `id` + (rev em `_rev_base`). Nova: `id: null` + `numero`. */
export type TentPayload = { id: string | null; numero: number; empresa_id?: string | null; data_saida: string | null; data_entrada: string | null; aprovacao: string | null; mini?: unknown };
export type TrilhaPayload = { categoria_id: string; tentativas: TentPayload[]; excluir?: string[] };
export const tp = (o: Partial<TentPayload> & { numero: number }): TentPayload => ({ id: null, data_saida: null, data_entrada: null, aprovacao: null, ...o });

export async function salvarPT(c: Client, modelo: string, trilhas: TrilhaPayload[], revs: Record<string, number> = {}): Promise<void> {
  await c.query("SELECT public.salvar_peca_teste($1, $2::jsonb, $3::jsonb)", [modelo, JSON.stringify(trilhas), JSON.stringify({ tentativas: revs })]);
}
export async function lerPT(c: Client, modelo: string): Promise<any> {
  return (await um<{ j: any }>(c, "SELECT public.peca_teste_modelo($1) AS j", [modelo])).j;
}
/** Roda `fn` num SAVEPOINT; devolve o erro (code + message) ou null se passou (e nesse caso MANTÉM o que gravou). */
export async function tenta(c: Client, fn: () => Promise<unknown>): Promise<{ code?: string; message: string } | null> {
  await c.query("SAVEPOINT pt_tenta");
  try {
    await fn();
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT pt_tenta");
    await c.query("RELEASE SAVEPOINT pt_tenta");
    return e as { code?: string; message: string };
  }
  await c.query("RELEASE SAVEPOINT pt_tenta");
  return null;
}
export const CONFLITO = /^peca_teste_conflito: /;

/**
 * A reforma por TIPO está VIVA nesta txn? (o core do Salvar carrega o marcador `[reforma pt]`.) Depois dela, a cadeia R9/R11 (urgc/urgd) JÁ está no
 * banco e NÃO é reencenável (a reforma re-emite o core, a mini e a trava; as guardas md5 das migrations antigas recusariam): `aplicaUrgc`/`aplicaUrgd`
 * viram no-op quando ela está viva.
 */
export async function reformaPtViva(c: Client): Promise<boolean> {
  const r = await um<{ ok: boolean | null }>(
    c, "SELECT position('[reforma pt]' in pg_get_functiondef(to_regprocedure('public._salvar_peca_teste_core(uuid,jsonb,jsonb)'))) > 0 AS ok",
  );
  return r?.ok === true;
}

/**
 * Testes que descrevem a TRANSIÇÃO (migração de dados, ida/volta, "antes × depois") só fazem sentido com o banco ANTES da reforma. Com ela já viva
 * (cópia local migrada de verdade, banco pós-deploy) eles PULAM em vez de falhar.
 */
export async function exigePreReforma(c: Client, ctx: { skip: (note?: string) => never }): Promise<void> {
  if (await reformaPtViva(c)) ctx.skip("a reforma por TIPO já está viva neste banco — teste de transição só roda no banco ANTES");
}
