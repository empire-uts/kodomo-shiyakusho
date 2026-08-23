import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  askQuestion,
  requestSpeech,
  transcribeAudio,
  type AssistantReply,
  type ConversationMessage,
} from "./api";
import { playAudioBlob, speakWithJapaneseVoice, startRadioNoise, unlockAudio } from "./audio";

type AppState = "idle" | "listening" | "sending" | "answer" | "error";
type MicrophonePermission = "unknown" | "prompt" | "requesting" | "granted" | "denied";

type ScrollStyle = CSSProperties & {
  "--scroll-roll": string;
  "--scroll-shift": string;
};

interface ScrollDrag {
  pointerId: number;
  startY: number;
  startScrollTop: number;
}

const HISTORY_STORAGE_KEY = "kodomo-shiyakusho:conversation";
const SESSION_STORAGE_KEY = "kodomo-shiyakusho:session-id";
const MAX_HISTORY_MESSAGES = 6;

function loadHistory(): ConversationMessage[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(HISTORY_STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    const history = value.filter((item): item is ConversationMessage => (
      typeof item === "object"
      && item !== null
      && ("role" in item && (item.role === "user" || item.role === "assistant"))
      && ("content" in item && typeof item.content === "string")
    ));
    return history.slice(-MAX_HISTORY_MESSAGES);
  } catch {
    return [];
  }
}

function loadSessionId(): string {
  try {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) return stored;
    const created = crypto.randomUUID();
    sessionStorage.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

const examples = [
  "アイロンは何ごみ？",
  "今日は何ごみ？",
  "自己紹介して",
  "お昼ごはん、何がいいと思う？",
];

const stateCopy: Record<AppState, { eyebrow: string; title: string; hint: string }> = {
  idle: {
    eyebrow: "いつでもどうぞ",
    title: "押して、話してください",
    hint: "話し終わったら、もう一度押します",
  },
  listening: {
    eyebrow: "きいています",
    title: "ゆっくり話してください",
    hint: "話し終わったら、もう一度押してください",
  },
  sending: {
    eyebrow: "通信中",
    title: "市役所に聞いています",
    hint: "そのまま、少しお待ちください",
  },
  answer: {
    eyebrow: "こども職員からです",
    title: "お返事が届きました",
    hint: "下の巻物にも記録しました",
  },
  error: {
    eyebrow: "もう一度できます",
    title: "うまく聞き取れませんでした",
    hint: "マイクに近づいて、ゆっくり話してください",
  },
};

function App() {
  const diagnosticLogging = import.meta.env.VITE_DIAGNOSTIC_LOGGING === "true";
  const deviceTtsOnly = import.meta.env.VITE_DEVICE_TTS === "true";
  const [state, setState] = useState<AppState>("idle");
  const [reply, setReply] = useState<AssistantReply | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [playbackNote, setPlaybackNote] = useState("");
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>(loadHistory);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isDraggingScroll, setIsDraggingScroll] = useState(false);
  const [microphonePermission, setMicrophonePermission] = useState<MicrophonePermission>("unknown");
  const [permissionMessage, setPermissionMessage] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopNoiseRef = useRef<(() => void) | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const historyRef = useRef<ConversationMessage[]>(conversationHistory);
  const sessionIdRef = useRef(loadSessionId());
  const scrollPaperRef = useRef<HTMLDivElement | null>(null);
  const scrollDragRef = useRef<ScrollDrag | null>(null);

  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      stopNoiseRef.current?.();
      if (recordingTimerRef.current) window.clearTimeout(recordingTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!("permissions" in navigator)) return;
    let permissionStatus: PermissionStatus | undefined;
    let active = true;
    const syncPermission = () => {
      if (!active || !permissionStatus) return;
      setMicrophonePermission(permissionStatus.state);
    };
    void navigator.permissions.query({ name: "microphone" as PermissionName })
      .then((status) => {
        if (!active) return;
        permissionStatus = status;
        syncPermission();
        status.addEventListener("change", syncPermission);
      })
      .catch(() => {
        // Some browsers do not expose microphone state through Permissions API.
      });
    return () => {
      active = false;
      permissionStatus?.removeEventListener("change", syncPermission);
    };
  }, []);

  useEffect(() => {
    const resumeAudio = () => {
      if (document.visibilityState === "visible") {
        void unlockAudio().catch(() => {
          // A later explicit button press will retry the unlock.
        });
      }
    };
    window.addEventListener("focus", resumeAudio);
    document.addEventListener("visibilitychange", resumeAudio);
    return () => {
      window.removeEventListener("focus", resumeAudio);
      document.removeEventListener("visibilitychange", resumeAudio);
    };
  }, []);

  useEffect(() => {
    const paper = scrollPaperRef.current;
    if (!paper) return;
    paper.scrollTop = paper.scrollHeight;
    const maxScroll = paper.scrollHeight - paper.clientHeight;
    setScrollProgress(maxScroll > 0 ? paper.scrollTop / maxScroll : 0);
  }, [conversationHistory]);

  const stopRadioNoise = () => {
    stopNoiseRef.current?.();
    stopNoiseRef.current = null;
  };

  const beginSending = () => {
    setState("sending");
    stopRadioNoise();
    stopNoiseRef.current = startRadioNoise();
  };

  const speakReply = async (nextReply: AssistantReply) => {
    setPlaybackNote("");
    if (!deviceTtsOnly) {
      try {
        const audio = await requestSpeech(nextReply.speechText);
        if (audio) {
          await playAudioBlob(audio);
          return;
        }
      } catch {
        // The browser voice below is an intentional fallback.
      }
    }

    if (!await speakWithJapaneseVoice(nextReply.speechText)) {
      setPlaybackNote("音声を再生できません。文字で確認してください。");
    } else {
      setPlaybackNote("端末の日本語音声で読み上げています。");
    }
  };

  const rememberExchange = (message: string, nextReply: AssistantReply) => {
    const nextHistory = [
      ...historyRef.current,
      { role: "user" as const, content: message },
      { role: "assistant" as const, content: nextReply.displayText },
    ].slice(-MAX_HISTORY_MESSAGES);
    historyRef.current = nextHistory;
    setConversationHistory(nextHistory);
    try {
      sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(nextHistory));
    } catch {
      // The current tab can continue even when storage is unavailable.
    }
  };

  const showReply = async (nextReply: AssistantReply) => {
    stopRadioNoise();
    setReply(nextReply);
    setState("answer");
    await speakReply(nextReply);
  };

  const showError = (message: string) => {
    stopRadioNoise();
    setErrorMessage(message);
    setState("error");
  };

  const sendQuestion = async (message: string) => {
    beginSending();
    try {
      const nextReply = await askQuestion(message, "example", {
        history: historyRef.current,
        sessionId: sessionIdRef.current,
      });
      rememberExchange(message, nextReply);
      await showReply(nextReply);
    } catch (error) {
      showError(error instanceof Error ? error.message : "通信に失敗しました。");
    }
  };

  const sendRecording = async (blob: Blob) => {
    try {
      if (blob.size < 1_000) {
        throw new Error("声が短すぎたようです。もう一度、ゆっくり話してください。");
      }
      const transcript = await transcribeAudio(blob);
      const nextReply = await askQuestion(transcript, "voice", {
        history: historyRef.current,
        sessionId: sessionIdRef.current,
      });
      rememberExchange(transcript, nextReply);
      await showReply(nextReply);
    } catch (error) {
      showError(error instanceof Error ? error.message : "音声を読み取れませんでした。");
    }
  };

  const requestMicrophonePermission = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      showError("この端末では録音を使えません。下の例題ボタンで試せます。");
      return;
    }
    setMicrophonePermission("requesting");
    setPermissionMessage("表示された確認で、マイクの使用を許可してください。");
    try {
      await unlockAudio();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicrophonePermission("granted");
      setPermissionMessage("マイクを使えます。話すボタンを押してください。");
      await unlockAudio();
    } catch (error) {
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      setMicrophonePermission(denied ? "denied" : "unknown");
      setPermissionMessage("");
      showError(denied
        ? "マイクが許可されていません。アドレスバー付近のサイト設定から、マイクを許可してください。"
        : "マイクの確認を完了できませんでした。もう一度試してください。");
    }
  };

  const startRecording = async () => {
    if (microphonePermission === "prompt" || microphonePermission === "denied") {
      await requestMicrophonePermission();
      return;
    }
    setReply(null);
    setErrorMessage("");
    setPlaybackNote("");
    setPermissionMessage("");
    try {
      await unlockAudio();
    } catch {
      // Recording may still work; the stop-button gesture retries audio unlock.
    }

    if (!("MediaRecorder" in window) || !navigator.mediaDevices?.getUserMedia) {
      showError("この端末では録音を使えません。下の例題ボタンで試せます。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      setMicrophonePermission("granted");
      await unlockAudio();
      const candidates = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
      const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        void sendRecording(blob);
      });

      recorder.start(500);
      setState("listening");
      recordingTimerRef.current = window.setTimeout(() => {
        if (recorder.state === "recording") {
          beginSending();
          recorder.stop();
        }
      }, 30_000);
    } catch (error) {
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      if (denied) setMicrophonePermission("denied");
      const message = denied
        ? "マイクが許可されていません。アドレスバー付近のサイト設定から、マイクを許可してください。"
        : error instanceof DOMException && error.name === "NotFoundError"
          ? "この端末に使えるマイクが見つかりませんでした。"
          : error instanceof DOMException && error.name === "NotReadableError"
            ? "マイクをほかのアプリが使用中です。閉じてから、もう一度試してください。"
            : "マイクを開始できませんでした。下の例題ボタンでも試せます。";
      showError(message);
    }
  };

  const stopRecording = async () => {
    try {
      await unlockAudio();
    } catch {
      // The visible replay control remains available if autoplay is blocked.
    }
    if (recordingTimerRef.current) window.clearTimeout(recordingTimerRef.current);
    beginSending();
    recorderRef.current?.stop();
  };

  const handleMainButton = () => {
    if (state === "listening") {
      void stopRecording();
      return;
    }
    if (state === "sending" || microphonePermission === "requesting") return;
    if (state === "idle" && (microphonePermission === "prompt" || microphonePermission === "denied")) {
      void requestMicrophonePermission();
      return;
    }
    void startRecording();
  };

  const handleExample = (example: string) => {
    void unlockAudio();
    void sendQuestion(example);
  };

  const updateScrollProgress = () => {
    const paper = scrollPaperRef.current;
    if (!paper) return;
    const maxScroll = paper.scrollHeight - paper.clientHeight;
    setScrollProgress(maxScroll > 0 ? paper.scrollTop / maxScroll : 0);
  };

  const beginScrollDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    if (event.nativeEvent.offsetX > event.currentTarget.clientWidth - 18) return;
    scrollDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: event.currentTarget.scrollTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDraggingScroll(true);
  };

  const moveScrollDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = scrollDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.currentTarget.scrollTop = drag.startScrollTop - (event.clientY - drag.startY);
  };

  const finishScrollDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = scrollDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    scrollDragRef.current = null;
    setIsDraggingScroll(false);
  };

  const permissionCopy = microphonePermission === "denied"
    ? {
        eyebrow: "マイクの設定が必要です",
        title: "マイクが許可されていません",
        hint: "サイト設定で許可してから、設定確認を押してください",
      }
    : microphonePermission === "requesting"
      ? {
          eyebrow: "ブラウザで確認中",
          title: "マイクの許可を待っています",
          hint: "表示された確認で、許可を選んでください",
        }
      : {
          eyebrow: "最初の準備",
          title: "マイクを許可してください",
          hint: "許可のあと、もう一度押すと録音が始まります",
        };
  const isPermissionStep = state === "idle"
    && (microphonePermission === "prompt" || microphonePermission === "requesting" || microphonePermission === "denied");
  const copy = isPermissionStep ? permissionCopy : stateCopy[state];
  const mainButtonLabel = microphonePermission === "requesting"
    ? "確認中"
    : state === "idle" && microphonePermission === "denied"
      ? "設定確認"
      : state === "idle" && microphonePermission === "prompt"
        ? "許可"
        : state === "listening"
          ? "送る"
          : state === "sending"
            ? "通信中"
            : "話す";
  const scrollStyle: ScrollStyle = {
    "--scroll-roll": `${scrollProgress * 540}deg`,
    "--scroll-shift": `${scrollProgress * 52}px`,
  };

  return (
    <main className="app-shell">
      {diagnosticLogging && (
        <p className="dev-log-notice" role="status">DEV版：発話の文字起こしと回答をログ記録中</p>
      )}
      <header className="topbar">
        <div>
          <p className="audience-label">高齢者向け音声案内</p>
          <h1>こども市役所</h1>
        </div>
        <div className="area-chip" aria-label="設定地域">富士見市・鶴瀬西</div>
      </header>

      <section className={`radio-panel state-${state}`} aria-labelledby="status-title">
        <div className="speaker-grid" aria-hidden="true">
          {Array.from({ length: 18 }, (_, index) => <span key={index} />)}
        </div>

        <div className="status" role="status" aria-live="assertive">
          <span className="status-light" aria-hidden="true" />
          <p>{copy.eyebrow}</p>
        </div>
        <h2 id="status-title">{copy.title}</h2>
        <p className="state-hint">{copy.hint}</p>
        {permissionMessage && <p className="permission-message" role="status">{permissionMessage}</p>}

        <div className="radio-controls">
          {state === "answer" && reply ? (
            <button className="radio-action radio-action-replay" type="button" onClick={() => void speakReply(reply)}>
              再生
            </button>
          ) : <span className="radio-action-placeholder" aria-hidden="true" />}

          <button
            className="talk-button"
            type="button"
            onClick={handleMainButton}
            disabled={state === "sending" || microphonePermission === "requesting"}
            aria-label={state === "listening" ? "録音を止めて送る" : "録音を始める"}
          >
            <span className="talk-icon" aria-hidden="true">{state === "listening" ? "■" : "●"}</span>
            <span>{mainButtonLabel}</span>
          </button>

          {state === "answer" && reply ? (
            <button className="radio-action radio-action-call" type="button" onClick={() => void startRecording()}>
              発信
            </button>
          ) : <span className="radio-action-placeholder" aria-hidden="true" />}
        </div>

        {state === "sending" && (
          <div className="signal-bars" aria-label="通信しています">
            <span /><span /><span /><span />
          </div>
        )}

        {state === "answer" && playbackNote && <p className="playback-note">{playbackNote}</p>}

        {state === "error" && (
          <div className="error-card" role="alert">
            <p>{errorMessage}</p>
            <button type="button" onClick={() => setState("idle")}>もう一度やる</button>
          </div>
        )}
      </section>

      <section className="desk-panel" aria-labelledby="history-title">
        <div className="desk-inlay">
          <header className="desk-heading">
            <p>これまでのやりとり</p>
            <h2 id="history-title">相談の巻物</h2>
          </header>

          <div className="scroll-shell" style={scrollStyle}>
            <div className="scroll-roller scroll-roller-top" aria-hidden="true">
              <span className="roller-knob" />
              <span className="roller-bar" />
              <span className="roller-knob" />
            </div>

            <div
              ref={scrollPaperRef}
              className={`scroll-paper${isDraggingScroll ? " is-dragging" : ""}`}
              role="log"
              aria-live="polite"
              aria-label="相談の履歴"
              tabIndex={0}
              onScroll={updateScrollProgress}
              onPointerDown={beginScrollDrag}
              onPointerMove={moveScrollDrag}
              onPointerUp={finishScrollDrag}
              onPointerCancel={finishScrollDrag}
            >
              <div className="scroll-content">
                {conversationHistory.length === 0 ? (
                  <p className="scroll-empty">相談すると、ここにやりとりが書き込まれます。</p>
                ) : conversationHistory.map((message, index) => (
                  <article className={`scroll-entry scroll-entry-${message.role}`} key={`${message.role}-${index}`}>
                    <p className="scroll-speaker">{message.role === "user" ? "あなた" : "こども職員"}</p>
                    <p className="scroll-message">{message.content}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="scroll-roller scroll-roller-bottom" aria-hidden="true">
              <span className="roller-knob" />
              <span className="roller-bar" />
              <span className="roller-knob" />
            </div>
          </div>

          <p className="scroll-help">上下にスクロール、または紙面をドラッグ</p>
          {state === "answer" && reply?.sourceUrl && (
            <a className="scroll-source" href={reply.sourceUrl} target="_blank" rel="noreferrer">
              富士見市の根拠を見る
            </a>
          )}
        </div>
      </section>

      <section className="examples" aria-labelledby="examples-title">
        <h2 id="examples-title">声を使わず試す</h2>
        <p>質問を選んで、こども職員の返事を試せます。</p>
        <div className="example-grid">
          {examples.map((example) => (
            <button key={example} type="button" onClick={() => handleExample(example)} disabled={state === "sending"}>
              {example}
            </button>
          ))}
        </div>
      </section>

      <footer>
        <p>これは子ども向けではなく、高齢者向けの試作アプリです。</p>
        <p>必要なときは、設定地域の公開情報を調べて答えます。</p>
      </footer>
    </main>
  );
}

export default App;
