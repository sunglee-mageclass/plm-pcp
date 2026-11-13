// Reforma da Peça Teste por TIPO — migration 2 (20261129110000_peca_teste_tipo_predicado): "peca teste aprovada" lida por (modelo, tipo).
// ANTI-DRIFT SQL × TS: cada caso da fixture compartilhada (tests/fixtures/peca-teste-tipo-casos.ts) é semeado numa txn revertida e a chave
// `peca_teste_aprovada` do avaliador do Dev E do PL tem de bater com `pecaTesteAprovadaModelo` (TS) e com o esperado. Review Focus 2: o 1º
// recálculo MUDA o resultado quando o fornecedor da M.O. difere do da tentativa (antes: false; depois: true). Só na cópia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um } from "./db";
import { aplicaReforma, exigePreReforma, novaCategoria, novaLinhaMo, novaTentativa, novoFornecedor, novoModelo, prepara, T } from "./peca-teste-tipo-helpers";
import { CASOS_PECA_TESTE } from "../fixtures/peca-teste-tipo-casos";
import { pecaTesteAprovadaModelo } from "../../src/lib/peca-teste-requisito";

const RODA = hasDb && ehBancoLocal();

async function chave(c: Client, fn: string, modelo: string): Promise<boolean> {
  const r = await um<{ j: Record<string, Record<string, boolean>> }>(c, `SELECT public.${fn}($1, $2::uuid[]) AS j`, [T, [modelo]]);
  return r.j[modelo].peca_teste_aprovada;
}

describe.skipIf(!RODA)("reforma por TIPO — predicado por tipo e anti-drift SQL × TS (migration 2)", () => {
  it("1) cada caso da fixture: Dev = PL = TS = esperado", async () => {
    await withTx(async (c) => {
      await prepara(c, "predicado");
      const cats = {
        exige: await novaCategoria(c, "PL ad", true), exige2: await novaCategoria(c, "Bordado ad", true), sem_switch: await novaCategoria(c, "Lav ad", false),
      };
      const f = await novoFornecedor(c, "F ad", [cats.exige, cats.exige2]);
      const ids: Record<string, string | null> = { ...cats, sem_tipo: null };
      const problemas: string[] = [];
      for (const caso of CASOS_PECA_TESTE) {
        const m = await novoModelo(c, `ad ${caso.nome.slice(0, 24)}`);
        for (const l of caso.linhas) await novaLinhaMo(c, m, ids[l.tipo], f, l.mo_aprovado);
        for (const t of caso.tentativas) await novaTentativa(c, { modelo: m, cat: ids[t.tipo]!, numero: t.numero, aprovacao: t.aprovacao, emp: f });
        const ts = pecaTesteAprovadaModelo({
          linhas: caso.linhas.map((l) => ({ categoria_id: ids[l.tipo], exige: l.tipo === "exige" || l.tipo === "exige2", mo_aprovado: l.mo_aprovado })),
          tentativas: caso.tentativas.map((t) => ({ categoria_id: ids[t.tipo]!, numero: t.numero, aprovacao: t.aprovacao })),
        });
        const dev = await chave(c, "_avaliar_condicoes_kanban_core", m);
        const pl = await chave(c, "_avaliar_condicoes_etapas_pl_core", m);
        if (!(dev === caso.esperado && pl === caso.esperado && ts === caso.esperado)) problemas.push(`${caso.nome}: dev=${dev} pl=${pl} ts=${ts} esperado=${caso.esperado}`);
      }
      expect(problemas).toEqual([]);
    });
  });

  it("2) (Review 2) o 1º recálculo MUDA o resultado quando o fornecedor da M.O. difere do da tentativa: antes false, depois true (Dev e PL)", async (ctx) => {
    await withTx(async (c) => {
      await prepara(c, null); // sem a reforma: leitura ANTIGA (por linha + fornecedor congelado)
      await exigePreReforma(c, ctx);
      const cat = await novaCategoria(c, "PL ad2", true);
      const f1 = await novoFornecedor(c, "F1 ad2", [cat]);
      const f2 = await novoFornecedor(c, "F2 ad2", [cat]);
      const m = await novoModelo(c, "ad2 troca de fornecedor");
      const linha = await novaLinhaMo(c, m, cat, f2, true); // a M.O. hoje está com F2…
      await novaTentativa(c, { modelo: m, cat, numero: 1, aprovacao: "aprovado", emp: f1, linha }); // …mas a peça foi aprovada com F1
      expect(await chave(c, "_avaliar_condicoes_kanban_core", m)).toBe(false);
      expect(await chave(c, "_avaliar_condicoes_etapas_pl_core", m)).toBe(false);
      await aplicaReforma(c, "predicado");
      expect(await chave(c, "_avaliar_condicoes_kanban_core", m)).toBe(true);
      expect(await chave(c, "_avaliar_condicoes_etapas_pl_core", m)).toBe(true);
    });
  });

  it("3) a CASCA _peca_teste_aprovada(linha, tipo, fornecedor) ignora o fornecedor, lê pelo modelo da linha e devolve false para linha inexistente", async () => {
    await withTx(async (c) => {
      await prepara(c, "predicado");
      const cat = await novaCategoria(c, "PL ad3", true);
      const f = await novoFornecedor(c, "F ad3", [cat]);
      const m = await novoModelo(c, "ad3 casca");
      const linha = await novaLinhaMo(c, m, cat, null, true);
      await novaTentativa(c, { modelo: m, cat, numero: 1, aprovacao: "aprovado", emp: f });
      const casca = (emp: string | null, l: string) => um<{ ok: boolean }>(c, "SELECT public._peca_teste_aprovada($1::uuid, $2::uuid, $3::uuid) AS ok", [l, cat, emp]);
      expect((await casca(f, linha)).ok).toBe(true);
      expect((await casca(null, linha)).ok).toBe(true); // fornecedor ignorado
      expect((await casca(f, "00000000-0000-4000-8000-000000000000")).ok).toBe(false);
      expect((await um<{ ok: boolean }>(c, "SELECT public._peca_teste_aprovada_tipo($1, $2) AS ok", [m, cat])).ok).toBe(true);
    });
  });

  it("4) ACL: as 2 funções SEM EXECUTE para PUBLIC/anon/authenticated; migration 2x = mesmo md5", async () => {
    await withTx(async (c) => {
      await prepara(c, "predicado");
      const acl = async () =>
        (await c.query(
          `SELECT p.proname, p.proacl::text AS acl, md5(pg_get_functiondef(p.oid)) AS m FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('_peca_teste_aprovada', '_peca_teste_aprovada_tipo') ORDER BY 1`,
        )).rows;
      const a = await acl();
      for (const r of a) expect(r.acl, r.proname).toBe("{postgres=X/postgres,service_role=X/postgres}");
      await aplicaReforma(c, "predicado");
      expect(await acl()).toEqual(a);
    });
  });
});
