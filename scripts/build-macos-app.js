"use strict";

const { buildMacApp } = require("./macos-app-bundle.js");

console.log(buildMacApp({ bundleName: "TickTockTome.app", executableName: "TickTockTome", bundleIdentifier: "local.ticktocktome.desktop", displayName: "Tick Tock Tome", sourceName: "TickTockTomeApp.swift", iconName: "app-icon.icns" }));
