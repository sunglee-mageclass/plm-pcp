// Renderizador do Manual (compartilhado) — o MESMO motor visual do "Manual da API" da Integração, extraído de ManualAba.tsx (A1)
// para ser reusado pelo Manual de uso global. Renderiza os blocos genéricos (p/passos/lista/codigo/tabela/faq/imagem) e o layout
// índice-lateral + seções ancoradas. O caso `exemplo` da Integração é específico dela e entra via o `renderBlocos` opcional do
// `ManualIndiceSecoes` (ver src/components/integracao/ManualAba.tsx).
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Bloco, SecaoManual } from "./tipos";

export function Codigo({ titulo, codigo }: { titulo: string; codigo: string }) {
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

export function Blocos({ blocos }: { blocos: Bloco[] }) {
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
          case "imagem": return (
            <figure key={i} className="space-y-1">
              <img src={b.src} alt={b.alt} className="max-w-full rounded-md" />
              {b.legenda && <figcaption className="text-xs text-muted-foreground">{b.legenda}</figcaption>}
            </figure>
          );
        }
      })}
    </div>
  );
}

// Layout índice-lateral sticky + seções ancoradas `#<prefixoAncora>-<id>`. Parametrizável: `prefixoAncora` (default "manual") e
// `renderBlocos` opcional (a Integração injeta o seu `Blocos` que trata o caso `exemplo`; sem ele, usa o `Blocos` padrão).
// Genérico no tipo da seção para aceitar uma união de blocos estendida (ex.: com `exemplo`).
export function ManualIndiceSecoes<S extends { id: string; titulo: string; blocos: readonly { tipo: string }[] }>({
  secoes,
  prefixoAncora = "manual",
  renderBlocos,
}: {
  secoes: readonly S[];
  prefixoAncora?: string;
  renderBlocos?: (blocos: S["blocos"]) => React.ReactNode;
}) {
  const render = renderBlocos ?? ((blocos: S["blocos"]) => <Blocos blocos={blocos as unknown as Bloco[]} />);
  return (
    <div className="grid grid-cols-[14rem_1fr] gap-6">
      <nav aria-label="Índice do manual" className="sticky top-4 self-start">
        <ol className="space-y-1 text-sm">
          {secoes.map((s, i) => <li key={s.id}><a href={`#${prefixoAncora}-${s.id}`} className="text-primary hover:underline">{i + 1}. {s.titulo}</a></li>)}
        </ol>
      </nav>
      <div className="min-w-0 space-y-8">
        {secoes.map((s, i) => (
          <section key={s.id} id={`${prefixoAncora}-${s.id}`} className="scroll-mt-4 space-y-3">
            <h3 className="font-display text-lg font-semibold">{i + 1}. {s.titulo}</h3>
            {render(s.blocos)}
          </section>
        ))}
      </div>
    </div>
  );
}

export type { Bloco, SecaoManual };
