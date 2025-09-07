// main.js (ES module)
import { initChat, openChatPanelExternally, isChatOpen, showUnreadOnFloating, closeChatOverlay, loadChatHistory } from "./chat.js";
import { initTicTacToe, destroyTicTacToe } from "./games/tictactoe.js";

const socket = io();

const q = (s) => document.querySelector(s);

// screens
const screenRole = q("#screen-role");
const screenHome = q("#screen-home");
const screenGames = q("#screen-games");
const screenTTT = q("#screen-ttt");
const screenDetail = q("#screen-game-detail");

// role buttons
const btnImmu = q("#btn-immu");
const btnCookie = q("#btn-cookie");

// home controls
const toGamesBtn = q("#to-games-btn");
const backHomeBtn = q("#back-home");

// detail controls
const detailTitle = q("#detail-title");
const detailRules = q("#detail-rules");
const requestPlayBtn = q("#request-play-btn");
const detailBackBtn = q("#detail-back");
const playTttFromList = q("#play-ttt-from-list");

// ttt controls
const tttTitle = q("#ttt-title");
const btnReset = q("#btn-reset-ttt");
const btnLeave = q("#btn-leave-ttt");

// chat
const chatSend = q("#chat-send");
const chatText = q("#chat-text");
const floatingChat = q("#floating-chat");
const chatBadge = q("#chat-badge");

// banner
const banner = q("#top-banner");
const bannerText = q("#banner-text");

// modal + confirm root
const modal = q("#modal");
const confirmRoot = q("#confirm-root");

// scores
const sImmu = q("#score-immu");
const sCookie = q("#score-cookie");
const sDraws = q("#score-draws");

// presence
const presenceLine = q("#presence-line");
const presenceSub = q("#presence-sub");

let myRole = null;
let roomId = "default";
let currentGame = null;
let tttMounted = false;
let otherConnected = false;
let pendingRequest = false;

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }
function gotoRole() {
  hide(screenHome); hide(screenGames); hide(screenTTT); hide(screenDetail);
  destroyTicTacToe();
  hide(floatingChat);
  show(screenRole);
}
function gotoHome() {
  currentGame = null;
  destroyTicTacToe();
  hide(screenRole); hide(screenGames); hide(screenTTT); hide(screenDetail);
  show(screenHome);
  hide(floatingChat);
  closeChatOverlay();
  updateHomeTitle();
  
  // Load chat history when returning to home
  loadChatHistory();
}
function gotoGames() {
  currentGame = null;
  destroyTicTacToe();
  hide(screenRole); hide(screenHome); hide(screenTTT); hide(screenDetail);
  show(screenGames);
  hide(floatingChat);
}
function gotoGameDetail(game) {
  hide(screenRole); hide(screenHome); hide(screenTTT); hide(screenGames);
  show(screenDetail);
  hide(floatingChat);
  if (game === "tictactoe") {
    detailTitle.textContent = "Tic Tac Toe";
    detailRules.innerHTML = `
      <p>Two players: Immu and Cookie. Players take turns placing their mark. Immu goes first.</p>
      <p>First to align three in a row (horizontal, vertical or diagonal) wins. If the board fills with no winner, it's a draw.</p>
      <p style="margin-top:12px;">Click Request Play to invite the other player.</p>
    `;
    requestPlayBtn.dataset.game = "tictactoe";
  }
  
  // Update request button state based on connection status
  updateRequestPlayButtonState();
}
function gotoTTT() {
  currentGame = "ttt";
  hide(screenRole); hide(screenHome); hide(screenGames); hide(screenDetail);
  show(screenTTT);
  show(floatingChat);
}

// Update request play button state based on connection status
function updateRequestPlayButtonState() {
  if (!requestPlayBtn) return;
  
  if (otherConnected) {
    requestPlayBtn.disabled = false;
    requestPlayBtn.classList.remove("disabled");
    requestPlayBtn.title = "";
  } else {
    requestPlayBtn.disabled = true;
    requestPlayBtn.classList.add("disabled");
    requestPlayBtn.title = "Other player is not connected";
  }
}

// banner helper
let bannerTimer = null;
function showBannerMessage(text) {
  bannerText.textContent = text.length > 140 ? text.slice(0,140) + "…" : text;
  show(banner);
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => hide(banner), 4500);
  showUnreadBadge();
}
function showUnreadBadge() {
  chatBadge.classList.remove("hidden");
}
function clearUnreadBadge() {
  chatBadge.classList.add("hidden");
}

// confirm helper (returns a Promise)
function askConfirm(title, text = "Are you sure?") {
  return new Promise((resolve) => {
    confirmRoot.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-card">
          <h3 style="margin:0 0 12px;">${title}</h3>
          <p style="margin:0 0 12px;">${text}</p>
          <div style="display:flex;gap:8px;justify-content:center;">
            <button id="confirm-yes" class="btn neon">Yes</button>
            <button id="confirm-no" class="btn neon ghost">No</button>
          </div>
        </div>
      </div>
    `;
    confirmRoot.classList.remove("hidden");
    confirmRoot.querySelector("#confirm-no").addEventListener("click", () => {
      confirmRoot.classList.add("hidden");
      confirmRoot.innerHTML = "";
      resolve(false);
    });
    confirmRoot.querySelector("#confirm-yes").addEventListener("click", () => {
      confirmRoot.classList.add("hidden");
      confirmRoot.innerHTML = "";
      resolve(true);
    });
  });
}

// Fix layout issues
function fixLayout() {
  // Ensure body takes full height
  document.body.style.height = '100vh';
  document.body.style.display = 'flex';
  document.body.style.flexDirection = 'column';
  
  // Ensure screens take available space
  const screens = document.querySelectorAll('.screen');
  screens.forEach(screen => {
    if (!screen.classList.contains('hidden')) {
      screen.style.flex = '1';
      screen.style.display = 'flex';
      screen.style.flexDirection = 'column';
    }
  });
  
  // Fix home layout specifically
  const homeScreen = document.getElementById('screen-home');
  if (homeScreen && !homeScreen.classList.contains('hidden')) {
    const homeWrap = document.querySelector('.home-wrap');
    if (homeWrap) {
      homeWrap.style.flex = '1';
      homeWrap.style.minHeight = '0';
    }
    
    const hub = document.querySelector('.hub');
    if (hub) {
      hub.style.overflowY = 'auto';
    }
  }
}

// socket event wiring
socket.on("connect", () => {
  socket.emit("room:hello", { room: roomId });
  fixLayout();
});

// room full
socket.on("room:full", () => {
  show(modal);
});

// role choice / assignment
socket.on("role:choose", (availability) => {
  gotoRole();
  btnImmu.disabled = !availability.immuFree;
  btnCookie.disabled = !availability.cookieFree;
  fixLayout();
});
socket.on("role:autoAssigned", ({ role }) => {
  myRole = role;
  gotoHome();
  updateHomeTitle();
  fixLayout();
});
socket.on("role:confirmed", ({ role }) => {
  myRole = role;
  gotoHome();
  updateHomeTitle();
  fixLayout();
});

// presence updates
socket.on("presence:update", ({ immuOnline, cookieOnline }) => {
  // could use if needed
});
socket.on("presence:status", ({ you, otherConnected: connected, otherName }) => {
  otherConnected = connected;
  
  if (connected) {
    presenceLine.textContent = `${otherName} is connected.`;
    presenceSub.textContent = `You are playing as ${you === "immu" ? "Immu" : "Cookie"}.`;
  } else {
    presenceLine.textContent = `Waiting for ${otherName}…`;
    presenceSub.textContent = `You are ${you === "immu" ? "Immu" : "Cookie"} — waiting.`;
  }
  
  // Update request play button state if on game detail screen
  if (!screenDetail.classList.contains("hidden")) {
    updateRequestPlayButtonState();
  }
});

// scores update
socket.on("scores:update", ({ immu, cookie, draws }) => {
  sImmu.textContent = immu ?? 0;
  sCookie.textContent = cookie ?? 0;
  sDraws.textContent = draws ?? 0;
});

// request cleared
socket.on("request:cleared", () => {
  pendingRequest = false;
});

// chat hooks
initChat(socket, {
  onNewMessage(msg) {
    // NOTE: chat.js now appends to #chat-log only when home is visible.
    // Here we only show banner/unread for non-home screens.
    if (!screenHome || screenHome.classList.contains("hidden")) {
      showBannerMessage(`${msg.role === "immu" ? "Immu" : "Cookie"}: ${msg.text}`);
    } else {
      // if on home, ensure unread badge is cleared when they're in chat
      clearUnreadBadge();
    }
  },
  roleGetter: () => myRole,
  homeHasChat: () => !screenHome.classList.contains("hidden")
});

// Game selection flow
requestPlayBtn.addEventListener("click", () => {
  const gameName = requestPlayBtn.dataset.game;
  if (pendingRequest || !otherConnected) return;
  socket.emit("game:selectionRequest", { gameName });
  pendingRequest = true;
  showBannerMessage("Play request sent — waiting for opponent");
});
socket.on("game:selectionPending", () => {
  showBannerMessage("Play request pending...");
});
socket.on("game:selectionOffer", async ({ reqId, fromRole, gameName }) => {
  const accept = await askConfirm("Game invite", `${fromRole === "immu" ? "Immu" : "Cookie"} invited you to play ${gameName}. Accept?`);
  socket.emit("game:selectionResponse", { reqId, accept });
});
socket.on("game:selectionDenied", ({ by }) => {
  pendingRequest = false;
  showBannerMessage(`${by} declined the game request`);
});
socket.on("game:start", ({ players, state, gameName }) => {
  pendingRequest = false;
  gotoTTT();
  initTicTacToe(socket, myRole);
  showBannerMessage("Game started!");
  fixLayout();
});

// leave game - UPDATED HANDLING
btnLeave.addEventListener("click", async () => {
  if (pendingRequest) return;
  const ok = await askConfirm("Leave game", "Are you sure? This will return both players to the home screen.");
  if (!ok) return;
  pendingRequest = true;
  socket.emit("game:leave", {});
});

// UPDATED: Player left handling
socket.on("game:playerLeft", ({ who, duringGame }) => {
  pendingRequest = false;
  showBannerMessage(`${who} left the game`);
  
  // If during game, force return to home
  if (duringGame) {
    gotoHome();
  }
});

// opponent left
socket.on("opponent:left", ({ who }) => {
  showBannerMessage(`${who} left the game`);
});

// UPDATED: Ensure we always return to home on leave
socket.on("game:returnToList", () => {
  setTimeout(() => {
    gotoHome();
    fixLayout();
  }, 400);
});

// restart
btnReset.addEventListener("click", async () => {
  if (pendingRequest) return;
  const ok = await askConfirm("Request restart", "The other player needs to accept.");
  if (!ok) return;
  pendingRequest = true;
  socket.emit("ttt:requestRestart");
});
socket.on("ttt:restartOffer", async ({ rid, fromRole }) => {
  const accept = await askConfirm("Restart requested", `${fromRole === "immu" ? "Immu" : "Cookie"} asked to restart. Accept?`);
  socket.emit("ttt:restartResponse", { rid, accept });
});
socket.on("ttt:restartPending", () => showBannerMessage("Restart requested — waiting"));
socket.on("ttt:restartDenied", ({ by }) => { pendingRequest = false; showBannerMessage(`${by} denied restart`); });
socket.on("ttt:restartAccepted", () => { pendingRequest = false; showBannerMessage("Restart accepted — board reset"); });

// chat send wiring
chatSend.addEventListener("click", () => {
  const v = chatText.value.trim();
  if (!v) return;
  socket.emit("chat:send", { text: v });
  chatText.value = "";
});
chatText.addEventListener("keydown", (e) => {
  if (e.key === "Enter") chatSend.click();
});

// floating chat
floatingChat.addEventListener("click", () => {
  openChatPanelExternally();
  clearUnreadBadge();
});

// nav
toGamesBtn.addEventListener("click", () => {
  gotoGames();
  fixLayout();
});
backHomeBtn.addEventListener("click", () => {
  gotoHome();
  fixLayout();
});
if (detailBackBtn) detailBackBtn.addEventListener("click", () => {
  gotoGames();
  fixLayout();
});

// game list -> detail
if (playTttFromList) {
  playTttFromList.addEventListener("click", () => {
    gotoGameDetail("tictactoe");
    fixLayout();
  });
}

// role picks
btnImmu.addEventListener("click", () => {
  socket.emit("role:pick", { role: "immu" });
  fixLayout();
});
btnCookie.addEventListener("click", () => {
  socket.emit("role:pick", { role: "cookie" });
  fixLayout();
});

// update home screen header
function updateHomeTitle() {
  const header = q("#home-title");
  if (!header) return;
  if (!myRole) {
    header.textContent = "Games";
    return;
  }
  header.textContent = `Hi ${myRole === "immu" ? "Immu" : "Cookie"}`;
}

// Initialize request play button state
updateRequestPlayButtonState();

// Add resize listener
window.addEventListener('resize', fixLayout);

// Initialize layout
document.addEventListener('DOMContentLoaded', () => {
  fixLayout();
});
