// F5-3 Task 2 — 1 EVENTO DE AUDITORIA POR SECAO da ficha, gravado de dentro dos `_core` de Salvar.
// Os `_core` (migration 20261121100000) capturam o estado ANTERIOR antes do delete-and-reinsert, montam o DIFF RESUMIDO por
// secao (so o que mudou) e chamam `_audit_evento_secao` UMA vez por secao. Diff vazio = helper nao grava.
//
// Entidades: `_salvar_modelo_bom_core` -> 'Tecidos' (artigo/consumo/perda), 'Aviamentos' (consumo), 'Grade' (quantidade por
// tamanho); `_salvar_cad_completo_core` -> 'CAD' (tamanho da folha / qtd folhas / metragem planejada / observacoes do molde);
// `_salvar_etiquetas_modelo_core` -> 'Insumos' (consumo). A auditoria NUNCA derruba o Salvar (sub-bloco EXCEPTION engole).
//
// TUDO em BEGIN...ROLLBACK (`withTx`), SO na copia local (`ehBancoLocal`): nada e gravado de verdade. A RPC `salvar_card_planejamento`
// e chamada como `authenticated` com o JWT do super admin (`USER_TESTE`), que fura os portoes de modulo/pagina (o foco do teste e a
// AUDITORIA, nao a permissao). A migration ja foi aplicada na copia; este teste nao aplica nada.
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import type { Client as PgClient } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, TENANT_TESTE, USER_TESTE } from "./db";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const U = USER_TESTE; // super admin da Loja Teste

const j = (x: unknown) => JSON.stringify(x);

/** JWT do super admin (fura modulo/pagina; a RPC e DEFINER). */
async function jwt(c: PgClient): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U, role: "authenticated" })]);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, U]);
}

const SQL_RPC = `select public.salvar_card_planejamento($1::uuid, $2::jsonb, $3::int, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb) as r`;
type Bloco = { header?: unknown; rev?: number | null; bom?: unknown; etiquetas?: unknown; cad?: unknown; mo?: unknown; gradeRevenda?: unknown; revisao?: unknown; flags?: unknown };
/** Chama a RPC como `authenticated` no nivel de topo (sucesso; erro aborta a txn). */
async function salva(c: PgClient, m: string, p: Bloco): Promise<void> {
  await c.query("SET LOCAL ROLE authenticated");
  try {
    await c.query(SQL_RPC, [m, p.header === undefined ? null : j(p.header), p.rev ?? null, p.bom === undefined ? null : j(p.bom),
      p.etiquetas === undefined ? null : j(p.etiquetas), p.cad === undefined ? null : j(p.cad), p.mo === undefined ? null : j(p.mo),
      p.gradeRevenda === undefined ? null : j(p.gradeRevenda), p.revisao === undefined ? null : j(p.revisao), p.flags === undefined ? null : j(p.flags)]);
  } finally {
    await c.query("RESET ROLE");
  }
}
const rev = async (c: PgClient, m: string): Promise<number> => (await um<{ rev: number }>(c, `select rev from modelos where id = $1`, [m])).rev;

/** Eventos de auditoria gravados por este modelo (so os desta secao desde o marco). */
async function eventos(c: PgClient, m: string): Promise<{ entidade: string; tabela: string; dados: any }[]> {
  const { rows } = await c.query(
    `select entidade, tabela, dados from public.audit_log
      where registro_id = $1 and acao = 'editar' and entidade in ('Tecidos','Aviamentos','Grade','CAD','Insumos')
      order by created_at, entidade`,
    [m],
  );
  return rows;
}
const ent = (evs: { entidade: string }[], e: string): number => evs.filter((x) => x.entidade === e).length;

// ───────────────────────────────────────────── fixture + semente ─────────────────────────────────────────────
type Fx = { art1: string; art2: string; v1a: string; v1b: string; v1c: string; v2a: string; avi1: string; avi2: string; etq: string[]; cor: string };
async function fixture(c: PgClient): Promise<Fx> {
  return semJwt(c, async () => {
    const id = async (sql: string, p: any[]) => (await um<{ id: string }>(c, sql, p)).id;
    const art1 = await id(`insert into artigos (tenant_id, nome, unidade_medida, preco) values ($1, 'HIST tecido 1', 'metro', 10) returning id`, [T]);
    const art2 = await id(`insert into artigos (tenant_id, nome, unidade_medida, preco) values ($1, 'HIST tecido 2', 'metro', 20) returning id`, [T]);
    const vt = (a: string, n: string) => id(`insert into variantes_tecido (tenant_id, artigo_id, nome_variante) values ($1, $2, $3) returning id`, [T, a, n]);
    const v1a = await vt(art1, "HIST-1a");
    const v1b = await vt(art1, "HIST-1b");
    const v1c = await vt(art1, "HIST-1c");
    const v2a = await vt(art2, "HIST-2a");
    const avi1 = await id(`insert into aviamentos (tenant_id, codigo_nome, preco) values ($1, 'HIST avi 1', 1) returning id`, [T]);
    const avi2 = await id(`insert into aviamentos (tenant_id, codigo_nome, preco) values ($1, 'HIST avi 2', 2) returning id`, [T]);
    const etq: string[] = [];
    for (let i = 1; i <= 2; i++) etq.push(await id(`insert into etiquetas (tenant_id, nome) values ($1, $2) returning id`, [T, `HIST etq ${i}`]));
    const cor = await id(`insert into cores (tenant_id, nome) values ($1, 'HIST cor') returning id`, [T]);
    return { art1, art2, v1a, v1b, v1c, v2a, avi1, avi2, etq, cor };
  });
}

const BOM = (fx: Fx) => ({
  tecidos: [
    { artigo_id: fx.art1, numero: 1, tipo: "tecido", consumo: 1.2, loss_percent: 5, custo_previsto: 12, variantes: [fx.v1a, fx.v1b] },
    { artigo_id: fx.art2, numero: 1, tipo: "forro", consumo: 0.5, loss_percent: 3, custo_previsto: 6, variantes: [fx.v2a] },
  ],
  aviamentos: [
    { aviamento_id: fx.avi1, numero: 1, consumo: 2, loss_percent: 0, custo_previsto: 2 },
    { aviamento_id: fx.avi2, numero: 2, consumo: 1, loss_percent: 0, custo_previsto: 2 },
  ],
  grades: [
    { variante_numero: 1, grades: { "38|P": 5, "40|M": 5 }, grade_total: 10 },
    { variante_numero: 2, grades: { "38|P": 2, "40|M": 3 }, grade_total: 5 },
  ],
});
/** Clona o BOM e aplica um ajuste (deep-ish via JSON). */
const clonaBom = (fx: Fx): ReturnType<typeof BOM> => JSON.parse(JSON.stringify(BOM(fx)));

const CAD = (fx: Fx) => ({
  tecidos: [
    {
      artigo_id: fx.art1, numero: 1, tipo: "tecido", consumo_cad: 1.2, loss_percent_cad: 5, custo_cad: 12, tamanho_folha: 1.5,
      variantes: [
        { variante_tecido_id: fx.v1a, ordem: 1, multiplicador: 1, quantidade_folhas: 3, metragem_planejada: 4.5, metragem_enviada: 0 },
        { variante_tecido_id: fx.v1b, ordem: 2, multiplicador: 1, quantidade_folhas: 2, metragem_planejada: 3.0, metragem_enviada: 0 },
      ],
    },
  ],
  // Grade do CAD IGUAL a do BOM (mesmas 2 variantes) para que um Salvar que mande bom+cad juntos seja um no-op real:
  // o _bom reinsere modelo_grades e o _cad as reescreve com o MESMO conteudo (senao o _bom veria uma diferenca transitoria).
  grades: [
    { variante_numero: 1, grades: { "38|P": 5, "40|M": 5 }, grade_total: 10 },
    { variante_numero: 2, grades: { "38|P": 2, "40|M": 3 }, grade_total: 5 },
  ],
  aviamentos: [{ aviamento_id: fx.avi1, numero: 1, consumo: 2, quantidade_enviar: 10, quantidade_separar: 10 }],
  etiquetas: [{ etiqueta_id: fx.etq[0], cor_id: fx.cor, consumo: 1, quantidade_planejada: 10, quantidade_enviar: 10, enviar_por_tamanho: {} }],
  proporcoes: {},
  observacoes_molde: "molde HIST",
  data_previsao_corte: null,
});
const clonaCad = (fx: Fx): ReturnType<typeof CAD> => JSON.parse(JSON.stringify(CAD(fx)));

/** Cria um card interno da Loja Teste com Ordem de Criacao enviada. */
async function novoCard(c: PgClient, nome = "HIST card"): Promise<string> {
  return semJwt(c, async () => {
    await c.query("SAVEPOINT hist_card");
    const id = (await um<{ id: string }>(c,
      `insert into modelos (tenant_id, nome, ordem_criacao_enviada, origem) values ($1, $2, true, 'interno') returning id`, [T, nome])).id;
    await c.query("RELEASE SAVEPOINT hist_card");
    return id;
  });
}

describe.skipIf(!RODA)("historico F5-3 Task 2 — 1 evento por secao da ficha", () => {
  it("1. edita SO a grade (via salvar_card_planejamento) -> 1 evento 'Grade' com o diff; 0 'Tecidos'/'Aviamentos'/'Insumos'", async () => {
    await withTx(async (c) => {
      const fx = await fixture(c);
      const m = await novoCard(c);
      await jwt(c);
      // 1o Salvar: semeia o BOM (card nasce sem ficha -> nao gera diff de "antes" vazio->cheio? gera eventos de criacao, nao e o foco).
      await salva(c, m, { bom: BOM(fx), rev: await rev(c, m) });
      // zera o marco: so olhamos o 2o Salvar
      await c.query(`delete from public.audit_log where registro_id = $1`, [m]);

      // 2o Salvar: muda SO a grade (variante 1, tamanho P: 5 -> 8). Tecidos e aviamentos IDENTICOS.
      const b = clonaBom(fx);
      b.grades[0].grades["38|P"] = 8;
      b.grades[0].grade_total = 13;
      await salva(c, m, { bom: b, rev: await rev(c, m) });

      const evs = await eventos(c, m);
      expect(ent(evs, "Grade")).toBe(1);
      expect(ent(evs, "Tecidos")).toBe(0);
      expect(ent(evs, "Aviamentos")).toBe(0);
      expect(ent(evs, "Insumos")).toBe(0);
      const grade = evs.find((e) => e.entidade === "Grade")!;
      expect(grade.tabela).toBe("modelo_grades");
      // o diff aponta a celula mudada (de 5 para 8)
      const chave = Object.keys(grade.dados).find((k) => k.includes("P"))!;
      expect(grade.dados[chave]).toEqual({ de: 5, para: 8 });
    });
  });

  it("2. edita consumo de tecido -> evento 'Tecidos' com 'Tecido 1 · consumo: de->para'", async () => {
    await withTx(async (c) => {
      const fx = await fixture(c);
      const m = await novoCard(c);
      await jwt(c);
      await salva(c, m, { bom: BOM(fx), rev: await rev(c, m) });
      await c.query(`delete from public.audit_log where registro_id = $1`, [m]);

      const b = clonaBom(fx);
      b.tecidos[0].consumo = 2.0; // Tecido 1 consumo 1.2 -> 2.0
      await salva(c, m, { bom: b, rev: await rev(c, m) });

      const evs = await eventos(c, m);
      expect(ent(evs, "Tecidos")).toBe(1);
      expect(ent(evs, "Grade")).toBe(0);
      expect(ent(evs, "Aviamentos")).toBe(0);
      const tec = evs.find((e) => e.entidade === "Tecidos")!;
      expect(tec.dados).toHaveProperty("Tecido 1 · consumo");
      expect(tec.dados["Tecido 1 · consumo"]).toEqual({ de: 1.2, para: 2.0 });
    });
  });

  it("3. edita consumo de aviamento -> evento 'Aviamentos' com o diff do consumo", async () => {
    await withTx(async (c) => {
      const fx = await fixture(c);
      const m = await novoCard(c);
      await jwt(c);
      await salva(c, m, { bom: BOM(fx), rev: await rev(c, m) });
      await c.query(`delete from public.audit_log where registro_id = $1`, [m]);

      const b = clonaBom(fx);
      b.aviamentos[0].consumo = 5; // avi1 consumo 2 -> 5
      await salva(c, m, { bom: b, rev: await rev(c, m) });

      const evs = await eventos(c, m);
      expect(ent(evs, "Aviamentos")).toBe(1);
      expect(ent(evs, "Tecidos")).toBe(0);
      expect(ent(evs, "Grade")).toBe(0);
      const avi = evs.find((e) => e.entidade === "Aviamentos")!;
      const chave = Object.keys(avi.dados).find((k) => k.includes("consumo"))!;
      expect(avi.dados[chave]).toEqual({ de: 2, para: 5 });
    });
  });

  it("4. edita consumo de insumo -> evento 'Insumos' com o diff do consumo", async () => {
    await withTx(async (c) => {
      const fx = await fixture(c);
      const m = await novoCard(c);
      await jwt(c);
      // semeia o insumo pelo proprio bloco _etiquetas
      await salva(c, m, { etiquetas: [{ id: null, etiqueta_id: fx.etq[0], cor_id: fx.cor, consumo: 1, loss_percent: 0, custo_previsto: 0 }], rev: await rev(c, m) });
      await c.query(`delete from public.audit_log where registro_id = $1`, [m]);

      // le o id da linha salva e muda o consumo
      const linha = await um<{ id: string }>(c, `select id from modelo_etiquetas where modelo_id = $1 limit 1`, [m]);
      await salva(c, m, { etiquetas: [{ id: linha.id, etiqueta_id: fx.etq[0], cor_id: fx.cor, consumo: 3, loss_percent: 0, custo_previsto: 0 }], rev: await rev(c, m) });

      const evs = await eventos(c, m);
      expect(ent(evs, "Insumos")).toBe(1);
      const ins = evs.find((e) => e.entidade === "Insumos")!;
      expect(ins.tabela).toBe("modelo_etiquetas");
      const chave = Object.keys(ins.dados).find((k) => k.includes("consumo"))!;
      expect(ins.dados[chave]).toEqual({ de: 1, para: 3 });
    });
  });

  it("5. edita o CAD (tamanho da folha + observacoes do molde) -> evento 'CAD' com os campos mudados", async () => {
    await withTx(async (c) => {
      const fx = await fixture(c);
      const m = await novoCard(c);
      await jwt(c);
      // o CAD precisa do BOM primeiro (Ordem enviada ja esta true na semente)
      await salva(c, m, { bom: BOM(fx), cad: CAD(fx), rev: await rev(c, m) });
      await c.query(`delete from public.audit_log where registro_id = $1`, [m]);

      const cad = clonaCad(fx);
      cad.tecidos[0].tamanho_folha = 2.0; // 1.5 -> 2.0
      cad.observacoes_molde = "molde NOVO HIST"; // "molde HIST" -> "molde NOVO HIST"
      await salva(c, m, { cad, rev: await rev(c, m) });

      const evs = await eventos(c, m);
      expect(ent(evs, "CAD")).toBe(1);
      const ev = evs.find((e) => e.entidade === "CAD")!;
      expect(ev.tabela).toBe("cad");
      expect(ev.dados).toHaveProperty("Tecido 1 · tamanho da folha");
      expect(ev.dados["Tecido 1 · tamanho da folha"]).toEqual({ de: 1.5, para: 2.0 });
      expect(ev.dados).toHaveProperty("Observações do molde");
      expect(ev.dados["Observações do molde"]).toEqual({ de: "molde HIST", para: "molde NOVO HIST" });
    });
  });

  it("6. Salvar SEM mudanca real -> 0 eventos de qualquer secao", async () => {
    await withTx(async (c) => {
      const fx = await fixture(c);
      const m = await novoCard(c);
      await jwt(c);
      await salva(c, m, { bom: BOM(fx), cad: CAD(fx), etiquetas: [{ id: null, etiqueta_id: fx.etq[0], cor_id: fx.cor, consumo: 1, loss_percent: 0, custo_previsto: 0 }], rev: await rev(c, m) });
      await c.query(`delete from public.audit_log where registro_id = $1`, [m]);

      // re-salva EXATAMENTE o mesmo estado
      const linha = await um<{ id: string }>(c, `select id from modelo_etiquetas where modelo_id = $1 limit 1`, [m]);
      await salva(c, m, {
        bom: BOM(fx), cad: CAD(fx),
        etiquetas: [{ id: linha.id, etiqueta_id: fx.etq[0], cor_id: fx.cor, consumo: 1, loss_percent: 0, custo_previsto: 0 }],
        rev: await rev(c, m),
      });

      const evs = await eventos(c, m);
      expect(evs.length).toBe(0);
    });
  });
});
