import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { Label } from "@/components/ui/label";
import { buscarVersoesFamilia } from "@/lib/versoes-familia-query";
import {
  agruparPorFamilia, carregandoVersoes, chaveConfirmacao, estaNoDestino, fmtDataCriacao, gruposComOutras, podeProsseguir, precisaConfirmar,
  rotuloLocal, type Destino, type GrupoFamilia,
} from "@/lib/versoes-familia";

/**
 * P-152 — aviso de versões existentes (Replicar Plan.Tecido/PA/PI e Duplicar). Componente fino: a lógica está em
 * `@/lib/versoes-familia`. Falha FECHADA: sem a lista (carregando/erro) `podeProsseguir` é false.
 */
export function useVersoesFamilia(modeloIds: string[], enabled: boolean, destino: Destino | null = null) {
  const ids = Array.from(new Set(modeloIds.filter(Boolean))).sort();
  const q = useQuery({
    queryKey: ["versoes-familia", ids.join(",")],
    enabled: enabled && ids.length > 0,
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
    queryFn: () => buscarVersoesFamilia(supabase, ids),
  });
  const grupos: GrupoFamilia[] = q.data ? agruparPorFamilia(q.data, ids) : [];
  const chave = chaveConfirmacao(grupos, destino);
  // A confirmação vale só para ESTA lista: mudou a lista → desmarca (sem efeito, comparando a chave).
  const [marcado, setMarcado] = useState<string | null>(null);
  const confirmado = marcado !== null && marcado === chave;
  const precisa = precisaConfirmar(grupos);
  // Cache NUNCA destrava: só vale o que foi buscado depois de montar (fail-closed).
  const carregando = carregandoVersoes({
    enabled, nIds: ids.length, isPending: q.isPending, isFetching: q.isFetching,
    isFetchedAfterMount: q.isFetchedAfterMount, isError: q.isError,
  });
  const erro = q.isError;
  return {
    grupos, precisa, carregando, erro, confirmado,
    setConfirmado: (v: boolean) => setMarcado(v ? chave : null),
    reset: () => setMarcado(null),
    refazer: () => { void q.refetch(); },
    pronto: podeProsseguir({ carregando, erro, precisa, confirmado }),
  };
}

export type EstadoVersoes = ReturnType<typeof useVersoesFamilia>;

export function VersoesExistentesAviso({ estado, destino }: { estado: EstadoVersoes; destino: Destino | null }) {
  const tz = useStoreTimezone();
  const idCheck = useId();
  const { grupos, precisa, carregando, erro, confirmado, setConfirmado, refazer } = estado;

  if (carregando) return <p className="text-xs text-muted-foreground" role="status">Conferindo versões existentes…</p>;

  if (erro) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm" role="alert">
        <span>Não foi possível conferir as versões existentes. Sem essa conferência não dá para continuar.</span>
        <Button type="button" size="sm" variant="outline" onClick={refazer}>Tentar de novo</Button>
      </div>
    );
  }

  if (!precisa) return null;

  const comOutras = gruposComOutras(grupos);
  const semOutras = grupos.length - comOutras.length;

  return (
    <div
      className="space-y-2 rounded-md border border-[var(--warning)] bg-[var(--tone-warning-bg)] px-3 py-2 text-sm text-[var(--tone-warning-fg)]"
    >
      <div className="flex items-start gap-2 font-medium">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Já existem outras versões destes produtos</span>
      </div>
      <ul className="max-h-48 space-y-2 overflow-auto pr-1 text-xs">
        {comOutras.map((g) => (
          <li key={g.raiz}>
            <div className="break-words font-semibold">{g.nome}</div>
            <ul className="mt-0.5 space-y-0.5">
              {g.versoes.map((v) => (
                <li key={v.id} className="flex flex-wrap gap-x-1">
                  <span className="font-medium">v{v.versao ?? 1}</span>
                  <span>· {rotuloLocal(v)}</span>
                  <span>· criada em {fmtDataCriacao(v.created_at, tz)}</span>
                  {v.nome !== g.nome && <span className="break-words">· {v.nome}</span>}
                  {v.ehSelecionado && <span className="font-semibold">(este)</span>}
                  {estaNoDestino(v, destino) && <span className="font-semibold">· no destino</span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {semOutras > 0 && <p className="text-xs">{semOutras} card(s) sem outras versões.</p>}
      <div className="flex items-center gap-2 pt-1">
        <Checkbox id={idCheck} checked={confirmado} onCheckedChange={(c) => setConfirmado(c === true)} />
        <Label htmlFor={idCheck} className="cursor-pointer text-sm font-normal">
          Sei que já existe — criar mesmo assim
        </Label>
      </div>
    </div>
  );
}
