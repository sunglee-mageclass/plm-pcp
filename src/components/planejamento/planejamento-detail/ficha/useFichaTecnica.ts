// F3.2 — ORQUESTRADOR da ficha técnica (BOM) no Sheet do Planejamento de Produto. Compõe useFichaDados
// (queries) + useFichaBom (estado/handlers) + useFichaGuarda ("não salvo") e expõe 3 superfícies:
//  • seções (render das seções 5-8 e das linhas de custo do BOM na tabela de Preço e Custos);
//  • colab (conflito de SEÇÃO "Tecidos & BOM" — Dev :599-603, :838-843, :1813-1842 — só quando o BOM do SERVIDOR
//    mudou de verdade: R5 do G-plano conjunto);
//  • `save` (FichaSave — consumida por usePlanejamentoSave).
// Trava ÚNICA (R2 do G-plano conjunto): deriva da trava da F3.1 (`travaDev`) + a trava interina "tem CAD".
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
import { contadorVoo } from "../save-ficha";
import {
  assinaturaBom, bomDivergeDaReferencia, estadoBomDoServidor,
  paresComplementares, resumoBom, snapshotBom, tecido1VariantesInfo, tecidosPlanejadosDerivados, totaisBom,
  type AviamentoRowDb, type BomCapturado, type EstadoBom, type EtiquetaRowDb, type GradeRowDb, type OcLinkRowDb,
  type TecidoRowDb, type VarianteRowDb,
} from "./ficha-calc";
import { requisitosUniao, seloSecaoBom, type SecaoBomKey, type SeloSecao } from "./selos-bom";

const SEM_LABELS: Record<string, string> = {};

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

export type FichaSave = {
  /** habilitada E carregada E sem trava (permissão / enviado / tem CAD) ⇒ colunas do Dev vão no UPDATE. */
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
  capturar: (custosAdicionais: unknown) => BomCapturado;
  /** Pós-save: re-baseia (edição em voo segue "não salva"), a referência vira o ENVIADO, limpa marcadores, invalida o BOM. */
  aposSalvar: (a: { bomEnviado: BomCapturado }) => { bomMudouEmVoo: boolean };
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
   * Item E (fix round 3, (a)) — "este save IA gravar o BOM?" = BOM tocado OU pré-preenchimento pendente
   * (mesma condição de `gravar` em `capturar()`, sem depender de `podeEditar`/carga — lida direto das refs,
   * vale fora do ciclo de render). Usada no `onError` do P0409 (`usePlanejamentoSave.ts`) para decidir se
   * confere o BOM do servidor: com prefill pendente e `colecoesTouchadasRef=false`, o `bomConflito` de hoje
   * ficava sempre `false` (só olhava `colecoesTouchadasRef`) — um P0409 nesse instante fazia o retry gravar o
   * esqueleto Tecido 1..N por cima do BOM que outra pessoa completou nesse meio-tempo (cenário do bug).
   */
  bomPendenteDeGravar: () => boolean;
  etapas: { corte?: boolean; baixa_total?: number };
};

/**
 * Por que o BOM está só-leitura. Trava ÚNICA (R2): "permissao" e "enviado" vêm da trava da F3.1 (`motivoTravaDev`, com o
 * "Editar" já considerado); "cad" = trava INTERINA da F3.2 (a F3.3 tira: grava o CAD no Salvar e o "Editar" passa a
 * destravar o BOM também).
 */
export type MotivoSomenteLeitura = "permissao" | "enviado" | "carregando" | "cad" | null;

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
}) {
  const qc = useQueryClient();
  const { canView, canEdit } = useAuth();
  // Decisão F3 #8: seções do Dev visíveis p/ quem VÊ o Desenvolvimento, editáveis p/ quem o EDITA.
  const podeVerFicha = canView("criacao_desenvolvimento");
  const podeEditarFicha = canEdit("criacao_desenvolvimento");
  const podeVerCustos = canView("criacao_planejamento:custos") || canView("criacao_desenvolvimento:custos");
  // Só produto interno na F3.2 (decisão F3 #4; comprado = F3.4).
  const habilitada = a.isEdit && !!a.modeloId && !a.isComprado && podeVerFicha;

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
  tecidosPlanejadosRef.current = a.tecidosPlanejados;
  // T7 m1 — `aoRecarregarComTocado` (R5a) precisa existir na hora da chamada de `useFichaBom`, mas a função
  // REAL (abaixo) lê `bom.colecoesTouchadasRef` — que só existe DEPOIS dessa chamada. A ref indireciona: a
  // carga sempre invoca a versão ATUAL via `aoRecarregarComTocadoRef.current(...)`, montada logo após `bom`
  // existir, lendo a ref VIVA (`bom.colecoesTouchadasRef`) em vez de um espelho por render.
  const aoRecarregarComTocadoRef = useRef<(servidor: EstadoBom) => void>(() => undefined);

  const bom = useFichaBom({
    modeloId: a.modeloId, habilitada, dados,
    tecidosPlanejados: a.tecidosPlanejados, proporcoes: a.proporcoes, setDraftTracked: a.setDraftTracked,
    aoRecarregarComTocado: (servidor) => aoRecarregarComTocadoRef.current(servidor),
  });
  /**
   * R5a (re-check do guardião) — a CARGA (useFichaBom) chegou com o BOM local JÁ tocado: ela não sobrescreve
   * (mesma regra do Dev), mas monta o estado do SERVIDOR com as MESMAS funções da carga e entrega aqui. Só
   * ACENDE "Tecidos & BOM" — nunca apaga (quem apaga é só `resolverConflitoBom`/`aposSalvar`). Sem isto, uma
   * mudança alheia que chega enquanto o usuário já está editando o BOM (recarga automática/foco, ANTES de
   * qualquer `aoMudarNoServidor` via `rev`) passaria batido — o próximo Salvar sobrescreveria o BOM de outra
   * pessoa sem aviso (buraco descrito em ficha-calc :147-159). Lê `bom.colecoesTouchadasRef.current` DIRETO
   * (a ref viva) — não um espelho por render, que ficaria um render atrasado.
   */
  aoRecarregarComTocadoRef.current = (servidor) => {
    ultimaAssinaturaServidorRef.current = assinaturaBom(servidor);
    if (bom.colecoesTouchadasRef.current && bomDivergeDaReferencia(referenciaRef.current, servidor)) {
      setConflitoBomBoth(true);
    }
  };

  const estado: EstadoBom = useMemo(
    () => ({ blocks: bom.blocks, aviamentos: bom.aviamentosState, etiquetas: bom.etiquetasState, grades: bom.grades }),
    [bom.blocks, bom.aviamentosState, bom.etiquetasState, bom.grades],
  );
  const snapshot = useMemo(() => snapshotBom(estado), [estado]);
  const guarda = useFichaGuarda({ modeloId: a.modeloId, snapshot, tocado: bom.tocado, hidratado: bom.hidratado });

  const carregado = habilitada && bom.hidratado && dados.catalogosProntos && bom.varianteArtigoMapPronto;
  // Trava ÚNICA (R2 do G-plano conjunto): DERIVA da trava da F3.1 e soma a trava INTERINA "tem CAD" (até a F3.3):
  // sem regravar o CAD, um consumo editado aqui seria DEVOLVIDO pelo próximo Salvar do Dev (salvar_cad_completo copia
  // consumo_cad → BOM, funcoes.sql:6878-6881) e a Explosão ficaria desalinhada. Card enviado ⇒ tem CAD (0 exceções na
  // cópia local): o "Editar" da F3.1 destrava os campos simples do Dev, mas aqui o motivo só passa de "enviado" a "cad".
  const motivoSomenteLeitura: MotivoSomenteLeitura =
    a.travaDev === "sem_permissao" || !podeEditarFicha ? "permissao"
      : a.travaDev === "enviado" ? "enviado"
        : !dados.cadFetched ? "carregando"
          : dados.cadExiste ? "cad"
            : null;
  const podeEditar = carregado && motivoSomenteLeitura === null;
  // T7 m2 — `capturar` (chamado no início do Salvar, inclusive num RETRY) precisa ler o `podeEditar` de
  // AGORA, não o do closure em que `save.capturar` foi criado no render anterior. Cenário: P0409 porque
  // outra pessoa enviou o card à Explosão ENTRE o clique em Salvar e o retry — sem a ref, o retry gravaria
  // o BOM com o `podeEditar` velho (true) num card que, agora, está só-leitura.
  const podeEditarRef = useRef(false);
  podeEditarRef.current = podeEditar;
  // Item C (fix round 2) — mesmo padrão/motivo do `podeEditarRef` acima: `capturar()` (chamado dentro do
  // retry do P0409, fora do ciclo normal de render) precisa ler o motivo de AGORA, não o closure velho.
  const motivoSomenteLeituraRef = useRef<MotivoSomenteLeitura>(null);
  motivoSomenteLeituraRef.current = motivoSomenteLeitura;
  // T9 I1(a) — sem permissão/enviado/cad ⇒ handlers NO-OP (identidade estável de módulo); com permissão ⇒ os
  // handlers de verdade do `useFichaBom`. `bom.handlers` é recriado a cada render de `useFichaBom` (objeto
  // literal no return, sem `useMemo` próprio) — o `useMemo` aqui não evita recriação nesse ramo (a dependência
  // `bom.handlers` já muda todo render), mas evita alocar objeto NOVO no ramo `podeEditar` (HANDLERS_NOOP é
  // sempre a MESMA referência) e mantém a superfície pedida pelo brief.
  const handlers = useMemo(
    () => (podeEditar ? bom.handlers : HANDLERS_NOOP),
    [podeEditar, bom.handlers],
  );

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
    () => requisitosUniao(a.isComprado ? dados.revendaCfg.requisitos : (dados.tenantCfg as any)?.kanban_requisitos),
    [a.isComprado, dados.revendaCfg, dados.tenantCfg],
  );
  const selos: Record<SecaoBomKey, SeloSecao> = {
    tecidos: seloSecaoBom("tecidos", requeridas, dados.condicoes, resumo),
    aviamentos: seloSecaoBom("aviamentos", requeridas, dados.condicoes, resumo),
    insumos: seloSecaoBom("insumos", requeridas, dados.condicoes, resumo),
    grade: seloSecaoBom("grade", requeridas, dados.condicoes, resumo),
  };

  // Reset ao trocar de modelo — mesma instância (Dialog → Sheet do card recém-criado, Dev :674-690).
  useEffect(() => {
    conflitoBomRef.current = false; setConflitoBom(false);
    verificandoBomRef.current = false; setVerificandoBom(false);
    referenciaRef.current = null;
    ultimaAssinaturaServidorRef.current = null;
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
      const chaves = chavesBomServidor(id);
      await Promise.all(chaves.map((k) => qc.refetchQueries({ queryKey: k, exact: true })));
      const tec = qc.getQueryData<{ tecidos: TecidoRowDb[]; variantes: VarianteRowDb[] }>(["plan-ficha-tecidos", id]);
      const oc = qc.getQueryData<OcLinkRowDb[]>(["plan-ficha-oc-links", id]);
      const av = qc.getQueryData<AviamentoRowDb[]>(["plan-ficha-aviamentos", id]);
      const et = qc.getQueryData<EtiquetaRowDb[]>(["plan-ficha-etiquetas", id]);
      const gr = qc.getQueryData<GradeRowDb[]>(["plan-ficha-grades", id]);
      if (!tec || !oc || !av || !et || !gr) return true;
      const servidor = estadoBomDoServidor({
        tecidos: tec.tecidos, variantes: tec.variantes, ocLinks: oc, aviamentos: av, etiquetas: et, grades: gr,
        planejados: tecidosPlanejadosRef.current,
      });
      ultimaAssinaturaServidorRef.current = assinaturaBom(servidor);
      return bomDivergeDaReferencia(referenciaRef.current, servidor);
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
    if (!bom.colecoesTouchadasRef.current) { invalidarBom(); return; }
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
  /** "manter meu" → fecha o aviso (o próximo Salvar sobrescreve); "usar o novo" → descarta e recarrega. */
  const resolverConflitoBom = (manterMeu: boolean) => {
    setConflitoBomBoth(false);
    if (manterMeu) {
      // Já vi ESTA versão do servidor: só um conflito NOVO acende o aviso de novo.
      if (ultimaAssinaturaServidorRef.current) referenciaRef.current = ultimaAssinaturaServidorRef.current;
      return;
    }
    bom.descartarEdicoes();
    invalidarBom();
  };

  const { etapas } = useEtapasAfetadas(habilitada && a.modeloId ? a.modeloId : "");

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
    // Item E (fix round 3, (a)) — mesma condição de `gravar` em `capturar()` abaixo, sem o `podeEditarRef`
    // (aqui é só "este save VAI TENTAR gravar", não "pode"): tocado OU prefill pendente.
    bomPendenteDeGravar: () => bom.colecoesTouchadasRef.current || bom.prefillPendenteRef.current,
    capturar: (custosAdicionais) => {
      const e = bom.estadoRef.current;
      const snap = snapshotBom(e);
      const base = guarda.baselineRef.current;
      // "BOM só grava quando carregado E sujo" — `podeEditar` já exige carregado (e sem trava).
      // Item E (fix round 2, RULING do controlador): OU há um pré-preenchimento pendente (BOM do
      // servidor chegou vazio e a carga preencheu Tecido 1..N a partir de `tecidos_planejados` sem
      // marcar tocado — ficha-calc :123, useFichaBom prefillPendenteRef) — paridade com o Dev, que
      // regrava o BOM a todo Salvar.
      const gravar = podeEditarRef.current
        && ((bom.colecoesTouchadasRef.current && (base === null || snap !== base)) || bom.prefillPendenteRef.current);
      return {
        estado: e,
        snapshot: snap,
        gravar,
        flags: { ...bom.flagsRef.current },
        idsEtiquetasServidor: (dados.etiquetasDataRef.current ?? []).map((x) => x.id),
        tecidosPlanejados: tecidosPlanejadosDerivados(e.blocks, bom.varianteArtigoMapRef.current),
        totais: podeEditarRef.current ? totaisBom({ blocks: e.blocks, aviamentos: e.aviamentos, etiquetas: e.etiquetas, custosAdicionais, maoObra: 0 }) : null,
        // Item C — `true` só quando a captura viu o card JÁ enviado (a trava ÚNICA em "enviado"). Os outros
        // motivos ("permissao"/"carregando"/"cad"/null) não são o cenário do bug (envio à Explosão em voo).
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
    aposSalvar: ({ bomEnviado }) => {
      const vivo = snapshotBom(bom.estadoRef.current);
      const bomMudouEmVoo = bom.colecoesTouchadasRef.current && vivo !== bomEnviado.snapshot;
      if (bomMudouEmVoo) guarda.rebasear(bomEnviado.snapshot);
      else bom.limparTocado();
      // R5 — o servidor passa a ter o que foi ENVIADO: é a nova referência (o eco do meu save não acende conflito).
      if (bomEnviado.gravar) referenciaRef.current = assinaturaBom(bomEnviado.estado);
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
      return { bomMudouEmVoo };
    },
    etapas,
  };

  return {
    habilitada, carregado, podeEditar, podeVerCustos, motivoSomenteLeitura,
    dados, estado, handlers, gradeAuto: bom.gradeAuto,
    tecido1Info, totais, selos,
    confirmGrade: bom.confirmGrade, setConfirmGrade: bom.setConfirmGrade,
    camposCopiados: bom.camposCopiados, onCampoEditado: bom.onCampoEditado, marcarCopiados: bom.marcarCopiados,
    dirty: guarda.dirty,
    colab: { conflitoBom, verificandoBom, aoMudarNoServidor, resolverConflitoBom },
    save,
  };
}

export type FichaTecnica = ReturnType<typeof useFichaTecnica>;
