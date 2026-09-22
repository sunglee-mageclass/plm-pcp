// Descritor de importação — MODELO INTERNO (produção interna), Fase 4 final.
// Decisão do dono: a importação cria APENAS O CARD no Planejamento (cabeçalho + grade opcional),
// não o BOM. O BOM (tecidos/aviamentos/insumos/serviços) o usuário monta depois no Desenvolvimento,
// no fluxo normal — igual a revenda/importado, que também nascem só como card. Assim a planilha é
// 1 linha por modelo (flat, sem linhas-filhas) e a importação não "joga no Desenvolvimento".
//
// origem='interno' (INSERT direto em `modelos`), ordem_criacao_enviada=false (entra no Dev depois,
// e aí ganha REF pelo fluxo ref_auto da invariante 11). Só cria NOVOS (nome existe → PULA).

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

function look(maps: LookupMaps, id: string, nome: string | undefined): string | null {
  const key = normalizeCat(nome);
  if (!key) return null;
  return (maps[id] as Map<string, string> | undefined)?.get(key) ?? null;
}

export const modeloDescriptor: EntityImportDescriptor = {
  entidade: "modelo",
  sheetName: "Modelo",
  label: "Modelos (produção interna)",
  nomeCampo: "nome",
  temVariante: false,
  temFoto: false,

  colunas: [
    { key: "nome", header: "Nome do modelo", required: true, exemplo: "Camisa Alfaiataria" },
    { key: "categoria", header: "Categoria", required: true, hint: "categoria do produto (deve existir)", exemplo: "Camisa" },
    { key: "subcategoria1", header: "Subcategoria 1", hint: "opcional" },
    { key: "subcategoria2", header: "Subcategoria 2", hint: "opcional" },
    { key: "colecao", header: "Coleção", hint: "opcional" },
    { key: "subcolecao", header: "Subcoleção", hint: "texto livre" },
    { key: "linha", header: "Linha", hint: "linha de produto (opcional)" },
    { key: "semana", header: "Semana", hint: "opcional" },
    { key: "mes", header: "Mês", hint: "opcional" },
    { key: "ano", header: "Ano", hint: "opcional" },
    { key: "grade", header: "Grade", hint: 'proporção "P:16, M:16, G:8" (vazio = sem grade)' },
    { key: "preco_venda", header: "Preço varejo", hint: "R$" },
    { key: "preco_atacado", header: "Preço atacado", hint: "R$" },
  ],

  lookups: [
    { id: "categorias", table: "categorias_produto" },
    { id: "sub1", table: "subcategorias1_produto" },
    { id: "sub2", table: "subcategorias2_produto" },
    { id: "colecoes", table: "colecoes" },
    { id: "linhas", table: "linhas" },
    { id: "meses", table: "meses" },
    { id: "anos", table: "anos", nameCol: "ano" },
    { id: "tamanhos", table: "__grade__", gradeTamanhos: true },
  ],

  gridColunas: [
    { rotulo: "Categoria", escopo: "cabecalho", tipo: "lookup", campoId: "categoria_principal_id", digitadoKey: "categoria", lookupId: "categorias", obrigatorio: true },
    { rotulo: "Subcat. 1", escopo: "cabecalho", tipo: "lookup", campoId: "subcategoria1_id", digitadoKey: "subcategoria1", lookupId: "sub1" },
    { rotulo: "Coleção", escopo: "cabecalho", tipo: "lookup", campoId: "colecao_id", digitadoKey: "colecao", lookupId: "colecoes" },
    { rotulo: "Linha", escopo: "cabecalho", tipo: "lookup", campoId: "linha_id", digitadoKey: "linha", lookupId: "linhas" },
    { rotulo: "Preço varejo", escopo: "cabecalho", tipo: "num", campoId: "preco_venda", moeda: true },
    { rotulo: "Grade", escopo: "cabecalho", tipo: "texto", campoId: "_gradeResumo", readonly: true, narrow: true },
  ],

  chaveNatural: (row) => normalizeCat(row.nome),

  resolve(row: RawRow, maps: LookupMaps): ResolvedRow {
    const problemas: Problema[] = [];
    const nome = (row.nome ?? "").trim();
    if (!nome) problemas.push({ nivel: "erro", campo: "nome", mensagem: "Nome do modelo é obrigatório." });

    const categoria = look(maps, "categorias", row.categoria);
    if (!categoria) problemas.push({ nivel: "erro", campo: "categoria", mensagem: `Categoria "${row.categoria}" não encontrada no cadastro.` });
    const sub1 = look(maps, "sub1", row.subcategoria1);
    if (row.subcategoria1?.trim() && !sub1) problemas.push({ nivel: "aviso", campo: "subcategoria1", mensagem: `Subcategoria 1 "${row.subcategoria1}" não encontrada.` });
    const sub2 = look(maps, "sub2", row.subcategoria2);
    if (row.subcategoria2?.trim() && !sub2) problemas.push({ nivel: "aviso", campo: "subcategoria2", mensagem: `Subcategoria 2 "${row.subcategoria2}" não encontrada.` });
    const colecao = look(maps, "colecoes", row.colecao);
    if (row.colecao?.trim() && !colecao) problemas.push({ nivel: "aviso", campo: "colecao", mensagem: `Coleção "${row.colecao}" não encontrada.` });
    const linha = look(maps, "linhas", row.linha);
    if (row.linha?.trim() && !linha) problemas.push({ nivel: "aviso", campo: "linha", mensagem: `Linha "${row.linha}" não encontrada.` });

    // grade (proporção por tamanho) → 1 linha de grade na variante 1
    const grade = parseGrade(row.grade, maps["tamanhos"] as Map<string, string> | undefined, problemas);
    const total = Object.values(grade).reduce((a, b) => a + b, 0);
    const grades = total > 0 ? [{ variante_numero: 1, grades: grade, grade_total: total }] : [];

    const cabecalho: Record<string, unknown> = {
      nome,
      categoria_principal_id: categoria,
      subcategoria1_id: sub1,
      subcategoria2_id: sub2,
      colecao_id: colecao,
      subcolecao: (row.subcolecao ?? "").trim() || null,
      linha_id: linha,
      semana: (row.semana ?? "").trim() || null,
      mes_id: look(maps, "meses", row.mes),
      ano_id: look(maps, "anos", row.ano),
      preco_venda: parseNum(row.preco_venda),
      preco_atacado: parseNum(row.preco_atacado),
      // baldes de cliente (prefixo "_") não vão ao banco; guardam a grade + o resumo exibível.
      _grades: grades,
      _gradeResumo: total > 0 ? `${total} un` : "—",
    };

    return { raw: row, cabecalho, variantes: [], fotoNome: null, problemas, chave: normalizeCat(nome) };
  },

  revalidar(ent: EntidadeAgregada): Problema[] {
    const out: Problema[] = [];
    if (!String(ent.cabecalho.nome ?? "").trim()) out.push({ nivel: "erro", campo: "nome", mensagem: "Nome do modelo é obrigatório." });
    if (!ent.cabecalho.categoria_principal_id) out.push({ nivel: "erro", campo: "categoria", mensagem: "Categoria não resolvida." });
    return out;
  },

  // UPSERT por nome: existe = a RPC PULA ('inalterado'); senão cria o card.
  async analisarBanco(sb: SupabaseClient, entidades: EntidadeAgregada[]): Promise<void> {
    const { data } = await sb.from("modelos").select("id, nome").eq("origem", "interno");
    const porNome = new Map<string, string>();
    for (const m of (data ?? []) as { id: string; nome: string }[]) porNome.set(normalizeCat(m.nome), m.id);
    for (const ent of entidades) {
      const achou = porNome.get(ent.chave);
      if (achou) { ent.estado = "complementar"; ent.artigoAlvoId = achou; }
      else { ent.estado = "novo"; ent.artigoAlvoId = null; }
      ent.varianteExiste = [];
      ent.varianteTemFoto = [];
    }
  },

  async rpc(sb: SupabaseClient, ent: EntidadeAgregada): Promise<AcaoImport | void> {
    const cab = ent.cabecalho;
    // separa o cabeçalho "puro" (sem baldes/flags "_") da grade.
    const cabecalho: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cab)) if (!k.startsWith("_")) cabecalho[k] = v;
    const grades = Array.isArray(cab._grades) ? cab._grades : [];

    const { data, error } = await sb.rpc("importar_modelo_linha" as never, {
      _cabecalho: cabecalho as never,
      _grades: grades as never,
    });
    if (error) throw error;
    const acao = (data as { acao?: string } | null)?.acao;
    if (acao === "criado" || acao === "complementado" || acao === "inalterado") return acao;
  },
};
