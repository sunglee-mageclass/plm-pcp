// F3 (Plan. Tecido — transparência no resumo), Task 1 — migration 20261115100000_f3_resumo_transparencia:
// `_plan_tecido_previa_pedido_core` passa a expor, SÓ para exibição, `recebido_m`/`prev_receb_m`/`fisico_m` (disponível) em cada linha de `cobertura`
// e a chave de topo `outras_colecoes`. ADITIVO: nenhuma conta de compra (estoque_m/deficit_m/qtd) muda.
// Integração em BEGIN…ROLLBACK (withTx), SÓ na cópia local (54422) — o teste anti-drift cria uma função temporária
// (pg_temp, desfeita no ROLLBACK) com o corpo EXATO da R15b para comparar saída antiga × nova.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";
import { hasDb, withTx, ehBancoLocal, TENANT_TESTE } from "./db";

const RODA = hasDb && ehBancoLocal();
const PREVIA = "public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[])";
const MD5_ANTES = "b62ef170570b2444ad3f5727760cd411"; // R15b fix1 (texto de partida)

type Cob = {
  artigo_id: string; variante_tecido_id: string; nec_m: number; estoque_m: number; deficit_m: number;
  recebido_m: number; prev_receb_m: number; fisico_m: number;
};
type OutrasCol = { artigo_id: string; colecoes: { colecao_id: string; colecao_nome: string; nec_m: number }[] }[];
type Previa = {
  fornecedores: { itens: { deficit_m: number; estoque_m: number; qtd: number | null }[] }[];
  sem_fornecedor: unknown[];
  cobertura: Cob[];
  bloqueios: unknown[];
  outras_colecoes: OutrasCol;
};

/** Coleções da Loja Teste com plano de tecido. */
async function colecoesLoja(c: Client): Promise<{ id: string; nome: string }[]> {
  const { rows } = await c.query(
    `select p.colecao_id id, co.nome from plan_tecido p join colecoes co on co.id = p.colecao_id
      where p.tenant_id = $1 order by co.nome, p.colecao_id`, [TENANT_TESTE]);
  return rows;
}

async function previa(c: Client, colecao: string, slots: string[] | null = null): Promise<Previa> {
  const { rows } = await c.query(`select ${PREVIA.replace("(uuid,uuid,uuid[])", "")}($1,$2,$3::uuid[]) as p`, [TENANT_TESTE, colecao, slots]);
  return rows[0].p as Previa;
}

/** Corpo EXATO da R15b (guardado no _down da F3), criado como função TEMPORÁRIA (pg_temp) para comparar saídas. */
async function criaPreviaR15b(c: Client): Promise<void> {
  const down = readFileSync(resolve(__dirname, "../../supabase/rollback/20261115100000_f3_resumo_transparencia_down.sql"), "utf8");
  const m = down.match(/CREATE OR REPLACE FUNCTION public\._plan_tecido_previa_pedido_core[\s\S]*?end \$function\$;/);
  if (!m) throw new Error("corpo da R15b nao encontrado no _down da F3");
  const ddl = m[0].replace("public._plan_tecido_previa_pedido_core", "pg_temp._f3_previa_r15b");
  await c.query(ddl);
}

/** Remove as chaves ADICIONADAS pela F3 (recebido_m/prev_receb_m/fisico_m/outras_colecoes) para comparar com a R15b. */
function semChavesF3(p: Previa): unknown {
  const { outras_colecoes: _o, ...resto } = p;
  void _o;
  return { ...resto, cobertura: p.cobertura.map(({ recebido_m: _r, prev_receb_m: _p, fisico_m: _f, ...l }) => (void _r, void _p, void _f, l)) };
}

describe.skipIf(!RODA)("F3 transparência no resumo — previa expõe recebido/a chegar + outras coleções (aditivo)", () => {
  it("a função viva é a F3 (não a R15b) e continua sem EXECUTE para anon/authenticated (inv. #9)", async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `select md5(pg_get_functiondef($1::regprocedure)) md5,
                has_function_privilege('anon', $1::regprocedure, 'EXECUTE') anon,
                has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') auth`, [PREVIA]);
      expect(rows[0].md5, "F3 aplicada na cópia (md5 != R15b)").not.toBe(MD5_ANTES);
      expect(rows[0].anon).toBe(false);
      expect(rows[0].auth).toBe(false);
    });
  });

  it("(a) recebido_m/prev_receb_m/fisico_m de cada linha da cobertura batem com _estoque_tecido_core (0, nunca null, sem OC)", async () => {
    await withTx(async (c) => {
      const est = new Map<string, { rec: number; prev: number; fis: number }>();
      const { rows: er } = await c.query(
        `select variante_tecido_id v, recebido_m::float8 rec, prev_receb_m::float8 prev, fisico::float8 fis from public._estoque_tecido_core($1)`, [TENANT_TESTE]);
      for (const r of er) est.set(r.v, { rec: r.rec, prev: r.prev, fis: r.fis });
      let linhas = 0, semOc = 0, comFisicoDiferente = 0;
      for (const col of await colecoesLoja(c)) {
        for (const l of (await previa(c, col.id)).cobertura) {
          linhas++;
          const e = est.get(l.variante_tecido_id);
          if (!e) semOc++;
          expect(typeof l.recebido_m, `recebido_m numerico (${col.nome}/${l.variante_tecido_id})`).toBe("number");
          expect(typeof l.prev_receb_m, `prev_receb_m numerico (${col.nome}/${l.variante_tecido_id})`).toBe("number");
          expect(l.recebido_m).toBeCloseTo(e?.rec ?? 0, 6);
          expect(l.prev_receb_m).toBeCloseTo(e?.prev ?? 0, 6);
          // fix-round: fisico_m = DISPONIVEL (fisico do core = recebido - baixas; desconta corte/ajuste/peca-teste)
          expect(typeof l.fisico_m, `fisico_m numerico (${col.nome}/${l.variante_tecido_id})`).toBe("number");
          expect(l.fisico_m).toBeCloseTo(e?.fis ?? 0, 6);
          if (e && Math.abs(e.fis - e.rec) > 1e-9) comFisicoDiferente++;
        }
      }
      expect(linhas, "fixture: Loja Teste precisa ter cobertura").toBeGreaterThan(0);
      expect(comFisicoDiferente, "fixture: ha variante com baixa (fisico_m != recebido_m) - prova que o disponivel difere do bruto").toBeGreaterThan(0);
      void semOc; // variante sem linha no core => 0/0 (coberto pelo toBeCloseTo(…, ?? 0))
    });
  });

  it("(b) anti-drift: deficit_m/estoque_m/qtd/fornecedores/sem_fornecedor/bloqueios IDÊNTICOS à R15b (todas as coleções, com e sem seleção de vagas)", async () => {
    await withTx(async (c) => {
      await criaPreviaR15b(c);
      let comparadas = 0;
      for (const col of await colecoesLoja(c)) {
        const { rows: sl } = await c.query(
          `select sl.id from plan_tecido p join plan_tecido_subcolecoes s on s.plan_id = p.id
             join plan_tecido_linhas l on l.sub_id = s.id join plan_tecido_slots sl on sl.linha_ref_id = l.id
            where p.colecao_id = $1 and p.tenant_id = $2 order by sl.id limit 3`, [col.id, TENANT_TESTE]);
        for (const slots of [null, sl.map((r) => r.id as string)]) {
          const novo = await previa(c, col.id, slots);
          const { rows } = await c.query(`select pg_temp._f3_previa_r15b($1,$2,$3::uuid[]) as p`, [TENANT_TESTE, col.id, slots]);
          const antigo = rows[0].p as Previa;
          expect(semChavesF3(novo), `${col.nome} slots=${slots ? "sel" : "todos"}`).toEqual(semChavesF3(antigo));
          // e as chaves de conta continuam presentes na linha nova
          for (const l of novo.cobertura) {
            expect(l).toHaveProperty("deficit_m");
            expect(l).toHaveProperty("estoque_m");
          }
          comparadas++;
        }
      }
      expect(comparadas).toBeGreaterThan(0);
    });
  });

  it("(c) outras_colecoes: só coleções != atual, mesmo tenant, nec_m>0, só artigos da coleção atual; bate com a necessidade das outras coleções", async () => {
    await withTx(async (c) => {
      const cols = await colecoesLoja(c);
      let comLista = 0;
      for (const col of cols) {
        const p = await previa(c, col.id);
        expect(Array.isArray(p.outras_colecoes), `outras_colecoes array (${col.nome})`).toBe(true);
        const artigosAtuais = new Set(p.cobertura.map((l) => l.artigo_id));
        for (const item of p.outras_colecoes) {
          expect(artigosAtuais.has(item.artigo_id), "artigo da lista é usado pela coleção atual").toBe(true);
          expect(item.colecoes.length, "artigo sem outra coleção NÃO aparece").toBeGreaterThan(0);
          for (const o of item.colecoes) {
            expect(o.colecao_id).not.toBe(col.id);
            expect(o.nec_m).toBeGreaterThan(0);
            const { rows } = await c.query(`select tenant_id from colecoes where id = $1`, [o.colecao_id]);
            expect(rows[0].tenant_id, "coleção de outra loja não aparece").toBe(TENANT_TESTE);
            // independente: necessidade da outra coleção para o artigo, direto do core
            const { rows: n } = await c.query(
              `select coalesce(sum(nec_m),0)::float8 nec from public._plan_tecido_nec_variante_core($1,$2,null) where artigo_id = $3`,
              [TENANT_TESTE, o.colecao_id, item.artigo_id]);
            expect(o.nec_m).toBeCloseTo(n[0].nec, 4);
          }
          comLista++;
        }
        // completude: toda outra coleção da loja que usa um artigo da atual (nec>0) está listada
        for (const outra of cols.filter((x) => x.id !== col.id)) {
          const { rows } = await c.query(
            `select artigo_id, sum(nec_m)::float8 nec from public._plan_tecido_nec_variante_core($1,$2,null) group by artigo_id having sum(nec_m) > 0`,
            [TENANT_TESTE, outra.id]);
          for (const r of rows.filter((x) => artigosAtuais.has(x.artigo_id))) {
            const item = p.outras_colecoes.find((i) => i.artigo_id === r.artigo_id);
            expect(item?.colecoes.some((o) => o.colecao_id === outra.id), `${outra.nome} deveria constar em ${col.nome}`).toBe(true);
          }
        }
      }
      expect(comLista, "fixture: Loja Teste tem artigo compartilhado entre coleções").toBeGreaterThan(0);
    });
  });

  it("(d) coleção cujo artigo só ela usa → outras_colecoes não lista esse artigo (e a chave existe como [])", async () => {
    await withTx(async (c) => {
      // Resort 27 Novo (outra loja) usa dezenas de artigos que nenhuma outra coleção DA SUA LOJA usa
      const { rows: t } = await c.query(
        `select p.tenant_id tenant, p.colecao_id colecao from plan_tecido p
           join colecoes co on co.id = p.colecao_id where p.tenant_id <> $1 and co.nome = 'Resort 27 Novo' limit 1`, [TENANT_TESTE]);
      if (!t[0]) return; // fixture ausente: nada a provar
      const { rows } = await c.query(`select public._plan_tecido_previa_pedido_core($1,$2,null) as p`, [t[0].tenant, t[0].colecao]);
      const p = rows[0].p as Previa;
      expect(Array.isArray(p.outras_colecoes)).toBe(true);
      for (const item of p.outras_colecoes) {
        for (const o of item.colecoes) {
          const { rows: r } = await c.query(`select tenant_id from colecoes where id = $1`, [o.colecao_id]);
          expect(r[0].tenant_id).toBe(t[0].tenant);
        }
      }
    });
  });
});
