CREATE TYPE "CredentialRequirement" AS ENUM ('BOTH', 'EMAIL_ONLY');

ALTER TABLE "Product"
ADD COLUMN "credentialReq" "CredentialRequirement" NOT NULL DEFAULT 'BOTH';
