// Match visual da foto: "esta foto pertence a este produto?".
// Mostra o produto (nome) × a miniatura da foto que casou por nome, com toggle
// confirmar / remover. Fotos sem dono (órfãs) e produtos sem foto aparecem como aviso.
//
// As imagens são Files locais (ainda não subidas) — a miniatura usa URL.createObjectURL,
// revogada no unmount. Nada sobe até o Confirmar da importação.

import { useEffect, useMemo, useState } from "react";
import { Check, ImageOff, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { casarFotos, type FotoParse, type AlvoFoto } from "@/lib/import/foto-match";

type Props = {
  alvos: AlvoFoto[]; // 1 por produto (modo entidade) OU 1 por cor (modo variante — tecido)
  arquivos: File[];
  // devolve o mapa chaveDoAlvo→File confirmado (a foto de cada alvo).
  onChange: (confirmadas: Map<string, File>) => void;
};

export function MatchVisualFoto({ alvos, arquivos, onChange }: Props) {
  // casa por nome (parse puro) — File por nome de arquivo p/ recuperar o objeto.
  const fileByName = useMemo(() => {
    const m = new Map<string, File>();
    for (const f of arquivos) m.set(f.name, f);
    return m;
  }, [arquivos]);

  const { matches, orfas } = useMemo(
    () => casarFotos(alvos.map((a) => ({ chave: a.chave, rotulo: a.rotulo })), arquivos.map((f) => f.name)),
    [alvos, arquivos],
  );

  // estado de confirmação por produto (default: confirmado quando casou).
  const [confirmado, setConfirmado] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const init: Record<string, boolean> = {};
    for (const m of matches) if (m.principal) init[m.chave] = true;
    setConfirmado(init);
  }, [matches]);

  // recalcula o mapa confirmado e emite p/ o pai.
  useEffect(() => {
    const out = new Map<string, File>();
    for (const m of matches) {
      if (!m.principal || !confirmado[m.chave]) continue;
      const file = fileByName.get(m.principal.arquivo);
      if (file) out.set(m.chave, file);
    }
    onChange(out);
    // onChange é estável no uso (useCallback no pai); dependemos de matches/confirmado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, confirmado, fileByName]);

  const semFoto = matches.filter((m) => !m.principal);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant="secondary">{matches.filter((m) => m.principal).length} com foto</Badge>
        {semFoto.length > 0 && <Badge variant="outline">{semFoto.length} sem foto</Badge>}
        {orfas.length > 0 && <Badge variant="outline" className="text-amber-600 border-amber-300">{orfas.length} foto(s) sem dono</Badge>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {matches.filter((m) => m.principal).map((m) => {
          const file = m.principal ? fileByName.get(m.principal.arquivo) : undefined;
          return (
            <Card key={m.chave} className="p-3 flex gap-3 items-center">
              <Thumb file={file} />
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{m.nomeProduto}</p>
                <p className="text-xs text-muted-foreground truncate">{m.principal?.arquivo}</p>
                {m.fotos.length > 1 && (
                  <p className="text-[11px] text-muted-foreground">+{m.fotos.length - 1} foto(s) extra</p>
                )}
              </div>
              <Button
                size="iconSm"
                variant={confirmado[m.chave] ? "default" : "outline"}
                aria-label={confirmado[m.chave] ? "Foto confirmada" : "Confirmar foto"}
                onClick={() => setConfirmado((s) => ({ ...s, [m.chave]: !s[m.chave] }))}
              >
                {confirmado[m.chave] ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
              </Button>
            </Card>
          );
        })}
      </div>

      {orfas.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm">
          <p className="font-medium text-amber-800 dark:text-amber-300 mb-1">Fotos que não casaram com nenhum item:</p>
          <ul className="list-disc pl-5 text-amber-700 dark:text-amber-400">
            {orfas.map((o: FotoParse) => (
              <li key={o.arquivo} className="truncate">{o.arquivo}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Thumb({ file }: { file: File | undefined }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  if (!url) {
    return (
      <div className="h-14 w-14 shrink-0 rounded bg-muted grid place-items-center">
        <ImageOff className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }
  return <img src={url} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />;
}
