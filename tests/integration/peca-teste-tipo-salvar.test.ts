// Reforma da Peça Teste por TIPO — migration 3 (20261129120000_peca_teste_tipo_salvar): o Salvar (`salvar_peca_teste` → `_salvar_peca_teste_core`)
// grava por TIPO. Task 3 = nascer / aprovar / reprovar por tipo, fornecedor da TENTATIVA filtrado pela categoria, trava na tentativa;
// Task 4 = histórico editável (corrigir, excluir + renumerar, mudar decisão, bloqueios). Txn revertida (SAVEPOINT por erro esperado); só cópia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um } from "./db";
import {
  CONFLITO, D1, D2, T, comoSistema, lerPT, novaCategoria, novaLinhaMo, novaTentativa, novoFornecedor, novoModelo, prepara, salvarPT, suf, tenta, tentativas, tp,
} from "./peca-teste-tipo-helpers";

const RODA = hasDb && ehBancoLocal();

type Cen = { cat: string; f1: string; f2: string; m: string };
/** Card com 1 tipo que exige (F1 e F2 vinculados) e UMA linha de M.O. aprovada do tipo. */
async function cenario(c: Client): Promise<Cen> {
  await prepara(c, "salvar");
  const cat = await novaCategoria(c, "PL sv", true);
  const f1 = await novoFornecedor(c, "F1 sv", [cat]);
  const f2 = await novoFornecedor(c, "F2 sv", [cat]);
  const m = await novoModelo(c, "sv card");
  await novaLinhaMo(c, m, cat, f2, true);
  return { cat, f1, f2, m };
}
const chaveKanban = async (c: Client, fn: string, m: string) =>
  (await um<{ j: any }>(c, `SELECT public.${fn}($1, $2::uuid[]) AS j`, [T, [m]])).j[m].peca_teste_aprovada as boolean;
/** Lança a 1ª tentativa (datas + fornecedor) e devolve o id. */
async function lanca(c: Client, s: Cen, forn: string, extra: { entrada?: string | null } = {}): Promise<{ id: string; rev: number }> {
  await salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [tp({ numero: 1, empresa_id: forn, data_saida: D1, data_entrada: extra.entrada === undefined ? D2 : extra.entrada })] }]);
  const t = (await tentativas(c, s.m, s.cat)).at(-1)!;
  return { id: t.id, rev: t.rev };
}

describe.skipIf(!RODA)("reforma por TIPO — Salvar: nascer / aprovar / reprovar (Task 3)", () => {
  it("1) nascer: 1ª tentativa do TIPO (id nulo) leva o fornecedor DA TENTATIVA; mo_linha_id = a M.O. vigente do tipo (histórico); rev 0; sem decisão", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const linha = (await um<{ id: string }>(c, "SELECT id FROM public.modelo_servico_mo WHERE modelo_id = $1", [s.m])).id;
      await salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [tp({ numero: 1, empresa_id: s.f1, data_saida: D1 })] }]);
      const [t] = await tentativas(c, s.m, s.cat);
      expect(t).toMatchObject({ numero: 1, empresa_id: s.f1, aprovacao: null, data_saida: D1, data_entrada: null, rev: 0, mo_linha_id: linha });
      // só nulos (sem fornecedor, datas nem mini) = ignora; com SÓ o fornecedor = nasce (não perde a escolha)
      const cat2 = await novaCategoria(c, "Bordado sv", true);
      const f3 = await novoFornecedor(c, "F3 sv", [cat2]);
      await salvarPT(c, s.m, [{ categoria_id: cat2, tentativas: [tp({ numero: 1 })] }]);
      expect(await tentativas(c, s.m, cat2)).toEqual([]);
      await salvarPT(c, s.m, [{ categoria_id: cat2, tentativas: [tp({ numero: 1, empresa_id: f3 })] }]);
      expect((await tentativas(c, s.m, cat2))[0]).toMatchObject({ numero: 1, empresa_id: f3, mo_linha_id: null }); // sem M.O. do tipo: sem referência histórica
    });
  });

  it("2) 2 linhas de M.O. do MESMO tipo = 1 trilha: a Tentativa 2 vem depois da 1 reprovada, na mesma trilha por tipo", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await novaLinhaMo(c, s.m, s.cat, s.f1, null); // 2ª linha do mesmo tipo
      const t1 = await lanca(c, s, s.f1);
      await salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [tp({ id: t1.id, numero: 1, empresa_id: s.f1, data_saida: D1, data_entrada: D2, aprovacao: "reprovado" })] }], { [t1.id]: t1.rev });
      await salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [tp({ numero: 2, empresa_id: s.f2, data_saida: "2026-10-05" })] }]);
      expect((await tentativas(c, s.m, s.cat)).map((t) => [t.numero, t.aprovacao, t.empresa_id])).toEqual([[1, "reprovado", s.f1], [2, null, s.f2]]);
    });
  });

  it("3) aprovar exige as 2 datas E o fornecedor da tentativa; aprova com decidido_por/decidido_em e o fornecedor fica", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const t1 = await lanca(c, s, s.f1, { entrada: null });
      const base = { [t1.id]: t1.rev };
      const semDatas = await tenta(c, () => salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [tp({ id: t1.id, numero: 1, empresa_id: s.f1, data_saida: D1, data_entrada: null, aprovacao: "aprovado" })] }], base));
      expect(semDatas?.message).toMatch(/^peca_teste_sem_datas: /);
      const semForn = await tenta(c, () => salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [tp({ id: t1.id, numero: 1, empresa_id: null, data_saida: D1, data_entrada: D2, aprovacao: "aprovado" })] }], base));
      expect(semForn?.message).toMatch(/^peca_teste_sem_fornecedor: /);
      expect((await tentativas(c, s.m, s.cat))[0].aprovacao).toBeNull(); // nada gravou
      await salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [tp({ id: t1.id, numero: 1, empresa_id: s.f1, data_saida: D1, data_entrada: D2, aprovacao: "aprovado" })] }], base);
      const r = await um<{ aprovacao: string; decidido_por: string | null; decidido_em: string | null; empresa_id: string }>(
        c, "SELECT aprovacao, decidido_por, decidido_em, empresa_id FROM public.modelo_peca_teste_tentativas WHERE id = $1", [t1.id]);
      expect(r).toMatchObject({ aprovacao: "aprovado", empresa_id: s.f1 });
      expect(r.decidido_por).not.toBeNull();
      expect(r.decidido_em).not.toBeNull();
      expect(await chaveKanban(c, "_avaliar_condicoes_kanban_core", s.m)).toBe(true);
    });
  });

  it("4) reprovar: vai para o histórico e a próxima nasce SEM fornecedor; a nº 3 direto = P0409; tentativa NOVA nunca nasce decidida", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const t1 = await lanca(c, s, s.f1);
      await salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [tp({ id: t1.id, numero: 1, empresa_id: s.f1, data_saida: D1, data_entrada: D2, aprovacao: "reprovado" })] }], { [t1.id]: t1.rev });
      expect((await tentativas(c, s.m, s.cat)).map((t) => [t.numero, t.aprovacao, t.empresa_id])).toEqual([[1, "reprovado", s.f1]]);
      const pula = await tenta(c, () => salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [tp({ numero: 3, data_saida: D1 })] }]));
      expect(pula?.message).toMatch(CONFLITO);
      const nasceDecidida = await tenta(c, () => salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [tp({ numero: 2, empresa_id: s.f1, data_saida: D1, data_entrada: D2, aprovacao: "aprovado" })] }]));
      expect(nasceDecidida?.message).toMatch(/^peca_teste_sem_datas: tentativa nova nao nasce/);
      await salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [tp({ numero: 2, data_saida: "2026-10-09" })] }]); // a próxima, sem fornecedor
      expect((await tentativas(c, s.m, s.cat)).at(-1)).toMatchObject({ numero: 2, empresa_id: null, aprovacao: null });
    });
  });

  it("5) (Review 6) fornecedor filtrado pela CATEGORIA: não vinculado = P0001 fornecedor_categoria; material/outra loja = fornecedor_invalido; tipo SEM fornecedor vinculado não bloqueia a trilha (datas salvam; decidir pede fornecedor)", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const naoVinculado = await novoFornecedor(c, "Fora do tipo", []);
      const e1 = await tenta(c, () => salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [tp({ numero: 1, empresa_id: naoVinculado, data_saida: D1 })] }]));
      expect(e1).toMatchObject({ code: "P0001" });
      expect(e1?.message).toMatch(/^peca_teste_fornecedor_categoria: /);
      const material = (await um<{ id: string }>(c, "INSERT INTO public.empresas (tenant_id, nome_fantasia, tipo) VALUES ($1, $2, 'material') RETURNING id", [T, `Material ${suf()}`])).id;
      const e2 = await tenta(c, () => salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [tp({ numero: 1, empresa_id: material, data_saida: D1 })] }]));
      expect(e2?.message).toMatch(/^peca_teste_fornecedor_invalido: /);
      expect(await tentativas(c, s.m, s.cat)).toEqual([]); // nada gravou
      // categoria SEM nenhum fornecedor vinculado: a trilha existe e as datas salvam; decidir exige fornecedor
      const catVazia = await novaCategoria(c, "Sem forn sv", true);
      await salvarPT(c, s.m, [{ categoria_id: catVazia, tentativas: [tp({ numero: 1, data_saida: D1, data_entrada: D2 })] }]);
      const t = (await tentativas(c, s.m, catVazia))[0];
      expect(t).toMatchObject({ data_saida: D1, data_entrada: D2, empresa_id: null });
      const decidir = await tenta(c, () => salvarPT(c, s.m, [{ categoria_id: catVazia, tentativas: [tp({ id: t.id, numero: 1, data_saida: D1, data_entrada: D2, aprovacao: "aprovado" })] }], { [t.id]: t.rev }));
      expect(decidir?.message).toMatch(/^peca_teste_sem_fornecedor: /);
    });
  });

  it("6) o fornecedor da M.O. é INDEPENDENTE: trocá-lo (mesmo com a peça aprovada) passa, e a aprovação segue valendo", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const t1 = await lanca(c, s, s.f1);
      await salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [tp({ id: t1.id, numero: 1, empresa_id: s.f1, data_saida: D1, data_entrada: D2, aprovacao: "aprovado" })] }], { [t1.id]: t1.rev });
      // a M.O. estava com F2; troca para F1 e depois para outro: o gatilho antigo (em modelo_servico_mo) está inerte
      const erro = await tenta(c, () => c.query("UPDATE public.modelo_servico_mo SET empresa_id = $2 WHERE modelo_id = $1", [s.m, s.f1]));
      expect(erro).toBeNull();
      expect((await tentativas(c, s.m, s.cat))[0]).toMatchObject({ aprovacao: "aprovado", empresa_id: s.f1 });
      expect(await um(c, "SELECT public._peca_teste_aprovada_tipo($1, $2) AS ok", [s.m, s.cat])).toMatchObject({ ok: true });
    });
  });

  it("7) aprovada trava DATAS e FORNECEDOR (P0001, nada grava); o gatilho da tentativa trava até o UPDATE direto; reabrir (aprovado → pendente) e trocar juntos passa", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const t1 = await lanca(c, s, s.f1);
      const base = { [t1.id]: t1.rev };
      await salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [tp({ id: t1.id, numero: 1, empresa_id: s.f1, data_saida: D1, data_entrada: D2, aprovacao: "aprovado" })] }], base);
      const rev1 = (await tentativas(c, s.m, s.cat))[0].rev;
      const datas = await tenta(c, () => salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [tp({ id: t1.id, numero: 1, empresa_id: s.f1, data_saida: "2026-10-02", data_entrada: D2, aprovacao: "aprovado" })] }], { [t1.id]: rev1 }));
      expect(datas?.message).toMatch(/^peca_teste_aprovada_travada: /);
      const forn = await tenta(c, () => salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [tp({ id: t1.id, numero: 1, empresa_id: s.f2, data_saida: D1, data_entrada: D2, aprovacao: "aprovado" })] }], { [t1.id]: rev1 }));
      expect(forn?.message).toMatch(/^peca_teste_fornecedor_travado: /);
      const direto = await tenta(c, () => c.query("UPDATE public.modelo_peca_teste_tentativas SET empresa_id = $2 WHERE id = $1", [t1.id, s.f2]));
      expect(direto?.message).toMatch(/^peca_teste_fornecedor_travado: /);
      // desfazer a aprovação E trocar o fornecedor no mesmo Salvar: o gatilho só morde aprovada → aprovada
      await salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [tp({ id: t1.id, numero: 1, empresa_id: s.f2, data_saida: D1, data_entrada: D2, aprovacao: null })] }], { [t1.id]: rev1 });
      expect((await tentativas(c, s.m, s.cat))[0]).toMatchObject({ aprovacao: null, empresa_id: s.f2 });
    });
  });

  it("8) rev velho = P0409 peca_teste_conflito e NADA grava; o tipo que deixou de exigir = P0409 peca_teste_desatualizada; formato ruim = P0001", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const t1 = await lanca(c, s, s.f1);
      const velho = await tenta(c, () => salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [tp({ id: t1.id, numero: 1, empresa_id: s.f2, data_saida: D1, data_entrada: D2 })] }], { [t1.id]: t1.rev + 5 }));
      expect(velho).toMatchObject({ code: "P0409" });
      expect(velho?.message).toMatch(CONFLITO);
      expect((await tentativas(c, s.m, s.cat))[0].empresa_id).toBe(s.f1);
      const naoExige = await novaCategoria(c, "Lav sv", false);
      const d = await tenta(c, () => salvarPT(c, s.m, [{ categoria_id: naoExige, tentativas: [tp({ numero: 1, data_saida: D1 })] }]));
      expect(d).toMatchObject({ code: "P0409" });
      expect(d?.message).toMatch(/^peca_teste_desatualizada: /);
      const feio = await tenta(c, () => c.query("SELECT public.salvar_peca_teste($1, $2::jsonb, $3::jsonb)", [s.m, JSON.stringify([{ tentativas: [] }]), "{}"]));
      expect(feio?.message).toMatch(/^peca_teste_formato: /);
      const repetida = await tenta(c, () => salvarPT(c, s.m, [{ categoria_id: s.cat, tentativas: [] }, { categoria_id: s.cat, tentativas: [] }]));
      expect(repetida?.message).toMatch(/^peca_teste_formato: /);
    });
  });

  it("9) ACL: o core e os 2 helpers novos sem EXECUTE para PUBLIC/anon/authenticated; migration 2x = mesmos md5", async () => {
    await withTx(async (c) => {
      await prepara(c, "salvar");
      const nomes = ["_salvar_peca_teste_core", "_peca_teste_mini_aplicar", "_peca_teste_valida_fornecedor", "fn_peca_teste_trava_fornecedor", "fn_peca_teste_trava_fornecedor_tentativa"];
      const le = async () => (await c.query(`SELECT proname, proacl::text AS acl, md5(pg_get_functiondef(oid)) AS m FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1) ORDER BY 1`, [nomes])).rows;
      const a = await le();
      expect(a).toHaveLength(5);
      for (const r of a) expect(r.acl, r.proname).toBe("{postgres=X/postgres,service_role=X/postgres}");
      await prepara(c, "salvar");
      expect(await le()).toEqual(a);
    });
  });

  it("10) ordem de travas: a chave do CARD (advisory cad:modelo_id) vem ANTES de qualquer FOR UPDATE ou escrita nas tentativas, no texto vivo do core", async () => {
    await withTx(async (c) => {
      await prepara(c, "salvar");
      const d = (await um<{ d: string }>(c, "SELECT pg_get_functiondef('public._salvar_peca_teste_core(uuid,jsonb,jsonb)'::regprocedure) AS d")).d.replace(/--.*$/gm, "");
      const iLock = d.indexOf("pg_advisory_xact_lock(hashtext('cad:modelo_id:'");
      expect(iLock).toBeGreaterThan(0);
      for (const t of ["FOR UPDATE", "INSERT INTO public.modelo_peca_teste_tentativas", "UPDATE public.modelo_peca_teste_tentativas", "DELETE FROM public.modelo_peca_teste_tentativas"]) {
        const i = d.indexOf(t);
        if (i >= 0) expect(i, t).toBeGreaterThan(iLock);
      }
    });
  });
});
