-- Runtime-created admin and agent objects are owned by migrations from this point.
-- Existing production databases must use the documented history reconciliation before
-- this file is marked applied, because their schema predates the migration journal.

CREATE TABLE IF NOT EXISTS scoped_permission_policies (
  tenant_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  target_key TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  allowed INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, scope, target_key, permission_key)
);
CREATE INDEX IF NOT EXISTS scoped_permission_policies_target_idx
  ON scoped_permission_policies(tenant_id, scope, target_key);

CREATE TABLE IF NOT EXISTS user_token_allocations (
  tenant_id TEXT NOT NULL,
  email TEXT NOT NULL,
  monthly_limit_tokens INTEGER,
  token_balance INTEGER,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS user_token_allocations_tenant_idx
  ON user_token_allocations(tenant_id, email);

CREATE TABLE IF NOT EXISTS corporations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS corporations_name_idx ON corporations(tenant_id, name);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  corp_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  code TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (corp_id) REFERENCES corporations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS departments_corp_idx ON departments(tenant_id, corp_id);
CREATE INDEX IF NOT EXISTS departments_parent_idx ON departments(parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS departments_name_idx
  ON departments(tenant_id, corp_id, COALESCE(parent_id, ''), name);

ALTER TABLE user_profiles ADD COLUMN corp_id TEXT;
ALTER TABLE user_profiles ADD COLUMN dept_id TEXT;
ALTER TABLE user_profiles ADD COLUMN job_title TEXT NOT NULL DEFAULT '미지정';
CREATE INDEX IF NOT EXISTS user_profiles_org_idx ON user_profiles(tenant_id, corp_id, dept_id);

-- Built-in tools are static platform data, not request-time bootstrap work.
INSERT OR IGNORE INTO tool_registry
  (id, tenant_id, name, description, risk_level, mode, adapter_type, enabled, timeout_ms, max_retries, input_schema_json, required_roles_json, created_at, updated_at)
VALUES
  ('platform.rag_status', '*', 'RAG 플랫폼 상태 조회', '현재 사용자의 권한 범위에서 문서·세그먼트 수와 RAG 구성 상태를 읽습니다.', 'R0', 'read_only', 'builtin', 1, 2000, 0, '{"type":"object","additionalProperties":false}', '["user","manager","admin"]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('knowledge.search', '*', '사내 지식 근거 검색', '부서 ACL을 적용한 Hybrid Search를 실행하고 Citation 근거를 반환합니다.', 'R1', 'read_only', 'builtin', 1, 10000, 1, '{"type":"object","properties":{"query":{"type":"string","minLength":2,"maxLength":1000}}}', '["user","manager","admin"]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('work.assistant', '*', '업무 Agent 분석 및 초안', '접근 가능한 사내 문서를 근거로 회의 정리, 업무 계획, 문서 검토와 같은 업무 초안을 작성합니다.', 'R1', 'read_only', 'builtin', 1, 15000, 0, '{"type":"object","properties":{"task":{"type":"string","minLength":2,"maxLength":2000}},"required":["task"],"additionalProperties":false}', '["user","manager","admin"]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('controlled.change_evidence', '*', '통제 변경 증빙 생성', 'R2 승인 경로를 검증하기 위한 읽기 전용 Demo Tool입니다. 외부 시스템을 변경하지 않고 승인·멱등성 증빙만 생성합니다.', 'R2', 'read_only', 'builtin', 1, 2000, 0, '{"type":"object","properties":{"change":{"type":"string","maxLength":1000}}}', '["user","manager","admin"]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('erp.purchase_order.read', '*', 'ERP 구매오더 조회', 'ERP Adapter 계약 예시입니다. Sandbox와 인증정보가 없어 비활성화되어 있습니다.', 'R1', 'read_only', 'external', 0, 5000, 1, '{"type":"object","properties":{"purchaseOrderId":{"type":"string"}},"required":["purchaseOrderId"]}', '["user","manager","admin"]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('itsm.ticket.create', '*', 'ITSM 티켓 생성', 'ITSM Adapter 계약 예시입니다. R2 승인과 실제 연결정보가 필요하며 현재 비활성화되어 있습니다.', 'R2', 'write', 'external', 0, 5000, 0, '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}', '["manager","admin"]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mes.work_order.update', '*', 'MES 작업지시 변경', 'MES Adapter 계약 예시입니다. R3 이중 통제와 Sandbox가 없어 비활성화되어 있습니다.', 'R3', 'write', 'external', 0, 5000, 0, '{"type":"object","properties":{"workOrderId":{"type":"string"},"status":{"type":"string"}},"required":["workOrderId","status"]}', '["manager","admin"]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('hr.travel.submit', '*', 'HR 출장 신청 제출', 'HR Adapter 계약 예시입니다. R3 승인과 HR Sandbox가 없어 비활성화되어 있습니다.', 'R3', 'write', 'external', 0, 5000, 0, '{"type":"object","properties":{"requestId":{"type":"string"}},"required":["requestId"]}', '["user","manager","admin"]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
