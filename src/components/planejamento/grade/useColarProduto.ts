// Colar do Excel (TSV) na grade "Lista" do Planejamento de Produto (PR-3): a parte de TELA. A regra (quem pode, lookups, motivos) é
// `lib/produto-grade/colar-tsv.ts` (pura). Aqui: o registro dos rascunhos das linhas (cada linha é dona do seu `useCardDraft`), o
// `onPaste` da tabela, os avisos por célula e o toast. NADA grava: aplicar = `patch` no rascunho da linha; o Salvar é o da Aba.
// Produto NÃO cria: o bloco só EDITA os modelos que já estão na lista (linhas além do fim = ignoradas com aviso).
import { useCallback, useRef, useState, type ClipboardEvent } from "react";
import { toast } from "sonner";
import type { EstadoModeloIntegracao } from "@/lib/integracao/trava";
import type { ColunaProduto } from "@/lib/produto-grade/colunas";
import type { LinhaProduto } from "@/lib/produto-grade/linhas";
import { produtoParaDraft, type ProdutoDraft } from "@/lib/produto-grade/salvar";
import {
  ehBlocoColavel,
  mapearColagemProduto,
  parseBlocoTsv,
  resumoColagemProduto,
} from "@/lib/produto-grade/colar-tsv";
import type { GradeOpcoesProduto } from "./useProdutosGrade";

/** O que cada linha expõe à colagem: ler o rascunho vivo e aplicar campos nele (por `patch`). */
export type SaverProduto = {
  ler: () => ProdutoDraft;
  aplicar: (campos: Partial<ProdutoDraft>) => void;
};

export type ColarProdutoApi = {
  /** A linha registra/desregistra o seu rascunho (estável). */
  registrar: (modeloId: string, api: SaverProduto | null) => void;
  /** Avisos da última colagem por célula (`<modeloId>|<colKey>`): texto que NÃO foi aplicado. */
  avisos: Record<string, string>;
  limparAviso: (modeloId: string, colKey: string) => void;
  limparAvisosDaLinha: (modeloId: string) => void;
  /** `onPaste` do container da tabela. */
  onPaste: (e: ClipboardEvent<HTMLElement>) => void;
};

export function useColarProduto(o: {
  linhas: readonly LinhaProduto[];
  colunas: readonly ColunaProduto[];
  opcoes: GradeOpcoesProduto;
  otbOn: boolean;
  readOnly: boolean;
  integracaoPronta: boolean;
  estadosIntegracao: Record<string, EstadoModeloIntegracao>;
  canEdit: (chave: string) => boolean;
}): ColarProdutoApi {
  const saversRef = useRef(new Map<string, SaverProduto>());
  const registrar = useCallback((id: string, api: SaverProduto | null) => {
    if (api) saversRef.current.set(id, api);
    else saversRef.current.delete(id);
  }, []);

  const [avisos, setAvisos] = useState<Record<string, string>>({});
  const limparAviso = useCallback((id: string, colKey: string) => {
    const k = `${id}|${colKey}`;
    setAvisos((a) => {
      if (!(k in a)) return a;
      const { [k]: _fora, ...resto } = a;
      void _fora;
      return resto;
    });
  }, []);
  const limparAvisosDaLinha = useCallback((id: string) => {
    setAvisos((a) => {
      const p = `${id}|`;
      if (!Object.keys(a).some((k) => k.startsWith(p))) return a;
      return Object.fromEntries(Object.entries(a).filter(([k]) => !k.startsWith(p)));
    });
  }, []);

  // Tudo o que o colar lê vem do render MAIS NOVO (ref): o `onPaste` nunca usa permissão/estado velhos.
  const entradaRef = useRef(o);
  entradaRef.current = o;

  const aoColar = useCallback((a: { modeloId: string; colKey: string; texto: string }): boolean => {
    const bloco = parseBlocoTsv(a.texto);
    if (!ehBlocoColavel(a.texto, bloco)) return false;
    const e = entradaRef.current;
    const linhaIdx = e.linhas.findIndex((l) => l.modeloId === a.modeloId);
    const colIdx = e.colunas.findIndex((c) => c.key === a.colKey);
    if (linhaIdx < 0 || colIdx < 0) return false;
    const savers = saversRef.current;
    const res = mapearColagemProduto({ linhaIdx, colIdx }, bloco, {
      linhas: e.linhas,
      colunas: e.colunas,
      opcoes: e.opcoes,
      otbOn: e.otbOn,
      readOnly: e.readOnly,
      integracaoPronta: e.integracaoPronta,
      canEdit: e.canEdit,
      estadoDe: (id) => e.estadosIntegracao[id] ?? null,
      // linha sem rascunho registrado (não deveria): cai no valor SALVO do modelo
      valorDe: (id) =>
        savers.get(id)?.ler() ?? produtoParaDraft(e.linhas.find((l) => l.modeloId === id)!.modelo),
    });
    for (const p of res.patches) savers.get(p.modeloId)?.aplicar(p.campos);
    setAvisos((antes) => {
      const prox = { ...antes };
      for (const k of res.aplicadas) delete prox[k];
      return { ...prox, ...res.avisos };
    });
    const resumo = resumoColagemProduto(res);
    const opcoesToast = resumo.detalhe ? { description: resumo.detalhe } : undefined;
    if (resumo.tom === "sucesso") toast.success(resumo.texto, opcoesToast);
    else toast.warning(resumo.texto, opcoesToast);
    return true;
  }, []);

  // Ctrl+V de um BLOCO (TAB/várias linhas) com o foco numa célula da LINHA DO PRODUTO: a célula é a âncora. O evento sobe do campo até
  // aqui; valor simples segue o colar normal do próprio campo. Colar dentro da matriz de tamanhos (outra <tr>) não passa por aqui.
  const onPaste = useCallback(
    (e: ClipboardEvent<HTMLElement>) => {
      if (entradaRef.current.readOnly) return;
      const alvo = e.target as HTMLElement | null;
      const td = alvo?.closest?.("td[data-col]") as HTMLElement | null;
      const tr = td?.closest("tr[data-modelo-id]") as HTMLElement | null;
      if (!td || !tr) return;
      const texto = e.clipboardData?.getData("text/plain") ?? "";
      if (!/[\t\r\n"]/.test(texto)) return;
      if (aoColar({ modeloId: tr.dataset.modeloId ?? "", colKey: td.dataset.col ?? "", texto }))
        e.preventDefault();
    },
    [aoColar],
  );

  return { registrar, avisos, limparAviso, limparAvisosDaLinha, onPaste };
}
