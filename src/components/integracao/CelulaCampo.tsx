// Integração — uma célula da aba Produtos (linha do produto ou sublinha variante × tamanho). Edita SÓ o rascunho (staging);
// `modoCelula` decide editar × ler. Custo, cor, apelido e tamanho: só leitura com "i" + "abrir card" (P-80 A). Linha
// integrável/integrada: RETRATO + cadeado; "i" âmbar quando o vivo difere (N10). SKU da sublinha: digitado vira "a gravar"
// (mesmas regras da seção Códigos) e a prévia do servidor diz a situação.
//
// Adaptações do controlador sobre o brief da Task 12a (ver task-12a-report.md):
// - Título: NÃO usa o `editar` genérico — usa `tituloExibido`/`editarTitulo`/`sairTitulo` (rascunho.ts), passando
//   `nomeLoja` de `useTenantBranding().nome` a cada chamada (nunca guardado em estado). Célula DESABILITADA enquanto
//   `nome` ainda é null (loading), com um hint curto — evita editar o título antes do automático poder ser calculado
//   (rascunho.ts já tem essa rede de segurança pro caso de a tela esquecer o disable; aqui é o disable de verdade).
// - Título e "Preço anterior" em modo automático (raw NULL): `valorCelula` já devolve o valor automático calculado
//   pelo servidor — aqui só soma um badge "automático" (StatusBadge tone="neutral", mesmo padrão do Sheet) quando o
//   raw está NULL, sem mexer no texto exibido.
// - Reprovado: badge fica na coluna Estado (ProdutosTabela), não aqui — célula de campo não muda por reprovado.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InfoHover } from "@/components/shared/InfoHover";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { NumberInput } from "@/components/shared/NumberInput";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { useTenantBranding } from "@/hooks/useTenantBranding";
import { cn } from "@/lib/utils";
import { infoCusto, type CampoDef, type ColunaEditavel } from "@/lib/integracao/campos";
import { infoEdicao, modoCelula } from "@/lib/integracao/celula";
import {
  avisoRetrato, linhasVariante, textoFotos, usaRetrato, valorCelula, type ProdutoLista, type Sublinha,
} from "@/lib/integracao/produtos";
import {
  colunasAlteradas, comSkus, editar, editarTitulo, linhaSkuDaSublinha, manterMeu, sairTitulo,
  tituloCalculadoDoRascunho, usarNovo, type Rascunho,
} from "@/lib/integracao/rascunho";
import { tituloExibido } from "@/lib/titulo-pagina";
import {
  chaveLinhaSku, digitarSku, situacaoPrevia, skuExibido, type LinhaPrevia, type PreviaSkus,
} from "@/components/planejamento/planejamento-detail/codigos/sku-previa";

type Props = {
  campo: CampoDef; produto: ProdutoLista; indice: number | null; rascunho: Rascunho; previa: PreviaSkus | undefined;
  salvando: boolean; onAtualizar: (f: (r: Rascunho) => Rascunho) => void; onKeywords: () => void; onFotos: () => void;
};

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
      {travado && <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Travado" />}
      <span className={cn("max-w-[16rem] truncate", texto === "—" && "text-muted-foreground")} title={texto}>{texto}</span>
      {selo}
      {info && <InfoHover ariaLabel="Informação do campo">{info}</InfoHover>}
      {aviso && <InfoHover ariaLabel="Mudou depois do retrato" className="text-[var(--tone-warning-fg)]">{aviso}</InfoHover>}
      {cardId && <AbrirCard id={cardId} />}
    </div>
  );
}
function sublinhaDe(p: ProdutoLista, indice: number): Sublinha | undefined {
  const l = linhasVariante(p)[indice];
  return l ? p.sublinhas.find((s) => s.varianteKey === l.varianteKey && s.tamanhoKey === l.tamanhoKey) : undefined;
}

function SkuCelula({ p, indice, r, previa, salvando, onAtualizar }: {
  p: ProdutoLista; indice: number; r: Rascunho; previa: PreviaSkus | undefined; salvando: boolean;
  onAtualizar: (f: (r: Rascunho) => Rascunho) => void;
}) {
  const sub = sublinhaDe(p, indice);
  const editavel = p.estado === "nao_integravel" && p.gates.sku.ok && !salvando && !!sub;
  if (!editavel || !sub) {
    return (
      <Leitura texto={valorCelula(p, "ref_sku", indice)} travado={p.estado !== "nao_integravel"}
        info={p.estado === "nao_integravel" && !p.gates.sku.ok ? p.gates.sku.motivo : null} />
    );
  }
  const linha = linhaSkuDaSublinha(sub);
  const exibido = skuExibido(linha, r.skus);
  const digitado = r.skus.manuais[chaveLinhaSku(sub.varianteKey, sub.tamanhoKey)];
  // SKU preview error state (controlador): `previaDeErro` (useIntegracao.ts) produz uma PreviaSkus cuja `entrada` é a
  // CHAVE da query que falhou (não o literal "erro") — a linha "a gravar" ainda casa por variante_key/tamanho_key em
  // `matriz.linhas` (previaDeErro monta 1 LinhaPrevia por SKU manual do rascunho), então `situacaoPrevia` encontra o
  // erro em `previa.erros` pela MESMA chave e devolve o texto PT — nenhuma checagem extra de `previa.entrada` é
  // necessária aqui: a busca é sempre por variante/tamanho, igual ao caminho feliz.
  const lp = previa?.matriz.linhas.find((x) => x.variante_key === sub.varianteKey && x.tamanho_key === sub.tamanhoKey);
  // `matriz.linhas` é uma intersecção (MatrizSkus.linhas: LinhaSku[]) & (LinhaPrevia[]) — o mesmo cast já usado em
  // CodigosSecao.tsx (`situacaoPrevia(l as LinhaPrevia, erros)`) pra contornar a inferência do TS nesse ponto.
  const sit = digitado && lp ? situacaoPrevia(lp as LinhaPrevia, previa?.erros ?? []) : null;
  return (
    <div className="flex min-w-[10rem] flex-col gap-1">
      <Input
        key={exibido}
        defaultValue={exibido}
        aria-label="SKU"
        className={cn("h-8", digitado && "bg-[var(--tone-warning-bg)]")}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        onBlur={(e) => {
          const out = digitarSku(r.skus, linha, e.target.value);
          if (out.erro) {
            toast.error(out.erro);
            e.target.value = out.valor;
            return;
          }
          if (out.aGravar !== r.skus) onAtualizar((x) => comSkus(x, out.aGravar));
        }}
      />
      {sit && <StatusBadge tone={sit.tom} className="w-fit normal-case tracking-normal">{sit.texto}</StatusBadge>}
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

/** Célula do Título (produto, `indice===null`): controlador — NÃO usa o `editar` genérico de `rascunho.ts`.
 *  `editarTitulo`/`sairTitulo` precisam do nome da loja a cada chamada (nunca guardado em estado, senão ficaria
 *  stale — o mesmo motivo documentado em `rascunho.ts`). Enquanto `nomeLoja` é null (loading), a célula fica
 *  DESABILITADA com um hint curto — isso evita editar o título antes do automático poder ser calculado de verdade. */
function CelulaTitulo({ p, r, salvando, modo, onAtualizar }: {
  p: ProdutoLista; r: Rascunho; salvando: boolean;
  modo: ReturnType<typeof modoCelula>; onAtualizar: (f: (r: Rascunho) => Rascunho) => void;
}) {
  const { nome: nomeLoja } = useTenantBranding();
  const aviso = avisoRetrato(p, "titulo");
  if (modo.tipo === "leitura") {
    const automatico = p.raw.titulo_pagina === null;
    return (
      <Leitura texto={valorCelula(p, "titulo", null)} info={modo.motivo} aviso={aviso} travado={modo.travado}
        selo={automatico ? <StatusBadge tone="neutral" className="normal-case tracking-normal">automático</StatusBadge> : null} />
    );
  }
  const carregandoLoja = nomeLoja === null;
  const col: ColunaEditavel = "titulo_pagina";
  const alterada = colunasAlteradas(r).includes(col);
  const conflito = r.conflitos.find((c) => c.path === col);
  const automatico = r.valores.titulo_pagina === null;
  const calculado = carregandoLoja ? "" : tituloCalculadoDoRascunho(r, nomeLoja);
  const exibido = tituloExibido(r.valores.titulo_pagina, calculado);
  const realce = cn(alterada && "bg-[var(--tone-warning-bg)]", conflito && "ring-2 ring-[var(--tone-warning-fg)]");
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1">
        <Input
          aria-label="Título para a página"
          className={cn("h-8 min-w-[14rem]", realce)}
          value={exibido}
          disabled={carregandoLoja || salvando}
          onChange={(e) => onAtualizar((x) => editarTitulo(x, e.target.value, nomeLoja))}
          onBlur={() => onAtualizar((x) => sairTitulo(x, nomeLoja))}
        />
        {automatico && !carregandoLoja && (
          <StatusBadge tone="neutral" className="shrink-0 normal-case tracking-normal">automático</StatusBadge>
        )}
        {carregandoLoja && <InfoHover ariaLabel="Aguardando o nome da loja">Carregando o nome da loja — aguarde para editar o título.</InfoHover>}
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
    const g = p.gates.keywords;
    const pode = p.estado === "nao_integravel" && g.ok && !salvando;
    return (
      <div className="flex min-w-0 items-center gap-1">
        {travado && <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Travado" />}
        <span className="max-w-[14rem] truncate">{valorCelula(p, "keywords", null)}</span>
        {pode ? (
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onKeywords}>editar</Button>
        ) : p.estado === "nao_integravel" && g.motivo ? (
          <InfoHover ariaLabel="Por que não edita">{g.motivo}</InfoHover>
        ) : null}
        {aviso && <InfoHover ariaLabel="Mudou depois do retrato" className="text-[var(--tone-warning-fg)]">{aviso}</InfoHover>}
      </div>
    );
  }
  if (modo.tipo === "leitura") {
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
  const col = campo.coluna as ColunaEditavel;
  const alterada = colunasAlteradas(r).includes(col);
  const conflito = r.conflitos.find((c) => c.path === col);
  const info = infoEdicao(campo, p);
  const set = (v: string | number | null) => onAtualizar((x) => editar(x, col, v as never));
  const numero = (s: string): number | null => (s.trim() === "" ? null : Number(s));
  const realce = cn(alterada && "bg-[var(--tone-warning-bg)]", conflito && "ring-2 ring-[var(--tone-warning-fg)]");
  let controle: ReactNode;
  if (campo.tipo === "fotos") {
    controle = (
      <Button type="button" variant="outline" size="sm" className={realce} onClick={onFotos}>
        {textoFotos(r.valores.fotos_modelo.length)} · trocar/adicionar/remover
      </Button>
    );
  } else if (campo.tipo === "dinheiro") {
    controle = (
      <MoneyInput fixedDecimals aria-label={campo.rotulo} placeholder="0,00" className={cn("h-8 w-28 text-right tabular-nums", realce)}
        value={(r.valores[col] as number | null) ?? ""} onChange={(e) => set(numero(e.target.value))} />
    );
  } else if (campo.tipo === "peso" || campo.tipo === "medida") {
    controle = (
      <NumberInput aria-label={campo.rotulo} className={cn("h-8 w-24 text-right tabular-nums", realce)}
        value={(r.valores[col] as number | null) ?? ""} onChange={(e) => set(numero(e.target.value))} />
    );
  } else if (campo.tipo === "texto_longo") {
    controle = (
      <Textarea aria-label={campo.rotulo} rows={2} className={cn("min-h-8 min-w-[14rem] text-xs", realce)}
        value={String(r.valores[col] ?? "")} onChange={(e) => set(e.target.value)} />
    );
  } else {
    controle = (
      <Input aria-label={campo.rotulo} className={cn("h-8 min-w-[9rem]", realce)}
        value={String(r.valores[col] ?? "")} onChange={(e) => set(e.target.value)} />
    );
  }
  const automatico = campo.key === "preco_anterior" && r.valores.preco_anterior === null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1">
        {controle}
        {automatico && <StatusBadge tone="neutral" className="shrink-0 normal-case tracking-normal">automático</StatusBadge>}
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
