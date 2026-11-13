// Reforma da Peça Teste por TIPO — migration 1 (20261129100000_peca_teste_tipo_dados): a chave da trilha passa de (mo_linha_id, tipo, numero)
// para (modelo_id, tipo, numero). Review Focus 1: colisão de número ao unir 2 linhas de M.O. do mesmo tipo. Txn revertida; só na cópia local.
import { describe, it, expect } from "vitest";
import { hasDb, ehBancoLocal, withTx, um } from "./db";
import { aplicarArquivo } from "./mig-txn";
import { DOWNS, MIGS, aplicaReforma, exigePreReforma, novaCategoria, novaLinhaMo, novaTentativa, novoFornecedor, novoModelo, prepara, tenta, tentativas } from "./peca-teste-tipo-helpers";

const RODA = hasDb && ehBancoLocal();

describe.skipIf(!RODA)("reforma por TIPO — dados (migration 1)", () => {
  it("(Review 1) 2 linhas de M.O. do MESMO tipo com tentativas: a união RENUMERA por created_at (sem colisão) e o novo UNIQUE vale", async (ctx) => {
    await withTx(async (c) => {
      await prepara(c, null);
      await exigePreReforma(c, ctx);
      const cat = await novaCategoria(c, "PL dados", true);
      const f = await novoFornecedor(c, "F dados", [cat]);
      const m = await novoModelo(c, "dados colisao");
      const A = await novaLinhaMo(c, m, cat, f, null);
      const B = await novaLinhaMo(c, m, cat, f, null);
      // a chave ANTIGA (por linha) deixa as duas trilhas terem "numero 1": A#1 (t0), B#1 (t1), A#2 (t2)
      await novaTentativa(c, { modelo: m, cat, numero: 1, aprovacao: "reprovado", emp: f, linha: A, criadoEm: "2026-10-01 10:00+00" });
      await novaTentativa(c, { modelo: m, cat, numero: 1, aprovacao: "reprovado", emp: f, linha: B, criadoEm: "2026-10-02 10:00+00" });
      await novaTentativa(c, { modelo: m, cat, numero: 2, aprovacao: "aprovado", emp: f, linha: A, criadoEm: "2026-10-03 10:00+00" });
      await aplicaReforma(c, "dados");
      expect((await tentativas(c, m, cat)).map((t) => [t.numero, t.aprovacao])).toEqual([[1, "reprovado"], [2, "reprovado"], [3, "aprovado"]]);
      // a ordem de criação manda: a aprovada (a mais nova) fica por último
      const dup = await tenta(c, () => novaTentativa(c, { modelo: m, cat, numero: 3, aprovacao: null, emp: f }));
      expect(dup?.code).toBe("23505");
      expect(await um(c, "SELECT 1 AS x FROM pg_indexes WHERE indexname = 'mpt_trilha_numero_ux'")).toBeUndefined();
      expect((await um<{ n: string }>(c, "SELECT count(*) AS n FROM public._bkp_mpt_reforma_20261129 WHERE modelo_id = $1", [m])).n).toBe("3"); // backup ANTES de renumerar
    });
  });

  it("grupo SEM colisão não é tocado (números e rev iguais); a migration roda 2x sem mudar nada (idempotente)", async (ctx) => {
    await withTx(async (c) => {
      await prepara(c, null);
      await exigePreReforma(c, ctx);
      const cat = await novaCategoria(c, "PL dados2", true);
      const f = await novoFornecedor(c, "F dados2", [cat]);
      const m = await novoModelo(c, "dados sem colisao");
      const A = await novaLinhaMo(c, m, cat, f, null);
      await novaTentativa(c, { modelo: m, cat, numero: 1, aprovacao: "reprovado", emp: f, linha: A });
      await novaTentativa(c, { modelo: m, cat, numero: 2, aprovacao: null, emp: f, linha: A });
      const antes = await tentativas(c, m, cat);
      await aplicaReforma(c, "dados");
      await aplicarArquivo(c, MIGS.dados); // 2ª vez
      expect(await tentativas(c, m, cat)).toEqual(antes);
    });
  });

  it("trilha INCOERENTE após a união (tentativa em teste no MEIO) ABORTA a migration com 'reforma_pt_dados' e não deixa nada pela metade", async (ctx) => {
    await withTx(async (c) => {
      await prepara(c, null);
      await exigePreReforma(c, ctx);
      const cat = await novaCategoria(c, "PL dados3", true);
      const f = await novoFornecedor(c, "F dados3", [cat]);
      const m = await novoModelo(c, "dados incoerente");
      const A = await novaLinhaMo(c, m, cat, f, null);
      const B = await novaLinhaMo(c, m, cat, f, null);
      await novaTentativa(c, { modelo: m, cat, numero: 1, aprovacao: null, emp: f, linha: A, criadoEm: "2026-10-01 10:00+00" }); // em teste, a mais antiga
      await novaTentativa(c, { modelo: m, cat, numero: 1, aprovacao: "reprovado", emp: f, linha: B, criadoEm: "2026-10-02 10:00+00" });
      const e = await tenta(c, () => aplicarArquivo(c, MIGS.dados));
      expect(e?.message).toMatch(/reforma_pt_dados: 1 tentativa\(s\) nao reprovada\(s\) ficariam no meio/);
      // o savepoint desfez tudo: a chave antiga segue de pé e os números ficaram como estavam
      expect(await um(c, "SELECT 1 AS x FROM pg_indexes WHERE indexname = 'mpt_trilha_numero_ux'")).toMatchObject({ x: 1 });
      expect((await tentativas(c, m, cat)).map((t) => t.numero)).toEqual([1, 1]);
    });
  });

  it("backfill: tentativa EM TESTE sem fornecedor ganha o da M.O. vigente; a decidida e a que já tem fornecedor ficam", async (ctx) => {
    await withTx(async (c) => {
      await prepara(c, null);
      await exigePreReforma(c, ctx);
      const cat = await novaCategoria(c, "PL dados4", true);
      const fMo = await novoFornecedor(c, "F da MO", [cat]);
      const fTent = await novoFornecedor(c, "F da tentativa", [cat]);
      const m = await novoModelo(c, "dados backfill");
      const A = await novaLinhaMo(c, m, cat, fMo, null);
      const emTeste = await novaTentativa(c, { modelo: m, cat, numero: 1, aprovacao: null, emp: null, linha: A });
      const m2 = await novoModelo(c, "dados backfill2");
      const A2 = await novaLinhaMo(c, m2, cat, fMo, null);
      const jaTem = await novaTentativa(c, { modelo: m2, cat, numero: 1, aprovacao: null, emp: fTent, linha: A2 });
      await aplicaReforma(c, "dados");
      expect((await tentativas(c, m, cat)).find((t) => t.id === emTeste)!.empresa_id).toBe(fMo);
      expect((await tentativas(c, m2, cat)).find((t) => t.id === jaTem)!.empresa_id).toBe(fTent);
    });
  });

  it("_down: devolve a chave por linha e RESTAURA os números de antes (grupo coberto pelo backup); o backup fica", async (ctx) => {
    await withTx(async (c) => {
      await prepara(c, null);
      await exigePreReforma(c, ctx);
      const cat = await novaCategoria(c, "PL dados5", true);
      const f = await novoFornecedor(c, "F dados5", [cat]);
      const m = await novoModelo(c, "dados down");
      const A = await novaLinhaMo(c, m, cat, f, null);
      const B = await novaLinhaMo(c, m, cat, f, null);
      await novaTentativa(c, { modelo: m, cat, numero: 1, aprovacao: "reprovado", emp: f, linha: A, criadoEm: "2026-10-01 10:00+00" });
      await novaTentativa(c, { modelo: m, cat, numero: 1, aprovacao: "reprovado", emp: f, linha: B, criadoEm: "2026-10-02 10:00+00" });
      await aplicaReforma(c, "dados");
      expect((await tentativas(c, m, cat)).map((t) => t.numero)).toEqual([1, 2]);
      await aplicarArquivo(c, DOWNS.dados);
      expect((await tentativas(c, m, cat)).map((t) => t.numero)).toEqual([1, 1]); // a chave por linha admite de novo
      expect(await um(c, "SELECT 1 AS x FROM pg_indexes WHERE indexname = 'mpt_trilha_numero_ux'")).toMatchObject({ x: 1 });
      expect(await um(c, "SELECT 1 AS x FROM pg_constraint WHERE conname = 'mpt_trilha_tipo_numero_uq'")).toBeUndefined();
      await aplicarArquivo(c, DOWNS.dados); // 2x = no-op
    });
  });
});
