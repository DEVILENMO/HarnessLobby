import fs from 'node:fs';
import path from 'node:path';

const root = 'C:/Users/DEVIL/XiaomiMiMoProjects/ARCHarnessLobby';

function findFile(dir, name, depth = 0) {
  if (depth > 6) return null;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name === name) return p;
    if (e.isDirectory() && !['node_modules', 'dist', '.git'].includes(e.name)) {
      const hit = findFile(p, name, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

const lobby = findFile(path.join(root, 'packages'), 'lobby.ts') ||
  path.join(root, 'packages', 'server', 'src', 'lobby.ts');

let s = fs.readFileSync(lobby, 'utf8');

// Replace mention dispatch with @all fallback
const oldBlock = `    for (const slug of mentions) {
      const harness = this.store.findHarnessBySlug(slug);
      if (!harness) continue;
      // @harness：owner 或公共房可拉入成员
      if (!room.memberIds.includes(harness.id)) {
        const canInvite = room.ownerId === null || room.ownerId === senderId;
        if (canInvite) room.memberIds.push(harness.id);
      }`;

const newBlock = `    // 无 @具体 harness → 视为 @all，广播给房间内各 harness 自行判断
    let targets: import('@harness-lobby/protocol').Harness[] = [];
    if (mentions.length) {
      for (const slug of mentions) {
        const h = this.store.findHarnessBySlug(slug);
        if (h) targets.push(h);
      }
    } else {
      targets = [...this.store.harnesses.values()].filter((h) =>
        room.memberIds.includes(h.id) || room.ownerId === null
      );
    }
    const isBroadcast = mentions.length === 0 && targets.length > 0;

    for (const harness of targets) {
      // @harness：owner 或公共房可拉入成员
      if (!room.memberIds.includes(harness.id)) {
        const canInvite = room.ownerId === null || room.ownerId === senderId;
        if (canInvite) room.memberIds.push(harness.id);
      }`;

if (s.includes(oldBlock)) {
  s = s.replace(oldBlock, newBlock);
} else if (!s.includes('isBroadcast')) {
  // fallback: insert after for (const slug of mentions)
  s = s.replace(
    'for (const slug of mentions) {',
    `let targets: import('@harness-lobby/protocol').Harness[] = [];
    if (mentions.length) {
      for (const slug of mentions) {
        const h0 = this.store.findHarnessBySlug(slug);
        if (h0) targets.push(h0);
      }
    } else {
      targets = [...this.store.harnesses.values()].filter((h) =>
        room.memberIds.includes(h.id) || room.ownerId === null
      );
    }
    const isBroadcast = mentions.length === 0 && targets.length > 0;
    for (const harness of targets) {
      void 0;`
  );
}

// task payload: mark broadcast
s = s.replace(
  `        mentions: [slug],`,
  `        mentions: isBroadcast ? ['*'] : [harness.slug],`
);
s = s.replace(
  `        mentions: [harness.slug],`,
  `        mentions: isBroadcast ? ['*'] : [harness.slug],`
);

fs.writeFileSync(lobby, s, 'utf8');
console.log('patched lobby', lobby);
