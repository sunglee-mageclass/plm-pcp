import { ChevronRight } from "lucide-react";
import { Link } from "@tanstack/react-router";

interface BreadcrumbItem {
  label: string;
  to?: string;
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
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {item.label}
                </Link>
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
