// Written for watch-fit (AGPL-3.0-or-later), in the style of Gadgetbridge's Watchface.java / FileUpload.java. The layouts come from
// Huawei Health 17.0.8.300 (DiyWatchFaceDeviceService.getPhotoWatchInfo / makeNewPhotoInfoCommand, HwCommonFileMgr.b "5.40.1" reportDeviceRequest).
// Only the phone-to-watch packets live here: the watch's answers (27/08, 27/09) and its file requests (28/01) reach the code as plain
// decrypted packets and are read from their TLV by PhotoFaceCodec.kt.
package nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;

public class PhotoFace {
    /** Service 0x27 (Watchface): the photo face's own settings. */
    public static final byte watchfaceId = 0x27;
    /** Service 0x28 (FileUpload): the watch asks the phone for a file. */
    public static final byte fileUploadId = 0x28;

    /** 27/08: read the photo face's settings and its photo list. */
    public static class InfoRequest extends HuaweiPacket {
        public static final byte id = 0x08;

        /**
         * @param position also ask for the position index (tag 0x08 of the answer)
         * @param style    also ask for the style index (0x09)
         * @param data     also ask for the data index (0x0a)
         */
        public InfoRequest(ParamsProvider paramsProvider, boolean position, boolean style, boolean data) {
            super(paramsProvider);
            this.serviceId = watchfaceId;
            this.commandId = id;
            this.tlv = new HuaweiTLV()
                    .put(0x01)
                    .put(0x02)
                    .put(0x03)
                    .put(0x04)
                    .put(0x0c)
                    .put(0x0d);
            if (position)
                this.tlv.put(0x08);
            if (style)
                this.tlv.put(0x09);
            if (data)
                this.tlv.put(0x0a);
            this.complete = true;
        }
    }

    /** 27/09: the photo list the face should show and its settings (built by PhotoFaceCodec.saveTlv). The watch answers with how many photos it still wants. */
    public static class SaveRequest extends HuaweiPacket {
        public static final byte id = 0x09;

        public SaveRequest(ParamsProvider paramsProvider, HuaweiTLV tlv) {
            super(paramsProvider);
            this.serviceId = watchfaceId;
            this.commandId = id;
            this.tlv = tlv;
            this.complete = true;
        }
    }

    /** 28/01 from the phone: the answer to the watch's request for a file ("reportDeviceRequest"). */
    public static class FileRequestAnswer extends HuaweiPacket {
        public static final byte id = 0x01;

        /**
         * @param resourceType the watch's tag 0x05, or -1 when its request had none
         * @param status       100000 to say the file is available and will be sent, 140006 when it is not
         */
        public FileRequestAnswer(ParamsProvider paramsProvider, String fileName, int fileType, int resourceType, int status) {
            super(paramsProvider);
            this.serviceId = fileUploadId;
            this.commandId = id;
            this.tlv = new HuaweiTLV()
                    .put(0x01, fileName)
                    .put(0x02, (byte) fileType);
            if (resourceType != -1)
                this.tlv.put(0x05, (byte) resourceType);
            this.tlv.put(0x7f, status);
            this.complete = true;
        }
    }

    /** 27/05 from the phone: the acknowledgement of a status report from the watch (Huawei Health `reportAck`). */
    public static class ReportAck extends HuaweiPacket {
        public static final byte id = 0x05;

        public ReportAck(ParamsProvider paramsProvider, String watchfaceId, String version) {
            super(paramsProvider);
            this.serviceId = PhotoFace.watchfaceId;
            this.commandId = id;
            this.tlv = new HuaweiTLV()
                    .put(0x01, watchfaceId)
                    .put(0x02, version)
                    .put(0x7f, 0x000186A0);
            this.complete = true;
        }
    }
}
