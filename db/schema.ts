import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default("iljin"),
    title: text("title").notNull(),
    sourceType: text("source_type").notNull().default("upload"),
    mimeType: text("mime_type").notNull().default("text/plain"),
    status: text("status").notNull().default("received"),
    classification: text("classification").notNull().default("internal"),
    departmentScope: text("department_scope").notNull().default("*"),
    storageKey: text("storage_key"),
    checksum: text("checksum"),
    originalSize: integer("original_size"),
    originalEtag: text("original_etag"),
    originalUploadedAt: text("original_uploaded_at"),
    embeddingModel: text("embedding_model"),
    embeddingDimensions: integer("embedding_dimensions"),
    version: integer("version").notNull().default(1),
    documentStatus: text("document_status").default("effective"),
    effectiveFrom: text("effective_from"),
    effectiveTo: text("effective_to"),
    ownerEmail: text("owner_email"),
    segmentCount: integer("segment_count").notNull().default(0),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("assets_status_idx").on(table.status),
    index("assets_tenant_class_idx").on(table.tenantId, table.classification),
  ],
);

export const userProfiles = sqliteTable(
  "user_profiles",
  {
    email: text("email").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    displayName: text("display_name").notNull(),
    department: text("department").notNull(),
    groupsJson: text("groups_json").notNull().default("[]"),
    role: text("role").notNull().default("user"),
    status: text("status").notNull().default("active"),
    approvalRequestedAt: text("approval_requested_at"),
    applicationNote: text("application_note"),
    approvedBy: text("approved_by"),
    approvedAt: text("approved_at"),
    rejectionReason: text("rejection_reason"),
    preferencesJson: text("preferences_json").default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("user_profiles_tenant_department_idx").on(table.tenantId, table.department),
    index("user_profiles_status_requested_idx").on(table.status, table.approvalRequestedAt),
  ],
);

export const authCredentials = sqliteTable(
  "auth_credentials",
  {
    email: text("email").primaryKey().references(() => userProfiles.email, { onDelete: "cascade" }),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),
    passwordIterations: integer("password_iterations").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    sessionHash: text("session_hash").primaryKey(),
    email: text("email").notNull().references(() => userProfiles.email, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("auth_sessions_email_idx").on(table.email),
    index("auth_sessions_expires_idx").on(table.expiresAt),
  ],
);

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    tenantId: text("tenant_id").notNull(),
    role: text("role").notNull(),
    permissionKey: text("permission_key").notNull(),
    allowed: integer("allowed", { mode: "boolean" }).notNull(),
    updatedBy: text("updated_by").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("role_permissions_pk").on(table.tenantId, table.role, table.permissionKey),
  ],
);

export const userPermissionOverrides = sqliteTable(
  "user_permission_overrides",
  {
    tenantId: text("tenant_id").notNull(),
    email: text("email").notNull().references(() => userProfiles.email, { onDelete: "cascade" }),
    permissionKey: text("permission_key").notNull(),
    allowed: integer("allowed", { mode: "boolean" }).notNull(),
    updatedBy: text("updated_by").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("user_permission_overrides_pk").on(table.tenantId, table.email, table.permissionKey),
    index("user_permission_overrides_email_idx").on(table.tenantId, table.email),
  ],
);

export const featureSettings = sqliteTable(
  "feature_settings",
  {
    tenantId: text("tenant_id").notNull(),
    featureKey: text("feature_key").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    configJson: text("config_json").notNull().default("{}"),
    updatedBy: text("updated_by").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("feature_settings_pk").on(table.tenantId, table.featureKey),
    index("feature_settings_tenant_idx").on(table.tenantId, table.featureKey),
  ],
);

export const aiControlAssessments = sqliteTable(
  "ai_control_assessments",
  {
    tenantId: text("tenant_id").notNull(),
    controlId: text("control_id").notNull(),
    status: text("status").notNull(),
    ownerEmail: text("owner_email"),
    evidenceNote: text("evidence_note").notNull().default(""),
    dueDate: text("due_date"),
    updatedBy: text("updated_by").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("ai_control_assessments_pk").on(table.tenantId, table.controlId),
    index("ai_control_assessments_status_idx").on(table.tenantId, table.status),
  ],
);

export const aiSloPolicies = sqliteTable(
  "ai_slo_policies",
  {
    tenantId: text("tenant_id").notNull(),
    metricKey: text("metric_key").notNull(),
    targetValue: real("target_value").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    updatedBy: text("updated_by").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("ai_slo_policies_pk").on(table.tenantId, table.metricKey),
  ],
);

export const segments = sqliteTable(
  "segments",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    ordinal: integer("ordinal").notNull(),
    heading: text("heading"),
    content: text("content").notNull(),
    pageNumber: integer("page_number"),
    charStart: integer("char_start").notNull().default(0),
    charEnd: integer("char_end").notNull().default(0),
    tokenCount: integer("token_count").notNull().default(0),
    embedding: text("embedding"),
    embeddingModel: text("embedding_model"),
    vectorIndexedAt: text("vector_indexed_at"),
    timeStartMs: integer("time_start_ms"),
    timeEndMs: integer("time_end_ms"),
    speaker: text("speaker"),
    modality: text("modality").notNull().default("text"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("segments_asset_idx").on(table.assetId, table.ordinal),
    index("segments_embedding_model_idx").on(table.embeddingModel),
  ],
);

export const visualRegions = sqliteTable(
  "visual_regions",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    segmentId: text("segment_id").references(() => segments.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull().default(1),
    regionType: text("region_type").notNull().default("image"),
    ordinal: integer("ordinal").notNull().default(0),
    bboxJson: text("bbox_json"),
    caption: text("caption"),
    ocrText: text("ocr_text"),
    tableMarkdown: text("table_markdown"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("visual_regions_asset_idx").on(table.assetId, table.pageNumber),
    index("visual_regions_segment_idx").on(table.segmentId),
  ],
);

export const indexJobs = sqliteTable(
  "index_jobs",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id").references(() => assets.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    stage: text("stage").notNull().default("received"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    attemptCount: integer("attempt_count").notNull().default(0),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("index_jobs_status_idx").on(table.status, table.createdAt)],
);

export const retrievalTraces = sqliteTable(
  "retrieval_traces",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default("iljin"),
    ownerEmail: text("owner_email").notNull().default(""),
    queryHash: text("query_hash").notNull(),
    department: text("department").notNull(),
    resultCount: integer("result_count").notNull(),
    topScore: integer("top_score").notNull().default(0),
    latencyMs: integer("latency_ms").notNull(),
    embeddingModel: text("embedding_model"),
    embeddingDimensions: integer("embedding_dimensions"),
    rerankModel: text("rerank_model"),
    rerankStatus: text("rerank_status").notNull().default("not_configured"),
    candidateCount: integer("candidate_count").notNull().default(0),
    queryVariantCount: integer("query_variant_count").notNull().default(1),
    fusionStrategy: text("fusion_strategy").notNull().default("weighted"),
    fusionCandidateCount: integer("fusion_candidate_count").notNull().default(0),
    rerankCandidateCount: integer("rerank_candidate_count").notNull().default(0),
    evidenceConfidence: integer("evidence_confidence").notNull().default(0),
    verifierStatus: text("verifier_status").notNull().default("not_evaluated"),
    searchScope: text("search_scope").notNull().default("internal"),
    searchProvider: text("search_provider"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("retrieval_traces_created_idx").on(table.createdAt),
    index("retrieval_traces_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("retrieval_traces_owner_created_idx").on(table.tenantId, table.ownerEmail, table.createdAt),
  ],
);

export const llmInvocations = sqliteTable(
  "llm_invocations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    conversationId: text("conversation_id"),
    traceId: text("trace_id").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    sensitivity: text("sensitivity").notNull().default("internal"),
    fallbackUsed: integer("fallback_used", { mode: "boolean" }).notNull().default(false),
    fallbackPathJson: text("fallback_path_json").notNull().default("[]"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("llm_invocations_trace_uidx").on(table.tenantId, table.traceId),
    index("llm_invocations_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("llm_invocations_provider_created_idx").on(table.tenantId, table.provider, table.createdAt),
  ],
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("conversations_owner_idx").on(table.tenantId, table.ownerEmail, table.updatedAt)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    provider: text("provider"),
    model: text("model"),
    usageJson: text("usage_json"),
    citationsJson: text("citations_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("messages_conversation_idx").on(table.conversationId, table.createdAt)],
);

export const conversationAttachments = sqliteTable(
  "conversation_attachments",
  {
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    retention: text("retention").notNull().default("temporary"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.assetId] }),
    index("conversation_attachments_asset_idx").on(table.assetId),
  ],
);

export const messageFeedback = sqliteTable(
  "message_feedback",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    ownerEmail: text("owner_email").notNull(),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("message_feedback_message_idx").on(table.messageId)],
);

export const feedbackPosts = sqliteTable(
  "feedback_posts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    authorEmail: text("author_email").notNull(),
    authorDisplayName: text("author_display_name").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    status: text("status").notNull().default("received"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("feedback_posts_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("feedback_posts_tenant_category_idx").on(table.tenantId, table.category, table.createdAt),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    traceId: text("trace_id").notNull(),
    outcome: text("outcome").notNull(),
    detailsJson: text("details_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("audit_logs_tenant_created_idx").on(table.tenantId, table.createdAt)],
);

export const rateLimitBuckets = sqliteTable(
  "rate_limit_buckets",
  {
    bucketKey: text("bucket_key").primaryKey(),
    requestCount: integer("request_count").notNull(),
    windowStartedAt: text("window_started_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [index("rate_limit_expires_idx").on(table.expiresAt)],
);

export const toolRegistry = sqliteTable(
  "tool_registry",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default("*"),
    name: text("name").notNull(),
    description: text("description").notNull(),
    riskLevel: text("risk_level").notNull().default("R0"),
    mode: text("mode").notNull().default("read_only"),
    adapterType: text("adapter_type").notNull().default("builtin"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    timeoutMs: integer("timeout_ms").notNull().default(3000),
    maxRetries: integer("max_retries").notNull().default(0),
    inputSchemaJson: text("input_schema_json").notNull().default("{}"),
    requiredRolesJson: text("required_roles_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("tool_registry_enabled_risk_idx").on(table.enabled, table.riskLevel),
    index("tool_registry_adapter_idx").on(table.adapterType),
  ],
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    title: text("title").notNull(),
    objective: text("objective").notNull(),
    status: text("status").notNull().default("queued"),
    currentState: text("current_state").notNull().default("router"),
    selectedToolId: text("selected_tool_id").references(() => toolRegistry.id),
    maxIterations: integer("max_iterations").notNull().default(5),
    iterationCount: integer("iteration_count").notNull().default(0),
    idempotencyKey: text("idempotency_key").notNull(),
    inputJson: text("input_json"),
    outputJson: text("output_json"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    traceId: text("trace_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("agent_runs_owner_idempotency_uidx").on(table.tenantId, table.ownerEmail, table.idempotencyKey),
    index("agent_runs_owner_created_idx").on(table.tenantId, table.ownerEmail, table.createdAt),
    index("agent_runs_status_updated_idx").on(table.status, table.updatedAt),
  ],
);

export const agentSteps = sqliteTable(
  "agent_steps",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    stepType: text("step_type").notNull(),
    status: text("status").notNull().default("queued"),
    toolId: text("tool_id").references(() => toolRegistry.id),
    traceId: text("trace_id").notNull(),
    inputJson: text("input_json"),
    outputJson: text("output_json"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("agent_steps_run_sequence_uidx").on(table.runId, table.sequence),
    index("agent_steps_run_status_idx").on(table.runId, table.status),
  ],
);

export const toolApprovalRequests = sqliteTable(
  "tool_approval_requests",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
    stepId: text("step_id").notNull().references(() => agentSteps.id, { onDelete: "cascade" }),
    toolId: text("tool_id").notNull().references(() => toolRegistry.id),
    requesterEmail: text("requester_email").notNull(),
    status: text("status").notNull().default("pending"),
    reason: text("reason").notNull(),
    inputJson: text("input_json").notNull().default("{}"),
    decisionBy: text("decision_by"),
    decisionNote: text("decision_note"),
    decidedAt: text("decided_at"),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("tool_approval_requests_run_step_uidx").on(table.runId, table.stepId),
    index("tool_approval_requests_status_expires_idx").on(table.status, table.expiresAt),
  ],
);

export const toolExecutions = sqliteTable(
  "tool_executions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
    stepId: text("step_id").notNull().references(() => agentSteps.id, { onDelete: "cascade" }),
    toolId: text("tool_id").notNull().references(() => toolRegistry.id),
    approvalRequestId: text("approval_request_id").references(() => toolApprovalRequests.id),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    inputJson: text("input_json").notNull().default("{}"),
    outputJson: text("output_json"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("tool_executions_idempotency_uidx").on(table.idempotencyKey),
    index("tool_executions_run_status_idx").on(table.runId, table.status),
  ],
);

export const ingestionSources = sqliteTable(
  "ingestion_sources",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default("iljin"),
    name: text("name").notNull(),
    sourceType: text("source_type").notNull().default("r2-folder"),
    connectionConfig: text("connection_config").notNull().default("{}"),
    scheduleIntervalMinutes: integer("schedule_interval_minutes").notNull().default(360),
    classification: text("classification").notNull().default("internal"),
    departmentScope: text("department_scope").notNull().default("*"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastRunAt: text("last_run_at"),
    lastRunStatus: text("last_run_status"),
    lastRunSummary: text("last_run_summary"),
    totalIngested: integer("total_ingested").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (table) => [index("ingestion_sources_enabled_idx").on(table.enabled, table.tenantId)],
);
