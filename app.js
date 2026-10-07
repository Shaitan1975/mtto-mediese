// ═══════════════════════════════════════════════════════════════════
// SISTEMA DE MANTENIMIENTO MEDIESE - FRONTEND v1.1
// Fase 1: Almacén de mantenimiento
// ═══════════════════════════════════════════════════════════════════

const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwGB71s8Ip9cQIo7sv0tPzKaEe7CAaxQ1Wn5pqz4MVGu4vN10VbEUMBcZoir-TfuyKwdg/exec",
  SESSION_KEY: "mtto_mediese_session",
  ITERACIONES: 100000
};

const App = (() => {

  let usuarioActual = null;
  let cache = {
    refacciones: null,
    proveedores: null,
    ubicaciones: null,
    stock: null,
    movimientos: null
  };

  // ═══════════════════════════════════════════════════════════════
  // UTILIDADES
  // ═══════════════════════════════════════════════════════════════

  function getSession() {
    const s = localStorage.getItem(CONFIG.SESSION_KEY);
    return s ? JSON.parse(s) : null;
  }
  function setSession(d) { localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(d)); }
  function clearSession() { localStorage.removeItem(CONFIG.SESSION_KEY); }

  async function pbkdf2Hash(password, saltHex) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
    );
    const saltBytes = new Uint8Array(saltHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: saltBytes, iterations: CONFIG.ITERACIONES, hash: "SHA-256" },
      keyMaterial, 256
    );
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function api(accion, data, metodo) {
    metodo = metodo || "GET";
    const url = CONFIG.APPS_SCRIPT_URL;
    try {
      if (metodo === "GET") {
        const qs = new URLSearchParams({ accion: accion, ...(data || {}) }).toString();
        const r = await fetch(url + "?" + qs, { cache: "no-store", redirect: "follow" });
        return await r.json();
      } else {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ accion: accion, data: data }),
          redirect: "follow"
        });
        return await r.json();
      }
    } catch (e) {
      console.error("Error API:", e);
      return { ok: false, error: e.message };
    }
  }

  async function verificarUsuario(usuario, password) {
    try {
      const resp = await fetch("usuarios.json?t=" + Date.now(), { cache: "no-store" });
      const usuarios = await resp.json();
      const u = usuarios.find(x => x.user === usuario.toLowerCase().trim());
      if (!u || u.activo === false) return null;
      const hash = await pbkdf2Hash(password, u.salt);
      if (hash === u.hash) {
        return { user: u.user, nombre: u.nombre, rol: u.rol, permisos: u.permisos || [] };
      }
      return null;
    } catch (e) {
      console.error("Error verificarUsuario:", e);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // LOGIN
  // ═══════════════════════════════════════════════════════════════

  function initLogin() {
    if (getSession()) { window.location.href = "app.html"; return; }
    const form = document.getElementById("login-form");
    const err = document.getElementById("error-msg");
    const btn = form.querySelector("button");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.textContent = "";
      btn.disabled = true;
      btn.textContent = "Verificando...";
      const u = await verificarUsuario(
        document.getElementById("usuario").value,
        document.getElementById("password").value
      );
      if (u) { setSession(u); window.location.href = "app.html"; }
      else {
        err.textContent = "Usuario o contraseña incorrectos";
        btn.disabled = false;
        btn.textContent = "Entrar";
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // APP
  // ═══════════════════════════════════════════════════════════════

  function initApp() {
    usuarioActual = getSession();
    if (!usuarioActual) { window.location.href = "index.html"; return; }
    const ui = document.getElementById("user-info");
    if (ui) ui.textContent = usuarioActual.nombre + " (" + usuarioActual.rol + ")";

    mostrarBotonesPorRol();

    const addEvent = (id, evento, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(evento, handler);
    };

    addEvent("btn-logout", "click", () => {
      if (confirm("¿Cerrar sesión?")) { clearSession(); window.location.href = "index.html"; }
    });
    addEvent("btn-stock", "click", verStock);
    addEvent("btn-entrada", "click", () => abrirMovimiento("ENTRADA"));
    addEvent("btn-salida", "click", () => abrirMovimiento("SALIDA"));
    addEvent("btn-devolucion", "click", () => abrirMovimiento("DEVOLUCION"));
    addEvent("btn-transferencia", "click", () => abrirMovimiento("TRANSFERENCIA"));
    addEvent("btn-movimientos", "click", verMovimientos);
    addEvent("btn-refacciones", "click", verRefacciones);
    addEvent("btn-alertas", "click", verAlertas);
    addEvent("btn-proveedores", "click", verProveedores);
    addEvent("btn-ubicaciones", "click", verUbicaciones);
    addEvent("btn-reconstruir", "click", reconstruirStock);
    addEvent("btn-agregar-linea", "click", agregarLinea);
    addEvent("btn-guardar-mov", "click", guardarMovimiento);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    mostrarVista("view-menu");
  }

  function mostrarBotonesPorRol() {
    const rol = usuarioActual.rol;
    const ocultar = (id) => { const el = document.getElementById(id); if (el) el.style.display = "none"; };
    if (rol === "tecnico") {
      ocultar("btn-entrada"); ocultar("btn-transferencia"); ocultar("btn-refacciones");
      ocultar("btn-proveedores"); ocultar("btn-ubicaciones"); ocultar("btn-reconstruir");
    } else if (rol === "supervisor") {
      ocultar("btn-reconstruir");
    } else if (rol === "gerencia") {
      ocultar("btn-reconstruir");
    }
  }

  function mostrarVista(id) {
    ["view-menu","view-stock","view-movimiento","view-movimientos",
     "view-refacciones","view-alertas","view-proveedores","view-ubicaciones",
     "view-loading"].forEach(v => {
      const el = document.getElementById(v);
      if (el) el.classList.add("hidden");
    });
    const el = document.getElementById(id);
    if (el) el.classList.remove("hidden");
  }

  function volverAlMenu() { mostrarVista("view-menu"); }

  // ═══════════════════════════════════════════════════════════════
  // STOCK
  // ═══════════════════════════════════════════════════════════════

  async function verStock() {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Cargando stock...";
    try {
      const r = await api("listar_stock");
      if (!r.ok) throw new Error(r.error || "Error desconocido");
      cache.stock = r.items;
      renderStock(r.items);
      mostrarVista("view-stock");
    } catch (e) {
      alert("Error: " + e.message);
      volverAlMenu();
    }
  }

  function renderStock(items) {
    const cont = document.getElementById("lista-stock");
    cont.innerHTML = "";
    if (!items || !items.length) {
      cont.innerHTML = "<p style='text-align:center;padding:20px;color:#888;'>Sin stock registrado.</p>";
      return;
    }
    items.forEach(x => {
      const d = document.createElement("div");
      d.className = "stock-item";
      d.innerHTML =
        "<div class='stock-cod'>" + x.codigo + "</div>" +
        "<div class='stock-saldo'>" + x.saldo + " " + x.unidad + "</div>" +
        "<div class='stock-desc'>" + x.descripcion + "</div>" +
        "<div class='stock-info'>Lote: " + x.lote + " | " + x.ubicacion + "</div>";
      cont.appendChild(d);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // MOVIMIENTOS
  // ═══════════════════════════════════════════════════════════════

  async function abrirMovimiento(tipo) {
    document.getElementById("mov-titulo").textContent = tipo;
    document.getElementById("mov-tipo").value = tipo;
    document.getElementById("mov-lineas").innerHTML = "";
    document.getElementById("mov-status").textContent = "";
    document.getElementById("mov-referencia").value = "";
    document.getElementById("mov-notas").value = "";
    document.getElementById("mov-proveedor").value = "";

    const grupoProv = document.getElementById("grupo-proveedor");
    const grupoDest = document.getElementById("grupo-ubicacion-destino");
    const grupoOrig = document.getElementById("grupo-ubicacion-origen");

    grupoProv.classList.add("hidden");
    grupoDest.classList.add("hidden");
    grupoOrig.classList.add("hidden");

    if (tipo === "ENTRADA") {
      grupoProv.classList.remove("hidden");
    } else if (tipo === "TRANSFERENCIA") {
      grupoOrig.classList.remove("hidden");
      grupoDest.classList.remove("hidden");
    } else {
      grupoOrig.classList.remove("hidden");
    }

    await cargarUbicacionesSelects();
    await agregarLinea();
    mostrarVista("view-movimiento");
  }

  async function cargarUbicacionesSelects() {
    if (!cache.ubicaciones) {
      const r = await api("listar_ubicaciones");
      cache.ubicaciones = r.ubicaciones || [];
    }
    const opts = cache.ubicaciones.map(u =>
      "<option value='" + u.codigo + "'>" + u.nombre + "</option>"
    ).join("");
    const selOrig = document.getElementById("mov-ubicacion-origen");
    const selDest = document.getElementById("mov-ubicacion-destino");
    if (selOrig) selOrig.innerHTML = opts;
    if (selDest) selDest.innerHTML = opts;
  }

  async function agregarLinea() {
    if (!cache.refacciones) {
      const r = await api("listar_refacciones");
      cache.refacciones = r.refacciones || [];
    }
    if (!cache.ubicaciones) {
      const r = await api("listar_ubicaciones");
      cache.ubicaciones = r.ubicaciones || [];
    }
    const cont = document.getElementById("mov-lineas");
    if (!cont) return;

    const div = document.createElement("div");
    div.className = "linea";

    const optsRef = cache.refacciones.map(r =>
      "<option value='" + r.codigo + "'>" + r.codigo + " - " + r.descripcion + "</option>"
    ).join("");
    const optsUbic = cache.ubicaciones.map(u =>
      "<option value='" + u.codigo + "'>" + u.codigo + "</option>"
    ).join("");

    div.innerHTML =
      "<select class='lin-codigo'>" + optsRef + "</select>" +
      "<input class='lin-lote' placeholder='Lote' />" +
      "<input class='lin-cantidad' type='number' placeholder='Cantidad' step='0.01' />" +
      "<select class='lin-ubicacion'>" + optsUbic + "</select>" +
      "<input class='lin-pu' type='number' placeholder='PU' step='0.01' />" +
      "<input class='lin-iva' type='number' placeholder='IVA' step='0.01' />" +
      "<button type='button' class='btn-quitar'>X</button>";

    div.querySelector(".btn-quitar").addEventListener("click", () => div.remove());

    // Auto-llenar PU, IVA y lote por defecto al cambiar refacción
    const selCod = div.querySelector(".lin-codigo");
    selCod.addEventListener("change", () => {
      const ref = cache.refacciones.find(r => r.codigo === selCod.value);
      if (ref) {
        div.querySelector(".lin-pu").value = ref.pu || 0;
        div.querySelector(".lin-iva").value = ref.iva || 0;
        if (ref.maneja_lote === "NO") {
          div.querySelector(".lin-lote").value = "SIN_LOTE";
        }
      }
    });

    // Disparar el change para llenar PU/IVA del primero
    if (cache.refacciones.length > 0) {
      selCod.dispatchEvent(new Event("change"));
    }

    cont.appendChild(div);
  }

  async function guardarMovimiento() {
    const tipo = document.getElementById("mov-tipo").value;
    const lineas = [];
    document.querySelectorAll("#mov-lineas .linea").forEach(l => {
      const codigo = l.querySelector(".lin-codigo").value;
      const ref = cache.refacciones.find(r => r.codigo === codigo) || {};
      lineas.push({
        codigo: codigo,
        descripcion: ref.descripcion || "",
        lote: l.querySelector(".lin-lote").value.trim() || "SIN_LOTE",
        cantidad: Number(l.querySelector(".lin-cantidad").value) || 0,
        unidad: ref.unidad || "PZ",
        ubicacion: l.querySelector(".lin-ubicacion").value,
        pu: Number(l.querySelector(".lin-pu").value) || 0,
        iva: Number(l.querySelector(".lin-iva").value) || 0,
        moneda: ref.moneda || "MXN"
      });
    });

    if (lineas.length === 0 || lineas.every(l => l.cantidad <= 0)) {
      document.getElementById("mov-status").textContent = "❌ Agrega al menos una línea con cantidad";
      document.getElementById("mov-status").className = "send-status error";
      return;
    }

    const body = {
      tipo_movimiento: tipo,
      referencia: document.getElementById("mov-referencia").value.trim(),
      proveedor_cliente: document.getElementById("mov-proveedor").value.trim(),
      ubicacion_origen: document.getElementById("mov-ubicacion-origen").value,
      ubicacion_destino: document.getElementById("mov-ubicacion-destino").value,
      notas: document.getElementById("mov-notas").value.trim(),
      moneda: "MXN",
      tipo_cambio: 0,
      lineas: lineas,
      usuario: usuarioActual.user,
      nombre_usuario: usuarioActual.nombre,
      rol: usuarioActual.rol
    };

    const status = document.getElementById("mov-status");
    status.textContent = "Guardando...";
    status.className = "send-status";

    try {
      const r = await api("registrar_movimiento", body, "POST");
      if (!r.ok) throw new Error(r.error || "Error desconocido");
      status.textContent = "✅ " + r.mensaje + " (" + r.id_movimiento + ")";
      status.className = "send-status ok";
      setTimeout(volverAlMenu, 1800);
    } catch (e) {
      status.textContent = "❌ " + e.message;
      status.className = "send-status error";
    }
  }

  async function verMovimientos() {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Cargando movimientos...";
    try {
      const r = await api("listar_movimientos");
      if (!r.ok) throw new Error(r.error);
      const cont = document.getElementById("lista-movimientos");
      cont.innerHTML = "";
      if (!r.movimientos || !r.movimientos.length) {
        cont.innerHTML = "<p style='text-align:center;padding:20px;color:#888;'>Sin movimientos.</p>";
      } else {
        r.movimientos.forEach(m => {
          const d = document.createElement("div");
          d.className = "mov-item";
          d.innerHTML =
            "<div class='mov-id'>" + m.id + "</div>" +
            "<div class='mov-total'>$" + Number(m.total).toFixed(2) + "</div>" +
            "<div class='mov-tipo'>" + m.tipo + " · " + m.fecha + " " + m.hora + "</div>" +
            "<div class='mov-user'>" + m.nombre_usuario + " · " + m.estado + "</div>";
          cont.appendChild(d);
        });
      }
      mostrarVista("view-movimientos");
    } catch (e) {
      alert("Error: " + e.message);
      volverAlMenu();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // REFACCIONES
  // ═══════════════════════════════════════════════════════════════

  async function verRefacciones() {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Cargando refacciones...";
    try {
      const r = await api("listar_refacciones");
      if (!r.ok) throw new Error(r.error);
      cache.refacciones = r.refacciones;
      const cont = document.getElementById("lista-refacciones");
      cont.innerHTML = "";
      if (!r.refacciones.length) {
        cont.innerHTML = "<p style='text-align:center;padding:20px;color:#888;'>Sin refacciones registradas.</p>";
      } else {
        r.refacciones.forEach(x => {
          const d = document.createElement("div");
          d.className = "ref-item";
          d.innerHTML =
            "<div class='ref-cod'>" + x.codigo + "</div>" +
            "<div class='ref-info'>min " + x.minimo + " / max " + x.maximo + "</div>" +
            "<div class='ref-desc'>" + x.descripcion + "</div>" +
            "<div class='ref-info'>" + x.unidad + " · " + x.categoria + " · $" + x.pu + " " + x.moneda + "</div>";
          cont.appendChild(d);
        });
      }
      mostrarVista("view-refacciones");
    } catch (e) {
      alert("Error: " + e.message);
      volverAlMenu();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ALERTAS
  // ═══════════════════════════════════════════════════════════════

  async function verAlertas() {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Cargando alertas...";
    try {
      const r = await api("listar_alertas_stock");
      if (!r.ok) throw new Error(r.error);
      const cont = document.getElementById("lista-alertas");
      cont.innerHTML = "";
      if (!r.alertas.length) {
        cont.innerHTML = "<p style='text-align:center;padding:20px;color:#888;'>Sin alertas.</p>";
      } else {
        r.alertas.forEach(a => {
          const d = document.createElement("div");
          d.className = "alerta-item";
          d.innerHTML =
            "<div class='alerta-cod'>" + a.codigo + "</div>" +
            "<div class='alerta-saldo'>" + a.saldo_actual + " / min " + a.minimo + "</div>" +
            "<div class='alerta-desc'>" + a.descripcion + "</div>" +
            "<div class='ref-info'>" + a.ubicacion + " · " + a.fecha + "</div>";
          cont.appendChild(d);
        });
      }
      mostrarVista("view-alertas");
    } catch (e) {
      alert("Error: " + e.message);
      volverAlMenu();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PROVEEDORES
  // ═══════════════════════════════════════════════════════════════

  async function verProveedores() {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Cargando proveedores...";
    try {
      const r = await api("listar_proveedores");
      if (!r.ok) throw new Error(r.error);
      const cont = document.getElementById("lista-proveedores");
      cont.innerHTML = "";
      if (!r.proveedores.length) {
        cont.innerHTML = "<p style='text-align:center;padding:20px;color:#888;'>Sin proveedores.</p>";
      } else {
        r.proveedores.forEach(p => {
          const d = document.createElement("div");
          d.className = "ref-item";
          d.innerHTML =
            "<div class='ref-cod'>" + p.codigo + "</div>" +
            "<div class='ref-info'>" + p.moneda + "</div>" +
            "<div class='ref-desc'>" + p.razon_social + "</div>" +
            "<div class='ref-info'>" + (p.contacto || "") + " · " + (p.telefono || "") + "</div>";
          cont.appendChild(d);
        });
      }
      mostrarVista("view-proveedores");
    } catch (e) {
      alert("Error: " + e.message);
      volverAlMenu();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // UBICACIONES
  // ═══════════════════════════════════════════════════════════════

  async function verUbicaciones() {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Cargando ubicaciones...";
    try {
      const r = await api("listar_ubicaciones");
      if (!r.ok) throw new Error(r.error);
      cache.ubicaciones = r.ubicaciones;
      const cont = document.getElementById("lista-ubicaciones");
      cont.innerHTML = "";
      if (!r.ubicaciones.length) {
        cont.innerHTML = "<p style='text-align:center;padding:20px;color:#888;'>Sin ubicaciones.</p>";
      } else {
        r.ubicaciones.forEach(u => {
          const d = document.createElement("div");
          d.className = "ref-item";
          d.innerHTML =
            "<div class='ref-cod'>" + u.codigo + "</div>" +
            "<div class='ref-info'>" + u.tipo + "</div>" +
            "<div class='ref-desc'>" + u.nombre + "</div>" +
            "<div class='ref-info'>Responsable: " + (u.responsable || "-") + "</div>";
          cont.appendChild(d);
        });
      }
      mostrarVista("view-ubicaciones");
    } catch (e) {
      alert("Error: " + e.message);
      volverAlMenu();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // RECONSTRUIR STOCK
  // ═══════════════════════════════════════════════════════════════

  async function reconstruirStock() {
    if (usuarioActual.rol !== "admin") return;
    if (!confirm("¿Reconstruir stock desde movimientos?\n\nEsto recalcula STOCK_ACTUAL desde cero. Puede tardar unos segundos.")) return;
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Reconstruyendo stock...";
    try {
      const r = await api("reconstruir_stock", {}, "POST");
      if (!r.ok) throw new Error(r.error);
      alert("✅ " + r.total + " items reconstruidos");
      volverAlMenu();
    } catch (e) {
      alert("Error: " + e.message);
      volverAlMenu();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // EXPORTAR
  // ═══════════════════════════════════════════════════════════════

  return {
    initLogin,
    initApp,
    volverAlMenu,
    agregarLinea
  };

})();

// Exponer al scope global para botones onclick inline
window.App = App;