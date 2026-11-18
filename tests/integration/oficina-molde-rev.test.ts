// Realtime Onda 1 · Task 1 — Oficina: "Partes do Molde" (cad.observacoes_molde) protegido por rev.
// Prova no banco (cópia local, txn revertida) o CONTRATO que o front usa: UPDATE com `.eq("rev", revBase)` desatualizado
// NÃO casa nenhuma linha (lost update fechado) e a edição alheia sobrevive. Antes o UPDATE era cru (sem rev) e o 2º salvar
// apagava o 1º sem aviso. O `rev` do cad sobe sozinho a cada UPDATE (trigger de colab).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, comoUsuario, semJwt, um, TENANT_TESTE } from "./db";

/** Cria modelo + cad com `observacoes_molde` e devolve id e rev lidos do banco (rev inicial = o que o trigger deu). */
async function seedCadComMolde(c: Client, molde: string): Promise<{ cadId: string; rev: number }> {
  return semJwt(c, async () => {
    const m = await um<{ id: string }>(c, `insert into modelos (tenant_id, nome) values ($1, 'OFMOLDE modelo') returning id`, [TENANT_TESTE]);
    // O cad nasce num SAVEPOINT liberado: o rev do UPDATE seguinte (outra subtransacao) sobe de verdade (Backend B2).
    await c.query("SAVEPOINT of_molde_seed");
    const cad = await um<{ id: string; rev: number }>(
      c, `insert into cad (tenant_id, modelo_id, observacoes_molde) values ($1, $2, $3) returning id, rev`, [TENANT_TESTE, m.id, molde]);
    await c.query("RELEASE SAVEPOINT of_molde_seed");
    return { cadId: cad.id, rev: Number(cad.rev) };
  });
}

describe.skipIf(!hasDb || !ehBancoLocal())("Oficina: molde protegido por rev (Realtime Onda 1 · T1)", () => {
  it("UPDATE de observacoes_molde com rev antigo NAO sobrescreve (0 linhas) e a edicao alheia sobrevive", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { cadId, rev: revBase } = await seedCadComMolde(c, "molde A");
      // Outra pessoa salva o molde (o trigger de colab sobe o rev sozinho).
      await c.query("update cad set observacoes_molde='molde B' where id=$1", [cadId]);
      const depois = await um<{ rev: number }>(c, "select rev from cad where id=$1", [cadId]);
      expect(Number(depois.rev)).toBeGreaterThan(revBase);
      // Meu save, com o rev lido ANTES (desatualizado): `.eq("rev", revBase)` nao casa -> 0 linhas.
      const r = await c.query("update cad set observacoes_molde='molde C' where id=$1 and rev=$2 returning id", [cadId, revBase]);
      expect(r.rowCount).toBe(0);
      const atual = await um<{ observacoes_molde: string }>(c, "select observacoes_molde from cad where id=$1", [cadId]);
      expect(atual.observacoes_molde).toBe("molde B");
    });
  });

  it("UPDATE com o rev ATUAL grava (1 linha) e o rev sobe, entao o rev antigo deixa de valer", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { cadId, rev: revBase } = await seedCadComMolde(c, "molde A");
      const ok = await c.query("update cad set observacoes_molde='molde B' where id=$1 and rev=$2 returning id, rev", [cadId, revBase]);
      expect(ok.rowCount).toBe(1);
      expect(Number(ok.rows[0].rev)).toBeGreaterThan(revBase);
      // o mesmo rev base de novo (aba que nao re-semeou) e recusado
      const de_novo = await c.query("update cad set observacoes_molde='molde Z' where id=$1 and rev=$2 returning id", [cadId, revBase]);
      expect(de_novo.rowCount).toBe(0);
    });
  });

  // [fix1 F1] O rev do cad sobe por QUALQUER escritor do CAD (aqui: outra coluna do cad), sem tocar o molde. O front, vendo o molde do
  // servidor igual a base, so avanca o rev (decidirAdocaoMolde) — o Salvar com o rev avancado NAO da falso conflito e o texto digitado grava.
  it("rev sobe por OUTRO campo do CAD (molde intacto): Salvar com o rev avancado grava (sem falso conflito)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { cadId, rev: revBase } = await seedCadComMolde(c, "molde A");
      await c.query("update cad set sem_acabamento = true where id=$1", [cadId]);
      const srv = await um<{ rev: number; observacoes_molde: string }>(c, "select rev, observacoes_molde from cad where id=$1", [cadId]);
      expect(Number(srv.rev)).toBeGreaterThan(revBase);
      expect(srv.observacoes_molde).toBe("molde A"); // molde do servidor == base -> o front so avanca o rev
      // com o rev ANTIGO daria 0 linhas (era o falso conflito); com o rev avancado grava o texto digitado
      const velho = await c.query("update cad set observacoes_molde='meu texto' where id=$1 and rev=$2 returning id", [cadId, revBase]);
      expect(velho.rowCount).toBe(0);
      const novo = await c.query("update cad set observacoes_molde='meu texto' where id=$1 and rev=$2 returning id", [cadId, Number(srv.rev)]);
      expect(novo.rowCount).toBe(1);
    });
  });
});
