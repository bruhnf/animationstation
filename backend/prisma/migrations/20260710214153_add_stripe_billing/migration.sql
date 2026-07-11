-- CreateEnum
CREATE TYPE "StripeProductKind" AS ENUM ('CREDITS', 'SUBSCRIPTION');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "stripeCustomerId" TEXT;

-- CreateTable
CREATE TABLE "stripe_purchases" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeCheckoutSessionId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "productKey" TEXT NOT NULL,
    "type" "StripeProductKind" NOT NULL,
    "tier" "UserTier",
    "credits" INTEGER,
    "subscriptionStatus" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stripe_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stripe_purchases_stripeCheckoutSessionId_key" ON "stripe_purchases"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "stripe_purchases_userId_idx" ON "stripe_purchases"("userId");

-- CreateIndex
CREATE INDEX "stripe_purchases_stripeSubscriptionId_idx" ON "stripe_purchases"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "users_stripeCustomerId_key" ON "users"("stripeCustomerId");

-- AddForeignKey
ALTER TABLE "stripe_purchases" ADD CONSTRAINT "stripe_purchases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

