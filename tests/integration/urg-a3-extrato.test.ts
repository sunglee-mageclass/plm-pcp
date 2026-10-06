// Urgentes R3 T14 (plan-a, migration 20261103177000_urg_r3_estoque_extrato): extrato ("Historico") de estoque POR ITEM — 3 wrappers
// so-leitura (estoque_extrato_tecido / _aviamento / _insumo: login -> modulo entrada_saida -> VER a pagina da aba de estoque) + 3 _core
// (EXECUTE revogado dos 3). Cada linha = um movimento ASSINADO (+ entrada, - saida) com quando/quando_fonte/origem/quem/ref; Σ por
// bucket = recebido - baixa do _estoque_<fam>_core POR CONSTRUCAO (Ruling A17: a linha-base absorve o que o log nao explica), core_*
// repetidos em todas as linhas do bucket. Datas so-DIA = meia-noite NO FUSO DA LOJA. Contrato com src/lib/estoque-extrato.ts (T15).
// Txn revertida; o bloco e aplicado DENTRO da txn por aplicaUrgA(c, "177000") (pula se ja vivo na copia). So na copia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, semJwt, ehBancoLocal, TENANT_TESTE, USER_TESTE } from "./db";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aplicaUrgA, dropUrgAExtratoSePreciso, md5UrgASucessor, URG_A_MIGS } from "./urg-a-helpers";
import { aplicarArquivo } from "./mig-txn";
import { filtrarBucket, montarExtrato, movDeLinhaRpc, type MovEstoque, type FamiliaEstoque } from "@/lib/estoque-extrato";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const FUSO = "America/Sao_Paulo";
const bloco = () => URG_A_MIGS.find((x) => x.id === "177000")?.b;
const WRAP: Record<FamiliaEstoque, string> = {
  tecido: "public.estoque_extrato_tecido(uuid)",
  aviamento: "public.estoque_extrato_aviamento(uuid)",
  insumo: "public.estoque_extrato_insumo(uuid)",
};
const CORE: Record<FamiliaEstoque, string> = {
  tecido: "public._estoque_extrato_tecido_core(uuid,uuid)",
  aviamento: "public._estoque_extrato_aviamento_core(uuid,uuid)",
  insumo: "public._estoque_extrato_insumo_core(uuid,uuid)",
};
const COLUNAS = [
  "bucket_variante_id uuid", "bucket_tamanho text", "bucket_cor_id uuid", "bucket_cor_nome text", "quando timestamp with time zone",
  "quando_fonte text", "tipo text", "origem text", "quantidade numeric", "quem text", "ref_oc text", "ref_modelo text", "ref_id uuid",
  "detalhe text", "core_recebido numeric", "core_baixa numeric", "core_fisico numeric",
].join(", ");

let seq = 0;
const suf = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
/** meia-noite do dia no fuso de Sao Paulo (UTC-3, sem horario de verao desde 2019) */
const meiaNoiteSP = (dia: string) => Date.parse(`${dia}T03:00:00Z`);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

type Res = { ok: true; rows: any[] } | { ok: false; code: string; msg: string };
async function tenta(c: Client, sql: string, params: unknown[] = [], antes?: string): Promise<Res> {
  await c.query("SAVEPOINT urg_a3_x");
  try {
    if (antes) await c.query(antes);
    const r = await c.query(sql, params);
    await c.query("ROLLBACK TO SAVEPOINT urg_a3_x");
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT urg_a3_x");
    return { ok: false, code: String(e.code ?? ""), msg: String(e.message ?? "") };
  }
}
async function jwt(c: Client, uid: string | null): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : ""]);
}
async function modulo(c: Client, tenant: string, chave: string, ligado: boolean): Promise<void> {
  await semJwt(c, () => c.query(
    `UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || jsonb_build_object($2::text, $3::boolean) WHERE tenant_id = $1`,
    [tenant, chave, ligado]));
}
async function prepara(c: Client): Promise<string> {
  await c.query("SET LOCAL statement_timeout = '180s'");
  await aplicaUrgA(c, "177000");
  await comoUsuario(c);
  await modulo(c, T, "entrada_saida", true);
  await semJwt(c, () => c.query(`UPDATE public.tenant_config SET timezone = $2 WHERE tenant_id = $1`, [T, FUSO]));
  return (await um<{ n: string }>(c, `SELECT nome AS n FROM public.users WHERE id = $1`, [USER_TESTE])).n;
}
/** Linhas da RPC como o PostgREST entrega (to_jsonb: numeric = number, timestamptz = ISO). */
async function rpc(c: Client, fam: FamiliaEstoque, id: string): Promise<MovEstoque[]> {
  const fn = WRAP[fam].replace("(uuid)", "");
  const { rows } = await c.query(`SELECT to_jsonb(x) AS j FROM ${fn}($1) x`, [id]);
  return rows.map((r) => movDeLinhaRpc(r.j));
}
const soma = (ms: MovEstoque[]) => Math.round(ms.reduce((s, m) => s + m.quantidade, 0) * 1e6) / 1e6;
const de = (ms: MovEstoque[], origem: string) => ms.filter((m) => m.origem === origem);

/** Toda linha do bucket repete o core; Σ = recebido - baixa; o TS confere. */
function confereBucket(ms: MovEstoque[], fam: FamiliaEstoque, core: { recebido: number; baixa: number; fisico: number }) {
  for (const m of ms) {
    expect([m.coreRecebido, m.coreBaixa, m.coreFisico]).toEqual([core.recebido, core.baixa, core.fisico]);
    expect(m.quandoFonte === "sem_data").toBe(m.quando === null);
    expect(["entrada", "saida"]).toContain(m.tipo);
    expect(m.tipo === "entrada" ? m.quantidade > 0 : m.quantidade < 0).toBe(true);
  }
  expect(soma(ms)).toBeCloseTo(core.recebido - core.baixa, 9);
  const ex = montarExtrato(ms, { fuso: FUSO });
  expect(ex.confere).toBe(true);
  expect(ex.saldoFinal).toBeCloseTo(core.recebido - core.baixa, 9);
  expect(ex.fisicoTela).toBe(ms.length ? core.fisico : 0);
  void fam;
}
async function auditEnvio(c: Client, cad: string, nome: string, horasAtras: number): Promise<void> {
  await c.query(
    `INSERT INTO public.audit_log (tenant_id, user_id, user_nome, acao, entidade, tabela, registro_id, descricao, dados, created_at)
     VALUES ($1, $2, $3, 'editar', 'CAD', 'cad', $4, 'ITEST envio', '{"enviado_corte": {"de": false, "para": true}}'::jsonb,
             now() - make_interval(hours => $5))`,
    [T, USER_TESTE, nome, cad, horasAtras]);
}
async function cardCad(c: Client, enviado: boolean, origem = "interno") {
  const s = suf();
  const m = (await um<{ id: string }>(c, `INSERT INTO public.modelos (tenant_id, nome, origem) VALUES ($1, $2, $3) RETURNING id`,
    [T, `ITEST-R3 card ${s}`, origem])).id;
  await c.query(`UPDATE public.modelos SET ordem_criacao_enviada = true WHERE id = $1`, [m]);
  const cad = (await um<{ id: string }>(c,
    `INSERT INTO public.cad (tenant_id, modelo_id, enviado_corte) VALUES ($1, $2, $3) RETURNING id`, [T, m, enviado])).id;
  return { m, cad, nome: `ITEST-R3 card ${s}` };
}

describe.skipIf(!RODA)("urg R3 T14 — extrato de estoque por item (177000)", () => {
  it("o bloco 177000 existe (gerado por mig/gerar-a3.mjs): 6 funcoes NOVAS, _down no-op documentado, _down_drop separado", () => {
    const b = bloco();
    expect(b).toBeTruthy();
    expect(b!.mig).toBe("supabase/migrations/20261103177000_urg_r3_estoque_extrato.sql");
    expect(b!.volta).toBe(false);
    expect(b!.MD5).toEqual({});
    expect(Object.keys(b!.NOVAS).sort()).toEqual([...Object.values(WRAP), ...Object.values(CORE)].sort());
    for (const m of Object.values(b!.NOVAS)) expect(m).toMatch(/^[0-9a-f]{32}$/);
    expect(b!.drop).toMatch(/_down_drop\.sql$/);
  });

  it("assinatura comum, STABLE SECURITY DEFINER search_path=public; wrappers so authenticated/service_role; _core sem EXECUTE para os 3", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const fam of ["tecido", "aviamento", "insumo"] as FamiliaEstoque[]) {
        for (const [sig, wrapper] of [[WRAP[fam], true], [CORE[fam], false]] as [string, boolean][]) {
          const m = await um(c,
            `SELECT p.prosecdef AS sd, array_to_string(p.proconfig, '|') AS cfg, p.provolatile::text AS vol,
                    pg_get_function_result(p.oid) AS res,
                    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                    has_function_privilege('service_role', p.oid, 'EXECUTE') AS srv,
                    EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0) AS pub
               FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, [sig]);
          expect(m, sig).toEqual({ sd: true, cfg: "search_path=public", vol: "s", res: `TABLE(${COLUNAS})`,
            anon: false, auth: wrapper, srv: true, pub: false });
        }
      }
      // como o PAPEL: anon nao executa nada; authenticated nao executa o _core
      const v = "00000000-0000-0000-0000-000000000000";
      for (const fam of ["tecido", "aviamento", "insumo"] as FamiliaEstoque[]) {
        const w = WRAP[fam].replace("(uuid)", ""), k = CORE[fam].replace("(uuid,uuid)", "");
        const a = await tenta(c, `SELECT * FROM ${w}($1)`, [v], "SET LOCAL ROLE anon");
        expect(a.ok ? "PASSOU" : a.code).toBe("42501");
        const b = await tenta(c, `SELECT * FROM ${k}($1, $2)`, [T, v], "SET LOCAL ROLE authenticated");
        expect(b.ok ? "PASSOU" : `${b.code} ${b.msg}`).toMatch(/^42501 permission denied for function/);
      }
    });
  });

  it("portoes: sem login 42501; modulo entrada_saida desligado 42501 modulo_desligado; sem VER a pagina da aba 42501; outra loja = vazio (sem oraculo)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const art = (await um<{ id: string }>(c,
        `INSERT INTO public.artigos (tenant_id, nome, unidade_medida) VALUES ($1, 'ITEST-R3 portao', 'metro') RETURNING id`, [T])).id;
      const vari = (await um<{ id: string }>(c,
        `INSERT INTO public.variantes_tecido (tenant_id, artigo_id, nome_variante) VALUES ($1, $2, 'ITEST-R3 portao') RETURNING id`, [T, art])).id;
      const oc = (await um<{ id: string }>(c,
        `INSERT INTO public.ocs_tecido (tenant_id, status, numero_pedido, data_entrega) VALUES ($1, 'recebido', 'ITEST-R3-P', '2026-01-05') RETURNING id`, [T])).id;
      await c.query(`INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida)
                     VALUES ($1, $2, $3, 3, 3)`, [oc, art, vari]);
      expect((await rpc(c, "tecido", vari)).length).toBe(1);

      // sem login
      await jwt(c, null);
      for (const fam of ["tecido", "aviamento", "insumo"] as FamiliaEstoque[]) {
        const r = await tenta(c, `SELECT * FROM ${WRAP[fam].replace("(uuid)", "")}($1)`, [vari]);
        expect(r.ok ? "PASSOU" : `${r.code} ${r.msg}`).toBe("42501 nao_autenticado: estoque_extrato");
      }
      // usuario comum da loja: so ve o que a permissao de pagina deixa
      const U = "3a0c7e11-0000-4000-8000-0000000a3e14";
      await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [U, `${U}@teste`]);
      await c.query(`INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'R3 comum', 'user')
                     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`, [U, T, `${U}@teste`]);
      await semJwt(c, () => c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [U]));
      await jwt(c, U);
      const PAG: Record<FamiliaEstoque, string> = { tecido: "entrada_oc_tecido", aviamento: "entrada_oc_aviamento", insumo: "entrada_oc_insumo" };
      for (const fam of ["tecido", "aviamento", "insumo"] as FamiliaEstoque[]) {
        const r = await tenta(c, `SELECT * FROM ${WRAP[fam].replace("(uuid)", "")}($1)`, [vari]);
        expect(r.ok ? "PASSOU" : `${r.code} ${r.msg}`).toBe(`42501 sem_permissao_ver: ${PAG[fam]}`);
        await semJwt(c, () => c.query(
          `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, true, false)`,
          [U, T, PAG[fam]]));
        const ok = await tenta(c, `SELECT * FROM ${WRAP[fam].replace("(uuid)", "")}($1)`, [vari]);
        expect(ok.ok ? "PASSOU" : `${ok.code} ${ok.msg}`).toBe("PASSOU");
      }
      const t = await tenta(c, `SELECT count(*)::int AS n FROM public.estoque_extrato_tecido($1)`, [vari]);
      expect(t.ok && t.rows[0].n).toBe(1); // so VER basta (leitura)

      // modulo desligado (super admin fura tenant_module_enabled: usa o usuario comum)
      await modulo(c, T, "entrada_saida", false);
      const md = await tenta(c, `SELECT * FROM public.estoque_extrato_tecido($1)`, [vari]);
      expect(md.ok ? "PASSOU" : `${md.code} ${md.msg}`).toBe("42501 modulo_desligado: entrada_saida");
      await modulo(c, T, "entrada_saida", true);

      // admin de OUTRA loja: o item nao e dele => conjunto vazio (nenhum erro diferente do de item inexistente)
      const outra = (await um<{ id: string }>(c, `SELECT id FROM public.tenants WHERE id <> $1 AND coalesce(ativo, true) ORDER BY id LIMIT 1`, [T])).id;
      const U2 = "3a0c7e11-0000-4000-8000-0000000a3e15";
      await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [U2, `${U2}@teste`]);
      await c.query(`INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'R3 outra', 'user')
                     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`, [U2, outra, `${U2}@teste`]);
      await c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin') ON CONFLICT DO NOTHING`, [U2]);
      await modulo(c, outra, "entrada_saida", true);
      await jwt(c, U2);
      for (const fam of ["tecido", "aviamento", "insumo"] as FamiliaEstoque[]) {
        const r = await tenta(c, `SELECT count(*)::int AS n FROM ${WRAP[fam].replace("(uuid)", "")}($1)`, [vari]);
        expect(r.ok ? r.rows[0].n : `${(r as any).code}`).toBe(0);
      }
      // o _core com a loja errada tambem devolve vazio
      expect((await um<{ n: number }>(c, `SELECT count(*)::int AS n FROM public._estoque_extrato_tecido_core($1, $2)`, [outra, vari])).n).toBe(0);
      expect((await um<{ n: number }>(c, `SELECT count(*)::int AS n FROM public._estoque_extrato_tecido_core($1, $2)`, [T, vari])).n).toBe(1);
    });
  });

  it("tecido: OC recebida (kg -> m, audit = hora/quem), OC sem audit (data de entrega = meia-noite NO FUSO), separacao de rolo (-X na origem, +X no rolo), corte, - Metragem, troca, OS baixada; Σ = core", async () => {
    await withTx(async (c) => {
      const eu = await prepara(c);
      const s = suf();
      const art = (await um<{ id: string }>(c,
        `INSERT INTO public.artigos (tenant_id, nome, unidade_medida) VALUES ($1, $2, 'metro') RETURNING id`, [T, `ITEST-R3 m ${s}`])).id;
      const vari = (await um<{ id: string }>(c,
        `INSERT INTO public.variantes_tecido (tenant_id, artigo_id, nome_variante) VALUES ($1, $2, 'ITEST-R3 V') RETURNING id`, [T, art])).id;
      const artKg = (await um<{ id: string }>(c,
        `INSERT INTO public.artigos (tenant_id, nome, unidade_medida, rendimento) VALUES ($1, $2, 'kg', 2.5) RETURNING id`, [T, `ITEST-R3 kg ${s}`])).id;
      const varKg = (await um<{ id: string }>(c,
        `INSERT INTO public.variantes_tecido (tenant_id, artigo_id, nome_variante) VALUES ($1, $2, 'ITEST-R3 VK') RETURNING id`, [T, artKg])).id;

      // OC A: nasce recebida (sem transicao no audit) => data de entrega (so DIA) = meia-noite em SP
      const ocA = (await um<{ id: string }>(c,
        `INSERT INTO public.ocs_tecido (tenant_id, status, numero_pedido, data_entrega, recebimento_responsavel_nome)
         VALUES ($1, 'recebido', 'ITEST-R3-A', '2026-03-10', 'Fulana do recebimento') RETURNING id`, [T])).id;
      const itA = (await um<{ id: string }>(c,
        `INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida)
         VALUES ($1, $2, $3, 100, 100) RETURNING id`, [ocA, art, vari])).id;
      // item cancelado e OC encomendada: fora (como no core)
      await c.query(`INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida, cancelado)
                     VALUES ($1, $2, $3, 40, 40, true)`, [ocA, art, vari]);
      const ocE = (await um<{ id: string }>(c,
        `INSERT INTO public.ocs_tecido (tenant_id, status, numero_pedido) VALUES ($1, 'encomendado', 'ITEST-R3-E') RETURNING id`, [T])).id;
      await c.query(`INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, variante_tecido_id, quantidade_pedida) VALUES ($1, $2, $3, 50)`,
        [ocE, art, vari]);
      // troca: reposicao recebida (8) e reposicao ainda sem quantidade (0: nao aparece)
      await c.query(`INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida, substitui_item_id)
                     VALUES ($1, $2, $3, 8, 8, $4), ($1, $2, $3, 5, NULL, $4)`, [ocA, art, vari, itA]);
      // rolo: separa 30 do item A (transferencia: -30 na origem, +30 no rolo, mesma variante)
      await c.query(`SELECT public._criar_rolo_core($1, $2::uuid, $3::jsonb, $4::uuid)`,
        [`ITEST-R3-R${s}`, art, JSON.stringify([{ variante_tecido_id: vari, metragem: 30 }]), itA]);
      // corte (vinculo) e "- Metragem"
      const { cad, nome: card } = await cardCad(c, true);
      await c.query(`INSERT INTO public.estoque_tecido_baixas (tenant_id, cad_id, oc_tecido_item_id, variante_tecido_id, quantidade, origem, created_by)
                     VALUES ($1, $2, $3, $4, 12, 'vinculo', $5), ($1, NULL, $3, $4, 5, 'ajuste', $5)`, [T, cad, itA, vari, USER_TESTE]);
      await c.query(`UPDATE public.estoque_tecido_baixas SET motivo = 'ITEST perda' WHERE oc_tecido_item_id = $1 AND origem = 'ajuste'`, [itA]);
      // OS baixada (data so-dia)
      const os = (await um<{ id: string }>(c,
        `INSERT INTO public.ordens_saida_tecido (tenant_id, baixado, data_corte, responsavel) VALUES ($1, true, '2026-04-01', 'Ciclano') RETURNING id`, [T])).id;
      await c.query(`INSERT INTO public.ordens_saida_tecido_itens (tenant_id, ordem_saida_id, variante_tecido_id, reserva, baixa) VALUES ($1, $2, $3, 0, 7)`,
        [T, os, vari]);
      // OC K (kg): encomendada -> recebida por UPDATE (o audit_cad/ocs registra a transicao com hora e quem)
      const ocK = (await um<{ id: string }>(c,
        `INSERT INTO public.ocs_tecido (tenant_id, status, numero_pedido) VALUES ($1, 'encomendado', 'ITEST-R3-K') RETURNING id`, [T])).id;
      await c.query(`INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida)
                     VALUES ($1, $2, $3, 10, 10)`, [ocK, artKg, varKg]);
      await c.query(`UPDATE public.ocs_tecido SET status = 'recebido' WHERE id = $1`, [ocK]);

      const core = async (v: string) => {
        const r = await um<any>(c, `SELECT recebido_m, baixa, fisico FROM public._estoque_tecido_core($1) WHERE variante_tecido_id = $2`, [T, v]);
        return { recebido: Number(r.recebido_m), baixa: Number(r.baixa), fisico: Number(r.fisico) };
      };
      const ms = await rpc(c, "tecido", vari);
      expect(new Set(ms.map((m) => m.bucketVarianteId))).toEqual(new Set([vari]));
      const cv = await core(vari);
      expect(cv).toEqual({ recebido: 108, baixa: 24, fisico: 84 });
      confereBucket(ms, "tecido", cv);
      expect(ms.map((m) => `${m.origem}:${m.quantidade}`).sort()).toEqual(
        ["corte:-12", "ajuste:-5", "oc:100", "os:-7", "reposicao_troca:8", "rolo_entrada:30", "separacao_rolo:-30"].sort());
      const oc = de(ms, "oc")[0];
      expect([oc.quandoFonte, Date.parse(oc.quando!), oc.quem, oc.refOc, oc.refId]).toEqual(
        ["data_oc", meiaNoiteSP("2026-03-10"), "Fulana do recebimento", "ITEST-R3-A", ocA]);
      const sep = de(ms, "separacao_rolo")[0];
      const ent = de(ms, "rolo_entrada")[0];
      expect(sep.quandoFonte).toBe("registro");
      expect(ent.quandoFonte).toBe("registro");
      expect(sep.refOc).toBe("ITEST-R3-A");
      expect(ent.refOc).toBe(`ITEST-R3-R${s}`);
      expect(sep.detalhe).toContain(`ITEST-R3-R${s}`);
      const corte = de(ms, "corte")[0];
      expect([corte.quandoFonte, corte.quem, corte.refModelo, corte.refOc]).toEqual(["registro", eu, card, "ITEST-R3-A"]);
      expect(de(ms, "ajuste")[0].detalhe).toBe("ITEST perda");
      const o = de(ms, "os")[0];
      expect([o.quandoFonte, Date.parse(o.quando!), o.quem, o.refId]).toEqual(["data_os", meiaNoiteSP("2026-04-01"), "Ciclano", os]);

      const mk = await rpc(c, "tecido", varKg);
      const ck = await core(varKg);
      expect(ck.recebido).toBe(25);
      confereBucket(mk, "tecido", ck);
      expect(mk).toHaveLength(1);
      expect([mk[0].origem, mk[0].quantidade, mk[0].quandoFonte, mk[0].quem]).toEqual(["oc", 25, "registro", eu]);
      expect(mk[0].detalhe).toMatch(/10 kg/);
      // a hora do registro e a do audit (transicao status -> recebido), nao a do dia
      const aud = await um<{ t: Date }>(c,
        `SELECT max(created_at) AS t FROM public.audit_log WHERE registro_id = $1 AND tabela = 'ocs_tecido' AND dados -> 'status' ->> 'para' = 'recebido'`, [ocK]);
      expect(Date.parse(mk[0].quando!)).toBe(aud.t.getTime());
    });
  });

  it("aviamento: OC recebida (legado sem variante -> variante unica), envio (base = C - ajustes) + ajuste DEPOIS do envio pelo log (hora/quem), OS; bucket 'Sem variante'; Σ = core", async () => {
    await withTx(async (c) => {
      const eu = await prepara(c);
      const s = suf();
      const av = (await um<{ id: string }>(c, `INSERT INTO public.aviamentos (tenant_id, codigo_nome) VALUES ($1, $2) RETURNING id`,
        [T, `ITEST-R3 AV ${s}`])).id;
      const va = (await um<{ id: string }>(c,
        `INSERT INTO public.variantes_aviamento (tenant_id, aviamento_id, nome_variante) VALUES ($1, $2, 'ITEST-R3 VA') RETURNING id`, [T, av])).id;
      const oc = (await um<{ id: string }>(c,
        `INSERT INTO public.ocs_aviamento (tenant_id, status, numero_pedido, data_entrega) VALUES ($1, 'encomendado', 'ITEST-R3-AV', '2026-02-01') RETURNING id`, [T])).id;
      await c.query(`INSERT INTO public.ocs_aviamento_itens (oc_aviamento_id, aviamento_id, quantidade_pedida, quantidade_recebida) VALUES ($1, $2, 50, 50)`, [oc, av]);
      await c.query(`UPDATE public.ocs_aviamento SET status = 'recebido' WHERE id = $1`, [oc]);

      const { cad, nome: card } = await cardCad(c, true);
      await c.query(`INSERT INTO public.cad_aviamentos (cad_id, aviamento_id, numero, quantidade_separar) VALUES ($1, $2, 1, 10)`, [cad, av]);
      await auditEnvio(c, cad, "Quem enviou", 2);
      // CAD enviado SEM audit e SEM data: base "sem data"
      const c2 = await cardCad(c, true);
      await c.query(`INSERT INTO public.cad_aviamentos (cad_id, aviamento_id, numero, quantidade_enviar) VALUES ($1, $2, 1, 4)`, [c2.cad, av]);
      await c.query(`UPDATE public.cad SET data_enviado_corte = NULL WHERE id = $1`, [c2.cad]);
      // as linhas semeadas acima "existiam antes do log" (A16: o log comeca vazio) - o gatilho da 176000 as registrou: tira
      await c.query(`DELETE FROM public.estoque_mov_log WHERE cad_id IN ($1, $2)`, [cad, c2.cad]);
      // depois do envio (o log 176000 guarda): 10 -> 8
      await c.query(`UPDATE public.cad_aviamentos SET quantidade_separar = 8 WHERE cad_id = $1`, [cad]);
      expect((await um<{ n: number }>(c, `SELECT count(*)::int AS n FROM public.estoque_mov_log WHERE cad_id = $1`, [cad])).n).toBe(1);
      // CAD NAO enviado: fora
      const c3 = await cardCad(c, false);
      await c.query(`INSERT INTO public.cad_aviamentos (cad_id, aviamento_id, numero, quantidade_separar) VALUES ($1, $2, 1, 99)`, [c3.cad, av]);
      // OS baixada
      const os = (await um<{ id: string }>(c,
        `INSERT INTO public.ordens_saida_aviamento (tenant_id, baixado, data_solicitacao) VALUES ($1, true, '2026-05-02') RETURNING id`, [T])).id;
      await c.query(`INSERT INTO public.ordens_saida_aviamento_itens (tenant_id, ordem_saida_id, aviamento_id, variante_aviamento_id, reserva, baixa)
                     VALUES ($1, $2, $3, $4, 0, 3)`, [T, os, av, va]);

      const core = async (a: string, v: string | null) => {
        const r = await um<any>(c, `SELECT recebido, baixa, fisico FROM public._estoque_aviamento_core($1) WHERE id = $2 AND variante_id IS NOT DISTINCT FROM $3`,
          [T, a, v]);
        return { recebido: Number(r.recebido), baixa: Number(r.baixa), fisico: Number(r.fisico) };
      };
      const ms = await rpc(c, "aviamento", av);
      expect(new Set(ms.map((m) => m.bucketVarianteId))).toEqual(new Set([va]));
      const cv = await core(av, va);
      expect(cv).toEqual({ recebido: 50, baixa: 15, fisico: 35 });
      confereBucket(filtrarBucket(ms, { varianteId: va }, "aviamento"), "aviamento", cv);
      const o = de(ms, "oc")[0];
      expect([o.quantidade, o.quandoFonte, o.quem, o.refOc]).toEqual([50, "registro", eu, "ITEST-R3-AV"]);
      const base = de(ms, "explosao").filter((m) => m.refId === cad);
      expect(base.map((m) => [m.quantidade, m.quandoFonte, m.quem, m.refModelo])).toEqual([[-10, "registro", "Quem enviou", card]]);
      const env = await um<{ t: Date }>(c,
        `SELECT created_at AS t FROM public.audit_log WHERE registro_id = $1 AND acao = 'editar' AND dados ? 'enviado_corte'`, [cad]);
      expect(Date.parse(base[0].quando!)).toBe(env.t.getTime());
      const aj = de(ms, "explosao_ajuste");
      expect(aj.map((m) => [m.quantidade, m.tipo, m.quandoFonte, m.quem, m.refId])).toEqual([[2, "entrada", "registro", eu, cad]]);
      const semData = de(ms, "explosao").filter((m) => m.refId === c2.cad);
      expect(semData.map((m) => [m.quantidade, m.quandoFonte, m.quando])).toEqual([[-4, "sem_data", null]]);
      const so = de(ms, "os")[0];
      expect([so.quantidade, so.quandoFonte, Date.parse(so.quando!)]).toEqual([-3, "data_os", meiaNoiteSP("2026-05-02")]);
      expect(ms.some((m) => m.refId === c3.cad)).toBe(false);

      // 2 variantes + item de OC sem variante => bucket "Sem variante" (NULL); variante sem movimento: Σ 0
      const av2 = (await um<{ id: string }>(c, `INSERT INTO public.aviamentos (tenant_id, codigo_nome) VALUES ($1, $2) RETURNING id`,
        [T, `ITEST-R3 AV2 ${s}`])).id;
      const v1 = (await um<{ id: string }>(c,
        `INSERT INTO public.variantes_aviamento (tenant_id, aviamento_id, nome_variante) VALUES ($1, $2, 'V1') RETURNING id`, [T, av2])).id;
      const v2 = (await um<{ id: string }>(c,
        `INSERT INTO public.variantes_aviamento (tenant_id, aviamento_id, nome_variante) VALUES ($1, $2, 'V2') RETURNING id`, [T, av2])).id;
      const oc2 = (await um<{ id: string }>(c,
        `INSERT INTO public.ocs_aviamento (tenant_id, status, numero_pedido) VALUES ($1, 'recebido', 'ITEST-R3-AV2') RETURNING id`, [T])).id;
      await c.query(`INSERT INTO public.ocs_aviamento_itens (oc_aviamento_id, aviamento_id, variante_aviamento_id, quantidade_pedida, quantidade_recebida)
                     VALUES ($1, $2, NULL, 9, 9), ($1, $2, $3, 4, 4)`, [oc2, av2, v1]);
      const m2 = await rpc(c, "aviamento", av2);
      expect(new Set(m2.map((m) => m.bucketVarianteId))).toEqual(new Set([null, v1]));
      for (const v of [null, v1, v2]) confereBucket(filtrarBucket(m2, { varianteId: v }, "aviamento"), "aviamento", await core(av2, v));
      expect(de(m2, "oc").every((m) => m.quandoFonte === "sem_data" && m.quando === null)).toBe(true);
    });
  });

  it("insumo: OC Insumo (data de entrega), envio por tamanho (enviar_por_tamanho), sem tamanho repartido pela grade (maior resto + fracao), insumo sem tamanho, vinculado (R1) na revenda; ajuste do log no bucket; Σ = core por (tamanho, cor)", async () => {
    await withTx(async (c) => {
      const eu = await prepara(c);
      const s = suf();
      const cor = (await um<{ id: string }>(c, `INSERT INTO public.cores (tenant_id, nome) VALUES ($1, $2) RETURNING id`, [T, `ITEST-R3 COR ${s}`])).id;
      const corNome = `ITEST-R3 COR ${s}`;
      const e1 = (await um<{ id: string }>(c, `INSERT INTO public.etiquetas (tenant_id, nome, preco) VALUES ($1, $2, 1) RETURNING id`, [T, `ITEST-R3 E1 ${s}`])).id;
      const vP = (await um<{ id: string }>(c, `INSERT INTO public.variantes_etiqueta (tenant_id, etiqueta_id, tamanho, cor_id) VALUES ($1, $2, 'P', $3) RETURNING id`, [T, e1, cor])).id;
      const vM = (await um<{ id: string }>(c, `INSERT INTO public.variantes_etiqueta (tenant_id, etiqueta_id, tamanho, cor_id) VALUES ($1, $2, 'M', $3) RETURNING id`, [T, e1, cor])).id;
      const oc = (await um<{ id: string }>(c,
        `INSERT INTO public.ocs_etiqueta (tenant_id, status, numero_pedido, data_entrega) VALUES ($1, 'recebido', 'ITEST-R3-I', '2026-02-03') RETURNING id`, [T])).id;
      await c.query(`INSERT INTO public.ocs_etiqueta_itens (oc_etiqueta_id, etiqueta_id, variante_etiqueta_id, quantidade_pedida, quantidade_recebida)
                     VALUES ($1, $2, $3, 20, 20), ($1, $2, $4, 30, NULL)`, [oc, e1, vP, vM]);
      const { cad, nome: card } = await cardCad(c, true);
      await c.query(`INSERT INTO public.cad_grades (cad_id, variante_numero, grades_planejadas) VALUES ($1, 1, '{"P": 2, "M": 1}'::jsonb)`, [cad]);
      await c.query(`INSERT INTO public.cad_etiquetas (cad_id, etiqueta_id, cor_id, quantidade_enviar, enviar_por_tamanho)
                     VALUES ($1, $2, $3, 12, '{"P": 5, "M": 7}'::jsonb), ($1, $2, $3, 7.5, '{}'::jsonb)`, [cad, e1, cor]);
      await auditEnvio(c, cad, "Quem enviou", 3);
      // insumo SEM tamanho (formato nenhum) e insumo VINCULADO ao M (R1) usado na revenda
      const e2 = (await um<{ id: string }>(c, `INSERT INTO public.etiquetas (tenant_id, nome, preco, formato_tamanho) VALUES ($1, $2, 1, 'nenhum') RETURNING id`,
        [T, `ITEST-R3 E2 ${s}`])).id;
      await c.query(`INSERT INTO public.cad_etiquetas (cad_id, etiqueta_id, cor_id, quantidade_enviar) VALUES ($1, $2, $3, 4)`, [cad, e2, cor]);
      // linhas "de antes do log" (A16): tira o que o gatilho da 176000 registrou na semeadura
      await c.query(`DELETE FROM public.estoque_mov_log WHERE cad_id = $1`, [cad]);
      // depois do envio: P 5 -> 6 (o log guarda ept_antes/ept_depois)
      await c.query(`UPDATE public.cad_etiquetas SET enviar_por_tamanho = '{"P": 6, "M": 7}'::jsonb WHERE cad_id = $1 AND enviar_por_tamanho <> '{}'::jsonb`, [cad]);
      const e3 = (await um<{ id: string }>(c,
        `INSERT INTO public.etiquetas (tenant_id, nome, preco, formato_tamanho, tamanho_vinculado) VALUES ($1, $2, 1, 'nenhum', 'M') RETURNING id`,
        [T, `ITEST-R3 E3 ${s}`])).id;
      const rv = await cardCad(c, false, "revenda");
      await c.query(`INSERT INTO public.cad_grades (cad_id, variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real)
                     VALUES ($1, 1, '{"M": 4, "P": 6}'::jsonb, '{"M": 4, "P": 6}'::jsonb, 10, 10)`, [rv.cad]);
      await c.query(`INSERT INTO public.modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, consumo) VALUES ($1, $2, $3, $4, 2)`, [T, rv.m, e3, cor]);

      const core = async (etq: string) => {
        const { rows } = await c.query(
          `SELECT tamanho, cor_nome, sum(recebido)::float8 AS recebido, sum(baixa)::float8 AS baixa, sum(fisico)::float8 AS fisico
             FROM (SELECT DISTINCT tamanho, cor_nome, recebido, prev_receb, baixa, fisico FROM public._estoque_etiqueta_core($1) WHERE etiqueta_id = $2) d
            GROUP BY 1, 2`, [T, etq]);
        return rows as { tamanho: string | null; cor_nome: string | null; recebido: number; baixa: number; fisico: number }[];
      };
      const m1 = await rpc(c, "insumo", e1);
      const k1 = await core(e1);
      expect(k1.map((k) => `${k.tamanho}|${k.recebido}|${k.baixa}`).sort()).toEqual(["M|30|9", "P|20|11", "null|0|0.5"].sort());
      for (const k of k1) confereBucket(filtrarBucket(m1, { tamanho: k.tamanho, corNome: k.cor_nome }, "insumo"), "insumo", k);
      const naoNoCore = m1.filter((m) => !k1.some((k) => (k.tamanho ?? "") === (m.bucketTamanho ?? "") && (k.cor_nome ?? "") === (m.bucketCorNome ?? "")));
      expect(naoNoCore).toEqual([]);
      const P = filtrarBucket(m1, { tamanho: "P", corNome: corNome }, "insumo");
      expect(P.map((m) => `${m.origem}:${m.quantidade}:${m.quandoFonte}`).sort()).toEqual(
        ["oc:20:data_oc", "explosao:-10:registro", "explosao_ajuste:-1:registro"].sort());
      expect(de(P, "explosao_ajuste")[0].quem).toBe(eu);
      expect(de(P, "explosao")[0].quem).toBe("Quem enviou");
      expect(de(P, "explosao")[0].refModelo).toBe(card);
      expect(Date.parse(de(P, "oc")[0].quando!)).toBe(meiaNoiteSP("2026-02-03"));
      expect(P.every((m) => m.bucketCorId === cor)).toBe(true);
      const M = filtrarBucket(m1, { tamanho: "M", corNome: corNome }, "insumo");
      expect(M.map((m) => `${m.origem}:${m.quantidade}`).sort()).toEqual(["oc:30", "explosao:-9"].sort());
      const semTam = filtrarBucket(m1, { tamanho: null, corNome: corNome }, "insumo");
      expect(semTam.map((m) => `${m.origem}:${m.quantidade}`)).toEqual(["explosao:-0.5"]);

      const m2 = await rpc(c, "insumo", e2);
      const k2 = await core(e2);
      expect(k2).toHaveLength(1);
      for (const k of k2) confereBucket(filtrarBucket(m2, { tamanho: k.tamanho, corNome: k.cor_nome }, "insumo"), "insumo", k);
      expect(m2.map((m) => `${m.bucketTamanho}:${m.origem}:${m.quantidade}`)).toEqual(["null:explosao:-4"]);

      const m3 = await rpc(c, "insumo", e3);
      const k3 = await core(e3);
      expect(k3.map((k) => `${k.tamanho}|${k.baixa}`)).toEqual(["null|8"]); // 2 x 4 pecas do M (grade real)
      for (const k of k3) confereBucket(filtrarBucket(m3, { tamanho: k.tamanho, corNome: k.cor_nome }, "insumo"), "insumo", k);
      expect(m3.map((m) => [m.origem, m.quantidade, m.refModelo, m.refId])).toEqual([["revenda", -8, rv.nome, rv.cad]]);
    });
  });
  it("[fix 1, L2] data so-DIA = meia-noite no fuso DA LOJA (America/Manaus = 04:00Z, nao o padrao); fuso invalido ou vazio cai em America/Sao_Paulo", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const s = suf();
      const art = (await um<{ id: string }>(c,
        `INSERT INTO public.artigos (tenant_id, nome, unidade_medida) VALUES ($1, $2, 'metro') RETURNING id`, [T, `ITEST-R3 tz ${s}`])).id;
      const vari = (await um<{ id: string }>(c,
        `INSERT INTO public.variantes_tecido (tenant_id, artigo_id, nome_variante) VALUES ($1, $2, 'ITEST-R3 tz') RETURNING id`, [T, art])).id;
      const oc = (await um<{ id: string }>(c,
        `INSERT INTO public.ocs_tecido (tenant_id, status, numero_pedido, data_entrega) VALUES ($1, 'recebido', 'ITEST-R3-TZ', '2026-03-10') RETURNING id`, [T])).id;
      await c.query(`INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida)
                     VALUES ($1, $2, $3, 2, 2)`, [oc, art, vari]);
      const fuso = (tz: string) => semJwt(c, () => c.query(`UPDATE public.tenant_config SET timezone = $2 WHERE tenant_id = $1`, [T, tz]));
      await fuso("America/Manaus");
      let [m] = await rpc(c, "tecido", vari);
      expect([m.quandoFonte, Date.parse(m.quando!)]).toEqual(["data_oc", Date.parse("2026-03-10T04:00:00Z")]);
      // a lib (fuso da loja) poe a linha no MESMO dia
      const ex = montarExtrato([m], { fuso: "America/Manaus", de: "2026-03-10", ate: "2026-03-10" });
      expect(ex.linhas).toHaveLength(1);
      for (const tz of ["Mars/Base", ""]) {
        await fuso(tz);
        [m] = await rpc(c, "tecido", vari);
        expect(Date.parse(m.quando!), tz).toBe(meiaNoiteSP("2026-03-10"));
      }
    });
  });

  it("[fix 1, L1] o _down_drop da 176000 RECUSA enquanto o extrato (177000) le estoque_mov_log; depois do _down_drop da 177000, passa (LIFO)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const b176 = URG_A_MIGS.find((x) => x.id === "176000")!.b;
      await aplicarArquivo(c, b176.down);
      await expect(aplicarArquivo(c, b176.drop)).rejects.toThrow(
        /urg_r3_176000_down_drop: outras funcoes leem public\.estoque_mov_log: .*_estoque_extrato_aviamento_core\(uuid,uuid\).*_estoque_extrato_insumo_core\(uuid,uuid\)/);
      await dropUrgAExtratoSePreciso(c);
      await aplicarArquivo(c, b176.drop);
      await c.query("SET LOCAL transaction_timeout = 0");
      expect((await um<{ f: string | null }>(c, `SELECT to_regprocedure('public.fn_estoque_mov_log()')::text AS f`)).f).toBeNull();
      expect((await um<{ t: string | null }>(c, `SELECT to_regclass('public.estoque_mov_log')::text AS t`)).t).toBe("estoque_mov_log"); // sem a GUC, fica
    });
  });

  it("[fix 1, L4] anti-drift: os 3 cores que o extrato ESPELHA tem o md5 que a 177000 exige (fim da cadeia de sucessores urg-a/urgb e o vivo) - mudou um core = regere a 177000 e rode a varredura", async () => {
    const txt = readFileSync(ROOT + bloco()!.mig, "utf8");
    const pin = Object.fromEntries(
      [...txt.matchAll(/^--   (public\._estoque_\w+_core\(uuid\))  \(espelhado; exigido\) ([0-9a-f]{32})$/gm)].map((x) => [x[1], x[2]]));
    // md5 de ANTES desta frente (fatos do plan-a); a cadeia acrescenta os "depois" de quem os redefine (171000 no insumo; plan-b, se vier)
    const BASE: Record<string, string> = {
      "public._estoque_tecido_core(uuid)": "9140c253a8b62fa143de052d84a1c329",
      "public._estoque_aviamento_core(uuid)": "f6eea9360a5fee924824a323de47c53f",
      "public._estoque_etiqueta_core(uuid)": "28aa308d297cc18b653c6290a5b3b958",
    };
    expect(Object.keys(pin).sort()).toEqual(Object.keys(BASE).sort());
    const msg = (sig: string) => `${sig} mudou: o extrato (177000) espelha as regras deste core - regere a 177000 (mig/gerar-a3.mjs) e rode a varredura`;
    for (const sig of Object.keys(BASE)) expect(md5UrgASucessor(sig, BASE[sig]).at(-1), msg(sig)).toBe(pin[sig]);
    await withTx(async (c) => {
      await aplicaUrgA(c, "177000");
      for (const sig of Object.keys(BASE)) {
        const vivo = (await um<{ m: string }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
        expect(vivo, msg(sig)).toBe(pin[sig]);
      }
    });
  });
});
