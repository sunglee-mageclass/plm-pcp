// Overlay de presença por campo estilo Google Sheets — versão AUTO-INSTRUMENTADA (set/2026).
// Montado UMA vez por sheet colaborativo (não por campo). Para cada pessoa presente com um
// `campoFocado`, encontra o elemento correspondente no DOM (via `elementoDoPath`, dentro do
// `scopeRef`), mede sua posição com getBoundingClientRect e desenha um anel na cor da pessoa + um
// rótulo com o nome logo acima. Reposiciona em scroll/resize (o campo pode rolar dentro do sheet).
//
// Por que overlay e não um wrapper por campo (como o <FieldPresence> antigo): assim QUALQUER campo
// ganha o ring sem precisar ser envolvido à mão. O <FieldPresence> continua existindo p/ os poucos
// campos já instrumentados — os dois coexistem; este cobre o resto.
//
// Posicionamento: um portal FIXO no body (position:fixed segue o viewport, então basta reagir a
// scroll/resize, sem recalcular a cada frame). z alto p/ ficar sobre o input, pointer-events-none
// p/ nunca bloquear o clique/foco do campo por baixo.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { PresencaColab } from "@/hooks/useColabRegistro";
import { corDoUsuario } from "@/lib/colab/presenca-cor";
import { elementoDoPath } from "@/lib/colab/colab-field-path";

type Marca = { userId: string; nome: string; solid: string; text: string; rect: DOMRect; topClipado: boolean };

export function ColabPresenceOverlay({ presentes, scopeRef }: {
  presentes: PresencaColab[];
  scopeRef: RefObject<HTMLElement | null>;
}) {
  const [marcas, setMarcas] = useState<Marca[]>([]);
  // presentes muda de identidade a cada broadcast; guardamos numa ref p/ o loop de reposição ler o
  // valor atual sem recriar os listeners a cada mudança.
  const presentesRef = useRef(presentes);
  presentesRef.current = presentes;

  useLayoutEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;

    const recompute = () => {
      const sc = scopeRef.current;
      if (!sc) { setMarcas([]); return; }
      // Retângulo VISÍVEL do scope (a área rolável). O anel é CLIPADO a ele: um campo rolado p/ fora
      // (atrás do rodapé sticky, que é IRMÃO do scope, ou acima do topo) não deve pintar por cima de
      // elementos fora da área de rolagem — era o bug do anel sobre a barra "Salvar" (set/2026).
      const clip = sc.getBoundingClientRect();
      const next: Marca[] = [];
      for (const p of presentesRef.current) {
        if (!p.campoFocado) continue;
        const el = elementoDoPath(p.campoFocado, sc);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue; // campo oculto/colapsado
        // Interseção do campo com a área visível do scope.
        const top = Math.max(r.top, clip.top);
        const left = Math.max(r.left, clip.left);
        const right = Math.min(r.right, clip.right);
        const bottom = Math.min(r.bottom, clip.bottom);
        const w = right - left;
        const h = bottom - top;
        // Campo essencialmente fora da área visível (rolado atrás do rodapé/topo) → não desenha.
        // Exige uma faixa mínima visível (4px) p/ evitar um anel-fiapo colado na borda.
        if (w <= 1 || h <= 4) continue;
        // Rótulo com o nome fica ACIMA do anel; se o topo real do campo está clipado (campo entra
        // por baixo), o rótulo iria pra fora — nesse caso ele será reposicionado no render.
        const topClipado = top > r.top + 0.5;
        const cor = corDoUsuario(p.userId);
        next.push({
          userId: p.userId, nome: p.nome, solid: cor.solid, text: cor.text,
          rect: new DOMRect(left, top, w, h), topClipado,
        });
      }
      // Só re-renderiza se algo mudou de fato (evita loop de layout).
      setMarcas((prev) => (mesmasMarcas(prev, next) ? prev : next));
    };

    recompute();

    // Reposiciona em scroll (captura p/ pegar scroll de qualquer container interno) e resize.
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    // Mudanças de layout dentro do sheet (accordion abre, linha some) → ResizeObserver no scope.
    const ro = new ResizeObserver(recompute);
    ro.observe(scope);
    // E um tick por rAF encadeado leve enquanto houver marcas ativas? Não — scroll/resize/RO cobrem
    // os casos reais; um input que muda de tamanho ao digitar dispara o RO. Mantemos barato.

    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
      ro.disconnect();
    };
    // Recalcula quando a lista de presentes muda (novo foco chegou por broadcast).
  }, [presentes, scopeRef]);

  if (marcas.length === 0) return null;

  return createPortal(
    <>
      {marcas.map((m) => (
        <div
          key={m.userId}
          className="pointer-events-none fixed z-[60] rounded-md"
          style={{
            top: m.rect.top,
            left: m.rect.left,
            width: m.rect.width,
            height: m.rect.height,
            boxShadow: `0 0 0 2px ${m.solid}`,
          }}
        >
          {/* Rótulo ACIMA do anel normalmente; quando o topo do campo está clipado (campo entra por
              baixo do rodapé/topo), joga o rótulo p/ DENTRO do anel — senão ele apareceria fora da
              área visível, por cima do rodapé (bug do "Sung Lee" sobre a barra Salvar). */}
          <span
            className={`pointer-events-none absolute right-0 z-[61] rounded px-1.5 py-px text-[10px] font-semibold leading-tight shadow-sm whitespace-nowrap ${m.topClipado ? "top-0.5" : "-top-4"}`}
            style={{ background: m.solid, color: m.text }}
          >
            {m.nome}
          </span>
        </div>
      ))}
    </>,
    document.body,
  );
}

function mesmasMarcas(a: Marca[], b: Marca[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (
      x.userId !== y.userId ||
      x.nome !== y.nome ||
      x.solid !== y.solid ||
      x.rect.top !== y.rect.top ||
      x.rect.left !== y.rect.left ||
      x.rect.width !== y.rect.width ||
      x.rect.height !== y.rect.height ||
      x.topClipado !== y.topClipado
    ) return false;
  }
  return true;
}
