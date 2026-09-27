/** Integração + API — migration 5 (mão dupla + integracao_salvar). Plano Task 5. Só na cópia (N3), txn revertida. */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um } from "./db";
import { aplicarSql } from "./mig-txn";
import { DEF, INVERSOS, LOCAL, MD5_ANTES, MIG_TXN, MIGRACOES, T, U, aplica, comoUsuarioCom, importado, keywordsLoja, ler, modeloInterno, prepara, revenda, semTravas } from "./integracao-helpers";

// D14/R1 (G-plano do plano): bloco inserido ANTES de "-- Variantes" (vale p/ INSERT e UPDATE), na transação do _rev_base.
export const TRECHO_IMP_FIXO =
  "  -- [integracao v1] D14/R1: o preço do Importado grava no SALVAR da tela, NESTA transação (a do _rev_base do wrapper).\n" +
  "  -- Preço FIXO no _dados = preço exato do canal e ZERA o markup dele; sem fixo, markup não-nulo LIMPA o fixo (\"última\n" +
  "  -- edição manda\", como a revenda — fix 2efa2ba); sem nenhum dos dois, o fixo fica (outros gravadores não mandam as chaves).\n" +
  "  -- ruling do controlador, G-migration fix 3 #J2 (P-91 A): a chave preco_atacado_fixo/preco_varejo_fixo PRESENTE com\n" +
  "  -- vazio/NULL (com o markup do canal TAMBÉM vazio/ausente) agora LIMPA o fixo — espelha exatamente o comportamento\n" +
  "  -- do Produto Acabado (o front chama salvar_precos_fixo_produto_acabado com _tocar_varejo=true incondicionalmente a\n" +
  "  -- cada blur que muda o valor exibido, inclusive apagar para vazio: novo=null !== atual dispara _tocar_varejo=true,\n" +
  "  -- _preco_varejo_fixo=null, que grava preco_varejo_fixo=NULL sem olhar o markup — ver ProdutoCard.tsx/\n" +
  "  -- useRevendaPlanejamento.ts). Antes, a chave presente-e-vazia caía no MESMO ramo de \"chave ausente\" (mantinha o\n" +
  "  -- valor atual, \"else x.preco_varejo_fixo\") quando o markup também estava vazio — \"apagar o Valor\" no Importado\n" +
  "  -- não apagava o fixo (D14 do parecer, nuance aceita como bug pelo dono na P-91). Regra final (3 casos, na MESMA\n" +
  "  -- ORDEM de prioridade do código original — fixo primeiro): (1) chave do fixo PRESENTE com número → grava o fixo\n" +
  "  -- exato e zera o markup do canal (prioridade sobre um markup que porventura venha junto no mesmo payload — R1,\n" +
  "  -- \"o SALVAR grava o fixo exato e zera o markup\"); (2) senão, chave do fixo PRESENTE mas vazia/NULL → NOVO (J2):\n" +
  "  -- limpa o fixo (NULL); o markup do canal só é setado se a chave dele TAMBÉM vier presente com número, senão fica\n" +
  "  -- como estava; (3) chave do fixo AUSENTE e markup do canal PRESENTE e não-vazio → limpa o fixo (NULL) e grava o\n" +
  "  -- markup — \"última edição manda\" original, preservado byte a byte (era o ÚNICO jeito de limpar o fixo antes do\n" +
  "  -- J2); (4) nenhuma das duas chaves presentes/preenchidas → nada muda (outros gravadores não mandam as chaves).\n" +
  "  if coalesce(nullif(_dados->>'preco_atacado_fixo','')::numeric, 1) <= 0\n" +
  "     or coalesce(nullif(_dados->>'preco_varejo_fixo','')::numeric, 1) <= 0 then\n" +
  "    raise exception 'O preço precisa ser maior que zero.' using errcode = 'P0001';\n" +
  "  end if;\n" +
  "  update public.produtos_importados p\n" +
  "     set preco_atacado_fixo = n.af, markup_atacado = n.am, preco_varejo_fixo = n.vf, markup_varejo = n.vm\n" +
  "    from (select\n" +
  "            case when _dados ? 'preco_atacado_fixo' then nullif(_dados->>'preco_atacado_fixo','')::numeric\n" +
  "                 when nullif(_dados->>'markup_atacado','') is not null then null\n" +
  "                 else x.preco_atacado_fixo end as af,\n" +
  "            case when _dados ? 'preco_atacado_fixo' and nullif(_dados->>'preco_atacado_fixo','') is not null then null\n" +
  "                 when _dados ? 'preco_atacado_fixo' then coalesce(nullif(_dados->>'markup_atacado','')::numeric, x.markup_atacado)\n" +
  "                 when nullif(_dados->>'markup_atacado','') is not null then nullif(_dados->>'markup_atacado','')::numeric\n" +
  "                 else x.markup_atacado end as am,\n" +
  "            case when _dados ? 'preco_varejo_fixo' then nullif(_dados->>'preco_varejo_fixo','')::numeric\n" +
  "                 when nullif(_dados->>'markup_varejo','') is not null then null\n" +
  "                 else x.preco_varejo_fixo end as vf,\n" +
  "            case when _dados ? 'preco_varejo_fixo' and nullif(_dados->>'preco_varejo_fixo','') is not null then null\n" +
  "                 when _dados ? 'preco_varejo_fixo' then coalesce(nullif(_dados->>'markup_varejo','')::numeric, x.markup_varejo)\n" +
  "                 when nullif(_dados->>'markup_varejo','') is not null then nullif(_dados->>'markup_varejo','')::numeric\n" +
  "                 else x.markup_varejo end as vm\n" +
  "            from public.produtos_importados x where x.id = v_id) n\n" +
  "   where p.id = v_id\n" +
  "     and (p.preco_atacado_fixo, p.markup_atacado, p.preco_varejo_fixo, p.markup_varejo) is distinct from (n.af, n.am, n.vf, n.vm);\n\n";

async function rev(c: Client, id: string): Promise<number> {
  return (await um<{ r: number }>(c, `SELECT rev AS r FROM public.modelos WHERE id = $1`, [id])).r;
}
async function salvar(c: Client, itens: unknown[], kw: unknown = null): Promise<any> {
  return (await um<{ r: any }>(c, `SELECT public.integracao_salvar($1::jsonb, $2::jsonb) AS r`, [JSON.stringify(itens), kw === null ? null : JSON.stringify(kw)])).r;
}
/**
 * ruling do controlador, revisão T7 #13 (fix round 3): `salvar()` passa `itens` por `JSON.stringify`, e o
 * `JSON.parse`/`JSON.stringify` do JS NORMALIZA "5.0"/"1.50e1" para o inteiro "5"/"15" antes mesmo de sair do
 * processo Node — o bug relatado (rev decimal chegando como TEXTO "5.0" no jsonb do Postgres) nunca seria
 * exercitado por um objeto JS comum. Este helper monta o jsonb no SQL por concatenação de texto, preservando o
 * literal decimal EXATO como o cliente mandaria (ex.: um `fetch` batendo direto na API, sem passar por um
 * `JSON.parse` do lado do servidor Node no meio do caminho).
 */
async function salvarRevLiteral(c: Client, modeloId: string, revLiteral: string, campos: Record<string, unknown>): Promise<any> {
  // jsonb_build_object() converte um argumento NUMERIC via to_jsonb(), que preserva a forma decimal exata do
  // literal (confirmado: jsonb_build_object('rev', 5.0)->>'rev' = '5.0', não '5') — ao contrário de um `::jsonb`
  // direto sobre o literal (que dá erro de cast) ou de passar pelo JSON.stringify do Node (que normaliza 5.0 -> 5
  // antes mesmo de sair do processo). Ruling do controlador, G-migration fix 1 #G11 (nit da T7): revLiteral vai
  // como PARÂMETRO ligado ($3::numeric), não interpolado na string SQL — um `numeric` passado por parâmetro e
  // convertido por to_jsonb() preserva a forma decimal do texto de entrada tão bem quanto um literal cru
  // (confirmado: PREPARE t(numeric) AS SELECT jsonb_build_object('rev', $1)->>'rev'; EXECUTE t('5.0') = '5.0').
  const item = `jsonb_build_object('modelo_id', $1::text, 'rev', $3::numeric, 'campos', $2::jsonb)`;
  return (await um<{ r: any }>(c, `SELECT public.integracao_salvar(jsonb_build_array(${item}), NULL) AS r`,
    [modeloId, JSON.stringify(campos), revLiteral])).r;
}
async function erro(c: Client, fn: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT e");
  try {
    await fn();
    throw new Error("esperava erro");
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT e");
    return { code: e.code, message: e.message };
  }
}
const PERM_TUDO: Array<[string, boolean, boolean]> = [["integracao", true, true], ["criacao_planejamento", true, true],
  ["criacao_planejamento:preco_venda", true, true], ["criacao_desenvolvimento", true, true]];

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 5: integracao_salvar e mão dupla", () => {
  it("interno: grava SÓ as chaves enviadas no MESMO campo do card, com rev (P0409 ASCII), log 'editar' antes/depois", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const m = await modeloInterno(c);
      const r0 = await rev(c, m.id);
      const out = await salvar(c, [{ modelo_id: m.id, rev: r0, campos: { ncm: "6109.90.00", peso_kg: 0.25, titulo_pagina: " Novo título " } }]);
      expect(out.salvos).toBe(1);
      const row = await um<any>(c, `SELECT ncm, peso_kg::text AS peso, titulo_pagina AS t, nome, rev FROM public.modelos WHERE id = $1`, [m.id]);
      expect(row).toMatchObject({ ncm: "6109.90.00", peso: "0.250", t: "Novo título" });
      expect(out.revs[m.id]).toBe(row.rev);
      const log = await um<{ d: any }>(c, `SELECT detalhe AS d FROM public.integracao_log WHERE modelo_id = $1 AND acao = 'editar'`, [m.id]);
      expect(log.d.campos.ncm).toEqual({ antes: "6109.10.00", depois: "6109.90.00" });
      const e = await erro(c, () => salvar(c, [{ modelo_id: m.id, rev: r0, campos: { ncm: "1" } }]));
      expect(e.code).toBe("P0409");
      expect(e.message).toBe("conflito_versao: o produto foi salvo por outra pessoa");
    });
  });

  it("travado (integrável) = 42501 integracao_travado: produto; campo desconhecido = P0001; foto de outra loja = P0001", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      const bad = await erro(c, () => salvar(c, [{ modelo_id: m.id, rev: 1, campos: { custo_peca_previsto: 1 } }]));
      expect(bad.code).toBe("P0001");
      const r0 = await rev(c, m.id);
      const foto = await erro(c, () => salvar(c, [{ modelo_id: m.id, rev: r0, campos: { fotos_modelo: ["00000000-0000-0000-0000-000000000009/x.jpg"] } }]));
      expect(foto.message).toBe("Foto inválida (de outra loja).");
      const a = (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [m.id])).r.produtos[0].assinatura;
      await c.query(`SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [m.id, a]);
      const e = await erro(c, async () => salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { nome: "x" } }]));
      expect(e).toEqual({ code: "42501", message: "integracao_travado: produto" });
    });
  });

  it("G3 (ruling do controlador, G-migration fix 1): fotos seguem a MESMA regra do retrato; numero fora da escala = P0001 PT (nunca 22003 cru)", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const m = await modeloInterno(c);
      // elemento NULL no array de fotos — starts_with(NULL,...) = NULL, o EXISTS antigo nao pegava
      const rNull = await rev(c, m.id);
      const eNull = await erro(c, () => salvar(c, [{ modelo_id: m.id, rev: rNull, campos: { fotos_modelo: [`${T}/fotos_modelo/a.jpg`, null] } }]));
      expect(eNull).toMatchObject({ code: "P0001" });
      expect(eNull.message).toMatch(/[Ff]oto/);
      // segmento vazio, '.', '..' (mesma regra do retrato: nota 7 / Minor #6)
      for (const caminho of [`${T}//x.jpg`, `${T}/./x.jpg`, `${T}/../x.jpg`, `${T}/fotos_modelo/../../outra/x.jpg`]) {
        const r0 = await rev(c, m.id);
        const e = await erro(c, () => salvar(c, [{ modelo_id: m.id, rev: r0, campos: { fotos_modelo: [caminho] } }]));
        expect(e, caminho).toMatchObject({ code: "P0001" });
      }
      // caminho valido continua passando
      const rOk = await rev(c, m.id);
      const ok = await salvar(c, [{ modelo_id: m.id, rev: rOk, campos: { fotos_modelo: [`${T}/fotos_modelo/valida.jpg`] } }]);
      expect(ok.salvos).toBe(1);

      // numero fora da escala da coluna (peso_kg numeric(10,3)) — nunca 22003 cru, sempre P0001 em PT
      const r1 = await rev(c, m.id);
      const ePeso = await erro(c, () => salvar(c, [{ modelo_id: m.id, rev: r1, campos: { peso_kg: 1e20 } }]));
      expect(ePeso.code).toBe("P0001");
      expect(ePeso.message).not.toMatch(/numeric field overflow/i);
      // idem para as medidas (numeric(10,2)) e precos
      const r2 = await rev(c, m.id);
      const eLargura = await erro(c, () => salvar(c, [{ modelo_id: m.id, rev: r2, campos: { largura_cm: 1e20 } }]));
      expect(eLargura.code).toBe("P0001");
      // valor dentro da escala continua gravando
      const r3 = await rev(c, m.id);
      const okNum = await salvar(c, [{ modelo_id: m.id, rev: r3, campos: { peso_kg: 1.234 } }]);
      expect(okNum.salvos).toBe(1);
    });
  });

  it("H2 (ruling do controlador, G-migration fix 2 · A + B-DM-2): preco_venda de COMPRADO fora da escala numeric(12,2) = P0001 PT (nunca 22003 cru)", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      // revenda: preco_venda vai para produtos_acabados.preco_varejo_fixo numeric(12,2) pelo wrapper
      // salvar_precos_fixo_produto_acabado — a checagem de escala do G3 nao cobria 'preco_venda'.
      const mRev = await revenda(c);
      const r0 = await rev(c, mRev.id);
      const eRev = await erro(c, () => salvar(c, [{ modelo_id: mRev.id, rev: r0, campos: { preco_venda: 1e20 } }]));
      expect(eRev.code).toBe("P0001");
      expect(eRev.message).not.toMatch(/numeric field overflow/i);
      // importado: mesmo caminho, produtos_importados.preco_varejo_fixo numeric(12,2)
      const mImp = await importado(c);
      const r1 = await rev(c, mImp.id);
      const eImp = await erro(c, () => salvar(c, [{ modelo_id: mImp.id, rev: r1, campos: { preco_venda: 1e20 } }]));
      expect(eImp.code).toBe("P0001");
      expect(eImp.message).not.toMatch(/numeric field overflow/i);
      // valor dentro da escala continua gravando (revenda) — preco_venda vira preco fixo, sem quebrar B1
      const r2 = await rev(c, mRev.id);
      const okRev = await salvar(c, [{ modelo_id: mRev.id, rev: r2, campos: { preco_venda: 199.9 } }]);
      expect(okRev.salvos).toBe(1);
      expect((await um<{ v: string }>(c, `SELECT preco_venda::text AS v FROM public.modelos WHERE id = $1`, [mRev.id])).v).toBe("199.90");
      // interno: preco_venda numeric SEM escala definida (modelos.preco_venda) — nao precisa de checagem por
      // faixa (fora do escopo de precisao/escala fixa), mas continua exigindo >=0 (checagem pre-existente).
      const mInt = await modeloInterno(c);
      const r3 = await rev(c, mInt.id);
      const okInt = await salvar(c, [{ modelo_id: mInt.id, rev: r3, campos: { preco_venda: 250.5 } }]);
      expect(okInt.salvos).toBe(1);
    });
  });

  it.skipIf(!MIG_TXN)("G9 (ruling do controlador, G-migration fix 1 · A-M4/B-M5): $pos$ da migration 5 confere anon em _salvar_precos_fixo_produto_importado_core e a ACL de salvar_precos_fixo_produto_importado", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      // ACL quebrada DE PROPOSITO (anon com EXECUTE na interna) — reaplicar SÓ o pos-check tem que RAISE.
      await c.query(`GRANT EXECUTE ON FUNCTION public._salvar_precos_fixo_produto_importado_core(uuid,boolean,numeric,boolean,numeric) TO anon`);
      const m5 = ler(MIGRACOES[4]);
      const posMatch = m5.match(/DO \$pos\$[\s\S]*?\$pos\$;/);
      if (!posMatch) throw new Error("pos-check da migration 5 nao encontrado no arquivo");
      await expect(c.query(posMatch[0])).rejects.toThrow(/integracao_5: ACL errada/);
    });
  });

  it.skipIf(!MIG_TXN)("G9 (ruling do controlador, G-migration fix 1): $pos$ da migration 6 confere anon nos 3 helpers internos", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await c.query(`GRANT EXECUTE ON FUNCTION public._integracao_colunas(text[]) TO anon`);
      const m6 = ler(MIGRACOES[5]);
      const posMatch = m6.match(/DO \$pos\$[\s\S]*?\$pos\$;/);
      if (!posMatch) throw new Error("pos-check da migration 6 nao encontrado no arquivo");
      await expect(c.query(posMatch[0])).rejects.toThrow(/integracao_6: .* executavel/);
    });
  });

  it.skipIf(!MIG_TXN)("G9 (ruling do controlador, G-migration fix 1): pos-check do inverso 5 confere as OUTRAS 4 funcoes e os 3 gatilhos (nao so integracao_salvar + md5)", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      // remove o DROP de _salvar_precos_fixo_produto_importado_core (uma das "outras 4" funcoes, DIFERENTE de
      // integracao_salvar) do inverso 5 — se o pos-check só olhasse integracao_salvar + o md5 do importado (o
      // bug do M4/M5), esta função sobrando passaria batido.
      const semDrop = ler(INVERSOS[4]).replace(
        /DROP FUNCTION IF EXISTS public\._salvar_precos_fixo_produto_importado_core\(uuid, boolean, numeric, boolean, numeric\);\n/,
        "",
      );
      await expect(aplicarSql(c, semTravas(semDrop, "teste-g9-inv5-funcao"), "teste-g9-inv5-funcao"))
        .rejects.toThrow(/integracao_5_down: /);
    });
  });

  it.skipIf(!MIG_TXN)("G9 (ruling do controlador, G-migration fix 1): pos-check do inverso 5 confere os 3 gatilhos da mao dupla tambem", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      // remove o DROP de trg_modelo_espelho_nome_ref (gatilho ÚNICO de fn_modelo_espelho_nome_ref, sem outro
      // gatilho dependente) E o DROP FUNCTION da mesma função (senão o DROP FUNCTION isolado falharia por
      // dependência do gatilho ainda vivo — cenário diferente do que este teste quer provar). O gatilho +
      // função ficam ambos residuais: se o pos-check só olhasse integracao_salvar + o md5 do importado, isso
      // passaria batido.
      const semDrop = ler(INVERSOS[4])
        .replace(/DROP TRIGGER IF EXISTS trg_modelo_espelho_nome_ref ON public\.modelos;\n/, "")
        .replace(/DROP FUNCTION IF EXISTS public\.fn_modelo_espelho_nome_ref\(\);\n/, "");
      await expect(aplicarSql(c, semTravas(semDrop, "teste-g9-inv5-trigger"), "teste-g9-inv5-trigger"))
        .rejects.toThrow(/integracao_5_down: /);
    });
  });

  it("gates do card no servidor (R2/V1): só Integração editar não grava nome; sem :preco_venda não grava preço; REF só revelada e antes da Explosão", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const m = await modeloInterno(c);
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce21", [["integracao", true, true]]);
      expect((await erro(c, async () => salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { nome: "x" } }]))).message)
        .toBe("integracao_sem_permissao: nome");
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce22", [["integracao", true, true], ["criacao_planejamento", true, true]]);
      expect((await erro(c, async () => salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { preco_venda: 10 } }]))).message)
        .toBe("integracao_sem_permissao: preco_venda");
      expect((await salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { nome: "Nome novo" } }])).salvos).toBe(1);
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce23", PERM_TUDO);
      expect((await erro(c, async () => salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { ref: "REFNOVA1" } }]))).message)
        .toBe("integracao_sem_permissao: ref");
      // a Loja Teste da cópia tem o Kanban automático LIGADO: desliga na txn (só pela GUC da RPC — decisão 16) p/ a etapa gravada valer
      await c.query(`SELECT set_config('app.kanban_chave', 'rpc', true)`);
      await c.query(`UPDATE public.tenant_config SET kanban_automatico = false WHERE tenant_id = $1`, [T]);
      await c.query(`UPDATE public.modelos SET ordem_criacao_enviada = true, status_desenvolvimento = 'aprovado' WHERE id = $1`, [m.id]);
      await salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { ref: "REFNOVA1" } }]);
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.modelos WHERE id = $1`, [m.id])).r).toBe("REFNOVA1");
      await c.query(`UPDATE public.modelos SET enviado_cad = true WHERE id = $1`, [m.id]);
      expect((await erro(c, async () => salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { ref: "REFNOVA2" } }]))).message)
        .toBe("integracao_sem_permissao: ref");
    });
  });

  it("revenda: preço de venda vira preço FIXO (última edição manda); nome e REF gravam nos DOIS lados (D13); REF do espelho só antes da Explosão (R2)", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const m = await revenda(c);
      await salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { preco_venda: 199, nome: "Bolsa Nova" } }]);
      // REF: o card (Sheet/Integração com a REF revelada) grava modelos.ref — o gatilho leva ao espelho na mesma txn
      await c.query(`UPDATE public.modelos SET ref = 'RVDNOVA1' WHERE id = $1`, [m.id]);
      const pa = await um<any>(c, `SELECT nome, ref, preco_varejo_fixo::text AS fixo, markup_varejo FROM public.produtos_acabados WHERE id = $1`, [m.produtoId]);
      expect(pa).toEqual({ nome: "Bolsa Nova", ref: "RVDNOVA1", fixo: "199.00", markup_varejo: null });
      expect(await um(c, `SELECT preco_venda::text AS v, nome, ref FROM public.modelos WHERE id = $1`, [m.id]))
        .toEqual({ v: "199.00", nome: "Bolsa Nova", ref: "RVDNOVA1" });
      // vice-versa: o save do Produto Acabado com OUTRO nome chega ao card
      await c.query(`UPDATE public.produtos_acabados SET nome = 'Bolsa da tela PA' WHERE id = $1`, [m.produtoId]);
      expect((await um<{ n: string }>(c, `SELECT nome AS n FROM public.modelos WHERE id = $1`, [m.id])).n).toBe("Bolsa da tela PA");
      // R2: depois do envio à Explosão, a REF do espelho NÃO chega ao card (o nome continua chegando)
      await c.query(`UPDATE public.modelos SET enviado_cad = true WHERE id = $1`, [m.id]);
      await c.query(`UPDATE public.produtos_acabados SET ref = 'RVDDEPOIS', nome = 'Bolsa pós-Explosão' WHERE id = $1`, [m.produtoId]);
      expect(await um(c, `SELECT ref, nome FROM public.modelos WHERE id = $1`, [m.id])).toEqual({ ref: "RVDNOVA1", nome: "Bolsa pós-Explosão" });
    });
  });

  it("importado: gravador de preço FIXO novo (paridade com a revenda); o SALVAR da tela grava o fixo com _rev_base (R1); nome no card (V3); markup sem fixo limpa", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const m = await importado(c);
      await salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { preco_venda: 249.9 } }]);
      expect(await um(c, `SELECT preco_varejo_fixo::text AS f, markup_varejo AS mk FROM public.produtos_importados WHERE id = $1`, [m.produtoId]))
        .toEqual({ f: "249.90", mk: null });
      expect((await um<{ v: string }>(c, `SELECT preco_venda::text AS v FROM public.modelos WHERE id = $1`, [m.id])).v).toBe("249.90");
      const vars = JSON.stringify([{ ordem: 1, cor_id: m.corId, cor_apelido_id: m.apelidoId, peso: 1, qtd: 5 }]);
      await c.query(`SELECT public.salvar_produto_importado($1, $2::jsonb, $3::jsonb, '[]'::jsonb, NULL)`,
        [m.produtoId, JSON.stringify({ nome: "Macacão Renomeado", markup_varejo: "" }), vars]);
      expect((await um<{ n: string }>(c, `SELECT nome AS n FROM public.modelos WHERE id = $1`, [m.id])).n).toBe("Macacão Renomeado");
      expect((await um<{ f: string }>(c, `SELECT preco_varejo_fixo::text AS f FROM public.produtos_importados WHERE id = $1`, [m.produtoId])).f).toBe("249.90");
      await c.query(`SELECT public.salvar_produto_importado($1, $2::jsonb, $3::jsonb, '[]'::jsonb, NULL)`,
        [m.produtoId, JSON.stringify({ nome: "Macacão Renomeado", markup_varejo: 3 }), vars]);
      expect((await um<{ f: string | null }>(c, `SELECT preco_varejo_fixo::text AS f FROM public.produtos_importados WHERE id = $1`, [m.produtoId])).f).toBeNull();
      // R1: o SALVAR da tela Importado grava o preço FIXO exato e zera o markup do canal, na transação do _rev_base
      const rv = (await um<{ r: number }>(c, `SELECT rev AS r FROM public.produtos_importados WHERE id = $1`, [m.produtoId])).r;
      await c.query(`SELECT public.salvar_produto_importado($1, $2::jsonb, $3::jsonb, '[]'::jsonb, $4)`,
        [m.produtoId, JSON.stringify({ nome: "Macacão Renomeado", markup_varejo: 3, preco_varejo_fixo: 259.9 }), vars, rv]);
      expect(await um(c, `SELECT preco_varejo_fixo::text AS f, markup_varejo AS mk FROM public.produtos_importados WHERE id = $1`, [m.produtoId]))
        .toEqual({ f: "259.90", mk: null });
      expect((await um<{ v: string }>(c, `SELECT preco_venda::text AS v FROM public.modelos WHERE id = $1`, [m.id])).v).toBe("259.90");
      const velho = await erro(c, () => c.query(`SELECT public.salvar_produto_importado($1, $2::jsonb, $3::jsonb, '[]'::jsonb, $4)`,
        [m.produtoId, JSON.stringify({ nome: "Outro", preco_varejo_fixo: 1 }), vars, rv]));
      expect(velho.code).toBe("P0409"); // _rev_base velho: nada grava
      expect((await um<{ f: string }>(c, `SELECT preco_varejo_fixo::text AS f FROM public.produtos_importados WHERE id = $1`, [m.produtoId])).f).toBe("259.90");
      const zero = await erro(c, () => c.query(`SELECT public.salvar_produto_importado($1, $2::jsonb, $3::jsonb, '[]'::jsonb, NULL)`,
        [m.produtoId, JSON.stringify({ nome: "Macacão Renomeado", preco_varejo_fixo: 0 }), vars]));
      expect(zero).toEqual({ code: "P0001", message: "O preço precisa ser maior que zero." });
      // Sheet (UPDATE direto de modelos.nome) chega ao importado
      await c.query(`UPDATE public.modelos SET nome = 'Nome do Sheet' WHERE id = $1`, [m.id]);
      expect((await um<{ n: string }>(c, `SELECT nome AS n FROM public.produtos_importados WHERE id = $1`, [m.produtoId])).n).toBe("Nome do Sheet");
    });
  });

  it("J2 (ruling do controlador, G-migration fix 3, P-91 A): apagar o preco_varejo_fixo (chave presente vazia) com o markup TAMBÉM vazio LIMPA o fixo — paridade com o Produto Acabado", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const m = await importado(c);
      const vars = JSON.stringify([{ ordem: 1, cor_id: m.corId, cor_apelido_id: m.apelidoId, peso: 1, qtd: 5 }]);
      // Grava um fixo primeiro (chave presente com número).
      await c.query(`SELECT public.salvar_produto_importado($1, $2::jsonb, $3::jsonb, '[]'::jsonb, NULL)`,
        [m.produtoId, JSON.stringify({ nome: "Macacão J2", preco_varejo_fixo: 199.9 }), vars]);
      expect(await um(c, `SELECT preco_varejo_fixo::text AS f, markup_varejo AS mk FROM public.produtos_importados WHERE id = $1`, [m.produtoId]))
        .toEqual({ f: "199.90", mk: null });
      // RED (antes do J2): apagar o Valor (chave presente e vazia) SEM markup nenhum mantinha o fixo intocado — bug
      // aceito pelo dono na P-91 A ("Importado: apagar limpa o fixo", nuance D14 do parecer G-migration). GREEN: a
      // chave presente-e-vazia agora LIMPA o fixo (NULL), igual ao Produto Acabado (front chama
      // salvar_precos_fixo_produto_acabado com _tocar_varejo=true incondicionalmente no blur, inclusive apagando).
      await c.query(`SELECT public.salvar_produto_importado($1, $2::jsonb, $3::jsonb, '[]'::jsonb, NULL)`,
        [m.produtoId, JSON.stringify({ nome: "Macacão J2", preco_varejo_fixo: "" }), vars]);
      expect(await um(c, `SELECT preco_varejo_fixo::text AS f, markup_varejo AS mk FROM public.produtos_importados WHERE id = $1`, [m.produtoId]))
        .toEqual({ f: null, mk: null });
      // Regrava o fixo e confere que markup_atacado (chave AUSENTE) segue intocado quando só o varejo é limpo.
      await c.query(`SELECT public.salvar_precos_fixo_produto_importado($1, true, 10, false, null)`, [m.produtoId]);
      await c.query(`SELECT public.salvar_produto_importado($1, $2::jsonb, $3::jsonb, '[]'::jsonb, NULL)`,
        [m.produtoId, JSON.stringify({ nome: "Macacão J2", preco_varejo_fixo: null }), vars]);
      expect(await um(c, `SELECT preco_atacado_fixo::text AS f, markup_atacado AS mk FROM public.produtos_importados WHERE id = $1`, [m.produtoId]))
        .toEqual({ f: "10.00", mk: null }); // atacado intocado (chave ausente do payload)
      expect((await um<{ f: string | null }>(c, `SELECT preco_varejo_fixo::text AS f FROM public.produtos_importados WHERE id = $1`, [m.produtoId])).f).toBeNull();
    });
  });

  it.skipIf(!MIG_TXN)("J1 (ruling do controlador, G-migration fix 3, P-90 A): backfill da REF do card — revenda e importado divergentes recebem a REF do card", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      const rv = await revenda(c);
      const im = await importado(c);
      // Diverge as REFs (card != produto) ANTES da migration 5 rodar — mesmo padrão de divergência já usado nos
      // testes de retrato/T5 (REF diferente do Produto Acabado/Importado).
      await c.query(`UPDATE public.modelos SET ref = 'RVDCARDX' WHERE id = $1`, [rv.id]);
      await c.query(`UPDATE public.modelos SET ref = 'IMPCARDX' WHERE id = $1`, [im.id]);
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.produtos_acabados WHERE id = $1`, [rv.produtoId])).r).toBe(rv.ref);
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.produtos_importados WHERE id = $1`, [im.produtoId])).r).toBe(im.ref);
      await aplica(c, MIGRACOES[4]);
      // GREEN: a REF do card (não a antiga do produto) venceu nos dois.
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.produtos_acabados WHERE id = $1`, [rv.produtoId])).r).toBe("RVDCARDX");
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.produtos_importados WHERE id = $1`, [im.produtoId])).r).toBe("IMPCARDX");
    });
  });

  it.skipIf(!MIG_TXN)("J1: card sem REF (NULL ou vazio) é pulado — o produto mantém a própria REF", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      const rv = await revenda(c);
      const im = await importado(c);
      await c.query(`UPDATE public.modelos SET ref = NULL WHERE id = $1`, [rv.id]);
      await c.query(`UPDATE public.modelos SET ref = '   ' WHERE id = $1`, [im.id]); // só espaço = vazio (btrim)
      const refPaAntes = rv.ref;
      const refPiAntes = im.ref;
      await aplica(c, MIGRACOES[4]);
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.produtos_acabados WHERE id = $1`, [rv.produtoId])).r).toBe(refPaAntes);
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.produtos_importados WHERE id = $1`, [im.produtoId])).r).toBe(refPiAntes);
    });
  });

  it.skipIf(!MIG_TXN)("J1: REF do card repetida em outro card da MESMA loja pula os DOIS produtos; a MESMA string de REF em OUTRA loja não conta como repetida (isolamento)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      const a = await revenda(c);
      const b = await revenda(c);
      const isolado = await revenda(c); // 3º produto da MESMA loja, REF única dentro dela
      const refAntesA = a.ref;
      const refAntesB = b.ref;
      // Os 2 cards da MESMA loja apontam pra REF repetida (ex. real: Ave Rara ACBO0142 = CLUTCH CHIARA/LILLY).
      await c.query(`UPDATE public.modelos SET ref = 'REPETIDA1' WHERE id = ANY($1::uuid[])`, [[a.id, b.id]]);
      await c.query(`UPDATE public.modelos SET ref = 'SOISOLADO' WHERE id = $1`, [isolado.id]);
      // Escolhe um card de OUTRA loja em tempo de execução (nunca UUID fixo; skip limpo se a cópia não tiver
      // nenhum de origem revenda com produto espelho próprio) e coloca ali a MESMA string 'REPETIDA1' que os 2
      // cards da loja de teste usam — se a checagem de repetição não fosse tenant-scoped (bug de isolamento), os
      // 2 da loja de teste continuariam pulados de qualquer forma (já são reais), mas o card ISOLADO (que não
      // repete DENTRO da própria loja) é a prova real: ele tem que ser atualizado normalmente mesmo que a string
      // 'SOISOLADO' nunca apareça em outra loja, e o card cruzado com 'REPETIDA1' de outra loja não pode
      // contaminar a decisão da loja de teste em nenhuma direção.
      const outroPa = await um<{ modelo_id: string; tenant_id: string; ref: string | null } | undefined>(c,
        `SELECT pa.modelo_id, pa.tenant_id, m.ref::text AS ref FROM public.produtos_acabados pa
           JOIN public.modelos m ON m.id = pa.modelo_id
          WHERE pa.tenant_id <> $1 ORDER BY pa.id LIMIT 1`, [T]);
      if (outroPa) {
        await c.query(`UPDATE public.modelos SET ref = 'REPETIDA1' WHERE id = $1`, [outroPa.modelo_id]);
      }
      await aplica(c, MIGRACOES[4]);
      // Os 2 da MESMA loja continuam com a REF ANTIGA do produto — ambos pulados por REF repetida (dentro da loja).
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.produtos_acabados WHERE id = $1`, [a.produtoId])).r).toBe(refAntesA);
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.produtos_acabados WHERE id = $1`, [b.produtoId])).r).toBe(refAntesB);
      // Prova de isolamento: o produto isolado da MESMA loja (REF única dentro dela) FOI atualizado normalmente —
      // a string 'REPETIDA1' usada em outra loja não interferiu na loja de teste em nenhum sentido.
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.produtos_acabados WHERE id = $1`, [isolado.produtoId])).r).toBe("SOISOLADO");
      // O backfill nunca escreve em modelos.ref (só nos produtos) — confirma que o UPDATE de setup no card de
      // outra loja não foi revertido nem tocado pelo backfill (que roda só para o tenant corrente na CTE, mas
      // como garantia extra confirmamos que o valor colocado no setup persiste intocado).
      if (outroPa) {
        const cardOutro = await um<{ r: string | null }>(c, `SELECT ref::text AS r FROM public.modelos WHERE id = $1`, [outroPa.modelo_id]);
        expect(cardOutro.r).toBe("REPETIDA1");
      }
    });
  });

  it.skipIf(!MIG_TXN)("J1: segunda ida da migration 5 atualiza 0 linhas (idempotente) — o NOTICE e o dado ficam parados", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      const rv = await revenda(c);
      await c.query(`UPDATE public.modelos SET ref = 'RVDIDEMP1' WHERE id = $1`, [rv.id]);
      await aplica(c, MIGRACOES[4]);
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.produtos_acabados WHERE id = $1`, [rv.produtoId])).r).toBe("RVDIDEMP1");
      // 2ª ida: já não há divergência (card e produto já com a mesma REF) — 0 linhas mudam. Capturamos os NOTICEs
      // do client (pg emite 'notice' no Client) para confirmar a contagem "0 atualizadas" nos dois blocos.
      const notices: string[] = [];
      const onNotice = (n: { message?: string }) => { if (n.message) notices.push(n.message); };
      c.on("notice", onNotice);
      try {
        await aplica(c, MIGRACOES[4]);
      } finally {
        c.off("notice", onNotice);
      }
      const j1Notices = notices.filter((n) => n.includes("integracao_5 J1"));
      expect(j1Notices).toHaveLength(2); // 1 para produtos_acabados, 1 para produtos_importados
      for (const n of j1Notices) expect(n).toMatch(/: 0 atualizadas,/);
      // Dado inalterado (prova independente do NOTICE, caso a captura falhe por algum motivo de driver).
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.produtos_acabados WHERE id = $1`, [rv.produtoId])).r).toBe("RVDIDEMP1");
    });
  });

  it.skipIf(!MIG_TXN)("J1: o backfill nao dispara nem e recusado por trava/gatilho do espelho — o nome do produto NAO volta para o card", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      const rv = await revenda(c);
      // Diverge REF (dispara o backfill) E nome (para provar que o backfill NUNCA copia nome nem aciona a mão
      // dupla — que ainda nem existe no schema neste ponto, m5 a cria DEPOIS do backfill no arquivo).
      await c.query(`UPDATE public.modelos SET ref = 'RVDNOMEX', nome = 'Nome do CARD' WHERE id = $1`, [rv.id]);
      await c.query(`UPDATE public.produtos_acabados SET nome = 'Nome do PRODUTO (diferente)' WHERE id = $1`, [rv.produtoId]);
      const nomeCardAntes = (await um<{ n: string }>(c, `SELECT nome::text AS n FROM public.modelos WHERE id = $1`, [rv.id])).n;
      await aplica(c, MIGRACOES[4]);
      // A REF foi atualizada (prova que o backfill rodou de verdade)...
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.produtos_acabados WHERE id = $1`, [rv.produtoId])).r).toBe("RVDNOMEX");
      // ...mas o NOME do card não mudou (o backfill só toca REF; a mão dupla de nome/ref só é criada DEPOIS do
      // backfill no arquivo da migration — não pode ter disparado retroativamente sobre um UPDATE já commitado).
      expect((await um<{ n: string }>(c, `SELECT nome::text AS n FROM public.modelos WHERE id = $1`, [rv.id])).n).toBe(nomeCardAntes);
      // fn_integracao_trava_espelho (m4, já existe neste ponto) também não recusou nem interferiu: nenhum
      // integracao_produtos foi criado nesta txn (0 linhas), então a trava sempre fez CONTINUE/early-return —
      // confirmado pelo UPDATE de REF ter passado sem erro (se a trava tivesse bloqueado, aplica() teria lançado).
      expect((await um<{ n: number }>(c, `SELECT count(*)::int AS n FROM public.integracao_produtos WHERE tenant_id = $1`, [T])).n).toBe(0);
    });
  });

  it.skipIf(!MIG_TXN)("J1 RED: com o bloco de backfill removido do arquivo, a REF divergente NAO muda (prova que o teste pega a ausência do fix)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      const rv = await revenda(c);
      await c.query(`UPDATE public.modelos SET ref = 'RVDREDTST' WHERE id = $1`, [rv.id]);
      const refAntes = rv.ref;
      // Remove o bloco DO $backfill_ref_j1$ ... $backfill_ref_j1$; inteiro do texto da migration 5 (RED: simula
      // "antes do fix" aplicando o resto da migration sem o passo de dados) — mesmo padrão de mutação de arquivo
      // já usado pelos testes "Minor #7"/G9 desta suíte (regex sobre o texto lido de disco, nunca editando o
      // arquivo em si).
      const semBackfill = ler(MIGRACOES[4]).replace(/DO \$backfill_ref_j1\$[\s\S]*?\$backfill_ref_j1\$;\n\n/, "");
      expect(semBackfill).not.toBe(ler(MIGRACOES[4])); // confere que o regex realmente casou algo
      await aplicarSql(c, semTravas(semBackfill, "teste-j1-red"), "teste-j1-red");
      // RED confirmado: sem o passo de dados, a REF divergente NÃO é corrigida (fica com o valor antigo do produto).
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.produtos_acabados WHERE id = $1`, [rv.produtoId])).r).toBe(refAntes);
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.produtos_acabados WHERE id = $1`, [rv.produtoId])).r).not.toBe("RVDREDTST");
    });
  });

  it("n5: módulo da origem desligado = gate recusa; Keywords: só admin, conferência do valor carregado (P0409 keywords_mudou)", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      await keywordsLoja(c, "antes");
      const m = await revenda(c);
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce24", PERM_TUDO);
      await c.query(`UPDATE public.tenant_config SET modules = modules || '{"produto_acabado": false}'::jsonb WHERE tenant_id = $1`, [T]);
      expect((await erro(c, async () => salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { nome: "x" } }]))).message)
        .toBe("integracao_sem_permissao: nome");
      expect((await erro(c, () => salvar(c, [], { valor: "novo", esperado: "antes" }))).message).toBe("integracao_sem_permissao: keywords");
      await comoUsuario(c, U);
      const e = await erro(c, () => salvar(c, [], { valor: "novo", esperado: "velho" }));
      expect(e).toEqual({ code: "P0409", message: "keywords_mudou: as keywords da loja mudaram" });
      await salvar(c, [], { valor: " moda, verão ", esperado: "antes" });
      expect((await um<{ k: string }>(c, `SELECT keywords AS k FROM public.tenant_config WHERE tenant_id = $1`, [T])).k).toBe("moda, verão");
    });
  });

  it("revisão T5 #1 (Important #1): REF só copia quando ELA MESMA muda — nome-only não mexe na REF; produto travado com ref_sku (sem nome) ainda renomeia", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const m = await revenda(c);
      // REFs DIVERGENTES de propósito (como os 34 pares reais achados na cópia — dados PRÉ-EXISTENTES
      // à migration 5, então nunca passaram pelos gatilhos novos). Desliga os 2 gatilhos SÓ para montar
      // esse estado inicial (senão a própria sincronização, já correta, convergeria as REFs na hora).
      await c.query(`ALTER TABLE public.produtos_acabados DISABLE TRIGGER trg_espelho_modelo_nome_ref`);
      await c.query(`ALTER TABLE public.modelos DISABLE TRIGGER trg_modelo_espelho_nome_ref`);
      await c.query(`UPDATE public.produtos_acabados SET ref = 'PADIVERGENTE' WHERE id = $1`, [m.produtoId]);
      await c.query(`UPDATE public.modelos SET ref = 'CARDDIVERGE' WHERE id = $1`, [m.id]);
      await c.query(`ALTER TABLE public.produtos_acabados ENABLE TRIGGER trg_espelho_modelo_nome_ref`);
      await c.query(`ALTER TABLE public.modelos ENABLE TRIGGER trg_modelo_espelho_nome_ref`);
      // rename SÓ NOME pelo card: a REF de NENHUM dos 2 lados muda.
      await salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { nome: "Bolsa Renomeada" } }]);
      expect(await um(c, `SELECT nome, ref FROM public.modelos WHERE id = $1`, [m.id]))
        .toEqual({ nome: "Bolsa Renomeada", ref: "CARDDIVERGE" });
      expect(await um(c, `SELECT nome, ref FROM public.produtos_acabados WHERE id = $1`, [m.produtoId]))
        .toEqual({ nome: "Bolsa Renomeada", ref: "PADIVERGENTE" });
      // rename SÓ NOME pelo PA: idem, a REF de nenhum dos 2 lados muda.
      await c.query(`UPDATE public.produtos_acabados SET nome = 'Bolsa da tela PA' WHERE id = $1`, [m.produtoId]);
      expect(await um(c, `SELECT nome, ref FROM public.modelos WHERE id = $1`, [m.id]))
        .toEqual({ nome: "Bolsa da tela PA", ref: "CARDDIVERGE" });
      expect(await um(c, `SELECT nome, ref FROM public.produtos_acabados WHERE id = $1`, [m.produtoId]))
        .toEqual({ nome: "Bolsa da tela PA", ref: "PADIVERGENTE" });
      // AGORA uma mudança REAL de REF pelo card propaga (REFs ainda divergentes, mas dessa vez ELA mudou).
      await c.query(`UPDATE public.modelos SET ref = 'CARDNOVAREF' WHERE id = $1`, [m.id]);
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.produtos_acabados WHERE id = $1`, [m.produtoId])).r).toBe("CARDNOVAREF");
      // produto TRAVADO (integrável) com ref_sku marcado mas nome NÃO marcado: um rename SÓ do nome não deve
      // mais recusar com integracao_travado: ref_sku (a REF não é mais tocada de carona pelo gatilho).
      // resíduos T7 #7 (T5 N1): m2 precisa nascer GENUINAMENTE divergente (REF do card != REF do espelho) —
      // um UPDATE simples em modelos.ref (mudança REAL) já dispara a sincronização e CONVERGE as REFs na hora
      // (o próprio comportamento provado acima, linhas 217-219), tornando o teste abaixo vacuamente verdadeiro
      // (refM2 seria lido DEPOIS de já convergido). Mesmo padrão de DISABLE/ENABLE TRIGGER usado para 'm' acima.
      const m2 = await revenda(c);
      await c.query(`ALTER TABLE public.produtos_acabados DISABLE TRIGGER trg_espelho_modelo_nome_ref`);
      await c.query(`ALTER TABLE public.modelos DISABLE TRIGGER trg_modelo_espelho_nome_ref`);
      await c.query(`UPDATE public.produtos_acabados SET ref = 'PA2DIVERGENTE' WHERE id = $1`, [m2.produtoId]);
      await c.query(`UPDATE public.modelos SET ref = 'CARD2REF' WHERE id = $1`, [m2.id]);
      await c.query(`ALTER TABLE public.produtos_acabados ENABLE TRIGGER trg_espelho_modelo_nome_ref`);
      await c.query(`ALTER TABLE public.modelos ENABLE TRIGGER trg_modelo_espelho_nome_ref`);
      const refM2 = (await um<{ r: string }>(c, `SELECT ref AS r FROM public.modelos WHERE id = $1`, [m2.id])).r;
      expect(refM2).toBe("CARD2REF");
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.produtos_acabados WHERE id = $1`, [m2.produtoId])).r).toBe("PA2DIVERGENTE");
      await c.query(
        `INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos, retrato, assinatura, marcado_em)
         VALUES ($1, $2, 'integravel', ARRAY['ref_sku']::text[], jsonb_build_object('linhas', '[]'::jsonb), 'x', now())`,
        [T, m2.id],
      );
      // rename só do nome, direto na tabela do espelho (como o Sheet/ProdutoAcabadoSheet faria) — não deve estourar
      // MESMO com as REFs genuinamente divergentes (a REF não é tocada de carona pelo gatilho — fix T5 #1).
      await c.query(`UPDATE public.produtos_acabados SET nome = 'Nome Renomeado Sem Tocar REF' WHERE id = $1`, [m2.produtoId]);
      expect((await um<{ n: string }>(c, `SELECT nome AS n FROM public.modelos WHERE id = $1`, [m2.id])).n).toBe("Nome Renomeado Sem Tocar REF");
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.modelos WHERE id = $1`, [m2.id])).r).toBe(refM2);
      // as REFs SEGUEM divergentes depois do rename só-de-nome (prova de que o teste não estava mascarando
      // convergência já tendo acontecido — refM2 é a REF genuína, não uma que já tinha sido sincronizada).
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.produtos_acabados WHERE id = $1`, [m2.produtoId])).r).toBe("PA2DIVERGENTE");
    });
  });

  it("revisão T5 #2 (Important #1 parte 2): retrato ganha falta 'REF diferente do Produto Acabado/Importado' quando ref_sku marcado e REFs divergem", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const m = await revenda(c);
      // REFs divergentes de propósito — desliga os gatilhos da mão dupla SÓ para montar esse estado
      // (pré-existente à migration 5 nos 34 pares reais da cópia; sem isso a sincronização convergiria na hora).
      await c.query(`ALTER TABLE public.produtos_acabados DISABLE TRIGGER trg_espelho_modelo_nome_ref`);
      await c.query(`ALTER TABLE public.modelos DISABLE TRIGGER trg_modelo_espelho_nome_ref`);
      await c.query(`UPDATE public.produtos_acabados SET ref = 'PADIFERENTE' WHERE id = $1`, [m.produtoId]);
      await c.query(`UPDATE public.modelos SET ref = 'CARDDIFERENTE' WHERE id = $1`, [m.id]);
      await c.query(`ALTER TABLE public.produtos_acabados ENABLE TRIGGER trg_espelho_modelo_nome_ref`);
      await c.query(`ALTER TABLE public.modelos ENABLE TRIGGER trg_modelo_espelho_nome_ref`);
      const r1 = (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [m.id])).r;
      const faltasRef1 = r1.produtos[0].faltas.filter((f: any) => f.campo === "ref_sku");
      expect(faltasRef1.some((f: any) => f.texto === "REF diferente do Produto Acabado")).toBe(true);
      // igualando as REFs (mudança REAL de REF pelo PA, propaga e converge — a falta some).
      await c.query(`UPDATE public.produtos_acabados SET ref = 'CARDDIFERENTE' WHERE id = $1`, [m.produtoId]);
      const r2 = (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [m.id])).r;
      expect(r2.produtos[0].faltas.some((f: any) => f.campo === "ref_sku" && f.texto?.startsWith("REF diferente"))).toBe(false);
      // importado: mesma falta, texto próprio.
      const mi = await importado(c);
      await c.query(`ALTER TABLE public.produtos_importados DISABLE TRIGGER trg_espelho_modelo_nome_ref`);
      await c.query(`ALTER TABLE public.modelos DISABLE TRIGGER trg_modelo_espelho_nome_ref`);
      await c.query(`UPDATE public.produtos_importados SET ref = 'PIDIFERENTE' WHERE id = $1`, [mi.produtoId]);
      await c.query(`UPDATE public.modelos SET ref = 'CARDDIFIMP' WHERE id = $1`, [mi.id]);
      await c.query(`ALTER TABLE public.produtos_importados ENABLE TRIGGER trg_espelho_modelo_nome_ref`);
      await c.query(`ALTER TABLE public.modelos ENABLE TRIGGER trg_modelo_espelho_nome_ref`);
      const r3 = (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [mi.id])).r;
      expect(r3.produtos[0].faltas.some((f: any) => f.campo === "ref_sku" && f.texto === "REF diferente do Produto Importado")).toBe(true);
    });
  });

  it("revisão T5 #3 (Important #2) + G-migration fix 2 #H1: tenant isolation — vínculo cruzado é RECUSADO na origem (trg_pi_modelo_tenant); dentro da mesma loja segue funcionando", async (ctx) => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const m = await importado(c);
      // ruling do controlador, G-migration fix 2 #H1 (A-d1 + B-DI-1): produtos_importados GANHOU
      // trg_pi_modelo_tenant (reusa enforce_produto_acabado_modelo_tenant, mesmo guard de produtos_acabados) —
      // o vínculo cruzado que este teste antes CRIAVA pra provar isolamento na sincronização agora é recusado
      // ANTES de chegar lá. É uma garantia mais forte que a original (a ponte cross-tenant não nasce mais),
      // então o teste passa a provar a RECUSA em si, não mais o comportamento pós-vínculo.
      const candidato = await um<{ id: string } | undefined>(c,
        `SELECT m.id FROM public.modelos m
          WHERE m.tenant_id <> $1
            AND NOT EXISTS (SELECT 1 FROM public.produtos_importados pi WHERE pi.modelo_id = m.id)
          ORDER BY m.id LIMIT 1`, [T]);
      if (!candidato) {
        ctx.skip("nenhum card de outra loja sem importado vinculado na cópia — nada para testar");
        return;
      }
      const cardDeOutraLoja = candidato.id;
      const nomeAntes = (await um<{ n: string }>(c, `SELECT nome AS n FROM public.modelos WHERE id = $1`, [cardDeOutraLoja])).n;
      const refAntes = (await um<{ r: string }>(c, `SELECT ref AS r FROM public.modelos WHERE id = $1`, [cardDeOutraLoja])).r;
      const e = await erro(c, () => c.query(`UPDATE public.produtos_importados SET modelo_id = $1 WHERE id = $2`, [cardDeOutraLoja, m.produtoId]));
      expect(e.message).toMatch(/Modelo de outra loja não pode ser vinculado aqui\./);
      // nada foi escrito no card da OUTRA loja (o vínculo nem chegou a existir).
      expect(await um(c, `SELECT nome, ref FROM public.modelos WHERE id = $1`, [cardDeOutraLoja]))
        .toEqual({ nome: nomeAntes, ref: refAntes });
      // dentro da MESMA loja a sincronização segue funcionando NORMALMENTE (o fix de isolamento não quebrou o
      // caminho são) — m já nasce vinculado ao próprio card pelo fixture importado().
      await c.query(`UPDATE public.modelos SET nome = 'Nome dentro da loja' WHERE id = $1`, [m.id]);
      expect((await um<{ n: string }>(c, `SELECT nome AS n FROM public.produtos_importados WHERE id = $1`, [m.produtoId])).n).toBe("Nome dentro da loja");
    });
  });

  it("revisão T5 #4 (Important #3, carry-forward ruling #1): rename por integracao_salvar (revenda E importado) fica byte-igual nos 2 lados; save antigo do PA dá P0409; save novo mantém", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      // revenda
      const m = await revenda(c);
      const revPaAntes = (await um<{ r: number }>(c, `SELECT rev AS r FROM public.produtos_acabados WHERE id = $1`, [m.produtoId])).r;
      await salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { nome: "Bolsa Renomeada Pela Integracao" } }]);
      expect(await um(c, `SELECT nome FROM public.modelos WHERE id = $1`, [m.id])).toEqual({ nome: "Bolsa Renomeada Pela Integracao" });
      expect(await um(c, `SELECT nome FROM public.produtos_acabados WHERE id = $1`, [m.produtoId])).toEqual({ nome: "Bolsa Renomeada Pela Integracao" });
      const r1 = (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [m.id])).r;
      expect(r1.produtos[0].faltas.some((f: any) => f.campo === "nome")).toBe(false);
      // o gatilho da mão dupla BUMPOU produtos_acabados.rev — um save do PA ainda segurando o rev de ANTES do
      // rename (o "old name" que a tela PA ainda tinha carregado) dá P0409, NUNCA reescreve o nome antigo.
      const vars = JSON.stringify([{ ordem: 1, cor_id: m.corId, cor_apelido_id: m.apelidoId, peso: 1, qtd: 5 }]);
      const dadosVelhos = JSON.stringify({ nome: "Bolsa Areia velha", qtd_total: 5 });
      const velho = await erro(c, () => c.query(`SELECT public.salvar_produto_acabado($1, $2::jsonb, $3::jsonb, $4)`,
        [m.produtoId, dadosVelhos, vars, revPaAntes]));
      expect(velho.code).toBe("P0409");
      expect(await um(c, `SELECT nome FROM public.modelos WHERE id = $1`, [m.id])).toEqual({ nome: "Bolsa Renomeada Pela Integracao" });
      expect(await um(c, `SELECT nome FROM public.produtos_acabados WHERE id = $1`, [m.produtoId])).toEqual({ nome: "Bolsa Renomeada Pela Integracao" });
      // um save do PA com o rev ATUAL e o MESMO nome novo mantém tudo igual dos 2 lados.
      const revAtual = (await um<{ r: number }>(c, `SELECT rev AS r FROM public.produtos_acabados WHERE id = $1`, [m.produtoId])).r;
      const dadosAtuais = JSON.stringify({ nome: "Bolsa Renomeada Pela Integracao", qtd_total: 5 });
      await c.query(`SELECT public.salvar_produto_acabado($1, $2::jsonb, $3::jsonb, $4)`, [m.produtoId, dadosAtuais, vars, revAtual]);
      expect(await um(c, `SELECT nome FROM public.modelos WHERE id = $1`, [m.id])).toEqual({ nome: "Bolsa Renomeada Pela Integracao" });
      expect(await um(c, `SELECT nome FROM public.produtos_acabados WHERE id = $1`, [m.produtoId])).toEqual({ nome: "Bolsa Renomeada Pela Integracao" });
      // importado: mesma prova de byte-igualdade via integracao_salvar (faltava no teste original).
      const mi = await importado(c);
      await salvar(c, [{ modelo_id: mi.id, rev: await rev(c, mi.id), campos: { nome: "Macacao Renomeado Pela Integracao" } }]);
      expect(await um(c, `SELECT nome FROM public.modelos WHERE id = $1`, [mi.id])).toEqual({ nome: "Macacao Renomeado Pela Integracao" });
      expect(await um(c, `SELECT nome FROM public.produtos_importados WHERE id = $1`, [mi.produtoId])).toEqual({ nome: "Macacao Renomeado Pela Integracao" });
    });
  });

  it("revisão T5 #5 (Minor #5): nome de comprado maior que 200 chars recusa com P0001 claro (integracao_salvar e via trigger)", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const nomeGigante = "A".repeat(201);
      const m = await revenda(c);
      const r0 = await rev(c, m.id);
      const e2 = await erro(c, async () => salvar(c, [{ modelo_id: m.id, rev: r0, campos: { nome: nomeGigante } }]));
      expect(e2).toEqual({ code: "P0001", message: "Nome muito longo para o Produto Acabado (máx. 200 caracteres)." });
      expect((await um<{ n: string }>(c, `SELECT nome AS n FROM public.modelos WHERE id = $1`, [m.id])).n).not.toBe(nomeGigante);
      // via trigger direto (ex.: Sheet gravando modelos.nome sem passar por integracao_salvar) — a sincronização
      // recusa com a mesma mensagem clara em vez de deixar o 22001 cru estourar.
      const eTrig = await erro(c, () => c.query(`UPDATE public.modelos SET nome = $1 WHERE id = $2`, [nomeGigante, m.id]));
      expect(eTrig).toEqual({ code: "P0001", message: "Nome muito longo para o Produto Acabado (máx. 200 caracteres)." });
      // importado: mesma mensagem, produto certo.
      const mi = await importado(c);
      const eImp = await erro(c, () => c.query(`UPDATE public.modelos SET nome = $1 WHERE id = $2`, [nomeGigante, mi.id]));
      expect(eImp).toEqual({ code: "P0001", message: "Nome muito longo para o Produto Importado (máx. 200 caracteres)." });
    });
  });

  it("G7 (ruling do controlador, G-migration fix 1 · A-M10): checagem de 200 chars so roda quando o NOME muda; mudar so a REF passa", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      // modelos.nome é varchar(255) mas produtos_acabados.nome é varchar(200) (contrato assimétrico, T5 #5) — um
      // card com nome > 200 SÓ existe se o INSERT em modelos (que não dispara o gatilho AFTER UPDATE) tiver esse
      // nome sem nunca ter sincronizado com o espelho ainda (espelho continua com um nome curto qualquer).
      const nomeGigante = "B".repeat(201);
      const s = Date.now().toString(36).toUpperCase();
      const ref = `RVDG7${s}`;
      const produtoId = (await um<{ id: string }>(c,
        `INSERT INTO public.produtos_acabados (tenant_id, nome, ref, valor_unitario, desconto_pct, qtd_total, markup_varejo)
         VALUES ($1, 'Nome curto', $2, 40, 0, 5, 3) RETURNING id`, [T, ref])).id;
      const modeloId = (await um<{ id: string }>(c,
        `INSERT INTO public.modelos (tenant_id, nome, ref, origem) VALUES ($1, $2, $3, 'revenda') RETURNING id`,
        [T, nomeGigante, ref])).id;
      await c.query(`UPDATE public.produtos_acabados SET modelo_id = $2 WHERE id = $1`, [produtoId, modeloId]);
      // agora muda SÓ a ref do card (nome do card continua > 200, mas NÃO mudou) — tem que passar sem tentar
      // sincronizar o nome (que estouraria varchar(200) no espelho)
      const novaRef = `RVDG7NOVA${s}`;
      await c.query(`UPDATE public.modelos SET ref = $1 WHERE id = $2`, [novaRef, modeloId]);
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.produtos_acabados WHERE id = $1`, [produtoId])).r).toBe(novaRef);
      expect((await um<{ n: string }>(c, `SELECT nome AS n FROM public.produtos_acabados WHERE id = $1`, [produtoId])).n).toBe("Nome curto");
      // controle: mudar o NOME de fato (com o nome > 200) continua recusado — o guard segue vivo
      const eNome = await erro(c, () => c.query(`UPDATE public.modelos SET nome = $1 WHERE id = $2`, [nomeGigante + "x", modeloId]));
      expect(eNome).toEqual({ code: "P0001", message: "Nome muito longo para o Produto Acabado (máx. 200 caracteres)." });
    });
  });

  it("H4 (ruling do controlador, G-migration fix 2 · A + B-DM-5): fn_espelho_modelo_nome_ref (produto -> card) so copia o NOME quando ele mesmo muda; REF-only nao mexe no nome do card", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const m = await revenda(c);
      // nomes JÁ divergentes, reproduzindo um residual real (ex.: card editado ANTES desta migration existir) sem
      // qualquer gatilho de sincronização interferir: desliga trg_espelho_modelo_nome_ref, muda SÓ modelos.nome
      // (nada re-sincroniza produtos_acabados.nome), religa o gatilho antes da parte que o teste exercita.
      await c.query(`ALTER TABLE public.produtos_acabados DISABLE TRIGGER trg_espelho_modelo_nome_ref`);
      await c.query(`ALTER TABLE public.modelos DISABLE TRIGGER trg_modelo_espelho_nome_ref`);
      await c.query(`UPDATE public.modelos SET nome = 'Nome do Card Divergente' WHERE id = $1`, [m.id]);
      await c.query(`ALTER TABLE public.produtos_acabados ENABLE TRIGGER trg_espelho_modelo_nome_ref`);
      await c.query(`ALTER TABLE public.modelos ENABLE TRIGGER trg_modelo_espelho_nome_ref`);
      const nomeCardAntes = (await um<{ n: string }>(c, `SELECT nome AS n FROM public.modelos WHERE id = $1`, [m.id])).n;
      expect(nomeCardAntes).toBe("Nome do Card Divergente");
      const nomeProdutoAntes = (await um<{ n: string }>(c, `SELECT nome AS n FROM public.produtos_acabados WHERE id = $1`, [m.produtoId])).n;
      expect(nomeProdutoAntes).not.toBe("Nome do Card Divergente"); // continua o nome ORIGINAL do fixture — nunca sincronizou
      // agora muda SÓ a REF no produto espelho — o NOME do produto não mudou.
      const novaRef = `RVDH4${Date.now().toString(36).toUpperCase()}`;
      await c.query(`UPDATE public.produtos_acabados SET ref = $1 WHERE id = $2`, [novaRef, m.produtoId]);
      // a REF propaga (regra pré-existente, R2/T5#1 — REF só antes da Explosão)
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.modelos WHERE id = $1`, [m.id])).r).toBe(novaRef);
      // mas o NOME do card NÃO foi sobrescrito "de carona" pelo UPDATE de REF — continua "Nome do Card Divergente"
      // (o bug pré-H4 gravaria o nome ORIGINAL do produto aqui, porque o UPDATE de sincronização copiava
      // nome=NEW.nome sempre que nome OU ref do trigger disparasse, mesmo com NEW.nome inalterado).
      const nomeCardDepois = (await um<{ n: string }>(c, `SELECT nome AS n FROM public.modelos WHERE id = $1`, [m.id])).n;
      expect(nomeCardDepois).toBe("Nome do Card Divergente");
      // controle: mudar o NOME de fato no produto espelho continua propagando pro card (regra normal intacta)
      await c.query(`UPDATE public.produtos_acabados SET nome = 'Nome Vindo do Produto' WHERE id = $1`, [m.produtoId]);
      expect((await um<{ n: string }>(c, `SELECT nome AS n FROM public.modelos WHERE id = $1`, [m.id])).n).toBe("Nome Vindo do Produto");
    });
  });

  it("revisão T5 #6 (Minor #6): modelo_id duplicado recusa com P0001; item sem campos é pulado (sem rev bump, sem log)", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const m = await modeloInterno(c);
      const r0 = await rev(c, m.id);
      const dup = await erro(c, () => salvar(c, [
        { modelo_id: m.id, rev: r0, campos: { ncm: "1111.11.11" } },
        { modelo_id: m.id, rev: r0, campos: { ncm: "2222.22.22" } },
      ]));
      expect(dup).toEqual({ code: "P0001", message: "Produto repetido na lista — envie cada produto uma vez só." });
      expect((await um<{ n: string }>(c, `SELECT ncm AS n FROM public.modelos WHERE id = $1`, [m.id])).n).toBe("6109.10.00");
      // item sem campo nenhum: nada muda, rev NÃO bumpa, nenhum log 'editar' novo é criado.
      const logsAntes = (await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_log WHERE modelo_id = $1 AND acao = 'editar'`, [m.id])).n;
      const out = await salvar(c, [{ modelo_id: m.id, rev: r0, campos: {} }]);
      expect(out.salvos).toBe(0);
      expect(out.revs).toEqual({});
      expect(await rev(c, m.id)).toBe(r0);
      const logsDepois = (await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_log WHERE modelo_id = $1 AND acao = 'editar'`, [m.id])).n;
      expect(logsDepois).toBe(logsAntes);
    });
  });

  it("resíduos T7 #6 (T5 N3): salvar recusa item SEM modelo_id (mensagem PRÓPRIA) e duplicata por UUID em CAIXA DIFERENTE", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const m = await modeloInterno(c);
      const r0 = await rev(c, m.id);
      // item sem modelo_id: mensagem PRÓPRIA (não "Produto repetido na lista").
      const semId = await erro(c, () => salvar(c, [{ rev: r0, campos: { ncm: "1111.11.11" } }]));
      expect(semId.code).toBe("P0001");
      expect(semId.message).not.toMatch(/repetido/);
      expect(semId.message).toBe("Envie o modelo_id de cada produto.");
      // 2 itens sem modelo_id: mesma mensagem própria (não "repetido" por acidente do count(DISTINCT NULL) = 0).
      const dois = await erro(c, () => salvar(c, [
        { rev: r0, campos: { ncm: "1111.11.11" } },
        { rev: r0, campos: { ncm: "2222.22.22" } },
      ]));
      expect(dois.message).toBe("Envie o modelo_id de cada produto.");
      // mesmo UUID em caixa alta E baixa = MESMO produto — antes do fix, count(DISTINCT text) via ->> contava
      // como 2 produtos diferentes e o duplicado passava batido (2 UPDATEs concorrentes na MESMA linha).
      const dup = await erro(c, () => salvar(c, [
        { modelo_id: m.id, rev: r0, campos: { ncm: "1111.11.11" } },
        { modelo_id: m.id.toUpperCase(), rev: r0, campos: { ncm: "2222.22.22" } },
      ]));
      expect(dup).toEqual({ code: "P0001", message: "Produto repetido na lista — envie cada produto uma vez só." });
      expect((await um<{ n: string }>(c, `SELECT ncm AS n FROM public.modelos WHERE id = $1`, [m.id])).n).toBe("6109.10.00");
    });
  });

  it("resíduos T7 #11/#12 (fix rounds 1-2, Minor 3): salvar recusa modelo_id inválido/não-string/chave desbalanceada com P0001 (nunca 22P02) — aceita sem hifen e com as 2 chaves", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const msg = "Envie o modelo_id de cada produto.";
      const semId = await modeloInterno(c);
      const casos: Array<[string, unknown]> = [
        ["'abc'", "abc"],
        ["''", ""],
        ["objeto", { a: 1 }],
        ["número", 123],
        // ruling T7 #12 (re-review round 1, Minor 3): chave DESBALANCEADA — só abrindo ou só fechando — precisa
        // continuar dando P0001, nunca o 22P02 cru que o ::uuid dá pra chaves desbalanceadas.
        ["chave-abre-só", `{${semId.id}`],
        ["chave-fecha-só", `${semId.id}}`],
      ];
      for (const [rotulo, valor] of casos) {
        const e = await erro(c, () => salvar(c, [{ modelo_id: valor, rev: 0, campos: { ncm: "1111.11.11" } }]));
        expect(e.code, rotulo).toBe("P0001");
        expect(e.message, rotulo).toBe(msg);
      }
      // formatos que o ::uuid do Postgres ACEITA (sem hifen, com as 2 chaves) precisam SEGUIR ADIANTE de verdade —
      // ruling T7 #12: a asserção antiga só checava message !== msg (um "esperava erro" de sucesso OU um 22P02
      // satisfazem igualmente); agora chama o RPC de verdade e confirma o efeito observável (ncm gravado).
      const semHifenModelo = await modeloInterno(c);
      const r0SemHifen = await rev(c, semHifenModelo.id);
      const semHifen = semHifenModelo.id.replace(/-/g, "");
      const outSemHifen = await salvar(c, [{ modelo_id: semHifen, rev: r0SemHifen, campos: { ncm: "3333.33.33" } }]);
      expect(outSemHifen.salvos).toBe(1);
      expect((await um<{ n: string }>(c, `SELECT ncm AS n FROM public.modelos WHERE id = $1`, [semHifenModelo.id])).n).toBe("3333.33.33");

      const comChavesModelo = await modeloInterno(c);
      const r0ComChaves = await rev(c, comChavesModelo.id);
      const outComChaves = await salvar(c, [{ modelo_id: `{${comChavesModelo.id}}`, rev: r0ComChaves, campos: { ncm: "4444.44.44" } }]);
      expect(outComChaves.salvos).toBe(1);
      expect((await um<{ n: string }>(c, `SELECT ncm AS n FROM public.modelos WHERE id = $1`, [comChavesModelo.id])).n).toBe("4444.44.44");
    });
  });

  it("resíduos T7 #12 (fix round 2, ruling do controlador — mesma classe, rev malformado): salvar recusa rev não-inteiro/fora do range com P0001 (nunca 22P02/22003)", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const msg = "A revisao (rev) precisa ser um numero inteiro.";
      const m = await modeloInterno(c);
      const r0 = await rev(c, m.id);
      const casos: Array<[string, unknown]> = [
        ["string 'abc'", "abc"],
        ["fracionário 1.5", 1.5],
        ["objeto", { a: 1 }],
        ["fora do range 32 bits", 3000000000],
        ["fora do range negativo", -3000000000],
      ];
      for (const [rotulo, valor] of casos) {
        const e = await erro(c, () => salvar(c, [{ modelo_id: m.id, rev: valor, campos: { ncm: "5555.55.55" } }]));
        expect(e.code, rotulo).toBe("P0001");
        expect(e.message, rotulo).toBe(msg);
      }
      // nada foi gravado por nenhuma das tentativas inválidas.
      expect((await um<{ n: string }>(c, `SELECT ncm AS n FROM public.modelos WHERE id = $1`, [m.id])).n).toBe("6109.10.00");
      // rev ausente (null) continua válido — comportamento pré-existente (P0409 se m.rev não for null, não P0001
      // deste check) — aqui bate porque r0 é o rev real, então SEM enviar rev nenhum (null) dá conflito de versão.
      const eNull = await erro(c, () => salvar(c, [{ modelo_id: m.id, rev: null, campos: { ncm: "6666.66.66" } }]));
      expect(eNull.code).toBe("P0409");
      // rev correto (inteiro válido) continua funcionando normalmente.
      const out = await salvar(c, [{ modelo_id: m.id, rev: r0, campos: { ncm: "7777.77.77" } }]);
      expect(out.salvos).toBe(1);
      expect((await um<{ n: string }>(c, `SELECT ncm AS n FROM public.modelos WHERE id = $1`, [m.id])).n).toBe("7777.77.77");
    });
  });

  it("resíduos T7 #13 (fix round 3, re-review round 2): rev inteiro escrito com decimal (5.0, 1.50e1) salva de verdade — nunca 22P02", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      // "5.0" — número inteiro escrito com parte decimal .0 (literal SQL/JSON exato, não passa por JSON.parse
      // do JS — que normalizaria pra "5" antes mesmo de sair do processo e deixaria de exercitar o bug real).
      // trg_colab_rev bumpa rev em TODA UPDATE (NEW.rev := OLD.rev + 1) — o teste sempre RELÊ o rev real depois
      // de qualquer UPDATE em vez de supor que um valor forçado por SET rev = X sobrevive.
      const m = await modeloInterno(c);
      const r1 = await rev(c, m.id);
      const out1 = await salvarRevLiteral(c, m.id, `${r1}.0`, { ncm: "1111.00.00" });
      expect(out1.salvos).toBe(1);
      expect((await um<{ n: string }>(c, `SELECT ncm AS n FROM public.modelos WHERE id = $1`, [m.id])).n).toBe("1111.00.00");
      // "1.50e1" — notação científica cujo jsonb PRESERVA o zero à direita do literal e normaliza pra "15.0"
      // (confirmado na cópia: jsonb_build_object('rev',1.50e1)->>'rev' = '15.0', com ponto — diferente de
      // '1.5e1', que normaliza sem ponto pra '15'). Aqui o rev real precisa ser EXATAMENTE 15 pra montar o
      // literal "1.50e1" (== 15) — força isso deixando o modelo chegar em rev=15 por saves sucessivos triviais
      // (cada UPDATE bem-sucedido bumpa +1 via trg_colab_rev), em vez de compor a notação a partir de um r2
      // arbitrário (que podia zerar o ponto decimal, ex.: r2=100 -> "100e1", sem "." nenhum).
      let r2 = await rev(c, m.id);
      while (r2 < 15) {
        await salvar(c, [{ modelo_id: m.id, rev: r2, campos: { ncm: "2222.00.00" } }]);
        r2 = await rev(c, m.id);
      }
      expect(r2).toBe(15);
      const out2 = await salvarRevLiteral(c, m.id, "1.50e1", { ncm: "2222.00.00" });
      expect(out2.salvos).toBe(1);
      expect((await um<{ n: string }>(c, `SELECT ncm AS n FROM public.modelos WHERE id = $1`, [m.id])).n).toBe("2222.00.00");
      // "2147483647.0" — limite superior do int32 escrito com decimal. Chegar num modelo REAL com rev exatamente
      // nesse valor não é prático (levaria 2+ bilhões de saves); em vez disso, prova que o LITERAL do limite não
      // estoura na conversão ::numeric::integer comparando contra um rev_base deliberadamente ERRADO — o
      // resultado precisa ser P0409 (conflito de versão, o caminho normal quando o rev não bate), NUNCA
      // 22003/22P02 (que indicariam que a conversão do literal em si falhou antes mesmo de chegar no IF do
      // conflito de versão).
      const m3 = await modeloInterno(c);
      const eLimite = await erro(c, () => salvarRevLiteral(c, m3.id, "2147483647.0", { ncm: "3333.00.00" }));
      expect(eLimite.code).toBe("P0409"); // rev não bate (P0409), mas NUNCA 22003/22P02 no caminho até lá
      // rev BASE errado com decimal (não bate com o real) continua dando P0409, não 22P02 — o fix não afrouxou o
      // check de conflito de versão, só o cast de um rev correto-mas-decimal.
      const eStale = await erro(c, () => salvarRevLiteral(c, m3.id, "1.0", { ncm: "4444.00.00" }));
      expect(eStale.code).toBe("P0409");
    });
  });

  it("resíduos T7 #13 (fix round 3, ruling do controlador — CONFIRMADO): rev como STRING numérica ('5') dá P0001, não mais aceito como antes", async () => {
    // ruling do controlador: rev PRECISA ser um número JSON, porque é isso que a tela manda (o valor lido do
    // banco). Antes desta frente, '5'::integer era aceito silenciosamente (cast texto->integer tolera dígitos);
    // hoje jsonb_typeof(e.x -> 'rev') <> 'number' recusa ANTES do cast — mudança de comportamento intencional,
    // registrada em desvios.md (revisão T7 #13) e no relatório como não-divulgada na rodada 2.
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const m = await modeloInterno(c);
      const r0 = await rev(c, m.id);
      const e = await erro(c, () => salvar(c, [{ modelo_id: m.id, rev: String(r0), campos: { ncm: "9999.99.99" } }]));
      expect(e.code).toBe("P0001");
      expect(e.message).toBe("A revisao (rev) precisa ser um numero inteiro.");
      expect((await um<{ n: string }>(c, `SELECT ncm AS n FROM public.modelos WHERE id = $1`, [m.id])).n).toBe("6109.10.00");
    });
  });

  it.skipIf(!MIG_TXN)("_salvar_produto_importado_core: depois = antes + SÓ o TRECHO_IMP_FIXO", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      const antes = await DEF(c, "_salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)");
      expect((await um<{ m: string }>(c, "SELECT md5($1) AS m", [antes])).m).toBe(MD5_ANTES.impCore);
      await aplica(c, "supabase/migrations/20261007140000_integracao_5_salvar.sql");
      const depois = await DEF(c, "_salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)");
      expect(depois.replace(TRECHO_IMP_FIXO, "")).toBe(antes);
    });
  });

  it.skipIf(!MIG_TXN)("inverso 5 desfaz a 5 (gatilhos/funções somem; o save do importado volta ao md5 de antes)", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await aplica(c, INVERSOS[4]);
      const r = await um<{ n: string; g: string; m: string }>(c,
        `SELECT (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('integracao_salvar',
                   'fn_modelo_espelho_nome_ref','fn_espelho_modelo_nome_ref','salvar_precos_fixo_produto_importado',
                   '_salvar_precos_fixo_produto_importado_core')) AS n,
                (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_modelo_espelho_nome_ref','trg_espelho_modelo_nome_ref')) AS g,
                md5(pg_get_functiondef('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)'::regprocedure)) AS m`);
      expect(r).toEqual({ n: "0", g: "0", m: MD5_ANTES.impCore });
    });
  });

  it.skipIf(!MIG_TXN)("inverso 5 recusa se _salvar_produto_importado_core mudou por outra frente depois da migration 5", async () => {
    // D40/revisão T1 #1 (Important #1, mesmo padrão dos inversos 1/4): simula outra frente redefinindo
    // _salvar_produto_importado_core DEPOIS da migration 5 (corpo diferente, sem TRECHO_IMP_FIXO e sem bater com o
    // "antes") — o inverso deve RECUSAR (RAISE P0001 ASCII) sem tocar em nenhum DROP/gatilho.
    await withTx(async (c) => {
      await prepara(c, 5);
      await c.query(`
        CREATE OR REPLACE FUNCTION public._salvar_produto_importado_core(_id uuid, _dados jsonb, _variantes jsonb, _etapas jsonb)
         RETURNS uuid LANGUAGE plpgsql AS $function$
        BEGIN
          -- [outra frente] corpo diferente, sem relação com o texto de antes nem com o TRECHO_IMP_FIXO.
          RETURN _id;
        END; $function$;
      `);
      await expect(aplica(c, INVERSOS[4])).rejects.toThrow(
        /integracao_5_down: _salvar_produto_importado_core mudou depois da migration 5 - refazer o inverso/,
      );
      // as funções/gatilhos da migration 5 continuam existindo (a recusa aconteceu no $guarda$, antes de qualquer DROP).
      const r = await um<{ n: boolean }>(c, `SELECT to_regprocedure('public.integracao_salvar(jsonb,jsonb)') IS NOT NULL AS n`);
      expect(r.n).toBe(true);
    });
  });
});
