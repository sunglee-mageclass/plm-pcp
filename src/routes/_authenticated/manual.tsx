import { createFileRoute } from "@tanstack/react-router";
import { ManualPage } from "@/components/shared/manual/ManualPage";

// Manual de uso — UNIVERSAL: NÃO usa RequirePermission (nem exige `canView`). Qualquer usuário
// autenticado chega aqui; a própria tela trata o carregamento/erro da loja e filtra as telas
// visíveis pela PERMISSÃO do usuário (canView por pageKey) ao montar a árvore do Manual.
export const Route = createFileRoute("/_authenticated/manual")({
  component: ManualPage,
});
