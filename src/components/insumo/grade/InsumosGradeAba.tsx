import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Save, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageActionBar } from "@/components/shared/PageActionBar";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { useConfirmacao } from "@/components/shared/ConfirmarAcaoDialog";
import {
  CardDraftsProvider,
  useCardDrafts,
} from "@/components/shared/card-drafts/CardDraftsProvider";
import { useReadOnly } from "@/components/RequirePermission";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { SortDir } from "@/components/shared/sort";
import { normalizeCat } from "@/lib/fornecedor-categoria";
import { COLUNAS_INSUMO, byKey } from "@/lib/insumo-grade/colunas";
import { opcoesDaColuna, tamanhosHabilitados } from "@/lib/insumo-grade/celulas";
import { ordenarLinhasPorColuna } from "@/lib/insumo-grade/ordenar";
import { montarLinhas, type ResolverRotulo } from "@/lib/insumo-grade/linhas";
import {
  resultadoComNovos,
  salvarEmOrdem,
  salvarInsumoNovo,
  textoErroSalvar,
  textoResultadoSalvar,
  type ItemInsumo,
} from "@/lib/insumo-grade/salvar";
import {
  agruparNovosInsumos,
  camposDaCor,
  camposDoInsumo,
  ehBlocoColavel,
  mapearColagem,
  montarLookupsColagem,
  parseBlocoTsv,
  resumoColagem,
  type PatchColagem,
} from "@/lib/insumo-grade/colar-tsv";
import {
  chaveSlotCor,
  chaveSlotNovo,
  montarSlots,
  recusaDoSlot,
} from "@/lib/insumo-grade/colar-slots";
import {
  corNovaEmExistente,
  insumoJaExiste,
  insumoNovoVazio,
  payloadImportar,
  separarNovos,
  vinculoDoNovo,
  type InsumoNovo,
} from "@/lib/insumo-grade/linha-nova";
import { QUERY_KEYS_GRADE, excluirInsumoGrade, textoErroExcluir } from "@/lib/insumo-grade/excluir";
import {
  InsumosGradeTabela,
  type ColarProps,
  type ExcluirProps,
  type OrdenacaoProps,
  type RegistrarSaver,
  type SaverApi,
} from "./InsumosGradeTabela";
import type { AtualizarNovo } from "./InsumoNovoGrupo";
import { useInsumosGrade } from "./useInsumosGrade";

export interface InsumosGradeAbaProps {
  /** Insumos já filtrados pela tela (a grade mostra só estes, na mesma ordem). Sem a prop, mostra todos os da loja. */
  etiquetas?: { id: string }[];
  isMobile?: boolean;
  /**
   * Avisa a tela-mãe quando há rascunho não salvo. A tela usa isto para pedir confirmação ANTES de trocar de visão (Cards) ou de
   * filtro/busca — senão a grade desmonta e o rascunho se perde calado. Ao desmontar avisa `false`.
   */
  onDirtyChange?: (sujo: boolean) => void;
}

/**
 * Aba "Lista tipo Excel" do Cadastro > Insumos: a GRADE EDITÁVEL (1 linha-pai por insumo + 1 linha por cor, nascem recolhidas).
 * Editar só mexe em RASCUNHO (selo âmbar); NADA grava antes do Salvar. UM Salvar grava cada insumo sujo na ordem da tela: o
 * cabeçalho por UPDATE direto ("último vence": insumo não tem `rev`) e, se as cores mudaram, as variantes por delete-and-reinsert
 * (cor × tamanhos), com resultado parcial (o insumo que falha fica sujo, com o aviso na própria linha). Também CRIA: "+ Novo insumo" /
 * "+ cor" montam linhas NOVAS em rascunho (estado desta aba, não do servidor) que o MESMO Salvar manda por `importar_insumo_linha`
 * (variantes expandidas por cor × tamanho), depois dos editados; linha nova incompleta fica PENDENTE (em vermelho) e não trava as
 * válidas. COLAR do Excel (Ctrl+V de um bloco TSV numa célula) vira rascunho a partir da célula-âncora (cor/tipo/fornecedor/tamanhos…
 * pelo NOME; texto sem correspondência NÃO grava e avisa na célula); linhas além do fim criam insumos novos. EXCLUIR (lixeira única
 * por linha): o INSUMO grava NA HORA, atrás de confirmação (DELETE direto; a FK recusa se estiver em uso); a COR só sai do rascunho.
 */
export function InsumosGradeAba(props: InsumosGradeAbaProps) {
  return (
    <CardDraftsProvider>
      <InsumosGradeConteudo
        etiquetas={props.etiquetas}
        isMobile={props.isMobile}
        onDirtyChange={props.onDirtyChange}
      />
    </CardDraftsProvider>
  );
}

function InsumosGradeConteudo({ etiquetas, isMobile, onDirtyChange }: InsumosGradeAbaProps) {
  const qc = useQueryClient();
  const dados = useInsumosGrade();
  const readOnly = useReadOnly();
  const { nSujos, descartarTodos } = useCardDrafts();
  const { pedir: pedirConfirmacao, dialog: dialogConfirmacao } = useConfirmacao();

  // Linhas NOVAS (insumo novo / cor nova): rascunho só desta aba. Nada grava antes do Salvar.
  const [novos, setNovos] = useState<InsumoNovo[]>([]);
  const [errosNovos, setErrosNovos] = useState<Record<string, string>>({});
  // Depois de tentar salvar, os pendentes (faltam dados) ficam em vermelho; antes disso uma linha recém-criada não "grita".
  const [mostrarPendencias, setMostrarPendencias] = useState(false);
  const novosRef = useRef(novos);
  novosRef.current = novos;
  // Avisos da última colagem (texto que não foi aplicado), por célula `<slot>|<coluna>`. Somem ao editar a célula.
  const [avisosColar, setAvisosColar] = useState<Record<string, string>>({});
  const limparAvisoColar = useCallback((chave: string) => {
    setAvisosColar((a) => {
      if (!(chave in a)) return a;
      const { [chave]: _fora, ...resto } = a;
      void _fora;
      return resto;
    });
  }, []);
  const limparErroNovo = useCallback((tmp: string) => {
    setErrosNovos((e) => {
      if (!(tmp in e)) return e;
      const { [tmp]: _fora, ...resto } = e;
      void _fora;
      return resto;
    });
  }, []);
  const atualizarNovo = useCallback<AtualizarNovo>(
    (tmp, fn) => {
      setNovos((l) => l.map((g) => (g.tmp === tmp ? fn(g) : g)));
      limparErroNovo(tmp);
    },
    [limparErroNovo],
  );
  const removerNovo = useCallback(
    (tmp: string) => {
      setNovos((l) => l.filter((g) => g.tmp !== tmp));
      limparErroNovo(tmp);
    },
    [limparErroNovo],
  );
  const adicionarInsumo = useCallback(() => setNovos((l) => [...l, insumoNovoVazio()]), []);
  // 1 grupo de cor nova por insumo existente (as próximas cores entram nele por "+ adicionar cor")
  const adicionarCor = useCallback(
    (insumoId: string, nome: string, formato: string) =>
      setNovos((l) =>
        l.some((g) => g.insumoAlvoId === insumoId)
          ? l
          : [...l, corNovaEmExistente(insumoId, nome, formato)],
      ),
    [],
  );
  useEffect(() => {
    if (novos.length === 0) setMostrarPendencias(false);
  }, [novos.length]);
  const nTotal = nSujos + novos.length;

  // Avisa a tela-mãe do rascunho (para ela guardar a troca de visão/filtro). Ao desmontar (fechou a Lista) volta a "limpo".
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => {
    onDirtyRef.current?.(nTotal > 0);
  }, [nTotal]);
  useEffect(() => () => onDirtyRef.current?.(false), []);

  // Guarda de "alterações não salvas": navegar de rota com rascunho pede confirmação (o selo está no cabeçalho).
  const { confirm } = useUnsavedGuard({ dirty: nTotal > 0, blockNav: true });

  // Cada rascunho (insumo) se registra aqui: o Salvar grava na ordem que ESTE wrapper define.
  const saversRef = useRef(new Map<string, SaverApi>());
  const registrar = useCallback<RegistrarSaver>((id, api) => {
    saversRef.current.set(id, api);
    return () => {
      if (saversRef.current.get(id) === api) saversRef.current.delete(id);
    };
  }, []);

  // A tela passa os insumos JÁ filtrados; os dados completos (cores, tamanhos…) vêm da query da grade.
  const visiveis = useMemo(() => {
    if (!etiquetas) return dados.etiquetas;
    // a ordem é a da lista que a tela entregou (filtrada/ordenada por ela); id que a leitura da grade não trouxe fica de fora
    const porId = new Map(dados.etiquetas.map((e) => [e.id, e]));
    return etiquetas.flatMap((e) => {
      const g = porId.get(e.id);
      return g ? [g] : [];
    });
  }, [dados.etiquetas, etiquetas]);
  const linhasServidor = useMemo(
    () => montarLinhas(visiveis, dados.blocosPorEtiqueta),
    [visiveis, dados.blocosPorEtiqueta],
  );

  // ORDENAÇÃO por coluna (clicar no cabeçalho: asc → desc). Sem clique = a ordem que a tela entregou. Ordena os GRUPOS (insumos)
  // pelo valor SALVO, nunca pelo rascunho, e deixa as cores de um insumo juntas (ver `insumo-grade/ordenar.ts`).
  const [ord, setOrd] = useState<{ key: string; dir: SortDir } | null>(null);
  const alternarOrdem = useCallback(
    (key: string) =>
      setOrd((o) =>
        o?.key === key ? { key, dir: o.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
      ),
    [],
  );
  // coluna de seleção guarda ID; ordena pelo NOME mostrado (tipo, fornecedor, cor)
  const rotulos = useMemo(() => {
    const mapa = new Map<string, Map<string, string>>();
    for (const k of ["tipo_insumo", "fornecedor", "cor"]) {
      mapa.set(k, new Map(opcoesDaColuna(k, dados.opcoes).map((x) => [x.id, x.nome])));
    }
    return mapa;
  }, [dados.opcoes]);
  const linhas = useMemo(() => {
    const col = ord ? byKey(ord.key) : undefined;
    if (!ord || !col) return linhasServidor;
    const resolver: ResolverRotulo = (colKey, id) => rotulos.get(colKey)?.get(id);
    return ordenarLinhasPorColuna(linhasServidor, col, ord.dir, resolver);
  }, [linhasServidor, ord, rotulos]);
  const ordenacao = useMemo<OrdenacaoProps>(
    () => ({ sortKey: ord?.key ?? null, sortDir: ord?.dir ?? "asc", toggle: alternarOrdem }),
    [ord, alternarOrdem],
  );

  const linhasRef = useRef(linhas);
  linhasRef.current = linhas;
  const opcoesRef = useRef(dados.opcoes);
  opcoesRef.current = dados.opcoes;

  // Ctrl+V de um bloco do Excel numa célula (a âncora). TUDO vira rascunho: aplica nos rascunhos existentes, atualiza as linhas
  // novas e cria insumos novos para as linhas que passam do fim. Nada grava antes do Salvar. `false` = não é bloco (colar normal).
  const aoColar = useCallback<ColarProps["onColar"]>(
    ({ chaveLinha: chaveDaLinha, colKey, texto }) => {
      const bloco = parseBlocoTsv(texto);
      if (!ehBlocoColavel(texto, bloco)) return false;
      const savers = saversRef.current;
      // cores que a lixeira marcou não são linhas da tela: o colar as pula
      const removidas = new Set<string>();
      for (const [id, api] of savers)
        for (const corId of api.removidas()) removidas.add(chaveSlotCor(id, corId));
      const novosAtuais = novosRef.current;
      const slots = montarSlots(linhasRef.current, novosAtuais, removidas);
      const linhaIdx = slots.findIndex((sl) => sl.chave === chaveDaLinha);
      const colIdx = COLUNAS_INSUMO.findIndex((c) => c.key === colKey);
      if (linhaIdx < 0 || colIdx < 0) return false;
      const opcoes = opcoesRef.current;
      const lookups = montarLookupsColagem(opcoes);

      /** O cabeçalho (rascunho) do insumo a que a linha pertence. */
      const cabecalhoDoSlot = (i: number) => {
        const sl = slots[i];
        if (sl.tipo === "existente") return savers.get(sl.insumoId)?.ler();
        return novosAtuais.find((g) => g.tmp === sl.grupoTmp)?.cab;
      };

      const res = mapearColagem({ linhaIdx, colIdx }, bloco, COLUNAS_INSUMO, slots.length, {
        lookups,
        aceitaCelula: (i, key) => {
          const recusa = recusaDoSlot(slots[i], byKey(key) ?? { escopo: "insumo" });
          if (recusa) return recusa;
          if (key === "tamanhos" && !tamanhosHabilitados(cabecalhoDoSlot(i)?.formato_tamanho))
            return 'Formato "Nenhum": o insumo não tem tamanho';
          return null;
        },
      });

      // 1) linhas que já existem: um lote de campos por linha; os rascunhos existentes recebem UM lote por insumo
      const porLinha = new Map<number, PatchColagem[]>();
      for (const pc of res.patches)
        porLinha.set(pc.linhaIdx, [...(porLinha.get(pc.linhaIdx) ?? []), pc]);
      const lotes = new Map<
        string,
        {
          campos: Record<string, unknown>;
          blocos: { corId: string; parte: Record<string, unknown> }[];
        }
      >();
      for (const [i, ps] of porLinha) {
        const sl = slots[i];
        const campoInsumo: Record<string, unknown> = {};
        const campoCor: Record<string, unknown> = {};
        const cab0 = cabecalhoDoSlot(i);
        // fornecedor colado na MESMA linha se afeta (representante): segue o que já foi aplicado
        let atual = {
          empresa_id: (cab0?.empresa_id as string | null | undefined) ?? null,
          representante_id: (cab0?.representante_id as string | null | undefined) ?? null,
        };
        for (const pc of ps) {
          const col = byKey(pc.colKey);
          if (!col) continue;
          if (col.escopo === "insumo") {
            const c = camposDoInsumo(col.key, pc.valor, atual);
            Object.assign(campoInsumo, c);
            atual = { ...atual, ...(c as Partial<typeof atual>) };
          } else {
            Object.assign(campoCor, camposDaCor(col.key, pc.valor));
          }
        }
        if (sl.tipo === "existente") {
          const lote = lotes.get(sl.insumoId) ?? { campos: {}, blocos: [] };
          Object.assign(lote.campos, campoInsumo);
          if (sl.corId != null && Object.keys(campoCor).length)
            lote.blocos.push({ corId: sl.corId, parte: campoCor });
          lotes.set(sl.insumoId, lote);
        } else {
          setNovos((l) =>
            l.map((g) =>
              g.tmp !== sl.grupoTmp
                ? g
                : {
                    ...g,
                    cab: { ...g.cab, ...campoInsumo },
                    blocos: g.blocos.map((b) => (b.tmp === sl.varTmp ? { ...b, ...campoCor } : b)),
                  },
            ),
          );
          limparErroNovo(sl.grupoTmp);
        }
      }
      for (const [id, lote] of lotes) savers.get(id)?.aplicar(lote);

      // 2) linhas além do fim = insumos novos (linhas seguidas com o mesmo nome são cores do mesmo insumo)
      const { grupos, varTmpPorLinha, avisos: avisosNovos } = agruparNovosInsumos(res.novasLinhas);
      if (grupos.length > 0) setNovos((l) => [...l, ...grupos]);

      // 3) avisos nas células cujo texto NÃO foi aplicado (ou foi com ressalva)
      const chaveDaLinhaColada = (i: number): string | null =>
        i < slots.length
          ? slots[i].chave
          : varTmpPorLinha[i - slots.length]
            ? chaveSlotNovo(varTmpPorLinha[i - slots.length])
            : null;
      setAvisosColar((antes) => {
        const prox = { ...antes };
        for (const pc of res.patches) {
          const k = `${slots[pc.linhaIdx].chave}|${pc.colKey}`;
          if (pc.aviso) prox[k] = pc.aviso;
          else delete prox[k];
        }
        for (const av of avisosNovos) {
          const ch = varTmpPorLinha[av.linhaNovaIdx];
          if (ch) prox[`${chaveSlotNovo(ch)}|${av.colKey}`] = av.msg;
        }
        for (const ig of res.ignoradas) {
          if (
            !ig.colKey ||
            !["sem-correspondencia", "numero-invalido", "regra", "linha-nao-aceita"].includes(
              ig.motivo,
            )
          )
            continue;
          const ch = chaveDaLinhaColada(ig.linhaIdx);
          if (ch) prox[`${ch}|${ig.colKey}`] = ig.detalhe;
        }
        return prox;
      });

      const resumo = resumoColagem(res);
      const opcoesToast = resumo.detalhe ? { description: resumo.detalhe } : undefined;
      if (resumo.tom === "sucesso") toast.success(resumo.texto, opcoesToast);
      else toast.warning(resumo.texto, opcoesToast);
      return true;
    },
    [limparErroNovo],
  );
  const colar = useMemo<ColarProps>(
    () => ({ avisos: avisosColar, onLimparAviso: limparAvisoColar, onColar: aoColar }),
    [avisosColar, limparAvisoColar, aoColar],
  );

  const salvarMut = useMutation({
    mutationFn: async () => {
      const ctx = { limite: Date.now() + 5000 };
      // na ordem em que a tela mostra os insumos (o Map registra na ordem de montagem, que não é a da tela)
      const ordemTela = Array.from(new Set(linhas.map((l) => l.insumoId)));
      const sujos: ItemInsumo[] = [];
      for (const id of ordemTela) {
        const api = saversRef.current.get(id);
        if (api) sujos.push({ id, dirty: api.dirty, salvar: api.salvar });
      }
      const resultado = await salvarEmOrdem(sujos, ctx);
      // NOVOS depois dos editados: acrescentar cor a um insumo que existe não mexe no cabeçalho dele, e a regravação das cores dos
      // editados (conjunto completo da leitura) não pode apagar uma cor recém-criada. Só os VÁLIDOS vão; os pendentes ficam na
      // tela (resultado parcial).
      const { validos, pendentes } = separarNovos(novosRef.current);
      const criados: string[] = [];
      const erros: Record<string, string> = {};
      const jaExistiam: string[] = [];
      const avisosVinculo: string[] = [];
      const nomesCriados = new Set<string>();
      for (const g of validos) {
        // a RPC trataria "mesmo nome" como complementar e ATUALIZARIA o cabeçalho do que já existe: recusa aqui
        const nomeNorm = normalizeCat(g.cab.nome ?? "");
        if (insumoJaExiste(g, dados.etiquetas) || (!g.insumoAlvoId && nomesCriados.has(nomeNorm))) {
          erros[g.tmp] =
            "Já existe um insumo com este nome — use o + da linha dele para acrescentar cores.";
          continue;
        }
        try {
          const r = await salvarInsumoNovo(payloadImportar(g), vinculoDoNovo(g));
          criados.push(g.tmp);
          if (!g.insumoAlvoId) nomesCriados.add(nomeNorm);
          if (r.acao !== "criado" && !g.insumoAlvoId) jaExistiam.push(g.tmp);
          if (r.avisoVinculo) avisosVinculo.push(`${g.cab.nome ?? "insumo"}: ${r.avisoVinculo}`);
        } catch (e) {
          erros[g.tmp] = textoErroSalvar(e);
        }
      }
      // Relê a grade ANTES de liberar o próximo Salvar (a base do rascunho vem da leitura). Falha na releitura é inofensiva: o
      // refetch normal cobre. A lista da tela (`["etiquetas-cadastro"]`) também é relida ANTES de limpar o rascunho: o insumo novo
      // não pode "piscar" e sumir (o Cards e o Sheet leem outra query).
      try {
        await Promise.all([
          ...["etiquetas", "variantes"].map((k) =>
            qc.refetchQueries({ queryKey: ["insumos-grade", k] }),
          ),
          qc.refetchQueries({ queryKey: ["etiquetas-cadastro"] }),
        ]);
      } catch {
        /* a próxima leitura atualiza */
      }
      return {
        resultado,
        criados,
        erros,
        pendentes: pendentes.length,
        jaExistiam: jaExistiam.length,
        avisosVinculo,
      };
    },
    onSuccess: ({ resultado: r, criados, erros, pendentes, jaExistiam, avisosVinculo }) => {
      // grupos gravados saem do rascunho (um 2º Salvar não os reenvia); falhos e pendentes ficam, com o aviso na linha
      setNovos((l) => l.filter((g) => !criados.includes(g.tmp)));
      setErrosNovos(erros);
      setAvisosColar({}); // o que foi colado já foi para o servidor (ou ficou em linha com erro própria)
      const { tom, texto } = resultadoComNovos(r, {
        criados: criados.length,
        erros: Object.keys(erros).length,
        pendentes,
      });
      const extras: string[] = [];
      if (jaExistiam > 0)
        extras.push(
          `${jaExistiam} já existia(m) (mesmo nome): as cores foram acrescentadas ao existente.`,
        );
      extras.push(...avisosVinculo);
      const final = extras.length ? `${texto} ${extras.join(" ")}` : texto;
      if (tom === "sucesso" && extras.length === 0) toast.success(final);
      else if (tom === "sucesso" || tom === "aviso") toast.warning(final);
      else toast.error(final);
      for (const k of ["etiquetas-cadastro", "etiquetas-opts"])
        qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast.error(mensagemErro(e, "Erro ao salvar.")),
  });

  const pedirDescartar = () =>
    pedirConfirmacao({
      titulo: "Descartar alterações?",
      descricao: "Há alterações não salvas na lista de insumos.",
      confirmar: "Descartar",
      cancelar: "Continuar editando",
      destrutivo: true,
      onConfirmar: () => {
        descartarTodos();
        setNovos([]);
        setErrosNovos({});
        setAvisosColar({});
        setMostrarPendencias(false);
      },
    });

  // EXCLUIR o INSUMO cadastrado: confirmação (AlertDialog) e grava NA HORA — fora do rascunho e do Salvar. DELETE direto (não existe
  // RPC de exclusão; a FK recusa o insumo em uso, 23503, com a mensagem em PT-BR e nada é apagado). A COR não passa por aqui: a
  // lixeira dela só a tira do rascunho (o Salvar regrava as cores sem ela). Linha NOVA é só descartada na própria linha.
  const [excluindo, setExcluindo] = useState(false);
  const ocupadoRef = useRef(false);
  const excluirInsumo = useCallback<ExcluirProps["onExcluirInsumo"]>(
    ({ insumoId, insumoNome }) => {
      const sujo = !!saversRef.current.get(insumoId)?.dirty();
      pedirConfirmacao({
        titulo: `Excluir o insumo ${insumoNome} e todas as cores?`,
        descricao: (
          <>
            O insumo <strong>{insumoNome}</strong> e <strong>todas as suas cores</strong> serão
            excluídos <strong>agora</strong> (não espera o Salvar). Se ele estiver em uso (CAD,
            modelo, OC…), o sistema recusa e nada é apagado.
            {sujo ? " As alterações não salvas desta linha também serão perdidas." : ""}
          </>
        ),
        confirmar: "Excluir insumo",
        cancelar: "Cancelar",
        destrutivo: true,
        onConfirmar: () =>
          void (async () => {
            if (ocupadoRef.current) return;
            ocupadoRef.current = true;
            setExcluindo(true);
            try {
              await excluirInsumoGrade(insumoId);
              // relê a grade ANTES de seguir (a linha excluída não pode "piscar" de volta); falha na releitura é inofensiva
              try {
                await Promise.all([
                  ...QUERY_KEYS_GRADE.map((k) =>
                    qc.refetchQueries({ queryKey: ["insumos-grade", k] }),
                  ),
                  qc.refetchQueries({ queryKey: ["etiquetas-cadastro"] }),
                ]);
              } catch {
                /* a próxima leitura atualiza */
              }
              // cores novas ainda em rascunho para este insumo ficariam apontando para um insumo que não existe mais
              setNovos((l) => l.filter((g) => g.insumoAlvoId !== insumoId));
              toast.success("Insumo excluído.");
              for (const k of ["etiquetas-cadastro", "etiquetas-opts"])
                qc.invalidateQueries({ queryKey: [k] });
            } catch (e) {
              toast.error(textoErroExcluir(e));
            } finally {
              ocupadoRef.current = false;
              setExcluindo(false);
            }
          })(),
      });
    },
    [pedirConfirmacao, qc],
  );
  const excluir = useMemo<ExcluirProps>(
    () => ({
      onExcluirInsumo: excluirInsumo,
      ocupado: excluindo || salvarMut.isPending,
    }),
    [excluirInsumo, excluindo, salvarMut.isPending],
  );

  const { nInsumos, nCores } = useMemo(
    () => ({
      nInsumos: new Set(linhas.map((l) => l.insumoId)).size,
      nCores: linhas.filter((l) => l.bloco).length,
    }),
    [linhas],
  );
  const barraVisivel = !readOnly && (nTotal > 0 || salvarMut.isPending);
  // Erro honesto: nunca mostrar "vazio" quando a leitura falhou. Com rascunho em edição a tabela fica (não perder o que
  // foi digitado); sem rascunho, só o aviso.
  const mostrarTabela = !isMobile && !dados.isLoading && (!dados.isError || nTotal > 0);

  return (
    <div className={barraVisivel ? "space-y-3 pb-24" : "space-y-3"} data-testid="insumos-grade-aba">
      {/* Contagem só com dado confiável: carregando ou com erro, "0 insumos" seria mentira (C3). */}
      {!dados.isLoading && !dados.isError && (
        <Card className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
          <Badge variant="secondary">{nInsumos}</Badge>
          {nInsumos === 1 ? "insumo" : "insumos"} ·<Badge variant="secondary">{nCores}</Badge>
          {nCores === 1 ? "cor" : "cores"}
          <UnsavedIndicator show={nTotal > 0} className="ml-auto shrink-0" />
        </Card>
      )}

      {dados.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span>Não foi possível carregar a lista de insumos.</span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={dados.recarregando}
            onClick={() => void dados.recarregar()}
          >
            {dados.recarregando ? "Tentando…" : "Tentar de novo"}
          </Button>
        </div>
      )}

      {dados.isLoading && (
        <div className="py-12 text-center text-muted-foreground">
          <Loader2 className="mr-2 inline h-5 w-5 animate-spin" />
          Carregando…
        </div>
      )}

      {mostrarTabela && (
        <InsumosGradeTabela
          linhas={linhas}
          blocosPorEtiqueta={dados.blocosPorEtiqueta}
          opcoes={dados.opcoes}
          readOnly={readOnly}
          registrar={registrar}
          colar={colar}
          excluir={excluir}
          ordenacao={ordenacao}
          novos={{
            novos,
            mostrarPendencias,
            errosNovos,
            onAtualizarNovo: atualizarNovo,
            onRemoverNovo: removerNovo,
            onNovoInsumo: adicionarInsumo,
            onNovaCor: adicionarCor,
          }}
        />
      )}

      {barraVisivel && (
        <PageActionBar>
          <Button
            type="button"
            variant="outline"
            disabled={salvarMut.isPending}
            onClick={pedirDescartar}
          >
            <Undo2 className="mr-1 h-4 w-4" /> Descartar alterações
          </Button>
          <Button
            type="button"
            className="ml-auto"
            disabled={salvarMut.isPending || excluindo || nTotal === 0}
            onClick={() => {
              setMostrarPendencias(true);
              salvarMut.mutate();
            }}
          >
            {salvarMut.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            Salvar{nTotal > 0 ? ` (${nTotal})` : ""}
          </Button>
        </PageActionBar>
      )}

      {dialogConfirmacao}
      <UnsavedChangesGuard
        confirm={confirm}
        message="Há alterações não salvas na lista de insumos."
      />
    </div>
  );
}
