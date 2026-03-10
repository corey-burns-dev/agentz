import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResult {
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [key: number]: SpeechRecognitionAlternative;
  readonly isFinal: boolean;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [key: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string | undefined;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const SpeechRecognition =
  typeof window !== "undefined"
    ? (window.SpeechRecognition ?? window.webkitSpeechRecognition)
    : undefined;

export type SpeechRecognitionStatus = "idle" | "starting" | "listening" | "error";

export interface SpeechRecognitionErrorState {
  code: string;
  message: string;
}

export function isSpeechRecognitionSupported(): boolean {
  return SpeechRecognition != null;
}

export function normalizeSpeechRecognitionError(code: string): SpeechRecognitionErrorState {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return {
        code,
        message: "Microphone access was blocked. Check your browser permissions.",
      };
    case "audio-capture":
      return {
        code,
        message: "No microphone was found. Connect one and try again.",
      };
    case "network":
      return {
        code,
        message: "Voice input hit a network error. Try again.",
      };
    case "no-speech":
      return {
        code,
        message: "No speech was detected. Try speaking again.",
      };
    case "start-failed":
      return {
        code,
        message: "Voice input could not start. Try again.",
      };
    default:
      return {
        code,
        message: "Voice input failed. Try again.",
      };
  }
}

export function isSpeechRecognitionActive(status: SpeechRecognitionStatus): boolean {
  return status === "starting" || status === "listening";
}

export interface UseSpeechRecognitionResult {
  isSupported: boolean;
  status: SpeechRecognitionStatus;
  isListening: boolean;
  start: () => void;
  stop: () => void;
  interimTranscript: string;
  finalTranscript: string;
  error: SpeechRecognitionErrorState | null;
}

export function useSpeechRecognition(options?: {
  disabled?: boolean;
  onFinalTranscript?: (text: string) => void;
}): UseSpeechRecognitionResult {
  const [status, setStatus] = useState<SpeechRecognitionStatus>("idle");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [error, setError] = useState<SpeechRecognitionErrorState | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onFinalTranscriptRef = useRef(options?.onFinalTranscript);
  const statusRef = useRef<SpeechRecognitionStatus>("idle");

  onFinalTranscriptRef.current = options?.onFinalTranscript;
  statusRef.current = status;

  const isSupported = SpeechRecognition != null;

  useEffect(() => {
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setStatus("listening");
    };

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let interim = "";
      let finalText = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results.item(i);
        if (!result) continue;
        const first = result.item(0) ?? result[0];
        const transcript = first?.transcript ?? "";

        if (result.isFinal) {
          finalText += transcript;
        } else {
          interim += transcript;
        }
      }

      setInterimTranscript(interim);
      if (finalText) {
        setFinalTranscript((prev) => {
          const next = prev + finalText;
          onFinalTranscriptRef.current?.(finalText);
          return next;
        });
        setError(null);
      }
    };

    recognition.onspeechstart = () => {
      setStatus("listening");
    };

    recognition.onspeechend = () => {
      setInterimTranscript("");
    };

    recognition.onend = () => {
      setInterimTranscript("");
      setStatus((current) => (current === "error" ? current : "idle"));
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      setInterimTranscript("");
      setError(normalizeSpeechRecognitionError(event.error));
      setStatus("error");
    };

    recognitionRef.current = recognition;
    return () => {
      try {
        recognition.abort();
      } catch {
        // Ignore cleanup failures.
      }
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!options?.disabled) return;
    if (statusRef.current === "idle") return;

    setInterimTranscript("");
    setError(null);
    setStatus("idle");
    try {
      recognitionRef.current?.stop();
    } catch {
      // Ignore stop failures when forcibly disabling voice input.
    }
  }, [options?.disabled]);

  const start = useCallback(() => {
    if (!recognitionRef.current || options?.disabled) return;
    if (isSpeechRecognitionActive(statusRef.current)) {
      return;
    }

    setError(null);
    setInterimTranscript("");
    setFinalTranscript("");
    setStatus("starting");
    try {
      recognitionRef.current.start();
    } catch {
      setError(normalizeSpeechRecognitionError("start-failed"));
      setStatus("error");
    }
  }, [options?.disabled]);

  const stop = useCallback(() => {
    if (!recognitionRef.current || statusRef.current === "idle") return;

    setInterimTranscript("");
    setError(null);
    setStatus("idle");
    try {
      recognitionRef.current.stop();
    } catch {
      // Ignore manual stop failures.
    }
  }, []);

  return {
    isSupported,
    status,
    isListening: isSpeechRecognitionActive(status),
    start,
    stop,
    interimTranscript,
    finalTranscript,
    error,
  };
}
