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
import { rotuloDaColuna, type ColunaEditavel } from "@/lib/integracao/campos";
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
/** P-155 B + R4 — o Título AUTOMÁTICO do produto: na v2+ o título EFETIVO da versão anterior (`herdado`, pronto do
 *  servidor — RPC `modelos_versao_anterior`); na v1/órfã (`herdado` null) o calculado do Nome do rascunho + a loja. */
export const tituloAutomaticoDoRascunho = (r: Rascunho, nomeLoja: string | null, herdado: string | null = null): string =>
  herdado ?? tituloCalculadoDoRascunho(r, nomeLoja);
/** Important #1 (fix round 1) + Important R1-1/Minor R1-1 (fix round 2) — onChange do campo Título.
 *  `nomeLoja` null (nome da loja ainda não carregou): NUNCA colapsa o digitado pra NULL nem trata um Nome puro
 *  como automático — mantém exatamente o que a pessoa digitou (rede de segurança; T12a deve desabilitar o campo
 *  nesse estado, então esse ramo não deveria ser exercitado na prática). Minor R1-1: retorna `r` sem tocar quando
 *  o valor não muda (nunca marca `titulo_pagina` como tocado num blur/edição que é no-op).
 *  R4 (P-155 B): com `herdado` (v2+), o colapso "digitou igual ao automático → NULL" compara com o HERDADO — digitar
 *  o título "próprio" (calculado do Nome desta versão) fica DIGITADO (não vira herdado em silêncio). O herdado não
 *  depende de `nomeLoja` (já vem com a loja do servidor). */
export function editarTitulo(r: Rascunho, digitado: string, nomeLoja: string | null, herdado: string | null = null): Rascunho {
  const novo =
    herdado !== null
      ? tituloAoDigitar(digitado, herdado)
      : nomeLoja === null
        ? digitado
        : tituloAoDigitar(digitado, tituloCalculadoDoRascunho(r, nomeLoja));
  return igual(novo, r.valores.titulo_pagina) ? r : editar(r, "titulo_pagina", novo);
}
/** Important #1 (fix round 1) + Important R1-1/Minor R1-1 (fix round 2) — onBlur do campo Título.
 *  `nomeLoja` null: nunca colapsa pra NULL (mesma rede de segurança de `editarTitulo`). R4: com `herdado`, compara
 *  com ele. */
export function sairTitulo(r: Rascunho, nomeLoja: string | null, herdado: string | null = null): Rascunho {
  if (herdado === null && nomeLoja === null) return r; // nada a normalizar sem o automático calculável — mantém o que já está
  const novo = tituloAoSair(r.valores.titulo_pagina, tituloAutomaticoDoRascunho(r, nomeLoja, herdado));
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
 *  guardado no rascunho).
 *
 *  Fix round 1 T12b (revisão A-I1(c)/B-I4(c)): `p.rev <= r.rev` também não mescla (não só `===`) — sem essa
 *  guarda, mesclar contra uma lista em CACHE mais VELHA que o rascunho (ex.: uma sobra pós-Salvar já em rev N+1
 *  sendo re-mesclada contra uma lista que ainda mostra N, porque o `onSettled`/refetch ainda não chegou) BAIXARIA
 *  o rev da sobra e REVERTERIA os valores para os de antes do Salvar (com `tocados` recém-zerado, o merge
 *  adotaria o `fresh` velho por inteiro). `p.rev < r.rev` nunca é uma "versão nova" de verdade — é a PRÓPRIA
 *  função quem decide não regredir, em vez de depender de cada chamador lembrar de comparar antes de chamar. */
export function mesclar(r: Rascunho, p: ProdutoLista): Rascunho {
  if (p.rev <= r.rev) return r;
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
  // Fix round 1 T12b (m12/B-Minor 12): `mergeDraft` (`@/lib/colab/merge`, compartilhado por 6 outras telas — NUNCA
  // editado aqui) compara com `igual` CRU, mas o servidor apara/normaliza (`btrim`, `nullif`) antes de gravar
  // (`integracao_salvar`, `_integracao_retrato_core`). Sem normalizar aqui, o PRÓPRIO save do usuário (ex.: digitou
  // "Blusa " com espaço, o servidor gravou "Blusa" trimado) reaparecia como "Outra pessoa mudou este campo" na
  // relista seguinte — um falso conflito contra si mesmo. Filtra os conflitos NOVOS cujo texto do rascunho e do
  // fresco são o MESMO valor depois de normalizado pela MESMA régua de `colunasAlteradas`/`normalizado()`.
  const conflitosNovosDeVerdade = m.conflitos.filter((c) => {
    const coluna = c.path as ColunaEditavel;
    if (!(coluna in fresh)) return true; // path fora das 12 colunas normalizáveis (não deveria acontecer aqui)
    return !igual(normalizado(coluna, c.meu), normalizado(coluna, c.dele));
  });
  const conflitos = [...antigosVivos, ...conflitosNovosDeVerdade];
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
/** Uma recusa de validação CLIENTE — nomeia o CAMPO (rótulo curto, `campos.ts`) pra célula/toast apontar o lugar
 *  certo (Fix round 1 T12b, revisão A-I4/B-I7): o lote de `integracao_salvar` é ATÔMICO e nenhuma mensagem do
 *  servidor carrega o produto, então com N produtos sujos o usuário não tem como achar QUAL célula bloqueia o
 *  lote inteiro sem essa pré-validação. */
export type ErroValidacao = { coluna: ColunaEditavel; texto: string };
const LIMITE_NOME_COMPRADO = 200;
/** Espelha (sem re-implementar 1:1, só o suficiente pra recusar CEDO com o campo certo) as validações P0001 de
 *  `integracao_salvar` (`20261007140000_integracao_5_salvar.sql:571-609`) — nome/REF vazio, nome > 200 em
 *  revenda/importado, negativo/NaN e fora da escala `numeric(p,s)` de peso/medidas/preços. Roda só sobre as
 *  colunas REALMENTE alteradas (mesmo escopo de `payloadItem`/`colunasAlteradas`) — nunca sinaliza erro num campo
 *  que nem vai no payload. Fotos não entram aqui: o caminho de upload (`salvar-integracao.ts`) já valida o
 *  prefixo/segmento antes de gravar, e o valor "de outra loja" só pode vir de um bug interno, não de digitação. */
export function validarRascunho(r: Rascunho, origem: ProdutoLista["origem"]): ErroValidacao[] {
  const erros: ErroValidacao[] = [];
  const cols = colunasAlteradas(r);
  if (cols.includes("nome") && String(r.valores.nome ?? "").trim() === "") {
    erros.push({ coluna: "nome", texto: "O nome não pode ficar vazio." });
  }
  if (cols.includes("ref") && String(r.valores.ref ?? "").trim() === "") {
    erros.push({ coluna: "ref", texto: "A REF não pode ficar vazia." });
  }
  if (cols.includes("nome") && (origem === "revenda" || origem === "importado")) {
    const nome = String(r.valores.nome ?? "").trim();
    // Fix round 2 T12b (minor, ambas as revisões): `.length` do JS conta UNIDADES UTF-16, não CODE POINTS — um
    // emoji/caractere astral (fora do BMP) ocupa 2 unidades em `.length` mas só 1 "caractere" pra quem digita e
    // pro Postgres (`char_length` do servidor conta code points). Sem isso, um nome de ~101-200 code points com
    // ALGUM caractere astral podia ser recusado no CLIENTE mesmo estando dentro do limite real do servidor —
    // `[...nome].length` (iterador de code points) bate com `char_length`.
    if ([...nome].length > LIMITE_NOME_COMPRADO) {
      erros.push({
        coluna: "nome",
        texto: `Nome muito longo para o Produto ${origem === "revenda" ? "Acabado" : "Importado"} (máx. 200 caracteres).`,
      });
    }
  }
  // Mesma faixa de escala de `integracao_salvar` (peso numeric(10,3), medidas numeric(10,2), preços numeric(12,2)):
  // a parte inteira cabe em (p−s) dígitos — abs(valor arredondado) < 10^(p−s) — e nenhum dos 6 aceita negativo.
  const faixas: Partial<Record<ColunaEditavel, { casas: number; digitos: number }>> = {
    peso_kg: { casas: 3, digitos: 10 - 3 },
    comprimento_cm: { casas: 2, digitos: 10 - 2 },
    largura_cm: { casas: 2, digitos: 10 - 2 },
    altura_cm: { casas: 2, digitos: 10 - 2 },
    preco_anterior: { casas: 2, digitos: 12 - 2 },
    preco_venda: { casas: 2, digitos: 12 - 2 },
  };
  for (const [coluna, faixa] of Object.entries(faixas) as [ColunaEditavel, { casas: number; digitos: number }][]) {
    if (!cols.includes(coluna)) continue;
    const v = r.valores[coluna];
    if (v === null || v === undefined) continue; // NULL = "sem valor/automático" — nunca inválido
    if (typeof v !== "number" || !Number.isFinite(v)) {
      // Fix round 2 T12b (minor m-R4): nomeia o CAMPO — `erros[0].coluna` já existia, mas o texto sozinho ("…este
      // campo.") não dizia qual, e o toast (`ProdutosAba.onSalvar`) só concatena `${r.nome}: ${erros[0].texto}` —
      // sem o nome do campo aqui dentro, o usuário via só "Produto X: valor inválido", sem saber ONDE.
      erros.push({ coluna, texto: `"${rotuloDaColuna(coluna)}": valor numérico inválido (use número maior ou igual a zero).` });
      continue;
    }
    if (v < 0) {
      erros.push({ coluna, texto: `"${rotuloDaColuna(coluna)}": valor numérico inválido (use número maior ou igual a zero).` });
      continue;
    }
    const arredondado = Math.round(v * 10 ** faixa.casas) / 10 ** faixa.casas;
    if (Math.abs(arredondado) >= 10 ** faixa.digitos) {
      erros.push({ coluna, texto: `"${rotuloDaColuna(coluna)}": valor numérico fora da faixa permitida.` });
    }
  }
  return erros;
}

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
/** Fix round 3 T12b (m-S2, code-review "Re-check round 2") — os valores que um produto SALVOU por inteiro (sem
 *  sobra de rascunho), pra guardar na espera "salvo, aguardando lista" (ruling B-I3, `ProdutosAba.tsx`). Usa a
 *  MESMA `normalizado()` que `colunasAlteradas`/`mesclar` já usam pra decidir "alterado"/filtrar falso-conflito —
 *  a MESMA régua que o servidor aplica (`_integracao_retrato_core`/`integracao_salvar`: `btrim`, `nullif`, preço
 *  arredondado/`<=0`→NULL). Sem isso, a espera guardava os valores CRUS do rascunho ("Blusa " em vez de "Blusa",
 *  preço `0` em vez de `NULL`) — como a espera fica sob a MESMA chave de cache `${id}:${rev}` até o próximo bump
 *  de rev (m-S2), um merge futuro comparando o valor CRU da espera contra o valor NORMALIZADO que o servidor de
 *  fato gravou podia acender um falso "Outra pessoa mudou este campo" (o filtro de convergência do m12 só cobre
 *  quando o rascunho NORMALIZADO bate com o fresco — aqui o valor da espera nunca passava por normalização
 *  nenhuma). `fotosFinais` substitui `fotos_modelo` quando o upload terminou (mesmo parâmetro de `payloadItem`);
 *  sem ele, mantém os caminhos já reais do rascunho (nunca os marcadores `novo:`, que só existem ANTES do Salvar).
 *
 *  Fix m-T1 round 1 (carry da revisão da Task 12b, task-13-brief.md) — CORRIGIDO de verdade na T13 fix round 1
 *  (revisão T13 #6, task-13-review.md m2 + task-13-code-review.md m4): normaliza SÓ as colunas que de fato foram
 *  ENVIADAS (`colunasAlteradas(r)`, o MESMO filtro de `payloadItem` — é exatamente o que o servidor gravou desta
 *  vez). As demais colunas usam `r.base[c]` CRU — SEM passar por `normalizado()`. A 1ª versão desta função (fix
 *  round original) normalizava as duas fontes por engano, com uma premissa que as duas revisões da Task 13 corrigem:
 *  o servidor só faz `UPDATE` nas colunas ENVIADAS — uma coluna NÃO tocada, com um valor legado não-normalizado no
 *  banco (`nome="Blusa "` com espaço, `preco_anterior=0`, `ncm=""`), CONTINUA exatamente assim no banco depois deste
 *  Save. `r.base[c]` já É esse valor cru (`valoresDoRaw`/`RawProduto`, sem trim/arredondamento — `rawDe`/`num`/`txt`
 *  em produtos.ts) — é LITERALMENTE o que uma relista traria de volta (`fresh = valoresDoRaw(p.raw)` em `mesclar`).
 *  Normalizar aqui (a v1) gravava na "espera" um valor DIFERENTE do banco (`null` em vez de `0`/`""`, "Blusa" sem
 *  espaço) — na relista seguinte, `mergeDraft`/`igual(base,fresh)` (comparação CRUA, `colab/merge.ts`) via
 *  `mesclar()` comparava esse `base` normalizado contra o `fresh` CRU da lista e via uma diferença que não existe de
 *  verdade no servidor: um falso "Outra pessoa mudou este campo" contra ninguém. O filtro de convergência de
 *  `mesclar` (m12, mais abaixo) normaliza `meu × dele` (o CONFLITO reportado por `mergeDraft`), não `base × fresh`
 *  (a entrada CRUA de `mergeDraft`) — não protege este caso. */
export function valoresPosSalvar(r: Rascunho, fotosFinais?: string[]): Valores {
  const enviadas = new Set(colunasAlteradas(r));
  const v = {} as Valores;
  for (const c of COLUNAS) {
    if (c === "fotos_modelo") {
      v.fotos_modelo = enviadas.has("fotos_modelo")
        ? (fotosFinais ?? r.valores.fotos_modelo.filter((f) => !f.startsWith(PREFIXO_FOTO_NOVA)))
        : r.base.fotos_modelo;
    } else if (enviadas.has(c)) {
      (v as Record<ColunaEditavel, unknown>)[c] = normalizado(c, r.valores[c]);
    } else {
      (v as Record<ColunaEditavel, unknown>)[c] = r.base[c];
    }
  }
  return v;
}
/** Depois do Salvar: o que gravou vira a base; sobra rascunho SÓ se os SKUs "a gravar" não gravaram (passo 3).
 *  Minor R1-3 (fix round 2) — NUNCA lança: este código roda DEPOIS de um Salvar já commitado no servidor (T12b,
 *  dentro do onSuccess), então um throw aqui vira um erro de render pós-sucesso e não protege nada (as fotos já
 *  estão no Storage). Quando há `fotosNovas` pendentes e o upload (`o.fotos`) não veio, o rascunho residual
 *  DEGRADA: mantém o `rev` PRÉ-salvar (não adota `o.rev`) e os marcadores `novo:` saem de `fotos_modelo` — como
 *  `tocados` fica vazio, o PRÓXIMO `mesclar` (rev != atual) adota `fotos_modelo` do servidor silenciosamente
 *  (fluxo normal de "campo não tocado segue o servidor"), sem qualquer estado inconsistente ficar exposto na UI.
 *
 *  Fix round 1 T12b (revisão A-I1(b)/B-I4(b)): `rev` NUNCA pode BAIXAR. Antes usava `o.rev ?? r.rev` — se `r` (o
 *  rascunho ATUAL, não o enviado) já tivesse sido mesclado para um rev mais novo por um refetch/relista em voo
 *  durante o Salvar (ex.: refetch por foco de janela, que não é suprimido pela guarda do Realtime em
 *  `useIntegracao.ts`), `o.rev` (o retorno do servidor, calculado ANTES desse refetch) podia ser MENOR que
 *  `r.rev` — e a sobra regredia pra uma versão velha, prendendo todo Salvar seguinte num P0409 permanente
 *  (cenário documentado na revisão: kanban automático bumpa rev no COMMIT + refetch de foco no meio do passo 3).
 *  Agora usa `Math.max`, então a sobra NUNCA fica com um rev mais velho que o que ela já tinha antes do Salvar. */
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
    // Fix round 1 T12b: nos outros casos, NUNCA baixa — `Math.max(r.rev, o.rev ?? r.rev)`.
    rev: semFotosDoUpload ? r.rev : Math.max(r.rev, o.rev ?? r.rev),
    base: valores,
    valores: { ...valores },
    tocados: new Set(),
    fotosNovas: [],
    conflitos: [],
  };
}
export type ResultadoSalvarLote = {
  salvos: number;
  revs: Record<string, number>;
  fotos: Record<string, string[]>;
  skusOk: string[];
};
export type EsperaAguardando = { valores: Valores; rev: number };
export type ResultadoPosSalvar = {
  proxRascunhos: Record<string, Rascunho>;
  novosAguardando: Record<string, EsperaAguardando>;
};
/** Fix round 3 T12b (m-S1, code-review "Re-check round 2") — a computação INTEIRA de "o que sobra em `rascunhos`
 *  depois do Salvar" + "quais produtos entram na espera 'salvo, aguardando lista' (ruling B-I3)", extraída de
 *  `ProdutosAba.onSuccess` pra uma função PURA, testável sem nenhum React envolvido. A v1 (round 2) fazia esse
 *  cálculo DENTRO do updater de `setRascunhos` e lia o resultado (`novosAguardando`) de uma variável de fora,
 *  logo depois de chamar `setRascunhos(...)` — funcionava só quando o React roda o updater de forma "eager"
 *  (nenhuma atualização pendente na fibra no instante da chamada); com uma atualização JÁ enfileirada na mesma
 *  fibra (outro `setState` do mesmo componente disparado no mesmo instante, fora de um `act()`/lote de eventos —
 *  cenário real de produção, já que o `onSuccess` do TanStack Query roda fora do sistema de eventos sintéticos do
 *  React), o updater passa a rodar só no PRÓXIMO commit — a variável lida logo depois chegava vazia, e a espera
 *  nunca era criada (um flash transitório do valor antigo, "curado" sozinho no commit seguinte, mas real). Como
 *  função PURA chamada ANTES de qualquer `setState`, este código nunca depende de QUANDO o React decide rodar um
 *  updater — o resultado é sempre calculado de uma vez, síncrono, na chamada.
 *
 *  `rascunhosAtuais` é o estado VIVO no instante do sucesso (`rascunhosRef.current` em `ProdutosAba`, nunca o
 *  `rascunhos` capturado no fechamento de `onSalvar`/antes do `await`). `enviados` é a lista de `Rascunho`s que
 *  foram de fato mandados nesse Salvar. `cache` é o mapa id→produto mais recente em cache (`produtosEmCache`),
 *  usado pra re-mesclar uma sobra contra um rev mais novo já disponível (I4(c)). */
export function resultadoPosSalvar(
  rascunhosAtuais: Record<string, Rascunho>,
  enviados: readonly Rascunho[],
  res: ResultadoSalvarLote,
  cache: ReadonlyMap<string, ProdutoLista>,
): ResultadoPosSalvar {
  const proxRascunhos: Record<string, Rascunho> = { ...rascunhosAtuais };
  const novosAguardando: Record<string, EsperaAguardando> = {};
  for (const enviado of enviados) {
    // m9/m1 (revisão): `rascunhosAtuais[id]` ausente = o merge already descartou este rascunho durante o Salvar (o
    // produto virou integrável/saiu da lista) — não ressuscitar, mesmo que os SKUs dele tenham falhado.
    const atual = rascunhosAtuais[enviado.modeloId];
    if (!atual) continue;
    const revSalvo = res.revs[enviado.modeloId];
    let sobra = aposSalvar(atual, {
      rev: revSalvo,
      fotos: res.fotos[enviado.modeloId],
      skusGravados: res.skusOk.includes(enviado.modeloId),
    });
    if (sobra) {
      const fresco = cache.get(enviado.modeloId);
      if (fresco && fresco.rev > sobra.rev) sobra = mesclar(sobra, fresco);
      proxRascunhos[enviado.modeloId] = sobra;
    } else {
      delete proxRascunhos[enviado.modeloId];
      if (revSalvo !== undefined) {
        // Fix round 3 T12b (m-S2): valores NORMALIZADOS (mesma régua do servidor), nunca os CRUS do rascunho —
        // ver o comentário de `valoresPosSalvar`.
        novosAguardando[enviado.modeloId] = { valores: valoresPosSalvar(atual, res.fotos[enviado.modeloId]), rev: revSalvo };
      }
    }
  }
  return { proxRascunhos, novosAguardando };
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
