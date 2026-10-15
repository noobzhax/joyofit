import { useEffect } from "react";
import { ArrowLeft, Check } from "lucide-react";

import { GITHUB_URL, setMeta } from "./lib";

export const PRIVASI_PATH = "/privasi";

const CONTACT = "dzulfikar@joyorogo.com";
const UPDATED = "15 Oktober 2026";
const UPDATED_EN = "15 October 2026";

const META = {
  title: "Kebijakan privasi JoyoFit",
  description:
    "Data apa yang JoyoFit simpan di HP-mu, apa yang keluar dari HP (cloud opsional, cuaca, Health Connect), dan cara menghapusnya. Privacy policy in English below.",
};

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-[0.85em] font-semibold">{children}</code>;
}

function Mail() {
  return (
    <a
      href={`mailto:${CONTACT}?subject=Hapus%20data%20cloud%20JoyoFit`}
      className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
    >
      {CONTACT}
    </a>
  );
}

function List({ items }: { items: readonly React.ReactNode[] }) {
  return (
    <ul className="mt-3 space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-[0.9375rem] leading-relaxed">
          <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Block({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-3xl bg-card p-5 md:p-6">
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-[0.9375rem] leading-relaxed">{children}</div>
    </section>
  );
}

function Indonesian() {
  return (
    <div lang="id" className="space-y-3">
      <Block title="Ringkasnya">
        <List
          items={[
            "Data jam (langkah, detak jantung, SpO2, tidur, olahraga) disimpan di HP-mu. Tanpa kamu mengaktifkan fitur di bawah, tidak ada data kesehatanmu yang keluar dari HP.",
            "Cloud JoyoFit itu opsional dan baru aktif setelah kamu masuk dengan akun JoyoRogo.",
            "Tidak ada iklan, tidak ada SDK analitik atau pelaporan crash, dan datamu tidak dijual.",
            "Kode sumbernya terbuka (AGPL-3.0), jadi semua yang ditulis di sini bisa kamu periksa sendiri.",
          ]}
        />
        <p className="text-muted-foreground">
          JoyoFit dibuat dan dijalankan oleh Dzulfikar di Malang, Indonesia. Pertanyaan atau
          permintaan hapus data: <Mail />. Terakhir diperbarui {UPDATED}.
        </p>
      </Block>

      <Block title="Data di HP-mu (bawaan)">
        <p>
          JoyoFit tersambung langsung ke jam Huawei atau Honor lewat Bluetooth, tanpa Huawei Health dan
          tanpa server perantara. Yang diterima dari jam disimpan di database di HP-mu (
          <Code>joyofit.db</Code>), dan pengaturan disimpan di penyimpanan pribadi aplikasi:
        </p>
        <List
          items={[
            "Langkah, jarak, kalori, detak jantung, SpO2, detak jantung istirahat, tidur, olahraga beserta rute GPS yang direkam jam, stres, HRV, suhu kulit dan metrik kesehatan lain yang dilaporkan jam.",
            "Data yang kamu isi sendiri: profil (tinggi, berat, tahun lahir, jenis kelamin, target langkah), data siklus bila kamu menyalakan kalender siklus, berat dan tekanan darah yang kamu catat, alarm.",
            "Alamat Bluetooth, nama dan model jam yang kamu pasangkan, serta kunci pairing-nya (disimpan di penyimpanan pribadi aplikasi).",
            "Pengaturan: fitur mana yang menyala, aplikasi mana yang notifikasinya diteruskan, kota atau lokasi terakhir untuk cuaca.",
          ]}
        />
        <p>
          Cadangan otomatis Android dimatikan untuk aplikasi ini (<Code>allowBackup=false</Code>). JoyoFit tidak
          memakai iklan, ID iklan, Firebase, Sentry, atau layanan analitik apa pun.
        </p>
      </Block>

      <Block title="Cloud JoyoFit (opsional)">
        <p>
          Di Pengaturan, Kesehatan dan cloud, kamu bisa masuk dengan akun JoyoRogo (login Google lewat
          JoyoRogo). Setelah masuk, unggahan berjalan otomatis: sekitar dua detik setelah tiap sinkron dan saat
          aplikasi dibuka. Unggahan pertama mengirim seluruh riwayat di HP, bukan hanya yang baru. Tidak masuk
          berarti tidak ada unggahan.
        </p>
        <p className="font-semibold">Yang diunggah:</p>
        <List
          items={[
            "Jam: alamat Bluetooth, nama, model, versi perangkat lunak, waktu sinkron terakhir.",
            "Per menit: langkah, kalori, jarak, detak jantung, SpO2, detak jantung istirahat.",
            "Tidur: jam mulai dan selesai tiap segmen dan tahap tidurnya.",
            "Olahraga: waktu, jenis, durasi, jarak, kalori, detak jantung rata-rata dan maksimum, ringkasan lengkap, dan jalur GPS-nya (koordinat penuh, tanpa dibulatkan, paling banyak 30.000 titik per olahraga).",
          ]}
        />
        <p className="font-semibold">Yang tidak diunggah:</p>
        <p>
          Profil (tinggi, berat, tahun lahir, jenis kelamin), stres, HRV, data siklus, tekanan darah dan berat
          yang kamu catat, makanan, notifikasi, data panggilan, lokasi untuk cuaca, nomor seri jam.
        </p>
        <p>
          Data ini disimpan di database dan penyimpanan Cloudflare di akun Cloudflare milik pengembang, terkait
          ke ID akun JoyoRogo-mu. Tidak dikirim ke pihak lain, dan hanya akunmu yang bisa membacanya lewat sesi
          login. Server mencatat log permintaan standar Cloudflare Workers.
        </p>
        <p>
          Keluar (sign out) menghentikan unggahan, tetapi tidak menghapus data yang sudah ada di cloud maupun di
          HP. Cara menghapus data cloud ada di bagian Penghapusan.
        </p>
        <p>
          Selama kamu masuk, JoyoFit juga bicara dengan server JoyoRogo (<Code>api.joyorogo.com</Code>): membaca
          makanan hari ini, profil, dan berat terakhirmu dari JoyoRogo untuk ditampilkan di jam, menulis makanan
          yang kamu catat cepat dari jam, dan mengirim skor harian (pemulihan, beban, tidur, kesiapan) tiga hari
          terakhir ke JoyoRogo. Aturan privasi JoyoRogo berlaku untuk data itu: <a
            href="https://joyorogo.com/privasi"
            className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
          >
            joyorogo.com/privasi
          </a>
          . Komponen login aplikasi bisa menghubungi server JoyoRogo untuk mengecek sesi setiap aplikasi dibuka,
          termasuk bila kamu belum masuk; permintaan itu tidak membawa data kesehatan.
        </p>
      </Block>

      <Block title="Health Connect (menulis saja)">
        <p>
          Bila kamu menyalakannya di Pengaturan, JoyoFit menyalin data jam ke Health Connect, penyimpanan
          kesehatan di HP Android, supaya aplikasi lain yang kamu izinkan bisa membacanya. Izinnya diminta lewat
          dialog Health Connect sendiri dan bisa dicabut kapan saja.
        </p>
        <List
          items={[
            "Yang ditulis: langkah, jarak, kalori aktif, detak jantung, detak jantung istirahat, saturasi oksigen, tidur (dengan tahapnya), dan sesi olahraga (jenis, nama, waktu, ringkasan). Rute GPS tidak ditulis.",
            "JoyoFit tidak pernah membaca data Health Connect, dan tidak punya izin baca.",
            "Data Health Connect tidak dijual, tidak dipakai untuk iklan atau penentuan profil iklan, tidak dikirim ke server mana pun oleh fitur ini, dan tidak dibagikan ke pihak ketiga.",
          ]}
        />
      </Block>

      <Block title="Cuaca">
        <p>
          Cuaca di jam mati secara bawaan. Bila kamu menyalakannya, JoyoFit meminta prakiraan cuaca ke Open-Meteo
          (<Code>api.open-meteo.com</Code>) saat jam tersambung dan berkala, juga saat aplikasi ditutup selama
          jam masih tersambung. Yang dikirim: koordinat yang dibulatkan ke dua desimal (sekitar 1 km) tanpa ID
          perangkat atau kunci API. Open-Meteo juga melihat alamat IP-mu. Mencari kota mengirim teks nama kota ke{" "}
          <Code>geocoding-api.open-meteo.com</Code>.
        </p>
        <p>
          Lokasinya dari lokasi HP (izin lokasi) atau kota yang kamu pilih. Lokasi HP terakhir dan nama tempatnya
          disimpan di HP supaya dipakai ulang; nama tempat dicari dengan layanan Geocoder bawaan Android.
        </p>
      </Block>

      <Block title="Lokasi dan GPS">
        <List
          items={[
            "Cuaca memakai lokasi HP hanya bila kamu memilih mode lokasi HP.",
            "Saat olahraga luar ruang dimulai di jam, jam meminta GPS HP. JoyoFit membaca GPS HP selama olahraga itu dan mengirim posisi hanya ke jam lewat Bluetooth. HP tidak menyimpannya dan tidak mengunggahnya. JoyoFit menjelaskan hal ini sebelum meminta izin lokasi presisi. JoyoFit tidak meminta lokasi latar belakang.",
            "Jalur GPS yang direkam jam diunduh dari jam, disimpan di HP, ditampilkan sebagai rute, dan ikut diunggah bila kamu memakai cloud.",
            "Saat jam meminta data bantuan satelit (AGPS), HP mengunduhnya dari server Huawei (hicloud.com) atau Broadcom (glpals.com) lewat HTTPS. Alamat unduhannya ditentukan jam; JoyoFit tidak menambahkan lokasi atau ID apa pun, tetapi server itu melihat alamat IP-mu, dan isi alamat dari jam tidak bisa kami periksa.",
          ]}
        />
      </Block>

      <Block title="Notifikasi ke jam">
        <p>
          Meneruskan notifikasi mati secara bawaan dan butuh akses notifikasi yang kamu berikan di pengaturan
          Android. Setelah menyala, JoyoFit membaca judul, isi, dan nama aplikasi dari notifikasi yang masuk dan
          mengirimnya ke jam lewat Bluetooth. Semua aplikasi non-sistem diteruskan kecuali kamu mematikannya di
          daftar aplikasi di Pengaturan. Notifikasi tidak disimpan di disk dan tidak dikirim lewat internet;
          hanya beberapa yang terakhir ada di memori.
        </p>
      </Block>

      <Block title="Panggilan telepon">
        <p>
          Versi Google Play memakai izin status telepon agar jam bisa menampilkan bahwa HP berdering, dan izin
          menjawab panggilan agar tombol terima dan tolak di jam bekerja (keduanya hanya bila kamu menyalakannya
          di Pengaturan). Jam menampilkan &quot;Incoming call&quot;. Versi Google Play tidak membaca log
          panggilan, tidak membaca kontak, dan tidak mengirim SMS. Tidak ada data panggilan yang disimpan atau
          dikirim keluar HP.
        </p>
        <p className="text-muted-foreground">
          APK dari situs fit.joyorogo.com dan hasil build sendiri bisa, bila kamu mengizinkan, membaca nomor
          penelepon (izin log panggilan) dan nama kontak, serta mengirim SMS SOS yang diminta jam. Fitur itu
          dihilangkan dari versi Google Play.
        </p>
      </Block>

      <Block title="Foto wajah jam">
        <p>
          Foto yang kamu pilih untuk wajah jam dipotong di HP lalu dikirim ke jam lewat Bluetooth. Foto tidak
          diunggah ke server mana pun. Salinan hasil potongan disimpan di penyimpanan aplikasi untuk pratinjau
          dan dihapus bersama fotonya.
        </p>
      </Block>

      <Block title="Laporan dukungan">
        <p>
          Hanya bila kamu mengetuk Laporkan di GitHub atau Bagikan: JoyoFit membuat ringkasan (versi aplikasi,
          merek dan model HP, versi Android, model dan versi jam, kemampuan yang dilaporkan jam) dan log
          sambungan. Alamat Bluetooth dan nomor seri dihapus, tetapi log bisa memuat hal lain, jadi baca dulu
          sebelum mengirim. Tidak ada yang terkirim otomatis.
        </p>
      </Block>

      <Block title="Pihak ketiga">
        <List
          items={[
            "Open-Meteo: prakiraan cuaca dan pencarian kota (bagian Cuaca).",
            "Huawei (hicloud.com) dan Broadcom (glpals.com): data bantuan satelit (bagian Lokasi).",
            "Cloudflare: tempat cloud JoyoFit dan situs ini berjalan.",
            "JoyoRogo dan Google: login dan layanan JoyoRogo (bagian Cloud).",
          ]}
        />
        <p>Tidak ada iklan dan tidak ada penjualan data. Data tidak dipakai untuk iklan atau profil iklan.</p>
      </Block>

      <Block id="hapus" title="Penghapusan data">
        <List
          items={[
            "Di HP: hapus instalasi JoyoFit atau pilih Pengaturan Android, Aplikasi, JoyoFit, Penyimpanan, Hapus data. Semua data lokal terhapus. Lepas jam dengan Forget pairing di aplikasi.",
            "Di Health Connect: hapus data yang ditulis JoyoFit lewat aplikasi Health Connect.",
            <>
              Di cloud JoyoFit: kirim email dari alamat akun Google yang kamu pakai ke <Mail /> dengan subjek{" "}
              <span className="font-semibold">Hapus data cloud JoyoFit</span>. Aplikasi belum punya tombol hapus
              cloud. Kami menghapus semua data JoyoFit di cloud yang terkait akunmu dan mengonfirmasi lewat
              email, paling lambat 30 hari. Menghapus data lewat JoyoRogo tidak otomatis menghapus data cloud
              JoyoFit.
            </>,
          ]}
        />
        <p className="text-muted-foreground">
          Data cloud disimpan sampai kamu memintanya dihapus. Halaman ini juga alamat permintaan penghapusan data
          untuk JoyoFit di Google Play.
        </p>
      </Block>

      <Block title="Anak-anak">
        <p>JoyoFit untuk pengguna berusia 18 tahun ke atas dan tidak sengaja mengumpulkan data anak.</p>
      </Block>

      <Block title="Perubahan">
        <p>
          Kalau cara JoyoFit memakai data berubah, halaman ini diperbarui sebelum perubahan dirilis, dengan
          tanggal baru di atas. Riwayat perubahannya ada di{" "}
          <a
            href={`${GITHUB_URL}/commits/master/site/src/Privasi.tsx`}
            className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
            target="_blank"
            rel="noopener"
          >
            GitHub
          </a>
          .
        </p>
      </Block>
    </div>
  );
}

function English() {
  return (
    <div lang="en" className="space-y-3">
      <Block title="Summary">
        <List
          items={[
            "Watch data (steps, heart rate, SpO2, sleep, workouts) is stored on your phone. Unless you turn on one of the features below, none of your health data leaves the phone.",
            "The JoyoFit cloud is optional and only starts after you sign in with a JoyoRogo account.",
            "No ads, no analytics or crash-reporting SDKs, and your data is not sold.",
            "The source code is open (AGPL-3.0), so you can check everything stated here.",
          ]}
        />
        <p className="text-muted-foreground">
          JoyoFit is made and run by Dzulfikar in Malang, Indonesia. Questions or data deletion requests: <Mail />.
          Last updated {UPDATED_EN}.
        </p>
      </Block>

      <Block title="Data on your phone (default)">
        <p>
          JoyoFit talks to your Huawei or Honor watch directly over Bluetooth, without Huawei Health and without
          an intermediary server. What it receives is stored in a database on your phone (<Code>joyofit.db</Code>)
          and in the app&apos;s private storage: steps, distance, calories, heart rate, SpO2, resting heart rate,
          sleep, workouts with the GPS route the watch recorded, stress, HRV, skin temperature and other metrics
          the watch reports; what you enter yourself (profile, cycle calendar if enabled, weight and blood
          pressure, alarms); the watch&apos;s Bluetooth address, name, model and pairing key; and your settings.
          Android auto-backup is off for the app (<Code>allowBackup=false</Code>).
        </p>
      </Block>

      <Block title="JoyoFit cloud (optional)">
        <p>
          After you sign in with your JoyoRogo account (Google sign-in through JoyoRogo) under Settings, Health &
          cloud, uploads run automatically, about two seconds after each sync and when the app opens. The first
          upload sends your whole history. Without signing in, nothing is uploaded.
        </p>
        <p>
          <span className="font-semibold">Uploaded:</span> the watch&apos;s Bluetooth address, name, model and
          software version; per-minute steps, calories, distance, heart rate, SpO2 and resting heart rate; sleep
          segments and stages; workouts including their full summary and GPS track (full-precision coordinates, up
          to 30,000 points per workout).{" "}
          <span className="font-semibold">Not uploaded:</span> profile (height, weight, birth year, sex), stress,
          HRV, cycle data, logged weight and blood pressure, meals, notifications, call data, weather location,
          the watch&apos;s serial number.
        </p>
        <p>
          The data is stored in Cloudflare database and storage under the developer&apos;s Cloudflare account,
          keyed by your JoyoRogo account ID. It is not sent to anyone else. Signing out stops uploads but deletes
          nothing, in the cloud or on the phone.
        </p>
        <p>
          While signed in, JoyoFit also talks to JoyoRogo (<Code>api.joyorogo.com</Code>): it reads today&apos;s
          meals, your profile and latest weight to show calories on the watch, writes meals you quick-log on the
          watch, and sends the last three days of daily scores (recovery, strain, sleep, readiness). JoyoRogo&apos;s
          policy covers that data:{" "}
          <a
            href="https://joyorogo.com/privasi"
            className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
          >
            joyorogo.com/privasi
          </a>
          . The sign-in component may contact JoyoRogo to check the session whenever the app opens, even if you
          have not signed in; that request carries no health data.
        </p>
      </Block>

      <Block title="Health Connect (write only)">
        <p>
          If you turn it on, JoyoFit copies watch data into Health Connect so other apps you allow can read it:
          steps, distance, active calories, heart rate, resting heart rate, blood oxygen, sleep with stages, and
          exercise sessions (no GPS route). JoyoFit never reads Health Connect and holds no read permission.
          Health Connect data is not sold, not used for ads or ad profiling, not sent to any server by this feature
          and not shared with third parties. Permissions can be revoked at any time in Health Connect.
        </p>
      </Block>

      <Block title="Weather">
        <p>
          Off by default. When on, JoyoFit requests a forecast from Open-Meteo when the watch connects and
          periodically, also while the app is closed as long as the watch is connected. It sends coordinates
          rounded to two decimals (about 1 km), with no device ID or API key; Open-Meteo also sees your IP address.
          City search sends the city name to Open-Meteo&apos;s geocoding service. The location comes from the phone
          (location permission) or from a city you pick. The last phone location and its place name are kept on the
          phone for reuse; the place name is looked up with Android&apos;s built-in Geocoder.
        </p>
      </Block>

      <Block title="Location and GPS">
        <p>
          When an outdoor workout starts on the watch, the watch asks for the phone&apos;s GPS. JoyoFit reads the
          phone&apos;s GPS during that workout and sends the position only to the watch over Bluetooth; the phone
          does not store or upload it. JoyoFit explains this before asking for precise location and does not ask for
          background location. The GPS track the watch recorded is downloaded to the phone, shown as a route and
          uploaded if you use the cloud. When the watch asks for satellite-assist (AGPS) data, the phone downloads
          it over HTTPS from Huawei (<Code>hicloud.com</Code>) or Broadcom (<Code>glpals.com</Code>). The watch
          decides the address; JoyoFit adds no location or ID, but those servers see your IP address, and we cannot
          inspect what the watch puts in the address.
        </p>
      </Block>

      <Block title="Notifications, calls, photos">
        <p>
          <span className="font-semibold">Notifications:</span> off by default and need notification access that
          you grant in Android settings. Once on, JoyoFit reads title, text and app name of incoming notifications
          and sends them to the watch over Bluetooth. All non-system apps are forwarded unless you switch them off
          in the app list. Notifications are not written to disk and never sent over the internet.
        </p>
        <p>
          <span className="font-semibold">Calls:</span> the Google Play version uses the phone-state permission so
          the watch can show that the phone is ringing (it shows &quot;Incoming call&quot;) and the answer-calls
          permission for the watch&apos;s accept and reject buttons, both only if you enable them. It does not read
          your call log or contacts and does not send SMS. The APK from fit.joyorogo.com and self-builds can,
          with your permission, also read the caller&apos;s number and contact name and send the SOS text message
          the watch asks for.
        </p>
        <p>
          <span className="font-semibold">Watch-face photos:</span> a photo you pick is cropped on the phone and
          sent to the watch over Bluetooth. It is not uploaded to any server.
        </p>
        <p>
          <span className="font-semibold">Support report:</span> only when you tap Report on GitHub or Share, JoyoFit
          builds a summary (app version, phone make and model, Android version, watch model and version) and a
          connection log. Bluetooth addresses and the serial number are removed, but the log can contain other
          text, so read it before sending. Nothing is sent automatically.
        </p>
      </Block>

      <Block title="Third parties">
        <p>
          Open-Meteo (weather), Huawei and Broadcom (satellite-assist data), Cloudflare (hosting of the cloud and this
          site), JoyoRogo and Google (sign-in). No ads and no sale of data. Data is not used for advertising or
          ad profiling.
        </p>
      </Block>

      <Block title="Deleting your data">
        <List
          items={[
            "On the phone: uninstall JoyoFit, or Android Settings, Apps, JoyoFit, Storage, Clear data. Use Forget pairing in the app to release the watch.",
            "In Health Connect: delete what JoyoFit wrote in the Health Connect app.",
            <>
              JoyoFit cloud: email <Mail /> from the Google account you signed in with, subject{" "}
              <span className="font-semibold">Hapus data cloud JoyoFit</span> (delete JoyoFit cloud data). The app
              has no delete button for the cloud yet. We delete everything JoyoFit holds for your account and
              confirm by email, within 30 days. Deleting data in JoyoRogo does not automatically delete JoyoFit cloud
              data.
            </>,
          ]}
        />
        <p className="text-muted-foreground">
          Cloud data is kept until you ask for deletion. This page is also the data deletion request page for
          JoyoFit on Google Play.
        </p>
      </Block>

      <Block title="Children and changes">
        <p>
          JoyoFit is for users aged 18 and over and does not knowingly collect children&apos;s data. When JoyoFit
          changes how it uses data, this page is updated before the change ships, with a new date at the top.
        </p>
      </Block>
    </div>
  );
}

export function PrivasiPage() {
  useEffect(() => {
    const { title, description } = META;
    const url = `https://fit.joyorogo.com${PRIVASI_PATH}`;
    document.title = `${title} | JoyoFit`;
    setMeta('meta[name="description"]', "content", description);
    setMeta('link[rel="canonical"]', "href", url);
    setMeta('meta[property="og:url"]', "content", url);
    setMeta('meta[property="og:title"]', "content", title);
    setMeta('meta[property="og:description"]', "content", description);
    setMeta('meta[name="twitter:title"]', "content", title);
    setMeta('meta[name="twitter:description"]', "content", description);
    // The page renders after load, so the browser cannot jump to #hapus or #english on its own.
    const target = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }, []);

  return (
    <section data-section="privasi" className="py-12 md:py-16">
      <div className="mx-auto w-full max-w-3xl px-4 md:px-6">
        <a
          href="/"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Kembali ke beranda
        </a>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
          Kebijakan privasi JoyoFit
        </h1>
        <p className="mt-3 text-muted-foreground">
          Bahasa Indonesia di bawah, <a href="#english" className="font-semibold underline underline-offset-4">English version</a> setelahnya.
        </p>
        <div className="mt-8">
          <Indonesian />
        </div>
        <h2 id="english" className="mt-14 text-2xl font-extrabold tracking-tight md:text-3xl">
          Privacy policy (English)
        </h2>
        <div className="mt-6">
          <English />
        </div>
      </div>
    </section>
  );
}
