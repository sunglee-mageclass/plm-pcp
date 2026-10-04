import { Link } from "@tanstack/react-router";
import { Blocks } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { EmptyState } from "@/components/shared/EmptyState";
import { modulosComArtigo } from "@/lib/modulos-texto";

/**
 * [modularidade F1/F2] Empty-state ÚNICO de "esta área precisa de um módulo que a loja não tem" — usado pela guarda de
 * `PageDef.gate` do `RequirePermission` (rota guardada, sem redirecionar) e pelos avisos de OTB nas telas de PA/PI.
 * `modulos` = os que FALTAM na loja; `exige` (opcional) = tudo o que a área precisa (quando é mais que o que falta, o texto
 * diz os dois: "precisa dos módulos Criação e Entrada e Saída; falta ligar o módulo Criação").
 * Só o super admin liga módulo (P-251 C), então só ele vê o atalho para Gerenciar Lojas.
 */
export function ModuloDesligadoAviso({ modulos, exige }: { modulos: string[]; exige?: string[] }) {
  const { isSuperAdmin } = useAuth();
  const plural = modulos.length > 1;
  const precisa = exige && exige.length > modulos.length;
  const description = precisa
    ? `Esta área precisa ${modulosComArtigo(exige, "do")}; falta ligar ${modulosComArtigo(modulos, "o")} nesta loja. Peça ao administrador do sistema para ligar.`
    : `Esta área precisa ${modulosComArtigo(modulos, "do")}, que ${plural ? "não estão ligados" : "não está ligado"} nesta loja. Peça ao administrador do sistema para ligar ${plural ? "os módulos" : "o módulo"}.`;
  return (
    <div className="container mx-auto flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6">
      <EmptyState icon={Blocks} title="Módulo desligado nesta loja" description={description} className="max-w-lg" />
      {isSuperAdmin && (
        <Link to="/admin/lojas" className="text-sm underline underline-offset-2">
          Gerenciar Lojas
        </Link>
      )}
    </div>
  );
}
