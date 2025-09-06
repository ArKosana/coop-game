// games/tictactoe.js (ES module)
const q = (s) => document.querySelector(s);

let _socket = null;
let _role = null;
let _mounted = false;

const gridEl = () => q("#ttt-grid");
const titleEl = () => q("#ttt-title");

function renderBoard(board, turn, active) {
  if (!gridEl()) return;
  gridEl().innerHTML = "";
  board.forEach((cell, i) => {
    const b = document.createElement("button");
    const isDisabled = !active || cell !== null || (turn !== _role);
    b.className = "ttt-cell btn neon" + (isDisabled ? " disabled" : "");
    b.disabled = isDisabled;
    b.dataset.index = i;
    b.textContent = cell === "immu" ? "I" : (cell === "cookie" ? "C" : "");
    b.style.fontWeight = "700";
    b.style.letterSpacing = "2px";

    // color per symbol
    if (cell === "immu") {
      b.style.boxShadow = "0 0 12px rgba(57,255,20,.28)";
      b.style.borderColor = "rgba(57,255,20,.35)";
    } else if (cell === "cookie") {
      b.style.boxShadow = "0 0 12px rgba(255,0,255,.28)";
      b.style.borderColor = "rgba(255,0,255,.35)";
    } else {
      // empty, subtle hover effect
      b.addEventListener("mouseenter", () => {
        if (!b.disabled) b.style.transform = "scale(1.02)";
      });
      b.addEventListener("mouseleave", () => {
        b.style.transform = "";
      });
    }

    b.addEventListener("click", () => {
      if (!_socket) return;
      // double-check disable
      if (b.disabled) return;
      _socket.emit("ttt:move", { index: i });
    });

    gridEl().appendChild(b);
  });

  if (active) {
    titleEl().textContent = (turn === "immu") ? "Immu's turn" : "Cookie's turn";
  } else {
    titleEl().textContent = "Waiting...";
  }
}

export function initTicTacToe(socket, myRole) {
  _socket = socket;
  _role = myRole;
  _mounted = true;

  renderBoard(Array(9).fill(null), "immu", false);

  socket.on("ttt:state", ({ board, turn, active }) => {
    if (!_mounted) return;
    renderBoard(board, turn, active);
  });

  socket.on("ttt:over", (payload) => {
    if (!_mounted) return;
    if (payload.winner) {
      titleEl().textContent = (payload.winner === "immu") ? "Immu wins!" : "Cookie wins!";
    } else {
      titleEl().textContent = "Draw!";
    }
    renderBoard(payload.board, null, false);
  });

  socket.on("ttt:restartOffer", ({ rid, fromRole }) => {
    // handled by main.js confirm flow
  });
}

export function destroyTicTacToe() {
  _mounted = false;
}
