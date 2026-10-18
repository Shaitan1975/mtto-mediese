// ═══════════════════════════════════════════════════════════════════
// SISTEMA DE MANTENIMIENTO MEDIESE - FRONTEND v1.6
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
  let movCtx = null;   // { ot, equipo } cuando la salida/devolución se abre desde una OT

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
    // Conteo e inventario
    addEvent("btn-conteo", "click", abrirConteo);
    addEvent("btn-scan-ubic", "click", escanearEnConteo);
    addEvent("btn-scan-pieza", "click", escanearEnConteo);
    addEvent("btn-pieza-nueva", "click", abrirPiezaNueva);
    addEvent("btn-mas", "click", () => ajustarCantidad(1));
    addEvent("btn-menos", "click", () => ajustarCantidad(-1));
    addEvent("btn-conteo-guardar", "click", guardarConteo);
    addEvent("btn-conteo-cancelar", "click", cerrarPanelConteo);
    addEvent("btn-pn-guardar", "click", guardarPiezaNueva);
    addEvent("btn-pn-cancelar", "click", () => mostrarVista("view-conteo"));
    addEvent("btn-alta-ok-seguir", "click", () => {
      mostrarVista("view-conteo");
      cargarResumenConteo();
      document.getElementById("conteo-buscar").focus();
    });
    addEvent("conteo-cantidad", "keydown", (e) => { if (e.key === "Enter") guardarConteo(); });
    addEvent("btn-revisar", "click", verRevisar);
    addEvent("btn-conteos", "click", verConteos);
    addEvent("btn-aplicar-conteos", "click", () => accionConteos("aplicar"));
    addEvent("btn-descartar-conteos", "click", () => accionConteos("descartar"));
    addEvent("btn-etiquetas", "click", verEtiquetas);
    // Órdenes de trabajo
    addEvent("btn-reportar", "click", () => abrirNuevaOT());
    addEvent("btn-ots", "click", () => verOTs(usuarioActual.rol === "tecnico" ? "mias" : "abiertas"));
    addEvent("btn-ots-nueva", "click", () => abrirNuevaOT());
    addEvent("btn-otn-scan", "click", escanearEquipoOT);
    addEvent("btn-otn-guardar", "click", guardarNuevaOT);
    addEvent("btn-otn-cancelar", "click", () => verOTs());
    addEvent("otn-parado-si", "click", () => elegirParado("SI"));
    addEvent("otn-parado-no", "click", () => elegirParado("NO"));
    addEvent("btn-ot-volver", "click", () => verOTs());
    addEvent("btn-imprimir-etiquetas", "click", imprimirEtiquetas);
    // Contador de altas por revisar en el menú (supervisores)
    if (["supervisor", "gerencia", "admin"].includes(usuarioActual.rol)) {
      refrescarRefacciones().then(actualizarBadgeRevisar).catch(() => {});
    }
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
    if (rol === "produccion") {
      document.querySelectorAll(".menu-grid button").forEach(b => {
        if (b.id !== "btn-reportar" && b.id !== "btn-ots") b.style.display = "none";
      });
      const rep = document.getElementById("btn-reportar");
      if (rep) rep.classList.add("destacado");
      const ots = document.getElementById("btn-ots");
      if (ots) ots.textContent = "📋 Mis reportes";
      return;
    }
    if (rol === "tecnico") {
      ocultar("btn-entrada"); ocultar("btn-transferencia"); ocultar("btn-ajuste");
      ocultar("btn-refacciones"); ocultar("btn-equipos");
      ocultar("btn-usuarios"); ocultar("btn-config");
      ocultar("btn-revisar"); ocultar("btn-conteos"); ocultar("btn-etiquetas");
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
      "view-conteo", "view-pieza-nueva", "view-alta-ok", "view-revisar", "view-conteos", "view-etiquetas",
      "view-ots", "view-ot-nueva", "view-ot-detalle", "view-equipo-hist",
      "view-loading"
    ].forEach(v => {
      const el = document.getElementById(v);
      if (el) el.classList.add("hidden");
    });
    const el = document.getElementById(id);
    if (el) el.classList.remove("hidden");
  }

  function volverAlMenu() {
    mostrarVista("view-menu");
    actualizarBadgeRevisar();
  }

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
      const buscar = document.getElementById("stock-buscar");
      buscar.value = "";
      buscar.oninput = filtrarStock;
      document.getElementById("btn-scan-stock").onclick = async () => {
        const txt = await escanearQR();
        if (!txt) return;
        buscar.value = interpretarQR(txt).valor;
        filtrarStock();
      };
      renderStock(r.items);
      mostrarVista("view-stock");
    } catch (e) {
      alert("Error: " + e.message);
      volverAlMenu();
    }
  }

  function filtrarStock() {
    const ws = palabras(document.getElementById("stock-buscar").value);
    renderStock((cache.stock || []).filter(x => {
      const t = sinAcentos(x.codigo + " " + x.descripcion + " " + x.ubicacion);
      return ws.every(w => t.includes(w));
    }));
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

  async function abrirMovimiento(tipo, ctx) {
    movCtx = ctx || null;
    document.getElementById("mov-titulo").textContent = tipo + (movCtx ? " · " + movCtx.ot : "");
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
    const ref = document.getElementById("mov-referencia");
    ref.readOnly = !!movCtx;
    if (movCtx) {
      ref.value = movCtx.ot;
      const selEq = document.getElementById("mov-equipo");
      if (selEq && movCtx.equipo) selEq.value = movCtx.equipo;
      document.getElementById("mov-recibe").value = usuarioActual.nombre || usuarioActual.user;
    }
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
      filtrar: (item, q) => {
        const t = sinAcentos(item.codigo + " " + item.descripcion + " " + (item.marca || ""));
        return palabras(q).every(w => t.includes(w));
      },
      renderItem: (item) =>
        "<div class='buscador-cod'>" + esc(item.codigo) + "</div>" +
        "<div class='buscador-desc'>" + esc(item.descripcion) + "</div>" +
        "<div class='buscador-meta'>" + esc(item.unidad) + " · " + esc(item.categoria) + "</div>",
      renderSeleccion: (item) => item.codigo + " - " + item.descripcion,
      onSelect: (item) => alSeleccionarRef(item)
    });
    function alSeleccionarRef(item) {
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
    const filaRef = document.createElement("div");
    filaRef.className = "fila-scan";
    const btnScanRef = document.createElement("button");
    btnScanRef.type = "button";
    btnScanRef.className = "btn-scan";
    btnScanRef.textContent = "📷";
    btnScanRef.title = "Escanear etiqueta";
    btnScanRef.onclick = async () => {
      const txt = await escanearQR();
      if (!txt) return;
      const q = interpretarQR(txt);
      if (q.tipo !== "pieza") return alert("Esa es una etiqueta de ubicación. Escanea la de la pieza.");
      const item = piezaPorCodigo(q.valor);
      if (!item) return alert("Código no encontrado: " + q.valor);
      buscadorRef.setValue(item.codigo + " - " + item.descripcion);
      alSeleccionarRef(item);
    };
    filaRef.appendChild(buscadorRef);
    filaRef.appendChild(btnScanRef);
    grupoRef.appendChild(labelRef);
    grupoRef.appendChild(filaRef);

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
      ot: movCtx ? movCtx.ot : "",
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
      const otVolver = movCtx ? movCtx.ot : null;
      movCtx = null;
      setTimeout(() => { btnGuardar.disabled = false; if (otVolver) verDetalleOT(otVolver); else volverAlMenu(); }, 1500);
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
      const bHi = document.createElement("button");
      bHi.className = "btn-secundario";
      bHi.textContent = "📈 Historial";
      bHi.onclick = () => verHistorialEquipo(x.codigo, x.nombre);
      acc.appendChild(bHi);
      const bOt = document.createElement("button");
      bOt.className = "btn-secundario";
      bOt.textContent = "🚨 Reportar falla";
      bOt.onclick = () => abrirNuevaOT(x.codigo);
      if (x.activo) acc.appendChild(bOt);
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
  // TEXTO: normalizar como el servidor, palabras, sugerencias
  // ═══════════════════════════════════════════════════════════════

  function sinAcentos(t) {
    return String(t || "").toUpperCase().replace(/Ñ/g, "\u0001")
      .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\u0001/g, "Ñ");
  }
  function palabras(t) {
    return sinAcentos(t).split(/[^A-Z0-9Ñ.\/-]+/).filter(w => w.length >= 2);
  }

  // Sustantivo → clasificación(es). La primera es la más probable.
  const PALABRAS_CLASIF = {
    BALERO: "MEC-ROD", RODAMIENTO: "MEC-ROD", CHUMACERA: "MEC-ROD", COJINETE: "MEC-ROD",
    BANDA: ["MEC-TRA", "SAN-BAN"], CADENA: "MEC-TRA", CATARINA: "MEC-TRA", SPROCKET: "MEC-TRA",
    POLEA: "MEC-TRA", ENGRANE: "MEC-TRA", PIÑON: "MEC-TRA", PINON: "MEC-TRA",
    COPLE: ["MEC-COP", "TUB-CON"], ACOPLAMIENTO: "MEC-COP", ARAÑA: "MEC-COP", ARANA: "MEC-COP",
    RETEN: "MEC-SEL", SELLO: "MEC-SEL", ORING: "MEC-SEL", "O-RING": "MEC-SEL", EMPAQUE: ["MEC-SEL", "SAN-CLA"], JUNTA: "MEC-SEL",
    REDUCTOR: "MEC-RED", MOTORREDUCTOR: "MEC-RED", FLECHA: "MEC-RED", EJE: "MEC-RED",
    BUJE: "MEC-BUJ", PERNO: "MEC-BUJ", RESORTE: "MEC-BUJ", PASADOR: "MEC-BUJ", CUÑA: "MEC-BUJ", CUNA: "MEC-BUJ",
    MOTOR: "ELE-MOT",
    CONTACTOR: "ELE-CTR", RELEVADOR: "ELE-CTR", RELE: "ELE-CTR", GUARDAMOTOR: "ELE-CTR", BOTON: "ELE-CTR",
    BOTONERA: "ELE-CTR", SELECTOR: "ELE-CTR", TEMPORIZADOR: "ELE-CTR", PILOTO: ["ELE-CTR", "GAS-QUE"],
    INTERRUPTOR: "ELE-PRO", FUSIBLE: "ELE-PRO", PASTILLA: "ELE-PRO", TERMOMAGNETICO: "ELE-PRO", BREAKER: "ELE-PRO",
    VARIADOR: "ELE-VAR", ARRANCADOR: "ELE-VAR",
    CABLE: "ELE-CAB", CONDUIT: "ELE-CAB", CHAROLA: "ELE-CAB", CANALETA: "ELE-CAB",
    ZAPATA: "ELE-CON", TERMINAL: "ELE-CON", CLEMA: "ELE-CON", CONECTOR: ["ELE-CON", "NEU-MAN"], CONTACTO: "ELE-CON", CLAVIJA: "ELE-CON",
    LAMPARA: "ELE-ILU", LUMINARIA: "ELE-ILU", FOCO: "ELE-ILU", REFLECTOR: "ELE-ILU", TUBO: ["TUB-TUB", "ELE-ILU"],
    TERMOPAR: ["INS-TEM", "GAS-QUE"], RTD: "INS-TEM", PT100: "INS-TEM", TERMOMETRO: "INS-TEM", TERMOSTATO: "INS-TEM", CONTROLADOR: "INS-TEM",
    MANOMETRO: "INS-PRE", TRANSMISOR: "INS-PRE", PRESOSTATO: "INS-PRE",
    SENSOR: "INS-DET", FOTOCELDA: "INS-DET", FOTOELECTRICO: "INS-DET", INDUCTIVO: "INS-DET", LIMIT: "INS-DET", FINAL: "INS-DET",
    PLC: "INS-AUT", HMI: "INS-AUT", MODULO: "INS-AUT", PANTALLA: "INS-AUT",
    CELDA: "INS-BAS", BASCULA: "INS-BAS", INDICADOR: "INS-BAS",
    ELECTROVALVULA: "NEU-VAL", SOLENOIDE: ["NEU-VAL", "GAS-REG"],
    CILINDRO: "NEU-CIL", PISTON: "NEU-CIL", ACTUADOR: "NEU-CIL",
    FRL: "NEU-FRL", LUBRICADOR: "NEU-FRL", REGULADOR: ["NEU-FRL", "GAS-REG"],
    MANGUERA: ["NEU-MAN", "HID-MAN"], RAPIDO: "NEU-MAN",
    BOMBA: ["HID-BOM", "SAN-BOM"], IMPULSOR: "SAN-BOM",
    CLAMP: "SAN-CLA", "TRI-CLAMP": "SAN-CLA", TRICLAMP: "SAN-CLA", ABRAZADERA: "SAN-CLA",
    PTR: "TUB-TUB", ANGULO: "TUB-TUB", SOLERA: "TUB-TUB", LAMINA: "TUB-TUB", PERFIL: "TUB-TUB", VARILLA: "TUB-TUB",
    CODO: "TUB-CON", TEE: "TUB-CON", NIPLE: "TUB-CON", TUERCA: ["FER-TOR", "TUB-CON"], REDUCCION: "TUB-CON", BRIDA: "TUB-CON",
    VALVULA: ["TUB-VAL", "NEU-VAL", "SAN-VAL", "HID-VAL"], LLAVE: ["HER-MAN", "TUB-VAL"],
    ACEITE: "LUB-ACE", GRASA: "LUB-GRA", AFLOJATODO: "LUB-ESP", WD40: "LUB-ESP", "WD-40": "LUB-ESP", LUBRICANTE: ["LUB-ESP", "LUB-ACE"],
    FILTRO: ["FIL-ACE", "FIL-AIR", "FIL-AGU"], CARTUCHO: ["FIL-AGU", "EPP-RES"], ELEMENTO: "FIL-AIR",
    REFRIGERANTE: "FRI-GAS", GAS: ["FRI-GAS", "SOL-GAS"], COMPRESOR: "FRI-COM", EVAPORADOR: "FRI-COM", CONDENSADOR: "FRI-COM",
    QUEMADOR: "GAS-QUE", ESPREA: "GAS-QUE",
    ELECTRODO: "SOL-ELE", SOLDADURA: "SOL-ELE", MICROALAMBRE: "SOL-ELE", ALAMBRE: "SOL-ELE",
    DISCO: "SOL-DIS", ARGON: "SOL-GAS", OXIGENO: "SOL-GAS", ACETILENO: "SOL-GAS",
    DESENGRASANTE: "QUI-LIM", LIMPIADOR: "QUI-LIM", SOLVENTE: "QUI-LIM", THINNER: "QUI-LIM",
    SILICON: "QUI-ADH", SILICONA: "QUI-ADH", PEGAMENTO: "QUI-ADH", ADHESIVO: "QUI-ADH", SELLADOR: "QUI-ADH", FIJADOR: "QUI-ADH", EPOXICO: "QUI-ADH",
    PINTURA: "QUI-PIN", ESMALTE: "QUI-PIN", PRIMER: "QUI-PIN", ANTICORROSIVO: "QUI-PIN",
    TORNILLO: "FER-TOR", RONDANA: "FER-TOR", ARANDELA: "FER-TOR", BIRLO: "FER-TOR", PIJA: "FER-TOR", ESPARRAGO: "FER-TOR", REMACHE: "FER-TOR",
    ANCLA: "FER-ANC", TAQUETE: "FER-ANC",
    CINTA: "FER-CIN", CINCHO: "FER-CIN", TEFLON: "FER-CIN",
    LIJA: "FER-ABR", FIBRA: "FER-ABR",
    CASCO: "EPP-CAB", CARETA: "EPP-CAB", LENTE: "EPP-OJO", LENTES: "EPP-OJO", GOGGLE: "EPP-OJO", GOGGLES: "EPP-OJO",
    TAPON: "EPP-AUD", OREJERA: "EPP-AUD", CUBREBOCA: "EPP-RES", CUBREBOCAS: "EPP-RES", RESPIRADOR: "EPP-RES", MASCARILLA: "EPP-RES",
    GUANTE: "EPP-MAN", BOTA: "EPP-PIE", ZAPATO: "EPP-PIE", CALZADO: "EPP-PIE", ARNES: "EPP-ALT", ESLINGA: "EPP-ALT",
    COFIA: "EPP-ROP", BATA: "EPP-ROP", MANDIL: "EPP-ROP", CUBREBARBA: "EPP-ROP", OVEROL: "EPP-ROP",
    DESARMADOR: "HER-MAN", PINZA: "HER-MAN", PINZAS: "HER-MAN", MARTILLO: "HER-MAN", DADO: "HER-MAN", MATRACA: "HER-MAN", SEGUETA: "HER-MAN",
    TALADRO: "HER-ELE", ESMERILADORA: "HER-ELE", ROTOMARTILLO: "HER-ELE", PULIDORA: "HER-ELE",
    MULTIMETRO: "HER-MED", VERNIER: "HER-MED", CALIBRADOR: "HER-MED", FLEXOMETRO: "HER-MED", AMPERIMETRO: "HER-MED", MICROMETRO: "HER-MED"
  };

  function buscarPalabra(w) {
    const d = PALABRAS_CLASIF;
    return d[w] || (w.endsWith("ES") && d[w.slice(0, -2)]) || (w.endsWith("S") && d[w.slice(0, -1)]) || null;
  }

  // Hasta 3 clasificaciones sugeridas ("MEC-ROD") para una descripción
  function sugerirClasificacion(desc) {
    const cat = cache.catalogos;
    const ws = palabras(desc);
    if (!cat || !ws.length) return [];
    const validas = {};
    cat.subfamilias.forEach(s => { validas[normalizar(s.familia) + "-" + normalizar(s.subfamilia)] = s; });
    const pts = {};
    const sumar = (k, p) => { if (validas[k]) pts[k] = (pts[k] || 0) + p; };
    ws.forEach((w, i) => {
      const hit = buscarPalabra(w);
      if (hit) [].concat(hit).forEach((k, j) => sumar(k, (i === 0 ? 10 : 4) - j));
    });
    // Palabras que aparecen en el nombre o ejemplos de la subfamilia (ej. "filtro de AIRE")
    Object.keys(validas).forEach(k => {
      const s = validas[k];
      const texto = " " + palabras(s.nombre + " " + (s.ejemplos || "")).join(" ") + " ";
      ws.forEach(w => { if (w.length >= 3 && texto.includes(" " + w + " ")) sumar(k, 2); });
    });
    return Object.keys(pts).sort((a, b) => pts[b] - pts[a]).slice(0, 3);
  }

  // Piezas existentes parecidas a lo que se escribe (para no duplicar).
  // Compara palabras sueltas ("6205-2RS" = "6205" + "2RS") y, sobre todo, números de modelo.
  const PALABRAS_VACIAS = new Set(["DE", "LA", "EL", "LOS", "LAS", "CON", "PARA", "Y", "EN", "DEL", "AL", "POR"]);
  function fichas(t) {
    return palabras(t).flatMap(w => w.split(/[-\/]/))
      .filter(w => w.length >= 2 && !PALABRAS_VACIAS.has(w))
      .map(w => (w.length > 3 && /[A-Z]S$/.test(w)) ? w.slice(0, -1) : w);   // plural → singular: BALEROS = BALERO
  }
  function numerosModelo(t) {
    return new Set((sinAcentos(t).match(/\d{3,}/g) || []));
  }
  function piezasSimilares(desc) {
    const ws = fichas(desc);
    if (ws.length < 2) return [];
    const set = new Set(ws);
    const nums = numerosModelo(desc);
    return (cache.refacciones || []).map(r => {
      const rw = fichas(r.descripcion + " " + (r.num_parte_fabricante || ""));
      const comunes = rw.filter(w => set.has(w)).length;
      let score = comunes / Math.max(set.size, rw.length);
      const mismoSustantivo = rw[0] && rw[0] === ws[0];
      if (mismoSustantivo) score += 0.15;
      // Mismo sustantivo y mismo número de modelo (6205, 3800, 1750...) = muy probablemente la misma pieza
      if (mismoSustantivo && Array.from(numerosModelo(r.descripcion + " " + (r.num_parte_fabricante || ""))).some(n => nums.has(n))) score += 0.35;
      return { r: r, score: score };
    }).filter(x => x.score >= 0.5).sort((a, b) => b.score - a.score).slice(0, 4).map(x => x.r);
  }

  // Búsqueda tolerante: todas las palabras escritas deben aparecer (código o descripción)
  function buscarPiezas(q, lista, max) {
    const ws = palabras(q);
    if (!ws.length) return [];
    return (lista || []).filter(r => {
      const t = sinAcentos(r.codigo + " " + r.descripcion + " " + (r.marca || "") + " " + (r.num_parte_fabricante || ""));
      return ws.every(w => t.includes(w));
    }).slice(0, max || 10);
  }

  function difHtml(d) {
    const n = Number(d) || 0;
    if (n > 0) return "<span class='dif-pos'>+" + esc(n) + "</span>";
    if (n < 0) return "<span class='dif-neg'>" + esc(n) + "</span>";
    return "<span class='dif-cero'>sin diferencia</span>";
  }

  function vibrar(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 60); } catch (e) {} }

  function guardarLocal(k, v) { try { localStorage.setItem("mtto_" + k, v); } catch (e) {} }
  function leerLocal(k) { try { return localStorage.getItem("mtto_" + k); } catch (e) { return null; } }

  async function refrescarRefacciones() {
    const r = await api("listar_refacciones");
    if (r.ok) cache.refacciones = r.refacciones;
    return cache.refacciones || [];
  }

  // ═══════════════════════════════════════════════════════════════
  // ESCÁNER QR (Android con BarcodeDetector; iPhone y otros con jsQR)
  // ═══════════════════════════════════════════════════════════════

  function cargarScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector("script[data-lib='" + src + "']")) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.dataset.lib = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("No se pudo cargar " + src));
      document.head.appendChild(s);
    });
  }

  async function escanearQR() {
    const modal = document.getElementById("scanner");
    const video = document.getElementById("scanner-video");
    const aviso = document.getElementById("scanner-msg");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Este navegador no permite usar la cámara. Escribe el código.");
      return null;
    }
    let detector = null;
    if ("BarcodeDetector" in window) {
      try {
        const formatos = await window.BarcodeDetector.getSupportedFormats();
        if (formatos.includes("qr_code")) detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      } catch (e) { detector = null; }
    }
    if (!detector) {
      try { await cargarScript("jsQR.min.js"); }
      catch (e) { alert("No se pudo cargar el lector de QR. Revisa tu conexión."); return null; }
    }

    return new Promise(async resolve => {
      let terminado = false, stream = null;
      const cerrar = (valor) => {
        if (terminado) return;
        terminado = true;
        if (stream) stream.getTracks().forEach(t => t.stop());
        video.srcObject = null;
        modal.classList.add("hidden");
        resolve(valor);
      };
      document.getElementById("scanner-cerrar").onclick = () => cerrar(null);
      aviso.textContent = "Apunta al código QR";
      modal.classList.remove("hidden");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      } catch (e) {
        alert("No se pudo abrir la cámara. Permite el acceso a la cámara para este sitio en el navegador.");
        return cerrar(null);
      }
      video.setAttribute("playsinline", "");
      video.muted = true;
      video.srcObject = stream;
      try { await video.play(); } catch (e) { /* algunos iPhone requieren el toque inicial */ }

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const leer = window.jsQR ? (window.jsQR.default || window.jsQR) : null;
      const ciclo = async () => {
        if (terminado) return;
        if (video.readyState >= 2 && video.videoWidth) {
          try {
            if (detector) {
              const r = await detector.detect(video);
              if (r && r.length) { vibrar(80); return cerrar(r[0].rawValue); }
            } else if (leer) {
              const escala = Math.min(1, 640 / video.videoWidth);
              canvas.width = Math.round(video.videoWidth * escala);
              canvas.height = Math.round(video.videoHeight * escala);
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const r = leer(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
              if (r && r.data) { vibrar(80); return cerrar(r.data); }
            }
          } catch (e) { /* sigue intentando */ }
        }
        setTimeout(ciclo, 160);
      };
      ciclo();
    });
  }

  // "UBI:ALMACEN_MTTO" → ubicación; cualquier otro texto → código de pieza
  function interpretarQR(txt) {
    const t = String(txt || "").trim().toUpperCase();
    if (t.indexOf("UBI:") === 0) return { tipo: "ubicacion", valor: t.slice(4) };
    if (t.indexOf("EQ:") === 0) return { tipo: "equipo", valor: t.slice(3) };
    return { tipo: "pieza", valor: t };
  }

  function piezaPorCodigo(codigo) {
    return (cache.refacciones || []).find(r => normalizar(r.codigo) === normalizar(codigo)) || null;
  }

  // ═══════════════════════════════════════════════════════════════
  // CONTEO DE INVENTARIO
  // ═══════════════════════════════════════════════════════════════

  const conteo = { item: null, resumen: null };

  async function abrirConteo() {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Preparando conteo...";
    try {
      await cargarCatalogos();
      const ru = await api("listar_ubicaciones");
      cache.ubicaciones = ru.ubicaciones || [];
      await refrescarRefacciones();
    } catch (e) {
      alert("Error: " + e.message);
      return volverAlMenu();
    }
    if (!cache.ubicaciones.length) {
      alert("No hay ubicaciones dadas de alta. Pide al administrador que las cree.");
      return volverAlMenu();
    }
    const sel = document.getElementById("conteo-ubicacion");
    llenarSelect(sel, cache.ubicaciones, u => u.codigo, u => u.nombre + " (" + u.codigo + ")");
    const ultima = leerLocal("ubicacion_conteo");
    if (ultima && cache.ubicaciones.some(u => u.codigo === ultima)) sel.value = ultima;
    sel.onchange = () => { guardarLocal("ubicacion_conteo", sel.value); cerrarPanelConteo(); cargarResumenConteo(); };

    const buscar = document.getElementById("conteo-buscar");
    buscar.value = "";
    buscar.oninput = renderResultadosConteo;
    document.getElementById("conteo-resultados").innerHTML = "";
    cerrarPanelConteo();
    mostrarVista("view-conteo");
    cargarResumenConteo();
  }

  async function cargarResumenConteo() {
    const ubic = document.getElementById("conteo-ubicacion").value;
    const lista = document.getElementById("conteo-lista");
    lista.innerHTML = "<p class='ayuda'>Cargando...</p>";
    const r = await api("resumen_conteo", { ubicacion: ubic });
    if (!r.ok) { lista.innerHTML = "<p class='ayuda'>" + esc(r.error) + "</p>"; return; }
    if (ubic !== document.getElementById("conteo-ubicacion").value) return;   // cambió mientras cargaba
    conteo.resumen = r;
    renderResumenConteo();
  }

  function renderResumenConteo() {
    const r = conteo.resumen;
    if (!r) return;
    const lista = document.getElementById("conteo-lista");
    const contados = {};
    r.conteos.forEach(c => { contados[normalizar(c.codigo)] = c; });
    lista.innerHTML = r.conteos.length ? "" : "<p class='ayuda'>Todavía no hay piezas contadas hoy en esta ubicación.</p>";
    r.conteos.forEach(c => {
      const d = document.createElement("div");
      d.className = "item-toque";
      d.innerHTML = "<div><span class='cod'>" + esc(c.codigo) + "</span> · <b>" + esc(c.cantidad) + " " + esc(c.unidad) + "</b> · " +
        (c.estado === "PENDIENTE" ? "<span class='ayuda'>pendiente</span>" : difHtml(c.diferencia)) + "</div>" +
        "<div class='sub'>" + esc(c.descripcion) + "</div>" +
        "<div class='sub'>" + esc(c.hora.slice(0, 5)) + " · " + esc(c.nombre_usuario || c.usuario) + "</div>";
      d.onclick = () => { const p = piezaPorCodigo(c.codigo); if (p) seleccionarPiezaConteo(p); };
      lista.appendChild(d);
    });

    const faltan = r.sistema.filter(x => !contados[normalizar(x.codigo)]);
    document.getElementById("conteo-faltan-n").textContent = faltan.length;
    const total = r.sistema.length + r.conteos.filter(c => !r.sistema.some(x => normalizar(x.codigo) === normalizar(c.codigo))).length;
    document.getElementById("conteo-avance").textContent = total ? "(" + r.conteos.length + " de " + total + ")" : "";
    const cf = document.getElementById("conteo-faltan");
    cf.innerHTML = faltan.length ? "" : "<p class='ayuda'>Nada pendiente. 👍</p>";
    faltan.forEach(x => {
      const d = document.createElement("div");
      d.className = "item-toque";
      d.innerHTML = "<div><span class='cod'>" + esc(x.codigo) + "</span> · sistema: " + esc(x.saldo) + " " + esc(x.unidad) + "</div>" +
        "<div class='sub'>" + esc(x.descripcion) + "</div>";
      d.onclick = () => { const p = piezaPorCodigo(x.codigo); if (p) seleccionarPiezaConteo(p); };
      cf.appendChild(d);
    });
  }

  function renderResultadosConteo() {
    const q = document.getElementById("conteo-buscar").value;
    const cont = document.getElementById("conteo-resultados");
    cont.innerHTML = "";
    if (palabras(q).length === 0) return;
    const res = buscarPiezas(q, cache.refacciones, 8);
    if (!res.length) {
      cont.innerHTML = "<p class='ayuda'>No encontré esa pieza. Si es nueva, usa el botón de abajo.</p>";
      return;
    }
    res.forEach(p => {
      const d = document.createElement("div");
      d.className = "item-toque";
      d.innerHTML = "<div class='cod'>" + esc(p.codigo) + "</div><div class='sub'>" + esc(p.descripcion) + "</div>";
      d.onclick = () => seleccionarPiezaConteo(p);
      cont.appendChild(d);
    });
  }

  function seleccionarPiezaConteo(p) {
    conteo.item = p;
    const r = conteo.resumen || { sistema: [], conteos: [] };
    const enSis = r.sistema.find(x => normalizar(x.codigo) === normalizar(p.codigo));
    const ya = r.conteos.find(x => normalizar(x.codigo) === normalizar(p.codigo));
    document.getElementById("conteo-codigo").textContent = p.codigo;
    document.getElementById("conteo-desc").textContent = p.descripcion;
    document.getElementById("conteo-info").textContent =
      "En sistema aquí: " + (enSis ? enSis.saldo : 0) + " " + (p.unidad || "");
    document.getElementById("conteo-unidad").textContent = p.unidad || "";
    const boxYa = document.getElementById("conteo-ya");
    if (ya) {
      document.getElementById("conteo-ya-texto").innerHTML =
        "Hoy ya contaste <b>" + esc(ya.cantidad) + " " + esc(ya.unidad) + "</b> (" + esc(ya.hora.slice(0, 5)) + ").";
      boxYa.dataset.ya = ya.cantidad;
      boxYa.classList.remove("hidden");
      document.querySelector("input[name=conteo-modo][value=reemplazar]").checked = true;
    } else {
      boxYa.dataset.ya = "";
      boxYa.classList.add("hidden");
    }
    document.getElementById("conteo-cantidad").value = "";
    document.getElementById("conteo-notas").value = "";
    msg(document.getElementById("conteo-status"), "");
    document.getElementById("conteo-buscador").classList.add("hidden");
    document.getElementById("conteo-panel").classList.remove("hidden");
    document.getElementById("conteo-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => document.getElementById("conteo-cantidad").focus(), 250);
  }

  function cerrarPanelConteo() {
    conteo.item = null;
    document.getElementById("conteo-panel").classList.add("hidden");
    document.getElementById("conteo-buscador").classList.remove("hidden");
  }

  function ajustarCantidad(delta) {
    const inp = document.getElementById("conteo-cantidad");
    const v = Math.max(0, (Number(inp.value) || 0) + delta);
    inp.value = Math.round(v * 1000) / 1000;
  }

  async function guardarConteo() {
    const st = document.getElementById("conteo-status");
    const p = conteo.item;
    if (!p) return;
    const txt = document.getElementById("conteo-cantidad").value;
    let cant = Number(txt);
    if (txt === "" || !isFinite(cant) || cant < 0) return msg(st, "❌ Escribe cuántas hay (0 si no hay ninguna)", "error");
    const boxYa = document.getElementById("conteo-ya");
    const modo = document.querySelector("input[name=conteo-modo]:checked").value;
    if (boxYa.dataset.ya !== "" && modo === "sumar") cant = Number(boxYa.dataset.ya) + cant;
    if (cant === 0 && !confirm("¿Confirmas que NO hay ninguna pieza en esta ubicación?")) return;

    const btn = document.getElementById("btn-conteo-guardar");
    btn.disabled = true;
    msg(st, "Guardando...");
    try {
      const r = await api("registrar_conteo", {
        ubicacion: document.getElementById("conteo-ubicacion").value,
        codigo: p.codigo, cantidad: cant,
        notas: document.getElementById("conteo-notas").value.trim()
      }, "POST");
      if (!r.ok) return msg(st, "❌ " + r.error, "error");
      vibrar(60);
      const buscar = document.getElementById("conteo-buscar");
      buscar.value = "";
      document.getElementById("conteo-resultados").innerHTML =
        "<div class='aviso'>✅ " + esc(p.codigo) + ": " + esc(cant) + " " + esc(p.unidad || "") + " · " +
        (r.estado === "PENDIENTE" ? "pendiente de aplicar" : difHtml(r.diferencia)) + "</div>";
      cerrarPanelConteo();
      cargarResumenConteo();
      buscar.focus();
    } finally {
      btn.disabled = false;
    }
  }

  async function escanearEnConteo() {
    const txt = await escanearQR();
    if (!txt) return;
    const q = interpretarQR(txt);
    if (q.tipo === "ubicacion") {
      const sel = document.getElementById("conteo-ubicacion");
      if (!cache.ubicaciones.some(u => normalizar(u.codigo) === q.valor)) return alert("Ubicación no registrada: " + q.valor);
      sel.value = cache.ubicaciones.find(u => normalizar(u.codigo) === q.valor).codigo;
      guardarLocal("ubicacion_conteo", sel.value);
      cerrarPanelConteo();
      return cargarResumenConteo();
    }
    if (q.tipo === "equipo") return alert("Esa es la etiqueta de una máquina. Escanea la de la ubicación o la de la pieza.");
    let p = piezaPorCodigo(q.valor);
    if (!p) { await refrescarRefacciones(); p = piezaPorCodigo(q.valor); }
    if (!p) return alert("Esa etiqueta no corresponde a una pieza activa: " + q.valor);
    seleccionarPiezaConteo(p);
  }

  // ═══════════════════════════════════════════════════════════════
  // PIEZA NUEVA (alta rápida mientras se cuenta)
  // ═══════════════════════════════════════════════════════════════

  let pnAuto = true;   // la clasificación la eligió la app (se puede cambiar sola)

  function abrirPiezaNueva() {
    const cat = cache.catalogos;
    const $ = id => document.getElementById(id);
    llenarSelect($("pn-clasif"), cat.subfamilias,
      s => normalizar(s.familia) + "-" + normalizar(s.subfamilia),
      s => normalizar(s.familia) + "-" + normalizar(s.subfamilia) + " · " + s.nombre, "Elige o toca una sugerencia...");
    llenarSelect($("pn-unidad"), cat.unidades, u => u.codigo, u => u.codigo + " — " + u.nombre);
    $("pn-unidad").value = "PZ";
    llenarSelect($("pn-equipo"), cat.equipos, q => q.codigo, q => q.codigo + " — " + q.nombre, "— Uso general —");
    $("pn-desc").value = document.getElementById("conteo-buscar").value.trim();
    ["pn-cantidad", "pn-marca", "pn-parte"].forEach(id => { $(id).value = ""; });
    $("pn-grado").value = "NO";
    pnAuto = true;
    $("pn-desc").oninput = actualizarPiezaNueva;
    $("pn-clasif").onchange = () => { pnAuto = false; mostrarEjemplosPN(); };
    msg($("pn-status"), "");
    actualizarPiezaNueva();
    mostrarVista("view-pieza-nueva");
    setTimeout(() => $("pn-desc").focus(), 250);
  }

  function mostrarEjemplosPN() {
    const k = document.getElementById("pn-clasif").value;
    const s = cache.catalogos.subfamilias.find(x => normalizar(x.familia) + "-" + normalizar(x.subfamilia) === k);
    document.getElementById("pn-ejemplos").textContent = s && s.ejemplos ? "Ejemplos: " + s.ejemplos : "";
    document.getElementById("pn-grado").value = k.indexOf("SAN-") === 0 ? "SI" : document.getElementById("pn-grado").value;
    document.querySelectorAll("#pn-sugerencias .chip").forEach(c => c.classList.toggle("activo", c.dataset.k === k));
  }

  function actualizarPiezaNueva() {
    const $ = id => document.getElementById(id);
    const desc = $("pn-desc").value;
    const limpio = sinAcentos(desc).replace(/\s+/g, " ").trim();
    $("pn-preview").textContent = limpio ? "Quedará así: " + limpio : "Ej. BALERO RIGIDO DE BOLAS 6205-2RS · CONTACTOR TRIPOLAR 25 A 220 VCA";

    // Sugerencias de clasificación
    const sug = sugerirClasificacion(desc);
    const cont = $("pn-sugerencias");
    cont.innerHTML = "";
    sug.forEach(k => {
      const s = cache.catalogos.subfamilias.find(x => normalizar(x.familia) + "-" + normalizar(x.subfamilia) === k);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.k = k;
      b.textContent = k + " · " + (s ? s.nombre : "");
      b.onclick = () => { $("pn-clasif").value = k; pnAuto = false; mostrarEjemplosPN(); };
      cont.appendChild(b);
    });
    if (pnAuto && sug.length) { $("pn-clasif").value = sug[0]; }
    if (pnAuto && !sug.length) { $("pn-clasif").value = ""; }
    mostrarEjemplosPN();

    // ¿Ya existe algo parecido?
    const sim = piezasSimilares(desc);
    const box = $("pn-similares");
    if (!sim.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
    box.classList.remove("hidden");
    box.innerHTML = "<b>¿Es alguna de estas? Si sí, tócala para contarla:</b>";
    sim.forEach(p => {
      const d = document.createElement("div");
      d.className = "item-toque";
      d.innerHTML = "<div class='cod'>" + esc(p.codigo) + "</div><div class='sub'>" + esc(p.descripcion) + "</div>";
      d.onclick = () => { mostrarVista("view-conteo"); seleccionarPiezaConteo(p); };
      box.appendChild(d);
    });
  }

  async function guardarPiezaNueva() {
    const $ = id => document.getElementById(id);
    const st = $("pn-status");
    const desc = $("pn-desc").value.trim();
    const clasif = $("pn-clasif").value;
    const cantTxt = $("pn-cantidad").value;
    const cant = Number(cantTxt);
    if (sinAcentos(desc).replace(/\s+/g, " ").trim().length < 8) return msg(st, "❌ Describe mejor la pieza (qué es, tipo y medida)", "error");
    if (!clasif) return msg(st, "❌ Elige la clasificación (toca una sugerencia)", "error");
    if (cantTxt === "" || !isFinite(cant) || cant < 0) return msg(st, "❌ Escribe la cantidad contada", "error");
    const [familia, subfamilia] = clasif.split("-");
    const ubic = document.getElementById("conteo-ubicacion").value;

    const btn = $("btn-pn-guardar");
    btn.disabled = true;
    msg(st, "Dando de alta...");
    try {
      const r = await api("crear_refaccion", {
        familia: familia, subfamilia: subfamilia, descripcion: desc,
        unidad: $("pn-unidad").value, marca: $("pn-marca").value.trim(),
        num_parte_fabricante: $("pn-parte").value.trim(), equipo_aplica: $("pn-equipo").value,
        grado_alimenticio: $("pn-grado").value, ubicacion_defecto: ubic
      }, "POST");
      if (!r.ok) {
        const m = String(r.error || "").match(/[A-Z]{3}-[A-Z]{3}-\d{4}/);
        msg(st, "❌ " + r.error + (m ? " — toca la sugerencia de arriba o búscala por ese código." : ""), "error");
        return;
      }
      const c = await api("registrar_conteo", { ubicacion: ubic, codigo: r.codigo, cantidad: cant }, "POST");
      await refrescarRefacciones();
      vibrar(120);
      $("alta-ok-codigo").textContent = r.codigo;
      $("alta-ok-desc").textContent = r.descripcion;
      $("alta-ok-conteo").textContent = c.ok
        ? "Contadas: " + cant + " " + $("pn-unidad").value + " en " + ubic
        : "⚠️ El alta quedó, pero el conteo no se guardó: " + c.error + ". Cuéntala de nuevo.";
      document.getElementById("conteo-buscar").value = "";
      document.getElementById("conteo-resultados").innerHTML = "";
      mostrarVista("view-alta-ok");
    } finally {
      btn.disabled = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // POR REVISAR (supervisor)
  // ═══════════════════════════════════════════════════════════════

  async function verRevisar() {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Cargando altas por revisar...";
    await refrescarRefacciones();
    const items = (cache.refacciones || []).filter(r => r.revisado === "NO");
    const cont = document.getElementById("lista-revisar");
    cont.innerHTML = items.length ? "" : "<p style='text-align:center;padding:20px;color:#888;'>Nada por revisar. 👍</p>";
    items.forEach(x => {
      const d = document.createElement("div");
      d.className = "ref-item";
      d.innerHTML =
        "<div class='ref-cod'>" + esc(x.codigo) + "</div>" +
        "<div class='ref-info'>" + esc(x.fecha_alta) + " · " + esc(x.usuario_alta) + "</div>" +
        "<div class='ref-desc'>" + esc(x.descripcion) + "</div>" +
        "<div class='ref-info'>" + esc([x.unidad, x.marca, x.num_parte_fabricante, x.equipo_aplica].filter(Boolean).join(" · ")) + "</div>";
      const acc = document.createElement("div");
      acc.style.cssText = "margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;";
      const bE = document.createElement("button");
      bE.className = "btn-secundario";
      bE.textContent = "✏️ Corregir";
      bE.onclick = () => abrirFormRefaccion(x.codigo);
      const bOk = document.createElement("button");
      bOk.className = "btn-primary";
      bOk.textContent = "✅ Está bien";
      bOk.onclick = async () => {
        const r = await api("marcar_revisado", { codigo: x.codigo }, "POST");
        if (!r.ok) return alert("Error: " + r.error);
        x.revisado = "SI";
        d.remove();
        actualizarBadgeRevisar();
      };
      acc.appendChild(bE);
      acc.appendChild(bOk);
      d.appendChild(acc);
      cont.appendChild(d);
    });
    actualizarBadgeRevisar();
    mostrarVista("view-revisar");
  }

  function actualizarBadgeRevisar() {
    const n = (cache.refacciones || []).filter(r => r.revisado === "NO").length;
    const b = document.getElementById("badge-revisar");
    if (b) b.textContent = n ? "(" + n + ")" : "";
  }

  // ═══════════════════════════════════════════════════════════════
  // CONTEOS (supervisor): ver, aplicar pendientes, descartar
  // ═══════════════════════════════════════════════════════════════

  async function verConteos() {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Cargando conteos...";
    const r = await api("listar_conteos");
    if (!r.ok) { alert("Error: " + r.error); return volverAlMenu(); }
    document.getElementById("conteos-modo").textContent = r.directo
      ? "Modo tiempo real: cada conteo ya ajustó el stock. Aquí revisas diferencias."
      : "Modo con aprobación: los conteos pendientes no mueven el stock hasta que los apliques.";
    const pendientes = r.conteos.filter(c => c.estado === "PENDIENTE").length;
    document.getElementById("conteos-acciones").style.display = pendientes ? "" : "none";
    const cont = document.getElementById("lista-conteos");
    cont.innerHTML = r.conteos.length ? "" : "<p style='text-align:center;padding:20px;color:#888;'>Sin conteos.</p>";
    r.conteos.forEach(c => {
      const d = document.createElement("div");
      d.className = "item-toque";
      const check = c.estado === "PENDIENTE" ? "<input type='checkbox' class='chk-conteo' value='" + esc(c.id) + "' />" : "";
      d.innerHTML = "<div class='check-fila'>" + check + "<div style='flex:1'>" +
        "<div><span class='cod'>" + esc(c.codigo) + "</span> · " + esc(c.ubicacion) + " · <b>" + esc(c.cantidad) + " " + esc(c.unidad) + "</b></div>" +
        "<div class='sub'>" + esc(c.descripcion) + "</div>" +
        "<div class='sub'>" + esc(c.fecha) + " " + esc(c.hora.slice(0, 5)) + " · " + esc(c.nombre_usuario || c.usuario) + " · " + esc(c.estado) +
        (c.estado === "APLICADO" ? " · " + difHtml(c.diferencia) + " (sistema " + esc(c.saldo_sistema) + ")" : "") + "</div>" +
        (c.notas ? "<div class='sub'>📝 " + esc(c.notas) + "</div>" : "") +
        "</div></div>";
      cont.appendChild(d);
    });
    mostrarVista("view-conteos");
  }

  async function accionConteos(accion) {
    const ids = Array.from(document.querySelectorAll(".chk-conteo:checked")).map(c => c.value);
    if (!ids.length) return alert("Selecciona al menos un conteo pendiente.");
    if (accion === "aplicar") {
      if (!confirm("¿Aplicar " + ids.length + " conteo(s)? El stock quedará igual a lo contado.")) return;
      const r = await api("aplicar_conteos", { ids: ids }, "POST");
      alert(r.ok ? "✅ " + r.mensaje : "Error: " + r.error);
    } else {
      if (!confirm("¿Descartar " + ids.length + " conteo(s)?")) return;
      for (const id of ids) {
        const r = await api("descartar_conteo", { id_conteo: id }, "POST");
        if (!r.ok) { alert("Error en " + id + ": " + r.error); break; }
      }
    }
    verConteos();
  }

  // ═══════════════════════════════════════════════════════════════
  // ETIQUETAS QR (imprimir)
  // ═══════════════════════════════════════════════════════════════

  const etiquetas = { modo: "piezas", filtro: "todas", seleccion: new Set() };

  async function verEtiquetas() {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Cargando...";
    await refrescarRefacciones();
    const ru = await api("listar_ubicaciones");
    cache.ubicaciones = ru.ubicaciones || [];
    etiquetas.seleccion = new Set();
    document.getElementById("et-buscar").value = "";
    document.getElementById("et-buscar").oninput = renderEtiquetas;
    document.getElementById("et-tab-piezas").onclick = () => cambiarModoEtiquetas("piezas");
    document.getElementById("et-tab-ubic").onclick = () => cambiarModoEtiquetas("ubicaciones");
    document.getElementById("et-tab-eq").onclick = () => cambiarModoEtiquetas("equipos");
    try { await cargarCatalogos(); } catch (e) { /* sin equipos */ }
    document.querySelectorAll("#et-filtros [data-filtro]").forEach(b => {
      b.onclick = () => {
        etiquetas.filtro = b.dataset.filtro;
        document.querySelectorAll("#et-filtros [data-filtro]").forEach(x => x.classList.toggle("activo", x === b));
        renderEtiquetas();
      };
    });
    document.getElementById("et-todas").onchange = (e) => {
      itemsEtiquetasVisibles().forEach(it => { if (e.target.checked) etiquetas.seleccion.add(it.qr); else etiquetas.seleccion.delete(it.qr); });
      renderEtiquetas();
    };
    cambiarModoEtiquetas("piezas");
    mostrarVista("view-etiquetas");
  }

  function cambiarModoEtiquetas(modo) {
    etiquetas.modo = modo;
    etiquetas.seleccion = new Set();
    document.getElementById("et-tab-piezas").classList.toggle("activo", modo === "piezas");
    document.getElementById("et-tab-ubic").classList.toggle("activo", modo === "ubicaciones");
    document.getElementById("et-tab-eq").classList.toggle("activo", modo === "equipos");
    document.getElementById("et-filtros").querySelector(".chips").style.display = modo === "piezas" ? "" : "none";
    renderEtiquetas();
  }

  function hoyTexto() {
    const d = new Date();
    return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
  }

  // Lista uniforme: { qr, titulo, sub, extra }
  function itemsEtiquetasTodos() {
    if (etiquetas.modo === "ubicaciones") {
      return cache.ubicaciones.map(u => ({ qr: "UBI:" + normalizar(u.codigo), titulo: u.nombre, sub: "Ubicación " + u.codigo, extra: u.tipo || "" }));
    }
    if (etiquetas.modo === "equipos") {
      return ((cache.catalogos && cache.catalogos.equipos) || []).map(e => ({
        qr: "EQ:" + normalizar(e.codigo), titulo: e.codigo, sub: e.nombre,
        extra: "Escanea para reportar una falla" }));
    }
    return (cache.refacciones || []).map(r => ({ qr: r.codigo, titulo: r.codigo, sub: r.descripcion, extra: [r.unidad, r.ubicacion_defecto].filter(Boolean).join(" · ") }));
  }

  function itemsEtiquetasVisibles() {
    const q = palabras(document.getElementById("et-buscar").value);
    const pasa = t => q.every(w => sinAcentos(t).includes(w));
    if (etiquetas.modo !== "piezas") return itemsEtiquetasTodos().filter(it => pasa(it.titulo + " " + it.sub));
    const hoy = hoyTexto();
    return (cache.refacciones || [])
      .filter(r => etiquetas.filtro === "todas" || (etiquetas.filtro === "hoy" ? r.fecha_alta === hoy : r.revisado === "NO"))
      .map(r => ({ qr: r.codigo, titulo: r.codigo, sub: r.descripcion, extra: [r.unidad, r.ubicacion_defecto].filter(Boolean).join(" · ") }))
      .filter(it => pasa(it.titulo + " " + it.sub + " " + it.extra));
  }

  function renderEtiquetas() {
    const items = itemsEtiquetasVisibles();
    const cont = document.getElementById("lista-etiquetas");
    cont.innerHTML = items.length ? "" : "<p class='ayuda'>No hay nada con ese filtro.</p>";
    items.slice(0, 300).forEach(it => {
      const d = document.createElement("label");
      d.className = "item-toque check-fila";
      d.innerHTML = "<input type='checkbox' " + (etiquetas.seleccion.has(it.qr) ? "checked" : "") + " />" +
        "<div><div class='cod'>" + esc(it.titulo) + "</div><div class='sub'>" + esc(it.sub) + "</div></div>";
      d.querySelector("input").onchange = (e) => {
        if (e.target.checked) etiquetas.seleccion.add(it.qr); else etiquetas.seleccion.delete(it.qr);
        actualizarBotonImprimir();
      };
      cont.appendChild(d);
    });
    if (items.length > 300) cont.insertAdjacentHTML("beforeend", "<p class='ayuda'>Mostrando 300 de " + items.length + ". Filtra para ver otras.</p>");
    document.getElementById("et-todas").checked = items.length > 0 && items.every(it => etiquetas.seleccion.has(it.qr));
    actualizarBotonImprimir();
  }

  function actualizarBotonImprimir() {
    document.getElementById("btn-imprimir-etiquetas").textContent = "🖨️ Imprimir (" + etiquetas.seleccion.size + ")";
  }

  async function imprimirEtiquetas() {
    const items = itemsEtiquetasTodos().filter(it => etiquetas.seleccion.has(it.qr));
    if (!items.length) return alert("Selecciona al menos una etiqueta.");
    const w = window.open("", "_blank");
    if (!w) return alert("Permite las ventanas emergentes de este sitio para imprimir.");
    try { await cargarScript("qrcode.min.js"); }
    catch (e) { w.close(); return alert("No se pudo cargar el generador de QR. Revisa tu conexión."); }

    const html = items.map(it => {
      const q = window.qrcode(0, "M");
      q.addData(it.qr);
      q.make();
      return "<div class='et'><div class='qr'>" + q.createSvgTag({ cellSize: 3, margin: 0, scalable: true }) + "</div>" +
        "<div class='tx'><div class='cod'>" + esc(it.titulo) + "</div><div class='desc'>" + esc(it.sub) + "</div>" +
        "<div class='ext'>" + esc(it.extra) + "</div></div></div>";
    }).join("");

    w.document.write("<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
      "<title>Etiquetas QR</title><style>" +
      "@page{size:letter;margin:10mm} body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#000}" +
      ".barra{padding:10px;background:#f1f5f9;font-size:14px} .barra button{font-size:16px;padding:8px 16px;margin-right:8px}" +
      ".hoja{display:grid;grid-template-columns:repeat(3,62mm);gap:3mm 4mm;padding:2mm}" +
      ".et{height:32mm;border:1px dashed #999;display:flex;gap:2mm;padding:2mm;box-sizing:border-box;overflow:hidden;break-inside:avoid;page-break-inside:avoid}" +
      ".qr{width:27mm;height:27mm;flex:none} .qr svg{width:100%;height:100%;display:block}" +
      ".tx{min-width:0} .cod{font-weight:bold;font-size:11pt;word-break:break-all} .desc{font-size:7.5pt;line-height:1.15;max-height:18mm;overflow:hidden;margin-top:1mm}" +
      ".ext{font-size:7pt;color:#444;margin-top:1mm} @media print{.barra{display:none} .et{border-color:#ddd}}" +
      "</style></head><body><div class='barra'><button onclick='window.print()'>🖨️ Imprimir</button>" + items.length +
      " etiquetas · Papel carta, escala 100%</div><div class='hoja'>" + html + "</div></body></html>");
    w.document.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // ÓRDENES DE TRABAJO
  // ═══════════════════════════════════════════════════════════════

  const ESTADO_OT = {
    SOLICITADA: { txt: "Solicitada", color: "#b45309", bg: "#fef3c7" },
    ASIGNADA:   { txt: "Asignada",   color: "#1d4ed8", bg: "#dbeafe" },
    EN_PROCESO: { txt: "En proceso", color: "#7c3aed", bg: "#ede9fe" },
    TERMINADA:  { txt: "Terminada",  color: "#047857", bg: "#d1fae5" },
    CERRADA:    { txt: "Cerrada",    color: "#374151", bg: "#e5e7eb" },
    CANCELADA:  { txt: "Cancelada",  color: "#6b7280", bg: "#f3f4f6" }
  };
  const COLOR_PRIORIDAD = { ALTA: "#b91c1c", MEDIA: "#b45309", BAJA: "#475569" };

  const otVista = { filtro: "abiertas", actual: null, asignables: null };

  function esSupervisor() { return ["supervisor", "gerencia", "admin"].includes(usuarioActual.rol); }

  function duracion(min) {
    min = Math.max(0, Math.round(Number(min) || 0));
    if (min < 60) return min + " min";
    const h = Math.floor(min / 60), m = min % 60;
    if (h < 24) return h + " h" + (m ? " " + m + " min" : "");
    const d = Math.floor(h / 24);
    return d + " d " + (h % 24) + " h";
  }

  function chipEstado(e) {
    const s = ESTADO_OT[e] || { txt: e, color: "#374151", bg: "#e5e7eb" };
    return "<span style='background:" + s.bg + ";color:" + s.color + ";border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700;'>" + esc(s.txt) + "</span>";
  }

  function tarjetaOT(o) {
    const d = document.createElement("div");
    d.className = "item-toque";
    d.style.borderLeft = "5px solid " + (COLOR_PRIORIDAD[o.prioridad] || "#cbd5e1");
    d.innerHTML =
      "<div style='display:flex;justify-content:space-between;gap:8px;align-items:center;'>" +
        "<span class='cod'>" + esc(o.id_ot) + "</span>" + chipEstado(o.estado) + "</div>" +
      (o.paro_abierto ? "<div style='color:#b91c1c;font-weight:800;margin-top:4px;'>⛔ EQUIPO PARADO · " + esc(duracion(o.minutos_paro)) + "</div>" : "") +
      "<div style='margin-top:4px;'><b>" + esc(o.equipo) + "</b> · " + esc(o.nombre_equipo) + "</div>" +
      "<div class='sub'>" + esc(o.descripcion_falla) + "</div>" +
      "<div class='sub'>" + esc(o.prioridad) + " · " + esc(o.tipo) + " · " +
        (o.nombre_asignado ? "👷 " + esc(o.nombre_asignado) : "Sin asignar") + " · " +
        (["SOLICITADA", "ASIGNADA", "EN_PROCESO"].includes(o.estado) ? "abierta hace " : "duró ") + esc(duracion(o.minutos_abierta)) + "</div>";
    d.onclick = () => verDetalleOT(o.id_ot);
    return d;
  }

  async function verOTs(filtro) {
    if (filtro) otVista.filtro = filtro;
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Cargando órdenes de trabajo...";
    const r = await api("listar_ots", { filtro: otVista.filtro });
    if (!r.ok) { alert("Error: " + r.error); return volverAlMenu(); }
    document.querySelectorAll("#ot-tabs [data-f]").forEach(b => {
      b.classList.toggle("activo", b.dataset.f === otVista.filtro);
      b.onclick = () => verOTs(b.dataset.f);
    });
    const c = r.contadores || {};
    document.getElementById("ot-contadores").innerHTML = usuarioActual.rol === "produccion" ? "" :
      (c.PARADOS ? "<b style='color:#b91c1c'>⛔ " + c.PARADOS + " parado(s)</b> · " : "") +
      "Solicitadas " + (c.SOLICITADA || 0) + " · Asignadas " + (c.ASIGNADA || 0) +
      " · En proceso " + (c.EN_PROCESO || 0) + " · Por cerrar " + (c.TERMINADA || 0);
    const cont = document.getElementById("lista-ots");
    cont.innerHTML = r.ots.length ? "" : "<p style='text-align:center;padding:20px;color:#888;'>No hay órdenes en esta lista.</p>";
    r.ots.forEach(o => cont.appendChild(tarjetaOT(o)));
    mostrarVista("view-ots");
  }

  // ─── Reportar falla / nueva OT ───

  async function abrirNuevaOT(equipoInicial) {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Cargando equipos...";
    try { await cargarCatalogos(); } catch (e) { alert("Error: " + e.message); return volverAlMenu(); }
    const $ = id => document.getElementById(id);
    if (!cache.catalogos.equipos.length) {
      alert("Todavía no hay equipos dados de alta. Pide al supervisor que los registre en 🏭 Equipos.");
      return volverAlMenu();
    }
    llenarSelect($("otn-equipo"), cache.catalogos.equipos, q => q.codigo, q => q.codigo + " — " + q.nombre, "Elige la máquina...");
    $("otn-equipo").value = equipoInicial || "";
    $("otn-desc").value = "";
    elegirParado("NO");
    const sup = esSupervisor();
    $("otn-sup").style.display = sup ? "" : "none";
    if (sup) {
      if (!otVista.asignables) {
        const a = await api("listar_asignables");
        otVista.asignables = a.ok ? a.usuarios : [];
      }
      llenarSelect($("otn-asignar"), otVista.asignables, u => u.usuario, u => u.nombre + " (" + u.rol + ")", "— Sin asignar todavía —");
      $("otn-prioridad").value = "";
      $("otn-tipo").value = "CORRECTIVO";
    }
    msg($("otn-status"), "");
    mostrarVista("view-ot-nueva");
  }

  function elegirParado(v) {
    document.getElementById("otn-parado").value = v;
    document.getElementById("otn-parado-si").classList.toggle("activo", v === "SI");
    document.getElementById("otn-parado-no").classList.toggle("activo", v === "NO");
  }

  async function escanearEquipoOT() {
    const txt = await escanearQR();
    if (!txt) return;
    const t = String(txt).trim().toUpperCase();
    const cod = t.indexOf("EQ:") === 0 ? t.slice(3) : t;
    const eq = cache.catalogos.equipos.find(e => normalizar(e.codigo) === cod);
    if (!eq) return alert("Esa etiqueta no es de un equipo registrado: " + cod);
    document.getElementById("otn-equipo").value = eq.codigo;
  }

  async function guardarNuevaOT() {
    const $ = id => document.getElementById(id);
    const st = $("otn-status");
    const body = {
      equipo: $("otn-equipo").value,
      equipo_parado: $("otn-parado").value,
      descripcion_falla: $("otn-desc").value.trim()
    };
    if (!body.equipo) return msg(st, "❌ Elige la máquina", "error");
    if (body.descripcion_falla.length < 10) return msg(st, "❌ Describe qué pasa (ruido, fuga, no arranca, desde cuándo...)", "error");
    if (esSupervisor()) {
      body.prioridad = $("otn-prioridad").value;
      body.tipo = $("otn-tipo").value;
      body.asignar_a = $("otn-asignar").value;
    }
    const btn = $("btn-otn-guardar");
    btn.disabled = true;
    msg(st, "Enviando...");
    try {
      const r = await api("crear_ot", body, "POST");
      if (!r.ok) return msg(st, "❌ " + r.error, "error");
      vibrar(100);
      alert("✅ Reporte enviado: " + r.id_ot + (body.equipo_parado === "SI" ? "\n\nSe avisó que el equipo está parado." : ""));
      verDetalleOT(r.id_ot);
    } finally {
      btn.disabled = false;
    }
  }

  // ─── Detalle y acciones ───

  async function verDetalleOT(id) {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Cargando " + id + "...";
    const r = await api("detalle_ot", { id_ot: id });
    if (!r.ok) { alert("Error: " + r.error); return verOTs(); }
    otVista.actual = r;
    renderDetalleOT();
    mostrarVista("view-ot-detalle");
    window.scrollTo(0, 0);
  }

  function filaDato(etq, val) {
    return val || val === 0 ? "<div style='display:flex;gap:8px;margin:3px 0;'><span class='sub' style='min-width:110px;'>" + esc(etq) +
      "</span><span>" + val + "</span></div>" : "";
  }

  function renderDetalleOT() {
    const r = otVista.actual, o = r.ot, p = r.puede;
    const cont = document.getElementById("ot-detalle");
    let html =
      "<div style='display:flex;justify-content:space-between;align-items:center;gap:8px;'>" +
        "<h2 style='margin:0;'>" + esc(o.id_ot) + "</h2>" + chipEstado(o.estado) + "</div>" +
      (o.paro_abierto ? "<div class='aviso' style='background:#fee2e2;color:#991b1b;font-weight:800;'>⛔ EQUIPO PARADO desde hace " + esc(duracion(o.minutos_paro)) + "</div>" : "") +
      "<div class='tarjeta-conteo' style='border-color:" + (COLOR_PRIORIDAD[o.prioridad] || "#1e3a5f") + "'>" +
        "<div class='conteo-codigo' style='font-size:18px;'>" + esc(o.equipo) + " · " + esc(o.nombre_equipo) + "</div>" +
        "<div class='conteo-desc'>" + esc(o.descripcion_falla) + "</div>" +
        filaDato("Prioridad", "<b style='color:" + (COLOR_PRIORIDAD[o.prioridad] || "") + "'>" + esc(o.prioridad) + "</b> · " + esc(o.tipo)) +
        filaDato("Reportó", esc(o.nombre_solicitante || o.solicitante) + " · " + esc(o.fecha) + " " + esc(o.hora)) +
        filaDato("Técnico", o.nombre_asignado ? "👷 " + esc(o.nombre_asignado) : "<i>Sin asignar</i>") +
        (o.minutos_trabajo ? filaDato("Tiempo trabajo", esc(duracion(o.minutos_trabajo))) : "") +
        (o.equipo_parado === "SI" && !o.paro_abierto ? filaDato("Tiempo parado", esc(duracion(o.minutos_paro))) : "") +
        (o.trabajo_realizado ? filaDato("Trabajo", esc(o.trabajo_realizado)) : "") +
        (o.causa ? filaDato("Causa", esc(o.causa)) : "") +
        (o.horas_hombre ? filaDato("Horas-hombre", esc(o.horas_hombre)) : "") +
        (o.motivo_cancelacion ? filaDato("Cancelada", esc(o.motivo_cancelacion)) : "") +
        (o.notas_cierre ? filaDato("Cierre", esc(o.notas_cierre)) : "") +
      "</div>";

    // Material
    html += "<h3>Material " + (r.materiales.length ? "<span class='ayuda'>(" + fmtMoneda(r.costo_refacciones) + ")</span>" : "") + "</h3>";
    html += r.materiales.length ? r.materiales.map(m =>
      "<div class='item-toque' style='cursor:default'><div><span class='cod'>" + esc(m.codigo) + "</span> · " +
      "<b style='color:" + (m.cantidad < 0 ? "#15803d" : "inherit") + "'>" + esc(m.cantidad) + " " + esc(m.unidad) + "</b> · " + fmtMoneda(m.importe) + "</div>" +
      "<div class='sub'>" + esc(m.descripcion) + "</div><div class='sub'>" + esc(m.tipo) + " " + esc(m.id_movimiento) + "</div></div>").join("")
      : "<p class='ayuda'>Sin material todavía.</p>";

    // Bitácora
    html += "<h3>Bitácora</h3>" + r.bitacora.slice().reverse().map(b =>
      "<div style='border-left:3px solid #cbd5e1;padding:4px 0 8px 10px;margin-left:4px;'>" +
      "<div class='sub'>" + esc(b.fecha) + " " + esc(b.hora) + " · " + esc(b.nombre || b.usuario) + "</div>" +
      "<div><b>" + esc(b.evento.replace("_", " ")) + "</b>" + (b.detalle ? " — " + esc(b.detalle) : "") + "</div></div>").join("");
    cont.innerHTML = html;

    // Acciones según estado y rol
    const acc = document.getElementById("ot-acciones");
    acc.innerHTML = "";
    const boton = (txt, fn, clase) => {
      const b = document.createElement("button");
      b.className = (clase || "btn-primary") + " btn-ancho";
      b.textContent = txt;
      b.onclick = fn;
      acc.appendChild(b);
    };
    if (p.iniciar) boton(o.estado === "SOLICITADA" ? "✋ Tomar y empezar" : "▶️ Empezar trabajo", () => accionOT("iniciar_ot", {}, "OT iniciada"));
    if (p.material) {
      boton("➖ Sacar material para esta OT", () => abrirMovimiento("SALIDA", { ot: o.id_ot, equipo: o.equipo }));
      if (r.materiales.length) boton("↩️ Devolver material sobrante", () => abrirMovimiento("DEVOLUCION", { ot: o.id_ot, equipo: o.equipo }), "btn-secundario");
    }
    if (p.equipo_opera) boton("✅ El equipo ya funciona", () => { if (confirm("¿El equipo ya está operando?")) accionOT("equipo_opera_ot", {}, ""); }, "btn-secundario");
    if (p.terminar) boton("🏁 Terminar OT", formTerminarOT);
    if (p.asignar && ["SOLICITADA", "ASIGNADA", "EN_PROCESO"].includes(o.estado)) boton(o.nombre_asignado ? "👷 Reasignar / prioridad" : "👷 Asignar técnico", formAsignarOT, "btn-secundario");
    if (p.cerrar) {
      boton("🔒 Revisada: cerrar OT", () => { const n = prompt("Notas de cierre (opcional):", ""); if (n !== null) accionOT("cerrar_ot", { notas: n }, "OT cerrada"); });
      boton("↩️ Reabrir (falta algo)", () => { const m = prompt("¿Qué falta? (obligatorio)"); if (m) accionOT("reabrir_ot", { motivo: m }, "OT reabierta"); }, "btn-secundario");
    }
    if (p.nota) boton("📝 Agregar nota", () => { const n = prompt("Nota para la bitácora:"); if (n && n.trim()) accionOT("nota_ot", { nota: n.trim() }, ""); }, "btn-secundario");
    if (p.cancelar) boton("✖ Cancelar OT", cancelarOTUI, "btn-secundario");
  }

  async function accionOT(accion, extra, ok) {
    const id = otVista.actual.ot.id_ot;
    const r = await api(accion, Object.assign({ id_ot: id }, extra || {}), "POST");
    if (!r.ok) return alert("Error: " + r.error);
    vibrar(60);
    if (ok) msg(document.getElementById("ot-status"), "✅ " + (r.mensaje || ok), "ok");
    verDetalleOT(id);
  }

  async function cancelarOTUI() {
    const m = prompt("¿Por qué se cancela? (obligatorio)");
    if (!m || !m.trim()) return;
    const id = otVista.actual.ot.id_ot;
    let r = await api("cancelar_ot", { id_ot: id, motivo: m.trim() }, "POST");
    if (!r.ok && r.requiere_confirmar) {
      if (!confirm(r.error + "\n\n¿Cancelar de todos modos?")) return;
      r = await api("cancelar_ot", { id_ot: id, motivo: m.trim(), confirmar_material: true }, "POST");
    }
    if (!r.ok) return alert("Error: " + r.error);
    verDetalleOT(id);
  }

  function formEnAcciones(html, alGuardar) {
    const acc = document.getElementById("ot-acciones");
    acc.innerHTML = "<div class='tarjeta-conteo'>" + html +
      "<p id='otf-status' class='send-status'></p><div class='form-acciones'>" +
      "<button class='btn-secundario' id='otf-cancelar'>Cancelar</button>" +
      "<button class='btn-primary' id='otf-guardar'>Guardar</button></div></div>";
    document.getElementById("otf-cancelar").onclick = renderDetalleOT;
    document.getElementById("otf-guardar").onclick = async () => {
      const b = document.getElementById("otf-guardar");
      b.disabled = true;
      try { await alGuardar(document.getElementById("otf-status")); } finally { b.disabled = false; }
    };
    acc.scrollIntoView({ behavior: "smooth" });
  }

  async function formAsignarOT() {
    const o = otVista.actual.ot;
    if (!otVista.asignables) {
      const a = await api("listar_asignables");
      otVista.asignables = a.ok ? a.usuarios : [];
    }
    formEnAcciones(
      "<label>Técnico</label><select id='otf-asig'>" + otVista.asignables.map(u =>
        "<option value='" + esc(u.usuario) + "'" + (u.usuario === o.asignado_a ? " selected" : "") + ">" + esc(u.nombre) + " (" + esc(u.rol) + ")</option>").join("") + "</select>" +
      "<label>Prioridad</label><select id='otf-prio'>" + ["ALTA", "MEDIA", "BAJA"].map(x =>
        "<option" + (x === o.prioridad ? " selected" : "") + ">" + x + "</option>").join("") + "</select>" +
      "<label>Tipo</label><select id='otf-tipo'>" + ["CORRECTIVO", "PREVENTIVO", "MEJORA"].map(x =>
        "<option" + (x === o.tipo ? " selected" : "") + ">" + x + "</option>").join("") + "</select>",
      async (st) => {
        const r = await api("asignar_ot", { id_ot: o.id_ot, asignar_a: document.getElementById("otf-asig").value,
          prioridad: document.getElementById("otf-prio").value, tipo: document.getElementById("otf-tipo").value }, "POST");
        if (!r.ok) return msg(st, "❌ " + r.error, "error");
        verDetalleOT(o.id_ot);
      });
  }

  function formTerminarOT() {
    const r = otVista.actual, o = r.ot;
    const horasSug = o.minutos_trabajo ? Math.max(0.5, Math.round(o.minutos_trabajo / 30) / 2) : "";
    formEnAcciones(
      "<label>¿Qué se hizo? *</label><textarea id='otf-trabajo' rows='3' placeholder='Ej. Se cambió el balero 6205 del motor y se tensó la cadena'></textarea>" +
      "<label>Causa de la falla</label><select id='otf-causa'>" + r.causas.map(c => "<option>" + esc(c) + "</option>").join("") + "</select>" +
      "<label>Horas-hombre *</label><input id='otf-horas' type='number' inputmode='decimal' min='0.25' step='0.25' value='" + horasSug + "' />" +
      "<p class='ayuda'>Suma de horas de todas las personas que trabajaron.</p>" +
      (o.paro_abierto ? "<label>¿El equipo ya funciona?</label><select id='otf-opera'><option value='SI'>SI, ya opera</option><option value='NO'>NO, sigue parado</option></select>" : ""),
      async (st) => {
        const body = {
          id_ot: o.id_ot,
          trabajo_realizado: document.getElementById("otf-trabajo").value.trim(),
          causa: document.getElementById("otf-causa").value,
          horas_hombre: Number(document.getElementById("otf-horas").value)
        };
        if (o.paro_abierto) body.equipo_opera = document.getElementById("otf-opera").value;
        if (body.trabajo_realizado.length < 10) return msg(st, "❌ Describe el trabajo realizado", "error");
        if (!(body.horas_hombre > 0)) return msg(st, "❌ Escribe las horas-hombre", "error");
        const res = await api("terminar_ot", body, "POST");
        if (!res.ok) return msg(st, "❌ " + res.error, "error");
        vibrar(120);
        verDetalleOT(o.id_ot);
      });
  }

  // ─── Historial del equipo ───

  async function verHistorialEquipo(codigo, nombre) {
    mostrarVista("view-loading");
    document.getElementById("loading-text").textContent = "Cargando historial...";
    const r = await api("historial_equipo", { codigo: codigo });
    if (!r.ok) { alert("Error: " + r.error); return verEquipos(); }
    const i = r.indicadores;
    const causas = Object.keys(i.causas).sort((a, b) => i.causas[b] - i.causas[a]);
    const tile = (n, t) => "<div style='background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px;text-align:center;'>" +
      "<div style='font-size:22px;font-weight:800;color:#1e3a5f;'>" + n + "</div><div class='sub'>" + t + "</div></div>";
    document.getElementById("eq-hist").innerHTML =
      "<h2>" + esc(codigo) + "</h2><p class='ayuda' style='margin-top:-8px;'>" + esc(nombre || "") + "</p>" +
      "<div style='display:grid;grid-template-columns:repeat(2,1fr);gap:8px;'>" +
        tile(i.ots, "órdenes de trabajo") + tile(i.horas_paro + " h", "tiempo parado") +
        tile(fmtMoneda(i.costo_refacciones), "en refacciones") + tile(i.horas_hombre + " h", "horas-hombre") +
        tile(i.mtbf_dias ? i.mtbf_dias + " d" : "—", "entre fallas (MTBF)") + tile(i.mttr_horas ? i.mttr_horas + " h" : "—", "para reparar (MTTR)") +
      "</div>" +
      (causas.length ? "<h3>Causas más frecuentes</h3>" + causas.map(c => "<div class='sub'>" + esc(c) + ": <b>" + i.causas[c] + "</b></div>").join("") : "") +
      "<h3>Órdenes de trabajo</h3>";
    const cont = document.createElement("div");
    if (!r.ots.length) cont.innerHTML = "<p class='ayuda'>Sin órdenes de trabajo todavía.</p>";
    r.ots.forEach(o => cont.appendChild(tarjetaOT(o)));
    document.getElementById("eq-hist").appendChild(cont);
    mostrarVista("view-equipo-hist");
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
