// PR-GRADE-2 — RASCUNHO + SALVAR da grade de tamanhos de UM produto REVENDA na Lista tipo Excel (a única origem que edita na lista).
// STAGING: editar só mexe no rascunho (`useCardDraft`, id = `<modelo>::grade`, no `CardDraftsProvider` da Aba — entra no "Salvar (N)" e na guarda
// de não salvos); NADA grava antes do Salvar. O Salvar chama `salvar_grade_revenda` (a MESMA RPC do Sheet) via `salvarGradeRevenda`
// (lib/produto-grade/grade-revenda.ts: estado COMPLETO + CAS por `rev` + conferência de conteúdo). P0409 = recarrega SÓ esta grade, avisa
// e MANTÉM o rascunho (as células editadas); o resto da Lista não se mexe.
//
// Âncoras (mesmo molde de `useRascunhoProduto`): com o rascunho SUJO nada acompanha o servidor — a âncora (o que a pessoa viu quando começou a
// editar), o `rev` e a grade "conferida" ficam congelados; as células NÃO editadas mostram sempre o servidor mais novo.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCardDraft } from "@/components/shared/card-drafts/useCardDraft";
import { lerGradeServidorComprado } from "@/components/planejamento/planejamento-detail/ficha/persistir-bom";
import type { Origem } from "@/lib/origem";
import {
  celulasDaGrade,
  chaveCelula,
  qtdValida,
  salvarGradeRevenda,
  TEXTO_CONFLITO_GRADE,
  type GradePorCor,
} from "@/lib/produto-grade/grade-revenda";
import { ehConflitoRev, textoErroSalvar } from "@/lib/produto-grade/salvar";
import type { SalvarCtx } from "./ProdutosGradeTabela";
import { chaveGradeTamanhos, type DadosBrutos } from "./useProdutoGradeTamanhos";

type Celulas = Record<string, number>;

/** Mantém a MESMA referência enquanto o conteúdo não muda (a `base` do `useCardDraft` tem de ser estável). */
function useEstavel<T>(valor: T): T {
  const ref = useRef(valor);
  if (ref.current !== valor && JSON.stringify(ref.current) !== JSON.stringify(valor))
    ref.current = valor;
  return ref.current;
}

export function useRascunhoGradeRevenda({
  modeloId,
  nome,
  origem,
  rev,
  grades,
  nums,
  tamanhos,
  sc,
  onSujoChange,
}: {
  modeloId: string;
  nome: string;
  origem: Origem;
  /** `modelos.rev` lido junto com a grade (base do CAS). */
  rev: number | null;
  /** A grade do SERVIDOR (`variante_numero → tamanho → qtd`). */
  grades: GradePorCor;
  /** `variante_numero` das cores (linhas) e as chaves dos tamanhos (colunas) da matriz. */
  nums: readonly number[];
  tamanhos: readonly string[];
  sc: SalvarCtx;
  /** Avisa a linha-mãe (bloqueia recolher com rascunho). */
  onSujoChange?: (sujo: boolean) => void;
}) {
  const qc = useQueryClient();
  const base = useEstavel(
    useMemo(() => celulasDaGrade(grades, nums, tamanhos), [grades, nums, tamanhos]),
  );
  const gradesEstavel = useEstavel(grades);
  const [erro, setErro] = useState<string | null>(null);

  const ancoraRef = useRef<Celulas>(base);
  const baseAtualRef = useRef<Celulas>(base);
  baseAtualRef.current = base;
  // O que ACABEI de salvar e a releitura ainda não trouxe: até a base nova chegar, é a referência da grade limpa.
  const salvoRef = useRef<Celulas | null>(null);
  const baseVistaRef = useRef(base);
  if (baseVistaRef.current !== base) {
    baseVistaRef.current = base;
    salvoRef.current = null;
  }
  const conferidaRef = useRef<GradePorCor>(gradesEstavel);
  const revBaseRef = useRef<number | null>(rev);

  const salvarFn = useCallback(
    async (mudancas: Partial<Celulas>) => {
      setErro(null);
      const enviadas: Celulas = {};
      for (const [k, v] of Object.entries(mudancas)) enviadas[k] = qtdValida(v);
      // O `rev` que ESTE Salvar já subiu na linha (o cabeçalho do produto salvou antes, no mesmo "Salvar (N)") não é conflito.
      const salvoPelaLinha = sc.revSalvoRef.current.get(modeloId);
      const revBase =
        salvoPelaLinha != null &&
        (revBaseRef.current == null || salvoPelaLinha > revBaseRef.current)
          ? salvoPelaLinha
          : revBaseRef.current;
      try {
        await salvarGradeRevenda({
          modeloId,
          revBase,
          conferida: conferidaRef.current,
          mudancas: enviadas,
          lerServidor: (id, r) => lerGradeServidorComprado(id, () => r),
          rpc: (n, a) =>
            supabase.rpc(n as never, a as never) as unknown as PromiseLike<{ error: unknown }>,
        });
        salvoRef.current = { ...baseAtualRef.current, ...enviadas };
        // Relê ANTES de liberar: a grade nova + o `rev` novo chegam juntos (a próxima edição já parte do servidor).
        try {
          await qc.refetchQueries({ queryKey: chaveGradeTamanhos(modeloId, origem) });
          const fresco = qc.getQueryData<DadosBrutos>(chaveGradeTamanhos(modeloId, origem));
          if (fresco) {
            conferidaRef.current = fresco.grades;
            revBaseRef.current = fresco.rev;
          }
        } catch {
          /* a próxima leitura atualiza */
        }
        sc.reportar({ id: modeloId, nome, tipo: "ok", enviou: true });
      } catch (e) {
        if (ehConflitoRev(e)) {
          // Alguém salvou no meio: recarrega SÓ esta grade (as outras linhas seguem), re-baseliza o `rev` e a grade conferida e MANTÉM o
          // rascunho (as células editadas) para a pessoa conferir e salvar de novo. Falha na releitura não esconde o conflito.
          try {
            await qc.refetchQueries({ queryKey: chaveGradeTamanhos(modeloId, origem) });
            const fresco = qc.getQueryData<DadosBrutos>(chaveGradeTamanhos(modeloId, origem));
            if (fresco) {
              conferidaRef.current = fresco.grades;
              revBaseRef.current = fresco.rev;
            }
          } catch {
            /* a próxima leitura atualiza; o aviso do conflito fica */
          }
          setErro(TEXTO_CONFLITO_GRADE);
          sc.reportar({ id: modeloId, nome, tipo: "conflito" });
        } else {
          sc.aoErro(e);
          setErro(textoErroSalvar(e));
          sc.reportar({ id: modeloId, nome, tipo: "erro" });
        }
        throw e;
      }
    },
    [sc, modeloId, nome, origem, qc],
  );

  const draft = useCardDraft<Celulas>({
    id: `${modeloId}::grade`,
    base,
    salvarFn,
    onDescartar: () => setErro(null),
  });
  const { valor: valorBruto, dirty, patch } = draft;
  if (!dirty) {
    // Limpa: tudo acompanha o servidor (suja, FICA o de quando começou a editar).
    ancoraRef.current = salvoRef.current ?? base;
    conferidaRef.current = gradesEstavel;
    if (rev != null && (revBaseRef.current == null || rev > revBaseRef.current))
      revBaseRef.current = rev;
  }
  const ancora = ancoraRef.current;
  const editada = (k: string) => dirty && !Object.is(valorBruto[k], ancora[k]);
  useEffect(() => {
    if (!dirty) setErro(null);
  }, [dirty]);

  const onSujoRef = useRef(onSujoChange);
  onSujoRef.current = onSujoChange;
  useEffect(() => {
    onSujoRef.current?.(dirty);
  }, [dirty]);
  useEffect(() => () => onSujoRef.current?.(false), []);

  /** O que a célula mostra: a editada vale o rascunho; as outras, o servidor mais novo. */
  const valorDe = (num: number, tam: string) => {
    const k = chaveCelula(num, tam);
    return editada(k) ? (valorBruto[k] ?? 0) : (base[k] ?? 0);
  };
  const editar = (num: number, tam: string, v: number) =>
    patch(chaveCelula(num, tam), qtdValida(v));
  /** Σ da linha (derivado, nunca editado): células da matriz já com o rascunho + qualquer outro tamanho que a linha tenha no servidor. */
  const totalDe = (num: number) => {
    const visiveis = new Set(tamanhos);
    let soma = 0;
    for (const t of tamanhos) soma += valorDe(num, t);
    for (const [t, q] of Object.entries(gradesEstavel[num] ?? {}))
      if (!visiveis.has(t)) soma += Number(q) || 0;
    return soma;
  };

  return {
    dirty,
    erro,
    valorDe,
    editar,
    totalDe,
    celulaEditada: (num: number, tam: string) => editada(chaveCelula(num, tam)),
  };
}
