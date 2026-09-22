// Descritor de importação — PRODUTO (Fase 4): REVENDA (produto acabado) + IMPORTADO.
// Aba ÚNICA com coluna `tipo` (revenda|importado). São gêmeos estruturais — mesmo núcleo de
// identidade/fornecedor/grade/variantes; só o bloco de preço difere (BRL vs câmbio). O `resolve`
// ramifica o cabeçalho por `tipo`; o `rpc` chama importar_produto_linha(_cabecalho,_variantes,_tipo)
// que cria o produto + o card-espelho em modelos (origem revenda/importado). Modelo interno com
// BOM fica p/ fase posterior (referencia tecidos/aviamentos já cadastrados).
//
// Diferenças do tecido/aviamento:
//  • variante = 1 linha por COR (cor base + apelido + peso + qtd), agregada por nome.
//  • grade = coluna "Grade" texto "tam:peso" (ex.: "P:1, M:2, G:1"), casada TOLERANTE contra a
//    grade da loja (número OU letra → chave "34|PPP"); acessório dispensa (usa só qtd total).
//  • foto POR ITEM (modo entidade), bucket "modelos".
//  • upsert por NOME só (produto não tem unique de nome → sem conflito_fornecedor).
//  • moeda (importado) = texto validado contra a lista fixa MOEDAS (não é lookup de banco).

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCat } from "@/lib/fornecedor-categoria";
import { MOEDAS } from "@/lib/moeda";
import { parseNumeroBR } from "../parse";
import type {
  AcaoImport,
  EntidadeAgregada,
  EntityImportDescriptor,
  LookupMaps,
  Problema,
  RawRow,
  ResolvedRow,
} from "../types";

const parseNum = parseNumeroBR;

const TIPOS = new Set(["revenda", "importado"]);
const CODES_MOEDA = new Set(MOEDAS.map((m) => m.code.toLowerCase()));

function look(maps: LookupMaps, id: string, nome: string | undefined): string | null {
  const key = normalizeCat(nome);
  if (!key) return null;
  return (maps[id] as Map<string, string> | undefined)?.get(key) ?? null;
}
function lookForn(maps: LookupMaps, nome: string | undefined): { id: string | null; ambiguo: boolean } {
  const key = normalizeCat(nome);
  if (!key) return { id: null, ambiguo: false };
  const arr = (maps["fornecedores"] as Map<string, string[]> | undefined)?.get(key);
  if (!arr || arr.length === 0) return { id: null, ambiguo: false };
  return { id: arr[0], ambiguo: arr.length > 1 };
}

/** Moeda digitada → code canônico (BRL/USD/RMB/PYG…). Aceita o code OU o nome ("dólar"→USD). */
function resolverMoeda(txt: string | undefined): string | null {
  const t = (txt ?? "").trim();
  if (!t) return null;
  const up = t.toUpperCase();
  if (CODES_MOEDA.has(up.toLowerCase())) return up;
  const porNome = MOEDAS.find((m) => normalizeCat(m.nome) === normalizeCat(t));
  return porNome ? porNome.code : up; // code livre permitido (o banco aceita texto)
}

/** "P:1, M:2, 40:1" → {"38|P":1,"40|M":2,...} casando tamanhos TOLERANTE contra a grade da loja. */
function parseGrade(txt: string | undefined, gradeMap: Map<string, string> | undefined, problemas: Problema[]): Record<string, number> {
  const out: Record<string, number> = {};
  const t = (txt ?? "").trim();
  if (!t) return out;
  for (const par of t.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
    const [tamRaw, pesoRaw] = par.split(":").map((s) => s.trim());
    const chave = gradeMap?.get(normalizeCat(tamRaw));
    if (!chave) { problemas.push({ nivel: "aviso", campo: "grade", mensagem: `Tamanho "${tamRaw}" não existe na grade — ignorado.` }); continue; }
    const peso = parseNum(pesoRaw) ?? 1;
    out[chave] = peso;
  }
  return out;
}

export const produtoDescriptor: EntityImportDescriptor = {
  entidade: "produto",
  sheetName: "Produto",
  label: "Produtos",
  nomeCampo: "nome",
  temVariante: true,
  temFoto: true,
  fotoModo: "entidade",
  bucket: "modelos",
  fotoPrefix: "importacao",

  colunas: [
    { key: "tipo", header: "Tipo", required: true, hint: "revenda ou importado", exemplo: "revenda" },
    { key: "nome", header: "Nome", required: true, exemplo: "Camisa Social" },
    { key: "grupo", header: "Grupo", required: true, hint: "grupo do produto (deve existir)", exemplo: "Roupas" },
    { key: "categoria", header: "Categoria", required: true, hint: "categoria do produto (deve existir)", exemplo: "Camisa" },
    { key: "subcategoria1", header: "Subcategoria 1", hint: "opcional (escondida p/ Acessórios)", exemplo: "Manga Longa" },
    { key: "subcategoria2", header: "Subcategoria 2", hint: "opcional" },
    { key: "colecao", header: "Coleção", hint: "opcional (deve existir)" },
    { key: "subcolecao", header: "Subcoleção", hint: "texto livre" },
    { key: "fornecedor", header: "Fornecedor", hint: "empresa ou representante" },
    { key: "ref_fornecedor", header: "Ref. fornecedor", hint: "código do fornecedor" },
    { key: "composicao", header: "Composição" },
    { key: "grade", header: "Grade", hint: 'proporção "tam:peso" (ex.: P:1, M:2, G:1); vazio p/ acessório' },
    { key: "qtd_total", header: "Qtd total", hint: "quantidade total do produto" },
    // variante (1 linha por cor)
    { key: "cor_base", header: "Cor base", hint: "cor base (deve existir)", exemplo: "Azul" },
    { key: "cor_apelido", header: "Cor apelido", hint: "opcional (pertence à cor base)" },
    { key: "peso", header: "Peso", hint: "peso da cor na grade (proporção)" },
    { key: "qtd", header: "Qtd cor", hint: "quantidade desta cor" },
    // REVENDA (BRL)
    { key: "valor_unitario", header: "Valor unitário", hint: "REVENDA: custo unitário (R$)" },
    { key: "desconto_pct", header: "Desconto %", hint: "desconto sobre o custo" },
    { key: "markup_atacado", header: "Markup atacado" },
    { key: "markup_varejo", header: "Markup varejo" },
    // IMPORTADO (câmbio)
    { key: "moeda_compra", header: "Moeda compra", hint: "IMPORTADO: BRL/USD/RMB/PYG", exemplo: "USD" },
    { key: "moeda_intermediaria", header: "Moeda intermediária", hint: "opcional (cadeia M1→M2)" },
    { key: "valor_unitario_m1", header: "Valor unit. (moeda)", hint: "custo unitário na moeda de compra" },
    { key: "cotacao_ref", header: "Cotação ref." },
    { key: "cotacao_final", header: "Cotação final" },
    { key: "peso_kg", header: "Peso (kg)" },
    { key: "transporte_m2", header: "Transporte" },
    { key: "data_pedido", header: "Data pedido", hint: "dd/mm/aaaa" },
    { key: "data_prevista", header: "Data prevista", hint: "dd/mm/aaaa" },
    { key: "data_entrega", header: "Data entrega", hint: "dd/mm/aaaa" },
  ],

  lookups: [
    { id: "grupos", table: "grupos_produto" },
    { id: "categorias", table: "categorias_produto" },
    { id: "sub1", table: "subcategorias1_produto" },
    { id: "sub2", table: "subcategorias2_produto" },
    { id: "colecoes", table: "colecoes" },
    { id: "cores", table: "cores" },
    { id: "apelidos", table: "cores_apelido", extraCols: ["cor_base_id"], apelidoDeCorBase: true },
    { id: "fornecedores", table: "empresas", nameCol: "nome_fantasia", semUnique: true },
    { id: "representantes", table: "representantes", semUnique: true },
    { id: "tamanhos", table: "__grade__", gradeTamanhos: true },
  ],

  gridColunas: [
    { rotulo: "Tipo", escopo: "cabecalho", tipo: "texto", campoId: "tipo", narrow: true, readonly: true },
    { rotulo: "Grupo", escopo: "cabecalho", tipo: "lookup", campoId: "grupo_id", digitadoKey: "grupo", lookupId: "grupos", obrigatorio: true },
    { rotulo: "Categoria", escopo: "cabecalho", tipo: "lookup", campoId: "categoria_id", digitadoKey: "categoria", lookupId: "categorias", obrigatorio: true },
    { rotulo: "Subcat. 1", escopo: "cabecalho", tipo: "lookup", campoId: "subcategoria1_id", digitadoKey: "subcategoria1", lookupId: "sub1" },
    { rotulo: "Subcat. 2", escopo: "cabecalho", tipo: "lookup", campoId: "subcategoria2_id", digitadoKey: "subcategoria2", lookupId: "sub2" },
    { rotulo: "Coleção", escopo: "cabecalho", tipo: "lookup", campoId: "colecao_id", digitadoKey: "colecao", lookupId: "colecoes" },
    { rotulo: "Subcoleção", escopo: "cabecalho", tipo: "texto", campoId: "subcolecao" },
    { rotulo: "Fornecedor", escopo: "cabecalho", tipo: "lookup", campoId: "empresa_id", digitadoKey: "fornecedor", lookupId: "fornecedores", cadastroTipo: "fornecedor" },
    { rotulo: "Composição", escopo: "cabecalho", tipo: "texto", campoId: "composicao", wide: true },
    { rotulo: "Qtd total", escopo: "cabecalho", tipo: "num", campoId: "qtd_total", narrow: true },
    { rotulo: "Valor unit.", escopo: "cabecalho", tipo: "num", campoId: "valor_unitario", moeda: true },
    { rotulo: "Markup varejo", escopo: "cabecalho", tipo: "num", campoId: "markup_varejo", narrow: true },
    { rotulo: "Moeda", escopo: "cabecalho", tipo: "texto", campoId: "moeda_compra", narrow: true },
    { rotulo: "Peso", escopo: "variante", tipo: "num", campoId: "peso", narrow: true },
    { rotulo: "Qtd cor", escopo: "variante", tipo: "num", campoId: "qtd", narrow: true },
  ],

  // Chave natural inclui o TIPO: dois produtos de mesmo nome mas tipos diferentes (revenda "X" e
  // importado "X") são entidades SEPARADAS — sem o tipo, o aggregate os fundiria numa só e o 2º
  // se perderia (achado da revisão). Espelhada no `chave` do resolve e no `.get()` do analisarBanco.
  chaveNatural: (row) => `${normalizeCat(row.tipo)}::${normalizeCat(row.nome)}`,

  resolve(row: RawRow, maps: LookupMaps): ResolvedRow {
    const problemas: Problema[] = [];
    const nome = (row.nome ?? "").trim();
    if (!nome) problemas.push({ nivel: "erro", campo: "nome", mensagem: "Nome do produto é obrigatório." });

    // tipo (revenda|importado)
    let tipo = normalizeCat(row.tipo);
    if (!TIPOS.has(tipo)) {
      problemas.push({ nivel: "erro", campo: "tipo", mensagem: `Tipo "${row.tipo}" inválido — use "revenda" ou "importado".` });
      tipo = "revenda"; // fallback só p/ não quebrar o resolve; a linha fica com erro bloqueante
    }

    const grupo_id = look(maps, "grupos", row.grupo);
    if (!grupo_id) problemas.push({ nivel: "erro", campo: "grupo", mensagem: `Grupo "${row.grupo}" não encontrado no cadastro.` });
    const categoria_id = look(maps, "categorias", row.categoria);
    if (!categoria_id) problemas.push({ nivel: "erro", campo: "categoria", mensagem: `Categoria "${row.categoria}" não encontrada no cadastro.` });
    const subcategoria1_id = look(maps, "sub1", row.subcategoria1);
    if (row.subcategoria1?.trim() && !subcategoria1_id) problemas.push({ nivel: "aviso", campo: "subcategoria1", mensagem: `Subcategoria 1 "${row.subcategoria1}" não encontrada.` });
    const subcategoria2_id = look(maps, "sub2", row.subcategoria2);
    if (row.subcategoria2?.trim() && !subcategoria2_id) problemas.push({ nivel: "aviso", campo: "subcategoria2", mensagem: `Subcategoria 2 "${row.subcategoria2}" não encontrada.` });
    const colecao_id = look(maps, "colecoes", row.colecao);
    if (row.colecao?.trim() && !colecao_id) problemas.push({ nivel: "aviso", campo: "colecao", mensagem: `Coleção "${row.colecao}" não encontrada.` });

    const forn = lookForn(maps, row.fornecedor);
    if (row.fornecedor?.trim() && !forn.id) problemas.push({ nivel: "aviso", campo: "fornecedor", mensagem: `Fornecedor "${row.fornecedor}" não encontrado — ficará em branco.` });
    if (forn.ambiguo) problemas.push({ nivel: "aviso", campo: "fornecedor", mensagem: `Mais de um fornecedor "${row.fornecedor}" — usando o primeiro.` });
    const representante_id = (maps["representantes"] as Map<string, string[]>)?.get(normalizeCat(row.representante))?.[0] ?? null;

    // cor base (obrigatória p/ ter variante) + apelido opcional
    const cor_id = look(maps, "cores", row.cor_base);
    if (!cor_id && row.cor_base?.trim()) problemas.push({ nivel: "erro", campo: "cor_base", mensagem: `Cor base "${row.cor_base}" não encontrada no cadastro.` });
    let cor_apelido_id: string | null = null;
    if (row.cor_apelido?.trim() && cor_id) {
      cor_apelido_id = (maps["apelidos"] as Map<string, string>)?.get(`${cor_id}::${normalizeCat(row.cor_apelido)}`) ?? null;
      if (!cor_apelido_id) problemas.push({ nivel: "erro", campo: "cor_apelido", mensagem: `Apelido "${row.cor_apelido}" não pertence à cor "${row.cor_base}".` });
    }

    // grade (proporção por tamanho)
    const grade_proporcao = parseGrade(row.grade, maps["tamanhos"] as Map<string, string> | undefined, problemas);

    // cabeçalho comum + ramo por tipo
    const cabecalho: Record<string, unknown> = {
      tipo,
      nome,
      grupo_id, categoria_id, subcategoria1_id, subcategoria2_id, colecao_id,
      subcolecao: (row.subcolecao ?? "").trim() || null,
      empresa_id: forn.id, representante_id,
      ref_fornecedor: (row.ref_fornecedor ?? "").trim() || null,
      composicao: (row.composicao ?? "").trim() || null,
      grade_proporcao,
      qtd_total: parseNum(row.qtd_total),
    };
    if (tipo === "revenda") {
      cabecalho.valor_unitario = parseNum(row.valor_unitario);
      cabecalho.desconto_pct = parseNum(row.desconto_pct);
      cabecalho.markup_atacado = parseNum(row.markup_atacado);
      cabecalho.markup_varejo = parseNum(row.markup_varejo);
    } else {
      cabecalho.moeda_compra = resolverMoeda(row.moeda_compra);
      cabecalho.moeda_intermediaria = resolverMoeda(row.moeda_intermediaria);
      cabecalho.valor_unitario_m1 = parseNum(row.valor_unitario_m1);
      cabecalho.cotacao_ref = parseNum(row.cotacao_ref);
      cabecalho.cotacao_final = parseNum(row.cotacao_final);
      cabecalho.peso_kg = parseNum(row.peso_kg);
      cabecalho.transporte_m2 = parseNum(row.transporte_m2);
      cabecalho.desconto_pct = parseNum(row.desconto_pct);
      cabecalho.markup_atacado = parseNum(row.markup_atacado);
      cabecalho.markup_varejo = parseNum(row.markup_varejo);
      cabecalho.data_pedido = isoData(row.data_pedido);
      cabecalho.data_prevista = isoData(row.data_prevista);
      cabecalho.data_entrega = isoData(row.data_entrega);
    }

    // variante (só quando há cor)
    const variantes: Record<string, unknown>[] = [];
    if (cor_id) {
      variantes.push({
        ordem: 0, cor_id, cor_apelido_id,
        peso: parseNum(row.peso) ?? 1,
        qtd: parseNum(row.qtd) ?? 0,
        _corNome: (row.cor_base ?? "").trim(),
        _apelidoNome: (row.cor_apelido ?? "").trim(),
      });
    }

    return { raw: row, cabecalho, variantes, fotoNome: nome, problemas, chave: `${tipo}::${normalizeCat(nome)}` };
  },

  revalidar(ent: EntidadeAgregada): Problema[] {
    const out: Problema[] = [];
    if (!String(ent.cabecalho.nome ?? "").trim()) out.push({ nivel: "erro", campo: "nome", mensagem: "Nome do produto é obrigatório." });
    if (!TIPOS.has(String(ent.cabecalho.tipo ?? ""))) out.push({ nivel: "erro", campo: "tipo", mensagem: "Tipo inválido (revenda ou importado)." });
    if (!ent.cabecalho.grupo_id) out.push({ nivel: "erro", campo: "grupo", mensagem: "Grupo não resolvido." });
    if (!ent.cabecalho.categoria_id) out.push({ nivel: "erro", campo: "categoria", mensagem: "Categoria não resolvida." });
    ent.variantes.forEach((v, i) => { if (v && v.cor_id === null) out.push({ nivel: "erro", campo: "cor_base", mensagem: `Cor base da variante ${i + 1} não resolvida.` }); });
    const editaveis = new Set(["nome", "cor_base", "cor_apelido", "fornecedor", "grupo", "categoria"]);
    for (const p of ent.problemas) if (p.nivel === "aviso" && !editaveis.has(p.campo ?? "")) out.push(p);
    return out;
  },

  // UPSERT por NOME só (produto não tem unique nome). Confronta com a tabela DO TIPO da entidade.
  async analisarBanco(sb: SupabaseClient, entidades: EntidadeAgregada[]): Promise<void> {
    // carrega os dois conjuntos (revenda/importado) uma vez; casa cada entidade pelo seu tipo.
    const [{ data: pas }, { data: pis }] = await Promise.all([
      sb.from("produtos_acabados").select("id, nome, foto_url, produto_acabado_variantes(cor_id, cor_apelido_id)"),
      sb.from("produtos_importados").select("id, nome, foto_url, produto_importado_variantes(cor_id, cor_apelido_id)"),
    ]);
    type PRow = { id: string; nome: string; foto_url: string | null; variantes: { cor_id: string | null; cor_apelido_id: string | null }[] };
    const idx = (rows: unknown[], varKey: string): Map<string, PRow> => {
      const m = new Map<string, PRow>();
      for (const raw of (rows ?? []) as Record<string, unknown>[]) {
        const r: PRow = { id: raw.id as string, nome: raw.nome as string, foto_url: (raw.foto_url as string | null) ?? null, variantes: (raw[varKey] as PRow["variantes"]) ?? [] };
        m.set(normalizeCat(r.nome), r); // 1º por nome (nome pode repetir; pega o 1º)
      }
      return m;
    };
    const porNomeRev = idx(pas ?? [], "produto_acabado_variantes");
    const porNomeImp = idx(pis ?? [], "produto_importado_variantes");

    for (const ent of entidades) {
      const tipo = String(ent.cabecalho.tipo ?? "revenda");
      // o índice do banco é por nome puro (sem o prefixo de tipo da chave interna); casa pelo nome.
      const nomeNorm = normalizeCat(String(ent.cabecalho.nome ?? ""));
      const achou = (tipo === "importado" ? porNomeImp : porNomeRev).get(nomeNorm);
      const sig = (c: unknown, ap: unknown) => `${c ?? ""}::${ap ?? ""}`;
      if (achou) {
        ent.artigoAlvoId = achou.id;
        const setExist = new Set((achou.variantes ?? []).map((v) => sig(v.cor_id, v.cor_apelido_id)));
        ent.estado = "complementar";
        ent.varianteExiste = ent.variantes.map((v) => setExist.has(sig(v.cor_id, v.cor_apelido_id)));
        ent.varianteTemFoto = ent.variantes.map(() => false);
      } else {
        ent.estado = "novo";
        ent.artigoAlvoId = null;
        ent.varianteExiste = ent.variantes.map(() => false);
        ent.varianteTemFoto = ent.variantes.map(() => false);
      }
    }
  },

  async rpc(sb: SupabaseClient, ent: EntidadeAgregada): Promise<AcaoImport | void> {
    const cabecalho = { ...ent.cabecalho };
    if (ent.fotoPath) cabecalho.foto_url = ent.fotoPath;
    const tipo = String(cabecalho.tipo ?? "revenda");
    // remove auxiliares de cliente das variantes (o banco não os conhece).
    const variantes = ent.variantes.map((v) => {
      const { _corNome, _apelidoNome, ...limpa } = v as Record<string, unknown>;
      void _corNome; void _apelidoNome;
      return limpa;
    });
    const { data, error } = await sb.rpc("importar_produto_linha" as never, {
      _cabecalho: cabecalho as never,
      _variantes: variantes as never,
      _tipo: tipo as never,
    });
    if (error) throw error;
    const acao = (data as { acao?: string } | null)?.acao;
    if (acao === "criado" || acao === "complementado" || acao === "inalterado") return acao;
  },
};

/** Data BR "dd/mm/aaaa" (ou ISO) → ISO "aaaa-mm-dd" p/ o banco; vazio/ inválido → null. */
function isoData(txt: string | undefined): string | null {
  const t = (txt ?? "").trim();
  if (!t) return null;
  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}
