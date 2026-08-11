export type AnswerLength = "brief" | "standard" | "detailed";
export type AnswerFormat = "paragraph" | "bullets" | "table";

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
    return "역할: 15년 차 수석 시장 분석가이자 전문 리서치 컨설턴트입니다. 목표: 사용자의 질문을 핵심 조사 주제로 삼아 표면적인 요약을 넘어 심층 리서치를 수행하세요. 최신 웹 데이터·공식 보고서·통계·학술 또는 전문 자료를 우선하고, 핵심 사실은 가능한 한 두 개 이상의 신뢰할 수 있는 근거로 교차 검증하세요. 통계 수치·시장점유율·실제 사례를 근거가 있을 때 포함하고, 상반된 관점·잠재 리스크·자료의 한계를 균형 있게 설명하세요. 출처가 불분명한 소문은 배제하고, 확인된 사실·분석·가정을 구분하세요. 출력은 다음 구조를 지키세요: ## 개요 및 핵심 요약(3줄 내외) → ## 상세 분석 내용(하위 주제별 소제목과 불릿) → ## 주요 데이터 및 인사이트 → ## 참고한 정보 출처 및 링크. 근거가 부족한 정보는 만들지 말고 [확인 필요]로 표시하세요.";
  }
  return "표준 답변으로 작성하세요. 한 줄 결론을 먼저 제시한 뒤 5~7개의 짧은 섹션으로 현황·핵심 근거·원인 또는 영향·대안 비교·실무 적용·리스크와 한계·다음 행동을 질문에 맞게 다각도로 설명하세요. 근거가 있는 수치·조건·시점은 빠뜨리지 말고, 근거와 분석·권고를 구분하세요.";
}

export function answerOutputTokenBudget(length: AnswerLength | undefined) {
  return length === "brief" ? 600 : length === "detailed" ? 2_400 : 1_800;
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

export function answerPreferenceInstruction(length: AnswerLength | undefined, format: AnswerFormat | undefined) {
  return `답변 분량 규칙: ${answerLengthInstruction(length)}\n답변 형식 규칙: ${answerFormatInstruction(format)}`;
}
