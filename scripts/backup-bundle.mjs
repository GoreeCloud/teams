import { backupWithAttachments, verifyAttachmentBundle } from "../apps/server/src/backup-bundle.mjs";

function options(args) {
  if (args.length < 2 || args.length % 2 !== 0) {
    throw new Error("Usage: node scripts/backup-bundle.mjs --source /private/teams.sqlite --attachments /private/blobs --destination /private/backup-bundle");
  }
  const fields = new Map();
  for (let i=0;i<args.length;i+=2) {
    const name = args[i], value=args[i+1];
    if (!["--source","--attachments","--destination"].includes(name) ||
        !value || fields.has(name)) {
      throw new Error("Invalid or duplicate bundle argument: "+name);
    }
    fields.set(name,value);
  }
  if (fields.size !== 3) throw new Error("Provide source database, private attachments directory, and unused destination directory");
  return {
    sourceFile: fields.get("--source"),
    attachmentDirectory: fields.get("--attachments"),
    destinationDirectory: fields.get("--destination")
  };
}

try {
  const args=process.argv.slice(2);
  if (args[0] === "--verify" && args.length === 2) {
    const result=await verifyAttachmentBundle({bundleDirectory:args[1]});
    console.log("Verified private backup bundle:", result.directory,
      result.attachmentCount + " attachment files,", result.attachmentBytes + " attachment bytes");
  } else {
    const result=await backupWithAttachments(options(args));
    console.log("Verified private backup bundle:", result.directory,
      result.attachmentCount + " attachment files,", result.attachmentBytes + " attachment bytes");
  }
} catch (error) {
  console.error("Private attachment bundle failed:",
    error instanceof Error ? error.message : "Unknown backup error");
  process.exitCode=1;
}
