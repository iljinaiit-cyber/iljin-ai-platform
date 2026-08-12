# Web App 요구사항 추적 매트릭스 — 0~3단계 / G1·G2

- 기준일: 2026-07-22
- 요구사항 정본: `../../01_사업개요_및_요구사항.md`
- 상세 설계 정본: `../../06_DB_API_Design.md`, `../../07_UI_UX_Admin_Design.md`
- 구현 기준선: 현재 `web-app` 소스와 자동 테스트
- 범위: 0단계 분석, 1단계 PoC, 2단계 Platform, 3단계 Document RAG 및 Gate G1/G2

## 상태 판정 기준

| 상태 | 판정 기준 |
|---|---|
| 구현 | 요구사항의 핵심 동작이 실제 코드로 연결되어 있고 검증할 수 있음 |
| 부분 | 화면·Mock·API 일부는 있으나 인증, 데이터, 영속화, 품질 기준 또는 E2E 연결이 빠짐 |
| 미구현 | 정적 표시에 그치거나 대응 코드·데이터·검증 산출물이 없음 |

현재 앱은 반응형 Portal, 로컬·Cloudflare AI Gateway, D1/R2 기반 Document RAG 기술 PoC를 갖췄다. 텍스트 문서 수집·청킹·Cloudflare 임베딩, Hybrid Search·재정렬, 부서 ACL, Evidence Gate, Citation 결과 UI까지 실제 연결되어 있다. 다만 기업 SSO 기반 Principal, PDF 등 핵심 문서 파서, 확정 KPI와 정식 Gate 증빙이 남아 있으므로 G1과 G2는 **부분 통과**로 판정한다.

## 현재 구현·검증 기준선

| 영역 | 구현 근거 | 확인 결과 |
|---|---|---|
| 저장·Migration | [`db/schema.ts`](../db/schema.ts), [`drizzle/0000_chief_tempest.sql`](../drizzle/0000_chief_tempest.sql) | `assets`, `segments`, `index_jobs`, `retrieval_traces`와 인덱스 정의 |
| 수집·검색·근거 | [`lib/rag.ts`](../lib/rag.ts) | R2 원문, D1 Metadata·Segment·Embedding, BM25-like+Dense, 선택적 Reranker, Evidence Gate, Citation ACL 재검증 |
| API | [`assets`](../app/api/v1/assets/route.ts), [`search`](../app/api/v1/search/route.ts), [`citations`](../app/api/v1/citations/route.ts), [`chat`](../app/api/v1/chat/completions/route.ts) | 문서 수집·목록, 실제 검색, 근거 조회, RAG Chat 연결 |
| 사용자 UI | [`DocumentIngest.tsx`](../app/components/DocumentIngest.tsx), [`RagResults.tsx`](../app/components/RagResults.tsx) | 문서 등록, 실제 검색 결과, 점수·페이지·Chunk, 인용문 Highlight |
| 자동 검사 | [`tests/rendered-html.test.mjs`](../tests/rendered-html.test.mjs) | Schema·Migration·RAG 함수·API·UI·Hosting Binding 정적/통합 구조 검사 포함 |

### 2026-07-22 실검증 기록

| 검증 | 실제 결과 | 판정 |
|---|---|---|
| Document RAG 검색 | 인덱싱 문서에 대한 실제 검색 성공 | 통과 |
| 부서 ACL Negative/Positive | 동일 제한 문서에 대해 `DX전략팀` 0건, `품질팀` 1건 | Smoke 통과 |
| 근거 부족 차단 | 무근거 질문에서 LLM 생성 전 HTTP `422` 반환 | 통과 |

이 결과는 기능 Smoke 증빙이다. 확정 Golden Dataset의 KPI 측정이나 기업 IdP에서 유도된 Principal 검증을 대신하지 않는다.

## 0단계 — 분석 기준선

| 검증 ID | 요구사항·근거 | 상태 | 현재 근거 | 실행 가능한 검증 방법 | 완료 조건 |
|---|---|---|---|---|---|
| TC-ANL-001 | §5.1 데이터 소스별 규모 조사 | 미구현 | Web App 내 데이터 목록·규모 산출물 없음 | 승인된 조사표에서 소스별 건수, 용량, 증가율, 등급, 소유자 공란 여부 검사 | 모든 필드 확정 및 G1 승인 기록 |
| TC-ANL-002 | §15.2 연계 대상·필수/선택 확정 | 미구현 | HR·ERP·MES·ITSM 등은 UI 예시 문자열뿐이며 실제 Adapter 없음 | 시스템별 API 소유자, 인증 방식, Read/Draft/Write 범위 계약 검토 | 1차 범위와 API 제공 책임 승인 |
| TC-ANL-003 | §16.1 용량 산정 입력값 확정 | 미구현 | 동시 사용자·질의량·문서량에 대한 부하 설정 없음 | 용량 산정서와 부하 테스트 프로파일 간 값 대조 | 전체 입력값 확정 및 성능 테스트에 반영 |
| TC-ANL-004 | §17.3 KPI Baseline 측정 | 미구현 | Dashboard 수치는 정적 Mock이며 측정 데이터가 아님 | 표본·기간·도구·책임자가 있는 Baseline 결과서 확인 | 검색 시간, 반복 문의, 만족도 기준값 승인 |
| TC-ANL-005 | §22.2 요구사항 추적 커버리지 | 부분 | 본 문서가 0~3단계 추적 기준선을 제공 | 각 행에 개발 Task와 자동/수동 테스트 결과 링크가 존재하는지 검사 | 단계 범위 요구사항 100%가 Task·Test·결과에 연결 |

## 1단계 — PoC 및 G1

| 검증 ID | 요구사항·Gate 조건 | 상태 | 현재 근거 | 실행 가능한 검증 방법 | 완료 조건 |
|---|---|---|---|---|---|
| TC-POC-001 | Cloudflare GLM 4.7 Flash Provider 기술 검증 (§16.4) | 구현 | [`lib/llm-gateway.ts`](../lib/llm-gateway.ts), [`api/v1/chat/completions`](../app/api/v1/chat/completions/route.ts), `/api/health` | AI binding 설정 후 Health 200 및 실제 Chat 200, Provider·Model·Trace ID 확인 | 성공/오류/Timeout/429 시나리오 결과 보존 |
| TC-POC-002 | G1: 핵심 데이터 파싱 가능 | 부분 | TXT·Markdown·CSV·JSON 업로드, 정규화·제목 보존 청킹, 임베딩·색인 구현; PDF/DOCX/PPTX/XLSX 파서와 실패 재처리 미구현 | 지원 형식 업로드 성공과 Segment 생성 확인 후 대표 PDF/DOCX/PPTX/XLSX 표본의 성공률·실패 사유 측정 | 사업 핵심 형식 파싱 및 실패 재처리 가능 |
| TC-POC-003 | G1: 핵심 데이터 검색 가능 | 구현 | `/api/v1/search`가 D1 Segment를 대상으로 BM25-like·Dense 융합과 선택적 재정렬 수행; 실제 검색 성공 확인 | 인덱싱 문서의 고유 문구를 검색해 Asset·Segment ID, Score, Citation 반환 검사 | 실제 인덱스 검색 결과 재현 |
| TC-POC-004 | G1: 데이터 규모 조사표 확정 | 미구현 | TC-ANL-001과 동일 | 승인 조사표 자동 공란 검사 및 서명 확인 | §5.1 전 항목 확정 |
| TC-POC-005 | G1: STT 정확도 목표 확정 | 미구현 | STT 처리·평가 코드 없음 | 업무 용어 음성 평가셋으로 WER/CER 측정 | 목표치와 통과 결과 승인 |
| TC-POC-006 | G1: NDCG@10 목표 확정 | 미구현 | Retrieval 평가 파이프라인 없음 | Golden Dataset으로 NDCG@10 산출 및 결과 버전 저장 | 목표치 확정 및 평가 결과 통과 |
| TC-POC-007 | G1: 질의당 비용 상한 확정 | 부분 | 응답 Token usage 수신 가능, Dashboard 비용은 정적 Mock | 실제 사용량×Provider 단가로 질의별 비용을 집계하고 P50/P95 산출 | 상한 승인 및 초과 알림 기준 확정 |
| TC-POC-008 | G1: 임베딩 모델 벤치마크·선정 | 부분 | `kanana-embed` 실연동과 모델명 기록, `bge-reranker-v2-m3` 선택적 재정렬 구현; kanana-embed와 bge-m3 비교 평가 없음 | 동일 평가셋으로 후보 모델의 Recall@10/NDCG@10/Latency 비교 | 모델 선정 근거와 버전 고정 |

### G1 판정

**부분 통과.** Cloudflare Chat·Embedding·Reranker, 지원 텍스트 형식 수집, 실제 Hybrid Search가 동작한다. 데이터 규모 조사, PDF/Office 파서, STT·NDCG·비용 목표, 임베딩 후보 비교가 미확정이므로 정식 G1 승인은 보류한다.

## 2단계 — Platform

| 검증 ID | 요구사항 | 상태 | 현재 근거 | 실행 가능한 검증 방법 | 완료 조건 |
|---|---|---|---|---|---|
| TC-PLT-001 | FR-COM-001, SEC-001 — 기업 SSO | 미구현 | 김지원 사용자·부서가 하드코딩됨 | Mock IdP 및 기업 IdP 환경에서 로그인·만료·로그아웃 E2E | 기업 계정으로만 Portal 접근 |
| TC-PLT-002 | FR-COM-002, SEC-002 — 사용자·그룹·부서 Context/ACL | 부분 | Search·Citation에서 부서 Scope를 서버 Query에 적용하고 DX전략팀 0/품질팀 1을 확인; 부서는 아직 클라이언트 Header/Body에서 전달 | 인증 토큰에서 유도한 서로 다른 Principal로 동일 Query를 호출하고 결과 차등·누출 0건 검사 | IdP 기반 User/Group/Department로 ACL Filter 적용 |
| TC-PLT-003 | FR-COM-003 — 모든 요청 Trace ID | 부분 | Chat·Search가 `X-Trace-Id`를 발급하고 Retrieval Trace를 저장; Asset·Citation·Admin API는 미적용 | Health·Provider·Chat·Search·Asset·Citation 전 API의 응답 헤더/로그 상관관계 검사 | 전체 요청·오류에 Trace ID 존재 |
| TC-PLT-004 | FR-COM-004 — 한국어 및 다국어 확장 | 부분 | `lang="ko"`, 한국어 UI·답변 Prompt 구현; 언어 전환·Locale 없음 | 한국어 UI 스냅샷, 영문 +40% 문자열, 날짜·숫자 Locale E2E | 지원 언어 전환과 레이아웃 무결성 |
| TC-PLT-005 | FR-COM-005 — Web 사용자 Portal | 구현 | [`AgentPortal.tsx`](../app/AgentPortal.tsx)에 Home, Chat, Search, Tasks, Approval, Activity 제공 | `npm test`; 데스크톱·태블릿·모바일 주요 메뉴 수동 점검 | 주요 사용자 화면 접근 및 내비게이션 성공 |
| TC-PLT-006 | FR-COM-006, SEC-005 — 관리자 Console/권한 분리 | 부분 | 운영 Dashboard 화면은 있으나 관리자 Route Guard와 A-02~A-11 없음 | 일반 사용자·관리자 역할별 메뉴·URL 접근 E2E | 관리자 RBAC 및 전체 관리 화면 분리 |
| TC-PLT-007 | NFR-PER-005 — Portal 주요 화면 P95 3초 | 부분 | 정적 렌더링과 반응형 CSS는 있으나 150명 부하 측정 없음 | 확정 부하 조건에서 Web Vitals와 주요 화면 전환 P95 측정 | P95 3초 이내 결과서 |
| TC-PLT-008 | NFR-CMP-001 — 표준 REST API | 부분 | Health·Provider·Asset·Search·Citation·RAG Chat·Admin 목록 API 구현; 설계 정본 `/v1/*`와 실제 `/api/v1/*`, `/v1/chat`과 `/chat/completions` 차이 존재 | OpenAPI 계약 대비 Method/Path/Status 자동 검사 | 정본 API 경로·응답 계약 일치 |
| TC-PLT-009 | NFR-CMP-002, NFR-MNT-003 — JSON Schema·API 문서 | 미구현 | Chat 입력은 수동 검사하며 OpenAPI/JSON Schema 없음 | OpenAPI lint, 요청·응답 Schema contract test | 명세와 실제 응답 100% 일치 |
| TC-PLT-010 | NFR-CMP-003 — OIDC/SAML | 미구현 | 인증 Middleware·Session 없음 | OIDC Authorization Code, Token 만료, SAML 선택 연동 테스트 | 기업 IdP 인증 성공 |
| TC-PLT-011 | NFR-CMP-005 — OpenTelemetry | 미구현 | Trace 문자열만 있고 Span·Metric Export 없음 | 요청 1건의 Browser→API→Provider 분산 Trace 확인 | Trace·Metric 수집 및 상관관계 조회 |
| TC-PLT-012 | NFR-CMP-007 — 최신 2개 브라우저 | 부분 | 1080/700/420px 반응형 CSS와 정적 테스트 존재 | Chrome·Edge·Safari·Firefox 최신 2개에서 핵심 E2E | 브라우저별 Critical 결함 0건 |
| TC-PLT-013 | NFR-MNT-004 — 자동 테스트 | 부분 | `tests/rendered-html.test.mjs`가 Build·SSR·접근성·Gateway와 RAG Schema·Migration·API·UI 연결 구조를 검사; Retrieval 품질·ACL Property E2E는 미구현 | CI에서 `npm test`, `npm run lint`, 실제 D1/R2 RAG 통합 테스트 실행 | Unit·Integration·Regression·E2E Gate 구성 |
| TC-PLT-014 | SEC-003 — Tenant 식별자 서버 결정 | 미구현 | Tenant Context와 다중 Tenant 저장소가 없음 | 위조 Tenant Header/Body로 교차 Tenant 접근 시 403 검사 | 인증 정보에서 Tenant를 서버 결정 |
| TC-PLT-015 | §13.2 — 등급별 Provider 라우팅 | 구현 | 내부 요청은 권한 검증 후 Cloudflare RAG·GLM 4.7 Flash를 허용하고 기밀 요청은 로컬 LLM만 사용 | public/internal/confidential별 Provider 선택과 기밀 Cloudflare 차단 테스트 | 등급별 정책·차단·감사 로그 유지 |

## 3단계 — Document RAG 및 G2

| 검증 ID | 요구사항 | 상태 | 현재 근거 | 실행 가능한 검증 방법 | 완료 조건 |
|---|---|---|---|---|---|
| TC-RAG-001 | FR-CHAT-001 — 자연어 질의응답 | 구현 | Chat UI→`completeWithRag`→권한 검색·Context Prompt→로컬/Cloudflare 생성으로 연결 | 근거 있는 질문 전송 후 답변, Citation, 모델·Trace 표시 확인 | 정상·오류·근거 부족 응답 E2E 통과 |
| TC-RAG-002 | FR-CHAT-002 — 대화 세션 Context | 부분 | 브라우저 State의 이전 메시지를 재전송; Conversation ID·영속화 없음 | 새로고침 전후, 다중 세션, 20개 메시지 경계 테스트 | 서버 Conversation 저장·조회·삭제 |
| TC-RAG-003 | FR-CHAT-003 — 답변 길이·형식 선택 | 미구현 | 선택 UI와 API 옵션 없음 | 짧게/상세/표/목록 옵션별 요청·응답 E2E | 사용자 옵션이 Prompt/응답에 반영 |
| TC-RAG-004 | FR-CHAT-004 — Streaming 답변 | 미구현 | 로딩 Skeleton만 표시하며 API는 `stream:true`를 400으로 거절 | SSE `delta/citation/done/error`, 재접속 `Last-Event-ID`, 중단 테스트 | First Token Streaming 및 중단 동작 |
| TC-RAG-005 | FR-SRCH-001 — Hybrid Search | 구현 | `scoreLexical`의 BM25-like 점수와 `kanana-embed` Dense cosine을 45:55로 융합; 실제 검색 성공 확인 | Golden Query로 Lexical·Dense·최종 Score 및 검색 순위 검사 | 실제 Hybrid 결과 반환 |
| TC-RAG-006 | FR-SRCH-002 — 재순위화 | 구현 | `bge-reranker-v2-m3` 호출과 30:70 최종 융합, Reranker 장애 시 Hybrid 제한 모드 구현 | Rerank 전후 NDCG@10 비교 및 Provider 장애 시 Hybrid 결과 유지 확인 | 선정 Reranker 적용·관측 가능 |
| TC-RAG-007 | FR-SRCH-003 — 유형·기간·부서·소스 필터 | 부분 | 부서 Scope는 서버 검색에 적용; 콘텐츠 유형은 로컬 필터, 기간·소스 Filter Query는 미구현 | 필터 조합별 Search API 요청과 결과 Metadata 검사 | 전체 필터가 서버 Query에 반영 |
| TC-RAG-008 | FR-SRCH-004, SEC-002 — 검색 ACL | 부분 | Search SQL에서 Tenant·분류·부서 Scope 사전 필터; DX전략팀 0건/품질팀 1건 Smoke 통과; 인증 Principal은 미연결 | 기업 IdP의 사용자·그룹·부서별 허용/거부 Golden Dataset으로 누출 검사 | 서버 신뢰 Principal 기준 권한 누출 0건 |
| TC-RAG-009 | FR-SRCH-005 — 근거 부족 시 생성 제한 | 구현 | `MIN_EVIDENCE_SCORE`, Lexical/Dense 절대 조건과 `completeWithRag` Gate 구현; 무근거 질문 HTTP 422 확인 | 무근거 Query에 LLM 호출 0, `422 INSUFFICIENT_EVIDENCE`, 사용자 안내 반환 검사 | Threshold 기반 생성 차단 |
| TC-RAG-010 | FR-CIT-001 — 파일명·버전·페이지 | 부분 | 실제 검색 응답에 Asset/Segment, 제목, Heading, Page Number, 인용문 포함; 문서 Version 미저장, 텍스트 페이지는 Chunk 순번 기반 | 실제 검색 Segment의 제목·페이지·인용문 정확성 및 Version 표시 검사 | 답변별 파일명·버전·실제 페이지 Citation 연결 |
| TC-RAG-011 | FR-CIT-002 — 문장/영역 강조 | 부분 | `RagResults`가 실제 인용문과 Query를 Highlight하는 U-04 패널 제공; 원본 PDF 페이지 렌더링·좌표 강조 없음 | Citation 선택 후 인용문 Highlight와 향후 PDF 페이지 위치 E2E | 원본 위치와 Highlight 일치 |
| TC-RAG-012 | FR-CIT-005 — 삭제·권한 변경 근거 차단 | 부분 | Citation API가 조회 시 Tenant·분류·부서 Scope를 재검증하고 비허용 시 404; ACL 변경·삭제 API와 캐시 무효화 없음 | 답변 생성 후 Asset ACL 변경·삭제 뒤 재접근 403/404/410 검사 | 최신 인증 Principal·ACL로 Viewer 재검증 |
| TC-RAG-013 | DR-001~005 — 수집·변경감지·식별자·재처리·ACL 저장 | 부분 | D1 `assets/segments/index_jobs/retrieval_traces`, R2 원문, Checksum, Segment ID, 부서 Scope, Migration 구현; 증분 Update와 실패 Retry 미구현 | 문서 등록→청킹→임베딩→검색→Citation 통합 테스트 후 변경→재색인→실패 재처리 검사 | 전체 Asset 수명주기와 ACL 동기화 E2E |
| TC-RAG-014 | 06 §6.3 — Chat/Search/Asset/Citation API | 부분 | `/api/v1/assets`, `/search`, `/citations`, RAG `/chat/completions`, Admin Asset·Index Job 목록 구현·UI 실연동; 정본 경로와 상세·수정·삭제 API 미완 | OpenAPI 기준 필수 Method/Path/Status contract test | 설계 정본 필수 API 전체 구현 |
| TC-RAG-015 | G2: 문서 RAG KPI | 미구현 | Dashboard KPI는 정적 값; Retrieval·Citation 평가 결과 없음 | Text Recall@10 ≥85%, Faithfulness ≥95%, Citation Correctness ≥95% 자동 평가 | 버전 고정 평가 결과가 목표 충족 |
| TC-RAG-016 | G2: ACL 통과 | 부분 | 부서 ACL Smoke에서 DX전략팀 0건, 품질팀 1건; Citation 재조회도 부서 Scope 적용 | IdP 기반 사용자·그룹·부서, Tenant 위조, 권한 회수, 직접 Citation 접근 보안 테스트 | 전체 Negative Set 권한 누출 0건 |
| TC-RAG-017 | G2: 단계 범위 추적률 100% | 부분 | 본 문서에 요구사항·검증 방법과 Search·ACL·422 Smoke 결과를 연결; 전체 TC별 결과 파일은 미완 | TC-RAG-001~016에 최신 실행 결과와 증빙 링크 검사 | 모든 필수 행 구현 또는 승인된 대체방안 |

### G2 판정

**부분 통과.** 실제 Document RAG 검색과 근거 기반 Chat, 부서 ACL Smoke, Citation UI, 무근거 422 차단이 동작한다. 그러나 확정 Golden Dataset KPI, 기업 SSO 기반 ACL, PDF 실제 페이지 Citation, 권한 변경·삭제 회귀가 완료되지 않아 정식 G2 승인은 보류한다.

## 우선 실행 Backlog

| 우선순위 | 개발 작업 | 종료 기준 | 관련 추적 ID |
|---|---|---|---|
| P0 | 기업 SSO, 서버 측 User/Group/Department/Tenant Context | 서로 다른 계정의 권한 차등 E2E 통과 | TC-PLT-001~002, TC-PLT-010, TC-PLT-014 |
| P0 | PDF/DOCX/PPTX/XLSX 파서와 실제 Page Locator | 대표 핵심 문서 파싱·재처리 및 PDF 페이지 Highlight E2E 통과 | TC-POC-002, TC-RAG-010~013 |
| P0 | 기업 Principal 기반 ACL 강화 | Tenant·User·Group·Department 위조, 권한 회수, 직접 Citation Negative Set 누출 0건 | TC-PLT-001~002, TC-PLT-010, TC-PLT-014, TC-RAG-008, TC-RAG-012, TC-RAG-016 |
| P0 | Golden Dataset과 G1/G2 정량 평가 | NDCG@10·Recall@10·Faithfulness·Citation Correctness 목표 확정 및 통과 | TC-POC-005~008, TC-RAG-015 |
| P1 | 증분 Update/Delete·재색인·실패 Retry | Checksum 변경, 파생물 교체, Index Job 재처리 통합 테스트 통과 | TC-RAG-013~014 |
| P1 | Chat SSE Streaming과 Conversation 영속화 | 재접속·중단·세션 복원 테스트 통과 | TC-RAG-002~004 |
| P1 | OpenAPI/JSON Schema와 API 경로 정합 | Contract test 100% 통과 | TC-PLT-008~009, TC-RAG-014 |
| P1 | 검색 유형·기간·부서·소스 필터 완성 | 전체 필터 조합의 서버 Query·ACL E2E 통과 | TC-RAG-007~008 |
| P2 | 전 API Trace·OpenTelemetry 및 비용 집계 | 요청 단위 Trace와 비용 Drill-down 가능 | TC-PLT-003, TC-PLT-011, TC-POC-007 |
| P2 | 최신 브라우저·부하·회귀 CI Gate | 지원 브라우저와 확정 부하 조건 모두 통과 | TC-PLT-007, TC-PLT-012~013 |

## 기본 검증 명령

```powershell
cd web-app
npm test
npm run lint
```

위 명령은 Portal 렌더링·접근성·반응형 CSS·Gateway와 RAG 구조를 확인한다. 이번 실검증에서는 실제 검색 성공, 부서 ACL DX전략팀 0건/품질팀 1건, 무근거 질문 422를 확인했다. 정식 G1/G2 판정에는 PDF/Office 파싱, IdP 기반 전체 ACL Negative Set, Golden Dataset 품질·성능 평가가 추가되어야 한다.

## 2026-07-22 최종 개발·검증 루프 증빙

### 이번 루프에서 닫힌 항목

| 영역 | 구현 증거 | 자동 검증 |
|---|---|---|
| 인증·ACL 신뢰 경계 | `lib/identity.ts`, Search/Chat/Asset/Citation/Admin Route | Body/Header 부서 위조 무효, 부서 Negative, Citation 직접 접근 차단 |
| Tenant·Role·Admin RBAC | D1 `user_profiles/auth_credentials/auth_sessions`, `requireRole` | 일반 사용자 Admin API 403, Admin API 정상 조회 |
| Evidence Gate 우회 | 일반 사용자의 `rag:false` 거부 | 무근거 질문 LLM 호출 전 422 |
| 문서 수명주기 | hash 중복 방지, Version, PATCH/DELETE/Reindex, 실패 Job, Retry API | ingest/dedup/reindex v2/delete 후 Search·Citation·Asset 차단 |
| 대화·피드백 | D1 `conversations/messages/message_feedback` | JSON Chat 저장, SSE 저장, 대화 재조회, 피드백 저장, 삭제 cleanup |
| Streaming | `delta/citation/done` SSE와 Event ID·Last-Event-ID skip | 이벤트 순서·message/conversation ID·Citation 연결 |
| 검색 필터 | sourceType·createdFrom·createdTo + 서버 결정 Department | API 계약 및 플랫폼 E2E |
| Guardrail·Rate Limit | 직접/간접 Injection 패턴 차단, D1 minute bucket | 오류 계약과 Trace ID |
| API 표준 | `docs/openapi.yaml`, 전 API Trace ID·표준 오류 | OpenAPI 3.1 파싱, 22개 operation, local ref 검증 |
| Starter Golden Set | `tests/golden-rag.json`, `scripts/evaluate-rag.mjs` | 3건 기준 Recall@10 1.0, MRR 1.0, Citation@1 1.0, Faithfulness proxy 1.0 |
| UI·반응형 | 모바일 포커스 Trap, container query, 실제 Health/Admin 상태, 실제 Citation 링크 | ESLint, production build, API 상태 점검 |

실행 명령:

```powershell
npm test
npm run lint
npm run test:rag:g1
npm run test:rag:g2
npm run test:rag:golden
```

`scripts/verify-platform.mjs`는 API 키나 Authorization 헤더 없이 localhost의 개발 Principal만 사용하며 생성한 Asset과 Conversation을 `finally`에서 삭제한다. 현재 13단계가 모두 통과했다.

## 2026-07-23 로그인·관리자 승인 루프

| 흐름 | 구현 | 검증 |
|---|---|---|
| 자체 로그인 | `POST /api/auth/register/login/logout`, PBKDF2-SHA256 자격증명, HttpOnly 세션 쿠키 | 미로그인 401, 잘못된 자격증명 401, 로그아웃 후 세션 폐기 |
| 이메일 가입 | `POST /api/auth/register`가 Resend 인증 메일을 발송하고, `POST /api/auth/verify-email`이 토큰 검증 뒤 D1 `pending` 계정을 생성 | 만료·재사용 토큰 차단, 1분 재발송 대기, 일 3회 제한 |
| 재신청 | `POST /api/auth/application`이 희망 부서·신청 사유를 갱신하고 `pending` 전환 | 반려 후 재신청, `AUTH_APPROVAL_REQUIRED` |
| 미승인 차단 | `resolvePrincipal`이 Unrequested/Pending/Rejected 상태를 업무 API에서 거부 | 신청 전·승인 대기·반려 상태별 403 |
| 관리자 검토 | `GET|PATCH /api/admin/access-requests`와 관리자 Console | 부서·사용자/매니저 역할 지정, 승인·거절 |
| 감사 추적 | 신청·처리자·처리시각·사유 및 `access.requested/approved/rejected` Audit Log | 승인 후 허용, 반려 후 재신청·재차단 |

`npm run test:access`의 이메일 인증·가입 신청·승인 흐름 9단계와 기존 RAG 플랫폼 13단계가 함께 통과했다. 운영 `ADMIN_EMAILS`에는 사이트 소유자와 지정 관리자를 등록하며, 개발 Identity는 운영에서 비활성화한다.

### 정식 사업 Gate에서 계속 필요한 외부 수용 항목

| 항목 | 현재 판정 | 완료에 필요한 외부 입력 |
|---|---|---|
| PDF/DOCX/PPTX/XLSX 파서와 실제 Page Locator | 미완 | Worker 호환 파서 패키지 설치 허용 및 대표 샘플 파일 |
| 기업 OIDC/SAML·조직/그룹 매핑 | 부분 | 실제 IdP Client, Claim, 부서·그룹 매핑표 |
| G1 데이터 규모 조사·STT·임베딩 후보 비교 | 미완 | 원천 저장소 통계, 음성 Golden Set, bge-m3 Provider 접근 |
| 정식 G2 300건 Golden Set·현업 판정 | Starter Gate만 통과 | 현업 확정 질문·정답·권한 라벨과 평가 승인자 |
| 멀티모달 G3 | 미완 | 이미지·음성·영상 모델/API와 라벨 데이터 |
| Agent·MCP G4 | 미완 | ERP/MES/HR/ITSM Sandbox와 Tool 권한·승인자 |
| Production G5 | 미완 | 150명 부하 환경, 보안 점검, UAT, DR·운영 인수 |

따라서 코드로 재현 가능한 Text RAG Platform Gate는 Green이며, 사업 전체 G1~G5는 위 외부 수용 항목이 완료되기 전까지 승인 완료로 표시하지 않는다.

## 2026-07-23 Agent·MCP 통제 수직 기능

| 요구 | 현재 구현 | 검증 |
|---|---|---|
| FR-AGT-002·005~007 | D1 `agent_runs/agent_steps`, Router→Planner→Retrieval→Verification→Execution 최대 5단계, 단계별 Trace·결과 영속화 | `npm run test:agent` R0 실행의 5단계 순서와 실제 D1 결과 확인 |
| FR-MCP-001 | D1 `tool_registry`, R0~R3·역할·Adapter·Timeout·Retry 정책 | built-in 3종 활성, ERP·MES·HR·ITSM 외부 계약 비활성 확인 |
| FR-MCP-002~007 | D1 `tool_approval_requests/tool_executions`, R2+ 승인 전 실행 차단, manager/admin 결정, 자가 승인 금지, 멱등 실행, 감사 로그 | 승인 전 execution 0건, 별도 매니저 승인 후 1건 실행, 중복·자가 승인 차단 |
| U-05·U-06 | 정적 작업·출장 승인 예시를 실제 `/api/v1/agent/runs`, `/api/v1/tools`, `/api/v1/tool-approvals` 데이터로 교체 | 사용자 실행 이력과 역할별 승인함 E2E |
| 외부 업무 연계 경계 | 실제 실행기는 읽기 전용 built-in Demo로 한정, ERP·MES·HR·ITSM은 disabled Adapter 계약 | 비활성 외부 Tool 실행 `409 TOOL_DISABLED` |

이 구현의 업무 Tool 승인은 가입·접근 승인과 별개의 통제 객체다. 외부 시스템 Write Adapter와 Sandbox가 제공되기 전까지 G4 전체 완료를 의미하지 않는다.
