/*  Copyright (C) 2024 Me7c7

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
// Modified for watch-fit (AGPL-3.0-or-later): HuaweiState is replaced by HuaweiDictionarySyncInterface.Caps; the handler list adds the arrhythmia class and
// drops the debug handler; startSync copies the class list; a page that does not advance the start time ends the class (GB would ask for the same page
// forever); the operation and class tags of the watch's answer are read as 1 to 4 byte big-endian integers (GB's getInteger needs exactly 4 and throws on a shorter
// value); cancelSync() drops state when the caller gives up; the callback also hears about every class that ends with a parse error.
package nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p;

import androidx.annotation.NonNull;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.HuaweiP2PManager;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.dictionarysync.HuaweiDictionarySyncAltitude;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.dictionarysync.HuaweiDictionarySyncArterialStiffness;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.dictionarysync.HuaweiDictionarySyncBloodPressure;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.dictionarysync.HuaweiDictionarySyncArrhythmia;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.dictionarysync.HuaweiDictionarySyncEmotion;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.dictionarysync.HuaweiDictionarySyncHRV;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.dictionarysync.HuaweiDictionarySyncInterface;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.dictionarysync.HuaweiDictionarySyncLakeLouiseAMS;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.dictionarysync.HuaweiDictionarySyncSkinTemperature;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.dictionarysync.HuaweiDictionarySyncSleepApnea;

public class HuaweiP2PDataDictionarySyncService extends HuaweiBaseP2PService {
    private final Logger LOG = LoggerFactory.getLogger(HuaweiP2PDataDictionarySyncService.class);

    public static final String MODULE = "hw.unitedevice.datadictionarysync";

    private final AtomicBoolean serviceAvailable = new AtomicBoolean(false);


    private List<Integer> classesToSync = null;

    private final Map<Integer, Long> lastRequestedStart = new ConcurrentHashMap<>();

    public interface DictionarySyncCallback {
        long onGetLastDataSyncTimestamp(int dictClass);

        void onData(int dictClass, List<HuaweiP2PDataDictionarySyncService.DictData> dictData);

        void onComplete(boolean complete);
    }

    private final Map<Integer, DictionarySyncCallback> currentRequests = new ConcurrentHashMap<>();

    public HuaweiP2PDataDictionarySyncService(HuaweiP2PManager manager) {
        super(manager);
        LOG.info("P2PDataDictionarySyncService");
    }

    @Override
    public String getModule() {
        return HuaweiP2PDataDictionarySyncService.MODULE;
    }

    @Override
    public String getPackage() {
        return "hw.watch.health.filesync";
    }

    @Override
    public String getFingerprint() {
        return "SystemApp";
    }

    // According to HCI logs this value is variable size.
    public static byte[] dictToBytes(int value) {
        if (value < 256) {
            return new byte[]{(byte) value};
        }

        int numBytes = 0;
        int temp = value;
        while (temp > 0) {
            temp >>= 8;
            numBytes++;
        }

        byte[] byteArray = new byte[numBytes];
        for (int j = numBytes - 1; j >= 0; j--) {
            byteArray[j] = (byte) (value & 0xFF);
            value >>= 8;
        }
        return byteArray;
    }

    public List<HuaweiDictionarySyncInterface> getSyncHandlers() {
        List<HuaweiDictionarySyncInterface> ret = new ArrayList<>();
        ret.add(new HuaweiDictionarySyncSkinTemperature());
        ret.add(new HuaweiDictionarySyncHRV());
        ret.add(new HuaweiDictionarySyncEmotion());
        ret.add(new HuaweiDictionarySyncSleepApnea());
        ret.add(new HuaweiDictionarySyncArterialStiffness());
        ret.add(new HuaweiDictionarySyncAltitude());
        ret.add(new HuaweiDictionarySyncBloodPressure());
        ret.add(new HuaweiDictionarySyncLakeLouiseAMS());
        ret.add(new HuaweiDictionarySyncArrhythmia());
        return ret;
    }

    public Map<Integer, HuaweiDictionarySyncInterface> getAllSupported(HuaweiDictionarySyncInterface.Caps state) {
        List<HuaweiDictionarySyncInterface> handlers = getSyncHandlers();
        Map<Integer, HuaweiDictionarySyncInterface> ret = new HashMap<>();
        for(HuaweiDictionarySyncInterface i: handlers) {
            if(i.supports(state)) {
                ret.put(i.getDataClass(), i);
            }
        }
        return ret;
    }

    public synchronized void startSync(List<Integer> dictClasses, DictionarySyncCallback callback) {
        LOG.info("P2PDataDictionarySyncService startSync {}", dictClasses);
        if (callback == null) {
            LOG.error("P2PDataDictionarySyncService  startSync callback is null");
            return;
        }
        classesToSync = new ArrayList<>(dictClasses);
        lastRequestedStart.clear();
        if (classesToSync.isEmpty()) {
            callback.onComplete(false);
            return;
        }
        sendSyncRequest(classesToSync.remove(0), 0, callback);
    }

    private void sendSyncRequest(int dictClass, long startTime, DictionarySyncCallback callback) {

        LOG.info("P2PDataDictionarySyncService class {}", dictClass);
        if (callback == null) {
            LOG.error("P2PDataDictionarySyncService sendSyncRequest callback is null");
            return;
        }

        if (!serviceAvailable.get()) {
            LOG.info("P2PDataDictionarySyncService not available");
            callback.onComplete(false);
            return;
        }

        if (currentRequests.containsKey(dictClass)) {
            LOG.info("P2PDataDictionarySyncService current class in progress");
            callback.onComplete(false);
            return;
        }
        if (startTime == 0) {
            startTime = callback.onGetLastDataSyncTimestamp(dictClass);
        }
        if (startTime < 0) {
            LOG.info("P2PDataDictionarySyncService start time is less then 0");
            callback.onComplete(false);
            return;
        }

        if (startTime > 0) {
            startTime += 1000;
        }

        Long previous = lastRequestedStart.get(dictClass);
        if (previous != null && previous == startTime) {
            LOG.info("P2PDataDictionarySyncService class {} did not advance past {}, stopping it", dictClass, startTime);
            if (classesToSync == null || classesToSync.isEmpty()) {
                classesToSync = null;
                callback.onComplete(true);
            } else {
                sendSyncRequest(classesToSync.remove(0), 0, callback);
            }
            return;
        }
        lastRequestedStart.put(dictClass, startTime);

        HuaweiTLV tlv = new HuaweiTLV()
                .put(0x1, (byte) 1)
                .put(0x2, dictToBytes(dictClass))
                .put(0x5, startTime)
                .put(0x6, System.currentTimeMillis())
                .put(0x0d, (byte) 1);
        byte[] data = tlv.serialize();
        if (data == null) {
            LOG.error("Incorrect data");
            callback.onComplete(false);
            return;
        }


        ByteBuffer packet = ByteBuffer.allocate(1 + data.length);
        packet.put((byte) 0x1); // type tlv
        packet.put(data);
        packet.flip();

        LOG.info("P2PDataDictionarySyncService send command");
        currentRequests.put(dictClass, callback);

        sendCommand(packet.array(), null);
    }

    /** Called with the ping outcome (code 0xca means the watch app answered); watch-fit logs it and waits on it. */
    public interface AvailabilityListener {
        void onPing(int code);
    }

    private volatile AvailabilityListener availabilityListener = null;

    public void setAvailabilityListener(AvailabilityListener listener) {
        this.availabilityListener = listener;
    }

    @Override
    public void registered() {
        sendPing((code, data) -> {
            AvailabilityListener listener = availabilityListener;
            if (listener != null) listener.onPing(code);
            if ((byte) code != (byte) 0xca)
                return;
            serviceAvailable.set(true);
        });
    }

    @Override
    public void unregister() {
        serviceAvailable.set(false);
        cancelSync();
        clearPending();
    }

    public boolean isAvailable() {
        return serviceAvailable.get();
    }

    /** Forget the running sync (the caller timed out or the link went away). */
    public synchronized void cancelSync() {
        currentRequests.clear();
        classesToSync = null;
        lastRequestedStart.clear();
    }

    public static class DictData {
        public static class DictDataValue {
            private final int dataType;
            private final byte tag;
            private final byte[] value;

            public DictDataValue(int dataType, byte tag, byte[] value) {
                this.dataType = dataType;
                this.tag = tag;
                this.value = value;
            }

            public int getDataType() {
                return dataType;
            }

            public byte getTag() {
                return tag;
            }

            public byte[] getValue() {
                return value;
            }

            @NonNull
            @Override
            public String toString() {
                final StringBuilder sb = new StringBuilder("HuaweiDictDataValue{");
                sb.append("dataType=").append(dataType);
                sb.append(", tag=").append(tag);
                sb.append(", value=");
                if (value == null) sb.append("null");
                else {
                    sb.append('[');
                    for (int i = 0; i < value.length; ++i)
                        sb.append(i == 0 ? "" : ", ").append(value[i]);
                    sb.append(']');
                }
                sb.append('}');
                return sb.toString();
            }
        }


        private final int dictClass;
        private final long startTimestamp;
        private final long endTimestamp;
        private final long modifyTimestamp;
        private final List<DictDataValue> data;

        public DictData(int dictClass, long startTimestamp, long endTimestamp, long modifyTimestamp, List<DictDataValue> data) {
            this.dictClass = dictClass;
            this.startTimestamp = startTimestamp;
            this.endTimestamp = endTimestamp;
            this.modifyTimestamp = modifyTimestamp;
            this.data = data;
        }

        public int getDictClass() {
            return dictClass;
        }

        public long getStartTimestamp() {
            return startTimestamp;
        }

        public long getEndTimestamp() {
            return endTimestamp;
        }

        public long getModifyTimestamp() {
            return modifyTimestamp;
        }

        public List<DictDataValue> getData() {
            return data;
        }

        @NonNull
        @Override
        public String toString() {
            return "HuaweiDictSample{" + "startTime=" + startTimestamp +
                    ", endTime=" + endTimestamp +
                    ", modifyTime=" + modifyTimestamp +
                    ", data=" + data +
                    '}';
        }
    }

    @Override
    public synchronized void handleData(byte[] data) {
        LOG.info("P2PDataDictionarySyncService handleData: {}", data.length);
        if (data.length == 0) {
            return;
        }
        if (data[0] == 1) {
            DictionarySyncCallback callback = null;
            try {
                HuaweiTLV tlv = new HuaweiTLV();
                tlv.parse(data, 1, data.length - 1);

                int operation = readInt(tlv, 0x01);
                int dictClass = readInt(tlv, 0x02);

                if (!currentRequests.containsKey(dictClass)) {
                    return;
                }
                callback = currentRequests.remove(dictClass);

                if (callback == null) {
                    return;
                }

                if (operation != 1) {
                    LOG.info("P2PDataDictionarySyncService unknown operation: {}", operation);
                    callback.onComplete(false);
                    return;
                    //I never see value differ from 1. So I don't know how to interpret others. Just ignore for now
                    //callback.onComplete(true);
                }

                //NOTE: all tags with high bit set should be parsed as container

                List<DictData> result = new ArrayList<>();

                long lastTimestamp = 0;

                for (HuaweiTLV blockTlv : tlv.getObjects(0x83)) {
                    for (HuaweiTLV l : blockTlv.getObjects(0x84)) {
                        //5 - start time, 6 - end time, 0xc - modify time
                        long startTimestamp = l.getLong(0x5);
                        long endTimestamp = 0;
                        long modifyTimestamp = 0;
                        if (l.contains(0x6))
                            endTimestamp = l.getLong(0x6);
                        if (l.contains(0xc))
                            modifyTimestamp = l.getLong(0xc);
                        List<DictData.DictDataValue> dataValues = new ArrayList<>();
                        for (HuaweiTLV l1 : l.getObjects(0x87)) {
                            for (HuaweiTLV ll : l1.getObjects(0x88)) {
                                int type = ll.getInteger(0x9);
                                if (ll.contains(0xa))
                                    dataValues.add(new DictData.DictDataValue(type, (byte) 0xa, ll.getBytes(0xa)));
                                if (ll.contains(0xb))
                                    dataValues.add(new DictData.DictDataValue(type, (byte) 0xb, ll.getBytes(0xb)));
                            }
                        }
                        result.add(new DictData(dictClass, startTimestamp, endTimestamp, modifyTimestamp, dataValues));
                        lastTimestamp = Math.max(lastTimestamp, Math.max(endTimestamp, modifyTimestamp));
                    }
                }

                callback.onData(dictClass, result);

                if (!result.isEmpty()) {
                    sendSyncRequest(dictClass, lastTimestamp, callback);
                } else {
                    if (classesToSync == null || classesToSync.isEmpty()) {
                        classesToSync = null;
                        callback.onComplete(true);
                    } else {
                        sendSyncRequest(classesToSync.remove(0), 0, callback);
                    }
                }
            } catch (HuaweiPacket.MissingTagException e) {
                LOG.error("P2PDataDictionarySyncService parse error", e);
                if (callback != null) {
                    callback.onComplete(false);
                }
            }
        } else {
            LOG.info("P2PDataDictionarySyncService unsupported data: {}", data[0]);
        }
    }

    /** A TLV integer of 1 to 4 bytes, big endian (the request writes the class variable-sized, see dictToBytes). */
    private static int readInt(HuaweiTLV tlv, int tag) throws HuaweiPacket.MissingTagException {
        byte[] bytes = tlv.getBytes(tag);
        if (bytes.length == 0 || bytes.length > 4) {
            throw new HuaweiPacket.MissingTagException(tag);
        }
        int value = 0;
        for (byte b : bytes) {
            value = (value << 8) | (b & 0xFF);
        }
        return value;
    }

    public static HuaweiP2PDataDictionarySyncService getRegisteredInstance(HuaweiP2PManager manager) {
        return (HuaweiP2PDataDictionarySyncService) manager.getRegisteredService(HuaweiP2PDataDictionarySyncService.MODULE);
    }

}
