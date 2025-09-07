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

// === rooms state ===
const rooms = {};

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true }));

io.on("connection", (socket) => {
  let roomId = null;
  let myRole = null;

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

  const leaveRoomCleanup = () => {
    if (!roomId || !rooms[roomId]) return;
    const r = rooms[roomId];

    const wasImmu = r.players.immu === socket.id;
    const wasCookie = r.players.cookie === socket.id;

    if (wasImmu) r.players.immu = null;
    if (wasCookie) r.players.cookie = null;

    // If game was active and a player leaves, end the game
    if (r.ttt.active) {
      r.ttt.active = false;
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

    // reset ephemeral ttt state when everyone leaves
    if (!r.players.immu && !r.players.cookie) {
      r.ttt = { board: Array(9).fill(null), turn: "immu", active: false };
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
  });

  // FIXED: Leave game handling
  socket.on("game:leave", () => {
    if (!roomId || !rooms[roomId]) return;
    const r = rooms[roomId];

    // if other player not connected, just reset local state & inform requester
    const other = (r.players.immu === socket.id) ? r.players.cookie : r.players.immu;
    if (!other) {
      r.ttt = { board: Array(9).fill(null), turn: "immu", active: false };
      socket.emit("game:left:ok");
      emitPresenceStatus(roomId);
      return;
    }

    // prevent duplicate leave requests
    if (r.pendingFlags.leaveReq) {
      socket.emit("game:leavePending");
      return;
    }

    // set a leave pending flag
    const leaveReqId = uuidv4();
    r.pendingFlags.leaveReq = leaveReqId;
    r.pendingRequests[leaveReqId] = { from: socket.id, type: "leave", ts: Date.now() };

    const whoReadable = myRole ? readableRole(myRole) : inferRoleName(r, socket.id);
    
    // Notify both players about the leave
    io.to(roomId).emit("game:playerLeft", { who: whoReadable, duringGame: r.ttt.active });
    
    // Reset game state
    r.ttt = { board: Array(9).fill(null), turn: "immu", active: false };
    
    // Send both players back to home
    io.to(roomId).emit("game:returnToList");

    // clear pending leave after a short time
    setTimeout(() => {
      delete r.pendingRequests[leaveReqId];
      r.pendingFlags.leaveReq = null;
    }, 1500);
  });

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

  socket.on("disconnect", () => {
    if (roomId && rooms[roomId]) {
      const r = rooms[roomId];
      r.pendingRequests = {};
      r.pendingFlags = { gameReq: null, restartReq: null, leaveReq: null };
      
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
