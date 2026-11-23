import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table2 } from "lucide-react";

// Tipos mínimos (espelham o que a tela de Tecidos já carrega). Ficam aqui para não
// importar da rota (evita dependência circular); as próximas tasks estendem.
export type GradeArtigo = {
  id: string;
  nome: string;
  empresa_id: string | null;
  categoria_tecido_id: string | null;
  preco: number | null;
  unidade_medida: string;
  largura_estimada: number | null;
  created_at: string;
};
export type GradeVariante = { artigo_id: string; foto_url: string | null; created_at: string };
export type GradeOpcao = { id: string; nome: string };

export interface TecidosGradeAbaProps {
  /** Tecidos já filtrados/ordenados pela tela. */
  artigos: GradeArtigo[];
  /** Variantes dos tecidos listados. */
  variantes: GradeVariante[];
  /** Fornecedores (id → nome) que a tela já carrega. */
  fornecedores?: GradeOpcao[];
  /** Categorias de tecido que a tela já carrega. */
  categorias?: GradeOpcao[];
  isMobile?: boolean;
}

/**
 * Aba "Lista tipo Excel" do Cadastro > Tecidos. SHELL da Task 1: só o encaixe
 * (placeholder + contagem). A grade editável vem nas próximas tasks.
 */
export function TecidosGradeAba({ artigos, variantes }: TecidosGradeAbaProps) {
  return (
    <Card className="p-6 space-y-3" data-testid="tecidos-grade-aba">
      <div className="flex items-center gap-2">
        <Table2 className="h-5 w-5 text-primary shrink-0" />
        <h2 className="text-base font-semibold">Lista de tecidos (em construção)</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Aqui ficará a lista tipo Excel, com os tecidos e as cores em linhas editáveis. Por enquanto,
        use a visão Cards.
      </p>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="secondary">{artigos.length}</Badge>
        {artigos.length === 1 ? "tecido" : "tecidos"} ·
        <Badge variant="secondary">{variantes.length}</Badge>
        {variantes.length === 1 ? "variante" : "variantes"}
      </div>
    </Card>
  );
}
