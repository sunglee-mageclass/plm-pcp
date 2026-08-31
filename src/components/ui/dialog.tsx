"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useReadOnly } from "@/components/RequirePermission";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /**
   * Rodapé FIXO (§G): header · corpo · rodapé em grade — só o corpo rola (envolva-o
   * em <DialogBody>). Sem isso o Content INTEIRO rola (default shadcn, o rodapé rola
   * junto). Opt-in — nenhum diálogo legado muda. Espelha o grid do OcModalShell.
   */
  fixedFooter?: boolean;
  /**
   * Full-screen no mobile (< md): edge-to-edge, sem borda/raio, X nativo escondido —
   * o padrão aprovado p/ diálogo de FORM no mobile. Opt-in; espelha o que o
   * OcModalShell injetava à mão. Confirmações/AlertDialog NÃO usam (ficam centrados).
   */
  mobileFull?: boolean;
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, fixedFooter, mobileFull, ...props }, ref) => {
  const readOnly = useReadOnly();
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid grid-cols-[minmax(0,1fr)] w-[calc(100%_-_2rem)] max-w-lg max-h-[90dvh] translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-4 sm:p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 rounded-lg",
          // default = Content inteiro rola (shadcn); fixedFooter = grade, só o corpo rola
          fixedFooter
            ? "grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
            : "overflow-y-auto overflow-x-hidden",
          mobileFull &&
            "max-md:w-screen max-md:max-w-none max-md:h-dvh max-md:max-h-dvh max-md:rounded-none max-md:border-0 max-md:!p-4 max-md:[&>button]:hidden",
          className,
        )}
        {...props}
      >
        <fieldset disabled={readOnly} className="contents">
          {children}
        </fieldset>
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background cursor-pointer transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

/**
 * Corpo ROLÁVEL de um diálogo com <DialogContent fixedFooter>: fica entre o
 * DialogHeader (topo fixo) e o DialogFooter (rodapé fixo), e é o ÚNICO que rola.
 */
const DialogBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("min-h-0 overflow-y-auto", className)} {...props} />
);
DialogBody.displayName = "DialogBody";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  // Padrão do sistema: botões SEMPRE lado a lado (mobile inclusive) — Voltar/Cancelar
  // à esquerda, ação primária à direita (via `ml-auto` no call-site). `flex-wrap` deixa
  // footers com muitos botões quebrarem em vez de estourar a borda. NÃO usar
  // `flex-col-reverse` (empilhava no mobile — provado em 360px). `gap-2` no lugar de
  // `space-x-2` p/ funcionar com o wrap.
  <div
    className={cn("flex flex-row flex-wrap items-center gap-2 sm:justify-end", className)}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
