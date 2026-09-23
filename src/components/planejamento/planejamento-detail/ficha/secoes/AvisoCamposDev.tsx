// Aviso nas seções vindas do Desenvolvimento quando elas estão SÓ-LEITURA (F3.1): card já enviado à Explosão
// (trava da decisão F3 #1 — "Editar" no rodapé destrava) ou usuário sem permissão de editar o Dev (decisão
// F3 #8). Sem motivo, não renderiza nada.
export type MotivoTravaDev = "enviado" | "sem_permissao" | null;

export function AvisoCamposDev({ motivo }: { motivo: MotivoTravaDev }) {
  if (!motivo) return null;
  return (
    <p data-testid="aviso-campos-dev" className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
      {motivo === "enviado"
        ? "Enviado à Explosão: os campos vindos do Desenvolvimento ficam travados. Use “Editar” no rodapé para alterá-los."
        : "Somente leitura: você não tem permissão para editar o Desenvolvimento."}
    </p>
  );
}
