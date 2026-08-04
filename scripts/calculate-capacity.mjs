import { readFile } from "node:fs/promises";

const inputPath = process.argv[2] || new URL("../config/data-inventory.example.json", import.meta.url);
const survey = JSON.parse(await readFile(inputPath, "utf8"));
const assumptions = survey.assumptions || {};
const sources = Array.isArray(survey.sources) ? survey.sources : [];

const totals = sources.reduce((sum, source) => {
  const count = Number(source.documentCount || 0);
  const bytes = Number(source.averageBytes || 0);
  const monthly = Number(source.monthlyNewDocuments || 0);
  return {
    documents: sum.documents + count,
    sourceBytes: sum.sourceBytes + count * bytes,
    monthlyDocuments: sum.monthlyDocuments + monthly,
    unconfirmed: sum.unconfirmed + Number(!source.confirmed),
  };
}, { documents: 0, sourceBytes: 0, monthlyDocuments: 0, unconfirmed: 0 });

const years = Math.max(1, Number(assumptions.retentionYears || 1));
const growth = Math.max(0, Number(assumptions.annualGrowthRate || 0));
const replicas = Math.max(1, Number(assumptions.replicaFactor || 1));
const projectedDocuments = Math.ceil((totals.documents + totals.monthlyDocuments * 12 * years) * ((1 + growth) ** years));
const objectBytes = Math.ceil(totals.sourceBytes * ((1 + growth) ** years) * 1.15);
const searchBytes = Math.ceil(objectBytes * 0.35 * replicas);
const vectorBytes = Math.ceil(projectedDocuments * 8 * 1024 * replicas);

const gib = (bytes) => Number((bytes / 1024 ** 3).toFixed(2));
const result = {
  surveyVersion: survey.surveyVersion,
  status: totals.unconfirmed > 0 ? "survey_incomplete" : "calculated",
  inputs: {
    sources: sources.length,
    unconfirmedSources: totals.unconfirmed,
    documents: totals.documents,
    monthlyNewDocuments: totals.monthlyDocuments,
    peakConcurrentUsers: Number(assumptions.peakConcurrentUsers || 0),
  },
  projection: {
    retentionYears: years,
    projectedDocuments,
    objectStorageGiB: gib(objectBytes),
    searchStorageGiB: gib(searchBytes),
    vectorStorageGiB: gib(vectorBytes),
  },
  warning: totals.unconfirmed > 0 ? "발주사 데이터 소유자의 조사값 확인 전에는 조달 기준으로 사용할 수 없습니다." : undefined,
};

console.log(JSON.stringify(result, null, 2));
if (process.argv.includes("--require-confirmed") && totals.unconfirmed > 0) process.exitCode = 2;
