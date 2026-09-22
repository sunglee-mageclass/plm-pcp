// Descritor de importação — AVIAMENTO (Fase 2). Espelha o tecido, com as diferenças:
//  • Nome = `codigo_nome`; código (`codigo`) é AUTO por trigger (não passar).
//  • 1 categoria/subcategoria/material no cabeçalho (não N-para-N).
//  • Foto é POR-ITEM (aviamentos.foto_url, bucket "aviamentos") → fotoModo "entidade", casa pelo
//    nome do aviamento com sufixo _Modelo/_Referencia/_Desenho (como produto).
//  • Cor SÓ nas variantes (a cor do cabeçalho de aviamentos é legada/inerte — não usar).
//  • intervalos_largura usa a coluna `intervalo` (não `nome`).
//  • RPC importar_aviamento_linha (upsert; molde importar_tecido_linha).

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCat } from "@/lib/fornecedor-categoria";
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

/** parse de número tolerante a vírgula/milhar PT-BR e a ponto-decimal do SheetJS. */
const parseNum = parseNumeroBR;
function look(maps: LookupMaps, id: string, nome: string | undefined): string | null {
  const key = normalizeCat(nome);
  if (!key) return null;
  return (maps[id] as Map<string, string> | undefined)?.get(key) ?? null;
}
function lookForn(maps: LookupMaps, nome: string | undefined): { id: string | null; ambiguo: boolean } {
  const key = normalizeCat(nome);
  if (!key) return { id: null, ambiguo: false };
  const arr = (maps["fornecedores"] as Map<string, string[]> | undefined)?.get(key);
  if (!arr?.length) return { id: null, ambiguo: false };
  return { id: arr[0], ambiguo: arr.length > 1 };
}

export const aviamentoDescriptor: EntityImportDescriptor = {
  entidade: "aviamento",
  sheetName: "Aviamento",
  label: "Aviamentos",
  nomeCampo: "codigo_nome", // o nome exibível do aviamento mora em codigo_nome (não "nome")
  temFoto: true,
  fotoModo: "entidade", // foto POR ITEM (aviamentos.foto_url), casa pelo nome + sufixo _Modelo/_Referencia/_Desenho
  bucket: "aviamentos",
  fotoPrefix: "importacao",

  colunas: [
    { key: "nome", header: "Nome", required: true, hint: "nome do aviamento (o código é gerado automático)", exemplo: "Zíper Metal 20cm" },
    { key: "categoria", header: "Categoria", hint: "categoria de aviamento (dá a sigla do código)", exemplo: "Zíper" },
    { key: "subcategoria", header: "Subcategoria", hint: "subcategoria de aviamento" },
    { key: "material", header: "Material", hint: "material de aviamento" },
    { key: "fornecedor", header: "Fornecedor", hint: "nome da empresa fornecedora", exemplo: "Aviamentos Silva" },
    { key: "representante", header: "Representante", hint: "nome do representante" },
    { key: "composicao", header: "Composição", exemplo: "100% poliéster" },
    { key: "preco", header: "Preço", hint: "preço de referência (R$)", exemplo: "2,50" },
    { key: "ncm", header: "NCM", exemplo: "9607.11.00" },
    { key: "intervalo_largura", header: "Intervalo de largura", hint: "intervalo cadastrado (ex.: 10-20mm)" },
    { key: "largura_exata", header: "Largura exata", hint: "largura em mm (opcional)" },
    { key: "observacoes", header: "Observações", hint: "opcional" },
    // variante (1 linha por cor)
    { key: "cor_base", header: "Cor base", hint: "cor base (opcional — aviamento pode não ter cor)", exemplo: "Preto" },
    { key: "cor_apelido", header: "Cor apelido", hint: "apelido da cor base (opcional)" },
    { key: "nome_variante", header: "Nome da variante", hint: "opcional" },
    { key: "codigo_variante", header: "Código da variante", hint: "opcional" },
    { key: "preco_variante", header: "Preço da variante", hint: "preço desta cor (R$)" },
  ],

  lookups: [
    { id: "cores", table: "cores" },
    { id: "apelidos", table: "cores_apelido", extraCols: ["cor_base_id"], apelidoDeCorBase: true },
    { id: "categorias", table: "categorias_aviamento" },
    { id: "subcategorias", table: "subcategorias_aviamento" },
    { id: "materiais", table: "materiais_aviamento" },
    { id: "intervalos", table: "intervalos_largura", nameCol: "intervalo" }, // ⚠️ coluna é `intervalo`, não `nome`
    { id: "fornecedores", table: "empresas", nameCol: "nome_fantasia", semUnique: true },
    { id: "representantes", table: "representantes", semUnique: true },
  ],

  temVariante: true, // cor OPCIONAL (a entidade pode ter 0 variantes)

  gridColunas: [
    { rotulo: "Categoria", escopo: "cabecalho", tipo: "lookup", campoId: "categoria_aviamento_id", digitadoKey: "categoria", lookupId: "categorias", cadastroTipo: "categoria" },
    { rotulo: "Subcategoria", escopo: "cabecalho", tipo: "lookup", campoId: "subcategoria_aviamento_id", digitadoKey: "subcategoria", lookupId: "subcategorias" },
    { rotulo: "Material", escopo: "cabecalho", tipo: "lookup", campoId: "material_aviamento_id", digitadoKey: "material", lookupId: "materiais" },
    { rotulo: "Fornecedor", escopo: "cabecalho", tipo: "lookup", campoId: "empresa_id", digitadoKey: "fornecedor", lookupId: "fornecedores", cadastroTipo: "fornecedor" },
    { rotulo: "Representante", escopo: "cabecalho", tipo: "lookup", campoId: "representante_id", digitadoKey: "representante", lookupId: "representantes" },
    { rotulo: "Composição", escopo: "cabecalho", tipo: "texto", campoId: "composicao", wide: true },
    { rotulo: "Preço", escopo: "cabecalho", tipo: "num", campoId: "preco", moeda: true },
    { rotulo: "NCM", escopo: "cabecalho", tipo: "texto", campoId: "ncm", narrow: true },
    { rotulo: "Intervalo largura", escopo: "cabecalho", tipo: "lookup", campoId: "intervalo_largura_id", digitadoKey: "intervalo_largura", lookupId: "intervalos" },
    { rotulo: "Largura exata", escopo: "cabecalho", tipo: "num", campoId: "largura_exata" },
    { rotulo: "Observações", escopo: "cabecalho", tipo: "texto", campoId: "observacoes", wide: true },
    { rotulo: "Nome variante", escopo: "variante", tipo: "texto", campoId: "nome_variante" },
    { rotulo: "Cód. var.", escopo: "variante", tipo: "texto", campoId: "codigo_variante", narrow: true },
    { rotulo: "Preço var.", escopo: "variante", tipo: "num", campoId: "preco", moeda: true },
  ],

  chaveNatural: (row) => normalizeCat(row.nome),

  resolve(row: RawRow, maps: LookupMaps): ResolvedRow {
    const problemas: Problema[] = [];
    const nome = (row.nome ?? "").trim();
    if (!nome) problemas.push({ nivel: "erro", campo: "nome", mensagem: "Nome do aviamento é obrigatório." });

    const forn = lookForn(maps, row.fornecedor);
    if (row.fornecedor?.trim() && !forn.id) problemas.push({ nivel: "aviso", campo: "fornecedor", mensagem: `Fornecedor "${row.fornecedor}" não encontrado — ficará em branco.` });
    if (forn.ambiguo) problemas.push({ nivel: "aviso", campo: "fornecedor", mensagem: `Mais de um fornecedor "${row.fornecedor}" — usando o primeiro.` });

    const representante_id = (maps["representantes"] as Map<string, string[]>)?.get(normalizeCat(row.representante))?.[0] ?? null;
    if (row.representante?.trim() && !representante_id) problemas.push({ nivel: "aviso", campo: "representante", mensagem: `Representante "${row.representante}" não encontrado — ficará em branco.` });

    const categoria_aviamento_id = look(maps, "categorias", row.categoria);
    if (row.categoria?.trim() && !categoria_aviamento_id) problemas.push({ nivel: "aviso", campo: "categoria", mensagem: `Categoria "${row.categoria}" não encontrada — ficará em branco (código pode não gerar).` });
    const subcategoria_aviamento_id = look(maps, "subcategorias", row.subcategoria);
    if (row.subcategoria?.trim() && !subcategoria_aviamento_id) problemas.push({ nivel: "aviso", campo: "subcategoria", mensagem: `Subcategoria "${row.subcategoria}" não encontrada.` });
    const material_aviamento_id = look(maps, "materiais", row.material);
    if (row.material?.trim() && !material_aviamento_id) problemas.push({ nivel: "aviso", campo: "material", mensagem: `Material "${row.material}" não encontrado.` });
    const intervalo_largura_id = look(maps, "intervalos", row.intervalo_largura);
    if (row.intervalo_largura?.trim() && !intervalo_largura_id) problemas.push({ nivel: "aviso", campo: "intervalo_largura", mensagem: `Intervalo "${row.intervalo_largura}" não encontrado.` });

    // variante — cor base é OPCIONAL no aviamento (aviamento pode não ter cor).
    const cor_id = look(maps, "cores", row.cor_base);
    if (row.cor_base?.trim() && !cor_id) problemas.push({ nivel: "erro", campo: "cor_base", mensagem: `Cor base "${row.cor_base}" não encontrada no cadastro.` });
    let cor_apelido_id: string | null = null;
    if (row.cor_apelido?.trim() && cor_id) {
      cor_apelido_id = (maps["apelidos"] as Map<string, string>)?.get(`${cor_id}::${normalizeCat(row.cor_apelido)}`) ?? null;
      if (!cor_apelido_id) problemas.push({ nivel: "erro", campo: "cor_apelido", mensagem: `Apelido "${row.cor_apelido}" não pertence à cor "${row.cor_base}".` });
    }

    const cabecalho: Record<string, unknown> = {
      codigo_nome: nome,
      empresa_id: forn.id,
      representante_id,
      categoria_aviamento_id,
      subcategoria_aviamento_id,
      material_aviamento_id,
      composicao: (row.composicao ?? "").trim() || null,
      preco: parseNum(row.preco),
      ncm: (row.ncm ?? "").trim() || null,
      intervalo_largura_id,
      largura_exata: parseNum(row.largura_exata),
      observacoes: (row.observacoes ?? "").trim() || null,
    };

    // variante só existe se tem cor (aviamento sem cor = sem variante).
    const variantes: Record<string, unknown>[] = cor_id ? [{
      cor_id, cor_apelido_id,
      nome_variante: (row.nome_variante ?? "").trim() || null,
      codigo_variante: (row.codigo_variante ?? "").trim() || null,
      preco: parseNum(row.preco_variante),
    }] : [];

    return { raw: row, cabecalho, variantes, fotoNome: normalizeCat(nome) || null, problemas, chave: normalizeCat(nome) };
  },

  revalidar(ent: EntidadeAgregada): Problema[] {
    const out: Problema[] = [];
    if (!String(ent.cabecalho.codigo_nome ?? "").trim()) out.push({ nivel: "erro", campo: "nome", mensagem: "Nome do aviamento é obrigatório." });
    // cor base é opcional; só é erro se a linha TEM variante com cor_id nulo (cor digitada não resolvida)
    ent.variantes.forEach((v, i) => { if (v && v.cor_id === null) out.push({ nivel: "erro", campo: "cor_base", mensagem: `Cor base da variante ${i + 1} não resolvida.` }); });
    const editaveis = new Set(["nome", "cor_base", "cor_apelido", "fornecedor"]);
    for (const p of ent.problemas) if (p.nivel === "aviso" && !editaveis.has(p.campo ?? "")) out.push(p);
    return out;
  },

  // UPSERT: confronta com o banco por nome (codigo_nome) + fornecedor. Foto é do ITEM (aviamentos.foto_url).
  async analisarBanco(sb: SupabaseClient, entidades: EntidadeAgregada[]): Promise<void> {
    const { data, error } = await sb
      .from("aviamentos")
      .select("id, codigo_nome, empresa_id, foto_url, empresas(nome_fantasia), variantes_aviamento(cor_id, cor_apelido_id)");
    if (error) return;
    type AvRow = {
      id: string; codigo_nome: string; empresa_id: string | null; foto_url: string | null;
      empresas?: { nome_fantasia?: string | null } | null;
      variantes_aviamento?: { cor_id: string | null; cor_apelido_id: string | null }[];
    };
    const avs = (data ?? []) as unknown as AvRow[];
    const porNome = new Map<string, AvRow[]>();
    for (const a of avs) { const k = normalizeCat(a.codigo_nome); (porNome.get(k) ?? porNome.set(k, []).get(k)!).push(a); }

    for (const ent of entidades) {
      const empresaId = (ent.cabecalho.empresa_id as string | null) ?? null;
      const homonimos = porNome.get(ent.chave) ?? [];
      const mesmo = homonimos.find((a) => (a.empresa_id ?? null) === empresaId);
      if (mesmo) {
        ent.artigoAlvoId = mesmo.id;
        const existentes = mesmo.variantes_aviamento ?? [];
        const sig = (c: unknown, ap: unknown) => `${c ?? ""}::${ap ?? ""}`;
        const setExist = new Set(existentes.map((v) => sig(v.cor_id, v.cor_apelido_id)));
        const temNova = ent.variantes.some((v) => !setExist.has(sig(v.cor_id, v.cor_apelido_id)));
        const semFotoNoBanco = !mesmo.foto_url;
        ent.estado = temNova ? "complementar" : semFotoNoBanco && ent.fotoNome ? "so_foto" : "complementar";
        ent.varianteExiste = ent.variantes.map((v) => setExist.has(sig(v.cor_id, v.cor_apelido_id)));
        ent.varianteTemFoto = ent.variantes.map(() => false);
      } else if (homonimos.length > 0) {
        ent.estado = "conflito_fornecedor";
        ent.artigoAlvoId = homonimos[0].id;
        ent.fornecedorExistenteNome = homonimos[0].empresas?.nome_fantasia ?? null;
        ent.varianteExiste = ent.variantes.map(() => false);
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
    // foto POR ITEM (modo entidade): ent.fotoPath vai em aviamentos.foto_url.
    if (ent.fotoPath) cabecalho.foto_url = ent.fotoPath;
    const variantes = ent.variantes.map((v) => ({ ...v })); // variante de aviamento não tem foto
    const alvo =
      ent.estado === "complementar" || ent.estado === "so_foto"
        ? ent.artigoAlvoId ?? null
        : ent.estado === "conflito_fornecedor" && ent.mesmoTecidoConfirmado
          ? ent.artigoAlvoId ?? null
          : null;
    const { data, error } = await sb.rpc("importar_aviamento_linha" as never, {
      _cabecalho: cabecalho as never,
      _variantes: variantes as never,
      _aviamento_alvo_id: alvo as never,
    });
    if (error) throw error;
    const acao = (data as { acao?: string } | null)?.acao;
    if (acao === "criado" || acao === "complementado" || acao === "so_foto" || acao === "inalterado") return acao;
  },
};
