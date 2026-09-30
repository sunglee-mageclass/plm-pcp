/** Integração + API — migration 2 (retrato/leituras). Plano Task 2. Só na cópia (N3), txn revertida. */
import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um } from "./db";
import { aplicarSql } from "./mig-txn";
import {
  CAMPOS_PADRAO, DEF, INVERSOS, LAYOUT, LOCAL, MIG_TXN, T, U, aplica, camposLoja, comoCustoSistema, comoUsuarioCom, cor, keywordsLoja, ler, modeloInterno, prepara,
  revenda, semTravas,
} from "./integracao-helpers";

const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979"; // loja com mais modelos na cópia (medição)
type Ret = { retrato: { v: number; campos: string[]; linhas: Array<{ tipo: string; ordem: number; valores: Record<string, string | null>; fotos: string[] }> };
  faltas: Array<{ campo: string; texto: string }>; completo: boolean; meta: unknown[]; variantes_chaves: string[] | null };
/**
 * LIFO — "Cor no nome das sublinhas" (20261013100000, P-126): com ela VIVA o nome da sublinha ganha a cor (Nome + cor + tamanho).
 * Detecta pelo TEXTO vivo do retrato_core (no modo INTEGRACAO_MIG_TXN a migration 2 recria o texto de antes DENTRO da txn, mesmo
 * com a 20261013 na cópia). Devolve a cor que entra no nome da sublinha `s` (ou null = nome + tamanho, como antes).
 */
async function corNoNome(c: any, s: { valores: Record<string, string | null> }): Promise<string | null> {
  if (!(await DEF(c, "_integracao_retrato_core(uuid,text[],jsonb)")).includes("_integracao_nome_sublinha")) return null;
  const modo = (await um<{ m: string }>(c,
    `SELECT public._integracao_cor_no_nome((SELECT sku_config FROM public.tenant_config WHERE tenant_id = $1)) AS m`, [T])).m;
  return modo === "cor_apelido" ? (s.valores.cor_apelido ?? s.valores.cor_base) : s.valores.cor_base;
}
const comCor = (nome: string, cor: string | null, resto: string | null): string => [nome, cor, resto].filter(Boolean).join(" ");
async function retrato(c: any, id: string, campos: readonly string[] = CAMPOS_PADRAO): Promise<Ret> {
  return (await um<{ r: Ret }>(c,
    `SELECT public._integracao_retrato_core($1, $2::text[], (public._custo_unitario_modelos_core(ARRAY[$1::uuid]) -> $1::text)) AS r`,
    [id, campos])).r;
}

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 2: retrato", () => {
  it("interno completo: ordem fixa, formatos (D4), sublinhas P/M com SKU gravado, custo previsto, metatag = descrição", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "moda feminina, roupas");
      const m = await modeloInterno(c);
      const r = await retrato(c, m.id);
      expect(r.completo).toBe(true);
      expect(r.faltas).toEqual([]);
      expect(r.retrato.campos).toEqual([...CAMPOS_PADRAO]);
      expect(r.retrato.linhas.map((l) => l.tipo)).toEqual(["produto", "variante", "variante"]);
      const p = r.retrato.linhas[0].valores;
      expect(Object.keys(p)).toEqual(expect.arrayContaining([...CAMPOS_PADRAO]));
      expect(p).toMatchObject({
        ref_sku: m.ref, preco_anterior: "179.90", preco_venda: "159.90", peso: "0.220", ncm: "6109.10.00", preco_custo: "62.10",
        cor_base: null, cor_apelido: null, tamanho: null, titulo: "Blusa Brisa Manga Longa",
        descricao: "Blusa em viscose, manga longa.", metatag: "Blusa em viscose, manga longa.", keywords: "moda feminina, roupas",
        comprimento: "68", largura: "42", altura: "2",
      });
      const [s1, s2] = r.retrato.linhas.slice(1);
      expect(s1.valores.nome).toBe(comCor(p.nome as string, await corNoNome(c, s1), "P")); // LIFO 20261013: com a cor quando viva
      expect(s1.valores.ref_sku).toBe(`${m.ref}-P`);
      expect(s1.valores.tamanho).toBe("P");
      expect(s1.valores.cor_base).toMatch(/^Branco /);
      expect(s1.valores.cor_apelido).toMatch(/^Off-white /);
      expect(s1.valores.preco_venda).toBe("159.90");
      expect(s2.valores.tamanho).toBe("M");
      expect(r.retrato.linhas[0].fotos).toEqual([]); // foto não marcada no padrão
      expect(r.variantes_chaves).toBeNull(); // interno
    });
  });

  it("faltas: marcado vazio vira falta com o rótulo; 0 não conta; estimado não conta (D8)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, null);
      const m = await modeloInterno(c);
      // C1: custo previsto do interno é do servidor — a fixture grava "como o servidor" (comoCustoSistema)
      await comoCustoSistema(c, () => c.query(`UPDATE public.modelos SET ncm = '  ', peso_kg = 0, custo_peca_previsto = 0 WHERE id = $1`, [m.id]));
      const r = await retrato(c, m.id);
      expect(r.completo).toBe(false);
      expect(r.faltas).toEqual(expect.arrayContaining([
        { campo: "ncm", texto: "NCM" }, { campo: "peso", texto: "Peso" }, { campo: "keywords", texto: "Keywords" },
        { campo: "preco_custo", texto: "Preço de custo (o estimado não conta)" },
      ]));
    });
  });

  it("cor sem apelido = VAZIO e NÃO é falta (P-74 A); SKU faltando e 0 sublinhas são faltas", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const a = await modeloInterno(c, { semApelido: true });
      const ra = await retrato(c, a.id);
      expect(ra.retrato.linhas[1].valores.cor_apelido).toBeNull();
      expect(ra.completo).toBe(true);
      const b = await modeloInterno(c, { semSku: true });
      const rb = await retrato(c, b.id);
      expect(rb.faltas.find((f) => f.campo === "ref_sku")?.texto).toMatch(/^2 variantes sem SKU \(ex\.: Branco .+, tam\. P\)$/);
      await c.query(`DELETE FROM public.modelo_grades WHERE modelo_id = $1`, [b.id]);
      const rc = await retrato(c, b.id);
      expect(rc.faltas).toEqual(expect.arrayContaining([{ campo: "variantes", texto: "variantes cor × tamanho" }]));
      expect(rc.retrato.linhas).toHaveLength(1);
    });
  });

  it("G1 (ruling do controlador, G-migration fix 1): titulo_pagina/preco_anterior NULL = automatico (nunca cru); valor explicito continua vencendo", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      // titulo_pagina e preco_anterior NULL (automatico) — contrato da coluna (20261005100000:760/:766):
      // "NULL = automatico". O retrato tem de calcular, nunca ler cru (senão TODO produto nasce com falta).
      await c.query(`UPDATE public.modelos SET titulo_pagina = NULL, preco_anterior = NULL WHERE id = $1`, [m.id]);
      const calc = await um<{ t: string }>(c, `SELECT public._titulo_pagina_calculado(m.nome, t.nome) AS t
                                                  FROM public.modelos m JOIN public.tenants t ON t.id = m.tenant_id WHERE m.id = $1`, [m.id]);
      const r = await retrato(c, m.id);
      expect(r.retrato.linhas[0].valores.titulo).toBe(calc.t);
      expect(r.retrato.linhas[0].valores.preco_venda).toBe("159.90");
      expect(r.retrato.linhas[0].valores.preco_anterior).toBe("159.90"); // acompanha o preco de venda EFETIVO
      expect(r.faltas.find((f) => f.campo === "titulo")).toBeUndefined();
      expect(r.faltas.find((f) => f.campo === "preco_anterior")).toBeUndefined();
      expect(r.completo).toBe(true);
      // valor explicito continua vencendo nos dois (fixado a mao)
      await c.query(`UPDATE public.modelos SET titulo_pagina = 'Titulo Manual X', preco_anterior = 205.50 WHERE id = $1`, [m.id]);
      const r2 = await retrato(c, m.id);
      expect(r2.retrato.linhas[0].valores.titulo).toBe("Titulo Manual X");
      expect(r2.retrato.linhas[0].valores.preco_anterior).toBe("205.50");
      // via integracao_listar/previa (a lista/vivo tem que usar o MESMO caminho — nao pode divergir do retrato)
      await c.query(`UPDATE public.modelos SET titulo_pagina = NULL, preco_anterior = NULL WHERE id = $1`, [m.id]);
      const previa = await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [m.id]);
      const prodPrevia = previa.r.produtos[0];
      expect(prodPrevia.retrato.linhas[0].valores.titulo).toBe(calc.t);
      expect(prodPrevia.retrato.linhas[0].valores.preco_anterior).toBe("159.90");
      expect(prodPrevia.faltas.find((f: any) => f.campo === "titulo")).toBeUndefined();
      const listar = await um<{ r: any }>(c, `SELECT public.integracao_listar('todos', jsonb_build_object('busca', $1::text), 1) AS r`,
        [m.ref]);
      const prodListar = listar.r.produtos.find((p: any) => p.modelo_id === m.id);
      expect(prodListar.vivo.linhas[0].valores.titulo).toBe(calc.t);
      expect(prodListar.vivo.linhas[0].valores.preco_anterior).toBe("159.90");
      expect(prodListar.faltas.find((f: any) => f.campo === "titulo")).toBeUndefined();
    });
  });

  it("Foto marcada: fotos só na linha do produto; caminho fora de <tenant>/ = 'foto de outra loja' (nota 7)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c, { fotos: [`${T}/fotos_modelo/a.jpg`, `${T}/fotos_modelo/b.jpg`] });
      const r = await retrato(c, m.id, LAYOUT);
      expect(r.retrato.linhas[0].fotos).toEqual([`${T}/fotos_modelo/a.jpg`, `${T}/fotos_modelo/b.jpg`]);
      expect(r.retrato.linhas[1].fotos).toEqual([]);
      expect("foto" in r.retrato.linhas[0].valores).toBe(false);
      await c.query(`UPDATE public.modelos SET fotos_modelo = ARRAY['00000000-0000-0000-0000-000000000001/x.jpg'] WHERE id = $1`, [m.id]);
      expect((await retrato(c, m.id, LAYOUT)).faltas).toEqual(expect.arrayContaining([{ campo: "foto", texto: "foto de outra loja" }]));
      await c.query(`UPDATE public.modelos SET fotos_modelo = '{}' WHERE id = $1`, [m.id]);
      expect((await retrato(c, m.id, LAYOUT)).faltas).toEqual(expect.arrayContaining([{ campo: "foto", texto: "Foto do Modelo" }]));
    });
  });

  it("revenda: custo = unitário da OC/cadastro (40.00); variantes_chaves = conjunto cor+apelido do espelho", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await revenda(c);
      const r = await retrato(c, m.id);
      expect(r.retrato.linhas[0].valores.preco_custo).toBe("40.00");
      const k = await um<{ k: string }>(c, `SELECT public._sku_variante_key($1, $2)::text AS k`, [m.corId, m.apelidoId]);
      expect(r.variantes_chaves).toEqual([k.k]);
    });
  });

  it("assinatura = HMAC (64 hex), estável, muda com o dado e ≠ sha256 simples do retrato (nota 6)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      const q = `SELECT public._integracao_assinar(public._integracao_retrato_core($1, $2::text[],
                   public._custo_unitario_modelos_core(ARRAY[$1::uuid]) -> $1::text) -> 'retrato') AS a,
                 encode(extensions.digest((public._integracao_retrato_core($1, $2::text[],
                   public._custo_unitario_modelos_core(ARRAY[$1::uuid]) -> $1::text) -> 'retrato')::text, 'sha256'), 'hex') AS h`;
      const a1 = await um<{ a: string; h: string }>(c, q, [m.id, CAMPOS_PADRAO]);
      expect(a1.a).toMatch(/^[0-9a-f]{64}$/);
      expect(a1.a).not.toBe(a1.h);
      expect((await um<{ a: string }>(c, q, [m.id, CAMPOS_PADRAO])).a).toBe(a1.a);
      await c.query(`UPDATE public.modelos SET ncm = '6109.90.00' WHERE id = $1`, [m.id]);
      expect((await um<{ a: string }>(c, q, [m.id, CAMPOS_PADRAO])).a).not.toBe(a1.a);
    });
  });

  it("Minor #1 (revisão T2): ordem da assinatura é estável mesmo com 2 variantes no MESMO ordem (empate)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      // 2ª variante (cor diferente) no MESMO `ordem` da 1ª — modelo_tecido_variantes não tem UNIQUE(ordem);
      // sem o tiebreaker `, k.variante_key`, a ordem das duas sublinhas ficaria indefinida entre chamadas.
      const corId2 = await cor(c, `Preto ${m.ref}`, `X`);
      const mt = (await um<{ id: string }>(c, `SELECT id FROM public.modelo_tecidos WHERE modelo_id = $1`, [m.id])).id;
      const artigo = (await um<{ id: string }>(c, `SELECT artigo_id FROM public.modelo_tecidos WHERE id = $1`, [mt])).id;
      const vt2 = (await um<{ id: string }>(c,
        `INSERT INTO public.variantes_tecido (tenant_id, artigo_id, cor_id, cor_apelido_id, nome_variante) VALUES ($1, $2, $3, NULL, $4) RETURNING id`,
        [T, artigo, corId2, `Var2 ${m.ref}`])).id;
      await c.query(`INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1, $2, 1)`, [mt, vt2]);
      // ambas as variantes (m.corId e corId2) agora compartilham ordem=1 => compartilham a MESMA linha de
      // modelo_grades (variante_numero=1, já criada por modeloInterno via gradeESkus) => empate real no ORDER BY.
      const r1 = await retrato(c, m.id);
      const r2 = await retrato(c, m.id);
      const pares1 = r1.retrato.linhas.filter((l) => l.tipo === "variante").map((l: any) => [l.tamanho_key, l.variante_key]);
      const pares2 = r2.retrato.linhas.filter((l) => l.tipo === "variante").map((l: any) => [l.tamanho_key, l.variante_key]);
      expect(pares1).toEqual(pares2); // ESTÁVEL entre chamadas (sem o tiebreaker, empate ficaria indefinido)
      // ORDER BY é tamanho_ordem/tamanho_key primeiro, variante_key por ÚLTIMO (tiebreaker) — dentro de cada
      // tamanho_key (2 sublinhas empatadas, mesmo modelo_grades), as variante_key vêm em ordem ASCENDENTE.
      const porTamanho = new Map<string, string[]>();
      for (const [tam, vk] of pares1) porTamanho.set(tam, [...(porTamanho.get(tam) ?? []), vk]);
      for (const vks of porTamanho.values()) expect(vks).toEqual([...vks].sort());
    });
  });

  it("Minor #2 (revisão T2): assinatura falha FECHADO (RAISE P0001) se o segredo sumir", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await c.query(`DELETE FROM public.integracao_segredo WHERE id = 1`);
      await expect(
        um(c, `SELECT public._integracao_assinar(public._integracao_retrato_core($1, $2::text[],
              public._custo_unitario_modelos_core(ARRAY[$1::uuid]) -> $1::text) -> 'retrato') AS a`,
          [m.id, CAMPOS_PADRAO]),
      ).rejects.toThrow(/integracao_2: segredo ausente/);
    });
  });

  it("Minor #3 (revisão T2): valor arredondado ≤ 0 vira falta (0 < v < 0.005 não conta como preenchido)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      // peso_kg 3 casas: 0.0001 arredonda p/ "0.000" (bruto > 0, arredondado = 0) — precisa continuar sendo falta.
      await c.query(`UPDATE public.modelos SET peso_kg = 0.0001 WHERE id = $1`, [m.id]);
      const r = await retrato(c, m.id);
      expect(r.retrato.linhas[0].valores.peso).toBeNull();
      expect(r.faltas).toEqual(expect.arrayContaining([{ campo: "peso", texto: "Peso" }]));
      // 2 casas: 0.001 arredonda p/ "0.00" — mesma regra no preco_custo (usa _integracao_num com 2 casas).
      await comoCustoSistema(c, () => c.query(`UPDATE public.modelos SET peso_kg = 0.220, custo_peca_previsto = 0.001 WHERE id = $1`, [m.id]));
      const r2 = await retrato(c, m.id);
      expect(r2.retrato.linhas[0].valores.preco_custo).toBeNull();
      expect(r2.faltas).toEqual(expect.arrayContaining([{ campo: "preco_custo", texto: "Preço de custo (o estimado não conta)" }]));
    });
  });

  it("resíduos T7 #1 (T2 N1): _integracao_num(0.004,2) e _integracao_num(0.0004,3) chamados DIRETO — NULL, não '0.00'/'0.000'", async () => {
    // O teste "Minor #3" acima só prova o efeito (falta aparecendo) via a coluna do modelo — não prova o valor de
    // RETORNO da própria função nos 2 casos-limite citados no plano. Chamado direto (como postgres/service_role,
    // dono da conexão de teste — as internas têm EXECUTE revogado de PUBLIC/anon/authenticated, não do dono).
    await withTx(async (c) => {
      await prepara(c, 2);
      const r = await um<{ a: string | null; b: string | null }>(c,
        `SELECT public._integracao_num(0.004, 2) AS a, public._integracao_num(0.0004, 3) AS b`);
      expect(r).toEqual({ a: null, b: null });
    });
  });

  it("Minor #4 (revisão T2): nome da sublinha sem tamanho não deixa espaço sobrando", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      // chave de tamanho vazia ("") não resolve lado nenhum (letra/numero NULL) => v_tam fica NULL na sublinha.
      await c.query(`UPDATE public.modelo_grades SET grades = '{"": 5}'::jsonb, grade_total = 5 WHERE modelo_id = $1`, [m.id]);
      const r = await retrato(c, m.id);
      const sub = r.retrato.linhas.find((l) => l.tipo === "variante");
      expect(sub?.valores.tamanho).toBeNull();
      expect(sub?.valores.nome).toBe(comCor(r.retrato.linhas[0].valores.nome as string, await corNoNome(c, sub!), null));
      expect(sub?.valores.nome?.endsWith(" ")).toBe(false);
    });
  });

  it("resíduos T7 #2 (T2 N2): nome do produto em branco => nome da sublinha é NULL (JSON null), não o rótulo de tamanho sozinho", async () => {
    // concat_ws() descarta o lado NULL em silêncio — sem essa correção, um nome em branco (btrim => '') faria a
    // sublinha exibir só o tamanho ("P") como se fosse o "nome" do produto, em vez de admitir que falta o nome.
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await c.query(`UPDATE public.modelos SET nome = '   ' WHERE id = $1`, [m.id]);
      const r = await retrato(c, m.id);
      expect(r.retrato.linhas[0].valores.nome).toBeNull();
      const sub = r.retrato.linhas.find((l) => l.tipo === "variante");
      expect(sub?.valores.tamanho).toBe("P");
      expect(sub?.valores.nome).toBeNull();
    });
  });

  it("Minor #5 (ruling, revisão T2): 'Tamanho em' ausente vira falta quando tamanho/ref_sku estão marcados", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await c.query(`UPDATE public.modelos SET tamanho_tipo = NULL WHERE id = $1`, [m.id]);
      const r = await retrato(c, m.id);
      expect(r.faltas).toEqual(expect.arrayContaining([{ campo: "tamanho_tipo", texto: "Tamanho em" }]));
      // sem tamanho nem ref_sku marcados, a ausência de "Tamanho em" NÃO é falta.
      const r2 = await retrato(c, m.id, CAMPOS_PADRAO.filter((c2) => c2 !== "tamanho" && c2 !== "ref_sku"));
      expect(r2.faltas.find((f) => f.campo === "tamanho_tipo")).toBeUndefined();
    });
  });

  it("Minor #6 (revisão T2): segmento '..'/'.'/vazio no caminho da foto falha fechado", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      for (const caminho of [`${T}/../outra/x.jpg`, `${T}/./x.jpg`, `${T}//x.jpg`]) {
        await c.query(`UPDATE public.modelos SET fotos_modelo = ARRAY[$2::text] WHERE id = $1`, [m.id, caminho]);
        const r = await retrato(c, m.id, LAYOUT);
        expect(r.faltas).toEqual(expect.arrayContaining([{ campo: "foto", texto: "foto de outra loja" }]));
      }
    });
  });
});

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 2: RPCs de leitura", () => {
  it("previa: sem permissão = 42501; com ver e sem custos = custo mascarado e MESMA assinatura do super", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      const sup = await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [m.id]);
      expect(sup.r.produtos[0].retrato.linhas[0].valores.preco_custo).toBe("62.10");
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce01", []);
      await c.query("SAVEPOINT a");
      await expect(c.query(`SELECT public.integracao_previa(ARRAY[$1::uuid])`, [m.id])).rejects.toThrow(/Sem permissão para ver a Integração/);
      await c.query("ROLLBACK TO SAVEPOINT a");
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce02", [["integracao", true, false]]);
      const v = await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [m.id]);
      for (const l of v.r.produtos[0].retrato.linhas) expect(l.valores.preco_custo).toBeNull();
      expect(v.r.produtos[0].assinatura).toBe(sup.r.produtos[0].assinatura);
      expect(v.r.pode_ver_custos).toBe(false);
      expect(v.r.precisa_ver_custos).toBe(true);
    });
  });

  it("listar: Não integrados por padrão; reprovado some; busca por REF; gates do card campo a campo (D24)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      const rep = await modeloInterno(c);
      await c.query(`UPDATE public.modelos SET status_planejamento = 'reprovado' WHERE id = $1`, [rep.id]);
      const l = await um<{ r: any }>(c, `SELECT public.integracao_listar(NULL, jsonb_build_object('busca', $1::text), 1) AS r`, [m.ref]);
      expect(l.r.total).toBe(1);
      expect(l.r.produtos[0]).toMatchObject({ modelo_id: m.id, estado: "nao_integravel", completo: true, origem: "interno" });
      expect(l.r.produtos[0].raw).toMatchObject({ ref: m.ref, preco_venda: 159.9, ncm: "6109.10.00", tamanho_tipo: "letra" });
      expect(l.r.pode).toMatchObject({ editar: true, super: true, keywords: true });
      // J4 (ruling do controlador, G-migration fix 3): integracao_listar manda 'reprovado' (boolean) por produto —
      // mesma definição do D9. m não é reprovado.
      expect(l.r.produtos[0].reprovado).toBe(false);
      const lr = await um<{ r: any }>(c, `SELECT public.integracao_listar('todos', jsonb_build_object('busca', $1::text), 1) AS r`, [rep.ref]);
      expect(lr.r.total).toBe(0);
      // J4: um produto INTEGRAVEL reprovado continua visível (D9/G2) e a lista manda reprovado=true (selo T12a
      // "Reprovado — não vai para a API").
      const rep2 = await modeloInterno(c);
      await c.query(`UPDATE public.modelos SET status_planejamento = 'reprovado' WHERE id = $1`, [rep2.id]);
      await c.query(
        `INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos) VALUES ($1, $2, 'integravel', $3::text[])`,
        [T, rep2.id, CAMPOS_PADRAO],
      );
      const lRep2 = await um<{ r: any }>(c, `SELECT public.integracao_listar('todos', jsonb_build_object('busca', $1::text), 1) AS r`, [rep2.ref]);
      expect(lRep2.r.total).toBe(1);
      expect(lRep2.r.produtos[0]).toMatchObject({ modelo_id: rep2.id, estado: "integravel", reprovado: true });
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce03", [["integracao", true, true]]);
      // Important #1 (revisão T2): custo mascarado no `vivo` do listar, para quem NÃO vê custos.
      const semCusto = (await um<{ r: any }>(c, `SELECT public.integracao_listar(NULL, jsonb_build_object('busca', $1::text), 1) AS r`, [m.ref])).r;
      for (const l of semCusto.produtos[0].vivo.linhas) expect(l.valores.preco_custo).toBeNull();
      const g = semCusto.produtos[0].gates;
      expect(g.compartilhado).toEqual({ ok: false, motivo: "Precisa da permissão de editar o Planejamento (ou o Desenvolvimento antes do envio à Explosão)." });
      expect(g.planejamento).toEqual({ ok: false, motivo: "Precisa da permissão de editar o Planejamento." });
      expect(g.preco).toEqual({ ok: false, motivo: "Precisa da permissão de preço de venda." });
      expect(g.ref).toEqual({ ok: false, motivo: "Precisa da permissão de editar o Desenvolvimento." });
      expect(g.keywords).toEqual({ ok: false, motivo: "Só o admin da loja muda as Keywords." });

      // Important #1 (revisão T2): retrato GRAVADO com preco_custo diferente do vivo — mascarado para ce03
      // (não vê custos: retrato_difere NÃO contém 'preco_custo'), visível para U (retrato_difere CONTÉM).
      // Usa um modelo À PARTE (m2) para não travar `m` (o resto do teste depende de `m` continuar nao_integravel).
      await comoUsuario(c, U);
      const m2 = await modeloInterno(c);
      const vivoAgora = (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [m2.id])).r.produtos[0].retrato;
      const gravado = JSON.parse(JSON.stringify(vivoAgora));
      gravado.linhas[0].valores.preco_custo = "1.00";
      await c.query(
        `INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos, retrato)
         VALUES ($1, $2, 'integravel', $3::text[], $4::jsonb)`,
        [T, m2.id, CAMPOS_PADRAO, JSON.stringify(gravado)],
      );
      await comoUsuario(c, "00000000-0000-4000-8000-00000000ce03"); // já criado acima; só troca o JWT da txn, sem reinserir permissão
      const l3 = (await um<{ r: any }>(c, `SELECT public.integracao_listar('todos', jsonb_build_object('busca', $1::text), 1) AS r`, [m2.ref])).r.produtos[0];
      expect(l3.retrato.linhas[0].valores.preco_custo).toBeNull();
      expect(l3.retrato_difere).not.toContain("preco_custo");
      await comoUsuario(c, U);
      const l4 = (await um<{ r: any }>(c, `SELECT public.integracao_listar('todos', jsonb_build_object('busca', $1::text), 1) AS r`, [m2.ref])).r.produtos[0];
      expect(l4.retrato_difere).toContain("preco_custo");
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce04", [["integracao", true, true], ["criacao_planejamento", true, true],
        ["criacao_planejamento:preco_venda", true, true], ["criacao_desenvolvimento", true, true]]);
      const g2 = (await um<{ r: any }>(c, `SELECT public.integracao_listar(NULL, jsonb_build_object('busca', $1::text), 1) AS r`, [m.ref])).r.produtos[0].gates;
      expect(g2.compartilhado.ok && g2.planejamento.ok && g2.preco.ok && g2.sku.ok).toBe(true);
      expect(g2.ref.ok).toBe(false);
      expect(g2.ref.motivo).toMatch(/^A REF aparece a partir da etapa ".+" do kanban\.$/);
    });
  });

  it("Important #1 (revisão T2): cross-tenant — previa/estado_modelos ignoram id de outra loja", async (ctx) => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      // resíduos T7 #3 (T2 N3): modelo de OUTRA loja escolhido EM TEMPO DE EXECUÇÃO (não um UUID fixo) — leitura
      // só, nenhum dado é alterado. ruling do controlador, revisão T7 #11 (fix round 1, Minor 1): `ORDER BY id`
      // p/ escolha determinística entre execuções + skip limpo se a cópia não tiver nenhum modelo de outra loja
      // (em vez de um TypeError acessando `.id` de `undefined`).
      const outro = await um<{ id: string; tenant_id: string } | undefined>(c,
        `SELECT id, tenant_id FROM public.modelos WHERE tenant_id <> $1 ORDER BY id LIMIT 1`, [T]);
      if (!outro) {
        ctx.skip("nenhum modelo de outra loja na cópia — nada para testar");
        return;
      }
      const outraLoja = outro.id;
      const p = (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [outraLoja])).r;
      expect(p.produtos).toEqual([]);
      await c.query(
        `INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos)
         VALUES ($1, $2, 'integravel', ARRAY['nome']::text[])`,
        [outro.tenant_id, outraLoja],
      );
      const e = (await um<{ r: any }>(c, `SELECT public.integracao_estado_modelos(ARRAY[$1::uuid]) AS r`, [outraLoja])).r;
      expect(e).toEqual({});
    });
  });

  it("config_ler: campos para quem vê; bloco api SÓ para super admin", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      const s = (await um<{ r: any }>(c, `SELECT public.integracao_config_ler() AS r`)).r;
      expect(s.campos).toEqual([...CAMPOS_PADRAO]);
      expect(s.layout).toEqual([...LAYOUT]);
      expect(s.api).toEqual({ limite_por_minuto: 60, max_por_pagina: 50, validade_foto_dias: 7, bloqueio_tentativas: 10 });
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce05", [["integracao", true, false]]);
      expect((await um<{ r: any }>(c, `SELECT public.integracao_config_ler() AS r`)).r.api).toBeNull();
      expect((await um<{ r: any }>(c, `SELECT public.integracao_estado_modelos(ARRAY[]::uuid[]) AS r`)).r).toEqual({});
    });
  });

  it("desempenho: listar (página de 50) e previa (50) na maior loja da cópia em < 3 s cada", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await c.query(`UPDATE public.users SET tenant_id = $1 WHERE id = $2`, [AVE_RARA, U]);
      let t0 = Date.now();
      const l = await um<{ r: any }>(c, `SELECT public.integracao_listar('todos', '{}'::jsonb, 1) AS r`);
      const tl = Date.now() - t0;
      const ids = l.r.produtos.map((p: any) => p.modelo_id);
      t0 = Date.now();
      await c.query(`SELECT public.integracao_previa($1::uuid[])`, [ids]);
      const tp = Date.now() - t0;
      console.log(`[medição] integracao_listar 50 = ${tl} ms · integracao_previa ${ids.length} = ${tp} ms`);
      expect(ids.length).toBe(50);
      expect(tl).toBeLessThan(3000);
      expect(tp).toBeLessThan(3000);
    });
  });

  it.skipIf(!MIG_TXN)("inverso 2 desfaz a 2 (as 15 funções somem; tabelas da 1 ficam)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await aplica(c, INVERSOS[1]);
      const r = await um<{ n: string; t: boolean }>(c,
        `SELECT (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                  AND proname IN ('_integracao_rotulos','_integracao_cfg','_integracao_num','_integracao_mascarar',
                    '_integracao_retrato_core','_integracao_assinar','_integracao_gate','_integracao_gates','_integracao_base',
                    '_integracao_exige','_integracao_exige_super','integracao_previa','integracao_listar',
                    'integracao_estado_modelos','integracao_config_ler')) AS n,
                to_regclass('public.integracao_produtos') IS NOT NULL AS t`);
      expect(r).toEqual({ n: "0", t: true });
    });
  });

  it.skipIf(!MIG_TXN)("Minor #7 (revisão T2): o pos-check do inverso 2 pega QUALQUER uma das 15 sobrando, não só 1", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      // remove o DROP de 1 das 15 funções (uma DIFERENTE da que o pos-check antigo checava sozinho,
      // _integracao_retrato_core) — se o pos-check só olhasse aquela 1 (o bug que o Minor #7 corrigiu),
      // esta outra função sobrando passaria batido. Com o loop sobre as 15, o arquivo tem que RAISE.
      const semDrop = ler(INVERSOS[1]).replace(
        /DROP FUNCTION IF EXISTS public\._integracao_rotulos\(\);\n/,
        "",
      );
      await expect(aplicarSql(c, semTravas(semDrop, "teste-minor7"), "teste-minor7")).rejects.toThrow(/funcao\(oes\) da migration 2 ainda existem/);
    });
  });
});
