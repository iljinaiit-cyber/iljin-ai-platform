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
  issues: CitationIssue[];
  unused_citation_ids: string[];
};

const CITATION_RE = /\[(S\d{1,2})\]/g;
const SENTENCE_RE = /[^.!?。？！]+[.!?。？！]*/g;
const FACTUAL_HINT_RE = /\d|[A-Za-z]{2,}|니다|이다|한다|된다|있다/;
const NON_FACTUAL_PREFIX_RE = /^(결론|요약|정리하면|먼저|또한|한편|다음|참고|주의|리스크|한계)[\s:,]/;
const TOKEN_RE = /[\w][\w.:/-]*/g;
const MIN_OVERLAP_RATIO = 0.25;

export function verifyCitations(
  answer: string,
  evidence: Array<{ id: string; content: string }>,
): CitationReport {
  const validIds = new Set(evidence.map((e) => e.id));
  const evidenceById = new Map(evidence.map((e) => [e.id, e.content]));

  const sentences = (answer.match(SENTENCE_RE) || []).map((s) => s.trim()).filter(Boolean);
  const issues: CitationIssue[] = [];
  let factualCount = 0;
  let citedCount = 0;

  for (const sentence of sentences) {
    if (sentence.startsWith("|") || sentence.startsWith("#") || sentence.startsWith("⚠️")) continue;

    const citations = [...sentence.matchAll(CITATION_RE)].map((m) => m[1]);
    const isFactual = FACTUAL_HINT_RE.test(sentence) && !NON_FACTUAL_PREFIX_RE.test(sentence);

    if (citations.length > 0) {
      for (const cid of citations) {
        if (!validIds.has(cid)) {
          issues.push({
            kind: "phantom_citation",
            citation_id: cid,
            sentence,
            detail: `근거 ${cid}는 제공되지 않았습니다.`,
          });
        } else {
          const evContent = evidenceById.get(cid) || "";
          const evTokens = new Set((evContent.match(TOKEN_RE) || []).map((t) => t.toLowerCase()));
          const sentTokens = (sentence.match(TOKEN_RE) || []).map((t) => t.toLowerCase());
          if (evTokens.size > 0 && sentTokens.length > 0) {
            const overlap = sentTokens.filter((t) => evTokens.has(t)).length / sentTokens.length;
            if (overlap < MIN_OVERLAP_RATIO) {
              issues.push({
                kind: "unsupported_claim",
                citation_id: cid,
                sentence,
                detail: `${cid}와의 어휘 중복도 ${(overlap * 100).toFixed(0)}% (기준 ${MIN_OVERLAP_RATIO * 100}%)`,
              });
            }
          }
        }
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
    issues,
    unused_citation_ids: unused,
  };
}

export function annotateCitationIssues(content: string, report: CitationReport): string {
  let result = content;
  if (report.ok && report.issues.length === 0) return result;
  const lines: string[] = [];
  const phantoms = report.issues.filter((i) => i.kind === "phantom_citation");
  const uncited = report.issues.filter((i) => i.kind === "uncited_claim");
  const unsupported = report.issues.filter((i) => i.kind === "unsupported_claim");
  if (phantoms.length > 0) {
    for (const p of phantoms) {
      result = result.replace(new RegExp(`\\[${p.citation_id}\\]`, "g"), "");
    }
  }
  if (phantoms.length > 0 || uncited.length > 0 || unsupported.length > 0 || report.citation_coverage < 0.8) {
    lines.push("\n\n---\n⚠️ **근거 검증 경고**");
    if (phantoms.length > 0) {
      lines.push(`- 존재하지 않는 근거 인용(제거됨): ${phantoms.map((p) => p.citation_id).join(", ")}`);
    }
    if (uncited.length > 0) {
      lines.push(`- 근거 표기 없는 사실 서술: ${uncited.length}건`);
    }
    if (unsupported.length > 0) {
      lines.push(`- 근거와의 어휘 중복도 부족: ${unsupported.length}건`);
    }
    if (report.citation_coverage < 0.8) {
      lines.push(`- 인용 커버리지 ${(report.citation_coverage * 100).toFixed(0)}% (목표 80%)`);
    }
  }
  return lines.length > 0 ? result + lines.join("\n") : result;
}
