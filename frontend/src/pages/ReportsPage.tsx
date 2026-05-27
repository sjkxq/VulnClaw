import { useEffect, useState } from "react";
import { generateTargetReport } from "../api/web";
import { ReportPreview, ReportPreviewDialog } from "../components/ReportPreviewDialog";
import { SectionCard } from "../components/SectionCard";
import { useReportContentQuery, useReportsQuery } from "../hooks/queries";
import type { ReportListItem } from "../types/api";
import { loadUiPreferences } from "../utils/preferences";

interface ReportsPageProps {
  selectedTarget: string | null;
}

export function ReportsPage({ selectedTarget }: ReportsPageProps) {
  const reportsQuery = useReportsQuery();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const contentQuery = useReportContentQuery(selectedPath);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [search, setSearch] = useState(selectedTarget ?? "");
  const [kindFilter, setKindFilter] = useState<"all" | "markdown" | "html">(() => loadUiPreferences().reportFormat);
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "week">("all");

  useEffect(() => {
    if (!selectedPath && reportsQuery.data?.[0]?.path) {
      setSelectedPath(reportsQuery.data[0].path);
    }
  }, [selectedPath, reportsQuery.data]);

  useEffect(() => {
    if (selectedTarget) {
      setSearch(selectedTarget);
    }
  }, [selectedTarget]);

  async function handleGenerate() {
    if (!selectedTarget) return;
    try {
      setGenerating(true);
      setError(null);
      const result = await generateTargetReport(selectedTarget);
      setStatus(result.path);
      await reportsQuery.refetch();
      setSelectedPath(result.path);
      setPreviewOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate report");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopyPath() {
    if (!selectedReport?.path) return;
    try {
      await navigator.clipboard.writeText(selectedReport.path);
      setCopyStatus("报告路径已复制。");
    } catch {
      setCopyStatus("无法访问剪贴板，请手动复制报告路径。");
    }
  }

  function handleDownload() {
    const content = contentQuery.data?.content;
    if (!content || !selectedReport) return;
    const mime = contentQuery.data?.kind === "html" ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8";
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = selectedReport.name || `vulnclaw-report.${contentQuery.data?.kind === "html" ? "html" : "md"}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setCopyStatus("报告已开始下载。");
  }

  const reports = reportsQuery.data ?? [];
  const filteredReports = reports.filter((report) => reportMatchesFilters(report, search, kindFilter, dateFilter));
  const selectedReport = filteredReports.find((report) => report.path === selectedPath)
    ?? reports.find((report) => report.path === selectedPath)
    ?? filteredReports[0]
    ?? reports[0]
    ?? null;
  const markdownCount = reports.filter((report) => report.kind === "markdown").length;
  const htmlCount = reports.filter((report) => report.kind === "html").length;
  const totalSize = reports.reduce((sum, report) => sum + (report.size_bytes ?? 0), 0);

  return (
    <section className="reports-page">
      <SectionCard
        title="报告中心"
        copy="生成、预览和整理安全测试报告。报告内容仍来自后端真实生成结果。"
        aside={<span className="status-badge">{reports.length} 份报告</span>}
      >
        <div className="report-hero">
          <div>
            <span className="pill">最新报告</span>
            <h3>{selectedReport?.name ?? "暂无报告"}</h3>
            <p>{selectedReport?.path ?? "选择目标并生成报告后，这里会显示最新交付物。"}</p>
          </div>
          <div className="report-actions">
            <button
              className="primary-btn"
              disabled={!selectedTarget || generating}
              onClick={handleGenerate}
              type="button"
            >
              {generating ? "生成中..." : "生成目标报告"}
            </button>
            <button
              className="secondary-btn"
              disabled={!selectedPath}
              onClick={() => setPreviewOpen(true)}
              type="button"
            >
              沉浸预览
            </button>
            <button
              className="secondary-btn"
              disabled={!contentQuery.data?.content}
              onClick={handleDownload}
              type="button"
            >
              下载当前报告
            </button>
          </div>
        </div>

        <div className="stats-grid">
          <article className="stat">
            <span className="stat-label">Markdown</span>
            <strong>{markdownCount}</strong>
          </article>
          <article className="stat">
            <span className="stat-label">HTML</span>
            <strong>{htmlCount}</strong>
          </article>
          <article className="stat">
            <span className="stat-label">当前目标</span>
            <strong>{selectedTarget ?? "未选择"}</strong>
          </article>
          <article className="stat">
            <span className="stat-label">总大小</span>
            <strong>{formatSize(totalSize)}</strong>
          </article>
        </div>

        {selectedTarget && <p className="inline-note">当前目标: <code>{selectedTarget}</code></p>}
        {status && <div className="success-box">报告已生成: {status}</div>}
        {copyStatus && <div className="success-box">{copyStatus}</div>}
        {error && <div className="error-box">{error}</div>}
      </SectionCard>

      <div className="report-center-grid">
        <SectionCard
          title="报告列表"
          copy="按目标、格式和时间筛选，点击任意报告可在右侧预览。"
          aside={<span className="status-badge">{filteredReports.length} / {reports.length}</span>}
        >
          <div className="report-filter-grid">
            <label className="field">
              <span>目标或文件名</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="example.com / report.md" />
            </label>
            <label className="field">
              <span>格式</span>
              <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as "all" | "markdown" | "html")}>
                <option value="all">全部格式</option>
                <option value="markdown">Markdown</option>
                <option value="html">HTML</option>
              </select>
            </label>
            <label className="field">
              <span>时间</span>
              <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as "all" | "today" | "week")}>
                <option value="all">全部时间</option>
                <option value="today">今天</option>
                <option value="week">最近 7 天</option>
              </select>
            </label>
          </div>
          <div className="list list-scroll report-file-list">
            {filteredReports.slice(0, 24).map((report) => (
              <button
                key={report.path}
                type="button"
                className={`list-item list-button report-file-item ${selectedPath === report.path ? "selected-item" : ""}`}
                onClick={() => setSelectedPath(report.path)}
              >
                <strong>{report.name}</strong>
                <span>{report.kind} · {formatSize(report.size_bytes ?? 0)}</span>
                <span className="muted-inline">{formatDate(report.modified_at)}</span>
                <span className="muted-inline">{report.path}</span>
              </button>
            ))}
            {!reports.length && <div className="empty-state">还没有生成报告。</div>}
            {Boolean(reports.length) && !filteredReports.length && <div className="empty-state">没有匹配当前筛选条件的报告。</div>}
          </div>
        </SectionCard>

        <SectionCard
          title="报告预览"
          copy="优先展示可读报告内容，文件路径和格式信息放在辅助区域。"
          aside={
            <div className="report-preview-actions">
              <button className="text-btn inline-text-btn" disabled={!contentQuery.data?.content} onClick={handleDownload} type="button">
                下载
              </button>
              <button className="text-btn inline-text-btn" disabled={!selectedReport?.path} onClick={() => void handleCopyPath()} type="button">
                复制路径
              </button>
              <button className="text-btn inline-text-btn" disabled={!selectedPath} onClick={() => setPreviewOpen(true)} type="button">
                放大阅读
              </button>
            </div>
          }
        >
          <ReportPreview content={contentQuery.data?.content} kind={contentQuery.data?.kind} loading={contentQuery.isLoading} />
        </SectionCard>
      </div>

      <ReportPreviewDialog
        open={previewOpen}
        title={selectedReport?.name ?? "报告预览"}
        path={selectedReport?.path}
        content={contentQuery.data?.content}
        kind={contentQuery.data?.kind}
        loading={contentQuery.isLoading}
        onDownload={handleDownload}
        onClose={() => setPreviewOpen(false)}
      />
    </section>
  );
}

function reportMatchesFilters(
  report: ReportListItem,
  search: string,
  kindFilter: "all" | "markdown" | "html",
  dateFilter: "all" | "today" | "week",
): boolean {
  const keyword = search.trim().toLowerCase();
  const haystack = `${report.name} ${report.path}`.toLowerCase();
  if (keyword && !haystack.includes(keyword)) return false;
  if (kindFilter !== "all" && report.kind !== kindFilter) return false;
  return matchesDateFilter(report.modified_at, dateFilter);
}

function matchesDateFilter(value: string | undefined, filter: "all" | "today" | "week"): boolean {
  if (filter === "all") return true;
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  if (filter === "today") {
    return date.toDateString() === now.toDateString();
  }
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return date.getTime() >= weekAgo;
}

function formatDate(value: string | undefined): string {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatSize(value: number): string {
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
