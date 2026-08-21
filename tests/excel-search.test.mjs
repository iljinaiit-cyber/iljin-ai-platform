import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { strToU8, zipSync } from "fflate";

async function loadMultimodalForTest() {
  const { build } = await import("esbuild");
  const directory = await mkdtemp(join(tmpdir(), "iljin-excel-search-"));
  const outfile = join(directory, "multimodal.mjs");
  try {
    await build({
      entryPoints: [fileURLToPath(new URL("../lib/multimodal.ts", import.meta.url))],
      bundle: true,
      format: "esm",
      platform: "node",
      logLevel: "silent",
      outfile,
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    // The ESM loader retains the evaluated module after import, so the temporary
    // bundle can be removed before the assertions call its exports.
    await rm(directory, { recursive: true, force: true });
  }
}

test("XLSX parser preserves native chart values and embedded image assets", async () => {
  const { analyzeExcelBytes } = await import("../lib/excel.ts");
  const { analyzeMultimodalBytes } = await loadMultimodalForTest();
  const workbook = zipSync({
    "xl/workbook.xml": strToU8('<x:workbook><x:sheets><x:sheet name="Data" r:id="rId1"/></x:sheets></x:workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/sharedStrings.xml": strToU8('<x:sst><x:si><x:t>Quarter</x:t></x:si><x:si><x:t>Yield</x:t></x:si></x:sst>'),
    "xl/worksheets/sheet1.xml": strToU8('<x:worksheet><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c></x:row><x:row r="2"><x:c r="A2" t="str"><x:v>Q1</x:v></x:c><x:c r="B2"><x:v>98.4</x:v></x:c></x:row><x:row r="3"><x:c r="A3" t="str"><x:v>Q2</x:v></x:c><x:c r="B3"><x:v>99.1</x:v></x:c></x:row></x:sheetData></x:worksheet>'),
    "xl/charts/chart1.xml": strToU8('<c:chartSpace><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Quarterly Yield</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:ser><c:tx><c:v>Yield</c:v></c:tx><c:cat><c:strLit><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strLit></c:cat><c:val><c:numLit><c:pt idx="0"><c:v>98.4</c:v></c:pt><c:pt idx="1"><c:v>99.1</c:v></c:pt></c:numLit></c:val></c:ser></c:barChart><c:catAx><c:title><c:tx><c:rich><a:p><a:r><a:t>Quarter</a:t></a:r></a:p></c:rich></c:tx></c:title></c:catAx><c:valAx><c:title><c:tx><c:rich><a:p><a:r><a:t>Percent</a:t></a:r></a:p></c:rich></c:tx></c:title></c:valAx></c:plotArea><c:legend><c:legendPos val="r"/></c:legend></c:chart></c:chartSpace>'),
    "xl/drawings/charts/chart2.xml": strToU8('<c:chartSpace><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Quarterly Yield</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:ser><c:tx><c:v>Yield</c:v></c:tx><c:cat><c:strLit><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strLit></c:cat><c:val><c:numLit><c:pt idx="0"><c:v>98.4</c:v></c:pt><c:pt idx="1"><c:v>99.1</c:v></c:pt></c:numLit></c:val></c:ser></c:barChart><c:catAx><c:title><c:tx><c:rich><a:p><a:r><a:t>Quarter</a:t></a:r></a:p></c:rich></c:tx></c:title></c:catAx><c:valAx><c:title><c:tx><c:rich><a:p><a:r><a:t>Percent</a:t></a:r></a:p></c:rich></c:tx></c:title></c:valAx></c:plotArea><c:legend><c:legendPos val="r"/></c:legend></c:chart></c:chartSpace>'),
    "xl/media/image1.png": new Uint8Array([137, 80, 78, 71]),
  });
  const analysis = analyzeExcelBytes("yield.xlsx", workbook.buffer.slice(workbook.byteOffset, workbook.byteOffset + workbook.byteLength));

  assert.match(analysis.markdown, /Data!B2: 98.4/);
  assert.equal(analysis.charts.length, 2);
  assert.deepEqual(analysis.charts[0].series[0].points, [{ x: "Q1", y: 98.4 }, { x: "Q2", y: 99.1 }]);
  assert.equal(analysis.charts[0].xAxis?.label, "Quarter");
  assert.equal(analysis.charts[0].yAxis?.label, "Percent");
  assert.equal(analysis.charts[0].legend, "r");
  assert.equal(analysis.charts[0].source, "xlsx-chart-xml");
  assert.equal(analysis.images[0]?.mimeType, "image/png");

  const multimodal = await analyzeMultimodalBytes(
    "yield.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    workbook.buffer.slice(workbook.byteOffset, workbook.byteOffset + workbook.byteLength),
  );
  assert.equal(multimodal.parser, "xlsx-ooxml");
  assert.equal(multimodal.regions[0]?.chartData?.source, "xlsx-chart-xml");
  assert.equal(multimodal.visualAssets?.[0]?.mimeType, "image/png");
});

test("upload controls allow Excel workbooks", async () => {
  const [ingest, portal] = await Promise.all([
    import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/components/DocumentIngest.tsx", import.meta.url), "utf8")),
    import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/AgentPortal.tsx", import.meta.url), "utf8")),
  ]);
  assert.match(ingest, /\.xlsx,\.xlsm/);
  assert.match(portal, /\.xlsx,\.xlsm/);
});
