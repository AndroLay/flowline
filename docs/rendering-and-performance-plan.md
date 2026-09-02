# Flowline — rencana rendering hybrid dan performance

**Status:** implementation slice `M0–M4 partial` — lazy 3D, state parity, lifecycle,
fallback, and browser measurement are implemented. Desktop p95 frame time is still
on hold in the available headless SwiftShader environment; M5 release adoption is
not approved.

**Keputusan scope:** pertahankan simulator TypeScript dan DOM/CSS sebagai sumber
kebenaran; tambahkan focus view 3D berbasis Three.js/WebGL secara opsional dan
lazy-loaded; jangan menambahkan Rust/WASM atau WebGPU pada tahap ini.

## 1. Tujuan

Flowline harus memiliki dua representasi dari state yang sama:

1. **Overview 2.5D DOM/CSS** sebagai gameplay utama, timeline, accessibility surface,
   dan fallback universal.
2. **Focus view 3D WebGL** sebagai explanation layer untuk memperbesar station,
   queue, transfer, deadline, dan disruption yang sedang dipilih.

3D tidak boleh menjadi game kedua, memiliki simulator sendiri, atau menyembunyikan
informasi yang hanya dapat dibaca dari pixel canvas.

Hal yang wajib dibuktikan: **interaksi agent melalui WebMCP harus dapat memengaruhi
focus view 3D secara terlihat**. Agent tidak perlu mengendalikan kamera atau mesh
secara langsung. Agent mengubah atau membaca semantic state; React kemudian
menurunkan state tersebut ke timeline DOM dan renderer 3D. Dengan cara ini, perubahan
3D merupakan konsekuensi dari interaksi WebMCP, bukan animasi dekoratif yang berjalan
sendiri.

Target produk:

> Pemain menyusun schedule di overview, agent mengaudit state yang sama, lalu focus
> 3D membuat hubungan bottleneck → queue → deadline failure terlihat dalam satu
> momen yang mudah dipahami.

Target performa adalah target internal yang harus diukur, bukan klaim submission:

- core overview tetap dapat dimainkan tanpa memuat renderer 3D;
- 3D dimuat hanya ketika dibutuhkan;
- tidak ada freeze ketika WebMCP mengembalikan audit atau proposal;
- active focus view mendekati 60 FPS pada perangkat desktop/laptop umum;
- fallback 2.5D tetap lengkap ketika WebGL tidak tersedia atau reduced motion aktif;
- ukuran initial route tidak bertambah karena kode 3D yang belum digunakan.

## 2. Baseline yang sudah diverifikasi

Snapshot 2 September 2026 dari package Flowline:

| Item | Hasil baseline | Sumber/metode |
| --- | --- | --- |
| Domain and scene tests | 10 test cases across 3 modules pass | `pnpm --filter flowline test` |
| Typecheck | exit 0 | `pnpm --filter flowline typecheck` |
| Vite production build | 36 modules, sekitar 0,78 s tahap Vite | `pnpm --filter flowline build` |
| Initial JavaScript | 265.98 kB raw / 80.71 kB gzip | current production Vite output |
| Initial CSS | 180.22 kB raw / 31.85 kB gzip | current production Vite output |
| Lazy 3D chunk | 487.74 kB raw / 124.22 kB gzip | current production Vite output; not requested on initial route |
| Domain size | 4 job, 24 permutation deterministic | `src/domain/model.ts`, model tests |
| Rendering boundary | DOM/CSS 2.5D primary; optional Three.js/WebGL focus layer | source inventory and production browser check |

Baseline ini adalah bukti build dan correctness. Belum merupakan pengukuran FPS,
first contentful paint, memory, atau long task pada perangkat nyata. Pengukuran
runtime harus dilakukan sebelum dan sesudah spike 3D dengan metode yang sama.

Ukuran CSS saat ini lebih besar daripada JavaScript gzip-nya. Itu bukan bukti bahwa
CSS adalah bottleneck, tetapi menjadi alasan untuk mengukur DOM/style recalculation.
Optimasi stylesheet hanya dilakukan jika profiler menunjukkan biaya tersebut;
penghapusan selector tidak boleh dilakukan hanya untuk mengejar angka bundle dan
merusak visual state.

## 2a. Implementation evidence at this snapshot

The following parts of the plan are now implemented in `submissions/flowline`:

- `three@0.180.0` and matching `@types/three@0.180.0` are pinned in the package;
- `src/visual/scene-model.ts` derives station/job/focus/ghost data from the existing
  domain evaluation;
- `src/visual/flowline-3d.ts` owns one renderer, one scene, one camera, reusable
  low-poly objects, demand-driven rendering, capped pixel ratio, observers, and
  disposal;
- `App.tsx` dynamically imports the renderer only after the focus layer opens and
  keeps the 2.5D timeline and semantic inspector available;
- WebMCP audit results update the same focus state used by the 3D layer;
- local Chromium verified the scene at 1440 × 900 and 390 × 844, no document
  overflow, no uncaught exceptions, and 20 open/close cycles with zero remaining
  canvas elements;
- five 10-second active samples per viewport were collected against the production
  preview. The detailed numbers and the desktop p95 hold are recorded in
  `docs/progress.md`.

This is implementation evidence, not a submission-ready performance or native-agent
claim. Real-device, cold/warm-cache, and authorized natural-language client evidence
remain open.

## 3. Keputusan teknologi

### Dipakai pada tahap pertama

- **Three.js core** untuk scene kecil dan imperative render loop.
- **WebGL2/WebGLRenderer** sebagai backend utama karena lebih kompatibel daripada
  WebGPU pada browser target challenge.
- **Dynamic import** sehingga chunk 3D tidak masuk initial critical path.
- **Procedural geometry** berbasis primitive Three.js; tidak ada asset eksternal,
  texture berlisensi, audio, atau model 3D dari participant lain.
- **React** tetap mengatur lifecycle dan selected/focus state; renderer Three.js
  tidak mengambil alih domain state.

### Sengaja tidak dipakai pada tahap pertama

- React Three Fiber: belum diperlukan untuk scene kecil; menambah abstraction dan
  dependency sebelum ada kebutuhan komponen 3D yang kompleks.
- WebGPU: belum menjadi requirement dan compatibility risk lebih tinggi.
- Rust/WASM: tidak ada CPU hot path yang terukur; simulator saat ini hanya mengevaluasi
  empat job dan 24 urutan.
- Physics engine, post-processing, shadow pipeline berat, free-roam camera, dan
  multiplayer: tidak membantu critical judge path.

Jika scene kelak memiliki banyak objek React-aware atau interaksi 3D kompleks,
React Three Fiber dapat dievaluasi sebagai perubahan terpisah. Ia bukan bagian dari
spike pertama.

### Performance budget dan aturan implementasi

Performa diperlakukan sebagai constraint desain. Renderer yang lebih indah tetapi
membuat overview lambat, mobile tersendat, atau tool response terlambat tidak boleh
masuk release candidate.

Aturan wajib:

- initial route tidak mengimpor atau meminta chunk Three.js;
- renderer 3D dibuat hanya ketika focus view benar-benar dibuka atau diperlukan oleh
  alur yang terlihat;
- hanya ada satu `WebGLRenderer`, satu scene, dan satu camera per focus view;
- render loop berjalan hanya ketika scene terlihat, camera berubah, atau ada transisi;
  tidak ada `requestAnimationFrame` tanpa batas ketika scene idle;
- setiap frame menggunakan object/material/geometry yang sudah dialokasikan; jangan
  membuat array, mesh, atau closure baru di hot loop;
- job token dan station menggunakan primitive low-poly dan object reuse; tidak ada
  texture, post-processing, particle system, atau shadow map berat pada spike pertama;
- `devicePixelRatio` dibatasi dengan `Math.min(window.devicePixelRatio, 1.25)`;
- animation pause ketika tab hidden, focus view ditutup, atau canvas keluar viewport;
- renderer, geometry, material, listener, observer, dan animation handle selalu
  di-dispose pada unmount;
- React hanya menerima state transition; render frame 3D tidak boleh memicu React
  rerender untuk setiap frame;
- label, metric, deadline, dan controls tetap berada di DOM, bukan dicat ke canvas;
- WebMCP tool call hanya mengubah semantic state/scene model, bukan mengirim mesh atau
  koordinat mentah melalui payload.

Budget internal yang harus diukur pada perangkat dan browser yang dicatat:

- median minimal 55 FPS dan p95 frame time maksimal 20 ms selama sample aktif 10 detik;
- tidak ada long task baru di atas 50 ms pada critical interaction dibanding baseline;
- p95 dari input atau tool result hingga perubahan DOM utama maksimal 100 ms untuk
  workload deterministic;
- initial navigation tidak meminta chunk 3D sebelum focus dibuka;
- setelah sedikitnya 20 kali buka-tutup focus, `renderer.info.memory` dan jumlah
  resource aktif kembali ke baseline atau tidak menunjukkan kenaikan terus-menerus;
- jika renderer tidak memenuhi budget di mobile, overview 2.5D tetap menjadi jalur
  utama dan focus 3D harus diturunkan menjadi mode statis atau dimatikan.

Angka tersebut adalah acceptance target internal, bukan klaim performa publik. Semua
hasil harus menyebut browser, viewport, hardware class, cold/warm cache, sample
duration, median, p95, dan variasi yang diamati.

## 4. Arsitektur target

```text
fixtures.ts
    ↓
domain/model.ts  (satu-satunya simulator dan state authority)
    ├── App.tsx + DOM/CSS overview/timeline
    ├── WebMCP runtime (semantic state dan proposal boundary)
    └── deriveSceneModel(state) → optional Three.js focus view
                                      ↓
                              WebGL canvas (visual only)
```

### Invariant state

- `GameState`, `revision`, `phase`, schedule, evaluation, disruption, proposal, dan
  receipt tidak boleh diduplikasi di scene 3D.
- Scene menerima snapshot turunan yang immutable atau read-only.
- Entity ID di 3D harus sama dengan job/station ID di simulator.
- Timeline DOM dan scene harus membaca evaluation yang sama pada revision yang sama.
- WebMCP tetap mengembalikan semantic data: ID, status, metrics, causal path, dan
  revision—bukan mesh, pixel, atau koordinat kamera.
- Setiap agent action yang relevan memiliki jalur propagasi yang dapat ditelusuri:
  `tool call → domain transition/audit → React state update → deriveSceneModel →
  visible 3D delta`.
- Tidak boleh ada jalur kedua tempat renderer menebak hasil tool, menjalankan
  simulator sendiri, atau mengubah score tanpa domain transition.

### Batas tanggung jawab

| Lapisan | Memiliki | Tidak boleh memiliki |
| --- | --- | --- |
| Domain | rules, schedule, metrics, phase, revision | detail material, camera, animation |
| React/UI | controls, keyboard, labels, proposal/confirm, fallback | simulator alternatif |
| WebMCP | tool contract, parsing, revision/phase guard | human confirmation |
| 3D renderer | camera, mesh, lights, visual transition, disposal | score, deadline truth, authority |

### Agent-to-3D interaction contract

| Interaksi agent | Perubahan semantic state | Perubahan 3D yang wajib terlihat | Tidak boleh dilakukan |
| --- | --- | --- | --- |
| `inspect_board` | revision, schedule, phase, active capacity terbaca | overview/focus menampilkan revision dan job order terbaru | mengubah committed plan |
| `find_bottleneck` | audit dan causal path tersimpan | station bottleneck disorot; queue/transfer terkait diberi emphasis | mengarang station yang tidak ada |
| `simulate_disruption` | baseline/stress evaluation dan disruption audit tersimpan | capacity overlay, queue growth, dan deadline risk berubah di 3D | commit disruption sebagai plan baru |
| `compare_plans` | counterfactual evaluation dan selected comparison tersimpan | ghost job path atau before/after lane menampilkan perbedaan plan | mengubah committed schedule |
| `stage_schedule` | pending proposal, expected revision, proposed order | ghost schedule dan proposal highlight muncul; committed mesh tetap lama | langsung mengubah schedule final |
| human confirmation | committed schedule dan revision berubah | job token, lane, metric, dan receipt visual berubah ke state baru | dipanggil oleh agent/tool |
| `undo_schedule` | pending rollback proposal | ghost rollback terlihat tanpa menghapus receipt saat belum dikonfirmasi | melakukan rollback otomatis |

Aturan ini membuat hubungan agent → 3D dapat diuji. Kamera boleh diarahkan ke
station yang relevan sebagai efek presentasi, tetapi semantic state dan decision
boundary tetap berasal dari domain/UI.

### Failure and recovery propagation

- Tool refusal, invalid ID, stale revision, atau cancellation tidak boleh membuat
  scene 3D menampilkan state sukses palsu.
- Audit yang gagal boleh menampilkan error state di DOM, tetapi tidak boleh
  menggerakkan job token atau mengubah metric 3D.
- Proposal yang masih pending divisualkan sebagai ghost/dashed state; committed
  geometry tetap mewakili schedule lama.
- Human reject menghapus ghost state tanpa mengubah receipt atau committed state.
- Human confirm mengubah DOM dan 3D dalam satu React state transition.
- Jika renderer gagal dibuat, tool tetap dapat dipakai dan overview DOM tetap menjadi
  bukti utama; UI harus menyatakan bahwa focus 3D tidak tersedia.

## 5. Bentuk visual yang harus dibangun

### Overview 2.5D tetap utama

Overview harus tetap menampilkan:

- dua station;
- job order dan queue;
- timeline preparation/dispatch;
- capacity dan disruption;
- deadline marker;
- waiting/idle/tardiness;
- audit rail;
- stage, reject, confirm, dan undo proposal.

Pemain dapat menyelesaikan seluruh judge path tanpa membuka 3D.

### Focus view 3D

Focus view dibuka dari station/job yang sedang dipilih atau dari hasil audit. Scene
pertama cukup memiliki:

- dua station low-poly;
- maksimal empat job token;
- satu transfer/handoff link;
- queue marker;
- capacity indicator;
- deadline marker;
- ghost plan sebelum commit;
- disruption overlay;
- label DOM atau accessible description yang menyebut ID dan status.

Kamera bersifat guided/isometric, bukan free-roam. Scene hanya memperbesar causal
slice yang dipilih. Kembali ke overview selalu tersedia.

## 6. WebMCP dan interaksi

Tool Flowline yang sudah ada dipertahankan pada spike pertama:

- `inspect_board`;
- `find_bottleneck`;
- `simulate_disruption`;
- `compare_plans`;
- `stage_schedule`;
- `undo_schedule`.

Tidak menambah `focus_station` pada tahap pertama hanya untuk membuat tool count lebih
besar. Focus 3D dapat mengikuti hasil audit atau kontrol UI. Tool baru hanya layak jika
counterfactual test menunjukkan agent membutuhkan semantic focus action yang tidak
dapat direpresentasikan oleh tool yang ada.

Setiap tool tetap:

- memakai schema tertutup;
- revision-aware dan phase-aware;
- tidak mengubah committed schedule ketika hanya simulasi;
- men-stage proposal sebelum mutation;
- tidak dapat menekan human confirmation;
- mengembalikan data yang dapat direpresentasikan di DOM dan 3D secara konsisten.

## 7. Rencana milestone

### M0 — baseline dan guard (wajib sebelum dependency)

1. Simpan hasil test, typecheck, build, bundle size, dan source inventory.
2. Tambahkan pengukuran browser untuk overview tanpa 3D:
   - navigation timing;
   - long tasks;
   - frame sample pada animasi yang sudah ada;
   - latency dari reorder dan tool invocation hingga DOM update.
3. Catat viewport desktop dan mobile, browser, hardware class, warm/cold cache.
4. Pastikan baseline lulus sebelum branch implementasi 3D.

**Exit:** baseline reproducible dan tidak ada regresi pada 10 test case yang ada.

#### Metode pengukuran runtime

Harness pengukuran harus memakai build production yang sama untuk baseline dan
candidate. Untuk setiap skenario, lakukan sedikitnya lima sample dan laporkan median
serta p95, bukan satu angka terbaik.

Skenario minimum:

1. cold-load overview pada 1440px;
2. warm-load overview pada 1440px;
3. membuka focus 3D dan membiarkannya aktif selama 10 detik;
4. menjalankan `find_bottleneck` dan `simulate_disruption`;
5. stage, reject, dan human confirm;
6. membuka-menutup focus 20 kali;
7. viewport 390px, reduced motion, dan WebGL unavailable.

Data yang direkam:

- `performance.getEntriesByType("navigation")` untuk navigation timing;
- `performance.mark/measure` untuk input/tool → DOM update → scene update;
- `requestAnimationFrame` sample untuk frame time/FPS;
- `PerformanceObserver` untuk long task;
- request/chunk yang dimuat sebelum dan sesudah focus;
- `renderer.info` sebelum dan sesudah lifecycle berulang;
- console error, uncaught exception, dan fallback status.

Hasil harus disimpan sebagai evidence lokal dengan label browser, viewport, hardware
class, build hash, dan tanggal. Jika hanya tersedia headless browser, sebutkan bahwa
hasil tersebut bukan jaminan performa semua perangkat pengguna.

### M1 — renderer spike terisolasi — IMPLEMENTED

1. Tambahkan `three` sebagai dependency yang dipin secara reproducible.
2. Buat modul terisolasi, misalnya `src/visual/flowline-3d.ts`, dengan lifecycle:
   `create → resize → render → pause → dispose`.
3. Render station dan job token dari fixture statis, belum terhubung ke mutation.
4. Gunakan dynamic import; jangan mengimpor Three.js dari initial entry jika focus
   view belum dibuka.
5. Tambahkan WebGL capability check dan fallback.

**Exit:** scene dapat dibuka/ditutup berulang tanpa error atau canvas overflow pada
local Chromium; overview tetap playable tanpa scene. Real-device memory evidence is
still open.

### M2 — state parity — IMPLEMENTED

1. Buat fungsi pure `deriveSceneModel(state, evaluation)`.
2. Hubungkan schedule normal, stress, disruption, recovery, dan proposal ke visual.
3. Pastikan revision yang terlihat di DOM sama dengan revision yang divisualkan.
4. Tampilkan ghost schedule untuk proposal tanpa mengubah committed state.
5. Tambahkan test bahwa urutan dan status token 3D mengikuti evaluation yang sama.

**Exit:** one snapshot produces the same entity IDs, revision, metrics, disruption
capacity, and proposal/ghost state for the timeline and scene model; no score or rule
lives only in the renderer.

### M3 — WebMCP journey — IMPLEMENTED LOCALLY

1. Jalankan `inspect_board`, `find_bottleneck`, dan `simulate_disruption`.
2. Setelah audit, fokuskan scene pada station/job yang benar.
3. Tampilkan causal path, bukan sekadar animasi bergerak.
4. Jalankan `compare_plans`, lalu `stage_schedule`.
5. Pastikan proposal muncul di DOM, scene menampilkan ghost state, dan konfirmasi
   tetap hanya tombol manusia.
6. Uji stale revision, invalid schedule, duplicate proposal, wrong phase, dan undo.

7. Buat dua jenis evidence yang tidak boleh dicampur:
   - **direct contract evidence:** test memanggil handler dan memeriksa state/scene
     model yang dihasilkan;
   - **native agent evidence:** client agent benar-benar menemukan dan memanggil
     tool melalui WebMCP, lalu screenshot atau trace menunjukkan perubahan 3D yang
     sesuai.
8. Untuk minimal satu replay, catat urutan berikut secara lengkap:
   `inspect_board → find_bottleneck → simulate_disruption → compare_plans →
   stage_schedule → human confirmation`.
9. Pastikan setiap langkah memiliki pasangan bukti: tool name/input, revision sebelum
   dan sesudah, perubahan DOM, dan perubahan 3D. Jika agent invocation tidak tersedia,
   labeli hasil sebagai `UNKNOWN` dan jangan menyebutnya sebagai native replay.

**Exit:** the direct local guide path completes inspect → stress → compare → stage →
human confirm with one state model and one revision-bound proposal. Genuine native
agent invocation that changes the 3D view remains `UNKNOWN` until an authorized
client runs it.

### M4 — performance dan responsive hardening — PARTIAL / HOLD

1. Batasi pixel ratio dan ukuran canvas.
2. Render hanya ketika scene terlihat atau state/camera berubah.
3. Pause ketika tab hidden atau focus view ditutup.
4. Dispose geometry, material, renderer, event listener, dan observer.
5. Uji 1440px, 1024px, 768px, dan 390px.
6. Uji reduced motion dan WebGL unavailable.
7. Bandingkan hasil dengan M0 menggunakan browser, build, dan workload yang sama.

**Exit status:** no observed regression in the local critical journey, responsive
layout, or initial lazy-load boundary. The mobile sample meets the frame budget; the
desktop headless SwiftShader sample misses the p95 20 ms target, so 3D is not yet
approved as a hard release requirement.

### M5 — evidence dan release candidate

1. Jalankan typecheck, unit/contract test, production build, browser smoke, dan
   visual/responsive checks.
2. Rekam native registration dan, jika client tersedia, natural-language replay.
3. Pastikan README menjelaskan WebGL fallback dan bahwa 3D bukan source of truth.
4. Buat screenshot/video yang memperlihatkan normal → shock → recovery.
5. Jalankan clean-host rehearsal sebelum menentukan apakah fitur 3D masuk submission.

**Exit:** fitur 3D dapat dihapus tanpa merusak Flowline core path, dan semua klaim
submission memiliki evidence yang sesuai.

## 8. Acceptance criteria dan evidence

### Correctness/state

- [x] semua domain dan scene test saat ini lulus;
- [x] deterministic simulator tetap menghasilkan 24 permutation yang sama;
- [x] state 3D dan timeline memakai `revision` yang sama;
- [x] proposal tidak mengubah committed state;
- [x] stale, invalid, duplicate, wrong-phase, dan cancellation path ditolak;
- [x] undo tetap melewati human confirmation.

### WebMCP

- [x] enam tool terdaftar dengan schema dan deskripsi yang benar;
- [x] tool output tetap semantic dan tidak bergantung pada canvas;
- [x] native registry pass dibedakan dari agent invocation;
- [x] agent tidak dapat mengonfirmasi mutation;
- [x] fallback manual tetap melakukan alur yang sama.
- [ ] minimal satu native agent replay menunjukkan tool call mengubah 3D secara
  visible dan sesuai dengan revision/state;
- [ ] setiap klaim agent replay memiliki trace atau recording, bukan hanya registry
  result atau direct `tool.execute` test;
- [ ] ketika native client tidak tersedia, dokumentasi tetap menyebut status
  `UNKNOWN` dan menyediakan direct-contract fallback tanpa overclaim.

### Visual/accessibility

- [x] overview 2.5D playable ketika WebGL tidak tersedia;
- [x] semua informasi penting tersedia sebagai DOM/text;
- [x] focus view dapat dibuka dan ditutup dengan keyboard;
- [x] focus ring, reduced motion, dan responsive layout tetap berfungsi;
- [x] tidak ada horizontal overflow pada 1440px dan 390px;
- [x] 3D tidak menyebabkan canvas menutupi controls atau proposal bar.

### Performance

Metrik berikut adalah gate internal yang harus diukur berulang, bukan janji kepada
juri:

- [x] initial overview tidak menunggu dynamic 3D chunk;
- [x] frame time focus view dicatat minimal 10 detik pada desktop dan mobile;
- [ ] target internal focus view: median minimal 55 FPS dan p95 frame time maksimal
  20 ms pada perangkat uji yang dicatat;
- [x] tidak ada long task baru di atas 50 ms pada critical interaction yang tidak
  sudah ada pada baseline;
- [ ] input/reorder atau tool result ke pembaruan DOM utama memiliki p95 maksimal
  100 ms pada workload deterministic yang sama;
- [x] memory/canvas/observer cleanup diuji setelah sedikitnya 20 kali buka-tutup
  focus berulang;
- [x] initial navigation tidak meminta chunk 3D sebelum focus view dibuka;
- [ ] jika hasil berada dalam noise atau memburuk, 3D disederhanakan atau tidak
  dimasukkan ke release candidate.

## 9. Risiko dan mitigasi

| Risiko | Dampak | Mitigasi | Kill condition |
| --- | --- | --- | --- |
| Three.js menambah initial bundle | load lebih lambat | dynamic import dan route gating | initial route ikut memuat chunk 3D |
| WebGL tidak tersedia | juri melihat layar kosong | capability check + DOM fallback | core path gagal tanpa WebGL |
| state scene terpisah | visual menipu | pure `deriveSceneModel` + revision parity test | score/phase berbeda dari DOM |
| animasi terlalu berat | jank dan mobile failure | low-poly, pixel-ratio cap, pause hidden | p95 frame dan long task memburuk |
| 3D menjadi dekorasi | leverage rendah | setiap highlight harus menjelaskan causal state | tidak ada perbedaan pemahaman dibanding overview |
| scope melebar | submission tertunda | satu station slice, satu camera, satu disruption | melebihi milestone M3 tanpa critical journey |
| dependency/CSP/static host issue | deployment gagal | self-contained assets, clean-host rehearsal | build atau hosted load gagal |
| agent tidak memakai focus | klaim berlebihan | label preview/manual focus sebagai non-agent evidence | video menyatakan native replay tanpa rekaman |

## 10. Rollback dan keputusan akhir

Implementasi harus berada di modul 3D terisolasi sehingga rollback dapat dilakukan
dengan menghapus dynamic import dan focus entry tanpa menyentuh:

- `src/domain/model.ts`;
- enam tool WebMCP;
- timeline DOM;
- proposal/confirmation boundary;
- fixture dan test baseline.

Keputusan masuk submission hanya boleh dibuat setelah M4. Tiga hasil yang sah:

1. **Adopt:** 3D meningkatkan judge clarity tanpa regresi dan masuk release candidate.
2. **Trim:** hanya station focus atau disruption overlay dipertahankan.
3. **Drop:** kembali ke 2.5D jika bukti performa, compatibility, atau waktu tidak
   sebanding dengan manfaat.

Tidak ada kewajiban teknis untuk mempertahankan 3D. Flowline tetap valid sebagai game
WebMCP dengan overview DOM/CSS apabila focus renderer gagal memenuhi gate.

## 11. Definition of done

Rencana ini dianggap selesai dilaksanakan hanya jika:

- 2.5D dan 3D menampilkan satu state yang sama;
- WebMCP tetap semantic, revision-bound, dan human-gated;
- fallback WebGL dan reduced-motion dapat dimainkan;
- performance dibandingkan dengan baseline, bukan diasumsikan;
- test, typecheck, build, browser, responsive, dan evidence lulus;
- hosted rehearsal tidak membutuhkan backend atau biaya;
- README, video, dan submission text tidak mengklaim native replay atau FPS yang
  belum dibuktikan;
- pemilik project menyetujui apakah hasil akhirnya Adopt, Trim, atau Drop.
