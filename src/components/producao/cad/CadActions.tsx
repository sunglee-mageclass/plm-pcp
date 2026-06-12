import { Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Printer, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Props = {
  onPrint: () => void;
  onSave: () => void;
  onEnviar: () => void;
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

export function CadActions({ onPrint, onSave, onEnviar, saving, enviando, enviado, dataEnviado, readOnly }: Props) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Link to="/producao/cad" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>
      <div className="flex gap-2 items-center">
        <Button variant="outline" onClick={onSave} disabled={saving || readOnly}>
          <Save className="h-4 w-4 mr-1" /> Salvar
        </Button>
        {enviado ? (
          <Badge variant="secondary" className="gap-1 px-3 py-1.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            Enviado ao Corte{dataEnviado ? ` em ${fmtDate(dataEnviado)}` : ""}
          </Badge>
        ) : (
          <>
            <Button variant="outline" onClick={onPrint}>
              <Printer className="h-4 w-4 mr-1" /> Imprimir Ficha
            </Button>
            <Button onClick={onEnviar} disabled={enviando || readOnly}>
              <Send className="h-4 w-4 mr-1" /> Enviar ao Corte
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
