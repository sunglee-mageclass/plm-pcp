// Integração — colunas Estado e Integrável de uma linha da tabela. Estado: selo (vermelho/âmbar/verde) + "i" com o
// que falta + "⋯" SÓ do super admin no integrado (única ação: Desfazer integração). Integrável: toggle — ligar abre o
// Integrar (resumo + "Tenho certeza"), desligar abre o Voltar; travado mostra o motivo no "i".
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { InfoHover } from "@/components/shared/InfoHover";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { rotuloEstado, textoFaltas, tomEstado, type ProdutoLista } from "@/lib/integracao/produtos";

export function EstadoCelula({ p, tz, superAdmin, onDesfazer }: {
  p: ProdutoLista; tz: string; superAdmin: boolean; onDesfazer: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <StatusBadge tone={tomEstado(p.estado)} className="whitespace-nowrap normal-case tracking-normal">{rotuloEstado(p, tz)}</StatusBadge>
      {p.estado === "nao_integravel" && !p.completo && <InfoHover ariaLabel="O que falta">{textoFaltas(p.faltas)}</InfoHover>}
      {p.estado === "integrado" && superAdmin && (
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="iconSm" className="max-sm:h-11 max-sm:w-11" aria-label="Mais ações (só super admin)">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-1">
            <Button type="button" variant="ghost" className="w-full justify-start text-destructive" onClick={onDesfazer}>
              Desfazer integração
            </Button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export function IntegravelCelula({ p, motivoIntegrar, motivoVoltar, onIntegrar, onVoltar }: {
  p: ProdutoLista; motivoIntegrar: string | null; motivoVoltar: string | null; onIntegrar: () => void; onVoltar: () => void;
}) {
  const ligado = p.estado !== "nao_integravel";
  const motivo = p.estado === "nao_integravel" ? motivoIntegrar
    : p.estado === "integravel" ? motivoVoltar
      : "Integrado — a API já levou. Só o super admin desfaz (⋯ no Estado).";
  return (
    <div className="flex items-center gap-1">
      <Switch checked={ligado} disabled={motivo !== null} aria-label={`Integrável: ${p.raw.nome}`}
        onCheckedChange={(v) => (v ? onIntegrar() : onVoltar())} />
      {motivo && <InfoHover ariaLabel="Por que não muda">{motivo}</InfoHover>}
    </div>
  );
}
