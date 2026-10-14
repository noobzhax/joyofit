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
// GB only defines HuaweiDictTypes.ARRHYTHMIA_CLASS (700004) and never requests it over P2P; Huawei Health names it DATA_SEQUENCE_PPG_OF_ARRHYTHMIA, so it may be a sequence-data class that this request does not return. watch-fit asks anyway (experimental) and stores whatever comes back raw.
package nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.dictionarysync;

import java.util.ArrayList;
import java.util.List;

import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiDictTypes;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.HuaweiP2PDataDictionarySyncService;

public class HuaweiDictionarySyncArrhythmia implements HuaweiDictionarySyncInterface {
    private final Logger LOG = LoggerFactory.getLogger(HuaweiDictionarySyncArrhythmia.class);

    public static final int ARRHYTHMIA_CLASS_ID = 700004;

    @Override
    public int getDataClass() {
        return ARRHYTHMIA_CLASS_ID;
    }

    @Override
    public String getMetricType() {
        return "arrhythmia";
    }

    @Override
    public String getTitle() {
        return "Arrhythmia (PPG)";
    }

    @Override
    public String describeGate() {
        return "ExpandCapability 113, 255 or 168 (GB supportsArrhythmia)";
    }

    @Override
    public boolean supports(Caps caps) {
        return (caps.supportsExpandCapability(113) || caps.supportsExpandCapability(255) || caps.supportsExpandCapability(168));
    }

    @Override
    public long getLastDataSyncTimestamp(Store store) {
        return store.getLastFetchTimestamp(getMetricType());
    }

    @Override
    public void handleData(Store store, List<HuaweiP2PDataDictionarySyncService.DictData> dictData) {
        List<Row> rows = new ArrayList<>();
        for (HuaweiP2PDataDictionarySyncService.DictData dt : dictData) {
            JSONObject json = HuaweiDictionarySyncSupport.rawValues(dt.getData());
            if (json.length() == 0) {
                LOG.info("Arrhythmia (PPG): entry at {} has no values", dt.getStartTimestamp());
                continue;
            }
            rows.add(new Row(getMetricType(), dt.getStartTimestamp(), HuaweiDictionarySyncSupport.lastTime(dt), null, json.toString()));
        }
        store.persist(rows);
    }
}
