// Integração — o Salvar da aba Produtos em 3 passos (spec §6, D15): (1) sobe as fotos novas (bucket "modelos", prefixo da
// loja — inv. #2); (2) integracao_salvar com TODOS os produtos alterados numa chamada (atômica; P0409 = rev velho) — se
// falhar, apaga as fotos que ESTE Salvar subiu (nada órfão); (3) SKUs digitados, produto a produto: prévia da MESMA entrada
// (REF já gravada no passo 2) → aplicar com a assinatura dela (modo "manuais"). Falha no passo 3 não desfaz o 2 (o produto
// já foi salvo — mesmo contrato da seção Códigos). Dependências injetadas: testável sem banco.
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

/** Entrada da prévia/gravação dos SKUs: a REF do rascunho (= a gravada depois do passo 2) e sempre o modo "manuais" (D15).
 *  NOTA (T11): `tamanhoTipo` do Rascunho pode ser `null` (Task 10 não força mais "letra" — produto legado sem "Tamanho em"
 *  escolhido). Esta função só é chamada, em `salvarIntegracao`, depois de um `nadaAGravar(r.skus)` guard — mas mesmo assim
 *  nunca deve fabricar "letra": o chamador (`skusEntrada`, abaixo) já filtra fora qualquer rascunho com `tamanhoTipo` null
 *  ANTES de chegar aqui, então o cast é seguro neste ponto (documentado, não silencioso). */
export const entradaSkus = (r: Rascunho): EntradaSkus => ({
  ref: String(r.valores.ref ?? "").trim(), tamanhoTipo: r.tamanhoTipo as "letra" | "numero", manuais: manuaisParaRpc(r.skus), modo: "manuais",
});

export async function salvarIntegracao(rascunhos: Rascunho[], deps: DepsSalvar): Promise<ResultadoSalvar> {
  const subidos: string[] = [];
  const fotos: Record<string, string[]> = {};
  let res: { salvos: number; revs: Record<string, number> } = { salvos: 0, revs: {} };
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
        finais = r.valores.fotos_modelo
          .map((f) => (f.startsWith(PREFIXO_FOTO_NOVA) ? caminho[f.slice(PREFIXO_FOTO_NOVA.length)] : f))
          .filter((f): f is string => typeof f === "string" && f !== "");
        fotos[r.modeloId] = finais;
      }
      const item = payloadItem(r, finais);
      if (item) itens.push(item);
    }
    if (itens.length > 0) res = await deps.salvar(itens);
  } catch (e) {
    if (subidos.length > 0) await deps.apagarFotos(subidos).catch(() => undefined);
    throw e;
  }
  const skusOk: string[] = [];
  const skusFalhas: FalhaSku[] = [];
  for (const r of rascunhos) {
    if (nadaAGravar(r.skus)) continue;
    // "Tamanho em" indefinido (rascunho legado sem escolha) nunca vira "letra" por engano (mesma régua da T10/Sheet):
    // sem tamanhoTipo não dá pra montar a entrada da prévia/gravação, então este produto simplesmente não entra no
    // passo 3 — a falta "Tamanho em" já bloqueia isso na tela antes de o usuário conseguir digitar um SKU pra valer.
    if (r.tamanhoTipo === null) continue;
    const e = entradaSkus(r);
    try {
      const p = await deps.previaSkus(r.modeloId, e);
      if (p.desconhecida || !p.assinatura) {
        skusFalhas.push({ modeloId: r.modeloId, nome: r.nome, texto: MSG_PREVIA_DESCONHECIDA });
        continue;
      }
      if (p.erros.length > 0) {
        skusFalhas.push({ modeloId: r.modeloId, nome: r.nome, texto: mensagemErroPrevia(p.erros[0]) });
        continue;
      }
      const out = await deps.aplicarSkus(r.modeloId, { manuais: e.manuais, modo: "manuais", assinatura: p.assinatura });
      const resumo = resumoAplicacao(out);
      if (resumo.erro) skusFalhas.push({ modeloId: r.modeloId, nome: r.nome, texto: resumo.texto });
      else skusOk.push(r.modeloId);
    } catch (err) {
      skusFalhas.push({ modeloId: r.modeloId, nome: r.nome, texto: mensagemAplicarSkus(err) });
    }
  }
  return { ...res, fotos, skusOk, skusFalhas };
}
