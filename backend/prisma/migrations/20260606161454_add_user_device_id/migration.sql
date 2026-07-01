-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deviceId" TEXT;

-- CreateIndex
CREATE INDEX "users_deviceId_idx" ON "users"("deviceId");
