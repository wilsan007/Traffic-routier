-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD_ONLINE', 'COUNTER_CARD', 'CASH', 'TRANSFER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('COMPLETED', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TollTxStatus" AS ENUM ('PENDING', 'PAID', 'INVOICED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.



-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.



-- AlterTable
ALTER TABLE "Camera" ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "recordingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Infraction" ADD COLUMN     "amountDue" DOUBLE PRECISION,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "notifiedAt" TIMESTAMP(3),
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "typeId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "validatedAt" TIMESTAMP(3),
ADD COLUMN     "validatedById" TEXT,
ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "expoPushToken" TEXT;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "fleetId" TEXT;

-- CreateTable
CREATE TABLE "AgentLocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "heading" DOUBLE PRECISION,
    "onDuty" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT,
    "content" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fleet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fleet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TollZone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "radiusMeters" DOUBLE PRECISION NOT NULL DEFAULT 300,
    "cameraId" TEXT,
    "pricePerPassage" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TollZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TollTransaction" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "captureId" TEXT,
    "vehicleId" TEXT,
    "plateNumber" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "TollTxStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TollTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfractionType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "baseAmount" DOUBLE PRECISION NOT NULL,
    "reducedAmount" DOUBLE PRECISION,
    "increasedAmount" DOUBLE PRECISION,
    "points" INTEGER NOT NULL DEFAULT 0,
    "reducedDays" INTEGER NOT NULL DEFAULT 15,
    "dueDays" INTEGER NOT NULL DEFAULT 45,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InfractionType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "infractionId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "receiptNumber" TEXT NOT NULL,
    "payerName" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "infractionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "contactEmail" TEXT,
    "attachmentUrls" JSONB,
    "status" "DisputeStatus" NOT NULL DEFAULT 'PENDING',
    "decision" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "infractionId" TEXT,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentLocation_userId_key" ON "AgentLocation"("userId");

-- CreateIndex
CREATE INDEX "Message_toId_createdAt_idx" ON "Message"("toId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_name_key" ON "Fleet"("name");

-- CreateIndex
CREATE INDEX "TollTransaction_zoneId_createdAt_idx" ON "TollTransaction"("zoneId", "createdAt");

-- CreateIndex
CREATE INDEX "TollTransaction_plateNumber_idx" ON "TollTransaction"("plateNumber");

-- CreateIndex
CREATE INDEX "TollTransaction_status_idx" ON "TollTransaction"("status");

-- CreateIndex
CREATE UNIQUE INDEX "InfractionType_code_key" ON "InfractionType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNumber_key" ON "Payment"("receiptNumber");

-- CreateIndex
CREATE INDEX "Payment_infractionId_idx" ON "Payment"("infractionId");

-- CreateIndex
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_infractionId_key" ON "Dispute"("infractionId");

-- CreateIndex
CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");

-- CreateIndex
CREATE INDEX "NotificationLog_infractionId_idx" ON "NotificationLog"("infractionId");

-- CreateIndex
CREATE UNIQUE INDEX "Infraction_reference_key" ON "Infraction"("reference");

-- CreateIndex
CREATE INDEX "Infraction_status_idx" ON "Infraction"("status");

-- CreateIndex
CREATE INDEX "Vehicle_fleetId_idx" ON "Vehicle"("fleetId");

-- AddForeignKey
ALTER TABLE "AgentLocation" ADD CONSTRAINT "AgentLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_toId_fkey" FOREIGN KEY ("toId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TollZone" ADD CONSTRAINT "TollZone_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TollTransaction" ADD CONSTRAINT "TollTransaction_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "TollZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TollTransaction" ADD CONSTRAINT "TollTransaction_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Infraction" ADD CONSTRAINT "Infraction_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "InfractionType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Infraction" ADD CONSTRAINT "Infraction_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_infractionId_fkey" FOREIGN KEY ("infractionId") REFERENCES "Infraction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_infractionId_fkey" FOREIGN KEY ("infractionId") REFERENCES "Infraction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_infractionId_fkey" FOREIGN KEY ("infractionId") REFERENCES "Infraction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

