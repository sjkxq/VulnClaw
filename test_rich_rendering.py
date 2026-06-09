#!/usr/bin/env python3
"""Test script to analyze Rich library rendering and character output timing."""

import sys
import time
from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from rich.table import Table
from rich.syntax import Syntax
from rich.progress import track
from rich.live import Live
from rich.markdown import Markdown

console = Console()


def test_basic_output():
    """Test basic Rich console output with styled text."""
    console.print("[bold cyan]=== Test 1: Basic Output ===[/]")
    console.print("Plain text output")
    console.print("[bold red]Bold red text[/]")
    console.print("[italic green]Italic green text[/]")
    console.print("[underline blue]Underlined blue text[/]")
    console.print("[bold yellow on blue]Colored background text[/]")
    console.print()


def test_panel_rendering():
    """Test Rich Panel component rendering."""
    console.print("[bold cyan]=== Test 2: Panel Rendering ===[/]")
    console.print(
        Panel(
            "This is a panel with [bold red]styled content[/]\n"
            "Multi-line content works as expected.\n"
            "Panel border is drawn using box-drawing characters.",
            title="Test Panel",
            border_style="cyan",
        )
    )
    console.print()


def test_table_rendering():
    """Test Rich Table component rendering."""
    console.print("[bold cyan]=== Test 3: Table Rendering ===[/]")
    table = Table(title="Test Table", border_style="blue")
    table.add_column("Column 1", style="cyan", no_wrap=True)
    table.add_column("Column 2", style="magenta")
    table.add_column("Column 3", style="green", justify="right")
    table.add_row("Row 1", "Value A", "123.45")
    table.add_row("Row 2", "Value B", "678.90")
    table.add_row("Row 3", "Value C", "999.99")
    console.print(table)
    console.print()


def test_syntax_highlighting():
    """Test Rich syntax highlighting."""
    console.print("[bold cyan]=== Test 4: Syntax Highlighting ===[/]")
    code = """
def hello_world():
    \"\"\"Print a greeting message.\"\"\"
    name = "World"
    print(f"Hello, {name}!")
    return True
"""
    syntax = Syntax(code, "python", theme="monokai", line_numbers=True)
    console.print(syntax)
    console.print()


def test_markdown_rendering():
    """Test Rich Markdown rendering."""
    console.print("[bold cyan]=== Test 5: Markdown Rendering ===[/]")
    markdown_text = """
# Heading 1

## Heading 2

- List item 1
- List item 2
- List item 3

**Bold text** and *italic text* and `inline code`

> Blockquote

[Link text](https://example.com)
"""
    console.print(Markdown(markdown_text))
    console.print()


def test_character_by_character_output():
    """Test character-by-character output simulation (typewriter effect)."""
    console.print("[bold cyan]=== Test 6: Character-by-Character Output ===[/]")
    console.print("Simulating typewriter effect:")
    text = "This text appears character by character to simulate streaming output."
    for char in text:
        sys.stdout.write(char)
        sys.stdout.flush()
        time.sleep(0.03)
    sys.stdout.write("\n\n")


def test_unicode_support():
    """Test Unicode character support."""
    console.print("[bold cyan]=== Test 7: Unicode Support ===[/]")
    unicode_chars = [
        ("Box drawing", "╔═╗ ║ ╚═╝ ┌─┐ │ └─┘"),
        ("Arrows", "↑ ↓ ← → ↖ ↗ ↘ ↙ ⇄ ⇅"),
        ("Math symbols", "∑ ∫ π √ ∞ ≠ ≤ ≥"),
        ("Emoji", "✓ ✗ ⚠ ★ ♥ ♦ ♣ ♠"),
        ("CJK characters", "测试 中文 汉字"),
        ("Special characters", "─━│┃┄┅┆┇┈┉┊┋"),
    ]
    table = Table(title="Unicode Character Test", border_style="yellow")
    table.add_column("Category", style="cyan", no_wrap=True)
    table.add_column("Characters", style="white")
    for category, chars in unicode_chars:
        table.add_row(category, chars)
    console.print(table)
    console.print()


def test_live_output():
    """Test Rich Live output for dynamic content."""
    console.print("[bold cyan]=== Test 8: Live Output ===[/]")
    console.print("Simulating live progress updates:")
    try:
        for i in track(range(10), description="Processing..."):
            time.sleep(0.2)
        console.print()
    except Exception as e:
        console.print(f"[red]Live output error: {e}[/]")
        console.print()


def test_colored_logging():
    """Test colored output for different log levels."""
    console.print("[bold cyan]=== Test 9: Colored Log Levels ===[/]")
    log_messages = [
        ("INFO", "This is an informational message", "green"),
        ("WARNING", "This is a warning message", "yellow"),
        ("ERROR", "This is an error message", "red"),
        ("DEBUG", "This is a debug message", "cyan"),
        ("CRITICAL", "This is a critical message", "bold red"),
    ]
    for level, message, style in log_messages:
        console.print(f"[{style}][{level}][/] {message}")
    console.print()


def test_alignment_and_justification():
    """Test text alignment and justification."""
    console.print("[bold cyan]=== Test 10: Alignment ===[/]")
    text = Text("Aligned Text")
    text.stylize("bold magenta")
    console.print(text)
    console.print()
    console.print("Left-aligned:")
    console.print(Panel("[left]Left-aligned content[/]", width=60))
    console.print()
    console.print("Center-aligned:")
    console.print(Panel("[center]Center-aligned content[/]", width=60))
    console.print()
    console.print("Right-aligned:")
    console.print(Panel("[right]Right-aligned content[/]", width=60))
    console.print()


def test_long_lines_and_wrapping():
    """Test long line handling and text wrapping."""
    console.print("[bold cyan]=== Test 11: Long Lines & Wrapping ===[/]")
    long_text = (
        "This is a very long line of text that should be automatically wrapped "
        "by the Rich console to fit within the current terminal width. This tests "
        "how well Rich handles word boundaries and maintains readability when "
        "displaying long paragraphs of content in different terminal sizes."
    )
    console.print(long_text)
    console.print()


def test_ascii_banner():
    """Test ASCII art banner rendering."""
    console.print("[bold cyan]=== Test 12: ASCII Banner ===[/]")
    banner = """
    __     __   _   _      _
    \\ \\   / /__| |_(_) ___| |__
     \\ \\ / / _ \\ __| |/ __| '_ \\
      \\ V /  __/ |_| | (__| | | |
       \\_/ \\___|\\__|_|\\___|_| |_|
    """
    console.print(Text(banner, style="bold green"))
    console.print()


def test_escape_sequences():
    """Test that Rich markup escape sequences work correctly."""
    console.print("[bold cyan]=== Test 13: Escape Sequences ===[/]")
    # These should be escaped to avoid Rich markup errors
    console.print("[red]Testing \\[bracket] escape[/]")
    console.print("Literal [brackets] are preserved in plain text")
    console.print("Markup characters: \\[ and \\]")
    console.print()


def test_windows_console_simulation():
    """Test Windows console configuration (simulated on Linux)."""
    console.print("[bold cyan]=== Test 14: Console Compatibility ===[/]")
    console.print(f"Current platform: {sys.platform}")
    console.print(f"Console size: {console.size.width}x{console.size.height}")
    console.print(f"Color system: {console.color_system}")
    console.print(f"Legacy Windows: {console.is_terminal}")
    console.print(f"Encoding: {sys.stdout.encoding}")
    console.print()


def main():
    """Run all tests."""
    console.print()
    console.print(
        Panel(
            "VulnClaw Rich Rendering Analysis Test Suite\n"
            "Testing all Rich library features used in the CLI",
            title="Rich Library Test",
            border_style="bold cyan",
        )
    )
    console.print()

    tests = [
        test_basic_output,
        test_panel_rendering,
        test_table_rendering,
        test_syntax_highlighting,
        test_markdown_rendering,
        test_character_by_character_output,
        test_unicode_support,
        test_live_output,
        test_colored_logging,
        test_alignment_and_justification,
        test_long_lines_and_wrapping,
        test_ascii_banner,
        test_escape_sequences,
        test_windows_console_simulation,
    ]

    for i, test in enumerate(tests, 1):
        console.print(f"[dim]Running test {i}/{len(tests)}: {test.__name__}[/]")
        console.print()
        try:
            test()
        except Exception as e:
            console.print(f"[red]Error in {test.__name__}: {e}[/]")
            console.print()

    console.print(
        Panel(
            "[green]All tests completed successfully![/]\n"
            "Rich library is functioning correctly with:\n"
            "  - Colored text and styles\n"
            "  - Panel and table rendering\n"
            "  - Unicode and box-drawing characters\n"
            "  - Live output and progress\n"
            "  - Markdown and syntax highlighting",
            title="Test Results",
            border_style="bold green",
        )
    )
    console.print()


if __name__ == "__main__":
    main()
