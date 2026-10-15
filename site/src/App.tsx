import { useEffect } from "react";
import {
  ArrowRight,
  AlarmClock,
  ArrowLeft,
  Bell,
  BellRing,
  Bluetooth,
  Check,
  ChevronDown,
  Cloud,
  CloudSun,
  Download,
  Droplet,
  Dumbbell,
  Flame,
  Footprints,
  HeartPulse,
  Moon,
  Palette,
  Route,
  Server,
  ShieldCheck,
  Watch,
  type LucideIcon,
} from "lucide-react";
import { CLOUDAGNI_URL, GITHUB_URL, HARGA_URL, JOYOROGO_URL, setMeta } from "./lib";
import { PRIVASI_PATH, PrivasiPage } from "./Privasi";
import { ButtonLink, GithubMark, Phone, Ring } from "./ui";

/** Harga paket Founder JoyoRogo, sama dengan joyorogo.com/harga (api.joyorogo.com/api/config). */
const PRICE = { monthly: "Rp15.000", yearly: "Rp150.000" };

const FACTS = [
  { value: "35 model", label: "jam Huawei dan Honor bisa dicoba", href: "/jam" },
  { value: "Live", label: "detak, kkal, lemak dan karbo saat olahraga" },
  { value: "AGPL-3.0", label: "kode terbuka" },
  { value: "Lokal", label: "data di HP, cloud opsional" },
] as const;

const JAM_SUDAH_DIUJI = ["Huawei Watch Fit 4 Pro"] as const;

const JAM_EKSPERIMEN = ["Huawei Watch Fit 4", "Huawei Watch Fit 5", "Huawei Watch Fit 5 Pro", "Huawei Watch Fit 3", "Huawei Watch Fit 2", "Huawei Watch GT 2", "Huawei Watch GT 2 Pro", "Huawei Watch GT 3", "Huawei Watch GT 3 Pro", "Huawei Watch GT 3 SE", "Huawei Watch GT 4", "Huawei Watch GT 5", "Huawei Watch GT 5 Pro", "Huawei Watch GT 6", "Huawei Watch GT 6 Pro", "Huawei Watch GT 7", "Huawei Watch GT 7 Pro", "Huawei Watch GT Runner", "Huawei Watch GT Runner 2", "Huawei Watch GT Cyber", "Huawei Watch 3", "Huawei Watch 3 Pro", "Huawei Watch 4", "Huawei Watch 4 Pro", "Huawei Watch 5", "Huawei Watch D2", "Huawei Watch Ultimate", "Huawei Watch Ultimate 2", "Huawei TalkBand B6", "Honor MagicWatch 2", "Honor Watch GS 3", "Honor Watch GS Pro", "Honor Watch 4", "Honor Watch 4 Pro"] as const;

const JAM_BELUM_BLE = ["Huawei Watch Fit", "Huawei Watch GT", "Huawei Watch GT 2e", "Huawei Band 2", "Huawei Band 2 Pro", "Huawei Band 3", "Huawei Band 3 Pro", "Huawei Band 3e", "Huawei Band 4", "Huawei Band 4 Pro", "Huawei Band 4e", "Huawei Band 6", "Huawei Band 7", "Huawei Band 8", "Huawei Band 9", "Huawei Band 10", "Huawei Band 11", "Huawei Band 11 Pro", "Honor Band 3", "Honor Band 4", "Honor Band 5", "Honor Band 6", "Honor Band 7", "Honor Band 9", "Honor Band 10", "Honor Watch"] as const;

const JAM_BELUM_PAKE = ["Honor Watch 5", "Honor Watch 5 Pro", "Honor Watch 6"] as const;

const BASICS = [
  {
    icon: HeartPulse,
    tone: "bg-bakar-soft text-bakar-ink",
    title: "Langkah, detak jantung, SpO2",
    body: "Data per menit dari jam: langkah, kalori, jarak, detak jantung, detak istirahat, dan SpO2. Detak jantung langsung tampil selama layar Hari ini terbuka.",
  },
  {
    icon: Moon,
    tone: "bg-tidur-soft text-tidur-ink",
    title: "Tidur dengan tahapnya",
    body: "Awake, REM, ringan, dan dalam dari TruSleep, lengkap dengan skor tidur dari jam, bukan hitungan kami.",
  },
  {
    icon: Route,
    tone: "bg-makan-soft text-makan-ink",
    title: "Olahraga beserta rute",
    body: "Total, detak jantung, pace per bagian, dan jalur GPS yang digambar sebagai garis di layar. Tanpa peta pihak ketiga.",
  },
] as const;

const WATCH_FEATURES = [
  {
    icon: Bell,
    title: "Notifikasi",
    body: "Nama aplikasi, judul, dan isi diteruskan ke jam. Kamu pilih aplikasi mana saja.",
  },
  {
    icon: CloudSun,
    title: "Cuaca",
    body: "Kondisi sekarang dan prakiraan 24 jam serta 8 hari dari Open-Meteo, tanpa kunci API.",
  },
  {
    icon: AlarmClock,
    title: "Alarm",
    body: "Baca, ubah, tambah, dan hapus alarm jam dari HP, termasuk alarm pintar.",
  },
  {
    icon: BellRing,
    title: "Cari jam, cari HP",
    body: "Bunyikan jam dari HP, atau bunyikan HP dari jam, juga saat aplikasi di latar belakang.",
  },
] as const;

const PROMISES = [
  {
    icon: ShieldCheck,
    title: "Langsung ke HP",
    body: "Jam terhubung langsung lewat Bluetooth ke HP-mu. Huawei Health tidak perlu terpasang.",
  },
  {
    icon: Bluetooth,
    title: "Disimpan di HP dulu",
    body: "Data masuk ke database SQLite lokal. Tidak ada yang keluar sebelum kamu masuk ke cloud.",
  },
  {
    icon: Footprints,
    title: "Ekspor ke Health Connect",
    body: "Langkah, jarak, kalori, detak jantung, SpO2, tidur, dan olahraga bisa ditulis ke Health Connect untuk aplikasi lain.",
  },
] as const;

const LIVE: { Icon: LucideIcon; name: string; note: string }[] = [
  { Icon: HeartPulse, name: "Detak jantung realtime", note: "dari jam" },
  { Icon: Flame, name: "Kalori terbakar", note: "rumus Keytel" },
  { Icon: Droplet, name: "Lemak terbakar", note: "perkiraan per zona" },
  { Icon: Dumbbell, name: "Karbo terbakar", note: "perkiraan per zona" },
];

const FACES: { Icon: LucideIcon; name: string; note: string }[] = [
  { Icon: Palette, name: "Watch face", note: "Lihat, ganti, hapus, dan pasang file .hwt." },
  { Icon: Watch, name: "Kustomisasi", note: "Ubah gaya, latar, huruf, dan widget face bawaan." },
  { Icon: Download, name: "Face foto", note: "Pasang fotomu sendiri ke face foto." },
];

const FAQ = [
  {
    q: "Apakah saya perlu akun Huawei?",
    a: "Tidak. JoyoFit bicara langsung ke jam lewat Bluetooth Classic. Yang perlu kamu lakukan: lepaskan jam dari Huawei Health dulu, karena jam hanya bisa terpasang ke satu aplikasi dalam satu waktu.",
  },
  {
    q: "Jam apa saja yang didukung?",
    a: "Baru Huawei Watch Fit 4 Pro yang sudah diuji. Jam Huawei dan Honor lain yang memakai Bluetooth Classic masih eksperimen, dan jam Bluetooth LE (band, Watch Fit pertama, GT pertama) belum bisa. Daftar lengkapnya ada di bagian Jam yang didukung. Aplikasinya untuk Android 10 ke atas. Belum ada versi iPhone.",
  },
  {
    q: "Sudah stabil dipakai?",
    a: "Protokol jamnya porting dari Gadgetbridge dan lolos 222 tes JVM. Tapi sebagian fitur, seperti kustomisasi tampilan jam, kartu kalori, dan latihan lari terjadwal, masih ditandai belum terverifikasi di Fit 4 di dokumentasi proyek. Kami jujur soal itu; log lengkapnya ada di Pengaturan.",
  },
  {
    q: "Ke mana data saya pergi?",
    a: "Ke database lokal di HP. Dua pengecualian, dan keduanya hanya jika kamu menyalakannya: cuaca ke Open-Meteo (hanya koordinat yang dibulatkan sekitar 1 km), dan cloud JoyoFit setelah kamu masuk dengan akun JoyoRogo.",
  },
  {
    q: "Apa yang diunggah ke cloud?",
    a: "Sampel langkah, segmen tidur, olahraga beserta titik rutenya, dan data perangkat. Saat ini aplikasi hanya mengunggah; membaca balik dari cloud belum ada. Penghapusan, profil, alarm, dan pengaturan tidak disinkronkan.",
  },
  {
    q: "Bisa dipakai tanpa cloud sama sekali?",
    a: "Bisa. Cloud opsional. Tanpa itu semua fitur jam tetap jalan dan data tetap di HP-mu.",
  },
  {
    q: "Apa hubungannya dengan JoyoRogo?",
    a: "JoyoRogo adalah aplikasi catatan makan kami. Asupan kalori dari JoyoRogo bisa tampil di kartu kalori jam, skor Recovery dan Strain JoyoFit ikut tampil di catatan makan JoyoRogo, dan masuk ke cloud JoyoFit memakai akun JoyoRogo. JoyoFit tetap bisa dipakai sendiri tanpa JoyoRogo.",
  },
] as const;

function Check2({ className }: { className?: string }) {
  return <Check className={className} aria-hidden />;
}

function Header() {
  const link =
    "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";
  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-background/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 md:h-16 md:px-6">
        <a
          href="/"
          aria-label="JoyoFit, ke halaman utama"
          className="flex items-center gap-2 rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <img src="/brand/logo-mark.svg" alt="" className="h-7 w-auto md:h-8" />
          <span className="text-lg font-extrabold tracking-tight">JoyoFit</span>
        </a>
        <nav aria-label="Utama" className="hidden items-center gap-1 md:flex">
          <a href="/#fitur" className={link}>
            Fitur
          </a>
          <a href="/jam" className={link}>
            Jam
          </a>
          <a href="/#cara" className={link}>
            Tiga cara pakai
          </a>
          <a href="/#faq" className={link}>
            Tanya jawab
          </a>
          <a href={JOYOROGO_URL} className={link}>
            JoyoRogo
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener"
            aria-label="Kode JoyoFit di GitHub (open source)"
            className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <GithubMark className="size-5" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <ButtonLink href="/#cara">Mulai</ButtonLink>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  const link = "inline-flex min-h-11 items-center hover:text-primary";
  return (
    <footer className="border-t border-border/70">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:flex-row md:items-center md:justify-between md:px-6">
        <div>
          <p className="flex items-center gap-2 text-base font-extrabold tracking-tight">
            <img src="/brand/logo-mark.svg" alt="" className="h-6 w-auto" />
            JoyoFit
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <ShieldCheck className="size-4" aria-hidden />
            Dibuat di Malang oleh Dzulfikar. Turunan Gadgetbridge, lisensi AGPL-3.0.
          </p>
        </div>
        <nav aria-label="Tautan" className="flex flex-wrap gap-x-6 gap-y-1 text-sm font-semibold">
          <a href="/#cara" className={link}>
            Tiga cara pakai
          </a>
          <a href={HARGA_URL} className={link}>
            Harga
          </a>
          <a href={JOYOROGO_URL} className={link}>
            JoyoRogo
          </a>
          <a href={CLOUDAGNI_URL} className={link}>
            CloudAgni
          </a>
          <a href={GITHUB_URL} className={link}>
            Kode sumber
          </a>
          <a href={PRIVASI_PATH} className={link}>
            Privasi
          </a>
        </nav>
      </div>
    </footer>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
      {children}
    </h2>
  );
}

function Dot() {
  return (
    <span aria-hidden className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
  );
}

function Hero() {
  return (
    <section
      data-section="hero"
      className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-8 pb-14 md:grid-cols-[1.05fr_1fr] md:gap-8 md:px-6 md:pt-14 md:pb-20"
    >
      <div>
        <h1 className="max-w-xl text-[2.625rem] leading-[1.04] font-extrabold tracking-tight text-balance md:text-[4rem]">
          Jammu. Datamu. HP-mu.
        </h1>
        <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground md:text-xl">
          Pendamping jam Huawei yang jalan di HP sendiri. Langkah, detak jantung, tidur, dan olahraga
          ditarik langsung lewat Bluetooth dan disimpan di HP. Tanpa Huawei Health, cloud hanya kalau
          kamu mau.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <ButtonLink size="lg" href="#cara">
            Pilih cara pakai
          </ButtonLink>
          <ButtonLink size="lg" variant="secondary" href={GITHUB_URL} target="_blank" rel="noopener">
            <GithubMark className="size-[1.125rem]" />
            Lihat di GitHub
          </ButtonLink>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Gratis dan open source. Diuji di Huawei Watch Fit 4 Pro, jam lain eksperimen. Android 10 ke atas.
        </p>
      </div>

      <figure className="relative mx-auto w-full max-w-[22rem] md:max-w-[26rem]">
        <div
          aria-hidden
          className="absolute inset-x-4 top-10 bottom-6 rounded-[2.5rem] bg-makan-soft md:inset-x-0"
        />
        <Phone
          className="relative"
          src="/shots/today.webp"
          alt="Layar Hari ini di JoyoFit: jam terhubung, langkah, detak jantung 80 bpm, baterai 58 persen, dan tombol Sync now. Antarmuka aplikasi berbahasa Inggris."
        />
        <div
          className="relative z-10 mx-auto -mt-4 w-[13.5rem] rounded-[1.25rem] bg-card p-3.5 shadow-float md:absolute md:bottom-6 md:-left-20 md:mx-0 md:mt-0 md:w-60 md:animate-drift"
          role="img"
          aria-label="Skor tidur 84 dari jam, tidur 6 jam 45 menit."
        >
          <p className="flex items-center gap-1.5 text-[0.6875rem] font-bold text-muted-foreground">
            <Moon className="size-3.5" aria-hidden />
            Tidur semalam
          </p>
          <div className="mt-2 flex items-center gap-3">
            <Ring value={84} max={100} tone="tidur" size={64} stroke={7} label="Skor tidur 84">
              <span className="text-base leading-none font-extrabold tabular-nums">84</span>
            </Ring>
            <div>
              <p className="text-xl leading-none font-extrabold tracking-tight tabular-nums">6 j 45 mnt</p>
              <p className="mt-1 text-xs text-muted-foreground">skor dari jam</p>
            </div>
          </div>
        </div>
      </figure>
    </section>
  );
}

function Facts() {
  return (
    <section aria-label="Fakta singkat" className="border-y border-border/70 bg-card">
      <dl className="mx-auto grid w-full max-w-6xl grid-cols-2 px-4 md:grid-cols-4 md:px-6">
        {FACTS.map((fact, i) => (
          <div
            key={fact.value}
            className={`py-6 md:py-8 ${i % 2 === 1 ? "pl-5 md:pl-8" : i > 0 ? "md:pl-8" : ""} ${i > 0 ? "md:border-l md:border-border/70" : ""} ${i % 2 === 1 ? "border-l border-border/70" : ""} ${i > 1 ? "border-t border-border/70 md:border-t-0" : ""}`}
          >
            <dd>
              {"href" in fact ? (
                <a href={fact.href} className="block rounded-lg hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none">
                  <span className="block text-2xl font-extrabold tracking-tight tabular-nums underline decoration-border decoration-2 underline-offset-4 md:text-3xl">
                    {fact.value}
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">{fact.label}</span>
                </a>
              ) : (
                <>
                  <span className="block text-2xl font-extrabold tracking-tight tabular-nums md:text-3xl">
                    {fact.value}
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">{fact.label}</span>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Basics() {
  return (
    <section
      id="fitur"
      data-section="basics"
      className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-20 md:px-6 md:py-28"
    >
      <div className="max-w-2xl">
        <SectionTitle>Semua data jammu, di HP-mu.</SectionTitle>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Sinkron pertama menarik 7 hari terakhir, sinkron berikutnya lanjut dari terakhir. Mode
          latar belakang menjaga jam tetap terhubung dan menyinkron tiap 30 menit.
        </p>
      </div>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {BASICS.map((item) => (
          <article key={item.title} className="flex items-start gap-5 rounded-[1.75rem] bg-card p-5 md:block md:p-7">
            <span className={`flex size-14 shrink-0 items-center justify-center rounded-full ${item.tone}`}>
              <item.icon className="size-7" aria-hidden />
            </span>
            <div>
              <h3 className="text-xl font-extrabold tracking-tight md:mt-6">{item.title}</h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">{item.body}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SleepSection() {
  return (
    <section data-section="sleep" className="scroll-mt-16 bg-card py-20 md:py-28">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 md:grid-cols-[1fr_1.05fr] md:gap-16 md:px-6">
        <div>
          <SectionTitle>Tidur lengkap dengan tahapnya</SectionTitle>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            Tahap tidur dari TruSleep dan skor tidur yang dihitung jam sendiri, ditampilkan per malam
            dengan garis waktu tahapnya.
          </p>
          <ol className="mt-8 space-y-5">
            {[
              ["Pakai jam tidur", "Nyalakan sensor detak jantung, SpO2, dan TruSleep di Pengaturan. Aplikasi menyalakannya di jam tiap kali tersambung."],
              ["Sinkron pagi hari", "Tekan Sync now, atau biarkan mode latar belakang yang bekerja."],
              ["Lihat malammu", "Durasi tidur, persen tiap tahap, dan skor dari jam."],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-primary-foreground tabular-nums">
                  {i + 1}
                </span>
                <div>
                  <p className="font-bold">{title}</p>
                  <p className="mt-0.5 text-[0.9375rem] leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-8 rounded-2xl border border-border/70 bg-background p-5">
            <p className="flex items-center gap-2 font-bold">
              <Check2 className="size-5 text-primary" />
              Angka dari jam, bukan angka ajaib
            </p>
            <ul className="mt-3 space-y-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
              <li className="flex gap-2.5">
                <Dot />
                Skor tidur dikirim jam; aplikasi tidak membuat skor sendiri.
              </li>
              <li className="flex gap-2.5">
                <Dot />
                Tahap tidur mengikuti kemampuan jam, sama seperti di Gadgetbridge.
              </li>
            </ul>
          </div>
        </div>
        <div>
          <Phone
            src="/shots/sleep.webp"
            alt="Layar Tidur di JoyoFit: 6 jam 45 menit, skor 84, tahap Awake, REM, Light, dan Deep beserta grafik tahap sepanjang malam. Antarmuka berbahasa Inggris."
          />
        </div>
      </div>
    </section>
  );
}

function Workouts() {
  return (
    <section
      data-section="workouts"
      className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-20 md:grid-cols-[1.05fr_1fr] md:gap-16 md:px-6 md:py-28"
    >
      <div className="md:order-2">
        <SectionTitle>Olahraga langsung, lemak dan karbo ikut terhitung</SectionTitle>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Latihan di jam masuk sebagai sesi lengkap. Saat latihan jalan, JoyoFit mengikuti detak
          jantung realtime dari jam dan memperkirakan kalori serta berapa dari lemak dan karbohidrat.
        </p>
        <ul className="mt-6 space-y-2.5">
          {[
            "Mulai otomatis saat jam meminta GPS, atau mulai sendiri dari HP",
            "Kalori dengan rumus Keytel dari detak jantung",
            "Lemak dan karbo terbakar, diperkirakan per zona detak jantung",
            "Rute GPS dari HP untuk latihan di jam, digambar sebagai garis",
          ].map((line) => (
            <li key={line} className="flex gap-2.5 text-[0.9375rem]">
              <Check className="mt-0.5 size-[1.125rem] shrink-0 text-primary" aria-hidden />
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-6 rounded-2xl bg-muted p-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
          <span className="font-bold text-foreground">Perkiraan, bukan hasil lab.</span> Angka lemak
          dan karbo adalah estimasi dari detak jantung, jangan dipakai sebagai nasihat medis.
        </p>
      </div>
      <div className="md:order-1">
        <article className="rounded-[1.75rem] bg-bakar-soft p-6 md:p-8">
          <h3 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-bakar-ink">
            <Flame className="size-6" aria-hidden />
            Latihan berjalan
          </h3>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-bakar-ink/80">
            Yang dilacak selama sesi aktif, dari detak jantung jam.
          </p>
          <ul className="mt-6 grid gap-2 sm:grid-cols-2">
            {LIVE.map(({ Icon, name, note }) => (
              <li key={name} className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-bakar-soft text-bakar-ink">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm leading-snug font-bold">{name}</span>
                  <span className="block text-xs text-muted-foreground">{note}</span>
                </span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}

const SCORES: { Icon: LucideIcon; name: string; line: string; method: string; tone: string }[] = [
  {
    Icon: Moon,
    name: "Recovery",
    line: "Seberapa pulih badanmu pagi ini, dalam persen.",
    method: "HRV (ln RMSSD) malam ini dibanding baseline 30 harinya, mengikuti Plews dan Buchheit.",
    tone: "bg-tidur-soft text-tidur-ink",
  },
  {
    Icon: Flame,
    name: "Strain",
    line: "Seberapa berat hari ini untuk jantungmu, skala 0 sampai 21.",
    method: "TRIMP Edwards dari zona detak jantung seharian, dipetakan ke skala 0 sampai 21.",
    tone: "bg-bakar-soft text-bakar-ink",
  },
  {
    Icon: HeartPulse,
    name: "Readiness",
    line: "Siap atau perlu santai hari ini.",
    method: "Selisih detak istirahat dari biasanya, tidur dibanding kebutuhan, dan beban latihan 7 hari lawan 28 hari.",
    tone: "bg-makan-soft text-makan-ink",
  },
];

function Scores() {
  return (
    <section data-section="scores" className="scroll-mt-16 bg-card py-20 md:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
        <div className="max-w-2xl">
          <p className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
            Baru, masih diuji
          </p>
          <SectionTitle>Recovery, Strain, dan Readiness</SectionTitle>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            Tiga skor harian gaya aplikasi pelatih kebugaran, terinspirasi dari WHOOP tapi bukan
            produk WHOOP. Semuanya dihitung di HP dari data jammu dengan metode yang dipublikasikan.
          </p>
        </div>
        <ul className="mt-10 grid gap-4 md:grid-cols-3">
          {SCORES.map(({ Icon, name, line, method, tone }) => (
            <li key={name} className="rounded-[1.75rem] border border-border/70 bg-background p-6">
              <span className={`flex size-10 items-center justify-center rounded-full ${tone}`}>
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-xl font-extrabold tracking-tight">{name}</h3>
              <p className="mt-1 font-semibold">{line}</p>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">{method}</p>
            </li>
          ))}
        </ul>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <p className="rounded-2xl bg-muted p-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
            <span className="font-bold text-foreground">Recovery butuh beberapa malam data.</span>{" "}
            Nyalakan stres otomatis di jam supaya HRV tercatat saat tidur. Sebelum baseline cukup,
            skornya belum muncul.
          </p>
          <p className="rounded-2xl bg-muted p-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
            <span className="font-bold text-foreground">Ukur HRV 1 menit kapan saja.</span> Diam
            sebentar, jam mengukur, hasilnya ikut jadi bahan Recovery. Ini perkiraan, bukan alat
            medis.
          </p>
        </div>
        <p className="mt-4 rounded-2xl bg-makan-soft p-4 text-[0.9375rem] leading-relaxed text-makan-ink">
          <span className="font-bold">Juga di JoyoRogo.</span> Kalau kamu masuk dengan akun{" "}
          <a href={JOYOROGO_URL} className="font-bold underline underline-offset-2">
            JoyoRogo
          </a>
          , skor harian ikut tampil di catatan makanmu, lengkap dengan saran singkat. Misalnya saat
          Strain tinggi, kebutuhan energi dan karbohidratmu lebih besar dari biasa. Saat Recovery
          rendah, utamakan protein, cairan, dan tidur.
        </p>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section
      data-section="features"
      className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-20 md:grid-cols-[1.4fr_1fr] md:px-6 md:py-28"
    >
      <article className="rounded-[1.75rem] bg-makan-soft p-6 md:p-8">
        <h3 className="text-2xl font-extrabold tracking-tight text-makan-ink">
          Makan di JoyoRogo, gerak di JoyoFit
        </h3>
        <p className="mt-2 max-w-md text-[0.9375rem] leading-relaxed text-makan-ink/80">
          JoyoRogo mencatat makananmu dari foto. Asupan kalorinya bisa dikirim ke kartu kalori di
          jam, dan skor harian JoyoFit kembali ke catatan makanmu. JoyoFit tetap bisa dipakai tanpa
          JoyoRogo.
        </p>
        <ul className="mt-6 grid gap-2 sm:grid-cols-3">
          {[
            ["Kartu kalori", "asupan dari JoyoRogo"],
            ["Skor harian", "Recovery dan Strain di JoyoRogo"],
            ["Satu akun", "masuk cloud JoyoFit dengan akun JoyoRogo"],
          ].map(([name, note]) => (
            <li key={name} className="rounded-2xl bg-card px-4 py-3.5">
              <p className="text-sm leading-snug font-semibold">{name}</p>
              <p className="mt-1.5 text-xs font-semibold text-makan-ink">{note}</p>
            </li>
          ))}
        </ul>
        <a
          href={JOYOROGO_URL}
          className="group mt-6 flex items-center gap-4 rounded-2xl bg-card p-3 pr-5 transition-colors hover:bg-background focus-visible:ring-2 focus-visible:ring-makan-ink focus-visible:outline-none"
        >
          <img src="/brand/joyorogo-icon.png" alt="" className="size-14 shrink-0 rounded-xl" />
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-extrabold tracking-tight">Coba JoyoRogo</span>
            <span className="block text-sm text-muted-foreground">
              Catat makanmu cukup dari foto
            </span>
          </span>
          <ArrowRight className="size-5 shrink-0 text-makan-ink transition-transform group-hover:translate-x-0.5" aria-hidden />
        </a>
        <p className="mt-4 text-xs text-makan-ink/70">
          Kartu kalori dibuat dari hasil reverse engineering Huawei Health dan belum diuji di Fit 4
          Pro.
        </p>
      </article>

      <article className="rounded-[1.75rem] bg-card p-6 md:p-8">
        <h3 className="text-2xl font-extrabold tracking-tight">Tampilan jam sendiri</h3>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
          Atur tampilan jam dari HP.
        </p>
        <ul className="mt-6 space-y-3">
          {FACES.map(({ Icon, name, note }) => (
            <li key={name} className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-bakar-soft text-bakar-ink">
                <Icon className="size-5" aria-hidden />
              </span>
              <span>
                <span className="block text-[0.9375rem] font-bold">{name}</span>
                <span className="block text-sm text-muted-foreground">{note}</span>
              </span>
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}

function WatchSection() {
  return (
    <section data-section="watch" className="scroll-mt-16 bg-tidur-soft py-20 md:py-28">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 md:grid-cols-[1.05fr_1fr] md:gap-16 md:px-6">
        <div>
          <SectionTitle>Jam yang ikut bekerja untukmu.</SectionTitle>
          <p className="mt-4 text-lg leading-relaxed text-tidur-ink/90">
            Notifikasi, cuaca, alarm, dan cari jam. Cukup nyalakan mode latar belakang, JoyoFit
            menjaga jam tetap tersambung.
          </p>
          <ul className="mt-8 space-y-5">
            {WATCH_FEATURES.map((feature) => (
              <li key={feature.title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card text-tidur-ink">
                  <feature.icon className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="font-bold">{feature.title}</p>
                  <p className="mt-0.5 text-[0.9375rem] leading-relaxed text-tidur-ink/80">{feature.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <Phone
          src="/shots/watch.webp"
          alt="Layar Watch di JoyoFit: Watch faces, Photo face, Alarms, dan tombol Ring the watch untuk mencari jam. Antarmuka berbahasa Inggris."
        />
      </div>
    </section>
  );
}

function Chips({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-4 flex flex-wrap gap-2">
      {items.map((m) => (
        <li key={m} className="rounded-full bg-muted px-3 py-1 text-sm font-medium text-foreground">
          {m}
        </li>
      ))}
    </ul>
  );
}

function JamTeaser() {
  return (
    <section data-section="jam" className="border-t border-border/70 py-14 md:py-16">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 md:flex-row md:items-center md:justify-between md:px-6">
        <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
          Diuji di Watch Fit 4 Pro, puluhan jam Huawei dan Honor lain bisa dicoba.
        </p>
        <ButtonLink variant="secondary" className="shrink-0" href={JAM_PATH}>
          Lihat daftar jam
        </ButtonLink>
      </div>
    </section>
  );
}

function Promises() {
  return (
    <section aria-label="Janji privasi" className="border-y border-border/70 bg-card">
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-10 sm:grid-cols-3 md:px-6 md:py-12">
        {PROMISES.map((promise) => (
          <div key={promise.title} className="flex items-start gap-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-makan-soft text-makan-ink">
              <promise.icon className="size-5" aria-hidden />
            </span>
            <div>
              <p className="font-bold">{promise.title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{promise.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-md bg-muted px-1.5 py-0.5 text-[0.85em] font-semibold text-foreground">
      {children}
    </code>
  );
}

function Options() {
  return (
    <section id="cara" data-section="options" className="scroll-mt-16 border-t border-border/70 py-20 md:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
        <div className="max-w-2xl">
          <SectionTitle>Tiga cara memakai JoyoFit</SectionTitle>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            Aplikasinya selalu gratis dan terbuka. Yang berbeda hanya di mana datamu dicadangkan.
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {/* 1. Open source */}
          <section className="flex flex-col rounded-[1.75rem] bg-card p-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold">Open source</h3>
              <span className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-xs font-bold text-muted-foreground">
                AGPL-3.0
              </span>
            </div>
            <p className="mt-3 text-4xl font-extrabold tracking-tight">Rp0</p>
            <p className="text-sm text-muted-foreground">selamanya</p>
            <ul className="mt-5 space-y-2.5 text-sm">
              {[
                "Seluruh kode di GitHub, termasuk protokol jam",
                "Bangun APK sendiri dan pasang di HP",
                "Data tetap di HP, tanpa cloud",
              ].map((line) => (
                <li key={line} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  {line}
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-6">
              <ButtonLink variant="secondary" className="w-full" href={GITHUB_URL} target="_blank" rel="noopener">
                <GithubMark className="size-4" />
                Buka GitHub
              </ButtonLink>
            </div>
          </section>

          {/* 2. Self-host on CloudAgni */}
          <section className="flex flex-col rounded-[1.75rem] bg-card p-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold">Cloud sendiri di CloudAgni</h3>
              <span className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-xs font-bold text-muted-foreground">
                Self-host
              </span>
            </div>
            <p className="mt-3 text-4xl font-extrabold tracking-tight">Milikmu</p>
            <p className="text-sm text-muted-foreground">server, D1, dan R2 di akunmu</p>
            <ul className="mt-5 space-y-2.5 text-sm">
              {[
                "Worker joyofit-api dari folder server/",
                "Cadangan di database yang kamu kendalikan",
                "Platform edge Indonesia kompatibel Workers",
              ].map((line) => (
                <li key={line} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  {line}
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-6">
              <ButtonLink variant="secondary" className="w-full" href={SELF_HOST_PATH}>
                <Server aria-hidden />
                Lihat langkahnya
              </ButtonLink>
            </div>
          </section>

          {/* 3. JoyoFit Cloud via JoyoRogo Premium */}
          <section className="flex flex-col rounded-[1.75rem] bg-makan-soft p-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold text-makan-ink">JoyoFit Cloud</h3>
              <span className="inline-flex h-6 items-center rounded-full bg-card px-2.5 text-xs font-bold text-makan-ink">
                JoyoRogo Premium
              </span>
            </div>
            <p className="mt-3 text-4xl font-extrabold tracking-tight tabular-nums">{PRICE.monthly}</p>
            <p className="text-sm text-muted-foreground">per bulan</p>
            <p className="mt-0.5 text-xs font-semibold text-makan-ink">
              atau {PRICE.yearly}/tahun, hemat 2 bulan
            </p>
            <ul className="mt-5 space-y-2.5 text-sm">
              {[
                "Termasuk di JoyoRogo Premium (paket Founder)",
                "Server kami yang urus, tanpa setup",
                "Masuk dengan akun JoyoRogo yang sama",
              ].map((line) => (
                <li key={line} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-makan-ink" aria-hidden />
                  {line}
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-center gap-2 text-sm">
              <span className="rounded-full bg-card px-2 py-0.5 text-xs font-bold text-makan-ink">
                Segera
              </span>
              Olahraga otomatis terkirim ke Strava
            </p>
            <div className="mt-auto pt-6">
              <ButtonLink className="w-full" href={HARGA_URL}>
                Langganan JoyoRogo Premium
              </ButtonLink>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Harga dan paket mengikuti joyorogo.com/harga.
              </p>
            </div>
          </section>
        </div>

      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" data-section="faq" className="mx-auto w-full max-w-3xl scroll-mt-16 px-4 pt-20 pb-20 md:px-6 md:pb-28">
      <h2 className="text-3xl font-extrabold tracking-tight md:text-[2.75rem] md:leading-[1.1]">
        Pertanyaan yang sering muncul
      </h2>
      <div className="mt-8 divide-y divide-border/70 rounded-[1.75rem] bg-card">
        {FAQ.map((item) => (
          <details key={item.q} className="group px-5 md:px-6">
            <summary className="-mx-2 flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-2 py-4 text-[1.0625rem] font-bold focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
              {item.q}
              <ChevronDown
                className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                aria-hidden
              />
            </summary>
            <p className="pb-5 text-[0.9375rem] leading-relaxed text-muted-foreground">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function OpenSource() {
  return (
    <section data-section="opensource" className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-6">
      <div className="flex flex-col gap-5 rounded-[1.75rem] bg-card p-6 md:flex-row md:items-center md:justify-between md:p-8">
        <div className="flex gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-muted text-foreground">
            <GithubMark className="size-6" />
          </span>
          <div>
            <h2 className="text-xl font-extrabold tracking-tight md:text-2xl">
              Kodenya terbuka, bisa kamu cek sendiri
            </h2>
            <p className="mt-1 max-w-xl text-[0.9375rem] leading-relaxed text-muted-foreground">
              Seluruh kode JoyoFit ada di GitHub dengan lisensi AGPL-3.0-or-later, termasuk modul
              protokol yang porting dari Gadgetbridge. Ada yang salah di jammu? Buka issue dan
              lampirkan log dari Pengaturan.
            </p>
          </div>
        </div>
        <ButtonLink variant="outline" className="shrink-0" href={GITHUB_URL} target="_blank" rel="noopener">
          <GithubMark className="size-4" />
          Lihat di GitHub
        </ButtonLink>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section data-section="signup" className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-6">
      <div className="rounded-[2rem] bg-primary px-6 py-12 text-center text-primary-foreground md:px-14 md:py-16">
        <h2 className="mx-auto max-w-xl text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
          Pindahkan data jammu ke HP hari ini
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-primary-foreground/80">
          Pasang JoyoFit, sambungkan jam lewat Bluetooth, dan data jammu ada di HP-mu hari ini juga.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink
            size="lg"
            className="bg-primary-foreground text-primary hover:bg-primary-foreground/90 focus-visible:ring-primary-foreground/50"
            href={GITHUB_URL}
            target="_blank"
            rel="noopener"
          >
            <GithubMark className="size-[1.125rem]" />
            Ambil dari GitHub
          </ButtonLink>
          <ButtonLink
            size="lg"
            variant="ghost"
            className="border-primary-foreground/35 text-primary-foreground hover:bg-primary-foreground/10 focus-visible:ring-primary-foreground/50"
            href="#cara"
          >
            Bandingkan tiga cara
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}

const SELF_HOST_PATH = "/self-host";

const SELF_HOST_META = {
  title: "Pasang cloud JoyoFit di CloudAgni sendiri",
  description:
    "Panduan memasang server cloud JoyoFit (Cloudflare Worker, D1, R2) di CloudAgni. Datamu tetap di akunmu sendiri.",
};

function SelfHostPage() {
  useEffect(() => {
    const { title, description } = SELF_HOST_META;
    const url = `https://fit.joyorogo.com${SELF_HOST_PATH}`;
    document.title = `${title} | JoyoFit`;
    setMeta('meta[name="description"]', "content", description);
    setMeta('link[rel="canonical"]', "href", url);
    setMeta('meta[property="og:url"]', "content", url);
    setMeta('meta[property="og:title"]', "content", title);
    setMeta('meta[property="og:description"]', "content", description);
    setMeta('meta[name="twitter:title"]', "content", title);
    setMeta('meta[name="twitter:description"]', "content", description);
    window.scrollTo(0, 0);
  }, []);

  return (
    <section data-section="self-host" className="py-12 md:py-16">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
        <a
          href="/#cara"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Kembali ke tiga cara pakai
        </a>
        <div className="mt-4 rounded-[1.75rem] bg-card p-6 md:p-8">
          <div className="flex gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-muted text-foreground">
              <Cloud className="size-6" aria-hidden />
            </span>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight md:text-4xl">
                Pasang cloud JoyoFit di CloudAgni
              </h1>
              <p className="mt-1 max-w-2xl text-[0.9375rem] leading-relaxed text-muted-foreground">
                Cloud JoyoFit adalah satu Cloudflare Worker (Hono) dengan database D1 dan bucket R2.
                CloudAgni menjalankan Worker semacam itu dan membuatkan D1 dan R2 dari konfigurasinya.
              </p>
            </div>
          </div>
          <ol className="mt-8 grid gap-6 md:grid-cols-2">
            {[
              [
                "Ambil kodenya",
                <>
                  Klon <Code>github.com/dzulfikar08/joyofit</Code> dan masuk ke folder{" "}
                  <Code>server/</Code>. Konfigurasinya ada di <Code>wrangler.jsonc</Code>: Worker{" "}
                  <Code>joyofit-api</Code>, D1 <Code>DB</Code> (<Code>joyofit</Code>), R2{" "}
                  <Code>IMPORTS</Code> (<Code>joyofit-imports</Code>).
                </>,
              ],
              [
                "Siapkan database",
                <>
                  Skema D1 ada di <Code>migrations/</Code> dan ikut dipasang saat deploy. Ganti{" "}
                  <Code>database_id</Code> dengan milikmu bila deploy memakai Wrangler.
                </>,
              ],
              [
                "Kirim ke CloudAgni",
                <>
                  Login ke <a className="font-semibold text-primary hover:underline" href={CLOUDAGNI_URL}>CloudAgni</a>, lalu
                  jalankan <Code>agni publish ./</Code> dari <Code>server/</Code>. Pack CloudAgni
                  memakai skrip <Code>build</Code> di <Code>package.json</Code>, jadi tambahkan satu
                  yang sederhana bila belum ada.
                </>,
              ],
              [
                "Isi variabel, lalu arahkan aplikasi",
                <>
                  Biarkan <Code>JOYOROGO_AUTH_URL</Code> di <Code>https://api.joyorogo.com</Code>
                  (login tetap lewat akun JoyoRogo). Bangun APK dengan{" "}
                  <Code>EXPO_PUBLIC_JOYOFIT_CLOUD_URL=https://alamat-workermu</Code>.
                </>,
              ],
            ].map(([title, body], i) => (
              <li key={title as string} className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-primary-foreground tabular-nums">
                  {i + 1}
                </span>
                <div>
                  <p className="font-bold">{title as string}</p>
                  <p className="mt-0.5 text-[0.9375rem] leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

const JAM_PATH = "/jam";

const JAM_META = {
  title: "Jam yang didukung JoyoFit",
  description:
    "Daftar jam Huawei dan Honor untuk JoyoFit: sudah diuji di Watch Fit 4 Pro, eksperimen, dan yang belum bisa. Cara mengirim laporan dukungan.",
};

function JamPage() {
  useEffect(() => {
    const { title, description } = JAM_META;
    const url = `https://fit.joyorogo.com${JAM_PATH}`;
    document.title = `${title} | JoyoFit`;
    setMeta('meta[name="description"]', "content", description);
    setMeta('link[rel="canonical"]', "href", url);
    setMeta('meta[property="og:url"]', "content", url);
    setMeta('meta[property="og:title"]', "content", title);
    setMeta('meta[property="og:description"]', "content", description);
    setMeta('meta[name="twitter:title"]', "content", title);
    setMeta('meta[name="twitter:description"]', "content", description);
    window.scrollTo(0, 0);
  }, []);

  return (
    <section data-section="jam" className="py-12 md:py-16">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
        <a
          href="/"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Kembali ke beranda
        </a>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
          Jam yang didukung
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Baru Huawei Watch Fit 4 Pro yang sudah kami uji. Jam lain di daftar Gadgetbridge masih
          eksperimen: sambungannya sama, tapi belum pernah dicoba dengan JoyoFit.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-[1.75rem] bg-makan-soft p-6">
            <h3 className="text-xl font-extrabold tracking-tight">Sudah diuji</h3>
            <p className="mt-2 text-sm text-muted-foreground">Dicek langsung di jam asli.</p>
            <Chips items={JAM_SUDAH_DIUJI} />
          </div>
          <div className="rounded-[1.75rem] bg-card p-6">
            <h3 className="text-xl font-extrabold tracking-tight">Eksperimen</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Bluetooth Classic, belum pernah dicoba. Sebagian fitur mungkin tidak jalan.
            </p>
            <Chips items={JAM_EKSPERIMEN} />
          </div>
          <div className="rounded-[1.75rem] bg-card p-6">
            <h3 className="text-xl font-extrabold tracking-tight">Belum bisa</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Bluetooth LE: JoyoFit belum punya jalur BLE.
            </p>
            <Chips items={JAM_BELUM_BLE} />
            <p className="mt-5 text-sm text-muted-foreground">
              Pairing baru Honor belum diimplementasi:
            </p>
            <Chips items={JAM_BELUM_PAKE} />
            <p className="mt-5 text-sm text-muted-foreground">
              Earphone (FreeBuds dan sejenisnya) bukan jam.
            </p>
          </div>
        </div>
        <p className="mt-6 max-w-3xl text-[0.9375rem] leading-relaxed text-muted-foreground">
          Jam Huawei atau Honor yang tidak ada di daftar tetap dicoba, tapi mungkin tidak jalan.
          Punya jam eksperimen? Sambungkan sekali, lalu di aplikasi buka tab Watch, pilih Help
          support your watch, dan ketuk Report on GitHub. Aplikasi membuka GitHub issue yang sudah
          terisi, dan laporan lengkapnya disalin ke clipboard untuk ditempel di kolom Log. Laporannya
          teks biasa tanpa alamat Bluetooth dan nomor seri. Daftar issue ada di{" "}
          <a
            href={`${GITHUB_URL}/issues`}
            target="_blank"
            rel="noopener"
            className="font-semibold text-foreground underline underline-offset-4"
          >
            GitHub
          </a>
          .
        </p>
      </div>
    </section>
  );
}

export function App() {
  const path = window.location.pathname.replace(/\/+$/, "");
  const selfHost = path === SELF_HOST_PATH;
  const jam = path === JAM_PATH;
  const privasi = path === PRIVASI_PATH;
  return (
    <div className="min-h-svh">
      <Header />
      <main>
        {selfHost ? (
          <SelfHostPage />
        ) : jam ? (
          <JamPage />
        ) : privasi ? (
          <PrivasiPage />
        ) : (
          <>
            <Hero />
            <Facts />
            <Basics />
            <SleepSection />
            <Workouts />
            <Scores />
            <Features />
            <WatchSection />
            <JamTeaser />
            <Promises />
            <Options />
            <Faq />
            <OpenSource />
            <Closing />
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
