"""LLM client helpers for AgentCore."""

from __future__ import annotations

import asyncio
import inspect
import json
import sys
from typing import Any, AsyncGenerator, Callable, Optional

from vulnclaw.agent.tool_call_manager import (
    handle_tool_calls,
    handle_tool_calls_with_results,
)

StreamingChunkCallback = Optional[Callable[[str, str, bool], None]]
"""Type for streaming chunk callbacks: (delta_text, full_text_so_far, is_finished)."""


async def _collect_streamed_chunks(
    stream: Any,
    on_chunk: StreamingChunkCallback = None,
) -> tuple[str, str, list[Any] | None]:
    """Consume a ChatCompletion stream, optionally invoking a per-chunk callback.

    Returns (content_text, reasoning_text, accumulated_tool_calls_or_None).

    tool_calls in streaming mode are incremental: each chunk may carry a
    partial ``delta.tool_calls[i].function.arguments`` string. We accumulate
    them into a list of ``{index, id, type, function: {name, arguments}}``
    dicts and, at the end, merge them back into pseudo-message objects the
    existing tool-call handler understands.
    """
    content_parts: list[str] = []
    reasoning_parts: list[str] = []
    tool_call_accumulator: dict[int, dict[str, Any]] = {}

    for chunk in stream:
        if not getattr(chunk, "choices", None):
            continue
        choice = chunk.choices[0]
        delta = getattr(choice, "delta", None)
        if delta is None:
            continue

        delta_content = getattr(delta, "content", None) or ""
        delta_reasoning = getattr(delta, "reasoning_content", None) or ""
        delta_tool_calls = getattr(delta, "tool_calls", None) or []

        if delta_reasoning:
            reasoning_parts.append(delta_reasoning)
            if on_chunk:
                try:
                    on_chunk(delta_reasoning, "".join(reasoning_parts), False)
                except Exception:
                    pass

        if delta_content:
            content_parts.append(delta_content)
            if on_chunk:
                try:
                    on_chunk(delta_content, "".join(content_parts), False)
                except Exception:
                    pass

        for tc in delta_tool_calls:
            idx = getattr(tc, "index", None)
            if idx is None:
                continue
            entry = tool_call_accumulator.setdefault(idx, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
            tc_id = getattr(tc, "id", None)
            if tc_id:
                entry["id"] = tc_id
            tc_type = getattr(tc, "type", None)
            if tc_type:
                entry["type"] = tc_type
            func = getattr(tc, "function", None)
            if func is not None:
                fname = getattr(func, "name", None)
                if fname:
                    entry["function"]["name"] = fname
                fargs = getattr(func, "arguments", None)
                if fargs:
                    entry["function"]["arguments"] += fargs

    final_content = "".join(content_parts)
    final_reasoning = "".join(reasoning_parts)

    if tool_call_accumulator:
        sorted_indices = sorted(tool_call_accumulator.keys())
        final_tool_calls = [tool_call_accumulator[i] for i in sorted_indices]
    else:
        final_tool_calls = None

    if on_chunk:
        try:
            on_chunk("", final_content, True)
        except Exception:
            pass

    return final_content, final_reasoning, final_tool_calls


def _rebuild_message_for_tool_calls(content: str, reasoning: str, tool_calls: list[dict]) -> Any:
    """Build a message-like object that handle_tool_calls() can consume.

    The existing tool_call_manager expects objects with ``.content`` and
    ``.tool_calls`` (where each tool_call has ``.id`` / ``.function.name`` /
    ``.function.arguments``). We produce a small namespace matching that shape.
    """

    class _Func:
        def __init__(self, name: str, arguments: str):
            self.name = name
            self.arguments = arguments

    class _ToolCall:
        def __init__(self, tc_id: str, func: _Func):
            self.id = tc_id
            self.type = "function"
            self.function = func

    class _Message:
        def __init__(self, content: str, reasoning: str, tcs: list[_ToolCall]):
            self.content = content
            self.reasoning_content = reasoning or None
            self.tool_calls = tcs if tcs else None

    built_tcs = [
        _ToolCall(tc["id"] or "", _Func(tc["function"]["name"], tc["function"]["arguments"]))
        for tc in tool_calls
    ]
    return _Message(content, reasoning, built_tcs)


async def _run_streaming_request(
    agent: Any,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
    stage_label: str,
    on_chunk: StreamingChunkCallback = None,
) -> tuple[Any, int]:
    """Execute a streaming ChatCompletion request with retry logic.

    Returns (final_response_like_object, retry_attempts).
    The response object exposes ``.choices[0].message.{content,reasoning_content,tool_calls}``
    and is compatible with the non-streaming code paths.
    """
    client = agent._get_client()
    kwargs = build_chat_completion_kwargs(agent, messages, tools)
    kwargs["stream"] = True

    loop = asyncio.get_running_loop()
    retry_attempts = 0

    while True:
        try:
            stream = await loop.run_in_executor(
                None, lambda: client.chat.completions.create(**kwargs)
            )
            content, reasoning, tool_calls = await _collect_streamed_chunks(
                stream, on_chunk=on_chunk
            )

            # Provider compatibility: some close the iterator, some don't.
            closer = getattr(stream, "close", None)
            if closer is not None:
                try:
                    maybe_coro = closer()
                    if inspect.isawaitable(maybe_coro):
                        await maybe_coro
                except Exception:
                    pass

            message = _rebuild_message_for_tool_calls(content, reasoning, tool_calls or [])

            class _Choice:
                def __init__(self, msg):
                    self.message = msg

            class _Response:
                def __init__(self, choice):
                    self.choices = [choice]

            return _Response(_Choice(message)), retry_attempts

        except asyncio.CancelledError:
            raise
        except KeyboardInterrupt:
            raise
        except Exception as exc:
            error_text = str(exc).lower()
            if _is_non_retriable_llm_error(error_text):
                raise
            retry_attempts += 1
            print(
                f"[!] {stage_label} LLM 连接异常，第 {retry_attempts} 次重连尝试中... ({exc})",
                file=sys.stdout,
                flush=True,
            )
            await asyncio.sleep(5)


async def call_llm_streaming(
    agent: Any,
    system_prompt: str,
    *,
    on_chunk: StreamingChunkCallback = None,
) -> str:
    """Call the LLM in streaming mode (single turn).

    Args:
        agent: The AgentCore instance.
        system_prompt: The system prompt text.
        on_chunk: Optional callback invoked as ``on_chunk(delta, full_text_so_far, is_finished)``
            for each token chunk produced by the model.

    Returns the final full text response (same format as :func:`call_llm`).
    """
    client = agent._get_client()  # noqa: F841 — kept for side-effect-free consistency
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(agent.context.get_messages())
    tools = agent._build_openai_tools()

    response, retry_attempts = await _run_streaming_request(
        agent, messages, tools, "单轮", on_chunk=on_chunk
    )

    choice = response.choices[0]
    if choice.message.tool_calls:
        tool_text = await handle_tool_calls(agent, choice.message)
        # Tool-call output is not token-streamable from the LLM (it's produced
        # by the agent locally). If a chunk callback is registered, emit the
        # tool output as one "final" chunk so callers see the complete text.
        if on_chunk and tool_text:
            try:
                on_chunk(tool_text, tool_text, True)
            except Exception:
                pass
        return _prepend_retry_notice(tool_text, retry_attempts)

    final_text = extract_response(choice.message)
    return _prepend_retry_notice(final_text, retry_attempts)


async def call_llm_auto_streaming(
    agent: Any,
    system_prompt: str,
    round_context: str,
    *,
    on_chunk: StreamingChunkCallback = None,
) -> str:
    """Call the LLM in auto-pentest mode, with streaming token output.

    The first LLM call emits chunks as tokens arrive. If the model decides
    to call tools, tool results are produced synchronously and appended as
    a single summary chunk. Then a follow-up LLM call (the "tool summary")
    again streams its tokens.

    Returns the final full text response (same format as :func:`call_llm_auto`).
    """
    client = agent._get_client()  # noqa: F841

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(agent.context.get_messages())
    messages.append({"role": "user", "content": round_context})
    tools = agent._build_openai_tools()

    response, retry_attempts = await _run_streaming_request(
        agent, messages, tools, "自主循环", on_chunk=on_chunk
    )

    choice = response.choices[0]
    if choice.message.tool_calls:
        tool_results, skipped_info = await handle_tool_calls_with_results(
            agent, choice.message
        )

        executed_tcs = []
        for tc in tool_results:
            if not isinstance(tc, dict) or "tool_call" not in tc:
                print(
                    f"[!] 跳过异常工具结果: {type(tc).__name__} {str(tc)[:100]}",
                    file=sys.stderr,
                )
                continue
            executed_tcs.append(tc["tool_call"])

        assistant_msg = {
            "role": "assistant",
            "content": choice.message.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in executed_tcs
            ],
        }
        messages.append(assistant_msg)

        for tool_result in tool_results:
            if isinstance(tool_result, dict) and "tool_call_id" in tool_result:
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_result["tool_call_id"],
                        "content": tool_result.get("content", ""),
                    }
                )

        tool_summary_parts = []
        for tc in executed_tcs:
            try:
                args_str = str(tc.function.arguments)[:200]
            except Exception:
                args_str = "<无法读取>"
            tool_summary_parts.append(f"调用工具: {tc.function.name}({args_str})")
        for tr in tool_results:
            content = tr.get("content", "") if isinstance(tr, dict) else str(tr)
            if len(content) > 1000:
                content = content[:500] + "\n...[中间省略]...\n" + content[-500:]
            tool_summary_parts.append(f"工具结果: {content}")
            if (
                isinstance(tr, dict)
                and isinstance(tr.get("structured_content"), dict)
                and tr["structured_content"]
            ):
                structured = json.dumps(tr["structured_content"], ensure_ascii=False)
                if len(structured) > 1000:
                    structured = structured[:500] + "\n...[中间省略]...\n" + structured[-500:]
                tool_summary_parts.append(f"结构化结果: {structured}")
        if skipped_info:
            tool_summary_parts.append(f"⚠️ 本轮跳过: {'; '.join(skipped_info)}")

        # Tool output is local — emit it as one big "chunk" so the streaming
        # consumer still sees evidence of progress rather than a long pause.
        if on_chunk and tool_summary_parts:
            joined = "\n".join(tool_summary_parts) + "\n"
            try:
                on_chunk(joined, joined, False)
            except Exception:
                pass

        try:
            response2, second_retry_attempts = await _run_streaming_request(
                agent, messages, None, "工具总结", on_chunk=on_chunk
            )
            final_text = extract_response(response2.choices[0].message)
            agent.context.add_assistant_message(final_text)
            return _prepend_retry_notice(final_text, retry_attempts + second_retry_attempts)
        except Exception as e2:
            error_text = str(e2).lower()
            if _is_non_retriable_llm_error(error_text):
                fallback = _format_tool_results_fallback(tool_results, skipped_info)
                agent.context.add_assistant_message(fallback)
                if on_chunk:
                    try:
                        on_chunk(fallback, fallback, True)
                    except Exception:
                        pass
                return fallback
            return f"[tool results processed] 继续分析错误: {e2}"

    return _prepend_retry_notice(extract_response(choice.message), retry_attempts)


def extract_response(message: Any) -> str:
    """Extract the actual response text from an LLM message.

    Handles:
    1. Normal content (no thinking)
    2. Content with inline <thinking> tags (open/closed)
    3. Separate reasoning_content field (DeepSeek R1, etc.)
    """
    content = message.content or ""
    reasoning = getattr(message, "reasoning_content", None) or ""
    if reasoning and not content:
        content = f"<thinking>\n{reasoning}\n</thinking>\n"
    elif reasoning and content:
        content = f"<thinking>\n{reasoning}\n</thinking>\n{content}"
    return content


def _is_non_retriable_llm_error(error_text: str) -> bool:
    """Return True for configuration/auth errors that should fail fast."""
    hard_fail_markers = [
        "bad_request_error",
        "incorrect api key",
        "invalid api key",
        "invalid chat setting",
        "invalid function arguments json string",
        "tool_call_id",
        "authentication",
        "unauthorized",
        "permission denied",
        "model not found",
        "no such model",
        "invalid_request_error",
        "unsupported parameter",
    ]
    return any(marker in error_text for marker in hard_fail_markers)


def _is_openai_reasoning_model(provider: str, model: str) -> bool:
    """Return True for OpenAI models that use the newer reasoning parameter set."""
    if provider.lower() != "openai":
        return False
    normalized = model.lower()
    return normalized.startswith(("o1", "o3", "o4", "gpt-5"))


def build_chat_completion_kwargs(
    agent: Any,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    *,
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> dict[str, Any]:
    """Build provider-compatible Chat Completions kwargs.

    OpenAI reasoning/GPT-5 models reject the legacy max_tokens field and expect
    max_completion_tokens instead. Other OpenAI-compatible providers may still
    require the older field, so keep the switch scoped to OpenAI's newer model
    families.
    """
    llm = agent.config.llm
    provider = str(getattr(llm, "provider", "") or "").lower()
    model = str(getattr(llm, "model", "") or "")
    token_limit = max_tokens if max_tokens is not None else getattr(llm, "max_tokens", None)
    temp = temperature if temperature is not None else getattr(llm, "temperature", None)
    uses_reasoning_params = _is_openai_reasoning_model(provider, model)

    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
    }
    if token_limit is not None:
        if uses_reasoning_params:
            kwargs["max_completion_tokens"] = token_limit
        else:
            kwargs["max_tokens"] = token_limit
    if temp is not None and not uses_reasoning_params:
        kwargs["temperature"] = temp
    if tools:
        kwargs["tools"] = tools
    if uses_reasoning_params:
        reasoning_effort = getattr(llm, "reasoning_effort", None)
        if reasoning_effort:
            kwargs["reasoning_effort"] = reasoning_effort
    return kwargs


async def _call_with_persistent_retries(
    agent: Any, request_fn, stage_label: str
) -> tuple[Any, int]:
    """Keep retrying retriable LLM calls until success or manual interruption.

    Returns:
        (response, retry_attempts)
    """
    loop = asyncio.get_running_loop()
    retry_attempts = 0

    while True:
        try:
            maybe_response = loop.run_in_executor(None, request_fn)
            response = await maybe_response if inspect.isawaitable(maybe_response) else maybe_response
            if response is not None and getattr(response, "choices", None):
                return response, retry_attempts

            retry_attempts += 1
            print(
                f"[!] {stage_label} LLM API 异常响应，第 {retry_attempts} 次重连尝试中... (5s 后重试)",
                file=sys.stdout,
                flush=True,
            )
            await asyncio.sleep(5)
        except asyncio.CancelledError:
            raise
        except KeyboardInterrupt:
            raise
        except Exception as exc:
            error_text = str(exc).lower()
            if _is_non_retriable_llm_error(error_text):
                raise

            retry_attempts += 1
            print(
                f"[!] {stage_label} LLM 连接异常，第 {retry_attempts} 次重连尝试中... ({exc})",
                file=sys.stdout,
                flush=True,
            )
            await asyncio.sleep(5)


def _prepend_retry_notice(text: str, retry_attempts: int) -> str:
    """Annotate a successful response if retries happened within the same round."""
    if retry_attempts <= 0:
        return text
    return f"[LLM恢复] 本轮在第 {retry_attempts} 次重连后恢复。\n{text}"


def _format_tool_results_fallback(
    tool_results: list[dict[str, Any]], skipped_info: list[str]
) -> str:
    """Build a plain-text fallback summary when provider tool-summary format is incompatible."""
    parts = ["[tool results processed] 当前提供商不兼容标准工具总结回传，已降级为纯文本结果摘要："]
    for item in tool_results:
        content = item.get("content", "") if isinstance(item, dict) else str(item)
        if len(content) > 800:
            content = content[:400] + "\n...[中间省略]...\n" + content[-400:]
        parts.append(content)
    if skipped_info:
        parts.append("⚠️ 本轮跳过: " + "; ".join(skipped_info))
    return "\n".join(parts)


async def call_llm(agent: Any, system_prompt: str) -> str:
    """Call the LLM with the current context and system prompt (single turn)."""
    client = agent._get_client()

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(agent.context.get_messages())
    tools = agent._build_openai_tools()

    kwargs = build_chat_completion_kwargs(agent, messages, tools)

    response, retry_attempts = await _call_with_persistent_retries(
        agent,
        lambda: client.chat.completions.create(**kwargs),
        "单轮",
    )

    choice = response.choices[0]
    if choice.message.tool_calls:
        return _prepend_retry_notice(await handle_tool_calls(agent, choice.message), retry_attempts)
    return _prepend_retry_notice(extract_response(choice.message), retry_attempts)


async def call_llm_auto(agent: Any, system_prompt: str, round_context: str) -> str:
    """Call the LLM in auto-pentest mode with round context appended."""
    client = agent._get_client()

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(agent.context.get_messages())
    messages.append({"role": "user", "content": round_context})
    tools = agent._build_openai_tools()

    kwargs = build_chat_completion_kwargs(agent, messages, tools)

    response, retry_attempts = await _call_with_persistent_retries(
        agent,
        lambda: client.chat.completions.create(**kwargs),
        "自主循环",
    )

    choice = response.choices[0]
    if choice.message.tool_calls:
        tool_results, skipped_info = await handle_tool_calls_with_results(agent, choice.message)

        executed_tcs = []
        for tc in tool_results:
            if not isinstance(tc, dict) or "tool_call" not in tc:
                import sys

                print(f"[!] 跳过异常工具结果: {type(tc).__name__} {str(tc)[:100]}", file=sys.stderr)
                continue
            executed_tcs.append(tc["tool_call"])

        assistant_msg = {
            "role": "assistant",
            "content": choice.message.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in executed_tcs
            ],
        }
        messages.append(assistant_msg)

        for tool_result in tool_results:
            if isinstance(tool_result, dict) and "tool_call_id" in tool_result:
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_result["tool_call_id"],
                        "content": tool_result.get("content", ""),
                    }
                )

        tool_summary_parts = []
        for tc in executed_tcs:
            try:
                args_str = str(tc.function.arguments)[:200]
            except Exception:
                args_str = "<无法读取>"
            tool_summary_parts.append(f"调用工具: {tc.function.name}({args_str})")
        for tr in tool_results:
            content = tr.get("content", "") if isinstance(tr, dict) else str(tr)
            if len(content) > 1000:
                content = content[:500] + "\n...[中间省略]...\n" + content[-500:]
            tool_summary_parts.append(f"工具结果: {content}")
            if (
                isinstance(tr, dict)
                and isinstance(tr.get("structured_content"), dict)
                and tr["structured_content"]
            ):
                structured = json.dumps(tr["structured_content"], ensure_ascii=False)
                if len(structured) > 1000:
                    structured = structured[:500] + "\n...[中间省略]...\n" + structured[-500:]
                tool_summary_parts.append(f"结构化结果: {structured}")
        if skipped_info:
            tool_summary_parts.append(f"⚠️ 本轮跳过: {'; '.join(skipped_info)}")

        try:
            kwargs["messages"] = messages
            response2, second_retry_attempts = await _call_with_persistent_retries(
                agent,
                lambda: client.chat.completions.create(**kwargs),
                "工具总结",
            )
            final_text = extract_response(response2.choices[0].message)
            agent.context.add_assistant_message(final_text)
            return _prepend_retry_notice(final_text, retry_attempts + second_retry_attempts)
        except Exception as e2:
            error_text = str(e2).lower()
            if _is_non_retriable_llm_error(error_text):
                fallback = _format_tool_results_fallback(tool_results, skipped_info)
                agent.context.add_assistant_message(fallback)
                return fallback
            return f"[tool results processed] 继续分析错误: {e2}"

    return _prepend_retry_notice(extract_response(choice.message), retry_attempts)
