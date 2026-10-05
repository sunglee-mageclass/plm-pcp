// F3.2 — ORQUESTRADOR da ficha técnica (BOM) no Sheet do Planejamento de Produto. Compõe useFichaDados
// (queries) + useFichaBom (estado/handlers) + useFichaGuarda ("não salvo") e expõe 3 superfícies:
//  • seções (render das seções 5-8 e das linhas de custo do BOM na tabela de Preço e Custos);
//  • colab (conflito de SEÇÃO "Tecidos & BOM" — Dev :599-603, :838-843, :1813-1842 — só quando o BOM do SERVIDOR
//    mudou de verdade: R5 do G-plano conjunto);
//  • `save` (FichaSave — consumida por usePlanejamentoSave).
// Trava ÚNICA (R2 do G-plano conjunto): deriva da trava da F3.1 (`travaDev`). F3.3: a trava interina "tem CAD" saiu.
// Porta a orquestração do PanelContent do Dev (ModeloDetailPanel.tsx), que fica intocado até a F5.
import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { labelVarianteRow } from "@/lib/variante";
import { useEtapasAfetadas } from "@/components/desenvolvimento/DownstreamImpactAlert";
import type { Draft } from "@/components/planejamento/modelo-shared";
import type { CustoAdicional } from "@/components/desenvolvimento/modelo-detail/ModeloCustosSection";
import type { MotivoTravaDev } from "./secoes/AvisoCamposDev";
import { chavesBomServidor, chavesFichaBom, useFichaDados } from "./useFichaDados";
import { useFichaBom } from "./useFichaBom";
import { useFichaGuarda } from "./useFichaGuarda";
import { contadorVoo, deveLimparTocadoAposSalvar } from "../save-ficha";
import {
  assinaturaBom, bomDivergeDaReferencia, bomSujoNaCaptura, cadSujoNaCaptura, estadoBomDoServidor,
  paresComplementares, resumoBom, snapshotBom, tecido1VariantesInfo, tecidosPlanejadosDerivados, totaisBom,
  type AviamentoRowDb, type BomCapturado, type EstadoBom, type EtiquetaRowDb, type GradeExternaCaptura, type GradeRowDb, type OcLinkRowDb,
  type TecidoRowDb, type VarianteRowDb,
} from "./ficha-calc";
import { requisitosUniao, seloSecaoBom, type SecaoBomKey, type SeloSecao } from "./selos-bom";
import { gradeCompradoMudouNoServidor, gradesParaBomComprado, requeridasPorOrigem } from "../comprado";
import { useFichaCad } from "./useFichaCad";
import {
  assinaturaCad, assinaturaCadServidor, cadDivergeDaReferencia, deveGravarCad, linhasParaGravar, montarCadPayload, tamanhoPorEtiquetaDe,
  snapshotCad, type CadCapturado, type CadRowDb, type CadTecidoRow, type CadVarianteRow, type PatchBlocoCad,
} from "./ficha-cad";
import { seloCadSecao } from "./selos-secoes";
import type { PatchCopia } from "@/components/desenvolvimento/importar/importar-copia";
import type { TamanhoTipo } from "@/lib/tamanho";

const SEM_LABELS: Record<string, string> = {};
// F3.4 — identidades ESTÁVEIS p/ o comprado (sem grade da ficha; sem pré-preenchimento de Tecido 1..N).
const SEM_GRADES: EstadoBom["grades"] = [];
const SEM_PLANEJADOS: string[] = [];

/**
 * T9 I1(a) — BOM só-leitura não pode ser editado com o MOUSE. O Radix Select ignora `<fieldset disabled>`
 * (documentado na F3.1, `DevEquipeSection.tsx:15-20`): o `<fieldset disabled>` em `BomSecoes` trava inputs
 * nativos, mas um clique no Select do Dev (`FieldSelectOpt`, que não pode mudar) ainda dispararia o
 * `onChange`. Camada (a) = handlers NO-OP com as MESMAS chaves/assinaturas do `useFichaBom` real — mesma
 * identidade sempre (módulo-level), então `useMemo([podeEditar, bom.handlers])` não recria à toa quando
 * `podeEditar` não mudou. Cenário: card enviado → trocar o aviamento com o mouse ⇒ nada muda, sem selo
 * "não salvo" (o handler não escreve no estado, então `colecoesTouchadasRef`/`onCampoEditado` não disparam).
 */
const HANDLERS_NOOP: ReturnType<typeof useFichaBom>["handlers"] = {
  updateBlock: () => undefined,
  updateBlockVariante: () => undefined,
  updateBlockOcLinks: () => undefined,
  updateAviamento: () => undefined,
  addAviamento: () => undefined,
  removeAviamento: () => undefined,
  updateEtiqueta: () => undefined,
  addEtiqueta: () => undefined,
  removeEtiqueta: () => undefined,
  updateGradeTotal: () => undefined,
  updateGradeCell: () => undefined,
  updateProporcao: () => undefined,
  toggleGradeAuto: () => undefined,
};
/** F3.3 — mesma receita p/ a seção CAD: sem permissão, travada, ou antes da Ordem sem CAD (D2) ⇒ nada muda com o mouse. */
const CAD_NOOP = {
  updateTec: (_i: number, _p: Partial<CadTecidoRow>) => undefined,
  updateVar: (_i: number, _j: number, _p: Partial<CadVarianteRow>) => undefined,
  setAutoFolhas: (_v: boolean) => undefined,
};

export type FichaSave = {
  /** habilitada E carregada E sem trava (permissão / enviado) ⇒ colunas do Dev vão no UPDATE. */
  podeGravarColunasDev: boolean;
  /** `criacao_planejamento:custos` OU `criacao_desenvolvimento:custos` (decisão F3 #2). */
  podeVerCustos: boolean;
  conflitoBomRef: RefObject<boolean>;
  /** R5 — rev novo com o BOM tocado: conferindo se o BOM do SERVIDOR mudou. O Salvar espera (mensagem própria). */
  verificandoBomRef: RefObject<boolean>;
  colecoesTouchadasRef: RefObject<boolean>;
  setConflitoBom: (v: boolean) => void;
  /**
   * Item G (T11, I1) — chamar `true` no início do `mutationFn` e `false` no fim (onSettled, ou no fim de
   * onSuccess/onError). Enquanto `true`, o `aoMudarNoServidor` com o BOM tocado NÃO confere/acende "Tecidos &
   * BOM" contra o eco do PRÓPRIO save — só invalida.
   */
  marcarSaveEmVoo: (v: boolean) => void;
  /** R5 — recarrega o BOM e diz se ele mudou em relação à referência (true em erro — conservador). */
  bomMudouNoServidor: () => Promise<boolean>;
  /** Congela o BOM no início do Salvar (lê refs — vale mesmo no retry, fora do ciclo de render). */
  capturar: (custosAdicionais: unknown, opts?: { retry?: boolean; proporcoes?: Record<string, number>; gradeExterna?: GradeExternaCaptura }) => BomCapturado;
  /** F3.3 — o CAD foi gravado: a referência do CAD vira o ENVIADO já (mesma ideia do `bomGravado`). */
  cadGravado: (cad: CadCapturado) => void;
  /**
   * Pós-save: re-baseia (edição em voo segue "não salva"), a referência vira o ENVIADO, limpa marcadores,
   * invalida o BOM. Fix final M1 — `edicoesPerdidas`: havia ficha tocada que DEVERIA ter sido gravada
   * (`bomEnviado.gravar` / `bomEnviado.cad.gravar` — F3.3) e este Salvar NÃO gravou (a trava chegou entre a captura e o save) — o "não salvo"
   * NÃO foi limpo (ver `deveLimparTocadoAposSalvar`); o chamador (`usePlanejamentoSave`) avisa o usuário.
   */
  aposSalvar: (a: { bomEnviado: BomCapturado }) => { bomMudouEmVoo: boolean; edicoesPerdidas: boolean };
  /**
   * Fix T10 m1 — falha DEPOIS do `persistirBom` (etiqueta, MO, `custo_peca`) deixava a referência do BOM
   * velha: com o BOM já gravado no servidor mas o `aposSalvar` sem rodar (o save inteiro lançou antes de
   * chegar lá), o próximo eco Realtime ou o próximo P0409 comparava com a referência ANTIGA e acendia
   * "Tecidos & BOM" contra o próprio write. Chamar IMEDIATAMENTE depois do `persistirBom` bem-sucedido —
   * a referência vira o ENVIADO assim que o servidor o tem, mesmo que um passo seguinte falhe.
   */
  bomGravado: (bomEnviado: BomCapturado) => void;
  /**
   * Item H (T11, m2) — no ramo do P0409 do `onError` que avança `revRef` SEM retry (`r.podeRetentar===false`
   * ou o bloqueio do item C), o BOM local pode ter ficado desatualizado frente ao servidor (que já bumpou o
   * `rev` — outra pessoa salvou o consumo). Sem invalidar aqui, um Salvar seguinte com o BOM ainda tocado
   * sobrescreveria o BOM alheio sem passar pela conferência R5 (que só roda quando o `rev` muda DE NOVO).
   */
  invalidarBom: () => void;
  /**
   * Item E (fix round 3, (a)) — "este save IA gravar o BOM (manufaturado)?" = BOM tocado OU pré-preenchimento
   * pendente (mesma condição de `gravar` em `capturar()` PARA O BOM manufaturado, sem depender de
   * `podeEditar`/carga — lida direto das refs, vale fora do ciclo de render). Usada no `onError` do P0409
   * (`usePlanejamentoSave.ts`) para decidir se confere o BOM do servidor: com prefill pendente e
   * `colecoesTouchadasRef=false`, o `bomConflito` de antes ficava sempre `false` (só olhava
   * `colecoesTouchadasRef`) — um P0409 nesse instante fazia o retry gravar o esqueleto Tecido 1..N por cima do
   * BOM que outra pessoa completou nesse meio-tempo (cenário do bug).
   * Fix round 1 (I2) — NÃO cobre a grade cor × tamanho do comprado: o IMPORTADO grava essa grade POR ESTE
   * MESMO BOM (`gradeCompradoPeloBom`/`gradeRevendaDirty`, fora deste hook — vivem em `usePlanejamentoSave`/
   * `PlanejamentoDetail`), então uma grade editada SEM nenhum campo do BOM manufaturado tocado também faz
   * `capturar().gravar` sair `true` (via `gravaPelaGrade`) sem que esta função saiba disso. `usePlanejamentoSave`
   * soma essa condição por fora nos 2 pontos que chamam `bomPendenteDeGravar()`:
   * `fichaRef.current.bomPendenteDeGravar() || (gradeCompradoPeloBom && gradeRevendaDirty)`.
   */
  bomPendenteDeGravar: () => boolean;
  etapas: { corte?: boolean; baixa_total?: number };
};

/**
 * Por que a ficha (BOM + CAD) está só-leitura. Trava ÚNICA (R2): "permissao" e "enviado" vêm da trava da F3.1
 * (`motivoTravaDev`, com o "Editar" já considerado). A trava interina "cad" da F3.2 saiu na F3.3 (o Salvar grava o CAD —
 * plano F3.3 §3).
 */
export type MotivoSomenteLeitura = "permissao" | "enviado" | "carregando" | null;

export function useFichaTecnica(a: {
  modeloId: string | null;
  isEdit: boolean;
  isComprado: boolean;
  tecidosPlanejados: string[];
  proporcoes: Record<string, number>;
  custosAdicionais: CustoAdicional[];
  setDraftTracked: Dispatch<SetStateAction<Draft>>;
  /** M.O. ao vivo (Σ do rascunho de MO do Planejamento) — entra no Custo de 1 Peça exibido. */
  maoObraVivo: number;
  /** F3.1 — `motivoTravaDev` do orquestrador ("sem_permissao" | "enviado" | null; o "Editar" já zera o "enviado"). */
  travaDev: MotivoTravaDev;
  /** F3.3 — `modelos.ordem_criacao_enviada` do SERVIDOR (D2: antes dela o Planejamento não cria o CAD). */
  ordemEnviada: boolean;
  /** P-120 A (plano `2026-09-29-tamanho-em`, fix I-1) — `draft.tamanho_tipo`: repassado ao `useFichaBom` p/ a
   *  divisão igual da Grade Total (sem proporção) cair só nos tamanhos visíveis. Omitido = sem filtro (hoje). */
  tamanhoTipo?: TamanhoTipo | null;
}) {
  const qc = useQueryClient();
  const { canView, canEdit } = useAuth();
  // Decisão F3 #8: seções do Dev visíveis p/ quem VÊ o Desenvolvimento, editáveis p/ quem o EDITA.
  const podeVerFicha = canView("criacao_desenvolvimento");
  const podeEditarFicha = canEdit("criacao_desenvolvimento");
  const podeVerCustos = canView("criacao_planejamento:custos") || canView("criacao_desenvolvimento:custos");
  // F3.4 — comprado também (decisões F3 #4/#8): QUAIS seções aparecem é do orquestrador (`vis`, pelo "Fluxo de Revenda");
  // a ficha carrega p/ quem vê o Desenvolvimento porque o Salvar do comprado também grava o BOM (aviamentos/insumos e, no
  // importado, a grade cor × tamanho — plano F3.4 §3).
  const habilitada = a.isEdit && !!a.modeloId && podeVerFicha;
  // F3.4 — comprado: a grade é EXTERNA à ficha (a cor × tamanho do produto, `useGradeComprado`) e o CAD nunca grava.
  // Espelho SÍNCRONO p/ os callbacks e a captura (rodam fora do render — mesma razão do `podeEditarRef`).
  const compradoRef = useRef(a.isComprado);
  compradoRef.current = a.isComprado;
  /** A ficha do comprado não carrega/compara/grava a grade dela: projeta `grades: []` nos DOIS lados de toda comparação
   *  (snapshot do "não salvo", assinatura/referência R5/R5a, captura) — a grade do comprado tem dono próprio. */
  const projetar = (e: EstadoBom): EstadoBom => (compradoRef.current ? { ...e, grades: SEM_GRADES } : e);

  const dados = useFichaDados({ modeloId: a.modeloId, habilitada });

  // ── Colab: conflito de SEÇÃO (R5 do G-plano conjunto) — declarados ANTES do useFichaBom(...) porque o
  // callback `aoRecarregarComTocado` (R5a) precisa existir na hora da chamada (a Task 6 já fiou o hook p/
  // recebê-lo, mas o Salvar unificado — Task 8+ — ainda não conectou o lado do orquestrador). Sem ligar isso,
  // "outra pessoa mudou o consumo enquanto EU tinha o BOM tocado" fica mudo até o próximo `aoMudarNoServidor`
  // manual — o cenário que a carga (`useFichaBom`) já intercepta na hora (ficha-calc :147-159) ficaria sem
  // consumidor.
  const [conflitoBom, setConflitoBom] = useState(false);
  const conflitoBomRef = useRef(false);
  const setConflitoBomBoth = (v: boolean) => { conflitoBomRef.current = v; setConflitoBom(v); };
  const [verificandoBom, setVerificandoBom] = useState(false);
  const verificandoBomRef = useRef(false);
  const setVerificandoBoth = (v: boolean) => { verificandoBomRef.current = v; setVerificandoBom(v); };
  // Item G (T11, I1; CONTADOR — fix round 3) — "Tecidos & BOM" pisca durante o PRÓPRIO save: a conferência
  // nasce do eco do UPDATE do header (bump de `rev`) e resolve ANTES do `bomGravado`/`aposSalvar` (que só
  // rodam depois de `persistirBom`) — nessa janela, `bomMudouNoServidor` relê o BOM ainda VELHO no servidor E
  // compara contra a referência ainda VELHA, então não deveria divergir; mas com o BOM local editado (tocado)
  // o efeito visual de "conferir e talvez acender" no meio do PRÓPRIO save é indesejado.
  // `marcarSaveEmVoo(true)` no início do `mutationFn` e `(false)` no fim (onSettled/onSuccess/onError) —
  // enquanto "em voo", `aoMudarNoServidor` com BOM tocado só invalida (não confere/não acende); o
  // `aposSalvar` já invalida de novo ao fim, e a R5a do guardião (outra pessoa salvando o CONSUMO com o meu
  // tocado, fora do meu save) continua funcionando — ela só entra pela CARGA (`aoRecarregarComTocado`), não
  // por este caminho.
  //
  // Fix round 3 (item G, menor) — booleano→CONTADOR. No TanStack Query 5.x, o `mutationFn` do RETRY roda
  // ANTES do `onSettled` do 1º ciclo (a promise do `save.mutate(...)` dentro do `onError` já reentra no
  // `mutationFn`, que chama `marcarSaveEmVoo(true)` de novo, ANTES de o microtask do `onSettled` do ciclo
  // anterior — que ainda ia chamar `marcarSaveEmVoo(false)` — rodar). Com um booleano simples, essa ordem
  // fazia o `onSettled` do 1º ciclo desligar a flag NO MEIO do retry (que segue rodando `persistirBom`/MO/
  // etapas), zerando a proteção deste item durante o resto do retry inteiro. Com CONTADOR: `true` = `+1`,
  // `false` = `-1` com PISO 0 (nunca negativo — um `onSettled` "sobrando" não deixa dívida); "em voo" =
  // contador > 0. Sequência do retry: mutationFn 1ª tentativa (+1 ⇒ 1) → P0409 → onError chama
  // `save.mutate()` → mutationFn do retry roda de novo (+1 ⇒ 2) → SÓ DEPOIS o onSettled do 1º ciclo dispara
  // (-1 ⇒ 1, ainda > 0 — o retry segue protegido) → retry termina → onSettled do retry (-1 ⇒ 0).
  const saveEmVooContadorRef = useRef(0);
  const marcarSaveEmVoo = (v: boolean) => {
    saveEmVooContadorRef.current = contadorVoo(saveEmVooContadorRef.current, v);
  };
  const geracaoRef = useRef(0);
  // REFERÊNCIA = assinatura do BOM do SERVIDOR sobre o qual o usuário está editando. Enquanto nada foi tocado ela
  // ACOMPANHA o estado (que é o do servidor recém-carregado); depois de um Salvar que gravou o BOM, vira o ENVIADO (o
  // servidor passa a ter exatamente isso); no "manter meu", vira o do servidor que causou o aviso (só um conflito NOVO
  // acende de novo).
  const referenciaRef = useRef<string | null>(null);
  const ultimaAssinaturaServidorRef = useRef<string | null>(null);
  const tecidosPlanejadosRef = useRef(a.tecidosPlanejados);
  tecidosPlanejadosRef.current = a.isComprado ? SEM_PLANEJADOS : a.tecidosPlanejados;
  // T7 m1 — `aoRecarregarComTocado` (R5a) precisa existir na hora da chamada de `useFichaBom`, mas a função
  // REAL (abaixo) lê `bom.colecoesTouchadasRef` — que só existe DEPOIS dessa chamada. A ref indireciona: a
  // carga sempre invoca a versão ATUAL via `aoRecarregarComTocadoRef.current(...)`, montada logo após `bom`
  // existir, lendo a ref VIVA (`bom.colecoesTouchadasRef`) em vez de um espelho por render.
  const aoRecarregarComTocadoRef = useRef<(servidor: EstadoBom) => void>(() => undefined);
  // F3.3 — referência do CAD, SEPARADA da do BOM (o CAD grava num passo seguinte que pode falhar sozinho — §3 P6): o que
  // é DO CAD (folhas/metragens) no servidor sobre o qual o usuário edita. Nasce na HIDRATAÇÃO (a do servidor, não a local
  // — o cálculo automático de folhas mexe no local sem ser edição), vira o ENVIADO quando o CAD grava e o do servidor
  // no "manter meu".
  const referenciaCadRef = useRef<string | null>(null);
  const ultimaAssinaturaCadServidorRef = useRef<string | null>(null);
  // R1 do G-plano F3.3 — "o CAD local pode estar VELHO". Marcado SÍNCRONO no `aoMudarNoServidor` sem toque (Step 4 (k)):
  // o merge já avançou o `revRef` (PlanejamentoDetail.tsx:625, antes do :636), mas o `bomFetching` só vira true no
  // PRÓXIMO render e o CAD só re-hidrata um render DEPOIS de a carga do BOM subir o `cargaSeq`. Zerado no `aoHidratar`
  // (o CAD do servidor acabou de entrar no estado) e na troca de card. Enquanto true, a captura trata como "recarga em
  // curso": sem toque o Salvar NÃO grava o CAD (Step 5 (a); §7 T22). Não prende: sem toque, toda recarga pedida termina
  // numa carga (o `bomFetching` volta a false ⇒ o efeito de carga do useFichaBom roda ⇒ `cargaSeq` sobe ⇒ `aoHidratar`);
  // com toque, o `deveGravarCad` nem olha isto (grava pelo `tocado`, protegido pela conferência R5/R5a).
  const cadVelhoRef = useRef(false);
  // Propagação BOM → CAD: o useFichaBom chama isto; a função real vem do useFichaCad, criado DEPOIS dele.
  const aoMudarBlocoRef = useRef<(tipo: string, numero: number, patch: PatchBlocoCad) => void>(() => undefined);

  const bom = useFichaBom({
    modeloId: a.modeloId, habilitada, dados,
    // F3.4 — comprado não pré-preenche Tecido 1..N (não fabrica) e a grade da ficha fica de fora (a do produto manda).
    tecidosPlanejados: a.isComprado ? SEM_PLANEJADOS : a.tecidosPlanejados, proporcoes: a.proporcoes, setDraftTracked: a.setDraftTracked,
    gradeExterna: a.isComprado,
    aoRecarregarComTocado: (servidor) => aoRecarregarComTocadoRef.current(servidor),
    aoMudarBloco: (tipo, numero, patch) => aoMudarBlocoRef.current(tipo, numero, patch),
    // Fix I-1 — grade EXTERNA (comprado) não usa isto (`ModeloGradeSection`/Tecido 1 nem entram); interno passa o
    // "Tamanho em" do rascunho.
    tamanhoTipo: a.isComprado ? null : a.tamanhoTipo,
  });
  /**
   * R5a (re-check do guardião) — a CARGA (useFichaBom) chegou com o BOM local JÁ tocado: ela não sobrescreve
   * (mesma regra do Dev), mas monta o estado do SERVIDOR com as MESMAS funções da carga e entrega aqui. Só
   * ACENDE "Tecidos & BOM" — nunca apaga (quem apaga é só `resolverConflitoBom`/`aposSalvar`). Sem isto, uma
   * mudança alheia que chega enquanto o usuário já está editando o BOM (recarga automática/foco, ANTES de
   * qualquer `aoMudarNoServidor` via `rev`) passaria batido — o próximo Salvar sobrescreveria o BOM de outra
   * pessoa sem aviso (buraco descrito em ficha-calc :147-159). Lê `bom.colecoesTouchadasRef.current` DIRETO
   * (a ref viva) — não um espelho por render, que ficaria um render atrasado.
   *
   * Fix final M2 — "Tecidos & BOM" falso durante o PRÓPRIO save pelo caminho R5a. `persistirBom` grava e o
   * `salvar_modelo_bom` bumpa `modelos.rev`; o refetch/eco disparado por esse bump pode chegar por ESTE
   * caminho (a carga, `useFichaBom`) ANTES de `bomGravado`/`aposSalvar` (que só rodam depois do
   * `persistirBom` retornar) moverem a `referenciaRef` para o ENVIADO — nessa janela, o servidor já tem o BOM
   * novo mas a referência local ainda é a VELHA, e a comparação abaixo acenderia o aviso contra o PRÓPRIO
   * write. Enquanto "em voo" (contador > 0 — mesmo sinal que `aoMudarNoServidor` já usa), só atualiza
   * `ultimaAssinaturaServidorRef` (fica pronta caso um conflito de verdade precise dela) e retorna sem
   * acender — `aposSalvar` cobre o resto (move a referência e invalida; a recarga seguinte compara com a
   * referência NOVA).
   */
  aoRecarregarComTocadoRef.current = (servidorBruto) => {
    // F3.4 — comprado: a grade não é da ficha (projetada fora dos DOIS lados da comparação).
    const servidor = projetar(servidorBruto);
    ultimaAssinaturaServidorRef.current = assinaturaBom(servidor);
    // F3.3 — o CAD do servidor chega junto (a carga espera as 6 queries estáveis — `bomFetching` inclui o CAD).
    const cadServidor = dados.cadData ?? null;
    ultimaAssinaturaCadServidorRef.current = assinaturaCadServidor(cadServidor);
    // Fix final M2 (F3.2) — durante o PRÓPRIO save (`saveEmVooContadorRef > 0`) só atualiza as assinaturas (BOM e CAD,
    // acima) e sai sem acender. Rebase F3.3→3adfbd3: este early-return também cobre o CAD — o servidor pode já ter o CAD
    // ENVIADO antes de o `cadGravado` mover a referência (o `bomGravado` invalida tudo no meio da cadeia); o `aposSalvar`
    // recarrega e a carga seguinte compara com a referência já nova.
    if (saveEmVooContadorRef.current > 0) return;
    const cadDiverge = cadDivergeDaReferencia(referenciaCadRef.current, cadServidor);
    if (bom.colecoesTouchadasRef.current && (bomDivergeDaReferencia(referenciaRef.current, servidor) || cadDiverge)) {
      setConflitoBomBoth(true);
    }
  };
  // F3.3 — a seção CAD (porta do Dev): carga amarrada à do BOM, mesmo "tocado", propagação nos dois sentidos.
  const cad = useFichaCad({
    modeloId: a.modeloId, habilitada, dados, cargaSeq: bom.cargaSeq,
    blocks: bom.blocks, grades: bom.grades, proporcoes: a.proporcoes,
    marcarTocado: bom.marcarTocado, colecoesTouchadasRef: bom.colecoesTouchadasRef, aplicarConsumoNoBom: bom.aplicarConsumoDoCad,
    // R1 — o CAD do servidor entrou no estado: some o "CAD velho" (Step 4 (a)).
    aoHidratar: (assinatura) => { referenciaCadRef.current = assinatura; cadVelhoRef.current = false; },
  });
  aoMudarBlocoRef.current = cad.propagarDoBloco;

  const estado: EstadoBom = useMemo(
    () => ({ blocks: bom.blocks, aviamentos: bom.aviamentosState, etiquetas: bom.etiquetasState, grades: a.isComprado ? SEM_GRADES : bom.grades }),
    [bom.blocks, bom.aviamentosState, bom.etiquetasState, bom.grades, a.isComprado],
  );
  const snapshot = useMemo(() => snapshotBom(estado), [estado]);
  const guarda = useFichaGuarda({ modeloId: a.modeloId, snapshot, tocado: bom.tocado, hidratado: bom.hidratado });
  // F3.3 — "não salvo" do CAD: 2ª guarda com o MESMO "tocado" da ficha (a do BOM segue a da F3.2).
  const snapshotCadAtual = useMemo(() => snapshotCad(cad.linhas), [cad.linhas]);
  const guardaCad = useFichaGuarda({ modeloId: a.modeloId, snapshot: snapshotCadAtual, tocado: bom.tocado, hidratado: cad.hidratado });

  const carregado = habilitada && bom.hidratado && dados.catalogosProntos && bom.varianteArtigoMapPronto && cad.hidratado;
  // Trava ÚNICA (R2 do G-plano conjunto): DERIVA da trava da F3.1. F3.3 — a trava interina "tem CAD" da F3.2 SAIU: o
  // Salvar grava o CAD junto com o BOM (`deveGravarCad` + usePlanejamentoSave) e toda edição leva consumo/%loss/artigo às
  // DUAS estruturas, então o próximo Salvar do Dev não desfaz nada (prova: plano F3.3 §3). O "Editar" da F3.1 destrava
  // BOM e CAD junto com os demais campos do Dev.
  const motivoSomenteLeitura: MotivoSomenteLeitura =
    a.travaDev === "sem_permissao" || !podeEditarFicha ? "permissao"
      : a.travaDev === "enviado" ? "enviado"
        : !dados.cadFetched ? "carregando"
          : null;
  const podeEditar = carregado && motivoSomenteLeitura === null;
  // T7 m2 — `capturar` (chamado no início do Salvar, inclusive num RETRY) precisa ler o `podeEditar` de
  // AGORA, não o do closure em que `save.capturar` foi criado no render anterior. Cenário: P0409 porque
  // outra pessoa enviou o card à Explosão ENTRE o clique em Salvar e o retry — sem a ref, o retry gravaria
  // o BOM com o `podeEditar` velho (true) num card que, agora, está só-leitura.
  const podeEditarRef = useRef(false);
  podeEditarRef.current = podeEditar;
  // Fix round 4 (item 3) — `capturar().totais` precisa vir preenchido sempre que a ficha está CARREGADA
  // (não só quando `podeEditar`), calculado sobre o estado CARREGADO do BOM (`bom.estadoRef.current` —
  // travado não edita, então é sempre o do servidor). Mesmo padrão de ref que `podeEditarRef`: `capturar()`
  // roda fora do ciclo de render (inclusive no retry do P0409) e precisa do valor de AGORA.
  const carregadoRef = useRef(false);
  carregadoRef.current = carregado;
  // Item C (fix round 2) — mesmo padrão/motivo do `podeEditarRef` acima: `capturar()` (chamado dentro do
  // retry do P0409, fora do ciclo normal de render) precisa ler o motivo de AGORA, não o closure velho.
  const motivoSomenteLeituraRef = useRef<MotivoSomenteLeitura>(null);
  motivoSomenteLeituraRef.current = motivoSomenteLeitura;
  // T9 I1(a) — sem permissão/enviado/carregando ⇒ handlers NO-OP (identidade estável de módulo); com permissão ⇒ os
  // handlers de verdade do `useFichaBom`. `bom.handlers` é recriado a cada render de `useFichaBom` (objeto
  // literal no return, sem `useMemo` próprio) — o `useMemo` aqui não evita recriação nesse ramo (a dependência
  // `bom.handlers` já muda todo render), mas evita alocar objeto NOVO no ramo `podeEditar` (HANDLERS_NOOP é
  // sempre a MESMA referência) e mantém a superfície pedida pelo brief.
  const handlers = useMemo(
    () => (podeEditar ? bom.handlers : HANDLERS_NOOP),
    [podeEditar, bom.handlers],
  );
  // F3.3 — D2: antes da Ordem de Criação o Planejamento NÃO cria o CAD (FK `cad.modelo_id` NO ACTION: o card não se
  // excluiria mais). Sem CAD e sem Ordem, a seção CAD é só-leitura (o que se digitasse não seria gravado).
  // F3.4 — comprado: o Planejamento NUNCA grava o CAD (o da revenda nasce no recebimento da OC, com as etiquetas "a
  // enviar" = consumo × peças REAIS — `_receber_oc_p_acabado_core`; o `salvar_cad_completo` as apagaria e regravaria pelo
  // planejado). Seção CAD só-leitura p/ comprado.
  // Rebase-cadeia F3.1 FINAL — `cadGravavelRef` NÃO volta aqui: o "Fix pós-rebase I1" da F3.3 (abaixo, em `cadSujo`)
  // removeu esse ref de propósito (o gate de "CAD sujo" não pode depender de `podeEditar`/`cadGravavel` — ver
  // `cadSujoNaCaptura` em ficha-calc.ts). `cadGravavel` aqui só decide os HANDLERS de edição (`cadHandlers` abaixo).
  const cadGravavel = !a.isComprado && podeEditar && (dados.cadExiste || a.ordemEnviada);
  const cadHandlers = cadGravavel ? { updateTec: cad.updateTec, updateVar: cad.updateVar, setAutoFolhas: cad.setAutoFolhas } : CAD_NOOP;
  // Espelho SÍNCRONO do que a captura do CAD precisa (mesma razão do `podeEditarRef`: o retry do P0409 roda fora do
  // ciclo de render).
  const cadCapturaRef = useRef({ hidratado: false, existe: false, ordemEnviada: false, recarregando: false, chavesBom: new Set<string>() as ReadonlySet<string> });
  cadCapturaRef.current = {
    hidratado: cad.hidratado, existe: dados.cadExiste, ordemEnviada: a.ordemEnviada,
    // Acréscimo do controlador (pós-revisão T4) — `bomFetching` (recarga JÁ em curso) OU `cargaPendenteRef` (a
    // carga do CAD ainda não aplicou o `cargaSeq` mais recente — 1 render de atraso, `useFichaCad.ts`): os dois
    // são "o CAD local pode estar velho" e somam ao `recarregando` de `deveGravarCad`, junto com o `cadVelhoRef`.
    recarregando: dados.bomFetching || cad.cargaPendenteRef.current,
    chavesBom: new Set((dados.tecidosData?.tecidos ?? []).map((t) => `${t.tipo}|${t.numero}`)),
  };

  // Rótulos das variantes do Tecido 1 e dos pares casados (Dev :1470-1529) — só p/ o texto da Grade.
  const t1Ids = bom.tecido1VarianteIds;
  const qLabelsT1 = useQuery({
    queryKey: ["plan-ficha-variantes-labels", t1Ids.join(",")],
    enabled: habilitada && t1Ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido")
        .select("id, nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
        .in("id", t1Ids);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data ?? []).forEach((v: any) => { const l = labelVarianteRow(v); map[v.id] = l !== "—" ? l : ""; });
      return map;
    },
  });
  const pares = useMemo(() => paresComplementares(bom.blocks), [bom.blocks]);
  const compVarIds = useMemo(() => Array.from(new Set(pares.map((p) => p.compVarId))), [pares]);
  const qLabelsComp = useQuery({
    queryKey: ["plan-ficha-variantes-labels-comp", compVarIds.join(",")],
    enabled: habilitada && compVarIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido")
        .select("id, nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
        .in("id", compVarIds);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data ?? []).forEach((v: any) => { const l = labelVarianteRow(v); map[v.id] = l !== "—" ? l : ""; });
      return map;
    },
  });
  const tecido1Info = useMemo(() => tecido1VariantesInfo({
    ids: t1Ids,
    labels: qLabelsT1.data ?? SEM_LABELS,
    varianteArtigoMap: bom.varianteArtigoMap,
    nomeArtigo: (id) => (id ? dados.artigoMap[id]?.nome : undefined),
    pares,
    compLabels: qLabelsComp.data ?? SEM_LABELS,
  }), [t1Ids, qLabelsT1.data, bom.varianteArtigoMap, dados.artigoMap, pares, qLabelsComp.data]);

  // Custo de 1 Peça AO VIVO (MO do rascunho) — Dev :1388-1401.
  const totais = useMemo(
    () => totaisBom({ blocks: bom.blocks, aviamentos: bom.aviamentosState, etiquetas: bom.etiquetasState, custosAdicionais: a.custosAdicionais, maoObra: a.maoObraVivo }),
    [bom.blocks, bom.aviamentosState, bom.etiquetasState, a.custosAdicionais, a.maoObraVivo],
  );

  // Selos por seção (mapa próprio — decisão 8). Requisitos por ORIGEM (Dev :1652-1657).
  const resumo = useMemo(() => resumoBom(estado), [estado]);
  const requeridas = useMemo(
    () => requeridasPorOrigem(a.isComprado, requisitosUniao(a.isComprado ? dados.revendaCfg.requisitos : (dados.tenantCfg as any)?.kanban_requisitos)),
    [a.isComprado, dados.revendaCfg, dados.tenantCfg],
  );
  const selos: Partial<Record<SecaoBomKey, SeloSecao>> = {
    tecidos: seloSecaoBom("tecidos", requeridas, dados.condicoes, resumo),
    aviamentos: seloSecaoBom("aviamentos", requeridas, dados.condicoes, resumo),
    insumos: seloSecaoBom("insumos", requeridas, dados.condicoes, resumo),
    grade: seloSecaoBom("grade", requeridas, dados.condicoes, resumo),
  };
  // F3.3 — selo da seção CAD (Dev :2886-2890 + requisito `cad_preenchido`, no estado SALVO).
  const seloCad = seloCadSecao({
    requeridas, satisfeitas: dados.condicoesProntas ? dados.condicoes : null,
    linhas: cad.linhas.length, faltas: cad.faltas, antesDaOrdem: !dados.cadExiste && !a.ordemEnviada,
  });

  // Reset ao trocar de modelo — mesma instância (Dialog → Sheet do card recém-criado, Dev :674-690).
  useEffect(() => {
    conflitoBomRef.current = false; setConflitoBom(false);
    verificandoBomRef.current = false; setVerificandoBom(false);
    referenciaRef.current = null;
    ultimaAssinaturaServidorRef.current = null;
    referenciaCadRef.current = null;
    ultimaAssinaturaCadServidorRef.current = null;
    cadVelhoRef.current = false;
    geracaoRef.current += 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.modeloId]);
  useEffect(() => {
    if (bom.hidratado && !bom.tocado) referenciaRef.current = assinaturaBom(estado);
  }, [estado, bom.hidratado, bom.tocado]);
  const invalidarBom = () => { for (const k of chavesFichaBom(a.modeloId)) qc.invalidateQueries({ queryKey: k }); };

  /** R5 — recarrega as 5 queries do BOM e compara o do servidor com a referência. Erro ⇒ true (na dúvida, avisa). */
  const bomMudouNoServidor = async (): Promise<boolean> => {
    const id = a.modeloId;
    try {
      // F3.3 — o CAD entra na conferência (a referência do CAD cobre folhas/metragens).
      const chaves = [...chavesBomServidor(id), ["plan-ficha-cad", id]];
      await Promise.all(chaves.map((k) => qc.refetchQueries({ queryKey: k, exact: true })));
      const tec = qc.getQueryData<{ tecidos: TecidoRowDb[]; variantes: VarianteRowDb[] }>(["plan-ficha-tecidos", id]);
      const oc = qc.getQueryData<OcLinkRowDb[]>(["plan-ficha-oc-links", id]);
      const av = qc.getQueryData<AviamentoRowDb[]>(["plan-ficha-aviamentos", id]);
      const et = qc.getQueryData<EtiquetaRowDb[]>(["plan-ficha-etiquetas", id]);
      const gr = qc.getQueryData<GradeRowDb[]>(["plan-ficha-grades", id]);
      const cadSrv = qc.getQueryData<CadRowDb | null>(["plan-ficha-cad", id]);
      if (!tec || !oc || !av || !et || !gr || cadSrv === undefined) return true;
      const servidor = projetar(estadoBomDoServidor({
        tecidos: tec.tecidos, variantes: tec.variantes, ocLinks: oc, aviamentos: av, etiquetas: et, grades: gr,
        planejados: tecidosPlanejadosRef.current,
      }));
      ultimaAssinaturaServidorRef.current = assinaturaBom(servidor);
      ultimaAssinaturaCadServidorRef.current = assinaturaCadServidor(cadSrv);
      return bomDivergeDaReferencia(referenciaRef.current, servidor) || cadDivergeDaReferencia(referenciaCadRef.current, cadSrv);
    } catch {
      return true;
    }
  };

  /**
   * Chamar quando o `rev` do modelo mudou (save de outra pessoa, eco do meu save, ou ação MINHA que mexe em `modelos`
   * — Mover para…, Ordem de Criação, Lançar, aprovar MO). Sem BOM tocado: só recarrega (a carga reaplica e a referência
   * acompanha; se o usuário tocar ANTES de o refetch chegar, a CARGA compara — R5a, `aoRecarregarComTocadoRef`). Com BOM
   * tocado: CONFERE se o BOM do servidor mudou de verdade e só então acende "Tecidos & BOM" — o eco das ações do próprio
   * usuário (que não mexem no BOM) é ignorado. Enquanto ESTA conferência roda, o Salvar espera (`verificandoBomRef`).
   * Sobra uma janela de ~1 ida e volta (tocar E salvar antes de o refetch do caminho "sem toque" chegar) — a mesma
   * classe de janela do Dev, que nem compara (decisão 8; §5 R7/R20).
   */
  const aoMudarNoServidor = () => {
    if (!habilitada) return;
    // Item E (fix round 3, (c)) — ramo SEM toque: invalida INCONDICIONALMENTE, com ou sem prefill pendente
    // (a condição já era só `!colecoesTouchadasRef`, sem olhar `prefillPendenteRef` — nada muda aqui). O
    // refetch disparado por esta invalidação passa pelo efeito de carga do `useFichaBom`, que resolve a
    // pendência pelo item (b): se o BOM do servidor chegou NÃO-vazio, `prefillPendenteRef` é zerado lá.
    if (!bom.colecoesTouchadasRef.current) {
      // F3.3 — R1 (G-plano): SÍNCRONO e ANTES do invalidar. O `revRef` já avançou (merge) e o `bomFetching` só vira true
      // no próximo render: sem isto, um Salvar nessa janela passaria no `.eq("rev")` e o `salvar_cad_completo` regravaria
      // CAD, consumo e grade VELHOS por cima da edição de outra pessoa. Zerado no `aoHidratar` do CAD.
      cadVelhoRef.current = true;
      invalidarBom();
      return;
    }
    // Item G — save em voo (contador > 0, fix round 3): o eco do UPDATE do header (bump de `rev`) do PRÓPRIO
    // save não confere nem acende "Tecidos & BOM" — só marca que deve invalidar (o `aposSalvar` já invalida
    // ao fim; a R5a do guardião, que cobre "outra pessoa salva o consumo com o meu tocado", continua ativa —
    // ela entra pela CARGA, não por aqui). Sem isto, a conferência (que compara o BOM ainda velho do servidor
    // com a referência ainda velha) roda e resolve visivelmente ANTES do `bomGravado`/`aposSalvar`, piscando
    // o aviso à toa.
    if (saveEmVooContadorRef.current > 0) { invalidarBom(); return; }
    const geracao = ++geracaoRef.current;
    setVerificandoBoth(true);
    void bomMudouNoServidor().then((mudou) => {
      if (geracao !== geracaoRef.current) return; // chegou outra mudança depois — a conferência dela decide
      setVerificandoBoth(false);
      if (mudou && bom.colecoesTouchadasRef.current) setConflitoBomBoth(true);
    });
  };
  /**
   * "manter meu" → fecha o aviso (o próximo Salvar sobrescreve); "usar o novo" → descarta e recarrega.
   * Fix round 1 (I2, 3ª parte) — DECISÃO: `bom.descartarEdicoes()` só limpa o "tocado"/flags do BOM
   * MANUFATURADO (`useFichaBom.ts`) — a grade cor × tamanho do comprado (`gradeRevenda`/`gradeRevendaDirty`)
   * é estado de FORA deste hook (vive em `PlanejamentoDetail.tsx`/`usePlanejamentoSave.ts`, fora dos arquivos
   * deste fix) e NÃO é descartada aqui. Cenário: importado com a grade editada (marca `colecoesTouchadasRef`
   * via `marcarGradeExternaEditada`, que soma ao mesmo "tocado" do BOM) entra em conflito de seção e o usuário
   * escolhe "usar o novo" — `descartarEdicoes()` limpa `colecoesTouchadasRef`/`tocado`, mas `gradeRevendaDirty`
   * (fora daqui) permanece `true`: a grade editada pelo usuário CONTINUA na tela, só o marcador de "tocado" da
   * ficha foi zerado. Escolhido MANTER A PENDÊNCIA (não tentar descartar/recarregar a grade por aqui, que exigiria
   * acesso a `setGradeRevenda`/`gradeRevendaBaseRef`, fora do escopo desta função): `bomPendenteDeGravar()`
   * sozinho voltaria a `false` depois deste "usar o novo", mas os 2 pontos de `usePlanejamentoSave.ts` que a
   * chamam SOMAM `gradeCompradoPeloBom && gradeRevendaDirty` por fora (fix round 1, I2) — então a pendência da
   * grade segue visível para o próximo guard/conflito mesmo com o "tocado" do BOM já limpo aqui. O próximo
   * Salvar grava a grade normalmente (ela nunca foi perdida, só o "toque" da ficha resetou).
   */
  const resolverConflitoBom = (manterMeu: boolean) => {
    setConflitoBomBoth(false);
    if (manterMeu) {
      // Já vi ESTA versão do servidor: só um conflito NOVO acende o aviso de novo.
      if (ultimaAssinaturaServidorRef.current) referenciaRef.current = ultimaAssinaturaServidorRef.current;
      if (ultimaAssinaturaCadServidorRef.current !== null) referenciaCadRef.current = ultimaAssinaturaCadServidorRef.current;
      return;
    }
    bom.descartarEdicoes();
    invalidarBom();
  };

  const { etapas } = useEtapasAfetadas(habilitada && a.modeloId ? a.modeloId : "");

  /**
   * F3.3 — o CAD que ESTE Salvar grava (Dev :2062-2119; decisão F3 #7 "todo Salvar regrava" com as guardas de
   * `deveGravarCad` — plano F3.3 §3 P2). Lê refs (vale no retry). `linhasParaGravar`: linha que o servidor não tem só vai
   * quando o BOM grava junto (senão o CAD ganharia um tecido que o BOM do servidor não tem).
   */
  // urg R1 — catálogo de insumos de AGORA (a captura pode rodar num retry, depois de outro render).
  const etiquetaMapRef = useRef(dados.etiquetaMap);
  etiquetaMapRef.current = dados.etiquetaMap;
  const capturarCad = (e: EstadoBom, bomGravado: boolean, retry: boolean, proporcoes: Record<string, number>): CadCapturado => {
    const c = cadCapturaRef.current;
    const estadoCad = cad.linhasRef.current;
    const linhas = linhasParaGravar(estadoCad, { bomGravado, chavesBomServidor: c.chavesBom });
    // `tocado` = a ficha foi tocada OU o BOM grava neste Salvar (inclui o pré-preenchimento pendente da F3.2 — item E):
    // §3 P2 — se o BOM grava, o CAD grava junto. `recarregando` = recarga em curso (`bomFetching`, espelho do render)
    // OU pedida e ainda não aplicada ao CAD (`cadVelhoRef`, SÍNCRONO — R1 do G-plano F3.3): sem toque, não grava o CAD.
    const gravar = deveGravarCad({
      podeEditar: podeEditarRef.current && !compradoRef.current, cadHidratado: c.hidratado, cadExiste: c.existe, ordemEnviada: c.ordemEnviada,
      linhas: linhas.length, tocado: bom.colecoesTouchadasRef.current || bomGravado, retry,
      recarregando: c.recarregando || cadVelhoRef.current,
    });
    return {
      estado: estadoCad, linhas, snapshot: snapshotCad(estadoCad), gravar,
      payload: gravar ? montarCadPayload({ cad: linhas, grades: e.grades, aviamentos: e.aviamentos, etiquetas: e.etiquetas, proporcoes, tamanhoPorEtiqueta: tamanhoPorEtiquetaDe(e.etiquetas, etiquetaMapRef.current) }) : null,
    };
  };

  /** F3.4 — importado: célula da grade cor × tamanho editada. A grade grava POR ESTE BOM (plano F3.4 §3), então a ficha fica
   *  "tocada" p/ a conferência com o servidor (R5/R5a) proteger o Salvar — o "não salvo" dela vem da própria grade. */
  const marcarGradeExternaEditada = () => {
    if (compradoRef.current && podeEditarRef.current) bom.marcarTocado();
  };

  const save: FichaSave = {
    podeGravarColunasDev: podeEditar,
    podeVerCustos,
    conflitoBomRef,
    verificandoBomRef,
    invalidarBom,
    marcarSaveEmVoo,
    colecoesTouchadasRef: bom.colecoesTouchadasRef,
    setConflitoBom: setConflitoBomBoth,
    bomMudouNoServidor,
    // Item E (fix round 3, (a)) — mesma condição de `gravar` em `capturar()` abaixo PARA O BOM MANUFATURADO:
    // tocado OU prefill pendente. NÃO cobre a grade cor × tamanho do comprado (fix round 1, I2) — quem chama
    // esta função soma `gradeCompradoPeloBom && gradeRevendaDirty` por fora (ver o tipo `FichaSave` acima, doc
    // de `bomPendenteDeGravar`, e os 2 pontos de uso em `usePlanejamentoSave.ts`).
    // Fix round 4 (item 9, acréscimo do controlador) — soma `podeEditarRef.current`: o prefill
    // (`prefillPendenteRef`) é marcado na CARGA do BOM (useFichaBom.ts) pra QUALQUER um que veja o Dev, não só
    // quem edita — um usuário só-leitura (ex.: `canView` sem `canEdit`, ou card travado por "enviado"/"carregando")
    // nunca vai gravar o BOM (a trava zera `podeGravarColunasDev`/handlers viram NO-OP), mas SEM este gate
    // `bomPendenteDeGravar()` dava `true` só pelo prefill, e o `onError` do P0409 (usePlanejamentoSave.ts)
    // conferia o BOM do servidor e podia acender "Tecidos & BOM"/travar o Salvar por um BOM que este save
    // jamais tentaria gravar. Cenário do controlador: usuário só-VÊ o Dev salva o preço durante um P0409 —
    // antes travava à toa; agora não, porque `podeEditarRef.current` é `false` para ele.
    bomPendenteDeGravar: () => podeEditarRef.current && (bom.colecoesTouchadasRef.current || bom.prefillPendenteRef.current),
    capturar: (custosAdicionais, opts) => {
      const e = projetar(bom.estadoRef.current);
      const snap = snapshotBom(e);
      const base = guarda.baselineRef.current;
      // "BOM só grava quando carregado E sujo" — `podeEditar` já exige carregado (e sem trava).
      // Item E (fix round 2, RULING do controlador): OU há um pré-preenchimento pendente (BOM do
      // servidor chegou vazio e a carga preencheu Tecido 1..N a partir de `tecidos_planejados` sem
      // marcar tocado — ficha-calc :123, useFichaBom prefillPendenteRef) — paridade com o Dev, que
      // regrava o BOM a todo Salvar.
      // Fix final ROUND 2, item 1 (M1) — "tocado E sujo" (sem o `podeEditarRef.current`, que decide só se
      // ESTA captura vai GRAVAR, não se a ficha ESTÁ suja): tocar e desfazer (`snap===base`) ou uma
      // proporção/toggle de grade automática com `oldSum=0`/`grade_total=0` (marca tocado, mas o snapshot da
      // GRADE não muda — só `proporcoes`, fora do snapshot do BOM) saem `false` aqui.
      const bomSujo = bomSujoNaCaptura(bom.colecoesTouchadasRef.current, snap, base);
      // F3.4 — comprado: a grade cor × tamanho é a fonte (decisão F3 #4). `salvar_modelo_bom` APAGA todas as grades, então o
      // BOM do comprado leva a grade dela (`gradesPayload`: editada ⇒ o rascunho; senão a do SERVIDOR LIDA NO PRÓPRIO SALVAR
      // — `ge.servidor`, R1 do G-plano F3.4: nunca o cache `plan-ficha-grades`, que fica VELHO na janela entre uma mudança
      // alheia sem toque e o refetch). No IMPORTADO a grade grava POR AQUI (não há `salvar_grade_revenda` p/ importado),
      // então a grade editada também faz o BOM gravar; se a do servidor mudou desde a abertura ⇒ conflito.
      const ge = compradoRef.current ? opts?.gradeExterna ?? null : null;
      const servidorGrades = ge?.servidor ?? null;
      const gravaPelaGrade = ge !== null && ge.gravaPeloBom && ge.editada;
      const gravar = podeEditarRef.current
        && ((bomSujo || bom.prefillPendenteRef.current) || gravaPelaGrade);
      // R1 — falha FECHADA: comprado que grava o BOM sem a grade do servidor lida AGORA não grava nada (sem `?? []`: lista
      // vazia apagaria a grade inteira; o cache poderia regravar uma grade velha por cima da de outra pessoa).
      if (compradoRef.current && gravar && servidorGrades === null) {
        throw new Error("Não deu para conferir a grade deste card no servidor — nada foi salvo. Tente de novo.");
      }
      const gradeConflito = gravar && gravaPelaGrade && ge !== null && servidorGrades !== null
        && gradeCompradoMudouNoServidor(ge.baseJson, servidorGrades);
      // Fix T9 I2 da F3.3 (rebase F3.3→3adfbd3: UM campo só, `sujoNaCaptura` = BOM sujo OU CAD sujo) — o CAD usa o
      // MESMO helper puro da F3.2 (`bomSujoNaCaptura(tocado, snap, base)` — a fórmula é genérica), lido DIRETO das refs
      // (`cad.linhasRef`/`guardaCad.baselineRef`), não de `guardaCad.dirty` (STATE, só atualiza no próximo render).
      // Fix pós-rebase I1 — o gate NÃO é mais `cadGravavelRef.current` (que inclui `podeEditar`: a trava chegando
      // ENTRE a edição e o Salvar apagava a edição em silêncio). O CAD só conta como "esperado" por D2
      // (`cadCapturaRef.current.existe || .ordemEnviada` — o CAD era pra existir, com ou sem permissão de gravá-lo
      // AGORA); ver `cadSujoNaCaptura` em ficha-calc.ts.
      // Fix M1 (revisão Opus, rodada 1) — união com a F3.4: o CAD do COMPRADO nunca conta como sujo. O
      // Planejamento NUNCA grava o CAD do comprado (nasce no recebimento da OC — `_receber_oc_p_acabado_core`;
      // `salvar_cad_completo` não é chamado por este fluxo, ver `cadGravavel`/`deveGravarCad` acima), mas a
      // sincronia BOM→CAD e as folhas automáticas RODAM para o comprado quando a seção Tecidos está visível
      // pelo Fluxo de Revenda (`comprado.ts`) — sem o `!compradoRef.current`, `snapCad` podia divergir de
      // `baseCad` mesmo sem o usuário poder salvar aquilo, e a ficha ficava "tocada" com o Salvar não
      // regravando nada (toast de "alterações NÃO foram salvas" preso). A F3.4 original tinha essa exclusão
      // (via `cadGravavelRef` composto com `!isComprado`, removido pelo Fix pós-rebase I1 acima) — este fix
      // reintroduz só o `!compradoRef.current`, sem voltar ao `podeEditar` (a causa raiz que o I1 corrigiu).
      const baseCad = guardaCad.baselineRef.current;
      const snapCad = snapshotCad(cad.linhasRef.current);
      const cadEsperadoNaCaptura = !compradoRef.current && (cadCapturaRef.current.existe || cadCapturaRef.current.ordemEnviada);
      const cadSujo = cadSujoNaCaptura(cadEsperadoNaCaptura, bom.colecoesTouchadasRef.current, snapCad, baseCad);
      return {
        estado: e,
        snapshot: snap,
        gravar,
        sujoNaCaptura: bomSujo || cadSujo,
        flags: { ...bom.flagsRef.current, grade: bom.flagsRef.current.grade || gravaPelaGrade },
        idsEtiquetasServidor: (dados.etiquetasDataRef.current ?? []).map((x) => x.id),
        tecidosPlanejados: tecidosPlanejadosDerivados(e.blocks, bom.varianteArtigoMapRef.current),
        // Fix round 4 (item 3) — antes só vinha com `podeEditarRef` (ficha destravada); agora vem sempre que
        // CARREGADA (travada ou não), sobre o estado carregado (`e` = `bom.estadoRef.current`, que com a
        // ficha travada É o estado do servidor — travado não edita). `custo_peca_previsto` é DERIVADO do
        // BOM + MO, não uma coluna do Dev: precisa acompanhar a MO mesmo sem permissão de gravar o resto do
        // Dev. As demais colunas derivadas (`custo_*` por tipo) continuam gated por `podeGravarColunasDev`
        // em `aplicarColunasFicha` (save-ficha.ts) — não mudou.
        totais: carregadoRef.current ? totaisBom({ blocks: e.blocks, aviamentos: e.aviamentos, etiquetas: e.etiquetas, custosAdicionais, maoObra: 0 }) : null,
        cad: capturarCad(e, gravar, !!opts?.retry, opts?.proporcoes ?? a.proporcoes),
        // null num comprado só quando NÃO grava (acima, gravar sem a leitura fresca lança) — persistirBom nem roda.
        gradesPayload: compradoRef.current && servidorGrades !== null
          ? gradesParaBomComprado({ editada: !!ge?.editada, rascunho: ge?.rascunho ?? [], servidor: servidorGrades })
          : null,
        gradeExterna: gravaPelaGrade && ge !== null ? { estadoJson: ge.estadoJson } : null,
        gradeConflito,
        // Item C — `true` só quando a captura viu o card JÁ enviado (a trava ÚNICA em "enviado"). Os outros
        // motivos ("permissao"/"carregando"/null) não são o cenário do bug (envio à Explosão em voo).
        enviadoNaCaptura: motivoSomenteLeituraRef.current === "enviado",
      };
    },
    // m1 da revisão T10: a referência vira o ENVIADO assim que o servidor o tem, mesmo que um passo seguinte falhe
    // (o `persistirBom` já grava tecidos/aviamentos/grades E etiquetas — etiquetas não têm passo próprio, estão
    // dentro dele). Re-review D (fix round 2): depois de mover a referência, invalida o BOM também — sem isso, o
    // eco do UPDATE (que adota `tecidos_planejados`) muda o `planejadosKey`, e a R5a comparava o cache VELHO do
    // BOM (ainda com o `planejadosKey` antigo) com a referência = ENVIADO, acendendo "Tecidos & BOM" falso.
    bomGravado: (bomEnviado) => {
      referenciaRef.current = assinaturaBom(bomEnviado.estado);
      invalidarBom();
    },
    // F3.3 — a referência do CAD vira o ENVIADO assim que o servidor o tem (mesmo que um passo seguinte falhe).
    cadGravado: (c) => { referenciaCadRef.current = assinaturaCad(c.linhas); },
    aposSalvar: ({ bomEnviado }) => {
      const vivo = snapshotBom(projetar(bom.estadoRef.current));
      // F3.3 — o CAD entra na MESMA regra: edição em voo no CAD também segue "não salva" (as DUAS guardas re-baseiam no
      // ENVIADO; sem edição em voo, o "tocado" da ficha inteira solta).
      const cadMudouEmVoo = snapshotCad(cad.linhasRef.current) !== bomEnviado.cad.snapshot;
      const bomMudouEmVoo = bom.colecoesTouchadasRef.current && (vivo !== bomEnviado.snapshot || cadMudouEmVoo);
      // Fix final M1 — a trava pode ter chegado ENTRE a captura (que marcou `bomEnviado.gravar`) e este
      // ponto (a mesma captura é reusada aqui — `enviadoRef.current.bom` no orquestrador). Só limpa o
      // "tocado"/rebaseia quando o toque de fato FOI gravado (ou nunca houve toque) — senão a edição do
      // usuário sumiria sem aviso e sem chance de tentar de novo (`deveLimparTocadoAposSalvar`).
      // Fix final ROUND 2, item 1 — o `tocado` cru (`bom.colecoesTouchadasRef.current`, lido de AGORA) dava
      // aviso falso a cada Salvar: `gravar` exige `snap!==base`, então qualquer toque SEM mudança real no
      // snapshot (tocar e desfazer; `updateProporcao`/`toggleGradeAuto` com grade zerada) tinha `tocado=true`
      // e `gravar=false`, e `deveLimparTocadoAposSalvar` nunca limpava. Troca por `bomEnviado.sujoNaCaptura`
      // — "tocado E sujo" capturado no MESMO instante que `gravar` (não o `tocado` de agora, que pode já ter
      // mudado durante o `await` do save) — para distinguir "tocou sem sujar" (limpa normalmente) de "sujou
      // de verdade mas a trava chegou depois e impediu a gravação" (NÃO limpa; ver cenário (c) no relatório).
      // Fix pós-T9 da F3.3 (re-revisão de 67e363f, item 1) — o CAD também conta: só limpa quando não havia toque, ou
      // quando o que estava tocado foi de fato gravado (BOM ou CAD).
      // Fix pós-T9 (re-revisão de 67e363f, item 1) — "edições perdidas em silêncio": a ficha estava TOCADA mas
      // `capturar()`/`capturarCad` decidiram `gravar=false` (ex.: `podeEditar`/CAD hidratado viraram false NO MEIO do
      // caminho — a captura já tinha corrido antes disso). Sem esta guarda, o `else bom.limparTocado()` de baixo
      // apagava o "não salvo" mesmo sem NADA ter ido ao servidor — a edição do usuário sumia sem aviso e sem chance
      // de tentar salvar de novo. `deveLimparTocadoAposSalvar` (save-ficha.ts, puro/testado): só limpa quando não
      // havia toque, ou quando o que estava tocado foi de fato gravado (BOM ou CAD).
      // Fix T9 I2 (IMPORTANTE) — `tocado` deixou de ser `bom.colecoesTouchadasRef.current` (a ref crua fica
      // `true` mesmo depois de "tocar e desfazer": o snapshot volta a bater com o baseline, mas a ref de toque
      // não reseta) e passou a ser `bomEnviado.sujoNaCaptura` — "havia algo NÃO SALVO na captura" CONGELADO no
      // início deste Salvar (BOM sujo OU CAD sujo — `bomSujoNaCaptura` da F3.2 lido das refs; ficha-calc.ts). Sem este fix,
      // "tocar e desfazer" (ou editar só o BOM antes da Ordem, sem CAD — D2) sempre caía em `tocado=true,
      // bomGravou=false ⇒ false`: aviso "NÃO foram salvas" falso em TODO Salvar e o tocado preso pra sempre.
      const podeLimpar = deveLimparTocadoAposSalvar({
        tocado: bomEnviado.sujoNaCaptura,
        bomGravou: bomEnviado.gravar,
        cadGravou: bomEnviado.cad.gravar,
      });
      // Fix T9 M4 — o rebase (ramo `bomMudouEmVoo`) corria INCONDICIONAL, antes até de checar `podeLimpar`: com a
      // ficha suja na captura e NADA gravado (`!podeLimpar`) MAIS uma edição em voo por cima, o rebase adotava
      // `bomEnviado.snapshot`/`.cad.snapshot` como baseline — um snapshot que NUNCA foi ao servidor. Isso
      // contradiz o próprio comentário de `deveLimparTocadoAposSalvar` (save-ficha.ts): "NÃO limpe o tocado
      // (nem rebaseie, nem mova a referência)" quando havia algo que devia gravar e não gravou. `!podeLimpar`
      // agora barra os DOIS ramos — nem rebaseia, nem limpa; o "não salvo" segue contra o baseline de ANTES
      // deste Salvar (o `edicoesPerdidas` do retorno já avisa o orquestrador via toast).
      const edicoesPerdidas = !podeLimpar;
      if (podeLimpar) {
        if (bomMudouEmVoo) { guarda.rebasear(bomEnviado.snapshot); guardaCad.rebasear(bomEnviado.cad.snapshot); }
        else bom.limparTocado();
      }
      // R5 — o servidor passa a ter o que foi ENVIADO: é a nova referência (o eco do meu save não acende conflito).
      if (bomEnviado.gravar) referenciaRef.current = assinaturaBom(bomEnviado.estado);
      if (bomEnviado.cad.gravar) referenciaCadRef.current = assinaturaCad(bomEnviado.cad.linhas);
      // NOTA do re-check do guardião — a conferência disparada pelo eco do 1º write (UPDATE) pode ter lido o BOM DEPOIS do
      // salvar_modelo_bom e comparado com a referência VELHA; se o `.then` dela resolvesse depois daqui, com edição em
      // voo, o aviso ficaria aceso. `geracaoRef += 1` a descarta; e como ela não chega a baixar o "conferindo", baixa-se
      // aqui (senão o Salvar ficaria esperando). Um BOM alheio que tenha chegado nesse meio-tempo segue coberto: o
      // `invalidarBom()` abaixo recarrega e a carga compara com a referência NOVA (R5a).
      geracaoRef.current += 1;
      setVerificandoBoth(false);
      bom.limparFlags();
      bom.limparCopiados();
      setConflitoBomBoth(false);
      invalidarBom();
      // Fix pós-T9 (item 1) — avisa o orquestrador (usePlanejamentoSave.ts) quando a ficha tocada NÃO foi gravada
      // (nem BOM nem CAD), pra ele mostrar o aviso PT — "não salvo" segue aceso, mas sem toast o usuário não saberia
      // que precisa recarregar/tentar de novo (a mutation inteira reporta "Modelo salvo" com sucesso).
      return { bomMudouEmVoo, edicoesPerdidas };
    },
    etapas,
  };

  return {
    habilitada, carregado, podeEditar, podeVerCustos, motivoSomenteLeitura,
    dados, estado, handlers, gradeAuto: bom.gradeAuto,
    tecido1Info, totais, selos, seloCad,
    // F3.3 — seção CAD (render em BomSecoes) e as regras dela.
    cad: { linhas: cad.linhas, autoFolhas: cad.autoFolhas, faltas: cad.faltas, handlers: cadHandlers },
    cadGravavel, cadAntesDaOrdem: !dados.cadExiste && !a.ordemEnviada,
    // F3.4 — comprado: a grade é a cor × tamanho do produto (fora da ficha); a célula editada no importado marca a ficha.
    gradeExterna: a.isComprado, marcarGradeExternaEditada,
    // R7 do G-plano F3.4 — a ficha foi tocada (a Origem não muda com edição pendente: a referência do BOM foi calculada com a
    // projeção desta origem). `tocado`, não `dirty`: editar e desfazer mantém a referência presa à projeção de agora.
    tocado: bom.tocado,
    // F3.3 — Importar dados: só com a ficha editável (o item do menu nem aparece sem isso).
    aplicarImportacaoBom: podeEditar ? bom.aplicarImportacao : (_p: PatchCopia, _c: Set<string>) => undefined,
    /**
     * Acréscimo pós-T10 (M2, aprovado) — a execução de "Importar dados" pode rodar bem depois deste render (o
     * usuário passa por um AlertDialog de confirmação de sobrescrita antes). `useImportarDados.aplicar` fecha
     * sobre este `ficha` do momento do CLIQUE (`onCopiar`), não do momento da confirmação — sem uma ref viva,
     * ele leria `podeEditar` desatualizado (a ficha pode ter travado nesse meio-tempo: recarga alheia, "outra
     * pessoa enviou à Explosão"). Mesmo padrão de `podeEditarRef` interno, exposto pra fora do hook.
     */
    podeEditarRef,
    confirmGrade: bom.confirmGrade, setConfirmGrade: bom.setConfirmGrade,
    camposCopiados: bom.camposCopiados, onCampoEditado: bom.onCampoEditado, marcarCopiados: bom.marcarCopiados,
    dirty: guarda.dirty || guardaCad.dirty,
    colab: { conflitoBom, verificandoBom, aoMudarNoServidor, resolverConflitoBom },
    save,
  };
}

export type FichaTecnica = ReturnType<typeof useFichaTecnica>;
