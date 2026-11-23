// Exportar dados por TIPO (tecido / aviamento / insumo) — RPCs exportar_tecidos / exportar_aviamentos / exportar_insumos
// (+ os 3 _core). Migration 20261212100000_exportar_por_tipo (+ inverso em supabase/rollback/). SO na copia local (ehBancoLocal),
// cada caso em txn revertida (withTx): a migration (e o portao _exportar_exige da 20261201130000, se a copia ainda nao o tem) e aplicada
// DENTRO da txn pelo harness (mig-txn: sem BEGIN/COMMIT, NUNCA \i). Semeia (Loja Teste, txn) e confere recorte, niveis 1/2, dedup N:N do
// tecido, filtro E do aviamento, codigo_nome, insumo cor x tamanho, filtro invalido, multi-tenant, portao e ACL/REVOKE dos 3 _core.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um } from "./db";
import { aplicarArquivo } from "./mig-txn";
import { LOCAL, T, U, comoUsuarioCom } from "./integracao-helpers";

const RODA = hasDb && LOCAL;
const MIG = "supabase/migrations/20261212100000_exportar_por_tipo.sql";
const DOWN = "supabase/rollback/20261212100000_exportar_por_tipo_down.sql";
const PORTAO = "supabase/migrations/20261201130000_exportar_dados_permissao.sql";
const MIG_BASE = "supabase/migrations/20261122100000_exportar_dados.sql";
const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979";
const COMUM = "e0000000-0000-4000-8000-0000000000f1"; // usuario comum SEM exportar_dados
const COM_PERM = "e0000000-0000-4000-8000-0000000000f2"; // usuario comum COM exportar_dados (ver)

const SIG_CORE = [
  "public._exportar_tecidos_core(uuid,text,text[],text[],integer)",
  "public._exportar_aviamentos_core(uuid,text,text,text[],text[],integer)",
  "public._exportar_insumos_core(uuid,text,text[],text[],integer)",
];
const SIG_WRAP = [
  "public.exportar_tecidos(text,text[],text[],integer)",
  "public.exportar_aviamentos(text,text,text[],text[],integer)",
  "public.exportar_insumos(text,text[],text[],integer)",
];

type Linha = Record<string, any>;
type Ret = { colunas: string[]; total: number; niveis: Record<string, Linha[]> };

/** Funcoes vivas NESTA txn: portao + as 6 novas (se a copia ainda nao tem, a ida roda dentro da txn; idempotente). */
async function viva(c: Client): Promise<void> {
  try {
    if ((await um<{ ok: boolean }>(c, `SELECT to_regprocedure('public.exportar_produtos(text,text,text[],text[],integer)') IS NOT NULL AS ok`)).ok === false) {
      await aplicarArquivo(c, MIG_BASE);
    }
    if ((await um<{ ok: boolean }>(c, `SELECT to_regprocedure('public._exportar_exige()') IS NOT NULL AS ok`)).ok === false) {
      await aplicarArquivo(c, PORTAO);
    }
    await aplicarArquivo(c, MIG);
  } finally {
    // as migrations fazem SET LOCAL lock_timeout/transaction_timeout (valeriam para a txn INTEIRA do teste)
    await c.query("SET LOCAL transaction_timeout = 0");
    await c.query("SET LOCAL lock_timeout = '3s'");
  }
}

async function tec(c: Client, categoria: string | null, campos: string[], niveis: string[], limite: number | null = null): Promise<Ret> {
  await comoUsuario(c, U);
  return (await um<{ j: Ret }>(c, `SELECT public.exportar_tecidos($1, $2::text[], $3::text[], $4) AS j`, [categoria, campos, niveis, limite])).j;
}
async function avi(c: Client, cat: string | null, mat: string | null, campos: string[], niveis: string[], limite: number | null = null): Promise<Ret> {
  await comoUsuario(c, U);
  return (await um<{ j: Ret }>(c, `SELECT public.exportar_aviamentos($1, $2, $3::text[], $4::text[], $5) AS j`, [cat, mat, campos, niveis, limite])).j;
}
async function ins(c: Client, tipo: string | null, campos: string[], niveis: string[], limite: number | null = null): Promise<Ret> {
  await comoUsuario(c, U);
  return (await um<{ j: Ret }>(c, `SELECT public.exportar_insumos($1, $2::text[], $3::text[], $4) AS j`, [tipo, campos, niveis, limite])).j;
}

/** Roda `sql` como o PAPEL authenticated (PostgREST) e devolve "PASSOU" ou "<code> <message>". */
async function tenta(c: Client, sql: string, params: unknown[] = []): Promise<string> {
  await c.query("SAVEPOINT ex_pt");
  await c.query("SET LOCAL ROLE authenticated");
  try {
    await c.query(sql, params);
    return "PASSOU";
  } catch (e) {
    const er = e as { code?: string; message?: string };
    return `${er.code} ${er.message}`;
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT ex_pt"); // desfaz tambem o SET LOCAL ROLE
    await c.query("RELEASE SAVEPOINT ex_pt");
  }
}

const id = async (c: Client, sql: string, p: unknown[]): Promise<string> => (await um<{ id: string }>(c, sql, p)).id;

// ---- fixtures (Loja Teste, dentro da txn) ----
const cor = (c: Client, nome: string, tenant = T) => id(c, `INSERT INTO public.cores (tenant_id, nome) VALUES ($1, $2) RETURNING id`, [tenant, nome]);
const apelido = (c: Client, nome: string, corBase: string, tenant = T) =>
  id(c, `INSERT INTO public.cores_apelido (tenant_id, nome, cor_base_id) VALUES ($1, $2, $3) RETURNING id`, [tenant, nome, corBase]);
const catTec = (c: Client, nome: string, tenant = T) => id(c, `INSERT INTO public.categorias_tecido (tenant_id, nome) VALUES ($1, $2) RETURNING id`, [tenant, nome]);
const subTec = (c: Client, nome: string, cat: string, tenant = T) =>
  id(c, `INSERT INTO public.subcategorias_tecido (tenant_id, nome, categoria_tecido_id) VALUES ($1, $2, $3) RETURNING id`, [tenant, nome, cat]);
const artigo = (c: Client, nome: string, extra: { ncm?: string; preco?: number; unidade?: string } = {}) =>
  id(c, `INSERT INTO public.artigos (tenant_id, nome, unidade_medida, ncm, preco) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [T, nome, extra.unidade ?? "metro", extra.ncm ?? null, extra.preco ?? null]);
const vincula = (c: Client, art: string, cat: string, sub: string | null = null, tenant = T) =>
  c.query(`INSERT INTO public.artigo_categorias_tecido (tenant_id, artigo_id, categoria_tecido_id, subcategoria_tecido_id) VALUES ($1, $2, $3, $4)`, [tenant, art, cat, sub]);

describe.skipIf(!RODA)("exportar por tipo — banco (tecido / aviamento / insumo)", () => {
  it("TECIDO: filtro N:N por EXISTS nao duplica; categoria/sub agregadas por ' | '; recorte; total; limite; niveis 1/2", async () => {
    await withTx(async (c) => {
      await viva(c);
      await comoUsuario(c, U);
      const catA = await catTec(c, "ZZ Cat A");
      const catB = await catTec(c, "ZZ Cat B");
      const catC = await catTec(c, "ZZ Cat C");
      const subA1 = await subTec(c, "ZZ Sub A1", catA);
      const subB1 = await subTec(c, "ZZ Sub B1", catB);
      const dup = await artigo(c, "ZZ Tecido Dup", { ncm: "5407.10.00", preco: 12.5 });
      const so_c = await artigo(c, "ZZ Tecido So C");
      const sem = await artigo(c, "ZZ Tecido Sem Categoria");
      // Dup: 2 pares (A com sub A1, B com sub B1) -> 1 so linha no filtro por A (EXISTS), com as 2 categorias numa celula
      await vincula(c, dup, catA, subA1);
      await vincula(c, dup, catB, subB1);
      await vincula(c, so_c, catC);
      // variantes do Dup: 2 (cor + apelido) -> nivel 2 = pai + 2 filhas
      const preto = await cor(c, "ZZ Preto");
      const grafite = await apelido(c, "ZZ Grafite", preto);
      const branco = await cor(c, "ZZ Branco");
      await c.query(
        `INSERT INTO public.variantes_tecido (tenant_id, artigo_id, cor_id, cor_apelido_id, codigo_variante) VALUES ($1,$2,$3,$4,'V-PRE'), ($1,$2,$5,NULL,'V-BRA')`,
        [T, dup, preto, grafite, branco],
      );
      // outra loja: artigo + categoria com o MESMO nome; nunca pode aparecer
      const catOutra = await catTec(c, "ZZ Cat A", AVE_RARA);
      const artOutra = await id(c, `INSERT INTO public.artigos (tenant_id, nome) VALUES ($1, 'ZZ Tecido Outra Loja') RETURNING id`, [AVE_RARA]);
      await vincula(c, artOutra, catOutra, null, AVE_RARA);

      const campos = ["nome", "categorias", "subcategoria_tecido", "ncm", "preco", "cor_base", "cor_apelido", "codigo_variante"];
      const f = await tec(c, catA, campos, ["1", "2"]);
      expect(f.colunas).toEqual(campos);
      expect(f.total).toBe(1);
      expect(f.niveis["1"].length).toBe(1);
      const pai = f.niveis["1"][0];
      expect(pai.nome).toBe("ZZ Tecido Dup");
      expect(pai.categorias).toBe("ZZ Cat A | ZZ Cat B");
      expect(pai.subcategoria_tecido).toBe("ZZ Sub A1 | ZZ Sub B1");
      expect(pai.ncm).toBe("5407.10.00");
      expect(pai.preco).toBe(12.5);
      // campos de variante: null no pai
      expect(pai.cor_base).toBeNull();
      expect(pai.cor_apelido).toBeNull();
      expect(pai.codigo_variante).toBeNull();
      // nivel 2 = pai + 2 filhas (ordem: cor base ZZ Branco, depois ZZ Preto); as filhas herdam os campos do pai
      const n2 = f.niveis["2"];
      expect(n2.length).toBe(3);
      expect(n2[0].cor_base).toBeNull();
      expect(n2.slice(1).map((x) => [x.cor_base, x.cor_apelido, x.codigo_variante])).toEqual([
        ["ZZ Branco", null, "V-BRA"],
        ["ZZ Preto", "ZZ Grafite", "V-PRE"],
      ]);
      for (const filha of n2.slice(1)) {
        expect(filha.nome).toBe("ZZ Tecido Dup");
        expect(filha.categorias).toBe("ZZ Cat A | ZZ Cat B");
      }
      // filtro por B tambem acha o mesmo tecido (1 linha); filtro por C acha so o "So C"
      expect((await tec(c, catB, ["nome"], ["1"])).niveis["1"].map((x) => x.nome)).toEqual(["ZZ Tecido Dup"]);
      expect((await tec(c, catC, ["nome"], ["1"])).niveis["1"].map((x) => x.nome)).toEqual(["ZZ Tecido So C"]);
      // sem filtro (NULL e '') = todos da LOJA (os 3 semeados; o de outra loja nunca)
      for (const todas of [null, "", "   "]) {
        const t = await tec(c, todas, ["nome"], ["1"]);
        const nomes = t.niveis["1"].map((x) => x.nome);
        expect(nomes).toEqual(expect.arrayContaining(["ZZ Tecido Dup", "ZZ Tecido So C", "ZZ Tecido Sem Categoria"]));
        expect(nomes).not.toContain("ZZ Tecido Outra Loja");
        expect(t.total).toBe(t.niveis["1"].length);
      }
      // limite = previa: limita os itens, total continua o do recorte inteiro, e nao e preciso pedir o nivel 2
      const todos = await tec(c, null, ["nome"], ["1"]);
      const lim = await tec(c, null, ["nome"], ["1"], 2);
      expect(lim.niveis["1"].length).toBe(2);
      expect(lim.total).toBe(todos.total);
      expect(Object.keys(lim.niveis)).toEqual(["1"]);
      void sem;
    });
  });

  it("TECIDO: fornecedor (+ representante), mes e ano; nivel 2 so, sem o 1; lookup de OUTRA loja nao vaza", async () => {
    await withTx(async (c) => {
      await viva(c);
      await comoUsuario(c, U);
      const emp = await id(c, `INSERT INTO public.empresas (tenant_id, nome_fantasia, tipo) VALUES ($1, 'ZZ Fornecedor SA', 'material') RETURNING id`, [T]);
      const rep = await id(c, `INSERT INTO public.representantes (tenant_id, empresa_id, nome) VALUES ($1, $2, 'ZZ Maria') RETURNING id`, [T, emp]);
      const mes = await id(c, `INSERT INTO public.meses (tenant_id, mes, ordem) VALUES ($1, 'ZZ Marco', 97) RETURNING id`, [T]);
      const ano = await id(c, `INSERT INTO public.anos (tenant_id, ano) VALUES ($1, '2999') RETURNING id`, [T]);
      const a1 = await id(c, `INSERT INTO public.artigos (tenant_id, nome, empresa_id, representante_id, mes_id, ano_id, rendimento, largura_estimada, preco_por_metro, unidade_medida)
                              VALUES ($1, 'ZZ Tecido Forn', $2, $3, $4, $5, 3.5, 1.5, 20, 'kg') RETURNING id`, [T, emp, rep, mes, ano]);
      const a2 = await id(c, `INSERT INTO public.artigos (tenant_id, nome, empresa_id) VALUES ($1, 'ZZ Tecido Forn Sem Rep', $2) RETURNING id`, [T, emp]);
      // empresa de OUTRA loja referenciada por id solto: nao pode vazar o nome
      const empOutra = await id(c, `INSERT INTO public.empresas (tenant_id, nome_fantasia, tipo) VALUES ($1, 'ZZ Forn Outra Loja', 'material') RETURNING id`, [AVE_RARA]);
      const a3 = await id(c, `INSERT INTO public.artigos (tenant_id, nome, empresa_id) VALUES ($1, 'ZZ Tecido Forn Alheio', $2) RETURNING id`, [T, empOutra]);
      // preco_por_metro e derivado por gatilho do banco (preco / rendimento no kg): le o valor VIVO em vez de assumir o semeado
      await c.query(`UPDATE public.artigos SET preco = 40 WHERE id = $1`, [a1]);
      const ppm = Number((await um<{ p: string }>(c, `SELECT preco_por_metro::text AS p FROM public.artigos WHERE id = $1`, [a1])).p);
      expect(ppm).toBeGreaterThan(0);
      const campos = ["nome", "unidade", "rendimento", "largura", "preco_por_metro", "fornecedor", "mes", "ano"];
      const r = await tec(c, null, campos, ["1"]);
      const por = Object.fromEntries(r.niveis["1"].map((x) => [x.nome, x]));
      expect(por["ZZ Tecido Forn"]).toMatchObject({
        unidade: "kg", rendimento: 3.5, largura: 1.5, preco_por_metro: Math.round(ppm * 100) / 100, fornecedor: "ZZ Fornecedor SA - ZZ Maria", mes: "ZZ Marco", ano: "2999",
      });
      expect(por["ZZ Tecido Forn Sem Rep"].fornecedor).toBe("ZZ Fornecedor SA");
      expect(por["ZZ Tecido Forn Sem Rep"].mes).toBeNull();
      expect(por["ZZ Tecido Forn Alheio"].fornecedor).toBeNull();
      // so nivel 2 (sem o 1): a chave "1" nao existe
      const so2 = await tec(c, null, ["nome"], ["2"]);
      expect(Object.keys(so2.niveis)).toEqual(["2"]);
      void a1; void a2; void a3;
    });
  });

  it("AVIAMENTO: 'nome' = codigo_nome; Categoria E Material combinam com E (AND); cada eixo vazio = todos; niveis 1/2 com variante", async () => {
    await withTx(async (c) => {
      await viva(c);
      await comoUsuario(c, U);
      const catBot = await id(c, `INSERT INTO public.categorias_aviamento (tenant_id, nome) VALUES ($1, 'ZZ Botoes') RETURNING id`, [T]);
      const catZip = await id(c, `INSERT INTO public.categorias_aviamento (tenant_id, nome) VALUES ($1, 'ZZ Ziperes') RETURNING id`, [T]);
      const subBot = await id(c, `INSERT INTO public.subcategorias_aviamento (tenant_id, nome, categoria_aviamento_id) VALUES ($1, 'ZZ Sub Botao', $2) RETURNING id`, [T, catBot]);
      const matMetal = await id(c, `INSERT INTO public.materiais_aviamento (tenant_id, nome) VALUES ($1, 'ZZ Metal') RETURNING id`, [T]);
      const matPlast = await id(c, `INSERT INTO public.materiais_aviamento (tenant_id, nome) VALUES ($1, 'ZZ Plastico') RETURNING id`, [T]);
      let seqCod = 0;
      const mk = (nome: string, cat: string | null, mat: string | null, extra: string | null = null) =>
        id(c, `INSERT INTO public.aviamentos (tenant_id, codigo_nome, categoria_aviamento_id, subcategoria_aviamento_id, material_aviamento_id, preco, codigo)
               VALUES ($1, $2, $3, $4, $5, 1.25, $6) RETURNING id`, [T, nome, cat, extra, mat, `ZZCOD-${++seqCod}`]);
      const metal = await mk("ZZ AV Metal", catBot, matMetal, subBot);
      await mk("ZZ AV Plast", catBot, matPlast);
      await mk("ZZ AV Zip Metal", catZip, matMetal);
      await mk("ZZ AV Sem Material", catBot, null);
      // variantes do "AV Metal": 2 (cor + apelido, preco proprio)
      const dourado = await cor(c, "ZZ Dourado");
      const ouro = await apelido(c, "ZZ Ouro Velho", dourado);
      const prata = await cor(c, "ZZ Prata");
      await c.query(
        `INSERT INTO public.variantes_aviamento (tenant_id, aviamento_id, cor_id, cor_apelido_id, codigo_variante, preco) VALUES ($1,$2,$3,$4,'AV-DOU',2.5), ($1,$2,$5,NULL,'AV-PRA',NULL)`,
        [T, metal, dourado, ouro, prata],
      );
      const nomes = (r: Ret): string[] => r.niveis["1"].map((x) => x.nome);

      // Categoria E Material: so o "AV Metal" (Botoes + Metal); o "AV Plast" (Botoes+Plastico), o Zip (Ziperes+Metal) e o sem material ficam de fora
      const ambos = await avi(c, catBot, matMetal, ["nome", "codigo", "categoria", "subcategoria", "material", "preco"], ["1"]);
      expect(ambos.total).toBe(1);
      expect(nomes(ambos)).toEqual(["ZZ AV Metal"]);
      expect(ambos.niveis["1"][0]).toMatchObject({
        nome: "ZZ AV Metal", codigo: "ZZCOD-1", categoria: "ZZ Botoes", subcategoria: "ZZ Sub Botao", material: "ZZ Metal", preco: 1.25,
      });
      // so categoria = 3 (Botoes: Metal, Plast, Sem Material); so material = 2 (Metal: AV Metal, Zip Metal); nenhum = todos os da loja
      expect(nomes(await avi(c, catBot, null, ["nome"], ["1"]))).toEqual(["ZZ AV Metal", "ZZ AV Plast", "ZZ AV Sem Material"]);
      expect(nomes(await avi(c, null, matMetal, ["nome"], ["1"]))).toEqual(["ZZ AV Metal", "ZZ AV Zip Metal"]);
      expect(nomes(await avi(c, "", "", ["nome"], ["1"]))).toEqual(expect.arrayContaining(["ZZ AV Metal", "ZZ AV Plast", "ZZ AV Zip Metal", "ZZ AV Sem Material"]));
      // ordem estavel por codigo_nome
      const ordem = nomes(await avi(c, catBot, null, ["nome"], ["1"]));
      expect([...ordem].sort()).toEqual(ordem);
      // nivel 2: pai + 2 variantes (ordem cor base: Dourado, Prata); soVariante null no pai
      const n2 = await avi(c, catBot, matMetal, ["nome", "cor_base", "cor_apelido", "codigo_variante", "preco_variante"], ["1", "2"]);
      expect(n2.niveis["1"].length).toBe(1);
      expect(n2.niveis["2"].length).toBe(3);
      expect(n2.niveis["2"][0]).toMatchObject({ nome: "ZZ AV Metal", cor_base: null, cor_apelido: null, codigo_variante: null, preco_variante: null });
      expect(n2.niveis["2"].slice(1).map((x) => [x.nome, x.cor_base, x.cor_apelido, x.codigo_variante, x.preco_variante])).toEqual([
        ["ZZ AV Metal", "ZZ Dourado", "ZZ Ouro Velho", "AV-DOU", 2.5],
        ["ZZ AV Metal", "ZZ Prata", null, "AV-PRA", null],
      ]);
    });
  });

  it("AVIAMENTO: cor do cabecalho (cor_base_cab/cor_apelido_cab) e fornecedor; nada de outra loja", async () => {
    await withTx(async (c) => {
      await viva(c);
      await comoUsuario(c, U);
      const vermelho = await cor(c, "ZZ Vermelho");
      const rubi = await apelido(c, "ZZ Rubi", vermelho);
      const emp = await id(c, `INSERT INTO public.empresas (tenant_id, nome_fantasia, tipo) VALUES ($1, 'ZZ Armarinho', 'material') RETURNING id`, [T]);
      await c.query(`INSERT INTO public.aviamentos (tenant_id, codigo_nome, cor_id, cor_apelido_id, empresa_id) VALUES ($1, 'ZZ AV Cabecalho', $2, $3, $4)`, [T, vermelho, rubi, emp]);
      await c.query(`INSERT INTO public.aviamentos (tenant_id, codigo_nome) VALUES ($1, 'ZZ AV Outra Loja')`, [AVE_RARA]);
      const r = await avi(c, null, null, ["nome", "cor_base_cab", "cor_apelido_cab", "fornecedor"], ["1"]);
      const cab = r.niveis["1"].find((x) => x.nome === "ZZ AV Cabecalho");
      expect(cab).toMatchObject({ cor_base_cab: "ZZ Vermelho", cor_apelido_cab: "ZZ Rubi", fornecedor: "ZZ Armarinho" });
      expect(r.niveis["1"].map((x) => x.nome)).not.toContain("ZZ AV Outra Loja");
    });
  });

  it("INSUMO: nivel 1 = 1 linha por insumo; nivel 2 = pai + 1 linha por variante cor x tamanho (sem apelido); sem variante = so o pai; filtro por tipo", async () => {
    await withTx(async (c) => {
      await viva(c);
      await comoUsuario(c, U);
      const tipoA = await id(c, `INSERT INTO public.tipos_insumo (tenant_id, nome) VALUES ($1, 'ZZ Tipo Etiqueta') RETURNING id`, [T]);
      const tipoB = await id(c, `INSERT INTO public.tipos_insumo (tenant_id, nome) VALUES ($1, 'ZZ Tipo Embalagem') RETURNING id`, [T]);
      const et = await id(c, `INSERT INTO public.etiquetas (tenant_id, nome, unidade, formato_tamanho, tipo_insumo_id, preco, observacoes)
                              VALUES ($1, 'ZZ Etiqueta X', 'unidade', 'ambos', $2, 0.75, 'obs X') RETURNING id`, [T, tipoA]);
      const sem = await id(c, `INSERT INTO public.etiquetas (tenant_id, nome, unidade, formato_tamanho, tipo_insumo_id) VALUES ($1, 'ZZ Embalagem Y', 'unidade', 'nenhum', $2) RETURNING id`, [T, tipoB]);
      const preto = await cor(c, "ZZ Preto Ins");
      const branco = await cor(c, "ZZ Branco Ins");
      await c.query(
        `INSERT INTO public.variantes_etiqueta (tenant_id, etiqueta_id, cor_id, tamanho, preco) VALUES ($1,$2,$3,'P',0.5),($1,$2,$3,'M',NULL),($1,$2,$4,'G',1.1)`,
        [T, et, preto, branco],
      );
      // outra loja: insumo + tipo; nunca aparece
      const tipoOutra = await id(c, `INSERT INTO public.tipos_insumo (tenant_id, nome) VALUES ($1, 'ZZ Tipo Outra') RETURNING id`, [AVE_RARA]);
      await c.query(`INSERT INTO public.etiquetas (tenant_id, nome, tipo_insumo_id) VALUES ($1, 'ZZ Insumo Outra Loja', $2)`, [AVE_RARA, tipoOutra]);

      // o preco do pai e derivado das variantes por gatilho do banco: le o valor VIVO em vez de assumir o semeado
      const precoPai = Number((await um<{ p: string }>(c, `SELECT preco::text AS p FROM public.etiquetas WHERE id = $1`, [et])).p);
      const campos = ["nome", "tipo_insumo", "formato_tamanho", "preco", "observacoes", "cor", "tamanho", "preco_variante"];
      const r = await ins(c, tipoA, campos, ["1", "2"]);
      expect(r.total).toBe(1);
      expect(r.niveis["1"].length).toBe(1); // NAO explode cor x tamanho no nivel 1
      expect(r.niveis["1"][0]).toMatchObject({
        nome: "ZZ Etiqueta X", tipo_insumo: "ZZ Tipo Etiqueta", formato_tamanho: "ambos", preco: precoPai, observacoes: "obs X",
        cor: null, tamanho: null, preco_variante: null,
      });
      const n2 = r.niveis["2"];
      expect(n2.length).toBe(4); // pai + 3 variantes
      expect(n2[0].tamanho).toBeNull();
      const filhas = n2.slice(1);
      expect(filhas.map((x) => [x.cor, x.tamanho]).sort()).toEqual([["ZZ Branco Ins", "G"], ["ZZ Preto Ins", "M"], ["ZZ Preto Ins", "P"]]);
      expect(filhas.find((x) => x.tamanho === "P")).toMatchObject({ nome: "ZZ Etiqueta X", preco_variante: 0.5, preco: precoPai }); // herda o pai
      expect(filhas.find((x) => x.tamanho === "M")!.preco_variante).toBeNull();
      // insumo sem variante: so o pai no nivel 2
      const rb = await ins(c, tipoB, ["nome", "cor", "tamanho"], ["2"]);
      expect(rb.total).toBe(1);
      expect(rb.niveis["2"].length).toBe(1);
      expect(rb.niveis["2"][0]).toMatchObject({ nome: "ZZ Embalagem Y", cor: null, tamanho: null });
      // sem filtro: os 2 da loja; o de outra loja nunca
      const todos = await ins(c, null, ["nome"], ["1"]);
      const nomes = todos.niveis["1"].map((x) => x.nome);
      expect(nomes).toEqual(expect.arrayContaining(["ZZ Etiqueta X", "ZZ Embalagem Y"]));
      expect(nomes).not.toContain("ZZ Insumo Outra Loja");
      void sem;
    });
  });

  it("filtro invalido: id nao-uuid OU de outra loja -> exportar_filtro_invalido (nos 3 tipos e nos 2 filtros do aviamento)", async () => {
    await withTx(async (c) => {
      await viva(c);
      await comoUsuario(c, U);
      const catOutra = await catTec(c, "ZZ Cat Outra", AVE_RARA);
      const catAvOutra = await id(c, `INSERT INTO public.categorias_aviamento (tenant_id, nome) VALUES ($1, 'ZZ CatAv Outra') RETURNING id`, [AVE_RARA]);
      const matOutra = await id(c, `INSERT INTO public.materiais_aviamento (tenant_id, nome) VALUES ($1, 'ZZ Mat Outra') RETURNING id`, [AVE_RARA]);
      const tipoOutra = await id(c, `INSERT INTO public.tipos_insumo (tenant_id, nome) VALUES ($1, 'ZZ Tipo Outra') RETURNING id`, [AVE_RARA]);
      const catAvMinha = await id(c, `INSERT INTO public.categorias_aviamento (tenant_id, nome) VALUES ($1, 'ZZ CatAv Minha') RETURNING id`, [T]);
      const inexistente = "00000000-0000-4000-8000-00000000dead";
      const erro = async (fn: () => Promise<unknown>): Promise<string> => {
        await c.query("SAVEPOINT ex_f");
        try {
          await fn();
          return "PASSOU";
        } catch (e) {
          return (e as { message?: string }).message ?? String(e);
        } finally {
          await c.query("ROLLBACK TO SAVEPOINT ex_f");
          await c.query("RELEASE SAVEPOINT ex_f");
        }
      };
      for (const ruim of ["nao-e-uuid", catOutra, inexistente, "12345678-1234-1234-1234-12345678901"]) {
        expect(await erro(() => tec(c, ruim, ["nome"], ["1"]))).toMatch(/^exportar_filtro_invalido$/);
      }
      expect(await erro(() => avi(c, "nao-e-uuid", null, ["nome"], ["1"]))).toMatch(/^exportar_filtro_invalido$/);
      expect(await erro(() => avi(c, catAvOutra, null, ["nome"], ["1"]))).toMatch(/^exportar_filtro_invalido$/);
      expect(await erro(() => avi(c, null, "nao-e-uuid", ["nome"], ["1"]))).toMatch(/^exportar_filtro_invalido$/);
      expect(await erro(() => avi(c, null, matOutra, ["nome"], ["1"]))).toMatch(/^exportar_filtro_invalido$/);
      // categoria valida + material de OUTRA loja = invalido (cada eixo e validado)
      expect(await erro(() => avi(c, catAvMinha, matOutra, ["nome"], ["1"]))).toMatch(/^exportar_filtro_invalido$/);
      expect(await erro(() => ins(c, "nao-e-uuid", ["nome"], ["1"]))).toMatch(/^exportar_filtro_invalido$/);
      expect(await erro(() => ins(c, tipoOutra, ["nome"], ["1"]))).toMatch(/^exportar_filtro_invalido$/);
      // categoria valida da LOJA passa
      expect(await erro(() => avi(c, catAvMinha, null, ["nome"], ["1"]))).toBe("PASSOU");
    });
  });

  it("validacoes do molde nos 3 tipos: nivel 3/'x'/vazio, campo invalido/vazio, limite < 1 (P0001 ASCII)", async () => {
    await withTx(async (c) => {
      await viva(c);
      await comoUsuario(c, U);
      const chamadas: Record<string, (campos: string[] | null, niveis: string[] | null, limite?: number | null) => Promise<unknown>> = {
        tecido: (cp, nv, lim = null) => c.query(`SELECT public.exportar_tecidos(NULL, $1::text[], $2::text[], $3)`, [cp, nv, lim]),
        aviamento: (cp, nv, lim = null) => c.query(`SELECT public.exportar_aviamentos(NULL, NULL, $1::text[], $2::text[], $3)`, [cp, nv, lim]),
        insumo: (cp, nv, lim = null) => c.query(`SELECT public.exportar_insumos(NULL, $1::text[], $2::text[], $3)`, [cp, nv, lim]),
      };
      const msg = async (fn: () => Promise<unknown>): Promise<string> => {
        await c.query("SAVEPOINT ex_v");
        try {
          await fn();
          return "PASSOU";
        } catch (e) {
          const er = e as { code?: string; message?: string };
          expect(er.code).toBe("P0001");
          return er.message ?? "";
        } finally {
          await c.query("ROLLBACK TO SAVEPOINT ex_v");
          await c.query("RELEASE SAVEPOINT ex_v");
        }
      };
      for (const [tipo, chama] of Object.entries(chamadas)) {
        expect(await msg(() => chama(["nome"], ["3"])), `${tipo} nivel 3`).toBe("exportar_nivel_invalido: 3");
        expect(await msg(() => chama(["nome"], ["1", "3"])), `${tipo} nivel 1+3`).toBe("exportar_nivel_invalido: 3");
        expect(await msg(() => chama(["nome"], ["x"])), `${tipo} nivel x`).toBe("exportar_nivel_invalido: x");
        expect(await msg(() => chama(["nome"], []))).toBe("exportar_niveis_vazio");
        expect(await msg(() => chama(["nome"], null))).toBe("exportar_niveis_vazio");
        expect(await msg(() => chama(["nome", "campo_que_nao_existe"], ["1"]))).toBe("exportar_campo_invalido: campo_que_nao_existe");
        expect(await msg(() => chama([], ["1"]))).toBe("exportar_campos_vazio");
        expect(await msg(() => chama(null, ["1"]))).toBe("exportar_campos_vazio");
        expect(await msg(() => chama(["nome"], ["1"], 0))).toBe("exportar_limite_invalido");
        expect(await msg(() => chama(["nome"], ["1"], -3))).toBe("exportar_limite_invalido");
        expect(await msg(() => chama(["nome"], ["1"], 1)), `${tipo} ok`).toBe("PASSOU");
      }
      // chave de OUTRO tipo e invalida: 'cor_base' nao existe no insumo, 'cor' nao existe no tecido, 'categorias' nao existe no aviamento
      expect(await msg(() => chamadas.insumo(["cor_base"], ["1"]))).toBe("exportar_campo_invalido: cor_base");
      expect(await msg(() => chamadas.tecido(["cor"], ["1"]))).toBe("exportar_campo_invalido: cor");
      expect(await msg(() => chamadas.aviamento(["categorias"], ["1"]))).toBe("exportar_campo_invalido: categorias");
      // colunas: sem repetir, na ordem pedida
      const r = await tec(c, null, ["ncm", "nome", "ncm", "unidade"], ["1"], 1);
      expect(r.colunas).toEqual(["ncm", "nome", "unidade"]);
    });
  });

  it("portao: sem exportar_dados -> 42501 nas 3 RPCs; com a permissao (ver) passa; sem login -> 42501", async () => {
    await withTx(async (c) => {
      await viva(c);
      const sqls = [
        `SELECT public.exportar_tecidos(NULL, ARRAY['nome'], ARRAY['1'], 1)`,
        `SELECT public.exportar_aviamentos(NULL, NULL, ARRAY['nome'], ARRAY['1'], 1)`,
        `SELECT public.exportar_insumos(NULL, ARRAY['nome'], ARRAY['1'], 1)`,
      ];
      await comoUsuarioCom(c, COMUM, []);
      for (const s of sqls) expect(await tenta(c, s)).toMatch(/^42501 /);
      await comoUsuarioCom(c, COM_PERM, [["exportar_dados", true, false]]);
      for (const s of sqls) expect(await tenta(c, s)).toBe("PASSOU");
      await c.query(`SELECT set_config('request.jwt.claims', '', true)`);
      for (const s of sqls) expect(await tenta(c, s)).toMatch(/^42501 /);
    });
  });

  it("ACL: os 3 _core NAO executaveis por PUBLIC/anon/authenticated (REVOKE dos 3); wrappers: authenticated sim, anon nao; service_role sim", async () => {
    await withTx(async (c) => {
      await viva(c);
      for (const sig of SIG_CORE) {
        for (const papel of ["anon", "authenticated"]) {
          const r = await um<{ ok: boolean }>(c, `SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [papel, sig]);
          expect(r.ok, `${papel} ${sig}`).toBe(false);
        }
        expect((await um<{ ok: boolean }>(c, `SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS ok`, [sig])).ok).toBe(true);
        // PUBLIC (entrada "=X/..." na ACL): e dele que anon/authenticated herdam
        const acl = (await um<{ a: string | null }>(c, `SELECT proacl::text AS a FROM pg_proc WHERE oid = $1::regprocedure`, [sig])).a ?? "";
        expect(acl, sig).not.toMatch(/(^|[{,])=X\//);
        expect(acl, sig).not.toMatch(/anon=/);
        expect(acl, sig).not.toMatch(/authenticated=/);
      }
      for (const sig of SIG_WRAP) {
        expect((await um<{ ok: boolean }>(c, `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS ok`, [sig])).ok, `anon ${sig}`).toBe(false);
        expect((await um<{ ok: boolean }>(c, `SELECT has_function_privilege('authenticated', $1, 'EXECUTE') AS ok`, [sig])).ok, `authenticated ${sig}`).toBe(true);
      }
      // na pratica: o cliente (papel authenticated) NAO chama o _core nem com um uuid de loja de outro (IDOR)
      await comoUsuario(c, U);
      expect(await tenta(c, `SELECT public._exportar_tecidos_core($1::uuid, NULL, ARRAY['nome'], ARRAY['1'], 1)`, [AVE_RARA])).toMatch(/^42501 /);
      expect(await tenta(c, `SELECT public._exportar_aviamentos_core($1::uuid, NULL, NULL, ARRAY['nome'], ARRAY['1'], 1)`, [AVE_RARA])).toMatch(/^42501 /);
      expect(await tenta(c, `SELECT public._exportar_insumos_core($1::uuid, NULL, ARRAY['nome'], ARRAY['1'], 1)`, [AVE_RARA])).toMatch(/^42501 /);
    });
  });

  it("migration: so objetos NOVOS (as 6 funcoes) — nenhuma funcao existente muda; 2a aplicacao e idempotente", async () => {
    await withTx(async (c) => {
      // fixa o estado de antes (SO as funcoes de public que existem ANTES da migration; md5 da definicao de cada uma)
      await viva(c); // aplica portao/base se faltarem
      const antes = await c.query(
        `SELECT p.oid::regprocedure::text AS sig, md5(pg_get_functiondef(p.oid)) AS m FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
            AND p.proname NOT IN ('exportar_tecidos','exportar_aviamentos','exportar_insumos','_exportar_tecidos_core','_exportar_aviamentos_core','_exportar_insumos_core')`,
      );
      await aplicarArquivo(c, MIG); // 2a vez
      const depois = await c.query(
        `SELECT p.oid::regprocedure::text AS sig, md5(pg_get_functiondef(p.oid)) AS m FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
            AND p.proname NOT IN ('exportar_tecidos','exportar_aviamentos','exportar_insumos','_exportar_tecidos_core','_exportar_aviamentos_core','_exportar_insumos_core')`,
      );
      expect(depois.rows).toEqual(antes.rows);
      // o molde do produto segue intocado
      const m = await um<{ m: string }>(c, `SELECT md5(pg_get_functiondef('public._exportar_produtos_core(uuid,text,text,text[],text[],integer)'::regprocedure)) AS m`);
      expect(m.m).toBe("36501a76de5616cda4a3aa59a0d71a5a");
      const seis = await um<{ n: number }>(c,
        `SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace
           AND proname IN ('exportar_tecidos','exportar_aviamentos','exportar_insumos','_exportar_tecidos_core','_exportar_aviamentos_core','_exportar_insumos_core')`);
      expect(seis.n).toBe(6);
    });
  });

  it("down: dropa as 6 funcoes e nada mais", async () => {
    await withTx(async (c) => {
      await viva(c);
      await aplicarArquivo(c, DOWN);
      const r = await um<{ n: number }>(c,
        `SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace
           AND proname IN ('exportar_tecidos','exportar_aviamentos','exportar_insumos','_exportar_tecidos_core','_exportar_aviamentos_core','_exportar_insumos_core')`);
      expect(r.n).toBe(0);
      // o export de produto e o portao seguem vivos
      expect((await um<{ ok: boolean }>(c, `SELECT to_regprocedure('public.exportar_produtos(text,text,text[],text[],integer)') IS NOT NULL AS ok`)).ok).toBe(true);
      expect((await um<{ ok: boolean }>(c, `SELECT to_regprocedure('public._exportar_exige()') IS NOT NULL AS ok`)).ok).toBe(true);
      expect((await um<{ ok: boolean }>(c, `SELECT to_regprocedure('public._exportar_produtos_core(uuid,text,text,text[],text[],integer)') IS NOT NULL AS ok`)).ok).toBe(true);
    });
  });
});
