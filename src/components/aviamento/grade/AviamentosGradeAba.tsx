import { AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAviamentosGrade } from "./useAviamentosGrade";

export interface AviamentosGradeAbaProps {
  /** Aviamentos já filtrados pela tela (a contagem mostra só estes). Sem a prop, conta todos os da loja. */
  aviamentos?: { id: string }[];
  isMobile?: boolean;
}

/**
 * Visão "Lista" do Cadastro > Aviamentos — SHELL da AV-1 (fundação).
 * Por ora só carrega os dados da grade e mostra a contagem "N aviamentos · M variantes" (com erro honesto/"Tentar de novo");
 * a grade editável (tabela, rascunho, Salvar) entra nas próximas tarefas, espelhando `TecidosGradeAba`.
 */
export function AviamentosGradeAba({ aviamentos, isMobile }: AviamentosGradeAbaProps) {
  const dados = useAviamentosGrade();

  // Contagem do que a tela está mostrando: a lista filtrada (se vier) ou todos os aviamentos da loja.
  const ids = aviamentos ? aviamentos.map((a) => a.id) : dados.aviamentos.map((a) => a.id);
  const nAviamentos = ids.length;
  const nVariantes = ids.reduce(
    (s, id) => s + (dados.variantesPorAviamento.get(id)?.length ?? 0),
    0,
  );

  return (
    <div className="space-y-3" data-testid="aviamentos-grade-aba">
      <Card className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
        <Badge variant="secondary">{nAviamentos}</Badge>
        {nAviamentos === 1 ? "aviamento" : "aviamentos"} ·
        <Badge variant="secondary">{nVariantes}</Badge>
        {nVariantes === 1 ? "variante" : "variantes"}
      </Card>

      {dados.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span>Não foi possível carregar a lista de aviamentos.</span>
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

      {!dados.isLoading && !dados.isError && !isMobile && (
        <Card className="px-4 py-8 text-center text-sm text-muted-foreground">
          A grade editável de aviamentos (lista tipo Excel) está em construção.
        </Card>
      )}
    </div>
  );
}
