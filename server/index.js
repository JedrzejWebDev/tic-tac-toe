import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";

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

    let contentType = "text/html";
    if (file.endsWith(".svg")) contentType = "image/svg+xml";
    else if (file.endsWith(".js")) contentType = "text/javascript";
    else if (file.endsWith(".css")) contentType = "text/css";

    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

/* ====== WEBSOCKET SERVER ====== */
const wss = new WebSocketServer({ server });

/* ====== LOGIKA GRY ====== */
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
    if (line[0] !== "" && line[0] === line[1] && line[1] === line[2]) {
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

  roomCounter++;
  const key = `room-${roomCounter}`;
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

  // Wyślij info o graczu
  ws.send(JSON.stringify({
    type: "playerInfo",
    symbol,
    yourTurn: playerIndex === room.currentTurn,
  }));

  // Aktualizacja statusu pokoju
  room.clients.forEach(client => {
    client.send(JSON.stringify({
      type: "roomStatus",
      status: `Graczy w pokoju: ${room.clients.length}`
    }));
  });

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      ws.send(JSON.stringify({ type: "error", info: "Nieprawidłowy format JSON!" }));
      return;
    }

    if (msg.type !== "move") return;

    if (room.clients.length === 1) {
      ws.send(JSON.stringify({ type: "error", info: "Nie możesz grać sam!" }));
      return;
    }

    if (playerIndex !== room.currentTurn) {
      ws.send(JSON.stringify({ type: "error", info: "To nie jest twoja kolej!" }));
      return;
    }

    const { row, col } = msg;
    if (typeof row !== "number" || typeof col !== "number" || row < 0 || row > 2 || col < 0 || col > 2) {
      ws.send(JSON.stringify({ type: "error", info: "Nieprawidłowe współrzędne ruchu!" }));
      return;
    }

    if (room.board[row][col] !== "") {
      ws.send(JSON.stringify({ type: "error", info: "To pole jest już zajęte!" }));
      return;
    }

    // Wykonanie ruchu
    room.board[row][col] = symbol;
    room.currentTurn = (room.currentTurn + 1) % 2;

    // Aktualizacja planszy dla obu graczy
    room.clients.forEach((client, index) => {
      client.send(JSON.stringify({
        type: "boardUpdate",
        board: room.board,
        yourTurn: index === room.currentTurn
      }));
    });

    const result = checkWinner(room.board);
    if (result) {
      room.gameFinished = true;
      room.clients.forEach((client, index) => {
        client.send(JSON.stringify({
          type: result === "draw" ? "draw" : (index === (result === "X" ? 0 : 1) ? "win" : "lose")
        }));
      });
    }
  });

  ws.on("close", () => {
    room.clients = room.clients.filter(c => c !== ws);

    if (!room.gameFinished && room.clients.length === 1) {
      room.gameFinished = true;
      room.clients[0].send(JSON.stringify({ type: "win" }));
    }

    room.clients.forEach(client => {
      client.send(JSON.stringify({
        type: "roomStatus",
        status: `Graczy w pokoju: ${room.clients.length}`
      }));
    });

    if (room.clients.length === 0) {
      rooms.delete(roomKey);
    }
  });
});

/* ====== START SERWERA ====== */
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
