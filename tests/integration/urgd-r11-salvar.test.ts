// Urgentes R11e (plan-r11 Task 4, 20261103199400_urg_r11_salvar_mini): o Salvar da Peça Teste (RPC `salvar_peca_teste`) faz a
// baixa/estorno da mini explosão (máquina de estados). Roda a RPC como o PAPEL `authenticated` (SET LOCAL ROLE) com JWT de usuário
// COMUM da Loja Teste e permissão da seção (receita dos testes S3). Txn revertida; o bloco r11e é aplicado DENTRO da txn por
// aplicaUrgd quando a cópia ainda não o tem. Fixtures na txn. Só na cópia local.
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, dbUrl, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicaUrgd, urgdViva, URGD_BLOCOS } from "./urgd-helpers";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const SUPER = USER_TESTE;
const U_ED = "5e9a0054-0000-4000-8000-00000000e511"; // EDITA a seção Peça Teste
const U_LE = "5e9a0054-0000-4000-8000-00000000e512"; // só VÊ a seção
const SEC = "criacao_planejamento:peca_teste";
let seq = 0;
const suf = () => `r11e-${Date.now()}-${seq++}`;

type Res = { ok: true; rows: any[] } | { ok: false; code: string; msg: string };
async function jwt(c: Client, uid: string | null): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : ""]);
}
/** Roda `sql` como o papel `authenticated` (PostgREST) com o JWT de `uid`, num SAVEPOINT; erro volta ao savepoint. */
async function como(c: Client, uid: string | null, sql: string, params: unknown[] = []): Promise<Res> {
  await jwt(c, uid);
  await c.query("SAVEPOINT r11e_z");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    const r = await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT r11e_z");
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    await c.query("RESET ROLE").catch(() => {});
    await c.query("ROLLBACK TO SAVEPOINT r11e_z");
    await c.query("RELEASE SAVEPOINT r11e_z");
    return { ok: false, code: String(e.code ?? ""), msg: String(e.message ?? "") };
  } finally {
    await jwt(c, null);
  }
}
const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);
async function um1<T = any>(c: Client, sql: string, p: unknown[] = []): Promise<T> {
  return um<T>(c, sql, p as any[]);
}
async function usuario(c: Client, uid: string, nome: string): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, $4, 'user')
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [uid, T, `${uid}@teste`, nome],
  );
}
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
/** Escrita de PREPARAÇÃO: JWT do super admin (para os gatilhos set_tenant_id/RLS resolverem a loja) + kanban_sistema (nao
 *  enfileira). Restaura os claims no fim. */
async function comoSistema<R>(c: Client, fn: () => Promise<R>): Promise<R> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: SUPER, role: "authenticated" })]);
  await c.query("SELECT set_config('app.kanban_sistema', 'teste', true)");
  try {
    return await fn();
  } finally {
    await c.query("SELECT set_config('app.kanban_sistema', '', true)");
    await c.query("SELECT set_config('request.jwt.claims', '', true)");
  }
}

/** o bloco r11e (199400) vivo na cópia (copia3 termina em 199400); aplica dentro da txn se faltar. */
async function exigeR11e(c: Client): Promise<void> {
  if (!(await urgdViva(c, "r11e"))) {
    await c.query("SET LOCAL lock_timeout = '3s'");
    await aplicaUrgd(c, "r11e");
  }
}

type Fix = {
  modelo: string; cat: string; moLinha: string; forn: string; tentativa: string | null;
  vt: string; avi: string; av: string; etq: string;
  chaveTec: string; chaveAvi: string; chaveIns: string;
  item: string;  // item de OC do tecido (recebido)
};
/** modelo interno com Tecido 1 (1 variante V com cor + OC recebida saldo), 1 aviamento (estoque), 1 insumo (estoque),
 *  1 M.O. de categoria que exige peça teste, tamanho "M" na grade. `tecSaldo`/`aviFisico`/`insFisico` controlam o estoque. */
async function seed(c: Client, opt: { tecSaldo?: number; tecConsumo?: number; aviFisico?: number; aviConsumo?: number; insFisico?: number; insConsumo?: number } = {}): Promise<Fix> {
  const tecSaldo = opt.tecSaldo ?? 100, tecConsumo = opt.tecConsumo ?? 2;
  const aviFisico = opt.aviFisico ?? 50, aviConsumo = opt.aviConsumo ?? 3;
  const insFisico = opt.insFisico ?? 40, insConsumo = opt.insConsumo ?? 4;
  return comoSistema(c, async () => {
    await c.query(`UPDATE public.tenant_config SET modo_baixa_estoque='automatico', tamanhos_grade='["P","M","G"]'::jsonb WHERE tenant_id=$1`, [T]);
    const modelo = (await um1<{ id: string }>(c, `INSERT INTO public.modelos (tenant_id, nome, origem, ordem_criacao_enviada, status_desenvolvimento) VALUES ($1,$2,'interno',true,'entrada') RETURNING id`, [T, `r11e ${suf()}`])).id;
    const cor = (await um1<{ id: string }>(c, `INSERT INTO public.cores (tenant_id, nome) VALUES ($1,$2) RETURNING id`, [T, `cor ${suf()}`])).id;
    const art = (await um1<{ id: string }>(c, `INSERT INTO public.artigos (tenant_id, nome, unidade_medida, preco, rendimento) VALUES ($1,$2,'metro',10,1) RETURNING id`, [T, `art ${suf()}`])).id;
    const vt = (await um1<{ id: string }>(c, `INSERT INTO public.variantes_tecido (tenant_id, artigo_id, nome_variante, cor_id) VALUES ($1,$2,'V',$3) RETURNING id`, [T, art, cor])).id;
    const mt = (await um1<{ id: string }>(c, `INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo) VALUES ($1,$2,1,'tecido',$3) RETURNING id`, [modelo, art, tecConsumo])).id;
    await c.query(`INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1,$2,1)`, [mt, vt]);
    const oc = (await um1<{ id: string }>(c, `INSERT INTO public.ocs_tecido (tenant_id, numero_pedido, status, data_entrega) VALUES ($1,$2,'recebido','2026-01-01') RETURNING id`, [T, `oc-${suf()}`])).id;
    const item = (await um1<{ id: string }>(c, `INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, artigo_numero, variante_tecido_id, quantidade_pedida, quantidade_recebida) VALUES ($1,$2,1,$3,$4,$4) RETURNING id`, [oc, art, vt, tecSaldo])).id;
    const avi = (await um1<{ id: string }>(c, `INSERT INTO public.aviamentos (tenant_id, codigo_nome, preco) VALUES ($1,$2,1) RETURNING id`, [T, `avi ${suf()}`])).id;
    const av = (await um1<{ id: string }>(c, `INSERT INTO public.variantes_aviamento (tenant_id, aviamento_id, nome_variante) VALUES ($1,$2,'a') RETURNING id`, [T, avi])).id;
    await c.query(`INSERT INTO public.modelo_aviamentos (modelo_id, aviamento_id, numero, consumo, variante_aviamento_id) VALUES ($1,$2,1,$3,$4)`, [modelo, avi, aviConsumo, av]);
    const ocA = (await um1<{ id: string }>(c, `INSERT INTO public.ocs_aviamento (tenant_id, numero_pedido, status) VALUES ($1,$2,'recebido') RETURNING id`, [T, `oca-${suf()}`])).id;
    await c.query(`INSERT INTO public.ocs_aviamento_itens (oc_aviamento_id, aviamento_id, variante_aviamento_id, quantidade_pedida, quantidade_recebida) VALUES ($1,$2,$3,$4,$4)`, [ocA, avi, av, aviFisico]);
    const etq = (await um1<{ id: string }>(c, `INSERT INTO public.etiquetas (tenant_id, nome) VALUES ($1,$2) RETURNING id`, [T, `ins ${suf()}`])).id;
    await c.query(`INSERT INTO public.modelo_etiquetas (modelo_id, etiqueta_id, numero, consumo) VALUES ($1,$2,1,$3)`, [modelo, etq, insConsumo]);
    const ocE = (await um1<{ id: string }>(c, `INSERT INTO public.ocs_etiqueta (tenant_id, numero_pedido, status) VALUES ($1,$2,'recebido') RETURNING id`, [T, `oce-${suf()}`])).id;
    await c.query(`INSERT INTO public.ocs_etiqueta_itens (oc_etiqueta_id, etiqueta_id, quantidade_pedida, quantidade_recebida) VALUES ($1,$2,$3,$3)`, [ocE, etq, insFisico]);
    const cat = (await um1<{ id: string }>(c, `INSERT INTO public.categorias_terceirizado (tenant_id, nome, exige_peca_teste, ativo) VALUES ($1,$2,true,true) RETURNING id`, [T, `PL ${suf()}`])).id;
    // fornecedor de servico para a linha de M.O. (decidir/reprovar exige fornecedor congelado)
    const forn = (await um1<{ id: string }>(c, `INSERT INTO public.empresas (tenant_id, nome_fantasia, tipo) VALUES ($1,$2,'servico') RETURNING id`, [T, `forn ${suf()}`])).id;
    const moLinha = (await um1<{ id: string }>(c, `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, empresa_id) VALUES ($1,$2,$3,10,$4) RETURNING id`, [T, modelo, cat, forn])).id;
    return {
      modelo, cat, moLinha, forn, tentativa: null, vt, avi, av, etq, item,
      chaveTec: `t:tecido:1:1:${vt}`, chaveAvi: `a:${avi}:1`, chaveIns: `i:${etq}:-:1`,
    };
  });
}
/** rev atual da tentativa (ou 0 se não existe). */
async function rev(c: Client, tentativa: string): Promise<number> {
  const r = await um1<{ rev: number | null }>(c, `SELECT rev FROM public.modelo_peca_teste_tentativas WHERE id=$1`, [tentativa]);
  return r?.rev ?? -1;
}
/** cria a tentativa 1 (sem decisão) direto, para os casos que começam de uma tentativa gravada. */
async function tentativa1(c: Client, f: Fix, dataSaida: string | null): Promise<string> {
  return comoSistema(c, async () =>
    (await um1<{ id: string }>(c,
      `INSERT INTO public.modelo_peca_teste_tentativas (tenant_id, modelo_id, mo_linha_id, categoria_terceirizado_id, numero, data_saida)
       VALUES ($1,$2,$3,$4,1,$5) RETURNING id`, [T, f.modelo, f.moLinha, f.cat, dataSaida])).id);
}
/** payload de 1 trilha/1 tentativa com mini. */
function payload(f: Fix, tent: { id?: string | null; numero?: number; data_saida?: string | null; aprovacao?: string | null; rev?: number }, mini: any) {
  const t: any = { numero: tent.numero ?? 1, data_saida: tent.data_saida ?? null, data_entrada: tent.data_saida ? "2026-01-10" : null, aprovacao: tent.aprovacao ?? null, mini };
  if (tent.id) t.id = tent.id;
  const rev_base: any = { tentativas: {}, fornecedor: {} };
  if (tent.id && tent.rev != null) rev_base.tentativas[tent.id] = tent.rev;
  // decidir (aprovar/reprovar) exige o _rev_base.fornecedor da linha = o fornecedor ATUAL da M.O. (a base que a pessoa viu)
  if (tent.aprovacao) rev_base.fornecedor[f.moLinha] = f.forn;
  return { _trilhas: [{ mo_linha_id: f.moLinha, categoria_id: f.cat, tentativas: [t] }], _rev_base: rev_base };
}
const miniObj = (f: Fix, extra: any = {}) => ({ tamanho: "M", variante_tecido_id: f.vt, mesma_oc: true, ajustes: [], ...extra });

async function prepara(c: Client): Promise<void> {
  await c.query("SET LOCAL statement_timeout = '180s'");
  await exigeR11e(c);
  await jwt(c, null);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, SUPER]);
  await usuario(c, U_ED, "R11e editor");
  await usuario(c, U_LE, "R11e leitor");
  await perms(c, U_ED, [["criacao_planejamento", false], [SEC, true]]);
  await perms(c, U_LE, [["criacao_planejamento", false], [SEC, false]]);
  for (const m of ["criacao", "producao", "entrada_saida"]) await modulo(c, m, true);
}

async function somaEtb(c: Client, tentativa: string): Promise<number> {
  return Number((await um1<{ q: number }>(c, `SELECT coalesce(sum(quantidade),0) q FROM public.estoque_tecido_baixas WHERE peca_teste_tentativa_id=$1`, [tentativa])).q);
}
async function somaLed(c: Client, tentativa: string): Promise<number> {
  return Number((await um1<{ q: number }>(c, `SELECT coalesce(sum(quantidade),0) q FROM public.estoque_peca_teste_baixas WHERE tentativa_id=$1`, [tentativa])).q);
}
async function baixaEm(c: Client, tentativa: string): Promise<string | null> {
  const r = await um1<{ b: string | null }>(c, `SELECT baixa_em::text b FROM public.modelo_peca_teste_mini WHERE tentativa_id=$1`, [tentativa]);
  return r?.b ?? null;  // sem cabecalho da mini (ex.: apos P0409 que nao gravou nada) = sem baixa
}

describe.skipIf(!RODA)("urgd-r11-salvar: Salvar da Peça Teste com a mini (máquina de estados)", () => {
  it("1) mini salva sem data -> sem baixa; rev+1; a leitura devolve os ajustes", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const f = await seed(c);
      const tent = await tentativa1(c, f, null);
      const r0 = await rev(c, tent);
      const p = payload(f, { id: tent, data_saida: null, rev: r0 }, miniObj(f, { ajustes: [{ chave: f.chaveAvi, familia: "aviamento", a_enviar: 7 }] }));
      const r = await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]);
      expect(txt(r)).toBe("PASSOU");
      expect(await baixaEm(c, tent)).toBeNull();
      expect(await rev(c, tent)).toBe(r0 + 1);
      // leitura: a mini vem com os ajustes (a_enviar do aviamento) e sem foto
      const leitura = (await um1<{ j: any }>(c, `SELECT public._peca_teste_trilhas_core($1,$2) AS j`, [T, f.modelo])).j;
      const mini = leitura.trilhas[0].tentativas[0].mini;
      expect(mini).not.toBeNull();
      expect(mini.baixa_em).toBeNull();
      const aj = mini.linhas.find((l: any) => l.chave === f.chaveAvi);
      expect(Number(aj.a_enviar)).toBeCloseTo(7, 4);
      expect(aj.foto).toBeUndefined();
    });
  });

  it("2) data + tamanho + cor -> baixa nos 3 (etb + ledger); foto; baixa_em; histórico 'peca_teste'; estoque cai o a_enviar", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const f = await seed(c, { tecConsumo: 2, aviConsumo: 3, insConsumo: 4 });
      const tent = await tentativa1(c, f, "2026-01-05");
      const r0 = await rev(c, tent);
      const p = payload(f, { id: tent, data_saida: "2026-01-05", rev: r0 }, miniObj(f));
      const r = await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]);
      expect(txt(r)).toBe("PASSOU");
      expect(await baixaEm(c, tent)).not.toBeNull();
      // tecido: 1 peça x consumo 2 = 2m
      expect(await somaEtb(c, tent)).toBeCloseTo(2, 4);
      // aviamento 3 + insumo 4 = 7 no ledger novo
      expect(await somaLed(c, tent)).toBeCloseTo(7, 4);
      // foto de todas as linhas
      const foto = (await um1<{ n: number }>(c, `SELECT count(*)::int n FROM public.modelo_peca_teste_mini_linhas WHERE tentativa_id=$1 AND b_baixado IS NOT NULL`, [tent]));
      expect(foto.n).toBe(3);
      // histórico do tecido = origem peca_teste no etb
      const h = (await um1<{ n: number }>(c, `SELECT count(*)::int n FROM public.estoque_tecido_baixas WHERE peca_teste_tentativa_id=$1 AND origem='peca_teste'`, [tent]));
      expect(h.n).toBe(1);
    });
  });

  it("3) falta registrada (tecido sem saldo; aviamento acima do físico) e grava mesmo assim", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const f = await seed(c, { tecSaldo: 1, tecConsumo: 2, aviFisico: 2, aviConsumo: 3 });
      const tent = await tentativa1(c, f, "2026-01-05");
      const p = payload(f, { id: tent, data_saida: "2026-01-05", rev: await rev(c, tent) }, miniObj(f));
      const r = await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]);
      expect(txt(r)).toBe("PASSOU");
      expect(await baixaEm(c, tent)).not.toBeNull();
      // tecido: a_enviar 2, saldo 1 -> baixa 1, faltou 1
      const ft = (await um1<{ faltou: number }>(c, `SELECT coalesce(max(b_faltou),0) faltou FROM public.modelo_peca_teste_mini_linhas WHERE tentativa_id=$1 AND familia='tecido'`, [tent]));
      expect(Number(ft.faltou)).toBeCloseTo(1, 4);
      // aviamento: a_enviar 3, fisico 2 -> baixa 2, faltou 1
      const fa = (await um1<{ faltou: number }>(c, `SELECT coalesce(max(b_faltou),0) faltou FROM public.modelo_peca_teste_mini_linhas WHERE tentativa_id=$1 AND familia='aviamento'`, [tent]));
      expect(Number(fa.faltou)).toBeCloseTo(1, 4);
    });
  });

  it("4) apagar a data -> estorno: líquido 0; foto limpa; ajustes ficam; estoque volta", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const f = await seed(c);
      const tent = await tentativa1(c, f, "2026-01-05");
      // 1o Salvar: mini com um ajuste + baixa
      let p = payload(f, { id: tent, data_saida: "2026-01-05", rev: await rev(c, tent) }, miniObj(f, { ajustes: [{ chave: f.chaveAvi, familia: "aviamento", consumo: 5 }] }));
      expect(txt(await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]))).toBe("PASSOU");
      expect(await baixaEm(c, tent)).not.toBeNull();
      // 2o Salvar: apaga a data -> estorno
      p = payload(f, { id: tent, data_saida: null, rev: await rev(c, tent) }, miniObj(f, { ajustes: [{ chave: f.chaveAvi, familia: "aviamento", consumo: 5 }] }));
      expect(txt(await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]))).toBe("PASSOU");
      expect(await baixaEm(c, tent)).toBeNull();
      expect(await somaEtb(c, tent)).toBeCloseTo(0, 4);
      expect(await somaLed(c, tent)).toBeCloseTo(0, 4);
      // ajuste fica (consumo 5 no aviamento)
      const aj = (await um1<{ consumo: number | null }>(c, `SELECT consumo FROM public.modelo_peca_teste_mini_linhas WHERE tentativa_id=$1 AND chave=$2`, [tent, f.chaveAvi]));
      expect(Number(aj.consumo)).toBeCloseTo(5, 4);
      // foto limpa
      const foto = (await um1<{ n: number }>(c, `SELECT count(*)::int n FROM public.modelo_peca_teste_mini_linhas WHERE tentativa_id=$1 AND b_baixado IS NOT NULL`, [tent]));
      expect(foto.n).toBe(0);
    });
  });

  it("5) mudar a mini com baixa e data -> estorno + nova baixa na mesma txn (Q2=A)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const f = await seed(c, { aviConsumo: 3 });
      const tent = await tentativa1(c, f, "2026-01-05");
      let p = payload(f, { id: tent, data_saida: "2026-01-05", rev: await rev(c, tent) }, miniObj(f));
      expect(txt(await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]))).toBe("PASSOU");
      const led1 = await somaLed(c, tent);
      expect(led1).toBeGreaterThan(0);
      // muda o a_enviar do aviamento para 10 -> estorno + rebaixa
      p = payload(f, { id: tent, data_saida: "2026-01-05", rev: await rev(c, tent) }, miniObj(f, { ajustes: [{ chave: f.chaveAvi, familia: "aviamento", a_enviar: 10 }] }));
      expect(txt(await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]))).toBe("PASSOU");
      expect(await baixaEm(c, tent)).not.toBeNull();
      // baixa líquida do aviamento agora = 10
      const q = Number((await um1<{ q: number }>(c, `SELECT coalesce(sum(quantidade),0) q FROM public.estoque_peca_teste_baixas WHERE tentativa_id=$1 AND familia='aviamento'`, [tent])).q);
      expect(q).toBeCloseTo(10, 4);
    });
  });

  it("6) reprovar com baixa mantém a baixa; reprovar no MESMO Salvar da baixa -> baixa feita", async () => {
    await withTx(async (c) => {
      await prepara(c);
      // (a) reprovar no MESMO Salvar em que a baixa acontece -> baixa feita
      const f = await seed(c);
      const tent = await tentativa1(c, f, "2026-01-05");
      const p = payload(f, { id: tent, data_saida: "2026-01-05", aprovacao: "reprovado", rev: await rev(c, tent) }, miniObj(f));
      expect(txt(await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]))).toBe("PASSOU");
      expect(await baixaEm(c, tent)).not.toBeNull();
      expect(await somaEtb(c, tent)).toBeGreaterThan(0);
      // a tentativa ficou reprovada e a baixa fica (nova mexida na mini é recusada como histórico)
      const ap = (await um1<{ a: string }>(c, `SELECT aprovacao a FROM public.modelo_peca_teste_tentativas WHERE id=$1`, [tent]));
      expect(ap.a).toBe("reprovado");
    });
  });

  it("6b) tentativa já reprovada (Salvar anterior) com baixa: mexer na mini -> P0001 peca_teste_historico", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const f = await seed(c);
      const tent = await tentativa1(c, f, "2026-01-05");
      // baixa
      let p = payload(f, { id: tent, data_saida: "2026-01-05", rev: await rev(c, tent) }, miniObj(f));
      expect(txt(await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]))).toBe("PASSOU");
      // reprova num Salvar à parte (data já salva)
      p = payload(f, { id: tent, data_saida: "2026-01-05", aprovacao: "reprovado", rev: await rev(c, tent) }, miniObj(f));
      expect(txt(await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]))).toBe("PASSOU");
      // agora mexer na mini (muda o a_enviar) -> histórico
      p = payload(f, { id: tent, data_saida: "2026-01-05", rev: await rev(c, tent) }, miniObj(f, { ajustes: [{ chave: f.chaveAvi, familia: "aviamento", a_enviar: 99 }] }));
      const r = await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.msg).toMatch(/peca_teste_historico/);
      // a baixa continua lá
      expect(await somaEtb(c, tent)).toBeGreaterThan(0);
    });
  });

  it("7) herança (P-347): nova tentativa (id null, numero n+1) só com mini herdada -> INSERT + mini, sem baixa", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const f = await seed(c);
      const t1 = await tentativa1(c, f, "2026-01-05");
      // reprova a 1 (para liberar a próxima)
      let p = payload(f, { id: t1, data_saida: "2026-01-05", aprovacao: "reprovado", rev: await rev(c, t1) }, null);
      // mini null na t1 (sem cabeçalho) -> apenas decide
      p._trilhas[0].tentativas[0].mini = null;
      expect(txt(await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]))).toBe("PASSOU");
      // tentativa 2 nova, só com mini (sem data) -> INSERT da tentativa + mini, sem baixa
      const p2 = payload(f, { id: null, numero: 2, data_saida: null }, miniObj(f, { ajustes: [{ chave: f.chaveAvi, familia: "aviamento", a_enviar: 6 }] }));
      expect(txt(await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p2._trilhas), JSON.stringify(p2._rev_base)]))).toBe("PASSOU");
      const t2 = (await um1<{ id: string }>(c, `SELECT id FROM public.modelo_peca_teste_tentativas WHERE mo_linha_id=$1 AND numero=2`, [f.moLinha]));
      expect(t2?.id).toBeTruthy();
      expect(await baixaEm(c, t2.id)).toBeNull();
      const mini = (await um1<{ n: number }>(c, `SELECT count(*)::int n FROM public.modelo_peca_teste_mini WHERE tentativa_id=$1`, [t2.id]));
      expect(mini.n).toBe(1);
    });
  });

  it("8) P-349: data sem tamanho -> sem baixa; depois com tamanho (data já salva) -> baixa nesse Salvar", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const f = await seed(c);
      const tent = await tentativa1(c, f, "2026-01-05");
      // mini sem tamanho (null): sem baixa
      let p = payload(f, { id: tent, data_saida: "2026-01-05", rev: await rev(c, tent) }, miniObj(f, { tamanho: null, variante_tecido_id: null }));
      expect(txt(await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]))).toBe("PASSOU");
      expect(await baixaEm(c, tent)).toBeNull();
      // agora com tamanho + cor (data já salva): a baixa sai
      p = payload(f, { id: tent, data_saida: "2026-01-05", rev: await rev(c, tent) }, miniObj(f));
      expect(txt(await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]))).toBe("PASSOU");
      expect(await baixaEm(c, tent)).not.toBeNull();
      expect(await somaEtb(c, tent)).toBeGreaterThan(0);
    });
  });

  it("9) confere divergente -> P0409 e NADA grava; confere ausente -> baixa pelo cálculo do servidor", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const f = await seed(c, { aviConsumo: 3 });
      const tent = await tentativa1(c, f, "2026-01-05");
      // confere com valor errado no aviamento
      let p = payload(f, { id: tent, data_saida: "2026-01-05", rev: await rev(c, tent) }, miniObj(f, { confere: { [f.chaveAvi]: 999 } }));
      const r = await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("P0409");
      expect(await baixaEm(c, tent)).toBeNull();
      // sem confere: baixa pelo cálculo do servidor
      p = payload(f, { id: tent, data_saida: "2026-01-05", rev: await rev(c, tent) }, miniObj(f));
      expect(txt(await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]))).toBe("PASSOU");
      expect(await baixaEm(c, tent)).not.toBeNull();
    });
  });

  it("10) idempotência: mesmo payload 2x -> 2o P0409 (rev) e nenhuma baixa dupla", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const f = await seed(c);
      const tent = await tentativa1(c, f, "2026-01-05");
      const r0 = await rev(c, tent);
      const p = payload(f, { id: tent, data_saida: "2026-01-05", rev: r0 }, miniObj(f));
      expect(txt(await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]))).toBe("PASSOU");
      const led1 = await somaLed(c, tent);
      // reenvia o MESMO payload (rev velho) -> P0409
      const r = await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("P0409");
      // nenhuma baixa a mais
      expect(await somaLed(c, tent)).toBeCloseTo(led1, 4);
    });
  });

  it("12) desmarcado (mesma_oc false): item escolhido de outra loja -> P0001 fonte invalida", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const f = await seed(c);
      // cria um item de OC de OUTRA loja (via semJwt = postgres, sem RLS, para outro tenant REAL)
      const ot = (await um1<{ id: string }>(c, `SELECT id FROM public.tenants WHERE id <> $1 LIMIT 1`, [T])).id;
      const outraItem = await semJwt(c, async () => {
        const oc = (await um1<{ id: string }>(c, `INSERT INTO public.ocs_tecido (tenant_id, numero_pedido, status) VALUES ($1,$2,'recebido') RETURNING id`, [ot, `outra-${suf()}`])).id;
        const art = (await um1<{ id: string }>(c, `INSERT INTO public.artigos (tenant_id, nome, unidade_medida, preco, rendimento) VALUES ($1,$2,'metro',1,1) RETURNING id`, [ot, `outra art ${suf()}`])).id;
        return (await um1<{ id: string }>(c, `INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, artigo_numero, quantidade_pedida, quantidade_recebida) VALUES ($1,$2,1,5,5) RETURNING id`, [oc, art])).id;
      });
      const tent = await tentativa1(c, f, "2026-01-05");
      const p = payload(f, { id: tent, data_saida: "2026-01-05", rev: await rev(c, tent) }, miniObj(f, { ajustes: [{ chave: f.chaveTec, familia: "tecido", oc_tecido_item_id: outraItem }] }));
      const r = await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.msg).toMatch(/peca_teste_mini_fonte_invalida/);
    });
  });

  it("14) loja sem Entrada e Saída -> P0001 com mini", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const f = await seed(c);
      await modulo(c, "entrada_saida", false);
      const tent = await tentativa1(c, f, "2026-01-05");
      const p = payload(f, { id: tent, data_saida: "2026-01-05", rev: await rev(c, tent) }, miniObj(f));
      const r = await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.msg).toMatch(/peca_teste_mini_sem_estoque/);
    });
  });

  it("15) permissão: leitor recusa (42501 sem_permissao_pagina)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const f = await seed(c);
      const tent = await tentativa1(c, f, null);
      const p = payload(f, { id: tent, data_saida: null, rev: await rev(c, tent) }, miniObj(f));
      const r = await como(c, U_LE, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("42501");
        expect(r.msg).toMatch(/sem_permissao_pagina/);
      }
    });
  });

  it("16) card excluído -> ledgers ficam com tentativa_id NULL e rótulo; extrato fecha (reconcilia 0)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const f = await seed(c);
      const tent = await tentativa1(c, f, "2026-01-05");
      const p = payload(f, { id: tent, data_saida: "2026-01-05", rev: await rev(c, tent) }, miniObj(f));
      expect(txt(await como(c, U_ED, `SELECT public.salvar_peca_teste($1,$2,$3)`, [f.modelo, JSON.stringify(p._trilhas), JSON.stringify(p._rev_base)]))).toBe("PASSOU");
      // exclui o card
      await comoSistema(c, () => c.query(`DELETE FROM public.modelos WHERE id=$1`, [f.modelo]));
      // ledger novo: tentativa_id NULL, rótulo fica
      const led = (await um1<{ n: number; rot: number }>(c, `SELECT count(*)::int n, count(rotulo)::int rot FROM public.estoque_peca_teste_baixas WHERE tenant_id=$1 AND origem='peca_teste' AND tentativa_id IS NULL AND rotulo IS NOT NULL`, [T]));
      expect(led.n).toBeGreaterThanOrEqual(1);
      // extrato fecha: a varredura por família não acha divergência para os itens afetados (0)
      const rec = (await um1<{ diverge: number }>(c,
        `SELECT (SELECT count(*) FROM public._estoque_aviamento_core($1) c
                  LEFT JOIN LATERAL (SELECT sum(quantidade) s FROM public._estoque_extrato_aviamento_core($1, c.id) e WHERE e.bucket_variante_id IS NOT DISTINCT FROM c.variante_id) x ON true
                 WHERE coalesce(x.s,0) <> c.recebido - c.baixa)::int AS diverge`, [T]));
      expect(Number(rec.diverge)).toBe(0);
    });
  });
});

// ───────────── duas conexões REAIS: a chave corte_tenant serializa a baixa da mini com o corte da loja (receita R9/R4b) ─────────────
describe.skipIf(!RODA)("urgd-r11-salvar: duas conexões (travas reais)", () => {
  type Fx = { m: string; cat: string; linha: string; forn: string; vt: string; item: string; art: string };
  async function r11eVivaNaCopia(): Promise<boolean> {
    const x = new Client({ connectionString: dbUrl()!, ssl: false });
    await x.connect();
    try { return await urgdViva(x, "r11e"); } finally { await x.end(); }
  }
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
    for (const x of xs) { await x.query("ROLLBACK").catch(() => {}); await x.end().catch(() => {}); }
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
  /** Card + tipo + M.O.(c/ fornecedor) + Tecido 1 (1 variante) + OC recebida com saldo, DESCARTÁVEIS, gravados por uma 3ª conexão
   * em `replica` (sem gatilho) e apagados no finally. As 2 conexões do ensaio precisam VER o card. */
  async function comFixture(saldo: number, fn: (f: Fx) => Promise<void>): Promise<void> {
    const s = new Client({ connectionString: dbUrl()!, ssl: false });
    await s.connect();
    const id: Partial<Fx> & { oc?: string; mt?: string } = {};
    try {
      await s.query("SET session_replication_role = replica");
      await s.query("SELECT set_config('app.kanban_sistema','teste',true)");
      const suf = Math.random().toString(36).slice(2, 8);
      id.cat = (await um<{ id: string }>(s, `INSERT INTO public.categorias_terceirizado (tenant_id, nome, exige_peca_teste, ativo) VALUES ($1,$2,true,true) RETURNING id`, [T, `R11e trava ${suf}`])).id;
      id.forn = (await um<{ id: string }>(s, `INSERT INTO public.empresas (tenant_id, nome_fantasia, tipo) VALUES ($1,$2,'servico') RETURNING id`, [T, `R11e forn ${suf}`])).id;
      id.m = (await um<{ id: string }>(s, `INSERT INTO public.modelos (tenant_id, nome, origem, ordem_criacao_enviada, status_desenvolvimento) VALUES ($1,$2,'interno',true,'entrada') RETURNING id`, [T, `R11e trava ${suf}`])).id;
      id.art = (await um<{ id: string }>(s, `INSERT INTO public.artigos (tenant_id, nome, unidade_medida, preco, rendimento) VALUES ($1,$2,'metro',10,1) RETURNING id`, [T, `R11e art ${suf}`])).id;
      id.vt = (await um<{ id: string }>(s, `INSERT INTO public.variantes_tecido (tenant_id, artigo_id, nome_variante) VALUES ($1,$2,'V') RETURNING id`, [T, id.art])).id;
      id.mt = (await um<{ id: string }>(s, `INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo) VALUES ($1,$2,1,'tecido',2) RETURNING id`, [id.m, id.art])).id;
      await s.query(`INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1,$2,1)`, [id.mt, id.vt]);
      id.oc = (await um<{ id: string }>(s, `INSERT INTO public.ocs_tecido (tenant_id, numero_pedido, status, data_entrega) VALUES ($1,$2,'recebido','2026-01-01') RETURNING id`, [T, `R11e oc ${suf}`])).id;
      id.item = (await um<{ id: string }>(s, `INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, artigo_numero, variante_tecido_id, quantidade_pedida, quantidade_recebida) VALUES ($1,$2,1,$3,$4,$4) RETURNING id`, [id.oc, id.art, id.vt, saldo])).id;
      id.linha = (await um<{ id: string }>(s, `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, empresa_id) VALUES ($1,$2,$3,10,$4) RETURNING id`, [T, id.m, id.cat, id.forn])).id;
      await s.query(`UPDATE public.tenant_config SET modo_baixa_estoque='automatico', tamanhos_grade='["P","M","G"]'::jsonb WHERE tenant_id=$1`, [T]);
      await fn(id as Fx);
    } finally {
      if (id.item) await s.query(`DELETE FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = $1`, [id.item]).catch(() => {});
      if (id.m) await s.query(`DELETE FROM public.estoque_peca_teste_baixas WHERE modelo_id = $1`, [id.m]).catch(() => {});
      if (id.linha) await s.query(`DELETE FROM public.modelo_peca_teste_tentativas WHERE mo_linha_id = $1`, [id.linha]).catch(() => {});
      if (id.linha) await s.query(`DELETE FROM public.modelo_servico_mo WHERE id = $1`, [id.linha]).catch(() => {});
      if (id.m) await s.query(`DELETE FROM public.modelos WHERE id = $1`, [id.m]).catch(() => {});
      if (id.item) await s.query(`DELETE FROM public.ocs_tecido_itens WHERE id = $1`, [id.item]).catch(() => {});
      if (id.oc) await s.query(`DELETE FROM public.ocs_tecido WHERE id = $1`, [id.oc]).catch(() => {});
      if (id.vt) await s.query(`DELETE FROM public.variantes_tecido WHERE id = $1`, [id.vt]).catch(() => {});
      if (id.art) await s.query(`DELETE FROM public.artigos WHERE id = $1`, [id.art]).catch(() => {});
      if (id.cat) await s.query(`DELETE FROM public.categorias_terceirizado WHERE id = $1`, [id.cat]).catch(() => {});
      if (id.forn) await s.query(`DELETE FROM public.empresas WHERE id = $1`, [id.forn]).catch(() => {});
      await s.end();
    }
  }
  /** Salvar da Peça Teste com baixa ativa (data + tamanho + cor): o core pega o advisory corte_tenant na baixa. */
  const salvarBaixa = (x: Client, f: Fx) =>
    x.query("SELECT public.salvar_peca_teste($1, $2::jsonb, $3::jsonb)", [
      f.m,
      JSON.stringify([{ mo_linha_id: f.linha, categoria_id: f.cat, tentativas: [{ id: null, numero: 1, data_saida: "2026-01-05", data_entrada: "2026-01-10", aprovacao: null,
        mini: { tamanho: "M", variante_tecido_id: f.vt, mesma_oc: true, ajustes: [] } }] }]),
      JSON.stringify({ tentativas: {}, fornecedor: {} }),
    ]);

  it("(e) 2 Salvar da Peça Teste com baixa na MESMA loja: o 2o ESPERA no advisory corte_tenant, termina sem 40P01", async (ctx) => {
    if (!(await r11eVivaNaCopia())) ctx.skip();
    await comFixture(100, async (f) => {
      const A = await abre();
      const B = await abre();
      try {
        await salvarBaixa(A.x, f);                 // A pega corte_tenant e segura (txn aberta)
        const pb = salvarBaixa(B.x, f); pb.catch(() => {});
        const esperou = await esperaAdvisory(A.x, B.pid);  // B espera no advisory corte_tenant
        await A.x.query("ROLLBACK");
        const rb = (await Promise.allSettled([pb]))[0];
        expect({ esperou, b: codigo(rb) }).toEqual({ esperou: true, b: "ok" });  // sem 40P01
      } finally {
        await fecha(A.x, B.x);
      }
    });
  }, 60000);

  it("(a/g) Salvar com baixa × baixar_estoque_tecido_corte do mesmo item: um ESPERA no advisory corte_tenant (as 2 ordens)", async (ctx) => {
    if (!(await r11eVivaNaCopia())) ctx.skip();
    // baixar_estoque_tecido_corte e o Salvar da Peça Teste pegam a MESMA chave hashtext('corte_tenant:'||tenant): prova que o 2o
    // espera, nas 2 ordens. Aqui o "corte" e simulado pela MESMA advisory (o core do corte usa exatamente essa chave).
    await comFixture(100, async (f) => {
      const corte = (x: Client) => x.query(`SELECT pg_advisory_xact_lock(hashtext('corte_tenant:' || $1::text))`, [T]);
      for (const [primeiro, segundo] of [[salvarBaixa, corte], [corte, salvarBaixa]] as const) {
        const A = await abre();
        const B = await abre();
        try {
          await primeiro(A.x, f);
          const pb = (segundo as any)(B.x, f); pb.catch(() => {});
          const esperou = await esperaAdvisory(A.x, B.pid);
          await A.x.query("ROLLBACK");
          const rb = (await Promise.allSettled([pb]))[0];
          expect({ esperou, b: codigo(rb) }).toEqual({ esperou: true, b: "ok" });
        } finally {
          await fecha(A.x, B.x);
        }
      }
    });
  }, 60000);

  it("ordem de travas: a chave do CARD vem ANTES do corte_tenant no _peca_teste_mini_baixar/_estornar (anti-deadlock)", async (ctx) => {
    if (!(await r11eVivaNaCopia())) ctx.skip();
    await withTx(async (c) => {
      // o core do Salvar pega a chave do card 1o; o passo da mini trava os cabecalhos e so entao (na baixa/estorno) o corte_tenant
      const core = (await um1<{ d: string }>(c, `SELECT pg_get_functiondef(to_regprocedure('public._salvar_peca_teste_core(uuid,jsonb,jsonb)')) d`)).d;
      const chaveCard = core.indexOf("pg_advisory_xact_lock(hashtext('cad:modelo_id:' || _modelo_id::text))");
      const passoMini = core.indexOf("PERFORM public._peca_teste_mini_aplicar");
      expect(chaveCard).toBeGreaterThan(-1);
      expect(passoMini).toBeGreaterThan(chaveCard);  // a chave do card ANTES do passo da mini (que pega o corte_tenant por dentro)
      for (const fn of ["_peca_teste_mini_baixar(uuid,jsonb)", "_peca_teste_mini_estornar(uuid)"]) {
        const d = (await um1<{ d: string }>(c, `SELECT pg_get_functiondef(to_regprocedure($1)) d`, [`public.${fn}`])).d;
        expect(d.indexOf("corte_tenant")).toBeGreaterThan(-1);
      }
    });
  });
});

describe.skipIf(!RODA)("urgd-r11-salvar: volta (LIFO) e md5", () => {
  it("20) voltaUrgd até r11d devolve o texto da R9; ida 2x mesmos md5", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      await exigeR11e(c);
      const md5 = async (sig: string) => (await um1<{ m: string | null }>(c, `SELECT md5(pg_get_functiondef(to_regprocedure($1))) m`, [sig])).m;
      const dR11 = await md5("public._salvar_peca_teste_core(uuid,jsonb,jsonb)");
      expect(dR11).toBe("3e3b9db2d04dd176a4712898293f8545");
      // volta só a r11e: o core volta ao texto da R9 (aplica o _down do bloco r11e diretamente)
      await c.query("SET LOCAL lock_timeout = '3s'");
      await aplicarArquivo(c, (URGD_BLOCOS as any).r11e.down);
      const dR9 = await md5("public._salvar_peca_teste_core(uuid,jsonb,jsonb)");
      expect(dR9).toBe("eccde92e1c6687045f8f7c9ae61caf8f");
      // _peca_teste_mini_aplicar vira neutra (existe, mas no-op)
      expect(await md5("public._peca_teste_mini_aplicar(uuid,uuid,jsonb)")).toBe("2dbec37294d192919e72a0a9ae52ef7a");
      // ida de novo: mesmos md5 de DEPOIS
      await aplicaUrgd(c, "r11e");
      expect(await md5("public._salvar_peca_teste_core(uuid,jsonb,jsonb)")).toBe("3e3b9db2d04dd176a4712898293f8545");
      expect(await md5("public._peca_teste_mini_aplicar(uuid,uuid,jsonb)")).toBe("86573744c113efe92fec638b0db89fe6");
    });
  });
});
