// Distribuição por produto — as 2 tabelas do dialog "Distribuir por loja" (spec §5.3): (1) Loja / Cor × Base × tamanhos ×
// Total, com a linha "Proporção por tamanho" do card e o subtotal por loja; (2) "Total por cor × tamanho" (= pç no card).
// UM componente para a TELA (inputs, `data-colab-path` por campo — R19) e a IMPRESSÃO (texto, sem botões). Celular:
// rolagem horizontal só dentro da tabela, 1ª coluna fixa com nome ABREVIADO (toque abre o nome completo).
import { Fragment, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NumberInput } from "@/components/shared/NumberInput";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import type { TamanhoTipo } from "@/lib/tamanho";
import {
  abreviarNome, linhaVista, pathDistBase, pathDistCel, pathDistProp, rotuloTamanho, somaVistas, temDistribuicao,
  type Distribuicao,
} from "@/lib/distribuicao-produto";

export type LojaDist = { id: string; nome: string; inativa: boolean };
export type CorDist = { key: string; cor: string; apelido: string | null; swatch: string | null; pcCard: number };

const TH = "border px-2 py-1 text-center text-xs font-medium";
const TD = "border px-1 py-0.5 text-center tabular-nums";
// T6 fix1 · I1 + T6 fix2 · N2: fundo SEMPRE opaco na célula fixa (`!bg-*`, precedente TabelaAnalise.tsx:109) — sem
// o `!`, o tom (bg-muted/30|40|50|60) empilhava sobre o bg-background e o CSS deixava valer o translúcido; no
// celular os números da coluna que rola passavam por baixo do texto da coluna fixa. `COL1` NÃO carrega `bg-*`
// nenhum (o fix1 pôs `!bg-background` aqui, mas dois `!important` empatam por ORDEM DE FONTE do Tailwind — não
// por posição na string — e a linha de total perdia o tom para este default): toda chamada de `${COL1}` tem que
// somar o SEU PRÓPRIO `!bg-*` opaco (sem fração `/NN`).
const COL1 = "sticky left-0 z-10 border px-2 py-1 text-left";

function NomeCor({ c, impressao }: { c: CorDist; impressao: boolean }) {
  const completo = c.apelido ? `${c.cor} · ${c.apelido}` : c.cor;
  // T6 fix1 · m7 (fiel ao mockup): cor e apelido abreviados CADA UM na sua palavra e empilhados em 2 LINHAS
  // ("Marr." / "Can.") — não mais um só texto truncado numa linha.
  const corAbrev = abreviarNome(c.cor);
  const apelidoAbrev = c.apelido ? abreviarNome(c.apelido) : null;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <VarianteSwatch nome={c.swatch ?? c.cor} />
      <span className={impressao ? "" : "max-md:hidden"}>
        <span className="block font-medium">{c.cor}</span>
        {c.apelido && <span className="block text-[10px] text-muted-foreground">{c.apelido}</span>}
      </span>
      {!impressao && (
        <Popover>
          <PopoverTrigger asChild>
            {/* div com role de botão (não elemento nativo) — o DialogContent embrulha os filhos no PRÓPRIO fieldset
                (disabled=readOnly de página): um elemento nativo aqui ficaria travado em modo só-leitura, mas o nome
                completo tem que continuar abrindo (P-22 "ver"). Mesmo padrão de ImagePreview.tsx p/ escapar do fieldset. */}
            <div role="button" tabIndex={0}
              className="rounded text-left font-medium leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
              title={completo}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}>
              <span className="block truncate">{corAbrev}</span>
              {apelidoAbrev && <span className="block truncate text-[10px] text-muted-foreground">{apelidoAbrev}</span>}
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2 text-xs">{completo}</PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/** Ponto da célula corrigida à mão (P-09 + PR16, G-plano R7; T6 fix1 · m6; T6 fix2 · N1): no DESKTOP o balão abre no
 *  HOVER do mouse, no MESMO padrão de ponteiro do `InfoHover` (mouse = hover; toque/caneta = toque; teclado = alterna)
 *  — evita a REGRESSÃO do fix1 (o gatilho anterior abria o Popover do Radix em QUALQUER dispositivo ao passar por
 *  cima, sem checar o tipo de ponteiro, puxando o foco para o botão ↺ e roubando o foco/os dígitos de quem editava
 *  outra célula; no desktop o clique-depois-do-hover piscava; no toque, o evento de compatibilidade brigava com o
 *  clique). Usa eventos de PONTEIRO (não os de mouse específicos do DOM), checando `pointerType`. Continua abrindo
 *  por clique/toque; o ↺ segue SEPARADO dentro do balão — nunca volta sozinho ao calculado. */
function PontoManual({ calculado, bloqueado, onVoltar }: { calculado: number; bloqueado: boolean; onVoltar: () => void }) {
  const [aberto, setAberto] = useState(false);
  // Tipo do último ponteiro (mesma ref de InfoHover.tsx): só MOUSE abre/fecha pelo hover; toque/caneta abrem no
  // toque (sem alternar — não pisca); teclado (sem pointerdown) alterna.
  const ponteiro = useRef<string | null>(null);
  // Abriu por HOVER (mouse)? Usado para condicionar onOpenAutoFocus/onCloseAutoFocus — teclado/toque mantêm o
  // foco automático de sempre (acessibilidade); hover NUNCA move o foco (não pode roubar dígitos de outra célula).
  const abriuPorHover = useRef(false);
  // Sai do hover (do ponto OU do balão) com um atraso curto — dá tempo do mouse atravessar a distância até o
  // ↺ sem fechar no meio do caminho (mesma folga de um hover-card comum); qualquer novo enter cancela o timer.
  const fecharTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelarFechar = () => { if (fecharTimer.current) { clearTimeout(fecharTimer.current); fecharTimer.current = null; } };
  const agendarFechar = () => { cancelarFechar(); fecharTimer.current = setTimeout(() => setAberto(false), 150); };
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        {/* div com role de botão (não elemento nativo) — mesmo motivo do nome abreviado acima: o balão do calculado
            tem que abrir também em modo só-leitura (P-22 "ver"), senão ficaria travado pelo fieldset do DialogContent. */}
        <div role="button" tabIndex={0} title={`Editado à mão · calculado seria ${calculado}`} aria-label={`Editado à mão · calculado seria ${calculado}`}
          onPointerEnter={(e) => {
            ponteiro.current = e.pointerType;
            if (e.pointerType === "mouse") { abriuPorHover.current = true; cancelarFechar(); setAberto(true); }
          }}
          onPointerLeave={(e) => { if (e.pointerType === "mouse") agendarFechar(); }}
          onPointerDown={(e) => { ponteiro.current = e.pointerType; }}
          onClick={(e) => {
            const tipo = ponteiro.current;
            if (tipo === "mouse") { e.preventDefault(); setAberto(true); return; } // já abriu no hover — sem alternar (não pisca)
            abriuPorHover.current = false;
            if (tipo === "touch" || tipo === "pen") setAberto(true);
            else setAberto((o) => !o);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abriuPorHover.current = false; setAberto((o) => !o); }
          }}
          className="absolute right-0.5 top-0.5 h-3 w-3 cursor-pointer rounded-full bg-primary max-md:h-4 max-md:w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1" />
      </PopoverTrigger>
      <PopoverContent side="top" className="w-auto space-y-1.5 p-2 text-xs"
        onPointerEnter={(e) => { if (e.pointerType === "mouse") cancelarFechar(); }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") agendarFechar(); }}
        onOpenAutoFocus={(e) => { if (abriuPorHover.current) e.preventDefault(); }}
        onCloseAutoFocus={(e) => { if (abriuPorHover.current) e.preventDefault(); }}>
        <p>Editado à mão · calculado seria {calculado}</p>
        {!bloqueado && (
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => { onVoltar(); setAberto(false); }}>
            <RotateCcw className="h-3 w-3" />Voltar ao calculado
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function DistribuicaoTabelas(p: {
  modo: "edicao" | "impressao";
  slotKey: string;
  tamanhos: string[];
  tipo: TamanhoTipo;
  prop: Record<string, number>;
  cores: CorDist[];
  dists: Record<string, Distribuicao>;
  lojas: LojaDist[];
  readOnly?: boolean;
  onProp?: (t: string, v: number) => void;
  onBase?: (corKey: string, loja: string, v: number) => void;
  onCel?: (corKey: string, loja: string, t: string, v: number) => void;
  onVoltar?: (corKey: string, loja: string, t: string) => void;
}) {
  const imp = p.modo === "impressao";
  const bloqueado = imp || !!p.readOnly;
  const esmaecido = (t: string) => ((p.prop[t] ?? 0) > 0 ? "" : "opacity-50");
  const somaProp = p.tamanhos.reduce((s, t) => s + (p.prop[t] ?? 0), 0);
  const vista = (corKey: string, loja: string) => linhaVista(p.dists[corKey]?.[loja], p.prop, p.tamanhos);
  // T6 fix1 · m8: em modo só-leitura (sem permissão de editar) a célula mostra TEXTO, igual à impressão — não
  // um NumberInput desabilitado esmaecido. O pedido é "ver e imprimir", não "ver um formulário travado".
  const campo = (valor: number, onChange: (v: number) => void, path: string, aria: string, extra = "") =>
    bloqueado ? (
      <span className={extra} aria-label={aria} data-colab-path={path}>{valor || 0}</span>
    ) : (
      <NumberInput integer blankZero placeholder="0" value={valor} aria-label={aria} data-colab-path={path}
        className={`h-8 w-14 border-0 bg-transparent px-1 text-center shadow-none max-md:h-10 ${extra}`}
        onChange={(e) => onChange(Number(e.target.value) || 0)} />
    );
  const comDist = p.cores.filter((c) => temDistribuicao(p.dists[c.key]));
  const totalGeral = somaVistas(comDist.flatMap((c) => p.lojas.map((l) => vista(c.key, l.id))), p.tamanhos);

  // Pedido do dono 26/set: impressão em paisagem (ver <style> no PrintArea do dialog) e, com MUITAS
  // variantes, em 2 colunas — senão uma tabela grande estoura por várias páginas soltas. Limiar =
  // MAIS DE 10 linhas de cor numa tabela de loja (LIMIAR_2_COLUNAS; `cores` é a mesma lista em toda
  // loja, então checar 1× basta). Só afeta a IMPRESSÃO: a tabela única da TELA (modo "edicao") não
  // muda — por isso a impressão vira N tabelas (uma por loja), cada uma com `break-inside: avoid`
  // para não partir ao meio entre colunas/páginas.
  const LIMIAR_2_COLUNAS = 10;
  const duasColunas = imp && p.cores.length > LIMIAR_2_COLUNAS;
  const linhaProporcao = (
    <tr className="bg-muted/30">
      {/* T6 fix1 · m7 (fiel ao mockup): abaixo de 640px (`sm`) mostra só "Proporção" — o texto completo
          ("Proporção por tamanho" + "do card") some; a coluna fixa é estreita no celular. */}
      <td className={`${COL1} !bg-muted`}>
        <span className="max-sm:hidden">Proporção por tamanho<span className="block text-[10px] text-muted-foreground">do card</span></span>
        <span className="sm:hidden">Proporção</span>
      </td>
      <td className={`${TD} text-muted-foreground`}>—</td>
      {p.tamanhos.map((t) => (
        <td key={t} className={`${TD} ${esmaecido(t)}`}>
          {campo(p.prop[t] ?? 0, (v) => p.onProp?.(t, v), pathDistProp(p.slotKey, t), `Proporção ${rotuloTamanho(t, p.tipo)}`)}
        </td>
      ))}
      <td className={`${TD} font-semibold`}>{somaProp}</td>
    </tr>
  );
  const linhasLoja = (l: LojaDist) => {
    const vistas = p.cores.map((c) => vista(c.key, l.id));
    const sub = somaVistas(vistas, p.tamanhos);
    return (
      <Fragment key={l.id}>
        {/* T6 fix1 · I1: a faixa do nome da loja vira 2 <td> — a 1ª FIXA e OPACA (`!bg-secondary`, sem
            fração — nome preso ao rolar), a 2ª cobre o resto das colunas com o tom translúcido de
            sempre (seguro: não fica embaixo de nenhuma célula fixa). */}
        <tr className={l.inativa ? "opacity-60" : ""}>
          <td className={`${COL1} !bg-secondary text-xs font-semibold uppercase tracking-wide`}>{l.nome}</td>
          <td colSpan={p.tamanhos.length + 2} className="border bg-muted/60 px-2 py-1 text-xs font-semibold uppercase tracking-wide" />
        </tr>
        {p.cores.map((c, i) => {
          const v = vistas[i];
          return (
            <tr key={c.key} className={l.inativa ? "opacity-60" : ""}>
              <td className={`${COL1} !bg-background`}><NomeCor c={c} impressao={imp} /></td>
              <td className={TD}>{campo(v.base, (x) => p.onBase?.(c.key, l.id, x), pathDistBase(p.slotKey, l.id, c.key), `Base ${l.nome} ${c.cor}`, "font-semibold")}</td>
              {p.tamanhos.map((t) => {
                const cel = v.celulas[t];
                return (
                  <td key={t} className={`${TD} relative ${esmaecido(t)}`}>
                    {campo(cel.valor, (x) => p.onCel?.(c.key, l.id, t, x), pathDistCel(p.slotKey, l.id, c.key, t), `${l.nome} ${c.cor} ${rotuloTamanho(t, p.tipo)}`)}
                    {cel.manual && (imp ? (
                      <span aria-hidden> •</span>
                    ) : (
                      <PontoManual calculado={cel.calculado} bloqueado={bloqueado} onVoltar={() => p.onVoltar?.(c.key, l.id, t)} />
                    ))}
                  </td>
                );
              })}
              <td className={`${TD} font-semibold`}>{v.total}</td>
            </tr>
          );
        })}
        <tr className="bg-muted/40 font-semibold">
          {/* T6 fix1 · m7: idem — "Total {loja}" completo só a partir de 640px; abaixo, só "Total". */}
          <td className={`${COL1} !bg-accent`}>
            <span className="max-sm:hidden">Total {l.nome}</span>
            <span className="sm:hidden">Total</span>
          </td>
          <td className={TD}>{sub.base}</td>
          {p.tamanhos.map((t) => <td key={t} className={`${TD} ${esmaecido(t)}`}>{sub.grades[t]}</td>)}
          <td className={TD}>{sub.total}</td>
        </tr>
      </Fragment>
    );
  };
  const cabecalhoTabela = (
    <thead className="bg-muted/50">
      <tr>
        <th rowSpan={2} className={`${COL1} !bg-muted text-xs font-medium`}>Loja / Cor</th>
        {/* Dono 26/set: os subtítulos de Base e Total saíram do cabeçalho (desnecessários). */}
        <th rowSpan={2} className={TH}>Base</th>
        <th colSpan={p.tamanhos.length} className={TH}>Tamanhos: proporção × Base · dá para corrigir à mão</th>
        <th rowSpan={2} className={TH}>Total</th>
      </tr>
      <tr>{p.tamanhos.map((t) => <th key={t} className={`${TH} ${esmaecido(t)}`}>{rotuloTamanho(t, p.tipo)}</th>)}</tr>
    </thead>
  );

  return (
    <div className="space-y-5">
      {imp && duasColunas ? (
        // Impressão com muitas variantes: 1 tabela POR LOJA (a proporção repete no topo de cada uma,
        // para a tabela ficar autocontida caso a coluna/página corte entre lojas) dentro de um
        // container de 2 colunas CSS (`.print-2col`, styles.css) — cada tabela de loja leva
        // `.print-quebra-evitar` (page-break-inside/break-inside: avoid) para não partir ao meio.
        <div className="print-2col" aria-label="Distribuição por loja e cor">
          {p.lojas.map((l) => (
            <table key={l.id} className="print-quebra-evitar mb-3 w-full border-collapse text-sm">
              {cabecalhoTabela}
              <tbody>
                {linhaProporcao}
                {linhasLoja(l)}
              </tbody>
            </table>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full min-w-[640px] border-collapse text-sm" aria-label="Distribuição por loja e cor">
            {cabecalhoTabela}
            <tbody>
              {linhaProporcao}
              {p.lojas.map((l) => linhasLoja(l))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-primary align-middle" />editado à mão — passe o mouse ou toque no ponto para ver o calculado; o ↺ volta a ele. Os totais já contam o valor editado.
      </p>

      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Total por cor × tamanho</h3>
        <p className="text-xs text-muted-foreground">Soma das lojas. É o que preenche o pç de cada cor do Tecido 1 no card.</p>
        <div className="overflow-x-auto rounded border">
          <table className="w-full min-w-[560px] border-collapse text-sm" aria-label="Total por cor e tamanho">
            <thead className="bg-muted/50">
              <tr>
                <th className={`${COL1} !bg-muted text-xs font-medium`}>Cor</th>
                <th className={TH}>Base<span className="block text-[10px] font-normal text-muted-foreground">soma das lojas</span></th>
                {p.tamanhos.map((t) => <th key={t} className={`${TH} ${esmaecido(t)}`}>{rotuloTamanho(t, p.tipo)}</th>)}
                <th className={TH}>Total<span className="block text-[10px] font-normal text-muted-foreground">= pç no card</span></th>
              </tr>
            </thead>
            <tbody>
              {p.cores.map((c) => {
                const tem = temDistribuicao(p.dists[c.key]);
                const tot = somaVistas(p.lojas.map((l) => vista(c.key, l.id)), p.tamanhos);
                return (
                  <tr key={c.key}>
                    <td className={`${COL1} !bg-background`}><NomeCor c={c} impressao={imp} /></td>
                    {tem ? (
                      <>
                        <td className={TD}>{tot.base}</td>
                        {p.tamanhos.map((t) => <td key={t} className={`${TD} ${esmaecido(t)}`}>{tot.grades[t]}</td>)}
                        <td className={`${TD} font-semibold`}>{tot.total}</td>
                      </>
                    ) : (
                      <td colSpan={p.tamanhos.length + 2} className={`${TD} text-left text-xs text-muted-foreground`}>sem distribuição · pç do card {c.pcCard}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-muted/40 font-semibold">
                <td className={`${COL1} !bg-accent`}>Total</td>
                <td className={TD}>{totalGeral.base}</td>
                {p.tamanhos.map((t) => <td key={t} className={`${TD} ${esmaecido(t)}`}>{totalGeral.grades[t]}</td>)}
                <td className={TD}>{totalGeral.total}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
