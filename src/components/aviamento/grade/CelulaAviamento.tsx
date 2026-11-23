// Célula da grade "Lista tipo Excel" de Cadastro > Aviamentos. Só DESENHA: o tipo da coluna escolhe o controle
// (`controleDaCelula`), o valor e o `onChange` vêm do rascunho da linha. Nada grava aqui — editar só mexe no rascunho; o selo âmbar
// (`sujo`) vem de `valor ≠ base`. EXCEÇÃO: a Foto grava NA HORA (binário, fora do rascunho) — a célula só pede o upload
// (`foto.onEnviar`); quem grava é `useFotoVariante`. Espelha `CelulaTecido`, sem o popover de categorias (aqui são 3 selects simples)
// e com o `FornecedorSelect` (empresa OU empresa·representante) na coluna Fornecedor.
import { useRef, type KeyboardEvent } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { FornecedorSelect, type EmpresaFornecedor } from "@/components/shared/FornecedorSelect";
import { ImagePreview } from "@/components/shared/ImagePreview";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { canonicoParaNumero } from "@/lib/money-mask";
import { cn } from "@/lib/utils";
import type { ColunaGrade } from "@/lib/aviamento-grade/colunas";
import {
  OPCAO_VAZIA,
  casasDaColuna,
  controleDaCelula,
  ehTextoLongo,
  permiteVazio,
  type OpcaoSelect,
} from "@/lib/aviamento-grade/celulas";
import { AVIAMENTO_BUCKET } from "./useFotoVariante";

/** Realce âmbar da célula com alteração ainda não salva (o mesmo "selo âmbar" do resto do sistema). */
const REALCE_SUJO = "border-amber-500 bg-amber-50 dark:bg-amber-500/10";
/** Realce vermelho da célula de linha NOVA pendente (falta dado). */
const REALCE_ERRO = "border-destructive bg-destructive/10";
/** Realce laranja tracejado do aviso de COLAGEM: o texto colado não casou com o cadastro (ou com a regra) e NÃO foi aplicado. */
const REALCE_AVISO = "border-dashed border-orange-500 bg-orange-50 dark:bg-orange-500/10";

/** Foto da cor: miniatura (se há) + "inserir foto". Sem `onEnviar` não há botão (somente leitura). */
export type FotoCelula = {
  /** Caminho da foto no bucket (null = sem foto). */
  path: string | null;
  /** Subindo agora: o botão fica travado. */
  enviando?: boolean;
  /** Recebe a imagem escolhida (grava na hora). Ausente = sem botão. */
  onEnviar?: (file: File) => void;
  /** Por que não dá para enviar: vira o `title` da célula. */
  dica?: string;
};

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

export type CelulaAviamentoProps = {
  coluna: ColunaGrade;
  /** Valor atual do rascunho (texto/número/id). Ignorado em `foto`/`somente-leitura`/fornecedor. */
  valor?: unknown;
  onChange?: (v: unknown) => void;
  sujo?: boolean;
  desabilitado?: boolean;
  ariaLabel: string;
  /** Opções do `select`. */
  opcoes?: OpcaoSelect[];
  /** Texto da célula `somente-leitura`. */
  texto?: string;
  /** Texto-sombra do campo vazio (o Nome vazio mostra o código do aviamento). */
  placeholder?: string;
  /** Coluna Fornecedor. */
  fornecedor?: FornecedorCelula;
  /** `foto`: miniatura + botão de envio. */
  foto?: FotoCelula;
  /** Linha NOVA pendente: motivo (PT-BR) — a célula fica em vermelho com o motivo no `title`. */
  erro?: string;
  /** Aviso da última colagem nesta célula (texto não aplicado): laranja tracejado, com o motivo no `title`. Some ao editar. */
  aviso?: string;
  /** Navegação por teclado. Só vale nos campos de digitação (texto/número); Select e foto ficam de fora. */
  gradeProps?: GradeCelProps;
};

export function CelulaAviamento({
  coluna,
  valor,
  onChange,
  sujo = false,
  desabilitado = false,
  ariaLabel,
  opcoes = [],
  texto,
  placeholder,
  fornecedor,
  foto,
  erro,
  aviso,
  gradeProps,
}: CelulaAviamentoProps) {
  const controle = controleDaCelula(coluna);
  // erro (vermelho) vence o aviso de colagem (laranja), que vence o selo âmbar; `title` explica o motivo
  const realce = erro ? REALCE_ERRO : aviso ? REALCE_AVISO : sujo ? REALCE_SUJO : undefined;
  const invalido = erro
    ? { "aria-invalid": true as const, title: erro }
    : aviso
      ? { title: aviso, "data-aviso-colar": "" }
      : {};

  if (controle === "somente-leitura") {
    return (
      <span
        className={cn(
          "block min-w-[5rem] px-2 text-muted-foreground tabular-nums",
          aviso && "rounded border border-dashed border-orange-500",
        )}
        data-controle={controle}
        {...invalido}
      >
        {texto ?? "—"}
      </span>
    );
  }

  if (controle === "foto") {
    return <CelulaFoto foto={foto} ariaLabel={ariaLabel} />;
  }

  if (coluna.key === "fornecedor" && fornecedor) {
    return (
      <span data-controle="fornecedor" className="block min-w-[11rem]" {...invalido}>
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
          {opcoes.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // texto longo (Composição e Observações podem ter várias linhas) → textarea que preserva as quebras
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
      placeholder={placeholder}
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
  const url = useSignedUrl(foto?.path ?? null, AVIAMENTO_BUCKET);
  const inputRef = useRef<HTMLInputElement>(null);
  const temFoto = !!foto?.path;
  const podeEnviar = !!foto?.onEnviar;
  return (
    <span
      className="inline-flex min-w-[5rem] items-center gap-1.5 px-2"
      data-controle="foto"
      title={foto?.dica}
    >
      {temFoto && url ? (
        <ImagePreview
          src={url}
          alt={ariaLabel}
          className="h-8 w-8 shrink-0 overflow-hidden rounded border bg-muted"
        >
          <img src={url} alt={ariaLabel} className="h-full w-full object-cover" />
        </ImagePreview>
      ) : temFoto ? (
        <span
          className="h-8 w-8 shrink-0 animate-pulse rounded border bg-muted"
          aria-label="Carregando foto"
        />
      ) : !podeEnviar ? (
        <span className="text-muted-foreground" aria-label="Sem foto">
          —
        </span>
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
            {foto?.enviando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="h-4 w-4" />
            )}
            {!temFoto && <span>{foto?.enviando ? "Enviando…" : "inserir foto"}</span>}
          </Button>
        </>
      )}
    </span>
  );
}
