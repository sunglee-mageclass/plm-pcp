// Célula da grade "Lista tipo Excel" de Cadastro > Tecidos. Só DESENHA: o tipo da coluna escolhe o controle
// (`controleDaCelula`), o valor e o `onChange` vêm do rascunho da linha. Nada grava aqui — editar só mexe no rascunho;
// o selo âmbar (`sujo`) vem de `valor ≠ base`. Foto é só leitura por ora (a Task 9 liga a edição).
import { ChevronsUpDown, Image as ImageIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { CategoriasTecidoLista } from "@/components/tecido/CategoriasTecidoMultiSelect";
import { canonicoParaNumero } from "@/routes/_authenticated/cadastro.tecidos.$artigoId";
import { definirSub, podarSubs, type SubPorCat } from "@/lib/tecido-subcategoria";
import { cn } from "@/lib/utils";
import type { ColunaGrade } from "@/lib/tecido-grade/colunas";
import { OPCAO_VAZIA, casasDaColuna, controleDaCelula, permiteVazio, type OpcaoSelect } from "@/lib/tecido-grade/celulas";

/** Realce âmbar da célula com alteração ainda não salva (o mesmo "selo âmbar" do resto do sistema). */
const REALCE_SUJO = "border-amber-500 bg-amber-50 dark:bg-amber-500/10";
/** Realce vermelho da célula de linha NOVA pendente (falta dado obrigatório): a linha não vai ao servidor. */
const REALCE_ERRO = "border-destructive bg-destructive/10";

export type CategoriasCelula = {
  options: OpcaoSelect[];
  subcategorias: { id: string; nome: string; categoria_tecido_id: string }[];
  catIds: string[];
  subPorCat: SubPorCat;
  /** Muda as categorias marcadas E as subcategorias de uma vez (a tela faz `patch` nos dois campos do tecido). */
  onChange: (catIds: string[], subPorCat: SubPorCat) => void;
};

export type CelulaTecidoProps = {
  coluna: ColunaGrade;
  /** Valor atual do rascunho (texto/número/id). Ignorado em `categorias`/`foto`/`somente-leitura`. */
  valor?: unknown;
  onChange?: (v: unknown) => void;
  sujo?: boolean;
  desabilitado?: boolean;
  ariaLabel: string;
  /** Opções do `select`. */
  opcoes?: OpcaoSelect[];
  /** Texto da célula `somente-leitura`. */
  texto?: string;
  /** Dados do popover de categorias. */
  categorias?: CategoriasCelula;
  /** `foto`: a cor tem foto? */
  temFoto?: boolean;
  /** Linha NOVA pendente: motivo (PT-BR) — a célula fica em vermelho com o motivo no `title`. */
  erro?: string;
};

export function CelulaTecido({
  coluna, valor, onChange, sujo = false, desabilitado = false, ariaLabel, opcoes = [], texto, categorias, temFoto, erro,
}: CelulaTecidoProps) {
  const controle = controleDaCelula(coluna);
  // erro (vermelho) vence o selo âmbar; `title` explica o motivo
  const realce = erro ? REALCE_ERRO : sujo ? REALCE_SUJO : undefined;
  const invalido = erro ? { "aria-invalid": true as const, title: erro } : {};

  if (controle === "somente-leitura") {
    return <span className="block min-w-[5rem] px-2 text-muted-foreground tabular-nums" data-controle={controle}>{texto ?? "—"}</span>;
  }

  if (controle === "foto") {
    return (
      <span
        className="inline-flex items-center px-2 text-muted-foreground"
        data-controle={controle}
        title={temFoto ? "Tem foto (a edição da foto chega na próxima etapa)" : "Sem foto"}
      >
        {temFoto ? <ImageIcon className="h-4 w-4" aria-label="Tem foto" /> : <span aria-label="Sem foto">—</span>}
      </span>
    );
  }

  if (controle === "categorias" && categorias) {
    return <CelulaCategorias dados={categorias} sujo={sujo} desabilitado={desabilitado} ariaLabel={ariaLabel} />;
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
        {...invalido}
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
        onValueChange={(v) => onChange?.(v === OPCAO_VAZIA ? (vazio ? null : "") : v)}
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
          {opcoes.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }

  // texto longo (Composição pode ter várias linhas: "95% Viscose\n5% Elastano") → textarea que
  // preserva as quebras; sem ele o <input> de 1 linha cola tudo sem espaçamento.
  if (coluna.key === "composicao") {
    return (
      <Textarea
        aria-label={ariaLabel}
        data-controle="textarea"
        disabled={desabilitado}
        rows={2}
        {...invalido}
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
      {...invalido}
      className={cn("h-8 min-w-[10rem]", realce)}
      value={(valor as string | null | undefined) ?? ""}
      onChange={(e) => onChange?.(e.target.value === "" ? null : e.target.value)}
    />
  );
}

const SUB_NENHUMA = "__nenhuma__";

/**
 * CATEGORIAS (N:N) = UM único popover: a lista de categorias do Sheet (`CategoriasTecidoLista`) e, para cada categoria
 * marcada, o Select da subcategoria. O gatilho mostra os chips "Categoria › Sub".
 */
export function CelulaCategorias({ dados, sujo, desabilitado, ariaLabel }: {
  dados: CategoriasCelula; sujo: boolean; desabilitado: boolean; ariaLabel: string;
}) {
  const { options, subcategorias, catIds, subPorCat, onChange } = dados;
  const nomeCat = (id: string) => options.find((o) => o.id === id)?.nome ?? "—";
  const rotulo = catIds
    .map((cid) => {
      const sub = subcategorias.find((s) => s.id === subPorCat[cid])?.nome;
      return sub ? `${nomeCat(cid)} › ${sub}` : nomeCat(cid);
    })
    .join(", ");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={desabilitado}
          aria-label={ariaLabel}
          data-controle="categorias"
          title={rotulo || undefined}
          className={cn("h-8 w-56 justify-between px-2 font-normal", sujo && REALCE_SUJO)}
        >
          <span className="truncate text-left">{rotulo || <span className="text-muted-foreground">—</span>}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        <CategoriasTecidoLista
          options={options}
          value={catIds}
          onChange={(ids) => onChange(ids, podarSubs(subPorCat, ids))}
        />
        {catIds.length > 0 && (
          <ul className="mt-2 space-y-1.5 border-t pt-2">
            {catIds.map((cid) => {
              const nome = nomeCat(cid);
              const subs = subcategorias.filter((s) => s.categoria_tecido_id === cid);
              return (
                <li key={cid} className="flex items-center gap-2" data-testid={`sub-cat-${cid}`}>
                  <Badge variant="secondary" className="shrink-0">{nome}</Badge>
                  {subs.length === 0 ? (
                    <span className="text-xs text-muted-foreground">sem subcategorias</span>
                  ) : (
                    <Select
                      value={subPorCat[cid] ?? SUB_NENHUMA}
                      onValueChange={(v) => onChange(catIds, definirSub(subPorCat, cid, v === SUB_NENHUMA ? null : v))}
                    >
                      <SelectTrigger className="h-8 min-w-0 flex-1" aria-label={`Subcategoria de ${nome}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SUB_NENHUMA}>Sem subcategoria</SelectItem>
                        {subs.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
