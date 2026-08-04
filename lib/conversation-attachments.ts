import type { Principal } from "./identity";
import {
  detachConversationAssets,
  listConversationAttachments,
  type ConversationAttachment,
} from "./conversations";
import { deleteAsset, RagError } from "./rag";

export async function cleanupConversationAttachments(
  principal: Principal,
  conversationId: string,
): Promise<ConversationAttachment[]> {
  const attachments = await listConversationAttachments(principal, conversationId);
  const deletedAssetIds: string[] = [];

  for (const attachment of attachments) {
    try {
      await deleteAsset(principal, attachment.asset_id);
    } catch (error) {
      if (!(error instanceof RagError) || error.code !== "ASSET_NOT_FOUND") throw error;
    }
    deletedAssetIds.push(attachment.asset_id);
  }

  await detachConversationAssets(conversationId, deletedAssetIds);
  return attachments;
}
