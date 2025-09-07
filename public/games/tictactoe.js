// games/tictactoe.js (ES module)
// Handles rendering and input gating for TicTacToe
const q = (s) => document.querySelector(s);

let _socket = null;
let _myRole = null;
let _board = Array(9).fill(null);
let _turn = "immu";
let _active = false;
let _winModal = null;

export function initTicTacToe(socket, myRole) {
  _socket = socket;
  _myRole = myRole;

  ensureWinModal();

  const boardEl = document.getElementById("ttt-grid");
  if (!boardEl) return;

  // Clear any existing cells
  boardEl.innerHTML = '';
  
  // Create cells
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement("div");
    cell.className = "ttt-cell";
    cell.dataset.index = i;
    cell.addEventListener("click", () => handleCellClick(i));
    boardEl.appendChild(cell);
  }

  // Set up reset button
  const resetBtn = document.getElementById("btn-reset-ttt");
  if (resetBtn) {
    resetBtn.onclick = () => {
      _socket.emit("ttt:requestRestart");
    };
  }

  // Listen for game state updates
  _socket.on("ttt:state", updateGameState);
  _socket.on("ttt:win", showWin);
  _socket.on("ttt:draw", showDraw);
  _socket.on("ttt:restartAccepted", resetGameUI);
}

export function destroyTicTacToe() {
  if (!_socket) return;
  _socket.off("ttt:state");
  _socket.off("ttt:win");
  _socket.off("ttt:draw");
  _socket.off("ttt:restartAccepted");
  
  // Remove win modal if it exists
  if (_winModal && _winModal.parentNode) {
    _winModal.parentNode.removeChild(_winModal);
    _winModal = null;
  }
}

function handleCellClick(index) {
  if (!_active || _turn !== _myRole || _board[index]) return;
  _socket.emit("ttt:move", { index });
}

function updateGameState(state) {
  _board = state.board || Array(9).fill(null);
  _turn = state.turn || "immu";
  _active = state.active || false;

  // Update board UI
  const cells = document.querySelectorAll(".ttt-cell");
  cells.forEach((cell, index) => {
    cell.textContent = "";
    cell.classList.remove("x", "o", "disabled");
    
    if (_board[index]) {
      cell.textContent = _board[index] === "immu" ? "X" : "O";
      cell.classList.add(_board[index] === "immu" ? "x" : "o");
    }
    
    if (!_active || _turn !== _myRole || _board[index]) {
      cell.classList.add("disabled");
    }
  });

  // Update turn indicator
  const titleEl = document.getElementById("ttt-title");
  if (titleEl) {
    if (!_active) {
      titleEl.textContent = "Game Over";
    } else {
      titleEl.textContent = `${_turn === "immu" ? "Immu" : "Cookie"}'s Turn`;
    }
  }
}

function showWin({ winner, board }) {
  _active = false;
  updateGameState({ board, turn: _turn, active: false });
  
  // Show win modal
  showWinModal(winner === _myRole ? "win" : "lose", winner);
}

function showDraw({ board }) {
  _active = false;
  updateGameState({ board, turn: _turn, active: false });
  
  // Show draw modal
  showWinModal("draw");
}

function resetGameUI() {
  _board = Array(9).fill(null);
  _turn = "immu";
  _active = true;
  updateGameState({ board: _board, turn: _turn, active: true });
  
  // Hide win modal
  if (_winModal) {
    _winModal.classList.add("hidden");
  }
}

function ensureWinModal() {
  if (_winModal) return;
  
  _winModal = document.createElement("div");
  _winModal.className = "win-modal hidden";
  _winModal.innerHTML = `
    <div class="win-content">
      <h2 class="win-title"></h2>
      <div class="win-buttons">
        <button id="win-play-again" class="btn neon">Play Again</button>
        <button id="win-back-to-games" class="btn neon ghost">Back to Games</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(_winModal);
  
  // Set up event listeners
  _winModal.querySelector("#win-play-again").addEventListener("click", () => {
    _socket.emit("ttt:requestRestart");
    _winModal.classList.add("hidden");
  });
  
  _winModal.querySelector("#win-back-to-games").addEventListener("click", () => {
    _socket.emit("game:leave", {});
    _winModal.classList.add("hidden");
  });
}

function showWinModal(result, winner = null) {
  if (!_winModal) ensureWinModal();
  
  const content = _winModal.querySelector(".win-content");
  const title = _winModal.querySelector(".win-title");
  
  // Remove previous result classes
  content.classList.remove("immu", "cookie", "draw");
  
  if (result === "win") {
    title.textContent = "You Win!";
    content.classList.add(_myRole);
  } else if (result === "lose") {
    title.textContent = `${winner === "immu" ? "Immu" : "Cookie"} Wins!`;
    content.classList.add(winner);
  } else {
    title.textContent = "It's a Draw!";
    content.classList.add("draw");
  }
  
  _winModal.classList.remove("hidden");
}
