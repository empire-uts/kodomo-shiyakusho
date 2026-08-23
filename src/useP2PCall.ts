import { useEffect, useRef, useState } from "react";

export type CallStatus = "idle" | "waiting" | "calling" | "incoming" | "connecting" | "connected" | "ended" | "error";

interface UseP2PCallOptions {
  disabled: boolean;
  onBeforeCall: () => void | Promise<void>;
}

interface UseP2PCallResult {
  status: CallStatus;
  message: string;
  receiveLabel: string;
  sendLabel: string;
  receiveDisabled: boolean;
  sendDisabled: boolean;
  active: boolean;
  incoming: boolean;
  onReceive: () => void;
  onSend: () => void;
}

type SignalMessage =
  | { type: "joined"; peers: number }
  | { type: "call" | "accept" | "hangup" | "cancel" | "peer-left" }
  | { type: "offer" | "answer"; description: RTCSessionDescriptionInit }
  | { type: "ice"; candidate: RTCIceCandidateInit }
  | { type: "error"; code: string; message: string };

const CALL_TIMEOUT_MS = 30_000;
const DISCONNECT_GRACE_MS = 6_000;
const ACTIVE_STATUSES = new Set<CallStatus>(["waiting", "calling", "incoming", "connecting", "connected"]);

function microphoneError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "マイクが許可されていません。サイト設定で許可してから、もう一度お試しください。";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "この端末に使えるマイクが見つかりませんでした。";
  }
  if (error instanceof DOMException && error.name === "NotReadableError") {
    return "マイクをほかの機能が使用中です。少し待ってから、もう一度お試しください。";
  }
  return "マイクを開始できませんでした。もう一度お試しください。";
}

export function useP2PCall({ disabled, onBeforeCall }: UseP2PCallOptions): UseP2PCallResult {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [message, setMessage] = useState("受信か発信を押してください。");
  const statusRef = useRef<CallStatus>(status);
  const socketRef = useRef<WebSocket | null>(null);
  const socketPromiseRef = useRef<Promise<WebSocket> | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const timeoutRef = useRef<number | null>(null);
  const disconnectTimerRef = useRef<number | null>(null);
  const intentionalCloseRef = useRef(false);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const onBeforeCallRef = useRef(onBeforeCall);

  useEffect(() => {
    onBeforeCallRef.current = onBeforeCall;
  }, [onBeforeCall]);

  const updateStatus = (nextStatus: CallStatus, nextMessage: string) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
    setMessage(nextMessage);
  };

  const clearTimers = () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    if (disconnectTimerRef.current !== null) window.clearTimeout(disconnectTimerRef.current);
    timeoutRef.current = null;
    disconnectTimerRef.current = null;
  };

  const releaseMedia = () => {
    clearTimers();
    peerRef.current?.close();
    peerRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    pendingCandidatesRef.current = [];
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
  };

  const closeSocket = () => {
    intentionalCloseRef.current = true;
    socketRef.current?.close(1000, "Call finished");
    socketRef.current = null;
    socketPromiseRef.current = null;
  };

  const finish = (nextStatus: "idle" | "ended" | "error", nextMessage: string, signal?: "hangup" | "cancel") => {
    const socket = socketRef.current;
    if (signal && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: signal }));
    releaseMedia();
    closeSocket();
    updateStatus(nextStatus, nextMessage);
  };

  const sendSignal = (payload: object) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("通話用の接続が切れています。");
    socket.send(JSON.stringify(payload));
  };

  const flushCandidates = async (peer: RTCPeerConnection) => {
    const candidates = pendingCandidatesRef.current.splice(0);
    for (const candidate of candidates) await peer.addIceCandidate(candidate);
  };

  const createPeer = async (): Promise<RTCPeerConnection> => {
    if (peerRef.current) return peerRef.current;
    if (!navigator.mediaDevices?.getUserMedia || !("RTCPeerConnection" in window)) {
      throw new Error("このブラウザでは音声通話を利用できません。");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    localStreamRef.current = stream;
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] });
    peerRef.current = peer;
    for (const track of stream.getTracks()) peer.addTrack(track, stream);

    peer.addEventListener("icecandidate", (event) => {
      if (!event.candidate) return;
      try {
        sendSignal({ type: "ice", candidate: event.candidate.toJSON() });
      } catch {
        finish("error", "通話用の接続が切れました。もう一度お試しください。");
      }
    });
    peer.addEventListener("track", (event) => {
      const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
      remoteAudioRef.current ??= new Audio();
      remoteAudioRef.current.autoplay = true;
      remoteAudioRef.current.srcObject = remoteStream;
      void remoteAudioRef.current.play().catch(() => {
        updateStatus("connected", "通話中です。音が出ない場合は、画面を一度押してください。");
      });
    });
    peer.addEventListener("connectionstatechange", () => {
      if (peer.connectionState === "connected") {
        clearTimers();
        updateStatus("connected", "通話中です。");
      } else if (peer.connectionState === "failed") {
        finish("error", "相手と接続できませんでした。もう一度お試しください。");
      } else if (peer.connectionState === "disconnected" && disconnectTimerRef.current === null) {
        disconnectTimerRef.current = window.setTimeout(() => {
          if (peer.connectionState === "disconnected") {
            finish("error", "相手との接続が切れました。もう一度お試しください。");
          }
        }, DISCONNECT_GRACE_MS);
      }
    });
    return peer;
  };

  const handleSignal = async (signal: SignalMessage) => {
    if (signal.type === "joined") return;
    if (signal.type === "call") {
      if (statusRef.current === "waiting") updateStatus("incoming", "着信しています。受信を押してください。");
      return;
    }
    if (signal.type === "accept" && statusRef.current === "calling") {
      const peer = peerRef.current;
      if (!peer) throw new Error("マイク接続を準備できませんでした。");
      updateStatus("connecting", "相手と接続しています。");
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      sendSignal({ type: "offer", description: peer.localDescription });
      return;
    }
    if (signal.type === "offer" && statusRef.current === "connecting") {
      const peer = peerRef.current;
      if (!peer) throw new Error("マイク接続を準備できませんでした。");
      await peer.setRemoteDescription(signal.description);
      await flushCandidates(peer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      sendSignal({ type: "answer", description: peer.localDescription });
      return;
    }
    if (signal.type === "answer" && statusRef.current === "connecting") {
      const peer = peerRef.current;
      if (!peer) throw new Error("マイク接続を準備できませんでした。");
      await peer.setRemoteDescription(signal.description);
      await flushCandidates(peer);
      return;
    }
    if (signal.type === "ice") {
      const peer = peerRef.current;
      if (!peer || !peer.remoteDescription) pendingCandidatesRef.current.push(signal.candidate);
      else await peer.addIceCandidate(signal.candidate);
      return;
    }
    if (signal.type === "hangup" || signal.type === "cancel" || signal.type === "peer-left") {
      if (ACTIVE_STATUSES.has(statusRef.current)) finish("ended", "通話が終了しました。");
      return;
    }
    if (signal.type === "error") {
      finish("error", signal.message);
    }
  };

  const connectSocket = (): Promise<WebSocket> => {
    const existing = socketRef.current;
    if (existing?.readyState === WebSocket.OPEN) return Promise.resolve(existing);
    if (socketPromiseRef.current) return socketPromiseRef.current;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const clientId = crypto.randomUUID();
    const url = `${protocol}//${window.location.host}/api/call/signal?client=${encodeURIComponent(clientId)}`;
    intentionalCloseRef.current = false;
    socketPromiseRef.current = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(url);
      socketRef.current = socket;
      const connectTimeout = window.setTimeout(() => {
        socket.close();
        reject(new Error("通話用の接続に時間がかかっています。もう一度お試しください。"));
      }, 10_000);
      socket.addEventListener("open", () => {
        window.clearTimeout(connectTimeout);
        resolve(socket);
      }, { once: true });
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        try {
          const signal = JSON.parse(event.data) as SignalMessage;
          void handleSignal(signal).catch((error: unknown) => {
            finish("error", error instanceof Error ? error.message : "通話を続けられませんでした。");
          });
        } catch {
          finish("error", "通話信号を読み取れませんでした。もう一度お試しください。");
        }
      });
      socket.addEventListener("error", () => {
        window.clearTimeout(connectTimeout);
        reject(new Error("通話用の接続を開始できませんでした。"));
      }, { once: true });
      socket.addEventListener("close", () => {
        window.clearTimeout(connectTimeout);
        socketPromiseRef.current = null;
        if (!intentionalCloseRef.current && ACTIVE_STATUSES.has(statusRef.current)) {
          releaseMedia();
          updateStatus("error", "通話用の接続が切れました。もう一度お試しください。");
        }
      });
    });
    return socketPromiseRef.current;
  };

  const prepare = async () => {
    await onBeforeCallRef.current();
    await connectSocket();
  };

  const startWaiting = async () => {
    if (disabled) return;
    try {
      await prepare();
      sendSignal({ type: "ready" });
      updateStatus("waiting", "受信待ちです。相手からの発信を待っています。");
    } catch (error) {
      finish("error", error instanceof Error ? error.message : "受信待ちを開始できませんでした。");
    }
  };

  const placeCall = async () => {
    if (disabled) return;
    try {
      await onBeforeCallRef.current();
      await createPeer();
      await connectSocket();
      sendSignal({ type: "call" });
      updateStatus("calling", "呼び出し中です。");
      timeoutRef.current = window.setTimeout(() => {
        finish("ended", "相手が応答しなかったため、呼び出しを終了しました。", "cancel");
      }, CALL_TIMEOUT_MS);
    } catch (error) {
      const message = error instanceof DOMException
        ? microphoneError(error)
        : error instanceof Error
          ? error.message
          : "発信を開始できませんでした。";
      finish("error", message);
    }
  };

  const acceptCall = async () => {
    try {
      await onBeforeCallRef.current();
      await createPeer();
      updateStatus("connecting", "相手と接続しています。");
      sendSignal({ type: "accept" });
    } catch (error) {
      const message = error instanceof DOMException
        ? microphoneError(error)
        : error instanceof Error
          ? error.message
          : "通話を開始できませんでした。";
      finish("error", message, "cancel");
    }
  };

  const onReceive = () => {
    if (statusRef.current === "idle" || statusRef.current === "ended" || statusRef.current === "error") {
      void startWaiting();
    } else if (statusRef.current === "incoming") {
      void acceptCall();
    } else {
      const wasConnected = statusRef.current === "connected" || statusRef.current === "connecting";
      finish("ended", wasConnected ? "通話を終了しました。" : "受信待ちを終了しました。", wasConnected ? "hangup" : "cancel");
    }
  };

  const onSend = () => {
    if (statusRef.current === "idle" || statusRef.current === "ended" || statusRef.current === "error" || statusRef.current === "waiting") {
      void placeCall();
    } else {
      const wasConnected = statusRef.current === "connected" || statusRef.current === "connecting";
      finish("ended", wasConnected ? "通話を終了しました。" : "呼び出しを終了しました。", wasConnected ? "hangup" : "cancel");
    }
  };

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    if (disconnectTimerRef.current !== null) window.clearTimeout(disconnectTimerRef.current);
    peerRef.current?.close();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    intentionalCloseRef.current = true;
    socketRef.current?.close(1000, "Page closed");
  }, []);

  const active = ACTIVE_STATUSES.has(status);
  const receiveLabel = status === "incoming"
    ? "受信"
    : status === "waiting"
      ? "受信停止"
      : status === "calling" || status === "connecting" || status === "connected"
        ? "通話終了"
        : "受信";
  const sendLabel = status === "calling"
    ? "中止"
    : status === "incoming"
      ? "拒否"
      : status === "connecting" || status === "connected"
        ? "通話終了"
        : "発信";

  return {
    status,
    message,
    receiveLabel,
    sendLabel,
    receiveDisabled: (disabled && !active) || status === "calling",
    sendDisabled: (disabled && !active) || status === "waiting",
    active,
    incoming: status === "incoming",
    onReceive,
    onSend,
  };
}
