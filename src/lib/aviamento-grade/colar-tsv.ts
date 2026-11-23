// Colar do Excel (TSV) na grade "Lista tipo Excel" de Cadastro > Aviamentos — parte PURA (sem React, sem Supabase).
// Espelha `src/lib/tecido-grade/colar-tsv.ts` e REUSA dele o que é genérico: o parser do bloco (`parseBlocoTsv`/`ehBlocoColavel`, com as
// regras de aspas do Excel), os tipos do resultado, o resumo do toast e `camposDaCor` (cor base ↔ apelido). O que é do aviamento:
//   • lookups por NOME (os mesmos do `aviamento.descriptor.ts`: cores, apelidos, categorias, subcategorias, materiais, intervalos
//     de largura, fornecedores — mesma normalização `normalizeCat`);
//   • a subcategoria cascateia pela categoria da linha; o fornecedor é o PAR empresa+representante (colar o nome zera o representante);
//   • o `codigo` é gerado pelo servidor: não cola em linha NOVA e vazio nunca apaga o de uma linha existente.
// Texto que não resolve NÃO grava: a célula fica como estava e vira aviso (igual ao importador). Colar NUNCA traz foto.
import { normalizeCat } from "@/lib/fornecedor-categoria";
import { melhorSugestao } from "@/lib/import/fuzzy";
import { parseNumeroBR } from "@/lib/import/parse";
import {
  camposDaCor,
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
import { CAMPO_AVIAMENTO, controleDaCelula, subcategoriaAposTrocarCategoria } from "./celulas";
import {
  aviamentoNovoVazio,
  varianteVazia,
  type ApelidoRef,
  type AviamentoNovo,
  type VarianteNova,
} from "./linha-nova";

export { camposDaCor, ehBlocoColavel, parseBlocoTsv, resumoColagem, TETO_LINHAS_NOVAS };
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
  coresApelido: { id: string; nome: string; cor_base_id: string | null }[];
  categorias: { id: string; nome: string }[];
  subcategorias: { id: string; nome: string; categoria_aviamento_id: string }[];
  materiais: { id: string; nome: string }[];
  intervalos: { id: string; nome: string }[];
};

export type LookupsColagem = {
  /** nome normalizado -> ids (fornecedor pode ter homônimo). */
  fornecedores: Map<string, string[]>;
  fornecedoresLista: Nome[];
  cores: Map<string, string>;
  coresLista: Nome[];
  nomeDaCor: Map<string, string>;
  apelidos: { id: string; nome: string; norm: string; corBaseId: string | null }[];
  categorias: Map<string, string>;
  categoriasLista: Nome[];
  nomeDaCategoria: Map<string, string>;
  subcategorias: { id: string; nome: string; norm: string; categoriaId: string }[];
  materiais: Map<string, string>;
  materiaisLista: Nome[];
  intervalos: Map<string, string>;
  intervalosLista: Nome[];
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
  const categoriasLista = o.categorias.map((c) => ({ id: c.id, nome: c.nome }));
  const materiaisLista = o.materiais.map((c) => ({ id: c.id, nome: c.nome }));
  const intervalosLista = o.intervalos.map((c) => ({ id: c.id, nome: c.nome }));
  return {
    fornecedores,
    fornecedoresLista,
    cores: mapaPorNome(coresLista),
    coresLista,
    nomeDaCor: new Map(coresLista.map((c) => [c.id, c.nome])),
    apelidos: o.coresApelido.map((a) => ({
      id: a.id,
      nome: a.nome,
      norm: normalizeCat(a.nome),
      corBaseId: a.cor_base_id,
    })),
    categorias: mapaPorNome(categoriasLista),
    categoriasLista,
    nomeDaCategoria: new Map(categoriasLista.map((c) => [c.id, c.nome])),
    subcategorias: o.subcategorias.map((s) => ({
      id: s.id,
      nome: s.nome,
      norm: normalizeCat(s.nome),
      categoriaId: s.categoria_aviamento_id,
    })),
    materiais: mapaPorNome(materiaisLista),
    materiaisLista,
    intervalos: mapaPorNome(intervalosLista),
    intervalosLista,
  };
}

// ============================== 2. resolução célula a célula ==============================

/** O que a linha já tem (o apelido depende da cor base; a subcategoria, da categoria). */
export type ContextoLinha = { corId: string; categoriaId: string };

export type OpcoesMapeamento = {
  lookups?: LookupsColagem;
  /** Valores atuais da linha existente (cor base e categoria do rascunho). Sem ele: nenhuma. */
  contextoLinha?: (linhaIdx: number) => ContextoLinha;
  /** `null` = aceita; texto = motivo de recusar a célula (aviamento sem cores, cabeçalho herdado…). */
  aceitaCelula?: (linhaIdx: number, colKey: string) => string | null;
  tetoNovas?: number;
};

/** Colunas que o colar preenche (texto, número e seleção); foto e só-leitura ficam de fora no MVP. */
export function colunaColavel(c: Pick<ColunaGrade, "tipo" | "editavel">): boolean {
  const ctl = controleDaCelula(c);
  return ctl === "input" || ctl === "money" || ctl === "select";
}

const limpaTexto = (s: string): string => s.replace(/\u00a0/g, " ").trim();

type Resolucao =
  | { ok: true; valor: unknown; aviso?: string; ctx?: Partial<ContextoLinha> }
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

/** Colunas simples de nome (id único por nome): chave da coluna -> [mapa, lista, rótulo para a mensagem]. */
function nomeSimples(
  key: string,
  lk: LookupsColagem | undefined,
): { mapa: Map<string, string> | undefined; lista: Nome[]; rotulo: string } | null {
  switch (key) {
    case "categoria":
      return { mapa: lk?.categorias, lista: lk?.categoriasLista ?? [], rotulo: "Categoria" };
    case "material":
      return { mapa: lk?.materiais, lista: lk?.materiaisLista ?? [], rotulo: "Material" };
    case "intervalo_largura":
      return {
        mapa: lk?.intervalos,
        lista: lk?.intervalosLista ?? [],
        rotulo: "Intervalo de largura",
      };
    default:
      return null;
  }
}

/**
 * Texto de UMA célula -> valor do rascunho, ou o motivo de não aplicar. `ctx` = o que a linha já tem (a cor base já colada na mesma
 * linha vale para o apelido; a categoria para a subcategoria). Texto vazio: limpa o que é opcional (o chamador já pulou as vazias de
 * código e cor base: obrigatórios não se apagam por colagem).
 */
function resolverCelula(
  col: ColunaGrade,
  textoBruto: string,
  ctx: ContextoLinha,
  lk: LookupsColagem | undefined,
  cache: CacheSugestao,
): Resolucao {
  const ctl = controleDaCelula(col);
  const texto =
    col.key === "composicao" || col.key === "observacoes"
      ? textoBruto.replace(/\u00a0/g, " ").trim()
      : limpaTexto(textoBruto);

  if (texto === "") {
    if (col.key === "cor_apelido") return { ok: true, valor: "" };
    // limpar a categoria zera a categoria da linha (a subcategoria colada na MESMA linha deixa de ter de qual cascatear)
    if (col.key === "categoria") return { ok: true, valor: null, ctx: { categoriaId: "" } };
    return { ok: true, valor: null };
  }

  if (ctl === "input") return { ok: true, valor: texto };

  if (ctl === "money") {
    const n = parseNumeroBR(texto.replace(/R\$/gi, "").replace(/[\s\u00a0]/g, ""));
    if (n == null || n < 0) return falha("numero-invalido", `"${texto}" não é um número válido`);
    return { ok: true, valor: Math.round(n * 100) / 100 };
  }

  // ---- select (pelo NOME)
  const k = normalizeCat(texto);
  const simples = nomeSimples(col.key, lk);
  if (simples) {
    const id = simples.mapa?.get(k);
    if (!id) {
      return falha(
        "sem-correspondencia",
        `${simples.rotulo} "${texto}" não encontrado${col.key === "categoria" ? " (o código não gera sem categoria)" : ""}${sugestao(cache, col.key, texto, simples.lista)}`,
      );
    }
    return { ok: true, valor: id, ctx: col.key === "categoria" ? { categoriaId: id } : undefined };
  }
  switch (col.key) {
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
    case "subcategoria": {
      const cands = (lk?.subcategorias ?? []).filter((s) => s.norm === k);
      if (ctx.categoriaId) {
        const s = cands.find((x) => x.categoriaId === ctx.categoriaId);
        if (s) return { ok: true, valor: s.id };
        const nomeCat = lk?.nomeDaCategoria.get(ctx.categoriaId) ?? "da linha";
        const dela = (lk?.subcategorias ?? [])
          .filter((x) => x.categoriaId === ctx.categoriaId)
          .map((x) => ({ id: x.id, nome: x.nome }));
        return falha(
          "sem-correspondencia",
          cands.length > 0
            ? `Subcategoria "${texto}" não pertence à categoria "${nomeCat}"`
            : `Subcategoria "${texto}" não encontrada para a categoria "${nomeCat}"${sugestao(cache, `sub:${ctx.categoriaId}`, texto, dela)}`,
        );
      }
      if (cands.length === 1) return { ok: true, valor: cands[0].id };
      if (cands.length > 1) {
        return falha(
          "sem-correspondencia",
          `Subcategoria "${texto}" existe em mais de uma categoria — cole a Categoria junto`,
        );
      }
      return falha(
        "sem-correspondencia",
        `Subcategoria "${texto}" não encontrada${sugestao(
          cache,
          "sub",
          texto,
          (lk?.subcategorias ?? []).map((x) => ({ id: x.id, nome: x.nome })),
        )}`,
      );
    }
    case "cor_base": {
      const id = lk?.cores.get(k);
      if (!id) {
        return falha(
          "sem-correspondencia",
          `Cor base "${texto}" não encontrada no cadastro${sugestao(cache, "cor", texto, lk?.coresLista ?? [])}`,
        );
      }
      return { ok: true, valor: id, ctx: { corId: id } };
    }
    case "cor_apelido": {
      const cands = (lk?.apelidos ?? []).filter((a) => a.norm === k);
      if (ctx.corId) {
        const a = cands.find((x) => x.corBaseId === ctx.corId);
        if (a) return { ok: true, valor: a.id };
        const nomeCor = lk?.nomeDaCor.get(ctx.corId) ?? "da linha";
        const dela = (lk?.apelidos ?? [])
          .filter((x) => x.corBaseId === ctx.corId)
          .map((x) => ({ id: x.id, nome: x.nome }));
        return falha(
          "sem-correspondencia",
          cands.length > 0
            ? `Apelido "${texto}" não pertence à cor "${nomeCor}"`
            : `Apelido "${texto}" não encontrado para a cor "${nomeCor}"${sugestao(cache, `ap:${ctx.corId}`, texto, dela)}`,
        );
      }
      if (cands.length === 1)
        return { ok: true, valor: cands[0].id, ctx: { corId: cands[0].corBaseId ?? "" } };
      if (cands.length > 1)
        return falha(
          "sem-correspondencia",
          `Apelido "${texto}" existe em mais de uma cor — cole a Cor base junto`,
        );
      return falha("sem-correspondencia", `Apelido "${texto}" não encontrado`);
    }
    default:
      return falha("coluna-nao-colavel", `${col.rotulo} não aceita colar`);
  }
}

// ============================== 3. mapeamento do bloco ==============================

/** Vazia nestas colunas não apaga o que a linha já tem (o código é o identificador; a cor base é o que define a cor). */
const COLUNAS_PROTEGIDAS = new Set(["codigo", "cor_base"]);

/**
 * Espalha o bloco a partir da âncora. Linhas além de `linhasExistentes` viram `novasLinhas` (cortadas no teto, 500 por padrão).
 * Cada célula vai para uma de três listas: `patches` (linha existente), `novasLinhas` (linha nova) ou `ignoradas` (com o motivo:
 * transbordo da última coluna, coluna só-leitura/foto, linha que não aceita, texto sem correspondência…).
 * Célula vazia numa linha NOVA não conta (não há o que limpar). O `codigo` não cola em linha NOVA (o servidor o gera).
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
    const base =
      opcoes.contextoLinha && !nova
        ? opcoes.contextoLinha(linhaIdx)
        : { corId: "", categoriaId: "" };
    const ctx: ContextoLinha = { corId: base.corId, categoriaId: base.categoriaId };
    const celulasNova: CelulaNova[] = [];

    for (let j = 0; j < bloco[i].length; j++) {
      const textoBruto = bloco[i][j];
      const colIdx = ancora.colIdx + j;
      // célula vazia fora do que cola (coluna que passou do fim, foto…) não conta: não há o que ignorar
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
          detalhe: `${col.rotulo} não aceita colar (${col.tipo === "foto" ? "foto" : "somente leitura"})`,
        });
        continue;
      }
      // vazia em campo protegido (código, cor base): não apaga e não faz barulho
      if (vazia && COLUNAS_PROTEGIDAS.has(col.key)) continue;
      if (nova && col.key === "codigo") {
        if (!vazia) {
          ignoradas.push({
            linhaIdx,
            colKey: col.key,
            motivo: "linha-nao-aceita",
            textoBruto,
            detalhe: "O código é gerado automático ao criar o aviamento (a partir da categoria)",
          });
        }
        continue;
      }
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
      const r = resolverCelula(col, textoBruto, ctx, opcoes.lookups, cache);
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
      if (r.ctx) Object.assign(ctx, r.ctx);
      if (nova) celulasNova.push({ colKey: col.key, textoBruto, valor: r.valor, aviso: r.aviso });
      else patches.push({ linhaIdx, colKey: col.key, textoBruto, valor: r.valor, aviso: r.aviso });
    }
    if (nova) novasLinhas.push(celulasNova);
  }
  return { patches, novasLinhas, ignoradas, novasCortadas };
}

// ============================== 4. campos do rascunho ==============================

/** O que o aviamento tem antes do colar (as colunas que se afetam: fornecedor+representante, categoria+subcategoria). */
export type AtualAviamento = {
  empresa_id: string | null;
  representante_id: string | null;
  subcategoria_aviamento_id: string | null;
};

/**
 * Coluna do CABEÇALHO + valor resolvido -> campos do rascunho que mudam. Mesmas regras da célula da grade:
 *  • fornecedor é o PAR: colar um fornecedor DIFERENTE do atual zera o representante (o do fornecedor antigo não vale); o mesmo
 *    fornecedor mantém o representante;
 *  • categoria nova tira a subcategoria que não pertence a ela (a subcategoria cascateia pela categoria).
 * `{}` quando a coluna não é do cabeçalho.
 */
export function camposDoAviamento(
  colKey: string,
  valor: unknown,
  atual: AtualAviamento,
  subcategorias: { id: string; categoria_aviamento_id: string }[],
): Record<string, unknown> {
  const campo = CAMPO_AVIAMENTO[colKey];
  if (!campo) return {};
  if (colKey === "fornecedor") {
    const id = (valor as string | null) ?? null;
    return {
      empresa_id: id,
      representante_id: id != null && id === atual.empresa_id ? atual.representante_id : null,
    };
  }
  if (colKey === "categoria") {
    const id = (valor as string | null) ?? null;
    return {
      categoria_aviamento_id: id,
      subcategoria_aviamento_id: subcategoriaAposTrocarCategoria(
        id,
        atual.subcategoria_aviamento_id,
        subcategorias,
      ),
    };
  }
  return { [campo]: valor };
}

// ============================== 5. aviamentos novos a partir das linhas além do fim ==============================

export type AvisoNovo = { linhaNovaIdx: number; colKey: string; msg: string };

export type AviamentosNovosColados = {
  grupos: AviamentoNovo[];
  /** `tmp` da cor criada por cada linha nova do bloco (mesma ordem de `novasLinhas`). */
  varTmpPorLinha: string[];
  /** Avisos de células aplicadas com ressalva. */
  avisos: AvisoNovo[];
};

/** Coluna do cabeçalho -> campo do cabeçalho do grupo novo (o `codigo` não entra: o servidor o gera). */
const CAMPO_CAB: Readonly<Record<string, string>> = {
  codigo_nome: "codigo_nome",
  fornecedor: "empresa_id",
  preco: "preco",
  ncm: "ncm",
  categoria: "categoria_aviamento_id",
  subcategoria: "subcategoria_aviamento_id",
  material: "material_aviamento_id",
  composicao: "composicao",
  intervalo_largura: "intervalo_largura_id",
  largura_exata: "largura_exata",
  observacoes: "observacoes",
};

/**
 * Linhas novas (já resolvidas) -> aviamentos novos em rascunho. Linhas SEGUIDAS com o mesmo nome (sem acento/caixa) são cores do
 * mesmo aviamento (o cabeçalho vale o da 1ª linha, como no importador); linha sem nome é um aviamento à parte (fica PENDENTE, em
 * vermelho, até a pessoa dar o nome). Quem valida e grava é `validarAviamentoNovo` / `salvarAviamentoNovo`.
 */
export function agruparNovosAviamentos(
  novasLinhas: CelulaNova[][],
  apelidos: ApelidoRef[],
): AviamentosNovosColados {
  const grupos: AviamentoNovo[] = [];
  const varTmpPorLinha: string[] = [];
  const avisos: AvisoNovo[] = [];
  let atual: AviamentoNovo | null = null;
  let chaveAtual = "";

  for (const [idx, celulas] of novasLinhas.entries()) {
    const nomeCel = celulas.find((c) => c.colKey === "codigo_nome");
    const chave = normalizeCat(typeof nomeCel?.valor === "string" ? nomeCel.valor : "");
    const mesmoAviamento = atual != null && chave !== "" && chave === chaveAtual;
    if (!mesmoAviamento || atual == null) {
      atual = aviamentoNovoVazio();
      if (grupos.length > 0) atual.semRolagem = true; // a vista vai só até o 1º aviamento colado
      chaveAtual = chave;
      grupos.push(atual);
    }
    const g: AviamentoNovo = atual;
    let cor: VarianteNova;
    if (mesmoAviamento) {
      cor = varianteVazia();
      g.vars.push(cor);
    } else {
      cor = g.vars[0];
    }
    const corDestino = cor;
    let corAtual: VarianteNova = { ...corDestino };
    for (const c of celulas) {
      if (c.aviso) avisos.push({ linhaNovaIdx: idx, colKey: c.colKey, msg: c.aviso });
      const campoCab = CAMPO_CAB[c.colKey];
      if (campoCab) {
        // cabeçalho: só a 1ª linha do aviamento manda
        if (!mesmoAviamento) (g.cab as Record<string, unknown>)[campoCab] = c.valor;
        continue;
      }
      const campos = camposDaCor(c.colKey, c.valor, corAtual, apelidos);
      corAtual = { ...corAtual, ...campos } as VarianteNova;
    }
    Object.assign(corDestino, corAtual, { tmp: corDestino.tmp });
    varTmpPorLinha.push(corDestino.tmp);
  }
  return { grupos, varTmpPorLinha, avisos };
}
