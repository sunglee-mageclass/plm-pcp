// Urgentes R9b (plan-c Task 2, migration 20261103193000_urg_r9_peca_teste_rpcs): RPCs da Peça Teste — leitura da seção do Sheet
// (`peca_teste_modelo`), Salvar com rev/P0409/CAS do fornecedor na MESMA transação (`salvar_peca_teste`) e quadro de PCP › Etapas
// (`peca_teste_quadro`), + o helper ÚNICO `_peca_teste_aprovada` (revisão T1, achado 1: a aprovada só conta com o fornecedor
// congelado na decisão = o da linha) e a trava de fornecedor redefinida por cima dele. Txn revertida; o bloco é aplicado DENTRO da
// txn por aplicaUrgc (pula se já vivo na cópia). As RPCs rodam como o PAPEL `authenticated` (SET LOCAL ROLE) com JWT de usuário COMUM
// criado na txn, com permissões por página explícitas (receita dos testes S3). Só na cópia local.
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, dbUrl, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicaUrgc, voltaUrgc, urgcViva, URGC_BLOCOS } from "./urgc-helpers";
import { aplicarArquivo, semTransacao } from "./mig-txn";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RODA = hasDb && ehBancoLocal();
const BLOCO = URGC_BLOCOS.r9b;
const BLOCO_A = URGC_BLOCOS.r9a;
const T = TENANT_TESTE;
const SUPER = USER_TESTE;
const U_ED = "5e9a0054-0000-4000-8000-0000000009e1"; // EDITA a seção Peça Teste (sem aprovar M.O., sem ver custos)
const U_LE = "5e9a0054-0000-4000-8000-0000000009e2"; // só VÊ a seção
const U_SEM = "5e9a0054-0000-4000-8000-0000000009e3"; // vê o Planejamento, sem a seção
const U_ETP = "5e9a0054-0000-4000-8000-0000000009e4"; // vê PCP › Etapas
const SEC = "criacao_planejamento:peca_teste";
const TAB = "public.modelo_peca_teste_tentativas";
const TRAVA = "public.fn_peca_teste_trava_fornecedor()";
const HELPER = "public._peca_teste_aprovada(uuid,uuid,uuid)";
const WRAPPERS = ["public.peca_teste_modelo(uuid)", "public.salvar_peca_teste(uuid,jsonb,jsonb)", "public.peca_teste_quadro()"];
const CORES = [
  "public._peca_teste_trilhas_core(uuid,uuid)",
  "public._salvar_peca_teste_core(uuid,jsonb,jsonb)",
  "public._peca_teste_quadro_core(uuid)",
];
const NOVAS = [HELPER, ...WRAPPERS, ...CORES];
const ACL_CORE_N = "postgres=X/postgres,service_role=X/postgres";
const ACL_WRAP_N = "authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres";
const D1 = "2026-10-01";
const D2 = "2026-10-03";

type Res = { ok: true; rows: any[] } | { ok: false; code: string; msg: string };
async function jwt(c: Client, uid: string | null): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : ""]);
}
/** Roda `sql` como o papel `authenticated` (PostgREST) com o JWT de `uid`, num SAVEPOINT; erro volta ao savepoint. */
async function como(c: Client, uid: string | null, sql: string, params: unknown[] = []): Promise<Res> {
  await jwt(c, uid);
  await c.query("SAVEPOINT r9b_z");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    const r = await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT r9b_z");
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT r9b_z");
    await c.query("RELEASE SAVEPOINT r9b_z");
    return { ok: false, code: String(e.code ?? ""), msg: String(e.message ?? "") };
  } finally {
    await jwt(c, null);
  }
}
const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);
async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}
async function aclN(c: Client, sig: string): Promise<string | null> {
  return (
    await um<{ a: string | null }>(
      c,
      `SELECT (SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(p.proacl) x) AS a FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
      [sig],
    )
  ).a;
}
async function usuario(c: Client, uid: string, nome: string): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, $4, 'user')
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [uid, T, `${uid}@teste`, nome],
  );
}
/** TROCA as permissões por página do usuário pelas dadas ([pagina, editar]). */
async function perms(c: Client, uid: string, lista: [string, boolean][]): Promise<void> {
  await semJwt(c, async () => {
    await c.query("DELETE FROM public.user_permissions WHERE user_id = $1", [uid]);
    for (const [pagina, editar] of lista) {
      await c.query(
        "INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, true, $4)",
        [uid, T, pagina, editar],
      );
    }
  });
}
async function modulo(c: Client, chave: string, ligado: boolean): Promise<void> {
  await semJwt(c, () =>
    c.query(
      `UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || jsonb_build_object($2::text, $3::boolean) WHERE tenant_id = $1`,
      [T, chave, ligado],
    ),
  );
}
/** Escrita de PREPARAÇÃO que não deve acionar enfileirador/guarda do kanban. */
async function comoSistema<R>(c: Client, fn: () => Promise<R>): Promise<R> {
  await c.query("SELECT set_config('app.kanban_sistema', 'teste', true)");
  try {
    return await fn();
  } finally {
    await c.query("SELECT set_config('app.kanban_sistema', '', true)");
  }
}
async function prepara(c: Client): Promise<void> {
  await c.query("SET LOCAL statement_timeout = '180s'");
  await aplicaUrgc(c);
  await jwt(c, null);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, SUPER]);
  await usuario(c, U_ED, "R9b editor");
  await usuario(c, U_LE, "R9b leitor");
  await usuario(c, U_SEM, "R9b sem secao");
  await usuario(c, U_ETP, "R9b etapas");
  await perms(c, U_ED, [["criacao_planejamento", false], [SEC, true]]);
  await perms(c, U_LE, [["criacao_planejamento", false], [SEC, false]]);
  await perms(c, U_SEM, [["criacao_planejamento", true]]);
  await perms(c, U_ETP, [["producao_etapas", false], ["criacao_planejamento", false]]);
  for (const m of ["criacao", "producao", "entrada_saida", "etapas_pl"]) await modulo(c, m, true);
}

type Cen = {
  suf: string;
  modelo: string;
  catA: string; // exige (PL)
  catB: string; // exige
  catC: string; // NÃO exige (outros)
  f1: string;
  f2: string;
  fMat: string;
  fOutra: string;
  linhaA: string;
  linhaB: string;
  linhaC: string;
  linhaG: string; // "Geral (legado)", sem tipo
  outra: string;
  modeloOutra: string;
};
async function novoModelo(c: Client, tenant: string, nome: string, extra: Record<string, unknown> = {}): Promise<string> {
  const cols: Record<string, unknown> = { tenant_id: tenant, nome, ordem_criacao_enviada: true, status_desenvolvimento: "entrada", ...extra };
  const k = Object.keys(cols);
  return comoSistema(c, async () =>
    (
      await um<{ id: string }>(
        c,
        `INSERT INTO public.modelos (${k.join(", ")}) VALUES (${k.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
        Object.values(cols),
      )
    ).id,
  );
}
async function novaLinha(c: Client, modelo: string, cat: string | null, emp: string | null, valor: number): Promise<string> {
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, empresa_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [T, modelo, cat, valor, emp],
    )
  ).id;
}
/** Fixture (como postgres; JWT do super admin só para aprovar a M.O.): 3 tipos (2 exigem), 4 fornecedores, 1 card com 4 linhas de M.O. */
async function cenario(c: Client): Promise<Cen> {
  await prepara(c);
  const suf = Math.random().toString(36).slice(2, 8);
  const outra = (await um<{ id: string }>(c, "SELECT id FROM public.tenants WHERE id <> $1 ORDER BY id LIMIT 1", [T])).id;
  const cat = async (n: string, ordem: number, exige: boolean) =>
    (
      await um<{ id: string }>(
        c,
        `INSERT INTO public.categorias_terceirizado (tenant_id, nome, etapa, ordem, exige_peca_teste)
         VALUES ($1, $2, 'ate_costura', $3, $4) RETURNING id`,
        [T, `${n} R9b ${suf}`, ordem, exige],
      )
    ).id;
  const emp = async (tenant: string, nome: string, tipo = "servico") =>
    (
      await um<{ id: string }>(
        c,
        "INSERT INTO public.empresas (tenant_id, nome_fantasia, tipo) VALUES ($1, $2, $3) RETURNING id",
        [tenant, `${nome} ${suf}`, tipo],
      )
    ).id;
  const catA = await cat("PL", 9001, true);
  const catB = await cat("Bordado", 9002, true);
  const catC = await cat("Lavanderia", 9003, false);
  const f1 = await emp(T, "Oficina R9b 1");
  const f2 = await emp(T, "Oficina R9b 2");
  const fMat = await emp(T, "Malharia R9b", "material");
  const fOutra = await emp(outra, "Oficina Outra R9b");
  const modelo = await novoModelo(c, T, `M R9b ${suf}`);
  // ordem de criação invertida de propósito: a ordem da seção é a do tipo (ct.ordem), não a do created_at
  const linhaG = await novaLinha(c, modelo, null, null, 3);
  const linhaC = await novaLinha(c, modelo, catC, f1, 7);
  const linhaB = await novaLinha(c, modelo, catB, f2, 5);
  const linhaA = await novaLinha(c, modelo, catA, f1, 10);
  await jwt(c, SUPER);
  await c.query("UPDATE public.modelo_servico_mo SET aprovado = true WHERE id = $1", [linhaA]);
  await jwt(c, null);
  const modeloOutra = await semJwt(c, () => novoModelo(c, outra, `M R9b outra ${suf}`));
  return { suf, modelo, catA, catB, catC, f1, f2, fMat, fOutra, linhaA, linhaB, linhaC, linhaG, outra, modeloOutra };
}

type TentPayload = { id?: string | null; numero?: number; data_saida?: string | null; data_entrada?: string | null; aprovacao?: string | null };
type TrilhaPayload = { mo_linha_id: string; categoria_id: string; empresa_id?: string | null; tentativas?: TentPayload[] };
type Base = { tentativas?: Record<string, number>; fornecedor?: Record<string, string | null> };
const tp = (t: TentPayload): TentPayload => ({ id: null, data_saida: null, data_entrada: null, aprovacao: null, ...t });
/** `base.fornecedor` AUSENTE = a tela que acabou de ler: o fornecedor ATUAL de cada linha do payload (toda decisão exige a base —
 *  revisão T2, achado 1). Para testar "sem base"/"base velha" o teste passa `fornecedor` explícito. */
async function salvar(c: Client, uid: string | null, modelo: string, trilhas: TrilhaPayload[], base: Base = {}): Promise<Res> {
  let fornecedor = base.fornecedor;
  if (fornecedor === undefined) {
    fornecedor = {};
    for (const t of trilhas) {
      const r = await c.query("SELECT empresa_id FROM public.modelo_servico_mo WHERE id::text = $1", [t.mo_linha_id]);
      if (r.rowCount) fornecedor[t.mo_linha_id] = r.rows[0].empresa_id;
    }
  }
  return como(c, uid, "SELECT public.salvar_peca_teste($1, $2::jsonb, $3::jsonb)", [
    modelo,
    JSON.stringify(trilhas),
    JSON.stringify({ tentativas: {}, ...base, fornecedor }),
  ]);
}
async function ler(c: Client, uid: string, modelo: string): Promise<any> {
  const r = await como(c, uid, "SELECT public.peca_teste_modelo($1) AS r", [modelo]);
  if (!r.ok) throw new Error(`peca_teste_modelo falhou: ${txt(r)}`);
  return r.rows[0].r;
}
async function quadro(c: Client, uid: string): Promise<Res> {
  return como(c, uid, "SELECT public.peca_teste_quadro() AS r");
}
type Linha = {
  id: string;
  numero: number;
  empresa_id: string | null;
  data_saida: string | null;
  data_entrada: string | null;
  aprovacao: string | null;
  decidido_por: string | null;
  decidido: boolean;
  rev: number;
  created_by: string | null;
  origem: string;
  upd: string;
};
async function tentativas(c: Client, linha: string, cat?: string): Promise<Linha[]> {
  const r = await c.query(
    `SELECT id, numero, empresa_id, to_char(data_saida, 'YYYY-MM-DD') AS data_saida, to_char(data_entrada, 'YYYY-MM-DD') AS data_entrada,
            aprovacao, decidido_por, decidido_em IS NOT NULL AS decidido, rev, created_by, origem, updated_at::text AS upd
       FROM ${TAB} WHERE mo_linha_id = $1 AND ($2::uuid IS NULL OR categoria_terceirizado_id = $2) ORDER BY numero`,
    [linha, cat ?? null],
  );
  return r.rows as Linha[];
}
async function linhaMo(c: Client, id: string): Promise<{ empresa_id: string | null; aprovado: boolean | null; motivo: string | null; cat: string | null }> {
  return um(c, "SELECT empresa_id, aprovado, motivo_reprovacao AS motivo, categoria_terceirizado_id AS cat FROM public.modelo_servico_mo WHERE id = $1", [id]);
}
async function aprovadaHelper(c: Client, linha: string): Promise<boolean> {
  return (
    await um<{ ok: boolean }>(
      c,
      `SELECT public._peca_teste_aprovada(s.id, s.categoria_terceirizado_id, s.empresa_id) AS ok FROM public.modelo_servico_mo s WHERE s.id = $1`,
      [linha],
    )
  ).ok;
}
/** A 1ª tentativa APROVADA (pelo Salvar) na linha A — saída, entrada e aprovação. */
async function aprovaA(c: Client, s: Cen): Promise<Linha> {
  const r = await salvar(c, U_ED, s.modelo, [
    { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_saida: D1, data_entrada: D2, aprovacao: "aprovado" })] },
  ]);
  expect(txt(r)).toBe("PASSOU");
  return (await tentativas(c, s.linhaA))[0];
}
function readSemTxn(rel: string): string {
  return semTransacao(readFileSync(ROOT + rel, "utf8"), rel);
}
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<{ code?: string; message: string }> {
  await c.query("SAVEPOINT r9b_falha");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT r9b_falha");
    return e as { code?: string; message: string };
  }
  await c.query("ROLLBACK TO SAVEPOINT r9b_falha");
  throw new Error(`esperava erro e passou: ${sql.slice(0, 120)}`);
}

const CONFLITO = "P0409 peca_teste_conflito: outra pessoa salvou a peca teste";
const DESATUALIZADA = "P0409 peca_teste_desatualizada: servico da mao de obra mudou";

describe("urg R9b — contrato do gerador", () => {
  it("bloco r9b em urgc-dados.ts: sentinela = a trava (redefinida sobre o DEPOIS da r9a), 7 funções novas, 3 wrappers", () => {
    expect(BLOCO, "bloco r9b em urgc-dados.ts").toBeDefined();
    expect(BLOCO!.mig).toBe("supabase/migrations/20261103193000_urg_r9_peca_teste_rpcs.sql");
    expect(BLOCO!.down).toBe("supabase/rollback/20261103193000_urg_r9_peca_teste_rpcs_down.sql");
    expect(BLOCO!.drop).toBe("supabase/rollback/20261103193000_urg_r9_peca_teste_rpcs_down_drop.sql");
    expect(BLOCO!.URGC_SENTINELA).toBe(TRAVA);
    expect(BLOCO!.URGC_MD5[TRAVA].antes).toBe(BLOCO_A!.URGC_NOVAS![TRAVA]);
    expect(BLOCO!.URGC_MD5[TRAVA].depois).not.toBe(BLOCO!.URGC_MD5[TRAVA].antes);
    expect(Object.keys(BLOCO!.URGC_NOVAS ?? {}).sort()).toEqual([...NOVAS].sort());
    expect([...(BLOCO!.URGC_WRAPPERS ?? [])].sort()).toEqual([...WRAPPERS].sort());
    expect(BLOCO!.URGC_DROP_GUC).toBeUndefined();
  });
});

describe.skipIf(!RODA)("urg R9b — RPCs da Peça Teste", () => {
  it("1) leitura: trilhas só dos tipos exigindo (ordem do tipo), `outros` sem valor; sem a seção = NULL; outra loja = NULL; Criação desligada = 42501", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const r = await ler(c, U_ED, s.modelo);
      expect(r.trilhas.map((t: any) => t.mo_linha_id)).toEqual([s.linhaA, s.linhaB]);
      const [a, b] = r.trilhas;
      expect(a).toEqual({
        mo_linha_id: s.linhaA,
        categoria_id: s.catA,
        categoria_nome: `PL R9b ${s.suf}`,
        empresa_id: s.f1,
        empresa_nome: `Oficina R9b 1 ${s.suf}`,
        mo_aprovado: true,
        aprovada: false,
        tentativas: [],
      });
      expect([b.mo_aprovado, b.empresa_id, b.categoria_nome]).toEqual([null, s.f2, `Bordado R9b ${s.suf}`]);
      // outros = só as linhas COM tipo que não exige; sem id, sem valor (o legado "Geral" fica fora)
      expect(r.outros).toEqual([{ categoria_nome: `Lavanderia R9b ${s.suf}`, empresa_nome: `Oficina R9b 1 ${s.suf}` }]);
      expect(JSON.stringify(r)).not.toMatch(/"valor"/);
      expect(Object.keys(r).sort()).toEqual(["outros", "trilhas"]);
      // Leitor lê; quem vê o Planejamento SEM a seção recebe NULL (a tela esconde a seção)
      expect((await ler(c, U_LE, s.modelo)).trilhas).toHaveLength(2);
      expect(await ler(c, U_SEM, s.modelo)).toBeNull();
      // card de OUTRA loja = NULL; id inexistente = NULL
      expect(await ler(c, U_ED, s.modeloOutra)).toBeNull();
      expect(await ler(c, U_ED, "00000000-5e9a-4054-8000-00000000dead")).toBeNull();
      // módulo Criação desligado: 42501 modulo_desligado
      await modulo(c, "criacao", false);
      expect(txt(await como(c, U_ED, "SELECT public.peca_teste_modelo($1)", [s.modelo]))).toBe("42501 modulo_desligado: criacao");
      expect(txt(await salvar(c, U_ED, s.modelo, []))).toBe("42501 modulo_desligado: criacao");
    });
  });

  it("2) 1ª tentativa: id null + numero 1 com saída = INSERT (rev 0, created_by, origem card, sem decisão); só nulos = nada gravado", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const r = await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_saida: D1 })] },
        { mo_linha_id: s.linhaB, categoria_id: s.catB, tentativas: [tp({ numero: 1 })] },
      ]);
      expect(txt(r)).toBe("PASSOU");
      const ta = await tentativas(c, s.linhaA);
      expect(ta).toHaveLength(1);
      expect(ta[0]).toMatchObject({
        numero: 1, data_saida: D1, data_entrada: null, aprovacao: null, empresa_id: null, decidido: false, rev: 0, created_by: U_ED, origem: "card",
      });
      expect(await tentativas(c, s.linhaB)).toEqual([]);
      const lido = await ler(c, U_ED, s.modelo);
      expect(lido.trilhas[0].tentativas).toEqual([
        { id: ta[0].id, numero: 1, empresa_id: null, empresa_nome: null, data_saida: D1, data_entrada: null, aprovacao: null, decidido_em: null, rev: 0 },
      ]);
      expect(lido.trilhas[1].tentativas).toEqual([]);
      // payload vazio = nada; formato errado = P0001
      expect(txt(await salvar(c, U_ED, s.modelo, []))).toBe("PASSOU");
      expect(txt(await como(c, U_ED, "SELECT public.salvar_peca_teste($1, '{}'::jsonb, '{}'::jsonb)", [s.modelo]))).toMatch(/^P0001 peca_teste_formato: /);
      expect(txt(await como(c, U_ED, "SELECT public.salvar_peca_teste($1, '[]'::jsonb, NULL)", [s.modelo]))).toMatch(/^P0001 peca_teste_formato: /);
      expect(
        txt(await salvar(c, U_ED, s.modelo, [{ mo_linha_id: "x", categoria_id: s.catA, tentativas: [] }])),
      ).toMatch(/^P0001 peca_teste_formato: /);
      expect(
        txt(await salvar(c, U_ED, s.modelo, [{ mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_saida: D1, aprovacao: "talvez" })] }])),
      ).toMatch(/^P0001 peca_teste_formato: /);
      // revisão T2, achado 7: data inexistente, id repetido e trilha repetida com caixa diferente = P0001 com prefixo
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_saida: "2026-02-30" })] },
      ]))).toBe("P0001 peca_teste_formato: data invalida");
      const t1 = (await tentativas(c, s.linhaA))[0];
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ id: t1.id, data_saida: D1 }), tp({ id: t1.id.toUpperCase(), data_saida: "2026-10-02" })] },
      ], { tentativas: { [t1.id]: t1.rev } }))).toMatch(/^P0001 peca_teste_formato: /);
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [] },
        { mo_linha_id: s.linhaA.toUpperCase(), categoria_id: s.catA, tentativas: [] },
      ], { fornecedor: {} }))).toMatch(/^P0001 peca_teste_formato: /);
      expect(await tentativas(c, s.linhaA)).toEqual([t1]);
      // card de outra loja / inexistente
      expect(txt(await salvar(c, U_ED, s.modeloOutra, []))).toBe("P0001 peca_teste_modelo: nao encontrado");
    });
  });

  it("3) aprovar exige as 2 datas; aprovado grava decidido_por/decidido_em e o fornecedor DA LINHA; updated_at escrito a cada mudança (achado 6)", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const semEntrada = await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_saida: D1, aprovacao: "aprovado" })] },
      ]);
      expect(txt(semEntrada)).toMatch(/^P0001 peca_teste_sem_datas: /);
      expect(await tentativas(c, s.linhaA)).toEqual([]);
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_saida: D1 })] },
      ]))).toBe("PASSOU");
      const t0 = (await tentativas(c, s.linhaA))[0];
      // updated_at: a RPC grava now() em TODA mudança (sem gatilho próprio) — força um valor velho para ver a escrita
      await c.query(`UPDATE ${TAB} SET updated_at = '2000-01-01' WHERE id = $1`, [t0.id]);
      const t0b = (await tentativas(c, s.linhaA))[0];
      // aprovar SEM data de entrada (tentativa existente) = P0001
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ id: t0.id, data_saida: D1, aprovacao: "aprovado" })] },
      ], { tentativas: { [t0.id]: t0b.rev } }))).toMatch(/^P0001 peca_teste_sem_datas: /);
      // payload igual ao gravado = no-op (rev e updated_at não mudam)
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ id: t0.id, data_saida: D1 })] },
      ], { tentativas: { [t0.id]: t0b.rev } }))).toBe("PASSOU");
      expect(await tentativas(c, s.linhaA)).toEqual([t0b]);
      // com as 2 datas: aprovado
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ id: t0.id, data_saida: D1, data_entrada: D2, aprovacao: "aprovado" })] },
      ], { tentativas: { [t0.id]: t0b.rev } }))).toBe("PASSOU");
      const t1 = (await tentativas(c, s.linhaA))[0];
      expect(t1).toMatchObject({ aprovacao: "aprovado", data_entrada: D2, decidido_por: U_ED, decidido: true, empresa_id: s.f1, rev: t0b.rev + 1 });
      expect(t1.upd).not.toMatch(/^2000-01-01/);
      expect(await aprovadaHelper(c, s.linhaA)).toBe(true);
      const lido = await ler(c, U_ED, s.modelo);
      expect(lido.trilhas[0].aprovada).toBe(true);
      expect(lido.trilhas[0].tentativas[0]).toMatchObject({ aprovacao: "aprovado", empresa_id: s.f1, empresa_nome: `Oficina R9b 1 ${s.suf}` });
      expect(lido.trilhas[0].tentativas[0].decidido_em).toBeTruthy();
      // aprovada mantida com data trocada = P0001; desfazer (aprovado -> vazio) limpa decidido_* e o fornecedor congelado
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ id: t1.id, data_saida: D1, data_entrada: "2026-10-04", aprovacao: "aprovado" })] },
      ], { tentativas: { [t1.id]: t1.rev } }))).toMatch(/^P0001 peca_teste_aprovada_travada: /);
      await c.query(`UPDATE ${TAB} SET updated_at = '2000-01-01' WHERE id = $1`, [t1.id]);
      const t1b = (await tentativas(c, s.linhaA))[0];
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ id: t1.id, data_saida: D1, data_entrada: D2 })] },
      ], { tentativas: { [t1.id]: t1b.rev } }))).toBe("PASSOU");
      const t2 = (await tentativas(c, s.linhaA))[0];
      expect(t2).toMatchObject({ aprovacao: null, decidido: false, decidido_por: null, empresa_id: null, rev: t1b.rev + 1 });
      expect(t2.upd).not.toMatch(/^2000-01-01/);
      // tudo vazio = volta a VIRTUAL (DELETE)
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ id: t2.id })] },
      ], { tentativas: { [t2.id]: t2.rev } }))).toBe("PASSOU");
      expect(await tentativas(c, s.linhaA)).toEqual([]);
    });
  });

  it("4) reprovar = histórico (fornecedor fica); nova nº 2 grava; nº 3 direto = P0409; editar a reprovada = P0001; reprovar + a próxima no MESMO Salvar", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const t1 = await aprovaA(c, s);
      // aprovado -> reprovado: permitido (vira histórico), o fornecedor congelado fica
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ id: t1.id, data_saida: D1, data_entrada: D2, aprovacao: "reprovado" })] },
      ], { tentativas: { [t1.id]: t1.rev } }))).toBe("PASSOU");
      const r1 = (await tentativas(c, s.linhaA))[0];
      expect(r1).toMatchObject({ aprovacao: "reprovado", empresa_id: s.f1, decidido_por: U_ED });
      // editar a reprovada (qualquer campo) = P0001 historico; igual ao gravado = no-op
      for (const mud of [{ data_entrada: "2026-10-05", aprovacao: "reprovado" }, { data_entrada: D2, aprovacao: null }]) {
        expect(txt(await salvar(c, U_ED, s.modelo, [
          { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ id: r1.id, data_saida: D1, ...mud })] },
        ], { tentativas: { [r1.id]: r1.rev } }))).toBe("P0001 peca_teste_historico: tentativa reprovada e so leitura");
      }
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ id: r1.id, data_saida: D1, data_entrada: D2, aprovacao: "reprovado" })] },
      ], { tentativas: { [r1.id]: r1.rev } }))).toBe("PASSOU");
      // nº 3 direto (a próxima é a 2) = P0409; nº 2 com saída grava
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ numero: 3, data_saida: D1 })] },
      ]))).toBe(CONFLITO);
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ numero: 2, data_saida: "2026-10-06" })] },
      ]))).toBe("PASSOU");
      const lista = await tentativas(c, s.linhaA);
      expect(lista.map((x) => [x.numero, x.aprovacao, x.data_saida])).toEqual([[1, "reprovado", D1], [2, null, "2026-10-06"]]);
      // outra pessoa já criou a nº 2 (a tela ainda achava virtual) = P0409; nº 3 enquanto a 2 não foi reprovada = P0409
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ numero: 2, data_saida: D1 })] },
      ]))).toBe(CONFLITO);
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ numero: 3, data_saida: D1 })] },
      ]))).toBe(CONFLITO);
      // reprovar a nº 2 E lançar a nº 3 no MESMO Salvar (a nova primeiro no payload: o servidor processa as existentes antes)
      const t2 = lista[1];
      expect(txt(await salvar(c, U_ED, s.modelo, [
        {
          mo_linha_id: s.linhaA,
          categoria_id: s.catA,
          tentativas: [
            tp({ numero: 3, data_saida: "2026-10-09" }),
            tp({ id: t2.id, data_saida: "2026-10-06", data_entrada: "2026-10-08", aprovacao: "reprovado" }),
          ],
        },
      ], { tentativas: { [t2.id]: t2.rev } }))).toBe("PASSOU");
      expect((await tentativas(c, s.linhaA)).map((x) => [x.numero, x.aprovacao])).toEqual([[1, "reprovado"], [2, "reprovado"], [3, null]]);
      // a leitura devolve o histórico em ordem
      expect((await ler(c, U_ED, s.modelo)).trilhas[0].tentativas.map((x: any) => x.numero)).toEqual([1, 2, 3]);
      // id de tentativa que não é da trilha (ou sumiu) = P0409
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaB, categoria_id: s.catB, tentativas: [tp({ id: t2.id, data_saida: D1 })] },
      ], { tentativas: { [t2.id]: 0 } }))).toBe(CONFLITO);
    });
  });

  it("5) rev: _rev_base velho = P0409 peca_teste_conflito e NADA gravado (nem tentativa nem fornecedor)", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaB, categoria_id: s.catB, tentativas: [tp({ numero: 1, data_saida: D1 })] },
      ]))).toBe("PASSOU");
      const t = (await tentativas(c, s.linhaB))[0];
      // outra pessoa salvou (rev + 1)
      expect(txt(await salvar(c, SUPER, s.modelo, [
        { mo_linha_id: s.linhaB, categoria_id: s.catB, tentativas: [tp({ id: t.id, data_saida: "2026-10-02" })] },
      ], { tentativas: { [t.id]: t.rev } }))).toBe("PASSOU");
      const depois = await tentativas(c, s.linhaB);
      // o meu Salvar com a base velha: tentativa + troca de fornecedor da linha B
      const r = await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaB, categoria_id: s.catB, empresa_id: s.f1, tentativas: [tp({ id: t.id, data_saida: "2026-10-07" })] },
      ], { tentativas: { [t.id]: t.rev }, fornecedor: { [s.linhaB]: s.f2 } });
      expect(txt(r)).toBe(CONFLITO);
      expect(await tentativas(c, s.linhaB)).toEqual(depois);
      expect((await linhaMo(c, s.linhaB)).empresa_id).toBe(s.f2);
      // base sem a tentativa = P0409 também (nunca grava às cegas)
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaB, categoria_id: s.catB, tentativas: [tp({ id: t.id, data_saida: "2026-10-07" })] },
      ]))).toBe(CONFLITO);
    });
  });

  it("6) fornecedor: troca com base certa muda a linha E a reabre na MESMA txn (flag do card cai), sem aprovar M.O. nem ver custos; CAS idempotente; inválido = P0001", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      // todas as linhas aprovadas -> flag do card = true
      await jwt(c, SUPER);
      await c.query("UPDATE public.modelo_servico_mo SET aprovado = true WHERE modelo_id = $1", [s.modelo]);
      await jwt(c, null);
      const flag = async () =>
        (await um<{ f: boolean }>(c, "SELECT custo_terceirizados_aprovado AS f FROM public.modelos WHERE id = $1", [s.modelo])).f;
      expect(await flag()).toBe(true);
      // U_ED não aprova M.O. nem vê custos (P-325 A: mesmo assim troca)
      const pode = await como(c, U_ED, `SELECT public.user_can_edit('producao_servico_aprovacao') AS a, public.user_can_view('criacao_planejamento:custos') AS v`);
      expect(pode.ok && pode.rows[0]).toEqual({ a: false, v: false });
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, empresa_id: s.f2, tentativas: [] },
      ], { fornecedor: { [s.linhaA]: s.f1 } }))).toBe("PASSOU");
      expect(await linhaMo(c, s.linhaA)).toMatchObject({ empresa_id: s.f2, aprovado: null, motivo: null });
      expect(await flag()).toBe(false);
      const lido = await ler(c, U_ED, s.modelo);
      expect([lido.trilhas[0].empresa_id, lido.trilhas[0].mo_aprovado]).toEqual([s.f2, null]);
      // base velha (F1) e atual (F2) != pedido (F1) = P0409
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, empresa_id: s.f1, tentativas: [] },
      ], { fornecedor: { [s.linhaA]: s.f1 } }))).toBe(CONFLITO);
      // atual = pedido (o Salvar da M.O. já gravou): no-op sem erro, mesmo com a base velha
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, empresa_id: s.f2, tentativas: [] },
      ], { fornecedor: { [s.linhaA]: s.f1 } }))).toBe("PASSOU");
      // fornecedor de MATERIAL / de OUTRA loja = P0001
      for (const f of [s.fMat, s.fOutra, "00000000-5e9a-4054-8000-00000000dead"]) {
        expect(txt(await salvar(c, U_ED, s.modelo, [
          { mo_linha_id: s.linhaA, categoria_id: s.catA, empresa_id: f, tentativas: [] },
        ], { fornecedor: { [s.linhaA]: s.f2 } }))).toMatch(/^P0001 peca_teste_fornecedor_invalido: /);
      }
      // troca sem a base do fornecedor = P0001 formato (a tela sempre manda)
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, empresa_id: s.f1, tentativas: [] },
      ], { fornecedor: {} }))).toMatch(/^P0001 peca_teste_formato: /);
      // tirar o fornecedor (vazio) vale
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, empresa_id: null, tentativas: [] },
      ], { fornecedor: { [s.linhaA]: s.f2 } }))).toBe("PASSOU");
      expect((await linhaMo(c, s.linhaA)).empresa_id).toBeNull();
      // revisão T2, achado 3 (ruling): decidir com a linha SEM fornecedor é RECUSADO (nada gravado)
      for (const aprovacao of ["aprovado", "reprovado"]) {
        expect(txt(await salvar(c, U_ED, s.modelo, [
          { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_saida: D1, data_entrada: D2, aprovacao })] },
        ]))).toMatch(/^P0001 peca_teste_sem_fornecedor: /);
      }
      expect(await tentativas(c, s.linhaA)).toEqual([]);
      // em teste (sem decisão) segue valendo sem fornecedor
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_saida: D1 })] },
      ]))).toBe("PASSOU");
    });
  });

  it("7) trava: atual aprovada + troca no mesmo payload = P0001; aprovar E trocar juntos = P0001; desfazer + trocar juntos passa; Salvar da M.O. = P0001", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const TRAVADO = "P0001 peca_teste_fornecedor_travado: peca teste aprovada trava o fornecedor";
      // aprovar e trocar no MESMO payload: a decisão congela o fornecedor de ANTES da troca -> a trava morde
      expect(txt(await salvar(c, U_ED, s.modelo, [
        {
          mo_linha_id: s.linhaA,
          categoria_id: s.catA,
          empresa_id: s.f2,
          tentativas: [tp({ numero: 1, data_saida: D1, data_entrada: D2, aprovacao: "aprovado" })],
        },
      ], { fornecedor: { [s.linhaA]: s.f1 } }))).toBe(TRAVADO);
      expect(await tentativas(c, s.linhaA)).toEqual([]);
      const t1 = await aprovaA(c, s);
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, empresa_id: s.f2, tentativas: [] },
      ], { fornecedor: { [s.linhaA]: s.f1 } }))).toBe(TRAVADO);
      // Salvar da M.O. (super admin: edita o Planejamento e vê custos) trocando o fornecedor da linha com peça aprovada = P0001 (gatilho)
      const linhasMo = (
        await c.query("SELECT id, categoria_terceirizado_id AS cat, valor, empresa_id FROM public.modelo_servico_mo WHERE modelo_id = $1", [s.modelo])
      ).rows.map((l) => ({ id: l.id, categoria_terceirizado_id: l.cat, valor: Number(l.valor), observacoes: null, empresa_id: l.id === s.linhaA ? s.f2 : l.empresa_id }));
      expect(txt(await como(c, SUPER, "SELECT public.salvar_modelo_servico_mo($1, $2::jsonb)", [s.modelo, JSON.stringify(linhasMo)]))).toBe(TRAVADO);
      // desfazer a aprovação + trocar no MESMO payload: passa (a tentativa volta a "em teste" e a linha muda)
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, empresa_id: s.f2, tentativas: [tp({ id: t1.id, data_saida: D1, data_entrada: D2 })] },
      ], { tentativas: { [t1.id]: t1.rev }, fornecedor: { [s.linhaA]: s.f1 } }))).toBe("PASSOU");
      expect((await tentativas(c, s.linhaA))[0]).toMatchObject({ aprovacao: null, empresa_id: null, decidido: false });
      expect((await linhaMo(c, s.linhaA)).empresa_id).toBe(s.f2);
      // reprovar + trocar no MESMO payload: a reprovada guarda o fornecedor de ANTES (F2) e a linha vai para F1
      const t1b = (await tentativas(c, s.linhaA))[0];
      expect(txt(await salvar(c, U_ED, s.modelo, [
        {
          mo_linha_id: s.linhaA,
          categoria_id: s.catA,
          empresa_id: s.f1,
          tentativas: [tp({ id: t1b.id, data_saida: D1, data_entrada: D2, aprovacao: "reprovado" })],
        },
      ], { tentativas: { [t1b.id]: t1b.rev }, fornecedor: { [s.linhaA]: s.f2 } }))).toBe("PASSOU");
      expect((await tentativas(c, s.linhaA))[0]).toMatchObject({ aprovacao: "reprovado", empresa_id: s.f2 });
      expect((await linhaMo(c, s.linhaA)).empresa_id).toBe(s.f1);
    });
  });

  it("7b) achado 1 da revisão T1 — contorno pela troca de TIPO ida-e-volta: a aprovada antiga NÃO vale para o fornecedor novo", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await aprovaA(c, s);
      expect(await aprovadaHelper(c, s.linhaA)).toBe(true);
      // tipo A -> C (trilha nova, nada travado) -> troca F1 -> F2 -> tipo C -> A: a tentativa 1 APROVADA volta a ser a atual da trilha A
      await c.query("UPDATE public.modelo_servico_mo SET categoria_terceirizado_id = $2 WHERE id = $1", [s.linhaA, s.catC]);
      await c.query("UPDATE public.modelo_servico_mo SET empresa_id = $2 WHERE id = $1", [s.linhaA, s.f2]);
      await c.query("UPDATE public.modelo_servico_mo SET categoria_terceirizado_id = $2 WHERE id = $1", [s.linhaA, s.catA]);
      expect((await tentativas(c, s.linhaA))[0]).toMatchObject({ aprovacao: "aprovado", empresa_id: s.f1 });
      expect(await aprovadaHelper(c, s.linhaA)).toBe(false);
      const t = (await ler(c, U_ED, s.modelo)).trilhas[0];
      expect([t.empresa_id, t.aprovada, t.tentativas[0].empresa_id]).toEqual([s.f2, false, s.f1]);
      // quadro: a trilha NÃO aparece como aprovada (nem o card, que só tem ela "decidida")
      const q = await quadro(c, U_ETP);
      expect(q.ok && (q.rows[0].r as any[]).find((x) => x.modelo_id === s.modelo)).toBeFalsy();
      // a trava não morde a aprovada "de outro fornecedor": voltar a F1 é permitido — e aí a aprovada volta a valer
      await c.query("UPDATE public.modelo_servico_mo SET empresa_id = $2 WHERE id = $1", [s.linhaA, s.f1]);
      expect(await aprovadaHelper(c, s.linhaA)).toBe(true);
      const e = await falha(c, "UPDATE public.modelo_servico_mo SET empresa_id = $2 WHERE id = $1", [s.linhaA, s.f2]);
      expect([e.code, e.message]).toEqual(["P0001", "peca_teste_fornecedor_travado: peca teste aprovada trava o fornecedor"]);
    });
  });

  it("7c) achado 1 da revisão T1 — contorno pelo switch desliga/liga: a aprovada antiga NÃO vale para o fornecedor novo", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await aprovaA(c, s);
      await c.query("UPDATE public.categorias_terceirizado SET exige_peca_teste = false WHERE id = $1", [s.catA]);
      await c.query("UPDATE public.modelo_servico_mo SET empresa_id = $2 WHERE id = $1", [s.linhaA, s.f2]);
      await c.query("UPDATE public.categorias_terceirizado SET exige_peca_teste = true WHERE id = $1", [s.catA]);
      expect(await aprovadaHelper(c, s.linhaA)).toBe(false);
      const t = (await ler(c, U_ED, s.modelo)).trilhas[0];
      expect([t.mo_linha_id, t.empresa_id, t.aprovada]).toEqual([s.linhaA, s.f2, false]);
      const q = await quadro(c, U_ETP);
      expect(q.ok && (q.rows[0].r as any[]).find((x) => x.modelo_id === s.modelo)).toBeFalsy();
      // a peça "de outro fornecedor" pode ser reprovada (histórico com o fornecedor que a fez) e a próxima nasce
      const t1 = (await tentativas(c, s.linhaA))[0];
      expect(txt(await salvar(c, U_ED, s.modelo, [
        {
          mo_linha_id: s.linhaA,
          categoria_id: s.catA,
          tentativas: [tp({ id: t1.id, data_saida: D1, data_entrada: D2, aprovacao: "reprovado" }), tp({ numero: 2, data_saida: "2026-10-08" })],
        },
      ], { tentativas: { [t1.id]: t1.rev } }))).toBe("PASSOU");
      expect((await tentativas(c, s.linhaA)).map((x) => [x.numero, x.aprovacao, x.empresa_id])).toEqual([[1, "reprovado", s.f1], [2, null, null]]);
    });
  });

  it("14) revisão T2, achado 1 — ABA VELHA: o fornecedor mudou pelo Salvar da M.O. depois da leitura → aprovar/reprovar = P0409 e NADA gravado", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_saida: D1 })] },
      ]))).toBe("PASSOU");
      const t1 = (await tentativas(c, s.linhaA))[0];
      // outra pessoa troca o fornecedor da linha F1 -> F2 pelo Salvar da M.O. (core, com a chave do card); a tentativa NÃO muda
      await jwt(c, SUPER);
      const linhasMo = (
        await c.query("SELECT id, categoria_terceirizado_id AS cat, valor, empresa_id FROM public.modelo_servico_mo WHERE modelo_id = $1", [s.modelo])
      ).rows.map((l) => ({ id: l.id, categoria_terceirizado_id: l.cat, valor: Number(l.valor), observacoes: null, empresa_id: l.id === s.linhaA ? s.f2 : l.empresa_id }));
      await c.query("SELECT public._salvar_modelo_servico_mo_core($1, $2::jsonb)", [s.modelo, JSON.stringify(linhasMo)]);
      await jwt(c, null);
      expect((await tentativas(c, s.linhaA))[0].rev).toBe(t1.rev);
      // a aba velha (viu F1) aprova / reprova, sem a chave empresa_id
      for (const aprovacao of ["aprovado", "reprovado"]) {
        expect(txt(await salvar(c, U_ED, s.modelo, [
          { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ id: t1.id, data_saida: D1, data_entrada: D2, aprovacao })] },
        ], { tentativas: { [t1.id]: t1.rev }, fornecedor: { [s.linhaA]: s.f1 } }))).toBe(CONFLITO);
      }
      expect(await tentativas(c, s.linhaA)).toEqual([t1]);
      expect(await aprovadaHelper(c, s.linhaA)).toBe(false);
      // decisão SEM a base do fornecedor = P0001 formato (nunca decide às cegas)
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ id: t1.id, data_saida: D1, data_entrada: D2, aprovacao: "aprovado" })] },
      ], { tentativas: { [t1.id]: t1.rev }, fornecedor: {} }))).toMatch(/^P0001 peca_teste_formato: /);
      // relida a seção (base = F2), a aprovação passa e congela F2 — o que a pessoa viu
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ id: t1.id, data_saida: D1, data_entrada: D2, aprovacao: "aprovado" })] },
      ], { tentativas: { [t1.id]: t1.rev }, fornecedor: { [s.linhaA]: s.f2 } }))).toBe("PASSOU");
      expect((await tentativas(c, s.linhaA))[0]).toMatchObject({ aprovacao: "aprovado", empresa_id: s.f2 });
    });
  });

  it("15) revisão T2, achado 2 — aprovar + trocar no MESMO Salvar com a M.O. gravando ANTES: P0001 travado (como pela Peça Teste só); reprovar congela o de antes", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_saida: D1 })] },
      ]))).toBe("PASSOU");
      const t1 = (await tentativas(c, s.linhaA))[0];
      const moTroca = async () => {
        await jwt(c, SUPER);
        const linhasMo = (
          await c.query("SELECT id, categoria_terceirizado_id AS cat, valor, empresa_id FROM public.modelo_servico_mo WHERE modelo_id = $1", [s.modelo])
        ).rows.map((l) => ({ id: l.id, categoria_terceirizado_id: l.cat, valor: Number(l.valor), observacoes: null, empresa_id: l.id === s.linhaA ? s.f2 : l.empresa_id }));
        await c.query("SELECT public._salvar_modelo_servico_mo_core($1, $2::jsonb)", [s.modelo, JSON.stringify(linhasMo)]);
        await jwt(c, null);
      };
      const payload = (aprovacao: string): TrilhaPayload[] => [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, empresa_id: s.f2, tentativas: [tp({ id: t1.id, data_saida: D1, data_entrada: D2, aprovacao })] },
      ];
      const base = { tentativas: { [t1.id]: t1.rev }, fornecedor: { [s.linhaA]: s.f1 } };
      const TRAVADO = "P0001 peca_teste_fornecedor_travado: peca teste aprovada trava o fornecedor";
      // rota 1: só pela Peça Teste
      expect(txt(await salvar(c, U_ED, s.modelo, payload("aprovado"), base))).toBe(TRAVADO);
      // rota 2: a etapa da M.O. do Sheet grava a troca ANTES; o MESMO payload da Peça Teste = o MESMO P0001
      await c.query("SAVEPOINT r9b_15");
      await moTroca();
      expect(txt(await salvar(c, U_ED, s.modelo, payload("aprovado"), base))).toBe(TRAVADO);
      expect(await tentativas(c, s.linhaA)).toEqual([t1]);
      // reprovar + trocar com a M.O. antes: passa e a reprovada guarda F1 (quem fez a peça), igual à rota só pela Peça Teste
      expect(txt(await salvar(c, U_ED, s.modelo, payload("reprovado"), base))).toBe("PASSOU");
      expect((await tentativas(c, s.linhaA))[0]).toMatchObject({ aprovacao: "reprovado", empresa_id: s.f1 });
      await c.query("ROLLBACK TO SAVEPOINT r9b_15");
      expect(txt(await salvar(c, U_ED, s.modelo, payload("reprovado"), base))).toBe("PASSOU");
      expect((await tentativas(c, s.linhaA))[0]).toMatchObject({ aprovacao: "reprovado", empresa_id: s.f1 });
      expect((await linhaMo(c, s.linhaA)).empresa_id).toBe(s.f2);
    });
  });

  it("16) revisão T2, achado 8 — reprovar pela cadeia 'M.O. primeiro' só congela base = fornecedor de SERVIÇO da loja (material/outra loja/inexistente = P0001, nada gravado)", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_saida: D1 })] },
      ]))).toBe("PASSOU");
      const t1 = (await tentativas(c, s.linhaA))[0];
      // a etapa da M.O. do Sheet grava a troca F1 -> F2 ANTES (a linha já está em F2; a tela manda a base que ela leu)
      await jwt(c, SUPER);
      const linhasMo = (
        await c.query("SELECT id, categoria_terceirizado_id AS cat, valor, empresa_id FROM public.modelo_servico_mo WHERE modelo_id = $1", [s.modelo])
      ).rows.map((l) => ({ id: l.id, categoria_terceirizado_id: l.cat, valor: Number(l.valor), observacoes: null, empresa_id: l.id === s.linhaA ? s.f2 : l.empresa_id }));
      await c.query("SELECT public._salvar_modelo_servico_mo_core($1, $2::jsonb)", [s.modelo, JSON.stringify(linhasMo)]);
      await jwt(c, null);
      expect((await linhaMo(c, s.linhaA)).empresa_id).toBe(s.f2);
      const reprovar = (base: string) =>
        salvar(c, U_ED, s.modelo, [
          { mo_linha_id: s.linhaA, categoria_id: s.catA, empresa_id: s.f2, tentativas: [tp({ id: t1.id, data_saida: D1, data_entrada: D2, aprovacao: "reprovado" })] },
        ], { tentativas: { [t1.id]: t1.rev }, fornecedor: { [s.linhaA]: base } });
      const INVALIDO = "P0001 peca_teste_fornecedor_invalido: fornecedor de servico invalido";
      expect(txt(await reprovar(s.fMat)), "empresa de MATERIAL da loja").toBe(INVALIDO);
      expect(txt(await reprovar(s.fOutra)), "fornecedor de OUTRA loja").toBe(INVALIDO);
      expect(txt(await reprovar("5e9a0054-0000-4000-8000-00000000dead")), "inexistente").toBe(INVALIDO);
      expect(await tentativas(c, s.linhaA), "nada gravado").toEqual([t1]);
      // base = fornecedor de serviço da loja (o de antes): passa e congela o de antes, como no teste 15
      expect(txt(await reprovar(s.f1))).toBe("PASSOU");
      expect((await tentativas(c, s.linhaA))[0]).toMatchObject({ aprovacao: "reprovado", empresa_id: s.f1 });
    });
  });

  it("8) desatualizada: tipo da linha trocado por outra pessoa / switch desligado / linha apagada = P0409 peca_teste_desatualizada", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const payload: TrilhaPayload[] = [{ mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_saida: D1 })] }];
      await c.query("SAVEPOINT r9b_d");
      await c.query("UPDATE public.modelo_servico_mo SET categoria_terceirizado_id = $2 WHERE id = $1", [s.linhaA, s.catB]);
      expect(txt(await salvar(c, U_ED, s.modelo, payload))).toBe(DESATUALIZADA);
      await c.query("ROLLBACK TO SAVEPOINT r9b_d");
      await c.query("UPDATE public.categorias_terceirizado SET exige_peca_teste = false WHERE id = $1", [s.catA]);
      expect(txt(await salvar(c, U_ED, s.modelo, payload))).toBe(DESATUALIZADA);
      await c.query("ROLLBACK TO SAVEPOINT r9b_d");
      await c.query("DELETE FROM public.modelo_servico_mo WHERE id = $1", [s.linhaA]);
      expect(txt(await salvar(c, U_ED, s.modelo, payload))).toBe(DESATUALIZADA);
      await c.query("ROLLBACK TO SAVEPOINT r9b_d");
      // linha de OUTRO card / tipo que nunca exigiu = P0409 (não grava às cegas)
      expect(txt(await salvar(c, U_ED, s.modelo, [{ mo_linha_id: s.linhaC, categoria_id: s.catC, tentativas: [] }]))).toBe(DESATUALIZADA);
      expect(await tentativas(c, s.linhaA)).toEqual([]);
    });
  });

  it("9) permissão: sem EDITAR a seção = 42501 sem_permissao_pagina (Leitor lê e não grava); sem login = 42501", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const p: TrilhaPayload[] = [{ mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_saida: D1 })] }];
      for (const u of [U_LE, U_SEM, U_ETP]) {
        expect(txt(await salvar(c, u, s.modelo, p)), u).toBe(`42501 sem_permissao_pagina: ${SEC}`);
      }
      expect((await ler(c, U_LE, s.modelo)).trilhas).toHaveLength(2);
      expect(txt(await salvar(c, null, s.modelo, p))).toBe("42501 peca_teste_sem_login: nao autenticado");
      expect(await tentativas(c, s.linhaA)).toEqual([]);
      // admin da loja / super admin passam (furam como user_can_edit)
      expect(txt(await salvar(c, SUPER, s.modelo, p))).toBe("PASSOU");
    });
  });

  it("10) quadro: em teste e aprovada (explodido) aparecem; reprovada/virtual e lançado não; sem Etapas = []; etapas_pl desligado = 42501", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      // M1 = o card do cenário: trilha A em teste (só saída)
      await semJwt(c, () =>
        comoSistema(c, () =>
          c.query("UPDATE public.modelos SET ref = $2, colecao = 'Verao R9b', fotos_modelo = ARRAY['x/a.jpg'] WHERE id = $1", [s.modelo, `R9B${s.suf}`]),
        ),
      );
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_saida: D1 })] },
      ]))).toBe("PASSOU");
      // M2: aprovada + CAD enviado ao corte
      const m2 = await novoModelo(c, T, `M2 R9b ${s.suf}`);
      const l2 = await novaLinha(c, m2, s.catA, s.f1, 10);
      expect(txt(await salvar(c, U_ED, m2, [
        { mo_linha_id: l2, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_saida: D1, data_entrada: D2, aprovacao: "aprovado" })] },
      ]))).toBe("PASSOU");
      await semJwt(c, () => c.query("INSERT INTO public.cad (modelo_id, tenant_id, enviado_corte) VALUES ($1, $2, true)", [m2, T]));
      // M3: atual reprovada (a próxima é virtual, sem saída) — não aparece
      const m3 = await novoModelo(c, T, `M3 R9b ${s.suf}`);
      const l3 = await novaLinha(c, m3, s.catA, s.f1, 10);
      expect(txt(await salvar(c, U_ED, m3, [
        { mo_linha_id: l3, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_saida: D1, data_entrada: D2, aprovacao: "reprovado" })] },
      ]))).toBe("PASSOU");
      // M4: em teste, mas LANÇADO — não aparece
      const m4 = await novoModelo(c, T, `M4 R9b ${s.suf}`);
      const l4 = await novaLinha(c, m4, s.catA, s.f1, 10);
      expect(txt(await salvar(c, U_ED, m4, [
        { mo_linha_id: l4, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_saida: D1 })] },
      ]))).toBe("PASSOU");
      await semJwt(c, () => comoSistema(c, () => c.query("UPDATE public.modelos SET lancado = true WHERE id = $1", [m4])));
      // M6: em teste, mas o CARD está Reprovado (Dev ou Planejamento) — não aparece (revisão T2, achado 6)
      const reprovados: string[] = [];
      for (const col of ["status_desenvolvimento", "status_planejamento"]) {
        const m6 = await novoModelo(c, T, `M6 ${col} R9b ${s.suf}`);
        const l6 = await novaLinha(c, m6, s.catA, s.f1, 10);
        expect(txt(await salvar(c, U_ED, m6, [
          { mo_linha_id: l6, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_saida: D1 })] },
        ]))).toBe("PASSOU");
        await semJwt(c, () => comoSistema(c, () => c.query(`UPDATE public.modelos SET ${col} = 'reprovado' WHERE id = $1`, [m6])));
        reprovados.push(m6);
      }
      // M5: tentativa só com data de ENTRADA (sem saída) = não está em teste
      const m5 = await novoModelo(c, T, `M5 R9b ${s.suf}`);
      const l5 = await novaLinha(c, m5, s.catA, s.f1, 10);
      expect(txt(await salvar(c, U_ED, m5, [
        { mo_linha_id: l5, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_entrada: D2 })] },
      ]))).toBe("PASSOU");

      const q = await quadro(c, U_ETP);
      expect(txt(q)).toBe("PASSOU");
      const itens = (q.ok ? (q.rows[0].r as any[]) : []).filter((x) => [s.modelo, m2, m3, m4, m5, ...reprovados].includes(x.modelo_id));
      expect(itens.map((x) => x.modelo_id).sort()).toEqual([s.modelo, m2].sort());
      const i1 = itens.find((x) => x.modelo_id === s.modelo);
      expect(i1).toEqual({
        modelo_id: s.modelo,
        ref: `R9B${s.suf}`,
        nome: `M R9b ${s.suf}`,
        origem: "interno",
        colecao: "Verao R9b",
        fotos_fontes: ["x/a.jpg", null, null],
        explodido: false,
        trilhas: [
          { categoria_nome: `PL R9b ${s.suf}`, empresa_nome: `Oficina R9b 1 ${s.suf}`, status: "em_teste", data_saida: D1 },
          // a outra trilha que exige (Bordado) vem com status "pendente": o front decide "aprovada só se todas" (Ruling 20)
          { categoria_nome: `Bordado R9b ${s.suf}`, empresa_nome: `Oficina R9b 2 ${s.suf}`, status: "pendente", data_saida: null },
        ],
      });
      const i2 = itens.find((x) => x.modelo_id === m2);
      expect([i2.explodido, i2.trilhas]).toEqual([
        true,
        [{ categoria_nome: `PL R9b ${s.suf}`, empresa_nome: `Oficina R9b 1 ${s.suf}`, status: "aprovada", data_saida: D1 }],
      ]);
      expect(JSON.stringify(itens)).not.toMatch(/"valor"/);
      // sem ver Etapas = []; etapas_pl desligado = 42501
      const semEtapas = await quadro(c, U_ED);
      expect(semEtapas.ok && semEtapas.rows[0].r).toEqual([]);
      await modulo(c, "etapas_pl", false);
      expect(txt(await quadro(c, U_ETP))).toBe("42501 modulo_desligado: etapas_pl");
    });
  });

  it("12) ACL: 3 wrappers só authenticated (sem anon/PUBLIC); 3 cores + helper + trava com ACL de core; core direto como authenticated = 42501", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      for (const sig of WRAPPERS) {
        expect(await aclN(c, sig), sig).toBe(ACL_WRAP_N);
      }
      for (const sig of [...CORES, HELPER, TRAVA]) {
        expect(await aclN(c, sig), sig).toBe(ACL_CORE_N);
      }
      for (const sig of [...NOVAS, TRAVA]) {
        const f = await um<{ sd: boolean; cfg: string; anon: boolean; pub: boolean }>(
          c,
          `SELECT p.prosecdef AS sd, array_to_string(p.proconfig, '|') AS cfg, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                  EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0) AS pub
             FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
          [sig],
        );
        expect(f, sig).toEqual({ sd: true, cfg: "search_path=public", anon: false, pub: false });
      }
      const direto = [
        ["SELECT public._peca_teste_trilhas_core($1, $2)", [T, s.modelo]],
        ["SELECT public._salvar_peca_teste_core($1, '[]'::jsonb, '{}'::jsonb)", [s.modelo]],
        ["SELECT public._peca_teste_quadro_core($1)", [T]],
        ["SELECT public._peca_teste_aprovada($1, $2, $3)", [s.linhaA, s.catA, s.f1]],
      ] as const;
      for (const [sql, p] of direto) {
        const r = await como(c, SUPER, sql, [...p]);
        expect(r.ok ? "PASSOU" : r.code, sql).toBe("42501");
      }
      // anon não executa nem os wrappers
      await c.query("SAVEPOINT r9b_anon");
      await c.query("SET LOCAL ROLE anon");
      const e = await falha(c, "SELECT public.peca_teste_modelo($1)", [s.modelo]);
      await c.query("ROLLBACK TO SAVEPOINT r9b_anon");
      expect(e.code).toBe("42501");
    });
  });

  it("13) volta: _down NEUTRO (trava no texto da r9a, wrappers no texto neutro e sem EXECUTE do authenticated); _down 2× no-op; ida 2× mesmos md5; r9a _down recusa com a r9b viva", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      expect(await urgcViva(c, "r9b")).toBe(true);
      // LIFO: o _down da 192000 recusa enquanto a 193000 está viva (a trava não está no texto dela)
      expect((await falha(c, readSemTxn(BLOCO_A!.down))).message).toMatch(/urg_r9a_down: .*fn_peca_teste_trava_fornecedor/);
      const confereVolta = async () => {
        expect(await urgcViva(c, "r9b")).toBe(false);
        expect(await urgcViva(c, "r9a")).toBe(true);
        expect(await md5Fn(c, TRAVA)).toBe(BLOCO!.URGC_MD5[TRAVA].antes);
        for (const [sig, m] of Object.entries(BLOCO!.URGC_NOVAS!)) {
          // wrappers e o core do quadro: texto NEUTRO (não cita os portões nem o rótulo da coleção — libera os _down_drop da
          // Modularidade T1/T3 e da S3a); os outros cores: o mesmo texto
          expect(await md5Fn(c, sig), sig).toBe(BLOCO!.URGC_NEUTRAS?.[sig] ?? m);
          expect(await aclN(c, sig), sig).toBe(ACL_CORE_N);
        }
        expect(Object.keys(BLOCO!.URGC_NEUTRAS ?? {}).sort()).toEqual([...WRAPPERS, CORES[2]].sort());
        const citam = await um<{ n: number }>(
          c,
          `SELECT count(*)::int AS n FROM pg_proc p WHERE p.oid = ANY ($1::regprocedure[])
              AND p.prosrc ~ '(_exige_modulos|_seg_exige_pagina|_modelo_colecao_rotulo|user_can_view|modelo_peca_teste_tentativas)'`,
          [[...WRAPPERS, CORES[2]]],
        );
        expect(citam.n).toBe(0);
      };
      await aplicarArquivo(c, BLOCO!.down);
      await confereVolta();
      expect(txt(await salvar(c, U_ED, s.modelo, []))).toMatch(/^42501 permission denied for function salvar_peca_teste/);
      await aplicarArquivo(c, BLOCO!.down); // 2× = no-op
      await confereVolta();
      for (let i = 0; i < 2; i++) {
        await aplicarArquivo(c, BLOCO!.mig);
        await c.query("SET LOCAL transaction_timeout = 0");
        expect(await urgcViva(c, "r9b")).toBe(true);
        expect(await md5Fn(c, TRAVA)).toBe(BLOCO!.URGC_MD5[TRAVA].depois);
        for (const [sig, m] of Object.entries(BLOCO!.URGC_NOVAS!)) expect(await md5Fn(c, sig), sig).toBe(m);
        for (const sig of WRAPPERS) expect(await aclN(c, sig), sig).toBe(ACL_WRAP_N);
      }
      expect(txt(await salvar(c, U_ED, s.modelo, [
        { mo_linha_id: s.linhaA, categoria_id: s.catA, tentativas: [tp({ numero: 1, data_saida: D1 })] },
      ]))).toBe("PASSOU");
      // voltaUrgc (LIFO) tira a r9b e depois a r9a
      await voltaUrgc(c);
      expect([await urgcViva(c, "r9b"), await urgcViva(c, "r9a")]).toEqual([false, false]);
      await aplicaUrgc(c);
      expect([await urgcViva(c, "r9a"), await urgcViva(c, "r9b")]).toEqual([true, true]);
    });
  });

  it("13b) _down_drop: recusa com a ida viva e com função citando as novas; com o _down rodado apaga as 7; 2× no-op; ida recria", async () => {
    await withTx(async (c) => {
      await prepara(c);
      expect((await falha(c, readSemTxn(BLOCO!.drop))).message).toMatch(/urg_r9b_down_drop: .*_down antes/);
      await aplicarArquivo(c, BLOCO!.down);
      await c.query(
        "CREATE FUNCTION public._r9b_teste_cita() RETURNS boolean LANGUAGE sql AS $$ SELECT public._peca_teste_aprovada(NULL, NULL, NULL) $$",
      );
      expect((await falha(c, readSemTxn(BLOCO!.drop))).message).toMatch(/_r9b_teste_cita/);
      await c.query("DROP FUNCTION public._r9b_teste_cita()");
      await aplicarArquivo(c, BLOCO!.drop);
      for (const sig of NOVAS) expect(await md5Fn(c, sig), sig).toBeNull();
      expect(await md5Fn(c, TRAVA)).toBe(BLOCO!.URGC_MD5[TRAVA].antes);
      await aplicarArquivo(c, BLOCO!.drop); // 2× = no-op
      // a r9a pode sair inteira agora (LIFO dos drops)
      await aplicarArquivo(c, BLOCO_A!.down);
      await c.query("SET LOCAL app.confirmo_apagar_peca_teste = 'sim'");
      await aplicarArquivo(c, BLOCO_A!.drop);
      await c.query("SET LOCAL app.confirmo_apagar_peca_teste = ''");
      expect((await um<{ ok: boolean }>(c, "SELECT to_regclass($1) IS NULL AS ok", [TAB])).ok).toBe(true);
      // ida das duas de novo
      await aplicaUrgc(c);
      expect([await urgcViva(c, "r9a"), await urgcViva(c, "r9b")]).toEqual([true, true]);
      for (const [sig, m] of Object.entries(BLOCO!.URGC_NOVAS!)) expect(await md5Fn(c, sig), sig).toBe(m);
    });
  });
});

// ───────────── 11) ordem de trava com 2 conexões reais (as duas revertidas) ─────────────
describe.skipIf(!RODA)("urg R9b — ordem de trava: Salvar da Peça Teste × aprovar M.O. / Salvar da M.O. / Enviar à Explosão", () => {
  async function abre(): Promise<{ x: Client; pid: number }> {
    const x = new Client({ connectionString: dbUrl()!, ssl: false });
    await x.connect();
    await x.query("BEGIN");
    await x.query("SET LOCAL lock_timeout = '15s'");
    await x.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: SUPER, role: "authenticated" })]);
    await x.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2 AND tenant_id IS DISTINCT FROM $1", [T, SUPER]);
    const pid = (await um<{ p: number }>(x, "SELECT pg_backend_pid() AS p")).p;
    return { x, pid };
  }
  async function fecha(...xs: Client[]): Promise<void> {
    for (const x of xs) {
      await x.query("ROLLBACK").catch(() => {});
      await x.end().catch(() => {});
    }
  }
  async function esperaAdvisory(obs: Client, p: number): Promise<boolean> {
    for (let i = 0; i < 100; i++) {
      const w = await um<{ n: number }>(obs, "SELECT count(*)::int AS n FROM pg_locks WHERE pid = $1 AND NOT granted AND locktype = 'advisory'", [p]);
      if (w.n > 0) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }
  const codigo = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? String((r.reason as { code?: string }).code) : "ok");
  async function r9bVivaNaCopia(): Promise<boolean> {
    const x = new Client({ connectionString: dbUrl()!, ssl: false });
    await x.connect();
    try {
      return await urgcViva(x, "r9b");
    } finally {
      await x.end();
    }
  }
  type Fx = { m: string; cat: string; linha: string; f1: string; f2: string };
  /** Card + tipo + linha de M.O. DESCARTÁVEIS gravados por uma 3ª conexão em `replica` (sem gatilho: nem auditoria, nem fila, nem
   * cascata) e apagados no `finally` — as 2 conexões do ensaio precisam VER o card (cada uma revertida no fim). */
  async function comFixture(fn: (f: Fx) => Promise<void>): Promise<void> {
    const s = new Client({ connectionString: dbUrl()!, ssl: false });
    await s.connect();
    const ids: Partial<Fx> = {};
    try {
      await s.query("SET session_replication_role = replica");
      const suf = Math.random().toString(36).slice(2, 8);
      ids.cat = (
        await um<{ id: string }>(
          s,
          `INSERT INTO public.categorias_terceirizado (tenant_id, nome, etapa, exige_peca_teste) VALUES ($1, $2, 'ate_costura', true) RETURNING id`,
          [T, `R9b trava descartavel ${suf}`],
        )
      ).id;
      ids.m = (
        await um<{ id: string }>(
          s,
          `INSERT INTO public.modelos (tenant_id, nome, ordem_criacao_enviada, status_desenvolvimento) VALUES ($1, $2, true, 'aprovado') RETURNING id`,
          [T, `R9b trava descartavel ${suf}`],
        )
      ).id;
      for (const k of ["f1", "f2"] as const) {
        ids[k] = (
          await um<{ id: string }>(
            s,
            `INSERT INTO public.empresas (tenant_id, nome_fantasia, tipo) VALUES ($1, $2, 'servico') RETURNING id`,
            [T, `R9b trava ${k} ${suf}`],
          )
        ).id;
      }
      ids.linha = (
        await um<{ id: string }>(
          s,
          `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, empresa_id) VALUES ($1, $2, $3, 10, $4) RETURNING id`,
          [T, ids.m, ids.cat, ids.f1],
        )
      ).id;
      await fn(ids as Fx);
    } finally {
      if (ids.linha) await s.query("DELETE FROM public.modelo_peca_teste_tentativas WHERE mo_linha_id = $1", [ids.linha]).catch(() => {});
      if (ids.linha) await s.query("DELETE FROM public.modelo_servico_mo WHERE id = $1", [ids.linha]).catch(() => {});
      if (ids.m) await s.query("DELETE FROM public.cad WHERE modelo_id = $1", [ids.m]).catch(() => {});
      if (ids.m) await s.query("DELETE FROM public.modelos WHERE id = $1", [ids.m]).catch(() => {});
      if (ids.cat) await s.query("DELETE FROM public.categorias_terceirizado WHERE id = $1", [ids.cat]).catch(() => {});
      for (const f of [ids.f1, ids.f2]) if (f) await s.query("DELETE FROM public.empresas WHERE id = $1", [f]).catch(() => {});
      await s.end();
    }
  }
  const salvarPT = (x: Client, f: Fx) =>
    x.query("SELECT public.salvar_peca_teste($1, $2::jsonb, '{}'::jsonb)", [
      f.m,
      JSON.stringify([{ mo_linha_id: f.linha, categoria_id: f.cat, tentativas: [{ id: null, numero: 1, data_saida: D1 }] }]),
    ]);
  /** Salvar da Peça Teste que TROCA o fornecedor da linha: grava M.O. (reabre) e `modelos` (rollup) — o caminho completo da R4. */
  const salvarPTTroca = (x: Client, f: Fx) =>
    x.query("SELECT public.salvar_peca_teste($1, $2::jsonb, $3::jsonb)", [
      f.m,
      JSON.stringify([{ mo_linha_id: f.linha, categoria_id: f.cat, empresa_id: f.f2, tentativas: [{ id: null, numero: 1, data_saida: D1 }] }]),
      JSON.stringify({ tentativas: {}, fornecedor: { [f.linha]: f.f1 } }),
    ]);
  const aprovar = (x: Client, f: Fx) => x.query("SELECT public._aprovar_servico_mo_core($1, $2, true, null)", [f.m, f.linha]);
  const salvarMo = (x: Client, f: Fx) =>
    x.query("SELECT public._salvar_modelo_servico_mo_core($1, $2::jsonb)", [
      f.m,
      JSON.stringify([{ id: f.linha, categoria_terceirizado_id: f.cat, valor: 12, observacoes: null }]),
    ]);
  async function prontoParaEnviar(x: Client): Promise<void> {
    await x.query("SELECT set_config('app.kanban_chave', 'rpc', true)");
    await x.query("UPDATE public.tenant_config SET kanban_automatico = false, explosao_envio_status = NULL WHERE tenant_id = $1", [T]);
    await x.query("SELECT set_config('app.kanban_chave', '', true)");
  }
  const enviar = (x: Client, f: Fx) => x.query("SELECT public._enviar_modelo_para_cad_core($1) AS cad", [f.m]);

  async function rodada(f: Fx, primeiro: (x: Client) => Promise<unknown>, segundo: (x: Client) => Promise<unknown>, prepA?: (x: Client) => Promise<void>) {
    const A = await abre();
    const B = await abre();
    try {
      if (prepA) await prepA(A.x);
      await primeiro(A.x);
      const pb = segundo(B.x);
      pb.catch(() => {});
      const esperou = await esperaAdvisory(A.x, B.pid);
      await A.x.query("ROLLBACK");
      const rb = (await Promise.allSettled([pb]))[0];
      return { esperou, b: codigo(rb) };
    } finally {
      await fecha(A.x, B.x);
    }
  }

  it("(a) salvar_peca_teste aberto × aprovar_servico_mo do mesmo card: o aprovar espera NO ADVISORY e termina sem 40P01", async (ctx) => {
    if (!(await r9bVivaNaCopia())) ctx.skip();
    await comFixture(async (f) => {
      expect(await rodada(f, (x) => salvarPT(x, f), (x) => aprovar(x, f))).toEqual({ esperou: true, b: "ok" });
    });
  }, 60000);

  it("(b) salvar_peca_teste aberto × Salvar da M.O. do mesmo card: espera no advisory, sem 40P01", async (ctx) => {
    if (!(await r9bVivaNaCopia())) ctx.skip();
    await comFixture(async (f) => {
      expect(await rodada(f, (x) => salvarPT(x, f), (x) => salvarMo(x, f))).toEqual({ esperou: true, b: "ok" });
    });
  }, 60000);

  it("(c) Enviar à Explosão aberto × salvar_peca_teste: o Salvar da Peça Teste espera no advisory, sem 40P01", async (ctx) => {
    if (!(await r9bVivaNaCopia())) ctx.skip();
    await comFixture(async (f) => {
      expect(await rodada(f, (x) => enviar(x, f), (x) => salvarPT(x, f), prontoParaEnviar)).toEqual({ esperou: true, b: "ok" });
    });
  }, 60000);

  it("(d) aprovar_servico_mo aberto × salvar_peca_teste: o Salvar da Peça Teste espera no advisory, sem 40P01", async (ctx) => {
    if (!(await r9bVivaNaCopia())) ctx.skip();
    await comFixture(async (f) => {
      expect(await rodada(f, (x) => aprovar(x, f), (x) => salvarPT(x, f))).toEqual({ esperou: true, b: "ok" });
    });
  }, 60000);

  it("(e) Peça Teste TROCANDO o fornecedor (grava M.O. e modelos) aberta × aprovar M.O.: o aprovar espera no advisory, sem 40P01", async (ctx) => {
    if (!(await r9bVivaNaCopia())) ctx.skip();
    await comFixture(async (f) => {
      expect(await rodada(f, (x) => salvarPTTroca(x, f), (x) => aprovar(x, f))).toEqual({ esperou: true, b: "ok" });
    });
  }, 60000);

  it("(f) aprovar M.O. aberto × Peça Teste TROCANDO o fornecedor: a Peça Teste espera no advisory, sem 40P01", async (ctx) => {
    if (!(await r9bVivaNaCopia())) ctx.skip();
    await comFixture(async (f) => {
      expect(await rodada(f, (x) => aprovar(x, f), (x) => salvarPTTroca(x, f))).toEqual({ esperou: true, b: "ok" });
    });
  }, 60000);

  it("o texto vivo: a chave do card vem ANTES de qualquer FOR UPDATE / escrita no _salvar_peca_teste_core", async (ctx) => {
    if (!(await r9bVivaNaCopia())) ctx.skip();
    await withTx(async (c) => {
      const d = (await um<{ d: string }>(c, "SELECT pg_get_functiondef($1::regprocedure) AS d", [CORES[1]])).d;
      const chave = d.indexOf("PERFORM pg_advisory_xact_lock(hashtext('cad:modelo_id:' || _modelo_id::text));");
      expect(chave).toBeGreaterThan(-1);
      for (const trecho of [
        "ORDER BY s.id FOR UPDATE",
        "ORDER BY t.id FOR UPDATE",
        "INSERT INTO public.modelo_peca_teste_tentativas",
        "UPDATE public.modelo_peca_teste_tentativas",
        "UPDATE public.modelo_servico_mo SET",
        "DELETE FROM public.modelo_peca_teste_tentativas",
      ]) {
        expect(d.indexOf(trecho), trecho).toBeGreaterThan(chave);
      }
    });
  });
});
