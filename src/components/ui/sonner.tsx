import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Padrões v3 §Q9: fórmula única de tom (mesma receita do StatusBadge — bg/fg via
// tokens --tone-*-bg/-fg, que já trocam de valor entre :root/.dark em styles.css).
// Antes sucesso/erro/aviso/info eram visualmente idênticos (fundo bg-background fixo
// pros 4 — só o ícone do sonner diferia); cada tipo ganha o tom certo aqui. O prefixo
// `!` é necessário: a folha do sonner define background/border/color no seletor
// `[data-sonner-toast][data-styled=true]` (2 seletores de atributo — especificidade
// maior que uma classe Tailwind isolada), então uma classe comum perderia a disputa.
// O ícone do sonner usa fill="currentColor", então herda --tone-*-fg de graça.
const TONE_CLASSNAMES = {
  success: "!bg-[var(--tone-success-bg)] !text-[var(--tone-success-fg)] !border-transparent",
  error: "!bg-[var(--tone-danger-bg)] !text-[var(--tone-danger-fg)] !border-transparent",
  warning: "!bg-[var(--tone-warning-bg)] !text-[var(--tone-warning-fg)] !border-transparent",
  info: "!bg-[var(--tone-info-bg)] !text-[var(--tone-info-fg)] !border-transparent",
};

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      // Posição (mudança mínima p/ §Q10): o default do sonner é bottom-right e, abaixo de
      // 600px, ele sempre cai pro rodapé em full-width — colidia com a barra de ações
      // sticky (PageActionBar/MobileActionBar, fixed inset-x-0 bottom-0 z-40, ~68px de
      // altura no mobile): o toast (z-index 999999999 do sonner) cobria os botões Salvar/
      // Excluir com só 16px de offset padrão. Este app não tem header fixo no topo, então
      // top-center resolve nos dois breakpoints sem precisar de offset dedicado por tela.
      position="top-center"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success: TONE_CLASSNAMES.success,
          error: TONE_CLASSNAMES.error,
          warning: TONE_CLASSNAMES.warning,
          info: TONE_CLASSNAMES.info,
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
