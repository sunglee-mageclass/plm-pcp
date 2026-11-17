// Botão de AJUDA CONTEXTUAL "?" (A5) — colocado no cabeçalho de uma tela, abre o Manual JÁ na
// seção daquela tela (ou de um campo específico). Pequeno e SEM dependência de dados: a própria
// tela do Manual filtra por loja + permissão; se o usuário não vê a tela no Manual, cai no topo.
//
// Navegação por HASH (TanStack Router): `to: "/manual"` + `hash: "secao-<secao>"` quando `secao`
// é dado, senão `hash: "manual-<pageKey>"`. A `ManualPage` lê o hash no mount, pré-seleciona a
// tela certa e rola até a âncora (ver `ManualPage.tsx` → `telaDoHash`/efeito de hash).
import { HelpCircle } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AjudaContextualProps = {
  /** Tela do Manual a abrir (chave da página = `PageDef.key`, ex.: "criacao_planejamento"). */
  pageKey: string;
  /** Seção específica dentro da tela (= `sectionKey`). Com ela, abre direto na âncora da seção. */
  secao?: string;
  /** Campo específico — reservado p/ futuro (hoje a âncora mais fina é a seção); não altera a navegação. */
  campo?: string;
  /** Rótulo/acessibilidade do botão. Default: "Ajuda desta tela". */
  titulo?: string;
  className?: string;
};

export function AjudaContextual({ pageKey, secao, titulo, className }: AjudaContextualProps) {
  const navigate = useNavigate();
  const rotulo = titulo ?? "Ajuda desta tela";

  // Hash SEM o "#": o TanStack Router o adiciona. Seção tem prioridade (âncora mais fina).
  // pageKey ausente/inexistente no Manual → cai no topo do Manual (a tela decide).
  const hash = secao ? `secao-${secao}` : `manual-${pageKey}`;

  return (
    <Button
      type="button"
      variant="ghost"
      size="iconSm"
      // Alvo ≥44px no mobile (§Q) sem inflar o visual no desktop: área de toque maior via min-h/min-w.
      className={cn("shrink-0 text-muted-foreground hover:text-foreground max-sm:min-h-[44px] max-sm:min-w-[44px]", className)}
      aria-label={rotulo}
      title={rotulo}
      onClick={() => navigate({ to: "/manual", hash })}
    >
      <HelpCircle className="h-4 w-4" aria-hidden />
    </Button>
  );
}
