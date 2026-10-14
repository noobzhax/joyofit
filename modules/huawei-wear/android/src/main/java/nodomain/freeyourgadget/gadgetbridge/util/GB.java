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

// Modified for watch-fit (AGPL-3.0-or-later): minimal subset of GB's util.GB (hexdump/lazyHexdump/hexStringToByteArray only), copied verbatim.
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
     * A hexdump that is only produced if it is written. Pass it to a log statement in place of
     * {@link #hexdump(byte[])}: slf4j resolves an argument by calling {@code toString()} on it, and
     * only does so once it knows the statement passes the level in effect.
     * <p>
     * This is the form to reach for when a single argument is the expensive part of a statement.
     * An {@code isDebugEnabled()} block is for when there is more to skip than one argument: two or
     * more costly arguments, a loop, or a value built up only to be logged.
     */
    @NonNull
    public static Object lazyHexdump(@Nullable final byte[] buffer) {
        return new LazyHexdump(buffer, 0, -1);
    }

    /**
     * @see #lazyHexdump(byte[])
     */
    @NonNull
    public static Object lazyHexdump(@Nullable final byte[] buffer, final int offset, final int length) {
        return new LazyHexdump(buffer, offset, length);
    }

    private static final class LazyHexdump {
        private final byte[] buffer;
        private final int offset;
        private final int length;

        LazyHexdump(@Nullable final byte[] buffer, final int offset, final int length) {
            this.buffer = buffer;
            this.offset = offset;
            this.length = length;
        }

        @NonNull
        @Override
        public String toString() {
            if (buffer == null) {
                return "(null)";
            }
            return hexdump(buffer, offset, length);
        }
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
