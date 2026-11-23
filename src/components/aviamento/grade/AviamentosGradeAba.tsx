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
import { COLUNAS_AVIAMENTO, byKey } from "@/lib/aviamento-grade/colunas";
import { CAMPO_AVIAMENTO, opcoesDaColuna } from "@/lib/aviamento-grade/celulas";
import { ordenarLinhasPorColuna } from "@/lib/aviamento-grade/ordenar";
import {
  agruparNovosAviamentos,
  camposDaCor,
  camposDoAviamento,
  ehBlocoColavel,
  mapearColagem,
  montarLookupsColagem,
  parseBlocoTsv,
  resumoColagem,
  type PatchColagem,
} from "@/lib/aviamento-grade/colar-tsv";
import { chaveSlotNovo, montarSlots, recusaDoSlot } from "@/lib/aviamento-grade/colar-slots";
import {
  adicionarCoresAoGrupo,
  aviamentoJaExiste,
  aviamentoNovoVazio,
  corNovaEmExistente,
  semCategoria,
  separarNovos,
  type AviamentoNovo,
} from "@/lib/aviamento-grade/linha-nova";
import {
  QUERY_KEYS_GRADE,
  excluirAviamentoGrade,
  excluirVarianteGrade,
  textoErroExcluir,
} from "@/lib/aviamento-grade/excluir";
import {
  montarLinhas,
  type AviamentoEntrada,
  type ResolverRotulo,
} from "@/lib/aviamento-grade/linhas";
import {
  resultadoComNovos,
  salvarAviamentoNovo,
  salvarEmOrdem,
  textoErroSalvar,
  type ItemAviamento,
  type ItemVariante,
} from "@/lib/aviamento-grade/salvar";
import {
  AviamentosGradeTabela,
  type ColarProps,
  type ExcluirProps,
  type OrdenacaoProps,
  type RegistrarSaver,
  type SaverApi,
} from "./AviamentosGradeTabela";
import type { AtualizarNovo } from "./AviamentoNovoGrupo";
import { useAviamentosGrade } from "./useAviamentosGrade";

export interface AviamentosGradeAbaProps {
  /** Aviamentos já filtrados pela tela (a grade mostra só estes, na mesma ordem). Sem a prop, mostra todos os da loja. */
  aviamentos?: { id: string }[];
  isMobile?: boolean;
  /**
   * Avisa a tela-mãe quando há rascunho não salvo. A tela usa isto para pedir confirmação ANTES de trocar de visão (Cards) ou de
   * filtro/busca — senão a grade desmonta e o rascunho se perde calado. Ao desmontar avisa `false`.
   */
  onDirtyChange?: (sujo: boolean) => void;
}

/**
 * Aba "Lista tipo Excel" do Cadastro > Aviamentos: a GRADE EDITÁVEL (1 linha-pai por aviamento + 1 linha por cor, nascem recolhidas).
 * Editar só mexe em RASCUNHO (selo âmbar); NADA grava antes do Salvar. UM Salvar grava os cabeçalhos (UPDATE direto, "último vence":
 * aviamento não tem `rev`) e depois as cores (UMA chamada de lote `salvar_variantes_aviamento` por aviamento tocado, com o conjunto
 * completo), com resultado parcial. A foto da cor grava NA HORA (binário). Também CRIA: "+ Novo aviamento" / "+ adicionar variante (cor)"
 * montam linhas NOVAS em rascunho (estado desta aba, não do servidor) que o MESMO Salvar manda por `importar_aviamento_linha`, depois
 * dos editados; linha nova incompleta fica PENDENTE (em vermelho) e não trava as válidas. COLAR do Excel (Ctrl+V de um bloco TSV numa
 * célula) vira rascunho a partir da célula-âncora (cor/fornecedor/categoria/… pelo NOME; texto sem correspondência NÃO grava e avisa
 * na célula); linhas além do fim criam aviamentos novos. EXCLUIR (lixeira única por linha) grava NA HORA, atrás de confirmação.
 */
export function AviamentosGradeAba(props: AviamentosGradeAbaProps) {
  return (
    <CardDraftsProvider>
      <AviamentosGradeConteudo
        aviamentos={props.aviamentos}
        isMobile={props.isMobile}
        onDirtyChange={props.onDirtyChange}
      />
    </CardDraftsProvider>
  );
}

function AviamentosGradeConteudo({ aviamentos, isMobile, onDirtyChange }: AviamentosGradeAbaProps) {
  const qc = useQueryClient();
  const dados = useAviamentosGrade();
  const readOnly = useReadOnly();
  const { nSujos, descartarTodos } = useCardDrafts();
  const { pedir: pedirConfirmacao, dialog: dialogConfirmacao } = useConfirmacao();

  // Linhas NOVAS (aviamento novo / cor nova): rascunho só desta aba. Nada grava antes do Salvar.
  const [novos, setNovos] = useState<AviamentoNovo[]>([]);
  const [errosNovos, setErrosNovos] = useState<Record<string, string>>({});
  // Depois de tentar salvar, os pendentes (faltam dados) ficam em vermelho; antes disso uma linha recém-criada não "grita".
  const [mostrarPendencias, setMostrarPendencias] = useState(false);
  const novosRef = useRef(novos);
  novosRef.current = novos;
  // Avisos da última colagem (texto que não foi aplicado), por célula `<linha>|<coluna>`. Somem ao editar a célula.
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
  const adicionarAviamento = useCallback(() => setNovos((l) => [...l, aviamentoNovoVazio()]), []);
  // 1 grupo de cor nova por aviamento existente (as próximas cores entram nele por "+ adicionar variante")
  const adicionarCor = useCallback(
    (aviamentoId: string, nome: string) =>
      setNovos((l) =>
        l.some((g) => g.aviamentoAlvoId === aviamentoId)
          ? l
          : [...l, corNovaEmExistente(aviamentoId, nome)],
      ),
    [],
  );
  // Multi-cor da linha-pai de um aviamento EXISTENTE: cada cor marcada vira uma cor nova (preço herdado do aviamento), no grupo de
  // cores novas dele (que nasce aqui se ainda não existe). Só ADICIONA; cor que o grupo já tem não duplica. Rascunho: nada grava.
  const adicionarCores = useCallback(
    (aviamentoId: string, nome: string, corIds: string[], preco: number | null) => {
      setNovos((l) => {
        const i = l.findIndex((g) => g.aviamentoAlvoId === aviamentoId);
        const base = i >= 0 ? l[i] : corNovaEmExistente(aviamentoId, nome);
        const prox = adicionarCoresAoGrupo(base, corIds, preco);
        if (i >= 0) return prox === base ? l : l.map((g, j) => (j === i ? prox : g));
        return prox.vars.some((v) => !!v.cor_id) ? [...l, prox] : l;
      });
    },
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

  // Cada rascunho (aviamento ou cor) se registra aqui: o Salvar grava os aviamentos ANTES das cores, na ordem que ESTE wrapper
  // define (a ordem de montagem do registry não serve: os filhos registram antes do pai).
  const saversRef = useRef(new Map<string, SaverApi>());
  const registrar = useCallback<RegistrarSaver>((id, api) => {
    saversRef.current.set(id, api);
    return () => {
      if (saversRef.current.get(id) === api) saversRef.current.delete(id);
    };
  }, []);

  // A tela passa os aviamentos JÁ filtrados/ordenados; os dados completos (variantes, ncm, observações…) vêm da query da grade.
  const linhasServidor = useMemo(() => {
    const porId = new Map(dados.aviamentos.map((a) => [a.id, a]));
    const ids = aviamentos ? aviamentos.map((a) => a.id) : dados.aviamentos.map((a) => a.id);
    const entradas: AviamentoEntrada[] = [];
    for (const id of ids) {
      const g = porId.get(id);
      if (g) entradas.push(g);
    }
    return montarLinhas(entradas, dados.variantesPorAviamento);
  }, [aviamentos, dados.aviamentos, dados.variantesPorAviamento]);

  // ORDENAÇÃO por coluna (clicar no cabeçalho: asc → desc). Sem clique = a ordem que a tela entregou. Ordena os GRUPOS (aviamentos)
  // pelo valor SALVO, nunca pelo rascunho, e deixa as cores de um aviamento juntas (ver `aviamento-grade/ordenar.ts`).
  const [ord, setOrd] = useState<{ key: string; dir: SortDir } | null>(null);
  const alternarOrdem = useCallback(
    (key: string) =>
      setOrd((o) =>
        o?.key === key ? { key, dir: o.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
      ),
    [],
  );
  // coluna de seleção guarda ID; ordena pelo NOME mostrado (fornecedor, categoria, subcategoria, material, intervalo, cor base/apelido)
  const rotulos = useMemo(() => {
    const mapa = new Map<string, Map<string, string>>();
    for (const k of [
      "fornecedor",
      "categoria",
      "subcategoria",
      "material",
      "intervalo_largura",
      "cor_base",
      "cor_apelido",
    ]) {
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
  // novas e cria aviamentos novos para as linhas que passam do fim. Nada grava antes do Salvar. `false` = não é bloco (colar normal).
  const aoColar = useCallback<ColarProps["onColar"]>(
    ({ chaveLinha: chaveDaLinha, colKey, texto }) => {
      const bloco = parseBlocoTsv(texto);
      if (!ehBlocoColavel(texto, bloco)) return false;
      const slots = montarSlots(linhasRef.current, novosRef.current);
      const linhaIdx = slots.findIndex((sl) => sl.chave === chaveDaLinha);
      const colIdx = COLUNAS_AVIAMENTO.findIndex((c) => c.key === colKey);
      if (linhaIdx < 0 || colIdx < 0) return false;
      const opcoes = opcoesRef.current;
      const lookups = montarLookupsColagem(opcoes);
      const apelidos = opcoes.coresApelido;
      const savers = saversRef.current;
      const novosAtuais = novosRef.current;

      // o que a linha JÁ tem (apelido depende da cor base; subcategoria, da categoria)
      const corDoSlot = (i: number): { cor_id: string; cor_apelido_id: string } => {
        const sl = slots[i];
        if (sl.tipo === "existente") {
          const v = sl.varianteId ? savers.get(sl.varianteId)?.ler() : undefined;
          return {
            cor_id: String(v?.cor_id ?? ""),
            cor_apelido_id: String(v?.cor_apelido_id ?? ""),
          };
        }
        const cor = novosAtuais
          .find((g) => g.tmp === sl.grupoTmp)
          ?.vars.find((x) => x.tmp === sl.varTmp);
        return { cor_id: cor?.cor_id ?? "", cor_apelido_id: cor?.cor_apelido_id ?? "" };
      };
      /** O cabeçalho (rascunho) do aviamento a que a linha pertence. */
      const cabecalhoDoSlot = (i: number): Record<string, unknown> => {
        const sl = slots[i];
        if (sl.tipo === "existente") return savers.get(sl.aviamentoId)?.ler() ?? {};
        return (novosAtuais.find((g) => g.tmp === sl.grupoTmp)?.cab ?? {}) as Record<
          string,
          unknown
        >;
      };

      const res = mapearColagem({ linhaIdx, colIdx }, bloco, COLUNAS_AVIAMENTO, slots.length, {
        lookups,
        contextoLinha: (i) => ({
          corId: corDoSlot(i).cor_id,
          categoriaId: String(cabecalhoDoSlot(i).categoria_aviamento_id ?? ""),
        }),
        aceitaCelula: (i, key) => recusaDoSlot(slots[i], byKey(key) ?? { escopo: "aviamento" }),
      });

      // 1) linhas que já existem: um lote de campos por aviamento e por cor (cor base antes do apelido, na ordem da grade)
      const porLinha = new Map<number, PatchColagem[]>();
      for (const pc of res.patches)
        porLinha.set(pc.linhaIdx, [...(porLinha.get(pc.linhaIdx) ?? []), pc]);
      for (const [i, ps] of porLinha) {
        const sl = slots[i];
        const campoAviamento: Record<string, unknown> = {};
        const campoCor: Record<string, unknown> = {};
        let cor = corDoSlot(i);
        const cab0 = cabecalhoDoSlot(i);
        // fornecedor/categoria colados na MESMA linha se afetam (representante, subcategoria): segue o que já foi aplicado
        let atual = {
          empresa_id: (cab0.empresa_id as string | null) ?? null,
          representante_id: (cab0.representante_id as string | null) ?? null,
          subcategoria_aviamento_id: (cab0.subcategoria_aviamento_id as string | null) ?? null,
        };
        for (const pc of ps) {
          const col = byKey(pc.colKey);
          if (!col) continue;
          if (col.escopo === "aviamento") {
            if (!CAMPO_AVIAMENTO[col.key]) continue;
            const c = camposDoAviamento(col.key, pc.valor, atual, opcoes.subcategorias);
            Object.assign(campoAviamento, c);
            atual = { ...atual, ...(c as Partial<typeof atual>) };
          } else {
            const c = camposDaCor(col.key, pc.valor, cor, apelidos);
            Object.assign(campoCor, c);
            cor = { ...cor, ...(c as Partial<typeof cor>) };
          }
        }
        if (sl.tipo === "existente") {
          if (Object.keys(campoAviamento).length)
            savers.get(sl.aviamentoId)?.aplicar(campoAviamento);
          if (sl.varianteId && Object.keys(campoCor).length)
            savers.get(sl.varianteId)?.aplicar(campoCor);
        } else {
          setNovos((l) =>
            l.map((g) =>
              g.tmp !== sl.grupoTmp
                ? g
                : {
                    ...g,
                    cab: { ...g.cab, ...campoAviamento },
                    vars: g.vars.map((v) => (v.tmp === sl.varTmp ? { ...v, ...campoCor } : v)),
                  },
            ),
          );
          limparErroNovo(sl.grupoTmp);
        }
      }

      // 2) linhas além do fim = aviamentos novos (linhas seguidas com o mesmo nome são cores do mesmo aviamento)
      const {
        grupos,
        varTmpPorLinha,
        avisos: avisosNovos,
      } = agruparNovosAviamentos(res.novasLinhas, apelidos);
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
      const itens = Array.from(saversRef.current.entries());
      const aviamentosSujos: ItemAviamento[] = [];
      const variantesSujas: ItemVariante[] = [];
      for (const [id, api] of itens) {
        if (api.kind === "aviamento")
          aviamentosSujos.push({ id, dirty: api.dirty, salvar: api.salvar });
        else
          variantesSujas.push({
            id,
            aviamentoId: api.aviamentoId,
            dirty: api.dirty,
            mudancas: api.mudancas,
            salvar: api.salvar,
          });
      }
      const resultado = await salvarEmOrdem(aviamentosSujos, variantesSujas, ctx);
      // NOVOS depois dos editados: acrescentar cor a um aviamento que existe não mexe no cabeçalho dele, e o lote de cores dos
      // editados (releitura fresca + conjunto completo) não pode apagar uma cor recém-criada. Só os VÁLIDOS vão; os pendentes ficam
      // na tela (resultado parcial).
      const { validos, pendentes } = separarNovos(novosRef.current);
      const criados: string[] = [];
      const erros: Record<string, string> = {};
      const jaExistiam: string[] = [];
      let semCodigo = 0;
      for (const g of validos) {
        // a RPC trataria "mesmo nome + mesmo fornecedor" como complementar e ATUALIZARIA o cabeçalho do que já existe: recusa aqui
        if (aviamentoJaExiste(g, dados.aviamentos)) {
          erros[g.tmp] =
            "Já existe um aviamento com este nome e fornecedor — use o + da linha dele para acrescentar cores.";
          continue;
        }
        try {
          const acao = await salvarAviamentoNovo(g);
          criados.push(g.tmp);
          if (acao !== "criado" && !g.aviamentoAlvoId) jaExistiam.push(g.tmp);
          if (semCategoria(g)) semCodigo++;
        } catch (e) {
          erros[g.tmp] = textoErroSalvar(e);
        }
      }
      // Relê a grade ANTES de liberar o próximo Salvar (a base do rascunho vem da leitura). Falha na releitura é inofensiva: o
      // refetch normal cobre. A lista da tela (`["aviamentos"]`) também é relida ANTES de limpar o rascunho: o aviamento novo não
      // pode "piscar" e sumir.
      try {
        await Promise.all([
          ...["aviamentos", "variantes"].map((k) =>
            qc.refetchQueries({ queryKey: ["aviamentos-grade", k] }),
          ),
          qc.refetchQueries({ queryKey: ["aviamentos"] }),
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
        semCodigo,
      };
    },
    onSuccess: ({ resultado: r, criados, erros, pendentes, jaExistiam, semCodigo }) => {
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
          `${jaExistiam} já existia(m) (mesmo nome e fornecedor): as cores foram acrescentadas ao existente.`,
        );
      if (semCodigo > 0)
        extras.push(
          `${semCodigo} criado(s) sem categoria: ficam sem código (o código nasce da categoria).`,
        );
      const final = extras.length ? `${texto} ${extras.join(" ")}` : texto;
      if (tom === "sucesso" && extras.length === 0) toast.success(final);
      else if (tom === "sucesso" || tom === "aviso") toast.warning(final);
      else toast.error(final);
      // A visão Cards e o Sheet leem outras queries: marca como velhas (a grade já foi relida acima).
      for (const k of ["aviamentos", "aviamentos-variantes"])
        qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast.error(mensagemErro(e, "Erro ao salvar.")),
  });

  const pedirDescartar = () =>
    pedirConfirmacao({
      titulo: "Descartar alterações?",
      descricao: "Há alterações não salvas na lista de aviamentos.",
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

  // EXCLUIR o que já está cadastrado (cor ou aviamento): confirmação (AlertDialog) e grava NA HORA — fora do rascunho e do Salvar.
  // Cor = RPC com guarda (`excluir_variante_aviamento`); aviamento = DELETE direto (a FK recusa se estiver em uso, 23503). Em uso =
  // a mensagem em PT-BR aparece e nada é apagado. Linha NOVA (rascunho) não passa por aqui: é só descartada na própria linha.
  const [excluindo, setExcluindo] = useState(false);
  const ocupadoRef = useRef(false);
  const executarExclusao = useCallback(
    async (acao: () => Promise<void>, sucesso: string, aposOk?: () => void) => {
      if (ocupadoRef.current) return;
      ocupadoRef.current = true;
      setExcluindo(true);
      try {
        await acao();
        // relê a grade ANTES de seguir (a linha excluída não pode "piscar" de volta); falha na releitura é inofensiva
        try {
          await Promise.all([
            ...QUERY_KEYS_GRADE.map((k) =>
              qc.refetchQueries({ queryKey: ["aviamentos-grade", k] }),
            ),
            qc.refetchQueries({ queryKey: ["aviamentos"] }),
          ]);
        } catch {
          /* a próxima leitura atualiza */
        }
        aposOk?.();
        toast.success(sucesso);
        for (const k of ["aviamentos", "aviamentos-variantes"])
          qc.invalidateQueries({ queryKey: [k] });
      } catch (e) {
        toast.error(textoErroExcluir(e));
      } finally {
        ocupadoRef.current = false;
        setExcluindo(false);
      }
    },
    [qc],
  );
  const excluirCor = useCallback<ExcluirProps["onExcluirCor"]>(
    ({ aviamentoNome, varianteId, corRotulo }) => {
      const sujo = !!saversRef.current.get(varianteId)?.dirty();
      pedirConfirmacao({
        titulo: `Excluir a cor ${corRotulo}?`,
        descricao: (
          <>
            A cor <strong>{corRotulo}</strong> do aviamento <strong>{aviamentoNome}</strong> será
            excluída <strong>agora</strong> (não espera o Salvar). Se ela estiver em uso (OC,
            modelo, CAD, ordem de saída…), o sistema recusa e nada é apagado.
            {sujo ? " As alterações não salvas desta linha também serão perdidas." : ""}
          </>
        ),
        confirmar: "Excluir cor",
        cancelar: "Cancelar",
        destrutivo: true,
        onConfirmar: () =>
          void executarExclusao(() => excluirVarianteGrade(varianteId), "Cor excluída."),
      });
    },
    [pedirConfirmacao, executarExclusao],
  );
  const excluirAviamento = useCallback<ExcluirProps["onExcluirAviamento"]>(
    ({ aviamentoId, aviamentoNome }) => {
      pedirConfirmacao({
        titulo: `Excluir o aviamento ${aviamentoNome} e todas as cores?`,
        descricao: (
          <>
            O aviamento <strong>{aviamentoNome}</strong> e <strong>todas as suas cores</strong>{" "}
            serão excluídos <strong>agora</strong> (não espera o Salvar). Se ele estiver em uso (OC,
            modelo, CAD, ordem de saída…), o sistema recusa e nada é apagado.
          </>
        ),
        confirmar: "Excluir aviamento",
        cancelar: "Cancelar",
        destrutivo: true,
        onConfirmar: () =>
          void executarExclusao(
            () =>
              excluirAviamentoGrade({
                id: aviamentoId,
                fotoUrl: dados.aviamentos.find((a) => a.id === aviamentoId)?.foto_url ?? null,
                fotosCores: (dados.variantesPorAviamento.get(aviamentoId) ?? []).map(
                  (v) => v.foto_url,
                ),
              }),
            "Aviamento excluído.",
            // cores novas ainda em rascunho para este aviamento ficariam apontando para um aviamento que não existe mais
            () => setNovos((l) => l.filter((g) => g.aviamentoAlvoId !== aviamentoId)),
          ),
      });
    },
    [pedirConfirmacao, executarExclusao, dados.aviamentos, dados.variantesPorAviamento],
  );
  const excluir = useMemo<ExcluirProps>(
    () => ({
      onExcluirCor: excluirCor,
      onExcluirAviamento: excluirAviamento,
      ocupado: excluindo || salvarMut.isPending,
    }),
    [excluirCor, excluirAviamento, excluindo, salvarMut.isPending],
  );

  const { nAviamentos, nVariantes } = useMemo(
    () => ({
      nAviamentos: new Set(linhas.map((l) => l.aviamentoId)).size,
      nVariantes: linhas.filter((l) => l.variante).length,
    }),
    [linhas],
  );
  const barraVisivel = !readOnly && (nTotal > 0 || salvarMut.isPending);
  // Erro honesto: nunca mostrar "vazio" quando a leitura falhou. Com rascunho em edição a tabela fica (não perder o que
  // foi digitado); sem rascunho, só o aviso.
  const mostrarTabela = !isMobile && !dados.isLoading && (!dados.isError || nTotal > 0);

  return (
    <div
      className={barraVisivel ? "space-y-3 pb-24" : "space-y-3"}
      data-testid="aviamentos-grade-aba"
    >
      <Card className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
        <Badge variant="secondary">{nAviamentos}</Badge>
        {nAviamentos === 1 ? "aviamento" : "aviamentos"} ·
        <Badge variant="secondary">{nVariantes}</Badge>
        {nVariantes === 1 ? "variante" : "variantes"}
        <UnsavedIndicator show={nTotal > 0} className="ml-auto shrink-0" />
      </Card>

      {dados.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span>Não foi possível carregar a lista de aviamentos.</span>
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
        <AviamentosGradeTabela
          linhas={linhas}
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
            onNovoAviamento: adicionarAviamento,
            onNovaCor: adicionarCor,
            onAdicionarCores: adicionarCores,
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
        message="Há alterações não salvas na lista de aviamentos."
      />
    </div>
  );
}
