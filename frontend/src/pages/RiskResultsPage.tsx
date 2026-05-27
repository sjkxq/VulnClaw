import { useEffect, useMemo, useState } from "react";
import { generateTargetReport } from "../api/web";
import { SectionCard } from "../components/SectionCard";
import { useTargetPreviewQuery, useTargetQuery, useTargetsQuery } from "../hooks/queries";

interface RiskResultsPageProps {
  selectedTarget: string | null;
  onSelectTarget: (target: string | null) => void;
  onOpenReports: () => void;
  onOpenBoundary: () => void;
}

interface FindingCard {
  id: string;
  title: string;
  severity: string;
  status: string;
  evidence: string;
  impact: string;
  recommendation: string;
  type: string;
}

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function normalizeSeverity(value: unknown): string {
  const text = asText(value, "Info");
  const lower = text.toLowerCase();
  if (lower.includes("critical")) return "Critical";
  if (lower.includes("high")) return "High";
  if (lower.includes("medium")) return "Medium";
  if (lower.includes("low")) return "Low";
  return text;
}

function severityTone(severity: string): "danger" | "warn" | "ok" | "info" {
  if (severity === "Critical" || severity === "High") return "danger";
  if (severity === "Medium") return "warn";
  if (severity === "Low") return "ok";
  return "info";
}

function extractEvidence(raw: Record<string, unknown>): string {
  const evidence = raw.evidence;
  if (typeof evidence === "string" && evidence.trim()) return evidence;
  if (Array.isArray(evidence) && evidence.length) return evidence.map(String).slice(0, 3).join(" / ");
  return asText(raw.description, "暂未整理证据摘要，可在技术详情中查看原始记录。");
}

function extractFindingCards(rawFindings: unknown): FindingCard[] {
  if (!Array.isArray(rawFindings)) return [];
  return rawFindings.slice(0, 24).map((item, index) => {
    const raw = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const title = asText(raw.title, `风险线索 ${index + 1}`);
    return {
      id: asText(raw.finding_id, `${title}-${index}`),
      title,
      severity: normalizeSeverity(raw.severity),
      status: asText(raw.verification_status, asText(raw.lifecycle_status, raw.verified ? "verified" : "pending")),
      evidence: extractEvidence(raw),
      impact: asText(raw.impact, asText(raw.risk, "需要结合目标上下文判断影响范围。")),
      recommendation: asText(raw.recommendation, asText(raw.remediation, "建议人工复核该线索，并按最小暴露面原则修复。")),
      type: asText(raw.vuln_type, asText(raw.category, "未分类")),
    };
  });
}

function resultConclusion(verified: number, pending: number, manualReview: number): string {
  if (verified > 0) return `发现 ${verified} 个已验证风险，建议优先处理。`;
  if (manualReview > 0) return `有 ${manualReview} 个高价值线索需要人工复核。`;
  if (pending > 0) return `发现 ${pending} 个待复核线索，暂未确认可利用风险。`;
  return "暂未发现明确风险，可结合更深模式继续检查。";
}

export function RiskResultsPage({ selectedTarget, onSelectTarget, onOpenReports, onOpenBoundary }: RiskResultsPageProps) {
  const targetsQuery = useTargetsQuery();
  const [localTarget, setLocalTarget] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (selectedTarget) {
      setLocalTarget(selectedTarget);
      return;
    }
    const first = targetsQuery.data?.[0]?.target;
    if (first) {
      setLocalTarget(first);
      onSelectTarget(first);
    }
  }, [selectedTarget, targetsQuery.data, onSelectTarget]);

  const targetValue = selectedTarget ?? localTarget ?? null;
  const targetQuery = useTargetQuery(targetValue);
  const previewQuery = useTargetPreviewQuery(targetValue);
  const target = targetQuery.data;
  const preview = previewQuery.data;

  const findings = useMemo(() => extractFindingCards(target?.raw?.findings), [target]);
  const criticalOrHigh = findings.filter((item) => item.severity === "Critical" || item.severity === "High").length;
  const boundaryBlocks = target?.constraint_violation_events.length ?? target?.constraint_violations.length ?? 0;
  const nextActions = preview?.next_actions ?? [];

  async function handleGenerateReport() {
    if (!targetValue) return;
    try {
      setGenerating(true);
      setError(null);
      const result = await generateTargetReport(targetValue);
      setMessage(`报告已生成: ${result.path}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "报告生成失败");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="risk-page">
      <SectionCard
        title="目标风险概览"
        copy="优先展示用户真正关心的结论、风险数量、证据和下一步。"
        aside={<span className="status-badge">{target?.phase ?? "等待目标"}</span>}
      >
        <label className="field">
          <span>目标</span>
          <select
            value={targetValue ?? ""}
            onChange={(event) => {
              const value = event.target.value || null;
              setLocalTarget(value ?? "");
              onSelectTarget(value);
              setMessage(null);
              setError(null);
            }}
          >
            <option value="">选择一个目标</option>
            {targetsQuery.data?.map((item) => (
              <option key={item.target} value={item.target}>
                {item.target}
              </option>
            ))}
          </select>
        </label>

        {target ? (
          <>
            <div className="risk-hero">
              <div>
                <span className="pill">安全结论</span>
                <h3>{resultConclusion(target.verified_count, target.pending_count, target.manual_review_count)}</h3>
                <p>
                  VulnClaw 已将目标状态、验证结果、待复核线索和安全边界信息合并到当前视图。
                </p>
              </div>
              <div className="risk-score">
                <strong>{criticalOrHigh}</strong>
                <span>高优先级风险</span>
              </div>
            </div>

            <div className="stats-grid">
              <article className="stat">
                <span className="stat-label">已验证风险</span>
                <strong>{target.verified_count}</strong>
              </article>
              <article className="stat">
                <span className="stat-label">待复核线索</span>
                <strong>{target.pending_count}</strong>
              </article>
              <article className="stat">
                <span className="stat-label">人工复核</span>
                <strong>{target.manual_review_count}</strong>
              </article>
              <article className="stat">
                <span className="stat-label">边界拦截</span>
                <strong>{boundaryBlocks}</strong>
              </article>
            </div>

            <div className="button-row">
              <button type="button" className="primary-btn" disabled={generating} onClick={handleGenerateReport}>
                {generating ? "生成中..." : "生成报告"}
              </button>
              <button type="button" className="secondary-btn" onClick={onOpenReports}>
                查看报告中心
              </button>
              <button type="button" className="secondary-btn" onClick={onOpenBoundary}>
                查看安全边界
              </button>
            </div>

            {message && <div className="success-box">{message}</div>}
            {error && <div className="error-box">{error}</div>}
          </>
        ) : (
          <div className="empty-state">{targetQuery.isLoading ? "正在加载目标..." : "还没有可展示的目标结果。"}</div>
        )}
      </SectionCard>

      {target && (
        <div className="split-grid">
          <SectionCard title="风险列表" copy="按严重程度和验证状态展示，原始 JSON 默认收起。">
            <div className="risk-list">
              {findings.length ? (
                findings.map((finding) => (
                  <article key={finding.id} className="risk-item">
                    <div className="risk-item-head">
                      <div>
                        <span className={`severity-badge severity-${severityTone(finding.severity)}`}>{finding.severity}</span>
                        <h4>{finding.title}</h4>
                      </div>
                      <span className="status-badge">{finding.status}</span>
                    </div>
                    <div className="risk-detail-grid">
                      <div>
                        <strong>类型</strong>
                        <span>{finding.type}</span>
                      </div>
                      <div>
                        <strong>证据摘要</strong>
                        <span>{finding.evidence}</span>
                      </div>
                      <div>
                        <strong>影响范围</strong>
                        <span>{finding.impact}</span>
                      </div>
                      <div>
                        <strong>修复建议</strong>
                        <span>{finding.recommendation}</span>
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state">当前目标还没有结构化风险项。</div>
              )}
            </div>
          </SectionCard>

          <SectionCard title="下一步建议" copy="把 resume plan 和治理信号转成可执行建议。">
            <div className="list dense-list">
              <div className="list-item">
                <strong>恢复策略</strong>
                <span>{target.resume_strategy || preview?.resume_strategy || "暂无策略"}</span>
                <span className="muted-inline">{target.resume_reason || preview?.resume_reason || "暂无说明"}</span>
              </div>
              <div className="list-item">
                <strong>推荐动作</strong>
                {nextActions.length ? (
                  nextActions.slice(0, 6).map((item) => <span key={item}>{item}</span>)
                ) : (
                  <span className="muted-inline">暂无推荐动作。</span>
                )}
              </div>
              <div className="list-item">
                <strong>优先目标</strong>
                {preview?.priority_targets.length ? (
                  preview.priority_targets.slice(0, 6).map((item) => <span key={item}>{item}</span>)
                ) : (
                  <span className="muted-inline">暂无优先目标。</span>
                )}
              </div>
              <div className="list-item">
                <strong>安全边界</strong>
                <span className="muted-inline">
                  {Object.keys(target.constraints).length ? JSON.stringify(target.constraints) : "未设置额外边界"}
                </span>
              </div>
            </div>
          </SectionCard>
        </div>
      )}

      {target && (
        <SectionCard
          title="技术详情"
          copy="高级用户可以展开查看原始 Target State，普通用户默认不需要阅读。"
          aside={
            <button type="button" className="text-btn inline-text-btn" onClick={() => setShowRaw((value) => !value)}>
              {showRaw ? "收起" : "展开"}
            </button>
          }
        >
          {showRaw ? (
            <div className="report-preview">
              <pre>{JSON.stringify(target.raw, null, 2)}</pre>
            </div>
          ) : (
            <div className="empty-state">原始状态已收起。</div>
          )}
        </SectionCard>
      )}
    </section>
  );
}
