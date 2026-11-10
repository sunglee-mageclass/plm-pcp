/**
 * Paridade PA/PI (Task 1, nov/2026): `_salvar_produto_acabado_core` passa a aceitar, em `_dados`,
 *  - `linha_id`  -> REFLEXIVO: grava `modelos.linha_id` do card espelho (a linha e do MODELO, nao do produto);
 *  - `status`    -> `produtos_acabados.status` ('pendente'|'reprovado'; coluna nova, so vale p/ produto SEM card).
 * Padrao `_dados ? 'chave'` (presente grava, ausente MANTEM) — igual ao `tamanho_tipo`.
 * Migration: supabase/migrations/20261118100000_pa_linha_status.sql (inverso em supabase/rollback/).
 *
 * Os blocos de banco SO rodam na COPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres), com a
 * migration JA aplicada (psql -f). Cada teste em BEGIN...ROLLBACK. Nenhum arquivo de migration e aplicado dentro de txn aqui.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, ehBancoLocal, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261118100000_pa_linha_status.sql";
const INV = "supabase/rollback/20261118100000_pa_linha_status_down.sql";
const SIG = "public._salvar_produto_acabado_core(uuid,jsonb,jsonb)";
const MD5_ANTES = "43a9ec5e03ddd9d85e016cb1ca516843"; // R13
const T = TENANT_TESTE;
const LOCAL = hasDb && ehBancoLocal();

const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
/** Texto da funcao no arquivo: de "CREATE OR REPLACE FUNCTION public._salvar_produto_acabado_core(" ate o 2o "$function$". */
function corpo(rel: string): string {
  const t = ler(rel);
  const inicio = "CREATE OR REPLACE FUNCTION public._salvar_produto_acabado_core(";
  const i = t.indexOf(inicio);
  expect(i, `${rel}: funcao ausente`).toBeGreaterThanOrEqual(0);
  expect(t.indexOf(inicio, i + 1), `${rel}: funcao 2x`).toBe(-1);
  const a = t.indexOf("$function$", i);
  const f = t.indexOf("$function$", a + 10);
  return t.slice(i, f + 10);
}

// --------------------------------- estatico (sem banco) ---------------------------------
describe("PA linha+status — arquivos (estatico)", () => {
  it("ida: guarda aceita ANTES e DEPOIS; REVOKE dos 3; coluna+CHECK; RAISE so ASCII; padrao `_dados ?`", () => {
    const m = ler(MIG);
    const c = corpo(MIG);
    expect(m).toContain(MD5_ANTES);
    expect(m).toContain("ADD COLUMN IF NOT EXISTS status text");
    expect(m).toContain("produtos_acabados_status_chk");
    expect(m).toContain("REVOKE EXECUTE ON FUNCTION public._salvar_produto_acabado_core(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;");
    expect(c).toContain("when _dados ? 'status' then v_status else status end");
    expect(c).toContain("_dados ? 'linha_id'");
    // todas as mensagens NOVAS (as que a migration acrescenta) sao ASCII; o resto do corpo (herdado) tem acento de proposito
    for (const msg of ["Linha de outra loja", "status invalido: use pendente ou reprovado"]) {
      expect(c).toContain(msg);
      expect(/^[\x20-\x7e]*$/.test(msg), msg).toBe(true);
    }
  });

  it("inverso: devolve o corpo de ANTES (md5 43a9ec5e) e remove a coluna status; guarda md5 do NOVO", () => {
    const v = ler(INV);
    expect(v).toContain(MD5_ANTES);
    expect(v).toMatch(/DROP COLUMN IF EXISTS status/);
    expect(v).toContain("REVOKE EXECUTE ON FUNCTION public._salvar_produto_acabado_core(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;");
    // o corpo do inverso e o do R13 (sem linha_id/status)
    const c = corpo(INV);
    expect(md5(c + "\n")).toBe(MD5_ANTES);
    expect(c).not.toContain("v_linha");
    expect(c).not.toContain("v_status");
  });
});

// --------------------------------- banco (copia local, migration aplicada) ---------------------------------
type Ids = { grupo: string; cat: string };
async function ids(c: Client): Promise<Ids> {
  const r = await um<any>(c, `
    SELECT (SELECT id FROM public.grupos_produto WHERE tenant_id = $1 ORDER BY id LIMIT 1) AS grupo,
           (SELECT id FROM public.categorias_produto WHERE tenant_id = $1 ORDER BY id LIMIT 1) AS cat`, [T]);
  expect(r.grupo && r.cat, "a copia precisa de 1 grupo e 1 categoria de produto na Loja Teste").toBeTruthy();
  return { grupo: r.grupo, cat: r.cat };
}
const dadosDe = (k: Ids, o: Record<string, unknown> = {}) => ({
  nome: "PALS Vestido", grupo_id: k.grupo, categoria_id: k.cat, qtd_total: 0, ...o,
});
const salvar = (c: Client, id: string | null, dados: Record<string, unknown>) =>
  um<{ id: string }>(c, "SELECT public._salvar_produto_acabado_core($1::uuid, $2::jsonb, '[]'::jsonb) AS id", [id, JSON.stringify(dados)]);
/** Produto NOVO pelo save real + card pelo caminho real (_criar_card_produto_acabado_core). */
async function produtoComCard(c: Client, k: Ids): Promise<{ pid: string; mid: string }> {
  const pid = (await salvar(c, null, dadosDe(k))).id;
  const mid = (await um<{ id: string }>(c, "SELECT public._criar_card_produto_acabado_core($1) AS id", [pid])).id;
  return { pid, mid };
}
const linhaDoCard = async (c: Client, mid: string) =>
  (await um<{ l: string | null }>(c, "SELECT linha_id AS l FROM public.modelos WHERE id = $1", [mid])).l;
const statusDoProduto = async (c: Client, pid: string) =>
  (await um<{ s: string | null }>(c, "SELECT status AS s FROM public.produtos_acabados WHERE id = $1", [pid])).s;
async function novaLinha(c: Client, tenant: string, nome: string): Promise<string> {
  return (await um<{ id: string }>(c, "INSERT INTO public.linhas (tenant_id, nome) VALUES ($1, $2) RETURNING id", [tenant, nome])).id;
}
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<string> {
  await c.query("SAVEPOINT pals_f");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT pals_f");
    return "PASSOU";
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT pals_f");
    return `${e.code} ${e.message}`;
  }
}
async function prepara(c: Client): Promise<Ids> {
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '60s'");
  await comoUsuario(c);
  return ids(c);
}

describe.skipIf(!LOCAL)("PA linha+status — banco (copia local)", () => {
  it("migration aplicada: md5 vivo difere do R13; EXECUTE negado a PUBLIC/anon/authenticated (inv. #9); coluna status + CHECK", async () => {
    await withTx(async (c) => {
      const r = await um<any>(c, `SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m,
          has_function_privilege('public', to_regprocedure($1), 'EXECUTE') AS p,
          has_function_privilege('anon', to_regprocedure($1), 'EXECUTE') AS a,
          has_function_privilege('authenticated', to_regprocedure($1), 'EXECUTE') AS u`, [SIG]);
      expect(r.m).not.toBe(MD5_ANTES);
      expect(r.m).toBe(md5(corpo(MIG) + "\n"));
      expect({ ...r, m: undefined }).toEqual({ m: undefined, p: false, a: false, u: false });
      const col = await um<any>(c, `SELECT data_type FROM information_schema.columns
                                      WHERE table_schema='public' AND table_name='produtos_acabados' AND column_name='status'`);
      expect(col?.data_type).toBe("text");
      const chk = await um<any>(c, `SELECT convalidated FROM pg_constraint WHERE conname='produtos_acabados_status_chk'`);
      expect(chk?.convalidated).toBe(true);
    });
  });

  it("(a) _dados com linha_id grava modelos.linha_id do card espelho", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const { pid, mid } = await produtoComCard(c, k);
      expect(await linhaDoCard(c, mid)).toBeNull();
      const l1 = await novaLinha(c, T, "PALS Linha A");
      await salvar(c, pid, dadosDe(k, { linha_id: l1 }));
      expect(await linhaDoCard(c, mid)).toBe(l1);
      // trocar de linha
      const l2 = await novaLinha(c, T, "PALS Linha B");
      await salvar(c, pid, dadosDe(k, { linha_id: l2 }));
      expect(await linhaDoCard(c, mid)).toBe(l2);
      // `linha_id: null` (chave presente, vazia) LIMPA a linha do card
      await salvar(c, pid, dadosDe(k, { linha_id: null }));
      expect(await linhaDoCard(c, mid)).toBeNull();
    });
  });

  it("(b) _dados SEM linha_id/status mantem a linha do card e o status do produto (site antigo nao apaga)", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const { pid, mid } = await produtoComCard(c, k);
      const l1 = await novaLinha(c, T, "PALS Linha Mantem");
      await salvar(c, pid, dadosDe(k, { linha_id: l1, status: "pendente" }));
      expect(await linhaDoCard(c, mid)).toBe(l1);
      expect(await statusDoProduto(c, pid)).toBe("pendente");
      await salvar(c, pid, dadosDe(k, { composicao: "linho" })); // nenhuma das 2 chaves
      expect(await linhaDoCard(c, mid)).toBe(l1);
      expect(await statusDoProduto(c, pid)).toBe("pendente");
    });
  });

  it("(c) status 'reprovado'/'pendente' grava em produtos_acabados.status; vazio limpa; invalido = P0001", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const pid = (await salvar(c, null, dadosDe(k, { status: "reprovado" }))).id; // produto SEM card, criado ja reprovado
      expect(await statusDoProduto(c, pid)).toBe("reprovado");
      await salvar(c, pid, dadosDe(k, { status: "pendente" }));
      expect(await statusDoProduto(c, pid)).toBe("pendente");
      await salvar(c, pid, dadosDe(k, { status: "" })); // chave presente e vazia = limpa
      expect(await statusDoProduto(c, pid)).toBeNull();
      const f = await falha(c, "SELECT public._salvar_produto_acabado_core($1::uuid, $2::jsonb, '[]'::jsonb)",
        [pid, JSON.stringify(dadosDe(k, { status: "aprovado" }))]);
      expect(f).toMatch(/^P0001 status invalido/);
      expect(/^[\x20-\x7e]*$/.test(f)).toBe(true);
    });
  });

  it("(d) linha de OUTRA loja = P0001 'Linha de outra loja' (ASCII); nada grava; linha inexistente tambem", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const { pid, mid } = await produtoComCard(c, k);
      const outra = (await um<{ id: string }>(c, "SELECT id FROM public.tenants WHERE id <> $1 ORDER BY id LIMIT 1", [T]))?.id;
      expect(outra, "a copia precisa de ao menos 2 lojas").toBeTruthy();
      const lOutra = await novaLinha(c, outra, "PALS Linha Outra Loja");
      const f = await falha(c, "SELECT public._salvar_produto_acabado_core($1::uuid, $2::jsonb, '[]'::jsonb)",
        [pid, JSON.stringify(dadosDe(k, { linha_id: lOutra, composicao: "nao-grava" }))]);
      expect(f).toMatch(/^P0001 Linha de outra loja/);
      expect(/^[\x20-\x7e]*$/.test(f)).toBe(true);
      expect(await linhaDoCard(c, mid)).toBeNull();
      const f2 = await falha(c, "SELECT public._salvar_produto_acabado_core($1::uuid, $2::jsonb, '[]'::jsonb)",
        [pid, JSON.stringify(dadosDe(k, { linha_id: "00000000-0000-4000-8000-0000000000aa" }))]);
      expect(f2).toMatch(/^P0001 Linha de outra loja/);
    });
  });

  it("linha_id em produto SEM card: aceita e ignora (nao ha modelo p/ refletir); o produto salva normal", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const l1 = await novaLinha(c, T, "PALS Linha SemCard");
      const pid = (await salvar(c, null, dadosDe(k, { linha_id: l1 }))).id;
      const p = await um<any>(c, "SELECT modelo_id, nome FROM public.produtos_acabados WHERE id = $1", [pid]);
      expect(p.modelo_id).toBeNull();
      expect(p.nome).toBe("PALS Vestido");
    });
  });

  it("linha reflexiva: mudar so a linha nao altera nome/categoria do card (P-136 intacta) e o save sem linha_id nao zera", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const { pid, mid } = await produtoComCard(c, k);
      const l1 = await novaLinha(c, T, "PALS Linha Reflexo");
      await salvar(c, pid, dadosDe(k, { linha_id: l1 }));
      const m = await um<any>(c, "SELECT nome, categoria_principal_id AS cat, linha_id FROM public.modelos WHERE id = $1", [mid]);
      expect(m).toMatchObject({ nome: "PALS Vestido", cat: k.cat, linha_id: l1 });
    });
  });
});
