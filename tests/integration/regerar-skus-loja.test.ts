/**
 * Botoes Regerar REF / Regerar SKUs - PARTE A, banco: regerar_skus_loja_previa + regerar_skus_loja_aplicar (migration 20261201120000).
 * BEGIN...ROLLBACK, SO na copia local. Pinos: (1) paginacao (cursor sem repetir/perder, limite 51 e itens > 50 recusados, pagina reenviada e
 * idempotente, sub-bloco EXCEPTION por produto); (2) mesmo helper de pulo da Parte B; previa == o que o aplicar grava (mesma assinatura).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, ehBancoLocal, withTx, um, semJwt } from "./db";
import {
  T, prepara, produto, formatoSku, geraSkus, skusNomes, skusGravados, rpc, tenta, integracao, logIntegracao, linhaIntegracao, usuario, comoJwt,
  U_COMUM, U_ADMIN, comoSistema, FMT_REF_COR_TAM,
} from "./regerar-helpers";

const RODA = hasDb && ehBancoLocal();
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261201120000_regerar_skus_loja.sql";

const previa = (c: any, apos: string | null = null, limite = 25, tenant = T) =>
  rpc(c, "public.regerar_skus_loja_previa($1::uuid, $2::uuid, $3::integer)", [tenant, apos, limite]);
const aplica = (c: any, itens: unknown, tenant = T) =>
  tenta(c, "SELECT public.regerar_skus_loja_aplicar($1::uuid, $2::jsonb) AS v", [tenant, JSON.stringify(itens)]);
const doItem = (pg: any, m: string) => (pg.itens as any[]).find((i) => i.modelo_id === m);
const envio = (...itens: any[]) => itens.map((i) => ({ modelo_id: i.modelo_id, assinatura: i.assinatura }));
/** Todas as paginas ate o fim (como o front faz): devolve os itens na ordem e o numero de paginas. */
async function todas(c: any, limite: number) {
  const itens: any[] = [];
  let apos: string | null = null;
  let paginas = 0;
  let total: number | null = null;
  for (;;) {
    const pg: any = await previa(c, apos, limite);
    paginas++;
    if (apos === null) total = pg.total_modelos;
    else expect(pg.total_modelos, "total so na 1a pagina").toBeNull();
    itens.push(...pg.itens);
    if (!pg.proximo) break;
    apos = pg.proximo;
  }
  return { itens, paginas, total };
}

/** Retrato dos cards da loja (id, rev, REF, ref_auto): a Parte A NUNCA mexe em `modelos` (so em modelo_skus). */
const retratoModelos = async (c: any) =>
  (await um<{ h: string }>(c, "SELECT md5(string_agg(id::text || ':' || rev::text || ':' || coalesce(ref, '') || ':' || coalesce(ref_auto, ''), ',' ORDER BY id)) AS h FROM public.modelos WHERE tenant_id = $1", [T])).h;

/** Produto com SKUs gravados no formato ANTIGO e a REF trocada depois: a previa mostra 'muda' (4 SKUs mudam). */
async function divergente(c: any, ref = "RGA1") {
  const k = await produto(c, { ref });
  await geraSkus(c, k.m);
  await comoSistema(c, () => c.query("UPDATE public.modelos SET ref = $2 WHERE id = $1", [k.m, `${ref}N`]));
  return k;
}

describe.skipIf(!RODA)("Regerar todos os SKUs da loja - paginacao (Review Focus 1: o teto de 8 s nao aceita a loja inteira de uma vez)", () => {
  it("cursor por id: cada produto da loja aparece UMA vez, na ordem, sem perder nenhum; total so na 1a pagina; o teto de 50 no servidor", async () => {
    await withTx(async (c) => {
      await prepara(c, "loja");
      await formatoSku(c);
      for (let i = 0; i < 7; i++) await produto(c, { ref: `RGP${i}` });
      const ids = (await c.query("SELECT id FROM public.modelos WHERE tenant_id = $1 ORDER BY id", [T])).rows.map((r: any) => r.id);
      const r3 = await todas(c, 3);
      expect(r3.itens.map((i) => i.modelo_id)).toEqual(ids);
      expect(r3.total).toBe(ids.length);
      expect(r3.paginas).toBe(Math.ceil(ids.length / 3));
      const r50 = await todas(c, 50);
      expect(r50.itens.map((i) => i.modelo_id)).toEqual(ids); // pagina grande = mesmo resultado
      expect((await previa(c, null, 3)).itens).toHaveLength(3);
      for (const ruim of [51, 0, -1, 1000]) {
        const r = await tenta(c, "SELECT public.regerar_skus_loja_previa($1::uuid, NULL, $2::integer) AS v", [T, ruim]);
        expect(r, `limite ${ruim}`).toMatchObject({ ok: false, code: "P0001" });
        expect((r as any).msg).toMatch(/^limite_pagina:/);
      }
    });
  });

  it("_itens: mais de 50, vazio, repetido, forma errada ou nao-array = P0001 itens_invalidos (nada e gravado)", async () => {
    await withTx(async (c) => {
      await prepara(c, "loja");
      const ok = { modelo_id: "00000000-0000-4000-8000-000000000001", assinatura: "a".repeat(32) };
      const muitos = Array.from({ length: 51 }, (_, i) => ({ modelo_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, assinatura: "a".repeat(32) }));
      const casos: [string, unknown][] = [
        ["51 itens", muitos], ["vazio", []], ["repetido", [ok, ok]], ["sem assinatura", [{ modelo_id: ok.modelo_id }]],
        ["id nao-uuid", [{ modelo_id: "xyz", assinatura: "a".repeat(32) }]], ["nao-array", { modelo_id: ok.modelo_id }], ["null", null],
      ];
      for (const [nome, itens] of casos) {
        const r = await aplica(c, itens);
        expect(r, nome).toMatchObject({ ok: false, code: "P0001" });
        expect((r as any).msg, nome).toMatch(/^itens_invalidos:/);
      }
      const cinquenta = muitos.slice(0, 50); // exatamente 50 e aceito (so ha produto inexistente: vira 'pulado', nao erro de forma)
      const r50 = await aplica(c, cinquenta);
      expect(r50.ok, JSON.stringify(r50)).toBe(true);
      expect((r50 as any).rows[0].v.pulados).toBe(50);
    });
  });

  it("sem Formato do SKU (sku_config nulo ou partes = []): formato_ok=false e itens vazio, mesmo com produtos", async () => {
    await withTx(async (c) => {
      await prepara(c, "loja");
      await produto(c, { ref: "RGS1" });
      for (const cfg of [null, { partes: [], separadores: {}, cor_no_nome: "cor_base" }]) {
        await formatoSku(c, cfg);
        const pg = await previa(c);
        expect(pg).toMatchObject({ formato_ok: false, itens: [], proximo: null });
        expect(pg.total_modelos).toBeGreaterThan(0);
      }
    });
  });
});

describe.skipIf(!RODA)("Regerar todos os SKUs da loja - previa x gravacao", () => {
  it("a previa so le; 'muda' traz contadores e linhas (variante, tamanho, antes, depois); o aplicar grava EXATAMENTE isso (mesma assinatura) e a 2a previa diz 'igual'", async () => {
    await withTx(async (c) => {
      await prepara(c, "loja");
      await formatoSku(c);
      const k = await divergente(c);
      const antes = await skusGravados(c, k.m);
      const cards = await retratoModelos(c);
      const pg = await previa(c);
      expect(await skusGravados(c, k.m)).toEqual(antes); // so leitura
      expect(await retratoModelos(c)).toBe(cards);
      const it1 = doItem(pg, k.m);
      expect(it1).toMatchObject({ estado: "muda", ref: "RGA1N", atualizados: 4, criados: 0, removidos: 0, manuais: 0, conflitos: 0, tamanho_tipo: "numero" });
      expect(it1.assinatura).toMatch(/^[0-9a-f]{32}$/);
      expect(it1.linhas).toHaveLength(4);
      expect(it1.linhas[0]).toMatchObject({ acao: "muda", sku_de: "RGA1AA34", sku_para: "RGA1NAA34", tamanho_key: "34|PPP" });
      expect(it1.linhas[0].cor_nome).toMatch(/^RG Cor A/);
      const r = await aplica(c, envio(it1));
      expect(r.ok, JSON.stringify(r)).toBe(true);
      const v = (r as any).rows[0].v;
      expect(v).toMatchObject({ gravados: 1, desatualizados: 0, pulados: 0, erros: 0 });
      expect(v.resultados[0]).toMatchObject({ modelo_id: k.m, estado: "gravado", atualizados: 4, criados: 0, removidos: 0, conflitos: 0 });
      expect(await skusNomes(c, k.m)).toEqual(["RGA1NAA34", "RGA1NAA36", "RGA1NBB34", "RGA1NBB36"]);
      expect(await retratoModelos(c)).toBe(cards); // gravar SKU nao mexe em REF/rev dos cards
      expect(doItem(await previa(c), k.m)).toMatchObject({ estado: "igual", atualizados: 0, linhas: [] });
    });
  });

  it("reenviar a MESMA pagina e idempotente (0 operacoes, mesmo estado final) - o que o front faz depois de um timeout", async () => {
    await withTx(async (c) => {
      await prepara(c, "loja");
      await formatoSku(c);
      const k = await divergente(c);
      const item = doItem(await previa(c), k.m);
      expect((await aplica(c, envio(item))).ok).toBe(true);
      const estado = await skusGravados(c, k.m);
      const de = await aplica(c, envio(item));
      expect(de.ok, JSON.stringify(de)).toBe(true);
      expect((de as any).rows[0].v.resultados[0]).toMatchObject({ estado: "gravado", criados: 0, atualizados: 0, removidos: 0 });
      expect(await skusGravados(c, k.m)).toEqual(estado);
    });
  });

  it("produto que MUDA entre a previa e o aplicar = 'desatualizado' (nao grava) e NAO derruba os outros da pagina", async () => {
    await withTx(async (c) => {
      await prepara(c, "loja");
      await formatoSku(c);
      const a = await divergente(c, "RGD1");
      const b = await divergente(c, "RGD2");
      const pg = await previa(c);
      await comoSistema(c, () => c.query("UPDATE public.cores SET sigla_sku = 'ZZ' WHERE id = $1", [a.corA])); // muda o plano de A depois da previa
      const antesA = await skusGravados(c, a.m);
      const r = await aplica(c, envio(doItem(pg, a.m), doItem(pg, b.m)));
      expect(r.ok, JSON.stringify(r)).toBe(true);
      const v = (r as any).rows[0].v;
      expect(v).toMatchObject({ gravados: 1, desatualizados: 1, pulados: 0, erros: 0 });
      expect(v.resultados.find((x: any) => x.modelo_id === a.m).estado).toBe("desatualizado");
      expect(v.resultados.find((x: any) => x.modelo_id === b.m).estado).toBe("gravado");
      expect(await skusGravados(c, a.m)).toEqual(antesA);
      expect(await skusNomes(c, b.m)).toEqual(["RGD2NAA34", "RGD2NAA36", "RGD2NBB34", "RGD2NBB36"]);
    });
  });

  it("erro FORCADO em um produto (gatilho de teste) = estado 'erro' com codigo; os outros da pagina gravam; o do erro nao fica pela metade", async () => {
    await withTx(async (c) => {
      await prepara(c, "loja");
      await formatoSku(c);
      const a = await divergente(c, "RGE1");
      const b = await divergente(c, "RGE2");
      const pg = await previa(c);
      await semJwt(c, async () => {
        await c.query(`CREATE FUNCTION public.rg_boom() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'rg_boom' USING ERRCODE = 'XX001'; END $f$`);
        await c.query(`CREATE TRIGGER rg_boom BEFORE UPDATE ON public.modelo_skus FOR EACH ROW WHEN (NEW.modelo_id = '${a.m}') EXECUTE FUNCTION public.rg_boom()`);
      });
      const antesA = await skusGravados(c, a.m);
      const r = await aplica(c, envio(doItem(pg, a.m), doItem(pg, b.m)));
      expect(r.ok, JSON.stringify(r)).toBe(true);
      const v = (r as any).rows[0].v;
      expect(v).toMatchObject({ gravados: 1, erros: 1, desatualizados: 0 });
      expect(v.resultados.find((x: any) => x.modelo_id === a.m)).toMatchObject({ estado: "erro", codigo: "XX001" });
      expect(v.resultados.find((x: any) => x.modelo_id === b.m).estado).toBe("gravado");
      expect(await skusGravados(c, a.m)).toEqual(antesA);
    });
  });

  it("contadores batem com as linhas: novos/removidos/manuais; SKU manual NUNCA muda; produto 'so conflito' nao grava e nao derruba", async () => {
    await withTx(async (c) => {
      await prepara(c, "loja");
      await formatoSku(c);
      // (1) card com um SKU manual, uma linha que sai da grade e uma que nasce
      const m1 = await divergente(c, "RGC1");
      await comoSistema(c, async () => {
        await c.query("UPDATE public.modelo_skus SET sku = 'MEU-1', manual = true WHERE modelo_id = $1 AND sku = 'RGC1AA34'", [m1.m]);
        await c.query("DELETE FROM public.modelo_skus WHERE modelo_id = $1 AND sku = 'RGC1BB36'", [m1.m]); // vira 'novo'
        await c.query(`UPDATE public.modelo_grades SET grades = '{"34|PPP": 1}'::jsonb WHERE modelo_id = $1 AND variante_numero = 2`, [m1.m]); // 36|PP da cor B sai da grade
      });
      // (2) produto de OUTRA familia com a mesma REF e os mesmos SKUs ja gravados = so conflito
      const dono = await produto(c, { ref: "RGC2" });
      await geraSkus(c, dono.m);
      const so = await produto(c, { ref: "RGC2" });
      const pg = await previa(c);
      const i1 = doItem(pg, m1.m);
      expect(i1).toMatchObject({ estado: "muda", manuais: 1 });
      expect(i1.criados + i1.atualizados + i1.removidos).toBe(i1.linhas.filter((l: any) => ["novo", "muda", "sai"].includes(l.acao)).length);
      expect(i1.linhas.every((l: any) => l.sku_para !== "MEU-1" && l.sku_de !== "MEU-1")).toBe(true); // o manual nunca entra em linha
      const iConf = doItem(pg, so.m);
      expect(iConf).toMatchObject({ estado: "conflito", criados: 0, atualizados: 0, removidos: 0, conflitos: 4 }); // conflito nao conta como SKU a gravar
      expect(iConf.linhas.filter((l: any) => l.acao === "conflito")).toHaveLength(4);
      expect(iConf.linhas[0].mensagem).toMatch(/ja existe em|já existe em/);
      expect(doItem(pg, dono.m).estado).toBe("igual");
      const r = await aplica(c, envio(i1));
      expect((r as any).rows[0].v.gravados).toBe(1);
      expect((await skusNomes(c, m1.m)).includes("MEU-1")).toBe(true);
      // forcar o envio do 'so conflito': 0 escritas e nada derruba
      const rConf = await aplica(c, envio(iConf));
      expect(rConf.ok, JSON.stringify(rConf)).toBe(true);
      expect(await skusNomes(c, so.m)).toEqual([]);
    });
  });
});

describe.skipIf(!RODA)("Regerar todos os SKUs da loja - pular (Review Focus 2: o MESMO helper da Parte B)", () => {
  it("integravel/integrado/desfeito/log/linha = 'pulado' (integracao | ja_exportado) na previa E no aplicar, sem escrever SKU; sem REF e sem Tamanho em tambem", async () => {
    await withTx(async (c) => {
      await prepara(c, "loja");
      await formatoSku(c);
      const casos: [string, (m: string) => Promise<void>, string][] = [
        ["integravel", (m) => integracao(c, m, { estado: "integravel", campos: [] }), "integracao"],
        ["integrado", (m) => integracao(c, m, { estado: "integrado", campos: ["nome"], integradoEm: true }), "integracao"],
        ["desfeito_em", (m) => integracao(c, m, { estado: "nao_integravel", desfeitoEm: true }), "ja_exportado"],
        ["log integrado", (m) => logIntegracao(c, m, "integrado"), "ja_exportado"],
        ["log desfazer", (m) => logIntegracao(c, m, "desfazer"), "ja_exportado"],
        ["so linha", (m) => linhaIntegracao(c, m), "ja_exportado"],
      ];
      const produtos: { nome: string; m: string; motivo: string; antes: any }[] = [];
      for (const [nome, marca, motivo] of casos) {
        const k = await divergente(c, `RGJ${produtos.length}`);
        const antes = await skusGravados(c, k.m);
        await marca(k.m);
        produtos.push({ nome, m: k.m, motivo, antes });
      }
      const semRef = await produto(c, { ref: null });
      const semTam = await produto(c, { ref: "RGJT", tamanhoTipo: null });
      const pg = await previa(c);
      for (const p of produtos) expect(doItem(pg, p.m), p.nome).toMatchObject({ estado: "pulado", motivo: p.motivo });
      expect(doItem(pg, semRef.m)).toMatchObject({ estado: "pulado", motivo: "sem_ref" });
      expect(doItem(pg, semTam.m)).toMatchObject({ estado: "pulado", motivo: "sem_tamanho" });
      // o aplicar re-checa: mesmo com uma assinatura 'valida' o produto marcado depois da previa NAO grava
      const fake = "a".repeat(32);
      const r = await aplica(c, produtos.map((p) => ({ modelo_id: p.m, assinatura: fake })));
      const v = (r as any).rows[0].v;
      expect(v).toMatchObject({ gravados: 0, pulados: produtos.length });
      for (const p of produtos) {
        expect(v.resultados.find((x: any) => x.modelo_id === p.m)).toMatchObject({ estado: "pulado", motivo: p.motivo });
        expect(await skusGravados(c, p.m), p.nome).toEqual(p.antes);
      }
    });
  });

  it("marcado como integravel DEPOIS da previa: o aplicar pula (o estado pode mudar entre as duas chamadas)", async () => {
    await withTx(async (c) => {
      await prepara(c, "loja");
      await formatoSku(c);
      const k = await divergente(c, "RGK1");
      const item = doItem(await previa(c), k.m);
      expect(item.estado).toBe("muda");
      await integracao(c, k.m, { estado: "integravel" });
      const antes = await skusGravados(c, k.m);
      const r = await aplica(c, envio(item));
      expect((r as any).rows[0].v.resultados[0]).toMatchObject({ estado: "pulado", motivo: "integracao" });
      expect(await skusGravados(c, k.m)).toEqual(antes);
    });
  });

  it("estatico: a decisao de pular mora SO no helper - nenhuma funcao da Parte A cita as tabelas da Integracao", async () => {
    await withTx(async (c) => {
      await prepara(c, "loja");
      const r = await c.query(
        `SELECT proname, prosrc FROM pg_proc WHERE pronamespace = 'public'::regnamespace
          AND proname IN ('_regerar_guarda_admin','_regerar_skus_item_core','regerar_skus_loja_previa','_regerar_skus_aplicar_item','regerar_skus_loja_aplicar')`,
      );
      expect(r.rows).toHaveLength(5);
      for (const f of r.rows) expect(f.prosrc, f.proname).not.toMatch(/integracao_produtos|integracao_log|integracao_linhas/);
      expect(r.rows.filter((f: any) => /_regerar_pulo_integracao/.test(f.prosrc)).map((f: any) => f.proname).sort()).toEqual(["_regerar_skus_aplicar_item", "_regerar_skus_item_core"]);
    });
  });
});

describe.skipIf(!RODA)("Regerar todos os SKUs da loja - admin, loja, ACL, auditoria", () => {
  it("so admin da loja/super: usuario comum = 42501 sem_permissao_admin; admin da loja passa; loja errada = P0001 loja_mudou; sem login = 42501", async () => {
    await withTx(async (c) => {
      await prepara(c, "loja");
      await formatoSku(c);
      await usuario(c, U_COMUM, { edita: ["criacao_planejamento", "criacao_desenvolvimento"] });
      await usuario(c, U_ADMIN, { admin: true });
      await comoJwt(c, U_COMUM);
      const comum = await tenta(c, "SELECT public.regerar_skus_loja_previa($1::uuid, NULL, 5) AS v", [T]);
      expect(comum).toMatchObject({ ok: false, code: "42501" });
      expect((comum as any).msg).toMatch(/^sem_permissao_admin:/);
      expect(await aplica(c, [{ modelo_id: "00000000-0000-4000-8000-000000000001", assinatura: "a".repeat(32) }])).toMatchObject({ ok: false, code: "42501" });
      await comoJwt(c, U_ADMIN);
      expect((await tenta(c, "SELECT public.regerar_skus_loja_previa($1::uuid, NULL, 5) AS v", [T])).ok).toBe(true);
      const outra = await tenta(c, "SELECT public.regerar_skus_loja_previa($1::uuid, NULL, 5) AS v", ["00000000-0000-4000-8000-0000000000bb"]);
      expect(outra).toMatchObject({ ok: false, code: "P0001" });
      expect((outra as any).msg).toMatch(/^loja_mudou:/);
      await c.query("SELECT set_config('request.jwt.claims', '', true)");
      expect(await tenta(c, "SELECT public.regerar_skus_loja_previa($1::uuid, NULL, 5) AS v", [T])).toMatchObject({ ok: false, code: "42501" });
    });
  });

  it("ACL: os 2 wrappers so para authenticated; helper/guarda/_core sem EXECUTE para PUBLIC/anon/authenticated", async () => {
    await withTx(async (c) => {
      await prepara(c, "loja");
      const q = (sig: string, role: string) => um<{ v: boolean }>(c, "SELECT has_function_privilege($1, $2::regprocedure, 'EXECUTE') AS v", [role, sig]).then((x) => x.v);
      for (const sig of ["public.regerar_skus_loja_previa(uuid,uuid,integer)", "public.regerar_skus_loja_aplicar(uuid,jsonb)"]) {
        expect(await q(sig, "authenticated"), sig).toBe(true);
        expect(await q(sig, "anon"), sig).toBe(false);
      }
      for (const sig of ["public._regerar_guarda_admin(uuid)", "public._regerar_skus_item_core(uuid)", "public._regerar_skus_aplicar_item(uuid,uuid,text)", "public._regerar_pulo_integracao(uuid)"]) {
        expect(await q(sig, "authenticated"), sig).toBe(false);
        expect(await q(sig, "anon"), sig).toBe(false);
      }
      const pub = await um<{ n: string }>(c, `SELECT count(*)::text AS n FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE p.proname ~ '^_?regerar_' AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'`);
      expect(pub.n).toBe("0");
    });
  });

  it("auditoria: UMA linha de audit_log por pagina GRAVADA (acao regerar_skus_loja, de/para por produto, chave com o id curto); o reenvio idempotente (0 operacoes) tambem conta como gravado e audita", async () => {
    await withTx(async (c) => {
      await prepara(c, "loja");
      await formatoSku(c);
      const a = await divergente(c, "RGU1");
      const b = await divergente(c, "RGU2");
      const pg = await previa(c);
      const n0 = await um<{ n: string }>(c, "SELECT count(*)::text AS n FROM public.audit_log WHERE acao = 'regerar_skus_loja'");
      expect((await aplica(c, envio(doItem(pg, a.m), doItem(pg, b.m)))).ok).toBe(true);
      const linhas = (await c.query("SELECT entidade, tabela, descricao, dados FROM public.audit_log WHERE acao = 'regerar_skus_loja' ORDER BY created_at DESC")).rows;
      expect(linhas.length).toBe(Number(n0.n) + 1);
      expect(linhas[0]).toMatchObject({ entidade: "SKU", tabela: "modelo_skus" });
      expect(linhas[0].descricao).toBe("Regerou os SKUs de 2 produto(s) (lote da loja)");
      const chaveA = Object.keys(linhas[0].dados).find((k) => k.endsWith(`#${a.m.slice(0, 8)}`))!;
      expect(chaveA).toMatch(/^.+ \(RGU1N\) #/);
      expect(linhas[0].dados[chaveA].de[`${(await um<{ k: string }>(c, "SELECT variante_key::text AS k FROM public.modelo_skus WHERE modelo_id = $1 AND sku = 'RGU1NAA34'", [a.m])).k}|34|PPP`]).toBe("RGU1AA34");
      // reenvio da mesma pagina (agora tudo 'igual'): a assinatura ainda confere, o produto conta como 'gravado' com 0 operacoes e a pagina audita de novo
      await aplica(c, envio(doItem(pg, a.m)));
      expect((await um<{ n: string }>(c, "SELECT count(*)::text AS n FROM public.audit_log WHERE acao = 'regerar_skus_loja'")).n).toBe(String(Number(n0.n) + 2));
    });
  });

  it("estatico: a migration e 100% ASCII, 1 BEGIN/1 COMMIT e NAO redefine o motor de SKU", () => {
    const t = readFileSync(ROOT + MIG, "utf8");
    expect(t).toMatch(/^[\x00-\x7F]*$/);
    expect(t.split("\n").filter((l) => l === "BEGIN;").length).toBe(1);
    expect(t.split("\n").filter((l) => l === "COMMIT;").length).toBe(1);
    expect(t).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.(_skus_|_aplicar_skus|skus_previa|aplicar_skus|_sku_)/);
    expect(FMT_REF_COR_TAM.partes).toContain("ref"); // o formato dos testes inclui a REF (a REF nova muda o SKU)
  });
});
