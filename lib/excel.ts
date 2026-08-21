import { strFromU8, unzipSync } from "fflate";
import type { StructuredChartData } from "./multimodal";

const MAX_XLSX_BYTES = 25 * 1024 * 1024;
const MAX_XLSX_EXPANDED_BYTES = 32 * 1024 * 1024;
const MAX_XLSX_ENTRIES = 2_000;
const MAX_EXCEL_CELLS = 2_000;
const MAX_EXCEL_IMAGES = 12;

export const EXCEL_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
]);

export type ExcelImage = {
  id: string;
  name: string;
  mimeType: string;
  data: ArrayBuffer;
};

export type ExcelAnalysis = {
  markdown: string;
  charts: StructuredChartData[];
  images: ExcelImage[];
};

type CellMap = Map<string, string>;

function xmlUnescape(value: string) {
  return value.replace(/&#x([0-9a-f]+);|&#(\d+);|&quot;|&apos;|&lt;|&gt;|&amp;/gi, (token, hex, decimal) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
    return { "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&" }[token.toLowerCase()] || token;
  });
}

function attribute(source: string, name: string) {
  return xmlUnescape(source.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1] || "");
}

function textIn(value: string) {
  return xmlUnescape(Array.from(value.matchAll(/<(?:[\w-]+:)?(?:t|v)\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?(?:t|v)>/gi))
    .map((match) => match[1].replace(/<[^>]+>/g, "")).join(""));
}

function block(value: string, name: string) {
  const tag = name.includes(":") ? name.replace(":", "\\:") : `(?:[\\w-]+:)?${name}`;
  return value.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "";
}

function blocks(value: string, name: string) {
  const tag = name.includes(":") ? name.replace(":", "\\:") : `(?:[\\w-]+:)?${name}`;
  return Array.from(value.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi")), (match) => match[1]);
}

function formula(blockValue: string) {
  return xmlUnescape(block(blockValue, "c:f").trim());
}

function cellAddress(reference: string) {
  const match = reference.replaceAll("$", "").match(/^([A-Z]+)(\d+)$/i);
  if (!match) return undefined;
  let column = 0;
  for (const char of match[1].toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
  return { column, row: Number(match[2]) };
}

function columnName(column: number) {
  let value = "";
  while (column > 0) {
    const mod = (column - 1) % 26;
    value = String.fromCharCode(65 + mod) + value;
    column = Math.floor((column - 1) / 26);
  }
  return value;
}

function valuesForFormula(value: string, cells: CellMap) {
  const match = value.replace(/^=/, "").match(/^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i);
  if (!match) return [];
  const sheet = (match[1] || match[2] || "").replaceAll("''", "'");
  const startColumn = cellAddress(`${match[3]}${match[4]}`)?.column;
  const startRow = Number(match[4]);
  const endColumn = cellAddress(`${match[5] || match[3]}${match[6] || match[4]}`)?.column;
  const endRow = Number(match[6] || match[4]);
  if (!sheet || !startColumn || !endColumn || !Number.isFinite(startRow) || !Number.isFinite(endRow)) return [];
  const values: string[] = [];
  for (let row = startRow; row <= endRow && values.length < 200; row += 1) {
    for (let column = startColumn; column <= endColumn && values.length < 200; column += 1) {
      const cell = cells.get(`${sheet}!${columnName(column)}${row}`);
      if (cell !== undefined && cell !== "") values.push(cell);
    }
  }
  return values;
}

function cachedValues(value: string) {
  return Array.from(value.matchAll(/<c:pt\b([^>]*)>([\s\S]*?)<\/c:pt>/gi), (match) => ({
    index: Number(attribute(match[1], "idx")),
    value: textIn(match[2]).trim(),
  })).filter((item) => Number.isInteger(item.index) && item.value !== "")
    .sort((left, right) => left.index - right.index).map((item) => item.value);
}

function chartTitle(value: string, cells: CellMap) {
  const title = block(value, "c:title");
  return textIn(title).trim() || valuesForFormula(formula(title), cells)[0] || undefined;
}

function axis(value: string, name: "c:catAx" | "c:valAx", cells: CellMap) {
  const axisBlock = block(value, name);
  return chartTitle(axisBlock, cells);
}

function chartType(value: string) {
  return value.match(/<c:([a-z]+Chart)\b/i)?.[1]?.replace(/Chart$/, "") || undefined;
}

function imageMimeType(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension === "png" ? "image/png"
    : extension === "jpg" || extension === "jpeg" ? "image/jpeg"
      : extension === "gif" ? "image/gif"
        : extension === "bmp" ? "image/bmp"
          : extension === "webp" ? "image/webp"
            : undefined;
}

function parseSharedStrings(xml: string | undefined) {
  return xml ? blocks(xml, "si").map(textIn) : [];
}

function sheetNamePaths(files: Record<string, Uint8Array>) {
  const workbook = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : "";
  const relationships = files["xl/_rels/workbook.xml.rels"] ? strFromU8(files["xl/_rels/workbook.xml.rels"]) : "";
  const targets = new Map(Array.from(relationships.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/gi), (match) => [attribute(match[1], "Id"), attribute(match[1], "Target")]));
  const sheets = Array.from(workbook.matchAll(/<(?:[\w-]+:)?sheet\b([^>]*)\/?>(?:<\/(?:[\w-]+:)?sheet>)?/gi), (match) => ({
    name: attribute(match[1], "name"),
    path: targets.get(attribute(match[1], "r:id")),
  })).flatMap((sheet) => {
    if (!sheet.name || !sheet.path) return [];
    const normalizedPath = sheet.path.replace(/^\/+/, "");
    return [{ name: sheet.name, path: (normalizedPath.startsWith("xl/") ? normalizedPath : `xl/${normalizedPath}`).replace(/\/[^/]+\/\.\.\//g, "/") }];
  });
  return sheets.length ? sheets : Object.keys(files).filter((name) => /^xl\/worksheets\/[^/]+\.xml$/i.test(name))
    .sort().map((path, index) => ({ name: `Sheet${index + 1}`, path }));
}

function parseCells(files: Record<string, Uint8Array>) {
  const sharedStrings = parseSharedStrings(files["xl/sharedStrings.xml"] ? strFromU8(files["xl/sharedStrings.xml"]) : undefined);
  const cells: CellMap = new Map();
  const lines: string[] = [];
  for (const sheet of sheetNamePaths(files)) {
    const source = files[sheet.path] ? strFromU8(files[sheet.path]) : "";
    for (const match of source.matchAll(/<(?:[\w-]+:)?c\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?c>/gi)) {
      if (cells.size >= MAX_EXCEL_CELLS) break;
      const reference = attribute(match[1], "r");
      const type = attribute(match[1], "t");
      const raw = textIn(match[2]);
      const value = type === "s" ? sharedStrings[Number(raw)] || "" : raw || textIn(block(match[2], "is"));
      if (!reference || !value.trim()) continue;
      cells.set(`${sheet.name}!${reference.replaceAll("$", "")}`, value.trim());
      lines.push(`- ${sheet.name}!${reference}: ${value.trim()}`);
    }
  }
  return { cells, lines };
}

function parseChart(xml: string, cells: CellMap, pageNumber: number): StructuredChartData | undefined {
  const series = blocks(xml, "c:ser").flatMap((seriesBlock) => {
    const categoriesBlock = block(seriesBlock, "c:cat");
    const valuesBlock = block(seriesBlock, "c:val");
    const categories = cachedValues(categoriesBlock);
    const values = cachedValues(valuesBlock);
    const sourceCategories = categories.length ? categories : valuesForFormula(formula(categoriesBlock), cells);
    const sourceValues = values.length ? values : valuesForFormula(formula(valuesBlock), cells);
    const points = sourceValues.slice(0, 200).flatMap((value, index) => {
      const y = Number(value.replace(/,/g, ""));
      return Number.isFinite(y) ? [{ x: sourceCategories[index] || String(index + 1), y }] : [];
    });
    const nameBlock = block(seriesBlock, "c:tx");
    const name = textIn(nameBlock).trim() || valuesForFormula(formula(nameBlock), cells)[0] || "series";
    return points.length ? [{ name, points }] : [];
  });
  if (!series.length) return undefined;
  const title = chartTitle(xml, cells);
  const categories = Array.from(new Set(series.flatMap((entry) => entry.points.map((point) => point.x))));
  const legendValue = xml.match(/<c:legendPos\b[^>]*\bval=["']([^"']+)/i)?.[1];
  return {
    pageNumber,
    title,
    chartType: chartType(xml),
    legend: legendValue,
    xAxis: { label: axis(xml, "c:catAx", cells), categories },
    yAxis: { label: axis(xml, "c:valAx", cells) },
    series,
    summary: `${title || "차트"}: ${series.map((entry) => `${entry.name} ${entry.points.length}개 값`).join(", ")}`,
    confidence: 1,
    source: "xlsx-chart-xml",
  };
}

/** Parses only safe OOXML entries needed for search; macros and formulas are never executed. */
export function analyzeExcelBytes(name: string, data: ArrayBuffer): ExcelAnalysis {
  if (!data.byteLength || data.byteLength > MAX_XLSX_BYTES) throw new Error("XLSX file is empty or exceeds the 25MB parsing limit.");
  let expanded = 0;
  let entries = 0;
  const files = unzipSync(new Uint8Array(data), {
    filter: (entry) => {
      entries += 1;
      expanded += entry.originalSize;
      if (entries > MAX_XLSX_ENTRIES || expanded > MAX_XLSX_EXPANDED_BYTES) throw new Error("XLSX archive expands beyond the safe parsing limit.");
      return /^xl\/(?:workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml|(?:charts|drawings\/charts)\/[^/]+\.xml|media\/[^/]+\.(?:png|jpe?g|gif|bmp|webp))$/i.test(entry.name);
    },
  });
  const { cells, lines } = parseCells(files);
  const charts = Object.keys(files).filter((path) => /^xl\/(?:charts|drawings\/charts)\/[^/]+\.xml$/i.test(path)).sort()
    .flatMap((path, index) => parseChart(strFromU8(files[path]), cells, index + 1) || []);
  const images = Object.keys(files).filter((path) => /^xl\/media\//i.test(path)).sort().slice(0, MAX_EXCEL_IMAGES).flatMap((path, index) => {
    const mimeType = imageMimeType(path);
    const bytes = files[path];
    if (!mimeType || !bytes) return [];
    const copy = new Uint8Array(bytes);
    return [{ id: `excel-image-${index + 1}`, name: path.split("/").pop() || path, mimeType, data: copy.buffer as ArrayBuffer }];
  });
  const chartLines = charts.flatMap((chart, index) => [
    `## Native chart ${index + 1}${chart.title ? `: ${chart.title}` : ""}`,
    `- type: ${chart.chartType || "unknown"}`,
    `- x-axis: ${chart.xAxis?.label || ""} ${chart.xAxis?.categories.join(", ") || ""}`.trim(),
    `- y-axis: ${chart.yAxis?.label || ""}`.trim(),
    `- legend: ${chart.legend || ""}`.trim(),
    ...chart.series.map((series) => `- ${series.name}: ${series.points.map((point) => `${point.x}=${point.y}`).join(", ")}`),
  ]);
  return {
    markdown: [`# Excel: ${name}`, "", "## Cell values", ...lines, ...(chartLines.length ? ["", ...chartLines] : [])].join("\n").slice(0, 500_000),
    charts,
    images,
  };
}
