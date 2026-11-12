import { useMemo, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { SortableListCard } from "@/components/admin/SortableListCard";
import { RequisitosStatusButton, type CatalogoRequisitos } from "@/components/admin/RequisitosStatusDialog";
import { KanbanAutomaticoBloco, type KanbanChaveApi, type KanbanChaveTextos } from "@/components/admin/KanbanAutomaticoDialog";
import { ModoColunaBadge } from "@/components/admin/ModoColunaBadge";
import { CONDICOES_PL } from "@/lib/etapas-pl-condicoes";
import { fluxoEtapasPl } from "@/lib/etapas-pl-config";
import {
  CONDICOES_ENTRADA_PL, aplicarMudancaBoardPl, condicoesIndisponiveisPl, rotulosComChaveRepetidaPl,
} from "@/lib/etapas-pl-edicao";
import { etapasPlDefinirAutomatico, etapasPlPreviaRestauracao, etapasPlRestaurar } from "@/lib/etapas-pl-rpc";
import { requisitosHerdados } from "@/lib/kanban-condicoes";
import { MOTIVO_REPROVADO_MANUAL, modoColuna } from "@/lib/kanban-auto-ui";
import { normalizeKanbanStatuses, resolveStatusKey } from "@/lib/kanban-status";

/**
 * CONFIG DA LOJA — card "Etapas PL" (Kanban PL configurável, Onda 3 / Task 7).
 *
 * Edita as colunas do quadro de Etapas (`etapas_pl_kanban`, labels: adicionar/remover/renomear/reordenar), os REQUISITOS de
 * entrada de cada coluna (`etapas_pl_requisitos`, catálogo `CONDICOES_PL`) e a CHAVE do modo automático (`etapas_pl_automatico`,
 * só pelas RPCs PL com prévia de restauração). Reusa os componentes do kanban do Dev (`SortableListCard`,
 * `RequisitosStatusButton`, `KanbanAutomaticoBloco`, `ModoColunaBadge`) — o "Status do Kanban" é o gabarito.
 *
 * Controlado: colunas/requisitos vão e voltam pelo rascunho da página (`onChange`/`onRequisitosChange`), que grava pelo Salvar
 * colaborativo (`salvar_config_loja`, as colunas `etapas_pl_kanban`/`etapas_pl_requisitos` entram no diff normal). A chave NÃO
 * passa por ali: o gatilho do banco ignora a mudança de `etapas_pl_automatico` vinda do cliente; só a RPC liga/desliga.
 *
 * Regras:
 *  - A 1ª coluna é a PORTA DE ENTRADA (ruling do controlador): só oferece as condições de ENTRADA (`CONDICOES_ENTRADA_PL`:
 *    Tem peça teste / Enviado a Serviços). As demais colunas mostram o catálogo PL inteiro. Usa `condsIndisponiveis` do
 *    `RequisitosStatusDialog` (esmaecidas, com selo); uma condição fora da lista JÁ gravada na 1ª coluna continua removível.
 *  - Renomear uma coluna MIGRA o requisito dela (a key vem do label) — `aplicarMudancaBoardPl`. Sem isso renomear a porta de
 *    entrada apagaria a condição e ninguém mais entraria no quadro.
 *  - Sem prévia de LIGAR (não existe RPC de prévia no PL): o diálogo explica e o número de cards movidos vem no retorno de
 *    `etapas_pl_definir_automatico`. Board salvo vazio = ligar recusado (o switch trava com o motivo; o servidor também recusa).
 *  - Foco do diálogo de requisitos = `cfg:etapas_pl_requisitos` (mapeado ao bloco `cfg:etapas_pl` na página — Task 6).
 */

/** RPCs da chave do PL (contrato do diálogo): SEM `previaLigar` — o Etapas PL não tem prévia de ligar. */
const API_ETAPAS_PL: KanbanChaveApi = {
  prefixoQuery: "etapas-pl",
  definir: etapasPlDefinirAutomatico,
  previaRestauracao: () => etapasPlPreviaRestauracao(null),
  restaurar: etapasPlRestaurar,
};

const TEXTOS_ETAPAS_PL: KanbanChaveTextos = {
  nome: "kanban automático das etapas",
  descLigarSemPrevia:
    "Os produtos passam a andar sozinhos entre as colunas conforme os dados salvos (peça teste, serviços, CQ…). Cada produto é reposicionado agora e o número que mudou de coluna aparece ao concluir. As colunas de hoje ficam guardadas: ao desligar, dá para voltar a elas.",
  descDesligar:
    "Os produtos param onde estão e o quadro de Etapas volta a funcionar à mão: a mudança de coluna é arrastada (ou pelo “Mover para…”), com a trava de requisitos.",
  blocoLigado: (
    <>
      Ligado, os produtos andam sozinhos entre as colunas conforme os dados salvos. Coluna{" "}
      <span className="font-semibold text-foreground">com requisito</span> = automática (em cascata: só entra quem cumpre esta e todas as
      anteriores). Coluna <span className="font-semibold text-foreground">sem requisito</span> = manual: o produto entra e sai dela arrastado.
    </>
  ),
  blocoDesligado: "Desligado: o produto muda de coluna arrastado, com a trava de requisitos. Os requisitos valem só na tela.",
  indisponivel: "Ainda não disponível nesta loja — aguarda a atualização do banco.",
};

/** Um único grupo (o catálogo PL é de produção): o diálogo abre já expandido. */
const CATALOGO_PL: CatalogoRequisitos = {
  modulos: [{ key: "pl", label: "Condições de produção" }],
  condicoes: CONDICOES_PL.map((c) => ({ ...c, modulo: "pl" })),
};
const KEYS_PL = CONDICOES_PL.map((c) => c.key);
const MOTIVO_SO_ENTRADA = "A porta de entrada só aceita condições de entrada (Tem peça teste ou Enviado a Serviços).";

export type EtapasPlConfigCardProps = {
  /** Colunas do rascunho (labels). */
  board: string[];
  /** Requisitos do rascunho, por key da coluna. */
  requisitos: Record<string, string[]>;
  /** Colunas mudaram (arrastar/renomear/adicionar/excluir): devolve o board E os requisitos já migrados (um único `setCfg`). */
  onChange: (next: { board: string[]; requisitos: Record<string, string[]> }) => void;
  /** Só os requisitos mudaram (botão "Requisitos" de uma coluna). */
  onRequisitosChange: (next: Record<string, string[]>) => void;
  /** Valor da chave no BANCO (`etapas_pl_automatico`) — nunca o rascunho. */
  ligado: boolean;
  /** Colunas GRAVADAS no banco: rótulos dos diálogos e condição de "tem board" para ligar. */
  boardSalvo: string[];
  /** A coluna `etapas_pl_automatico` existe na loja (migrations aplicadas). */
  disponivel: boolean;
  /** Há alterações não salvas na página: trava ligar/desligar (a RPC age sobre o que está GRAVADO). */
  dirty: boolean;
  timezone: string;
  /** Depois de ligar/desligar/restaurar: a página invalida a config da loja e os quadros. */
  onMudou: () => void;
  /** Anel de presença/conflito da página (`cfg:etapas_pl`). */
  anelConflito?: (path: string) => string;
};

export function EtapasPlConfigCard({
  board, requisitos, onChange, onRequisitosChange, ligado, boardSalvo, disponivel, dirty, timezone, onMudou, anelConflito,
}: EtapasPlConfigCardProps) {
  // Onde cada coluna renomeada "veio" enquanto o label está vazio (digitação tecla a tecla) — ver `aplicarMudancaBoardPl`.
  const origemRef = useRef<Record<number, string>>({});

  const fluxoKeys = useMemo(() => fluxoEtapasPl({ board, requisitos, automatico: ligado }), [board, requisitos, ligado]);
  const ordemKeys = useMemo(() => board.map(resolveStatusKey), [board]);
  const colsSalvas = useMemo(() => (boardSalvo.length > 0 ? normalizeKanbanStatuses(boardSalvo) : []), [boardSalvo]);
  const repetidos = useMemo(() => rotulosComChaveRepetidaPl(board), [board]);

  const mudarBoard = (depois: string[]) => {
    const r = aplicarMudancaBoardPl(board, depois, requisitos, origemRef.current);
    origemRef.current = r.origem;
    onChange({ board: depois, requisitos: r.requisitos });
  };

  const travadoMotivo = dirty
    ? "Salve ou descarte as alterações desta página antes de ligar ou desligar o kanban automático das etapas."
    : !ligado && boardSalvo.length === 0
      ? "Adicione as colunas e salve antes de ligar o kanban automático das etapas."
      : null;

  return (
    <div data-colab-path="cfg:etapas_pl" data-testid="etapas-pl-config-card" className={anelConflito ? anelConflito("cfg:etapas_pl") : undefined}>
      <SortableListCard
        title="Etapas PL"
        description="Colunas do quadro de Etapas (PCP). A 1ª coluna é a porta de entrada: o produto entra nela ao cumprir a condição de entrada. Em cada coluna, defina os Requisitos para ENTRAR nela; coluna sem requisito é manual. Renomear uma coluna mantém os requisitos dela."
        items={board}
        onChange={mudarBoard}
        placeholder="Ex: Em Produção"
        topo={
          <KanbanAutomaticoBloco
            ligado={ligado}
            disponivel={disponivel}
            travadoMotivo={travadoMotivo}
            cols={colsSalvas}
            timezone={timezone}
            onMudou={onMudou}
            api={API_ETAPAS_PL}
            textos={TEXTOS_ETAPAS_PL}
          />
        }
        renderItemExtra={(label, index) => {
          const key = resolveStatusKey(label);
          const primeira = index === 0;
          const reqsDaColuna = requisitos[key] ?? [];
          return (
            <>
              {primeira && (
                <span
                  data-testid="etapas-pl-porta-entrada"
                  title={MOTIVO_SO_ENTRADA}
                  className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  porta de entrada
                </span>
              )}
              {ligado && <ModoColunaBadge modo={modoColuna(key, fluxoKeys, requisitos)} />}
              <RequisitosStatusButton
                label={label}
                bloqueadoMotivo={ligado && key === "reprovado" ? MOTIVO_REPROVADO_MANUAL : undefined}
                requisitos={reqsDaColuna}
                onChange={(next) => {
                  const mapa = { ...requisitos };
                  if (next.length) mapa[key] = next; else delete mapa[key];
                  onRequisitosChange(mapa);
                }}
                herdados={requisitosHerdados(key, ordemKeys, requisitos)}
                nomeEtapa={(sk) => board.find((l) => resolveStatusKey(l) === sk) ?? sk}
                catalogo={CATALOGO_PL}
                condsIndisponiveis={condicoesIndisponiveisPl(primeira, KEYS_PL, reqsDaColuna)}
                rotuloIndisponivel="só entrada"
                motivoIndisponivel={MOTIVO_SO_ENTRADA}
                colabPath="cfg:etapas_pl_requisitos"
              />
            </>
          );
        }}
        footer={
          <div className="space-y-1.5 border-t pt-3 text-xs text-muted-foreground">
            <p>
              Na porta de entrada só valem as condições de entrada ({CONDICOES_ENTRADA_PL.map((k) => CONDICOES_PL.find((c) => c.key === k)?.label ?? k).join(" ou ")}).
              Mudar os requisitos da 1ª coluna não reavalia produtos que já estão fora do quadro.
            </p>
            {ligado && (
              <p className="flex items-start gap-1.5 text-[var(--tone-warning-fg)]" data-testid="etapas-pl-aviso-ligado">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Com o kanban automático ligado, salvar mudança de colunas ou requisitos reposiciona os produtos na hora (as colunas de antes ficam guardadas).
              </p>
            )}
            {board.length === 0 && (
              <p className="flex items-start gap-1.5 text-[var(--tone-warning-fg)]" data-testid="etapas-pl-aviso-vazio">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Sem colunas, o quadro de Etapas fica inativo e não dá para ligar o kanban automático.
              </p>
            )}
            {repetidos.length > 0 && (
              <p className="flex items-start gap-1.5 text-[var(--tone-warning-fg)]" data-testid="etapas-pl-aviso-repetido">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {repetidos.length === 1 ? "A coluna" : "As colunas"} {repetidos.map((l) => `“${l}”`).join(", ")} {repetidos.length === 1 ? "tem" : "têm"} o mesmo nome de outra e será ignorada.
              </p>
            )}
          </div>
        }
      />
    </div>
  );
}
