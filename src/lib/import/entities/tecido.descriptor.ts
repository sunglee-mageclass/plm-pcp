// Descritor de importação — TECIDO (piloto).
// artigos (cabeçalho) + variantes_tecido (1 linha por cor) + categorias via set_artigo_categorias.
//
// É a ÚNICA peça específica do Tecido: colunas, lookups, resolve (nome→id no cliente) e rpc
// (importar_tecido_linha). O motor genérico (parse/lookup/aggregate/engine) não muda.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCat } from "@/lib/fornecedor-categoria";
import type {
  AcaoImport,
  EntidadeAgregada,
  EntityImportDescriptor,
  LookupMaps,
  Problema,
  RawRow,
  ResolvedRow,
} from "../types";

const UNIDADES = new Set(["metro", "kg"]);

/** parse de número tolerante a vírgula decimal e milhar PT-BR ("1.234,50" → 1234.5). */
function parseNum(s: string | undefined): number | null {
  const v = (s ?? "").trim();
  if (!v) return null;
  const norm = v.replace(/\./g, "").replace(",", ".");
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

/** resolve UM nome num Map simples; devolve id ou null. */
function look(maps: LookupMaps, id: string, nome: string | undefined): string | null {
  const key = normalizeCat(nome);
  if (!key) return null;
  const m = maps[id] as Map<string, string> | undefined;
  return m?.get(key) ?? null;
}

/** resolve fornecedor (empresa) — Map de arrays (homônimo). Devolve {id, ambiguo}. */
function lookFornecedor(maps: LookupMaps, nome: string | undefined): { id: string | null; ambiguo: boolean } {
  const key = normalizeCat(nome);
  if (!key) return { id: null, ambiguo: false };
  const m = maps["fornecedores"] as Map<string, string[]> | undefined;
  const arr = m?.get(key);
  if (!arr || arr.length === 0) return { id: null, ambiguo: false };
  if (arr.length > 1) return { id: arr[0], ambiguo: true };
  return { id: arr[0], ambiguo: false };
}

export const tecidoDescriptor: EntityImportDescriptor = {
  entidade: "tecido",
  sheetName: "Tecido",
  label: "Tecidos",
  temFoto: true,
  // Foto POR VARIANTE (cada COR tem sua foto), não por tecido. Casa por Nome_CorApelido
  // (fallback: Nome_CorBase quando a variante não tem apelido).
  fotoModo: "variante",
  // ⚠️ foto de VARIANTE de tecido mora no bucket "tecido-variantes" (VARIANT_BUCKET), que é o que
  // o Sheet/`useSignedUrl` lê por default — NÃO "modelos". Bucket errado = signed URL 400 e a foto
  // nunca carrega (bug do piloto). Prefixo "importacao" é subpasta livre dentro do tenantPrefix.
  bucket: "tecido-variantes",
  fotoPrefix: "importacao",

  // chave de foto de uma variante = nome do tecido + "_" + apelido (ou cor base se sem apelido).
  chaveFotoVariante(ent, varIdx) {
    const v = ent.variantes[varIdx] as { _corNome?: string; _apelidoNome?: string } | undefined;
    const nome = String(ent.cabecalho.nome ?? "");
    const sufixo = (v?._apelidoNome || v?._corNome || "").trim();
    return normalizeCat(`${nome}_${sufixo}`);
  },

  colunas: [
    { key: "nome", header: "Nome", required: true, hint: "nome do tecido", exemplo: "Malha Fiore" },
    { key: "unidade", header: "Unidade", hint: "metro ou kg (default metro)", exemplo: "metro" },
    { key: "ncm", header: "NCM", exemplo: "6006.32" },
    { key: "fornecedor", header: "Fornecedor", hint: "nome da empresa fornecedora", exemplo: "Tecidos Suzy" },
    { key: "representante", header: "Representante", hint: "nome do representante" },
    { key: "categorias", header: "Categorias", hint: "1+ categorias de tecido separadas por vírgula", exemplo: "Malha" },
    { key: "composicao", header: "Composição", exemplo: "95% algodão 5% elastano" },
    { key: "rendimento", header: "Rendimento", hint: "só p/ unidade kg (m/kg)" },
    { key: "preco", header: "Preço", hint: "preço de referência (R$)", exemplo: "28,00" },
    { key: "mes", header: "Mês", hint: "nome do mês (deve existir no cadastro)" },
    { key: "ano", header: "Ano", hint: "ano (deve existir no cadastro)" },
    // variante (1 linha por cor)
    { key: "cor_base", header: "Cor base", required: true, hint: "cor base (deve existir no cadastro)", exemplo: "Azul" },
    { key: "cor_apelido", header: "Cor apelido", hint: "apelido da cor base (opcional)", exemplo: "Petróleo" },
    { key: "nome_variante", header: "Nome da variante", hint: "opcional" },
    { key: "codigo_variante", header: "Código da variante", hint: "opcional" },
    { key: "preco_variante", header: "Preço da variante", hint: "preço desta cor (R$)", exemplo: "28,00" },
  ],

  lookups: [
    { id: "cores", table: "cores" },
    { id: "apelidos", table: "cores_apelido", extraCols: ["cor_base_id"], apelidoDeCorBase: true },
    { id: "categorias", table: "categorias_tecido" },
    { id: "meses", table: "meses", nameCol: "mes" },
    { id: "anos", table: "anos", nameCol: "ano" },
    { id: "fornecedores", table: "empresas", nameCol: "nome_fantasia", semUnique: true },
    { id: "representantes", table: "representantes", semUnique: true },
  ],

  nomeCampo: "nome",
  temVariante: true,

  // colunas da grade de análise (reproduz o que a TabelaAnalise mostrava hardcoded p/ tecido).
  gridColunas: [
    { rotulo: "Unidade", escopo: "cabecalho", tipo: "unidade", campoId: "unidade_medida" },
    { rotulo: "Rendimento", escopo: "cabecalho", tipo: "num", campoId: "rendimento", narrow: true },
    { rotulo: "NCM", escopo: "cabecalho", tipo: "texto", campoId: "ncm", narrow: true },
    { rotulo: "Fornecedor", escopo: "cabecalho", tipo: "lookup", campoId: "empresa_id", digitadoKey: "fornecedor", lookupId: "fornecedores", cadastroTipo: "fornecedor" },
    { rotulo: "Representante", escopo: "cabecalho", tipo: "lookup", campoId: "representante_id", digitadoKey: "representante", lookupId: "representantes" },
    { rotulo: "Categorias", escopo: "cabecalho", tipo: "multi-lookup", campoId: "__categorias", lookupId: "categorias", cadastroTipo: "categoria" },
    { rotulo: "Composição", escopo: "cabecalho", tipo: "texto", campoId: "composicao", wide: true },
    { rotulo: "Preço", escopo: "cabecalho", tipo: "num", campoId: "preco" },
    { rotulo: "Mês", escopo: "cabecalho", tipo: "lookup", campoId: "mes_id", digitadoKey: "mes", lookupId: "meses" },
    { rotulo: "Ano", escopo: "cabecalho", tipo: "lookup", campoId: "ano_id", digitadoKey: "ano", lookupId: "anos" },
    { rotulo: "Nome variante", escopo: "variante", tipo: "texto", campoId: "nome_variante" },
    { rotulo: "Cód. var.", escopo: "variante", tipo: "texto", campoId: "codigo_variante", narrow: true },
    { rotulo: "Preço var.", escopo: "variante", tipo: "num", campoId: "preco" },
  ],

  chaveNatural: (row) => normalizeCat(row.nome),

  resolve(row: RawRow, maps: LookupMaps): ResolvedRow {
    const problemas: Problema[] = [];
    const nome = (row.nome ?? "").trim();
    if (!nome) problemas.push({ nivel: "erro", campo: "nome", mensagem: "Nome do tecido é obrigatório." });

    // unidade
    let unidade = normalizeCat(row.unidade) || "metro";
    if (!UNIDADES.has(unidade)) {
      problemas.push({ nivel: "aviso", campo: "unidade", mensagem: `Unidade "${row.unidade}" inválida — usando "metro".` });
      unidade = "metro";
    }

    // fornecedor (homônimo = aviso, escolhe o 1º)
    const forn = lookFornecedor(maps, row.fornecedor);
    if (row.fornecedor?.trim() && !forn.id) {
      problemas.push({ nivel: "aviso", campo: "fornecedor", mensagem: `Fornecedor "${row.fornecedor}" não encontrado — ficará em branco.` });
    }
    if (forn.ambiguo) {
      problemas.push({ nivel: "aviso", campo: "fornecedor", mensagem: `Mais de um fornecedor "${row.fornecedor}" — usando o primeiro.` });
    }

    // representante
    const repArr = (maps["representantes"] as Map<string, string[]>)?.get(normalizeCat(row.representante));
    const representante_id = repArr?.[0] ?? null;
    if (row.representante?.trim() && !representante_id) {
      problemas.push({ nivel: "aviso", campo: "representante", mensagem: `Representante "${row.representante}" não encontrado — ficará em branco.` });
    }

    // mês / ano
    const mes_id = look(maps, "meses", row.mes);
    if (row.mes?.trim() && !mes_id) problemas.push({ nivel: "aviso", campo: "mes", mensagem: `Mês "${row.mes}" não encontrado.` });
    const ano_id = look(maps, "anos", row.ano);
    if (row.ano?.trim() && !ano_id) problemas.push({ nivel: "aviso", campo: "ano", mensagem: `Ano "${row.ano}" não encontrado.` });

    // categorias (1+, separadas por vírgula) → ids
    const categoriaIds: string[] = [];
    const catNomes = (row.categorias ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    for (const cn of catNomes) {
      const cid = look(maps, "categorias", cn);
      if (cid) categoriaIds.push(cid);
      else problemas.push({ nivel: "aviso", campo: "categorias", mensagem: `Categoria "${cn}" não encontrada — ignorada.` });
    }

    // variante — cor base (obrigatória)
    const cor_id = look(maps, "cores", row.cor_base);
    if (!cor_id) {
      problemas.push({ nivel: "erro", campo: "cor_base", mensagem: `Cor base "${row.cor_base}" não encontrada no cadastro.` });
    }
    // apelido (opcional) — precisa pertencer à cor base
    let cor_apelido_id: string | null = null;
    if (row.cor_apelido?.trim()) {
      if (cor_id) {
        const apKey = `${cor_id}::${normalizeCat(row.cor_apelido)}`;
        cor_apelido_id = (maps["apelidos"] as Map<string, string>)?.get(apKey) ?? null;
        if (!cor_apelido_id) {
          problemas.push({ nivel: "erro", campo: "cor_apelido", mensagem: `Apelido "${row.cor_apelido}" não pertence à cor "${row.cor_base}".` });
        }
      }
    }

    const cabecalho: Record<string, unknown> = {
      nome,
      unidade_medida: unidade,
      ncm: (row.ncm ?? "").trim() || null,
      empresa_id: forn.id,
      representante_id,
      composicao: (row.composicao ?? "").trim() || null,
      rendimento: unidade === "kg" ? parseNum(row.rendimento) : null,
      preco: parseNum(row.preco),
      mes_id,
      ano_id,
    };

    const variantes: Record<string, unknown>[] = [
      {
        cor_id,
        cor_apelido_id,
        nome_variante: (row.nome_variante ?? "").trim() || null,
        codigo_variante: (row.codigo_variante ?? "").trim() || null,
        preco: parseNum(row.preco_variante),
        // nomes crus p/ montar a chave de foto por variante (Nome_CorApelido). Prefixo "_" =
        // auxiliar do cliente, o `rpc` monta o payload do banco explicitamente e os ignora.
        _corNome: (row.cor_base ?? "").trim(),
        _apelidoNome: (row.cor_apelido ?? "").trim(),
      },
    ];

    return {
      raw: row,
      cabecalho,
      variantes,
      categoriaIds,
      fotoNome: normalizeCat(nome) || null,
      problemas,
      chave: normalizeCat(nome),
    };
  },

  // Recomputa os problemas a partir dos VALORES RESOLVIDOS atuais (após correção inline na tabela).
  // Só os problemas ESTRUTURAIS que dependem de id resolvido: nome presente + cor base por variante.
  // (o apelido↔base já é garantido pelo CelulaLookup, que só lista apelidos da cor base escolhida.)
  // Preserva os avisos não-bloqueantes que não dependem de edição (ex.: mês/ano não achado).
  revalidar(ent: EntidadeAgregada): Problema[] {
    const out: Problema[] = [];
    if (!String(ent.cabecalho.nome ?? "").trim()) {
      out.push({ nivel: "erro", campo: "nome", mensagem: "Nome do tecido é obrigatório." });
    }
    ent.variantes.forEach((v, i) => {
      if (!v.cor_id) {
        out.push({ nivel: "erro", campo: "cor_base", mensagem: `Cor base da variante ${i + 1} não resolvida.` });
      }
    });
    // mantém avisos originais que não são resolvíveis na grade (mês/ano/categoria não achados,
    // cabeçalho divergente) — filtra os erros/avisos de campo já corrigidos.
    const camposEditaveis = new Set(["nome", "cor_base", "cor_apelido", "fornecedor"]);
    for (const p of ent.problemas) {
      if (p.nivel === "aviso" && !camposEditaveis.has(p.campo ?? "")) out.push(p);
    }
    return out;
  },

  // UPSERT INCREMENTAL: confronta cada tecido com o banco e marca o estado (novo/complementar/
  // so_foto/conflito_fornecedor). artigos.nome não tem unique → a decisão é por nome+fornecedor.
  async analisarBanco(sb: SupabaseClient, entidades: EntidadeAgregada[]): Promise<void> {
    // traz todos os artigos da loja (RLS tenant-scoped) + suas variantes (cor/apelido/foto).
    const { data, error } = await sb
      .from("artigos")
      .select("id, nome, empresa_id, empresas(nome_fantasia), variantes_tecido(cor_id, cor_apelido_id, foto_url)");
    if (error) return; // sem consulta → tudo tratado como novo (a RPC ainda faz upsert no servidor)
    type ArtRow = {
      id: string; nome: string; empresa_id: string | null;
      empresas?: { nome_fantasia?: string | null } | null;
      variantes_tecido?: { cor_id: string | null; cor_apelido_id: string | null; foto_url: string | null }[];
    };
    const artigos = (data ?? []) as unknown as ArtRow[];
    // índice por nome normalizado → lista de artigos homônimos (podem ter fornecedores diferentes).
    const porNome = new Map<string, ArtRow[]>();
    for (const a of artigos) {
      const k = normalizeCat(a.nome);
      (porNome.get(k) ?? porNome.set(k, []).get(k)!).push(a);
    }

    for (const ent of entidades) {
      const empresaId = (ent.cabecalho.empresa_id as string | null) ?? null;
      const homonimos = porNome.get(ent.chave) ?? [];
      // 1) mesmo nome + MESMO fornecedor → complementar
      const mesmo = homonimos.find((a) => (a.empresa_id ?? null) === empresaId);
      if (mesmo) {
        marcarEstado(ent, mesmo);
      } else if (homonimos.length > 0) {
        // 2) nome existe, fornecedor diferente → conflito (usuário decide)
        ent.estado = "conflito_fornecedor";
        ent.artigoAlvoId = homonimos[0].id; // candidato p/ "é o mesmo?"
        ent.fornecedorExistenteNome = homonimos[0].empresas?.nome_fantasia ?? null;
        ent.varianteExiste = ent.variantes.map(() => false);
        ent.varianteTemFoto = ent.variantes.map(() => false);
      } else {
        // 3) não existe → novo
        ent.estado = "novo";
        ent.artigoAlvoId = null;
        ent.varianteExiste = ent.variantes.map(() => false);
        ent.varianteTemFoto = ent.variantes.map(() => false);
      }
    }
  },

  async rpc(sb: SupabaseClient, ent: EntidadeAgregada): Promise<AcaoImport | void> {
    const cabecalho = { ...ent.cabecalho };
    // foto POR VARIANTE: cada cor grava sua própria foto_url (ent.fotoPathVariante[i]).
    // Remove os campos auxiliares (_corNome/_apelidoNome) — não são colunas do banco.
    const variantes = ent.variantes.map((v, i) => {
      const { _corNome, _apelidoNome, ...limpa } = v as Record<string, unknown>;
      void _corNome; void _apelidoNome;
      const foto = ent.fotoPathVariante?.[i] ?? null;
      return foto ? { ...limpa, foto_url: foto } : limpa;
    });
    // alvo do upsert: complementar/so_foto usam o artigo existente; conflito só se o usuário
    // confirmou "é o mesmo tecido"; novo = null (a RPC cria). A RPC ainda revalida por nome+forn.
    const alvo =
      ent.estado === "complementar" || ent.estado === "so_foto"
        ? ent.artigoAlvoId ?? null
        : ent.estado === "conflito_fornecedor" && ent.mesmoTecidoConfirmado
          ? ent.artigoAlvoId ?? null
          : null;
    const { data, error } = await sb.rpc("importar_tecido_linha" as never, {
      _cabecalho: cabecalho as never,
      _variantes: variantes as never,
      _categoria_ids: (ent.categoriaIds ?? []) as never,
      _artigo_alvo_id: alvo as never,
    });
    if (error) throw error;
    // a RPC retorna {artigo_id, acao, ...} — devolve a ação p/ o relatório.
    const acao = (data as { acao?: string } | null)?.acao;
    if (acao === "criado" || acao === "complementado" || acao === "so_foto" || acao === "inalterado") return acao;
  },
};

/** Marca estado (complementar / so_foto) confrontando as variantes do payload com as do artigo. */
function marcarEstado(
  ent: EntidadeAgregada,
  art: { id: string; variantes_tecido?: { cor_id: string | null; cor_apelido_id: string | null; foto_url: string | null }[] },
): void {
  ent.artigoAlvoId = art.id;
  const existentes = art.variantes_tecido ?? [];
  const sig = (cor: unknown, ap: unknown) => `${cor ?? ""}::${ap ?? ""}`;
  const mapExist = new Map(existentes.map((v) => [sig(v.cor_id, v.cor_apelido_id), v]));
  ent.varianteExiste = [];
  ent.varianteTemFoto = [];
  let temNova = false;
  let completaFoto = false;
  for (const v of ent.variantes) {
    const achou = mapExist.get(sig(v.cor_id, v.cor_apelido_id));
    ent.varianteExiste.push(!!achou);
    const temFoto = !!(achou?.foto_url && achou.foto_url !== "");
    ent.varianteTemFoto.push(temFoto);
    if (!achou) temNova = true;
    else if (!temFoto) completaFoto = true; // existe sem foto → candidata a "só foto"
  }
  ent.estado = temNova ? "complementar" : completaFoto ? "so_foto" : "complementar";
  // (se nada novo e nenhuma foto a completar, ainda marca "complementar" — a RPC devolve
  //  "inalterado" e o engine reporta como pulado; o estado aqui é só p/ agrupar a UI.)
}
