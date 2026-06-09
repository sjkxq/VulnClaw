# VulnClaw 流式输出功能实施计划

**目标**：为 VulnClaw 添加真正的 LLM 流式输出（streaming）支持，让用户在 CLI 和 Web UI 中看到 token-by-token 的实时响应，而非等待完整响应生成后一次性输出。

---

## 一、现状分析

### 1.1 当前输出机制

| 层 | 实现方式 | 问题 |
|----|---------|------|
| **LLM 客户端** (`llm_client.py`) | 同步调用 `client.chat.completions.create()`，等待完整响应 | 阻塞式，无流式能力 |
| **Agent 核心** (`core.py`, `loop_controller.py`) | 每轮（round）生成完整文本后通过 `on_step` callback 输出 | 轮-轮粒度，无 token 级流式 |
| **CLI 输出** (`cli/main.py`) | Rich 控制台 `console.print()` 一次性输出 | 用户等待时间长，无实时感 |
| **Web 后端** (`web/`) | SSE 事件 `round_output` 推送完整文本 | 事件粒度太粗，非真流式 |
| **前端** (`frontend/src/pages/TaskConsolePage.tsx`) | 渲染 `round_output` 事件的 `text` 字段 | 无逐字追加效果 |

### 1.2 当前调用链

```
CLI / Web Task
  └─> AgentCore.chat() 或 auto_pentest()
        └─> call_llm() / call_llm_auto()  (阻塞等待完整响应)
              └─> 完整文本返回 → on_step callback → print / publish round_output
```

### 1.3 需要支持流式的路径

1. **CLI REPL 模式**：`vulnclaw` 进入交互模式后的 chat / auto_pentest
2. **CLI 子命令**：`vulnclaw run/recon/scan/exploit/persistent <target>`
3. **Web UI**：`/api/tasks/{task_id}/stream` 的 SSE 流

---

## 二、架构设计

### 2.1 核心变更点

```
新增流式调用层 llm_client.py
  ├─> call_llm_streaming()     [异步生成器，yield (delta_text, full_text, is_finished)]
  └─> call_llm_auto_streaming()  [自主循环模式的流式版本]

Agent 核心扩展 core.py / loop_controller.py
  ├─> chat_streaming()          [流式单轮对话]
  └─> auto_pentest_streaming()  [流式自主渗透]

CLI 输出增强 cli/main.py
  ├─> REPL 内的流式打印
  └─> 子命令的流式打印

Web 事件细粒度化 web/
  ├─> 新增 llm_chunk 事件
  └─> round_output 保留为"轮完成"标记
```

### 2.2 流式回调设计

使用 **两阶段输出**：
- **Phase A - LLM 生成中**：逐 token 的 `llm_chunk` 事件/回调，用户看到打字机效果
- **Phase B - 工具执行**：工具调用结果（tool result），类似当前的 `round_output`

```
[llm_chunk: "正在分析目标端口 8080..."]  ← 流式
[llm_chunk: "发现 Tomcat 管理器暴露..."] ← 流式
[tool_call: execute_nmap(...)]             ← 完整
[tool_result: "开放端口: 22, 80, 8080..."] ← 完整
[llm_chunk: "根据扫描结果..."]              ← 流式
[round_output: "本轮总结..."]               ← 完整（可选保留）
```

### 2.3 think 标签处理策略

流式输出中处理 `<thinking>` / `<think>` 标签：
- **进入 think 区**：检测到开启标签后，后续 chunk 暂存到 buffer（不显示给用户，或根据 show_thinking 配置决定）
- **退出 think 区**：检测到闭合标签后，恢复正常输出
- **未闭合的 think**：文本结束时如果仍在 think 区，丢弃 buffer 内容（和现有 `strip_think_tags()` 行为一致）

---

## 三、详细实施方案

### Step 1: LLM 客户端流式改造（`vulnclaw/agent/llm_client.py`）

**新增函数 `call_llm_streaming(agent, system_prompt) -> AsyncGenerator[tuple[str, str, bool], None]`**

- 使用 `client.chat.completions.create(..., stream=True)`
- 处理 `reasoning_content` 字段（DeepSeek R1 等）
- 增量 yield：每个 delta 的文本 + 当前累计文本 + 是否结束
- 保留非流式的 `call_llm()` 作为向后兼容的便捷函数（内部可调用流式版本等待完成）

**新增函数 `call_llm_auto_streaming(agent, system_prompt, round_context)`**

- 自主循环模式的流式版本
- 在工具调用处仍然一次性输出工具结果（工具执行是阻塞的，无法流式）
- LLM 思考/总结阶段流式输出

**兼容策略**：
- 原有 `call_llm()` 和 `call_llm_auto()` 保持函数签名不变
- 内部改为调用流式版本并 accumulate 结果，确保现有调用方不破坏

### Step 2: Agent 核心扩展流式支持

**`vulnclaw/agent/core.py`**：
- 新增 `async chat_streaming(user_input, target=None, on_chunk=None) -> AgentResult`
  - `on_chunk(delta_text, full_text_so_far)` 回调
  - 其余逻辑与 `chat()` 一致
- 原有 `chat()` 可以改为调用 `chat_streaming()` 不传入 on_chunk 即可

**`vulnclaw/agent/loop_controller.py`**：
- 新增 `auto_pentest_streaming(agent, user_input, target, max_rounds, on_step, on_chunk)`
- `on_chunk` 在 LLM 生成阶段逐 token 回调
- `on_step` 保留为每轮结束时的回调（传递完整 round result）
- 原有 `auto_pentest()` 保持不变

**persistent 模式同理**。

### Step 3: CLI 流式输出

**`vulnclaw/cli/main.py`**：

1. **REPL 模式** (`_run_repl()`)
   - `chat()` 路径：改为调用 `chat_streaming()`
   - `auto_pentest()` 路径：改为调用 `auto_pentest_streaming()`
   - 实现流式打印函数 `_print_streaming_output(config)`：
     - 使用 Rich 的 `console.print(end="", flush=True)` 逐字符输出
     - think 标签根据 `config.session.show_thinking` 决定是否显示
     - 最终输出后换行
   
2. **子命令** (`run/recon/scan/exploit/persistent`)
   - `run` / `persistent`：使用 streaming 版本的 agent 方法
   - `recon/scan/exploit`：单轮 chat 也使用 streaming
   - `_print_agent_output()` 保留用于非流式场景（如报告生成）

### Step 4: Web 后端事件增强

**`vulnclaw/web/schemas.py`**：
- （无需变更，`TaskEvent` 已有 `payload: dict`，可容纳任意字段）

**`vulnclaw/web/services/task_service.py`**：
- `_run_single_task()` / `_run_persistent_task()`：使用 streaming 版本的 agent 方法
- 新增 `on_chunk` 回调：每次收到 chunk 时 `manager.publish(task_id, "llm_chunk", {"phase": ..., "delta": text, "text_so_far": ..., "round": round_num})`
- `round_output` 事件保留为 round 结束时的"完整文本"（方便前端渲染完整状态）

**`vulnclaw/web/task_manager.py`**：
- `publish()` 已通用，无需变更
- `stream_events()` 已通用，无需变更

**`vulnclaw/web/stream.py`**：
- 已通用 SSE 编码，无需变更

### Step 5: 前端实时渲染

**`frontend/src/pages/TaskConsolePage.tsx`**：
- `renderEventText()` 处理 `llm_chunk` 事件
- 新增 "active round text" 状态：当前正在生成的文本缓冲区
- 当收到 `llm_chunk` 时：追加到 active round buffer，终端区实时显示
- 当收到 `round_output` 时：将 active round buffer 转为正式事件行（或替换为完整 round_output text）
- 滚动行为：生成中自动滚到底部；用户手动上滑时暂停自动滚动

**组件状态新增**：
```ts
const [activeRoundText, setActiveRoundText] = useState("");
const [activeRoundMeta, setActiveRoundMeta] = useState<{round?: number, cycle?: number, phase?: string} | null>(null);
```

**事件处理逻辑**：
```
onEvent(event) {
  if (event.event === "llm_chunk") {
    // 追加到 active round text
    setActiveRoundText(prev => prev + event.payload.delta);
    setActiveRoundMeta({round: event.payload.round, cycle: event.payload.cycle, phase: event.payload.phase});
  } else if (event.event === "round_output") {
    // round 结束：清空 active round，添加到历史
    setActiveRoundText("");
    setActiveRoundMeta(null);
    events.push(event);  // 原逻辑不变
  } else {
    // 其他事件保持原逻辑
    events.push(event);
  }
}
```

**终端渲染区**：在历史事件之后，额外渲染一行 "正在生成..." 的活动文本（如果 `activeRoundText` 非空）。

---

## 四、测试策略

### 4.1 单元测试（`tests/test_agent.py`）

- `test_call_llm_streaming_yields_deltas`：mock openai client stream，验证 chunk 顺序和累计文本正确性
- `test_call_llm_streaming_with_reasoning_content`：验证 reasoning 字段的处理
- `test_streaming_think_tag_filtering`：流式场景下 think 标签的正确剥离

### 4.2 集成测试（`tests/test_cli.py`）

- `test_chat_streaming_callback_invoked`：验证 chunk 回调被调用多次（非 0 次非 1 次）
- `test_auto_pentest_streaming_round_boundary`：验证 llm_chunk 和 round_output 的顺序关系

### 4.3 Web 测试（`tests/test_web.py`）

- `test_task_stream_contains_llm_chunk_events`：发起任务后消费 SSE，验证出现 `llm_chunk` 事件

---

## 五、实施顺序和依赖

```
Step 1 (llm_client.py)        无依赖，独立完成
  └─> Step 2 (core.py, loop_controller.py)  依赖 Step 1
        ├─> Step 3 (cli/main.py)            依赖 Step 2
        └─> Step 4 (web/services/task_service.py)  依赖 Step 2
              └─> Step 5 (frontend/)          依赖 Step 4
```

**并行策略**：Step 1 → Step 2 → (Step 3 和 Step 4 并行) → Step 5

---

## 六、向后兼容与降级

1. **函数签名保持**：所有现有公共方法的签名不变
2. **可选的 on_chunk**：不传 `on_chunk` 时行为与之前完全一致
3. **Web 事件兼容**：新增 `llm_chunk` 事件是增量的，旧前端忽略即可正常工作
4. **CLI 开关**：暂不引入全局开关，流式输出直接启用（因为用户体验更好且无副作用）

---

## 七、风险点与处理

| 风险 | 概率 | 影响 | 处理方案 |
|-----|------|------|---------|
| OpenAI client 的 stream 模式返回结构与非 stream 不同 | 中 | 高 | 阅读 openai Python SDK 文档，正确处理 `ChatCompletionChunk` vs `ChatCompletion`；tool_calls 在 stream 模式中也是增量的，需要 accumulate |
| reasoning_content 在 stream 中的字段位置 | 中 | 中 | 测试 DeepSeek / OpenAI o 系列的实际响应格式；编写健壮的字段读取（getattr + isinstance） |
| CLI 流式打印与 Rich markup 的冲突 | 低 | 低 | 流式输出阶段不应用 Rich markup，仅在最终 round_output 时处理 |
| Web SSE 事件量过大 | 低 | 中 | 可以在后端做简单节流（如每 50ms 或累计 3 个 delta 合并一次发送） |
| 前端滚动体验不佳 | 低 | 低 | "用户上滑暂停自动滚动"是行业标准做法；可先简单实现"始终滚到底部"，后续优化 |

---

## 八、成功标准

- [ ] CLI REPL 模式下输入对话，LLM 响应逐字符显示而非一次性输出
- [ ] CLI run/recon/scan/exploit/persistent 命令均有流式效果
- [ ] Web UI Task Console 中，任务运行时能看到实时追加的 `llm_chunk` 文本
- [ ] think 标签在流式输出中按 show_thinking 配置正确处理（不泄露也不截断正常文本）
- [ ] 所有现有测试通过（无回归）
- [ ] 新增流式相关的单元测试和集成测试通过
