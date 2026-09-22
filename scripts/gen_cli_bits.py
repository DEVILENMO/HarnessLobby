from pathlib import Path

base = Path(r"C:\Users\DEVIL\XiaomiMiMoProjects\ARCHarnessLobby\.worktrees\harness-lobby-cli\packages\cli\src")
base.mkdir(parents=True, exist_ok=True)

esc = chr(27)
pixel = f'''import React from 'react';
import {{ Box, Text }} from 'ink';
import {{ ICON_GRID, ICON_SIZE, type Pixel }} from './icon-grid.js';

const ESC = String.fromCharCode(27);
const RESET = ESC + '[0m';

function rgb(p: Pixel, bg: boolean): string {{
  if (!p) return '';
  const mode = bg ? 48 : 38;
  return `${{ESC}}[${{mode}};2;${{p[0]}};${{p[1]}};${{p[2]}}m`;
}}

function pairStyle(top: Pixel, bottom: Pixel): {{ codes: string; char: string }} {{
  if (top && bottom) return {{ codes: `${{rgb(top, false)}}${{rgb(bottom, true)}}`, char: '\\u2580' }};
  if (top) return {{ codes: `${{rgb(top, false)}}${{ESC}}[49m`, char: '\\u2580' }};
  if (bottom) return {{ codes: `${{rgb(bottom, false)}}${{ESC}}[49m`, char: '\\u2584' }};
  return {{ codes: RESET, char: ' ' }};
}}

export function PixelIcon({{ scale = 1 }}: {{ scale?: number }}): React.ReactElement {{
  const lines = renderIconAnsi(scale).split('\\n');
  return (
    <Box flexDirection="column">
      {{lines.map((line, i) => (
        <Text key={{i}}>{{line}}</Text>
      ))}}
    </Box>
  );
}}

export function renderIconAnsi(scale = 1): string {{
  const out: string[] = [];
  for (let y = 0; y < ICON_SIZE; y += 2) {{
    let line = '';
    for (let x = 0; x < ICON_SIZE; x += 1) {{
      const top = ICON_GRID[y]?.[x] ?? null;
      const bottom = ICON_GRID[y + 1]?.[x] ?? null;
      const st = pairStyle(top, bottom);
      for (let s = 0; s < scale; s += 1) {{
        line += `${{st.codes}}${{st.char.repeat(scale)}}${{RESET}}`;
      }}
    }}
    out.push(line);
  }}
  return out.join('\\n');
}}

export function renderIconBlocks(scale = 1): string {{
  const out: string[] = [];
  for (let y = 0; y < ICON_SIZE; y += 1) {{
    let line = '';
    for (let x = 0; x < ICON_SIZE; x += 1) {{
      const px = ICON_GRID[y]?.[x] ?? null;
      if (px) {{
        line += `${{rgb(px, true)}}${{'  '.repeat(scale)}}${{RESET}}`;
      }} else {{
        line += '  '.repeat(scale);
      }}
    }}
    out.push(line);
  }}
  return out.join('\\n');
}}
'''

help_ts = '''import { renderIconAnsi } from './pixel-icon.js';

const helpText = `Harness Lobby — 跨 harness 终端协作大厅

用法
  harness-lobby                 启动 TUI
  harness-lobby icon [--full]   打印像素 logo
  harness-lobby help            显示帮助

TUI slash 命令
  /rooms /join /new /members /harnesses /bound /reset /help /quit

派活
  在输入框写  @mimo-code 你的任务
`;

export function printHelp(): void {
  console.log(renderIconAnsi(1));
  console.log('');
  console.log(helpText);
}
'''

(base / "pixel-icon.tsx").write_text(pixel, encoding="utf-8")
(base / "help.ts").write_text(help_ts, encoding="utf-8")
print("ok", (base / "pixel-icon.tsx").stat().st_size, (base / "help.ts").stat().st_size)
