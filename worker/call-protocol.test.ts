import { describe, expect, it } from "vitest";
import { isClientId, parseClientSignal } from "./call-protocol";

describe("call signaling protocol", () => {
  it("accepts valid client ids", () => {
    expect(isClientId("12345678-abcd")).toBe(true);
    expect(isClientId("short")).toBe(false);
  });

  it("accepts the signaling messages used by WebRTC", () => {
    expect(parseClientSignal(JSON.stringify({ type: "ready" }))).toEqual({ type: "ready" });
    expect(parseClientSignal(JSON.stringify({
      type: "offer",
      description: { type: "offer", sdp: "v=0" },
    }))).toEqual({ type: "offer", description: { type: "offer", sdp: "v=0" } });
    expect(parseClientSignal(JSON.stringify({
      type: "ice",
      candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 },
    }))).toEqual({
      type: "ice",
      candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0, usernameFragment: null },
    });
  });

  it("rejects malformed or oversized signaling messages", () => {
    expect(parseClientSignal("not json")).toBeNull();
    expect(parseClientSignal(JSON.stringify({ type: "offer", description: { type: "answer", sdp: "v=0" } }))).toBeNull();
    expect(parseClientSignal(JSON.stringify({ type: "ice", candidate: { candidate: "x".repeat(5_000) } }))).toBeNull();
  });
});
