import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

// Padrões v3 §Q10 (fade de rolagem — mesma técnica do SegmentedTabs em
// src/components/dashboard/mobile.tsx): quando a TabsList estoura a largura
// (telas estreitas), o overflow-x já existia; o que faltava era o affordance —
// gradiente POR LADO, só quando há conteúdo escondido daquele lado (medido em
// onScroll + ResizeObserver, nunca incondicional, senão "borra" a aba ativa
// quando ela é a última). O ref caller (Radix usa pra foco/teclado) e o ref
// interno (pra medir scroll) apontam pro MESMO nó — merge simples de refs.
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, forwardedRef) => {
  const innerRef = React.useRef<React.ElementRef<typeof TabsPrimitive.List>>(null);
  const [fade, setFade] = React.useState({ left: false, right: false });

  const medirFade = React.useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    setFade({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);

  React.useEffect(() => {
    medirFade();
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(medirFade);
    ro.observe(el);
    return () => ro.disconnect();
  }, [medirFade]);

  return (
    <div className={cn("relative inline-flex max-w-full", className)}>
      <TabsPrimitive.List
        ref={(node) => {
          innerRef.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) (forwardedRef as React.MutableRefObject<typeof node>).current = node;
        }}
        onScroll={medirFade}
        className="inline-flex h-9 max-w-full items-center justify-center overflow-x-auto rounded-lg bg-muted p-1 text-muted-foreground max-md:h-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        {...props}
      />
      {fade.left && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-8 rounded-l-lg bg-gradient-to-r from-muted to-transparent" />
      )}
      {fade.right && (
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-lg bg-gradient-to-l from-muted to-transparent" />
      )}
    </div>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // §Q6/§Q4: alvo de toque ≥44px SÓ no mobile (max-md:min-h-11) — desktop
      // intacto (h-9 da TabsList/padding seguem definindo a altura ~28-32px).
      // §Q10: disabled sai de opacity (que só esmaece sem dizer o motivo) pra
      // receita única — fundo muted sólido + texto muted-foreground.
      "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background cursor-pointer transition-all max-md:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
