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

  const leaveRoomCleanup = () => {
    if (!roomId || !rooms[roomId]) return;
    const r = rooms[roomId];
    if (r.players.immu === socket.id) r.players.immu = null;
    if (r.players.cookie === socket.id) r.players.cookie = null;

    io.to(roomId).emit("presence:update", {
      immuOnline: !!r.players.immu,
      cookieOnline: !!r.players.cookie,
    });

    if (!r.players.immu && !r.players.cookie) {
      r.ttt = { board: Array(9).fill(null), turn: "immu", active: false };
      r.pendingRequests = {};
    }
  };

  socket.on("room:hello", ({ room }) => {
    roomId = (room || "default").toString();
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: { immu: null, cookie: null },
        ttt: { board: Array(9).fill(null), turn: "immu", active: false },
        pendingRequests: {},
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

      io.to(roomId).emit("presence:update", {
        immuOnline: !!r.players.immu,
        cookieOnline: !!r.players.cookie,
      });

      const scores = readScores();
      const s = scores[roomId] || { immu: 0, cookie: 0, draws: 0 };
      socket.emit("scores:update", s);
    } else {
      socket.emit("role:choose", availability);
    }

    io.to(roomId).emit("presence:update", {
      immuOnline: !!r.players.immu,
      cookieOnline: !!r.players.cookie,
    });
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

    io.to(roomId).emit("presence:update", {
      immuOnline: !!r.players.immu,
      cookieOnline: !!r.players.cookie,
    });

    const scores = readScores();
    const s = scores[roomId] || { immu: 0, cookie: 0, draws: 0 };
    io.to(roomId).emit("scores:update", s);
  });

  // === chat ===
  socket.on("chat:send", ({ text }) => {
    if (!roomId) return;
    const payload = { text, ts: Date.now(), role: myRole || "spectator" };
    io.to(roomId).emit("chat:msg", payload);
  });

  // === Game selection flow ===
  socket.on("game:selectionRequest", ({ gameName }) => {
    if (!roomId || !rooms[roomId]) return;
    const r = rooms[roomId];

    const otherSocketId =
      (r.players.immu === socket.id && r.players.cookie) ||
      (r.players.cookie === socket.id && r.players.immu);

    if (!otherSocketId) {
      socket.emit("game:selectionPending");
      return;
    }

    const reqId = uuidv4();
    r.pendingRequests[reqId] = { from: socket.id, gameName, ts: Date.now() };

    io.to(otherSocketId).emit("game:selectionOffer", {
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
    if (!pending) return;

    const requester = pending.from;
    delete r.pendingRequests[reqId];

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
  });

  // Leave game (notify readable name)
  socket.on("game:leave", ({ confirm }) => {
    if (!roomId || !rooms[roomId]) return;
    const r = rooms[roomId];

    const whoReadable = myRole ? readableRole(myRole) : inferRoleName(r, socket.id);

    io.to(roomId).emit("game:playerLeft", {
      who: whoReadable,
    });

    r.ttt = { board: Array(9).fill(null), turn: "immu", active: false };
  });

  // === TicTacToe ===
  socket.on("ttt:start", () => {
    if (!roomId || !rooms[roomId]) return;
    const r = rooms[roomId];
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
        io.to(roomId).emit("scores:update", scores[roomId]);
        io.to(roomId).emit("ttt:over", { winner: myRole, board });
      } else {
        scores[roomId].draws += 1;
        writeScores(scores);
        io.to(roomId).emit("scores:update", scores[roomId]);
        io.to(roomId).emit("ttt:over", { draw: true, board });
      }

      setTimeout(() => {
        io.to(roomId).emit("game:returnToList");
        r.ttt = { board: Array(9).fill(null), turn: "immu", active: false };
      }, 2600);
    } else {
      r.ttt.turn = (turn === "immu") ? "cookie" : "immu";
      io.to(roomId).emit("ttt:state", r.ttt);
    }
  });

  socket.on("ttt:requestRestart", () => {
    if (!roomId || !rooms[roomId] || !myRole) return;
    const r = rooms[roomId];

    const otherSocketId = (r.players.immu === socket.id && r.players.cookie) ||
                          (r.players.cookie === socket.id && r.players.immu);

    if (!otherSocketId) {
      socket.emit("ttt:restartDenied", { reason: "No opponent" });
      return;
    }

    const rid = uuidv4();
    r.pendingRequests[rid] = { from: socket.id, type: "restart", ts: Date.now() };
    io.to(otherSocketId).emit("ttt:restartOffer", { rid, fromRole: myRole });
    socket.emit("ttt:restartPending");
  });

  socket.on("ttt:restartResponse", ({ rid, accept }) => {
    if (!roomId || !rooms[roomId]) return;
    const r = rooms[roomId];
    const pending = r.pendingRequests[rid];
    if (!pending) return;
    delete r.pendingRequests[rid];

    if (!accept) {
      io.to(pending.from).emit("ttt:restartDenied", { by: myRole || inferRoleName(r, socket.id) });
      return;
    }

    r.ttt = { board: Array(9).fill(null), turn: "immu", active: true };
    io.to(roomId).emit("ttt:state", r.ttt);
    io.to(roomId).emit("ttt:restartAccepted");
  });

  socket.on("ttt:reset", () => {
    if (!roomId || !rooms[roomId]) return;
    const r = rooms[roomId];
    r.ttt = { board: Array(9).fill(null), turn: "immu", active: true };
    io.to(roomId).emit("ttt:state", r.ttt);
  });

  socket.on("disconnect", () => leaveRoomCleanup());
  socket.on("room:leave", () => {
    leaveRoomCleanup();
    socket.leave(roomId);
    roomId = null;
    myRole = null;
  });
});

// helpers
function readableRole(r) {
  if (r === "immu") return "Immu";
  if (r === "cookie") return "Cookie";
  return String(r || "someone");
}
function inferRoleName(roomObj, sid) {
  if (!roomObj) return "someone";
  if (roomObj.players.immu === sid) return "Immu";
  if (roomObj.players.cookie === sid) return "Cookie";
  return "someone";
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`→ http://localhost:${PORT}`);
});
