import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";

/* ====== ścieżki ====== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ====== HTTP SERVER (HTML + SVG) ====== */
const server = http.createServer((req, res) => {
  let file = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.join(__dirname, "../public", file);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200);
    res.end(data);
  });
});

/* ====== WEBSOCKET ====== */
const wss = new WebSocketServer({ server });

/* ====== TWOJA LOGIKA GRY (PRAWIE BEZ ZMIAN) ====== */
const rooms = new Map();
let roomCounter = 0;

function createEmptyBoard() {
  return [
    ["", "", ""],
    ["", "", ""],
    ["", "", ""],
  ];
}

function checkWinner(board) {
  const lines = [
    [board[0][0], board[0][1], board[0][2]],
    [board[1][0], board[1][1], board[1][2]],
    [board[2][0], board[2][1], board[2][2]],
    [board[0][0], board[1][0], board[2][0]],
    [board[0][1], board[1][1], board[2][1]],
    [board[0][2], board[1][2], board[2][2]],
    [board[0][0], board[1][1], board[2][2]],
    [board[0][2], board[1][1], board[2][0]],
  ];

  for (const line of lines) {
    if (line[0] && line[0] === line[1] && line[1] === line[2]) {
      return line[0];
    }
  }

  if (board.flat().every(c => c !== "")) return "draw";
  return null;
}

function assignRoom(ws) {
  for (const [key, room] of rooms.entries()) {
    if (!room.closed) {
      room.clients.push(ws);
      room.closed = true;
      return key;
    }
  }

  const key = `room-${++roomCounter}`;
  rooms.set(key, {
    clients: [ws],
    closed: false,
    currentTurn: 0,
    board: createEmptyBoard(),
    gameFinished: false,
  });

  return key;
}

/* ====== WEBSOCKET EVENTS ====== */
wss.on("connection", (ws) => {
  const roomKey = assignRoom(ws);
  const room = rooms.get(roomKey);
  const playerIndex = room.clients.indexOf(ws);
  const symbol = playerIndex === 0 ? "X" : "O";

  ws.send(JSON.stringify({
    type: "playerInfo",
    symbol,
    yourTurn: playerIndex === room.currentTurn,
  }));

  ws.on("message", (data) => {
    const msg = JSON.parse(data);

    if (msg.type !== "move") return;
    if (room.gameFinished) return;
    if (playerIndex !== room.currentTurn) return;

    const { row, col } = msg;
    if (room.board[row][col]) return;

    room.board[row][col] = symbol;
    room.currentTurn = (room.currentTurn + 1) % 2;

    room.clients.forEach((c, i) =>
      c.send(JSON.stringify({
        type: "boardUpdate",
        board: room.board,
        yourTurn: i === room.currentTurn,
      }))
    );

    const result = checkWinner(room.board);
    if (result) {
      room.gameFinished = true;
      room.clients.forEach((c, i) =>
        c.send(JSON.stringify({
          type: result === "draw"
            ? "draw"
            : i === (result === "X" ? 0 : 1)
            ? "win"
            : "lose",
        }))
      );
    }
  });
});

/* ====== START ====== */
const PORT = process.env.PORT || 8080;
server.listen(PORT, () =>
  console.log("Server running on port", PORT)
);
