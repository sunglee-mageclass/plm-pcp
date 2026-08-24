import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateField } from "@/components/shared/DateField";
import { ModeloResumoFoto } from "@/components/shared/ModeloResumoFoto";
import { ImagePreview } from "@/components/shared/ImagePreview";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { EtapaCard } from "@/lib/pcp-etapas-kanban";
import { useSalvarEtapaRapida, type CampoRapido } from "./useSalvarEtapaRapida";

// Card rico do kanban de Etapas PL (Fase 2, Task 4). Substitui o `CardMinimo` do Task 3 em
// AMBOS os lugares (colunas desktop + lista mobile do EtapasBoard) — mesma estrutura de
// grid/colapso do board, só o conteúdo do card muda.
//
// Edição rápida por etapa (o campo que faz a etapa AVANÇAR — ver `etapaDoBloco`,
// `src/lib/pcp-etapas.ts` — espelha os rótulos de `EtapasPlPanel.tsx` usado no sheet do PCP):
// - peca_teste: Data de Saída + Data de Entrada + Aprovação (Aprovar/Reprovar)
// - separacao: Data Enviado
// - retorno_grade / oficina / finalizacao: READ-ONLY (vêm da grade detalhada/recebimento —
//   editar no sheet do PCP; aqui só mostra progresso resumido)
//
// Cada onChange dispara `salvarCampo` (useSalvarEtapaRapida) — grava e ressincroniza com o
// sheet do PCP via invalidação de `["etapas-cards"]` + `["producao-terc-list"]`. Reprovar faz
// o card sumir do quadro no próximo fetch (montarCards exclui bloco reprovado).
function progressoRetornoGrade(gd: EtapaCard["bloco"]["grade_detalhe"]): string {
  if (!gd) return "Sem grade cortada ainda";
  let total = 0;
  for (const v of Object.values(gd)) for (const c of Object.values(v)) total += c?.cortada ?? 0;
  return total > 0
    ? `${total} peça${total === 1 ? "" : "s"} cortada${total === 1 ? "" : "s"}`
    : "Sem grade cortada ainda";
}

function CardFoto({ card }: { card: EtapaCard }) {
  const path = card.fotoFontes.find(Boolean) ?? null;
  const isPdf = /\.pdf$/i.test(path ?? "");
  const url = useSignedUrl(path, "modelos");
  if (url && !isPdf) {
    return (
      <ImagePreview src={url} alt={card.nome ?? "Foto do modelo"}>
        <ModeloResumoFoto fontes={card.fotoFontes} nome={card.nome} className="h-14 w-14" />
      </ImagePreview>
    );
  }
  return <ModeloResumoFoto fontes={card.fotoFontes} nome={card.nome} className="h-14 w-14" />;
}

function CampoRapidoEtapa({ card }: { card: EtapaCard }) {
  const salvar = useSalvarEtapaRapida();

  const onChange = (campo: CampoRapido, valor: string | null) => {
    salvar.mutate(
      { card, campo, valor },
      { onError: (e) => toast.error(mensagemErro(e, "Erro ao salvar")) },
    );
  };

  const { bloco, etapa } = card;

  if (etapa === "peca_teste") {
    return (
      <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
        <div>
          <Label className="text-[11px] text-muted-foreground">Peça Teste — Saída</Label>
          <DateField
            value={bloco.pt_data_saida ?? ""}
            onChange={(e) => onChange("pt_data_saida", e.target.value || null)}
            disabled={salvar.isPending}
          />
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Peça Teste — Entrada</Label>
          <DateField
            value={bloco.pt_data_entrada ?? ""}
            onChange={(e) => onChange("pt_data_entrada", e.target.value || null)}
            disabled={salvar.isPending}
          />
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Aprovação</Label>
          <Select
            value={bloco.pt_aprovacao ?? ""}
            onValueChange={(v) => onChange("pt_aprovacao", v || null)}
            disabled={salvar.isPending}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="aprovado">Aprovado</SelectItem>
              <SelectItem value="reprovado">Reprovado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  if (etapa === "separacao") {
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <Label className="text-[11px] text-muted-foreground">Data Enviado</Label>
        <DateField
          value={bloco.data_enviado ?? ""}
          onChange={(e) => onChange("data_enviado", e.target.value || null)}
          disabled={salvar.isPending}
        />
      </div>
    );
  }

  // retorno_grade / oficina / finalizacao: sem edição rápida — progresso só-leitura
  // (editar mora no sheet do PCP).
  const progresso =
    etapa === "retorno_grade"
      ? progressoRetornoGrade(bloco.grade_detalhe)
      : etapa === "oficina"
        ? bloco.data_entregue
          ? `Entregue em ${bloco.data_entregue.split("-").reverse().join("/")} · ${bloco.qtd_recebida ?? 0} recebida${(bloco.qtd_recebida ?? 0) === 1 ? "" : "s"}`
          : "Aguardando entrega"
        : "Etapa concluída";

  return <p className="text-xs text-muted-foreground">{progresso}</p>;
}

export function EtapaCardView({
  card,
  minimized,
  onToggleMin,
  onAbrir,
}: {
  card: EtapaCard;
  minimized: boolean;
  onToggleMin: () => void;
  onAbrir: (modeloId: string) => void;
}) {
  return (
    <div className="w-full rounded-md border bg-card p-2.5 text-left text-sm shadow-sm transition-colors hover:border-primary/50">
      <div className="flex items-start gap-2">
        <CardFoto card={card} />
        <button
          type="button"
          onClick={() => onAbrir(card.modeloId)}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate font-semibold">{card.ref ?? "—"}</p>
          <p className="truncate text-muted-foreground">{card.nome ?? "—"}</p>
          {card.empresa && <p className="truncate text-xs text-muted-foreground">{card.empresa}</p>}
        </button>
        <div className="flex shrink-0 flex-col gap-1">
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            title="Abrir"
            onClick={(e) => {
              e.stopPropagation();
              onAbrir(card.modeloId);
            }}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            title={minimized ? "Expandir card" : "Minimizar card"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleMin();
            }}
          >
            {minimized ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {!minimized && (
        <div className="mt-2.5 border-t pt-2.5">
          <CampoRapidoEtapa card={card} />
        </div>
      )}
    </div>
  );
}
