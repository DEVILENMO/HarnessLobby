import { renderIconAnsi } from './pixel-icon.js';

const helpText = `Harness Lobby — 跨 harness 终端协作大厅

用法
  harness-lobby                 启动 TUI
  harness-lobby icon [--full]   打印像素 logo
  harness-lobby help            显示帮助

TUI slash 命令
  /rooms /join /new /members /harnesses /bound /reset /help /quit

派活
  在输入框写  @mock-harness 你的任务
`;

export function printHelp(): void {
  console.log(renderIconAnsi(1));
  console.log('');
  console.log(helpText);
}
