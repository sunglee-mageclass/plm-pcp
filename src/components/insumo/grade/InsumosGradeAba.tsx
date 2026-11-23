import { useEffect, useMemo } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { montarLinhas } from "@/lib/insumo-grade/linhas";
import { useInsumosGrade } from "./useInsumosGrade";

export interface InsumosGradeAbaProps {
  /** Insumos já filtrados pela tela (a grade mostra só estes, na mesma ordem). Sem a prop, mostra todos os da loja. */
  etiquetas?: { id: string }[];
  isMobile?: boolean;
  /**
   * Avisa a tela-mãe quando há rascunho não salvo (a tela pede confirmação ANTES de trocar de visão/filtro/busca — senão a grade
   * desmonta e o rascunho se perde calado). Nesta fundação (IN-1) ainda não há edição: avisa `false`. A grade editável vem na IN-2.
   */
  onDirtyChange?: (sujo: boolean) => void;
}

/**
 * Aba "Lista tipo Excel" do Cadastro > Insumos. IN-1 = FUNDAÇÃO: carrega os dados da grade (insumos, cores com tamanhos e opções),
 * monta as linhas (1 por COR) e mostra um placeholder com a contagem — a tabela editável, o Salvar, criar/colar/excluir vêm nas
 * IN-2/IN-3. Erro de leitura é honesto: aviso + "Tentar de novo", nunca "0 insumos".
 */
export function InsumosGradeAba({ etiquetas, isMobile, onDirtyChange }: InsumosGradeAbaProps) {
  const dados = useInsumosGrade();

  // Sem rascunho nesta fundação: a tela-mãe sabe que trocar de visão/filtro não perde nada.
  useEffect(() => {
    onDirtyChange?.(false);
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  const visiveis = useMemo(() => {
    if (!etiquetas) return dados.etiquetas;
    const ids = new Set(etiquetas.map((e) => e.id));
    return dados.etiquetas.filter((e) => ids.has(e.id));
  }, [dados.etiquetas, etiquetas]);

  const linhas = useMemo(
    () => montarLinhas(visiveis, dados.blocosPorEtiqueta),
    [visiveis, dados.blocosPorEtiqueta],
  );
  const nInsumos = visiveis.length;
  const nCores = useMemo(() => linhas.filter((l) => l.bloco).length, [linhas]);

  return (
    <div className="space-y-3" data-testid="insumos-grade-aba">
      {/* Contagem só com dado confiável: carregando ou com erro, "0 insumos" seria mentira (C3). */}
      {!dados.isLoading && !dados.isError && (
        <Card className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
          <Badge variant="secondary">{nInsumos}</Badge>
          {nInsumos === 1 ? "insumo" : "insumos"} ·<Badge variant="secondary">{nCores}</Badge>
          {nCores === 1 ? "cor" : "cores"}
        </Card>
      )}

      {dados.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span>Não foi possível carregar a lista de insumos.</span>
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
          data-testid="insumos-grade-placeholder"
        >
          A lista tipo Excel de Insumos está em construção.
        </div>
      )}
    </div>
  );
}
