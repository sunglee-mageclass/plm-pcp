// Colar do Excel (TSV) na grade "Lista tipo Excel" de Cadastro > Insumos — parte PURA (sem React, sem Supabase).
// Espelha `src/lib/aviamento-grade/colar-tsv.ts` e REUSA do tecido o que é genérico: o parser do bloco (`parseBlocoTsv`/
// `ehBlocoColavel`, com as regras de aspas do Excel), os tipos do resultado, o resumo do toast e o teto de linhas novas. O que é do insumo:
//   • lookups por NOME (os mesmos do `insumo.descriptor.ts`: cores, tipos de insumo, fornecedores, tamanhos da grade — mesma
//     normalização `normalizeCat`);
//   • a coluna TAMANHOS é uma LISTA por vírgula ("34,36,38" ou "P, M, G"; casa o número OU a letra, como o importador): cada item
//     vira uma chave "num|sigla" marcada na cor — é a dimensão que o importador EXPLODE em variantes cor × tamanho (a grade grava a
//     lista no bloco e o Salvar explode, `expandirBlocos`);
//   • o fornecedor é o PAR empresa+representante (colar o nome zera o representante);
//   • o `tamanho_vinculado` não cola (só vale em insumo sem tamanho próprio; edita-se na célula).
// Texto que não resolve NÃO grava: a célula fica como estava e vira aviso (igual ao importador). Colar NUNCA traz foto (insumo não tem).
import { normalizeCat } from "@/lib/fornecedor-categoria";
import { melhorSugestao } from "@/lib/import/fuzzy";
import { parseNumeroBR } from "@/lib/import/parse";
import {
  ehBlocoColavel,
  parseBlocoTsv,
  resumoColagem,
  TETO_LINHAS_NOVAS,
  type Ancora,
  type CelulaIgnorada,
  type CelulaNova,
  type MotivoIgnorada,
  type PatchColagem,
  type ResultadoMapeamento,
} from "@/lib/tecido-grade/colar-tsv";
import type { ColunaGrade } from "./colunas";
import { CAMPO_COR, CAMPO_INSUMO, FORMATOS, UNIDADES, controleDaCelula } from "./celulas";
import { blocoVazio, insumoNovoVazio, type BlocoNovo, type InsumoNovo } from "./linha-nova";

export { ehBlocoColavel, parseBlocoTsv, resumoColagem, TETO_LINHAS_NOVAS };
export type {
  Ancora,
  CelulaIgnorada,
  CelulaNova,
  MotivoIgnorada,
  PatchColagem,
  ResultadoMapeamento,
};

// ============================== 1. lookups por NOME ==============================

type Nome = { id: string; nome: string };

/** As listas que a grade já tem (`GradeOpcoes` serve como está). */
export type OpcoesColagem = {
  empresas: { id: string; nome_fantasia: string }[];
  cores: { id: string; nome: string }[];
  tipos: { id: string; nome: string }[];
  /** `tenant_config.tamanhos_grade`: chaves "num|sigla". */
  tamanhosGrade: readonly string[];
};

export type LookupsColagem = {
  /** nome normalizado -> ids (fornecedor pode ter homônimo). */
  fornecedores: Map<string, string[]>;
  fornecedoresLista: Nome[];
  cores: Map<string, string>;
  coresLista: Nome[];
  tipos: Map<string, string>;
  tiposLista: Nome[];
  /** número ("34"), letra ("ppp") ou chave inteira ("34|ppp") normalizados -> chave da grade ("34|PPP"). */
  tamanhos: Map<string, string>;
  tamanhosLista: Nome[];
};

function mapaPorNome(lista: Nome[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const o of lista) {
    const k = normalizeCat(o.nome);
    if (k && !m.has(k)) m.set(k, o.id);
  }
  return m;
}

/** Monta os mapas "nome normalizado -> id" (mesma normalização do importador: sem acento, minúsculo, trim). */
export function montarLookupsColagem(o: OpcoesColagem): LookupsColagem {
  const fornecedoresLista = o.empresas.map((e) => ({ id: e.id, nome: e.nome_fantasia }));
  const fornecedores = new Map<string, string[]>();
  for (const f of fornecedoresLista) {
    const k = normalizeCat(f.nome);
    if (!k) continue;
    fornecedores.set(k, [...(fornecedores.get(k) ?? []), f.id]);
  }
  const coresLista = o.cores.map((c) => ({ id: c.id, nome: c.nome }));
  const tiposLista = o.tipos.map((c) => ({ id: c.id, nome: c.nome }));
  // grade de tamanhos: casa TOLERANTE (o número E a letra apontam para a chave completa), como o importador
  const tamanhos = new Map<string, string>();
  for (const chave of o.tamanhosGrade) {
    tamanhos.set(normalizeCat(chave), chave);
    const [num, sigla] = chave.split("|");
    if (num && !tamanhos.has(normalizeCat(num))) tamanhos.set(normalizeCat(num), chave);
    if (sigla && !tamanhos.has(normalizeCat(sigla))) tamanhos.set(normalizeCat(sigla), chave);
  }
  return {
    fornecedores,
    fornecedoresLista,
    cores: mapaPorNome(coresLista),
    coresLista,
    tipos: mapaPorNome(tiposLista),
    tiposLista,
    tamanhos,
    tamanhosLista: o.tamanhosGrade.map((t) => ({ id: t, nome: t.replace("|", " · ") })),
  };
}

// ============================== 2. resolução célula a célula ==============================

export type OpcoesMapeamento = {
  lookups?: LookupsColagem;
  /** `null` = aceita; texto = motivo de recusar a célula (insumo sem cores, cabeçalho herdado, formato "nenhum"…). */
  aceitaCelula?: (linhaIdx: number, colKey: string) => string | null;
  tetoNovas?: number;
};

/** Colunas que o colar preenche (texto, número, seleção e a lista de tamanhos); só-leitura e o tamanho vinculado ficam de fora. */
export function colunaColavel(c: Pick<ColunaGrade, "tipo" | "editavel">): boolean {
  const ctl = controleDaCelula(c);
  return ctl === "input" || ctl === "money" || ctl === "select" || ctl === "tamanhos";
}

const limpaTexto = (s: string): string => s.replace(/\u00a0/g, " ").trim();

type Resolucao =
  | { ok: true; valor: unknown; aviso?: string }
  | { ok: false; motivo: MotivoIgnorada; detalhe: string };

const falha = (motivo: MotivoIgnorada, detalhe: string): Resolucao => ({
  ok: false,
  motivo,
  detalhe,
});

type CacheSugestao = Map<string, string | null>;

function sugestao(cache: CacheSugestao, tipo: string, texto: string, lista: Nome[]): string {
  const k = `${tipo}::${normalizeCat(texto)}`;
  if (!cache.has(k)) cache.set(k, melhorSugestao(texto, lista, (o) => o.nome)?.nome ?? null);
  const s = cache.get(k);
  return s ? ` (você quis dizer "${s}"?)` : "";
}

/** Lista de tamanhos colada ("34,36" / "P; M" / "40 | M") -> chaves da grade, sem repetir; o que não casa vira aviso. */
function resolverTamanhos(texto: string, lk: LookupsColagem | undefined): Resolucao {
  const itens = texto
    .split(/[,;\n]/)
    .map((s) => limpaTexto(s))
    .filter(Boolean);
  const chaves: string[] = [];
  const naoAchou: string[] = [];
  for (const t of itens) {
    const chave = lk?.tamanhos.get(normalizeCat(t));
    if (!chave) naoAchou.push(t);
    else if (!chaves.includes(chave)) chaves.push(chave);
  }
  if (chaves.length === 0) {
    return falha(
      "sem-correspondencia",
      `Tamanho "${naoAchou[0] ?? texto}" não existe na grade da loja`,
    );
  }
  return {
    ok: true,
    valor: chaves,
    aviso:
      naoAchou.length > 0
        ? `Tamanho ${naoAchou.map((t) => `"${t}"`).join(", ")} não existe na grade — ignorado`
        : undefined,
  };
}

/**
 * Texto de UMA célula -> valor do rascunho, ou o motivo de não aplicar. Texto vazio: limpa o que é opcional (o chamador já pulou as
 * vazias de nome, unidade, formato e cor: obrigatórios/identificadores não se apagam por colagem).
 */
function resolverCelula(
  col: ColunaGrade,
  textoBruto: string,
  lk: LookupsColagem | undefined,
  cache: CacheSugestao,
): Resolucao {
  const ctl = controleDaCelula(col);
  const texto =
    col.key === "observacoes" ? textoBruto.replace(/\u00a0/g, " ").trim() : limpaTexto(textoBruto);

  if (texto === "") return { ok: true, valor: ctl === "tamanhos" ? [] : null };

  if (ctl === "input") return { ok: true, valor: texto };

  if (ctl === "money") {
    const n = parseNumeroBR(texto.replace(/R\$/gi, "").replace(/[\s\u00a0]/g, ""));
    if (n == null || n < 0) return falha("numero-invalido", `"${texto}" não é um número válido`);
    return { ok: true, valor: Math.round(n * 100) / 100 };
  }

  if (ctl === "tamanhos") return resolverTamanhos(texto, lk);

  // ---- select (pelo NOME)
  const k = normalizeCat(texto);
  switch (col.key) {
    case "tipo_insumo": {
      const id = lk?.tipos.get(k);
      if (!id)
        return falha(
          "sem-correspondencia",
          `Tipo "${texto}" não encontrado${sugestao(cache, "tipo", texto, lk?.tiposLista ?? [])}`,
        );
      return { ok: true, valor: id };
    }
    case "cor": {
      const id = lk?.cores.get(k);
      if (!id)
        return falha(
          "sem-correspondencia",
          `Cor "${texto}" não encontrada no cadastro${sugestao(cache, "cor", texto, lk?.coresLista ?? [])}`,
        );
      return { ok: true, valor: id };
    }
    case "unidade": {
      const u = UNIDADES.find((x) => normalizeCat(x) === k);
      if (!u)
        return falha(
          "sem-correspondencia",
          `Unidade "${texto}" inválida (use ${UNIDADES.join(", ")})`,
        );
      return { ok: true, valor: u };
    }
    case "formato_tamanho": {
      const f = FORMATOS.find((x) => normalizeCat(x.value) === k || normalizeCat(x.label) === k);
      if (!f)
        return falha(
          "sem-correspondencia",
          `Formato "${texto}" inválido (use ${FORMATOS.map((x) => x.value).join(", ")})`,
        );
      return { ok: true, valor: f.value };
    }
    case "fornecedor": {
      const ids = lk?.fornecedores.get(k);
      if (!ids || ids.length === 0) {
        return falha(
          "sem-correspondencia",
          `Fornecedor "${texto}" não encontrado${sugestao(cache, "forn", texto, lk?.fornecedoresLista ?? [])}`,
        );
      }
      return {
        ok: true,
        valor: ids[0],
        aviso: ids.length > 1 ? `Mais de um fornecedor "${texto}" — usado o primeiro` : undefined,
      };
    }
    default:
      return falha("coluna-nao-colavel", `${col.rotulo} não aceita colar`);
  }
}

// ============================== 3. mapeamento do bloco ==============================

/** Vazia nestas colunas não apaga o que a linha já tem (o nome identifica; unidade/formato têm sempre um valor; cor define a linha). */
const COLUNAS_PROTEGIDAS = new Set(["nome", "unidade", "formato_tamanho", "cor"]);

/**
 * Espalha o bloco a partir da âncora. Linhas além de `linhasExistentes` viram `novasLinhas` (cortadas no teto, 500 por padrão).
 * Cada célula vai para uma de três listas: `patches` (linha existente), `novasLinhas` (linha nova) ou `ignoradas` (com o motivo:
 * transbordo da última coluna, coluna só-leitura/vínculo, linha que não aceita, texto sem correspondência…).
 * Célula vazia numa linha NOVA não conta (não há o que limpar).
 */
export function mapearColagem(
  ancora: Ancora,
  bloco: string[][],
  colunasVisiveis: readonly ColunaGrade[],
  linhasExistentes: number,
  opcoes: OpcoesMapeamento = {},
): ResultadoMapeamento {
  const teto = opcoes.tetoNovas ?? TETO_LINHAS_NOVAS;
  const patches: PatchColagem[] = [];
  const novasLinhas: CelulaNova[][] = [];
  const ignoradas: CelulaIgnorada[] = [];
  const cache: CacheSugestao = new Map();
  let novasCortadas = 0;

  for (let i = 0; i < bloco.length; i++) {
    const linhaIdx = ancora.linhaIdx + i;
    const nova = linhaIdx >= linhasExistentes;
    if (nova && linhaIdx - linhasExistentes >= teto) {
      novasCortadas = bloco.length - i;
      break;
    }
    const celulasNova: CelulaNova[] = [];

    for (let j = 0; j < bloco[i].length; j++) {
      const textoBruto = bloco[i][j];
      const colIdx = ancora.colIdx + j;
      // célula vazia fora do que cola (coluna que passou do fim, vínculo…) não conta: não há o que ignorar
      const vazia = limpaTexto(textoBruto) === "";
      if (colIdx >= colunasVisiveis.length) {
        if (vazia) continue;
        ignoradas.push({
          linhaIdx,
          colKey: null,
          motivo: "transbordo",
          detalhe: "Além da última coluna da lista",
          textoBruto,
        });
        continue;
      }
      const col = colunasVisiveis[colIdx];
      if (!colunaColavel(col)) {
        if (vazia) continue;
        ignoradas.push({
          linhaIdx,
          colKey: col.key,
          motivo: "coluna-nao-colavel",
          textoBruto,
          detalhe: `${col.rotulo} não aceita colar (${col.editavel ? "ajuste na célula" : "somente leitura"})`,
        });
        continue;
      }
      // vazia em campo protegido (nome, unidade, formato, cor): não apaga e não faz barulho
      if (vazia && COLUNAS_PROTEGIDAS.has(col.key)) continue;
      if (!nova) {
        const recusa = opcoes.aceitaCelula?.(linhaIdx, col.key) ?? null;
        if (recusa) {
          if (vazia) continue; // nada a colar numa célula que a linha nem tem
          ignoradas.push({
            linhaIdx,
            colKey: col.key,
            motivo: "linha-nao-aceita",
            detalhe: recusa,
            textoBruto,
          });
          continue;
        }
      } else if (vazia) {
        continue;
      }
      const r = resolverCelula(col, textoBruto, opcoes.lookups, cache);
      if (!r.ok) {
        ignoradas.push({
          linhaIdx,
          colKey: col.key,
          motivo: r.motivo,
          detalhe: r.detalhe,
          textoBruto,
        });
        continue;
      }
      if (nova) celulasNova.push({ colKey: col.key, textoBruto, valor: r.valor, aviso: r.aviso });
      else patches.push({ linhaIdx, colKey: col.key, textoBruto, valor: r.valor, aviso: r.aviso });
    }
    if (nova) novasLinhas.push(celulasNova);
  }
  return { patches, novasLinhas, ignoradas, novasCortadas };
}

// ============================== 4. campos do rascunho ==============================

/** O que o insumo tem antes do colar (fornecedor + representante andam juntos). */
export type AtualInsumo = { empresa_id: string | null; representante_id: string | null };

/**
 * Coluna do CABEÇALHO + valor resolvido -> campos do rascunho que mudam. Mesma regra da célula da grade: o fornecedor é o PAR —
 * colar um fornecedor DIFERENTE do atual zera o representante (o do fornecedor antigo não vale); o mesmo fornecedor o mantém.
 * `{}` quando a coluna não é do cabeçalho.
 */
export function camposDoInsumo(
  colKey: string,
  valor: unknown,
  atual: AtualInsumo,
): Record<string, unknown> {
  const campo = CAMPO_INSUMO[colKey];
  if (!campo) return {};
  if (colKey === "fornecedor") {
    const id = (valor as string | null) ?? null;
    return {
      empresa_id: id,
      representante_id: id != null && id === atual.empresa_id ? atual.representante_id : null,
    };
  }
  return { [campo]: valor };
}

/** Coluna da COR + valor resolvido -> campos do bloco da cor. `{}` quando a coluna não é da cor. */
export function camposDaCor(colKey: string, valor: unknown): Record<string, unknown> {
  const campo = CAMPO_COR[colKey];
  return campo ? { [campo]: valor } : {};
}

// ============================== 5. insumos novos a partir das linhas além do fim ==============================

export type AvisoNovo = { linhaNovaIdx: number; colKey: string; msg: string };

export type InsumosNovosColados = {
  grupos: InsumoNovo[];
  /** `tmp` da cor criada por cada linha nova do bloco (mesma ordem de `novasLinhas`). */
  varTmpPorLinha: string[];
  /** Avisos de células aplicadas com ressalva. */
  avisos: AvisoNovo[];
};

/** Coluna do cabeçalho -> campo do cabeçalho do grupo novo. */
const CAMPO_CAB: Readonly<Record<string, string>> = {
  nome: "nome",
  tipo_insumo: "tipo_insumo_id",
  unidade: "unidade",
  fornecedor: "empresa_id",
  preco: "preco",
  formato_tamanho: "formato_tamanho",
  observacoes: "observacoes",
};

/**
 * Linhas novas (já resolvidas) -> insumos novos em rascunho. Linhas SEGUIDAS com o mesmo nome (sem acento/caixa) são cores do mesmo
 * insumo (o cabeçalho vale o da 1ª linha, como no importador); linha sem nome é um insumo à parte (fica PENDENTE, em vermelho, até a
 * pessoa dar o nome). Quem valida e grava é `validarInsumoNovo` / `salvarInsumoNovo`.
 */
export function agruparNovosInsumos(novasLinhas: CelulaNova[][]): InsumosNovosColados {
  const grupos: InsumoNovo[] = [];
  const varTmpPorLinha: string[] = [];
  const avisos: AvisoNovo[] = [];
  let atual: InsumoNovo | null = null;
  let chaveAtual = "";

  for (const [idx, celulas] of novasLinhas.entries()) {
    const nomeCel = celulas.find((c) => c.colKey === "nome");
    const chave = normalizeCat(typeof nomeCel?.valor === "string" ? nomeCel.valor : "");
    const mesmoInsumo = atual != null && chave !== "" && chave === chaveAtual;
    if (!mesmoInsumo || atual == null) {
      atual = insumoNovoVazio();
      if (grupos.length > 0) atual.semRolagem = true; // a vista vai só até o 1º insumo colado
      chaveAtual = chave;
      grupos.push(atual);
    }
    const g: InsumoNovo = atual;
    let cor: BlocoNovo;
    if (mesmoInsumo) {
      cor = blocoVazio();
      g.blocos.push(cor);
    } else {
      cor = g.blocos[0];
    }
    for (const c of celulas) {
      if (c.aviso) avisos.push({ linhaNovaIdx: idx, colKey: c.colKey, msg: c.aviso });
      const campoCab = CAMPO_CAB[c.colKey];
      if (campoCab) {
        // cabeçalho: só a 1ª linha do insumo manda
        if (!mesmoInsumo) {
          (g.cab as Record<string, unknown>)[campoCab] = c.valor;
          if (c.colKey === "fornecedor") g.cab.representante_id = null;
        }
        continue;
      }
      Object.assign(cor, camposDaCor(c.colKey, c.valor));
    }
    varTmpPorLinha.push(cor.tmp);
  }
  return { grupos, varTmpPorLinha, avisos };
}
