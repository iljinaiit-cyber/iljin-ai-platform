import { beginQueuedIngest, failQueuedIngest, ingestDocument, listAssets } from "../../../../lib/rag";
import { resolvePrincipal } from "../../../../lib/identity";
import { authorizeFeature } from "../../../../lib/admin-governance";
import { analyzeMultimodalFile, isMultimodalFile, mediaSourceType, resolveUploadMimeType } from "../../../../lib/multimodal";
import { attachConversationAsset } from "../../../../lib/conversations";
import { getRuntimeEnv } from "../../../../lib/runtime-env";
import { decodeDocumentText } from "../../../../lib/document-text";
import { fail, newTraceId, ok } from "../../_shared";

async function queueDocument(input: Parameters<typeof beginQueuedIngest>[0]) {
  const queue = getRuntimeEnv().INDEX_QUEUE;
  if (!queue) return null;
  const result = await beginQueuedIngest(input);
  if (result.jobId) {
    try {
      await queue.send({ assetId: result.assetId, jobId: result.jobId, offset: "nextOffset" in result ? result.nextOffset || 0 : 0 });
    } catch (error) {
      await failQueuedIngest(result.assetId, result.jobId, error).catch(() => undefined);
      throw error;
    }
  }
  return result;
}

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "documents.manage", "documents.upload");
    const limit = Number(new URL(request.url).searchParams.get("limit"));
    return ok({ assets: await listAssets(principal, Number.isFinite(limit) && limit > 0 ? limit : undefined) }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "documents.manage", "documents.upload");
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return ok({ error: { code: "INVALID_FILE", message: "업로드할 파일이 필요합니다." } }, traceId, { status: 400 });
      }
      const originalData = await file.arrayBuffer();
      const mimeType = resolveUploadMimeType(file);
      const classification = String(form.get("classification") || "internal") as "public" | "internal" | "confidential";
      const temporaryConversationId = form.get("retention") === "temporary"
        ? String(form.get("conversation_id") || "")
        : "";
      const queued = await queueDocument({
        title: String(form.get("title") || file.name),
        mimeType,
        sourceType: mediaSourceType(mimeType),
        classification,
        departmentScope: String(form.get("department_scope") || "").split(",").map((item) => item.trim()).filter(Boolean),
        tenantId: principal.tenantId,
        ownerEmail: principal.email,
        originalData,
        deduplicate: !temporaryConversationId,
        visualSearchEnabled: form.get("visual_search") === "true",
      });
      if (queued) {
        if (temporaryConversationId) await attachConversationAsset(principal, temporaryConversationId, queued.assetId);
        return ok(queued, traceId, { status: queued.status === "indexed" ? 200 : 202 });
      }
      const multimodal = isMultimodalFile(file);
      const multimodalAnalysis = multimodal ? await analyzeMultimodalFile(file, originalData, classification) : null;
      const analysis = multimodalAnalysis || { markdown: decodeDocumentText(originalData), regions: [] };
      const result = await ingestDocument({
        title: String(form.get("title") || file.name),
        content: analysis.markdown,
        mimeType,
        sourceType: mediaSourceType(mimeType),
        classification,
        departmentScope: String(form.get("department_scope") || "").split(",").map((item) => item.trim()).filter(Boolean),
        tenantId: principal.tenantId,
        ownerEmail: principal.email,
        originalData,
        visualRegions: analysis.regions,
        visualAssets: multimodalAnalysis?.visualAssets,
        deduplicate: !temporaryConversationId,
        visualSearchEnabled: form.get("visual_search") === "true",
      });
      if (temporaryConversationId) {
        await attachConversationAsset(principal, temporaryConversationId, result.assetId);
      }
      return ok({
        ...result,
        regionCount: analysis.regions?.length || 0,
        ...(multimodalAnalysis ? { multimodal: { modality: multimodalAnalysis.modality, parser: multimodalAnalysis.parser } } : {}),
      }, traceId, { status: 201 });
    }
    const body = await request.json() as {
      title?: string; content?: string; mimeType?: string; sourceType?: string;
      classification?: "public" | "internal" | "confidential";
      departmentScope?: string[]; deduplicate?: boolean;
      visualSearchEnabled?: boolean;
    };
    const originalData = new TextEncoder().encode(body.content ?? "").buffer as ArrayBuffer;
    const queued = await queueDocument({
      title: body.title ?? "",
      mimeType: body.mimeType || "text/plain",
      sourceType: body.sourceType,
      classification: body.classification,
      departmentScope: body.departmentScope,
      deduplicate: body.deduplicate,
      tenantId: principal.tenantId,
      ownerEmail: principal.email,
      originalData,
      visualSearchEnabled: body.visualSearchEnabled,
    });
    if (queued) return ok(queued, traceId, { status: queued.status === "indexed" ? 200 : 202 });
    // 필드를 명시적으로 옮긴다. 스프레드로 통과시키면 클라이언트가 tenantId·
    // ownerEmail 같은 서버 결정 항목을 덮어쓸 수 있다.
    return ok(await ingestDocument({
      title: body.title ?? "",
      content: body.content ?? "",
      mimeType: body.mimeType,
      sourceType: body.sourceType,
      classification: body.classification,
      departmentScope: body.departmentScope,
      deduplicate: body.deduplicate,
      tenantId: principal.tenantId,
      ownerEmail: principal.email,
      visualSearchEnabled: body.visualSearchEnabled,
    }), traceId, { status: 201 });
  } catch (error) { return fail(error, traceId); }
}
