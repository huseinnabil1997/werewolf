# Werewolf: Awas Malam

Game Werewolf berbahasa Indonesia untuk HP (mobile-first, 360 sampai 430 px). Dua mode:

- **Main Online**: tiap pemain memakai HP sendiri. Gabung lewat kode room 5 huruf, link `?room=KODE`, atau QR (dibuat di browser). Wajib login.
- **Main Lokal**: satu HP diputar bergiliran (pass-and-play). Tanpa login, tidak dicatat.

Situs: https://huseinnabil1997.github.io/werewolf/

## Aturan

- Peran: **Werewolf**, **Warga**, **Peramal** (melihat satu pemain tiap malam: werewolf atau bukan), **Dokter** (melindungi satu pemain tiap malam, tidak boleh orang yang sama dua malam berturut-turut, boleh diri sendiri).
- Komposisi otomatis: 4 sampai 5 pemain 1 werewolf, 6 sampai 8 dua, 9 sampai 11 tiga, 12 ke atas empat. Peramal mulai 4 pemain, Dokter mulai 5 pemain. Host bisa mengatur manual (werewolf harus kurang dari separuh pemain). 4 sampai 20 pemain. Yang gabung saat game berjalan menonton dan ikut di game berikutnya.
- Alur: pembagian peran (kartu dibalik) > **malam** (werewolf memilih korban bersama, Peramal melihat, Dokter melindungi) > **pagi** (korban diumumkan beserta perannya) > **diskusi** (timer opsional) > **voting** > hasil > malam berikutnya.
- Werewolf harus **sepakat** satu korban; malam online selesai otomatis saat semua pelaku malam sudah beraksi dan werewolf sepakat. Host bisa mengakhiri malam lebih awal: suara werewolf terbanyak menang, seri diundi, tanpa pilihan berarti tidak ada korban.
- Voting: pilih satu pemain atau **Lewati**. Tereliminasi hanya jika satu pemain unggul sendiri **dan** suaranya lebih banyak dari jumlah Lewati. Seri di posisi teratas berarti tidak ada yang tereliminasi.
- Menang: warga menang bila semua werewolf tewas; werewolf menang bila jumlahnya sama atau lebih banyak dari sisa pemain lain. Pemain tewas menonton sampai selesai.

## Akun, profil, dan statistik (Supabase)

- Login username + password. Supabase Auth butuh email, jadi username diubah menjadi email sintetis `<username>@werewolf.local` yang tidak pernah dikirimi surat.
- Username 3 sampai 20 karakter (huruf, angka, `_`), unik tanpa beda besar kecil (email unik di Auth + indeks unik `lower(username)` di `profil`). Password minimal 6 karakter.
- Profil dibuat otomatis oleh trigger saat akun dibuat. Menu **Profil**: total main, menang, winrate, menang/main per peran, 10 riwayat terakhir.
- Hasil online dicatat **host** lewat RPC `catat_hasil_room` untuk anggota room saja (4 sampai 20 baris, sekali per permainan per akun). Pemain tidak bisa menulis riwayat sendiri.
- Kunci di kode hanya kunci **publishable** (`lib/supabase/konfig.ts`), bisa diganti lewat `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- **Pengaturan project wajib**: Authentication > Sign In / Providers > Email > matikan **Confirm email**. Jika masih menyala, pendaftaran ditolak (email sintetis tidak bisa dikirimi surat) dan aplikasi menampilkan pesan yang menjelaskan hal ini.

## Mode online: arsitektur dan kerahasiaan

- Host otoritatif: HP host menjalankan aturan game (`lib/game.ts` + `lib/online/protokol.ts`) dan menyimpan state di localStorage (pulih setelah refresh).
- Transport: Supabase Realtime broadcast di kanal **privat** dengan RLS di `realtime.messages`:
  - `ww:KODE`: semua anggota room menerima, **hanya host** yang boleh mengirim. Berisi view publik saja.
  - `ww:KODE:<user_id>`: hanya pemain itu dan host. Berisi view pribadi (peran, rekan werewolf, pilihan tim werewolf, hasil Peramal, chat werewolf) dan aksi pemain ke host.
- View publik tidak pernah memuat peran pemain yang masih hidup, aksi malam, hasil Peramal, atau chat werewolf. Peran dibuka hanya untuk pemain yang tewas dan saat game selesai. Rincian suara dibuka setelah voting selesai.
- Keanggotaan room lewat RPC (`buat_room`, `gabung_room`, `daftar_anggota`, `keluar_room`); tabel room tidak bisa diakses langsung. Room kedaluwarsa 6 jam (diperpanjang host).
- Reconnect: sesi room disimpan di perangkat. Setelah refresh, pemain bergabung lagi otomatis dan meminta ulang view-nya; host memulihkan state dari localStorage.
- Batasan v1: host adalah pihak yang dipercaya. HP host memproses semua aksi, jadi host yang memodifikasi aplikasi bisa melihat rahasia atau memalsukan hasil di room-nya. Belum ada pindah host otomatis (host harus kembali) dan belum ada jalur cadangan P2P (PeerJS).

## Animasi

Gaya gerak terinspirasi dari [overrrides.com](https://overrrides.com/) (situs Framer: pegas `stiffness 400, damping 30`, Text Scramble, Mask Reveal, Ticker dengan tepi memudar, Card Tilt, Countdown, chip label dan nomor katalog di kaki kartu, font piksel + mono). Semua kode dan aset di sini orisinal, memakai [Motion](https://motion.dev) (MIT) dan font gratis SIL OFL (Silkscreen, JetBrains Mono). Tema dibuat muram: langit malam dengan bulan, bintang, kabut, dan butiran film; fajar untuk siang; kartu peran dibalik 3D; teks muncul bergiliran dari balik mask. `prefers-reduced-motion` dihormati (`MotionConfig reducedMotion="user"`, scramble dan animasi CSS dimatikan).

## Pengembangan

```bash
npm ci
npm run dev        # http://localhost:3000/werewolf
npm run lint
npm test           # vitest: logika game, protokol/kerahasiaan view, akun
npm run build      # static export ke out/
```

Deploy otomatis ke GitHub Pages lewat `.github/workflows/deploy.yml` setiap push ke `master` (Settings > Pages > Source: GitHub Actions). Skema database di `supabase/migrations`.
