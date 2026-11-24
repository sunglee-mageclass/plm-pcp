// Linhas NOVAS da grade "Lista tipo Excel" de Cadastro > Insumos: um GRUPO = 1 insumo novo (cabeçalho + N cores) OU cores novas de um
// insumo que já existe. É RASCUNHO puro (estado da `InsumosGradeAba`): NADA grava aqui — o UM Salvar manda cada grupo VÁLIDO pela RPC
// `importar_insumo_linha` (variantes expandidas por cor × tamanho). Grupo incompleto = PENDENTE: fica na tela, com a célula em
// vermelho (depois que a pessoa tenta salvar), e não trava os demais. Cabeçalho herdado: as cores 2+ mostram "↳ mesmo insumo" (só a
// parte da cor edita). Espelha `AviamentoNovoGrupo`, sem apelido/foto/multi-cor; a cor leva a célula de TAMANHOS.
import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { vinculoDisponivel } from "@/lib/insumo-tamanho";
import { COLUNAS_INSUMO, indiceDaColuna, type ColunaGrade } from "@/lib/insumo-grade/colunas";
import {
  CAMPO_COR,
  CAMPO_INSUMO,
  empresasParaLinha,
  opcoesDaColuna,
  tamanhosHabilitados,
} from "@/lib/insumo-grade/celulas";
import { chaveSlotNovo } from "@/lib/insumo-grade/colar-slots";
import {
  blocoTocado,
  blocoVazio,
  problemasDaCor,
  problemasDoCabecalho,
  validarInsumoNovo,
  type BlocoNovo,
  type CabecalhoNovo,
  type InsumoNovo,
  type ProblemaNovo,
} from "@/lib/insumo-grade/linha-nova";
import { blocosEfetivos } from "@/lib/insumo-grade/salvar";
import type { GradeOpcoes } from "./useInsumosGrade";
import { CelulaInsumo, type GradeCelProps } from "./CelulaInsumo";

/** Última coluna da grade (a lixeira de cada linha cadastrada). */
export const CLASSE_COL_ACOES = "px-1.5 py-1.5";

export type AtualizarNovo = (tmp: string, fn: (g: InsumoNovo) => InsumoNovo) => void;

type GrupoProps = {
  grupo: InsumoNovo;
  opcoes: GradeOpcoes;
  /** Depois de tentar salvar: os pendentes ficam em vermelho. */
  mostrarPendencias: boolean;
  /** Erro devolvido pelo servidor ao gravar este grupo (PT-BR). */
  erro?: string;
  onChange: AtualizarNovo;
  onRemover: (tmp: string) => void;
  /** Avisos da última colagem (`<linha>|<coluna>`) e como apagar um ao editar a célula. */
  avisos?: Record<string, string>;
  onLimparAviso?: (chaveCelula: string) => void;
  /** Teclado: posição GLOBAL da 1ª linha deste grupo na grade e o endereçador de células. Ausentes = sem navegação. */
  inicio?: number;
  propsCel?: (linha: number, coluna: number) => GradeCelProps;
};

const SEM_AVISOS: Record<string, string> = {};

function EstadoNovo({
  erro,
  pendencia,
  podeRemover,
  onRemover,
  rotuloRemover,
}: {
  erro?: string;
  pendencia?: string;
  podeRemover: boolean;
  onRemover: () => void;
  rotuloRemover: string;
}): ReactNode {
  const aviso = erro ?? pendencia;
  return (
    <span className="flex items-center justify-center gap-1">
      {aviso ? (
        <span role="alert" title={aviso} data-erro-linha>
          <AlertTriangle
            className="h-4 w-4 text-destructive"
            aria-label={`Não vai ser salva: ${aviso}`}
          />
        </span>
      ) : (
        <span
          role="status"
          title="Linha nova (rascunho): grava no Salvar"
          data-selo-novo
          className="inline-block h-2 w-2 rounded-full bg-amber-500"
        />
      )}
      {podeRemover && (
        <button
          type="button"
          onClick={onRemover}
          aria-label={rotuloRemover}
          title={rotuloRemover}
          data-acao="remover-linha-nova"
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

/** Linhas (<tr>) do grupo novo. O chamador envolve em <tbody> (insumo novo) ou as encaixa no <tbody> do insumo existente. */
export function LinhasInsumoNovo({
  grupo: g,
  opcoes,
  mostrarPendencias,
  erro,
  onChange,
  onRemover,
  avisos = SEM_AVISOS,
  onLimparAviso,
  inicio = 0,
  propsCel,
}: GrupoProps) {
  const { problemas } = validarInsumoNovo(g);
  const alvo = g.insumoAlvoId != null;
  const primeiraRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    // o grupo acabou de nascer: leva a vista até ele (a grade rola dentro do próprio container). Grupo de colagem em lote
    // não rola (só o 1º): 500 rolagens seguidas travam a tela.
    if (!g.semRolagem) primeiraRef.current?.scrollIntoView?.({ block: "nearest" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const patchCab = (k: keyof CabecalhoNovo, v: unknown) =>
    onChange(g.tmp, (x) => ({ ...x, cab: { ...x.cab, [k]: v } as CabecalhoNovo }));
  const patchBloco = (tmp: string, fn: (b: BlocoNovo) => BlocoNovo) =>
    onChange(g.tmp, (x) => ({ ...x, blocos: x.blocos.map((b) => (b.tmp === tmp ? fn(b) : b)) }));
  const removerBloco = (tmp: string) => {
    if (g.blocos.length <= 1) onRemover(g.tmp);
    else onChange(g.tmp, (x) => ({ ...x, blocos: x.blocos.filter((b) => b.tmp !== tmp) }));
  };
  const nomeInsumo = g.cab.nome ?? "insumo";
  const vermelho = (lista: ProblemaNovo[], campo: string): string | undefined =>
    mostrarPendencias ? lista.find((p) => p.campo === campo)?.msg : undefined;

  const gradeDe = (linhaIdx: number, col: ColunaGrade) =>
    propsCel?.(linhaIdx, indiceDaColuna(col.key));

  const celulaCabecalho = (
    col: ColunaGrade,
    primeira: boolean,
    chaveSlot: string,
    linhaIdx: number,
  ) => {
    if (alvo || !primeira) {
      return col.key === "nome" ? (
        <span className="whitespace-nowrap px-2 text-xs text-muted-foreground" data-herdado>
          ↳ mesmo insumo
        </span>
      ) : null;
    }
    const ariaLabel = `${col.rotulo} do insumo novo`;
    const chaveAv = `${chaveSlot}|${col.key}`;
    const erroCab = vermelho(problemasDoCabecalho(problemas), col.key);
    if (col.key === "fornecedor") {
      return (
        <CelulaInsumo
          coluna={col}
          ariaLabel={ariaLabel}
          aviso={avisos[chaveAv]}
          fornecedor={{
            empresas: empresasParaLinha(opcoes.empresas, g.cab.empresa_id),
            empresaId: g.cab.empresa_id,
            representanteId: g.cab.representante_id,
            onChange: (empresaId, representanteId) => {
              onLimparAviso?.(chaveAv);
              patchCab("empresa_id", empresaId);
              patchCab("representante_id", representanteId);
            },
          }}
        />
      );
    }
    if (col.key === "tamanho_vinculado") {
      const disponivel = vinculoDisponivel(
        g.cab.formato_tamanho,
        blocosEfetivos(g.cab.formato_tamanho, g.blocos.filter(blocoTocado)),
      );
      return (
        <CelulaInsumo
          coluna={col}
          ariaLabel={ariaLabel}
          valor={g.cab.vincular ? g.cab.tamanho_vinculado : null}
          onChange={(v) => {
            patchCab("vincular", v != null);
            patchCab("tamanho_vinculado", (v as string | null) ?? null);
          }}
          erro={erroCab}
          desabilitado={!col.editavel || !disponivel}
          dica={
            disponivel
              ? undefined
              : 'Só vale em insumo sem tamanho próprio: formato "Nenhum" ou nenhuma cor com tamanho marcado.'
          }
          tamanhosGrade={opcoes.tamanhosGrade}
        />
      );
    }
    const campo = CAMPO_INSUMO[col.key];
    if (!campo) return null;
    const k = campo as keyof CabecalhoNovo;
    return (
      <CelulaInsumo
        coluna={col}
        ariaLabel={ariaLabel}
        valor={g.cab[k]}
        onChange={(v) => {
          onLimparAviso?.(chaveAv);
          patchCab(k, v);
        }}
        erro={erroCab}
        aviso={avisos[chaveAv]}
        desabilitado={!col.editavel}
        opcoes={opcoesDaColuna(col.key, opcoes)}
        gradeProps={gradeDe(linhaIdx, col)}
      />
    );
  };

  const celulaCor = (col: ColunaGrade, b: BlocoNovo, idx: number) => {
    const chaveAv = `${chaveSlotNovo(b.tmp)}|${col.key}`;
    const probs = problemasDaCor(problemas, b.tmp);
    const ariaLabel = alvo
      ? `${col.rotulo} da cor nova ${idx + 1} de ${nomeInsumo}`
      : `${col.rotulo} da cor ${idx + 1} do insumo novo`;
    const campo = CAMPO_COR[col.key];
    if (!campo) return null;
    const aoMudar = (valor: unknown) => {
      onLimparAviso?.(chaveAv);
      patchBloco(b.tmp, (x) => ({ ...x, [campo]: valor }) as BlocoNovo);
    };
    if (col.key === "tamanhos") {
      const habilitada = tamanhosHabilitados(g.cab.formato_tamanho);
      return (
        <CelulaInsumo
          coluna={col}
          ariaLabel={ariaLabel}
          valor={b.tamanhos}
          onChange={aoMudar}
          aviso={avisos[chaveAv]}
          desabilitado={!col.editavel || !habilitada}
          dica={habilitada ? undefined : 'Formato "Nenhum": o insumo não tem tamanho.'}
          tamanhosGrade={opcoes.tamanhosGrade}
        />
      );
    }
    return (
      <CelulaInsumo
        coluna={col}
        ariaLabel={ariaLabel}
        valor={b[campo]}
        onChange={aoMudar}
        erro={vermelho(probs, col.key)}
        aviso={avisos[chaveAv]}
        desabilitado={!col.editavel}
        opcoes={opcoesDaColuna(col.key, opcoes)}
        gradeProps={gradeDe(inicio + idx, col)}
      />
    );
  };

  return (
    <>
      {g.blocos.map((b, i) => {
        const primeira = i === 0;
        const probsLinha = [
          ...(primeira ? problemasDoCabecalho(problemas) : []),
          ...problemasDaCor(problemas, b.tmp),
        ];
        const pendencia =
          mostrarPendencias && probsLinha.length
            ? probsLinha.map((p) => p.msg).join("; ")
            : undefined;
        return (
          <tr
            key={b.tmp}
            ref={primeira ? primeiraRef : undefined}
            className={
              primeira && !alvo
                ? "border-t-2 border-border align-middle bg-amber-50/40 dark:bg-amber-500/5"
                : "border-t border-dashed align-middle bg-amber-50/40 dark:bg-amber-500/5"
            }
            data-linha-nova={g.tmp}
            data-cor-nova={b.tmp}
            data-slot={chaveSlotNovo(b.tmp)}
          >
            <td className="w-10 px-1 py-1.5 text-center">
              <EstadoNovo
                erro={primeira ? erro : undefined}
                pendencia={pendencia}
                podeRemover={alvo || g.blocos.length > 1}
                onRemover={() => removerBloco(b.tmp)}
                rotuloRemover={
                  alvo && g.blocos.length <= 1 ? "Descartar a cor nova" : "Remover esta cor"
                }
              />
            </td>
            {COLUNAS_INSUMO.map((col) => (
              <td key={col.key} className="px-1.5 py-1.5" data-col={col.key}>
                {col.escopo === "insumo"
                  ? celulaCabecalho(col, primeira, chaveSlotNovo(b.tmp), inicio + i)
                  : celulaCor(col, b, i)}
              </td>
            ))}
            <td className={CLASSE_COL_ACOES} />
          </tr>
        );
      })}
      <tr data-acoes-novo={g.tmp} className="bg-amber-50/40 dark:bg-amber-500/5">
        <td />
        <td colSpan={COLUNAS_INSUMO.length + 1} className="px-1.5 pb-2 pt-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-acao="adicionar-cor-nova"
              onClick={() =>
                onChange(g.tmp, (x) => ({ ...x, blocos: [...x.blocos, blocoVazio()] }))
              }
            >
              <Plus className="mr-1 h-4 w-4" /> adicionar cor
            </Button>
            {!alvo && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-acao="descartar-insumo-novo"
                onClick={() => onRemover(g.tmp)}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Descartar insumo novo
              </Button>
            )}
            {erro && (
              <span role="alert" className="text-xs text-destructive">
                {erro}
              </span>
            )}
          </div>
        </td>
      </tr>
    </>
  );
}
