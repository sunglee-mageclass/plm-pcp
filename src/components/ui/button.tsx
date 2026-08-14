import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Padrões v3 §Q4/§Q10: foco = outline 2px + offset (era ring-1 sem respiro);
  // disabled = SÓLIDO via token muted (motivo sempre visível), NUNCA opacity.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors focus-visible:[outline:2px_solid_var(--ring)] focus-visible:outline-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:border-transparent disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // §Q4/§Q6: padrão 36px · compacto (sm) 30px · confortável (lg) 40px.
        // Toque 44px no mobile (max-md:h-11) mantido em todos.
        default: "h-9 px-4 py-2 max-md:h-11",
        sm: "h-[30px] rounded-md px-3 text-xs max-md:h-11",
        lg: "h-10 rounded-md px-8 max-md:h-11",
        icon: "h-9 w-9 max-md:h-11 max-md:w-11",
        // Ícone compacto p/ AÇÕES DENTRO DE TABELAS (editar/excluir na linha): 32px em
        // todos os tamanhos, pra a linha ficar na altura do texto (padrão "compacto").
        iconSm: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
