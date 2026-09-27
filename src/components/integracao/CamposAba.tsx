// Integração — aba "Campos da API" (mockup 6/6b/6-confirm; SÓ super admin — v4/P-81 A: o servidor recusa os outros).
// Lista os 18 campos na ordem FIXA; desmarcar um do layout (1–17) pede "Tem certeza?"; Salvar pede "Confirmar mudança de
// campos". Grava por integracao_salvar_config com o rev CONGELADO na 1ª edição (P0409 se outra pessoa salvou).
//
// Adaptações do controlador sobre o brief da Task 14 (ver task-14-report.md):
// - `useIntegracaoConfig` (useIntegracao.ts, evoluído desde o brief) devolve `{ campos, layout, rev, api }`, não só
//   `{ campos, rev }` — usa-se `q.data?.campos`/`q.data?.rev` do mesmo jeito.
//
// Fix round 1 (task-14-review.md, revisão T14 #1/#2 — Important I1/I2):
// - I2: o rev usado no save NÃO pode ser o `q.data.rev` AO VIVO (um refetch em foco durante a edição o atualizaria
//   por baixo, e um save nesse instante sobrescreveria silenciosamente a mudança de outra pessoa sem NUNCA dar
//   P0409). O rev — e a `base` (a seleção do servidor no momento) — são CONGELADOS no 1º toggle, num único estado
//   `Edicao { sel, base, rev }`. Enquanto não há edição local (`ed === null`), a tela espelha o servidor ao vivo.
// - I1: no P0409, a seleção do usuário NUNCA é jogada fora. `onError` (só para P0409): fecha a confirmação,
//   `await` um refetch de verdade (nunca um `useEffect` sobre `q.data` — essa foi a lição do round 1 do
//   KeywordsDialog), REBASEIA o diff do usuário (o que ele marcou/desmarcou vs a `base` congelada) em cima da
//   seleção FRESCA do servidor, e troca `base`/`rev` para os valores frescos. Mostra o banner
//   `TEXTO_CAMPOS_CONFLITO` com as opções "usar a da loja" (descarta — `setEd(null)`) e "manter a minha" (só
//   fecha o banner; o rascunho rebaseado já está na tela). Nunca chama `mutate` sozinho — cada save exige um novo
//   clique em "Confirmar e salvar", então não há como entrar em loop.
// - Outros erros (rede, P0001, 42501): a seleção local FICA como estava (`ed` intocado); só mostra o toast
//   traduzido. Nenhum reset para `null`.
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
  CAMPOS, TEXTO_ALERTA_LAYOUT, TEXTO_CAMPOS_CONFLITO, TEXTO_CAMPOS_REGRA, TEXTO_CAMPOS_VAZIO, TEXTO_CONFIRMAR_CAMPOS,
  TEXTO_SO_SUPER, TEXTO_TRAVA_SEMPRE, alternarCampo, mesmaSelecao, ordenarCampos, precisaAlertaLayout, rotuloNaLista,
  type CampoKey,
} from "@/lib/integracao/campos";
import { useAbaSuja } from "./guard";
import { chaveConfig, invalidarIntegracao, useIntegracaoConfig } from "./useIntegracao";

/** Congela `sel`+`base`+`rev` no instante do 1º toggle (I2) — nunca lê `q.data.rev` de novo até o rascunho
 *  esvaziar (Salvar com sucesso ou "usar a da loja"). */
type Edicao = { sel: CampoKey[]; base: CampoKey[]; rev: number };

/** Rebaseia o diff do usuário (vs `base` velha) em cima da seleção FRESCA do servidor (I1): campos que o usuário
 *  desmarcou (estavam em `base`, não em `sel`) continuam fora; campos que o usuário marcou (não estavam em
 *  `base`, estão em `sel`) continuam dentro — sobre a base nova, não sobre a antiga. */
function rebasear(ed: Edicao, fresco: CampoKey[]): CampoKey[] {
  const desmarcadosPorMim = new Set(ed.base.filter((k) => !ed.sel.includes(k)));
  const marcadosPorMim = ed.sel.filter((k) => !ed.base.includes(k));
  const base = fresco.filter((k) => !desmarcadosPorMim.has(k));
  return ordenarCampos([...base, ...marcadosPorMim]);
}

export function CamposAba() {
  const router = useRouter();
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const q = useIntegracaoConfig();
  const [ed, setEd] = useState<Edicao | null>(null);
  const [alerta, setAlerta] = useState<CampoKey | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [conflito, setConflito] = useState(false);
  const servidor = ordenarCampos(q.data?.campos ?? []);
  const atual = ed?.sel ?? servidor;
  const sujo = ed !== null && !mesmaSelecao(ed.sel, ed.base);
  useAbaSuja("campos", sujo);
  const salvar = useMutation({
    mutationFn: async () => {
      // ed sempre não-nulo aqui: o botão Salvar só habilita com `sujo` (que exige ed !== null).
      const { error } = await supabase.rpc("integracao_salvar_config" as any, { _campos: ed!.sel, _rev: ed!.rev });
      if (error) throw error;
    },
    onSuccess: async () => {
      setConfirmar(false);
      setConflito(false);
      // m2 (task-14-review.md): espera o config fresco chegar ANTES de limpar `ed` — sem isso os checkboxes
      // piscavam de volta pro estado pré-Salvar por um instante (a invalidação não é aguardada) até o refetch
      // trazer o valor salvo.
      await qc.refetchQueries({ queryKey: chaveConfig(tenantId) });
      setEd(null);
      toast.success("Campos da API salvos. Valem para as próximas integrações.");
      invalidarIntegracao(qc, tenantId);
    },
    onError: async (e) => {
      const code = (e as { code?: string })?.code;
      if (code !== "P0409") {
        // Qualquer erro que NÃO seja conflito de versão (rede, P0001 "Marque pelo menos um campo.", 42501):
        // fecha só a confirmação. A seleção do usuário FICA (I1) — nunca resetar pra null aqui.
        setConfirmar(false);
        toast.error(mensagemErro(e, "Não foi possível salvar os campos."));
        return;
      }
      // P0409 conflito_versao: fecha a confirmação, busca a config fresca (AWAITED — nunca um useEffect sobre
      // q.data, essa foi a lição do round 1 do KeywordsDialog) e REBASEIA a seleção do usuário em cima dela.
      setConfirmar(false);
      const r = await q.refetch();
      if (r.isError || !r.data) {
        // Falha de conexão ao tentar confirmar o valor mais recente — a seleção do usuário fica intocada; ele
        // tenta salvar de novo quando quiser (1 tentativa por clique, nunca um retry automático).
        toast.error("Não foi possível confirmar o valor mais recente (falha de conexão). Tente salvar de novo.");
        return;
      }
      const fresco = ordenarCampos(r.data.campos);
      setEd((p) => (p ? { sel: rebasear(p, fresco), base: fresco, rev: r.data!.rev } : p));
      setConflito(true);
      toast.error(TEXTO_CAMPOS_CONFLITO);
    },
  });
  const alternar = (key: CampoKey, marcar: boolean) => {
    if (precisaAlertaLayout(key, marcar)) setAlerta(key);
    else setEd((e) => (e ? { ...e, sel: alternarCampo(e.sel, key, marcar) } : { sel: alternarCampo(servidor, key, marcar), base: servidor, rev: q.data!.rev }));
  };
  return (
    <div className="space-y-4">
      <p className="rounded-md bg-[var(--tone-info-bg)] p-3 text-sm text-[var(--tone-info-fg)]">{TEXTO_SO_SUPER}</p>
      <p className="text-sm text-muted-foreground">{TEXTO_CAMPOS_REGRA}</p>
      {q.isError && !q.data ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{mensagemErro(q.error, "Não foi possível carregar os campos.")}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void q.refetch()}>Tentar de novo</Button>
        </div>
      ) : !q.data ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <>
          {/* m1 (task-14-review.md): um refetch em BACKGROUND que falha (a lista já carregou antes) não esconde
              mais a lista inteira — só soma um aviso com "Tentar de novo" acima dela. */}
          {q.isError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <span>{mensagemErro(q.error, "Não foi possível atualizar os campos.")}</span>
              <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => void q.refetch()}>Tentar de novo</Button>
            </div>
          )}
          {conflito && (
            <div className="space-y-2 rounded-md border border-[var(--tone-warning-fg)] bg-[var(--tone-warning-bg)] p-3 text-sm">
              <p>{TEXTO_CAMPOS_CONFLITO}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => { setEd(null); setConflito(false); }}>usar a da loja</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConflito(false)}>manter a minha</Button>
              </div>
            </div>
          )}
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
        </>
      )}
      <p className="text-xs text-muted-foreground">{TEXTO_TRAVA_SEMPRE}</p>
      {/* m3 (task-14-review.md): seleção vazia bloqueia o Salvar (o servidor já recusa com P0001, mas travar aqui
          poupa a viagem e a mensagem fica visível ANTES do clique). */}
      {atual.length === 0 && <p className="text-sm text-destructive">{TEXTO_CAMPOS_VAZIO}</p>}

      <AlertDialog open={alerta !== null} onOpenChange={(o) => { if (!o) setAlerta(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
            <AlertDialogDescription>{TEXTO_ALERTA_LAYOUT}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter marcado</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (alerta) {
                  setEd((e) => (e ? { ...e, sel: alternarCampo(e.sel, alerta, false) } : { sel: alternarCampo(servidor, alerta, false), base: servidor, rev: q.data!.rev }));
                }
                setAlerta(null);
              }}
            >
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
        <Button type="button" className="ml-auto" disabled={!sujo || atual.length === 0 || salvar.isPending} onClick={() => setConfirmar(true)}>
          <Save className="h-4 w-4" />Salvar
        </Button>
      </PageActionBar>
    </div>
  );
}
