import { getRuntimeEnv } from "./runtime-env";
import { RagError } from "./rag";

export const MULTIMODAL_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
  "image/gif",
  "image/bmp",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/flac",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/webm",
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "video/x-matroska",
  "video/mpeg",
]);

type MarkdownConversionResult = {
  format?: "markdown" | "text" | "error";
  mimetype?: string;
  data?: string;
  error?: string;
  tokens?: number;
};

export type MultimodalAnalysis = {
  markdown: string;
  parser: "cloud-markdown-conversion";
  modality: "image" | "document" | "audio" | "video";
  regions: Array<{
    pageNumber: number;
    regionType: "image" | "page" | "table" | "chart";
    bbox: [number, number, number, number] | null;
    caption: string;
    ocrText: string;
    tableMarkdown?: string;
  }>;
  tokens?: number;
};

export function isMultimodalFile(file: Pick<File, "name" | "type">) {
  const type = file.type.split(";")[0].trim().toLowerCase();
  return MULTIMODAL_MIME_TYPES.has(type) || /\.(pdf|jpe?g|png|webp|svg|gif|bmp)$/i.test(file.name);
}

function conversionResult(value: unknown): MarkdownConversionResult {
  const result = Array.isArray(value) ? value[0] : value;
  if (!result || typeof result !== "object") {
    throw new RagError("멀티모달 변환 결과가 올바르지 않습니다.", 502, "MULTIMODAL_INVALID_RESPONSE");
  }
  return result as MarkdownConversionResult;
}

function extractVisualRegions(markdown: string, isImage: boolean): MultimodalAnalysis["regions"] {
  const pages = markdown
    .split(/\f|\n(?=#{1,3}\s*(?:page|페이지)\s*\d+)/i)
    .map((page) => page.trim())
    .filter(Boolean);
  const regions: MultimodalAnalysis["regions"] = [];
  (pages.length ? pages : [markdown]).slice(0, 100).forEach((page, pageIndex) => {
    const pageNumber = pageIndex + 1;
    const tables = page.match(/(?:^|\n)(?:\|[^\n]+\|\n\|(?:\s*:?-{3,}:?\s*\|)+\n(?:\|[^\n]+\|\n?)+)/gm) || [];
    tables.slice(0, 20).forEach((table) => regions.push({
      pageNumber,
      regionType: "table",
      bbox: null,
      caption: `페이지 ${pageNumber}의 표`,
      ocrText: table.trim(),
      tableMarkdown: table.trim(),
    }));
    if (/(차트|그래프|도표|chart|graph|plot)/i.test(page)) {
      regions.push({
        pageNumber,
        regionType: "chart",
        bbox: null,
        caption: page.slice(0, 1_000),
        ocrText: page,
      });
    }
    regions.push({
      pageNumber,
      regionType: isImage ? "image" : "page",
      bbox: [0, 0, 1, 1],
      caption: page.slice(0, 1_000),
      ocrText: page,
    });
  });
  return regions.slice(0, 128);
}

// Shared by the synchronous upload path (`analyzeMultimodalFile`, which has a
// `File`) and the queue consumer (which only has bytes + a stored mime type).
async function convertToMarkdown(name: string, mimeType: string, data: ArrayBuffer): Promise<MultimodalAnalysis> {
  if (!data.byteLength) {
    throw new RagError("업로드한 파일이 비어 있습니다.", 400, "MULTIMODAL_FILE_EMPTY");
  }

  const isAudio = mimeType.startsWith("audio/");
  const isVideo = mimeType.startsWith("video/");
  if (isAudio || isVideo) {
    const kindLabel = isAudio ? "오디오" : "비디오";
    const container = mimeType.split(";")[0].split("/")[1] || "unknown";
    const sizeLabel = data.byteLength >= 1_073_741_824
      ? `${(data.byteLength / 1_073_741_824).toFixed(1)} GB`
      : data.byteLength >= 1_048_576
        ? `${(data.byteLength / 1_048_576).toFixed(1)} MB`
        : data.byteLength >= 1024
          ? `${(data.byteLength / 1024).toFixed(0)} KB`
          : `${data.byteLength} B`;
    const markdown = [
      `# ${kindLabel} 파일: ${name}`,
      "",
      `- 파일명: ${name}`,
      `- 미디어 종류: ${kindLabel}`,
      `- MIME 형식: ${mimeType}`,
      `- 컨테이너: ${container}`,
      `- 파일 크기: ${sizeLabel} (${data.byteLength.toLocaleString()} bytes)`,
      "- 본문 분석: 이 형식은 텍스트 추출이 지원되지 않아 전사/메타데이터가 없습니다.",
    ].join("\n");
    return {
      markdown,
      parser: "cloud-markdown-conversion",
      modality: isAudio ? "audio" : "video",
      regions: [],
    };
  }

  const runtime = getRuntimeEnv();
  if (!runtime.AI || typeof runtime.AI.toMarkdown !== "function") {
    throw new RagError("Cloud LLM 문서·비전 변환 기능이 연결되지 않았습니다.", 503, "MULTIMODAL_PROVIDER_UNAVAILABLE");
  }

  let converted: MarkdownConversionResult;
  try {
    converted = conversionResult(await runtime.AI.toMarkdown(
      { name, blob: new Blob([data], { type: mimeType }) },
      { conversionOptions: { output: { format: "markdown" }, pdf: { metadata: false } } },
    ));
  } catch (error) {
    if (error instanceof RagError) throw error;
    // The upstream reason (size caps, unsupported structure) is only visible here,
    // so log it server-side rather than leaving every failure opaque.
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[multimodal] toMarkdown failed", {
      name, type: mimeType, bytes: data.byteLength,
      error: errorMsg,
    });
    // Provide a more specific error when the model doesn't support the input type
    if (/does not support (image|video|audio) input/i.test(errorMsg) || /unsupported (media|content) type/i.test(errorMsg)) {
      throw new RagError(
        `이미지·문서 변환 모델이 ${mimeType.split("/")[0]} 형식을 지원하지 않습니다. 관리자에게 VLM 모델 설정을 확인해 달라고 요청하세요.`,
        502,
        "MULTIMODAL_UNSUPPORTED_TYPE",
      );
    }
    throw new RagError("이미지·문서 내용을 분석하지 못했습니다.", 502, "MULTIMODAL_CONVERSION_FAILED");
  }
  if (converted.format === "error" || !converted.data?.trim()) {
    throw new RagError(converted.error || "파일에서 검색 가능한 내용을 추출하지 못했습니다.", 422, "MULTIMODAL_EMPTY_RESULT");
  }

  const markdown = converted.data.trim();
  const isImage = (mimeType || converted.mimetype || "").startsWith("image/");
  return {
    markdown,
    parser: "cloud-markdown-conversion",
    modality: isImage ? "image" : "document",
    tokens: converted.tokens,
    regions: extractVisualRegions(markdown, isImage),
  };
}

// `data` is the file already read by the caller. Taking it as an argument keeps
// a single copy of a large upload in memory instead of reading the file twice.
export async function analyzeMultimodalFile(file: File, data: ArrayBuffer): Promise<MultimodalAnalysis> {
  if (!isMultimodalFile(file)) {
    throw new RagError("PDF, 이미지(JPG/PNG/WebP/SVG/GIF/BMP), 오디오(WAV/MP3/FLAC/OGG/M4A), 비디오(MP4/MOV/WebM/MKV) 형식을 지원합니다.", 415, "UNSUPPORTED_MULTIMODAL_TYPE");
  }
  return convertToMarkdown(file.name, file.type, data);
}

/**
 * Same conversion as `analyzeMultimodalFile`, for the queue consumer where only
 * the stored bytes and mime type are available (no `File`).
 */
export async function analyzeMultimodalBytes(name: string, mimeType: string, data: ArrayBuffer): Promise<MultimodalAnalysis> {
  return convertToMarkdown(name, mimeType, data);
}
