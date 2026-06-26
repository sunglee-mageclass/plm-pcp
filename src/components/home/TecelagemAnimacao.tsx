import { useEffect, useRef } from "react";

export type VarianteTecelagem = "minimal" | "rica";

type Props = {
  className?: string;
  /** Opacidade geral do tecido (0..1). Home cheia ~1; fundo de login mais sutil ~0.5. */
  opacity?: number;
  /** Densidade/estilo: "minimal" (arejado) ou "rica" (mais fios, textura densa). */
  variante?: VarianteTecelagem;
};

// Presets de cada vibe. "rica" = mais fios (espaçamento menor), trama mais junta e
// presente; "minimal" = arejado, traço fino, muito respiro.
const PRESETS: Record<VarianteTecelagem, {
  espacamento: number; aUrdume: number; aUrdumeStatic: number; aTecido: number;
  lwTecido: number; lwTrama: number; vel: number; rowFactor: number;
}> = {
  minimal: { espacamento: 46, aUrdume: 0.10, aUrdumeStatic: 0.16, aTecido: 0.22, lwTecido: 1.3, lwTrama: 1.7, vel: 0.022, rowFactor: 0.46 },
  rica:    { espacamento: 26, aUrdume: 0.16, aUrdumeStatic: 0.22, aTecido: 0.36, lwTecido: 1.5, lwTrama: 2.0, vel: 0.024, rowFactor: 0.55 },
};

// Estado da tecelagem persistido em ESCOPO DE MÓDULO: ao navegar home→/auth o componente
// remonta, mas a animação continua de onde parou (frente/progresso/sentido), em vez de
// começar do zero. Guardado em fração (independe de altura/espaçamento de cada tela).
const persist = { frenteFrac: 0, prog: 0, dir: 1, iniciado: false };

/**
 * Animação da identidade do sisTrama: os fios do URDUME (verticais, sob tensão) sendo
 * "juntados" pela TRAMA (a lançadeira horizontal que cruza por cima/por baixo, formando
 * o tecido linha a linha). Loop infinito: a frente de tecelagem desce, deixa o pano
 * pronto atrás e reinicia no topo.
 *
 * Sem dependência nova (canvas 2D + requestAnimationFrame). Lê as cores do tema via
 * sondagem (funciona com `oklch` sem parsear). Respeita prefers-reduced-motion.
 */
export function TecelagemAnimacao({ className, opacity = 1, variante = "minimal" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const P = PRESETS[variante];

    // Cor do tema sem parsear oklch: cria um elemento com a classe, lê a cor computada
    // (serializada, sempre aceita pelo canvas) e usa globalAlpha para as variações.
    const probe = (cls: string, fallback: string) => {
      const el = document.createElement("span");
      el.className = cls;
      el.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none";
      canvas.parentElement?.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c || fallback;
    };
    let corFio = probe("text-foreground", "rgb(40,55,90)");
    let corTrama = probe("text-primary", "rgb(70,95,150)");

    const reduzir = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let W = 1, H = 1, dpr = 1;
    let cols = 0;
    const rowH = Math.max(10, Math.round(P.espacamento * P.rowFactor)); // trama mais junta que o urdume

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.max(6, Math.floor(W / P.espacamento) + 1);
      corFio = probe("text-foreground", corFio);
      corTrama = probe("text-primary", corTrama);
    };
    resize();

    const span = () => (cols - 1) * P.espacamento;
    const x0 = () => (W - span()) / 2;
    const colX = (i: number) => x0() + i * P.espacamento;
    const xL = () => colX(0);
    const xR = () => colX(cols - 1);

    // Urdume: fios verticais sob tensão (full height).
    const drawUrdume = (alpha: number) => {
      ctx.strokeStyle = corFio;
      ctx.lineWidth = 1;
      ctx.globalAlpha = alpha * opacity;
      ctx.beginPath();
      for (let i = 0; i < cols; i++) {
        const x = Math.round(colX(i)) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    // Tecido pronto até `frente`: trama por CIMA nas células de paridade par (basket-weave).
    const drawTecido = (frente: number) => {
      ctx.strokeStyle = corFio;
      ctx.lineWidth = P.lwTecido;
      ctx.globalAlpha = P.aTecido * opacity;
      ctx.beginPath();
      for (let row = 0; ; row++) {
        const y = rowH * (row + 1);
        if (y >= frente || y > H) break;
        for (let i = 0; i < cols - 1; i++) {
          if ((row + i) % 2 === 0) {
            ctx.moveTo(colX(i), y);
            ctx.lineTo(colX(i + 1), y);
          }
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    // Estático (reduced-motion): urdume + tecido inteiro.
    if (reduzir) {
      const paint = () => {
        ctx.clearRect(0, 0, W, H);
        drawUrdume(P.aUrdumeStatic);
        drawTecido(H + rowH);
      };
      paint();
      const ro = new ResizeObserver(() => { resize(); paint(); });
      ro.observe(canvas);
      return () => ro.disconnect();
    }

    // Restaura o ponto onde a animação parou (continuidade home↔login), snap na linha.
    let frente = persist.iniciado
      ? Math.round((persist.frenteFrac * H) / rowH) * rowH
      : -rowH;
    let prog = persist.iniciado ? persist.prog : 0;
    let dir = persist.iniciado ? persist.dir : 1;
    let raf = 0;

    const frame = () => {
      ctx.clearRect(0, 0, W, H);

      drawUrdume(P.aUrdume);
      drawTecido(frente);

      // Linha ativa: a trama já tecida nesta passada (do lado de partida à lançadeira).
      const yA = frente;
      if (yA > 0 && yA < H) {
        const ini = dir === 1 ? xL() : xR();
        const sx = ini + (dir === 1 ? span() : -span()) * prog;
        ctx.strokeStyle = corTrama;
        ctx.globalAlpha = 0.9 * opacity;
        ctx.lineWidth = P.lwTrama;
        ctx.beginPath();
        ctx.moveTo(ini, yA);
        ctx.lineTo(sx, yA);
        ctx.stroke();

        ctx.globalAlpha = opacity;
        ctx.fillStyle = corTrama;
        ctx.shadowColor = corTrama;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(sx, yA, variante === "rica" ? 3.2 : 2.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }

      prog += P.vel;
      if (prog >= 1) {
        prog = 0;
        dir *= -1;
        frente += rowH;
        if (frente > H + rowH) frente = -rowH; // loop infinito
      }

      // Persiste para a próxima montagem continuar daqui.
      persist.frenteFrac = frente / H;
      persist.prog = prog;
      persist.dir = dir;
      persist.iniciado = true;

      raf = requestAnimationFrame(frame);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [opacity, variante]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
