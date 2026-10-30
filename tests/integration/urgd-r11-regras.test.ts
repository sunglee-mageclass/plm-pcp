// Urgentes R11d (plan-r11 Task 3, 20261103199300_urg_r11_regras_mini): regras da mini explosão da Peça Teste — BOM para 1 peça,
// alocação do tecido como o corte, baixa/estorno nos 2 ledgers, leitura do estoque e o predicado da R12. Anti-drift SQL×TS
// (`_peca_teste_mini_linhas`×`linhasUmaPeca`, `_peca_teste_tecido_baixar`×`alocarTecido`) + baixa/estorno/leitura/ACL diretos.
// Txn revertida; o bloco r11d é aplicado DENTRO da txn por aplicaUrgd(c,"r11d") quando a cópia ainda não o tem. Só na cópia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";
import { aplicaUrgd, urgdViva } from "./urgd-helpers";
import {
  linhasUmaPeca, alocarTecido, type ModeloBom, type MiniLinha, type AjusteLinha, type OcLink, type OcLote,
} from "@/lib/peca-teste-mini";
import { CASOS_MINI_LINHAS, CASOS_MINI_ALOCAR, type CasoLinhas } from "../fixtures/peca-teste-mini-casos";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const OUTRA = "11111111-1111-1111-1111-111111111111"; // outra loja (semeada no teste)
let seq = 0;
const suf = () => `r11d-${Date.now()}-${seq++}`;

/** o bloco r11d (199300) tem de estar vivo na cópia (copia3 termina em 199300); o teste roda contra as funções vivas. */
async function exigeR11d(c: Client): Promise<void> {
  if (!(await urgdViva(c, "r11d"))) {
    await c.query("SET LOCAL lock_timeout = '3s'");
    await aplicaUrgd(c, "r11d");
  }
}

async function um1<T = any>(c: Client, sql: string, p: unknown[] = []): Promise<T> {
  return um<T>(c, sql, p as any[]);
}

// ── semeia um CasoLinhas no banco e devolve o BOM com ids REAIS (espelho fiel da fixture) ──
type Seeded = { modelo: string; bom: ModeloBom; tamanho: string | null; varianteV: string | null; ordemN: number | null; ajustes: Record<string, AjusteLinha> };

async function semeiaCaso(c: Client, caso: CasoLinhas): Promise<Seeded> {
  const modelo = (await um1<{ id: string }>(c,
    `INSERT INTO public.modelos (tenant_id, nome, origem) VALUES ($1, $2, 'interno') RETURNING id`, [T, `mini ${suf()}`])).id;

  // cores (placeholder -> real)
  const cores = new Map<string, string>();
  const corReal = async (ph: string | null): Promise<string | null> => {
    if (ph == null) return null;
    if (!cores.has(ph)) {
      cores.set(ph, (await um1<{ id: string }>(c, `INSERT INTO public.cores (tenant_id, nome) VALUES ($1, $2) RETURNING id`, [T, `cor ${ph} ${suf()}`])).id);
    }
    return cores.get(ph)!;
  };

  // ── tecidos: 1 artigo por bloco; cada variante = 1 variante_tecido (com cor) ──
  const vtReal = new Map<string, string>(); // placeholder variante_tecido -> real
  const corDeVReal = caso.bom.corDeV ? await corReal(caso.bom.corDeV) : null;
  const tecidos: ModeloBom["tecidos"] = [];
  for (const b of caso.bom.tecidos) {
    const art = (await um1<{ id: string }>(c,
      `INSERT INTO public.artigos (tenant_id, nome, unidade_medida, preco, rendimento) VALUES ($1, $2, 'metro', 10, 1) RETURNING id`, [T, `art ${suf()}`])).id;
    const mt = (await um1<{ id: string }>(c,
      `INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [modelo, art, b.numero, b.tipo, b.consumo, b.loss_percent])).id;
    const vars: ModeloBom["tecidos"][number]["variantes"] = [];
    for (const v of b.variantes) {
      let vtid: string | null = null;
      if (v.variante_tecido_id != null) {
        if (!vtReal.has(v.variante_tecido_id)) {
          // a cor de V = corDeV da fixture; cor das demais = única nova
          const isV = caso.varianteV === v.variante_tecido_id;
          const cor = isV ? corDeVReal : await corReal(`cor-${v.variante_tecido_id}`);
          vtReal.set(v.variante_tecido_id, (await um1<{ id: string }>(c,
            `INSERT INTO public.variantes_tecido (tenant_id, artigo_id, nome_variante, cor_id) VALUES ($1, $2, $3, $4) RETURNING id`,
            [T, art, `vt ${v.variante_tecido_id} ${suf()}`, cor])).id);
        }
        vtid = vtReal.get(v.variante_tecido_id)!;
      }
      const casaReal = (v.complementa_variante_ids ?? []).map((ph) => vtReal.get(ph) ?? ph);
      await c.query(
        `INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador, complementa_variante_ids)
         VALUES ($1, $2, $3, $4, $5)`,
        [mt, vtid, v.ordem, v.multiplicador ?? 1, casaReal.length ? casaReal : null]);
      vars.push({ ordem: v.ordem, variante_tecido_id: vtid, multiplicador: v.multiplicador ?? 1,
        complementa_variante_ids: casaReal.length ? casaReal : null, nome_variante: null });
    }
    tecidos.push({ tipo: b.tipo, numero: b.numero, consumo: b.consumo, loss_percent: b.loss_percent, variantes: vars });
  }

  // ── aviamentos ──
  const aviReal = new Map<string, string>();
  const avReal = new Map<string, string>();
  const corVistas = new Set<string>();
  const aviamentos: ModeloBom["aviamentos"] = [];
  for (const l of caso.bom.aviamentos) {
    if (!aviReal.has(l.aviamento_id)) {
      aviReal.set(l.aviamento_id, (await um1<{ id: string }>(c,
        `INSERT INTO public.aviamentos (tenant_id, codigo_nome, preco) VALUES ($1, $2, 1) RETURNING id`, [T, `avi ${l.aviamento_id} ${suf()}`])).id);
    }
    const aviId = aviReal.get(l.aviamento_id)!;
    // variantes do aviamento (placeholder -> real), 1x cada. Par (aviamento, cor) repetido precisa de apelido distinto
    // (unique parcial sem apelido) — nao muda a regra da variante padrao (casa so por cor_id).
    const vs: LinhaVar[] = [];
    for (const v of l.variantes) {
      if (!avReal.has(v.variante_aviamento_id)) {
        const cor = await corReal(v.cor_id);
        const parKey = `${aviId}|${cor ?? "-"}`;
        const precisaApelido = corVistas.has(parKey);
        corVistas.add(parKey);
        const apelido = precisaApelido
          ? (await um1<{ id: string }>(c, `INSERT INTO public.cores_apelido (tenant_id, nome, cor_base_id) VALUES ($1,$2,$3) RETURNING id`, [T, `apel ${suf()}`, cor])).id
          : null;
        avReal.set(v.variante_aviamento_id, (await um1<{ id: string }>(c,
          `INSERT INTO public.variantes_aviamento (tenant_id, aviamento_id, cor_id, cor_apelido_id, nome_variante) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [T, aviId, cor, apelido, `av ${v.variante_aviamento_id} ${suf()}`])).id);
      }
      vs.push({ variante_aviamento_id: avReal.get(v.variante_aviamento_id)!, cor_id: await corReal(v.cor_id), rotulo: null });
    }
    const bvar = l.variante_aviamento_id != null ? (avReal.get(l.variante_aviamento_id) ?? null) : null;
    await c.query(
      `INSERT INTO public.modelo_aviamentos (modelo_id, aviamento_id, numero, consumo, variante_aviamento_id) VALUES ($1, $2, $3, $4, $5)`,
      [modelo, aviId, l.numero, l.consumo, bvar]);
    aviamentos.push({ aviamento_id: aviId, numero: l.numero, consumo: l.consumo, variante_aviamento_id: bvar, variantes: vs, nome: null });
  }

  // ── insumos ──
  const etqReal = new Map<string, string>();
  const insumos: ModeloBom["insumos"] = [];
  for (const l of caso.bom.insumos) {
    if (!etqReal.has(l.etiqueta_id)) {
      const e = (await um1<{ id: string }>(c,
        `INSERT INTO public.etiquetas (tenant_id, nome, formato_tamanho, tamanho_vinculado) VALUES ($1, $2, $3, $4) RETURNING id`,
        [T, `etq ${l.etiqueta_id} ${suf()}`, l.formato_tamanho, null])).id;
      for (const v of l.variantes_etiqueta) {
        await c.query(`INSERT INTO public.variantes_etiqueta (tenant_id, etiqueta_id, tamanho) VALUES ($1, $2, $3)`, [T, e, v.tamanho]);
      }
      // tamanho_vinculado grava DEPOIS das variantes (o helper so o aceita se o insumo nao tem tamanho proprio; a fixture ja respeita)
      if (l.tamanho_vinculado != null) {
        await c.query(`UPDATE public.etiquetas SET tamanho_vinculado = $2 WHERE id = $1`, [e, l.tamanho_vinculado]);
      }
      etqReal.set(l.etiqueta_id, e);
    }
    const etqId = etqReal.get(l.etiqueta_id)!;
    const cor = await corReal(l.cor_id);
    await c.query(
      `INSERT INTO public.modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, numero, consumo) VALUES ($1, $2, $3, $4, $5, $6)`,
      [T, modelo, etqId, cor, l.numero, l.consumo]);
    insumos.push({ etiqueta_id: etqId, cor_id: cor, numero: l.numero, consumo: l.consumo,
      tamanho_vinculado: l.tamanho_vinculado, formato_tamanho: l.formato_tamanho, variantes_etiqueta: l.variantes_etiqueta, nome: null });
  }

  // remapeia os AJUSTES (chaves com placeholder -> chaves reais; variante_aviamento_id/oc_tecido_item_id dos ajustes).
  const ajustes = remapAjustes(caso, vtReal, aviReal, avReal, etqReal);
  const varianteVReal = caso.varianteV != null ? (vtReal.get(caso.varianteV) ?? null) : null;

  return {
    modelo,
    bom: { tecidos, aviamentos, insumos, corDeV: corDeVReal },
    tamanho: caso.tamanho, varianteV: varianteVReal, ordemN: caso.ordemN, ajustes,
  };
}

type LinhaVar = { variante_aviamento_id: string; cor_id: string | null; rotulo: string | null };

/** remapeia as chaves e ids internos dos ajustes da fixture (placeholder) para os reais semeados. */
function remapAjustes(caso: CasoLinhas, vt: Map<string, string>, avi: Map<string, string>, av: Map<string, string>, etq: Map<string, string>): Record<string, AjusteLinha> {
  const out: Record<string, AjusteLinha> = {};
  for (const [chave, aj] of Object.entries(caso.ajustes)) {
    const p = chave.split(":");
    let real = chave;
    if (p[0] === "t") real = `t:${p[1]}:${p[2]}:${p[3]}:${vt.get(p[4]) ?? p[4]}`;
    else if (p[0] === "a") real = `a:${avi.get(p[1]) ?? p[1]}:${p[2]}`;
    else if (p[0] === "i") real = `i:${etq.get(p[1]) ?? p[1]}:${p[2] === "-" ? "-" : p[2]}:${p[3]}`;
    const a2: AjusteLinha = { ...aj };
    if (aj.variante_aviamento_id !== undefined) a2.variante_aviamento_id = aj.variante_aviamento_id == null ? null : (av.get(aj.variante_aviamento_id) ?? aj.variante_aviamento_id);
    out[real] = a2;
  }
  return out;
}

const r4 = (x: unknown) => (x == null ? null : Number(Number(x).toFixed(4)));
const normSql = (l: Record<string, unknown>) => ({
  chave: l.chave, familia: l.familia, tipo: l.tipo, numero: l.numero == null ? null : Number(l.numero),
  ordem: l.ordem == null ? null : Number(l.ordem), variante_tecido_id: l.variante_tecido_id,
  pecas: r4(l.pecas), aviamento_id: l.aviamento_id, variante_aviamento_id: l.variante_aviamento_id,
  etiqueta_id: l.etiqueta_id, cor_id: l.cor_id, tamanho_bucket: l.tamanho_bucket, consumo: r4(l.consumo),
  loss_percent: r4(l.loss_percent), necessaria: r4(l.necessaria), a_enviar: r4(l.a_enviar),
  oc_tecido_item_id: l.oc_tecido_item_id, unidade: l.unidade,
});
const normTs = (l: MiniLinha) => ({
  chave: l.chave, familia: l.familia, tipo: l.tipo, numero: l.numero, ordem: l.ordem,
  variante_tecido_id: l.variante_tecido_id, pecas: r4(l.pecas), aviamento_id: l.aviamento_id,
  variante_aviamento_id: l.variante_aviamento_id, etiqueta_id: l.etiqueta_id, cor_id: l.cor_id,
  tamanho_bucket: l.tamanho_bucket, consumo: r4(l.consumo), loss_percent: r4(l.loss_percent),
  necessaria: r4(l.necessaria), a_enviar: r4(l.a_enviar), oc_tecido_item_id: l.oc_tecido_item_id, unidade: l.unidade,
});

describe.skipIf(!RODA)("urgd-r11-regras: anti-drift SQL × TS (linhas da mini)", () => {
  for (const caso of CASOS_MINI_LINHAS) {
    it(caso.nome, async () => {
      await withTx(async (c) => {
        await comoUsuario(c);
        await exigeR11d(c);
        {
          const s = await semeiaCaso(c, caso);
          const sql = (await c.query(
            `SELECT * FROM public._peca_teste_mini_linhas($1, $2, $3, $4) ORDER BY chave`,
            [s.modelo, s.tamanho, s.varianteV, JSON.stringify(s.ajustes)])).rows as Record<string, unknown>[];
          const ts = linhasUmaPeca(s.bom, s.tamanho, s.ordemN, s.varianteV, s.ajustes).sort((a, b) => a.chave.localeCompare(b.chave));
          expect(sql.map((l) => l.chave)).toEqual(ts.map((l) => l.chave));
          const byChaveTs = new Map(ts.map((l) => [l.chave, l]));
          for (const l of sql) {
            const tl = byChaveTs.get(l.chave as string);
            expect(tl, `linha ${l.chave as string}`).toBeDefined();
            expect(normSql(l)).toEqual(normTs(tl!));
          }
        }
      });
    });
  }
});

// ── alocação SQL × TS: semeia OCs/itens/vínculos e compara as fontes ──
describe.skipIf(!RODA)("urgd-r11-regras: alocação SQL × TS (fontes do tecido)", () => {
  for (const caso of CASOS_MINI_ALOCAR) {
    it(caso.nome, async () => {
      await withTx(async (c) => {
        await comoUsuario(c);
        await exigeR11d(c);
        {
          // 1 variante; cada OcLote = item de OC recebida com saldo (quantidade_pedida = saldo). vinculos -> modelo_tecido_oc_links.
          await c.query(`UPDATE public.tenant_config SET modo_baixa_estoque = $2 WHERE tenant_id = $1`, [T, caso.modo]);
          const art = (await um1<{ id: string }>(c, `INSERT INTO public.artigos (tenant_id, nome, unidade_medida, preco, rendimento) VALUES ($1,$2,'metro',10,1) RETURNING id`, [T, `aloc art ${suf()}`])).id;
          const vt = (await um1<{ id: string }>(c, `INSERT INTO public.variantes_tecido (tenant_id, artigo_id, nome_variante) VALUES ($1,$2,$3) RETURNING id`, [T, art, `aloc vt ${suf()}`])).id;
          const modelo = (await um1<{ id: string }>(c, `INSERT INTO public.modelos (tenant_id, nome, origem) VALUES ($1,$2,'interno') RETURNING id`, [T, `aloc ${suf()}`])).id;
          const tenant = (await um1<{ tenant_id: string }>(c, `SELECT tenant_id FROM public.modelos WHERE id=$1`, [modelo])).tenant_id;

          // cria 1 item de OC recebida por lote do fifo (ordem data_entrega controla FIFO).
          const itemReal = new Map<string, string>();
          let d = 1;
          for (const lote of caso.fifo) {
            const oc = (await um1<{ id: string }>(c,
              `INSERT INTO public.ocs_tecido (tenant_id, numero_pedido, status, data_entrega) VALUES ($1,$2,'recebido', ('2026-01-'|| lpad($3,2,'0'))::date) RETURNING id`,
              [T, `aloc-oc-${suf()}`, String(d++)])).id;
            const it = (await um1<{ id: string }>(c,
              `INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, artigo_numero, variante_tecido_id, quantidade_pedida, quantidade_recebida)
               VALUES ($1,$2,1,$3,$4,$4) RETURNING id`, [oc, art, vt, lote.saldo])).id;
            itemReal.set(lote.oc_tecido_item_id, it);
          }
          for (const vl of caso.vinculos) {
            const it = itemReal.get(vl.oc_tecido_item_id);
            if (!it) continue; // vínculo para item que não existe no fifo (OC não recebida): sem item real, pula
            await c.query(
              `INSERT INTO public.modelo_tecido_oc_links (tenant_id, modelo_id, tipo, numero, ordem, variante_tecido_id, oc_tecido_item_id, quantidade_m, prioridade)
               VALUES ($1,$2,'tecido',1,1,$3,$4,$5,$6)`, [T, modelo, vt, it, vl.quantidade_m, vl.prioridade]);
          }
          const itemEscolhidoReal = caso.itemEscolhido ? (itemReal.get(caso.itemEscolhido) ?? null) : null;

          const res = (await um1<{ r: { baixado: number; fontes: { oc_tecido_item_id: string; metros: number }[] } }>(c,
            `SELECT public._peca_teste_tecido_baixar($1, NULL, $2, 'tecido', 1, 1, $3, $4, $5, $6, 'teste') AS r`,
            [tenant, modelo, vt, caso.metros, caso.mesma_oc, itemEscolhidoReal])).r;

          // TS com os ids reais
          const vinculos: OcLink[] = caso.vinculos.filter((v) => itemReal.has(v.oc_tecido_item_id))
            .map((v) => ({ oc_tecido_item_id: itemReal.get(v.oc_tecido_item_id)!, quantidade_m: v.quantidade_m, prioridade: v.prioridade }));
          const fifo: OcLote[] = caso.fifo.map((f) => ({ oc_tecido_item_id: itemReal.get(f.oc_tecido_item_id)!, saldo: f.saldo }));
          const ts = alocarTecido({ modo: caso.modo, mesma_oc: caso.mesma_oc, itemEscolhido: itemEscolhidoReal, metros: caso.metros, vinculos, fifo });

          expect(r4(res.baixado)).toBe(r4(ts.baixado));
          const sqlF = (res.fontes ?? []).map((f) => ({ item: f.oc_tecido_item_id, m: r4(f.metros) }));
          const tsF = ts.fontes.map((f) => ({ item: f.oc_tecido_item_id, m: r4(f.metros) }));
          expect(sqlF).toEqual(tsF);
        }
      });
    });
  }
});

describe.skipIf(!RODA)("urgd-r11-regras: baixa e estorno diretos", () => {
  it("baixa grava etb (cad_id/rolo_id NULL, motivo, created_by) + ledger limitado pelo fisico; falta na foto; estorno zera; 2o estorno no-op", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await exigeR11d(c);
      {
        await c.query(`UPDATE public.tenant_config SET modo_baixa_estoque = 'automatico' WHERE tenant_id = $1`, [T]);
        // modelo com Tecido 1 (1 variante) + 1 aviamento + 1 insumo
        const modelo = (await um1<{ id: string }>(c, `INSERT INTO public.modelos (tenant_id, nome, origem) VALUES ($1,$2,'interno') RETURNING id`, [T, `bx ${suf()}`])).id;
        const art = (await um1<{ id: string }>(c, `INSERT INTO public.artigos (tenant_id, nome, unidade_medida, preco, rendimento) VALUES ($1,$2,'metro',10,1) RETURNING id`, [T, `bx art ${suf()}`])).id;
        const vt = (await um1<{ id: string }>(c, `INSERT INTO public.variantes_tecido (tenant_id, artigo_id, nome_variante) VALUES ($1,$2,'v') RETURNING id`, [T, art])).id;
        const mt = (await um1<{ id: string }>(c, `INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo) VALUES ($1,$2,1,'tecido',2) RETURNING id`, [modelo, art])).id;
        await c.query(`INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1,$2,1)`, [mt, vt]);
        // OC recebida com saldo 1m (menos que a_enviar 2m -> falta no tecido)
        const oc = (await um1<{ id: string }>(c, `INSERT INTO public.ocs_tecido (tenant_id, numero_pedido, status, data_entrega) VALUES ($1,$2,'recebido','2026-01-01') RETURNING id`, [T, `bx-oc-${suf()}`])).id;
        await c.query(`INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, artigo_numero, variante_tecido_id, quantidade_pedida, quantidade_recebida) VALUES ($1,$2,1,$3,1,1)`, [oc, art, vt]);
        // aviamento com estoque fisico 5 (recebido), consumo 3
        const avi = (await um1<{ id: string }>(c, `INSERT INTO public.aviamentos (tenant_id, codigo_nome, preco) VALUES ($1,$2,1) RETURNING id`, [T, `bx avi ${suf()}`])).id;
        const av = (await um1<{ id: string }>(c, `INSERT INTO public.variantes_aviamento (tenant_id, aviamento_id, nome_variante) VALUES ($1,$2,'a') RETURNING id`, [T, avi])).id;
        await c.query(`INSERT INTO public.modelo_aviamentos (modelo_id, aviamento_id, numero, consumo, variante_aviamento_id) VALUES ($1,$2,1,3,$3)`, [modelo, avi, av]);
        const ocAvi = (await um1<{ id: string }>(c, `INSERT INTO public.ocs_aviamento (tenant_id, numero_pedido, status) VALUES ($1,$2,'recebido') RETURNING id`, [T, `bx-oca-${suf()}`])).id;
        await c.query(`INSERT INTO public.ocs_aviamento_itens (oc_aviamento_id, aviamento_id, variante_aviamento_id, quantidade_pedida, quantidade_recebida) VALUES ($1,$2,$3,5,5)`, [ocAvi, avi, av]);

        const cat = (await um1<{ id: string }>(c, `INSERT INTO public.categorias_terceirizado (tenant_id, nome) VALUES ($1,$2) RETURNING id`, [T, `bx cat ${suf()}`])).id;
        const moLinha = (await um1<{ id: string }>(c, `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor) VALUES ($1,$2,$3,10) RETURNING id`, [T, modelo, cat])).id;
        const tentativa = (await um1<{ id: string }>(c, `INSERT INTO public.modelo_peca_teste_tentativas (tenant_id, modelo_id, mo_linha_id, categoria_terceirizado_id, numero, data_saida) VALUES ($1,$2,$3,$4,1,'2026-01-05') RETURNING id`, [T, modelo, moLinha, cat])).id;
        await c.query(`INSERT INTO public.modelo_peca_teste_mini (tentativa_id, tenant_id, modelo_id, tamanho, variante_tecido_id, mesma_oc) VALUES ($1,$2,$3,'M',$4,true)`, [tentativa, T, modelo, vt]);

        const res = (await um1<{ r: { linhas: number; faltas: any[] } }>(c, `SELECT public._peca_teste_mini_baixar($1, NULL) AS r`, [tentativa])).r;
        expect(res.linhas).toBe(2); // tecido + aviamento (sem insumo neste caso)
        expect(res.faltas.length).toBeGreaterThanOrEqual(1); // o tecido faltou

        // etb: 1 linha peca_teste, cad_id/rolo_id NULL, motivo preenchido, created_by = usuario
        const etb = (await um1<{ n: number; cad: number; rolo: number; mot: number; cb: number; q: number }>(c,
          `SELECT count(*)::int n, count(cad_id)::int cad, count(rolo_id)::int rolo, count(motivo)::int mot, count(created_by)::int cb, coalesce(sum(quantidade),0) q
             FROM public.estoque_tecido_baixas WHERE peca_teste_tentativa_id = $1 AND origem='peca_teste'`, [tentativa]));
        expect(etb.n).toBe(1);
        expect(etb.cad).toBe(0);
        expect(etb.rolo).toBe(0);
        expect(etb.mot).toBe(1);
        expect(etb.cb).toBe(1);
        expect(Number(etb.q)).toBeCloseTo(1, 4); // so 1m disponivel (a_enviar era 4m -> 2 pecas? nao: 1 peca x consumo 2 = 2m; saldo 1 -> baixa 1, falta 1)

        // ledger novo: aviamento baixa = LEAST(a_enviar 3, fisico 5) = 3
        const led = (await um1<{ n: number; q: number }>(c,
          `SELECT count(*)::int n, coalesce(sum(quantidade),0) q FROM public.estoque_peca_teste_baixas WHERE tentativa_id=$1 AND origem='peca_teste' AND familia='aviamento'`, [tentativa]));
        expect(led.n).toBe(1);
        expect(Number(led.q)).toBeCloseTo(3, 4);

        // falta do tecido registrada na foto (b_faltou > 0)
        const foto = (await um1<{ faltou: number }>(c, `SELECT coalesce(max(b_faltou),0) faltou FROM public.modelo_peca_teste_mini_linhas WHERE tentativa_id=$1 AND familia='tecido'`, [tentativa]));
        expect(Number(foto.faltou)).toBeCloseTo(1, 4);

        // baixa ativa
        expect((await um1<{ b: string | null }>(c, `SELECT baixa_em::text b FROM public.modelo_peca_teste_mini WHERE tentativa_id=$1`, [tentativa])).b).not.toBeNull();

        // estorno: liquido 0 nos 2 ledgers
        await c.query(`SELECT public._peca_teste_mini_estornar($1)`, [tentativa]);
        const liqEtb = Number((await um1<{ q: number }>(c, `SELECT coalesce(sum(quantidade),0) q FROM public.estoque_tecido_baixas WHERE peca_teste_tentativa_id=$1`, [tentativa])).q);
        const liqLed = Number((await um1<{ q: number }>(c, `SELECT coalesce(sum(quantidade),0) q FROM public.estoque_peca_teste_baixas WHERE tentativa_id=$1`, [tentativa])).q);
        expect(liqEtb).toBeCloseTo(0, 4);
        expect(liqLed).toBeCloseTo(0, 4);
        expect((await um1<{ b: string | null }>(c, `SELECT baixa_em::text b FROM public.modelo_peca_teste_mini WHERE tentativa_id=$1`, [tentativa])).b).toBeNull();

        // 2o estorno: no-op (liquido ja 0, nenhuma linha nova)
        const antes = Number((await um1<{ n: number }>(c, `SELECT count(*)::int n FROM public.estoque_peca_teste_baixas WHERE tentativa_id=$1`, [tentativa])).n);
        await c.query(`SELECT public._peca_teste_mini_estornar($1)`, [tentativa]);
        const depois = Number((await um1<{ n: number }>(c, `SELECT count(*)::int n FROM public.estoque_peca_teste_baixas WHERE tentativa_id=$1`, [tentativa])).n);
        expect(depois).toBe(antes);
      }
    });
  });
});

describe.skipIf(!RODA)("urgd-r11-regras: leitura, feita e ACL", () => {
  it("leitura devolve a forma esperada e NULL nos casos de recusa", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await exigeR11d(c);
      {
        const modelo = (await um1<{ id: string }>(c, `INSERT INTO public.modelos (tenant_id, nome, origem) VALUES ($1,$2,'interno') RETURNING id`, [T, `leit ${suf()}`])).id;
        const art = (await um1<{ id: string }>(c, `INSERT INTO public.artigos (tenant_id, nome, unidade_medida, preco, rendimento) VALUES ($1,$2,'metro',10,1) RETURNING id`, [T, `leit art ${suf()}`])).id;
        const vt = (await um1<{ id: string }>(c, `INSERT INTO public.variantes_tecido (tenant_id, artigo_id, nome_variante) VALUES ($1,$2,'v') RETURNING id`, [T, art])).id;
        const mt = (await um1<{ id: string }>(c, `INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo) VALUES ($1,$2,1,'tecido',1) RETURNING id`, [modelo, art])).id;
        await c.query(`INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1,$2,1)`, [mt, vt]);

        const js = (await um1<{ r: any }>(c, `SELECT public.peca_teste_mini_estoque($1) AS r`, [modelo])).r;
        expect(js).not.toBeNull();
        expect(js).toHaveProperty("modo");
        expect(Array.isArray(js.tecidos)).toBe(true);
        expect(Array.isArray(js.aviamentos)).toBe(true);
        expect(Array.isArray(js.insumos)).toBe(true);

        // outra loja -> NULL
        await c.query(`INSERT INTO public.tenants (id, nome) VALUES ($1, 'Outra R11d') ON CONFLICT (id) DO NOTHING`, [OUTRA]);
        const mFora = (await um1<{ id: string }>(c, `INSERT INTO public.modelos (tenant_id, nome, origem) VALUES ($1,$2,'interno') RETURNING id`, [OUTRA, `fora ${suf()}`])).id;
        expect((await um1<{ r: any }>(c, `SELECT public.peca_teste_mini_estoque($1) AS r`, [mFora])).r).toBeNull();
      }
    });
  });

  it("peca_teste_mini_estoque = NULL sem Entrada e Saida", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await exigeR11d(c);
      {
        // desliga entrada_saida SEM claims (MOD-1); depois volta a por como usuario comum para a leitura
        await c.query(`SELECT set_config('request.jwt.claims', '', true)`);
        await c.query(`UPDATE public.tenant_config SET modules = coalesce(modules,'{}'::jsonb) || '{"entrada_saida": false}'::jsonb WHERE tenant_id = $1`, [T]);
        await comoUsuario(c);
        const modelo = (await um1<{ id: string }>(c, `INSERT INTO public.modelos (tenant_id, nome, origem) VALUES ($1,$2,'interno') RETURNING id`, [T, `es-off ${suf()}`])).id;
        expect((await um1<{ r: any }>(c, `SELECT public.peca_teste_mini_estoque($1) AS r`, [modelo])).r).toBeNull();
      }
    });
  });

  it("_peca_teste_mini_feita: virtual=false, atual com/sem baixa, reprovada + proxima", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await exigeR11d(c);
      {
        const modelo = (await um1<{ id: string }>(c, `INSERT INTO public.modelos (tenant_id, nome, origem) VALUES ($1,$2,'interno') RETURNING id`, [T, `feita ${suf()}`])).id;
        const cat = (await um1<{ id: string }>(c, `INSERT INTO public.categorias_terceirizado (tenant_id, nome) VALUES ($1,$2) RETURNING id`, [T, `cat ${suf()}`])).id;
        const moLinha = (await um1<{ id: string }>(c, `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor) VALUES ($1,$2,$3,10) RETURNING id`, [T, modelo, cat])).id;
        const tentativa = async (numero: number, aprovacao: string | null) => (await um1<{ id: string }>(c,
          `INSERT INTO public.modelo_peca_teste_tentativas (tenant_id, modelo_id, mo_linha_id, categoria_terceirizado_id, numero, aprovacao, data_saida, data_entrada)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [T, modelo, moLinha, cat, numero, aprovacao, aprovacao == null ? null : "2026-01-01", aprovacao == null ? null : "2026-01-02"])).id;
        const mini = async (tid: string, baixa: boolean) => c.query(
          `INSERT INTO public.modelo_peca_teste_mini (tentativa_id, tenant_id, modelo_id, baixa_em) VALUES ($1,$2,$3,$4)`,
          [tid, T, modelo, baixa ? new Date().toISOString() : null]);

        // virtual (sem tentativa) -> false
        expect((await um1<{ r: boolean }>(c, `SELECT public._peca_teste_mini_feita($1,$2) AS r`, [moLinha, cat])).r).toBe(false);
        // tentativa 1 com mini SEM baixa -> false
        const t1 = await tentativa(1, null); await mini(t1, false);
        expect((await um1<{ r: boolean }>(c, `SELECT public._peca_teste_mini_feita($1,$2) AS r`, [moLinha, cat])).r).toBe(false);
        // tentativa 2 (atual) com baixa -> true (mesmo que a 1 tenha baixa ou não)
        const t2 = await tentativa(2, null); await mini(t2, true);
        expect((await um1<{ r: boolean }>(c, `SELECT public._peca_teste_mini_feita($1,$2) AS r`, [moLinha, cat])).r).toBe(true);
        // reprovada (t3) SEM mini/baixa -> false (a atual é a t3)
        await tentativa(3, "reprovado");
        expect((await um1<{ r: boolean }>(c, `SELECT public._peca_teste_mini_feita($1,$2) AS r`, [moLinha, cat])).r).toBe(false);
      }
    });
  });

  it("ACL: 3 cores revogados dos 3; wrapper authenticated=X", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await exigeR11d(c);
      {
        const cores = [
          "public._peca_teste_insumo_tam_bucket(uuid,text)",
          "public._peca_teste_mini_linhas(uuid,text,uuid,jsonb)",
          "public._peca_teste_tecido_baixar(uuid,uuid,uuid,text,integer,integer,uuid,numeric,boolean,uuid,text)",
          "public._peca_teste_mini_baixar(uuid,jsonb)",
          "public._peca_teste_mini_estornar(uuid)",
          "public._peca_teste_mini_estoque_core(uuid,uuid)",
          "public._peca_teste_mini_feita(uuid,uuid)",
          "public._peca_teste_mini_tem_historico(uuid)",
          "public._peca_teste_variante_aviamento_padrao(uuid,uuid,uuid)",
        ];
        for (const f of cores) {
          const r = await um1<{ anon: boolean; auth: boolean }>(c,
            `SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon, has_function_privilege('authenticated',$1,'EXECUTE') AS auth`, [f]);
          expect(r.anon, `${f} anon`).toBe(false);
          expect(r.auth, `${f} authenticated`).toBe(false);
        }
        const w = await um1<{ anon: boolean; auth: boolean }>(c,
          `SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon, has_function_privilege('authenticated',$1,'EXECUTE') AS auth`,
          ["public.peca_teste_mini_estoque(uuid)"]);
        expect(w.anon).toBe(false);
        expect(w.auth).toBe(true);
      }
    });
  });
});
