// ==========================================
// 1. CONFIGURACIÓN Y CLIENTE SUPABASE
// ==========================================
const SUPABASE_URL = "https://ckinulkwmufmjvqmzjqt.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_5vP3-egGHx8pzJ012iQHDw_8ozMTbz2";

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// 2. ESTADO GLOBAL DE LA APLICACIÓN
// ==========================================
const scale = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
let cancionesDB = []; 
let activeSongId = null;
let idLiturgiaActiva = null; 
let currentRole = 'director';
let currentOffset = 0; 
let idOrdenEditando = null; 
let repertorioGlobal = []; 
let presenceChannel = null;
let usuariosConectados = [];
window.listaLiturgiaActiva = [];
window.usuarioActual = null;

// Variables para el Modal de Diagrama de Acordes
let acordeActualModal = '';
let instrumentoActualModal = 'guitarra';

// EXPRESIÓN REGULAR COMPLETA PARA DETECTAR Y VALIDAR ACORDES
const REGEX_ACORDE_STRING = "^[A-G][#b]?(?:m|maj|min|dim|aug|sus[24]?|add[0-9]?|[0-9])*(?:\\/[A-G][#b]?)?$";
const REGEX_ACORDE_MATCH = /\b[A-G][#b]?(?:m|maj|min|dim|aug|sus[24]?|add[0-9]?|[0-9])*(?:\/[A-G][#b]?)?\b/gi;

// ==========================================
// 3. AUTENTICACIÓN Y CONTROL DE ACCESO
// ==========================================

async function procesarLogin(event) {
    event.preventDefault(); 
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const btnSubmit = event.target.querySelector('button');

    btnSubmit.innerText = "Verificando...";
    btnSubmit.disabled = true;

    const { data, error } = await _supabase.auth.signInWithPassword({
        email: email,
        password: password,
    });

    if (error) {
        alert("❌ Error de autenticación: " + error.message);
        btnSubmit.innerText = "Ingresar al Portal";
        btnSubmit.disabled = false;
        return;
    }

    console.log("🔓 Usuario autenticado en Auth:", data.user.email);

    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) loginScreen.classList.add('hidden');
    
    const userInfoBadge = document.getElementById('userInfo');
    if (userInfoBadge) userInfoBadge.classList.remove('hidden');

    const btnSalir = document.getElementById('btnCerrarSesion');
    if (btnSalir) btnSalir.classList.remove('hidden');

    await obtenerRolUsuario(data.user.id, data.user.email, btnSubmit);
}

async function obtenerRolUsuario(userId, userEmail, btnSubmit) {
    let perfil = null;

    try {
        let { data, error } = await _supabase
            .from('perfiles')
            .select('id, rol, nombre, total_ingresos')
            .eq('email', userEmail)
            .maybeSingle(); 

        if (!data) {
            let resId = await _supabase
                .from('perfiles')
                .select('id, rol, nombre, total_ingresos')
                .eq('id', userId)
                .maybeSingle();
            data = resId.data;
        }

        if (error) throw error;
        perfil = data;
    } catch (errConsult) {
        console.error("❌ Error al consultar la tabla perfiles:", errConsult);
        alert("❌ Error al consultar el perfil: " + errConsult.message);
        if (btnSubmit && btnSubmit.disabled) {
            btnSubmit.innerText = "Ingresar al Portal";
            btnSubmit.disabled = false;
        }
        return;
    }

    if (!perfil) {
        alert(`⚠️ Tu usuario (${userEmail}) no está registrado en la tabla 'perfiles'.`);
        if (btnSubmit && btnSubmit.disabled) {
            btnSubmit.innerText = "Ingresar al Portal";
            btnSubmit.disabled = false;
        }
        return;
    }

    let accesosActualizados = (perfil.total_ingresos || 0) + 1;

    try {
        const { data: updateData, error: errUpd } = await _supabase
            .from('perfiles')
            .update({ total_ingresos: accesosActualizados })
            .eq('email', userEmail)
            .select();

        if (errUpd) {
            console.error("❌ Error Supabase al actualizar:", errUpd.message);
            accesosActualizados = perfil.total_ingresos || 1;
        } else if (!updateData || updateData.length === 0) {
            console.warn(`⚠️ No se encontró la fila para '${userEmail}'.`);
            accesosActualizados = perfil.total_ingresos || 1;
        } else {
            console.log(`✅ ¡ÉXITO! Conteo actualizado para ${perfil.nombre}: ${accesosActualizados} accesos.`);
        }
    } catch (errUpd) {
        console.error("❌ Error inesperado en UPDATE:", errUpd);
        accesosActualizados = perfil.total_ingresos || 1;
    }

    window.usuarioActual = { 
        id: userId, 
        email: userEmail, 
        rol: perfil.rol, 
        nombre: perfil.nombre,
        totalIngresos: accesosActualizados 
    };

    try {
        if (typeof inicializarPresenciaEnLinea === 'function') {
            inicializarPresenciaEnLinea();
        }
    } catch (e) {
        console.warn("Error al inicializar la presencia:", e);
    }

    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) loginScreen.classList.add('hidden');

    const lblUser = document.getElementById('userNameDisplay');
    if (lblUser) lblUser.innerText = perfil.nombre || userEmail;

    const userInfoBadge = document.getElementById('userInfo');
    if (userInfoBadge) userInfoBadge.classList.remove('hidden');

    const btnBib = document.getElementById('btnBiblioteca');
    if (btnBib) btnBib.classList.remove('hidden');

    const btnSalir = document.getElementById('btnCerrarSesion');
    if (btnSalir) btnSalir.classList.remove('hidden');

    const selector = document.getElementById('roleSelector');
    if (selector) {
        selector.value = perfil.rol;
        selector.disabled = true; 
    }

    if (typeof changeRole === 'function') {
        changeRole(perfil.rol);
    }

    try {
        await Promise.all([
            obtenerRepertorioGlobal(),
            cargarLiturgiaDelDia()
        ]);
        suscribirACambiosLiturgia();
    } catch (e) {
        console.warn("Error cargando datos iniciales:", e);
    }
}

async function cerrarSesion() {
    const confirmar = confirm("¿Estás seguro de que deseas cerrar sesión?");
    if (!confirmar) return;

    if (presenceChannel) {
        try {
            await presenceChannel.untrack();
            await presenceChannel.unsubscribe();
        } catch (e) {
            console.warn("Error al cerrar canal de presencia:", e);
        }
        presenceChannel = null;
    }

    const { error } = await _supabase.auth.signOut();

    if (error) {
        alert("❌ Error al cerrar sesión: " + error.message);
        return;
    }

    console.log("🔒 Sesión finalizada con éxito.");

    cancionesDB = [];
    repertorioGlobal = [];
    usuariosConectados = [];
    window.listaLiturgiaActiva = [];
    window.usuarioActual = null;
    activeSongId = null;
    idLiturgiaActiva = null;
    currentOffset = 0;

    const elemList = document.getElementById('liturgyList') || document.getElementById('listaLiturgia');
    if (elemList) elemList.innerHTML = "<p class='text-slate-400 text-xs p-2 text-center'>Esperando inicio de sesión...</p>";
    
    if (document.getElementById('songTitle')) document.getElementById('songTitle').innerText = "Selecciona una Alabanza";
    if (document.getElementById('songCategory')) document.getElementById('songCategory').innerText = "-";
    if (document.getElementById('originalTone')) document.getElementById('originalTone').innerText = "-";
    if (document.getElementById('currentTone')) document.getElementById('currentTone').innerText = "-";
    if (document.getElementById('songLyricsContainer')) {
        document.getElementById('songLyricsContainer').innerHTML = "<p class='text-slate-400 text-center py-4'>Inicia sesión para visualizar las letras.</p>";
    }

    const contenedorUsuarios = document.getElementById('listaUsuariosEnLinea');
    if (contenedorUsuarios) contenedorUsuarios.innerHTML = '';

    const selector = document.getElementById('roleSelector');
    if (selector) selector.disabled = false;

    const transposer = document.getElementById('transposerWidget');
    if (transposer) transposer.classList.add('hidden');
    
    const directorControls = document.getElementById('directorControls');
    if (directorControls) directorControls.classList.add('hidden');

    const btnBib = document.getElementById('btnBiblioteca');
    if (btnBib) btnBib.classList.add('hidden');

    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) {
        loginScreen.classList.remove('hidden');
        if (document.getElementById('loginEmail')) document.getElementById('loginEmail').value = "";
        if (document.getElementById('loginPassword')) document.getElementById('loginPassword').value = "";
        
        const btnSubmit = document.querySelector('#loginForm button');
        if (btnSubmit) {
            btnSubmit.innerText = "Ingresar al Portal";
            btnSubmit.disabled = false;
        }
    }
}

// ==========================================
// 4. CONEXIÓN CON DATOS (CONSULTAS SUPABASE)
// ==========================================

async function cargarLiturgiaDelDia() {
    try {
        const { data, error } = await _supabase
            .from('liturgia')
            .select('*')
            .order('posicion', { ascending: true });

        if (error) throw error;

        window.listaLiturgiaActiva = data || [];
        renderizarListaLiturgia(window.listaLiturgiaActiva);

        if (activeSongId) {
            renderizarCancionActiva();
        }

    } catch (err) {
        console.error("Error al cargar la liturgia:", err);
    }
}

function suscribirACambiosLiturgia() {
    _supabase
        .channel('liturgia_realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'liturgia' }, () => {
            console.log("⚡ Cambio detectado en la liturgia, actualizando...");
            cargarLiturgiaDelDia();
        })
        .subscribe();
}

async function obtenerRepertorioGlobal() {
    try {
        const { data, error } = await _supabase
            .from('canciones')
            .select('*')
            .order('titulo', { ascending: true });

        if (error) throw error;
        
        repertorioGlobal = data || [];
        
        const selectRepertorio = document.getElementById('modalBuscarRepertorio');
        if (selectRepertorio) {
            selectRepertorio.innerHTML = '<option value="">-- Selecciona una canción existente para reutilizarla --</option>';
            repertorioGlobal.forEach(cancion => {
                const opt = document.createElement('option');
                opt.value = cancion.id;
                opt.innerText = `[${cancion.tono_original}] ${cancion.titulo} (${cancion.momento || 'General'})`;
                selectRepertorio.appendChild(opt);
            });
        }
    } catch (error) {
        console.error("Error al obtener biblioteca de cantos:", error.message);
    }
}

function cargarCancionDesdeRepertorio(idCancion) {
    if (!idCancion) return;
    
    const cancionSeleccionada = repertorioGlobal.find(c => String(c.id) === String(idCancion));
    if (!cancionSeleccionada) return;

    document.getElementById('modalTipoPunto').value = 'cancion';
    alternarCamposFormulario('cancion'); 
    document.getElementById('modalTitulo').value = cancionSeleccionada.titulo;
    document.getElementById('modalTono').value = cancionSeleccionada.tono_original;
    document.getElementById('modalLetra').value = cancionSeleccionada.letra_acordes;
    if (cancionSeleccionada.momento) {
        document.getElementById('modalMomento').value = cancionSeleccionada.momento;
    }
}

// ==========================================
// 5. RENDERIZADO DE LA INTERFAZ
// ==========================================

function seleccionarElemento(id) {
    activeSongId = id;
    currentOffset = 0; 
    renderizarListaLiturgia();
    renderizarCancionActiva();
}

// ==========================================
// 6. LETRAS Y TRANSPOSICIÓN MUSICAL
// ==========================================

function transposeChord(chord, steps) {
    if (!chord) return chord;

    if (chord.includes('/')) {
        const partes = chord.split('/');
        return transposeChord(partes[0], steps) + '/' + transposeChord(partes[1], steps);
    }

    const match = chord.match(/^([A-G][#b]?)(.*)$/);
    if (!match) return chord;

    let root = match[1];
    let suffix = match[2];

    if (root.endsWith('b')) {
        const mapaBemoles = { 'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#' };
        root = mapaBemoles[root] || root;
    }

    const currentIndex = scale.indexOf(root);
    if (currentIndex === -1) return chord;

    const newIndex = (currentIndex + steps + 12) % 12;
    return scale[newIndex] + suffix;
}

function renderizarCancionActiva() {
    const cancion = (window.listaLiturgiaActiva && window.listaLiturgiaActiva.find(c => c.id === activeSongId)) 
                 || (window.cancionesDB && window.cancionesDB.find(c => c.id === activeSongId));
    
    const transposerWidget = document.getElementById('transposerWidget');
    const btnGuardar = document.getElementById('btnGuardarTono');
    const lyricsContainer = document.getElementById('songLyricsContainer');

    if (!cancion) {
        if (lyricsContainer) {
            lyricsContainer.innerHTML = "<p class='text-slate-400 text-center py-6'>Selecciona un punto o alabanza de la lista para ver el detalle.</p>";
        }
        document.getElementById('songTitle').innerText = "Selecciona una Alabanza";
        document.getElementById('songCategory').innerText = "-";
        document.getElementById('originalTone').innerText = "-";
        document.getElementById('currentTone').innerText = "-";
        
        if (transposerWidget) transposerWidget.classList.add('hidden');
        if (btnGuardar) btnGuardar.classList.add('hidden');
        return;
    }

    document.getElementById('songTitle').innerText = cancion.titulo || 'Sin título';
    document.getElementById('songCategory').innerText = cancion.momento || "General";
    document.getElementById('originalTone').innerText = cancion.tono_original || "-";

    const esCancion = cancion.tipo === 'cancion' || (cancion.tono_original && cancion.tono_original !== '-');
    let tonoCalculado = cancion.tono_original || "-";

    if (esCancion && tonoCalculado !== "-") {
        if (transposerWidget) transposerWidget.classList.remove('hidden');

        const scaleArray = typeof scale !== 'undefined' ? scale : ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        const idxOriginal = scaleArray.indexOf(cancion.tono_original);
        
        if (idxOriginal !== -1) {
            const offsetActual = typeof currentOffset !== 'undefined' ? currentOffset : 0;
            const idxActual = (idxOriginal + offsetActual + 12) % 12;
            tonoCalculado = scaleArray[idxActual];
        }
        document.getElementById('currentTone').innerText = tonoCalculado;
    } else {
        if (transposerWidget) transposerWidget.classList.add('hidden');
        document.getElementById('currentTone').innerText = "-";
    }

    if (btnGuardar) {
        const offsetActual = typeof currentOffset !== 'undefined' ? currentOffset : 0;
        const seCambioNota = offsetActual !== 0;
        const rolUsuario = typeof currentRole !== 'undefined' ? currentRole : 'integrante';

        if (rolUsuario === 'director' && esCancion && seCambioNota) {
            btnGuardar.classList.remove('hidden');
        } else {
            btnGuardar.classList.add('hidden');
        }
    }

    let textoFinal = cancion.letra_acordes || "";
    const offsetActual = typeof currentOffset !== 'undefined' ? currentOffset : 0;
    const rolUsuario = typeof currentRole !== 'undefined' ? currentRole : 'integrante';

    if (esCancion) {
        if (rolUsuario === 'cantante') {
            // MODO CANTANTE: Ocultar acordes
            textoFinal = textoFinal.replace(/\[.*?\]/g, '');

            let lineas = textoFinal.split('\n');
            let lineasSoloLetra = [];

            lineas.forEach(linea => {
                let lineaLimpia = linea.trim();
                if (lineaLimpia === "") {
                    lineasSoloLetra.push("");
                    return;
                }

                if (/^(VERSO|CORO|PUENTE|INTRO|OUTRO|FINAL|ESTROFA|TAG)/i.test(lineaLimpia)) {
                    lineasSoloLetra.push(lineaLimpia);
                    return;
                }

                let palabras = lineaLimpia.split(/\s+/);
                const regPattern = typeof REGEX_ACORDE_STRING !== 'undefined' ? REGEX_ACORDE_STRING : "^[A-G][#b]?(m|maj|min|dim|aug|sus)?[0-9]?";
                const regValidator = new RegExp(regPattern, "i");
                let esLineaDeAcordes = palabras.every(palabra => regValidator.test(palabra));

                if (!esLineaDeAcordes) {
                    let lineaNormalizada = lineaLimpia.replace(/\s+/g, ' ');
                    lineasSoloLetra.push(lineaNormalizada);
                }
            });

            lyricsContainer.innerHTML = `<pre class="font-sans whitespace-pre-wrap text-slate-100">${lineasSoloLetra.join('\n')}</pre>`;

        } else {
            // MODO MÚSICO / DIRECTOR: Acordes interactivos (clickeables)
            if (textoFinal.includes('[') && textoFinal.includes(']')) {
                textoFinal = textoFinal.replace(/\[(.*?)\]/g, (match, chord) => {
                    const transpuerto = typeof transposeChord === 'function' ? transposeChord(chord, offsetActual) : chord;
                    return `<span onclick="mostrarGraficoAcorde('${transpuerto}')" class="chord text-amber-400 font-bold font-mono px-0.5 cursor-pointer hover:bg-amber-500/20 hover:underline rounded transition" title="Ver cómo tocar ${transpuerto}">${transpuerto}</span>`;
                });
                lyricsContainer.innerHTML = `<pre class="font-mono whitespace-pre-wrap text-slate-100">${textoFinal}</pre>`;
            } else {
                let lineas = textoFinal.split('\n');
                let resultadoLineas = lineas.map(linea => {
                    let lineaLimpia = linea.trim();
                    if (lineaLimpia === "") return linea;

                    if (/^(VERSO|CORO|PUENTE|INTRO|OUTRO|FINAL|ESTROFA|TAG)/i.test(lineaLimpia)) {
                        return `<span class="text-indigo-300 font-bold">${linea}</span>`;
                    }

                    let palabras = lineaLimpia.split(/\s+/);
                    const regPattern = typeof REGEX_ACORDE_STRING !== 'undefined' ? REGEX_ACORDE_STRING : "^[A-G][#b]?(m|maj|min|dim|aug|sus)?[0-9]?";
                    const regValidator = new RegExp(regPattern, "i");
                    let esLineaDeAcordes = palabras.every(palabra => regValidator.test(palabra));

                    if (esLineaDeAcordes) {
                        let tokens = linea.split(/(\s+)/); 
                        return tokens.map(token => {
                            if (token.trim() === "") return token; 
                            let transpuerto = typeof transposeChord === 'function' ? transposeChord(token.trim(), offsetActual) : token.trim();
                            return `<span onclick="mostrarGraficoAcorde('${transpuerto}')" class="chord text-amber-400 font-bold font-mono cursor-pointer hover:bg-amber-500/20 hover:underline rounded transition" title="Ver cómo tocar ${transpuerto}">${transpuerto}</span>`;
                        }).join('');
                    }

                    return linea;
                });

                lyricsContainer.innerHTML = `<pre class="font-mono whitespace-pre-wrap text-slate-100">${resultadoLineas.join('\n')}</pre>`;
            }
        }
    } else {
        lyricsContainer.innerHTML = `
            <div class="bg-slate-800 border border-slate-700 rounded-2xl p-6 my-2">
                <div class="flex items-center gap-2 text-indigo-400 font-semibold text-sm mb-3 uppercase tracking-wider">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Indicaciones Litúrgicas
                </div>
                <p class="text-slate-200 text-base leading-relaxed whitespace-pre-line font-sans">${textoFinal || 'Sin observaciones agregadas.'}</p>
            </div>
        `;
    }
}

// ==========================================
// 6.B DICCIONARIO Y DIAGRAMA DE ACORDES
// ==========================================

function mostrarGraficoAcorde(acorde) {
    if (typeof currentRole !== 'undefined' && currentRole === 'cantante') return;

    acordeActualModal = acorde.replace(/[\[\]]/g, '').trim();
    
    document.getElementById('nombreAcordeModal').innerText = acordeActualModal;
    const modal = document.getElementById('modalAcorde');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
    
    renderizarDiagrama();
}

function cerrarModalAcorde() {
    const modal = document.getElementById('modalAcorde');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function cambiarPestanaInstrumento(inst) {
    instrumentoActualModal = inst;
    
    ['guitarra', 'teclado', 'bajo'].forEach(i => {
        const tab = document.getElementById(`tab${i.charAt(0).toUpperCase() + i.slice(1)}`);
        if (tab) {
            if (i === inst) {
                tab.className = "pb-2 text-sm font-bold text-amber-400 border-b-2 border-amber-400 transition";
            } else {
                tab.className = "pb-2 text-sm font-bold text-slate-400 hover:text-white transition";
            }
        }
    });

    renderizarDiagrama();
}

function renderizarDiagrama() {
    const contenedor = document.getElementById('contenedorDiagrama');
    if (!contenedor) return;

    const acordeFormateado = acordeActualModal
        .replace(/\//g, '_')
        .replace(/#/g, 'sharp');

    const acordeURLEncoded = encodeURIComponent(acordeActualModal);

    if (instrumentoActualModal === 'guitarra') {
        contenedor.innerHTML = `
            <img src="https://render.yousician.com/chords/guitar/${acordeURLEncoded}.svg" 
                 onerror="renderizarFallbackAcorde('${acordeActualModal}', 'guitarra')"
                 alt="Acorde ${acordeActualModal} para Guitarra" 
                 class="h-44 w-auto filter invert brightness-200">
        `;
    } else if (instrumentoActualModal === 'teclado') {
        contenedor.innerHTML = `
            <img src="https://chords.pianoscales.org/images/chords/${acordeFormateado}.png" 
                 onerror="renderizarFallbackAcorde('${acordeActualModal}', 'teclado')"
                 alt="Acorde ${acordeActualModal} para Teclado" 
                 class="h-32 w-auto bg-white p-2 rounded-lg">
        `;
    } else if (instrumentoActualModal === 'bajo') {
        contenedor.innerHTML = `
            <img src="https://render.yousician.com/chords/bass/${acordeURLEncoded}.svg" 
                 onerror="renderizarFallbackAcorde('${acordeActualModal}', 'bajo')"
                 alt="Acorde ${acordeActualModal} para Bajo" 
                 class="h-44 w-auto filter invert brightness-200">
        `;
    }
}

const DIAGRAMAS_INSTRUMENTOS = {
    guitarra: {
        "C":    { frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
        "C/E":  { frets: [0, 3, 2, 0, 1, 0],  fingers: [0, 3, 2, 0, 1, 0] },
        "C#m":  { frets: [-1, 4, 6, 6, 5, 4], fingers: [0, 1, 3, 4, 2, 1] },
        "D":    { frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] },
        "Dm":   { frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1] },
        "D/F#": { frets: [2, 0, 0, 2, 3, 2],  fingers: [1, 0, 0, 2, 4, 3] },
        "E":    { frets: [0, 2, 2, 1, 0, 0],  fingers: [0, 2, 3, 1, 0, 0] },
        "Em":   { frets: [0, 2, 2, 0, 0, 0],  fingers: [0, 2, 3, 0, 0, 0] },
        "F":    { frets: [1, 3, 3, 2, 1, 1],  fingers: [1, 3, 4, 2, 1, 1] },
        "F#m":  { frets: [2, 4, 4, 2, 2, 2],  fingers: [1, 3, 4, 1, 1, 1] },
        "G":    { frets: [3, 2, 0, 0, 0, 3],  fingers: [2, 1, 0, 0, 0, 3] },
        "A":    { frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] },
        "Am":   { frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] },
        "B":    { frets: [-1, 2, 4, 4, 4, 2], fingers: [0, 1, 2, 3, 4, 1] },
        "Bm":   { frets: [-1, 2, 4, 4, 3, 2], fingers: [0, 1, 3, 4, 2, 1] }
    },
    bajo: {
        "C":    { frets: [-1, 3, 2, 0], fingers: [0, 3, 2, 0] },
        "C/E":  { frets: [0, 3, 2, 0],  fingers: [0, 3, 2, 0] },
        "C#m":  { frets: [-1, 4, 2, 2], fingers: [0, 3, 1, 1] },
        "D":    { frets: [-1, 5, 4, 2], fingers: [0, 4, 3, 1] },
        "Dm":   { frets: [-1, 5, 3, 2], fingers: [0, 4, 2, 1] },
        "D/F#": { frets: [2, 0, 0, 2],  fingers: [1, 0, 0, 2] },
        "E":    { frets: [0, 2, 2, 1],  fingers: [0, 2, 3, 1] },
        "Em":   { frets: [0, 2, 2, 0],  fingers: [0, 2, 3, 0] },
        "F":    { frets: [1, 3, 3, 2],  fingers: [1, 3, 4, 2] },
        "F#m":  { frets: [2, 4, 4, 2],  fingers: [1, 3, 4, 1] },
        "G":    { frets: [3, 2, 0, 0],  fingers: [2, 1, 0, 0] },
        "A":    { frets: [-1, 0, 2, 2], fingers: [0, 0, 1, 2] },
        "Am":   { frets: [-1, 0, 2, 2], fingers: [0, 0, 2, 3] },
        "B":    { frets: [-1, 2, 4, 4], fingers: [0, 1, 3, 4] },
        "Bm":   { frets: [-1, 2, 4, 4], fingers: [0, 1, 3, 4] }
    },
    teclado: {
        "C":    { keys: [0, 4, 7], bassKey: null },
        "C/E":  { keys: [0, 4, 7], bassKey: 4 },
        "C#m":  { keys: [1, 4, 8], bassKey: null },
        "D":    { keys: [2, 6, 9], bassKey: null },
        "Dm":   { keys: [2, 5, 9], bassKey: null },
        "D/F#": { keys: [2, 6, 9], bassKey: 6 },
        "E":    { keys: [4, 8, 11], bassKey: null },
        "Em":   { keys: [4, 7, 11], bassKey: null },
        "F":    { keys: [5, 9, 0], bassKey: null },
        "F#m":  { keys: [6, 9, 1], bassKey: null },
        "G":    { keys: [7, 11, 2], bassKey: null },
        "A":    { keys: [9, 1, 4], bassKey: null },
        "Am":   { keys: [9, 0, 4], bassKey: null },
        "B":    { keys: [11, 3, 6], bassKey: null },
        "Bm":   { keys: [11, 2, 6], bassKey: null }
    }
};

function renderizarFallbackAcorde(acorde, instrumento) {
    const contenedor = document.getElementById('contenedorDiagrama');
    if (!contenedor) return;

    const instKey = instrumento.toLowerCase();

    if (instKey === 'teclado') {
        const datosTeclado = DIAGRAMAS_INSTRUMENTOS.teclado?.[acorde] || obtenerTeclasCalculadas(acorde);
        const svgTeclado = crearSVGTeclado(datosTeclado.keys, datosTeclado.bassKey);

        contenedor.innerHTML = `
            <div class="flex flex-col items-center justify-center p-2">
                <h3 class="text-xl font-black text-amber-400 mb-2">${acorde}</h3>
                ${svgTeclado}
                <span class="mt-3 text-[10px] uppercase font-bold text-indigo-300 bg-indigo-950/80 px-3 py-1 rounded-full border border-indigo-800">
                    Teclado / Piano
                </span>
            </div>
        `;
        return;
    }

    const datosAcorde = DIAGRAMAS_INSTRUMENTOS[instKey]?.[acorde];

    if (!datosAcorde) {
        contenedor.innerHTML = `
            <div class="text-center p-4">
                <p class="text-amber-400 font-bold text-lg mb-1">${acorde}</p>
                <p class="text-xs text-slate-300">Diagrama gráfico en desarrollo para este acorde.</p>
            </div>
        `;
        return;
    }

    const svgHTML = crearSVGDiagrama(datosAcorde.frets, datosAcorde.fingers, instKey === 'bajo' ? 4 : 6);

    contenedor.innerHTML = `
        <div class="flex flex-col items-center justify-center p-2">
            <h3 class="text-xl font-black text-amber-400 mb-1">${acorde}</h3>
            ${svgHTML}
            <span class="mt-2 text-[10px] uppercase font-bold text-indigo-300 bg-indigo-950/80 px-3 py-1 rounded-full border border-indigo-800">
                ${instrumento} (${instKey === 'bajo' ? '4 Cuerdas' : '6 Cuerdas'})
            </span>
        </div>
    `;
}

function crearSVGDiagrama(frets, fingers, numCuerdas = 6) {
    const width = 180;
    const height = 200;
    const startX = 35;
    const startY = 35;
    const gridWidth = 110;
    const gridHeight = 120;
    const numTrastes = 4;

    const stringSpacing = gridWidth / (numCuerdas - 1);
    const fretSpacing = gridHeight / numTrastes;

    let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" class="mx-auto">`;

    svg += `<rect x="${startX}" y="${startY - 4}" width="${gridWidth}" height="5" fill="#ffffff" rx="1" />`;

    for (let i = 0; i <= numTrastes; i++) {
        const y = startY + (i * fretSpacing);
        svg += `<line x1="${startX}" y1="${y}" x2="${startX + gridWidth}" y2="${y}" stroke="#64748b" stroke-width="1.5" />`;
    }

    for (let i = 0; i < numCuerdas; i++) {
        const x = startX + (i * stringSpacing);
        svg += `<line x1="${x}" y1="${startY}" x2="${x}" y2="${startY + gridHeight}" stroke="#94a3b8" stroke-width="1.5" />`;
    }

    frets.forEach((fret, stringIdx) => {
        const x = startX + (stringIdx * stringSpacing);

        if (fret === -1) {
            svg += `<text x="${x}" y="${startY - 10}" fill="#ef4444" font-size="12" font-weight="bold" text-anchor="middle">✕</text>`;
        } else if (fret === 0) {
            svg += `<circle cx="${x}" cy="${startY - 12}" r="4.5" fill="none" stroke="#ffffff" stroke-width="1.5" />`;
        } else {
            const y = startY + (fret * fretSpacing) - (fretSpacing / 2);
            const finger = fingers[stringIdx] || '';

            svg += `<circle cx="${x}" cy="${y}" r="8" fill="#10b981" stroke="#ffffff" stroke-width="1.5" />`;
            if (finger > 0) {
                svg += `<text x="${x}" y="${y + 3.5}" fill="#ffffff" font-size="10" font-weight="bold" text-anchor="middle">${finger}</text>`;
            }
        }
    });

    svg += `</svg>`;
    return svg;
}

function crearSVGTeclado(activeKeys = [], bassKey = null) {
    const width = 220;
    const height = 110;
    
    const whiteKeys = [
        { note: 0 }, { note: 2 }, { note: 4 }, { note: 5 }, { note: 7 }, { note: 9 }, { note: 11 }
    ];

    const blackKeys = [
        { note: 1, posIndex: 0 },
        { note: 3, posIndex: 1 },
        { note: 6, posIndex: 3 },
        { note: 8, posIndex: 4 },
        { note: 10, posIndex: 5 }
    ];

    const keyWidth = 28;
    const keyHeight = 90;
    const blackWidth = 16;
    const blackHeight = 55;
    const startX = 12;
    const startY = 10;

    let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" class="mx-auto">`;

    whiteKeys.forEach((k, idx) => {
        const x = startX + (idx * keyWidth);
        const isActive = activeKeys.includes(k.note);
        const isBass = bassKey === k.note;

        let fillColor = "#ffffff";
        if (isBass) fillColor = "#f59e0b";
        else if (isActive) fillColor = "#10b981";

        svg += `<rect x="${x}" y="${startY}" width="${keyWidth - 1}" height="${keyHeight}" fill="${fillColor}" stroke="#334155" stroke-width="1.5" rx="3" />`;
        
        if (isActive || isBass) {
            svg += `<circle cx="${x + (keyWidth / 2) - 0.5}" cy="${startY + keyHeight - 15}" r="3.5" fill="#0f172a" />`;
        }
    });

    blackKeys.forEach(k => {
        const x = startX + (k.posIndex * keyWidth) + (keyWidth - (blackWidth / 2));
        const isActive = activeKeys.includes(k.note);
        const isBass = bassKey === k.note;

        let fillColor = "#1e293b";
        if (isBass) fillColor = "#f59e0b";
        else if (isActive) fillColor = "#10b981";

        svg += `<rect x="${x}" y="${startY}" width="${blackWidth}" height="${blackHeight}" fill="${fillColor}" stroke="#0f172a" stroke-width="1.5" rx="2" />`;
    });

    svg += `</svg>`;
    return svg;
}

// ==========================================
// 8. HERRAMIENTAS Y MODALES DEL DIRECTOR
// ==========================================

function openModal() {
    idOrdenEditando = null; 
    const form = document.getElementById('directorForm');
    if (form) form.reset();
    
    const btnSubmit = document.querySelector('#directorForm button[type="submit"]');
    if (btnSubmit) btnSubmit.innerText = "Guardar Cambios";
    
    alternarCamposFormulario('cancion');
    abrirModal();
}

function abrirModal() { 
    const modal = document.getElementById('directorModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function closeModal() {
    const modal = document.getElementById('directorModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    idOrdenEditando = null;
    const form = document.getElementById('directorForm');
    if (form) form.reset();
}

function alternarCamposFormulario(tipo) {
    const seccionCancion = document.getElementById('seccionExclusivaCancion');
    const seccionGeneral = document.getElementById('seccionExclusivaGeneral');
    const labelTitulo = document.getElementById('labelTitulo');
    const txtLetra = document.getElementById('modalLetra');

    if (tipo === 'general') {
        if (seccionCancion) seccionCancion.classList.add('hidden');
        if (seccionGeneral) {
            seccionGeneral.classList.remove('hidden');
            seccionGeneral.classList.add('block');
        }
        if (labelTitulo) labelTitulo.innerText = "Descripción de la Actividad / Punto";
        if (document.getElementById('modalTitulo')) document.getElementById('modalTitulo').placeholder = "Ej: Oración Inicial o Bienvenida";
        if (txtLetra) txtLetra.required = false;
    } else {
        if (seccionCancion) {
            seccionCancion.classList.remove('hidden');
            seccionCancion.classList.add('block');
        }
        if (seccionGeneral) seccionGeneral.classList.add('hidden');
        if (labelTitulo) labelTitulo.innerText = "Nombre de la Alabanza";
        if (document.getElementById('modalTitulo')) document.getElementById('modalTitulo').placeholder = "Ej: Gracia sublime es";
    }
}

async function guardarNuevaAlabanza(event) {
    event.preventDefault();
    
    const btnSubmit = event.target.querySelector('button[type="submit"]');
    const textoOriginalBtn = btnSubmit ? btnSubmit.innerText : "Guardar Cambios";
    if (btnSubmit) {
        btnSubmit.innerText = "Guardando...";
        btnSubmit.disabled = true;
    }

    try {
        const tipo = document.getElementById('modalTipoPunto').value;
        const momento = document.getElementById('modalMomento').value;
        const titulo = document.getElementById('modalTitulo').value.trim();
        
        if (!titulo) {
            alert("⚠️ El título es obligatorio.");
            if (btnSubmit) { btnSubmit.innerText = textoOriginalBtn; btnSubmit.disabled = false; }
            return;
        }

        let tono = "-";
        let letraAcordes = "";
        let idCancionRepertorio = null;
        
        if (tipo === 'cancion') {
            tono = document.getElementById('modalTono').value;
            letraAcordes = document.getElementById('modalLetra').value;
            
            const idSeleccionado = document.getElementById('modalBuscarRepertorio').value;
            
            if (idSeleccionado) {
                idCancionRepertorio = parseInt(idSeleccionado, 10);
            } else {
                const existeEnRepertorio = repertorioGlobal.find(c => c.titulo.toLowerCase().trim() === titulo.toLowerCase().trim());
                
                if (!existeEnRepertorio) {
                    const { data: nuevaCancion, error: errorRepertorio } = await _supabase
                        .from('canciones')
                        .insert([{
                            titulo: titulo,
                            tono_original: tono,
                            letra_acordes: letraAcordes
                        }])
                        .select();

                    if (errorRepertorio) throw new Error("Error en repertorio: " + errorRepertorio.message);
                    
                    if (nuevaCancion && nuevaCancion.length > 0) {
                        idCancionRepertorio = parseInt(nuevaCancion[0].id, 10);
                    }
                } else {
                    idCancionRepertorio = parseInt(existeEnRepertorio.id, 10);
                }
            }
        } else {
            letraAcordes = document.getElementById('modalComentarios') ? document.getElementById('modalComentarios').value : '';
        }

        if (idOrdenEditando) {
            const objetoUpdate = {
                tipo: tipo,
                momento: momento,
                titulo: titulo,
                tono_original: tono,
                letra_acordes: letraAcordes
            };

            if (tipo === 'cancion' && idCancionRepertorio) {
                objetoUpdate.cancion_id = idCancionRepertorio;
            } else {
                objetoUpdate.cancion_id = null;
            }

            const { error: errorUpdate } = await _supabase
                .from('liturgia')
                .update(objetoUpdate)
                .eq('id', idOrdenEditando);

            if (errorUpdate) throw new Error("Error al actualizar la liturgia: " + errorUpdate.message);

        } else {
            const proximaPosicion = (window.listaLiturgiaActiva ? window.listaLiturgiaActiva.length : 0) + 1;

            const objetoLiturgia = {
                tipo: tipo,
                momento: momento,
                titulo: titulo,
                tono_original: tono,
                letra_acordes: letraAcordes,
                posicion: proximaPosicion
            };

            if (tipo === 'cancion' && idCancionRepertorio) {
                objetoLiturgia.cancion_id = idCancionRepertorio;
            }

            const { error: errorLiturgia } = await _supabase
                .from('liturgia')
                .insert([objetoLiturgia]);

            if (errorLiturgia) throw new Error("Error en liturgia: " + errorLiturgia.message);
        }
        
        closeModal();
        await obtenerRepertorioGlobal();
        await cargarLiturgiaDelDia();

    } catch (error) {
        alert("❌ No se pudo guardar el punto: " + error.message);
        console.error(error);
    } finally {
        if (btnSubmit) {
            btnSubmit.innerText = textoOriginalBtn;
            btnSubmit.disabled = false;
        }
    }
}

// ==========================================
// 9. ACCIONES DE EDICIÓN Y ELIMINACIÓN
// ==========================================

async function abrirEditarModal(idOrden) {
    idOrdenEditando = idOrden;
    
    const { data: registro, error } = await _supabase
        .from('liturgia')
        .select('*')
        .eq('id', idOrden)
        .single();

    if (error || !registro) {
        alert("❌ No se pudieron cargar los datos para editar.");
        return;
    }

    if (typeof abrirModal === 'function') abrirModal(); 
    
    document.getElementById('modalMomento').value = registro.momento || '';
    document.getElementById('modalTipoPunto').value = registro.tipo || 'cancion';

    if (registro.tipo === 'cancion') {
        if (typeof alternarCamposFormulario === 'function') alternarCamposFormulario('cancion');
        document.getElementById('modalTitulo').value = registro.titulo || '';
        document.getElementById('modalTono').value = registro.tono_original || 'C';
        document.getElementById('modalLetra').value = registro.letra_acordes || '';
    } else {
        if (typeof alternarCamposFormulario === 'function') alternarCamposFormulario('general');
        document.getElementById('modalTitulo').value = registro.titulo || '';
        if (document.getElementById('modalComentarios')) {
            document.getElementById('modalComentarios').value = registro.letra_acordes || '';
        }
    }

    const btnSubmit = document.querySelector('#directorForm button[type="submit"]');
    if (btnSubmit) btnSubmit.innerText = "Actualizar Elemento";
}

async function eliminarCancionDelOrden(idOrdenRow, nombrePunto) {
    const confirmar = confirm(`¿Estás seguro de quitar "${nombrePunto}" del orden del día?`);
    if (!confirmar) return;

    const { error } = await _supabase
        .from('liturgia')
        .delete()
        .eq('id', idOrdenRow);

    if (error) {
        alert("❌ No se pudo eliminar: " + error.message);
    } else {
        if (activeSongId === idOrdenRow) activeSongId = null; 
        await cargarLiturgiaDelDia(); 
        if (typeof renderizarCancionActiva === 'function') renderizarCancionActiva();
    }
}

function renderizarListaLiturgia(lista) {
    const items = Array.isArray(lista) ? lista : (window.listaLiturgiaActiva || []);
    const contenedor = document.getElementById('liturgyList') || document.getElementById('listaLiturgia');
    if (!contenedor) return;

    contenedor.innerHTML = '';

    if (!items || items.length === 0) {
        contenedor.innerHTML = `<p class="text-xs text-slate-400 text-center py-6">No hay alabanzas agregadas.</p>`;
        return;
    }

    const esDirector = typeof currentRole !== 'undefined' && currentRole === 'director';

    items.forEach((item, index) => {
        const itemDiv = document.createElement('div');
        const esActivo = activeSongId === item.id;

        itemDiv.className = `p-3 rounded-xl border flex items-center justify-between gap-2 shadow-sm transition my-1.5 ${
            esActivo ? 'bg-indigo-50 border-indigo-400 ring-1 ring-indigo-400' : 'bg-white border-slate-200 hover:border-indigo-300'
        }`;

        const momentoText = item.momento || item.momento_liturgico || item.tipo || 'PUNTO';
        const tituloText = item.titulo || item.nombre || item.cancion || 'Sin título';
        const tonoText = item.tono_original || item.tono || '-';

        itemDiv.innerHTML = `
            <div class="flex-1 cursor-pointer overflow-hidden" onclick="seleccionarElemento(${item.id})">
                <span class="text-[10px] font-bold text-slate-400 uppercase block truncate">${index + 1}. ${momentoText}</span>
                <p class="text-sm font-bold text-slate-800 truncate">${tituloText}</p>
            </div>

            <div class="flex items-center gap-1 shrink-0">
                <span class="text-xs font-bold px-2 py-1 bg-amber-100 text-amber-800 rounded-md">
                    ${tonoText}
                </span>

                ${esDirector ? `
                    <button type="button" onclick="event.stopPropagation(); moverPosicion(${index}, -1)" title="Subir" ${index === 0 ? 'disabled class="opacity-20 cursor-not-allowed text-slate-400 p-1"' : 'class="p-1 text-slate-500 hover:text-indigo-600 transition"'}>
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" />
                        </svg>
                    </button>

                    <button type="button" onclick="event.stopPropagation(); moverPosicion(${index}, 1)" title="Bajar" ${index === items.length - 1 ? 'disabled class="opacity-20 cursor-not-allowed text-slate-400 p-1"' : 'class="p-1 text-slate-500 hover:text-indigo-600 transition"'}>
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
                        </svg>
                    </button>

                    <button type="button" onclick="event.stopPropagation(); abrirEditarModal(${item.id})" title="Editar" class="p-1 text-slate-400 hover:text-amber-600 transition">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                    </button>

                    <button type="button" onclick="event.stopPropagation(); eliminarCancionDelOrden(${item.id}, '${tituloText.replace(/'/g, "\\'")}')" title="Eliminar" class="p-1 text-slate-400 hover:text-rose-600 transition">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                ` : ''}
            </div>
        `;
        contenedor.appendChild(itemDiv);
    });
}

// ==========================================
// 10. TRANSPOSICIÓN Y GUARDADO
// ==========================================

function transpose(delta) {
    const cancion = (window.listaLiturgiaActiva && window.listaLiturgiaActiva.find(c => c.id === activeSongId)) 
                 || (window.cancionesDB && window.cancionesDB.find(c => c.id === activeSongId));
    if (!cancion) return;

    const esCancion = cancion.tipo === 'cancion' || (cancion.tono_original && cancion.tono_original !== '-');
    if (!esCancion) return;

    currentOffset += delta;
    renderizarCancionActiva();
}

async function guardarTransporteActual() {
    const cancion = (window.listaLiturgiaActiva && window.listaLiturgiaActiva.find(c => c.id === activeSongId)) 
                 || (window.cancionesDB && window.cancionesDB.find(c => c.id === activeSongId));
    
    if (!cancion || currentOffset === 0) return;

    const idxOriginal = scale.indexOf(cancion.tono_original);
    if (idxOriginal === -1) return;

    const idxNuevo = (idxOriginal + currentOffset + 12) % 12;
    const nuevoTono = scale[idxNuevo];

    await guardarTonoTransportado(cancion, nuevoTono);
}

async function guardarTonoTransportado(cancion, nuevoTono) {
    if (!cancion) return;
    const confirmar = confirm(`¿Deseas guardar permanentemente el nuevo tono (${nuevoTono}) y actualizar los acordes de "${cancion.titulo}"?`);
    if (!confirmar) return;

    try {
        let letraOriginal = cancion.letra_acordes || "";
        let letraTranspuesta = "";

        if (letraOriginal.includes('[') && letraOriginal.includes(']')) {
            letraTranspuesta = letraOriginal.replace(/\[(.*?)\]/g, (match, chord) => {
                const nuevoAcorde = transposeChord(chord, currentOffset);
                return `[${nuevoAcorde}]`;
            });
        } else {
            let lineas = letraOriginal.split('\n');
            let lineasProcesadas = lineas.map(linea => {
                let lineaLimpia = linea.trim();
                if (lineaLimpia === "" || /^(VERSO|CORO|PUENTE|INTRO|OUTRO|FINAL|ESTROFA|TAG)/i.test(lineaLimpia)) {
                    return linea;
                }

                let palabras = lineaLimpia.split(/\s+/);
                const regValidator = new RegExp(REGEX_ACORDE_STRING, "i");
                let esLineaDeAcordes = palabras.every(palabra => regValidator.test(palabra));

                if (esLineaDeAcordes) {
                    let tokens = linea.split(/(\s+)/); 
                    return tokens.map(token => {
                        if (token.trim() === "") return token; 
                        return transposeChord(token.trim(), currentOffset);
                    }).join('');
                }

                return linea;
            });

            letraTranspuesta = lineasProcesadas.join('\n');
        }

        const { error: errorLiturgia } = await _supabase
            .from('liturgia')
            .update({ 
                tono_original: nuevoTono,
                letra_acordes: letraTranspuesta
            })
            .eq('id', cancion.id);

        if (errorLiturgia) throw errorLiturgia;

        if (cancion.cancion_id) {
            const { error: errorRepertorio } = await _supabase
                .from('canciones')
                .update({ 
                    tono_original: nuevoTono,
                    letra_acordes: letraTranspuesta
                })
                .eq('id', cancion.cancion_id);

            if (errorRepertorio) {
                console.warn("No se pudo actualizar el tono en el repertorio global:", errorRepertorio.message);
            }
        }

        alert(`✅ Tono y acordes guardados exitosamente en ${nuevoTono}.`);

        currentOffset = 0;
        await obtenerRepertorioGlobal();
        await cargarLiturgiaDelDia();

    } catch (error) {
        alert("❌ Error al guardar el nuevo tono y acordes: " + error.message);
        console.error("Error en guardarTonoTransportado:", error);
    }
}

async function vaciarOrdenDelDia() {
    const confirmar1 = confirm("⚠️ ¿Estás seguro de que deseas LIMPIAR TODO el orden del día?\nEsta acción eliminará todas las actividades y cantos programados para hoy.");
    if (!confirmar1) return;

    const confirmar2 = confirm("🚨 ¡Atención! Esta acción no se puede deshacer. ¿Proceder con el borrado completo?");
    if (!confirmar2) return;

    try {
        const { error } = await _supabase
            .from('liturgia')
            .delete()
            .neq('id', 0); 

        if (error) throw error;

        alert("🗑️ El orden del día ha sido vaciado por completo.");
        
        activeSongId = null;
        await cargarLiturgiaDelDia();
        
        if (document.getElementById('songTitle')) document.getElementById('songTitle').innerText = "Selecciona una Alabanza";
        if (document.getElementById('songCategory')) document.getElementById('songCategory').innerText = "-";
        if (document.getElementById('originalTone')) document.getElementById('originalTone').innerText = "-";
        if (document.getElementById('currentTone')) document.getElementById('currentTone').innerText = "-";
        if (document.getElementById('songLyricsContainer')) {
            document.getElementById('songLyricsContainer').innerHTML = "<p class='text-slate-400 text-center py-4'>No hay elemento seleccionado.</p>";
        }

    } catch (error) {
        alert("❌ Error al intentar limpiar la liturgia: " + error.message);
    }
}

// ==========================================
// 11. BIBLIOTECA DE CANTOS Y MODALES
// ==========================================

async function abrirModalBiblioteca() {
    const modal = document.getElementById('modalBiblioteca');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    volverAListaBiblioteca();

    if (!repertorioGlobal || repertorioGlobal.length === 0) {
        await obtenerRepertorioGlobal();
    }

    const inputBuscar = document.getElementById('inputBuscarBiblioteca');
    if (inputBuscar) inputBuscar.value = '';

    renderizarListaBiblioteca(repertorioGlobal);
}

function cerrarModalBiblioteca() {
    const modal = document.getElementById('modalBiblioteca');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function renderizarListaBiblioteca(lista) {
    const contenedor = document.getElementById('listaBibliotecaContainer');
    const badgeTotal = document.getElementById('cantosTotalBadge');
    if (!contenedor) return;

    contenedor.innerHTML = '';

    if (badgeTotal) badgeTotal.innerText = `${lista.length} alabanza(s) disponible(s)`;

    if (!lista || lista.length === 0) {
        contenedor.innerHTML = `<p class="text-xs text-slate-400 text-center py-8">No se encontraron cantos en la base de datos.</p>`;
        return;
    }

    lista.forEach(cancion => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'py-3 flex items-center justify-between gap-3 hover:bg-slate-700/40 px-3 rounded-xl transition cursor-pointer group';
        
        itemDiv.onclick = () => verDetalleCancionBiblioteca(cancion.id);

        const momento = cancion.momento || 'General';
        const tono = cancion.tono_original || '-';

        itemDiv.innerHTML = `
            <div class="flex-1 overflow-hidden">
                <p class="text-sm font-bold text-slate-100 group-hover:text-amber-400 transition truncate">${cancion.titulo}</p>
                <span class="text-[11px] text-indigo-400 font-semibold uppercase">${momento}</span>
            </div>

            <div class="flex items-center gap-3 shrink-0">
                <span class="text-xs font-bold px-2 py-1 bg-amber-500/10 text-amber-300 border border-amber-500/20 rounded-md">
                    ${tono}
                </span>
                <span class="text-slate-500 group-hover:text-slate-300 transition">
                    👉
                </span>
            </div>
        `;

        contenedor.appendChild(itemDiv);
    });
}

function verDetalleCancionBiblioteca(idCancion) {
    const cancion = repertorioGlobal.find(c => c.id === idCancion);
    if (!cancion) return;

    document.getElementById('vistaListaBiblioteca').classList.add('hidden');
    document.getElementById('vistaDetalleBiblioteca').classList.remove('hidden');
    document.getElementById('btnVolverBiblioteca').classList.remove('hidden');

    document.getElementById('tituloModalBiblioteca').innerText = "Detalle del Canto";
    document.getElementById('bibDetalleTitulo').innerText = cancion.titulo;
    document.getElementById('bibDetalleMomento').innerText = cancion.momento || 'General';
    document.getElementById('bibDetalleTono').innerText = cancion.tono_original || '-';

    const contenedorTexto = document.getElementById('bibDetalleContenido');
    let textoMostrar = cancion.letra_acordes || cancion.letra || '';

    const esCantante = (currentRole === 'cantante') || (window.usuarioActual && window.usuarioActual.rol === 'cantante');

    if (esCantante) {
        document.getElementById('bibDetalleTonoContainer').classList.add('hidden');
        textoMostrar = limpiarAcordesParaCantantes(textoMostrar);
    } else {
        document.getElementById('bibDetalleTonoContainer').classList.remove('hidden');
    }

    contenedorTexto.textContent = textoMostrar;
}

function volverAListaBiblioteca() {
    document.getElementById('vistaListaBiblioteca').classList.remove('hidden');
    document.getElementById('vistaDetalleBiblioteca').classList.add('hidden');
    document.getElementById('btnVolverBiblioteca').classList.add('hidden');
    document.getElementById('tituloModalBiblioteca').innerText = "📖 Biblioteca de Alabanzas";
}

function limpiarAcordesParaCantantes(textoConAcordes) {
    if (!textoConAcordes) return '';
    
    let sinCorchetes = textoConAcordes.replace(/\[.*?\]/g, '');

    return sinCorchetes
        .split('\n')
        .filter(linea => {
            let lineaLimpia = linea.trim();
            if (lineaLimpia === "") return true;

            if (/^(VERSO|CORO|PUENTE|INTRO|OUTRO|FINAL|ESTROFA|TAG)/i.test(lineaLimpia)) {
                return true;
            }

            let palabras = lineaLimpia.split(/\s+/);
            const regValidator = new RegExp(REGEX_ACORDE_STRING, "i");
            let esLineaDeAcordes = palabras.every(palabra => regValidator.test(palabra));

            return !esLineaDeAcordes;
        })
        .join('\n');
}

function filtrarBibliotecaCantos() {
    const query = document.getElementById('inputBuscarBiblioteca').value.toLowerCase().trim();

    if (!query) {
        renderizarListaBiblioteca(repertorioGlobal);
        return;
    }

    const filtrados = repertorioGlobal.filter(cancion => {
        const tituloMatch = (cancion.titulo || '').toLowerCase().includes(query);
        const momentoMatch = (cancion.momento || '').toLowerCase().includes(query);
        const tonoMatch = (cancion.tono_original || '').toLowerCase().includes(query);
        return tituloMatch || momentoMatch || tonoMatch;
    });

    renderizarListaBiblioteca(filtrados);
}

// ==========================================
// 12. INICIALIZACIÓN Y PRESENCIA EN TIEMPO REAL
// ==========================================

window.addEventListener('DOMContentLoaded', async () => {
    const transposer = document.getElementById('transposerWidget');
    const director = document.getElementById('directorControls');
    const loginScreen = document.getElementById('loginScreen');
    const btnBib = document.getElementById('btnBiblioteca');
    const btnSalir = document.getElementById('btnCerrarSesion');

    if (transposer) transposer.classList.add('hidden');
    if (director) director.classList.add('hidden');
    if (btnBib) btnBib.classList.add('hidden');
    if (btnSalir) btnSalir.classList.add('hidden');

    console.log("🔍 Verificando sesión activa de Supabase...");
    const { data: { session } } = await _supabase.auth.getSession();

    if (session && session.user) {
        console.log("♻️ Sesión recuperada automáticamente:", session.user.email);
        await obtenerRolUsuario(session.user.id, session.user.email, null);
    } else {
        if (loginScreen) loginScreen.classList.remove('hidden');
        console.log("🚀 Portal listo y esperando autenticación manual...");
    }
});

async function inicializarPresenciaEnLinea() {
    if (!window.usuarioActual) return;

    if (presenceChannel) {
        try {
            await presenceChannel.unsubscribe();
        } catch (e) {
            console.warn("Limpieza de canal anterior:", e);
        }
        presenceChannel = null;
    }

    const sessionKey = `${window.usuarioActual.id}_${Math.random().toString(36).substring(2, 7)}`;

    presenceChannel = _supabase.channel('usuarios_en_linea', {
        config: {
            presence: {
                key: sessionKey
            }
        }
    });

    presenceChannel
        .on('presence', { event: 'sync' }, () => {
            const state = presenceChannel.presenceState();
            usuariosConectados = [];

            for (const key in state) {
                if (Array.isArray(state[key])) {
                    state[key].forEach(u => usuariosConectados.push(u));
                }
            }

            console.log("🟢 Usuarios en línea actualizados:", usuariosConectados);

            const rolActivo = typeof currentRole !== 'undefined' ? currentRole : window.usuarioActual.rol;
            if (rolActivo === 'director') {
                renderizarUsuariosEnLinea();
            }
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await presenceChannel.track({
                    id: window.usuarioActual.id,
                    nombre: window.usuarioActual.nombre || 'Usuario',
                    email: window.usuarioActual.email,
                    rol: window.usuarioActual.rol,
                    totalIngresos: window.usuarioActual.totalIngresos || 1,
                    onlineAt: new Date().toISOString()
                });
            }
        });
}

function renderizarUsuariosEnLinea() {
    const contenedor = document.getElementById('listaUsuariosEnLinea');
    if (!contenedor) return;

    const listaMostrar = (window.usuariosDB && window.usuariosDB.length > 0) 
        ? window.usuariosDB 
        : usuariosConectados;

    if (!listaMostrar || listaMostrar.length === 0) {
        contenedor.innerHTML = `<p class="text-xs text-slate-400 italic">No hay usuarios en línea...</p>`;
        return;
    }

    const idsConectados = new Set((usuariosConectados || []).map(u => u.id));

    const usuariosOrdenados = [...listaMostrar].sort((a, b) => {
        const aConectado = idsConectados.has(a.id);
        const bConectado = idsConectados.has(b.id);

        if (aConectado === bConectado) {
            return (a.nombre || a.email || '').localeCompare(b.nombre || b.email || '');
        }
        return bConectado - aConectado;
    });

    contenedor.innerHTML = usuariosOrdenados.map(u => {
        const estaEnLinea = idsConectados.has(u.id);

        const colorPunto = estaEnLinea ? 'bg-emerald-500 shadow-sm' : 'bg-slate-300';
        const colorTexto = estaEnLinea ? 'font-medium text-slate-700' : 'text-slate-400';

        return `
            <div class="flex items-center justify-between py-1 px-2 hover:bg-slate-50 rounded-lg transition text-xs">
                <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full ${colorPunto} flex-shrink-0"></span>
                    <span class="${colorTexto}">${u.nombre || u.email}</span>
                </div>
                <div class="flex items-center gap-1.5">
                    <span class="bg-indigo-50 text-indigo-700 border border-indigo-100 text-[10px] font-bold px-1.5 py-0.5 rounded-md" title="Total de ingresos al portal">
                        ${u.totalIngresos || u.accesos || 1} accesos
                    </span>
                    <span class="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">
                        ${u.rol || 'MIEMBRO'}
                    </span>
                </div>
            </div>
        `;
    }).join('');
}

async function registrarIngresoUsuario(userId) {
    try {
        const { data: perfil, error: errSelect } = await _supabase
            .from('perfiles')
            .select('total_ingresos')
            .eq('id', userId)
            .single();

        if (errSelect) throw errSelect;

        const nuevoConteo = (perfil.total_ingresos || 0) + 1;

        const { error: errUpdate } = await _supabase
            .from('perfiles')
            .update({ total_ingresos: nuevoConteo })
            .eq('id', userId);

        if (errUpdate) throw errUpdate;

        console.log(`📊 Contador de accesos actualizado: ${nuevoConteo} ingresos.`);
        return nuevoConteo;

    } catch (e) {
        console.warn("No se pudo actualizar el contador de ingresos:", e.message);
        return null;
    }
}

// ==========================================
// 13. EXPORTACIÓN DE DOCUMENTOS (PDF)
// ==========================================

function exportarCancionPDF() {
    const contenedorOriginal = document.getElementById('contenedorExportablePDF') 
                               || document.querySelector('main section:last-child');
    const tituloElemento = document.getElementById('songTitle');
    const tituloCancion = tituloElemento ? tituloElemento.innerText.trim() : 'Alabanza';

    if (!contenedorOriginal || tituloCancion === 'Selecciona una Alabanza') {
        alert("⚠️ No hay ninguna canción seleccionada para exportar.");
        return;
    }

    const clon = contenedorOriginal.cloneNode(true);

    const elementosAOcultar = clon.querySelectorAll('#transposerWidget, #btnExportarPDF, #btnGuardarTono, #accionesPDF, button');
    elementosAOcultar.forEach(el => el.remove());

    clon.style.backgroundColor = '#ffffff';
    clon.style.color = '#000000';
    clon.style.padding = '12px';
    clon.style.width = '100%';
    clon.style.boxSizing = 'border-box';

    const lyricsContainer = clon.querySelector('#songLyricsContainer');
    if (lyricsContainer) {
        lyricsContainer.style.backgroundColor = '#ffffff';
        lyricsContainer.style.color = '#000000';
        lyricsContainer.style.border = '1px solid #cbd5e1';
        lyricsContainer.style.borderRadius = '8px';
        lyricsContainer.style.padding = '12px';
        lyricsContainer.style.fontSize = '10.5pt'; 
        lyricsContainer.style.lineHeight = '1.35';
        lyricsContainer.style.fontFamily = 'monospace, Courier, sans-serif'; 
        lyricsContainer.style.whiteSpace = 'pre-wrap';
    }

    const todosLosElementos = clon.querySelectorAll('*');
    todosLosElementos.forEach(el => {
        el.className = el.className.replace(/text-[a-z0-9-]+/g, '');

        if (el.tagName === 'SPAN' && (el.innerText.trim().length <= 4 || el.classList.contains('chord'))) {
            el.style.color = '#1e3a8a'; 
            el.style.fontWeight = 'bold';
        } else {
            el.style.color = '#0f172a'; 
        }
    });

    const opciones = {
        margin:        [8, 8, 8, 8],
        filename:      `${tituloCancion.replace(/[^a-zA-Z0-9_-]/g, '_')}_Acordes.pdf`,
        image:         { type: 'jpeg', quality: 0.98 },
        html2canvas:   { scale: 2, useCORS: true, logging: false },
        jsPDF:         { unit: 'mm', format: 'letter', orientation: 'portrait' },
        pagebreak:     { mode: ['avoid-all', 'css', 'legacy'] }
    };

    const btnPDF = document.getElementById('btnExportarPDF');
    const textoOriginal = btnPDF ? btnPDF.innerHTML : '';
    if (btnPDF) {
        btnPDF.innerText = "Generando PDF...";
        btnPDF.disabled = true;
    }

    html2pdf().set(opciones).from(clon).save().then(() => {
        if (btnPDF) {
            btnPDF.innerHTML = textoOriginal;
            btnPDF.disabled = false;
        }
    }).catch(err => {
        console.error("Error al exportar PDF:", err);
        alert("❌ Error al generar el PDF.");
        if (btnPDF) {
            btnPDF.innerHTML = textoOriginal;
            btnPDF.disabled = false;
        }
    });
}

function exportarBibliotecaPDF() {
    const contenedorOriginal = document.getElementById('vistaDetalleBiblioteca');
    const tituloElemento = document.getElementById('bibDetalleTitulo');
    const tituloCancion = tituloElemento ? tituloElemento.innerText.trim() : 'Alabanza_Biblioteca';

    if (!contenedorOriginal) return;

    const clon = contenedorOriginal.cloneNode(true);

    const botones = clon.querySelectorAll('button');
    botones.forEach(b => b.remove());

    clon.style.backgroundColor = '#ffffff';
    clon.style.color = '#000000';
    clon.style.padding = '15px';

    const textoContenido = clon.querySelector('#bibDetalleContenido');
    if (textoContenido) {
        textoContenido.style.color = '#000000';
        textoContenido.style.fontSize = '12px';
        textoContenido.style.lineHeight = '1.4';
    }

    const opciones = {
        margin:       [8, 10, 8, 10],
        filename:     `${tituloCancion.replace(/[^a-zA-Z0-9_-]/g, '_')}_Acordes.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true },
        jsPDF:        { unit: 'mm', format: 'letter', orientation: 'portrait' },
        pagebreak:    { mode: 'avoid-all' }
    };

    html2pdf().set(opciones).from(clon).save();
}

function obtenerTeclasCalculadas(acorde) {
    const NOTAS_MAP = { "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11 };
    
    let [base, bajo] = acorde.split('/');
    let t = base.replace('m', '');
    let root = NOTAS_MAP[t] !== undefined ? NOTAS_MAP[t] : 0;
    
    let esMenor = base.includes('m') && !base.includes('maj');
    let tercera = (root + (esMenor ? 3 : 4)) % 12;
    let quinta = (root + 7) % 12;
    
    let bassKey = bajo && NOTAS_MAP[bajo] !== undefined ? NOTAS_MAP[bajo] : null;

    return { keys: [root, tercera, quinta], bassKey: bassKey };
}