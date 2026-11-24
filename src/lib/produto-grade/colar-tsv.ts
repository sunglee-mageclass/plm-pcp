// Colar do Excel (TSV) na grade "Lista tipo Excel" do Planejamento de Produto — parte PURA (sem React, sem Supabase).
// Reusa o motor do tecido (`parseBlocoTsv`/`ehBlocoColavel`: aspas, TAB, quebras) e a normalização do importador (`normalizeCat`).
//
// Regras (PR-3; `modelos` é a tabela mais crítica — o colar NUNCA fura o que a edição normal recusa):
//  - Produto NÃO cria: o colar só EDITA modelos que já existem. Linhas do bloco além do fim da lista são IGNORADAS (com aviso);
//  - cada célula passa pela MESMA decisão da edição (`modoDaCelulaProduto` = `colunaEditavelNoProduto` + trava da Integração + tela
//    só-leitura): campo bloqueado (sem permissão, travado pela Integração, só-leitura, REF/Status/SKU…) = IGNORA (conta como ignorada);
//  - texto → id por NOME (coleção/linha/categoria/sub/mês/ano/estilista…, mesma normalização do importador `modelo.descriptor.ts`);
//    o que não resolve NÃO grava e vira aviso na célula;
//  - devolve só os CAMPOS do rascunho que mudam (a tela os aplica por `patch`: NADA grava antes do Salvar). Categoria colada dispara
//    REF/espelho no Salvar como a edição normal (cascata de subcategorias idêntica à da célula).
import { filtrarNcm } from "@/components/planejamento/planejamento-detail/helpers";
import type { GradeOpcoesProduto } from "@/components/planejamento/grade/useProdutosGrade";
import { normalizeCat } from "@/lib/fornecedor-categoria";
import { melhorSugestao } from "@/lib/import/fuzzy";
import { parseNumeroBR } from "@/lib/import/parse";
import type { EstadoModeloIntegracao } from "@/lib/integracao/trava";
import type { ColunaProduto } from "./colunas";
import {
  categoriaEhAcessorio,
  controleDaColuna,
  opcoesDaColuna,
  subDaCategoria,
  type ControleCelula,
} from "./celulas";
import type { LinhaProduto } from "./linhas";
import { modoDaCelulaProduto } from "./modo-celula";
import type { ProdutoDraft } from "./salvar";

export { parseBlocoTsv, ehBlocoColavel } from "@/lib/tecido-grade/colar-tsv";

/** Teto de LINHAS do bloco processadas por colagem (corta e avisa; não trava a tela). */
export const TETO_LINHAS_COLAR = 500;

export type MotivoIgnoradaProduto =
  | "alem-do-fim" //          a linha do bloco passou do fim da lista (Produto não cria)
  | "transbordo" //           a coluna não existe (o bloco passou da última)
  | "somente-leitura" //      REF, Status, Origem, datas, derivadas…
  | "sem-permissao" //        permissão/seção/tela só-leitura/origem (ex.: preço do comprado)
  | "travada" //             travada pela Integração neste produto
  | "verificando" //          estado da Integração ainda não chegou (nunca livre)
  | "sem-correspondencia" //  nome que não existe no cadastro / opção inválida
  | "numero-invalido"
  | "regra"; //              regra da grade (Tamanho em não vale em Acessórios)

export type CelulaIgnoradaProduto = {
  linhaIdx: number;
  modeloId: string | null;
  /** `null` no transbordo e no "além do fim" (não há coluna/linha). */
  colKey: string | null;
  motivo: MotivoIgnoradaProduto;
  detalhe: string;
  textoBruto: string;
};

/** Campos do rascunho que UM modelo recebe da colagem (já resolvidos e já SEM o que não muda). */
export type PatchProduto = {
  linhaIdx: number;
  modeloId: string;
  campos: Partial<ProdutoDraft>;
};

export type ResultadoColagemProduto = {
  patches: PatchProduto[];
  ignoradas: CelulaIgnoradaProduto[];
  /** Células aplicadas (colou e resolveu), contando as que já tinham o mesmo valor. */
  celulasAplicadas: number;
  /** Linhas do modelo que receberam ao menos 1 célula. */
  linhasTocadas: number;
  /** Chaves `<modeloId>|<colKey>` das células que o colar APLICOU (a tela apaga o aviso antigo delas). */
  aplicadas: string[];
  /** Chaves `<modeloId>|<colKey>` → motivo (texto que não resolveu / número inválido / regra): a tela marca a célula. */
  avisos: Record<string, string>;
  /** Linhas do bloco cortadas pelo teto. */
  cortadas: number;
};

export type EntradaColagemProduto = {
  /** As linhas NA ORDEM DA TELA (mesma da tabela: a âncora é uma posição nelas). */
  linhas: readonly LinhaProduto[];
  /** As colunas NA ORDEM DA TELA (`colunasNaOrdemDaTela`). */
  colunas: readonly ColunaProduto[];
  opcoes: GradeOpcoesProduto;
  otbOn: boolean;
  readOnly: boolean;
  integracaoPronta: boolean;
  canEdit: (chave: string) => boolean;
  estadoDe: (modeloId: string) => EstadoModeloIntegracao | null;
  /** Valor ATUAL do rascunho do modelo (o que a célula mostra agora). */
  valorDe: (modeloId: string) => ProdutoDraft;
  tetoLinhas?: number;
};

export type Ancora = { linhaIdx: number; colIdx: number };

const limpa = (s: string): string => s.replace(/\u00a0/g, " ").trim();

/** Colunas que não se APAGAM por colagem (campo obrigatório): célula vazia nelas é pulada em silêncio. */
const OBRIGATORIAS = new Set(["nome", "categoria_principal_id", "tamanho_tipo"]);

/** Colunas cujo detalhe vira marca na célula (o resto — bloqueio — a célula já mostra pelo cadeado/texto cinza). */
const MOTIVOS_COM_MARCA = new Set<MotivoIgnoradaProduto>([
  "sem-correspondencia",
  "numero-invalido",
  "regra",
]);

type Resolucao =
  | { ok: true; campos: Partial<ProdutoDraft> }
  | { ok: false; motivo: MotivoIgnoradaProduto; detalhe: string };
const falha = (motivo: MotivoIgnoradaProduto, detalhe: string): Resolucao => ({
  ok: false,
  motivo,
  detalhe,
});

type Opt = { id: string; nome: string };

function sugestao(texto: string, lista: Opt[]): string {
  const s = melhorSugestao(texto, lista, (o) => o.nome)?.nome;
  return s ? ` (você quis dizer "${s}"?)` : "";
}

/** Acha a opção pelo NOME (sem acento/caixa). Ids repetidos com o mesmo nome: a 1ª. */
function achaPorNome(lista: Opt[], texto: string): Opt | null {
  const k = normalizeCat(texto);
  if (!k) return null;
  return lista.find((o) => normalizeCat(o.nome) === k) ?? null;
}

/** Texto de UMA célula → campos do rascunho, ou o motivo de não aplicar. `v` = o rascunho da linha COM o que já foi colado nela. */
function resolverCelula(
  col: ColunaProduto,
  controle: ControleCelula,
  textoBruto: string,
  v: ProdutoDraft,
  e: Pick<EntradaColagemProduto, "opcoes">,
): Resolucao {
  const texto = limpa(textoBruto);
  const vazia = texto === "";
  const k = col.key;

  if (controle === "texto") {
    // inclui Coleção/Subcoleção sem OTB (texto livre)
    if (k === "ncm") return { ok: true, campos: { ncm: vazia ? null : filtrarNcm(texto) || null } };
    return { ok: true, campos: { [k]: vazia ? null : texto } as Partial<ProdutoDraft> };
  }

  if (controle === "money") {
    if (vazia) return { ok: true, campos: { [k]: null } as Partial<ProdutoDraft> };
    const n = parseNumeroBR(texto.replace(/R\$/gi, "").replace(/[\s\u00a0]/g, ""));
    if (n == null || n < 0) return falha("numero-invalido", `"${texto}" não é um número válido`);
    const f = 10 ** (col.casas ?? 2);
    return { ok: true, campos: { [k]: Math.round(n * f) / f } as Partial<ProdutoDraft> };
  }

  // ---- select (por NOME)
  const op = e.opcoes;
  switch (k) {
    case "colecao": {
      // com OTB (controle select): grava colecao_id + o texto da coleção; Mês/Ano vazios herdam os dela (como a célula).
      if (vazia) return { ok: true, campos: { colecao_id: null } };
      const lista = op.colecoes.map((c) => ({ id: c.id, nome: c.nome }));
      const achou = achaPorNome(lista, texto);
      if (!achou)
        return falha(
          "sem-correspondencia",
          `Coleção "${texto}" não encontrada${sugestao(texto, lista)}`,
        );
      const c = op.colecoes.find((x) => x.id === achou.id)!;
      const campos: Partial<ProdutoDraft> = { colecao_id: c.id, colecao: c.nome };
      if (!v.mes_id && c.mes_id) campos.mes_id = c.mes_id;
      if (!v.ano_id && c.ano_id) campos.ano_id = c.ano_id;
      return { ok: true, campos };
    }
    case "subcolecao": {
      if (vazia) return { ok: true, campos: { subcolecao: null } };
      const lista = opcoesDaColuna("subcolecao", op, {
        categoriaId: null,
        colecaoId: v.colecao_id,
        atual: null,
      });
      const achou = achaPorNome(lista, texto);
      if (!achou)
        return falha(
          "sem-correspondencia",
          v.colecao_id
            ? `Subcoleção "${texto}" não encontrada nesta coleção${sugestao(texto, lista)}`
            : `Subcoleção "${texto}": escolha a Coleção antes (cole a Coleção junto)`,
        );
      return { ok: true, campos: { subcolecao: achou.id } };
    }
    case "tamanho_tipo": {
      if (categoriaEhAcessorio(op, v.categoria_principal_id))
        return falha("regra", "Tamanho em não se aplica a Acessórios (grade única UN)");
      const achou = achaPorNome(op.tamanhoTipos, texto);
      if (!achou)
        return falha("sem-correspondencia", `Tamanho em "${texto}" inválido (use Letra ou Número)`);
      return { ok: true, campos: { tamanho_tipo: achou.id } };
    }
    case "semana":
    case "linha_id":
    case "mes_id":
    case "ano_id":
    case "estilista_id":
    case "categoria_principal_id":
    case "subcategoria1_id":
    case "subcategoria2_id": {
      const lista = opcoesDaColuna(k, op, {
        categoriaId: v.categoria_principal_id,
        colecaoId: null,
        atual: null,
      });
      if (vazia) return { ok: true, campos: { [k]: null } as Partial<ProdutoDraft> };
      const achou = achaPorNome(lista, texto);
      if (!achou) {
        const sub = k === "subcategoria1_id" || k === "subcategoria2_id";
        return falha(
          "sem-correspondencia",
          sub && !v.categoria_principal_id
            ? `${col.rotulo} "${texto}": escolha a Categoria antes (cole a Categoria junto)`
            : sub
              ? `${col.rotulo} "${texto}" não encontrada nesta categoria${sugestao(texto, lista)}`
              : `${col.rotulo} "${texto}" não encontrado(a)${sugestao(texto, lista)}`,
        );
      }
      const campos: Partial<ProdutoDraft> = { [k]: achou.id } as Partial<ProdutoDraft>;
      if (k === "categoria_principal_id") {
        // Cascata igual à da célula: a subcategoria que não é da categoria nova sai junto (o gatilho do REF também a limparia).
        if (!subDaCategoria(op.subcategorias1, v.subcategoria1_id, achou.id))
          campos.subcategoria1_id = null;
        if (!subDaCategoria(op.subcategorias2, v.subcategoria2_id, achou.id))
          campos.subcategoria2_id = null;
      }
      return { ok: true, campos };
    }
    default:
      return falha("somente-leitura", `${col.rotulo} não aceita colar`);
  }
}

/**
 * Espalha o bloco a partir da âncora (linha da TELA × coluna da TELA). Para cada célula: linha além do fim → ignorada ("Produto não
 * cria"); coluna além da última → ignorada; modo ≠ "editar" → ignorada com o motivo (permissão/trava/só-leitura); texto que não resolve →
 * ignorada com aviso na célula; resto → campos do rascunho. A tela aplica `patches` por `patch` (nada grava antes do Salvar).
 * Células vazias em campo bloqueado/obrigatório não contam (não há o que ignorar/apagar).
 */
export function mapearColagemProduto(
  ancora: Ancora,
  bloco: string[][],
  e: EntradaColagemProduto,
): ResultadoColagemProduto {
  const teto = e.tetoLinhas ?? TETO_LINHAS_COLAR;
  const ignoradas: CelulaIgnoradaProduto[] = [];
  const patches: PatchProduto[] = [];
  const aplicadas: string[] = [];
  const avisos: Record<string, string> = {};
  let celulasAplicadas = 0;
  let linhasTocadas = 0;
  let cortadas = 0;

  for (let i = 0; i < bloco.length; i++) {
    if (i >= teto) {
      cortadas = bloco.length - i;
      break;
    }
    const linhaIdx = ancora.linhaIdx + i;
    const linha = e.linhas[linhaIdx];
    const celulasDaLinha = bloco[i];
    if (!linha) {
      // Produto NÃO cria: uma linha ignorada por linha do bloco que tinha algum conteúdo.
      if (celulasDaLinha.some((c) => limpa(c) !== "")) {
        ignoradas.push({
          linhaIdx,
          modeloId: null,
          colKey: null,
          motivo: "alem-do-fim",
          detalhe: "Além do último produto da lista (o Produto não cria linhas)",
          textoBruto: celulasDaLinha.join("\t"),
        });
      }
      continue;
    }
    const id = linha.modeloId;
    const estado = e.estadoDe(id);
    const atual = e.valorDe(id);
    const v: ProdutoDraft = { ...atual };
    const campos: Partial<ProdutoDraft> = {};
    let tocou = false;

    for (let j = 0; j < celulasDaLinha.length; j++) {
      const textoBruto = celulasDaLinha[j];
      const colIdx = ancora.colIdx + j;
      const vazia = limpa(textoBruto) === "";
      if (colIdx >= e.colunas.length) {
        if (vazia) continue;
        ignoradas.push({
          linhaIdx,
          modeloId: id,
          colKey: null,
          motivo: "transbordo",
          textoBruto,
          detalhe: "Além da última coluna da lista",
        });
        continue;
      }
      const col = e.colunas[colIdx];
      const controle = controleDaColuna(col, e.otbOn);
      const modo = modoDaCelulaProduto({
        col,
        controle,
        produto: { origem: linha.modelo.origem, enviado_cad: linha.modelo.enviado_cad },
        readOnly: e.readOnly,
        canEdit: e.canEdit,
        estado,
        integracaoPronta: e.integracaoPronta,
      });
      if (modo !== "editar") {
        if (vazia) continue;
        const motivo: MotivoIgnoradaProduto =
          controle === "somente-leitura"
            ? "somente-leitura"
            : modo === "travada"
              ? "travada"
              : modo === "verificando"
                ? "verificando"
                : "sem-permissao";
        const detalhe =
          motivo === "somente-leitura"
            ? `${col.rotulo} é somente leitura`
            : motivo === "travada"
              ? `${col.rotulo} está travado pela Integração`
              : motivo === "verificando"
                ? `${col.rotulo}: a Integração ainda está sendo verificada`
                : `Sem permissão para editar ${col.rotulo}`;
        ignoradas.push({ linhaIdx, modeloId: id, colKey: col.key, motivo, detalhe, textoBruto });
        continue;
      }
      if (vazia && OBRIGATORIAS.has(col.key)) continue;
      const r = resolverCelula(col, controle, textoBruto, v, e);
      const chave = `${id}|${col.key}`;
      if (!r.ok) {
        ignoradas.push({
          linhaIdx,
          modeloId: id,
          colKey: col.key,
          motivo: r.motivo,
          detalhe: r.detalhe,
          textoBruto,
        });
        if (MOTIVOS_COM_MARCA.has(r.motivo)) avisos[chave] = r.detalhe;
        continue;
      }
      for (const k of Object.keys(r.campos) as (keyof ProdutoDraft)[]) {
        const novo = r.campos[k] as never;
        // `v` acompanha (a cascata da própria linha depende do que já foi colado); só o que MUDA vai ao rascunho.
        if (!Object.is(v[k], novo)) {
          (v as Record<string, unknown>)[k] = novo;
          (campos as Record<string, unknown>)[k] = novo;
        }
      }
      aplicadas.push(chave);
      celulasAplicadas++;
      tocou = true;
    }
    if (tocou) linhasTocadas++;
    if (Object.keys(campos).length > 0) patches.push({ linhaIdx, modeloId: id, campos });
  }
  return { patches, ignoradas, celulasAplicadas, linhasTocadas, aplicadas, avisos, cortadas };
}

// ============================== resumo para o toast ==============================

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

const ROTULO_MOTIVO: Readonly<Record<MotivoIgnoradaProduto, string>> = {
  "alem-do-fim": "além do último produto (Produto não cria linhas)",
  transbordo: "além da última coluna",
  "somente-leitura": "em coluna somente leitura",
  "sem-permissao": "sem permissão",
  travada: "travada pela Integração",
  verificando: "Integração em verificação",
  "sem-correspondencia": "sem correspondência no cadastro",
  "numero-invalido": "número inválido",
  regra: "fora da regra da grade",
};

/** "Coladas N células em M produtos · Q ignoradas" + o detalhe por motivo (e o corte do teto, se houve). */
export function resumoColagemProduto(r: ResultadoColagemProduto): {
  tom: "sucesso" | "aviso";
  texto: string;
  detalhe: string | undefined;
} {
  const nIgnoradas = r.ignoradas.length + r.cortadas;
  const texto =
    `Coladas ${plural(r.celulasAplicadas, "célula", "células")} em ${plural(r.linhasTocadas, "produto", "produtos")}` +
    ` · ${plural(nIgnoradas, "ignorada", "ignoradas")}`;
  const porMotivo = new Map<MotivoIgnoradaProduto, CelulaIgnoradaProduto[]>();
  for (const ig of r.ignoradas) porMotivo.set(ig.motivo, [...(porMotivo.get(ig.motivo) ?? []), ig]);
  const partes: string[] = [];
  for (const [motivo, lista] of porMotivo) {
    const unidade =
      motivo === "alem-do-fim" ? plural(lista.length, "linha", "linhas") : String(lista.length);
    const exemplo =
      motivo === "sem-correspondencia" || motivo === "numero-invalido"
        ? `: ${lista[0].detalhe}`
        : "";
    partes.push(`${unidade} ${ROTULO_MOTIVO[motivo]}${exemplo}`);
  }
  if (r.cortadas > 0)
    partes.push(
      `${plural(r.cortadas, "linha", "linhas")} além do teto de ${TETO_LINHAS_COLAR} foram cortadas`,
    );
  return {
    tom: nIgnoradas > 0 ? "aviso" : "sucesso",
    texto,
    detalhe: partes.length ? partes.join(" · ") : undefined,
  };
}
