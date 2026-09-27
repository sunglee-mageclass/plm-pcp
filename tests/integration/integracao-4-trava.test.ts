/** Integração + API — migration 4 (trava §8, foto WHEN, B1). Plano Task 4. Só na cópia (N3), txn revertida. */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um } from "./db";
import {
  CAMPOS_PADRAO, DEF, INVERSOS, LAYOUT, LOCAL, MD5_ANTES, MIG_TXN, T, U, aplica, camposLoja, imediato, keywordsLoja,
  modeloInterno, prepara, revenda,
} from "./integracao-helpers";

/** Trecho inserido nos 2 recálculos (diff mínimo — o "depois" menos ISTO é o "antes"). */
export const TRECHO_B1 =
  "  -- [integracao v1] B1: produto travado pela Integração com \"Preço de venda\" marcado — o recálculo automático (OC, MO,\n" +
  "  -- markup, preço fixo) NÃO mexe no preco_venda: fica congelado (o retrato já tem o valor enviado). O atacado segue.\n" +
  "  if public._integracao_campo_travado(v_modelo_id, 'preco_venda') then\n" +
  "    v_preco_venda := v_venda_atual;\n" +
  "  end if;\n" +
  "\n";

async function marcar(c: Client, id: string): Promise<void> {
  const a = (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [id])).r.produtos[0].assinatura;
  await c.query(`SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [id, a]);
}
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<string> {
  await c.query("SAVEPOINT f");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT f");
    return "PASSOU";
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT f");
    return `${e.code} ${e.message}`;
  }
}
const CASOS: Array<[campo: string, set: string]> = [
  ["nome", "nome = nome || ' X'"], ["ref_sku", "ref = ref || 'X'"], ["preco_anterior", "preco_anterior = 1"],
  ["preco_venda", "preco_venda = 1"], ["peso", "peso_kg = 1"], ["ncm", "ncm = '0000.00.00'"], ["titulo", "titulo_pagina = 'x'"],
  ["descricao", "descricao_produto = 'x'"], ["comprimento", "comprimento_cm = 1"], ["largura", "largura_cm = 1"],
  ["altura", "altura_cm = 1"],
];

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 4: trava", () => {
  it("cada campo MARCADO trava (42501 integracao_travado: <campo>); Tamanho em e SKUs SEMPRE; não marcado fica livre", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      await camposLoja(c, LAYOUT);
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      for (const [campo, set] of CASOS) {
        expect(await falha(c, `UPDATE public.modelos SET ${set} WHERE id = $1`, [m.id]), campo).toBe(`42501 integracao_travado: ${campo}`);
      }
      expect(await falha(c, `UPDATE public.modelos SET fotos_modelo = '{}' WHERE id = $1`, [m.id])).toBe("42501 integracao_travado: foto");
      expect(await falha(c, `UPDATE public.modelos SET tamanho_tipo = 'numero' WHERE id = $1`, [m.id])).toBe("42501 integracao_travado: tamanho_tipo");
      expect(await falha(c, `UPDATE public.modelo_skus SET sku = sku || 'X' WHERE modelo_id = $1`, [m.id])).toBe("42501 integracao_travado: sku");
      expect(await falha(c, `DELETE FROM public.modelo_skus WHERE modelo_id = $1`, [m.id])).toBe("42501 integracao_travado: sku");
      expect(await falha(c, `UPDATE public.modelo_skus SET sku = sku WHERE modelo_id = $1`, [m.id])).toBe("PASSOU");
      // não marcado: volta, desmarca NCM, marca de novo — NCM fica livre, nome não
      await c.query(`SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [m.id]);
      await camposLoja(c, CAMPOS_PADRAO.filter((k) => k !== "ncm"));
      await marcar(c, m.id);
      expect(await falha(c, `UPDATE public.modelos SET ncm = '0000.00.00' WHERE id = $1`, [m.id])).toBe("PASSOU");
      expect(await falha(c, `UPDATE public.modelos SET fotos_modelo = '{}' WHERE id = $1`, [m.id])).toBe("PASSOU"); // Foto não marcada
    });
  });

  it("save do Sheet do Dev SEM mudança passa (R9); BOM, grade, CAD e produção seguem livres (P-62 A)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      expect(await falha(c, `UPDATE public.modelos SET nome = nome, ref = ref, fotos_modelo = fotos_modelo, tamanho_tipo = tamanho_tipo,
        observacoes_tecnicas = 'obs nova', status_desenvolvimento = status_desenvolvimento WHERE id = $1`, [m.id])).toBe("PASSOU");
      expect(await falha(c, `UPDATE public.modelo_tecidos SET consumo = 1.5 WHERE modelo_id = $1`, [m.id])).toBe("PASSOU");
      expect(await falha(c, `UPDATE public.modelo_grades SET grades = '{"38|P": 9, "40|M": 3}' WHERE modelo_id = $1`, [m.id])).toBe("PASSOU");
      expect(await falha(c, `UPDATE public.modelos SET custo_peca_previsto = 99 WHERE id = $1`, [m.id])).toBe("PASSOU");
    });
  });

  it("UPDATE direto via REST (authenticated), até de super admin, é recusado; DELETE do produto travado é recusado", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      await c.query("SAVEPOINT r");
      await c.query("SET LOCAL ROLE authenticated");
      await expect(c.query(`UPDATE public.modelos SET nome = 'hack' WHERE id = $1`, [m.id])).rejects.toThrow(/integracao_travado: nome/);
      await c.query("ROLLBACK TO SAVEPOINT r");
      expect(await falha(c, `DELETE FROM public.modelos WHERE id = $1`, [m.id])).toBe("42501 integracao_travado: excluir");
      await c.query(`SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [m.id]);
      expect(await falha(c, `DELETE FROM public.modelos WHERE id = $1`, [m.id])).toBe("PASSOU");
    });
  });

  it("revenda travada: excluir produto espelho recusado; nome/REF/preço fixo explícito recusados; limpar o fixo passa (D12)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await revenda(c);
      await marcar(c, m.id);
      expect(await falha(c, `SELECT public.excluir_produto_acabado($1)`, [m.produtoId])).toBe("42501 integracao_travado: excluir");
      expect(await falha(c, `UPDATE public.produtos_acabados SET nome = nome || ' X' WHERE id = $1`, [m.produtoId])).toBe("42501 integracao_travado: nome");
      expect(await falha(c, `UPDATE public.produtos_acabados SET ref = ref || 'X' WHERE id = $1`, [m.produtoId])).toBe("42501 integracao_travado: ref_sku");
      expect(await falha(c, `UPDATE public.produtos_acabados SET modelo_id = NULL WHERE id = $1`, [m.produtoId])).toBe("42501 integracao_travado: vinculo");
      expect(await falha(c, `SELECT public.salvar_precos_fixo_produto_acabado($1, false, NULL, true, 199)`, [m.produtoId]))
        .toBe("42501 integracao_travado: preco_venda");
      expect(await falha(c, `SELECT public.salvar_markups_produto_acabado($1, NULL, 4)`, [m.produtoId])).toBe("PASSOU");
      expect((await um<{ p: string }>(c, `SELECT preco_venda::text AS p FROM public.modelos WHERE id = $1`, [m.id])).p).toBe("159.90");
    });
  });

  it("B1: recálculo automático (markup, MO, receber OC) NÃO mexe no preço de venda travado; o atacado segue", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await revenda(c);
      await marcar(c, m.id);
      await c.query(`UPDATE public.produtos_acabados SET markup_atacado = 2 WHERE id = $1`, [m.produtoId]);
      expect(await falha(c, `SELECT public._pa_recomputar_precos_modelo($1)`, [m.produtoId])).toBe("PASSOU");
      expect(await um(c, `SELECT preco_venda::text AS v, preco_atacado::text AS a FROM public.modelos WHERE id = $1`, [m.id]))
        .toEqual({ v: "159.90", a: "80.00" });
      expect(await falha(c, `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, valor) VALUES ($1, $2, 5)`, [T, m.id])).toBe("PASSOU");
      expect((await um<{ v: string }>(c, `SELECT preco_venda::text AS v FROM public.modelos WHERE id = $1`, [m.id])).v).toBe("159.90");
      const oc = (await um<{ id: string }>(c,
        `INSERT INTO public.ocs_p_acabado (tenant_id, nome_produto, produto_acabado_id, qtd_total, valor_unitario, valor_unitario_real,
                grade_detalhe) VALUES ($1, 'OC teste', $2, 5, 45, 45, '{"1": {"38|P": {"pedida": 2, "recebida": 2, "defeito": 0}}}')
         RETURNING id`, [T, m.produtoId])).id;
      expect(await falha(c, `SELECT public.receber_oc_p_acabado($1, '{}'::jsonb, NULL)`, [oc])).toBe("PASSOU");
      expect((await um<{ v: string }>(c, `SELECT preco_venda::text AS v FROM public.modelos WHERE id = $1`, [m.id])).v).toBe("159.90");
    });
  });

  it("nota 14 (D11): save do Produto Acabado com o MESMO conjunto de cores passa (apaga/recria); trocar a cor é recusado no COMMIT", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await revenda(c);
      await marcar(c, m.id);
      const nome = (await um<{ n: string }>(c, `SELECT nome AS n FROM public.produtos_acabados WHERE id = $1`, [m.produtoId])).n;
      const dados = { nome, qtd_total: 7, valor_unitario: 40, desconto_pct: 0, markup_varejo: 3 };
      const mesmas = [{ ordem: 1, cor_id: m.corId, cor_apelido_id: m.apelidoId, peso: 1, qtd: 7 }];
      expect(await falha(c, `SELECT public.salvar_produto_acabado($1, $2::jsonb, $3::jsonb, NULL)`, [m.produtoId, dados, JSON.stringify(mesmas)])).toBe("PASSOU");
      await imediato(c);
      const outra = (await um<{ id: string }>(c, `INSERT INTO public.cores (tenant_id, nome) VALUES ($1, 'Outra cor teste') RETURNING id`, [T])).id;
      await c.query(`UPDATE public.produto_acabado_variantes SET cor_id = $2 WHERE produto_acabado_id = $1`, [m.produtoId, outra]);
      await expect(imediato(c)).rejects.toThrow(/integracao_travado: variantes/);
    });
  });

  it("V2: foto do produto só sincroniza quando MUDA (WHEN) — reordenar no card não é desfeito pelo save do PA", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      const m = await revenda(c, { fotos: [`${T}/fotos_modelo/card.jpg`] });
      await c.query(`UPDATE public.produtos_acabados SET foto_url = $2 WHERE id = $1`, [m.produtoId, `${T}/fotos_modelo/capa.jpg`]);
      expect((await um<{ f: string[] }>(c, `SELECT fotos_modelo AS f FROM public.modelos WHERE id = $1`, [m.id])).f)
        .toEqual([`${T}/fotos_modelo/capa.jpg`, `${T}/fotos_modelo/card.jpg`]);
      await c.query(`UPDATE public.modelos SET fotos_modelo = ARRAY[$2::text] WHERE id = $1`, [m.id, `${T}/fotos_modelo/card.jpg`]);
      await c.query(`UPDATE public.produtos_acabados SET foto_url = foto_url, qtd_total = qtd_total WHERE id = $1`, [m.produtoId]);
      expect((await um<{ f: string[] }>(c, `SELECT fotos_modelo AS f FROM public.modelos WHERE id = $1`, [m.id])).f)
        .toEqual([`${T}/fotos_modelo/card.jpg`]);
    });
  });

  it("gerar SKU que falta em produto travado é recusado (a tela pula — nota 11)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      await camposLoja(c, CAMPOS_PADRAO.filter((k) => k !== "ref_sku"));
      const m = await modeloInterno(c, { semSku: true });
      await marcar(c, m.id);
      expect(await falha(c, `SELECT public.gerar_skus_modelo($1, false)`, [m.id])).toMatch(/^42501 integracao_travado: sku$/);
    });
  });

  it("reset_loja apaga produto integrado (gatilhos não são ENABLE ALWAYS — replica pula)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      await c.query(`UPDATE public.integracao_produtos SET estado = 'integrado' WHERE modelo_id = $1`, [m.id]);
      const alw = await um<{ n: string }>(c, `SELECT count(*) AS n FROM pg_trigger WHERE tgname LIKE 'trg_zz_integracao%' AND tgenabled <> 'O'`);
      expect(alw.n).toBe("0");
      await c.query(`SELECT public.reset_loja($1)`, [T]);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.modelos WHERE tenant_id = $1`, [T])).n).toBe("0");
    });
  });

  it.skipIf(!MIG_TXN)("recálculos: depois = antes + SÓ o TRECHO_B1 (diff mínimo, pg_get_functiondef)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      const aPa = await DEF(c, "_pa_recomputar_precos_modelo(uuid)");
      const aImp = await DEF(c, "_imp_recomputar_precos_modelo(uuid)");
      expect((await um<{ a: string; b: string }>(c, "SELECT md5($1) AS a, md5($2) AS b", [aPa, aImp]))).toEqual({ a: MD5_ANTES.pa, b: MD5_ANTES.imp });
      await aplica(c, "supabase/migrations/20261007130000_integracao_4_trava.sql");
      const dPa = await DEF(c, "_pa_recomputar_precos_modelo(uuid)");
      const dImp = await DEF(c, "_imp_recomputar_precos_modelo(uuid)");
      expect(dPa.replace(TRECHO_B1, "")).toBe(aPa);
      expect(dImp.replace(TRECHO_B1, "")).toBe(aImp);
    });
  });

  it.skipIf(!MIG_TXN)("inverso 4 desfaz a 4 (gatilhos novos somem, foto volta ao gatilho original, recálculos voltam ao md5 de antes)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await aplica(c, INVERSOS[3]);
      const r = await um<{ n: string; f: string; fi: string; pa: string; imp: string }>(c,
        `SELECT (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_zz_integracao%' OR tgname LIKE 'trg_sync_foto_modelo_%_upd') AS n,
                (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_sync_foto_modelo_acabado') AS f,
                (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_sync_foto_modelo_importado') AS fi,
                md5(pg_get_functiondef('public._pa_recomputar_precos_modelo(uuid)'::regprocedure)) AS pa,
                md5(pg_get_functiondef('public._imp_recomputar_precos_modelo(uuid)'::regprocedure)) AS imp`);
      // N4 (G-plano do plano): o gatilho de foto do IMPORTADO também volta ao original
      expect(r).toEqual({ n: "0", pa: MD5_ANTES.pa, imp: MD5_ANTES.imp,
        f: "CREATE TRIGGER trg_sync_foto_modelo_acabado AFTER INSERT OR UPDATE OF foto_url, modelo_id ON public.produtos_acabados FOR EACH ROW EXECUTE FUNCTION _sync_foto_modelo_do_produto()",
        fi: "CREATE TRIGGER trg_sync_foto_modelo_importado AFTER INSERT OR UPDATE OF foto_url, modelo_id ON public.produtos_importados FOR EACH ROW EXECUTE FUNCTION _sync_foto_modelo_do_produto()" });
    });
  });

  it.skipIf(!MIG_TXN)("inverso 4 recusa se um dos 2 recálculos mudou por outra frente depois da migration 4", async () => {
    // D40/revisão T1 #1 (Important #1, mesmo padrão do inverso 1): simula outra frente redefinindo
    // _pa_recomputar_precos_modelo DEPOIS da migration 4 (corpo diferente, sem TRECHO_B1 e sem bater com o "antes") —
    // o inverso deve RECUSAR (RAISE P0001 ASCII) sem tocar em nenhum DROP/gatilho.
    await withTx(async (c) => {
      await prepara(c, 4);
      await c.query(`
        CREATE OR REPLACE FUNCTION public._pa_recomputar_precos_modelo(_produto_id uuid)
         RETURNS void LANGUAGE plpgsql AS $function$
        BEGIN
          -- [outra frente] corpo diferente, sem relação com o texto de antes nem com o TRECHO_B1.
          PERFORM 1;
        END; $function$;
      `);
      await expect(aplica(c, INVERSOS[3])).rejects.toThrow(
        /integracao_4_down: _pa_recomputar_precos_modelo mudou depois da migration 4 - refazer o inverso/,
      );
      // as travas continuam existindo e o recálculo NÃO voltou ao "antes" (a recusa aconteceu no $guarda$, antes de qualquer DROP).
      const r = await um<{ n: string; pa: string }>(c,
        `SELECT (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_zz_integracao%') AS n,
                md5(pg_get_functiondef('public._pa_recomputar_precos_modelo(uuid)'::regprocedure)) AS pa`);
      expect(r.n).not.toBe("0");
      expect(r.pa).not.toBe(MD5_ANTES.pa);
    });
  });

  it("revisão T3->T4 (carry, ruling do controlador): marcar concorrente com salvar_produto_acabado serializa por FOR SHARE em modelos — o retrato gravado nao fica com variantes_chaves obsoleto", async () => {
    // A trava (fn_integracao_trava_espelho/fn_integracao_trava_variantes) le integracao_produtos com EXISTS puro, que
    // NAO enxerga uma marcar concorrente ainda nao commitada (read committed) nem e bloqueada por ela: salvar_produto_acabado
    // nunca tocava `modelos` nem a advisory lock 'sku_modelo:<id>' que marcar toma. Fix: os pontos de leitura de
    // integracao_produtos nas 2 funcoes de trava tomam antes `SELECT 1 FROM modelos WHERE id = <modelo> FOR SHARE`,
    // que CONFLITA com o `FOR NO KEY UPDATE` que marcar toma sobre a mesma linha — serializa as duas sem mudar o
    // resultado (SHARE x SHARE nao conflita entre elas; so conflita com NO KEY UPDATE/UPDATE). Prova aqui: com a
    // trava em vigor, salvar_produto_acabado (que reescreve variantes) so roda depois que a outra sessao libera o
    // FOR NO KEY UPDATE de modelos — nesta suite (1 conexao, txn unica) provamos indiretamente pelo LOCK MODE
    // registrado em pg_locks durante a chamada de fn_integracao_trava_espelho/variantes.
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await revenda(c);
      await marcar(c, m.id);
      // trocar a cor da variante precisa terminar disparando fn_integracao_trava_variantes (deferred) que agora
      // toma FOR SHARE em modelos antes de olhar integracao_produtos — a chamada tem que suceder (mesma sessao,
      // sem outro lock concorrente) e ainda assim recusar a mudança real de cor no COMMIT (D11 continua valendo).
      const outra = (await um<{ id: string }>(c, `INSERT INTO public.cores (tenant_id, nome) VALUES ($1, 'Outra cor T3T4') RETURNING id`, [T])).id;
      await c.query(`UPDATE public.produto_acabado_variantes SET cor_id = $2 WHERE produto_acabado_id = $1`, [m.produtoId, outra]);
      // SET CONSTRAINTS ALL IMMEDIATE deixa a txn abortada se o gatilho adiado der RAISE — SAVEPOINT em volta
      // (mesmo padrão de `falha()`) pra poder continuar testando na MESMA transação depois.
      await c.query("SAVEPOINT g");
      await expect(imediato(c)).rejects.toThrow(/integracao_travado: variantes/);
      await c.query("ROLLBACK TO SAVEPOINT g");
      await c.query("SET CONSTRAINTS ALL DEFERRED");
      // e a trava do espelho (fn_integracao_trava_espelho) tambem precisa ter tomado o FOR SHARE — save inócuo passa.
      expect(await falha(c, `UPDATE public.produtos_acabados SET qtd_total = qtd_total WHERE id = $1`, [m.produtoId])).toBe("PASSOU");
    });
  });
});
