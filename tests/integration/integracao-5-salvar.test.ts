/** Integração + API — migration 5 (mão dupla + integracao_salvar). Plano Task 5. Só na cópia (N3), txn revertida. */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um } from "./db";
import { DEF, INVERSOS, LOCAL, MD5_ANTES, MIG_TXN, T, U, aplica, comoUsuarioCom, importado, keywordsLoja, modeloInterno, prepara, revenda } from "./integracao-helpers";

// D14/R1 (G-plano do plano): bloco inserido ANTES de "-- Variantes" (vale p/ INSERT e UPDATE), na transação do _rev_base.
export const TRECHO_IMP_FIXO =
  "  -- [integracao v1] D14/R1: o preço do Importado grava no SALVAR da tela, NESTA transação (a do _rev_base do wrapper).\n" +
  "  -- Preço FIXO no _dados = preço exato do canal e ZERA o markup dele; sem fixo, markup não-nulo LIMPA o fixo (\"última\n" +
  "  -- edição manda\", como a revenda — fix 2efa2ba); sem nenhum dos dois, o fixo fica (outros gravadores não mandam as chaves).\n" +
  "  if coalesce(nullif(_dados->>'preco_atacado_fixo','')::numeric, 1) <= 0\n" +
  "     or coalesce(nullif(_dados->>'preco_varejo_fixo','')::numeric, 1) <= 0 then\n" +
  "    raise exception 'O preço precisa ser maior que zero.' using errcode = 'P0001';\n" +
  "  end if;\n" +
  "  update public.produtos_importados p\n" +
  "     set preco_atacado_fixo = n.af, markup_atacado = n.am, preco_varejo_fixo = n.vf, markup_varejo = n.vm\n" +
  "    from (select\n" +
  "            case when nullif(_dados->>'preco_atacado_fixo','') is not null then (_dados->>'preco_atacado_fixo')::numeric\n" +
  "                 when nullif(_dados->>'markup_atacado','') is not null then null else x.preco_atacado_fixo end as af,\n" +
  "            case when nullif(_dados->>'preco_atacado_fixo','') is not null then null else x.markup_atacado end as am,\n" +
  "            case when nullif(_dados->>'preco_varejo_fixo','') is not null then (_dados->>'preco_varejo_fixo')::numeric\n" +
  "                 when nullif(_dados->>'markup_varejo','') is not null then null else x.preco_varejo_fixo end as vf,\n" +
  "            case when nullif(_dados->>'preco_varejo_fixo','') is not null then null else x.markup_varejo end as vm\n" +
  "            from public.produtos_importados x where x.id = v_id) n\n" +
  "   where p.id = v_id\n" +
  "     and (p.preco_atacado_fixo, p.markup_atacado, p.preco_varejo_fixo, p.markup_varejo) is distinct from (n.af, n.am, n.vf, n.vm);\n\n";

async function rev(c: Client, id: string): Promise<number> {
  return (await um<{ r: number }>(c, `SELECT rev AS r FROM public.modelos WHERE id = $1`, [id])).r;
}
async function salvar(c: Client, itens: unknown[], kw: unknown = null): Promise<any> {
  return (await um<{ r: any }>(c, `SELECT public.integracao_salvar($1::jsonb, $2::jsonb) AS r`, [JSON.stringify(itens), kw === null ? null : JSON.stringify(kw)])).r;
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

  it("revisão T5 #3 (Important #2): tenant isolation — importado de outra loja vinculado a card de outra loja não escreve cross-tenant", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const m = await importado(c);
      // Card JÁ existente de OUTRA loja na cópia — RLS de produtos_importados não valida modelo_id (só tenant_id
      // da PRÓPRIA linha), então um usuário da Loja Teste consegue apontar seu importado pra lá. resíduos T7 #3
      // (T5 N2): escolhido EM TEMPO DE EXECUÇÃO (não um UUID fixo).
      const cardDeOutraLoja = (await um<{ id: string }>(c, `SELECT id FROM public.modelos WHERE tenant_id <> $1 LIMIT 1`, [T])).id;
      const nomeAntes = (await um<{ n: string }>(c, `SELECT nome AS n FROM public.modelos WHERE id = $1`, [cardDeOutraLoja])).n;
      const refAntes = (await um<{ r: string }>(c, `SELECT ref AS r FROM public.modelos WHERE id = $1`, [cardDeOutraLoja])).r;
      await c.query(`UPDATE public.produtos_importados SET modelo_id = $1 WHERE id = $2`, [cardDeOutraLoja, m.produtoId]);
      await c.query(`UPDATE public.produtos_importados SET nome = 'Nome Vazado', ref = 'REFVAZADA' WHERE id = $1`, [m.produtoId]);
      // nada foi escrito no card da OUTRA loja.
      expect(await um(c, `SELECT nome, ref FROM public.modelos WHERE id = $1`, [cardDeOutraLoja]))
        .toEqual({ nome: nomeAntes, ref: refAntes });
      // religa o importado ao MEU card (desfaz o vínculo cross-tenant) e confirma que a sincronização segue
      // funcionando NORMALMENTE dentro da mesma loja (o fix de isolamento não quebrou o caminho são).
      await c.query(`UPDATE public.produtos_importados SET modelo_id = $1 WHERE id = $2`, [m.id, m.produtoId]);
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
