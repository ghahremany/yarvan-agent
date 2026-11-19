// Build only Yarvan's x64 Windows/Linux installer, not the upstream publication recipe.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import builder from "electron-builder";
import { verifyBrowserBundle } from "../../scripts/prepare-browser.mjs";
import { pinnedDuckdbVersion, pinnedOnePasswordVersion, pinnedResvgVersion, verifyDuckdbTree } from "../../scripts/prepare-duckdb.mjs";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(root);
const { version } = JSON.parse(readFileSync("packaging/version.json", "utf8"));
assert.match(version, /^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/);
assert.equal(process.arch, "x64", "Desktop installers currently target x64.");
assert(["win32", "linux"].includes(process.platform), "Build on Windows or Linux.");
assert(!existsSync("enterprise") && !existsSync("dist-server/enterprise"), "An OSS installer must not include Enterprise code.");
const platformTarget = `${process.platform}-${process.arch}`;
const browserDir = `dist-native/browser/${platformTarget}`;
const duckdbDir = `dist-native/duckdb/${platformTarget}/node_modules`;
const electronVersion = require("electron/package.json").version;
const cli = fileURLToPath(new URL("../../node_modules/vite/bin/vite.js", import.meta.url));
const tsc = fileURLToPath(new URL("../../node_modules/typescript/bin/tsc", import.meta.url));
const output = join(root, "release", "yarvan");
const { Platform, Arch } = builder;

function node(args, env = {}) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", env: { ...process.env, ...env }, windowsHide: true });
  if (result.status !== 0) throw new Error(`${args[0]} failed: ${result.error?.message ?? result.signal ?? result.status}`);
}

// Rebuild from the checked-out source. No native binaries are fetched from an unpinned CUA release.
node([cli, "build", "--logLevel", "warn"], { YARVAN_PACKAGE_VERSION: version });
node(["scripts/bundle-server.mjs"]);
node([tsc, "-p", "tsconfig.companion.build.json"]);
node(["scripts/mark-module-scope.mjs", "dist-companion"]);
node(["scripts/prepare-browser.mjs", "--current"]);
node(["scripts/prepare-duckdb.mjs"]);
assert(!existsSync("dist-server/enterprise"));

// Electron's application has no production npm dependency tree: local resources and bundles are explicit.
mkdirSync(join(root, "release"), { recursive: true });
const app = mkdtempSync(join(root, "release", ".yarvan-app-"));
try {
  cpSync("electron", join(app, "electron"), { recursive: true, filter(source) {
    return !/\.test\.|\.node-test\.|\.electron\.test\.|speech-helper|recorder-helper|[/\\]OpenMausBot (Speech|Recorder)\.app/.test(source);
  } });
  cpSync("public/app-icon-512.png", join(app, "electron", "resources", "yarvan-icon.png"));
  cpSync("src/locales", join(app, "src", "locales"), { recursive: true, filter: (source) => basename(source) !== "source-hashes.json" });
  writeFileSync(join(app, "package.json"), JSON.stringify({
    name: "yarvan", productName: "Yarvan", version, type: "module", main: "electron/main.mjs",
    description: "A local-first team of AI agents with scoped memory.", license: "Apache-2.0",
    author: { name: "Yarvan contributors", email: "ghahremany@users.noreply.github.com" },
    homepage: "https://ghahremany.github.io/yarvan-agent/",
  }));
  const config = {
    appId: "io.github.ghahremany.yarvan", productName: "Yarvan", electronVersion,
    directories: { app, output },
    asar: true, npmRebuild: false, publish: null,
    files: ["electron/**", "src/locales/*.json", "package.json"],
    extraResources: [
      { from: "dist", to: "ui" },
      { from: "dist-server", to: "server" },
      { from: "dist-companion", to: "companion" },
      { from: "skills", to: "skills" },
      { from: browserDir, to: "browser-engine" },
      { from: duckdbDir, to: "duckdb/node_modules" },
      { from: "LICENSE", to: "licenses/LICENSE.txt" },
      { from: "NOTICE", to: "licenses/NOTICE.txt" },
      { from: "UPSTREAM.md", to: "licenses/UPSTREAM.md" },
      { from: "third_party", to: "licenses/third_party" },
    ],
    afterPack: async ({ appOutDir }) => {
      const resources = join(appOutDir, "resources");
      assert(!existsSync(join(resources, "server", "enterprise")) && !existsSync(join(resources, "app-update.yml")));
      assert(existsSync(join(resources, "ui", "index.html")) && existsSync(join(resources, "server", "desktop-entry.mjs")));
      await verifyBrowserBundle(join(resources, "browser-engine"), platformTarget);
      await verifyDuckdbTree(join(resources, "duckdb"), process.platform, "x64",
        pinnedDuckdbVersion(root), pinnedResvgVersion(root), pinnedOnePasswordVersion(root));
    },
    win: { icon: "public/app-icon-512.png" },
    nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, runAfterFinish: false,
      shortcutName: "Yarvan", artifactName: "Yarvan-${version}-windows-x64-setup.${ext}" },
    linux: { icon: "public/app-icon-512.png", executableName: "yarvan", category: "Utility", vendor: "Yarvan contributors",
      maintainer: "Yarvan contributors <ghahremany@users.noreply.github.com>", syncDesktopName: true,
      desktop: { entry: { Name: "Yarvan", Comment: "Your AI team on your machine", Keywords: "AI;Agents;Chat;" } },
      extraResources: [{ from: "packaging/desktop/yarvan-browser.apparmor", to: "yarvan-browser.apparmor" }],
    },
    appImage: { artifactName: "Yarvan-${version}-linux-x86_64.${ext}" },
    deb: { artifactName: "Yarvan-${version}-linux-amd64.${ext}", packageCategory: "utils", priority: "optional",
      fpm: ["--depends", "apparmor"], afterInstall: "packaging/desktop/after-install.sh", afterRemove: "packaging/desktop/after-remove.sh" },
    toolsets: { appimage: "1.0.3" },
  };
  const platform = process.platform === "win32" ? Platform.WINDOWS : Platform.LINUX;
  const targets = platform.createTarget(process.platform === "win32" ? ["nsis"] : ["deb", "AppImage"], Arch.x64);
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  for (const key of ["CSC_LINK", "CSC_KEY_PASSWORD", "WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD", "GH_TOKEN", "GITHUB_TOKEN"]) delete process.env[key];
  // Use an isolated project so app-builder cannot merge the legacy upstream YAML
  // (including its protocol and publisher) from the source repo.
  for (const resource of [...config.extraResources, ...config.linux.extraResources]) resource.from = join(root, resource.from);
  config.win.icon = join(root, config.win.icon);
  config.linux.icon = join(root, config.linux.icon);
  config.deb.afterInstall = join(root, config.deb.afterInstall);
  config.deb.afterRemove = join(root, config.deb.afterRemove);
  await builder.build({ targets, config, publish: "never", projectDir: app });
} finally {
  rmSync(app, { recursive: true, force: true });
}
