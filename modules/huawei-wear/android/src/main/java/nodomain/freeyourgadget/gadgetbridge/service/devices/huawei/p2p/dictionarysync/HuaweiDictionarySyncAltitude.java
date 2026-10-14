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
// GB has this class as an empty stub with its gate commented out; the field layout is not known, so every value is stored raw as {dataType: value}.
package nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.dictionarysync;

import java.util.ArrayList;
import java.util.List;

import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiDictTypes;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.HuaweiP2PDataDictionarySyncService;

public class HuaweiDictionarySyncAltitude implements HuaweiDictionarySyncInterface {
    private final Logger LOG = LoggerFactory.getLogger(HuaweiDictionarySyncAltitude.class);

    public static final int ALTITUDE_CLASS = 200003;

    @Override
    public int getDataClass() {
        return ALTITUDE_CLASS;
    }

    @Override
    public String getMetricType() {
        return "altitude";
    }

    @Override
    public String getTitle() {
        return "Altitude";
    }

    @Override
    public String describeGate() {
        return "ExpandCapability 72 (GB supportsAltitude, commented out in GB)";
    }

    @Override
    public boolean supports(Caps caps) {
        return caps.supportsExpandCapability(72);
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
                LOG.info("Altitude: entry at {} has no values", dt.getStartTimestamp());
                continue;
            }
            rows.add(new Row(getMetricType(), dt.getStartTimestamp(), HuaweiDictionarySyncSupport.lastTime(dt), null, json.toString()));
        }
        store.persist(rows);
    }
}
