/**
 * DATA DA NOTA DE ENTRADA nas 5 OCs — integração em BEGIN…ROLLBACK: NADA é gravado.
 * Spec: docs/superpowers/specs/2026-09-24-data-nota-entrada-design.md · Plano: docs/superpowers/plans/2026-09-24-data-nota-entrada.md
 *
 * ⚠️ SÓ NA CÓPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). Fora dela a suíte INTEIRA se
 * pula (nunca roda contra produção / `/tmp/dburl.txt`): DDL em transação contra produção trava o app de todas as lojas mesmo
 * com ROLLBACK (incidente 23/set).
 *
 * Dois modos:
 *  • NOTA_MIG_TXN=1 — a cópia está SEM a migration; `prepara` aplica o arquivo DENTRO da txn (tira só as linhas `BEGIN;` e
 *    `COMMIT;` — NUNCA `\i`: o COMMIT do arquivo fecharia a txn e VAZARIA, incidente 15/set). Roda TUDO, inclusive os 6 testes
 *    que precisam do estado de ANTES ("sem data = hoje", idempotência/ACL, guarda R2, inverso, captura do diff e a medição
 *    do laço do inverso — R9-b: com as OCs recebidas da cópia DATADAS, tudo DESFEITO no ROLLBACK).
 *  • sem a variável — a migration já está aplicada na cópia (Task 4/12); roda os testes de comportamento; os 6 pulam.
 * ⚠️ R4 do G-plano: a DDL em transação CONGELA o app de teste do dono (:5188) nas OCs/Estoque/Financeiro enquanto roda —
 *    só rodar depois do pré-voo `bash .superpowers/nota/prevoo-copia.sh <passo>` (dono avisado, :5188 ocioso, nenhum
 *    vitest/playwright, nenhuma sessão ativa na cópia).
 * Datas dos cenários: SEMPRE no passado (a D7 recusa data futura) e ≥ a data do pedido (01/09/2026).
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261002100000_oc_data_nota_entrada.sql";
const DOWN = "supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql";
/** "Sem trava do pedido" (25/set) — tira SÓ a recusa "anterior à data do pedido"; "não pode ser no futuro" continua. */
const SEM_TRAVA = "supabase/migrations/20261004100000_nota_entrada_sem_trava_pedido.sql";
const SEM_TRAVA_DOWN = "supabase/rollback/20261004100000_nota_entrada_sem_trava_pedido_down.sql";
/** md5(pg_get_functiondef) de fn_oc_nota_entrada_valida(): da Nota (20261002100000, com a trava do pedido) e desta
 *  migration (20261004100000, sem ela) — .superpowers/nota/mig/md5-depois.txt e md5-sem-trava.txt. */
const MD5_ANTES_TRAVA = "0c3614b75fd6bdbac1b3c862a35b796b";
const MD5_SEM_TRAVA = "96ef34c2bb9014ad92dedfbfa40dc932";
const MIG_TXN = process.env.NOTA_MIG_TXN === "1";
const CAPTURA = process.env.NOTA_CAPTURA_DEPOIS ?? "";
/** R9-b: arquivo onde a medição do laço do inverso grava (chave=valor) — só com NOTA_MIG_TXN=1 (Task 4 Step 2). */
const MEDIR = process.env.NOTA_MEDIR_VOLTA ?? "";
const RODA = hasDb && ehBancoLocal();

/** md5(pg_get_functiondef) das 10 funções redefinidas — cópia em 24/set (= produção em 23/set). */
const MD5_ANTES: Record<string, string> = {
  "public.gerar_parcelas_oc_tecido()": "ac9fb224249f42133f5bf2750aba5d1c",
  "public.gerar_parcelas_oc_aviamento()": "345e55d865a0e4713e6ccbc62f50830d",
  "public.gerar_parcelas_oc_p_acabado()": "1d8286d877f32a437b344a0da1766ccb",
  "public._recalcular_parcelas_core(uuid,text)": "b8af65bc500958202db25ddb5f3d3eed",
  "public.recalcular_parcelas_etiqueta(uuid)": "d60ab89c8c25a830aa7a7789ff97eef0",
  "public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)": "b5255dc864f0e7f9f39236b4b9c531d6",
  "public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)": "56af6c8a9ecb5619be2de1f2068553b3",
  "public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)": "d92d27b1d774ca4d867fc9151f774fda",
  "public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)": "bd8139b1a1b1dee8b4b90e4327cb152c",
  "public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)": "b74cd38a16fa08482551f1fb7e1487bb",
};
/** Funções NOVAS desta migration (o md5 "depois" delas vem do gerador). */
const NOVAS = ["public.fn_oc_nota_entrada_recalc()", "public.fn_oc_nota_entrada_valida()"];
/** Internas: EXECUTE revogado de PUBLIC/anon/authenticated (invariante #9). */
const INTERNAS = [
  "public.fn_oc_nota_entrada_recalc()",
  "public.fn_oc_nota_entrada_valida()",
  "public._recalcular_parcelas_core(uuid,text)",
  "public.recalcular_parcelas_etiqueta(uuid)",
  "public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)",
  "public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)",
  "public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)",
  "public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)",
  "public.gerar_parcelas_oc_tecido()",
  "public.gerar_parcelas_oc_aviamento()",
];

// ───────────── Harness: migration DENTRO da txn, só na cópia (espelha tests/integration/kanban-auto.test.ts:56-128) ─────────────
const RE_BEGIN = /^[ \t]*BEGIN[ \t]*;[ \t]*$/im;
const RE_COMMIT = /^[ \t]*COMMIT[ \t]*;[ \t]*$/im;
const todas = (re: RegExp) => new RegExp(re.source, "gim");
const RE_COMENTARIO_LINHA = /--[^\n]*/g;
const RE_COMENTARIO_BLOCO = /\/\*[\s\S]*?\*\//g;
const RE_TXN_CTRL_SOLTA =
  /(^|;)[ \t]*(BEGIN|COMMIT|ROLLBACK|ABORT|START[ \t]+TRANSACTION|SAVEPOINT|RELEASE|END(?!\s*(IF|LOOP|CASE|WHILE)\b))\b[^\n]*;/im;

/** DDL/migration SÓ na cópia local (decisão 17 do dono; incidente 23/set). */
function exigeBancoLocal(): void {
  if (!ehBancoLocal()) {
    throw new Error(
      "DDL/migration só na cópia local — ver banco-local (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). " +
        "DDL em transação contra produção trava o app de todas as lojas mesmo com ROLLBACK (incidente 23/set).",
    );
  }
}

/** R9/R9-a: as 2 travas ficam NO arquivo, logo depois do `BEGIN;` (psql -f = caminho padrão): lock_timeout SEMPRE 500 ms;
 *  transaction_timeout 3 s na ida e ≥ 30 s no inverso (`gerar_sql.py --tt-inverso`). Na txn do teste o relógio derrubaria
 *  a suíte inteira → o harness EXIGE as 2 linhas na posição certa e as tira. */
const RE_TRAVAS_DO_ARQUIVO = /^BEGIN;\nSET LOCAL lock_timeout = '500ms';\nSET LOCAL transaction_timeout = '(\d+)s';\n/m;
const RE_DDL_POLICY = /^[ \t]*(CREATE|DROP|ALTER)[ \t]+POLICY\b/im;

function semTransacao(sql: string, nome: string): string {
  const nb = (sql.match(todas(RE_BEGIN)) ?? []).length;
  const nc = (sql.match(todas(RE_COMMIT)) ?? []).length;
  if (nb !== 1 || nc !== 1) throw new Error(`${nome}: esperado 1 "BEGIN;" e 1 "COMMIT;" em linha própria (achei ${nb}/${nc})`);
  const travas = RE_TRAVAS_DO_ARQUIVO.exec(sql);
  const ehInverso = nome.includes("/rollback/");
  const tt = travas ? Number(travas[1]) : NaN;
  if (!travas || !(ehInverso ? tt >= 30 : tt === 3))
    throw new Error(
      `${nome}: faltam, logo depois do "BEGIN;", SET LOCAL lock_timeout = '500ms'; e SET LOCAL transaction_timeout = ` +
        `'${ehInverso ? "≥30" : "3"}s'; (R9/R9-a)`,
    );
  if (RE_DDL_POLICY.test(sql))
    throw new Error(`${nome}: DDL de policy dispara o hook supautils.policy_grants (trava auth/storage) — rever o texto da spec §7 e pôr no FIM (R9)`);
  const out = sql
    .replace(RE_TRAVAS_DO_ARQUIVO, "BEGIN;\n-- [harness] travas de tempo removidas (valem no psql -f / aplica_v2, não na txn do teste)\n")
    .replace(todas(RE_BEGIN), "-- [harness] BEGIN removido")
    .replace(todas(RE_COMMIT), "-- [harness] COMMIT removido");
  const foraDeCorpos = out
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "")
    .replace(RE_COMENTARIO_BLOCO, "")
    .replace(RE_COMENTARIO_LINHA, "");
  if (RE_TXN_CTRL_SOLTA.test(foraDeCorpos)) throw new Error(`${nome}: controle de transação fora de corpo de função — recusado`);
  if (/^[ \t]*\\/m.test(foraDeCorpos)) throw new Error(`${nome}: meta-comando psql (\\i, \\set…) — recusado`);
  return out;
}

async function aplicarArquivo(c: Client, rel: string, antes = ""): Promise<void> {
  exigeBancoLocal(); // 1ª linha, estrutural: nenhum chamador aplica DDL fora da cópia
  const sql = semTransacao(readFileSync(ROOT + rel, "utf8"), rel);
  await c.query("SAVEPOINT nota_mig");
  try {
    if (antes) await c.query(antes);
    await c.query(sql);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT nota_mig");
    throw e;
  }
  await c.query("RELEASE SAVEPOINT nota_mig");
}

async function colunas(c: Client): Promise<number> {
  const r = await um<{ n: string }>(
    c,
    `select count(*) n from information_schema.columns where table_schema = 'public' and column_name = 'data_nota_entrada'
       and table_name in ('ocs_tecido','ocs_aviamento','ocs_etiqueta','ocs_p_acabado','ocs_importado')`,
  );
  return Number(r.n);
}

async function timeouts(c: Client): Promise<void> {
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '120s'");
}

/** Timeouts + (MIG_TXN) migration na txn + exige as 5 colunas + usuário da Loja Teste. */
async function prepara(c: Client): Promise<void> {
  await timeouts(c);
  if (MIG_TXN) {
    if ((await colunas(c)) !== 0) {
      throw new Error("NOTA_MIG_TXN=1 exige a cópia SEM a migration — rode sem a variável, ou desfaça antes (bash .superpowers/nota/copia.sh volta).");
    }
    await aplicarArquivo(c, MIG);
  }
  if ((await colunas(c)) !== 5) throw new Error("migration ausente na cópia — rode com NOTA_MIG_TXN=1 ou aplique-a (Task 4 / Task 12).");
  await comoUsuario(c);
}

// ───────────── Fixtures (dados já existentes da Loja Teste; tudo criado aqui morre no ROLLBACK) ─────────────
const COL = { tecido: "oc_tecido_id", aviamento: "oc_aviamento_id", etiqueta: "oc_etiqueta_id", p_acabado: "oc_p_acabado_id", p_importado: "oc_importado_id" } as const;
type Familia = keyof typeof COL;
type Parc = { id: string; n: number; valor: string; venc: string; status: string; pago_em: string | null; offset: number | null };
type Fix = { emp: string; art: string; var: string; aviId: string; aviEmp: string; etqId: string; etqVar: string | null };

async function fixtures(c: Client): Promise<Fix> {
  const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id = $1 order by id limit 1`, [TENANT_TESTE]);
  const tec = await um<{ art: string; var: string } | undefined>(
    c, `select a.id art, v.id var from variantes_tecido v join artigos a on a.id = v.artigo_id where a.tenant_id = $1 order by v.id limit 1`, [TENANT_TESTE]);
  const avi = await um<{ id: string; emp: string } | undefined>(
    c, `select id, empresa_id emp from aviamentos where tenant_id = $1 and coalesce(preco,0) > 0 and empresa_id is not null order by id limit 1`, [TENANT_TESTE]);
  const etq = await um<{ id: string; var: string | null } | undefined>(
    c, `select e.id, (select v.id from variantes_etiqueta v where v.etiqueta_id = e.id order by v.id limit 1) var
          from etiquetas e where e.tenant_id = $1 order by e.id limit 1`, [TENANT_TESTE]);
  if (!emp || !tec || !avi || !etq) throw new Error("Loja Teste sem fixture (empresa / tecido / aviamento com preço / insumo) — conferir a cópia");
  return { emp: emp.id, art: tec.art, var: tec.var, aviId: avi.id, aviEmp: avi.emp, etqId: etq.id, etqVar: etq.var };
}

async function parcelas(c: Client, f: Familia, ocId: string): Promise<Parc[]> {
  const { rows } = await c.query(
    `select id, numero_parcela n, valor::numeric(14,2)::text valor, to_char(data_vencimento, 'YYYY-MM-DD') venc, status,
            to_char(data_pagamento, 'YYYY-MM-DD') pago_em, dias_offset "offset"
       from public.parcelas where ${COL[f]} = $1 order by numero_parcela`,
    [ocId],
  );
  return rows as Parc[];
}
// nº de pedido termina em dígitos: o core incrementa em caso de repetição (sem dígito finais ele entraria em laço).
const semId = (ps: Parc[]) => ps.map(({ id: _id, ...r }) => r);
/** Σ em CENTAVOS inteiros (sem float). */
const centavos = (ps: Parc[]) => ps.reduce((s, p) => s + Math.round(Number(p.valor) * 100), 0);
const centavosDe = (v: string) => Math.round(Number(v) * 100);
async function pagar(c: Client, id: string): Promise<void> {
  await c.query(`update public.parcelas set status = 'pago', data_pagamento = '2026-09-20' where id = $1`, [id]);
}
async function notaDe(c: Client, tabela: string, id: string): Promise<string | null> {
  return (await um<{ d: string | null }>(c, `select to_char(data_nota_entrada, 'YYYY-MM-DD') d from public.${tabela} where id = $1`, [id])).d;
}

async function ocTecido(c: Client, fx: Fix, extra: Record<string, unknown> = {}, id: string | null = null): Promise<string> {
  const oc = {
    numero_pedido: "NOTA-TEC-90001", empresa_id: fx.emp, data_prevista_entrega: "2026-09-01", data_entrega: "2026-09-10",
    prazo_pagamento: "30/60/90", quantidade_prazos: 3, parcelas_recebimento: [], valor_previsto_total: 1000, valor_real_total: 1000,
    status: "recebido", ...extra,
  };
  const item = id ? await um<{ id: string }>(c, `select id from ocs_tecido_itens where oc_tecido_id = $1`, [id]) : null;
  const itens = [{
    id: item?.id ?? null, artigo_id: fx.art, artigo_numero: 1, variante_tecido_id: fx.var, quantidade_pedida: 100,
    quantidade_recebida: 100, rendimento: null, cancelado: false, preco: 10,
  }];
  return (await um<{ id: string }>(c, `select public._salvar_oc_tecido_core($1::uuid, $2::jsonb, $3::jsonb, null::int) as id`,
    [id, JSON.stringify(oc), JSON.stringify(itens)])).id;
}

async function ocAviamento(c: Client, fx: Fix, extra: Record<string, unknown> = {}, id: string | null = null): Promise<string> {
  const oc = {
    numero_pedido: "NOTA-AVI-90001", responsavel_nome: null, empresa_id: fx.aviEmp, representante_id: null, data_pedido: "2026-09-01",
    data_prevista_entrega: "2026-09-05", data_entrega: "2026-09-10", prazo_pagamento: "30/60", quantidade_prazos: 2, nf_url: null,
    parcelas_recebimento: [], status: "recebido", ...extra,
  };
  const itens = id
    ? (await c.query(`select id, aviamento_id, variante_aviamento_id, quantidade_pedida, quantidade_recebida, cancelado
                        from ocs_aviamento_itens where oc_aviamento_id = $1`, [id])).rows
    : [{ id: null, aviamento_id: fx.aviId, variante_aviamento_id: null, quantidade_pedida: 100, quantidade_recebida: 100, cancelado: false }];
  // 4 args explícitos: existe também o overload de 3 args (débito conhecido) — 3 args aqui seria ambíguo.
  return (await um<{ id: string }>(c, `select public._salvar_oc_aviamento_core($1::uuid, $2::jsonb, $3::jsonb, null::int) as id`,
    [id, JSON.stringify(oc), JSON.stringify(itens)])).id;
}

async function ocInsumo(c: Client, fx: Fix, extra: Record<string, unknown> = {}, id: string | null = null): Promise<string> {
  const oc = {
    numero_pedido: "NOTA-INS-90001", responsavel_nome: null, empresa_id: fx.emp, representante_id: null, data_pedido: "2026-09-01",
    data_prevista_entrega: "2026-09-05", data_entrega: "2026-09-10", prazo_pagamento: "30/60", quantidade_prazos: 2, nf_url: null,
    nfs: [], parcelas_recebimento: [], status: "recebido", ...extra,
  };
  const itens = id
    ? (await c.query(`select id, etiqueta_id, variante_etiqueta_id, quantidade_pedida, quantidade_recebida, preco, cancelado
                        from ocs_etiqueta_itens where oc_etiqueta_id = $1`, [id])).rows
    : [{ id: null, etiqueta_id: fx.etqId, variante_etiqueta_id: fx.etqVar, quantidade_pedida: 100, quantidade_recebida: 100, preco: 2.5, cancelado: false }];
  return (await um<{ id: string }>(c, `select public.salvar_oc_etiqueta($1::uuid, $2::jsonb, $3::jsonb, null::int) as id`,
    [id, JSON.stringify(oc), JSON.stringify(itens)])).id;
}

async function ocPAcabado(c: Client, fx: Fix, extra: Record<string, unknown> = {}, id: string | null = null): Promise<string> {
  const dados = {
    nome_produto: "NOTA-PA", empresa_id: fx.emp, data_pedido: "2026-09-01", prazo_pagamento: "30/60", qtd_total: 10,
    valor_unitario: 100, desconto_pct: 0, grade_proporcao: {}, variantes: [], ...extra,
  };
  const grade = { "1": { P: { pedida: 10, recebida: 0, defeito: 0 } } };
  return (await um<{ id: string }>(c, `select public._salvar_oc_p_acabado_core($1::uuid, $2::jsonb, $3::jsonb, null::int) as id`,
    [id, JSON.stringify(dados), JSON.stringify(grade)])).id;
}

/** Re-salva a OC de importado com os dados ATUAIS dela (+ extra) — pelo core, igual ao front. */
async function salvarImportado(c: Client, ocId: string, extra: Record<string, unknown> = {}, semChave = false): Promise<void> {
  const r = await um<{ j: Record<string, unknown>; g: unknown; e: unknown }>(
    c,
    `select to_jsonb(o) j, o.grade_detalhe g,
            coalesce((select jsonb_agg(jsonb_build_object('ordem', e.ordem, 'rotulo', e.rotulo, 'base', e.base,
                        'percentual', e.percentual, 'data_vencimento', e.data_vencimento, 'cotacao', e.cotacao) order by e.ordem)
                        from ocs_importado_etapas e where e.oc_importado_id = o.id), '[]'::jsonb) e
       from ocs_importado o where o.id = $1`,
    [ocId],
  );
  const dados: Record<string, unknown> = { ...r.j, ...extra };
  if (semChave) delete dados.data_nota_entrada;
  await c.query(`select public._salvar_oc_importado_core($1::uuid, $2::jsonb, $3::jsonb, $4::jsonb, null::int)`,
    [ocId, JSON.stringify(dados), JSON.stringify(r.g), JSON.stringify(r.e)]);
}

const totalAviamento = async (c: Client, id: string) => centavosDe((await um<{ t: string }>(c,
  `select coalesce(sum(coalesce(it.quantidade_recebida, it.quantidade_pedida, 0) * coalesce(a.preco, 0)), 0)::numeric(12,2)::text t
     from ocs_aviamento_itens it left join aviamentos a on a.id = it.aviamento_id
    where it.oc_aviamento_id = $1 and not coalesce(it.cancelado, false)`, [id])).t);
const totalInsumo = async (c: Client, id: string) => centavosDe((await um<{ t: string }>(c,
  `select coalesce(sum(coalesce(quantidade_recebida, quantidade_pedida, 0) * coalesce(preco, 0)), 0)::numeric(12,2)::text t
     from ocs_etiqueta_itens where oc_etiqueta_id = $1 and not coalesce(cancelado, false)`, [id])).t);

// ───────────────────────────────────────────── Testes ─────────────────────────────────────────────
describe.skipIf(!RODA)("Data da Nota de Entrada — banco (só na cópia local)", () => {
  it("ACL (#9): internas sem EXECUTE para anon/authenticated; RPCs de sempre seguem para authenticated", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const f of INTERNAS) {
        const r = await um<{ a: boolean; u: boolean }>(c,
          `select has_function_privilege('anon', $1, 'EXECUTE') a, has_function_privilege('authenticated', $1, 'EXECUTE') u`, [f]);
        expect({ f, anon: r.a, auth: r.u }).toEqual({ f, anon: false, auth: false });
      }
      for (const f of ["public.recalcular_parcelas(uuid,text)", "public.salvar_oc_tecido(uuid,jsonb,jsonb,integer)",
        "public.salvar_oc_aviamento(uuid,jsonb,jsonb,integer)", "public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)",
        "public.salvar_oc_p_acabado(uuid,jsonb,jsonb,integer)", "public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb,integer)"]) {
        const r = await um<{ u: boolean }>(c, `select has_function_privilege('authenticated', $1, 'EXECUTE') u`, [f]);
        expect({ f, auth: r.u }).toEqual({ f, auth: true });
      }
    });
  });

  it("Tecido: com a data, vencimento = data + prazo; mudar a data (RPC) só move as NÃO pagas; paga intacta; Σ = total", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const id = await ocTecido(c, fx, { data_nota_entrada: "2026-09-05" });
      const p1 = await parcelas(c, "tecido", id);
      expect(p1.map((p) => p.venc)).toEqual(["2026-10-05", "2026-11-04", "2026-12-04"]);
      expect(centavos(p1)).toBe(100000);
      await pagar(c, p1[0].id);
      const paga = (await parcelas(c, "tecido", id))[0];
      await ocTecido(c, fx, { data_nota_entrada: "2026-09-15" }, id);
      const p2 = await parcelas(c, "tecido", id);
      expect(p2[0]).toEqual(paga); // mesma linha: id, valor, vencimento, status, data de pagamento
      expect(p2.slice(1).map((p) => p.venc)).toEqual(["2026-11-14", "2026-12-14"]);
      expect(p2.slice(1).map((p) => p.valor)).toEqual(["333.34", "333.33"]); // restante 666,67 em 2 (o último absorve o resto)
      expect(centavos(p2)).toBe(100000);
      expect(await notaDe(c, "ocs_tecido", id)).toBe("2026-09-15");
    });
  });

  it("Tecido: UPDATE direto da data também recalcula (gatilho); OC encomendada não ganha parcela", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const id = await ocTecido(c, fx, { data_nota_entrada: "2026-09-05" });
      await pagar(c, (await parcelas(c, "tecido", id))[0].id);
      const paga = (await parcelas(c, "tecido", id))[0];
      await c.query(`update public.ocs_tecido set data_nota_entrada = '2026-09-15' where id = $1`, [id]);
      const p = await parcelas(c, "tecido", id);
      expect(p[0]).toEqual(paga);
      expect(p.slice(1).map((x) => x.venc)).toEqual(["2026-11-14", "2026-12-14"]);
      expect(centavos(p)).toBe(100000);
      const enc = await ocTecido(c, fx, { status: "encomendado", numero_pedido: "NOTA-TEC-90002" });
      await c.query(`update public.ocs_tecido set data_nota_entrada = '2026-09-15' where id = $1`, [enc]);
      expect(await parcelas(c, "tecido", enc)).toEqual([]);
    });
  });

  it("Tecido: chave ausente (front antigo) MANTÉM a data; '' e null LIMPAM e voltam à base da entrega", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const id = await ocTecido(c, fx, { data_nota_entrada: "2026-09-05" });
      await ocTecido(c, fx, {}, id); // payload SEM a chave
      expect(await notaDe(c, "ocs_tecido", id)).toBe("2026-09-05");
      expect((await parcelas(c, "tecido", id)).map((p) => p.venc)).toEqual(["2026-10-05", "2026-11-04", "2026-12-04"]);
      await ocTecido(c, fx, { data_nota_entrada: "" }, id);
      expect(await notaDe(c, "ocs_tecido", id)).toBeNull();
      expect((await parcelas(c, "tecido", id)).map((p) => p.venc)).toEqual(["2026-10-10", "2026-11-09", "2026-12-09"]);
      await ocTecido(c, fx, { data_nota_entrada: "2026-09-05" }, id);
      await ocTecido(c, fx, { data_nota_entrada: null }, id);
      expect(await notaDe(c, "ocs_tecido", id)).toBeNull();
    });
  });

  it("Aviamento: data + mudança só nas não pagas + paga intacta + Σ = total", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const id = await ocAviamento(c, fx, { data_nota_entrada: "2026-09-05" });
      const total = await totalAviamento(c, id);
      const p1 = await parcelas(c, "aviamento", id);
      expect(p1.map((p) => p.venc)).toEqual(["2026-10-05", "2026-11-04"]);
      expect(centavos(p1)).toBe(total);
      await pagar(c, p1[0].id);
      const paga = (await parcelas(c, "aviamento", id))[0];
      await ocAviamento(c, fx, { data_nota_entrada: "2026-09-15" }, id);
      const p2 = await parcelas(c, "aviamento", id);
      expect(p2[0]).toEqual(paga);
      expect(p2[1].venc).toBe("2026-11-14");
      expect(centavos(p2)).toBe(total);
      await c.query(`update public.ocs_aviamento set data_nota_entrada = '2026-09-20' where id = $1`, [id]);
      const p3 = await parcelas(c, "aviamento", id);
      expect(p3[0]).toEqual(paga);
      expect(p3[1].venc).toBe("2026-11-19");
      expect(centavos(p3)).toBe(total);
      // N5: espelha o "encomendada não ganha parcela" do Tecido — o gerador só roda com status='recebido'.
      const enc = await ocAviamento(c, fx, { status: "encomendado", numero_pedido: "NOTA-AVI-90002" });
      await c.query(`update public.ocs_aviamento set data_nota_entrada = '2026-09-15' where id = $1`, [enc]);
      expect(await parcelas(c, "aviamento", enc)).toEqual([]);
    });
  });

  it("Insumo: data + mudança só nas não pagas + paga intacta + Σ = total", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const id = await ocInsumo(c, fx, { data_nota_entrada: "2026-09-05" });
      const total = await totalInsumo(c, id);
      const p1 = await parcelas(c, "etiqueta", id);
      expect(p1.map((p) => p.venc)).toEqual(["2026-10-05", "2026-11-04"]);
      expect(centavos(p1)).toBe(total);
      await pagar(c, p1[0].id);
      const paga = (await parcelas(c, "etiqueta", id))[0];
      await ocInsumo(c, fx, { data_nota_entrada: "2026-09-15" }, id);
      const p2 = await parcelas(c, "etiqueta", id);
      expect(p2[0]).toEqual(paga);
      expect(p2[1].venc).toBe("2026-11-14");
      expect(centavos(p2)).toBe(total);
      await c.query(`update public.ocs_etiqueta set data_nota_entrada = '2026-09-20' where id = $1`, [id]);
      const p3 = await parcelas(c, "etiqueta", id);
      expect(p3[0]).toEqual(paga);
      expect(p3[1].venc).toBe("2026-11-19");
      expect(centavos(p3)).toBe(total);
      // N5: espelha o "encomendada não ganha parcela" do Tecido — o gerador só roda com status='recebido'.
      const enc = await ocInsumo(c, fx, { status: "encomendado", numero_pedido: "NOTA-INS-90002" });
      await c.query(`update public.ocs_etiqueta set data_nota_entrada = '2026-09-15' where id = $1`, [enc]);
      expect(await parcelas(c, "etiqueta", enc)).toEqual([]);
    });
  });

  it("N4: UPDATE direto da data sob a role authenticated (papel real do cliente) recalcula igual — Tecido, Aviamento, Insumo", async () => {
    await withTx(async (c) => {
      await prepara(c); // comoUsuario faz UPDATE em public.users — precisa rodar ANTES do SET LOCAL ROLE (RLS de users)
      const fx = await fixtures(c);
      const tec = await ocTecido(c, fx, { data_nota_entrada: "2026-09-05" });
      await pagar(c, (await parcelas(c, "tecido", tec))[0].id);
      const pagaTec = (await parcelas(c, "tecido", tec))[0];
      const avi = await ocAviamento(c, fx, { data_nota_entrada: "2026-09-05" });
      await pagar(c, (await parcelas(c, "aviamento", avi))[0].id);
      const pagaAvi = (await parcelas(c, "aviamento", avi))[0];
      const ins = await ocInsumo(c, fx, { data_nota_entrada: "2026-09-05" });
      await pagar(c, (await parcelas(c, "etiqueta", ins))[0].id);
      const pagaIns = (await parcelas(c, "etiqueta", ins))[0];

      await c.query("SET LOCAL ROLE authenticated"); // papel REAL do cliente — não só a superusuária postgres do harness
      await c.query(`update public.ocs_tecido set data_nota_entrada = '2026-09-15' where id = $1`, [tec]);
      await c.query(`update public.ocs_aviamento set data_nota_entrada = '2026-09-15' where id = $1`, [avi]);
      await c.query(`update public.ocs_etiqueta set data_nota_entrada = '2026-09-15' where id = $1`, [ins]);
      await c.query("RESET ROLE"); // volta a postgres para as leituras/asserções seguintes na mesma txn

      const pTec = await parcelas(c, "tecido", tec);
      expect(pTec[0]).toEqual(pagaTec);
      expect(pTec.slice(1).map((x) => x.venc)).toEqual(["2026-11-14", "2026-12-14"]);
      const pAvi = await parcelas(c, "aviamento", avi);
      expect(pAvi[0]).toEqual(pagaAvi);
      expect(pAvi[1].venc).toBe("2026-11-14");
      const pIns = await parcelas(c, "etiqueta", ins);
      expect(pIns[0]).toEqual(pagaIns);
      expect(pIns[1].venc).toBe("2026-11-14");
    });
  });

  it("P. Acabado: a data já é a base antes do recebimento; mudar só move as não pagas; paga intacta; Σ = total", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const id = await ocPAcabado(c, fx, { data_nota_entrada: "2026-09-05" });
      const p1 = await parcelas(c, "p_acabado", id);
      expect(p1.map((p) => p.venc)).toEqual(["2026-10-05", "2026-11-04"]);
      expect(centavos(p1)).toBe(100000);
      await pagar(c, p1[0].id);
      const paga = (await parcelas(c, "p_acabado", id))[0];
      await ocPAcabado(c, fx, { data_nota_entrada: "2026-09-15" }, id);
      const p2 = await parcelas(c, "p_acabado", id);
      expect(p2[0]).toEqual(paga);
      expect(p2[1].venc).toBe("2026-11-14");
      expect(centavos(p2)).toBe(100000);
      // sem a data a base é o pedido (hoje) — e o UPDATE direto da data re-dispara o gerador
      const id2 = await ocPAcabado(c, fx, { nome_produto: "NOTA-PA-2" });
      expect((await parcelas(c, "p_acabado", id2)).map((p) => p.venc)).toEqual(["2026-10-01", "2026-10-31"]);
      await c.query(`update public.ocs_p_acabado set data_nota_entrada = '2026-09-05' where id = $1`, [id2]);
      expect((await parcelas(c, "p_acabado", id2)).map((p) => p.venc)).toEqual(["2026-10-05", "2026-11-04"]);
      // N5 (P. Acabado): ao contrário de Tecido/Aviamento/Insumo, o gerador do P. Acabado NÃO checa status='recebido'
      // (invariante #13: parcelas nascem no PEDIDO, não no recebimento) — id2 acima nunca deixou o default
      // 'encomendado' e MESMO ASSIM já tem parcela; confirmando aqui de propósito para não confundir com um
      // "encomendada não ganha parcela" falso nesta família.
      expect((await um<{ s: string }>(c, `select status s from public.ocs_p_acabado where id = $1`, [id2])).s).toBe("encomendado");
      expect((await parcelas(c, "p_acabado", id2)).length).toBeGreaterThan(0);
    });
  });

  it("Importado: só registra — as parcelas (etapas de câmbio) ficam idênticas com e sem a data", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const oc = await um<{ id: string } | undefined>(c,
        `select id from ocs_importado o where tenant_id = $1 and exists (select 1 from parcelas p where p.oc_importado_id = o.id)
          order by id limit 1`, [TENANT_TESTE]);
      if (!oc) throw new Error("Loja Teste sem OC de importado com parcelas — conferir a cópia");
      await salvarImportado(c, oc.id, {}, true); // controle: re-salvar como está (sem a chave)
      const base = semId(await parcelas(c, "p_importado", oc.id));
      expect(base.length).toBeGreaterThan(0);
      await salvarImportado(c, oc.id, { data_nota_entrada: "2026-09-10" });
      expect(await notaDe(c, "ocs_importado", oc.id)).toBe("2026-09-10");
      expect(semId(await parcelas(c, "p_importado", oc.id))).toEqual(base);
      await c.query(`update public.ocs_importado set data_nota_entrada = '2026-09-20' where id = $1`, [oc.id]);
      expect(semId(await parcelas(c, "p_importado", oc.id))).toEqual(base);
    });
  });

  it("caminho 0c36→96ef DENTRO da txn: aplica a sem-trava a partir do texto puro da Nota, determinístico", async () => {
    // Normaliza para o texto da Nota PRIMEIRO (o inverso aceita ambos os pontos de partida — idempotente),
    // garantindo o ponto de partida 0c36… independente do estado real da cópia, e só então aplica a migration
    // pra frente — prova determinística do caminho 0c36→96ef, sem depender de qual estado a cópia está agora.
    await withTx(async (c) => {
      await prepara(c);
      await aplicarArquivo(c, SEM_TRAVA_DOWN);
      const md5Antes = (await um<{ m: string }>(c, `select md5(pg_get_functiondef(to_regprocedure('public.fn_oc_nota_entrada_valida()'))) m`)).m;
      expect(md5Antes).toBe(MD5_ANTES_TRAVA);
      await aplicarArquivo(c, SEM_TRAVA);
      const md5Depois = (await um<{ m: string }>(c, `select md5(pg_get_functiondef(to_regprocedure('public.fn_oc_nota_entrada_valida()'))) m`)).m;
      expect(md5Depois).toBe(MD5_SEM_TRAVA);
    });
  });

  it("D7 sem a trava do pedido (decisão NOVA do dono, 25/set): anterior ao pedido é ACEITA; futura continua recusada", async () => {
    // Aplica a SEM_TRAVA na PRÓPRIA transação — não depende do estado atual da cópia (a Nota já vem aplicada
    // por `prepara`; SEM_TRAVA é aplicada aqui dentro, sempre, revertida no fim pelo withTx→ROLLBACK).
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      // Ponto de partida: a cópia pode já estar com a Nota pura (0c36…) OU já com a sem-trava aplicada PARA
      // FICAR (96ef…, .superpowers/nota/copia-estado.md) — a guarda da migration aceita os dois (idempotente).
      // Se o ponto de partida já é 0c36…, este bloco PROVA o caminho 0c36→96ef dentro da txn; se já é 96ef…,
      // prova a reaplicação idempotente (fica 96ef…) — os dois são cobertos pela mesma migration/guarda.
      const md5Antes = (await um<{ m: string }>(c, `select md5(pg_get_functiondef(to_regprocedure('public.fn_oc_nota_entrada_valida()'))) m`)).m;
      expect([MD5_ANTES_TRAVA, MD5_SEM_TRAVA]).toContain(md5Antes);
      await aplicarArquivo(c, SEM_TRAVA); // migration desta frente, na MESMA txn (nunca \i)
      // Depois de aplicar, SEMPRE o md5 desta migration — provando o caminho 0c36→96ef quando o ponto de
      // partida era 0c36…, ou a reaplicação idempotente quando já era 96ef….
      const md5Depois = (await um<{ m: string }>(c, `select md5(pg_get_functiondef(to_regprocedure('public.fn_oc_nota_entrada_valida()'))) m`)).m;
      expect(md5Depois).toBe(MD5_SEM_TRAVA);
      if (md5Antes === MD5_ANTES_TRAVA) {
        // ponto de partida ERA o texto puro da Nota: prova explícita do caminho 0c36→96ef nesta rodada.
        expect(md5Antes).not.toBe(md5Depois);
      }

      const futura = (await um<{ d: string }>(c, `select to_char(current_date + 400, 'YYYY-MM-DD') d`)).d;
      const recusa = async (fn: () => Promise<unknown>, re: RegExp) => {
        await c.query("SAVEPOINT nota_sem_trava");
        let msg = "(aceitou)";
        try { await fn(); } catch (e) { msg = String((e as Error).message); }
        await c.query("ROLLBACK TO SAVEPOINT nota_sem_trava");
        expect(msg).toMatch(re);
      };
      // NOVO: anterior ao pedido (01/09) agora é ACEITA — pela RPC e por UPDATE direto.
      const id = await ocAviamento(c, fx, { data_nota_entrada: "2026-08-31" });
      expect(await notaDe(c, "ocs_aviamento", id)).toBe("2026-08-31");
      await ocPAcabado(c, fx, { data_nota_entrada: "2026-08-01" }); // bem antes do pedido (01/09) — aceita
      await c.query(`update public.ocs_aviamento set data_nota_entrada = '2026-07-01' where id = $1`, [id]);
      expect(await notaDe(c, "ocs_aviamento", id)).toBe("2026-07-01");
      // M1 (mantido): mover o PEDIDO pra depois da nota já gravada não é mais recusado (a trava sumiu de vez).
      await c.query(`update public.ocs_aviamento set data_pedido = '2026-09-02' where id = $1`, [id]);
      expect((await um<{ d: string }>(c, `select to_char(data_pedido, 'YYYY-MM-DD') d from public.ocs_aviamento where id = $1`, [id])).d)
        .toBe("2026-09-02");
      // "não pode ser no futuro" CONTINUA valendo (não foi pedido tirar).
      await recusa(() => ocAviamento(c, fx, { data_nota_entrada: futura }), /não pode ser no futuro/);
      await recusa(() => c.query(`update public.ocs_aviamento set data_nota_entrada = $2::date where id = $1`, [id, futura]),
        /não pode ser no futuro/);
      // N3 (recuperada, adaptada à regra nova): dado LEGADO gravado com o gatilho desligado (grandfather data) —
      // um UPDATE de coluna que NÃO é nota/pedido não revalida (mesmo comportamento de antes; a regra que sumiu
      // era só a checagem "anterior ao pedido" em si, não a condição de quando o gatilho revalida).
      await c.query(`ALTER TABLE public.ocs_aviamento DISABLE TRIGGER trg_nota_entrada_valida`);
      const idLegado = await ocAviamento(c, fx, { numero_pedido: "NOTA-AVI-90003", data_pedido: "2026-09-10", data_nota_entrada: futura });
      await c.query(`ALTER TABLE public.ocs_aviamento ENABLE TRIGGER trg_nota_entrada_valida`);
      expect(await notaDe(c, "ocs_aviamento", idLegado)).toBe(futura); // nota futura: já inválida mesmo sem a trava do pedido
      await c.query(`update public.ocs_aviamento set responsavel_nome = 'legado ok' where id = $1`, [idLegado]);
      expect(await notaDe(c, "ocs_aviamento", idLegado)).toBe(futura); // segue lá — não revalidou, não recusou
      // re-salvar pela RPC sem tocar nota/pedido também não revalida
      await ocAviamento(c, fx, { numero_pedido: "NOTA-AVI-90003", data_pedido: "2026-09-10", data_nota_entrada: futura }, idLegado);
      expect(await notaDe(c, "ocs_aviamento", idLegado)).toBe(futura);
      // ACL segue igual (invariante #9).
      const acl = await um<{ a: boolean; u: boolean }>(c,
        `select has_function_privilege('anon', 'public.fn_oc_nota_entrada_valida()', 'EXECUTE') a,
                has_function_privilege('authenticated', 'public.fn_oc_nota_entrada_valida()', 'EXECUTE') u`);
      expect(acl).toEqual({ a: false, u: false });
    });
  });

  it("guarda de md5 da migration sem-trava: função num texto estranho → RAISE (não aplica)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      // Corrompe o texto vivo da função (fora dos 2 textos aceitos: o da Nota ou o desta migration) ANTES de
      // tentar aplicar SEM_TRAVA — a guarda dela tem de recusar.
      await c.query(`create or replace function public.fn_oc_nota_entrada_valida() returns trigger
        language plpgsql security definer set search_path to 'public' as $f$
        begin return new; end; $f$`);
      await expect(aplicarArquivo(c, SEM_TRAVA)).rejects.toThrow(/não está nem no texto da Nota.*nem no desta migration/);
    });
  });

  it("guarda de md5 do inverso sem-trava: função num texto estranho → RAISE (não aplica)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await aplicarArquivo(c, SEM_TRAVA);
      // Corrompe DEPOIS de aplicar a sem-trava (fora dos 2 textos aceitos pelo inverso: o da Nota ou o desta
      // migration) — o inverso tem de recusar.
      await c.query(`create or replace function public.fn_oc_nota_entrada_valida() returns trigger
        language plpgsql security definer set search_path to 'public' as $f$
        begin return new; end; $f$`);
      await expect(aplicarArquivo(c, SEM_TRAVA_DOWN)).rejects.toThrow(/foi mudada por outra frente depois da migration/);
    });
  });

  it("inverso da trava-do-pedido: restaura a recusa 'anterior ao pedido' byte a byte (md5 volta ao da Nota)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await aplicarArquivo(c, SEM_TRAVA);
      await aplicarArquivo(c, SEM_TRAVA_DOWN);
      const md5 = (await um<{ m: string }>(c, `select md5(pg_get_functiondef(to_regprocedure('public.fn_oc_nota_entrada_valida()'))) m`)).m;
      expect(md5).toBe(MD5_ANTES_TRAVA); // = o md5 da Nota (20261002100000) — a trava do pedido voltou
      const fx = await fixtures(c);
      await expect(ocAviamento(c, fx, { data_nota_entrada: "2026-08-31" }))
        .rejects.toThrow(/não pode ser anterior à data do pedido \(01\/09\/2026\)/);
    });
  });

  // ─────────────── Só com NOTA_MIG_TXN=1 (precisam do estado de ANTES da migration) ───────────────
  it.skipIf(!MIG_TXN)("sem a data = o de hoje, byte a byte (4 famílias, com e sem entrega, com paga e recálculo)", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      if ((await colunas(c)) !== 0) throw new Error("a cópia já tem a migration — este teste exige o estado de ANTES");
      await comoUsuario(c);
      const cenario = async () => {
        const fx = await fixtures(c);
        const tecA = await ocTecido(c, fx);
        await pagar(c, (await parcelas(c, "tecido", tecA))[0].id);
        await ocTecido(c, fx, { valor_real_total: 1200 }, tecA); // recálculo com paga
        const tecB = await ocTecido(c, fx, { numero_pedido: "NOTA-TEC-90003", data_entrega: null, prazo_pagamento: "30, 60" });
        const avi = await ocAviamento(c, fx);
        const ins = await ocInsumo(c, fx);
        const pa = await ocPAcabado(c, fx);
        await ocPAcabado(c, fx, { desconto_pct: 10 }, pa);
        return {
          tecA: semId(await parcelas(c, "tecido", tecA)), tecB: semId(await parcelas(c, "tecido", tecB)),
          avi: semId(await parcelas(c, "aviamento", avi)), ins: semId(await parcelas(c, "etiqueta", ins)),
          pa: semId(await parcelas(c, "p_acabado", pa)),
        };
      };
      await c.query("SAVEPOINT nota_hoje");
      const hoje = await cenario(); // funções de 24/set
      await c.query("ROLLBACK TO SAVEPOINT nota_hoje");
      await aplicarArquivo(c, MIG);
      const depois = await cenario(); // funções novas, payload SEM a chave
      expect(depois).toEqual(hoje);
      expect(hoje.tecA.length).toBe(3);
      expect(hoje.pa.length).toBe(2);
    });
  });

  it.skipIf(!MIG_TXN)("idempotente e ACL igual à de antes: aplicar 2× não muda as 10 funções", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      if ((await colunas(c)) !== 0) throw new Error("a cópia já tem a migration — este teste exige o estado de ANTES");
      const estado = async () => (await c.query(
        `select p.oid::regprocedure::text sig, md5(pg_get_functiondef(p.oid)) md5, coalesce(array_to_string(p.proacl, ','), '') acl
           from pg_proc p where p.oid = any ($1::regprocedure[]) order by 1`, [Object.keys(MD5_ANTES)])).rows as { sig: string; md5: string; acl: string }[];
      const antes = await estado();
      expect(antes.length).toBe(10); // N5: afirma que vieram as 10 linhas — um for-of vazio passaria os asserts abaixo à toa
      for (const r of antes) expect(r.md5).toBe(MD5_ANTES[`public.${r.sig}`] ?? MD5_ANTES[r.sig]);
      await aplicarArquivo(c, MIG);
      const d1 = await estado();
      expect(d1.map((r) => r.acl)).toEqual(antes.map((r) => r.acl)); // CREATE OR REPLACE + REVOKE reafirmado: ACL de antes
      await aplicarArquivo(c, MIG);
      expect(await estado()).toEqual(d1);
      expect(await colunas(c)).toBe(5);
      const n = await um<{ n: string }>(c, `select count(*) n from pg_trigger where not tgisinternal and tgname = 'trg_nota_entrada_recalc'`);
      expect(Number(n.n)).toBe(3);
      const v = await um<{ n: string }>(c, `select count(*) n from pg_trigger where not tgisinternal and tgname = 'trg_nota_entrada_valida'`);
      expect(Number(v.n)).toBe(5);
    });
  });

  it.skipIf(!MIG_TXN)("R2: função mudada por outra frente (ainda com data_nota_entrada) é RECUSADA pela migration e pelo inverso", async () => {
    await withTx(async (c) => {
      await prepara(c); // aplica a migration na txn
      const sig = "public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)";
      const def = (await um<{ d: string }>(c, `select pg_get_functiondef($1::regprocedure) d`, [sig])).d;
      expect(def).toContain("data_nota_entrada");
      exigeBancoLocal(); // DDL de teste: só na cópia
      await c.query(def.replace("AS $function$\n", "AS $function$\n-- mudança de outra frente (teste R2)\n"));
      await expect(aplicarArquivo(c, MIG)).rejects.toThrow(/nem no texto de 24\/set nem no desta migration/);
      await expect(aplicarArquivo(c, DOWN, "SET LOCAL app.confirmo_apagar_data_nota_entrada = 'sim'"))
        .rejects.toThrow(/foi mudada por outra frente/);
      expect(await colunas(c)).toBe(5); // as duas recusas não deixaram nada pela metade
    });
  });

  it.skipIf(!MIG_TXN)("inverso: recusa sem confirmação; com ela volta as 10 funções (md5 de 24/set) e a base ANTIGA das não pagas nas 4 famílias (R9-a/R9-b: funções → laço → gatilhos → repasse → colunas)", async () => {
    // R9-b: a ORDEM do arquivo (o laço antes das travas exclusivas; o repasse depois do DROP TRIGGER, antes das colunas)
    // R9-c: só CÓDIGO — as linhas de comentário saem antes (o cabeçalho do inverso cita "DROP TRIGGER/DROP COLUMN").
    const inv = readFileSync(ROOT + DOWN, "utf8").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    const pos = [
      "CREATE OR REPLACE FUNCTION public.gerar_parcelas_oc_tecido()", // passo 2 (a 1ª das 10 funções restauradas)
      "DO $volta$",                                                    // passo 3 (laço)
      "DROP TRIGGER IF EXISTS trg_nota_entrada_recalc ON public.ocs_tecido", // passo 4
      "DO $repasse$",                                                  // passo 4b
      "ALTER TABLE public.ocs_tecido DROP COLUMN",                     // passo 5
    ].map((m) => inv.indexOf(m));
    expect(pos.every((p) => p > 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    await withTx(async (c) => {
      await prepara(c); // aplica a migration na txn
      const fx = await fixtures(c);
      const id = await ocTecido(c, fx, { data_nota_entrada: "2026-09-05" });
      await pagar(c, (await parcelas(c, "tecido", id))[0].id);
      const paga = (await parcelas(c, "tecido", id))[0];
      // O laço roda com os gatilhos novos ainda no lugar (o do Acabado dispara pelo data_pedido) e passa pelas 4 famílias.
      // Todas com NF 05/09 ≠ base antiga: se o laço usasse o texto NOVO, o vencimento ficaria pela NF.
      const pa = await ocPAcabado(c, fx, { data_nota_entrada: "2026-09-05" });
      const avi = await ocAviamento(c, fx, { data_nota_entrada: "2026-09-05" });
      const ins = await ocInsumo(c, fx, { data_nota_entrada: "2026-09-05" });
      for (const [f, oc] of [["p_acabado", pa], ["aviamento", avi], ["etiqueta", ins]] as const) {
        expect({ f, v: (await parcelas(c, f, oc)).map((x) => x.venc) }).toEqual({ f, v: ["2026-10-05", "2026-11-04"] });
      }
      const [totAvi, totIns] = [await totalAviamento(c, avi), await totalInsumo(c, ins)];
      await expect(aplicarArquivo(c, DOWN)).rejects.toThrow(/confirmo_apagar_data_nota_entrada/);
      expect(await colunas(c)).toBe(5); // a recusa não deixou nada pela metade
      const avisos: string[] = [];
      const ouvir = (m: { message?: string }) => avisos.push(m.message ?? "");
      c.on("notice", ouvir);
      await aplicarArquivo(c, DOWN, "SET LOCAL app.confirmo_apagar_data_nota_entrada = 'sim'");
      c.removeListener("notice", ouvir);
      expect(avisos).toContain("data_nota_entrada (inverso): 0 OC(s) repassada(s) depois do DROP TRIGGER"); // o laço já pegou as 4
      expect(await colunas(c)).toBe(0);
      for (const [sig, md5] of Object.entries(MD5_ANTES)) {
        expect({ sig, md5: (await um<{ m: string }>(c, `select md5(pg_get_functiondef($1::regprocedure)) m`, [sig])).m }).toEqual({ sig, md5 });
      }
      const ocpa = await um<{ c: string }>(c,
        `select string_agg(a.attname, ',' order by a.attname) c from pg_trigger t
           join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[])
          where t.tgrelid = 'public.ocs_p_acabado'::regclass and t.tgname = 'trg_gerar_parcelas_ocpa'`);
      expect(ocpa.c).toBe("data_pedido,prazo_pagamento,valor_total_desconto");
      const p = await parcelas(c, "tecido", id);
      expect(p[0]).toEqual(paga);
      expect(p.slice(1).map((x) => x.venc)).toEqual(["2026-11-09", "2026-12-09"]); // base = entrega 10/09 + 60/90
      expect(centavos(p)).toBe(100000);
      const ppa = await parcelas(c, "p_acabado", pa);
      expect(ppa.map((x) => x.venc)).toEqual(["2026-10-01", "2026-10-31"]); // base = pedido 01/09 de novo
      expect(centavos(ppa)).toBe(100000);
      const pavi = await parcelas(c, "aviamento", avi);
      expect(pavi.map((x) => x.venc)).toEqual(["2026-10-10", "2026-11-09"]); // base = entrega 10/09 de novo
      expect(centavos(pavi)).toBe(totAvi);
      const pins = await parcelas(c, "etiqueta", ins);
      expect(pins.map((x) => x.venc)).toEqual(["2026-10-10", "2026-11-09"]);
      expect(centavos(pins)).toBe(totIns);
      await aplicarArquivo(c, MIG); // reaplicar depois de desfazer
      expect(await colunas(c)).toBe(5);
    });
  });

  it.skipIf(!MIG_TXN || !CAPTURA)("captura pg_get_functiondef DEPOIS (diff da Task 3) — só escreve arquivos locais", async () => {
    await withTx(async (c) => {
      await prepara(c);
      mkdirSync(CAPTURA, { recursive: true });
      const linhas: string[] = [];
      for (const sig of [...Object.keys(MD5_ANTES), ...NOVAS]) {
        const r = await um<{ d: string; m: string }>(c, `select pg_get_functiondef($1::regprocedure) d, md5(pg_get_functiondef($1::regprocedure)) m`, [sig]);
        writeFileSync(`${CAPTURA}/${sig.replace(/^public\./, "").split("(")[0]}.sql`, r.d);
        linhas.push(`${sig} ${r.m}`);
      }
      writeFileSync(`${CAPTURA}/md5-depois.txt`, linhas.join("\n") + "\n");
    });
  });

  // R9-b: mede o laço do inverso com VOLUME REAL (as OCs recebidas da cópia datadas, o conjunto do dia 1) numa transação que
  // é DESFEITA no fim (withTx → ROLLBACK): nenhuma parcela, OC, rev ou audit_log da cópia muda. A Task 4 confere com o
  // retrato só-leitura antes × depois. Tempos pelo relógio do SERVIDOR (clock_timestamp()).
  it.skipIf(!MIG_TXN || !MEDIR)("R9-b: mede o laço do inverso com as OCs recebidas da cópia DATADAS — numa txn DESFEITA (resíduo zero)", async () => {
    await withTx(async (c) => {
      exigeBancoLocal();
      await c.query("SET LOCAL transaction_timeout = '180s'"); // 1º SET da txn: é ele que vale — teto da medição (R9-c)
      const agora = async () => Number((await um<{ t: string }>(c, `select extract(epoch from clock_timestamp())::text t`)).t);
      const t0 = await agora();
      await prepara(c); // a migration na txn (sem BEGIN/COMMIT, nunca \i)
      const tIda = (await agora()) - t0;
      await c.query("SET LOCAL statement_timeout = '180s'");
      const hoje = `coalesce((select (now() at time zone coalesce(nullif(tc.timezone, ''), 'America/Sao_Paulo'))::date
                                from public.tenant_config tc where tc.tenant_id = o.tenant_id), (now() at time zone 'America/Sao_Paulo')::date)`;
      // Alvo = o que acende no dia 1 (recebida, sem data), dentro da D7 (pedido ≤ hoje). Data = a PRÓPRIA base de hoje.
      await c.query(`create temp table _nota_medida on commit drop as
        select 'tecido'::text tipo, o.id, greatest(least(coalesce(o.data_entrega, h.d), h.d), coalesce(o.data_pedido, '-infinity'::date)) nota
          from public.ocs_tecido o cross join lateral (select ${hoje} d) h
         where o.status = 'recebido' and not coalesce(o.is_rolo, false) and o.data_nota_entrada is null and (o.data_pedido is null or o.data_pedido <= h.d)
        union all
        select 'aviamento', o.id, greatest(least(coalesce(o.data_entrega, h.d), h.d), coalesce(o.data_pedido, '-infinity'::date))
          from public.ocs_aviamento o cross join lateral (select ${hoje} d) h
         where o.status = 'recebido' and o.data_nota_entrada is null and (o.data_pedido is null or o.data_pedido <= h.d)
        union all
        select 'etiqueta', o.id, greatest(least(coalesce(o.data_entrega, h.d), h.d), coalesce(o.data_pedido, '-infinity'::date))
          from public.ocs_etiqueta o cross join lateral (select ${hoje} d) h
         where o.status = 'recebido' and o.data_nota_entrada is null and (o.data_pedido is null or o.data_pedido <= h.d)
        union all
        select 'p_acabado', o.id, least(coalesce(o.data_pedido, h.d), h.d)
          from public.ocs_p_acabado o cross join lateral (select ${hoje} d) h
         where o.status = 'recebido' and o.data_nota_entrada is null and (o.data_pedido is null or o.data_pedido <= h.d)`);
      const fam = await um<{ t: string; a: string; e: string; p: string }>(c,
        `select count(*) filter (where tipo = 'tecido') t, count(*) filter (where tipo = 'aviamento') a,
                count(*) filter (where tipo = 'etiqueta') e, count(*) filter (where tipo = 'p_acabado') p from pg_temp._nota_medida`);
      const n = Number(fam.t) + Number(fam.a) + Number(fam.e) + Number(fam.p);
      // Σ por OC e as parcelas PAGAS — a volta tem de devolvê-los iguais
      const retrato = async () => (await c.query(
        `select m.tipo, m.id::text oc, coalesce(sum(round(p.valor * 100)), 0)::bigint::text centavos,
                coalesce(jsonb_agg(jsonb_build_array(p.id, p.numero_parcela, p.valor, p.data_vencimento, p.status, p.data_pagamento)
                           order by p.numero_parcela) filter (where p.status = 'pago' or p.data_pagamento is not null), '[]'::jsonb)::text pagas
           from pg_temp._nota_medida m
           left join public.parcelas p on m.id = coalesce(p.oc_tecido_id, p.oc_aviamento_id, p.oc_etiqueta_id, p.oc_p_acabado_id)
          group by 1, 2 order by 1, 2`)).rows;
      const antes = await retrato();
      const t1 = await agora();
      await c.query(`update public.ocs_tecido o set data_nota_entrada = m.nota from pg_temp._nota_medida m where m.tipo = 'tecido' and m.id = o.id;
        update public.ocs_aviamento o set data_nota_entrada = m.nota from pg_temp._nota_medida m where m.tipo = 'aviamento' and m.id = o.id;
        update public.ocs_etiqueta o set data_nota_entrada = m.nota from pg_temp._nota_medida m where m.tipo = 'etiqueta' and m.id = o.id;
        update public.ocs_p_acabado o set data_nota_entrada = m.nota from pg_temp._nota_medida m where m.tipo = 'p_acabado' and m.id = o.id;`);
      const t2 = await agora();
      await aplicarArquivo(c, MIG); // a IDA de novo, agora com as OCs datadas (idempotente): não pode crescer com os dados
      const t3 = await agora();
      await aplicarArquivo(c, DOWN, "SET LOCAL app.confirmo_apagar_data_nota_entrada = 'sim'");
      const t4 = await agora();
      const tVolta = t4 - t3;
      const ttInverso = Number(/^SET LOCAL transaction_timeout = '(\d+)s';$/m.exec(readFileSync(ROOT + DOWN, "utf8"))?.[1] ?? NaN);
      const med: Record<string, string | number> = {
        modo: "txn-desfeita", medido_em: new Date().toISOString(), n_familias: `${fam.t}|${fam.a}|${fam.e}|${fam.p}`, n_copia: n,
        t_ida_txn: tIda.toFixed(3), t_datar: (t2 - t1).toFixed(3), t_ida_datada: (t3 - t2).toFixed(3), t_volta: tVolta.toFixed(3),
        s_por_oc: (n > 0 ? tVolta / n : tVolta).toFixed(4), tt_minimo: Math.max(30, Math.ceil(5 * tVolta)), tt_inverso: ttInverso,
      };
      writeFileSync(MEDIR, Object.entries(med).map(([k, v]) => `${k}=${v}`).join("\n") + "\n"); // grava ANTES de conferir
      console.log(`[R9-b] ${n} OC(s) datada(s) (tecido|aviamento|insumo|p.acabado = ${med.n_familias}) · datar ${med.t_datar}s · ` +
        `ida ${med.t_ida_txn}s / com datas ${med.t_ida_datada}s · volta ${med.t_volta}s (≈ ${med.s_por_oc}s por OC) → ` +
        `mínimo ${med.tt_minimo}s; o inverso tem ${ttInverso}s`);
      expect(n).toBeGreaterThan(0); // sem volume a medição não vale
      expect(await colunas(c)).toBe(0);
      expect(await retrato()).toEqual(antes); // Σ por OC e as pagas iguais depois da volta (na txn; o ROLLBACK desfaz tudo)
    });
  }, 5 * 60_000);
});
