// main.js (ES module)
import { initChat, openChatPanelExternally, isChatOpen, flushOverlayToHome } from "./chat.js";
import { initTicTacToe, destroyTicTacToe } from "./games/tictactoe.js";

const socket = io();

const q = (s) => document.querySelector(s);

// screens
const screenRole = q("#screen-role");
const screenHome = q("#screen-home");
const screenGames = q("#screen-games");
const screenGameDetail = q("#screen-game-detail");
const screenTTT = q("#screen-ttt");

// role buttons
const btnImmu = q("#btn-immu");
const btnCookie = q("#btn-cookie");

// home controls
const startTttBtn = q("#start-ttt");
const toGamesBtn = q("#to-games-btn");
const playTttFromList = q("#play-ttt-from-list");
const backHomeBtn = q("#back-home");

// game detail
const detailTitle = q("#detail-title");
const detailRules = q("#detail-rules");
const requestPlayBtn = q("#request-play-btn");
const detailBackBtn = q("#detail-back");

// ttt controls
const tttGrid = q("#ttt-grid");
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
const modalClose = q("#modal-close");
const confirmRoot = q("#confirm-root");

// scores
const sImmu = q("#score-immu");
const sCookie = q("#score-cookie");
const sDraws = q("#score-draws");
const homeTitle = q("#home-title");
const homeBrandInline = q("#home-brand-inline");

let myRole = null;
let roomId = "default";
let currentGame = null;
let tttMounted = false;

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function gotoRole() {
  hide(screenHome); hide(screenGames); hide(screenTTT); hide(screenGameDetail);
  destroyTicTacToe();
  hide(floatingChat);
  show(screenRole);
}
function gotoHome() {
  currentGame = null;
  destroyTicTacToe();
  hide(screenRole); hide(screenGames); hide(screenTTT); hide(screenGameDetail);
  show(screenHome);
  hide(floatingChat);
  // flush overlay chat messages into home chat area
  flushOverlayToHome();
  // show Immu <3 Cookie only on home
  homeBrandInline.style.display = "";
  // set greeting
  if (myRole) {
    homeTitle.textContent = `Hi ${myRole === "immu" ? "Immu" : "Cookie"}`;
  } else {
    homeTitle.textContent = "Hi there";
  }
}
function gotoGames() {
  currentGame = null;
  destroyTicTacToe();
  hide(screenRole); hide(screenHome); hide(screenTTT); hide(screenGameDetail);
  show(screenGames);
  hide(floatingChat);
  homeBrandInline.style.display = "none";
}
function gotoGameDetail(gameId) {
  currentGame = gameId;
  destroyTicTacToe();
  hide(screenRole); hide(screenHome); hide(screenGames); hide(screenTTT);
  show(screenGameDetail);
  hide(floatingChat);
  homeBrandInline.style.display = "none";

  if (gameId === "tictactoe") {
    detailTitle.textContent = "Tic Tac Toe";
    detailRules.innerHTML = `
      <p>Two players: Immu and Cookie. Players take turns placing their mark. Immu goes first.</p>
      <p>First to align three in a row (horizontal, vertical or diagonal) wins. If the board fills with no winner, it's a draw.</p>
      <p style="margin-top:12px;">Click Request Play to invite the other player.</p>
    `;
  }
}
function gotoTTT() {
  currentGame = "ttt";
  hide(screenRole); hide(screenHome); hide(screenGames); hide(screenGameDetail);
  show(screenTTT);
  show(floatingChat);
  homeBrandInline.style.display = "none";
}

// banner helper
let bannerTimer = null;
function showBannerMessage(text) {
  bannerText.textContent = text.length > 140 ? text.slice(0,140) + "…" : text;
  show(banner);
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => hide(banner), 4500);
  chatBadge.classList.remove("hidden");
}
function clearUnreadBadge() {
  chatBadge.classList.add("hidden");
}

// confirm helper
function askConfirm(title, text = "Are you sure?") {
  return new Promise((resolve) => {
    const root = confirmRoot;
    root.innerHTML = `
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
    root.classList.remove("hidden");
    root.querySelector("#confirm-no").addEventListener("click", () => {
      root.classList.add("hidden");
      root.innerHTML = "";
      resolve(false);
    });
    root.querySelector("#confirm-yes").addEventListener("click", () => {
      root.classList.add("hidden");
      root.innerHTML = "";
      resolve(true);
    });
  });
}

// socket wiring
socket.on("connect", () => {
  socket.emit("room:hello", { room: roomId });
});

// room full
socket.on("room:full", () => show(modal));

// role flows
socket.on("role:choose", (availability) => {
  gotoRole();
  btnImmu.disabled = !availability.immuFree;
  btnCookie.disabled = !availability.cookieFree;
});
socket.on("role:autoAssigned", ({ role }) => {
  myRole = role;
  gotoHome();
});
socket.on("role:confirmed", ({ role }) => {
  myRole = role;
  gotoHome();
});

socket.on("presence:update", (info) => {
  // optional presence UI
});

socket.on("scores:update", ({ immu, cookie, draws }) => {
  sImmu.textContent = immu ?? 0;
  sCookie.textContent = cookie ?? 0;
  sDraws.textContent = draws ?? 0;
});

// chat init
initChat(socket, {
  onNewMessage(msg) {
    if (!screenHome || screenHome.classList.contains("hidden")) {
      // show banner, but also keep message buffered in overlay (chat module does that)
      showBannerMessage(`${msg.role === "immu" ? "Immu" : "Cookie"}: ${msg.text}`);
    }
  },
  roleGetter: () => myRole,
  homeHasChat: () => !screenHome.classList.contains("hidden")
});

// Game selection flow
startTttBtn.addEventListener("click", () => {
  gotoGameDetail("tictactoe");
});
playTttFromList.addEventListener("click", () => {
  gotoGameDetail("tictactoe");
});

// request-play from detail
requestPlayBtn.addEventListener("click", () => {
  socket.emit("game:selectionRequest", { gameName: "tictactoe" });
  showBannerMessage("Play request sent — waiting for opponent");
});

socket.on("game:selectionPending", () => showBannerMessage("Play request pending..."));

socket.on("game:selectionOffer", async ({ reqId, fromId, fromRole, gameName }) => {
  const accept = await askConfirm("Game invite", `${fromRole === "immu" ? "Immu" : "Cookie"} invited you to play ${gameName}. Accept?`);
  socket.emit("game:selectionResponse", { reqId, accept });
});

socket.on("game:selectionDenied", ({ by }) => showBannerMessage(`${by} declined the game request`));

socket.on("game:start", ({ players, state, gameName }) => {
  gotoTTT();
  initTicTacToe(socket, myRole);
  showBannerMessage("Game started!");
});

socket.on("game:playerLeft", ({ who }) => {
  showBannerMessage(`${who} left the game — returning to games list`);
  gotoGames();
});

socket.on("game:returnToList", () => {
  setTimeout(() => gotoGames(), 400);
});

// ttt events (handled in game module)
socket.on("ttt:state", (payload) => { /* module handles render via socket listeners */ });
socket.on("ttt:over", (payload) => {
  if (payload.winner) {
    showBannerMessage(`${payload.winner === "immu" ? "Immu" : "Cookie"} wins!`);
  } else {
    showBannerMessage(`Draw!`);
  }
});

// restart flows
socket.on("ttt:restartOffer", async ({ rid, fromRole }) => {
  const accept = await askConfirm("Restart requested", `${fromRole === "immu" ? "Immu" : "Cookie"} asked to restart the game. Accept?`);
  socket.emit("ttt:restartResponse", { rid, accept });
});
socket.on("ttt:restartPending", () => showBannerMessage("Restart requested — waiting for response"));
socket.on("ttt:restartDenied", ({ by }) => showBannerMessage(`${by} denied restart`));
socket.on("ttt:restartAccepted", () => showBannerMessage("Restart accepted — board reset"));

// Chat send wiring (home chat)
chatSend.addEventListener("click", () => {
  const v = chatText.value.trim();
  if (!v) return;
  socket.emit("chat:send", { text: v });
  chatText.value = "";
});
chatText.addEventListener("keydown", (e) => {
  if (e.key === "Enter") chatSend.click();
});

// floating chat button toggles overlay
floatingChat.addEventListener("click", () => {
  openChatPanelExternally();
  clearUnreadBadge();
});

// games nav
toGamesBtn.addEventListener("click", () => gotoGames());
backHomeBtn.addEventListener("click", () => gotoHome());
detailBackBtn.addEventListener("click", () => gotoGames());

// role buttons
btnImmu.addEventListener("click", () => socket.emit("role:pick", { role: "immu" }));
btnCookie.addEventListener("click", () => socket.emit("role:pick", { role: "cookie" }));

// TTT actions
btnLeave.addEventListener("click", async () => {
  const ok = await askConfirm("Leave game", "Are you sure you want to leave the game? This will return both players to the games list.");
  if (!ok) return;
  socket.emit("game:leave", {});
  gotoGames();
  destroyTicTacToe();
});
btnReset.addEventListener("click", async () => {
  const ok = await askConfirm("Request restart", "Request a restart — the other player needs to accept.");
  if (!ok) return;
  socket.emit("ttt:requestRestart");
});

// modal close
if (modal) {
  modal.querySelector("#modal-close")?.addEventListener("click", () => hide(modal));
}

// expose for debugging
window.__role = () => myRole;
