// Linha NOVA da grade "Lista tipo Excel" de Cadastro > Aviamentos (PURA: sem React, sem Supabase).
// Um "aviamento novo" é um GRUPO (cabeçalho + N cores) que só existe em rascunho até o Salvar. No Salvar, cada grupo VÁLIDO vira UMA
// chamada atômica de `importar_aviamento_linha` (a mesma RPC da importação por planilha — zero migration). Também serve a "cor nova
// em aviamento EXISTENTE": mesmo grupo, com `aviamentoAlvoId` (a RPC acrescenta a cor ao aviamento, sem recriá-lo).
// Espelha `src/lib/tecido-grade/linha-nova.ts`; reaproveita dele só o que é genérico (cor/apelido/problemas).
//
// Forma EXATA da RPC (espelha `aviamento.descriptor.ts` → `rpc`/`resolve`):
//   sb.rpc("importar_aviamento_linha", { _cabecalho, _variantes, _aviamento_alvo_id })
//   _cabecalho  = colunas de `aviamentos` (codigo_nome, empresa_id, representante_id, categoria_aviamento_id,
//                 subcategoria_aviamento_id, material_aviamento_id, composicao, preco, ncm, intervalo_largura_id, largura_exata,
//                 observacoes). NÃO leva `codigo`: o gatilho `fn_aviamento_codigo` o gera no INSERT (SIGLA-NNNN a partir da CATEGORIA;
//                 sem categoria o aviamento nasce SEM código).
//   _variantes  = [{ cor_id, cor_apelido_id, nome_variante, codigo_variante, preco }]
//   _aviamento_alvo_id = null (cria) | id (acrescenta cor). A RPC EXIGE `codigo_nome` mesmo com alvo.
import { normalizeCat } from "@/lib/fornecedor-categoria";
import { parseNumeroBR } from "@/lib/import/parse";
import {
  novoTmp,
  problemasDaVariante,
  problemasDoCabecalho,
  trocarApelido,
  trocarCorBase,
  varianteVazia,
  type ApelidoRef,
  type NumeroEntrada,
  type ProblemaNovo,
  type VarianteNova,
} from "@/lib/tecido-grade/linha-nova";

export {
  novoTmp,
  problemasDaVariante,
  problemasDoCabecalho,
  trocarApelido,
  trocarCorBase,
  varianteVazia,
};
export type { ApelidoRef, NumeroEntrada, ProblemaNovo, VarianteNova };

/** Cabeçalho do aviamento novo (nomes = colunas de `aviamentos`, como o `AviamentoDraft` da grade). */
export type CabecalhoNovo = {
  codigo_nome: string | null;
  empresa_id: string | null;
  representante_id: string | null;
  preco: NumeroEntrada;
  ncm: string | null;
  categoria_aviamento_id: string | null;
  subcategoria_aviamento_id: string | null;
  material_aviamento_id: string | null;
  composicao: string | null;
  intervalo_largura_id: string | null;
  largura_exata: NumeroEntrada;
  observacoes: string | null;
};

export type AviamentoNovo = {
  /** Id temporário do grupo (só da tela; some quando o servidor devolve o id real). */
  tmp: string;
  /** null = aviamento NOVO; id = cor(es) nova(s) em aviamento que já existe. */
  aviamentoAlvoId: string | null;
  cab: CabecalhoNovo;
  vars: VarianteNova[];
  /** Só da tela: nasceu de uma colagem em lote — não rola a vista até ele (500 grupos rolando de uma vez travam). */
  semRolagem?: boolean;
};

const cabecalhoVazio = (): CabecalhoNovo => ({
  codigo_nome: null,
  empresa_id: null,
  representante_id: null,
  preco: null,
  ncm: null,
  categoria_aviamento_id: null,
  subcategoria_aviamento_id: null,
  material_aviamento_id: null,
  composicao: null,
  intervalo_largura_id: null,
  largura_exata: null,
  observacoes: null,
});

/** "+ Novo aviamento": grupo em branco com 1 cor vazia. */
export function aviamentoNovoVazio(tmp: string = novoTmp()): AviamentoNovo {
  return { tmp, aviamentoAlvoId: null, cab: cabecalhoVazio(), vars: [varianteVazia()] };
}

/** "+ cor" num aviamento existente: só o alvo (id + nome, que a RPC exige) e 1 cor vazia. */
export function corNovaEmExistente(
  aviamentoId: string,
  nomeDoAviamento: string,
  tmp: string = novoTmp(),
): AviamentoNovo {
  const g = aviamentoNovoVazio(tmp);
  return { ...g, aviamentoAlvoId: aviamentoId, cab: { ...g.cab, codigo_nome: nomeDoAviamento } };
}

const textoVazio = (v: string | null | undefined): boolean => v == null || v.trim() === "";
const numeroPreenchido = (v: NumeroEntrada): boolean =>
  v != null && !(typeof v === "string" && v.trim() === "");
/** Número digitado/colado: texto BR ou number; vazio → null. `parseNumeroBR` (a mesma da importação). */
const numero = (v: NumeroEntrada): number | null => (numeroPreenchido(v) ? parseNumeroBR(v) : null);

/** Cor "em uso" = a pessoa mexeu em algo nela (cor em branco que sobra no fim não conta nem trava o grupo). */
function varianteTocada(v: VarianteNova): boolean {
  return (
    !!v.cor_id ||
    !!v.cor_apelido_id ||
    !textoVazio(v.nome_variante) ||
    !textoVazio(v.codigo_variante) ||
    numeroPreenchido(v.preco)
  );
}

/**
 * Valida o grupo. `ok=false` = PENDENTE: não vai ao servidor (os outros grupos válidos vão normalmente — resultado parcial).
 * Regras: nome obrigatório (a RPC exige; exceto cor nova em aviamento existente, cujo nome já é do aviamento); ≥ 1 cor com cor base;
 * cor tocada sem cor base; mesma cor+apelido repetida; número digitado inválido.
 */
export function validarAviamentoNovo(g: AviamentoNovo): { ok: boolean; problemas: ProblemaNovo[] } {
  const problemas: ProblemaNovo[] = [];

  if (!g.aviamentoAlvoId && textoVazio(g.cab.codigo_nome)) {
    problemas.push({ campo: "codigo_nome", msg: "nome obrigatório" });
  }
  const nums: [string, NumeroEntrada][] = g.aviamentoAlvoId
    ? []
    : [
        ["preco", g.cab.preco],
        ["largura_exata", g.cab.largura_exata],
      ];
  for (const [campo, v] of nums) {
    if (numeroPreenchido(v) && numero(v) == null) problemas.push({ campo, msg: "número inválido" });
  }

  const tocadas = g.vars.filter(varianteTocada);
  if (!tocadas.some((v) => !!v.cor_id)) {
    problemas.push({
      campo: "cor_base",
      msg: "cor base obrigatória",
      varTmp: (tocadas[0] ?? g.vars[0])?.tmp,
    });
  }
  const vistas = new Set<string>();
  for (const v of tocadas) {
    if (!v.cor_id) {
      // a 1ª já foi acusada acima quando NENHUMA tem cor; aqui só as tocadas sem cor numa lista que já tem outra com cor
      if (tocadas.some((o) => !!o.cor_id))
        problemas.push({ campo: "cor_base", msg: "cor base obrigatória", varTmp: v.tmp });
      continue;
    }
    const k = `${v.cor_id}::${v.cor_apelido_id || ""}`;
    if (vistas.has(k))
      problemas.push({ campo: "cor_base", msg: "cor repetida neste aviamento", varTmp: v.tmp });
    vistas.add(k);
    if (numeroPreenchido(v.preco) && numero(v.preco) == null)
      problemas.push({ campo: "preco_variante", msg: "número inválido", varTmp: v.tmp });
  }
  return { ok: problemas.length === 0, problemas };
}

/**
 * Aviamento NOVO sem categoria: a RPC cria, mas o código (SIGLA-NNNN) nasce da categoria — fica SEM código. Não bloqueia (a
 * tela de hoje também permite); só avisa, como o importador ("categoria não encontrada — código pode não gerar").
 */
export function semCategoria(g: AviamentoNovo): boolean {
  return !g.aviamentoAlvoId && !g.cab.categoria_aviamento_id;
}

/**
 * Já existe aviamento com este nome (sem acento/caixa) e MESMO fornecedor? A RPC trataria como "complementar" e ATUALIZARIA o
 * cabeçalho do existente (preço, NCM…): em vez de sobrescrever calado, o Salvar recusa o grupo e manda usar o "+" do existente.
 * Só vale para aviamento NOVO.
 */
export function aviamentoJaExiste(
  g: AviamentoNovo,
  existentes: readonly { codigo_nome: string | null; empresa_id: string | null }[],
): boolean {
  if (g.aviamentoAlvoId) return false;
  const nome = normalizeCat(g.cab.codigo_nome ?? "");
  if (!nome) return false;
  const empresa = g.cab.empresa_id || null;
  return existentes.some(
    (a) => normalizeCat(a.codigo_nome ?? "") === nome && (a.empresa_id || null) === empresa,
  );
}

/**
 * Multi-cor na linha-PAI ("só ADICIONA"): cada cor base marcada que o grupo ainda NÃO tem vira uma cor (linha-filha) nova, com a
 * cor base e o PREÇO HERDADO do pai (editável depois); apelido/nome/código em branco. Cor que já está no grupo não duplica; cor
 * desmarcada nunca remove nada (remover é pelo botão de excluir). Uma cor em branco que ainda ninguém tocou (a linha vazia que o
 * grupo traz de fábrica) é PREENCHIDA em vez de sobrar uma linha sem cor. Puro: devolve o grupo novo (a mesma referência se nada mudou).
 */
export function adicionarCoresAoGrupo(
  g: AviamentoNovo,
  corIds: readonly string[],
  precoHerdado: NumeroEntrada = null,
): AviamentoNovo {
  const presentes = new Set(g.vars.filter((v) => !!v.cor_id).map((v) => v.cor_id));
  const novas: string[] = [];
  for (const id of corIds) {
    if (!id || presentes.has(id)) continue;
    presentes.add(id);
    novas.push(id);
  }
  if (novas.length === 0) return g;
  const vars = [...g.vars];
  for (const corId of novas) {
    const livre = vars.findIndex((v) => !varianteTocada(v));
    if (livre >= 0) vars[livre] = { ...vars[livre], cor_id: corId, preco: precoHerdado };
    else vars.push({ ...varianteVazia(), cor_id: corId, preco: precoHerdado });
  }
  return { ...g, vars };
}

export type PayloadImportar = {
  _cabecalho: Record<string, unknown>;
  _variantes: Record<string, unknown>[];
  _aviamento_alvo_id: string | null;
};

/**
 * Payload EXATO de `importar_aviamento_linha`. Só chamar com o grupo VÁLIDO (`validarAviamentoNovo`). NUNCA manda `codigo`.
 *  • aviamento novo: cabeçalho completo (texto vazio = null, número BR parseado) e `_aviamento_alvo_id = null`;
 *  • cor nova em aviamento existente: cabeçalho SÓ com o nome (a RPC o exige e faz `COALESCE(novo, atual)` nos demais — mandar o
 *    resto trocaria dados do aviamento) e `_aviamento_alvo_id = id`. Nome em branco no existente (o nome é opcional na tela de
 *    hoje) cai no texto genérico: com alvo a RPC não grava o nome.
 * Cores totalmente em branco são descartadas (a RPC também ignora cor sem `cor_id`).
 */
export function payloadImportar(g: AviamentoNovo): PayloadImportar {
  const nome = (g.cab.codigo_nome ?? "").trim();
  const variantes = g.vars
    .filter((v) => !!v.cor_id)
    .map((v) => ({
      cor_id: v.cor_id,
      cor_apelido_id: v.cor_apelido_id || null,
      nome_variante: textoVazio(v.nome_variante) ? null : v.nome_variante!.trim(),
      codigo_variante: textoVazio(v.codigo_variante) ? null : v.codigo_variante!.trim(),
      preco: numero(v.preco),
    }));

  if (g.aviamentoAlvoId) {
    return {
      _cabecalho: { codigo_nome: nome || "aviamento" },
      _variantes: variantes,
      _aviamento_alvo_id: g.aviamentoAlvoId,
    };
  }
  const c = g.cab;
  return {
    _cabecalho: {
      codigo_nome: nome,
      empresa_id: c.empresa_id || null,
      representante_id: c.representante_id || null,
      categoria_aviamento_id: c.categoria_aviamento_id || null,
      subcategoria_aviamento_id: c.subcategoria_aviamento_id || null,
      material_aviamento_id: c.material_aviamento_id || null,
      composicao: textoVazio(c.composicao) ? null : c.composicao!.trim(),
      preco: numero(c.preco),
      ncm: textoVazio(c.ncm) ? null : c.ncm!.trim(),
      intervalo_largura_id: c.intervalo_largura_id || null,
      largura_exata: numero(c.largura_exata),
      observacoes: textoVazio(c.observacoes) ? null : c.observacoes!.trim(),
    },
    _variantes: variantes,
    _aviamento_alvo_id: null,
  };
}

/** Separa os grupos que vão ao servidor dos PENDENTES (que ficam na tela, em vermelho, sem travar os outros). */
export function separarNovos(grupos: AviamentoNovo[]): {
  validos: AviamentoNovo[];
  pendentes: AviamentoNovo[];
} {
  const validos: AviamentoNovo[] = [];
  const pendentes: AviamentoNovo[] = [];
  for (const g of grupos) (validarAviamentoNovo(g).ok ? validos : pendentes).push(g);
  return { validos, pendentes };
}
