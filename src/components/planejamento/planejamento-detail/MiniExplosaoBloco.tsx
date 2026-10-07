// Mini explosão (1 peça) da Peça Teste (R11, T6) — bloco recolhível DENTRO de cada tentativa (mockup v4 APROVADO).
// Componente de APRESENTAÇÃO: recebe o `MiniPT` do rascunho + o `MiniApi` (cálculo ao vivo, estoque) e devolve o novo `MiniPT` por
// `onChange`. Nada grava aqui (só o Salvar do card). Travada (baixa salva com a Data de saída) e histórico (reprovada) mostram a FOTO
// registrada da baixa, sem inputs. Mobile: a "tabela" vira cartões empilhados (`grid-cols-1`, rótulo por célula).
import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronRight, Info, Lock, RotateCcw, Scissors } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { InfoHover } from "@/components/shared/InfoHover";
import { NumberInput } from "@/components/shared/NumberInput";
import { cn } from "@/lib/utils";
import {
  acaoNoSalvar, ajusteOuNull, ajustarLinha, arredondar, miniNova, trocarTamanhoOuCor, voltarAoCalculado,
  type MiniAjuste, type MiniLinha, type MiniPT,
} from "@/lib/peca-teste-mini";
import { pathPT, type TentativaPT } from "@/lib/peca-teste";
import type { CalculoMini, FonteOc, MiniApi } from "@/components/planejamento/planejamento-detail/useMiniExplosao";

export const TEXTO_DICA_TROCA = "Trocar o tamanho ou a cor refaz o pré-preenchimento a partir do BOM (descarta as edições desta peça).";
export const TEXTO_SEM_TAMANHO_COR = "Data de saída preenchida, mas falta escolher o tamanho e a cor da peça — sem eles não há baixa.";
export const TEXTO_NAO_ENTRA_NO_CUSTO = "A peça teste só movimenta o estoque (tecidos, aviamentos e insumos). Não entra no custo do produto, não gera conta a pagar e não tem valor — é só controle.";

const SEM_VARIANTE = "__sem_variante__";
const f2 = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fq = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
const qtd = (n: number, un: "m" | "un" | null) => (un === "m" ? `${f2(n)} m` : `${fq(n)}${un === "un" ? " un" : ""}`);
const dataBR = (iso: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};
const rotuloCurto = (t: string) => (t.includes("|") ? t.split("|")[1] : t);
const rotuloLinha = (l: { rotulo: string | null; variante_rotulo?: string | null; variante?: string | null }) =>
  [l.rotulo ?? "Item", l.variante_rotulo ?? l.variante ?? null].filter(Boolean).join(" · ");

/** Faltas a mostrar: tecido SEM a OC/rolo escolhido (desmarcado) não baixa — o aviso "Escolha a OC ou o rolo" já diz isso, não vira "faltou". */
export function faltasVisiveis(calc: CalculoMini, mini: MiniPT): CalculoMini["faltas"] {
  if (mini.mesma_oc) return calc.faltas;
  const semOrigem = new Set(calc.linhas.filter((l) => l.familia === "tecido" && !l.oc_tecido_item_id).map((l) => l.chave));
  return calc.faltas.filter((f) => !semOrigem.has(f.chave));
}

export type MiniBlocoProps = {
  linhaId: string;
  /** nº da tentativa quando NÃO é a atual (o path do merge leva `:t<n>`); null = a atual. */
  pathNumero: number | null;
  /** A tentativa como está no RASCUNHO e como o SERVIDOR a tem. */
  tentativa: TentativaPT;
  base: TentativaPT | null;
  /** Tentativa reprovada (histórico): só leitura, "baixa mantida". */
  historico: boolean;
  /** Pode editar (permissão da seção) — a trava por baixa/decisão é calculada aqui. */
  podeEditar: boolean;
  api: MiniApi;
  onChange: (mini: MiniPT) => void;
  onTentarDeNovo?: () => void;
  /** Estado inicial do colapsável (fechado por padrão; a prop existe para o render estático). */
  abertoInicial?: boolean;
};

/** Travada = sem inputs: histórico, tentativa decidida (aprovada) ou baixa salva com a Data de saída ainda preenchida. */
export function miniEstaTravada(t: TentativaPT, base: TentativaPT | null, historico: boolean): boolean {
  if (historico) return true;
  if (base && base.aprovacao !== null) return true;
  return !!base?.mini?.baixa_em && !!t.data_saida;
}

export function MiniExplosaoBloco({ linhaId, pathNumero, tentativa, base, historico, podeEditar, api, onChange, onTentarDeNovo, abertoInicial = false }: MiniBlocoProps) {
  const [aberto, setAberto] = useState(abertoInicial);
  if (!api.ativo) return null;
  const mini = tentativa.mini ?? null;
  const dataSaida = tentativa.data_saida;
  const travada = miniEstaTravada(tentativa, base, historico);
  const editavel = podeEditar && !travada;
  const baixaSalva = base?.mini?.baixa_em ?? (historico ? mini?.baixa_em ?? null : null);
  const fotos = (mini?.linhas ?? []).filter((l) => !!l.foto);
  const mostraFoto = travada && fotos.length > 0;
  const calc = mostraFoto ? null : api.calcular(mini);
  const acao = historico ? null : acaoNoSalvar(tentativa, base, { semTecido1: api.semTecido1 });

  // — faltas: registradas (foto) ou previstas (ao vivo)
  const faltasFoto = fotos.filter((l) => (l.foto?.faltou ?? 0) > 0);
  const faltasLive = calc ? faltasVisiveis(calc, mini ?? miniNova()) : [];
  const nFaltas = mostraFoto ? faltasFoto.length : faltasLive.length;
  const faltaTxt = mostraFoto
    ? faltasFoto.map((l) => `${rotuloLinha(l.foto!)} ${qtd(l.foto!.faltou as number, l.foto!.unidade)}`).join("; ")
    : faltasLive.map((f) => `${f.rotulo} ${qtd(f.faltou, f.unidade)}`).join("; ");

  // — selos do cabeçalho
  const selos: { txt: string; tom: StatusTone; icone?: ReactNode }[] = [];
  if (historico) {
    if (baixaSalva) selos.push({ txt: "Baixa mantida (peça gasta)", tom: "neutral", icone: <Lock className="h-3 w-3" /> });
  } else if (baixaSalva && dataSaida) selos.push({ txt: `Baixa feita em ${dataBR(dataSaida)}`, tom: "success", icone: <Check className="h-3 w-3" /> });
  else if (baixaSalva && !dataSaida) selos.push({ txt: "Estorno ao Salvar", tom: "warning", icone: <AlertTriangle className="h-3 w-3" /> });
  else if (!calc && !mostraFoto) selos.push({ txt: "Escolha tamanho e cor", tom: "neutral" });
  else selos.push({ txt: "Baixa ao Salvar", tom: "neutral" });
  if (nFaltas > 0) selos.push({ txt: `faltou · ${nFaltas} ${nFaltas > 1 ? "itens" : "item"}`, tom: "warning", icone: <AlertTriangle className="h-3 w-3" /> });

  const rotuloTam = (v: string | null) => (v ? api.tamanhos.find((o) => o.value === v)?.label ?? (v.includes("|") ? v.split("|")[1] : v) : null);
  const rotuloCor = (v: string | null) => (v ? api.cores.find((o) => o.value === v)?.label ?? "cor escolhida" : null);

  return (
    <Collapsible open={aberto} onOpenChange={setAberto} className="overflow-hidden rounded-md border bg-background" data-colab-path={pathPT(linhaId, "mini", pathNumero)} data-testid="peca-teste-mini">
      {/* NÃO é <button>: quem só LÊ o Sheet tem um `fieldset disabled` (SheetContent) acima, que desabilita todo <button> descendente */}
      <CollapsibleTrigger asChild>
        <div role="button" tabIndex={0} className="flex min-h-10 w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-left">
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-90")} />
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <Scissors className="h-3.5 w-3.5 text-muted-foreground" />Mini explosão (1 peça){historico ? " · somente leitura" : ""}
          </span>
          {mini?.tamanho && <StatusBadge tone="neutral" className="normal-case tracking-normal">Tam. {rotuloTam(mini.tamanho)}</StatusBadge>}
          {mini?.variante_tecido_id && <StatusBadge tone="neutral" className="normal-case tracking-normal">{rotuloCor(mini.variante_tecido_id)}</StatusBadge>}
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            {selos.map((s) => (
              <StatusBadge key={s.txt} tone={s.tom} className="gap-1 normal-case tracking-normal">{s.icone}{s.txt}</StatusBadge>
            ))}
          </span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-3 border-t px-3 py-3">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            Não entra no custo do produto
            <InfoHover ariaLabel="Mais informação: a peça teste não entra no custo do produto">{TEXTO_NAO_ENTRA_NO_CUSTO}</InfoHover>
            <span className="hidden sm:inline">·</span>
            <span>Nasce do BOM do card para 1 peça; o “a enviar” nasce igual à necessária e é o que baixa.</span>
          </div>

          <Aviso
            historico={historico} baixaSalva={baixaSalva} dataSaida={dataSaida} acao={acao}
            temData={!!dataSaida} baixaEm={base?.mini?.baixa_em ?? null}
          />

          {api.erro && !api.pronta && !mostraFoto ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-destructive">Não foi possível carregar o estoque da mini explosão.</span>
              <span
                role="button" tabIndex={0} className="cursor-pointer underline underline-offset-2"
                onClick={onTentarDeNovo ?? api.tentarDeNovo}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (onTentarDeNovo ?? api.tentarDeNovo)(); } }}
              >Tentar de novo</span>
            </div>
          ) : !mostraFoto && api.fichaIndisponivel ? (
            <p className="text-xs text-muted-foreground">A mini explosão usa o BOM do card, que o seu perfil não pode ver.</p>
          ) : !mostraFoto && !api.pronta ? (
            <p className="text-sm text-muted-foreground" data-testid="peca-teste-mini-carregando">Carregando…</p>
          ) : (
            <>
              <SeletoresTamanhoCor mini={mini} api={api} desabilitado={!editavel} onChange={onChange} idBase={`${linhaId}-${pathNumero ?? "atual"}`} />
              {editavel && <p className="text-xs text-muted-foreground">{TEXTO_DICA_TROCA}</p>}
              {mostraFoto ? (
                <Foto linhas={fotos} />
              ) : !calc ? (
                <p className="text-sm text-muted-foreground" data-testid="peca-teste-mini-placeholder">
                  Escolha o tamanho e a cor da peça para carregar tecidos, aviamentos e insumos do BOM do card.
                </p>
              ) : (
                <Calculo mini={mini ?? miniNova()} calc={calc} api={api} editavel={editavel} onChange={onChange} />
              )}
              {nFaltas > 0 && (
                <Faixa tom="warn" icone={<AlertTriangle className="h-4 w-4" />} role="status">
                  <b>Faltou estoque em {nFaltas} {nFaltas > 1 ? "itens" : "item"}</b> (o “a enviar” passa do saldo): {faltaTxt}.{" "}
                  {mostraFoto ? "A falta ficou registrada na baixa." : "O Salvar grava mesmo assim e a falta fica registrada."}
                </Faixa>
              )}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ───────────────────────────── avisos por estado ─────────────────────────────

function Aviso({ historico, baixaSalva, dataSaida, acao, temData, baixaEm }: {
  historico: boolean; baixaSalva: string | null; dataSaida: string | null; acao: ReturnType<typeof acaoNoSalvar>; temData: boolean; baixaEm: string | null;
}) {
  if (historico) {
    return (
      <Faixa tom="info" icone={<Lock className="h-4 w-4" />}>
        <b>Baixa mantida (peça gasta).</b> Esta tentativa foi reprovada: o material (o “a enviar” da época) já saiu do estoque e a baixa <b>não</b> é estornada.{" "}
        {baixaSalva ? "" : "A baixa acontece ao Salvar. "}Somente leitura.
      </Faixa>
    );
  }
  if (acao === "estorno") {
    return (
      <Faixa tom="warn" icone={<AlertTriangle className="h-4 w-4" />} role="status">
        <b>Ao Salvar, a baixa será estornada:</b> o material baixado (o “a enviar”) volta ao estoque; o Salvar pede confirmação. Com a Data de saída apagada, as quantidades voltam a ser editáveis.
      </Faixa>
    );
  }
  if (acao === "estorno_e_baixa") {
    return (
      <Faixa tom="warn" icone={<AlertTriangle className="h-4 w-4" />} role="status">
        <b>Ao Salvar, a baixa será estornada e refeita</b> com as quantidades novas; o Salvar pede confirmação.
      </Faixa>
    );
  }
  if (baixaEm && temData) {
    return (
      <Faixa tom="ok" icone={<Check className="h-4 w-4" />}>
        <b>Baixa feita em {dataBR(dataSaida)}</b> (ao preencher a Data de saída), pelo <b>“a enviar”</b> de cada linha. As quantidades estão travadas; para refazer, apague a Data de saída e salve (a baixa é estornada). Aparece no Histórico do estoque como “Peça teste”, com o card.
      </Faixa>
    );
  }
  if (acao === "sem_baixa_falta_tamanho_cor") {
    return (
      <Faixa tom="warn" icone={<AlertTriangle className="h-4 w-4" />} role="status">{TEXTO_SEM_TAMANHO_COR}</Faixa>
    );
  }
  return (
    <Faixa tom="info" icone={<Info className="h-4 w-4" />}>
      A baixa acontece ao <b>Salvar</b> com a <b>Data de saída</b> preenchida e segue o <b>“a enviar”</b> de cada linha.
      {temData ? " A Data de saída já está preenchida: o Salvar fará a baixa." : ""}
    </Faixa>
  );
}

function Faixa({ tom, icone, children, role }: { tom: "ok" | "info" | "warn"; icone: ReactNode; children: ReactNode; role?: "status" }) {
  return (
    <div
      role={role}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        tom === "ok" && "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
        tom === "info" && "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
        tom === "warn" && "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
      )}
    >
      <span className="mt-0.5 shrink-0">{icone}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

// ───────────────────────────── tamanho e cor ─────────────────────────────

function SeletoresTamanhoCor({ mini, api, desabilitado, onChange, idBase }: {
  mini: MiniPT | null; api: MiniApi; desabilitado: boolean; onChange: (m: MiniPT) => void; idBase: string;
}) {
  // o valor já gravado entra na lista mesmo que tenha saído da grade/BOM (o servidor aceita qualquer chave da loja)
  const tams = mini?.tamanho && !api.tamanhos.some((o) => o.value === mini.tamanho)
    ? [...api.tamanhos, { value: mini.tamanho, label: mini.tamanho.includes("|") ? mini.tamanho.split("|")[1] : mini.tamanho }]
    : api.tamanhos;
  const cores = mini?.variante_tecido_id && !api.cores.some((o) => o.value === mini.variante_tecido_id)
    ? [...api.cores, { value: mini.variante_tecido_id, label: "Cor escolhida" }]
    : api.cores;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={`${idBase}-mt`} className="text-xs">Tamanho da peça</Label>
        <Select value={mini?.tamanho ?? ""} onValueChange={(v) => onChange(trocarTamanhoOuCor(mini, { tamanho: v }))} disabled={desabilitado}>
          <SelectTrigger id={`${idBase}-mt`} className={cn("w-full", !mini?.tamanho && "text-muted-foreground")}>
            <SelectValue placeholder="Selecione…" />
          </SelectTrigger>
          <SelectContent>{tams.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">Grade do card: {api.tamanhos.map((o) => o.label).join(" · ") || "—"}</span>
      </div>
      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={`${idBase}-mc`} className="text-xs">Cor da peça (variante)</Label>
        <Select value={mini?.variante_tecido_id ?? ""} onValueChange={(v) => onChange(trocarTamanhoOuCor(mini, { variante_tecido_id: v }))} disabled={desabilitado || (api.semTecido1 && api.pronta)}>
          <SelectTrigger id={`${idBase}-mc`} className={cn("w-full", !mini?.variante_tecido_id && "text-muted-foreground")}>
            <SelectValue placeholder={api.semTecido1 && api.pronta ? "Card sem Tecido 1" : "Selecione…"} />
          </SelectTrigger>
          <SelectContent>{cores.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">Variantes do Tecido 1 do card.</span>
      </div>
    </div>
  );
}

// ───────────────────────────── tabelas (editáveis) ─────────────────────────────

const GRID_TEC = "grid grid-cols-1 gap-x-3 gap-y-1.5 xl:grid-cols-[minmax(0,1.5fr)_5.5rem_5rem_6.5rem_8rem_minmax(0,1.6fr)_minmax(0,1fr)]";
const GRID_AVI = "grid grid-cols-1 gap-x-3 gap-y-1.5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_6.5rem_8rem_6rem_minmax(0,1fr)]";
const GRID_INS = "grid grid-cols-1 gap-x-3 gap-y-1.5 xl:grid-cols-[minmax(0,2fr)_6.5rem_8rem_6rem_minmax(0,1fr)]";

function Celula({ rotulo, children, className }: { rotulo: string; children: ReactNode; className?: string }) {
  return (
    <div role="cell" className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 xl:block", className)}>
      <span className="text-xs text-muted-foreground xl:hidden">{rotulo}</span>
      {children}
    </div>
  );
}
function Cabecalho({ grade, colunas, dividir }: { grade: string; colunas: string[]; dividir: "xl" }) {
  return (
    <div role="row" className={cn(grade, "hidden border-b pb-1 text-xs font-semibold text-muted-foreground", dividir === "xl" ? "xl:grid" : "xl:grid")}>
      {colunas.map((c) => <div key={c} role="columnheader">{c}</div>)}
    </div>
  );
}
function Secao({ icone, titulo, dica, totais, children }: { icone: ReactNode; titulo: string; dica: string; totais: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-md border p-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
        <span className="flex items-center gap-1.5 text-sm font-semibold">{icone}{titulo}</span>
        <span className="text-muted-foreground">{dica}</span>
        <span className="ml-auto tabular-nums">{totais}</span>
      </div>
      <div role="table" className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Num({ valor, onValor, rotulo, desabilitado }: { valor: number; onValor: (n: number) => void; rotulo: string; desabilitado: boolean }) {
  if (desabilitado) return <span className="tabular-nums">{fq(valor)}</span>;
  return (
    <NumberInput
      aria-label={rotulo} value={valor} className="h-8 w-full text-right tabular-nums"
      onChange={(e) => onValor(Number(e.target.value))}
    />
  );
}

function Desfazer({ onClick, texto }: { onClick: () => void; texto: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2">
      <RotateCcw className="h-3 w-3" />voltar ao calculado ({texto})
    </button>
  );
}

function Calculo({ mini, calc, api, editavel, onChange }: { mini: MiniPT; calc: CalculoMini; api: MiniApi; editavel: boolean; onChange: (m: MiniPT) => void }) {
  const tec = calc.linhas.filter((l) => l.familia === "tecido");
  const avi = calc.linhas.filter((l) => l.familia === "aviamento");
  const ins = calc.linhas.filter((l) => l.familia === "insumo");
  const faltaDe = new Map(faltasVisiveis(calc, mini).map((f) => [f.chave, f]));
  const soma = (ls: MiniLinha[], k: "necessaria" | "a_enviar") => arredondar(ls.reduce((s, l) => s + l[k], 0), 4);
  const patch = (l: MiniLinha, p: Partial<Pick<MiniAjuste, "consumo" | "loss_percent" | "a_enviar" | "variante_aviamento_id" | "oc_tecido_item_id">>) =>
    onChange(ajustarLinha(mini, l.chave, l.familia, p));
  const enviarNum = (l: MiniLinha, n: number) => patch(l, { a_enviar: ajusteOuNull(n, l.necessaria) });
  const semOrigem = !mini.mesma_oc ? tec.filter((l) => !l.oc_tecido_item_id) : [];
  const dif = (l: MiniLinha) => Math.abs(l.a_enviar - l.necessaria) > 1e-9;
  const situacao = (l: MiniLinha, extra?: ReactNode) => {
    const f = faltaDe.get(l.chave);
    if (f) return <StatusBadge tone="warning" className="gap-1 normal-case tracking-normal" role="status"><AlertTriangle className="h-3 w-3" />faltou {qtd(f.faltou, f.unidade)}</StatusBadge>;
    return extra ?? <StatusBadge tone="success" className="gap-1 normal-case tracking-normal"><Check className="h-3 w-3" />ok</StatusBadge>;
  };

  return (
    <>
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <Checkbox
          checked={mini.mesma_oc} disabled={!editavel} className="mt-0.5"
          onCheckedChange={(v) => onChange({ ...mini, mesma_oc: v === true })}
          aria-label="Usar a mesma OC do card"
        />
        <span>
          <b>Usar a mesma OC do card</b>
          <span className="block text-xs text-muted-foreground">
            {mini.mesma_oc
              ? "Marcado: cada tecido sai das OCs/rolos já vinculados ao card, na ordem de prioridade (1ª, 2ª…); se faltar numa, segue para a próxima. Lista somente leitura."
              : "Desmarcado: escolha a OC ou o rolo de cada tecido; o saldo de cada um aparece na lista."}
          </span>
        </span>
      </label>
      {editavel && semOrigem.length > 0 && (
        <Faixa tom="warn" icone={<AlertTriangle className="h-4 w-4" />} role="status">
          Escolha a OC ou o rolo de: <b>{semOrigem.map((l) => rotuloLinha(l)).join(", ")}</b>. Sem a origem, a baixa deste tecido não é feita.
        </Faixa>
      )}

      {tec.length > 0 && (
        <Secao
          icone={<Scissors className="h-3.5 w-3.5 text-muted-foreground" />} titulo="Tecidos / forros / entretelas"
          dica="necessária = consumo × (1 + % loss) p/ 1 peça; a baixa segue a metragem a enviar"
          totais={`Necessária ${f2(soma(tec, "necessaria"))} m · A enviar ${f2(soma(tec, "a_enviar"))} m`}
        >
          <Cabecalho grade={GRID_TEC} dividir="xl" colunas={["Tecido", "Consumo (m)", "% Loss", "Metragem necessária (m)", "Metragem a enviar (m)", "Sai de (OC / rolo)", "Situação"]} />
          {tec.map((l) => {
            const fontes = api.fontesTecido(l);
            return (
              <div role="row" key={l.chave} className={cn(GRID_TEC, "rounded-md border border-dashed p-2 xl:rounded-none xl:border-0 xl:border-b xl:p-0 xl:pb-2")}>
                <Celula rotulo="Tecido"><span className="min-w-0"><b>{l.rotulo}</b>{l.variante_rotulo && <span className="block text-xs text-muted-foreground">{l.variante_rotulo}</span>}</span></Celula>
                <Celula rotulo="Consumo (m)"><Num valor={l.consumo} rotulo={`Consumo de ${rotuloLinha(l)} (m)`} desabilitado={!editavel} onValor={(n) => patch(l, { consumo: ajusteOuNull(n, calc.padrao[l.chave]?.consumo ?? l.consumo) })} /></Celula>
                <Celula rotulo="% Loss"><Num valor={l.loss_percent} rotulo={`% Loss de ${rotuloLinha(l)}`} desabilitado={!editavel} onValor={(n) => patch(l, { loss_percent: ajusteOuNull(n, calc.padrao[l.chave]?.loss_percent ?? l.loss_percent) })} /></Celula>
                <Celula rotulo="Metragem necessária (m)"><span className="tabular-nums" data-testid="mini-necessaria">{f2(l.necessaria)}</span></Celula>
                <Celula rotulo="Metragem a enviar (m)" className="xl:space-y-1">
                  <Num valor={l.a_enviar} rotulo={`Metragem a enviar de ${rotuloLinha(l)} (m)`} desabilitado={!editavel} onValor={(n) => enviarNum(l, n)} />
                  {editavel && dif(l) && <Desfazer texto={f2(l.necessaria)} onClick={() => onChange(voltarAoCalculado(mini, l.chave, ["a_enviar"]))} />}
                </Celula>
                <Celula rotulo="Sai de (OC / rolo)" className="xl:space-y-1">
                  <OrigemTecido linha={l} mini={mini} fontes={fontes} editavel={editavel} onEscolher={(id) => patch(l, { oc_tecido_item_id: id })} />
                </Celula>
                <Celula rotulo="Situação">{situacao(l, !mini.mesma_oc && !l.oc_tecido_item_id ? <span className="text-xs text-muted-foreground">Escolha a OC/rolo</span> : undefined)}</Celula>
              </div>
            );
          })}
        </Secao>
      )}

      {avi.length > 0 && (
        <Secao
          icone={<Scissors className="h-3.5 w-3.5 text-muted-foreground" />} titulo="Aviamentos"
          dica="a variante nasce da cor da peça e é editável; a baixa segue o a separar/enviar"
          totais={`Necessária ${fq(soma(avi, "necessaria"))} un · A enviar ${fq(soma(avi, "a_enviar"))} un`}
        >
          <Cabecalho grade={GRID_AVI} dividir="xl" colunas={["Aviamento", "Variante", "Necessária (1 peça)", "A separar/enviar", "Em estoque", "Situação"]} />
          {avi.map((l) => {
            const ops = api.variantesAviamento(l.aviamento_id);
            const est = api.emEstoque(l);
            return (
              <div role="row" key={l.chave} className={cn(GRID_AVI, "rounded-md border border-dashed p-2 xl:rounded-none xl:border-0 xl:border-b xl:p-0 xl:pb-2")}>
                <Celula rotulo="Aviamento"><b className="min-w-0">{l.rotulo}</b></Celula>
                <Celula rotulo="Variante">
                  {editavel && ops.length > 0 ? (
                    <Select value={l.variante_aviamento_id ?? SEM_VARIANTE} onValueChange={(v) => patch(l, { variante_aviamento_id: v === SEM_VARIANTE ? null : v })}>
                      <SelectTrigger className="h-8 w-full" aria-label={`Variante de ${l.rotulo}`}><SelectValue placeholder="Sem variante" /></SelectTrigger>
                      <SelectContent>
                        {!l.variante_aviamento_id && <SelectItem value={SEM_VARIANTE}>Sem variante</SelectItem>}
                        {ops.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : <span className="text-sm">{l.variante_rotulo ?? "—"}</span>}
                </Celula>
                <Celula rotulo="Necessária (1 peça)"><span className="tabular-nums">{fq(l.necessaria)}</span></Celula>
                <Celula rotulo="A separar/enviar (un)" className="xl:space-y-1">
                  <Num valor={l.a_enviar} rotulo={`A separar/enviar de ${l.rotulo}`} desabilitado={!editavel} onValor={(n) => enviarNum(l, n)} />
                  {editavel && dif(l) && <Desfazer texto={fq(l.necessaria)} onClick={() => onChange(voltarAoCalculado(mini, l.chave, ["a_enviar"]))} />}
                </Celula>
                <Celula rotulo="Em estoque"><span className="tabular-nums">{est === null ? "—" : `${fq(est)} un`}</span></Celula>
                <Celula rotulo="Situação">{situacao(l)}</Celula>
              </div>
            );
          })}
        </Secao>
      )}

      {ins.length > 0 && (
        <Secao
          icone={<Scissors className="h-3.5 w-3.5 text-muted-foreground" />} titulo="Insumos / etiquetas"
          dica="insumo vinculado a um tamanho só entra na peça desse tamanho; a baixa segue o a enviar"
          totais={`Necessária ${fq(soma(ins, "necessaria"))} un · A enviar ${fq(soma(ins, "a_enviar"))} un`}
        >
          <Cabecalho grade={GRID_INS} dividir="xl" colunas={["Insumo", "Necessária (1 peça)", "A enviar", "Em estoque", "Situação"]} />
          {ins.map((l) => {
            const est = api.emEstoque(l);
            return (
              <div role="row" key={l.chave} className={cn(GRID_INS, "rounded-md border border-dashed p-2 xl:rounded-none xl:border-0 xl:border-b xl:p-0 xl:pb-2")}>
                <Celula rotulo="Insumo">
                  <b className="min-w-0">{l.rotulo}</b>
                  {calc.vinculados?.[l.chave] && <StatusBadge tone="neutral" className="ml-1.5 normal-case tracking-normal">Só tam. {rotuloCurto(calc.vinculados[l.chave])}</StatusBadge>}
                </Celula>
                <Celula rotulo="Necessária (1 peça)"><span className="tabular-nums">{fq(l.necessaria)}</span></Celula>
                <Celula rotulo="A enviar (un)" className="xl:space-y-1">
                  <Num valor={l.a_enviar} rotulo={`A enviar de ${l.rotulo}`} desabilitado={!editavel} onValor={(n) => enviarNum(l, n)} />
                  {editavel && dif(l) && <Desfazer texto={fq(l.necessaria)} onClick={() => onChange(voltarAoCalculado(mini, l.chave, ["a_enviar"]))} />}
                </Celula>
                <Celula rotulo="Em estoque"><span className="tabular-nums">{est === null ? "—" : `${fq(est)} un`}</span></Celula>
                <Celula rotulo="Situação">{situacao(l)}</Celula>
              </div>
            );
          })}
        </Secao>
      )}

      {calc.fora > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="mini-fora-tamanho">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {calc.fora} {calc.fora > 1 ? "insumos do card vinculados a outros tamanhos não entram" : "insumo do card vinculado a outro tamanho não entra"} nesta peça (tamanho {mini.tamanho?.includes("|") ? mini.tamanho.split("|")[1] : mini.tamanho}).
          </span>
        </p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground tabular-nums">
        <span>A baixa desta peça (a enviar): <b>{f2(soma(tec, "a_enviar"))} m</b> de tecidos</span>
        <span><b>{fq(soma(avi, "a_enviar"))} un</b> de aviamentos</span>
        <span><b>{fq(soma(ins, "a_enviar"))} un</b> de insumos</span>
      </div>
    </>
  );
}

function OrigemTecido({ linha, mini, fontes, editavel, onEscolher }: {
  linha: MiniLinha; mini: MiniPT; fontes: { vinculadas: FonteOc[]; todas: FonteOc[] }; editavel: boolean; onEscolher: (id: string | null) => void;
}) {
  if (mini.mesma_oc) {
    if (fontes.vinculadas.length === 0) {
      return <span className="text-xs text-muted-foreground">Nenhuma OC/rolo vinculado a este tecido no card — sai do estoque mais antigo.</span>;
    }
    return (
      <ul className="flex flex-col gap-1 text-sm">
        {fontes.vinculadas.map((s, i) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <StatusBadge tone="neutral" className="normal-case tracking-normal">{i + 1}ª</StatusBadge>
            <span className="min-w-0">{s.rotulo} · saldo <span className="tabular-nums">{f2(s.saldo)} m</span></span>
          </li>
        ))}
      </ul>
    );
  }
  const escolhida = linha.oc_tecido_item_id;
  const lista = escolhida && !fontes.todas.some((s) => s.id === escolhida)
    ? [...fontes.todas, { id: escolhida, rotulo: "OC/rolo escolhido", saldo: 0, is_rolo: false }]
    : fontes.todas;
  const atual = lista.find((s) => s.id === escolhida);
  if (!editavel) {
    return atual ? <span className="text-sm">{atual.rotulo}</span> : <span className="text-xs text-muted-foreground">—</span>;
  }
  const grupo = (rotulo: string, rolo: boolean) => {
    const itens = lista.filter((s) => s.is_rolo === rolo);
    return itens.length === 0 ? null : (
      <SelectGroup>
        <SelectLabel>{rotulo}</SelectLabel>
        {itens.map((s) => <SelectItem key={s.id} value={s.id}>{s.rotulo} · saldo {f2(s.saldo)} m</SelectItem>)}
      </SelectGroup>
    );
  };
  return (
    <>
      <Select value={escolhida ?? ""} onValueChange={(v) => onEscolher(v)}>
        <SelectTrigger className={cn("h-8 w-full", !escolhida && "text-muted-foreground")} aria-label={`OC ou rolo de ${rotuloLinha(linha)}`}>
          <SelectValue placeholder="Selecione a OC ou o rolo…" />
        </SelectTrigger>
        <SelectContent>{grupo("OCs", false)}{grupo("Rolos", true)}</SelectContent>
      </Select>
      {atual && atual.saldo > 0 && <span className="text-xs text-muted-foreground">Saldo <span className="tabular-nums">{f2(atual.saldo)} m</span></span>}
    </>
  );
}

// ───────────────────────────── foto da baixa (travada / histórico) ─────────────────────────────

function Foto({ linhas }: { linhas: MiniAjuste[] }) {
  const grupo = (fam: MiniAjuste["familia"], titulo: string) => {
    const ls = linhas.filter((l) => l.familia === fam);
    if (ls.length === 0) return null;
    return (
      <section key={fam} className="flex flex-col gap-1.5 rounded-md border p-2.5" data-testid={`mini-foto-${fam}`}>
        <span className="text-sm font-semibold">{titulo} <span className="text-xs font-normal text-muted-foreground">(registrado na baixa)</span></span>
        <ul className="flex flex-col gap-1.5">
          {ls.map((l) => {
            const f = l.foto!;
            return (
              <li key={l.chave} className="grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_minmax(0,1.2fr)]">
                <span className="min-w-0 font-medium">{rotuloLinha(f)}</span>
                <span><span className="text-xs text-muted-foreground sm:hidden">Necessária </span><span className="tabular-nums">{f.necessaria === null ? "—" : qtd(f.necessaria, f.unidade)}</span></span>
                <span><span className="text-xs text-muted-foreground sm:hidden">A enviar </span><span className="tabular-nums">{f.a_enviar === null ? "—" : qtd(f.a_enviar, f.unidade)}</span></span>
                <span><span className="text-xs text-muted-foreground sm:hidden">Baixado </span><span className="tabular-nums">{f.baixado === null ? "—" : qtd(f.baixado, f.unidade)}</span></span>
                <span className="min-w-0">
                  {(f.faltou ?? 0) > 0
                    ? <StatusBadge tone="warning" className="gap-1 normal-case tracking-normal"><AlertTriangle className="h-3 w-3" />faltou {qtd(f.faltou as number, f.unidade)} · registrada</StatusBadge>
                    : <StatusBadge tone="success" className="gap-1 normal-case tracking-normal"><Check className="h-3 w-3" />ok</StatusBadge>}
                  {f.fontes.length > 0 && <span className="block text-xs text-muted-foreground">Saiu de: {f.fontes.map((s) => `${s.rotulo ?? "OC/rolo"} · ${f2(s.metros)} m`).join("; ")}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    );
  };
  return <>{grupo("tecido", "Tecidos / forros / entretelas")}{grupo("aviamento", "Aviamentos")}{grupo("insumo", "Insumos / etiquetas")}</>;
}
