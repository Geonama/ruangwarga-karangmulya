const STORAGE_KEY = "ruangwarga.records.v1";
const API_BASE = String(window.RUANGWARGA_API_BASE || "").replace(/\/$/, "");
const API_MODE = Boolean(API_BASE);

const statusFlow = ["Diterima", "Diverifikasi", "Diproses", "Selesai"];
const initialRecords = [
  {
    id: "RW-2026-1042",
    type: "Surat",
    name: "Alya Nuraini",
    detail: "Surat Keterangan Domisili",
    location: "RT 02/RW 04",
    fileName: "ktp-alya.pdf",
    status: "Diproses",
    createdAt: "2026-05-07T09:10:00.000Z",
  },
  {
    id: "RW-2026-1047",
    type: "Pengaduan",
    name: "Dimas Ardiansyah",
    detail: "Lampu jalan",
    location: "Jl. Kenanga dekat pos ronda",
    fileName: "lampu-jalan.jpg",
    status: "Diverifikasi",
    createdAt: "2026-05-07T12:24:00.000Z",
  },
  {
    id: "RW-2026-1051",
    type: "Surat",
    name: "Maya Salsabila",
    detail: "Surat Keterangan Usaha",
    location: "RT 05/RW 01",
    fileName: "berkas-usaha.pdf",
    status: "Selesai",
    createdAt: "2026-05-08T02:02:00.000Z",
  },
];

const state = {
  records: [],
  activeView: "dashboard",
};

const els = {
  pageTitle: document.querySelector("#pageTitle"),
  navButtons: document.querySelectorAll("[data-view-link]"),
  views: document.querySelectorAll(".view"),
  letterForm: document.querySelector("#letterForm"),
  complaintForm: document.querySelector("#complaintForm"),
  trackingForm: document.querySelector("#trackingForm"),
  trackingInput: document.querySelector("#trackingInput"),
  trackingResult: document.querySelector("#trackingResult"),
  ticketCloud: document.querySelector("#ticketCloud"),
  ticketCount: document.querySelector("#ticketCount"),
  adminTable: document.querySelector("#adminTable"),
  adminFilter: document.querySelector("#adminFilter"),
  activityList: document.querySelector("#activityList"),
  toast: document.querySelector("#toast"),
  metricLetters: document.querySelector("#metricLetters"),
  metricComplaints: document.querySelector("#metricComplaints"),
  metricDone: document.querySelector("#metricDone"),
};

document.addEventListener("DOMContentLoaded", async () => {
  bindNavigation();
  bindForms();
  bindAdmin();
  setMinimumPickupDate();
  await refreshRecords();
  renderAll();
});

function bindNavigation() {
  els.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.viewLink;
      if (target) showView(target);
    });
  });
}

function bindForms() {
  els.letterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const record = await submitLetter(form);
    formElement.reset();
    setMinimumPickupDate();
    showToast(`Pengajuan terkirim. Kode tiket: ${record.id}`);
    showView("tracking");
    renderTracking(record.id);
  });

  els.complaintForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const record = await submitComplaint(form);
    formElement.reset();
    showToast(`Pengaduan diterima. Kode tiket: ${record.id}`);
    showView("tracking");
    renderTracking(record.id);
  });

  els.trackingForm.addEventListener("submit", (event) => {
    event.preventDefault();
    renderTracking(els.trackingInput.value);
  });
}

function bindAdmin() {
  els.adminFilter.addEventListener("change", renderAdminTable);
  els.adminTable.addEventListener("change", async (event) => {
    const select = event.target.closest("[data-status-id]");
    if (!select) return;
    const record = state.records.find((item) => item.id === select.dataset.statusId);
    if (!record) return;
    const previousStatus = record.status;
    record.status = select.value;
    renderAll();

    try {
      if (API_MODE) {
        await apiRequest(`/api/records/${record.id}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: record.status }),
        });
        await refreshRecords();
      } else {
        saveLocalRecords();
      }
      renderAll();
      showToast(`Status ${record.id} diperbarui menjadi ${record.status}.`);
    } catch (error) {
      record.status = previousStatus;
      renderAll();
      showToast(error.message || "Status belum berhasil diperbarui.");
    }
  });
}

async function submitLetter(form) {
  if (API_MODE) {
    const record = await apiRequest("/api/letters", { method: "POST", body: form });
    await refreshRecords();
    return record;
  }

  const file = form.get("file");
  return addLocalRecord({
    id: createTicketId(),
    type: "Surat",
    name: clean(form.get("name")),
    nik: clean(form.get("nik")),
    detail: clean(form.get("service")),
    location: clean(form.get("address")),
    fileName: file?.name || "dokumen-pendukung",
    status: "Diterima",
    createdAt: new Date().toISOString(),
    pickup: form.get("pickup"),
  });
}

async function submitComplaint(form) {
  if (API_MODE) {
    const record = await apiRequest("/api/complaints", { method: "POST", body: form });
    await refreshRecords();
    return record;
  }

  const file = form.get("file");
  return addLocalRecord({
    id: createTicketId(),
    type: "Pengaduan",
    name: clean(form.get("name")),
    detail: clean(form.get("category")),
    location: clean(form.get("location")),
    description: clean(form.get("description")),
    fileName: file?.name || "foto-laporan",
    status: "Diterima",
    createdAt: new Date().toISOString(),
  });
}

async function refreshRecords() {
  try {
    state.records = API_MODE ? await apiRequest("/api/records") : loadLocalRecords();
  } catch (error) {
    state.records = loadLocalRecords();
    showToast("API belum terhubung. Website masuk mode demo lokal.");
  }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `Request gagal: ${response.status}`);
  }
  return data;
}

function showView(viewId) {
  state.activeView = viewId;
  els.views.forEach((view) => view.classList.toggle("active", view.id === viewId));
  els.navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.viewLink === viewId);
  });

  const titles = {
    dashboard: "RuangWarga Karangmulya",
    layanan: "Pengajuan Surat",
    pengaduan: "Pengaduan Warga",
    tracking: "Lacak Tiket",
    admin: "Antrean Layanan",
  };
  els.pageTitle.textContent = titles[viewId] || "RuangWarga Karangmulya";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function addLocalRecord(record) {
  state.records.unshift(record);
  saveLocalRecords();
  renderAll();
  return record;
}

function loadLocalRecords() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initialRecords));
  return [...initialRecords];
}

function saveLocalRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
}

function renderAll() {
  renderMetrics();
  renderActivity();
  renderTickets();
  renderAdminTable();
}

function renderMetrics() {
  const letters = state.records.filter((record) => record.type === "Surat").length;
  const complaints = state.records.filter((record) => record.type === "Pengaduan").length;
  const done = state.records.filter((record) => record.status === "Selesai").length;
  els.metricLetters.textContent = letters;
  els.metricComplaints.textContent = complaints;
  els.metricDone.textContent = done;
}

function renderActivity() {
  const items = state.records.slice(0, 4);
  if (!items.length) {
    els.activityList.innerHTML = `<div class="empty-state">Belum ada aktivitas layanan.</div>`;
    return;
  }

  els.activityList.innerHTML = items
    .map(
      (record) => `
        <div class="activity-item">
          <strong>${record.id}</strong>
          <span>${record.type} - ${escapeHtml(record.detail)} untuk ${escapeHtml(record.name)}</span>
          ${statusBadge(record.status)}
        </div>
      `,
    )
    .join("");
}

function renderTickets() {
  els.ticketCount.textContent = `${state.records.length} tiket`;
  els.ticketCloud.innerHTML = state.records
    .slice(0, 8)
    .map((record) => `<button class="ticket-chip" type="button" data-ticket="${record.id}">${record.id}</button>`)
    .join("");

  els.ticketCloud.querySelectorAll("[data-ticket]").forEach((button) => {
    button.addEventListener("click", () => renderTracking(button.dataset.ticket));
  });
}

function renderTracking(ticketId) {
  const id = clean(ticketId).toUpperCase();
  els.trackingInput.value = id;
  const record = state.records.find((item) => item.id.toUpperCase() === id);

  if (!record) {
    els.trackingResult.innerHTML = `<div class="empty-state">Tiket tidak ditemukan. Periksa kembali kode layanan.</div>`;
    return;
  }

  const activeIndex = statusFlow.indexOf(record.status);
  els.trackingResult.innerHTML = `
    <article class="ticket-card">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">${record.type}</p>
          <h2>${record.id}</h2>
        </div>
        ${statusBadge(record.status)}
      </div>
      <div class="ticket-meta">
        <div><span>Nama</span><strong>${escapeHtml(record.name)}</strong></div>
        <div><span>Layanan</span><strong>${escapeHtml(record.detail)}</strong></div>
        <div><span>Berkas</span><strong>${escapeHtml(record.fileName)}</strong></div>
      </div>
      <div class="timeline">
        ${statusFlow
          .map(
            (step, index) => `
              <div class="timeline-step ${index <= activeIndex ? "active" : ""}">
                <span class="timeline-dot"></span>
                <div>
                  <strong>${step}</strong>
                  <p>${timelineCopy(step, record)}</p>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderAdminTable() {
  const filter = els.adminFilter.value;
  const rows = state.records.filter((record) => filter === "all" || record.status === filter);

  if (!rows.length) {
    els.adminTable.innerHTML = `<tr><td colspan="6"><div class="empty-state">Tidak ada antrean pada status ini.</div></td></tr>`;
    return;
  }

  els.adminTable.innerHTML = rows
    .map(
      (record) => `
      <tr>
        <td><strong>${record.id}</strong><br><span>${formatDate(record.createdAt)}</span></td>
        <td>${record.type}</td>
        <td>${escapeHtml(record.name)}</td>
        <td>${escapeHtml(record.detail)}<br><span>${escapeHtml(record.location)}</span></td>
        <td>${escapeHtml(record.fileName)}</td>
        <td>
          <select data-status-id="${record.id}" aria-label="Status ${record.id}">
            ${statusFlow.map((status) => `<option ${status === record.status ? "selected" : ""}>${status}</option>`).join("")}
          </select>
        </td>
      </tr>
    `,
    )
    .join("");
}

function createTicketId() {
  const year = new Date().getFullYear();
  const number = Math.floor(1000 + Math.random() * 9000);
  const id = `RW-${year}-${number}`;
  return state.records.some((record) => record.id === id) ? createTicketId() : id;
}

function setMinimumPickupDate() {
  const input = els.letterForm.querySelector('input[name="pickup"]');
  const today = new Date();
  today.setDate(today.getDate() + 1);
  input.min = today.toISOString().slice(0, 10);
}

function timelineCopy(step, record) {
  const copy = {
    Diterima: `Data masuk pada ${formatDate(record.createdAt)}.`,
    Diverifikasi: "Petugas memeriksa kelengkapan data dan berkas.",
    Diproses: record.type === "Surat" ? "Dokumen sedang disiapkan untuk ditandatangani." : "Laporan diteruskan ke petugas lapangan.",
    Selesai: record.type === "Surat" ? "Dokumen siap diambil di loket." : "Penanganan laporan telah ditutup.",
  };
  return copy[step];
}

function statusBadge(status) {
  const className = status === "Selesai" ? "done" : status === "Diproses" ? "process" : "";
  return `<span class="status-badge ${className}">${status}</span>`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function clean(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 3200);
}
