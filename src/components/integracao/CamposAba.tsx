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
//
// Fix round 2 (task-14-review.md "Re-review round 1", Minor n1-n3):
// - n1: o banner do P0409 agora MOSTRA o que a outra pessoa mudou (`diffCampos`, a lista de campos entre a base
//   ANTIGA e a fresca). 3 variantes de texto guardadas em `conflito`: campos mudaram de verdade (lista o diff);
//   falso conflito — mesma lista de campos, só o rev mudou (Task 15 salvando a config da API, MESMO rev
//   compartilhado) → `TEXTO_CAMPOS_CONFLITO_SO_REV`; e "não sobrou nada pra salvar" quando o rebase deixa a
//   seleção do usuário IDÊNTICA à fresca → `TEXTO_CAMPOS_CONFLITO_NADA_A_SALVAR` (nunca afirma "suas mudanças
//   foram mantidas" quando não sobrou mudança nenhuma).
// - n2: os dois pontos que criam/atualizam `ed` (toggle normal e "Desmarcar mesmo assim") fecham o rascunho
//   (`setEd(null)`) sempre que a nova seleção fica IGUAL à base — a tela volta a espelhar o servidor ao vivo
//   (um refetch de outra pessoa passa a aparecer na hora, não fica preso atrás de um `ed` "vazio" mas não-nulo).
// - n3: os checkboxes desabilitam durante `salvar.isPending` — cobre o `await refetchQueries` do `onSuccess`
//   (antes, um toggle nesse intervalo era perdido pelo `setEd(null)` que vem em seguida).
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
  CAMPOS, TEXTO_ALERTA_LAYOUT, TEXTO_CAMPOS_CONFLITO, TEXTO_CAMPOS_CONFLITO_NADA_A_SALVAR, TEXTO_CAMPOS_CONFLITO_SO_REV,
  TEXTO_CAMPOS_REGRA, TEXTO_CAMPOS_VAZIO, TEXTO_CONFIRMAR_CAMPOS, TEXTO_SO_SUPER, TEXTO_TRAVA_SEMPRE, alternarCampo,
  diffCampos, mesmaSelecao, ordenarCampos, precisaAlertaLayout, rotuloNaLista, type CampoKey,
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

/** Fix round 2 T14 (n2, task-14-review.md Minor n2): aplica um toggle sobre a edição atual (ou congela uma nova
 *  a partir do `servidor`/`rev` vivo, se `e` ainda é `null`) e devolve `null` quando o resultado volta a bater
 *  com a `base` — a tela então PARA de espelhar um rascunho e volta a seguir o servidor ao vivo (sem isso, um
 *  usuário que desfaz manualmente o próprio toggle ficava preso com `ed` não-nulo, "surdo" a um refetch de outra
 *  pessoa que chegasse nesse meio-tempo). */
function aplicarToggle(e: Edicao | null, servidor: CampoKey[], rev: number, key: CampoKey, marcar: boolean): Edicao | null {
  const base = e?.base ?? servidor;
  const sel = alternarCampo(e?.sel ?? servidor, key, marcar);
  if (mesmaSelecao(sel, base)) return null;
  return { sel, base, rev: e?.rev ?? rev };
}

export function CamposAba() {
  const router = useRouter();
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const q = useIntegracaoConfig();
  const [ed, setEd] = useState<Edicao | null>(null);
  const [alerta, setAlerta] = useState<CampoKey | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  // n1: o banner do P0409 guarda o TEXTO já resolvido (uma das 3 variantes) — decidido no momento do conflito,
  // não recalculado no render (a base ANTIGA já foi substituída pela fresca a essa altura).
  const [conflito, setConflito] = useState<string | null>(null);
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
      setConflito(null);
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
      if (!ed) return; // não deveria acontecer (o Salvar só habilita com ed !== null), mas é fail-safe.
      const fresco = ordenarCampos(r.data.campos);
      const baseAntiga = ed.base;
      const rebaseado = rebasear(ed, fresco);
      // n1: 3 cenários — decididos com a base ANTIGA (antes deste conflito) e a seleção fresca do servidor:
      // (a) os CAMPOS não mudaram (só o rev — Task 15 salvou a config da API, mesmo rev compartilhado): falso
      //     conflito, nada pra rebasear de verdade.
      // (b) o rebase deixou a seleção do usuário IDÊNTICA à fresca: não sobrou mudança nenhuma pra manter (nunca
      //     afirma "suas mudanças foram mantidas" quando não sobrou mudança nenhuma).
      // (c) caso geral: lista o que a OUTRA pessoa mudou (diff base-antiga → fresca).
      const nadaRestou = mesmaSelecao(rebaseado, fresco);
      const mensagem = mesmaSelecao(baseAntiga, fresco)
        ? TEXTO_CAMPOS_CONFLITO_SO_REV
        : nadaRestou
          ? TEXTO_CAMPOS_CONFLITO_NADA_A_SALVAR
          : `${TEXTO_CAMPOS_CONFLITO} Mudou na loja: ${diffCampos(baseAntiga, fresco)}.`;
      setConflito(mensagem);
      // n2: se o rebase devolveu exatamente a seleção fresca (nada de próprio do usuário sobrou), fecha o
      // rascunho — a tela volta a espelhar o servidor ao vivo em vez de ficar presa num `ed` "vazio".
      setEd(nadaRestou ? null : { sel: rebaseado, base: fresco, rev: r.data!.rev });
      toast.error(mensagem);
    },
  });
  const alternar = (key: CampoKey, marcar: boolean) => {
    if (precisaAlertaLayout(key, marcar)) setAlerta(key);
    else setEd((e) => aplicarToggle(e, servidor, q.data!.rev, key, marcar));
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
          {conflito !== null && (
            <div className="space-y-2 rounded-md border border-[var(--tone-warning-fg)] bg-[var(--tone-warning-bg)] p-3 text-sm">
              <p>{conflito}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => { setEd(null); setConflito(null); }}>usar a da loja</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConflito(null)}>manter a minha</Button>
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
                    {/* n3 (task-14-review.md): desabilita durante salvar.isPending — cobre o await
                        refetchQueries do onSuccess (antes, um toggle nessa janela era perdido pelo setEd(null)
                        que vinha logo depois). */}
                    <Checkbox
                      id={`campo-${c.key}`}
                      checked={marcado}
                      disabled={salvar.isPending}
                      onCheckedChange={(v) => alternar(c.key, v === true)}
                    />
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
                  setEd((e) => aplicarToggle(e, servidor, q.data!.rev, alerta, false));
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
