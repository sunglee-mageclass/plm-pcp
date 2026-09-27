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
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { mensagemErro } from "@/lib/erro-mensagem";
import { TEXTO_MAO_DUPLA } from "@/lib/integracao/campos";
import {
  FILTROS_VAZIOS, ROTULO_ESTADO, ROTULO_ORIGEM, faixaPagina, rotuloEstado, textoFaltas, tomEstado, totalPaginas,
  type EstadoIntegracao, type Filtros, type ListaIntegracao, type ProdutoLista, type Situacao,
} from "@/lib/integracao/produtos";
import { aposSalvar, mesclar, novoRascunho, temAlteracao, validarRascunho, type Rascunho } from "@/lib/integracao/rascunho";
import { useAbaSuja } from "./guard";
import { chaveLista, useIntegracaoAoVivo, useIntegracaoLista, usePreviasSkus, useSalvarIntegracao } from "./useIntegracao";
import { ProdutosTabela } from "./ProdutosTabela";
import { FotosDialog } from "./FotosDialog";
import { KeywordsDialog } from "./KeywordsDialog";

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
  // m7 (revisão): o texto sujo do diálogo de Keywords também soma na guarda ÚNICA da página — sem isso, "Voltar" do
  // navegador ou F5 com o diálogo aberto e texto digitado saía sem perguntar (a guarda só olhava `rascunhos`).
  const [keywordsSujo, setKeywordsSujo] = useState(false);
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

  // m6 (revisão): o debounce da busca NUNCA aplica um filtro novo enquanto há rascunho sujo/Salvar em voo — sem
  // isso, digitar em Buscar e editar uma célula em menos de 400 ms mudava a lista debaixo do usuário com filtros
  // "travados" na tela (uma das portas de entrada do rascunho escondido, I2/B-I2).
  useEffect(() => {
    if (travaFiltro) return;
    const t = setTimeout(() => {
      setFiltros((f) => (f.busca === busca ? f : { ...f, busca }));
      setPagina(1);
    }, 400);
    return () => clearTimeout(t);
  }, [busca, travaFiltro]);

  // Chegou versão nova do servidor: merge 3-vias por produto; quem virou integrável por outra pessoa perde o rascunho
  // (avisa). Fix round 1 T12b (B-I1/parte do I1): depende também de `q.dataUpdatedAt` — um refetch cujo RESULTADO é
  // idêntico ao cache anterior (structural sharing do TanStack devolve a MESMA referência de `q.data`) não dispara
  // este efeito por `[lista]` sozinho, mas ainda pode ser o sinal de que um produto sem rascunho (ex.: o do diálogo
  // de fotos aberto) mudou de rev alhures — rodar de novo é seguro (idempotente: `mesclar` já não faz nada quando
  // o rev não avançou).
  useEffect(() => {
    if (!lista) return;
    const prox: Record<string, Rascunho> = {};
    const descartados: string[] = [];
    let mudou = false;
    for (const [id, r] of Object.entries(rascunhosRef.current)) {
      const p = lista.produtos.find((x) => x.modeloId === id);
      if (!p) { prox[id] = r; continue; } // fora da página atual — vira "escondido" (ver `escondidos` abaixo)
      if (p.estado !== "nao_integravel") {
        mudou = true;
        if (temAlteracao(r)) descartados.push(r.nome);
        continue;
      }
      const m = mesclar(r, p);
      if (m !== r) mudou = true;
      prox[id] = m;
    }
    if (mudou) setRascunhos((rs) => ({ ...rs, ...prox })); // m8: updater funcional, mesmo sendo seguro hoje sem ele
    for (const nome of descartados) {
      toast.warning(`As alterações de "${nome}" foram descartadas: outra pessoa deixou o produto integrável.`);
    }
    // `q.dataUpdatedAt` na dependência é de propósito (B-I1): força re-checagem num refetch cujo dado é idêntico
    // por structural sharing (a referência de `lista` não muda sozinha nesse caso).
  }, [lista, q.dataUpdatedAt]);

  // Fix round 1 T12b (A-I6/B-I2, D36 "nenhum rascunho fica escondido") — produtos com rascunho sujo que NÃO estão
  // na página atual (renomeado, saiu do filtro, mudou de estado noutra aba, ou o próprio Salvar fez sobrar SKU
  // depois de uma renomeação que moveu o produto de página). Nunca ficam presos: aparecem numa faixa própria com
  // nome + ações, independente da página/filtro atual.
  const idsPaginaAtual = useMemo(() => new Set((lista?.produtos ?? []).map((p) => p.modeloId)), [lista]);
  const escondidos = useMemo(
    () => sujos.filter((r) => !idsPaginaAtual.has(r.modeloId)),
    [sujos, idsPaginaAtual],
  );

  // Props ESTÁVEIS para o React.memo de LinhaProduto (achado do code-review T12a, carregado no carry desta task):
  // um produto SEM rascunho próprio precisa de um Rascunho por IDENTIDADE ESTÁVEL entre renders — `novoRascunho(p)`
  // criado direto no corpo de `rascunhoDe` seria um objeto NOVO a cada chamada, e toda LinhaProduto rerrenderizaria
  // sempre (o comparador raso do memo nunca bateria). O cache é chaveado por `${modeloId}:${rev}` — muda de
  // identidade só quando o PRÓPRIO produto muda de rev (chegou versão nova do servidor), nunca à toa.
  // m2 (revisão) — poda pelos ids da PÁGINA atual a cada render: o cache não cresce sem limite entre navegações.
  const semRascunhoCache = useRef<Map<string, Rascunho>>(new Map());
  if (lista) {
    const vivos = new Set(lista.produtos.map((p) => `${p.modeloId}:${p.rev}`));
    for (const chave of semRascunhoCache.current.keys()) {
      if (!vivos.has(chave)) semRascunhoCache.current.delete(chave);
    }
  }
  const rascunhoDe = useCallback(
    (p: ProdutoLista): Rascunho => {
      const existente = rascunhos[p.modeloId];
      if (existente) return existente;
      const chave = `${p.modeloId}:${p.rev}`;
      const cache = semRascunhoCache.current;
      const emCache = cache.get(chave);
      if (emCache) return emCache;
      const novo = novoRascunho(p);
      cache.set(chave, novo);
      return novo;
    },
    [rascunhos],
  );
  const atualizar = useCallback(
    (p: ProdutoLista, f: (r: Rascunho) => Rascunho) =>
      setRascunhos((rs) => ({ ...rs, [p.modeloId]: f(rs[p.modeloId] ?? novoRascunho(p)) })),
    [],
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
        const cache = produtosEmCache(qc, tenantId);
        setRascunhos((rs) => {
          const prox = { ...rs };
          for (const enviado of enviados) {
            // m9/m1 (revisão): `rs[id]` ausente = o merge already descartou este rascunho durante o Salvar (o
            // produto virou integrável/saiu da lista) — não ressuscitar, mesmo que os SKUs dele tenham falhado.
            const atual = rs[enviado.modeloId];
            if (!atual) continue;
            let sobra = aposSalvar(atual, {
              rev: res.revs[enviado.modeloId],
              fotos: res.fotos[enviado.modeloId],
              skusGravados: res.skusOk.includes(enviado.modeloId),
            });
            if (sobra) {
              const fresco = cache.get(enviado.modeloId);
              if (fresco && fresco.rev > sobra.rev) sobra = mesclar(sobra, fresco);
              prox[enviado.modeloId] = sobra;
            } else {
              delete prox[enviado.modeloId];
            }
          }
          return prox;
        });
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
  const estadoCelula = useCallback(
    (p: ProdutoLista) => (
      <div className="flex items-center gap-1">
        <StatusBadge tone={tomEstado(p.estado)} className="whitespace-nowrap normal-case tracking-normal">{rotuloEstado(p, tz)}</StatusBadge>
        {p.estado === "nao_integravel" && !p.completo && <InfoHover ariaLabel="O que falta">{textoFaltas(p.faltas)}</InfoHover>}
      </div>
    ),
    [tz],
  );
  const onFotos = useCallback((p: ProdutoLista) => setFotosDeId(p.modeloId), []);
  // Fix round 1 T12b (B-I1): deriva da lista ATUAL a cada render — nunca o snapshot capturado no clique. Fecha
  // sozinho se o produto sumir da lista OU deixar de ser editável (travou por outra pessoa) enquanto está aberto.
  const pFotos = fotosDeId ? (lista?.produtos.find((p) => p.modeloId === fotosDeId) ?? null) : null;
  useEffect(() => {
    if (fotosDeId && lista && (!pFotos || pFotos.estado !== "nao_integravel")) setFotosDeId(null);
  }, [fotosDeId, lista, pFotos]);

  const totalPag = lista ? totalPaginas(lista) : 1;
  // m4 (revisão): a página atual passou do total (produtos saíram) — nunca fica sem saída (EmptyState sem
  // paginação); a própria mudança de página já reseta pra última válida.
  useEffect(() => {
    if (lista && lista.produtos.length === 0 && lista.total > 0 && pagina > totalPag) setPagina(totalPag);
  }, [lista, pagina, totalPag]);

  const mostrarEscondido = (r: Rascunho) => {
    setSituacao("nao_integrados");
    setFiltros({ ...FILTROS_VAZIOS, busca: r.valores.ref ? String(r.valores.ref) : r.nome });
    setBusca(r.valores.ref ? String(r.valores.ref) : r.nome);
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
                <Button type="button" variant="outline" size="sm" onClick={() => mostrarEscondido(r)}>mostrar</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => descartarEscondido(r)}>descartar</Button>
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
            onAtualizar={atualizar} onKeywords={onKeywords} onFotos={onFotos} estadoCelula={estadoCelula} />
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
