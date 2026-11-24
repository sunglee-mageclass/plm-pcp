// Linha NOVA da grade "Lista tipo Excel" de Cadastro > Insumos (PURA: sem React, sem Supabase).
// Um "insumo novo" é um GRUPO (cabeçalho + N cores) que só existe em rascunho até o Salvar. No Salvar, cada grupo VÁLIDO vira UMA
// chamada atômica de `importar_insumo_linha` (a mesma RPC da importação por planilha — zero migration). Também serve a "cor nova em
// insumo EXISTENTE": mesmo grupo, com `insumoAlvoId` (a RPC acrescenta as variantes que faltam, sem recriar o insumo).
// Espelha `src/lib/aviamento-grade/linha-nova.ts`, com as diferenças do insumo: a cor leva TAMANHOS marcados (a RPC recebe as variantes
// EXPANDIDAS por cor × tamanho — `expandirBlocos`, a mesma regra do Salvar do insumo existente); sem apelido, sem foto, sem multi-cor.
//
// Forma EXATA da RPC (espelha `insumo.descriptor.ts` → `rpc`/`resolve`):
//   sb.rpc("importar_insumo_linha", { _cabecalho, _variantes, _etiqueta_alvo_id })
//   _cabecalho  = colunas de `etiquetas` (nome, unidade, empresa_id, representante_id, tipo_insumo_id, observacoes, formato_tamanho,
//                 preco). NÃO leva `tamanho_vinculado` (a RPC não o conhece: o Salvar da grade o grava logo depois por UPDATE).
//   _variantes  = [{ cor_id, tamanho, preco }]  (1 por cor × tamanho; cor sem tamanho = 1 variante com tamanho null)
//   _etiqueta_alvo_id = null (cria) | id (acrescenta cor). A RPC EXIGE `nome` mesmo com alvo.
import { normalizeCat } from "@/lib/fornecedor-categoria";
import { tamanhoVinculadoParaSalvar, vinculoLigadoSemTamanho } from "@/lib/insumo-tamanho";
import { novoTmp, type ProblemaNovo } from "@/lib/tecido-grade/linha-nova";
import {
  blocosEfetivos,
  expandirBlocos,
  type BlocoDraft,
  type PayloadImportarInsumo,
} from "./salvar";

export { novoTmp };
export type { ProblemaNovo };

/** Cabeçalho do insumo novo (nomes = colunas de `etiquetas`, como o `InsumoDraft` da grade). `vincular` não é coluna. */
export type CabecalhoNovo = {
  nome: string | null;
  tipo_insumo_id: string | null;
  unidade: string;
  empresa_id: string | null;
  representante_id: string | null;
  preco: number | null;
  formato_tamanho: string;
  vincular: boolean;
  tamanho_vinculado: string | null;
  observacoes: string | null;
};

/** Linha de cor do grupo novo: o bloco do rascunho + um id só da tela (chave da linha). */
export type BlocoNovo = BlocoDraft & { tmp: string };

export type InsumoNovo = {
  /** Id temporário do grupo (só da tela; some quando o servidor devolve o id real). */
  tmp: string;
  /** null = insumo NOVO; id = cor(es) nova(s) em insumo que já existe. */
  insumoAlvoId: string | null;
  cab: CabecalhoNovo;
  blocos: BlocoNovo[];
  /** Só da tela: nasceu de uma colagem em lote — não rola a vista até ele (500 grupos rolando de uma vez travam). */
  semRolagem?: boolean;
};

export function blocoVazio(tmp: string = novoTmp("cor")): BlocoNovo {
  return { tmp, cor_id: "", preco: null, tamanhos: [] };
}

const cabecalhoVazio = (): CabecalhoNovo => ({
  nome: null,
  tipo_insumo_id: null,
  unidade: "unidade",
  empresa_id: null,
  representante_id: null,
  preco: null,
  formato_tamanho: "ambos",
  vincular: false,
  tamanho_vinculado: null,
  observacoes: null,
});

/** "+ Novo insumo": grupo em branco com 1 cor vazia (a cor é opcional: linha em branco não vai ao servidor). */
export function insumoNovoVazio(tmp: string = novoTmp()): InsumoNovo {
  return { tmp, insumoAlvoId: null, cab: cabecalhoVazio(), blocos: [blocoVazio()] };
}

/**
 * "+ cor" num insumo existente: só o alvo (id + nome, que a RPC exige) e 1 cor vazia. `formato` = o formato do insumo (a célula de
 * tamanhos fica travada em "nenhum", como no insumo cadastrado).
 */
export function corNovaEmExistente(
  insumoId: string,
  nomeDoInsumo: string,
  formato: string = "ambos",
  tmp: string = novoTmp(),
): InsumoNovo {
  const g = insumoNovoVazio(tmp);
  return {
    ...g,
    insumoAlvoId: insumoId,
    cab: { ...g.cab, nome: nomeDoInsumo, formato_tamanho: formato },
  };
}

const textoVazio = (v: string | null | undefined): boolean => v == null || v.trim() === "";

/** Cor "em uso" = a pessoa mexeu em algo nela (linha em branco que sobra no fim não conta nem trava o grupo). */
export function blocoTocado(b: BlocoDraft): boolean {
  return !!b.cor_id || b.tamanhos.length > 0 || b.preco != null;
}

/** Os blocos que vão ao servidor: os tocados, já com a regra do formato (nenhum = sem tamanho). */
function blocosParaEnviar(g: InsumoNovo): BlocoDraft[] {
  return blocosEfetivos(g.cab.formato_tamanho, g.blocos.filter(blocoTocado));
}

/**
 * Valida o grupo. `ok=false` = PENDENTE: não vai ao servidor (os outros grupos válidos vão normalmente — resultado parcial).
 * Regras: nome obrigatório (a RPC exige; exceto cor nova em insumo existente, cujo nome já é do insumo); cor repetida no grupo
 * (a "sem cor" também não repete: o índice único da variante não deixaria); vínculo ligado sem tamanho escolhido; cor nova em
 * insumo existente sem nenhuma cor/tamanho preenchido (não haveria o que acrescentar).
 */
export function validarInsumoNovo(g: InsumoNovo): { ok: boolean; problemas: ProblemaNovo[] } {
  const problemas: ProblemaNovo[] = [];
  const alvo = g.insumoAlvoId != null;

  if (!alvo && textoVazio(g.cab.nome)) problemas.push({ campo: "nome", msg: "nome obrigatório" });

  const tocados = g.blocos.filter(blocoTocado);
  if (alvo && tocados.length === 0) {
    problemas.push({
      campo: "cor",
      msg: "informe a cor (ou os tamanhos)",
      varTmp: g.blocos[0]?.tmp,
    });
  }
  const vistas = new Set<string>();
  for (const b of tocados) {
    if (vistas.has(b.cor_id))
      problemas.push({ campo: "cor", msg: "cor repetida neste insumo", varTmp: b.tmp });
    vistas.add(b.cor_id);
  }
  if (
    !alvo &&
    vinculoLigadoSemTamanho({
      ativo: g.cab.vincular,
      tamanho: g.cab.tamanho_vinculado,
      formato: g.cab.formato_tamanho,
      blocos: blocosParaEnviar(g),
    })
  ) {
    problemas.push({ campo: "tamanho_vinculado", msg: "escolha o tamanho vinculado ou desligue" });
  }
  return { ok: problemas.length === 0, problemas };
}

/**
 * Já existe insumo com este nome (sem acento/caixa)? A RPC trataria como "complementar" e ATUALIZARIA o cabeçalho do existente
 * (preço, tipo…): em vez de sobrescrever calado, o Salvar recusa o grupo e manda usar o "+" do existente. Só vale para insumo NOVO.
 */
export function insumoJaExiste(
  g: InsumoNovo,
  existentes: readonly { nome: string | null }[],
): boolean {
  if (g.insumoAlvoId) return false;
  const nome = normalizeCat(g.cab.nome ?? "");
  if (!nome) return false;
  return existentes.some((i) => normalizeCat(i.nome ?? "") === nome);
}

/**
 * Valor de `etiquetas.tamanho_vinculado` a gravar DEPOIS de criar o insumo (a RPC não o leva): a mesma normalização do Salvar do
 * insumo existente (Ruling A2 — vínculo desligado, sem tamanho ou com tamanho marcado numa cor vira null). Insumo existente (alvo) = null.
 */
export function vinculoDoNovo(g: InsumoNovo): string | null {
  if (g.insumoAlvoId) return null;
  return tamanhoVinculadoParaSalvar({
    ativo: g.cab.vincular,
    tamanho: g.cab.tamanho_vinculado,
    formato: g.cab.formato_tamanho,
    blocos: blocosParaEnviar(g),
  });
}

export function problemasDaCor(problemas: ProblemaNovo[], varTmp: string): ProblemaNovo[] {
  return problemas.filter((p) => p.varTmp === varTmp);
}

/** Problemas do cabeçalho (os que não são de uma cor específica). */
export function problemasDoCabecalho(problemas: ProblemaNovo[]): ProblemaNovo[] {
  return problemas.filter((p) => p.varTmp == null);
}

/**
 * Payload EXATO de `importar_insumo_linha`. Só chamar com o grupo VÁLIDO (`validarInsumoNovo`).
 *  • insumo novo: cabeçalho completo (texto vazio = null) e `_etiqueta_alvo_id = null`. As cores em branco são descartadas; as demais
 *    são EXPANDIDAS por cor × tamanho (`expandirBlocos`: sem tamanho = 1 variante só da cor; cor "" = `cor_id` null; formato "nenhum"
 *    zera os tamanhos). Insumo sem nenhuma cor = `_variantes: []`;
 *  • cor nova em insumo existente: cabeçalho SÓ com o nome (a RPC o exige e faz `COALESCE(novo, atual)` nos demais — mandar o resto
 *    trocaria dados do insumo) e `_etiqueta_alvo_id = id`.
 */
export function payloadImportar(g: InsumoNovo): PayloadImportarInsumo {
  const nome = (g.cab.nome ?? "").trim();
  const variantes = expandirBlocos(blocosParaEnviar(g));
  if (g.insumoAlvoId) {
    return {
      _cabecalho: { nome: nome || "insumo" },
      _variantes: variantes,
      _etiqueta_alvo_id: g.insumoAlvoId,
    };
  }
  const c = g.cab;
  return {
    _cabecalho: {
      nome,
      unidade: c.unidade || "unidade",
      tipo_insumo_id: c.tipo_insumo_id || null,
      empresa_id: c.empresa_id || null,
      representante_id: c.representante_id || null,
      preco: c.preco ?? null,
      formato_tamanho: c.formato_tamanho || "ambos",
      observacoes: textoVazio(c.observacoes) ? null : c.observacoes!.trim(),
    },
    _variantes: variantes,
    _etiqueta_alvo_id: null,
  };
}

/** Separa os grupos que vão ao servidor dos PENDENTES (que ficam na tela, em vermelho, sem travar os outros). */
export function separarNovos(grupos: InsumoNovo[]): {
  validos: InsumoNovo[];
  pendentes: InsumoNovo[];
} {
  const validos: InsumoNovo[] = [];
  const pendentes: InsumoNovo[] = [];
  for (const g of grupos) (validarInsumoNovo(g).ok ? validos : pendentes).push(g);
  return { validos, pendentes };
}
