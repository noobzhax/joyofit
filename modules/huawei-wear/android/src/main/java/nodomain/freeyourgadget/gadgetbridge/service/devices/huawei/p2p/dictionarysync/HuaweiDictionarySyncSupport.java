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
// watch-fit helper (AGPL-3.0-or-later): shared parsing for the dictionary handlers.
package nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.dictionarysync;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.BufferUnderflowException;
import java.nio.ByteBuffer;
import java.util.List;

import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.HuaweiP2PDataDictionarySyncService;

final class HuaweiDictionarySyncSupport {
    private HuaweiDictionarySyncSupport() {
    }

    /** GB HuaweiUtil.convBytes2Double, but a short value gives null instead of an exception. */
    static Double toDouble(byte[] b) {
        if (b == null || b.length < 8) {
            return null;
        }
        try {
            return ByteBuffer.wrap(b).getDouble();
        } catch (BufferUnderflowException e) {
            return null;
        }
    }

    static long lastTime(HuaweiP2PDataDictionarySyncService.DictData dt) {
        return Math.max(dt.getEndTimestamp(), dt.getModifyTimestamp());
    }

    static String json(JSONObject object) {
        return object.toString();
    }

    static void put(JSONObject object, String name, Object value) {
        try {
            object.put(name, value);
        } catch (JSONException e) {
            // Only NaN and infinite doubles are refused; a value like that is not stored.
        }
    }

    /** Every value of one dictionary entry as {"<dataType>": number | "text"}, for classes whose field layout is not known. */
    static JSONObject rawValues(List<HuaweiP2PDataDictionarySyncService.DictData.DictDataValue> values) {
        JSONObject object = new JSONObject();
        for (HuaweiP2PDataDictionarySyncService.DictData.DictDataValue val : values) {
            String key = Integer.toString(val.getDataType());
            if (val.getTag() == 10) {
                Double d = toDouble(val.getValue());
                if (d != null && !d.isNaN() && !d.isInfinite()) {
                    put(object, key, d);
                } else if (val.getValue() != null) {
                    put(object, key, "hex:" + hex(val.getValue()));
                }
            } else if (val.getTag() == 11) {
                put(object, key, new String(val.getValue(), java.nio.charset.StandardCharsets.UTF_8));
            } else if (val.getValue() != null) {
                put(object, key + ".t" + val.getTag(), "hex:" + hex(val.getValue()));
            }
        }
        return object;
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
