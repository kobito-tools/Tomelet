"use strict";

const { timingSafeEqual } = require("node:crypto");
const { readJsonIfPresent } = require("../settings.js");

function sameSecret(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function authorizeIntegration(request, integrationsPath, permission) {
  const header = String(request.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const config = readJsonIfPresent(integrationsPath);
  const clients = Array.isArray(config?.clients) ? config.clients : [];
  const client = clients.find((item) => sameSecret(item.token, token));
  if (!client || !Array.isArray(client.permissions) || !client.permissions.includes(permission)) return null;
  return { id: client.id, name: client.name || client.id };
}

module.exports = { authorizeIntegration };
