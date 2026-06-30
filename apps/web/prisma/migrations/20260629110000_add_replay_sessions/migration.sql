-- Réunion Trading Hub — replay sessions (séances) [SEANCES J1].
-- ADD-only: 4 new enum types + 3 new tables + indexes + FKs. No ALTER/DROP on
-- any existing table, so `migrate deploy` applies it without touching the 6 real
-- members' data (RGPD/posture §2: 0 FK to User / Trade / BehavioralScore).

-- CreateEnum
CREATE TYPE "ReplaySlot" AS ENUM ('analyse', 'debrief');

-- CreateEnum
CREATE TYPE "ReplayStatus" AS ENUM ('scheduled', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "ReplayBias" AS ENUM ('haussier', 'baissier', 'neutre');

-- CreateEnum
CREATE TYPE "ReplayTranscriptSource" AS ENUM ('fathom', 'whisper', 'manual');

-- CreateTable
CREATE TABLE "replay_sessions" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "slot" "ReplaySlot" NOT NULL,
    "status" "ReplayStatus" NOT NULL DEFAULT 'scheduled',
    "title" TEXT NOT NULL,
    "time" TEXT,
    "summary" TEXT,
    "key_takeaways" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "duration" INTEGER,
    "cancel_reason" TEXT,
    "vimeo_id" TEXT,
    "vimeo_hash" TEXT,
    "vimeo_embed_url" TEXT,
    "vimeo_processing" BOOLEAN NOT NULL DEFAULT false,
    "transcript_source" "ReplayTranscriptSource",
    "transcript_lang" TEXT,
    "transcript_pending" BOOLEAN NOT NULL DEFAULT false,
    "content_generated" BOOLEAN NOT NULL DEFAULT false,
    "content_model" TEXT,
    "content_needs_review" BOOLEAN NOT NULL DEFAULT false,
    "cp_mp4" BOOLEAN NOT NULL DEFAULT false,
    "cp_vimeo" BOOLEAN NOT NULL DEFAULT false,
    "cp_transcript" BOOLEAN NOT NULL DEFAULT false,
    "cp_ai" BOOLEAN NOT NULL DEFAULT false,
    "cp_deployed" BOOLEAN NOT NULL DEFAULT false,
    "pipeline_failed_step" TEXT,
    "pipeline_failed_error" TEXT,
    "pipeline_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "replay_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replay_assets" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "bias" "ReplayBias",
    "macro" BOOLEAN NOT NULL DEFAULT false,
    "levels" JSONB,
    "reading" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "replay_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replay_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "replay_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "replay_sessions_status_date_idx" ON "replay_sessions"("status", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "replay_sessions_date_slot_key" ON "replay_sessions"("date", "slot");

-- CreateIndex
CREATE INDEX "replay_assets_session_id_position_idx" ON "replay_assets"("session_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "replay_assets_session_id_symbol_key" ON "replay_assets"("session_id", "symbol");

-- CreateIndex
CREATE INDEX "replay_messages_session_id_position_idx" ON "replay_messages"("session_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "replay_messages_session_id_asset_key" ON "replay_messages"("session_id", "asset");

-- AddForeignKey
ALTER TABLE "replay_assets" ADD CONSTRAINT "replay_assets_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "replay_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replay_messages" ADD CONSTRAINT "replay_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "replay_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
