-- Existing organizations stay disabled. Only role permission grants are backfilled.
INSERT INTO "RolePermission" ("organizationId", "roleId", "permissionCode")
SELECT "organizationId", id, 'ai.use' FROM "Role" WHERE "isSystem" AND key IN ('OWNER', 'ADMIN')
ON CONFLICT ("roleId", "permissionCode") DO NOTHING;
INSERT INTO "RolePermission" ("organizationId", "roleId", "permissionCode")
SELECT "organizationId", id, 'ai.manage' FROM "Role" WHERE "isSystem" AND key = 'OWNER'
ON CONFLICT ("roleId", "permissionCode") DO NOTHING;

-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "AiMessageStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "AiSettings" (
    "organizationId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "disclosureVersion" VARCHAR(20) NOT NULL DEFAULT 'v1',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL DEFAULT 'New conversation',
    "nextSequence" INTEGER NOT NULL DEFAULT 0,
    "activeTurnId" UUID,
    "lockedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "clientMessageId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content" VARCHAR(12000) NOT NULL,
    "status" "AiMessageStatus" NOT NULL DEFAULT 'PENDING',
    "errorCode" VARCHAR(80),
    "requiredPermissions" TEXT[],
    "sources" JSONB NOT NULL DEFAULT '[]',
    "usage" JSONB,
    "requestId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiConversation_organizationId_userId_createdAt_id_idx" ON "AiConversation"("organizationId", "userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AiConversation_id_organizationId_key" ON "AiConversation"("id", "organizationId");

-- CreateIndex
CREATE INDEX "AiMessage_organizationId_conversationId_sequence_idx" ON "AiMessage"("organizationId", "conversationId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AiMessage_conversationId_clientMessageId_role_key" ON "AiMessage"("conversationId", "clientMessageId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "AiMessage_conversationId_sequence_key" ON "AiMessage"("conversationId", "sequence");

-- AddForeignKey
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_organizationId_fkey" FOREIGN KEY ("conversationId", "organizationId") REFERENCES "AiConversation"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
