import { useId, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { DateField } from "@/components/shared/DateField";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { todayISOInStoreTZ } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import {
  COLUNA_PARCELA_POR_FAMILIA, DICA_CAMPO_NOTA, ROTULO_DATA_NOTA, TEXTO_PARCELA_PROVISORIA, TITULO_BOLINHA,
  textoAvisoFaltaNota, validarDataNota, type FamiliaOc,
} from "@/lib/nota-entrada";

/**
 * Peças de tela da "Data da Nota de Entrada" (spec 2026-09-24 §5). Regras em `@/lib/nota-entrada` — aqui só apresentação.
 * Cor SÓ por token de tom (§Q9): `--tone-warning-*` e `bg-warning` — nada de hex/hsl solto (anti-drift).
 */

/** Campo do cabeçalho das 5 OCs. SEMPRE `<DateField>` (dd/mm/aaaa na tela, ISO por baixo) — nunca o input nativo de data.
 *  O calendário não oferece dia futuro (fuso da loja); a regra completa (D7) é validada no Salvar e no banco. */
export function CampoDataNotaEntrada({
  value, onChange, disabled, dica = DICA_CAMPO_NOTA, colabPath = "data_nota_entrada", inputClassName, className, children,
}: {
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  dica?: string;
  colabPath?: string;
  inputClassName?: string;
  className?: string;
  /** Ex.: aviso de conflito colaborativo logo abaixo do campo. */
  children?: ReactNode;
}) {
  const id = useId();
  const hoje = todayISOInStoreTZ(useStoreTimezone());
  return (
    <div className={cn("grid gap-1", className)}>
      <Label htmlFor={id}>{ROTULO_DATA_NOTA}</Label>
      {/* Largura só da data (dono 25/set: "não precisa ser esse width todo") — mesmo teto das datas de entrega. */}
      <DateField
        className="w-full max-w-[200px]"
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        max={hoje}
        data-colab-path={colabPath}
        inputClassName={inputClassName}
        aria-label={ROTULO_DATA_NOTA}
      />
      <p className="text-xs text-muted-foreground">{dica}</p>
      {children}
    </div>
  );
}

/** Validação da data no Salvar (D7): `(nota, dataPedido) => mensagem PT | null`, com "hoje" no fuso da loja. */
export function useValidarDataNota(): (nota: string | null | undefined, dataPedido: string | null | undefined) => string | null {
  const tz = useStoreTimezone();
  return (nota, dataPedido) => validarDataNota(nota, dataPedido, todayISOInStoreTZ(tz));
}

/** Aviso no topo da OC recebida sem a data. Com parcela a pagar: o texto aprovado ("…provisórios"); toda paga ou valor 0:
 *  só "Falta a Data da Nota de Entrada" (D6). Conta as não pagas da OC (mesma régua do banco). */
export function AvisoFaltaNota({ show, familia, ocId }: { show: boolean; familia: FamiliaOc; ocId: string | null | undefined }) {
  const coluna = COLUNA_PARCELA_POR_FAMILIA[familia];
  const { data: temParcelaAPagar } = useQuery({
    queryKey: ["nota-parcelas-a-pagar", familia, ocId],
    enabled: show && !!ocId && !!coluna,
    queryFn: async () => {
      const { count, error } = await (supabase.from("parcelas") as any)
        .select("id", { count: "exact", head: true })
        .eq(coluna, ocId)
        .is("data_pagamento", null)
        .or("status.is.null,status.neq.pago");
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });
  if (!show) return null;
  return (
    <div
      role="status"
      data-qa="aviso-falta-nota"
      className="flex items-start gap-2 rounded-md border border-warning/40 bg-[var(--tone-warning-bg)] px-3 py-2 text-sm text-[var(--tone-warning-fg)]"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{textoAvisoFaltaNota(temParcelaAPagar)}</span>
    </div>
  );
}

/** Bolinha amarela ao lado do nº da OC nas listas. */
export function BolinhaFaltaNota({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      role="img"
      aria-label={TITULO_BOLINHA}
      title={TITULO_BOLINHA}
      data-qa="bolinha-falta-nota"
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-warning"
    />
  );
}

/** Indicação da parcela provisória no Financeiro (lista, agenda, popover do dia, próximas, detalhe). */
export function TagParcelaProvisoria({ show, className }: { show: boolean; className?: string }) {
  if (!show) return null;
  return (
    <span
      data-qa="tag-parcela-provisoria"
      className={cn("flex items-center gap-1 text-[11px] font-medium text-[var(--tone-warning-fg)]", className)}
    >
      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
      {TEXTO_PARCELA_PROVISORIA}
    </span>
  );
}
