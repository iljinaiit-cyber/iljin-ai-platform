export type AnswerLength = "brief" | "standard" | "detailed";
export type AnswerFormat = "paragraph" | "bullets" | "table";

export function answerLengthInstruction(length: AnswerLength | undefined) {
  if (length === "brief") {
    return "핵심 결론을 첫 문장에 제시하고, 필수 근거와 다음 행동만 3~5개 항목 이내로 압축하세요.";
  }
  if (length === "detailed") {
    return "결론 → 근거와 분석 → 실행 순서 또는 권고안 → 리스크와 한계 순서로 충분히 설명하세요. 복합 질문은 관련 섹션을 빠짐없이 구성하세요.";
  }
  return "핵심 결론을 먼저 제시하고, 핵심 근거·실무 적용·주의사항을 균형 있게 설명하세요.";
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
