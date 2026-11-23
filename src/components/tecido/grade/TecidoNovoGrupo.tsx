// Linhas NOVAS da grade "Lista tipo Excel" de Cadastro > Tecidos: um GRUPO = 1 tecido novo (cabeçalho + N cores) OU cores novas
// de um tecido que já existe. É RASCUNHO puro (estado da `TecidosGradeAba`): NADA grava aqui — o UM Salvar manda cada grupo
// VÁLIDO pela RPC `importar_tecido_linha`. Grupo incompleto = PENDENTE: fica na tela, com a célula em vermelho (depois que a
// pessoa tenta salvar), e não trava os demais. Cabeçalho herdado: as cores 2+ mostram "↳ mesmo tecido" (só a parte da cor edita).
import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COLUNAS_TECIDO, type ColunaGrade } from "@/lib/tecido-grade/colunas";
import {
  CAMPO_ARTIGO,
  CAMPO_VARIANTE,
  celulaDesabilitadaPorRegra,
  controleDaCelula,
  opcoesDaColuna,
  precoPorMetroTexto,
} from "@/lib/tecido-grade/celulas";
import {
  adicionarCoresAoGrupo,
  problemasDaVariante,
  problemasDoCabecalho,
  trocarApelido,
  trocarCorBase,
  validarTecidoNovo,
  varianteVazia,
  type CabecalhoNovo,
  type NumeroEntrada,
  type ProblemaNovo,
  type TecidoNovo,
  type VarianteNova,
} from "@/lib/tecido-grade/linha-nova";
import { chaveSlotNovo } from "@/lib/tecido-grade/colar-slots";
import type { SubPorCat } from "@/lib/tecido-subcategoria";
import type { GradeOpcoes } from "./useTecidosGrade";
import { CelulaTecido } from "./CelulaTecido";
import { CelulaCorBaseMulti } from "./CelulaCorBaseMulti";

/** Última coluna da grade (ações de excluir): FIXA na direita, para o botão ficar à mão sem rolar a tabela até o fim. */
export const CLASSE_COL_ACOES = "sticky right-0 z-10 bg-background px-1.5 py-1.5 shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.15)]";

/** A foto grava na hora e precisa do id da cor: linha nova só ganha foto depois de salvar o tecido. */
const DICA_FOTO_NOVA = "A foto fica disponível depois de salvar o tecido";

export type AtualizarNovo = (tmp: string, fn: (g: TecidoNovo) => TecidoNovo) => void;

const numeroOuNulo = (v: NumeroEntrada): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

type GrupoProps = {
  grupo: TecidoNovo;
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
};

const SEM_AVISOS: Record<string, string> = {};

function EstadoNovo({ erro, pendencia, podeRemover, onRemover, rotuloRemover }: {
  erro?: string; pendencia?: string; podeRemover: boolean; onRemover: () => void; rotuloRemover: string;
}): ReactNode {
  const aviso = erro ?? pendencia;
  return (
    <span className="flex items-center justify-center gap-1">
      {aviso ? (
        <span role="alert" title={aviso} data-erro-linha>
          <AlertTriangle className="h-4 w-4 text-destructive" aria-label={`Não vai ser salva: ${aviso}`} />
        </span>
      ) : (
        <span role="status" title="Linha nova (rascunho): grava no Salvar" data-selo-novo className="inline-block h-2 w-2 rounded-full bg-amber-500" />
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

/** Linhas (<tr>) do grupo novo. O chamador envolve em <tbody> (tecido novo) ou as encaixa no <tbody> do tecido existente. */
export function LinhasTecidoNovo({ grupo: g, opcoes, mostrarPendencias, erro, onChange, onRemover, avisos = SEM_AVISOS, onLimparAviso }: GrupoProps) {
  const { problemas } = validarTecidoNovo(g);
  const alvo = g.artigoAlvoId != null;
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
  const nomeTecido = g.cab.nome ?? "tecido";
  const vermelho = (lista: ProblemaNovo[], campo: string): string | undefined =>
    mostrarPendencias ? lista.find((p) => p.campo === campo)?.msg : undefined;

  const celulaArtigo = (col: ColunaGrade, primeira: boolean, chaveSlot: string) => {
    if (alvo || !primeira) {
      return col.key === "nome" ? (
        <span className="whitespace-nowrap px-2 text-xs text-muted-foreground" data-herdado>↳ mesmo tecido</span>
      ) : null;
    }
    const ariaLabel = `${col.rotulo} do tecido novo`;
    if (col.key === "preco_por_metro") {
      return (
        <CelulaTecido
          coluna={col}
          ariaLabel={ariaLabel}
          texto={precoPorMetroTexto({
            unidade_medida: g.cab.unidade_medida ?? "metro",
            preco: numeroOuNulo(g.cab.preco),
            rendimento: numeroOuNulo(g.cab.rendimento),
          })}
        />
      );
    }
    const erroCab = vermelho(problemasDoCabecalho(problemas), col.key);
    if (controleDaCelula(col) === "categorias") {
      return (
        <CelulaTecido
          coluna={col}
          ariaLabel={ariaLabel}
          categorias={{
            options: opcoes.categorias,
            subcategorias: opcoes.subcategorias,
            catIds: g.categoriaIds,
            subPorCat: g.subPorCat,
            onChange: (ids: string[], subs: SubPorCat) => onChange(g.tmp, (x) => ({ ...x, categoriaIds: ids, subPorCat: subs })),
          }}
        />
      );
    }
    const campo = CAMPO_ARTIGO[col.key];
    if (!campo) return null;
    const k = campo as keyof CabecalhoNovo;
    const chaveAv = `${chaveSlot}|${col.key}`;
    return (
      <CelulaTecido
        coluna={col}
        ariaLabel={ariaLabel}
        valor={g.cab[k]}
        onChange={(v) => {
          patchCab(k, v);
          onLimparAviso?.(chaveAv);
        }}
        erro={erroCab}
        aviso={avisos[chaveAv]}
        desabilitado={!col.editavel || celulaDesabilitadaPorRegra(col.key, { unidade_medida: g.cab.unidade_medida ?? "metro" })}
        opcoes={opcoesDaColuna(col.key, opcoes)}
      />
    );
  };

  const celulaVariante = (col: ColunaGrade, v: VarianteNova, idx: number) => {
    const chaveAv = `${chaveSlotNovo(v.tmp)}|${col.key}`;
    const probs = problemasDaVariante(problemas, v.tmp);
    const ariaLabel = alvo ? `${col.rotulo} da cor nova ${idx + 1} de ${nomeTecido}` : `${col.rotulo} da cor ${idx + 1} do tecido novo`;
    if (col.key === "foto") return <CelulaTecido coluna={col} ariaLabel={ariaLabel} foto={{ path: null, dica: DICA_FOTO_NOVA }} />;
    const campo = CAMPO_VARIANTE[col.key];
    if (!campo) return null;
    const aoMudar = (valor: unknown) => {
      onLimparAviso?.(chaveAv);
      if (col.key === "cor_base") patchVar(v.tmp, (x) => trocarCorBase(x, String(valor ?? ""), opcoes.coresApelido));
      else if (col.key === "cor_apelido") patchVar(v.tmp, (x) => trocarApelido(x, String(valor ?? ""), opcoes.coresApelido));
      else patchVar(v.tmp, (x) => ({ ...x, [campo]: valor }) as VarianteNova);
    };
    const celula = (
      <CelulaTecido
        coluna={col}
        ariaLabel={ariaLabel}
        valor={v[campo]}
        onChange={aoMudar}
        erro={vermelho(probs, col.key)}
        aviso={avisos[chaveAv]}
        desabilitado={!col.editavel}
        opcoes={opcoesDaColuna(col.key, opcoes, v.cor_id)}
      />
    );
    // Linha-PAI de um tecido NOVO: além do Select de 1 cor, a seleção MÚLTIPLA (cada cor marcada vira uma linha-filha com o
    // preço do tecido). Nas cores 2+ (e nas "cores novas" de tecido existente) a célula segue sendo o Select simples.
    if (col.key === "cor_base" && idx === 0 && !alvo) {
      return (
        <CelulaCorBaseMulti
          cores={opcoes.cores}
          presentes={g.vars.map((x) => x.cor_id).filter(Boolean)}
          onAdicionar={(ids) => onChange(g.tmp, (x) => adicionarCoresAoGrupo(x, ids, x.cab.preco))}
          ariaLabel="Adicionar várias cores do tecido novo"
          desabilitado={!col.editavel}
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
        const probsLinha = [...(primeira ? problemasDoCabecalho(problemas) : []), ...problemasDaVariante(problemas, v.tmp)];
        const pendencia = mostrarPendencias && probsLinha.length ? probsLinha.map((p) => p.msg).join("; ") : undefined;
        return (
          <tr
            key={v.tmp}
            ref={primeira ? primeiraRef : undefined}
            className={primeira && !alvo ? "border-t-2 border-border align-middle bg-amber-50/40 dark:bg-amber-500/5" : "border-t border-dashed align-middle bg-amber-50/40 dark:bg-amber-500/5"}
            data-linha-nova={g.tmp}
            data-variante-nova={v.tmp}
            data-slot={chaveSlotNovo(v.tmp)}
          >
            <td className="w-8 px-1 py-1.5 text-center">
              <EstadoNovo
                erro={primeira ? erro : undefined}
                pendencia={pendencia}
                podeRemover={alvo || g.vars.length > 1}
                onRemover={() => removerVar(v.tmp)}
                rotuloRemover={alvo && g.vars.length <= 1 ? "Descartar a cor nova" : "Remover esta cor"}
              />
            </td>
            {COLUNAS_TECIDO.map((col) => (
              <td key={col.key} className="px-1.5 py-1.5" data-col={col.key}>
                {col.escopo === "artigo" ? celulaArtigo(col, primeira, chaveSlotNovo(v.tmp)) : celulaVariante(col, v, i)}
              </td>
            ))}
            <td className={CLASSE_COL_ACOES} />
          </tr>
        );
      })}
      <tr data-acoes-novo={g.tmp} className="bg-amber-50/40 dark:bg-amber-500/5">
        <td />
        <td colSpan={COLUNAS_TECIDO.length + 1} className="px-1.5 pb-2 pt-0.5">
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
                <Trash2 className="mr-1 h-4 w-4" /> Descartar tecido novo
              </Button>
            )}
            {erro && <span role="alert" className="text-xs text-destructive">{erro}</span>}
          </div>
        </td>
      </tr>
    </>
  );
}
