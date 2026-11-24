// Célula da grade "Lista tipo Excel" de Cadastro > Insumos. Só DESENHA: o tipo da coluna escolhe o controle (`controleDaCelula`), o
// valor e o `onChange` vêm do rascunho do insumo. Nada grava aqui — editar só mexe no rascunho; o selo âmbar (`sujo`) vem de
// `valor ≠ base`. Espelha `CelulaAviamento`, com as 2 células NOVAS do insumo:
//  • "tamanhos"          — multi-check dos tamanhos da grade da loja (uma lista por COR); desabilitada com formato "nenhum";
//  • "tamanho-vinculado" — select do CABEÇALHO ("sem vínculo" + os tamanhos da grade; o valor salvo fora da grade vira opção extra),
//                          habilitado só quando o insumo não tem tamanho próprio (`vinculoDisponivel`, decidido pela grade).
import type { KeyboardEvent } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { FornecedorSelect, type EmpresaFornecedor } from "@/components/shared/FornecedorSelect";
import { canonicoParaNumero } from "@/lib/money-mask";
import { rotuloTamanho } from "@/lib/insumo-tamanho";
import { cn } from "@/lib/utils";
import type { ColunaGrade } from "@/lib/insumo-grade/colunas";
import {
  OPCAO_VAZIA,
  alternarTamanho,
  casasDaColuna,
  controleDaCelula,
  ehTextoLongo,
  opcoesDeTamanho,
  permiteVazio,
  resumoTamanhos,
  valorVazioDoSelect,
  type OpcaoSelect,
} from "@/lib/insumo-grade/celulas";

/** Realce âmbar da célula com alteração ainda não salva (o mesmo "selo âmbar" do resto do sistema). */
const REALCE_SUJO = "border-amber-500 bg-amber-50 dark:bg-amber-500/10";

/** Realce vermelho da célula com problema (cor repetida). */
const REALCE_ERRO = "border-destructive bg-destructive/10";

/** Fornecedor = o PAR (empresa, representante): o `FornecedorSelect` grava os dois. */
export type FornecedorCelula = {
  empresas: EmpresaFornecedor[];
  empresaId: string | null;
  representanteId: string | null;
  onChange: (empresaId: string | null, representanteId: string | null) => void;
};

/** Endereço da célula para o teclado (Enter desce / Tab ao lado): `data-grade-cel` + `onKeyDown` do `useGradeTeclado`. */
export type GradeCelProps = {
  "data-grade-cel": string;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
};

export type CelulaInsumoProps = {
  coluna: ColunaGrade;
  /**
   * Valor atual do rascunho: texto/número/id; lista de chaves ("num|sigla") em `tamanhos`; chave do vínculo (ou null) em
   * `tamanho-vinculado`. Ignorado em `somente-leitura`/fornecedor.
   */
  valor?: unknown;
  onChange?: (v: unknown) => void;
  sujo?: boolean;
  desabilitado?: boolean;
  ariaLabel: string;
  /** Opções do `select`. */
  opcoes?: OpcaoSelect[];
  /** Tamanhos da grade da loja (chaves "num|sigla"): opções de `tamanhos` e de `tamanho-vinculado`. */
  tamanhosGrade?: readonly string[];
  /** Texto da célula `somente-leitura`. */
  texto?: string;
  /** Por que a célula está travada (vira o `title`). */
  dica?: string;
  /** Problema desta célula (ex.: cor repetida no insumo): fica em vermelho, com o motivo no `title`. */
  erro?: string;
  /** Coluna Fornecedor. */
  fornecedor?: FornecedorCelula;
  /** Navegação por teclado. Só vale nos campos de digitação (texto/número); Select e popover ficam de fora. */
  gradeProps?: GradeCelProps;
};

export function CelulaInsumo({
  coluna,
  valor,
  onChange,
  sujo = false,
  desabilitado = false,
  ariaLabel,
  opcoes = [],
  tamanhosGrade = [],
  texto,
  dica,
  erro,
  fornecedor,
  gradeProps,
}: CelulaInsumoProps) {
  const controle = controleDaCelula(coluna);
  // erro (vermelho) vence o selo âmbar; o `title` explica o motivo
  const realce = erro ? REALCE_ERRO : sujo ? REALCE_SUJO : undefined;
  const invalido = erro ? { "aria-invalid": true as const, title: erro } : {};

  if (controle === "somente-leitura") {
    return (
      <span
        className="block min-w-[5rem] px-2 text-muted-foreground tabular-nums"
        data-controle={controle}
        title={dica}
      >
        {texto ?? "—"}
      </span>
    );
  }

  if (controle === "tamanhos") {
    return (
      <CelulaTamanhos
        marcados={Array.isArray(valor) ? (valor as string[]) : []}
        tamanhosGrade={tamanhosGrade}
        onChange={(t) => onChange?.(t)}
        sujo={sujo}
        desabilitado={desabilitado}
        ariaLabel={ariaLabel}
        dica={dica}
      />
    );
  }

  if (controle === "tamanho-vinculado") {
    const atual = typeof valor === "string" && valor !== "" ? valor : "";
    // O vínculo salvo que não está (mais) na grade da loja continua visível, para dar para trocá-lo.
    const itens =
      atual && !tamanhosGrade.includes(atual) ? [...tamanhosGrade, atual] : [...tamanhosGrade];
    return (
      <span title={dica} className="block">
        <Select
          value={atual}
          disabled={desabilitado}
          onValueChange={(v) => onChange?.(v === OPCAO_VAZIA ? null : v)}
        >
          <SelectTrigger
            aria-label={ariaLabel}
            data-controle={controle}
            className={cn("h-8 min-w-[9rem]", realce)}
          >
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OPCAO_VAZIA}>Sem vínculo</SelectItem>
            {itens.map((t) => (
              <SelectItem key={t} value={t}>
                {rotuloTamanho(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
    );
  }

  if (coluna.key === "fornecedor" && fornecedor) {
    return (
      <span data-controle="fornecedor" className="block min-w-[11rem]">
        <FornecedorSelect
          empresas={fornecedor.empresas}
          empresaId={fornecedor.empresaId}
          representanteId={fornecedor.representanteId}
          onChange={fornecedor.onChange}
          disabled={desabilitado}
          ariaLabel={ariaLabel}
          placeholder="—"
          triggerClassName={cn("h-8", realce)}
        />
      </span>
    );
  }

  if (controle === "money") {
    return (
      <MoneyInput
        fixedDecimals
        decimals={casasDaColuna(coluna.key)}
        aria-label={ariaLabel}
        data-controle={controle}
        disabled={desabilitado}
        placeholder="0,00"
        {...gradeProps}
        className={cn("h-8 w-28 text-right tabular-nums", realce)}
        value={(valor as number | null | undefined) ?? ""}
        onChange={(e) => onChange?.(canonicoParaNumero(e.target.value))}
      />
    );
  }

  if (controle === "select") {
    const vazio = permiteVazio(coluna.key);
    const atual = valor ? String(valor) : "";
    return (
      <Select
        value={atual}
        disabled={desabilitado}
        onValueChange={(v) => onChange?.(v === OPCAO_VAZIA ? valorVazioDoSelect(coluna.key) : v)}
      >
        <SelectTrigger
          aria-label={ariaLabel}
          data-controle={controle}
          {...invalido}
          className={cn("h-8 min-w-[9rem]", realce)}
        >
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {vazio && <SelectItem value={OPCAO_VAZIA}>—</SelectItem>}
          {opcoes.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // texto longo (Observações pode ter várias linhas) → textarea que preserva as quebras
  if (ehTextoLongo(coluna.key)) {
    return (
      <Textarea
        aria-label={ariaLabel}
        data-controle="textarea"
        disabled={desabilitado}
        rows={2}
        {...gradeProps}
        // Enter aqui QUEBRA a linha (não desce). Tab (e Shift+Tab) seguem a navegação da grade.
        onKeyDown={
          gradeProps
            ? (e) => {
                if (e.key !== "Enter") gradeProps.onKeyDown(e);
              }
            : undefined
        }
        className={cn("min-h-8 min-w-[12rem] resize-y whitespace-pre-wrap py-1", realce)}
        value={(valor as string | null | undefined) ?? ""}
        onChange={(e) => onChange?.(e.target.value === "" ? null : e.target.value)}
      />
    );
  }

  // texto (linha única)
  return (
    <Input
      aria-label={ariaLabel}
      data-controle="input"
      disabled={desabilitado}
      {...gradeProps}
      className={cn("h-8 min-w-[10rem]", realce)}
      value={(valor as string | null | undefined) ?? ""}
      onChange={(e) => onChange?.(e.target.value === "" ? null : e.target.value)}
    />
  );
}

/**
 * TAMANHOS da cor = um popover com 1 checkbox por tamanho da grade (os já marcados que saíram da grade ficam na lista, para poder
 * desmarcar). O gatilho mostra o resumo ("M · 40, G · 42"). Desabilitada = formato "nenhum" (insumo sem tamanho): mostra "—".
 */
function CelulaTamanhos({
  marcados,
  tamanhosGrade,
  onChange,
  sujo,
  desabilitado,
  ariaLabel,
  dica,
}: {
  marcados: readonly string[];
  tamanhosGrade: readonly string[];
  onChange: (t: string[]) => void;
  sujo: boolean;
  desabilitado: boolean;
  ariaLabel: string;
  dica?: string;
}) {
  const opcoes = opcoesDeTamanho(tamanhosGrade, marcados);
  const resumo = resumoTamanhos(marcados, rotuloTamanho);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={desabilitado}
          aria-label={ariaLabel}
          data-controle="tamanhos"
          title={dica ?? (resumo || undefined)}
          className={cn("h-8 w-52 justify-between px-2 font-normal", sujo && REALCE_SUJO)}
        >
          <span className="truncate text-left">
            {desabilitado ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              resumo || <span className="text-muted-foreground">—</span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-2" align="start">
        <p className="px-2 pb-1 text-xs text-muted-foreground">
          Marque os tamanhos desta cor. Sem nenhum marcado, a cor vale sem tamanho.
        </p>
        <div className="max-h-56 space-y-1 overflow-y-auto overscroll-contain" data-lista-tamanhos>
          {opcoes.length === 0 ? (
            <div className="p-2 text-sm text-muted-foreground">Nenhum tamanho na grade.</div>
          ) : (
            opcoes.map((t) => (
              <label
                key={t}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
              >
                <Checkbox
                  checked={marcados.includes(t)}
                  onCheckedChange={() => onChange(alternarTamanho(marcados, t, tamanhosGrade))}
                  aria-label={`Tamanho ${rotuloTamanho(t)}`}
                  data-tamanho={t}
                />
                <span className="text-sm">{rotuloTamanho(t)}</span>
                {!tamanhosGrade.includes(t) && (
                  <span className="ml-auto text-xs text-muted-foreground">fora da grade</span>
                )}
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
