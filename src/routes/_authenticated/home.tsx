import { createFileRoute } from "@tanstack/react-router";
import { HomeLogado } from "@/components/home/HomeLogado";

export const Route = createFileRoute("/_authenticated/home")({
  component: HomeLogado,
});
