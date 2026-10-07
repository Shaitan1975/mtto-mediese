// ═══════════════════════════════════════════════════════════════════
// SISTEMA DE MANTENIMIENTO MEDIESE - FRONTEND v1.0
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
    stock: null
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
  }

  async function verificarUsuario(usuario, password) {
    const resp = await fetch("usuarios.json?t=" + Date.now(), { cache: "no-store" });
    const usuarios = await resp.json();
    const u = usuarios.find(x => x.user === usuario.toLowerCase().trim());
    if (!u || u.activo === false) return null;
    const hash = await pbkdf2Hash(password, u.salt);
    if (hash === u.hash) {
      return { user: u.user, nombre: u.nombre, rol: u.rol, permisos: u.permisos || [] };
    }
    return null;
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
    document.getElementById("user-info").textContent =
      usuarioActual.nombre + " (" + usuarioActual.rol + ")";

    // Menú dinámico por rol
    mostrarBotonesPorRol();

    // Listeners
    document.getElementById("btn-logout").addEventListener("click", () => {
      if (confirm("¿Cerrar sesión?")) { clearSession(); window.location.href = "index.html"; }
    });
    document.getElementById("btn-stock").addEventListener("click", verStock);
    document.getElementById("btn-entrada").addEventListener("click", () => abrirMovimiento("ENTRADA"));
    document.getElementById("btn-salida").addEventListener("click", () => abrirMovimiento("SALIDA"));
    document.getElementById("btn-devolucion").addEventListener("click", () => abrirMovimiento("DEVOLUCION"));
    document.getElementById("btn-transferencia").addEventListener("click", () => abrirMovimiento("TRANSFERENCIA"));
    document.getElementById("btn-movimientos").addEventListener("click", verMovimientos);
    document.getElementById("btn-refacciones").addEventListener("click", verRefacciones);
    document.getElementById("btn-alertas").addEventListener("click", verAlertas);
    document.getElementById("btn-proveedores").addEventListener("click", verProveedores);
    document.getElementById("btn-ubicaciones").addEventListener("click", verUbicaciones);
    document.getElementById("btn-reconstruir").addEventListener("click", reconstruirStock);

    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    mostrarVista("view-menu");
  }

  function mostrarBotonesPorRol() {
    const rol = usuarioActual.rol;
    const ocultar = (id) => { const el = document.getElementById(id); if (el) el.classList.add("hidden"); };
    if (rol === "tecnico") {
      ocultar("btn-entrada"); ocultar("btn-transferencia"); ocultar("btn-refacciones");
      ocultar("btn-proveedores"); ocultar("btn-ubicaciones"); ocultar("btn-reconstruir");
    } else if (rol === "supervisor") {
      ocultar("btn-reconstruir");
    } else if (rol === "gerencia") {
      ocultar("btn-reconstruir");
    }
    // admin ve todo
  }

  function mostrarVista(id) {
    ["view-menu","view-stock","view-movimiento","view-movimientos",
     "view-refacciones","view-alertas","view-proveedores","view-ubicaciones",
     "view-loading"].forEach(v => {
      const el = document.getElementById(v);
      if (el) el.classList.add("hidden");
    });
    document.getElementById(id).classList.remove("hidden");
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
      if (!r.ok) throw new Error(r.error);
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
    if (!items.length) {
      cont.innerHTML = "<p>Sin stock.</p>";
      return;
    }
    items.forEach(x => {
      const d = document.createElement("div");
      d.className = "stock-item";
      d.innerHTML =
        "<div class='stock-cod'>" + x.codigo + "</div>" +
        "<div class='stock-desc'>" + x.descripcion + "</div>" +
        "<div class='stock-saldo'>" + x.saldo + " " + x.unidad + "</div>" +
        "<div class='stock-info'>Lote: " + x.lote + " | " + x.ubicacion + "</div>";
      cont.appendChild(d);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // MOVIMIENTOS
  // ═══════════════════════════════════════════════════════════════

  async function abrirMovimiento(tipo) {
    const cont = document.getElementById("mov-titulo");
    cont.textContent = tipo;
    document.getElementById("mov-tipo").value = tipo;
    document.getElementById("mov-lineas").innerHTML = "";
    document.getElementById("mov-status").textContent = "";
    document.getElementById("mov-referencia").value = "";
    document.getElementById("mov-notas").value = "";
    document.getElementById("mov-proveedor").value = "";
    document.getElementById("mov-ubicacion-origen").value = "";
    document.getElementById("mov-ubicacion-destino").value = "";

    const grupoProv = document.getElementById("grupo-proveedor");
    const grupoDest = document.getElementById("grupo-ubicacion-destino");
    const grupoOrig = document.getElementById("grupo-ubicacion-origen");
    if (tipo === "ENTRADA") {
      grupoProv.classList.remove("hidden");
      grupoDest.classList.add("hidden");
      grupoOrig.classList.add("hidden");
    } else if (tipo === "TRANSFERENCIA") {
      grupoProv.classList.add("hidden");
      grupoDest.classList.remove("hidden");
      grupoOrig.classList.remove("hidden");
    } else {
      grupoProv.classList.add("hidden");
      grupoDest.classList.add("hidden");
      grupoOrig.classList.remove("hidden");
    }

    await cargarUbicacionesSelects();
    agregarLinea();
    mostrarVista("view-movimiento");
  }

  async function cargarUbicacionesSelects() {
    if (!cache.ubicaciones) {
      const r = await api("listar_ubicaciones");
      cache.ubicaciones = r.ubicaciones || [];
    }
    const opts = cache.ubicaciones.map(u => "<option value='" + u.codigo + "'>" + u.nombre + "</option>").join("");
    document.getElementById("mov-ubicacion-origen").innerHTML = opts;
    document.getElementById("mov-ubicacion-destino").innerHTML = opts;
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
    const div = document.createElement("div");
    div.className = "linea";
    div.innerHTML =
      "<select class='lin-codigo'>" +
        cache.refacciones.map(r => "<option value='" + r.codigo + "'>" + r.codigo + " - " + r.descripcion + "</option>").join("") +
      "</select>" +
      "<input class='lin-lote' placeholder='Lote' />" +
      "<input class='lin-cantidad' type='number' placeholder='Cantidad' />" +
      "<select class='lin-ubicacion'>" +
        cache.ubicaciones.map(u => "<option value='" + u.codigo + "'>" + u.codigo + "</option>").join("") +
      "</select>" +
      "<input class='lin-pu' type='number' placeholder='PU' />" +
      "<input class='lin-iva' type='number' placeholder='IVA' />" +
      "<button type='button' class='btn-quitar'>X</button>";
    div.querySelector(".btn-quitar").addEventListener("click", () => div.remove());
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
        lote: l.querySelector(".lin-lote").value.trim(),
        cantidad: Number(l.querySelector(".lin-cantidad").value) || 0,
        unidad: ref.unidad || "",
        ubicacion: l.querySelector(".lin-ubicacion").value,
        pu: Number(l.querySelector(".lin-pu").value) || 0,
        iva: Number(l.querySelector(".lin-iva").value) || 0,
        moneda: ref.moneda || "MXN"
      });
    });

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
    try {
      const r = await api("registrar_movimiento", body, "POST");
      if (!r.ok) throw new Error(r.error);
      status.textContent = "✅ " + r.mensaje + " (" + r.id_movimiento + ")";
      setTimeout(volverAlMenu, 1500);
    } catch (e) {
      status.textContent = "❌ " + e.message;
    }
  }

  async function verMovimientos() {
    mostrarVista("view-loading");
    try {
      const r = await api("listar_movimientos");
      const cont = document.getElementById("lista-movimientos");
      cont.innerHTML = "";
      (r.movimientos || []).forEach(m => {
        const d = document.createElement("div");
        d.className = "mov-item";
        d.innerHTML =
          "<div class='mov-id'>" + m.id + "</div>" +
          "<div class='mov-tipo'>" + m.tipo + " " + m.fecha + " " + m.hora + "</div>" +
          "<div class='mov-total'>$" + m.total.toFixed(2) + "</div>" +
          "<div class='mov-user'>" + m.nombre_usuario + " (" + m.estado + ")</div>";
        cont.appendChild(d);
      });
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
    try {
      const r = await api("listar_refacciones");
      const cont = document.getElementById("lista-refacciones");
      cont.innerHTML = "";
      (r.refacciones || []).forEach(x => {
        const d = document.createElement("div");
        d.className = "ref-item";
        d.innerHTML =
          "<div class='ref-cod'>" + x.codigo + "</div>" +
          "<div class='ref-desc'>" + x.descripcion + "</div>" +
          "<div class='ref-info'>" + x.unidad + " | " + x.categoria + " | min " + x.minimo + "</div>";
        cont.appendChild(d);
      });
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
    try {
      const r = await api("listar_alertas_stock");
      const cont = document.getElementById("lista-alertas");
      cont.innerHTML = "";
      if (!r.alertas.length) cont.innerHTML = "<p>Sin alertas.</p>";
      r.alertas.forEach(a => {
        const d = document.createElement("div");
        d.className = "alerta-item";
        d.innerHTML =
          "<div class='alerta-cod'>" + a.codigo + "</div>" +
          "<div class='alerta-desc'>" + a.descripcion + "</div>" +
          "<div class='alerta-saldo'>" + a.saldo_actual + " / min " + a.minimo + "</div>";
        cont.appendChild(d);
      });
      mostrarVista("view-alertas");
    } catch (e) {
      alert("Error: " + e.message);
      volverAlMenu();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PROVEEDORES / UBICACIONES
  // ═══════════════════════════════════════════════════════════════

  async function verProveedores() {
    const r = await api("listar_proveedores");
    alert("Proveedores: " + (r.proveedores || []).length + "\n(Implementar vista completa)");
  }

  async function verUbicaciones() {
    const r = await api("listar_ubicaciones");
    alert("Ubicaciones: " + (r.ubicaciones || []).length + "\n(Implementar vista completa)");
  }

  // ═══════════════════════════════════════════════════════════════
  // RECONSTRUIR STOCK
  // ═══════════════════════════════════════════════════════════════

  async function reconstruirStock() {
    if (usuarioActual.rol !== "admin") return;
    if (!confirm("¿Reconstruir stock desde movimientos?")) return;
    mostrarVista("view-loading");
    try {
      const r = await api("reconstruir_stock", {}, "POST");
      alert("✅ " + r.total + " items reconstruidos");
      volverAlMenu();
    } catch (e) {
      alert("Error: " + e.message);
      volverAlMenu();
    }
  }

  return { initLogin, initApp };
})();
