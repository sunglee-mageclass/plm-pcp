import { useRef } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DateField } from "@/components/shared/DateField";
import { ModeloResumoFoto } from "@/components/shared/ModeloResumoFoto";
import { ImagePreview } from "@/components/shared/ImagePreview";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { EtapaCard, EtapaCardBloco, EtapaCardPecaTeste } from "@/lib/pcp-etapas-kanban";
import { ServicoAtrasoBadge } from "@/components/shared/ServicoAtrasoBadge";
import { atrasoServico, atrasoPecaFoto } from "@/lib/servico-atraso";
import { todayISOInStoreTZ } from "@/lib/timezone";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { useSalvarEtapaRapida, type CampoRapido } from "./useSalvarEtapaRapida";

// Card rico do kanban de Etapas PL (Fase 2, Task 4). 2 tipos de card (R9):
// - BLOCO de serviço PL (`tipo: "bloco"`, depois da Explosão): edição rápida só onde a etapa AVANÇA por um campo do bloco —
//   separacao: Data Enviado; retorno_grade / oficina / finalizacao: READ-ONLY (vêm da grade detalhada/recebimento — editar no
//   sheet do PCP; aqui só mostra progresso resumido). Cada onChange dispara `salvarCampo` (useSalvarEtapaRapida) — grava e
//   ressincroniza com o sheet do PCP via invalidação de `["etapas-cards"]` + `["producao-terc-list"]`.
// - PEÇA TESTE (`tipo: "peca_teste"`, 1 por produto, vem do card do produto): SEM edição rápida — mostra "em teste · saída dd/mm" ou
//   o selo verde "Aprovada — aguardando Explosão"; o clique abre o Sheet do PLANEJAMENTO (onde a seção Peça Teste se edita), só para
//   quem tem acesso a esse Sheet.
function progressoRetornoGrade(gd: EtapaCardBloco["bloco"]["grade_detalhe"]): string {
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

export function CampoRapidoEtapa({ card }: { card: EtapaCardBloco }) {
  const salvar = useSalvarEtapaRapida();

  // Último valor mandado gravar por campo: Enter seguido de blur (ao desabilitar o input) não grava
  // duas vezes; ao terminar (ok ou erro) libera — no erro, redigitar a mesma data tenta de novo.
  const ultimo = useRef<Partial<Record<CampoRapido, string>>>({});
  const onChange = (campo: CampoRapido, valor: string | null) => {
    ultimo.current[campo] = valor ?? "";
    salvar.mutate(
      { card, campo, valor },
      {
        onSettled: () => { delete ultimo.current[campo]; }, // sucesso: o valor do card já é o novo; erro: libera a nova tentativa
        onError: (e) => toast.error(mensagemErro(e, "Erro ao salvar")),
      },
    );
  };
  const commitData = (campo: CampoRapido, atual: string | null, iso: string) => {
    if (iso === (atual ?? "") || ultimo.current[campo] === iso) return;
    onChange(campo, iso || null);
  };

  const { bloco, etapa } = card;

  // [R9] a Peça Teste não se edita aqui (nem no bloco): vive no card do produto. Só aparece num bloco se a Peça Teste for a ÚNICA etapa ativa.
  if (etapa === "peca_teste") {
    return <p className="text-xs text-muted-foreground">A peça teste é acompanhada no card do produto (Planejamento).</p>;
  }

  if (etapa === "separacao") {
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <Label className="text-[11px] text-muted-foreground">Data Enviado</Label>
        <DateField
          value={bloco.data_enviado ?? ""}
          onCommit={(iso) => commitData("data_enviado", bloco.data_enviado, iso)}
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

/** "2026-10-05" → "05/10" (dia/mês). Valor fora do formato = devolve como veio. */
function ddmm(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}` : iso;
}

/** Texto do `title` quando a pessoa não tem acesso ao Sheet do Planejamento (card PT não clicável). */
export const TITULO_SEM_ACESSO_PRODUTO = "Abra pelo Planejamento de Produto (sem acesso ao card)";

function EtapaCardPecaTesteView({
  card,
  minimized,
  onToggleMin,
  onAbrirProduto,
}: {
  card: EtapaCardPecaTeste;
  minimized: boolean;
  onToggleMin: () => void;
  onAbrirProduto?: (modeloId: string) => void;
}) {
  const { pecaTeste: pt } = card;
  const abrir = onAbrirProduto ? () => onAbrirProduto(card.modeloId) : null;
  const identificacao = (
    <>
      <p className="truncate font-semibold">{card.ref ?? "—"}</p>
      <p className="truncate text-muted-foreground">{card.nome ?? "—"}</p>
      {card.empresa && <p className="truncate text-xs text-muted-foreground">{card.empresa}</p>}
    </>
  );
  return (
    <div
      className={`w-full rounded-md border bg-card p-2.5 text-left text-sm shadow-sm transition-colors ${abrir ? "hover:border-primary/50" : ""}`}
      title={abrir ? undefined : TITULO_SEM_ACESSO_PRODUTO}
      data-card-tipo="peca_teste"
    >
      <div className="flex items-start gap-2">
        <CardFoto card={card} />
        <div className="min-w-0 flex-1">
          {abrir ? (
            <button type="button" onClick={abrir} className="block w-full min-w-0 text-left">{identificacao}</button>
          ) : (
            <div className="min-w-0 cursor-default" aria-disabled="true">{identificacao}</div>
          )}
          <div className="mt-1.5">
            {pt.status === "aprovada" ? (
              <StatusBadge tone="success" className="h-auto whitespace-normal leading-tight">Aprovada — aguardando Explosão</StatusBadge>
            ) : (
              <StatusBadge tone="info" className="h-auto whitespace-normal leading-tight">
                Em teste{pt.dataSaida ? ` · saída ${ddmm(pt.dataSaida)}` : ""}
              </StatusBadge>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          {abrir && (
            <Button
              type="button"
              variant="ghost"
              size="iconSm"
              title="Abrir o card do produto"
              onClick={(e) => {
                e.stopPropagation();
                abrir();
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
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
            {minimized ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {!minimized && pt.servicos.length > 0 && (
        <ul className="mt-2.5 space-y-0.5 border-t pt-2.5 text-xs text-muted-foreground">
          {pt.servicos.map((sv) => (
            <li key={sv} className="truncate">{sv}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EtapaCardView({
  card,
  minimized,
  onToggleMin,
  onAbrir,
  onAbrirProduto,
}: {
  card: EtapaCard;
  minimized: boolean;
  onToggleMin: () => void;
  /** Abre o Sheet de PCP › Serviços do produto (cards de bloco). */
  onAbrir: (modeloId: string) => void;
  /** Abre o Sheet do Planejamento (card da coluna Peça Teste). `undefined` = sem acesso: o card não é clicável. */
  onAbrirProduto?: (modeloId: string) => void;
}) {
  if (card.tipo === "peca_teste") {
    return <EtapaCardPecaTesteView card={card} minimized={minimized} onToggleMin={onToggleMin} onAbrirProduto={onAbrirProduto} />;
  }
  return <EtapaCardBlocoView card={card} minimized={minimized} onToggleMin={onToggleMin} onAbrir={onAbrir} />;
}

function EtapaCardBlocoView({
  card,
  minimized,
  onToggleMin,
  onAbrir,
}: {
  card: EtapaCardBloco;
  minimized: boolean;
  onToggleMin: () => void;
  onAbrir: (modeloId: string) => void;
}) {
  // [urg R5] alertas de atraso: "hoje" no fuso da loja; o card só traz os prazos crus.
  const hoje = todayISOInStoreTZ(useStoreTimezone());
  const atrasoSrv = atrasoServico(card.prazos, hoje);
  const atrasoFoto = atrasoPecaFoto(card.prazos, hoje);
  return (
    <div className="w-full rounded-md border bg-card p-2.5 text-left text-sm shadow-sm transition-colors hover:border-primary/50">
      <div className="flex items-start gap-2">
        <CardFoto card={card} />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => onAbrir(card.modeloId)} className="block w-full min-w-0 text-left">
            <p className="truncate font-semibold">{card.ref ?? "—"}</p>
            <p className="truncate text-muted-foreground">{card.nome ?? "—"}</p>
            {card.empresa && <p className="truncate text-xs text-muted-foreground">{card.empresa}</p>}
          </button>
          {(atrasoSrv || atrasoFoto) && (
            <div className="mt-1 flex flex-wrap gap-1">
              <ServicoAtrasoBadge atraso={atrasoSrv} tipo="servico" />
              <ServicoAtrasoBadge atraso={atrasoFoto} tipo="peca_foto" />
            </div>
          )}
        </div>
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
