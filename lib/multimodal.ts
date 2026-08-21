import { getRuntimeEnv } from "./runtime-env";
import { RagError } from "./rag";
import { completeWithGateway, createTraceId, type GatewaySensitivity } from "./llm-gateway";
import { analyzeExcelBytes, EXCEL_MIME_TYPES } from "./excel";

export const MULTIMODAL_MIME_TYPES = new Set([
  ...EXCEL_MIME_TYPES,
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

const FILE_EXTENSION_MIME_TYPES: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroenabled.12",
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  webp: "image/webp", svg: "image/svg+xml", gif: "image/gif", bmp: "image/bmp",
  wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac", ogg: "audio/ogg",
  m4a: "audio/m4a", mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
  webm: "video/webm", mkv: "video/x-matroska", mpeg: "video/mpeg",
};

function normalizedMimeType(value?: string) {
  return value?.split(";")[0].trim().toLowerCase() || "";
}

export function resolveUploadMimeType(file: Pick<File, "name" | "type">) {
  const declared = normalizedMimeType(file.type);
  if (declared) return declared;
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return FILE_EXTENSION_MIME_TYPES[extension] || "application/octet-stream";
}

export function mediaSourceType(mimeType: string) {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "upload";
}

export function isExcelMimeType(mimeType: string) {
  return EXCEL_MIME_TYPES.has(normalizedMimeType(mimeType));
}

type MarkdownConversionResult = {
  format?: "markdown" | "text" | "error";
  mimetype?: string;
  data?: string;
  error?: string;
  tokens?: number;
};

export type MultimodalAnalysis = {
  markdown: string;
  parser: "cloud-markdown-conversion" | "xlsx-ooxml";
  modality: "image" | "document" | "audio" | "video";
  regions: Array<{
    pageNumber: number;
    regionType: "image" | "page" | "table" | "chart";
    bbox: [number, number, number, number] | null;
    caption: string;
    ocrText: string;
    tableMarkdown?: string;
    labels?: string[];
    labelSummary?: string;
    labelConfidence?: number;
    chartData?: StructuredChartData;
    visualId?: string;
  }>;
  visualAssets?: Array<{ id: string; name: string; mimeType: string; data: ArrayBuffer }>;
  tokens?: number;
};

export type StructuredChartData = {
  pageNumber: number;
  title?: string;
  chartType?: string;
  legend?: string;
  xAxis?: { label?: string; unit?: string; categories: string[] };
  yAxis?: { label?: string; unit?: string };
  series: Array<{ name: string; unit?: string; points: Array<{ x: string; y: number }> }>;
  summary?: string;
  confidence?: number;
  source?: "xlsx-chart-xml" | "ocr";
};

export function isMultimodalFile(file: Pick<File, "name" | "type">) {
  return MULTIMODAL_MIME_TYPES.has(resolveUploadMimeType(file));
}

function parseLabelResponse(value: string) {
  const json = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(json) as { regions?: Array<{ ordinal?: unknown; labels?: unknown; summary?: unknown; confidence?: unknown }> };
  if (!Array.isArray(parsed.regions)) return new Map<number, { labels: string[]; summary?: string; confidence?: number }>();
  const labels = new Map<number, { labels: string[]; summary?: string; confidence?: number }>();
  for (const item of parsed.regions) {
    const ordinal = Number(item.ordinal);
    if (!Number.isInteger(ordinal) || ordinal < 0) continue;
    const values = Array.isArray(item.labels)
      ? Array.from(new Set(item.labels.filter((label): label is string => typeof label === "string")
        .map((label) => label.trim().slice(0, 80)).filter(Boolean))).slice(0, 6)
      : [];
    const summary = typeof item.summary === "string" ? item.summary.trim().slice(0, 240) : undefined;
    const confidence = typeof item.confidence === "number" && Number.isFinite(item.confidence)
      ? Math.max(0, Math.min(1, item.confidence))
      : undefined;
    if (values.length || summary) labels.set(ordinal, { labels: values, summary, confidence });
  }
  return labels;
}

async function labelVisualRegions(
  regions: MultimodalAnalysis["regions"],
  sensitivity: GatewaySensitivity,
) {
  const candidates = regions.slice(0, 12).map((region, ordinal) => ({
    ordinal,
    page: region.pageNumber,
    type: region.regionType,
    evidence: `${region.caption}\n${region.ocrText}`.slice(0, 420),
  }));
  if (!candidates.length) return regions;
  try {
    const completion = await completeWithGateway([
      {
        role: "system",
        content: "You label document visual regions for retrieval. Return JSON only: {\"regions\":[{\"ordinal\":number,\"labels\":[string],\"summary\":string,\"confidence\":number}]}. Use only supplied evidence. Labels must be 1-6 concise Korean retrieval terms. Do not invent numbers, people, causes, or conclusions.",
      },
      { role: "user", content: JSON.stringify({ regions: candidates }) },
    ], createTraceId(), { sensitivity, maxOutputTokens: 900 }, "swift", false);
    const labels = parseLabelResponse(completion.content);
    return regions.map((region, ordinal) => {
      const label = labels.get(ordinal);
      return label ? { ...region, labels: label.labels, labelSummary: label.summary, labelConfidence: label.confidence } : region;
    });
  } catch (error) {
    console.warn("[multimodal] region labeling skipped", {
      error: error instanceof Error ? error.message : String(error),
    });
    return regions;
  }
}

function appendRegionLabels(markdown: string, regions: MultimodalAnalysis["regions"]) {
  const labeled = regions.filter((region) => region.labels?.length || region.labelSummary);
  if (!labeled.length) return markdown;
  const lines = labeled.map((region) => [
    `- page ${region.pageNumber} (${region.regionType})`,
    region.labelSummary ? `: ${region.labelSummary}` : "",
    region.labels?.length ? ` [labels: ${region.labels.join(", ")}]` : "",
  ].join(""));
  return `${markdown}\n\n## Visual retrieval labels\n${lines.join("\n")}`;
}

function parseJson(value: string) {
  return JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as unknown;
}

function stringValue(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function sourceContains(value: string, source: string) {
  return !value || source.toLocaleLowerCase().includes(value.toLocaleLowerCase());
}

function sourceContainsNumber(value: number, source: string) {
  const compact = source.replace(/,/g, "");
  const numeric = String(value).replace(/,/g, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}.])${numeric}(?![\\p{L}\\p{N}.])`, "u").test(compact);
}

/** Drops values that the conversion evidence cannot support, rather than inventing chart data. */
export function parseStructuredChartData(value: string, pageEvidence: Map<number, string>): StructuredChartData[] {
  let raw: { charts?: unknown };
  try { raw = parseJson(value) as { charts?: unknown }; } catch { return []; }
  if (!Array.isArray(raw.charts)) return [];
  return raw.charts.slice(0, 12).flatMap((item) => {
    const chart = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const pageNumber = Number(chart.pageNumber);
    const source = pageEvidence.get(pageNumber);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || !source) return [];
    const rawSeries = Array.isArray(chart.series) ? chart.series : [];
    const series = rawSeries.slice(0, 12).flatMap((candidate) => {
      const item = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
      const name = stringValue(item.name, 120);
      const points = (Array.isArray(item.points) ? item.points : []).slice(0, 200).flatMap((point) => {
        const row = point && typeof point === "object" ? point as Record<string, unknown> : {};
        const x = stringValue(row.x, 120);
        const y = Number(row.y);
        return x && Number.isFinite(y) && sourceContains(x, source) && sourceContainsNumber(y, source) ? [{ x, y }] : [];
      });
      return name && points.length ? [{ name, unit: stringValue(item.unit, 40) || undefined, points }] : [];
    });
    if (!series.length) return [];
    const xAxis = chart.xAxis && typeof chart.xAxis === "object" ? chart.xAxis as Record<string, unknown> : {};
    const yAxis = chart.yAxis && typeof chart.yAxis === "object" ? chart.yAxis as Record<string, unknown> : {};
    const categories = (Array.isArray(xAxis.categories) ? xAxis.categories : []).map((category) => stringValue(category, 120))
      .filter((category) => sourceContains(category, source)).slice(0, 200);
    const confidence = Number(chart.confidence);
    return [{
      pageNumber,
      title: stringValue(chart.title, 240) || undefined,
      xAxis: { label: stringValue(xAxis.label, 120) || undefined, unit: stringValue(xAxis.unit, 40) || undefined, categories },
      yAxis: { label: stringValue(yAxis.label, 120) || undefined, unit: stringValue(yAxis.unit, 40) || undefined },
      series,
      summary: stringValue(chart.summary, 500) || undefined,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : undefined,
    } satisfies StructuredChartData];
  });
}

async function extractStructuredCharts(markdown: string, sensitivity: GatewaySensitivity) {
  const pages = markdown.split(/\f|\n(?=#{1,3}\s*(?:page|페이지)\s*\d+)/i).map((page) => page.trim()).filter(Boolean);
  const evidence = new Map(pages.map((page, index) => [index + 1, page] as const)
    .filter(([, page]) => /(차트|그래프|도표|chart|graph|plot)/i.test(page))
    .slice(0, 12));
  if (!evidence.size) return [];
  try {
    const completion = await completeWithGateway([
      { role: "system", content: "Extract chart data from supplied OCR Markdown. Return JSON only: {\"charts\":[{\"pageNumber\":number,\"title\":string,\"xAxis\":{\"label\":string,\"unit\":string,\"categories\":[string]},\"yAxis\":{\"label\":string,\"unit\":string},\"series\":[{\"name\":string,\"unit\":string,\"points\":[{\"x\":string,\"y\":number}]}],\"summary\":string,\"confidence\":number}]}. Copy only values explicitly visible in the supplied evidence. Never interpolate, calculate, normalize, or infer missing values. Omit a series when its values are not explicit." },
      { role: "user", content: JSON.stringify({ pages: Array.from(evidence, ([pageNumber, content]) => ({ pageNumber, content: content.slice(0, 6_000) })) }) },
    ], createTraceId(), { sensitivity, maxOutputTokens: 2_000 }, "swift", false);
    return parseStructuredChartData(completion.content, evidence);
  } catch (error) {
    console.warn("[multimodal] chart extraction skipped", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

function appendStructuredCharts(markdown: string, charts: StructuredChartData[]) {
  if (!charts.length) return markdown;
  const data = charts.map((chart) => ({ ...chart, series: chart.series.map((series) => ({ ...series, points: series.points.slice(0, 80) })) }));
  return `${markdown}\n\n## Structured chart data\n${JSON.stringify(data)}`;
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
async function convertToMarkdown(
  name: string,
  mimeType: string,
  data: ArrayBuffer,
  sensitivity: GatewaySensitivity,
): Promise<MultimodalAnalysis> {
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

  const extractedMarkdown = converted.data.trim();
  const isImage = (mimeType || converted.mimetype || "").startsWith("image/");
  const charts = await extractStructuredCharts(extractedMarkdown, sensitivity);
  const regions = await labelVisualRegions(extractVisualRegions(extractedMarkdown, isImage).map((region) => {
    const chartData = region.regionType === "chart" ? charts.find((chart) => chart.pageNumber === region.pageNumber) : undefined;
    return chartData ? { ...region, chartData } : region;
  }), sensitivity);
  return {
    markdown: appendStructuredCharts(appendRegionLabels(extractedMarkdown, regions), charts),
    parser: "cloud-markdown-conversion",
    modality: isImage ? "image" : "document",
    tokens: converted.tokens,
    regions,
  };
}

async function analyzeExcel(
  name: string,
  data: ArrayBuffer,
  sensitivity: GatewaySensitivity,
): Promise<MultimodalAnalysis> {
  let excel;
  try {
    excel = analyzeExcelBytes(name, data);
  } catch (error) {
    throw new RagError(
      "엑셀 파일의 차트·셀 데이터를 안전하게 읽지 못했습니다.",
      422,
      "EXCEL_PARSE_FAILED",
    );
  }
  const regions: MultimodalAnalysis["regions"] = excel.charts.map((chart, index) => ({
    pageNumber: index + 1,
    regionType: "chart",
    bbox: null,
    caption: chart.summary || chart.title || "엑셀 네이티브 차트",
    ocrText: JSON.stringify(chart),
    chartData: chart,
  }));
  const imageMarkdown: string[] = [];
  for (const image of excel.images) {
    try {
      const analysis = await convertToMarkdown(image.name, image.mimeType, image.data, sensitivity);
      imageMarkdown.push(`## Embedded Excel image: ${image.name}\n${analysis.markdown}`);
      regions.push(...analysis.regions.map((region) => ({ ...region, visualId: image.id })));
    } catch (error) {
      console.warn("[multimodal] embedded Excel image analysis skipped", {
        name: image.name,
        error: error instanceof Error ? error.message : String(error),
      });
      regions.push({
        pageNumber: regions.length + 1,
        regionType: "image",
        bbox: null,
        caption: `엑셀 삽입 이미지: ${image.name}`,
        ocrText: "",
        visualId: image.id,
      });
    }
  }
  return {
    markdown: `${excel.markdown}${imageMarkdown.length ? `\n\n${imageMarkdown.join("\n\n")}` : ""}`,
    parser: "xlsx-ooxml",
    modality: "document",
    regions,
    visualAssets: excel.images,
  };
}

// `data` is the file already read by the caller. Taking it as an argument keeps
// a single copy of a large upload in memory instead of reading the file twice.
export async function analyzeMultimodalFile(
  file: File,
  data: ArrayBuffer,
  sensitivity: GatewaySensitivity = "internal",
): Promise<MultimodalAnalysis> {
  if (!isMultimodalFile(file)) {
    throw new RagError("XLSX/XLSM, PDF, 이미지(JPG/PNG/WebP/SVG/GIF/BMP), 오디오(WAV/MP3/FLAC/OGG/M4A), 비디오(MP4/MOV/WebM/MKV) 형식을 지원합니다.", 415, "UNSUPPORTED_MULTIMODAL_TYPE");
  }
  if (isExcelMimeType(resolveUploadMimeType(file))) return analyzeExcel(file.name, data, sensitivity);
  return convertToMarkdown(file.name, resolveUploadMimeType(file), data, sensitivity);
}

/**
 * Same conversion as `analyzeMultimodalFile`, for the queue consumer where only
 * the stored bytes and mime type are available (no `File`).
 */
export async function analyzeMultimodalBytes(
  name: string,
  mimeType: string,
  data: ArrayBuffer,
  sensitivity: GatewaySensitivity = "internal",
): Promise<MultimodalAnalysis> {
  const normalized = normalizedMimeType(mimeType);
  if (isExcelMimeType(normalized)) return analyzeExcel(name, data, sensitivity);
  return convertToMarkdown(name, normalized, data, sensitivity);
}
