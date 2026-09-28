"use strict";

const { existsSync, rmSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildMacApp, projectRoot } = require("./macos-app-bundle.js");

// バンドルIDは旧名のまま据え置く。PopNote!はこのIDで本体を探すため、変えると連携が切れる。
console.log(buildMacApp({ bundleName: "Tomelet.app", executableName: "Tomelet", bundleIdentifier: "local.ticktocktome.desktop", displayName: "Tomelet", sourceName: "TickTockTomeApp.swift", iconName: "app-icon.icns" }));

// 旧名（Tick Tock Tome）の.appが残っているとSpotlightに2つ並ぶため、登録を外して消す。
const legacyAppPath = path.join(projectRoot, "TickTockTome.app");
if (existsSync(legacyAppPath)) {
  const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  if (existsSync(lsregister)) spawnSync(lsregister, ["-u", legacyAppPath], { stdio: "ignore", shell: false });
  rmSync(legacyAppPath, { recursive: true, force: true });
}
