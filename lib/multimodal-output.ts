import { runCloudflareWorkersAiModel } from "./cloudflare-ai";
import { getRuntimeEnv } from "./runtime-env";

// ─── Content Blocks ─────────────────────────────────────────────────────────

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; url: string; prompt: string }
  | { type: "audio"; url: string; text: string };

// ─── TTS (Text-to-Speech) ────────────────────────────────────────────────────

const DEFAULT_TTS_MODEL = "@cf/myshell-ai/tts-ko";

export type TtsOptions = {
  model?: string;
  voice?: string;
  speed?: number;
};

/**
 * Convert text to speech via Cloudflare Workers AI.
 * Returns a data URL (base64-encoded audio/wav) that can be used directly in
 * an <audio> element's src attribute.
 */
export async function synthesizeSpeech(
  text: string,
  options: TtsOptions = {},
): Promise<string> {
  if (!text.trim()) throw new Error("TTS 변환할 텍스트가 비어 있습니다.");

  const runtime = getRuntimeEnv();
  const model = options.model || runtime.CLOUDFLARE_TTS_MODEL || DEFAULT_TTS_MODEL;

  const input: Record<string, unknown> = {
    prompt: text,
  };
  if (options.voice) input.voice = options.voice;
  if (options.speed) input.speed = options.speed;

  try {
    const result = await runCloudflareWorkersAiModel<{
      audio?: string;
      blob?: ArrayBuffer;
    }>(model, input, runtime, 30_000);

    // Cloudflare TTS returns base64-encoded audio in `audio` field,
    // or a binary blob. Handle both shapes.
    if (typeof result?.audio === "string") {
      // Already a data URL or base64 string
      if (result.audio.startsWith("data:")) return result.audio;
      return `data:audio/wav;base64,${result.audio}`;
    }

    if (result?.blob instanceof ArrayBuffer) {
      const bytes = new Uint8Array(result.blob);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      return `data:audio/wav;base64,${base64}`;
    }

    throw new Error("TTS 응답에서 오디오 데이터를 찾을 수 없습니다.");
  } catch (error) {
    // Re-throw with a clear message
    throw new Error(
      `TTS 변환에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ─── Image Generation ───────────────────────────────────────────────────────

const DEFAULT_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";

export type ImageGenOptions = {
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
};

/**
 * Generate an image from a text prompt via Cloudflare Workers AI (FLUX).
 * Returns a data URL (base64-encoded image/png).
 */
export async function generateImage(
  prompt: string,
  options: ImageGenOptions = {},
): Promise<string> {
  if (!prompt.trim()) throw new Error("이미지 생성 프롬프트가 비어 있습니다.");

  const runtime = getRuntimeEnv();
  const model = options.model || runtime.CLOUDFLARE_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;

  const input: Record<string, unknown> = {
    prompt,
    width: options.width || 1024,
    height: options.height || 1024,
    steps: options.steps || 4, // FLUX schnell uses 1-4 steps
  };

  try {
    const result = await runCloudflareWorkersAiModel<{
      image?: string;
      images?: string[];
      success?: boolean;
    }>(model, input, runtime, 60_000);

    // Cloudflare FLUX returns base64-encoded image in `image` or `images` field
    if (typeof result?.image === "string") {
      if (result.image.startsWith("data:")) return result.image;
      return `data:image/png;base64,${result.image}`;
    }

    if (Array.isArray(result?.images) && result.images.length > 0) {
      const first = result.images[0];
      if (first.startsWith("data:")) return first;
      return `data:image/png;base64,${first}`;
    }

    throw new Error("이미지 생성 응답에서 이미지 데이터를 찾을 수 없습니다.");
  } catch (error) {
    throw new Error(
      `이미지 생성에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ─── Multimodal Response Builder ────────────────────────────────────────────

/**
 * Build multimodal content blocks from a text answer.
 *
 * When `enableTts` is true, synthesizes the text into an audio data URL
 * and appends it as an audio content block after the text block.
 * When `imagePrompt` is provided, generates an image and appends it.
 */
export async function buildMultimodalBlocks(
  text: string,
  options: {
    enableTts?: boolean;
    ttsOptions?: TtsOptions;
    imagePrompt?: string;
    imageOptions?: ImageGenOptions;
  } = {},
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [{ type: "text", text }];

  if (options.imagePrompt) {
    try {
      const imageUrl = await generateImage(options.imagePrompt, options.imageOptions);
      blocks.push({ type: "image", url: imageUrl, prompt: options.imagePrompt });
    } catch {
      // Image generation is best-effort; don't fail the whole response
    }
  }

  if (options.enableTts) {
    try {
      const audioUrl = await synthesizeSpeech(text, options.ttsOptions);
      blocks.push({ type: "audio", url: audioUrl, text: text.slice(0, 200) });
    } catch {
      // TTS is best-effort; don't fail the whole response
    }
  }

  return blocks;
}
