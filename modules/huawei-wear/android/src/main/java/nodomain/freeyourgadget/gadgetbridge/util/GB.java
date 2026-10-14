/*  Copyright (C) 2015-2024 Andreas Shimokawa, Carsten Pfeiffer, Daniel Dakhno,
    Daniele Gobbetti, Davis Mosenkovs, Dmitriy Bogdanov, Felix Konstantin Maurer,
    Ganblejs, José Rebelo, Pauli Salmenrinne, Petr Vaněk, Roberto P. Rubio,
    Taavi Eomäe, Uwe Hermann, Yar

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

// Modified for watch-fit (AGPL-3.0-or-later): minimal subset of GB's util.GB (hexdump/hexStringToByteArray only), copied verbatim.
package nodomain.freeyourgadget.gadgetbridge.util;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

public class GB {
    public static final char[] HEX_CHARS = "0123456789ABCDEF".toCharArray();

    @NonNull
    public static String hexdump(@NonNull byte[] buffer, int offset, int length) {
        if (length == -1) {
            length = buffer.length - offset;
        }

        char[] hexChars = new char[length * 2];
        for (int i = 0; i < length; i++) {
            int v = buffer[i + offset] & 0xFF;
            hexChars[i * 2] = HEX_CHARS[v >>> 4];
            hexChars[i * 2 + 1] = HEX_CHARS[v & 0x0F];
        }
        return new String(hexChars);
    }

    @NonNull
    public static String hexdump(@Nullable byte[] buffer) {
        if (buffer == null) {
            return "(null)";
        }
        return hexdump(buffer, 0, buffer.length);
    }

    /**
     * https://stackoverflow.com/a/140861/4636860
     */
    public static byte[] hexStringToByteArray(CharSequence s) {
        int len = s.length();
        byte[] data = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            data[i / 2] = (byte) ((Character.digit(s.charAt(i), 16) << 4)
                    + Character.digit(s.charAt(i + 1), 16));
        }
        return data;
    }
}
