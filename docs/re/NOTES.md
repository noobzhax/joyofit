# Huawei Health RE notes (REA setup and method)

## Versions

| Item | Value |
|---|---|
| REA | `rea-agents` 6.4.0 (`npx -y rea-agents@latest --version`), repo cloned to `/tmp/rea` |
| Node | v26.11.1 |
| JDK | `$HOME/jdk17` OpenJDK 17.0.20.1, full JDK (`javac` present, `jdk.compiler` module listed) |
| JADX engine | `jadx-headless-mcp-0.7.1-all.jar`, sha256 `6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75` (matched REA's pinned digest) |
| APK | `huawei-health.apk` sha256 `6e693fe6051b69fefa68215ce52d1f3ae4a2a7c8e25d09b034c73c20bf6f42fd` |
| procps `ps` | `/usr/bin/ps` |
| RAM | 30 GiB total, 7-12 GiB free at start; `REA_JADX_HEAP_MIB=12288` |

## Commands

```sh
git clone --depth 1 https://github.com/morluto/rea /tmp/rea          # docs/android-analysis.md, docs/cli.md, skill references
mkdir -p $HOME/.local/share/rea/android && cd $HOME/.local/share/rea/android
curl -fL -o jadx-headless-mcp-0.7.1-all.jar https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar
echo '6e5eacf5...ff75  jadx-headless-mcp-0.7.1-all.jar' | sha256sum -c -
export JAVA_HOME=$HOME/jdk17 PATH=$HOME/jdk17/bin:$PATH
export REA_JADX_MCP_JAR=$HOME/.local/share/rea/android/jadx-headless-mcp-0.7.1-all.jar REA_JADX_HEAP_MIB=12288
npx -y rea-agents@latest inspect-android-package huawei-health.apk --json > out/inspect.json   # ~60 s, OK
npx -y rea-agents@latest --mcp        # REA MCP server over stdio, driven by tools/rea.mjs (tiny JSON-RPC client)
```

`rea-agents setup` was not run, no agent config was touched.

## What worked and what did not

- `inspect_android_package`: worked (`out/inspect.json`, 38,304 top-level classes, 89,707 class defs over 48 DEX files, 14,561 resources).
- `search_android_classes`: **failed** on this APK with `unreadable_output: JADX class inventory is duplicated or differs from the loaded class count`
  (10 duplicate names, e.g. `defpackage.elementAt`, `okio.SegmentedByteString`; a REA consistency check, not a JADX failure). The error's
  `partial_observation` still carried every raw `list_classes` page, from which `out/allclasses.txt` was rebuilt.
- REA has no string search and no method-name search that survives R8 (method names are obfuscated; the useful anchors are log strings).
- Therefore I also drove the **same jadx-headless-mcp 0.7.1 JAR directly** over stdio (`tools/jx.mjs`, `tools/server.mjs`, `tools/jx.sh`) for `get_class_source`,
  `get_xrefs_to_method` etc., and wrote two small Python scripts (`tools/dexstr.py`, `tools/dexxref.py`) that read the DEX string pool and map `const-string`
  uses to `(class, method)`. Those found the diet classes from their log strings ("syncMealsToDevice", "sendDietSamplePoint", ...).
  The engine is REA's engine; this is not the "plain jadx CLI" fallback.
- REA `inspect_android_class` / `inspect_android_method` evidence for the key classes: `out/evidence/` (see DIET_PROTOCOL.md section 2 for the class names).

## Nested packages

Inside the APK: `assets/bundle_plugins/PluginHealthModel.zip` (built-in, 1 DEX, `res/raw/*`), `PluginHiAiEngine.zip` (built-in, voice/AI assets),
`bundle_17.0.8.300_1.0.0.json` (lists 20 modules; 18 are `config://` = **downloaded at runtime**, e.g. `AIService`, `PluginHealthAlgorithm`, `PluginWearAbility`,
`PluginWatchFace`, `PluginDeviceDetectDiagnosis`, `PluginAudioDevice`, `PluginPay`; they are NOT in the APK and cannot be read without root from `/data/data`),
`assets/arkui-x/arkuix/ets/modules.abc` (ArkUI-X bytecode for diet UI cards, not decompiled), 15 uuid-named zips and `arkui-x-libs-64.zip` (UI/runtime assets).
Neither built-in zip contains diet transport code; the diet-to-watch path is in the main DEX (`classes7.dex` `fbj`, `classes11.dex` `nkj`, `classes21`/`classes2` helpers).

## Layout

`src/` decompiled classes used as evidence, `dex/` unzipped DEX files, `out/` REA outputs, `tools/` scripts, `DIET_PROTOCOL.md`, `FEATURE_CANDIDATES.md`.
