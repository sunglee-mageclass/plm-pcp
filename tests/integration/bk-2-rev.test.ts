// Backend B2 — o `rev` das outras raízes colaborativas sobe UMA vez por transação (idioma da T5 da Modularidade).
// Plano: .superpowers/sdd/2026-10-05-backend/plan.md §3 B2 (+ K2/K3, Rulings R1). Migration GERADA 20261103141000_bk_rev_uma_vez_raizes
// (gerar-bk2.mjs): as 8 fn_colab_bump_* (cad direto/via ctv, artigo via variante, CQ, OC Tecido/Aviamento/Insumo, Plan. Tecido) só
// tocam a linha da raiz que AINDA não foi escrita por esta transação — `xmin` da raiz = xid de topo, OU = `xmin` da própria linha da
// filha (mesma SUBtransação). Efeito: +1 por TRANSAÇÃO (+2 quando a RPC grava a raiz DEPOIS das filhas). Cada caso em transação
// revertida (withTx) e SÓ na cópia local: a migration (ou o inverso) é aplicada DENTRO da txn (mig-txn, nunca \i). Os Salvar rodam
// como o cliente (papel authenticated + JWT do usuário da Loja Teste, loja ativa trocada DENTRO da txn), SEM savepoint em volta.
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, dbUrl, USER_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";
import { aplicaBk, bkViva } from "./bk-helpers";
import { modViva } from "./mod-helpers";
import { MOD_MD5, MOD5_DEPS, MOD5_GATILHOS } from "./mod-5-dados";
import {
  BK_MD5,
  BK_MIG,
  BK_DOWN,
  BK2_ACL,
  BK2_SEG,
  BK2_RAIZ,
  BK2_GATILHOS,
  BK2_DEPS,
  BK2_REV,
} from "./bk-2-dados";

const RODA = hasDb && ehBancoLocal();
const PRED = "xmin <> pg_current_xact_id()::xid";
const FNS = Object.keys(BK_MD5);

async function zeraTimeouts(c: Client): Promise<void> {
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}
async function aplica(c: Client, rel: string): Promise<void> {
  await aplicarArquivo(c, rel);
  await zeraTimeouts(c);
}
const md5Fn = async (c: Client, f: string) =>
  (
    await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [
      f,
    ])
  ).m;
/** Estado SEM a B2 nesta txn (cópia com ou sem a B2 aplicada). */
async function semB2(c: Client): Promise<void> {
  if (await bkViva(c, "B2")) await aplica(c, BK_DOWN);
  for (const f of FNS) expect(await md5Fn(c, f)).toBe(BK_MD5[f].antes);
}
/** Estado COM a B2 nesta txn (aplica os blocos da frente que faltarem, na ordem, até a B2). */
async function comB2(c: Client): Promise<void> {
  await aplicaBk(c, "B2");
  for (const f of FNS) expect(await md5Fn(c, f)).toBe(BK_MD5[f].depois);
}
const estado = (c: Client, com: boolean) => (com ? comB2(c) : semB2(c));

/** Cliente da tela: JWT do usuário da Loja Teste (super admin) com a loja ativa = `tenant` (só nesta txn) e papel authenticated. */
async function comoCliente<T>(c: Client, tenant: string, fn: () => Promise<T>): Promise<T> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: USER_TESTE, role: "authenticated" }),
  ]);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [tenant, USER_TESTE]);
  await c.query("SET LOCAL ROLE authenticated");
  // Em erro a txn fica abortada: o ROLLBACK TO SAVEPOINT de quem chamou (tenta) desfaz o SET LOCAL ROLE junto.
  const r = await fn();
  await c.query("RESET ROLE");
  return r;
}
/** Igual, dentro de um SAVEPOINT: erro volta ao savepoint e é devolvido. */
async function tenta(c: Client, fn: () => Promise<unknown>): Promise<string> {
  await c.query("SAVEPOINT bk2");
  try {
    await fn();
    await c.query("RELEASE SAVEPOINT bk2");
    return "PASSOU";
  } catch (e) {
    const er = e as { code?: string; message?: string };
    await c.query("RESET ROLE").catch(() => undefined);
    await c.query("ROLLBACK TO SAVEPOINT bk2");
    await c.query("RELEASE SAVEPOINT bk2");
    return `${er.code} ${er.message}`;
  }
}

const revDe = async (c: Client, tabela: string, id: string, col = "rev") =>
  Number(
    (await um<{ r: number }>(c, `SELECT ${col} AS r FROM public.${tabela} WHERE id = $1`, [id])).r,
  );

// ───────────────────────────── os Salvar típicos de cada tela ─────────────────────────────
type Cenario = {
  nome: string;
  raiz: string;
  /** linhas-filha que o Salvar escreve (cada uma era +1 antes da B2) — o mínimo esperado "antes". */
  minAntes: number;
  /** +1, ou +2 quando a RPC grava a raiz DEPOIS das filhas. */
  esperadoCom: number;
  /** colunas de rev medidas (colecoes: plan_rev e otb_rev). */
  cols?: string[];
  acha: (
    c: Client,
  ) => Promise<{ id: string; tenant: string; ctx?: Record<string, unknown> } | null>;
  /** o Salvar; `base` = rev lido antes (a trava otimista). */
  salva: (
    c: Client,
    a: { id: string; tenant: string; ctx?: Record<string, unknown> },
    base: number,
  ) => Promise<void>;
  /** id do card (modelos) para medir auditoria/filas, se houver. */
  modelo?: (c: Client, id: string) => Promise<string | null>;
};

// item de OC de aviamento que pode ser copiado como item NOVO sem cair na regra da cor obrigatória (L9, P-208 A)
const COPIAVEL_AVI = `(NOT coalesce(i.cancelado, false) AND (i.variante_aviamento_id IS NOT NULL
  OR (SELECT count(*) FROM variantes_aviamento va WHERE va.aviamento_id = i.aviamento_id) < 2))`;

const CENARIOS: Cenario[] = [
  {
    nome: "OC Tecido (salvar_oc_tecido, itens devolvidos iguais)",
    raiz: "ocs_tecido",
    minAntes: 8,
    esperadoCom: 2, // itens antes do cabeçalho: a 1ª linha sobe, o UPDATE do cabeçalho soma 1
    acha: async (c) =>
      (
        await c.query(
          `SELECT o.id, o.tenant_id AS tenant FROM ocs_tecido o JOIN ocs_tecido_itens i ON i.oc_tecido_id = o.id
            WHERE NOT coalesce(o.is_rolo, false) AND i.variante_tecido_id IS NOT NULL AND i.artigo_id IS NOT NULL
            GROUP BY o.id ORDER BY count(*) DESC, o.id LIMIT 1`,
        )
      ).rows[0] ?? null,
    salva: async (c, a, base) => {
      const p = await um<{ oc: string; it: string }>(
        c,
        `SELECT to_jsonb(o)::text AS oc,
                (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM ocs_tecido_itens i WHERE i.oc_tecido_id = o.id)::text AS it
           FROM ocs_tecido o WHERE o.id = $1`,
        [a.id],
      );
      await comoCliente(c, a.tenant, () =>
        c.query("SELECT public.salvar_oc_tecido($1, $2::jsonb, $3::jsonb, $4)", [
          a.id,
          p.oc,
          p.it,
          base,
        ]),
      );
    },
  },
  {
    nome: "OC Aviamento (salvar_oc_aviamento 4 args, itens + 4 novos)",
    raiz: "ocs_aviamento",
    minAntes: 5,
    esperadoCom: 2,
    acha: async (c) =>
      (
        await c.query(
          `SELECT o.id, o.tenant_id AS tenant FROM ocs_aviamento o JOIN ocs_aviamento_itens i ON i.oc_aviamento_id = o.id
            WHERE o.status <> 'recebido'
            GROUP BY o.id
           HAVING bool_or(${COPIAVEL_AVI}) ORDER BY count(*) DESC, o.id LIMIT 1`,
        )
      ).rows[0] ?? null,
    salva: async (c, a, base) => {
      const p = await um<{ oc: string; it: string }>(
        c,
        `WITH it AS (SELECT i.* FROM ocs_aviamento_itens i WHERE i.oc_aviamento_id = $1),
              modelo AS (SELECT * FROM it i WHERE ${COPIAVEL_AVI} ORDER BY id LIMIT 1)
         SELECT (SELECT to_jsonb(o) FROM ocs_aviamento o WHERE o.id = $1)::text AS oc,
                ((SELECT jsonb_agg(to_jsonb(it) ORDER BY it.id) FROM it)
                 || (SELECT jsonb_agg(to_jsonb(m) - 'id' - 'oc_aviamento_id') FROM modelo m, generate_series(1, 4)))::text AS it`,
        [a.id],
      );
      await comoCliente(c, a.tenant, () =>
        c.query("SELECT public.salvar_oc_aviamento($1, $2::jsonb, $3::jsonb, $4)", [
          a.id,
          p.oc,
          p.it,
          base,
        ]),
      );
    },
  },
  {
    nome: "OC Insumo (salvar_oc_etiqueta 4 args, itens + 4 novos)",
    raiz: "ocs_etiqueta",
    minAntes: 5,
    esperadoCom: 2,
    acha: async (c) =>
      (
        await c.query(
          `SELECT o.id, o.tenant_id AS tenant FROM ocs_etiqueta o JOIN ocs_etiqueta_itens i ON i.oc_etiqueta_id = o.id
            WHERE o.status <> 'recebido'
            GROUP BY o.id ORDER BY count(*) DESC, o.id LIMIT 1`,
        )
      ).rows[0] ?? null,
    salva: async (c, a, base) => {
      const p = await um<{ oc: string; it: string }>(
        c,
        `WITH it AS (SELECT i.* FROM ocs_etiqueta_itens i WHERE i.oc_etiqueta_id = $1),
              modelo AS (SELECT * FROM it ORDER BY id LIMIT 1)
         SELECT (SELECT to_jsonb(o) FROM ocs_etiqueta o WHERE o.id = $1)::text AS oc,
                ((SELECT jsonb_agg(to_jsonb(it) ORDER BY it.id) FROM it)
                 || (SELECT jsonb_agg(to_jsonb(m) - 'id' - 'oc_etiqueta_id') FROM modelo m, generate_series(1, 4)))::text AS it`,
        [a.id],
      );
      await comoCliente(c, a.tenant, () =>
        c.query("SELECT public.salvar_oc_etiqueta($1, $2::jsonb, $3::jsonb, $4)", [
          a.id,
          p.oc,
          p.it,
          base,
        ]),
      );
    },
  },
  {
    nome: "CQ Pré (salvar_cq, cq_variantes regravadas)",
    raiz: "controle_qualidade",
    minAntes: 8, // ≥ 4 variantes: apagar + inserir
    esperadoCom: 1, // o cabeçalho é gravado ANTES das variantes
    acha: async (c) =>
      (
        await c.query(
          `SELECT q.id, q.tenant_id AS tenant, jsonb_build_object('cad', q.cad_id) AS ctx
             FROM controle_qualidade q JOIN cq_variantes v ON v.controle_qualidade_id = q.id
            WHERE coalesce(q.status, 'pendente') <> 'confirmado'
            GROUP BY q.id HAVING count(*) >= 4 ORDER BY count(*) DESC, q.id LIMIT 1`,
        )
      ).rows[0] ?? null,
    salva: async (c, a, base) => {
      const cad = String(a.ctx!.cad);
      const p = await um<{ cq: string; va: string; rb: string }>(
        c,
        `SELECT to_jsonb(q)::text AS cq,
                (SELECT jsonb_agg(jsonb_build_object('variante_numero', v.variante_numero, 'etapa', v.etapa, 'grades', v.grades,
                   'destino_defeito', v.destino_defeito) ORDER BY v.id) FROM cq_variantes v WHERE v.controle_qualidade_id = q.id)::text AS va,
                jsonb_build_object('cq', $2::int, 'fonte',
                  (SELECT pt.rev FROM producao_terceirizados pt WHERE pt.id = public._resolver_fonte_confeccao(q.cad_id)))::text AS rb
           FROM controle_qualidade q WHERE q.id = $1`,
        [a.id, base],
      );
      await comoCliente(c, a.tenant, () =>
        c.query(
          "SELECT public.salvar_cq($1, $2::jsonb, $3::jsonb, '[]'::jsonb, false, $4::jsonb)",
          [cad, p.cq, p.va, p.rb],
        ),
      );
    },
    modelo: async (c, id) =>
      (
        await um<{ m: string | null }>(
          c,
          `SELECT cad.modelo_id AS m FROM controle_qualidade q JOIN cad ON cad.id = q.cad_id WHERE q.id = $1`,
          [id],
        )
      ).m,
  },
  {
    nome: "CAD (salvar_cad_completo, ficha regravada)",
    raiz: "cad",
    minAntes: 4,
    esperadoCom: 2, // filhas antes do UPDATE do cad
    acha: async (c) =>
      (
        await c.query(
          `SELECT c.id, c.tenant_id AS tenant, jsonb_build_object('modelo', c.modelo_id) AS ctx
             FROM cad c JOIN cad_tecidos ct ON ct.cad_id = c.id JOIN cad_tecido_variantes v ON v.cad_tecido_id = ct.id
             JOIN modelos m ON m.id = c.modelo_id AND coalesce(m.ordem_criacao_enviada, false)
            GROUP BY c.id HAVING count(*) >= 4 ORDER BY count(*) DESC, c.id LIMIT 1`,
        )
      ).rows[0] ?? null,
    salva: async (c, a) => {
      const p = await um<{
        m: string;
        t: string;
        av: string;
        et: string;
        pr: string;
        obs: string | null;
      }>(
        c,
        `SELECT c.modelo_id AS m,
            coalesce((SELECT jsonb_agg(jsonb_build_object('artigo_id', ct.artigo_id, 'numero', ct.numero, 'tipo', ct.tipo,
                'consumo_cad', ct.consumo_cad, 'loss_percent_cad', ct.loss_percent_cad, 'custo_cad', ct.custo_cad,
                'tamanho_folha', ct.tamanho_folha,
                'variantes', (SELECT jsonb_agg(jsonb_build_object('variante_tecido_id', v.variante_tecido_id, 'ordem', v.ordem,
                    'multiplicador', v.multiplicador, 'quantidade_folhas', v.quantidade_folhas,
                    'metragem_planejada', v.metragem_planejada, 'metragem_enviada', v.metragem_enviada) ORDER BY v.ordem, v.id)
                  FROM cad_tecido_variantes v WHERE v.cad_tecido_id = ct.id)) ORDER BY ct.numero, ct.tipo, ct.id)
              FROM cad_tecidos ct WHERE ct.cad_id = c.id), '[]')::text AS t,
            coalesce((SELECT jsonb_agg(jsonb_build_object('aviamento_id', x.aviamento_id, 'numero', x.numero, 'consumo', x.consumo,
                'quantidade_enviar', x.quantidade_enviar, 'quantidade_separar', x.quantidade_separar,
                'variante_aviamento_id', x.variante_aviamento_id) ORDER BY x.numero, x.id)
              FROM cad_aviamentos x WHERE x.cad_id = c.id), '[]')::text AS av,
            coalesce((SELECT jsonb_agg(jsonb_build_object('etiqueta_id', e.etiqueta_id, 'cor_id', e.cor_id, 'consumo', e.consumo,
                'quantidade_planejada', e.quantidade_planejada, 'quantidade_enviar', e.quantidade_enviar,
                'enviar_por_tamanho', e.enviar_por_tamanho) ORDER BY e.id)
              FROM cad_etiquetas e WHERE e.cad_id = c.id), '[]')::text AS et,
            coalesce((SELECT m.proporcoes FROM modelos m WHERE m.id = c.modelo_id), '{}')::text AS pr,
            c.observacoes_molde AS obs
           FROM cad c WHERE c.id = $1`,
        [a.id],
      );
      await comoCliente(c, a.tenant, () =>
        c.query(
          "SELECT public.salvar_cad_completo($1, $2::jsonb, '[]'::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6, null)",
          [p.m, p.t, p.av, p.et, p.pr, p.obs],
        ),
      );
    },
    modelo: async (c, id) =>
      (await um<{ m: string | null }>(c, `SELECT modelo_id AS m FROM cad WHERE id = $1`, [id])).m,
  },
  {
    nome: "Explosão (salvar_explosao_metragem, variantes do CAD)",
    raiz: "cad",
    minAntes: 4,
    esperadoCom: 1,
    acha: async (c) =>
      (
        await c.query(
          `SELECT c.id, c.tenant_id AS tenant FROM cad c JOIN cad_tecidos ct ON ct.cad_id = c.id
             JOIN cad_tecido_variantes v ON v.cad_tecido_id = ct.id
            GROUP BY c.id HAVING count(*) >= 4 ORDER BY count(*) DESC, c.id LIMIT 1`,
        )
      ).rows[0] ?? null,
    salva: async (c, a, base) => {
      const p = await um<{ v: string }>(
        c,
        `SELECT jsonb_agg(jsonb_build_object('id', v.id, 'metragem_enviada', v.metragem_enviada,
            'quantidade_folhas', v.quantidade_folhas) ORDER BY v.id)::text AS v
           FROM cad_tecidos ct JOIN cad_tecido_variantes v ON v.cad_tecido_id = ct.id WHERE ct.cad_id = $1`,
        [a.id],
      );
      await comoCliente(c, a.tenant, () =>
        c.query("SELECT public.salvar_explosao_metragem($1, $2::jsonb, $3)", [a.id, p.v, base]),
      );
    },
    modelo: async (c, id) =>
      (await um<{ m: string | null }>(c, `SELECT modelo_id AS m FROM cad WHERE id = $1`, [id])).m,
  },
  {
    nome: "Plan. Tecido (salvar_plan_tecido, árvore regravada; plan_rev e otb_rev)",
    raiz: "colecoes",
    minAntes: 4,
    esperadoCom: 1, // o upsert de plan_tecido vem ANTES do resto da árvore
    cols: ["plan_rev", "otb_rev"],
    acha: async (c) =>
      (
        await c.query(
          `SELECT p.colecao_id AS id, col.tenant_id AS tenant FROM plan_tecido p JOIN colecoes col ON col.id = p.colecao_id
             JOIN plan_tecido_slot_oc s ON s.colecao_id = p.colecao_id
            GROUP BY p.colecao_id, col.tenant_id HAVING count(*) >= 2 ORDER BY count(*) DESC, p.colecao_id LIMIT 1`,
        )
      ).rows[0] ?? null,
    salva: async (c, a, base) => {
      await comoCliente(c, a.tenant, async () => {
        const arv = (
          await um<{ a: unknown }>(c, "SELECT public.plan_tecido_arvore($1) AS a", [a.id])
        ).a;
        await c.query("SELECT public.salvar_plan_tecido($1, $2::jsonb, $3)", [
          a.id,
          JSON.stringify(arv),
          base,
        ]);
      });
    },
  },
  {
    nome: "Cadastro de Tecido (variantes_tecido gravadas em lote pelo cliente; bump INVOKER)",
    raiz: "artigos",
    minAntes: 4,
    esperadoCom: 1,
    acha: async (c) =>
      (
        await c.query(
          `SELECT a.id, a.tenant_id AS tenant FROM artigos a JOIN variantes_tecido v ON v.artigo_id = a.id
            GROUP BY a.id HAVING count(*) >= 4 ORDER BY count(*) DESC, a.id LIMIT 1`,
        )
      ).rows[0] ?? null,
    salva: async (c, a) => {
      await comoCliente(c, a.tenant, () =>
        c.query(
          "UPDATE public.variantes_tecido SET nome_variante = nome_variante WHERE artigo_id = $1",
          [a.id],
        ),
      );
    },
  },
];

type Medida = { rev: number[]; audit: number; kfila: boolean; cfila: boolean };
async function mede(c: Client, cen: Cenario, id: string, modelo: string | null): Promise<Medida> {
  const cols = cen.cols ?? ["rev"];
  const rev: number[] = [];
  for (const col of cols) rev.push(await revDe(c, cen.raiz, id, col));
  const r = await um<{ audit: string; kfila: boolean; cfila: boolean }>(
    c,
    `SELECT (SELECT count(*) FROM audit_log) AS audit,
            EXISTS (SELECT 1 FROM kanban_recalculo_fila WHERE modelo_id = $1) AS kfila,
            EXISTS (SELECT 1 FROM custo_recalculo_fila WHERE modelo_id = $1) AS cfila`,
    [modelo],
  );
  return { rev, audit: Number(r.audit), kfila: r.kfila, cfila: r.cfila };
}

/** Mede um Salvar numa transação própria (sem ou com a B2). */
async function medeSalvar(cen: Cenario, com: boolean) {
  let out: { id: string; antes: Medida; depois: Medida; commit: Medida } | null = null;
  await withTx(async (c) => {
    await estado(c, com);
    const a = await cen.acha(c);
    if (!a) return;
    const modelo = cen.modelo ? await cen.modelo(c, a.id) : null;
    const antes = await mede(c, cen, a.id, modelo);
    await cen.salva(c, a, antes.rev[0]);
    const depois = await mede(c, cen, a.id, modelo);
    await c.query("SET CONSTRAINTS ALL IMMEDIATE"); // o que o COMMIT processaria (filas adiadas do kanban/custo)
    const commit = await mede(c, cen, a.id, modelo);
    out = { id: a.id, antes, depois, commit };
  });
  return out as { id: string; antes: Medida; depois: Medida; commit: Medida } | null;
}

describe.skipIf(!RODA)("bk B2 — rev das outras raízes sobe uma vez por transação", () => {
  it("medição por tela: antes da B2 +1 por linha da filha (N registrado); com a B2 +1 (+2 quando a raiz é gravada depois das filhas); auditoria ≤, filas iguais", async () => {
    const linhas: string[] = [];
    for (const cen of CENARIOS) {
      const sem = await medeSalvar(cen, false);
      const com = await medeSalvar(cen, true);
      expect(sem, `${cen.nome}: sem dado na cópia`).not.toBeNull();
      expect(com!.id).toBe(sem!.id);
      const cols = cen.cols ?? ["rev"];
      cols.forEach((col, k) => {
        const dSem = sem!.depois.rev[k] - sem!.antes.rev[k];
        const dCom = com!.depois.rev[k] - com!.antes.rev[k];
        const dSemC = sem!.commit.rev[k] - sem!.antes.rev[k];
        const dComC = com!.commit.rev[k] - com!.antes.rev[k];
        linhas.push(
          `${cen.nome} [${cen.raiz}.${col} ${sem!.id.slice(0, 8)}]: antes +${dSem} (COMMIT +${dSemC}); com a B2 +${dCom} (COMMIT +${dComC})`,
        );
        expect(com!.antes.rev[k]).toBe(sem!.antes.rev[k]); // as 2 txns partem do mesmo estado gravado
        expect(dSem, cen.nome).toBeGreaterThanOrEqual(cen.minAntes);
        expect(dCom, cen.nome).toBe(cen.esperadoCom); // nunca 0 numa raiz que existia antes da txn
        expect(dComC - dCom).toBe(dSemC - dSem); // o COMMIT soma o mesmo nos 2
      });
      // auditoria: só pode cair; filas (kanban/custo): o card entra igual e é processado no COMMIT
      expect(com!.depois.audit - com!.antes.audit).toBeLessThanOrEqual(
        sem!.depois.audit - sem!.antes.audit,
      );
      expect(com!.depois.kfila).toBe(sem!.depois.kfila);
      expect(com!.depois.cfila).toBe(sem!.depois.cfila);
      expect(com!.commit.kfila).toBe(sem!.commit.kfila);
      expect(com!.commit.cfila).toBe(sem!.commit.cfila);
    }
    console.log(`[bk B2] medição:\n  ${linhas.join("\n  ")}`);
  });

  it("raiz NOVA + filhas na mesma transação: sem bump extra (rev do INSERT) e sem erro; sem a B2 subiria 1 por item", async () => {
    const roda = async (com: boolean) => {
      let rev = 0,
        n = 0;
      await withTx(async (c) => {
        await estado(c, com);
        const a = (await CENARIOS[0].acha(c))!;
        const p = await um<{ oc: string; it: string }>(
          c,
          `SELECT (to_jsonb(o) - 'id' || jsonb_build_object('status', 'encomendado', 'numero_pedido', 'BK2-NOVA'))::text AS oc,
                  (SELECT jsonb_agg(to_jsonb(i) - 'id' - 'oc_tecido_id') FROM ocs_tecido_itens i WHERE i.oc_tecido_id = o.id)::text AS it
             FROM ocs_tecido o WHERE o.id = $1`,
          [a.id],
        );
        const nova = await comoCliente(c, a.tenant, () =>
          um<{ id: string }>(
            c,
            "SELECT public.salvar_oc_tecido(null, $1::jsonb, $2::jsonb, null) AS id",
            [p.oc, p.it],
          ),
        );
        rev = await revDe(c, "ocs_tecido", nova.id);
        n = Number(
          (
            await um<{ n: string }>(
              c,
              "SELECT count(*) AS n FROM ocs_tecido_itens WHERE oc_tecido_id = $1",
              [nova.id],
            )
          ).n,
        );
      });
      return { rev, n };
    };
    const com = await roda(true);
    const sem = await roda(false);
    expect(com.n).toBeGreaterThanOrEqual(8);
    expect(com.rev).toBe(1); // o rev do INSERT
    expect(sem.rev).toBeGreaterThan(com.n); // 1 por item
  });

  it("2 Salvar: na MESMA transação +1 no total (o 2º com a base nova passa); em transações separadas +1 cada", async () => {
    const cen = CENARIOS.find((x) => x.nome.startsWith("Explosão"))!;
    let base0 = 0,
      id = "";
    await withTx(async (c) => {
      await comB2(c);
      const a = (await cen.acha(c))!;
      id = a.id;
      base0 = await revDe(c, "cad", id);
      await cen.salva(c, a, base0);
      expect(await revDe(c, "cad", id)).toBe(base0 + 1);
      await cen.salva(c, a, base0 + 1); // base = o rev que a tela recebeu do 1º Salvar
      expect(await revDe(c, "cad", id)).toBe(base0 + 1);
    });
    await withTx(async (c) => {
      await comB2(c);
      const a = (await cen.acha(c))!;
      expect(a.id).toBe(id);
      expect(await revDe(c, "cad", id)).toBe(base0);
      await cen.salva(c, a, base0);
      expect(await revDe(c, "cad", id)).toBe(base0 + 1);
    });
  });

  it("P0409 continua com a B2 nas 7 raízes: base velha recusa de cara e DEPOIS de um Salvar no NÍVEL DE TOPO da mesma txn (OC Tecido/Aviamento/Insumo, CQ {cq,fonte}, Plan. Tecido, Explosão)", async () => {
    await withTx(async (c) => {
      await comB2(c);
      for (const nome of [
        "OC Tecido",
        "OC Aviamento",
        "OC Insumo",
        "CQ Pré",
        "Plan. Tecido",
        "Explosão",
      ]) {
        const cen = CENARIOS.find((x) => x.nome.startsWith(nome))!;
        const a = (await cen.acha(c))!;
        const col = (cen.cols ?? ["rev"])[0];
        const r0 = await revDe(c, cen.raiz, a.id, col);
        // base velha logo de cara (outra pessoa já salvou)
        expect(await tenta(c, () => cen.salva(c, a, r0 - 1)), nome).toMatch(
          /^P0409 conflito_versao/,
        );
        expect(await revDe(c, cen.raiz, a.id, col)).toBe(r0);
        // (review m1) A salva NO TOPO da txn (sem SAVEPOINT: o caminho em que a B2 pula os bumps): r0 → r0 + 1/+2
        await cen.salva(c, a, r0);
        const r1 = await revDe(c, cen.raiz, a.id, col);
        expect(r1, nome).toBeGreaterThan(r0);
        // B com a base de antes → P0409; nada muda
        expect(await tenta(c, () => cen.salva(c, a, r0)), nome).toMatch(/^P0409 conflito_versao/);
        expect(await revDe(c, cen.raiz, a.id, col)).toBe(r1);
        // a base nova (a que a tela de A recebeu) segue passando, de novo no topo
        await cen.salva(c, a, r1);
        expect(await revDe(c, cen.raiz, a.id, col), nome).toBeGreaterThanOrEqual(r1);
      }
    });
  });

  it("P0409 nos caminhos diretos (review m2): OC Insumo recebida (.eq(rev) da Nota), Cadastro de Tecido (.eq(rev) de artigos) e otb_rev depois de um Salvar do Plan. Tecido", async () => {
    await withTx(async (c) => {
      await comB2(c);
      // OC Insumo RECEBIDA: a tela grava só a Nota com UPDATE direto .eq("rev") (0 linhas = P0409 local)
      const oe = await um<{ id: string; tenant: string } | undefined>(
        c,
        `SELECT o.id, o.tenant_id AS tenant FROM ocs_etiqueta o
          WHERE o.status = 'recebido' AND EXISTS (SELECT 1 FROM ocs_etiqueta_itens i WHERE i.oc_etiqueta_id = o.id)
          ORDER BY o.id LIMIT 1`,
      );
      expect(oe, "OC de insumo recebida com itens na cópia").toBeTruthy();
      const nota = (id: string, rev: number) =>
        comoCliente(
          c,
          oe!.tenant,
          async () =>
            (
              await c.query(
                `UPDATE public.ocs_etiqueta SET data_nota_entrada = data_nota_entrada WHERE id = $1 AND rev = $2 RETURNING id, rev`,
                [id, rev],
              )
            ).rows as { id: string; rev: number }[],
        );
      const e0 = await revDe(c, "ocs_etiqueta", oe!.id);
      // outra pessoa grava um item (filha) no topo da txn → a raiz sobe 1 (1º bump da B2)
      await c.query(
        "UPDATE public.ocs_etiqueta_itens SET quantidade_pedida = quantidade_pedida WHERE oc_etiqueta_id = $1",
        [oe!.id],
      );
      expect(await revDe(c, "ocs_etiqueta", oe!.id)).toBe(e0 + 1);
      expect(await nota(oe!.id, e0)).toEqual([]); // base velha: 0 linhas
      const ok = await nota(oe!.id, e0 + 1);
      expect(ok.map((r) => r.rev)).toEqual([e0 + 2]);
      expect(await nota(oe!.id, e0 + 1)).toEqual([]); // e a base de antes do próprio save, também

      // Cadastro de Tecido: variantes gravadas pelo cliente (filhas) e depois o UPDATE .eq("rev") do artigo
      const art = (await CENARIOS.find((x) => x.raiz === "artigos")!.acha(c))!;
      const a0 = await revDe(c, "artigos", art.id);
      await comoCliente(c, art.tenant, () =>
        c.query(
          "UPDATE public.variantes_tecido SET nome_variante = nome_variante WHERE artigo_id = $1",
          [art.id],
        ),
      );
      expect(await revDe(c, "artigos", art.id)).toBe(a0 + 1);
      const artigo = (rev: number) =>
        comoCliente(
          c,
          art.tenant,
          async () =>
            (
              await c.query(
                "UPDATE public.artigos SET nome = nome WHERE id = $1 AND rev = $2 RETURNING rev",
                [art.id, rev],
              )
            ).rows as { rev: number }[],
        );
      expect(await artigo(a0)).toEqual([]);
      expect((await artigo(a0 + 1)).map((r) => r.rev)).toEqual([a0 + 2]);
      expect(await artigo(a0 + 1)).toEqual([]);

      // otb_rev: o OTB aberto na coleção, com a base de ANTES de um Salvar do Plan. Tecido, recebe P0409
      const pt = CENARIOS.find((x) => x.nome.startsWith("Plan. Tecido"))!;
      const col = (await pt.acha(c))!;
      const o0 = await revDe(c, "colecoes", col.id, "otb_rev");
      const p0 = await revDe(c, "colecoes", col.id, "plan_rev");
      await pt.salva(c, col, p0); // no topo da txn
      expect(await revDe(c, "colecoes", col.id, "otb_rev")).toBe(o0 + 1);
      const nomeCol = (
        await um<{ n: string }>(c, "SELECT nome AS n FROM colecoes WHERE id = $1", [col.id])
      ).n;
      expect(
        await tenta(c, () =>
          comoCliente(c, col.tenant, () =>
            c.query("SELECT public.otb_salvar_colecao($1::jsonb)", [
              JSON.stringify({ id: col.id, nome: nomeCol, rev_base: o0 }),
            ]),
          ),
        ),
      ).toMatch(/^P0409 conflito_versao/);
      expect(await revDe(c, "colecoes", col.id, "otb_rev")).toBe(o0 + 1);
    });
  });

  it("subtransação (SAVEPOINT/bloco EXCEPTION): INSERT de filha sobe 1 só; DELETE segue 1 por linha — nunca pior que antes", async () => {
    const roda = async (com: boolean) => {
      const out = { ins: 0, del: 0 };
      await withTx(async (c) => {
        await estado(c, com);
        const a = (await CENARIOS.find((x) => x.raiz === "controle_qualidade")!.acha(c))!;
        let r = await revDe(c, "controle_qualidade", a.id);
        await c.query("SAVEPOINT sp1");
        await c.query(
          `INSERT INTO cq_variantes (controle_qualidade_id, variante_numero, etapa, grades, grade_total)
           SELECT $1, 90 + g, 'recebimento', '{}'::jsonb, 0 FROM generate_series(1, 3) g`,
          [a.id],
        );
        await c.query("RELEASE SAVEPOINT sp1");
        out.ins = (await revDe(c, "controle_qualidade", a.id)) - r;
        r = await revDe(c, "controle_qualidade", a.id);
        await c.query("SAVEPOINT sp2");
        await c.query(
          `DELETE FROM cq_variantes WHERE id IN (SELECT id FROM cq_variantes WHERE controle_qualidade_id = $1 AND variante_numero < 90
             ORDER BY id LIMIT 3)`,
          [a.id],
        );
        await c.query("RELEASE SAVEPOINT sp2");
        out.del = (await revDe(c, "controle_qualidade", a.id)) - r;
      });
      return out;
    };
    const com = await roda(true);
    const sem = await roda(false);
    console.log(
      `[bk B2] SAVEPOINT (cq_variantes): INSERT 3 linhas sem +${sem.ins} / com +${com.ins}; DELETE 3 linhas sem +${sem.del} / com +${com.del}`,
    );
    expect(sem.ins).toBe(3);
    expect(com.ins).toBe(1); // a 1ª sobe; as seguintes: xmin da raiz = xmin da linha (mesma subtransação)
    expect(sem.del).toBe(3);
    expect(com.del).toBe(3); // DELETE em subtransação: sem linha para comparar → 1 por linha (limite aceito, como na T5)
  });

  it("bump INVOKER como o PAPEL authenticated (artigos via variantes_tecido, escrita direta do Cadastro): sem 42501/42703, +1 no topo e +1 num SAVEPOINT", async () => {
    await withTx(async (c) => {
      await comB2(c);
      const cen = CENARIOS.find((x) => x.raiz === "artigos")!;
      const a = (await cen.acha(c))!;
      const r0 = await revDe(c, "artigos", a.id);
      await c.query("SAVEPOINT inv");
      await comoCliente(c, a.tenant, () =>
        c.query(
          "UPDATE public.variantes_tecido SET nome_variante = nome_variante WHERE artigo_id = $1",
          [a.id],
        ),
      );
      await c.query("RELEASE SAVEPOINT inv");
      expect(await revDe(c, "artigos", a.id)).toBe(r0 + 1); // dentro do SAVEPOINT: o caminho (2) leu a filha como authenticated
      const r1 = await revDe(c, "artigos", a.id);
      expect(
        await tenta(c, () =>
          comoCliente(c, a.tenant, () =>
            c.query(
              "UPDATE public.variantes_tecido SET nome_variante = nome_variante WHERE artigo_id = $1",
              [a.id],
            ),
          ),
        ),
      ).toBe("PASSOU");
      expect(await revDe(c, "artigos", a.id)).toBe(r1 + 1); // savepoint do `tenta` = nova subtransação → +1
    });
  });

  it("auditoria (anti-drift): todo fn_colab_bump_% tem o idioma; mapa função → filhas = B2 ∪ T5; toda filha tem id; os gatilhos que disparam no bump das 7 raízes são os conhecidos e o bump não muda valor nenhum", async () => {
    await withTx(async (c) => {
      // R1: nenhuma função da B2 pertence à T5 (redefinida OU fixada por ela)
      for (const f of FNS) {
        expect(MOD_MD5[f], f).toBeUndefined();
        expect(MOD5_DEPS[f], f).toBeUndefined();
      }
      for (const f of Object.keys(BK2_DEPS)) expect(MOD_MD5[f], f).toBeUndefined();
      const t5 = await modViva(c, 5);
      const bumps = (
        await c.query(
          `SELECT 'public.' || p.proname || '()' AS f, p.prosrc AS src FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\\_colab\\_bump\\_%' ORDER BY 1`,
        )
      ).rows as { f: string; src: string }[];
      expect(bumps.map((b) => b.f).sort()).toEqual([...FNS, ...Object.keys(MOD5_GATILHOS)].sort());
      const b2Viva = await bkViva(c, "B2");
      for (const b of bumps) {
        const daB2 = FNS.includes(b.f);
        // função de bump NOVA sem o idioma = falha (as da B2 só com a B2 viva; as da T5 só com a T5 viva)
        if ((daB2 && b2Viva) || (!daB2 && t5)) expect(b.src.split(PRED).length - 1, b.f).toBe(1);
      }
      const mapa = (
        await c.query(
          `SELECT 'public.' || p.proname || '()' AS f, string_agg(c.relname || CASE WHEN p.proname LIKE 'fn\\_colab\\_bump\\_modelo%' THEN '' ELSE '.' || g.tgname END, ',' ORDER BY c.relname, g.tgname) AS ts
             FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_proc p ON p.oid = g.tgfoid
            WHERE NOT g.tgisinternal AND p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\\_colab\\_bump\\_%'
            GROUP BY p.proname`,
        )
      ).rows as { f: string; ts: string }[];
      const esperado = {
        ...Object.fromEntries(Object.entries(BK2_GATILHOS).map(([f, t]) => [f, t.join(",")])),
        ...Object.fromEntries(Object.entries(MOD5_GATILHOS).map(([f, t]) => [f, t.join(",")])),
      };
      expect(Object.fromEntries(mapa.map((m) => [m.f, m.ts]))).toEqual(esperado);
      const semId = (
        await c.query(
          `SELECT DISTINCT c.relname FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_proc p ON p.oid = g.tgfoid
            WHERE NOT g.tgisinternal AND p.proname LIKE 'fn\\_colab\\_bump\\_%'
              AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'id' AND NOT a.attisdropped)`,
        )
      ).rows;
      expect(semId).toEqual([]);
      // Gatilhos que disparam num "UPDATE <raiz> SET id = id": UPDATE sem lista de colunas e sem WHEN (ROW e STATEMENT).
      const DISPARAM: Record<string, string[]> = {
        artigos: ["artigos_recalc_preco", "fn_audit", "fn_colab_touch_rev", "fn_custo_fila_preco"],
        cad: [
          "fn_audit",
          "fn_colab_touch_rev",
          "fn_custo_fila_cad",
          "fn_kanban_fila_por_modelo",
          "fn_seg_pagina_cad",
        ],
        controle_qualidade: [
          "fn_audit",
          "fn_colab_touch_rev",
          "fn_kanban_fila_por_cad",
          "fn_seg_pagina_controle_qualidade",
        ],
        ocs_tecido: [
          "fn_audit",
          "fn_colab_touch_rev",
          "fn_seg_pagina_ocs_tecido",
          "gerar_parcelas_oc_tecido",
        ],
        ocs_aviamento: [
          "fn_audit",
          "fn_colab_touch_rev",
          "fn_seg_pagina_ocs_aviamento",
          "gerar_parcelas_oc_aviamento",
        ],
        ocs_etiqueta: [
          "enforce_empresa_tenant",
          "enforce_representante_tenant",
          "fn_colab_touch_rev",
          "fn_seg_pagina_ocs_etiqueta",
          "gerar_parcelas_oc_etiqueta",
        ],
        colecoes: ["fn_colab_touch_otb_rev", "fn_colab_touch_plan_rev", "fn_seg_modulo_otb"],
      };
      for (const [raiz, fns] of Object.entries(DISPARAM)) {
        const g = (
          await c.query(
            `SELECT p.proname FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
              WHERE t.tgrelid = to_regclass('public.' || $1) AND NOT t.tgisinternal AND t.tgenabled <> 'D'
                AND (t.tgtype & 16) = 16 AND t.tgattr::text = '' AND t.tgqual IS NULL ORDER BY 1`,
            [raiz],
          )
        ).rows.map((r: { proname: string }) => r.proname);
        expect(g, raiz).toEqual(fns);
      }
      // os de parcela só agem na TRANSIÇÃO para 'recebido'; os de fila de custo só com coluna de preço/corte mudada; os de página
      // só por coluna (ou bypass do servidor: os bumps das OCs são DEFINER); fn_audit ignora rev/plan_rev (colecoes não audita).
      const src = async (f: string) =>
        (await um<{ s: string }>(c, "SELECT prosrc AS s FROM pg_proc WHERE proname = $1", [f])).s;
      for (const f of [
        "gerar_parcelas_oc_tecido",
        "gerar_parcelas_oc_aviamento",
        "gerar_parcelas_oc_etiqueta",
      ]) {
        expect(await src(f), f).toMatch(/OLD\.status IS DISTINCT FROM 'recebido'/);
      }
      expect(await src("fn_audit")).toMatch(/'rev', 'plan_rev'/);
      for (const f of [
        "fn_colab_bump_cq",
        "fn_colab_bump_oc",
        "fn_colab_bump_oc_avi",
        "fn_colab_bump_oc_etq",
        "fn_colab_bump_plan",
      ]) {
        expect(BK2_SEG[`public.${f}()`].secdef, f).toBe(true);
      }
      // o bump não muda valor nenhum da raiz além das colunas de rev (nada deriva do rev intermediário): 1 linha por raiz
      for (const raiz of Object.keys(DISPARAM)) {
        const id = (
          await um<{ id: string } | undefined>(
            c,
            `SELECT id FROM public.${raiz} ORDER BY id LIMIT 1`,
          )
        )?.id;
        if (!id) continue;
        const foto = async () =>
          (
            await um<{ j: Record<string, unknown> }>(
              c,
              `SELECT to_jsonb(t) - 'rev' - 'plan_rev' - 'otb_rev' - 'updated_at' AS j FROM public.${raiz} t WHERE t.id = $1`,
              [id],
            )
          ).j;
        const antes = await foto();
        await c.query(`SAVEPOINT b${raiz}`);
        await c.query(`UPDATE public.${raiz} SET id = id WHERE id = $1`, [id]);
        const depois = await foto();
        await c.query(`ROLLBACK TO SAVEPOINT b${raiz}`);
        expect(depois, raiz).toEqual(antes);
      }
    });
  });

  it("migration: guarda/pós (md5, ACL, INVOKER/DEFINER, search_path, deps, gatilhos), ida 2× / _down 2× / ida; só catálogo nas travas (2ª sessão lendo pg_locks)", async () => {
    await withTx(async (c) => {
      await semB2(c);
      const pid = (await um<{ p: number }>(c, "SELECT pg_backend_pid() AS p")).p;
      const b = new Client({ connectionString: dbUrl()!, ssl: false });
      await b.connect();
      type Trava = { rel: string | null; nsp: string | null; mode: string; locktype: string };
      let travas: Trava[] = [];
      try {
        const le = async (): Promise<Trava[]> =>
          (
            await b.query(
              `SELECT c.relname AS rel, n.nspname AS nsp, l.mode, l.locktype
                 FROM pg_locks l LEFT JOIN pg_class c ON c.oid = l.relation LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE l.pid = $1 AND l.granted`,
              [pid],
            )
          ).rows;
        // Só a DIFERENÇA que a ida da B2 pegou (mesma receita do fix I1 da B1): com BK_TXN=1 numa cópia sem a B4, o gancho já
        // segura o ShareLock do índice novo em integracao_linhas desde o começo da txn — não é da B2.
        const chave = (t: Trava) => `${t.locktype}|${t.nsp}.${t.rel}|${t.mode}`;
        const antes = new Set((await le()).map(chave));
        await aplica(c, BK_MIG);
        travas = (await le()).filter((t) => !antes.has(chave(t)));
      } finally {
        await b.end();
      }
      console.log(
        `[bk B2] travas da ida (txn revertida): ${JSON.stringify(travas.filter((t) => t.locktype !== "virtualxid" && t.locktype !== "transactionid"))}`,
      );
      const rel = travas.filter((t) => t.locktype === "relation");
      expect(
        rel.filter((t) =>
          /^(auth|storage|realtime|supabase_functions|graphql|vault)$/.test(t.nsp ?? ""),
        ),
      ).toEqual([]);
      expect(rel.filter((t) => t.nsp === "public" && t.mode !== "AccessShareLock")).toEqual([]);
      expect(rel.filter((t) => t.mode === "AccessExclusiveLock")).toEqual([]);
      for (const f of FNS) {
        expect(await md5Fn(c, f)).toBe(BK_MD5[f].depois);
        const p = await um<{ acl: string; sd: boolean; cfg: string; anon: boolean; auth: boolean }>(
          c,
          `SELECT coalesce(proacl::text, '') AS acl, prosecdef AS sd, coalesce(array_to_string(proconfig, '|'), '') AS cfg,
                  has_function_privilege('anon', oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', oid, 'EXECUTE') AS auth
             FROM pg_proc WHERE oid = to_regprocedure($1)`,
          [f],
        );
        expect(p).toEqual({
          acl: BK2_ACL[f],
          sd: BK2_SEG[f].secdef,
          cfg: BK2_SEG[f].cfg,
          anon: false,
          auth: false,
        });
        expect(BK2_RAIZ[f]).toBeTruthy();
      }
      for (const [s, m] of Object.entries(BK2_DEPS)) expect(await md5Fn(c, s)).toBe(m);
      for (const [t, g, fn] of BK2_REV) {
        const n = (
          await um<{ n: string }>(
            c,
            `SELECT count(*) AS n FROM pg_trigger WHERE tgrelid = to_regclass('public.' || $1)
          AND tgname = $2 AND tgfoid = to_regprocedure($3) AND tgenabled = 'O'`,
            [t, g, fn],
          )
        ).n;
        expect(Number(n), `${t}.${g}`).toBe(1);
      }
      await aplica(c, BK_MIG); // idempotente
      await aplica(c, BK_DOWN);
      for (const f of FNS) expect(await md5Fn(c, f)).toBe(BK_MD5[f].antes);
      await aplica(c, BK_DOWN); // idempotente
      await aplica(c, BK_MIG);
      for (const f of FNS) expect(await md5Fn(c, f)).toBe(BK_MD5[f].depois);
    });
  });

  it("guarda: função com texto inesperado → ida e _down recusam (P0001); dependência mexida → a ida recusa; nada muda", async () => {
    const tentaArq = async (c: Client, rel: string) => {
      try {
        await aplica(c, rel);
        return "PASSOU";
      } catch (e) {
        const er = e as { code?: string; message?: string };
        return `${er.code} ${er.message}`;
      }
    };
    await withTx(async (c) => {
      await semB2(c);
      await c.query(`CREATE OR REPLACE FUNCTION public.fn_colab_bump_oc_etq() RETURNS trigger LANGUAGE plpgsql
        SECURITY DEFINER SET search_path TO 'public' AS $f$ begin return coalesce(new, old); end $f$`);
      expect(await tentaArq(c, BK_MIG)).toMatch(
        /^P0001 bk2_rev_uma_vez: public\.fn_colab_bump_oc_etq\(\) com texto inesperado/,
      );
      expect(await tentaArq(c, BK_DOWN)).toMatch(
        /^P0001 bk2_rev_uma_vez_down: public\.fn_colab_bump_oc_etq\(\)/,
      );
      expect(await md5Fn(c, "public.fn_colab_bump_oc()")).toBe(
        BK_MD5["public.fn_colab_bump_oc()"].antes,
      );
    });
    await withTx(async (c) => {
      await semB2(c);
      await c.query(`CREATE OR REPLACE FUNCTION public.fn_colab_touch_plan_rev() RETURNS trigger LANGUAGE plpgsql
        AS $f$ begin new.plan_rev := old.plan_rev + 2; return new; end $f$`);
      expect(await tentaArq(c, BK_MIG)).toMatch(
        /^P0001 bk2_rev_uma_vez: dependencia public\.fn_colab_touch_plan_rev\(\)/,
      );
      for (const f of FNS) expect(await md5Fn(c, f)).toBe(BK_MD5[f].antes);
    });
  });
});
