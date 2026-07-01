-- CreateTable
CREATE TABLE "saved_looks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_looks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_looks_userId_createdAt_idx" ON "saved_looks"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "saved_looks_jobId_idx" ON "saved_looks"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_looks_userId_jobId_key" ON "saved_looks"("userId", "jobId");

-- AddForeignKey
ALTER TABLE "saved_looks" ADD CONSTRAINT "saved_looks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_looks" ADD CONSTRAINT "saved_looks_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "tryon_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
