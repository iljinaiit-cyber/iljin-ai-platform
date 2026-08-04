export type RequirementStatus = "implemented" | "partial" | "external_required" | "not_started";
export type RequirementPriority = "required" | "recommended" | "optional" | "target";

export type DevelopmentRequirement = {
  id: string;
  group: string;
  title: string;
  priority: RequirementPriority;
  status: RequirementStatus;
  evidence: string;
  nextAction?: string;
};

const requirement = (
  id: string,
  group: string,
  title: string,
  status: RequirementStatus,
  evidence: string,
  nextAction?: string,
  priority: RequirementPriority = "required",
): DevelopmentRequirement => ({ id, group, title, priority, status, evidence, nextAction });

export const DEVELOPMENT_REQUIREMENTS: DevelopmentRequirement[] = [
  requirement("FR-COM-001", "공통", "사용자 SSO 로그인", "external_required", "Database 이메일 로그인·관리자 승인 적용", "기업 IdP OIDC/SAML Metadata와 Client 등록 필요"),
  requirement("FR-COM-002", "공통", "사용자·그룹·부서 Context", "partial", "서버 Principal에 사용자·Tenant·부서·역할 적용", "IdP 그룹 Claim 매핑 추가"),
  requirement("FR-COM-003", "공통", "모든 요청 Trace ID", "implemented", "Worker가 전 요청·응답에 X-Trace-Id 강제 적용"),
  requirement("FR-COM-004", "공통", "한국어 기본·다국어 확장", "partial", "한국어 UI·프롬프트·ko-KR Locale 적용", "Locale 전환과 번역 리소스 분리"),
  requirement("FR-COM-005", "공통", "Web 사용자 Portal", "implemented", "반응형 사용자 Portal과 주요 업무 메뉴 제공"),
  requirement("FR-COM-006", "공통", "관리자 Console", "implemented", "관리자 RBAC 기반 Governance·AI 운영 Console 제공"),

  requirement("FR-CHAT-001", "대화·검색", "자연어 질의응답", "implemented", "LLM Gateway와 내부·인터넷 근거 답변 제공"),
  requirement("FR-CHAT-002", "대화·검색", "대화 세션 문맥 유지", "implemented", "Database Conversation·Message 저장 및 서버 문맥 복원"),
  requirement("FR-CHAT-003", "대화·검색", "답변 길이·형식 선택", "implemented", "간결/표준/상세와 문단/목록/표 설정을 Prompt에 적용", undefined, "optional"),
  requirement("FR-CHAT-004", "대화·검색", "Streaming 답변", "partial", "SSE delta/citation/done 계약과 중단 UI 보유", "Provider 원본 스트림 연결 및 First Token 측정"),
  requirement("FR-SRCH-001", "대화·검색", "BM25·Dense Hybrid Search", "implemented", "다중 질의 BM25-like·Dense 병렬 검색 후 RRF Top 50 융합"),
  requirement("FR-SRCH-002", "대화·검색", "검색 결과 재순위화", "implemented", "Cloudflare Reranker Top 20 재정렬·Hybrid 점수 폴백 구현"),
  requirement("FR-SRCH-003", "대화·검색", "유형·기간·부서·소스 필터", "partial", "서버 기간·소스 필터와 부서 ACL, UI 필터 적용", "이미지·영상 유형 색인 후 유형 필터 확장"),
  requirement("FR-SRCH-004", "대화·검색", "검색 사용자 ACL", "implemented", "Tenant·부서·문서등급을 후보 검색 전에 서버 적용"),
  requirement("FR-SRCH-005", "대화·검색", "근거 부족 시 생성 제한", "implemented", "근거 신뢰도·식별자 일치 Verifier 실패 시 LLM 호출 전 422 INSUFFICIENT_EVIDENCE"),

  requirement("FR-MM-001", "멀티모달", "PDF 페이지 이미지 근거", "partial", "PDF 변환·페이지 Region·원본 근거 인용 구현", "PDF 페이지 렌더 Crop Asset과 좌표 정밀화"),
  requirement("FR-MM-002", "멀티모달", "이미지 OCR·Caption", "implemented", "Cloud 비전 변환으로 OCR·Caption·표 Markdown 생성 및 Metadata 저장"),
  requirement("FR-MM-003", "멀티모달", "이미지 Embedding 검색", "partial", "Caption-and-Index와 이미지 질의 Router·모달리티 가중치 구현", "네이티브 Unified Vision Embedding Adapter 추가"),
  requirement("FR-MM-004", "멀티모달", "음성 STT·시간 구간 검색", "not_started", "구현 증거 없음", "STT Serving·타임코드 Segment 필요", "optional"),
  requirement("FR-MM-005", "멀티모달", "영상 Scene·Key Frame", "not_started", "구현 증거 없음", "미디어 Worker·Scene Detection 필요"),
  requirement("FR-MM-006", "멀티모달", "영상 Transcript·OCR·Caption 통합검색", "not_started", "구현 증거 없음", "멀티모달 Segment 통합 Schema 필요"),
  requirement("FR-MM-007", "멀티모달", "Text-to-Image·Image-to-Document", "not_started", "구현 증거 없음", "Cross-modal Embedding 모델 필요"),
  requirement("FR-MM-008", "멀티모달", "Text-to-Video Scene 검색", "not_started", "구현 증거 없음", "Video Scene Vector Index 필요"),

  requirement("FR-CIT-001", "Citation", "파일명·버전·페이지 표시", "implemented", "Citation에 Asset 제목·Version·Page Number 포함"),
  requirement("FR-CIT-002", "Citation", "인용 문장·영역 강조", "partial", "텍스트 Highlight와 Image/Page/Table/Chart Region 좌표 제공", "세부 객체 Bounding Box Overlay 정밀화"),
  requirement("FR-CIT-003", "Citation", "영상 타임코드", "not_started", "영상 Segment 미구현", "start_ms·end_ms Locator Schema 필요"),
  requirement("FR-CIT-004", "Citation", "이미지 Asset ID·영역", "implemented", "Asset·Region ID와 정규화 Bounding Box, 원본 이미지 인용 제공", undefined, "optional"),
  requirement("FR-CIT-005", "Citation", "삭제·권한변경 근거 접근 차단", "implemented", "Citation 조회 시 최신 Tenant·ACL·deleted_at 재검증"),

  requirement("FR-AGT-001", "Agent", "질의 Router", "implemented", "Agent Router가 목적에 따라 등록 Tool 선택"),
  requirement("FR-AGT-002", "Agent", "복합업무 Planner", "implemented", "Router→Planner→Retrieval→Verification→Execution 단계 영속화"),
  requirement("FR-AGT-003", "Agent", "검색 결과 Verifier", "implemented", "Verification 단계에서 근거 상태와 Tool 정책 검사"),
  requirement("FR-AGT-004", "Agent", "도메인별 전문 Agent 구성", "partial", "업무별 Agent UX와 Tool Registry 제공", "관리자 Agent Template·버전 배포 기능"),
  requirement("FR-AGT-005", "Agent", "반복 횟수·실행시간 제한", "implemented", "최대 5회 반복과 Tool별 Timeout 적용"),
  requirement("FR-AGT-006", "Agent", "상태·실행 이력", "implemented", "Database Agent Run·Step 상태와 Trace 조회"),
  requirement("FR-AGT-007", "Agent", "안전 종료·사용자 안내", "implemented", "실패·취소 상태와 안전한 오류 메시지 저장"),

  requirement("FR-MCP-001", "Tool·MCP", "표준 Schema Tool 등록", "implemented", "Tool Registry에 JSON Input Schema 저장"),
  requirement("FR-MCP-002", "Tool·MCP", "조회·변경 Tool 구분", "implemented", "read_only/write Mode 분리"),
  requirement("FR-MCP-003", "Tool·MCP", "Tool Risk Level", "implemented", "R0~R3 Risk Level 적용"),
  requirement("FR-MCP-004", "Tool·MCP", "고위험 Tool 명시적 승인", "implemented", "R2 이상 승인 전 실행 차단·자가 승인 금지"),
  requirement("FR-MCP-005", "Tool·MCP", "Tool 입력 Schema 검증", "implemented", "등록 JSON Schema 기반 서버 입력 검증"),
  requirement("FR-MCP-006", "Tool·MCP", "결과·변경 전후 감사", "partial", "입력·출력·결정자·실행 감사 저장", "외부 변경 Tool의 before/after Snapshot Adapter"),
  requirement("FR-MCP-007", "Tool·MCP", "Idempotency", "implemented", "Run·Execution Idempotency Unique Index 적용", undefined, "recommended"),
  requirement("FR-MCP-008", "Tool·MCP", "Timeout·Retry·Circuit Breaker", "partial", "Timeout·Retry와 LLM Circuit Breaker 적용", "외부 Tool Adapter별 Circuit 상태 영속화"),

  requirement("FR-ADM-001", "관리자", "데이터 소스·수집 상태 관리", "partial", "Asset·Index Job·RAG Pipeline 상태 관리", "Connector별 증분 수집 일정 관리"),
  requirement("FR-ADM-002", "관리자", "인덱싱 실패 재처리", "implemented", "실패 Job 재시도·Asset 재색인 API와 UI"),
  requirement("FR-ADM-003", "관리자", "모델·Prompt 버전 관리", "not_started", "모델 환경 설정과 상태 조회만 제공", "Version Registry·승인·활성화 Schema"),
  requirement("FR-ADM-004", "관리자", "Agent 구성 배포·롤백", "not_started", "실행 Tool Registry만 제공", "Agent Release Snapshot·Rollback"),
  requirement("FR-ADM-005", "관리자", "평가셋·평가 결과 관리", "partial", "Golden RAG·G1/G2·QA Gate 결과 파일 보유", "Database 평가셋 CRUD와 실행 UI"),
  requirement("FR-ADM-006", "관리자", "Token·모델 비용 조회", "partial", "Provider별 Token·호출·지연 조회", "모델 단가표와 원화 비용 계산"),
  requirement("FR-ADM-007", "관리자", "보안 이벤트·감사 로그", "implemented", "관리자 감사 로그·보안 Negative Gate 조회"),

  requirement("NFR-AVL-001", "가용성", "월 가용성 99.9%", "external_required", "SLO 목표와 Readiness는 구현", "30일 운영 측정·SLA 보고서 필요", "target"),
  requirement("NFR-AVL-002", "가용성", "핵심 API·Agent 다중 인스턴스", "partial", "Edge Runtime Stateless 배포", "사내 Agent/Kubernetes Replica 검증", "target"),
  requirement("NFR-AVL-003", "가용성", "DB·Search·Vector HA", "external_required", "Managed Database·Object Storage 사용", "사내 Search·Vector 복제 구성 증빙", "target"),
  requirement("NFR-AVL-004", "가용성", "외부 모델 장애 대체·제한모드", "implemented", "로컬→Cloudflare GLM 5.2 Failover와 별도 RAG 폴백"),
  requirement("NFR-AVL-005", "가용성", "비동기 인덱싱 재시작·재처리", "implemented", "Index Job 상태·Retry·수동 재색인"),
  requirement("NFR-PER-001", "성능", "검색 API P95 2초", "partial", "Retrieval Trace P95 계측", "운영 150명 부하 결과 목표 충족 필요", "target"),
  requirement("NFR-PER-002", "성능", "RAG 답변 P95 8초", "partial", "LLM Latency 계측", "운영 부하 결과 목표 충족 필요", "target"),
  requirement("NFR-PER-003", "성능", "멀티모달 답변 P95 12초", "not_started", "멀티모달 미구현", "멀티모달 Pipeline 후 측정", "target"),
  requirement("NFR-PER-004", "성능", "Streaming First Token P95 3초", "partial", "SSE 계약 보유", "Provider 원본 Streaming과 TTFT 계측", "target"),
  requirement("NFR-PER-005", "성능", "Portal 주요 화면 P95 3초", "partial", "반응형 번들·브라우저 QA 보유", "RUM Web Vitals 수집", "target"),

  requirement("NFR-SCL-001", "확장성", "Stateless API·Agent 수평 확장", "partial", "Edge API Stateless, Agent 상태 Database 저장", "Kubernetes Agent Replica 시험", "target"),
  requirement("NFR-SCL-002", "확장성", "Indexing Worker 독립 확장", "external_required", "Job Schema만 구현", "Queue Consumer 독립 배포", "target"),
  requirement("NFR-SCL-003", "확장성", "GPU Pool 분리·증설", "external_required", "LLM Adapter 분리", "로컬 GPU Pool 구축·Cloudflare 용량 검증", "target"),
  requirement("NFR-SCL-004", "확장성", "Storage Tier 확장", "partial", "Object Storage 원본·Metadata Database 분리", "Lifecycle·Archive Tier 정책", "target"),
  requirement("NFR-SCL-005", "확장성", "Tenant·도메인별 Index 분리", "partial", "모든 Metadata에 tenant_id 적용", "물리 Index Routing 구성", "target"),
  requirement("NFR-SCL-006", "확장성", "모델별 트래픽 분산", "implemented", "3단계 Provider Gateway와 Feature Toggle", undefined, "target"),

  requirement("NFR-MNT-001", "유지보수성", "설정·코드 분리", "implemented", "Runtime Env·Wrangler Vars·Secrets 분리", undefined, "target"),
  requirement("NFR-MNT-002", "유지보수성", "Prompt·Agent·Model 버전 관리", "not_started", "환경 설정 기반 활성 모델만 관리", "Version Registry 구축", "target"),
  requirement("NFR-MNT-003", "유지보수성", "API 계약 문서화", "partial", "OpenAPI 문서 보유", "현재 전체 Route와 Schema 동기화", "target"),
  requirement("NFR-MNT-004", "유지보수성", "자동 Unit·Integration·Regression", "implemented", "15개 회귀 Test·QA Gate·실제 통합 Probe", undefined, "target"),
  requirement("NFR-MNT-005", "유지보수성", "GitOps 배포·롤백", "partial", "Git 커밋·운영 Version 배포", "GitHub Actions 승인 배포·자동 롤백", "target"),
  requirement("NFR-MNT-006", "유지보수성", "구성요소 교체 가능 구조", "implemented", "LLM·Embedding·Reranker·Search Adapter 분리", undefined, "target"),

  requirement("NFR-CMP-001", "호환성", "표준 REST API", "implemented", "/api/v1 REST 계약 제공", undefined, "target"),
  requirement("NFR-CMP-002", "호환성", "JSON Schema", "implemented", "Tool Input Schema와 OpenAPI JSON Schema 적용", undefined, "target"),
  requirement("NFR-CMP-003", "호환성", "OIDC/SAML", "external_required", "App Email Auth 운영", "기업 IdP Metadata·Client 등록", "target"),
  requirement("NFR-CMP-004", "호환성", "S3 호환 Object Storage", "implemented", "Object Storage 원본 저장", undefined, "target"),
  requirement("NFR-CMP-005", "호환성", "OpenTelemetry", "not_started", "Trace ID와 운영 Metric만 구현", "OTLP Exporter·Collector 연결", "target"),
  requirement("NFR-CMP-006", "호환성", "MCP·표준 Tool Adapter", "partial", "표준 Tool Registry·Adapter 계약", "실제 MCP Server 연결 시험", "target"),
  requirement("NFR-CMP-007", "호환성", "주요 브라우저 지원", "partial", "반응형·접근성 자동검증", "Chrome·Edge·Safari 실기기 Matrix", "target"),

  requirement("DR-001", "데이터", "소스별 Incremental 수집", "partial", "Checksum 중복 방지·재색인 제공", "Connector Cursor·변경 Segment 처리"),
  requirement("DR-002", "데이터", "파일 Hash 변경 감지", "implemented", "SHA-256 Checksum과 Tenant 중복 감지"),
  requirement("DR-003", "데이터", "원본·파생·Index 식별자 연결", "implemented", "Storage Key·Asset·Segment·Job ID 연결"),
  requirement("DR-004", "데이터", "파싱 실패·재처리 상태", "implemented", "Index Job 오류·상태·Retry Count 저장"),
  requirement("DR-005", "데이터", "수집 시 ACL·버전 저장", "implemented", "Asset classification·department_scope·version 저장"),
  requirement("DR-STO-001", "데이터 저장", "원본 Object Storage", "implemented", "Object Storage 원문 저장"),
  requirement("DR-STO-002", "데이터 저장", "Asset·Segment·ACL·Version Metadata DB", "implemented", "Metadata Database Schema"),
  requirement("DR-STO-003", "데이터 저장", "텍스트 Search Engine", "partial", "Database 기반 BM25-like 검색", "운영 OpenSearch 복제·동기화"),
  requirement("DR-STO-004", "데이터 저장", "Embedding Vector DB", "partial", "Segment Embedding 저장·cosine 검색", "운영 Vector DB/Index 연결"),
  requirement("DR-STO-005", "데이터 저장", "원본 삭제 시 파생·Index 연쇄 삭제", "partial", "Soft Delete와 Citation 차단", "Storage·Segment·외부 Index 비동기 Purge"),
  requirement("DR-STO-006", "데이터 저장", "보존기간·Lifecycle 정책", "external_required", "구현 증거 없음", "Storage Lifecycle·Database Retention Job 구성"),
];

// The source registry remains an audit record. The administrator checklist is
// an action queue, so requirements with verified implementation evidence are
// excluded from the active view instead of being shown indefinitely.
export const OUTSTANDING_DEVELOPMENT_REQUIREMENTS = DEVELOPMENT_REQUIREMENTS.filter(
  (item) => item.status !== "implemented",
);

export function requirementSummary(items = DEVELOPMENT_REQUIREMENTS) {
  const counts = {
    total: items.length,
    implemented: 0,
    partial: 0,
    external_required: 0,
    not_started: 0,
  };
  items.forEach((item) => { counts[item.status] += 1; });
  return {
    ...counts,
    completionPercent: Math.round((counts.implemented / Math.max(counts.total, 1)) * 100),
    readinessPercent: Math.round(((counts.implemented + counts.partial * 0.5) / Math.max(counts.total, 1)) * 100),
  };
}
