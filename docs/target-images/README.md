# Flowline target images

Artefak ini adalah target visual untuk iterasi UI berikutnya. Ini bukan screenshot
produksi dan bukan bukti bahwa state tersebut sudah diimplementasikan. SVG dipakai
secara sengaja supaya teks, grid, warna, dan ukuran tetap presisi serta mudah
diterjemahkan ke React/CSS tanpa ketergantungan gambar generatif.

## Deliverables

| File | Viewport | State yang ditunjukkan |
| --- | ---: | --- |
| `flowline-arena-desktop.svg` | 1440 × 900 | planning round; timeline bersama, floor map 2.5D, dan agent rail |
| `flowline-arena-mobile.svg` | 390 × 844 | planning round pada satu kolom dengan timeline yang tetap terbaca |
| `flowline-arena-v2-generated.png` | 1536 × 1024 | visual reference baru: disruption, counterfactual ghost plan, evidence card, dan human confirmation dalam satu judge path |
| `flowline-dashboard-v2-generated.png` | 1536 × 1024 | visual reference baru: landing/brief page dengan tesis, arena preview, dan tiga langkah Build → Stress-test → Decide |
| `flowline-focus-3d-target-v3.png` | 1536 × 1024 | visual reference 3D: satu operations floor koheren, transfer gate, selected job, offline berth, causal route, dan ghost route |

PNG `v2-generated` dan `focus-3d-target-v3` dibuat sebagai referensi art direction
dengan image-generation tool pada 2 September 2026. PNG tersebut bukan production
asset dan tidak boleh menjadi pengganti DOM/CSS/semantic state. Implementasi harus
menerjemahkan hierarchy, spacing, warna, dan alur yang terlihat ke komponen React
yang dapat diakses.

## Visual contract

- **Job halaman:** dalam 60 detik pemain harus tahu urutan apa yang dipilih,
  bottleneck berada di mana, dan apa yang dapat dilakukan agent.
- **Signature:** satu garis deadline yang menembus timeline; disruption marker
  selalu terlihat sebagai event operasi, bukan dekorasi.
- **Palette:** ink `#10263A`, canvas `#F4F6F5`, cyan `#1B8DA5`, coral `#E7655B`,
  gold `#D29A23`, mint `#198A72`.
- **Type:** display serif hanya untuk thesis/heading; UI dan angka memakai
  system sans/monospace. Jangan gunakan gradient, glassmorphism, neon glow,
  atau ilustrasi stok.
- **Geometry:** radius maksimum 10px; garis 1px; spacing berbasis 4/8px;
  panel memiliki hierarchy melalui whitespace dan border, bukan bayangan besar.
- **States wajib:** normal shift, pending proposal, disruption ready, disrupted,
  recovery pending, dan confirmed. Setiap state harus memiliki label teks selain
  warna.

## Implementasi yang dituju

1. Pertahankan simulator dan tool contract di `src/domain` dan `src/tools`.
2. Pecah `App.tsx` menjadi `Header`, `ObjectiveRail`, `FloorMap`, `ScheduleTimeline`,
   `AgentRail`, dan `DecisionBar` tanpa memindahkan business logic ke komponen.
3. Gunakan CSS grid pada desktop dan urutan satu kolom pada mobile.
4. Timeline boleh horizontal-scroll pada mobile, tetapi semua action dan status
   harus tetap dapat dicapai keyboard.
5. Jadikan mockup ini acuan komposisi, bukan alasan menambah fitur yang tidak
   mendukung critical journey. 2.5D tetap cukup untuk menyampaikan station, berth,
   queue, dan disruption; Flowline juga memiliki focus 3D opsional sebagai lapisan
   penjelasan yang memakai state yang sama.

## Batas kejujuran

Mockup tidak membuktikan native WebMCP, performa, accessibility, atau hosted
behavior. Semua klaim tersebut tetap memerlukan test dan browser evidence terpisah.

## Status penerapan visual

Per 2026-09-02, komposisi arena target sudah diterapkan pada package Flowline melalui
`src/arena-target.css` dan komponen `FloorMap` di `src/App.tsx`. Lapisan ini hanya
mengubah presentasi arena; simulator, state machine, dan tool contract tetap berada
di domain/tool layer yang sama.

Yang sudah terlihat pada route lokal:

- header navy dengan round status dan guide action;
- progress strip `PLAN / Build the schedule`;
- objective rail dengan critical job, trade-off, dan learning check;
- shared operations floor dengan floor map 2.5D, job tokens, station handoff,
  metric strip, deadline rail, queue, dan berth lanes;
- Operations Auditor rail dengan context, role, action grid, audit trail, dan
  human-confirmation boundary;
- pending decision bar yang tetap menyediakan alasan manusia dan action review;
- mobile one-column order yang menjaga objective → timeline → auditor → decision;
- flat palette dan typography yang mengikuti visual contract tanpa asset eksternal;
- optional focus view 3D yang dibuka dari floor map, dengan semantic inspector,
  ghost proposal, disruption overlay, dan DOM fallback ketika WebGL tidak tersedia.

Browser geometry check pada Vite lokal `http://127.0.0.1:4179/`:

| Viewport | Main checks | Result |
| --- | --- | --- |
| 1440 × 900 | objective y=164/h=474, floor map y=246/h=128, decision y=798, document width 1425/1425 | PASS |
| 390 × 844 | objective y=137/h=148, timeline y=301/h=279, auditor y=596, document width 390/390 | PASS |

Screenshot browser hanya dipakai untuk inspeksi lokal dan tidak menjadi asset produk.
Hasil ini tidak mengubah status hosted URL, native natural-language replay, atau
submission final.
