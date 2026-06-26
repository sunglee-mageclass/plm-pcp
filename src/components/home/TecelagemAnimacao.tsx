import { useEffect, useRef } from "react";

type Props = {
  className?: string;
  /** Opacidade geral do tecido (0..1). Home cheia ~1; fundo de login mais sutil ~0.5. */
  opacity?: number;
  /** Espaçamento-alvo entre fios do urdume (px). Maior = mais minimalista/arejado. */
  espacamento?: number;
};

/**
 * Animação da identidade do sisTrama: os fios do URDUME (verticais, sob tensão) sendo
 * "juntados" pela TRAMA (a lançadeira horizontal que cruza por cima/por baixo, formando
 * o tecido linha a linha). Loop infinito: a frente de tecelagem desce, deixa o pano
 * pronto atrás e reinicia no topo.
 *
 * Sem dependência nova (canvas 2D + requestAnimationFrame). Lê as cores do tema via
 * sondagem (funciona com `oklch` sem precisar parsear). Respeita prefers-reduced-motion
 * (mostra o tecido já pronto, estático).
 */
export function TecelagemAnimacao({ className, opacity = 1, espacamento = 46 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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
    const rowH = Math.max(12, Math.round(espacamento * 0.46)); // trama mais junta que o urdume

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.max(6, Math.floor(W / espacamento) + 1);
      // re-sonda (tema pode ter mudado entre montagens)
      corFio = probe("text-foreground", corFio);
      corTrama = probe("text-primary", corTrama);
    };
    resize();

    const span = () => (cols - 1) * espacamento;
    const x0 = () => (W - span()) / 2;
    const colX = (i: number) => x0() + i * espacamento;
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
      ctx.lineWidth = 1.3;
      ctx.globalAlpha = 0.22 * opacity;
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
      ctx.clearRect(0, 0, W, H);
      drawUrdume(0.16);
      drawTecido(H + rowH);
      const ro = new ResizeObserver(() => {
        resize();
        ctx.clearRect(0, 0, W, H);
        drawUrdume(0.16);
        drawTecido(H + rowH);
      });
      ro.observe(canvas);
      return () => ro.disconnect();
    }

    let frente = -rowH; // posição vertical da frente de tecelagem
    let prog = 0;       // 0..1 progresso da lançadeira na linha atual
    let dir = 1;        // 1 = esquerda→direita, -1 = direita→esquerda
    let raf = 0;
    const VEL = 0.022;  // progresso por frame

    const frame = () => {
      ctx.clearRect(0, 0, W, H);

      // Urdume solto (mais fraco) + tecido pronto atrás da frente.
      drawUrdume(0.1);
      drawTecido(frente);

      // Linha ativa: a trama já tecida nesta passada (do lado de partida até a lançadeira).
      const yA = frente;
      if (yA > 0 && yA < H) {
        const ini = dir === 1 ? xL() : xR();
        const sx = ini + (dir === 1 ? span() : -span()) * prog;
        ctx.strokeStyle = corTrama;
        ctx.globalAlpha = 0.9 * opacity;
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.moveTo(ini, yA);
        ctx.lineTo(sx, yA);
        ctx.stroke();

        // Lançadeira (ponto com brilho) na ponta.
        ctx.globalAlpha = opacity;
        ctx.fillStyle = corTrama;
        ctx.shadowColor = corTrama;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(sx, yA, 2.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }

      // Avança a lançadeira; ao completar a passada, desce uma linha e inverte o sentido.
      prog += VEL;
      if (prog >= 1) {
        prog = 0;
        dir *= -1;
        frente += rowH;
        if (frente > H + rowH) frente = -rowH; // loop infinito
      }
      raf = requestAnimationFrame(frame);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [opacity, espacamento]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
