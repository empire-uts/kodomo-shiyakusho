import { useEffect, useRef, useState } from "react";
import {
  askQuestion,
  requestSpeech,
  transcribeAudio,
  type AssistantReply,
  type ConversationMessage,
} from "./api";
import { playAudioBlob, speakWithJapaneseVoice, startRadioNoise, unlockAudio } from "./audio";

type AppState = "idle" | "listening" | "sending" | "answer" | "error";

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
    hint: "文字でも同じ内容を確認できます",
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
  const [heardText, setHeardText] = useState("");
  const [playbackNote, setPlaybackNote] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopNoiseRef = useRef<(() => void) | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const historyRef = useRef<ConversationMessage[]>(loadHistory());
  const sessionIdRef = useRef(loadSessionId());

  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      stopNoiseRef.current?.();
      if (recordingTimerRef.current) window.clearTimeout(recordingTimerRef.current);
    };
  }, []);

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
    const nextHistory: ConversationMessage[] = [
      ...historyRef.current,
      { role: "user", content: message },
      { role: "assistant", content: nextReply.displayText },
    ].slice(-MAX_HISTORY_MESSAGES);
    historyRef.current = nextHistory;
    try {
      sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(nextHistory));
    } catch {
      // The current tab can continue even when storage is unavailable.
    }
  };

  const showReply = async (nextReply: AssistantReply, transcript = "") => {
    stopRadioNoise();
    setReply(nextReply);
    setHeardText(transcript);
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
      await showReply(nextReply, message);
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
      await showReply(nextReply, transcript);
    } catch (error) {
      showError(error instanceof Error ? error.message : "音声を読み取れませんでした。");
    }
  };

  const startRecording = async () => {
    setReply(null);
    setErrorMessage("");
    setHeardText("");
    setPlaybackNote("");
    await unlockAudio();

    if (!("MediaRecorder" in window) || !navigator.mediaDevices?.getUserMedia) {
      showError("この端末では録音を使えません。下の例題ボタンで試せます。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
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
      const message = error instanceof DOMException && error.name === "NotAllowedError"
        ? "マイクが使えません。ブラウザの設定でマイクを許可してください。"
        : "マイクを開始できませんでした。下の例題ボタンでも試せます。";
      showError(message);
    }
  };

  const stopRecording = () => {
    void unlockAudio();
    if (recordingTimerRef.current) window.clearTimeout(recordingTimerRef.current);
    beginSending();
    recorderRef.current?.stop();
  };

  const handleMainButton = () => {
    if (state === "listening") {
      stopRecording();
      return;
    }
    if (state === "sending") return;
    void startRecording();
  };

  const handleExample = (example: string) => {
    void unlockAudio();
    void sendQuestion(example);
  };

  const copy = stateCopy[state];

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

        <button
          className="talk-button"
          type="button"
          onClick={handleMainButton}
          disabled={state === "sending"}
          aria-label={state === "listening" ? "録音を止めて送る" : "録音を始める"}
        >
          <span className="talk-icon" aria-hidden="true">{state === "listening" ? "■" : "●"}</span>
          <span>{state === "listening" ? "送る" : state === "sending" ? "通信中" : "話す"}</span>
        </button>

        {state === "sending" && (
          <div className="signal-bars" aria-label="通信しています">
            <span /><span /><span /><span />
          </div>
        )}

        {state === "answer" && reply && (
          <article className="answer-card">
            {heardText && <p className="heard-text">「{heardText}」</p>}
            <p className="answer-text">{reply.displayText}</p>
            <div className="answer-actions">
              <button type="button" onClick={() => void speakReply(reply)}>もう一度聞く</button>
              <button type="button" onClick={() => setState("idle")}>続けて聞く</button>
            </div>
            {playbackNote && <p className="playback-note">{playbackNote}</p>}
            {reply.sourceUrl && (
              <a href={reply.sourceUrl} target="_blank" rel="noreferrer">富士見市の根拠を見る</a>
            )}
          </article>
        )}

        {state === "error" && (
          <div className="error-card" role="alert">
            <p>{errorMessage}</p>
            <button type="button" onClick={() => setState("idle")}>もう一度やる</button>
          </div>
        )}
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
