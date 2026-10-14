# Huawei Health 17.0.8.300: calorie intake / diet data to the watch

Status: **static analysis only, UNVERIFIED on the wire.** Nothing here was captured from a real watch. Confidence labels:
**[H]** read directly in decompiled code, **[M]** inferred from code but one hop unseen, **[L]** guess.

APK: `huawei-health.apk`, sha256 `6e693fe6051b69fefa68215ce52d1f3ae4a2a7c8e25d09b034c73c20bf6f42fd`, v17.0.8.300.
Class names are R8-obfuscated (`defpackage.fbj` etc.); the names below are the obfuscated ones plus the log tags the code itself prints.

## 1. Answer in one paragraph

The calorie-management / "weight management" screen on the watch (watch-side app id `hw.sport.dietcal`) is fed through the
**DataSync service `0x37`**, the same service JoyoFit already uses for find-my-watch. No P2P, no file transfer, no new service.
Huawei Health calls these "Sample" commands: `0x37/01` SampleConfig, `0x37/02` SampleEvent, `0x37/03` SamplePoint,
`0x37/04` DictionaryPointInfo, `0x37/05` CompactDataDictionary. The per-meal calories are a **SamplePoint (`0x37/03`)**
with dictionary type `600002` (`DIET_RECORD_SET`), whose single value is a **UTF-8 JSON array** of meals
(`whichMeal`, `eatTime`, `kiloCalorie`, `hasFood`, `sugRange`) [H]. The goal / deficit / per-meal budget is a **SampleConfig (`0x37/01`)**
with config id `900300023` whose data is a UTF-8 JSON object (`caloricDeficitGoal`, `activityCalGoal`, `onePointFull`, ...) [H].
The phone **pushes** when a meal is logged and when config changes, and **also answers** when the watch asks via a SampleEvent
(`eventId 80030003`, JSON `{"event":1,...}`) [H]. The watch's own burned-calorie / balance figures are not sent back as far
as the code shows; the watch computes the balance itself from the goal, its own activity and the resting metabolism the phone
sends as a dictionary point (`500018`) when asked [M].

## 2. Evidence trail (class / method / short snippet)

All from `jadx-headless-mcp 0.7.1` (REA's engine) decompilation. Source dumps are in `/home/dzul/re/huawei-health/src/`.

### 2.1 Meal data model and send call: `defpackage.fbj` (log tag `DietRecordHelper`, release tag `R_DietRecordHelper`)

```java
public static boolean c(long j, long j2, DeviceInfo deviceInfo, List<wld> list, int i) {   // sendDietSamplePoint
    egf egfVar = new egf();                       // SamplePoint
    egfVar.setSrcPkgName("hw.unitedevice.weightMgr");
    egfVar.setWearPkgName("hw.sport.dietcal");
    egfVar.setCommandId(3);
    egfVar.e(DicDataTypeUtil.DataType.DIET_RECORD_SET.value());      // 600002
    egfVar.b(j); egfVar.a(j2);                                       // start / end
    ege egeVar = new ege();
    egeVar.d(DicDataTypeUtil.DataType.DIET_RECORD_SET.value());      // key 600002
    egeVar.c(ego.a(ego.c(HiJsonUtil.c(a(list, i, deviceInfo)))));    // gson(wkr[]) -> utf8 hex -> bytes
    ...
    HashMap map = new HashMap(); map.put("dietaryAnalysis", egyVarD);   // optional macros
    egfVar.e(ego.a(ego.c(HiJsonUtil.c(map))));                          // metadata bytes (tag 10)
    return eeu.c().sendSamplePointCommand(deviceInfo, egfVar, "DietRecordHelper");
}
```

- `DicDataTypeUtil.DataType.DIET_RECORD_SET(600002)`, `RESTING_METABOLISM_SET(500018)`, `WEIGHT_BODYFAT_BROAD(10006)` [H] (`DicDataTypeUtil` enum).
- `ego.c(String)` = string to upper-case hex of its UTF-8 bytes, `ego.a(String)` = hex to bytes, so the wire value is the plain UTF-8 JSON bytes [H].
- Meal element class `defpackage.wkr` (Gson, declaration order): `eatTime` (long, **seconds**), `hasFood` (bool), `kiloCalorie` (float, kcal),
  `sugRange` (int[2], recommended kcal min,max for that meal), `whichMeal` (int) [H].
- `whichMeal`: `10` breakfast, `20` lunch, `30` dinner, `40` snack/other. `11`/`21`/`31` are "extra meal" slots (added breakfast/lunch/dinner).
  They are only sent when ExpandCapability bit **215** is set; otherwise `fbj.e(int)` folds `11/21/31` to `40` [H].
- Phone adds placeholder meals (`hasFood=false`, `kiloCalorie=0`, `eatTime = start of today (s)`, `sugRange` = recommended range) for
  any of 10/20/30 (and 40 if bit 215 is clear) that has no record today (`fbj.e(wld,...)`, log `addDefaultDeviceSyncMeal`). The list is capped at **42** entries
  (`if (size > 42) return`) [H].
- When several records of type 40 exist and have food, they are summed into one entry `whichMeal=40`, `hasFood=true`, `sugRange=[0, sum of each meal's sugRange[1]]` (`fbj.d(...)`) [H].
- `sugRange` = `round(goalCalories * ratio)` pairs, goal = `wko.c()` (day goal kcal); ratios come from cloud config `diet.recommendRange.{lose|gain|maintain}.{10|20|30|40}`
  or a hard-coded table `f35288a` (`"cn_0_0_10" -> (0.24, 0.35)`, ...; region `cn`/`de`/`it`; `fbj.a(List,float,int,int,Map)`) [H].
- Optional metadata (`egy`, JSON `{"dietaryAnalysis":{"coefficient":1,"carbohydrates":g,"protein":g,"fat":g,"carbohydratesSugRange":[a,b],"proteinSugRange":[a,b],"fatSugRange":[a,b]}}`):
  grams are the sum from the food DB (`wnb.d(...)`); the ranges only come from a cloud call for VIP users (`wnb.c(... UserMemberInfo ...)`) [H]. Safe to omit.

### 2.2 Transport: `defpackage.ynw` (SampleCommandManager) and `defpackage.yoq` (ConvertCommandUtil)

```java
// ynw.d(DeviceInfo, egf, String)
if (!cqg.a(deviceInfo, 85)) { LogUtil.a("SampleCommandManager", "sendSamplePointCommand capability is not support."); return false; }
cmd c = yoq.e(egfVar); this.e.sendCommand(uniteDevice, c);

// yoq.e(egf)   -> SamplePoint
cqeVar.e(55, 3).d(1, src).d(2, wear).j(3, (int) dictTypeId);
if (start != -1) cqeVar.j(4, (int) start);  if (end != -1) cqeVar.j(5, (int) end);
cqeVar.c(6);                                           // list tag 6 => 0x86
for (ege e : points) { cqeVar.d(7).b(8, (int) e.e()); if (e.c()!=null) cqeVar.a(9, e.c()); cqeVar.e(cqeVar.d()); }  // struct 0x87
cqeVar.b(cqeVar.e());
if (metaData != null) cqeVar.d(10, metaData);
cmd.a(SendMode.PROTOCOL_TYPE_5A)
```

- `55 = 0x37` = DataSync (matches Gadgetbridge `DataSync.id = 0x37`) [H]. Incoming dispatch: `ynw.a(...)` checks `bArr[0] == 55`, then `bArr[1]` = 1..5 [H].
- TLV encoder `defpackage.cqe` with `cph`: tag = minimal big-endian bytes of the tag number; length = 7-bit varint (`0x80` continuation, big-endian groups); containers use tag `n + 0x80` (list `c(n)`, struct `d(n)`).
  `j(tag,int)` / struct `b(tag,int)` = fixed 4-byte big-endian int; `c(tag,int)` = minimal bytes; `g/a(tag,int)` = 1 byte; `c/b(tag,long)` = 8-byte big-endian; strings = UTF-8 [H].
  This is the same TLV format `HuaweiTLV` in Gadgetbridge/JoyoFit speaks.
- Gate bits (ExpandCapability, bit `n` = `bytes[n/8] & (1 << (n%8))`, identical to GB `supportsExpandCapability`): **83** SampleConfig, **84** SampleEvent, **85** SamplePoint, **173** DictionaryPointInfo, **307** CompactDataDictionary [H] (`ynw.e/a/d/c/e`). Diet-specific extension: **215** (`com.huawei.hms.kit.awareness.barrier.internal.e.a.N = 215`, used as `egs.e(deviceInfo, a.N)`) [H].
  The code only calls `sendSamplePointCommand` if bit 85 is set; `ynw.b(deviceInfo)` additionally rejects a null/not-connected device [H].
- Frame type `SendMode.PROTOCOL_TYPE_5A` = the usual `5A` link frame, encrypted after auth like every other service [H for the 5A choice, M for "same encryption path"].

### 2.3 Config (goal, deficit): `defpackage.nkj` (`HwSyncWeightManager`)

```java
private efy a(String json, long configId, long modifyTime) {            // sample config builder
    efy.setSrcPkgName("hw.unitedevice.weightMgr"); efy.setWearPkgName("hw.sport.dietcal"); efy.setCommandId(1);
    egb.b(configId); egb.e(1); egb.d(Long.valueOf(modifyTime)); egb.c(utf8(json));
}
eeu.c().sendSampleConfigCommand(deviceInfo, a(HiJsonUtil.d(izd, izd.class), CommonUtil.l(ctx, "900300023"), modifiedTime), ...)
```

`CommonUtil.l(ctx,str)` is just `Long.parseLong`, so the config id is **900300023** (`0x35A97CF7`); the weight goal alone is **900300022** with JSON `{"weightGoal":<double>}` [H].
Wire layout per `yoq.e(efy)`: `0x83{ 0x84{ 05 = configId int32, 06 = action (1 byte, always 1), 07 = data, 08 = modify time int64 ms } }` [H]. That is byte-identical to what
Gadgetbridge `DataSync.ConfigCommand` already builds (tags 5..8), only the ids and package names differ.
Config JSON (`defpackage.izd`, Gson): `onePointFull{breakfast,lunch,dinner}` (kcal budget per meal), `caloricDeficitGoal` (kcal/day), `weightInit` (kg), `activityCalGoal` (kcal/day),
`fatLossRatio{maxRatio,minRatio,maxWeek,gear}`, `weightManagerType` (0 maintain, 1 lose, 2 gain), `proportionMeal{breakfast,lunch,dinner,extra}` [H for names, M for exact semantics].
`wko` (day overview) fields `goal`, `canTake`, `inTake`, `consumption`, `restingCalories`, `restingCaloriesBurned`, `weekGoalDiff` are **not** sent as such; they are phone UI values [H: no send path found].

### 2.4 Who triggers a send, and the watch-initiated requests

| Trigger | Where | Notes |
|---|---|---|
| user saves a diet record | `defpackage.wnb.c(start,end)` log `syncDietRecordToDevice` -> `fbj.b(start,end,null)` | device = active main device (`GetDeviceInfoMode.ACTIVE_MAIN_DEVICES_WITHOUT_AW70`), 2 retries every 2 s if none [H] |
| cloud diet data downloaded | `nkj.d()` subscription: `DIET_RECORD_SET` + `"sync download"` -> `fbj.b(0,0,device)` | start=end=0 [H] |
| resting metabolism changed | `RESTING_METABOLISM_SET` `INSERT` -> `fbj.b(now,now,device)` + config push | [H] |
| config `900300022/23` changed | `nkj.b(id)` on `HiSubscribeType 103` change; also run twice in the `HwSyncWeightManager` constructor | [H] |
| **watch asks** | listener `eeu.registerDeviceSampleListener("hw.unitedevice.weightMgr")` and `"hw.unitedevice.common"` | see below [H] |

Watch request, `nkj.c(DeviceInfo, egd)`: SampleEvent with **eventId `80030003`** and data = UTF-8 JSON `{"startTime":ms,"endTime":ms,"event":N}`:

| `event` | phone action |
|---|---|
| 1 | clamp `startTime` to the start of its day (`iiu.b(j,0)`), call `fbj.b(start,end,device)` = **send meal SamplePoint** (query window max 7 days, `lxt.e(...) > 7` -> last 7 days) |
| 4 | week report: `sendSampleEventCommand` with `{"stageType":1,"event":4}` (event id 80030003) |
| 5 | `updateLatestWeightData`: send `0x37/04` dictionary points BODY_WEIGHT / BODY_FAT_RATE / BASAL_METABOLISM / SKELETAL_MUSCLE_MASS (data type ids from `DicDataTypeUtil`) |
| 6 | **watch quick-logs meals**: JSON `{"meals":[{whichMeal,eatTime(s),kiloCalorie,timeZone,...}],"startTime":..}` -> phone saves them as diet records (`iyp.e(...)`), then replies with event `80030003` `{"punchResult":0|102,"punchFailTime":..,"event":6}` (needs bit 215) [H] |

SampleEvent **`80030004`** on `hw.unitedevice.common` = watch asks for the VIP flag; phone answers (`fbj.a(...)`, `fbj.c(deviceInfo,int)`) with event `80030004`, src `hw.unitedevice.common`, data = 1 byte `0|1|2` [H].
A SampleDictionary request (`0x37/04`, type `500018`) is answered with resting-metabolism points (`nkj.d(efw)`) [H].

So the intake flow in the reverse direction (watch logs a meal) exists too. That is more than JoyoFit needs, but it is the same service.

## 3. Byte-level spec

Everything below is the **plaintext payload** `service | command | TLV...` that goes inside the usual `5A | len | ... | CRC16` frame
(and AES layer) that JoyoFit already produces. Integers big-endian. TLV length is a varint (1 byte < 0x80, else 2 bytes `((n>>7)|0x80), (n&0x7F)`).

### 3.1 SamplePoint, meal intake (`37 03`), phone -> watch

```
37 03
01 18 "hw.unitedevice.weightMgr"            (src package, UTF-8)
02 10 "hw.sport.dietcal"                    (wear package)
03 04 00 09 27 C2                           dictTypeId 600002
04 04 <int32>                               start  (optional; code sends (int) of a ms long, i.e. truncated; 0 when unknown)
05 04 <int32>                               end    (optional)
86 <len>                                    list
  87 <len>                                  struct
    08 04 00 09 27 C2                       key 600002
    09 <len> <UTF-8 JSON array of meals>    value
0A <len> <UTF-8 {"dietaryAnalysis":{...}}>  metadata, optional
```

Meals JSON (Gson compact, field order `eatTime,hasFood,kiloCalorie,sugRange,whichMeal`):

```json
[{"eatTime":1760400000,"hasFood":true,"kiloCalorie":350.0,"sugRange":[480,720],"whichMeal":10},
 {"eatTime":1760400000,"hasFood":false,"kiloCalorie":0.0,"sugRange":[600,800],"whichMeal":20},
 {"eatTime":1760400000,"hasFood":false,"kiloCalorie":0.0,"sugRange":[480,720],"whichMeal":30},
 {"eatTime":1760400000,"hasFood":false,"kiloCalorie":0.0,"sugRange":[0,100],"whichMeal":40}]
```

Generated by `tools/example.py` (a faithful port of `cqe`/`cph`); full 451-byte plaintext of that example:

```
3703011868772e756e6974656465766963652e7765696768744d6772021068772e73706f72742e6469657463616c
0304000927c2 04040000000005040000000086830087827d 0804000927c2 0982745b7b2265617454696d65223a...
```

(See `tools/example.py` output; the JSON part is plain ASCII, nothing else is hidden.)
`eatTime` is Unix **seconds**. One entry per meal slot; send the whole day each time (the phone always sends the complete day and keeps the list <= 42).

### 3.2 SampleConfig, goal and per-meal budget (`37 01`), phone -> watch

```
37 01
01 18 "hw.unitedevice.weightMgr"
02 10 "hw.sport.dietcal"
83 <len>
  84 <len>
    05 04 35 A9 7C F7          configId 900300023
    06 01 01                   action
    07 <len> <UTF-8 JSON>      izd
    08 08 <int64 ms>           modify time
```

JSON example: `{"onePointFull":{"breakfast":600,"lunch":800,"dinner":600},"caloricDeficitGoal":500,"weightInit":70.0,"activityCalGoal":300,"weightManagerType":1}` (220-byte payload in `tools/example.py`).
Which fields the watch needs is **not known** (the phone sends the full `izd`).

### 3.3 SampleEvent (`37 02`), both directions

```
37 02
01 <len> src package   ("hw.unitedevice.weightMgr")
02 <len> wear package  ("hw.sport.dietcal")
03 04 <int32 eventId>  (80030003 = 04 C5 29 33, 80030004 = 04 C5 29 34)
04 01 <level>          (0)
05 <len> <UTF-8 JSON>
```

Phone reply after the watch's quick log: `{"punchResult":0,"event":6}` (84-byte payload in `tools/example.py`). Watch request to parse: `{"startTime":..,"endTime":..,"event":1}`.
Watch->phone direction: same layout; Huawei's parser (`ynw.b`) reads tags 1, 2, 3 (long), 4 (int), 5 (bytes), and tag `7F` as an error code (`DataSync.getError` in GB handles that) [H].

## 4. Gates and prerequisites

| Gate | Value | Source |
|---|---|---|
| ExpandCapability bit 83 / 84 / 85 | config / event / point commands | `ynw` [H] |
| ExpandCapability bit 215 | extra meal slots (11/21/31) and watch quick-log reply | `egs.e(deviceInfo, 215)` [H] |
| ExpandCapability bit 173 | dictionary points (resting metabolism, weight) | `ynw.c` [H] |
| Watch supports `hw.sport.dietcal` app | unknown; not checked in the send path, only by the bits above | [L] |
| Phone-side feature gate | `iyn.b()` / `WeightApi.isSupportDiet` (account, region, network, not minor) | irrelevant to JoyoFit |
| `SupportedServices` list | **service `0x37` is not in the Watch Fit 4 Pro list** you recorded (`...30 32 34 35`), yet find-my-watch already works on `0x37`; so the real gate is ExpandCapability, not that list [M] | |

Do **not** send unless bits 83 (config), 85 (point) are present in the ExpandCapability bitmap; read bit 215 before using slots 11/21/31.

## 5. What is not known (unknowns)

1. Whether the watch accepts a SamplePoint with `start=end=0` or requires real times (Huawei sends `(int)` truncated ms; looks like a Huawei quirk) [L].
2. Whether the calorie-management card appears without the `900300023` config, or needs `weightManagerType` set (watch-side logic is not in the APK) [L].
3. The watch's reply to `0x37/03` (probably an ack with optional tag `7F` error) [L].
4. The exact meaning of every `izd` field to the watch; `proportionMeal` shape (`iyz`: breakfast/lunch/dinner + extra) [M].
5. Burned calories or balance reported by the watch back to the phone: **none found** for diet; calories burned arrive through the normal fitness data sync (service `07`, `17`) [M].
6. Reflection or runtime-downloaded plugin code: the main DEX holds all of this. `PluginHealthModel` and `PluginHiAiEngine` are built-in zips with no diet transport code; downloaded plugins (`AIService`, `PluginHealthAlgorithm`, `PluginWearAbility`, ...) are `config://` and are **not** in the APK. A later server-side change could differ; not observable offline.
7. The diet UI itself is partly ArkUI-X/H5 (`assets/arkui-x/...`, `com.huawei.health.h5.diet-diary`); it only talks to the code above through `WeightApi`, no second transport found.
8. Link-layer encryption of the 0x37 frames is the same as other services, assumed, not proven.

## 6. Capture plan to confirm on the real device

Static analysis cannot show what the watch UI needs. Cheapest verification first.

**Step A (preferred, no Huawei Health involved): send from JoyoFit and watch the watch.**
1. Check ExpandCapability bits 83, 85, 215 in JoyoFit's log for the connected Watch Fit 4 Pro (JoyoFit already stores `expandCapabilities`).
2. Send `0x37/01` with `900300023` (3.2, use a plausible goal), then `0x37/03` (3.1) with one real meal. Open the watch's calorie / weight management screen.
3. Log every `0x37` reply from the watch (look for tag `7F`). Iterate: add/remove config, `sugRange`, `hasFood`.
4. Also try the watch -> phone request: open the diet card on the watch and watch for `0x37/02` with `eventId 80030003`; log its JSON (`event`, `startTime`, `endTime`). That tells you when the watch wants data, which is what JoyoFit should answer.

**Step B (only if A is ambiguous): capture Huawei Health's own traffic.**
1. On the Xiaomi (HyperOS): Settings -> About phone -> tap OS version 7x for Developer options -> Additional settings -> Developer options -> enable **Bluetooth HCI snoop log** (full), toggle Bluetooth off/on.
2. In Huawei Health: connect to the watch; log a breakfast in the diet diary (food, kcal known, e.g. 350 kcal) and note the exact time; open the calorie card on the watch.
3. Pull the log: `adb bugreport` (the BT snoop is inside as `FS/data/misc/bluetooth/logs/btsnoop_hci.log` on most builds), or on Xiaomi `*#*#5959#*#*` writes to `/sdcard/MIUI/debug_log/` [INFERENCE, path not verified on this device].
4. Open in Wireshark, filter `btatt`. **The link payload is AES encrypted** after auth, so Wireshark shows ciphertext. To read it you need the session key: not obtainable from the snoop. Therefore Step B is only useful to confirm **timing and packet counts** (a burst of writes right after the meal is saved), not content. Content confirmation must come from Step A.
5. Optional on the phone: Huawei Health release logs (`R_DietRecordHelper`, `SampleCommandManager`) already print the sample point and the config (`cpm.c("SampleCommandManager", cmd.b(), "sendSampleConfigCommand commandMessage: ")` logs the **plaintext** bytes of config and dictionary commands). If Huawei Health exposes a log export (Me -> Settings -> About -> tap version repeatedly, [INFERENCE]), that yields the plaintext frame.

**A Huawei-side capture is not required to start.** It is only required if JoyoFit's Step A packets are rejected or ignored and the cause is unclear.

## 7. Implementation outline for JoyoFit (not done here, no source touched)

- Add `DataSync.SamplePoint.Request` (tags above) next to `ConfigCommand`/`EventCommand`; add a builder in `HuaweiDataSyncCommon` for meals JSON.
- Add a DataSync handler for incoming `0x37/02` events from `hw.unitedevice.weightMgr`; on `event:1` answer with the day's SamplePoint.
- Send SampleConfig `900300023` once after connect (if bit 83) and after the user changes the goal.
- Trigger a SamplePoint after every JoyoRogo meal change and on `event:1`.

## 8. How this was produced

See `NOTES.md` (REA setup, commands, what failed, why the engine was also driven directly).

## 9. REA evidence IDs (files in `out/evidence/`)

| Evidence | id | What it shows |
|---|---|---|
| `inspect_android_package` (`out/inspect.json`) | `ev_1394d5cb14f55768bdc90f4495a6f36426923a5b7b031199ad50f2a627b7212e` | package, manifest, counts |
| `inspect_android_method defpackage.fbj c #7` (`(JJDeviceInfo;List;I)Z` = sendDietSamplePoint) | `ev_2977e2aa5c6b32ca1ec479db5af954b9e5cc463cdfad742e0cb26dfb4d41e14b` | section 2.1 |
| `inspect_android_method defpackage.yoq e #1` (`(Legf;)Lcmd;`) | `ev_21d0c508387d1c048cf3268d0cf8eb4fc18d79c1da5623af42124d20431d8f4c` | SamplePoint TLV builder, section 2.2 |
| `inspect_android_method defpackage.ynw d #8` (`sendSamplePointCommand`) | `ev_77e81341b54904cd42306798554936343a5ea4314d55aae1c762e2bd2182af85` | capability bit 85 gate |
| `inspect_android_class` fbj / ynw / yoq / nkj | `ev_ce8f59f8...bbb`, `ev_ce1b9b7b...c46e`, `ev_1c3f3728...cc7e`, `ev_51fad48c...ec38b36` (full ids in `out/evidence/class_*.json`) | member inventories |

REA's `search_android_classes` fails on this APK (duplicate class-name check), see `NOTES.md`; the other decompiled classes quoted above (`nkj` bodies, `egf`, `egb`, `cqe`, `cph`,
`wkr`, `izd`, `wnb`, `DicDataTypeUtil`, `e.a`) come from the same engine driven directly and are in `src/`.
