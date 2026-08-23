import { answerQuestion } from "./garbage-rules";
import { encodeAudioBase64 } from "./audio";
import { applyPersonaResult, PERSONA_MESSAGES } from "./persona";

interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

interface Env {
  AI?: AiBinding;
  AI_ENABLED?: string;
  DEMO_AREA?: string;
  DIAGNOSTIC_LOGGING?: string;
  LLM_ENABLED?: string;
  TTS_BASE_URL?: string;
  TTS_SHARED_SECRET?: string;
}

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function methodNotAllowed(): Response {
  return json({ error: "METHOD_NOT_ALLOWED", message: "この操作は使えません。" }, 405);
}

async function readJson<T>(request: Request, maxBytes = 2_048): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new Error("入力が長すぎます。");
  return request.json<T>();
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  try {
    const body = await readJson<{ message?: unknown; inputSource?: unknown }>(request);
    if (typeof body.message !== "string" || !body.message.trim()) {
      return json({ error: "INVALID_MESSAGE", message: "質問を話してください。" }, 400);
    }
    const message = body.message.trim().slice(0, 300);
    const baseReply = answerQuestion(message);
    let reply = baseReply;
    if (env.LLM_ENABLED === "true" && env.AI) {
      try {
        const result = await env.AI.run("@cf/qwen/qwen3-30b-a3b-fp8", {
          messages: PERSONA_MESSAGES(message, baseReply),
          max_tokens: 120,
          temperature: 0.75,
          top_p: 0.85,
          repetition_penalty: 1.08,
          response_format: { type: "json_object" },
          stream: false,
        });
        reply = applyPersonaResult(baseReply, result);
      } catch {
        reply = baseReply;
      }
    }
    if (env.DIAGNOSTIC_LOGGING === "true" && body.inputSource === "voice") {
      console.log({
        event: "voice_interaction",
        transcript: message,
        responseText: reply.displayText,
      });
    }
    return json(reply);
  } catch (error) {
    const message = error instanceof Error ? error.message : "質問を読み取れませんでした。";
    return json({ error: "INVALID_REQUEST", message }, 400);
  }
}

async function handleTranscribe(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  if (env.AI_ENABLED !== "true" || !env.AI) {
    return json({
      error: "AI_DISABLED",
      message: "音声認識はまだ接続準備中です。下の例題ボタンで試してください。",
    }, 503);
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 12 * 1024 * 1024) {
    return json({ error: "AUDIO_TOO_LARGE", message: "録音が長すぎます。短く話してください。" }, 413);
  }

  try {
    const form = await request.formData();
    const value = form.get("audio");
    if (!(value instanceof Blob) || value.size === 0) {
      return json({ error: "AUDIO_REQUIRED", message: "声が入っていません。もう一度話してください。" }, 400);
    }
    if (value.size > 12 * 1024 * 1024) {
      return json({ error: "AUDIO_TOO_LARGE", message: "録音が長すぎます。短く話してください。" }, 413);
    }

    const audio = encodeAudioBase64(await value.arrayBuffer());
    const result = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
      audio,
      language: "ja",
      task: "transcribe",
      vad_filter: true,
      condition_on_previous_text: false,
      initial_prompt: "富士見市、鶴瀬西、可燃ごみ、不燃ごみ、有害ごみ、乾電池、充電池、粗大ごみ、集積所",
    });
    const text = typeof result === "object" && result !== null && "text" in result
      ? String((result as { text: unknown }).text).trim()
      : "";
    if (!text) {
      return json({ error: "NO_SPEECH", message: "声を聞き取れませんでした。マイクに近づいて話してください。" }, 422);
    }
    return json({ text });
  } catch {
    return json({ error: "TRANSCRIBE_FAILED", message: "声を読み取れませんでした。もう一度試してください。" }, 502);
  }
}

async function handleSpeech(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  if (!env.TTS_BASE_URL || !env.TTS_SHARED_SECRET) {
    return json({ error: "TTS_DISABLED", message: "音声合成はまだ接続準備中です。" }, 503);
  }

  try {
    const body = await readJson<{ speechText?: unknown }>(request, 4_096);
    if (typeof body.speechText !== "string" || !body.speechText.trim()) {
      return json({ error: "TEXT_REQUIRED", message: "読み上げる文がありません。" }, 400);
    }
    const text = body.speechText.trim().slice(0, 300);
    const baseUrl = new URL(env.TTS_BASE_URL);
    if (baseUrl.protocol !== "https:") throw new Error("TTS endpoint must use HTTPS");
    const response = await fetch(new URL("/synthesize", baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.TTS_SHARED_SECRET}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(15_000),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.startsWith("audio/")) throw new Error("TTS request failed");
    return new Response(response.body, {
      headers: {
        "cache-control": "private, no-store",
        "content-type": contentType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return json({
      error: "TTS_FAILED",
      message: "音声を作れませんでした。文字で確認してください。",
      ...(env.DIAGNOSTIC_LOGGING === "true"
        ? { detail: error instanceof Error ? error.message : String(error) }
        : {}),
    }, 502);
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        area: env.DEMO_AREA ?? "未設定",
        aiEnabled: env.AI_ENABLED === "true",
        llmEnabled: env.LLM_ENABLED === "true",
        ttsEnabled: Boolean(env.TTS_BASE_URL && env.TTS_SHARED_SECRET),
      });
    }
    if (url.pathname === "/api/chat") return handleChat(request, env);
    if (url.pathname === "/api/transcribe") return handleTranscribe(request, env);
    if (url.pathname === "/api/speech") return handleSpeech(request, env);
    if (url.pathname.startsWith("/api/")) return json({ error: "NOT_FOUND", message: "この機能はありません。" }, 404);
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
