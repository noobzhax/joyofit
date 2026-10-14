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

public class HuaweiDictionarySyncSleepApnea implements HuaweiDictionarySyncInterface {
    private final Logger LOG = LoggerFactory.getLogger(HuaweiDictionarySyncSleepApnea.class);

    public static final int SLEEP_APNEA_CLASS = 500002;
    public static final int SLEEP_APNEA_LEVEL_VALUE = 500002847;

    @Override
    public int getDataClass() {
        return SLEEP_APNEA_CLASS;
    }

    @Override
    public String getMetricType() {
        return "sleep_apnea";
    }

    @Override
    public String getTitle() {
        return "Sleep apnea";
    }

    @Override
    public String describeGate() {
        return "ExpandCapability 107 (GB supportsSleepApnea)";
    }

    @Override
    public boolean supports(Caps caps) {
        return caps.supportsExpandCapability(107);
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
            Integer level = null;
            for (HuaweiP2PDataDictionarySyncService.DictData.DictDataValue val : dt.getData()) {
                if (val.getTag() == 10) {
                    if (val.getDataType() == SLEEP_APNEA_LEVEL_VALUE) {
                        Double d = HuaweiDictionarySyncSupport.toDouble(val.getValue());
                        int value = d == null ? -1 : (int) (double) d;
                        if (value == 1 || value == 2 || value == 3 || value == 4) {
                            level = value;
                        } else {
                            LOG.info("sleep apnea invalid value: {}", value);
                        }
                    } else {
                        LOG.info("sleep apnea unknown data type: {}", val.getDataType());
                    }
                } else {
                    LOG.info("sleep apnea unsupported tag: {}", val.getTag());
                }
            }
            if (level != null) {
                JSONObject json = new JSONObject();
                HuaweiDictionarySyncSupport.put(json, "level", level);
                rows.add(new Row(getMetricType(), timestamp, lastTime, (double) level, json.toString()));
            }
        }
        store.persist(rows);
    }
}
