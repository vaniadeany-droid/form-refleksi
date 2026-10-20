// 1) Tempel URL Apps Script (yang berakhiran /exec) di sini:
const API_URL = 'https://script.google.com/macros/s/AKfycbxobWYr2uP6Zof2KcX7X4uV6epiDSJdRNF5ew_rvloj6BSp5yguDwnKwSHw6s6hqXo/exec';
const MAX_SEC = 300; // 5 menit

const DIVISI = ['IT Support', 'QA Engineer', 'Business Growth', 'Product Technical Writer', 'HRGA'];
const DEPT = ['Business Solution', 'IT', 'HRGA', 'Product'];

// Pertanyaan dengan jawaban suara/ketik
const AUDIO_QS = [
  [1, 'Dari seluruh tugas yang Anda pegang saat ini, sebutkan tugas atau proyek apa saja yang sudah mampu Anda eksekusi secara mandiri tanpa memerlukan arahan detail dari mentor/atasan.'],
  [2, "Ceritakan pengalaman Anda ketika mengambil porsi kerja atau proyek yang sebenarnya berada di luar scope tugas utama Anda. (Jika belum pernah, katakan 'Belum pernah')."],
  [4, 'Jelaskan secara singkat alasan dari tingkat kepercayaan diri Anda pada pertanyaan sebelumnya.'],
  [5, 'Sebutkan skill (teknis atau non-teknis) yang sebelumnya belum Anda kuasai, namun berhasil Anda pelajari dan terapkan selama masa kontrak di sini.'],
  [6, 'Menurut Anda, skill unggulan apa yang Anda miliki saat ini yang belum maksimal dimanfaatkan, yang mungkin bisa diimplementasikan untuk posisi Anda sekarang atau posisi lain?'],
  [7, 'Jika perusahaan memfasilitasi Anda untuk belajar satu hal/skill baru di luar pekerjaan Anda saat ini, apa yang ingin Anda pelajari dan mengapa?'],
  [8, 'Seberapa jauh peran Anda saat ini sejalan dengan minat karier jangka panjang Anda? Ceritakan alasannya.'],
  [9, 'Ceritakan satu tugas/pekerjaan yang sebenarnya kurang sesuai dengan minat Anda, namun tetap harus Anda kerjakan selama di sini. Bagaimana cara Anda menyelesaikannya?']
];
const Q3 = 'Seberapa percaya diri Anda jika diberikan tugas baru yang mengharuskan Anda belajar secara mandiri (otodidak) dari nol?';
const Q10 = 'Jika Anda dilibatkan dalam sebuah proyek besar, peran manakah yang secara natural paling ingin Anda ambil? (Pilih salah satu)';
const Q10_OPTS = [
  'Melakukan brainstorming, mencari ide, dan merancang konsep awal.',
  'Menganalisis data, memecahkan masalah, atau merumuskan strategi.',
  'Mengatur jadwal, merapikan dokumen, dan memastikan seluruh data tertata rapi.',
  'Menjadi penghubung antar tim, melakukan presentasi, atau bernegosiasi.'
];
const Q11 = 'Pilih maksimal 3 aktivitas kerja yang paling membuat Anda merasa energik dan produktif:';
const Q11_OPTS = [
  'Mengeksplorasi tren dan ide baru.',
  'Melakukan data entry atau rekapitulasi yang presisi.',
  'Berinteraksi dan membantu kendala rekan kerja/klien.',
  'Menyusun guideline, SOP, atau laporan terstruktur.',
  'Mencari akar masalah dari sebuah error/kegagalan.'
];

const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];
const fmt = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
const options = list => list.map(o => `<option>${o}</option>`).join('');
const choices = (type, name, list) => list.map(o =>
  `<label class="opt"><input type="${type}" name="${name}" value="${o}"> ${o}</label>`).join('');

const recordings = {}; // nomor pertanyaan -> {blob, mime}
let stopActive = null;

function render() {
  let html = `<section class="card">
    <label class="field">Nama lengkap *<input type="text" id="nama" autocomplete="name"></label>
    <label class="field">Divisi *<select id="divisi"><option value="">Pilih divisi</option>${options(DIVISI)}</select></label>
    <label class="field">Departemen *<select id="dept"><option value="">Pilih departemen</option>${options(DEPT)}</select></label>
  </section>`;

  const audioCard = ([n, text]) => `<section class="card" data-q="${n}">
    <h3>${n}. ${text}</h3>
    <div class="rec"><button type="button" class="b-rec">🎤 Rekam jawaban</button><span class="timer">0:00 / 5:00</span></div>
    <audio controls hidden></audio>
    <details><summary>Ketik jawaban (bisa bersama rekaman, atau sebagai pengganti)</summary><textarea rows="4"></textarea></details>
  </section>`;

  html += audioCard(AUDIO_QS[0]) + audioCard(AUDIO_QS[1]);
  html += `<section class="card"><h3>3. ${Q3}</h3>
    <p class="hint">1 = Sangat tidak yakin, 5 = Sangat yakin</p>
    <div class="scale">${[1, 2, 3, 4, 5].map(i => `<label><input type="radio" name="q3" value="${i}">${i}</label>`).join('')}</div></section>`;
  html += AUDIO_QS.slice(2).map(audioCard).join('');
  html += `<section class="card"><h3>10. ${Q10}</h3>${choices('radio', 'q10', Q10_OPTS)}</section>`;
  html += `<section class="card"><h3>11. ${Q11}</h3>${choices('checkbox', 'q11', Q11_OPTS)}</section>`;
  $('#form').innerHTML = html;

  $$('.card[data-q]').forEach(setupRecorder);
  $$('input[name=q11]').forEach(c => c.onchange = () => {
    if ($$('input[name=q11]:checked').length > 3) { c.checked = false; alert('Pilih maksimal 3 aktivitas.'); }
  });
}

function setupRecorder(card) {
  const q = card.dataset.q, btn = $('.b-rec', card), timer = $('.timer', card), player = $('audio', card);
  let rec, chunks, tick, sec;
  const stop = () => { if (rec && rec.state === 'recording') rec.stop(); };

  btn.onclick = async () => {
    if (rec && rec.state === 'recording') return stop();
    if (stopActive) stopActive();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
      chunks = []; sec = 0;
      rec.ondataavailable = e => chunks.push(e.data);
      rec.onstop = () => {
        clearInterval(tick);
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: mime });
        recordings[q] = { blob, mime };
        player.src = URL.createObjectURL(blob); player.hidden = false;
        btn.textContent = '🔁 Rekam ulang'; btn.classList.remove('recording');
        stopActive = null;
      };
      rec.start();
      stopActive = stop;
      btn.textContent = '⏹ Berhenti'; btn.classList.add('recording');
      tick = setInterval(() => {
        sec++; timer.textContent = fmt(sec) + ' / 5:00';
        if (sec >= MAX_SEC) stop();
      }, 1000);
    } catch (e) {
      alert('Mikrofon tidak bisa diakses. Izinkan mikrofon di browser, atau ketik jawaban Anda.');
    }
  };
}

function setStatus(msg, isErr) {
  const s = $('#status'); s.textContent = msg; s.className = isErr ? 'err' : '';
}

const toBase64 = blob => new Promise(res => {
  const r = new FileReader();
  r.onload = () => res(r.result.split(',')[1]);
  r.readAsDataURL(blob);
});

async function post(payload) {
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(API_URL)) {
    throw new Error('URL Apps Script belum diisi dengan benar di script.js (harus berakhiran /exec)');
  }
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // menghindari masalah CORS di Apps Script
    body: JSON.stringify(payload)
  });
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch (e) {
    throw new Error('Server tidak membalas dengan benar (status ' + r.status + '). Cek deployment Apps Script: akses harus "Anyone" dan sudah New version');
  }
  if (!j.ok) throw new Error(j.error || 'Gagal menyimpan');
  return j;
}

async function submit() {
  const nama = $('#nama').value.trim(), divisi = $('#divisi').value, dept = $('#dept').value;
  if (!nama || !divisi || !dept) return setStatus('Lengkapi nama, divisi, dan departemen.', true);

  const teks = {};
  for (const [n] of AUDIO_QS) {
    teks[n] = $(`.card[data-q="${n}"] textarea`).value.trim();
    if (!recordings[n] && !teks[n]) return setStatus(`Pertanyaan ${n} belum dijawab (rekam atau ketik).`, true);
  }
  const q3 = ($('input[name=q3]:checked') || {}).value;
  const q10 = ($('input[name=q10]:checked') || {}).value;
  const q11 = $$('input[name=q11]:checked').map(c => c.value);
  if (!q3) return setStatus('Pertanyaan 3 belum dijawab.', true);
  if (!q10) return setStatus('Pertanyaan 10 belum dijawab.', true);
  if (!q11.length) return setStatus('Pertanyaan 11 belum dijawab.', true);

  $('#submit').disabled = true;
  const id = Date.now().toString(36);
  const audio = {};
  try {
    const keys = Object.keys(recordings);
    for (let i = 0; i < keys.length; i++) {
      setStatus(`Mengunggah rekaman ${i + 1} dari ${keys.length}… jangan tutup halaman ini.`);
      const { blob, mime } = recordings[keys[i]];
      const res = await post({
        action: 'audio', id, nama, q: keys[i], mime,
        ext: mime.includes('webm') ? 'webm' : 'm4a', data: await toBase64(blob)
      });
      audio[keys[i]] = res.url;
    }
    setStatus('Menyimpan jawaban…');
    await post({ action: 'submit', id, nama, divisi, dept, teks, audio, q3, q10, q11 });
    $('main').innerHTML = '<h1>Terima kasih!</h1><p class="intro">Jawaban Anda sudah terkirim. Halaman ini boleh ditutup.</p>';
  } catch (e) {
    setStatus('Gagal mengirim: ' + e.message + '. Periksa koneksi lalu coba lagi.', true);
    $('#submit').disabled = false;
  }
}

render();
$('#submit').onclick = submit;
