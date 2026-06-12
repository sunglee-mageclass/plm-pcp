import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/configuracoes" });
  },
});
