import type { ReactNode } from "react";
import { type LucideIcon } from "lucide-react";

type PageHeaderProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actions?: ReactNode;
};

export function PageHeader({ icon: Icon, title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <Icon className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="font-display truncate text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end [&>*]:min-w-0 [&>button]:flex-1 sm:[&>button]:flex-none">
          {actions}
        </div>
      )}
    </header>
  );
}
