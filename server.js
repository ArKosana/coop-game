// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// === persistence (scores) ===
const DATA_DIR = path.join(__dirname, "data");
const SCORES_PATH = path.join(DATA_DIR, "scores.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(SCORES_PATH)) {
  fs.writeFileSync(SCORES_PATH, JSON.stringify({}), "utf-8");
}
const readScores = () =>
  JSON.parse(fs.readFileSync(SCORES_PATH, "utf-8"));
const writeScores = (obj) =>
  fs.writeFileSync(SCORES_PATH, JSON.stringify(obj, null, 2), "utf-8");

// === UNO Card Definitions ===
const UNO_COLORS = ['red', 'blue', 'green', 'yellow'];
const UNO_VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2'];
const UNO_SPECIALS = ['wild', 'wild4'];

function createUnoDeck() {
  let deck = [];
  
  // Add colored cards
  UNO_COLORS.forEach(color => {
    UNO_VALUES.forEach(value => {
      deck.push({ type: 'number', color, value });
      if (value !== '0') deck.push({ type: 'number', color, value });
    });
    
    // Add action cards (2 of each per color)
    ['skip', 'reverse', 'draw2'].forEach(action => {
      deck.push({ type: 'action', color, value: action });
      deck.push({ type: 'action', color, value: action });
    });
  });
  
  // Add wild cards (4 of each)
  UNO_SPECIALS.forEach(special => {
    for (let i = 0; i < 4; i++) {
      deck.push({ type: 'wild', color: 'black', value: special });
    }
  });
  
  return shuffleArray(deck);
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function canPlayCard(card, topCard, currentColor) {
  if (card.type === 'wild') return true;
  if (card.color === 'black') return true;
  if (card.color === currentColor) return true;
  if (card.value === topCard.value) return true;
  return false;
}

// === rooms state ===
const rooms = {};

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true }));

io.on("connection", (socket) => {
  let roomId = null;
  let myRole = null;
  let turnTimers = {};

  function otherInfo(r) {
    if (!r) return { id: null, role: null };
    if (r.players.immu === socket.id) return { id: r.players.cookie, role: "cookie" };
    if (r.players.cookie === socket.id) return { id: r.players.immu, role: "immu" };
    return { id: null, role: null };
  }

  function emitPresenceStatus(rid) {
    if (!rooms[rid]) return;
    const r = rooms[rid];
    const immuOnline = !!r.players.immu;
    const cookieOnline = !!r.players.cookie;
    io.to(rid).emit("presence:update", { immuOnline, cookieOnline });

    if (r.players.immu) {
      const otherConnected = !!r.players.cookie;
      io.to(r.players.immu).emit("presence:status", {
        you: "immu",
        otherConnected,
        otherName: otherConnected ? "Cookie" : "Cookie"
      });
    }
    if (r.players.cookie) {
      const otherConnected = !!r.players.immu;
      io.to(r.players.cookie).emit("presence:status", {
        you: "cookie",
        otherConnected,
        otherName: otherConnected ? "Immu" : "Immu"
      });
    }
  }

  // Start turn timer
  function startTurnTimer(roomId, player) {
    if (turnTimers[roomId]) {
      clearTimeout(turnTimers[roomId]);
    }
    
    turnTimers[roomId] = setTimeout(() => {
      if (rooms[roomId] && rooms[roomId].uno && rooms[roomId].uno.active && 
          rooms[roomId].uno.currentPlayer === player) {
        // Time's up! Force draw 2 cards
        const r = rooms[roomId];
        for (let i = 0; i < 2; i++) {
          if (r.uno.deck.length === 0) {
            const topCard = r.uno.discardPile.pop();
            r.uno.deck = shuffleArray(r.uno.discardPile);
            r.uno.discardPile = [topCard];
          }
          r.uno.players[player].hand.push(r.uno.deck.pop());
        }
        
        // Move to next player
        r.uno.currentPlayer = getNextPlayer(r.uno);
        io.to(roomId).emit("uno:timeout", { player });
        io.to(roomId).emit("uno:state", r.uno);
        
        // Start timer for next player
        startTurnTimer(roomId, r.uno.currentPlayer);
      }
    }, 60000); // 1 minute timer
  }

  const leaveRoomCleanup = () => {
    if (!roomId || !rooms[roomId]) return;
    const r = rooms[roomId];

    const wasImmu = r.players.immu === socket.id;
    const wasCookie = r.players.cookie === socket.id;

    if (wasImmu) r.players.immu = null;
    if (wasCookie) r.players.cookie = null;

    // Clear timer
    if (turnTimers[roomId]) {
      clearTimeout(turnTimers[roomId]);
      delete turnTimers[roomId];
    }

    // If game was active and a player leaves, end the game
    if ((r.ttt && r.ttt.active) || (r.uno && r.uno.active)) {
      const whoLeft = wasImmu ? "Immu" : (wasCookie ? "Cookie" : "Someone");
      
      // Notify remaining player
      const remainingId = r.players.immu || r.players.cookie;
      if (remainingId) {
        io.to(remainingId).emit("game:playerLeft", { who: whoLeft, duringGame: true });
        io.to(remainingId).emit("game:returnToList");
      }
    }

    // notify remaining player that opponent left
    if (roomId && rooms[roomId]) {
      const remainingId = r.players.immu || r.players.cookie;
      const whoLeft = wasImmu ? "Immu" : (wasCookie ? "Cookie" : "Someone");
      if (remainingId) {
        io.to(remainingId).emit("opponent:left", { who: whoLeft });
        emitPresenceStatus(roomId);
      } else {
        io.to(roomId).emit("presence:update", {
          immuOnline: !!r.players.immu,
          cookieOnline: !!r.players.cookie,
        });
      }
    }

    // reset game state when everyone leaves
    if (!r.players.immu && !r.players.cookie) {
      if (r.ttt) r.ttt = { board: Array(9).fill(null), turn: "immu", active: false };
      if (r.uno) r.uno = { active: false };
      r.pendingRequests = {};
      r.pendingFlags = { gameReq: null, restartReq: null, leaveReq: null };
    }
  };

  socket.on("room:hello", ({ room }) => {
    roomId = (room || "default").toString();
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: { immu: null, cookie: null },
        ttt: { board: Array(9).fill(null), turn: "immu", active: false },
        uno: { active: false },
        pendingRequests: {},
        pendingFlags: { gameReq: null, restartReq: null, leaveReq: null },
      };
    }
    const r = rooms[roomId];

    const takenCount =
      (r.players.immu ? 1 : 0) + (r.players.cookie ? 1 : 0);
    if (takenCount >= 2) {
      socket.emit("room:full");
      return;
    }

    socket.join(roomId);

    const availability = {
      immuFree: !r.players.immu,
      cookieFree: !r.players.cookie,
    };

    if (!(availability.immuFree && availability.cookieFree)) {
      if (availability.immuFree) {
        r.players.immu = socket.id;
        myRole = "immu";
      } else if (availability.cookieFree) {
        r.players.cookie = socket.id;
        myRole = "cookie";
      }
      socket.emit("role:autoAssigned", { role: myRole });

      try {
        const remainingRole = myRole === "immu" ? "cookie" : "immu";
        const allInRoom = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
        for (const sId of allInRoom) {
          if (sId === socket.id) continue;
          if (r.players.immu !== sId && r.players.cookie !== sId) {
            r.players[remainingRole] = sId;
            io.to(sId).emit("role:autoAssigned", { role: remainingRole });
            break;
          }
        }
      } catch (e) {
        // ignore
      }

      emitPresenceStatus(roomId);

      const scores = readScores();
      const s = scores[roomId] || { immu: 0, cookie: 0, draws: 0 };
      socket.emit("scores:update", s);
    } else {
      socket.emit("role:choose", availability);
      emitPresenceStatus(roomId);
    }

    emitPresenceStatus(roomId);
  });

  socket.on("role:pick", ({ role }) => {
    if (!roomId || !rooms[roomId]) return;
    const r = rooms[roomId];
    if (role !== "immu" && role !== "cookie") return;
    if (r.players[role]) {
      socket.emit("role:unavailable");
      return;
    }

    r.players[role] = socket.id;
    myRole = role;
    socket.emit("role:confirmed", { role });

    const remaining = role === "immu" ? "cookie" : "immu";
    const allInRoom = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    for (const sId of allInRoom) {
      if (sId === socket.id) continue;
      if (r.players.immu !== sId && r.players.cookie !== sId) {
        r.players[remaining] = sId;
        io.to(sId).emit("role:autoAssigned", { role: remaining });
        break;
      }
    }

    emitPresenceStatus(roomId);

    const scores = readScores();
    const s = scores[roomId] || { immu: 0, cookie: 0, draws: 0 };
    io.to(roomId).emit("scores:update", s);
  });

  socket.on("chat:send", ({ text }) => {
    if (!roomId) return;
    const payload = { text, ts: Date.now(), role: myRole || "spectator" };
    io.to(roomId).emit("chat:msg", payload);
  });

  socket.on("game:selectionRequest", ({ gameName }) => {
    if (!roomId || !rooms[roomId]) {
      socket.emit("game:selectionFailed", { reason: "not_in_room" });
      return;
    }
    const r = rooms[roomId];

    if (r.pendingFlags.gameReq) {
      socket.emit("game:selectionPending");
      return;
    }

    const other = (r.players.immu === socket.id) ? r.players.cookie : r.players.immu;
    if (!other) {
      socket.emit("game:selectionFailed", { reason: "no_opponent" });
      return;
    }

    const reqId = uuidv4();
    r.pendingRequests[reqId] = { from: socket.id, gameName, ts: Date.now() };
    r.pendingFlags.gameReq = reqId;

    io.to(other).emit("game:selectionOffer", {
      reqId,
      fromId: socket.id,
      fromRole: myRole,
      gameName,
    });

    socket.emit("game:selectionPending", { toRole: myRole === "immu" ? "cookie" : "immu" });
  });

  socket.on("game:selectionResponse", ({ reqId, accept }) => {
    if (!roomId || !rooms[roomId]) return;
    const r = rooms[roomId];
    const pending = r.pendingRequests[reqId];
    if (!pending) {
      socket.emit("game:selectionFailed", { reason: "no_pending" });
      return;
    }

    const requester = pending.from;
    delete r.pendingRequests[reqId];
    r.pendingFlags.gameReq = null;

    if (!accept) {
      io.to(requester).emit("game:selectionDenied", { by: myRole || inferRoleName(r, socket.id) });
      return;
    }

    // Start the appropriate game
    if (pending.gameName === "tictactoe") {
      r.ttt = { board: Array(9).fill(null), turn: "immu", active: true };
      const players = {
        immu: r.players.immu ? r.players.immu : null,
        cookie: r.players.cookie ? r.players.cookie : null,
      };

      io.to(roomId).emit("game:start", {
        players,
        state: r.ttt,
        gameName: pending.gameName,
      });

      io.to(roomId).emit("ttt:state", r.ttt);
    } else if (pending.gameName === "uno") {
      // Initialize UNO game
      const deck = createUnoDeck();
      const players = {
        immu: { hand: deck.splice(0, 7), ready: false, saidUno: false },
        cookie: { hand: deck.splice(0, 7), ready: false, saidUno: false }
      };
      
      const topCard = deck.pop();
      // Ensure first card is not a wild card
      while (topCard.color === 'black') {
        deck.unshift(topCard);
        deck.push(deck.pop());
      }
      
      r.uno = {
        active: true,
        deck,
        discardPile: [topCard],
        players,
        currentPlayer: "immu",
        currentColor: topCard.color,
        direction: 1, // 1 for clockwise, -1 for counterclockwise
        status: "playing"
      };

      io.to(roomId).emit("game:start", {
        players: {
          immu: r.players.immu ? r.players.immu : null,
          cookie: r.players.cookie ? r.players.cookie : null,
        },
        state: r.uno,
        gameName: pending.gameName,
      });

      io.to(roomId).emit("uno:state", r.uno);
      
      // Start timer for first player
      startTurnTimer(roomId, r.uno.currentPlayer);
    }
  });

  // FIXED: Leave game handling
  socket.on("game:leave", () => {
    if (!roomId || !rooms[roomId]) return;
    const r = rooms[roomId];

    const other = (r.players.immu === socket.id) ? r.players.cookie : r.players.immu;
    if (!other) {
      if (r.ttt) r.ttt = { board: Array(9).fill(null), turn: "immu", active: false };
      if (r.uno) r.uno = { active: false };
      socket.emit("game:left:ok");
      emitPresenceStatus(roomId);
      return;
    }

    if (r.pendingFlags.leaveReq) {
      socket.emit("game:leavePending");
      return;
    }

    const leaveReqId = uuidv4();
    r.pendingFlags.leaveReq = leaveReqId;
    r.pendingRequests[leaveReqId] = { from: socket.id, type: "leave", ts: Date.now() };

    const whoReadable = myRole ? readableRole(myRole) : inferRoleName(r, socket.id);
    
    const duringGame = (r.ttt && r.ttt.active) || (r.uno && r.uno.active);
    io.to(roomId).emit("game:playerLeft", { who: whoReadable, duringGame });
    
    if (r.ttt) r.ttt = { board: Array(9).fill(null), turn: "immu", active: false };
    if (r.uno) r.uno = { active: false };
    
    io.to(roomId).emit("game:returnToList");

    setTimeout(() => {
      delete r.pendingRequests[leaveReqId];
      r.pendingFlags.leaveReq = null;
    }, 1500);
  });

  // Tic Tac Toe handlers
  socket.on("ttt:start", () => {
    if (!roomId || !rooms[roomId]) return;
    const r = rooms[roomId];
    if (!r.players.immu || !r.players.cookie) {
      socket.emit("ttt:startFailed", { reason: "no_opponent" });
      return;
    }
    r.ttt = { board: Array(9).fill(null), turn: "immu", active: true };
    io.to(roomId).emit("ttt:state", r.ttt);
  });

  socket.on("ttt:move", ({ index }) => {
    if (!roomId || !rooms[roomId] || !myRole) return;
    const r = rooms[roomId];
    const { board, turn, active } = r.ttt;
    if (!active || turn !== myRole || index < 0 || index > 8 || board[index]) return;

    board[index] = myRole;
    const wins = [
      [0,1,2],[3,4,5],[6,7,8],
      [0,3,6],[1,4,7],[2,5,8],
      [0,4,8],[2,4,6]
    ];
    const hasWin = wins.some(([a,b,c]) => board[a] && board[a] === board[b] && board[a] === board[c]);
    const isDraw = board.every(Boolean);

    if (hasWin || isDraw) {
      r.ttt.active = false;

      const scores = readScores();
      scores[roomId] ||= { immu: 0, cookie: 0, draws: 0 };

      if (hasWin) {
        scores[roomId][myRole] += 1;
        writeScores(scores);
        io.to(roomId).emit("ttt:win", { winner: myRole, board });
      } else {
        scores[roomId].draws += 1;
        writeScores(scores);
        io.to(roomId).emit("ttt:draw", { board });
      }

      io.to(roomId).emit("scores:update", scores[roomId]);
    } else {
      r.ttt.turn = myRole === "immu" ? "cookie" : "immu";
    }

    io.to(roomId).emit("ttt:state", r.ttt);
  });

  socket.on("ttt:requestRestart", () => {
    if (!roomId || !rooms[roomId]) return;
    const r = rooms[roomId];
    const other = (r.players.immu === socket.id) ? r.players.cookie : r.players.immu;
    if (!other) {
      socket.emit("ttt:restartFailed", { reason: "no_opponent" });
      return;
    }

    if (r.pendingFlags.restartReq) {
      socket.emit("ttt:restartPending");
      return;
    }

    const reqId = uuidv4();
    r.pendingRequests[reqId] = { from: socket.id, type: "restart", ts: Date.now() };
    r.pendingFlags.restartReq = reqId;

    io.to(other).emit("ttt:restartOffer", {
      rid: reqId,
      fromId: socket.id,
      fromRole: myRole,
    });

    socket.emit("ttt:restartPending");
  });

  socket.on("ttt:restartResponse", ({ rid, accept }) => {
    if (!roomId || !rooms[roomId]) return;
    const r = rooms[roomId];
    const pending = r.pendingRequests[rid];
    if (!pending) return;

    delete r.pendingRequests[rid];
    r.pendingFlags.restartReq = null;

    if (!accept) {
      io.to(pending.from).emit("ttt:restartDenied", { by: myRole || inferRoleName(r, socket.id) });
      return;
    }

    r.ttt = { board: Array(9).fill(null), turn: "immu", active: true };
    io.to(roomId).emit("ttt:restartAccepted");
    io.to(roomId).emit("ttt:state", r.ttt);
  });

  // UNO Game Handlers
  socket.on("uno:playCard", ({ cardIndex, chosenColor }) => {
    if (!roomId || !rooms[roomId] || !myRole) return;
    const r = rooms[roomId];
    if (!r.uno || !r.uno.active || r.uno.currentPlayer !== myRole) return;

    const playerHand = r.uno.players[myRole].hand;
    if (cardIndex < 0 || cardIndex >= playerHand.length) return;

    const card = playerHand[cardIndex];
    const topCard = r.uno.discardPile[r.uno.discardPile.length - 1];

    if (!canPlayCard(card, topCard, r.uno.currentColor)) return;

    // Check UNO penalty - if player has 2 cards and didn't say UNO
    if (playerHand.length === 2 && !r.uno.players[myRole].saidUno) {
      // Penalty: draw 2 cards
      for (let i = 0; i < 2; i++) {
        if (r.uno.deck.length === 0) {
          const topCard = r.uno.discardPile.pop();
          r.uno.deck = shuffleArray(r.uno.discardPile);
          r.uno.discardPile = [topCard];
        }
        playerHand.push(r.uno.deck.pop());
      }
      io.to(roomId).emit("uno:penalty", { player: myRole, reason: "forgot_uno" });
    }

    // Remove card from player's hand
    const playedCard = playerHand.splice(cardIndex, 1)[0];
    
    // For wild cards, change the color to the chosen one
    if (card.type === 'wild' && chosenColor) {
      playedCard.color = chosenColor;
    }
    
    r.uno.discardPile.push(playedCard);
    r.uno.players[myRole].saidUno = false; // Reset UNO status after playing

    // Handle special cards
    if (card.type === 'wild') {
      r.uno.currentColor = chosenColor || UNO_COLORS[Math.floor(Math.random() * UNO_COLORS.length)];
      
      if (card.value === 'wild4') {
        // Draw 4 cards for next player
        const nextPlayer = getNextPlayer(r.uno);
        for (let i = 0; i < 4; i++) {
          if (r.uno.deck.length === 0) {
            // Reshuffle discard pile (except top card)
            const topCard = r.uno.discardPile.pop();
            r.uno.deck = shuffleArray(r.uno.discardPile);
            r.uno.discardPile = [topCard];
          }
          r.uno.players[nextPlayer].hand.push(r.uno.deck.pop());
        }
      }
    } else {
      r.uno.currentColor = card.color;
      
      if (card.value === 'skip') {
        // Skip next player's turn
        r.uno.currentPlayer = getNextPlayer(r.uno);
      } else if (card.value === 'reverse') {
        // Reverse direction
        r.uno.direction *= -1;
      } else if (card.value === 'draw2') {
        // Draw 2 cards for next player
        const nextPlayer = getNextPlayer(r.uno);
        for (let i = 0; i < 2; i++) {
          if (r.uno.deck.length === 0) {
            const topCard = r.uno.discardPile.pop();
            r.uno.deck = shuffleArray(r.uno.discardPile);
            r.uno.discardPile = [topCard];
          }
          r.uno.players[nextPlayer].hand.push(r.uno.deck.pop());
        }
      }
    }

    // Check for win
    if (playerHand.length === 0) {
      r.uno.active = false;
      
      const scores = readScores();
      scores[roomId] ||= { immu: 0, cookie: 0, draws: 0 };
      scores[roomId][myRole] += 1;
      writeScores(scores);
      
      io.to(roomId).emit("uno:win", { winner: myRole });
      io.to(roomId).emit("scores:update", scores[roomId]);
      
      // Clear timer
      if (turnTimers[roomId]) {
        clearTimeout(turnTimers[roomId]);
        delete turnTimers[roomId];
      }
      
      setTimeout(() => {
        io.to(roomId).emit("game:returnToList");
      }, 3000);
      return;
    }

    // Move to next player
    r.uno.currentPlayer = getNextPlayer(r.uno);
    
    // Reset UNO status for next player
    r.uno.players[r.uno.currentPlayer].saidUno = false;

    // Start timer for next player
    startTurnTimer(roomId, r.uno.currentPlayer);

    io.to(roomId).emit("uno:state", r.uno);
  });

  socket.on("uno:drawCard", () => {
    if (!roomId || !rooms[roomId] || !myRole) return;
    const r = rooms[roomId];
    if (!r.uno || !r.uno.active || r.uno.currentPlayer !== myRole) return;

    if (r.uno.deck.length === 0) {
      // Reshuffle discard pile (except top card)
      const topCard = r.uno.discardPile.pop();
      r.uno.deck = shuffleArray(r.uno.discardPile);
      r.uno.discardPile = [topCard];
    }

    r.uno.players[myRole].hand.push(r.uno.deck.pop());
    r.uno.currentPlayer = getNextPlayer(r.uno);
    
    // Reset UNO status for next player
    r.uno.players[r.uno.currentPlayer].saidUno = false;

    // Start timer for next player
    startTurnTimer(roomId, r.uno.currentPlayer);

    io.to(roomId).emit("uno:state", r.uno);
  });

  socket.on("uno:sayUno", () => {
    if (!roomId || !rooms[roomId] || !myRole) return;
    const r = rooms[roomId];
    if (!r.uno || !r.uno.active) return;

    // Only allow saying UNO when player has 2 cards
    if (r.uno.players[myRole].hand.length === 2) {
      r.uno.players[myRole].saidUno = true;
      io.to(roomId).emit("uno:saidUno", { player: myRole });
    }
  });

  socket.on("uno:requestRestart", () => {
    if (!roomId || !rooms[roomId]) return;
    const r = rooms[roomId];
    const other = (r.players.immu === socket.id) ? r.players.cookie : r.players.immu;
    if (!other) {
      socket.emit("uno:restartFailed", { reason: "no_opponent" });
      return;
    }

    if (r.pendingFlags.restartReq) {
      socket.emit("uno:restartPending");
      return;
    }

    const reqId = uuidv4();
    r.pendingRequests[reqId] = { from: socket.id, type: "restart", ts: Date.now() };
    r.pendingFlags.restartReq = reqId;

    io.to(other).emit("uno:restartOffer", {
      rid: reqId,
      fromId: socket.id,
      fromRole: myRole,
    });

    socket.emit("uno:restartPending");
  });

  socket.on("uno:restartResponse", ({ rid, accept }) => {
    if (!roomId || !rooms[roomId]) return;
    const r = rooms[roomId];
    const pending = r.pendingRequests[rid];
    if (!pending) return;

    delete r.pendingRequests[rid];
    r.pendingFlags.restartReq = null;

    if (!accept) {
      io.to(pending.from).emit("uno:restartDenied", { by: myRole || inferRoleName(r, socket.id) });
      return;
    }

    // Restart UNO game
    const deck = createUnoDeck();
    r.uno.players.immu = { hand: deck.splice(0, 7), ready: false, saidUno: false };
    r.uno.players.cookie = { hand: deck.splice(0, 7), ready: false, saidUno: false };
    
    const topCard = deck.pop();
    while (topCard.color === 'black') {
      deck.unshift(topCard);
      deck.push(deck.pop());
    }
    
    r.uno.deck = deck;
    r.uno.discardPile = [topCard];
    r.uno.currentPlayer = "immu";
    r.uno.currentColor = topCard.color;
    r.uno.direction = 1;
    r.uno.status = "playing";

    // Clear existing timer and start new one
    if (turnTimers[roomId]) {
      clearTimeout(turnTimers[roomId]);
    }
    startTurnTimer(roomId, r.uno.currentPlayer);

    io.to(roomId).emit("uno:restartAccepted");
    io.to(roomId).emit("uno:state", r.uno);
  });

  function getNextPlayer(unoState) {
    const players = ['immu', 'cookie'];
    const currentIndex = players.indexOf(unoState.currentPlayer);
    let nextIndex = (currentIndex + unoState.direction) % players.length;
    if (nextIndex < 0) nextIndex = players.length - 1;
    return players[nextIndex];
  }

  socket.on("disconnect", () => {
    if (roomId && rooms[roomId]) {
      const r = rooms[roomId];
      r.pendingRequests = {};
      r.pendingFlags = { gameReq: null, restartReq: null, leaveReq: null };
      
      // Clear timer
      if (turnTimers[roomId]) {
        clearTimeout(turnTimers[roomId]);
        delete turnTimers[roomId];
      }
      
      const otherSocketId = (r.players.immu === socket.id && r.players.cookie) ||
                           (r.players.cookie === socket.id && r.players.immu);
      
      if (otherSocketId) {
        io.to(otherSocketId).emit("request:cleared");
      }
    }
    
    leaveRoomCleanup();
    if (roomId && rooms[roomId]) {
      emitPresenceStatus(roomId);
    }
  });

  function inferRoleName(r, id) {
    if (r.players.immu === id) return "Immu";
    if (r.players.cookie === id) return "Cookie";
    return "Unknown";
  }
  function readableRole(role) {
    return role === "immu" ? "Immu" : "Cookie";
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Immu ❤️ Cookie server running on port ${PORT}`);
});
