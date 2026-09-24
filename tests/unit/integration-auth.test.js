"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { authorizeIntegration } = require("../../scripts/security/integration-auth.js");

test("連携トークンと権限の両方が一致した場合だけ許可する", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-auth-"));
  const config = path.join(directory, "integrations.json");
  fs.writeFileSync(config, JSON.stringify({ clients: [{ id: "logger", token: "test-secret-token", permissions: ["activity:write"] }] }));
  try {
    assert.equal(authorizeIntegration({ headers: { authorization: "Bearer wrong" } }, config, "activity:write"), null);
    assert.equal(authorizeIntegration({ headers: { authorization: "Bearer test-secret-token" } }, config, "files:write"), null);
    assert.equal(authorizeIntegration({ headers: { authorization: "Bearer test-secret-token" } }, config, "activity:write").id, "logger");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
