import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const trustedRepositories = new Set([
  "actions/checkout",
  "actions/setup-node",
  "actions/setup-java",
  "actions/upload-artifact",
  "subosito/flutter-action"
]);
const usesLine = /^\s*(?:-\s*)?uses:\s*(.+?)\s*$/;
const pinnedAction = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([a-f0-9]{40})(?:\s+#.*)?$/;

export function verifyActionSource(source, filename = "workflow.yml") {
  let count = 0;
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const matched = line.match(usesLine);
    if (!matched) continue;
    const pinned = matched[1].match(pinnedAction);
    if (!pinned) {
      throw new Error(filename + ":" + (index + 1) +
        " requires a full 40-character immutable action SHA");
    }
    if (!trustedRepositories.has(pinned[1])) {
      throw new Error(filename + ":" + (index + 1) +
        " unreviewed action repository: " + pinned[1]);
    }
    count++;
  }
  return count;
}

export function verifyWorkflows(directory) {
  const filenames = fs.readdirSync(directory)
    .filter(name => /\.ya?ml$/.test(name)).sort();
  if (!filenames.length) throw new Error("No GitHub Actions workflow files found");
  let actions = 0;
  for (const name of filenames) {
    actions += verifyActionSource(fs.readFileSync(path.join(directory, name), "utf8"), name);
  }
  if (!actions) throw new Error("No GitHub Actions dependencies discovered");
  return { workflows: filenames.length, actions };
}

const invokedAs = process.argv[1] && path.resolve(process.argv[1]);
if (invokedAs === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const count = verifyWorkflows(path.join(root, ".github", "workflows"));
  process.stdout.write("Verified " + count.actions +
    " pinned GitHub Actions across " + count.workflows + " workflows\n");
}
