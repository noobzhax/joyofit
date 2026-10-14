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

// Modified for watch-fit (AGPL-3.0-or-later): minimal subset of GB's HuaweiCoordinator (only the HuaweiDeviceType enum).
package nodomain.freeyourgadget.gadgetbridge.devices.huawei;

public abstract class HuaweiCoordinator {

    public enum HuaweiDeviceType {
        AW(0),     //BLE behind
        BR(1),
        BLE(2),
        SMART(5)   //BLE behind
        ;

        final int huaweiType;

        HuaweiDeviceType(int huaweiType) {
            this.huaweiType = huaweiType;
        }

        public int getType() {
            return huaweiType;
        }
    }
}
