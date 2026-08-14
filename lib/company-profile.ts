/**
 * 일진글로벌 회사 프로필의 단일 정본.
 * 제품명(ILJIN AI Works)과 회사 정체성을 분리해 화면·검색·LLM 프롬프트가
 * 서로 다른 업종으로 회사를 설명하지 않도록 한다.
 */
export const COMPANY_NAME = "일진글로벌";
export const COMPANY_INDUSTRY = "베어링 전문 제조 기업";
export const COMPANY_DESCRIPTION = `${COMPANY_NAME}은 ${COMPANY_INDUSTRY}입니다.`;

export const COMPANY_PRIORITY_INSTRUCTION = `회사·사업·제품·산업 맥락에서 "일진"이 다른 법인명을 명시하지 않고 단독으로 언급되면 ${COMPANY_NAME}(${COMPANY_INDUSTRY})을 1순위 기준으로 답하세요. 다른 일진 계열사나 동명이 기업으로 전환할 때는 질문에 명시된 근거나 출처가 있어야 합니다.`;

export const COMPANY_PROFILE_INSTRUCTION = `${COMPANY_DESCRIPTION} ${COMPANY_PRIORITY_INSTRUCTION} 회사의 업종이나 사업 맥락을 설명할 때 다른 업종으로 추정하거나 일반적인 IT 기업으로 표현하지 말고, 제공된 근거가 없으면 제품·사업 세부사항을 임의로 만들지 마세요.`;
