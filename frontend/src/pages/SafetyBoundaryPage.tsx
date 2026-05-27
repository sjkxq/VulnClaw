import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "../components/SectionCard";
import { useConstraintAuditQuery, useTargetQuery, useTargetsQuery } from "../hooks/queries";
import type { ConstraintAuditEventView } from "../types/api";

interface SafetyBoundaryPageProps {
  selectedTarget: string | null;
  onSelectTarget: (target: string | null) => void;
}

interface BoundaryChip {
  label: string;
  value: string;
  tone: "allow" | "block" | "neutral";
}

function stringifyValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(", ");
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") return JSON.stringify(value);
  return "";
}

function boundaryLabel(key: string): string {
  const labels: Record<string, string> = {
    only_host: "仅允许主机",
    only_path: "仅允许路径",
    only_port: "仅允许端口",
    blocked_host: "排除主机",
    blocked_path: "排除路径",
    allow_actions: "允许动作",
    block_actions: "禁止动作",
  };
  return labels[key] ?? key;
}

function boundaryTone(key: string): BoundaryChip["tone"] {
  if (key.startsWith("blocked") || key.startsWith("block_")) return "block";
  if (key.startsWith("only") || key.startsWith("allow")) return "allow";
  return "neutral";
}

function buildBoundaryChips(constraints: Record<string, unknown> | undefined): BoundaryChip[] {
  if (!constraints) return [];
  return Object.entries(constraints)
    .map(([key, value]) => ({
      label: boundaryLabel(key),
      value: stringifyValue(value),
      tone: boundaryTone(key),
    }))
    .filter((item) => item.value && item.value !== "[]" && item.value !== "{}");
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "未知时间";
  return date.toLocaleString();
}

function eventTone(event: ConstraintAuditEventView): "danger" | "warn" | "info" {
  const severity = event.severity.toLowerCase();
  if (severity.includes("high") || severity.includes("critical")) return "danger";
  if (severity.includes("medium") || severity.includes("warn")) return "warn";
  return "info";
}

export function SafetyBoundaryPage({ selectedTarget, onSelectTarget }: SafetyBoundaryPageProps) {
  const targetsQuery = useTargetsQuery();
  const auditQuery = useConstraintAuditQuery();
  const [localTarget, setLocalTarget] = useState("");
  const [showTechnical, setShowTechnical] = useState(false);

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
  const target = targetQuery.data;
  const audit = auditQuery.data;

  const chips = useMemo(() => buildBoundaryChips(target?.constraints), [target]);
  const targetEvents = useMemo(() => {
    const selected = targetValue;
    const events = audit?.recent_events ?? [];
    return selected ? events.filter((event) => event.target === selected) : events;
  }, [audit?.recent_events, targetValue]);
  const blockedCount = target?.constraint_violation_events.length ?? target?.constraint_violations.length ?? targetEvents.length;
  const highSeverityCount = targetEvents.filter((event) => eventTone(event) === "danger").length;

  return (
    <section className="boundary-page">
      <SectionCard
        title="安全边界保护"
        copy="VulnClaw 会在每轮任务中重复检查这些边界，阻止超出授权范围的动作。"
        aside={<span className="status-badge">{blockedCount} 次拦截</span>}
      >
        <label className="field">
          <span>查看目标</span>
          <select
            value={targetValue ?? ""}
            onChange={(event) => {
              const value = event.target.value || null;
              setLocalTarget(value ?? "");
              onSelectTarget(value);
            }}
          >
            <option value="">全部目标</option>
            {targetsQuery.data?.map((item) => (
              <option key={item.target} value={item.target}>
                {item.target}
              </option>
            ))}
          </select>
        </label>

        <div className="boundary-hero">
          <div>
            <span className="pill">Boundary Guard</span>
            <h3>{blockedCount > 0 ? "已阻止越界尝试" : "当前未记录越界尝试"}</h3>
            <p>
              {targetValue
                ? `当前查看 ${targetValue} 的授权范围和拦截记录。`
                : "选择目标后可查看该目标的授权范围；未选择时展示全局拦截记录。"}
            </p>
          </div>
          <div className="boundary-shield">
            <strong>{blockedCount}</strong>
            <span>Blocked</span>
          </div>
        </div>

        <div className="stats-grid">
          <article className="stat">
            <span className="stat-label">全局拦截</span>
            <strong>{audit?.total_events ?? 0}</strong>
          </article>
          <article className="stat">
            <span className="stat-label">高严重度</span>
            <strong>{audit?.high_severity_events ?? 0}</strong>
          </article>
          <article className="stat">
            <span className="stat-label">当前目标高危</span>
            <strong>{highSeverityCount}</strong>
          </article>
          <article className="stat">
            <span className="stat-label">边界规则</span>
            <strong>{chips.length}</strong>
          </article>
        </div>
      </SectionCard>

      <div className="split-grid">
        <SectionCard title="当前测试范围" copy="这些范围来自任务创建时传入的约束条件。">
          <div className="boundary-chip-grid">
            {chips.length ? (
              chips.map((chip) => (
                <div key={`${chip.label}-${chip.value}`} className={`boundary-chip boundary-chip-${chip.tone}`}>
                  <span>{chip.label}</span>
                  <strong>{chip.value}</strong>
                </div>
              ))
            ) : (
              <div className="empty-state">
                {targetQuery.isLoading ? "正在读取目标边界..." : "当前目标没有额外范围约束，建议在首页启动任务前明确端口、主机或路径。"}
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="保护说明" copy="把约束系统翻译成普通用户能理解的安全感。">
          <div className="boundary-explain-list">
            <div className="boundary-explain-item">
              <strong>每轮检查都会重新确认范围</strong>
              <span>即使任务运行多轮，端口、主机、路径和禁止动作也会在执行前被代码校验。</span>
            </div>
            <div className="boundary-explain-item">
              <strong>越界尝试会被记录</strong>
              <span>被阻止的动作会进入审计记录，方便后续解释“为什么没有继续测试”。</span>
            </div>
            <div className="boundary-explain-item">
              <strong>深度验证需要更明确授权</strong>
              <span>当使用深度或持续检查模式时，建议至少指定主机、端口或路径边界。</span>
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="被阻止的越界尝试" copy="优先显示最近拦截原因，技术字段放在辅助信息里。">
        <div className="boundary-timeline">
          {targetEvents.length ? (
            targetEvents.map((event, index) => (
              <article key={`${event.timestamp}-${event.code}-${index}`} className={`boundary-event boundary-event-${eventTone(event)}`}>
                <div className="boundary-event-time">
                  <span>{formatTime(event.timestamp)}</span>
                </div>
                <div className="boundary-event-body">
                  <div className="boundary-event-head">
                    <strong>{event.summary || "已阻止一次越界动作"}</strong>
                    <span className={`severity-badge severity-${eventTone(event)}`}>{event.severity || "info"}</span>
                  </div>
                  <p>{event.detail || "该动作不符合当前授权范围，因此没有执行。"}</p>
                  <div className="boundary-event-meta">
                    <span>目标: {event.target || "unknown"}</span>
                    <span>动作: {event.action || "n/a"}</span>
                    <span>工具: {event.tool_name || "n/a"}</span>
                    <span>阶段: {event.phase || "n/a"}</span>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">暂未记录被阻止的越界尝试。</div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="技术审计"
        copy="保留原 Constraint Audit 的分组统计，方便高级用户排查规则来源。"
        aside={
          <button type="button" className="text-btn inline-text-btn" onClick={() => setShowTechnical((value) => !value)}>
            {showTechnical ? "收起" : "展开"}
          </button>
        }
      >
        {showTechnical ? (
          <div className="split-grid no-top-gap">
            <article className="inset-card compact-card">
              <h4>按来源</h4>
              <div className="list">
                {audit && Object.entries(audit.by_source).length ? (
                  Object.entries(audit.by_source).map(([key, value]) => (
                    <div key={key} className="list-item">
                      <strong>{key}</strong>
                      <span>{value}</span>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">暂无来源统计。</div>
                )}
              </div>
            </article>
            <article className="inset-card compact-card">
              <h4>按规则</h4>
              <div className="list">
                {audit && Object.entries(audit.by_code).length ? (
                  Object.entries(audit.by_code).map(([key, value]) => (
                    <div key={key} className="list-item">
                      <strong>{key}</strong>
                      <span>{value}</span>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">暂无规则统计。</div>
                )}
              </div>
            </article>
          </div>
        ) : (
          <div className="empty-state">技术审计已收起。</div>
        )}
      </SectionCard>
    </section>
  );
}
