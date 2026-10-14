# Fixture sources

All fixtures are third-party `.hwt` packages downloaded from public GitHub repositories for format research and codec
tests. None was made by this project. Hashes are the commits that were cloned on 2026-10-14.

| Folder | Files | Source | Licence / permission |
|---|---|---|---|
| `fit4pro/` | `AppleUltraRed`, `AppleUltraRedNext`, `AppleUltraRedNext2`, `FunctionalForHikes`, `FunctionalForHikes2`, `NikeCombo`, `NikeComboLessAOD`, `NikeComboSteps`, `SpaceRed`, `SpaceRed2` (`.hwt`) | https://github.com/anrinion/huawei-watchfaces, folder `fit_3_4_4pro/<Name>/` (commit `2a54e266ada95a506bca7a5e5187a9f5171a6958`). Renamed from `<Name>.fit4_pro.<version>.hwt`. The README says "Tested on Huawei Watch Fit 4 Pro", "Created with Facemaker" (a third-party editor, not Theme Studio Pro). | No licence file; README: "Feel free to modify and distribute." Brand-styled designs (Apple/Nike look-alikes): keep for tests only. |
| `other/` | `FocusWGTru.gt6_46_pro.hwt` (HWHD09, from `gt6_46_pro/FocusWGTru/`), `Gt6Nike.gt6_41.hwt` (HWHD09, `gt6_41/Gt6Nike/`), `Nike9.band9.hwt` (HWHD07, `band9_10/Nike9/`) | same repository and commit | same |
| `other/` | `Unnamed.hwhd02.hwt` (HWHD02, 454 x 454, version 1 layout) | https://github.com/jgreffe/HuaweiWatchfaceExtractor, `src/test/resources/Unnamed.hwt` (commit `9b29c4610e705fa4a0b247561beb3d0f5e589eec`); a test resource of the extractor | repository is GPL-3.0 |
| `unlicensed/` | `Carrera.hwt`, `SimpleItalic.hwt` (HWHD02, version 1 layout) | https://github.com/Silenttttttt/hwt-gt2e, `templates/` (commit `cd72dd9092853d0c1970f50b8f70083a76114e99`), "community faces, no ROM assets" per its README | no licence file |
| `unlicensed/` | `Hublot-V200_V4.gt3.hwt`, `Hublot-AOD-EN_V202_FIX.gt3.hwt` (HWHD09; **nested zip** `com.huawei.watchface`, with `ability.xml` and `hashCode`) | https://github.com/leeorichi/huawei-watch-face-maker, `release/` (commit `73867545cdace59141c89676cb7fb91d3dd30475`) | no licence file |

`unlicensed/` holds the files whose licence is not stated. They are kept because they are the only samples of the
version 1 layout with hand/text elements, of the nested-zip container, and of the zip-with-`hashCode` variant; delete
the folder before publishing this package outside the project (tests that need them look them up by name and the rest
sweep whatever `fixtures/**/*.hwt` exists, except the assertions that name these files).

Other repositories consulted (nothing copied from them):

- https://github.com/BlackHatDevX/Huawei-Watchface-Extractor-Python — image decoder, confirms BGRA + RLE.
- https://github.com/zhy8388608/Huawei_Watchface_Unpacker (wzsx150, Coolapk) — compiled protobuf descriptors of the
  Theme Studio v11 layout model (`src/schema-v2.ts` is transcribed from them) and the RGB565/555/888 image magics.
- https://developer.huawei.com/consumer/en/doc/content/value-type-pro-0000001583966586 (Data Types),
  `.../constraints-pro-0000001633566545` (Verifications: size limits), `.../resolution-version-0000001252603441`
  (Resolutions and Version Numbers), `.../408-capability-0000001933842793` (408 x 480 capability set),
  `.../watch-face-production-pro-0000001583647406` (preview images).

No `.hwt` exported by Huawei's own Theme Studio Pro for 408 x 480 was found publicly.
