// ═══════════════════════════════════════════════════════════════════
// SISTEMA DE MANTENIMIENTO MEDIESE - FRONTEND v1.4
// Fase 1: Almacén de mantenimiento
// Línea rediseñada + buscadores corregidos
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

  function normalizar(t) {
    if (!t) return "";
    return String(t).trim().toUpperCase();
  }

  function fmtMoneda(n) {
    return "$" + Number(n || 0).toFixed(2);
  }

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
    addEvent("btn-guardar-refaccion", "click", guardarRefaccion);
    addEvent("btn-guardar-proveedor", "click", guardarProveedor);
    addEvent("btn-guardar-ubicacion", "click", guardarUbicacion);

    // Service worker desactivado durante desarrollo
// if ("serviceWorker" in navigator) {
//   navigator.serviceWorker.register("sw.js").catch(() => {});
// }
    mostrarVista("view-menu");
  }

  function mostrarBotonesPorRol() {
    const rol = usuarioActual.rol;
    const ocultar = (id) => { const el = document.getElementById(id); if (el) el.style.display = "none"; };
    if (rol === "tecnico") {
      ocultar("btn-entrada"); ocultar("btn-transferencia"); ocultar("btn-refacciones");
      ocultar("btn-proveedores"); ocultar("btn-ubicaciones"); ocultar("btn-reconstruir");
    } else if (rol === "supervisor" || rol === "gerencia") {
      ocultar("btn-reconstruir");
    }
  }

    function mostrarVista(id) {
    [
      "view-menu", "view-stock", "view-movimiento", "view-movimientos",
      "view-refacciones", "view-refaccion-form",
      "view-alertas",
      "view-proveedores", "view-proveedor-form",
      "view-ubicaciones", "view-ubicacion-form",
      "view-loading"
    ].forEach(v => {
      const el = document.getElementById(v);
      if (el) el.classList.add("hidden");
    });
    const el = document.getElementById(id);
    if (el) el.classList.remove("hidden");
  }

  function volverAlMenu() { mostrarVista("view-menu"); }

  // ═══════════════════════════════════════════════════════════════
  // FORMULARIO DE REFACCIÓN
  // ═══════════════════════════════════════════════════════════════

  async function abrirFormRefaccion(codigo) {
    // Cargar ubicaciones y proveedores si no están
    if (!cache.ubicaciones) {
      const r = await api("listar_ubicaciones");
      cache.ubicaciones = r.ubicaciones || [];
    }
    if (!cache.proveedores) {
      const r = await api("listar_proveedores");
      cache.proveedores = r.proveedores || [];
    }
    if (!cache.refacciones) {
      const r = await api("listar_refacciones");
      cache.refacciones = r.refacciones || [];
    }

    // Llenar select de ubicaciones
    const selUbic = document.getElementById("ref-form-ubicacion");
    selUbic.innerHTML = cache.ubicaciones.map(u =>
      "<option value='" + u.codigo + "'>" + u.nombre + "</option>"
    ).join("");

    // Configurar formulario
    const modo = codigo ? "editar" : "crear";
    document.getElementById("ref-form-modo").value = modo;
    document.getElementById("ref-form-codigo-original").value = codigo || "";
    document.getElementById("ref-form-titulo").textContent = modo === "crear" ? "Nueva refacción" : "Editar refacción";

    // Buscador de proveedor habitual
    const contProv = document.getElementById("ref-form-proveedor-container");
    contProv.innerHTML = "";
    const buscadorProv = crearBuscador({
      placeholder: "Buscar proveedor...",
      obtenerDatos: async () => cache.proveedores,
      filtrar: (item, q) =>
        normalizar(item.codigo).includes(q) ||
        normalizar(item.razon_social).includes(q),
      renderItem: (item) =>
        "<div class='buscador-cod'>" + item.codigo + "</div>" +
        "<div class='buscador-desc'>" + item.razon_social + "</div>",
      renderSeleccion: (item) => item.razon_social,
      onSelect: (item) => {
        contProv.dataset.codigo = item.codigo;
        // Si el proveedor cotiza en USD, poner la moneda
        const selMon = document.getElementById("ref-form-moneda");
        if (item.moneda) selMon.value = item.moneda;
      }
    });
    contProv.appendChild(buscadorProv);

    // Si es editar, precargar
    if (codigo) {
      const ref = cache.refacciones.find(r => r.codigo === codigo);
      if (ref) {
        document.getElementById("ref-form-codigo").value = ref.codigo;
        document.getElementById("ref-form-codigo").disabled = true; // no se puede cambiar
        document.getElementById("ref-form-descripcion").value = ref.descripcion || "";
        document.getElementById("ref-form-unidad").value = ref.unidad || "PZ";
        document.getElementById("ref-form-categoria").value = ref.categoria || "OTROS";
        document.getElementById("ref-form-marca").value = ref.marca || "";
        document.getElementById("ref-form-modelo").value = ref.modelo || "";
        document.getElementById("ref-form-minimo").value = ref.minimo || 0;
        document.getElementById("ref-form-maximo").value = ref.maximo || 0;
        document.getElementById("ref-form-maneja-lote").value = ref.maneja_lote || "NO";
        document.getElementById("ref-form-ubicacion").value = ref.ubicacion_defecto || "";
        document.getElementById("ref-form-pu").value = ref.pu || 0;
        document.getElementById("ref-form-iva").value = ref.iva || 0;
        document.getElementById("ref-form-moneda").value = ref.moneda || "MXN";
        document.getElementById("ref-form-tipo-cambio").value = ref.tipo_cambio || 0;
        document.getElementById("ref-form-notas").value = ref.notas || "";
        // Proveedor
        if (ref.proveedor_habitual) {
          const prov = cache.proveedores.find(p => p.codigo === ref.proveedor_habitual);
          if (prov) {
            buscadorProv.setValue(prov.razon_social);
            contProv.dataset.codigo = prov.codigo;
          }
        }
      }
    } else {
      // Limpiar
      document.getElementById("ref-form-codigo").value = "";
      document.getElementById("ref-form-codigo").disabled = false;
      document.getElementById("ref-form-descripcion").value = "";
      document.getElementById("ref-form-marca").value = "";
      document.getElementById("ref-form-modelo").value = "";
      document.getElementById("ref-form-minimo").value = 0;
      document.getElementById("ref-form-maximo").value = 0;
      document.getElementById("ref-form-pu").value = 0;
      document.getElementById("ref-form-iva").value = 0;
      document.getElementById("ref-form-tipo-cambio").value = 0;
      document.getElementById("ref-form-notas").value = "";
      delete contProv.dataset.codigo;
    }

    document.getElementById("ref-form-status").textContent = "";
    mostrarVista("view-refaccion-form");
  }

  async function guardarRefaccion() {
    const modo = document.getElementById("ref-form-modo").value;
    const codigo = document.getElementById("ref-form-codigo").value.trim();
    const descripcion = document.getElementById("ref-form-descripcion").value.trim();
    const status = document.getElementById("ref-form-status");

    if (!codigo) { status.textContent = "❌ Código obligatorio"; status.className = "send-status error"; return; }
    if (!descripcion) { status.textContent = "❌ Descripción obligatoria"; status.className = "send-status error"; return; }

    const contProv = document.getElementById("ref-form-proveedor-container");
    const body = {
      codigo: codigo,
      descripcion: descripcion,
      unidad: document.getElementById("ref-form-unidad").value,
      categoria: document.getElementById("ref-form-categoria").value,
      marca: document.getElementById("ref-form-marca").value.trim(),
      modelo: document.getElementById("ref-form-modelo").value.trim(),
      minimo: Number(document.getElementById("ref-form-minimo").value) || 0,
      maximo: Number(document.getElementById("ref-form-maximo").value) || 0,
      maneja_lote: document.getElementById("ref-form-maneja-lote").value,
      ubicacion_defecto: document.getElementById("ref-form-ubicacion").value,
      proveedor_habitual: contProv.dataset.codigo || "",
      pu: Number(document.getElementById("ref-form-pu").value) || 0,
      iva: Number(document.getElementById("ref-form-iva").value) || 0,
      moneda: document.getElementById("ref-form-moneda").value,
      tipo_cambio: Number(document.getElementById("ref-form-tipo-cambio").value) || 0,
      notas: document.getElementById("ref-form-notas").value.trim(),
      usuario: usuarioActual.user,
      rol: usuarioActual.rol
    };

    status.textContent = "Guardando...";
    status.className = "send-status";

    try {
      const accion = modo === "crear" ? "crear_refaccion" : "editar_refaccion";
      const r = await api(accion, body, "POST");
      if (!r.ok) throw new Error(r.error);
      status.textContent = "✅ " + r.mensaje;
      status.className = "send-status ok";
      cache.refacciones = null; // invalidar caché
      setTimeout(() => { verRefacciones(); }, 800);
    } catch (e) {
      status.textContent = "❌ " + e.message;
      status.className = "send-status error";
    }
  }

  async function desactivarRefaccion(codigo) {
    if (!confirm("¿Desactivar la refacción " + codigo + "?\n\nNo se borra, solo se oculta.")) return;
    try {
      const r = await api("desactivar_refaccion", {
        codigo: codigo,
        usuario: usuarioActual.user,
        rol: usuarioActual.rol
      }, "POST");
      if (!r.ok) throw new Error(r.error);
      alert("✅ " + r.mensaje);
      cache.refacciones = null;
      verRefacciones();
    } catch (e) {
      alert("Error: " + e.message);
    }
  }

  function volverARefacciones() { verRefacciones(); }

  // ═══════════════════════════════════════════════════════════════
  // BUSCADOR TYPEAHEAD
  // ═══════════════════════════════════════════════════════════════

    function crearBuscador(opts) {
    const wrapper = document.createElement("div");
    wrapper.className = "buscador-wrapper";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "buscador-input";
    input.placeholder = opts.placeholder || "Buscar...";
    input.autocomplete = "off";
    input.spellcheck = false;
    if (opts.valorInicial) input.value = opts.valorInicial;

    const dropdown = document.createElement("div");
    dropdown.className = "buscador-resultados hidden";

    wrapper.appendChild(input);
    wrapper.appendChild(dropdown);

    let seleccionado = null;
    let dropdownAbierto = false;

    function abrirDropdown() {
      dropdown.classList.remove("hidden");
      dropdownAbierto = true;
    }

    function cerrarDropdown() {
      dropdown.classList.add("hidden");
      dropdown.innerHTML = "";
      dropdownAbierto = false;
    }

    async function renderResultados(query) {
      if (!query || query.length < 1) {
        cerrarDropdown();
        return;
      }

      let lista = [];
      try {
        const todos = await opts.obtenerDatos();
        if (Array.isArray(todos)) {
          lista = todos.filter(d => opts.filtrar(d, query)).slice(0, 20);
        }
      } catch (e) {
        console.error("[BUSCADOR] Error:", e);
      }

      // Si no hay resultados, CERRAR el dropdown (no mostrar "Sin resultados")
      if (lista.length === 0) {
        cerrarDropdown();
        return;
      }

      dropdown.innerHTML = "";

      lista.forEach(item => {
        const div = document.createElement("div");
        div.className = "buscador-item";
        div.innerHTML = opts.renderItem(item);

        const seleccionar = (ev) => {
          if (ev) {
            ev.preventDefault();
            ev.stopPropagation();
          }
          seleccionado = item;
          input.value = opts.renderSeleccion ? opts.renderSeleccion(item) : (item.codigo || "");
          cerrarDropdown();
          input.blur();   // ← clave: quitar el foco para que no se reabra
          if (opts.onSelect) opts.onSelect(item);
        };

        div.addEventListener("mousedown", seleccionar);
        div.addEventListener("touchstart", seleccionar, { passive: false });
        div.addEventListener("pointerdown", seleccionar);

        dropdown.appendChild(div);
      });

      abrirDropdown();
    }

    async function manejarInput() {
      const q = normalizar(input.value);
      if (q.length < 1) {
        seleccionado = null;
        cerrarDropdown();
        return;
      }
      await renderResultados(q);
    }

    input.addEventListener("input", manejarInput);
    input.addEventListener("keyup", (e) => {
      if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(e.key)) return;
      manejarInput();
    });

    // Al perder el foco, cerrar
    input.addEventListener("blur", () => {
      setTimeout(() => {
        if (!wrapper.contains(document.activeElement)) {
          cerrarDropdown();
        }
      }, 200);
    });

    // Escape cierra
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        cerrarDropdown();
        input.blur();
      }
    });

    // Click fuera cierra
    document.addEventListener("click", (e) => {
      if (!wrapper.contains(e.target)) {
        cerrarDropdown();
      }
    });

    wrapper.getValue = () => input.value;
    wrapper.getSeleccionado = () => seleccionado;
    wrapper.setValue = (v) => { input.value = v; };
    wrapper.limpiar = () => { input.value = ""; seleccionado = null; cerrarDropdown(); };
    wrapper.getInput = () => input;

    return wrapper;
  }
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
    await cargarProveedoresBuscador();
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

  async function cargarProveedoresBuscador() {
    if (!cache.proveedores) {
      const r = await api("listar_proveedores");
      cache.proveedores = r.proveedores || [];
    }
    const contenedor = document.getElementById("mov-proveedor-container");
    if (!contenedor) return;
    contenedor.innerHTML = "";

    const buscador = crearBuscador({
      placeholder: "Buscar proveedor por código o razón social...",
      obtenerDatos: async () => cache.proveedores,
      filtrar: (item, q) =>
        normalizar(item.codigo).includes(q) ||
        normalizar(item.razon_social).includes(q),
      renderItem: (item) =>
        "<div class='buscador-cod'>" + item.codigo + "</div>" +
        "<div class='buscador-desc'>" + item.razon_social + "</div>" +
        "<div class='buscador-meta'>" + item.moneda + " · " + (item.contacto || "Sin contacto") + "</div>",
      renderSeleccion: (item) => item.razon_social,
      onSelect: (item) => {
        contenedor.dataset.codigo = item.codigo;
        contenedor.dataset.razon = item.razon_social;
      }
    });
    contenedor.appendChild(buscador);
  }

  // ═══════════════════════════════════════════════════════════════
  // LÍNEA DE MOVIMIENTO
  // ═══════════════════════════════════════════════════════════════

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

    const card = document.createElement("div");
    card.className = "linea-card";

    // FILA 1
    const fila1 = document.createElement("div");
    fila1.className = "linea-fila-1";

    const grupoRef = document.createElement("div");
    grupoRef.className = "linea-grupo linea-grupo-ref";
    const labelRef = document.createElement("label");
    labelRef.textContent = "Refacción";
    const buscadorRef = crearBuscador({
      placeholder: "Código o descripción...",
      obtenerDatos: async () => cache.refacciones,
      filtrar: (item, q) =>
        normalizar(item.codigo).includes(q) ||
        normalizar(item.descripcion).includes(q),
      renderItem: (item) =>
        "<div class='buscador-cod'>" + item.codigo + "</div>" +
        "<div class='buscador-desc'>" + item.descripcion + "</div>" +
        "<div class='buscador-meta'>" + item.unidad + " · " + item.categoria + "</div>",
      renderSeleccion: (item) => item.codigo + " - " + item.descripcion,
      onSelect: (item) => {
        card.dataset.codigo = item.codigo;
        card.dataset.descripcion = item.descripcion;
        card.dataset.unidad = item.unidad;
        card.dataset.moneda = item.moneda;
        card.querySelector(".lin-pu").value = item.pu || 0;
        card.querySelector(".lin-iva").value = item.iva || 0;
        if (item.ubicacion_defecto) {
          const selUbic = card.querySelector(".lin-ubicacion");
          if (selUbic) selUbic.value = item.ubicacion_defecto;
        }
        cargarLotesDeRefaccion(card, item.codigo);
        recalcularSubtotal(card);
      }
    });
    grupoRef.appendChild(labelRef);
    grupoRef.appendChild(buscadorRef);

    const btnX = document.createElement("button");
    btnX.type = "button";
    btnX.className = "btn-quitar";
    btnX.textContent = "✕";
    btnX.title = "Quitar línea";
    btnX.addEventListener("click", () => {
      card.remove();
      recalcularTotalMovimiento();
    });

    fila1.appendChild(grupoRef);
    fila1.appendChild(btnX);

    // FILA 2
    const fila2 = document.createElement("div");
    fila2.className = "linea-fila-2";

    // Lote
    const grupoLote = document.createElement("div");
    grupoLote.className = "linea-grupo";
    const labelLote = document.createElement("label");
    labelLote.textContent = "Lote";
    const buscadorLote = crearBuscador({
      placeholder: "Lote",
      obtenerDatos: async () => card._lotesDisponibles || [],
      filtrar: (item, q) => normalizar(item.lote).includes(q),
      renderItem: (item) =>
        "<div class='buscador-cod'>" + item.lote + "</div>" +
        "<div class='buscador-desc'>Saldo: " + item.saldo + " " + item.unidad + "</div>" +
        "<div class='buscador-meta'>" + item.ubicacion + "</div>",
      renderSeleccion: (item) => item.lote,
      onSelect: (item) => {
        if (item.ubicacion) {
          const selUbic = card.querySelector(".lin-ubicacion");
          if (selUbic) selUbic.value = item.ubicacion;
        }
      }
    });
    buscadorLote.getInput().classList.add("lin-lote");
    grupoLote.appendChild(labelLote);
    grupoLote.appendChild(buscadorLote);

    // Cantidad
    const grupoCant = document.createElement("div");
    grupoCant.className = "linea-grupo linea-grupo-cant";
    const labelCant = document.createElement("label");
    labelCant.textContent = "Cantidad";
    const inputCant = document.createElement("input");
    inputCant.className = "lin-cantidad";
    inputCant.type = "number";
    inputCant.step = "0.01";
    inputCant.placeholder = "0";
    inputCant.addEventListener("input", () => recalcularSubtotal(card));
    grupoCant.appendChild(labelCant);
    grupoCant.appendChild(inputCant);

    // Ubicación
    const grupoUbic = document.createElement("div");
    grupoUbic.className = "linea-grupo";
    const labelUbic = document.createElement("label");
    labelUbic.textContent = "Ubicación";
    const selUbic = document.createElement("select");
    selUbic.className = "lin-ubicacion";
    selUbic.innerHTML = cache.ubicaciones.map(u =>
      "<option value='" + u.codigo + "'>" + u.codigo + "</option>"
    ).join("");
    grupoUbic.appendChild(labelUbic);
    grupoUbic.appendChild(selUbic);

    // PU
    const grupoPu = document.createElement("div");
    grupoPu.className = "linea-grupo linea-grupo-precio";
    const labelPu = document.createElement("label");
    labelPu.textContent = "PU";
    const inputPu = document.createElement("input");
    inputPu.className = "lin-pu";
    inputPu.type = "number";
    inputPu.step = "0.01";
    inputPu.placeholder = "0";
    inputPu.addEventListener("input", () => recalcularSubtotal(card));
    grupoPu.appendChild(labelPu);
    grupoPu.appendChild(inputPu);

    // IVA
    const grupoIva = document.createElement("div");
    grupoIva.className = "linea-grupo linea-grupo-precio";
    const labelIva = document.createElement("label");
    labelIva.textContent = "IVA";
    const inputIva = document.createElement("input");
    inputIva.className = "lin-iva";
    inputIva.type = "number";
    inputIva.step = "0.01";
    inputIva.placeholder = "0";
    inputIva.addEventListener("input", () => recalcularSubtotal(card));
    grupoIva.appendChild(labelIva);
    grupoIva.appendChild(inputIva);

    // Subtotal
    const grupoSub = document.createElement("div");
    grupoSub.className = "linea-grupo linea-grupo-subtotal";
    const labelSub = document.createElement("label");
    labelSub.textContent = "Subtotal";
    const spanSub = document.createElement("span");
    spanSub.className = "lin-subtotal";
    spanSub.textContent = "$0.00";
    grupoSub.appendChild(labelSub);
    grupoSub.appendChild(spanSub);

    fila2.appendChild(grupoLote);
    fila2.appendChild(grupoCant);
    fila2.appendChild(grupoUbic);
    fila2.appendChild(grupoPu);
    fila2.appendChild(grupoIva);
    fila2.appendChild(grupoSub);

    // FILA 3
    const fila3 = document.createElement("div");
    fila3.className = "linea-acciones";
    const btnDuplicar = document.createElement("button");
    btnDuplicar.type = "button";
    btnDuplicar.className = "btn-secundario";
    btnDuplicar.textContent = "Duplicar";
    btnDuplicar.addEventListener("click", () => duplicarLinea(card));
    fila3.appendChild(btnDuplicar);

    card.appendChild(fila1);
    card.appendChild(fila2);
    card.appendChild(fila3);

    cont.appendChild(card);
    recalcularTotalMovimiento();
  }

  function recalcularSubtotal(card) {
    const cant = Number(card.querySelector(".lin-cantidad").value) || 0;
    const pu = Number(card.querySelector(".lin-pu").value) || 0;
    const iva = Number(card.querySelector(".lin-iva").value) || 0;
    const subtotal = (pu + iva) * cant;
    card.querySelector(".lin-subtotal").textContent = fmtMoneda(subtotal);
    recalcularTotalMovimiento();
  }

  function recalcularTotalMovimiento() {
    let total = 0;
    document.querySelectorAll("#mov-lineas .linea-card").forEach(card => {
      const cant = Number(card.querySelector(".lin-cantidad").value) || 0;
      const pu = Number(card.querySelector(".lin-pu").value) || 0;
      const iva = Number(card.querySelector(".lin-iva").value) || 0;
      total += (pu + iva) * cant;
    });
    const cont = document.getElementById("mov-total");
    if (cont) cont.textContent = fmtMoneda(total);
  }

  function duplicarLinea(card) {
    const codigo = card.dataset.codigo;
    const descripcion = card.dataset.descripcion;
    const lote = card.querySelector(".lin-lote") ? card.querySelector(".lin-lote").value : "";
    const ubicacion = card.querySelector(".lin-ubicacion").value;
    const pu = card.querySelector(".lin-pu").value;
    const iva = card.querySelector(".lin-iva").value;

    agregarLinea().then(() => {
      const cont = document.getElementById("mov-lineas");
      const nueva = cont.lastElementChild;
      if (!nueva) return;
      const refBuscador = nueva.querySelector(".buscador-wrapper");
      if (refBuscador && refBuscador.setValue) {
        refBuscador.setValue(codigo + " - " + descripcion);
        nueva.dataset.codigo = codigo;
        nueva.dataset.descripcion = descripcion;
      }
      const loteBuscador = nueva.querySelectorAll(".buscador-wrapper")[1];
      if (loteBuscador && loteBuscador.setValue) loteBuscador.setValue(lote);
      nueva.querySelector(".lin-ubicacion").value = ubicacion;
      nueva.querySelector(".lin-pu").value = pu;
      nueva.querySelector(".lin-iva").value = iva;
    });
  }

  async function cargarLotesDeRefaccion(card, codigo) {
    const tipo = document.getElementById("mov-tipo").value;
    if (tipo === "ENTRADA") {
      card._lotesDisponibles = [];
      return;
    }
    try {
      const r = await api("lotes_disponibles", { codigo: codigo });
      card._lotesDisponibles = (r.lotes || []).map(l => ({
        lote: l.lote,
        saldo: l.saldo,
        unidad: l.unidad,
        ubicacion: l.ubicacion
      }));
    } catch (e) {
      card._lotesDisponibles = [];
    }
  }

  async function guardarMovimiento() {
    const tipo = document.getElementById("mov-tipo").value;
    const lineas = [];

    const cards = document.querySelectorAll("#mov-lineas .linea-card");
    for (const card of cards) {
      const codigo = card.dataset.codigo || "";
      const descripcion = card.dataset.descripcion || "";
      const unidad = card.dataset.unidad || "PZ";
      const loteInput = card.querySelector(".lin-lote");
      const lote = loteInput ? loteInput.value.trim() : "SIN_LOTE";
      const cantidad = Number(card.querySelector(".lin-cantidad").value) || 0;

      if (!codigo) {
        document.getElementById("mov-status").textContent = "❌ Selecciona una refacción válida en cada línea";
        document.getElementById("mov-status").className = "send-status error";
        return;
      }
      if (cantidad <= 0) {
        document.getElementById("mov-status").textContent = "❌ Cada línea debe tener cantidad > 0";
        document.getElementById("mov-status").className = "send-status error";
        return;
      }

      lineas.push({
        codigo: codigo,
        descripcion: descripcion,
        lote: lote || "SIN_LOTE",
        cantidad: cantidad,
        unidad: unidad,
        ubicacion: card.querySelector(".lin-ubicacion").value,
        pu: Number(card.querySelector(".lin-pu").value) || 0,
        iva: Number(card.querySelector(".lin-iva").value) || 0,
        moneda: card.dataset.moneda || "MXN"
      });
    }

    if (lineas.length === 0) {
      document.getElementById("mov-status").textContent = "❌ Agrega al menos una línea";
      document.getElementById("mov-status").className = "send-status error";
      return;
    }

    const provCont = document.getElementById("mov-proveedor-container");
    const proveedorTexto = provCont && provCont.dataset.razon
      ? provCont.dataset.razon
      : (provCont ? provCont.querySelector(".buscador-input").value : "");

    const body = {
      tipo_movimiento: tipo,
      referencia: document.getElementById("mov-referencia").value.trim(),
      proveedor_cliente: proveedorTexto,
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
            "<div class='mov-total'>" + fmtMoneda(m.total) + "</div>" +
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
  // REFACCIONES / ALERTAS / PROVEEDORES / UBICACIONES
  // ═══════════════════════════════════════════════════════════════

    async function verRefacciones() {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Cargando refacciones...";
    try {
      const r = await api("listar_refacciones");
      if (!r.ok) throw new Error(r.error);
      cache.refacciones = r.refacciones;

      // Listeners del buscador y botón nueva
      const inputBuscar = document.getElementById("ref-buscar");
      inputBuscar.value = "";
      inputBuscar.oninput = () => filtrarRefacciones();
      document.getElementById("btn-nueva-refaccion").onclick = () => abrirFormRefaccion(null);

      renderRefacciones(r.refacciones);
      mostrarVista("view-refacciones");
    } catch (e) {
      alert("Error: " + e.message);
      volverAlMenu();
    }
  }

  function filtrarRefacciones() {
    const q = normalizar(document.getElementById("ref-buscar").value);
    const filtrados = cache.refacciones.filter(x =>
      normalizar(x.codigo).includes(q) || normalizar(x.descripcion).includes(q)
    );
    renderRefacciones(filtrados);
  }

  function renderRefacciones(items) {
    const cont = document.getElementById("lista-refacciones");
    cont.innerHTML = "";
    if (!items.length) {
      cont.innerHTML = "<p style='text-align:center;padding:20px;color:#888;'>Sin refacciones.</p>";
      return;
    }
    items.forEach(x => {
      const d = document.createElement("div");
      d.className = "ref-item";
      d.innerHTML =
        "<div class='ref-cod'>" + x.codigo + "</div>" +
        "<div class='ref-info'>min " + x.minimo + " / max " + x.maximo + "</div>" +
        "<div class='ref-desc'>" + x.descripcion + "</div>" +
        "<div class='ref-info'>" + x.unidad + " · " + x.categoria + " · " + fmtMoneda(x.pu) + " " + x.moneda + "</div>";

      const acciones = document.createElement("div");
      acciones.style.cssText = "margin-top:8px; display:flex; gap:6px;";

      const btnEditar = document.createElement("button");
      btnEditar.className = "btn-secundario";
      btnEditar.textContent = "✏️ Editar";
      btnEditar.onclick = () => abrirFormRefaccion(x.codigo);
      acciones.appendChild(btnEditar);

      const btnDesactivar = document.createElement("button");
      btnDesactivar.className = "btn-secundario";
      btnDesactivar.textContent = "🚫 Desactivar";
      btnDesactivar.style.color = "#b91c1c";
      btnDesactivar.onclick = () => desactivarRefaccion(x.codigo);
      acciones.appendChild(btnDesactivar);

      d.appendChild(acciones);
      cont.appendChild(d);
    });
  }

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
      cache.proveedores = r.proveedores;

      const inputBuscar = document.getElementById("prov-buscar");
      inputBuscar.value = "";
      inputBuscar.oninput = () => filtrarProveedores();
      document.getElementById("btn-nuevo-proveedor").onclick = () => abrirFormProveedor(null);

      renderProveedores(r.proveedores);
      mostrarVista("view-proveedores");
    } catch (e) {
      alert("Error: " + e.message);
      volverAlMenu();
    }
  }

  function filtrarProveedores() {
    const q = normalizar(document.getElementById("prov-buscar").value);
    const filtrados = cache.proveedores.filter(x =>
      normalizar(x.codigo).includes(q) || normalizar(x.razon_social).includes(q)
    );
    renderProveedores(filtrados);
  }

  function renderProveedores(items) {
    const cont = document.getElementById("lista-proveedores");
    cont.innerHTML = "";
    if (!items.length) {
      cont.innerHTML = "<p style='text-align:center;padding:20px;color:#888;'>Sin proveedores.</p>";
      return;
    }
    items.forEach(x => {
      const d = document.createElement("div");
      d.className = "ref-item";
      d.innerHTML =
        "<div class='ref-cod'>" + x.codigo + "</div>" +
        "<div class='ref-info'>" + x.moneda + "</div>" +
        "<div class='ref-desc'>" + x.razon_social + "</div>" +
        "<div class='ref-info'>" + (x.contacto || "-") + " · " + (x.telefono || "-") + " · " + (x.email || "-") + "</div>";

      const acciones = document.createElement("div");
      acciones.style.cssText = "margin-top:8px; display:flex; gap:6px;";

      const btnEditar = document.createElement("button");
      btnEditar.className = "btn-secundario";
      btnEditar.textContent = "✏️ Editar";
      btnEditar.onclick = () => abrirFormProveedor(x.codigo);
      acciones.appendChild(btnEditar);

      const btnDesactivar = document.createElement("button");
      btnDesactivar.className = "btn-secundario";
      btnDesactivar.textContent = "🚫 Desactivar";
      btnDesactivar.style.color = "#b91c1c";
      btnDesactivar.onclick = () => desactivarProveedor(x.codigo);
      acciones.appendChild(btnDesactivar);

      d.appendChild(acciones);
      cont.appendChild(d);
    });
  }

  function abrirFormProveedor(codigo) {
    const modo = codigo ? "editar" : "crear";
    document.getElementById("prov-form-modo").value = modo;
    document.getElementById("prov-form-codigo-original").value = codigo || "";
    document.getElementById("prov-form-titulo").textContent =
      modo === "crear" ? "Nuevo proveedor" : "Editar proveedor";

    if (codigo) {
      const prov = cache.proveedores.find(p => p.codigo === codigo);
      if (prov) {
        document.getElementById("prov-form-codigo").value = prov.codigo;
        document.getElementById("prov-form-codigo").disabled = true;
        document.getElementById("prov-form-razon").value = prov.razon_social || "";
        document.getElementById("prov-form-rfc").value = prov.rfc || "";
        document.getElementById("prov-form-moneda").value = prov.moneda || "MXN";
        document.getElementById("prov-form-contacto").value = prov.contacto || "";
        document.getElementById("prov-form-telefono").value = prov.telefono || "";
        document.getElementById("prov-form-email").value = prov.email || "";
        document.getElementById("prov-form-tiempo").value = prov.tiempo_entrega_dias || 0;
        document.getElementById("prov-form-notas").value = prov.notas || "";
      }
    } else {
      document.getElementById("prov-form-codigo").value = "";
      document.getElementById("prov-form-codigo").disabled = false;
      document.getElementById("prov-form-razon").value = "";
      document.getElementById("prov-form-rfc").value = "";
      document.getElementById("prov-form-moneda").value = "MXN";
      document.getElementById("prov-form-contacto").value = "";
      document.getElementById("prov-form-telefono").value = "";
      document.getElementById("prov-form-email").value = "";
      document.getElementById("prov-form-tiempo").value = 0;
      document.getElementById("prov-form-notas").value = "";
    }

    document.getElementById("prov-form-status").textContent = "";
    mostrarVista("view-proveedor-form");
  }

  async function guardarProveedor() {
    const modo = document.getElementById("prov-form-modo").value;
    const codigo = document.getElementById("prov-form-codigo").value.trim();
    const razon = document.getElementById("prov-form-razon").value.trim();
    const status = document.getElementById("prov-form-status");

    if (!codigo) { status.textContent = "❌ Código obligatorio"; status.className = "send-status error"; return; }
    if (!razon) { status.textContent = "❌ Razón social obligatoria"; status.className = "send-status error"; return; }

    const body = {
      codigo: codigo,
      razon_social: razon,
      rfc: document.getElementById("prov-form-rfc").value.trim(),
      moneda: document.getElementById("prov-form-moneda").value,
      contacto: document.getElementById("prov-form-contacto").value.trim(),
      telefono: document.getElementById("prov-form-telefono").value.trim(),
      email: document.getElementById("prov-form-email").value.trim(),
      tiempo_entrega_dias: Number(document.getElementById("prov-form-tiempo").value) || 0,
      notas: document.getElementById("prov-form-notas").value.trim(),
      usuario: usuarioActual.user,
      rol: usuarioActual.rol
    };

    status.textContent = "Guardando...";
    status.className = "send-status";

    try {
      const accion = modo === "crear" ? "crear_proveedor" : "editar_proveedor";
      const r = await api(accion, body, "POST");
      if (!r.ok) throw new Error(r.error);
      status.textContent = "✅ " + r.mensaje;
      status.className = "send-status ok";
      cache.proveedores = null;
      setTimeout(verProveedores, 800);
    } catch (e) {
      status.textContent = "❌ " + e.message;
      status.className = "send-status error";
    }
  }

  async function desactivarProveedor(codigo) {
    if (!confirm("¿Desactivar el proveedor " + codigo + "?")) return;
    try {
      const r = await api("desactivar_proveedor", {
        codigo: codigo,
        usuario: usuarioActual.user,
        rol: usuarioActual.rol
      }, "POST");
      if (!r.ok) throw new Error(r.error);
      alert("✅ " + r.mensaje);
      cache.proveedores = null;
      verProveedores();
    } catch (e) {
      alert("Error: " + e.message);
    }
  }

  function volverAProveedores() { verProveedores(); }

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

      const inputBuscar = document.getElementById("ubic-buscar");
      inputBuscar.value = "";
      inputBuscar.oninput = () => filtrarUbicaciones();
      document.getElementById("btn-nueva-ubicacion").onclick = () => abrirFormUbicacion(null);

      // Solo admin ve el botón de nueva ubicación
      const btnNueva = document.getElementById("btn-nueva-ubicacion");
      if (usuarioActual.rol !== "admin") btnNueva.style.display = "none";

      renderUbicaciones(r.ubicaciones);
      mostrarVista("view-ubicaciones");
    } catch (e) {
      alert("Error: " + e.message);
      volverAlMenu();
    }
  }

  function filtrarUbicaciones() {
    const q = normalizar(document.getElementById("ubic-buscar").value);
    const filtrados = cache.ubicaciones.filter(x =>
      normalizar(x.codigo).includes(q) || normalizar(x.nombre).includes(q)
    );
    renderUbicaciones(filtrados);
  }

  function renderUbicaciones(items) {
    const cont = document.getElementById("lista-ubicaciones");
    cont.innerHTML = "";
    if (!items.length) {
      cont.innerHTML = "<p style='text-align:center;padding:20px;color:#888;'>Sin ubicaciones.</p>";
      return;
    }
    items.forEach(x => {
      const d = document.createElement("div");
      d.className = "ref-item";
      d.innerHTML =
        "<div class='ref-cod'>" + x.codigo + "</div>" +
        "<div class='ref-info'>" + x.tipo + "</div>" +
        "<div class='ref-desc'>" + x.nombre + "</div>" +
        "<div class='ref-info'>Responsable: " + (x.responsable || "-") + "</div>";

      if (usuarioActual.rol === "admin") {
        const acciones = document.createElement("div");
        acciones.style.cssText = "margin-top:8px; display:flex; gap:6px;";

        const btnEditar = document.createElement("button");
        btnEditar.className = "btn-secundario";
        btnEditar.textContent = "✏️ Editar";
        btnEditar.onclick = () => abrirFormUbicacion(x.codigo);
        acciones.appendChild(btnEditar);

        const btnDesactivar = document.createElement("button");
        btnDesactivar.className = "btn-secundario";
        btnDesactivar.textContent = "🚫 Desactivar";
        btnDesactivar.style.color = "#b91c1c";
        btnDesactivar.onclick = () => desactivarUbicacion(x.codigo);
        acciones.appendChild(btnDesactivar);

        d.appendChild(acciones);
      }
      cont.appendChild(d);
    });
  }

  function abrirFormUbicacion(codigo) {
    const modo = codigo ? "editar" : "crear";
    document.getElementById("ubic-form-modo").value = modo;
    document.getElementById("ubic-form-codigo-original").value = codigo || "";
    document.getElementById("ubic-form-titulo").textContent =
      modo === "crear" ? "Nueva ubicación" : "Editar ubicación";

    if (codigo) {
      const u = cache.ubicaciones.find(x => x.codigo === codigo);
      if (u) {
        document.getElementById("ubic-form-codigo").value = u.codigo;
        document.getElementById("ubic-form-codigo").disabled = true;
        document.getElementById("ubic-form-nombre").value = u.nombre || "";
        document.getElementById("ubic-form-tipo").value = u.tipo || "ALMACEN";
        document.getElementById("ubic-form-responsable").value = u.responsable || "";
      }
    } else {
      document.getElementById("ubic-form-codigo").value = "";
      document.getElementById("ubic-form-codigo").disabled = false;
      document.getElementById("ubic-form-nombre").value = "";
      document.getElementById("ubic-form-tipo").value = "ALMACEN";
      document.getElementById("ubic-form-responsable").value = "";
    }

    document.getElementById("ubic-form-status").textContent = "";
    mostrarVista("view-ubicacion-form");
  }

  async function guardarUbicacion() {
    const modo = document.getElementById("ubic-form-modo").value;
    const codigo = document.getElementById("ubic-form-codigo").value.trim();
    const nombre = document.getElementById("ubic-form-nombre").value.trim();
    const status = document.getElementById("ubic-form-status");

    if (!codigo) { status.textContent = "❌ Código obligatorio"; status.className = "send-status error"; return; }
    if (!nombre) { status.textContent = "❌ Nombre obligatorio"; status.className = "send-status error"; return; }

    const body = {
      codigo: codigo,
      nombre: nombre,
      tipo: document.getElementById("ubic-form-tipo").value,
      responsable: document.getElementById("ubic-form-responsable").value.trim(),
      usuario: usuarioActual.user,
      rol: usuarioActual.rol
    };

    status.textContent = "Guardando...";
    status.className = "send-status";

    try {
      const accion = modo === "crear" ? "crear_ubicacion" : "editar_ubicacion";
      const r = await api(accion, body, "POST");
      if (!r.ok) throw new Error(r.error);
      status.textContent = "✅ " + r.mensaje;
      status.className = "send-status ok";
      cache.ubicaciones = null;
      setTimeout(verUbicaciones, 800);
    } catch (e) {
      status.textContent = "❌ " + e.message;
      status.className = "send-status error";
    }
  }

  async function desactivarUbicacion(codigo) {
    if (!confirm("¿Desactivar la ubicación " + codigo + "?\n\nNo se puede desactivar si tiene stock.")) return;
    try {
      const r = await api("desactivar_ubicacion", {
        codigo: codigo,
        usuario: usuarioActual.user,
        rol: usuarioActual.rol
      }, "POST");
      if (!r.ok) throw new Error(r.error);
      alert("✅ " + r.mensaje);
      cache.ubicaciones = null;
      verUbicaciones();
    } catch (e) {
      alert("Error: " + e.message);
    }
  }

  function volverAUbicaciones() { verUbicaciones(); }

  // ═══════════════════════════════════════════════════════════════
  // EXPORT
  // ═══════════════════════════════════════════════════════════════

  return {
    initLogin,
    initApp,
    volverAlMenu,
    agregarLinea,
    volverARefacciones,
    abrirFormRefaccion,
    volverAProveedores,
    abrirFormProveedor,
    volverAUbicaciones,
    abrirFormUbicacion
  };

})();

window.App = App;
