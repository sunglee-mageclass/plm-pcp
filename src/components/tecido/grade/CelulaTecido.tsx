// Célula da grade "Lista tipo Excel" de Cadastro > Tecidos. Só DESENHA: o tipo da coluna escolhe o controle
// (`controleDaCelula`), o valor e o `onChange` vêm do rascunho da linha. Nada grava aqui — editar só mexe no rascunho;
// o selo âmbar (`sujo`) vem de `valor ≠ base`. EXCEÇÃO: a Foto grava NA HORA (binário, fora do rascunho) — a célula só
// pede o upload (`foto.onEnviar`); quem grava é `useFotoVariante`.
import { useRef, type KeyboardEvent } from "react";
import { ChevronsUpDown, ImagePlus, Loader2 } from "lucide-react";
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
import { ImagePreview } from "@/components/shared/ImagePreview";
import { useSignedUrl, VARIANT_BUCKET } from "@/hooks/useSignedUrl";
import { cn } from "@/lib/utils";
import type { ColunaGrade } from "@/lib/tecido-grade/colunas";
import { OPCAO_VAZIA, casasDaColuna, controleDaCelula, permiteVazio, type OpcaoSelect } from "@/lib/tecido-grade/celulas";

/** Realce âmbar da célula com alteração ainda não salva (o mesmo "selo âmbar" do resto do sistema). */
const REALCE_SUJO = "border-amber-500 bg-amber-50 dark:bg-amber-500/10";
/** Realce vermelho da célula de linha NOVA pendente (falta dado obrigatório): a linha não vai ao servidor. */
const REALCE_ERRO = "border-destructive bg-destructive/10";
/** Realce laranja tracejado do aviso de COLAGEM: o texto colado não casou com o cadastro (ou com a regra) e NÃO foi aplicado. */
const REALCE_AVISO = "border-dashed border-orange-500 bg-orange-50 dark:bg-orange-500/10";

export type CategoriasCelula = {
  options: OpcaoSelect[];
  subcategorias: { id: string; nome: string; categoria_tecido_id: string }[];
  catIds: string[];
  subPorCat: SubPorCat;
  /** Muda as categorias marcadas E as subcategorias de uma vez (a tela faz `patch` nos dois campos do tecido). */
  onChange: (catIds: string[], subPorCat: SubPorCat) => void;
};

/** Foto da cor: miniatura (se há) + "inserir foto". Sem `onEnviar` não há botão (linha nova ou somente leitura). */
export type FotoCelula = {
  /** Caminho da foto no bucket (null = sem foto). */
  path: string | null;
  /** Subindo agora: o botão fica travado. */
  enviando?: boolean;
  /** Recebe a imagem escolhida (grava na hora). Ausente = sem botão. */
  onEnviar?: (file: File) => void;
  /** Por que não dá para enviar (linha nova): vira o `title` da célula. */
  dica?: string;
};

/** Endereço da célula para o teclado (Enter desce / Tab ao lado): `data-grade-cel` + `onKeyDown` do `useGradeTeclado`. */
export type GradeCelProps = { "data-grade-cel": string; onKeyDown: (e: KeyboardEvent<HTMLElement>) => void };

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
  /** `foto`: miniatura + botão de envio. */
  foto?: FotoCelula;
  /** Linha NOVA pendente: motivo (PT-BR) — a célula fica em vermelho com o motivo no `title`. */
  erro?: string;
  /** Aviso da última colagem nesta célula (texto não aplicado): laranja tracejado, com o motivo no `title`. Some ao editar. */
  aviso?: string;
  /** Navegação por teclado. Só vale nos campos de digitação (texto/número/composição); Select, categorias e foto ficam de fora. */
  gradeProps?: GradeCelProps;
};

export function CelulaTecido({
  coluna, valor, onChange, sujo = false, desabilitado = false, ariaLabel, opcoes = [], texto, categorias, foto, erro, aviso, gradeProps,
}: CelulaTecidoProps) {
  const controle = controleDaCelula(coluna);
  // erro (vermelho) vence o aviso de colagem (laranja), que vence o selo âmbar; `title` explica o motivo
  const realce = erro ? REALCE_ERRO : aviso ? REALCE_AVISO : sujo ? REALCE_SUJO : undefined;
  const invalido = erro
    ? { "aria-invalid": true as const, title: erro }
    : aviso
      ? { title: aviso, "data-aviso-colar": "" }
      : {};

  if (controle === "somente-leitura") {
    return <span className="block min-w-[5rem] px-2 text-muted-foreground tabular-nums" data-controle={controle}>{texto ?? "—"}</span>;
  }

  if (controle === "foto") {
    return <CelulaFoto foto={foto} ariaLabel={ariaLabel} />;
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
        {...gradeProps}
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
        {...gradeProps}
        // Composição tem várias linhas: Enter aqui QUEBRA a linha (não desce). Tab (e Shift+Tab) seguem a navegação da grade.
        onKeyDown={gradeProps ? (e) => { if (e.key !== "Enter") gradeProps.onKeyDown(e); } : undefined}
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
      {...gradeProps}
      {...invalido}
      className={cn("h-8 min-w-[10rem]", realce)}
      value={(valor as string | null | undefined) ?? ""}
      onChange={(e) => onChange?.(e.target.value === "" ? null : e.target.value)}
    />
  );
}

/** Célula Foto: clicar na miniatura amplia (lightbox); o botão abre o seletor de arquivo. */
function CelulaFoto({ foto, ariaLabel }: { foto?: FotoCelula; ariaLabel: string }) {
  const url = useSignedUrl(foto?.path ?? null, VARIANT_BUCKET);
  const inputRef = useRef<HTMLInputElement>(null);
  const temFoto = !!foto?.path;
  const podeEnviar = !!foto?.onEnviar;
  return (
    <span className="inline-flex min-w-[5rem] items-center gap-1.5 px-2" data-controle="foto" title={foto?.dica}>
      {temFoto && url ? (
        <ImagePreview src={url} alt={ariaLabel} className="h-8 w-8 shrink-0 overflow-hidden rounded border bg-muted">
          <img src={url} alt={ariaLabel} className="h-full w-full object-cover" />
        </ImagePreview>
      ) : temFoto ? (
        <span className="h-8 w-8 shrink-0 animate-pulse rounded border bg-muted" aria-label="Carregando foto" />
      ) : !podeEnviar ? (
        <span className="text-muted-foreground" aria-label="Sem foto">—</span>
      ) : null}
      {podeEnviar && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid="foto-input"
            aria-label={`Arquivo de ${ariaLabel}`}
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // permite escolher o mesmo arquivo de novo
              if (file) foto?.onEnviar?.(file);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size={temFoto ? "iconSm" : "sm"}
            className={cn(!temFoto && "h-8 gap-1 px-2 text-xs text-muted-foreground")}
            disabled={foto?.enviando}
            aria-label={temFoto ? `Trocar foto: ${ariaLabel}` : `Inserir foto: ${ariaLabel}`}
            title={temFoto ? "Trocar foto" : "Inserir foto"}
            onClick={() => inputRef.current?.click()}
          >
            {foto?.enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {!temFoto && <span>{foto?.enviando ? "Enviando…" : "inserir foto"}</span>}
          </Button>
        </>
      )}
    </span>
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
