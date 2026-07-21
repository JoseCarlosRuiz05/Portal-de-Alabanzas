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
window.listaLiturgiaActiva = [];

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

    await obtenerRolUsuario(data.user.id, data.user.email, btnSubmit);
}

async function obtenerRolUsuario(userId, userEmail, btnSubmit) {
    let { data: perfil, error } = await _supabase
        .from('perfiles')
        .select('rol, nombre')
        .eq('id', userId)
        .maybeSingle(); 

    if (error) {
        alert("❌ Error al consultar la tabla perfiles: " + error.message);
        if(btnSubmit && btnSubmit.disabled) {
            btnSubmit.innerText = "Ingresar al Portal";
            btnSubmit.disabled = false;
        }
        return;
    }

    if (!perfil) {
        alert(`⚠️ Tu usuario (${userEmail}) no está registrado en la tabla 'perfiles'.`);
        if(btnSubmit && btnSubmit.disabled) {
            btnSubmit.innerText = "Ingresar al Portal";
            btnSubmit.disabled = false;
        }
        return;
    }

    console.log(`✨ Bienvenido ${perfil.nombre}. Rol detectado: ${perfil.rol}`);
    
    // Mostrar nombre en badge si existe el elemento
    const lblUser = document.getElementById('userNameDisplay');
    if (lblUser) lblUser.innerText = perfil.nombre || userEmail;

    changeRole(perfil.rol);
    
    const selector = document.getElementById('roleSelector');
    if (selector) {
        selector.value = perfil.rol;
        selector.disabled = true; 
    }

    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) loginScreen.classList.add('hidden');
    
    await obtenerRepertorioGlobal();
    await cargarLiturgiaDelDia();
    suscribirACambiosLiturgia(); // Suscripción a cambios en vivo
}

async function cerrarSesion() {
    const confirmar = confirm("¿Estás seguro de que deseas cerrar sesión?");
    if (!confirmar) return;

    const { error } = await _supabase.auth.signOut();

    if (error) {
        alert("❌ Error al cerrar sesión: " + error.message);
        return;
    }

    console.log("🔒 Sesión finalizada con éxito.");

    cancionesDB = [];
    repertorioGlobal = [];
    window.listaLiturgiaActiva = [];
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

    const selector = document.getElementById('roleSelector');
    if (selector) selector.disabled = false;

    const transposer = document.getElementById('transposerWidget');
    if (transposer) transposer.classList.add('hidden');
    
    const directorControls = document.getElementById('directorControls');
    if (directorControls) directorControls.classList.add('hidden');

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
        // CORRECCIÓN CRÍTICA: Se mantiene la ordenación por posición
        const { data, error } = await _supabase
            .from('liturgia')
            .select('*')
            .order('posicion', { ascending: true });

        if (error) throw error;

        window.listaLiturgiaActiva = data || [];
        renderizarListaLiturgia(window.listaLiturgiaActiva);

        // Si ya hay una canción activa, mantener actualizada su vista
        if (activeSongId) {
            renderizarCancionActiva();
        }

    } catch (err) {
        console.error("Error al cargar la liturgia:", err);
    }
}

// Escuchar cambios en vivo para mantener a todos los dispositivos sincronizados
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

function renderizarListaLiturgia(lista) {
    const items = Array.isArray(lista) ? lista : (window.listaLiturgiaActiva || []);
    const contenedor = document.getElementById('liturgyList') || document.getElementById('listaLiturgia');
    if (!contenedor) return;

    contenedor.innerHTML = '';

    if (!items || items.length === 0) {
        contenedor.innerHTML = `<p class="text-xs text-slate-400 text-center py-6">No hay alabanzas agregadas.</p>`;
        return;
    }

    const esDirector = currentRole === 'director';

    items.forEach((item, index) => {
        const itemDiv = document.createElement('div');
        const esActivo = activeSongId === item.id;
        
        itemDiv.className = `p-3 rounded-xl border flex items-center justify-between gap-2 shadow-sm transition my-1.5 ${
            esActivo ? 'bg-indigo-50 border-indigo-400 ring-1 ring-indigo-400' : 'bg-white border-slate-200 hover:border-indigo-300'
        }`;

        const momentoText = item.momento || item.momento_liturgico || 'PUNTO';
        const tituloText = item.titulo || item.nombre || 'Sin título';
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
    const match = chord.match(/^([A-G]#?|b?)(.*)$/);
    if (!match) return chord;
    let root = match[1];
    let suffix = match[2];

    if (root.endsWith('b')) {
        const idx = scale.indexOf(root.charAt(0));
        root = scale[(idx - 1 + 12) % 12];
    }

    const currentIndex = scale.indexOf(root);
    if (currentIndex === -1) return chord;

    const newIndex = (currentIndex + steps + 12) % 12;
    return scale[newIndex] + suffix;
}

function renderizarCancionActiva() {
    const cancion = window.listaLiturgiaActiva.find(c => c.id === activeSongId) || cancionesDB.find(c => c.id === activeSongId);
    
    if (!cancion) {
        document.getElementById('songLyricsContainer').innerHTML = "<p class='text-slate-400 text-center py-6'>Selecciona un punto o alabanza de la lista para ver el detalle.</p>";
        document.getElementById('songTitle').innerText = "Selecciona una Alabanza";
        document.getElementById('songCategory').innerText = "-";
        document.getElementById('originalTone').innerText = "-";
        document.getElementById('currentTone').innerText = "-";
        
        // Ocultar botón de guardar si no hay canción seleccionada
        const btnGuardar = document.getElementById('btnGuardarTono');
        if (btnGuardar) btnGuardar.classList.add('hidden');
        return;
    }

    document.getElementById('songTitle').innerText = cancion.titulo;
    document.getElementById('songCategory').innerText = cancion.momento || "General";
    document.getElementById('originalTone').innerText = cancion.tono_original || "-";

    const esCancion = cancion.tipo === 'cancion' || (cancion.tono_original && cancion.tono_original !== '-');

    let tonoCalculado = cancion.tono_original || "-";
    if (esCancion && tonoCalculado !== "-") {
        const idxOriginal = scale.indexOf(cancion.tono_original);
        if (idxOriginal !== -1) {
            const idxActual = (idxOriginal + currentOffset + 12) % 12;
            tonoCalculado = scale[idxActual];
        }
        document.getElementById('currentTone').innerText = tonoCalculado;
    } else {
        document.getElementById('currentTone').innerText = "-";
    }

    // ==========================================
    // CONTROL DE VISIBILIDAD DEL BOTÓN GUARDAR
    // ==========================================
    const btnGuardar = document.getElementById('btnGuardarTono');
    if (btnGuardar) {
        // Solo se muestra si:
        // 1. Es director
        // 2. El punto actual es una alabanza (esCancion)
        // 3. Se modificó la nota (currentOffset !== 0)
        const seCambioNota = currentOffset !== 0;
        
        if (currentRole === 'director' && esCancion && seCambioNota) {
            btnGuardar.classList.remove('hidden');
        } else {
            btnGuardar.classList.add('hidden');
        }
    }

    let textoFinal = cancion.letra_acordes || "";

    if (esCancion) {
        if (currentRole === 'cantante') {
            textoFinal = textoFinal.replace(/\[.*?\]/g, '');

            let lineas = textoFinal.split('\n');
            let lineasSoloLetra = lineas.filter(linea => {
                let lineaLimpia = linea.trim();
                if (lineaLimpia === "") return true;

                if (/^(VERSO|CORO|PUENTE|INTRO|OUTRO|FINAL|ESTROFA)/i.test(lineaLimpia)) {
                    return true;
                }

                let palabras = lineaLimpia.split(/\s+/);
                let esLineaDeAcordes = palabras.every(palabra => 
                    /^[A-G]([#b])?(m|min|maj|dim|aug)?\d*(\/[A-G]([#b])?)?$/i.test(palabra)
                );

                return !esLineaDeAcordes;
            });

            document.getElementById('songLyricsContainer').innerHTML = `<pre class="font-sans whitespace-pre-wrap text-slate-100">${lineasSoloLetra.join('\n')}</pre>`;

        } else {
            if (textoFinal.includes('[') && textoFinal.includes(']')) {
                textoFinal = textoFinal.replace(/\[(.*?)\]/g, (match, chord) => {
                    const transpuerto = transposeChord(chord, currentOffset);
                    return `<span class="text-amber-400 font-bold font-mono px-0.5">${transpuerto}</span>`;
                });
                document.getElementById('songLyricsContainer').innerHTML = `<pre class="font-mono whitespace-pre-wrap text-slate-100">${textoFinal}</pre>`;
            } else {
                let lineas = textoFinal.split('\n');
                let resultadoLineas = lineas.map(linea => {
                    if (linea.trim() === "" || /^(VERSO|CORO|PUENTE|INTRO|OUTRO|FINAL|ESTROFA)/i.test(linea.trim())) {
                        return `<span class="text-indigo-300 font-bold">${linea}</span>`;
                    }

                    let tokens = linea.split(/(\s+)/); 
                    return tokens.map(token => {
                        if (token.trim() === "") return token; 
                        let esAcorde = /^[A-G]([#b])?(m|min|maj|dim|aug)?\d*(\/[A-G]([#b])?)?$/.test(token.trim());
                        
                        if (esAcorde) {
                            let transpuerto = transposeChord(token.trim(), currentOffset);
                            return `<span class="text-amber-400 font-bold font-mono">${transpuerto}</span>`;
                        }
                        return token; 
                    }).join('');
                });

                document.getElementById('songLyricsContainer').innerHTML = `<pre class="font-mono whitespace-pre-wrap text-slate-100">${resultadoLineas.join('\n')}</pre>`;
            }
        }
    } else {
        document.getElementById('songLyricsContainer').innerHTML = `
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
// 7. CONTROL DE ROLES Y REORDENAMIENTO
// ==========================================

function changeRole(role) {
    currentRole = role;
    
    const transposer = document.getElementById('transposerWidget');
    const director = document.getElementById('directorControls');

    if (transposer) transposer.classList.toggle('hidden', role === 'cantante');
    if (director) director.classList.toggle('hidden', role !== 'director');

    renderizarListaLiturgia();
    renderizarCancionActiva();
}

async function moverPosicion(index, direccion) {
    let lista = window.listaLiturgiaActiva;
    const nuevoIndex = index + direccion;

    if (nuevoIndex < 0 || nuevoIndex >= lista.length) return;

    // Swapping local
    const temp = lista[index];
    lista[index] = lista[nuevoIndex];
    lista[nuevoIndex] = temp;

    // Actualizar números de posición localmente
    lista.forEach((item, idx) => item.posicion = idx + 1);

    renderizarListaLiturgia(lista);

    // Persistir cambios en Supabase
    try {
        for (let i = 0; i < lista.length; i++) {
            await _supabase
                .from('liturgia')
                .update({ posicion: i + 1 })
                .eq('id', lista[i].id);
        }
    } catch (err) {
        console.error("Error al reordenar la liturgia:", err);
    }
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
    // CORRECCIÓN: Resetear el formulario e ID de edición al cerrar
    idOrdenEditando = null;
    const form = document.getElementById('directorForm');
    if (form) form.reset();
}

function abrirEditarModal(id) {
    const item = window.listaLiturgiaActiva.find(i => i.id === id);
    if (!item) return;

    idOrdenEditando = id;

    const tipo = item.tipo || (item.tono_original && item.tono_original !== '-' ? 'cancion' : 'general');
    
    document.getElementById('modalTipoPunto').value = tipo;
    document.getElementById('modalMomento').value = item.momento || '';
    document.getElementById('modalTitulo').value = item.titulo || '';

    alternarCamposFormulario(tipo);

    if (tipo === 'cancion') {
        document.getElementById('modalTono').value = item.tono_original || 'C';
        document.getElementById('modalLetra').value = item.letra_acordes || '';
        if (item.cancion_id && document.getElementById('modalBuscarRepertorio')) {
            document.getElementById('modalBuscarRepertorio').value = item.cancion_id;
        }
    } else {
        if (document.getElementById('modalComentarios')) {
            document.getElementById('modalComentarios').value = item.letra_acordes || '';
        }
    }

    const btnSubmit = document.querySelector('#directorForm button[type="submit"]');
    if (btnSubmit) btnSubmit.innerText = "Actualizar Elemento";

    abrirModal();
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
                            letra_acordes: letraAcordes,
                            momento: momento
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
// 8. ACCIONES DE EDICIÓN Y ELIMINACIÓN
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

// ==========================================
// 9. EVENTOS DE INICIALIZACIÓN
// ==========================================

window.addEventListener('DOMContentLoaded', async () => {
    const transposer = document.getElementById('transposerWidget');
    const director = document.getElementById('directorControls');
    const loginScreen = document.getElementById('loginScreen');

    if (transposer) transposer.classList.add('hidden');
    if (director) director.classList.add('hidden');

    console.log("🔍 Verificando sesión activa de Supabase...");
    const { data: { session } } = await _supabase.auth.getSession();

    if (session && session.user) {
        console.log("♻️ Sesión recuperada automáticamente:", session.user.email);
        if (typeof obtenerRolUsuario === 'function') {
            await obtenerRolUsuario(session.user.id, session.user.email, null);
        }
    } else {
        if (loginScreen) loginScreen.classList.remove('hidden');
        console.log("🚀 Portal listo y esperando autenticación manual...");
    }
});

// ==========================================
// 10. ADMINISTRACIÓN Y BORRADO MASIVO
// ==========================================

async function vaciarOrdenDelDia() {
    const confirmar1 = confirm("⚠️ ¿Estás seguro de que deseas LIMPIAR TODO el orden del día?\nEsta acción eliminará todas las actividades y cantos programados para hoy.");
    if (!confirmar1) return;

    const confirmar2 = confirm("🚨 ¡Atención! Esta acción no se puede deshacer. ¿Proceder con el borrado completo?");
    if (!confirmar2) return;

    try {
        const { error } = await _supabase
            .from('liturgia')
            .delete()
            .neq('id', 0); // Elimina todos los registros

        if (error) throw error;

        alert("🗑️ El orden del día ha sido vaciado por completo.");
        
        // Resetear estados visuales y recargar interfaz
        activeSongId = null;
        await cargarLiturgiaDelDia();
        
        // Limpiar el panel derecho (vista activa)
        if (document.getElementById('songTitle')) document.getElementById('songTitle').innerText = "Selecciona una Alabanza";
        if (document.getElementById('songCategory')) document.getElementById('songCategory').innerText = "-";
        if (document.getElementById('originalTone')) document.getElementById('originalTone').innerText = "-";
        if (document.getElementById('currentTone')) document.getElementById('currentTone').innerText = "-";
        if (document.getElementById('songLyricsContainer')) {
            document.getElementById('songLyricsContainer').innerHTML = "<p class='text-slate-400 text-center py-4'>No hay elemento seleccionado.</p>";
        }

    } catch (error) {
        alert("❌ Error al intentar limpiar la liturgia: " + error.message);
        console.error("Error en vaciarOrdenDelDia:", error);
    }
}

// Mantener alias para compatibilidad si alguna vista usa el nombre antiguo
const limpiarTodaLaLiturgia = vaciarOrdenDelDia;

// ==========================================
// 11. TRANSPOSICIÓN PERMANENTE Y GUARDADO BD
// ==========================================

async function guardarTonoTransportado(cancion, nuevoTono) {
    if (!cancion) return;
    const confirmar = confirm(`¿Deseas guardar permanentemente el nuevo tono (${nuevoTono}) y actualizar los acordes de "${cancion.titulo}"?`);
    if (!confirmar) return;

    try {
        let letraOriginal = cancion.letra_acordes || "";
        let letraTranspuesta = "";

        // 1. Formato con corchetes [C#m]
        if (letraOriginal.includes('[') && letraOriginal.includes(']')) {
            letraTranspuesta = letraOriginal.replace(/\[(.*?)\]/g, (match, chord) => {
                const nuevoAcorde = typeof transposeChord === 'function' ? transposeChord(chord, currentOffset) : chord;
                return `[${nuevoAcorde}]`;
            });
        } else {
            // 2. Formato con acordes sobre texto
            let lineas = letraOriginal.split('\n');
            let lineasProcesadas = lineas.map(linea => {
                if (linea.trim() === "" || /^(VERSO|CORO|PUENTE|INTRO|OUTRO|FINAL|ESTROFA)/i.test(linea.trim())) {
                    return linea;
                }

                let tokens = linea.split(/(\s+)/); 
                return tokens.map(token => {
                    if (token.trim() === "") return token; 
                    
                    let esAcorde = /^[A-G]([#b])?(m|min|maj|dim|aug)?\d*(\/[A-G]([#b])?)?$/i.test(token.trim());
                    if (esAcorde && typeof transposeChord === 'function') {
                        return transposeChord(token.trim(), currentOffset);
                    }
                    return token; 
                }).join('');
            });

            letraTranspuesta = lineasProcesadas.join('\n');
        }

        // 3. Actualizar la tabla liturgia
        const { error: errorLiturgia } = await _supabase
            .from('liturgia')
            .update({ 
                tono_original: nuevoTono,
                letra_acordes: letraTranspuesta
            })
            .eq('id', cancion.id);

        if (errorLiturgia) throw errorLiturgia;

        // 4. Si la canción está en el repertorio global, actualizarla también
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

        // 5. Resetear offset y recargar
        currentOffset = 0;
        if (typeof obtenerRepertorioGlobal === 'function') await obtenerRepertorioGlobal();
        await cargarLiturgiaDelDia();

    } catch (error) {
        alert("❌ Error al guardar el nuevo tono y acordes: " + error.message);
        console.error("Error en guardarTonoTransportado:", error);
    }
}

// ==========================================
// 12. GESTIÓN DE PERFIL Y USUARIO MOSTRADO
// ==========================================

async function mostrarUsuarioActual() {
    try {
        const userDisplay = document.getElementById('userNameDisplay');
        if (!userDisplay) return;

        const { data: { user } } = await _supabase.auth.getUser();

        if (user) {
            if (user.user_metadata && user.user_metadata.nombre) {
                userDisplay.innerText = user.user_metadata.nombre;
                return;
            }

            const { data: perfil } = await _supabase
                .from('perfiles')
                .select('nombre')
                .eq('id', user.id)
                .single();

            if (perfil && perfil.nombre) {
                userDisplay.innerText = perfil.nombre;
            } else if (user.email) {
                const nombreLimpio = user.email.split('@')[0];
                userDisplay.innerText = nombreLimpio.charAt(0).toUpperCase() + nombreLimpio.slice(1);
            }
        } else {
            userDisplay.innerText = "Usuario Activo";
        }
    } catch (err) {
        console.error("Error al obtener nombre de usuario:", err);
        const userDisplay = document.getElementById('userNameDisplay');
        if (userDisplay) userDisplay.innerText = "Usuario";
    }
}

// ==========================================
// 13. REORDENAMIENTO OPTIMIZADO Y RENDERIZADO
// ==========================================

async function moverPosicion(index, direccion) {
    let lista = window.listaLiturgiaActiva || [];
    const nuevoIndex = index + direccion;

    if (nuevoIndex < 0 || nuevoIndex >= lista.length) return;

    // Swapping local inmediato
    const temp = lista[index];
    lista[index] = lista[nuevoIndex];
    lista[nuevoIndex] = temp;

    window.listaLiturgiaActiva = lista;
    renderizarListaLiturgia(lista);

    // Persistencia asíncrona optimizada (Promesas en paralelo)
    try {
        const promesasActualizacion = lista.map((item, i) => 
            _supabase
                .from('liturgia')
                .update({ posicion: i + 1 })
                .eq('id', item.id)
        );
        
        await Promise.all(promesasActualizacion);
    } catch (err) {
        console.error("Error al guardar la nueva posición en DB:", err);
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
// CONTROL DE TRANSPOSICIÓN (+ / -)
// ==========================================

function transpose(delta) {
    // 1. Verificar si hay una canción seleccionada
    const cancion = window.listaLiturgiaActiva.find(c => c.id === activeSongId) || cancionesDB.find(c => c.id === activeSongId);
    
    if (!cancion) {
        console.warn("No hay alabanza seleccionada para transportar.");
        return;
    }

    // 2. Si es un punto general (sin tono original), no hace nada
    const esCancion = cancion.tipo === 'cancion' || (cancion.tono_original && cancion.tono_original !== '-');
    if (!esCancion) return;

    // 3. Modificar el desplazamiento (offset) en semitonos
    currentOffset += delta;

    // 4. Redibujar la canción en pantalla con los nuevos acordes y actualizar el botón guardar
    renderizarCancionActiva();
}

// ==========================================
// GUARDAR TONO TRANSPORTADO EN LA BD
// ==========================================

async function guardarTransporteActual() {
    const cancion = window.listaLiturgiaActiva.find(c => c.id === activeSongId) || cancionesDB.find(c => c.id === activeSongId);
    
    if (!cancion || currentOffset === 0) return;

    // Calcular la nueva nota basada en el offset actual
    const idxOriginal = scale.indexOf(cancion.tono_original);
    if (idxOriginal === -1) return;

    const idxNuevo = (idxOriginal + currentOffset + 12) % 12;
    const nuevoTono = scale[idxNuevo];

    // Llamar a tu función existente de guardado
    await guardarTonoTransportado(cancion, nuevoTono);
}

function mostrarDetalleItem(item) {
    itemSeleccionado = item;

    document.getElementById('songTitle').innerText = item.titulo;
    document.getElementById('songCategory').innerText = item.momento || 'Liturgia';

    const transposerWidget = document.getElementById('transposerWidget');
    const btnGuardar = document.getElementById('btnGuardarTono');
    btnGuardar.classList.add('hidden'); // Ocultar por defecto

    if (item.tipo === 'general') {
        // Puntos generales no usan transposición
        transposerWidget.classList.add('hidden');
        document.getElementById('originalTone').innerText = '-';
        document.getElementById('songLyricsContainer').innerText = item.comentarios || 'Sin contenido';
    } else {
        // Es una canción/alabanza
        if (currentRole !== 'cantante') {
            transposerWidget.classList.remove('hidden');
        }

        const tonoBase = item.tono_base || 'C';
        document.getElementById('originalTone').innerText = tonoBase;
        document.getElementById('currentTone').innerText = tonoBase;

        // Sincronizar índices de la escala
        originalToneIndex = SCALE.indexOf(tonoBase);
        if (originalToneIndex === -1) originalToneIndex = 0;
        currentToneIndex = originalToneIndex;

        // Renderizar acordes
        document.getElementById('songLyricsContainer').innerHTML = transponerTexto(item.letra, tonoBase, tonoBase);
    }
}

function transponerTexto(texto, tonoOrigen, tonoDestino) {
    if (!texto) return '';
    
    const idxOrigen = SCALE.indexOf(tonoOrigen);
    const idxDestino = SCALE.indexOf(tonoDestino);
    
    if (idxOrigen === -1 || idxDestino === -1) return texto;

    // Calcular la diferencia de semitonos
    const semitonos = (idxDestino - idxOrigen + 12) % 12;

    // Regex para buscar notas dentro de corchetes [C#m7], [G/B], etc.
    return texto.replace(/\[([A-G][#b]?)([^\]]*)\]/g, (match, notaRaiz, complemento) => {
        let idxNota = SCALE.indexOf(notaRaiz);
        if (idxNota === -1) return match;

        let nuevaNotaIdx = (idxNota + semitonos) % 12;
        let nuevaNota = SCALE[nuevaNotaIdx];

        // Retorna con formato Tailwind para destacar los acordes visualmente
        return `<span class="text-amber-400 font-bold">[${nuevaNota}${complemento}]</span>`;
    });
}