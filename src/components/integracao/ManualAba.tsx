// Integração — aba "Manual da API" (SÓ super admin — P-81 A; mockup 7f/9b). Índice ao lado + os 9 tópicos (a tela só existe
// em tela larga — P-87). Conteúdo em manual-conteudo.ts; comandos com o endereço do PRÓPRIO site.
import { useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TEXTO_SO_SUPER } from "@/lib/integracao/campos";
import { montarManual, type Bloco, type SecaoManual } from "./manual-conteudo";
import { ExemploDialog } from "./ExemploDialog";

function Codigo({ titulo, codigo }: { titulo: string; codigo: string }) {
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      toast.success("Copiado.");
    } catch {
      toast.error("Não foi possível copiar — selecione o texto e copie à mão.");
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{titulo}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => void copiar()}><Copy className="h-4 w-4" />Copiar</Button>
      </div>
      <pre className="max-w-full overflow-x-auto rounded-md bg-muted p-3 text-xs">{codigo}</pre>
    </div>
  );
}
function Blocos({ blocos, onExemplo }: { blocos: Bloco[]; onExemplo: () => void }) {
  return (
    <div className="space-y-3 text-sm">
      {blocos.map((b, i) => {
        switch (b.tipo) {
          case "p": return <p key={i}>{b.texto}</p>;
          case "passos": return <ol key={i} className="list-decimal space-y-1 pl-5">{b.itens.map((x) => <li key={x}>{x}</li>)}</ol>;
          case "lista": return <ul key={i} className="list-disc space-y-1 pl-5">{b.itens.map((x) => <li key={x}>{x}</li>)}</ul>;
          case "codigo": return <Codigo key={i} titulo={b.titulo} codigo={b.codigo} />;
          case "faq": return (
            <dl key={i} className="space-y-2">
              {b.itens.map((x) => <div key={x.p}><dt className="font-medium">{x.p}</dt><dd className="text-muted-foreground">{x.r}</dd></div>)}
            </dl>
          );
          case "tabela": return (
            <div key={i} className="max-w-full overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-left text-muted-foreground"><tr>{b.cabecalho.map((c) => <th key={c} className="px-2 py-2">{c}</th>)}</tr></thead>
                <tbody>{b.linhas.map((l) => <tr key={l[0]} className="border-t align-top">{l.map((c, j) => <td key={j} className={j === 0 ? "px-2 py-2 font-mono" : "px-2 py-2"}>{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
          case "exemplo": return <Button key={i} type="button" variant="outline" onClick={onExemplo}>Ver resposta de exemplo (modo teste)</Button>;
        }
      })}
    </div>
  );
}

export function ManualAba() {
  const secoes: SecaoManual[] = useMemo(() => montarManual(typeof window === "undefined" ? "" : window.location.origin), []);
  const [exemplo, setExemplo] = useState(false);
  return (
    <div className="space-y-4">
      <p className="rounded-md bg-[var(--tone-info-bg)] p-3 text-sm text-[var(--tone-info-fg)]">{TEXTO_SO_SUPER}</p>
      <p className="text-sm text-muted-foreground">Linguagem simples, para o dono E para o dev.</p>
      <div className="grid grid-cols-[14rem_1fr] gap-6">
        <nav aria-label="Índice do manual" className="sticky top-4 self-start">
          <ol className="space-y-1 text-sm">
            {secoes.map((s, i) => <li key={s.id}><a href={`#manual-${s.id}`} className="text-primary hover:underline">{i + 1}. {s.titulo}</a></li>)}
          </ol>
        </nav>
        <div className="min-w-0 space-y-8">
          {secoes.map((s, i) => (
            <section key={s.id} id={`manual-${s.id}`} className="scroll-mt-4 space-y-3">
              <h3 className="font-display text-lg font-semibold">{i + 1}. {s.titulo}</h3>
              <Blocos blocos={s.blocos} onExemplo={() => setExemplo(true)} />
            </section>
          ))}
        </div>
      </div>
      {exemplo && <ExemploDialog onFechar={() => setExemplo(false)} />}
    </div>
  );
}
