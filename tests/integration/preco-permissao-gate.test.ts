// Preço de atacado: EDITAR trancado no banco (ramo novo em fn_modelo_preco_venda_gate). VER NÃO é trancado (D1 A).
// Recompute derivado do comprado (GUC app.preco_comprado_sistema='on') passa; PATCH direto do cliente sem a chave = 42501.
// UMA chave por preço (Leitor=pode_ver, Editor=pode_editar). Backfill concede pode_ver a quem hoje vê preço (a linha de EDITAR existente GANHA o ver sem perder o editar). SÓ na cópia local (ehBancoLocal) — DDL em txn.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const MIG = "supabase/migrations/20261211100000_preco_permissao_atacado_gate_backfill.sql";
const DOWN = "supabase/rollback/20261211100000_preco_permissao_atacado_gate_backfill_down.sql";
const DOWN_RPCS = "supabase/rollback/20261211110000_preco_atacado_portao_rpcs_comprado_down.sql"; // o _down da migration 1 recusa se as RPCs ainda usam o helper: este vem antes
const T = TENANT_TESTE;
// md5 da função: "depois" da S1 (20261031120000) e "depois" desta frente. Quem reaplicar a S1 por cima desta frente precisa do _down antes.
const MD5_S1_DEPOIS = "e89be53c25f421724994e78b756a027d";
const MD5_ESTA_FRENTE = "6fc5d4955a3f3d378072e82bfcf9051d";

/** Roda `sql` como o PAPEL authenticated (PostgREST) numa savepoint; devolve "PASSOU" ou "<code> <message>". */
async function tenta(c: Client, sql: string, params: unknown[] = []): Promise<string> {
  await c.query("SAVEPOINT pp_t");
  await c.query("SET LOCAL ROLE authenticated");
  try {
    await c.query(sql, params);
    return "PASSOU";
  } catch (e) {
    const er = e as { code?: string; message?: string };
    return `${er.code} ${er.message}`;
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT pp_t");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT pp_t");
  }
}

// USER_TESTE é SUPER ADMIN (fura user_can_edit): o gate só morde usuário COMUM. Cria um (role user, Loja Teste) com as páginas dadas
// (ver+editar) e o põe como identidade ativa. A preparação roda SEM JWT (como postgres). Txn revertida.
const U_COMUM = "0b0b0b0b-0000-4000-8000-00000000a7a1";
async function usuarioComum(c: Client, paginas: string[], papel?: "tenant_admin" | "super_admin"): Promise<void> {
  await semJwt(c, async () => {
    await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [U_COMUM, `${U_COMUM}@teste`]);
    await c.query(
      `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'PP comum', 'user')
       ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
      [U_COMUM, T, `${U_COMUM}@teste`],
    );
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [U_COMUM]);
    await c.query(`DELETE FROM public.user_roles WHERE user_id = $1 AND role IN ('tenant_admin','super_admin')`, [U_COMUM]);
    if (papel) await c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, $2::app_role) ON CONFLICT DO NOTHING`, [U_COMUM, papel]);
    await c.query(
      `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
       SELECT $1, $2, p, true, true FROM unnest($3::text[]) p`,
      [U_COMUM, T, paginas],
    );
  });
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U_COMUM, role: "authenticated" })]);
}

// Cria um card comprado (revenda) da Loja Teste para o teste de PATCH de preco_atacado.
async function cardRevenda(c: Client): Promise<string> {
  const r = await um<{ id: string }>(
    c,
    `INSERT INTO public.modelos (tenant_id, nome, origem, preco_atacado)
       VALUES ($1, 'PP Atacado', 'revenda', 10) RETURNING id`,
    [T],
  );
  return r.id;
}

// Card INTERNO (varejo editável pelo cliente) para o ramo de preco_venda / preco_anterior.
async function cardInterno(c: Client): Promise<string> {
  const r = await um<{ id: string }>(
    c,
    `INSERT INTO public.modelos (tenant_id, nome, origem, preco_venda, preco_anterior)
       VALUES ($1, 'PP Varejo', 'interno', 10, 12) RETURNING id`,
    [T],
  );
  return r.id;
}

describe.skipIf(!RODA)("preço de venda/atacado — admin NÃO fura (só super admin) no EDITAR do banco", () => {
  const ATQ = `UPDATE public.modelos SET preco_atacado = 99 WHERE id = $1`;
  const VAR = `UPDATE public.modelos SET preco_venda = 99 WHERE id = $1`;
  const ANT = `UPDATE public.modelos SET preco_anterior = 99 WHERE id = $1`;

  it("tenant_admin SEM a permissão de preço: user_can_edit genérico segue furando, mas o gate recusa varejo, atacado e preco_anterior (42501)", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      const rev = await cardRevenda(c);
      const itn = await cardInterno(c);
      await usuarioComum(c, [], "tenant_admin");
      // o furo genérico de admin NÃO mudou (user_can_edit): só o preço deixou de furar
      expect((await um<{ v: boolean; p: boolean }>(c,
        `SELECT public.user_can_edit('criacao_planejamento') v, public._pode_editar_preco('criacao_planejamento:preco_venda') p`)).v).toBe(true);
      expect((await um<{ p: boolean; q: boolean }>(c,
        `SELECT public._pode_editar_preco('criacao_planejamento:preco_venda') p, public._pode_editar_preco('criacao_planejamento:preco_atacado') q`))).toEqual({ p: false, q: false });
      const a = await tenta(c, ATQ, [rev]);
      expect(a.startsWith("42501")).toBe(true);
      expect(a).toMatch(/preco de atacado/);
      const v = await tenta(c, VAR, [itn]);
      expect(v.startsWith("42501")).toBe(true);
      expect(v).toMatch(/preço de venda/);
      expect((await tenta(c, ANT, [itn])).startsWith("42501")).toBe(true);
    });
  });

  it("tenant_admin SEM a permissão: o recompute derivado (GUC) do comprado continua passando", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      const rev = await cardRevenda(c);
      await usuarioComum(c, [], "tenant_admin");
      await c.query("SELECT set_config('app.preco_comprado_sistema','on',true)");
      expect(await tenta(c, ATQ, [rev])).toBe("PASSOU");
    });
  });

  it("tenant_admin COM a permissão de preço (Editor): passa; só Leitor (pode_editar=false) continua recusado", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      const rev = await cardRevenda(c);
      const itn = await cardInterno(c);
      await usuarioComum(c, ["criacao_planejamento:preco_venda", "criacao_planejamento:preco_atacado"], "tenant_admin");
      expect(await tenta(c, ATQ, [rev])).toBe("PASSOU");
      expect(await tenta(c, VAR, [itn])).toBe("PASSOU");
      expect(await tenta(c, ANT, [itn])).toBe("PASSOU");
      // Leitor: ve, nao edita
      await semJwt(c, () => c.query(`UPDATE public.user_permissions SET pode_editar = false WHERE user_id = $1`, [U_COMUM]));
      expect((await tenta(c, ATQ, [rev])).startsWith("42501")).toBe(true);
      expect((await tenta(c, VAR, [itn])).startsWith("42501")).toBe(true);
    });
  });

  it("super_admin passa SEMPRE (fura), sem nenhuma linha de permissão", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      const rev = await cardRevenda(c);
      const itn = await cardInterno(c);
      await usuarioComum(c, [], "super_admin");
      expect(await tenta(c, ATQ, [rev])).toBe("PASSOU");
      expect(await tenta(c, VAR, [itn])).toBe("PASSOU");
      expect(await tenta(c, ANT, [itn])).toBe("PASSOU");
    });
  });

  it("usuário comum: com a permissão passa; sem recusa; a chave de um preço não libera o outro", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      const rev = await cardRevenda(c);
      const itn = await cardInterno(c);
      await usuarioComum(c, ["criacao_planejamento", "criacao_planejamento:preco_venda"]);
      expect(await tenta(c, VAR, [itn])).toBe("PASSOU");
      expect(await tenta(c, ANT, [itn])).toBe("PASSOU"); // preco_anterior colado ao varejo
      expect((await tenta(c, ATQ, [rev])).startsWith("42501")).toBe(true);
      await usuarioComum(c, ["criacao_planejamento"]);
      expect((await tenta(c, VAR, [itn])).startsWith("42501")).toBe(true);
    });
  });

  it("helper _pode_editar_preco: EXECUTE revogado de PUBLIC/anon/authenticated; SECURITY DEFINER STABLE", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      const r = await um<{ a: boolean; b: boolean; d: boolean; s: string; sec: boolean }>(c,
        `SELECT has_function_privilege('anon','public._pode_editar_preco(text)','EXECUTE') a,
                has_function_privilege('authenticated','public._pode_editar_preco(text)','EXECUTE') b,
                has_function_privilege('public','public._pode_editar_preco(text)','EXECUTE') d,
                provolatile::text s, prosecdef sec
           FROM pg_proc WHERE oid = 'public._pode_editar_preco(text)'::regprocedure`);
      expect(r).toEqual({ a: false, b: false, d: false, s: "s", sec: true });
    });
  });
});

// ───────────── Peça A/B (ajuste 3): backfill dos admins + delegação condicional do preço ─────────────
const U_ALVO = "0b0b0b0b-0000-4000-8000-00000000a7a3";
async function alvo(c: Client, paginas: string[] = []): Promise<void> {
  await semJwt(c, async () => {
    await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [U_ALVO, `${U_ALVO}@teste`]);
    await c.query(
      `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'PP alvo', 'user')
       ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id, papel_id = null`,
      [U_ALVO, T, `${U_ALVO}@teste`],
    );
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [U_ALVO]);
    if (paginas.length) await c.query(
      `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) SELECT $1, $2, p, true, true FROM unnest($3::text[]) p`,
      [U_ALVO, T, paginas]);
  });
}
const PV = "criacao_planejamento:preco_venda";
const PA = "criacao_planejamento:preco_atacado";
const linhas = (...pg: string[]) => JSON.stringify(pg.map((pagina) => ({ pagina, pode_ver: true, pode_editar: true })));
const SET_PERMS = `SELECT public.set_user_permissions($1::uuid, $2::uuid, $3::jsonb)`;
const linhaDe = async (c: Client, u: string, pag: string) =>
  (await c.query<{ pode_ver: boolean; pode_editar: boolean }>(`SELECT pode_ver, pode_editar FROM public.user_permissions WHERE user_id=$1 AND pagina=$2`, [u, pag])).rows;

describe.skipIf(!RODA)("backfill dos admins (Peça A)", () => {
  it("tenant_admin sem linha ganha (ver,editar)=(true,true) nas 2 chaves; linha parcial vira (true,true); super admin puro NÃO ganha; _down não apaga", async () => {
    await withTx(async (c) => {
      await usuarioComum(c, [], "tenant_admin"); // sem nenhuma linha de permissão
      const SUPER = "0b0b0b0b-0000-4000-8000-00000000a7a4";
      await semJwt(c, async () => {
        await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [SUPER, `${SUPER}@teste`]);
        await c.query(`INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'PP super', 'user') ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`, [SUPER, T, `${SUPER}@teste`]);
        await c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'super_admin') ON CONFLICT DO NOTHING`, [SUPER]);
        await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [SUPER]);
        // admin B com linha parcial (só ver de preco_venda)
        await c.query(`INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1,$2,$3,true,false) ON CONFLICT (user_id,pagina) DO UPDATE SET pode_ver=true, pode_editar=false`, [U_COMUM, T, PV]);
      });
      await aplicarArquivo(c, MIG);
      expect(await linhaDe(c, U_COMUM, PV)).toEqual([{ pode_ver: true, pode_editar: true }]);
      expect(await linhaDe(c, U_COMUM, PA)).toEqual([{ pode_ver: true, pode_editar: true }]);
      expect(await linhaDe(c, SUPER, PV)).toEqual([]);
      expect(await linhaDe(c, SUPER, PA)).toEqual([]);
      // e ele passa a ser Editor pelo helper (sem furo): pode editar o preco
      await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U_COMUM, role: "authenticated" })]);
      expect((await um<{ p: boolean }>(c, `SELECT public._pode_editar_preco('${PV}') p`)).p).toBe(true);
      await aplicarArquivo(c, DOWN_RPCS);
      await aplicarArquivo(c, DOWN);
      expect(await linhaDe(c, U_COMUM, PV)).toEqual([{ pode_ver: true, pode_editar: true }]); // o down nao reverte o backfill
    });
  });
});

describe.skipIf(!RODA)("delegação condicional do preço (Peça B): não dá o que não tem", () => {
  it("tenant_admin COM preço (backfill) concede venda+atacado a usuário comum", async () => {
    await withTx(async (c) => {
      await usuarioComum(c, [], "tenant_admin");
      await aplicarArquivo(c, MIG); // backfill dá o preço ao admin
      await alvo(c);
      await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U_COMUM, role: "authenticated" })]);
      expect(await tenta(c, SET_PERMS, [U_ALVO, T, linhas("criacao_planejamento", PV, PA)])).toBe("PASSOU");
    });
  });

  it("tenant_admin SEM preço é recusado (42501 preco_sem_delegacao) ao conceder ver OU editar de preço; conceder outra tela passa", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      await usuarioComum(c, ["criacao_planejamento"], "tenant_admin"); // criado DEPOIS do backfill: sem linha de preço
      await alvo(c);
      for (const j of [linhas(PV), linhas(PA), linhas("criacao_planejamento", PV)]) {
        const r = await tenta(c, SET_PERMS, [U_ALVO, T, j]);
        expect(r.startsWith("42501")).toBe(true);
        expect(r).toMatch(/preco_sem_delegacao: criacao_planejamento:preco_/);
      }
      // só Leitor (ver sem editar) tambem e recusado: nao tem nem o ver
      expect((await tenta(c, SET_PERMS, [U_ALVO, T, JSON.stringify([{ pagina: PV, pode_ver: true, pode_editar: false }])])).startsWith("42501")).toBe(true);
      // outra tela, sem mexer em preço: passa
      expect(await tenta(c, SET_PERMS, [U_ALVO, T, linhas("criacao_planejamento")])).toBe("PASSOU");
    });
  });

  it("alvo que JÁ tem preço (dado pelo super): admin sem preço edita OUTRA tela mantendo a linha inalterada (passa), mas não consegue retirá-la nem somar a outra", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      await usuarioComum(c, ["criacao_planejamento"], "tenant_admin");
      await alvo(c, [PA]);
      expect(await tenta(c, SET_PERMS, [U_ALVO, T, linhas("criacao_planejamento", PA)])).toBe("PASSOU"); // reenvia PA como esta
      expect((await tenta(c, SET_PERMS, [U_ALVO, T, linhas("criacao_planejamento")])).startsWith("42501")).toBe(true); // retirar PA
      expect((await tenta(c, SET_PERMS, [U_ALVO, T, linhas(PA, PV)])).startsWith("42501")).toBe(true); // somar PV
    });
  });

  it("admin só com Leitor (ver) de venda: concede ver, mas não editar", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      await usuarioComum(c, [PV], "tenant_admin");
      await semJwt(c, () => c.query(`UPDATE public.user_permissions SET pode_editar = false WHERE user_id = $1 AND pagina = $2`, [U_COMUM, PV]));
      await alvo(c);
      const soVer = JSON.stringify([{ pagina: PV, pode_ver: true, pode_editar: false }]);
      expect(await tenta(c, SET_PERMS, [U_ALVO, T, soVer])).toBe("PASSOU");
      expect((await tenta(c, SET_PERMS, [U_ALVO, T, linhas(PV)])).startsWith("42501")).toBe(true);
    });
  });

  it("super admin concede a qualquer um, sempre (sem linha de preço)", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      await usuarioComum(c, [], "super_admin");
      await semJwt(c, () => c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [U_COMUM]));
      await alvo(c);
      expect(await tenta(c, SET_PERMS, [U_ALVO, T, linhas(PV, PA)])).toBe("PASSOU");
    });
  });

  it("salvar_papel: admin com preço concede; sem preço é recusado; super passa", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      const SALVAR = `SELECT public.salvar_papel(NULL::uuid, $1::uuid, 'PP papel deleg', NULL, $2::jsonb)`;
      await usuarioComum(c, [PV], "tenant_admin"); // tem so preco_venda (Editor)
      expect(await tenta(c, SALVAR, [T, linhas(PV)])).toBe("PASSOU");
      const r = await tenta(c, SALVAR, [T, linhas(PV, PA)]);
      expect(r.startsWith("42501")).toBe(true);
      expect(r).toMatch(/preco_sem_delegacao: criacao_planejamento:preco_atacado/);
      await usuarioComum(c, [], "super_admin");
      expect(await tenta(c, SALVAR, [T, linhas(PV, PA)])).toBe("PASSOU");
    });
  });

  it("md5 de set_user_permissions/salvar_papel: ida = depois, down = antes; o corpo só ganha a chamada de _exige_delegacao_preco; helpers com EXECUTE revogado", async () => {
    await withTx(async (c) => {
      const md5De = async (f: string) => (await um<{ m: string }>(c, `SELECT md5(pg_get_functiondef('${f}'::regprocedure)) m`)).m;
      const SU = "public.set_user_permissions(uuid,uuid,jsonb)", SP = "public.salvar_papel(uuid,uuid,text,text,jsonb)";
      await aplicarArquivo(c, MIG);
      expect(await md5De(SU)).toBe("bbe576b4b2d91858095ba12ed49a4913");
      expect(await md5De(SP)).toBe("ede0d4ad42c0f8f772207aae18e4b670");
      for (const h of ["_pode_ver_preco(text)", "_pode_editar_preco(text)", "_exige_delegacao_preco(jsonb,jsonb)"]) {
        const r = await um<{ a: boolean; b: boolean }>(c, `SELECT has_function_privilege('anon','public.${h}','EXECUTE') a, has_function_privilege('authenticated','public.${h}','EXECUTE') b`);
        expect(r).toEqual({ a: false, b: false });
      }
      await aplicarArquivo(c, DOWN_RPCS);
      await aplicarArquivo(c, DOWN);
      expect(await md5De(SU)).toBe("efd749935e402b939ad6304d15035933");
      expect(await md5De(SP)).toBe("73310c9e097cf92eae827d19bf7b63a0");
      expect((await um<{ n: number }>(c, `SELECT count(*)::int n FROM pg_proc WHERE proname IN ('_pode_ver_preco','_pode_editar_preco','_exige_delegacao_preco')`)).n).toBe(0);
    });
  });
});

describe.skipIf(!RODA)("preço de atacado — gate de escrita", () => {
  it("PATCH direto de preco_atacado sem a chave → 42501; o recompute derivado (GUC) passa", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      const modelo = await cardRevenda(c);
      // Usuário COMUM que edita o Planejamento (passa o portão de página de `modelos`) mas NÃO tem criacao_planejamento:preco_atacado.
      await usuarioComum(c, ["criacao_planejamento"]);
      // PATCH direto como authenticated, sem a GUC → 42501.
      const semChave = await tenta(c, `UPDATE public.modelos SET preco_atacado = 99 WHERE id = $1`, [modelo]);
      expect(semChave.startsWith("42501")).toBe(true);
      expect(semChave).toMatch(/preco de atacado/); // a recusa é DESTE ramo, não do portão de página da S3d
      // Mesmo PATCH com a GUC do recompute derivado ligada → passa (não morde o recompute).
      await c.query("SAVEPOINT pp_guc");
      await c.query("SET LOCAL ROLE authenticated");
      await c.query("SELECT set_config('app.preco_comprado_sistema','on',true)");
      let passou = "PASSOU";
      try { await c.query(`UPDATE public.modelos SET preco_atacado = 99 WHERE id = $1`, [modelo]); }
      catch (e) { passou = `${(e as any).code} ${(e as any).message}`; }
      finally { await c.query("ROLLBACK TO SAVEPOINT pp_guc"); await c.query("RESET ROLE"); await c.query("RELEASE SAVEPOINT pp_guc"); }
      expect(passou).toBe("PASSOU");
    });
  });

  it("com a chave de atacado o PATCH direto passa", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      const modelo = await cardRevenda(c);
      await usuarioComum(c, ["criacao_planejamento", "criacao_planejamento:preco_atacado"]);
      const r = await tenta(c, `UPDATE public.modelos SET preco_atacado = 99 WHERE id = $1`, [modelo]);
      expect(r).toBe("PASSOU");
    });
  });

  it("backfill: quem JÁ tinha preco_venda (editar) GANHA o ver sem perder o editar; atacado nasce com ver+editar", async () => {
    await withTx(async (c) => {
      // Usuário A: vê custos + JÁ tem a linha de EDITAR varejo (preco_venda) mas SEM pode_ver (caso do UPDATE: ganha o ver, mantém o editar).
      // Usuário B: só vê custos (a linha de preco_venda NÃO existe → nasce ver=true, editar=false). Ambos no criterio de VER.
      const B = "0b0b0b0b-0000-4000-8000-00000000a7b2";
      await semJwt(c, async () => {
        await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [B, `${B}@teste`]);
        await c.query(
          `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'PP B', 'user')
           ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
          [B, T, `${B}@teste`],
        );
      });
      await c.query(`DELETE FROM public.user_permissions WHERE user_id IN ($1,$2) AND pagina LIKE 'criacao_planejamento:%preco_%'`, [USER_TESTE, B]);
      await c.query(
        `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
           VALUES ($1,$2,'criacao_planejamento:custos',true,false),
                  ($1,$2,'criacao_planejamento:preco_venda',false,true),
                  ($3,$2,'criacao_planejamento:custos',true,false)
         ON CONFLICT (user_id, pagina) DO UPDATE SET pode_ver = excluded.pode_ver, pode_editar = excluded.pode_editar`,
        [USER_TESTE, T, B],
      );
      await aplicarArquivo(c, MIG);
      const linha = async (u: string, pag: string) =>
        (await c.query<{ pode_ver: boolean; pode_editar: boolean }>(
          `SELECT pode_ver, pode_editar FROM public.user_permissions WHERE user_id=$1 AND pagina=$2`, [u, pag])).rows;
      // A: preco_venda GANHOU o ver e CONSERVOU o editar (uma só linha).
      expect(await linha(USER_TESTE, "criacao_planejamento:preco_venda")).toEqual([{ pode_ver: true, pode_editar: true }]);
      // A: atacado = ver+editar (edita preco_venda hoje); a ordem da migration não zerou o editar ao conceder o ver.
      expect(await linha(USER_TESTE, "criacao_planejamento:preco_atacado")).toEqual([{ pode_ver: true, pode_editar: true }]);
      // B: só vê custos → varejo e atacado nascem Leitor (ver=true, editar=false).
      expect(await linha(B, "criacao_planejamento:preco_venda")).toEqual([{ pode_ver: true, pode_editar: false }]);
      expect(await linha(B, "criacao_planejamento:preco_atacado")).toEqual([{ pode_ver: true, pode_editar: false }]);
      // As chaves ver_* NÃO existem mais (nem foram criadas).
      const n = (await um<{ n: number }>(c, `SELECT count(*)::int n FROM public.user_permissions WHERE user_id IN ($1,$2) AND pagina LIKE '%ver_preco_%'`, [USER_TESTE, B])).n;
      expect(n).toBe(0);
    });
  });

  it("backfill também concede nos PAPÉIS (papel_permissoes), preserva o editar existente e é idempotente", async () => {
    await withTx(async (c) => {
      const papel = (await um<{ id: string }>(c, `INSERT INTO public.papeis (tenant_id, nome) VALUES ($1, 'PP papel') RETURNING id`, [T])).id;
      await c.query(
        `INSERT INTO public.papel_permissoes (papel_id, tenant_id, pagina, pode_ver, pode_editar)
           VALUES ($1,$2,'dashboard_custos',true,false),
                  ($1,$2,'criacao_planejamento:preco_venda',false,true),
                  ($1,$2,'criacao_produto_acabado',true,true)`,
        [papel, T],
      );
      await aplicarArquivo(c, MIG);
      const q = async (pag: string, col: "pode_ver" | "pode_editar") =>
        (await um<{ n: number }>(c,
          `SELECT count(*)::int n FROM public.papel_permissoes WHERE papel_id=$1 AND pagina=$2 AND ${col}=true`,
          [papel, pag])).n;
      expect(await q("criacao_planejamento:preco_venda", "pode_ver")).toBe(1);    // ganhou o ver
      expect(await q("criacao_planejamento:preco_venda", "pode_editar")).toBe(1); // sem perder o editar
      expect(await q("criacao_planejamento:preco_atacado", "pode_ver")).toBe(1);
      expect(await q("criacao_planejamento:preco_atacado", "pode_editar")).toBe(1);
      // 2ª aplicação: o EDITAR de atacado é DO NOTHING (não troca o que a pessoa ajustou depois); não duplica linhas.
      await c.query(`UPDATE public.papel_permissoes SET pode_editar=false WHERE papel_id=$1 AND pagina='criacao_planejamento:preco_atacado'`, [papel]);
      await aplicarArquivo(c, MIG);
      expect(await q("criacao_planejamento:preco_atacado", "pode_editar")).toBe(0);
      expect(await q("criacao_planejamento:preco_venda", "pode_editar")).toBe(1);
      expect((await um<{ n: number }>(c, `SELECT count(*)::int n FROM public.papel_permissoes WHERE papel_id=$1 AND pagina LIKE 'criacao_planejamento:%preco_%'`, [papel])).n).toBe(2);
    });
  });

  it("a migration deixa a função no md5 desta frente (pino anti-drift)", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      const m = (await um<{ m: string }>(c, `SELECT md5(pg_get_functiondef('public.fn_modelo_preco_venda_gate()'::regprocedure)) m`)).m;
      expect(m).toBe(MD5_ESTA_FRENTE);
    });
  });

  it("down: devolve o corpo anterior do gatilho (sem o ramo de atacado)", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      await aplicarArquivo(c, DOWN_RPCS);
      await aplicarArquivo(c, DOWN);
      const src = (await um<{ s: string }>(c,
        `SELECT pg_get_functiondef('public.fn_modelo_preco_venda_gate()'::regprocedure) s`)).s;
      expect(src).not.toMatch(/criacao_planejamento:preco_atacado/);
      expect(src).not.toMatch(/_pode_editar_preco/);
      expect((await um<{ h: string | null }>(c, `SELECT to_regprocedure('public._pode_editar_preco(text)')::text h`)).h).toBeNull();
      // volta ao texto EXATO da S1 (md5 pinado: quem reaplicar a S1 depois do _down desta frente a encontra como esperava)
      const m = (await um<{ m: string }>(c, `SELECT md5(pg_get_functiondef('public.fn_modelo_preco_venda_gate()'::regprocedure)) m`)).m;
      expect(m).toBe(MD5_S1_DEPOIS);
    });
  });
});
