/*  Copyright (C) 2025 Me7c7

    This file is part of Gadgetbridge.

    Gadgetbridge is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Gadgetbridge is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>. */
// Modified for watch-fit (AGPL-3.0-or-later): persists through HuaweiDictionarySyncInterface.Store instead of GB's DAO sample providers; parsing, value ranges and the ExpandCapability gate are GB's.
package nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.dictionarysync;

import java.util.ArrayList;
import java.util.List;

import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiDictTypes;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.HuaweiP2PDataDictionarySyncService;

public class HuaweiDictionarySyncEmotion implements HuaweiDictionarySyncInterface {
    private final Logger LOG = LoggerFactory.getLogger(HuaweiDictionarySyncEmotion.class);

    public static final int EMOTION_CLASS = 500031;
    public static final int EMOTION_STATUS_VALUE = 500031195;
    public static final int EMOTION_VALENCE_CHARACTER_VALUE = 500031347;
    public static final int EMOTION_ORIGIN_STATUS_VALUE = 500031160;
    public static final int EMOTION_AROUSAL_CHARACTER_VALUE = 500031842;

    @Override
    public int getDataClass() {
        return EMOTION_CLASS;
    }

    @Override
    public String getMetricType() {
        return "emotion";
    }

    @Override
    public String getTitle() {
        return "Emotion / stress";
    }

    @Override
    public String describeGate() {
        return "ExpandCapability 206 (GB supportsEmotion)";
    }

    @Override
    public boolean supports(Caps caps) {
        return caps.supportsExpandCapability(206);
    }

    @Override
    public long getLastDataSyncTimestamp(Store store) {
        return store.getLastFetchTimestamp(getMetricType());
    }

    @Override
    public void handleData(Store store, List<HuaweiP2PDataDictionarySyncService.DictData> dictData) {
        List<Row> rows = new ArrayList<>();
        for (HuaweiP2PDataDictionarySyncService.DictData dt : dictData) {
            long timestamp = dt.getStartTimestamp();
            long lastTime = HuaweiDictionarySyncSupport.lastTime(dt);
            Integer status = null;
            Double valenceCharacter = null;
            Integer originStatus = null;
            Double arousalCharacter = null;
            for (HuaweiP2PDataDictionarySyncService.DictData.DictDataValue val : dt.getData()) {
                if (val.getTag() != 10) {
                    LOG.info("emotions unexpected tag: {}", val.getTag());
                    continue;
                }
                Double value = HuaweiDictionarySyncSupport.toDouble(val.getValue());
                if (val.getDataType() == EMOTION_STATUS_VALUE) {
                    if (value != null && value >= 0 && value < 100) {
                        status = (int) (double) value;
                    }
                } else if (val.getDataType() == EMOTION_VALENCE_CHARACTER_VALUE) {
                    if (value != null && value >= 0 && value <= 100) {
                        valenceCharacter = value;
                    }
                } else if (val.getDataType() == EMOTION_ORIGIN_STATUS_VALUE) {
                    if (value != null && value >= 0 && value < 100) {
                        originStatus = (int) (double) value;
                    }
                } else if (val.getDataType() == EMOTION_AROUSAL_CHARACTER_VALUE) {
                    if (value != null && value >= 0 && value <= 100) {
                        arousalCharacter = value;
                    }
                } else {
                    LOG.info("emotions unknown data type: {}", val.getDataType());
                }
            }
            if (status != null || valenceCharacter != null || originStatus != null || arousalCharacter != null) {
                JSONObject json = new JSONObject();
                HuaweiDictionarySyncSupport.put(json, "status", status == null ? 0 : status);
                if (valenceCharacter != null) HuaweiDictionarySyncSupport.put(json, "valence", valenceCharacter);
                if (originStatus != null) HuaweiDictionarySyncSupport.put(json, "originStatus", originStatus);
                if (arousalCharacter != null) HuaweiDictionarySyncSupport.put(json, "arousal", arousalCharacter);
                rows.add(new Row(getMetricType(), timestamp, lastTime, (double) (status == null ? 0 : status), json.toString()));
            }
        }
        store.persist(rows);
    }
}
