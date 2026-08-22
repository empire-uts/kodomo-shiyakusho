import { describe, expect, it } from "vitest";
import { encodeAudioBase64 } from "./audio";

describe("encodeAudioBase64", () => {
  it("encodes binary audio bytes using the Workers AI string schema", () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    expect(encodeAudioBase64(bytes.buffer)).toBe("AAECf4D+/w==");
  });

  it("handles inputs larger than the spread argument limit", () => {
    const bytes = new Uint8Array(100_000);
    bytes.fill(42);
    expect(encodeAudioBase64(bytes.buffer)).toHaveLength(133_336);
  });
});
