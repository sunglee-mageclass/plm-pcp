// Reforço de segurança — Release S1 ("Fechar portas sem travar nada"). Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md
// (§2 S1 — testes). As 6 migrations são aplicadas DENTRO da transação de cada teste (mig-txn: sem BEGIN/COMMIT, nunca \i) e tudo
// é revertido no fim: nada é gravado na cópia. SÓ na cópia local (ehBancoLocal) — DDL em transação contra produção trava o app.
// Usuários de teste (comum e admin da loja) nascem DENTRO da txn: QA nunca só com super admin (C13: o super fura os gates).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicaS1, voltaS1, S1_MD5, S1_RPCS, S1_GATILHOS, S1_AUX_RLS } from "./seg-s1-helpers";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const SUPER = USER_TESTE;
const U_COMUM = "5e9a0051-0000-4000-8000-0000000000c1";
const U_ADMIN = "5e9a0051-0000-4000-8000-0000000000a1";

type Res = { ok: true; rows: any[] } | { ok: false; code: string; msg: string };
/** Roda `sql` como o papel `role` (PostgREST real: authenticated/anon) num SAVEPOINT; erro volta ao savepoint. */
async function como(c: Client, role: "authenticated" | "anon" | null, sql: string, params: any[] = []): Promise<Res> {
  await c.query("SAVEPOINT s1x");
  try {
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    const r = await c.query(sql, params);
    if (role) await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT s1x");
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT s1x");
    await c.query("RELEASE SAVEPOINT s1x");
    return { ok: false, code: String(e.code ?? ""), msg: String(e.message ?? "") };
  }
}
const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);
async function jwt(c: Client, uid: string | null): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : ""]);
}
async function usuario(c: Client, uid: string, admin: boolean): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, $4, 'user')
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [uid, T, `${uid}@teste`, `S1 ${admin ? "admin" : "comum"}`],
  );
  if (admin) await c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin') ON CONFLICT DO NOTHING`, [uid]);
}
/** Prepara: S1 aplicada na txn, super admin fixado na Loja Teste, os 2 usuários de teste, chave do kanban DESLIGADA (gate pela etapa gravada). */
async function prepara(c: Client): Promise<void> {
  await aplicaS1(c); // idempotente (S1_TXN=1 já aplicou: a guarda aceita o "depois")
  await jwt(c, null);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, SUPER]);
  await usuario(c, U_COMUM, false);
  await usuario(c, U_ADMIN, true);
  await c.query("SELECT set_config('app.kanban_chave', 'rpc', true)");
  await c.query("UPDATE public.tenant_config SET kanban_automatico = false, explosao_envio_status = NULL WHERE tenant_id = $1", [T]);
  await c.query("SELECT set_config('app.kanban_chave', '', true)");
}
async function md5(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}
async function guc(c: Client, nome: string): Promise<string> {
  return (await um<{ v: string | null }>(c, "SELECT coalesce(current_setting($1, true), '') AS v", [nome])).v ?? "";
}
async function modelo(c: Client, o: { nome: string; ordem?: boolean; status?: string; origem?: string; preco?: number }): Promise<string> {
  return (await um<{ id: string }>(
    c,
    `INSERT INTO public.modelos (tenant_id, nome, ordem_criacao_enviada, status_desenvolvimento, origem, preco_venda)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [T, o.nome, o.ordem ?? false, o.status ?? null, o.origem ?? "interno", o.preco ?? null],
  )).id;
}

describe.skipIf(!RODA)("seg S1 — md5, idempotência e volta (LIFO)", () => {
  it("ida = DEPOIS; reaplicar não muda nada; volta = ANTES (textos e ACL); ida de novo = DEPOIS", async () => {
    await withTx(async (c) => {
      await aplicaS1(c);
      for (const [sig, m] of Object.entries(S1_MD5)) expect(await md5(c, sig), sig).toBe(m.depois);
      await aplicaS1(c); // idempotente
      for (const [sig, m] of Object.entries(S1_MD5)) expect(await md5(c, sig), sig).toBe(m.depois);
      await voltaS1(c);
      for (const [sig, m] of Object.entries(S1_MD5)) expect(await md5(c, sig), sig).toBe(m.antes);
      for (const [sig, acl] of [...S1_RPCS, ...S1_GATILHOS]) {
        const r = await um<{ a: string }>(
          c,
          `SELECT string_agg(CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END, ',' ORDER BY CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END) AS a
             FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
            WHERE p.oid = to_regprocedure($1) AND x.privilege_type = 'EXECUTE'`,
          [sig],
        );
        expect(r.a, sig).toBe(acl);
      }
      const anonDef = await um<{ n: number }>(c,
        `SELECT count(*)::int AS n FROM pg_default_acl d, aclexplode(d.defaclacl) x
          WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND x.grantee = 'anon'::regrole`);
      expect(anonDef.n).toBeGreaterThan(0);
      await aplicaS1(c);
      for (const [sig, m] of Object.entries(S1_MD5)) expect(await md5(c, sig), sig).toBe(m.depois);
    });
  });
});

describe.skipIf(!RODA)("seg S1 — trava: só catálogo", () => {
  // AccessShareLock (o mais fraco: só conflita com AccessExclusive) vem da validação do corpo SQL de tenant_module_enabled
  // (lê users/tenant_config) no CREATE OR REPLACE — mesmo nível de um SELECT. Nada acima disso.
  it("aplicar as 6 não prende tabela fora do pg_catalog acima de AccessShare (nem negócio, nem auth/storage/realtime)", async () => {
    await withTx(async (c) => {
      await aplicaS1(c);
      const { rows } = await c.query(
        `SELECT l.relation::regclass::text AS rel, l.mode, n.nspname
           FROM pg_locks l JOIN pg_class k ON k.oid = l.relation JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname NOT IN ('pg_catalog', 'pg_toast')
            AND l.mode <> 'AccessShareLock'`,
      );
      expect(rows).toEqual([]);
    });
  });
});

describe.skipIf(!RODA)("seg S1 — N1: o próprio usuário não troca papel/e-mail/ativo", () => {
  it("usuário comum: papel_id/email/ativo → 42501 usuario_proprio; nome passa; admin troca o papel de outro pela RPC", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const papel = (await um<{ id: string }>(c, "INSERT INTO public.papeis (tenant_id, nome) VALUES ($1, 'Gerente S1') RETURNING id", [T])).id;
      await jwt(c, U_COMUM);
      const set = (s: string, p: any[] = []) => como(c, "authenticated", `UPDATE public.users SET ${s} WHERE id = $1`, [U_COMUM, ...p]);
      expect(txt(await set("papel_id = $2", [papel]))).toBe("42501 usuario_proprio: nao e permitido alterar o proprio papel, status, e-mail ou id");
      expect(txt(await set("email = 'outro@teste'"))).toMatch(/^42501 usuario_proprio:/);
      expect(txt(await set("ativo = false"))).toMatch(/^42501 usuario_proprio:/);
      expect(txt(await set("nome = 'Novo Nome S1'"))).toBe("PASSOU");
      expect((await um<{ p: string | null }>(c, "SELECT papel_id AS p FROM public.users WHERE id = $1", [U_COMUM])).p).toBeNull();

      await jwt(c, U_ADMIN);
      expect(txt(await como(c, "authenticated", "SELECT public.definir_papel_usuario($1, $2, $3)", [U_COMUM, papel, T]))).toBe("PASSOU");
      expect((await um<{ p: string }>(c, "SELECT papel_id AS p FROM public.users WHERE id = $1", [U_COMUM])).p).toBe(papel);
      // admin da loja pode mexer na PRÓPRIA linha (como antes no role)
      expect(txt(await como(c, "authenticated", "UPDATE public.users SET papel_id = $2 WHERE id = $1", [U_ADMIN, papel]))).toBe("PASSOU");
    });
  });
});

describe.skipIf(!RODA)("seg S1 — MOD-1: só o super admin muda os módulos", () => {
  it("admin da loja: modules volta ao de antes (o resto da linha grava); super muda; sem JWT (migration) muda", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const mod = async () => (await um<{ m: any }>(c, "SELECT modules AS m FROM public.tenant_config WHERE tenant_id = $1", [T])).m;
      const antes = await mod();
      await jwt(c, U_ADMIN);
      const r = await como(c, "authenticated",
        `UPDATE public.tenant_config SET modules = modules || '{"otb": false, "financeiro": false}'::jsonb, keywords = 'kw-s1' WHERE tenant_id = $1`, [T]);
      expect(txt(r)).toBe("PASSOU"); // gatilho fn_kanban_chave_protegida (EXECUTE revogado — ANON-2) continua disparando
      expect(await mod()).toEqual(antes);
      expect((await um<{ k: string }>(c, "SELECT keywords AS k FROM public.tenant_config WHERE tenant_id = $1", [T])).k).toBe("kw-s1");

      await jwt(c, SUPER);
      expect(txt(await como(c, "authenticated",
        `UPDATE public.tenant_config SET modules = modules || '{"otb": false}'::jsonb WHERE tenant_id = $1`, [T]))).toBe("PASSOU");
      expect((await mod()).otb).toBe(false);

      await jwt(c, null);
      await c.query(`UPDATE public.tenant_config SET modules = modules || '{"otb": true}'::jsonb WHERE tenant_id = $1`, [T]);
      expect((await mod()).otb).toBe(true);
    });
  });
});

describe.skipIf(!RODA)("seg S1 — M2/S5/B1b: guarda de modelos", () => {
  it("enviado_cad por PATCH → 42501; Enviar à Explosão pela RPC ok (GUC restaurada); ordem não cancela com Explosão; Voltar e excluir CAD ok", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await modelo(c, { nome: "S1 M2 EXPLOSAO", ordem: true, status: "aprovado" });
      await jwt(c, SUPER); // até o super admin: a regra é pela GUC, não por permissão
      const patch = (s: string) => como(c, "authenticated", `UPDATE public.modelos SET ${s} WHERE id = $1`, [m]);
      expect(txt(await patch("enviado_cad = true"))).toMatch(/^42501 explosao_protegida:/);
      expect(txt(await como(c, "authenticated", "SELECT public.enviar_modelo_para_cad($1, NULL, NULL) AS cad", [m]))).toBe("PASSOU");
      expect((await um<{ e: boolean }>(c, "SELECT enviado_cad AS e FROM public.modelos WHERE id = $1", [m])).e).toBe(true);
      expect(await guc(c, "app.explosao_sistema")).toBe(""); // liga e RESTAURA
      expect(txt(await patch("ordem_criacao_enviada = false"))).toMatch(/^P0001 ordem_com_explosao:/);
      expect(txt(await patch("enviado_cad = false"))).toMatch(/^42501 explosao_protegida:/);
      // mesmo valor (save do card com o row inteiro) passa
      expect(txt(await patch("enviado_cad = true, nome = 'S1 M2 EXPLOSAO 2'"))).toBe("PASSOU");
      expect(txt(await como(c, "authenticated", "SELECT public.voltar_modelo_desenvolvimento($1)", [m]))).toBe("PASSOU");
      expect((await um<{ e: boolean }>(c, "SELECT enviado_cad AS e FROM public.modelos WHERE id = $1", [m])).e).toBe(false);
      // Voltar rebaixa a etapa (regredir do kanban) — devolve a 'aprovado' para reenviar
      await c.query("UPDATE public.modelos SET status_desenvolvimento = 'aprovado' WHERE id = $1", [m]);
      expect(txt(await como(c, "authenticated", "SELECT public.enviar_modelo_para_cad($1, NULL, NULL)", [m]))).toBe("PASSOU");
      const cad = (await um<{ id: string }>(c, "SELECT id FROM public.cad WHERE modelo_id = $1", [m])).id;
      expect(txt(await como(c, "authenticated", "SELECT public.excluir_cad($1)", [cad]))).toBe("PASSOU");
      expect((await um<{ e: boolean }>(c, "SELECT enviado_cad AS e FROM public.modelos WHERE id = $1", [m])).e).toBe(false);
      expect(await guc(c, "app.explosao_sistema")).toBe("");
      // sem Explosão, cancelar a Ordem segue livre
      expect(txt(await patch("ordem_criacao_enviada = false"))).toBe("PASSOU");
    });
  });

  it("CAD sem Ordem de Criação → P0001 cad_sem_ordem; com a Ordem → cria; CAD já existente segue gravando", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await modelo(c, { nome: "S1 CAD SEM ORDEM" });
      await jwt(c, SUPER);
      const salva = () => como(c, "authenticated",
        "SELECT public.salvar_cad_completo($1, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, NULL, NULL) AS id", [m]);
      expect(txt(await salva())).toBe("P0001 cad_sem_ordem: envie a Ordem de Criacao antes de gravar o CAD");
      expect((await um<{ n: number }>(c, "SELECT count(*)::int AS n FROM public.cad WHERE modelo_id = $1", [m])).n).toBe(0);
      expect(txt(await como(c, "authenticated", "UPDATE public.modelos SET ordem_criacao_enviada = true WHERE id = $1", [m]))).toBe("PASSOU");
      expect(txt(await salva())).toBe("PASSOU");
      expect(txt(await salva())).toBe("PASSOU");
      expect((await um<{ n: number }>(c, "SELECT count(*)::int AS n FROM public.cad WHERE modelo_id = $1", [m])).n).toBe(1);
    });
  });

  it("S5: Preço anterior sem a seção de preço → 42501; super passa; congelar ao excluir (gatilho) passa sem a seção", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const v1 = await modelo(c, { nome: "S1 VESTIDO V1", preco: 500 });
      const v2 = await modelo(c, { nome: "S1 VESTIDO V2" });
      await c.query("UPDATE public.modelos SET versao = 2, modelo_base_id = $2, preco_anterior = NULL WHERE id = $1", [v2, v1]);
      const x = await modelo(c, { nome: "S1 PRECO ANTERIOR" });
      await jwt(c, U_COMUM);
      expect(txt(await como(c, "authenticated", "UPDATE public.modelos SET preco_anterior = 10 WHERE id = $1", [x])))
        .toBe("42501 preco_anterior_sem_permissao: sem permissao para editar o preco anterior");
      expect(txt(await como(c, "authenticated", "UPDATE public.modelos SET nome = 'S1 OUTRO CAMPO' WHERE id = $1", [x]))).toBe("PASSOU");
      // congelar ao excluir: quem exclui NÃO tem a seção de preço; o congelamento (de dentro do gatilho) grava mesmo assim
      expect(txt(await como(c, "authenticated", "DELETE FROM public.modelos WHERE id = $1", [v1]))).toBe("PASSOU");
      expect(txt(await como(c, null, "SET CONSTRAINTS ALL IMMEDIATE"))).toBe("PASSOU");
      expect(Number((await um<{ p: string }>(c, "SELECT preco_anterior AS p FROM public.modelos WHERE id = $1", [v2])).p)).toBe(500);
      await jwt(c, SUPER);
      expect(txt(await como(c, "authenticated", "UPDATE public.modelos SET preco_anterior = 10 WHERE id = $1", [x]))).toBe("PASSOU");
    });
  });

  it("B1b: preço de venda do comprado por PATCH → 42501; pelo preço fixo do produto (recálculo) → grava", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const r = await modelo(c, { nome: "S1 REVENDA", origem: "revenda" });
      const p = (await um<{ id: string }>(c,
        "INSERT INTO public.produtos_acabados (tenant_id, nome, modelo_id) VALUES ($1, 'S1 REVENDA', $2) RETURNING id", [T, r])).id;
      await jwt(c, SUPER);
      expect(txt(await como(c, "authenticated", "UPDATE public.modelos SET preco_venda = 1 WHERE id = $1", [r])))
        .toMatch(/^42501 preco_comprado_derivado:/);
      expect(txt(await como(c, "authenticated", "SELECT public.salvar_precos_fixo_produto_acabado($1, false, NULL, true, 321.5)", [p])))
        .toBe("PASSOU");
      expect(Number((await um<{ v: string }>(c, "SELECT preco_venda AS v FROM public.modelos WHERE id = $1", [r])).v)).toBe(321.5);
      expect(await guc(c, "app.preco_comprado_sistema")).toBe("");
      // interno segue a regra de antes (seção de preço): super passa, comum não
      const i = await modelo(c, { nome: "S1 INTERNO" });
      expect(txt(await como(c, "authenticated", "UPDATE public.modelos SET preco_venda = 99 WHERE id = $1", [i]))).toBe("PASSOU");
      await jwt(c, U_COMUM);
      expect(txt(await como(c, "authenticated", "UPDATE public.modelos SET preco_venda = 98 WHERE id = $1", [i]))).toMatch(/^42501 /);
      // PI-r: a foto do produto continua indo para o card da MESMA loja
      await jwt(c, SUPER);
      await c.query("UPDATE public.produtos_acabados SET foto_url = $2 WHERE id = $1", [p, `${T}/s1/foto.jpg`]);
      const fotos = (await um<{ f: string[] }>(c, "SELECT fotos_modelo AS f FROM public.modelos WHERE id = $1", [r])).f;
      expect(fotos?.[0]).toBe(`${T}/s1/foto.jpg`);
    });
  });
});

describe.skipIf(!RODA)("seg S1 — C5 e DIR-1", () => {
  it("C5: desconto/multa da oficina exige editar o CQ e o módulo Produção", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await modelo(c, { nome: "S1 C5", ordem: true, status: "aprovado" });
      await jwt(c, SUPER);
      expect(txt(await como(c, "authenticated", "SELECT public.enviar_modelo_para_cad($1, NULL, NULL)", [m]))).toBe("PASSOU");
      const cad = (await um<{ id: string }>(c, "SELECT id FROM public.cad WHERE modelo_id = $1", [m])).id;
      const chama = () => como(c, "authenticated", "SELECT public.cq_set_oficina_desconto_multa($1, 1, 0)", [cad]);
      expect(txt(await chama())).toBe("PASSOU");
      await jwt(c, U_COMUM);
      expect(txt(await chama())).toBe("42501 sem_permissao_cq: sem permissao para editar o Controle de Qualidade");
      await jwt(c, null);
      await c.query(`UPDATE public.tenant_config SET modules = modules || '{"producao": false}'::jsonb WHERE tenant_id = $1`, [T]);
      await jwt(c, U_ADMIN);
      expect(txt(await chama())).toMatch(/^42501 modulo_producao_desligado:/);
    });
  });

  it("DIR-1: anon não executa; sem login → 42501; CAD de outra loja/inexistente → P0001 (antes do _cq_liberado)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fake = "00000000-0000-4000-8000-00000000d1d1";
      await jwt(c, null);
      expect(txt(await como(c, "anon", "SELECT public.confirmar_direcionamento($1, '[]'::jsonb, '{}'::jsonb)", [fake])))
        .toMatch(/^42501 permission denied for function confirmar_direcionamento/);
      expect(txt(await como(c, null, "SELECT public.confirmar_direcionamento($1, '[]'::jsonb, '{}'::jsonb)", [fake])))
        .toBe("42501 nao_autenticado: faca login de novo");
      await jwt(c, U_COMUM);
      expect(txt(await como(c, "authenticated", "SELECT public.confirmar_direcionamento($1, '[]'::jsonb, '{}'::jsonb)", [fake])))
        .toBe("P0001 cad_nao_encontrado: CAD nao encontrado nesta loja");
      const outra = await um<{ id: string } | undefined>(c, "SELECT id FROM public.cad WHERE tenant_id <> $1 LIMIT 1", [T]);
      if (outra?.id) {
        expect(txt(await como(c, "authenticated", "SELECT public.confirmar_direcionamento($1, '[]'::jsonb, '{}'::jsonb)", [outra.id])))
          .toBe("P0001 cad_nao_encontrado: CAD nao encontrado nesta loja");
      }
    });
  });
});

describe.skipIf(!RODA)("seg S1 — DIR-1 fix round 1: sobrecarga antiga confirmar_direcionamento(uuid,jsonb)", () => {
  it("usuário de OUTRA loja com o UUID de um CAD → P0001 cad_nao_encontrado (mesma resposta do inexistente, sem oráculo do CQ); sem login → 42501; authenticated segue com EXECUTE", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await modelo(c, { nome: "S1 DIR1 2ARGS", ordem: true, status: "aprovado" });
      await jwt(c, SUPER);
      expect(txt(await como(c, "authenticated", "SELECT public.enviar_modelo_para_cad($1, NULL, NULL)", [m]))).toBe("PASSOU");
      const cad = (await um<{ id: string }>(c, "SELECT id FROM public.cad WHERE modelo_id = $1", [m])).id;
      const fake = "00000000-0000-4000-8000-00000000d1d2";
      const q = "SELECT public.confirmar_direcionamento($1, '[]'::jsonb)";
      // usuário comum de OUTRA loja (criado na txn)
      const outraLoja = (await um<{ id: string }>(c, "SELECT id FROM public.tenants WHERE id <> $1 ORDER BY id LIMIT 1", [T])).id;
      const uOutra = "5e9a0051-0000-4000-8000-0000000000d2";
      await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uOutra, `${uOutra}@teste`]);
      await c.query(`INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'S1 outra loja', 'user')
                     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`, [uOutra, outraLoja, `${uOutra}@teste`]);
      await jwt(c, uOutra);
      const real = txt(await como(c, "authenticated", q, [cad]));
      const inexistente = txt(await como(c, "authenticated", q, [fake]));
      expect(real).toBe("P0001 cad_nao_encontrado: CAD nao encontrado nesta loja");
      expect(inexistente).toBe(real); // sem oráculo: CAD real de outra loja ≡ UUID inexistente
      await jwt(c, null);
      expect(txt(await como(c, null, q, [cad]))).toBe("42501 nao_autenticado: faca login de novo");
      expect(txt(await como(c, "anon", q, [cad]))).toMatch(/^42501 permission denied for function confirmar_direcionamento/);
      expect((await um<{ p: boolean }>(c,
        "SELECT has_function_privilege('authenticated', 'public.confirmar_direcionamento(uuid,jsonb)', 'EXECUTE') AS p")).p).toBe(true);
      // mesma loja: passa das 2 checagens e chega ao _cq_liberado (CQ não liberado = recusa de antes, inalterada)
      await jwt(c, SUPER);
      expect(txt(await como(c, "authenticated", q, [cad]))).toMatch(/^42501 O Controle de Qualidade deste modelo/);
    });
  });
});

describe.skipIf(!RODA)("seg S1 — ANON-1/ANON-2/PRIV-2/OPT-1", () => {
  it("has_function_privilege: anon=false nas 52 e nos gatilhos; authenticated=true nas 52 e false nos gatilhos; 4 auxiliares de RLS intocados", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const priv = async (role: string, sig: string) =>
        (await um<{ p: boolean }>(c, "SELECT has_function_privilege($1, to_regprocedure($2), 'EXECUTE') AS p", [role, sig])).p;
      expect(S1_RPCS.length).toBe(52);
      for (const [sig] of S1_RPCS) {
        expect(await priv("anon", sig), `anon ${sig}`).toBe(false);
        expect(await priv("authenticated", sig), `authenticated ${sig}`).toBe(true);
        expect(await priv("service_role", sig), `service_role ${sig}`).toBe(true);
      }
      for (const [sig] of S1_GATILHOS) {
        expect(await priv("anon", sig), `anon ${sig}`).toBe(false);
        expect(await priv("authenticated", sig), `authenticated ${sig}`).toBe(false);
      }
      for (const sig of S1_AUX_RLS) expect(await priv("anon", sig), sig).toBe(true);
      // anti-drift: nenhuma OUTRA função DEFINER do public executável pelo anon além dos 4 auxiliares (S5)
      const resto = await c.query(
        `SELECT p.oid::regprocedure::text AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.prosecdef AND p.prokind = 'f' AND has_function_privilege('anon', p.oid, 'EXECUTE')
            AND p.oid <> ALL ($1::regprocedure[])`,
        [S1_AUX_RLS as unknown as string[]],
      );
      expect(resto.rows.map((r) => r.f)).toEqual([]);
    });
  });

  it("PRIV-2: objeto NOVO do postgres nasce sem anon e sem PUBLIC; authenticated sem TRUNCATE/REFERENCES/TRIGGER; a volta reabre", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const anonDef = await um<{ n: number }>(c,
        `SELECT count(*)::int AS n FROM pg_default_acl d, aclexplode(d.defaclacl) x
          WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND x.grantee = 'anon'::regrole`);
      expect(anonDef.n).toBe(0);
      await c.query("CREATE FUNCTION public._s1_teste_fn() RETURNS int LANGUAGE sql AS 'SELECT 1'");
      await c.query("CREATE TABLE public._s1_teste_tab (id int)");
      await c.query("CREATE SEQUENCE public._s1_teste_seq");
      const f = await um<{ a: boolean; u: boolean; s: boolean; p: boolean }>(c,
        `SELECT has_function_privilege('anon', 'public._s1_teste_fn()', 'EXECUTE') a,
                has_function_privilege('authenticated', 'public._s1_teste_fn()', 'EXECUTE') u,
                has_function_privilege('service_role', 'public._s1_teste_fn()', 'EXECUTE') s,
                EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                         WHERE p.oid = 'public._s1_teste_fn()'::regprocedure AND x.grantee = 0) p`);
      expect(f).toEqual({ a: false, u: true, s: true, p: false });
      const t = await um<any>(c,
        `SELECT has_table_privilege('anon', 'public._s1_teste_tab', 'SELECT') a_sel,
                has_table_privilege('authenticated', 'public._s1_teste_tab', 'SELECT') u_sel,
                has_table_privilege('authenticated', 'public._s1_teste_tab', 'TRUNCATE') u_tru,
                has_table_privilege('authenticated', 'public._s1_teste_tab', 'REFERENCES') u_ref,
                has_table_privilege('authenticated', 'public._s1_teste_tab', 'TRIGGER') u_trg,
                has_sequence_privilege('anon', 'public._s1_teste_seq', 'USAGE') a_seq`);
      expect(t).toEqual({ a_sel: false, u_sel: true, u_tru: false, u_ref: false, u_trg: false, a_seq: false });
      await voltaS1(c);
      await c.query("CREATE FUNCTION public._s1_teste_fn2() RETURNS int LANGUAGE sql AS 'SELECT 2'");
      expect((await um<{ a: boolean }>(c, "SELECT has_function_privilege('anon', 'public._s1_teste_fn2()', 'EXECUTE') a")).a).toBe(true);
    });
  });

  it("OPT-1: etapas_pl ausente = desligado no servidor (como o front); ligado = ligado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await c.query(`UPDATE public.tenant_config SET modules = modules - 'etapas_pl' WHERE tenant_id = $1`, [T]);
      await jwt(c, U_COMUM);
      expect((await um<{ e: boolean }>(c, "SELECT public.tenant_module_enabled('etapas_pl') AS e")).e).toBe(false);
      expect((await um<{ e: boolean }>(c, "SELECT public.tenant_module_enabled('criacao') AS e")).e).toBe(true);
      await jwt(c, null);
      await c.query(`UPDATE public.tenant_config SET modules = modules || '{"etapas_pl": true}'::jsonb WHERE tenant_id = $1`, [T]);
      await jwt(c, U_COMUM);
      expect((await um<{ e: boolean }>(c, "SELECT public.tenant_module_enabled('etapas_pl') AS e")).e).toBe(true);
    });
  });
});
