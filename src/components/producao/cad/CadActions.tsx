import { Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Printer, RotateCcw, Save, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Props = {
  onPrint: () => void;
  onSave: () => void;
  onEnviar: () => void;
  onDesmarcar?: () => void;
  onExcluir?: () => void;
  saving: boolean;
  enviando: boolean;
  enviado: boolean;
  dataEnviado?: string | null;
  readOnly?: boolean;
};

function fmtDate(d?: string | null) {
  if (!d) return "";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
}

export function CadActions({ onPrint, onSave, onEnviar, onDesmarcar, onExcluir, saving, enviando, enviado, dataEnviado, readOnly }: Props) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Link to="/producao/cad" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        {onExcluir && !readOnly && (
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onExcluir}>
            <Trash2 className="h-4 w-4 mr-1" /> Excluir CAD
          </Button>
        )}
      </div>
      <div className="flex gap-2 items-center">
        <Button variant="outline" onClick={onSave} disabled={saving || readOnly}>
          <Save className="h-4 w-4 mr-1" /> Salvar
        </Button>
        {enviado ? (
          <>
            <Badge variant="secondary" className="gap-1 px-3 py-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              CAD Confirmado{dataEnviado ? ` em ${fmtDate(dataEnviado)}` : ""}
            </Badge>
            <Button variant="outline" onClick={onPrint}>
              <Printer className="h-4 w-4 mr-1" /> Imprimir Ficha
            </Button>
            {onDesmarcar && !readOnly && (
              <Button variant="ghost" className="text-muted-foreground" onClick={onDesmarcar}>
                <RotateCcw className="h-4 w-4 mr-1" /> Desmarcar envio
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="outline" onClick={onPrint}>
              <Printer className="h-4 w-4 mr-1" /> Imprimir Ficha
            </Button>
            <Button onClick={() => { onPrint(); onEnviar(); }} disabled={enviando || readOnly}>
              <Send className="h-4 w-4 mr-1" /> Imprimir e Enviar
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
