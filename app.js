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
    movimientos: null,
    catalogos: null,
    equipos: null,
    usuarios: null
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

  // Escapa texto antes de meterlo en innerHTML
  function esc(t) {
    return String(t === null || t === undefined ? "" : t)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function sesionExpirada() {
    clearSession();
    alert("Tu sesión expiró. Vuelve a entrar.");
    window.location.href = "index.html";
  }

  // Todas las llamadas llevan el token de sesión; el servidor decide usuario y rol
  async function api(accion, data, metodo) {
    metodo = metodo || "GET";
    const url = CONFIG.APPS_SCRIPT_URL;
    const ses = getSession();
    const token = ses && ses.token ? ses.token : "";
    try {
      let r;
      if (metodo === "GET") {
        const qs = new URLSearchParams({ accion: accion, token: token, ...(data || {}) }).toString();
        r = await fetch(url + "?" + qs, { cache: "no-store", redirect: "follow" });
      } else {
        r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ accion: accion, data: data || {}, token: token }),
          redirect: "follow"
        });
      }
      const json = await r.json();
      if (json && json.error === "SESION_EXPIRADA" && accion !== "login") {
        sesionExpirada();
      }
      return json;
    } catch (e) {
      console.error("Error API:", e);
      return { ok: false, error: e.message };
    }
  }

  // Login: el servidor da el salt, el navegador calcula el hash y el servidor lo compara.
  // Los hashes ya no están en GitHub (usuarios.json se elimina del repo).
  async function verificarUsuario(usuario, password) {
    const user = String(usuario || "").toLowerCase().trim();
    if (!user || !password) return { error: "Escribe usuario y contraseña" };
    try {
      const s = await api("obtener_salt", { usuario: user });
      if (!s.ok || !s.salt) return { error: "No se pudo conectar con el servidor" };
      const hash = await pbkdf2Hash(password, s.salt);
      const r = await api("login", { usuario: user, hash: hash }, "POST");
      if (!r.ok) return { error: r.error || "Usuario o contraseña incorrectos" };
      return {
        user: r.usuario.user, nombre: r.usuario.nombre, rol: r.usuario.rol,
        token: r.token, expira: Date.now() + (r.expira_seg || 21600) * 1000
      };
    } catch (e) {
      console.error("Error verificarUsuario:", e);
      return { error: "No se pudo conectar con el servidor" };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // LOGIN
  // ═══════════════════════════════════════════════════════════════

  function sesionValida() {
    const s = getSession();
    if (!s || !s.token) return null;            // sesiones viejas (sin token) no sirven
    if (s.expira && Date.now() > s.expira) { clearSession(); return null; }
    return s;
  }

  function initLogin() {
    if (sesionValida()) { window.location.href = "app.html"; return; }
    clearSession();
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
      if (u && !u.error) { setSession(u); window.location.href = "app.html"; }
      else {
        err.textContent = (u && u.error) || "Usuario o contraseña incorrectos";
        btn.disabled = false;
        btn.textContent = "Entrar";
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // APP
  // ═══════════════════════════════════════════════════════════════

  function initApp() {
    usuarioActual = sesionValida();
    if (!usuarioActual) { clearSession(); window.location.href = "index.html"; return; }
    const ui = document.getElementById("user-info");
    if (ui) ui.textContent = usuarioActual.nombre + " (" + usuarioActual.rol + ")";

    mostrarBotonesPorRol();

    const addEvent = (id, evento, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(evento, handler);
    };

    addEvent("btn-logout", "click", async () => {
      if (!confirm("¿Cerrar sesión?")) return;
      try { await api("logout", {}, "POST"); } catch (e) { /* igual se cierra */ }
      clearSession();
      window.location.href = "index.html";
    });
    addEvent("btn-stock", "click", verStock);
    addEvent("btn-entrada", "click", () => abrirMovimiento("ENTRADA"));
    addEvent("btn-salida", "click", () => abrirMovimiento("SALIDA"));
    addEvent("btn-devolucion", "click", () => abrirMovimiento("DEVOLUCION"));
    addEvent("btn-transferencia", "click", () => abrirMovimiento("TRANSFERENCIA"));
    addEvent("btn-ajuste", "click", () => abrirMovimiento("AJUSTE"));
    addEvent("btn-critico", "click", verStockCritico);
    addEvent("btn-equipos", "click", verEquipos);
    addEvent("btn-usuarios", "click", verUsuarios);
    addEvent("btn-config", "click", verConfig);
    addEvent("btn-mi-pass", "click", () => abrirPassword(null));
    addEvent("btn-guardar-equipo", "click", guardarEquipo);
    addEvent("btn-guardar-usuario", "click", guardarUsuario);
    addEvent("btn-guardar-pass", "click", guardarPassword);
    addEvent("btn-guardar-config", "click", guardarConfigApp);
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
      ocultar("btn-entrada"); ocultar("btn-transferencia"); ocultar("btn-ajuste");
      ocultar("btn-refacciones"); ocultar("btn-equipos");
      ocultar("btn-usuarios"); ocultar("btn-config");
      ocultar("btn-proveedores"); ocultar("btn-ubicaciones"); ocultar("btn-reconstruir");
    } else if (rol === "supervisor" || rol === "gerencia") {
      ocultar("btn-reconstruir"); ocultar("btn-usuarios"); ocultar("btn-config");
    }
  }

    function mostrarVista(id) {
    [
      "view-menu", "view-stock", "view-movimiento", "view-movimientos",
      "view-refacciones", "view-refaccion-form", "view-kardex",
      "view-alertas", "view-critico",
      "view-proveedores", "view-proveedor-form",
      "view-ubicaciones", "view-ubicacion-form",
      "view-equipos", "view-equipo-form", "view-usuarios", "view-usuario-form",
      "view-password", "view-config",
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

  async function cargarCatalogos() {
    if (!cache.catalogos) {
      const r = await api("listar_catalogos");
      if (!r.ok) throw new Error(r.error || "No se pudieron cargar los catálogos");
      cache.catalogos = r;
    }
    return cache.catalogos;
  }

  function llenarSelect(sel, items, valor, texto, vacio) {
    sel.innerHTML = (vacio ? "<option value=''>" + esc(vacio) + "</option>" : "") +
      items.map(x => "<option value='" + esc(valor(x)) + "'>" + esc(texto(x)) + "</option>").join("");
  }

  function llenarSubfamilias(familia, seleccion) {
    const cat = cache.catalogos;
    const sel = document.getElementById("ref-form-subfamilia");
    const subs = cat.subfamilias.filter(s => normalizar(s.familia) === normalizar(familia));
    llenarSelect(sel, subs, s => s.subfamilia, s => s.subfamilia + " — " + s.nombre, "Selecciona...");
    if (seleccion) sel.value = seleccion;
    mostrarAyudaSubfamilia();
  }

  function mostrarAyudaSubfamilia() {
    const cat = cache.catalogos;
    const fam = document.getElementById("ref-form-familia").value;
    const sub = document.getElementById("ref-form-subfamilia").value;
    const info = cat.subfamilias.find(s => normalizar(s.familia) === normalizar(fam) && normalizar(s.subfamilia) === normalizar(sub));
    document.getElementById("ref-form-ejemplos").textContent = info && info.ejemplos ? "Ejemplos: " + info.ejemplos : "";
    return info;
  }

  async function abrirFormRefaccion(codigo) {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Cargando formulario...";
    try {
      await cargarCatalogos();
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
    } catch (e) {
      alert("Error: " + e.message);
      volverAlMenu();
      return;
    }
    const cat = cache.catalogos;
    const $ = id => document.getElementById(id);

    // Selects desde catálogos
    llenarSelect($("ref-form-familia"), cat.familias, f => f.codigo, f => f.codigo + " — " + f.nombre, "Selecciona...");
    llenarSelect($("ref-form-tipo"), cat.tipos, t => t.codigo, t => t.nombre);
    llenarSelect($("ref-form-unidad"), cat.unidades, u => u.codigo, u => u.codigo + " — " + u.nombre);
    llenarSelect($("ref-form-equipo"), cat.equipos, q => q.codigo, q => q.codigo + " — " + q.nombre, "— Uso general —");
    llenarSelect($("ref-form-ubicacion"), cache.ubicaciones, u => u.codigo, u => u.nombre);

    $("ref-form-familia").onchange = () => {
      llenarSubfamilias($("ref-form-familia").value);
      $("ref-form-grado").value = $("ref-form-familia").value === "SAN" ? "SI" : $("ref-form-grado").value;
    };
    $("ref-form-subfamilia").onchange = () => {
      const info = mostrarAyudaSubfamilia();
      if (info && info.tipo_sugerido) $("ref-form-tipo").value = info.tipo_sugerido;
    };

    const modo = codigo ? "editar" : "crear";
    $("ref-form-modo").value = modo;
    $("ref-form-codigo-original").value = codigo || "";
    $("ref-form-titulo").textContent = modo === "crear" ? "Nueva refacción" : "Editar refacción";

    // Buscador de proveedor habitual
    const contProv = $("ref-form-proveedor-container");
    contProv.innerHTML = "";
    delete contProv.dataset.codigo;
    const buscadorProv = crearBuscador({
      placeholder: "Buscar proveedor...",
      obtenerDatos: async () => cache.proveedores,
      filtrar: (item, q) =>
        normalizar(item.codigo).includes(q) ||
        normalizar(item.razon_social).includes(q),
      renderItem: (item) =>
        "<div class='buscador-cod'>" + esc(item.codigo) + "</div>" +
        "<div class='buscador-desc'>" + esc(item.razon_social) + "</div>",
      renderSeleccion: (item) => item.razon_social,
      onSelect: (item) => {
        contProv.dataset.codigo = item.codigo;
        if (item.moneda) $("ref-form-moneda").value = item.moneda;
      }
    });
    contProv.appendChild(buscadorProv);

    const ref = codigo ? cache.refacciones.find(r => r.codigo === codigo) : null;
    if (ref) {
      // En edición, familia/subfamilia/tipo quedan fijos: el código depende de ellos
      $("ref-form-codigo").value = ref.codigo;
      $("ref-form-familia").value = ref.categoria || "";
      llenarSubfamilias(ref.categoria, ref.subfamilia);
      $("ref-form-tipo").value = ref.tipo_articulo || "";
      $("ref-form-familia").disabled = true;
      $("ref-form-subfamilia").disabled = true;
      $("ref-form-tipo").disabled = true;
      $("ref-form-descripcion").value = ref.descripcion || "";
      $("ref-form-unidad").value = ref.unidad || "PZ";
      $("ref-form-marca").value = ref.marca || "";
      $("ref-form-modelo").value = ref.modelo || "";
      $("ref-form-num-parte").value = ref.num_parte_fabricante || "";
      $("ref-form-equipo").value = ref.equipo_aplica || "";
      $("ref-form-criticidad").value = ref.criticidad || "C";
      $("ref-form-grado").value = ref.grado_alimenticio || "NO";
      $("ref-form-minimo").value = ref.minimo || 0;
      $("ref-form-maximo").value = ref.maximo || 0;
      $("ref-form-maneja-lote").value = ref.maneja_lote || "NO";
      $("ref-form-ubicacion").value = ref.ubicacion_defecto || "";
      $("ref-form-pu").value = ref.pu || 0;
      const tasa = ref.pu > 0 ? Math.round(ref.iva / ref.pu * 100) : 16;
      $("ref-form-iva-tasa").value = [0, 8, 16].includes(tasa) ? String(tasa) : "16";
      $("ref-form-moneda").value = ref.moneda || "MXN";
      $("ref-form-tipo-cambio").value = ref.tipo_cambio || 0;
      $("ref-form-notas").value = ref.notas || "";
      if (ref.proveedor_habitual) {
        const prov = cache.proveedores.find(p => p.codigo === ref.proveedor_habitual);
        if (prov) { buscadorProv.setValue(prov.razon_social); contProv.dataset.codigo = prov.codigo; }
      }
    } else {
      $("ref-form-codigo").value = "";
      $("ref-form-familia").disabled = false;
      $("ref-form-subfamilia").disabled = false;
      $("ref-form-tipo").disabled = false;
      $("ref-form-familia").value = "";
      llenarSubfamilias("");
      $("ref-form-descripcion").value = "";
      $("ref-form-unidad").value = "PZ";
      $("ref-form-marca").value = "";
      $("ref-form-modelo").value = "";
      $("ref-form-num-parte").value = "";
      $("ref-form-equipo").value = "";
      $("ref-form-criticidad").value = "C";
      $("ref-form-grado").value = "NO";
      $("ref-form-minimo").value = 0;
      $("ref-form-maximo").value = 0;
      $("ref-form-maneja-lote").value = "NO";
      $("ref-form-ubicacion").value = "ALMACEN_MTTO";
      $("ref-form-pu").value = 0;
      $("ref-form-iva-tasa").value = "16";
      $("ref-form-moneda").value = "MXN";
      $("ref-form-tipo-cambio").value = 0;
      $("ref-form-notas").value = "";
    }

    $("ref-form-status").textContent = "";
    mostrarVista("view-refaccion-form");
  }

  async function guardarRefaccion() {
    const $ = id => document.getElementById(id);
    const modo = $("ref-form-modo").value;
    const status = $("ref-form-status");
    const error = (m) => { status.textContent = "❌ " + m; status.className = "send-status error"; };

    const familia = $("ref-form-familia").value;
    const subfamilia = $("ref-form-subfamilia").value;
    const descripcion = $("ref-form-descripcion").value.trim();
    const minimo = Number($("ref-form-minimo").value) || 0;
    const maximo = Number($("ref-form-maximo").value) || 0;

    if (modo === "crear" && (!familia || !subfamilia)) return error("Selecciona familia y subfamilia");
    if (descripcion.length < 8) return error("Descripción obligatoria (mínimo 8 caracteres)");
    if (maximo && maximo < minimo) return error("El máximo no puede ser menor al mínimo");

    const body = {
      descripcion: descripcion,
      unidad: $("ref-form-unidad").value,
      marca: $("ref-form-marca").value.trim(),
      modelo: $("ref-form-modelo").value.trim(),
      num_parte_fabricante: $("ref-form-num-parte").value.trim(),
      equipo_aplica: $("ref-form-equipo").value,
      criticidad: $("ref-form-criticidad").value,
      grado_alimenticio: $("ref-form-grado").value,
      minimo: minimo,
      maximo: maximo,
      maneja_lote: $("ref-form-maneja-lote").value,
      ubicacion_defecto: $("ref-form-ubicacion").value,
      proveedor_habitual: $("ref-form-proveedor-container").dataset.codigo || "",
      pu: Number($("ref-form-pu").value) || 0,
      iva_tasa: Number($("ref-form-iva-tasa").value),
      moneda: $("ref-form-moneda").value,
      tipo_cambio: Number($("ref-form-tipo-cambio").value) || 0,
      notas: $("ref-form-notas").value.trim()
    };
    if (modo === "crear") {
      body.familia = familia;
      body.subfamilia = subfamilia;
      body.tipo_articulo = $("ref-form-tipo").value;
    } else {
      body.codigo = $("ref-form-codigo-original").value;
    }

    status.textContent = "Guardando...";
    status.className = "send-status";
    try {
      const accion = modo === "crear" ? "crear_refaccion" : "editar_refaccion";
      const r = await api(accion, body, "POST");
      if (!r.ok) throw new Error(r.error);
      status.textContent = "✅ " + r.mensaje + (r.codigo ? " · Código " + r.codigo : "");
      status.className = "send-status ok";
      cache.refacciones = null;
      setTimeout(() => { verRefacciones(); }, modo === "crear" ? 1800 : 800);
    } catch (e) {
      error(e.message);
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

    const grupoSalida = document.getElementById("grupo-salida");
    const ayudaAjuste = document.getElementById("ayuda-ajuste");

    grupoProv.classList.add("hidden");
    grupoDest.classList.add("hidden");
    grupoOrig.classList.add("hidden");
    grupoSalida.classList.add("hidden");
    ayudaAjuste.classList.add("hidden");
    document.getElementById("mov-recibe").value = "";

    if (tipo === "SALIDA" || tipo === "DEVOLUCION") {
      try {
        await cargarCatalogos();
        llenarSelect(document.getElementById("mov-equipo"), cache.catalogos.equipos,
          q => q.codigo, q => q.codigo + " — " + q.nombre, "— Sin equipo / uso general —");
      } catch (e) { /* sigue sin equipos */ }
      document.getElementById("lbl-recibe").textContent =
        tipo === "SALIDA" ? "Recibe (nombre) *" : "Entrega (nombre)";
      grupoSalida.classList.remove("hidden");
    }
    if (tipo === "AJUSTE") ayudaAjuste.classList.remove("hidden");

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
      if (tipo === "AJUSTE" ? cantidad === 0 : cantidad <= 0) {
        document.getElementById("mov-status").textContent = tipo === "AJUSTE"
          ? "❌ En ajustes la cantidad no puede ser 0 (usa negativo para restar)"
          : "❌ Cada línea debe tener cantidad > 0";
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

    const status = document.getElementById("mov-status");
    const notas = document.getElementById("mov-notas").value.trim();
    const recibe = document.getElementById("mov-recibe").value.trim();
    if (tipo === "SALIDA" && !recibe) {
      status.textContent = "❌ Indica quién recibe el material";
      status.className = "send-status error";
      return;
    }
    if (tipo === "AJUSTE" && !notas) {
      status.textContent = "❌ El ajuste requiere el motivo en Notas";
      status.className = "send-status error";
      return;
    }

    // usuario y rol los pone el servidor a partir de la sesión
    const body = {
      tipo_movimiento: tipo,
      referencia: document.getElementById("mov-referencia").value.trim(),
      proveedor_cliente: tipo === "ENTRADA" ? proveedorTexto : "",
      ubicacion_origen: document.getElementById("mov-ubicacion-origen").value,
      ubicacion_destino: document.getElementById("mov-ubicacion-destino").value,
      equipo: (tipo === "SALIDA" || tipo === "DEVOLUCION") ? document.getElementById("mov-equipo").value : "",
      recibe: (tipo === "SALIDA" || tipo === "DEVOLUCION") ? recibe : "",
      notas: notas,
      moneda: "MXN",
      tipo_cambio: 0,
      lineas: lineas
    };

    status.textContent = "Guardando...";
    status.className = "send-status";

    const btnGuardar = document.getElementById("btn-guardar-mov");
    btnGuardar.disabled = true;   // evita movimientos duplicados por doble clic
    try {
      const r = await api("registrar_movimiento", body, "POST");
      if (!r.ok) throw new Error(r.error || "Error desconocido");
      status.textContent = "✅ " + r.mensaje + " (" + r.id_movimiento + ")";
      status.className = "send-status ok";
      cache.stock = null;
      setTimeout(() => { btnGuardar.disabled = false; volverAlMenu(); }, 1800);
    } catch (e) {
      status.textContent = "❌ " + e.message;
      status.className = "send-status error";
      btnGuardar.disabled = false;
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
          const extra = [m.referencia, m.equipo, m.recibe ? "Recibe: " + m.recibe : ""].filter(Boolean).join(" · ");
          d.innerHTML =
            "<div class='mov-id'>" + esc(m.id) + "</div>" +
            "<div class='mov-total'>" + fmtMoneda(m.total) + "</div>" +
            "<div class='mov-tipo'>" + esc(m.tipo) + " · " + esc(m.fecha) + " " + esc(m.hora) + "</div>" +
            "<div class='mov-user'>" + esc(m.nombre_usuario) + " · " + esc(m.estado) + "</div>" +
            (extra ? "<div class='ref-info'>" + esc(extra) + "</div>" : "");
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
      const clasif = [x.categoria + (x.subfamilia ? "-" + x.subfamilia : ""), x.tipo_articulo,
                      x.criticidad ? "Crit. " + x.criticidad : "",
                      x.grado_alimenticio === "SI" ? "Grado alimenticio" : ""].filter(Boolean).join(" · ");
      d.innerHTML =
        "<div class='ref-cod'>" + esc(x.codigo) + "</div>" +
        "<div class='ref-info'>min " + esc(x.minimo) + " / max " + esc(x.maximo) + "</div>" +
        "<div class='ref-desc'>" + esc(x.descripcion) + "</div>" +
        "<div class='ref-info'>" + esc(x.unidad) + " · " + esc(clasif) + " · " + fmtMoneda(x.pu) + " " + esc(x.moneda) + "</div>" +
        ((x.marca || x.num_parte_fabricante)
          ? "<div class='ref-info'>" + esc([x.marca, x.num_parte_fabricante].filter(Boolean).join(" · ")) + "</div>" : "");

      const acciones = document.createElement("div");
      acciones.style.cssText = "margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;";

      const btnKardex = document.createElement("button");
      btnKardex.className = "btn-secundario";
      btnKardex.textContent = "📜 Kardex";
      btnKardex.onclick = () => verKardex(x.codigo, x.descripcion);
      acciones.appendChild(btnKardex);

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

  async function verKardex(codigo, descripcion) {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Cargando kardex...";
    try {
      const r = await api("kardex", { codigo: codigo });
      if (!r.ok) throw new Error(r.error);
      document.getElementById("kardex-titulo").textContent = "Kardex " + codigo;
      document.getElementById("kardex-desc").textContent =
        (descripcion || "") + " · Existencia: " + r.saldo;
      const cont = document.getElementById("lista-kardex");
      cont.innerHTML = "";
      if (!r.movimientos.length) {
        cont.innerHTML = "<p style='text-align:center;padding:20px;color:#888;'>Sin movimientos.</p>";
      }
      r.movimientos.forEach(m => {
        const d = document.createElement("div");
        d.className = "mov-item";
        const signo = m.efecto > 0 ? "+" : "";
        const color = m.efecto > 0 ? "#15803d" : (m.efecto < 0 ? "#b91c1c" : "#6b7280");
        const extra = [m.referencia, m.equipo, m.recibe ? "Recibe: " + m.recibe : ""].filter(Boolean).join(" · ");
        d.innerHTML =
          "<div class='mov-id'>" + esc(m.tipo) + " · " + esc(m.fecha) + "</div>" +
          "<div class='mov-total' style='color:" + color + "'>" +
            (m.tipo === "TRANSFERENCIA" ? "⇄ " + esc(m.cantidad) : signo + esc(m.efecto)) +
            " → " + esc(m.saldo) + "</div>" +
          "<div class='mov-tipo'>" + esc(m.ubicacion) + " · lote " + esc(m.lote) + "</div>" +
          "<div class='mov-user'>" + esc(m.id) + " · " + esc(m.usuario) + "</div>" +
          (extra ? "<div class='ref-info'>" + esc(extra) + "</div>" : "");
        cont.appendChild(d);
      });
      mostrarVista("view-kardex");
    } catch (e) {
      alert("Error: " + e.message);
      verRefacciones();
    }
  }

  async function verStockCritico() {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Revisando mínimos...";
    try {
      const r = await api("stock_critico");
      if (!r.ok) throw new Error(r.error);
      const cont = document.getElementById("lista-critico");
      cont.innerHTML = "";
      if (!r.items.length) {
        cont.innerHTML = "<p style='text-align:center;padding:20px;color:#888;'>Todo arriba del mínimo. 👍</p>";
      }
      r.items.forEach(x => {
        const d = document.createElement("div");
        d.className = "alerta-item";
        d.innerHTML =
          "<div class='alerta-cod'>" + esc(x.codigo) + (x.criticidad === "A" ? " ⚠️" : "") + "</div>" +
          "<div class='alerta-saldo'>" + esc(x.saldo) + " / min " + esc(x.minimo) + " " + esc(x.unidad) + "</div>" +
          "<div class='alerta-desc'>" + esc(x.descripcion) + "</div>" +
          "<div class='ref-info'>Sugerido comprar: " + esc(x.sugerido_comprar) + " " + esc(x.unidad) + "</div>";
        cont.appendChild(d);
      });
      mostrarVista("view-critico");
    } catch (e) {
      alert("Error: " + e.message);
      volverAlMenu();
    }
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
  // UTILIDADES DE CONTRASEÑA
  // ═══════════════════════════════════════════════════════════════

  function nuevoSalt() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, "0")).join("");
  }

  // Valida y devuelve { salt, hash } o { error }
  async function prepararPassword(p1, p2) {
    if (!p1 || p1.length < 8) return { error: "La contraseña debe tener al menos 8 caracteres" };
    if (p1 !== p2) return { error: "Las contraseñas no coinciden" };
    const salt = nuevoSalt();
    return { salt: salt, hash: await pbkdf2Hash(p1, salt) };
  }

  function msg(el, texto, tipo) {
    el.textContent = texto;
    el.className = "send-status" + (tipo ? " " + tipo : "");
  }

  // ═══════════════════════════════════════════════════════════════
  // EQUIPOS
  // ═══════════════════════════════════════════════════════════════

  async function verEquipos() {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Cargando equipos...";
    try {
      const r = await api("listar_equipos");
      if (!r.ok) throw new Error(r.error);
      cache.equipos = r.equipos;
      const buscar = document.getElementById("equipo-buscar");
      buscar.value = "";
      buscar.oninput = () => {
        const q = normalizar(buscar.value);
        renderEquipos(cache.equipos.filter(x =>
          [x.codigo, x.nombre, x.area, x.linea].some(v => normalizar(v).includes(q))));
      };
      document.getElementById("btn-nuevo-equipo").onclick = () => abrirFormEquipo(null);
      renderEquipos(r.equipos);
      mostrarVista("view-equipos");
    } catch (e) {
      alert("Error: " + e.message);
      volverAlMenu();
    }
  }

  function renderEquipos(items) {
    const cont = document.getElementById("lista-equipos");
    cont.innerHTML = "";
    if (!items.length) {
      cont.innerHTML = "<p style='text-align:center;padding:20px;color:#888;'>Sin equipos. Da de alta tus máquinas para ligar las salidas.</p>";
      return;
    }
    items.forEach(x => {
      const d = document.createElement("div");
      d.className = "ref-item";
      if (!x.activo) d.style.opacity = "0.55";
      d.innerHTML =
        "<div class='ref-cod'>" + esc(x.codigo) + (x.activo ? "" : " · INACTIVO") + "</div>" +
        "<div class='ref-info'>Crit. " + esc(x.criticidad || "-") + "</div>" +
        "<div class='ref-desc'>" + esc(x.nombre) + "</div>" +
        "<div class='ref-info'>" + esc([x.area, x.linea, x.marca, x.modelo].filter(Boolean).join(" · ") || "-") + "</div>";
      const acc = document.createElement("div");
      acc.style.cssText = "margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;";
      const bEd = document.createElement("button");
      bEd.className = "btn-secundario";
      bEd.textContent = "✏️ Editar";
      bEd.onclick = () => abrirFormEquipo(x.codigo);
      acc.appendChild(bEd);
      const bAc = document.createElement("button");
      bAc.className = "btn-secundario";
      bAc.textContent = x.activo ? "🚫 Desactivar" : "✅ Activar";
      if (x.activo) bAc.style.color = "#b91c1c";
      bAc.onclick = () => activarEquipo(x.codigo, !x.activo);
      acc.appendChild(bAc);
      d.appendChild(acc);
      cont.appendChild(d);
    });
  }

  function abrirFormEquipo(codigo) {
    const $ = id => document.getElementById(id);
    const eq = codigo ? cache.equipos.find(x => x.codigo === codigo) : null;
    $("equipo-form-modo").value = eq ? "editar" : "crear";
    $("equipo-form-titulo").textContent = eq ? "Editar equipo" : "Nuevo equipo";
    $("equipo-form-codigo").value = eq ? eq.codigo : "";
    $("equipo-form-codigo").disabled = !!eq;
    $("equipo-form-nombre").value = eq ? eq.nombre : "";
    $("equipo-form-area").value = eq ? eq.area : "";
    $("equipo-form-linea").value = eq ? eq.linea : "";
    $("equipo-form-marca").value = eq ? eq.marca : "";
    $("equipo-form-modelo").value = eq ? eq.modelo : "";
    $("equipo-form-serie").value = eq ? eq.num_serie : "";
    $("equipo-form-criticidad").value = eq && eq.criticidad ? eq.criticidad : "B";
    msg($("equipo-form-status"), "");
    mostrarVista("view-equipo-form");
  }

  async function guardarEquipo() {
    const $ = id => document.getElementById(id);
    const st = $("equipo-form-status");
    const modo = $("equipo-form-modo").value;
    const body = {
      codigo: $("equipo-form-codigo").value.trim(),
      nombre: $("equipo-form-nombre").value.trim(),
      area: $("equipo-form-area").value.trim(),
      linea: $("equipo-form-linea").value.trim(),
      marca: $("equipo-form-marca").value.trim(),
      modelo: $("equipo-form-modelo").value.trim(),
      num_serie: $("equipo-form-serie").value.trim(),
      criticidad: $("equipo-form-criticidad").value
    };
    if (!body.codigo) return msg(st, "❌ Código obligatorio", "error");
    if (!body.nombre) return msg(st, "❌ Nombre obligatorio", "error");
    msg(st, "Guardando...");
    const r = await api(modo === "crear" ? "crear_equipo" : "editar_equipo", body, "POST");
    if (!r.ok) return msg(st, "❌ " + r.error, "error");
    msg(st, "✅ " + r.mensaje, "ok");
    cache.catalogos = null;   // para que las listas de salidas y refacciones lo incluyan
    setTimeout(verEquipos, 800);
  }

  async function activarEquipo(codigo, activar) {
    if (!activar && !confirm("¿Desactivar el equipo " + codigo + "?\n\nYa no aparecerá en las listas; su historial se conserva.")) return;
    const r = await api("activar_equipo", { codigo: codigo, activo: activar }, "POST");
    if (!r.ok) return alert("Error: " + r.error);
    cache.catalogos = null;
    verEquipos();
  }

  function volverAEquipos() { verEquipos(); }

  // ═══════════════════════════════════════════════════════════════
  // USUARIOS (admin)
  // ═══════════════════════════════════════════════════════════════

  const NOMBRE_ROL = { tecnico: "Técnico", supervisor: "Supervisor", gerencia: "Gerencia", admin: "Admin" };

  async function verUsuarios() {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Cargando usuarios...";
    try {
      const r = await api("listar_usuarios");
      if (!r.ok) throw new Error(r.error);
      cache.usuarios = r.usuarios;
      document.getElementById("btn-nuevo-usuario").onclick = () => abrirFormUsuario(null);
      renderUsuarios(r.usuarios);
      mostrarVista("view-usuarios");
    } catch (e) {
      alert("Error: " + e.message);
      volverAlMenu();
    }
  }

  function renderUsuarios(items) {
    const cont = document.getElementById("lista-usuarios");
    cont.innerHTML = "";
    items.forEach(x => {
      const yo = x.usuario === usuarioActual.user;
      const d = document.createElement("div");
      d.className = "ref-item";
      if (!x.activo) d.style.opacity = "0.55";
      d.innerHTML =
        "<div class='ref-cod'>" + esc(x.usuario) + (yo ? " (tú)" : "") + (x.activo ? "" : " · INACTIVO") + "</div>" +
        "<div class='ref-info'>" + esc(NOMBRE_ROL[x.rol] || x.rol) + "</div>" +
        "<div class='ref-desc'>" + esc(x.nombre) + "</div>" +
        "<div class='ref-info'>Último acceso: " + esc(x.ultimo_acceso || "nunca") + "</div>";
      const acc = document.createElement("div");
      acc.style.cssText = "margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;";
      const boton = (txt, fn, rojo) => {
        const b = document.createElement("button");
        b.className = "btn-secundario";
        b.textContent = txt;
        if (rojo) b.style.color = "#b91c1c";
        b.onclick = fn;
        acc.appendChild(b);
      };
      boton("✏️ Editar", () => abrirFormUsuario(x.usuario));
      boton("🔑 Restablecer contraseña", () => abrirPassword(x.usuario));
      if (!yo) {
        boton(x.activo ? "🚫 Desactivar" : "✅ Activar", () => activarUsuario(x.usuario, !x.activo), x.activo);
      }
      d.appendChild(acc);
      cont.appendChild(d);
    });
  }

  function abrirFormUsuario(usuario) {
    const $ = id => document.getElementById(id);
    const u = usuario ? cache.usuarios.find(x => x.usuario === usuario) : null;
    $("usuario-form-modo").value = u ? "editar" : "crear";
    $("usuario-form-titulo").textContent = u ? "Editar usuario" : "Nuevo usuario";
    $("usuario-form-usuario").value = u ? u.usuario : "";
    $("usuario-form-usuario").disabled = !!u;
    $("usuario-form-nombre").value = u ? u.nombre : "";
    $("usuario-form-rol").value = u ? u.rol : "tecnico";
    $("usuario-form-rol").disabled = !!u && u.usuario === usuarioActual.user;   // no cambiar tu propio rol
    $("usuario-form-grupo-pass").style.display = u ? "none" : "";
    $("usuario-form-pass1").value = "";
    $("usuario-form-pass2").value = "";
    msg($("usuario-form-status"), "");
    mostrarVista("view-usuario-form");
  }

  async function guardarUsuario() {
    const $ = id => document.getElementById(id);
    const st = $("usuario-form-status");
    const modo = $("usuario-form-modo").value;
    const usuario = $("usuario-form-usuario").value.trim().toLowerCase();
    const nombre = $("usuario-form-nombre").value.trim();
    const rol = $("usuario-form-rol").value;
    if (!nombre) return msg(st, "❌ Nombre obligatorio", "error");

    const btn = $("btn-guardar-usuario");
    btn.disabled = true;
    try {
      let r;
      if (modo === "crear") {
        if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) return msg(st, "❌ Usuario: mínimo 3 caracteres, sin espacios ni acentos", "error");
        msg(st, "Protegiendo contraseña...");
        const p = await prepararPassword($("usuario-form-pass1").value, $("usuario-form-pass2").value);
        if (p.error) return msg(st, "❌ " + p.error, "error");
        r = await api("crear_usuario", { nuevo_usuario: usuario, nombre: nombre, nuevo_rol: rol, salt: p.salt, hash: p.hash }, "POST");
      } else {
        msg(st, "Guardando...");
        r = await api("editar_usuario", { objetivo: usuario, nombre: nombre, nuevo_rol: rol }, "POST");
      }
      if (!r.ok) return msg(st, "❌ " + r.error, "error");
      msg(st, "✅ " + r.mensaje, "ok");
      $("usuario-form-pass1").value = "";
      $("usuario-form-pass2").value = "";
      setTimeout(verUsuarios, 1200);
    } finally {
      btn.disabled = false;
    }
  }

  async function activarUsuario(usuario, activar) {
    if (!activar && !confirm("¿Desactivar a " + usuario + "?\n\nNo podrá entrar y se cerrará su sesión. Su historial se conserva.")) return;
    const r = await api("activar_usuario", { objetivo: usuario, activo: activar }, "POST");
    if (!r.ok) return alert("Error: " + r.error);
    verUsuarios();
  }

  function volverAUsuarios() { verUsuarios(); }

  // ═══════════════════════════════════════════════════════════════
  // CONTRASEÑA: la propia, o restablecer la de otro (admin)
  // ═══════════════════════════════════════════════════════════════

  function abrirPassword(objetivo) {
    const $ = id => document.getElementById(id);
    const propia = !objetivo;
    $("pass-objetivo").value = objetivo || "";
    $("pass-titulo").textContent = propia ? "Cambiar mi contraseña" : "Restablecer contraseña de " + objetivo;
    $("pass-grupo-actual").style.display = propia ? "" : "none";
    ["pass-actual", "pass-nueva1", "pass-nueva2"].forEach(id => { $(id).value = ""; });
    msg($("pass-status"), "");
    $("btn-pass-cancelar").onclick = () => (propia ? volverAlMenu() : verUsuarios());
    mostrarVista("view-password");
  }

  async function guardarPassword() {
    const $ = id => document.getElementById(id);
    const st = $("pass-status");
    const objetivo = $("pass-objetivo").value;
    const btn = $("btn-guardar-pass");
    btn.disabled = true;
    try {
      msg(st, "Protegiendo contraseña...");
      const p = await prepararPassword($("pass-nueva1").value, $("pass-nueva2").value);
      if (p.error) return msg(st, "❌ " + p.error, "error");

      let r;
      if (!objetivo) {
        const actual = $("pass-actual").value;
        if (!actual) return msg(st, "❌ Escribe tu contraseña actual", "error");
        const s = await api("obtener_salt", { usuario: usuarioActual.user });
        if (!s.ok) return msg(st, "❌ No se pudo conectar", "error");
        const hashActual = await pbkdf2Hash(actual, s.salt);
        r = await api("cambiar_mi_password", { hash_actual: hashActual, salt: p.salt, hash: p.hash }, "POST");
      } else {
        r = await api("restablecer_password", { objetivo: objetivo, salt: p.salt, hash: p.hash }, "POST");
      }
      if (!r.ok) return msg(st, "❌ " + r.error, "error");
      ["pass-actual", "pass-nueva1", "pass-nueva2"].forEach(id => { $(id).value = ""; });

      // Si cambió la propia, sus sesiones se cerraron: volver a entrar
      if (!objetivo || objetivo === usuarioActual.user) {
        alert("✅ " + r.mensaje);
        clearSession();
        window.location.href = "index.html";
        return;
      }
      msg(st, "✅ " + r.mensaje, "ok");
      setTimeout(verUsuarios, 1500);
    } finally {
      btn.disabled = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CONFIGURACIÓN (admin)
  // ═══════════════════════════════════════════════════════════════

  async function verConfig() {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Cargando configuración...";
    try {
      const r = await api("leer_config_editable");
      if (!r.ok) throw new Error(r.error);
      const v = {};
      r.parametros.forEach(p => { v[p.parametro] = p.valor; });
      document.getElementById("cfg-tc").value = v.TIPO_CAMBIO_USD;
      document.getElementById("cfg-iva").value = v.IVA_PORCENTAJE;
      document.getElementById("cfg-correo").value = v.CORREO_NOTIFICACION;
      msg(document.getElementById("cfg-status"), "");
      mostrarVista("view-config");
    } catch (e) {
      alert("Error: " + e.message);
      volverAlMenu();
    }
  }

  async function guardarConfigApp() {
    const st = document.getElementById("cfg-status");
    const parametros = {
      TIPO_CAMBIO_USD: Number(document.getElementById("cfg-tc").value),
      IVA_PORCENTAJE: Number(document.getElementById("cfg-iva").value),
      CORREO_NOTIFICACION: document.getElementById("cfg-correo").value.trim()
    };
    if (!(parametros.TIPO_CAMBIO_USD > 0)) return msg(st, "❌ Tipo de cambio inválido", "error");
    msg(st, "Guardando...");
    const r = await api("guardar_config", { parametros: parametros }, "POST");
    if (!r.ok) return msg(st, "❌ " + r.error, "error");
    msg(st, "✅ " + r.mensaje, "ok");
  }

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
    abrirFormUbicacion,
    volverAEquipos,
    volverAUsuarios
  };

})();

window.App = App;
