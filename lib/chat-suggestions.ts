import { COMPANY_NAME } from "./company-profile";

export type ChatSuggestion = {
  id: string;
  category: "frequent" | "recent";
  label: string;
  question: string;
  meta: string;
};

// Shared by the initial client state and the activity API so fallback prompts
// stay aligned when no personal history or newly indexed documents exist yet.
export const FALLBACK_CHAT_SUGGESTIONS: ChatSuggestion[] = [
  {
    id: "default-safety",
    category: "frequent",
    label: "최신 안전 수칙 핵심 내용",
    question: "최신 안전 수칙의 핵심 내용과 현장 적용 항목을 요약해줘.",
    meta: "자주 찾는 업무 주제",
  },
  {
    id: "default-document-change",
    category: "frequent",
    label: "최신 문서 변경사항",
    question: "최신 문서의 변경사항을 확인해 적용 대상, 업무 영향, 실행 항목을 표로 정리해줘.",
    meta: "최신 업무 기준",
  },
  {
    id: "default-supply-chain",
    category: "recent",
    label: "최근 공급망 리스크",
    question: "최근 공급망 리스크 이슈를 공개 자료 기준으로 교차 검토하고, 우리 업무 영향과 대응 우선순위를 정리해줘.",
    meta: "최근 업무 이슈",
  },
  {
    id: "default-manufacturing-ai",
    category: "recent",
    label: "AI 활용 동향",
    question: `${COMPANY_NAME} 베어링 제조 업무에 적용할 수 있는 최근 AI 활용 동향을 공개 근거와 실무 사례로 정리해줘.`,
    meta: "최근 업무 이슈",
  },
];
