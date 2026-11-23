// Linhas NOVAS da grade "Lista tipo Excel" de Cadastro > Aviamentos: um GRUPO = 1 aviamento novo (cabeçalho + N cores) OU cores novas
// de um aviamento que já existe. É RASCUNHO puro (estado da `AviamentosGradeAba`): NADA grava aqui — o UM Salvar manda cada grupo
// VÁLIDO pela RPC `importar_aviamento_linha`. Grupo incompleto = PENDENTE: fica na tela, com a célula em vermelho (depois que a
// pessoa tenta salvar), e não trava os demais. Cabeçalho herdado: as cores 2+ mostram "↳ mesmo aviamento" (só a parte da cor edita).
// O `codigo` NÃO se digita aqui: o gatilho do banco o gera no INSERT (a partir da categoria).
import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COLUNAS_AVIAMENTO, indiceDaColuna, type ColunaGrade } from "@/lib/aviamento-grade/colunas";
import {
  CAMPO_AVIAMENTO,
  CAMPO_VARIANTE,
  empresasParaLinha,
  opcoesDaColuna,
  subcategoriaAposTrocarCategoria,
} from "@/lib/aviamento-grade/celulas";
import {
  adicionarCoresAoGrupo,
  problemasDaVariante,
  problemasDoCabecalho,
  semCategoria,
  trocarApelido,
  trocarCorBase,
  validarAviamentoNovo,
  varianteVazia,
  type AviamentoNovo,
  type CabecalhoNovo,
  type ProblemaNovo,
  type VarianteNova,
} from "@/lib/aviamento-grade/linha-nova";
import { chaveSlotNovo } from "@/lib/aviamento-grade/colar-slots";
import { CelulaCorBaseMulti } from "@/components/tecido/grade/CelulaCorBaseMulti";
import type { GradeOpcoes } from "./useAviamentosGrade";
import { CelulaAviamento, type GradeCelProps } from "./CelulaAviamento";

/** Última coluna da grade (a lixeira de cada linha). */
export const CLASSE_COL_ACOES = "px-1.5 py-1.5";

/** A foto grava na hora e precisa do id da cor: linha nova só ganha foto depois de salvar o aviamento. */
const DICA_FOTO_NOVA = "A foto fica disponível depois de salvar o aviamento";

export type AtualizarNovo = (tmp: string, fn: (g: AviamentoNovo) => AviamentoNovo) => void;

type GrupoProps = {
  grupo: AviamentoNovo;
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
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

/** Linhas (<tr>) do grupo novo. O chamador envolve em <tbody> (aviamento novo) ou as encaixa no <tbody> do aviamento existente. */
export function LinhasAviamentoNovo({
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
  const { problemas } = validarAviamentoNovo(g);
  const alvo = g.aviamentoAlvoId != null;
  const primeiraRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    // o grupo acabou de nascer: leva a vista até ele (a grade rola dentro do próprio container). Grupo de colagem em lote
    // não rola (só o 1º): 500 rolagens seguidas travam a tela.
    if (!g.semRolagem) primeiraRef.current?.scrollIntoView?.({ block: "nearest" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const patchCab = (k: keyof CabecalhoNovo, v: unknown) =>
    onChange(g.tmp, (x) => ({ ...x, cab: { ...x.cab, [k]: v } as CabecalhoNovo }));
  const patchVar = (varTmp: string, fn: (v: VarianteNova) => VarianteNova) =>
    onChange(g.tmp, (x) => ({ ...x, vars: x.vars.map((v) => (v.tmp === varTmp ? fn(v) : v)) }));
  const removerVar = (varTmp: string) => {
    if (g.vars.length <= 1) onRemover(g.tmp);
    else onChange(g.tmp, (x) => ({ ...x, vars: x.vars.filter((v) => v.tmp !== varTmp) }));
  };
  const nomeAviamento = g.cab.codigo_nome ?? "aviamento";
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
      return col.key === "codigo_nome" ? (
        <span className="whitespace-nowrap px-2 text-xs text-muted-foreground" data-herdado>
          ↳ mesmo aviamento
        </span>
      ) : null;
    }
    const ariaLabel = `${col.rotulo} do aviamento novo`;
    if (col.key === "codigo") {
      // gerado pelo servidor no INSERT (SIGLA-NNNN da categoria): aqui só se explica
      return (
        <CelulaAviamento
          coluna={{ ...col, editavel: false }}
          ariaLabel={ariaLabel}
          texto={g.cab.categoria_aviamento_id ? "automático" : "sem categoria"}
          aviso={avisos[`${chaveSlot}|codigo`]}
        />
      );
    }
    const erroCab = vermelho(problemasDoCabecalho(problemas), col.key);
    if (col.key === "fornecedor") {
      return (
        <CelulaAviamento
          coluna={col}
          ariaLabel={ariaLabel}
          fornecedor={{
            empresas: empresasParaLinha(opcoes.empresas, g.cab.empresa_id),
            empresaId: g.cab.empresa_id,
            representanteId: g.cab.representante_id,
            onChange: (empresaId, representanteId) => {
              patchCab("empresa_id", empresaId);
              patchCab("representante_id", representanteId);
            },
          }}
        />
      );
    }
    const campo = CAMPO_AVIAMENTO[col.key];
    if (!campo) return null;
    const k = campo as keyof CabecalhoNovo;
    const chaveAv = `${chaveSlot}|${col.key}`;
    return (
      <CelulaAviamento
        coluna={col}
        ariaLabel={ariaLabel}
        valor={g.cab[k]}
        onChange={(v) => {
          onLimparAviso?.(chaveAv);
          if (col.key === "categoria") {
            // A subcategoria cascateia pela categoria: a que não pertence à nova sai junto.
            onChange(g.tmp, (x) => ({
              ...x,
              cab: {
                ...x.cab,
                categoria_aviamento_id: (v as string | null) ?? null,
                subcategoria_aviamento_id: subcategoriaAposTrocarCategoria(
                  (v as string | null) ?? null,
                  x.cab.subcategoria_aviamento_id,
                  opcoes.subcategorias,
                ),
              },
            }));
          } else patchCab(k, v);
        }}
        erro={erroCab}
        aviso={avisos[chaveAv]}
        desabilitado={!col.editavel}
        opcoes={opcoesDaColuna(col.key, opcoes, { categoriaId: g.cab.categoria_aviamento_id })}
        gradeProps={gradeDe(linhaIdx, col)}
      />
    );
  };

  const celulaVariante = (col: ColunaGrade, v: VarianteNova, idx: number) => {
    const chaveAv = `${chaveSlotNovo(v.tmp)}|${col.key}`;
    const probs = problemasDaVariante(problemas, v.tmp);
    const ariaLabel = alvo
      ? `${col.rotulo} da cor nova ${idx + 1} de ${nomeAviamento}`
      : `${col.rotulo} da cor ${idx + 1} do aviamento novo`;
    if (col.key === "foto")
      return (
        <CelulaAviamento
          coluna={col}
          ariaLabel={ariaLabel}
          foto={{ path: null, dica: DICA_FOTO_NOVA }}
        />
      );
    const campo = CAMPO_VARIANTE[col.key];
    if (!campo) return null;
    const aoMudar = (valor: unknown) => {
      onLimparAviso?.(chaveAv);
      if (col.key === "cor_base")
        patchVar(v.tmp, (x) => trocarCorBase(x, String(valor ?? ""), opcoes.coresApelido));
      else if (col.key === "cor_apelido")
        patchVar(v.tmp, (x) => trocarApelido(x, String(valor ?? ""), opcoes.coresApelido));
      else patchVar(v.tmp, (x) => ({ ...x, [campo]: valor }) as VarianteNova);
    };
    const celula = (
      <CelulaAviamento
        coluna={col}
        ariaLabel={ariaLabel}
        valor={v[campo]}
        onChange={aoMudar}
        erro={vermelho(probs, col.key)}
        aviso={avisos[chaveAv]}
        desabilitado={!col.editavel}
        opcoes={opcoesDaColuna(col.key, opcoes, { corId: v.cor_id })}
        gradeProps={gradeDe(inicio + idx, col)}
      />
    );
    // Linha-PAI de um aviamento NOVO: além do Select de 1 cor, a seleção MÚLTIPLA (cada cor marcada vira uma linha-filha com o
    // preço do aviamento). Nas cores 2+ (e nas "cores novas" de aviamento existente) a célula segue sendo o Select simples.
    if (col.key === "cor_base" && idx === 0 && !alvo) {
      return (
        <CelulaCorBaseMulti
          cores={opcoes.cores}
          presentes={g.vars.map((x) => x.cor_id).filter(Boolean)}
          onAdicionar={(ids) => onChange(g.tmp, (x) => adicionarCoresAoGrupo(x, ids, x.cab.preco))}
          ariaLabel="Adicionar várias cores do aviamento novo"
          desabilitado={!col.editavel}
          entidade="aviamento"
        >
          {celula}
        </CelulaCorBaseMulti>
      );
    }
    return celula;
  };

  return (
    <>
      {g.vars.map((v, i) => {
        const primeira = i === 0;
        const probsLinha = [
          ...(primeira ? problemasDoCabecalho(problemas) : []),
          ...problemasDaVariante(problemas, v.tmp),
        ];
        const pendencia =
          mostrarPendencias && probsLinha.length
            ? probsLinha.map((p) => p.msg).join("; ")
            : undefined;
        return (
          <tr
            key={v.tmp}
            ref={primeira ? primeiraRef : undefined}
            className={
              primeira && !alvo
                ? "border-t-2 border-border align-middle bg-amber-50/40 dark:bg-amber-500/5"
                : "border-t border-dashed align-middle bg-amber-50/40 dark:bg-amber-500/5"
            }
            data-linha-nova={g.tmp}
            data-variante-nova={v.tmp}
            data-slot={chaveSlotNovo(v.tmp)}
          >
            <td className="w-10 px-1 py-1.5 text-center">
              <EstadoNovo
                erro={primeira ? erro : undefined}
                pendencia={pendencia}
                podeRemover={alvo || g.vars.length > 1}
                onRemover={() => removerVar(v.tmp)}
                rotuloRemover={
                  alvo && g.vars.length <= 1 ? "Descartar a cor nova" : "Remover esta cor"
                }
              />
            </td>
            {COLUNAS_AVIAMENTO.map((col) => (
              <td key={col.key} className="px-1.5 py-1.5" data-col={col.key}>
                {col.escopo === "aviamento"
                  ? celulaCabecalho(col, primeira, chaveSlotNovo(v.tmp), inicio + i)
                  : celulaVariante(col, v, i)}
              </td>
            ))}
            <td className={CLASSE_COL_ACOES} />
          </tr>
        );
      })}
      <tr data-acoes-novo={g.tmp} className="bg-amber-50/40 dark:bg-amber-500/5">
        <td />
        <td colSpan={COLUNAS_AVIAMENTO.length + 1} className="px-1.5 pb-2 pt-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange(g.tmp, (x) => ({ ...x, vars: [...x.vars, varianteVazia()] }))}
            >
              <Plus className="mr-1 h-4 w-4" /> adicionar variante (cor)
            </Button>
            {!alvo && (
              <Button type="button" size="sm" variant="ghost" onClick={() => onRemover(g.tmp)}>
                <Trash2 className="mr-1 h-4 w-4" /> Descartar aviamento novo
              </Button>
            )}
            {!alvo && semCategoria(g) && (
              <span className="text-xs text-muted-foreground" data-aviso-sem-categoria>
                Sem categoria o aviamento é criado sem código (o código nasce da categoria).
              </span>
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
