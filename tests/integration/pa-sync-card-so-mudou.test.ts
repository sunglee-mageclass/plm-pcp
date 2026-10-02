/**
 * Produto Acabado: o save do produto só copia para o card (modelos) o que MUDOU no produto (P-136 A, 29/set).
 * Migration supabase/migrations/20261016100000_pa_sync_card_so_mudou.sql e inverso em supabase/rollback/.
 * Antes: _salvar_produto_acabado_core (texto da 20261014100000) fazia UPDATE incondicional de modelos.nome/categoria/subs
 * em TODO save — a Categoria trocada no Sheet do Planejamento voltava ao valor do produto.
 *
 * ⚠️ Os blocos de banco SÓ rodam na CÓPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres),
 * com a migration JÁ aplicada de verdade (psql -f). Cada teste em BEGIN…ROLLBACK: NADA é gravado. Nenhum arquivo de
 * migration é aplicado dentro de transação aqui. O bloco "estático" (só os arquivos) roda sempre.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261016100000_pa_sync_card_so_mudou.sql";
const INV = "supabase/rollback/20261016100000_pa_sync_card_so_mudou_down.sql";
const MIG_ANTERIOR = "supabase/migrations/20261014100000_tamanho_em_cards.sql";
const SIG = "_salvar_produto_acabado_core(uuid,jsonb,jsonb)";
const MD5_ANTES = "20f8e442b95f8bb02bc8201b431c21b1"; // texto da 20261014100000
const MD5_DEPOIS = "e5473bb29fa559408093d1a82c6ac11f"; // texto da 20261016100000
// LEVES L8 (20261028200000, preço M1 + sku #22) redefine o core POR CIMA desta: com a L8 viva na cópia o md5 vivo é o dela
// (o _down da L8 roda ANTES do inverso desta — LIFO).
const MD5_L8 = "77076d81637354d530ee38a03e8f77e7";
const T = TENANT_TESTE;
const LOCAL = ehBancoLocal();

// Trocas EXATAS (âncora 1× no texto da 20261014100000 → texto novo), transcritas — o resto é byte a byte igual.
const TROCAS: [string, string][] = [
  [
    "      from public.produtos_acabados\n      where id = _id and tenant_id = v_tenant;\n",
    "      from public.produtos_acabados\n      where id = _id and tenant_id = v_tenant\n" +
      "      for update;  -- [pa-sync v1] trava a linha: o \"antes\" comparado abaixo e o UPDATE veem o MESMO estado\n",
  ],
  [
    "    if v_modelo_id is not null then\n      update public.modelos set\n        nome = v_nome_final,\n" +
      "        categoria_principal_id = v_categoria_final,\n        subcategoria1_id = v_sub1_final,\n" +
      "        subcategoria2_id = v_sub2_final\n      where id = v_modelo_id;\n    end if;\n",
    "    -- [pa-sync v1] P-136 A: o card só recebe do produto o que MUDOU neste save (valor novo IS DISTINCT FROM o gravado\n" +
      "    -- antes, lido acima), coluna a coluna; o resto fica como está no card (ex.: Categoria trocada no Planejamento).\n" +
      "    -- Nada mudou (ou o card já tem o valor, ex.: nome já levado por trg_espelho_modelo_nome_ref) = nenhum UPDATE:\n" +
      "    -- o rev do card não sobe e a trava da Integração (trg_zz_integracao_trava) não é acionada.\n" +
      "    if v_modelo_id is not null then\n      update public.modelos set\n" +
      "        nome = case when v_nome_final is distinct from v_nome_atual then v_nome_final else nome end,\n" +
      "        categoria_principal_id = case when v_categoria_final is distinct from v_categoria_atual\n" +
      "                                      then v_categoria_final else categoria_principal_id end,\n" +
      "        subcategoria1_id = case when v_sub1_final is distinct from v_sub1_atual then v_sub1_final else subcategoria1_id end,\n" +
      "        subcategoria2_id = case when v_sub2_final is distinct from v_sub2_atual then v_sub2_final else subcategoria2_id end\n" +
      "      where id = v_modelo_id\n" +
      "        and ((v_nome_final is distinct from v_nome_atual and nome is distinct from v_nome_final)\n" +
      "          or (v_categoria_final is distinct from v_categoria_atual and categoria_principal_id is distinct from v_categoria_final)\n" +
      "          or (v_sub1_final is distinct from v_sub1_atual and subcategoria1_id is distinct from v_sub1_final)\n" +
      "          or (v_sub2_final is distinct from v_sub2_atual and subcategoria2_id is distinct from v_sub2_final));\n" +
      "    end if;\n",
  ],
];

const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
/** Texto da função no arquivo: de "CREATE OR REPLACE FUNCTION public._salvar_produto_acabado_core(" até o 2º "$function$". */
function corpo(rel: string): string {
  const t = ler(rel);
  const inicio = "CREATE OR REPLACE FUNCTION public._salvar_produto_acabado_core(";
  const i = t.indexOf(inicio);
  expect(i, `${rel}: função ausente`).toBeGreaterThanOrEqual(0);
  expect(t.indexOf(inicio, i + 1), `${rel}: função 2x`).toBe(-1);
  const a = t.indexOf("$function$", i);
  const f = t.indexOf("$function$", a + 10);
  return t.slice(i, f + 10);
}

// ─────────────────────────────── estático (sem banco) ───────────────────────────────
describe("PA sync só-mudou — arquivos (estático, sem banco)", () => {
  it("migration = texto da 20261014100000 + SÓ as 2 trocas; md5 antes/depois; guarda aceita os 2; pós exige DEPOIS; REVOKE dos 3", () => {
    const antes = corpo(MIG_ANTERIOR);
    const depois = corpo(MIG);
    expect(md5(antes + "\n")).toBe(MD5_ANTES);
    expect(md5(depois + "\n")).toBe(MD5_DEPOIS);
    let out = antes;
    for (const [velho, novo] of TROCAS) {
      expect(out.split(velho).length - 1, `âncora: ${velho.slice(0, 50)}`).toBe(1);
      out = out.split(velho).join(novo);
    }
    expect(out).toBe(depois);
    const m = ler(MIG);
    expect(m.replace(/^--[^\n]*\n/gm, "").trimStart().startsWith(
      "SET client_encoding = 'UTF8';\nBEGIN;\nSET LOCAL lock_timeout = '500ms';\nSET LOCAL statement_timeout = '3s';\n")).toBe(true);
    expect(m.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\n\nCOMMIT;")).toBe(true);
    expect(m).toContain(`IF v_md5 NOT IN ('${MD5_ANTES}', '${MD5_DEPOIS}') THEN`);
    expect(m).toContain(`IF v_md5 IS DISTINCT FROM '${MD5_DEPOIS}' THEN`);
    expect(m).toContain("REVOKE EXECUTE ON FUNCTION public._salvar_produto_acabado_core(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;");
    expect(m.indexOf("DO $pos$")).toBeGreaterThan(m.indexOf("REVOKE EXECUTE"));
    expect(m).not.toMatch(/^\s*\\/m); // nenhum meta-comando psql
  });

  it("inverso: recria EXATAMENTE o texto da 20261014100000; guarda = md5 de DEPOIS exato; pós = md5 de ANTES; REVOKE dos 3", () => {
    const v = ler(INV);
    expect(corpo(INV)).toBe(corpo(MIG_ANTERIOR));
    expect(v.replace(/^--[^\n]*\n/gm, "").trimStart().startsWith(
      "SET client_encoding = 'UTF8';\nBEGIN;\nSET LOCAL lock_timeout = '500ms';\nSET LOCAL statement_timeout = '3s';\n")).toBe(true);
    const guarda = v.slice(v.indexOf("DO $guarda$"), v.indexOf("END $guarda$"));
    expect(guarda).toContain(`IF v_md5 IS DISTINCT FROM '${MD5_DEPOIS}' THEN`);
    const pos = v.slice(v.indexOf("DO $pos$"), v.indexOf("END $pos$"));
    expect(pos).toContain(`IF v_md5 IS DISTINCT FROM '${MD5_ANTES}' THEN`);
    expect(v).toContain("REVOKE EXECUTE ON FUNCTION public._salvar_produto_acabado_core(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;");
    expect(v.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\n\nCOMMIT;")).toBe(true);
    expect(v).not.toMatch(/^\s*\\/m);
  });

  it("RAISE novos (migration e inverso) só com mensagem ASCII; P0001; cabeçalho sem tag $…$", () => {
    for (const rel of [MIG, INV]) {
      const txt = ler(rel);
      const msgs = [...txt.matchAll(/raise exception '((?:[^']|'')*)'/gi)].map((r) => r[1]).filter((s) => s.startsWith("pa_sync"));
      expect(msgs.length, rel).toBeGreaterThanOrEqual(3);
      for (const s of msgs) expect(/^[\x20-\x7e]*$/.test(s), `${rel}: ${s}`).toBe(true);
      expect(txt.slice(0, txt.indexOf("SET client_encoding")), rel).not.toMatch(/\$[A-Za-z_]*\$/);
    }
  });
});

// ─────────────────────────────── banco (cópia local, migration aplicada) ───────────────────────────────
type Ids = { grupo: string; catA: string; catB: string; s1A: string; s1B: string; s2A: string; s2B: string };
type Card = { nome: string | null; cat: string | null; s1: string | null; s2: string | null; rev: number };

async function ids(c: Client): Promise<Ids> {
  const r = await um<any>(c, `
    SELECT (SELECT id FROM public.grupos_produto WHERE tenant_id = $1 ORDER BY id LIMIT 1) AS grupo,
           (SELECT array_agg(id ORDER BY id) FROM (SELECT id FROM public.categorias_produto WHERE tenant_id = $1 ORDER BY id LIMIT 2) x) AS cats,
           (SELECT array_agg(id ORDER BY id) FROM (SELECT id FROM public.subcategorias1_produto WHERE tenant_id = $1 ORDER BY id LIMIT 2) x) AS s1,
           (SELECT array_agg(id ORDER BY id) FROM (SELECT id FROM public.subcategorias2_produto WHERE tenant_id = $1 ORDER BY id LIMIT 2) x) AS s2`, [T]);
  expect(r.grupo && r.cats?.length === 2 && r.s1?.length === 2 && r.s2?.length === 2,
    "a cópia precisa de 1 grupo, 2 categorias, 2 sub1 e 2 sub2 de produto na Loja Teste").toBe(true);
  return { grupo: r.grupo, catA: r.cats[0], catB: r.cats[1], s1A: r.s1[0], s1B: r.s1[1], s2A: r.s2[0], s2B: r.s2[1] };
}
const dadosDe = (k: Ids, o: Partial<Record<string, unknown>> = {}) => ({
  nome: "PASYNC Vestido", grupo_id: k.grupo, categoria_id: k.catA, subcategoria1_id: k.s1A, subcategoria2_id: k.s2A,
  qtd_total: 0, composicao: "algodao", ...o,
});
const salvar = (c: Client, id: string | null, dados: Record<string, unknown>) =>
  um<{ id: string }>(c, "SELECT public._salvar_produto_acabado_core($1::uuid, $2::jsonb, '[]'::jsonb) AS id", [id, JSON.stringify(dados)]);
const card = (c: Client, id: string) =>
  um<Card>(c, `SELECT nome, categoria_principal_id AS cat, subcategoria1_id AS s1, subcategoria2_id AS s2, rev
                 FROM public.modelos WHERE id = $1`, [id]);
/** Produto NOVO pelo save real + card pelo caminho real (_criar_card_produto_acabado_core). */
async function produtoComCard(c: Client, k: Ids): Promise<{ pid: string; mid: string }> {
  const pid = (await salvar(c, null, dadosDe(k))).id;
  const mid = (await um<{ id: string }>(c, "SELECT public._criar_card_produto_acabado_core($1) AS id", [pid])).id;
  return { pid, mid };
}
/** "Sheet do Planejamento": troca a Categoria/Sub1 do CARD e deixa o produto com o valor antigo (card × produto
 *  DIVERGENTES — o cenário da P-136). Desde a P-137 A (20261017100000) o gatilho trg_modelo_espelho_categoria leva a
 *  troca do card ao produto; para continuar exercitando a P-136 (o save do produto não pode desfazer o card), a
 *  taxonomia do produto é devolvida ao valor de antes — o mesmo estado de um produto legado divergente (o sentido
 *  produto -> card da categoria não tem gatilho, então isto não mexe no card). */
async function planejamentoTroca(c: Client, mid: string, cat: string, s1: string) {
  const antes = await um<any>(c, `SELECT id, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id
                                    FROM public.produtos_acabados WHERE modelo_id = $1`, [mid]);
  await c.query("UPDATE public.modelos SET categoria_principal_id = $2, subcategoria1_id = $3 WHERE id = $1", [mid, cat, s1]);
  if (antes) {
    await c.query(`UPDATE public.produtos_acabados SET grupo_id = $2, categoria_id = $3, subcategoria1_id = $4, subcategoria2_id = $5
                    WHERE id = $1`, [antes.id, antes.grupo_id, antes.categoria_id, antes.subcategoria1_id, antes.subcategoria2_id]);
  }
}
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<string> {
  await c.query("SAVEPOINT pasync_f");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT pasync_f");
    return "PASSOU";
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT pasync_f");
    return `${e.code} ${e.message}`;
  }
}
async function prepara(c: Client): Promise<Ids> {
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '60s'");
  await comoUsuario(c);
  return ids(c);
}

describe.skipIf(!(hasDb && LOCAL))("PA sync só-mudou — banco (cópia local)", () => {
  it("migration aplicada: md5 vivo = DEPOIS; EXECUTE negado a PUBLIC/anon/authenticated (inv. #9)", async () => {
    await withTx(async (c) => {
      const r = await um<any>(c, `SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m,
          has_function_privilege('public', to_regprocedure($1), 'EXECUTE') AS p,
          has_function_privilege('anon', to_regprocedure($1), 'EXECUTE') AS a,
          has_function_privilege('authenticated', to_regprocedure($1), 'EXECUTE') AS u`, [`public.${SIG}`]);
      expect([MD5_DEPOIS, MD5_L8]).toContain(r.m);
      expect({ ...r, m: undefined }).toEqual({ m: undefined, p: false, a: false, u: false });
    });
  });

  it("produto NOVO: comportamento de hoje — o card nasce com nome/categoria/subs do produto; o 1º save que muda a categoria leva ao card", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const { pid, mid } = await produtoComCard(c, k);
      expect(await card(c, mid)).toMatchObject({ nome: "PASYNC Vestido", cat: k.catA, s1: k.s1A, s2: k.s2A });
      await salvar(c, pid, dadosDe(k, { categoria_id: k.catB, subcategoria2_id: k.s2B }));
      expect(await card(c, mid)).toMatchObject({ nome: "PASYNC Vestido", cat: k.catB, s1: k.s1A, s2: k.s2B });
    });
  });

  it("BUG P-136: categoria/sub1 trocadas no Planejamento + editar OUTRO campo do produto -> card PRESERVADO (e rev não sobe)", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const { pid, mid } = await produtoComCard(c, k);
      await planejamentoTroca(c, mid, k.catB, k.s1B);
      const antes = await card(c, mid);
      await salvar(c, pid, dadosDe(k, { composicao: "linho", ref_fornecedor: "F-99" }));
      const pa = await um<any>(c, "SELECT composicao, ref_fornecedor, categoria_id FROM public.produtos_acabados WHERE id = $1", [pid]);
      expect(pa).toEqual({ composicao: "linho", ref_fornecedor: "F-99", categoria_id: k.catA }); // o produto salvou
      expect(await card(c, mid)).toEqual(antes); // categoria B, sub1 B, nome e rev intactos
    });
  });

  it("mudar a categoria NO PRODUTO -> card atualiza SÓ a categoria (sub1 trocada no Planejamento continua)", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const { pid, mid } = await produtoComCard(c, k);
      await planejamentoTroca(c, mid, k.catA, k.s1B); // Planejamento mexeu só na sub1
      const rev0 = (await card(c, mid)).rev;
      await salvar(c, pid, dadosDe(k, { categoria_id: k.catB }));
      const d = await card(c, mid);
      expect(d).toMatchObject({ nome: "PASYNC Vestido", cat: k.catB, s1: k.s1B, s2: k.s2A });
      expect(d.rev).toBe(rev0 + 1);
    });
  });

  it("mudar SÓ o nome -> só o nome do card muda (categoria do Planejamento preservada); 1 UPDATE só (sem 2º bump)", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const { pid, mid } = await produtoComCard(c, k);
      await planejamentoTroca(c, mid, k.catB, k.s1B);
      const rev0 = (await card(c, mid)).rev;
      await salvar(c, pid, dadosDe(k, { nome: "PASYNC Vestido Novo" }));
      const d = await card(c, mid);
      expect(d).toMatchObject({ nome: "PASYNC Vestido Novo", cat: k.catB, s1: k.s1B, s2: k.s2A });
      // o nome chega pelo gatilho da mão dupla (trg_espelho_modelo_nome_ref); o UPDATE da função vê o card já igual
      expect(d.rev).toBe(rev0 + 1);
    });
  });

  it("mudar SÓ a subcategoria2 -> só a sub2 do card muda (categoria/sub1 do Planejamento preservadas); rev +1", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const { pid, mid } = await produtoComCard(c, k);
      await planejamentoTroca(c, mid, k.catB, k.s1B);
      const rev0 = (await card(c, mid)).rev;
      await salvar(c, pid, dadosDe(k, { subcategoria2_id: k.s2B }));
      const d = await card(c, mid);
      expect(d).toMatchObject({ nome: "PASYNC Vestido", cat: k.catB, s1: k.s1B, s2: k.s2B });
      expect(d.rev).toBe(rev0 + 1);
    });
  });

  it("valor -> NULL e NULL -> valor (sub2 no produto) chegam ao card; categoria/sub1 do Planejamento preservadas", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const { pid, mid } = await produtoComCard(c, k);
      await planejamentoTroca(c, mid, k.catB, k.s1B);
      const rev0 = (await card(c, mid)).rev;
      await salvar(c, pid, dadosDe(k, { subcategoria2_id: null })); // valor -> NULL
      let d = await card(c, mid);
      expect(d).toMatchObject({ nome: "PASYNC Vestido", cat: k.catB, s1: k.s1B, s2: null });
      expect(d.rev).toBe(rev0 + 1);
      await salvar(c, pid, dadosDe(k, { subcategoria2_id: k.s2B })); // NULL -> valor
      d = await card(c, mid);
      expect(d).toMatchObject({ nome: "PASYNC Vestido", cat: k.catB, s1: k.s1B, s2: k.s2B });
      expect(d.rev).toBe(rev0 + 2);
      await salvar(c, pid, dadosDe(k, { subcategoria2_id: k.s2B })); // NULL->valor já assentado: nada muda
      expect((await card(c, mid)).rev).toBe(rev0 + 2);
    });
  });

  it("categoria muda no produto mas o card JÁ tem esse valor -> nenhum UPDATE (rev e linha inteira iguais)", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const { pid, mid } = await produtoComCard(c, k);
      await planejamentoTroca(c, mid, k.catB, k.s1A); // card já em B; produto ainda em A
      const linha = async () => (await um<{ j: any }>(c, "SELECT to_jsonb(m.*) AS j FROM public.modelos m WHERE id = $1", [mid])).j;
      const antes = await linha();
      await salvar(c, pid, dadosDe(k, { categoria_id: k.catB })); // produto A -> B
      expect((await um<any>(c, "SELECT categoria_id FROM public.produtos_acabados WHERE id = $1", [pid])).categoria_id).toBe(k.catB);
      expect(await linha()).toEqual(antes);
    });
  });

  it("save SEM mudança nenhuma -> nenhum UPDATE em modelos (rev e linha inteira iguais)", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const { pid, mid } = await produtoComCard(c, k);
      await salvar(c, pid, dadosDe(k)); // aquecimento (recompute de preço etc. já assentado)
      const linha = async () => (await um<{ j: any }>(c, "SELECT to_jsonb(m.*) AS j FROM public.modelos m WHERE id = $1", [mid])).j;
      const antes = await linha();
      await salvar(c, pid, dadosDe(k));
      expect(await linha()).toEqual(antes);
    });
  });

  it("produto INTEGRÁVEL com 'nome' travado e nome do card divergente: save sem mudar o nome passa (sem 42501) e não toca o card; mudar o nome segue recusado", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const pid = (await salvar(c, null, dadosDe(k))).id;
      // card com nome DIVERGENTE do produto (dado legado): criado à parte e vinculado (vincular não aciona a mão dupla)
      const mid = (await um<{ id: string }>(c,
        `INSERT INTO public.modelos (tenant_id, nome, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id)
         VALUES ($1, 'PASYNC Card Divergente', 'revenda', $2, $3, $4) RETURNING id`, [T, k.catA, k.s1A, k.s2A])).id;
      await c.query("UPDATE public.produtos_acabados SET modelo_id = $2 WHERE id = $1", [pid, mid]);
      await c.query(
        "INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos) VALUES ($1, $2, 'integravel', ARRAY['nome'])",
        [T, mid]);
      const antes = await card(c, mid);
      expect(await falha(c, "SELECT public._salvar_produto_acabado_core($1::uuid, $2::jsonb, '[]'::jsonb)",
        [pid, JSON.stringify(dadosDe(k, { composicao: "seda" }))])).toBe("PASSOU");
      expect(await card(c, mid)).toEqual(antes);
      // mudança REAL de nome continua travada (a trava não foi afrouxada)
      expect(await falha(c, "SELECT public._salvar_produto_acabado_core($1::uuid, $2::jsonb, '[]'::jsonb)",
        [pid, JSON.stringify(dadosDe(k, { nome: "PASYNC Outro Nome" }))])).toMatch(/^42501 integracao_travado: nome/);
    });
  });
});
