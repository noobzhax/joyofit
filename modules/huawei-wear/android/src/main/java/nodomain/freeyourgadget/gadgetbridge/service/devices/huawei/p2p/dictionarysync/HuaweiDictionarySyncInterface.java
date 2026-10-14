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
// Modified for watch-fit (AGPL-3.0-or-later): GB's handlers persist through GBApplication/GBDevice/DaoSession; here they take a Store (the app's
// health_metrics table) and read capabilities through Caps (HuaweiState.supportsExpandCapability). Handlers keep GB's parsing, ranges and gates.
package nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.dictionarysync;

import java.util.List;

import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.HuaweiP2PDataDictionarySyncService;

public interface HuaweiDictionarySyncInterface {
    /** GB HuaweiState.supportsExpandCapability(int). */
    interface Caps {
        boolean supportsExpandCapability(int which);
    }

    /** One stored sample: times in milliseconds, `value` is the number a chart plots (null when the field layout is not known). */
    class Row {
        public final String type;
        public final long timestamp;
        public final long lastTimestamp;
        public final Double value;
        public final String valuesJson;

        public Row(String type, long timestamp, long lastTimestamp, Double value, String valuesJson) {
            this.type = type;
            this.timestamp = timestamp;
            this.lastTimestamp = lastTimestamp;
            this.value = value;
            this.valuesJson = valuesJson;
        }
    }

    /** Where the rows go; the app implements it on top of the shared database. */
    interface Store {
        /** GB `getLastFetchTimestamp`: newest `lastTimestamp` stored for the metric (ms), 0 when none. */
        long getLastFetchTimestamp(String type);

        void persist(List<Row> rows);
    }

    int getDataClass();

    /** The name stored in `health_metrics.type`. */
    String getMetricType();

    /** Human name for the log. */
    String getTitle();

    /** The ExpandCapability bit(s) the gate checks, for the log (GB `supports`). */
    String describeGate();

    boolean supports(Caps caps);

    long getLastDataSyncTimestamp(Store store);

    void handleData(Store store, List<HuaweiP2PDataDictionarySyncService.DictData> dictData);
}
