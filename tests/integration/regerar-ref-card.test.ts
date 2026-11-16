/**
 * Botoes Regerar REF / Regerar SKUs - PARTE B, banco: ref_regerar_previa + regerar_ref_card (migration 20261201110000). BEGIN...ROLLBACK, SO na
 * copia local. Pinos dos 5 pontos de revisao da spec: (2) pula integravel/integrado/exportado - inclusive integravel SEM ref_sku marcado;
 * (3) REF manual so troca com confirmacao NO SERVIDOR; (4) replica so avisa (irmaos intactos); (5) REF + SKU no MESMO passo atomico, sem consumir
 * numero; anti-drift: ref_nova == o ref_auto que o fn_modelo_ref_auto (INTOCADO) grava hoje.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, ehBancoLocal, withTx, um, semJwt, USER_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";
import {
  T, prepara, produto, formatoSku, geraSkus, skusNomes, skusGravados, forcaGatilhoRef, rpc, tenta, integracao, logIntegracao, linhaIntegracao,
  usuario, comoJwt, U_COMUM, comoSistema, DOWNS,
} from "./regerar-helpers";

const RODA = hasDb && ehBancoLocal();
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261201110000_regerar_ref_card.sql";

const previa = (c: any, m: string) => rpc(c, "public.ref_regerar_previa($1::uuid)", [m]);
/** A assinatura que a tela veria: a previa de SKUs com a REF NOVA no modo 'regerar' (o mesmo plano que o aplicar confere). */
const assinatura = (c: any, m: string, ref: string, tipo = "numero") =>
  rpc(c, "public.skus_previa($1::uuid, $2::text, $3::text, '[]'::jsonb, 'regerar')->>'assinatura'", [m, ref, tipo]);
const regera = (c: any, m: string, ref: string | null, confirma: boolean, ass: string | null) =>
  tenta(c, "SELECT public.regerar_ref_card($1::uuid, $2::text, $3::boolean, $4::text) AS v", [m, ref, confirma, ass]);
const linha = (c: any, m: string) => um<{ ref: string | null; ref_auto: string | null; rev: number }>(c, "SELECT ref, ref_auto, rev FROM public.modelos WHERE id = $1", [m]);
const contador = (c: any) => um<{ ultimo: string; updated_at: string }>(c, "SELECT ultimo::text, updated_at::text FROM public.ref_sequencia WHERE tenant_id = $1", [T]);
const refConfig = (c: any, cfg: unknown) => semJwt(c, () => c.query("UPDATE public.tenant_config SET ref_config = $2::jsonb WHERE tenant_id = $1", [T, cfg === null ? null : JSON.stringify(cfg)]));

describe.skipIf(!RODA)("Regerar REF por card - calculo (anti-drift com o fn_modelo_ref_auto)", () => {
  it("sigla pelo FALLBACK historico (loja sem Formato da REF): ref_nova == o ref_auto que o gatilho grava ao forca-lo; o numero e REAPROVEITADO", async () => {
    await withTx(async (c) => {
      await prepara(c, "ref");
      const k = await produto(c, { ref: "MANUAL1", refAuto: "XX00000042" });
      const p = await previa(c, k.m);
      expect(p).toMatchObject({ pode: true, motivo: null, ref_nova: "TOBMC00000042", tipo_ref: "manual", muda: true, ref_auto_atual: "XX00000042" });
      const g = await forcaGatilhoRef(c, k.m);
      expect(g.ref_auto).toBe(p.ref_nova); // nao discriminaria se o gatilho nao tivesse recalculado: o ref_auto semeado era XX00000042
    });
  });

  it("com Formato da REF configurado (familia+grupo+categoria+numero, 9 digitos): a largura do numero segue o Formato ATUAL e bate com o gatilho", async () => {
    await withTx(async (c) => {
      await prepara(c, "ref");
      await refConfig(c, { partes: ["familia", "grupo", "categoria", "numero"], num_digitos: 9, sigla_familia: { interno: "P" } });
      const k = await produto(c, { ref: "MANUAL1", refAuto: "XX00000042" });
      const p = await previa(c, k.m);
      expect(p.ref_nova).toBe("PTOB000000042");
      expect((await forcaGatilhoRef(c, k.m)).ref_auto).toBe(p.ref_nova);
    });
  });

  it("Formato SEM numero: ref_nova = so a sigla (o numero e descartado) e o gatilho concorda", async () => {
    await withTx(async (c) => {
      await prepara(c, "ref");
      await refConfig(c, { partes: ["grupo", "categoria"] });
      const k = await produto(c, { ref: "MANUAL1", refAuto: "XX" }); // ref_auto sem digitos: com Formato sem numero isso e normal
      const p = await previa(c, k.m);
      expect(p).toMatchObject({ pode: true, ref_nova: "TOB" });
      expect((await forcaGatilhoRef(c, k.m)).ref_auto).toBe("TOB");
    });
  });

  it("Formato COM numero e card sem numero reaproveitavel: 'sem_numero' - NAO gera numero novo (contador intacto)", async () => {
    await withTx(async (c) => {
      await prepara(c, "ref");
      const k = await produto(c, { ref: "MANUAL1", refAuto: null });
      const antes = await contador(c);
      expect(await previa(c, k.m)).toMatchObject({ pode: false, motivo: "sem_numero", ref_nova: null });
      const r = await regera(c, k.m, "QUALQUER", true, "0".repeat(32));
      expect(r).toMatchObject({ ok: false, code: "P0001" });
      expect((r as any).msg).toMatch(/^ref_sem_numero:/);
      expect(await contador(c)).toEqual(antes);
    });
  });

  it("sem sigla (categoria e sub sem nome para montar): 'sem_sigla'", async () => {
    await withTx(async (c) => {
      await prepara(c, "ref");
      const k = await produto(c, { ref: "MANUAL1", refAuto: "XX00000042", categoria: null, sub1: null });
      expect(await previa(c, k.m)).toMatchObject({ pode: false, motivo: "sem_sigla" });
    });
  });

  it("REF VAZIA: ainda nao revelavel = 'nao_revelada'; revelavel (etapa de revelar = a 1a do board) = regeravel como 'automatica'", async () => {
    await withTx(async (c) => {
      await prepara(c, "ref");
      const k = await produto(c, { ref: "", refAuto: "XX00000042", status: "desenho_tecnico" }); // 1a coluna do board da Loja Teste
      expect(await previa(c, k.m)).toMatchObject({ pode: false, motivo: "nao_revelada", tipo_ref: "automatica" });
      const primeira = await um<{ key: string }>(c, "SELECT key FROM public._kanban_status_rows($1) ORDER BY ord LIMIT 1", [T]);
      await semJwt(c, () => c.query("UPDATE public.tenant_config SET ref_exibir_status = $2 WHERE tenant_id = $1", [T, primeira.key]));
      expect(await previa(c, k.m)).toMatchObject({ pode: true, tipo_ref: "automatica", ref_nova: "TOBMC00000042", muda: true });
      await comoSistema(c, () => c.query("UPDATE public.modelos SET status_planejamento = 'reprovado' WHERE id = $1", [k.m]));
      expect(await previa(c, k.m)).toMatchObject({ pode: false, motivo: "nao_revelada" }); // reprovado nunca revela (mesmo predicado do gatilho)
    });
  });

  it("estatico: o calculo NAO chama o gerador de numero (_modelo_ref_next_num/_ref_next_global) nem o de SKU", async () => {
    await withTx(async (c) => {
      await prepara(c, "ref");
      const src = (await um<{ s: string }>(c, "SELECT prosrc AS s FROM pg_proc WHERE proname = '_regerar_ref_calcular'")).s;
      expect(src).not.toMatch(/next_num|_ref_next_global/);
      const all = (await c.query("SELECT prosrc AS s FROM pg_proc WHERE proname IN ('_regerar_ref_calcular','ref_regerar_previa','_regerar_ref_card_core','regerar_ref_card')")).rows.map((r: any) => r.s).join("\n");
      expect(all).not.toMatch(/next_num|_ref_next_global/);
      expect(all).not.toMatch(/integracao_produtos|integracao_log|integracao_linhas/); // a decisao de pular mora SO no helper (Review Focus 2)
    });
  });
});

describe.skipIf(!RODA)("Regerar REF por card - previa so leitura e gravacao atomica (REF + SKUs no mesmo passo)", () => {
  it("a previa so le: nada muda em modelos/modelo_skus; o contador de numeros fica igual", async () => {
    await withTx(async (c) => {
      await prepara(c, "ref");
      await formatoSku(c);
      const k = await produto(c, { ref: "XX00000042", refAuto: "XX00000042" });
      await geraSkus(c, k.m);
      const antes = { l: await linha(c, k.m), s: await skusGravados(c, k.m), n: await contador(c) };
      await previa(c, k.m);
      await assinatura(c, k.m, "TOBMC00000042");
      expect({ l: await linha(c, k.m), s: await skusGravados(c, k.m), n: await contador(c) }).toEqual(antes);
      expect((await um<{ v: string }>(c, "SELECT provolatile AS v FROM pg_proc WHERE proname = 'ref_regerar_previa'")).v).toBe("s"); // STABLE
    });
  });

  it("REF automatica (ref = ref_auto): grava REF + ref_auto e REGERA os SKUs na MESMA chamada; sobe o rev; contador intacto; manual preservado", async () => {
    await withTx(async (c) => {
      await prepara(c, "ref");
      await formatoSku(c);
      const k = await produto(c, { ref: "XX00000042", refAuto: "XX00000042" });
      await geraSkus(c, k.m);
      expect(await skusNomes(c, k.m)).toEqual(["XX00000042AA34", "XX00000042AA36", "XX00000042BB34", "XX00000042BB36"]);
      await comoSistema(c, () => c.query("UPDATE public.modelo_skus SET sku = 'MEU-1', manual = true WHERE modelo_id = $1 AND sku = 'XX00000042AA34'", [k.m]));
      const p = await previa(c, k.m);
      expect(p).toMatchObject({ pode: true, tipo_ref: "automatica", ref_nova: "TOBMC00000042", muda: true, irmaos: 0 });
      const antes = { l: await linha(c, k.m), n: await contador(c) };
      const ass = await assinatura(c, k.m, p.ref_nova);
      const r = await regera(c, k.m, p.ref_nova, false, ass);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      const v = (r as any).rows[0].v;
      expect(v).toMatchObject({ ref: "TOBMC00000042", ref_auto: "TOBMC00000042", atualizados: 3, criados: 0, removidos: 0, manuais: 0, conflitos: [] });
      expect(v.skus.status).toBe("ok");
      expect(await linha(c, k.m)).toMatchObject({ ref: "TOBMC00000042", ref_auto: "TOBMC00000042" });
      expect((await linha(c, k.m)).rev).toBeGreaterThan(antes.l.rev);
      expect(v.rev).toBe((await linha(c, k.m)).rev);
      expect(await skusNomes(c, k.m)).toEqual(["MEU-1", "TOBMC00000042AA36", "TOBMC00000042BB34", "TOBMC00000042BB36"]); // o manual NUNCA muda
      expect(await contador(c)).toEqual(antes.n);
      // idempotente: reenviar o MESMO pedido nao faz nada (sem rev novo)
      const rev = (await linha(c, k.m)).rev;
      expect((await regera(c, k.m, p.ref_nova, false, ass)).ok).toBe(true);
      expect((await linha(c, k.m)).rev).toBe(rev);
      expect(await previa(c, k.m)).toMatchObject({ muda: false });
    });
  });

  it("REF MANUAL: sem _confirma_manual o SERVIDOR recusa (ref_manual_confirmar) e nada muda; com a confirmacao troca", async () => {
    await withTx(async (c) => {
      await prepara(c, "ref");
      await formatoSku(c);
      const k = await produto(c, { ref: "MANUAL1", refAuto: "XX00000042" });
      await geraSkus(c, k.m);
      const p = await previa(c, k.m);
      expect(p.tipo_ref).toBe("manual");
      const ass = await assinatura(c, k.m, p.ref_nova);
      const antes = { l: await linha(c, k.m), s: await skusNomes(c, k.m) };
      const sem = await regera(c, k.m, p.ref_nova, false, ass);
      expect(sem).toMatchObject({ ok: false, code: "P0001" });
      expect((sem as any).msg).toMatch(/^ref_manual_confirmar:/);
      expect({ l: await linha(c, k.m), s: await skusNomes(c, k.m) }).toEqual(antes);
      const com = await regera(c, k.m, p.ref_nova, true, ass);
      expect(com.ok, JSON.stringify(com)).toBe(true);
      expect(await linha(c, k.m)).toMatchObject({ ref: "TOBMC00000042", ref_auto: "TOBMC00000042" });
      expect(await skusNomes(c, k.m)).toEqual(["TOBMC00000042AA34", "TOBMC00000042AA36", "TOBMC00000042BB34", "TOBMC00000042BB36"]);
    });
  });

  it("_ref_esperada velha (a categoria/Formato mudou depois da previa) = P0409 'previa_desatualizada: ref'; nada muda", async () => {
    await withTx(async (c) => {
      await prepara(c, "ref");
      await formatoSku(c);
      const k = await produto(c, { ref: "XX00000042", refAuto: "XX00000042" });
      await geraSkus(c, k.m);
      const p = await previa(c, k.m);
      const ass = await assinatura(c, k.m, p.ref_nova);
      const antes = { l: await linha(c, k.m), s: await skusNomes(c, k.m) };
      const r = await regera(c, k.m, "OUTRA-REF", true, ass);
      expect(r).toMatchObject({ ok: false, code: "P0409" });
      expect((r as any).msg).toBe("previa_desatualizada: ref");
      expect({ l: await linha(c, k.m), s: await skusNomes(c, k.m) }).toEqual(antes);
    });
  });

  it("ATOMICO: assinatura de SKU errada (ou nula) = P0409 e o UPDATE da REF NAO fica (REF, ref_auto, rev e SKUs iguais)", async () => {
    await withTx(async (c) => {
      await prepara(c, "ref");
      await formatoSku(c);
      const k = await produto(c, { ref: "XX00000042", refAuto: "XX00000042" });
      await geraSkus(c, k.m);
      const p = await previa(c, k.m);
      const antes = { l: await linha(c, k.m), s: await skusNomes(c, k.m) };
      for (const ass of ["f".repeat(32), null]) {
        const r = await regera(c, k.m, p.ref_nova, false, ass);
        expect(r).toMatchObject({ ok: false, code: "P0409" });
        expect((r as any).msg).toMatch(/^previa_desatualizada:/);
        expect({ l: await linha(c, k.m), s: await skusNomes(c, k.m) }).toEqual(antes);
      }
    });
  });

  it("so origem 'interno': revenda e recusada (nao_interno) e a REF do espelho nao e tocada", async () => {
    await withTx(async (c) => {
      await prepara(c, "ref");
      const k = await produto(c, { ref: "REV123", refAuto: "XX00000042", origem: "revenda" });
      expect(await previa(c, k.m)).toMatchObject({ pode: false, motivo: "nao_interno" });
      const r = await regera(c, k.m, "TOBMC00000042", true, "0".repeat(32));
      expect(r).toMatchObject({ ok: false, code: "P0001" });
      expect((r as any).msg).toMatch(/^ref_nao_interno:/);
      expect((await linha(c, k.m)).ref).toBe("REV123");
    });
  });

  it("PULA integravel/integrado (com OU sem ref_sku marcado) e ja exportado - na previa E na gravacao; REF e SKUs intactos, sem escrita", async () => {
    await withTx(async (c) => {
      await prepara(c, "ref");
      await formatoSku(c);
      const casos: [string, (m: string) => Promise<void>, string][] = [
        ["integravel SEM ref_sku", (m) => integracao(c, m, { estado: "integravel", campos: [] }), "pulado_integracao"],
        ["integravel COM ref_sku", (m) => integracao(c, m, { estado: "integravel", campos: ["ref_sku"] }), "pulado_integracao"],
        ["integrado", (m) => integracao(c, m, { estado: "integrado", campos: ["nome"], integradoEm: true }), "pulado_integracao"],
        ["desfeito (desfeito_em)", (m) => integracao(c, m, { estado: "nao_integravel", desfeitoEm: true }), "pulado_exportado"],
        ["log integrado", (m) => logIntegracao(c, m, "integrado"), "pulado_exportado"],
        ["log desfazer", (m) => logIntegracao(c, m, "desfazer"), "pulado_exportado"],
        ["so linha do espelho", (m) => linhaIntegracao(c, m), "pulado_exportado"],
      ];
      for (const [nome, marca, motivo] of casos) {
        const k = await produto(c, { ref: "XX00000042", refAuto: "XX00000042" });
        await geraSkus(c, k.m);
        await marca(k.m);
        const antes = { l: await linha(c, k.m), s: await skusGravados(c, k.m) };
        expect(await previa(c, k.m), nome).toMatchObject({ pode: false, motivo });
        const r = await regera(c, k.m, "TOBMC00000042", true, await assinatura(c, k.m, "TOBMC00000042"));
        expect(r, nome).toMatchObject({ ok: false, code: "P0001" });
        expect((r as any).msg, nome).toMatch(new RegExp(`^ref_${motivo}:`));
        expect({ l: await linha(c, k.m), s: await skusGravados(c, k.m) }, nome).toEqual(antes);
      }
    });
  });

  it("REPLICA so avisa: `irmaos` conta a familia e NENHUM irmao e tocado (REF, ref_auto, rev, SKUs)", async () => {
    await withTx(async (c) => {
      await prepara(c, "ref");
      await formatoSku(c);
      const base = await produto(c, { ref: "XX00000042", refAuto: "XX00000042" });
      const irma = await produto(c, { ref: "XX00000042", refAuto: "XX00000042", base: base.m });
      await geraSkus(c, base.m);
      await geraSkus(c, irma.m);
      const antesIrma = { l: await linha(c, irma.m), s: await skusGravados(c, irma.m) };
      const p = await previa(c, base.m);
      expect(p.irmaos).toBe(1);
      expect((await previa(c, irma.m)).irmaos).toBe(1); // a replica enxerga a familia pelo outro lado
      const r = await regera(c, base.m, p.ref_nova, false, await assinatura(c, base.m, p.ref_nova));
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect((await linha(c, base.m)).ref).toBe("TOBMC00000042");
      expect({ l: await linha(c, irma.m), s: await skusGravados(c, irma.m) }).toEqual(antesIrma);
    });
  });
});

describe.skipIf(!RODA)("Regerar REF por card - permissao (portao DENTRO da RPC), ACL e texto", () => {
  async function cenario(c: any) {
    await prepara(c, "ref");
    await formatoSku(c);
    const k = await produto(c, { ref: "XX00000042", refAuto: "XX00000042" });
    await geraSkus(c, k.m);
    const p = await previa(c, k.m);
    const ass = await assinatura(c, k.m, p.ref_nova);
    return { k, p, ass };
  }
  it("usuario SO do Desenvolvimento e usuario SO do Planejamento passam; sem nenhuma das duas = 42501 sem_permissao_pagina; so VER nao grava", async () => {
    await withTx(async (c) => {
      const { k, p, ass } = await cenario(c);
      await usuario(c, U_COMUM, { edita: ["criacao_desenvolvimento"] });
      await comoJwt(c, U_COMUM);
      expect((await regera(c, k.m, p.ref_nova, false, ass)).ok).toBe(true); // Dev-only: o servidor aceita (ruling 2 da spec)
      await semJwt(c, () => c.query("UPDATE public.modelos SET ref = 'XX00000042', ref_auto = 'XX00000042' WHERE id = $1", [k.m]));
      await usuario(c, U_COMUM, { edita: ["criacao_planejamento"] });
      expect((await regera(c, k.m, p.ref_nova, false, ass)).ok).toBe(true);
      await semJwt(c, () => c.query("UPDATE public.modelos SET ref = 'XX00000042', ref_auto = 'XX00000042' WHERE id = $1", [k.m]));
      await usuario(c, U_COMUM, { ve: ["criacao_planejamento", "criacao_desenvolvimento"] });
      const ve = await regera(c, k.m, p.ref_nova, false, ass);
      expect(ve).toMatchObject({ ok: false, code: "42501" });
      expect((ve as any).msg).toBe("sem_permissao_pagina: criacao_planejamento|criacao_desenvolvimento");
      expect((await previa(c, k.m)).pode).toBe(true); // mas a PREVIA (so leitura) pede so VER
      await usuario(c, U_COMUM, {});
      const nada = await regera(c, k.m, p.ref_nova, false, ass);
      expect(nada).toMatchObject({ ok: false, code: "42501" });
      expect((await tenta(c, "SELECT public.ref_regerar_previa($1::uuid) AS v", [k.m]))).toMatchObject({ ok: false, code: "42501" });
    });
  });

  it("sem oraculo: id inexistente, modelo de OUTRA loja e sem permissao dao o MESMO 42501; modulo Criacao desligado = modulo_desligado", async () => {
    await withTx(async (c) => {
      const { k, p, ass } = await cenario(c);
      await usuario(c, U_COMUM, { edita: ["criacao_planejamento", "criacao_desenvolvimento"] });
      await comoJwt(c, U_COMUM);
      const inexistente = await regera(c, "00000000-0000-4000-8000-00000000dead", p.ref_nova, false, ass);
      const outraLoja = await um<{ id: string }>(c, "SELECT id FROM public.modelos WHERE tenant_id <> $1 LIMIT 1", [T]);
      const dela = await regera(c, outraLoja.id, p.ref_nova, false, ass);
      expect(inexistente).toMatchObject({ ok: false, code: "42501" });
      expect(dela).toMatchObject({ ok: false, code: "42501" });
      expect((inexistente as any).msg).toBe((dela as any).msg);
      await semJwt(c, () => c.query(`UPDATE public.tenant_config SET modules = modules || '{"criacao": false}'::jsonb WHERE tenant_id = $1`, [T]));
      const off = await regera(c, k.m, p.ref_nova, false, ass);
      expect(off).toMatchObject({ ok: false, code: "42501" });
      expect((off as any).msg).toMatch(/^modulo_desligado:/);
    });
  });

  it("ACL: wrappers so para authenticated (nunca anon/PUBLIC); o calculo e o core sem EXECUTE para PUBLIC/anon/authenticated", async () => {
    await withTx(async (c) => {
      await prepara(c, "ref");
      const q = (sig: string, role: string) => um<{ v: boolean }>(c, "SELECT has_function_privilege($1, $2::regprocedure, 'EXECUTE') AS v", [role, sig]).then((x) => x.v);
      for (const sig of ["public.ref_regerar_previa(uuid)", "public.regerar_ref_card(uuid,text,boolean,text)"]) {
        expect(await q(sig, "authenticated"), sig).toBe(true);
        expect(await q(sig, "anon"), sig).toBe(false);
      }
      for (const sig of ["public._regerar_ref_calcular(uuid)", "public._regerar_ref_card_core(uuid,text,boolean,text)"]) {
        expect(await q(sig, "authenticated"), sig).toBe(false);
        expect(await q(sig, "anon"), sig).toBe(false);
      }
      const pub = await um<{ n: string }>(c, `SELECT count(*)::text AS n FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE p.proname IN ('_regerar_ref_calcular','_regerar_ref_card_core','ref_regerar_previa','regerar_ref_card') AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'`);
      expect(pub.n).toBe("0");
    });
  });

  it("estatico: a migration e 100% ASCII (RAISE 5xx so ASCII), 1 BEGIN/1 COMMIT e NAO redefine fn_modelo_ref_auto nem o motor de SKU", () => {
    const t = readFileSync(ROOT + MIG, "utf8");
    expect(t).toMatch(/^[\x00-\x7F]*$/);
    expect(t.split("\n").filter((l) => l === "BEGIN;").length).toBe(1);
    expect(t.split("\n").filter((l) => l === "COMMIT;").length).toBe(1);
    expect(t).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.(fn_modelo_ref_auto|_skus_|_aplicar_skus|skus_previa|aplicar_skus|_sku_)/);
  });

  it("md5 das 4 funcoes novas = o declarado na migration; o _down (ida -> volta -> ida) derruba e recria sem sobra; fn_modelo_ref_auto e o motor intocados", async () => {
    await withTx(async (c) => {
      await prepara(c, "ref");
      const md5 = async (sig: string) => (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
      const novas: [string, string][] = [
        ["public._regerar_ref_calcular(uuid)", "382e55959a003939511a4d680c3694ea"],
        ["public.ref_regerar_previa(uuid)", "a79248834da577bc39201794069df617"],
        ["public._regerar_ref_card_core(uuid,text,boolean,text)", "c1f0262ac0af4f84520beb6a7ea0d233"],
        ["public.regerar_ref_card(uuid,text,boolean,text)", "81f788a22e55c8dd0bd9a85417e75c22"],
      ];
      for (const [sig, esperado] of novas) expect(await md5(sig), sig).toBe(esperado);
      expect(await md5("public._aplicar_skus_modelo_core(uuid,jsonb,text,text)")).toBe("858abf9fddb6e3ffb7bcc2b0d2c419d1");
      await aplicarArquivo(c, DOWNS.ref);
      for (const [sig] of novas) expect(await md5(sig), sig).toBeNull();
      expect(await md5("public._regerar_pulo_integracao(uuid)")).not.toBeNull(); // o helper da migration 1 NAO e do _down desta
      await aplicarArquivo(c, DOWNS.ref); // 2x = no-op
      await aplicarArquivo(c, MIG);
      for (const [sig, esperado] of novas) expect(await md5(sig), sig).toBe(esperado);
      expect(await md5("public.fn_modelo_ref_auto()")).toBe("6d68b20b0e5086a9a9dc0c87a8b42c69");
    });
  });

  it("o md5 do fn_modelo_ref_auto segue o do pino de leves-l3 (INTOCADA)", async () => {
    await withTx(async (c) => {
      await prepara(c, "ref");
      const r = await um<{ m: string }>(c, "SELECT md5(pg_get_functiondef('public.fn_modelo_ref_auto()'::regprocedure)) AS m");
      expect(r.m).toBe("6d68b20b0e5086a9a9dc0c87a8b42c69");
    });
  });
});
