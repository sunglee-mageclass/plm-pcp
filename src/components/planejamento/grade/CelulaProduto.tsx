// Célula da grade "Lista tipo Excel" do Planejamento de Produto. Só DESENHA: o controle (texto/money/select/leitura) vem de
// `controleDaColuna`, o valor e o `onChange` vêm do rascunho da linha, e QUEM DECIDE se edita é `colunaEditavelNoProduto` (a Tabela
// traduz a decisão no `modo`). Nada grava aqui — editar só mexe no rascunho (selo âmbar quando valor ≠ base); o Salvar é da Aba.
//
// `modo`:
//  - "editar"      controle habilitado;
//  - "texto"       NÃO edita (permissão, origem, só-leitura): mostra o valor como texto cinza (barato e sem controle desabilitado);
//  - "travada"     a Integração trava este campo NESTE produto: controle DESABILITADO + selo "travado" (texto de `trava.ts` no title);
//  - "verificando" o estado da Integração ainda não chegou: controle DESABILITADO (nunca livre) até saber.
import { Lock } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { canonicoParaNumero } from "@/lib/money-mask";
import { filtrarNcm } from "@/components/planejamento/planejamento-detail/helpers";
import type { Opt } from "@/components/planejamento/modelo-shared";
import { cn } from "@/lib/utils";
import type { ColunaProduto } from "@/lib/produto-grade/colunas";
import { OPCAO_VAZIA, casasDaColuna, type ControleCelula } from "@/lib/produto-grade/celulas";

/** Realce âmbar da célula com alteração ainda não salva (o mesmo "selo âmbar" do resto do sistema). */
const REALCE_SUJO = "border-amber-500 bg-amber-50 dark:bg-amber-500/10";

/** Endereço da célula para o teclado (Enter desce / Tab ao lado): `data-grade-cel` + `onKeyDown` do `useGradeTeclado`. */
export type GradeCelProps = {
  "data-grade-cel": string;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
};

export type ModoCelula = "editar" | "texto" | "travada" | "verificando";

export type CelulaProdutoProps = {
  coluna: ColunaProduto;
  controle: ControleCelula;
  modo: ModoCelula;
  ariaLabel: string;
  /** Valor atual do rascunho (texto/número/id). */
  valor?: unknown;
  onChange?: (v: unknown) => void;
  sujo?: boolean;
  /** Opções do `select`. */
  opcoes?: Opt[];
  /** Texto da célula em modo "texto" / `somente-leitura` (já formatado: rótulo, data, "—"). */
  texto?: string | null;
  /** Texto do selo "travado" (`textoSelo`/`TEXTO_PRECO_TRAVADO`) — vira o `title` do cadeado. */
  motivoTrava?: string;
  /** Placeholder do campo (ex.: "automático" no Título/Preço anterior; o rótulo da coleção legada sem `colecao_id`). */
  placeholder?: string;
  /** Navegação por teclado: só nos campos de digitação (texto/número); Select fica de fora. */
  gradeProps?: GradeCelProps;
};

const TEXTO_VERIFICANDO = "Verificando a Integração…";

export function CelulaProduto({
  coluna,
  controle,
  modo,
  ariaLabel,
  valor,
  onChange,
  sujo = false,
  opcoes = [],
  texto,
  motivoTrava,
  placeholder,
  gradeProps,
}: CelulaProdutoProps) {
  if (controle === "somente-leitura" || modo === "texto") {
    return (
      <span
        className={cn(
          "block min-w-[5rem] truncate px-2 tabular-nums",
          controle === "somente-leitura" ? "text-muted-foreground" : "text-foreground/80",
        )}
        data-controle="somente-leitura"
        data-col-texto={coluna.key}
        title={texto ?? undefined}
      >
        {texto ?? "—"}
      </span>
    );
  }

  const desabilitado = modo !== "editar";
  const realce = sujo && !desabilitado ? REALCE_SUJO : undefined;
  const title =
    modo === "travada" ? motivoTrava : modo === "verificando" ? TEXTO_VERIFICANDO : undefined;
  const marcas =
    modo === "travada"
      ? { "data-travada": "" }
      : modo === "verificando"
        ? { "data-verificando": "" }
        : {};

  let controleEl: React.ReactNode;
  if (controle === "money") {
    controleEl = (
      <MoneyInput
        fixedDecimals
        decimals={casasDaColuna(coluna)}
        aria-label={ariaLabel}
        data-controle="money"
        disabled={desabilitado}
        placeholder={placeholder ?? "0,00"}
        title={title}
        {...gradeProps}
        {...marcas}
        className={cn("h-8 w-28 text-right tabular-nums", realce)}
        value={(valor as number | null | undefined) ?? ""}
        onChange={(e) => onChange?.(canonicoParaNumero(e.target.value))}
      />
    );
  } else if (controle === "select") {
    const atual = valor ? String(valor) : "";
    const vazioOk = coluna.key !== "tamanho_tipo";
    controleEl = (
      <Select
        value={atual}
        disabled={desabilitado}
        onValueChange={(v) => onChange?.(v === OPCAO_VAZIA ? null : v)}
      >
        <SelectTrigger
          aria-label={ariaLabel}
          data-controle="select"
          title={title}
          {...marcas}
          className={cn("h-8 min-w-[9rem]", realce)}
        >
          <SelectValue placeholder={placeholder ?? "—"} />
        </SelectTrigger>
        <SelectContent>
          {vazioOk && <SelectItem value={OPCAO_VAZIA}>—</SelectItem>}
          {opcoes.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else {
    const largo =
      coluna.key === "nome" || coluna.key === "descricao_produto" || coluna.key === "titulo_pagina";
    controleEl = (
      <Input
        aria-label={ariaLabel}
        data-controle="input"
        disabled={desabilitado}
        placeholder={placeholder}
        title={title}
        {...gradeProps}
        {...marcas}
        className={cn("h-8", largo ? "min-w-[14rem]" : "min-w-[9rem]", realce)}
        value={(valor as string | null | undefined) ?? ""}
        onChange={(e) => {
          const v = coluna.key === "ncm" ? filtrarNcm(e.target.value) : e.target.value;
          onChange?.(v === "" ? null : v);
        }}
      />
    );
  }

  if (modo !== "travada") return <>{controleEl}</>;
  return (
    <span className="inline-flex items-center gap-1.5">
      {controleEl}
      <span
        data-selo-travado
        title={motivoTrava}
        className="inline-flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase text-muted-foreground"
      >
        <Lock className="h-3 w-3" aria-hidden />
        travado
      </span>
    </span>
  );
}
