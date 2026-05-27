import { useMemo, useState } from "react";
import { createTask, stopTask } from "../api/web";
import { useTasksQuery } from "../hooks/queries";
import type { TaskCommand, TaskEvent, TaskRecord } from "../types/api";

interface TaskConsolePageProps {
  activeTask: TaskRecord | null;
  events: TaskEvent[];
  onTaskCreated: (task: TaskRecord) => void;
  onEvent: (event: TaskEvent) => void;
  onFocusTarget: (target: string) => void;
}

export function TaskConsolePage({
  activeTask,
  events,
  onTaskCreated,
  onEvent,
  onFocusTarget,
}: TaskConsolePageProps) {
  const tasksQuery = useTasksQuery();
  const [command, setCommand] = useState<TaskCommand>("persistent");
  const [target, setTarget] = useState("https://example.com");
  const [resume, setResume] = useState(true);
  const [maxRounds, setMaxRounds] = useState<number | "">("");
  const [roundsPerCycle, setRoundsPerCycle] = useState<number | "">("");
  const [maxCycles, setMaxCycles] = useState<number | "">("");
  const [cve, setCve] = useState("");
  const [cmd, setCmd] = useState("");
  const [onlyPort, setOnlyPort] = useState<number | "">("");
  const [onlyHost, setOnlyHost] = useState("");
  const [onlyPath, setOnlyPath] = useState("");
  const [blockedHost, setBlockedHost] = useState("");
  const [blockedPath, setBlockedPath] = useState("");
  const [allowActions, setAllowActions] = useState("");
  const [blockActions, setBlockActions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latestEvents = useMemo(() => events.slice(-24).reverse(), [events]);

  function renderEventText(item: TaskEvent): string {
    const payload = item.payload;
    const cycle = typeof payload.cycle === "number" ? `cycle=${payload.cycle} ` : "";
    const round = typeof payload.round === "number" ? `round=${payload.round} ` : "";
    const phase = typeof payload.phase === "string" ? `phase=${payload.phase} ` : "";
    const text = typeof payload.text === "string" ? payload.text : "";
    const message = typeof payload.message === "string" ? payload.message : "";
    const summary = text || message || JSON.stringify(payload);
    return `${cycle}${round}${phase}${summary}`.trim();
  }

  function eventTone(eventName: string): "ok" | "warn" | "danger" | "info" {
    if (eventName.includes("completed")) return "ok";
    if (eventName.includes("failed")) return "danger";
    if (eventName.includes("stopped")) return "warn";
    if (eventName.includes("state") || eventName.includes("started")) return "info";
    return "info";
  }

  async function handleRun() {
    try {
      setSubmitting(true);
      setError(null);
      const task = await createTask(command, target, resume, {
        max_rounds: maxRounds === "" ? undefined : maxRounds,
        rounds_per_cycle: roundsPerCycle === "" ? undefined : roundsPerCycle,
        max_cycles: maxCycles === "" ? undefined : maxCycles,
        cve: cve.trim() || undefined,
        cmd: cmd.trim() || undefined,
        only_port: onlyPort === "" ? undefined : onlyPort,
        only_host: onlyHost.trim() || undefined,
        only_path: onlyPath.trim() || undefined,
        blocked_host: blockedHost.trim() || undefined,
        blocked_path: blockedPath.trim() || undefined,
        allow_actions: allowActions.trim() ? allowActions.split(",").map((item) => item.trim()).filter(Boolean) : undefined,
        block_actions: blockActions.trim() ? blockActions.split(",").map((item) => item.trim()).filter(Boolean) : undefined,
      });
      onTaskCreated(task);
      onFocusTarget(task.target);
      await tasksQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建任务失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStop() {
    if (!activeTask) return;
    try {
      await stopTask(activeTask.task_id);
      await tasksQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "停止任务失败");
    }
  }

  return (
    <section className="card">
      <header className="card-header">
        <div>
          <h3>高级任务控制台</h3>
          <p>保留原始命令、SSE 事件和调试参数，建议高级用户在排查问题时使用。</p>
        </div>
        <span className="status-badge">{activeTask?.status ?? "idle"}</span>
      </header>

      <div className="form-grid">
        <label className="field">
          <span>原始命令</span>
          <select value={command} onChange={(event) => setCommand(event.target.value as TaskCommand)}>
            <option value="run">run</option>
            <option value="recon">recon</option>
            <option value="scan">scan</option>
            <option value="exploit">exploit</option>
            <option value="persistent">persistent</option>
          </select>
        </label>

        <label className="field field-wide">
          <span>目标</span>
          <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="https://target.example" />
        </label>

        <label className="check-row">
          <input checked={resume} onChange={(event) => setResume(event.target.checked)} type="checkbox" />
          <span>沿用目标历史上下文</span>
        </label>
        <label className="field">
          <span>最大轮次</span>
          <input
            type="number"
            value={maxRounds}
            onChange={(event) => setMaxRounds(event.target.value ? Number(event.target.value) : "")}
            placeholder="使用后端默认值"
          />
        </label>
        <label className="field">
          <span>每周期轮次</span>
          <input
            type="number"
            value={roundsPerCycle}
            onChange={(event) => setRoundsPerCycle(event.target.value ? Number(event.target.value) : "")}
            placeholder="仅持续检查"
          />
        </label>
        <label className="field">
          <span>最大周期</span>
          <input
            type="number"
            value={maxCycles}
            onChange={(event) => setMaxCycles(event.target.value ? Number(event.target.value) : "")}
            placeholder="仅持续检查"
          />
        </label>
        <label className="field">
          <span>CVE 提示</span>
          <input value={cve} onChange={(event) => setCve(event.target.value)} placeholder="exploit only" />
        </label>
        <label className="field">
          <span>仅测试端口</span>
          <input
            type="number"
            value={onlyPort}
            onChange={(event) => setOnlyPort(event.target.value ? Number(event.target.value) : "")}
            placeholder="e.g. 443"
          />
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
        <label className="field">
          <span>允许动作</span>
          <input value={allowActions} onChange={(event) => setAllowActions(event.target.value)} placeholder="recon,scan" />
        </label>
        <label className="field">
          <span>禁止动作</span>
          <input value={blockActions} onChange={(event) => setBlockActions(event.target.value)} placeholder="exploit,persistent" />
        </label>
        <label className="field field-wide">
          <span>命令提示</span>
          <input value={cmd} onChange={(event) => setCmd(event.target.value)} placeholder="验证命令，例如 id" />
        </label>
      </div>

      <div className="button-row">
        <button className="primary-btn" disabled={submitting || !target.trim()} onClick={handleRun} type="button">
          {submitting ? "启动中..." : "启动原始任务"}
        </button>
        <button className="secondary-btn" disabled={!activeTask || activeTask.status !== "running"} onClick={handleStop} type="button">
          停止任务
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="split-grid inner-grid">
        <article className="card inset-card">
          <h4>任务记录</h4>
          <div className="list list-scroll">
            {tasksQuery.data?.slice(0, 8).map((task) => (
              <button
                key={task.task_id}
                type="button"
                className={`list-item list-button ${activeTask?.task_id === task.task_id ? "selected-item" : ""}`}
                onClick={() => {
                  onTaskCreated(task);
                  onFocusTarget(task.target);
                }}
              >
                <strong>{task.command} · {task.target}</strong>
                <span>{task.status}</span>
                <span className="muted-inline">{task.latest_phase ?? task.created_at}</span>
                {task.summary?.constraints && Object.keys(task.summary.constraints).length > 0 && (
                  <span className="muted-inline">constraints={JSON.stringify(task.summary.constraints)}</span>
                )}
              </button>
            ))}
            {!tasksQuery.data?.length && <div className="empty-state">暂无任务记录。</div>}
          </div>
        </article>

        <article className="card inset-card">
          <h4>实时事件流</h4>
          <div className="terminal terminal-scroll">
            {activeTask ? (
              <>
                <div className="terminal-line">[task] {activeTask.task_id}</div>
                <div className="terminal-line">[command] {activeTask.command}</div>
                <div className="terminal-line">[target] {activeTask.target}</div>
                <div className="terminal-line dim">[phase] {activeTask.latest_phase ?? "unknown"}</div>
                {activeTask.summary?.constraints && Object.keys(activeTask.summary.constraints).length > 0 && (
                  <div className="terminal-line dim">[constraints] {JSON.stringify(activeTask.summary.constraints)}</div>
                )}
              </>
            ) : (
              <div className="terminal-line dim">暂无运行中的任务。</div>
            )}

            {latestEvents.map((item) => (
              <div key={`${item.timestamp}-${item.event}`} className="terminal-line terminal-row">
                <span className={`terminal-event tone-${eventTone(item.event)}`}>[{item.event}]</span>
                <span className="terminal-time">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
                <span>{renderEventText(item)}</span>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
