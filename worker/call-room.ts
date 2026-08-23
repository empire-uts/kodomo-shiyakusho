import { DurableObject } from "cloudflare:workers";
import { isClientId, isRoomCode, parseClientSignal, type ClientSignal } from "./call-protocol";

interface CallRoomEnv {
  DIAGNOSTIC_LOGGING?: string;
}

interface SocketAttachment {
  clientId: string;
  ready: boolean;
}

type ServerMessage =
  | { type: "joined"; peers: number }
  | { type: "peer-left" }
  | { type: "error"; code: string; message: string }
  | ClientSignal;

function readAttachment(socket: WebSocket): SocketAttachment | null {
  const value = socket.deserializeAttachment() as unknown;
  if (
    typeof value !== "object"
    || value === null
    || !("clientId" in value)
    || typeof value.clientId !== "string"
    || !("ready" in value)
    || typeof value.ready !== "boolean"
  ) return null;
  return { clientId: value.clientId, ready: value.ready };
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

export class CallRoom extends DurableObject<CallRoomEnv> {
  constructor(ctx: DurableObjectState, env: CallRoomEnv) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const room = url.searchParams.get("room")?.toUpperCase() ?? "";
    const clientId = url.searchParams.get("client") ?? "";
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    if (!isRoomCode(room) || !isClientId(clientId)) {
      return new Response("Invalid room or client", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const connected = this.openSockets();
    this.ctx.acceptWebSocket(server);

    if (connected.length >= 2) {
      send(server, { type: "error", code: "ROOM_FULL", message: "この通信番号は2台で使用中です。" });
      server.close(1008, "Room full");
      return new Response(null, { status: 101, webSocket: client });
    }

    server.serializeAttachment({ clientId, ready: false } satisfies SocketAttachment);
    send(server, { type: "joined", peers: connected.length + 1 });
    if (this.env.DIAGNOSTIC_LOGGING === "true") {
      console.log(JSON.stringify({ event: "call_signal_join", room, peers: connected.length + 1 }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, rawMessage: string | ArrayBuffer): void {
    const message = parseClientSignal(rawMessage);
    if (!message) {
      send(socket, { type: "error", code: "INVALID_SIGNAL", message: "通話信号を読み取れませんでした。" });
      return;
    }

    const attachment = readAttachment(socket);
    if (!attachment) {
      socket.close(1011, "Missing socket state");
      return;
    }

    if (message.type === "ready") {
      socket.serializeAttachment({ ...attachment, ready: true } satisfies SocketAttachment);
      return;
    }

    const peers = this.openSockets().filter((candidate) => candidate !== socket);
    if (message.type === "call") {
      const receiver = peers.find((candidate) => readAttachment(candidate)?.ready);
      if (!receiver) {
        send(socket, { type: "error", code: "NO_RECEIVER", message: "受信待ちの相手がいません。" });
        return;
      }
      send(receiver, message);
      return;
    }

    for (const peer of peers) send(peer, message);
  }

  webSocketClose(socket: WebSocket): void {
    for (const peer of this.openSockets().filter((candidate) => candidate !== socket)) {
      send(peer, { type: "peer-left" });
    }
  }

  webSocketError(socket: WebSocket, error: unknown): void {
    console.error(JSON.stringify({
      event: "call_signal_error",
      message: error instanceof Error ? error.message : String(error),
    }));
    for (const peer of this.openSockets().filter((candidate) => candidate !== socket)) {
      send(peer, { type: "peer-left" });
    }
    if (socket.readyState === WebSocket.OPEN) socket.close(1011, "Signaling error");
  }

  private openSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((socket) => socket.readyState === WebSocket.OPEN);
  }
}
