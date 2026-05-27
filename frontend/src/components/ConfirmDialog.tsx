interface ConfirmDialogProps {
  open: boolean;
  title: string;
  copy: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, copy, confirmLabel = "确认", onConfirm, onCancel }: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(event) => event.stopPropagation()}>
        <span className="dialog-kicker">需要确认</span>
        <h3 id="confirm-title">{title}</h3>
        <p>{copy}</p>
        <div className="button-row compact-row">
          <button type="button" className="secondary-btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="primary-btn" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
