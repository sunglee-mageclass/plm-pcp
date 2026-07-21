import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um } from "./db";

describe.skipIf(!hasDb)("importar obs-bloco (linhas manuais)", () => {
  it("copia as linhas manuais de modelo_observacoes para o destino", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const org = (await um<{ id: string }>(c, `insert into modelos (nome, status_planejamento, versao) values ('ORIG','em_planejamento',1) returning id`)).id;
      const dst = (await um<{ id: string }>(c, `insert into modelos (nome, status_planejamento, versao) values ('DEST','em_planejamento',1) returning id`)).id;
      await c.query(`insert into modelo_observacoes (modelo_id, ordem, descricao, observacao) values ($1,1,'Barra','2cm'),($1,2,'Gola','ribana')`, [org]);
      // simula o insert de cópia (mesma query do handler)
      await c.query(`insert into modelo_observacoes (modelo_id, ordem, descricao, observacao)
                     select $2, ordem, descricao, observacao from modelo_observacoes where modelo_id=$1`, [org, dst]);
      const n = (await um<{ n: string }>(c, `select count(*)::text n from modelo_observacoes where modelo_id=$1`, [dst])).n;
      expect(n).toBe("2");
    });
  });
});
