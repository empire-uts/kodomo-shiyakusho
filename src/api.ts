export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ConversationContext {
  history: ConversationMessage[];
  sessionId: string;
}

export interface AssistantReply {
  displayText: string;
  speechText: string;
  sourceUrl?: string;
  toolsUsed?: string[];
}

interface ErrorPayload {
  error?: string;
  message?: string;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(timeoutMessage, { cause: error });
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as ErrorPayload;
  if (!response.ok) {
    throw new Error(body.message ?? body.error ?? "通信に失敗しました。");
  }
  return body as T;
}

export async function askQuestion(
  message: string,
  inputSource: "voice" | "example" = "example",
  context?: ConversationContext,
): Promise<AssistantReply> {
  const response = await fetchWithTimeout("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, inputSource, ...context }),
  }, 45_000, "返事に時間がかかっています。もう一度、短く話してください。");
  return parseResponse<AssistantReply>(response);
}

export async function transcribeAudio(audio: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", audio, "question.webm");
  const response = await fetchWithTimeout(
    "/api/transcribe",
    { method: "POST", body: form },
    45_000,
    "声の読み取りに時間がかかっています。もう一度、短く話してください。",
  );
  const result = await parseResponse<{ text: string }>(response);
  return result.text;
}

export async function requestSpeech(speechText: string): Promise<Blob | null> {
  const response = await fetchWithTimeout("/api/speech", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ speechText }),
  }, 18_000, "音声の作成に時間がかかっています。");

  if (!response.ok) return null;
  return response.blob();
}
