// Integração — o Salvar da aba Produtos em 3 passos (spec §6, D15): (1) sobe as fotos novas (bucket "modelos", prefixo da
// loja — inv. #2); (2) integracao_salvar com TODOS os produtos alterados numa chamada (atômica; P0409 = rev velho) — se
// falhar, apaga as fotos que ESTE Salvar subiu (nada órfão); (3) SKUs digitados, produto a produto: prévia da MESMA entrada
// (REF já gravada no passo 2) → aplicar com a assinatura dela (modo "manuais"). Falha no passo 3 não desfaz o 2 (o produto
// já foi salvo — mesmo contrato da seção Códigos). Dependências injetadas: testável sem banco.
//
// Fix round 1 (task-11-review.md Important 1 + code-review.md I1): o `catch` do passo 2 só apaga os uploads deste Salvar
// quando a recusa é DEFINITIVA (código de erro não-vazio: rollback garantido no servidor — P0409/P0001/42501/57014/…) OU
// quando a RPC NUNCA foi enviada (falha de upload/`payloadItem`, sem chamada nenhuma ao servidor). Com resultado
// DESCONHECIDO (falha de rede depois do envio: `code` vazio/ausente — o `integracao_salvar` pode já ter COMITADO), os
// uploads são MANTIDOS (o pior caso é um órfão no Storage) e relança um erro com texto em PT pedindo para recarregar e
// conferir — nunca o card ficando com um caminho para um objeto que este Salvar acabou de apagar.
import {
  MSG_PREVIA_DESCONHECIDA, manuaisParaRpc, mensagemAplicarSkus, mensagemErroPrevia, nadaAGravar, resumoAplicacao,
  type ManualRpc, type PreviaSkus,
} from "@/components/planejamento/planejamento-detail/codigos/sku-previa";
import { PREFIXO_FOTO_NOVA, colunasAlteradas, payloadItem, type ItemSalvar, type Rascunho } from "@/lib/integracao/rascunho";

export type EntradaSkus = { ref: string; tamanhoTipo: "letra" | "numero"; manuais: ManualRpc[]; modo: "manuais" };
export type DepsSalvar = {
  subirFoto: (file: File) => Promise<string>;
  apagarFotos: (caminhos: string[]) => Promise<void>;
  salvar: (itens: ItemSalvar[]) => Promise<{ salvos: number; revs: Record<string, number> }>;
  previaSkus: (modeloId: string, e: EntradaSkus) => Promise<PreviaSkus>;
  aplicarSkus: (modeloId: string, a: { manuais: ManualRpc[]; modo: "manuais"; assinatura: string }) => Promise<unknown>;
};
export type FalhaSku = { modeloId: string; nome: string; texto: string };
export type ResultadoSalvar = {
  salvos: number; revs: Record<string, number>; fotos: Record<string, string[]>; skusOk: string[]; skusFalhas: FalhaSku[];
};

/** Texto do resultado DESCONHECIDO do passo 2 (Important 1 das duas revisões): a chamada saiu, mas a resposta nunca
 *  chegou (rede caiu, proxy cortou) — o servidor pode ter COMITADO. Nunca apaga fotos nesse caso (I1); só avisa. Sem
 *  `code` reconhecido (getCode retorna "" para um Error puro), `mensagemErro` cai no teste PARECE_PT e devolve este
 *  texto verbatim — não no fallback genérico da tela. */
export const TEXTO_RESULTADO_DESCONHECIDO =
  "Não foi possível confirmar se as alterações foram salvas (a conexão caiu no meio do Salvar). Recarregue a página e confira antes de tentar de novo.";

/** Entrada da prévia/gravação dos SKUs: a REF do rascunho (= a gravada depois do passo 2) e sempre o modo "manuais" (D15).
 *  Fix round 1 (task-11-review.md Minor 2 + code-review.md M1): `entradaSkus` só aceita um rascunho com `tamanhoTipo`
 *  JÁ estreitado para "letra"/"numero" — devolve `null` quando `tamanhoTipo` é `null`, em vez de um cast que o
 *  compilador não fiscaliza. Os DOIS chamadores (`salvarIntegracao` abaixo e `usePreviasSkus` em `useIntegracao.ts`)
 *  tratam esse `null` explicitamente; nenhum dos dois fabrica "letra" por omissão. */
export function entradaSkus(r: Rascunho): EntradaSkus | null {
  if (r.tamanhoTipo === null) return null;
  return { ref: String(r.valores.ref ?? "").trim(), tamanhoTipo: r.tamanhoTipo, manuais: manuaisParaRpc(r.skus), modo: "manuais" };
}

/** Minor 7 (code-review.md): "tem SKU a gravar" é UM predicado só, usado no passo 3 e na prévia (`usePreviasSkus`) —
 *  antes o passo 3 usava `nadaAGravar` (que também conta `regerar`) e a prévia só contava `manuais`; um rascunho com
 *  `regerar:true` e `manuais` vazio divergia entre os dois pontos. D15 nunca liga `regerar` na Integração (só SKU
 *  digitado à mão), então o predicado real é sempre "há alguma linha manual". */
export const temSkuAGravar = (r: Rascunho): boolean => Object.keys(r.skus.manuais).length > 0;

/** true quando o erro do passo 2 é uma recusa DEFINITIVA do servidor (SQLSTATE/código PostgREST não-vazio: P0409,
 *  P0001, 42501, 57014, 22xxx, 23xxx, PGRST…) — nesses casos o servidor deu ROLLBACK e as fotos deste Salvar nunca
 *  foram referenciadas por ninguém, então apagar é seguro. Um erro de rede (`Failed to fetch`) chega com `code: ""`
 *  (postgrest-js) e NÃO é definitivo: o `integracao_salvar` pode ter COMITADO antes da resposta se perder. */
function recusaDefinitiva(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && code !== "";
}

export async function salvarIntegracao(rascunhos: Rascunho[], deps: DepsSalvar): Promise<ResultadoSalvar> {
  const subidos: string[] = [];
  const fotos: Record<string, string[]> = {};
  let res: { salvos: number; revs: Record<string, number> } = { salvos: 0, revs: {} };
  let rpcEnviada = false;
  try {
    const itens: ItemSalvar[] = [];
    for (const r of rascunhos) {
      const cols = colunasAlteradas(r);
      if (cols.length === 0) continue;
      let finais: string[] | undefined;
      if (cols.includes("fotos_modelo")) {
        const caminho: Record<string, string> = {};
        for (const n of r.fotosNovas) {
          if (!r.valores.fotos_modelo.includes(PREFIXO_FOTO_NOVA + n.id)) continue;
          const c = await deps.subirFoto(n.file);
          subidos.push(c);
          caminho[n.id] = c;
        }
        finais = r.valores.fotos_modelo.map((f) => {
          if (!f.startsWith(PREFIXO_FOTO_NOVA)) return f;
          const c = caminho[f.slice(PREFIXO_FOTO_NOVA.length)];
          // Minor 3 (task-11-review.md): marcador `novo:<id>` sem upload correspondente falha alto (mesma rede de
          // segurança do `payloadItem` da Task 10) em vez de ser filtrado em silêncio — o `catch` logo abaixo já
          // cobre a limpeza dos uploads que ESTA tentativa efetivamente fez.
          if (c === undefined) throw new Error(TEXTO_FOTOS_NOVAS_PERDIDAS);
          return c;
        });
        fotos[r.modeloId] = finais;
      }
      const item = payloadItem(r, finais);
      if (item) itens.push(item);
    }
    if (itens.length > 0) {
      rpcEnviada = true;
      res = await deps.salvar(itens);
    }
  } catch (e) {
    // Important 1 (task-11-review.md + code-review.md I1): apaga os uploads desta tentativa só quando (a) a RPC nunca
    // foi enviada (falha antes do passo 2: upload ou payloadItem) ou (b) o servidor recusou de forma DEFINITIVA
    // (código não-vazio = rollback garantido). Um resultado DESCONHECIDO (RPC enviada, erro sem código — rede caiu
    // depois do envio) NUNCA apaga: o `integracao_salvar` pode já ter comitado, e apagar deixaria o card apontando
    // para um objeto inexistente (pior que um órfão no Storage).
    if (subidos.length > 0 && (!rpcEnviada || recusaDefinitiva(e))) {
      await deps.apagarFotos(subidos).catch(() => undefined);
    }
    if (rpcEnviada && !recusaDefinitiva(e)) {
      throw new Error(TEXTO_RESULTADO_DESCONHECIDO);
    }
    throw e;
  }
  const skusOk: string[] = [];
  const skusFalhas: FalhaSku[] = [];
  for (const r of rascunhos) {
    if (!temSkuAGravar(r)) continue;
    const e = entradaSkus(r);
    // Minor 1 (task-11-review.md) / M1 (code-review.md): "Tamanho em" indefinido (rascunho legado sem escolha) NUNCA
    // vira "letra" por engano — mas também nunca some em silêncio: o produto ganha uma `skusFalhas` com um texto que
    // explica o motivo, então a UI sempre tem algo pra mostrar (sem isso, o rascunho residual planejado pela T12b
    // ficaria "sujo" pra sempre, sem nenhuma mensagem, e todo Salvar repetiria o mesmo silêncio).
    if (e === null) {
      skusFalhas.push({
        modeloId: r.modeloId, nome: nomeAtualDoRascunho(r),
        texto: `${PREFIXO_SKUS_NAO_GRAVADOS_LOCAL}defina "Tamanho em" no card do produto antes de gravar os SKUs.`,
      });
      continue;
    }
    try {
      const p = await deps.previaSkus(r.modeloId, e);
      if (p.desconhecida || !p.assinatura) {
        skusFalhas.push({ modeloId: r.modeloId, nome: nomeAtualDoRascunho(r), texto: MSG_PREVIA_DESCONHECIDA });
        continue;
      }
      if (p.erros.length > 0) {
        skusFalhas.push({ modeloId: r.modeloId, nome: nomeAtualDoRascunho(r), texto: mensagemErroPrevia(p.erros[0]) });
        continue;
      }
      const out = await deps.aplicarSkus(r.modeloId, { manuais: e.manuais, modo: "manuais", assinatura: p.assinatura });
      const resumo = resumoAplicacao(out);
      if (resumo.erro) skusFalhas.push({ modeloId: r.modeloId, nome: nomeAtualDoRascunho(r), texto: resumo.texto });
      else skusOk.push(r.modeloId);
    } catch (err) {
      skusFalhas.push({ modeloId: r.modeloId, nome: nomeAtualDoRascunho(r), texto: mensagemAplicarSkus(err) });
    }
  }
  return { ...res, fotos, skusOk, skusFalhas };
}

/** Minor 3 (task-11-review.md): texto do marcador `novo:<id>` sem upload correspondente — reusa o mesmo prefixo da
 *  Task 10 (`TEXTO_FOTOS_SEM_UPLOAD`) para ficar consistente com o texto que o usuário já vê quando `payloadItem`
 *  recusa por falta de `fotosFinais`. */
const TEXTO_FOTOS_NOVAS_PERDIDAS = "Não foi possível enviar as fotos novas. Tente salvar de novo.";
/** Mesmo prefixo de `sku-previa.ts` (`PREFIXO_SKUS_NAO_GRAVADOS`) — duplicado aqui como const local só para o texto de
 *  "Tamanho em" ausente, que não tem uma mensagem pronta na seção Códigos (lá o campo é sempre preenchido). */
const PREFIXO_SKUS_NAO_GRAVADOS_LOCAL = "O card foi salvo, mas os SKUs não foram gravados: ";

/** M6 (code-review.md): o nome do TOAST usa o do RASCUNHO (o que a pessoa digitou nesta mesma sessão de Salvar),
 *  nunca o nome antigo do servidor — se este Salvar também renomeou o produto, o toast de falha de SKU já mostra o
 *  nome novo. `r.nome` (o nome carregado do servidor) é o fallback para um valor vazio/inválido. */
function nomeAtualDoRascunho(r: Rascunho): string {
  const editado = String(r.valores.nome ?? "").trim();
  return editado || r.nome;
}
