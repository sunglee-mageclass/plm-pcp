import { Link } from "@tanstack/react-router";
import { ArrowLeft, Printer, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  onPrint: () => void;
  onSave: () => void;
  onEnviar: () => void;
  saving: boolean;
  enviando: boolean;
  enviado: boolean;
};

export function CadActions({ onPrint, onSave, onEnviar, saving, enviando, enviado }: Props) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Link to="/producao/cad" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onPrint}>
          <Printer className="h-4 w-4 mr-1" /> Imprimir Ficha
        </Button>
        <Button variant="outline" onClick={onSave} disabled={saving}>
          <Save className="h-4 w-4 mr-1" /> Salvar
        </Button>
        <Button onClick={onEnviar} disabled={enviando || enviado}>
          <Send className="h-4 w-4 mr-1" /> {enviado ? "Enviado ao corte" : "Enviar ao Corte"}
        </Button>
      </div>
    </div>
  );
}
