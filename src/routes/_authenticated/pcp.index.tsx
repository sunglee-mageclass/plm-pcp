import { createFileRoute, redirect } from "@tanstack/react-router";

// PCP é um nível de página única (= Serviços): /pcp abre direto o Serviços em /pcp/servicos.
export const Route = createFileRoute("/_authenticated/pcp/")({
  beforeLoad: () => {
    throw redirect({ to: "/pcp/servicos" });
  },
});
