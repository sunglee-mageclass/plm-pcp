// Integração — aba API (SÓ super admin; mockup 7/7b/7c/5b): sub-abas Chaves · Acessos recentes · Configurações da API.
// Configurações: faixa = erro na hora (Salvar desabilitado); fora do recomendado = alerta antes de salvar (v4).
//
// Adaptações do executor sobre o brief da Task 15 (ver task-15-report.md):
// - O brief usava `fmtDataHora` de `@/lib/integracao/produtos` — confirmado que existe lá com a assinatura
//   `fmtDataHora(iso, tz, comAno = false)`; import mantido como no brief.
// - `TEXTO_FECHAR_SEM_COPIAR` é novo em `api-tela.ts` (não estava no brief) — o AlertDialog de fechar sem copiar
//   mora em `NovaChaveDialog`, não aqui.
//
// Concorrência da config da API (carried do T14 review I1/I2 — MESMO padrão de `CamposAba.tsx`, que é o MODELO):
// - O rev da config da API é o MESMO `integracao_config.rev` da aba Campos (RPC compartilhada) — congelado no
//   1º toggle/digitação (nunca `q.data.rev` ao vivo: um refetch em foco no meio da edição não pode virar uma
//   sobrescrita silenciosa da mudança de outra pessoa sem NUNCA dar P0409).
// - No P0409: fecha a confirmação, `await` um refetch de verdade (nunca `useEffect` sobre `q.data`), REBASEIA os
//   valores do usuário (o que ele mudou vs a `base` congelada) em cima dos valores FRESCOS do servidor, troca
//   `base`/`rev` para os frescos, e mostra um banner. Quando SÓ o rev mudou (a aba Campos salvou, mesmo rev
//   compartilhado) usa um texto específico — nunca "suas mudanças foram mantidas" quando não sobrou mudança.
// - Outros erros (rede, P0001, 42501): os valores locais FICAM como estavam; só o toast traduzido.
// - Nenhum P0409 dispara outro mutate sozinho — cada save exige um novo clique em "Salvar mesmo assim"/"Salvar".
// - Os inputs travam durante `salvar.isPending`.
// - Enquanto os valores locais voltam a bater com os do servidor, o rascunho fecha (`ed = null`) e a tela volta a
//   espelhar o servidor ao vivo.
import { useContext, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, KeyRound, Save } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NumberInput } from "@/components/shared/NumberInput";
import { PageActionBar } from "@/components/shared/PageActionBar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { mensagemErro } from "@/lib/erro-mensagem";
import {
  TEXTO_CONFIG_API, TEXTO_CONFIG_API_CONFLITO, TEXTO_CONFIG_API_CONFLITO_NADA_A_SALVAR, TEXTO_CONFIG_API_CONFLITO_SO_REV,
  TEXTO_REVOGAR, diffConfigApi, entregaAcesso, fmtData, lerAcessos, lerChaves, rotuloChaveAcesso, statusAcesso,
  textoForaRecomendado, type Chave,
} from "@/lib/integracao/api-tela";
import {
  CHAVES_CONFIG_API, CONFIG_API, TEXTO_ALERTA_PAGINA_PLANO_GRATUITO, TEXTO_SO_SUPER, alertaPaginaPlanoGratuito, validarConfigApi,
  type ChaveConfigApi,
} from "@/lib/integracao/campos";
import { fmtDataHora } from "@/lib/integracao/produtos";
import { GuardaIntegracaoContext, useAbaSuja } from "./guard";
import { TEXTO_LOJA_MUDOU, chaveConfig, confirmarLojaAtiva, invalidarIntegracao, useIntegracaoConfig } from "./useIntegracao";
import { NovaChaveDialog } from "./NovaChaveDialog";

type Valores = Record<ChaveConfigApi, number>;

function Chaves({ onVisibilidadeChave }: { onVisibilidadeChave: (visivel: boolean) => void }) {
  const tenantId = useActiveTenantId();
  const tz = useStoreTimezone();
  const qc = useQueryClient();
  const [nova, setNova] = useState(false);
  const [revogar, setRevogar] = useState<Chave | null>(null);
  const q = useQuery({
    queryKey: ["integracao-chaves", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("integracao_chaves_listar" as any);
      if (error) throw error;
      return lerChaves(data);
    },
  });
  const rev = useMutation({
    mutationFn: async (id: string) => {
      // revisão T15 #I1-R (code-review "Re-check round 1"): relê a loja ativa DIRETO do servidor imediatamente
      // antes de revogar — a defesa da fix round 1 (comparar `tenantId` do CACHE) não pega uma 2ª aba/janela que
      // trocou de loja no servidor sem que ESTA aba jamais reobservasse a query (`focusManager` só escuta
      // `visibilitychange`, não `focus`). Nada é enviado se divergir.
      await confirmarLojaAtiva(tenantId);
      const { error } = await supabase.rpc("integracao_chave_revogar" as any, { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Chave revogada.");
      setRevogar(null);
      void qc.invalidateQueries({ queryKey: ["integracao-chaves", tenantId] });
      invalidarIntegracao(qc, tenantId);
    },
    // revisão T15 #4/m8 (code review): se outra pessoa já revogou a MESMA chave, o servidor recusa (P0001 "já
    // revogada") e — sem isso — a linha continuava mostrando "Revogar" pra sempre (o cache antigo nunca era
    // atualizado). Invalida a lista MESMO no erro, pra próxima leitura já vir com o estado real do servidor.
    onError: (e) => {
      toast.error(mensagemErro(e, "Não foi possível revogar a chave."));
      void qc.invalidateQueries({ queryKey: ["integracao-chaves", tenantId] });
    },
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">Chaves de API</h3>
        <Button type="button" size="sm" onClick={() => setNova(true)}><KeyRound className="h-4 w-4" />Nova chave</Button>
      </div>
      {q.isError ? <p className="text-sm text-destructive">{mensagemErro(q.error, "Erro ao carregar as chaves.")}</p> : (
        <div className="max-w-full overflow-x-auto rounded-md border">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-2">Nome</th><th className="px-3 py-2">Chave</th><th className="px-3 py-2">Criada por / em</th><th className="px-3 py-2">Último uso</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((k) => (
                <tr key={k.id} className="border-t">
                  <td className="px-3 py-2">{k.nome}</td>
                  {/* revisão T15 (nit "consistência ····"): SEM espaço entre "····" e o final — mesmo formato de
                      `rotuloChaveAcesso` (Acessos/Log), que já mostra `····a1b2`. */}
                  <td className="px-3 py-2 font-mono text-xs">····{k.final}</td>
                  <td className="px-3 py-2">{k.criadaPor} — {fmtData(k.criadaEm, tz)}</td>
                  <td className="px-3 py-2">{k.ultimoUsoEm ? fmtDataHora(k.ultimoUsoEm, tz, true) : "Nunca usada"}</td>
                  <td className="px-3 py-2 text-right">
                    {k.revogadaEm ? <StatusBadge tone="neutral">Revogada</StatusBadge> : (
                      <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={() => setRevogar(k)}>Revogar</Button>
                    )}
                  </td>
                </tr>
              ))}
              {q.data && q.data.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">Nenhuma chave ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Chaves: só o super admin cria/revoga. Guia completo de uso em Manual da API.</p>
      {nova && <NovaChaveDialog onFechar={() => setNova(false)} onVisibilidadeChave={onVisibilidadeChave} />}
      <AlertDialog open={revogar !== null} onOpenChange={(o) => { if (!o && !rev.isPending) setRevogar(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar chave "{revogar?.nome}"?</AlertDialogTitle>
            <AlertDialogDescription>{TEXTO_REVOGAR}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rev.isPending}>Cancelar</AlertDialogCancel>
            <Button type="button" variant="destructive" disabled={rev.isPending} onClick={() => revogar && rev.mutate(revogar.id)}>Revogar chave</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Acessos() {
  const tenantId = useActiveTenantId();
  const tz = useStoreTimezone();
  const q = useQuery({
    queryKey: ["integracao-acessos", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("integracao_acessos_listar" as any, { _limite: 100 });
      if (error) throw error;
      return lerAcessos(data);
    },
  });
  return (
    <div className="space-y-3">
      <h3 className="font-medium">Acessos recentes</h3>
      <p className="text-xs text-muted-foreground">Ordem decrescente (mais recente primeiro).</p>
      {q.isError ? <p className="text-sm text-destructive">{mensagemErro(q.error, "Erro ao carregar os acessos.")}</p> : (
        <div className="max-w-full overflow-x-auto rounded-md border">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-2">Chave</th><th className="px-3 py-2">Quando</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Produtos entregues</th><th className="px-3 py-2">Linhas</th></tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((a) => {
                const st = statusAcesso(a);
                const en = entregaAcesso(a);
                return (
                  <tr key={a.id} className="border-t">
                    <td className="px-3 py-2">{rotuloChaveAcesso(a)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtDataHora(a.quando, tz, true)}</td>
                    <td className="px-3 py-2"><StatusBadge tone={st.tom} className="normal-case tracking-normal">{st.texto}</StatusBadge></td>
                    <td className="px-3 py-2 tabular-nums">{en.produtos}</td>
                    <td className="px-3 py-2 tabular-nums">{en.linhas}</td>
                  </tr>
                );
              })}
              {q.data && q.data.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">Nenhum acesso ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Congela `vals`+`base`+`rev` no instante da 1ª edição — nunca lê `q.data.rev` de novo até o rascunho esvaziar
 *  (Salvar com sucesso ou os valores voltarem a bater com o servidor). MESMO padrão de `Edicao` em `CamposAba.tsx`.
 *  `tenantId` (revisão T15 #1, code-review I1, defesa em profundidade): mesma razão de `CamposAba.tsx` — a página
 *  já remonta por `key={tenantId}` ao trocar de loja, e o mutationFn recusa salvar se o rascunho nasceu numa loja
 *  diferente da CACHEADA atual. ⚠️ Fix round 2 (code-review "Re-check round 1" I1-R): esta checagem só compara
 *  DOIS VALORES DO CLIENTE (o `tenantId` congelado vs o `tenantId` corrente do cache do TanStack Query) — ela NÃO
 *  cobre "qualquer forma futura" de a loja mudar: uma 2ª aba/janela que troca a loja ativa no SERVIDOR nunca
 *  reobserva a query `["active-tenant-id"]` desta aba sozinha (`focusManager` só reage a `visibilitychange`, não
 *  a `focus`), então os dois valores comparados aqui continuam IGUAIS (igualmente desatualizados) mesmo com o
 *  servidor já noutra loja. A defesa REAL contra esse caso é `confirmarLojaAtiva` (`useIntegracao.ts`), chamada
 *  logo antes do `rpc` — relê `users.tenant_id` DIRETO do servidor, bypassando o cache. */
type Edicao = { vals: Valores; base: Valores; rev: number; tenantId: string };

const igual = (a: Valores, b: Valores): boolean => CHAVES_CONFIG_API.every((k) => a[k] === b[k]);

/** Rebaseia o diff do usuário (vs `base` velha) em cima dos valores FRESCOS do servidor: campos que o usuário NÃO
 *  tocou adotam o valor fresco; campos que ele tocou (valor difere da base velha) mantêm o que ele digitou. */
function rebasear(ed: Edicao, fresco: Valores): Valores {
  const out = { ...fresco };
  for (const k of CHAVES_CONFIG_API) {
    if (ed.vals[k] !== ed.base[k]) out[k] = ed.vals[k];
  }
  return out;
}
/** Chaves que o usuário de fato TOCOU nesta edição (valor difere da base congelada) — usado pra restringir o
 *  alerta "Fora do recomendado" e o "Voltar ao recomendado" só ao que ele mudou (revisão T15 #4/m7, code review):
 *  sem isso, um campo que a loja já tinha de propósito fora do recomendado (ex.: `max_por_pagina=200` num plano
 *  pago) entrava no alerta e era revertido em silêncio por um "Voltar ao recomendado" que o usuário pediu para
 *  OUTRO campo. */
function chavesTocadas(ed: Edicao): ChaveConfigApi[] {
  return CHAVES_CONFIG_API.filter((k) => ed.vals[k] !== ed.base[k]);
}

function Configuracoes({ ativo, onSujoChange }: { ativo: boolean; onSujoChange: (sujo: boolean) => void }) {
  const router = useRouter();
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const q = useIntegracaoConfig();
  const [ed, setEd] = useState<Edicao | null>(null);
  // revisão T15 (code-review m7, nit de consistência do fix p2 da CamposAba): espelha `ed` sincronamente — o
  // handler do P0409 (fora de um evento React, dentro de um `await`) lê `edRef.current` em vez do `ed` capturado
  // no fechamento, MESMA razão/MESMO padrão de `CamposAba.tsx:definirEd` (nunca compute algo dentro do updater
  // funcional e leia de volta no mesmo tick — lição "m-S1" da T12b).
  const edRef = useRef<Edicao | null>(null);
  const definirEd = (novo: Edicao | null | ((e: Edicao | null) => Edicao | null)) => {
    setEd((atual) => {
      const prox = typeof novo === "function" ? (novo as (e: Edicao | null) => Edicao | null)(atual) : novo;
      edRef.current = prox;
      return prox;
    });
  };
  const [alerta, setAlerta] = useState<ChaveConfigApi[] | null>(null);
  const [conflito, setConflito] = useState<string | null>(null);
  const servidor = q.data?.api ?? null;
  const vals = ed?.vals ?? servidor;
  const sujo = ed !== null && !igual(ed.vals, ed.base);
  // revisão T15 #2 (task review + code review I2): `useAbaSuja` é por ABA, não por SUB-COMPONENTE — se
  // `Configuracoes` e `NovaChaveDialog` chamassem `useAbaSuja("api", …)` cada um, a última chamada a rodar
  // sobrescreveria a outra. O agregado mora em `ApiAba` (`sujoConfig || chaveVisivel`), que é o ÚNICO lugar que
  // chama `useAbaSuja` — aqui só reporta o próprio "sujo" pro pai via prop.
  useEffect(() => { onSujoChange(sujo); }, [sujo, onSujoChange]);
  const v = vals ? validarConfigApi(vals) : { erros: {}, foraRecomendado: [] as ChaveConfigApi[] };
  const temErro = Object.keys(v.erros).length > 0;
  const salvar = useMutation({
    mutationFn: async () => {
      // ed sempre não-nulo aqui: o botão Salvar só habilita com `sujo` (que exige ed !== null).
      // revisão T15 #1 (code-review I1, defesa em profundidade — CLIENTE vs CLIENTE, ver o comentário de `Edicao`
      // acima): recusa ANTES de qualquer chamada de rede se o rascunho nasceu numa loja diferente da cacheada
      // atual — não deveria acontecer (a página remonta por `key={tenantId}`), mas é a 1ª linha de defesa.
      if (ed!.tenantId !== tenantId) {
        throw Object.assign(new Error(TEXTO_LOJA_MUDOU), { code: "LOJA_MUDOU" });
      }
      // revisão T15 #I1-R (code-review "Re-check round 1"): a defesa acima não pega uma 2ª aba/janela que trocou
      // de loja no SERVIDOR sem que esta aba jamais reobservasse — relê `users.tenant_id` DIRETO do servidor
      // imediatamente antes do save (última linha de defesa real, do lado do cliente).
      await confirmarLojaAtiva(tenantId);
      const { error } = await supabase.rpc("integracao_salvar_config_api" as any, { _valores: ed!.vals, _rev: ed!.rev });
      if (error) throw error;
    },
    onSuccess: async () => {
      setAlerta(null);
      setConflito(null);
      // Espera o config fresco chegar ANTES de limpar `ed` — mesma lição do m2 de `CamposAba.tsx`: sem isso os
      // campos piscariam de volta pro estado pré-Salvar por um instante.
      await qc.refetchQueries({ queryKey: chaveConfig(tenantId) });
      definirEd(null);
      toast.success("Configurações da API salvas.");
      invalidarIntegracao(qc, tenantId);
    },
    onError: async (e) => {
      const code = (e as { code?: string })?.code;
      if (code !== "P0409") {
        setAlerta(null);
        toast.error(mensagemErro(e, "Não foi possível salvar as configurações."));
        return;
      }
      // P0409 conflito_versao: fecha a confirmação, busca a config fresca (AWAITED — nunca um useEffect sobre
      // q.data) e REBASEIA os valores do usuário em cima dela. Nunca chama `mutate` sozinho aqui — evita loop.
      setAlerta(null);
      const r = await q.refetch();
      if (r.isError || !r.data?.api) {
        toast.error("Não foi possível confirmar o valor mais recente (falha de conexão). Tente salvar de novo.");
        return;
      }
      // revisão T15 (mesmo padrão do fix p2 da CamposAba): lê `edRef.current`, não `ed` do fechamento.
      const edAtual = edRef.current;
      if (!edAtual) return; // fail-safe: não deveria acontecer (Salvar só habilita com ed !== null).
      const fresco = r.data.api;
      const baseAntiga = edAtual.base;
      const rebaseado = rebasear(edAtual, fresco);
      const nadaRestou = igual(rebaseado, fresco);
      const somenteRev = igual(baseAntiga, fresco);
      // revisão T15 #3/m1 (task review I1 + code review m5): banner com o MESMO padrão de 3 variantes de
      // `CamposAba.tsx` — inclui o diff do que a OUTRA pessoa mudou (`diffConfigApi`), e nunca afirma "mudanças
      // mantidas" quando não sobrou nada (texto suavizado, sem "exatamente" — mesmo espírito do p1 da T14/T15).
      const diff = diffConfigApi(baseAntiga, fresco);
      const mensagem = somenteRev
        ? TEXTO_CONFIG_API_CONFLITO_SO_REV
        : nadaRestou
          ? diff === "" ? TEXTO_CONFIG_API_CONFLITO_NADA_A_SALVAR : `${TEXTO_CONFIG_API_CONFLITO_NADA_A_SALVAR} Mudou na loja: ${diff}.`
          : `${TEXTO_CONFIG_API_CONFLITO} Mudou na loja: ${diff}.`;
      setConflito(mensagem);
      definirEd(nadaRestou ? null : { vals: rebaseado, base: fresco, rev: r.data.rev, tenantId: edAtual.tenantId });
      toast.error(mensagem);
    },
  });
  const mudarValor = (k: ChaveConfigApi, novo: number) => {
    definirEd((e) => {
      const base = e?.base ?? servidor;
      if (!base) return e;
      const novosVals = { ...(e?.vals ?? servidor ?? base), [k]: novo };
      if (igual(novosVals, base)) return null;
      return { vals: novosVals, base, rev: e?.rev ?? q.data!.rev, tenantId: e?.tenantId ?? tenantId };
    });
  };
  const pedirSalvar = () => {
    // revisão T15 #4/m7 (code review): o alerta (e o "Voltar ao recomendado" que ele oferece) só considera as
    // chaves que o USUÁRIO tocou nesta edição — `v.foraRecomendado` lista TODO campo fora do recomendado, mesmo
    // um que a loja já tinha de propósito (ex.: `max_por_pagina=200` num plano pago) e que o usuário não mexeu;
    // sem essa interseção, "Voltar ao recomendado" revertia esse campo em silêncio.
    const tocadas = ed ? new Set(chavesTocadas(ed)) : new Set<ChaveConfigApi>();
    const foraTocadas = v.foraRecomendado.filter((k) => tocadas.has(k));
    if (foraTocadas.length > 0) setAlerta(foraTocadas);
    else salvar.mutate();
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{TEXTO_CONFIG_API}</p>
      {/* revisão T15 #4/m6 (code review): a config ficava em "Carregando…" pra sempre se a 1ª carga falhasse —
          mesmo padrão P-57 de `CamposAba.tsx` (mensagem + "Tentar de novo"). Sem risco de dado incompleto (o
          Salvar segue desabilitado até `vals` existir). */}
      {q.isError && !q.data ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{mensagemErro(q.error, "Não foi possível carregar as configurações.")}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void q.refetch()}>Tentar de novo</Button>
        </div>
      ) : (
        <>
          {q.isError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <span>{mensagemErro(q.error, "Não foi possível atualizar as configurações.")}</span>
              <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => void q.refetch()}>Tentar de novo</Button>
            </div>
          )}
          {conflito !== null && (
            <div className="space-y-2 rounded-md border border-[var(--tone-warning-fg)] bg-[var(--tone-warning-bg)] p-3 text-sm">
              <p>{conflito}</p>
              <div className="flex flex-wrap gap-2">
                {/* revisão T15 #3 (task review I1): MESMO padrão de CamposAba — com rascunho vivo (`ed !== null`),
                    "usar a da loja" (descarta) e "manter a minha" (só fecha o banner, o rascunho rebaseado já está
                    na tela); sem rascunho (`ed === null`, nada a escolher), 1 botão só. Ambos desabilitam durante
                    um 2º Salvar em voo (mesma razão do p2 da CamposAba). */}
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
          {!vals ? <p className="text-sm text-muted-foreground">Carregando…</p> : (
            <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
              {CHAVES_CONFIG_API.map((k) => {
                const c = CONFIG_API[k];
                const erro = v.erros[k];
                return (
                  <div key={k} className="grid gap-1">
                    <Label htmlFor={`cfg-${k}`}>{c.rotulo}</Label>
                    <NumberInput id={`cfg-${k}`} integer value={vals[k]} aria-invalid={!!erro} disabled={salvar.isPending}
                      onChange={(e) => mudarValor(k, Math.trunc(Number(e.target.value)))} />
                    <p className="text-xs text-muted-foreground">Recomendado: {c.recomendado} · Faixa permitida: {c.min}–{c.max}</p>
                    {erro && <p className="text-xs text-destructive" role="alert">{erro}</p>}
                    {/* P-89 A: acima de 100 por página pode passar dos 10 ms de CPU do plano gratuito do Cloudflare */}
                    {k === "max_por_pagina" && !erro && alertaPaginaPlanoGratuito(vals.max_por_pagina) && (
                      <p className="text-xs text-[var(--tone-warning-fg)]" role="alert">{TEXTO_ALERTA_PAGINA_PLANO_GRATUITO}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      <AlertDialog open={alerta !== null} onOpenChange={(o) => { if (!o && !salvar.isPending) setAlerta(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fora do recomendado</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {(alerta ?? []).map((k) => <p key={k}><strong>{CONFIG_API[k].rotuloCurto}:</strong> {textoForaRecomendado(k)}</p>)}
                {/* revisão T15 (nit "Plano gratuito só se tocado"): `alerta` já vem filtrado só pelas chaves TOCADAS
                    (`pedirSalvar`/`foraTocadas`) — checar `alerta?.includes("max_por_pagina")` em vez de
                    `vals.max_por_pagina` cru evita mostrar este aviso extra quando o campo fora do recomendado é
                    OUTRO (ex.: `limite_por_minuto`) e `max_por_pagina` só está alto porque a loja JÁ tinha um
                    valor de propósito acima de 100 (ex.: plano pago) sem o usuário ter tocado nele agora. */}
                {vals && alerta?.includes("max_por_pagina") && alertaPaginaPlanoGratuito(vals.max_por_pagina) && (
                  <p><strong>Plano gratuito:</strong> {TEXTO_ALERTA_PAGINA_PLANO_GRATUITO}</p>
                )}
                <p>Salvar mesmo assim?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={salvar.isPending} onClick={() => {
              definirEd((e) => {
                const base = e?.base ?? servidor;
                if (!base) return e;
                const novosVals = { ...(e?.vals ?? servidor ?? base) };
                // revisão T15 #4/m7 (code review): `alerta` já vem filtrado só pelas chaves TOCADAS (ver
                // `pedirSalvar`) — reverter todas as chaves de `alerta` para o recomendado nunca mais mexe num
                // campo que o usuário não tocou.
                for (const k of alerta ?? []) novosVals[k] = CONFIG_API[k].recomendado;
                if (igual(novosVals, base)) return null;
                return { vals: novosVals, base, rev: e?.rev ?? q.data!.rev, tenantId: e?.tenantId ?? tenantId };
              });
            }}>Voltar ao recomendado</AlertDialogCancel>
            <Button type="button" disabled={salvar.isPending} onClick={() => salvar.mutate()}>Salvar mesmo assim</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {ativo && (
        <PageActionBar>
          <Button type="button" variant="outline" onClick={() => router.history.back()}><ArrowLeft className="h-4 w-4" />Voltar</Button>
          <Button type="button" className="ml-auto" disabled={!sujo || temErro || salvar.isPending} onClick={pedirSalvar}>
            <Save className="h-4 w-4" />{salvar.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </PageActionBar>
      )}
    </div>
  );
}

export function ApiAba() {
  const [sub, setSub] = useState("chaves");
  // revisão T15 #2 (task review + code review I2): a aba conta como suja tanto com um rascunho de Configurações
  // pendente quanto com uma chave nova ainda VISÍVEL na tela (fechar sem copiar perde o segredo pra sempre — a
  // guarda de navegação da página tem que bloquear Voltar/F5/troca de rota do mesmo jeito que bloqueia um
  // rascunho comum). Os dois estados vêm de baixo via prop; só este componente chama `useAbaSuja`.
  const [sujoConfig, setSujoConfig] = useState(false);
  const [chaveVisivel, setChaveVisivel] = useState(false);
  useAbaSuja("api", sujoConfig || chaveVisivel);
  // revisão T15 (n1, code-review "Re-check round 1"): reporta `chaveVisivel` também pro canal PARALELO
  // `informarChaveVisivel` — a página usa isso pra escolher o toast certo quando o remonte por `key={tenantId}`
  // (troca de loja) destrói uma chave nova AINDA visível/não copiada (ver `IntegracaoPage.tsx`).
  // Fix round 3 T15 (n1-R, code-review "Re-check round 2"): SEM cleanup de desmonte aqui — `IntegracaoPage.tsx`
  // já reseta o próprio ref DEPOIS de ler o valor, no efeito de troca de tenant. Um cleanup que escrevesse
  // `informarChaveVisivel(false)` no desmonte (que o `key={tenantId}` dispara ANTES do efeito `[tenantId]` do
  // pai rodar) zerava o sinal um instante antes do pai conseguir ler "havia uma chave visível" — o toast
  // específico nunca disparava no app real.
  const guardaCtx = useContext(GuardaIntegracaoContext);
  useEffect(() => {
    guardaCtx?.informarChaveVisivel?.(chaveVisivel);
  }, [guardaCtx, chaveVisivel]);
  return (
    <div className="space-y-4">
      <p className="rounded-md bg-[var(--tone-info-bg)] p-3 text-sm text-[var(--tone-info-fg)]">{TEXTO_SO_SUPER}</p>
      <Tabs value={sub} onValueChange={setSub}>
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="chaves">Chaves</TabsTrigger>
          <TabsTrigger value="acessos">Acessos recentes</TabsTrigger>
          <TabsTrigger value="config">Configurações da API</TabsTrigger>
        </TabsList>
        <TabsContent value="chaves" className="mt-4"><Chaves onVisibilidadeChave={setChaveVisivel} /></TabsContent>
        <TabsContent value="acessos" className="mt-4"><Acessos /></TabsContent>
        <TabsContent value="config" className="mt-4" forceMount hidden={sub !== "config"}>
          <Configuracoes ativo={sub === "config"} onSujoChange={setSujoConfig} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
