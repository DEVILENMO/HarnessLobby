/* Harness Lobby — interactive product prototype */
(() => {
  "use strict";

  // ── Mock data ─────────────────────────────────────────────
  const harnesses = [
    {
      id: "h_minimax",
      slug: "minimax-code",
      display_name: "MiniMax Code",
      avatar: "MM",
      mode: "A",
      status: "online", // online | offline | working
      plugin_endpoint: "ws://127.0.0.1:4310/plugin",
      capabilities: ["读文件", "写文件", "跑命令", "终端"],
      auth_token: "ilv_minimax_8f3a…c2",
    },
    {
      id: "h_claude",
      slug: "claude-code",
      display_name: "Claude Code",
      avatar: "CC",
      mode: "A",
      status: "online",
      plugin_endpoint: "ws://127.0.0.1:4311/plugin",
      capabilities: ["读文件", "写文件", "跑命令", "Web"],
      auth_token: "ilv_claude_21bc…9a",
    },
    {
      id: "h_cursor",
      slug: "cursor-mcp",
      display_name: "Cursor (MCP)",
      avatar: "CU",
      mode: "B",
      status: "online",
      plugin_endpoint: "mcp://lobby/mode-b",
      capabilities: ["读文件", "补全", "浏览器"],
      auth_token: "ilv_cursor_mcp…1e",
    },
    {
      id: "h_devin",
      slug: "devin",
      display_name: "Devin",
      avatar: "DV",
      mode: "A",
      status: "offline",
      plugin_endpoint: "ws://127.0.0.1:4312/plugin",
      capabilities: ["自主任务", "跑命令", "PR"],
      auth_token: "ilv_devin_77de…04",
    },
  ];

  const humans = [
    { id: "u_owner", slug: "you", display_name: "You", avatar: "YO", type: "human" },
    { id: "u_lin", slug: "lin", display_name: "Lin", avatar: "LN", type: "human" },
  ];

  const rooms = [
    {
      id: "r_embodied",
      topic: "具身智能",
      member_ids: ["u_owner", "h_minimax", "h_claude", "h_cursor"],
      created_at: "2026-02-10T09:00:00Z",
    },
    {
      id: "r_weekly",
      topic: "周报",
      member_ids: ["u_owner", "h_minimax", "h_claude"],
      created_at: "2026-02-11T10:00:00Z",
    },
    {
      id: "r_paper",
      topic: "论文复现",
      member_ids: ["u_owner", "h_claude", "h_cursor"],
      created_at: "2026-02-12T14:00:00Z",
    },
  ];

  /** BoundSession: (room_id, harness_id) → one session */
  const boundSessions = {
    // "r_embodied|h_minimax": { ... }
  };

  /** messages per room */
  const messages = {
    r_embodied: [
      {
        id: "m1",
        kind: "system",
        content: "房间已创建 · 已拉入 MiniMax Code / Claude Code / Cursor",
        created_at: "09:00",
      },
      {
        id: "m2",
        kind: "human",
        sender_id: "u_owner",
        content:
          "这轮我们要把 GelSight 触觉接到 ROS 节点上。@minimax-code 先扫一遍现有节点结构。",
        mentions: ["minimax-code"],
        created_at: "09:12",
      },
      {
        id: "m3",
        kind: "harness",
        sender_id: "h_minimax",
        content:
          "收到。已定位 `src/robot/tactile_bridge.cpp` 与 `launch/robot.launch.xml`。\n\n当前节点只订阅 `/joint_states`，没有触觉话题。建议新增 `/gelsight/raw` 订阅，在 callback 里做归一化后写 `/tactile/features`。\n\n```\n// tactile_bridge.cpp\nclass TactileBridge : public rclcpp::Node {\n  void on_gelsight(const sensor_msgs::msg::Image &msg);\n};\n```",
        mentions: [],
        created_at: "09:13",
        stream_state: "final",
        session_id: "bs_emb_mm",
        state: "idle",
      },
      {
        id: "m4",
        kind: "human",
        sender_id: "u_owner",
        content: "@claude-code 写一段 README，说明触觉接口的 topic 与消息类型。",
        mentions: ["claude-code"],
        created_at: "09:20",
      },
      {
        id: "m5",
        kind: "harness",
        sender_id: "h_claude",
        content:
          "README 草稿已写入 `docs/tactile.md`：\n\n- **订阅** `/gelsight/raw` — `sensor_msgs/Image`\n- **发布** `/tactile/features` — `std_msgs/Float32MultiArray`\n- 启动：`ros2 launch robot robot.launch.xml tactile:=true`\n\n需要我顺手补 launch 参数校验吗？",
        mentions: [],
        created_at: "09:21",
        stream_state: "final",
        session_id: "bs_emb_cc",
        state: "idle",
      },
    ],
    r_weekly: [
      {
        id: "w1",
        kind: "human",
        sender_id: "u_owner",
        content: "@minimax-code 整理今天的工作，出三条周报要点。",
        mentions: ["minimax-code"],
        created_at: "18:40",
      },
      {
        id: "w2",
        kind: "harness",
        sender_id: "h_minimax",
        content:
          "今日要点：\n1. GelSight ROS 节点骨架与 topic 约定已落地\n2. 触觉特征归一化参数待调\n3. 明天接仿真回归\n\n（独立 session，与「具身智能」房间上下文隔离）",
        mentions: [],
        created_at: "18:41",
        stream_state: "final",
        session_id: "bs_wk_mm",
        state: "idle",
      },
    ],
    r_paper: [
      {
        id: "p1",
        kind: "system",
        content: "房间已创建 · 用于 VLA / 触觉论文复现",
        created_at: "14:02",
      },
      {
        id: "p2",
        kind: "human",
        sender_id: "u_lin",
        content: "把 baseline 的 eval 脚本参数表整理一下，@cursor-mcp 从 config 里抽。",
        mentions: ["cursor-mcp"],
        created_at: "14:18",
      },
    ],
  };

  const activity = [
    { text: "<strong>MiniMax Code</strong> 绑定 session <span class='mono'>bs_emb_mm</span>", kind: "route", time: "09:12" },
    { text: "<strong>Claude Code</strong> 绑定 session <span class='mono'>bs_emb_cc</span>", kind: "route", time: "09:20" },
    { text: "<strong>MiniMax Code</strong> 在「周报」绑定独立 session", kind: "route", time: "18:40" },
    { text: "Mode B · <strong>Cursor (MCP)</strong> 已注册", kind: "mcp", time: "14:05" },
  ];

  // ── State ─────────────────────────────────────────────────
  const state = {
    roomId: "r_embodied",
    mentionQuery: null,
    mentionIndex: 0,
    streamTimers: new Set(),
  };

  // ── Helpers ───────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  function nowHM() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function uid(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function getMember(id) {
    return (
      harnesses.find((h) => h.id === id || h.slug === id) ||
      humans.find((u) => u.id === id || u.slug === id) ||
      null
    );
  }

  function getHarnessBySlug(slug) {
    return harnesses.find((h) => h.slug === slug);
  }

  function getRoom(id) {
    return rooms.find((r) => r.id === id);
  }

  function boundKey(roomId, harnessId) {
    return `${roomId}|${harnessId}`;
  }

  function getBound(roomId, harnessId) {
    return boundSessions[boundKey(roomId, harnessId)] || null;
  }

  function ensureBound(roomId, harnessId) {
    const k = boundKey(roomId, harnessId);
    if (boundSessions[k]) return boundSessions[k];
    const h = getMember(harnessId);
    const bs = {
      id: uid("bs"),
      room_id: roomId,
      harness_id: harnessId,
      external_session_ref:
        h && h.mode === "B"
          ? `mcp_sess_${Math.random().toString(36).slice(2, 8)}`
          : `sess_${Math.random().toString(36).slice(2, 8)}`,
      created_at: nowHM(),
    };
    boundSessions[k] = bs;
    return bs;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatContent(raw) {
    let text = escapeHtml(raw);
    // fenced code
    text = text.replace(/```([\s\S]*?)```/g, (_, code) => `<pre>${code.replace(/^\n/, "")}</pre>`);
    // inline code
    text = text.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
    // mentions
    text = text.replace(/@([a-z0-9-]+)/gi, (m, slug) => {
      const h = getHarnessBySlug(slug);
      const u = humans.find((x) => x.slug === slug);
      if (h) {
        const cls = h.mode === "B" ? "mention mention--mcp" : "mention";
        return `<span class="${cls}">@${escapeHtml(slug)}</span>`;
      }
      if (u) return `<span class="mention mention--human">@${escapeHtml(slug)}</span>`;
      return m;
    });
    return text;
  }

  function avatarHtml(member, extra = "") {
    if (!member) return "";
    const isHuman = member.type === "human" || humans.some((h) => h.id === member.id);
    let cls = isHuman ? "avatar avatar--human" : "avatar avatar--harness";
    if (!isHuman && member.mode === "B") cls = "avatar avatar--mcp";
    if (!isHuman && member.status === "offline") cls = "avatar avatar--offline";
    if (member.status === "working") cls += " is-working";
    return `<div class="${cls} ${extra}">${escapeHtml(member.avatar)}</div>`;
  }

  function statusDotClass(status) {
    if (status === "working") return "status-dot is-working";
    if (status === "offline") return "status-dot is-offline";
    return "status-dot is-online";
  }

  // ── Render ────────────────────────────────────────────────
  function renderRail() {
    const roomList = $("#room-list");
    roomList.innerHTML = rooms
      .map((r) => {
        const active = r.id === state.roomId ? "is-active" : "";
        const count = r.member_ids.length;
        return `
          <button type="button" class="room-item ${active}" data-room="${r.id}">
            <span class="room-item__hash">#</span>
            <span class="room-item__name">${escapeHtml(r.topic)}</span>
            <span class="room-item__badge">${count}</span>
          </button>`;
      })
      .join("");

    const hList = $("#harness-list");
    hList.innerHTML = harnesses
      .map((h) => {
        const modeCls = h.mode === "B" ? "mode-tag mode-tag--b" : "mode-tag mode-tag--a";
        const modeLabel = h.mode === "B" ? "B·MCP" : "A·WS";
        const av = avatarHtml(h);
        return `
          <div class="harness-row" data-harness="${h.id}">
            ${av}
            <div class="harness-row__body">
              <div class="harness-row__name">${escapeHtml(h.display_name)}</div>
              <div class="harness-row__meta">
                <span class="${statusDotClass(h.status)}"></span>
                <span class="${modeCls}">${modeLabel}</span>
                <span>${h.status}</span>
              </div>
            </div>
          </div>`;
      })
      .join("");
  }

  function renderStream() {
    const room = getRoom(state.roomId);
    const list = messages[state.roomId] || [];
    $("#room-title").textContent = room ? room.topic : "—";
    $("#room-path").textContent = `room / ${room ? room.id : ""}`;
    $("#room-members").textContent = `${room ? room.member_ids.length : 0} members`;

    const bounds = Object.values(boundSessions).filter((b) => b.room_id === state.roomId);
    $("#room-bound").textContent = `${bounds.length} bound sessions`;

    const stream = $("#stream");
    if (!list.length) {
      stream.innerHTML = `
        <div class="stream__empty">
          <h3>房间是空的</h3>
          <p>发一条消息并 @ 一个 harness 来派活。首次 @ 会懒创建 bound session。</p>
        </div>`;
      return;
    }

    stream.innerHTML =
      `<div class="day-divider">today · local</div>` +
      list
        .map((m) => {
          if (m.kind === "system") {
            return `
              <article class="msg msg--system" data-msg="${m.id}">
                ${avatarHtml({ avatar: "··", type: "human", id: "sys" }).replace("avatar--human", "avatar--offline")}
                <div class="msg__main">
                  <div class="msg__body">${escapeHtml(m.content)}</div>
                  <div class="msg__time mono" style="margin-top:2px">${escapeHtml(m.created_at)}</div>
                </div>
              </article>`;
          }

          const sender = getMember(m.sender_id) || {
            display_name: m.sender_id,
            avatar: "??",
            type: "human",
          };
          const isHuman = m.kind === "human";
          const isMcp = !isHuman && sender.mode === "B";
          const cls = [
            "msg",
            isHuman ? "msg--human" : isMcp ? "msg--mcp" : "msg--harness",
            m.stream_state === "streaming" ? "is-streaming" : "",
          ]
            .filter(Boolean)
            .join(" ");

          const stateChip =
            !isHuman && m.state
              ? `<span class="msg__state msg__state--${m.state}"><span class="${statusDotClass(m.state === "working" || m.state === "thinking" ? "working" : "online")}"></span>${m.state}</span>`
              : "";

          const sessionTag = m.session_id
            ? `<span class="msg__session">bound · ${escapeHtml(m.session_id)}</span>`
            : "";

          const chips =
            !isHuman && sender.capabilities
              ? `<div class="msg__chips">${sender.capabilities
                  .map((c) => `<span class="chip">${escapeHtml(c)}</span>`)
                  .join("")}</div>`
              : "";

          const body = formatContent(m.content || "");
          const cursor =
            m.stream_state === "streaming" ? `<span class="cursor-blink" aria-hidden="true"></span>` : "";

          return `
            <article class="${cls}" data-msg="${m.id}">
              ${avatarHtml(sender)}
              <div class="msg__main">
                <div class="msg__head">
                  <span class="msg__author">${escapeHtml(sender.display_name)}</span>
                  ${stateChip}
                  <span class="msg__time mono">${escapeHtml(m.created_at)}</span>
                  ${sessionTag}
                </div>
                <div class="msg__body">${body}${cursor}</div>
                ${chips}
              </div>
            </article>`;
        })
        .join("");

    stream.scrollTop = stream.scrollHeight;
  }

  function renderSide() {
    const room = getRoom(state.roomId);
    const agentCards = $("#agent-cards");
    const members = (room ? room.member_ids : [])
      .map((id) => getMember(id))
      .filter(Boolean)
      .filter((m) => !(m.type === "human"));

    if (!members.length) {
      agentCards.innerHTML = `<div class="empty-note">此房间还没有 harness。把 plugin 拉进房间后，首次 @ 会自动建立 bound session。</div>`;
    } else {
      agentCards.innerHTML = members
        .map((h) => {
          const bs = getBound(state.roomId, h.id);
          const modeCls = h.mode === "B" ? "mode-tag mode-tag--b" : "mode-tag mode-tag--a";
          const routed = h.status === "working" ? "is-routed" : "";
          const mcpRouted = h.mode === "B" ? "agent-card--mcp" : "";
          return `
            <div class="agent-card ${routed} ${mcpRouted}" data-agent="${h.id}">
              <div class="agent-card__top">
                ${avatarHtml(h)}
                <div class="agent-card__name">${escapeHtml(h.display_name)}</div>
                <span class="${modeCls}">${h.mode === "B" ? "B" : "A"}</span>
              </div>
              <div class="agent-card__row">
                <span>${h.mode === "B" ? "MCP tools" : "WS plugin"}</span>
                <span class="${statusDotClass(h.status)}"></span>
              </div>
              <div class="agent-card__row" style="margin-top:4px">
                <span>${bs ? escapeHtml(bs.external_session_ref) : "无 session · 懒创建"}</span>
                <span>${escapeHtml(h.status)}</span>
              </div>
              <div class="agent-card__caps">
                ${h.capabilities.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join("")}
              </div>
            </div>`;
        })
        .join("");
    }

    const boundList = $("#bound-list");
    const bounds = Object.values(boundSessions).filter((b) => b.room_id === state.roomId);
    if (!bounds.length) {
      boundList.innerHTML = `<div class="bound-empty">尚无 bound session。第一次 @harness 时 lazy 创建，映射持久化到 Lobby。</div>`;
    } else {
      boundList.innerHTML = bounds
        .map((b) => {
          const h = getMember(b.harness_id);
          return `
            <div class="bound-item">
              <div class="bound-item__top">
                <span class="bound-item__id">${escapeHtml(b.id)}</span>
                <span class="mode-tag ${h && h.mode === "B" ? "mode-tag--b" : "mode-tag--a"}">${h ? h.mode : "A"}</span>
              </div>
              <div class="bound-item__meta">
                room · ${escapeHtml(b.room_id)}<br/>
                harness · ${escapeHtml(h ? h.slug : b.harness_id)}<br/>
                external · ${escapeHtml(b.external_session_ref)}<br/>
                created · ${escapeHtml(b.created_at)}
              </div>
            </div>`;
        })
        .join("");
    }

    const act = $("#activity");
    act.innerHTML = activity
      .slice()
      .reverse()
      .map(
        (a) => `
        <div class="act-item">
          <span class="act-item__pip act-item__pip--${a.kind}"></span>
          <div class="act-item__text">${a.text}<span class="act-item__time">${escapeHtml(a.time)}</span></div>
        </div>`
      )
      .join("");
  }

  function renderAll() {
    renderRail();
    renderStream();
    renderSide();
  }

  function pushActivity(text, kind = "route") {
    activity.push({ text, kind, time: nowHM() });
    renderSide();
  }

  function toast(msg, ms = 2200) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.hidden = true;
    }, ms);
  }

  // ── Signature: route beam ─────────────────────────────────
  function fireRouteBeam(fromEl, toEl) {
    if (!fromEl || !toEl) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    const x1 = a.right - 8;
    const y1 = a.top + a.height / 2;
    const x2 = b.left + 8;
    const y2 = b.top + b.height / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;

    const beam = document.createElement("div");
    beam.className = "route-beam";
    beam.style.left = `${x1}px`;
    beam.style.top = `${y1}px`;
    beam.style.width = `${len}px`;
    beam.style.transform = `rotate(${ang}deg) scaleX(0.2)`;
    document.body.appendChild(beam);
    requestAnimationFrame(() => {
      beam.classList.add("is-firing");
      beam.style.transform = `rotate(${ang}deg)`;
    });
    setTimeout(() => beam.remove(), 750);
  }

  // ── Simulated harness workers ─────────────────────────────
  const fakeReplies = {
    "minimax-code": (task) =>
      `已接入本房间 bound session。\n\n任务：${task}\n\n处理步骤：\n1. 读取房间上下文（context_snapshot）\n2. 在 harness session 内规划\n3. 流式回写结果\n\n\`\`\`\nstatus.update → working\nmessage.stream → deltas…\nmessage.final → done\n\`\`\`\n完成。需要我继续拆子任务吗？`,
    "claude-code": (task) =>
      `收到派活。\n\n> ${task}\n\n我已切换到该 room 的独立 session，不会串到其他房间。\n\n建议产物：\n- 变更说明\n- 影响面\n- 可回滚步骤\n\n（Mode A · plugin 已推送 task.new，含 context_snapshot）`,
    "cursor-mcp": (task) =>
      `Mode B · 通过 \`listen_messages\` 取到任务。\n\n任务：${task}\n\n我先调用 \`fetch_room_context(session_ref, limit=20)\` 拉历史，再处理并用 \`send_message\` 回流。\n\n结果已写回 room queue。`,
  };

  function simulateMention(slug, taskText) {
    const h = getHarnessBySlug(slug);
    if (!h) return;

    // offline check
    if (h.status === "offline") {
      pushActivity(
        `<strong>${escapeHtml(h.display_name)}</strong> 离线 · 任务已挂起（Mode A 重连补齐）`,
        "human"
      );
      toast(`${h.display_name} 离线，任务已挂起`);
      return;
    }

    const existing = getBound(state.roomId, h.id);
    const bs = ensureBound(state.roomId, h.id);
    const firstBind = !existing;

    // highlight agent card
    const card = document.querySelector(`[data-agent="${h.id}"]`);
    const lastHumanMsg = $("#stream").querySelector(".msg--human:last-of-type");
    if (card) {
      card.classList.add("is-routed");
      if (h.mode === "B") card.classList.add("agent-card--mcp");
      fireRouteBeam(lastHumanMsg || $("#composer-input"), card);
    }

    h.status = "working";
    renderRail();
    renderSide();

    if (firstBind) {
      h._boundOnce = true;
      pushActivity(
        `<strong>${escapeHtml(h.display_name)}</strong> 绑定 session <span class="mono">${escapeHtml(bs.id)}</span> → <span class="mono">${escapeHtml(bs.external_session_ref)}</span>`,
        h.mode === "B" ? "mcp" : "route"
      );
    } else {
      pushActivity(
        `路由 task.new → <strong>${escapeHtml(h.display_name)}</strong> · <span class="mono">${escapeHtml(bs.id)}</span>`,
        h.mode === "B" ? "mcp" : "route"
      );
    }

    // create streaming message shell
    const msgId = uid("m");
    const full = (fakeReplies[slug] || ((t) => `已处理：${t}`))(taskText || "（空任务）");
    const msg = {
      id: msgId,
      kind: h.mode === "B" ? "mcp" : "harness",
      sender_id: h.id,
      content: "",
      mentions: [],
      created_at: nowHM(),
      stream_state: "streaming",
      session_id: bs.id,
      state: h.mode === "B" ? "thinking" : "thinking",
    };
    messages[state.roomId] = messages[state.roomId] || [];
    messages[state.roomId].push(msg);
    renderStream();

    // phase: thinking → working → stream tokens
    const timers = state.streamTimers;
    const clearAll = () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
    void clearAll;

    const t1 = setTimeout(() => {
      msg.state = "working";
      renderStream();
      pushActivity(
        `<strong>${escapeHtml(h.display_name)}</strong> status.update → working`,
        h.mode === "B" ? "mcp" : "route"
      );

      let i = 0;
      const step = () => {
        // stream in chunks of ~3–8 chars
        const n = 3 + Math.floor(Math.random() * 6);
        msg.content = full.slice(0, i + n);
        i = i + n;
        if (i < full.length) {
          renderStream();
          const t = setTimeout(step, 28 + Math.random() * 40);
          timers.add(t);
        } else {
          msg.content = full;
          msg.stream_state = "final";
          msg.state = "idle";
          h.status = "online";
          renderAll();
          pushActivity(
            `<strong>${escapeHtml(h.display_name)}</strong> message.final · 已回写 room`,
            h.mode === "B" ? "mcp" : "route"
          );
          if (card) card.classList.remove("is-routed");
        }
      };
      const t2 = setTimeout(step, 280);
      timers.add(t2);
    }, 650);
    timers.add(t1);
  }

  // ── Composer + mention autocomplete ───────────────────────
  const input = $("#composer-input");
  const mentionMenu = $("#mention-menu");

  function roomHarnesses() {
    const room = getRoom(state.roomId);
    return (room ? room.member_ids : [])
      .map((id) => getMember(id))
      .filter((m) => m && !(m.type === "human"));
  }

  function updateMentionMenu() {
    const val = input.value;
    const caret = input.selectionStart;
    const before = val.slice(0, caret);
    const match = before.match(/@([a-z0-9-]*)$/i);
    if (!match) {
      state.mentionQuery = null;
      mentionMenu.hidden = true;
      return;
    }
    state.mentionQuery = match[1].toLowerCase();
    const opts = roomHarnesses().filter((h) => h.slug.includes(state.mentionQuery));
    if (!opts.length) {
      mentionMenu.hidden = true;
      return;
    }
    state.mentionIndex = Math.min(state.mentionIndex, opts.length - 1);
    mentionMenu.innerHTML = opts
      .map((h, idx) => {
        const active = idx === state.mentionIndex ? "is-active" : "";
        return `
          <button type="button" class="mention-opt ${active}" data-slug="${h.slug}">
            ${avatarHtml(h)}
            <span class="mention-opt__name">@${escapeHtml(h.slug)}</span>
            <span class="mention-opt__desc">${h.mode === "B" ? "Mode B · MCP" : "Mode A · Plugin"} · ${escapeHtml(h.display_name)}</span>
          </button>`;
      })
      .join("");
    mentionMenu.hidden = false;
  }

  function applyMention(slug) {
    const val = input.value;
    const caret = input.selectionStart;
    const before = val.slice(0, caret).replace(/@([a-z0-9-]*)$/i, `@${slug} `);
    const after = val.slice(caret);
    input.value = before + after;
    const pos = before.length;
    input.setSelectionRange(pos, pos);
    input.focus();
    state.mentionQuery = null;
    mentionMenu.hidden = true;
  }

  function extractMentions(text) {
    const out = [];
    const re = /@([a-z0-9-]+)/gi;
    let m;
    while ((m = re.exec(text))) {
      if (getHarnessBySlug(m[1]) || humans.some((h) => h.slug === m[1])) out.push(m[1]);
    }
    return out;
  }

  function sendMessage() {
    const text = input.value.trim();
    if (!text) return;

    const mentions = extractMentions(text);
    const msg = {
      id: uid("m"),
      kind: "human",
      sender_id: "u_owner",
      content: text,
      mentions,
      created_at: nowHM(),
    };
    messages[state.roomId] = messages[state.roomId] || [];
    messages[state.roomId].push(msg);
    input.value = "";
    input.style.height = "auto";
    renderStream();
    pushActivity(`<strong>You</strong> 发送消息 · mentions: ${mentions.join(", ") || "—"}`, "human");

    // route each mentioned harness (unique, order of appearance)
    const seen = new Set();
    mentions.forEach((slug, idx) => {
      if (seen.has(slug)) return;
      seen.add(slug);
      const h = getHarnessBySlug(slug);
      if (!h) return;
      // ensure in room
      const room = getRoom(state.roomId);
      if (room && !room.member_ids.includes(h.id)) {
        room.member_ids.push(h.id);
        pushActivity(
          `<strong>${escapeHtml(h.display_name)}</strong> 被拉入房间并 lazy 建 session`,
          h.mode === "B" ? "mcp" : "route"
        );
      }
      setTimeout(() => simulateMention(slug, text.replace(/@([a-z0-9-]+)/gi, "").trim()), 120 + idx * 400);
    });
  }

  // ── Modals ────────────────────────────────────────────────
  function openModal(title, bodyHtml) {
    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = bodyHtml;
    $("#modal-root").hidden = false;
  }

  function closeModal() {
    $("#modal-root").hidden = true;
  }

  function modalRegistry() {
    const rows = harnesses
      .map(
        (h) => `
        <tr>
          <td>
            <strong>${escapeHtml(h.display_name)}</strong><br/>
            <span class="mono">${escapeHtml(h.slug)}</span>
          </td>
          <td><span class="mode-tag ${h.mode === "B" ? "mode-tag--b" : "mode-tag--a"}">Mode ${h.mode}</span></td>
          <td><span class="${statusDotClass(h.status)}"></span> ${escapeHtml(h.status)}</td>
          <td class="mono">${escapeHtml(h.plugin_endpoint)}</td>
          <td class="mono">${escapeHtml(h.auth_token)}</td>
        </tr>`
      )
      .join("");

    openModal(
      "Harness 注册表 · Plugin Registry",
      `
      <table class="registry-table">
        <thead>
          <tr>
            <th>Harness</th><th>Mode</th><th>Status</th><th>Endpoint</th><th>Token</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="contract-block">
        <pre>Mode A · register_lobby(token, profile) → { lobby_id, ws_url, assigned_rooms[] }

Lobby → Plugin
  task.new { room_id, message_id, mentions[], context_snapshot }
  room.message { room_id, content, sender }

Plugin → Lobby
  session.bind { room_id, external_session_ref }
  message.stream { room_id, delta, message_id }
  message.final { room_id, content, message_id }
  status.update { room_id, state }

Mode B · MCP tools
  register_harness(profile) → { harness_id, status }
  list_rooms() / join_room(room_id) → session_ref
  listen_messages(session_ref, since?) → messages[]
  fetch_room_context(session_ref, limit) → messages[]
  send_message(session_ref, content, mentions?) → { message_id }
  update_status(session_ref, status) / leave_room(session_ref)</pre>
      </div>
      `
    );
  }

  function modalNewRoom() {
    openModal(
      "新建房间",
      `
      <div class="form-grid">
        <div class="field">
          <label>房间主题 topic</label>
          <input id="nr-topic" placeholder="例如：仿真回归" />
        </div>
        <div class="field">
          <label>初始 members（可后补）</label>
          <input id="nr-members" value="you, minimax-code" />
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn--ghost" data-close-modal>取消</button>
        <button type="button" class="btn btn--primary" id="nr-submit">创建房间</button>
      </div>
      `
    );
    $("#nr-submit").onclick = () => {
      const topic = ($("#nr-topic").value || "untitled").trim();
      const slugs = ($("#nr-members").value || "you")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const member_ids = ["u_owner"];
      slugs.forEach((s) => {
        const m = getHarnessBySlug(s) || humans.find((h) => h.slug === s);
        if (m && !member_ids.includes(m.id)) member_ids.push(m.id);
      });
      const room = {
        id: uid("r"),
        topic,
        member_ids,
        created_at: new Date().toISOString(),
      };
      rooms.push(room);
      messages[room.id] = [
        {
          id: uid("m"),
          kind: "system",
          content: `房间「${topic}」已创建 · members: ${member_ids.length}`,
          created_at: nowHM(),
        },
      ];
      state.roomId = room.id;
      closeModal();
      renderAll();
      toast("房间已创建");
      pushActivity(`创建房间 <strong>${escapeHtml(topic)}</strong>`, "human");
    };
  }

  function modalAddHarness() {
    openModal(
      "添加 Harness",
      `
      <div class="form-grid">
        <div class="field">
          <label>显示名</label>
          <input id="nh-name" placeholder="Cline" />
        </div>
        <div class="field">
          <label>slug（@ 用）</label>
          <input id="nh-slug" placeholder="cline" />
        </div>
        <div class="field">
          <label>接入模式</label>
          <select id="nh-mode">
            <option value="A">Mode A · WS Plugin</option>
            <option value="B">Mode B · MCP</option>
          </select>
        </div>
        <div class="field">
          <label>能力描述</label>
          <input id="nh-caps" value="读文件, 跑命令" />
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn--ghost" data-close-modal>取消</button>
        <button type="button" class="btn btn--primary" id="nh-submit">生成 install token</button>
      </div>
      `
    );
    $("#nh-submit").onclick = () => {
      const name = ($("#nh-name").value || "Harness").trim();
      const slug = ($("#nh-slug").value || name.toLowerCase().replace(/\s+/g, "-")).trim();
      const mode = $("#nh-mode").value;
      const caps = ($("#nh-caps").value || "读文件")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const token = `ilv_${slug.slice(0, 8)}_${Math.random().toString(36).slice(2, 6)}…${Math.random()
        .toString(36)
        .slice(2, 4)}`;
      harnesses.push({
        id: uid("h"),
        slug,
        display_name: name,
        avatar: slug.slice(0, 2).toUpperCase(),
        mode,
        status: "online",
        plugin_endpoint: mode === "B" ? "mcp://lobby/mode-b" : `ws://127.0.0.1:43${20 + harnesses.length}/plugin`,
        capabilities: caps,
        auth_token: token,
      });
      fakeReplies[slug] = fakeReplies["minimax-code"];
      openModal(
        "Install Token",
        `
        <p style="margin:0 0 10px;color:var(--haze)">在 harness 环境执行：</p>
        <div class="token-box">harness-lobby connect --token=${escapeHtml(token)}</div>
        <p style="margin:12px 0 0;color:var(--haze);font-size:12.5px">
          Mode A 将建立 WebSocket 握手；Mode B 会把 lobby 暴露为 MCP server。
          握手成功后状态变绿，拉入 room 即可派活。
        </p>
        <div class="modal-actions">
          <button type="button" class="btn btn--primary" data-close-modal>完成</button>
        </div>
        `
      );
      renderAll();
      pushActivity(`注册 harness <strong>${escapeHtml(name)}</strong> · Mode ${mode}`, mode === "B" ? "mcp" : "route");
    };
  }

  function modalConnectFlow() {
    openModal(
      "首次接入 Harness",
      `
      <div class="steps" id="connect-steps">
        <div class="step is-active" data-step="0">
          <div class="step__n">01</div>
          <div>
            <div class="step__title">在 Lobby 创建 Harness</div>
            <div class="step__desc">填写名称、图标、能力描述 → 生成 install token</div>
          </div>
        </div>
        <div class="step" data-step="1">
          <div class="step__n">02</div>
          <div>
            <div class="step__title">执行 harness-lobby connect --token=xxx</div>
            <div class="step__desc">Mode A 走 WS 握手；Mode B 注册 MCP tools</div>
          </div>
        </div>
        <div class="step" data-step="2">
          <div class="step__n">03</div>
          <div>
            <div class="step__title">注册成功 · UI 状态变绿</div>
            <div class="step__desc">plugin registry 写入 harness_id 与 endpoint</div>
          </div>
        </div>
        <div class="step" data-step="3">
          <div class="step__n">04</div>
          <div>
            <div class="step__title">拉进目标 room · lazy 创建 bound session</div>
            <div class="step__desc">映射 (room_id, harness_id) → BoundSession 持久化</div>
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn--primary" id="cf-next">模拟下一步</button>
      </div>
      `
    );
    let step = 0;
    $("#cf-next").onclick = () => {
      step += 1;
      $$("#connect-steps .step").forEach((el, i) => {
        el.classList.toggle("is-done", i < step);
        el.classList.toggle("is-active", i === step);
      });
      if (step >= 4) {
        toast("接入流程演示完毕");
        setTimeout(closeModal, 500);
      }
    };
  }

  function modalRoomDetail() {
    const room = getRoom(state.roomId);
    if (!room) return;
    const members = room.member_ids
      .map((id) => getMember(id))
      .filter(Boolean)
      .map(
        (m) => `
        <div class="detail-row">
          <span>${m.type === "human" ? "human" : "harness"} · ${escapeHtml(m.display_name)}</span>
          <span class="mono">${escapeHtml(m.slug)}</span>
        </div>`
      )
      .join("");
    const bounds = Object.values(boundSessions)
      .filter((b) => b.room_id === room.id)
      .map(
        (b) => `
        <div class="detail-row">
          <span>${escapeHtml(b.id)}</span>
          <span class="mono">${escapeHtml(b.external_session_ref)}</span>
        </div>`
      )
      .join("");

    openModal(
      `房间详情 · ${room.topic}`,
      `
      <div class="detail-row"><span>room_id</span><span class="mono">${escapeHtml(room.id)}</span></div>
      <div class="detail-row"><span>created</span><span class="mono">${escapeHtml(room.created_at)}</span></div>
      <h3 style="margin:16px 0 8px;font-size:12px;color:var(--haze);font-family:var(--font-mono);letter-spacing:.06em;text-transform:uppercase">Members</h3>
      ${members || '<div class="empty-note">无</div>'}
      <h3 style="margin:16px 0 8px;font-size:12px;color:var(--haze);font-family:var(--font-mono);letter-spacing:.06em;text-transform:uppercase">Bound Sessions</h3>
      ${bounds || '<div class="empty-note">尚未创建 · 首次 @harness 时 lazy 创建</div>'}
      <h3 style="margin:16px 0 8px;font-size:12px;color:var(--haze);font-family:var(--font-mono);letter-spacing:.06em;text-transform:uppercase">Context 协议</h3>
      <div class="contract-block">
        <pre>Mode A: context_snapshot 随 task.new 一起推送
Mode B: harness 调 fetch_room_context(session_ref, limit) 拉取

同一份房间数据，两种模式共享。</pre>
      </div>
      `
    );
  }

  // ── Events ────────────────────────────────────────────────
  function bindEvents() {
    $("#room-list").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-room]");
      if (!btn) return;
      state.roomId = btn.dataset.room;
      renderAll();
    });

    $("#btn-send").addEventListener("click", sendMessage);
    $("#btn-new-room").addEventListener("click", modalNewRoom);
    $("#btn-add-harness").addEventListener("click", modalAddHarness);
    $("#btn-registry").addEventListener("click", modalRegistry);
    $("#btn-connect-flow").addEventListener("click", modalConnectFlow);
    $("#btn-room-detail").addEventListener("click", modalRoomDetail);

    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-close-modal]")) closeModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeModal();
        mentionMenu.hidden = true;
      }
    });

    mentionMenu.addEventListener("mousedown", (e) => {
      const opt = e.target.closest("[data-slug]");
      if (!opt) return;
      e.preventDefault();
      applyMention(opt.dataset.slug);
    });

    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
      state.mentionIndex = 0;
      updateMentionMenu();
    });

    input.addEventListener("keydown", (e) => {
      if (!mentionMenu.hidden && state.mentionQuery !== null) {
        const opts = $$(".mention-opt");
        if (e.key === "ArrowDown") {
          e.preventDefault();
          state.mentionIndex = (state.mentionIndex + 1) % opts.length;
          updateMentionMenu();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          state.mentionIndex = (state.mentionIndex - 1 + opts.length) % opts.length;
          updateMentionMenu();
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const slug = opts[state.mentionIndex]?.dataset.slug;
          if (slug) applyMention(slug);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    input.addEventListener("blur", () => {
      setTimeout(() => {
        mentionMenu.hidden = true;
      }, 120);
    });
  }

  // ── Boot ──────────────────────────────────────────────────
  function boot() {
    // seed bound sessions for demo history
    ensureBound("r_embodied", "h_minimax").id = "bs_emb_mm";
    ensureBound("r_embodied", "h_claude").id = "bs_emb_cc";
    ensureBound("r_weekly", "h_minimax").id = "bs_wk_mm";
    Object.values(boundSessions).forEach((b) => {
      const h = getMember(b.harness_id);
      if (h) h._boundOnce = true;
    });

    renderAll();
    bindEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
