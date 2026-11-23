// Linha NOVA da grade "Lista tipo Excel" de Cadastro > Tecidos (PURA: sem React, sem Supabase).
// Um "tecido novo" é um GRUPO (cabeçalho + N cores) que só existe em rascunho até o Salvar. No Salvar, cada grupo VÁLIDO vira UMA
// chamada atômica de `importar_tecido_linha` (a mesma RPC da importação por planilha — zero migration).
// Também serve a "cor nova em tecido EXISTENTE": mesmo grupo, com `artigoAlvoId` (a RPC acrescenta a cor ao tecido, sem recriá-lo).
//
// Forma EXATA da RPC (espelha `tecido.descriptor.ts` → `rpc`/`resolve`):
//   sb.rpc("importar_tecido_linha", { _cabecalho, _variantes, _categoria_ids, _artigo_alvo_id })
//   _cabecalho  = colunas de `artigos` (nome, unidade_medida, ncm, empresa_id, representante_id, composicao, rendimento, preco, mes_id, ano_id)
//   _variantes  = [{ cor_id, cor_apelido_id, nome_variante, codigo_variante, preco }]
//   _categoria_ids = uuid[]; _artigo_alvo_id = null (cria) | id (acrescenta cor)
import { parseNumeroBR } from "@/lib/import/parse";
import { paresParaSalvar, type SubPorCat } from "@/lib/tecido-subcategoria";

/** Número vindo da célula (MoneyInput = number) ou digitado/colado (texto BR "1.234,50"). */
export type NumeroEntrada = number | string | null;

/** Cabeçalho do tecido novo (nomes = colunas de `artigos`, como o `ArtigoDraft` da grade). */
export type CabecalhoNovo = {
  nome: string | null;
  empresa_id: string | null;
  preco: NumeroEntrada;
  unidade_medida: string | null;
  largura_estimada: NumeroEntrada;
  composicao: string | null;
  ncm: string | null;
  rendimento: NumeroEntrada;
  mes_id: string | null;
  ano_id: string | null;
};

/** UMA cor do tecido novo. `tmp` liga a linha da tela ao estado. Ids vazios = "" (o Select do Radix não aceita null). */
export type VarianteNova = {
  tmp: string;
  cor_id: string;
  cor_apelido_id: string;
  nome_variante: string | null;
  codigo_variante: string | null;
  preco: NumeroEntrada;
};

export type TecidoNovo = {
  /** Id temporário do grupo (só da tela; some quando o servidor devolve o id real). */
  tmp: string;
  /** null = tecido NOVO; id = cor(es) nova(s) em tecido que já existe. */
  artigoAlvoId: string | null;
  cab: CabecalhoNovo;
  categoriaIds: string[];
  subPorCat: SubPorCat;
  vars: VarianteNova[];
  /** Só da tela: nasceu de uma colagem em lote — não rola a vista até ele (500 grupos rolando de uma vez travam). */
  semRolagem?: boolean;
};

export type ProblemaNovo = {
  /** Chave da coluna da grade (`nome`, `cor_base`, `preco`…), p/ a célula ficar vermelha. */
  campo: string;
  msg: string;
  /** Presente quando o problema é de UMA cor (qual linha pintar). */
  varTmp?: string;
};

const UNIDADES = new Set(["metro", "kg"]);

let seq = 0;
/** Id temporário único na sessão (não vai ao servidor). */
export function novoTmp(prefixo = "novo"): string {
  seq += 1;
  return `${prefixo}-${Date.now().toString(36)}-${seq}`;
}

export function varianteVazia(tmp: string = novoTmp("cor")): VarianteNova {
  return { tmp, cor_id: "", cor_apelido_id: "", nome_variante: null, codigo_variante: null, preco: null };
}

/** "+ Novo tecido": grupo em branco com 1 cor vazia (unidade padrão = metro). */
export function tecidoNovoVazio(tmp: string = novoTmp()): TecidoNovo {
  return {
    tmp,
    artigoAlvoId: null,
    cab: { nome: null, empresa_id: null, preco: null, unidade_medida: "metro", largura_estimada: null, composicao: null, ncm: null, rendimento: null, mes_id: null, ano_id: null },
    categoriaIds: [],
    subPorCat: {},
    vars: [varianteVazia()],
  };
}

/** "+ cor" num tecido existente: só o alvo (id + nome, que a RPC exige) e 1 cor vazia. */
export function corNovaEmExistente(artigoId: string, nomeDoTecido: string, tmp: string = novoTmp()): TecidoNovo {
  const g = tecidoNovoVazio(tmp);
  return { ...g, artigoAlvoId: artigoId, cab: { ...g.cab, nome: nomeDoTecido } };
}

const textoVazio = (v: string | null | undefined): boolean => v == null || v.trim() === "";
const numeroPreenchido = (v: NumeroEntrada): boolean => v != null && !(typeof v === "string" && v.trim() === "");
/** Número digitado/colado: texto BR ou number; vazio → null. `parseNumeroBR` (a mesma da importação). */
const numero = (v: NumeroEntrada): number | null => (numeroPreenchido(v) ? parseNumeroBR(v) : null);

/** Cor "em uso" = a pessoa mexeu em algo nela (cor em branco que sobra no fim não conta nem trava o grupo). */
function varianteTocada(v: VarianteNova): boolean {
  return !!v.cor_id || !!v.cor_apelido_id || !textoVazio(v.nome_variante) || !textoVazio(v.codigo_variante) || numeroPreenchido(v.preco);
}

/** Unidade efetiva: vazia = metro (padrão do cadastro); fora de {metro,kg} = inválida (`null`). */
function unidadeEfetiva(u: string | null | undefined): string | null {
  const x = (u ?? "").trim().toLowerCase();
  if (!x) return "metro";
  return UNIDADES.has(x) ? x : null;
}

/**
 * Valida o grupo. `ok=false` = PENDENTE: não vai ao servidor (os outros grupos válidos vão normalmente — resultado parcial).
 * Regras: nome obrigatório (exceto cor nova em tecido existente, cujo nome já é do tecido); ≥ 1 cor com cor base;
 * cor tocada sem cor base; mesma cor+apelido repetida; unidade ∈ {metro,kg} (vazia = metro); número digitado inválido.
 */
export function validarTecidoNovo(g: TecidoNovo): { ok: boolean; problemas: ProblemaNovo[] } {
  const problemas: ProblemaNovo[] = [];

  if (!g.artigoAlvoId && textoVazio(g.cab.nome)) problemas.push({ campo: "nome", msg: "nome obrigatório" });
  if (unidadeEfetiva(g.cab.unidade_medida) == null) problemas.push({ campo: "unidade", msg: "unidade inválida (metro ou kg)" });

  const nums: [string, NumeroEntrada][] = g.artigoAlvoId
    ? []
    : [["preco", g.cab.preco], ["largura_estimada", g.cab.largura_estimada], ["rendimento", g.cab.rendimento]];
  for (const [campo, v] of nums) {
    if (numeroPreenchido(v) && numero(v) == null) problemas.push({ campo, msg: "número inválido" });
  }

  const tocadas = g.vars.filter(varianteTocada);
  if (!tocadas.some((v) => !!v.cor_id)) {
    problemas.push({ campo: "cor_base", msg: "cor base obrigatória", varTmp: (tocadas[0] ?? g.vars[0])?.tmp });
  }
  const vistas = new Set<string>();
  for (const v of tocadas) {
    if (!v.cor_id) {
      // a 1ª já foi acusada acima quando NENHUMA tem cor; aqui só as tocadas sem cor numa lista que já tem outra com cor
      if (tocadas.some((o) => !!o.cor_id)) problemas.push({ campo: "cor_base", msg: "cor base obrigatória", varTmp: v.tmp });
      continue;
    }
    const k = `${v.cor_id}::${v.cor_apelido_id || ""}`;
    if (vistas.has(k)) problemas.push({ campo: "cor_base", msg: "cor repetida neste tecido", varTmp: v.tmp });
    vistas.add(k);
    if (numeroPreenchido(v.preco) && numero(v.preco) == null) problemas.push({ campo: "preco_variante", msg: "número inválido", varTmp: v.tmp });
  }
  return { ok: problemas.length === 0, problemas };
}

export type ApelidoRef = { id: string; cor_base_id: string | null };

/** Escolher a cor base: o apelido que não pertence a ela sai junto (mesma regra do Sheet e da grade dos existentes). */
export function trocarCorBase(v: VarianteNova, corId: string, apelidos: ApelidoRef[]): VarianteNova {
  const mantem = apelidos.some((a) => a.id === v.cor_apelido_id && a.cor_base_id === corId);
  return { ...v, cor_id: corId, cor_apelido_id: mantem ? v.cor_apelido_id : "" };
}

/** Escolher o apelido: preenche a cor base dele (sem base conhecida, mantém a atual). */
export function trocarApelido(v: VarianteNova, apelidoId: string, apelidos: ApelidoRef[]): VarianteNova {
  const base = apelidos.find((a) => a.id === apelidoId)?.cor_base_id ?? v.cor_id;
  return { ...v, cor_apelido_id: apelidoId, cor_id: base ?? "" };
}

/** Problemas de UMA linha de cor (as de cabeçalho ficam na 1ª linha). */
export function problemasDaVariante(problemas: ProblemaNovo[], varTmp: string): ProblemaNovo[] {
  return problemas.filter((p) => p.varTmp === varTmp);
}

/** Problemas do cabeçalho (os que não são de uma cor específica). */
export function problemasDoCabecalho(problemas: ProblemaNovo[]): ProblemaNovo[] {
  return problemas.filter((p) => p.varTmp == null);
}

export type PayloadImportar = {
  _cabecalho: Record<string, unknown>;
  _variantes: Record<string, unknown>[];
  _categoria_ids: string[];
  _artigo_alvo_id: string | null;
};

/**
 * Payload EXATO de `importar_tecido_linha`. Só chamar com o grupo VÁLIDO (`validarTecidoNovo`).
 *  • tecido novo: cabeçalho completo (mesmas normalizações do `resolve` do descriptor: texto vazio = null, rendimento só em kg,
 *    número BR parseado, unidade vazia = metro) e `_artigo_alvo_id = null`;
 *  • cor nova em tecido existente: cabeçalho SÓ com o nome (a RPC exige o nome e faz `COALESCE(novo, atual)` nos demais — mandar
 *    `unidade_medida: "metro"` por padrão trocaria a unidade de um tecido em Kg) e `_artigo_alvo_id = id`.
 * Cores totalmente em branco são descartadas (a RPC também ignora cor sem `cor_id`).
 * `largura_estimada` vai no cabeçalho por completude, mas a RPC de hoje NÃO a grava: quem grava é `payloadComplemento` (pós-criação).
 */
export function payloadImportar(g: TecidoNovo): PayloadImportar {
  const nome = (g.cab.nome ?? "").trim();
  const variantes = g.vars
    .filter((v) => !!v.cor_id)
    .map((v) => ({
      cor_id: v.cor_id,
      cor_apelido_id: v.cor_apelido_id || null,
      nome_variante: textoVazio(v.nome_variante) ? null : v.nome_variante!.trim(),
      codigo_variante: textoVazio(v.codigo_variante) ? null : v.codigo_variante!.trim(),
      preco: numero(v.preco),
    }));

  if (g.artigoAlvoId) {
    return { _cabecalho: { nome }, _variantes: variantes, _categoria_ids: [], _artigo_alvo_id: g.artigoAlvoId };
  }
  const unidade = unidadeEfetiva(g.cab.unidade_medida) ?? "metro";
  return {
    _cabecalho: {
      nome,
      unidade_medida: unidade,
      ncm: textoVazio(g.cab.ncm) ? null : g.cab.ncm!.trim(),
      empresa_id: g.cab.empresa_id || null,
      representante_id: null,
      composicao: textoVazio(g.cab.composicao) ? null : g.cab.composicao!.trim(),
      rendimento: unidade === "kg" ? numero(g.cab.rendimento) : null,
      preco: numero(g.cab.preco),
      largura_estimada: numero(g.cab.largura_estimada),
      mes_id: g.cab.mes_id || null,
      ano_id: g.cab.ano_id || null,
    },
    _variantes: variantes,
    _categoria_ids: [...g.categoriaIds],
    _artigo_alvo_id: null,
  };
}

/**
 * O que a RPC NÃO grava do tecido que ela CRIA e a tela oferece: largura estimada, `categoria_tecido_id` (a 1ª categoria, como o Sheet)
 * e a SUBCATEGORIA de cada categoria (a RPC grava sempre sub = null). Só vale para tecido NOVO recém-criado (`acao = "criado"`);
 * cor nova em tecido existente não mexe no cabeçalho dele. `null` em cada parte = nada a fazer.
 */
export function payloadComplemento(g: TecidoNovo): {
  artigo: Record<string, unknown> | null;
  pares: { categoria_tecido_id: string; subcategoria_tecido_id: string | null }[] | null;
} {
  if (g.artigoAlvoId) return { artigo: null, pares: null };
  const artigo: Record<string, unknown> = {};
  const largura = numero(g.cab.largura_estimada);
  if (largura != null) artigo.largura_estimada = largura;
  if (g.categoriaIds[0]) artigo.categoria_tecido_id = g.categoriaIds[0];
  const temSub = g.categoriaIds.some((c) => !!g.subPorCat[c]);
  return {
    artigo: Object.keys(artigo).length ? artigo : null,
    pares: temSub ? paresParaSalvar(g.categoriaIds, g.subPorCat) : null,
  };
}

/** Separa os grupos que vão ao servidor dos PENDENTES (que ficam na tela, em vermelho, sem travar os outros). */
export function separarNovos(grupos: TecidoNovo[]): { validos: TecidoNovo[]; pendentes: TecidoNovo[] } {
  const validos: TecidoNovo[] = [];
  const pendentes: TecidoNovo[] = [];
  for (const g of grupos) (validarTecidoNovo(g).ok ? validos : pendentes).push(g);
  return { validos, pendentes };
}
