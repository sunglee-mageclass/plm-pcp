/**
 * Paridade PA/PI (complemento, nov/2026): a LINHA tambem SEM card, com espelho BIDIRECIONAL produto <-> card.
 *  - `produtos_acabados.linha_id` / `produtos_importados.linha_id` (colunas novas, FK linhas, nullable);
 *  - `_salvar_produto_*_core` grava `produtos_*.linha_id` SEMPRE (com ou sem card) + `modelos.linha_id` quando tem card;
 *  - `fn_modelo_espelho_categoria` (trigger AFTER UPDATE em modelos) copia `modelos.linha_id` -> produto (inclusive NULL);
 *  - `_criar_card_produto_*_core`: o card HERDA `produto.linha_id` (antes nascia null).
 * Migration: supabase/migrations/20261118130000_pa_pi_linha_produto.sql (inverso em supabase/rollback/).
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
const MIG = "supabase/migrations/20261118130000_pa_pi_linha_produto.sql";
const INV = "supabase/rollback/20261118130000_pa_pi_linha_produto_down.sql";
const T = TENANT_TESTE;
const LOCAL = hasDb && ehBancoLocal();

// ANTES = md5 vivo apos a paridade PA/PI (Tasks 1-3); DEPOIS = este complemento.
const FUNCS: Record<string, { sig: string; antes: string; depois: string }> = {
  salvarPA: { sig: "public._salvar_produto_acabado_core(uuid,jsonb,jsonb)", antes: "8380b15f5ae3ad9d581d3205cb23a4ec", depois: "53a0745fd4f548547485679c19c2363a" },
  salvarPI: { sig: "public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)", antes: "d857ebb676241e411666d699142ccabd", depois: "ba8ba0f0476c351bfa9d430ec12dc8af" },
  cardPA: { sig: "public._criar_card_produto_acabado_core(uuid)", antes: "dcbfa5bd2d3cee921d46a9335b3f468c", depois: "2bb5b74a8e2b4130d426310d62069d82" },
  cardPI: { sig: "public._criar_card_produto_importado_core(uuid)", antes: "33b39eab715ac168af5e678e0a051e60", depois: "e12562cee2e7530c4d7256213e7d4926" },
  espelho: { sig: "public.fn_modelo_espelho_categoria()", antes: "2e0c70f661e42610e87da2b934dec962", depois: "640a14561ed5cbe6d02855580915e96c" },
};

const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
/** Texto da funcao no arquivo: de "CREATE OR REPLACE FUNCTION public.<nome>(" ate o 2o "$function$". */
function corpo(rel: string, nome: string): string {
  const t = ler(rel);
  const inicio = `CREATE OR REPLACE FUNCTION public.${nome}(`;
  const i = t.indexOf(inicio);
  expect(i, `${rel}: ${nome} ausente`).toBeGreaterThanOrEqual(0);
  expect(t.indexOf(inicio, i + 1), `${rel}: ${nome} 2x`).toBe(-1);
  const a = t.indexOf("$function$", i);
  const f = t.indexOf("$function$", a + 10);
  return t.slice(i, f + 10);
}
const nomeDe = (sig: string) => sig.replace("public.", "").split("(")[0];

// --------------------------------- estatico (sem banco) ---------------------------------
describe("PA/PI linha no produto — arquivos (estatico)", () => {
  it("ida: guarda aceita ANTES e DEPOIS dos 5; colunas+indices parciais; REVOKE dos 4 cores; trigger com linha_id; corpos = md5 pinado", () => {
    const m = ler(MIG);
    for (const [k, f] of Object.entries(FUNCS)) {
      expect(m, k).toContain(`'${f.antes}', '${f.depois}'`);
      expect(md5(corpo(MIG, nomeDe(f.sig)) + "\n"), k).toBe(f.depois);
    }
    for (const t of ["produtos_acabados", "produtos_importados"]) {
      expect(m).toContain(`ALTER TABLE public.${t}`);
      expect(m).toMatch(new RegExp(`ON public\\.${t} \\(linha_id\\)\\s+WHERE linha_id IS NOT NULL`));
    }
    expect(m).toContain("REFERENCES public.linhas(id)");
    expect(m).not.toMatch(/REFERENCES public\.linhas\(id\)\s+ON DELETE/);
    for (const r of [
      "_salvar_produto_acabado_core(uuid, jsonb, jsonb)", "_salvar_produto_importado_core(uuid, jsonb, jsonb, jsonb)",
      "_criar_card_produto_acabado_core(uuid)", "_criar_card_produto_importado_core(uuid)",
    ]) expect(m).toContain(`REVOKE EXECUTE ON FUNCTION public.${r} FROM PUBLIC, anon, authenticated;`);
    expect(m).toContain("AFTER UPDATE OF categoria_principal_id, subcategoria1_id, subcategoria2_id, linha_id ON public.modelos");
    expect(m).toContain("old.linha_id IS DISTINCT FROM new.linha_id");
  });

  it("corpos: salvar grava linha_id do produto (padrao `_dados ?`), card herda p.linha_id, espelho copia modelo->produto", () => {
    const sa = corpo(MIG, "_salvar_produto_acabado_core");
    const si = corpo(MIG, "_salvar_produto_importado_core");
    for (const c of [sa, si]) {
      expect(c).toContain("linha_id = case when _dados ? 'linha_id' then v_linha else linha_id end");
      expect(c).toContain("update public.modelos set linha_id = v_linha"); // reflexivo (frente anterior) preservado
    }
    for (const n of ["_criar_card_produto_acabado_core", "_criar_card_produto_importado_core"]) {
      const c = corpo(MIG, n);
      expect(c).toContain("p.ref, p.linha_id, p.mix_id");
      expect(c).not.toContain("p.ref, null, p.mix_id");
    }
    const e = corpo(MIG, "fn_modelo_espelho_categoria");
    expect(e).toContain("IF NEW.linha_id IS DISTINCT FROM OLD.linha_id THEN");
    expect(e).toContain("SET linha_id = NEW.linha_id");
    // o bloco da linha vem ANTES do 1o retorno antecipado da categoria
    expect(e.indexOf("NEW.linha_id IS DISTINCT FROM OLD.linha_id")).toBeLessThan(e.indexOf("RETURN NULL"));
  });

  it("RAISE novo so ASCII (a migration nao acrescenta nenhum RAISE; os herdados nao mudam)", () => {
    const m = ler(MIG);
    const raisesDoArquivo = m.split("\n").filter((l) => /RAISE EXCEPTION '/.test(l) && !l.includes("$function$"));
    for (const l of raisesDoArquivo) expect(/^[\x20-\x7e]*$/.test(l), l).toBe(true);
  });

  it("inverso: guarda aceita DEPOIS e ANTES; devolve os 5 corpos (md5 de ANTES); trigger sem linha_id; DROP COLUMN com confirmacao", () => {
    const v = ler(INV);
    for (const [k, f] of Object.entries(FUNCS)) {
      expect(v, k).toContain(`'${f.antes}', '${f.depois}'`);
      expect(md5(corpo(INV, nomeDe(f.sig)) + "\n"), k).toBe(f.antes);
    }
    expect(v).toMatch(/DROP COLUMN IF EXISTS linha_id/);
    expect(v).toContain("app.confirmo_apagar_linha_produto");
    expect(v).not.toMatch(/AFTER UPDATE OF categoria_principal_id, subcategoria1_id, subcategoria2_id, linha_id/);
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
async function prepara(c: Client): Promise<Ids> {
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '60s'");
  await comoUsuario(c);
  return ids(c);
}
async function novaLinha(c: Client, tenant: string, nome: string): Promise<string> {
  return (await um<{ id: string }>(c, "INSERT INTO public.linhas (tenant_id, nome) VALUES ($1, $2) RETURNING id", [tenant, nome])).id;
}
const linhaDoCard = async (c: Client, mid: string) =>
  (await um<{ l: string | null }>(c, "SELECT linha_id AS l FROM public.modelos WHERE id = $1", [mid])).l;

type Tipo = { nome: string; tabela: string; salvar: (c: Client, id: string | null, d: Record<string, unknown>) => Promise<{ id: string }>; card: string };
const TIPOS: Tipo[] = [
  {
    nome: "PA", tabela: "produtos_acabados", card: "_criar_card_produto_acabado_core",
    salvar: (c, id, d) => um(c, "SELECT public._salvar_produto_acabado_core($1::uuid, $2::jsonb, '[]'::jsonb) AS id", [id, JSON.stringify(d)]),
  },
  {
    nome: "PI", tabela: "produtos_importados", card: "_criar_card_produto_importado_core",
    salvar: (c, id, d) => um(c, "SELECT public._salvar_produto_importado_core($1::uuid, $2::jsonb, '[]'::jsonb, '[]'::jsonb) AS id", [id, JSON.stringify(d)]),
  },
];

describe.skipIf(!LOCAL)("PA/PI linha no produto — banco (copia local)", () => {
  it("migration aplicada: md5 vivo dos 5 = DEPOIS; EXECUTE dos 4 cores negado (inv. #9); colunas + FK NO ACTION + indice parcial + trigger com linha_id", async () => {
    await withTx(async (c) => {
      for (const [k, f] of Object.entries(FUNCS)) {
        const r = await um<any>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [f.sig]);
        expect(r.m, k).toBe(f.depois);
        if (k !== "espelho") {
          const a = await um<any>(c, `SELECT has_function_privilege('public', to_regprocedure($1), 'EXECUTE') AS p,
              has_function_privilege('anon', to_regprocedure($1), 'EXECUTE') AS a,
              has_function_privilege('authenticated', to_regprocedure($1), 'EXECUTE') AS u`, [f.sig]);
          expect(a, k).toEqual({ p: false, a: false, u: false });
        }
      }
      for (const t of ["produtos_acabados", "produtos_importados"]) {
        const col = await um<any>(c, `SELECT data_type, is_nullable FROM information_schema.columns
                                        WHERE table_schema='public' AND table_name=$1 AND column_name='linha_id'`, [t]);
        expect(col).toMatchObject({ data_type: "uuid", is_nullable: "YES" });
        const fk = await um<any>(c, `SELECT confdeltype FROM pg_constraint WHERE conrelid = ('public.'||$1)::regclass AND contype='f' AND confrelid='public.linhas'::regclass`, [t]);
        expect(fk?.confdeltype, `${t}: FK NO ACTION`).toBe("a");
        const ix = await um<any>(c, `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1 AND indexdef ILIKE '%(linha_id)%'`, [t]);
        expect(ix?.indexdef).toMatch(/WHERE \(linha_id IS NOT NULL\)/);
      }
      const trg = await um<any>(c, "SELECT pg_get_triggerdef(oid) AS d FROM pg_trigger WHERE tgname='trg_modelo_espelho_categoria'");
      expect(trg.d).toMatch(/UPDATE OF [^)]*linha_id ON public\.modelos/);
    });
  });

  for (const tp of TIPOS) {
    const dados = (k: Ids, o: Record<string, unknown> = {}) => ({ nome: `PPLP ${tp.nome} Vestido`, grupo_id: k.grupo, categoria_id: k.cat, qtd_total: 0, ...o });
    const linhaDoProduto = async (c: Client, pid: string) =>
      (await um<{ l: string | null }>(c, `SELECT linha_id AS l FROM public.${tp.tabela} WHERE id = $1`, [pid])).l;
    const criarCard = async (c: Client, pid: string) =>
      (await um<{ id: string }>(c, `SELECT public.${tp.card}($1) AS id`, [pid])).id;

    it(`(a) ${tp.nome}: salvar linha_id SEM card grava ${tp.tabela}.linha_id (novo e existente; trocar; vazio limpa; ausente mantem)`, async () => {
      await withTx(async (c) => {
        const k = await prepara(c);
        const l1 = await novaLinha(c, T, "PPLP Linha A");
        const pid = (await tp.salvar(c, null, dados(k, { linha_id: l1 }))).id; // INSERT ja com a linha
        const p = await um<any>(c, `SELECT modelo_id FROM public.${tp.tabela} WHERE id = $1`, [pid]);
        expect(p.modelo_id).toBeNull();
        expect(await linhaDoProduto(c, pid)).toBe(l1);
        const l2 = await novaLinha(c, T, "PPLP Linha B");
        await tp.salvar(c, pid, dados(k, { linha_id: l2 }));
        expect(await linhaDoProduto(c, pid)).toBe(l2);
        await tp.salvar(c, pid, dados(k, { composicao: "linho" })); // chave ausente MANTEM (site antigo nao apaga)
        expect(await linhaDoProduto(c, pid)).toBe(l2);
        await tp.salvar(c, pid, dados(k, { linha_id: "" })); // presente e vazia = limpa
        expect(await linhaDoProduto(c, pid)).toBeNull();
      });
    });

    it(`(a2) ${tp.nome}: linha de OUTRA loja segue recusada (P0001 'Linha de outra loja') e nada grava`, async () => {
      await withTx(async (c) => {
        const k = await prepara(c);
        const pid = (await tp.salvar(c, null, dados(k))).id;
        const outra = (await um<{ id: string }>(c, "SELECT id FROM public.tenants WHERE id <> $1 ORDER BY id LIMIT 1", [T]))?.id;
        expect(outra, "a copia precisa de ao menos 2 lojas").toBeTruthy();
        const lOutra = await novaLinha(c, outra, "PPLP Linha Outra Loja");
        await c.query("SAVEPOINT pplp_f");
        let msg = "PASSOU";
        try {
          await tp.salvar(c, pid, dados(k, { linha_id: lOutra }));
        } catch (e: any) {
          msg = `${e.code} ${e.message}`;
          await c.query("ROLLBACK TO SAVEPOINT pplp_f");
        }
        expect(msg).toMatch(/^P0001 Linha de outra loja/);
        expect(await linhaDoProduto(c, pid)).toBeNull();
      });
    });

    it(`(b) ${tp.nome}: COM card o save grava produto E modelo; a linha limpa nos dois`, async () => {
      await withTx(async (c) => {
        const k = await prepara(c);
        const pid = (await tp.salvar(c, null, dados(k))).id;
        const mid = await criarCard(c, pid);
        const l1 = await novaLinha(c, T, "PPLP Linha Com Card");
        await tp.salvar(c, pid, dados(k, { linha_id: l1 }));
        expect(await linhaDoProduto(c, pid)).toBe(l1);
        expect(await linhaDoCard(c, mid)).toBe(l1);
        await tp.salvar(c, pid, dados(k, { linha_id: null }));
        expect(await linhaDoProduto(c, pid)).toBeNull();
        expect(await linhaDoCard(c, mid)).toBeNull();
      });
    });

    it(`(c) ${tp.nome}: criar card HERDA produto.linha_id (o modelo nasce com a linha, nao null); sem linha segue null`, async () => {
      await withTx(async (c) => {
        const k = await prepara(c);
        const l1 = await novaLinha(c, T, "PPLP Linha Herdada");
        const pid = (await tp.salvar(c, null, dados(k, { linha_id: l1 }))).id;
        const mid = await criarCard(c, pid);
        expect(await linhaDoCard(c, mid)).toBe(l1);
        expect(await linhaDoProduto(c, pid)).toBe(l1);
        const pid2 = (await tp.salvar(c, null, dados(k, { nome: `PPLP ${tp.nome} Sem Linha` }))).id;
        const mid2 = await criarCard(c, pid2);
        expect(await linhaDoCard(c, mid2)).toBeNull();
      });
    });

    it(`(d) ${tp.nome}: espelho modelo->produto — update modelos.linha_id reflete em ${tp.tabela}.linha_id (troca e NULL); mesma linha nao regrava`, async () => {
      await withTx(async (c) => {
        const k = await prepara(c);
        const pid = (await tp.salvar(c, null, dados(k))).id;
        const mid = await criarCard(c, pid);
        const l1 = await novaLinha(c, T, "PPLP Linha Espelho 1");
        await c.query("UPDATE public.modelos SET linha_id = $1 WHERE id = $2", [l1, mid]);
        expect(await linhaDoProduto(c, pid)).toBe(l1);
        const l2 = await novaLinha(c, T, "PPLP Linha Espelho 2");
        await c.query("UPDATE public.modelos SET linha_id = $1 WHERE id = $2", [l2, mid]);
        expect(await linhaDoProduto(c, pid)).toBe(l2);
        // NULL do card TAMBEM copia ("sem linha" e estado valido)
        await c.query("UPDATE public.modelos SET linha_id = NULL WHERE id = $1", [mid]);
        expect(await linhaDoProduto(c, pid)).toBeNull();
        // linha independente da categoria: card SEM categoria (passo intermediario da troca de grupo) ainda espelha a linha
        await c.query("UPDATE public.modelos SET categoria_principal_id = NULL WHERE id = $1", [mid]);
        await c.query("UPDATE public.modelos SET linha_id = $1 WHERE id = $2", [l1, mid]);
        expect(await linhaDoProduto(c, pid)).toBe(l1);
      });
    });

    it(`(e) ${tp.nome}: o espelho nao toca produto de OUTRO card nem produto sem card`, async () => {
      await withTx(async (c) => {
        const k = await prepara(c);
        const l1 = await novaLinha(c, T, "PPLP Linha Isolada");
        const pidA = (await tp.salvar(c, null, dados(k, { nome: `PPLP ${tp.nome} A` }))).id;
        const pidSemCard = (await tp.salvar(c, null, dados(k, { nome: `PPLP ${tp.nome} B`, linha_id: l1 }))).id;
        const midA = await criarCard(c, pidA);
        await c.query("UPDATE public.modelos SET linha_id = NULL WHERE id = $1", [midA]);
        await c.query("UPDATE public.modelos SET linha_id = $1 WHERE id = $2", [l1, midA]);
        await c.query("UPDATE public.modelos SET linha_id = NULL WHERE id = $1", [midA]);
        expect(await linhaDoProduto(c, pidSemCard)).toBe(l1); // intacto
      });
    });
  }

  it("cruzado: card de PA nao propaga para produtos_importados (e vice-versa) — origem manda", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const l1 = await novaLinha(c, T, "PPLP Linha Cruzada");
      const [pa, pi] = TIPOS;
      const pidPA = (await pa.salvar(c, null, { nome: "PPLP X PA", grupo_id: k.grupo, categoria_id: k.cat, qtd_total: 0 })).id;
      const pidPI = (await pi.salvar(c, null, { nome: "PPLP X PI", grupo_id: k.grupo, categoria_id: k.cat, qtd_total: 0 })).id;
      const midPA = (await um<{ id: string }>(c, "SELECT public._criar_card_produto_acabado_core($1) AS id", [pidPA])).id;
      await c.query("UPDATE public.modelos SET linha_id = $1 WHERE id = $2", [l1, midPA]);
      const r = await um<any>(c, `SELECT (SELECT linha_id FROM public.produtos_acabados WHERE id=$1) AS a,
                                          (SELECT linha_id FROM public.produtos_importados WHERE id=$2) AS i`, [pidPA, pidPI]);
      expect(r).toEqual({ a: l1, i: null });
    });
  });
});
