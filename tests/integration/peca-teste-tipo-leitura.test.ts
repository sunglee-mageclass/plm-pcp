// Reforma da Peça Teste por TIPO — migration 4 (20261129130000_peca_teste_tipo_leitura): a leitura da seção do card (`peca_teste_modelo`), o
// quadro de PCP › Etapas (`peca_teste_quadro`) e o selo/filtro da lista de Serviços (`peca_teste_status_lote`) leem POR TIPO. Txn revertida; só cópia local.
import { describe, it, expect } from "vitest";
import { hasDb, ehBancoLocal, withTx, um } from "./db";
import {
  D1, comoSistema, lerPT, novaCategoria, novaLinhaMo, novaTentativa, novoFornecedor, novoModelo, prepara, salvarPT, tentativas,
} from "./peca-teste-tipo-helpers";
import { estadoPTDoServidor, statusPecaTesteModelo, vezComFornecedor } from "../../src/lib/peca-teste";

const RODA = hasDb && ehBancoLocal();
const quadro = async (c: import("pg").Client) => (await um<{ j: any[] }>(c, "SELECT public.peca_teste_quadro() AS j")).j;
const lote = async (c: import("pg").Client, ids: string[]) => (await um<{ j: Record<string, string> }>(c, "SELECT public.peca_teste_status_lote($1::uuid[]) AS j", [ids])).j;

describe.skipIf(!RODA)("reforma por TIPO — leituras (migration 4)", () => {
  it("1) a seção lê POR TIPO: 2 linhas do mesmo tipo = 1 trilha; mo_aprovado agrega; fornecedores = só os vinculados ao tipo; cada tentativa traz o PRÓPRIO fornecedor", async () => {
    await withTx(async (c) => {
      await prepara(c, "leitura");
      const cat = await novaCategoria(c, "PL lt", true, 9310);
      const fZ = await novoFornecedor(c, "Zeta lt", [cat]);
      const fA = await novoFornecedor(c, "Alfa lt", [cat]);
      await novoFornecedor(c, "Fora lt", []); // de serviço, mas NÃO vinculado ao tipo
      const m = await novoModelo(c, "lt card");
      await novaLinhaMo(c, m, cat, fA, true);
      await novaLinhaMo(c, m, cat, fZ, null); // a 2ª linha do tipo ainda pendente
      await novaTentativa(c, { modelo: m, cat, numero: 1, aprovacao: "reprovado", emp: fZ });
      await novaTentativa(c, { modelo: m, cat, numero: 2, aprovacao: null, emp: fA, entrada: null });
      const j = await lerPT(c, m);
      expect(j.trilhas).toHaveLength(1);
      const t = j.trilhas[0];
      expect(t).toMatchObject({ categoria_id: cat, tem_mo: true, mo_aprovado: null, aprovada: false }); // 1 aprovada + 1 pendente = pendente
      expect(t.fornecedores.map((f: any) => f.nome_fantasia.split(" ")[0])).toEqual(["Alfa", "Zeta"]); // por nome; sem o "Fora"
      expect(t.tentativas.map((x: any) => [x.numero, x.empresa_id, x.aprovacao])).toEqual([[1, fZ, "reprovado"], [2, fA, null]]);
      // o parser TS lê o jsonb novo e o 2º contador sai da própria leitura
      const e = estadoPTDoServidor(j)!;
      expect(vezComFornecedor(e.trilhas[0].tentativas, 2)).toBe(1);
    });
  });

  it("2) tipo SEM fornecedor vinculado: a trilha aparece com fornecedores [] (a tela avisa 'vincule em Cadastro') — não bloqueia", async () => {
    await withTx(async (c) => {
      await prepara(c, "leitura");
      const cat = await novaCategoria(c, "PL lt2", true);
      const m = await novoModelo(c, "lt2 card");
      await novaLinhaMo(c, m, cat, null, true);
      const t = (await lerPT(c, m)).trilhas[0];
      expect(t.fornecedores).toEqual([]);
      expect(t).toMatchObject({ tem_mo: true, mo_aprovado: true });
    });
  });

  it("3) trilha de tipo SEM linha de M.O. (adicionada à mão) aparece quando tem tentativa (tem_mo false); tipos_adicionar lista os tipos que exigem e ainda não estão no card", async () => {
    await withTx(async (c) => {
      await prepara(c, "leitura");
      const catMo = await novaCategoria(c, "PL lt3", true, 9311);
      const catManual = await novaCategoria(c, "Bordado lt3", true, 9312);
      const catLivre = await novaCategoria(c, "Livre lt3", true, 9313);
      await novaCategoria(c, "Corte lt3", false, 9314); // não exige: nunca aparece
      const f = await novoFornecedor(c, "F lt3", [catManual, catLivre]);
      const m = await novoModelo(c, "lt3 card");
      await novaLinhaMo(c, m, catMo, null, true);
      await novaTentativa(c, { modelo: m, cat: catManual, numero: 1, aprovacao: null, emp: f, entrada: null });
      const j = await lerPT(c, m);
      expect(j.trilhas.map((t: any) => [t.categoria_nome.split(" ")[0], t.tem_mo])).toEqual([["PL", true], ["Bordado", false]]);
      const livres = j.tipos_adicionar.map((t: any) => t.categoria_id);
      expect(livres).toContain(catLivre);
      expect(livres).not.toContain(catMo);
      expect(livres).not.toContain(catManual);
      expect(j.tipos_adicionar.find((t: any) => t.categoria_id === catLivre).fornecedores.map((x: any) => x.id)).toEqual([f]);
      expect(j.outros).toEqual([]);
    });
  });

  it("4) (Review 3) o 2º contador recalcula após EXCLUIR: a antiga 3 (F1) vira a 2 e a 1ª vez com F1", async () => {
    await withTx(async (c) => {
      await prepara(c, "leitura");
      const cat = await novaCategoria(c, "PL lt4", true);
      const f1 = await novoFornecedor(c, "F1 lt4", [cat]);
      const f2 = await novoFornecedor(c, "F2 lt4", [cat]);
      const m = await novoModelo(c, "lt4 card");
      await novaLinhaMo(c, m, cat, f1, true);
      const ids = [
        await novaTentativa(c, { modelo: m, cat, numero: 1, aprovacao: "reprovado", emp: f1 }),
        await novaTentativa(c, { modelo: m, cat, numero: 2, aprovacao: "reprovado", emp: f2 }),
        await novaTentativa(c, { modelo: m, cat, numero: 3, aprovacao: null, emp: f1, entrada: null }),
      ];
      // Review 3 (lado SQL; o contador "vez com o fornecedor" é derivado no TS e fica na T6): a leitura devolve o fornecedor PRÓPRIO de cada tentativa
      const vezes = async () => (await lerPT(c, m)).trilhas[0].tentativas.map((t: any) => [t.numero, t.empresa_id]);
      expect(await vezes()).toEqual([[1, f1], [2, f2], [3, f1]]);
      // o 2º contador (derivado no TS) a partir da própria leitura
      const vezTS = async () => {
        const e = estadoPTDoServidor(await lerPT(c, m))!;
        return e.trilhas[0].tentativas.map((t) => [t.numero, vezComFornecedor(e.trilhas[0].tentativas, t.numero)]);
      };
      expect(await vezTS()).toEqual([[1, 1], [2, 1], [3, 2]]);
      const r1 = (await tentativas(c, m, cat))[0].rev;
      await salvarPT(c, m, [{ categoria_id: cat, excluir: [ids[0]], tentativas: [] }], { [ids[0]]: r1 });
      expect(await vezes()).toEqual([[1, f2], [2, f1]]); // excluiu a 1ª: renumera; a antiga 3 (F1) vira a 2
      expect(await vezTS()).toEqual([[1, 1], [2, 1]]); // sem a 1ª, a F1 só aparece na (nova) 2
    });
  });

  it("5) quadro de Etapas POR TIPO: em_teste e aprovada entram (fornecedor = o da tentativa atual); pendente/virtual e tipo sem M.O. não; Reprovado e lançado ficam fora", async () => {
    await withTx(async (c) => {
      await prepara(c, "leitura");
      const cat = await novaCategoria(c, "PL lt5", true, 9320);
      const cat2 = await novaCategoria(c, "Bordado lt5", true, 9321);
      const f = await novoFornecedor(c, "Oficina lt5", [cat, cat2]);
      // card A: em teste (com saída) — aparece; M.O. de 2 linhas do mesmo tipo = 1 trilha no item
      const A = await novoModelo(c, "lt5 A");
      await novaLinhaMo(c, A, cat, null, true);
      await novaLinhaMo(c, A, cat, null, true);
      await novaTentativa(c, { modelo: A, cat, numero: 1, aprovacao: null, emp: f, saida: D1, entrada: null });
      // card B: só tentativa de tipo SEM linha de M.O. — não entra
      const B = await novoModelo(c, "lt5 B");
      await novaLinhaMo(c, B, cat, null, true);
      await novaTentativa(c, { modelo: B, cat: cat2, numero: 1, aprovacao: null, emp: f, saida: D1, entrada: null });
      // card C: aprovada — aparece; card D: lançado — fora; card E: reprovado — fora
      const C = await novoModelo(c, "lt5 C");
      await novaLinhaMo(c, C, cat, null, true);
      await novaTentativa(c, { modelo: C, cat, numero: 1, aprovacao: "aprovado", emp: f });
      const D = await novoModelo(c, "lt5 D");
      await novaLinhaMo(c, D, cat, null, true);
      await novaTentativa(c, { modelo: D, cat, numero: 1, aprovacao: null, emp: f, saida: D1, entrada: null });
      const E = await novoModelo(c, "lt5 E");
      await novaLinhaMo(c, E, cat, null, true);
      await novaTentativa(c, { modelo: E, cat, numero: 1, aprovacao: null, emp: f, saida: D1, entrada: null });
      await comoSistema(c, async () => {
        await c.query("UPDATE public.modelos SET lancado = true WHERE id = $1", [D]);
        await c.query("UPDATE public.modelos SET status_desenvolvimento = 'reprovado' WHERE id = $1", [E]);
      });
      const q = await quadro(c);
      const por = (id: string) => q.find((x) => x.modelo_id === id);
      expect(por(A).trilhas).toHaveLength(1);
      expect(por(A).trilhas[0]).toMatchObject({ status: "em_teste", empresa_nome: expect.stringContaining("Oficina lt5") });
      expect(por(C).trilhas[0].status).toBe("aprovada");
      for (const fora of [B, D, E]) expect(por(fora), fora).toBeUndefined();
    });
  });

  it("6) selo/filtro da lista POR TIPO: 2 linhas do tipo + trilha aprovada = aprovada; trocar o fornecedor da M.O. reabre a M.O. (regra R4) mas NÃO tira a aprovação da PEÇA", async () => {
    await withTx(async (c) => {
      await prepara(c, "leitura");
      const cat = await novaCategoria(c, "PL lt6", true);
      const f1 = await novoFornecedor(c, "F1 lt6", [cat]);
      const f2 = await novoFornecedor(c, "F2 lt6", [cat]);
      const m = await novoModelo(c, "lt6 card");
      await novaLinhaMo(c, m, cat, f1, true);
      await novaLinhaMo(c, m, cat, f1, true);
      const mFalta = await novoModelo(c, "lt6 falta");
      await novaLinhaMo(c, mFalta, cat, f1, true);
      const mEmTeste = await novoModelo(c, "lt6 em teste");
      await novaLinhaMo(c, mEmTeste, cat, f1, true);
      await novaTentativa(c, { modelo: mEmTeste, cat, numero: 1, aprovacao: null, emp: f1, saida: D1, entrada: null });
      await novaTentativa(c, { modelo: m, cat, numero: 1, aprovacao: "aprovado", emp: f1 });
      expect(await lote(c, [m, mFalta, mEmTeste])).toEqual({ [m]: "aprovada", [mFalta]: "falta", [mEmTeste]: "em_teste" });
      await c.query("UPDATE public.modelo_servico_mo SET empresa_id = $2 WHERE modelo_id = $1", [m, f2]); // a M.O. volta a pendente (regra R4: fornecedor mudou)
      expect((await um<{ ok: boolean }>(c, "SELECT public._peca_teste_aprovada_tipo($1, $2) AS ok", [m, cat])).ok).toBe(true); // a PEÇA segue aprovada (fornecedor é da tentativa)
      expect((await lote(c, [m]))[m]).toBe("em_teste"); // …e o selo cai por causa da M.O. pendente, não da peça
      // o espelho TS dá o mesmo
      expect(statusPecaTesteModelo({
        linhas: [{ categoria_id: cat, exige: true, mo_aprovado: true }, { categoria_id: cat, exige: true, mo_aprovado: true }],
        tentativas: [{ categoria_id: cat, numero: 1, aprovacao: "aprovado", data_saida: D1 }],
      })).toBe("aprovada");
    });
  });

  it("7) ACL dos cores de leitura: sem EXECUTE para PUBLIC/anon/authenticated; migration 2x = mesmos md5", async () => {
    await withTx(async (c) => {
      await prepara(c, "leitura");
      const le = async () => (await c.query(`SELECT proname, proacl::text AS acl, md5(pg_get_functiondef(oid)) AS m FROM pg_proc WHERE pronamespace = 'public'::regnamespace
          AND proname IN ('_peca_teste_fornecedores_tipo', '_peca_teste_trilhas_core', '_peca_teste_quadro_core', '_peca_teste_status_lote_core') ORDER BY 1`)).rows;
      const a = await le();
      expect(a).toHaveLength(4);
      for (const r of a) expect(r.acl, r.proname).toBe("{postgres=X/postgres,service_role=X/postgres}");
      await prepara(c, "leitura");
      expect(await le()).toEqual(a);
    });
  });
});
