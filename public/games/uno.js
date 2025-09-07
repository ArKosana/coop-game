// games/uno.js (ES module)
const q = (s) => document.querySelector(s);

let _socket = null;
let _myRole = null;
let _unoState = null;
let _winModal = null;
let _turnTimer = null;

export function initUno(socket, myRole) {
  _socket = socket;
  _myRole = myRole;

  ensureWinModal();
  renderUnoScreen();

  // Listen for game state updates
  _socket.on("uno:state", updateGameState);
  _socket.on("uno:win", showWin);
  _socket.on("uno:saidUno", showUnoAlert);
  _socket.on("uno:penalty", showPenalty);
  _socket.on("uno:timeout", showTimeout);
  _socket.on("uno:restartOffer", handleRestartOffer);
  _socket.on("uno:restartPending", () => showBannerMessage("Restart requested — waiting"));
  _socket.on("uno:restartDenied", ({ by }) => showBannerMessage(`${by} denied restart`));
  _socket.on("uno:restartAccepted", () => showBannerMessage("Restart accepted — new game started"));
}

export function destroyUno() {
  if (!_socket) return;
  _socket.off("uno:state");
  _socket.off("uno:win");
  _socket.off("uno:saidUno");
  _socket.off("uno:penalty");
  _socket.off("uno:timeout");
  _socket.off("uno:restartOffer");
  _socket.off("uno:restartPending");
  _socket.off("uno:restartDenied");
  _socket.off("uno:restartAccepted");
  
  // Clear timer
  if (_turnTimer) {
    clearTimeout(_turnTimer);
    _turnTimer = null;
  }
  
  // Remove win modal if it exists
  if (_winModal && _winModal.parentNode) {
    _winModal.parentNode.removeChild(_winModal);
    _winModal = null;
  }
}

function renderUnoScreen() {
  const unoScreen = document.getElementById("screen-uno");
  if (!unoScreen) return;

  unoScreen.innerHTML = `
    <div class="topbar">
      <h1 id="uno-title" class="title">UNO</h1>
      <div class="right-actions">
        <button id="btn-restart-uno" class="btn neon">Request Restart</button>
        <button id="btn-leave-uno" class="btn neon danger">Leave Game</button>
      </div>
    </div>

    <div class="uno-game-container">
      <div class="opponent-area">
        <div class="opponent-hand">
          <div class="opponent-cards">
            <div class="card-count">Cards: <span id="opponent-card-count">0</span></div>
            <div class="turn-timer" id="turn-timer">01:00</div>
          </div>
        </div>
      </div>

      <div class="game-area">
        <div class="discard-pile" id="discard-pile">
          <!-- Top card will be rendered here -->
        </div>
        <div class="deck" id="deck">
          <img src="./assets/uno.jpeg" alt="Deck" class="deck-image">
        </div>
      </div>

      <div class="player-area">
        <div class="player-info">
          <div class="player-turn" id="player-turn"></div>
          <button id="btn-say-uno" class="btn neon" style="margin-top: 20px;">Say UNO!</button>
        </div>
        <div class="player-hand" id="player-hand">
          <!-- Player cards will be rendered here -->
        </div>
      </div>

      <div class="color-picker hidden" id="color-picker">
        <h3>Choose a color:</h3>
        <div class="color-options">
          <button class="color-btn red" data-color="red"></button>
          <button class="color-btn blue" data-color="blue"></button>
          <button class="color-btn green" data-color="green"></button>
          <button class="color-btn yellow" data-color="yellow"></button>
        </div>
      </div>
    </div>
  `;

  // Set up event listeners
  const unoBtn = document.getElementById("btn-say-uno");
  const leaveBtn = document.getElementById("btn-leave-uno");
  const restartBtn = document.getElementById("btn-restart-uno");

  if (unoBtn) {
    unoBtn.addEventListener("click", () => {
      _socket.emit("uno:sayUno");
    });
  }

  if (leaveBtn) {
    leaveBtn.addEventListener("click", async () => {
      const ok = await askConfirm("Leave game", "Are you sure? This will return both players to the home screen.");
      if (!ok) return;
      _socket.emit("game:leave", {});
    });
  }

  if (restartBtn) {
    restartBtn.addEventListener("click", async () => {
      const ok = await askConfirm("Request restart", "The other player needs to accept.");
      if (!ok) return;
      _socket.emit("uno:requestRestart");
    });
  }

  // Set up deck click handler
  const deck = document.getElementById("deck");
  if (deck) {
    deck.addEventListener("click", () => {
      _socket.emit("uno:drawCard");
    });
  }
}

function updateGameState(state) {
  _unoState = state;
  
  // Update title
  const titleEl = document.getElementById("uno-title");
  if (titleEl) {
    if (state.currentPlayer === _myRole) {
      titleEl.textContent = "Your Turn!";
    } else {
      titleEl.textContent = `${state.currentPlayer === "immu" ? "Immu" : "Cookie"}'s Turn`;
    }
  }

  // Update opponent card count
  const opponentRole = _myRole === "immu" ? "cookie" : "immu";
  const opponentCountEl = document.getElementById("opponent-card-count");
  if (opponentCountEl) {
    opponentCountEl.textContent = state.players[opponentRole].hand.length;
  }

  // Update player turn indicator
  const turnEl = document.getElementById("player-turn");
  if (turnEl) {
    turnEl.textContent = state.currentPlayer === _myRole ? 
      "Your turn!" : `${state.currentPlayer === "immu" ? "Immu" : "Cookie"}'s turn`;
  }

  // Update UNO button visibility - only show when player has exactly 2 cards
  const unoBtn = document.getElementById("btn-say-uno");
  if (unoBtn) {
    if (state.currentPlayer === _myRole && state.players[_myRole].hand.length === 2) {
      unoBtn.style.display = "block";
    } else {
      unoBtn.style.display = "none";
    }
  }

  // Render discard pile
  renderDiscardPile(state);

  // Render player hand
  renderPlayerHand(state);

  // Start/reset turn timer
  startTurnTimer();
}

function startTurnTimer() {
  // Clear existing timer
  if (_turnTimer) {
    clearInterval(_turnTimer);
    _turnTimer = null;
  }

  const timerEl = document.getElementById("turn-timer");
  if (!timerEl || !_unoState || _unoState.currentPlayer !== _myRole) {
    if (timerEl) timerEl.textContent = "01:00";
    return;
  }

  let timeLeft = 60; // 1 minute
  timerEl.textContent = "01:00";
  timerEl.classList.remove("time-warning");
  
  _turnTimer = setInterval(() => {
    timeLeft--;
    
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    timerEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    if (timeLeft <= 10) {
      timerEl.classList.add("time-warning");
    }
    
    if (timeLeft <= 0) {
      clearInterval(_turnTimer);
      _turnTimer = null;
    }
  }, 1000);
}

function renderDiscardPile(state) {
  const discardPile = document.getElementById("discard-pile");
  if (!discardPile) return;

  discardPile.innerHTML = '';
  if (state.discardPile.length > 0) {
    const topCard = state.discardPile[state.discardPile.length - 1];
    const cardEl = createCardElement(topCard, false);
    discardPile.appendChild(cardEl);
  }
}

function renderPlayerHand(state) {
  const playerHand = document.getElementById("player-hand");
  if (!playerHand) return;

  playerHand.innerHTML = '';
  const myHand = state.players[_myRole].hand;
  
  myHand.forEach((card, index) => {
    const isPlayable = state.currentPlayer === _myRole && 
                      canPlayCard(card, state.discardPile[state.discardPile.length - 1], state.currentColor);
    
    const cardEl = createCardElement(card, isPlayable);
    if (isPlayable) {
      cardEl.addEventListener('click', () => handleCardClick(card, index));
    }
    playerHand.appendChild(cardEl);
  });
}

function createCardElement(card, isPlayable) {
  const cardEl = document.createElement('div');
  cardEl.className = `card ${card.color} ${isPlayable ? 'playable' : ''}`;
  
  if (card.color === 'black') {
    cardEl.innerHTML = `
      <div class="card-inner wild">
        <div class="card-value">${card.value === 'wild' ? 'W' : 'W4'}</div>
      </div>
    `;
  } else {
    let displayValue = card.value;
    if (card.value === 'skip') displayValue = 'Ø';
    if (card.value === 'reverse') displayValue = '↺';
    if (card.value === 'draw2') displayValue = '+2';
    
    cardEl.innerHTML = `
      <div class="card-inner">
        <div class="card-value">${displayValue}</div>
      </div>
    `;
  }
  
  return cardEl;
}

function canPlayCard(card, topCard, currentColor) {
  if (card.type === 'wild') return true;
  if (card.color === 'black') return true;
  if (card.color === currentColor) return true;
  if (card.value === topCard.value) return true;
  return false;
}

function handleCardClick(card, index) {
  if (!_unoState || _unoState.currentPlayer !== _myRole) return;
  
  if (card.color === 'black') {
    // Show color picker for wild cards
    showColorPicker(index);
  } else {
    _socket.emit("uno:playCard", { cardIndex: index });
  }
}

function showColorPicker(cardIndex) {
  const colorPicker = document.getElementById("color-picker");
  if (!colorPicker) return;

  colorPicker.classList.remove("hidden");
  
  // Set up color buttons
  const colorBtns = colorPicker.querySelectorAll(".color-btn");
  colorBtns.forEach(btn => {
    btn.onclick = () => {
      const color = btn.dataset.color;
      _socket.emit("uno:playCard", { cardIndex, chosenColor: color });
      colorPicker.classList.add("hidden");
    };
  });
}

function showWin({ winner }) {
  // Show win modal
  showWinModal(winner === _myRole ? "win" : "lose", winner);
}

function showUnoAlert({ player }) {
  // Show UNO alert
  showBannerMessage(`${player === "immu" ? "Immu" : "Cookie"} said UNO!`);
}

function showPenalty({ player, reason }) {
  if (reason === "forgot_uno") {
    showBannerMessage(`${player === "immu" ? "Immu" : "Cookie"} forgot to say UNO! +2 cards`);
  }
}

function showTimeout({ player }) {
  showBannerMessage(`${player === "immu" ? "Immu" : "Cookie"} took too long! +2 cards`);
}

function handleRestartOffer({ rid, fromRole }) {
  askConfirm("Restart requested", `${fromRole === "immu" ? "Immu" : "Cookie"} asked to restart. Accept?`)
    .then(accept => {
      _socket.emit("uno:restartResponse", { rid, accept });
    });
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
    _socket.emit("uno:requestRestart");
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
  }
  
  _winModal.classList.remove("hidden");
}

// Helper functions
function showBannerMessage(text) {
  const banner = document.getElementById("top-banner");
  const bannerText = document.getElementById("banner-text");
  if (banner && bannerText) {
    bannerText.textContent = text;
    banner.classList.remove("hidden");
    setTimeout(() => banner.classList.add("hidden"), 3000);
  }
}

function askConfirm(title, text) {
  return new Promise((resolve) => {
    const confirmRoot = document.getElementById("confirm-root");
    if (!confirmRoot) return resolve(false);
    
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
