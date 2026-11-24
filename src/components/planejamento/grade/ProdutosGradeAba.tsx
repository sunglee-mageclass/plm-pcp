import { useEffect, useMemo } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { colunasVisiveis } from "@/lib/produto-grade/colunas";
import { montarLinhas, modelosNaOrdemDaTela } from "@/lib/produto-grade/linhas";
import { useProdutosGrade } from "./useProdutosGrade";

export interface ProdutosGradeAbaProps {
  /**
   * Produtos já filtrados E ORDENADOS pela tela (a grade mostra só estes, NA MESMA ORDEM — a do filtro/ordenação do Planejamento).
   * Sem a prop, mostra todos os da loja, na ordem da consulta.
   */
  modelos?: { id: string }[];
  isMobile?: boolean;
  /**
   * Avisa a tela-mãe quando há rascunho não salvo (a tela pede confirmação ANTES de trocar de visão/busca — senão a grade desmonta e o
   * rascunho se perde calado). Nesta fundação (PR-1) ainda não há edição: avisa `false`. A grade editável vem na PR-2.
   */
  onDirtyChange?: (sujo: boolean) => void;
}

/**
 * Aba "Lista tipo Excel" do Planejamento de Produto. PR-1 = FUNDAÇÃO: carrega os dados da grade (modelos com `rev`, opções, estado da
 * Integração), monta as linhas (1 por MODELO) e mostra um placeholder com a contagem — a tabela editável, o Salvar com CAS por `rev`,
 * a trava da Integração na célula etc. vêm na PR-2. Erro de leitura é honesto: aviso + "Tentar de novo", nunca "0 produtos".
 */
export function ProdutosGradeAba({ modelos, isMobile, onDirtyChange }: ProdutosGradeAbaProps) {
  const dados = useProdutosGrade();

  // Sem rascunho nesta fundação: a tela-mãe sabe que trocar de visão/busca não perde nada.
  useEffect(() => {
    onDirtyChange?.(false);
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  // Segue a ORDEM da tela (`modelos` já vem filtrado/ordenado); produto que a consulta da grade ainda não trouxe fica de fora.
  const visiveis = useMemo(
    () => (modelos ? modelosNaOrdemDaTela(dados.modelos, modelos) : dados.modelos),
    [dados.modelos, modelos],
  );

  const linhas = useMemo(() => montarLinhas(visiveis), [visiveis]);
  const colunas = useMemo(
    () => colunasVisiveis(dados.canView, dados.canEdit),
    [dados.canView, dados.canEdit],
  );
  const nProdutos = linhas.length;

  return (
    <div className="space-y-3" data-testid="produtos-grade-aba">
      {/* Contagem só com dado confiável: carregando ou com erro, "0 produtos" seria mentira (C3). */}
      {!dados.isLoading && !dados.isError && (
        <Card className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
          <Badge variant="secondary">{nProdutos}</Badge>
          {nProdutos === 1 ? "produto" : "produtos"}
        </Card>
      )}

      {dados.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span>Não foi possível carregar a lista de produtos.</span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={dados.recarregando}
            onClick={() => void dados.recarregar()}
          >
            {dados.recarregando ? "Tentando…" : "Tentar de novo"}
          </Button>
        </div>
      )}

      {dados.isLoading && (
        <div className="py-12 text-center text-muted-foreground">
          <Loader2 className="mr-2 inline h-5 w-5 animate-spin" />
          Carregando…
        </div>
      )}

      {!isMobile && !dados.isLoading && !dados.isError && (
        <div
          className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
          data-testid="produtos-grade-placeholder"
          data-colunas={colunas.length}
        >
          A lista tipo Excel de Produtos está em construção.
        </div>
      )}
    </div>
  );
}
