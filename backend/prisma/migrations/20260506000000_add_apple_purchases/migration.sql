-- CreateTable
CREATE TABLE "apple_purchases" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "originalTransactionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tier" "UserTier" NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "rawReceipt" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "apple_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "apple_purchases_transactionId_key" ON "apple_purchases"("transactionId");

-- CreateIndex
CREATE INDEX "apple_purchases_userId_idx" ON "apple_purchases"("userId");

-- CreateIndex
CREATE INDEX "apple_purchases_originalTransactionId_idx" ON "apple_purchases"("originalTransactionId");

-- AddForeignKey
ALTER TABLE "apple_purchases" ADD CONSTRAINT "apple_purchases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
