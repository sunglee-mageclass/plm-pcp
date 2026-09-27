// Integração — "Nova chave" em 2 passos (mockup 7d/7e): (1) nome → Criar; (2) a chave aparece SÓ UMA VEZ, com Copiar.
// O servidor guarda só o SHA-256 (D17); fechar o passo 2 sem confirmar pede "você copiou a chave?" (a chave nunca
// fica em cache/query/log depois de fechado — `criada` é estado LOCAL do componente, que desmonta ao fechar).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { mensagemErro } from "@/lib/erro-mensagem";
import { TEXTO_FECHAR_SEM_COPIAR, TEXTO_NOVA_CHAVE_GUARDE } from "@/lib/integracao/api-tela";
import { invalidarIntegracao } from "./useIntegracao";

export function NovaChaveDialog({ onFechar }: { onFechar: () => void }) {
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [criada, setCriada] = useState<{ nome: string; chave: string } | null>(null);
  const [criando, setCriando] = useState(false);
  const [pedirConfirmacao, setPedirConfirmacao] = useState(false);
  const criar = async () => {
    setCriando(true);
    try {
      const { data, error } = await supabase.rpc("integracao_chave_criar" as any, { _nome: nome.trim() });
      if (error) throw error;
      const o = data as { nome: string; chave: string };
      setCriada({ nome: o.nome, chave: o.chave });
      void qc.invalidateQueries({ queryKey: ["integracao-chaves", tenantId] });
      invalidarIntegracao(qc, tenantId);
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível criar a chave."));
    } finally {
      setCriando(false);
    }
  };
  const copiar = async () => {
    if (!criada) return;
    try {
      await navigator.clipboard.writeText(criada.chave);
      toast.success("Chave copiada.");
    } catch {
      const el = document.getElementById("integracao-chave-gerada") as HTMLInputElement | null;
      el?.focus();
      el?.select();
      toast.error("Não foi possível copiar — selecione o texto e copie à mão.");
    }
  };
  // Fechar o passo 2 (a chave já foi gerada) sem confirmar pede "você copiou a chave?" — a chave nunca fica em
  // nenhum cache/query/log depois de fechado: `criada` é estado local deste componente, que desmonta ao fechar
  // (nada grava a chave em outro lugar; a invalidação acima já rodou, e ela invalida só ["integracao-chaves"], que
  // nunca leva a chave em si — só id/nome/final, conforme `integracao_chaves_listar`/D32).
  const tentarFechar = () => {
    if (criada) setPedirConfirmacao(true);
    else onFechar();
  };
  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) tentarFechar(); }}>
        <DialogContent className="max-w-md">
          {!criada ? (
            <>
              <DialogHeader>
                <DialogTitle>Nova chave</DialogTitle>
                <DialogDescription>Dê um nome que diga para que serve (ex.: ERP Principal).</DialogDescription>
              </DialogHeader>
              <div className="grid gap-1">
                <Label htmlFor="integracao-nome-chave">Nome da chave</Label>
                <Input id="integracao-nome-chave" maxLength={60} value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={onFechar}>Cancelar</Button>
                <Button type="button" disabled={nome.trim() === "" || criando} onClick={() => void criar()}>{criando ? "Criando…" : "Criar"}</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Chave "{criada.nome}" criada</DialogTitle>
                <DialogDescription>{TEXTO_NOVA_CHAVE_GUARDE}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-1">
                <Label htmlFor="integracao-chave-gerada">Chave gerada</Label>
                <div className="flex items-center gap-2">
                  <Input id="integracao-chave-gerada" readOnly value={criada.chave} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <Button type="button" variant="outline" onClick={() => void copiar()}><Copy className="h-4 w-4" />Copiar</Button>
                </div>
              </div>
              <p className="rounded-md bg-[var(--tone-warning-bg)] p-3 text-sm text-[var(--tone-warning-fg)]">{TEXTO_NOVA_CHAVE_GUARDE}</p>
              <DialogFooter>
                <Button type="button" onClick={tentarFechar}>Concluído</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={pedirConfirmacao} onOpenChange={(o) => { if (!o) setPedirConfirmacao(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Você copiou a chave?</AlertDialogTitle>
            <AlertDialogDescription>{TEXTO_FECHAR_SEM_COPIAR}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar e copiar</AlertDialogCancel>
            <AlertDialogAction onClick={onFechar}>Sim, pode fechar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
