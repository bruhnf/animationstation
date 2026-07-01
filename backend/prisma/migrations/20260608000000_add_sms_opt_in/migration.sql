-- CreateTable
CREATE TABLE "sms_opt_ins" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "consent" BOOLEAN NOT NULL DEFAULT true,
    "consentText" TEXT,
    "source" TEXT,
    "ipAddress" TEXT,
    "optedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "optedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_opt_ins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sms_opt_ins_phoneNumber_key" ON "sms_opt_ins"("phoneNumber");
