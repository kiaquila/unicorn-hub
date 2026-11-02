import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as helpers from "../scripts/ai-review-helpers.mjs";
const head = "1234567890abcdef1234567890abcdef12345678";
const marker = { agent: "codex", sha: head, requestedAt: "2026-10-20T12:00:00Z", sourceCommentCreatedAt: "2026-10-20T12:00:00Z", sourceCommentId: 1 };
const record = body => ({ id: 2, user: { login: "chatgpt-codex-connector[bot]", type: "Bot" }, body, created_at: "2026-10-20T12:02:00Z", updated_at: "2026-10-20T12:02:00Z" });
const acceptable = comment => helpers.isAcceptableCodexSummaryComment(comment, head, marker);
const corpus = JSON.parse(readFileSync(new URL("./fixtures/native-codex-clean-replies.json", import.meta.url)));
for (const row of corpus) test(`observed native response: ${row.closing || "plain"}`, () => {
  assert.equal(acceptable(record(row.body)), true);
  for (const body of [row.body + "\nAuthentication leaks credentials.", row.body.replace("Didn't find any major issues.", "Didn't find any major issues. Authentication leaks credentials."), row.body.replace(/1234567890/g, "fffffffff0"), row.body + "\n**Reviewed commit:** `" + head + "`", row.body.replace("</details>", "Unresolved vulnerability.</details>")].filter(body => body !== row.body)) {
    assert.equal(acceptable(record(body)), false, body);
  }
  assert.equal(acceptable({ ...record(row.body), user: { login: "impostor[bot]", type: "Bot" } }), false);
});
