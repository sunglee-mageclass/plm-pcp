import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { createHash } from "node:crypto";
import { hasDb, ehBancoLocal, withTx, um, semJwt, TENANT_TESTE } from "./db";

// Camada intermediária — Salvar por card do Plan. Tecido, Tarefa 2: RPC `salvar_variante_tecido` (CAS POR CAMPO).
// `variantes_tecido` NÃO tem `rev` próprio (o `rev` colaborativo vive em `artigos`), então a concorrência é compare-and-set por campo
// (como `salvar_config_loja`): só grava as chaves de `_mudancas`; campo que outra pessoa mudou (≠ `_base`) E ≠ o valor que eu gravaria
// = P0409 `conflito_versao: variante_tecido` (ASCII), nada gravado. Tarefa 3 (mesma migration): PRÉVIA de preço no servidor
// (`variante_tecido_preco_previa`: quantos cards NÃO cortados teriam o custo recalculado + assinatura) e a assinatura REAL conferida
// no Salvar quando o preço muda (`_variante_tecido_preco_assinatura_ok`). Só na cópia local (DDL/migration nunca em produção).

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

/** Card (modelo) na loja usando o artigo/variante. `via`: "artigo" = modelo_tecidos.artigo_id; "variante" = só modelo_tecido_variantes
 *  (artigo_id NULL na linha); `corte` cria o cad com enviado_corte=true (custo congelado, R-CD1). */
async function seedModelo(
  c: Client,
  o: { tenant?: string; artigo: string; variante?: string; corte?: boolean; origem?: string; via?: "artigo" | "variante" },
): Promise<string> {
  const tenant = o.tenant ?? TENANT_TESTE;
  seq += 1;
  const m = await um<{ id: string }>(c, `insert into modelos (tenant_id, nome, origem) values ($1,$2,$3) returning id`, [
    tenant,
    `SVT modelo ${seq}`,
    o.origem ?? "interno",
  ]);
  const via = o.via ?? "artigo";
  const mt = await um<{ id: string }>(
    c,
    `insert into modelo_tecidos (modelo_id, artigo_id, numero, tipo) values ($1,$2,1,'tecido') returning id`,
    [m.id, via === "artigo" ? o.artigo : null],
  );
  if (via === "variante") {
    await c.query(`insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) values ($1,$2,1)`, [mt.id, o.variante]);
  }
  if (o.corte) {
    await c.query(`insert into cad (tenant_id, modelo_id, enviado_corte) values ($1,$2,true)`, [tenant, m.id]);
  }
  return m.id;
}

const previa = async (c: Client, id: string, preco: number | string | null) =>
  (
    await um<{ r: { afetados: number; assinatura: string } }>(
      c,
      `select public.variante_tecido_preco_previa($1::uuid, $2::numeric) as r`,
      [id, preco],
    )
  ).r;

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
      const p = await previa(c, variante, 12.5); // preço na mudança = assinatura da prévia (Tarefa 3)
      await salvar(c, variante, { preco: 12.5, codigo_variante: "C-9" }, { preco: null, codigo_variante: null }, p.assinatura);
      const r = await linha(c, variante);
      expect(Number(r.preco)).toBe(12.5);
      expect(r.codigo_variante).toBe("C-9");
    });
  });

  it("preço vazio grava NULL, não 0", async () => {
    await withTx(async (c) => {
      const { variante } = await seedTecidoComVariante(c, { preco: 10 });
      await comoUsuarioComum(c);
      const p = await previa(c, variante, null);
      await salvar(c, variante, { preco: null }, { preco: 10 }, p.assinatura);
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
        "public._variante_tecido_preco_previa_core(uuid,numeric)",
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
      // a previa (wrapper) vai a authenticated/service_role, nunca a anon
      const pw = "public.variante_tecido_preco_previa(uuid,numeric)";
      const qp = (role: string) => um<{ can: boolean }>(c, `select has_function_privilege($1, $2, 'EXECUTE') as can`, [role, pw]);
      expect((await qp("anon")).can).toBe(false);
      expect((await qp("authenticated")).can).toBe(true);
      expect((await qp("service_role")).can).toBe(true);
    });
  });

  // ───────────── Tarefa 2 — lacunas apontadas na revisão ─────────────
  it("servidor foi de 'A' para NULL e a base ainda é 'A': conflito NÃO fica escondido (mesmo mexendo em outro campo junto)", async () => {
    await withTx(async (c) => {
      const { variante } = await seedTecidoComVariante(c, { nome: "Azul" });
      await c.query(`update variantes_tecido set codigo_variante = 'A' where id = $1`, [variante]);
      await comoUsuarioComum(c);
      await c.query(`update variantes_tecido set codigo_variante = null where id = $1`, [variante]); // outra pessoa limpou
      expect(
        await falha(c, () =>
          salvar(c, variante, { nome_variante: "Marinho", codigo_variante: "B" }, { nome_variante: "Azul", codigo_variante: "A" }),
        ),
      ).toMatchObject({ code: "P0409", message: "conflito_versao: variante_tecido", detail: "codigo_variante" });
      const r = await linha(c, variante);
      expect(r.nome_variante).toBe("Azul"); // tudo ou nada
      expect(r.codigo_variante).toBeNull();
    });
  });

  it("convergência NÃO regrava: xmin da linha, rev do artigo e historico_precos ficam como estavam", async () => {
    await withTx(async (c) => {
      const { variante, artigo } = await seedTecidoComVariante(c, { nome: "Azul", preco: 10 });
      await comoUsuarioComum(c);
      // "outra pessoa" grava num SAVEPOINT liberado: a linha fica com o xid da subtransacao (!= xid de topo), entao qualquer
      // regravacao minha mudaria o xmin (e subiria o rev do artigo / logaria o preco de novo)
      await c.query("SAVEPOINT outra_pessoa");
      await c.query(`update variantes_tecido set nome_variante = 'Marinho', preco = 15 where id = $1`, [variante]);
      await c.query("RELEASE SAVEPOINT outra_pessoa");
      const antes = await um<{ x: string; rev: number; hist: number }>(
        c,
        `select v.xmin::text as x, a.rev, jsonb_array_length(v.historico_precos) as hist
           from variantes_tecido v join artigos a on a.id = v.artigo_id where v.id = $1`,
        [variante],
      );
      const p = await previa(c, variante, 15);
      await salvar(c, variante, { nome_variante: "Marinho", preco: 15 }, { nome_variante: "Azul", preco: 10 }, p.assinatura); // converge
      const depois = await um<{ x: string; rev: number; hist: number }>(
        c,
        `select v.xmin::text as x, a.rev, jsonb_array_length(v.historico_precos) as hist
           from variantes_tecido v join artigos a on a.id = v.artigo_id where v.id = $1`,
        [variante],
      );
      expect(depois).toEqual(antes);
      expect(artigo).toBeTruthy();
    });
  });

  it("variantes_tecido.tenant_id de OUTRA loja (mesmo com artigos.tenant_id igual ao meu) = recusada (nao_encontrado), nada muda", async () => {
    await withTx(async (c) => {
      const outra = await um<{ id: string }>(c, `insert into tenants (nome) values ('ITEST SVT tenant divergente') returning id`);
      const a = await seedTecidoComVariante(c, { nome: "X" });
      await c.query(`update variantes_tecido set tenant_id = $2 where id = $1`, [a.variante, outra.id]);
      await comoUsuarioComum(c, a.tenant);
      expect(await falha(c, () => salvar(c, a.variante, { nome_variante: "Z" }, { nome_variante: "X" }))).toMatchObject({
        code: "P0002",
        message: "nao_encontrado: variante",
      });
      expect((await linha(c, a.variante)).nome_variante).toBe("X");
    });
  });
});

describe.skipIf(!hasDb || !ehBancoLocal())("variante_tecido_preco_previa + assinatura (Tarefa 3)", () => {
  it("prévia conta os cards internos NÃO cortados que usam o artigo da cor; ignora os cortados e os de outra origem", async () => {
    await withTx(async (c) => {
      const { variante, artigo } = await seedTecidoComVariante(c, { preco: 10 });
      await comoUsuarioComum(c);
      await seedModelo(c, { artigo }); // conta
      await seedModelo(c, { artigo, corte: true }); // congelado (R-CD1): fica de fora
      await seedModelo(c, { artigo, origem: "revenda" }); // revenda: a fila do custo so enfileira interno
      const r = await previa(c, variante, 20);
      expect(r.afetados).toBe(1);
      expect(r.assinatura).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  it("prévia segue os caminhos da fila do custo (linha do Tecido e variante substituta) e conta cada card UMA vez", async () => {
    await withTx(async (c) => {
      const { variante, artigo } = await seedTecidoComVariante(c, { preco: 10 });
      await comoUsuarioComum(c);
      const m1 = await seedModelo(c, { artigo });
      // o mesmo card usa o artigo por 2 caminhos (linha + variante): continua 1
      await c.query(
        `insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem)
         select id, $2, 1 from modelo_tecidos where modelo_id = $1`,
        [m1, variante],
      );
      await seedModelo(c, { artigo, variante, via: "variante" }); // so pela variante (artigo_id NULL na linha)
      expect((await previa(c, variante, 20)).afetados).toBe(2);
    });
  });

  it("card de OUTRA loja que usa um artigo de outra loja não entra; a prévia só enxerga a minha loja", async () => {
    await withTx(async (c) => {
      const outra = await um<{ id: string }>(c, `insert into tenants (nome) values ('ITEST SVT previa outra') returning id`);
      const a = await seedTecidoComVariante(c, { preco: 10 });
      const b = await seedTecidoComVariante(c, { preco: 10, tenant: outra.id });
      await seedModelo(c, { artigo: b.artigo, tenant: outra.id });
      await comoUsuarioComum(c, a.tenant);
      expect((await previa(c, a.variante, 20)).afetados).toBe(0);
      // variante de outra loja: resposta de "nao ha nada" IDENTICA a de id inexistente (mesma forma; nao revela que existe nem que tem cards)
      const rb = await previa(c, b.variante, 20);
      const inexistente = "00000000-0000-4000-8000-0000000000ee";
      const rx = await previa(c, inexistente, 20);
      expect(rb.afetados).toBe(0);
      expect(rx.afetados).toBe(0);
      const esperado = (id: string) => createHash("md5").update(`${id}:20:`).digest("hex");
      expect(rb.assinatura).toBe(esperado(b.variante)); // so id + preco: nada da loja alheia entra no retrato
      expect(rx.assinatura).toBe(esperado(inexistente));
    });
  });

  it("assinatura independe da grafia numérica (20 = 20.0 = 20.00) e muda com o preço, com os cards e com a variante", async () => {
    await withTx(async (c) => {
      const { variante, artigo } = await seedTecidoComVariante(c, { preco: 10 });
      const outra = await seedTecidoComVariante(c, { preco: 10 });
      await comoUsuarioComum(c);
      await seedModelo(c, { artigo });
      const p20 = (await previa(c, variante, 20)).assinatura;
      expect((await previa(c, variante, "20.0")).assinatura).toBe(p20);
      expect((await previa(c, variante, "20.00")).assinatura).toBe(p20);
      expect((await previa(c, variante, 21)).assinatura).not.toBe(p20);
      expect((await previa(c, variante, null)).assinatura).not.toBe(p20);
      expect((await previa(c, outra.variante, 20)).assinatura).not.toBe(p20);
      await seedModelo(c, { artigo }); // mais um card afetado
      expect((await previa(c, variante, 20)).assinatura).not.toBe(p20);
    });
  });

  it("prévia é só leitura: não grava preço, não enfileira custo, não sobe o rev do artigo", async () => {
    await withTx(async (c) => {
      const { variante, artigo } = await seedTecidoComVariante(c, { preco: 10 });
      const m = await seedModelo(c, { artigo });
      await c.query(`delete from custo_recalculo_fila where modelo_id = $1`, [m]);
      await comoUsuarioComum(c);
      const antes = await um<{ rev: number; preco: string }>(
        c,
        `select a.rev, v.preco from variantes_tecido v join artigos a on a.id = v.artigo_id where v.id = $1`,
        [variante],
      );
      await previa(c, variante, 99);
      const depois = await um<{ rev: number; preco: string }>(
        c,
        `select a.rev, v.preco from variantes_tecido v join artigos a on a.id = v.artigo_id where v.id = $1`,
        [variante],
      );
      expect(depois).toEqual(antes);
      const fila = await um<{ n: string }>(c, `select count(*)::text as n from custo_recalculo_fila where modelo_id = $1`, [m]);
      expect(fila.n).toBe("0");
    });
  });

  it("prévia exige login e módulo Cadastro (mesmo portão do salvar)", async () => {
    await withTx(async (c) => {
      const { variante } = await seedTecidoComVariante(c, { preco: 10 });
      await comoUsuarioComum(c);
      await semJwt(c, async () => {
        await c.query(
          `insert into tenant_config (tenant_id, modules) values ($1, '{"cadastro": false}'::jsonb)
           on conflict (tenant_id) do update set modules = coalesce(tenant_config.modules, '{}'::jsonb) || '{"cadastro": false}'::jsonb`,
          [TENANT_TESTE],
        );
      });
      expect(await falha(c, () => previa(c, variante, 20))).toMatchObject({ code: "42501", message: "modulo_desligado: cadastro" });
      await c.query(`select set_config('request.jwt.claims', '', true)`);
      expect(await falha(c, () => previa(c, variante, 20))).toMatchObject({ code: "42501" });
    });
  });

  it("salvar com a assinatura CERTA grava o preço; a mesma assinatura em outro preço = previa_desatualizada (P0409, ASCII), nada muda", async () => {
    await withTx(async (c) => {
      const { variante, artigo } = await seedTecidoComVariante(c, { preco: 10 });
      await comoUsuarioComum(c);
      await seedModelo(c, { artigo });
      const p = await previa(c, variante, 20);
      await salvar(c, variante, { preco: 20 }, { preco: 10 }, p.assinatura);
      expect(Number((await linha(c, variante)).preco)).toBe(20);
      // a assinatura era do preço 20: com 30 (mesma base nova 20) a prévia teria de ser refeita
      expect(await falha(c, () => salvar(c, variante, { preco: 30 }, { preco: 20 }, p.assinatura))).toMatchObject({
        code: "P0409",
        message: "previa_desatualizada: salvar_preco",
      });
      expect(Number((await linha(c, variante)).preco)).toBe(20);
    });
  });

  it("assinatura de grafia diferente do MESMO preço vale (cliente manda 20.0, prévia foi pedida com 20)", async () => {
    await withTx(async (c) => {
      const { variante, artigo } = await seedTecidoComVariante(c, { preco: 10 });
      await comoUsuarioComum(c);
      await seedModelo(c, { artigo });
      const p = await previa(c, variante, 20);
      await c.query(`select public.salvar_variante_tecido($1::uuid, '{"preco": 20.0}'::jsonb, '{"preco": 10}'::jsonb, $2::text)`, [
        variante,
        p.assinatura,
      ]);
      expect(Number((await linha(c, variante)).preco)).toBe(20);
    });
  });

  it("entre a prévia e o Salvar um card novo passou a usar a cor (ou um afetado foi cortado): assinatura velha = previa_desatualizada", async () => {
    await withTx(async (c) => {
      const { variante, artigo } = await seedTecidoComVariante(c, { preco: 10 });
      await comoUsuarioComum(c);
      const m1 = await seedModelo(c, { artigo });
      const p1 = await previa(c, variante, 20);
      await seedModelo(c, { artigo }); // alguem criou outro card com a cor
      expect(await falha(c, () => salvar(c, variante, { preco: 20 }, { preco: 10 }, p1.assinatura))).toMatchObject({
        code: "P0409",
        message: "previa_desatualizada: salvar_preco",
      });
      const p2 = await previa(c, variante, 20);
      expect(p2.afetados).toBe(2);
      await c.query(`insert into cad (tenant_id, modelo_id, enviado_corte) values ($1,$2,true)`, [TENANT_TESTE, m1]); // um afetado foi cortado
      expect(await falha(c, () => salvar(c, variante, { preco: 20 }, { preco: 10 }, p2.assinatura))).toMatchObject({
        code: "P0409",
        message: "previa_desatualizada: salvar_preco",
      });
      expect(Number((await linha(c, variante)).preco)).toBe(10);
      const p3 = await previa(c, variante, 20);
      expect(p3.afetados).toBe(1);
      await salvar(c, variante, { preco: 20 }, { preco: 10 }, p3.assinatura);
      expect(Number((await linha(c, variante)).preco)).toBe(20);
    });
  });

  it("preço presente SEM assinatura (NULL) = previa_desatualizada; preço ausente de _mudancas não pede assinatura", async () => {
    await withTx(async (c) => {
      const { variante } = await seedTecidoComVariante(c, { nome: "Azul", preco: 10 });
      await comoUsuarioComum(c);
      expect(await falha(c, () => salvar(c, variante, { preco: 20 }, { preco: 10 }, null))).toMatchObject({
        code: "P0409",
        message: "previa_desatualizada: salvar_preco",
      });
      await salvar(c, variante, { nome_variante: "Marinho" }, { nome_variante: "Azul" }); // sem preço: sem assinatura
      const r = await linha(c, variante);
      expect(r.nome_variante).toBe("Marinho");
      expect(Number(r.preco)).toBe(10);
    });
  });

  it("limpar o preço (null) também passa pela assinatura da prévia (prévia com preço null)", async () => {
    await withTx(async (c) => {
      const { variante, artigo } = await seedTecidoComVariante(c, { preco: 10 });
      await comoUsuarioComum(c);
      await seedModelo(c, { artigo });
      const p = await previa(c, variante, null);
      await salvar(c, variante, { preco: null }, { preco: 10 }, p.assinatura);
      expect((await linha(c, variante)).preco).toBeNull();
    });
  });

  it("assinatura certa + conflito de campo = P0409 conflito_versao (a assinatura não esconde o CAS); nada grava", async () => {
    await withTx(async (c) => {
      const { variante } = await seedTecidoComVariante(c, { preco: 10 });
      await comoUsuarioComum(c);
      await c.query(`update variantes_tecido set preco = 12 where id = $1`, [variante]); // outra pessoa
      const p = await previa(c, variante, 20);
      expect(await falha(c, () => salvar(c, variante, { preco: 20 }, { preco: 10 }, p.assinatura))).toMatchObject({
        code: "P0409",
        message: "conflito_versao: variante_tecido",
        detail: "preco",
      });
      expect(Number((await linha(c, variante)).preco)).toBe(12);
    });
  });

  it("CARRY L1 — sem oráculo cross-tenant: variante de OUTRA loja, de tenant divergente e id inexistente dão o MESMO nao_encontrado, com qualquer assinatura", async () => {
    await withTx(async (c) => {
      const outra = await um<{ id: string }>(c, `insert into tenants (nome) values ('ITEST SVT oraculo') returning id`);
      const a = await seedTecidoComVariante(c, { preco: 10 });
      const b = await seedTecidoComVariante(c, { preco: 10, tenant: outra.id }); // outra loja
      const d = await seedTecidoComVariante(c, { preco: 10 }); // artigo meu, variante marcada de outra loja
      await c.query(`update variantes_tecido set tenant_id = $2 where id = $1`, [d.variante, outra.id]);
      const inexistente = "00000000-0000-4000-8000-0000000000dd";
      await comoUsuarioComum(c, a.tenant);
      const alvos: [string, string][] = [
        ["outra loja", b.variante],
        ["tenant divergente", d.variante],
        ["inexistente", inexistente],
      ];
      for (const [rotulo, id] of alvos) {
        const assinaturaDeVerdade = (await previa(c, id, 20)).assinatura; // a que a tela teria recebido
        for (const assin of [null, "lixo", assinaturaDeVerdade]) {
          expect(
            await falha(c, () => salvar(c, id, { preco: 20 }, { preco: 10 }, assin)),
            `${rotulo} / assinatura ${assin === null ? "null" : assin === "lixo" ? "lixo" : "da previa"}`,
          ).toMatchObject({ code: "P0002", message: "nao_encontrado: variante" });
        }
      }
      expect(Number((await linha(c, b.variante)).preco)).toBe(10); // nada mudou na loja alheia
    });
  });
});
