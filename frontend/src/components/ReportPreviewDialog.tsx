interface ReportPreviewDialogProps {
  open: boolean;
  title: string;
  path?: string;
  content?: string;
  kind?: string;
  loading: boolean;
  onDownload?: () => void;
  onClose: () => void;
}

interface ReportPreviewProps {
  content?: string;
  kind?: string;
  loading: boolean;
  expanded?: boolean;
}

export function ReportPreviewDialog({ open, title, path, content, kind, loading, onDownload, onClose }: ReportPreviewDialogProps) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="report-dialog" role="dialog" aria-modal="true" aria-label="报告预览" onMouseDown={(event) => event.stopPropagation()}>
        <header className="report-dialog-header">
          <div>
            <span className="dialog-kicker">Report Preview</span>
            <h3>{title}</h3>
            {path && <p>{path}</p>}
          </div>
          <div className="report-dialog-actions">
            <button className="secondary-btn" disabled={!content || !onDownload} type="button" onClick={onDownload}>
              下载
            </button>
            <button className="secondary-btn" type="button" onClick={onClose}>
              关闭
            </button>
          </div>
        </header>
        <ReportPreview content={content} kind={kind} loading={loading} expanded />
      </section>
    </div>
  );
}

export function ReportPreview({ content, kind, loading, expanded = false }: ReportPreviewProps) {
  return (
    <div className={`report-preview ${expanded ? "report-preview-expanded" : ""}`}>
      {content ? (
        kind === "html" ? (
          <iframe className="report-frame" srcDoc={content} title="HTML Report Preview" />
        ) : (
          <pre>{content}</pre>
        )
      ) : loading ? (
        <div className="empty-state">正在加载报告预览...</div>
      ) : (
        <div className="empty-state">选择一份报告进行预览。</div>
      )}
    </div>
  );
}
