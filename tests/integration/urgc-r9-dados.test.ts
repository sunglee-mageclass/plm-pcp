// Urgentes R9d/R9e (plan-c Task 4): as 2 DMLs à mão da Peça Teste (padrão I3c/R8b — guarda, teto, backup, idempotência,
// pós-condição).
//  - 20261103195000 (r9d): backfill da permissão de seção `criacao_planejamento:peca_teste` (Ruling 16): Leitor/Editor = o do
//    Planejamento de Produto; + Editor para quem EDITA PCP › Etapas/Serviços E vê Planejamento/Desenvolvimento. Papel pela regra
//    lida do PRÓPRIO papel; usuário = só o DELTA vs o papel (mesma regra do set_user_permissions: exceção onde diverge, inclusive
//    negativa), calculado sobre a permissão EFETIVA (_perm_efetiva). `_down` = no-op.
//  - 20261103196000 (r9e): `producao_terceirizados.pt_*` legados viram a 1ª tentativa da trilha (linha de M.O. × tipo) com backup
//    `_bkp_r9_pt_legado` (decisão de CADA bloco) + switch "Exige peça teste" ligado na categoria PL das lojas com Etapas PL
//    (Ruling 19 / P-331 A) com backup `_bkp_r9_exige_pl`; `_down` desliga só o que a ida ligou; `_down_drop` apaga os backups.
// Txn revertida; os arquivos são aplicados DENTRO da txn (mig-txn) a partir do estado "antes" montado na própria txn. Só na cópia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, TENANT_TESTE, USER_TESTE } from "./db";
import { URGC_BLOCOS, URGC_MIGS, urgcViva, aplicaUrgc } from "./urgc-helpers";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const D = URGC_BLOCOS.r9d;
const E = URGC_BLOCOS.r9e;
const T = TENANT_TESTE;
const SUPER = USER_TESTE;
const SEC = "criacao_planejamento:peca_teste";
const TAB = "public.modelo_peca_teste_tentativas";
const BKP = "public._bkp_r9_pt_legado";
const BKP_PL = "public._bkp_r9_exige_pl";
const D1 = "2026-09-01";
const D2 = "2026-09-08";
// os 3 blocos legados REAIS da cópia (copia3, 06/out; o `postgres` tem os 2 primeiros): nenhum tem linha de M.O. do tipo → sem_linha
const REAIS = [
  "a0eda48a-447d-45ab-bdda-4981c6ee875f", // Loja Teste, PL, aprovado com as 2 datas
  "405a73dc-4cff-4d72-94ed-040bc90004fc", // QA Modularidade (local), PL, aprovado SEM data de entrada
  "a2881d14-4393-47aa-ae3c-b225e5036056", // Loja Teste, PL, só data de saída
];

type Res = { ok: true } | { ok: false; code: string; msg: string };
async function zera(c: Client): Promise<void> {
  // os arquivos fazem SET LOCAL transaction_timeout/lock_timeout (valem para a txn INTEIRA do teste)
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}
async function aplica(c: Client, rel: string): Promise<void> {
  await aplicarArquivo(c, rel);
  await zera(c);
}
async function tenta(c: Client, rel: string): Promise<Res> {
  try {
    await aplica(c, rel);
    return { ok: true };
  } catch (e: any) {
    await zera(c);
    return { ok: false, code: String(e.code ?? ""), msg: String(e.message ?? "") };
  }
}
const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);
async function jwt(c: Client, uid: string | null): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : ""]);
}
async function existe(c: Client, rel: string): Promise<boolean> {
  return (await um<{ ok: boolean }>(c, "SELECT to_regclass($1) IS NOT NULL AS ok", [rel])).ok;
}
/** Escrita de PREPARAÇÃO que não deve acionar o enfileirador/guarda do kanban. */
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
  await aplicaUrgc(c, "r9c"); // a frente até a 194000 (192000/193000 são pré-requisito das 2 DMLs)
  await zera(c);
  await jwt(c, null);
}

// ---------------------------------------------------------------- r9d (195000)
type Perm = [string, boolean, boolean]; // [pagina, ver, editar]
async function usuario(c: Client, uid: string, papel: string | null, perms: Perm[]): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome, role, papel_id) VALUES ($1, $2, $3, $4, 'user', $5)
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id, papel_id = excluded.papel_id`,
    [uid, T, `${uid}@teste`, `R9d ${uid.slice(-3)}`, papel],
  );
  await c.query("DELETE FROM public.user_permissions WHERE user_id = $1", [uid]);
  for (const [pagina, ver, ed] of perms) {
    await c.query(
      "INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, $4, $5)",
      [uid, T, pagina, ver, ed],
    );
  }
}
async function papel(c: Client, nome: string, perms: Perm[]): Promise<string> {
  const id = (await um<{ id: string }>(c, "INSERT INTO public.papeis (tenant_id, nome) VALUES ($1, $2) RETURNING id", [T, nome])).id;
  for (const [pagina, ver, ed] of perms) {
    await c.query(
      "INSERT INTO public.papel_permissoes (papel_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, $4, $5)",
      [id, T, pagina, ver, ed],
    );
  }
  return id;
}
async function secUser(c: Client, uid: string): Promise<{ ver: boolean; ed: boolean } | null> {
  const r = await c.query("SELECT pode_ver AS ver, pode_editar AS ed FROM public.user_permissions WHERE user_id = $1 AND pagina = $2", [uid, SEC]);
  return r.rowCount ? r.rows[0] : null;
}
async function secPapel(c: Client, id: string): Promise<{ ver: boolean; ed: boolean } | null> {
  const r = await c.query("SELECT pode_ver AS ver, pode_editar AS ed FROM public.papel_permissoes WHERE papel_id = $1 AND pagina = $2", [id, SEC]);
  return r.rowCount ? r.rows[0] : null;
}
/** Permissão EFETIVA da seção (exceção do usuário senão papel senão nada) — o que user_can_view/edit enxergam. */
async function efetiva(c: Client, uid: string): Promise<{ ver: boolean; ed: boolean }> {
  const r = await c.query("SELECT pode_ver AS ver, pode_editar AS ed FROM public._perm_efetiva($1) WHERE pagina = $2", [uid, SEC]);
  return r.rowCount ? { ver: r.rows[0].ver, ed: r.rows[0].ed } : { ver: false, ed: false };
}
/** Estado "antes da 195000" dentro da txn: nenhuma linha da seção. */
async function antesR9d(c: Client): Promise<void> {
  await c.query("DELETE FROM public.user_permissions WHERE pagina = $1", [SEC]);
  await c.query("DELETE FROM public.papel_permissoes WHERE pagina = $1", [SEC]);
}
async function contaSec(c: Client): Promise<{ u: number; p: number; foto: string }> {
  return um(
    c,
    `SELECT (SELECT count(*)::int FROM public.user_permissions WHERE pagina = $1) AS u,
            (SELECT count(*)::int FROM public.papel_permissoes WHERE pagina = $1) AS p,
            md5(coalesce((SELECT string_agg(user_id::text || pode_ver::text || pode_editar::text, ',' ORDER BY user_id)
                            FROM public.user_permissions WHERE pagina = $1), '')
                || coalesce((SELECT string_agg(papel_id::text || pode_ver::text || pode_editar::text, ',' ORDER BY papel_id)
                               FROM public.papel_permissoes WHERE pagina = $1), '')) AS foto`,
    [SEC],
  );
}
/** A regra (Ruling 16) sobre a permissão EFETIVA de um usuário, ANTES da seção existir. */
async function regraEsperada(c: Client, uid: string): Promise<{ ver: boolean; ed: boolean }> {
  const r = await um<{ ver: boolean; ed: boolean }>(
    c,
    `SELECT coalesce(bool_or(e.pagina = 'criacao_planejamento'), false)
              OR coalesce(bool_or(e.pagina = 'criacao_planejamento' AND e.pode_editar), false)
              OR (coalesce(bool_or(e.pagina IN ('producao_etapas', 'producao_terceirizados') AND e.pode_editar), false)
                  AND coalesce(bool_or(e.pagina IN ('criacao_planejamento', 'criacao_desenvolvimento')), false)) AS ver,
            coalesce(bool_or(e.pagina = 'criacao_planejamento' AND e.pode_editar), false)
              OR (coalesce(bool_or(e.pagina IN ('producao_etapas', 'producao_terceirizados') AND e.pode_editar), false)
                  AND coalesce(bool_or(e.pagina IN ('criacao_planejamento', 'criacao_desenvolvimento')), false)) AS ed
       FROM public._perm_efetiva($1) e WHERE e.pagina <> $2`,
    [uid, SEC],
  );
  return { ver: !!r.ver, ed: !!r.ed };
}

const U = (n: number) => `5e9a0054-0000-4000-8000-0000000d${String(n).padStart(4, "0")}`;
const PL = "criacao_planejamento";
const DEV = "criacao_desenvolvimento";
const ETP = "producao_etapas";
const SRV = "producao_terceirizados";

describe.skipIf(!RODA)("urg R9d — 195000 backfill da permissão de seção Peça Teste", () => {
  it("contrato: blocos r9d/r9e no urgc-dados.ts com arquivo (DMLs à mão, sentinela de DADOS)", () => {
    expect(URGC_MIGS.map((x) => x.id)).toEqual(expect.arrayContaining(["r9d", "r9e"]));
    expect(D?.URGC_DADOS?.vivo).toContain(SEC);
    expect(D?.drop).toBeUndefined();
    expect(E?.URGC_DADOS?.backups).toEqual([BKP, BKP_PL]);
    expect(E?.URGC_TABELAS).toEqual([BKP, BKP_PL]);
    expect(E?.URGC_DROP_GUC).toBe("app.confirmo_apagar_backup_r9");
  });

  it("usuário (sem papel): Leitor/Editor = o do Planejamento; + Editor para quem edita Etapas/Serviços E vê Plan/Dev; linha existente intocada; reaplicar = 0", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await antesR9d(c);
      await usuario(c, U(1), null, [[PL, true, true]]);
      await usuario(c, U(2), null, [[PL, true, false]]);
      await usuario(c, U(3), null, [[PL, true, false], [SRV, true, true]]);
      await usuario(c, U(4), null, [[DEV, true, false], [ETP, true, true]]);
      await usuario(c, U(5), null, [[SRV, true, true], [ETP, true, true]]);
      await usuario(c, U(6), null, [[PL, true, true], [SEC, true, false]]); // já tem a seção (só ver): fica
      await usuario(c, U(7), null, [[SRV, true, false], [DEV, true, true]]); // vê Serviços sem editar
      await usuario(c, U(8), null, [[PL, false, true]]); // editar sem ver (dado torto) = normaliza: ver+editar
      await aplica(c, D!.mig);
      expect(await secUser(c, U(1))).toEqual({ ver: true, ed: true });
      expect(await secUser(c, U(2))).toEqual({ ver: true, ed: false });
      expect(await secUser(c, U(3))).toEqual({ ver: true, ed: true });
      expect(await secUser(c, U(4))).toEqual({ ver: true, ed: true });
      expect(await secUser(c, U(5))).toBeNull();
      expect(await secUser(c, U(6))).toEqual({ ver: true, ed: false });
      expect(await secUser(c, U(7))).toBeNull();
      expect(await secUser(c, U(8))).toEqual({ ver: true, ed: true });
      // nenhuma linha da seção com editar sem ver (das criadas)
      const torta = await um<{ n: number }>(
        c,
        "SELECT count(*)::int AS n FROM public.user_permissions WHERE pagina = $1 AND pode_editar AND NOT pode_ver",
        [SEC],
      );
      expect(torta.n).toBe(0);
      expect(await urgcViva(c, "r9d")).toBe(true);
      const a = await contaSec(c);
      await aplica(c, D!.mig); // reaplicar
      expect(await contaSec(c)).toEqual(a);
      await aplica(c, D!.down); // no-op documentado
      await aplica(c, D!.down);
      expect(await contaSec(c)).toEqual(a);
    });
  });

  it("papel: mesma regra lida do PRÓPRIO papel; usuário do papel ganha só o DELTA (exceção inclusive negativa); papel com a seção já configurada é respeitado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await antesR9d(c);
      const P1 = await papel(c, "R9d P1 plan editor", [[PL, true, true]]);
      const P2 = await papel(c, "R9d P2 plan leitor", [[PL, true, false]]);
      const P3 = await papel(c, "R9d P3 etapas+dev", [[ETP, true, true], [DEV, true, false]]);
      const P4 = await papel(c, "R9d P4 so servicos", [[SRV, true, true]]);
      const P5 = await papel(c, "R9d P5 ja tem", [[PL, true, true], [SEC, true, false]]);
      await usuario(c, U(11), P1, []); // herda (t,t): sem linha própria
      await usuario(c, U(12), P4, [[PL, true, false]]); // exceção vê Plan + papel edita Serviços → Editor (papel sem seção) → linha (t,t)
      await usuario(c, U(13), P1, [[PL, false, false]]); // exceção NEGATIVA do Plan → nada; o papel daria (t,t) → linha (f,f)
      await usuario(c, U(14), P2, [[ETP, true, true]]); // papel Leitor + exceção edita Etapas e vê Plan (papel) → Editor → linha (t,t)
      await usuario(c, U(15), P5, [[ETP, true, true]]); // papel JÁ tinha a seção (configurada): respeita, sem exceção nova
      await usuario(c, U(16), P2, []); // herda (t,f)
      await usuario(c, U(17), P4, []); // papel sem seção e sem ver Plan/Dev → nada
      await aplica(c, D!.mig);
      expect(await secPapel(c, P1)).toEqual({ ver: true, ed: true });
      expect(await secPapel(c, P2)).toEqual({ ver: true, ed: false });
      expect(await secPapel(c, P3)).toEqual({ ver: true, ed: true });
      expect(await secPapel(c, P4)).toBeNull();
      expect(await secPapel(c, P5)).toEqual({ ver: true, ed: false }); // intocada (ON CONFLICT)
      expect(await secUser(c, U(11))).toBeNull();
      expect(await secUser(c, U(12))).toEqual({ ver: true, ed: true });
      expect(await secUser(c, U(13))).toEqual({ ver: false, ed: false });
      expect(await secUser(c, U(14))).toEqual({ ver: true, ed: true });
      expect(await secUser(c, U(15))).toBeNull();
      expect(await secUser(c, U(16))).toBeNull();
      expect(await secUser(c, U(17))).toBeNull();
      // o que conta: a permissão EFETIVA
      expect(await efetiva(c, U(11))).toEqual({ ver: true, ed: true });
      expect(await efetiva(c, U(12))).toEqual({ ver: true, ed: true });
      expect(await efetiva(c, U(13))).toEqual({ ver: false, ed: false });
      expect(await efetiva(c, U(14))).toEqual({ ver: true, ed: true });
      expect(await efetiva(c, U(15))).toEqual({ ver: true, ed: false });
      expect(await efetiva(c, U(16))).toEqual({ ver: true, ed: false });
      expect(await efetiva(c, U(17))).toEqual({ ver: false, ed: false });
      const a = await contaSec(c);
      await aplica(c, D!.mig);
      expect(await contaSec(c)).toEqual(a);
    });
  });

  it("dados reais da cópia: depois da ida, a seção EFETIVA de todo usuário = a regra sobre a permissão efetiva de antes (nada some em gatilho silencioso)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await antesR9d(c);
      const users = (await c.query("SELECT id FROM public.users WHERE tenant_id IS NOT NULL ORDER BY id")).rows.map((r) => r.id as string);
      const esperado: Record<string, { ver: boolean; ed: boolean }> = {};
      for (const u of users) esperado[u] = await regraEsperada(c, u);
      await aplica(c, D!.mig);
      for (const u of users) expect(await efetiva(c, u), u).toEqual(esperado[u]);
      const nEd = Object.values(esperado).filter((x) => x.ed).length;
      const nLe = Object.values(esperado).filter((x) => x.ver && !x.ed).length;
      // cópia (06/out): 14 Editores, 0 Leitores (o relatório da T4 traz as contagens)
      expect(nEd + nLe).toBeGreaterThan(0);
      const semPapel = (await um<{ n: number }>(c, "SELECT count(*)::int AS n FROM public.users WHERE papel_id IS NOT NULL")).n === 0;
      if (semPapel) expect((await contaSec(c)).u).toBe(nEd + nLe); // sem papel: 1 linha por usuário que ganha a seção
    });
  });

  it("guarda: sem a 193000 viva (salvar_peca_teste sem o portão da seção) a ida RECUSA e nada grava", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await antesR9d(c);
      await usuario(c, U(21), null, [[PL, true, true]]);
      if (await urgcViva(c, "r9c")) await aplica(c, URGC_BLOCOS.r9c!.down);
      await aplica(c, URGC_BLOCOS.r9b!.down);
      const r = await tenta(c, D!.mig);
      expect(txt(r)).toMatch(/^P0001 urg_r9d: exige a 20261103193000/);
      expect(await secUser(c, U(21))).toBeNull();
    });
  });
});

// ---------------------------------------------------------------- r9e (196000)
type Cen = {
  suf: string;
  catP: string; // tipo da trilha (exige peça teste)
  catQ: string; // outro tipo
  f1: string; // fornecedor de serviço da loja
  fMat: string; // empresa de MATERIAL da loja
};
async function cenario(c: Client): Promise<Cen> {
  const suf = Math.random().toString(36).slice(2, 8);
  return comoSistema(c, async () => {
    const cat = async (n: string, ordem: number, exige: boolean) =>
      (
        await um<{ id: string }>(
          c,
          `INSERT INTO public.categorias_terceirizado (tenant_id, nome, etapa, ordem, exige_peca_teste)
           VALUES ($1, $2, 'ate_costura', $3, $4) RETURNING id`,
          [T, `${n} R9e ${suf}`, ordem, exige],
        )
      ).id;
    const emp = async (nome: string, tipo: string) =>
      (
        await um<{ id: string }>(c, "INSERT INTO public.empresas (tenant_id, nome_fantasia, tipo) VALUES ($1, $2, $3) RETURNING id", [
          T,
          `${nome} ${suf}`,
          tipo,
        ])
      ).id;
    return {
      suf,
      catP: await cat("PLX", 9101, true),
      catQ: await cat("Bordado", 9102, false),
      f1: await emp("Oficina R9e", "servico"),
      fMat: await emp("Malharia R9e", "material"),
    };
  });
}
async function modelo(c: Client, nome: string): Promise<{ m: string; cad: string }> {
  return comoSistema(c, async () => {
    const m = (
      await um<{ id: string }>(
        c,
        `INSERT INTO public.modelos (tenant_id, nome, ordem_criacao_enviada, status_desenvolvimento) VALUES ($1, $2, true, 'entrada') RETURNING id`,
        [T, nome],
      )
    ).id;
    const cad = (await um<{ id: string }>(c, "INSERT INTO public.cad (tenant_id, modelo_id) VALUES ($1, $2) RETURNING id", [T, m])).id;
    return { m, cad };
  });
}
async function linha(c: Client, m: string, cat: string, emp: string | null): Promise<string> {
  return comoSistema(c, async () =>
    (
      await um<{ id: string }>(
        c,
        `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, empresa_id) VALUES ($1, $2, $3, 10, $4) RETURNING id`,
        [T, m, cat, emp],
      )
    ).id,
  );
}
type Blo = {
  cad: string;
  cat: string;
  saida?: string | null;
  entrada?: string | null;
  aprov?: string | null;
  mo?: string | null;
  emp?: string | null;
  interno?: boolean;
};
async function bloco(c: Client, b: Blo): Promise<string> {
  return comoSistema(c, async () =>
    (
      await um<{ id: string }>(
        c,
        `INSERT INTO public.producao_terceirizados (cad_id, tenant_id, categoria_terceirizado_id, ativo, interno, empresa_id, mo_linha_id,
                                                    pt_data_saida, pt_data_entrada, pt_aprovacao)
         VALUES ($1, $2, $3, true, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [b.cad, T, b.cat, b.interno ?? false, b.emp ?? null, b.mo ?? null, b.saida ?? null, b.entrada ?? null, b.aprov ?? null],
      )
    ).id,
  );
}
/** Estado "antes da 196000" dentro da txn: `_down` (desliga o que a ida ligou), `_down_drop` (apaga os backups) e sem tentativas legado. */
async function antesR9e(c: Client): Promise<void> {
  if (await existe(c, BKP_PL)) await aplica(c, E!.down);
  if ((await existe(c, BKP)) || (await existe(c, BKP_PL))) {
    await c.query("SELECT set_config('app.confirmo_apagar_backup_r9', 'sim', true)");
    await aplica(c, E!.drop!);
    await c.query("SELECT set_config('app.confirmo_apagar_backup_r9', '', true)");
  }
  await comoSistema(c, () => c.query(`DELETE FROM ${TAB} WHERE origem = 'legado'`));
}
async function decisao(c: Client, bloco: string): Promise<string | null> {
  const r = await c.query(`SELECT decisao FROM ${BKP} WHERE bloco_id = $1`, [bloco]);
  return r.rowCount ? r.rows[0].decisao : null;
}
type Tent = {
  id: string;
  mo_linha_id: string | null;
  categoria_terceirizado_id: string;
  numero: number;
  empresa_id: string | null;
  data_saida: string | null;
  data_entrada: string | null;
  aprovacao: string | null;
  decidido_em: string | null;
  decidido_por: string | null;
  origem: string;
  legado_bloco_id: string | null;
  rev: number;
};
async function tentDoBloco(c: Client, bloco: string): Promise<Tent | null> {
  const r = await c.query(
    `SELECT id, mo_linha_id, categoria_terceirizado_id, numero, empresa_id, to_char(data_saida, 'YYYY-MM-DD') AS data_saida,
            to_char(data_entrada, 'YYYY-MM-DD') AS data_entrada, aprovacao, decidido_em::text, decidido_por, origem, legado_bloco_id, rev
       FROM ${TAB} WHERE legado_bloco_id = $1`,
    [bloco],
  );
  return r.rowCount ? r.rows[0] : null;
}
async function tentDaLinha(c: Client, l: string): Promise<number> {
  return (await um<{ n: number }>(c, `SELECT count(*)::int AS n FROM ${TAB} WHERE mo_linha_id = $1`, [l])).n;
}
async function aprovada(c: Client, l: string, cat: string): Promise<boolean> {
  return (
    await um<{ ok: boolean }>(
      c,
      "SELECT public._peca_teste_aprovada(s.id, $2, s.empresa_id) AS ok FROM public.modelo_servico_mo s WHERE s.id = $1",
      [l, cat],
    )
  ).ok;
}
async function fotoPt(c: Client): Promise<string> {
  return (
    await um<{ m: string }>(
      c,
      `SELECT md5(coalesce(string_agg(id::text || '|' || coalesce(pt_data_saida::text, '') || '|' || coalesce(pt_data_entrada::text, '')
                  || '|' || coalesce(pt_aprovacao, '') || '|' || coalesce(mo_linha_id::text, '') || '|' || rev::text, ',' ORDER BY id), '')) AS m
         FROM public.producao_terceirizados`,
    )
  ).m;
}
async function fila(c: Client): Promise<number> {
  return (await um<{ n: number }>(c, "SELECT count(*)::int AS n FROM public.kanban_recalculo_fila")).n;
}
type PlCat = { id: string; tenant_id: string; exige: boolean };
async function categoriasPl(c: Client): Promise<{ comPl: PlCat[]; semPl: PlCat[] }> {
  const r = (
    await c.query(
      `SELECT c.id, c.tenant_id, c.exige_peca_teste AS exige, public._tenant_modulo_ligado(c.tenant_id, 'etapas_pl') AS pl
         FROM public.categorias_terceirizado c WHERE lower(btrim(c.nome)) = 'pl' ORDER BY c.id`,
    )
  ).rows;
  return {
    comPl: r.filter((x) => x.pl).map(({ id, tenant_id, exige }) => ({ id, tenant_id, exige })),
    semPl: r.filter((x) => !x.pl).map(({ id, tenant_id, exige }) => ({ id, tenant_id, exige })),
  };
}

describe.skipIf(!RODA)("urg R9e — 196000 pt_* legados viram a 1ª tentativa + switch PL", () => {
  it("classificação de cada bloco + tentativa 1 (datas/decisão/fornecedor da linha) + backup; pt_* e fila intocados; reaplicar = 0", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await antesR9e(c);
      const s = await cenario(c);
      // 1) migrado: linha única do tipo com fornecedor; aprovado com as 2 datas → tentativa 1 aprovada, fornecedor = o da linha
      const a = await modelo(c, `R9e A ${s.suf}`);
      const lA = await linha(c, a.m, s.catP, s.f1);
      await linha(c, a.m, s.catQ, s.f1); // linha de outro tipo não atrapalha
      const bA = await bloco(c, { cad: a.cad, cat: s.catP, saida: D1, entrada: D2, aprov: "aprovado", emp: s.fMat }); // fornecedor do bloco difere
      // 2) aprovado sem data de entrada → migrado_sem_decisao
      const b = await modelo(c, `R9e B ${s.suf}`);
      const lB = await linha(c, b.m, s.catP, s.f1);
      const bB = await bloco(c, { cad: b.cad, cat: s.catP, saida: D1, aprov: "aprovado" });
      // 3) sem linha do tipo → sem_linha
      const cc = await modelo(c, `R9e C ${s.suf}`);
      await linha(c, cc.m, s.catQ, s.f1);
      const bC = await bloco(c, { cad: cc.cad, cat: s.catP, saida: D1, entrada: D2, aprov: "aprovado" });
      // 4) 2 linhas do tipo, sem mo_linha_id → ambigua
      const d = await modelo(c, `R9e D ${s.suf}`);
      const lD1 = await linha(c, d.m, s.catP, s.f1);
      const lD2 = await linha(c, d.m, s.catP, s.f1);
      const bD = await bloco(c, { cad: d.cad, cat: s.catP, saida: D1 });
      // 5) 2 linhas do tipo, mo_linha_id aponta uma → ganha da busca por tipo
      const e = await modelo(c, `R9e E ${s.suf}`);
      const lE1 = await linha(c, e.m, s.catP, s.f1);
      const lE2 = await linha(c, e.m, s.catP, s.f1);
      const bE = await bloco(c, { cad: e.cad, cat: s.catP, saida: D1, mo: lE2 });
      // 6) reprovado com as 2 datas → tentativa 1 reprovada (fornecedor congelado = o da linha); atual = virtual 2
      const f = await modelo(c, `R9e F ${s.suf}`);
      const lF = await linha(c, f.m, s.catP, s.f1);
      const bF = await bloco(c, { cad: f.cad, cat: s.catP, saida: D1, entrada: D2, aprov: "reprovado" });
      // 7) aprovado com as 2 datas, linha SEM fornecedor → migrado_sem_fornecedor (sem decisão)
      const g = await modelo(c, `R9e G ${s.suf}`);
      const lG = await linha(c, g.m, s.catP, null);
      const bG = await bloco(c, { cad: g.cad, cat: s.catP, saida: D1, entrada: D2, aprov: "aprovado" });
      // 8) 2 blocos legados na mesma linha → ambigua (os 2)
      const h = await modelo(c, `R9e H ${s.suf}`);
      const lH = await linha(c, h.m, s.catP, s.f1);
      const bH1 = await bloco(c, { cad: h.cad, cat: s.catP, saida: D1 });
      const bH2 = await bloco(c, { cad: h.cad, cat: s.catP, saida: D2 });
      // 9) trilha já com tentativa do CARD → card_ja_tem
      const i = await modelo(c, `R9e I ${s.suf}`);
      const lI = await linha(c, i.m, s.catP, s.f1);
      await comoSistema(c, () =>
        c.query(
          `INSERT INTO ${TAB} (tenant_id, modelo_id, mo_linha_id, categoria_terceirizado_id, numero, data_saida, origem) VALUES ($1, $2, $3, $4, 1, $5, 'card')`,
          [T, i.m, lI, s.catP, D2],
        ),
      );
      const bI = await bloco(c, { cad: i.cad, cat: s.catP, saida: D1, entrada: D2, aprov: "aprovado" });
      // 10) interno → interno
      const j = await modelo(c, `R9e J ${s.suf}`);
      const lJ = await linha(c, j.m, s.catP, s.f1);
      const bJ = await bloco(c, { cad: j.cad, cat: s.catP, saida: D1, interno: true });
      // 11) só a decisão, sem nenhuma data → sem_datas
      const k = await modelo(c, `R9e K ${s.suf}`);
      const lK = await linha(c, k.m, s.catP, s.f1);
      const bK = await bloco(c, { cad: k.cad, cat: s.catP, aprov: "aprovado" });
      // 12) só data de saída, sem decisão → migrado (em teste)
      const l = await modelo(c, `R9e L ${s.suf}`);
      const lL = await linha(c, l.m, s.catP, s.f1);
      const bL = await bloco(c, { cad: l.cad, cat: s.catP, saida: D1 });
      // 13) aprovado com as 2 datas, fornecedor da linha é de MATERIAL → migrado_sem_fornecedor
      const mm = await modelo(c, `R9e M ${s.suf}`);
      const lM = await linha(c, mm.m, s.catP, s.fMat);
      const bM = await bloco(c, { cad: mm.cad, cat: s.catP, saida: D1, entrada: D2, aprov: "aprovado" });
      // 14) mo_linha_id de OUTRO tipo → ignorado; vale a única linha do tipo
      const n = await modelo(c, `R9e N ${s.suf}`);
      const lNq = await linha(c, n.m, s.catQ, s.f1);
      const lN = await linha(c, n.m, s.catP, s.f1);
      const bN = await bloco(c, { cad: n.cad, cat: s.catP, saida: D1, entrada: D2, mo: lNq });

      const pt0 = await fotoPt(c);
      const fila0 = await fila(c);
      await aplica(c, E!.mig);
      expect(await urgcViva(c, "r9e")).toBe(true);

      expect(await decisao(c, bA)).toBe("migrado");
      expect(await tentDoBloco(c, bA)).toMatchObject({
        mo_linha_id: lA, categoria_terceirizado_id: s.catP, numero: 1, empresa_id: s.f1, data_saida: D1, data_entrada: D2,
        aprovacao: "aprovado", decidido_em: null, decidido_por: null, origem: "legado", rev: 0,
      });
      expect(await aprovada(c, lA, s.catP)).toBe(true); // a aprovada legada CONTA (fornecedor congelado = o da linha)

      expect(await decisao(c, bB)).toBe("migrado_sem_decisao");
      expect(await tentDoBloco(c, bB)).toMatchObject({ mo_linha_id: lB, data_saida: D1, data_entrada: null, aprovacao: null, empresa_id: null });
      expect(await aprovada(c, lB, s.catP)).toBe(false);

      expect(await decisao(c, bC)).toBe("sem_linha");
      expect(await tentDoBloco(c, bC)).toBeNull();

      expect(await decisao(c, bD)).toBe("ambigua");
      expect(await tentDoBloco(c, bD)).toBeNull();
      expect((await tentDaLinha(c, lD1)) + (await tentDaLinha(c, lD2))).toBe(0);

      expect(await decisao(c, bE)).toBe("migrado");
      expect(await tentDoBloco(c, bE)).toMatchObject({ mo_linha_id: lE2, data_saida: D1, aprovacao: null, empresa_id: null });
      expect(await tentDaLinha(c, lE1)).toBe(0);

      expect(await decisao(c, bF)).toBe("migrado");
      expect(await tentDoBloco(c, bF)).toMatchObject({ mo_linha_id: lF, numero: 1, aprovacao: "reprovado", empresa_id: s.f1 });
      expect(await aprovada(c, lF, s.catP)).toBe(false);
      const trilhaF = (await um<{ j: any }>(c, "SELECT public._peca_teste_trilhas_core($1, $2) AS j", [T, f.m])).j;
      const tf = trilhaF.trilhas.find((x: any) => x.mo_linha_id === lF);
      expect(tf.tentativas.map((x: any) => [x.numero, x.aprovacao])).toEqual([[1, "reprovado"]]); // a atual é a virtual nº 2

      expect(await decisao(c, bG)).toBe("migrado_sem_fornecedor");
      expect(await tentDoBloco(c, bG)).toMatchObject({ mo_linha_id: lG, data_saida: D1, data_entrada: D2, aprovacao: null, empresa_id: null });
      expect(await aprovada(c, lG, s.catP)).toBe(false); // NULL x NULL não vira "aprovada" sem fornecedor (revisão T2, achado 3)

      expect([await decisao(c, bH1), await decisao(c, bH2)]).toEqual(["ambigua", "ambigua"]);
      expect(await tentDaLinha(c, lH)).toBe(0);

      expect(await decisao(c, bI)).toBe("card_ja_tem");
      expect(await tentDoBloco(c, bI)).toBeNull();
      expect(await tentDaLinha(c, lI)).toBe(1);

      expect(await decisao(c, bJ)).toBe("interno");
      expect(await tentDaLinha(c, lJ)).toBe(0);

      expect(await decisao(c, bK)).toBe("sem_datas");
      expect(await tentDaLinha(c, lK)).toBe(0);

      expect(await decisao(c, bL)).toBe("migrado");
      expect(await tentDoBloco(c, bL)).toMatchObject({ mo_linha_id: lL, data_saida: D1, data_entrada: null, aprovacao: null });

      expect(await decisao(c, bM)).toBe("migrado_sem_fornecedor");
      expect(await tentDoBloco(c, bM)).toMatchObject({ mo_linha_id: lM, aprovacao: null, empresa_id: null });

      expect(await decisao(c, bN)).toBe("migrado");
      expect(await tentDoBloco(c, bN)).toMatchObject({ mo_linha_id: lN, aprovacao: null });
      expect(await tentDaLinha(c, lNq)).toBe(0);

      // backup: tentativa_id preenchido em todo migrado*, e as colunas do bloco copiadas
      const bk = await um<{ n: number; sem: number }>(
        c,
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE tentativa_id IS NULL)::int AS sem FROM ${BKP} WHERE decisao LIKE 'migrado%'`,
      );
      expect(bk.sem).toBe(0);
      expect(
        await um(c, `SELECT empresa_id, empresa_linha_id, pt_aprovacao, to_char(pt_data_saida, 'YYYY-MM-DD') AS s FROM ${BKP} WHERE bloco_id = $1`, [bA]),
      ).toEqual({ empresa_id: s.fMat, empresa_linha_id: s.f1, pt_aprovacao: "aprovado", s: D1 });
      const nLeg = await um<{ n: number }>(c, `SELECT count(*)::int AS n FROM ${TAB} WHERE origem = 'legado'`);
      expect(nLeg.n).toBe(bk.n);

      // pt_* intocadas; fila do kanban automático intocada (Loja Teste tem kanban automático e o PL dela foi ligado)
      expect(await fotoPt(c)).toBe(pt0);
      expect(await fila(c)).toBe(fila0);
      expect(await um(c, "SELECT current_setting('app.kanban_sistema', true) AS v")).toEqual({ v: "" });

      // reaplicar = 0 novas (backup e tentativas iguais)
      const foto = async () =>
        um(c, `SELECT (SELECT count(*)::int FROM ${BKP}) AS b, (SELECT count(*)::int FROM ${TAB}) AS t, (SELECT count(*)::int FROM ${BKP_PL}) AS p`);
      const f1 = await foto();
      await aplica(c, E!.mig);
      expect(await foto()).toEqual(f1);
      expect(await fotoPt(c)).toBe(pt0);
    });
  });

  it("migrada aprovada conta no requisito do kanban (com a M.O. aprovada); reprovada/sem fornecedor não", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await antesR9e(c);
      const s = await cenario(c);
      const a = await modelo(c, `R9e KA ${s.suf}`);
      const lA = await linha(c, a.m, s.catP, s.f1);
      await bloco(c, { cad: a.cad, cat: s.catP, saida: D1, entrada: D2, aprov: "aprovado" });
      const f = await modelo(c, `R9e KF ${s.suf}`);
      const lF = await linha(c, f.m, s.catP, s.f1);
      await bloco(c, { cad: f.cad, cat: s.catP, saida: D1, entrada: D2, aprov: "reprovado" });
      await aplica(c, E!.mig);
      await jwt(c, SUPER);
      await comoSistema(c, () => c.query("UPDATE public.modelo_servico_mo SET aprovado = true WHERE id = ANY($1::uuid[])", [[lA, lF]]));
      await jwt(c, null);
      const j = (await um<{ j: any }>(c, "SELECT public._avaliar_condicoes_kanban_core($1, $2::uuid[]) AS j", [T, [a.m, f.m]])).j;
      expect(j[a.m].peca_teste_aprovada).toBe(true);
      expect(j[f.m].peca_teste_aprovada).toBe(false);
      // a aprovada legada trava o fornecedor da linha (gatilho da 192000/193000)
      await c.query("SAVEPOINT r9e_trava");
      let msg = "";
      try {
        await c.query("UPDATE public.modelo_servico_mo SET empresa_id = NULL WHERE id = $1", [lA]);
      } catch (e: any) {
        msg = String(e.message);
      }
      await c.query("ROLLBACK TO SAVEPOINT r9e_trava");
      expect(msg).toMatch(/^peca_teste_fornecedor_travado/);
    });
  });

  it("os blocos legados REAIS da cópia saem como sem_linha (consulta 0-D do Passo 0)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await antesR9e(c);
      await aplica(c, E!.mig);
      const reais = (await c.query("SELECT id FROM public.producao_terceirizados WHERE id = ANY($1::uuid[])", [REAIS])).rows.map((r) => r.id);
      expect(reais.length).toBeGreaterThan(0);
      for (const id of reais) expect(await decisao(c, id), id).toBe("sem_linha");
      // nenhuma tentativa legado na cópia (0 de N migram — Ruling 18)
      const n = await um<{ n: number }>(c, `SELECT count(*)::int AS n FROM ${TAB} WHERE origem = 'legado'`);
      expect(n.n).toBe(0);
    });
  });

  it("switch PL (Ruling 19 / P-331 A): liga só a categoria PL das lojas com Etapas PL, uma vez (backup); _down desliga só o que ligou", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await antesR9e(c);
      const antes = await categoriasPl(c);
      expect(antes.comPl.length).toBeGreaterThan(0);
      const fila0 = await fila(c);
      await aplica(c, E!.mig);
      const dep = await categoriasPl(c);
      for (const x of dep.comPl) expect(x.exige, x.id).toBe(true);
      expect(dep.semPl).toEqual(antes.semPl); // lojas sem Etapas PL: intocadas
      const bk = (await c.query(`SELECT categoria_id, antes FROM ${BKP_PL} ORDER BY categoria_id`)).rows;
      expect(bk).toEqual(antes.comPl.filter((x) => !x.exige).map((x) => ({ categoria_id: x.id, antes: false })));
      expect(await fila(c)).toBe(fila0);

      // a pessoa DESLIGA o PL de uma loja depois da ida → reaplicar NÃO religa (só uma vez)
      const alvo = dep.comPl[0].id;
      await comoSistema(c, () => c.query("UPDATE public.categorias_terceirizado SET exige_peca_teste = false WHERE id = $1", [alvo]));
      await aplica(c, E!.mig);
      expect((await um<{ e: boolean }>(c, "SELECT exige_peca_teste AS e FROM public.categorias_terceirizado WHERE id = $1", [alvo])).e).toBe(false);
      // e LIGA outra categoria depois (não estava no backup): o _down não mexe nela
      const outra = dep.semPl[0]?.id ?? (await cenario(c)).catQ;
      await comoSistema(c, () => c.query("UPDATE public.categorias_terceirizado SET exige_peca_teste = true WHERE id = $1", [outra]));

      await aplica(c, E!.down);
      const volta = await categoriasPl(c);
      for (const x of volta.comPl) {
        const a = antes.comPl.find((y) => y.id === x.id)!;
        expect(x.exige, x.id).toBe(a.exige);
      }
      expect((await um<{ e: boolean }>(c, "SELECT exige_peca_teste AS e FROM public.categorias_terceirizado WHERE id = $1", [outra])).e).toBe(true);
      expect(await fila(c)).toBe(fila0);
      expect(await urgcViva(c, "r9e")).toBe(false);
      // o _down tira do backup o que devolveu (ida -> _down -> ida volta ao estado da ida); o que a pessoa desligou FICA no backup
      expect((await c.query(`SELECT categoria_id FROM ${BKP_PL}`)).rows.map((r) => r.categoria_id)).toEqual([alvo]);
      await aplica(c, E!.down); // 2x = no-op
      expect(await categoriasPl(c)).toEqual(volta);
      // ida de novo: religa o que o _down devolveu; o PL que a pessoa desligou continua desligado (está no backup)
      await aplica(c, E!.mig);
      for (const x of (await categoriasPl(c)).comPl) expect(x.exige, x.id).toBe(x.id === alvo ? false : true);
      expect(await urgcViva(c, "r9e")).toBe(true);
      expect(await fila(c)).toBe(fila0);
    });
  });

  it("_down mantém as tentativas legado (inertes; saem no 192000_down_drop) e é idempotente", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await antesR9e(c);
      const s = await cenario(c);
      const a = await modelo(c, `R9e DA ${s.suf}`);
      const lA = await linha(c, a.m, s.catP, s.f1);
      const bA = await bloco(c, { cad: a.cad, cat: s.catP, saida: D1, entrada: D2, aprov: "aprovado" });
      await aplica(c, E!.mig);
      const t = await tentDoBloco(c, bA);
      await aplica(c, E!.down);
      await aplica(c, E!.down);
      expect(await tentDoBloco(c, bA)).toEqual(t);
      expect(await tentDaLinha(c, lA)).toBe(1);
      expect(await decisao(c, bA)).toBe("migrado"); // o backup FICA
    });
  });

  it("backups: RLS ligada sem policy, nada para anon/authenticated/service_role", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await antesR9e(c);
      await aplica(c, E!.mig);
      for (const t of [BKP, BKP_PL]) {
        const r = await um<{ rls: boolean; pol: number; anon: boolean; auth: boolean; srv: boolean; acl: string }>(
          c,
          `SELECT c.relrowsecurity AS rls, (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS pol,
                  has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon,
                  has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS auth,
                  has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS srv,
                  coalesce(c.relacl::text, '') AS acl
             FROM pg_class c WHERE c.oid = to_regclass($1)`,
          [t],
        );
        expect({ rls: r.rls, pol: r.pol, anon: r.anon, auth: r.auth, srv: r.srv }, t).toEqual({ rls: true, pol: 0, anon: false, auth: false, srv: false });
        expect(r.acl).not.toMatch(/anon|authenticated|service_role/);
      }
    });
  });

  it("teto: > 200 blocos candidatos = RECUSA e nada grava", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await antesR9e(c);
      const s = await cenario(c);
      const a = await modelo(c, `R9e T ${s.suf}`);
      await comoSistema(c, () =>
        c.query(
          `INSERT INTO public.producao_terceirizados (cad_id, tenant_id, categoria_terceirizado_id, ativo, pt_data_saida)
           SELECT $1, $2, $3, true, $4::date FROM generate_series(1, 201)`,
          [a.cad, T, s.catP, D1],
        ),
      );
      const r = await tenta(c, E!.mig);
      expect(txt(r)).toMatch(/^P0001 urg_r9e: \d+ blocos legados a migrar \(teto 200\)/);
      expect(await existe(c, BKP)).toBe(false);
    });
  });

  it("guarda: sem a 193000 viva a ida RECUSA; _down_drop recusa sem a GUC e com o switch ainda ligado; depois do _down apaga (2x = no-op)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await antesR9e(c);
      // _down_drop sem backup = no-op (não exige a GUC)
      expect(txt(await tenta(c, E!.drop!))).toBe("PASSOU");
      await aplica(c, E!.mig);
      expect(txt(await tenta(c, E!.drop!))).toMatch(/^P0001 urg_r9e_down_drop: exige SET app\.confirmo_apagar_backup_r9/);
      await c.query("SELECT set_config('app.confirmo_apagar_backup_r9', 'sim', true)");
      expect(txt(await tenta(c, E!.drop!))).toMatch(/^P0001 urg_r9e_down_drop: .*rode o 20261103196000_down antes/);
      expect(await existe(c, BKP)).toBe(true);
      await aplica(c, E!.down);
      expect(txt(await tenta(c, E!.drop!))).toBe("PASSOU");
      expect([await existe(c, BKP), await existe(c, BKP_PL)]).toEqual([false, false]);
      expect(txt(await tenta(c, E!.drop!))).toBe("PASSOU");
      await c.query("SELECT set_config('app.confirmo_apagar_backup_r9', '', true)");
      // sem a 193000 viva
      if (await urgcViva(c, "r9c")) await aplica(c, URGC_BLOCOS.r9c!.down);
      await aplica(c, URGC_BLOCOS.r9b!.down);
      const r = await tenta(c, E!.mig);
      expect(txt(r)).toMatch(/^P0001 urg_r9e: exige a 20261103193000/);
      expect(await existe(c, BKP)).toBe(false);
    });
  });
});
