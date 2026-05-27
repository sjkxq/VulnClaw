import { useMemo, useState } from "react";
import type { TaskCommand, TaskEvent, TaskOptions, TaskRecord, TaskSummary } from "../types/api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SectionCard } from "../components/SectionCard";
import { loadUiPreferences } from "../utils/preferences";

type CheckMode = "quick" | "standard" | "deep" | "continuous";

interface HomePageProps {
  selectedTarget: string | null;
  activeTask: TaskRecord | null;
  latestEvent: TaskEvent | null;
  onCreateTask: (command: TaskCommand, target: string, resume: boolean, options: TaskOptions) => Promise<TaskRecord>;
  onOpenRisk: () => void;
  onOpenReports: () => void;
  onOpenBoundary: () => void;
}

const MODES: Array<{
  key: CheckMode;
  title: string;
  copy: string;
  command: TaskCommand;
  allowActions?: string[];
  blockActions?: string[];
}> = [
  {
    key: "quick",
    title: "快速摸底",
    copy: "只做信息收集和基础风险识别，适合第一次了解目标。",
    command: "recon",
    allowActions: ["recon"],
    blockActions: ["exploit", "persistent"],
  },
  {
    key: "standard",
    title: "标准检查",
    copy: "信息收集 + 风险发现，默认推荐，不主动做高风险验证。",
    command: "run",
    allowActions: ["recon", "scan"],
    blockActions: ["post_exploitation"],
  },
  {
    key: "deep",
    title: "深度验证",
    copy: "可能包含验证动作，启动前会再次确认授权范围。",
    command: "scan",
    allowActions: ["recon", "scan", "exploit"],
  },
  {
    key: "continuous",
    title: "持续检查",
    copy: "多轮持续运行，适合靶场或长期观察，需要更明确的边界。",
    command: "persistent",
    allowActions: ["recon", "scan"],
    blockActions: ["post_exploitation"],
  },
];

function parseNumber(value: string): number | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function splitActions(value: string): string[] | undefined {
  const actions = value.split(",").map((item) => item.trim()).filter(Boolean);
  return actions.length ? actions : undefined;
}

function latestEventText(event: TaskEvent | null): string {
  if (!event) return "任务事件准备中，启动后会展示实时阶段。";
  const message = event.payload.message ?? event.payload.text ?? event.payload.phase;
  return typeof message === "string" && message.trim() ? message : event.event;
}

function currentPhaseKey(task: TaskRecord | null, event: TaskEvent | null): string {
  if (!task) return "scope";
  if (task.status === "completed" || task.status === "failed" || task.status === "stopped") return "report";
  const text = `${event?.payload.phase ?? ""} ${event?.event ?? ""} ${task.latest_phase ?? ""}`.toLowerCase();
  if (text.includes("report")) return "report";
  if (text.includes("exploit") || text.includes("verify")) return "verify";
  if (text.includes("scan")) return "scan";
  if (text.includes("recon")) return "recon";
  return task.status === "running" ? "recon" : "scope";
}

function taskResultTitle(task: TaskRecord): string {
  if (task.status === "completed") return "检查已完成，可以查看风险结果。";
  if (task.status === "failed") return "检查未完成，建议查看技术日志或重新启动。";
  if (task.status === "stopped") return "检查已停止，已保存的状态仍可查看。";
  return `正在检查 ${task.target}`;
}

function eventSummary(event: TaskEvent | null): TaskSummary | null {
  const summary = event?.payload.summary;
  return summary && typeof summary === "object" ? summary as TaskSummary : null;
}

function taskSummary(task: TaskRecord, event: TaskEvent | null): TaskSummary | null {
  return task.summary ?? eventSummary(event);
}

export function HomePage({ selectedTarget, activeTask, latestEvent, onCreateTask, onOpenRisk, onOpenReports, onOpenBoundary }: HomePageProps) {
  const [target, setTarget] = useState(selectedTarget ?? "https://example.com");
  const [mode, setMode] = useState<CheckMode>(() => loadUiPreferences().defaultCheckMode);
  const [onlyPort, setOnlyPort] = useState("");
  const [onlyHost, setOnlyHost] = useState("");
  const [onlyPath, setOnlyPath] = useState("");
  const [blockedHost, setBlockedHost] = useState("");
  const [blockedPath, setBlockedPath] = useState("");
  const [allowActions, setAllowActions] = useState("");
  const [blockActions, setBlockActions] = useState("");
  const [resume, setResume] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedMode = useMemo(() => MODES.find((item) => item.key === mode) ?? MODES[1], [mode]);
  const scopeCount = [onlyPort, onlyHost, onlyPath, blockedHost, blockedPath].filter((item) => item.trim()).length;
  const activeSummary = activeTask ? taskSummary(activeTask, latestEvent) : null;
  const boundaryBlockCount = activeSummary?.constraint_violation_events.length ?? activeSummary?.constraint_violations.length ?? 0;

  function buildOptions(): TaskOptions {
    return {
      only_port: parseNumber(onlyPort),
      only_host: onlyHost.trim() || undefined,
      only_path: onlyPath.trim() || undefined,
      blocked_host: blockedHost.trim() || undefined,
      blocked_path: blockedPath.trim() || undefined,
      allow_actions: splitActions(allowActions) ?? selectedMode.allowActions,
      block_actions: splitActions(blockActions) ?? selectedMode.blockActions,
    };
  }

  async function submit() {
    try {
      setSubmitting(true);
      setError(null);
      await onCreateTask(selectedMode.command, target.trim(), resume, buildOptions());
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动安全检查失败");
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }

  function handleStart() {
    if (mode === "deep" || mode === "continuous") {
      setConfirmOpen(true);
      return;
    }
    void submit();
  }

  return (
    <section className="home-page">
      <div className="home-hero">
        <div className="home-stack">
          <span className="pill">ToC Security Check</span>
          <h2>开始一次授权安全检查</h2>
          <p>
            输入你拥有授权的目标，确认测试范围，VulnClaw 会把检查过程限制在边界内，并生成可读报告。
          </p>

          <div className="hero-action-grid">
            <button
              type="button"
              className={`hero-orb ${submitting ? "hero-orb-busy" : ""}`}
              disabled={submitting || !target.trim()}
              onClick={handleStart}
            >
              <span>{submitting ? "启动中" : "开始"}</span>
              <strong>{selectedMode.title}</strong>
            </button>

            <SectionCard
              title="授权目标"
              copy="只填写你明确拥有测试授权的 URL、域名或 IP。"
              aside={<span className="status-badge">{scopeCount ? `${scopeCount} 条边界` : "默认边界"}</span>}
            >
              <label className="field">
                <span>目标</span>
                <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="https://target.example" />
              </label>
              <label className="check-row home-check">
                <input checked={resume} onChange={(event) => setResume(event.target.checked)} type="checkbox" />
                <span>沿用该目标的历史上下文，避免重复探索</span>
              </label>
            </SectionCard>
          </div>
        </div>
      </div>

      <div className="mode-grid">
        {MODES.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`mode-card ${mode === item.key ? "selected-item" : ""}`}
            onClick={() => setMode(item.key)}
          >
            <strong>{item.title}</strong>
            <span>{item.copy}</span>
          </button>
        ))}
      </div>

      {activeTask && (
        <SectionCard
          title="检查进度"
          copy="把实时事件整理成用户能理解的阶段，不默认展示终端流。"
          aside={<span className="status-badge">{activeTask.status}</span>}
        >
          <div className="check-progress-card">
            <div className="check-progress-head">
              <div>
                <span className="pill">当前任务</span>
                <h3>{taskResultTitle(activeTask)}</h3>
                <p>{latestEventText(latestEvent)}</p>
              </div>
              <div className="check-progress-target">
                <span>授权目标</span>
                <strong>{activeTask.target}</strong>
              </div>
            </div>
            <div className="check-stepper">
              {[
                ["scope", "确认授权范围"],
                ["recon", "收集公开信息"],
                ["scan", "识别服务和入口"],
                ["verify", "分析潜在风险"],
                ["report", "整理报告"],
              ].map(([key, label]) => {
                const activeKey = currentPhaseKey(activeTask, latestEvent);
                const keys = ["scope", "recon", "scan", "verify", "report"];
                const done = keys.indexOf(key) <= keys.indexOf(activeKey);
                return (
                  <div key={key} className={`check-step ${done ? "check-step-done" : ""}`}>
                    <span />
                    <strong>{label}</strong>
                  </div>
                );
              })}
            </div>
            <div className="next-actions">
              <button type="button" className="primary-btn" onClick={onOpenRisk}>
                查看风险结果
              </button>
              <button type="button" className="secondary-btn" onClick={onOpenReports}>
                查看报告
              </button>
              <button type="button" className="secondary-btn" onClick={onOpenBoundary}>
                查看安全边界
              </button>
            </div>
            {activeSummary && (
              <div className="stats-grid check-result-stats">
                <article className="stat">
                  <span className="stat-label">已验证风险</span>
                  <strong>{activeSummary.verified_count}</strong>
                </article>
                <article className="stat">
                  <span className="stat-label">待复核线索</span>
                  <strong>{activeSummary.pending_count}</strong>
                </article>
                <article className="stat">
                  <span className="stat-label">边界拦截</span>
                  <strong>{boundaryBlockCount}</strong>
                </article>
                <article className="stat">
                  <span className="stat-label">快照</span>
                  <strong>{activeSummary.snapshot_id || "已保存"}</strong>
                </article>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      <div className="split-grid">
        <SectionCard title="测试范围" copy="把端口、主机、路径等约束写清楚，任务每轮都会按这些边界执行。">
          <div className="form-grid">
            <label className="field">
              <span>仅测试端口</span>
              <input value={onlyPort} onChange={(event) => setOnlyPort(event.target.value)} inputMode="numeric" placeholder="例如 443" />
            </label>
            <label className="field">
              <span>仅测试主机</span>
              <input value={onlyHost} onChange={(event) => setOnlyHost(event.target.value)} placeholder="example.com" />
            </label>
            <label className="field field-wide">
              <span>仅测试路径</span>
              <input value={onlyPath} onChange={(event) => setOnlyPath(event.target.value)} placeholder="/admin" />
            </label>
            <label className="field">
              <span>排除主机</span>
              <input value={blockedHost} onChange={(event) => setBlockedHost(event.target.value)} placeholder="staging.example.com" />
            </label>
            <label className="field">
              <span>排除路径</span>
              <input value={blockedPath} onChange={(event) => setBlockedPath(event.target.value)} placeholder="/internal" />
            </label>
          </div>
          <button type="button" className="text-btn" onClick={() => setAdvancedOpen((value) => !value)}>
            {advancedOpen ? "收起高级动作边界" : "展开高级动作边界"}
          </button>
          {advancedOpen && (
            <div className="form-grid compact-form">
              <label className="field">
                <span>允许动作</span>
                <input value={allowActions} onChange={(event) => setAllowActions(event.target.value)} placeholder="recon,scan" />
              </label>
              <label className="field">
                <span>禁止动作</span>
                <input value={blockActions} onChange={(event) => setBlockActions(event.target.value)} placeholder="exploit,persistent" />
              </label>
            </div>
          )}
          {error && <div className="error-box">{error}</div>}
        </SectionCard>

        <SectionCard title="下一步" copy="检查完成后优先看风险结果和报告，高级细节仍然保留。">
          <div className="next-actions">
            <button type="button" className="secondary-btn" onClick={onOpenBoundary}>
              查看安全边界
            </button>
            <button type="button" className="secondary-btn" onClick={onOpenReports}>
              查看历史报告
            </button>
          </div>
          <div className="scope-summary">
            <strong>当前模式会执行</strong>
            <span>{selectedMode.command}</span>
            <strong>默认允许动作</strong>
            <span>{(selectedMode.allowActions ?? ["按后端默认"]).join(", ")}</span>
            <strong>默认禁止动作</strong>
            <span>{(selectedMode.blockActions ?? ["按后端默认"]).join(", ")}</span>
          </div>
        </SectionCard>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="确认授权范围"
        copy="该模式会进行更深入或更长时间的检查。请确认目标、端口、路径和禁止动作都符合你的授权范围。"
        confirmLabel="确认并开始"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void submit()}
      />
    </section>
  );
}
