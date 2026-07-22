import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/criacao/plan-tecido/$colecaoId")({
  component: () => <div className="p-6 text-sm text-muted-foreground">Planejamento de Tecido (em construção)…</div>,
});
