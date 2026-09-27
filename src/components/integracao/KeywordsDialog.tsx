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
//
// Fix round 2 T12b (revisão R1 do task-12b-review.md "Re-review round 1" / R-I3 do task-12b-code-review.md
// "Re-check round 1") — o fix round 1 ficou incompleto em 2 pontos, e o laço P0409 continuava aberto por 2
// caminhos diferentes:
// (a) "manter o meu" (na v1, o botão só escondia a faixa com `setNovoDaLoja(null)`) NUNCA atualizava `base` — como
//     o servidor compara `coalesce(atual,'') IS DISTINCT FROM esperado` e `esperado` é sempre `base`, deixar
//     `base` velho fazia TODO Salvar seguinte (mesmo depois de "manter o meu") bater em P0409 de novo, num laço de
//     verdade — mesmo a própria mensagem dizendo "salve de novo para substituir" (que não funcionava). Fix: no
//     P0409, `base` já é trocado pro valor FRESCO (o texto digitado nunca muda) — então tanto "manter o meu"
//     quanto simplesmente salvar de novo já mandam `esperado` = o valor fresco, e o servidor aceita.
// (b) a leitura do valor fresco usava `getQueriesData(...).find(d => !!d)` — `getQueriesData` devolve na ORDEM DE
//     INSERÇÃO do QueryCache, não por atividade/recência. Se o usuário tivesse trocado de página/filtro/situação
//     ANTES de abrir o Keywords, a query ativa (a que o `refetchQueries({type:"active"})` de fato atualizou) podia
//     não ser a PRIMEIRA da lista — `.find(d => !!d)` pegava uma entrada INATIVA e desatualizada. Fix: lê pela
//     query com o MAIOR `dataUpdatedAt` entre as em cache com este prefixo (a que o refetch acabou de tocar),
//     nunca a primeira encontrada.
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
  // Fix round 2 T12b (R1(a)/R-I3(a)): "usar o novo" TROCA o texto pro valor fresco (nunca só adota em silêncio no
  // `base` deixando o texto digitado antigo) — `base` já tinha sido atualizado no próprio P0409 (ver `salvar`).
  const usarTextoNovo = () => {
    if (novoDaLoja === null) return;
    setTexto(novoDaLoja);
    setNovoDaLoja(null);
  };
  // Fix round 2 T12b (R1(a)/R-I3(a)): "manter o meu" só esconde a faixa — `base` JÁ está no valor fresco desde o
  // P0409 (não precisa trocar de novo aqui). Mantido como função nomeada (em vez de inline) só por simetria com
  // `usarTextoNovo` e clareza no JSX.
  const manterOMeu = () => setNovoDaLoja(null);
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
        // `await` de verdade — nunca lê `atual` (a prop) no mesmo commit, que ainda estaria velho. O refetch busca
        // a MESMA lista que carrega `keywords`; a chave é por PREFIXO (`chaveLista`) porque a query ativa tem mais
        // elementos (situação/filtros/página) do que essa chave "achatada" de 2.
        await qc.refetchQueries({ queryKey: chaveLista(tenantId), type: "active" });
        // Fix round 2 T12b (R1(b)/R-I3(b)): `getQueriesData(...).find(d => !!d)` pegava a PRIMEIRA entrada por
        // ORDEM DE INSERÇÃO do QueryCache — nunca por atividade/recência. Se o usuário tivesse trocado de
        // página/filtro/situação antes de abrir o Keywords, a 1ª entrada podia ser uma query INATIVA que o
        // `refetchQueries({type:"active"})` acima nunca tocou, ainda com `keywords` velho. Em vez disso, varre
        // `getQueryCache().findAll` com o mesmo prefixo e pega a de MAIOR `dataUpdatedAt` — a que o refetch
        // acabou de atualizar (ou, na ausência de qualquer query ativa, a mais recente disponível mesmo assim).
        const consultas = qc.getQueryCache().findAll({ queryKey: chaveLista(tenantId) });
        let fresco: ListaIntegracao | undefined;
        let maisRecente = -Infinity;
        for (const q of consultas) {
          const dado = q.state.data as ListaIntegracao | undefined;
          if (!dado) continue;
          if (q.state.dataUpdatedAt > maisRecente) {
            maisRecente = q.state.dataUpdatedAt;
            fresco = dado;
          }
        }
        if (fresco) {
          const valorFresco = fresco.keywords ?? "";
          // Fix round 2 T12b (R1(a)/R-I3(a)): `base` troca pro valor FRESCO aqui mesmo — o texto DIGITADO fica
          // exatamente como está. Sem isso, "manter o meu" (ou simplesmente salvar de novo) continuava comparando
          // contra o `base` VELHO no próximo Salvar, e o servidor recusava com P0409 de novo — um laço de verdade,
          // apesar do texto da mensagem prometer "salve de novo para substituir".
          setBase(valorFresco);
          setNovoDaLoja(valorFresco);
          toast.error(TEXTO_KEYWORDS_CONFLITO);
        } else {
          // Não achou nenhuma lista em cache com dado (caso extremo — nunca teria carregado o diálogo, mas por
          // segurança nunca deixa `base` desatualizado sem avisar: mensagem genérica, sem `novoDaLoja` (nada fresco
          // pra oferecer como ação).
          toast.error(mensagemErro(e, "Não foi possível salvar as Keywords."));
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
              <Button type="button" variant="ghost" size="sm" onClick={manterOMeu}>manter o meu</Button>
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
