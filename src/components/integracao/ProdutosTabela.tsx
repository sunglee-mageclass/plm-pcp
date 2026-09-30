// Integração — tabela da aba Produtos. Colunas: [seleção] · seta · Estado · [Integrável] · campos marcados (ordem fixa —
// "Colunas exibidas = campos marcados em Campos da API"). A seta abre as sublinhas (variante × tamanho). A tabela rola
// DENTRO do container; a página não rola na horizontal. Seleção e "Integrável" chegam na Task 13 (props opcionais).
//
// Adaptação do controlador (P-99 A): um produto INTEGRÁVEL reprovado continua na lista — mostra o badge "Reprovado —
// não vai para a API" ao lado do estado (StatusBadge tone="danger", mesmo padrão do resto da tela).
//
// Fix round 1 (ver task-12a-report.md "Fix round 1"):
// - I2/Important 1 (reviews): o selo Reprovado só afirma "não vai para a API" quando `p.estado==="integravel"` — um
//   INTEGRADO reprovado continua entregue pela API (`_integracao_ler`, P-99 A), então mostra só "Reprovado" (sem a
//   frase falsa) nesse caso.
// - M7/Minor 7 (code-review): cada linha do produto vira um componente `LinhaProduto` MEMOIZADO por `React.memo`
//   (comparador raso nas props relevantes) — uma tecla digitada numa célula só rerrenderiza a linha do produto
//   tocado, não a tabela inteira. `celula` (função local, dentro de `LinhaProduto`) é recriada por render da
//   linha, mas isso não invalida o memo — só o QUE está dentro de `LinhaProduto` já rerrenderizou de qualquer jeito.
// - M8/Acessibilidade (code-review): a seta de abrir/fechar sublinhas ganhou `aria-expanded`.
//
// Fix round 2 (task-12a-report.md "Fix round 2"; code-review "Re-check round 1" R5): `campos` virou `useMemo`
// chaveado em `lista.campos` — sem isso, o array era recriado em TODO render da tabela e o `React.memo` de
// `LinhaProduto` nunca batia (invalidava todas as linhas sempre, mesmo antes da T12b existir).
//
// Fix round 1 T13 (revisão T13 #1, task-13-review.md Important I1 + task-13-code-review.md m10): a v1 da T13 passava
// o OBJETO `selecao` inteiro pra CADA linha — como esse objeto é reconstruído (nova identidade) a cada mudança de
// seleção, o React.memo de TODA linha invalidava a cada clique num checkbox, não só o da linha tocada. Agora cada
// linha recebe só um BOOLEAN (`marcado={selecao.marcado(p.modeloId)}`) + a função `onMarcar` (já um `useCallback`
// estável em `ProdutosAba`) — um boolean muda de identidade só quando o PRÓPRIO valor muda, então o comparador raso
// do `React.memo` só invalida a linha cujo `marcado` de fato mudou. O cabeçalho (todos/alguns/onTodos) continua
// recebendo o objeto `selecao` (não passa pelo memo por linha).
//
// Correção do comentário (T12b, carry.md — code-review da T12a m1): o comentário de round 1 ACIMA (Minor 7) dizia
// que `rascunhoDe`/`atualizar`/`estadoCelula`/`onFotos` já chegavam ESTÁVEIS do chamador — isso NUNCA foi verdade
// (m1 do code-review T12a: "the caller defeats it too" — a T12b só existia como plano na época). O `ProdutosAba`
// real (`ProdutosAba.tsx`) é quem garante isso agora: `atualizar`/`estadoCelula`/`onFotos` via `useCallback`, e
// `rascunhoDe` devolve um `Rascunho` de identidade ESTÁVEL por `(modeloId, rev)` mesmo para produtos sem rascunho
// próprio (um cache local, em vez de `novoRascunho(p)` recriado a cada chamada) — sem isso, o `React.memo` desta
// tabela nunca teria efeito nenhum na prática, apesar de tecnicamente correto aqui.
//
// Preço anterior e Título por VERSÃO (P-146/P-155 B): cada célula recebe a versão anterior do produto (`versaoCelula`,
// objeto ESTÁVEL por produto — montado num `useMemo` daqui, pra não derrotar o memo da linha).
// P-156 C (T5): linha de um produto cuja versão MENOR já está Integrável/Integrada fica ÂMBAR, com o selo "vN já
// integrada/integrável" (sem trocar o selo de Estado) e um "i" comparando as variantes com o retrato dela. Só aviso.
import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useSort, SortTh } from "@/components/shared/sort";
import { InfoHover } from "@/components/shared/InfoHover";
import { CAMPO_BY_KEY, type CampoDef } from "@/lib/integracao/campos";
import {
  ROTULO_ORIGEM, SORT_KEY_ESTADO, acessorEstado, acessorOrdenacao, linhasVariante, resumoVariantes, seloVersaoIntegrada,
  type ListaIntegracao, type ProdutoLista, type VersaoIntegradaInfo,
} from "@/lib/integracao/produtos";
import type { VersaoAnteriorInfo } from "@/lib/versao-anterior";
import type { Rascunho } from "@/lib/integracao/rascunho";
import type { PreviaSkus } from "@/components/planejamento/planejamento-detail/codigos/sku-previa";
import { CelulaCampo, type VersaoCelula } from "./CelulaCampo";

export type SelecaoTabela = {
  todos: boolean; alguns: boolean; onTodos: (v: boolean) => void; marcado: (id: string) => boolean;
  onMarcar: (id: string, v: boolean) => void;
};
type Props = {
  lista: ListaIntegracao; rascunhoDe: (p: ProdutoLista) => Rascunho; previas: Record<string, PreviaSkus | undefined>;
  salvando: boolean; onAtualizar: (p: ProdutoLista, f: (r: Rascunho) => Rascunho) => void; onKeywords: () => void;
  onFotos: (p: ProdutoLista) => void; estadoCelula: (p: ProdutoLista) => ReactNode;
  // Fix round 1 T13 (I1/m10): `integravelCelula` recebe `r` (o Rascunho da PRÓPRIA linha, já disponível em
  // `LinhaProduto`) — quem chama decide o "tem rascunho pendente" a partir de `temAlteracao(r)`, sem precisar de um
  // ref/Set externo que muda de identidade a cada tecla em QUALQUER linha.
  integravelCelula?: (p: ProdutoLista, r: Rascunho) => ReactNode;
  selecao?: SelecaoTabela;
  /** P-146/P-155 B — versão anterior por produto (RPC `modelos_versao_anterior`); ausente = coluna não marcada. */
  versoesAnteriores?: ReadonlyMap<string, VersaoAnteriorInfo>;
  versoesAnterioresCarregando?: boolean;
  /** P-156 C (T5) — versão menor já integrável/integrada por produto (RPC `integracao_versoes_integradas`). */
  versoesIntegradas?: ReadonlyMap<string, VersaoIntegradaInfo>;
};

/** P-156 C — selo "vN já integrada/integrável" + "i" com a comparação de variantes (iguais / novas / saíram). */
export function SeloVersaoIntegrada({ info }: { info: VersaoIntegradaInfo }) {
  const r = resumoVariantes(info);
  return (
    <span className="inline-flex items-center gap-1">
      <StatusBadge tone="warning" className="w-fit normal-case tracking-normal">{seloVersaoIntegrada(info)}</StatusBadge>
      <InfoHover ariaLabel={`Variantes comparadas com a v${info.anteriorVersao}`}>
        <div className="grid gap-1.5">
          <p className="font-semibold">{r.titulo}</p>
          {r.grupos.map((g) => (
            <div key={g.rotulo}>
              <p className="font-medium">{g.rotulo}</p>
              {g.itens.length > 0 && <p className="text-muted-foreground">{g.itens.join(" · ")}</p>}
            </div>
          ))}
        </div>
      </InfoHover>
    </span>
  );
}

/** P-99 A (controlador) + Important 1 (task review): "não vai para a API" só é verdade para INTEGRÁVEL reprovado —
 *  a API continua entregando um INTEGRADO reprovado (`_integracao_ler`), então esse caso mostra só "Reprovado". */
function SeloReprovado({ p }: { p: ProdutoLista }) {
  if (!p.reprovado) return null;
  return (
    <StatusBadge tone="danger" className="w-fit normal-case tracking-normal">
      {p.estado === "integravel" ? "Reprovado — não vai para a API" : "Reprovado"}
    </StatusBadge>
  );
}

type LinhaProps = {
  p: ProdutoLista; r: Rascunho; previa: PreviaSkus | undefined; salvando: boolean; campos: CampoDef[];
  aberto: boolean; onAlternar: (id: string) => void; onAtualizar: (p: ProdutoLista, f: (r: Rascunho) => Rascunho) => void;
  onKeywords: () => void; onFotos: (p: ProdutoLista) => void; estadoCelula: (p: ProdutoLista) => ReactNode;
  integravelCelula?: (p: ProdutoLista, r: Rascunho) => ReactNode;
  // Fix round 1 T13 (I1/m10): a linha recebe SÓ o boolean `marcado` (identidade muda apenas quando o PRÓPRIO valor
  // muda) + `onMarcar` (já estável, `useCallback` em `ProdutosAba`) — nunca o objeto `selecao` inteiro, que troca de
  // identidade a cada seleção e invalidaria o React.memo de TODA linha.
  marcado?: boolean; onMarcar?: (id: string, v: boolean) => void;
  versaoCelula?: VersaoCelula; versaoIntegrada?: VersaoIntegradaInfo;
};
/** M7 (code-review): linha memoizada — uma edição na célula de UM produto só rerrenderiza a linha dele (comparador
 *  raso do React.memo cobre `r`/`previa` por identidade, que só mudam quando o PRÓPRIO produto é editado). */
const LinhaProduto = memo(function LinhaProduto({
  p, r, previa, salvando, campos, aberto, onAlternar, onAtualizar, onKeywords, onFotos, estadoCelula, integravelCelula, marcado, onMarcar,
  versaoCelula, versaoIntegrada,
}: LinhaProps) {
  const subs = linhasVariante(p);
  const celula = (c: CampoDef, indice: number | null) => (
    <CelulaCampo campo={c} produto={p} indice={indice} rascunho={r} previa={previa} salvando={salvando}
      onAtualizar={(f) => onAtualizar(p, f)} onKeywords={onKeywords} onFotos={() => onFotos(p)} versaoAnterior={versaoCelula} />
  );
  return (
    <>
      <tr className={versaoIntegrada ? "border-t align-top bg-[var(--tone-warning-bg)]" : "border-t align-top"}
        data-versao-integrada={versaoIntegrada ? "sim" : undefined}>
        {onMarcar && (
          <td className="px-2 py-2">
            <Checkbox aria-label={`Selecionar ${p.raw.nome}`} checked={marcado ?? false}
              onCheckedChange={(v) => onMarcar(p.modeloId, v === true)} />
          </td>
        )}
        <td className="px-1 py-2">
          <Button type="button" variant="ghost" size="iconSm" disabled={subs.length === 0} aria-expanded={aberto}
            aria-label={aberto ? `Fechar sublinhas de ${p.raw.nome}` : `Abrir sublinhas de ${p.raw.nome}`}
            onClick={() => onAlternar(p.modeloId)}>
            {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </td>
        <td className="px-2 py-2">
          <div className="flex flex-col gap-1">
            {estadoCelula(p)}
            {versaoIntegrada && <SeloVersaoIntegrada info={versaoIntegrada} />}
            {p.origem !== "interno" && <StatusBadge tone="info" className="w-fit">{ROTULO_ORIGEM[p.origem]}</StatusBadge>}
            <SeloReprovado p={p} />
          </div>
        </td>
        {integravelCelula && <td className="px-2 py-2">{integravelCelula(p, r)}</td>}
        {campos.map((c) => <td key={c.key} className="px-2 py-2">{celula(c, null)}</td>)}
      </tr>
      {aberto && subs.map((l, i) => (
        <tr key={`${p.modeloId}:${l.varianteKey}|${l.tamanhoKey}`} className="border-t border-dashed bg-muted/20 align-top text-xs">
          {onMarcar && <td />}
          <td />
          <td className="px-2 py-2 text-muted-foreground">sublinha</td>
          {integravelCelula && <td />}
          {campos.map((c) => <td key={c.key} className="px-2 py-2">{celula(c, i)}</td>)}
        </tr>
      ))}
    </>
  );
});

export function ProdutosTabela({
  lista, rascunhoDe, previas, salvando, onAtualizar, onKeywords, onFotos, estadoCelula, integravelCelula, selecao,
  versoesAnteriores, versoesAnterioresCarregando = false, versoesIntegradas,
}: Props) {
  // Um objeto ESTÁVEL por produto (identidade só muda quando o dado da versão muda — NUNCA a cada tecla: não depende de
  // `lista.produtos`, que é recriada a cada edição de rascunho) — o React.memo da linha segue valendo. Produto fora do
  // mapa (ainda carregando, ou sem linha) usa um objeto compartilhado `semInfo`.
  const semInfo = useMemo<VersaoCelula>(() => ({ info: null, carregando: versoesAnterioresCarregando }), [versoesAnterioresCarregando]);
  const versaoPorProduto = useMemo(() => {
    const m = new Map<string, VersaoCelula>();
    if (!versoesAnteriores) return m;
    for (const [id, info] of versoesAnteriores) m.set(id, { info, carregando: versoesAnterioresCarregando });
    return m;
  }, [versoesAnteriores, versoesAnterioresCarregando]);
  const versaoDe = (id: string): VersaoCelula | undefined =>
    versoesAnteriores ? versaoPorProduto.get(id) ?? semInfo : undefined;
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(new Set());
  const alternar = useCallback((id: string) => setAbertos((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  }), []);
  // Fix round 2 (R5, code-review): `campos` precisa ser ESTÁVEL por identidade entre renders — senão o
  // React.memo de `LinhaProduto` nunca bate (um array novo a cada render invalida o comparador raso e TODA linha
  // rerrenderiza sempre, mesmo antes da T12b existir). `useMemo` chaveado em `lista.campos` (o array de CHAVES,
  // que só muda quando a config de colunas muda de verdade).
  const campos = useMemo(
    () => lista.campos.map((k) => CAMPO_BY_KEY.get(k)).filter((c): c is CampoDef => !!c),
    [lista.campos],
  );
  // Ordenação clicável — TODA coluna, Título incluído (owner: "senti falta de ordenar por título; todos deveriam
  // ter uma ordenação"). `useSort` (mesmo helper de EstoqueTecidosTab/attribute-tab): número-vs-número numérico,
  // texto pt-BR (`localeCompare` numeric), vazio sempre por último. Sem `key` inicial — a ordem de hoje (a que o
  // servidor já devolve) não muda até a pessoa clicar (requisito "default = ordem de hoje").
  // Ordena os PRODUTOS (não as sublinhas): o accessor de cada coluna lê o valor SALVO da linha do PRODUTO
  // (`acessorOrdenacao`, produtos.ts) — nunca o rascunho ainda não gravado (ruling do brief: sorta pelo
  // salvo/servidor, pra não pular linha enquanto a pessoa digita). Uma sublinha de variante SEMPRE fica presa
  // debaixo do produto dela (o array `sorted` reordena só os produtos; `LinhaProduto` continua renderizando as
  // sublinhas do MESMO produto em sequência, como já fazia). Campo "soVariante" (cor base/apelido/tamanho) não tem
  // linha de produto no retrato/vivo — `acessorOrdenacao` resolve esses pela PRIMEIRA variante do produto
  // (documentado lá): dois produtos empatam nesse campo até que a 1ª variante de cada difira.
  const accessors = useMemo(() => {
    const acc: Record<string, (p: ProdutoLista) => unknown> = { [SORT_KEY_ESTADO]: acessorEstado };
    for (const c of campos) acc[c.key] = acessorOrdenacao(c);
    return acc;
  }, [campos]);
  // LOW (review 685544fa): `useSort` recebe `opts` inteiro na dependência do seu `useMemo` de `sorted` — um
  // `{ accessors }` literal NOVO a cada render (mesmo com `accessors` já memoizado acima) derrotava esse memo por
  // identidade, forçando o `.sort()` de novo em TODO render da aba (ex.: digitar em qualquer célula), não só
  // quando `lista.produtos`/`sortKey`/`sortDir` mudam de verdade.
  const sortOpts = useMemo(() => ({ accessors }), [accessors]);
  const sortState = useSort<ProdutoLista>(lista.produtos, sortOpts);
  return (
    <div className="max-w-full overflow-x-auto rounded-md border">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            {selecao && (
              <th className="w-10 px-2 py-2">
                <Checkbox aria-label="Selecionar todos da página" checked={selecao.todos ? true : selecao.alguns ? "indeterminate" : false}
                  onCheckedChange={(v) => selecao.onTodos(v === true)} />
              </th>
            )}
            <th className="w-10 px-1 py-2"><span className="sr-only">Sublinhas</span></th>
            <SortTh label="Estado" sortKey={SORT_KEY_ESTADO} sortState={sortState} className="px-2 py-2" />
            {integravelCelula && <th className="px-2 py-2">Integrável</th>}
            {campos.map((c) => (
              <SortTh key={c.key} label={c.rotuloCurto} sortKey={c.key} sortState={sortState}
                className="whitespace-nowrap px-2 py-2 font-medium" />
            ))}
          </tr>
        </thead>
        <tbody>
          {sortState.sorted.map((p) => (
            <LinhaProduto key={p.modeloId} p={p} r={rascunhoDe(p)} previa={previas[p.modeloId]} salvando={salvando}
              campos={campos} aberto={abertos.has(p.modeloId)} onAlternar={alternar} onAtualizar={onAtualizar}
              onKeywords={onKeywords} onFotos={onFotos} estadoCelula={estadoCelula} integravelCelula={integravelCelula}
              marcado={selecao?.marcado(p.modeloId)} onMarcar={selecao?.onMarcar}
              versaoCelula={versaoDe(p.modeloId)} versaoIntegrada={versoesIntegradas?.get(p.modeloId)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
