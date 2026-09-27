// Integração — aba "Campos da API" (mockup 6/6b/6-confirm; SÓ super admin — v4/P-81 A: o servidor recusa os outros).
// Lista os 18 campos na ordem FIXA; desmarcar um do layout (1–17) pede "Tem certeza?"; Salvar pede "Confirmar mudança de
// campos". Grava por integracao_salvar_config com o rev lido (P0409 se outra pessoa salvou).
//
// Adaptações do controlador sobre o brief da Task 14 (ver task-14-report.md):
// - `useIntegracaoConfig` (useIntegracao.ts, evoluído desde o brief) devolve `{ campos, layout, rev, api }`, não só
//   `{ campos, rev }` — usa-se `q.data?.campos` do mesmo jeito (o campo extra `layout`/`api` não muda nada aqui).
// - P0409 (`conflito_versao`, servidor): mesma lição do KeywordsDialog — nunca reabre a confirmação sozinho (sem
//   loop). `onError` fecha o diálogo de confirmação, mostra o erro e força um `refetch()` da config; como `sel` é
//   zerado para `null` nesse fechamento, a tela volta a espelhar `servidor` (o valor FRESCO assim que o refetch
//   voltar) — o usuário decide se refaz a mudança em cima do estado atual, nunca um retry automático.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PageActionBar } from "@/components/shared/PageActionBar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { mensagemErro } from "@/lib/erro-mensagem";
import {
  CAMPOS, TEXTO_ALERTA_LAYOUT, TEXTO_CAMPOS_REGRA, TEXTO_CONFIRMAR_CAMPOS, TEXTO_SO_SUPER, TEXTO_TRAVA_SEMPRE, alternarCampo,
  mesmaSelecao, ordenarCampos, precisaAlertaLayout, rotuloNaLista, type CampoKey,
} from "@/lib/integracao/campos";
import { useAbaSuja } from "./guard";
import { chaveConfig, invalidarIntegracao, useIntegracaoConfig } from "./useIntegracao";

export function CamposAba() {
  const router = useRouter();
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const q = useIntegracaoConfig();
  const [sel, setSel] = useState<CampoKey[] | null>(null);
  const [alerta, setAlerta] = useState<CampoKey | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const servidor = ordenarCampos(q.data?.campos ?? []);
  const atual = sel ?? servidor;
  const sujo = sel !== null && !mesmaSelecao(sel, servidor);
  useAbaSuja("campos", sujo);
  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("integracao_salvar_config" as any, { _campos: atual, _rev: q.data?.rev ?? 0 });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Campos da API salvos. Valem para as próximas integrações.");
      setSel(null);
      setConfirmar(false);
      void qc.invalidateQueries({ queryKey: chaveConfig(tenantId) });
      invalidarIntegracao(qc, tenantId);
    },
    onError: (e) => {
      // Mesma lição do KeywordsDialog (P0409/conflito_versao): fecha a confirmação e NUNCA reabre sozinha — sem
      // isso um erro persistente (ex.: rev sempre desatualizado) reapresentaria "Confirmar e salvar" em loop sobre
      // o MESMO payload rejeitado. `setSel(null)` devolve a tela para espelhar `servidor` assim que o refetch
      // abaixo trouxer o rev fresco (o usuário decide se refaz a mudança em cima do estado atual).
      setConfirmar(false);
      setSel(null);
      toast.error(mensagemErro(e, "Não foi possível salvar os campos."));
      void q.refetch();
    },
  });
  const alternar = (key: CampoKey, marcar: boolean) => {
    if (precisaAlertaLayout(key, marcar)) setAlerta(key);
    else setSel(alternarCampo(atual, key, marcar));
  };
  return (
    <div className="space-y-4">
      <p className="rounded-md bg-[var(--tone-info-bg)] p-3 text-sm text-[var(--tone-info-fg)]">{TEXTO_SO_SUPER}</p>
      <p className="text-sm text-muted-foreground">{TEXTO_CAMPOS_REGRA}</p>
      {q.isError ? (
        <p className="text-sm text-destructive">{mensagemErro(q.error, "Não foi possível carregar os campos.")}</p>
      ) : !q.data ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="max-w-xl rounded-md border">
          <p className="border-b px-3 py-2 text-sm font-medium">Ordem fixa dos campos</p>
          <ol>
            {CAMPOS.map((c, i) => {
              const marcado = atual.includes(c.key);
              return (
                <li key={c.key} className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0">
                  <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <Checkbox id={`campo-${c.key}`} checked={marcado} onCheckedChange={(v) => alternar(c.key, v === true)} />
                  <label htmlFor={`campo-${c.key}`} className="flex-1 text-sm">{rotuloNaLista(c.key)}</label>
                  <StatusBadge tone={c.layout ? "neutral" : "info"}>{c.layout ? "layout" : "opcional"}</StatusBadge>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{TEXTO_TRAVA_SEMPRE}</p>

      <AlertDialog open={alerta !== null} onOpenChange={(o) => { if (!o) setAlerta(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
            <AlertDialogDescription>{TEXTO_ALERTA_LAYOUT}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter marcado</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { if (alerta) setSel(alternarCampo(atual, alerta, false)); setAlerta(null); }}>
              Desmarcar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmar} onOpenChange={(o) => { if (!o && !salvar.isPending) setConfirmar(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar mudança de campos</AlertDialogTitle>
            <AlertDialogDescription>{TEXTO_CONFIRMAR_CAMPOS}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={salvar.isPending}>Voltar</AlertDialogCancel>
            <Button type="button" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
              {salvar.isPending ? "Salvando…" : "Confirmar e salvar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PageActionBar>
        <Button type="button" variant="outline" onClick={() => router.history.back()}>
          <ArrowLeft className="h-4 w-4" />Voltar
        </Button>
        <Button type="button" className="ml-auto" disabled={!sujo || salvar.isPending} onClick={() => setConfirmar(true)}>
          <Save className="h-4 w-4" />Salvar
        </Button>
      </PageActionBar>
    </div>
  );
}
