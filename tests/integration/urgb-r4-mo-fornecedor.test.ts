// Urgentes R4a (plan-b Task 1, migration 20261103180000_urg_r4_mo_fornecedor): fornecedor de serviço (empresa_id) em cada linha
// de M.O. (modelo_servico_mo). Txn revertida; o bloco é aplicado DENTRO da txn por aplicaUrgb(c, "r4a") (pula se já vivo na
// cópia). Só na cópia local (DDL em txn contra produção trava o app — incidente 23/set).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, semJwt, TENANT_TESTE, ehBancoLocal } from "./db";
import { aplicaUrgb, voltaUrgb, urgbViva, URGB_MIGS, md5UrgbSucessor } from "./urgb-helpers";
import { aplicarArquivo } from "./mig-txn";

const BLOCO = URGB_MIGS.find((x) => x.id === "r4a")?.b;
const RODA = hasDb && ehBancoLocal() && !!BLOCO;
const SALVAR_CORE = "public._salvar_modelo_servico_mo_core(uuid,jsonb)";
const SEM_PERM = "0a0a0a0a-0000-4000-8000-0000000000b4";

async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}

async function outraLoja(c: Client): Promise<string> {
  return (
    await um<{ id: string }>(c, "SELECT id FROM public.tenants WHERE id <> $1 ORDER BY id LIMIT 1", [TENANT_TESTE])
  ).id;
}

/** Cenário: aplica o bloco, entra como o usuário da Loja Teste e cria modelo + 2 serviços + 4 empresas. */
async function cenario(c: Client) {
  await aplicaUrgb(c, "r4a");
  await comoUsuario(c);
  const sufixo = Math.random().toString(36).slice(2, 8);
  const modelo = (
    await um<{ id: string }>(c, "INSERT INTO modelos (tenant_id, nome) VALUES ($1, $2) RETURNING id", [
      TENANT_TESTE,
      `M R4a ${sufixo}`,
    ])
  ).id;
  const cat = async (n: string) =>
    (
      await um<{ id: string }>(
        c,
        "INSERT INTO categorias_terceirizado (tenant_id, nome, etapa) VALUES ($1, $2, 'ate_costura') RETURNING id",
        [TENANT_TESTE, `Serv R4a ${n} ${sufixo}`],
      )
    ).id;
  const emp = async (tenant: string, tipo: string, nome: string) =>
    semJwt(c, async () =>
      (
        await um<{ id: string }>(
          c,
          "INSERT INTO empresas (tenant_id, nome_fantasia, tipo) VALUES ($1, $2, $3) RETURNING id",
          [tenant, `${nome} ${sufixo}`, tipo],
        )
      ).id,
    );
  const outra = await outraLoja(c);
  return {
    modelo,
    cat1: await cat("a"),
    cat2: await cat("b"),
    servico: await emp(TENANT_TESTE, "servico", "Oficina R4a"),
    servico2: await emp(TENANT_TESTE, "servico", "Bordado R4a"),
    material: await emp(TENANT_TESTE, "material", "Tecidos R4a"),
    outraLoja: await emp(outra, "servico", "Oficina Outra Loja R4a"),
  };
}

async function salvar(c: Client, modelo: string, linhas: unknown[]): Promise<void> {
  await c.query("SELECT public.salvar_modelo_servico_mo($1, $2::jsonb)", [modelo, JSON.stringify(linhas)]);
}
async function linhas(c: Client, modelo: string) {
  return (
    await c.query(
      `SELECT id, categoria_terceirizado_id AS cat, valor, aprovado, empresa_id FROM modelo_servico_mo
        WHERE modelo_id = $1 ORDER BY created_at, id`,
      [modelo],
    )
  ).rows as { id: string; cat: string; valor: string; aprovado: boolean | null; empresa_id: string | null }[];
}

/** Usuário que EDITA o Planejamento e vê custos (passa o portão da S3c), mas NÃO tem producao_servico_aprovacao. */
async function comoSemAprovacao(c: Client): Promise<void> {
  await c.query("INSERT INTO auth.users (id, email) VALUES ($1, 'noperm-r4a@teste') ON CONFLICT (id) DO NOTHING", [SEM_PERM]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome) VALUES ($1, $2, 'noperm-r4a@teste', 'Sem Perm R4a')
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [SEM_PERM, TENANT_TESTE],
  );
  await c.query("DELETE FROM public.user_permissions WHERE user_id = $1", [SEM_PERM]);
  await c.query(
    `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
     VALUES ($1, $2, 'criacao_planejamento', true, true), ($1, $2, 'criacao_planejamento:custos', true, false)`,
    [SEM_PERM, TENANT_TESTE],
  );
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: SEM_PERM, role: "authenticated" }),
  ]);
  expect((await um<{ p: boolean }>(c, "SELECT public.user_can_edit('producao_servico_aprovacao') AS p")).p).toBe(false);
}

describe.skipIf(!RODA)("urg R4a — fornecedor de serviço na linha de M.O. (modelo_servico_mo.empresa_id)", () => {
  it("bloco aplicado: md5 DEPOIS das 3, coluna uuid nullable com FK NO ACTION, authenticated sem UPDATE/INSERT na coluna", async () => {
    await withTx(async (c) => {
      await aplicaUrgb(c, "r4a");
      expect(await urgbViva(c, "r4a")).toBe(true);
      // (a r4b, por cima, redefine o _salvar_modelo_servico_mo_core na fix round 3: aceita o sucessor)
      for (const [sig, m] of Object.entries(BLOCO!.URGB_MD5)) expect(md5UrgbSucessor(sig, m.depois), sig).toContain(await md5Fn(c, sig));
      const col = await um<{ t: string; n: string; d: string | null }>(
        c,
        `SELECT data_type AS t, is_nullable AS n, column_default AS d FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'modelo_servico_mo' AND column_name = 'empresa_id'`,
      );
      expect(col).toEqual({ t: "uuid", n: "YES", d: null });
      const fk = await um<{ n: number }>(
        c,
        `SELECT count(*)::int AS n FROM pg_constraint k
          WHERE k.conrelid = 'public.modelo_servico_mo'::regclass AND k.contype = 'f'
            AND k.confrelid = 'public.empresas'::regclass AND k.confdeltype = 'a'`,
      );
      expect(fk.n).toBe(1);
      const pv = await um<{ u: boolean; i: boolean; s: boolean }>(
        c,
        `SELECT has_column_privilege('authenticated', 'public.modelo_servico_mo', 'empresa_id', 'UPDATE') AS u,
                has_column_privilege('authenticated', 'public.modelo_servico_mo', 'empresa_id', 'INSERT') AS i,
                has_column_privilege('authenticated', 'public.modelo_servico_mo', 'empresa_id', 'SELECT') AS s`,
      );
      expect(pv).toEqual({ u: false, i: false, s: true });
    });
  });

  it("1) linha nova com fornecedor de serviço da loja: gravada; modelo_mo_resumo devolve empresa_id e empresa_nome", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await salvar(c, s.modelo, [
        { categoria_terceirizado_id: s.cat1, valor: 10, empresa_id: s.servico },
        { categoria_terceirizado_id: s.cat2, valor: 5 }, // linha nova SEM a chave = sem fornecedor
      ]);
      const ls = await linhas(c, s.modelo);
      expect(ls.map((l) => l.empresa_id).sort()).toEqual([null, s.servico].sort());
      const r = await um<{ r: any }>(c, "SELECT public.modelo_mo_resumo(ARRAY[$1]::uuid[]) AS r", [s.modelo]);
      const lr = r.r[s.modelo].linhas as { categoria_terceirizado_id: string; empresa_id: string | null; empresa_nome: string | null }[];
      const comForn = lr.find((x) => x.categoria_terceirizado_id === s.cat1)!;
      const semForn = lr.find((x) => x.categoria_terceirizado_id === s.cat2)!;
      expect(comForn.empresa_id).toBe(s.servico);
      expect(comForn.empresa_nome).toMatch(/^Oficina R4a /);
      expect(semForn.empresa_id).toBeNull();
      expect(semForn.empresa_nome).toBeNull();
      expect("empresa_id" in semForn && "empresa_nome" in semForn).toBe(true);
    });
  });

  it("2) empresa de OUTRA loja ou de tipo 'material' = P0001 'Fornecedor de serviço inválido' (nada grava)", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      for (const emp of [s.outraLoja, s.material]) {
        await c.query("SAVEPOINT r4a");
        await expect(salvar(c, s.modelo, [{ categoria_terceirizado_id: s.cat1, valor: 10, empresa_id: emp }])).rejects.toMatchObject({
          code: "P0001",
          message: "Fornecedor de serviço inválido",
        });
        await c.query("ROLLBACK TO SAVEPOINT r4a");
      }
      // também numa linha EXISTENTE
      await salvar(c, s.modelo, [{ categoria_terceirizado_id: s.cat1, valor: 10 }]);
      const [l] = await linhas(c, s.modelo);
      await c.query("SAVEPOINT r4a");
      await expect(
        salvar(c, s.modelo, [{ id: l.id, categoria_terceirizado_id: s.cat1, valor: 10, empresa_id: s.outraLoja }]),
      ).rejects.toMatchObject({ code: "P0001", message: "Fornecedor de serviço inválido" });
      await c.query("ROLLBACK TO SAVEPOINT r4a");
      expect((await linhas(c, s.modelo))[0].empresa_id).toBeNull();
    });
  });

  it("3) payload SEM a chave empresa_id (card PA/PI, site antigo) numa linha com fornecedor: fornecedor MANTIDO", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await salvar(c, s.modelo, [{ categoria_terceirizado_id: s.cat1, valor: 10, empresa_id: s.servico }]);
      const [l] = await linhas(c, s.modelo);
      await salvar(c, s.modelo, [{ id: l.id, categoria_terceirizado_id: s.cat1, valor: 12, observacoes: "x" }]);
      const [d] = await linhas(c, s.modelo);
      expect(d.empresa_id).toBe(s.servico);
      expect(Number(d.valor)).toBe(12);
    });
  });

  it("4) payload com empresa_id null ou '' apaga o fornecedor; outro fornecedor válido troca", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await salvar(c, s.modelo, [{ categoria_terceirizado_id: s.cat1, valor: 10, empresa_id: s.servico }]);
      const [l] = await linhas(c, s.modelo);
      await salvar(c, s.modelo, [{ id: l.id, categoria_terceirizado_id: s.cat1, valor: 10, empresa_id: s.servico2 }]);
      expect((await linhas(c, s.modelo))[0].empresa_id).toBe(s.servico2);
      await salvar(c, s.modelo, [{ id: l.id, categoria_terceirizado_id: s.cat1, valor: 10, empresa_id: null }]);
      expect((await linhas(c, s.modelo))[0].empresa_id).toBeNull();
      await salvar(c, s.modelo, [{ id: l.id, categoria_terceirizado_id: s.cat1, valor: 10, empresa_id: s.servico }]);
      await salvar(c, s.modelo, [{ id: l.id, categoria_terceirizado_id: s.cat1, valor: 10, empresa_id: "" }]);
      expect((await linhas(c, s.modelo))[0].empresa_id).toBeNull();
    });
  });

  it("5) linha APROVADA cujo fornecedor muda volta a PENDENTE sem exigir producao_servico_aprovacao; mesmo fornecedor segue aprovada", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await salvar(c, s.modelo, [{ categoria_terceirizado_id: s.cat1, valor: 10, empresa_id: s.servico }]);
      const [l] = await linhas(c, s.modelo);
      await c.query("SELECT public.aprovar_servico_mo($1, $2, true, null)", [s.modelo, l.id]);
      expect((await linhas(c, s.modelo))[0].aprovado).toBe(true);
      await comoSemAprovacao(c);
      // mesmo fornecedor (e mesmo valor) = nada muda: segue aprovada
      await salvar(c, s.modelo, [{ id: l.id, categoria_terceirizado_id: s.cat1, valor: "10.00", empresa_id: s.servico }]);
      expect((await linhas(c, s.modelo))[0].aprovado).toBe(true);
      // chave ausente = mantém = segue aprovada
      await salvar(c, s.modelo, [{ id: l.id, categoria_terceirizado_id: s.cat1, valor: 10 }]);
      expect((await linhas(c, s.modelo))[0].aprovado).toBe(true);
      // troca o fornecedor: volta a pendente (sem 42501)
      await salvar(c, s.modelo, [{ id: l.id, categoria_terceirizado_id: s.cat1, valor: 10, empresa_id: s.servico2 }]);
      const d = (await linhas(c, s.modelo))[0];
      expect(d.aprovado).toBeNull();
      expect(d.empresa_id).toBe(s.servico2);
      expect(
        (await um<{ f: boolean }>(c, "SELECT custo_terceirizados_aprovado AS f FROM modelos WHERE id = $1", [s.modelo])).f,
      ).toBe(false);
    });
  });

  it("5b) linha REPROVADA cujo fornecedor é apagado volta a PENDENTE e o motivo é limpo", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await salvar(c, s.modelo, [{ categoria_terceirizado_id: s.cat1, valor: 10, empresa_id: s.servico }]);
      const [l] = await linhas(c, s.modelo);
      await c.query("SELECT public.aprovar_servico_mo($1, $2, false, 'caro')", [s.modelo, l.id]);
      await comoSemAprovacao(c);
      await salvar(c, s.modelo, [{ id: l.id, categoria_terceirizado_id: s.cat1, valor: 10, empresa_id: null }]);
      const d = await um<{ aprovado: boolean | null; motivo_reprovacao: string | null }>(
        c,
        "SELECT aprovado, motivo_reprovacao FROM modelo_servico_mo WHERE id = $1",
        [l.id],
      );
      expect(d).toEqual({ aprovado: null, motivo_reprovacao: null });
    });
  });

  it("6) fornecedor gravado e a empresa vira tipo 'material': Salvar com o MESMO empresa_id passa; em outra linha, não", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await salvar(c, s.modelo, [{ categoria_terceirizado_id: s.cat1, valor: 10, empresa_id: s.servico }]);
      const [l] = await linhas(c, s.modelo);
      await semJwt(c, () => c.query("UPDATE empresas SET tipo = 'material' WHERE id = $1", [s.servico]));
      await salvar(c, s.modelo, [{ id: l.id, categoria_terceirizado_id: s.cat1, valor: 11, empresa_id: s.servico }]);
      expect((await linhas(c, s.modelo))[0].empresa_id).toBe(s.servico);
      await c.query("SAVEPOINT r4a");
      await expect(
        salvar(c, s.modelo, [
          { id: l.id, categoria_terceirizado_id: s.cat1, valor: 11, empresa_id: s.servico },
          { categoria_terceirizado_id: s.cat2, valor: 3, empresa_id: s.servico },
        ]),
      ).rejects.toMatchObject({ code: "P0001", message: "Fornecedor de serviço inválido" });
      await c.query("ROLLBACK TO SAVEPOINT r4a");
    });
  });

  it("7) DELETE de empresa usada como fornecedor em linha de M.O. = 23503 (FK NO ACTION)", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await salvar(c, s.modelo, [{ categoria_terceirizado_id: s.cat1, valor: 10, empresa_id: s.servico }]);
      // (sem semJwt: o finally dele roda numa txn já abortada e mascara o código)
      await expect(c.query("DELETE FROM empresas WHERE id = $1", [s.servico])).rejects.toMatchObject({ code: "23503" });
    });
  });

  it("8) ACL das 3 = a de antes; anon/authenticated sem EXECUTE no _core", async () => {
    await withTx(async (c) => {
      await aplicaUrgb(c, "r4a");
      for (const [sig, acl] of Object.entries(BLOCO!.URGB_ACL)) {
        const r = await um<{ a: string; sd: boolean; cfg: string }>(
          c,
          `SELECT coalesce(proacl::text, '') AS a, prosecdef AS sd, coalesce(array_to_string(proconfig, '|'), '') AS cfg
             FROM pg_proc WHERE oid = to_regprocedure($1)`,
          [sig],
        );
        expect(r, sig).toEqual({ a: acl, sd: true, cfg: "search_path=public" });
        for (const role of ["anon", "authenticated"]) {
          expect(
            (await um<{ x: boolean }>(c, "SELECT has_function_privilege($1, $2, 'EXECUTE') AS x", [role, sig])).x,
            `${role} ${sig}`,
          ).toBe(false);
        }
      }
      expect(BLOCO!.URGB_ACL[SALVAR_CORE]).toBe("{postgres=X/postgres,service_role=X/postgres}");
    });
  });

  it("9) volta: voltaUrgb devolve os md5 de ANTES (coluna fica); reaplicar = idempotente", async () => {
    await withTx(async (c) => {
      await aplicaUrgb(c, "r4a");
      await voltaUrgb(c);
      expect(await urgbViva(c, "r4a")).toBe(false);
      for (const [sig, m] of Object.entries(BLOCO!.URGB_MD5)) expect(await md5Fn(c, sig), sig).toBe(m.antes);
      expect(
        (
          await um<{ n: number }>(
            c,
            `SELECT count(*)::int AS n FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'modelo_servico_mo' AND column_name = 'empresa_id'`,
          )
        ).n,
      ).toBe(1);
      // _down de novo (já ANTES) = no-op
      await aplicarArquivo(c, BLOCO!.down);
      await aplicaUrgb(c, "r4a");
      await aplicarArquivo(c, BLOCO!.mig); // ida de novo com o bloco vivo = no-op
      for (const [sig, m] of Object.entries(BLOCO!.URGB_MD5)) expect(await md5Fn(c, sig), sig).toBe(m.depois);
      // com a volta, o código de antes ignora a coluna (Salvar segue funcionando, sem chave)
      await voltaUrgb(c);
      await comoUsuario(c);
      const m = (
        await um<{ id: string }>(c, "INSERT INTO modelos (tenant_id, nome) VALUES ($1, 'M R4a volta') RETURNING id", [TENANT_TESTE])
      ).id;
      await salvar(c, m, [{ valor: 7, empresa_id: "ignorado-pelo-antes" }]);
      expect((await linhas(c, m))[0].empresa_id).toBeNull();
    });
  });
});
