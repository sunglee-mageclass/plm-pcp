import { Button } from "@/components/ui/button";
import { Check, Undo2 } from "lucide-react";

// Selo âmbar inline compacto (o `UnsavedIndicator` de `@/components/shared/UnsavedIndicator` é a pílula do header
// da página; no card cabe só o texto curto, como no mockup aprovado).
export function CardSaveControls({ dirty, salvando, onSalvar, onDescartar }: {
  dirty: boolean; salvando: boolean; onSalvar: () => void; onDescartar: () => void;
}) {
  if (!dirty) return null;
  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <span className="text-xs text-amber-600 dark:text-amber-400">não salvo</span>
      <Button size="iconSm" variant="ghost" className="max-sm:h-11 max-sm:w-11" aria-label="Salvar esta cor"
        disabled={salvando} onClick={onSalvar}><Check className="h-4 w-4" /></Button>
      <Button size="iconSm" variant="ghost" className="max-sm:h-11 max-sm:w-11" aria-label="Desfazer esta cor"
        disabled={salvando} onClick={onDescartar}><Undo2 className="h-4 w-4" /></Button>
    </div>
  );
}
