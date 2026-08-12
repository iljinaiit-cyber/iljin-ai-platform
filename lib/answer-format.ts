export type AnswerLength = "brief" | "standard" | "detailed";
export type AnswerFormat = "paragraph" | "bullets" | "table";

const RESEARCH_QUERY_PATTERN = /(리서치|조사|현황|시장|산업|트렌드|동향|벤치마킹|사업계획서|경쟁사|업계|기업들|research|landscape|market|industry|benchmark)/i;
const AX_RESEARCH_QUERY_PATTERN = /(\bAX\b|AI\s*transformation|자율제조|스마트팩토리|AI\s*팩토리|제조업|중공업|생산·?품질|예지보전|피지컬\s*AI)/i;

export function isResearchQuery(query: string) {
  return RESEARCH_QUERY_PATTERN.test(query.trim());
}

export function isAxResearchQuery(query: string) {
  return isResearchQuery(query) && AX_RESEARCH_QUERY_PATTERN.test(query.trim());
}

export function inferAnswerFormat(query: string): AnswerFormat {
  const normalized = query.trim().toLowerCase();
  if (/(비교|차이|장단점|대안|선택|vs\.?|versus|compare|difference|trade-?off)/i.test(normalized)) {
    return "table";
  }
  if (/(방법|절차|단계|체크리스트|실행|계획|정리해|how to|step|checklist|plan)/i.test(normalized)) {
    return "bullets";
  }
  return "paragraph";
}

export function answerLengthInstruction(length: AnswerLength | undefined) {
  if (length === "brief") {
    return "핵심 결론을 첫 문장에 제시하고, 필수 근거와 다음 행동만 3~5문장 또는 3~5개 항목 이내로 압축하세요. 배경·반복·부가 설명은 생략하세요.";
  }
  if (length === "detailed") {
    return "역할: 15년 차 수석 시장 분석가이자 전문 리서치 컨설턴트입니다. 목표: 사용자의 질문을 핵심 조사 주제로 삼아 표면적인 요약을 넘어 심층 리서치를 수행하세요. 최신 웹 데이터·공식 보고서·통계·학술 또는 전문 자료를 우선하고, 핵심 사실은 가능한 한 두 개 이상의 신뢰할 수 있는 근거로 교차 검증하세요. 통계 수치·시장점유율·실제 사례를 근거가 있을 때 포함하고, 상반된 관점·잠재 리스크·자료의 한계를 균형 있게 설명하세요. 출처가 불분명한 소문은 배제하고, 확인된 사실·분석·가정을 구분하세요. 일반 심층 답변은 ## 개요 및 핵심 요약 → ## 상세 분석 내용 → ## 주요 데이터 및 인사이트 → ## 참고한 정보 출처 및 링크 순서를 따르되, 아래 리서치 브리프 규칙이 있으면 그 도메인별 구조와 표를 우선하세요. 근거가 부족한 정보는 만들지 말고 [확인 필요]로 표시하세요.";
  }
  return "표준 답변으로 작성하세요. 한 줄 결론을 먼저 제시한 뒤 5~7개의 짧은 섹션으로 현황·핵심 근거·원인 또는 영향·대안 비교·실무 적용·리스크와 한계·다음 행동을 질문에 맞게 다각도로 설명하세요. 근거가 있는 수치·조건·시점은 빠뜨리지 말고, 근거와 분석·권고를 구분하세요.";
}

export function answerOutputTokenBudget(length: AnswerLength | undefined) {
  return length === "brief" ? 600 : length === "detailed" ? 4_800 : 1_800;
}

export function answerReasoningTier(length: AnswerLength | undefined) {
  return length === "brief" ? "swift" as const : length === "detailed" ? "deep" as const : "expert" as const;
}

export function answerFormatInstruction(format: AnswerFormat | undefined) {
  if (format === "bullets") {
    return "목록형으로 작성하세요. 짧은 소제목 아래에 한 항목당 하나의 주장·근거·행동만 담고, 필요한 경우 하위 불릿으로 세부사항을 계층화하세요. 긴 문단을 불릿으로 위장하지 마세요.";
  }
  if (format === "table") {
    return "표형으로 작성하세요. 비교·조건·절차·역할처럼 열로 비교할 수 있는 정보는 Markdown 표로 정리하고, 표 아래에 해석과 권고를 덧붙이세요. 표가 부적절한 서술형 질문이면 핵심 항목/내용 표를 사용한 뒤 짧은 설명을 추가하세요.";
  }
  return "문단형으로 작성하세요. 짧은 소제목과 자연스러운 문단으로 설명하고, 불릿이나 표는 비교·절차를 명확히 하는 데 꼭 필요할 때만 사용하세요.";
}

export function answerPreferenceInstruction(length: AnswerLength | undefined, format: AnswerFormat | undefined, query = "") {
  const researchInstruction = isResearchQuery(query)
    ? isAxResearchQuery(query)
      ? "\nAX 심층 벤치마킹 브리프 규칙: 제조·중공업 기업의 AX 추진 현황을 사업계획서용 조사 보고서로 작성하세요. 답변 첫머리에 '도입률보다 스케일링·P&L·거버넌스가 경쟁 격차'처럼 조사에서 도출한 한 줄의 논지를 제시하고, 기준일·조사 범위·자료의 한계를 함께 밝히세요. 아래 7개 구조를 지키세요: ## TL;DR(핵심 결론 3~5개) → ## 1. AX 개념과 DX 대비 성숙도 → ## 2. 글로벌 도입·성과 지표(지표/수치/표본/조사시점/정의 표) → ## 3. 한국 기업·정부 정책 현황 → ## 4. 제조·중공업 유즈케이스와 KPI → ## 5. 주요 기업별 조직·플랫폼·투자·공개 성과 벤치마크 → ## 6. 성공·실패 요인과 추진 로드맵 → ## 7. 사업계획서용 시사점·권고안 → ## Caveats 및 출처. 기업 사례는 회사명·대상 업무·실행 방식·조직/플랫폼·투자 또는 규모·공개 성과·시점을 한 묶음으로 쓰고, 공개 성과가 없으면 '정량 성과 미공개'라고 표시하세요. 글로벌/한국/대기업/중견·중소를 같은 비교축으로 분리하고, 예지보전·비전검사·수요예측·문서자동화·에이전트·자율제조를 데이터 준비도·ROI 발생시점·리스크 관점에서 비교하세요. 정부 정책의 예산·목표치는 실측 성과와 분리하고, 조사기관 수치가 충돌하면 표본·정의·시점 차이를 설명하세요. 모든 핵심 수치에는 [Wn] 인용을 붙이고, 사실·출처 기반 해석·당사 권고를 각각 [사실]·[해석]·[권고]로 구분하세요. 근거가 없는 수치·기업 사례·인용은 만들지 말고 [확인 필요]로 남기세요."
      : "\n리서치 브리프 규칙: 기업·시장·산업 현황을 조사하는 질문입니다. 사업계획서에 인용할 수 있도록 먼저 한 줄의 핵심 결론과 조사 기준일·범위를 제시하세요. 그 다음 글로벌/국내 또는 규모·산업별 현황을 정량 근거와 함께 비교하고, 개별 기업 사례는 회사명·실행 내용·공개된 투자/조직/성과 지표·시점을 한 세트로 정리하세요. 여러 기업에서 반복되는 실행 패턴과 벤치마킹 포인트를 도출하고, 질문에 포함된 산업의 정책·시장·현장 적용 시사점을 별도로 설명하세요. ROI나 도입률 수치는 조사기관·표본·정의가 다르면 충돌을 숨기지 말고 나란히 제시하며, 사실·출처 기반 해석·권고를 구분하세요. 마지막에는 사업계획서에 바로 옮길 수 있는 논지, 실행 우선순위, 확인이 필요한 공백을 정리하세요. 근거가 없는 수치나 기업 사례는 만들지 말고 [확인 필요]로 표시하세요."
    : "";
  return `답변 분량 규칙: ${answerLengthInstruction(length)}\n답변 형식 규칙: ${answerFormatInstruction(format)}${researchInstruction}`;
}
