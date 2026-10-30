// [urg R13 T8] Fonte da tela da OC de Produto Importado multiproduto: o que NÃO pode voltar (ponteiro do cabeçalho, landed recalculado na
// tela, RPC antiga de 1 produto) e o que TEM de estar (reuso dos genéricos da T7, `_etapas` em toda chamada, caminho de presença por item).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const ROOT = process.cwd() + "/"; // (happy-dom/node: não depender de import.meta.url)
const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");
const DIR = "src/components/oc-p-importado/";
const arquivos = () => readdirSync(ROOT + DIR).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => DIR + f);
const ROTA = "src/routes/_authenticated/entrada-saida.oc-p-importado.tsx";

describe("OC P. Importado — fonte", () => {
  it("a tela NÃO recalcula landed: nada de custoLanded/EntradaLanded nem das etapas em BRL no front da OC", () => {
    for (const f of [...arquivos(), ROTA]) {
      const t = ler(f);
      expect(t, f).not.toMatch(/custoLanded|EntradaLanded|m2ParaBrl/);
    }
  });
  it("o landed do item só é LIDO: nenhum payload o envia e nenhum input o edita", () => {
    const itens = ler(DIR + "itens.ts");
    const corpo = itens.slice(itens.indexOf("export function itemParaPayload"), itens.indexOf("export const itensParaPayload"));
    expect(corpo).not.toContain("landed");
    expect(ler(DIR + "OcImpItem.tsx")).not.toMatch(/data-colab-path=\{cp\("custo_unitario_landed_real"\)\}/);
  });
  it("zero leitura do ponteiro do cabeçalho: sem embed ocs_importado( a partir do produto, sem filtro produto_importado_id em ocs_importado", () => {
    for (const f of [...arquivos(), ROTA]) {
      const t = ler(f);
      expect(t, f).not.toMatch(/ocs:\s*ocs_importado\s*\(/);
      expect(t, f).not.toMatch(/\bocs_importado\(id\)/);
      expect(t, f).not.toMatch(/from\(\s*["']ocs_importado["'][^)]*\)[\s\S]{0,200}?produto_importado_id/);
    }
    expect(ler(DIR + "ProdutoImportadoPicker.tsx")).toContain("ocs_importado_itens(id)");
  });
  it("só as RPCs R13 (itens): a RPC antiga de 1 produto no cabeçalho não é mais chamada pela tela", () => {
    for (const f of [...arquivos(), ROTA]) {
      const t = ler(f);
      expect(t, f).not.toMatch(/rpc\(\s*["']salvar_oc_importado["']/);
      expect(t, f).not.toMatch(/rpc\(\s*["']receber_oc_importado["']/);
    }
    const dlg = ler(DIR + "OcImpDialog.tsx");
    expect(dlg).toContain('"salvar_oc_importado_itens"');
    expect(dlg).toContain('"receber_item_oc_importado"');
    expect(ler(ROTA)).toContain('"excluir_oc_importado"');
  });
  it("TODA chamada que salva manda o cronograma completo (`_etapas`) e o `_rev_base`", () => {
    const dlg = ler(DIR + "OcImpDialog.tsx");
    const recebe = dlg.slice(dlg.indexOf('"receber_item_oc_importado"'), dlg.indexOf('"salvar_oc_importado_itens"'));
    const salva = dlg.slice(dlg.indexOf('"salvar_oc_importado_itens"'), dlg.indexOf("onSuccess: async"));
    for (const trecho of [recebe, salva]) {
      expect(trecho).toContain("_etapas: etapasParaPayload(d.etapas)");
      expect(trecho).toContain("_rev_base");
    }
  });
  it("reusa os genéricos da T7 (acordeão, recebimento por produto, grade com pathPrefix, regras de multiproduto, textos aprovados)", () => {
    const dlg = ler(DIR + "OcImpDialog.tsx");
    const item = ler(DIR + "OcImpItem.tsx");
    expect(dlg).toContain('from "@/components/shared/OcItemAcordeao"');
    expect(dlg).toContain('from "@/lib/oc-multi-itens"');
    expect(dlg).toContain("textoTirarProdutoDaOc");
    expect(dlg).toContain("textoMarcarProdutoRecebido");
    expect(item).toContain('from "@/components/oc-p-acabado/OcPaRecebimento"');
    expect(item).toContain('from "@/components/oc-p-acabado/GradeDestrinchada"');
    expect(item).toContain("pathPrefix={prefixo}");
    expect(ler(ROTA)).toContain("textoExcluirOc");
    // os duplicados do importado saíram (mesmo componente do Acabado)
    const nomes = arquivos().map((f) => f.slice(DIR.length));
    for (const velho of ["OcImpForm.tsx", "OcImpRecebimento.tsx", "GradeDestrinchada.tsx"]) expect(nomes).not.toContain(velho);
  });
  it("colaboração: mergeLinhas com removidas, mergeGrade por item, retry lê refs vivos e o status segue o servidor", () => {
    const colab = ler(DIR + "colab-itens.ts");
    expect(colab).toContain("removidasIds: o.touchedIds");
    expect(colab).toContain("mergeGradeGenerico");
    const dlg = ler(DIR + "OcImpDialog.tsx");
    expect(dlg).toContain("draftLiveRef.current");
    expect(dlg).toContain("itemsLiveRef.current");
    expect(dlg).toContain("mesclarParaRetryP0409Imp");
    expect(dlg).toContain("setStatus(r.estado.status); // status sempre o do servidor");
    // as chaves de query/canal que o Realtime e a invalidação já conhecem
    expect(dlg).toContain('canal: ocId ? `colab:oc-imp:${ocId}` : null');
    expect(dlg).toContain('tabela: "ocs_importado"');
    expect(dlg).toContain('queryKey: ["oc-importado", ocId]');
  });
  it("lista: coluna 'Produtos' (embed dos itens), valor na moeda da compra e Excluir desabilitado com produto recebido", () => {
    const rota = ler(ROTA);
    expect(rota).toContain("itens:ocs_importado_itens(id, ordem, nome_produto, status)");
    expect(rota).toContain("<TableHead>Produtos</TableHead>");
    expect(rota).toContain("fmtMoeda(o.valor_total_desconto, o.moeda_compra)");
    expect(rota).toContain("motivoNaoExcluirOc(o.itens ?? [])");
  });
  it("etapas: cotação por etapa continua com o caminho de presença de antes (data-colab-path)", () => {
    const cab = ler(DIR + "OcImpCabecalho.tsx");
    for (const p of ["etapa-rotulo:", "etapa-pct:", "etapa-venc:", "etapa-cot:", "cotacao-ref", "cotacao-final"]) expect(cab).toContain(p);
  });
});
