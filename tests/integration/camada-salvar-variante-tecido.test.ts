import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, TENANT_TESTE } from "./db";

// Camada intermediária — Salvar por card do Plan. Tecido, Tarefa 2: RPC `salvar_variante_tecido` (CAS POR CAMPO).
// `variantes_tecido` NÃO tem `rev` próprio (o `rev` colaborativo vive em `artigos`), então a concorrência é compare-and-set por campo
// (como `salvar_config_loja`): só grava as chaves de `_mudancas`; campo que outra pessoa mudou (≠ `_base`) E ≠ o valor que eu gravaria
// = P0409 `conflito_versao: variante_tecido` (ASCII), nada gravado. Os casos de preço com assinatura REAL da prévia são da Tarefa 3
// (aqui `_variante_tecido_preco_assinatura_ok` é um stub permissivo). Só na cópia local (DDL/migration nunca em produção).

let seq = 0;

/** Usuário COMUM (não super admin, sem papel) da Loja Teste, como identidade ativa (auth.uid()). Txn revertida. */
async function comoUsuarioComum(c: Client, tenant: string = TENANT_TESTE): Promise<string> {
  seq += 1;
  const uid = `0b0b0b0b-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  await c.query(`insert into auth.users (id, email) values ($1,$2) on conflict (id) do nothing`, [uid, `${uid}@teste`]);
  await c.query(
    `insert into public.users (id, tenant_id, email, nome) values ($1,$2,$3,'Comum SVT')
     on conflict (id) do update set tenant_id = excluded.tenant_id`,
    [uid, tenant, `${uid}@teste`],
  );
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
  return uid;
}

/** 1 artigo (tecido) + 1 variante na loja pedida. Devolve os ids. */
async function seedTecidoComVariante(
  c: Client,
  o: { tenant?: string; nome?: string; preco?: number | null } = {},
): Promise<{ artigo: string; variante: string; tenant: string }> {
  const tenant = o.tenant ?? TENANT_TESTE;
  seq += 1;
  const art = await um<{ id: string }>(
    c,
    `insert into artigos (tenant_id, nome) values ($1,$2) returning id`,
    [tenant, `SVT artigo ${seq}`],
  );
  const v = await um<{ id: string }>(
    c,
    `insert into variantes_tecido (tenant_id, artigo_id, nome_variante, preco) values ($1,$2,$3,$4) returning id`,
    [tenant, art.id, o.nome ?? "Azul", o.preco === undefined ? null : o.preco],
  );
  return { artigo: art.id, variante: v.id, tenant };
}

const salvar = (c: Client, id: string, mudancas: unknown, base: unknown, assinatura: string | null = null) =>
  c.query(`select public.salvar_variante_tecido($1::uuid, $2::jsonb, $3::jsonb, $4::text)`, [
    id,
    JSON.stringify(mudancas),
    JSON.stringify(base),
    assinatura,
  ]);

/** Roda `fn` dentro de SAVEPOINT (erro do banco aborta a txn): devolve o erro lançado (ou null) e deixa a txn utilizável. */
async function falha(c: Client, fn: () => Promise<unknown>): Promise<any> {
  await c.query("SAVEPOINT svt_falha");
  try {
    await fn();
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT svt_falha");
    return e;
  }
  await c.query("RELEASE SAVEPOINT svt_falha");
  return null;
}

const linha = async (c: Client, id: string) =>
  um<{ nome_variante: string | null; preco: string | null; codigo_variante: string | null; cor_id: string | null }>(
    c,
    `select nome_variante, preco, codigo_variante, cor_id from variantes_tecido where id = $1`,
    [id],
  );

describe.skipIf(!hasDb || !ehBancoLocal())("salvar_variante_tecido (CAS por campo)", () => {
  it("grava só os campos mudados; campo não tocado por mim não é revertido", async () => {
    await withTx(async (c) => {
      const { variante } = await seedTecidoComVariante(c, { nome: "Azul", preco: 10 });
      await comoUsuarioComum(c);
      // outra pessoa mudou o PREÇO para 15 depois que peguei a base (base tinha 10)
      await c.query(`update variantes_tecido set preco = 15 where id = $1`, [variante]);
      // eu mudo só o NOME; a base que vi tinha preco=10, nome=Azul
      await salvar(c, variante, { nome_variante: "Marinho" }, { nome_variante: "Azul", preco: 10 });
      const r = await linha(c, variante);
      expect(r.nome_variante).toBe("Marinho"); // meu campo gravou
      expect(Number(r.preco)).toBe(15); // o preço da outra pessoa NÃO foi revertido
    });
  });

  it("conflito no MESMO campo = P0409 conflito_versao (ASCII, DETAIL = campo), nada gravado", async () => {
    await withTx(async (c) => {
      const { variante } = await seedTecidoComVariante(c, { nome: "Azul", preco: 10 });
      await comoUsuarioComum(c);
      await c.query(`update variantes_tecido set nome_variante = 'Preto' where id = $1`, [variante]); // outra pessoa mudou o nome
      expect(
        await falha(c, () =>
          salvar(c, variante, { nome_variante: "Marinho", codigo_variante: "X1" }, { nome_variante: "Azul", codigo_variante: null }),
        ),
      ).toMatchObject({
        code: "P0409",
        message: "conflito_versao: variante_tecido",
        detail: "nome_variante",
      });
      const r = await linha(c, variante);
      expect(r.nome_variante).toBe("Preto"); // nada gravado
      expect(r.codigo_variante).toBeNull(); // nem o campo sem conflito (tudo ou nada)
    });
  });

  it("convergência não é conflito: outra pessoa já gravou o MESMO valor que eu ia gravar", async () => {
    await withTx(async (c) => {
      const { variante } = await seedTecidoComVariante(c, { nome: "Azul" });
      await comoUsuarioComum(c);
      await c.query(`update variantes_tecido set nome_variante = 'Marinho' where id = $1`, [variante]);
      await salvar(c, variante, { nome_variante: "Marinho" }, { nome_variante: "Azul" }); // não lança
      expect((await linha(c, variante)).nome_variante).toBe("Marinho");
    });
  });

  it("base NULL no servidor (campo nunca preenchido) não dá conflito falso", async () => {
    await withTx(async (c) => {
      const { variante } = await seedTecidoComVariante(c, { nome: "Azul", preco: null });
      await comoUsuarioComum(c);
      await salvar(c, variante, { preco: 12.5, codigo_variante: "C-9" }, { preco: null, codigo_variante: null });
      const r = await linha(c, variante);
      expect(Number(r.preco)).toBe(12.5);
      expect(r.codigo_variante).toBe("C-9");
    });
  });

  it("preço vazio grava NULL, não 0", async () => {
    await withTx(async (c) => {
      const { variante } = await seedTecidoComVariante(c, { preco: 10 });
      await comoUsuarioComum(c);
      await salvar(c, variante, { preco: null }, { preco: 10 });
      expect((await linha(c, variante)).preco).toBeNull();
    });
  });

  it("variante de OUTRA loja = recusada (P0002 nao_encontrado, sem oráculo) e nada muda", async () => {
    await withTx(async (c) => {
      const outra = await um<{ id: string }>(c, `insert into tenants (nome) values ('ITEST SVT outra loja') returning id`);
      const a = await seedTecidoComVariante(c, { nome: "X" });
      const b = await seedTecidoComVariante(c, { nome: "Y", tenant: outra.id }); // outra loja
      await comoUsuarioComum(c, a.tenant);
      expect(await falha(c, () => salvar(c, b.variante, { nome_variante: "Z" }, { nome_variante: "Y" }))).toMatchObject({
        code: "P0002",
        message: "nao_encontrado: variante",
      });
      expect((await linha(c, b.variante)).nome_variante).toBe("Y");
      // id inexistente dá o MESMO erro (sem oráculo cross-tenant)
      expect(
        await falha(c, () => salvar(c, "00000000-0000-4000-8000-0000000000ff", { nome_variante: "Z" }, { nome_variante: "Y" })),
      ).toMatchObject({ code: "P0002", message: "nao_encontrado: variante" });
    });
  });

  it("chaves fora da lista branca são recusadas (foto, endereços, artigo, histórico…) e falta de base também", async () => {
    await withTx(async (c) => {
      const { variante } = await seedTecidoComVariante(c, { nome: "Azul" });
      await comoUsuarioComum(c);
      for (const k of ["foto_url", "historico_precos", "enderecos", "rua", "prateleira", "artigo_id", "tenant_id"]) {
        expect(await falha(c, () => salvar(c, variante, { [k]: "x" }, { [k]: null })), k).toMatchObject({ code: "P0001" });
      }
      expect(await falha(c, () => salvar(c, variante, { nome_variante: "M" }, {}))).toMatchObject({ code: "P0001" });
      expect(await falha(c, () => salvar(c, variante, [], {}))).toMatchObject({ code: "P0001" });
      expect((await linha(c, variante)).nome_variante).toBe("Azul");
    });
  });

  it("login obrigatório (sem JWT = 42501) e módulo Cadastro desligado = 42501 modulo_desligado", async () => {
    await withTx(async (c) => {
      const { variante } = await seedTecidoComVariante(c, { nome: "Azul" });
      await comoUsuarioComum(c);
      // módulo desligado na txn SEM claims (MOD-1: com JWT o gatilho ignora a troca de `modules`)
      await semJwt(c, async () => {
        await c.query(
          `insert into tenant_config (tenant_id, modules) values ($1, '{"cadastro": false}'::jsonb)
           on conflict (tenant_id) do update set modules = coalesce(tenant_config.modules, '{}'::jsonb) || '{"cadastro": false}'::jsonb`,
          [TENANT_TESTE],
        );
      });
      expect(await falha(c, () => salvar(c, variante, { nome_variante: "M" }, { nome_variante: "Azul" }))).toMatchObject({
        code: "42501",
        message: "modulo_desligado: cadastro",
      });
      await c.query(`select set_config('request.jwt.claims', '', true)`);
      expect(await falha(c, () => salvar(c, variante, { nome_variante: "M" }, { nome_variante: "Azul" }))).toMatchObject({ code: "42501" });
      expect((await linha(c, variante)).nome_variante).toBe("Azul");
    });
  });

  it("ACL: anon/authenticated NÃO executam o _core nem o helper de assinatura; o wrapper vai a authenticated/service_role, não a anon", async () => {
    await withTx(async (c) => {
      const sigs = [
        "public._salvar_variante_tecido_core(uuid,jsonb,jsonb)",
        "public._variante_tecido_preco_assinatura_ok(uuid,numeric,text)",
      ];
      for (const sig of sigs) {
        for (const role of ["anon", "authenticated"]) {
          const r = await um<{ can: boolean }>(c, `select has_function_privilege($1, $2, 'EXECUTE') as can`, [role, sig]);
          expect(r.can, `${role} em ${sig}`).toBe(false);
        }
      }
      const w = "public.salvar_variante_tecido(uuid,jsonb,jsonb,text)";
      const q = (role: string) => um<{ can: boolean }>(c, `select has_function_privilege($1, $2, 'EXECUTE') as can`, [role, w]);
      expect((await q("anon")).can).toBe(false);
      expect((await q("authenticated")).can).toBe(true);
      expect((await q("service_role")).can).toBe(true);
    });
  });
});
