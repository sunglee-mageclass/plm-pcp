// F5-3 Task 4 — RPC `historico_modelo(_modelo_id)` = LEITURA cruzada do historico do produto.
// Junta os eventos de `audit_log` cujo `registro_id` esta no grafo do modelo (modelo, cad, cq, produto acabado, OC de tecido ligada
// pelos links do BOM) + as mudancas de etapa (`modelo_kanban_historico`), ordenado do mais recente ao mais antigo, sem vazar
// outro modelo. DEFINER, sem portao de pagina (usuario comum le), anon sem EXECUTE, inexistente/outra loja = P0002 ASCII.
//
// TUDO em BEGIN...ROLLBACK (`withTx`), SO na copia local (`ehBancoLocal`). Fixtures como postgres SEM JWT (semJwt); a RPC roda como
// o PAPEL `authenticated` (SET LOCAL ROLE) com o JWT do usuario. A migration (20261121100000, Task 4) ja esta aplicada na copia.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, TENANT_TESTE, USER_TESTE } from "./db";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979";
const U_COMUM = "f5f5f5f5-0000-4000-8000-0000000000c4"; // role user, loja de teste, SEM nenhuma user_permissions
const NADA = "00000000-f5f5-4000-8000-00000000dead";

type Ev = { tipo: "audit" | "etapa"; entidade: string; acao: string; quem: string | null; quando: string; dados: any };

async function jwt(c: Client, uid: string | null): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : ""]);
  if (uid === USER_TESTE) await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, USER_TESTE]);
}

/** Chama a RPC como o papel `authenticated` (PostgREST real) num SAVEPOINT; erro volta ao savepoint e vem como {code,msg}. */
async function hist(c: Client, m: string): Promise<{ ok: true; evs: Ev[] } | { ok: false; code: string; msg: string }> {
  await c.query("SAVEPOINT h4");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    const r = await um<{ r: Ev[] }>(c, "select public.historico_modelo($1::uuid) as r", [m]);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT h4");
    return { ok: true, evs: r.r };
  } catch (e) {
    const er = e as { code?: string; message?: string };
    await c.query("ROLLBACK TO SAVEPOINT h4");
    await c.query("RELEASE SAVEPOINT h4");
    return { ok: false, code: String(er.code ?? ""), msg: String(er.message ?? "") };
  }
}

async function usuarioComum(c: Client): Promise<void> {
  await semJwt(c, async () => {
    await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [U_COMUM, `${U_COMUM}@teste`]);
    await c.query(
      `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'Fulana Comum', 'user')
       ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
      [U_COMUM, T, `${U_COMUM}@teste`],
    );
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [U_COMUM]);
  });
}

type Fx = { m: string; m2: string; mOutraLoja: string; cad: string; cad2: string; cq: string; oc: string; ocSolta: string; pa: string };

/** Grafo do modelo M (cad, cq, produto acabado, OC ligada por link) + um OUTRO modelo M2 da mesma loja + um modelo de outra loja. */
async function fixture(c: Client): Promise<Fx> {
  return semJwt(c, async () => {
    const id = async (sql: string, p: unknown[]) => (await um<{ id: string }>(c, sql, p)).id;
    const mod = (t: string, nome: string) => id(`insert into modelos (tenant_id, nome) values ($1, $2) returning id`, [t, nome]);
    const m = await mod(T, "HIST4 modelo");
    const m2 = await mod(T, "HIST4 outro modelo");
    const mOutraLoja = await mod(AVE_RARA, "HIST4 modelo de outra loja");
    const cad = await id(`insert into cad (tenant_id, modelo_id) values ($1, $2) returning id`, [T, m]);
    const cad2 = await id(`insert into cad (tenant_id, modelo_id) values ($1, $2) returning id`, [T, m2]);
    const cq = await id(`insert into controle_qualidade (tenant_id, cad_id) values ($1, $2) returning id`, [T, cad]);
    const pa = await id(`insert into produtos_acabados (tenant_id, nome, modelo_id) values ($1, 'HIST4 PA', $2) returning id`, [T, m]);
    const art = await id(`insert into artigos (tenant_id, nome, unidade_medida, preco) values ($1, 'HIST4 tecido', 'metro', 10) returning id`, [T]);
    const vt = await id(`insert into variantes_tecido (tenant_id, artigo_id, nome_variante) values ($1, $2, 'HIST4-v') returning id`, [T, art]);
    const oc = await id(`insert into ocs_tecido (tenant_id) values ($1) returning id`, [T]);
    const ocSolta = await id(`insert into ocs_tecido (tenant_id) values ($1) returning id`, [T]);
    const it = await id(`insert into ocs_tecido_itens (oc_tecido_id) values ($1) returning id`, [oc]);
    await c.query(
      `insert into modelo_tecido_oc_links (tenant_id, modelo_id, tipo, numero, ordem, variante_tecido_id, oc_tecido_item_id)
       values ($1, $2, 'tecido', 1, 1, $3, $4)`,
      [T, m, vt, it],
    );
    // Limpa o que os gatilhos de auditoria gravaram ao criar a fixture: so os eventos semeados abaixo contam.
    await c.query(`delete from audit_log where registro_id = any($1::uuid[])`, [[m, m2, mOutraLoja, cad, cad2, cq, pa, oc, ocSolta]]);
    await c.query(`delete from modelo_kanban_historico where modelo_id = any($1::uuid[])`, [[m, m2, mOutraLoja]]);
    return { m, m2, mOutraLoja, cad, cad2, cq, oc, ocSolta, pa };
  });
}

/** Evento de auditoria semeado (marca `t` em dados; instante fixo em 2020 para a ordem ser deterministica). */
async function audit(c: Client, tenant: string, reg: string, entidade: string, tabela: string, quando: string, t: string, nome = "Ana"): Promise<void> {
  await semJwt(c, () =>
    c.query(
      `insert into audit_log (tenant_id, user_nome, acao, entidade, tabela, registro_id, descricao, dados, created_at)
       values ($1, $2, 'editar', $3, $4, $5, 'x', jsonb_build_object('t', $6::text), $7::timestamptz)`,
      [tenant, nome, entidade, tabela, reg, t, quando],
    ),
  );
}
async function etapa(c: Client, tenant: string, m: string, status: string, quando: string, origem = "manual"): Promise<void> {
  await semJwt(c, () =>
    c.query(
      `insert into modelo_kanban_historico (tenant_id, modelo_id, status, entrou_at, origem) values ($1, $2, $3, $4::timestamptz, $5)`,
      [tenant, m, status, quando, origem],
    ),
  );
}
const marca = (e: Ev): string => (e.tipo === "audit" ? e.dados.t : `etapa:${e.dados.status}`);

describe.skipIf(!RODA)("F5-3 Task 4 — historico_modelo (leitura cruzada)", () => {
  it("devolve modelo+cad+cq+produto+oc+kanban, ordenado DESC, no shape combinado, sem vazar outro modelo", async () => {
    await withTx(async (c) => {
      const f = await fixture(c);
      await usuarioComum(c);
      // Do mais antigo ao mais recente: 01 etapa, 02 modelo, 03 cad, 04 etapa, 05 cq, 06 oc, 07 produto, 08 modelo
      await etapa(c, T, f.m, "Planejamento", "2020-01-01T10:00:00Z", "manual");
      await audit(c, T, f.m, "Tecidos", "modelo_tecidos", "2020-01-02T10:00:00Z", "02-modelo");
      await audit(c, T, f.cad, "CAD", "cad", "2020-01-03T10:00:00Z", "03-cad", "Beto");
      await etapa(c, T, f.m, "Desenvolvimento", "2020-01-04T10:00:00Z", "auto");
      await audit(c, T, f.cq, "Controle de Qualidade", "controle_qualidade", "2020-01-05T10:00:00Z", "05-cq");
      await audit(c, T, f.oc, "OC de Tecido", "ocs_tecido", "2020-01-06T10:00:00Z", "06-oc");
      await audit(c, T, f.pa, "Produto Acabado", "produtos_acabados", "2020-01-07T10:00:00Z", "07-pa");
      await audit(c, T, f.m, "Grade", "modelo_grades", "2020-01-08T10:00:00Z", "08-modelo");
      // Ruido que NAO pode aparecer: outro modelo (e o cad dele), OC nao ligada, e um evento de OUTRA loja no mesmo registro.
      await audit(c, T, f.m2, "Tecidos", "modelo_tecidos", "2020-02-01T10:00:00Z", "x-outro-modelo");
      await audit(c, T, f.cad2, "CAD", "cad", "2020-02-02T10:00:00Z", "x-outro-cad");
      await audit(c, T, f.ocSolta, "OC de Tecido", "ocs_tecido", "2020-02-03T10:00:00Z", "x-oc-solta");
      await audit(c, AVE_RARA, f.m, "Tecidos", "modelo_tecidos", "2020-02-04T10:00:00Z", "x-outra-loja");
      await etapa(c, T, f.m2, "Pronto", "2020-02-05T10:00:00Z");
      await audit(c, AVE_RARA, f.mOutraLoja, "Tecidos", "modelo_tecidos", "2020-02-06T10:00:00Z", "x-modelo-outra-loja");

      await jwt(c, U_COMUM);
      const r = await hist(c, f.m);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.evs.map(marca)).toEqual([
        "08-modelo",
        "07-pa",
        "06-oc",
        "05-cq",
        "etapa:Desenvolvimento",
        "03-cad",
        "02-modelo",
        "etapa:Planejamento",
      ]);
      // DESC por `quando`
      const ts = r.evs.map((e) => Date.parse(e.quando));
      expect([...ts].sort((a, b) => b - a)).toEqual(ts);
      // shape combinado
      for (const e of r.evs) expect(Object.keys(e).sort()).toEqual(["acao", "dados", "entidade", "quando", "quem", "tipo"]);
      const cad = r.evs.find((e) => e.dados?.t === "03-cad")!;
      expect(cad).toMatchObject({ tipo: "audit", entidade: "CAD", acao: "editar", quem: "Beto" });
      const et = r.evs.find((e) => e.tipo === "etapa" && e.dados.status === "Desenvolvimento")!;
      expect(et).toMatchObject({ tipo: "etapa", entidade: "Etapa", dados: { status: "Desenvolvimento", origem: "auto" } });
      // nenhum rastro dos ruidos
      expect(r.evs.some((e) => String(e.dados?.t ?? "").startsWith("x-"))).toBe(false);
    });
  });

  it("modelo sem eventos devolve array vazio; o outro modelo enxerga so o dele", async () => {
    await withTx(async (c) => {
      const f = await fixture(c);
      await usuarioComum(c);
      await audit(c, T, f.cad2, "CAD", "cad", "2020-03-01T10:00:00Z", "m2-cad");
      await jwt(c, U_COMUM);
      const vazio = await hist(c, f.m);
      expect(vazio.ok && vazio.evs).toEqual([]);
      const do2 = await hist(c, f.m2);
      expect(do2.ok && do2.evs.map(marca)).toEqual(["m2-cad"]);
    });
  });

  it("modelo de OUTRA loja ou inexistente = P0002 nao_encontrado: modelo (mesmo erro, ASCII); sem login = 42501", async () => {
    await withTx(async (c) => {
      const f = await fixture(c);
      await usuarioComum(c);
      await audit(c, AVE_RARA, f.mOutraLoja, "Tecidos", "modelo_tecidos", "2020-03-01T10:00:00Z", "outra");
      await jwt(c, U_COMUM);
      const outra = await hist(c, f.mOutraLoja);
      const nada = await hist(c, NADA);
      expect(outra).toEqual({ ok: false, code: "P0002", msg: "nao_encontrado: modelo" });
      expect(nada).toEqual(outra);
      expect(/^[\x20-\x7e]+$/.test((outra as { msg: string }).msg)).toBe(true);
      await jwt(c, null);
      const anonimo = await hist(c, f.m);
      expect(anonimo.ok).toBe(false);
      expect((anonimo as { code: string }).code).toBe("42501");
    });
  });

  it("usuario COMUM (role user, sem nenhuma permissao de pagina) consegue LER; super admin tambem", async () => {
    await withTx(async (c) => {
      const f = await fixture(c);
      await usuarioComum(c);
      await audit(c, T, f.m, "Tecidos", "modelo_tecidos", "2020-03-01T10:00:00Z", "lido");
      await jwt(c, U_COMUM);
      const papel = await um<{ n: number }>(c, "select count(*)::int n from public.user_roles where user_id = $1", [U_COMUM]);
      expect(papel.n).toBe(0); // nao e admin de nada
      const r = await hist(c, f.m);
      expect(r.ok && r.evs.map(marca)).toEqual(["lido"]);
      await jwt(c, USER_TESTE);
      const s = await hist(c, f.m);
      expect(s.ok && s.evs.map(marca)).toEqual(["lido"]);
    });
  });

  it("anon sem EXECUTE; authenticated e service_role com; DEFINER, STABLE, search_path=public", async () => {
    await withTx(async (c) => {
      const sig = "public.historico_modelo(uuid)";
      const q = (r: string) => um<{ v: boolean }>(c, "select has_function_privilege($1, $2, 'EXECUTE') v", [r, sig]);
      expect((await q("anon")).v).toBe(false);
      expect((await q("authenticated")).v).toBe(true);
      expect((await q("service_role")).v).toBe(true);
      const f = await um<{ definer: boolean; vol: string; cfg: string[]; acl: string }>(
        c,
        `select prosecdef definer, provolatile vol, proconfig cfg, proacl::text acl from pg_proc where oid = to_regprocedure($1)`,
        [sig],
      );
      expect(f.definer).toBe(true);
      expect(f.vol).toBe("s");
      expect(f.cfg).toContain("search_path=public");
      expect(f.acl).not.toMatch(/(^|[{,])=X/); // sem PUBLIC
    });
  });
});
