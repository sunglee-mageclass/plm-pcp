import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ModulePageProps {
  icon: LucideIcon;
  title: string;
  description: string;
  subPages?: string[];
}

export function ModulePage({ icon: Icon, title, description, subPages = [] }: ModulePageProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
      </div>

      {subPages.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subPages.map((name) => (
            <Card key={name} className="hover:border-primary/40 transition-colors">
              <CardHeader>
                <CardTitle className="text-base">{name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Em breve — sub-página será implementada.
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {subPages.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Conteúdo deste módulo será implementado em breve.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
