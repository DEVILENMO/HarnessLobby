/**
 * 把插件源（examples/zcode-plugin）镜像到本地测试市场（examples/zcode-marketplace/harness-lobby）。
 * 市场根必须只含 marketplace.json + 插件本体，否则 ZCode 添加市场时会把整个目录树
 * （含 .worktrees / node_modules 符号链接）卷进 staging，Windows 上因 symlink 权限直接 EPERM。
 *
 * 用法：node scripts/sync-zcode-market.mjs   （改完插件源后跑一次）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const src = path.join(root, 'examples', 'zcode-plugin');
const dest = path.join(root, 'examples', 'zcode-marketplace', 'harness-lobby');

if (!fs.existsSync(path.join(src, '.zcode-plugin', 'plugin.json'))) {
  console.error(`plugin source not found: ${src}`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(path.join(dest, '.zcode-plugin', 'plugin.json'), 'utf8'));
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(path.relative(dest, p));
  }
})(dest);

console.log(`synced harness-lobby v${manifest.version} -> examples/zcode-marketplace/harness-lobby (${files.length} files)`);
for (const f of files.sort()) console.log(`  ${f}`);
