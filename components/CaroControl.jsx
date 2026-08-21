"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  LayoutDashboard, Users, ListChecks, Wallet, CalendarDays, PenLine,
  Plus, X, Check, AlertTriangle, Clock, ChevronRight, Search,
  Trash2, Loader2, Sparkles, ChevronDown
} from "lucide-react";

/* ============================================================
   CARO CONTROL — Fase 1
   Almacenamiento: Supabase (Postgres en la nube) vía REST + Auth,
   con sesión en memoria. Mismo dato en computador y celular.
   ============================================================ */

const FONT_LINK_ID = "caro-control-fonts";

function useFonts() {
  useEffect(() => {
    if (document.getElementById(FONT_LINK_ID)) return;
    const link = document.createElement("link");
    link.id = FONT_LINK_ID;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap";
    document.head.appendChild(link);
  }, []);
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtCOP = (n) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n || 0);
const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
};
const daysUntil = (iso) => {
  if (!iso) return null;
  const today = new Date(todayISO() + "T00:00:00");
  const target = new Date(iso + "T00:00:00");
  return Math.round((target - today) / 86400000);
};
/* ---------- Conexión a Supabase (REST directo, sin SDK) ---------- */
const SUPABASE_URL = "https://bhlwgvzznjnobierfufn.supabase.co";
const SUPABASE_KEY = "sb_publishable_-6DRiT-5cgB78CwKeuux4A_4IMsUw1O";

const uid = () =>
  window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

const toSnake = (s) => s.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
const toCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const objToSnake = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [toSnake(k), v]));
const objToCamel = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [toCamel(k), v]));

/** Llamada cruda a la API de autenticación de Supabase (GoTrue). */
async function authFetch(path, body) {
  try {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: data?.error_description || data?.msg || data?.message || `Error ${res.status}` };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e?.message || "No se pudo conectar con Supabase." };
  }
}
const signUp = (email, password) => authFetch("/auth/v1/signup", { email, password });
const signIn = (email, password) => authFetch("/auth/v1/token?grant_type=password", { email, password });
const refreshSession = (refresh_token) => authFetch("/auth/v1/token?grant_type=refresh_token", { refresh_token });

const buildSession = (data) => ({
  accessToken: data.access_token,
  refreshToken: data.refresh_token,
  expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  email: data.user?.email,
  userId: data.user?.id,
});

/** Llamada cruda a la API REST (PostgREST) de una tabla, ya autenticada. */
async function sbFetch(path, { method = "GET", body, accessToken, prefer } = {}) {
  try {
    const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(`${SUPABASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      return { ok: false, error: data?.message || data?.hint || `Error ${res.status}` };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e?.message || "No se pudo conectar con Supabase." };
  }
}

async function fetchTable(table, accessToken) {
  const r = await sbFetch(`/rest/v1/${table}?select=*&order=created_at.desc`, { accessToken });
  if (!r.ok) return r;
  return { ok: true, data: r.data.map(objToCamel) };
}
async function insertRow(table, row, accessToken) {
  const r = await sbFetch(`/rest/v1/${table}`, { method: "POST", body: [objToSnake(row)], accessToken, prefer: "return=representation" });
  if (!r.ok) return r;
  return { ok: true, data: objToCamel(r.data[0]) };
}
async function updateRow(table, id, row, accessToken) {
  const payload = objToSnake(row);
  delete payload.id;
  const r = await sbFetch(`/rest/v1/${table}?id=eq.${id}`, { method: "PATCH", body: payload, accessToken, prefer: "return=representation" });
  if (!r.ok) return r;
  return { ok: true, data: objToCamel(r.data[0]) };
}
async function deleteRow(table, id, accessToken) {
  const r = await sbFetch(`/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", accessToken, prefer: "return=minimal" });
  if (!r.ok) return r;
  return { ok: true };
}

/* ---------- Supabase Storage (adjuntos) — también REST directo ---------- */
async function uploadFile(path, file, accessToken) {
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/adjuntos/${path}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: data?.message || data?.error || `Error ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || "No se pudo subir el archivo." };
  }
}

async function getSignedUrl(path, accessToken, expiresIn = 3600) {
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/adjuntos/${path}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.signedURL) return null;
    return `${SUPABASE_URL}/storage/v1${data.signedURL}`;
  } catch {
    return null;
  }
}

async function deleteFile(path, accessToken) {
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/adjuntos/${path}`, {
      method: "DELETE",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ---------- Motor de prioridad (reglas, no IA) ---------- */
function bucketOf(tarea) {
  if (tarea.estado === "Completada" || tarea.estado === "Cancelada") return null;
  if (tarea.estado === "Bloqueada") return "BLOQUEADO";
  if (tarea.estado === "Pendiente por aclarar") return "PENDIENTE_ACLARAR";
  if (!tarea.fechaLimite) return "PENDIENTE";
  const d = daysUntil(tarea.fechaLimite);
  if (d < 0) return "ATRASADO";
  if (d === 0) return "HOY";
  if (tarea.prioridad === "Crítica" || (d <= 2 && tarea.prioridad === "Alta")) return "URGENTE";
  if (d <= 7) return "PROXIMOS_7";
  return "PENDIENTE";
}

const BUCKET_META = {
  HOY: { label: "Hoy", color: "#7A2E4A" },
  URGENTE: { label: "Urgente", color: "#8B2E3F" },
  ATRASADO: { label: "Atrasado", color: "#B3432B" },
  PROXIMOS_7: { label: "Próximos 7 días", color: "#B08D57" },
  PENDIENTE: { label: "Pendiente", color: "#6B6570" },
  BLOQUEADO: { label: "Bloqueado", color: "#54506A" },
  PENDIENTE_ACLARAR: { label: "Por aclarar", color: "#8B2E3F" },
};

const PRIORIDADES = ["Crítica", "Alta", "Media", "Baja"];
const ESTADOS_TAREA = ["Pendiente", "En progreso", "Bloqueada", "Completada", "Cancelada", "Pendiente por aclarar"];
const AREAS = ["Profesional", "Personal", "Familia/Samuel"];
const ESTADOS_COBRO = ["Pendiente", "Próximo", "Vencido", "Pagado", "Parcial", "Cancelado"];

/* ============================================================
   UI primitives
   ============================================================ */

function Stamp({ children, color = "#7A2E4A" }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide"
      style={{
        color,
        border: `1.5px solid ${color}`,
        borderRadius: "3px",
        transform: "rotate(-0.6deg)",
        fontFamily: "'IBM Plex Mono', monospace",
        letterSpacing: "0.04em",
        background: `${color}0d`,
      }}
    >
      {children}
    </span>
  );
}

function Card({ children, className = "" }) {
  return (
    <div
      className={`bg-white rounded-xl border ${className}`}
      style={{ borderColor: "#E7E1D8" }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children, sub }) {
  return (
    <div className="mb-4">
      <h2
        className="text-2xl"
        style={{ fontFamily: "'Fraunces', serif", color: "#2B2440", fontWeight: 600 }}
      >
        {children}
      </h2>
      {sub && <p className="text-sm mt-1" style={{ color: "#8A8398" }}>{sub}</p>}
    </div>
  );
}

function EmptyState({ icon: Icon, text, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center px-4">
      <Icon size={28} strokeWidth={1.5} style={{ color: "#C9BFAE" }} />
      <p className="text-sm mt-3" style={{ color: "#8A8398" }}>{text}</p>
      {action}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium mb-1" style={{ color: "#6B6570" }}>{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors focus:border-[#7A2E4A]";
const inputStyle = { borderColor: "#E7E1D8", fontFamily: "'Inter', sans-serif", color: "#2B2440" };

function Modal({ title, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(43,36,64,0.35)" }}
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white" style={{ borderColor: "#E7E1D8" }}>
          <h3 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: "18px", color: "#2B2440" }}>{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-[#F5F1EE]">
            <X size={18} style={{ color: "#6B6570" }} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ============================================================
   App
   ============================================================ */

export default function CaroControl() {
  useFonts();

  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [clientes, setClientes] = useState([]);
  const [tareas, setTareas] = useState([]);
  const [cobros, setCobros] = useState([]);
  const [agenda, setAgenda] = useState([]);
  const [notas, setNotas] = useState([]);
  const [documentos, setDocumentos] = useState([]);
  const [archivos, setArchivos] = useState([]);
  const [perfil, setPerfil] = useState(null); // { id, preferencias } o null si aún no se ha creado
  const [mensajes, setMensajes] = useState([]); // chat de aclaración de cada nota
  const [modal, setModal] = useState(null); // {type, data?}
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null); // {type: 'success'|'error', message}
  const [session, setSession] = useState(null); // {accessToken, refreshToken, expiresAt, email}

  const showToast = useCallback((type, message) => {
    setToast({ type, message, ts: Date.now() });
  }, []);

  const toastTimeout = (type) => (type === "error" ? 5000 : 2200);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toastTimeout(toast.type));
    return () => clearTimeout(t);
  }, [toast]);

  /** Devuelve un access token válido, refrescándolo primero si está por
   * expirar. Si el refresh falla (ej. se revocó la sesión), cierra sesión
   * de vuelta a la pantalla de acceso en lugar de seguir con un token muerto. */
  const getValidToken = useCallback(async () => {
    if (!session) return null;
    if (Date.now() < session.expiresAt - 60000) return session.accessToken;
    const r = await refreshSession(session.refreshToken);
    if (!r.ok) {
      setSession(null);
      showToast("error", "Tu sesión expiró. Vuelve a iniciar sesión.");
      return null;
    }
    const fresh = buildSession(r.data);
    setSession(fresh);
    return fresh.accessToken;
  }, [session, showToast]);

  useEffect(() => {
    if (!session) return;
    (async () => {
      setLoading(true);
      const token = await getValidToken();
      if (!token) { setLoading(false); return; }
      const [c, t, co, ag, no, doc, arch, perf, msg] = await Promise.all([
        fetchTable("clientes", token), fetchTable("tareas", token), fetchTable("cobros", token),
        fetchTable("agenda", token), fetchTable("notas_rapidas", token), fetchTable("documentos_pendientes", token),
        fetchTable("archivos", token), fetchTable("perfil", token), fetchTable("mensajes_nota", token),
      ]);
      let hadError = false;
      if (c.ok) setClientes(c.data); else { hadError = true; }
      if (t.ok) setTareas(t.data); else { hadError = true; }
      if (co.ok) setCobros(co.data); else { hadError = true; }
      if (ag.ok) setAgenda(ag.data); else { hadError = true; }
      if (no.ok) setNotas(no.data); else { hadError = true; }
      if (doc.ok) setDocumentos(doc.data); else { hadError = true; }
      if (arch.ok) setArchivos(arch.data); else { hadError = true; }
      if (perf.ok) setPerfil(perf.data[0] || null); else { hadError = true; }
      if (msg.ok) setMensajes(msg.data); else { hadError = true; }
      setLoading(false);
      if (hadError) showToast("error", "Algunos datos no se pudieron cargar desde Supabase. Revisa tu conexión.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken ? "logged-in" : "logged-out"]);

  /** Crea o actualiza una fila en Supabase y SOLO si se confirma el éxito
   * actualiza lo que ves en pantalla — nunca se muestra algo como guardado
   * sin que Supabase lo haya confirmado. */
  const createItem = useCallback(async (table, item, setter, list) => {
    setSaving(true);
    const token = await getValidToken();
    if (!token) { setSaving(false); return false; }
    const r = await insertRow(table, item, token);
    setSaving(false);
    if (r.ok) { setter((prev) => [r.data, ...prev]); showToast("success", "Guardado"); return true; }
    showToast("error", `No se pudo guardar: ${r.error}`);
    return false;
  }, [getValidToken, showToast]);

  const updateItem = useCallback(async (table, id, item, setter, list) => {
    setSaving(true);
    const token = await getValidToken();
    if (!token) { setSaving(false); return false; }
    const r = await updateRow(table, id, item, token);
    setSaving(false);
    if (r.ok) { setter((prev) => prev.map((x) => (x.id === id ? r.data : x))); showToast("success", "Guardado"); return true; }
    showToast("error", `No se pudo guardar: ${r.error}`);
    return false;
  }, [getValidToken, showToast]);

  const deleteItem = useCallback(async (table, id, setter, list) => {
    setSaving(true);
    const token = await getValidToken();
    if (!token) { setSaving(false); return false; }
    const r = await deleteRow(table, id, token);
    setSaving(false);
    if (r.ok) { setter((prev) => prev.filter((x) => x.id !== id)); showToast("success", "Eliminado"); return true; }
    showToast("error", `No se pudo eliminar: ${r.error}`);
    return false;
  }, [getValidToken, showToast]);

  const save = (table, list, setter) => (item, isEdit) =>
    isEdit ? updateItem(table, item.id, item, setter, list) : createItem(table, item, setter, list);

  /** Sube un archivo al storage privado y registra su fila en `archivos`.
   * Si falla la subida, no se crea ningún registro huérfano. */
  const subirArchivo = useCallback(async (file, { notaId = null, tareaId = null, clienteId = null } = {}) => {
    const token = await getValidToken();
    if (!token || !session?.userId) { showToast("error", "Tu sesión expiró. Vuelve a iniciar sesión."); return false; }
    const nombreSeguro = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const ruta = `${session.userId}/${notaId || "general"}/${uid()}-${nombreSeguro}`;
    setSaving(true);
    const up = await uploadFile(ruta, file, token);
    if (!up.ok) {
      setSaving(false);
      showToast("error", `No se pudo subir "${file.name}": ${up.error}`);
      return false;
    }
    const ok = await createItem("archivos", {
      id: uid(), notaId, tareaId, clienteId,
      nombreArchivo: file.name, rutaStorage: ruta, tipoMime: file.type, tamanoBytes: file.size,
    }, setArchivos, archivos);
    setSaving(false);
    return ok;
  }, [getValidToken, session, showToast, createItem, archivos]);

  const eliminarArchivo = useCallback(async (archivo) => {
    const token = await getValidToken();
    if (!token) return false;
    setSaving(true);
    await deleteFile(archivo.rutaStorage, token);
    const ok = await deleteItem("archivos", archivo.id, setArchivos, archivos);
    setSaving(false);
    return ok;
  }, [getValidToken, archivos, deleteItem]);

  const verArchivo = useCallback(async (archivo) => {
    const token = await getValidToken();
    if (!token) return;
    const url = await getSignedUrl(archivo.rutaStorage, token);
    if (url) window.open(url, "_blank");
    else showToast("error", "No se pudo generar el enlace para ver el archivo.");
  }, [getValidToken, showToast]);

  /** Crea el perfil la primera vez, o lo actualiza si ya existe. Una sola fila por usuaria. */
  const guardarPerfil = useCallback(async (texto) => {
    if (perfil?.id) {
      const ok = await updateItem("perfil", perfil.id, { preferencias: texto }, setPerfil0, [perfil]);
      return ok;
    }
    const nuevoId = uid();
    const ok = await createItem("perfil", { id: nuevoId, preferencias: texto }, setPerfil0, []);
    return ok;
  }, [perfil, updateItem, createItem]);

  // createItem/updateItem esperan un setter de array; el perfil es una sola fila,
  // así que lo adaptamos aquí sin tocar la forma general de esas funciones.
  function setPerfil0(updater) {
    setPerfil((prev) => {
      const arr = updater(prev ? [prev] : []);
      return arr[0] || null;
    });
  }

  const clienteNombre = (id) => clientes.find((c) => c.id === id)?.nombre || null;

  /* ---------- Derivados para dashboard ---------- */
  const tareasActivas = tareas.filter((t) => !["Completada", "Cancelada"].includes(t.estado));
  const buckets = useMemo(() => {
    const b = { HOY: [], URGENTE: [], ATRASADO: [], PROXIMOS_7: [], PENDIENTE: [], BLOQUEADO: [], PENDIENTE_ACLARAR: [] };
    tareasActivas.forEach((t) => {
      const k = bucketOf(t);
      if (k) b[k].push(t);
    });
    return b;
  }, [tareasActivas]);

  const hoyISO = todayISO();
  const citasHoy = agenda.filter((a) => a.fecha === hoyISO);
  const cobrosPendientes = cobros.filter((c) => ["Pendiente", "Próximo", "Parcial"].includes(c.estado));
  const cobrosVencidos = cobros.filter((c) => c.estado === "Vencido");
  const mesActual = hoyISO.slice(0, 7);
  const cobradoEsteMes = cobros
    .filter((c) => c.estado === "Pagado" && c.fechaReal?.slice(0, 7) === mesActual)
    .reduce((s, c) => s + Number(c.valor || 0), 0);
  const porCobrarTotal = cobrosPendientes.reduce((s, c) => s + Number(c.valor || 0), 0);
  const vencidoTotal = cobrosVencidos.reduce((s, c) => s + Number(c.valor || 0), 0);

  const clientesConPendientes = clientes.filter((cl) =>
    tareasActivas.some((t) => t.clienteId === cl.id)
  );

  const top3 = useMemo(() => {
    const pool = [...buckets.ATRASADO, ...buckets.HOY, ...buckets.URGENTE];
    const orderPeso = { "Crítica": 0, "Alta": 1, "Media": 2, "Baja": 3 };
    return pool
      .sort((a, b) => (orderPeso[a.prioridad] ?? 9) - (orderPeso[b.prioridad] ?? 9))
      .slice(0, 3);
  }, [buckets]);

  /* ---------- Búsqueda global ---------- */
  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    return {
      clientes: clientes.filter((c) => c.nombre.toLowerCase().includes(q)),
      tareas: tareas.filter((t) => t.titulo.toLowerCase().includes(q)),
      cobros: cobros.filter((c) => (c.concepto || "").toLowerCase().includes(q) || clienteNombre(c.clienteId)?.toLowerCase().includes(q)),
      agenda: agenda.filter((a) => a.titulo.toLowerCase().includes(q)),
    };
  }, [search, clientes, tareas, cobros, agenda]);

  if (!session) {
    return <AuthScreen onLogin={setSession} showToast={showToast} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2" style={{ background: "#FAF7F2" }}>
        <Loader2 className="animate-spin" size={22} style={{ color: "#7A2E4A" }} />
        <p className="text-xs" style={{ color: "#B0A99A" }}>Cargando tus datos desde Supabase…</p>
      </div>
    );
  }

  const NAV = [
    { id: "dashboard", label: "Hoy", icon: LayoutDashboard },
    { id: "tareas", label: "Tareas", icon: ListChecks },
    { id: "clientes", label: "Clientes", icon: Users },
    { id: "cobros", label: "Cobros", icon: Wallet },
    { id: "agenda", label: "Agenda", icon: CalendarDays },
    { id: "nota", label: "Nota", icon: PenLine },
  ];

  return (
    <div className="min-h-screen pb-24 sm:pb-0" style={{ background: "#FAF7F2", fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        .ledger-bg {
          background-image: repeating-linear-gradient(
            to bottom, transparent, transparent 27px, #E7E1D8 28px
          );
        }
        ::selection { background: #7A2E4A33; }
      `}</style>

      {/* Header */}
      <header className="sticky top-0 z-30 border-b backdrop-blur" style={{ borderColor: "#E7E1D8", background: "#FAF7F2EE" }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0"
            style={{ background: "#7A2E4A" }}
          >
            <span style={{ color: "#F5EDE4", fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: "15px" }}>C</span>
          </div>
          <span style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: "17px", color: "#2B2440" }}>
            Caro Control
          </span>
          <div className="flex-1 relative ml-2 hidden sm:block">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#B0A99A" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente, tarea, cobro…"
              className="w-full pl-9 pr-3 py-1.5 rounded-lg border text-sm outline-none focus:border-[#7A2E4A]"
              style={{ borderColor: "#E7E1D8", background: "white" }}
            />
          </div>
          <div className="ml-auto sm:ml-2 flex items-center gap-1.5 text-xs" style={{ color: "#B0A99A" }}>
            {saving && (<><Loader2 size={13} className="animate-spin" /> <span className="hidden sm:inline">Guardando…</span></>)}
          </div>
          <button
            onClick={() => { setSession(null); setClientes([]); setTareas([]); setCobros([]); setAgenda([]); setNotas([]); setDocumentos([]); setArchivos([]); setPerfil(null); setMensajes([]); }}
            className="hidden sm:inline text-xs font-medium px-2 py-1 rounded-md"
            style={{ color: "#8A8398" }}
            title={session.email}
          >
            Cerrar sesión
          </button>
          <nav className="hidden sm:flex items-center gap-1 ml-2">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => setTab(n.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  color: tab === n.id ? "#7A2E4A" : "#6B6570",
                  background: tab === n.id ? "#7A2E4A14" : "transparent",
                }}
              >
                <n.icon size={15} /> {n.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="sm:hidden px-4 pb-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#B0A99A" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar…"
              className="w-full pl-9 pr-3 py-2 rounded-lg border text-sm outline-none"
              style={{ borderColor: "#E7E1D8", background: "white" }}
            />
          </div>
        </div>
      </header>


      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {searchResults ? (
          <SearchResultsView results={searchResults} clienteNombre={clienteNombre} onClear={() => setSearch("")} />
        ) : (
          <>
            {tab === "dashboard" && (
              <Dashboard
                buckets={buckets} citasHoy={citasHoy} cobrosPendientes={cobrosPendientes}
                cobrosVencidos={cobrosVencidos} cobradoEsteMes={cobradoEsteMes} porCobrarTotal={porCobrarTotal}
                vencidoTotal={vencidoTotal} clientesConPendientes={clientesConPendientes} clientes={clientes}
                top3={top3} clienteNombre={clienteNombre} tareas={tareas}
                onOpenTarea={(t) => setModal({ type: "tarea", data: t })}
                onNuevaTarea={() => setModal({ type: "tarea" })}
              />
            )}
            {tab === "tareas" && (
              <TareasView
                tareas={tareas} buckets={buckets} clienteNombre={clienteNombre}
                onNueva={() => setModal({ type: "tarea" })}
                onEditar={(t) => setModal({ type: "tarea", data: t })}
              />
            )}
            {tab === "clientes" && (
              <ClientesView
                clientes={clientes} tareas={tareas} cobros={cobros}
                onNuevo={() => setModal({ type: "cliente" })}
                onEditar={(c) => setModal({ type: "cliente", data: c })}
              />
            )}
            {tab === "cobros" && (
              <CobrosView
                cobros={cobros} clienteNombre={clienteNombre}
                onNuevo={() => setModal({ type: "cobro" })}
                onEditar={(c) => setModal({ type: "cobro", data: c })}
              />
            )}
            {tab === "agenda" && (
              <AgendaView
                agenda={agenda} clienteNombre={clienteNombre}
                onNuevo={() => setModal({ type: "agenda" })}
                onEditar={(a) => setModal({ type: "agenda", data: a })}
              />
            )}
            {tab === "nota" && (
              <NotaRapidaView
                notas={notas}
                clientes={clientes}
                tareas={tareas}
                documentos={documentos}
                archivos={archivos}
                perfil={perfil}
                guardarPerfil={guardarPerfil}
                mensajes={mensajes}
                setMensajes={setMensajes}
                clienteNombre={clienteNombre}
                createItem={createItem}
                updateItem={updateItem}
                deleteItem={deleteItem}
                subirArchivo={subirArchivo}
                eliminarArchivo={eliminarArchivo}
                verArchivo={verArchivo}
                setClientes={setClientes}
                setTareas={setTareas}
                setCobros={setCobros}
                setAgenda={setAgenda}
                setNotas={setNotas}
                setDocumentos={setDocumentos}
              />
            )}
          </>
        )}
      </main>

      {/* Nav móvil */}
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 z-30 border-t bg-white flex items-stretch"
        style={{ borderColor: "#E7E1D8" }}
      >
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => { setTab(n.id); setSearch(""); }}
            className="flex-1 flex flex-col items-center gap-0.5 py-2.5"
            style={{ color: tab === n.id ? "#7A2E4A" : "#B0A99A" }}
          >
            <n.icon size={19} strokeWidth={tab === n.id ? 2.2 : 1.8} />
            <span className="text-[10px] font-medium">{n.label}</span>
          </button>
        ))}
      </nav>

      {/* Modales */}
      {modal?.type === "tarea" && (
        <TareaModal
          data={modal.data} clientes={clientes}
          onClose={() => setModal(null)}
          onSave={async (t) => { const ok = await save("tareas", tareas, setTareas)(t, !!modal.data); if (ok) setModal(null); }}
          onDelete={async (id) => { const ok = await deleteItem("tareas", id, setTareas, tareas); if (ok) setModal(null); }}
        />
      )}
      {modal?.type === "cliente" && (
        <ClienteModal
          data={modal.data}
          onClose={() => setModal(null)}
          onSave={async (c) => { const ok = await save("clientes", clientes, setClientes)(c, !!modal.data); if (ok) setModal(null); }}
          onDelete={async (id) => { const ok = await deleteItem("clientes", id, setClientes, clientes); if (ok) setModal(null); }}
        />
      )}
      {modal?.type === "cobro" && (
        <CobroModal
          data={modal.data} clientes={clientes}
          onClose={() => setModal(null)}
          onSave={async (c) => { const ok = await save("cobros", cobros, setCobros)(c, !!modal.data); if (ok) setModal(null); }}
          onDelete={async (id) => { const ok = await deleteItem("cobros", id, setCobros, cobros); if (ok) setModal(null); }}
        />
      )}
      {toast && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 px-4 pointer-events-none" style={{ width: "100%", maxWidth: "420px" }}>
          <div
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg pointer-events-auto"
            style={{
              background: toast.type === "success" ? "#F0F5F1" : "#FBEFF1",
              border: `1px solid ${toast.type === "success" ? "#4B7B6255" : "#8B2E3F55"}`,
              color: toast.type === "success" ? "#3A6350" : "#8B2E3F",
            }}
          >
            {toast.type === "success" ? <Check size={15} className="flex-shrink-0" /> : <AlertTriangle size={15} className="flex-shrink-0" />}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {modal?.type === "agenda" && (
        <AgendaModal
          data={modal.data} clientes={clientes}
          onClose={() => setModal(null)}
          onSave={async (a) => { const ok = await save("agenda", agenda, setAgenda)(a, !!modal.data); if (ok) setModal(null); }}
          onDelete={async (id) => { const ok = await deleteItem("agenda", id, setAgenda, agenda); if (ok) setModal(null); }}
        />
      )}
    </div>
  );
}

/* ============================================================
   Dashboard
   ============================================================ */

function StatBlock({ label, value, color }) {
  return (
    <div className="px-4 py-3">
      <div className="text-2xl" style={{ fontFamily: "'IBM Plex Mono', monospace", color: color || "#2B2440", fontWeight: 500 }}>
        {value}
      </div>
      <div className="text-[11px] mt-0.5" style={{ color: "#8A8398" }}>{label}</div>
    </div>
  );
}

/* ============================================================
   Pantalla de acceso — autenticación real contra Supabase.
   La sesión vive solo en memoria (no en localStorage/window.storage),
   así que cada vez que se abre el artifact hay que volver a entrar.
   ============================================================ */

function AuthScreen({ onLogin, showToast }) {
  const [mode, setMode] = useState("login"); // 'login' | 'signup'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const submit = async () => {
    if (busy) return;
    setError(""); setNotice(""); setBusy(true);
    const r = mode === "login" ? await signIn(email, password) : await signUp(email, password);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    if (mode === "signup") {
      if (r.data.access_token) {
        onLogin(buildSession(r.data));
        showToast("success", "Cuenta creada. ¡Bienvenida!");
      } else {
        setNotice("Cuenta creada. Supabase pide confirmar el correo antes de entrar — revisa tu bandeja, o si prefieres saltarte ese paso, desactiva \"Confirm email\" en Authentication → Providers → Email dentro de tu proyecto Supabase, y luego inicia sesión.");
        setMode("login");
      }
      return;
    }
    onLogin(buildSession(r.data));
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#FAF7F2", fontFamily: "'Inter', sans-serif" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-10 h-10 rounded-md mx-auto mb-3 flex items-center justify-center" style={{ background: "#7A2E4A" }}>
            <span style={{ color: "#F5EDE4", fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: "18px" }}>C</span>
          </div>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: "22px", color: "#2B2440" }}>Caro Control</h1>
          <p className="text-xs mt-1" style={{ color: "#8A8398" }}>
            {mode === "login" ? "Entra a tu sistema" : "Crea tu cuenta (una sola vez)"}
          </p>
        </div>

        <Card className="p-5">
          <div className="space-y-3">
            <Field label="Correo">
              <input
                type="email" required className={inputCls} style={inputStyle} value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              />
            </Field>
            <Field label="Contraseña">
              <input
                type="password" required minLength={6} className={inputCls} style={inputStyle} value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              />
            </Field>
            {error && <p className="text-xs" style={{ color: "#8B2E3F" }}>{error}</p>}
            {notice && <p className="text-xs" style={{ color: "#B08D57" }}>{notice}</p>}
            <button
              type="button"
              onClick={submit}
              disabled={busy || !email || password.length < 6}
              className="w-full py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: "#7A2E4A" }}
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {mode === "login" ? "Entrar" : "Crear cuenta"}
            </button>
          </div>
        </Card>

        <button
          onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setNotice(""); }}
          className="w-full text-center text-xs mt-4"
          style={{ color: "#7A2E4A" }}
        >
          {mode === "login" ? "¿Primera vez? Crea tu cuenta" : "¿Ya tienes cuenta? Inicia sesión"}
        </button>
      </div>
    </div>
  );
}

function Dashboard({ buckets, citasHoy, cobrosPendientes, cobrosVencidos, cobradoEsteMes, porCobrarTotal, vencidoTotal, clientesConPendientes, clientes, top3, clienteNombre, tareas, onOpenTarea, onNuevaTarea }) {
  const nombreDia = new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="space-y-6">
      <div className="ledger-bg rounded-xl px-5 sm:px-6 py-6" style={{ background: "#FFFFFF", border: "1px solid #E7E1D8" }}>
        <p className="text-xs uppercase tracking-wide mb-1" style={{ color: "#B08D57", fontFamily: "'IBM Plex Mono', monospace" }}>
          {nombreDia}
        </p>
        <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: "28px", fontWeight: 600, color: "#2B2440" }}>
          Buenos días, Carolina
        </h1>

        {top3.length > 0 ? (
          <div className="mt-5 space-y-2.5">
            <p className="text-xs font-medium" style={{ color: "#6B6570" }}>Esto es lo que más importa hoy:</p>
            {top3.map((t) => (
              <button
                key={t.id}
                onClick={() => onOpenTarea(t)}
                className="w-full text-left flex items-center gap-3 px-3.5 py-3 rounded-lg border hover:border-[#7A2E4A] transition-colors"
                style={{ borderColor: "#E7E1D8" }}
              >
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: BUCKET_META[bucketOf(t)]?.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: "#2B2440" }}>{t.titulo}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: "#8A8398" }}>
                    {clienteNombre(t.clienteId) ? `${clienteNombre(t.clienteId)} · ` : ""}
                    {t.fechaLimite ? fmtDate(t.fechaLimite) : "sin fecha"} · prioridad {t.prioridad.toLowerCase()}
                  </div>
                </div>
                <ChevronRight size={15} style={{ color: "#C9BFAE" }} />
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-5 text-sm" style={{ color: "#8A8398" }}>
            No hay tareas críticas ni atrasadas para hoy. Buen momento para avanzar en lo próximo.
          </p>
        )}

        <button
          onClick={onNuevaTarea}
          className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
          style={{ color: "#7A2E4A", border: "1px solid #7A2E4A" }}
        >
          <Plus size={13} /> Nueva tarea
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ["HOY", buckets.HOY.length], ["URGENTE", buckets.URGENTE.length],
          ["ATRASADO", buckets.ATRASADO.length], ["PROXIMOS_7", buckets.PROXIMOS_7.length],
        ].map(([k, v]) => (
          <Card key={k} className="text-center py-3">
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "22px", fontWeight: 500, color: BUCKET_META[k].color }}>{v}</div>
            <div className="text-[10.5px] uppercase tracking-wide mt-0.5" style={{ color: "#8A8398" }}>{BUCKET_META[k].label}</div>
          </Card>
        ))}
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <Card>
          <div className="px-4 pt-4"><p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#6B6570" }}>Dinero</p></div>
          <div className="grid grid-cols-3 divide-x" style={{ borderColor: "#E7E1D8" }}>
            <StatBlock label="Cobrado este mes" value={fmtCOP(cobradoEsteMes)} color="#4B7B62" />
            <StatBlock label="Por cobrar" value={fmtCOP(porCobrarTotal)} color="#B08D57" />
            <StatBlock label="Vencido" value={fmtCOP(vencidoTotal)} color="#8B2E3F" />
          </div>
        </Card>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Card>
          <div className="px-4 pt-4 pb-1"><p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#6B6570" }}>Citas de hoy</p></div>
          {citasHoy.length === 0 ? (
            <p className="px-4 pb-4 pt-1 text-sm" style={{ color: "#B0A99A" }}>Sin citas para hoy.</p>
          ) : (
            <ul className="px-4 pb-3 pt-1 space-y-2">
              {citasHoy.map((a) => (
                <li key={a.id} className="text-sm flex items-center gap-2" style={{ color: "#2B2440" }}>
                  <Clock size={13} style={{ color: "#B0A99A" }} /> {a.hora || "—"} · {a.titulo}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <div className="px-4 pt-4 pb-1"><p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#6B6570" }}>Clientes con pendientes</p></div>
          {clientesConPendientes.length === 0 ? (
            <p className="px-4 pb-4 pt-1 text-sm" style={{ color: "#B0A99A" }}>Todo al día.</p>
          ) : (
            <ul className="px-4 pb-3 pt-1 space-y-2">
              {clientesConPendientes.slice(0, 5).map((c) => (
                <li key={c.id} className="text-sm" style={{ color: "#2B2440" }}>{c.nombre}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ============================================================
   Tareas
   ============================================================ */

function TareasView({ tareas, buckets, clienteNombre, onNueva, onEditar }) {
  const [filtro, setFiltro] = useState("TODAS");
  const activas = tareas.filter((t) => !["Completada", "Cancelada"].includes(t.estado));
  const orden = ["ATRASADO", "HOY", "URGENTE", "PROXIMOS_7", "PENDIENTE", "BLOQUEADO", "PENDIENTE_ACLARAR"];
  const lista = filtro === "TODAS" ? activas : buckets[filtro] || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SectionTitle sub={`${activas.length} tareas activas`}>Tareas</SectionTitle>
        <button onClick={onNueva} className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg text-white" style={{ background: "#7A2E4A" }}>
          <Plus size={15} /> Nueva
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-3 mb-1 -mx-1 px-1">
        <FilterChip active={filtro === "TODAS"} onClick={() => setFiltro("TODAS")}>Todas</FilterChip>
        {orden.map((k) => (
          <FilterChip key={k} active={filtro === k} onClick={() => setFiltro(k)} color={BUCKET_META[k].color}>
            {BUCKET_META[k].label} ({buckets[k].length})
          </FilterChip>
        ))}
      </div>
      {lista.length === 0 ? (
        <EmptyState icon={ListChecks} text="No hay tareas en esta vista." />
      ) : (
        <div className="space-y-2 mt-3">
          {lista.map((t) => (
            <TareaRow key={t.id} tarea={t} clienteNombre={clienteNombre(t.clienteId)} onClick={() => onEditar(t)} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children, color }) {
  return (
    <button
      onClick={onClick}
      className="whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium border flex-shrink-0"
      style={{
        borderColor: active ? (color || "#7A2E4A") : "#E7E1D8",
        color: active ? (color || "#7A2E4A") : "#8A8398",
        background: active ? `${color || "#7A2E4A"}14` : "white",
      }}
    >
      {children}
    </button>
  );
}

function TareaRow({ tarea, clienteNombre, onClick }) {
  const b = bucketOf(tarea);
  return (
    <button onClick={onClick} className="w-full text-left">
      <Card className="px-4 py-3 flex items-center gap-3 hover:border-[#7A2E4A] transition-colors">
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: b ? BUCKET_META[b].color : "#C9BFAE" }} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate" style={{ color: "#2B2440" }}>{tarea.titulo}</div>
          <div className="text-[11px] mt-0.5 flex flex-wrap gap-x-2" style={{ color: "#8A8398" }}>
            {clienteNombre && <span>{clienteNombre}</span>}
            <span>{tarea.area}</span>
            {tarea.fechaLimite && <span>{fmtDate(tarea.fechaLimite)}</span>}
            <span>{tarea.prioridad}</span>
          </div>
        </div>
        <Stamp color={b ? BUCKET_META[b].color : "#8A8398"}>{tarea.estado}</Stamp>
      </Card>
    </button>
  );
}

function TareaModal({ data, clientes, onClose, onSave, onDelete }) {
  const [f, setF] = useState(
    data || { id: uid(), titulo: "", descripcion: "", clienteId: "", area: "Profesional", prioridad: "Media", estado: "Pendiente", fechaLimite: "", notas: "" }
  );
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <Modal title={data ? "Editar tarea" : "Nueva tarea"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Título">
          <input className={inputCls} style={inputStyle} value={f.titulo} onChange={set("titulo")} placeholder="Ej. Revisar contabilidad de Pedro" />
        </Field>
        <Field label="Descripción / notas">
          <textarea className={inputCls} style={inputStyle} rows={2} value={f.descripcion} onChange={set("descripcion")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cliente">
            <select className={inputCls} style={inputStyle} value={f.clienteId} onChange={set("clienteId")}>
              <option value="">— sin cliente —</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Field>
          <Field label="Área">
            <select className={inputCls} style={inputStyle} value={f.area} onChange={set("area")}>
              {AREAS.map((a) => <option key={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Prioridad">
            <select className={inputCls} style={inputStyle} value={f.prioridad} onChange={set("prioridad")}>
              {PRIORIDADES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Estado">
            <select className={inputCls} style={inputStyle} value={f.estado} onChange={set("estado")}>
              {ESTADOS_TAREA.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Fecha límite">
            <input type="date" className={inputCls} style={inputStyle} value={f.fechaLimite} onChange={set("fechaLimite")} />
          </Field>
        </div>
      </div>
      <div className="flex items-center justify-between mt-5 pt-4 border-t" style={{ borderColor: "#E7E1D8" }}>
        {data ? (
          <button onClick={() => onDelete(f.id)} className="text-sm flex items-center gap-1.5" style={{ color: "#8B2E3F" }}>
            <Trash2 size={14} /> Eliminar
          </button>
        ) : <span />}
        <button
          disabled={!f.titulo.trim()}
          onClick={() => onSave(f)}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-40"
          style={{ background: "#7A2E4A" }}
        >
          Guardar
        </button>
      </div>
    </Modal>
  );
}

/* ============================================================
   Clientes
   ============================================================ */

function ClientesView({ clientes, tareas, cobros, onNuevo, onEditar }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SectionTitle sub={`${clientes.length} clientes`}>Clientes</SectionTitle>
        <button onClick={onNuevo} className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg text-white" style={{ background: "#7A2E4A" }}>
          <Plus size={15} /> Nuevo
        </button>
      </div>
      {clientes.length === 0 ? (
        <EmptyState icon={Users} text="Todavía no tienes clientes registrados." />
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {clientes.map((c) => {
            const nPend = tareas.filter((t) => t.clienteId === c.id && !["Completada", "Cancelada"].includes(t.estado)).length;
            const deuda = cobros.filter((co) => co.clienteId === c.id && ["Pendiente", "Próximo", "Vencido", "Parcial"].includes(co.estado)).reduce((s, co) => s + Number(co.valor || 0), 0);
            return (
              <button key={c.id} onClick={() => onEditar(c)} className="text-left">
                <Card className="p-4 hover:border-[#7A2E4A] transition-colors">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-semibold" style={{ color: "#2B2440" }}>{c.nombre}</div>
                      {c.tipoCliente && <div className="text-xs mt-0.5" style={{ color: "#8A8398" }}>{c.tipoCliente}</div>}
                    </div>
                    {nPend > 0 && <Stamp color="#B08D57">{nPend} pend.</Stamp>}
                  </div>
                  {deuda > 0 && (
                    <div className="text-xs mt-2" style={{ color: "#8B2E3F" }}>Debe {fmtCOP(deuda)}</div>
                  )}
                </Card>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ClienteModal({ data, onClose, onSave, onDelete }) {
  const [f, setF] = useState(
    data || { id: uid(), nombre: "", razonSocial: "", nit: "", contacto: "", telefono: "", correo: "", tipoCliente: "", honorarios: "", frecuenciaCobro: "", notas: "" }
  );
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={data ? "Editar cliente" : "Nuevo cliente"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Nombre"><input className={inputCls} style={inputStyle} value={f.nombre} onChange={set("nombre")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Razón social"><input className={inputCls} style={inputStyle} value={f.razonSocial} onChange={set("razonSocial")} /></Field>
          <Field label="NIT"><input className={inputCls} style={inputStyle} value={f.nit} onChange={set("nit")} /></Field>
          <Field label="Teléfono"><input className={inputCls} style={inputStyle} value={f.telefono} onChange={set("telefono")} /></Field>
          <Field label="Correo"><input className={inputCls} style={inputStyle} value={f.correo} onChange={set("correo")} /></Field>
          <Field label="Tipo de cliente"><input className={inputCls} style={inputStyle} value={f.tipoCliente} onChange={set("tipoCliente")} placeholder="Persona natural, régimen simple…" /></Field>
          <Field label="Honorarios"><input className={inputCls} style={inputStyle} value={f.honorarios} onChange={set("honorarios")} placeholder="$ / frecuencia" /></Field>
        </div>
        <Field label="Notas"><textarea className={inputCls} style={inputStyle} rows={2} value={f.notas} onChange={set("notas")} /></Field>
      </div>
      <div className="flex items-center justify-between mt-5 pt-4 border-t" style={{ borderColor: "#E7E1D8" }}>
        {data ? (
          <button onClick={() => onDelete(f.id)} className="text-sm flex items-center gap-1.5" style={{ color: "#8B2E3F" }}><Trash2 size={14} /> Eliminar</button>
        ) : <span />}
        <button disabled={!f.nombre.trim()} onClick={() => onSave(f)} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-40" style={{ background: "#7A2E4A" }}>Guardar</button>
      </div>
    </Modal>
  );
}

/* ============================================================
   Cobros
   ============================================================ */

function CobrosView({ cobros, clienteNombre, onNuevo, onEditar }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SectionTitle sub={`${cobros.length} registros`}>Cobros</SectionTitle>
        <button onClick={onNuevo} className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg text-white" style={{ background: "#7A2E4A" }}>
          <Plus size={15} /> Nuevo
        </button>
      </div>
      {cobros.length === 0 ? (
        <EmptyState icon={Wallet} text="No hay cobros registrados todavía." />
      ) : (
        <div className="space-y-2">
          {cobros.map((c) => (
            <button key={c.id} onClick={() => onEditar(c)} className="w-full text-left">
              <Card className="px-4 py-3 flex items-center gap-3 hover:border-[#7A2E4A] transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: "#2B2440" }}>{clienteNombre(c.clienteId) || "—"} · {c.concepto}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: "#8A8398" }}>Esperado {fmtDate(c.fechaEsperada)}</div>
                </div>
                <div className="text-sm font-mono" style={{ color: "#2B2440", fontFamily: "'IBM Plex Mono', monospace" }}>{fmtCOP(c.valor)}</div>
                <Stamp color={COBRO_COLOR[c.estado]}>{c.estado}</Stamp>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const COBRO_COLOR = { Pendiente: "#B08D57", "Próximo": "#B08D57", Vencido: "#8B2E3F", Pagado: "#4B7B62", Parcial: "#54506A", Cancelado: "#8A8398" };

function CobroModal({ data, clientes, onClose, onSave, onDelete }) {
  const [f, setF] = useState(data || { id: uid(), clienteId: "", concepto: "", valor: "", fechaEsperada: "", fechaReal: "", estado: "Pendiente", metodoPago: "", observaciones: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={data ? "Editar cobro" : "Nuevo cobro"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Cliente">
          <select className={inputCls} style={inputStyle} value={f.clienteId} onChange={set("clienteId")}>
            <option value="">— seleccionar —</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </Field>
        <Field label="Concepto"><input className={inputCls} style={inputStyle} value={f.concepto} onChange={set("concepto")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor"><input type="number" className={inputCls} style={inputStyle} value={f.valor} onChange={set("valor")} /></Field>
          <Field label="Estado">
            <select className={inputCls} style={inputStyle} value={f.estado} onChange={set("estado")}>
              {ESTADOS_COBRO.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Fecha esperada"><input type="date" className={inputCls} style={inputStyle} value={f.fechaEsperada} onChange={set("fechaEsperada")} /></Field>
          <Field label="Fecha real de pago"><input type="date" className={inputCls} style={inputStyle} value={f.fechaReal} onChange={set("fechaReal")} /></Field>
        </div>
      </div>
      <div className="flex items-center justify-between mt-5 pt-4 border-t" style={{ borderColor: "#E7E1D8" }}>
        {data ? (
          <button onClick={() => onDelete(f.id)} className="text-sm flex items-center gap-1.5" style={{ color: "#8B2E3F" }}><Trash2 size={14} /> Eliminar</button>
        ) : <span />}
        <button disabled={!f.concepto.trim() || !f.valor} onClick={() => onSave(f)} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-40" style={{ background: "#7A2E4A" }}>Guardar</button>
      </div>
    </Modal>
  );
}

/* ============================================================
   Agenda
   ============================================================ */

function AgendaView({ agenda, clienteNombre, onNuevo, onEditar }) {
  const [filtro, setFiltro] = useState("TODO");
  const hoyISO = todayISO();
  const base = filtro === "TODO" ? agenda
    : filtro === "HOY" ? agenda.filter((a) => a.fecha === hoyISO)
    : filtro === "LABORAL" ? agenda.filter((a) => a.area === "Profesional")
    : agenda.filter((a) => a.area === "Personal" || a.area === "Familia/Samuel");
  const ordenada = [...base].sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SectionTitle sub={`${ordenada.length} de ${agenda.length} eventos`}>Agenda</SectionTitle>
        <button onClick={onNuevo} className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg text-white" style={{ background: "#7A2E4A" }}>
          <Plus size={15} /> Nuevo
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-3 mb-1 -mx-1 px-1">
        {[["TODO", "Todo"], ["HOY", "Caro Hoy"], ["LABORAL", "Caro Laboral"], ["PERSONAL", "Caro Personal"]].map(([k, label]) => (
          <FilterChip key={k} active={filtro === k} onClick={() => setFiltro(k)}>{label}</FilterChip>
        ))}
      </div>
      {ordenada.length === 0 ? (
        <EmptyState icon={CalendarDays} text="No hay eventos en esta vista." />
      ) : (
        <div className="space-y-2 mt-3">
          {ordenada.map((a) => (
            <button key={a.id} onClick={() => onEditar(a)} className="w-full text-left">
              <Card className="px-4 py-3 flex items-center gap-3 hover:border-[#7A2E4A] transition-colors">
                <div className="text-center flex-shrink-0 w-12">
                  <div className="text-[10px] uppercase" style={{ color: "#B08D57" }}>{fmtDate(a.fecha)}</div>
                  {a.hora && <div className="text-xs" style={{ color: "#8A8398" }}>{a.hora}</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: "#2B2440" }}>{a.titulo}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: "#8A8398" }}>{a.tipo}{clienteNombre(a.clienteId) ? ` · ${clienteNombre(a.clienteId)}` : ""}</div>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AgendaModal({ data, clientes, onClose, onSave, onDelete }) {
  const [f, setF] = useState(data || { id: uid(), titulo: "", tipo: "Reunión", fecha: "", hora: "", clienteId: "", area: "Profesional", ubicacion: "", notas: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={data ? "Editar evento" : "Nuevo evento"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Título"><input className={inputCls} style={inputStyle} value={f.titulo} onChange={set("titulo")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <select className={inputCls} style={inputStyle} value={f.tipo} onChange={set("tipo")}>
              {["Reunión", "Cita", "Visita", "Auditoría", "Llamada", "Asesoría", "Personal", "Familiar"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Área">
            <select className={inputCls} style={inputStyle} value={f.area} onChange={set("area")}>
              {AREAS.map((a) => <option key={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Fecha"><input type="date" className={inputCls} style={inputStyle} value={f.fecha} onChange={set("fecha")} /></Field>
          <Field label="Hora"><input type="time" className={inputCls} style={inputStyle} value={f.hora} onChange={set("hora")} /></Field>
        </div>
        <Field label="Cliente (opcional)">
          <select className={inputCls} style={inputStyle} value={f.clienteId} onChange={set("clienteId")}>
            <option value="">— ninguno —</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </Field>
        <Field label="Ubicación"><input className={inputCls} style={inputStyle} value={f.ubicacion} onChange={set("ubicacion")} /></Field>
      </div>
      <div className="flex items-center justify-between mt-5 pt-4 border-t" style={{ borderColor: "#E7E1D8" }}>
        {data ? (
          <button onClick={() => onDelete(f.id)} className="text-sm flex items-center gap-1.5" style={{ color: "#8B2E3F" }}><Trash2 size={14} /> Eliminar</button>
        ) : <span />}
        <button disabled={!f.titulo.trim() || !f.fecha} onClick={() => onSave(f)} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-40" style={{ background: "#7A2E4A" }}>Guardar</button>
      </div>
    </Modal>
  );
}

/* ============================================================
   Nota rápida — motor de lenguaje natural con ejecución directa.
   Escribes, se procesa y se guarda de una vez (crear o actualizar
   según corresponda). Si algo es ambiguo, no se inventa: queda
   como pregunta pendiente en vez de convertirse en una acción.
   ============================================================ */

const PROMPT_BASE = `Convierte la siguiente nota en elementos organizados. Para cada elemento identifica el tipo (TAREA, CLIENTE, DOCUMENTO, COBRO, AGENDA) y sus datos. Si falta información esencial, no la inventes: márcalo como "PENDIENTE POR ACLARAR" con la pregunta correspondiente.

Nota:
"`;

const ENTIDAD_LABEL = { tarea: "Tarea", cobro: "Cobro", agenda: "Agenda", documento: "Documento", cliente: "Cliente" };
const ENTIDAD_COLOR = { tarea: "#7A2E4A", cobro: "#B08D57", agenda: "#54506A", documento: "#4B7B62", cliente: "#8B2E3F" };

function resumenAccion(item) {
  const { entidad, accion, campos } = item;
  const nombre = campos.titulo || campos.concepto || campos.nombreDocumento || "";
  const verbo = accion === "actualizar" ? "Actualizada" : "Creada";
  let extra = "";
  if (campos.valor) extra += ` — ${fmtCOP(campos.valor)}`;
  const fecha = campos.fechaLimite || campos.fechaEsperada || campos.fecha || campos.fechaRecibido;
  if (fecha) extra += ` · ${fmtDate(fecha)}`;
  if (entidad === "tarea" && accion === "actualizar") return `Tarea marcada como ${(campos.estado || "actualizada").toLowerCase()}: ${nombre || "—"}`;
  if (entidad === "documento" && accion === "actualizar") return `Documento actualizado (${campos.estado || "—"}): ${nombre || "—"}`;
  return `${ENTIDAD_LABEL[entidad] || entidad} ${verbo.toLowerCase()}: ${nombre}${extra}`;
}

const fmtBytes = (n) => {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const ESTADO_NOTA_META = {
  Nueva: { label: "Nueva", color: "#8A8398" },
  "Necesita aclaración": { label: "💬 Necesita aclaración", color: "#8B2E3F" },
  Completada: { label: "Completada", color: "#4B7B62" },
  Archivada: { label: "Archivada", color: "#B0A99A" },
};

function PreferenciasPanel({ perfil, guardarPerfil }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState(perfil?.preferencias || "");
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState(false);

  useEffect(() => { setTexto(perfil?.preferencias || ""); }, [perfil?.preferencias]);

  const guardar = async () => {
    setGuardando(true); setGuardadoOk(false);
    const ok = await guardarPerfil(texto);
    setGuardando(false);
    if (ok) { setGuardadoOk(true); setTimeout(() => setGuardadoOk(false), 2000); }
  };

  return (
    <Card className="p-4 mb-6">
      <button onClick={() => setAbierto(!abierto)} className="w-full flex items-center justify-between text-left">
        <span className="text-sm font-semibold" style={{ color: "#2B2440" }}>Cómo trabajo — mis preferencias</span>
        <ChevronDown size={16} style={{ color: "#8A8398", transform: abierto ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>
      {!abierto && (
        <p className="text-xs mt-1" style={{ color: "#8A8398" }}>
          {perfil?.preferencias ? "Ya tienes preferencias guardadas — ábrelo para editarlas." : "Cuéntame cómo trabajas para que haga menos preguntas: apodos de clientes, actividades habituales como \"natación\", prioridades por defecto."}
        </p>
      )}
      {abierto && (
        <div className="mt-3">
          <ul className="text-xs mb-3 space-y-1 pl-4" style={{ color: "#8A8398", listStyle: "disc" }}>
            <li>Actividades habituales (ej. "Natación: personal, sábados 7:30am")</li>
            <li>Apodos de clientes (ej. "a Pity me refiero a Patricia Gómez")</li>
            <li>Prioridad por defecto según tipo de trabajo</li>
            <li>Cómo interpretar plazos vagos ("esta semana" = viernes)</li>
            <li>Tu tolerancia a que decida sin preguntar tanto</li>
          </ul>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={6}
            placeholder="Ej. Natación: actividad personal, sábados 7:30am. Mis clientes prioritarios son XYZ y ABC. A 'Pity' me refiero a mi cliente Patricia Gómez..."
            className={inputCls}
            style={inputStyle}
          />
          <div className="flex items-center gap-2 mt-2">
            <button onClick={guardar} disabled={guardando} className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg text-white disabled:opacity-40" style={{ background: "#7A2E4A" }}>
              {guardando && <Loader2 size={13} className="animate-spin" />}
              Guardar preferencias
            </button>
            {guardadoOk && <span className="text-xs flex items-center gap-1" style={{ color: "#4B7B62" }}><Check size={13} /> Guardado</span>}
          </div>
        </div>
      )}
    </Card>
  );
}

/** Una tarjeta por nota. Si la nota necesita aclaración, muestra su chat propio
 * justo ahí — nunca crea una nota nueva para la pregunta ni para la respuesta. */
function NotaCard({ nota, mensajesDeNota, adjuntosDeNota, onResponder, onMarcarProcesada, onArchivar, onEliminar, onVerArchivo, onEliminarArchivo }) {
  const [respuesta, setRespuesta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const meta = ESTADO_NOTA_META[nota.estado] || ESTADO_NOTA_META.Nueva;

  const enviarRespuesta = async () => {
    if (!respuesta.trim() || enviando) return;
    setEnviando(true);
    await onResponder(nota.id, respuesta.trim());
    setRespuesta("");
    setEnviando(false);
  };

  return (
    <Card className="p-4">
      <p className="text-sm" style={{ color: "#2B2440" }}>{nota.texto}</p>
      {nota.resumen && <p className="text-xs mt-1.5" style={{ color: "#8A8398" }}>{nota.resumen}</p>}

      {adjuntosDeNota.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {adjuntosDeNota.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-md text-xs" style={{ background: "#F5F1EE", color: "#6B6570" }}>
              <button onClick={() => onVerArchivo(a)} className="hover:underline">{a.nombreArchivo}</button>
              <button onClick={() => onEliminarArchivo(a)} className="p-0.5 rounded-full hover:bg-white"><X size={10} /></button>
            </span>
          ))}
        </div>
      )}

      {nota.estado === "Necesita aclaración" && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: "#E7E1D8" }}>
          <div className="space-y-2 mb-2">
            {mensajesDeNota.map((m) => (
              <div key={m.id} className={`text-sm px-3 py-2 rounded-lg max-w-[85%] ${m.rol === "carolina" ? "ml-auto" : ""}`}
                style={{ background: m.rol === "carolina" ? "#7A2E4A" : "#F5F1EE", color: m.rol === "carolina" ? "white" : "#2B2440" }}>
                {m.contenido}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              value={respuesta}
              onChange={(e) => setRespuesta(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") enviarRespuesta(); }}
              placeholder="Tu respuesta…"
              className={inputCls}
              style={inputStyle}
            />
            <button
              onClick={enviarRespuesta}
              disabled={!respuesta.trim() || enviando}
              className="flex-shrink-0 flex items-center gap-1 text-xs font-medium px-3 py-2 rounded-lg text-white disabled:opacity-40"
              style={{ background: "#7A2E4A" }}
            >
              {enviando && <Loader2 size={12} className="animate-spin" />}
              Responder
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mt-3">
        <span className="text-[11px]" style={{ color: "#B0A99A" }}>
          {new Date(nota.createdAt).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </span>
        <div className="flex items-center gap-3">
          <Stamp color={meta.color}>{meta.label}</Stamp>
          {nota.estado !== "Archivada" && (
            <button onClick={() => onArchivar(nota.id)} className="text-xs font-medium" style={{ color: "#8A8398" }}>Archivar</button>
          )}
          <button onClick={() => onEliminar(nota.id)}><Trash2 size={13} style={{ color: "#B0A99A" }} /></button>
        </div>
      </div>
    </Card>
  );
}

function NotaRapidaView({ notas, clientes, tareas, documentos, archivos, mensajes, setMensajes, perfil, guardarPerfil, clienteNombre, createItem, updateItem, deleteItem, subirArchivo, eliminarArchivo, verArchivo, setClientes, setTareas, setCobros, setAgenda, setNotas, setDocumentos }) {
  const [texto, setTexto] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [errorIA, setErrorIA] = useState("");
  const [archivosSeleccionados, setArchivosSeleccionados] = useState([]);
  const fileInputRef = React.useRef(null);

  const copiarPrompt = () => {
    const promptCompleto = PROMPT_BASE + texto + '"';
    navigator.clipboard?.writeText(promptCompleto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  };

  const agregarArchivos = (files) => setArchivosSeleccionados((prev) => [...prev, ...Array.from(files)]);
  const quitarSeleccionado = (idx) => setArchivosSeleccionados((prev) => prev.filter((_, i) => i !== idx));
  const subirSeleccionados = async (notaId) => {
    for (const file of archivosSeleccionados) await subirArchivo(file, { notaId });
    setArchivosSeleccionados([]);
  };

  const contextoActual = () => {
    const tareasAbiertas = tareas
      .filter((t) => !["Completada", "Cancelada"].includes(t.estado))
      .map((t) => ({ id: t.id, titulo: t.titulo, clienteNombre: clienteNombre(t.clienteId) }));
    const documentosPendientes = documentos
      .filter((d) => d.estado !== "Revisado")
      .map((d) => ({ id: d.id, nombre: d.nombreDocumento, estado: d.estado, clienteNombre: clienteNombre(d.clienteId) }));
    return {
      clientes: clientes.map((c) => ({ id: c.id, nombre: c.nombre })),
      tareasAbiertas, documentosPendientes,
      preferencias: perfil?.preferencias || "",
    };
  };

  /** Ejecuta las acciones ya interpretadas. Devuelve los hechos realizados y,
   * como mucho, UNA pregunta pendiente (el motor ya garantiza que no manda más de una). */
  const ejecutarAcciones = async (acciones) => {
    const hechos = [];
    let pregunta = null;
    const clientesNuevos = {};

    for (const item of acciones) {
      if (item.entidad === "pendiente_aclarar") {
        if (item.pregunta && !pregunta) pregunta = item.pregunta;
        continue;
      }

      let clienteId = null;
      if (item.clienteNombre) {
        const key = item.clienteNombre.toLowerCase();
        const existente = clientes.find((c) => c.nombre.toLowerCase() === key);
        if (existente) clienteId = existente.id;
        else if (clientesNuevos[key]) clienteId = clientesNuevos[key];
        else {
          const nuevoId = uid();
          const ok = await createItem("clientes", { id: nuevoId, nombre: item.clienteNombre }, setClientes, clientes);
          if (ok) { clienteId = nuevoId; clientesNuevos[key] = nuevoId; hechos.push(`Cliente nuevo: ${item.clienteNombre}`); }
        }
      }

      const campos = { ...item.campos };

      if (item.entidad === "tarea") {
        if (item.accion === "actualizar" && item.targetId) {
          const ok = await updateItem("tareas", item.targetId, campos, setTareas, tareas);
          if (ok) hechos.push(resumenAccion(item));
        } else {
          const ok = await createItem("tareas", { id: uid(), estado: "Pendiente", area: "Profesional", prioridad: "Media", clienteId, ...campos }, setTareas, tareas);
          if (ok) hechos.push(resumenAccion(item));
        }
      } else if (item.entidad === "cobro") {
        const ok = await createItem("cobros", { id: uid(), estado: "Pendiente", clienteId, ...campos }, setCobros, []);
        if (ok) hechos.push(resumenAccion(item));
      } else if (item.entidad === "agenda") {
        const ok = await createItem("agenda", { id: uid(), tipo: "Reunión", area: "Profesional", clienteId, ...campos }, setAgenda, []);
        if (ok) hechos.push(resumenAccion(item));
      } else if (item.entidad === "documento") {
        if (item.accion === "actualizar" && item.targetId) {
          const ok = await updateItem("documentos_pendientes", item.targetId, campos, setDocumentos, documentos);
          if (ok) hechos.push(resumenAccion(item));
        } else {
          const ok = await createItem("documentos_pendientes", { id: uid(), clienteId, estado: "Solicitado", ...campos }, setDocumentos, documentos);
          if (ok) hechos.push(resumenAccion(item));
        }
      }
    }
    return { hechos, pregunta };
  };

  const guardarSinProcesar = async () => {
    if (!texto.trim() && archivosSeleccionados.length === 0) return;
    const notaId = uid();
    const ok = await createItem("notas_rapidas", { id: notaId, texto: texto.trim() || "(solo adjuntos)", estado: "Nueva", procesada: false }, setNotas, notas);
    if (ok) { await subirSeleccionados(notaId); setTexto(""); }
  };

  const enviar = async () => {
    if ((!texto.trim() && archivosSeleccionados.length === 0) || procesando) return;
    const textoNota = texto.trim();
    setProcesando(true); setErrorIA("");

    const notaId = uid();
    await createItem("notas_rapidas", { id: notaId, texto: textoNota || "(solo adjuntos)", estado: "Nueva", procesada: false }, setNotas, notas);
    await subirSeleccionados(notaId);

    if (!textoNota) {
      await updateItem("notas_rapidas", notaId, { estado: "Completada" }, setNotas, notas);
      setProcesando(false); setTexto("");
      return;
    }

    try {
      const res = await fetch("/api/parse-nota", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: textoNota, contexto: contextoActual() }),
      });
      const data = await res.json();
      if (!res.ok) { setErrorIA(data?.error || "No se pudo procesar la nota."); return; }

      const { hechos, pregunta } = await ejecutarAcciones(data.acciones || []);
      const resumenTexto = hechos.join(" · ") || (pregunta ? "" : "Sin acciones detectadas.");

      if (pregunta) {
        await createItem("mensajes_nota", { id: uid(), notaId, rol: "sistema", contenido: pregunta }, setMensajes, mensajes);
        await updateItem("notas_rapidas", notaId, { estado: "Necesita aclaración", resumen: resumenTexto }, setNotas, notas);
      } else {
        await updateItem("notas_rapidas", notaId, { estado: "Completada", procesada: true, resumen: resumenTexto }, setNotas, notas);
      }
      setTexto("");
    } catch (e) {
      setErrorIA(e?.message || "No se pudo conectar con el servidor.");
    } finally {
      setProcesando(false);
    }
  };

  /** Continúa el chat de aclaración de una nota existente — nunca crea una nota nueva. */
  const responderEnNota = async (notaId, textoRespuesta) => {
    const nota = notas.find((n) => n.id === notaId);
    if (!nota) return;

    const okMsg = await createItem("mensajes_nota", { id: uid(), notaId, rol: "carolina", contenido: textoRespuesta }, setMensajes, mensajes);
    if (!okMsg) return;

    const historialChat = mensajes
      .filter((m) => m.notaId === notaId)
      .concat([{ notaId, rol: "carolina", contenido: textoRespuesta }])
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))
      .map((m) => ({ rol: m.rol, contenido: m.contenido }));

    try {
      const res = await fetch("/api/parse-nota", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: nota.texto, contexto: contextoActual(), historialChat }),
      });
      const data = await res.json();
      if (!res.ok) {
        await createItem("mensajes_nota", { id: uid(), notaId, rol: "sistema", contenido: `No pude procesar tu respuesta: ${data?.error || "error desconocido"}.` }, setMensajes, mensajes);
        return;
      }

      const { hechos, pregunta } = await ejecutarAcciones(data.acciones || []);
      const resumenPrevio = nota.resumen || "";
      const resumenNuevo = [resumenPrevio, ...hechos].filter(Boolean).join(" · ");

      if (pregunta) {
        await createItem("mensajes_nota", { id: uid(), notaId, rol: "sistema", contenido: pregunta }, setMensajes, mensajes);
        await updateItem("notas_rapidas", notaId, { resumen: resumenNuevo }, setNotas, notas);
      } else {
        const cierre = hechos.length ? `Listo. ${hechos.join(" · ")}.` : "Listo, quedó organizado.";
        await createItem("mensajes_nota", { id: uid(), notaId, rol: "sistema", contenido: cierre }, setMensajes, mensajes);
        await updateItem("notas_rapidas", notaId, { estado: "Completada", procesada: true, resumen: resumenNuevo }, setNotas, notas);
      }
    } catch (e) {
      await createItem("mensajes_nota", { id: uid(), notaId, rol: "sistema", contenido: "No pude conectarme para procesar tu respuesta. Intenta de nuevo." }, setMensajes, mensajes);
    }
  };

  const notasVisibles = notas.filter((n) => n.estado !== "Archivada");

  return (
    <div>
      <SectionTitle sub="Escribe lo que tienes en mente, tal como lo piensas. Caro Control ejecuta lo que pueda y solo abre una pregunta, aquí mismo en la nota, cuando de verdad hace falta.">
        ¿Qué tienes en mente?
      </SectionTitle>

      <PreferenciasPanel perfil={perfil} guardarPerfil={guardarPerfil} />

      <Card className="p-4 mb-6">
        <textarea
          value={texto}
          onChange={(e) => { setTexto(e.target.value); setErrorIA(""); }}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) enviar(); }}
          rows={4}
          placeholder='Ej. "Pedro bancos" o "Hoy Pedro me mandó los extractos, cobrarle 900 mil el viernes"'
          className={inputCls}
          style={inputStyle}
        />

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) agregarArchivos(e.target.files); e.target.value = ""; }}
        />

        {archivosSeleccionados.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {archivosSeleccionados.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-xs" style={{ background: "#F5F1EE", color: "#6B6570" }}>
                {f.name} <span style={{ color: "#B0A99A" }}>({fmtBytes(f.size)})</span>
                <button onClick={() => quitarSeleccionado(i)} className="p-0.5 rounded-full hover:bg-white"><X size={11} /></button>
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button onClick={enviar} disabled={(!texto.trim() && archivosSeleccionados.length === 0) || procesando} className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg text-white disabled:opacity-40" style={{ background: "#7A2E4A" }}>
            {procesando ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {procesando ? "Procesando…" : "Enviar"}
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg" style={{ color: "#7A2E4A", border: "1px solid #7A2E4A" }}>
            <Plus size={14} /> Adjuntar
          </button>
          <button onClick={guardarSinProcesar} disabled={(!texto.trim() && archivosSeleccionados.length === 0) || procesando} className="text-sm font-medium px-3 py-2" style={{ color: "#6B6570" }}>
            Solo guardar
          </button>
          <button onClick={copiarPrompt} disabled={!texto.trim()} className="text-xs px-2 py-1 ml-auto disabled:opacity-40" style={{ color: "#B0A99A" }}>
            {copiado ? "Copiado" : "¿Falla la IA? copiar prompt manual"}
          </button>
        </div>
        {errorIA && (
          <div className="flex items-start gap-2 mt-3 text-xs px-3 py-2 rounded-lg" style={{ background: "#8B2E3F0d", color: "#8B2E3F", border: "1px solid #8B2E3F33" }}>
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /> {errorIA} — la nota ya quedó guardada en tu historial de abajo, sin procesar.
          </div>
        )}
      </Card>

      {notasVisibles.length === 0 ? (
        <EmptyState icon={PenLine} text="Tu historial de notas aparecerá aquí." />
      ) : (
        <div className="space-y-2">
          {notasVisibles.map((n) => (
            <NotaCard
              key={n.id}
              nota={n}
              mensajesDeNota={mensajes.filter((m) => m.notaId === n.id).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))}
              adjuntosDeNota={archivos.filter((a) => a.notaId === n.id)}
              onResponder={responderEnNota}
              onMarcarProcesada={(id) => updateItem("notas_rapidas", id, { estado: "Completada", procesada: true }, setNotas, notas)}
              onArchivar={(id) => updateItem("notas_rapidas", id, { estado: "Archivada" }, setNotas, notas)}
              onEliminar={(id) => deleteItem("notas_rapidas", id, setNotas, notas)}
              onVerArchivo={verArchivo}
              onEliminarArchivo={eliminarArchivo}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Búsqueda global
   ============================================================ */

function SearchResultsView({ results, clienteNombre, onClear }) {
  const total = results.clientes.length + results.tareas.length + results.cobros.length + results.agenda.length;
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SectionTitle sub={`${total} resultados`}>Búsqueda</SectionTitle>
        <button onClick={onClear} className="text-sm" style={{ color: "#7A2E4A" }}>Limpiar</button>
      </div>
      {total === 0 && <EmptyState icon={Search} text="Sin resultados." />}
      {results.clientes.length > 0 && (
        <ResultGroup title="Clientes">
          {results.clientes.map((c) => <div key={c.id} className="text-sm py-1.5" style={{ color: "#2B2440" }}>{c.nombre}</div>)}
        </ResultGroup>
      )}
      {results.tareas.length > 0 && (
        <ResultGroup title="Tareas">
          {results.tareas.map((t) => <div key={t.id} className="text-sm py-1.5" style={{ color: "#2B2440" }}>{t.titulo}</div>)}
        </ResultGroup>
      )}
      {results.cobros.length > 0 && (
        <ResultGroup title="Cobros">
          {results.cobros.map((c) => <div key={c.id} className="text-sm py-1.5" style={{ color: "#2B2440" }}>{clienteNombre(c.clienteId)} — {c.concepto} ({fmtCOP(c.valor)})</div>)}
        </ResultGroup>
      )}
      {results.agenda.length > 0 && (
        <ResultGroup title="Agenda">
          {results.agenda.map((a) => <div key={a.id} className="text-sm py-1.5" style={{ color: "#2B2440" }}>{a.titulo} — {fmtDate(a.fecha)}</div>)}
        </ResultGroup>
      )}
    </div>
  );
}

function ResultGroup({ title, children }) {
  return (
    <Card className="p-4 mb-3">
      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#8A8398" }}>{title}</p>
      {children}
    </Card>
  );
}
