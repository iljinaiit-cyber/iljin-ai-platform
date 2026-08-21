import { getD1 } from "../db";
import { getRuntimeEnv } from "./runtime-env";

export type UserRole = "user" | "manager" | "admin";
export type UserApprovalStatus = "unrequested" | "pending" | "approved" | "rejected";

export type Principal = {
  email: string;
  displayName: string;
  tenantId: string;
  department: string;
  jobTitle: string;
  /** 조직 마스터 참조. 미배정 사용자는 null 이다(추측 배정하지 않는다). */
  corpId: string | null;
  deptId: string | null;
  groups: string[];
  role: UserRole;
};

export type AccessIdentity = Principal & {
  locale: string;
  status: UserApprovalStatus;
  approvalRequestedAt?: string;
  applicationNote?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
};

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 401 | 403 | 409 | 429 | 503,
    public readonly code:
      | "AUTH_UNAUTHORIZED"
      | "AUTH_FORBIDDEN"
      | "AUTH_APPLICATION_REQUIRED"
      | "AUTH_APPROVAL_REQUIRED"
      | "AUTH_REJECTED"
      | "AUTH_INVALID_INPUT"
      | "AUTH_INVALID_CREDENTIALS"
      | "AUTH_ACCOUNT_EXISTS"
      | "AUTH_BOOTSTRAP_REQUIRED"
      | "AUTH_BOOTSTRAP_NOT_CONFIGURED"
      | "AUTH_RATE_LIMITED"
      | "AUTH_EMAIL_DOMAIN_NOT_ALLOWED"
      | "AUTH_EMAIL_NOT_CONFIGURED"
      | "AUTH_EMAIL_DELIVERY_FAILED"
      | "AUTH_EMAIL_VERIFICATION_INVALID"
      | "AUTH_EMAIL_VERIFICATION_EXPIRED",
  ) {
    super(message);
  }
}

export class RegistrationSystemError extends Error {
  constructor(
    public readonly stage: "password_hash" | "account_write" | "profile_read" | "session_create",
    cause: unknown,
  ) {
    super(`Registration failed during ${stage}`, { cause });
    this.name = "RegistrationSystemError";
  }
}

const SESSION_COOKIE = "iljin_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const PASSWORD_ITERATIONS = 100_000;
const REGISTRATION_EMAIL_DOMAIN = "iljin.com";
const VERIFICATION_TTL_MS = 15 * 60 * 1000;
const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
const VERIFICATION_MAX_SENDS_PER_DAY = 3;

function adminEmails() {
  return new Set(
    (getRuntimeEnv().ADMIN_EMAILS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function localIdentityAllowed(request: Request) {
  if (getRuntimeEnv().ALLOW_DEV_IDENTITY === "true") return true;
  try {
    const hostname = new URL(request.url).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

let identitySchemaPromise: Promise<void> | undefined;

export function ensureIdentitySchema() {
  if (!identitySchemaPromise) {
    identitySchemaPromise = (async () => {
      const db = getD1();
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS user_profiles (
          email TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, display_name TEXT NOT NULL,
          department TEXT NOT NULL, job_title TEXT NOT NULL DEFAULT '미지정', groups_json TEXT NOT NULL DEFAULT '[]',
          role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'pending',
          approval_requested_at TEXT, application_note TEXT, approved_by TEXT, approved_at TEXT,
          rejection_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS audit_logs (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor_email TEXT NOT NULL,
          action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT,
          trace_id TEXT NOT NULL, outcome TEXT NOT NULL, details_json TEXT, created_at TEXT NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS auth_credentials (
          email TEXT PRIMARY KEY, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
          password_iterations INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          FOREIGN KEY (email) REFERENCES user_profiles(email) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
          session_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (email) REFERENCES user_profiles(email) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS email_verification_requests (
          email TEXT PRIMARY KEY, display_name TEXT NOT NULL, department TEXT NOT NULL, note TEXT,
          password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, password_iterations INTEGER NOT NULL,
          token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, sent_count INTEGER NOT NULL DEFAULT 0,
          last_sent_at TEXT, bootstrap_admin INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )`),
      ]);

      const columns = await db.prepare("PRAGMA table_info(user_profiles)").all<{ name: string }>();
      const names = new Set((columns.results || []).map((column) => column.name));
      const additions = [
        ["approval_requested_at", "ALTER TABLE user_profiles ADD COLUMN approval_requested_at TEXT"],
        ["application_note", "ALTER TABLE user_profiles ADD COLUMN application_note TEXT"],
        ["approved_by", "ALTER TABLE user_profiles ADD COLUMN approved_by TEXT"],
        ["approved_at", "ALTER TABLE user_profiles ADD COLUMN approved_at TEXT"],
        ["rejection_reason", "ALTER TABLE user_profiles ADD COLUMN rejection_reason TEXT"],
        ["preferences_json", "ALTER TABLE user_profiles ADD COLUMN preferences_json TEXT DEFAULT '{}'"],
        // 조직 마스터 참조. findProfile 이 항상 이 컬럼을 읽으므로 organization.ts
        // 로딩 순서와 무관하게 여기서 보장한다.
        ["corp_id", "ALTER TABLE user_profiles ADD COLUMN corp_id TEXT"],
        ["dept_id", "ALTER TABLE user_profiles ADD COLUMN dept_id TEXT"],
        ["job_title", "ALTER TABLE user_profiles ADD COLUMN job_title TEXT NOT NULL DEFAULT '미지정'"],
      ] as const;
      const missing = additions.filter(([name]) => !names.has(name));
      if (missing.length) await db.batch(missing.map(([, sql]) => db.prepare(sql)));

      await db.batch([
        db.prepare("UPDATE user_profiles SET status = 'approved' WHERE status = 'active'"),
        db.prepare("CREATE INDEX IF NOT EXISTS user_profiles_tenant_department_idx ON user_profiles(tenant_id, department)"),
        db.prepare("CREATE INDEX IF NOT EXISTS user_profiles_status_requested_idx ON user_profiles(status, approval_requested_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS audit_logs_tenant_created_idx ON audit_logs(tenant_id, created_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS auth_sessions_email_idx ON auth_sessions(email)"),
        db.prepare("CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions(expires_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS email_verification_requests_expires_idx ON email_verification_requests(expires_at)"),
        db.prepare("DELETE FROM auth_sessions WHERE unixepoch(expires_at) <= unixepoch('now')"),
        db.prepare("DELETE FROM email_verification_requests WHERE unixepoch(expires_at) <= unixepoch('now')"),
      ]);
    })().catch((error) => {
      identitySchemaPromise = undefined;
      throw error;
    });
  }
  return identitySchemaPromise;
}

type ProfileRow = {
  email: string;
  tenant_id: string;
  display_name: string;
  department: string;
  job_title: string;
  corp_id: string | null;
  dept_id: string | null;
  groups_json: string;
  role: UserRole;
  status: string;
  approval_requested_at: string | null;
  application_note: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  preferences_json: string | null;
  created_at: string;
  updated_at: string;
};

type ProfilePreferences = Record<string, unknown>;

function parseProfilePreferences(value: string | null) {
  if (!value) return {} as ProfilePreferences;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as ProfilePreferences : {};
  } catch {
    return {};
  }
}

function profileCountry(preferences: ProfilePreferences) {
  const value = preferences.country;
  return typeof value === "string" && /^[A-Z]{2}$/.test(value) ? value : "KR";
}

function profileLanguage(preferences: ProfilePreferences) {
  const value = preferences.language;
  return typeof value === "string" && /^[a-z]{2,3}$/.test(value) ? value : "ko";
}

function normalizeProfileLocale(value: string) {
  const match = value.trim().match(/^([a-z]{2,3})[-_]([a-z]{2})$/i);
  if (!match) throw new AuthError("언어·지역 형식이 올바르지 않습니다.", 400, "AUTH_INVALID_INPUT");
  return `${match[1].toLowerCase()}-${match[2].toUpperCase()}`;
}

function profileLocale(preferences: ProfilePreferences) {
  if (typeof preferences.locale === "string") {
    try { return normalizeProfileLocale(preferences.locale); } catch { /* legacy values below */ }
  }
  return `${profileLanguage(preferences)}-${profileCountry(preferences)}`;
}

function toAccessIdentity(row: ProfileRow): AccessIdentity {
  const preferences = parseProfilePreferences(row.preferences_json);
  return {
    email: row.email,
    tenantId: row.tenant_id,
    displayName: row.display_name,
    department: row.department,
    jobTitle: row.job_title || "미지정",
    locale: profileLocale(preferences),
    corpId: row.corp_id ?? null,
    deptId: row.dept_id ?? null,
    groups: JSON.parse(row.groups_json || "[]") as string[],
    role: row.role,
    status: row.status === "unrequested" || row.status === "approved" || row.status === "rejected" ? row.status : "pending",
    approvalRequestedAt: row.approval_requested_at || undefined,
    applicationNote: row.application_note || undefined,
    approvedBy: row.approved_by || undefined,
    approvedAt: row.approved_at || undefined,
    rejectionReason: row.rejection_reason || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findProfile(email: string) {
  return getD1().prepare(`SELECT email, tenant_id, display_name, department, job_title, groups_json, role, status,
    approval_requested_at, application_note, approved_by, approved_at, rejection_reason, preferences_json, created_at, updated_at,
    corp_id, dept_id
    FROM user_profiles WHERE email = ?`).bind(email).first<ProfileRow>();
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new AuthError("올바른 이메일 주소를 입력해 주세요.", 400, "AUTH_INVALID_INPUT");
  }
  return email;
}

function assertRegistrationEmailDomain(email: string) {
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (domain !== REGISTRATION_EMAIL_DOMAIN) {
    throw new AuthError(
      "일진 임직원 이메일(@iljin.com)만 가입할 수 있습니다.",
      400,
      "AUTH_EMAIL_DOMAIN_NOT_ALLOWED",
    );
  }
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function digest(value: string) {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

async function derivePasswordHash(password: string, salt: Uint8Array, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt.buffer as ArrayBuffer, iterations },
    key,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let mismatch = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return mismatch === 0;
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  for (const item of cookies.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return undefined;
}

function secureCookieAttribute(request: Request) {
  return new URL(request.url).protocol === "https:" ? "; Secure" : "";
}

export function sessionCookie(token: string, request: Request) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly${secureCookieAttribute(request)}; SameSite=Lax`;
}

export function expiredSessionCookie(request: Request) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly${secureCookieAttribute(request)}; SameSite=Lax; Max-Age=0`;
}

async function createSession(email: string) {
  const token = bytesToBase64Url(randomBytes(32));
  const sessionHash = await digest(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
  await getD1().prepare(`INSERT INTO auth_sessions (session_hash, email, expires_at, created_at)
    VALUES (?, ?, ?, ?)`).bind(sessionHash, email, expiresAt, now.toISOString()).run();
  return token;
}

async function resolveSessionEmail(request: Request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return undefined;
  const sessionHash = await digest(token);
  const row = await getD1().prepare(`SELECT email, expires_at FROM auth_sessions WHERE session_hash = ?`)
    .bind(sessionHash).first<{ email: string; expires_at: string }>();
  if (!row) return undefined;
  if (Date.parse(row.expires_at) <= Date.now()) {
    await getD1().prepare("DELETE FROM auth_sessions WHERE session_hash = ?").bind(sessionHash).run();
    return undefined;
  }
  const newExpiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await getD1().prepare("UPDATE auth_sessions SET expires_at = ? WHERE session_hash = ?").bind(newExpiresAt, sessionHash).run();
  return row.email;
}

export async function signOutEmailSession(request: Request) {
  await ensureIdentitySchema();
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return;
  await getD1().prepare("DELETE FROM auth_sessions WHERE session_hash = ?").bind(await digest(token)).run();
}

type CredentialRow = {
  email: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
};

type EmailVerificationRow = {
  email: string;
  display_name: string;
  department: string;
  note: string | null;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  token_hash: string;
  expires_at: string;
  sent_count: number;
  last_sent_at: string | null;
  bootstrap_admin: number;
  created_at: string;
};

async function sendVerificationEmail(input: { email: string; token: string; verificationUrl: string }) {
  const runtime = getRuntimeEnv();
  if (!runtime.RESEND_API_KEY || !runtime.RESEND_FROM_EMAIL) {
    throw new AuthError("이메일 인증 서비스 설정이 필요합니다.", 503, "AUTH_EMAIL_NOT_CONFIGURED");
  }
  const url = new URL(input.verificationUrl);
  url.searchParams.set("token", input.token);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtime.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "iljin-ai-works/1.0",
      "Idempotency-Key": await digest(input.token),
    },
    body: JSON.stringify({
      from: runtime.RESEND_FROM_EMAIL,
      to: [input.email],
      subject: "ILJIN AI Works 이메일 인증",
      text: `아래 링크를 열어 이메일 인증을 완료해 주세요.\n\n${url}\n\n이 링크는 15분 동안 유효합니다. 본인이 요청하지 않았다면 이 메일을 무시해 주세요.`,
      html: `<p>아래 링크를 열어 이메일 인증을 완료해 주세요.</p><p><a href="${url}">이메일 인증하기</a></p><p>이 링크는 15분 동안 유효합니다. 본인이 요청하지 않았다면 이 메일을 무시해 주세요.</p>`,
    }),
  });
  if (response.ok) return;
  if (response.status === 429) {
    throw new AuthError("인증 메일 발송 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.", 429, "AUTH_RATE_LIMITED");
  }
  throw new AuthError("인증 메일을 발송하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503, "AUTH_EMAIL_DELIVERY_FAILED");
}

function trustedForwardedIdentityAllowed(request: Request) {
  // Forwarded identity headers are not authentication by themselves. Keep the
  // default session-only and require an explicit host allowlist for a trusted
  // Sites/SIWC gateway deployment.
  const runtime = getRuntimeEnv();
  if (runtime.TRUSTED_IDENTITY_MODE !== "sites-siwc") return false;
  let hostname: string;
  try {
    hostname = new URL(request.url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const trustedHosts = new Set(
    (runtime.TRUSTED_IDENTITY_HOSTS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  return trustedHosts.has(hostname);
}

export async function registerEmailAccount(input: {
  email: string;
  password: string;
  displayName: string;
  department: string;
  note?: string;
  adminCode?: string;
  traceId: string;
}) {
  const email = normalizeEmail(input.email);
  // ADMIN_EMAILS 는 운영자가 배포 설정에 직접 적은 주소다. 최초 구축 시점에는
  // 사내 메일 계정이 아직 없을 수 있으므로 도메인 게이트를 면제한다.
  // 대신 아래에서 부트스트랩 코드를 예외 없이 요구한다 — 면제의 대가다.
  const configuredAdmin = adminEmails().has(email);
  if (!configuredAdmin) assertRegistrationEmailDomain(email);
  await ensureIdentitySchema();
  const password = input.password;
  if (password.length < 12 || password.length > 128) {
    throw new AuthError("비밀번호는 12자 이상 128자 이하로 입력해 주세요.", 400, "AUTH_INVALID_INPUT");
  }
  const displayName = input.displayName.trim().slice(0, 120);
  const department = input.department.trim().slice(0, 120);
  const note = input.note?.trim().slice(0, 1000) || null;
  if (!displayName || !department) {
    throw new AuthError("이름과 희망 부서를 입력해 주세요.", 400, "AUTH_INVALID_INPUT");
  }
  const db = getD1();
  const existingCredential = await db.prepare("SELECT email FROM auth_credentials WHERE email = ?").bind(email).first();
  if (existingCredential) {
    throw new AuthError("이미 가입된 이메일입니다. 로그인해 주세요.", 409, "AUTH_ACCOUNT_EXISTS");
  }
  const bootstrapToken = getRuntimeEnv().ADMIN_BOOTSTRAP_TOKEN || "";
  if (configuredAdmin && bootstrapToken.length < 16) {
    // 코드가 없다고 그냥 통과시키면 관리자 이메일이 도메인 게이트만 우회한 채
    // 무방비로 열린다. 서버 설정 누락은 가입 거부로 끝낸다.
    throw new AuthError(
      "관리자 계정 초기 설정 코드가 서버에 구성되지 않았습니다. 운영자에게 문의해 주세요.",
      403,
      "AUTH_BOOTSTRAP_NOT_CONFIGURED",
    );
  }
  if (configuredAdmin && !constantTimeEqual(input.adminCode || "", bootstrapToken)) {
    throw new AuthError("관리자 계정 초기 설정 코드가 필요합니다.", 403, "AUTH_BOOTSTRAP_REQUIRED");
  }
  const bootstrapAdmin = configuredAdmin;
  const salt = randomBytes(16);
  let passwordHash: string;
  try {
    passwordHash = await derivePasswordHash(password, salt);
  } catch (error) {
    throw new RegistrationSystemError("password_hash", error);
  }
  const timestamp = new Date().toISOString();
  const tenantId = getRuntimeEnv().DEFAULT_TENANT_ID || "iljin";
  const role: UserRole = bootstrapAdmin ? "admin" : "user";
  const status: UserApprovalStatus = bootstrapAdmin ? "approved" : "pending";
  try {
    await db.batch([
      db.prepare(`INSERT INTO user_profiles
        (email, tenant_id, display_name, department, groups_json, role, status,
         approval_requested_at, application_note, approved_by, approved_at, rejection_reason, created_at, updated_at)
        VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, department = excluded.department,
          role = excluded.role, status = excluded.status, approval_requested_at = excluded.approval_requested_at,
          application_note = excluded.application_note, approved_by = excluded.approved_by,
          approved_at = excluded.approved_at, rejection_reason = NULL, updated_at = excluded.updated_at`).bind(
            email, tenantId, displayName, department, role, status, timestamp, note,
            bootstrapAdmin ? "system:bootstrap" : null, bootstrapAdmin ? timestamp : null, timestamp, timestamp,
          ),
      db.prepare(`INSERT INTO auth_credentials
        (email, password_hash, password_salt, password_iterations, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(
          email, passwordHash, bytesToBase64Url(salt), PASSWORD_ITERATIONS, timestamp, timestamp,
        ),
      db.prepare(`INSERT INTO audit_logs
        (id, tenant_id, actor_email, action, resource_type, resource_id, trace_id, outcome, details_json, created_at)
        VALUES (?, ?, ?, ?, 'user_profile', ?, ?, 'success', ?, ?)`).bind(
          `aud_${crypto.randomUUID().replaceAll("-", "")}`,
          tenantId,
          email,
          bootstrapAdmin ? "access.bootstrap_admin" : "access.requested",
          email,
          input.traceId,
          JSON.stringify({ department, role, selfRegistration: true, emailVerification: "not_required" }),
          timestamp,
        ),
      db.prepare("DELETE FROM email_verification_requests WHERE email = ?").bind(email),
    ]);
  } catch (error) {
    throw new RegistrationSystemError("account_write", error);
  }
  const profile = await findProfile(email);
  if (!profile) throw new RegistrationSystemError("profile_read", new Error("Registered profile was not found."));
  return { user: toAccessIdentity(profile), token: await createSession(email) };
}

export async function verifyEmailRegistration(input: { token: string; traceId: string }) {
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(input.token)) {
    throw new AuthError("인증 링크가 올바르지 않습니다.", 400, "AUTH_EMAIL_VERIFICATION_INVALID");
  }
  await ensureIdentitySchema();
  const db = getD1();
  const tokenHash = await digest(input.token);
  const request = await db.prepare(`SELECT email, display_name, department, note, password_hash, password_salt,
    password_iterations, token_hash, expires_at, sent_count, last_sent_at, bootstrap_admin, created_at
    FROM email_verification_requests WHERE token_hash = ?`).bind(tokenHash).first<EmailVerificationRow>();
  if (!request) throw new AuthError("인증 링크가 유효하지 않거나 이미 사용되었습니다.", 400, "AUTH_EMAIL_VERIFICATION_INVALID");
  if (Date.parse(request.expires_at) <= Date.now()) {
    await db.prepare("DELETE FROM email_verification_requests WHERE email = ? AND token_hash = ?").bind(request.email, tokenHash).run();
    throw new AuthError("인증 링크가 만료되었습니다. 가입 신청에서 새 메일을 요청해 주세요.", 400, "AUTH_EMAIL_VERIFICATION_EXPIRED");
  }
  const now = new Date().toISOString();
  const tenantId = getRuntimeEnv().DEFAULT_TENANT_ID || "iljin";
  const adminApproved = request.bootstrap_admin === 1;
  const role: UserRole = adminApproved ? "admin" : "user";
  const status: UserApprovalStatus = adminApproved ? "approved" : "pending";
  try {
    await db.batch([
      db.prepare(`INSERT INTO user_profiles
        (email, tenant_id, display_name, department, groups_json, role, status,
         approval_requested_at, application_note, approved_by, approved_at, rejection_reason, created_at, updated_at)
        VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, department = excluded.department,
          role = excluded.role, status = excluded.status, approval_requested_at = excluded.approval_requested_at,
          application_note = excluded.application_note, approved_by = excluded.approved_by,
          approved_at = excluded.approved_at, rejection_reason = NULL, updated_at = excluded.updated_at`).bind(
            request.email, tenantId, request.display_name, request.department, role, status, now, request.note,
            adminApproved ? "system:bootstrap" : null, adminApproved ? now : null, now, now,
          ),
      db.prepare(`INSERT INTO auth_credentials
        (email, password_hash, password_salt, password_iterations, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(
          request.email, request.password_hash, request.password_salt, request.password_iterations, now, now,
        ),
      db.prepare(`INSERT INTO audit_logs
        (id, tenant_id, actor_email, action, resource_type, resource_id, trace_id, outcome, details_json, created_at)
        VALUES (?, ?, ?, ?, 'user_profile', ?, ?, 'success', ?, ?)`).bind(
          `aud_${crypto.randomUUID().replaceAll("-", "")}`,
          tenantId,
          request.email,
          adminApproved ? "access.bootstrap_admin" : "access.requested",
          request.email,
          input.traceId,
          JSON.stringify({ department: request.department, role, selfRegistration: true, emailVerified: true }),
          now,
        ),
      db.prepare("DELETE FROM email_verification_requests WHERE email = ? AND token_hash = ?").bind(request.email, tokenHash),
    ]);
  } catch (error) {
    throw new RegistrationSystemError("account_write", error);
  }
  const identity = await findProfile(request.email);
  if (!identity) throw new RegistrationSystemError("profile_read", new Error("Verified profile was not found."));
  return { user: toAccessIdentity(identity), token: await createSession(request.email) };
}

export async function loginEmailAccount(emailInput: string, password: string) {
  await ensureIdentitySchema();
  const email = normalizeEmail(emailInput);
  const credential = await getD1().prepare(`SELECT email, password_hash, password_salt, password_iterations
    FROM auth_credentials WHERE email = ?`).bind(email).first<CredentialRow>();
  if (!credential || !password) {
    throw new AuthError("이메일 또는 비밀번호가 올바르지 않습니다.", 401, "AUTH_INVALID_CREDENTIALS");
  }
  const candidate = await derivePasswordHash(
    password,
    base64UrlToBytes(credential.password_salt),
    credential.password_iterations,
  );
  if (!constantTimeEqual(candidate, credential.password_hash)) {
    throw new AuthError("이메일 또는 비밀번호가 올바르지 않습니다.", 401, "AUTH_INVALID_CREDENTIALS");
  }
  let row = await findProfile(email);
  if (!row) throw new AuthError("사용자 프로필을 찾을 수 없습니다.", 401, "AUTH_INVALID_CREDENTIALS");
  if (row && adminEmails().has(email) && (row.status !== "approved" || row.role !== "admin")) {
    const now = new Date().toISOString();
    await getD1().prepare(`UPDATE user_profiles SET status = 'approved', role = 'admin', approved_by = ?,
      approved_at = COALESCE(approved_at, ?), rejection_reason = NULL, updated_at = ? WHERE email = ?`)
      .bind("system:configured-admin", now, now, email).run();
    row = await findProfile(email);
  }
  if (!row) throw new AuthError("AUTH_PROFILE_MISSING", 401, "AUTH_INVALID_CREDENTIALS");
  return { user: toAccessIdentity(row), token: await createSession(email) };
}

export async function resolveAccessIdentity(request: Request): Promise<AccessIdentity> {
  const runtime = getRuntimeEnv();
  const forwardedEmail = trustedForwardedIdentityAllowed(request)
    ? request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase()
      || request.headers.get("x-forwarded-email")?.trim().toLowerCase()
    : undefined;
  const developmentEmail = localIdentityAllowed(request)
    ? request.headers.get("x-dev-user-email")?.trim().toLowerCase()
    : undefined;
  await ensureIdentitySchema();
  const sessionEmail = await resolveSessionEmail(request);
  const email = sessionEmail || forwardedEmail || developmentEmail;
  if (!email) {
    throw new AuthError("로그인한 사용자 정보를 확인할 수 없습니다.", 401, "AUTH_UNAUTHORIZED");
  }

  const usingDevelopmentIdentity = !sessionEmail && !forwardedEmail && Boolean(developmentEmail);
  const db = getD1();
  const now = new Date().toISOString();
  const requestedDevelopmentRole = usingDevelopmentIdentity ? request.headers.get("x-dev-user-role") : undefined;
  const developmentRole: UserRole = requestedDevelopmentRole === "admin" || requestedDevelopmentRole === "manager"
    ? requestedDevelopmentRole
    : "user";

  let row = await findProfile(email);
  if (row) {
    // An operator may add an existing account to ADMIN_EMAILS after it has
    // already registered as a pending user. Reconcile that explicit server-side
    // allowlist here so the account can recover without a second admin session.
    if (adminEmails().has(email) && (row.status !== "approved" || row.role !== "admin")) {
      await db.prepare(`UPDATE user_profiles SET status = 'approved', role = 'admin', approved_by = ?,
        approved_at = COALESCE(approved_at, ?), rejection_reason = NULL, updated_at = ? WHERE email = ?`)
        .bind("system:configured-admin", now, now, email).run();
      row = await findProfile(email);
    }
    if (!row) throw new Error("사용자 프로필을 불러오지 못했습니다.");
    if (usingDevelopmentIdentity && (row.status !== "approved" || row.role !== developmentRole)) {
      const role: UserRole = developmentRole;
      if (row.status !== "approved" || row.role !== role) {
        await db.prepare(`UPDATE user_profiles SET status = 'approved', role = ?, approved_by = ?,
          approved_at = COALESCE(approved_at, ?), rejection_reason = NULL, updated_at = ? WHERE email = ?`)
          .bind(role, "system:local-development", now, now, email).run();
        row = await findProfile(email);
      }
    }
    if (!row) throw new Error("사용자 프로필을 불러오지 못했습니다.");
    return toAccessIdentity(row);
  }

  if (forwardedEmail && !usingDevelopmentIdentity) {
    const displayNameHeader = request.headers.get("oai-authenticated-user-full-name");
    let displayName = forwardedEmail.split("@")[0];
    if (displayNameHeader) {
      try { displayName = decodeURIComponent(displayNameHeader); } catch { displayName = displayNameHeader; }
    }
    const tenantId = runtime.DEFAULT_TENANT_ID || "iljin";
    return {
      email: forwardedEmail,
      tenantId,
      displayName,
      department: "미지정",
      jobTitle: "미지정",
      corpId: null,
      deptId: null,
      groups: [],
      role: "user",
      status: "unrequested",
      locale: "ko-KR",
      createdAt: now,
      updatedAt: now,
    };
  }

  if (!usingDevelopmentIdentity) {
    throw new AuthError("사용자 프로필을 찾을 수 없습니다.", 401, "AUTH_UNAUTHORIZED");
  }
  const displayName = email.split("@")[0];
  const tenantId = runtime.DEFAULT_TENANT_ID || "iljin";
  const developmentDepartment = request.headers.get("x-dev-user-department")?.trim();
  const department = developmentDepartment || runtime.DEFAULT_DEPARTMENT || "미지정";
  const role: UserRole = developmentRole;
  await db.prepare(`INSERT INTO user_profiles
    (email, tenant_id, display_name, department, groups_json, role, status,
      approval_requested_at, application_note, approved_by, approved_at, rejection_reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, '[]', ?, 'approved', NULL, NULL, 'system:local-development', ?, NULL, ?, ?)`).bind(
      email,
      tenantId,
      displayName,
      department,
      role,
      now,
      now,
      now,
    ).run();
  row = await findProfile(email);
  if (!row) throw new Error("사용자 프로필을 생성하지 못했습니다.");
  return toAccessIdentity(row);
}

export async function updateOwnProfile(input: {
  request: Request;
  displayName: string;
  department: string;
  locale?: string;
  country?: string;
  language?: string;
  currentPassword?: string;
  newPassword?: string;
  traceId: string;
}) {
  const identity = await resolveAccessIdentity(input.request);
  await ensureIdentitySchema();
  const existing = await findProfile(identity.email);
  if (!existing || existing.tenant_id !== identity.tenantId) {
    throw new AuthError("사용자 프로필을 찾을 수 없습니다.", 403, "AUTH_FORBIDDEN");
  }

  const displayName = input.displayName.trim().slice(0, 120);
  const requestedDepartment = input.department.trim().slice(0, 120);
  if (requestedDepartment && requestedDepartment !== existing.department) {
    throw new AuthError("소속 부서는 관리자 또는 사내 인증 정보로만 변경할 수 있습니다.", 403, "AUTH_FORBIDDEN");
  }
  const department = existing.department;
  if (!displayName || !department) {
    throw new AuthError("이름을 입력해 주세요.", 400, "AUTH_INVALID_INPUT");
  }
  const preferences = parseProfilePreferences(existing.preferences_json);
  const currentLocale = profileLocale(preferences);
  const legacyLanguage = input.language === undefined ? currentLocale.slice(0, currentLocale.indexOf("-")) : input.language.trim().toLowerCase();
  const legacyCountry = input.country === undefined ? currentLocale.slice(currentLocale.indexOf("-") + 1) : input.country.trim().toUpperCase();
  const locale = input.locale === undefined ? normalizeProfileLocale(`${legacyLanguage}-${legacyCountry}`) : normalizeProfileLocale(input.locale);
  const [language, country] = locale.split("-");
  preferences.locale = locale;
  preferences.country = country;
  preferences.language = language;

  const currentPassword = input.currentPassword || "";
  const newPassword = input.newPassword || "";
  const changingPassword = Boolean(currentPassword || newPassword);
  if (changingPassword) {
    if (!currentPassword || !newPassword) {
      throw new AuthError("현재 비밀번호와 새 비밀번호를 모두 입력해 주세요.", 400, "AUTH_INVALID_INPUT");
    }
    if (newPassword.length < 12 || newPassword.length > 128) {
      throw new AuthError("새 비밀번호는 12자 이상 128자 이하로 입력해 주세요.", 400, "AUTH_INVALID_INPUT");
    }
    const credential = await getD1().prepare(`SELECT password_hash, password_salt, password_iterations
      FROM auth_credentials WHERE email = ?`).bind(identity.email).first<CredentialRow>();
    if (!credential) {
      throw new AuthError("현재 계정은 비밀번호 변경을 지원하지 않습니다.", 400, "AUTH_INVALID_INPUT");
    }
    const currentHash = await derivePasswordHash(
      currentPassword,
      base64UrlToBytes(credential.password_salt),
      credential.password_iterations,
    );
    if (!constantTimeEqual(currentHash, credential.password_hash)) {
      throw new AuthError("현재 비밀번호가 올바르지 않습니다.", 401, "AUTH_INVALID_CREDENTIALS");
    }
  }

  const now = new Date().toISOString();
  const db = getD1();
  const statements = [
    db.prepare(`UPDATE user_profiles SET display_name = ?, department = ?, preferences_json = ?, updated_at = ?
      WHERE email = ? AND tenant_id = ?`).bind(displayName, department, JSON.stringify(preferences), now, identity.email, identity.tenantId),
    db.prepare(`INSERT INTO audit_logs
      (id, tenant_id, actor_email, action, resource_type, resource_id, trace_id, outcome, details_json, created_at)
      VALUES (?, ?, ?, 'profile.updated', 'user_profile', ?, ?, 'success', ?, ?)`).bind(
        `aud_${crypto.randomUUID().replaceAll("-", "")}`,
        identity.tenantId,
        identity.email,
        identity.email,
        input.traceId,
        JSON.stringify({ displayName, department, locale, passwordChanged: changingPassword }),
        now,
      ),
  ];
  if (changingPassword) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const passwordHash = await derivePasswordHash(newPassword, salt);
    statements.push(
      db.prepare(`UPDATE auth_credentials SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ?
        WHERE email = ?`).bind(
          passwordHash,
          bytesToBase64Url(salt),
          PASSWORD_ITERATIONS,
          now,
          identity.email,
        ),
    );
  }
  await db.batch(statements);

  const updated = await findProfile(identity.email);
  if (!updated) throw new Error("사용자 프로필을 불러오지 못했습니다.");
  return toAccessIdentity(updated);
}

export async function resolvePrincipal(request: Request): Promise<Principal> {
  const identity = await resolveAccessIdentity(request);
  if (identity.status === "unrequested") {
    throw new AuthError("이메일 인증 후 가입 신청을 완료해 주세요.", 403, "AUTH_APPLICATION_REQUIRED");
  }
  if (identity.status === "pending") {
    throw new AuthError("관리자 승인을 기다리고 있습니다.", 403, "AUTH_APPROVAL_REQUIRED");
  }
  if (identity.status === "rejected") {
    throw new AuthError("접근 요청이 거절되었습니다. 관리자에게 문의해 주세요.", 403, "AUTH_REJECTED");
  }
  return {
    email: identity.email,
    displayName: identity.displayName,
    tenantId: identity.tenantId,
    department: identity.department,
    jobTitle: identity.jobTitle,
    corpId: identity.corpId,
    deptId: identity.deptId,
    groups: identity.groups,
    role: identity.role,
  };
}

export function requireRole(principal: Principal, allowed: UserRole[]) {
  if (!allowed.includes(principal.role)) {
    throw new AuthError("이 작업을 수행할 권한이 없습니다.", 403, "AUTH_FORBIDDEN");
  }
}

export async function listAccessRequests(principal: Principal) {
  requireRole(principal, ["admin"]);
  await ensureIdentitySchema();
  const rows = await getD1().prepare(`SELECT email, tenant_id, display_name, department, job_title, groups_json, role, status,
    approval_requested_at, application_note, approved_by, approved_at, rejection_reason, created_at, updated_at
    FROM user_profiles WHERE tenant_id = ? AND role != 'admin' AND approval_requested_at IS NOT NULL
    ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
      COALESCE(approval_requested_at, created_at) DESC LIMIT 200`).bind(principal.tenantId).all<ProfileRow>();
  return (rows.results || []).map(toAccessIdentity);
}

export async function reviewAccessRequest(input: {
  principal: Principal;
  email: string;
  decision: "approved" | "rejected";
  department?: string;
  corpId?: string | null;
  deptId?: string | null;
  role?: "user" | "manager";
  reason?: string;
  traceId: string;
}) {
  requireRole(input.principal, ["admin"]);
  await ensureIdentitySchema();
  const email = input.email.trim().toLowerCase();
  const existing = await findProfile(email);
  if (!existing || existing.tenant_id !== input.principal.tenantId) {
    throw new AuthError("승인 대상 사용자를 찾을 수 없습니다.", 403, "AUTH_FORBIDDEN");
  }
  if (existing.status === "unrequested" || !existing.approval_requested_at) {
    throw new AuthError("가입 신청이 제출되지 않은 사용자는 승인할 수 없습니다.", 403, "AUTH_FORBIDDEN");
  }
  if (adminEmails().has(email)) {
    throw new AuthError("환경 설정 관리자는 승인 상태를 변경할 수 없습니다.", 403, "AUTH_FORBIDDEN");
  }

  const now = new Date().toISOString();
  const organizationSelection = input.decision === "approved" && (input.corpId !== undefined || input.deptId !== undefined);
  let corpId = organizationSelection ? input.corpId || null : existing.corp_id;
  const deptId = organizationSelection ? input.deptId || null : existing.dept_id;
  let department = (input.department || existing.department).trim().slice(0, 120) || existing.department;
  if (organizationSelection && deptId) {
    const selectedDepartment = await getD1().prepare("SELECT corp_id, name FROM departments WHERE id = ? AND tenant_id = ? AND status = 'active'")
      .bind(deptId, input.principal.tenantId).first<{ corp_id: string; name: string }>();
    if (!selectedDepartment) throw new AuthError("선택한 부서를 찾을 수 없습니다.", 400, "AUTH_INVALID_INPUT");
    if (corpId && corpId !== selectedDepartment.corp_id) throw new AuthError("선택한 부서와 법인이 일치하지 않습니다.", 400, "AUTH_INVALID_INPUT");
    corpId = selectedDepartment.corp_id;
    department = selectedDepartment.name;
  } else if (organizationSelection && corpId) {
    const selectedCorporation = await getD1().prepare("SELECT id FROM corporations WHERE id = ? AND tenant_id = ? AND status = 'active'")
      .bind(corpId, input.principal.tenantId).first<{ id: string }>();
    if (!selectedCorporation) throw new AuthError("선택한 법인을 찾을 수 없습니다.", 400, "AUTH_INVALID_INPUT");
  }
  const role: UserRole = input.role === "manager" ? "manager" : "user";
  const reason = input.decision === "rejected" ? input.reason?.trim().slice(0, 500) || "관리자 검토 결과" : null;
  const db = getD1();
  await db.batch([
    db.prepare(`UPDATE user_profiles SET department = ?, corp_id = ?, dept_id = ?, role = ?, status = ?, approved_by = ?,
      approved_at = ?, rejection_reason = ?, updated_at = ? WHERE email = ? AND tenant_id = ?`).bind(
        department,
        corpId,
        deptId,
        role,
        input.decision,
        input.principal.email,
        now,
        reason,
        now,
        email,
        input.principal.tenantId,
      ),
    db.prepare(`INSERT INTO audit_logs
      (id, tenant_id, actor_email, action, resource_type, resource_id, trace_id, outcome, details_json, created_at)
      VALUES (?, ?, ?, ?, 'user_profile', ?, ?, 'success', ?, ?)`).bind(
        `aud_${crypto.randomUUID().replaceAll("-", "")}`,
        input.principal.tenantId,
        input.principal.email,
        input.decision === "approved" ? "access.approved" : "access.rejected",
        email,
        input.traceId,
        JSON.stringify({ department, corpId, deptId, role, reason }),
        now,
      ),
  ]);
  const updated = await findProfile(email);
  if (!updated) throw new Error("승인 결과를 불러오지 못했습니다.");
  return toAccessIdentity(updated);
}

export async function submitAccessApplication(input: {
  request: Request;
  department: string;
  note?: string;
  traceId: string;
}) {
  const identity = await resolveAccessIdentity(input.request);
  if (identity.status === "approved") return identity;
  const department = input.department.trim().slice(0, 120);
  if (!department) throw new AuthError("희망 부서를 입력해 주세요.", 403, "AUTH_FORBIDDEN");
  const note = input.note?.trim().slice(0, 1000) || null;
  const now = new Date().toISOString();
  const db = getD1();
  await db.batch([
    db.prepare(`INSERT INTO user_profiles
      (email, tenant_id, display_name, department, groups_json, role, status,
       approval_requested_at, application_note, approved_by, approved_at, rejection_reason, created_at, updated_at)
      VALUES (?, ?, ?, ?, '[]', 'user', 'pending', ?, ?, NULL, NULL, NULL, ?, ?)
      ON CONFLICT(email) DO UPDATE SET department = excluded.department,
        application_note = excluded.application_note, status = 'pending',
        approval_requested_at = excluded.approval_requested_at, approved_by = NULL,
        approved_at = NULL, rejection_reason = NULL, updated_at = excluded.updated_at`).bind(
          identity.email,
          identity.tenantId,
          identity.displayName,
          department,
          now,
          note,
          now,
          now,
        ),
    db.prepare(`INSERT INTO audit_logs
      (id, tenant_id, actor_email, action, resource_type, resource_id, trace_id, outcome, details_json, created_at)
      VALUES (?, ?, ?, 'access.requested', 'user_profile', ?, ?, 'success', ?, ?)`).bind(
        `aud_${crypto.randomUUID().replaceAll("-", "")}`,
        identity.tenantId,
        identity.email,
        identity.email,
        input.traceId,
        JSON.stringify({ department, note, reapplication: identity.status === "rejected" }),
        now,
      ),
  ]);
  const updated = await findProfile(identity.email);
  if (!updated) throw new Error("가입 신청 결과를 불러오지 못했습니다.");
  return toAccessIdentity(updated);
}

export function identityError(error: unknown, traceId: string) {
  if (!(error instanceof AuthError)) return undefined;
  return Response.json(
    { error: { code: error.code, message: error.message, trace_id: traceId } },
    { status: error.status, headers: { "Cache-Control": "no-store", "X-Trace-Id": traceId } },
  );
}
