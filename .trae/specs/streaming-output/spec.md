# VulnClaw 流式输出功能 - 产品需求文档 (PRD)

## Overview
- **Summary**: 为 VulnClaw CLI 模式添加 LLM 响应的流式输出能力，包括 chat()、auto_pentest()、persistent_pentest() 等所有 LLM 调用路径。目标是在用户发送请求后立即显示 "Thinking..." 状态提示，然后逐字 (character-by-character) 实时渲染 LLM 生成的文本内容，替代当前的"黑屏等待完整响应后一次性输出"模式。同时确保 Web UI 端不会因流式功能引入重复输出。
- **Purpose**: 解决当前 CLI 用户体验问题——发起 AI 请求后终端长时间无任何反馈（黑屏状态），用户无法判断系统是否正常工作或 LLM 是否正在生成响应。流式输出提供即时视觉反馈，显著提升交互流畅感和用户信任度。
- **Target Users**: VulnClaw CLI 用户（`vulnclaw` 命令、`vulnclaw repl`、各种子命令如 `run`/`recon`/`scan`/`exploit`/`persistent` 的运行时输出）、自动化渗透测试操作员、安全研究人员。

## Goals
- G1: 所有 CLI 模式的 LLM 输出支持字符级流式渲染（thinking 标签 + 正文）
- G2: 输入后立即显示 "Thinking..." 状态提示，消除"黑屏等待"感
- G3: 保留现有 `config.session.show_thinking` 开关对思考标签的显示/隐藏控制
- G4: Web UI 模式不受影响——不产生重复输出，不破坏现有 SSE 事件流
- G5: 当 LLM Provider 或模型不支持流式 API 时，自动降级为非流式模式，不中断用户体验
- G6: 保持 `call_llm()` / `call_llm_auto()` 返回值（完整字符串）不变，确保 agent 的上下文构建、漏洞解析等后续逻辑不受影响

## Non-Goals (Out of Scope)
- 不修改 Web UI 前端的渲染机制（Web 端已有 SSE 事件流，保持现状）
- 不改变 LLM 调用的 prompt 构建逻辑
- 不引入新的外部依赖
- 不重构 agent 状态管理或上下文存储
- 不改变现有的工具调用（function calling）流程
- 不改变报告生成逻辑
- 不添加任何可视化进度条或动画效果（超出字符级渲染范围）

## Background & Context

### 当前输出架构
系统有两条相对独立的输出路径：

1. **CLI 路径**：
   ```
   user_input → AgentCore.chat()/auto_pentest() → call_llm()/call_llm_auto()
                → 返回完整 response_text → _print_agent_output() → console.print()
   ```
   特点：同步等待完整响应后一次性打印。

2. **Web UI 路径**：
   ```
   user_input → WebTaskManager.start_task() → run_agent_task() → AgentCore.*()
                → task_manager.publish() → SSE events → 前端消费并渲染
   ```
   特点：已有事件机制，但事件以"轮次完成"为粒度，非 token 级。

### 关键文件
- [llm_client.py](file:///workspace/vulnclaw/agent/llm_client.py#L169-L290): LLM 调用核心（`call_llm`, `call_llm_auto`），当前使用 `client.chat.completions.create()` 无 `stream=True`
- [core.py](file:///workspace/vulnclaw/agent/core.py#L259-L345): Agent 核心方法（`chat()`, `auto_pentest()`, `persistent_pentest()`）
- [loop_controller.py](file:///workspace/vulnclaw/agent/loop_controller.py#L18-L294): 循环控制器，调用 `call_llm_auto`
- [cli/main.py](file:///workspace/vulnclaw/cli/main.py#L103-L117): CLI 输出渲染函数 `_print_agent_output()`
- [web/task_manager.py](file:///workspace/vulnclaw/web/task_manager.py#L16-L176): Web 端任务和事件管理

### 技术约束
- 使用 `openai` Python SDK 的 `stream=True` 模式
- 需要保持 `call_llm()` 函数签名和返回类型不变（`async def call_llm(...) -> str`）
- Web 端已有事件系统，但未集成流式输出——需要避免在 Web 运行路径中触发 CLI 端的流式打印

## Functional Requirements

### FR-1: 流式 LLM 调用函数
- 在 `llm_client.py` 中新增 `call_llm_stream()` 异步函数，接受与 `call_llm()` 相同的参数，外加可选的流式回调参数
- 该函数在 LLM 请求发送前立即触发 "Thinking..." 状态提示（仅 CLI 路径）
- 使用 `openai` SDK 的 `stream=True` 模式获取数据流
- 逐 delta 累积文本并**同时**：
  - 将新生成的文本片段传递给输出回调（用于实时渲染）
  - 在内部累积完整文本
- 对于带 reasoning_content 的模型（DeepSeek R1 等），分开处理 thinking 块和正文块
- 最终返回完整的响应字符串，与 `call_llm()` 的返回值一致

### FR-2: 流式 auto_pentest 调用函数
- 新增 `call_llm_auto_stream()`，支持工具调用（tool_calls）流式处理
- 当 LLM 生成 tool_calls 块时，收集完整的 tool_calls 后执行工具，工具结果以非流式显示（"[工具调用: xxx]"）
- 当 LLM 生成纯文本内容时，以字符级流式输出
- 工具执行后的后续 LLM 调用（如需总结）同样支持流式

### FR-3: CLI 流式渲染器
- 新增 `StreamRenderer` 类或等价机制，负责终端流式输出
- 支持 "Thinking..." 状态提示（在首个 LLM token 到达前显示）
- 支持 thinking 标签识别：当检测到 `<thinking>` 标签块时，根据 `config.session.show_thinking` 决定是否渲染
- 支持普通正文的字符级渲染
- 使用 `rich.console.Console.print()` 或等价 API（不带额外换行）输出增量文本
- 必须是**线程安全**的——避免多输出路径交错

### FR-4: 输出路径隔离（防止 Web 端重复输出）
- **核心机制**: 使用 "output sink" / "输出目标" 抽象
- Agent 的 LLM 调用层不直接 `print()` 或 `console.print()`
- 调用方（CLI 或 Web TaskManager）在调用 agent 方法时，明确指定输出应该流向哪里：
  - CLI 路径：传入 `cli_stream_renderer` 回调 → 流式渲染到终端
  - Web 路径：传入 `event_sink` 回调 → 发布 SSE 事件（保持现有逐轮输出，不做 token 级流）
  - 静默路径：不传入回调 → 仅返回文本，不产生任何输出（用于 `persistent_pentest` 中的报告生成等内部调用）
- 默认**不输出**，由调用方显式指定，从根本上避免"两边同时打印"

### FR-5: 自动降级机制
- 当 LLM Provider 返回非流式响应（或抛出不支持流式的错误）时，自动切换到非流式调用
- 降级对用户透明，仅在日志或调试输出中体现
- 降级判定条件：
  - `stream=True` 调用抛出 `NotImplementedError` 或 `ValueError`
  - 响应中没有 `choices[0].delta` 字段
  - Provider 返回明确的 "streaming not supported" 消息

### FR-6: CLI 输出渲染适配
- 修改 `_print_agent_output()` 函数，当接收到的是流式场景的完整响应时，不再重复打印（已在流式过程中输出）
- 在 chat 模式、auto_pentest 模式、persistent_pentest 模式中，统一使用流式渲染器输出
- 保留对已有输出格式（思考标签显示/隐藏、Rich 转义等）的支持

## Non-Functional Requirements
- **NFR-1 (性能)**: 流式渲染不应引入超过 5% 的端到端延迟增量
- **NFR-2 (可靠性)**: 流式中断后的完整文本收集必须完整——即使网络中断或用户 Ctrl+C，已收集的文本也应作为返回值
- **NFR-3 (向后兼容)**: `call_llm()` 和 `call_llm_auto()` 的调用签名（参数和返回值）保持兼容，所有现有调用点无需修改即可工作
- **NFR-4 (代码一致性)**: 遵循项目现有代码风格——使用 `from __future__ import annotations`、`Any` 类型注解、`asyncio` 模式
- **NFR-5 (测试可支持)**: 流式渲染逻辑应可通过依赖注入或 mock 回调进行单元测试

## Constraints
- **Technical**: Python 3.9+, `openai` SDK, `rich` 控制台库, asyncio
- **Technical**: 必须与当前的 OpenAI 兼容 API（OpenAI、DeepSeek、自定义端点等）保持兼容
- **Technical**: 不能修改 `vulnclaw/config/` 中的现有配置 schema（除非必要，此处不认为必要）
- **Business**: 单一开发周期内完成
- **Dependencies**: 依赖现有 `openai` SDK（已存在），不新增依赖

## Assumptions
- A1: `openai.chat.completions.create(stream=True)` 在大多数主流 OpenAI 兼容 Provider 上可用
- A2: 当流式不可用时，Provider 会抛出明确的异常或返回非流式响应格式（我们据此触发降级）
- A3: 用户的终端环境基本支持 UTF-8 和 ANSI 转义序列（项目已有 Windows 控制台适配，可复用）
- A4: Web UI 前端已有消费 SSE 事件的逻辑，不需要改造——我们只需避免在 Web 路径中触发 CLI 输出

## Acceptance Criteria

### AC-1: Chat 模式流式输出
- **Given**: 用户在 CLI REPL 中输入一条查询（单轮对话模式）
- **When**: Agent 调用 LLM 并开始生成响应
- **Then**:
  1. 终端立即显示 "Thinking..." 或类似提示（在 LLM 返回首个 token 前）
  2. LLM 生成的文本逐字/逐块追加到终端，无需等待完整响应
  3. 响应完成后光标位置正确（末尾有换行）
  4. `agent.context.messages` 中正确存储了完整响应文本
- **Verification**: `programmatic`（通过 mock LLM stream 验证输出序列）+ `human-judgment`（实际运行体验）
- **Notes**: thinking 标签块的显示遵循 `config.session.show_thinking` 配置

### AC-2: Auto Pentest 模式流式输出
- **Given**: 用户在 CLI 中输入触发自动渗透测试的指令（含目标）
- **When**: Agent 进入 `auto_pentest()` 循环
- **Then**:
  1. 每一轮（Round）的 LLM 生成阶段均为流式输出
  2. 当 LLM 发起工具调用时，显示类似 "[工具调用: nmap(target=...)]" 的提示，随后显示工具结果
  3. 工具执行后的 LLM 总结/分析阶段恢复流式输出
  4. 各轮之间显示清晰分隔符（如 `-- Round N --`）
- **Verification**: `programmatic` + `human-judgment`

### AC-3: Persistent Pentest 模式流式输出
- **Given**: 用户运行 `persistent` 命令或 REPL 中的 persistent 模式
- **When**: Agent 执行多周期渗透测试
- **Then**: 与 AC-2 相同，流式输出在每个周期的每一轮中生效。周期结束时的总结（`_generate_attack_summary`）也使用流式输出。
- **Verification**: `programmatic` + `human-judgment`

### AC-4: thinking 标签显示控制
- **Given**: `config.session.show_thinking` 为 `False`
- **When**: LLM 响应包含 thinking 内容（无论是 reasoning_content 字段还是内联 `<thinking>` 标签）
- **Then**: thinking 内容不在终端显示，仅显示最终正文内容，但返回给 agent 的完整文本仍包含 thinking 标签（供后续上下文使用）
- **Verification**: `programmatic`

### AC-5: thinking 标签显示开启
- **Given**: `config.session.show_thinking` 为 `True`
- **When**: LLM 响应包含 thinking 内容
- **Then**: thinking 内容以某种区分样式（如 dim/italic 颜色）流式显示，随后正文以普通样式流式显示
- **Verification**: `programmatic` + `human-judgment`

### AC-6: Web UI 路径不产生终端输出
- **Given**: 通过 Web UI 发起任务（POST `/api/tasks/run`）
- **When**: Agent 在服务端执行 LLM 调用和任务逻辑
- **Then**: 服务端进程的 stdout/stderr **不输出**任何流式文本到终端（避免污染服务器日志和产生重复输出）。所有输出仅通过 `WebTaskManager.publish()` → SSE 事件传递到前端。
- **Verification**: `programmatic`（检查 WebTaskManager 调用路径中 sink 的类型）

### AC-7: CLI 路径正常输出
- **Given**: 用户通过 CLI/REPL 直接调用
- **When**: Agent 执行 LLM 调用
- **Then**: 流式文本实时输出到终端
- **Verification**: `programmatic`（检查 CLI 调用路径中 sink 的类型）

### AC-8: 自动降级到非流式
- **Given**: LLM Provider 不支持 `stream=True`
- **When**: 调用 `call_llm_stream()`
- **Then**: 函数捕获异常/检测不支持，切换到非流式调用。用户看到完整文本一次性输出（与当前行为一致），不会看到错误。返回值与流式路径相同（完整字符串）。
- **Verification**: `programmatic`（mock 一个抛出 streaming-not-supported 异常的 client）

### AC-9: 返回值完整性
- **Given**: 任何流式输出场景
- **When**: LLM 调用完成
- **Then**: `call_llm_stream()`/`call_llm_auto_stream()` 返回完整的响应字符串（包括 thinking 标签，如果有的话）。该字符串与非流式返回的字符串等价。
- **Verification**: `programmatic`（断言返回值 == mock 的完整文本）

### AC-10: 不引入新依赖
- **Given**: 项目当前依赖集（`openai`, `rich`, `typer`, `pydantic`, `fastapi` 等）
- **When**: 实现完成
- **Then**: `requirements.txt` / `pyproject.toml` 中不添加新的第三方依赖
- **Verification**: `programmatic`（diff 检查）

### AC-11: Ctrl+C 中断行为
- **Given**: 用户在 LLM 流式生成过程中按下 Ctrl+C
- **When**: 中断传播到 `call_llm_stream()`
- **Then**: 函数优雅终止，将已收集的部分文本返回（或返回空字符串，取决于调用方处理），不留下未刷新的终端缓冲区。CLI 层的 `except KeyboardInterrupt` 继续按现有逻辑处理。
- **Verification**: `programmatic`（在 mock stream 中注入 CancelledError）

### AC-12: 错误重试兼容性
- **Given**: LLM 调用需要重试（网络超时、临时 API 错误等）
- **When**: `_call_with_persistent_retries` 内的重试逻辑触发
- **Then**: 重试逻辑与流式兼容——重试时重新显示 "Thinking..."，成功后正常流式输出。
- **Verification**: `programmatic`

## Open Questions
- [x] Q1: Web 端的 token 级流式是否需要？→ 当前不做，保持现状（逐轮事件）
- [x] Q2: persistent_pentest 中的 `_generate_attack_summary()` 调用（非交互式 LLM 总结）是否需要流式？→ 是，遵循统一的 sink 机制
- [x] Q3: 是否需要为 streaming 行为添加配置开关？→ 不需要，默认开启，降级自动处理
- [ ] Q4: "Thinking..." 的视觉样式应该是什么？简单文本前缀还是 Rich 样式（Spinner/Live）？→ 暂定为简单文本前缀，保持简单
