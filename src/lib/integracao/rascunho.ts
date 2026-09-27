// Integração — rascunho POR PRODUTO da aba Produtos (staging: nada grava antes do Salvar). PURO. As 12 colunas são as do
// CARD (mão dupla — a tela nunca tem cópia própria); o merge com o servidor é o 3-vias do sistema (base/draft/fresh/tocados,
// @/lib/colab/merge). Foto nova = marcador "novo:<id>" na posição dela (o upload só acontece no Salvar — Task 11). SKU à mão
// = o MESMO "a gravar" da seção Códigos (sku-previa.ts), gravado no passo 3 do Salvar.
//
// Ruling G1 (task-10-report.md, revisto nos fix rounds 1 e 2): titulo_pagina/preco_anterior NULL = AUTOMÁTICO.
//
// Fix round 1 (task-10-review.md): título reusa tituloAoDigitar/tituloAoSair/tituloPaginaCalculado (Important #1);
// preco_anterior/preco_venda nunca mandam 0/negativo (Important #2); colunasAlteradas compara valores normalizados
// (Minor #2 original — texto); fotos novas nunca somem em silêncio (Minor #3); mesclar derruba conflito antigo
// convergido por fora (Minor #5); formatarValor nunca imprime "R$ NaN" (Minor #6, em produtos.ts).
//
// Fix round 2 (task-10-review.md, "Re-review round 1"):
// - Important R1-1: `nomeLoja` NÃO fica mais guardado no Rascunho — era capturado 1x em `novoRascunho`/`mesclar` e
//   nunca atualizava (a tela só tem o nome pronto depois que `useTenantBranding()` carrega, e um rascunho nascido
//   antes disso ficava comparando pra sempre contra "Nome" em vez de "Nome | Loja"). Agora `nomeLoja` é argumento
//   DE CHAMADA de `editarTitulo`/`sairTitulo`/`tituloCalculadoDoRascunho` — a MESMA forma que o Sheet usa (prop a
//   cada render, nunca guardada em estado). `Rascunho`/`novoRascunho`/`mesclar` voltam à assinatura do brief
//   (`novoRascunho(p)`, `mesclar(r, p)`) — T11/T12b chamam como já estava escrito no plano.
//   - O nome vem de `useTenantBranding().nome` (NÃO de `integracao_config_ler` — essa RPC não devolve
//     `tenants.nome`, m2:706-721; o comentário da v1 estava errado e foi corrigido aqui).
//   - Sem caso especial no Sheet para `nomeLoja === null` (confirmado lendo `InfoGeraisSecao.tsx:226-254`: o botão
//     "voltar ao automático" e o badge "automático" não checam `nomeLoja`, só `tituloAutomatico`/`tituloCalculado`).
//     A regra segura adotada aqui (instrução do controlador, já que o Sheet não tem um guard explícito): com
//     `nomeLoja` NULL, `editarTitulo`/`sairTitulo` NUNCA colapsam um título digitado para NULL, e NUNCA tratam um
//     Nome puro (sem "| Loja") como automático — o texto digitado fica exatamente como foi digitado. Isso evita o
//     efeito colateral pior (a Task 10 original: comparar contra "Nome" sem loja faria o usuário digitar o
//     automático de verdade "Nome | Loja Real" e o sistema achar que é manual, OU digitar só "Nome" e o sistema
//     achar que é automático e mandar NULL — os dois errados). **T12a PRECISA desabilitar a célula/campo do título
//     enquanto `useTenantBranding().nome` ainda é null** (loading) — assim o usuário nunca edita o título antes do
//     nome da loja estar pronto, e essa mitigação de "manter o texto digitado" nunca chega a ser exercitada na UI
//     real (ela existe só como rede de segurança caso a Task 12a esqueça o disable).
// - Minor R1-1: `editarTitulo`/`sairTitulo` retornam `r` INALTERADO (mesma referência) quando o novo valor é
//   `igual` ao atual — nunca marcam `titulo_pagina` como tocado num blur que não mudou nada (senão um tab-through
//   sem editar vira, num merge futuro, um conflito com quem editou o título de verdade, em vez de adoção silenciosa).
// - Minor R1-2: `normalizado` agora também mapeia preco_anterior/preco_venda `<= 0` para NULL (evita "alterado"
//   falso quando o valor base já é NULL e o usuário digita 0) e usa a MESMA arredondada-a-centavos de
//   `precoAnteriorOuNull`/`numeroOuNull(v,2)` antes do `> 0`, pra não deixar passar um sub-centavo.
// - Minor R1-3: `aposSalvar` NÃO lança mais. Roda DEPOIS de um Salvar já commitado no servidor (plan T12b,
//   dentro do onSuccess) — um throw ali vira erro de render pós-sucesso e nunca protege dado (as fotos já estão no
//   Storage). Em vez disso, se há `fotosNovas` pendentes e `o.fotos` não veio, o rascunho residual mantém o `rev`
//   PRÉ-salvar (não o `o.rev` novo) — assim o próximo `mesclar` (tocados vazio) adota `fotos_modelo` do servidor
//   silenciosamente, sem inventar um estado inconsistente. A checagem também saiu de ANTES do early-return
//   `skusGravados || nadaAGravar` para DEPOIS — só importa quando o rascunho de fato sobra.
// - Minor R1-4: mensagem de ação em massa cobrindo o bloqueio por módulo — ver `produtos.ts` (`acoesEmMassa`).
// - Minor R1-5: texto PT seguro pro usuário quando `payloadItem` recusa (ver fix round 3 abaixo — a v2 removeu o
//   texto junto da guarda por engano; a rodada 3 devolveu os dois).
//
// Fix round 3 (task-10-review.md, "Re-review round 2"):
// - Regressão fechada: o fix round 2 removeu, por engano, a guarda de `payloadItem` que o round 0 (Minor #3) e o
//   round 1 (item 4, revisão explícita: "keep this throw") tinham deixado de propósito — o round 2 devia SÓ trocar
//   o texto pra PT (Minor R1-5), não apagar a guarda inteira. Restaurada: quando `fotos_modelo` está entre as
//   colunas alteradas (há `fotosNovas` pendentes) e o chamador não passa `fotosFinais`, `payloadItem` lança com o
//   texto PT "Não foi possível enviar as fotos novas. Tente salvar de novo." Roda em T11 passo 1, ANTES de
//   qualquer escrita no banco, dentro do `try` — o `catch` correspondente apaga os uploads já feitos, então nada
//   fica orfão no Storage. `aposSalvar` continua SEM lançar (Minor R1-3 — ele roda DEPOIS do commit; ver o
//   comentário da própria função).
import { igual, mergeDraft, type Conflito } from "@/lib/colab/merge";
import type { ColunaEditavel } from "@/lib/integracao/campos";
import type { ProdutoLista, RawProduto, Sublinha } from "@/lib/integracao/produtos";
import { precoAnteriorOuNull } from "@/components/planejamento/planejamento-detail/helpers";
import { tituloAoDigitar, tituloAoSair, tituloPaginaCalculado } from "@/lib/titulo-pagina";
import {
  SKUS_A_GRAVAR_VAZIO,
  nadaAGravar,
  type SkusAGravar,
} from "@/components/planejamento/planejamento-detail/codigos/sku-previa";
import type { LinhaSku } from "@/components/planejamento/planejamento-detail/codigos/sku-card";

export type Valores = Omit<RawProduto, "tamanho_tipo">;
export const COLUNAS: readonly ColunaEditavel[] = [
  "nome",
  "ref",
  "preco_anterior",
  "preco_venda",
  "peso_kg",
  "ncm",
  "titulo_pagina",
  "descricao_produto",
  "comprimento_cm",
  "largura_cm",
  "altura_cm",
  "fotos_modelo",
];
export const PREFIXO_FOTO_NOVA = "novo:";
export type FotoNova = { id: string; file: File };
export type Rascunho = {
  modeloId: string;
  nome: string;
  rev: number;
  tamanhoTipo: "letra" | "numero" | null;
  base: Valores;
  valores: Valores;
  tocados: ReadonlySet<ColunaEditavel>;
  fotosNovas: FotoNova[];
  skus: SkusAGravar;
  conflitos: Conflito[];
};
export type ItemSalvar = {
  modelo_id: string;
  rev: number;
  campos: Partial<Record<ColunaEditavel, string | number | string[] | null>>;
};

export function valoresDoRaw(raw: RawProduto): Valores {
  return {
    nome: raw.nome,
    ref: raw.ref,
    preco_anterior: raw.preco_anterior,
    preco_venda: raw.preco_venda,
    peso_kg: raw.peso_kg,
    ncm: raw.ncm,
    titulo_pagina: raw.titulo_pagina,
    descricao_produto: raw.descricao_produto,
    comprimento_cm: raw.comprimento_cm,
    largura_cm: raw.largura_cm,
    altura_cm: raw.altura_cm,
    fotos_modelo: [...raw.fotos_modelo],
  };
}
export function novoRascunho(p: ProdutoLista): Rascunho {
  const v = valoresDoRaw(p.raw);
  return {
    modeloId: p.modeloId,
    nome: p.raw.nome,
    rev: p.rev,
    tamanhoTipo: p.raw.tamanho_tipo,
    base: v,
    valores: { ...v, fotos_modelo: [...v.fotos_modelo] },
    tocados: new Set(),
    fotosNovas: [],
    skus: SKUS_A_GRAVAR_VAZIO,
    conflitos: [],
  };
}
export function editar<K extends ColunaEditavel>(
  r: Rascunho,
  coluna: K,
  valor: Valores[K],
): Rascunho {
  const tocados = new Set(r.tocados);
  tocados.add(coluna);
  return {
    ...r,
    valores: { ...r.valores, [coluna]: valor },
    tocados,
    conflitos: r.conflitos.filter((c) => c.path !== coluna),
  };
}
/** Título calculado AO VIVO (nunca gravado) a partir do Nome do RASCUNHO + nome da loja — o mesmo par que o Sheet
 *  usa (`InfoGeraisSecao.tsx`: `tituloPaginaCalculado(draft.nome, nomeLoja)`). `nomeLoja` é argumento de CHAMADA
 *  (fix round 2, Important R1-1) — a tela lê `useTenantBranding().nome` a cada render e passa aqui, exatamente
 *  como o Sheet passa pra `InfoGeraisSecao`; nunca fica guardado no rascunho (senão ficaria stale). */
export const tituloCalculadoDoRascunho = (r: Rascunho, nomeLoja: string | null): string =>
  tituloPaginaCalculado(r.valores.nome, nomeLoja);
/** Important #1 (fix round 1) + Important R1-1/Minor R1-1 (fix round 2) — onChange do campo Título.
 *  `nomeLoja` null (nome da loja ainda não carregou): NUNCA colapsa o digitado pra NULL nem trata um Nome puro
 *  como automático — mantém exatamente o que a pessoa digitou (rede de segurança; T12a deve desabilitar o campo
 *  nesse estado, então esse ramo não deveria ser exercitado na prática). Minor R1-1: retorna `r` sem tocar quando
 *  o valor não muda (nunca marca `titulo_pagina` como tocado num blur/edição que é no-op). */
export function editarTitulo(r: Rascunho, digitado: string, nomeLoja: string | null): Rascunho {
  const novo =
    nomeLoja === null
      ? digitado
      : tituloAoDigitar(digitado, tituloCalculadoDoRascunho(r, nomeLoja));
  return igual(novo, r.valores.titulo_pagina) ? r : editar(r, "titulo_pagina", novo);
}
/** Important #1 (fix round 1) + Important R1-1/Minor R1-1 (fix round 2) — onBlur do campo Título.
 *  `nomeLoja` null: nunca colapsa pra NULL (mesma rede de segurança de `editarTitulo`). */
export function sairTitulo(r: Rascunho, nomeLoja: string | null): Rascunho {
  if (nomeLoja === null) return r; // nada a normalizar sem o automático calculável — mantém o que já está
  const novo = tituloAoSair(r.valores.titulo_pagina, tituloCalculadoDoRascunho(r, nomeLoja));
  return igual(novo, r.valores.titulo_pagina) ? r : editar(r, "titulo_pagina", novo);
}
export function adicionarFotos(r: Rascunho, novas: FotoNova[]): Rascunho {
  if (novas.length === 0) return r;
  return editar({ ...r, fotosNovas: [...r.fotosNovas, ...novas] }, "fotos_modelo", [
    ...r.valores.fotos_modelo,
    ...novas.map((n) => PREFIXO_FOTO_NOVA + n.id),
  ]);
}
export function removerFoto(r: Rascunho, item: string): Rascunho {
  const fotosNovas = r.fotosNovas.filter((n) => PREFIXO_FOTO_NOVA + n.id !== item);
  return editar(
    { ...r, fotosNovas },
    "fotos_modelo",
    r.valores.fotos_modelo.filter((f) => f !== item),
  );
}
const TEXTO_OU_NULL: ReadonlySet<ColunaEditavel> = new Set([
  "ncm",
  "titulo_pagina",
  "descricao_produto",
]);
const PRECOS: ReadonlySet<ColunaEditavel> = new Set(["preco_anterior", "preco_venda"]);
/** Preço normalizado a 2 casas; `<= 0` (ou não-finito) vira NULL — mesma régua de `precoAnteriorOuNull`/
 *  `numeroOuNull(v,2)` do Sheet (Minor R1-2: sem isso, um sub-centavo passava e um valor <= 0 contava como
 *  "diferente de NULL", marcando "alterado" por engano). */
function precoNormalizado(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const arred = Math.round(v * 100) / 100;
  return arred > 0 ? arred : null;
}
/** Minor #2 (fix round 1) + Minor R1-2 (fix round 2) — valor NORMALIZADO pra fim de comparação de alteração (não
 *  altera o que fica no rascunho, só o que `colunasAlteradas` compara): texto aparado; os 3 texto-ou-null tratam
 *  NULL/""/"  " como o MESMO valor; preco_anterior/preco_venda tratam `<= 0` e NULL como o MESMO valor (os dois
 *  significam "automático/sem preço" pro servidor — ver `payloadItem`). */
function normalizado(coluna: ColunaEditavel, v: unknown): unknown {
  if (coluna === "nome" || coluna === "ref") return typeof v === "string" ? v.trim() : v;
  if (PRECOS.has(coluna)) return precoNormalizado(v);
  if (TEXTO_OU_NULL.has(coluna)) {
    const s = typeof v === "string" ? v.trim() : v;
    return s === "" || s === null || s === undefined ? null : s;
  }
  return v;
}
export const colunasAlteradas = (r: Rascunho): ColunaEditavel[] =>
  COLUNAS.filter((c) => !igual(normalizado(c, r.valores[c]), normalizado(c, r.base[c])));
export const temAlteracao = (r: Rascunho): boolean =>
  colunasAlteradas(r).length > 0 || !nadaAGravar(r.skus);
export const comSkus = (r: Rascunho, skus: SkusAGravar): Rascunho => ({ ...r, skus });

/** Chegou versão nova do servidor (rev diferente): merge 3-vias — não tocado segue o servidor; tocado e mudado lá = conflito.
 *  Fix round 2 (Important R1-1): assinatura de volta ao brief — `mesclar(r, p)`, sem `nomeLoja` (que não é mais
 *  guardado no rascunho). */
export function mesclar(r: Rascunho, p: ProdutoLista): Rascunho {
  if (p.rev === r.rev) return r;
  const fresh = valoresDoRaw(p.raw);
  const m = mergeDraft({
    base: r.base,
    draft: r.valores,
    fresh,
    touched: r.tocados as ReadonlySet<string>,
  });
  // Minor #5 (fix round 1): um conflito ANTIGO (de um merge anterior) cujo valor no rascunho já bate com o
  // `fresh` de AGORA convergiu por fora (ex.: outra aba salvou exatamente o que eu tinha) — não fica preso pra
  // sempre; `mergeDraft` só reemite/remove um path que TEM divergência nova entre base/fresh, então um conflito
  // já resolvido desse jeito precisa ser dropado aqui, fora do resultado do merge.
  const antigosVivos = r.conflitos.filter(
    (c) =>
      !m.conflitos.some((n) => n.path === c.path) &&
      !igual(m.valor[c.path as keyof Valores], fresh[c.path as keyof Valores]),
  );
  const conflitos = [...antigosVivos, ...m.conflitos];
  return {
    ...r,
    rev: p.rev,
    nome: p.raw.nome,
    tamanhoTipo: p.raw.tamanho_tipo,
    base: fresh,
    valores: m.valor,
    conflitos,
  };
}
export const manterMeu = (r: Rascunho, path: string): Rascunho => ({
  ...r,
  conflitos: r.conflitos.filter((c) => c.path !== path),
});
export function usarNovo(r: Rascunho, path: string): Rascunho {
  const k = path as ColunaEditavel;
  const tocados = new Set(r.tocados);
  tocados.delete(k);
  return {
    ...r,
    valores: { ...r.valores, [k]: r.base[k] },
    tocados,
    fotosNovas: k === "fotos_modelo" ? [] : r.fotosNovas,
    conflitos: r.conflitos.filter((c) => c.path !== path),
  };
}

/** Texto PT, seguro pro usuário (Minor R1-5/fix round 3) — nunca cita nome de função/task interna. Se o guard de
 *  `payloadItem` algum dia disparar (não deveria, no fluxo planejado — ver o comentário da função), esse é o
 *  texto que chega ao toast (via `mensagemErro`). */
export const TEXTO_FOTOS_SEM_UPLOAD =
  "Não foi possível enviar as fotos novas. Tente salvar de novo.";
/** Item do `integracao_salvar`: só as colunas alteradas (as ausentes não gravam). SKU NÃO vai aqui (passo 3).
 *  Important #2 (fix round 1) — `preco_anterior`/`preco_venda` NUNCA mandam 0/negativo: o servidor aceita `>= 0`
 *  na validação genérica de `integracao_salvar`, mas `preco_venda` de revenda/importado é repassado a
 *  `salvar_precos_fixo_produto_acabado/_importado`, que RAISE P0001 pra qualquer valor NÃO-NULL `<= 0` — e aborta
 *  o LOTE inteiro (sem savepoint). NULL é a única codificação de "sem preço"/"automático" que não estoura.
 *  Minor #3 (round 0) / fix round 3 — GUARDA RESTAURADA: quando `fotos_modelo` está entre as colunas alteradas
 *  (há `fotosNovas` pendentes de upload) e o chamador não informa `fotosFinais`, esta função LANÇA (nunca
 *  descarta os marcadores `novo:` em silêncio). Isto roda em T11 passo 1, ANTES de qualquer escrita no banco,
 *  dentro do `try` do Salvar — o `catch` correspondente apaga os uploads que essa tentativa já tiver feito, então
 *  nada fica órfão no Storage nem sem sinal nenhum pro usuário. O caminho feliz (T11 sempre passa `fotosFinais`
 *  quando há `fotosNovas`) nunca exercita este ramo; ele é a rede de segurança para um T11 que esqueça o
 *  argumento — bem diferente de `aposSalvar` (Minor R1-3), que roda DEPOIS do commit e por isso NUNCA lança. */
export function payloadItem(r: Rascunho, fotosFinais?: string[]): ItemSalvar | null {
  const cols = colunasAlteradas(r);
  if (cols.length === 0) return null;
  if (cols.includes("fotos_modelo") && r.fotosNovas.length > 0 && fotosFinais === undefined) {
    throw new Error(TEXTO_FOTOS_SEM_UPLOAD);
  }
  const campos: ItemSalvar["campos"] = {};
  for (const c of cols) {
    const v = r.valores[c];
    if (c === "fotos_modelo")
      campos.fotos_modelo =
        fotosFinais ?? r.valores.fotos_modelo.filter((f) => !f.startsWith(PREFIXO_FOTO_NOVA));
    else if (c === "nome" || c === "ref") campos[c] = String(v ?? "").trim();
    else if (c === "preco_anterior") campos.preco_anterior = precoAnteriorOuNull(v);
    else if (c === "preco_venda") campos.preco_venda = precoNormalizado(v);
    else if (TEXTO_OU_NULL.has(c)) campos[c] = String(v ?? "").trim() || null;
    else campos[c] = typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return { modelo_id: r.modeloId, rev: r.rev, campos };
}
/** Depois do Salvar: o que gravou vira a base; sobra rascunho SÓ se os SKUs "a gravar" não gravaram (passo 3).
 *  Minor R1-3 (fix round 2) — NUNCA lança: este código roda DEPOIS de um Salvar já commitado no servidor (T12b,
 *  dentro do onSuccess), então um throw aqui vira um erro de render pós-sucesso e não protege nada (as fotos já
 *  estão no Storage). Quando há `fotosNovas` pendentes e o upload (`o.fotos`) não veio, o rascunho residual
 *  DEGRADA: mantém o `rev` PRÉ-salvar (não adota `o.rev`) e os marcadores `novo:` saem de `fotos_modelo` — como
 *  `tocados` fica vazio, o PRÓXIMO `mesclar` (rev != atual) adota `fotos_modelo` do servidor silenciosamente
 *  (fluxo normal de "campo não tocado segue o servidor"), sem qualquer estado inconsistente ficar exposto na UI. */
export function aposSalvar(
  r: Rascunho,
  o: { rev?: number; fotos?: string[]; skusGravados: boolean },
): Rascunho | null {
  if (o.skusGravados || nadaAGravar(r.skus)) return null;
  const semFotosDoUpload = r.fotosNovas.length > 0 && o.fotos === undefined;
  const valores: Valores = {
    ...r.valores,
    fotos_modelo: o.fotos ?? r.valores.fotos_modelo.filter((f) => !f.startsWith(PREFIXO_FOTO_NOVA)),
  };
  return {
    ...r,
    // Minor R1-3: sem o resultado do upload, mantém o rev PRÉ-salvar (nunca o novo) — o próximo mesclar detecta
    // rev diferente e adota fotos_modelo do servidor sozinho, sem inventar um "salvo" que não é fiel ao real.
    rev: semFotosDoUpload ? r.rev : (o.rev ?? r.rev),
    base: valores,
    valores: { ...valores },
    tocados: new Set(),
    fotosNovas: [],
    conflitos: [],
  };
}
/** A sublinha da lista no formato da seção Códigos (digitarSku/skuExibido/situacaoPrevia leem este shape). */
export function linhaSkuDaSublinha(s: Sublinha): LinhaSku {
  return {
    variante_key: s.varianteKey,
    variante_ordem: s.varianteOrdem,
    cor_nome: s.corNome,
    apelido_nome: s.apelidoNome,
    tamanho_key: s.tamanhoKey,
    tamanho_ordem: s.tamanhoOrdem,
    id: s.skuId,
    sku: s.sku,
    manual: s.manual,
    rev: s.skuRev,
    sku_previsto: null,
    faltas: [],
    avisos: [],
    conflito_com: null,
    estado: s.sku ? (s.manual ? "manual" : "ok") : "vazio",
  };
}
