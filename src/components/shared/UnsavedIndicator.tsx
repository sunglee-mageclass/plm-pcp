interface UnsavedIndicatorProps {
  show: boolean;
}

export function UnsavedIndicator({ show }: UnsavedIndicatorProps) {
  if (!show) return null;
  return (
    <span title="Há alterações não salvas" className="text-amber-600 text-xs">
      ● alterações não salvas
    </span>
  );
}
