export function Switch({
  checked,
  onCheckedChange,
  onChange,
}: {
  checked?: boolean;
  onCheckedChange?: (v: boolean) => void;
  onChange?: (v: boolean) => void;
}) {
  const val = Boolean(checked);
  const emit = (v: boolean) => {
    onCheckedChange?.(v);
    onChange?.(v);
  };
  return (
    <button
      type="button"
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        val ? "bg-primary" : "bg-muted"
      }`}
      onClick={() => emit(!val)}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          val ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
