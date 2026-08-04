import { completeWithGateway, type GatewayMessage } from "./llm-gateway";
import { getRuntimeEnv } from "./runtime-env";

export type FollowUpQuestion = {
  question: string;
  intent: string;
};

const FOLLOW_UP_MARKER = "## 보충 질문";
const FOLLOW_UP_PATTERN = /##\s*보충\s*질문/i;
const RELATED_PATTERN = /##\s*연관\s*질문/i;

/**
 * Extract follow-up questions from LLM completion content.
 *
 * The LLM is instructed to append a `## 보충 질문` section at the end of its
 * answer when it determines that critical information is missing. This parser
 * strips the section from the content and returns the questions separately so
 * the UI can render them as clickable suggestions.
 *
 * Returns the cleaned content and the extracted questions.
 */
export function extractFollowUpQuestions(content: string): {
  content: string;
  followUpQuestions: FollowUpQuestion[];
} {
  const match = content.match(FOLLOW_UP_PATTERN);
  if (!match) return { content, followUpQuestions: [] };

  const splitIndex = match.index!;
  const cleanContent = content.slice(0, splitIndex).trimEnd();
  const section = content.slice(splitIndex + match[0].length).trim();

  const questions: FollowUpQuestion[] = [];
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const item = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (item) {
      const text = item[1].trim();
      const intentMatch = text.match(/\(([^)]+)\)$/);
      questions.push({
        question: intentMatch ? text.slice(0, intentMatch.index).trim() : text,
        intent: intentMatch ? intentMatch[1] : "정보 보충 필요",
      });
    }
  }

  return { content: cleanContent, followUpQuestions: questions };
}

/**
 * Extract related questions from LLM completion content.
 *
 * The LLM is instructed to append a `## 연관 질문` section at the end of
 * internet-grounded answers. This parser strips the section from the content
 * and returns the questions separately so the UI can render them as clickable
 * suggestions for further exploration.
 */
export function extractRelatedQuestions(content: string): {
  content: string;
  relatedQuestions: FollowUpQuestion[];
} {
  const match = content.match(RELATED_PATTERN);
  if (!match) return { content, relatedQuestions: [] };

  const splitIndex = match.index!;
  const cleanContent = content.slice(0, splitIndex).trimEnd();
  const section = content.slice(splitIndex + match[0].length).trim();

  const questions: FollowUpQuestion[] = [];
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const item = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (item) {
      const text = item[1].trim();
      const intentMatch = text.match(/\(([^)]+)\)$/);
      questions.push({
        question: intentMatch ? text.slice(0, intentMatch.index).trim() : text,
        intent: intentMatch ? intentMatch[1] : "연관 주제 탐색",
      });
    }
  }

  return { content: cleanContent, relatedQuestions: questions };
}

/**
 * Rewrite a multi-turn user query into a self-contained retrieval query.
 *
 * When the user asks a follow-up like "그건 누가 승인해?", the retrieval
 * system needs context from prior turns to form an effective search. This
 * function asks the LLM to produce a standalone query that preserves the
 * user's intent.
 */
export async function rewriteQuery(
  userQuery: string,
  conversationHistory: GatewayMessage[],
  traceId: string,
): Promise<string> {
  if (conversationHistory.length === 0) return userQuery;

  const recent = conversationHistory.slice(-6);
  const historyText = recent
    .map((m) => `${m.role === "user" ? "사용자" : "AI"}: ${m.content.slice(0, 500)}`)
    .join("\n");

  const prompt = `다음 대화 맥락에서 마지막 사용자 질문을 독립적인 검색 질의로 재작성하세요. 대명사(그것, 그건, 그것은, 그, 이, 저, 이것, 저것, 거기, 거기서, 그때, 이런, 그런, 그 사람, 그 담당자, 그 문서, 방금 것, 앞선, 이전)와 생략된 주어를 원래 대상으로 복원하고, 핵심 키워드를 포함한 한 문장으로 작성하세요. 답변은 재작성된 질의만 출력합니다.

대화:
${historyText}

재작성할 질문: ${userQuery}

재작성된 질의:`;

  try {
    const completion = await completeWithGateway(
      [{ role: "user", content: prompt }],
      traceId,
      { maxOutputTokens: 200, reasoningTier: "swift" },
      "swift",
    );
    const rewritten = completion.content.trim();
    return rewritten || userQuery;
  } catch {
    return userQuery;
  }
}

/**
 * Generate follow-up questions when RAG retrieval is insufficient.
 *
 * Called when the search finds no grounded evidence. Asks the LLM to produce
 * 1-3 clarifying questions that would help narrow down the user's intent.
 */
export async function generateInsufficiencyQuestions(
  userQuery: string,
  conversationHistory: GatewayMessage[],
  traceId: string,
): Promise<FollowUpQuestion[]> {
  const recent = conversationHistory.slice(-4);
  const historyText = recent.length > 0
    ? recent.map((m) => `${m.role === "user" ? "사용자" : "AI"}: ${m.content.slice(0, 300)}`).join("\n")
    : "(이전 대화 없음)";

  const prompt = `사용자가 사내 지식 베이스에 질문했지만 접근 가능한 근거 문서를 찾지 못했습니다. 사용자의 질문 의도를 파악하고, 답변에 필요한 정보를 얻기 위해 1~3개의 보충 질문을 작성하세요.

각 질문은 사용자가 직접 답할 수 있고, 질문의 목적이 명확해야 합니다. 형식: "1. 질문 내용 (질문 목적)"

대화:
${historyText}

질문: ${userQuery}`;

  try {
    const completion = await completeWithGateway(
      [{ role: "user", content: prompt }],
      traceId,
      { maxOutputTokens: 400, reasoningTier: "swift" },
      "swift",
    );
    const questions: FollowUpQuestion[] = [];
    for (const line of completion.content.split("\n")) {
      const trimmed = line.trim();
      const item = trimmed.match(/^\d+[.)]\s+(.+)$/);
      if (item) {
        const text = item[1].trim();
        const intentMatch = text.match(/\(([^)]+)\)$/);
        questions.push({
          question: intentMatch ? text.slice(0, intentMatch.index).trim() : text,
          intent: intentMatch ? intentMatch[1] : "정보 보충",
        });
      }
    }
    return questions.slice(0, 3);
  } catch {
    return [];
  }
}

/**
 * Append the follow-up questions instruction to a system prompt.
 *
 * The LLM will output a `## 보충 질문` section when it determines that
 * critical information is missing from the evidence.
 */
export const FOLLOW_UP_INSTRUCTION = `

답변을 완성한 후, 답변에 필요한 핵심 정보가 근거에서 충분히 확인되지 않았다면 답변 마지막에 다음 형식으로 보충 질문을 추가하세요:

## 보충 질문
1. 첫 번째 보충 질문 (질문 목적)
2. 두 번째 보충 질문 (질문 목적)

보충 질문은 사용자가 직접 답할 수 있고 답변 정확도를 높이는 데 필요한 정보만 묻습니다. 근거가 충분하면 보충 질문을 생략합니다.`;

export const RELATED_QUESTION_INSTRUCTION = `

답변을 완성한 후, 사용자가 이어서 탐색하면 유용한 연관 질문 3개를 답변 마지막에 다음 형식으로 추가하세요:

## 연관 질문
1. 첫 번째 연관 질문 (질문 목적)
2. 두 번째 연관 질문 (질문 목적)
3. 세 번째 연관 질문 (질문 목적)

연관 질문은 방금 답변한 주제와 자연스럽게 이어지는 심화·확장 질문으로, 사용자가 다음 단계로 알고 싶을 만한 내용을 제안합니다.`;
