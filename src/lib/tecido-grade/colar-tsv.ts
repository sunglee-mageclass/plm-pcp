// Colar do Excel (TSV) na grade "Lista tipo Excel" de Cadastro > Tecidos — parte PURA (sem React, sem Supabase).
// 1) `parseBlocoTsv`: texto da área de transferência (colunas por TAB, linhas por quebra) -> matriz de textos.
// 2) `mapearColagem`: a partir da célula-âncora, cada célula colada cai em (linha+i, coluna+j) da grade; resolve o TEXTO em valor
//    (número BR, unidade, e cor/fornecedor/mês/ano/apelido pelo NOME, com os mapas que o CHAMADOR passa — esta lib não lê o banco).
// 3) `agruparNovosTecidos`: as linhas além do fim da grade viram tecidos NOVOS (rascunho da Task 7); linhas seguidas com o mesmo
//    nome são cores do MESMO tecido (como o importador por planilha).
// Texto que não resolve NÃO grava: a célula fica como estava e vira aviso (igual ao importador). Colar NUNCA traz foto.
// Aspas: segue o Excel/Sheets (campo entre aspas pode ter TAB/quebra dentro; `""` = aspas literais). Aspas no MEIO de um campo
// sem aspas no início são texto comum. Aspas que nunca fecham = o resto do texto vira o campo (tolerante, sem travar).
import { normalizeCat } from "@/lib/fornecedor-categoria";
import { melhorSugestao } from "@/lib/import/fuzzy";
import { parseNumeroBR } from "@/lib/import/parse";
import type { ColunaGrade } from "./colunas";
import { controleDaCelula } from "./celulas";
import {
  tecidoNovoVazio,
  trocarApelido,
  trocarCorBase,
  varianteVazia,
  type ApelidoRef,
  type TecidoNovo,
  type VarianteNova,
} from "./linha-nova";

/** Teto de linhas NOVAS por colagem (avisa e corta; não trava a tela). */
export const TETO_LINHAS_NOVAS = 500;

// ============================== 1. parse do bloco ==============================

/**
 * Texto da área de transferência -> matriz [linha][coluna]. Divide por `\r\n`/`\n`/`\r` e por TAB, respeitando campos entre aspas
 * (o Excel/Sheets aspeia a célula que tem TAB, quebra de linha ou aspas). Descarta UMA última linha vazia (a quebra final que o
 * Excel acrescenta). Texto vazio -> `[]`.
 */
export function parseBlocoTsv(texto: string): string[][] {
  const t = (texto ?? "").replace(/^\uFEFF/, "");
  const n = t.length;
  const linhas: string[][] = [];
  let linha: string[] = [];
  let i = 0;
  while (i < n) {
    // ---- um campo
    let campo = "";
    if (t[i] === '"') {
      i++;
      let fechou = false;
      while (i < n) {
        if (t[i] === '"') {
          if (t[i + 1] === '"') {
            campo += '"';
            i += 2;
            continue;
          }
          i++;
          fechou = true;
          break;
        }
        campo += t[i++];
      }
      campo = campo.replace(/\r\n?/g, "\n");
      // lixo depois da aspa que fechou (`"ab"cd`): tolerante, anexa literal até o fim do campo
      if (fechou) while (i < n && t[i] !== "\t" && t[i] !== "\n" && t[i] !== "\r") campo += t[i++];
    } else {
      while (i < n && t[i] !== "\t" && t[i] !== "\n" && t[i] !== "\r") campo += t[i++];
    }
    linha.push(campo);
    // ---- o que vem depois do campo
    if (i >= n) break;
    if (t[i] === "\t") {
      i++;
      if (i >= n) linha.push(""); // TAB final = último campo vazio
      continue;
    }
    // quebra de linha (\r\n, \n ou \r)
    if (t[i] === "\r" && t[i + 1] === "\n") i++;
    i++;
    linhas.push(linha);
    linha = [];
  }
  if (linha.length > 0) linhas.push(linha);
  // a quebra final do Excel não é uma linha de dados
  const ultima = linhas[linhas.length - 1];
  if (ultima && ultima.length === 1 && ultima[0] === "") linhas.pop();
  return linhas;
}

/**
 * O texto colado é um BLOCO (vira colagem em várias células)? Sim se tem mais de 1 linha ou mais de 1 coluna, ou se é UMA célula
 * entre aspas que carrega quebra/aspas dentro (célula do Excel com várias linhas: "95% Viscose\n5% Elastano"). Um valor simples
 * (com ou sem a quebra final do Excel) segue o colar normal do campo.
 */
export function ehBlocoColavel(texto: string, bloco: string[][] = parseBlocoTsv(texto)): boolean {
  if (bloco.length > 1) return true;
  if (bloco.length === 1 && bloco[0].length > 1) return true;
  if (bloco.length === 1 && /^\s*"[\s\S]*"\s*$/.test(texto)) {
    const v = bloco[0][0] ?? "";
    return v.includes("\n") || v.includes('"');
  }
  return false;
}

// ============================== 2. lookups por NOME ==============================

type Nome = { id: string; nome: string };

/** As listas que a grade já tem (`GradeOpcoes` serve como está). */
export type OpcoesColagem = {
  empresas: { id: string; nome_fantasia: string }[];
  cores: { id: string; nome: string }[];
  coresApelido: { id: string; nome: string; cor_base_id: string | null }[];
  meses: { id: string; mes: string }[];
  anos: { id: string; ano: string | number }[];
};

export type LookupsColagem = {
  /** nome normalizado -> ids (fornecedor pode ter homônimo). */
  fornecedores: Map<string, string[]>;
  fornecedoresLista: Nome[];
  cores: Map<string, string>;
  coresLista: Nome[];
  nomeDaCor: Map<string, string>;
  apelidos: { id: string; nome: string; norm: string; corBaseId: string | null }[];
  meses: Map<string, string>;
  mesesLista: Nome[];
  anos: Map<string, string>;
  anosLista: Nome[];
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
  const mesesLista = o.meses.map((m) => ({ id: m.id, nome: m.mes }));
  const anosLista = o.anos.map((a) => ({ id: a.id, nome: String(a.ano) }));
  return {
    fornecedores,
    fornecedoresLista,
    cores: mapaPorNome(coresLista),
    coresLista,
    nomeDaCor: new Map(coresLista.map((c) => [c.id, c.nome])),
    apelidos: o.coresApelido.map((a) => ({ id: a.id, nome: a.nome, norm: normalizeCat(a.nome), corBaseId: a.cor_base_id })),
    meses: mapaPorNome(mesesLista),
    mesesLista,
    anos: mapaPorNome(anosLista),
    anosLista,
  };
}

// ============================== 3. resolução célula a célula ==============================

export type MotivoIgnorada =
  | "transbordo" //          a coluna não existe (o bloco passou da última)
  | "coluna-nao-colavel" //  só leitura, foto ou categorias (fora do MVP)
  | "linha-nao-aceita" //    a linha não tem essa célula editável (tecido sem cores, cabeçalho herdado)
  | "sem-correspondencia" // nome de cor/unidade/apelido que não existe no cadastro
  | "numero-invalido"
  | "regra"; //              regra da grade (rendimento só vale em Kg)

export type CelulaIgnorada = {
  /** Linha da grade (≥ `linhasExistentes` = linha NOVA, na ordem do bloco). */
  linhaIdx: number;
  /** null no transbordo (a coluna não existe). */
  colKey: string | null;
  motivo: MotivoIgnorada;
  detalhe: string;
  textoBruto: string;
};

/** Célula colada num slot que JÁ existe na grade. `valor` já é o valor do rascunho (id, número, texto…). */
export type PatchColagem = {
  linhaIdx: number;
  colKey: string;
  textoBruto: string;
  valor: unknown;
  /** Aplicou, mas com ressalva (ex.: fornecedor homônimo -> usou o primeiro). */
  aviso?: string;
};

/** Célula de uma linha NOVA (além do fim da grade). */
export type CelulaNova = { colKey: string; textoBruto: string; valor: unknown; aviso?: string };

/** O que a linha já tem (o apelido depende da cor base; o rendimento só vale em Kg). */
export type ContextoLinha = { corId: string; unidade: string };

export type OpcoesMapeamento = {
  lookups?: LookupsColagem;
  /** Valores atuais da linha existente (cor base e unidade do rascunho). Sem ele: cor desconhecida, unidade metro. */
  contextoLinha?: (linhaIdx: number) => ContextoLinha;
  /** `null` = aceita; texto = motivo de recusar a célula (tecido sem cores, cabeçalho herdado…). */
  aceitaCelula?: (linhaIdx: number, colKey: string) => string | null;
  tetoNovas?: number;
};

export type ResultadoMapeamento = {
  patches: PatchColagem[];
  /** Linhas além do fim da grade: uma lista de células já resolvidas por linha. */
  novasLinhas: CelulaNova[][];
  ignoradas: CelulaIgnorada[];
  /** Linhas novas que passaram do teto e foram cortadas. */
  novasCortadas: number;
};

const UNIDADE_ALIAS: Readonly<Record<string, "metro" | "kg">> = {
  metro: "metro", metros: "metro", m: "metro", mt: "metro", mts: "metro",
  kg: "kg", kgs: "kg", quilo: "kg", quilos: "kg", kilo: "kg", kilos: "kg", quilograma: "kg", quilogramas: "kg",
};

const COLUNAS_OBRIGATORIAS = new Set(["nome", "unidade", "cor_base"]);

/** Colunas que o colar preenche (texto, número e seleção); foto, categorias e só-leitura ficam de fora no MVP. */
export function colunaColavel(c: Pick<ColunaGrade, "tipo" | "editavel">): boolean {
  const ctl = controleDaCelula(c);
  return ctl === "input" || ctl === "money" || ctl === "select";
}

const limpaTexto = (s: string): string => s.replace(/\u00a0/g, " ").trim();

type Resolucao =
  | { ok: true; valor: unknown; aviso?: string; ctx?: Partial<ContextoLinha> }
  | { ok: false; motivo: MotivoIgnorada; detalhe: string };

const falha = (motivo: MotivoIgnorada, detalhe: string): Resolucao => ({ ok: false, motivo, detalhe });

type CacheSugestao = Map<string, string | null>;

function sugestao(cache: CacheSugestao, tipo: string, texto: string, lista: Nome[]): string {
  const k = `${tipo}::${normalizeCat(texto)}`;
  if (!cache.has(k)) cache.set(k, melhorSugestao(texto, lista, (o) => o.nome)?.nome ?? null);
  const s = cache.get(k);
  return s ? ` (você quis dizer "${s}"?)` : "";
}

/**
 * Texto de UMA célula -> valor do rascunho, ou o motivo de não aplicar. `ctx` = o que a linha já tem (a cor base já colada na
 * mesma linha vale para o apelido; a unidade para o rendimento). Texto vazio: limpa o que é opcional (o chamador já pulou as
 * vazias de nome/unidade/cor base: obrigatórios não se apagam por colagem).
 */
function resolverCelula(
  col: ColunaGrade,
  textoBruto: string,
  ctx: ContextoLinha,
  lk: LookupsColagem | undefined,
  cache: CacheSugestao,
): Resolucao {
  const ctl = controleDaCelula(col);
  const texto = col.key === "composicao" ? textoBruto.replace(/\u00a0/g, " ").trim() : limpaTexto(textoBruto);

  if (texto === "") {
    if (col.key === "rendimento" && ctx.unidade !== "kg") return { ok: true, valor: null };
    if (col.key === "cor_apelido") return { ok: true, valor: "" };
    return { ok: true, valor: null };
  }

  if (ctl === "input") return { ok: true, valor: texto };

  if (ctl === "money") {
    if (col.key === "rendimento" && ctx.unidade !== "kg") {
      return falha("regra", "Rendimento só vale em Kg — mude a Unidade para Kg");
    }
    const n = parseNumeroBR(texto.replace(/R\$/gi, "").replace(/[\s\u00a0]/g, ""));
    if (n == null || n < 0) return falha("numero-invalido", `"${texto}" não é um número válido`);
    return { ok: true, valor: Math.round(n * 100) / 100 };
  }

  // ---- select (pelo NOME)
  const k = normalizeCat(texto);
  switch (col.key) {
    case "unidade": {
      const u = UNIDADE_ALIAS[k];
      if (!u) return falha("sem-correspondencia", `Unidade "${texto}" inválida (use metro ou kg)`);
      return { ok: true, valor: u, ctx: { unidade: u } };
    }
    case "fornecedor": {
      const ids = lk?.fornecedores.get(k);
      if (!ids || ids.length === 0) {
        return falha("sem-correspondencia", `Fornecedor "${texto}" não encontrado${sugestao(cache, "forn", texto, lk?.fornecedoresLista ?? [])}`);
      }
      return { ok: true, valor: ids[0], aviso: ids.length > 1 ? `Mais de um fornecedor "${texto}" — usado o primeiro` : undefined };
    }
    case "mes": {
      const id = lk?.meses.get(k);
      return id ? { ok: true, valor: id } : falha("sem-correspondencia", `Mês "${texto}" não encontrado${sugestao(cache, "mes", texto, lk?.mesesLista ?? [])}`);
    }
    case "ano": {
      const id = lk?.anos.get(k);
      return id ? { ok: true, valor: id } : falha("sem-correspondencia", `Ano "${texto}" não encontrado`);
    }
    case "cor_base": {
      const id = lk?.cores.get(k);
      if (!id) return falha("sem-correspondencia", `Cor base "${texto}" não encontrada no cadastro${sugestao(cache, "cor", texto, lk?.coresLista ?? [])}`);
      return { ok: true, valor: id, ctx: { corId: id } };
    }
    case "cor_apelido": {
      const cands = (lk?.apelidos ?? []).filter((a) => a.norm === k);
      if (ctx.corId) {
        const a = cands.find((x) => x.corBaseId === ctx.corId);
        if (a) return { ok: true, valor: a.id };
        const nomeCor = lk?.nomeDaCor.get(ctx.corId) ?? "da linha";
        const dela = (lk?.apelidos ?? []).filter((x) => x.corBaseId === ctx.corId).map((x) => ({ id: x.id, nome: x.nome }));
        return falha(
          "sem-correspondencia",
          cands.length > 0
            ? `Apelido "${texto}" não pertence à cor "${nomeCor}"`
            : `Apelido "${texto}" não encontrado para a cor "${nomeCor}"${sugestao(cache, `ap:${ctx.corId}`, texto, dela)}`,
        );
      }
      if (cands.length === 1) return { ok: true, valor: cands[0].id, ctx: { corId: cands[0].corBaseId ?? "" } };
      if (cands.length > 1) return falha("sem-correspondencia", `Apelido "${texto}" existe em mais de uma cor — cole a Cor base junto`);
      return falha("sem-correspondencia", `Apelido "${texto}" não encontrado`);
    }
    default:
      return falha("coluna-nao-colavel", `${col.rotulo} não aceita colar`);
  }
}

// ============================== 4. mapeamento do bloco ==============================

export type Ancora = { linhaIdx: number; colIdx: number };

/**
 * Espalha o bloco a partir da âncora. Linhas além de `linhasExistentes` viram `novasLinhas` (cortadas no teto, 500 por padrão).
 * Cada célula vai para uma de três listas: `patches` (linha existente), `novasLinhas` (linha nova) ou `ignoradas` (com o motivo:
 * transbordo da última coluna, coluna só-leitura/foto/categorias, linha que não aceita, texto sem correspondência…).
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
    const base = opcoes.contextoLinha && !nova ? opcoes.contextoLinha(linhaIdx) : { corId: "", unidade: "metro" };
    const ctx: ContextoLinha = { corId: base.corId, unidade: base.unidade || "metro" };
    const celulasNova: CelulaNova[] = [];

    for (let j = 0; j < bloco[i].length; j++) {
      const textoBruto = bloco[i][j];
      const colIdx = ancora.colIdx + j;
      // célula vazia fora do que cola (coluna que passou do fim, foto, categorias…) não conta: não há o que ignorar
      const vazia = limpaTexto(textoBruto) === "";
      if (colIdx >= colunasVisiveis.length) {
        if (vazia) continue;
        ignoradas.push({ linhaIdx, colKey: null, motivo: "transbordo", detalhe: "Além da última coluna da lista", textoBruto });
        continue;
      }
      const col = colunasVisiveis[colIdx];
      if (!colunaColavel(col)) {
        if (vazia) continue;
        ignoradas.push({
          linhaIdx, colKey: col.key, motivo: "coluna-nao-colavel", textoBruto,
          detalhe: `${col.rotulo} não aceita colar (${col.tipo === "foto" ? "foto" : col.tipo === "categorias" ? "categorias" : "somente leitura"})`,
        });
        continue;
      }
      // vazia em campo obrigatório (nome, unidade, cor base): não apaga e não faz barulho
      if (vazia && COLUNAS_OBRIGATORIAS.has(col.key)) continue;
      if (!nova) {
        const recusa = opcoes.aceitaCelula?.(linhaIdx, col.key) ?? null;
        if (recusa) {
          if (vazia) continue; // nada a colar numa célula que a linha nem tem
          ignoradas.push({ linhaIdx, colKey: col.key, motivo: "linha-nao-aceita", detalhe: recusa, textoBruto });
          continue;
        }
      } else if (vazia) {
        continue;
      }
      const r = resolverCelula(col, textoBruto, ctx, opcoes.lookups, cache);
      if (!r.ok) {
        ignoradas.push({ linhaIdx, colKey: col.key, motivo: r.motivo, detalhe: r.detalhe, textoBruto });
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

// ============================== 5. campos do rascunho ==============================

/** Campo do rascunho da COR por coluna (os mesmos de `CAMPO_VARIANTE`, em `celulas.ts`). */
type AtualCor = Pick<VarianteNova, "cor_id" | "cor_apelido_id">;

/**
 * Coluna da COR + valor resolvido -> campos do rascunho que mudam. Mesma regra do Sheet/da grade: escolher a cor base tira o
 * apelido que não é dela; escolher o apelido preenche a cor base dele. `atual` = o que a cor tem antes (vale também para o
 * rascunho da cor existente, que tem os mesmos nomes de campo).
 */
export function camposDaCor(
  colKey: string,
  valor: unknown,
  atual: AtualCor,
  apelidos: ApelidoRef[],
): Record<string, unknown> {
  const v = { ...varianteVazia("x"), ...atual };
  if (colKey === "cor_base") {
    const r = trocarCorBase(v, String(valor ?? ""), apelidos);
    return { cor_id: r.cor_id, cor_apelido_id: r.cor_apelido_id };
  }
  if (colKey === "cor_apelido") {
    const id = String(valor ?? "");
    if (!id) return { cor_apelido_id: "" };
    const r = trocarApelido(v, id, apelidos);
    return { cor_id: r.cor_id, cor_apelido_id: r.cor_apelido_id };
  }
  const campo = CAMPO_COR[colKey];
  return campo ? { [campo]: valor } : {};
}

const CAMPO_COR: Readonly<Record<string, string>> = {
  nome_variante: "nome_variante",
  codigo_variante: "codigo_variante",
  preco_variante: "preco",
};

// ============================== 6. tecidos novos a partir das linhas além do fim ==============================

export type AvisoNovo = { linhaNovaIdx: number; colKey: string; msg: string };

export type TecidosNovosColados = {
  grupos: TecidoNovo[];
  /** `tmp` da cor criada por cada linha nova do bloco (mesma ordem de `novasLinhas`). */
  varTmpPorLinha: string[];
  /** Avisos de células aplicadas com ressalva. */
  avisos: AvisoNovo[];
};

const CAMPO_CAB: Readonly<Record<string, string>> = {
  nome: "nome",
  fornecedor: "empresa_id",
  preco: "preco",
  unidade: "unidade_medida",
  largura_estimada: "largura_estimada",
  composicao: "composicao",
  ncm: "ncm",
  rendimento: "rendimento",
  mes: "mes_id",
  ano: "ano_id",
};

/**
 * Linhas novas (já resolvidas) -> tecidos novos em rascunho. Linhas SEGUIDAS com o mesmo nome (sem acento/caixa) são cores do
 * mesmo tecido (o cabeçalho vale o da 1ª linha, como no importador); linha sem nome é um tecido à parte (fica PENDENTE, em
 * vermelho, até a pessoa dar o nome). Quem valida e grava é a Task 7 (`validarTecidoNovo` / `salvarTecidoNovo`).
 */
export function agruparNovosTecidos(novasLinhas: CelulaNova[][], apelidos: ApelidoRef[]): TecidosNovosColados {
  const grupos: TecidoNovo[] = [];
  const varTmpPorLinha: string[] = [];
  const avisos: AvisoNovo[] = [];
  let atual: TecidoNovo | null = null;
  let chaveAtual = "";

  for (const [idx, celulas] of novasLinhas.entries()) {
    const nomeCel = celulas.find((c) => c.colKey === "nome");
    const chave = normalizeCat(typeof nomeCel?.valor === "string" ? nomeCel.valor : "");
    const mesmoTecido = atual != null && chave !== "" && chave === chaveAtual;
    if (!mesmoTecido || atual == null) {
      atual = tecidoNovoVazio();
      if (grupos.length > 0) atual.semRolagem = true; // a vista vai só até o 1º tecido colado
      chaveAtual = chave;
      grupos.push(atual);
    }
    const g: TecidoNovo = atual;
    let cor: VarianteNova;
    if (mesmoTecido) {
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
        // cabeçalho: só a 1ª linha do tecido manda
        if (!mesmoTecido) (g.cab as Record<string, unknown>)[campoCab] = c.valor;
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

// ============================== 7. resumo para o toast ==============================

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

const ROTULO_MOTIVO: Readonly<Record<MotivoIgnorada, string>> = {
  transbordo: "além da última coluna",
  "coluna-nao-colavel": "coluna que não aceita colar",
  "linha-nao-aceita": "linha sem essa célula",
  "sem-correspondencia": "sem correspondência no cadastro",
  "numero-invalido": "número inválido",
  regra: "fora da regra da grade",
};

/** "Coladas N células em M linhas · P novas · Q ignoradas" + o detalhe por motivo (e o corte do teto, se houve). */
export function resumoColagem(r: ResultadoMapeamento): { tom: "sucesso" | "aviso"; texto: string; detalhe: string | undefined } {
  const celulasNovas = r.novasLinhas.reduce((s, l) => s + l.length, 0);
  const celulas = r.patches.length + celulasNovas;
  const linhasTocadas = new Set(r.patches.map((p) => p.linhaIdx)).size + r.novasLinhas.filter((l) => l.length > 0).length;
  const ignoradas = r.ignoradas.length + r.novasCortadas;
  const texto =
    `Coladas ${plural(celulas, "célula", "células")} em ${plural(linhasTocadas, "linha", "linhas")}` +
    ` · ${plural(r.novasLinhas.length, "nova", "novas")} · ${plural(ignoradas, "ignorada", "ignoradas")}`;

  const porMotivo = new Map<MotivoIgnorada, CelulaIgnorada[]>();
  for (const ig of r.ignoradas) porMotivo.set(ig.motivo, [...(porMotivo.get(ig.motivo) ?? []), ig]);
  const partes: string[] = [];
  for (const [motivo, lista] of porMotivo) {
    const exemplo = motivo === "sem-correspondencia" || motivo === "numero-invalido" ? `: ${lista[0].detalhe}` : "";
    partes.push(`${lista.length} ${ROTULO_MOTIVO[motivo]}${exemplo}`);
  }
  if (r.novasCortadas > 0) partes.push(`${plural(r.novasCortadas, "linha", "linhas")} além do teto de ${TETO_LINHAS_NOVAS} novas foram cortadas`);
  return { tom: ignoradas > 0 ? "aviso" : "sucesso", texto, detalhe: partes.length ? partes.join(" · ") : undefined };
}
