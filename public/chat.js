// chat.js (ES module)
// Unified chat module: messages append to the single #chat-log only when home is visible,
// overlay exists for quick access, unread badge helpers and buffering behavior.
const q = (s) => document.querySelector(s);

let _socket = null;
let _onNewMessage = () => {};
let _roleGetter = () => null;
let _homeHasChat = () => false;
let _floatingOpen = false;

// expose a small buffer (not required for functionality but useful)
const bufferedMessages = [];
let _chatHistory = [];

/**
 * initChat(socket, { onNewMessage, roleGetter, homeHasChat })
 * - socket: Socket.IO socket
 * - onNewMessage: callback(payload) when a new message arrives (useful for banner)
 * - roleGetter: () => "immu"|"cookie"|null
 * - homeHasChat: () => boolean (whether home chat area is visible)
 */
export function initChat(socket, { onNewMessage, roleGetter, homeHasChat } = {}) {
  _socket = socket;
  _onNewMessage = onNewMessage || (() => {});
  _roleGetter = roleGetter || (() => null);
  _homeHasChat = homeHasChat || (() => false);

  ensureOverlay();

  // wire home chat send (if present)
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

  // overlay send bindings are created in ensureOverlay

  // receive chat messages
  _socket.on("chat:msg", (payload) => {
    // Store message in history
    _chatHistory.push(payload);
    
    // If home chat is visible, append to the home chat log
    const mainLog = document.getElementById("chat-log");
    const overlayLog = document.getElementById("overlay-log");

    if (_homeHasChat && _homeHasChat() && mainLog) {
      // append to home chat log (single source of truth on home)
      mainLog.appendChild(createBubble(payload.text, payload.role));
      mainLog.scrollTop = mainLog.scrollHeight;
    } else {
      // not on home - append to overlay if present
      if (overlayLog) {
        overlayLog.appendChild(createBubble(payload.text, payload.role));
        overlayLog.scrollTop = overlayLog.scrollHeight;
      } else {
        // buffer in case overlay is opened later
        bufferedMessages.push(payload);
      }
    }

    // Call external hook (main.js uses this to show banner when not on home)
    _onNewMessage(payload);

    // If not currently viewing home chat or overlay is closed, show unread badge
    if (!_homeHasChat() && !_floatingOpen) {
      const badge = document.getElementById("chat-badge");
      if (badge) badge.classList.remove("hidden");
    }
  });
}

// Create a DOM bubble
function createBubble(text, role) {
  const b = document.createElement("div");
  b.className = `chat-bubble ${role === "immu" ? "immu" : "cookie"}`;
  b.textContent = `${role === "immu" ? "Immu" : "Cookie"}: ${text}`;
  return b;
}

// Show chat overlay (floating)
export function openChatPanelExternally() {
  const overlay = document.getElementById("chat-overlay");
  if (!overlay) return;
  overlay.style.display = "flex";
  _floatingOpen = true;

  // flush badge
  const badge = document.getElementById("chat-badge");
  if (badge) badge.classList.add("hidden");

  // add any buffered messages into overlay log
  const overlayLog = document.getElementById("overlay-log");
  if (overlayLog && bufferedMessages.length) {
    bufferedMessages.forEach(p => {
      overlayLog.appendChild(createBubble(p.text, p.role));
    });
    overlayLog.scrollTop = overlayLog.scrollHeight;
    bufferedMessages.length = 0;
  }
}

// Create a function to close the chat overlay
export function closeChatOverlay() {
  const overlay = document.getElementById("chat-overlay");
  if (!overlay) return;
  overlay.style.display = "none";
  _floatingOpen = false;
}

// Load chat history into home chat
export function loadChatHistory() {
  const mainLog = document.getElementById("chat-log");
  if (mainLog && _chatHistory.length) {
    mainLog.innerHTML = '';
    _chatHistory.forEach(p => {
      mainLog.appendChild(createBubble(p.text, p.role));
    });
    mainLog.scrollTop = mainLog.scrollHeight;
  }
}

// Create overlay panel if missing
function ensureOverlay() {
  if (document.querySelector("#chat-overlay")) return;

  const el = document.createElement("div");
  el.id = "chat-overlay";
  // basic positioning & style; keep inline to avoid CSS dependency
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
      <strong style="font-family:DotGothic16">Chat</strong>
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

  // Load chat history into overlay
  const overlayLog = document.getElementById("overlay-log");
  if (overlayLog && _chatHistory.length) {
    _chatHistory.forEach(p => {
      overlayLog.appendChild(createBubble(p.text, p.role));
    });
    overlayLog.scrollTop = overlayLog.scrollHeight;
  }

  // wire close button
  el.querySelector("#overlay-close").addEventListener("click", () => {
    el.style.display = "none";
    _floatingOpen = false;
  });

  // overlay send
  el.querySelector("#overlay-send").addEventListener("click", () => {
    const v = el.querySelector("#overlay-input").value.trim();
    if (!v) return;
    _socket.emit("chat:send", { text: v });
    el.querySelector("#overlay-input").value = "";
  });

  // overlay enter key
  el.querySelector("#overlay-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.querySelector("#overlay-send").click();
  });
}

// Returns true if either home chat is visible or overlay open
export function isChatOpen() {
  if (document.querySelector("#screen-home") && !document.querySelector("#screen-home").classList.contains("hidden")) return true;
  const overlay = document.querySelector("#chat-overlay");
  return overlay && overlay.style.display !== "none";
}

// show unread on floating badge
export function showUnreadOnFloating() {
  const badge = document.getElementById("chat-badge");
  if (badge) badge.classList.remove("hidden");
}
