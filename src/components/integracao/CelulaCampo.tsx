// Integração — uma célula da aba Produtos (linha do produto ou sublinha variante × tamanho). Edita SÓ o rascunho (staging);
// `modoCelula`/`travaOuGate` decidem editar × ler. Custo, cor, apelido e tamanho: só leitura com "i" + "abrir card"
// (P-80 A). Linha integrável/integrada: RETRATO + cadeado; "i" âmbar quando o vivo difere (N10). SKU da sublinha: digitado
// vira "a gravar" (mesmas regras da seção Códigos, incluindo desfazer/conflito) e a prévia do servidor diz a situação.
//
// Adaptações do controlador sobre o brief da Task 12a (ver task-12a-report.md):
// - Título: NÃO usa o `editar` genérico — usa `tituloExibido`/`editarTitulo`/`sairTitulo` (rascunho.ts), passando
//   `nomeLoja` de `useTenantBranding().nome` a cada chamada (nunca guardado em estado). Célula DESABILITADA enquanto
//   `nome` ainda é null (loading), com um hint curto — evita editar o título antes do automático poder ser calculado.
// - Título e "Preço anterior" em modo automático (raw NULL): mostram o valor automático + selo "automático".
// - Reprovado: badge fica na coluna Estado (ProdutosTabela), não aqui.
//
// Fix round 1 (task-12a-report.md "Fix round 1"): Reprovado por estado, InfoHover cn(), SKU desfazer/conflito,
// MoneyInput em peso/medidas, edição pendente sob trava, NCM filtrado, sublinhas por chave estável.
//
// Fix round 2 (task-12a-report.md "Fix round 2"; reviews: task-12a-review.md "Re-review round 1" + task-12a-code-
// review.md "Re-check round 1"):
// - CRÍTICO (C1/R1): `SkuCelula` tinha um `useMemo` DEPOIS de um `return` condicional — alternar editável↔leitura
//   (o que acontece em TODO Salvar, via `salvando`) trocava a contagem de hooks e derrubava a rota
//   ("Rendered fewer/more hooks than expected"). Corrigido separando a parte editável em `SkuCelulaEditavel`
//   (hooks só ali, incondicionais) — `SkuCelula` decide qual renderizar SEM nenhum hook próprio.
// - R1-1/R2: "salvando" deixou de cair na UI de `LeituraComPendencia` ("Sua alteração não pode ser salva" +
//   "descartar"). Essa UI agora só aparece por trava/gate real (`travaOuGate`, de `celula.ts`); durante o Salvar,
//   a célula mostra o CONTROLE normal desabilitado com o valor do RASCUNHO (nunca a mensagem de erro nem o botão
//   de descartar, e nunca o valor antigo do servidor).
// - R1-2: o selo "automático" do Preço anterior editável VOLTOU (tinha sumido no round 1, deixando só o
//   placeholder) — mostra as duas coisas, como o header sempre disse.
// - R3: "manter o meu" do SKU agora usa a linha da PRÉVIA (`lp`), não a da lista (`linha`, com `rev` desatualizado
//   — `aplicar_skus_modelo` não faz UPDATE em `modelos`, então a relista por Realtime nunca traria o rev novo).
// - Minors: `RotateCcw` no lugar do glifo "↺"; `LeituraComPendencia` formata o valor (dinheiro/peso/fotos) em vez
//   de mostrar o texto cru; nenhum `toast` dentro do updater; o selo "automático" de leitura só aparece quando
//   `!usaRetrato(p)` (concorda com o texto do retrato mostrado); toda célula travada mostra o texto da trava via
//   `InfoHover`.
//
// T12b (carry.md — minors n1-n7 da revisão T12a round 2 + achado próprio "usar o novo do SKU"):
// - n1: a sublinha do SKU, quando só `salvando` bloqueia (linha aberta, gate ok, "Tamanho em" definido), mostra
//   `skuExibido` do RASCUNHO em vez do `valorCelula` do servidor — a digitação pendente não "some" durante o Salvar.
// - n2: o placeholder do automático de "Preço anterior" usa o preço de venda do RASCUNHO (`r.valores.preco_venda`),
//   nunca o salvo no servidor.
// - n3: um título pendente que voltou a automático (NULL) mostra o TÍTULO CALCULADO na pendência, não "—".
// - n4: os botões "manter o meu · usar o novo" (Título e campo genérico) ganharam `disabled={salvando}`.
// - n7: o selo "automático" do Preço anterior usa `precoAnteriorOuNull` (não `=== null` cru) — um 0 digitado
//   também é automático.
// - "usar o novo" do SKU: `SkuCelulaEditavel` prefere a linha da PRÉVIA (`lp`) sobre a da lista (`linha`) para
//   `skuExibido` — o SKU novo aparece na hora, sem esperar o Realtime relistar `modelos`.
// - n5/n6 (testes): ver `integracao-celula.test.ts` — `IS_REACT_ACT_ENVIRONMENT` setado no topo do arquivo, e os 2
//   testes de texto de trava agora abrem o tooltip via foco e conferem o texto `TEXTO_TRAVADO_*` de verdade.
//
// Preço anterior e Título por VERSÃO (P-146..P-159, R4): a célula recebe `versaoAnterior` (a linha da RPC
// `modelos_versao_anterior`, pelo `useIntegracao`). Título: o automático da v2+ é o HERDADO (selo "herdado da vN") e o
// colapso "digitou igual ao automático" compara com ELE; desabilitado enquanto a versão anterior carrega. Preço anterior
// (edição automática): placeholder = o preço da vN; "—" + "aguardando preço da vN" quando ela não tem preço (P-158); sem
// anterior, o preço de venda do RASCUNHO (n2) — vazio = "aguardando preço de venda" (M4). Leitura: o valor já vem do
// vivo/retrato; só o selo ganha a versão/"aguardando" quando a linha mostra o VIVO.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Lock, RotateCcw } from "lucide-react";
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
import { filtrarNcm, precoAnteriorOuNull } from "@/components/planejamento/planejamento-detail/helpers";
import { infoCusto, type CampoDef, type ColunaEditavel } from "@/lib/integracao/campos";
import { infoEdicao, travaOuGate, TEXTO_TRAVADO_INTEGRADO, TEXTO_TRAVADO_INTEGRAVEL } from "@/lib/integracao/celula";
import {
  avisoRetrato, formatarValor, linhasVariante, textoFotos, usaRetrato, valorCelula, type ProdutoLista, type Sublinha,
} from "@/lib/integracao/produtos";
import {
  colunasAlteradas, comSkus, editar, editarTitulo, linhaSkuDaSublinha, manterMeu, sairTitulo,
  tituloCalculadoDoRascunho, usarNovo, type Rascunho,
} from "@/lib/integracao/rascunho";
import { tituloExibido } from "@/lib/titulo-pagina";
import {
  precoAnteriorAutomatico, seloPrecoAnterior, seloTitulo, tituloAutomatico as tituloAutomaticoDe, hoverTituloHerdado,
  type VersaoAnteriorInfo,
} from "@/lib/versao-anterior";
import {
  chaveEntradaPrevia, chaveLinhaSku, digitarSku, manterMeu as manterMeuSku, semManual as semManualSku,
  situacaoPrevia, skuExibido, type LinhaPrevia, type PreviaSkus,
} from "@/components/planejamento/planejamento-detail/codigos/sku-previa";

/** A versão anterior do produto (P-146/P-155 B): `info` null = v1/órfã; `carregando` = a RPC ainda não voltou. */
export type VersaoCelula = { info: VersaoAnteriorInfo; carregando: boolean };
type Props = {
  campo: CampoDef; produto: ProdutoLista; indice: number | null; rascunho: Rascunho; previa: PreviaSkus | undefined;
  salvando: boolean; onAtualizar: (f: (r: Rascunho) => Rascunho) => void; onKeywords: () => void; onFotos: () => void;
  versaoAnterior?: VersaoCelula;
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
/** Fix round 2 (R2): SÓ para trava/gate real (`travaOuGate`) — NUNCA para `salvando` (ver o comentário de
 *  `travaOuGate` em celula.ts). Quando a coluna tem uma edição pendente no rascunho (`colunasAlteradas`) mas um
 *  gate FECHOU depois da edição (ex.: REF travada pelo envio à Explosão), mostra o valor do RASCUNHO — formatado
 *  como o CAMPO exige (dinheiro/peso/fotos), nunca o texto cru — com realce âmbar + "descartar alteração". */
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
/** Formata o valor do RASCUNHO igual ao que a célula editável mostraria (dinheiro/peso/medida em BR, fotos como
 *  contagem, texto como está) — nunca o valor cru (Minor R6, code-review: "179.9"/caminhos do Storage/`novo:<id>`). */
function valorRascunhoFormatado(campo: CampoDef, col: ColunaEditavel, r: Rascunho): string {
  if (col === "fotos_modelo") return textoFotos(r.valores.fotos_modelo.length);
  const v = r.valores[col];
  if (campo.tipo === "dinheiro" || campo.tipo === "peso" || campo.tipo === "medida") {
    return formatarValor(campo.key, v === null || v === undefined ? null : String(v));
  }
  const s = String(v ?? "").trim();
  return s === "" ? "—" : s;
}
function sublinhaDe(p: ProdutoLista, indice: number): Sublinha | undefined {
  const l = linhasVariante(p)[indice];
  return l ? p.sublinhas.find((s) => s.varianteKey === l.varianteKey && s.tamanhoKey === l.tamanhoKey) : undefined;
}

/** Parte EDITÁVEL do SKU — só é montada quando `editavel && sub` (checado por `SkuCelula`, sem hooks). Todo hook
 *  mora aqui, incondicional: separar este componente é o que fecha o Critical do round 2 (C1/R1 — um `useMemo`
 *  depois de um `return` condicional derrubava a rota a cada Salvar). */
function SkuCelulaEditavel({ p, r, sub, previa, onAtualizar }: {
  p: ProdutoLista; r: Rascunho; sub: Sublinha; previa: PreviaSkus | undefined;
  onAtualizar: (f: (r: Rascunho) => Rascunho) => void;
}) {
  const [texto, setTexto] = useState<string | null>(null);
  // Fix round 1 T12b (A-I3) — snapshot do SKU novo capturado no clique de "usar o novo": SEM manual nenhum
  // restando no produto (o caso TÍPICO: 1 SKU digitado em conflito, era o ÚNICO), `temSkuAGravar(r)` vira `false`
  // e `usePreviasSkus` PARA de consultar a prévia deste produto — `previa`/`lp` ficam `undefined` no PRÓXIMO
  // render, e sem este snapshot `exibido` cairia de volta no `sub.sku` da LISTA (o valor stale que causou o
  // conflito, só corrigido na PRÓXIMA relista por Realtime — que nem sempre chega, ver o comentário de
  // `aplicar_skus_modelo` mais abaixo). Guardado POR CHAVE (variante×tamanho) — nunca pisa em outra sublinha.
  // Fix round 2 T12b (minor m-R6): a v1 só limpava o snapshot quando `sub.sku` chegava a ser EXATAMENTE o valor
  // snapshotado — se o servidor relistasse com um TERCEIRO valor (ex.: alguém regerou o SKU de novo antes do
  // Realtime confirmar o primeiro), a lista nunca mais bateria com o snapshot, e a célula ficava presa mostrando o
  // valor VELHO (o snapshotado) pra sempre enquanto montada, mesmo com um dado mais novo disponível. Agora guarda
  // também o `sku` da lista NO MOMENTO do snapshot (`skuNaHora`) — o snapshot cai assim que `sub.sku` MUDAR desse
  // valor de referência, pra QUALQUER lado (bateu com o esperado OU virou um terceiro valor: dos dois jeitos, a
  // lista teve uma atualização de verdade, e ela vira a fonte mais atual outra vez).
  const [usadoNovo, setUsadoNovo] = useState<Record<string, { valor: string; skuNaHora: string | null }>>({});
  const linha = linhaSkuDaSublinha(sub);
  const chave = chaveLinhaSku(sub.varianteKey, sub.tamanhoKey);
  const digitado = r.skus.manuais[chave];
  const lp = previa?.matriz.linhas.find((x) => x.variante_key === sub.varianteKey && x.tamanho_key === sub.tamanhoKey);
  // Updater FUNCIONAL (lê o `usadoNovo` mais recente de DENTRO do `setState`, nunca da closure) — assim o efeito só
  // precisa de `sub.sku`/`chave` nas deps, sem violar exhaustive-deps nem arriscar reagir a toda troca de
  // referência de `usadoNovo`.
  useEffect(() => {
    setUsadoNovo((s) => {
      const atual = s[chave];
      if (atual === undefined || sub.sku === atual.skuNaHora) return s;
      const { [chave]: _omitido, ...resto } = s;
      return resto;
    });
  }, [sub.sku, chave]);
  // T12b (carry.md): "usar o novo" só limpa `r.skus.manuais` — sem nada mais, `skuExibido(linha, r.skus)` cairia de
  // volta no `sub.sku` da LISTA (o valor que causou o conflito, ainda desatualizado até a próxima relista). Quando
  // existe uma prévia (`lp`) ela já trouxe o SKU FRESCO do servidor (`skus_previa`, mesmo plano da gravação) — usá-la
  // no lugar de `linha` mostra o novo SKU na hora, sem esperar o Realtime relistar `modelos`. Fix round 1 T12b
  // (A-I3): sem `digitado` (a prévia parou de existir) mas com um snapshot de "usar o novo" pendente, mostra ELE.
  const exibido = digitado === undefined && usadoNovo[chave] !== undefined ? usadoNovo[chave].valor : skuExibido(lp ?? linha, r.skus);
  // M2/Minor (code-review, round 1): a prévia só conta se pertence à entrada ATUAL do rascunho (compara
  // `previa.entrada` com a chave calculada de agora) — senão mostra "calculando…" em vez da situação de um plano
  // velho. A chave tem que ser EXATAMENTE a que `usePreviasSkus`/`entradaSkus` calculam: `r.valores.ref` aparado e
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
        // Input CONTROLADO (I6, round 1): o valor vem do estado local `texto` até o blur confirmar; sincroniza com
        // `exibido` quando nada foi digitado ainda nesta sessão de foco.
        value={texto ?? exibido}
        aria-label={`SKU — ${p.raw.nome} · ${sub.corNome ?? "variante"} · ${sub.tamanho ?? "tamanho"}`}
        className={cn("h-8", digitado && "bg-[var(--tone-warning-bg)]")}
        onChange={(e) => {
          setTexto(e.target.value);
          // Digitar de novo cancela o snapshot de "usar o novo" pendente — o usuário está tomando outra decisão.
          if (usadoNovo[chave] !== undefined) setUsadoNovo((s) => { const { [chave]: _o, ...resto } = s; return resto; });
        }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        onBlur={(e) => {
          // R4/Minor (code-review, round 2): valida FORA do updater (só para decidir o toast — updaters devem ser
          // puros; StrictMode/uma reexecução dobraria o toast). A gravação em si continua dentro do updater, sobre
          // `x.skus` mais recente (M1/round 1 — nunca o `r` capturado no render que criou este handler).
          const v = e.target.value;
          setTexto(null);
          const preVerificacao = digitarSku(r.skus, linha, v);
          if (preVerificacao.erro) {
            toast.error(preVerificacao.erro);
            return;
          }
          onAtualizar((x) => {
            const out = digitarSku(x.skus, linha, v);
            return out.erro || out.aGravar === x.skus ? x : comSkus(x, out.aGravar);
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
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
      </span>
      {sit?.conflitoVersao && (
        <span className="flex flex-wrap gap-2 text-xs">
          <Button type="button" variant="outline" size="sm"
            // R3/Important (code-review, round 2): usa a linha da PRÉVIA (`lp`), não a da lista (`linha`) — o
            // `rev` da lista fica PRESO no valor antigo porque `aplicar_skus_modelo` nunca faz UPDATE em
            // `modelos`, então o Realtime (que só escuta `modelos`) nunca traria o rev novo aqui. `lp` existe
            // sempre que `sit` existe (mesma condição acima). Como o Sheet faz em `CodigosSecao.tsx:88`.
            onClick={() => lp && onAtualizar((x) => comSkus(x, manterMeuSku(x.skus, lp as LinhaPrevia)))}>
            manter o meu
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => {
            // Fix round 1 T12b (A-I3): guarda o SKU FRESCO (`lp.sku`, a mesma fonte que `exibido` já usa enquanto a
            // prévia existe) ANTES de tirar o manual — assim, se este era o ÚNICO SKU digitado do produto (o caso
            // típico), a célula continua mostrando o valor novo mesmo depois que `usePreviasSkus` parar de
            // consultar a prévia (sem manual nenhum restando, `temSkuAGravar` vira `false`).
            // Fix round 2 T12b (minor m-R6): guarda também `sub.sku` de AGORA (`skuNaHora`) — o valor de
            // referência que o efeito de limpeza compara pra saber se a lista JÁ atualizou (pra qualquer lado),
            // não só se ela alcançou exatamente o valor snapshotado.
            const skuNovo = lp?.sku ?? null;
            if (skuNovo !== null) setUsadoNovo((s) => ({ ...s, [chave]: { valor: skuNovo, skuNaHora: sub.sku } }));
            onAtualizar((x) => comSkus(x, semManualSku(x.skus, chave)));
          }}>
            usar o novo
          </Button>
        </span>
      )}
    </div>
  );
}

/** SKU da sublinha — mesmas 3 ações da seção Códigos (`CodigosSecao.tsx:245-257`): "Desfazer o SKU digitado",
 *  "manter o meu"/"usar o novo" em conflito de versão. SEM hooks próprios (C1/round 2): só decide se monta
 *  `SkuCelulaEditavel` (que concentra todo hook, incondicional) ou a leitura. */
function SkuCelula({ p, indice, r, previa, salvando, onAtualizar }: {
  p: ProdutoLista; indice: number; r: Rascunho; previa: PreviaSkus | undefined; salvando: boolean;
  onAtualizar: (f: (r: Rascunho) => Rascunho) => void;
}) {
  const sub = sublinhaDe(p, indice);
  const travadoEstado = p.estado !== "nao_integravel";
  // M4/Minor (code-review, round 1): sem "Tamanho em" definido no card, esse SKU nunca entra na prévia nem no
  // passo 3 do Salvar (`entradaSkus` devolve null) — a célula não oferece uma edição que nunca grava.
  const semTamanhoTipo = p.raw.tamanho_tipo === null;
  const editavel = !travadoEstado && p.gates.sku.ok && !semTamanhoTipo && !salvando && !!sub;
  if (editavel && sub) {
    return <SkuCelulaEditavel p={p} r={r} sub={sub} previa={previa} onAtualizar={onAtualizar} />;
  }
  const motivo = travadoEstado
    ? (p.estado === "integrado" ? TEXTO_TRAVADO_INTEGRADO : TEXTO_TRAVADO_INTEGRAVEL)
    : salvando ? TEXTO_SALVANDO
    : semTamanhoTipo ? "Defina \"Tamanho em\" no card para editar o SKU."
    : !p.gates.sku.ok ? p.gates.sku.motivo
    : null;
  // n1 (carry.md, revisão T12a round 2): quando o ÚNICO motivo de cair na leitura é `salvando` (linha não travada,
  // gate aberto, "Tamanho em" definido, só o Salvar em voo), mostra o SKU do RASCUNHO (`skuExibido`, o mesmo que a
  // célula editável mostrava até agora) — nunca o `valorCelula` (a lista/servidor), que faria a digitação pendente
  // "sumir" até a relista. Nos outros casos (trava real, gate fechado, sem tamanho_tipo) o texto do servidor é o
  // único que faz sentido mostrar mesmo.
  const soSalvando = !travadoEstado && !semTamanhoTipo && p.gates.sku.ok && salvando && !!sub;
  const texto = soSalvando ? skuExibido(linhaSkuDaSublinha(sub), r.skus) : valorCelula(p, "ref_sku", indice);
  return <Leitura texto={texto} travado={travadoEstado} info={motivo} />;
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
 *  stale). Enquanto `nomeLoja` é null (loading), a célula fica DESABILITADA com um hint curto. */
function CelulaTitulo({ campo, p, r, salvando, onAtualizar, versaoAnterior }: {
  campo: CampoDef; p: ProdutoLista; r: Rascunho; salvando: boolean; onAtualizar: (f: (r: Rascunho) => Rascunho) => void;
  versaoAnterior?: VersaoCelula;
}) {
  const { nome: nomeLoja } = useTenantBranding();
  // P-155 B + R4: na v2+ o automático é o HERDADO (pronto do servidor) — é com ele que o colapso compara.
  const infoVersao = versaoAnterior?.info ?? null;
  const herdado = infoVersao ? (infoVersao.titulo_herdado ?? "") : null;
  const carregandoVersao = versaoAnterior?.carregando ?? false;
  const autoTitulo = tituloAutomaticoDe(infoVersao, r.valores.nome, nomeLoja);
  const hoverHerdado = hoverTituloHerdado(autoTitulo);
  const [travadoPorTimeout, setTravadoPorTimeout] = useState(false);
  useEffect(() => {
    if (nomeLoja !== null) return;
    const t = setTimeout(() => setTravadoPorTimeout(true), TIMEOUT_LOJA_MS);
    return () => clearTimeout(t);
  }, [nomeLoja]);
  const aviso = avisoRetrato(p, "titulo");
  const col: ColunaEditavel = "titulo_pagina";
  const pendente = colunasAlteradas(r).includes(col);
  // Fix round 2 (R2): a trava é decidida SÓ por `travaOuGate` (nunca por `salvando`) — "Salvando…" não vira
  // `LeituraComPendencia`. Usa o `campo` de verdade (o mesmo `CampoDef` de "titulo" que `ProdutosTabela` já
  // resolveu via `CAMPO_BY_KEY`), não um objeto reconstruído à mão.
  const trava = travaOuGate(campo, p);
  if (trava.tipo === "leitura") {
    if (pendente) {
      // n3 (carry.md, revisão T12a round 2): um título pendente que voltou a AUTOMÁTICO (`titulo_pagina` editado
      // para null) mostrava "—" (o fallback genérico) em vez do valor calculado — aqui `nomeLoja` já está disponível
      // (o campo Título só habilita depois que ele carrega), então dá pra mostrar o automático de verdade.
      const calculadoPendente = herdado ?? (nomeLoja === null ? "—" : tituloCalculadoDoRascunho(r, nomeLoja));
      return (
        <LeituraComPendencia texto={tituloExibido(r.valores.titulo_pagina, calculadoPendente)} motivo={trava.motivo}
          onDescartar={() => onAtualizar((x) => usarNovo(x, col))} />
      );
    }
    // Minor m5/M5(c) (code-review): o selo "automático" só aparece quando a linha mostra o VIVO (não o retrato) —
    // uma linha travada mostra o retrato, que pode discordar do `raw` vivo.
    const automatico = !usaRetrato(p) && p.raw.titulo_pagina === null && !carregandoVersao;
    return (
      <Leitura texto={valorCelula(p, "titulo", null)} info={trava.motivo} aviso={aviso} travado={trava.travado}
        selo={automatico ? <StatusBadge tone="neutral" className="normal-case tracking-normal">{seloTitulo(autoTitulo)}</StatusBadge> : null} />
    );
  }
  // Sem o nome (loading) e ainda dentro do prazo: desabilita. Depois de `TIMEOUT_LOJA_MS`, libera a edição (rede de
  // segurança de `editarTitulo`/`sairTitulo` para `nomeLoja===null`: nunca colapsa o digitado pra NULL nem confunde
  // "Nome" puro com automático).
  // O herdado (v2+) não depende do nome da loja; a v1 sim. A versão anterior carregando também desabilita (R4: sem ela,
  // o colapso compararia com o automático errado).
  const carregandoLoja = herdado === null && nomeLoja === null && !travadoPorTimeout;
  const conflito = r.conflitos.find((c) => c.path === col);
  const automatico = r.valores.titulo_pagina === null;
  const calculado = herdado ?? (nomeLoja === null ? "" : tituloCalculadoDoRascunho(r, nomeLoja));
  const exibido = tituloExibido(r.valores.titulo_pagina, calculado);
  const realce = cn(pendente && "bg-[var(--tone-warning-bg)]", conflito && "ring-2 ring-[var(--tone-warning-fg)]");
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1">
        <Input
          aria-label={`Título para a página — ${p.raw.nome}`}
          className={cn("h-8 min-w-[14rem]", realce)}
          value={carregandoVersao && automatico ? "…" : exibido}
          disabled={carregandoLoja || carregandoVersao || salvando}
          onChange={(e) => {
            // Minor (code-review, M3): captura o valor ANTES do updater (não depende de o React manter
            // `e.target.value` vivo até o updater rodar — o Sheet faz igual em `InfoGeraisSecao.tsx:236`).
            const v = e.target.value;
            onAtualizar((x) => editarTitulo(x, v, nomeLoja, herdado));
          }}
          onBlur={() => onAtualizar((x) => sairTitulo(x, nomeLoja, herdado))}
        />
        {automatico && !carregandoLoja && !carregandoVersao && (
          <StatusBadge tone="neutral" className="shrink-0 normal-case tracking-normal">{seloTitulo(autoTitulo)}</StatusBadge>
        )}
        {automatico && hoverHerdado && !carregandoVersao && <InfoHover ariaLabel="De onde vem o Título herdado?">{hoverHerdado}</InfoHover>}
        {carregandoVersao && <InfoHover ariaLabel="Aguardando a versão anterior">Carregando o Título da versão anterior — aguarde para editar.</InfoHover>}
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
          {/* n4 (carry.md, revisão T12a round 2): desabilitado durante o Salvar — o rascunho não pode mudar no meio
              de uma chamada já em voo (mesma classe de risco do R1-1: um clique durante o Salvar pareceria resolver
              o conflito, mas o servidor já recebeu o valor de antes desta decisão). */}
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" disabled={salvando} onClick={() => onAtualizar((x) => manterMeu(x, col))}>
            manter o meu
          </Button>
          <span aria-hidden>·</span>
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" disabled={salvando} onClick={() => onAtualizar((x) => usarNovo(x, col))}>
            usar o novo
          </Button>
        </div>
      )}
    </div>
  );
}

export function CelulaCampo({ campo, produto: p, indice, rascunho: r, previa, salvando, onAtualizar, onKeywords, onFotos, versaoAnterior }: Props) {
  if (indice !== null) {
    return <CelulaSublinha campo={campo} p={p} indice={indice} r={r} previa={previa} salvando={salvando} onAtualizar={onAtualizar} />;
  }
  // Fix round 2 (R2): `trava` decide SÓ trava/gate (nunca `salvando`) — é o que governa `LeituraComPendencia`.
  // Quando a trava/gate está aberta, `salvando` é tratado localmente por cada controle (`disabled={salvando}`),
  // nunca reaproveitando `modoCelula` para essa parte (evitaria a UI de pendência aparecer por engano — R2).
  const trava = travaOuGate(campo, p);
  const aviso = avisoRetrato(p, campo.key);
  const selo = campo.key === "nome" && usaRetrato(p) ? <StatusBadge tone="neutral">retrato</StatusBadge> : null;
  if (campo.key === "titulo") {
    return <CelulaTitulo campo={campo} p={p} r={r} salvando={salvando} onAtualizar={onAtualizar} versaoAnterior={versaoAnterior} />;
  }
  // Fix round 2 (m7/R7 — reviews): linha travada (integrável/integrado) mostra o CADEADO — mas até agora sem
  // nenhum texto explicando por quê nas células "somente_leitura por natureza" (custo/cor/tamanho) e na metatag.
  // Quando travado, o "i" prioriza o motivo da TRAVA (TEXTO_TRAVADO_*) sobre a info "natural" do campo (ex.: "Só
  // leitura — vem da cor do tecido…") — a trava é a informação mais relevante nesse estado.
  const motivoTrava = trava.tipo === "leitura" && trava.travado ? trava.motivo : null;
  const travado = trava.tipo === "leitura" && trava.travado;
  if (campo.tipo === "somente_leitura") {
    const infoNatural = campo.key === "preco_custo" ? infoCusto(p.origem) : (campo.info ?? null);
    return <Leitura texto={valorCelula(p, campo.key, null)} info={motivoTrava ?? infoNatural} aviso={aviso} travado={travado} cardId={p.modeloId} />;
  }
  if (campo.key === "metatag") {
    const texto = p.estado === "nao_integravel" ? (String(r.valores.descricao_produto ?? "").trim() || "—") : valorCelula(p, "metatag", null);
    return <Leitura texto={texto} info={motivoTrava ?? (campo.info ?? null)} aviso={aviso} travado={travado} />;
  }
  if (campo.key === "keywords") {
    // Minor 4 (task review) — Keywords é da LOJA (tenant_config.keywords), não do produto: o gate do servidor
    // (`_integracao_gates`, chave `keywords`) usa `v_int` (permissão de ver a Integração), NUNCA o `estado` da
    // linha — então "editar" fica disponível em QUALQUER linha, mesmo travada.
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
  if (trava.tipo === "leitura") {
    // I3/Important (code-review, round 1) + R2 (round 2): uma edição pendente que um gate FECHOU depois (ex.: REF
    // travada pelo envio à Explosão) não pode sumir da tela — mostra o RASCUNHO formatado + "descartar alteração".
    // Isto NUNCA olha `salvando` (round 2) — só a trava/gate real.
    if (pendente) {
      return (
        <LeituraComPendencia texto={valorRascunhoFormatado(campo, col, r)} motivo={trava.motivo} cardId={p.modeloId}
          onDescartar={() => onAtualizar((x) => usarNovo(x, col))} />
      );
    }
    // Preço anterior automático (controlador): raw NULL = o servidor já grava o valor automático em vivo/retrato
    // (`valorCelula` lê pronto); aqui só soma o badge "automático" quando a linha mostra o VIVO (m5/M5(c) — não
    // discordar do retrato numa linha travada).
    const automaticoLeitura = campo.key === "preco_anterior" && !usaRetrato(p) && p.raw.preco_anterior === null
      && !(versaoAnterior?.carregando ?? false);
    const seloLeitura = seloPrecoAnterior(null, precoAnteriorAutomatico(versaoAnterior?.info ?? null, p.raw.preco_venda));
    const seloComAutomatico = automaticoLeitura
      ? <StatusBadge tone={seloLeitura.tom} className="normal-case tracking-normal">{seloLeitura.texto}</StatusBadge>
      : selo;
    return (
      <Leitura texto={valorCelula(p, campo.key, null)} info={trava.motivo} aviso={aviso} travado={trava.travado} selo={seloComAutomatico} />
    );
  }
  // A partir daqui, a trava/gate está ABERTA — resta só o `disabled={salvando}` de cada controle abaixo (mostra o
  // valor do RASCUNHO desabilitado durante o Salvar, nunca a UI de pendência).
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
    // R1-2/Important (task review, round 2): o selo "automático" VOLTOU — some junto com o placeholder do
    // automático (não troca um pelo outro; o header sempre pediu os dois).
    // n7 (carry.md, revisão T12a round 2): `precoAnteriorOuNull` (não `=== null` cru) — um 0 digitado também grava
    // como automático (`payloadItem`/`precoNormalizado`), então o selo tem que refletir isso, não só o NULL literal.
    const automatico = campo.key === "preco_anterior" && precoAnteriorOuNull(r.valores.preco_anterior) === null;
    // n2 (carry.md, revisão T12a round 2): o placeholder do automático usa o preço de venda do RASCUNHO (a mesma
    // linha sendo editada agora), nunca o `valorCelula`/preço SALVO no servidor — o Sheet usa o `precoBase` do
    // draft pela mesma razão (`InfoGeraisSecao`/`PrecoTabela`: o automático acompanha o preço de venda ao vivo).
    // P-146/P-158: com versão anterior, o automático é o preço da vN ("—" + "aguardando preço da vN" sem ele); sem
    // anterior, o do rascunho — vazio = "aguardando preço de venda" (M4).
    const precoVendaRascunho = precoAnteriorOuNull(r.valores.preco_venda) ?? Number(r.valores.preco_venda ?? 0);
    const carregandoVersao = campo.key === "preco_anterior" && (versaoAnterior?.carregando ?? false);
    const autoAnterior = precoAnteriorAutomatico(versaoAnterior?.info ?? null, precoVendaRascunho);
    const seloAuto = seloPrecoAnterior(null, autoAnterior);
    const placeholder = !automatico
      ? "0,00"
      : carregandoVersao
        ? "…"
        : autoAnterior.valor !== null
          ? autoAnterior.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : autoAnterior.fonte === "anterior" ? "—" : "0,00";
    controle = (
      <div className="flex items-center gap-1">
        <MoneyInput fixedDecimals aria-label={ariaLabel} placeholder={placeholder} disabled={salvando}
          className={cn("h-8 w-28 text-right tabular-nums", realce)}
          value={(r.valores[col] as number | null) ?? ""}
          onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))} />
        {automatico && !carregandoVersao && (
          <StatusBadge tone={seloAuto.tom} className="shrink-0 normal-case tracking-normal">{seloAuto.texto}</StatusBadge>
        )}
      </div>
    );
  } else if (campo.tipo === "peso" || campo.tipo === "medida") {
    // I1/Important (code-review, round 1): MoneyInput com casas fixas (3 no peso, 2 nas medidas), igual ao card.
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
    // I5/Important (code-review, round 1): mesmo filtro do card (`filtrarNcm`, helpers.ts).
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
          {/* n4 (carry.md, revisão T12a round 2): desabilitado durante o Salvar (mesma razão do bloco do Título). */}
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" disabled={salvando} onClick={() => onAtualizar((x) => manterMeu(x, col))}>
            manter o meu
          </Button>
          <span aria-hidden>·</span>
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" disabled={salvando} onClick={() => onAtualizar((x) => usarNovo(x, col))}>
            usar o novo
          </Button>
        </div>
      )}
    </div>
  );
}
