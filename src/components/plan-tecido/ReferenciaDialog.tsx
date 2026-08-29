// Botão + Dialog de "Referências" do card do Plan. Tecido (G4, ago/2026). INTEROPERA com a
// "Foto de Referência" do Planejamento de Produto/Dev: MESMA coluna `modelos.fotos_referencia`,
// MESMO storage (bucket "modelos", `uploadFile`), MESMO helper de leitura (`useSignedUrl`).
//
// Card COM modelo (`slot.modelo_id`): grava DIRETO no modelo via RPC `plan_tecido_set_referencia`
// (não suja o plano — é escrita imediata, igual "Aplicar ao modelo"). Card SEM modelo (rascunho):
// as referências vivem em `slot.referencia_paths`, editadas via `onChange` (funil `patch()` do
// Sheet — entra no dirty/touched, persiste só ao Salvar o plano).
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Paperclip, Loader2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { uploadFile, BUCKET } from "@/components/planejamento/modelo-shared";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { AnexoThumbZoom } from "@/components/shared/ImagePreview";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PtSlot } from "@/lib/plan-tecido/types";

/* Miniatura de 1 referência (path do bucket "modelos") — mesmo padrão do PhotoList do Dev. */
function RefThumb({ path, onRemove }: { path: string; onRemove: () => void }) {
  const isPdf = /\.pdf$/i.test(path);
  const url = useSignedUrl(path, BUCKET);
  return <AnexoThumbZoom url={url} isPdf={isPdf} onRemove={onRemove} />;
}

export function ReferenciaDialog({ slot, onChange }: {
  slot: PtSlot;
  onChange: (s: PtSlot) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [paths, setPaths] = useState<string[]>(slot.referencia_paths ?? []);
  const [busy, setBusy] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const temModelo = !!slot.modelo_id;

  // Ressincroniza o rascunho local do Dialog toda vez que abre (evita mostrar um estado velho
  // se o slot mudou por fora — ex.: colab merge — enquanto o Dialog estava fechado).
  useEffect(() => {
    if (open) setPaths(slot.referencia_paths ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const contagem = slot.referencia_paths?.length ?? 0;

  async function handleAdd(file: File) {
    setBusy(true);
    try {
      const path = await uploadFile(file, "fotos_referencia");
      setPaths((prev) => [...prev, path]);
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível enviar a foto."));
    } finally {
      setBusy(false);
    }
  }

  function handleRemove(i: number) {
    setPaths((prev) => prev.filter((_, j) => j !== i));
  }

  // Card SEM modelo: as referências são dado PRÓPRIO do slot — via onChange/patch (dirty,
  // persiste só ao Salvar o plano). NUNCA setArvore cru (funil do patch() no Sheet).
  function salvarNoRascunho() {
    onChange({ ...slot, referencia_paths: paths });
    setOpen(false);
    toast.success("Referências atualizadas — salve o plano para gravar.");
  }

  // Card COM modelo: grava DIRETO em modelos.fotos_referencia (mesma coluna do Planejamento/Dev)
  // — não suja o plano; é escrita imediata igual "Aplicar ao modelo".
  async function salvarNoModelo() {
    if (!slot.modelo_id) return;
    setSalvando(true);
    try {
      const { error } = await supabase.rpc("plan_tecido_set_referencia" as any, {
        _modelo_id: slot.modelo_id, _paths: paths,
      });
      if (error) throw error;
      void qc.invalidateQueries({ queryKey: ["plan-tecido-modelos"] });
      void qc.invalidateQueries({ queryKey: ["modelo-detail", slot.modelo_id] });
      toast.success("Referências atualizadas no modelo.");
      setOpen(false);
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível salvar as referências."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1 px-2 text-[11px]"
        title="Referências (foto de referência do modelo)"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        <Paperclip className="h-3 w-3" />
        {contagem > 0 && <span className="tabular-nums">{contagem}</span>}
      </Button>

      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="max-w-lg" onClick={(e) => e.stopPropagation()}>
            <DialogHeader>
              <DialogTitle>Referências</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground -mt-2">
              {temModelo
                ? "Mesma foto de referência do card no Planejamento de Produto — anexar aqui reflete lá (e vice-versa)."
                : "Card ainda sem modelo (rascunho) — as referências ficam salvas no plano até o card ser criado."}
            </p>
            <div className="flex flex-wrap items-center gap-2 py-2">
              {paths.map((p, i) => (
                <RefThumb key={p} path={p} onRemove={() => handleRemove(i)} />
              ))}
              <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent w-fit">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Adicionar
                <input
                  type="file"
                  accept="image/*,application/pdf,.jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.pdf"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleAdd(e.target.files[0])}
                />
              </label>
            </div>
            {paths.length === 0 && (
              <p className="text-xs italic text-muted-foreground">Nenhuma referência anexada ainda.</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy || salvando}
                onClick={() => (temModelo ? salvarNoModelo() : salvarNoRascunho())}
              >
                {salvando ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
