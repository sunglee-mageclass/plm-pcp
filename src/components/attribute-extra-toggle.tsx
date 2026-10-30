import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { InfoHover } from "@/components/shared/InfoHover";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { textoDoToggle, type ExtraToggle } from "@/lib/attribute-extra-toggles";

/** Célula da tabela do Cadastro › Atributos para um `extraToggles`: Switch inline na linha em edição, selo na leitura. */
export function ExtraToggleCell({
  toggle,
  valor,
  editando,
  onChange,
  disabled,
}: {
  toggle: ExtraToggle;
  valor: boolean;
  editando: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  if (!editando) {
    return <StatusBadge tone={valor ? "info" : "neutral"}>{textoDoToggle(toggle, valor)}</StatusBadge>;
  }
  return (
    <div className="flex items-center gap-2">
      <Switch checked={valor} onCheckedChange={onChange} aria-label={toggle.label} disabled={disabled} />
      <span className="text-xs text-muted-foreground">{textoDoToggle(toggle, valor)}</span>
    </div>
  );
}

/** Campo do Dialog "Novo" e do Sheet de edição: Switch + rótulo + "i" com a dica (nunca texto fixo embaixo). */
export function ExtraToggleField({
  toggle,
  valor,
  onChange,
  disabled,
  idPrefix,
}: {
  toggle: ExtraToggle;
  valor: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const id = `${idPrefix}-${toggle.field}`;
  return (
    <div className="flex items-center gap-2 pt-1">
      <Switch id={id} checked={valor} onCheckedChange={onChange} aria-label={toggle.label} disabled={disabled} />
      <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
        {toggle.label}
        <span className="ml-1.5 text-muted-foreground">· {textoDoToggle(toggle, valor)}</span>
      </Label>
      {toggle.hint && <InfoHover ariaLabel={`O que é "${toggle.label}"`}>{toggle.hint}</InfoHover>}
    </div>
  );
}
