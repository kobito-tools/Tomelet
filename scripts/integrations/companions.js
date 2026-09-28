"use strict";

// Tomeletと連携する、別リポジトリで公開している手元のアプリ。
// 連携用トークンは他アプリと同じくconfig/integrations.jsonへ保存し、権限はここで固定する。
const { randomBytes } = require("node:crypto");
const { readJsonIfPresent, writeJsonAtomic } = require("../settings.js");

const companions = Object.freeze({
  popnote: Object.freeze({
    id: "popnote",
    name: "PopNote!",
    permissions: Object.freeze(["memo:read", "memo:write"]),
    bundleIdentifier: "io.github.kobito-tools.popnote",
    urlScheme: "popnote",
  }),
});

function companionClient(integrationsPath, companionId) {
  const clients = readJsonIfPresent(integrationsPath)?.clients;
  return Array.isArray(clients) ? clients.find((client) => client?.id === companionId) || null : null;
}

// 未登録なら専用トークンを発行し、登録済みなら権限だけを最新に合わせる。既存トークンは変えない。
function registerCompanion(integrationsPath, companionId) {
  const companion = companions[companionId];
  if (!companion) throw new Error(`未対応の連携アプリです: ${companionId}`);
  const config = readJsonIfPresent(integrationsPath) || { schemaVersion: 1, clients: [] };
  const clients = Array.isArray(config.clients) ? config.clients : [];
  let client = clients.find((item) => item?.id === companion.id);
  const permissions = [...companion.permissions];
  if (!client) {
    client = { id: companion.id, name: companion.name, token: randomBytes(32).toString("hex"), permissions };
    clients.push(client);
  } else if (client.permissions?.join(",") === permissions.join(",") && client.name === companion.name) {
    return client;
  } else Object.assign(client, { name: companion.name, permissions });
  writeJsonAtomic(integrationsPath, { ...config, schemaVersion: config.schemaVersion || 1, clients });
  return client;
}

module.exports = { companions, companionClient, registerCompanion };
