import { ChevronRight } from "lucide-react";
import { Link } from "@tanstack/react-router";

interface BreadcrumbItem {
  label: string;
  to?: string;
  /** Navegação interna (estado da tela), sem trocar de rota. Ignorado no último item. */
  onClick?: () => void;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav>
      <div className="flex items-center gap-1 flex-wrap">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <span key={index} className="flex items-center gap-1">
              {index > 0 && (
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              )}
              {item.to && !isLast ? (
                <Link
                  to={item.to}
                  className="cursor-pointer text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                >
                  {item.label}
                </Link>
              ) : item.onClick && !isLast ? (
                <button
                  type="button"
                  onClick={item.onClick}
                  className="cursor-pointer text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                >
                  {item.label}
                </button>
              ) : (
                <span
                  className={
                    isLast
                      ? "text-xs text-foreground font-medium"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {item.label}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </nav>
  );
}
