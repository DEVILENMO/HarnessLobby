import { renderIconAnsi } from './pixel-icon.js';

const helpText = `Harness Lobby — 跨 harness 终端协作大厅

用法
  lobby                     一键启动（内嵌 server + TUI）
  lobby --external          只连接已有 Lobby
  lobby --port <n>          内嵌 server 端口（默认 4311）
  lobby icon [--full]       打印像素 logo
  lobby help                显示帮助

TUI slash 命令
  /room create <主题>   创建私有工作间（仅你能进）
  /room switch <主题>   切换房间（同时干多个活）
  /room list            我能进的房间
  /room add <slug>      把 harness 拉进当前房
  /members /harness(s) /bound /reset /help /quit

派活
  @ + tab 补全 harness slug，例如  @mimo-code 你的任务
`;

export function printHelp(): void {
  console.log(renderIconAnsi(1));
  console.log('');
  console.log(helpText);
}
