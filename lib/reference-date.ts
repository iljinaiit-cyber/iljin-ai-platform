const formatter = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" });

export function referenceDateInSeoul(now = new Date()) {
  return formatter.format(now);
}

export function referenceYearInSeoul(now = new Date()) {
  return Number(referenceDateInSeoul(now).match(/\d{4}/)?.[0] || now.getUTCFullYear());
}

export function currentDateInstruction(now = new Date()) {
  const date = referenceDateInSeoul(now);
  const year = referenceYearInSeoul(now);
  return `최상위 날짜 규칙: 이 답변의 '현재·최신·최근 동향' 기준일은 ${date}입니다. ${year}년 이외의 연도를 '현재'로 표현하지 말고, 과거 사실은 반드시 당시 또는 기준 시점으로 구분하세요.`;
}

export function hasOutdatedCurrentYearClaim(content: string, now = new Date()) {
  const currentYear = referenceYearInSeoul(now);
  return [...content.matchAll(/((?:19|20)\d{2})년\s*(?:현재|현시점|지금)/g)]
    .some((match) => Number(match[1]) !== currentYear);
}

export function withReferenceDateHeader(content: string, now = new Date()) {
  if (/^>\s*기준일:/.test(content)) return content;
  return `> 기준일: ${referenceDateInSeoul(now)} · 검색 및 접근 가능 문서의 최신 확인 버전 기준\n\n${content}`;
}
