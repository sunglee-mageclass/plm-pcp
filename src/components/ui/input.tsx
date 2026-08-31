import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onWheel, onKeyDown, ...props }, ref) => {
    return (
      <input
        type={type}
        // Em inputs numéricos a roda do mouse e as setas ↑/↓ NÃO alteram o valor
        // (evita mudanças acidentais, ex.: 14 virar 13,99). As setas visuais já são
        // escondidas via CSS (styles.css).
        onWheel={(e) => {
          if (type === "number") (e.currentTarget as HTMLInputElement).blur();
          onWheel?.(e);
        }}
        onKeyDown={(e) => {
          if (type === "number" && (e.key === "ArrowUp" || e.key === "ArrowDown")) e.preventDefault();
          onKeyDown?.(e);
        }}
        className={cn(
          // Padrões v3 §Q4/§Q10: foco = outline 2px + offset (era ring-1 sem respiro,
          // como o button.tsx). Espelha o button e a regra global :where() do styles.css.
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:[outline:2px_solid_var(--ring)] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 max-md:h-11 max-md:text-[16px] md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
