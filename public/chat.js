// chat.js (ES module) — maintains a buffer so banner messages also land in chat when returning home
const q = (s) => document.querySelector(s);

let _socket = null;
let _onNewMessage = () => {};
let _roleGetter = () => null;
let _homeHasChat = () => false;
let _floatingOpen = false;

// buffer of messages received while home not visible
const bufferedMessages = [];

export function initChat(socket, { onNewMessage, roleGetter, homeHasChat }) {
  _socket = socket;
  _onNewMessage = onNewMessage || (() => {});
  _roleGetter = roleGetter || (() => null);
  _homeHasChat = homeHasChat || (() => false);

  ensureOverlay();

  // overlay send helper
  const overlaySend = () => {
    const input = document.querySelector("#overlay-input");
    if (!input) return;
    const v = input.value.trim();
    if (!v) return;
    _socket.emit("chat:send", { text: v });
    input.value = "";
  };

  document.addEventListener("click", (e) => {
    if (e.target && e.target.id === "overlay-send") overlaySend();
  });
  document.addEventListener("keydown", (e) => {
    if (e.target && e.target.id === "overlay-input" && e.key === "Enter") overlaySend();
  });

  // home chat send
  const homeSendBtn = document.getElementById("chat-send");
  const homeInput = document.getElementById("chat-text");
  if (homeSendBtn && homeInput) {
    homeSendBtn.addEventListener("click", () => {
      const v = homeInput.value.trim();
      if (!v) return;
      _socket.emit("chat:send", { text: v });
      homeInput.value = "";
    });
    homeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") homeSendBtn.click();
    });
  }

  _socket.on("chat:msg", (payload) => {
    const bubble = createBubble(payload.text, payload.role);

    // If home chat is visible, append directly there and also ensure buffer cleared
    if (_homeHasChat && _homeHasChat()) {
      const log = document.getElementById("chat-log");
      if (log) {
        log.appendChild(bubble);
        log.scrollTop = log.scrollHeight;
      }
    } else {
      // append to overlay log and buffer it so it appears later when user returns to home
      const log = document.querySelector("#overlay-log");
      if (log) {
        log.appendChild(bubble.cloneNode(true));
        log.scrollTop = log.scrollHeight;
      }
      // store in buffer
      bufferedMessages.push(payload);
      _onNewMessage(payload);
      const badge = document.getElementById("chat-badge");
      if (badge) badge.classList.remove("hidden");
    }
  });
}

function createBubble(text, role) {
  const b = document.createElement("div");
  b.className = `chat-bubble ${role === "immu" ? "immu" : "cookie"}`;
  b.textContent = `${role === "immu" ? "Immu" : "Cookie"}: ${text}`;
  return b;
}

export function openChatPanelExternally() {
  const overlay = document.getElementById("chat-overlay");
  if (!overlay) return;
  overlay.style.display = "flex";
  _floatingOpen = true;
  const badge = document.getElementById("chat-badge");
  if (badge) badge.classList.add("hidden");
}

// flush overlay-buffered messages into the home chat log (called when returning to home)
export function flushOverlayToHome() {
  if (!bufferedMessages.length) return;
  const log = document.getElementById("chat-log");
  if (!log) {
    // nothing to flush if there's no home chat
    return;
  }
  for (const m of bufferedMessages) {
    const bubble = createBubble(m.text, m.role);
    log.appendChild(bubble);
  }
  log.scrollTop = log.scrollHeight;
  bufferedMessages.length = 0;
  const badge = document.getElementById("chat-badge");
  if (badge) badge.classList.add("hidden");
}

// create overlay
function ensureOverlay() {
  if (document.querySelector("#chat-overlay")) return;
  const el = document.createElement("div");
  el.id = "chat-overlay";
  el.style.position = "fixed";
  el.style.right = "18px";
  el.style.bottom = "70px";
  el.style.width = "320px";
  el.style.maxHeight = "60dvh";
  el.style.display = "none";
  el.style.flexDirection = "column";
  el.style.gap = "8px";
  el.style.padding = "12px";
  el.style.background = "rgba(12,12,31,.92)";
  el.style.border = "1px solid rgba(255,255,255,.15)";
  el.style.borderRadius = "16px";
  el.style.boxShadow = "0 0 14px rgba(0,255,255,.25)";
  el.style.zIndex = 80;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <strong>Chat</strong>
      <div style="display:flex;gap:8px;">
        <button id="overlay-close" class="btn neon">Close</button>
      </div>
    </div>
    <div id="overlay-log" class="chat-log" style="height: 36dvh; border:1px solid rgba(255,255,255,.12); border-radius:12px; padding:8px; overflow:auto;"></div>
    <div style="display:flex;gap:8px;margin-top:8px;">
      <input id="overlay-input" type="text" placeholder="Type a message…" style="flex:1;background:#0e0e20;border:1px solid rgba(255,255,255,.12);color:#e8f6ff;border-radius:12px;padding:10px 12px;outline:none;" />
      <button id="overlay-send" class="btn neon">Send</button>
    </div>
  `;

  document.body.appendChild(el);

  el.querySelector("#overlay-close").addEventListener("click", () => {
    el.style.display = "none";
    _floatingOpen = false;
  });

  el.querySelector("#overlay-send").addEventListener("click", () => {
    const v = el.querySelector("#overlay-input").value.trim();
    if (!v) return;
    _socket.emit("chat:send", { text: v });
    el.querySelector("#overlay-input").value = "";
  });

  el.querySelector("#overlay-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.querySelector("#overlay-send").click();
  });
}

export function isChatOpen() {
  if (document.querySelector("#screen-home") && !document.querySelector("#screen-home").classList.contains("hidden")) return true;
  const overlay = document.querySelector("#chat-overlay");
  return overlay && overlay.style.display !== "none";
}
