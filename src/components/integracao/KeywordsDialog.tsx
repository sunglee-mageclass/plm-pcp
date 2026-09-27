// Integração — Keywords da LOJA (texto único, vale para TODOS os produtos — mockup 6c). Grava SÓ a coluna
// tenant_config.keywords por integracao_salvar(_keywords) com o valor carregado (R5: nunca o upsert da linha da Config);
// se alguém mudou no meio, P0409 keywords_mudou → a lista relê e o texto recarrega.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { InfoHover } from "@/components/shared/InfoHover";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { mensagemErro } from "@/lib/erro-mensagem";
import { invalidarIntegracao } from "./useIntegracao";

export function KeywordsDialog({ atual, onFechar }: { atual: string | null; onFechar: () => void }) {
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const [texto, setTexto] = useState(atual ?? "");
  const [base, setBase] = useState(atual ?? "");
  const [salvando, setSalvando] = useState(false);
  const [recarregar, setRecarregar] = useState(false);
  useEffect(() => {
    if (!recarregar) return;
    setTexto(atual ?? "");
    setBase(atual ?? "");
    setRecarregar(false);
  }, [atual, recarregar]);
  const dirty = texto !== base;
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose: onFechar });
  const salvar = async () => {
    setSalvando(true);
    try {
      // `base` = o texto que ESTE diálogo carregou (não o `atual` da lista, que pode ter relido no meio) — R5.
      const { error } = await supabase.rpc("integracao_salvar" as any, { _itens: [], _keywords: { valor: texto, esperado: base } });
      if (error) throw error;
      toast.success("Keywords da loja salvas.");
      invalidarIntegracao(qc, tenantId);
      onFechar();
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível salvar as Keywords."));
      if ((e as { code?: string })?.code === "P0409") {
        setRecarregar(true);
        invalidarIntegracao(qc, tenantId);
      }
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keywords da loja</DialogTitle>
          <DialogDescription>Muda para TODOS os produtos da loja.</DialogDescription>
        </DialogHeader>
        <div className="rounded-md bg-[var(--tone-warning-bg)] p-3 text-sm text-[var(--tone-warning-fg)]">
          Muda para TODOS os produtos da loja (os já integráveis/integrados mantêm o retrato).
        </div>
        <div className="grid gap-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="integracao-keywords">Texto (separado por vírgula)</Label>
            <InfoHover ariaLabel="Como grava">Grava só o texto das Keywords da loja; se alguém mudou enquanto você editava, a tela avisa.</InfoHover>
          </div>
          <Textarea id="integracao-keywords" rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={requestClose}>Cancelar</Button>
          <Button type="button" disabled={!dirty || salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
      <UnsavedChangesGuard confirm={confirm} />
    </Dialog>
  );
}
