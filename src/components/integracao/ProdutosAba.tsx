// Integração — aba Produtos (spec §6, mockup 2). Situação (padrão "Não integrados") + coleção/etapa/origem/estado + busca;
// páginas de 50; células editáveis enquanto "não integrável" (rascunho por produto — só o Salvar grava; rev/P0409 + merge
// 3-vias com o que chega do servidor). Estados (integrar/voltar/desfazer): Task 13. Celular: sem esta tela (P-87 — Task 18).
//
// Adaptações do controlador sobre o brief da Task 12b (ver task-12b-report.md):
// - Sobra do rascunho depois do Salvar (revisão T11 I2, carry.md): montada a partir do ESTADO ATUAL do rascunho (não do
//   que foi ENVIADO — outra digitação pode ter chegado durante o Salvar), nunca baixa `rev`, e RE-MESCLA contra a lista
//   em CACHE (nunca a `enviados` capturada antes do await) — `res.revs` pode estar 1 rev atrás (kanban automático bumpa
//   no COMMIT; outro usuário pode salvar durante o passo 3 de SKUs).
// - Props ESTÁVEIS para o React.memo das linhas (achado do code-review da T12a): o rascunho de um produto SEM entrada em
//   `rascunhos` é memoizado POR (id, rev) num `Map` — nunca `novoRascunho(p)` recriado a cada render; `atualizar`,
//   `estadoCelula` e `onFotos` são `useCallback`.
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
  type EstadoIntegracao, type Filtros, type ProdutoLista, type Situacao,
} from "@/lib/integracao/produtos";
import { aposSalvar, mesclar, novoRascunho, temAlteracao, type Rascunho } from "@/lib/integracao/rascunho";
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
  const [fotosDe, setFotosDe] = useState<ProdutoLista | null>(null);
  const [keywordsAberto, setKeywordsAberto] = useState(false);
  const q = useIntegracaoLista(situacao, filtros, pagina);
  const idsPagina = useMemo(() => (q.data?.produtos ?? []).map((p) => p.modeloId), [q.data]);
  useIntegracaoAoVivo(idsPagina);
  const salvar = useSalvarIntegracao();
  const lista = q.data;
  const sujos = useMemo(() => Object.values(rascunhos).filter(temAlteracao), [rascunhos]);
  const sujo = sujos.length > 0;
  useAbaSuja("produtos", sujo);
  const previas = usePreviasSkus(sujos, lista?.pode.editar ?? false);
  const travaFiltro = sujo || salvar.isPending;

  useEffect(() => {
    const t = setTimeout(() => {
      setFiltros((f) => (f.busca === busca ? f : { ...f, busca }));
      setPagina(1);
    }, 400);
    return () => clearTimeout(t);
  }, [busca]);

  // Chegou versão nova do servidor: merge 3-vias por produto; quem virou integrável por outra pessoa perde o rascunho (avisa).
  useEffect(() => {
    if (!lista) return;
    const prox: Record<string, Rascunho> = {};
    const descartados: string[] = [];
    let mudou = false;
    for (const [id, r] of Object.entries(rascunhosRef.current)) {
      const p = lista.produtos.find((x) => x.modeloId === id);
      if (!p) { prox[id] = r; continue; }
      if (p.estado !== "nao_integravel") {
        mudou = true;
        if (temAlteracao(r)) descartados.push(r.nome);
        continue;
      }
      const m = mesclar(r, p);
      if (m !== r) mudou = true;
      prox[id] = m;
    }
    if (mudou) setRascunhos(prox);
    for (const nome of descartados) {
      toast.warning(`As alterações de "${nome}" foram descartadas: outra pessoa deixou o produto integrável.`);
    }
  }, [lista]);

  // Props ESTÁVEIS para o React.memo de LinhaProduto (achado do code-review T12a, carregado no carry desta task):
  // um produto SEM rascunho próprio precisa de um Rascunho por IDENTIDADE ESTÁVEL entre renders — `novoRascunho(p)`
  // criado direto no corpo de `rascunhoDe` seria um objeto NOVO a cada chamada, e toda LinhaProduto rerrenderizaria
  // sempre (o comparador raso do memo nunca bateria). O cache é chaveado por `${modeloId}:${rev}` — muda de
  // identidade só quando o PRÓPRIO produto muda de rev (chegou versão nova do servidor), nunca à toa.
  const semRascunhoCache = useRef<Map<string, Rascunho>>(new Map());
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
    const enviados = sujos;
    salvar.mutate(enviados, {
      // Revisão T11 I2 (carry T12b): a sobra do rascunho parte do ESTADO ATUAL (`rascunhosRef.current[r.modeloId]`),
      // nunca do `r` capturado em `enviados` antes do await — quem digitou de novo enquanto o Salvar estava em voo
      // não pode ter essa digitação apagada. `aposSalvar` nunca baixa o `rev` (ver o comentário da própria função em
      // rascunho.ts); aqui, além disso, a sobra é RE-MESCLADA contra a lista em CACHE (`chaveLista(tenantId)`, não
      // a `enviados`/`lista` fechados no escopo deste callback) porque `res.revs` pode estar 1 rev atrás do que já
      // está no cache: o kanban automático bumpa `rev` no COMMIT da transação de `integracao_salvar` (fora do que a
      // função retorna) e outra pessoa pode ter salvo o MESMO produto durante o passo 3 (SKUs) desta chamada. Sem
      // essa re-mesclagem, a sobra ficaria presa comparando contra um `rev`/`base` velhos e um conflito legítimo do
      // meio-tempo nunca apareceria.
      onSuccess: (res) => {
        const listaCache = qc.getQueryData<{ produtos: ProdutoLista[] }>(chaveLista(tenantId));
        setRascunhos((rs) => {
          const prox = { ...rs };
          for (const enviado of enviados) {
            const atual = rs[enviado.modeloId] ?? enviado;
            let sobra = aposSalvar(atual, {
              rev: res.revs[enviado.modeloId],
              fotos: res.fotos[enviado.modeloId],
              skusGravados: res.skusOk.includes(enviado.modeloId),
            });
            if (sobra) {
              const fresco = listaCache?.produtos.find((x) => x.modeloId === enviado.modeloId);
              if (fresco && fresco.rev !== sobra.rev) sobra = mesclar(sobra, fresco);
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
      // `integracao_salvar` é atômica para o LOTE inteiro (carry T12b): uma recusa (nome/REF vazio, nome > 200,
      // faixa numérica em PT via P0001, 42501 de um gate que fechou, P0409 de conflito/mudança) não perde NENHUM
      // rascunho — nada é limpo aqui, e `mensagemErro` já traduz cada um desses códigos (inclusive apontando qual
      // produto/campo, quando a mensagem do servidor carrega isso) para o toast. O usuário decide se corrige e
      // tenta de novo ou descarta manualmente.
      onError: (e) => toast.error(mensagemErro(e, "Não foi possível salvar as alterações.")),
    });
  };

  const estadoCelula = useCallback(
    (p: ProdutoLista) => (
      <div className="flex items-center gap-1">
        <StatusBadge tone={tomEstado(p.estado)} className="whitespace-nowrap normal-case tracking-normal">{rotuloEstado(p, tz)}</StatusBadge>
        {p.estado === "nao_integravel" && !p.completo && <InfoHover ariaLabel="O que falta">{textoFaltas(p.faltas)}</InfoHover>}
      </div>
    ),
    [tz],
  );
  const onFotos = useCallback((p: ProdutoLista) => setFotosDe(p), []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{TEXTO_MAO_DUPLA}</p>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Situação">
        {SITUACOES.map((s) => (
          <Button key={s.key} type="button" size="sm" variant={situacao === s.key ? "default" : "outline"} disabled={travaFiltro}
            aria-pressed={situacao === s.key}
            title={travaFiltro ? TEXTO_TRAVA_FILTRO : undefined} onClick={() => { setSituacao(s.key); setPagina(1); }}>
            {s.rotulo} <span className="tabular-nums">{lista?.contagens[s.key] ?? "—"}</span>
          </Button>
        ))}
      </div>
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
      {q.isError ? (
        // Adaptação (T12b): `EmptyState.action` é `{ label, onClick }` (src/components/shared/EmptyState.tsx), não
        // um ReactNode — o brief assumia um `<Button>` solto; a API real monta o botão internamente.
        <EmptyState title="Não foi possível carregar os produtos" description={mensagemErro(q.error, "Erro ao carregar.")}
          action={{ label: "Tentar de novo", onClick: () => void q.refetch() }} />
      ) : !lista ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : lista.produtos.length === 0 ? (
        <EmptyState title="Nenhum produto" description="Nenhum produto nesta situação e filtros." />
      ) : (
        <>
          <ProdutosTabela lista={lista} rascunhoDe={rascunhoDe} previas={previas} salvando={salvar.isPending}
            onAtualizar={atualizar} onKeywords={() => setKeywordsAberto(true)} onFotos={onFotos} estadoCelula={estadoCelula} />
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
      {fotosDe && (
        <FotosDialog produto={fotosDe} rascunho={rascunhoDe(fotosDe)} onAtualizar={(f) => atualizar(fotosDe, f)} onFechar={() => setFotosDe(null)} />
      )}
      {keywordsAberto && lista && <KeywordsDialog atual={lista.keywords} onFechar={() => setKeywordsAberto(false)} />}
      <PageActionBar>
        <Button type="button" variant="outline" onClick={() => router.history.back()}>
          <ArrowLeft className="h-4 w-4" />Voltar
        </Button>
        <Button type="button" className="ml-auto" disabled={!sujo || salvar.isPending} onClick={onSalvar}>
          <Save className="h-4 w-4" />{salvar.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </PageActionBar>
    </div>
  );
}
