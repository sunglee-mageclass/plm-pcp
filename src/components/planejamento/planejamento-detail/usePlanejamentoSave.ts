// Salvar do detalhe do Planejamento (header `modelos` com rev otimista + grade de revenda + MO por
// serviço + auto-criação do Produto Acabado) e o retry/merge do P0409. Extraído na F3.0 (set/2026) de
// `PlanejamentoDetail.tsx` SEM mudança de comportamento: o corpo abaixo é o texto MOVIDO como estava
// (mesmas chamadas, mesma ordem, mesmas queryKeys). Refs e estados continuam sendo do orquestrador e
// chegam por argumento com os MESMOS nomes (refs como OBJETO — o retry lê `.current` na hora). A F3.2
// reescreve aqui a cadeia de gravação (UPDATE → salvar_modelo_bom → etiquetas → MO → marcar_revisao).
import { useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useMutation, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { type Conflito } from "@/lib/colab/merge";
import { moLinhasEqual } from "@/lib/mao-obra";
import { type MaoObraEditorLinha } from "@/components/planejamento/MaoObraEditor";
import { numOr0, draftFromModeloRow, type CatOpt, type Draft } from "@/components/planejamento/modelo-shared";
import { ehOrigemComprada } from "@/lib/origem";
import { limparCustoSim, aplicarRegrasCamposDev, textoOuNull, draftParaSalvar, normalizarDraftSalvo, CAMPOS_DEV_DRAFT } from "@/components/planejamento/planejamento-detail/helpers";
import { STAGE_LABEL } from "@/components/desenvolvimento/DownstreamImpactAlert";
import { gravarTecidosIniciais, persistirBom } from "@/components/planejamento/planejamento-detail/ficha/persistir-bom";
import { chavesBomServidor } from "@/components/planejamento/planejamento-detail/ficha/useFichaDados";
import { pecaCom, type BomCapturado } from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";
import type { FichaSave } from "@/components/planejamento/planejamento-detail/ficha/useFichaTecnica";
import {
  aplicarColunasFicha, prepararRetryP0409, tocadosAposSalvar, draftEnviadoEfetivo, draftEnviadoComColunasDev,
  retryBloqueadoPorEnvio, bomRecarregando, deveBarrarPorBomRecarregando,
} from "@/components/planejamento/planejamento-detail/save-ficha";

export type UsePlanejamentoSaveArgs = {
  modeloId: string | null;
  isEdit: boolean;
  isRevenda: boolean;
  paOn: boolean;
  podeEditarPreco: boolean;
  podeVerCustos: boolean;
  /** F3.1: pode editar o Desenvolvimento? Sem isso os campos do Dev saem do payload (decisão F3 #8). */
  podeEditarDev: boolean;
  /** F3.1: o campo REF está editável na seção "Desenvolvimento"? Só então a REF vai no payload. */
  refEditavel: boolean;
  categorias: CatOpt[];
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  draftLiveRef: RefObject<Draft>;
  touchedRef: RefObject<Set<string>>;
  baseRef: RefObject<{ draft: Draft } | null>;
  revRef: RefObject<number | null>;
  retryRef: RefObject<boolean>;
  savingRef: RefObject<boolean>;
  conflitosRef: RefObject<Conflito[]>;
  setConflitos: Dispatch<SetStateAction<Conflito[]>>;
  setUltimoMerge: Dispatch<SetStateAction<{ atualizados: number; conflitos: Conflito[] } | null>>;
  setEnviada: Dispatch<SetStateAction<boolean>>;
  setLancado: Dispatch<SetStateAction<boolean>>;
  moLinhasRef: RefObject<MaoObraEditorLinha[]>;
  moBaseRef: RefObject<MaoObraEditorLinha[]>;
  setMoLinhasBase: Dispatch<SetStateAction<MaoObraEditorLinha[]>>;
  gradeRevenda: Record<number, Record<string, number>>;
  setGradeRevenda: Dispatch<SetStateAction<Record<number, Record<string, number>>>>;
  gradeRevendaDirty: boolean;
  gradeRevendaBaseRef: RefObject<string>;
  gradeRevendaRevRef: RefObject<number | null>;
  buildLinhasGradeRevenda: () => { variante_numero: number; grades: Record<string, number>; grade_total: number }[];
  qc: QueryClient;
  onSaved: () => void;
  /** F3.1 — card NOVO: chamado com o id depois do INSERT (o `PlanejamentoDetail` remonta como Sheet dele). */
  onCreated?: (id: string) => void;
  /** F3.2 — API de gravação do BOM (inerte quando a ficha está desligada: card novo, comprado, sem permissão). */
  ficha: FichaSave;
  /** F3.2 — re-baseia o "não salvo" do draft no valor ENVIADO (fix do save-em-voo, receita 2419d0f). */
  resetDraftBaseline: (next?: Draft) => void;
};

export function usePlanejamentoSave({
  modeloId, isEdit, isRevenda, paOn, podeEditarPreco, podeVerCustos, podeEditarDev, refEditavel, categorias,
  draft, setDraft, draftLiveRef,
  touchedRef, baseRef, revRef, retryRef, savingRef, conflitosRef, setConflitos, setUltimoMerge,
  setEnviada, setLancado,
  moLinhasRef, moBaseRef, setMoLinhasBase,
  gradeRevenda, setGradeRevenda, gradeRevendaDirty, gradeRevendaBaseRef, gradeRevendaRevRef, buildLinhasGradeRevenda,
  qc, onSaved, onCreated, ficha, resetDraftBaseline,
}: UsePlanejamentoSaveArgs) {
  // F3.1 — card NOVO: id do INSERT já feito neste detalhe. Um 2º Salvar (ou o retry depois de um erro nas
  // gravações seguintes) NUNCA insere de novo; o detalhe vira o Sheet desse id (`onCreated`).
  const criadoIdRef = useRef<string | null>(null);
  // F3.2 — espelho SÍNCRONO do argumento `ficha` (nota do controlador, revisão T7): `FichaSave` é recriado a
  // cada render de `PlanejamentoDetail`. O `mutationFn`/`onError` do retry do P0409 rodam fora do ciclo normal
  // de render (dentro de um `onError` que já correu um `await`) e fechariam sobre uma versão VELHA de `ficha`
  // (mesma classe de bug que `draftLiveRef` resolve pro draft) — por isso todo acesso interno usa `fichaRef.current`.
  const fichaRef = useRef(ficha);
  fichaRef.current = ficha;
  // F3.2 — o que ESTE save enviou (draft + MO + BOM), congelado no início do mutationFn. O onSuccess re-baseia
  // NISTO, nunca no estado ao vivo: tecla digitada durante o voo segue "não salva" (receita 2419d0f do Dev).
  // Item C (fix round 3) — `enviadoCadNaCaptura`/`podeGravarColunasDevNaCaptura`: o valor REAL de
  // `modelos.enviado_cad` (lido do cache já populado pelo orquestrador, sem query nova) e a permissão de
  // gravar colunas do Dev, ambos no INSTANTE da captura (antes de qualquer `await` — vale também no retry,
  // que reentra no `mutationFn` do zero). Usados por `retryBloqueadoPorEnvio` no onError do P0409.
  // Fix round 4 (item 10, acréscimo do controlador) — `temCamposDevNoPayloadNaCaptura`: "esta captura ia
  // gravar algo do Dev" precisa cobrir também os CAMPOS SIMPLES do Dev da F3.1 (modelista, pilotos, datas,
  // obs. técnicas — `CAMPOS_DEV_DRAFT`, helpers.ts), não só o BOM/colunas derivadas. Eles entram no payload
  // via `aplicarRegrasCamposDev` (só com `podeEditarDev`) — capturado do PRÓPRIO `payload` já montado, no
  // mesmo instante síncrono, sem lista paralela.
  const enviadoRef = useRef<{
    draft: Draft; moLinhas: MaoObraEditorLinha[]; bom: BomCapturado;
    enviadoCadNaCaptura: boolean; podeGravarColunasDevNaCaptura: boolean; temCamposDevNoPayloadNaCaptura: boolean;
  } | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      // Item G (T11, I1; CONTADOR — fix round 3) — marca "save em voo" já no início (inclusive no retry do
      // P0409, que chama `mutationFn` de novo): enquanto em voo (contador > 0 — ver useFichaTecnica.ts), o
      // eco do UPDATE do header (bump de `rev`) do PRÓPRIO save não confere/acende "Tecidos & BOM" contra o
      // BOM tocado. `onSettled` (nível da mutation, abaixo) desmarca (−1) ao fim de QUALQUER ciclo (sucesso
      // ou erro) — inclusive o ciclo intermediário que termina em P0409 ANTES do retry, que remarca (+1) de
      // novo ao reentrar aqui. Com CONTADOR (não mais um booleano): no TanStack Query 5.x, o `mutationFn` do
      // retry roda ANTES do `onSettled` do 1º ciclo, então a sequência real é +1 (1ª tentativa) → +1 (retry,
      // reentra aqui ANTES do onSettled de baixo rodar) → −1 (onSettled do 1º ciclo, sobra 1 — ainda em voo,
      // o retry segue protegido) → −1 (onSettled do retry, chega a 0). Um booleano simples zerava no meio do
      // retry (o `onSettled` do 1º ciclo desligava a flag enquanto o retry ainda rodava `persistirBom`/MO).
      fichaRef.current.marcarSaveEmVoo(true);
      // Colab (Task 2): com conflitos pendentes na tela, o save NÃO pode passar — mesmo que
      // o rev já bata, o usuário precisa resolver ("manter meu"/"usar o novo") primeiro. Mesmo
      // guard do piloto OC Tecido/Desenvolvimento (sem isto, um 2º clique sobrescreveria a
      // versão da outra pessoa em silêncio). F3.2: soma o conflito de SEÇÃO "Tecidos & BOM".
      if (conflitosRef.current.length > 0 || fichaRef.current.conflitoBomRef.current)
        throw new Error("Resolva os conflitos listados no aviso no topo antes de salvar.");
      // R5 — rev novo com o BOM tocado: a ficha está conferindo se o BOM do SERVIDOR mudou. Salvar agora poderia passar
      // o `.eq("rev")` e sobrescrever um BOM alheio ainda não detectado.
      // Item F (fix round 2): a mensagem original ("Conferindo se outra pessoa mudou o BOM deste card — salve
      // de novo em instantes.") não tinha acento nem palavra da lista `PARECE_PT` (erro-mensagem.ts) — o
      // `mensagemErro` a trocava pelo fallback genérico "Erro". Reescrita em PT com acento.
      if (fichaRef.current.verificandoBomRef.current)
        throw new Error("O BOM ainda está sendo conferido com o servidor — aguarde um instante e salve de novo.");
      // Fix final I1 (IMPORTANTE) — o prefill sobrescreve o BOM de outra pessoa sem P0409 (ver save-ficha.ts,
      // `bomRecarregando`): o ramo SEM toque do `aoMudarNoServidor` invalida as 5 queries do BOM mas não
      // espera o refetch chegar — um Salvar disparado nessa janela passaria o `.eq("rev")` (já atualizado
      // pelo merge) com `capturar().gravar=true` (prefill pendente) e gravaria o esqueleto Tecido 1..N por
      // cima do BOM que outra pessoa completou nesse meio-tempo. Mesma mensagem PT do guard acima (já passa
      // no `mensagemErro`) — as queries só rodam quando a ficha está habilitada (`enabled`), então checar as
      // keys sozinho já cobre "habilitada e em refetch" sem precisar de um sinal extra.
      // Fix final ROUND 2, item 2 — o guard barrava TAMBÉM um Salvar que nunca gravaria o BOM (refetch de
      // foco/abertura do card) e transformava em `toast.error` o retry do P0409 que devia retentar. Agora só
      // barra quando ESTE save IA GRAVAR o BOM (`bomPendenteDeGravar()` — mesma condição de `capturar().gravar`)
      // E as queries do BOM estão em refetch (`deveBarrarPorBomRecarregando`, save-ficha.ts).
      if (
        modeloId
        && deveBarrarPorBomRecarregando(
          fichaRef.current.bomPendenteDeGravar(),
          bomRecarregando(chavesBomServidor(modeloId).map((k) => qc.isFetching({ queryKey: k }))),
        )
      )
        throw new Error("O BOM ainda está sendo conferido com o servidor — aguarde um instante e salve de novo.");
      // Fonte do payload = o ESPELHO ao vivo do draft (bug-fix, receita do Dev — ver
      // `draftParaSalvar` em helpers.ts para o porquê e o teste da semântica). A F3.2 usa este MESMO `d`
      // (rascunho vivo) pra capturar o BOM/MO — não reimplementa o fix do retry (ruling do controlador).
      const d = draftParaSalvar(draftLiveRef.current, draft);
      const bom = fichaRef.current.capturar(d.custos_adicionais);
      // Colunas DERIVADAS do BOM: na 1ª tentativa sempre; no retry do P0409 só quando ESTE save grava o BOM (os derivados
      // saem do MESMO BOM gravado — R5). Retry sem gravar o BOM: o BOM local (não tocado) pode estar velho.
      const incluirDerivados = !retryRef.current || bom.gravar;
      const moLinhasEnviadas = moLinhasRef.current;
      // Item C (fix round 3, (a)) — `enviado_cad` REAL lido do cache da query `["modelo", modeloId]` (a
      // MESMA que o PD já mantém populada — `PlanejamentoDetail.tsx:145-152`, `select("*")`), não da trava
      // DERIVADA (`motivoSomenteLeitura`/`travaDev`), que colapsa "permissao"/"cad"/"enviado" e perde se o
      // card JÁ estava enviado quando "permissao" tem precedência ou o usuário está em "Editar". Sem query
      // nova: `qc` já é o QueryClient do orquestrador, e a key já é lida do mesmo jeito no retry (linha ~551
      // abaixo, `getQueryData<any>(["modelo", modeloId])`).
      const enviadoCadNaCaptura = !!qc.getQueryData<any>(["modelo", modeloId])?.enviado_cad;
      const podeGravarColunasDevNaCaptura = fichaRef.current.podeGravarColunasDev;
      // F3.1: os campos vindos do Dev e a REF passam por `aplicarRegrasCamposDev` (helpers.ts): vazios → NULL,
      // sem permissão do Dev → saem do payload, REF só quando editável (senão sai, como antes — a REF é do
      // trigger fn_modelo_ref_auto, invariante #11). A etapa (`status_desenvolvimento`) não está no Draft.
      const payload: any = aplicarRegrasCamposDev({
        ...d,
        croqui_url: d.croqui_url || null,
        desenho_tecnico_url: d.desenho_tecnico_url || null,
        data_lancamento: d.data_lancamento || null,
        observacoes_mao_obra: d.observacoes_mao_obra || null,
        custo_simulado: limparCustoSim(d.custo_simulado),
        // Campo NOVO (F3.1): vazio/só-espaço vira NULL.
        descricao_produto: textoOuNull(d.descricao_produto),
      }, d, { podeEditarDev, refEditavel });
      // Fix round 4 (item 10, acréscimo do controlador) — "esta captura ia gravar algo do Dev" também cobre os
      // CAMPOS SIMPLES do Dev da F3.1 (modelista, pilotos, datas, obs. técnicas…), que vão no payload por
      // `podeEditarDev` via `aplicarRegrasCamposDev` acima — não só o BOM/colunas derivadas. Lê o PRÓPRIO
      // `payload` já montado contra a lista ÚNICA `CAMPOS_DEV_DRAFT` (helpers.ts), sem lista paralela:
      // `aplicarRegrasCamposDev` já fez o `delete` de cada chave sem `podeEditarDev`, então `in` reflete
      // exatamente o que vai (ou não) ao servidor nesta captura.
      const temCamposDevNoPayloadNaCaptura = CAMPOS_DEV_DRAFT.some((k) => k in payload);
      enviadoRef.current = { draft: d, moLinhas: moLinhasEnviadas, bom, enviadoCadNaCaptura, podeGravarColunasDevNaCaptura, temCamposDevNoPayloadNaCaptura };
      // Item 3 do refino (ago/2026): pra revenda, preco_venda/preco_atacado viraram
      // DERIVADOS (markup × custo) — recomputados e persistidos pelo servidor a cada save de
      // markup/OC (`_pa_recomputar_precos_modelo`), nunca mais digitados aqui. NÃO reenviar
      // esses 2 campos no payload deste save: `draft.preco_venda`/`preco_atacado` (herdados
      // do `...draft` acima, spread do que foi carregado ao abrir o card) podem já estar
      // DESATUALIZADOS em relação ao que o servidor recomputou depois — um Salvar disparado
      // por outro campo (ex.: nome) sobrescreveria silenciosamente o preço fresco com o valor
      // velho. MANUFATURADOS seguem mandando o valor digitado, como sempre.
      if (isRevenda) {
        delete payload.preco_venda;
        delete payload.preco_atacado;
      } else {
        // Preço de venda só entra no payload de quem PODE editá-lo (permissão à parte
        // `criacao_planejamento:preco_venda`). Sem ela, o input é read-only e um Salvar disparado
        // por OUTRO campo não deve reenviar o valor herdado do `...draft` (o trigger
        // fn_modelo_preco_venda_gate barraria com 42501, quebrando o save inteiro).
        if (podeEditarPreco) {
          payload.preco_venda = numOr0(d.preco_venda) > 0 ? numOr0(d.preco_venda) : null;
        } else {
          delete payload.preco_venda;
        }
        payload.preco_atacado = numOr0(d.preco_atacado) > 0 ? numOr0(d.preco_atacado) : null;
      }
      // F3.2 — colunas do Desenvolvimento no UPDATE: proporções/custos adicionais (só com permissão), custos
      // derivados do BOM e `tecidos_planejados` DERIVADO (só quando o BOM grava). Regras: save-ficha.ts.
      const moServidor = moBaseRef.current.reduce((s, l) => s + (Number(l.valor) || 0), 0);
      aplicarColunasFicha(payload, {
        isEdit,
        podeGravarColunasDev: fichaRef.current.podeGravarColunasDev,
        incluirDerivados,
        podeVerCustos: fichaRef.current.podeVerCustos,
        totais: bom.totais,
        maoObraServidor: moServidor,
        gravaBom: bom.gravar,
        tecidosPlanejados: bom.tecidosPlanejados,
      });
      let savedId: string | null = isEdit ? modeloId : null;
      if (isEdit && modeloId) {
        // Grade cor×tamanho (revenda, fast-follow — fecha o last-write-wins do antigo
        // delete+insert cru): grava ANTES do UPDATE do header, com `_rev_base` PRÓPRIO
        // (`gradeRevendaRevRef`, independente de `revRef`) via RPC `salvar_grade_revenda`
        // (rev-check no molde do `salvar_modelo_bom` + delete+insert atômico no servidor).
        // Tem que rodar ANTES do header: a escrita em `modelo_grades` já bumpa `modelos.rev`
        // sozinha (trigger `trg_colab_bump`, infra 2026-08-03) — se corresse DEPOIS do UPDATE
        // do header, o bump do PRÓPRIO header já teria avançado o rev e a checagem da grade
        // daria P0409 falso em TODO save. Conflito de grade é tratado por RECARGA (sem merge,
        // `gradeConflict` marcado no erro, tratado à parte no onError) — não pelo retry do
        // header abaixo, que só sabe mesclar campos escalares do draft e nunca soube de
        // `gradeRevenda`; se caísse nesse retry, reenviaria a grade PARADA sem detectar que
        // ficou desatualizada.
        let revParaHeader = revRef.current;
        if (isRevenda && gradeRevendaDirty) {
          const { error: gradeErr } = await supabase.rpc("salvar_grade_revenda" as any, {
            _modelo_id: modeloId,
            _grades: buildLinhasGradeRevenda(),
            _rev_base: gradeRevendaRevRef.current,
          });
          if (gradeErr) {
            if ((gradeErr as any).code === "P0409") (gradeErr as any).gradeConflict = true;
            throw gradeErr;
          }
          // A grade já gravou (e já bumpou modelos.rev sozinha) — recarrega o rev atual antes
          // do UPDATE do header logo abaixo, senão ele veria o PRÓPRIO bump da grade como
          // conflito (ver comentário acima).
          const { data: revRow, error: revErr } = await (supabase.from("modelos") as any)
            .select("rev").eq("id", modeloId).single();
          if (revErr) throw revErr;
          revParaHeader = (revRow as any).rev;
          // A grade gravada é agora a verdade do servidor — zera o "não salvo" dela já aqui
          // (não só no onSuccess do save inteiro): se o UPDATE do header logo abaixo falhar
          // (P0409 do header, causa separada), um retry automático não pode tentar regravar a
          // MESMA grade com um `_rev_base` velho.
          gradeRevendaRevRef.current = revParaHeader;
          gradeRevendaBaseRef.current = JSON.stringify(gradeRevenda);
        }
        // Colab (Task 2) — contrato desta tela (spec 2026-08-03): UPDATE DIRETO com
        // `.eq("rev", revParaHeader)` — só casa a linha se ninguém salvou desde a última
        // carga; 0 linhas devolvidas = conflito (mesma UX do P0409 do piloto: merge síncrono +
        // retry 1×). `persistirBom` roda DEPOIS (RPC `salvar_modelo_bom` + diff de etiquetas — F3.2,
        // substitui o antigo sync de `modelo_tecidos`) — não precisa de trava própria: o
        // UPDATE acima já bumpou `modelos.rev` (trigger), protegendo a sequência (mesma janela
        // estreita aceita/documentada na adoção do Desenvolvimento). `as any` no builder: o
        // types.ts ainda não tem a coluna `rev` (regen pendente — ver CLAUDE.md).
        const { data: updRows, error } = await (supabase.from("modelos") as any)
          .update(payload).eq("id", modeloId).eq("rev", revParaHeader).select("id");
        if (error) throw error;
        if (!updRows || updRows.length === 0) {
          const conflito: any = new Error("conflito_versao: o registro foi salvo por outra pessoa");
          conflito.code = "P0409";
          throw conflito;
        }
        // F3.2 — BOM (substitui o sync do antigo "Tecido Planejado"): só grava quando CARREGADO E SUJO.
        // `_rev_base: null` — a trava já validou no UPDATE acima (desenho do Dev, ModeloDetailPanel.tsx:1950-1959).
        if (bom.gravar) {
          await persistirBom(modeloId, bom);
          // Fix T10 m1 — a referência do BOM vira o ENVIADO AGORA, logo após o servidor confirmar o
          // `persistirBom` — não espera o `aposSalvar` do onSuccess (que pode nunca rodar se etiqueta/MO/
          // custo_peca falharem DEPOIS deste ponto). `aposSalvar` chama de novo no sucesso completo, mas é
          // idempotente (mesma assinatura).
          fichaRef.current.bomGravado(bom);
        }
      } else {
        // Card novo: sem concorrência possível (linha ainda não existe) — insert direto, UMA vez só (F3.1).
        if (criadoIdRef.current) {
          savedId = criadoIdRef.current;
        } else {
          const { data: inserted, error } = await supabase.from("modelos").insert(payload).select("id").single();
          if (error) throw error;
          savedId = inserted?.id ?? null;
          criadoIdRef.current = savedId;
          // F3.2 / G-mockup R3 — o seletor "Tecidos" do Dialog grava o BOM como Tecido 1..N (só o artigo) logo após
          // o INSERT REAL. DENTRO do `else` (R1 do G-plano conjunto): só com o id que ESTE insert criou — BOM vazio,
          // salvar_modelo_bom não apaga nada. No caminho do `criadoIdRef` já preenchido (2º clique/retry) NÃO regrava.
          // Fix T10 I2 — marca a etapa que falhou (mesmo padrão de "grade"/"mo" abaixo): o card JÁ foi criado
          // (INSERT acima teve sucesso) mesmo que este passo falhe; o onError usa `etapaFalha` pra avisar
          // especificamente que os tecidos não foram para a Ficha (BOM), não que o card inteiro falhou.
          // Item I (T11, m3) — card comprado (revenda/importado) nunca tem a seção "Tecidos" no Dialog
          // (`PlanejamentoDetail.tsx`, `!isEdit && !isComprado`) e não usa o BOM manufaturado (F3.2, decisão
          // F3 #4) — gravar aqui criaria um Tecido 1..N fantasma que a Ficha do comprado nunca mostra/edita.
          if (savedId && !ehOrigemComprada(d.origem)) {
            try {
              await gravarTecidosIniciais(savedId, d.tecidos_planejados);
            } catch (eT) {
              (eT as any).etapaFalha = "tecidos";
              throw eT;
            }
          }
        }
        // Grade cor×tamanho: hoje inatingível na criação (só aparece depois de o Produto
        // Acabado vinculado existir, o que exige o modelo já salvo) — mantido por
        // uniformidade/robustez futura, mesma RPC. Linha nova = sem concorrência possível,
        // `_rev_base: null` (bypass), igual ao resto do fluxo de criação acima.
        if (isRevenda && savedId && gradeRevendaDirty) {
          const { error: gradeErr } = await supabase.rpc("salvar_grade_revenda" as any, {
            _modelo_id: savedId,
            _grades: buildLinhasGradeRevenda(),
            _rev_base: null,
          });
          // Ajuste (set/2026): marca a etapa que falhou — o onError do card NOVO usa isto pra
          // avisar especificamente que a grade/tecido não foi salvo (o card em si já foi criado).
          if (gradeErr) { (gradeErr as any).etapaFalha = "grade"; throw gradeErr; }
        }
      }
      // MO por serviço (spec 2026-08-06): persiste os VALORES das linhas (estado COMPLETO;
      // aprovação já foi imediata via RPC própria, não entra aqui). Só quando o rascunho de MO
      // divergiu do baseline — assim um Salvar disparado ANTES de `moResumo` semear não manda
      // um estado vazio que apagaria as linhas existentes no servidor. `moLinhasRef` = leitura
      // síncrona (nenhuma edição feita durante o `await` acima se perde). Gated por
      // `podeVerCustos`: quem não vê custos tem os valores MASCARADOS (null) e não deve reescrevê-los.
      if (podeVerCustos && savedId && !moLinhasEqual(moLinhasEnviadas, moBaseRef.current)) {
        const { error: moErr } = await supabase.rpc("salvar_modelo_servico_mo" as any, {
          _modelo_id: savedId,
          _linhas: moLinhasEnviadas.map((l) => ({
            id: l.id ?? null, // multi-instância: id preserva a linha (e sua aprovação) no diff do servidor
            categoria_terceirizado_id: l.categoria_terceirizado_id,
            valor: Number(l.valor) || 0,
            observacoes: null,
          })),
        });
        // Ajuste (set/2026): marca a etapa que falhou (mão de obra) — ver comentário acima.
        if (moErr) { (moErr as any).etapaFalha = "mo"; throw moErr; }
        // F3.2 — MO CONFIRMADA: só AGORA corrige custo_peca_previsto com a MO nova (update pontual, desenho do
        // Dev :2140-2150). Só quando esta tentativa já mandou as colunas derivadas.
        // Fix round 4 (item 3) — `custo_peca_previsto` é DERIVADO (Σ BOM + MO), não coluna do Dev: passa a
        // depender de `totais != null` (a ficha estava CARREGADA na captura — ver `useFichaTecnica.capturar`),
        // não mais de `podeGravarColunasDev`. Cenário: card com CAD (trava "cad") ou usuário sem `canEdit` do
        // Dev edita a MO no Planejamento — antes o update pontual ficava preso à trava do Dev e o
        // `custo_peca_previsto` gravado divergia do previsto ao vivo mostrado no Sheet; agora recalcula com os
        // totais do BOM CARREGADO (do servidor, já que travado não edita) + a MO recém-enviada. As demais
        // colunas derivadas do Dev (`custo_*` por tipo) continuam só com `podeGravarColunasDev`, em
        // `aplicarColunasFicha` (save-ficha.ts) — intocado.
        if (isEdit && incluirDerivados && bom.totais && fichaRef.current.podeVerCustos) {
          const moSomaEnviada = moLinhasEnviadas.reduce((s, l) => s + (Number(l.valor) || 0), 0);
          const { error: pecaErr } = await (supabase.from("modelos") as any)
            .update({ custo_peca_previsto: pecaCom(bom.totais, moSomaEnviada) })
            .eq("id", savedId);
          if (pecaErr) throw pecaErr;
        }
      }
      // F3.2 — #Erro nas etapas seguintes quando o BOM gravado mudou grade/consumo/aviamento (Dev :2198-2213).
      // A RPC só marca com CAD e etapas existentes; erro aqui NÃO derruba o save (paridade: o Dev ignora).
      let etapasMarcadas: string[] = [];
      if (isEdit && savedId && bom.gravar && (bom.flags.grade || bom.flags.consumo || bom.flags.aviamentos)) {
        const { data: marcadas } = await supabase.rpc("marcar_revisao_por_mudanca" as any, {
          _modelo_id: savedId, _grade: bom.flags.grade, _consumo: bom.flags.consumo, _aviamentos: bom.flags.aviamentos,
        });
        etapasMarcadas = marcadas && typeof marcadas === "object" ? Object.keys(marcadas as Record<string, unknown>) : [];
      }
      // FIX WAVE (B3-fix): card criado (ou editado pra) origem='revenda' sem produto
      // vinculado ganha o espelho AUTOMATICAMENTE — reusa exatamente a lógica do botão
      // manual `criarProdutoAcabado` abaixo (grupo via categorias_produto.grupo_id +
      // colecao_id/subcolecao/semana herdados do modelo). O botão manual continua existindo
      // pros modelos antigos sem produto (ex.: cards revenda de antes desta mudança).
      // Best-effort: qualquer erro aqui (inclusive a trava 1:1 `enforce_unique_fk` numa
      // corrida de save duplo) é capturado e NUNCA quebra o save do card — o "Modelo salvo"
      // já é verdade nesse ponto (header + MO já persistiram).
      let autoProduto: { criou: boolean; semColecao: boolean } | null = null;
      if (savedId && d.origem === "revenda" && paOn) {
        try {
          const { data: existente } = await supabase
            .from("produtos_acabados" as any)
            .select("id")
            .eq("modelo_id", savedId)
            .maybeSingle();
          if (!existente) {
            const cat = categorias.find((c) => c.id === d.categoria_principal_id);
            const grupoId = cat?.grupo_id ?? null;
            if (grupoId && d.categoria_principal_id) {
              const { data: novoProdutoId, error: paErr } = await supabase.rpc("salvar_produto_acabado" as any, {
                _id: null,
                _dados: {
                  nome: d.nome,
                  grupo_id: grupoId,
                  categoria_id: d.categoria_principal_id,
                  subcategoria1_id: d.subcategoria1_id,
                  subcategoria2_id: d.subcategoria2_id,
                  colecao_id: d.colecao_id,
                  subcolecao: d.subcolecao || null,
                  semana: d.semana || null,
                },
                _variantes: [],
              });
              if (paErr) throw paErr;
              const { error: linkErr } = await (supabase.from("produtos_acabados" as any) as any)
                .update({ modelo_id: savedId }).eq("id", novoProdutoId);
              if (linkErr) throw linkErr;
              autoProduto = { criou: true, semColecao: !d.colecao_id };
            }
          }
        } catch (autoErr) {
          console.error("Auto-criação do produto acabado (revenda) falhou — save do card mantido:", autoErr);
        }
      }
      // `savedDraft` (bug-fix): devolve o MESMO `d` que foi de fato enviado ao servidor —
      // o `onSuccess` abaixo usa este (não o `draft` do closure do render que chamou
      // `save.mutate`) pra fixar `baseRef`/decidir invalidations, mesma razão do `d` acima.
      // Fix final (F3.1, item 2): passa por `normalizarDraftSalvo` — o payload real mandou
      // `ref` aparada e `descricao_produto` trim-ou-NULL (via `aplicarRegrasCamposDev`/
      // `textoOuNull` acima), mas `d` cru ainda guarda os valores DIGITADOS (com espaço).
      // Sem isto, `baseRef` (o "base" do próximo merge) divergia do que o banco de fato tem,
      // e o refetch seguinte via Realtime mostrava o eco do PRÓPRIO Salvar como conflito.
      // `savedId` (F3.1): id do card — usado no onSuccess pra disparar `onCreated` no card NOVO.
      return {
        autoProduto, savedDraft: normalizarDraftSalvo(d), savedId, etapasMarcadas,
        consumoOuAviamento: bom.gravar && (bom.flags.consumo || bom.flags.aviamentos),
      };
    },
    onSuccess: (result) => {
      const etapasMarcadas = result?.etapasMarcadas ?? [];
      if (etapasMarcadas.length > 0) {
        const nomes = etapasMarcadas.map((k) => STAGE_LABEL[k] ?? k).join(", ");
        const corteMsg = fichaRef.current.etapas.corte && (fichaRef.current.etapas.baixa_total ?? 0) > 0 ? " O corte/baixa de estoque também foi afetado — reveja a Explosão." : "";
        toast.info(`Salvo. Etapas posteriores marcadas para verificação (#Erro): ${nomes}.${corteMsg}`);
      } else if (result?.consumoOuAviamento && fichaRef.current.etapas.corte) {
        toast.info("Salvo. A metragem/baixa do corte mudou — reveja a Explosão (reenvie se necessário).");
      } else {
        toast.success("Modelo salvo");
      }
      if (result?.autoProduto?.criou) {
        if (result.autoProduto.semColecao) {
          toast.success('Produto criado no Produto Acabado — defina a coleção do modelo pra ele aparecer no canvas.');
        } else {
          toast.success("Produto criado no Produto Acabado.");
        }
      }
      // Item 3 (bônus, refino ago/2026): QUALQUER save de um card revenda invalida o cache do
      // Produto Acabado — antes só cobria o auto-criar do espelho (acima); editar um campo que
      // o PA lê por embed (ex.: Linha → "Markup da linha (sugestão)" no card, ou preço
      // varejo/atacado) num produto JÁ vinculado não invalidava nada aqui. Na prática o
      // `ProdutoAcabadoSheet` já busca fresco a cada montagem (`["produtos-acabados", colecaoId]`
      // sem staleTime — default 0), mas isto fecha o buraco se o Sheet permanecer montado
      // durante o save (reabertura rápida) e mantém paridade com `invalidarVizinhos` do sentido
      // inverso (`ProdutoCard.tsx`, PA → Planejamento).
      // `savedDraft` = o rascunho REALMENTE enviado ao servidor (bug-fix acima) — usar o
      // `draft` do closure aqui reabriria a mesma janela (onSuccess roda depois de um
      // possível novo render durante o `await`, então `draft` já pode ter avançado de novo).
      const savedDraft = result?.savedDraft ?? draft;
      if (savedDraft.origem === "revenda") {
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey?.[0] === "string" && (q.queryKey[0] as string).startsWith("produtos-acabados") });
        qc.invalidateQueries({ queryKey: ["pa-produto-modelo", modeloId] });
      }
      // Fix T10 I1 — o UPDATE do header manda `tecidos_planejados` DERIVADO do BOM quando `bom.gravar`
      // (aplicarColunasFicha), mas `savedDraft` (congelado ANTES do payload ser montado) ainda carrega o
      // valor de origem. Sem isto, `baseRef`/`resetDraftBaseline`/`tocadosAposSalvar` comparam com um
      // baseline desatualizado e o refetch de `["modelo"]` (já com a lista NOVA) soa como "alguém salvou
      // agora — 1 campo atualizado" contra o PRÓPRIO write.
      let enviadoEfetivo = enviadoRef.current ? draftEnviadoEfetivo(savedDraft, enviadoRef.current.bom) : savedDraft;
      // Fix final M1 (2ª parte) — `proporcoes`/`custos_adicionais` fora do payload (ficha travada no
      // meio do caminho — `podeGravarColunasDev=false`, ver `aplicarColunasFicha`) NÃO podem virar
      // "enviado" no baseline: o servidor NUNCA os recebeu, mas `savedDraft` ainda carrega o valor
      // editado localmente. `baseRef.current?.draft` (o "draft do servidor" ANTES deste save, LIDO
      // ANTES de ser sobrescrito abaixo) é a fonte de verdade a preservar. Usa
      // `podeGravarColunasDevNaCaptura` (não `fichaRef.current.podeGravarColunasDev` — o valor de AGORA,
      // que pode já ter mudado durante o `await`): o que decide se o payload levou os 2 campos é o valor
      // do INSTANTE da captura, síncrono, mesmo já usado por `retryBloqueadoPorEnvio` acima.
      if (baseRef.current && enviadoRef.current) {
        enviadoEfetivo = draftEnviadoComColunasDev(enviadoEfetivo, baseRef.current.draft, enviadoRef.current.podeGravarColunasDevNaCaptura);
      }
      // F3.2 — FIX do save-em-voo (receita 2419d0f): base e baseline do "não salvo" = o que FOI ENVIADO
      // (`enviadoEfetivo` — já é o `d` congelado no mutationFn, mesma fonte de `enviadoRef.current.draft`,
      // com `tecidos_planejados` corrigido pelo fix I1 acima); campo editado durante o voo SEGUE tocado e o
      // selo segue aceso até o próximo Salvar (o eco do meu UPDATE não reverte nem vira conflito comigo
      // mesmo). Mesmo tick síncrono do `ficha.aposSalvar` abaixo — sem `await` entre o rebase do draft e o
      // rebase do BOM (nota do controlador, revisão T7).
      resetDraftBaseline(enviadoEfetivo);
      // Colab: o que acabei de salvar já É o "base" atual — evita que o eco do Realtime (meu
      // próprio UPDATE) apareça como "alguém atualizou N campos" no banner. O rev real
      // (bumpado no servidor) chega no próximo refetch — o merge effect processa em silêncio
      // (base≈fresh, sem conflitos) e avança `revRef`. `enviadoEfetivo` (não o `draft` do closure,
      // que pode ter avançado durante o `await`) é a verdade do que está no servidor agora.
      baseRef.current = { draft: enviadoEfetivo };
      touchedRef.current = tocadosAposSalvar({ touched: touchedRef.current, live: draftLiveRef.current, enviado: enviadoEfetivo });
      // Fix T10 I1 — o draft VIVO também adota a lista derivada do BOM, SEM marcar como tocado: senão o
      // campo "Tecido Planejado" na tela mostraria o valor VELHO enquanto o baseline (acima) já é o novo,
      // o que acenderia o selo "não salvo" sozinho logo após o Salvar. Só quando o usuário NÃO editou a
      // lista em voo (`touchedRef` já recalculado por `tocadosAposSalvar` acima) — edição em voo tem
      // prioridade e seria sobrescrita se adotássemos incondicionalmente.
      if (enviadoEfetivo.tecidos_planejados !== savedDraft.tecidos_planejados && !touchedRef.current.has("tecidos_planejados")) {
        setDraft((d) => (d.tecidos_planejados === enviadoEfetivo.tecidos_planejados ? d : { ...d, tecidos_planejados: enviadoEfetivo.tecidos_planejados }));
        draftLiveRef.current = { ...draftLiveRef.current, tecidos_planejados: enviadoEfetivo.tecidos_planejados };
      }
      if (enviadoRef.current) {
        const { edicoesPerdidas } = fichaRef.current.aposSalvar({ bomEnviado: enviadoRef.current.bom });
        // Fix final M1 (1ª parte) — a ficha (Tecidos/Aviamentos/Insumos/Grade) estava tocada mas este
        // Salvar não gravou o BOM (a trava chegou entre a captura e o save): o "não salvo" segue aceso
        // (useFichaTecnica.aposSalvar já NÃO limpou), mas sem este aviso o usuário só veria "Modelo
        // salvo" e acharia que tudo foi. Mesmo padrão de `toast.warning` do aviso "#Erro"/conflito.
        if (edicoesPerdidas) {
          toast.warning("As alterações da Ficha (Tecidos/Aviamentos/Insumos/Grade) NÃO foram salvas — a ficha está travada. Recarregue o card e tente de novo.");
        }
      }
      conflitosRef.current = [];
      setConflitos([]);
      setUltimoMerge(null);
      // MO por serviço: o que acabei de persistir vira o novo baseline (limpa o indicador de
      // "não salvo" das linhas de MO). F3.2 — usa o ENVIADO (mesma razão do draft acima: uma edição em
      // voo durante o save não pode ser confundida com o que já foi persistido).
      setMoLinhasBase(enviadoRef.current?.moLinhas ?? moLinhasRef.current);
      qc.invalidateQueries({ queryKey: ["modelo"] });
      qc.invalidateQueries({ queryKey: ["modelo-tecidos"] });
      qc.invalidateQueries({ queryKey: ["otb-orcamento"] });
      qc.invalidateQueries({ queryKey: ["mo-resumo", modeloId] });
      qc.invalidateQueries({ queryKey: ["mo-resumo-list"] });
      qc.invalidateQueries({ queryKey: ["plan-custo-unit", modeloId] });
      // Cross-invalidation (bidirecionalidade c/ o Desenvolvimento, spec 2026-08-11): sem
      // isto o Dev não ficava sabendo de edições de MO salvas aqui sem refetch manual.
      qc.invalidateQueries({ queryKey: ["modelo-mo-resumo"] });
      // Identidade/classificação (Nome, taxonomia, coleção, linha, datas) é a MESMA ficha
      // `modelos` editada no Dev (seção "1. Geral") — o Dev já invalida `modelos-planejamento`
      // no seu save (reflexo Dev→Plan.); este espelha o sentido Plan.→Dev pra o card do kanban
      // do Desenvolvimento refletir sem refetch manual (§K, decisão do dono ago/2026).
      qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
      qc.invalidateQueries({ queryKey: ["plan-grade-total"] });
      qc.invalidateQueries({ queryKey: ["modelo-grades-revenda", modeloId] });
      // F3.1: o save muda as condições do kanban (datas/pilotos/anexos…) — refresca o gate da REF com a chave
      // ligada e a dica do "Mover para…".
      qc.invalidateQueries({ queryKey: ["plan-kanban-cond", modeloId] });
      // F3.1: a "Composição" das Observações lê `modelo_tecidos`, que o Salvar grava.
      qc.invalidateQueries({ queryKey: ["modelo-composicao", modeloId] });
      // F3.2 — o BOM é o MESMO do Desenvolvimento: refresca o Sheet do Dev (mesma aba) e quem lê o BOM.
      qc.invalidateQueries({ queryKey: ["modelo-detail", modeloId] });
      if (enviadoRef.current?.bom.gravar) {
        for (const k of ["modelo-tecidos-consumo", "modelo-tecido-oc-links", "modelo-aviamentos", "modelo-etiquetas", "modelo-grades", "modelo-condicoes-kanban", "etapas-afetadas"])
          qc.invalidateQueries({ queryKey: [k, modeloId] });
        for (const k of ["estoque-tecidos", "estoque-tecido-por-artigo", "producao-terc-list", "producao-cq-list", "dir-list"])
          qc.invalidateQueries({ queryKey: [k] });
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey?.[0] === "string" && (q.queryKey[0] as string).startsWith("ft-") });
      }
      // Salvar MANTÉM o Sheet aberto (decisão do dono set/2026 — antes fechava): `onSaved()`
      // atualiza os cards do container por baixo; o card fica aberto pra continuar conferindo
      // (ex.: o preço/custo recalculado). `resetDraftBaseline` + `setMoLinhasBase` acima já apagaram o
      // selo "não salvo". Fechar é só pelo Voltar (`requestClose`). Não chamar `onClose()` aqui.
      onSaved();
      // F3.1 — card NOVO: vira o Sheet do id criado (o `PlanejamentoDetail` remonta com a key nova).
      if (!isEdit && result?.savedId) onCreated?.(result.savedId);
    },
    onError: async (e: any) => {
      // F3.1 — card NOVO já INSERIDO que falhou numa gravação seguinte (tecidos/grade/MO): mostra o erro, atualiza
      // a lista e abre o Sheet do card criado — o usuário confere e salva de lá (UPDATE). Nunca um 2º INSERT.
      if (!isEdit && criadoIdRef.current) {
        // Ajuste (set/2026): mensagem específica por etapa quando dá pra identificar (marcada em
        // `e.etapaFalha` no mutationFn acima) — a mão de obra digitada some na remontagem do Sheet
        // (o MaoObraEditor reseta com o baseline do servidor), então o aviso precisa dizer isso.
        const idCriado = criadoIdRef.current;
        if (e?.etapaFalha === "mo") {
          toast.error("O card foi criado, mas a mão de obra NÃO foi salva — confira e salve de novo.");
        } else if (e?.etapaFalha === "tecidos") {
          // Item E (fix round 2) — `gravarTecidosIniciais` falhou: o BOM do servidor segue VAZIO. Ao reabrir
          // o Sheet do card criado, a carga (useFichaBom) vê o BOM vazio e pré-preenche Tecido 1..N a partir
          // de `tecidos_planejados` (a mesma lista que o Dialog gravou no draft) — SEM tocar, mas marcando
          // `prefillPendenteRef` (item E). O `capturar` do useFichaTecnica soma essa pendência à condição de
          // `gravar`: o PRÓXIMO Salvar regrava o BOM sozinho, mesmo sem o usuário tocar em nada.
          // Fix round 4 (item 8, T13 m3) — toast honesto: sem `podeEditarDev`, "salve de novo" é uma instrução
          // que o próprio usuário não consegue cumprir (o Salvar sem `canEdit("criacao_desenvolvimento")` OMITE
          // as colunas do Dev — decisão F3 #8 — e nunca regravaria o BOM). Mesma condição/mesma mensagem do
          // `duplicate` em `PlanejamentoDetail.tsx`.
          toast.error(
            podeEditarDev
              ? "O card foi criado, mas os tecidos NÃO foram para a Ficha (BOM). Eles aparecem na seção Tecidos — salve o card de novo para gravá-los."
              : "O card foi criado, mas os tecidos NÃO foram para a Ficha (BOM). Peça a quem edita o Desenvolvimento para salvar a nova versão.",
          );
        } else if (e?.etapaFalha === "grade") {
          toast.error("O card foi criado, mas a grade NÃO foi salva — confira e salve de novo.");
        } else {
          toast.error(`O card foi criado, mas algo não foi salvo: ${mensagemErro(e, "erro desconhecido")}`);
        }
        // Mesmas invalidações do onSuccess (o card existe no servidor desde o INSERT — sem isto a
        // lista do Planejamento e o orçamento do OTB ficavam com o card fantasma até um refetch manual).
        qc.invalidateQueries({ queryKey: ["modelo"] });
        qc.invalidateQueries({ queryKey: ["modelo-tecidos"] });
        qc.invalidateQueries({ queryKey: ["otb-orcamento"] });
        qc.invalidateQueries({ queryKey: ["mo-resumo", idCriado] });
        qc.invalidateQueries({ queryKey: ["mo-resumo-list"] });
        qc.invalidateQueries({ queryKey: ["plan-custo-unit", idCriado] });
        qc.invalidateQueries({ queryKey: ["modelo-mo-resumo"] });
        qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
        qc.invalidateQueries({ queryKey: ["plan-grade-total"] });
        qc.invalidateQueries({ queryKey: ["modelo-grades-revenda", idCriado] });
        qc.invalidateQueries({ queryKey: ["plan-kanban-cond", idCriado] });
        qc.invalidateQueries({ queryKey: ["modelo-composicao", idCriado] });
        onSaved();
        onCreated?.(idCriado);
        return;
      }
      // Grade cor×tamanho (revenda, fast-follow): conflito tratado por RECARGA, NÃO por merge
      // — refaz o fetch da grade e deixa o usuário reaplicar (política "conflito → recarrega",
      // limitação consciente; ver comentário no `mutationFn`). Fica ANTES do branch de P0409
      // do header abaixo (que este marcador `gradeConflict` desvia) — não entra no
      // merge/retry dele, que não sabe nada de `gradeRevenda`.
      if (e?.code === "P0409" && e?.gradeConflict) {
        await qc.refetchQueries({ queryKey: ["modelo-grades-revenda", modeloId] });
        const freshGrade = qc.getQueryData<{ variante_numero: number; grades: Record<string, number> | null; grade_total: number }[]>(["modelo-grades-revenda", modeloId]) ?? [];
        const seeded: Record<number, Record<string, number>> = {};
        for (const r of freshGrade) seeded[r.variante_numero] = { ...(r.grades ?? {}) };
        setGradeRevenda(seeded);
        gradeRevendaBaseRef.current = JSON.stringify(seeded);
        // Resincroniza o rev PRÓPRIO da grade — sem isto o PRÓXIMO Salvar compararia com um
        // `_rev_base` velho e cairia em P0409 de novo, mesmo já com os dados certos na tela.
        // Não mexe em `revRef`/draft — o merge effect existente (useEffect de `[modeloData]`)
        // resolve isso sozinho a partir deste mesmo refetch.
        await qc.refetchQueries({ queryKey: ["modelo", modeloId] });
        const freshModelo = qc.getQueryData<any>(["modelo", modeloId]);
        gradeRevendaRevRef.current = freshModelo?.rev ?? null;
        toast.error(mensagemErro(e, "Erro ao salvar"));
        return;
      }
      // Colab (Task 2, mesma armadilha documentada no piloto/Desenvolvimento): ler o cache
      // DIRETO (getQueryData) + refs-espelho DENTRO do onError — NUNCA delegar ao useEffect
      // (só roda no próximo passive-effect commit; o retry leria `revRef.current` VELHO e
      // cairia em P0409 de novo). `draftLiveRef` (não o `draft` da closure) garante que
      // nenhuma tecla digitada durante o `await` (campos não ficam disabled) se perca.
      if (e?.code === "P0409" && !retryRef.current) {
        retryRef.current = true;
        savingRef.current = true;
        // F3.2 / R5 — BOM tocado: só é conflito de SEÇÃO se o BOM do SERVIDOR mudou de verdade (o P0409 pode ter vindo de
        // uma ação MINHA que só subiu o `rev` — Mover para…, Ordem de Criação, Lançar, aprovar MO). Confere ANTES do
        // refetch do modelo: o trecho abaixo (merge + avanço de base/rev) continua síncrono, como antes.
        // Item E (fix round 3, (a)) — antes só conferia com `colecoesTouchadasRef` (BOM tocado pelo usuário).
        // Cenário do bug: B salva o BOM completo pelo Dev; A tem PREFILL pendente (BOM do servidor chegou
        // vazio na carga de A, pré-preencheu Tecido 1..N sem marcar tocado) e salva o preço antes do eco
        // chegar; dá P0409. `colecoesTouchadasRef=false` ⇒ `bomConflito` ficava sempre `false` ⇒ o retry
        // gravava o esqueleto Tecido 1..N por cima do BOM que B acabou de completar. `bomPendenteDeGravar()`
        // soma o prefill à condição de conferir (mesma fonte usada por `capturar().gravar`).
        const bomConflito = fichaRef.current.bomPendenteDeGravar() ? await fichaRef.current.bomMudouNoServidor() : false;
        await qc.refetchQueries({ queryKey: ["modelo", modeloId] });
        const fresh = qc.getQueryData<any>(["modelo", modeloId]);
        if (fresh) {
          // Item C (fix round 3, (b)) — outra pessoa enviou o card à Explosão (`enviado_cad=true`) NO MEIO
          // deste Salvar: o retry automático abaixo ainda leria `podeEditar`/`podeGravarColunasDev` do
          // MOMENTO da captura (antes do envio) — `_salvar_modelo_bom_core` não tem guarda própria no servidor,
          // então gravaria o BOM/colunas do Dev num card já enviado. Bloqueia ANTES de decidir `podeRetentar`,
          // e SÓ quando esta captura IA gravar algo do Dev (`bom.gravar || podeGravarColunasDev || campos
          // simples do Dev no payload` — fix round 4, item 10) — senão o payload já saiu sem nada do Dev e o
          // retry é seguro (não é este bug).
          const bloqueadoPorEnvio = retryBloqueadoPorEnvio(fresh, {
            enviadoCadNaCaptura: enviadoRef.current?.enviadoCadNaCaptura ?? false,
            gravaBom: enviadoRef.current?.bom.gravar ?? false,
            podeGravarColunasDev: enviadoRef.current?.podeGravarColunasDevNaCaptura ?? false,
            temCamposDevNoPayload: enviadoRef.current?.temCamposDevNoPayloadNaCaptura ?? false,
          });
          if (bloqueadoPorEnvio) {
            savingRef.current = false;
            retryRef.current = false;
            // Item C (fix round 3, (c)) — toast honesto: NADA foi salvo (nem o retry, nem a 1ª tentativa
            // deste ciclo — o UPDATE do header já tinha falhado com P0409 antes de chegar aqui).
            toast.error("Este card foi enviado à Explosão por outra pessoa enquanto você salvava — nada foi salvo. Os campos do Desenvolvimento agora estão travados; confira o card e salve de novo o que for do Planejamento.");
            qc.invalidateQueries({ queryKey: ["modelo", modeloId] });
            fichaRef.current.invalidarBom();
            return;
          }
          const freshDraft = draftFromModeloRow(fresh);
          const liveDraft = draftLiveRef.current;
          const base = baseRef.current ?? { draft: freshDraft };
          const r = prepararRetryP0409({ base: base.draft, live: liveDraft, fresh: freshDraft, touched: touchedRef.current, bomConflito });
          setDraft(r.proximoDraft);
          // F3.2 — FIX: espelho SÍNCRONO antes do retry (o save.mutate abaixo roda ANTES do re-render e o
          // mutationFn lê draftLiveRef). Sem isto o retry reenviava o draft velho da closure.
          draftLiveRef.current = r.proximoDraft;
          conflitosRef.current = r.conflitos;
          setConflitos(r.conflitos);
          setUltimoMerge({ atualizados: r.atualizados, conflitos: r.conflitos });
          // BOM tocado E o BOM do servidor mudou ⇒ conflito de SEÇÃO (Dev :2306-2307); o retry não acontece. BOM tocado
          // com o do servidor IGUAL ⇒ retry normal (grava o BOM; os derivados vão junto — `incluirDerivados`).
          if (bomConflito) fichaRef.current.setConflitoBom(true);
          // Avança base/rev AQUI — o merge effect (dispara em seguida pelo mesmo refetch) vai
          // ver base===fresh e virar no-op: nada é reaplicado em dobro.
          baseRef.current = { draft: freshDraft };
          revRef.current = (fresh as any).rev ?? null;
          setEnviada(!!(fresh as any).ordem_criacao_enviada);
          setLancado(!!(fresh as any).lancado);
          if (r.podeRetentar) {
            save.mutate(undefined, { onSettled: () => { savingRef.current = false; retryRef.current = false; } });
            return;
          }
          // Item H (T11, m2) — SEM retry (conflito de campo escalar do draft, não do BOM): o `rev` já avançou
          // aqui, mas o BOM local pode ter ficado desatualizado frente ao servidor. Sem invalidar, um Salvar
          // seguinte com o BOM ainda tocado sobrescreveria um BOM alheio sem passar pela conferência R5 (que só
          // roda quando o `rev` muda DE NOVO). `bomConflito` já cobre o próprio caso do BOM via o banner de
          // seção (o usuário resolve e a invalidação vem de lá); aqui cobre o caso GERAL.
          if (!bomConflito) fichaRef.current.invalidarBom();
        }
        savingRef.current = false;
        retryRef.current = false;
        toast.error(mensagemErro(e, "Erro ao salvar"));
        return;
      }
      // Fix final ROUND 2, item 3 (M2) — ramo GENÉRICO (não-P0409: erro de rede, RLS, validação do
      // servidor…). Um BOM alheio que chegou em voo (outra pessoa salvou o consumo enquanto ESTE save
      // rodava e falhou) pode ter deixado o cache do BOM desatualizado frente ao servidor — sem invalidar,
      // o PRÓXIMO Salvar (com o BOM local ainda tocado) sobrescreveria esse BOM alheio sem passar pela
      // conferência R5 (que só roda quando o `rev` muda DE NOVO — e aqui o UPDATE do header nem chegou a
      // avançar o `rev`, então nada dispara essa conferência sozinho). Mesmo padrão do item H (m2) acima,
      // que já cobre o ramo do P0409 sem retry.
      fichaRef.current.invalidarBom();
      toast.error(mensagemErro(e, "Erro"));
    },
    // Item G (CONTADOR — fix round 3) — desmarca "save em voo" (−1) ao fim de QUALQUER ciclo (sucesso, erro,
    // ou o ciclo intermediário do P0409 antes de um retry — que remarca +1 de novo ao reentrar no
    // `mutationFn`, ANTES deste onSettled do ciclo anterior rodar — daí o contador, não mais um booleano).
    onSettled: () => { fichaRef.current.marcarSaveEmVoo(false); },
  });

  const handleSave = () => {
    if (savingRef.current || save.isPending) return;
    savingRef.current = true;
    save.mutate(undefined, { onSettled: () => { savingRef.current = false; } });
  };

  return { save, handleSave };
}
