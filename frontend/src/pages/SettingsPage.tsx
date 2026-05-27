import { useEffect, useMemo, useState } from "react";
import { updateConfig } from "../api/web";
import { SectionCard } from "../components/SectionCard";
import { useConfigQuery, useMcpDiagnosticsQuery } from "../hooks/queries";
import { loadUiPreferences, saveUiPreferences, type UiPreferences } from "../utils/preferences";

type SettingsSection = "basic" | "ai" | "checks" | "data" | "python" | "diagnostics";

const SECTIONS: Array<{ key: SettingsSection; title: string; copy: string }> = [
  { key: "basic", title: "基础设置", copy: "语言、体验和常用偏好" },
  { key: "ai", title: "AI 模型", copy: "Provider、Model、Base URL" },
  { key: "checks", title: "检查策略", copy: "轮次和持续检查参数" },
  { key: "data", title: "报告与数据", copy: "输出目录和交付物位置" },
  { key: "python", title: "Python 安全", copy: "本地执行能力和审计" },
  { key: "diagnostics", title: "高级诊断", copy: "MCP 工具链状态" },
];

export function SettingsPage() {
  const configQuery = useConfigQuery();
  const mcpQuery = useMcpDiagnosticsQuery();
  const [activeSection, setActiveSection] = useState<SettingsSection>("basic");
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [maxRounds, setMaxRounds] = useState(15);
  const [persistentRounds, setPersistentRounds] = useState(100);
  const [persistentCycles, setPersistentCycles] = useState(10);
  const [showThinking, setShowThinking] = useState(false);
  const [pythonExecuteEnabled, setPythonExecuteEnabled] = useState(true);
  const [pythonExecuteMode, setPythonExecuteMode] = useState("trusted-local");
  const [pythonExecuteMaxLines, setPythonExecuteMaxLines] = useState(50);
  const [pythonExecuteAuditEnabled, setPythonExecuteAuditEnabled] = useState(true);
  const [language, setLanguage] = useState<UiPreferences["language"]>("zh-CN");
  const [defaultCheckMode, setDefaultCheckMode] = useState<UiPreferences["defaultCheckMode"]>("standard");
  const [reportFormat, setReportFormat] = useState<UiPreferences["reportFormat"]>("markdown");
  const [showTechnicalLogs, setShowTechnicalLogs] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const preferences = loadUiPreferences();
    setLanguage(preferences.language);
    setDefaultCheckMode(preferences.defaultCheckMode);
    setReportFormat(preferences.reportFormat);
    setShowTechnicalLogs(preferences.showTechnicalLogs);
  }, []);

  useEffect(() => {
    if (!configQuery.data) return;
    setProvider(configQuery.data.provider);
    setModel(configQuery.data.model);
    setBaseUrl(configQuery.data.base_url);
    setOutputDir(configQuery.data.output_dir);
    setMaxRounds(configQuery.data.max_rounds);
    setPersistentRounds(configQuery.data.persistent_rounds_per_cycle);
    setPersistentCycles(configQuery.data.persistent_max_cycles);
    setShowThinking(configQuery.data.show_thinking);
    setPythonExecuteEnabled(configQuery.data.python_execute_enabled);
    setPythonExecuteMode(configQuery.data.python_execute_mode);
    setPythonExecuteMaxLines(configQuery.data.python_execute_max_lines);
    setPythonExecuteAuditEnabled(configQuery.data.python_execute_audit_enabled);
  }, [configQuery.data]);

  const activeMeta = useMemo(() => SECTIONS.find((section) => section.key === activeSection) ?? SECTIONS[0], [activeSection]);

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);
      setStatus(null);
      await updateConfig({
        provider,
        model,
        base_url: baseUrl,
        output_dir: outputDir,
        max_rounds: maxRounds,
        persistent_rounds_per_cycle: persistentRounds,
        persistent_max_cycles: persistentCycles,
        show_thinking: showThinking,
        python_execute_enabled: pythonExecuteEnabled,
        python_execute_mode: pythonExecuteMode,
        python_execute_max_lines: pythonExecuteMaxLines,
        python_execute_audit_enabled: pythonExecuteAuditEnabled,
      });
      saveUiPreferences({
        language,
        defaultCheckMode,
        reportFormat,
        showTechnicalLogs,
      });
      await configQuery.refetch();
      setStatus("设置已保存");
    } catch (err) {
      setError(err instanceof Error ? err.message : "设置保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-page">
      <aside className="settings-nav">
        {SECTIONS.map((section) => (
          <button
            key={section.key}
            type="button"
            className={`settings-nav-item ${activeSection === section.key ? "active" : ""}`}
            onClick={() => setActiveSection(section.key)}
          >
            <strong>{section.title}</strong>
            <span>{section.copy}</span>
          </button>
        ))}
      </aside>

      <div className="settings-content">
        <SectionCard
          title={activeMeta.title}
          copy={activeMeta.copy}
          aside={<span className="status-badge">{configQuery.data?.api_key_configured ? "API Key 已配置" : "未配置 API Key"}</span>}
        >
          {activeSection === "basic" && (
            <div className="form-grid">
              <label className="field">
                <span>界面语言</span>
                <select value={language} onChange={(event) => setLanguage(event.target.value as UiPreferences["language"])}>
                  <option value="zh-CN">简体中文</option>
                  <option value="en-US">English</option>
                </select>
              </label>
              <label className="field">
                <span>默认检查模式</span>
                <select value={defaultCheckMode} onChange={(event) => setDefaultCheckMode(event.target.value as UiPreferences["defaultCheckMode"])}>
                  <option value="quick">快速摸底</option>
                  <option value="standard">标准检查</option>
                  <option value="deep">深度验证</option>
                  <option value="continuous">持续检查</option>
                </select>
              </label>
              <label className="field">
                <span>默认报告格式</span>
                <select value={reportFormat} onChange={(event) => setReportFormat(event.target.value as UiPreferences["reportFormat"])}>
                  <option value="markdown">Markdown</option>
                  <option value="html">HTML</option>
                </select>
              </label>
              <label className="check-row">
                <input checked={showThinking} onChange={(event) => setShowThinking(event.target.checked)} type="checkbox" />
                <span>显示 AI 思考输出</span>
              </label>
              <label className="check-row">
                <input checked={showTechnicalLogs} onChange={(event) => setShowTechnicalLogs(event.target.checked)} type="checkbox" />
                <span>默认显示技术日志入口</span>
              </label>
              <div className="inline-panel field-wide">
                <strong>说明</strong>
                <p className="inline-note">
                  这些 ToC 界面偏好保存在当前浏览器本地；AI、轮次、Python 执行等运行配置仍保存到 VulnClaw 后端配置。
                </p>
              </div>
            </div>
          )}

          {activeSection === "ai" && (
            <div className="form-grid">
              <label className="field">
                <span>Provider</span>
                <input value={provider} onChange={(event) => setProvider(event.target.value)} />
              </label>
              <label className="field">
                <span>Model</span>
                <input value={model} onChange={(event) => setModel(event.target.value)} />
              </label>
              <label className="field field-wide">
                <span>Base URL</span>
                <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
              </label>
            </div>
          )}

          {activeSection === "checks" && (
            <div className="form-grid">
              <label className="field">
                <span>最大轮次</span>
                <input type="number" value={maxRounds} onChange={(event) => setMaxRounds(Number(event.target.value))} />
              </label>
              <label className="field">
                <span>持续检查每周期轮次</span>
                <input type="number" value={persistentRounds} onChange={(event) => setPersistentRounds(Number(event.target.value))} />
              </label>
              <label className="field">
                <span>持续检查最大周期</span>
                <input type="number" value={persistentCycles} onChange={(event) => setPersistentCycles(Number(event.target.value))} />
              </label>
            </div>
          )}

          {activeSection === "data" && (
            <div className="form-grid">
              <label className="field field-wide">
                <span>输出目录</span>
                <input value={outputDir} onChange={(event) => setOutputDir(event.target.value)} />
              </label>
              <div className="inline-panel field-wide">
                <strong>报告默认位置</strong>
                <p className="inline-note">未显式指定时，报告由后端保存到 VulnClaw 用户配置目录的 sessions/report 文件中。</p>
              </div>
            </div>
          )}

          {activeSection === "python" && (
            <div className="form-grid">
              <label className="check-row">
                <input checked={pythonExecuteEnabled} onChange={(event) => setPythonExecuteEnabled(event.target.checked)} type="checkbox" />
                <span>启用 python_execute</span>
              </label>
              <label className="check-row">
                <input checked={pythonExecuteAuditEnabled} onChange={(event) => setPythonExecuteAuditEnabled(event.target.checked)} type="checkbox" />
                <span>写入 python_execute 审计日志</span>
              </label>
              <label className="field">
                <span>执行模式</span>
                <select value={pythonExecuteMode} onChange={(event) => setPythonExecuteMode(event.target.value)}>
                  <option value="safe">safe</option>
                  <option value="lab">lab</option>
                  <option value="trusted-local">trusted-local</option>
                </select>
              </label>
              <label className="field">
                <span>最大输出行数</span>
                <input type="number" value={pythonExecuteMaxLines} onChange={(event) => setPythonExecuteMaxLines(Number(event.target.value))} />
              </label>
              <div className="inline-panel field-wide">
                <strong>安全说明</strong>
                <p className="inline-note">
                  <code>safe</code> 阻止文件 I/O、网络访问和本地系统调用；<code>lab</code> 适合受控靶场；
                  <code>trusted-local</code> 保留本地能力，只建议在明确授权环境使用。
                </p>
              </div>
            </div>
          )}

          {activeSection === "diagnostics" && (
            <div className="diagnostics-grid">
              <article className="stat">
                <span className="stat-label">MCP 服务</span>
                <strong>{mcpQuery.data?.total_services ?? 0}</strong>
              </article>
              <article className="stat">
                <span className="stat-label">运行中</span>
                <strong>{mcpQuery.data?.running_services ?? 0}</strong>
              </article>
              <article className="stat">
                <span className="stat-label">工具数</span>
                <strong>{mcpQuery.data?.tool_count ?? 0}</strong>
              </article>
              <div className="list list-scroll diagnostics-list">
                {mcpQuery.data?.services.map((service) => (
                  <div key={service.name} className="list-item">
                    <strong>{service.name}</strong>
                    <span>health={service.health_status} · mode={service.execution_mode} · tools={service.tool_count}</span>
                    <span className="muted-inline">
                      calls={service.call_count} success={service.success_count} failure={service.failure_count}
                    </span>
                    {service.error && <span className="danger-inline">{service.error}</span>}
                  </div>
                ))}
                {!mcpQuery.data?.services.length && <div className="empty-state">暂无 MCP 诊断数据。</div>}
              </div>
            </div>
          )}

          <div className="button-row">
            <button className="primary-btn" disabled={saving || activeSection === "diagnostics"} onClick={handleSave} type="button">
              {saving ? "保存中..." : "保存设置"}
            </button>
          </div>

          {status && <div className="success-box">{status}</div>}
          {error && <div className="error-box">{error}</div>}
        </SectionCard>
      </div>
    </section>
  );
}
