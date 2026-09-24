// F3.2 — estado EDITÁVEL do BOM no Sheet do Planejamento + carga + handlers. PORTA (cópia) do PanelContent
// do Desenvolvimento (ModeloDetailPanel.tsx — carga :870-1038, herança :1452-1468, handlers :2435-2652),
// que fica INTOCADO até a F5 (decisão travada 8). Diferenças DELIBERADAS (registradas no plano F3.2):
//  • G-mockup R5: o pré-preenchimento com `tecidos_planejados` só roda com o BOM VAZIO (ficha-calc).
//  • CAD fora (F3.3): sem cadTecidosState e sem a propagação BOM→CAD de updateBlock (Dev :2441-2456).
//  • Carga num efeito ÚNICO (as 5 queries juntas) + `hidratarTick`, p/ "descartar e recarregar" reaplicar
//    mesmo quando o refetch devolve dados idênticos (structural sharing do React Query não troca a ref).
//  • "Tocado" também como ESTADO (alimenta o "não salvo" — useFichaGuarda); `toggleGradeAuto` marca tocado
//    (no Dev não marca, e a redistribuição podia ser sobrescrita por uma recarga).
//  • Confirmar "Apagar grade preenchida?" (troca do Tecido 1) marca o #Erro de grade (no Dev não marca).
//  • Marcadores do #Erro em ref (só o Salvar lê).
//  • R5a (re-check do guardião): com o BOM TOCADO a carga não sobrescreve (igual ao Dev), mas COMPARA o BOM que chegou
//    com a referência do usuário (`aoRecarregarComTocado` → o orquestrador acende "Tecidos & BOM" se divergir). O Dev só
//    retorna — tem o mesmo buraco, que fica lá (decisão travada 8; aviso ao dono no plano, §7 D5).
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { distribuiAncora, distribuiTotal, redistribuiPorEscala, somaGrade } from "@/lib/grade-proporcao";
import {
  makeEmptyBlocks, recomputeAviamento, recomputeBlock, recomputeEtiqueta,
  remapGradesAposRemocao, removerVarianteDoBloco,
  type AviamentoRow, type GradeRow, type ModeloEtiquetaRow, type OcAlloc, type TecidoBlock,
} from "@/components/desenvolvimento/modelo-detail/types";
import type { Draft } from "@/components/planejamento/modelo-shared";
import {
  deveHidratarCarga, estadoBomDoServidor, herdarGrades, hidratarAviamentos, hidratarBlocos, hidratarEtiquetas, hidratarGrades,
  relevantArtigoIds, tecido1VarianteIds as calcTecido1VarianteIds,
  type EstadoBom, type FlagsBom,
} from "./ficha-calc";
import type { FichaDados } from "./useFichaDados";

const MAPA_VAZIO: Record<string, string> = {};
const FLAGS_ZERO: FlagsBom = { grade: false, consumo: false, aviamentos: false };

export type ConfirmGrade = { msg: string; onConfirm: () => void } | null;

export function useFichaBom({ modeloId, habilitada, dados, tecidosPlanejados, proporcoes, setDraftTracked, aoRecarregarComTocado }: {
  modeloId: string | null;
  habilitada: boolean;
  dados: FichaDados;
  tecidosPlanejados: string[];
  proporcoes: Record<string, number>;
  setDraftTracked: Dispatch<SetStateAction<Draft>>;
  /** R5a — a carga chegou com o BOM local JÁ tocado: recebe o BOM do SERVIDOR (montado pelas MESMAS funções da carga). */
  aoRecarregarComTocado?: (servidor: EstadoBom) => void;
}) {
  // Sempre a versão atual do callback (o efeito da carga não o tem nas dependências).
  const aoRecarregarRef = useRef(aoRecarregarComTocado);
  aoRecarregarRef.current = aoRecarregarComTocado;
  const [blocks, setBlocks] = useState<TecidoBlock[]>(makeEmptyBlocks);
  const [aviamentosState, setAviamentosState] = useState<AviamentoRow[]>([]);
  const [etiquetasState, setEtiquetasState] = useState<ModeloEtiquetaRow[]>([]);
  const [grades, setGrades] = useState<GradeRow[]>([]);
  // Grade automática LIGADA por padrão (Dev :764-766).
  const [gradeAuto, setGradeAuto] = useState(true);
  const [hidratado, setHidratado] = useState(false);
  const [hidratarTick, setHidratarTick] = useState(0);
  // I1 (fix round 1) — incrementado a cada carga bem-sucedida; entra nas deps dos 3 efeitos de
  // recálculo de preço (ver comentário na seção de Carga abaixo).
  const [cargaSeq, setCargaSeq] = useState(0);
  // "Apagar grade preenchida?" — ação adiada até confirmar (Dev :659-661, :3221-3237).
  const [confirmGrade, setConfirmGrade] = useState<ConfirmGrade>(null);
  // Destaque do "Importar dados" (o diálogo é da F3.3; o estado já nasce aqui p/ as seções).
  const [camposCopiados, setCamposCopiados] = useState<Set<string>>(() => new Set());
  const [tocado, setTocado] = useState(false);
  const colecoesTouchadasRef = useRef(false);
  // Re-review E (fix round 2, RULING do controlador) — paridade com o Dev, que regrava o BOM a todo
  // Salvar: quando o BOM do SERVIDOR está VAZIO, a carga pré-preenche Tecido 1..N a partir de
  // `tecidos_planejados` (hidratarBlocos, ficha-calc :120-128) SEM marcar como tocado — sem isto,
  // `capturar.gravar=false` e o Salvar nunca grava o que o usuário está vendo na tela. Esta ref
  // sinaliza "há um pré-preenchimento pendente de gravação" p/ o `capturar` do useFichaTecnica somar
  // à condição de `gravar`, sem acender o "não salvo" (o usuário não tocou em nada).
  const prefillPendenteRef = useRef(false);
  const flagsRef = useRef<FlagsBom>(FLAGS_ZERO);
  const estadoRef = useRef<EstadoBom>({ blocks, aviamentos: aviamentosState, etiquetas: etiquetasState, grades });
  estadoRef.current = { blocks, aviamentos: aviamentosState, etiquetas: etiquetasState, grades };

  const marcarTocado = () => {
    if (colecoesTouchadasRef.current) return;
    colecoesTouchadasRef.current = true;
    setTocado(true);
  };
  const limparTocado = () => { colecoesTouchadasRef.current = false; setTocado(false); prefillPendenteRef.current = false; };
  const marcarFlag = (k: keyof FlagsBom) => { flagsRef.current = { ...flagsRef.current, [k]: true }; };
  const limparFlags = () => { flagsRef.current = FLAGS_ZERO; };

  // Trocar de card na MESMA instância (ex.: Dialog → Sheet do card recém-criado) zera tudo (Dev :674-690).
  useEffect(() => {
    setBlocks(makeEmptyBlocks());
    setAviamentosState([]);
    setEtiquetasState([]);
    setGrades([]);
    setHidratado(false);
    setConfirmGrade(null);
    setCamposCopiados(new Set());
    colecoesTouchadasRef.current = false;
    setTocado(false);
    prefillPendenteRef.current = false;
    flagsRef.current = FLAGS_ZERO;
    setCargaSeq(0);
  }, [modeloId]);

  // Variante → artigo dos pools (Dev :776-803): alimenta substitutos órfãos e o custo pelo maior preço.
  const relevantes = useMemo(
    () => relevantArtigoIds({
      planejados: tecidosPlanejados ?? [],
      extras: [...dados.artigosForro.map((a) => a.id), ...dados.artigosEntretela.map((a) => a.id)],
      blocks,
    }),
    [tecidosPlanejados, dados.artigosForro, dados.artigosEntretela, blocks],
  );
  const qVarianteArtigo = useQuery({
    queryKey: ["plan-ficha-variante-artigo", relevantes.join(",")],
    enabled: habilitada && relevantes.length > 0,
    // I3 (fix round 1): a key muda a cada artigo novo do bloco (`relevantes` deriva de `blocks`) e sem
    // isto a query desmonta/remonta (isLoading) a cada troca — as seções que dependem do mapa somem por
    // um instante ("Carregando…") e um Salvar nessa janela perde a edição. Mantém o mapa ANTERIOR
    // visível enquanto o novo artigo resolve (TanStack v5).
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.from("variantes_tecido").select("id, artigo_id").in("artigo_id", relevantes);
      if (error) throw error;
      const m: Record<string, string> = {};
      (data ?? []).forEach((v: any) => { if (v.artigo_id) m[v.id] = v.artigo_id; });
      return m;
    },
  });
  const varianteArtigoMap = qVarianteArtigo.data ?? MAPA_VAZIO;
  const varianteArtigoMapPronto = relevantes.length === 0 || qVarianteArtigo.isSuccess;
  const varianteArtigoMapRef = useRef(varianteArtigoMap);
  varianteArtigoMapRef.current = varianteArtigoMap;

  // ── Carga (Dev :870-957, :976-984, :1029-1038) ── só com as 5 queries prontas, ESTÁVEIS e NADA tocado.
  // `cargaSeq` (I1, fix round 1): incrementado a cada carga bem-sucedida (ramo sem toque). Entra nas
  // deps dos 3 efeitos de recálculo de preço abaixo — sem ele, do 2º card em diante o recompute só
  // dispara se a query da PRÓPRIA coleção mudou no MESMO commit da carga; se `artigoMap`/`aviamentoMap`/
  // `etiquetaMap`/`frozenPrecos` já estavam quentes no cache (2º card do mesmo catálogo), a carga hidrata
  // com `custo_previsto` CRU do banco e nenhum efeito recalcula. O Dev resolve isso fazendo hidratação e
  // recálculo dependerem da MESMA query (`ModeloDetailPanel.tsx:959-965`, `:986-999`, `:1010-1017` — o
  // próprio array de dados hidratado é a dependência); aqui a carga é 1 efeito único com 5 fontes, então
  // um contador dedicado que muda toda vez que ela roda cobre o mesmo caso.
  const planejadosKey = JSON.stringify(tecidosPlanejados ?? []);
  useEffect(() => {
    // I2 (fix round 1) — as 5 queries do BOM resolvem em commits separados; com QUALQUER uma em
    // refetch, a carga espera (mesma receita do gate do CAD no Dev, `:1047-1054`,
    // `cadRowDevFetching || tecidosDataFetching`; extraída em `deveHidratarCarga`, ficha-calc.ts,
    // p/ ser testável). Sem isto: (a) sem toque, um refetch parcial re-hidrata com o cache VELHO
    // das outras 4 — a tela volta ao estado de antes por um instante, e uma edição nessa janela faz
    // o Salvar seguinte gravar o dado velho; (b) com toque, `aoRecarregarComTocado` recebe um BOM
    // MISTO (novo+velho) e acende um conflito "Tecidos & BOM" falso.
    const { tecidosData, ocLinksData, aviamentosData, etiquetasData, gradesData } = dados;
    // F3.3 — `cadPronto`: o CAD hidrata no MESMO instante (useFichaCad segue `cargaSeq`); com a ficha tocada, o CAD
    // do servidor vai junto na comparação (`aoRecarregarComTocado` — o orquestrador lê `dados.cadData`).
    if (!deveHidratarCarga({ habilitada, bomFetching: dados.bomFetching, tecidosData, ocLinksData, aviamentosData, etiquetasData, gradesData, cadPronto: dados.cadData !== undefined })) return;
    // Narrowing local p/ o TS (deveHidratarCarga já garante isto em runtime — ela é a fonte da decisão).
    if (!tecidosData || !ocLinksData || !aviamentosData || !etiquetasData || !gradesData) return;
    // Item E (fix round 3, (b)) — o BOM do SERVIDOR chegou NÃO-vazio (alguém — ex.: outro usuário pelo Dev
    // — gravou tecidos de verdade): zera o prefill pendente ANTES dos dois ramos abaixo. Vale nos DOIS: (i)
    // ramo COM toque (R5a) — outra pessoa completou o BOM enquanto eu tinha só o prefill (BOM do servidor
    // vazio na MINHA carga) e nesse meio-tempo toquei outra coisa do BOM; sem zerar aqui, minha próxima
    // captura ainda somaria `prefillPendenteRef` a `gravar`, arriscando escrever por cima; (ii) ramo SEM
    // toque (hidrata) — o cenário do bug do topo do item E: sem isto, a carga que confirma "o BOM mudou de
    // verdade" (disparada por `bomMudouNoServidor`/refetch após o P0409) hidrataria de novo com os dados
    // NOVOS do servidor mas manteria `prefillPendenteRef=true` de antes, e o PRÓXIMO Salvar voltaria a somar
    // a pendência a `gravar` — mesmo já não fazendo sentido (o servidor não está mais vazio).
    if (tecidosData.tecidos.length > 0) prefillPendenteRef.current = false;
    // Colab: com alguma coleção tocada NÃO sobrescreve — mas COMPARA (R5a do re-check do guardião). O `aoMudarNoServidor`
    // só confere quando o rev chega com o BOM JÁ tocado; se o rev chegou com o BOM INTOCADO (ele só invalidou) e o usuário
    // tocou ANTES de o refetch chegar, é AQUI que o BOM alheio aparece — sem comparar, o Salvar passaria o `.eq("rev")`
    // (o merge já avançou o rev) e `salvar_modelo_bom(_rev_base:null)` sobrescreveria o BOM de outra pessoa sem aviso.
    // Cobre também o refetch de foco. O orquestrador compara a assinatura × referência e acende "Tecidos & BOM".
    if (colecoesTouchadasRef.current) {
      aoRecarregarRef.current?.(estadoBomDoServidor({
        tecidos: tecidosData.tecidos, variantes: tecidosData.variantes, ocLinks: ocLinksData,
        aviamentos: aviamentosData, etiquetas: etiquetasData, grades: gradesData,
        planejados: JSON.parse(planejadosKey) as string[],
      }));
      return;
    }
    const planejadosAgora = JSON.parse(planejadosKey) as string[];
    setBlocks(hidratarBlocos({ tecidos: tecidosData.tecidos, variantes: tecidosData.variantes, ocLinks: ocLinksData, planejados: planejadosAgora }));
    setAviamentosState(hidratarAviamentos(aviamentosData));
    setEtiquetasState(hidratarEtiquetas(etiquetasData));
    setGrades(hidratarGrades(gradesData));
    setHidratado(true);
    setCargaSeq((n) => n + 1);
    // Item E (fix round 2) — MESMA condição de `hidratarBlocos` (ficha-calc :123): BOM do servidor
    // vazio E há algo em `tecidos_planejados` p/ pré-preencher. Marca pendência SEM tocar (o
    // pré-preenchimento não é edição do usuário) — o `capturar` do useFichaTecnica soma isto à
    // condição de `gravar`, senão o Salvar nunca grava o Tecido 1..N que a tela está mostrando.
    if (tecidosData.tecidos.length === 0 && planejadosAgora.some((a) => !!a)) {
      prefillPendenteRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habilitada, dados.bomFetching, dados.tecidosData, dados.ocLinksData, dados.aviamentosData, dados.etiquetasData, dados.gradesData, dados.cadData, planejadosKey, hidratarTick]);

  // Preços chegam DEPOIS da carga (Dev :959-1027): recalcula SÓ custo_previsto. Guarda de mapa vazio +
  // guarda de no-op (só troca o array se algum custo mudou) — sem ciclo. `cargaSeq` nas deps (I1): garante
  // que TODA carga (inclusive quando o preço já estava em cache) dispara o recompute — ver comentário acima.
  useEffect(() => {
    if (Object.keys(dados.aviamentoMap).length === 0) return;
    setAviamentosState((rows) => {
      if (!rows.length) return rows;
      const next = rows.map((r) => recomputeAviamento(r, dados.aviamentoMap));
      return next.some((r, i) => r.custo_previsto !== rows[i].custo_previsto) ? next : rows;
    });
  }, [dados.aviamentoMap, dados.aviamentosData, cargaSeq, hidratarTick]);
  useEffect(() => {
    if (Object.keys(dados.etiquetaMap).length === 0) return;
    setEtiquetasState((rows) => {
      if (!rows.length) return rows;
      const next = rows.map((r) => recomputeEtiqueta(r, dados.etiquetaMap));
      return next.some((r, i) => r.custo_previsto !== rows[i].custo_previsto) ? next : rows;
    });
  }, [dados.etiquetaMap, dados.etiquetasData, cargaSeq, hidratarTick]);
  useEffect(() => {
    if (Object.keys(dados.artigoMap).length === 0) return;
    setBlocks((bs) => {
      if (!bs.length) return bs;
      // Custo congelado pela OC vinculada (Fase B): recomputeBlock usa `frozenPrecos["tipo|numero"]`.
      const next = bs.map((b) => recomputeBlock(b, dados.artigoMap, varianteArtigoMap, dados.frozenPrecos));
      return next.some((b, i) => b.custo_previsto !== bs[i].custo_previsto) ? next : bs;
    });
  }, [dados.artigoMap, varianteArtigoMap, dados.frozenPrecos, dados.tecidosData, cargaSeq, hidratarTick]);

  // Herança de grade (Dev :1441-1468): variante nova do Tecido 1 herda a grade da 1ª. Monotônica.
  const tecido1VarianteIds = useMemo(() => calcTecido1VarianteIds(blocks), [blocks]);
  useEffect(() => {
    if (!hidratado || tecido1VarianteIds.length === 0) return;
    setGrades((prev) => herdarGrades(prev, tecido1VarianteIds.length));
  }, [tecido1VarianteIds, hidratado, grades]);

  const tamanhos = dados.tamanhos;
  const frozen = dados.frozenPrecos;

  // ── Handlers (Dev :2435-2652) ──
  const updateBlock = (idx: number, patch: Partial<TecidoBlock>) => {
    marcarTocado();
    // Só consumo/%loss mudam a metragem (#Erro); trocar artigo/substituto não.
    if (patch.consumo !== undefined || patch.loss_percent !== undefined) marcarFlag("consumo");
    // (Dev :2441-2456 — propagação BOM→CAD — entra na F3.3 junto com o CAD.)
    const target = blocks[idx];
    const isTecido1 = target?.tipo === "tecido" && target?.numero === 1;
    const applyPatch = () => {
      setBlocks((bs) => bs.map((b, i) => {
        if (i !== idx) return b;
        let merged = { ...b, ...patch };
        // Substituto removido: descarta variantes que pertenciam a ele (ficariam órfãs fora do pool).
        if (patch.artigoIdsExtra !== undefined) {
          const pool = new Set<string>([merged.artigo_id, ...merged.artigoIdsExtra].filter(Boolean) as string[]);
          const variantes = merged.variantes.map((v) => (v && varianteArtigoMap[v] && !pool.has(varianteArtigoMap[v]) ? null : v));
          merged = { ...merged, variantes };
        }
        return recomputeBlock(merged, dados.artigoMap, varianteArtigoMap, frozen);
      }));
    };
    // Trocar o artigo do Tecido 1 zera as variantes; a grade é indexada por elas → confirma e limpa.
    if (isTecido1 && patch.artigo_id !== undefined && patch.artigo_id !== target.artigo_id) {
      const hasGrade = grades.some((g) => g.grade_total > 0 || Object.values(g.grades || {}).some((v) => (v ?? 0) > 0));
      if (hasGrade) {
        setConfirmGrade({
          msg: "Trocar o Tecido 1 vai apagar a grade preenchida. Continuar?",
          // m2 (fix round 1): reforça o tocado no próprio onConfirm — a confirmação roda depois,
          // desacoplada do clique que abriu o diálogo; não confia só no marcarTocado() do topo do handler.
          onConfirm: () => { marcarTocado(); setGrades([]); marcarFlag("grade"); applyPatch(); },
        });
        return;
      }
      setGrades([]);
    }
    applyPatch();
  };

  const updateBlockVariante = (idx: number, vIdx: number, value: string | null) => {
    marcarTocado();
    marcarFlag("consumo");
    const target = blocks[idx];
    const isTecido1 = target?.tipo === "tecido" && target?.numero === 1;
    const applyChange = () => {
      setBlocks((bs) => bs.map((b, i) => {
        if (i !== idx) return b;
        if (!value) {
          // Remove SÓ a variante alvo e desloca as seguintes (sem cascata).
          return recomputeBlock(removerVarianteDoBloco(b, vIdx), dados.artigoMap, varianteArtigoMap, frozen);
        }
        const variantes = [...b.variantes];
        const oc_links = (b.oc_links ?? []).map((a) => [...(a ?? [])]);
        while (oc_links.length < 10) oc_links.push([]);
        const complementas: (string[] | null)[] = [...(b.complementas ?? [])];
        while (complementas.length < 10) complementas.push(null);
        const prev = variantes[vIdx];
        variantes[vIdx] = value;
        // Trocou de variante: OC e casamento eram da ANTIGA — zera os dois.
        if (prev !== value) { oc_links[vIdx] = []; complementas[vIdx] = null; }
        return recomputeBlock({ ...b, variantes, oc_links, complementas }, dados.artigoMap, varianteArtigoMap, frozen);
      }));
    };
    if (isTecido1 && !value) {
      // Remover variante do Tecido 1 renumera as cores: a grade SEGUE a variante (v3 vira v2).
      const numeroRemovido = vIdx + 1;
      const remapEAplicar = () => {
        // m2 (fix round 1): reforça o tocado — mesmo motivo do updateBlock acima.
        marcarTocado();
        setGrades((gs) => remapGradesAposRemocao(gs, numeroRemovido));
        marcarFlag("grade");
        applyChange();
      };
      const alvo = grades.find((g) => g.variante_numero === numeroRemovido);
      const alvoTemGrade = !!alvo && (alvo.grade_total > 0 || Object.values(alvo.grades || {}).some((v) => (v ?? 0) > 0));
      if (alvoTemGrade) {
        setConfirmGrade({
          msg: `A Variante ${numeroRemovido} possui grade preenchida. Remover mesmo assim? As variantes seguintes mantêm suas grades (renumeradas).`,
          onConfirm: remapEAplicar,
        });
        return;
      }
      remapEAplicar();
      return;
    }
    applyChange();
  };

  const updateBlockOcLinks = (idx: number, vIdx: number, allocs: OcAlloc[]) => {
    marcarTocado();
    setBlocks((bs) => bs.map((b, i) => {
      if (i !== idx) return b;
      const oc_links = (b.oc_links ?? []).map((a) => [...(a ?? [])]);
      while (oc_links.length < 10) oc_links.push([]);
      oc_links[vIdx] = allocs;
      return { ...b, oc_links };
    }));
  };

  const updateAviamento = (idx: number, patch: Partial<AviamentoRow>) => {
    marcarTocado();
    marcarFlag("aviamentos");
    setAviamentosState((rows) => rows.map((r, i) => (i === idx ? recomputeAviamento({ ...r, ...patch }, dados.aviamentoMap) : r)));
  };
  const addAviamento = () => {
    marcarTocado();
    marcarFlag("aviamentos");
    if (aviamentosState.length >= 20) return;
    setAviamentosState((rows) => [...rows, { aviamento_id: null, variante_aviamento_id: null, consumo: 0, loss_percent: 0, custo_previsto: 0 }]);
  };
  const removeAviamento = (idx: number) => {
    marcarTocado();
    marcarFlag("aviamentos");
    setAviamentosState((rows) => rows.filter((_, i) => i !== idx));
  };

  const updateEtiqueta = (idx: number, patch: Partial<ModeloEtiquetaRow>) => {
    marcarTocado();
    setEtiquetasState((rows) => rows.map((r, i) => (i === idx ? recomputeEtiqueta({ ...r, ...patch }, dados.etiquetaMap) : r)));
  };
  const addEtiqueta = () => {
    marcarTocado();
    if (etiquetasState.length >= 20) return;
    setEtiquetasState((rows) => [...rows, { etiqueta_id: null, cor_id: null, consumo: 0, loss_percent: 0, custo_previsto: 0 }]);
  };
  const removeEtiqueta = (idx: number) => {
    marcarTocado();
    setEtiquetasState((rows) => rows.filter((_, i) => i !== idx));
  };

  const updateGradeTotal = (n: number, total: number) => {
    marcarTocado();
    marcarFlag("grade");
    setGrades((gs) => {
      const cur = gs.find((g) => g.variante_numero === n) ?? { variante_numero: n, grades: {}, grade_total: 0 };
      const next = { ...cur.grades, ...distribuiTotal(total, tamanhos, proporcoes ?? {}) };
      const others = gs.filter((g) => g.variante_numero !== n);
      return [...others, { variante_numero: n, grades: next, grade_total: total }].sort((a, b) => a.variante_numero - b.variante_numero);
    });
  };
  const updateGradeCell = (n: number, tam: string, qty: number) => {
    marcarTocado();
    marcarFlag("grade");
    setGrades((gs) => {
      const cur = gs.find((g) => g.variante_numero === n) ?? { variante_numero: n, grades: {}, grade_total: 0 };
      const props = proporcoes ?? {};
      const propTam = Number(props[tam]) || 0;
      // Auto: a célula digitada vira ÂNCORA e distribui pela proporção; senão só grava a célula.
      const next = gradeAuto && qty > 0 && propTam > 0 ? distribuiAncora(qty, tam, tamanhos, props) : { ...cur.grades, [tam]: qty };
      const realTotal = tamanhos.reduce((s, t) => s + (Number(next[t]) || 0), 0);
      const others = gs.filter((g) => g.variante_numero !== n);
      return [...others, { variante_numero: n, grades: next, grade_total: realTotal }].sort((a, b) => a.variante_numero - b.variante_numero);
    });
  };
  const updateProporcao = (tam: string, val: number) => {
    marcarFlag("grade");
    const oldProp = proporcoes ?? {};
    const newProp = { ...oldProp, [tam]: Math.max(0, val) };
    // Proporções são coluna de `modelos` (Draft) — o "não salvo"/merge do draft cobrem.
    setDraftTracked((d) => ({ ...d, proporcoes: newProp }));
    if (gradeAuto) {
      marcarTocado();
      const oldSum = tamanhos.reduce((s, t) => s + (Number(oldProp[t]) || 0), 0);
      if (oldSum > 0) {
        setGrades((gs) => gs.map((g) => {
          const total = g.grade_total || 0;
          if (total <= 0) return g;
          const next = redistribuiPorEscala(total / oldSum, tamanhos, newProp);
          return { ...g, grades: next, grade_total: somaGrade(next) };
        }));
      }
    }
  };
  const toggleGradeAuto = (v: boolean) => {
    setGradeAuto(v);
    if (!v) return;
    const props = proporcoes ?? {};
    const sum = tamanhos.reduce((s, t) => s + (Number(props[t]) || 0), 0);
    if (sum <= 0) return;
    marcarTocado();
    marcarFlag("grade");
    setGrades((gs) => gs.map((g) => {
      const total = g.grade_total || 0;
      if (total <= 0) return g;
      return { ...g, grades: distribuiTotal(total, tamanhos, props), grade_total: total };
    }));
  };

  const onCampoEditado = (chave: string) => setCamposCopiados((prev) => {
    if (!prev.has(chave)) return prev;
    const n = new Set(prev); n.delete(chave); return n;
  });
  const marcarCopiados = (campos: Set<string>) => setCamposCopiados((prev) => new Set([...prev, ...campos]));
  const limparCopiados = () => setCamposCopiados(new Set());

  /** "Descartar e recarregar" do conflito de seção: solta o tocado e força reaplicar o que está no cache. */
  const descartarEdicoes = () => {
    limparTocado();
    limparFlags();
    limparCopiados();
    setConfirmGrade(null);
    setHidratarTick((n) => n + 1);
  };

  return {
    blocks, aviamentosState, etiquetasState, grades, gradeAuto, hidratado, tocado,
    colecoesTouchadasRef, estadoRef, flagsRef, prefillPendenteRef,
    varianteArtigoMap, varianteArtigoMapRef, varianteArtigoMapPronto, tecido1VarianteIds,
    confirmGrade, setConfirmGrade,
    camposCopiados, onCampoEditado, marcarCopiados, limparCopiados,
    limparTocado, limparFlags, descartarEdicoes,
    // F3.3 — o CAD (useFichaCad) hidrata junto com esta carga (`cargaSeq`) e marca o MESMO "tocado".
    marcarTocado, cargaSeq,
    handlers: {
      updateBlock, updateBlockVariante, updateBlockOcLinks,
      updateAviamento, addAviamento, removeAviamento,
      updateEtiqueta, addEtiqueta, removeEtiqueta,
      updateGradeTotal, updateGradeCell, updateProporcao, toggleGradeAuto,
    },
  };
}
