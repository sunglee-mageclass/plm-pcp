// Integração — fotos do produto (a MESMA lista do card: modelos.fotos_modelo). Trocar/adicionar/remover mexe SÓ no rascunho;
// as fotos novas sobem no Salvar da página (salvar-integracao.ts). Ordem = a do card (Foto 1..N).
import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSignedUrlBucket } from "@/components/planejamento/modelo-shared";
import type { ProdutoLista } from "@/lib/integracao/produtos";
import { PREFIXO_FOTO_NOVA, adicionarFotos, removerFoto, type FotoNova, type Rascunho } from "@/lib/integracao/rascunho";

function Miniatura({ item, fotosNovas }: { item: string; fotosNovas: FotoNova[] }) {
  const nova = item.startsWith(PREFIXO_FOTO_NOVA) ? fotosNovas.find((n) => PREFIXO_FOTO_NOVA + n.id === item) : undefined;
  const assinada = useSignedUrlBucket(nova ? null : item);
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    if (!nova) return;
    const u = URL.createObjectURL(nova.file);
    setLocal(u);
    return () => URL.revokeObjectURL(u);
  }, [nova]);
  const src = nova ? local : assinada;
  return src
    ? <img src={src} alt="" className="h-24 w-24 rounded-md border object-cover" />
    : <div className="h-24 w-24 rounded-md border bg-muted" />;
}

export function FotosDialog({ produto, rascunho, onAtualizar, onFechar }: {
  produto: ProdutoLista; rascunho: Rascunho; onAtualizar: (f: (r: Rascunho) => Rascunho) => void; onFechar: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const itens = rascunho.valores.fotos_modelo;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Fotos — {produto.raw.nome}</DialogTitle>
          <DialogDescription>As mesmas fotos do card do produto. As novas só sobem quando você clicar em Salvar na página.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-3">
          {itens.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma foto.</p>}
          {itens.map((item, i) => (
            <div key={item} className="relative">
              <Miniatura item={item} fotosNovas={rascunho.fotosNovas} />
              <span className="absolute left-1 top-1 rounded bg-background/90 px-1 text-xs tabular-nums">Foto {i + 1}</span>
              <Button type="button" variant="outline" size="iconSm" className="absolute -right-2 -top-2 bg-background max-sm:h-11 max-sm:w-11"
                aria-label={`Remover foto ${i + 1}`} onClick={() => onAtualizar((r) => removerFoto(r, item))}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <input ref={input} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => {
            const arquivos = Array.from(e.target.files ?? []);
            e.target.value = "";
            onAtualizar((r) => adicionarFotos(r, arquivos.map((file) => ({ id: crypto.randomUUID(), file }))));
          }} />
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => input.current?.click()}>
            <ImagePlus className="h-4 w-4" />Adicionar fotos
          </Button>
          <Button type="button" onClick={onFechar}>Concluído</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
