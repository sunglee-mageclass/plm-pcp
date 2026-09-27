// Integração — aba Produtos (spec §6, mockup 2). Situação (padrão "Não integrados") + coleção/etapa/origem/estado + busca;
// páginas de 50; células editáveis enquanto "não integrável" (rascunho por produto — só o Salvar grava; rev/P0409 + merge
// 3-vias com o que chega do servidor). Estados (integrar/voltar/desfazer): Task 13. Celular: sem esta tela (P-87 — Task 18).
//
// Adaptações do controlador sobre o brief da Task 12b (ver task-12b-report.md):
// - Sobra do rascunho depois do Salvar (revisão T11 I2, carry.md): montada a partir do ESTADO ATUAL do rascunho (não do
//   que foi ENVIADO — outra digitação pode ter chegado durante o Salvar), nunca baixa `rev` (Math.max em
//   `aposSalvar`/`mesclar`, rascunho.ts), e RE-MESCLA contra a lista em CACHE — chave por PREFIXO
//   (`qc.getQueriesData({ queryKey: chaveLista(tenantId) })`, cobre TODAS as páginas/filtros/situações da loja em
//   cache), não a chave EXATA de 2 elementos (que nunca bate com a query real, de 5 elementos — Fix round 1 T12b,
//   revisão A-I1(a)/B-I4(a)).
// - Props ESTÁVEIS para o React.memo das linhas (achado do code-review da T12a + Fix round 1 T12b A-I2/B-I6): o
//   rascunho de um produto SEM entrada em `rascunhos` é memoizado POR (id, rev); `atualizar`, `estadoCelula`, `onFotos`
//   E `onKeywords` são `useCallback` — o `onKeywords` inline do round anterior derrubava o memo de TODAS as linhas a
//   cada tecla (o estado `rascunhos` mora neste componente).
// - Rascunho escondido (D36, Fix round 1 T12b A-I6/B-I2): um produto fora da página atual (renomeado, filtrado,
//   trocou de loja) nunca fica invisível — a faixa "N alterações em produtos fora desta página" lista cada um
//   por nome, com "descartar" e "mostrar" (busca pelo REF/nome + reseta filtros pra achar o produto de novo).
// - Diálogo de fotos por ID (Fix round 1 T12b B-I1): guarda só `fotosDeId`, deriva o produto da lista ATUAL a cada
//   render — nunca um snapshot velho que nasceria um rascunho com rev/base desatualizados.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { InfoHover } from "@/components/shared/InfoHover";
import { PageActionBar } from "@/components/shared/PageActionBar";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { mensagemErro } from "@/lib/erro-mensagem";
import { TEXTO_MAO_DUPLA } from "@/lib/integracao/campos";
import {
  FILTROS_VAZIOS, ROTULO_ESTADO, ROTULO_ORIGEM, acoesEmMassa, faixaPagina, motivoIntegrar, motivoVoltar, totalPaginas,
  type EstadoIntegracao, type Filtros, type ListaIntegracao, type ProdutoLista, type Situacao,
} from "@/lib/integracao/produtos";
import { mesclar, novoRascunho, resultadoPosSalvar, temAlteracao, validarRascunho, type EsperaAguardando, type Rascunho } from "@/lib/integracao/rascunho";
import { useAbaSuja } from "./guard";
import { chaveLista, useIntegracaoAoVivo, useIntegracaoLista, usePreviasSkus, useSalvarIntegracao } from "./useIntegracao";
import { ProdutosTabela } from "./ProdutosTabela";
import { FotosDialog } from "./FotosDialog";
import { KeywordsDialog } from "./KeywordsDialog";
import { EstadoCelula, IntegravelCelula } from "./EstadoLinha";
import { IntegrarDialog } from "./IntegrarDialog";
import { VoltarDialog } from "./VoltarDialog";
import { DesfazerDialog } from "./DesfazerDialog";

const TODOS = "__todos__";
const SITUACOES: { key: Situacao; rotulo: string }[] = [
  { key: "nao_integrados", rotulo: "Não integrados" },
  { key: "integrados", rotulo: "Integrados" },
  { key: "todos", rotulo: "Todos" },
];
const TEXTO_ESTADO_DENTRO =
  'Estado filtra DENTRO da Situação escolhida acima (ex.: Situação "Não integrados" + Estado "Integrável" mostra só quem já está integrável, ainda não integrado).';
const TEXTO_TRAVA_FILTRO = "Salve ou descarte as alterações antes de trocar de filtro ou de página.";

function FiltroSelect({ id, rotulo, valor, opcoes, desabilitado, info, onMudar }: {
  id: string; rotulo: string; valor: string | null; opcoes: { key: string; label: string }[]; desabilitado: boolean;
  info?: string; onMudar: (v: string | null) => void;
}) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-1">
        <Label htmlFor={id}>{rotulo}</Label>
        {info && <InfoHover ariaLabel={`Sobre o filtro ${rotulo}`}>{info}</InfoHover>}
      </div>
      <Select value={valor ?? TODOS} disabled={desabilitado} onValueChange={(v) => onMudar(v === TODOS ? null : v)}>
        <SelectTrigger id={id} title={desabilitado ? TEXTO_TRAVA_FILTRO : undefined}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Todos</SelectItem>
          {opcoes.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/** m2 (revisão): junta as listas de TODAS as páginas/filtros/situações em cache desta loja (a chave é por PREFIXO —
 *  `chaveLista(tenantId)` tem 2 elementos, a query real tem 5) num único mapa id→produto MAIS RECENTE (maior rev).
 *  Usado tanto pela re-mesclagem da sobra pós-Salvar (I1/I4) quanto para achar um produto "escondido" fora da
 *  página atual sem precisar de uma nova RPC. */
function produtosEmCache(
  qc: ReturnType<typeof useQueryClient>,
  tenantId: string,
): Map<string, ProdutoLista> {
  const pares = qc.getQueriesData<ListaIntegracao>({ queryKey: chaveLista(tenantId) });
  const mapa = new Map<string, ProdutoLista>();
  for (const [, dado] of pares) {
    if (!dado) continue;
    for (const p of dado.produtos) {
      const atual = mapa.get(p.modeloId);
      if (!atual || p.rev > atual.rev) mapa.set(p.modeloId, p);
    }
  }
  return mapa;
}

export function ProdutosAba() {
  const router = useRouter();
  const tz = useStoreTimezone();
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const [situacao, setSituacao] = useState<Situacao>("nao_integrados");
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [rascunhos, setRascunhos] = useState<Record<string, Rascunho>>({});
  const rascunhosRef = useRef(rascunhos);
  rascunhosRef.current = rascunhos;
  // Fix round 1 T12b (B-I1) — guarda só o ID; o produto é derivado da lista ATUAL a cada render (ver `pFotos` abaixo).
  const [fotosDeId, setFotosDeId] = useState<string | null>(null);
  const [keywordsAberto, setKeywordsAberto] = useState(false);
  const [selecionados, setSelecionados] = useState<ReadonlySet<string>>(new Set());
  const [integrarIds, setIntegrarIds] = useState<string[] | null>(null);
  // Fix round 1 T13 (revisão T13 #5, code-review Important I1 — "Voltar entra em laço no P0409"): guarda só os IDS
  // (não mais `{id,nome}` capturado no clique) — os PRODUTOS são derivados da lista ATUAL a cada render (o mesmo
  // padrão de `pFotos`/`fotosDeId`, ver abaixo). Antes, `VoltarDialog` recebia um snapshot fixo de produtos; se o
  // `integracao_voltar` desse P0409 (outra pessoa já integrou ou voltou ALGUM do lote), o diálogo continuava aberto
  // com o MESMO snapshot — reclicar reenviava os MESMOS ids e recebia o MESMO P0409, um laço garantido (a única
  // saída era Cancelar). Derivando da lista atual, o diálogo ENCOLHE sozinho para os produtos que continuam
  // `integravel` assim que a invalidação (que já rodava no erro) traz a lista fresca, e fecha se não sobrar nenhum.
  const [voltarIds, setVoltarIds] = useState<string[] | null>(null);
  const [desfazerDe, setDesfazerDe] = useState<ProdutoLista | null>(null);
  // m7 (revisão): o texto sujo do diálogo de Keywords também soma na guarda ÚNICA da página — sem isso, "Voltar" do
  // navegador ou F5 com o diálogo aberto e texto digitado saía sem perguntar (a guarda só olhava `rascunhos`).
  const [keywordsSujo, setKeywordsSujo] = useState(false);
  // Fix round 2 T12b (R1/R-I1): ids já avisados por "descartadas" — o efeito de merge roda de novo a cada
  // `q.dataUpdatedAt` (B-I1), então sem isso o MESMO produto tocaria o toast a cada relista idêntica enquanto seu
  // id continuar em `rascunhosRef.current` por qualquer razão (não deveria, mas o aviso é 1x por produto de
  // qualquer forma — nunca depende de o id ainda existir ou não em `rascunhos`).
  const avisadosDescarte = useRef<Set<string>>(new Set());
  // Fix round 2 T12b (R3/ruling B-I3, nunca implementado antes): depois de um Salvar bem-sucedido SEM sobra (tudo
  // gravou), a lista em cache só reflete o valor novo depois do refetch de `onSettled` (useIntegracao.ts) — uma
  // janela de alguns segundos em que `lista.produtos` (e portanto `rascunhoDe`/as células) ainda mostram os
  // valores VELHOS. Sem essa "espera", 2 problemas: (1) a célula pisca de volta pro valor anterior por um
  // instante; (2) se o usuário digitar de novo NESSA janela, o novo rascunho nasceria com `base`/`rev` do produto
  // AINDA VELHO da lista — um Salvar imediato levaria o `rev` errado (P0409/conflito falso contra si mesmo). Este
  // mapa guarda, por produto, os valores E o rev que ACABARAM de ser salvos; enquanto `salvosAguardando[id]`
  // existir, todo lugar que monta um Rascunho novo (rascunhoDe → novoRascunho) usa ESSES valores/rev em vez dos da
  // lista em cache — nunca o `lista.produtos.find(...)` puro. Cai sozinho (limpo no efeito de merge) assim que a
  // relista mostra `p.rev >= aguardando.rev` — o servidor finalmente alcançou.
  const [salvosAguardando, setSalvosAguardando] = useState<Record<string, EsperaAguardando>>({});
  const salvosAguardandoRef = useRef(salvosAguardando);
  salvosAguardandoRef.current = salvosAguardando;
  // Substitui `raw`/`rev` do produto pelos valores SALVOS enquanto a espera durar — nunca o inverso (a lista em
  // cache vence assim que alcança ou ultrapassa o rev salvo; ver a limpeza no efeito de merge abaixo).
  const produtoComHold = useCallback(
    (p: ProdutoLista): ProdutoLista => {
      const aguardando = salvosAguardando[p.modeloId];
      if (!aguardando || aguardando.rev < p.rev) return p;
      return {
        ...p,
        rev: aguardando.rev,
        raw: { ...p.raw, ...aguardando.valores, tamanho_tipo: p.raw.tamanho_tipo },
      };
    },
    [salvosAguardando],
  );
  const q = useIntegracaoLista(situacao, filtros, pagina);
  const idsPagina = useMemo(() => (q.data?.produtos ?? []).map((p) => p.modeloId), [q.data]);
  useIntegracaoAoVivo(idsPagina);
  const salvar = useSalvarIntegracao();
  const lista = q.data;
  const sujos = useMemo(() => Object.values(rascunhos).filter(temAlteracao), [rascunhos]);
  // `sujoLinhas` governa o botão Salvar/onSalvar da PÁGINA (só as linhas da tabela); `sujo` (guarda/trava de
  // filtro) também soma o texto pendente do diálogo de Keywords — os dois têm saves INDEPENDENTES (o Keywords
  // salva pelo botão do próprio diálogo), mas os DOIS precisam travar navegação/filtro enquanto há algo pendente.
  const sujoLinhas = sujos.length > 0;
  const sujo = sujoLinhas || keywordsSujo;
  useAbaSuja("produtos", sujo);
  const previas = usePreviasSkus(sujos, lista?.pode.editar ?? false);
  const travaFiltro = sujo || salvar.isPending;
  useEffect(() => { setSelecionados(new Set()); }, [situacao, filtros, pagina]);

  // m6 (revisão): o debounce da busca NUNCA aplica um filtro novo enquanto há rascunho sujo/Salvar em voo — sem
  // isso, digitar em Buscar e editar uma célula em menos de 400 ms mudava a lista debaixo do usuário com filtros
  // "travados" na tela (uma das portas de entrada do rascunho escondido, I2/B-I2).
  // Fix round 2 T12b (R2/R-I2): o efeito também dispara quando `travaFiltro` solta (Salvar terminou, edição
  // desfeita, Keywords fechou) — sem mudar `busca` nenhuma. Antes, isso chamava `setPagina(1)` incondicionalmente
  // e jogava o usuário de volta pra página 1 mesmo com a busca intacta (ex.: Salvar na página 3). Agora só reseta
  // a página quando a busca DE FATO mudou em relação ao que já está aplicado em `filtros.busca` — comparado FORA
  // do updater de `setFiltros` (nunca chamar `setPagina` de dentro de um updater funcional, que o React pode
  // invocar mais de uma vez).
  useEffect(() => {
    if (travaFiltro) return;
    const t = setTimeout(() => {
      if (filtros.busca === busca) return;
      setFiltros((f) => ({ ...f, busca }));
      setPagina(1);
    }, 400);
    return () => clearTimeout(t);
  }, [busca, travaFiltro, filtros.busca]);

  // Chegou versão nova do servidor: merge 3-vias por produto; quem virou integrável por outra pessoa perde o rascunho
  // (avisa). Fix round 1 T12b (B-I1/parte do I1): depende também de `q.dataUpdatedAt` — um refetch cujo RESULTADO é
  // idêntico ao cache anterior (structural sharing do TanStack devolve a MESMA referência de `q.data`) não dispara
  // este efeito por `[lista]` sozinho, mas ainda pode ser o sinal de que um produto sem rascunho (ex.: o do diálogo
  // de fotos aberto) mudou de rev alhures — rodar de novo é seguro (idempotente: `mesclar` já não faz nada quando
  // o rev não avançou).
  useEffect(() => {
    if (!lista) return;
    const prox: Record<string, Rascunho> = {};
    const descartarIds: string[] = [];
    const descartados: { id: string; nome: string }[] = [];
    let mudouAlgo = false;
    for (const [id, r] of Object.entries(rascunhosRef.current)) {
      const p = lista.produtos.find((x) => x.modeloId === id);
      if (!p) { prox[id] = r; continue; } // fora da página atual — vira "escondido" (ver `escondidos` abaixo)
      if (p.estado !== "nao_integravel") {
        mudouAlgo = true;
        descartarIds.push(id);
        if (temAlteracao(r) && !avisadosDescarte.current.has(id)) descartados.push({ id, nome: r.nome });
        continue;
      }
      const m = mesclar(r, p);
      if (m !== r) mudouAlgo = true;
      prox[id] = m;
    }
    // Fix round 2 T12b (R1/R-I1): regressão do fix round 1 (m8) — `{...rs, ...prox}` NUNCA remove uma chave, só
    // sobrescreve; um id que virou integrável (pulado com `continue` acima, portanto ausente de `prox`) ficava
    // preso em `rs` pra sempre, e um Salvar seguinte reenviava um rascunho de um produto que não é mais editável
    // (42501 do servidor, ou pior, resgatando um payload velho). O updater agora parte de `rs`, aplica `prox` por
    // cima (produtos que sobreviveram/mesclaram) e DELETA explicitamente cada id descartado.
    if (mudouAlgo) {
      setRascunhos((rs) => {
        const seguinte = { ...rs, ...prox };
        for (const id of descartarIds) delete seguinte[id];
        return seguinte;
      });
    }
    for (const { id, nome } of descartados) {
      avisadosDescarte.current.add(id);
      toast.warning(`As alterações de "${nome}" foram descartadas: outra pessoa deixou o produto integrável.`);
    }
    // `q.dataUpdatedAt` na dependência é de propósito (B-I1): força re-checagem num refetch cujo dado é idêntico
    // por structural sharing (a referência de `lista` não muda sozinha nesse caso).
  }, [lista, q.dataUpdatedAt]);

  // Ruling B-I3 — fim da espera: solta o "salvo, aguardando lista" assim que a lista mostrar `p.rev >=
  // aguardando.rev` pra aquele produto (o servidor finalmente alcançou; a partir daqui a lista É a fonte mais
  // atual, não precisa mais do valor guardado aqui).
  // Fix round 3 T12b (m-S3, code-review "Re-check round 2"): a v1 só olhava a PÁGINA atual (`lista.produtos`) —
  // um produto que sai da página (renomeado, trocou de filtro no meio) mantinha a espera no mapa até reaparecer
  // NAQUELA MESMA página/filtro, mesmo que ele já estivesse visível e com o rev novo em OUTRA página/filtro/
  // situação já em cache (`produtosEmCache`, o mesmo helper que a re-mesclagem pós-Salvar e o "mostrar" já usam).
  // Sem custo de RPC nova — é só um outro lugar pra olhar antes de desistir. Seguro (nunca prendia de verdade;
  // era só memória), mas agora solta mais cedo sempre que possível.
  useEffect(() => {
    if (!lista) return;
    const idsAguardando = Object.keys(salvosAguardandoRef.current);
    if (idsAguardando.length === 0) return;
    const cache = produtosEmCache(qc, tenantId);
    let mudou = false;
    const prox = { ...salvosAguardandoRef.current };
    for (const id of idsAguardando) {
      const p = lista.produtos.find((x) => x.modeloId === id) ?? cache.get(id);
      if (p && p.rev >= prox[id].rev) {
        delete prox[id];
        mudou = true;
      }
    }
    if (mudou) setSalvosAguardando(prox);
  }, [lista, q.dataUpdatedAt, qc, tenantId]);

  // Fix round 2 T12b (minor m4): super admin troca de loja com rascunhos sujos pendentes (mesmo depois de cancelar
  // um "Descartar?" da guarda de navegação — `useAbaSuja`/`UnsavedChangesGuard` protegem TROCAR DE ROTA, não
  // trocar de loja no mesmo componente) — sem isso, os rascunhos da loja ANTERIOR continuavam em `rascunhos` e
  // iam num Salvar seguinte contra a loja NOVA (a faixa de escondidos ajudava a perceber, mas não impedia).
  // `tenantId` é a fonte de verdade de "qual loja" (a MESMA que toda queryKey desta tela já usa, P-57) — todo
  // estado por-produto reseta quando ele muda; filtros/situação/página (preferência de navegação, não dado de
  // produto) continuam como estavam.
  const tenantIdRef = useRef(tenantId);
  useEffect(() => {
    if (tenantIdRef.current === tenantId) return;
    tenantIdRef.current = tenantId;
    setRascunhos({});
    setSalvosAguardando({});
    setFotosDeId(null);
    setKeywordsAberto(false);
    setKeywordsSujo(false);
    avisadosDescarte.current = new Set();
    // Fix round 1 T13 (revisão T13 #3, code-review m3): a troca de loja zerava rascunhos/esperas mas NUNCA
    // `selecionados`/`integrarIds`/`voltarIds`/`desfazerDe` — um produto selecionado ou um diálogo de estado
    // aberto na loja ANTERIOR sobrevivia à troca, misturando ids de tenants diferentes na próxima ação em massa.
    setSelecionados(new Set());
    setIntegrarIds(null);
    setVoltarIds(null);
    setDesfazerDe(null);
  }, [tenantId]);

  // Fix round 1 T12b (A-I6/B-I2, D36 "nenhum rascunho fica escondido") — produtos com rascunho sujo que NÃO estão
  // na página atual (renomeado, saiu do filtro, mudou de estado noutra aba, ou o próprio Salvar fez sobrar SKU
  // depois de uma renomeação que moveu o produto de página). Nunca ficam presos: aparecem numa faixa própria com
  // nome + ações, independente da página/filtro atual.
  const idsPaginaAtual = useMemo(() => new Set((lista?.produtos ?? []).map((p) => p.modeloId)), [lista]);
  // Fix round 2 T12b (minor m-R7): com `lista` ainda `undefined` (1º carregamento, ou uma troca de loja/filtro
  // ainda em voo), `idsPaginaAtual` fica um Set VAZIO — sem essa guarda, TODO rascunho sujo passaria a aparecer
  // momentaneamente na faixa "fora desta página" (nenhum id bate num Set vazio), mesmo que o produto continue
  // exatamente na página atual assim que a lista chegar. Sem `lista` de verdade ainda não há como saber se algo
  // está "fora" — a resposta correta é "nenhum é considerado escondido ainda", não "todos são".
  const escondidos = useMemo(
    () => (lista ? sujos.filter((r) => !idsPaginaAtual.has(r.modeloId)) : []),
    [sujos, idsPaginaAtual, lista],
  );

  // Props ESTÁVEIS para o React.memo de LinhaProduto (achado do code-review T12a, carregado no carry desta task):
  // um produto SEM rascunho próprio precisa de um Rascunho por IDENTIDADE ESTÁVEL entre renders — `novoRascunho(p)`
  // criado direto no corpo de `rascunhoDe` seria um objeto NOVO a cada chamada, e toda LinhaProduto rerrenderizaria
  // sempre (o comparador raso do memo nunca bateria). O cache é chaveado por `${modeloId}:${rev}` — muda de
  // identidade só quando o PRÓPRIO produto muda de rev (chegou versão nova do servidor), nunca à toa.
  // m2 (revisão) — poda pelos ids da PÁGINA atual a cada render: o cache não cresce sem limite entre navegações.
  const semRascunhoCache = useRef<Map<string, Rascunho>>(new Map());
  if (lista) {
    // B-I3: a chave "viva" usa o rev EFETIVO (com hold aplicado), senão a entrada que `rascunhoDe` acabou de criar
    // pra um produto em espera seria podada no MESMO render (o `p.rev` cru da lista ainda não bateu).
    const vivos = new Set(lista.produtos.map((p) => `${p.modeloId}:${produtoComHold(p).rev}`));
    for (const chave of semRascunhoCache.current.keys()) {
      if (!vivos.has(chave)) semRascunhoCache.current.delete(chave);
    }
  }
  const rascunhoDe = useCallback(
    (p: ProdutoLista): Rascunho => {
      const existente = rascunhos[p.modeloId];
      if (existente) return existente;
      // Ruling B-I3: enquanto há um "salvo, aguardando lista" pra este produto, o Rascunho SEM edição própria
      // nasce dos valores SALVOS (não dos da lista em cache, que podem continuar mostrando o valor pré-Salvar).
      const efetivo = produtoComHold(p);
      const chave = `${efetivo.modeloId}:${efetivo.rev}`;
      const cache = semRascunhoCache.current;
      const emCache = cache.get(chave);
      if (emCache) return emCache;
      const novo = novoRascunho(efetivo);
      cache.set(chave, novo);
      return novo;
    },
    [rascunhos, produtoComHold],
  );
  const atualizar = useCallback(
    (p: ProdutoLista, f: (r: Rascunho) => Rascunho) =>
      setRascunhos((rs) => {
        // Ruling B-I3: uma edição NOVA que nasce durante a espera parte de `base`/`rev` = os valores SALVOS (não os
        // da lista em cache, ainda velha) — sem isso, um Salvar imediato dessa edição mandaria um `rev` atrasado e
        // levaria um P0409/conflito falso contra o PRÓPRIO Salvar que acabou de terminar.
        const efetivo = produtoComHold(p);
        return { ...rs, [p.modeloId]: f(rs[p.modeloId] ?? novoRascunho(efetivo)) };
      }),
    [produtoComHold],
  );

  const onSalvar = () => {
    if (sujos.some((r) => r.conflitos.length > 0)) {
      toast.error("Resolva os conflitos (manter o meu · usar o novo) antes de salvar.");
      return;
    }
    // Fix round 1 T12b (A-I4/B-I7 a) — pré-validação no CLIENTE de tudo que o servidor recusaria por valor (Nome/
    // REF vazio, nome > 200 no comprado, faixa numérica/negativos): o lote de `integracao_salvar` é ATÔMICO e
    // NENHUMA mensagem do servidor carrega o produto — com até 50 produtos sujos, sem isso o usuário não teria
    // como achar qual célula bloqueia o Salvar inteiro. Roda ANTES de chamar a mutation; nomeia o produto no toast.
    const cacheAgora = produtosEmCache(qc, tenantId);
    for (const r of sujos) {
      const origem = (lista?.produtos.find((p) => p.modeloId === r.modeloId) ?? cacheAgora.get(r.modeloId))?.origem ?? "interno";
      const erros = validarRascunho(r, origem);
      if (erros.length > 0) {
        toast.error(`${r.nome}: ${erros[0].texto}`);
        return;
      }
    }
    const enviados = sujos;
    salvar.mutate(enviados, {
      // Revisão T11 I2 (carry T12b) + Fix round 1 T12b (A-I1/A-I4/B-I4): a sobra do rascunho parte do ESTADO ATUAL
      // (`rascunhosRef.current[r.modeloId]`), nunca do `r` capturado em `enviados` antes do await. `aposSalvar`
      // nunca baixa o `rev` (Math.max). A re-mesclagem contra o cache usa `produtosEmCache` (chave por PREFIXO —
      // `getQueriesData`, não `getQueryData` com a chave exata de 2 elementos, que nunca bate com a query real de
      // 5) e só mescla quando `fresco.rev > sobra.rev` (a própria `mesclar` já recusa regressão — I4(c)). Um
      // rascunho cujo id sumiu do estado vivo (`rs[id]` ausente — virou integrável durante o Salvar, m9/m1) é
      // pulado por inteiro: nunca ressuscitado.
      onSuccess: (res) => {
        // Fix round 3 T12b (m-S1, code-review "Re-check round 2"): a sobra pós-Salvar + a espera "salvo,
        // aguardando lista" (ruling B-I3) são calculadas por uma função PURA (`resultadoPosSalvar`, `rascunho.ts`
        // — testável sem nenhum React envolvido), chamada AQUI, FORA de qualquer updater de `setState`, a partir
        // de `rascunhosRef.current` (o estado VIVO, nunca `rascunhos` capturado no fechamento de `onSalvar` antes
        // do `await`). A v1 (round 2) fazia esse cálculo DENTRO do updater de `setRascunhos` e lia o resultado de
        // uma variável de fora, logo depois de chamar `setRascunhos(...)` — funcionava só quando o React roda o
        // updater de forma "eager" (fibra sem update pendente no instante da chamada); com uma atualização já
        // enfileirada na mesma fibra (outro `setState` do mesmo componente, cenário real já que o `onSuccess` do
        // TanStack Query roda fora do sistema de eventos sintéticos do React), o updater só rodava no PRÓXIMO
        // commit — a variável lida logo depois chegava vazia, e a espera nunca era criada (flash transitório do
        // valor antigo). Com o cálculo fora de qualquer updater, os dois `set` recebem o resultado já pronto —
        // nenhum efeito colateral dentro de um updater, e o resultado nunca depende de QUANDO o React decide
        // rodar o updater.
        const { proxRascunhos, novosAguardando } = resultadoPosSalvar(rascunhosRef.current, enviados, res, produtosEmCache(qc, tenantId));
        setRascunhos(proxRascunhos);
        if (Object.keys(novosAguardando).length > 0) {
          setSalvosAguardando((sa) => ({ ...sa, ...novosAguardando }));
        }
        if (res.salvos > 0) toast.success(res.salvos === 1 ? "1 produto salvo." : `${res.salvos} produtos salvos.`);
        if (res.skusOk.length > 0) toast.success(`SKUs gravados em ${res.skusOk.length} produto(s).`);
        for (const f of res.skusFalhas) toast.error(`${f.nome}: ${f.texto}`);
      },
      // `integracao_salvar` é atômica para o LOTE inteiro: uma recusa (nome/REF vazio, nome > 200, faixa numérica em
      // PT via P0001, 42501 de um gate que fechou, P0409 de conflito/mudança) não perde NENHUM rascunho — nada é
      // limpo aqui. `mensagemErro` traduz o código; com o lote atômico e sem o produto na mensagem do servidor
      // (Task 13/T14 cobrem pré-validação de campo — fora do escopo desta aba), o toast aponta o produto quando o
      // lote tem exatamente 1 item sujo.
      onError: (e) => {
        const msg = mensagemErro(e, "Não foi possível salvar as alterações.");
        toast.error(enviados.length === 1 ? `${enviados[0].nome}: ${msg}` : msg);
      },
    });
  };

  const onKeywords = useCallback(() => setKeywordsAberto(true), []);
  // Task 13: Estado ganha o "⋯" (só super admin, só integrado) que abre o Desfazer; Integrável é o toggle que abre
  // Integrar/Voltar. `estadoCelula`/`integravelCelula` continuam `useCallback` — são passados pra `ProdutosTabela`,
  // que os repassa pra `LinhaProduto` (React.memo): uma identidade nova a cada render invalidaria TODA linha.
  //
  // Fix round 1 T13 (revisão T13 #2, task-13-review.md Important I1 + task-13-code-review.md m10): a v1 tinha DOIS
  // problemas de memo que a "prova" (o teste "seleção e memo") não media:
  // (a) `ctxIntegrar` dependia de `lista` INTEIRO (`[lista]`) — com structural sharing do TanStack, `lista` ganha
  //     identidade nova sempre que QUALQUER produto muda (realtime de outro usuário, `onSettled` de todo Save,
  //     refetch por foco de janela), então `integravelCelula`/`massa` (que dependiam de `ctxIntegrar`) trocavam de
  //     identidade e invalidavam TODA linha a cada reload — mesmo quando só 1 produto mudou. Fix: `useMemo` chaveado
  //     nos 3 PRIMITIVOS (`lista?.pode.editar`, `precisaVerCustos`, `lista?.pode.verCustos`), não no objeto `lista`.
  // (b) `idsSujosRef` (um ref lido dentro do `useCallback`) funcionava sem servir dado velho (confirmado pela
  //     revisão), mas o acoplamento "dirty ⇔ identidade de r" ficava implícito e escrever ref no render é
  //     anti-padrão. Fix (m10): removido — `integravelCelula` agora recebe `(p, r)` (o `r` já é a prop PRÓPRIA da
  //     linha em `LinhaProduto`) e computa `temAlteracao(r)` ali mesmo, sem ref nem Set externo. Como `r` só muda de
  //     identidade quando O PRÓPRIO produto é editado (é assim que o memo de linha já funciona pra `CelulaCampo`),
  //     `integravelCelula` fica IGUAL a `estadoCelula`: identidade estável enquanto `ctxIntegrar` não mudar de
  //     verdade, e o "tem rascunho" sempre fresco porque vem de uma prop, não de uma referência externa.
  const podeEditar = lista?.pode.editar ?? false;
  const podeVerCustos = lista?.pode.verCustos ?? false;
  const precisaVerCustos = lista?.campos.includes("preco_custo") ?? false;
  const ctxIntegrar = useMemo(
    () => ({ podeEditar, precisaVerCustos, podeVerCustos }),
    [podeEditar, precisaVerCustos, podeVerCustos],
  );
  const idsSujos = useMemo(() => new Set(sujos.map((r) => r.modeloId)), [sujos]);
  const estadoCelula = useCallback(
    (p: ProdutoLista) => (
      <EstadoCelula p={p} tz={tz} superAdmin={lista?.pode.super ?? false} onDesfazer={() => setDesfazerDe(p)} />
    ),
    [tz, lista?.pode.super],
  );
  const integravelCelula = useCallback(
    (p: ProdutoLista, r: Rascunho) => (
      <IntegravelCelula p={p}
        motivoIntegrar={motivoIntegrar(p, { ...ctxIntegrar, temRascunho: temAlteracao(r) })}
        motivoVoltar={motivoVoltar(p, ctxIntegrar.podeEditar)}
        onIntegrar={() => setIntegrarIds([p.modeloId])}
        onVoltar={() => setVoltarIds([p.modeloId])} />
    ),
    [ctxIntegrar],
  );
  const selecionadosLista = useMemo(
    () => (lista?.produtos ?? []).filter((p) => selecionados.has(p.modeloId)),
    [lista, selecionados],
  );
  const massa = useMemo(
    () => acoesEmMassa(selecionadosLista, { ...ctxIntegrar, rascunhos: idsSujos }),
    [selecionadosLista, ctxIntegrar, idsSujos],
  );
  // "seleção e memo" (achado carregado da revisão da Task 12b, corrigido de verdade na T13 fix round 1 — ver o
  // comentário grande acima de `integravelCelula`): `selecao` (o objeto) só é lido pelo CABEÇALHO da tabela
  // (`todos`/`alguns`/`onTodos`) — cada LINHA recebe só `marcado` (boolean) + `onMarcar` (`useCallback` estável),
  // nunca o objeto inteiro (`ProdutosTabela.tsx`). `onTodos`/`onMarcar` em `useCallback` evitam recriar a FUNÇÃO em
  // si a cada render.
  const onTodosSelecao = useCallback(
    (v: boolean) => setSelecionados(v ? new Set((lista?.produtos ?? []).map((p) => p.modeloId)) : new Set()),
    [lista],
  );
  const onMarcarSelecao = useCallback(
    (id: string, v: boolean) => setSelecionados((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    }),
    [],
  );
  const selecao = useMemo(
    () => ({
      todos: !!lista && lista.produtos.length > 0 && selecionadosLista.length === lista.produtos.length,
      alguns: selecionadosLista.length > 0,
      onTodos: onTodosSelecao,
      marcado: (id: string) => selecionados.has(id),
      onMarcar: onMarcarSelecao,
    }),
    [lista, selecionadosLista, selecionados, onTodosSelecao, onMarcarSelecao],
  );
  // Fix round 1 T13 (revisão T13 #3, code-review m3): `selecionados` só zerava ao trocar situação/filtros/página —
  // um produto que SAI da página numa relista (a API o integrou, outra pessoa renomeou e a ordenação mudou) ficava
  // preso no Set pra sempre, e a barra mostrava "3 selecionado(s)" com só 2 marcáveis (o cabeçalho "todos" também
  // ficava incoerente com o contador). Poda `selecionados` pelos ids da lista atual sempre que ela muda de verdade.
  useEffect(() => {
    if (!lista) return;
    const idsAtuais = new Set(lista.produtos.map((p) => p.modeloId));
    setSelecionados((s) => {
      if ([...s].every((id) => idsAtuais.has(id))) return s;
      return new Set([...s].filter((id) => idsAtuais.has(id)));
    });
  }, [lista]);
  // Fix round 1 T13 (revisão T13 #4, code-review m12, nit): `aposEstado` zerava a seleção INTEIRA mesmo quando a
  // ação veio do toggle de UMA linha (fora da barra de massa) — integrar/voltar por uma linha isolada apagava a
  // seleção em massa que o usuário já tinha montado antes. Agora recebe os ids AFETADOS por esta ação e remove só
  // esses do Set — uma ação de massa (que passa os ids de `massa.integrar`/`massa.voltar`) some da seleção como
  // antes; uma ação de linha isolada nunca tocou a seleção em massa mesmo, então o efeito prático é idêntico pra
  // esse caso (o id da linha pode nem estar selecionado).
  const aposEstado = useCallback((idsAfetados?: string[]) => {
    setIntegrarIds(null);
    setVoltarIds(null);
    setDesfazerDe(null);
    if (idsAfetados === undefined) { setSelecionados(new Set()); return; }
    const afetados = new Set(idsAfetados);
    setSelecionados((s) => new Set([...s].filter((id) => !afetados.has(id))));
  }, []);
  const barraMassa = lista && lista.pode.editar && (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2 text-sm">
      {/* Fix round 1 T13 (revisão T13 #3, code-review m3): mostra `selecionadosLista.length` (a interseção com a
          lista atual, a mesma que as ações usam) — nunca `selecionados.size` cru, que podia incluir ids fantasmas
          antes da poda do efeito acima rodar (a poda é assíncrona; entre a relista e o efeito, o Set ainda pode ter
          um id que já saiu da página). */}
      <span className="tabular-nums">{selecionadosLista.length} selecionado(s)</span>
      {/* Fix round 1 T13 (revisão T13 #8, code-review m8): manda TODOS os selecionados elegíveis pro resumo — não
          só `massa.integrar` (que já filtra por faltas/reprovado/etc., então abrir o resumo só com ELES escondia
          em silêncio os que ficam de fora, quando o próprio resumo (`fora`, de `integracao_previa`) existe
          EXATAMENTE pra explicar "por quê"). A ÚNICA exclusão do lado do cliente é `moduloBloqueado` — não-
          negociável (regra do brief): um produto de módulo desligado nem tem como ENTRAR num lote de
          `integracao_marcar` sem derrubar o lote INTEIRO com 42501 (atômico), então nunca é enviado pro resumo. */}
      <Button type="button" size="sm" disabled={massa.integrar.length === 0}
        onClick={() => setIntegrarIds(selecionadosLista.filter((p) => !p.moduloBloqueado).map((p) => p.modeloId))}>
        Integrar selecionados
      </Button>
      {selecionadosLista.length > 0 && massa.motivoIntegrar && <span className="text-xs text-muted-foreground">{massa.motivoIntegrar}</span>}
      <Button type="button" size="sm" variant="outline" disabled={massa.voltar.length === 0}
        onClick={() => setVoltarIds(massa.voltar)}>
        Voltar selecionados
      </Button>
      {selecionadosLista.length > 0 && massa.motivoVoltar && <span className="text-xs text-muted-foreground">{massa.motivoVoltar}</span>}
    </div>
  );
  const onFotos = useCallback((p: ProdutoLista) => setFotosDeId(p.modeloId), []);
  // Fix round 1 T12b (B-I1): deriva da lista ATUAL a cada render — nunca o snapshot capturado no clique. Fecha
  // sozinho se o produto sumir da lista OU deixar de ser editável (travou por outra pessoa) enquanto está aberto.
  // Ruling B-I3: passa por `produtoComHold` — se o diálogo continuar aberto logo depois de um Salvar sem sobra, as
  // fotos exibidas são as SALVAS, não as velhas da lista em cache que ainda não relistou.
  const pFotosBruto = fotosDeId ? (lista?.produtos.find((p) => p.modeloId === fotosDeId) ?? null) : null;
  const pFotos = pFotosBruto ? produtoComHold(pFotosBruto) : null;
  useEffect(() => {
    if (fotosDeId && lista && (!pFotos || pFotos.estado !== "nao_integravel")) setFotosDeId(null);
  }, [fotosDeId, lista, pFotos]);

  // Fix round 2 T13 (revisão T13 #12, code-review "Re-check round 1" I1-R): a v1 (fix round 1) caía no fallback
  // `produtosEmCache` quando o produto não estava em `lista.produtos` — mas `produtosEmCache` junta TODAS as
  // listas em CACHE da loja, INCLUSIVE as INATIVAS (outra situação/filtro que o usuário já visitou nesta sessão).
  // Como nenhum dos 3 RPCs de estado toca `modelos` (só trava a linha), o `rev` da lista (=`modelos.rev`) NUNCA
  // muda quando um produto integra/volta/desfaz — uma cópia INATIVA e desatualizada, ainda `integravel`, EMPATA em
  // rev com a versão nova e pode "ganhar" o `p.rev > atual.rev` de `produtosEmCache` (que só troca em rev
  // ESTRITAMENTE maior). Cenário real: o usuário filtra Estado=Integrável (query B) pra escolher o que voltar,
  // enquanto a lista sem filtro (query A, agora INATIVA) ainda mostra o produto como `integravel`; a API leva o
  // produto, B relista sem ele, mas o fallback acha a cópia velha em A — o diálogo NUNCA fecha e o P0409 se repete.
  // `invalidarIntegracao`/`invalidateQueries` só relê as queries ATIVAS por padrão, então a cópia em A fica presa
  // até o gc (5 min). Fix: SEM fallback de cache — deriva SÓ de `lista.produtos` (a página/filtro ATIVO). Os
  // `voltarIds` sempre nascem da página atual (toggle da linha ou `massa.voltar` = página ∩ seleção), então um
  // produto que sai da lista ativa cai fora do array — o diálogo encolhe ou fecha, nunca mostra uma cópia velha.
  const voltarProdutosAtuais = useMemo(() => {
    if (!voltarIds || !lista) return [];
    return voltarIds
      .map((id) => lista.produtos.find((p) => p.modeloId === id))
      .filter((p): p is ProdutoLista => !!p && p.estado === "integravel")
      .map((p) => ({ id: p.modeloId, nome: p.raw.nome }));
  }, [voltarIds, lista]);
  useEffect(() => {
    if (voltarIds && lista && voltarProdutosAtuais.length === 0) setVoltarIds(null);
  }, [voltarIds, lista, voltarProdutosAtuais]);

  const totalPag = lista ? totalPaginas(lista) : 1;
  // m4 (revisão): a página atual passou do total (produtos saíram) — nunca fica sem saída (EmptyState sem
  // paginação); a própria mudança de página já reseta pra última válida.
  useEffect(() => {
    if (lista && lista.produtos.length === 0 && lista.total > 0 && pagina > totalPag) setPagina(totalPag);
  }, [lista, pagina, totalPag]);

  // Fix round 2 T12b (R4/m-R1): buscava por `r.valores.ref` — o REF DIGITADO, ainda não salvo. Se o usuário editou
  // a REF (ou ela ainda nem chegou a bater no servidor), essa busca nunca encontra o produto na lista (que só
  // conhece o REF CONFIRMADO), e "mostrar" parece simplesmente não fazer nada. Usa `r.base.ref`/`r.base.nome` — o
  // valor que o SERVIDOR confirma, o único que a busca de `integracao_listar` de fato indexa.
  const mostrarEscondido = (r: Rascunho) => {
    const termo = r.base.ref ? String(r.base.ref) : r.base.nome;
    setSituacao("nao_integrados");
    setFiltros({ ...FILTROS_VAZIOS, busca: termo });
    setBusca(termo);
    setPagina(1);
  };
  const descartarEscondido = (r: Rascunho) => setRascunhos((rs) => {
    const prox = { ...rs };
    delete prox[r.modeloId];
    return prox;
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{TEXTO_MAO_DUPLA}</p>
      {escondidos.length > 0 && (
        <div className="space-y-2 rounded-md border border-[var(--tone-warning-fg)] bg-[var(--tone-warning-bg)] p-3">
          <p className="text-sm font-medium">
            {escondidos.length === 1
              ? "1 alteração em produto fora desta página"
              : `${escondidos.length} alterações em produtos fora desta página`}
          </p>
          <ul className="space-y-1">
            {escondidos.map((r) => (
              <li key={r.modeloId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{r.nome}</span>
                {/* Fix round 2 T12b (minor m3): "mostrar" troca filtro/situação/página (já travados por
                    `travaFiltro` durante o Salvar) e "descartar" apaga o rascunho — os dois desabilitados enquanto
                    o Salvar está em voo, pra não correr com o `setRascunhos` do `onSuccess`/`onError`. */}
                <Button type="button" variant="outline" size="sm" disabled={salvar.isPending} onClick={() => mostrarEscondido(r)}>mostrar</Button>
                <Button type="button" variant="ghost" size="sm" disabled={salvar.isPending} onClick={() => descartarEscondido(r)}>descartar</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Situação">
        {SITUACOES.map((s) => (
          <Button key={s.key} type="button" size="sm" variant={situacao === s.key ? "default" : "outline"} disabled={travaFiltro}
            aria-pressed={situacao === s.key}
            title={travaFiltro ? TEXTO_TRAVA_FILTRO : undefined} onClick={() => { setSituacao(s.key); setPagina(1); }}>
            {s.rotulo} <span className="tabular-nums">{lista?.contagens[s.key] ?? "—"}</span>
          </Button>
        ))}
      </div>
      {/* m5 (revisão): o motivo da trava de filtro visível também fora do `title` (que não aparece no toque/teclado). */}
      {travaFiltro && (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <span>{TEXTO_TRAVA_FILTRO}</span>
          <InfoHover ariaLabel="Por que os filtros estão travados">
            Enquanto houver uma alteração pendente (ou o Salvar estiver em andamento), trocar de filtro, situação ou
            página perderia a referência do que está sendo editado.
          </InfoHover>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <FiltroSelect id="f-colecao" rotulo="Coleção" valor={filtros.colecao} desabilitado={travaFiltro}
          opcoes={(lista?.opcoes.colecoes ?? []).map((c) => ({ key: c, label: c }))}
          onMudar={(v) => { setFiltros((f) => ({ ...f, colecao: v })); setPagina(1); }} />
        <FiltroSelect id="f-etapa" rotulo="Etapa" valor={filtros.etapa} desabilitado={travaFiltro} opcoes={lista?.opcoes.etapas ?? []}
          onMudar={(v) => { setFiltros((f) => ({ ...f, etapa: v })); setPagina(1); }} />
        <FiltroSelect id="f-origem" rotulo="Origem" valor={filtros.origem} desabilitado={travaFiltro}
          opcoes={Object.entries(ROTULO_ORIGEM).map(([key, label]) => ({ key, label }))}
          onMudar={(v) => { setFiltros((f) => ({ ...f, origem: v })); setPagina(1); }} />
        <FiltroSelect id="f-estado" rotulo="Estado" valor={filtros.estado} desabilitado={travaFiltro} info={TEXTO_ESTADO_DENTRO}
          opcoes={(Object.keys(ROTULO_ESTADO) as EstadoIntegracao[]).map((key) => ({ key, label: ROTULO_ESTADO[key] }))}
          onMudar={(v) => { setFiltros((f) => ({ ...f, estado: v as EstadoIntegracao | null })); setPagina(1); }} />
        <div className="grid gap-1">
          <Label htmlFor="f-busca">Buscar</Label>
          <Input id="f-busca" value={busca} placeholder="Nome ou REF" disabled={travaFiltro}
            title={travaFiltro ? TEXTO_TRAVA_FILTRO : undefined} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>
      {barraMassa}
      {/* m3 (revisão): erro de refetch em SEGUNDO PLANO (já há dado em cache) mostra uma faixa acima da tabela em
          vez de trocar a tabela inteira pelo EmptyState de erro (o que apagaria os rascunhos visíveis da tela). */}
      {q.isError && lista && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Não foi possível atualizar a lista agora — os dados na tela podem estar desatualizados.{" "}
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-sm" onClick={() => void q.refetch()}>Tentar de novo</Button>
        </div>
      )}
      {q.isError && !lista ? (
        <EmptyState title="Não foi possível carregar os produtos" description={mensagemErro(q.error, "Erro ao carregar.")}
          action={{ label: "Tentar de novo", onClick: () => void q.refetch() }} />
      ) : !lista ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : lista.produtos.length === 0 ? (
        <>
          <EmptyState title="Nenhum produto" description="Nenhum produto nesta situação e filtros." />
          {totalPag > 1 && (
            <div className="flex items-center justify-center gap-2 text-sm">
              <Button type="button" variant="outline" size="sm" onClick={() => setPagina(1)}>Voltar à página 1</Button>
            </div>
          )}
        </>
      ) : (
        <>
          <ProdutosTabela lista={lista} rascunhoDe={rascunhoDe} previas={previas} salvando={salvar.isPending}
            onAtualizar={atualizar} onKeywords={onKeywords} onFotos={onFotos} estadoCelula={estadoCelula}
            integravelCelula={integravelCelula} selecao={lista.pode.editar ? selecao : undefined} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">{faixaPagina(lista)}</span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={travaFiltro || lista.pagina <= 1}
                onClick={() => setPagina((n) => n - 1)}>Anterior</Button>
              <span className="text-muted-foreground">Página {lista.pagina} de {totalPaginas(lista)} (50 por página)</span>
              <Button type="button" variant="outline" size="sm" disabled={travaFiltro || lista.pagina >= totalPaginas(lista)}
                onClick={() => setPagina((n) => n + 1)}>Próxima</Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Colunas exibidas = campos marcados em "Campos da API" (ordem fixa; Estado e Integrável sempre antes delas).
          </p>
        </>
      )}
      {pFotos && (
        <FotosDialog produto={pFotos} rascunho={rascunhoDe(pFotos)} onAtualizar={(f) => atualizar(pFotos, f)} onFechar={() => setFotosDeId(null)} />
      )}
      {keywordsAberto && lista && (
        <KeywordsDialog
          atual={lista.keywords}
          onFechar={() => { setKeywordsAberto(false); setKeywordsSujo(false); }}
          onSujoChange={setKeywordsSujo}
        />
      )}
      {/* Fix round 1 T13 (revisão T13 #4, code-review m12): cada `onFeito` passa os PRÓPRIOS ids que essa ação
          afetou — `aposEstado` some só esses da seleção em massa (uma ação de linha isolada nem costuma estar na
          seleção; uma ação de massa some exatamente os que acabaram de ser integrados/voltados). */}
      {integrarIds && <IntegrarDialog ids={integrarIds} onFechar={() => setIntegrarIds(null)} onFeito={() => aposEstado(integrarIds)} />}
      {voltarIds && voltarProdutosAtuais.length > 0 && (
        <VoltarDialog produtos={voltarProdutosAtuais} onFechar={() => setVoltarIds(null)} onFeito={() => aposEstado(voltarIds)} />
      )}
      {desfazerDe && <DesfazerDialog produto={desfazerDe} onFechar={() => setDesfazerDe(null)} onFeito={() => aposEstado([desfazerDe.modeloId])} />}
      <PageActionBar>
        <Button type="button" variant="outline" onClick={() => router.history.back()}>
          <ArrowLeft className="h-4 w-4" />Voltar
        </Button>
        <Button type="button" className="ml-auto" disabled={!sujoLinhas || salvar.isPending} onClick={onSalvar}>
          <Save className="h-4 w-4" />{salvar.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </PageActionBar>
    </div>
  );
}
