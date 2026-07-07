import { describe, it, expect } from "vitest";
import { withTx, comoUsuario, um, hasDb, TENANT_TESTE } from "./db";

// RPCs atômicas (prova real): saves multi-tabela viram uma transação só (tudo-ou-nada),
// senão uma falha no meio deixava empresa sem categoria / colaboradores órfãos de tipo.

describe.skipIf(!hasDb)("set_empresa_categorias — upsert empresa + junctions atômico", () => {
  it("cria serviço (junction+tenant+espelho), atualiza e cria material", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const catS = await um<{ id: string }>(c, `select id from categorias_terceirizado where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      const catF = await um<{ id: string }>(c, `select id from categorias_fornecedor where tenant_id=$1 limit 1`, [TENANT_TESTE]);

      // CRIA serviço
      const created = await um<{ id: string }>(
        c,
        `select set_empresa_categorias($1::jsonb, $2::uuid[]) as id`,
        [JSON.stringify({ tipo: "servico", nome_fantasia: "ITEST Servico" }), [catS.id]],
      );
      const chk = await um<{ tipo: string; n_serv: string; n_forn: string; tenant: string; esp: string }>(
        c,
        `select (select tipo from empresas where id=$1) tipo,
                (select count(*) from empresa_categorias_servico where empresa_id=$1) n_serv,
                (select count(*) from empresa_categorias_fornecedor where empresa_id=$1) n_forn,
                (select tenant_id::text from empresa_categorias_servico where empresa_id=$1) tenant,
                (select count(*) from terceirizados where nome_responsavel='ITEST Servico' and tenant_id=$2) esp`,
        [created.id, TENANT_TESTE],
      );
      expect(chk.tipo).toBe("servico");
      expect(Number(chk.n_serv)).toBe(1);
      expect(Number(chk.n_forn)).toBe(0);
      expect(chk.tenant).toBe(TENANT_TESTE); // tenant vem por trigger na junction
      expect(Number(chk.esp)).toBe(1); // espelho empresa(servico)→terceirizados

      // ATUALIZA (renomeia, mantém serviço e a mesma categoria)
      await c.query(`select set_empresa_categorias($1::jsonb, $2::uuid[])`, [
        JSON.stringify({ id: created.id, tipo: "servico", nome_fantasia: "ITEST Renomeado" }),
        [catS.id],
      ]);
      const upd = await um<{ nome: string; n: string }>(
        c,
        `select (select nome_fantasia from empresas where id=$1) nome,
                (select count(*) from empresa_categorias_servico where empresa_id=$1) n`,
        [created.id],
      );
      expect(upd.nome).toBe("ITEST Renomeado");
      expect(Number(upd.n)).toBe(1);

      // CRIA material (caminho "nova empresa" do representante)
      const mat = await um<{ id: string }>(
        c,
        `select set_empresa_categorias($1::jsonb, $2::uuid[]) as id`,
        [JSON.stringify({ tipo: "material", nome_fantasia: "ITEST Material" }), [catF.id]],
      );
      const chkM = await um<{ tipo: string; n_forn: string; n_serv: string }>(
        c,
        `select (select tipo from empresas where id=$1) tipo,
                (select count(*) from empresa_categorias_fornecedor where empresa_id=$1) n_forn,
                (select count(*) from empresa_categorias_servico where empresa_id=$1) n_serv`,
        [mat.id],
      );
      expect(chkM.tipo).toBe("material");
      expect(Number(chkM.n_forn)).toBe(1);
      expect(Number(chkM.n_serv)).toBe(0);
    });
  });

  it("bloqueia categoria fora da loja (id inexistente)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      // uuid que não é categoria do tenant → mesmo caminho de "categoria de outra loja".
      await expect(
        c.query(`select set_empresa_categorias($1::jsonb, $2::uuid[])`, [
          JSON.stringify({ tipo: "material", nome_fantasia: "ITEST Alien" }),
          ["00000000-0000-0000-0000-000000000000"],
        ]),
      ).rejects.toThrow();
    });
  });

  it("rejeita cats vazias e tipo inválido", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query("savepoint s");
      await expect(
        c.query(`select set_empresa_categorias($1::jsonb, $2::uuid[])`, [JSON.stringify({ tipo: "material", nome_fantasia: "X" }), []]),
      ).rejects.toThrow();
      await c.query("rollback to s");
      const catF = await um<{ id: string }>(c, `select id from categorias_fornecedor where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      await expect(
        c.query(`select set_empresa_categorias($1::jsonb, $2::uuid[])`, [JSON.stringify({ tipo: "xpto", nome_fantasia: "X" }), [catF.id]]),
      ).rejects.toThrow();
    });
  });
});

describe.skipIf(!hasDb)("renomear_tipo_colaborador — renomeia + cascateia atômico", () => {
  it("renomeia o tipo e propaga aos colaboradores", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const t = await um<{ id: string }>(c, `insert into tipos_colaborador (tenant_id, nome) values ($1,'ITEST Tipo') returning id`, [TENANT_TESTE]);
      await c.query(`insert into colaboradores (tenant_id, nome, tipo) values ($1,'Fulano','ITEST Tipo')`, [TENANT_TESTE]);

      await c.query(`select renomear_tipo_colaborador($1,$2,$3)`, [t.id, "ITEST Novo", null]);

      const chk = await um<{ nome: string; nnovo: string; nold: string }>(
        c,
        `select (select nome from tipos_colaborador where id=$1) nome,
                (select count(*) from colaboradores where tipo='ITEST Novo' and tenant_id=$2) nnovo,
                (select count(*) from colaboradores where tipo='ITEST Tipo' and tenant_id=$2) nold`,
        [t.id, TENANT_TESTE],
      );
      expect(chk.nome).toBe("ITEST Novo");
      expect(Number(chk.nnovo)).toBe(1); // colaborador migrou para o novo nome
      expect(Number(chk.nold)).toBe(0); // nenhum órfão com o nome antigo
    });
  });

  it("bloqueia renomear tipo fora da loja (id inexistente)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      // uuid que não é tipo do tenant → "Tipo não encontrado" (mesmo caminho de cross-tenant).
      await expect(
        c.query(`select renomear_tipo_colaborador($1,$2,$3)`, ["00000000-0000-0000-0000-000000000000", "Hack", null]),
      ).rejects.toThrow();
    });
  });
});
