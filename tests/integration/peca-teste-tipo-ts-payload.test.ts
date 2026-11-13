// Reforma da Peça Teste por TIPO — Task 6: o payload montado pela função TS REAL (`payloadPecaTeste`, a partir da leitura REAL `peca_teste_modelo`)
// é aceito pelo servidor: lançar fornecedor+datas, aprovar, reprovar + próxima no mesmo Salvar, corrigir/excluir/reabrir do histórico, adicionar
// um tipo à mão. Txn revertida; só cópia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx } from "./db";
import { D1, D2, lerPT, novaCategoria, novaLinhaMo, novaTentativa, novoFornecedor, novoModelo, prepara, tentativas } from "./peca-teste-tipo-helpers";
import { um } from "./db";
import {
  adicionarTrilha, aprovar, corrigirTentativa, editarAtual, estadoPTDoServidor, excluirTentativa, mudarDecisaoTentativa, payloadPecaTeste, reprovar,
  type EstadoPT, type TrilhaPT,
} from "../../src/lib/peca-teste";

const RODA = hasDb && ehBancoLocal();
const le = async (c: Client, m: string): Promise<EstadoPT> => estadoPTDoServidor(await lerPT(c, m))!;
const envia = async (c: Client, m: string, draft: EstadoPT, base: EstadoPT) => {
  const p = payloadPecaTeste(draft, base);
  expect(p._trilhas.length, "o rascunho tem de gerar delta").toBeGreaterThan(0);
  await c.query("SELECT public.salvar_peca_teste($1, $2::jsonb, $3::jsonb)", [m, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]);
};
const comTrilha = (e: EstadoPT, fn: (t: TrilhaPT) => TrilhaPT): EstadoPT => ({ ...e, trilhas: e.trilhas.map(fn) });

async function card(c: Client) {
  await prepara(c, "leitura");
  const cat = await novaCategoria(c, "PL ts", true, 9330);
  const f1 = await novoFornecedor(c, "F1 ts", [cat]);
  const f2 = await novoFornecedor(c, "F2 ts", [cat]);
  const m = await novoModelo(c, "ts card");
  await novaLinhaMo(c, m, cat, f1, true);
  return { cat, f1, f2, m };
}

describe.skipIf(!RODA)("reforma por TIPO — o payload da lib TS é aceito pelo servidor (Task 6)", () => {
  it("lançar fornecedor + datas → aprovar: 2 Salvares com o payload real; o requisito do kanban fecha", async () => {
    await withTx(async (c) => {
      const s = await card(c);
      let base = await le(c, s.m);
      expect(base.trilhas[0].tentativas).toEqual([]); // a trilha vem da M.O. (virtual)
      let t = editarAtual(base.trilhas[0], { data_saida: D1, data_entrada: D2, empresa_id: s.f1, empresa_nome: "F1" });
      await envia(c, s.m, comTrilha(base, () => t), base);
      base = await le(c, s.m);
      expect(base.trilhas[0].tentativas[0]).toMatchObject({ empresa_id: s.f1, data_saida: D1, data_entrada: D2, aprovacao: null });
      t = aprovar(base.trilhas[0]);
      await envia(c, s.m, comTrilha(base, () => t), base);
      expect((await tentativas(c, s.m, s.cat))[0].aprovacao).toBe("aprovado");
      expect((await um<{ ok: boolean }>(c, "SELECT public._peca_teste_aprovada_tipo($1, $2) AS ok", [s.m, s.cat])).ok).toBe(true);
    });
  });

  it("reprovar + a próxima (com outro fornecedor) no MESMO Salvar: 2 tentativas no payload (a gravada com rev; a nova com id nulo)", async () => {
    await withTx(async (c) => {
      const s = await card(c);
      await novaTentativa(c, { modelo: s.m, cat: s.cat, numero: 1, aprovacao: null, emp: s.f1, entrada: D2 });
      const base = await le(c, s.m);
      let t = reprovar(base.trilhas[0]);
      t = editarAtual(t, { data_saida: "2026-10-09", empresa_id: s.f2, empresa_nome: "F2" });
      await envia(c, s.m, comTrilha(base, () => t), base);
      expect((await tentativas(c, s.m, s.cat)).map((x) => [x.numero, x.aprovacao, x.empresa_id])).toEqual([[1, "reprovado", s.f1], [2, null, s.f2]]);
    });
  });

  it("histórico: corrigir a reprovada, excluir a do meio (renumera) e reabrir a última reprovada — cada um aceito pelo servidor", async () => {
    await withTx(async (c) => {
      const s = await card(c);
      await novaTentativa(c, { modelo: s.m, cat: s.cat, numero: 1, aprovacao: "reprovado", emp: s.f1 });
      await novaTentativa(c, { modelo: s.m, cat: s.cat, numero: 2, aprovacao: "reprovado", emp: s.f2 });
      await novaTentativa(c, { modelo: s.m, cat: s.cat, numero: 3, aprovacao: "reprovado", emp: s.f1 });
      let base = await le(c, s.m);
      // corrigir a 1ª (data + fornecedor)
      await envia(c, s.m, comTrilha(base, (t) => corrigirTentativa(t, 1, { data_saida: "2026-09-30", empresa_id: s.f2, empresa_nome: "F2" })), base);
      expect((await tentativas(c, s.m, s.cat))[0]).toMatchObject({ data_saida: "2026-09-30", empresa_id: s.f2, aprovacao: "reprovado" });
      // excluir a do meio
      base = await le(c, s.m);
      await envia(c, s.m, comTrilha(base, (t) => excluirTentativa(t, 2)), base);
      expect((await tentativas(c, s.m, s.cat)).map((x) => [x.numero, x.empresa_id])).toEqual([[1, s.f2], [2, s.f1]]);
      // reabrir a ÚLTIMA reprovada (agora a 2): vira pendente; reabrir a 1 (do meio) o rascunho nem gera o delta
      base = await le(c, s.m);
      expect(mudarDecisaoTentativa(base.trilhas[0], 1, null)).toBe(base.trilhas[0]); // bloqueado na lib
      await envia(c, s.m, comTrilha(base, (t) => mudarDecisaoTentativa(t, 2, null)), base);
      expect((await tentativas(c, s.m, s.cat)).map((x) => x.aprovacao)).toEqual(["reprovado", null]);
    });
  });

  it("'Adicionar peça teste': a trilha de um tipo SEM M.O. nasce com o payload real; depois aparece na leitura (tem_mo false)", async () => {
    await withTx(async (c) => {
      const s = await card(c);
      const cat2 = await novaCategoria(c, "Bordado ts", true, 9331);
      const f3 = await novoFornecedor(c, "F3 ts", [cat2]);
      const base = await le(c, s.m);
      expect(base.tipos_adicionar.map((x) => x.categoria_id)).toContain(cat2);
      let draft = adicionarTrilha(base, cat2);
      draft = comTrilha(draft, (t) => (t.categoria_id === cat2 ? editarAtual(t, { data_saida: D1, empresa_id: f3, empresa_nome: "F3" }) : t));
      await envia(c, s.m, draft, base);
      const dep = await le(c, s.m);
      expect(dep.trilhas.map((t) => [t.categoria_id, t.tem_mo])).toEqual([[s.cat, true], [cat2, false]]);
      expect(dep.tipos_adicionar.map((x) => x.categoria_id)).not.toContain(cat2);
    });
  });
});
