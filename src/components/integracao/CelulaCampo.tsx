// Integração — uma célula da aba Produtos (linha do produto ou sublinha variante × tamanho). Edita SÓ o rascunho (staging);
// `modoCelula` decide editar × ler. Custo, cor, apelido e tamanho: só leitura com "i" + "abrir card" (P-80 A). Linha
// integrável/integrada: RETRATO + cadeado; "i" âmbar quando o vivo difere (N10). SKU da sublinha: digitado vira "a gravar"
// (mesmas regras da seção Códigos, incluindo desfazer/conflito) e a prévia do servidor diz a situação.
//
// Adaptações do controlador sobre o brief da Task 12a (ver task-12a-report.md):
// - Título: NÃO usa o `editar` genérico — usa `tituloExibido`/`editarTitulo`/`sairTitulo` (rascunho.ts), passando
//   `nomeLoja` de `useTenantBranding().nome` a cada chamada (nunca guardado em estado). Célula DESABILITADA enquanto
//   `nome` ainda é null (loading), com um hint curto — evita editar o título antes do automático poder ser calculado.
// - Título e "Preço anterior" em modo automático (raw NULL): mostram o valor automático + selo "automático".
// - Reprovado: badge fica na coluna Estado (ProdutosTabela), não aqui.
//
// Fix round 1 (ver task-12a-report.md "Fix round 1" para o detalhe de cada item; reviews: task-12a-review.md +
// task-12a-code-review.md):
// - I4/Important 3: SKU ganhou "desfazer o SKU digitado" (`semManual`) e, em conflito de versão (P0409),
//   "manter o meu" (`manterMeu` de sku-previa.ts, adota id/rev novos da linha) / "usar o novo" (`semManual`) —
//   mesmas 3 ações de `CodigosSecao.tsx:245-257`, mesmos helpers, NENHUMA reimplementação.
// - I1/Important (peso/medidas): trocado `NumberInput` por `MoneyInput decimals={3|2} fixedDecimals`, mesmo padrão
//   de `InfoGeraisSecao.tsx:43-50`. Vazio vira NULL (nunca 0); negativo é bloqueado na própria célula (não pode
//   mais abortar o lote); casas limitadas na digitação.
// - I3/Important (edição pendente que uma trava esconde): em leitura, se a coluna está em `colunasAlteradas(r)` (ou
//   há SKU manual pendente), a célula mostra o valor do RASCUNHO com realce âmbar + "descartar alteração"
//   (`usarNovo`/`semManual`) em vez do valor do servidor — e, enquanto `salvando`, toda célula editável mostra o
//   valor do rascunho (desabilitado), nunca o antigo do servidor.
// - I5 (NCM): `filtrarNcm` (helpers.ts) aplicado ao digitar, igual ao card.
// - I6/I7 (sublinhas + amber): chave estável `variante|tamanho` (ProdutosTabela.tsx) + Input de SKU CONTROLADO
//   (nunca `defaultValue`/`key={exibido}`) — uma relista nunca move o texto digitado para outra linha. O amber do
//   InfoHover passa a funcionar porque `InfoHover.tsx` agora usa `cn()` (tailwind-merge) — nada mudou aqui além de
//   depender do fix do componente compartilhado.
// - Minors: closures do SKU calculadas dentro do updater; badge "calculando…" contra prévia desatualizada; título
//   captura `e.target.value` antes do updater; SKU vira leitura com "Defina 'Tamanho em'..." quando
//   `tamanho_tipo` é NULL; Preço anterior mostra o automático como PLACEHOLDER quando editável; título nunca fica
//   desabilitado para sempre (mostra erro + permite editar se `useTenantBranding` falhar); aria-label com campo +
//   produto em toda célula editável; textos de trava padronizados via `TEXTO_TRAVADO_*`/"Salvando…" também no SKU e
//   nas células só-leitura; Keywords (store-level, gate independente do estado do produto — `_integracao_gates`
//   usa `v_int`, nunca o `estado` da linha) fica editável em QUALQUER linha, mesmo travada.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InfoHover } from "@/components/shared/InfoHover";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { useTenantBranding } from "@/hooks/useTenantBranding";
import { cn } from "@/lib/utils";
import { filtrarNcm } from "@/components/planejamento/planejamento-detail/helpers";
import { infoCusto, type CampoDef, type ColunaEditavel } from "@/lib/integracao/campos";
import { infoEdicao, modoCelula, TEXTO_TRAVADO_INTEGRADO, TEXTO_TRAVADO_INTEGRAVEL } from "@/lib/integracao/celula";
import {
  avisoRetrato, linhasVariante, textoFotos, usaRetrato, valorCelula, type ProdutoLista, type Sublinha,
} from "@/lib/integracao/produtos";
import {
  colunasAlteradas, comSkus, editar, editarTitulo, linhaSkuDaSublinha, manterMeu, sairTitulo,
  tituloCalculadoDoRascunho, usarNovo, type Rascunho,
} from "@/lib/integracao/rascunho";
import { tituloExibido } from "@/lib/titulo-pagina";
import {
  chaveEntradaPrevia, chaveLinhaSku, digitarSku, manterMeu as manterMeuSku, semManual as semManualSku,
  situacaoPrevia, skuExibido, type LinhaPrevia, type PreviaSkus,
} from "@/components/planejamento/planejamento-detail/codigos/sku-previa";

type Props = {
  campo: CampoDef; produto: ProdutoLista; indice: number | null; rascunho: Rascunho; previa: PreviaSkus | undefined;
  salvando: boolean; onAtualizar: (f: (r: Rascunho) => Rascunho) => void; onKeywords: () => void; onFotos: () => void;
};

const TEXTO_SALVANDO = "Salvando…";

function AbrirCard({ id }: { id: string }) {
  // N6 (G-plano do plano): quem só tem a permissão "Integração" não abre o Planejamento — o link some
  const { canView } = useAuth();
  if (!canView("criacao_planejamento")) return null;
  return (
    <Link to="/criacao/planejamento" search={{ modelo: id }} className="shrink-0 text-xs text-primary underline-offset-2 hover:underline">
      abrir card
    </Link>
  );
}
function Leitura({ texto, info, aviso, travado, cardId, selo }: {
  texto: string; info?: string | null; aviso?: string | null; travado?: boolean; cardId?: string; selo?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      {travado && <Lock className="h-4 w-4 shrink-0 text-muted-foreground" role="img" aria-label="Travado" />}
      <span className={cn("max-w-[16rem] truncate", texto === "—" && "text-muted-foreground")} title={texto}>{texto}</span>
      {selo}
      {info && <InfoHover ariaLabel="Informação do campo">{info}</InfoHover>}
      {aviso && <InfoHover ariaLabel="Mudou depois do retrato" className="text-[var(--tone-warning-fg)]">{aviso}</InfoHover>}
      {cardId && <AbrirCard id={cardId} />}
    </div>
  );
}
/** I3/Important (edição pendente escondida): quando a célula está em modo LEITURA (trava/gate fechado) mas a
 *  coluna tem uma edição pendente no rascunho (`colunasAlteradas`), mostra o valor do RASCUNHO com realce âmbar +
 *  "descartar alteração" — em vez do valor do servidor, que faria a edição sumir sem aviso e o Salvar falhar
 *  42501 no lote inteiro sem forma de desfazer na célula. */
function LeituraComPendencia({ texto, motivo, cardId, onDescartar }: {
  texto: string; motivo: string | null; cardId?: string; onDescartar: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1 rounded bg-[var(--tone-warning-bg)] px-1">
        <span className="max-w-[16rem] truncate" title={texto}>{texto}</span>
        {motivo && <InfoHover ariaLabel="Sua alteração não pode ser salva">{`Sua alteração não pode ser salva: ${motivo}`}</InfoHover>}
        {cardId && <AbrirCard id={cardId} />}
      </div>
      <Button type="button" variant="link" size="sm" className="h-auto w-fit p-0 text-xs" onClick={onDescartar}>
        descartar alteração
      </Button>
    </div>
  );
}
function sublinhaDe(p: ProdutoLista, indice: number): Sublinha | undefined {
  const l = linhasVariante(p)[indice];
  return l ? p.sublinhas.find((s) => s.varianteKey === l.varianteKey && s.tamanhoKey === l.tamanhoKey) : undefined;
}

/** SKU da sublinha — mesmas 3 ações da seção Códigos (`CodigosSecao.tsx:245-257`): "Desfazer o SKU digitado"
 *  (`semManualSku`), "manter o meu" (`manterMeuSku`, adota id/rev NOVOS da linha) e "usar o novo" (`semManualSku`,
 *  descarta o manual) em conflito de versão. Input CONTROLADO por chave estável `variante|tamanho` (I6) — nunca
 *  `defaultValue`, então uma relista nunca troca o texto de linha. */
function SkuCelula({ p, indice, r, previa, salvando, onAtualizar }: {
  p: ProdutoLista; indice: number; r: Rascunho; previa: PreviaSkus | undefined; salvando: boolean;
  onAtualizar: (f: (r: Rascunho) => Rascunho) => void;
}) {
  const sub = sublinhaDe(p, indice);
  const travadoEstado = p.estado !== "nao_integravel";
  // M4/Minor (code-review): sem "Tamanho em" definido no card, esse SKU nunca entra na prévia nem no passo 3 do
  // Salvar (`entradaSkus` devolve null) — a célula não oferece uma edição que nunca grava.
  const semTamanhoTipo = p.raw.tamanho_tipo === null;
  const editavel = !travadoEstado && p.gates.sku.ok && !semTamanhoTipo && !salvando && !!sub;
  const [texto, setTexto] = useState<string | null>(null);
  if (!editavel || !sub) {
    const motivo = travadoEstado
      ? (p.estado === "integrado" ? TEXTO_TRAVADO_INTEGRADO : TEXTO_TRAVADO_INTEGRAVEL)
      : salvando ? TEXTO_SALVANDO
      : semTamanhoTipo ? "Defina \"Tamanho em\" no card para editar o SKU."
      : !p.gates.sku.ok ? p.gates.sku.motivo
      : null;
    return <Leitura texto={valorCelula(p, "ref_sku", indice)} travado={travadoEstado} info={motivo} />;
  }
  const linha = linhaSkuDaSublinha(sub);
  const chave = chaveLinhaSku(sub.varianteKey, sub.tamanhoKey);
  const exibido = skuExibido(linha, r.skus);
  const digitado = r.skus.manuais[chave];
  const lp = previa?.matriz.linhas.find((x) => x.variante_key === sub.varianteKey && x.tamanho_key === sub.tamanhoKey);
  // M2/Minor (code-review): a prévia só conta se pertence à entrada ATUAL do rascunho (compara `previa.entrada`
  // com a chave calculada de agora) — senão mostra "calculando…" em vez da situação de um plano velho (ex.: "igual"
  // para um SKU acabado de digitar, herdado do debounce de 300ms). A chave tem que ser EXATAMENTE a que
  // `usePreviasSkus`/`entradaSkus` (useIntegracao.ts/salvar-integracao.ts) calculam: `r.valores.ref` aparado e
  // `r.tamanhoTipo` do RASCUNHO — nunca `p.raw.*` (o produto salvo), senão a comparação nunca bate.
  const entradaAtual = useMemo(
    () => chaveEntradaPrevia({ ref: String(r.valores.ref ?? "").trim(), tamanhoTipo: r.tamanhoTipo ?? "letra", aGravar: r.skus, virgem: false }),
    [r.valores.ref, r.tamanhoTipo, r.skus],
  );
  const previaAtual = previa?.entrada === entradaAtual;
  const sit = digitado && lp && previaAtual ? situacaoPrevia(lp as LinhaPrevia, previa?.erros ?? []) : null;
  const calculando = digitado && !previaAtual;
  return (
    <div className="flex min-w-[10rem] flex-col gap-1">
      <Input
        // Input CONTROLADO (I6): o valor vem do estado local `texto` (rascunho de digitação) até o blur confirmar;
        // sincroniza com `exibido` quando NADA foi digitado ainda nesta sessão de foco (mesmo padrão do `SkuCampo`
        // do Sheet, `CodigosSecao.tsx:43-45` — mas sem useEffect: o valor derivado evita o flash de um valor velho).
        value={texto ?? exibido}
        aria-label={`SKU — ${p.raw.nome} · ${sub.corNome ?? "variante"} · ${sub.tamanho ?? "tamanho"}`}
        className={cn("h-8", digitado && "bg-[var(--tone-warning-bg)]")}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        onBlur={(e) => {
          // M1/Minor (code-review): calcula dentro do updater, sobre o `x.skus` MAIS RECENTE (nunca o `r` capturado
          // no render que criou este handler) — evita perder uma escrita concorrente em `skus`.
          const v = e.target.value;
          setTexto(null);
          onAtualizar((x) => {
            const out = digitarSku(x.skus, linha, v);
            if (out.erro) {
              toast.error(out.erro);
              return x;
            }
            return out.aGravar === x.skus ? x : comSkus(x, out.aGravar);
          });
        }}
      />
      <span className="inline-flex flex-wrap items-center gap-1 text-xs">
        {calculando ? (
          <span className="text-muted-foreground">calculando…</span>
        ) : sit ? (
          <StatusBadge tone={sit.tom} className="normal-case tracking-normal">{sit.texto}</StatusBadge>
        ) : null}
        {digitado && !sit?.conflitoVersao && (
          <Button type="button" variant="ghost" size="iconSm" aria-label="Desfazer o SKU digitado" title="Desfazer o SKU digitado"
            onClick={() => onAtualizar((x) => comSkus(x, semManualSku(x.skus, chave)))}>
            ↺
          </Button>
        )}
      </span>
      {sit?.conflitoVersao && (
        <span className="flex flex-wrap gap-2 text-xs">
          <Button type="button" variant="outline" size="sm" onClick={() => onAtualizar((x) => comSkus(x, manterMeuSku(x.skus, linha)))}>
            manter o meu
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onAtualizar((x) => comSkus(x, semManualSku(x.skus, chave)))}>
            usar o novo
          </Button>
        </span>
      )}
    </div>
  );
}

function CelulaSublinha({ campo, p, indice, r, previa, salvando, onAtualizar }: {
  campo: CampoDef; p: ProdutoLista; indice: number; r: Rascunho; previa: PreviaSkus | undefined; salvando: boolean;
  onAtualizar: (f: (r: Rascunho) => Rascunho) => void;
}) {
  if (campo.key === "ref_sku") return <SkuCelula p={p} indice={indice} r={r} previa={previa} salvando={salvando} onAtualizar={onAtualizar} />;
  const texto = valorCelula(p, campo.key, indice);
  if (campo.soVariante) {
    const sub = sublinhaDe(p, indice);
    const semApelido = campo.key === "cor_apelido" && !sub?.apelidoNome && !!sub?.corNome;
    return <Leitura texto={texto} info={semApelido ? "sem apelido — não bloqueia" : (campo.info ?? null)} cardId={p.modeloId} />;
  }
  return <span className="text-muted-foreground">{texto}</span>;
}

/** Quanto tempo esperar o nome da loja antes de considerar a query travada/falha (Minor M6, code-review):
 *  `useTenantBranding` não expõe `isError`/`isLoading` (fora do escopo tocar o hook — não está em permitidos.txt),
 *  então não há como distinguir "ainda carregando" de "falhou pra sempre" por status da query. Um timeout é a
 *  única defesa possível sem mexer no hook: depois de alguns segundos com `nome` ainda null, considera "travado"
 *  e libera a edição em vez de desabilitar o campo para sempre. */
const TIMEOUT_LOJA_MS = 8000;

/** Célula do Título (produto, `indice===null`): controlador — NÃO usa o `editar` genérico de `rascunho.ts`.
 *  `editarTitulo`/`sairTitulo` precisam do nome da loja a cada chamada (nunca guardado em estado, senão ficaria
 *  stale). Enquanto `nomeLoja` é null (loading), a célula fica DESABILITADA com um hint curto. Minor (code-review,
 *  M6): se a query nunca resolver (erro de rede, sem linha em `tenants`), `disabled` para sempre travaria o campo
 *  pra sempre; depois de `TIMEOUT_LOJA_MS` sem resolver, a célula libera a edição (sem a regra de colapso
 *  automático — o texto digitado fica exatamente como está) e avisa com um hint. */
function CelulaTitulo({ p, r, salvando, modo, onAtualizar }: {
  p: ProdutoLista; r: Rascunho; salvando: boolean;
  modo: ReturnType<typeof modoCelula>; onAtualizar: (f: (r: Rascunho) => Rascunho) => void;
}) {
  const { nome: nomeLoja } = useTenantBranding();
  const [travadoPorTimeout, setTravadoPorTimeout] = useState(false);
  useEffect(() => {
    if (nomeLoja !== null) return;
    const t = setTimeout(() => setTravadoPorTimeout(true), TIMEOUT_LOJA_MS);
    return () => clearTimeout(t);
  }, [nomeLoja]);
  const aviso = avisoRetrato(p, "titulo");
  const col: ColunaEditavel = "titulo_pagina";
  const pendente = colunasAlteradas(r).includes(col);
  if (modo.tipo === "leitura") {
    if (pendente) {
      return (
        <LeituraComPendencia texto={String(r.valores.titulo_pagina ?? "—")} motivo={modo.motivo}
          onDescartar={() => onAtualizar((x) => usarNovo(x, col))} />
      );
    }
    const automatico = p.raw.titulo_pagina === null;
    return (
      <Leitura texto={valorCelula(p, "titulo", null)} info={modo.motivo} aviso={aviso} travado={modo.travado}
        selo={automatico ? <StatusBadge tone="neutral" className="normal-case tracking-normal">automático</StatusBadge> : null} />
    );
  }
  // Sem o nome (loading) e ainda dentro do prazo: desabilita. Depois de `TIMEOUT_LOJA_MS`, libera a edição (rede de
  // segurança de `editarTitulo`/`sairTitulo` para `nomeLoja===null`: nunca colapsa o digitado pra NULL nem confunde
  // "Nome" puro com automático).
  const carregandoLoja = nomeLoja === null && !travadoPorTimeout;
  const alterada = pendente;
  const conflito = r.conflitos.find((c) => c.path === col);
  const automatico = r.valores.titulo_pagina === null;
  const calculado = nomeLoja === null ? "" : tituloCalculadoDoRascunho(r, nomeLoja);
  const exibido = tituloExibido(r.valores.titulo_pagina, calculado);
  const realce = cn(alterada && "bg-[var(--tone-warning-bg)]", conflito && "ring-2 ring-[var(--tone-warning-fg)]");
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1">
        <Input
          aria-label={`Título para a página — ${p.raw.nome}`}
          className={cn("h-8 min-w-[14rem]", realce)}
          value={exibido}
          disabled={carregandoLoja || salvando}
          onChange={(e) => {
            // Minor (code-review, M3): captura o valor ANTES do updater (não depende de o React manter
            // `e.target.value` vivo até o updater rodar — o Sheet faz igual em `InfoGeraisSecao.tsx:236`).
            const v = e.target.value;
            onAtualizar((x) => editarTitulo(x, v, nomeLoja));
          }}
          onBlur={() => onAtualizar((x) => sairTitulo(x, nomeLoja))}
        />
        {automatico && !carregandoLoja && (
          <StatusBadge tone="neutral" className="shrink-0 normal-case tracking-normal">automático</StatusBadge>
        )}
        {carregandoLoja && <InfoHover ariaLabel="Aguardando o nome da loja">Carregando o nome da loja — aguarde para editar o título.</InfoHover>}
        {travadoPorTimeout && nomeLoja === null && (
          <InfoHover ariaLabel="Não foi possível carregar o nome da loja">
            Não foi possível carregar o nome da loja — o automático pode ficar sem o "| Loja". Recarregue a página para tentar de novo.
          </InfoHover>
        )}
        {aviso && <InfoHover ariaLabel="Mudou depois do retrato" className="text-[var(--tone-warning-fg)]">{aviso}</InfoHover>}
      </div>
      {conflito && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-[var(--tone-warning-fg)]">Outra pessoa mudou este campo.</span>
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onAtualizar((x) => manterMeu(x, col))}>
            manter o meu
          </Button>
          <span aria-hidden>·</span>
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onAtualizar((x) => usarNovo(x, col))}>
            usar o novo
          </Button>
        </div>
      )}
    </div>
  );
}

export function CelulaCampo({ campo, produto: p, indice, rascunho: r, previa, salvando, onAtualizar, onKeywords, onFotos }: Props) {
  if (indice !== null) {
    return <CelulaSublinha campo={campo} p={p} indice={indice} r={r} previa={previa} salvando={salvando} onAtualizar={onAtualizar} />;
  }
  const modo = modoCelula(campo, p, salvando);
  const travado = modo.tipo === "leitura" && modo.travado;
  const aviso = avisoRetrato(p, campo.key);
  const selo = campo.key === "nome" && usaRetrato(p) ? <StatusBadge tone="neutral">retrato</StatusBadge> : null;
  if (campo.key === "titulo") {
    return <CelulaTitulo p={p} r={r} salvando={salvando} modo={modo} onAtualizar={onAtualizar} />;
  }
  if (campo.tipo === "somente_leitura") {
    const info = campo.key === "preco_custo" ? infoCusto(p.origem) : (campo.info ?? null);
    return <Leitura texto={valorCelula(p, campo.key, null)} info={info} aviso={aviso} travado={travado} cardId={p.modeloId} />;
  }
  if (campo.key === "metatag") {
    const texto = p.estado === "nao_integravel" ? (String(r.valores.descricao_produto ?? "").trim() || "—") : valorCelula(p, "metatag", null);
    return <Leitura texto={texto} info={campo.info ?? null} aviso={aviso} travado={travado} />;
  }
  if (campo.key === "keywords") {
    // Minor 4 (task review) — Keywords é da LOJA (tenant_config.keywords), não do produto: o gate do servidor
    // (`_integracao_gates`, chave `keywords`) usa `v_int` (permissão de ver a Integração), NUNCA o `estado` da
    // linha — então "editar" fica disponível em QUALQUER linha, mesmo travada (senão, com o filtro "Integrados",
    // Keywords ficaria inalcançável: a célula é o único ponto de entrada até a T12b trazer um de fora das linhas).
    const g = p.gates.keywords;
    const pode = g.ok && !salvando;
    return (
      <div className="flex min-w-0 items-center gap-1">
        <span className="max-w-[14rem] truncate">{valorCelula(p, "keywords", null)}</span>
        {pode ? (
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onKeywords}>editar</Button>
        ) : (
          <InfoHover ariaLabel="Por que não edita">{salvando ? TEXTO_SALVANDO : (g.motivo ?? "Sem permissão.")}</InfoHover>
        )}
        {aviso && <InfoHover ariaLabel="Mudou depois do retrato" className="text-[var(--tone-warning-fg)]">{aviso}</InfoHover>}
      </div>
    );
  }
  const col = campo.coluna as ColunaEditavel;
  const pendente = colunasAlteradas(r).includes(col);
  if (modo.tipo === "leitura") {
    // I3/Important (code-review): uma edição pendente que um gate FECHOU depois (ex.: REF travada pelo envio à
    // Explosão enquanto a pessoa ainda tinha o rascunho aberto) não pode sumir da tela — senão o Salvar falha
    // 42501 no lote inteiro sem forma de desfazer nesta célula.
    if (pendente) {
      return (
        <LeituraComPendencia texto={String(r.valores[col] ?? "—")} motivo={modo.motivo} cardId={p.modeloId}
          onDescartar={() => onAtualizar((x) => usarNovo(x, col))} />
      );
    }
    // Preço anterior automático (controlador): raw NULL = o servidor já grava o valor automático em vivo/retrato
    // (`valorCelula` lê pronto); aqui só soma o badge "automático", sem mexer no texto.
    const automaticoLeitura = campo.key === "preco_anterior" && p.raw.preco_anterior === null;
    const seloComAutomatico = automaticoLeitura
      ? <StatusBadge tone="neutral" className="normal-case tracking-normal">automático</StatusBadge>
      : selo;
    return (
      <Leitura texto={valorCelula(p, campo.key, null)} info={modo.motivo} aviso={aviso} travado={modo.travado} selo={seloComAutomatico} />
    );
  }
  const alterada = pendente;
  const conflito = r.conflitos.find((c) => c.path === col);
  const info = infoEdicao(campo, p);
  const set = (v: string | number | null) => onAtualizar((x) => editar(x, col, v as never));
  const realce = cn(alterada && "bg-[var(--tone-warning-bg)]", conflito && "ring-2 ring-[var(--tone-warning-fg)]");
  const ariaLabel = `${campo.rotulo} — ${p.raw.nome}`;
  let controle: ReactNode;
  if (campo.tipo === "fotos") {
    controle = (
      <Button type="button" variant="outline" size="sm" className={realce} onClick={onFotos} disabled={salvando} aria-label={ariaLabel}>
        {textoFotos(r.valores.fotos_modelo.length)} · trocar/adicionar/remover
      </Button>
    );
  } else if (campo.tipo === "dinheiro") {
    // I1/Important (peso/medidas usam esse mesmo ramo pra dinheiro): MoneyInput já era usado aqui — placeholder
    // troca para o automático quando "Preço anterior" está em modo automático (Minor 1/M5, task review).
    const automatico = campo.key === "preco_anterior" && r.valores.preco_anterior === null;
    const placeholder = automatico ? valorCelula(p, "preco_anterior", null).replace(/^R\$\s*/, "") : "0,00";
    controle = (
      <MoneyInput fixedDecimals aria-label={ariaLabel} placeholder={placeholder} disabled={salvando}
        className={cn("h-8 w-28 text-right tabular-nums", realce)}
        value={(r.valores[col] as number | null) ?? ""}
        onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))} />
    );
  } else if (campo.tipo === "peso" || campo.tipo === "medida") {
    // I1/Important (code-review): MoneyInput com casas fixas (3 no peso, 2 nas medidas), igual ao card
    // (`InfoGeraisSecao.tsx:43-50`) — vazio emite "" (`set` converte pra NULL, nunca 0) e negativo é bloqueado pela
    // própria máscara do MoneyInput (nunca chega a `payloadItem`, então nunca aborta o lote inteiro no servidor).
    const casas = campo.tipo === "peso" ? 3 : 2;
    controle = (
      <MoneyInput fixedDecimals decimals={casas} aria-label={ariaLabel} placeholder={casas === 3 ? "0,000" : "0,00"} disabled={salvando}
        className={cn("h-8 w-24 text-right tabular-nums", realce)}
        value={(r.valores[col] as number | null) ?? ""}
        onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))} />
    );
  } else if (campo.tipo === "texto_longo") {
    controle = (
      <Textarea aria-label={ariaLabel} rows={2} disabled={salvando} className={cn("min-h-8 min-w-[14rem] text-xs", realce)}
        value={String(r.valores[col] ?? "")} onChange={(e) => set(e.target.value)} />
    );
  } else if (campo.key === "ncm") {
    // I5/Important (code-review): mesmo filtro do card (`filtrarNcm`, helpers.ts) — só dígitos e pontos, vírgula
    // vira ponto, até 10 caracteres. Sem isso, texto livre gravava e ia pra API.
    controle = (
      <Input aria-label={ariaLabel} inputMode="decimal" placeholder="0000.00.00" disabled={salvando}
        className={cn("h-8 min-w-[9rem]", realce)}
        value={String(r.valores[col] ?? "")} onChange={(e) => set(filtrarNcm(e.target.value) || null)} />
    );
  } else {
    controle = (
      <Input aria-label={ariaLabel} disabled={salvando} className={cn("h-8 min-w-[9rem]", realce)}
        value={String(r.valores[col] ?? "")} onChange={(e) => set(e.target.value)} />
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1">
        {controle}
        {info && <InfoHover ariaLabel="Sobre este campo">{info}</InfoHover>}
      </div>
      {conflito && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-[var(--tone-warning-fg)]">Outra pessoa mudou este campo.</span>
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onAtualizar((x) => manterMeu(x, col))}>
            manter o meu
          </Button>
          <span aria-hidden>·</span>
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onAtualizar((x) => usarNovo(x, col))}>
            usar o novo
          </Button>
        </div>
      )}
    </div>
  );
}
