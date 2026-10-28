/*
  Warnings:

  - You are about to drop the column `documentId` on the `AisStatement` table. All the data in the column will be lost.
  - Added the required column `sha256` to the `AisStatement` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AisStatement" DROP COLUMN "documentId",
ADD COLUMN     "sha256" TEXT NOT NULL;
