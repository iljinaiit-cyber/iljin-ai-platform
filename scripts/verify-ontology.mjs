/**
 * 온톨로지 추출 규칙 검증.
 *
 * 한국어에서 정규식 경계 처리를 틀리면 조용히 아무것도 매치되지 않는다.
 * dlp.ts 의 \b 사고가 그랬다 — 테스트가 없으면 "동작하는 것처럼 보이는" 상태로
 * 배포된다. 여기서 실제 한국어 문서 형태로 뽑히는지 확인한다.
 */
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../lib/ontology.ts", import.meta.url), "utf-8");

// TS 를 그대로 실행할 수 없으므로 규칙만 뽑아 같은 방식으로 재구성한다.
// 규칙이 바뀌면 이 파일도 같이 바뀌어야 한다 — 의도된 이중 기재다.
const RULES = [
  { kind: "document_no", pattern: /(?:[A-Z]{2,6}-){1,3}\d{2,6}(?:-\d{1,4})?/g },
  { kind: "revision", pattern: /(?:Rev\.?\s*|개정\s*)(\d{1,2})(?:\s*차)?/gi, group: 1 },
  { kind: "standard", pattern: /(?:KS\s?[A-Z]\s?\d{3,5}|ISO\s?\d{3,5}(?:-\d{1,3})?|IEC\s?\d{4,5}(?:-\d{1,3})?|ASTM\s?[A-Z]\d{2,4})/g },
  { kind: "equipment", pattern: /(?:EQ|LINE|M\/C)-\d{1,4}|\d{1,2}\s?호기/gi },
  { kind: "date", pattern: /\d{4}[-.]\d{1,2}[-.]\d{1,2}|\d{4}년\s?\d{1,2}월\s?\d{1,2}일/g },
];

function extract(text) {
  const out = [];
  for (const rule of RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = (rule.group ? m[rule.group] : m[0])?.trim();
      if (value) out.push({ kind: rule.kind, value });
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  return out;
}

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const ok = expected.every((e) => actual.some((a) => a.kind === e.kind && a.value === e.value));
  if (ok) { pass += 1; }
  else {
    fail += 1;
    console.log(`  ❌ ${label}`);
    console.log(`     기대: ${JSON.stringify(expected)}`);
    console.log(`     실제: ${JSON.stringify(actual)}`);
  }
};

console.log("온톨로지 L1 추출 검증");
console.log("=".repeat(58));

// 실제 사내 문서에 나올 법한 한국어 문장으로 검사한다.
check("한국어 문장 속 문서번호",
  extract("본 절차서(ILJIN-QA-2026-0421)는 품질관리 기준을 정한다."),
  [{ kind: "document_no", value: "ILJIN-QA-2026-0421" }]);

check("개정차수 — 한국어 표기",
  extract("본 문서는 개정 3차 기준으로 작성되었습니다."),
  [{ kind: "revision", value: "3" }]);

check("개정차수 — 영문 표기",
  extract("Document Rev.2 applies."),
  [{ kind: "revision", value: "2" }]);

check("KS 규격 (공백 있음)",
  extract("동박 두께는 KS D 3698 을 따른다."),
  [{ kind: "standard", value: "KS D 3698" }]);

check("ISO/IEC 규격",
  extract("ISO 9001 및 IEC 60079-1 인증 대상 설비"),
  [{ kind: "standard", value: "ISO 9001" }, { kind: "standard", value: "IEC 60079-1" }]);

check("설비 — 한국어 호기",
  extract("2호기 압연 라인에서 발생한 이상"),
  [{ kind: "equipment", value: "2호기" }]);

check("설비 — 영문 코드",
  extract("EQ-1042 점검 결과"),
  [{ kind: "equipment", value: "EQ-1042" }]);

check("일자 — 한국어 표기",
  extract("2026년 8월 6일 자로 시행한다."),
  [{ kind: "date", value: "2026년 8월 6일" }]);

check("일자 — 숫자 표기",
  extract("시행일: 2026-08-06"),
  [{ kind: "date", value: "2026-08-06" }]);

// 조사가 붙어도 잡혀야 한다. 한국어는 토큰 경계가 공백이 아니다.
check("조사 결합 — '을/를' 뒤 규격",
  extract("KS D 3698을 준수하며 EQ-1042는 예외다."),
  [{ kind: "standard", value: "KS D 3698" }, { kind: "equipment", value: "EQ-1042" }]);

// 오탐 방지 — 평범한 숫자가 문서번호로 잡히면 그래프가 쓰레기로 찬다.
const noise = extract("2026년 매출은 1234억원, 영업이익은 567억원이다.");
if (noise.some((n) => n.kind === "document_no")) {
  fail += 1;
  console.log(`  ❌ 오탐: 평문 숫자가 문서번호로 추출됨 — ${JSON.stringify(noise)}`);
} else { pass += 1; }

// 소스와 검증기 규칙이 어긋나지 않는지 — 규칙 개수 일치 확인
const sourceRuleCount = (source.match(/kind: "(document_no|revision|standard|equipment|date)"/g) || []).length;
if (sourceRuleCount !== RULES.length) {
  fail += 1;
  console.log(`  ❌ 규칙 개수 불일치: ontology.ts ${sourceRuleCount}개 vs 검증기 ${RULES.length}개`);
} else { pass += 1; }

console.log("=".repeat(58));
console.log(`검사 ${pass + fail}건 · 통과 ${pass} · 실패 ${fail}`);
if (fail) { console.log("실패 있음"); process.exit(1); }
console.log("전부 통과");
