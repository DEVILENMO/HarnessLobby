/**
 * Room ACL: private work-rooms are owner-only; lobby is public.
 */
import { LobbyServer } from '../packages/server/src/lobby.js';

async function main() {
  const port = 4555;
  const server = new LobbyServer({ port });
  await server.listen();
  const base = `http://127.0.0.1:${port}`;

  try {
    const created = (await (
      await fetch(`${base}/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: 'VLA仿真', ownerId: 'u_you' }),
      })
    ).json()) as { id: string; ownerId: string | null };
    if (created.ownerId !== 'u_you') throw new Error('private room owner must be creator');

    // other human cannot see/read/write
    const linRooms = (await (
      await fetch(`${base}/rooms?userId=u_lin`)
    ).json()) as Array<{ id: string }>;
    if (linRooms.some((r) => r.id === created.id)) {
      throw new Error('other human must not see private room');
    }
    const denied = await fetch(`${base}/rooms/${created.id}/messages?userId=u_lin`);
    if (denied.status !== 403) throw new Error(`read expected 403, got ${denied.status}`);
    const deniedWrite = await fetch(`${base}/rooms/${created.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ senderId: 'u_lin', content: 'peek' }),
    });
    if (deniedWrite.status !== 403) throw new Error(`write expected 403, got ${deniedWrite.status}`);

    // owner can read
    const ok = await fetch(`${base}/rooms/${created.id}/messages?userId=u_you`);
    if (!ok.ok) throw new Error('owner must read own room');

    // invite harness
    const inv = await fetch(`${base}/rooms/${created.id}/invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'u_you', slug: 'mimo-code' }),
    });
    if (!inv.ok) throw new Error('owner invite failed');

    // non-owner cannot invite
    const inv2 = await fetch(`${base}/rooms/${created.id}/invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'u_lin', slug: 'mimo-code' }),
    });
    if (inv2.status !== 403) throw new Error(`invite expected 403, got ${inv2.status}`);

    // lobby remains public
    const linAll = (await (
      await fetch(`${base}/rooms?userId=u_lin`)
    ).json()) as Array<{ topic: string; ownerId: string | null }>;
    const hall = linAll.find((r) => r.topic === '大厅');
    if (!hall || hall.ownerId !== null) throw new Error('lobby must be public');

    console.log('ROOM ACL PASS');
  } finally {
    await server.close();
  }
}

main().catch((e) => {
  console.error('ROOM ACL FAIL', e);
  process.exit(1);
});
