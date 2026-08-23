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
): Promise<AssistantReply> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, inputSource }),
  });
  return parseResponse<AssistantReply>(response);
}

export async function transcribeAudio(audio: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", audio, "question.webm");
  const response = await fetch("/api/transcribe", { method: "POST", body: form });
  const result = await parseResponse<{ text: string }>(response);
  return result.text;
}

export async function requestSpeech(speechText: string): Promise<Blob | null> {
  const response = await fetch("/api/speech", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ speechText }),
  });

  if (!response.ok) return null;
  return response.blob();
}
