# ILJIN AI Works 개발 요구사항 체크리스트

최종 갱신: 2026-07-24  
체크리스트 기준: 코드, 자동 테스트, 운영 설정 또는 실제 연결 증거가 있어야 `완료`로 판정한다.

## 상태 정의

| 상태 | 판정 기준 |
|---|---|
| 완료 | 애플리케이션 코드와 검증 경로가 구현되어 있다. |
| 부분 구현 | 핵심 계약은 있으나 외부 연결, 실운영 증빙 또는 일부 세부 기능이 남아 있다. |
| 외부 구축 필요 | IdP, Kubernetes, GPU, Search/Vector DB, 운영 계정 등 외부 자원이 필요하다. |
| 미착수 | 구현 증거가 없으며 신규 개발이 필요하다. |

## 체크리스트 범위

- 공통: `FR-COM-001~006`
- 대화·검색: `FR-CHAT-001~004`, `FR-SRCH-001~005`
- 멀티모달: `FR-MM-001~008`
- Citation: `FR-CIT-001~005`
- Agent: `FR-AGT-001~007`
- Tool·MCP: `FR-MCP-001~008`
- 관리자: `FR-ADM-001~007`
- 가용성·성능: `NFR-AVL-001~005`, `NFR-PER-001~005`
- 확장성·유지보수성·호환성: `NFR-SCL`, `NFR-MNT`, `NFR-CMP`
- 데이터 수집·저장: `DR-001~005`, `DR-STO-001~006`

전체 90개 항목의 상태, 구현 증거와 다음 조치는 관리자 Console의
`개발 요구사항 체크리스트`에서 필터링해 확인한다. 체크리스트 원본은
`lib/requirements-registry.ts`이며 API는 `/api/admin/requirements`이다.

관리자 Console은 실행이 필요한 항목에 집중할 수 있도록 `완료` 항목을 목록에서
제외한다. 완료 판정과 구현 증거는 원본 요구사항 Registry에 감사 이력으로 보존한다.

## 이번 반영에서 완료한 항목

- `FR-COM-003`: Worker 진입점에서 모든 요청과 응답에 Trace ID를 강제한다.
- `FR-CHAT-003`: 사용자가 답변 길이와 문단·목록·표 형식을 선택한다.
- `FR-SRCH-003`: 수집 기간과 소스 필터를 서버 검색 조건에 반영하고 로그인 부서 ACL을 적용한다.
- 관리자 Console: 90개 요구사항을 완료·부분 구현·외부 구축 필요·미착수로 표시한다.

## 외부 구축 없이는 완료할 수 없는 주요 항목

- 기업 SSO용 OIDC/SAML IdP Metadata, Client ID, Redirect URI 등록
- Cloudflare AI binding과 GLM 5.2·Embedding·Reranker 모델 설정
- Search Engine·Vector DB 복제 또는 HA Cluster
- PDF/OCR/VLM/STT/Video Scene용 GPU Serving
- OpenTelemetry Collector와 OTLP 수집 Endpoint
- R2 Lifecycle, 백업·DR, 30일 SLO와 150명 부하 시험 증거

외부 자원이 연결되기 전에는 해당 항목을 완료로 승격하지 않는다.
