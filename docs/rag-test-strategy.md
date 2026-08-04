# Document RAG MVP G1/G2 자동 테스트 전략

## 1. 목적과 적용 범위

이 문서는 `web-app`에 Document RAG MVP를 구현할 때 다음 파이프라인을 자동 검증하기 위한 기준이다.

```text
수집 → 파싱·청킹 → BM25/Dense 검색 → ACL 사전 필터·사후 재검증
    → Context Builder → Citation 검증 → LLM Gateway
```

검증 대상 요구사항은 `DR-001~005`, `FR-SRCH-001~005`, `FR-CIT-001`, `FR-CIT-002`, `FR-CIT-005`, `SEC-001~003`, `NFR-PER-001`, `NFR-PER-002`이다. 품질 목표는 Text Recall@10 85% 이상, Faithfulness 95% 이상, Citation Correctness 95% 이상, 근거 없는 답변률 3% 이하, ACL 누출 0건이다.

관련 정본:

- [사업개요 및 요구사항](../../01_%EC%82%AC%EC%97%85%EA%B0%9C%EC%9A%94_%EB%B0%8F_%EC%9A%94%EA%B5%AC%EC%82%AC%ED%95%AD.md)
- [Multimodal RAG 아키텍처](../../04_Multimodal_RAG_Architecture.md)
- [DB·API 설계](../../06_DB_API_Design.md)
- [WBS·테스트·전환](../../09_WBS_Test_Transition.md)

## 2. 현재 `web-app` 기준선과 테스트 전제

현재 앱은 vinext 기반이며 로컬과 Cloudflare가 동일한 [`worker/index.ts`](../worker/index.ts)를 사용한다. 구현된 서버 기능은 다음과 같다.

- `POST /api/v1/chat/completions`: 로컬 및 Cloudflare AI를 호출하는 Gateway
- `GET /api/health`, `GET /api/admin/providers`: Gateway 상태 API
- D1 접근 함수는 있으나 [`db/schema.ts`](../db/schema.ts)는 비어 있음
- Worker `Env`에 `DB`는 선언되어 있으나 Document RAG용 R2·검색·벡터 어댑터는 아직 없음
- 현재 테스트는 빌드된 Worker의 HTML 렌더링과 정적 안전장치 확인이 중심임

따라서 G1/G2 자동화는 운영 Cloudflare AI, D1, Object Storage 또는 외부 Search/Vector 서비스에 직접 의존해서는 안 된다. 파이프라인의 각 외부 경계를 인터페이스로 분리하고, 결정적 테스트 대역과 실제 Cloudflare 바인딩 계약 테스트를 함께 사용한다.

권장 경계는 다음과 같다.

| 경계 | 단위·통합 테스트 대역 | Cloudflare 동형 테스트 |
|---|---|---|
| Object Storage | 메모리 Map 기반 ObjectStore | Miniflare/Wrangler 임시 R2 |
| Metadata DB | 메모리 Repository | 임시 D1 + 실제 migration |
| BM25 Search | 고정 점수 FakeSearch | 로컬 Search 컨테이너 또는 HTTP Stub |
| Vector Search | 결정적 임베딩·고정 cosine 결과 | Vector 어댑터 HTTP Stub |
| Embedding/Reranker | fixture 기반 Stub | Cloudflare AI binding 계약 Stub |
| LLM | 근거 ID를 그대로 반환하는 FakeLLM | `global fetch`가 아닌 주입식 Provider Stub |
| 인증 Context | 서명 검증을 통과한 고정 Principal | Worker 요청 헤더/토큰 계약 테스트 |

테스트 편의를 위해 프로덕션 보안 경계를 약화해서는 안 된다. 특히 클라이언트가 보낸 `tenant_id`, 사용자 ID 또는 그룹 목록을 그대로 신뢰하는 테스트 전용 분기는 금지한다.

## 3. 테스트 피라미드와 실행 환경

### 3.1 계층

1. **순수 단위 테스트**: 해시, 상태 전이, 청킹, 점수 융합, ACL 판정, Context 예산, Citation locator를 네트워크 없이 검증한다.
2. **파이프라인 통합 테스트**: 메모리 Repository와 결정적 모델 대역으로 수집부터 답변까지 검증한다.
3. **Worker API 계약 테스트**: 빌드된 `dist/server/index.js`의 `worker.fetch()`를 현재 `rendered-html.test.mjs`와 같은 방식으로 호출한다.
4. **Cloudflare 동형 테스트**: 임시 D1/R2를 바인딩한 Miniflare 또는 Wrangler local에서 같은 요청·fixture·assertion을 재실행한다.
5. **품질 회귀 테스트**: 버전 관리된 골든셋으로 Recall/NDCG/Faithfulness/Citation 지표를 계산한다.
6. **성능 테스트**: 로컬 Stub Provider와 Stage Provider를 분리해 검색 및 RAG P95를 측정한다.

### 3.2 환경 매트릭스

| 환경 | 목적 | 외부 호출 | PR 차단 |
|---|---|---|---|
| Node 단위 | 도메인 로직의 빠른 회귀 | 없음 | 예 |
| 빌드 Worker + 메모리 대역 | HTTP 계약·Trace·오류 매핑 | 없음 | 예 |
| Cloudflare local + 임시 D1/R2 | Worker API·바인딩·트랜잭션 동형성 | Stub만 허용 | 예 |
| 품질 평가 | 검색·생성 KPI | 결정적 Stub, 승인된 평가 모델 | G1/G2에서 예 |
| Stage | 네트워크·Cloudflare AI·실제 후보 엔진 확인 | 승인된 binding 사용 | 야간/수동 승인 |

Node와 Cloudflare local은 동일한 fixture와 공통 assertion 모듈을 사용해야 한다. 한 환경에서만 통과하는 경우 동형 실행 실패로 간주한다. 시간, UUID, 난수, 임베딩 결과는 주입 가능하게 만들어 두 환경에서 동일한 결과를 보장한다.

## 4. 표준 테스트 데이터와 오라클

### 4.1 최소 fixture corpus

`tenant-a`와 `tenant-b`를 포함한 최소 20개 문서를 사용한다.

| Fixture | 목적 |
|---|---|
| `public-policy-v1.pdf` | 공개 규정, 페이지 Citation |
| `engineering-manual-v3.pdf` | `engineering` 그룹 전용, 표·제목 경계 청킹 |
| `hr-private-u100.pdf` | 사용자 `u100` 전용 ACL |
| `finance-confidential.pdf` | 다른 부서·기밀 문서 차단 |
| `same-title-other-tenant.pdf` | 교차 Tenant 누출 탐지 |
| `policy-v1.pdf`, `policy-v2.pdf` | 버전 연결과 최신 버전만 검색 |
| `duplicate-content-a/b.pdf` | SHA-256 중복 수집 |
| `corrupt.pdf` | 파싱 실패·재처리·DLQ |
| `empty.pdf` | Quality Check 실패 |
| `deleted-source.pdf` | 삭제·캐시·Citation 무효화 |

각 문서는 다음 manifest와 함께 버전 관리한다.

```json
{
  "asset_id": "asset-engineering-manual-v3",
  "tenant_id": "tenant-a",
  "version": "v3",
  "content_hash": "sha256:fixed-value",
  "acl": { "groups": ["engineering"], "users": [] },
  "expected_segments": 6,
  "expected_locators": [
    { "segment_id": "seg-e104", "page": 42, "quote": "E104" }
  ]
}
```

### 4.2 골든 질의

G1에는 현업 검수 전 사용할 수 있는 seed set 30건을 두고, G2 판정에는 현업 검수된 문서 질의 최소 200건을 사용한다. 각 레코드는 아래 값을 가진다.

- `query_id`, `tenant_id`, `principal`, `query`
- `relevant_asset_ids`, `relevant_segment_ids`, 관련도 등급
- `expected_answer_facts`, `forbidden_facts`
- `expected_citation_locators`
- `must_refuse` 또는 `evidence_insufficient`

ACL negative set은 허용 질의마다 최소 1개의 비허용 Principal을 짝으로 둔다. 품질 평균값과 별개로 이 negative set에서 누출 1건이라도 발생하면 즉시 실패한다.

### 4.3 결정적 모델 대역

- 임베딩 Stub은 정규화된 토큰을 고정 차원 벡터로 변환하며 실행 순서와 무관하게 같은 값을 반환한다.
- Reranker Stub은 fixture manifest의 관련도와 `segment_id` tie-break를 사용한다.
- FakeLLM은 전달받은 `evidence`만 사용하고 각 문장에 근거 `segment_id`를 연결한다.
- Provider Stub은 200, 빈 응답, 429, 500, timeout을 재현하되 실제 API 키를 요구하거나 기록하지 않는다.

## 5. G1 자동 테스트 — 기술 검증과 기준선 확정

G1의 목적은 데이터 처리와 검색 기술 리스크를 제거하고 G2 평가 기준선을 확정하는 것이다. G1에서는 운영급 LLM 문장 품질보다 수집·청킹·식별자·검색 재현성을 우선한다.

| ID | 자동 테스트 | 핵심 입력·절차 | 합격 기준 | 추적 |
|---|---|---|---|---|
| `TC-G1-ING-001` | 신규 수집 | PDF와 manifest 등록 | 원본 저장, Asset/ACL/Version 생성, `ingested` 상태 | DR-003, DR-005 |
| `TC-G1-ING-002` | Hash 중복 방지 | 동일 바이트를 이름만 바꿔 2회 등록 | 파생물·색인 중복 생성 0, 결과가 idempotent | DR-002 |
| `TC-G1-ING-003` | 증분 수집 | v1 등록 후 일부 문단만 바꾼 v2 등록 | 변경 Segment만 재처리, 버전 연결 유지 | DR-001~003 |
| `TC-G1-ING-004` | 상태 전이 | 정상 문서 처리 | `ingested→parsed→embedded→indexed→ready` 순서 보장 | DR-003 |
| `TC-G1-ING-005` | 실패·재처리 | corrupt fixture와 단계별 fault 주입 | 실패 단계·사유·시각 기록, 최대 3회 후 DLQ, 수동 재처리 가능 | DR-004 |
| `TC-G1-CHK-001` | 레이아웃 청킹 | 제목·단락·표를 포함한 문서 | 제목/단락 우선 분리, 표 별도 Segment, 빈 Chunk 0 | FR-SRCH-001 |
| `TC-G1-CHK-002` | Parent-child | 256/1024 token 정책 fixture | child의 parent 참조 유효, child 검색 후 parent 반환 | FR-SRCH-001 |
| `TC-G1-CHK-003` | 중첩·경계 | 페이지 경계의 정답 문장 | 15% overlap 허용오차 내 보존, 문장 손실 0 | FR-SRCH-001 |
| `TC-G1-IDX-001` | 색인 정합 | 정상 문서 전체 처리 | Metadata/segment/search/vector의 Asset·Segment ID 연결 100% | DR-003 |
| `TC-G1-IDX-002` | 벡터 키 | 한 Segment의 여러 표현 생성 | `{segment_id}:{vector_type}` 간 덮어쓰기 0 | DR-003 |
| `TC-G1-IDX-003` | 검색 노출 Gate | QC 미달·failed·indexed 상태 문서 질의 | `ready` 자산만 결과에 노출 | DR-004 |
| `TC-G1-SRCH-001` | BM25 검색 | 고유 오류코드·규정명 질의 | 예상 Segment가 top-10에 포함 | FR-SRCH-001 |
| `TC-G1-SRCH-002` | Dense 검색 | 동의어·서술형 질의 | 예상 Segment가 top-10에 포함 | FR-SRCH-001 |
| `TC-G1-SRCH-003` | Hybrid·RRF | lexical/dense가 서로 다른 정답을 반환 | RRF 결과 결정적, 양쪽 정답을 보존 | FR-SRCH-001 |
| `TC-G1-SRCH-004` | Rerank | 후보 top-20 재정렬 | 정답 Segment 순위가 유지 또는 개선 | FR-SRCH-002 |
| `TC-G1-FLT-001` | 검색 필터 | 유형·기간·부서·소스 조합 | AND/OR 계약대로 결과, 필터 외 결과 0 | FR-SRCH-003 |
| `TC-G1-QLT-001` | seed 검색 평가 | seed set 30건 실행 | Recall@10 ≥85%; NDCG@10 기준선 산출·고정 | 01 §12.1 |
| `TC-G1-ISO-001` | 런타임 동형성 | 동일 corpus/query를 Node와 Worker local에서 실행 | 정렬된 top-10 ID, locator, 오류 코드 동일 | NFR-MNT-004 |
| `TC-G1-SEC-001` | 비밀 비노출 | Provider 오류 본문에 가짜 키 삽입 | 응답·로그·snapshot에 키/원문 오류 0 | 01 §13.2 |

### G1 통과 조건

- G1 테스트 전부 통과하고 flaky 재실행 3회가 모두 성공한다.
- seed set Text Recall@10이 85% 이상이다.
- NDCG@10, 청킹 크기·overlap, 임베딩 후보의 측정 결과와 선택 근거가 저장된다.
- 데이터 식별자 연결 오류, 교차 Tenant 결과, 비밀 노출은 0건이다.
- Node와 Cloudflare local의 계약 차이가 0건이다.
- 전체 테스트 결과에 commit SHA, corpus version, chunk policy version, embedding model/stub version이 기록된다.

## 6. G2 자동 테스트 — Document RAG MVP 수용

G2는 검색 결과가 실제 사용자 권한과 최신 원본 상태를 반영하고, LLM에 허용된 Context만 전달되며, 답변 Citation이 원본 위치까지 검증되는지를 판정한다.

| ID | 자동 테스트 | 핵심 입력·절차 | 합격 기준 | 추적 |
|---|---|---|---|---|
| `TC-G2-ACL-001` | Tenant 사전 필터 | tenant-a 토큰으로 양 Tenant 동일 제목 질의 | 후보 top-k에 tenant-b ID 0 | SEC-002, SEC-003, FR-SRCH-004 |
| `TC-G2-ACL-002` | 그룹·사용자 ACL | engineering, hr, 개인 u100 조합 | 허용 자산만 검색; 누출 0 | SEC-002, FR-SRCH-004 |
| `TC-G2-ACL-003` | 클라이언트 위조 | body/header에 다른 tenant/group/user 삽입 | 서버 Principal만 사용, 결과 변화 0 | SEC-003 |
| `TC-G2-ACL-004` | 사후 재검증 | 색인 ACL은 허용, Metadata ACL은 회수 상태 | Context와 Citation에서 자산 제거, LLM 전달 0 | FR-SRCH-004, FR-CIT-005 |
| `TC-G2-ACL-005` | 캐시 무효화 | 응답 캐시 후 ACL 회수 이벤트 | 회수 직후 캐시 결과 접근 불가 | FR-CIT-005 |
| `TC-G2-ACL-006` | 직접 Citation 접근 | 타 사용자 Citation ID로 조회 | 403 또는 존재 비노출 정책의 404, locator/제목/quote 노출 0 | FR-CIT-005 |
| `TC-G2-CTX-001` | Context ACL 불변식 | 혼합 권한 후보를 강제 주입 | LLM 요청 evidence 전부 `isAllowed=true` | FR-SRCH-004 |
| `TC-G2-CTX-002` | Context 예산 | 긴 parent Segment 다수 검색 | token budget 이내, 중간 문장 파손 0, 선택 근거 결정적 | FR-CHAT-002 |
| `TC-G2-CTX-003` | 중복 제거 | overlap Chunk와 같은 parent 후보 | 중복 근거 제거, 최소 1개 locator 유지 | FR-SRCH-002 |
| `TC-G2-EVI-001` | 근거 부족 차단 | 관련 결과 0 또는 score 임계값 미달 | LLM 호출 0, `422 RAG_EVIDENCE_INSUFFICIENT` | FR-SRCH-005 |
| `TC-G2-EVI-002` | 부분 근거 | 질문의 일부만 corpus에 존재 | 미지원 사실 생성 0, 부족 범위 명시 | FR-SRCH-005 |
| `TC-G2-CIT-001` | 문서 Citation | 페이지 42 정답 질의 | 파일명·version·page·quote가 manifest와 일치 | FR-CIT-001 |
| `TC-G2-CIT-002` | 인용 하이라이트 | quote locator로 원문 조회 | 정규화 후 원문 exact span과 일치 | FR-CIT-002 |
| `TC-G2-CIT-003` | Citation 완전성 | 답변 fact 단위 근거 연결 | 검증 가능한 fact의 citation coverage 100% | FR-CIT-001~002 |
| `TC-G2-CIT-004` | stale·삭제 Citation | v1 삭제/교체 후 기존 Citation 조회 | 삭제·구버전 원문 접근 차단, 최신 버전 오인 연결 0 | FR-CIT-005 |
| `TC-G2-CIT-005` | Citation 위조 방지 | FakeLLM이 후보 외 ID 반환 | Validator가 삭제 또는 응답 실패 처리 | FR-CIT-001, FR-CIT-005 |
| `TC-G2-LLM-001` | Gateway 요청 계약 | Context 포함 RAG 질의 | system prompt 교체 불가, 민감도 internal, Trace ID 전달 | 01 §13.2, FR-COM-003 |
| `TC-G2-LLM-002` | Provider 오류 | timeout·429·500·빈 응답 | 표준 오류·retryable·Trace ID, 원문/비밀 노출 0 | 06 §6.6 |
| `TC-G2-API-001` | Search API 계약 | 정상·invalid·unauthorized 요청 | 스키마·상태 코드·`Cache-Control:no-store` 일치 | NFR-CMP-002 |
| `TC-G2-API-002` | RAG Chat 계약 | include_citations on/off | answer/citations/usage/trace_id 계약 일치 | FR-CHAT-001, FR-CIT-001 |
| `TC-G2-QLT-001` | 검색 골든셋 | 현업 검수 200건 | Text Recall@10 ≥85%, 확정 NDCG@10 충족 | 01 §12.1 |
| `TC-G2-QLT-002` | 생성 골든셋 | answer facts와 evidence 비교 | Faithfulness ≥95%, 근거 없는 답변률 ≤3% | 01 §12.2 |
| `TC-G2-QLT-003` | Citation 평가 | locator 정답과 응답 비교 | Citation Correctness ≥95% | 01 §12.2 |
| `TC-G2-PERF-001` | 검색 부하 | 150 동시 사용자 지속 부하 | `/v1/search` P95 ≤2초, 오류율 ≤1% | NFR-PER-001 |
| `TC-G2-PERF-002` | RAG 부하 | 150 동시 사용자, Stub/Stage 분리 | 일반 RAG P95 ≤8초, timeout 정책 준수 | NFR-PER-002 |
| `TC-G2-OBS-001` | Trace 상관관계 | 수집부터 답변까지 단일 요청 추적 | API·검색·LLM·Citation 로그가 같은 Trace ID로 연결 | FR-COM-003 |

### G2 통과 조건

- 필수 G2 테스트와 관련 G1 회귀가 모두 통과한다.
- ACL negative set과 교차 Tenant 테스트의 누출이 0건이다. 한 건이라도 발생하면 평균 KPI와 무관하게 배포를 차단한다.
- Text Recall@10 ≥85%, Faithfulness ≥95%, Citation Correctness ≥95%, 근거 없는 답변률 ≤3%를 충족한다.
- 검색 P95 ≤2초, 일반 RAG P95 ≤8초를 확정된 Peak 조건에서 충족한다.
- `FR-SRCH-001~005`, `FR-CIT-001~002`, `FR-CIT-005`, `DR-001~005`, `SEC-001~003`의 테스트 추적 커버리지가 100%이다.
- Critical/High 결함과 flaky quarantine 항목이 0건이다.

## 7. 핵심 불변식과 속성 기반 테스트

예제 기반 테스트 외에 임의의 Tenant, Principal, Asset, Segment 조합을 생성해 다음 불변식을 반복 검증한다.

1. 검색 결과, Context, Citation의 `tenant_id`는 인증 Context의 Tenant와 항상 같다.
2. Context의 모든 Segment는 요청 시점 최신 ACL에서 허용된다.
3. Citation은 응답 Context에 실제 포함된 Segment만 참조한다.
4. 삭제·권한 회수된 Asset은 결과, Context, Citation, Cache 어디에도 나타나지 않는다.
5. 동일 content hash와 Idempotency Key의 재처리는 저장 객체·Segment·Embedding 수를 늘리지 않는다.
6. 재인덱싱 중 한 Asset의 구버전과 신버전이 같은 검색 응답에 동시에 노출되지 않는다.
7. Chunk를 합친 정규화 텍스트는 원문의 의미 있는 내용을 누락하거나 순서를 바꾸지 않는다.
8. 같은 입력·clock·model version에서 검색 순위와 Citation locator는 결정적이다.

속성 기반 테스트는 고정 seed를 결과에 기록하고, 실패 seed를 regression fixture로 승격한다.

## 8. 품질 지표 계산 규칙

- `Recall@10 = 정답 Segment 중 top-10에 포함된 수 / 정답 Segment 수`를 질의별 계산 후 macro average한다.
- `NDCG@10`은 현업 관련도 등급을 사용하며, tie는 `segment_id` 오름차순으로 고정한다.
- `Citation Correctness`는 존재하는 최신 Segment, 올바른 Asset version, locator 원문 일치를 모두 충족한 Citation 비율이다.
- `Faithfulness`는 답변의 검증 가능한 원자 fact 중 제공 Context가 지지하는 fact 비율이다.
- `근거 없는 답변률`은 근거 부족 질의에서 단정적 답변을 생성한 건수의 비율이다.
- ACL 누출은 개수로 측정하며 허용 오차는 0이다. 점수 평균에 포함해 희석하지 않는다.

평가 결과 JSON에는 다음 메타데이터를 반드시 포함한다.

```json
{
  "commit": "git-sha",
  "runtime": "node|cloudflare-local|stage",
  "corpus_version": "doc-rag-ko-v1",
  "golden_set_version": "golden-v1",
  "chunk_policy_version": "chunk-v1",
  "embedding_model": "embed-default@version",
  "reranker_model": "rerank-default@version",
  "prompt_version": "rag-system-v1"
}
```

## 9. CI 파이프라인과 실행 명령 계약

구현 시 아래 script 이름을 `package.json`의 공개 계약으로 추가한다. 이 문서는 전략만 정의하므로 현재 script는 변경하지 않는다.

```text
npm run test:rag:unit          # 순수 단위 테스트
npm run test:rag:pipeline      # 메모리 대역 E2E
npm run test:rag:worker        # 빌드 Worker fetch 계약
npm run test:rag:cloudflare    # 임시 D1/R2 Cloudflare local
npm run test:rag:quality       # 골든셋 지표
npm run test:rag:acl           # ACL negative/property suite
npm run test:rag:perf          # Stub 기반 부하
npm run test:rag:g1            # G1 묶음
npm run test:rag:g2            # G1 회귀 + G2 묶음
```

권장 실행 주기:

| 시점 | 실행 |
|---|---|
| 모든 PR | unit, pipeline, worker, ACL smoke |
| RAG 관련 PR | cloudflare, seed quality, G1/G2 해당 묶음 |
| nightly | 전체 골든셋, property 10,000 cases, Cloudflare local, Stub perf |
| G1 판정 | `test:rag:g1`, 후보 모델 Stage benchmark |
| G2 판정 | `test:rag:g2`, 150명 부하, 전체 보안 negative set |

실제 Cloudflare AI 호출은 PR 테스트에서 금지한다. Stage smoke는 승인된 binding을 사용하고 요청·응답 본문을 CI artifact에 저장하지 않는다. Provider 비용과 장애 때문에 Stage smoke가 실패하더라도 계약 테스트 실패와 구분해서 보고하되, G2 판정 시 승인된 Stage 검증은 필수로 한다.

## 10. 테스트 결과물과 추적성

각 실행은 다음 artifact를 남긴다.

- JUnit XML: 테스트 ID, 요구사항 ID, 실행 환경
- `rag-quality.json`: 질의별 순위와 집계 KPI
- `rag-acl-negative.json`: Principal별 허용/차단 판정, 실제 문서 내용 제외
- `rag-performance.json`: P50/P95/P99, 오류율, 사용한 부하 프로파일
- 실패 시 최소 재현 fixture와 고정 random seed
- 요구사항 → Work Package → 테스트 ID → 실행 결과 매트릭스

로그와 artifact에는 API 키, Authorization 헤더, 원문 기밀 문서, 전체 LLM prompt를 남기지 않는다. 필요한 경우 Asset/Segment ID와 해시된 Principal만 기록한다.

## 11. 구현 착수 전 확정할 항목

다음 항목은 자동 테스트 구현 전에 발주사·아키텍트·QA가 값과 책임자를 확정해야 한다.

1. Document RAG MVP의 실제 API 경로: 설계 정본 `/v1/chat`, `/v1/search`, `/v1/assets`와 현재 `/api/v1/chat/completions`의 호환·전환 정책
2. Cloudflare 환경의 R2, D1, Search/Vector 실제 바인딩과 로컬 대체 방식
3. 인증 Token에서 Tenant, 사용자, 그룹을 추출하는 서버 측 정본
4. 문서 청킹 크기, overlap, score threshold, Context token budget
5. NDCG@10 목표와 G1 seed set·G2 200건 골든셋 승인자
6. ACL 변경 전파 SLA와 즉시 캐시 무효화 범위
7. 150명 Peak 가정, 부하 지속 시간, 테스트 데이터 규모
8. Citation Viewer의 삭제·권한 회수·버전 변경 UX 및 API 상태 코드

이 항목이 미확정이어도 결정적 대역을 사용한 파이프라인 개발은 시작할 수 있다. 다만 G1/G2 공식 통과 판정은 확정값과 승인된 골든셋으로 다시 실행해야 한다.
