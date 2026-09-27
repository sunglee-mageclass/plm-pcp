// Integração — Keywords da LOJA (texto único, vale para TODOS os produtos — mockup 6c). Grava SÓ a coluna
// tenant_config.keywords por integracao_salvar(_keywords) com o valor carregado (R5: nunca o upsert da linha da Config);
// se alguém mudou no meio, P0409 keywords_mudou → a lista relê e o texto recarrega.
//
// Fix round 1 T12b (revisão A-I5/B-I5) — o laço de conflito estava quebrado: `setRecarregar(true)` disparava um
// `useEffect` que rodava NO MESMO commit com `atual` AINDA VELHO (a invalidação era assíncrona, sem `await`, e
// `tenant_config` não tem Realtime nesta tela) — o texto digitado era apagado pelo valor VELHO, o toast dizia
// "recarregado" mostrando o texto antigo, e o `base` continuava velho, então o PRÓXIMO Salvar dava P0409 de novo,
// em laço, até fechar e reabrir o diálogo. Fix: no P0409, `await` de um `refetchQueries` de verdade (a MESMA lista
// que carrega `keywords`, achada pelo PREFIXO da chave — `chaveLista`), lê o valor FRESCO do cache depois do
// refetch resolver, troca só o `base` (nunca o `texto` digitado) e mostra o texto exato pedido pela revisão.
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
import { chaveLista, invalidarIntegracao } from "./useIntegracao";
import type { ListaIntegracao } from "@/lib/integracao/produtos";

export const TEXTO_KEYWORDS_CONFLITO =
  "Outra pessoa mudou as Keywords — o seu texto continua aqui; salve de novo para substituir, ou use o texto novo.";

export function KeywordsDialog({ atual, onFechar, onSujoChange }: {
  atual: string | null; onFechar: () => void;
  // m7 (revisão): reporta o `dirty` DESTE diálogo pra guarda ÚNICA da página (`ProdutosAba` soma no `sujo` que vai
  // pra `useAbaSuja`) — sem isso, "Voltar" do navegador ou F5 com texto digitado aqui saía sem perguntar nada.
  onSujoChange?: (sujo: boolean) => void;
}) {
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const [texto, setTexto] = useState(atual ?? "");
  const [base, setBase] = useState(atual ?? "");
  const [salvando, setSalvando] = useState(false);
  // Fix round 1 T12b (A-I5/B-I5): valor FRESCO da loja lido do servidor no P0409 — mostrado ao lado do texto
  // digitado, nunca substituindo-o em silêncio.
  const [novoDaLoja, setNovoDaLoja] = useState<string | null>(null);
  const dirty = texto !== base;
  useEffect(() => { onSujoChange?.(dirty); }, [dirty, onSujoChange]);
  useEffect(() => () => onSujoChange?.(false), [onSujoChange]);
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose: onFechar });
  const usarTextoNovo = () => {
    if (novoDaLoja === null) return;
    setTexto(novoDaLoja);
    setBase(novoDaLoja);
    setNovoDaLoja(null);
  };
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
      if ((e as { code?: string })?.code === "P0409") {
        toast.error(TEXTO_KEYWORDS_CONFLITO);
        // `await` de verdade — nunca lê `atual` (a prop) no mesmo commit, que ainda estaria velho. O refetch busca
        // a MESMA lista que carrega `keywords`; a chave é por PREFIXO (`chaveLista`) porque a query ativa tem mais
        // elementos (situação/filtros/página) do que essa chave "achatada" de 2.
        await qc.refetchQueries({ queryKey: chaveLista(tenantId), type: "active" });
        const pares = qc.getQueriesData<ListaIntegracao>({ queryKey: chaveLista(tenantId) });
        const fresco = pares.map(([, d]) => d).find((d): d is ListaIntegracao => !!d);
        if (fresco) {
          // O texto DIGITADO fica exatamente como está — só o valor de referência (`novoDaLoja`) aparece, com as
          // 2 ações explícitas (usar o novo troca base+texto; ignorar mantém o texto e o `base` velho, então o
          // próximo Salvar ainda compara contra ele e pode dar P0409 de novo — decisão explícita do usuário).
          setNovoDaLoja(fresco.keywords ?? "");
        }
      } else {
        toast.error(mensagemErro(e, "Não foi possível salvar as Keywords."));
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
          <Textarea id="integracao-keywords" rows={3} value={texto} onChange={(e) => { setTexto(e.target.value); setNovoDaLoja(null); }} />
        </div>
        {novoDaLoja !== null && (
          <div className="space-y-2 rounded-md border border-[var(--tone-warning-fg)] bg-[var(--tone-warning-bg)] p-3 text-sm">
            <p>{TEXTO_KEYWORDS_CONFLITO}</p>
            <p className="text-xs text-muted-foreground">Texto novo da loja: {novoDaLoja || "(vazio)"}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={usarTextoNovo}>usar o texto novo</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setNovoDaLoja(null)}>manter o meu</Button>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={requestClose}>Cancelar</Button>
          <Button type="button" disabled={!dirty || salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
      <UnsavedChangesGuard confirm={confirm} />
    </Dialog>
  );
}
