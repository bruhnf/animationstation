-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'COMMENT_REPLY';
ALTER TYPE "NotificationType" ADD VALUE 'COMMENT_LIKE';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "commentId" TEXT;

-- AddForeignKey: SetNull on delete so deleting a comment doesn't wipe the
-- notification history; the inbox row simply loses its deep-link target.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
