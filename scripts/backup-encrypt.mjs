import { encryptVerifiedBundle } from "../apps/server/src/backup-encrypted.mjs";

const fields = new Map();
try {
  const args = process.argv.slice(2);
  if (args.length !== 6) throw new Error("Expected three argument pairs");
  for (let i=0;i<args.length;i+=2) {
    const key = args[i];
    if (!["--bundle","--destination","--recipient"].includes(key) ||
        fields.has(key) || !args[i+1]) {
      throw new Error("Unknown, repeated or missing argument");
    }
    fields.set(key,args[i+1]);
  }
  if (fields.size !== 3) throw new Error("Missing required argument");
  const result = await encryptVerifiedBundle({
    bundleDirectory:fields.get("--bundle"),
    destinationFile:fields.get("--destination"),
    recipient:fields.get("--recipient"),
    ageExecutable: process.env.TEAMS_AGE_BINARY || "/usr/bin/age"
  });
  console.log("Verified bundle encrypted to a new private age v1 archive:",
    result.encryptedBytes + " ciphertext bytes,",
    result.attachmentCount + " referenced attachments");
} catch {
  // No user-supplied paths, public-key strings or tool stderr in failure logs.
  console.error("Encrypted backup failed. Check private bundle integrity, age tooling, recipient and unused private destination.");
  process.exitCode=1;
}
