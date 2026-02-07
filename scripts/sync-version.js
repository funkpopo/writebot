/**
 * Sync version from package.json to manifest.xml.
 * Usage: node scripts/sync-version.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const version = pkg.version; // e.g. "1.0.11"

// Convert semver to Office 4-part format
const parts = version.split(".").map(Number);
while (parts.length < 4) parts.push(0);
const officeVersion = parts.slice(0, 4).join(".");

const manifestPath = path.join(ROOT, "manifest.xml");
let manifest = fs.readFileSync(manifestPath, "utf8");
manifest = manifest.replace(
  /<Version>[^<]*<\/Version>/,
  `<Version>${officeVersion}</Version>`
);
fs.writeFileSync(manifestPath, manifest, "utf8");

console.log(`Synced version: ${version} -> ${officeVersion} (manifest.xml)`);
