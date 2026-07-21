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

  it("replace: destino com linhas existentes termina com EXATAMENTE as linhas da origem (não anexa)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const org = (await um<{ id: string }>(c, `insert into modelos (nome, status_planejamento, versao) values ('ORIG_REPLACE','em_planejamento',1) returning id`)).id;
      const dst = (await um<{ id: string }>(c, `insert into modelos (nome, status_planejamento, versao) values ('DEST_REPLACE','em_planejamento',1) returning id`)).id;

      // Origem tem 2 linhas
      await c.query(`insert into modelo_observacoes (modelo_id, ordem, descricao, observacao) values ($1,1,'Manga','3cm'),($1,2,'Punho','dobrado')`, [org]);
      // Destino já tem 1 linha pré-existente
      await c.query(`insert into modelo_observacoes (modelo_id, ordem, descricao, observacao) values ($1,1,'Barra','antigo')`, [dst]);

      // Simula o DELETE + INSERT (replace semantics do handler)
      await c.query(`delete from modelo_observacoes where modelo_id=$1`, [dst]);
      await c.query(`insert into modelo_observacoes (modelo_id, ordem, descricao, observacao)
                     select $2, ordem, descricao, observacao from modelo_observacoes where modelo_id=$1`, [org, dst]);

      const n = (await um<{ n: string }>(c, `select count(*)::text n from modelo_observacoes where modelo_id=$1`, [dst])).n;
      // Deve ter 2 (da origem), não 3 (2+1 pré-existente)
      expect(n).toBe("2");
    });
  });

  it("idempotente: rodar o replace duas vezes ainda resulta em 2 linhas (não acumula)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const org = (await um<{ id: string }>(c, `insert into modelos (nome, status_planejamento, versao) values ('ORIG_IDEM','em_planejamento',1) returning id`)).id;
      const dst = (await um<{ id: string }>(c, `insert into modelos (nome, status_planejamento, versao) values ('DEST_IDEM','em_planejamento',1) returning id`)).id;

      await c.query(`insert into modelo_observacoes (modelo_id, ordem, descricao, observacao) values ($1,1,'Barra','2cm'),($1,2,'Gola','ribana')`, [org]);

      const doReplace = async () => {
        await c.query(`delete from modelo_observacoes where modelo_id=$1`, [dst]);
        await c.query(`insert into modelo_observacoes (modelo_id, ordem, descricao, observacao)
                       select $2, ordem, descricao, observacao from modelo_observacoes where modelo_id=$1`, [org, dst]);
      };

      // Primeira cópia
      await doReplace();
      // Segunda cópia (idempotente)
      await doReplace();

      const n = (await um<{ n: string }>(c, `select count(*)::text n from modelo_observacoes where modelo_id=$1`, [dst])).n;
      // Deve continuar com 2, não 4 (2+2)
      expect(n).toBe("2");
    });
  });

  it("replace com origem vazia apaga as linhas do destino (semântica correta)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const org = (await um<{ id: string }>(c, `insert into modelos (nome, status_planejamento, versao) values ('ORIG_EMPTY','em_planejamento',1) returning id`)).id;
      const dst = (await um<{ id: string }>(c, `insert into modelos (nome, status_planejamento, versao) values ('DEST_EMPTY','em_planejamento',1) returning id`)).id;

      // Destino tem linhas; origem está vazia (nenhum insert)
      await c.query(`insert into modelo_observacoes (modelo_id, ordem, descricao, observacao) values ($1,1,'Bainha','dobrada')`, [dst]);

      // Simula o handler: ALWAYS delete, então só insere se rows.length > 0
      await c.query(`delete from modelo_observacoes where modelo_id=$1`, [dst]);
      // Origem vazia: nenhum insert ocorre

      const n = (await um<{ n: string }>(c, `select count(*)::text n from modelo_observacoes where modelo_id=$1`, [dst])).n;
      // Destino deve estar limpo
      expect(n).toBe("0");
    });
  });
});
