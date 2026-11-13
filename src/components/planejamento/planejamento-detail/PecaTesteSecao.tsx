// Peça Teste (R9, T6; reforma por TIPO nov/2026) — seção "N. Peça Teste" do Sheet do Planejamento e da aba do PCP › Serviços (aparência do
// mockup APROVADO; comportamento = spec da reforma). Uma TRILHA por TIPO de serviço que exige peça teste; cada trilha tem TENTATIVAS
// (Fornecedor da tentativa · Data de saída · Data de entrada · Aprovação) e DOIS contadores no título: "PL — Tentativa 3 (2ª com Oficina X)".
// A tentativa atual é editável; as reprovadas ficam num histórico EDITÁVEL (corrigir, excluir, mudar a decisão — com confirmação). Nada grava
// aqui: o rascunho vive no `usePecaTeste` e vai no Salvar do card. Componente de APRESENTAÇÃO (props), testável em render estático.
import { useId, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronRight, Info, Lock, Plus, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { DateField } from "@/components/shared/DateField";
import { InfoHover } from "@/components/shared/InfoHover";
import { ColabBanner } from "@/components/shared/ColabBanner";
import { useConfirmacao, type PedidoConfirmacao } from "@/components/shared/ConfirmarAcaoDialog";
import { ReadOnlyScope } from "@/components/RequirePermission";
import { Secao } from "@/components/planejamento/planejamento-detail/campos";
import { textoExcluirTentativa, textoReabrirTentativa, textoReprovarTentativa } from "@/lib/confirmacoes-textos";
import { MiniExplosaoBloco } from "@/components/planejamento/planejamento-detail/MiniExplosaoBloco";
import type { MiniApi } from "@/components/planejamento/planejamento-detail/useMiniExplosao";
import type { MiniPT } from "@/lib/peca-teste-mini";
import { cn } from "@/lib/utils";
import type { Conflito } from "@/lib/colab/merge";
import {
  ROTULO_STATUS_TRILHA, TEXTO_APROVAR_MEIO, TEXTO_REABRIR_MEIO, TEXTO_SEM_FORNECEDOR_NO_TIPO, entradaAntesDaSaida, historico, lerPathPT,
  motivoBloqueioMudarDecisao, motivoSemDecisao, pathPT, requisitoDoEstado, rotuloNumeroTentativa, rotuloTentativa, statusTrilha, tentativaAtualPT, textoMotivoSemDecisao,
  vezComFornecedor,
  type AprovacaoPecaTeste, type EstadoPT, type FornecedorOpcaoPT, type TentativaPT, type TrilhaPT,
} from "@/lib/peca-teste";

const SEM_DECISAO = "__sem_decisao__";
const TOM_STATUS: Record<ReturnType<typeof statusTrilha>, StatusTone> = {
  aguardando_saida: "neutral", em_teste: "info", aprovada: "success", reprovada_nova: "danger",
};
const CAMPO_ROTULO: Record<string, string> = {
  empresa_id: "Fornecedor", data_saida: "Data de saída", data_entrada: "Data de entrada", aprovacao: "Aprovação", mini: "Mini explosão", excluir: "Exclusão",
};

export const TEXTO_FORNECEDOR_TRAVADO = "Peça aprovada: fornecedor travado.";
export const TEXTO_DESFAZER_DECISAO = "Volta a tentativa para pendente (editável). A baixa de material já feita não é devolvida: só mudar o “a enviar” e salvar estorna e refaz a baixa.";
export const TEXTO_ENTRADA_ANTES_DA_SAIDA = "A data de entrada está antes da data de saída — confira (não impede de salvar).";
export const TEXTO_SEM_MO_NO_TIPO = "Sem mão de obra deste tipo neste produto: a peça teste fica registrada, mas não trava o kanban.";

const dataBR = (iso: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};

type Patch = { data_saida?: string | null; data_entrada?: string | null };
type PatchHist = Patch & { empresa_id?: string | null; empresa_nome?: string | null };

export function PecaTesteSecao({
  numero, selo, estado, base, somenteLeitura = false, carregando = false, erro = false, onTentarDeNovo,
  linhasNovas = [], conflitos = [], onResolverConflito, historicoAberto = false,
  onEditarAtual, onAprovar, onDesfazer, onReprovar, onTrocarFornecedor, onCorrigir, onExcluir, onMudarDecisao, onAdicionarTrilha,
  mini, onEditarMini, onEditarMiniTentativa, avisos = [], miniAbertaInicial = false, defaultAberta = false,
}: {
  numero?: number;
  selo?: ReactNode;
  /** Estado EFETIVO (o rascunho). */
  estado: EstadoPT | null;
  /** O que o servidor tinha na última leitura (as travas do histórico editável). */
  base: EstadoPT | null;
  /** Sem permissão de EDITAR a seção: tudo só leitura. */
  somenteLeitura?: boolean;
  carregando?: boolean;
  erro?: boolean;
  onTentarDeNovo?: () => void;
  /** Serviços de linhas de M.O. NOVAS (ainda não salvas) cujo tipo exige peça teste e que ainda não têm trilha: "Salve o card para lançar…". */
  linhasNovas?: string[];
  conflitos?: Conflito[];
  /** Estado inicial do "Tentativas anteriores" (colapsável; fechado por padrão — a prop existe para o teste de render estático). */
  historicoAberto?: boolean;
  onResolverConflito?: (path: string, escolha: "meu" | "dele") => void;
  onEditarAtual: (categoriaId: string, patch: Patch) => void;
  onAprovar: (categoriaId: string) => void;
  onDesfazer: (categoriaId: string) => void;
  onReprovar: (categoriaId: string) => void;
  onTrocarFornecedor: (categoriaId: string, empresaId: string | null, empresaNome: string | null) => void;
  /** Histórico editável: corrige datas/fornecedor de uma REPROVADA (por nº). */
  onCorrigir?: (categoriaId: string, numero: number, patch: PatchHist) => void;
  /** Histórico editável: exclui uma tentativa (já confirmado aqui, no AlertDialog); vale ao Salvar. */
  onExcluir?: (categoriaId: string, numero: number) => void;
  /** Histórico editável: muda a decisão de uma tentativa (reprovada → aprovada/pendente). */
  onMudarDecisao?: (categoriaId: string, numero: number, para: AprovacaoPecaTeste) => void;
  /** "Adicionar peça teste": acrescenta a trilha de um tipo de `estado.tipos_adicionar`. Ausente = o botão não aparece. */
  onAdicionarTrilha?: (categoriaId: string) => void;
  /** R11 — mini explosão (1 peça) de cada tentativa. Ausente = a seção fica como na R9 (sem o bloco). */
  mini?: MiniApi;
  onEditarMini?: (categoriaId: string, mini: MiniPT) => void;
  /** R11 — edita a mini de uma tentativa REPROVADA do histórico (por nº); `null` = volta a ficar sem mini. */
  onEditarMiniTentativa?: (categoriaId: string, numero: number, mini: MiniPT | null) => void;
  /** R11 — mudanças alheias adotadas SEM escolha no merge (baixa/estorno feitos por outra pessoa). */
  avisos?: string[];
  /** Estado inicial do colapsável da mini (fechado por padrão; a prop existe para o render estático). */
  miniAbertaInicial?: boolean;
  /** Seção recolhida por padrão (igual às demais do Sheet, decisão do dono 03/nov); a prop existe para o render estático dos testes. */
  defaultAberta?: boolean;
}) {
  const { pedir, dialog } = useConfirmacao();
  const trilhas = estado?.trilhas ?? [];
  const baseDe = (categoriaId: string) => base?.trilhas.find((t) => t.categoria_id === categoriaId);
  const req = requisitoDoEstado(estado ?? { trilhas: [] });
  const rotuloConflito = (path: string) => {
    const p = lerPathPT(path);
    if (!p) return path;
    const t = trilhas.find((x) => x.categoria_id === p.categoria);
    const campo = CAMPO_ROTULO[p.campo] ?? p.campo;
    return `Peça Teste${t ? ` — ${t.categoria_nome}` : ""}${p.numero ? ` (tentativa ${p.numero})` : ""} — ${campo}`;
  };
  const outros = estado?.outros ?? [];
  const tiposAdicionar = estado?.tipos_adicionar ?? [];

  return (
    <ReadOnlyScope value={somenteLeitura}>
      <Secao id="peca_teste" titulo="Peça Teste" numero={numero} selo={selo} defaultOpen={defaultAberta}>
        {/* só a GRADE editável da tentativa atual fica sob `fieldset disabled` (por trilha, abaixo): o histórico colapsável e o
            "Tentar de novo" funcionam para quem só VÊ a seção (um <button> dentro de fieldset desabilitado não clica). */}
        <>
          {carregando && !estado ? (
            <p className="text-sm text-muted-foreground">Carregando a peça teste…</p>
          ) : erro && !estado ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-destructive">Não foi possível carregar a peça teste.</span>
              {/* NÃO é <button>: quem só LÊ o Sheet tem um `fieldset disabled` (SheetContent) acima da seção, que desabilita todo <button> descendente */}
              <span
                role="button" tabIndex={0} className="cursor-pointer underline underline-offset-2"
                onClick={onTentarDeNovo}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTentarDeNovo?.(); } }}
              >Tentar de novo</span>
            </div>
          ) : (
            <>
              {req.exigem > 0 && (
                <>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-sm font-semibold">
                      <b className="tabular-nums">{req.aprovadas} de {req.exigem}</b> serviços com peça teste aprovada
                    </span>
                    <span className="text-xs text-muted-foreground">Necessária para enviar à Explosão (requisito do kanban).</span>
                  </div>
                  {req.ok ? (
                    <Banner tone="ok" icon={<Check className="h-4 w-4" />}>
                      <b>Requisito “Peça teste aprovada” cumprido.</b> Todo serviço que exige peça teste está com a M.O. e a peça teste aprovadas.
                    </Banner>
                  ) : (
                    <Banner tone="info" icon={<Info className="h-4 w-4" />}>
                      <b>Falta para o requisito do kanban:</b> {req.faltas.map((f) => `${f.servico} (${f.motivo})`).join(", ")}. Cada serviço precisa da M.O. aprovada E da peça teste aprovada.
                    </Banner>
                  )}
                </>
              )}

              <ColabBanner presentes={[]} ultimoMerge={null} conflitos={conflitos} onResolver={onResolverConflito} rotulo={rotuloConflito} />
              {avisos.map((a) => (
                <Banner key={a} tone="warn" icon={<AlertTriangle className="h-4 w-4" />}>{a}</Banner>
              ))}

              {trilhas.map((t) => (
                <TrilhaCard
                  key={t.categoria_id}
                  trilha={t}
                  base={baseDe(t.categoria_id)}
                  // quem só LÊ o Sheet inteiro tem o gatilho do colapsável desabilitado pelo fieldset do SheetContent: o histórico já nasce aberto
                  historicoAberto={historicoAberto || somenteLeitura}
                  somenteLeitura={somenteLeitura}
                  pedir={pedir}
                  onEditarAtual={onEditarAtual}
                  onAprovar={onAprovar}
                  onDesfazer={onDesfazer}
                  onReprovar={onReprovar}
                  onTrocarFornecedor={onTrocarFornecedor}
                  onCorrigir={onCorrigir}
                  onExcluir={onExcluir}
                  onMudarDecisao={onMudarDecisao}
                  mini={mini}
                  onEditarMini={onEditarMini}
                  onEditarMiniTentativa={onEditarMiniTentativa}
                  miniAbertaInicial={miniAbertaInicial}
                />
              ))}

              {linhasNovas.map((servico, i) => (
                <p key={`${servico}-${i}`} className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="peca-teste-linha-nova">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>Salve o card para lançar a peça teste de {servico}.</span>
                </p>
              ))}

              {!somenteLeitura && onAdicionarTrilha && tiposAdicionar.length > 0 && (
                <AdicionarPeca tipos={tiposAdicionar} onAdicionar={onAdicionarTrilha} />
              )}

              {outros.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="peca-teste-fora">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {outros.map((o, i) => (
                      <span key={`${o.categoria_nome}-${i}`}>
                        {i > 0 && ", "}
                        <b>{o.categoria_nome}</b>{o.empresa_nome ? ` (${o.empresa_nome})` : ""}
                      </span>
                    ))}{" "}
                    {outros.length > 1 ? "não aparecem" : "não aparece"} aqui: o tipo de serviço não exige peça teste (Cadastro › Atributos › Categoria do Serviço).
                  </span>
                </p>
              )}
            </>
          )}
        </>
        {dialog}
      </Secao>
    </ReadOnlyScope>
  );
}

function Banner({ tone, icon, children }: { tone: "ok" | "info" | "warn"; icon: ReactNode; children: ReactNode }) {
  return (
    <div
      role={tone === "warn" ? "status" : undefined}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        tone === "ok" && "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
        tone === "info" && "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
        tone === "warn" && "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** "Adicionar peça teste": escolhe o tipo (dentre os que exigem e ainda não estão na seção) e acrescenta a trilha ao rascunho. */
function AdicionarPeca({ tipos, onAdicionar }: { tipos: EstadoPT["tipos_adicionar"]; onAdicionar: (categoriaId: string) => void }) {
  const [sel, setSel] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="peca-teste-adicionar">
      <div className="grid min-w-[12rem] gap-1.5">
        <Label className="text-xs">Tipo de serviço</Label>
        <Select value={sel} onValueChange={setSel}>
          <SelectTrigger aria-label="Tipo de serviço da peça teste"><SelectValue placeholder="Selecione…" /></SelectTrigger>
          <SelectContent>
            {tipos.map((t) => <SelectItem key={t.categoria_id} value={t.categoria_id}>{t.categoria_nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button" variant="outline" size="sm" className="gap-1" disabled={!sel} data-testid="peca-teste-adicionar-btn"
        onClick={() => { onAdicionar(sel); setSel(""); }}
      >
        <Plus className="h-3.5 w-3.5" />Adicionar peça teste
      </Button>
    </div>
  );
}

/** Opções do Select de fornecedor: os do tipo + o já escolhido, se por acaso não estiver mais vinculado (continua visível). */
function opcoesFornecedor(trilha: TrilhaPT, atualId: string | null, atualNome: string | null): FornecedorOpcaoPT[] {
  if (!atualId || trilha.fornecedores.some((f) => f.id === atualId)) return trilha.fornecedores;
  return [{ id: atualId, nome_fantasia: atualNome ?? "Fornecedor" }, ...trilha.fornecedores];
}

function TrilhaCard({
  trilha, base, historicoAberto, somenteLeitura, pedir, onEditarAtual, onAprovar, onDesfazer, onReprovar, onTrocarFornecedor, onCorrigir, onExcluir,
  onMudarDecisao, mini, onEditarMini, onEditarMiniTentativa, miniAbertaInicial,
}: {
  trilha: TrilhaPT;
  base: TrilhaPT | undefined;
  historicoAberto: boolean;
  somenteLeitura: boolean;
  pedir: (p: PedidoConfirmacao) => void;
  onEditarAtual: (categoriaId: string, patch: Patch) => void;
  onAprovar: (categoriaId: string) => void;
  onDesfazer: (categoriaId: string) => void;
  onReprovar: (categoriaId: string) => void;
  onTrocarFornecedor: (categoriaId: string, empresaId: string | null, empresaNome: string | null) => void;
  onCorrigir?: (categoriaId: string, numero: number, patch: PatchHist) => void;
  onExcluir?: (categoriaId: string, numero: number) => void;
  onMudarDecisao?: (categoriaId: string, numero: number, para: AprovacaoPecaTeste) => void;
  mini?: MiniApi;
  onEditarMini?: (categoriaId: string, mini: MiniPT) => void;
  onEditarMiniTentativa?: (categoriaId: string, numero: number, mini: MiniPT | null) => void;
  miniAbertaInicial: boolean;
}) {
  const uid = useId();
  const [histAberto, setHistAberto] = useState(historicoAberto);
  // reprovadas do histórico em CORREÇÃO (botão "Editar": datas, fornecedor e mini liberados); fechadas por padrão
  // (guarda a `baixa_em` do servidor no momento do clique: depois do Salvar a baixa é refeita/estornada, muda, e a correção fecha sozinha)
  const [corrigindo, setCorrigindo] = useState<ReadonlyMap<number, string | null>>(new Map());
  const cat = trilha.categoria_id;
  const at = tentativaAtualPT(trilha);
  const hist = historico(trilha);
  const status = statusTrilha(trilha);
  const aprovada = at.aprovacao === "aprovado";
  const motivo = motivoSemDecisao(at);
  // Decidir: com a peça já aprovada a pessoa ainda pode DESFAZER (voltar a "Selecione…") ou reprovar; senão exige datas + fornecedor escolhido.
  const aprovacaoDesabilitada = somenteLeitura || (!aprovada && motivo !== null);
  const moPendente = trilha.tem_mo && trilha.mo_aprovado !== true;
  const vez = vezComFornecedor(trilha.tentativas, at.numero);
  const titulo = rotuloTentativa({ categoria_nome: trilha.categoria_nome, numero: at.numero, fornecedor_nome: at.empresa_nome, vez });
  const semFornecedorNoTipo = trilha.fornecedores.length === 0;
  const caminho = (campo: string) => pathPT(cat, campo);
  const nomeDe = (id: string | null, nome: string | null) => (id ? (trilha.fornecedores.find((f) => f.id === id)?.nome_fantasia ?? nome) : null);
  const temSeguinte = (numero: number) => trilha.tentativas.some((x) => x.numero > numero);
  // Reabrir (desfazer) uma aprovação JÁ SALVA derruba o requisito do kanban: pede confirmação. Aprovação só no rascunho desfaz direto (nada mudou no servidor).
  const aprovadaSalva = base?.tentativas.find((x) => x.id !== null && x.id === at.id)?.aprovacao === "aprovado";
  const desfazerAtual = () => {
    if (!aprovadaSalva) { onDesfazer(cat); return; }
    pedir({ ...textoReabrirTentativa({ numero: at.numero, servico: trilha.categoria_nome, aprovada: true }), onConfirmar: () => onDesfazer(cat) });
  };

  return (
    <div data-trilha={cat} className={cn("overflow-hidden rounded-lg border bg-card", aprovada && "border-emerald-300 dark:border-emerald-800")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b bg-muted/40 px-3 py-2.5">
        <span className="text-sm font-semibold" data-testid="peca-teste-titulo">{titulo}</span>
        {moPendente && (
          <StatusBadge tone="warning" className="gap-1 normal-case tracking-normal">
            <AlertTriangle className="h-3 w-3" />{trilha.mo_aprovado === false ? "M.O. reprovada" : "M.O. pendente"}
          </StatusBadge>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={TOM_STATUS[status]} className="gap-1 normal-case tracking-normal">
            {status === "aprovada" && <Check className="h-3 w-3" />}
            {status === "reprovada_nova" && <X className="h-3 w-3" />}
            {ROTULO_STATUS_TRILHA[status]}
          </StatusBadge>
          {/* Desfazer explícito (só a tentativa ATUAL já decidida, só quem pode editar): volta a pendente; NÃO estorna a baixa */}
          {!somenteLeitura && !!at.aprovacao && (
            <Button
              type="button" variant="outline" size="sm" className="gap-1" data-testid="peca-teste-desfazer"
              title={TEXTO_DESFAZER_DECISAO} aria-label={`Desfazer a decisão da tentativa ${at.numero}. ${TEXTO_DESFAZER_DECISAO}`}
              onClick={desfazerAtual}
            >
              <Undo2 className="h-3.5 w-3.5" />Desfazer
            </Button>
          )}
        </span>
      </div>

      <div key={at.numero} className="flex flex-col gap-2.5 p-3">
        {!trilha.tem_mo && <p className="text-xs text-muted-foreground" data-testid="peca-teste-sem-mo">{TEXTO_SEM_MO_NO_TIPO}</p>}
        {semFornecedorNoTipo && (
          <Banner tone="warn" icon={<AlertTriangle className="h-4 w-4" />}>
            <span data-testid="peca-teste-sem-fornecedor-no-tipo">{TEXTO_SEM_FORNECEDOR_NO_TIPO}</span>
          </Banner>
        )}
        <fieldset disabled={somenteLeitura} className="contents" data-testid="peca-teste-grade">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid min-w-0 gap-1.5">
            {/* aprovada: a dica "fornecedor travado" mora num "i" ao lado do rótulo (InfoHover) — texto fixo embaixo empurrava este campo para fora do alinhamento com os demais */}
            <div className="flex items-center gap-1.5">
              <Label htmlFor={`${uid}-forn`} className="text-xs">Fornecedor</Label>
              {aprovada && (
                <span className="inline-flex items-center gap-1 text-muted-foreground" data-testid="peca-teste-forn-travado">
                  <Lock className="h-3 w-3 shrink-0" aria-hidden />
                  <InfoHover ariaLabel={TEXTO_FORNECEDOR_TRAVADO}>{TEXTO_FORNECEDOR_TRAVADO}</InfoHover>
                </span>
              )}
            </div>
            <Select
              value={at.empresa_id ?? ""}
              onValueChange={(v) => {
                const f = trilha.fornecedores.find((x) => x.id === v);
                onTrocarFornecedor(cat, v || null, f?.nome_fantasia ?? null);
              }}
              disabled={somenteLeitura || aprovada || (semFornecedorNoTipo && !at.empresa_id)}
            >
              <SelectTrigger id={`${uid}-forn`} className="w-full" data-colab-path={caminho("empresa_id")}>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {opcoesFornecedor(trilha, at.empresa_id, at.empresa_nome).map((f) => <SelectItem key={f.id} value={f.id}>{f.nome_fantasia}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid min-w-0 gap-1.5">
            <Label className="text-xs">Data de saída</Label>
            <DateField
              value={at.data_saida ?? ""}
              onChange={(e) => onEditarAtual(cat, { data_saida: e.target.value || null })}
              disabled={somenteLeitura || aprovada}
              aria-label="Data de saída"
              data-colab-path={caminho("data_saida")}
            />
          </div>

          <div className="grid min-w-0 gap-1.5">
            <Label className="text-xs">Data de entrada</Label>
            <DateField
              value={at.data_entrada ?? ""}
              onChange={(e) => onEditarAtual(cat, { data_entrada: e.target.value || null })}
              disabled={somenteLeitura || aprovada}
              aria-label="Data de entrada"
              data-colab-path={caminho("data_entrada")}
            />
          </div>

          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor={`${uid}-apr`} className="text-xs">Aprovação</Label>
            <Select
              value={at.aprovacao ?? SEM_DECISAO}
              onValueChange={(v) => {
                if (v === "reprovado") {
                  pedir({
                    ...textoReprovarTentativa({ numero: at.numero, servico: trilha.categoria_nome, fornecedor: nomeDe(at.empresa_id, at.empresa_nome) }),
                    onConfirmar: () => onReprovar(cat),
                  });
                  return;
                }
                if (v === "aprovado") { onAprovar(cat); return; }
                if (aprovada) desfazerAtual();
              }}
              disabled={aprovacaoDesabilitada}
            >
              <SelectTrigger id={`${uid}-apr`} className={cn("w-full", !at.aprovacao && "text-muted-foreground")} data-colab-path={caminho("aprovacao")}>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_DECISAO}>Selecione…</SelectItem>
                <SelectItem value="aprovado">Aprovado</SelectItem>
                <SelectItem value="reprovado">Reprovado</SelectItem>
              </SelectContent>
            </Select>
            {!somenteLeitura && !aprovada && motivo && (
              <span className="text-xs text-muted-foreground" data-testid="peca-teste-dica-decisao">{textoMotivoSemDecisao(motivo)}</span>
            )}
          </div>
        </div>
        </fieldset>

        {entradaAntesDaSaida(at) && (
          <p role="status" className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300" data-testid="peca-teste-dica-datas">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{TEXTO_ENTRADA_ANTES_DA_SAIDA}
          </p>
        )}
        {mini && (
          <MiniExplosaoBloco
            categoriaId={cat} pathNumero={null} tentativa={at} base={base?.tentativas.find((x) => x.id !== null && x.id === at.id) ?? null}
            historico={false} podeEditar={!somenteLeitura} api={mini} abertoInicial={miniAbertaInicial}
            onChange={(m) => onEditarMini?.(cat, m)}
          />
        )}
        {!somenteLeitura && onExcluir && (at.id !== null || trilha.tentativas.some((x) => x.numero === at.numero)) && (
          <div className="flex justify-end">
            <Button
              type="button" variant="ghost" size="sm" className="gap-1 text-destructive" data-testid="peca-teste-excluir-atual"
              onClick={() => pedir({
                ...textoExcluirTentativa({ numero: at.numero, servico: trilha.categoria_nome, comBaixa: !!base?.tentativas.find((x) => x.id !== null && x.id === at.id)?.mini?.baixa_em }),
                onConfirmar: () => onExcluir(cat, at.numero),
              })}
            >
              <Trash2 className="h-3.5 w-3.5" />Excluir tentativa
            </Button>
          </div>
        )}
      </div>

      {hist.length > 0 && (
        <Collapsible open={histAberto} onOpenChange={setHistAberto} className="border-t">
          <CollapsibleTrigger className="flex min-h-9 w-full items-center gap-1.5 px-3 py-2 text-xs font-semibold text-muted-foreground">
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", histAberto && "rotate-90")} />
            Tentativas anteriores ({hist.length})
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="flex flex-col gap-1.5 px-3 pb-3" data-testid="peca-teste-historico">
              {[...hist].reverse().map((h) => {
                const baseH = base?.tentativas.find((x) => x.id !== null && x.id === h.id) ?? null;
                const mostraMini = !!h.mini && (h.mini.tamanho !== null || h.mini.baixa_em !== null || h.mini.linhas.some((l) => !!l.foto));
                // corrigir/mudar a decisão/excluir só em reprovada que o servidor já tem (decisão SALVA como reprovada) — nunca na que só existe no rascunho
                const podeAlterar = !somenteLeitura && baseH?.aprovacao === "reprovado";
                const emCorrecao = podeAlterar && corrigindo.has(h.numero) && corrigindo.get(h.numero) === (baseH?.mini?.baixa_em ?? null);
                const vezH = vezComFornecedor(trilha.tentativas, h.numero);
                const bloqAprovar = motivoBloqueioMudarDecisao(trilha, h.numero, "aprovado");
                const bloqReabrir = motivoBloqueioMudarDecisao(trilha, h.numero, null);
                return (
                <li key={h.id ?? `n-${h.numero}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-dashed bg-muted/30 px-2.5 py-2 text-sm" data-testid={`peca-teste-hist-${h.numero}`}>
                  <span className="min-w-24 text-xs font-semibold text-muted-foreground">
                    {rotuloNumeroTentativa({ numero: h.numero, fornecedor_nome: h.empresa_nome, vez: vezH })}
                  </span>
                  {emCorrecao && onCorrigir ? (
                    <>
                      <span className="grid min-w-[10rem] gap-1">
                        <span className="text-xs text-muted-foreground">Fornecedor</span>
                        <Select
                          value={h.empresa_id ?? ""}
                          onValueChange={(v) => onCorrigir(cat, h.numero, { empresa_id: v || null, empresa_nome: trilha.fornecedores.find((x) => x.id === v)?.nome_fantasia ?? null })}
                        >
                          <SelectTrigger aria-label={`Fornecedor da tentativa ${h.numero}`} data-colab-path={pathPT(cat, "empresa_id", h.numero)}><SelectValue placeholder="Selecione…" /></SelectTrigger>
                          <SelectContent>
                            {opcoesFornecedor(trilha, h.empresa_id, h.empresa_nome).map((f) => <SelectItem key={f.id} value={f.id}>{f.nome_fantasia}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </span>
                      <span className="grid gap-1">
                        <span className="text-xs text-muted-foreground">Data de saída</span>
                        <DateField value={h.data_saida ?? ""} onChange={(e) => onCorrigir(cat, h.numero, { data_saida: e.target.value || null })} aria-label={`Data de saída da tentativa ${h.numero}`} data-colab-path={pathPT(cat, "data_saida", h.numero)} />
                      </span>
                      <span className="grid gap-1">
                        <span className="text-xs text-muted-foreground">Data de entrada</span>
                        <DateField value={h.data_entrada ?? ""} onChange={(e) => onCorrigir(cat, h.numero, { data_entrada: e.target.value || null })} aria-label={`Data de entrada da tentativa ${h.numero}`} data-colab-path={pathPT(cat, "data_entrada", h.numero)} />
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0"><span className="block text-xs text-muted-foreground">Fornecedor</span>{h.empresa_nome ?? "—"}</span>
                      <span><span className="block text-xs text-muted-foreground">Data de saída</span><span className="tabular-nums">{dataBR(h.data_saida)}</span></span>
                      <span><span className="block text-xs text-muted-foreground">Data de entrada</span><span className="tabular-nums">{dataBR(h.data_entrada)}</span></span>
                    </>
                  )}
                  <StatusBadge tone="danger" className="ml-auto gap-1 normal-case tracking-normal"><X className="h-3 w-3" />Reprovado</StatusBadge>
                  {podeAlterar && (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {emCorrecao ? (
                        <>
                          <Button
                            type="button" variant="outline" size="sm" data-testid="peca-teste-reprovada-concluir"
                            onClick={() => setCorrigindo((s) => { const n = new Map(s); n.delete(h.numero); return n; })}
                          >Concluir</Button>
                          <Button
                            type="button" variant="outline" size="sm" data-testid="peca-teste-reprovada-cancelar"
                            onClick={() => {
                              // cancelar = datas, fornecedor e mini voltam ao que o servidor tem (some o estorno pendente) e a edição fecha
                              onEditarMiniTentativa?.(cat, h.numero, baseH?.mini ?? null);
                              onCorrigir?.(cat, h.numero, {
                                data_saida: baseH?.data_saida ?? null, data_entrada: baseH?.data_entrada ?? null,
                                empresa_id: baseH?.empresa_id ?? null, empresa_nome: baseH?.empresa_nome ?? null,
                              });
                              setCorrigindo((s) => { const n = new Map(s); n.delete(h.numero); return n; });
                            }}
                          >Cancelar edição</Button>
                        </>
                      ) : (
                        <Button
                          type="button" variant="outline" size="sm" data-testid="peca-teste-reprovada-editar"
                          onClick={() => setCorrigindo((s) => new Map(s).set(h.numero, baseH?.mini?.baixa_em ?? null))}
                        >Editar</Button>
                      )}
                      {onMudarDecisao && (
                        <>
                          <Button
                            type="button" variant="outline" size="sm" data-testid="peca-teste-aprovar-hist"
                            disabled={bloqAprovar !== null} title={bloqAprovar ? TEXTO_APROVAR_MEIO : undefined}
                            onClick={() => onMudarDecisao(cat, h.numero, "aprovado")}
                          >Aprovar</Button>
                          <Button
                            type="button" variant="outline" size="sm" data-testid="peca-teste-reabrir"
                            disabled={bloqReabrir !== null} title={bloqReabrir ? TEXTO_REABRIR_MEIO : undefined}
                            onClick={() => pedir({ ...textoReabrirTentativa({ numero: h.numero, servico: trilha.categoria_nome }), onConfirmar: () => onMudarDecisao(cat, h.numero, null) })}
                          >Reabrir</Button>
                        </>
                      )}
                      {onExcluir && (
                        <Button
                          type="button" variant="ghost" size="sm" className="gap-1 text-destructive" data-testid="peca-teste-excluir"
                          onClick={() => pedir({
                            ...textoExcluirTentativa({ numero: h.numero, servico: trilha.categoria_nome, comBaixa: !!baseH?.mini?.baixa_em, seguintes: temSeguinte(h.numero) }),
                            onConfirmar: () => onExcluir(cat, h.numero),
                          })}
                        ><Trash2 className="h-3.5 w-3.5" />Excluir</Button>
                      )}
                    </span>
                  )}
                  {(mostraMini || emCorrecao) && mini && (
                    <div className="basis-full">
                      <MiniExplosaoBloco
                        categoriaId={cat} pathNumero={h.numero} tentativa={h} base={baseH}
                        historico edicaoHistorico={emCorrecao} podeEditar={podeAlterar && emCorrecao} api={mini} abertoInicial={miniAbertaInicial}
                        onChange={(m) => onEditarMiniTentativa?.(cat, h.numero, m)}
                      />
                    </div>
                  )}
                </li>
                );
              })}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
