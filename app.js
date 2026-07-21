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
let currentRole = 'musico';
let currentOffset = 0; 
let idOrdenEditando = null; // Control para saber si editamos o insertamos
let repertorioGlobal = []; // Biblioteca permanente de canciones

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

    // ==========================================
    // NUEVO: Ocultar login y actualizar usuario
    // ==========================================
    document.getElementById('loginScreen').classList.add('hidden');
    
    // Mostrar el badge de usuario si estaba oculto
    const userInfoBadge = document.getElementById('userInfo');
    if (userInfoBadge) userInfoBadge.classList.remove('hidden');

    // Actualizar el texto del nombre
    await mostrarUsuarioActual();

    // Obtener rol y continuar flujo
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
        alert(`⚠️ ¡Atención! Tu usuario (${userEmail}) se autenticó con éxito, pero NO está registrado en la tabla 'perfiles'.`);
        if(btnSubmit && btnSubmit.disabled) {
            btnSubmit.innerText = "Ingresar al Portal";
            btnSubmit.disabled = false;
        }
        return;
    }

    console.log(`✨ Bienvenido ${perfil.nombre}. Rol detectado: ${perfil.rol}`);
    changeRole(perfil.rol);
    
    const selector = document.getElementById('roleSelector');
    if (selector) {
        selector.value = perfil.rol;
        selector.disabled = true; 
    }

    document.getElementById('loginScreen').classList.add('hidden');
    
    // Carga inicial de datos al entrar con éxito
    await obtenerRepertorioGlobal();
    await cargarLiturgiaDelDia();
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

    // Limpiar el estado de la aplicación
    cancionesDB = [];
    repertorioGlobal = [];
    activeSongId = null;
    idLiturgiaActiva = null;
    currentOffset = 0;

    // Limpiar elementos visuales del DOM
    document.getElementById('liturgyList').innerHTML = "<p class='text-slate-400 text-xs p-2 text-center animate-pulse'>Esperando inicio de sesión...</p>";
    document.getElementById('songTitle').innerText = "Selecciona una Alabanza";
    document.getElementById('songCategory').innerText = "-";
    document.getElementById('originalTone').innerText = "-";
    document.getElementById('currentTone').innerText = "-";
    document.getElementById('songLyricsContainer').innerHTML = "<p class='text-slate-400 text-center py-4'>Inicia sesión para visualizar las letras.</p>";

    const selector = document.getElementById('roleSelector');
    if (selector) selector.disabled = false;

    document.getElementById('transposerWidget').classList.add('hidden');
    document.getElementById('directorControls').classList.add('hidden');

    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) {
        loginScreen.classList.remove('hidden');
        document.getElementById('loginEmail').value = "";
        document.getElementById('loginPassword').value = "";
        
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

        cancionesDB = data || [];
        renderizarListaLiturgia();

    } catch (error) {
        console.error("Error al descargar la liturgia de Supabase:", error.message);
    }
}

async function obtenerRepertorioGlobal() {
    try {
        const { data, error } = await _supabase
            .from('canciones')
            .select('*')
            .order('titulo', { ascending: true });

        if (error) throw error;
        
        repertorioGlobal = data;
        
        const selectRepertorio = document.getElementById('modalBuscarRepertorio');
        if (selectRepertorio) {
            selectRepertorio.innerHTML = '<option value="">-- Selecciona una canción existente para reutilizarla --</option>';
            data.forEach(cancion => {
                const opt = document.createElement('option');
                opt.value = cancion.id;
                opt.innerText = `[${cancion.tono_original}] ${cancion.titulo} (${cancion.momento})`;
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
    document.getElementById('modalMomento').value = cancionSeleccionada.momento;
}

// ==========================================
// 5. RENDERIZADO DE LA INTERFAZ
// ==========================================
function renderizarListaLiturgia() {
    const contenedor = document.getElementById('liturgyList'); 
    if (!contenedor) return;

    contenedor.innerHTML = "";

    if (cancionesDB.length === 0) {
        contenedor.innerHTML = "<p class='text-slate-400 text-xs p-4 text-center'>No hay cantos en la liturgia de hoy.</p>";
        return;
    }

    cancionesDB.forEach((elemento, index) => {
        const esActivo = elemento.id === activeSongId;
        const claseActiva = esActivo ? 'border-2 border-indigo-500 bg-indigo-50/50' : 'border-slate-200 bg-white hover:bg-slate-50';
        
        const esCancion = elemento.tipo === 'cancion';
        const tonoVisual = esCancion ? elemento.tono_original : '-';

        const wrapper = document.createElement('div');
        wrapper.className = `group relative w-full flex items-center gap-2 mb-2`;

        const btn = document.createElement('button');
        btn.className = `flex-1 text-left p-4 rounded-xl border ${claseActiva} transition flex justify-between items-center`;
        btn.onclick = () => seleccionarElemento(elemento.id);
        
        btn.innerHTML = `
            <div>
                <span class="text-xs font-bold ${esActivo ? 'text-indigo-600' : 'text-slate-400'} block">${index + 1}. ${elemento.momento.toUpperCase()}</span>
                <span class="font-semibold text-slate-800">${elemento.titulo}</span>
            </div>
            <span class="text-xs ${esCancion ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-700'} py-1 px-2 rounded font-mono font-bold">${tonoVisual}</span>
        `;
        wrapper.appendChild(btn);

        if (currentRole === 'director') {
            const actionsDiv = document.createElement('div');
            actionsDiv.className = "flex items-center gap-1 ml-1";

            const btnEditar = document.createElement('button');
            btnEditar.className = "p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition";
            btnEditar.title = "Editar punto";
            btnEditar.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
            `;
            btnEditar.onclick = (e) => {
                e.stopPropagation();
                abrirEditarModal(elemento.id);
            };
            actionsDiv.appendChild(btnEditar);

            const btnEliminar = document.createElement('button');
            btnEliminar.className = "p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition";
            btnEliminar.title = "Quitar del orden";
            btnEliminar.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
            `;
            btnEliminar.onclick = (e) => {
                e.stopPropagation(); 
                eliminarCancionDelOrden(elemento.id, elemento.titulo);
            };
            actionsDiv.appendChild(btnEliminar);

            wrapper.appendChild(actionsDiv);
        }

        contenedor.appendChild(wrapper);
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
    const cancion = cancionesDB.find(c => c.id === activeSongId);
    if (!cancion) {
        document.getElementById('songLyricsContainer').innerHTML = "<p class='text-slate-400'>No hay elemento seleccionado.</p>";
        return;
    }

    document.getElementById('songTitle').innerText = cancion.titulo;
    document.getElementById('songCategory').innerText = cancion.momento;
    document.getElementById('originalTone').innerText = cancion.tono_original;

    const esCancion = cancion.tipo === 'cancion';

    // Determinar el tono actual transportado
    let tonoCalculado = cancion.tono_original;
    if (esCancion && cancion.tono_original !== "-") {
        const idxOriginal = scale.indexOf(cancion.tono_original);
        if (idxOriginal !== -1) {
            const idxActual = (idxOriginal + currentOffset + 12) % 12;
            tonoCalculado = scale[idxActual];
        }
        document.getElementById('currentTone').innerText = tonoCalculado;
    } else {
        document.getElementById('currentTone').innerText = "-";
    }

    // Mostrar u ocultar el botón de "Guardar Nuevo Tono" si hubo cambios
    let btnGuardarTono = document.getElementById('btnGuardarTono');
    if (esCancion && currentOffset !== 0 && (currentRole === 'director' || currentRole === 'musico')) {
        if (!btnGuardarTono) {
            const widget = document.getElementById('transposerWidget');
            if (widget) {
                btnGuardarTono = document.createElement('button');
                btnGuardarTono.id = 'btnGuardarTono';
                btnGuardarTono.className = "ml-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-1.5 px-3 rounded-lg transition shadow-sm flex items-center gap-1 animate-pulse";
                btnGuardarTono.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                    </svg>
                    Guardar Tono (${tonoCalculado})
                `;
                btnGuardarTono.onclick = () => guardarTonoTransportado(cancion, tonoCalculado);
                widget.appendChild(btnGuardarTono);
            }
        } else {
            btnGuardarTono.innerText = `Guardar Tono (${tonoCalculado})`;
            btnGuardarTono.onclick = () => guardarTonoTransportado(cancion, tonoCalculado);
            btnGuardarTono.classList.remove('hidden');
        }
    } else if (btnGuardarTono) {
        btnGuardarTono.classList.add('hidden');
    }

    let textoFinal = cancion.letra_acordes || "";

    if (esCancion) {
        // VISTA CANTANTE (SIN ACORDES)
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

            let resultadoCantante = lineasSoloLetra.join('\n').replace(/\n{3,}/g, '\n\n');
            document.getElementById('songLyricsContainer').innerHTML = resultadoCantante;

        } else {
            // VISTA MÚSICOS Y DIRECTOR (CON ACORDES)
            if (textoFinal.includes('[') && textoFinal.includes(']')) {
                textoFinal = textoFinal.replace(/\[(.*?)\]/g, (match, chord) => {
                    const transpuerto = transposeChord(chord, currentOffset);
                    return `<span class="text-amber-400 font-bold font-mono">${transpuerto}</span>`;
                });
                document.getElementById('songLyricsContainer').innerHTML = textoFinal;
            } else {
                let lineas = textoFinal.split('\n');
                let resultadoLineas = lineas.map(linea => {
                    if (linea.trim() === "" || linea.toUpperCase().includes("VERSO") || linea.toUpperCase().includes("CORO")) {
                        return linea;
                    }

                    let tokens = linea.split(/(\s+)/); 
                    let lineaProcesada = tokens.map(token => {
                        if (token.trim() === "") return token; 
                        
                        let esAcorde = /^[A-G]([#b])?(m|min|maj|dim|aug)?\d*(\/[A-G]([#b])?)?$/.test(token.trim());
                        
                        if (esAcorde) {
                            let transpuerto = transposeChord(token.trim(), currentOffset);
                            return `<span class="text-amber-400 font-bold font-mono">${transpuerto}</span>`;
                        }
                        return token; 
                    }).join('');

                    return lineaProcesada;
                });

                document.getElementById('songLyricsContainer').innerHTML = resultadoLineas.join('\n');
            }
        }
    } else {
        document.getElementById('songLyricsContainer').innerHTML = `
            <div class="bg-slate-800/50 border border-slate-700/60 rounded-2xl p-6 mt-2">
                <div class="flex items-center gap-2 text-indigo-400 font-semibold text-sm mb-3 uppercase tracking-wider">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Notas e Indicaciones Litúrgicas
                </div>
                <p class="text-slate-200 text-base leading-relaxed whitespace-pre-line font-sans">${textoFinal}</p>
            </div>
        `;
    }
}


function transportar(direccion) {
    const cancion = cancionesDB.find(c => c.id === activeSongId);
    if (!cancion || cancion.tipo !== 'cancion') return;

    if (direccion === '+') {
        currentOffset = (currentOffset + 1) % 12;
    } else if (direccion === '-') {
        currentOffset = (currentOffset - 1 + 12) % 12;
    }

    renderizarCancionActiva();
}

function transpose(direccion) {
    if (direccion === 1) {
        transportar('+');
    } else if (direccion === -1) {
        transportar('-');
    }
}

// ==========================================
// 7. CONTROL DE ROLES
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

    const modal = document.getElementById('directorModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function abrirModal() { 
    const modal = document.getElementById('directorModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

fn = closeModal = () => {
    const modal = document.getElementById('directorModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
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
        document.getElementById('modalTitulo').placeholder = "Ej: Oración Inicial o Bienvenida";
        if (txtLetra) txtLetra.required = false;
    } else {
        if (seccionCancion) {
            seccionCancion.classList.remove('hidden');
            seccionCancion.classList.add('block');
        }
        if (seccionGeneral) seccionGeneral.classList.add('hidden');
        if (labelTitulo) labelTitulo.innerText = "Nombre de la Alabanza";
        document.getElementById('modalTitulo').placeholder = "Ej: Gracia sublime es";
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
                    // 1. Insertar la canción nueva en la biblioteca global de canciones
                    const { data: nuevaCancion, error: errorRepertorio } = await _supabase
                        .from('canciones')
                        .insert([{
                            titulo: titulo,
                            tono_original: tono,
                            letra_acordes: letraAcordes
                        }])
                        .select();

                    if (errorRepertorio) throw new Error("Error en repertorio: " + errorRepertorio.message);
                    
                    // Aseguramos la extracción estricta del ID numérico generado por Supabase
                    if (nuevaCancion && nuevaCancion.length > 0) {
                        idCancionRepertorio = parseInt(nuevaCancion[0].id, 10);
                    } else {
                        throw new Error("Supabase insertó la canción pero no retornó el ID.");
                    }
                } else {
                    idCancionRepertorio = parseInt(existeEnRepertorio.id, 10);
                }
            }
        } else {
            letraAcordes = document.getElementById('modalComentarios').value;
        }

        // ==========================================
        // GUARDADO O ACTUALIZACIÓN EN LA LITURGIA
        // ==========================================
        if (idOrdenEditando) {
            // MODO EDICIÓN
            const objetoUpdate = {
                tipo: tipo,
                momento: momento,
                titulo: titulo,
                tono_original: tono,
                letra_acordes: letraAcordes
            };

            // Solo añadimos el cancion_id si es una canción válida y tiene un número real
            if (tipo === 'cancion' && idCancionRepertorio) {
                objetoUpdate.cancion_id = idCancionRepertorio;
            } else {
                objetoUpdate.cancion_id = null; // Si pasó a ser un punto general, limpiamos la llave foránea
            }

            const { error: errorUpdate } = await _supabase
                .from('liturgia')
                .update(objetoUpdate)
                .eq('id', idOrdenEditando);

            if (errorUpdate) throw new Error("Error al actualizar la liturgia: " + errorUpdate.message);
            console.log("✏️ Registro actualizado exitosamente.");

        } else {
            // MODO NUEVO REGISTRO
            const { count, error: errorConteo } = await _supabase
                .from('liturgia')
                .select('*', { count: 'exact', head: true });
                
            if (errorConteo) throw errorConteo;
            const proximaPosicion = (count || 0) + 1;

            const objetoLiturgia = {
                tipo: tipo,
                momento: momento,
                titulo: titulo,
                tono_original: tono,
                letra_acordes: letraAcordes,
                posicion: proximaPosicion
            };

            // Solo añadimos el cancion_id si es una canción válida
            if (tipo === 'cancion' && idCancionRepertorio) {
                objetoLiturgia.cancion_id = idCancionRepertorio;
            }

            const { error: errorLiturgia } = await _supabase
                .from('liturgia')
                .insert([objetoLiturgia]);

            if (errorLiturgia) throw new Error("Error en liturgia: " + errorLiturgia.message);
            console.log("🚀 Nuevo registro guardado exitosamente.");
        }
        
        // Limpieza y refresco completo de la UI
        closeModal();
        document.getElementById('directorForm').reset();
        idOrdenEditando = null; 
        
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

async function abrirEditarModal(idOrden) {
    idOrdenEditando = idOrden;
    
    const { data: registro, error } = await _supabase
        .from('liturgia')
        .select('*')
        .eq('id', idOrden)
        .single();

    if (error || !registro) {
        alert("No se pudieron cargar los datos para editar.");
        return;
    }

    abrirModal(); 
    document.getElementById('modalMomento').value = registro.momento;
    document.getElementById('modalTipoPunto').value = registro.tipo;

    if (registro.tipo === 'cancion') {
        alternarCamposFormulario('cancion');
        document.getElementById('modalTitulo').value = registro.titulo;
        document.getElementById('modalTono').value = registro.tono_original;
        document.getElementById('modalLetra').value = registro.letra_acordes;
    } else {
        alternarCamposFormulario('general');
        document.getElementById('modalTitulo').value = registro.titulo;
        document.getElementById('modalComentarios').value = registro.letra_acordes;
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
        alert("🗑️ Elemento removido con éxito.");
        activeSongId = null; 
        await cargarLiturgiaDelDia(); 
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
    const { data: { session }, error } = await _supabase.auth.getSession();

    if (session && session.user) {
        console.log("♻️ Sesión recuperada automáticamente:", session.user.email);
        await obtenerRolUsuario(session.user.id, session.user.email, null);
    } else {
        if (loginScreen) loginScreen.classList.remove('hidden');
        console.log("🚀 Portal listo y esperando autenticación manual...");
    }
});

async function vaciarOrdenDelDia() {
    // 1. Primera advertencia
    const confirmar1 = confirm("⚠️ ¿Estás seguro de que deseas LIMPIAR TODO el orden del día?\nEsta acción eliminará todas las actividades y cantos programados para hoy.");
    if (!confirmar1) return;

    // 2. Confirmación de seguridad extra
    const confirmar2 = confirm("🚨 ¡Atención! Esta acción no se puede deshacer. ¿Proceder con el borrado completo?");
    if (!confirmar2) return;

    try {
        // Ejecuta un delete sin filtros condicionales para vaciar la tabla 'liturgia'
        // Nota: Si usas RLS en Supabase, asegúrate de que el rol tenga permisos de DELETE.
        const { error } = await _supabase
            .from('liturgia')
            .delete()
            .neq('id', 0); // Un truco común en Supabase para indicarle que borre todo (donde el id no sea 0)

        if (error) throw error;

        alert("🗑️ El orden del día ha sido vaciado por completo.");
        
        // 3. Resetear estados visuales y recargar interfaz
        activeSongId = null;
        await cargarLiturgiaDelDia();
        
        // Dejar el panel derecho limpio
        document.getElementById('songTitle').innerText = "Selecciona una Alabanza";
        document.getElementById('songCategory').innerText = "-";
        document.getElementById('originalTone').innerText = "-";
        document.getElementById('currentTone').innerText = "-";
        document.getElementById('songLyricsContainer').innerHTML = "<p class='text-slate-400 text-center py-4'>No hay elemento seleccionado.</p>";

    } catch (error) {
        alert("❌ Error al intentar limpiar la liturgia: " + error.message);
        console.error("Error en vaciarOrdenDelDia:", error);
    }
}

async function guardarTonoTransportado(cancion, nuevoTono) {
    const confirmar = confirm(`¿Deseas guardar permanentemente el nuevo tono (${nuevoTono}) y actualizar los acordes de "${cancion.titulo}"?`);
    if (!confirmar) return;

    try {
        let letraOriginal = cancion.letra_acordes || "";
        let letraTranspuesta = "";

        // 1. Si la letra usa el formato de corchetes [C#m]
        if (letraOriginal.includes('[') && letraOriginal.includes(']')) {
            letraTranspuesta = letraOriginal.replace(/\[(.*?)\]/g, (match, chord) => {
                const nuevoAcorde = transposeChord(chord, currentOffset);
                return `[${nuevoAcorde}]`;
            });
        } else {
            // 2. Si la letra usa el formato con acordes sobre las líneas
            let lineas = letraOriginal.split('\n');
            let lineasProcesadas = lineas.map(linea => {
                // Conservar títulos o líneas vacías
                if (linea.trim() === "" || /^(VERSO|CORO|PUENTE|INTRO|OUTRO|FINAL|ESTROFA)/i.test(linea.trim())) {
                    return linea;
                }

                let tokens = linea.split(/(\s+)/); 
                return tokens.map(token => {
                    if (token.trim() === "") return token; 
                    
                    let esAcorde = /^[A-G]([#b])?(m|min|maj|dim|aug)?\d*(\/[A-G]([#b])?)?$/i.test(token.trim());
                    if (esAcorde) {
                        return transposeChord(token.trim(), currentOffset);
                    }
                    return token; 
                }).join('');
            });

            letraTranspuesta = lineasProcesadas.join('\n');
        }

        // 3. Actualizar la tabla liturgia (orden del día) con el nuevo tono y la letra con los nuevos acordes
        const { error: errorLiturgia } = await _supabase
            .from('liturgia')
            .update({ 
                tono_original: nuevoTono,
                letra_acordes: letraTranspuesta
            })
            .eq('id', cancion.id);

        if (errorLiturgia) throw errorLiturgia;

        // 4. Si la canción existe en la biblioteca global 'canciones', actualizarla también
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

        // 5. Resetear el offset de transposición visual y recargar los datos
        currentOffset = 0;
        await obtenerRepertorioGlobal();
        await cargarLiturgiaDelDia();

    } catch (error) {
        alert("❌ Error al guardar el nuevo tono y acordes: " + error.message);
        console.error("Error en guardarTonoTransportado:", error);
    }
}
async function mostrarUsuarioActual() {
    try {
        const userDisplay = document.getElementById('userNameDisplay');
        if (!userDisplay) return;

        // Opción A: Intentar obtener usuario desde Supabase
        let usuarioEmail = "";
        if (typeof _supabase !== 'undefined') {
            const { data: { user } } = await _supabase.auth.getUser();
            if (user) {
                usuarioEmail = user.user_metadata?.full_name || user.email;
            }
        }

        // Opción B: Respaldo en localStorage si no hay sesión de Supabase activa
        if (!usuarioEmail) {
            usuarioEmail = localStorage.getItem('usuarioLogueado') || localStorage.getItem('userEmail') || "";
        }

        // Mostrar el usuario formateado o un texto genérico
        if (usuarioEmail) {
            const nombreLimpio = usuarioEmail.split('@')[0]; // Toma la parte antes del @
            userDisplay.innerText = nombreLimpio.charAt(0).toUpperCase() + nombreLimpio.slice(1);
        } else {
            userDisplay.innerText = "Usuario Activo";
        }
    } catch (error) {
        console.error("Error cargando nombre de usuario:", error);
        document.getElementById('userNameDisplay').innerText = "Usuario";
    }
}

async function mostrarUsuarioActual() {
    try {
        const userDisplay = document.getElementById('userNameDisplay');
        if (!userDisplay) return;

        // 1. Obtener la sesión activa del usuario
        const { data: { user } } = await _supabase.auth.getUser();

        if (user) {
            // Option A: Si el nombre se guardó en los metadatos de autenticación (User Metadata)
            if (user.user_metadata && user.user_metadata.nombre) {
                userDisplay.innerText = user.user_metadata.nombre;
                return;
            }

            // Option B: Consultar la tabla de usuarios/perfiles en la BD por su ID
            const { data: perfil, error } = await _supabase
                .from('perfiles') // <-- Reemplaza 'usuarios' por el nombre exacto de tu tabla de perfiles si es distinto
                .select('nombre') // <-- Reemplaza 'nombre' por la columna donde guardas el nombre real
                .eq('id', user.id)
                .single();

            if (perfil && perfil.nombre) {
                userDisplay.innerText = perfil.nombre;
            } else if (user.email) {
                // Respaldo por si aún no tiene un nombre registrado en la BD
                userDisplay.innerText = user.email.split('@')[0];
            }
        } else {
            userDisplay.innerText = "Usuario Activo";
        }
    } catch (err) {
        console.error("Error al obtener nombre de usuario:", err);
        document.getElementById('userNameDisplay').innerText = "Usuario";
    }
}

// ==========================================================
// INICIALIZACIÓN DE LA APP AL CARGAR LA PÁGINA (REFRESCO)
// ==========================================================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Verificar si ya existe una sesión activa en Supabase
        const { data: { session } } = await _supabase.auth.getSession();
        
        if (session) {
            // 1. Ocultar la pantalla de login si el usuario ya está autenticado
            const loginScreen = document.getElementById('loginScreen');
            if (loginScreen) loginScreen.classList.add('hidden');

            // 2. Mostrar el badge del usuario
            const userInfoBadge = document.getElementById('userInfo');
            if (userInfoBadge) userInfoBadge.classList.remove('hidden');

            // 3. Cargar el nombre del usuario logueado
            await mostrarUsuarioActual();

            // 4. Cargar rol y datos de la app (ajusta según las funciones de tu app)
            if (typeof obtenerRolUsuario === 'function') {
                await obtenerRolUsuario(session.user.id, session.user.email);
            }
        }
    } catch (err) {
        console.error("Error al inicializar la sesión:", err);
    }
});