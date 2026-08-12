export type CitationIssue = {
  kind: "phantom_citation" | "uncited_claim" | "unsupported_claim";
  citation_id?: string;
  sentence: string;
  detail: string;
};

export type CitationReport = {
  ok: boolean;
  citation_coverage: number;
  factual_sentence_count: number;
  cited_sentence_count: number;
  support_mode: "semantic" | "lexical";
  issues: CitationIssue[];
  unused_citation_ids: string[];
};

export type EmbedTexts = (texts: string[]) => Promise<number[][]>;

const CITATION_RE = /\[(S\d{1,2})\]/g;
const CITATION_ONLY_RE = /^(?:\[S\d{1,2}\][\s.,]*)+$/;
const SENTENCE_RE = /[^.!?。？！]+[.!?。？！]*/g;
const FACTUAL_HINT_RE = /\d|[A-Za-z]{2,}|니다|이다|한다|된다|있다/;
const NON_FACTUAL_PREFIX_RE = /^(결론|요약|정리하면|먼저|또한|한편|다음|참고|주의|리스크|한계)[\s:,]/;
const TOKEN_RE = /[\w][\w.:/-]*/g;
const MIN_OVERLAP_RATIO = 0.25;
const MIN_SEMANTIC_SIMILARITY = 0.5;
const WARN_COVERAGE_FLOOR = 0.8;
// 재작성은 LLM을 한 번 더 호출한다. 경고를 붙이는 기준(0.8)보다 낮게 잡아,
// 인용이 조금 빠진 정도로는 매 답변의 지연·비용을 두 배로 만들지 않는다.
const REPAIR_COVERAGE_FLOOR = 0.5;
// Bounds the extra embedding call: an answer citing more claims than this is
// already long enough that a sampled check is representative.
const MAX_SCORED_CLAIMS = 40;

type Claim = { sentence: string; citationId: string; text: string };

// 인용 표기 자체는 주장의 일부가 아니다. 남겨두면 근거에는 없는 토큰이 문장 쪽에만
// 더해져 어휘 중복도를 깎고, 임베딩에도 의미 없는 잡음이 섞인다.
function claimText(sentence: string) {
  return sentence.replace(CITATION_RE, " ").replace(/\s+/g, " ").trim();
}

// "…실시한다.[S1]" 처럼 종결부호 뒤에 붙은 인용은 별도 문장으로 잘려 원래 주장과
// 분리된다. 그러면 주장은 미인용으로, 남은 인용 조각은 미근거로 이중 오판된다.
function splitSentences(answer: string) {
  const merged: string[] = [];
  for (const raw of answer.match(SENTENCE_RE) || []) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (CITATION_ONLY_RE.test(sentence) && merged.length) merged[merged.length - 1] += ` ${sentence}`;
    else merged.push(sentence);
  }
  return merged;
}

function cosine(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function lexicalOverlap(sentence: string, evidence: string) {
  const evidenceTokens = new Set((evidence.match(TOKEN_RE) || []).map((token) => token.toLowerCase()));
  const sentenceTokens = (sentence.match(TOKEN_RE) || []).map((token) => token.toLowerCase());
  if (!evidenceTokens.size || !sentenceTokens.length) return 1;
  return sentenceTokens.filter((token) => evidenceTokens.has(token)).length / sentenceTokens.length;
}

// 어휘 중복만으로는 근거를 자기 표현으로 바꿔 쓴 정당한 문장이 미근거로 오판된다.
// 임베딩이 가능하면 문장-근거 의미 유사도로 판정하고, 실패하면 어휘 중복으로 내려간다.
async function scoreClaims(
  claims: Claim[],
  evidenceById: Map<string, string>,
  embed?: EmbedTexts,
): Promise<{ mode: CitationReport["support_mode"]; scores: number[] }> {
  if (embed && claims.length) {
    const citedIds = [...new Set(claims.map((claim) => claim.citationId))];
    try {
      const texts = [...claims.map((claim) => claim.text), ...citedIds.map((id) => evidenceById.get(id) || "")];
      const vectors = await embed(texts);
      if (vectors.length === texts.length) {
        const evidenceOffset = new Map(citedIds.map((id, index) => [id, claims.length + index]));
        return {
          mode: "semantic",
          scores: claims.map((claim, index) => cosine(vectors[index], vectors[evidenceOffset.get(claim.citationId)!])),
        };
      }
    } catch (error) {
      console.warn("[citation-guard] semantic verification failed, falling back to lexical overlap", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    mode: "lexical",
    scores: claims.map((claim) => lexicalOverlap(claim.text, evidenceById.get(claim.citationId) || "")),
  };
}

export async function verifyCitations(
  answer: string,
  evidence: Array<{ id: string; content: string }>,
  embed?: EmbedTexts,
): Promise<CitationReport> {
  const validIds = new Set(evidence.map((e) => e.id));
  const evidenceById = new Map(evidence.map((e) => [e.id, e.content]));

  const sentences = splitSentences(answer);
  const issues: CitationIssue[] = [];
  const claims: Claim[] = [];
  let factualCount = 0;
  let citedCount = 0;

  for (const sentence of sentences) {
    if (sentence.startsWith("|") || sentence.startsWith("#") || sentence.startsWith("⚠️")) continue;

    const citations = [...sentence.matchAll(CITATION_RE)].map((m) => m[1]);
    const isFactual = FACTUAL_HINT_RE.test(sentence) && !NON_FACTUAL_PREFIX_RE.test(sentence);
    const text = claimText(sentence);

    for (const cid of citations) {
      if (!validIds.has(cid)) {
        issues.push({
          kind: "phantom_citation",
          citation_id: cid,
          sentence,
          detail: `근거 ${cid}는 제공되지 않았습니다.`,
        });
      } else if (text && claims.length < MAX_SCORED_CLAIMS) {
        claims.push({ sentence, citationId: cid, text });
      }
    }

    if (isFactual) {
      factualCount++;
      if (citations.length > 0) citedCount++;
      else if (!sentence.includes("추가 확인") && !sentence.includes("제공된 문서에서 확인할 수 없")) {
        issues.push({
          kind: "uncited_claim",
          sentence,
          detail: "사실 서술에 근거 표기가 없습니다.",
        });
      }
    }
  }

  const { mode, scores } = await scoreClaims(claims, evidenceById, embed);
  const threshold = mode === "semantic" ? MIN_SEMANTIC_SIMILARITY : MIN_OVERLAP_RATIO;
  claims.forEach((claim, index) => {
    if (scores[index] >= threshold) return;
    issues.push({
      kind: "unsupported_claim",
      citation_id: claim.citationId,
      sentence: claim.sentence,
      detail: mode === "semantic"
        ? `${claim.citationId}와의 의미 유사도 ${(scores[index] * 100).toFixed(0)}% (기준 ${MIN_SEMANTIC_SIMILARITY * 100}%)`
        : `${claim.citationId}와의 어휘 중복도 ${(scores[index] * 100).toFixed(0)}% (기준 ${MIN_OVERLAP_RATIO * 100}%)`,
    });
  });

  const usedIds = new Set(
    (answer.match(CITATION_RE) || []).map((m) => m[1]).filter((id) => validIds.has(id)),
  );
  const unused = evidence.map((e) => e.id).filter((id) => !usedIds.has(id));

  const hasPhantom = issues.some((i) => i.kind === "phantom_citation");
  const coverage = factualCount > 0 ? citedCount / factualCount : 1;

  return {
    ok: !hasPhantom && coverage >= 0.8,
    citation_coverage: coverage,
    factual_sentence_count: factualCount,
    cited_sentence_count: citedCount,
    support_mode: mode,
    issues,
    unused_citation_ids: unused,
  };
}

export function needsCitationWarning(report: CitationReport) {
  return report.issues.length > 0 || report.citation_coverage < WARN_COVERAGE_FLOOR;
}

// 인용이 몇 개 빠진 정도는 경고로 충분하다. 없는 근거를 지어냈거나 인용한 근거와
// 내용이 어긋난 답변만 재작성 가치가 있다.
export function needsCitationRepair(report: CitationReport) {
  return report.issues.some((issue) => issue.kind === "phantom_citation" || issue.kind === "unsupported_claim")
    || report.citation_coverage < REPAIR_COVERAGE_FLOOR;
}

// 재작성본을 채택할지 판단하는 단일 기준: 지적 건수가 적을수록, 같으면 커버리지가 높을수록 낫다.
export function isCitationReportBetter(candidate: CitationReport, current: CitationReport) {
  if (candidate.issues.length !== current.issues.length) return candidate.issues.length < current.issues.length;
  return candidate.citation_coverage > current.citation_coverage;
}

export function annotateCitationIssues(content: string, report: CitationReport): string {
  if (!needsCitationWarning(report)) return content;
  let result = content;
  const phantoms = report.issues.filter((i) => i.kind === "phantom_citation");
  const uncited = report.issues.filter((i) => i.kind === "uncited_claim");
  const unsupported = report.issues.filter((i) => i.kind === "unsupported_claim");
  for (const p of phantoms) {
    result = result.replace(new RegExp(`\\[${p.citation_id}\\]`, "g"), "");
  }
  const lines = ["\n\n---\n⚠️ **근거 검증 경고**"];
  if (phantoms.length > 0) {
    lines.push(`- 존재하지 않는 근거 인용(제거됨): ${phantoms.map((p) => p.citation_id).join(", ")}`);
  }
  if (uncited.length > 0) {
    lines.push(`- 근거 표기 없는 사실 서술: ${uncited.length}건`);
  }
  if (unsupported.length > 0) {
    lines.push(report.support_mode === "semantic"
      ? `- 근거와 의미가 일치하지 않는 인용: ${unsupported.length}건`
      : `- 근거와의 어휘 중복도 부족: ${unsupported.length}건`);
  }
  if (report.citation_coverage < WARN_COVERAGE_FLOOR) {
    lines.push(`- 인용 커버리지 ${(report.citation_coverage * 100).toFixed(0)}% (목표 ${WARN_COVERAGE_FLOOR * 100}%)`);
  }
  return result + lines.join("\n");
}
