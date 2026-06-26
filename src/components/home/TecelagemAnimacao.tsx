import { useEffect, useRef } from "react";

type Props = {
  className?: string;
  /** Opacidade geral do tecido (0..1). Home cheia ~1; fundo de login mais sutil ~0.5. */
  opacity?: number;
};

// Estado da tecelagem persistido em ESCOPO DE MÓDULO: ao navegar home→/auth o componente
// remonta, mas a animação continua de onde parou (frente/progresso/sentido), em vez de
// começar do zero. Guardado em fração (independe de altura/espaçamento de cada tela).
const persist = { frenteFrac: 0, prog: 0, dir: 1, iniciado: false };

const ESPACAMENTO = 40;   // distância entre fios do urdume (px)
const ROW_H = 30;         // distância entre linhas da trama (px)
const AMP = 8.5;          // o quanto a trama sobe/desce ao passar por cima/por baixo

/**
 * Animação da identidade do sisTrama — TECELAGEM REAL: a TRAMA (fio horizontal) passa
 * por CIMA de um fio do URDUME (verticais, sob tensão) e por BAIXO do próximo, ondulando
 * e prendendo os fios para formar o tecido, linha a linha. A "frente" desce, deixa o pano
 * pronto atrás e reinicia no topo (loop infinito).
 *
 * Como o over/under aparece em 2D: a trama ondula (senoide) — fica "na frente" (desenhada
 * por cima) nos cruzamentos por cima e "atrás" nos por baixo, onde o fio do urdume é
 * redesenhado por cima (oclusão). A paridade inverte a cada linha → entrelaçamento.
 *
 * Sem dependência nova (canvas 2D + rAF). Lê as cores do tema via sondagem (lida com
 * oklch sem parsear). Respeita prefers-reduced-motion (tecido pronto, estático).
 */
export function TecelagemAnimacao({ className, opacity = 1 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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

    let W = 1, H = 1, dpr = 1, cols = 0, gridX0 = 0;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // fios suficientes p/ cobrir a largura (com folga nas bordas)
      cols = Math.ceil(W / ESPACAMENTO) + 2;
      gridX0 = (W - (cols - 1) * ESPACAMENTO) / 2;
      corFio = probe("text-foreground", corFio);
      corTrama = probe("text-primary", corTrama);
    };
    resize();

    const colX = (i: number) => gridX0 + i * ESPACAMENTO;
    const gx1 = () => colX(cols - 1);

    // Urdume: fios verticais sob tensão (full height), bem sutis.
    const drawUrdume = (alpha: number) => {
      ctx.strokeStyle = corFio;
      ctx.lineWidth = 1.1;
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

    // Uma linha da trama na altura y, com paridade `row`. `limX`/`dir` controlam até onde
    // a lançadeira já passou (linha em formação). over(i) verdadeiro = trama por cima.
    const drawTrama = (y: number, row: number, limX: number) => {
      const sign = row % 2 === 0 ? 1 : -1;
      const over = (i: number) => ((i + row) % 2 === 0);
      const tramaY = (x: number) =>
        y - AMP * sign * Math.cos((Math.PI * (x - gridX0)) / ESPACAMENTO);

      const xIni = colX(0);
      const xFim = Math.min(gx1(), limX);
      if (xFim <= xIni) return;

      // Fio da trama ondulando (senoide) da esquerda até onde a lançadeira chegou.
      ctx.strokeStyle = corTrama;
      ctx.lineWidth = 1.8;
      ctx.globalAlpha = 0.85 * opacity;
      ctx.beginPath();
      ctx.moveTo(xIni, tramaY(xIni));
      for (let x = xIni + 3; x <= xFim; x += 3) ctx.lineTo(x, tramaY(x));
      ctx.lineTo(xFim, tramaY(xFim));
      ctx.stroke();

      // Oclusão: nos cruzamentos por BAIXO, redesenha o fio do urdume POR CIMA da trama.
      ctx.strokeStyle = corFio;
      ctx.lineWidth = 1.3;
      ctx.globalAlpha = 0.5 * opacity;
      ctx.beginPath();
      for (let i = 0; i < cols; i++) {
        const x = colX(i);
        if (x > xFim || over(i)) continue;
        ctx.moveTo(Math.round(x) + 0.5, y - AMP - 2);
        ctx.lineTo(Math.round(x) + 0.5, y + AMP + 2);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    // Desenha todas as linhas de trama já prontas (até `frente`).
    const drawProntas = (frente: number) => {
      for (let row = 0; ; row++) {
        const y = ROW_H * (row + 1);
        if (y >= frente || y > H + AMP) break;
        drawTrama(y, row, gx1());
      }
    };

    if (reduzir) {
      const paint = () => {
        ctx.clearRect(0, 0, W, H);
        drawUrdume(0.14);
        drawProntas(H + ROW_H);
      };
      paint();
      const ro = new ResizeObserver(() => { resize(); paint(); });
      ro.observe(canvas);
      return () => ro.disconnect();
    }

    let frente = persist.iniciado ? Math.round((persist.frenteFrac * H) / ROW_H) * ROW_H : 0;
    let prog = persist.iniciado ? persist.prog : 0;
    let dir = persist.iniciado ? persist.dir : 1;
    let row = Math.max(0, Math.round(frente / ROW_H) - 1);
    let raf = 0;
    const VEL = 0.02;

    const frame = () => {
      ctx.clearRect(0, 0, W, H);
      drawUrdume(0.1);
      drawProntas(frente);

      // Linha ativa: a lançadeira vai de um lado ao outro (vai-e-vem) tecendo a trama.
      const yA = frente;
      if (yA > 0 && yA <= H + AMP) {
        const xIni = colX(0), xFim = gx1();
        const limX = dir === 1 ? xIni + (xFim - xIni) * prog : xFim - (xFim - xIni) * prog;
        // quando dir = -1, revela do lado direito: desenha tudo e "esconde" o que falta
        if (dir === 1) {
          drawTrama(yA, row, limX);
        } else {
          ctx.save();
          ctx.beginPath();
          ctx.rect(limX, yA - AMP - 3, xFim - limX + 2, 2 * AMP + 6);
          ctx.clip();
          drawTrama(yA, row, xFim);
          ctx.restore();
        }
        // lançadeira (ponta do fio) — discreta, sem brilho de "laser"
        const sx = limX;
        ctx.fillStyle = corTrama;
        ctx.globalAlpha = opacity;
        ctx.beginPath();
        ctx.arc(sx, yA, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      prog += VEL;
      if (prog >= 1) {
        prog = 0;
        dir *= -1;
        row += 1;
        frente += ROW_H;
        if (frente > H + ROW_H) { frente = 0; row = 0; } // loop
      }

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
  }, [opacity]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
