import { Link } from "@tanstack/react-router";
import { Blocks } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { modulosComArtigo } from "@/lib/modulos-texto";

/**
 * [modularidade F1] Empty-state ÚNICO de "esta área faz parte de um módulo que a loja não tem" — usado pela guarda de
 * `PageDef.gate` do `RequirePermission` (rota guardada, sem redirecionar) no lugar dos 4 avisos "Ative em Config da Loja".
 * Só o super admin liga módulo (P-251 C), então só ele vê o atalho para Gerenciar Lojas.
 */
export function ModuloDesligadoAviso({ modulos }: { modulos: string[] }) {
  const { isSuperAdmin } = useAuth();
  const plural = modulos.length > 1;
  return (
    <div className="container mx-auto flex min-h-[50vh] flex-col items-center justify-center gap-2 p-6 text-center">
      <Blocks className="h-10 w-10 text-muted-foreground" />
      <h1 className="text-xl font-semibold">Módulo desligado nesta loja</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Esta área faz parte {modulosComArtigo(modulos, "do")}, que {plural ? "não estão ligados" : "não está ligado"} nesta loja.
        Peça ao administrador do sistema para ligar {plural ? "os módulos" : "o módulo"}.
      </p>
      {isSuperAdmin && (
        <Link to="/admin/lojas" className="text-sm underline underline-offset-2">
          Gerenciar Lojas
        </Link>
      )}
    </div>
  );
}
