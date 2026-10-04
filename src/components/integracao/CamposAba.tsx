// Integração — aba "Campos da API" (mockup 6/6b/6-confirm; SÓ super admin — v4/P-81 A: o servidor recusa os outros).
// Lista os 21 campos na ordem FIXA; desmarcar um do layout (1–17) pede "Tem certeza?"; Salvar pede "Confirmar mudança de
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
import { useRef, useState } from "react";
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
import { chaveTetoGerarJson } from "@/lib/integracao/gerar-json";
import { useAbaSuja } from "./guard";
import {
  TEXTO_LOJA_INDISPONIVEL,
  TEXTO_LOJA_MUDOU,
  chaveConfig,
  confirmarLojaAtiva,
  invalidarIntegracao,
  useIntegracaoConfig,
} from "./useIntegracao";

/** Congela `sel`+`base`+`rev` no instante do 1º toggle (I2) — nunca lê `q.data.rev` de novo até o rascunho
 *  esvaziar (Salvar com sucesso ou "usar a da loja"). `tenantId` (revisão T15 #1, code-review I1, defesa em
 *  profundidade): a página já remonta a aba inteira com `key={tenantId}` ao trocar de loja (IntegracaoPage), mas
 *  o rascunho também carrega a loja em que nasceu — o mutationFn recusa salvar se ela não bater mais com a
 *  CACHEADA atual. ⚠️ Fix round 2 (code-review "Re-check round 1" I1-R): esta checagem só compara DOIS VALORES DO
 *  CLIENTE — ela NÃO cobre "qualquer forma futura" de a loja mudar: uma 2ª aba/janela que troca a loja ativa no
 *  SERVIDOR nunca reobserva a query `["active-tenant-id"]` desta aba sozinha (`focusManager` só reage a
 *  `visibilitychange`, não a `focus`), então os dois valores comparados aqui continuam IGUAIS mesmo com o
 *  servidor já noutra loja. A defesa REAL é `confirmarLojaAtiva` (`useIntegracao.ts`), chamada logo antes do
 *  `rpc` — relê `users.tenant_id` DIRETO do servidor, bypassando o cache. */
type Edicao = { sel: CampoKey[]; base: CampoKey[]; rev: number; tenantId: string };

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
function aplicarToggle(
  e: Edicao | null, servidor: CampoKey[], rev: number, tenantId: string, key: CampoKey, marcar: boolean,
): Edicao | null {
  const base = e?.base ?? servidor;
  const sel = alternarCampo(e?.sel ?? servidor, key, marcar);
  if (mesmaSelecao(sel, base)) return null;
  return { sel, base, rev: e?.rev ?? rev, tenantId: e?.tenantId ?? tenantId };
}

export function CamposAba() {
  const router = useRouter();
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const q = useIntegracaoConfig();
  const [ed, setEd] = useState<Edicao | null>(null);
  // p2 (task-14-review.md, revisão T14 "Re-review round 2"): espelha `ed` SINCRONAMENTE a cada set — o handler do
  // P0409 (fora de um evento React, dentro de um `await`) precisa do `ed` MAIS ATUAL no instante em que o refetch
  // resolve, não o capturado no fechamento no início do `onError`. Ler dentro do updater funcional de `setEd`
  // pareceria mais correto, mas o valor computado a partir dele (a mensagem do banner) não pode ser lido de volta
  // com segurança logo em seguida — React só GARANTE chamar o updater até o próximo render, não sincronamente no
  // ponto da chamada (mesma lição do "m-S1" documentada no fix round 3 da T12b: nunca compute algo DENTRO de um
  // updater e leia o resultado FORA dele no mesmo tick). Por isso o rebase roda como função PURA sobre `edRef.
  // current` (sempre atualizado), e só então `setEd`/`setConflito` recebem o valor já pronto.
  const edRef = useRef<Edicao | null>(null);
  const definirEd = (novo: Edicao | null | ((e: Edicao | null) => Edicao | null)) => {
    setEd((atual) => {
      const prox = typeof novo === "function" ? (novo as (e: Edicao | null) => Edicao | null)(atual) : novo;
      edRef.current = prox;
      return prox;
    });
  };
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
      // revisão T15 #1 (code-review I1, defesa em profundidade — CLIENTE vs CLIENTE, ver o comentário de `Edicao`
      // acima): recusa ANTES de qualquer chamada de rede se o rascunho nasceu numa loja diferente da cacheada
      // atual — não deveria acontecer (a página remonta por `key={tenantId}`), mas é a 1ª linha de defesa.
      // Fix round 4 T15 (follow-up do coordenador, concern 3): loja do cliente VAZIA ("" transitório — a releitura
      // de `active-tenant-id` falhou) não é troca de loja: recusa com `LOJA_INDISPONIVEL`, nunca "Recarregue a
      // página" (o rascunho sobrevive ao "" e um reload o jogaria fora). `LOJA_MUDOU` só com as DUAS lojas não vazias.
      if (!tenantId) {
        throw Object.assign(new Error(TEXTO_LOJA_INDISPONIVEL), { code: "LOJA_INDISPONIVEL" });
      }
      if (ed!.tenantId !== tenantId) {
        throw Object.assign(new Error(TEXTO_LOJA_MUDOU), { code: "LOJA_MUDOU" });
      }
      // revisão T15 #I1-R (code-review "Re-check round 1"): a defesa acima não pega uma 2ª aba/janela que trocou
      // de loja no SERVIDOR sem que esta aba jamais reobservasse — relê `users.tenant_id` DIRETO do servidor
      // imediatamente antes do save (última linha de defesa real, do lado do cliente).
      await confirmarLojaAtiva(tenantId);
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
      // o teto por arquivo do Gerar JSON depende de `max_por_pagina` (RPC própria, key própria)
      void qc.invalidateQueries({ queryKey: chaveTetoGerarJson(tenantId) });
      definirEd(null);
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
      // p2 (task-14-review.md, revisão T14 "Re-review round 2"): lê `edRef.current` (sempre sincronizado por
      // `definirEd`), não o `ed` capturado no fechamento no início deste `onError` — entre o `await q.refetch()`
      // acima e este ponto, um clique no banner de um conflito ANTERIOR ("usar a da loja"/"manter a minha") pode
      // ter mudado `ed`. O rebase roda como função PURA (fora de qualquer updater — nunca compute algo dentro de
      // um `setState(fn)` e leia o resultado de volta no mesmo tick logo em seguida: o React só garante chamar o
      // updater até o próximo render, não sincronamente no ponto da chamada; mesma lição do "m-S1" documentada no
      // fix round 3 da T12b em `rascunho.ts:resultadoPosSalvar`) e só então `definirEd`/`setConflito` recebem o
      // valor JÁ PRONTO.
      const edAtual = edRef.current;
      if (!edAtual) return; // fail-safe: não deveria acontecer (Salvar só habilita com ed !== null).
      const fresco = ordenarCampos(r.data.campos);
      const baseAntiga = edAtual.base;
      const rebaseado = rebasear(edAtual, fresco);
      const nadaRestou = mesmaSelecao(rebaseado, fresco);
      const somenteRev = mesmaSelecao(baseAntiga, fresco);
      // n1/p1: 3 cenários — decididos com a base ANTIGA (antes deste conflito) e a seleção fresca do servidor:
      // (a) os CAMPOS não mudaram (só o rev — Task 15 salvou a config da API, mesmo rev compartilhado): falso
      //     conflito, nada pra rebasear de verdade.
      // (b) o rebase deixou a seleção do usuário IDÊNTICA à fresca: não sobrou mudança nenhuma pra manter (nunca
      //     afirma "suas mudanças foram mantidas" quando não sobrou mudança nenhuma). Mesmo aqui, se a loja mudou
      //     MAIS do que a própria edição do usuário (ex.: ele só marcou Foto; a loja marcou Foto E desmarcou
      //     Peso), o "Mudou na loja: …" continua aparecendo — a mudança do usuário estava CONTIDA na da loja, não
      //     necessariamente IDÊNTICA a ela (p1: texto suavizado, sem "exatamente").
      // (c) caso geral: lista o que a OUTRA pessoa mudou (diff base-antiga → fresca).
      const diff = diffCampos(baseAntiga, fresco);
      const mensagem = somenteRev
        ? TEXTO_CAMPOS_CONFLITO_SO_REV
        : nadaRestou
          ? diff === "" ? TEXTO_CAMPOS_CONFLITO_NADA_A_SALVAR : `${TEXTO_CAMPOS_CONFLITO_NADA_A_SALVAR} Mudou na loja: ${diff}.`
          : `${TEXTO_CAMPOS_CONFLITO} Mudou na loja: ${diff}.`;
      // n2: se o rebase devolveu exatamente a seleção fresca (nada de próprio do usuário sobrou), fecha o
      // rascunho — a tela volta a espelhar o servidor ao vivo em vez de ficar presa num `ed` "vazio".
      definirEd(nadaRestou ? null : { sel: rebaseado, base: fresco, rev: r.data.rev, tenantId: edAtual.tenantId });
      setConflito(mensagem);
      toast.error(mensagem);
    },
  });
  const alternar = (key: CampoKey, marcar: boolean) => {
    if (precisaAlertaLayout(key, marcar)) setAlerta(key);
    else definirEd((e) => aplicarToggle(e, servidor, q.data!.rev, tenantId, key, marcar));
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
                {/* p1: quando não sobrou rascunho nenhum do usuário (ed já é null — "nada a salvar"/falso conflito),
                    não há "minha" vs "da loja" pra escolher: 1 botão só de dispensar o aviso.
                    p2: os dois botões desabilitam durante `salvar.isPending` — um 2º save (deste MESMO conflito ou
                    de um clique seguinte) pode estar em voo; clicar "usar a da loja" nesse intervalo não pode
                    disputar com o `setEd` que o onError desse 2º save fizer ao resolver (ver o comentário do
                    onError acima sobre o updater funcional). */}
                {ed !== null ? (
                  <>
                    <Button type="button" variant="outline" size="sm" disabled={salvar.isPending} onClick={() => { definirEd(null); setConflito(null); }}>usar a da loja</Button>
                    <Button type="button" variant="ghost" size="sm" disabled={salvar.isPending} onClick={() => setConflito(null)}>manter a minha</Button>
                  </>
                ) : (
                  <Button type="button" variant="ghost" size="sm" disabled={salvar.isPending} onClick={() => setConflito(null)}>Entendi</Button>
                )}
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
                    <StatusBadge tone={c.layout ? "neutral" : c.obrigatorio ? "info" : "warning"}>{c.layout ? "layout" : c.obrigatorio ? "opcional" : "não obrigatório"}</StatusBadge>
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
                  definirEd((e) => aplicarToggle(e, servidor, q.data!.rev, tenantId, alerta, false));
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
