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
import { useEffect, useState } from "react";
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
  TEXTO_CONFIG_API, TEXTO_REVOGAR, entregaAcesso, fmtData, lerAcessos, lerChaves, rotuloChaveAcesso, statusAcesso,
  textoForaRecomendado, type Chave,
} from "@/lib/integracao/api-tela";
import {
  CHAVES_CONFIG_API, CONFIG_API, TEXTO_ALERTA_PAGINA_PLANO_GRATUITO, TEXTO_SO_SUPER, alertaPaginaPlanoGratuito, validarConfigApi,
  type ChaveConfigApi,
} from "@/lib/integracao/campos";
import { fmtDataHora } from "@/lib/integracao/produtos";
import { useAbaSuja } from "./guard";
import { chaveConfig, invalidarIntegracao, useIntegracaoConfig } from "./useIntegracao";
import { NovaChaveDialog } from "./NovaChaveDialog";

type Valores = Record<ChaveConfigApi, number>;

function Chaves() {
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
      const { error } = await supabase.rpc("integracao_chave_revogar" as any, { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Chave revogada.");
      setRevogar(null);
      void qc.invalidateQueries({ queryKey: ["integracao-chaves", tenantId] });
      invalidarIntegracao(qc, tenantId);
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível revogar a chave.")),
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
                  <td className="px-3 py-2 font-mono text-xs">···· {k.final}</td>
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
      {nova && <NovaChaveDialog onFechar={() => setNova(false)} />}
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
 *  (Salvar com sucesso ou os valores voltarem a bater com o servidor). MESMO padrão de `Edicao` em `CamposAba.tsx`. */
type Edicao = { vals: Valores; base: Valores; rev: number };

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

function Configuracoes({ ativo }: { ativo: boolean }) {
  const router = useRouter();
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const q = useIntegracaoConfig();
  const [ed, setEd] = useState<Edicao | null>(null);
  const [alerta, setAlerta] = useState<ChaveConfigApi[] | null>(null);
  const [conflito, setConflito] = useState<string | null>(null);
  const servidor = q.data?.api ?? null;
  const vals = ed?.vals ?? servidor;
  const sujo = ed !== null && !igual(ed.vals, ed.base);
  useAbaSuja("api", sujo);
  const v = vals ? validarConfigApi(vals) : { erros: {}, foraRecomendado: [] as ChaveConfigApi[] };
  const temErro = Object.keys(v.erros).length > 0;
  const salvar = useMutation({
    mutationFn: async () => {
      // ed sempre não-nulo aqui: o botão Salvar só habilita com `sujo` (que exige ed !== null).
      const { error } = await supabase.rpc("integracao_salvar_config_api" as any, { _valores: ed!.vals, _rev: ed!.rev });
      if (error) throw error;
    },
    onSuccess: async () => {
      setAlerta(null);
      setConflito(null);
      // Espera o config fresco chegar ANTES de limpar `ed` — mesma lição do m2 de `CamposAba.tsx`: sem isso os
      // campos piscariam de volta pro estado pré-Salvar por um instante.
      await qc.refetchQueries({ queryKey: chaveConfig(tenantId) });
      setEd(null);
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
      if (!ed) return; // fail-safe: não deveria acontecer (Salvar só habilita com ed !== null).
      const fresco = r.data.api;
      const baseAntiga = ed.base;
      const rebaseado = rebasear(ed, fresco);
      const nadaRestou = igual(rebaseado, fresco);
      const mensagem = igual(baseAntiga, fresco)
        ? "A configuração foi salva por outra pessoa enquanto você editava; as suas mudanças continuam aqui."
        : nadaRestou
          ? "Outra pessoa já salvou exatamente a mudança que você fez — não sobrou nada para salvar."
          : "Outra pessoa mudou as configurações da API — as suas mudanças foram mantidas por cima da versão nova.";
      setConflito(mensagem);
      setEd(nadaRestou ? null : { vals: rebaseado, base: fresco, rev: r.data.rev });
      toast.error(mensagem);
    },
  });
  const mudarValor = (k: ChaveConfigApi, novo: number) => {
    setEd((e) => {
      const base = e?.base ?? servidor;
      if (!base) return e;
      const novosVals = { ...(e?.vals ?? servidor ?? base), [k]: novo };
      if (igual(novosVals, base)) return null;
      return { vals: novosVals, base, rev: e?.rev ?? q.data!.rev };
    });
  };
  const pedirSalvar = () => {
    if (v.foraRecomendado.length > 0) setAlerta(v.foraRecomendado);
    else salvar.mutate();
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{TEXTO_CONFIG_API}</p>
      {conflito !== null && (
        <div className="space-y-2 rounded-md border border-[var(--tone-warning-fg)] bg-[var(--tone-warning-bg)] p-3 text-sm">
          <p>{conflito}</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConflito(null)}>Entendi</Button>
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
      <AlertDialog open={alerta !== null} onOpenChange={(o) => { if (!o && !salvar.isPending) setAlerta(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fora do recomendado</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {(alerta ?? []).map((k) => <p key={k}><strong>{CONFIG_API[k].rotuloCurto}:</strong> {textoForaRecomendado(k)}</p>)}
                {vals && alertaPaginaPlanoGratuito(vals.max_por_pagina) && <p><strong>Plano gratuito:</strong> {TEXTO_ALERTA_PAGINA_PLANO_GRATUITO}</p>}
                <p>Salvar mesmo assim?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={salvar.isPending} onClick={() => {
              setEd((e) => {
                const base = e?.base ?? servidor;
                if (!base) return e;
                const novosVals = { ...(e?.vals ?? servidor ?? base) };
                for (const k of alerta ?? []) novosVals[k] = CONFIG_API[k].recomendado;
                if (igual(novosVals, base)) return null;
                return { vals: novosVals, base, rev: e?.rev ?? q.data!.rev };
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
  return (
    <div className="space-y-4">
      <p className="rounded-md bg-[var(--tone-info-bg)] p-3 text-sm text-[var(--tone-info-fg)]">{TEXTO_SO_SUPER}</p>
      <Tabs value={sub} onValueChange={setSub}>
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="chaves">Chaves</TabsTrigger>
          <TabsTrigger value="acessos">Acessos recentes</TabsTrigger>
          <TabsTrigger value="config">Configurações da API</TabsTrigger>
        </TabsList>
        <TabsContent value="chaves" className="mt-4"><Chaves /></TabsContent>
        <TabsContent value="acessos" className="mt-4"><Acessos /></TabsContent>
        <TabsContent value="config" className="mt-4" forceMount hidden={sub !== "config"}><Configuracoes ativo={sub === "config"} /></TabsContent>
      </Tabs>
    </div>
  );
}
