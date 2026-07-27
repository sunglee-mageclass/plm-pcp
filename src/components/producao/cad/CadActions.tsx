import { Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Pencil, Printer, RotateCcw, Save, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Props = {
  onPrint: () => void;
  onSave: () => void;
  onEnviar: () => void;
  onDesmarcar?: () => void;
  onExcluir?: () => void;
  onEditar?: () => void;
  saving: boolean;
  enviando: boolean;
  enviado: boolean;
  /** Em modo edição (após clicar Editar num CAD já enviado). */
  editing?: boolean;
  dataEnviado?: string | null;
  readOnly?: boolean;
  /** Quando embutido num Sheet/modal, fecha-o (em vez de navegar pra lista). */
  onBack?: () => void;
};

function fmtDate(d?: string | null) {
  if (!d) return "";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
}

export function CadActions({ onPrint, onSave, onEnviar, onDesmarcar, onExcluir, onEditar, saving, enviando, enviado, editing, dataEnviado, readOnly, onBack }: Props) {
  // Travado: já enviado ao corte e fora do modo edição. Só destrava no "Editar".
  const locked = enviado && !editing;
  const backClass = "max-sm:hidden text-sm text-muted-foreground hover:underline flex items-center gap-1";
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {onBack ? (
          <button type="button" onClick={onBack} className={backClass}>
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
        ) : (
          <Link to="/entrada-saida/explosao" className={backClass}>
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Link>
        )}
        {onExcluir && !readOnly && !enviado && (
          <Button variant="ghost" size="sm" className="max-sm:hidden text-destructive hover:text-destructive" onClick={onExcluir}>
            <Trash2 className="h-4 w-4 mr-1" /> Excluir
          </Button>
        )}
      </div>
      <div className="flex gap-2 items-center max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-40 max-sm:justify-end max-sm:border-t max-sm:bg-background max-sm:p-3 max-sm:shadow-lg">
        <div className="sm:hidden flex items-center gap-2 mr-auto">
          {onBack ? (
            <Button type="button" variant="outline" size="icon" onClick={onBack} aria-label="Voltar">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : (
            <Button asChild variant="outline" size="icon" aria-label="Voltar">
              <Link to="/entrada-saida/explosao"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
          )}
          {onExcluir && !readOnly && !enviado && (
            <Button variant="destructive" size="icon" onClick={onExcluir} aria-label="Excluir">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        {enviado && (
          <Badge variant="secondary" className="gap-1 px-3 py-1.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            CAD Confirmado{dataEnviado ? ` em ${fmtDate(dataEnviado)}` : ""}
          </Badge>
        )}
        <Button variant="outline" className="hidden lg:inline-flex" onClick={onPrint}>
          <Printer className="h-4 w-4 mr-1" /> Imprimir Ficha
        </Button>

        {!enviado && (
          <>
            <Button variant="outline" onClick={onSave} disabled={saving || readOnly}>
              <Save className="h-4 w-4 mr-1" /> Salvar
            </Button>
            <Button className="lg:hidden" onClick={onEnviar} disabled={enviando || readOnly}>
              <Send className="h-4 w-4 mr-1" /> Enviar
            </Button>
            <Button className="hidden lg:inline-flex" onClick={() => { onPrint(); onEnviar(); }} disabled={enviando || readOnly}>
              <Send className="h-4 w-4 mr-1" /> Imprimir e Enviar
            </Button>
          </>
        )}

        {locked && (
          <Button variant="outline" size="icon" onClick={onEditar} disabled={readOnly} aria-label="Editar">
            <Pencil className="h-4 w-4" />
          </Button>
        )}

        {enviado && editing && (
          <Button onClick={onSave} disabled={saving || readOnly}>
            <Save className="h-4 w-4 mr-1" /> Salvar
          </Button>
        )}

        {enviado && onDesmarcar && !readOnly && (
          <Button variant="ghost" className="text-muted-foreground" onClick={onDesmarcar}>
            <RotateCcw className="h-4 w-4 mr-1" /> Desmarcar envio
          </Button>
        )}
      </div>
    </div>
  );
}
