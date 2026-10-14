// Dua rangkaian frame yang disambung menjadi satu animasi scroll (1080p, dari video 2K q1, q22):
// a1 = pintu -> bingkai potret (163 frame), a2 = bingkai potret -> meja -> buku.
// Animasi balik halaman ada di folder a3 (video q33, lihat BOOK).
const SEQUENCES = [
    { folder: "/frames/a1/", count: 163 },
    { folder: "/frames/a2/", count: 186 },
];

// Jumlah frame yang di-crossfade di sambungan: [a1->a2]. 0 = langsung ganti frame.
// q1 dipotong di frame 163 (~7 detik): frame itu yang paling cocok dengan frame pertama q22.
const KS = [0];

// Titik berhenti: Home (0) -> Bingkai (0.4655, frame terakhir a1) -> Buku (1)
// Kalau diubah, samakan juga data-goto, top:% dan data-start/end di blade
const STOPS = [0, 0.4655, 1];

// ---- Buku: animasi balik halaman (folder a3) ----
// Next = putar maju, Previous = putar mundur. Isi tiap spread (teks kiri, gambar kanan) diedit di sini.
// Video buku berputar sempurna (frame terakhir = frame pertama):
// - animasi balik halaman berjalan dari frame awal sampai idleFrom (sisanya hanya jeda diam)
// - "idle" = bagian diam di akhir (idleFrom..akhir) disambung bagian diam di awal (0..idleHeadEnd),
//   diputar bolak-balik supaya api lilin tetap bergerak tanpa sambungan yang loncat.
const BOOK = {
    folder: "/frames/a3/",
    count: 186,
    fps: 40,
    idleFrom: 162,
    idleHeadEnd: 22,
};
const BOOK_FADE_MS = 0; // crossfade masuk dari akhir a2 ke frame pertama buku
const BOOK_TEXT_SHOW_FWD = 175; // balik maju: teks muncul saat animasi mencapai frame ini (halaman sudah mendarat)
const BOOK_TEXT_SHOW_BACK = 15; // balik mundur: teks muncul saat animasi turun sampai frame ini
const BOOK_TEXT_DELAY_MS = 400; // jeda teks buku muncul setelah kamera sampai di buku
const BOOK_TEXT_EARLY = 0.82; // teks mulai muncul saat scroll mencapai sekian (0-1) dari waktunya; 1 = tunggu sampai berhenti
const BOOK_SETTLE_MS = 0; // crossfade merapikan posisi buku di sambungan animasi
// Isi halaman buku dibaca dari <template id="book-pages"> di scroll.blade.php.
// Edit teks dan gambar di blade; array di bawah hanya cadangan kalau template tidak ada.
const BOOK_PAGES = (() => {
    const tpl = document.getElementById("book-pages");
    const pages = tpl
        ? [...tpl.content.querySelectorAll("article")].map((el) => ({
              kicker: (el.querySelector("small")?.textContent || "").trim(),
              title: (el.querySelector("h3")?.textContent || "").trim(),
              text: (el.querySelector("p")?.textContent || "").trim(),
              // <a data-icon="facebook|instagram|phone|linkedin|github|email|link" href="..."> di dalam <p> tampil sebagai logo
              links: [...el.querySelectorAll("p a[data-icon]")].map((a) => ({
                  icon: (a.dataset.icon || "link").toLowerCase(),
                  href: a.getAttribute("href") || "#",
                  label: (a.textContent || a.dataset.icon || "").trim(),
              })),
              // <a data-action href="..."> di dalam <article> (di luar <p>) = tombol "Lihat Proyek" di halaman itu
              action: (() => {
                  const a = el.querySelector("a[data-action]");
                  return a
                      ? {
                            href: a.getAttribute("href") || "#",
                            label: (a.textContent || "Lihat Proyek").trim(),
                        }
                      : null;
              })(),
              img: (el.dataset.img || "").trim(),
          }))
        : [];
    return pages.length
        ? pages
        : [{ kicker: "Bab I", title: "Judul", text: "Isi halaman.", img: "" }];
})();

// Titik tahan vertikal saat gambar harus dipotong: 0 = potong dari bawah (atas selalu utuh),
// 0.5 = potong atas dan bawah sama banyak. Harus sama dengan posisi .book-ui di CSS.
const ANCHOR_Y = 0;
// Titik tahan horizontal untuk layar yang lebih SEMPIT dari 16:9 (HP potret). Nilainya untuk tiap titik
// berhenti [Beranda, Karya, Buku] dan diinterpolasi saat scroll: pintu dan potret ada di kanan frame,
// buku di tengah. Di layar lebar tidak berpengaruh.
// Bingkai->Buku: geser samping ditahan sampai sekian bagian video (0-1)
const ANCHOR_DELAY = 0.45;
const ANCHOR_X = [0.86, 0.85, 0.505];

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const area = document.getElementById("scroll-area");
const loader = document.getElementById("loader");
const loaderFill = document.getElementById("loader-fill");
const loaderText = document.getElementById("loader-text");
const railFill = document.getElementById("rail-fill");
const scrollHint = document.getElementById("scroll-hint");
const copies = document.querySelectorAll(".copy");
const navLinks = document.querySelectorAll("[data-goto]");

// ---- Daftar semua file frame + offset awal tiap folder ----
const urls = [];
const offsets = [];
SEQUENCES.forEach((seq) => {
    offsets.push(urls.length);
    for (let i = 1; i <= seq.count; i++) {
        urls.push(seq.folder + String(i).padStart(3, "0") + ".webp");
    }
});
const FRAMES = urls.length;
const images = new Array(FRAMES);

// ---- Timeline: frame biasa + frame crossfade di sambungan ----
const steps = [];
SEQUENCES.forEach((seq, i) => {
    const base = offsets[i];
    const last = i === SEQUENCES.length - 1;
    const kIn = i === 0 ? 0 : KS[i - 1]; // frame awal yang sudah dipakai crossfade
    const kOut = last ? 0 : KS[i]; // frame akhir yang akan dicrossfade
    const to = seq.count - kOut;

    for (let f = kIn; f < to; f++) steps.push({ a: base + f });

    if (!last && kOut > 0) {
        const nextBase = offsets[i + 1];
        for (let k = 0; k < kOut; k++) {
            const x = k / (kOut - 1);
            const t = x * x * x * (x * (x * 6 - 15) + 10); // smootherstep
            steps.push({ a: base + to + k, b: nextBase + k, t });
        }
    }
});
const TOTAL = steps.length;

let current = 0;
let target = 0;
let progress = 0;
let lastDrawn = -1;

// ---- State snap scroll ----
let stage = 0;
let animating = false;
let snapTimer = null;
let lockUntil = 0;

function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    lastDrawn = -1;
    lastBook = -1;
}

function ready(i) {
    const im = images[i];
    return im && im.complete && im.naturalWidth ? im : null;
}

function pick(i) {
    for (let d = 0; d <= 8; d++) {
        const im = ready(i - d) || ready(i + d);
        if (im) return im;
    }
    return null;
}

function anchorX() {
    const p = bookMode ? 1 : progress;
    for (let i = 0; i < STOPS.length - 1; i++) {
        if (p <= STOPS[i + 1]) {
            let t = Math.max(
                0,
                Math.min(1, (p - STOPS[i]) / (STOPS[i + 1] - STOPS[i])),
            );
            // Geser samping baru mulai saat video mendekat ke buku (bukan dari awal), supaya tidak terasa menyimpang dulu
            if (i === 1) {
                t = Math.max(
                    0,
                    Math.min(1, (t - ANCHOR_DELAY) / (1 - ANCHOR_DELAY)),
                );
                t = t * t * (3 - 2 * t);
            }
            return ANCHOR_X[i] + (ANCHOR_X[i + 1] - ANCHOR_X[i]) * t;
        }
    }
    return ANCHOR_X[ANCHOR_X.length - 1];
}

// Layar potret (HP): saat di buku, kamera "mundur" supaya seluruh buku terlihat (bukan hanya bagian tengah).
// cx/cy = titik tengah buku di frame (0-1), spanW = lebar area buku di frame, y = posisi tengah buku di layar.
const BOOK_FIT_ENABLED = true; // HP: seluruh buku terlihat
const BOOK_FIT = { cx: 0.505, cy: 0.5, spanW: 0.53, y: 0.28 };
// Mundur selesai di sekian bagian awal video Bingkai->Buku (0-1); sisanya (video mendekat ke buku) tanpa gerak kamera tambahan
const BOOK_FIT_START = 0.45; // mulai bersamaan dengan video mendekat ke buku, selesai tepat di buku
const BOOK_FIT_BG = "rgb(10, 6, 4)"; // warna meja gelap untuk area di luar frame
let bookFit = 0; // 0 = cover (normal), 1 = buku utuh
let bookFitTime = 0;
let fitLayer = null;

const isPortrait = () => canvas.width / canvas.height < 1;
const easeFit = (t) => t * t * (3 - 2 * t);

function drawCover(img, alpha) {
    const cw = canvas.width,
        ch = canvas.height;
    const iw = img.naturalWidth,
        ih = img.naturalHeight;
    const scale = Math.max(cw / iw, ch / ih);
    let w = iw * scale;
    let h = ih * scale;
    // Kalau layar lebih pendek dari 16:9, bagian yang terpotong diambil dari bawah (ANCHOR_Y = 0)
    let x = (cw - w) * anchorX();
    let y = (ch - h) * ANCHOR_Y;

    const t = easeFit(bookFit);
    if (t > 0 && isPortrait()) {
        const sf = cw / (iw * BOOK_FIT.spanW);
        const fw = iw * sf,
            fh = ih * sf;
        const fx = cw / 2 - BOOK_FIT.cx * fw;
        const fy = BOOK_FIT.y * ch - BOOK_FIT.cy * fh;
        x += (fx - x) * t;
        y += (fy - y) * t;
        w += (fw - w) * t;
        h += (fh - h) * t;
        // lapisan terpisah supaya tepi atas/bawah frame bisa dipudarkan ke warna meja
        if (!fitLayer) fitLayer = document.createElement("canvas");
        if (fitLayer.width !== cw || fitLayer.height !== ch) {
            fitLayer.width = cw;
            fitLayer.height = ch;
        }
        const lx = fitLayer.getContext("2d");
        lx.globalCompositeOperation = "source-over";
        lx.globalAlpha = 1;
        lx.clearRect(0, 0, cw, ch);
        lx.imageSmoothingQuality = "high";
        lx.drawImage(img, x, y, w, h);
        const f = 0.05 * h * t; // lebar pudaran di tepi atas dan bawah frame
        const g = lx.createLinearGradient(0, y, 0, y + h);
        const a0 = Math.min(1, f / h);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(a0, "rgba(0,0,0,1)");
        g.addColorStop(1 - a0, "rgba(0,0,0,1)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        lx.globalCompositeOperation = "destination-in";
        lx.fillStyle = g;
        lx.fillRect(0, 0, cw, ch);
        if (alpha >= 1) {
            ctx.globalAlpha = 1;
            ctx.fillStyle = BOOK_FIT_BG;
            ctx.fillRect(0, 0, cw, ch);
        }
        ctx.globalAlpha = alpha;
        ctx.drawImage(fitLayer, 0, 0);
        return;
    }
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, x, y, w, h);
}

function draw(index) {
    const step = steps[index];
    const a = pick(step.a);
    if (!a) return false;
    drawCover(a, 1);
    if (step.b) {
        const b = pick(step.b);
        if (b) drawCover(b, step.t);
    }
    ctx.globalAlpha = 1;
    return true;
}

function updateCopy() {
    // Saat animasi pindah titik, teks hanya muncul kalau titik TUJUAN ada di rentangnya
    // (jadi teks "Karya" tidak sempat muncul saat loncat Beranda <-> Kontak).
    const dest = animating ? STOPS[stage] : null;
    copies.forEach((el) => {
        const s = parseFloat(el.dataset.start);
        const e = parseFloat(el.dataset.end);
        let vis = progress >= s && progress <= e;
        if (vis && dest !== null) vis = dest >= s && dest <= e;
        el.classList.toggle("visible", vis);
    });
    let nearest = Infinity,
        nearestP = 0;
    navLinks.forEach((a) => {
        const p = parseFloat(a.dataset.goto);
        // saat animasi pindah titik, sorot menu TUJUAN langsung (tanpa menunggu sampai tiba)
        const d = Math.abs((dest !== null ? dest : progress) - p);
        if (d < nearest) {
            nearest = d;
            nearestP = p;
        }
    });
    navLinks.forEach((a) => {
        const p = parseFloat(a.dataset.goto);
        let on = p === nearestP;
        // Link data-page: Karya = buku (halaman mana pun kecuali terakhir), Kontak = halaman terakhir
        // yang teksnya sudah muncul (jangan menyala sebelum teks buku tampil)
        if (on && a.dataset.page !== undefined) {
            const lastIdx = BOOK_PAGES.length - 1;
            const curPage = bookMode
                ? bookPage
                : wantPage !== null
                  ? wantPage
                  : bookPage;
            const isLast = curPage === lastIdx;
            if (pageIdx(a.dataset.page) === lastIdx)
                on = isLast && bookUI.classList.contains("show");
            else on = !isLast;
        }
        a.classList.toggle("active", on);
        a.classList.toggle("passed", progress >= p - 0.005);
    });
}

function readScroll() {
    const max = area.offsetHeight - window.innerHeight;
    const y = Math.min(Math.max(window.scrollY - area.offsetTop, 0), max);
    progress = max > 0 ? y / max : 0;
    target = progress * (TOTAL - 1);
    railFill.style.height = progress * 100 + "%";
    scrollHint.classList.toggle("hidden", progress > 0.02);
    updateCopy();
}

function stepBookFit(now) {
    const dt = Math.min(now - bookFitTime || 16, 64);
    bookFitTime = now;
    if (!(BOOK_FIT_ENABLED && isPortrait())) {
        if (bookFit === 0) return false;
        bookFit = 0;
        return true;
    }
    // HP: kamera mundur mengikuti scroll dari Bingkai ke Buku (satu gerakan mulus),
    // bukan menunggu animasi selesai lalu menyesuaikan.
    const s0 = STOPS[1];
    const goal = bookMode
        ? 1
        : Math.max(
              0,
              Math.min(
                  1,
                  ((progress - s0) / (1 - s0) - BOOK_FIT_START) /
                      (1 - BOOK_FIT_START),
              ),
          );
    if (Math.abs(bookFit - goal) < 1e-4) return false;
    bookFit = goal;
    return true; // ada perubahan: gambar ulang
}

function loop(now) {
    now = now || performance.now();
    if (stepBookFit(now)) {
        lastDrawn = -1;
        lastBook = -1;
    }
    if (bookMode) {
        drawBookIfNeeded();
        requestAnimationFrame(loop);
        return;
    }
    if (!animating) {
        current += (target - current) * 0.12;
        if (Math.abs(target - current) < 0.01) current = target;
    }
    const index = Math.round(current);
    warmAhead(index);
    if (index !== lastDrawn && draw(index)) lastDrawn = index;
    requestAnimationFrame(loop);
}

// ---- Cursor kustom (pena bulu) ----
// Cursor asli browser dibatasi 32px (kalau lebih besar, otomatis kembali ke cursor biasa saat dekat tepi jendela),
// jadi cursor digambar sendiri dan mengikuti mouse. Gambar di public/images/cursor/ (normal, hover, click).
(function penCursor() {
    if (
        !window.matchMedia ||
        !matchMedia("(hover: hover) and (pointer: fine)").matches
    )
        return; // layar sentuh: tidak dipakai
    const SIZE = { w: 63, h: 80 }; // ukuran gambar (px)
    const HOT = { x: 15, y: 8 }; // titik klik = ujung mata pena
    const HOVER_SEL =
        'a, button, summary, label, select, [role="button"], [data-goto], .rail-dot, .sound-btn, .nav-toggle, .book-btn, .contact-link, .loader.ready';
    const st = document.createElement("style");
    st.textContent =
        "html.pen-cursor, html.pen-cursor * { cursor: none !important; }" +
        "#pen-cursor { position: fixed; left: 0; top: 0; width: " +
        SIZE.w +
        "px; height: " +
        SIZE.h +
        "px; z-index: 2147483647;" +
        " pointer-events: none; opacity: 0; transition: opacity .15s; will-change: transform; background: url('/images/cursor/normal.png') 0 0 / 100% 100% no-repeat; }" +
        "#pen-cursor.is-hover { background-image: url('/images/cursor/hover.png'); }" +
        "#pen-cursor.is-down { background-image: url('/images/cursor/click.png'); }" +
        "#pen-cursor.show { opacity: 1; }";
    document.head.appendChild(st);
    ["normal", "hover", "click"].forEach(
        (n) => (new Image().src = "/images/cursor/" + n + ".png"),
    );
    const el = document.createElement("div");
    el.id = "pen-cursor";
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    document.documentElement.classList.add("pen-cursor");
    let down = false;
    function setState(target) {
        const hov = target && target.closest ? target.closest(HOVER_SEL) : null;
        const dis =
            target && target.closest ? target.closest("button:disabled") : null;
        el.classList.toggle("is-hover", !!hov && !dis);
        el.classList.toggle("is-down", down && !dis);
    }
    window.addEventListener(
        "mousemove",
        (e) => {
            el.style.transform =
                "translate3d(" +
                (e.clientX - HOT.x) +
                "px," +
                (e.clientY - HOT.y) +
                "px,0)";
            el.classList.add("show");
            setState(e.target);
        },
        { passive: true, capture: true },
    );
    window.addEventListener(
        "mousedown",
        (e) => {
            if (e.button === 0) {
                down = true;
                setState(e.target);
            }
        },
        true,
    );
    window.addEventListener(
        "mouseup",
        (e) => {
            down = false;
            setState(e.target);
        },
        true,
    );
    window.addEventListener("blur", () => {
        down = false;
        el.classList.remove("is-down");
    });
    document.addEventListener("mouseleave", () => el.classList.remove("show"));
    document.addEventListener("mouseenter", () => el.classList.add("show"));
})();

// ---- Preload ----
let loaded = 0;
let revealed = false;
let pendingBookEnter = false; // reload saat berada di buku: masuk ke buku setelah loader hilang
const LOADER_READY_TEXT = "Tekan di mana saja untuk masuk"; // tulisan loader saat sudah 100%

// Progress loader bergerak halus (tidak loncat) menuju target, baru setelah penuh masuk ke tahap "tekan untuk masuk"
let loaderTarget = 0;
let loaderShown = 0;
let loaderGated = false;
(function loaderTick() {
    if (loaderGated) return;
    const diff = loaderTarget - loaderShown;
    loaderShown +=
        Math.abs(diff) < 0.05
            ? diff
            : Math.sign(diff) * Math.max(Math.abs(diff) * 0.06, 0.25);
    loaderFill.style.width = loaderShown + "%";
    loaderText.textContent = "Memuat " + Math.round(loaderShown) + "%";
    if (revealed && loaderShown >= 99.9) {
        loaderGated = true;
        gateOrReveal();
        return;
    }
    requestAnimationFrame(loaderTick);
})();

// Buka halaman: loader hilang, lalu masuk ke buku kalau reload terjadi di buku
function reveal() {
    loader.classList.add("done");
    lastDrawn = -1;
    preloadBook();
    if (pendingBookEnter) {
        pendingBookEnter = false;
        enterBook();
    }
}
// Musik langsung menyala saat masuk: browser hanya mengizinkan suara setelah interaksi, jadi kalau diblokir,
// loader menampilkan tombol "Masuk" (klik = izin suara) sebelum halaman dibuka.
function gateOrReveal() {
    // selalu tampilkan "Tekan di mana saja untuk masuk" (sekaligus izin suara dari browser)
    loaderFill.style.width = "100%";
    loaderText.textContent = "100%";
    const title = loader.querySelector(".loader-title");
    if (title) title.textContent = LOADER_READY_TEXT;
    const oldGate = document.getElementById("loader-enter");
    if (oldGate) oldGate.hidden = true; // tombol lama (kalau masih ada di blade) tidak dipakai
    loader.classList.add("ready");
    let entered = false;
    const enter = () => {
        if (entered) return;
        entered = true;
        ["click", "touchend"].forEach((ev) =>
            loader.removeEventListener(ev, enter),
        );
        window.removeEventListener("keydown", enter);
        if (!bgmWanted) return reveal(); // musik sengaja dimatikan: tetap masuk lewat layar ini, tanpa suara
        bgmStart()
            .catch(() => {})
            .finally(reveal);
    };
    ["click", "touchend"].forEach((ev) => loader.addEventListener(ev, enter));
    window.addEventListener("keydown", enter);
}
function onLoaded() {
    loaded++;
    const pct = Math.round((loaded / FRAMES) * 100);
    if (!revealed) loaderTarget = Math.min(99, (loaded / (FRAMES * 0.4)) * 100); // bar penuh = syarat buka (40% frame + frame awal) terpenuhi
    // loader baru hilang kalau 40% frame sudah ada DAN frame di posisi awal (mis. saat reload di Karya) sudah termuat
    const startImg = images[startFrame];
    const startReady = startImg && startImg.complete && startImg.naturalWidth;
    if (
        !revealed &&
        ((loaded >= FRAMES * 0.4 && startReady) || loaded >= FRAMES * 0.8)
    ) {
        revealed = true;
        loaderTarget = 100;
    }
    if (loaded === FRAMES) lastDrawn = -1;
}

// frame di posisi awal (titik berhenti yang dipulihkan saat reload) dimuat paling dulu
let startFrame = 0;
function preload() {
    startFrame =
        steps[
            Math.max(
                0,
                Math.min(TOTAL - 1, Math.round(STOPS[stage] * (TOTAL - 1))),
            )
        ].a;
    const order = [];
    for (let k = -8; k <= 8; k++) {
        const f = startFrame + k;
        if (f >= 0 && f < FRAMES) order.push(f);
    }
    for (let i = 0; i < FRAMES; i += 4) order.push(i);
    for (let i = 0; i < FRAMES; i++) if (i % 4 !== 0) order.push(i);
    const seen = new Set();
    order.forEach((i) => {
        if (seen.has(i)) return;
        seen.add(i);
        const img = new Image();
        img.onload = img.onerror = onLoaded;
        img.src = urls[i];
        images[i] = img;
    });
}

// Frame 1080p besar: decode hanya jendela di depan posisi saat ini (hemat memori & mulus)
let lastWarm = -999;
function warmImg(im) {
    if (im && im.complete && im.naturalWidth && im.decode)
        im.decode().catch(() => {});
}
function warmAhead(index) {
    if (Math.abs(index - lastWarm) < 6) return;
    lastWarm = index;
    for (let k = -2; k < 40; k++) {
        const st = steps[Math.max(0, Math.min(TOTAL - 1, index + k))];
        warmImg(images[st.a]);
        if (st.b !== undefined) warmImg(images[st.b]);
    }
}

// ---- Buku ----
const bookUI = document.getElementById("book-ui");
const bookKicker = document.getElementById("book-kicker");
const bookTitle = document.getElementById("book-title");
const bookText = document.getElementById("book-text");
const bookFig = document.getElementById("book-fig");
const bookImg = document.getElementById("book-img");
const bookPrev = document.getElementById("book-prev");
const bookNext = document.getElementById("book-next");

const bimages = [];
let bookLoaded = false;
let bookMode = false; // true saat kanvas menampilkan animasi buku
let bookPage = 0;
let bookFrame = 0;
let bookBusy = false;
let bookTextUp = false; // teks halaman sudah muncul kembali (tombol next/prev boleh diklik)
let bookQueued = 0; // klik yang masuk saat sisa animasi masih berjalan; dijalankan begitu animasi selesai
let lastBook = -1;
let bookEnterTimer = null;
let bookBlend = null; // crossfade aktif: { from: gambar bawah, t0, dur }
let bookIdle = false; // true = siklus idle berjalan (lilin tetap bergerak)
let bookIdlePos = 0; // posisi di dalam urutan idle (float)
let bookIdleDir = 1; // arah gerak idle: +1 maju, -1 mundur
let bookIdleLast = 0;

// Urutan idle (loop mulus di 191 -> 0): [idleFrom .. akhir] lalu [0 .. idleHeadEnd].
// Diputar bolak-balik (memantul di kedua ujung) supaya tidak ada sambungan yang loncat,
// dan arahnya melanjutkan arah gerak terakhir animasi balik halaman.
const idleTailLen = () => BOOK.count - BOOK.idleFrom;
const idleLen = () => idleTailLen() + BOOK.idleHeadEnd + 1;
function seqToFrame(p) {
    const i = Math.round(p);
    const tail = idleTailLen();
    return i < tail ? BOOK.idleFrom + i : i - tail;
}
function stepIdle(now) {
    const dt = Math.min(now - bookIdleLast, 100);
    bookIdleLast = now;
    let p = bookIdlePos + (bookIdleDir * dt) / (1000 / 24);
    const max = idleLen() - 1;
    if (p > max) {
        p = 2 * max - p;
        bookIdleDir = -1;
    } else if (p < 0) {
        p = -p;
        bookIdleDir = 1;
    }
    bookIdlePos = p;
    return seqToFrame(p);
}
const BOOK_IDLE_ENABLED = false; // true = lilin bergerak terus saat buku diam (bolak-balik frame diam di awal/akhir video)

function startIdle(atFrame, dir) {
    if (!BOOK_IDLE_ENABLED) {
        // tanpa idle: buku berhenti di frame terakhir gerakan (frame awal atau frame akhir balik halaman)
        bookIdle = false;
        bookFrame = atFrame === 0 ? 0 : BOOK.count - 1; // sampai frame paling akhir video
        return;
    }
    // atFrame = idleFrom (setelah maju) atau 0 (setelah mundur / saat masuk)
    bookIdlePos = atFrame === 0 ? idleTailLen() : 0;
    bookIdleDir = dir;
    bookIdleLast = performance.now();
    bookIdle = true;
}

function preloadBook() {
    if (bookLoaded) return;
    bookLoaded = true;
    for (let i = 1; i <= BOOK.count; i++) {
        const img = new Image();
        img.src = BOOK.folder + String(i).padStart(3, "0") + ".webp";
        bimages.push(img);
    }
}

// decode frame buku sedikit di depan posisi putar (frame 1080p besar)
function warmBook(center, dir) {
    for (let k = 0; k < 24; k++) {
        const i = center + dir * k;
        if (i >= 0 && i < BOOK.count) warmImg(bimages[i]);
    }
}

function bookReady(i) {
    const im = bimages[i];
    return im && im.complete && im.naturalWidth ? im : null;
}

function bookImgAt(idx) {
    for (let d = 0; d <= 10; d++) {
        const im = bookReady(idx - d) || bookReady(idx + d);
        if (im) return im;
    }
    return null;
}

// Blend halus dari gambar `from` ke frame buku yang sedang aktif
function startBookBlend(from, dur) {
    if (!from || dur <= 0) return; // 0 = tanpa crossfade
    bookBlend = { from, t0: performance.now(), dur };
}

function drawBookIfNeeded() {
    if (bookIdle) bookFrame = stepIdle(performance.now());
    const idx = Math.max(0, Math.min(BOOK.count - 1, Math.round(bookFrame)));
    if (!bookBlend && idx === lastBook) return;
    const im = bookImgAt(idx);
    if (!im) {
        // frame buku belum termuat: tampilkan akhir a3 dulu supaya kanvas tidak kosong
        const prev = pick(steps[TOTAL - 1].a);
        if (prev) {
            drawCover(prev, 1);
            ctx.globalAlpha = 1;
        }
        return;
    }
    if (bookBlend) {
        let a = Math.min((performance.now() - bookBlend.t0) / bookBlend.dur, 1);
        a = a * a * (3 - 2 * a);
        drawCover(bookBlend.from, 1);
        drawCover(im, a);
        if (a >= 1) bookBlend = null;
    } else {
        drawCover(im, 1);
    }
    ctx.globalAlpha = 1;
    lastBook = idx;
}

// Status tiap gambar halaman: "ok" / "bad" (belum ada). Dicek sekali di awal supaya
// placeholder tidak berkedip tiap halaman dirender ulang.
const imgStatus = {};
function probeImages() {
    BOOK_PAGES.forEach((p) => {
        if (!p.img || imgStatus[p.img]) return;
        const im = new Image();
        im.onload = () => {
            imgStatus[p.img] = "ok";
            if (BOOK_PAGES[bookPage] && BOOK_PAGES[bookPage].img === p.img)
                renderPage();
        };
        im.onerror = () => (imgStatus[p.img] = "bad");
        im.src = p.img;
    });
}
probeImages();

// Halaman buku yang diminta lewat menu (data-page="0" / "last"); null = halaman pertama
let wantPage = null;
const pageIdx = (v) =>
    v === "last"
        ? BOOK_PAGES.length - 1
        : Math.max(0, Math.min(BOOK_PAGES.length - 1, parseInt(v, 10) || 0));

// Gaya kontak buku dipasang dari JS supaya selalu ikut ter-update (tidak tergantung cache scroll.css)
(function injectContactCss() {
    const st = document.createElement("style");
    st.id = "contact-css";
    st.textContent = `/* Kontak di buku: logo + teks tersusun ke bawah, dengan animasi hover */
#book-text.has-contacts {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
}
#book-text.has-contacts .contact-link {
    display: flex;
    align-items: center;
    gap: max(12px, 0.9cqw);
    width: fit-content;
    max-width: 100%;
    margin-top: max(10px, 0.8cqw);
    color: #26170a;
    text-decoration: none;
    pointer-events: auto;
    cursor: pointer;
}
#book-text.has-contacts .contact-link:first-child {
    margin-top: max(10px, 0.9cqw);
}
#book-text.has-contacts .contact-ico {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: max(28px, 1.8cqw);
    height: max(28px, 1.8cqw);
    border: 1.5px solid currentColor;
    border-radius: 50%;
    transition:
        background 0.25s ease,
        color 0.25s ease,
        transform 0.35s cubic-bezier(0.3, 1.6, 0.5, 1),
        box-shadow 0.25s ease;
}
#book-text.has-contacts .contact-ico svg {
    width: 54%;
    height: 54%;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 0.35s cubic-bezier(0.3, 1.6, 0.5, 1);
}
#book-text.has-contacts .contact-label {
    position: relative;
    font-family: var(--font-display);
    min-width: 0;
    overflow-wrap: anywhere;
    line-height: 1.25;
    font-size: max(10px, 0.78cqw);
    font-weight: 600;
    letter-spacing: 0.03em;
    transition:
        transform 0.3s ease,
        letter-spacing 0.3s ease;
}
#book-text.has-contacts .contact-label::after {
    content: "";
    position: absolute;
    left: 0;
    bottom: -3px;
    width: 100%;
    height: 1px;
    background: currentColor;
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 0.3s ease;
}
#book-text.has-contacts .contact-link:hover .contact-ico,
#book-text.has-contacts .contact-link:focus-visible .contact-ico {
    background: #26170a;
    color: #f1dfb6;
    transform: scale(1.14) rotate(-8deg);
    box-shadow: 0 4px 10px rgba(38, 23, 10, 0.35);
}
#book-text.has-contacts .contact-link:hover .contact-ico svg,
#book-text.has-contacts .contact-link:focus-visible .contact-ico svg {
    transform: rotate(8deg) scale(1.08);
}
#book-text.has-contacts .contact-link:hover .contact-label,
#book-text.has-contacts .contact-link:focus-visible .contact-label {
    transform: translateX(3px);
    letter-spacing: 0.05em;
}
#book-text.has-contacts .contact-link:hover .contact-label::after,
#book-text.has-contacts .contact-link:focus-visible .contact-label::after {
    transform: scaleX(1);
}
#book-text.has-contacts .contact-link:active .contact-ico {
    transform: scale(0.94);
}
/* PC: kotak teks tidak memunculkan scrollbar saat hover/animasi di halaman kontak */
@media (min-width: 721px) and (min-aspect-ratio: 1 / 1) {
    .book-text:has(#book-text.has-contacts) {
        overflow: visible;
    }
}
@media (max-width: 720px), (max-aspect-ratio: 1 / 1) {
    /* HP: berderet menyamping supaya kartu teks tidak terlalu tinggi */
    #book-text.has-contacts {
        flex-direction: row;
        flex-wrap: wrap;
        gap: 4px 20px;
    }
    #book-text.has-contacts .contact-link,
    #book-text.has-contacts .contact-link:first-child {
        margin-top: 10px !important;
        color: var(--gold) !important;
    }
    #book-text.has-contacts .contact-ico {
        width: 36px !important;
        height: 36px !important;
    }
    #book-text.has-contacts .contact-label {
        font-size: 0.9rem;
    }
    #book-text.has-contacts .contact-link:hover .contact-ico,
    #book-text.has-contacts .contact-link:focus-visible .contact-ico {
        background: var(--gold);
        color: #0a0806;
    }
}
`;
    document.head.appendChild(st);
})();

// Logo kontak (stroke ikon, viewBox 24)
const CONTACT_ICONS = {
    facebook:
        '<path fill="currentColor" stroke="none" d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H8v3h2.4V21h3.1z"/>',
    instagram:
        '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="0.9" fill="currentColor" stroke="none"/>',
    whatsapp:
        '<path d="M3.5 20.5l1.4-4.3A8.5 8.5 0 1 1 8 19.3l-4.5 1.2z"/><path fill="currentColor" stroke="none" d="M9.2 8.2c-.4.6-.3 1.7.9 3.2 1.2 1.5 2.6 2.3 3.6 2.3.7 0 1.2-.5 1.3-1l-1.6-.8-.7.7c-.8-.3-1.7-1.2-2-2l.7-.7-.8-1.6c-.3 0-.6.1-.9.3z"/>',
    phone: '<path d="M6.6 3.5h2.7l1.4 3.8-1.8 1.3a11 11 0 0 0 5.5 5.5l1.3-1.8 3.8 1.4v2.7a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z"/>',
    linkedin:
        '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 10.5V16M8 7.8v.1M11.5 16v-5.5M11.5 13c0-1.6 1-2.6 2.4-2.6s2.1 1 2.1 2.6V16"/>',
    github: '<path d="M9 19c-4 1.2-4-2-6-2.5m12 4.5v-3.1a2.7 2.7 0 0 0-.8-2.1c2.7-.3 5.5-1.3 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.3 1.3a11.400 11.400 0 0 0-6 0C6.700 3.100 5.700 3.400 5.700 3.400a4.300 4.300 0 0 0-.1 3.200A4.600 4.600 0 0 0 4.300 9.800c0 4.600 2.800 5.700 5.500 6A2.700 2.700 0 0 0 9 17.900V21"/>',
    email: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7.5l8.5 6 8.5-6"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};
// Tombol aksi (Lihat Proyek) di halaman buku + tombol CV di halaman Tentang
(function injectActionCss() {
    const st = document.createElement("style");
    st.textContent = `
.book-action {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    width: fit-content;
    margin-top: 18px;
    padding: 9px 20px;
    border: 1.5px solid var(--gold, #e6a124);
    border-radius: 999px;
    color: var(--gold, #e6a124);
    background: rgba(10, 6, 4, 0.55);
    font-family: var(--font-display, inherit);
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    text-decoration: none;
    pointer-events: auto;
    cursor: pointer;
    transition: background 0.25s, color 0.25s, transform 0.25s;
}
.book-action:hover,
.book-action:focus-visible {
    background: var(--gold, #e6a124);
    color: #0a0806;
    transform: translateY(-2px);
}
.book-action svg { width: 15px; height: 15px; }
.book-action[hidden] { display: none; }
.btn-cv {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-top: 22px;
    padding: 10px 22px;
    border: 1.5px solid var(--gold, #e6a124);
    border-radius: 999px;
    color: var(--gold, #e6a124);
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    text-decoration: none;
    pointer-events: none; /* aktif hanya saat teks dinding terlihat */
    transition: background 0.25s, color 0.25s;
}
.copy.visible .btn-cv { pointer-events: auto; cursor: pointer; }
.btn-cv:hover,
.btn-cv:focus-visible {
    background: var(--gold, #e6a124);
    color: #0a0806;
}
.btn-cv svg { width: 15px; height: 15px; }
`;
    document.head.appendChild(st);
})();

function renderBookAction(p) {
    const box = bookText.parentElement;
    let a = document.getElementById("book-action");
    if (!p.action) {
        if (a) a.hidden = true;
        return;
    }
    if (!a) {
        a = document.createElement("a");
        a.id = "book-action";
        a.className = "book-action";
        box.appendChild(a);
    }
    a.hidden = false;
    a.href = p.action.href;
    if (/^https?:/i.test(p.action.href)) {
        a.target = "_blank";
        a.rel = "noopener";
    } else {
        a.removeAttribute("target");
    }
    a.innerHTML =
        '<span></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>';
    a.firstChild.textContent = p.action.label;
}
function renderBookText(p) {
    bookText.classList.toggle("has-contacts", !!(p.links && p.links.length));
    if (!p.links || !p.links.length) {
        bookText.textContent = p.text || "";
        return;
    }
    bookText.textContent = "";
    p.links.forEach((l) => {
        const a = document.createElement("a");
        a.className = "contact-link";
        a.href = l.href;
        a.title = a.ariaLabel = l.label;
        if (/^https?:/i.test(l.href)) {
            a.target = "_blank";
            a.rel = "noopener";
        }
        // gaya dasar dipasang langsung (tetap rapi walau CSS belum termuat); CSS bisa menimpanya
        a.style.cssText =
            "display:flex;align-items:center;gap:12px;width:fit-content;color:#26170a;text-decoration:none;pointer-events:auto;cursor:pointer;margin-top:16px";
        const ico = document.createElement("span");
        ico.className = "contact-ico";
        ico.style.cssText =
            "display:flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;border:1.5px solid currentColor;border-radius:50%";
        ico.innerHTML =
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            (CONTACT_ICONS[l.icon] || CONTACT_ICONS.link) +
            "</svg>";
        const lab = document.createElement("span");
        lab.className = "contact-label";
        lab.textContent = l.label;
        a.append(ico, lab);
        bookText.appendChild(a);
    });
}

function renderPage() {
    const p = BOOK_PAGES[bookPage];
    bookKicker.textContent = p.kicker || "";
    bookTitle.textContent = p.title || "";
    renderBookText(p);
    renderBookAction(p);
    if (p.img && imgStatus[p.img] === "ok") {
        if (bookImg.getAttribute("src") !== p.img) bookImg.src = p.img;
        bookFig.classList.remove("noimg");
    } else {
        // belum dimuat / tidak ada: tampilkan placeholder tanpa mengubah src (tidak berkedip)
        bookFig.classList.add("noimg");
    }
    updateCopy(); // sorot menu sesuai halaman buku yang terbuka
}

function updateBookButtons() {
    const locked = bookBusy && !bookTextUp;
    bookPrev.disabled = locked || bookPage <= 0;
    bookNext.disabled = locked || bookPage >= BOOK_PAGES.length - 1;
}

function showBookEarly() {
    if (bookMode || bookUI.classList.contains("show")) return;
    bookPage = wantPage !== null ? wantPage : 0;
    renderPage();
    updateBookButtons();
    bookUI.classList.add("show");
    updateCopy();
}

function enterBook() {
    if (bookMode) return;
    bookMode = true;
    bookTextUp = false;
    bookQueued = 0;
    bookPage = wantPage !== null ? wantPage : 0;
    wantPage = null;
    bookFrame = 0;
    bookBusy = false;
    lastBook = -1;
    startIdle(0, 1); // api lilin langsung bergerak sejak masuk ke buku
    preloadBook();
    warmBook(0, 1);
    for (let i = BOOK.idleFrom; i < BOOK.count; i++) warmImg(bimages[i]); // frame idle di akhir video
    startBookBlend(pick(steps[TOTAL - 1].a), BOOK_FADE_MS);
    renderPage();
    updateBookButtons();
    drawBookIfNeeded();
    clearTimeout(bookEnterTimer);
    bookEnterTimer = setTimeout(() => {
        if (bookMode) {
            bookUI.classList.add("show");
            updateCopy();
        }
    }, BOOK_TEXT_DELAY_MS);
}

function exitBook() {
    if (!bookMode) return;
    clearTimeout(bookEnterTimer);
    bookMode = false;
    bookIdle = false;
    bookBusy = false;
    bookTextUp = false;
    bookQueued = 0;
    bookBlend = null;
    bookPage = 0;
    bookFrame = 0;
    bookUI.classList.remove("show", "turning");
    lastDrawn = -1;
}

// dir = +1 (next, putar maju) / -1 (previous, putar mundur)
// Video berputar sempurna, jadi dari posisi idle mana pun animasi dilanjutkan dari frame itu
// (maju atau mundur melewati sambungan akhir/awal video), tanpa loncat.
const frameOf = (x) => ((x % BOOK.count) + BOOK.count) % BOOK.count;

function playBook(dir, onDone, jumpTo) {
    const next = jumpTo !== undefined ? jumpTo : bookPage + dir; // jumpTo: lompat ke halaman tertentu dengan satu kali balik
    if (!bookMode || bookBusy || next < 0 || next >= BOOK_PAGES.length) return;
    bookBusy = true;
    bookTextUp = false;
    bookQueued = 0;
    const cur = bookIdle ? Math.round(bookFrame) : 0; // frame idle saat tombol ditekan
    bookIdle = false;
    bookUI.classList.add("turning");
    updateBookButtons();

    // tanpa idle: animasi diputar sampai frame paling akhir (halaman benar-benar selesai); dengan idle: sampai awal bagian diam
    const end = BOOK_IDLE_ENABLED ? BOOK.idleFrom : BOOK.count - 1;
    const swapAt = BOOK.idleFrom / 2; // teks berganti saat halaman di tengah gerakan
    // Koordinat "tak terputus": maju dari tail (cur - count) atau head (cur); mundur dari tail (cur) atau head (cur + count)
    const from =
        dir > 0
            ? cur >= end
                ? cur - BOOK.count
                : cur
            : cur <= BOOK.idleHeadEnd
              ? cur + BOOK.count
              : cur;
    const to = dir > 0 ? end : 0;

    const duration = (Math.abs(to - from) / BOOK.fps) * 1000;
    const t0 = performance.now();
    let swapped = false;
    let shown = false;

    function tick(now) {
        if (!bookMode) return; // user pergi dari buku
        const t = Math.min((now - t0) / duration, 1);
        const x = from + (to - from) * t;
        bookFrame = frameOf(x);
        warmBook(Math.round(bookFrame), dir);
        // ganti teks tepat saat halaman ada di tengah gerakan
        if (!swapped && (dir > 0 ? x >= swapAt : x <= swapAt)) {
            swapped = true;
            bookPage = next;
            renderPage();
        }
        // munculkan teks begitu halaman mendarat di video (tidak menunggu animasi benar-benar habis)
        if (
            swapped &&
            !shown &&
            (dir > 0 ? x >= BOOK_TEXT_SHOW_FWD : x <= BOOK_TEXT_SHOW_BACK)
        ) {
            shown = true;
            bookTextUp = true; // teks muncul = tombol next/prev langsung aktif
            bookUI.classList.remove("turning");
            updateBookButtons();
        }
        if (t < 1) return requestAnimationFrame(tick);
        bookFrame = to;
        warmBook(0, 1);
        startIdle(dir > 0 ? end : 0, dir); // lanjut ke idle melanjutkan arah gerak terakhir
        bookBusy = false;
        bookTextUp = false;
        bookUI.classList.remove("turning");
        updateBookButtons();
        if (onDone) onDone();
        if (bookQueued && bookMode) {
            const q = bookQueued;
            bookQueued = 0;
            playBook(q);
        }
    }
    requestAnimationFrame(tick);
}

// Menuju halaman tertentu lewat menu: cukup SATU kali balik halaman (maju/mundur sesuai arah),
// teks langsung berganti ke halaman tujuan.
function goPage(target) {
    if (!bookMode || bookPage === target) return;
    playBook(target > bookPage ? 1 : -1, undefined, target);
}

function bookClick(dir) {
    if (bookBusy) {
        // teks sudah muncul tapi sisa animasi belum habis: simpan klik, jalan otomatis begitu selesai
        const n = bookPage + dir;
        if (bookTextUp && n >= 0 && n < BOOK_PAGES.length) bookQueued = dir;
        return;
    }
    playBook(dir);
}
bookNext.addEventListener("click", () => bookClick(1));
bookPrev.addEventListener("click", () => bookClick(-1));

// ---- Snap scroll ----
const maxScroll = () => area.offsetHeight - window.innerHeight;
const stopY = (i) => area.offsetTop + maxScroll() * STOPS[i];

function nearestStage() {
    let best = 0;
    STOPS.forEach((p, i) => {
        if (Math.abs(progress - p) < Math.abs(progress - STOPS[best])) best = i;
    });
    return best;
}

// Easing sinus: mulai dan berhenti lembut
const ease = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

function saveStage() {
    try {
        sessionStorage.setItem("stage", String(stage));
    } catch (e) {}
}

function goTo(i) {
    i = Math.max(0, Math.min(STOPS.length - 1, i));
    if (bookMode && i < STOPS.length - 1) exitBook();
    stage = i;
    saveStage();
    const startY = window.scrollY;
    const endY = stopY(i);
    const dist = Math.abs(endY - startY);
    if (dist < 2) return;

    // lebih lambat = lebih halus
    const duration = 2000 + (dist / maxScroll()) * 4500;
    const t0 = performance.now();
    animating = true;

    function tick(now) {
        const t = Math.min((now - t0) / duration, 1);
        window.scrollTo(0, startY + (endY - startY) * ease(t));
        readScroll();
        current = target;
        // Munculkan teks buku lebih awal, selagi gerak scroll melambat di ujung
        if (t > BOOK_TEXT_EARLY && stage === STOPS.length - 1) showBookEarly();
        if (t < 1) requestAnimationFrame(tick);
        else {
            animating = false;
            lockUntil = performance.now() + 400;
            readScroll();
            if (stage === STOPS.length - 1) enterBook();
        }
    }
    requestAnimationFrame(tick);
}

// Mouse wheel
window.addEventListener(
    "wheel",
    (e) => {
        e.preventDefault();
        if (
            animating ||
            bookBusy ||
            menuOpen() ||
            performance.now() < lockUntil
        )
            return;
        if (Math.abs(e.deltaY) < 4) return;
        goTo(stage + (e.deltaY > 0 ? 1 : -1));
    },
    { passive: false },
);

// Sentuh (HP)
let touchY = null;
window.addEventListener("touchstart", (e) => (touchY = e.touches[0].clientY), {
    passive: true,
});
window.addEventListener("touchmove", (e) => e.preventDefault(), {
    passive: false,
});
window.addEventListener("touchend", (e) => {
    if (
        touchY === null ||
        animating ||
        bookBusy ||
        menuOpen() ||
        performance.now() < lockUntil
    )
        return;
    const dy = touchY - e.changedTouches[0].clientY;
    touchY = null;
    if (Math.abs(dy) > 40) goTo(stage + (dy > 0 ? 1 : -1));
});

// Keyboard
window.addEventListener("keydown", (e) => {
    if (bookMode && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault();
        playBook(e.key === "ArrowRight" ? 1 : -1);
        return;
    }
    const down = ["ArrowDown", "PageDown", " "].includes(e.key);
    const up = ["ArrowUp", "PageUp"].includes(e.key);
    if (!down && !up && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    if (animating || bookBusy || performance.now() < lockUntil) return;
    if (e.key === "Home") goTo(0);
    else if (e.key === "End") goTo(STOPS.length - 1);
    else goTo(stage + (down ? 1 : -1));
});

// Scrollbar diseret manual -> snap ke titik terdekat
window.addEventListener(
    "scroll",
    () => {
        if (animating) return;
        clearTimeout(snapTimer);
        snapTimer = setTimeout(() => {
            const n = nearestStage();
            stage = n;
            saveStage();
            if (Math.abs(window.scrollY - stopY(n)) > 2) goTo(n);
        }, 150);
    },
    { passive: true },
);

// Menu hamburger (layar kecil)
const nav = document.getElementById("nav");
const navToggle = document.getElementById("nav-toggle");
const menuOpen = () => nav && nav.classList.contains("open");
function setMenu(open) {
    if (!nav) return;
    nav.classList.toggle("open", open);
    if (navToggle) {
        navToggle.setAttribute("aria-expanded", String(open));
        navToggle.setAttribute("aria-label", open ? "Tutup menu" : "Buka menu");
    }
}
if (navToggle) navToggle.addEventListener("click", () => setMenu(!menuOpen()));
window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setMenu(false);
});

// Klik menu / dot
navLinks.forEach((a) => {
    a.addEventListener("click", (e) => {
        e.preventDefault();
        setMenu(false);
        if (animating || bookBusy) return;
        wantPage =
            a.dataset.page !== undefined ? pageIdx(a.dataset.page) : null;
        if (bookMode && wantPage !== null) {
            // sudah di buku: balik halaman dengan animasi sampai halaman tujuan
            const target = wantPage;
            wantPage = null;
            goPage(target);
            return;
        }
        const p = parseFloat(a.dataset.goto);
        let idx = 0;
        STOPS.forEach((st, i) => {
            if (Math.abs(st - p) < Math.abs(STOPS[idx] - p)) idx = i;
        });
        goTo(idx);
    });
});

// ---- Musik latar ----
// Browser memblokir suara otomatis, jadi musik mulai pada klik / ketukan / tombol pertama.
// Pilihan mute disimpan (localStorage) supaya tidak menyala lagi kalau sudah dimatikan.
const BGM = { src: "/audio/bgm.mp3", volume: 0.85, fadeMs: 1800 }; // volume 0-1 (1 = penuh)
const soundBtn = document.getElementById("sound-btn");
const bgm = new Audio(BGM.src);
bgm.loop = true;
bgm.preload = "auto";
bgm.volume = 0;
let bgmWanted = true; // pengguna ingin musik menyala
try {
    if (localStorage.getItem("bgm") === "off") bgmWanted = false;
} catch (e) {}
let bgmFade = null;

function bgmSetUI(on) {
    if (!soundBtn) return;
    soundBtn.classList.toggle("is-muted", !on);
    soundBtn.setAttribute("aria-pressed", String(on));
    soundBtn.setAttribute(
        "aria-label",
        on ? "Matikan musik" : "Nyalakan musik",
    );
}
function bgmFadeTo(target, then) {
    cancelAnimationFrame(bgmFade);
    const from = bgm.volume;
    const t0 = performance.now();
    (function step(now) {
        const k = Math.min(1, (now - t0) / BGM.fadeMs);
        bgm.volume = from + (target - from) * k;
        if (k < 1) bgmFade = requestAnimationFrame(step);
        else if (then) then();
    })(t0);
}
function bgmStart() {
    return bgm.play().then(() => {
        bgmSetUI(true);
        bgmFadeTo(BGM.volume);
        return true;
    });
}
function bgmStop() {
    bgmSetUI(false);
    cancelAnimationFrame(bgmFade); // mute: langsung mati, tanpa fade
    bgm.pause();
    bgm.volume = 0;
}
if (soundBtn) {
    soundBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!bgm.paused && bgmWanted) {
            bgmWanted = false;
            bgmStop();
        } else {
            bgmWanted = true;
            bgmStart().catch(() => {});
        }
        try {
            localStorage.setItem("bgm", bgmWanted ? "on" : "off");
        } catch (e) {}
    });
}
// Mulai otomatis pada interaksi pertama yang diizinkan browser (klik, ketuk, tombol keyboard)
function bgmAutoStart(e) {
    if (soundBtn && e && soundBtn.contains(e.target)) return; // klik tombol speaker diurus tombolnya sendiri
    if (!bgmWanted || !bgm.paused) return;
    bgmStart()
        .then(() =>
            ["pointerdown", "touchend", "keydown"].forEach((ev) =>
                window.removeEventListener(ev, bgmAutoStart),
            ),
        )
        .catch(() => {}); // diblokir: coba lagi di interaksi berikutnya
}
if (bgmWanted)
    ["pointerdown", "touchend", "keydown"].forEach((ev) =>
        window.addEventListener(ev, bgmAutoStart),
    );
// coba langsung (berhasil kalau browser mengizinkan, mis. sudah pernah berinteraksi dengan situs)
if (bgmWanted) bgmStart().catch(() => {});
// jeda saat tab disembunyikan
document.addEventListener("visibilitychange", () => {
    if (document.hidden) bgm.pause();
    else if (bgmWanted && bgm.paused && bgm.volume > 0)
        bgm.play().catch(() => {});
});

window.addEventListener("resize", () => {
    resize();
    readScroll();
});
window.addEventListener("scroll", readScroll, { passive: true });
window.addEventListener("load", () => {
    readScroll();
});

// Pulihkan posisi sendiri (bukan oleh browser) supaya langsung tepat di titik berhenti
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
try {
    const saved = parseInt(sessionStorage.getItem("stage"), 10);
    if (saved >= 0 && saved < STOPS.length) stage = saved;
} catch (e) {}
window.scrollTo(0, stopY(stage));

resize();
readScroll();
current = target;
if (stage === STOPS.length - 1) {
    pendingBookEnter = true; // masuk ke buku setelah loader hilang
    preloadBook(); // frame buku dimuat lebih dulu
}
preload();
loop();
