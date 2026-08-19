// ===== Firebase setup =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCLnWC-YBoJIxcznIhTmDuj8aBF1XJo7YU",
  authDomain: "fitness-app-f1d2e.firebaseapp.com",
  projectId: "fitness-app-f1d2e",
  storageBucket: "fitness-app-f1d2e.firebasestorage.app",
  messagingSenderId: "442200359348",
  appId: "1:442200359348:web:a41b2ab7298095e1b5f2e1",
  measurementId: "G-WBWXZZYJHZ"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
setPersistence(auth, browserLocalPersistence).catch(()=>{});

let currentUser = null;
let photoIndex = new Set();
let noteIndex = new Set();
let tagOverrides = new Map(); // exerciseId -> {type, materiaal, spiergroep}
let repsOverrides = new Map(); // exerciseId -> sets_reps string
let weightOverrides = new Map(); // exerciseId -> weight string (kg), only meaningful for Dumbells exercises
let deletedSet = new Set(); // exerciseIds (as strings) the user has hidden
let viewExercises = [];

const MONTH_ORDER = [
"Augustus 2023","November 2023","December 2023","Februari 2024","Maart 2024","April 2024","Mei 2024",
"Juni 2024","Juli 2024","Augustus 2024","September 2024","Oktober 2024","November 2024","December 2024",
"Januari 2025","Februari 2025","Maart 2025","April 2025","Mei 2025",
"Juni 2025","Juli 2025","Augustus 2025","September 2025","November 2025","December 2025",
"Januari 2026","Februari 2026","Maart 2026","April 2026","Juni 2026","Augustus 2026"
];
const monthIndex = m => MONTH_ORDER.indexOf(m);

const TYPE_ORDER = ["Kracht","Stabiliteit","Explosief","Stretch"];
const MATERIAAL_ORDER = ["Geen (bodyweight)","Dumbells","Rekker/elastiek","Swiss ball","Plyobox","Step",
  "Medicine ball","Fitnessbank","Aquabag","Airex kussen","Halterschijf","Gewichtje","Tafel/bank","Trap"];
const SPIER_ORDER = ["Quadriceps","Hamstrings","Glutei","Adductoren","Abductoren","Kuiten","Core","Buikspieren",
  "Rug","Schouders","Borst","Biceps","Triceps","Heupflexoren","Heupen","Stabiliteit/evenwicht"];
const BRON_ORDER = ["Kine (Febe)","Podokin (Lebbeke)"];

const state = { q: "", type: new Set(), materiaal: new Set(), spiergroep: new Set(), bron: new Set() };

function photoDocId(exId){ return `${currentUser.uid}_${exId}`; }

async function getPhotos(exId){
  try{
    const ref = doc(db, "exercisePhotos", photoDocId(exId));
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data().photos || []) : [];
  }catch(err){
    console.error("getPhotos error", err);
    return [];
  }
}

async function setPhotos(exId, photos){
  const ref = doc(db, "exercisePhotos", photoDocId(exId));
  await setDoc(ref, { uid: currentUser.uid, exerciseId: exId, photos });
  if(photos.length){ photoIndex.add(String(exId)); } else { photoIndex.delete(String(exId)); }
}

async function loadPhotoIndex(){
  photoIndex = new Set();
  try{
    const qy = query(collection(db, "exercisePhotos"), where("uid", "==", currentUser.uid));
    const snap = await getDocs(qy);
    snap.forEach(d => {
      const data = d.data();
      if(data.photos && data.photos.length) photoIndex.add(String(data.exerciseId));
    });
  }catch(e){ console.error("Kon foto-index niet laden", e); }
}

function effectiveExercise(ex){
  const o = tagOverrides.get(ex.id);
  const r = repsOverrides.get(ex.id);
  let merged = ex;
  if(o){
    merged = Object.assign({}, merged, {
      type: o.type || merged.type,
      materiaal: o.materiaal || merged.materiaal,
      spiergroep: o.spiergroep || merged.spiergroep
    });
  }
  if(r !== undefined){
    merged = Object.assign({}, merged, { sets_reps: r });
  }
  return merged;
}

async function loadTagOverrides(){
  tagOverrides = new Map();
  try{
    const qy = query(collection(db, "exerciseTags"), where("uid", "==", currentUser.uid));
    const snap = await getDocs(qy);
    snap.forEach(d => {
      const data = d.data();
      tagOverrides.set(data.exerciseId, { type: data.type||[], materiaal: data.materiaal||[], spiergroep: data.spiergroep||[] });
    });
  }catch(e){ console.error("Kon tag-aanpassingen niet laden", e); }
}

async function loadRepsOverrides(){
  repsOverrides = new Map();
  try{
    const qy = query(collection(db, "exerciseReps"), where("uid", "==", currentUser.uid));
    const snap = await getDocs(qy);
    snap.forEach(d => {
      const data = d.data();
      repsOverrides.set(data.exerciseId, data.sets_reps || "");
    });
  }catch(e){ console.error("Kon reps-aanpassingen niet laden", e); }
}

function rebuildViewExercises(){
  viewExercises = EXERCISES.filter(e => !deletedSet.has(String(e.id))).map(effectiveExercise);
}

async function loadDeletedSet(){
  deletedSet = new Set();
  try{
    const qy = query(collection(db, "exerciseDeleted"), where("uid", "==", currentUser.uid));
    const snap = await getDocs(qy);
    snap.forEach(d => {
      const data = d.data();
      deletedSet.add(String(data.exerciseId));
    });
  }catch(e){ console.error("Kon verborgen oefeningen niet laden", e); }
}

async function deleteExercise(exId){
  const ref = doc(db, "exerciseDeleted", `${currentUser.uid}_${exId}`);
  await setDoc(ref, { uid: currentUser.uid, exerciseId: exId, deleted: true });
  deletedSet.add(String(exId));
  rebuildViewExercises();
}

async function saveTagOverride(exId, tags){
  const ref = doc(db, "exerciseTags", `${currentUser.uid}_${exId}`);
  await setDoc(ref, { uid: currentUser.uid, exerciseId: exId, type: tags.type, materiaal: tags.materiaal, spiergroep: tags.spiergroep });
  tagOverrides.set(exId, tags);
  const idx = viewExercises.findIndex(e => e.id === exId);
  if(idx > -1){
    const base = EXERCISES.find(e => e.id === exId);
    viewExercises[idx] = effectiveExercise(base);
  }
}

async function resetTagOverride(exId){
  try{
    const ref = doc(db, "exerciseTags", `${currentUser.uid}_${exId}`);
    await deleteDoc(ref);
  }catch(e){ console.error("Kon tag-aanpassing niet verwijderen", e); }
  tagOverrides.delete(exId);
  const idx = viewExercises.findIndex(e => e.id === exId);
  if(idx > -1){
    const base = EXERCISES.find(e => e.id === exId);
    viewExercises[idx] = effectiveExercise(base);
  }
}

async function saveReps(exId, value){
  const ref = doc(db, "exerciseReps", `${currentUser.uid}_${exId}`);
  await setDoc(ref, { uid: currentUser.uid, exerciseId: exId, sets_reps: value });
  repsOverrides.set(exId, value);
  const idx = viewExercises.findIndex(e => e.id === exId);
  if(idx > -1){
    const base = EXERCISES.find(e => e.id === exId);
    viewExercises[idx] = effectiveExercise(base);
  }
}

async function loadWeightOverrides(){
  weightOverrides = new Map();
  try{
    const qy = query(collection(db, "exerciseWeights"), where("uid", "==", currentUser.uid));
    const snap = await getDocs(qy);
    snap.forEach(d => {
      const data = d.data();
      weightOverrides.set(data.exerciseId, data.weight || "");
    });
  }catch(e){ console.error("Kon gewicht-aanpassingen niet laden", e); }
}

async function saveWeight(exId, value){
  const ref = doc(db, "exerciseWeights", `${currentUser.uid}_${exId}`);
  await setDoc(ref, { uid: currentUser.uid, exerciseId: exId, weight: value });
  weightOverrides.set(exId, value);
}

// ===== Personal note per exercise (e.g. "laatst gedaan: 3x12") =====
async function getNote(exId){
  try{
    const ref = doc(db, "exerciseNotes", `${currentUser.uid}_${exId}`);
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data().note || "") : "";
  }catch(err){
    console.error("getNote error", err);
    return "";
  }
}

async function saveNote(exId, note){
  const ref = doc(db, "exerciseNotes", `${currentUser.uid}_${exId}`);
  await setDoc(ref, { uid: currentUser.uid, exerciseId: exId, note });
  if(note && note.trim()){ noteIndex.add(String(exId)); } else { noteIndex.delete(String(exId)); }
}

async function loadNoteIndex(){
  noteIndex = new Set();
  try{
    const qy = query(collection(db, "exerciseNotes"), where("uid", "==", currentUser.uid));
    const snap = await getDocs(qy);
    snap.forEach(d => {
      const data = d.data();
      if(data.note && data.note.trim()) noteIndex.add(String(data.exerciseId));
    });
  }catch(e){ console.error("Kon notitie-index niet laden", e); }
}

function fileToCompressedDataURL(file, maxDim=900, quality=0.62){
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if(width > maxDim || height > maxDim){
        if(width > height){ height = Math.round(height * maxDim/width); width = maxDim; }
        else{ width = Math.round(width * maxDim/height); height = maxDim; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function activeFilterCount(){
  return state.type.size + state.materiaal.size + state.spiergroep.size + state.bron.size;
}

function escapeAttr(str){
  return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function matches(ex){
  if(state.type.size && ![...state.type].every(t => ex.type.includes(t))) return false;
  if(state.materiaal.size && ![...state.materiaal].every(t => ex.materiaal.includes(t))) return false;
  if(state.spiergroep.size && ![...state.spiergroep].every(t => ex.spiergroep.includes(t))) return false;
  if(state.bron.size && !state.bron.has(ex.bron)) return false;
  if(state.q){
    const hay = [ex.naam, ex.beschrijving, ex.maand, ...ex.materiaal, ...ex.spiergroep, ...ex.type, ex.bron]
      .join(" ").toLowerCase();
    if(!hay.includes(state.q.toLowerCase())) return false;
  }
  return true;
}

function buildChips(){
  const build = (arr, containerId, cat) => {
    const el = document.getElementById(containerId);
    el.innerHTML = "";
    arr.forEach(val => {
      const b = document.createElement("button");
      b.className = "tag-chip";
      b.textContent = val;
      b.dataset.cat = cat;
      b.dataset.val = val;
      b.addEventListener("click", () => {
        const set = state[cat];
        if(set.has(val)) set.delete(val); else set.add(val);
        render();
      });
      el.appendChild(b);
    });
  };
  build(TYPE_ORDER, "chips-type", "type");
  build(MATERIAAL_ORDER, "chips-materiaal", "materiaal");
  build(SPIER_ORDER, "chips-spiergroep", "spiergroep");
  build(BRON_ORDER, "chips-bron", "bron");
}

function syncChipVisuals(){
  document.querySelectorAll("#filterPanel .tag-chip").forEach(b => {
    const on = state[b.dataset.cat].has(b.dataset.val);
    b.classList.toggle("on", on);
  });
}

function renderActiveChips(){
  const wrap = document.getElementById("activeChips");
  wrap.innerHTML = "";
  const all = [];
  state.type.forEach(v => all.push(["type", v]));
  state.materiaal.forEach(v => all.push(["materiaal", v]));
  state.spiergroep.forEach(v => all.push(["spiergroep", v]));
  state.bron.forEach(v => all.push(["bron", v]));
  all.forEach(([cat, val]) => {
    const chip = document.createElement("span");
    chip.className = "active-chip";
    chip.innerHTML = `${val} <button aria-label="Verwijder filter">×</button>`;
    chip.querySelector("button").addEventListener("click", () => { state[cat].delete(val); render(); });
    wrap.appendChild(chip);
  });
  const count = document.getElementById("filterCount");
  const n = activeFilterCount();
  count.hidden = n === 0;
  count.textContent = n;
}

function renderResults(){
  const main = document.getElementById("results");
  const empty = document.getElementById("emptyState");
  main.innerHTML = "";

  const filtered = viewExercises.filter(matches);
  document.getElementById("subcount").textContent = `${EXERCISES.length} oefeningen · ${filtered.length} getoond`;

  if(filtered.length === 0){
    empty.hidden = false;
    main.hidden = true;
    return;
  }
  empty.hidden = true;
  main.hidden = false;

  const sorted = filtered.slice().sort((a,b) => monthIndex(b.maand) - monthIndex(a.maand) || a.id - b.id);

  let lastMonth = null;
  sorted.forEach(ex => {
    if(ex.maand !== lastMonth){
      const h = document.createElement("div");
      h.className = "month-heading";
      h.textContent = ex.maand;
      main.appendChild(h);
      lastMonth = ex.maand;
    }
    main.appendChild(renderCard(ex));
  });
}

function renderCard(ex){
  const card = document.createElement("div");
  card.className = "card";
  const tags = [
    ...ex.type.map(t => `<span class="mini-tag type">${t}</span>`),
    ...ex.materiaal.filter(m => m !== "Geen (bodyweight)").map(t => `<span class="mini-tag">${t}</span>`),
    ...ex.spiergroep.map(t => `<span class="mini-tag">${t}</span>`),
  ].join("");
  const hasPhoto = photoIndex.has(String(ex.id));
  const hasNote = noteIndex.has(String(ex.id));
  const isDumbell = ex.materiaal.includes("Dumbells");
  const weight = weightOverrides.get(ex.id);
  const srText = [
    ex.sets_reps && ex.sets_reps !== "-" ? ex.sets_reps : null,
    isDumbell && weight ? `${weight}kg` : null
  ].filter(Boolean).join(" · ");
  card.innerHTML = `
    <div class="card-top">
      <div class="card-name">${ex.naam}</div>
      ${srText ? `<div class="card-sr">${srText}</div>` : ""}
    </div>
    <div class="card-tags">${tags}${hasPhoto ? '<span class="mini-tag card-video-dot">foto</span>' : ""}${hasNote ? '<span class="mini-tag card-video-dot">notitie</span>' : ""}</div>
  `;
  card.addEventListener("click", () => openDetail(ex));
  return card;
}

async function openDetail(ex){
  const overlay = document.getElementById("overlay");
  const sheet = document.getElementById("sheet");

  const tagHtml = (arr) => arr.map(t => `<span class="mini-tag">${t}</span>`).join("");

  // Show the sheet immediately so a Firestore hiccup never blocks the UI
  overlay.hidden = false;

  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <button class="sheet-close" id="sheetClose">×</button>
    <p class="sheet-eyebrow">${ex.maand} · ${ex.bron}</p>
    <h2 class="sheet-title">${ex.naam}</h2>
    <div class="sheet-meta">
      ${ex.level ? `<span><b>${ex.level}</b></span>` : ""}
      <span class="reps-edit-wrap">
        <input type="text" id="repsInput" class="reps-input" value="${escapeAttr(ex.sets_reps && ex.sets_reps !== "-" ? ex.sets_reps : "")}" placeholder="reps invullen">
      </span>
    </div>
    <p class="sheet-desc">${ex.beschrijving}</p>

    ${ex.materiaal.includes("Dumbells") ? `
    <div class="weight-section">
      <p class="sheet-tags-title">Gewicht (dumbells)</p>
      <div class="weight-input-wrap">
        <button type="button" id="weightMinus" class="weight-step-btn">−</button>
        <input type="number" id="weightInput" class="weight-input" min="1" max="12" step="0.5" placeholder="—" value="${escapeAttr(weightOverrides.get(ex.id) || "")}">
        <span class="weight-unit">kg</span>
        <button type="button" id="weightPlus" class="weight-step-btn">＋</button>
      </div>
      <p id="weightStatus" style="font-size:12px;color:var(--ink-soft);margin-top:6px;"></p>
    </div>
    ` : ""}

    <div class="note-section">
      <p class="sheet-tags-title">Eigen notitie</p>
      <input type="text" class="note-input" id="noteInput" placeholder="bv. laatst gedaan: 3x12" maxlength="200">
      <p id="noteStatus" style="font-size:12px;color:var(--ink-soft);margin-top:6px;"></p>
    </div>

    <p class="sheet-tags-title">Type</p>
    <div class="sheet-tags" id="sheetTagsType">${tagHtml(ex.type)}</div>
    <p class="sheet-tags-title">Materiaal</p>
    <div class="sheet-tags" id="sheetTagsMateriaal">${tagHtml(ex.materiaal)}</div>
    <p class="sheet-tags-title">Spiergroep</p>
    <div class="sheet-tags" id="sheetTagsSpiergroep">${tagHtml(ex.spiergroep)}</div>

    <button class="btn-ghost edit-tags-btn" id="editTagsBtn">Tags bewerken</button>
    <div class="tag-editor" id="tagEditor" hidden>
      <p class="filter-group-title">Type</p>
      <div class="chip-row" id="editorType"></div>
      <p class="filter-group-title">Materiaal</p>
      <div class="chip-row" id="editorMateriaal"></div>
      <p class="filter-group-title">Spiergroep</p>
      <div class="chip-row" id="editorSpiergroep"></div>
      <button class="btn-ghost reset-tags-btn" id="resetTagsBtn">Herstel standaard tags</button>
      <p id="tagEditStatus" style="font-size:12px;color:var(--ink-soft);margin-top:8px;"></p>
    </div>

    <div class="photo-section">
      <p class="sheet-tags-title">Eigen foto's</p>
      <div class="photo-grid" id="photoGrid"></div>
      <button class="add-photo-btn" id="addPhotoBtn">＋ Foto toevoegen</button>
      <input type="file" id="photoInput" accept="image/*" multiple hidden>
      <p id="photoStatus" style="font-size:12px;color:var(--ink-soft);margin-top:8px;"></p>
    </div>

    <div class="danger-section">
      <button class="delete-exercise-btn" id="deleteExerciseBtn">Oefening verwijderen</button>
      <p style="font-size:12px;color:var(--ink-soft);margin-top:6px;">Verbergt deze oefening enkel voor jou, bv. bij dubbels. De rest van je data blijft ongemoeid.</p>
    </div>
  `;

  // Wire up closing FIRST, before anything that could fail — the sheet must
  // always be dismissible no matter what goes wrong below.
  sheet.querySelector("#sheetClose").addEventListener("click", closeDetail);
  overlay.addEventListener("click", overlayClickClose);

  try{
    sheet.querySelector("#deleteExerciseBtn").addEventListener("click", async () => {
      const ok = confirm(`"${ex.naam}" verwijderen uit je lijst? Dit kan niet ongedaan worden gemaakt.`);
      if(!ok) return;
      try{
        await deleteExercise(ex.id);
        closeDetail();
        render();
      }catch(err){
        console.error("Kon oefening niet verwijderen", err);
        alert("Er ging iets mis bij het verwijderen. Probeer opnieuw.");
      }
    });
  }catch(err){
    console.error("Fout bij opbouwen van verwijderknop", err);
  }

  // ===== Editable reps/sets badge =====
  try{
    const repsInput = sheet.querySelector("#repsInput");
    let repsTimer = null;
    repsInput.addEventListener("input", () => {
      clearTimeout(repsTimer);
      repsTimer = setTimeout(async () => {
        try{
          await saveReps(ex.id, repsInput.value.trim());
          render();
        }catch(err){
          console.error("Kon reps niet opslaan", err);
        }
      }, 600);
    });
  }catch(err){
    console.error("Fout bij opbouwen van reps-veld", err);
  }

  // ===== Weight (dumbells only) =====
  try{
    const weightInput = sheet.querySelector("#weightInput");
    if(weightInput){
      const weightStatus = sheet.querySelector("#weightStatus");
      const weightMinus = sheet.querySelector("#weightMinus");
      const weightPlus = sheet.querySelector("#weightPlus");
      let weightTimer = null;

      async function commitWeight(v){
        weightStatus.textContent = "Opslaan…";
        try{
          await saveWeight(ex.id, v);
          weightStatus.textContent = "Opgeslagen.";
          render();
          setTimeout(() => { if(weightStatus.textContent === "Opgeslagen.") weightStatus.textContent = ""; }, 1200);
        }catch(err){
          console.error(err);
          weightStatus.textContent = "Kon niet opslaan.";
        }
      }

      weightInput.addEventListener("input", () => {
        let v = weightInput.value;
        clearTimeout(weightTimer);
        weightTimer = setTimeout(() => {
          // clamp to the 1–12 kg range, but allow empty (clears the value)
          if(v !== ""){
            let num = parseFloat(v.replace(",", "."));
            if(isNaN(num)) num = "";
            else num = Math.min(12, Math.max(1, num));
            v = num === "" ? "" : String(num);
            weightInput.value = v;
          }
          commitWeight(v);
        }, 600);
      });

      // Steps: whole kg up to and including 10, half kg above 10.
      weightPlus.addEventListener("click", () => {
        clearTimeout(weightTimer);
        const current = parseFloat(weightInput.value) || 0;
        const step = current < 10 ? 1 : 0.5;
        const next = Math.min(12, Math.round((current + step) * 2) / 2);
        weightInput.value = String(next);
        commitWeight(String(next));
      });
      weightMinus.addEventListener("click", () => {
        clearTimeout(weightTimer);
        const current = parseFloat(weightInput.value) || 1;
        const step = current <= 10 ? 1 : 0.5;
        const next = Math.max(1, Math.round((current - step) * 2) / 2);
        weightInput.value = String(next);
        commitWeight(String(next));
      });
    }
  }catch(err){
    console.error("Fout bij opbouwen van gewicht-veld", err);
  }

  // ===== Personal note =====
  try{
    const noteInput = sheet.querySelector("#noteInput");
    const noteStatus = sheet.querySelector("#noteStatus");
    getNote(ex.id).then(note => { noteInput.value = note; });
    let noteTimer = null;
    noteInput.addEventListener("input", () => {
      noteStatus.textContent = "Typen…";
      clearTimeout(noteTimer);
      noteTimer = setTimeout(async () => {
        noteStatus.textContent = "Opslaan…";
        try{
          await saveNote(ex.id, noteInput.value);
          noteStatus.textContent = "Opgeslagen.";
          render();
          setTimeout(() => { if(noteStatus.textContent === "Opgeslagen.") noteStatus.textContent = ""; }, 1200);
        }catch(err){
          console.error(err);
          noteStatus.textContent = "Kon niet opslaan.";
        }
      }, 600);
    });
  }catch(err){
    console.error("Fout bij opbouwen van notitieveld", err);
  }

  const grid = sheet.querySelector("#photoGrid");
  const statusEl = sheet.querySelector("#photoStatus");

  try{

  function renderPhotos(list){
    grid.innerHTML = "";
    list.forEach((src, i) => {
      const t = document.createElement("div");
      t.className = "photo-thumb";
      t.innerHTML = `<img src="${src}"><button aria-label="Verwijder foto">×</button>`;
      t.querySelector("button").addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = confirm("Deze foto verwijderen? Dit kan niet ongedaan worden gemaakt.");
        if(!ok) return;
        statusEl.textContent = "Verwijderen…";
        const all = await getPhotos(ex.id);
        const updated = all.filter((_,idx)=>idx!==i);
        await setPhotos(ex.id, updated);
        renderPhotos(updated);
        statusEl.textContent = "";
      });
      grid.appendChild(t);
    });
  }

  statusEl.textContent = "Laden…";
  let photos = [];
  try{
    photos = await getPhotos(ex.id);
  }catch(err){
    console.error("Kon foto's niet laden", err);
  }
  renderPhotos(photos);
  statusEl.textContent = "";

  sheet.querySelector("#addPhotoBtn").addEventListener("click", () => sheet.querySelector("#photoInput").click());
  sheet.querySelector("#photoInput").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    if(!files.length) return;
    statusEl.textContent = "Foto's verwerken…";
    try{
      const current = await getPhotos(ex.id);
      const compressed = [];
      for(const file of files){
        compressed.push(await fileToCompressedDataURL(file));
      }
      const updated = [...current, ...compressed];
      await setPhotos(ex.id, updated);
      renderPhotos(updated);
      statusEl.textContent = "";
    }catch(err){
      console.error(err);
      statusEl.textContent = "Er ging iets mis bij het opslaan.";
    }
  });

  // ===== Tag editor =====
  let workingTags = { type: [...ex.type], materiaal: [...ex.materiaal], spiergroep: [...ex.spiergroep] };
  const editTagsBtn = sheet.querySelector("#editTagsBtn");
  const tagEditor = sheet.querySelector("#tagEditor");
  const tagEditStatus = sheet.querySelector("#tagEditStatus");

  function refreshTagDisplays(){
    sheet.querySelector("#sheetTagsType").innerHTML = tagHtml(workingTags.type);
    sheet.querySelector("#sheetTagsMateriaal").innerHTML = tagHtml(workingTags.materiaal);
    sheet.querySelector("#sheetTagsSpiergroep").innerHTML = tagHtml(workingTags.spiergroep);
  }

  function buildEditorChips(containerId, options, cat){
    const el = sheet.querySelector("#" + containerId);
    el.innerHTML = "";
    options.forEach(val => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tag-chip" + (workingTags[cat].includes(val) ? " on" : "");
      b.textContent = val;
      b.addEventListener("click", async () => {
        const idx = workingTags[cat].indexOf(val);
        if(idx > -1){ workingTags[cat].splice(idx, 1); } else { workingTags[cat].push(val); }
        b.classList.toggle("on");
        refreshTagDisplays();
        tagEditStatus.textContent = "Opslaan…";
        try{
          await saveTagOverride(ex.id, workingTags);
          tagEditStatus.textContent = "Opgeslagen.";
          render();
          setTimeout(() => { if(tagEditStatus.textContent === "Opgeslagen.") tagEditStatus.textContent = ""; }, 1500);
        }catch(err){
          console.error(err);
          tagEditStatus.textContent = "Kon niet opslaan — probeer opnieuw.";
        }
      });
      el.appendChild(b);
    });
  }

  editTagsBtn.addEventListener("click", () => {
    const opening = tagEditor.hidden;
    tagEditor.hidden = !opening;
    editTagsBtn.textContent = opening ? "Tags verbergen" : "Tags bewerken";
    if(opening){
      buildEditorChips("editorType", TYPE_ORDER, "type");
      buildEditorChips("editorMateriaal", MATERIAAL_ORDER, "materiaal");
      buildEditorChips("editorSpiergroep", SPIER_ORDER, "spiergroep");
    }
  });

  sheet.querySelector("#resetTagsBtn").addEventListener("click", async () => {
    tagEditStatus.textContent = "Herstellen…";
    try{
      await resetTagOverride(ex.id);
      const base = EXERCISES.find(e => e.id === ex.id);
      workingTags = { type: [...base.type], materiaal: [...base.materiaal], spiergroep: [...base.spiergroep] };
      refreshTagDisplays();
      buildEditorChips("editorType", TYPE_ORDER, "type");
      buildEditorChips("editorMateriaal", MATERIAAL_ORDER, "materiaal");
      buildEditorChips("editorSpiergroep", SPIER_ORDER, "spiergroep");
      tagEditStatus.textContent = "Teruggezet naar standaard.";
      render();
      setTimeout(() => { if(tagEditStatus.textContent === "Teruggezet naar standaard.") tagEditStatus.textContent = ""; }, 1500);
    }catch(err){
      console.error(err);
      tagEditStatus.textContent = "Kon niet herstellen — probeer opnieuw.";
    }
  });
  }catch(err){
    console.error("Fout bij opbouwen van foto's/tags-sectie", err);
  }
}
function overlayClickClose(e){ if(e.target.id === "overlay") closeDetail(); }
function closeDetail(){
  document.getElementById("overlay").hidden = true;
}

function render(){
  syncChipVisuals();
  renderActiveChips();
  renderResults();
}

function wireControls(){
  document.getElementById("search").addEventListener("input", (e) => { state.q = e.target.value; render(); });

  const filterToggle = document.getElementById("filterToggle");
  const filterPanel = document.getElementById("filterPanel");
  filterToggle.addEventListener("click", () => {
    const open = filterPanel.hidden;
    filterPanel.hidden = !open;
    filterToggle.setAttribute("aria-expanded", String(open));
  });
  document.getElementById("applyFilters").addEventListener("click", () => {
    filterPanel.hidden = true;
    filterToggle.setAttribute("aria-expanded","false");
  });
  document.getElementById("clearFilters").addEventListener("click", () => {
    state.type.clear(); state.materiaal.clear(); state.spiergroep.clear(); state.bron.clear();
    render();
  });
  document.getElementById("emptyReset").addEventListener("click", () => {
    state.q = ""; document.getElementById("search").value = "";
    state.type.clear(); state.materiaal.clear(); state.spiergroep.clear(); state.bron.clear();
    render();
  });
  document.getElementById("logoutBtn").addEventListener("click", () => {
    signOut(auth).then(() => location.reload());
  });
}

let wired = false;
async function bootApp(){
  if(!wired){ buildChips(); wireControls(); wired = true; }
  document.getElementById("userEmail").textContent = currentUser.email;
  await loadPhotoIndex();
  await loadTagOverrides();
  await loadRepsOverrides();
  await loadNoteIndex();
  await loadWeightOverrides();
  await loadDeletedSet();
  rebuildViewExercises();
  render();
}

const authScreen = document.getElementById("authScreen");
const appRoot = document.getElementById("appRoot");
const authForm = document.getElementById("authForm");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authError = document.getElementById("authError");

function friendlyAuthError(err){
  const code = err.code || "";
  if(code.includes("wrong-password") || code.includes("invalid-credential")) return "Fout e-mailadres of wachtwoord.";
  if(code.includes("user-not-found")) return "Geen account gevonden met dit e-mailadres.";
  if(code.includes("invalid-email")) return "Ongeldig e-mailadres.";
  if(code.includes("network-request-failed")) return "Geen internetverbinding — probeer opnieuw.";
  return "Er ging iets mis: " + code;
}

async function doLogin(){
  authError.textContent = "";
  try{
    await signInWithEmailAndPassword(auth, authEmail.value.trim(), authPassword.value);
  }catch(err){
    authError.textContent = friendlyAuthError(err);
  }
}

authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  doLogin();
});

onAuthStateChanged(auth, (user) => {
  if(user){
    currentUser = user;
    authScreen.hidden = true;
    appRoot.hidden = false;
    bootApp();
  }else{
    currentUser = null;
    authScreen.hidden = false;
    appRoot.hidden = true;
    doLogin(); // fields are pre-filled, so this logs in without the person having to tap anything
  }
});
