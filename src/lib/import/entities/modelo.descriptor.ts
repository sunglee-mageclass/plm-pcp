// Descritor de importação — MODELO INTERNO (produção interna) com BOM (Fase 4 final).
// Diferente de todas as outras entidades: NÃO agrega "variantes por cor" — agrega um BOM
// heterogêneo (tecidos+cores, aviamentos, insumos, serviços, grade) que vem em LINHAS-FILHAS.
//
// Formato da planilha (1 aba "Modelo", coluna `tipo_linha`):
//  • tipo_linha = "modelo"    → linha de CABEÇALHO (nome, categoria, coleção, preços, grade…).
//  • tipo_linha = "tecido"    → 1 tecido do BOM: artigo + cor base + apelido + consumo (+ tipo forro/entretela).
//  • tipo_linha = "aviamento" → 1 aviamento: codigo_nome + cor + consumo.
//  • tipo_linha = "insumo"    → 1 insumo/etiqueta: nome + cor + consumo.
//  • tipo_linha = "servico"   → 1 serviço/MO: nome do serviço + valor.
// Linhas-filhas repetem o NOME do modelo → agregam nele (hook `mesclar`). O `rpc` monta os 6
// payloads e chama importar_modelo_linha (que cria o modelo interno + BOM; só cria NOVOS).
//
// Variante de tecido não tem nome → resolvida por (artigo+cor+apelido) via lookup `varianteTecido`.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCat } from "@/lib/fornecedor-categoria";
import { parseNumeroBR, parseGrade } from "../parse";
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
const TIPOS_LINHA = new Set(["modelo", "tecido", "aviamento", "insumo", "servico"]);
const TIPOS_TECIDO = new Set(["tecido", "forro", "entretela"]);

function look(maps: LookupMaps, id: string, nome: string | undefined): string | null {
  const key = normalizeCat(nome);
  if (!key) return null;
  return (maps[id] as Map<string, string> | undefined)?.get(key) ?? null;
}

// Item de BOM já resolvido, guardado no cabecalho da entidade sob `_tecidos`/`_aviamentos`/etc.
type BomTecido = { artigo_id: string | null; tipo: string; consumo: number; variantes: (string | null)[]; _rot: string };
type BomAviamento = { aviamento_id: string | null; variante_aviamento_id: string | null; consumo: number; _rot: string };
type BomEtiqueta = { etiqueta_id: string | null; cor_id: string | null; consumo: number; _rot: string };
type BomServico = { categoria_terceirizado_id: string | null; valor: number; _rot: string };

/** Getters tipados dos baldes de BOM guardados no cabecalho (arrays criados sob demanda). */
function balde<T>(cab: Record<string, unknown>, chave: string): T[] {
  if (!Array.isArray(cab[chave])) cab[chave] = [];
  return cab[chave] as T[];
}

export const modeloDescriptor: EntityImportDescriptor = {
  entidade: "modelo",
  sheetName: "Modelo",
  label: "Modelos (produção interna)",
  nomeCampo: "nome",
  temVariante: false,
  temFoto: false,

  colunas: [
    { key: "tipo_linha", header: "Tipo de linha", required: true, opcoes: ["modelo", "tecido", "aviamento", "insumo", "servico"], hint: "modelo = cabeçalho; demais = itens do BOM (mesmo nome de modelo)", exemplo: "modelo" },
    { key: "nome", header: "Nome do modelo", required: true, hint: "repita o mesmo nome nas linhas do BOM", exemplo: "Camisa Alfaiataria" },
    // cabeçalho (linha "modelo")
    { key: "categoria", header: "Categoria", hint: "obrigatória na linha modelo (deve existir)", exemplo: "Camisa" },
    { key: "subcategoria1", header: "Subcategoria 1", hint: "opcional" },
    { key: "subcategoria2", header: "Subcategoria 2", hint: "opcional" },
    { key: "colecao", header: "Coleção", hint: "opcional" },
    { key: "subcolecao", header: "Subcoleção", hint: "texto livre" },
    { key: "linha", header: "Linha", hint: "linha de produto (opcional)" },
    { key: "semana", header: "Semana", hint: "opcional" },
    { key: "mes", header: "Mês", hint: "opcional" },
    { key: "ano", header: "Ano", hint: "opcional" },
    { key: "grade", header: "Grade", hint: 'proporção "P:16, M:16, G:8" (linha modelo; vazio = sem grade)' },
    { key: "preco_venda", header: "Preço varejo", hint: "R$ (linha modelo)" },
    { key: "preco_atacado", header: "Preço atacado", hint: "R$ (linha modelo)" },
    // BOM (linhas tecido/aviamento/insumo/servico): reusa colunas por posição semântica
    { key: "material", header: "Material / Serviço", hint: "BOM: nome do tecido (artigo) / aviamento / insumo / serviço" },
    { key: "cor_base", header: "Cor base", hint: "BOM tecido/aviamento/insumo: cor do material" },
    { key: "cor_apelido", header: "Cor apelido", hint: "BOM: apelido da cor (opcional)" },
    { key: "consumo", header: "Consumo", hint: "BOM tecido/aviamento/insumo: consumo por peça" },
    { key: "tipo_tecido", header: "Tipo de tecido", opcoes: ["tecido", "forro", "entretela"], hint: "BOM tecido: default tecido" },
    { key: "valor", header: "Valor MO", hint: "BOM serviço: valor de mão de obra (R$)" },
  ],

  lookups: [
    { id: "categorias", table: "categorias_produto" },
    { id: "sub1", table: "subcategorias1_produto" },
    { id: "sub2", table: "subcategorias2_produto" },
    { id: "colecoes", table: "colecoes" },
    { id: "linhas", table: "linhas" },
    { id: "meses", table: "meses" },
    { id: "anos", table: "anos", nameCol: "ano" },
    { id: "cores", table: "cores" },
    { id: "apelidos", table: "cores_apelido", extraCols: ["cor_base_id"], apelidoDeCorBase: true },
    { id: "artigos", table: "artigos" },
    { id: "aviamentos", table: "aviamentos", nameCol: "codigo_nome" },
    { id: "etiquetas", table: "etiquetas" },
    { id: "servicos", table: "categorias_terceirizado" },
    { id: "variantesTecido", table: "variantes_tecido", varianteTecido: true },
    { id: "tamanhos", table: "__grade__", gradeTamanhos: true },
  ],

  // grade de análise: só o essencial (o BOM é conferido pelo resumo/relatório, não célula a célula).
  gridColunas: [
    { rotulo: "Tipo", escopo: "cabecalho", tipo: "texto", campoId: "_tipoResumo", narrow: true, readonly: true },
    { rotulo: "Categoria", escopo: "cabecalho", tipo: "lookup", campoId: "categoria_principal_id", digitadoKey: "categoria", lookupId: "categorias", obrigatorio: true },
    { rotulo: "Coleção", escopo: "cabecalho", tipo: "lookup", campoId: "colecao_id", digitadoKey: "colecao", lookupId: "colecoes" },
    { rotulo: "Linha", escopo: "cabecalho", tipo: "lookup", campoId: "linha_id", digitadoKey: "linha", lookupId: "linhas" },
    { rotulo: "Preço varejo", escopo: "cabecalho", tipo: "num", campoId: "preco_venda", moeda: true },
    { rotulo: "Itens de BOM", escopo: "cabecalho", tipo: "texto", campoId: "_bomResumo", readonly: true, wide: true },
  ],

  chaveNatural: (row) => normalizeCat(row.nome),

  resolve(row: RawRow, maps: LookupMaps): ResolvedRow {
    const problemas: Problema[] = [];
    const nome = (row.nome ?? "").trim();
    if (!nome) problemas.push({ nivel: "erro", campo: "nome", mensagem: "Nome do modelo é obrigatório." });

    let tipoLinha = normalizeCat(row.tipo_linha) || "modelo";
    if (!TIPOS_LINHA.has(tipoLinha)) {
      problemas.push({ nivel: "erro", campo: "tipo_linha", mensagem: `Tipo de linha "${row.tipo_linha}" inválido.` });
      tipoLinha = "modelo";
    }

    // cabeçalho SEMPRE existe (a 1ª linha "modelo" o define; linhas-filhas trazem cabeçalho mínimo).
    const cabecalho: Record<string, unknown> = { nome, _linhaCabecalho: tipoLinha === "modelo" };

    if (tipoLinha === "modelo") {
      const categoria = look(maps, "categorias", row.categoria);
      if (!categoria) problemas.push({ nivel: "erro", campo: "categoria", mensagem: `Categoria "${row.categoria}" não encontrada no cadastro.` });
      cabecalho.categoria_principal_id = categoria;
      cabecalho.subcategoria1_id = look(maps, "sub1", row.subcategoria1);
      cabecalho.subcategoria2_id = look(maps, "sub2", row.subcategoria2);
      cabecalho.colecao_id = look(maps, "colecoes", row.colecao);
      cabecalho.subcolecao = (row.subcolecao ?? "").trim() || null;
      cabecalho.linha_id = look(maps, "linhas", row.linha);
      cabecalho.semana = (row.semana ?? "").trim() || null;
      cabecalho.mes_id = look(maps, "meses", row.mes);
      cabecalho.ano_id = look(maps, "anos", row.ano);
      cabecalho.preco_venda = parseNum(row.preco_venda);
      cabecalho.preco_atacado = parseNum(row.preco_atacado);
      // grade → 1 linha de grade na variante 1
      const grade = parseGrade(row.grade, maps["tamanhos"] as Map<string, string> | undefined, problemas);
      const total = Object.values(grade).reduce((a, b) => a + b, 0);
      if (total > 0) balde<Record<string, unknown>>(cabecalho, "_grades").push({ variante_numero: 1, grades: grade, grade_total: total });
    } else if (tipoLinha === "tecido") {
      const artigo_id = look(maps, "artigos", row.material);
      if (!artigo_id) problemas.push({ nivel: "erro", campo: "material", mensagem: `Tecido "${row.material}" não encontrado no cadastro.` });
      const cor_id = look(maps, "cores", row.cor_base);
      if (row.cor_base?.trim() && !cor_id) problemas.push({ nivel: "erro", campo: "cor_base", mensagem: `Cor "${row.cor_base}" não encontrada.` });
      let apelido: string | null = null;
      if (row.cor_apelido?.trim() && cor_id) {
        apelido = (maps["apelidos"] as Map<string, string>)?.get(`${cor_id}::${normalizeCat(row.cor_apelido)}`) ?? null;
        if (!apelido) problemas.push({ nivel: "erro", campo: "cor_apelido", mensagem: `Apelido "${row.cor_apelido}" não pertence à cor "${row.cor_base}".` });
      }
      // variante de tecido = (artigo, cor, apelido)
      let variante_tecido_id: string | null = null;
      if (artigo_id && cor_id) {
        variante_tecido_id = (maps["variantesTecido"] as Map<string, string>)?.get(`${artigo_id}::${cor_id}::${apelido ?? ""}`) ?? null;
        if (!variante_tecido_id) problemas.push({ nivel: "aviso", campo: "cor_base", mensagem: `Variante do tecido "${row.material}" (${row.cor_base}) não existe — o tecido entra sem variante.` });
      }
      let tipoTec = normalizeCat(row.tipo_tecido) || "tecido";
      if (!TIPOS_TECIDO.has(tipoTec)) tipoTec = "tecido";
      const rot = `${row.material ?? "?"}${row.cor_base ? ` (${row.cor_base})` : ""}`;
      balde<BomTecido>(cabecalho, "_tecidos").push({
        artigo_id, tipo: tipoTec, consumo: parseNum(row.consumo) ?? 0,
        variantes: variante_tecido_id ? [variante_tecido_id] : [], _rot: rot,
      });
    } else if (tipoLinha === "aviamento") {
      const aviamento_id = look(maps, "aviamentos", row.material);
      if (!aviamento_id) problemas.push({ nivel: "erro", campo: "material", mensagem: `Aviamento "${row.material}" não encontrado.` });
      // variante de aviamento (opcional) — resolvida pelo cor dentro do aviamento no cliente é
      // complexa; v1 grava sem variante (o consumo é por aviamento). Refino futuro.
      balde<BomAviamento>(cabecalho, "_aviamentos").push({
        aviamento_id, variante_aviamento_id: null, consumo: parseNum(row.consumo) ?? 0,
        _rot: `${row.material ?? "?"}`,
      });
    } else if (tipoLinha === "insumo") {
      const etiqueta_id = look(maps, "etiquetas", row.material);
      if (!etiqueta_id) problemas.push({ nivel: "erro", campo: "material", mensagem: `Insumo "${row.material}" não encontrado.` });
      const cor_id = look(maps, "cores", row.cor_base);
      if (row.cor_base?.trim() && !cor_id) problemas.push({ nivel: "aviso", campo: "cor_base", mensagem: `Cor "${row.cor_base}" não encontrada — insumo sem cor.` });
      balde<BomEtiqueta>(cabecalho, "_etiquetas").push({
        etiqueta_id, cor_id, consumo: parseNum(row.consumo) ?? 0,
        _rot: `${row.material ?? "?"}${row.cor_base ? ` (${row.cor_base})` : ""}`,
      });
    } else if (tipoLinha === "servico") {
      const servico_id = look(maps, "servicos", row.material);
      if (!servico_id) problemas.push({ nivel: "erro", campo: "material", mensagem: `Serviço "${row.material}" não encontrado.` });
      balde<BomServico>(cabecalho, "_servicos").push({
        categoria_terceirizado_id: servico_id, valor: parseNum(row.valor) ?? 0,
        _rot: `${row.material ?? "?"}`,
      });
    }

    return { raw: row, cabecalho, variantes: [], fotoNome: null, problemas, chave: normalizeCat(nome) };
  },

  // Mescla uma linha-filha na entidade acumulada: junta os baldes de BOM; se a nova linha é a
  // linha "modelo", ela é a fonte do cabeçalho (os campos de identidade sobrescrevem os defaults).
  mesclar(ent: EntidadeAgregada, novo: ResolvedRow, row: RawRow): void {
    const dst = ent.cabecalho;
    const src = novo.cabecalho;
    // 2ª linha "modelo" de mesmo nome = duplicata IGNORADA — avisa e NÃO contribui (nem identidade
    // nem BOM). Concatenar seus baldes aqui inseriria grade/BOM duplicado (achado da revisão:
    // modelo_grades não tem unique). Só a 1ª linha modelo + as linhas-filhas contribuem.
    if (src._linhaCabecalho === true && dst._linhaCabecalho === true) {
      ent.problemas.push({ nivel: "aviso", mensagem: `Linha ${row.__linha}: 2ª linha "modelo" com o mesmo nome — ignorada (usando a 1ª).` });
      return;
    }
    // concatena os baldes de BOM (linha-filha, ou o 1º cabeçalho — que pode trazer grade)
    for (const chave of ["_tecidos", "_aviamentos", "_etiquetas", "_servicos", "_grades"]) {
      const arr = src[chave];
      if (Array.isArray(arr) && arr.length) balde<unknown>(dst, chave).push(...arr);
    }
    // se a nova linha é a de cabeçalho (1ª), copia os campos de identidade (não os baldes)
    if (src._linhaCabecalho === true) {
      for (const [k, v] of Object.entries(src)) {
        if (k.startsWith("_")) continue; // pula baldes/flags
        dst[k] = v;
      }
      dst._linhaCabecalho = true;
    }
    ent.problemas.push(...novo.problemas.filter((p) => p.nivel === "erro" || p.nivel === "aviso"));
  },

  revalidar(ent: EntidadeAgregada): Problema[] {
    const out: Problema[] = [];
    if (!String(ent.cabecalho.nome ?? "").trim()) out.push({ nivel: "erro", campo: "nome", mensagem: "Nome do modelo é obrigatório." });
    if (!ent.cabecalho.categoria_principal_id) out.push({ nivel: "erro", campo: "categoria", mensagem: "Categoria não resolvida (linha modelo)." });
    // erros de BOM (material não resolvido) sobem
    for (const p of ent.problemas) if (p.nivel === "erro" && p.campo === "material") out.push(p);
    return out;
  },

  // UPSERT por nome: só marca "novo" ou "complementar" (existe = a RPC PULA sem tocar no BOM).
  async analisarBanco(sb: SupabaseClient, entidades: EntidadeAgregada[]): Promise<void> {
    const { data } = await sb.from("modelos").select("id, nome").eq("origem", "interno");
    const porNome = new Map<string, string>();
    for (const m of (data ?? []) as { id: string; nome: string }[]) porNome.set(normalizeCat(m.nome), m.id);
    for (const ent of entidades) {
      const achou = porNome.get(ent.chave);
      // popula o resumo exibido na grade de análise
      ent.cabecalho._tipoResumo = "modelo";
      ent.cabecalho._bomResumo = resumoBom(ent.cabecalho);
      if (achou) { ent.estado = "complementar"; ent.artigoAlvoId = achou; }
      else { ent.estado = "novo"; ent.artigoAlvoId = null; }
      ent.varianteExiste = [];
      ent.varianteTemFoto = [];
    }
  },

  async rpc(sb: SupabaseClient, ent: EntidadeAgregada): Promise<AcaoImport | void> {
    const cab = ent.cabecalho;
    // separa o cabeçalho "puro" (sem baldes/flags) do BOM.
    const cabecalho: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cab)) if (!k.startsWith("_")) cabecalho[k] = v;

    const tecidos = balde<BomTecido>(cab, "_tecidos").map((t, i) => ({
      artigo_id: t.artigo_id, numero: i + 1, tipo: t.tipo, consumo: t.consumo,
      variantes: t.variantes, multiplicadores: t.variantes.map(() => 1), complementas: t.variantes.map(() => null),
    }));
    const aviamentos = balde<BomAviamento>(cab, "_aviamentos").map((a, i) => ({
      aviamento_id: a.aviamento_id, variante_aviamento_id: a.variante_aviamento_id, numero: i + 1, consumo: a.consumo,
    }));
    const etiquetas = balde<BomEtiqueta>(cab, "_etiquetas").map((e) => ({ etiqueta_id: e.etiqueta_id, cor_id: e.cor_id, consumo: e.consumo }));
    const servicos = balde<BomServico>(cab, "_servicos").map((s) => ({ categoria_terceirizado_id: s.categoria_terceirizado_id, valor: s.valor }));
    const grades = balde<Record<string, unknown>>(cab, "_grades");

    const { data, error } = await sb.rpc("importar_modelo_linha" as never, {
      _cabecalho: cabecalho as never,
      _tecidos: tecidos as never,
      _aviamentos: aviamentos as never,
      _grades: grades as never,
      _etiquetas: etiquetas as never,
      _servicos: servicos as never,
    });
    if (error) throw error;
    const acao = (data as { acao?: string } | null)?.acao;
    if (acao === "criado" || acao === "complementado" || acao === "inalterado") return acao;
  },
};

/** Resumo textual do BOM p/ a grade de análise (ex.: "2 tecidos · 3 aviamentos · 1 serviço"). */
function resumoBom(cab: Record<string, unknown>): string {
  const partes: string[] = [];
  const n = (k: string) => (Array.isArray(cab[k]) ? (cab[k] as unknown[]).length : 0);
  if (n("_tecidos")) partes.push(`${n("_tecidos")} tecido(s)`);
  if (n("_aviamentos")) partes.push(`${n("_aviamentos")} aviamento(s)`);
  if (n("_etiquetas")) partes.push(`${n("_etiquetas")} insumo(s)`);
  if (n("_servicos")) partes.push(`${n("_servicos")} serviço(s)`);
  if (n("_grades")) partes.push("grade");
  return partes.length ? partes.join(" · ") : "—";
}
