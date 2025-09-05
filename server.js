const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let players = [];
let board = Array(9).fill("");
let turn = "X";

function checkWin() {
  const winPatterns = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  for (const [a,b,c] of winPatterns) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return board.includes("") ? null : "draw";
}

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // Assign symbol
  if (players.length < 2) {
    const symbol = players.length === 0 ? "X" : "O";
    players.push({ id: socket.id, symbol });
    socket.emit("assignSymbol", symbol);
    if (players.length === 2) {
      io.emit("turn", turn);
    }
  } else {
    socket.emit("assignSymbol", "Spectator");
  }

  // Handle moves
  socket.on("move", (data) => {
    if (data.symbol === turn && board[data.index] === "") {
      board[data.index] = data.symbol;
      io.emit("updateBoard", data);

      const result = checkWin();
      if (result === "draw") {
        io.emit("draw");
      } else if (result) {
        io.emit("win", result);
      } else {
        turn = turn === "X" ? "O" : "X";
        io.emit("turn", turn);
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    players = players.filter(p => p.id !== socket.id);
    board = Array(9).fill("");
    turn = "X";
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
