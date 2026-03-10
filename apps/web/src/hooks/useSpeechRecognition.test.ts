import { describe, expect, it } from "vitest";

import { isSpeechRecognitionActive, normalizeSpeechRecognitionError } from "./useSpeechRecognition";

describe("speech recognition helpers", () => {
  it("treats starting and listening as active states", () => {
    expect(isSpeechRecognitionActive("idle")).toBe(false);
    expect(isSpeechRecognitionActive("error")).toBe(false);
    expect(isSpeechRecognitionActive("starting")).toBe(true);
    expect(isSpeechRecognitionActive("listening")).toBe(true);
  });

  it("normalizes blocked microphone errors into a user-facing message", () => {
    expect(normalizeSpeechRecognitionError("not-allowed")).toEqual({
      code: "not-allowed",
      message: "Microphone access was blocked. Check your browser permissions.",
    });
  });

  it("falls back to a generic retry message for unknown errors", () => {
    expect(normalizeSpeechRecognitionError("unexpected")).toEqual({
      code: "unexpected",
      message: "Voice input failed. Try again.",
    });
  });
});
