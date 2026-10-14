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

public class HuaweiDictionarySyncSkinTemperature implements HuaweiDictionarySyncInterface {
    private final Logger LOG = LoggerFactory.getLogger(HuaweiDictionarySyncSkinTemperature.class);


    @Override
    public int getDataClass() {
        return HuaweiDictTypes.SKIN_TEMPERATURE_CLASS;
    }

    @Override
    public String getMetricType() {
        return "skin_temperature";
    }

    @Override
    public String getTitle() {
        return "Skin temperature";
    }

    @Override
    public String describeGate() {
        return "ExpandCapability 29 (GB supportsTemperature)";
    }

    @Override
    public boolean supports(Caps caps) {
        return caps.supportsExpandCapability(0x1d);
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
            Double temperature = null;
            for (HuaweiP2PDataDictionarySyncService.DictData.DictDataValue val : dt.getData()) {
                if (val.getTag() != 10) {
                    LOG.info("skin temperature unexpected tag: {}", val.getTag());
                    continue;
                }
                if (val.getDataType() == HuaweiDictTypes.SKIN_TEMPERATURE_VALUE) {
                    Double value = HuaweiDictionarySyncSupport.toDouble(val.getValue());
                    if (value != null && value >= 20 && value <= 42) {
                        temperature = (double) value.floatValue();
                    }
                } else {
                    LOG.info("skin temperature unknown data type: {}", val.getDataType());
                }
            }
            if (temperature != null) {
                JSONObject json = new JSONObject();
                HuaweiDictionarySyncSupport.put(json, "temperature", temperature);
                rows.add(new Row(getMetricType(), timestamp, lastTime, temperature, json.toString()));
            }
        }
        store.persist(rows);
    }
}
