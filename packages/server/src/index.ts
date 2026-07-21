import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  detachSender,
  handleMessage,
  type ClientMessage,
  type ServerMessage,
} from "./room.js";

const PORT = Number(process.env.PORT ?? 3101);
const HOST = process.env.HOST ?? "0.0.0.0";

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Tower Defence World server — connect via WebSocket\n");
});

const wss = new WebSocketServer({ server, path: "/ws" });

interface SockCtx {
  roomCode?: string;
  playerId?: string;
}

wss.on("connection", (socket: WebSocket) => {
  const ctx: SockCtx = {};
  const send = (msg: ServerMessage) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  };

  socket.on("message", (data) => {
    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(String(data)) as ClientMessage;
    } catch {
      send({ type: "error", message: "Invalid JSON" });
      return;
    }
    const next = handleMessage(parsed, send, ctx);
    ctx.roomCode = next.roomCode;
    ctx.playerId = next.playerId;
  });

  socket.on("close", () => {
    if (ctx.roomCode && ctx.playerId) {
      detachSender(ctx.roomCode, ctx.playerId);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`TDW server listening on http://${HOST}:${PORT} (WS /ws)`);
});
