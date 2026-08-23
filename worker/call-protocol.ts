export const MAX_SIGNAL_BYTES = 32_768;

export type ClientSignalType = "ready" | "call" | "accept" | "offer" | "answer" | "ice" | "hangup" | "cancel";

export interface SessionDescriptionSignal {
  type: "offer" | "answer";
  sdp: string;
}

export interface IceCandidateSignal {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment: string | null;
}

export type ClientSignal =
  | { type: "ready" | "call" | "accept" | "hangup" | "cancel" }
  | { type: "offer" | "answer"; description: SessionDescriptionSignal }
  | { type: "ice"; candidate: IceCandidateSignal };

const SIMPLE_SIGNAL_TYPES = new Set<ClientSignalType>(["ready", "call", "accept", "hangup", "cancel"]);

export function isClientId(value: string): boolean {
  return /^[A-Za-z0-9-]{8,64}$/.test(value);
}

function parseNullableString(value: unknown, maxLength: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > maxLength) return undefined;
  return value;
}

export function parseClientSignal(value: string | ArrayBuffer): ClientSignal | null {
  const text = typeof value === "string" ? value : new TextDecoder().decode(value);
  if (new TextEncoder().encode(text).byteLength > MAX_SIGNAL_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !("type" in parsed) || typeof parsed.type !== "string") {
    return null;
  }

  const type = parsed.type as ClientSignalType;
  if (SIMPLE_SIGNAL_TYPES.has(type)) return { type } as ClientSignal;

  if (type === "offer" || type === "answer") {
    if (!("description" in parsed) || typeof parsed.description !== "object" || parsed.description === null) return null;
    const description = parsed.description as Record<string, unknown>;
    if (description.type !== type || typeof description.sdp !== "string" || description.sdp.length > 24_000) return null;
    return { type, description: { type, sdp: description.sdp } };
  }

  if (type === "ice") {
    if (!("candidate" in parsed) || typeof parsed.candidate !== "object" || parsed.candidate === null) return null;
    const candidate = parsed.candidate as Record<string, unknown>;
    const sdpMid = parseNullableString(candidate.sdpMid, 256);
    const usernameFragment = parseNullableString(candidate.usernameFragment, 256);
    if (
      typeof candidate.candidate !== "string"
      || candidate.candidate.length > 4_096
      || sdpMid === undefined
      || usernameFragment === undefined
      || !(candidate.sdpMLineIndex === null || candidate.sdpMLineIndex === undefined || Number.isInteger(candidate.sdpMLineIndex))
    ) return null;
    return {
      type,
      candidate: {
        candidate: candidate.candidate,
        sdpMid,
        sdpMLineIndex: typeof candidate.sdpMLineIndex === "number" ? candidate.sdpMLineIndex : null,
        usernameFragment,
      },
    };
  }

  return null;
}
