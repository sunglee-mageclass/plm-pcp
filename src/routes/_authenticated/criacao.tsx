import { createFileRoute } from "@tanstack/react-router";
import { Palette } from "lucide-react";
import { ModulePage } from "@/components/module-page";

export const Route = createFileRoute("/_authenticated/criacao")({
  component: () => (
    <ModulePage
      icon={Palette}
      title="Criação"
      description="Desenvolvimento de coleções, fichas técnicas e moodboards."
      subPages={["Coleções", "Modelos", "Fichas técnicas", "Moodboards", "Tendências"]}
    />
  ),
});
