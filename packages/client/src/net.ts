export type ClientMessage = Record<string, unknown> & { type: string };

export type ServerMessage =
  | { type: "room"; room: string; token: string; playerId: string }
  | { type: "state"; state: unknown }
  | { type: "error"; message: string }
  | { type: "ended"; winnerIds: string[] }
  | { type: "left" };

export class GameSocket {
  private ws: WebSocket | null = null;
  onMessage: ((msg: ServerMessage) => void) | null = null;
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;

  connect(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/ws`;
    this.ws = new WebSocket(url);
    this.ws.addEventListener("open", () => this.onOpen?.());
    this.ws.addEventListener("close", () => this.onClose?.());
    this.ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerMessage;
        this.onMessage?.(msg);
      } catch {
        /* ignore */
      }
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
