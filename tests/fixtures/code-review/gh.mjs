#!/usr/bin/env node
/**
 * A stand-in for the GitHub CLI, for the Code Review plugin's tests: answers
 * the handful of `gh` calls the plugin makes from fixed data about one
 * repository, `acme/widgets`, and logs every write (`api -X POST`) to
 * `FAKE_GH_LOG` instead of sending it anywhere. `FAKE_GH_STATE=signed-out`
 * answers like a gh with no sign-in (exit 4).
 */
import fs from "node:fs";

const args = process.argv.slice(2);
const joined = args.join(" ");
const out = (value) => process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));

if (process.env.FAKE_GH_STATE === "signed-out") {
  process.stderr.write("To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n");
  process.exit(4);
}

const now = Date.now();
const iso = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
const repository = { name: "widgets", nameWithOwner: "acme/widgets" };
const pr = (number, title, login, minutesAgo, extra = {}) => ({
  number, title, author: { login }, updatedAt: iso(minutesAgo), url: `https://github.com/acme/widgets/pull/${number}`, isDraft: false, repository, ...extra,
});

const REVIEW = [pr(42, "Add a retry budget to the uploader", "maya", 18), pr(57, "Bump the CSV parser to 3.2", "devon", 240)];
const YOURS = [pr(61, "Docs: how widgets are versioned", "octo", 35, { isDraft: true })];
const INVOLVED = [...REVIEW, ...YOURS, pr(12, "Fix the flaky sync test on Windows", "lee", 60 * 26)];

const DIFF = `diff --git a/src/uploader.ts b/src/uploader.ts
index 1111111..2222222 100644
--- a/src/uploader.ts
+++ b/src/uploader.ts
@@ -1,9 +1,14 @@
 import { send } from "./net";

-export async function upload(file: Blob) {
-  return send(file);
+const MAX_RETRIES = 3;
+
+export async function upload(file: Blob, retries = MAX_RETRIES) {
+  for (let attempt = 0; ; attempt += 1) {
+    try { return await send(file); }
+    catch (error) { if (attempt >= retries) throw error; }
+  }
 }

 export function size(file: Blob) {
   return file.size;
 }
diff --git a/test/uploader.test.ts b/test/uploader.test.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/test/uploader.test.ts
@@ -0,0 +1,6 @@
+import { upload } from "../src/uploader";
+
+it("gives up after the retry budget", async () => {
+  await expect(upload(new Blob(["x"]), 0)).rejects.toThrow();
+});
+
`;

const PR_VIEW = {
  number: 42,
  title: "Add a retry budget to the uploader",
  body: "Uploads now retry three times before failing.",
  author: { login: "maya" },
  state: "OPEN",
  isDraft: false,
  headRefName: "maya/retry-budget",
  baseRefName: "main",
  headRefOid: "abc123def4567890",
  url: "https://github.com/acme/widgets/pull/42",
  createdAt: iso(60 * 5),
  updatedAt: iso(18),
  additions: 13,
  deletions: 2,
  changedFiles: 2,
  reviewDecision: "REVIEW_REQUIRED",
  statusCheckRollup: [
    { __typename: "CheckRun", name: "test (ubuntu)", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://ci.example/1" },
    { __typename: "CheckRun", name: "test (windows)", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://ci.example/2" },
    { __typename: "StatusContext", context: "lint", state: "PENDING", targetUrl: "https://ci.example/3" },
  ],
  files: [
    { path: "src/uploader.ts", additions: 7, deletions: 2 },
    { path: "test/uploader.test.ts", additions: 6, deletions: 0 },
  ],
};

const COMMENTS = [
  { id: 101, path: "src/uploader.ts", line: 3, original_line: 3, side: "RIGHT", body: "Should the budget come from settings?", user: { login: "devon" }, created_at: iso(15), in_reply_to_id: null, html_url: "https://github.com/acme/widgets/pull/42#discussion_r101" },
  { id: 102, path: "src/uploader.ts", line: 3, original_line: 3, side: "RIGHT", body: "Later; three is what the old client did.", user: { login: "maya" }, created_at: iso(12), in_reply_to_id: 101, html_url: "https://github.com/acme/widgets/pull/42#discussion_r102" },
];
const REVIEWS = [{ id: 201, state: "COMMENTED", body: "", user: { login: "devon" }, submitted_at: iso(15) }];

function log() {
  if (process.env.FAKE_GH_LOG) fs.appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify(args)}\n`);
}

if (args[0] === "api" && args.includes("-X")) {
  log();
  const event = args.find((arg) => arg.startsWith("event="))?.slice(6);
  out({ id: 999, html_url: "https://github.com/acme/widgets/pull/42#discussion_r999", state: event === "APPROVE" ? "APPROVED" : event === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "COMMENTED" });
} else if (joined.startsWith("api repos/acme/widgets/pulls/42/comments")) out(COMMENTS);
else if (joined.startsWith("api repos/acme/widgets/pulls/42/reviews")) out(REVIEWS);
else if (args[0] === "search" && args[1] === "prs") {
  if (args.includes("--review-requested")) out(REVIEW);
  else if (args.includes("--author")) out(YOURS);
  else out(INVOLVED);
} else if (args[0] === "repo" && args[1] === "view") out("acme/widgets\n");
else if (args[0] === "pr" && args[1] === "list") {
  const rows = INVOLVED.map(({ repository: _repository, ...rest }) => ({ ...rest, headRefName: `branch-${rest.number}`, reviewDecision: null }));
  out(args.includes("--author") ? rows.filter((row) => row.author.login === "octo") : rows);
} else if (args[0] === "pr" && args[1] === "view") {
  if (args[2] !== "42") { process.stderr.write(`GraphQL: Could not resolve to a PullRequest with the number of ${args[2]}.\n`); process.exit(1); }
  out(args.includes("--jq") ? `${PR_VIEW.headRefOid}\n` : PR_VIEW);
} else if (args[0] === "pr" && args[1] === "diff") out(DIFF);
else {
  process.stderr.write(`fake gh: no answer for: ${joined}\n`);
  process.exit(1);
}
