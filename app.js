(function(){
"use strict";

var LOC_KEY = "fichajes_device_sede_v1";
var ADMIN_PW_KEY = "fichajes_admin_pw_v1";
var AVATAR_COLORS = ["#3B5BA5","#6B4FA0","#2F8F9D","#9A6B3F","#5C6BC0","#4C8577","#8A5A83","#4A7BA6"];

var STATE = { company:"Fichajes", sedes:[], employees:[], history:[], adminProtected:false };
var connOk = null; // null = todavía no se sabe, true/false tras el primer intento
var pendingPunches = {};

var UI = {
  tab: "fichar",
  histFilters: { empleado:"", sede:"", desde:"", hasta:"", q:"" },
  editingEmployee: null,
  confirmAction: null,
  loginPrompt: false
};

/* ---------------- utilidades ---------------- */
function todayStr(d){
  d = d || new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
function fmtDate(iso){ return new Date(iso).toLocaleDateString("es-ES", {day:"2-digit", month:"2-digit", year:"numeric"}); }
function fmtTime(iso){ return new Date(iso).toLocaleTimeString("es-ES", {hour:"2-digit", minute:"2-digit"}); }
function fmtDur(ms){
  var totalMin = Math.round(ms/60000);
  var h = Math.floor(totalMin/60), m = totalMin%60;
  return h + "h " + String(m).padStart(2,"0") + "m";
}
function initials(name){
  var parts = (name||"").trim().split(/\s+/).filter(Boolean);
  if(parts.length===0) return "?";
  if(parts.length===1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0]+parts[parts.length-1][0]).toUpperCase();
}
function colorFor(id){
  id = id || "x";
  var h=0; for(var i=0;i<id.length;i++){ h = (h*31 + id.charCodeAt(i))>>>0; }
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function esc(s){
  return String(s==null?"":s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function getDeviceSede(){ try{ return localStorage.getItem(LOC_KEY) || ""; }catch(e){ return ""; } }
function setDeviceSede(v){ try{ localStorage.setItem(LOC_KEY, v); }catch(e){} }

function employeeById(id){ return STATE.employees.find(function(e){return e.id===id;}); }
function historyForAsc(empId){
  return STATE.history.filter(function(h){return h.employeeId===empId;})
    .sort(function(a,b){ return new Date(a.timestamp) - new Date(b.timestamp); });
}
function hoursTodayFor(empId, dateStr){
  var recs = historyForAsc(empId).filter(function(h){ return todayStr(new Date(h.timestamp))===dateStr; });
  var total=0, openSince=null;
  recs.forEach(function(r){
    if(r.type==="in"){ openSince = new Date(r.timestamp); }
    else if(r.type==="out" && openSince){ total += (new Date(r.timestamp) - openSince); openSince=null; }
  });
  var running=false;
  if(openSince && dateStr===todayStr()){ total += (Date.now()-openSince); running=true; }
  return {ms: total, running: running};
}

/* ---------------- red ---------------- */
async function loadState(){
  var r = await fetch("/api/state", {cache:"no-store"});
  if(!r.ok) throw new Error("bad_response");
  STATE = await r.json();
  connOk = true;
}

async function adminFetch(url, opts){
  opts = opts || {};
  opts.headers = opts.headers || {};
  var pw = null;
  try{ pw = localStorage.getItem(ADMIN_PW_KEY); }catch(e){}
  if(pw) opts.headers["x-admin-password"] = pw;
  var r;
  try{ r = await fetch(url, opts); }
  catch(e){ showToast("Sin conexión con el servidor.", "out"); return null; }
  if(r.status === 401){
    UI.loginPrompt = true; render();
    showToast("Introduce la contraseña de administrador para guardar cambios.", "out");
    return null;
  }
  if(!r.ok){ showToast("Ocurrió un error. Inténtalo de nuevo.", "out"); return null; }
  return r;
}

async function tryAdminLogin(password){
  var r;
  try{
    r = await fetch("/api/admin/login", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({password:password}) });
  }catch(e){ showToast("Sin conexión con el servidor.", "out"); return; }
  if(r.ok){
    try{ localStorage.setItem(ADMIN_PW_KEY, password); }catch(e){}
    UI.loginPrompt = false;
    showToast("Acceso concedido. Repite la acción que querías hacer.", "in");
    render();
  } else {
    showToast("Contraseña incorrecta.", "out");
  }
}

/* ---------------- fichar ---------------- */
async function toggleEmployee(id){
  if(pendingPunches[id]) return;
  var emp = employeeById(id);
  if(!emp) return;
  var prevStatus = emp.status, prevSince = emp.since;
  var newType = emp.status === "in" ? "out" : "in";
  var nowIso = new Date().toISOString();
  var optimistic = { id:"tmp-"+Date.now(), employeeId:id, name:emp.name, type:newType, timestamp:nowIso, location:getDeviceSede() };
  emp.status = newType; emp.since = nowIso;
  STATE.history.unshift(optimistic);
  pendingPunches[id] = true;
  showToast((newType==="in"?"Entrada":"Salida")+" registrada — "+emp.name+" · "+fmtTime(nowIso), newType);
  render();
  try{
    var r = await fetch("/api/punch", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({employeeId:id, location:getDeviceSede()}) });
    if(!r.ok) throw new Error("fail");
    var data = await r.json();
    optimistic.id = data.record.id;
    optimistic.timestamp = data.record.timestamp;
    emp.since = data.record.timestamp;
    connOk = true;
  }catch(e){
    emp.status = prevStatus; emp.since = prevSince;
    STATE.history = STATE.history.filter(function(h){ return h!==optimistic; });
    showToast("No se pudo guardar el fichaje: revisa la conexión e inténtalo de nuevo.", "out");
    connOk = false;
  }finally{
    delete pendingPunches[id];
    render();
  }
}

async function deleteHistoryRecord(id){
  var r = await adminFetch("/api/history/"+encodeURIComponent(id), {method:"DELETE"});
  if(r){ await loadState(); showToast("Registro eliminado.","in"); render(); }
}

async function saveEmployee(data){
  var url = data.id ? "/api/employees/"+encodeURIComponent(data.id) : "/api/employees";
  var method = data.id ? "PUT" : "POST";
  var body = { name:data.name, sede:data.sede };
  if(data.photo !== undefined) body.photo = data.photo;
  var r = await adminFetch(url, { method:method, headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
  if(r){ await loadState(); showToast("Guardado.","in"); render(); }
}
async function deleteEmployee(id){
  var r = await adminFetch("/api/employees/"+encodeURIComponent(id), {method:"DELETE"});
  if(r){ await loadState(); showToast("Trabajador eliminado.","in"); render(); }
}
async function addSede(name){
  name = (name||"").trim();
  if(!name) return;
  var r = await adminFetch("/api/sedes", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({name:name}) });
  if(r){ await loadState(); render(); }
}
async function renameSede(oldName, newName){
  newName = (newName||"").trim();
  if(!newName || newName===oldName) return;
  var r = await adminFetch("/api/sedes/"+encodeURIComponent(oldName), { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({newName:newName}) });
  if(r){ if(getDeviceSede()===oldName) setDeviceSede(newName); await loadState(); render(); }
}
async function deleteSede(name){
  var r = await adminFetch("/api/sedes/"+encodeURIComponent(name), {method:"DELETE"});
  if(r){ await loadState(); render(); }
}

/* ---------------- CSV ---------------- */
function buildCsv(){
  var recs = filteredHistory().slice().sort(function(a,b){ return new Date(a.timestamp)-new Date(b.timestamp); });
  var lines = ["Trabajador;Tipo;Fecha;Hora;Sede"];
  recs.forEach(function(h){
    lines.push([h.name, h.type==="in"?"Entrada":"Salida", fmtDate(h.timestamp), fmtTime(h.timestamp), h.location||""].map(function(v){
      return '"'+String(v).replace(/"/g,'""')+'"';
    }).join(";"));
  });
  return lines.join("\r\n");
}
function exportCsv(){
  var csv = "﻿" + buildCsv();
  var blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = "fichajes_"+todayStr()+".csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  showToast("Descargando CSV…", "in");
}

/* ---------------- toast ---------------- */
function showToast(msg, kind){
  var wrap = document.getElementById("toast-wrap");
  var el = document.createElement("div");
  el.className = "toast" + (kind ? " "+kind : "");
  el.innerHTML = '<span class="dot"></span><span></span>';
  el.querySelector("span:last-child").textContent = msg;
  wrap.appendChild(el);
  setTimeout(function(){ el.style.opacity="0"; el.style.transition="opacity .25s"; setTimeout(function(){ el.remove(); }, 260); }, 3200);
}

/* ---------------- render ---------------- */
function avatarHtml(emp){
  if(emp.photo){ return '<img class="avatar" src="'+emp.photo+'" alt="" />'; }
  var c = colorFor(emp.id);
  return '<div class="avatar" style="background:'+c+'">'+esc(initials(emp.name))+'</div>';
}
function tabBtn(id,label){ return '<button data-tab="'+id+'" class="'+(UI.tab===id?"active":"")+'">'+label+'</button>'; }

function renderHeader(){
  var now = new Date();
  var timeStr = now.toLocaleTimeString("es-ES", {hour:"2-digit", minute:"2-digit", second:"2-digit"});
  var dateStr = now.toLocaleDateString("es-ES", {weekday:"long", day:"numeric", month:"long"});
  var sede = getDeviceSede() || "Sin ubicación";
  var connClass = connOk===true ? "live" : connOk===false ? "down" : "";
  var connTitle = connOk===true ? "Conectado" : connOk===false ? "Sin conexión con el servidor" : "Conectando…";
  return ''+
  '<header class="top">'+
    '<div class="brand">'+
      '<div class="mark">'+esc((STATE.company||"F").slice(0,1))+'</div>'+
      '<div><div class="name">'+esc(STATE.company||"Fichajes")+'</div>'+
      '<button class="sede-tag" id="sede-tag-btn" title="Cambiar la ubicación de esta pantalla">📍 '+esc(sede)+'</button></div>'+
    '</div>'+
    '<nav class="tabs">'+tabBtn("fichar","Fichar")+tabBtn("historial","Historial")+tabBtn("config","Configuración")+'</nav>'+
    '<div class="clock"><div class="time"><span class="conn-dot '+connClass+'" title="'+connTitle+'"></span> '+timeStr+'</div><div class="date">'+esc(dateStr)+'</div></div>'+
  '</header>';
}

function renderFichar(){
  var emps = STATE.employees.slice().sort(function(a,b){return a.name.localeCompare(b.name,"es");});
  var inCount = emps.filter(function(e){return e.status==="in";}).length;
  var outCount = emps.length - inCount;
  if(emps.length===0){
    return '<div class="kiosk-head"><div><h1>Fichar</h1><p>Toca tu foto o nombre para registrar entrada o salida.</p></div></div>'+
      '<div class="empty-state panel panel-pad"><h2>Todavía no hay trabajadores</h2><p>Añádelos desde la pestaña «Configuración».</p></div>';
  }
  var cards = emps.map(function(e){
    var statusLabel = e.status==="in" ? "Dentro" : e.status==="out" ? "Fuera" : "Sin fichar hoy";
    var sinceLabel = "";
    if(e.since){
      var sameDay = todayStr(new Date(e.since))===todayStr();
      sinceLabel = (e.status==="in"?"Desde ":"Hasta ") + (sameDay?"":fmtDate(e.since)+" ") + fmtTime(e.since);
    }
    var pending = pendingPunches[e.id];
    return '<div class="emp-card '+e.status+'">'+
      '<button class="emp-btn" data-toggle="'+e.id+'" '+(pending?"disabled":"")+'>'+
        avatarHtml(e)+
        '<div class="emp-name">'+esc(e.name)+'</div>'+
        '<div class="emp-status '+e.status+'">'+statusLabel+'</div>'+
        (sinceLabel ? '<div class="emp-since">'+sinceLabel+'</div>' : '')+
        (e.sede ? '<div class="emp-loc">'+esc(e.sede)+'</div>' : '')+
      '</button></div>';
  }).join("");
  return ''+
  '<div class="kiosk-head"><div><h1>Fichar</h1><p>Toca tu foto o nombre para registrar entrada o salida.</p></div>'+
    '<div class="kiosk-counts"><span class="count-pill in"><span class="dot"></span>'+inCount+' dentro</span>'+
    '<span class="count-pill out"><span class="dot"></span>'+outCount+' fuera</span></div></div>'+
  '<div class="emp-grid">'+cards+'</div>';
}

function filteredHistory(){
  var f = UI.histFilters;
  return STATE.history.filter(function(h){
    if(f.empleado && h.employeeId!==f.empleado) return false;
    if(f.sede && h.location!==f.sede) return false;
    if(f.desde && todayStr(new Date(h.timestamp)) < f.desde) return false;
    if(f.hasta && todayStr(new Date(h.timestamp)) > f.hasta) return false;
    if(f.q && (h.name||"").toLowerCase().indexOf(f.q.toLowerCase())===-1) return false;
    return true;
  }).sort(function(a,b){ return new Date(b.timestamp)-new Date(a.timestamp); });
}

function renderHistorial(){
  var f = UI.histFilters;
  var recs = filteredHistory();
  var today = todayStr();
  var empOptions = STATE.employees.slice().sort(function(a,b){return a.name.localeCompare(b.name,"es");})
    .map(function(e){return '<option value="'+e.id+'" '+(f.empleado===e.id?"selected":"")+'>'+esc(e.name)+'</option>';}).join("");
  var sedeOptions = STATE.sedes.map(function(s){return '<option value="'+esc(s)+'" '+(f.sede===s?"selected":"")+'>'+esc(s)+'</option>';}).join("");

  var summaryEmps = STATE.employees.slice().sort(function(a,b){return a.name.localeCompare(b.name,"es");});
  var summary = summaryEmps.map(function(e){
    var d = hoursTodayFor(e.id, today);
    if(d.ms===0 && e.status!=="in") return "";
    return '<div class="summary-card '+(d.running?"active-now":"")+'">'+avatarHtml(e)+
      '<div><div class="who">'+esc(e.name)+'</div><div class="hrs">'+fmtDur(d.ms)+' hoy'+(d.running?" · en curso":"")+'</div></div></div>';
  }).join("");

  var rows = recs.map(function(h){
    return '<tr><td>'+esc(h.name)+'</td>'+
      '<td><span class="type-chip '+h.type+'">'+(h.type==="in"?"Entrada":"Salida")+'</span></td>'+
      '<td class="mono">'+fmtDate(h.timestamp)+'</td><td class="mono">'+fmtTime(h.timestamp)+'</td>'+
      '<td>'+esc(h.location||"—")+'</td>'+
      '<td><button class="row-del" data-del-hist="'+h.id+'" title="Eliminar" aria-label="Eliminar">✕</button></td></tr>';
  }).join("");

  return ''+
  '<div class="kiosk-head"><div><h1>Historial</h1><p>'+recs.length+' registros'+(recs.length!==STATE.history.length?" (filtrados de "+STATE.history.length+")":"")+'</p></div>'+
    '<button class="btn btn-accent" id="btn-export">⬇ Exportar CSV</button></div>'+
  (summary ? '<div class="summary-grid">'+summary+'</div>' : '')+
  '<div class="panel panel-pad">'+
    '<div class="filters-row">'+
      '<div class="field"><label>Trabajador</label><select id="f-empleado"><option value="">Todos</option>'+empOptions+'</select></div>'+
      '<div class="field"><label>Sede</label><select id="f-sede"><option value="">Todas</option>'+sedeOptions+'</select></div>'+
      '<div class="field"><label>Desde</label><input type="date" id="f-desde" value="'+f.desde+'"></div>'+
      '<div class="field"><label>Hasta</label><input type="date" id="f-hasta" value="'+f.hasta+'"></div>'+
      '<div class="field"><label>Buscar</label><input type="text" id="f-q" placeholder="Nombre…" value="'+esc(f.q)+'"></div>'+
      '<button class="btn btn-ghost btn-sm" id="f-clear">Limpiar</button>'+
    '</div>'+
    '<div class="table-scroll"><table class="history"><thead><tr><th>Trabajador</th><th>Tipo</th><th>Fecha</th><th>Hora</th><th>Sede</th><th></th></tr></thead>'+
    '<tbody>'+(rows || '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px;">Sin registros con estos filtros.</td></tr>')+'</tbody></table></div>'+
  '</div>';
}

function renderConfig(){
  var emps = STATE.employees.slice().sort(function(a,b){return a.name.localeCompare(b.name,"es");});
  var empRows = emps.map(function(e){
    return '<div class="emp-row">'+avatarHtml(e)+
      '<div class="meta"><div class="n">'+esc(e.name)+'</div><div class="s">'+esc(e.sede||"Sin sede asignada")+' · '+(e.status==="in"?"Dentro":e.status==="out"?"Fuera":"Sin fichar")+'</div></div>'+
      '<div class="actions"><button class="btn btn-ghost btn-sm" data-edit-emp="'+e.id+'">Editar</button><button class="btn btn-danger btn-sm" data-del-emp="'+e.id+'">Eliminar</button></div></div>';
  }).join("") || '<p style="color:var(--muted);font-size:13.5px;">Aún no hay trabajadores.</p>';

  var sedeRows = STATE.sedes.map(function(s){
    var count = STATE.employees.filter(function(e){return e.sede===s;}).length;
    return '<div class="sede-row"><span class="n">'+esc(s)+'</span><span class="badge-count">'+count+' persona(s)</span>'+
      '<button class="btn btn-ghost btn-sm" data-rename-sede="'+esc(s)+'">Renombrar</button>'+
      '<button class="btn btn-danger btn-sm" data-del-sede="'+esc(s)+'">Eliminar</button></div>';
  }).join("") || '<p style="color:var(--muted);font-size:13.5px;">Sin sedes creadas.</p>';

  return ''+
  '<div class="kiosk-head"><div><h1>Configuración</h1><p>Gestiona trabajadores, fotos y sedes.</p></div></div>'+
  (STATE.adminProtected ? '<div class="note">🔒 Los cambios en esta sección piden la contraseña de administrador la primera vez.</div>' : '')+
  (STATE.employees.length===0 ? '<div class="note">👋 Añade a tus trabajadores reales (nombre y foto) y crea tus sedes antes de usar esto en producción.</div>' : '')+
  '<div class="config-grid">'+
    '<div class="panel panel-pad"><h2 class="section-title">Trabajadores</h2><p class="section-sub">'+emps.length+' en total</p>'+
      empRows+'<button class="btn btn-accent" id="btn-add-emp" style="margin-top:14px;">+ Añadir trabajador</button></div>'+
    '<div class="panel panel-pad"><h2 class="section-title">Sedes</h2><p class="section-sub">Ubicaciones desde las que se puede fichar</p>'+
      sedeRows+
      '<div style="display:flex;gap:8px;margin-top:14px;">'+
        '<input type="text" id="new-sede-input" placeholder="Nombre de la nueva sede" style="flex:1;border:1px solid var(--border);background:var(--surface-2);color:var(--ink);border-radius:9px;padding:9px 11px;font-size:14px;">'+
        '<button class="btn btn-accent btn-sm" id="btn-add-sede">Añadir</button>'+
      '</div></div>'+
  '</div>';
}

function renderModals(){
  var html = "";
  if(UI.editingEmployee !== null){
    var isNew = UI.editingEmployee === "new";
    var emp = isNew ? {id:null, name:"", sede:STATE.sedes[0]||"", photo:null} : employeeById(UI.editingEmployee);
    if(emp){
      var sedeOpts = STATE.sedes.map(function(s){return '<option value="'+esc(s)+'" '+(emp.sede===s?"selected":"")+'>'+esc(s)+'</option>';}).join("");
      html += '<div class="modal-backdrop" id="modal-backdrop"><div class="modal">'+
        '<h3>'+(isNew?"Añadir trabajador":"Editar trabajador")+'</h3>'+
        '<div class="photo-picker">'+avatarHtml(emp)+
          '<div><input type="file" accept="image/*" id="emp-photo-input" class="visually-hidden">'+
          '<button class="btn btn-ghost btn-sm" id="emp-photo-btn">Subir foto</button> '+
          (emp.photo ? '<button class="btn btn-ghost btn-sm" id="emp-photo-clear">Quitar</button>' : '')+
          '</div></div>'+
        '<div class="field"><label>Nombre</label><input type="text" id="emp-name-input" value="'+esc(emp.name)+'" placeholder="Nombre y apellido"></div>'+
        '<div class="field"><label>Sede habitual</label><select id="emp-sede-input">'+sedeOpts+'</select></div>'+
        '<div class="modal-actions"><button class="btn btn-ghost" id="modal-cancel">Cancelar</button><button class="btn btn-accent" id="modal-save">Guardar</button></div>'+
      '</div></div>';
    }
  }
  if(UI.confirmAction){
    html += '<div class="modal-backdrop" id="confirm-backdrop"><div class="modal">'+
      '<h3>'+esc(UI.confirmAction.title)+'</h3><p class="hint">'+esc(UI.confirmAction.body)+'</p>'+
      '<div class="modal-actions"><button class="btn btn-ghost" id="confirm-cancel">Cancelar</button><button class="btn btn-danger" id="confirm-ok">Eliminar</button></div>'+
    '</div></div>';
  }
  if(UI.loginPrompt){
    html += '<div class="modal-backdrop" id="login-backdrop"><div class="modal">'+
      '<h3>Acceso de administrador</h3><p class="hint">Introduce la contraseña para editar trabajadores, sedes o el historial.</p>'+
      '<div class="field"><label>Contraseña</label><input type="password" id="admin-pw-input" placeholder="••••••••"></div>'+
      '<div class="modal-actions"><button class="btn btn-ghost" id="login-cancel">Cancelar</button><button class="btn btn-accent" id="login-ok">Entrar</button></div>'+
    '</div></div>';
  }
  return html;
}

function renderSedeSplash(){
  var opts = STATE.sedes.map(function(s){return '<button class="sede-choice" data-pick-sede="'+esc(s)+'">'+esc(s)+'</button>';}).join("");
  return '<div class="sede-splash"><h1>¿Qué sede es esta pantalla?</h1>'+
    '<p>Se recordará en este dispositivo. Los fichajes que se hagan aquí quedarán marcados con esta ubicación.</p>'+
    '<div class="sede-choices">'+opts+'</div></div>';
}

function render(){
  var root = document.getElementById("app-root");
  if(!getDeviceSede() && STATE.sedes.length>0){
    root.innerHTML = renderSedeSplash();
    document.querySelectorAll("[data-pick-sede]").forEach(function(btn){
      btn.addEventListener("click", function(){ setDeviceSede(btn.getAttribute("data-pick-sede")); render(); });
    });
    return;
  }
  var body = UI.tab==="fichar" ? renderFichar() : UI.tab==="historial" ? renderHistorial() : renderConfig();
  root.innerHTML = renderHeader() + '<main>'+body+'</main>' + renderModals();
  bindEvents();
}

/* ---------------- fotos ---------------- */
function readFileAsCompressedDataUrl(file, cb){
  var reader = new FileReader();
  reader.onload = function(){
    var img = new Image();
    img.onload = function(){
      var max = 240;
      var scale = Math.min(1, max/Math.max(img.width, img.height));
      var cw = Math.round(img.width*scale), ch = Math.round(img.height*scale);
      var canvas = document.createElement("canvas");
      canvas.width=cw; canvas.height=ch;
      canvas.getContext("2d").drawImage(img,0,0,cw,ch);
      cb(canvas.toDataURL("image/jpeg",0.75));
    };
    img.onerror = function(){ cb(null); };
    img.src = reader.result;
  };
  reader.onerror = function(){ cb(null); };
  reader.readAsDataURL(file);
}

/* ---------------- eventos ---------------- */
function bindEvents(){
  document.querySelectorAll("[data-tab]").forEach(function(b){
    b.addEventListener("click", function(){ UI.tab = b.getAttribute("data-tab"); render(); });
  });
  var sedeTag = document.getElementById("sede-tag-btn");
  if(sedeTag) sedeTag.addEventListener("click", function(){ setDeviceSede(""); render(); });

  document.querySelectorAll("[data-toggle]").forEach(function(b){
    b.addEventListener("click", function(){ toggleEmployee(b.getAttribute("data-toggle")); });
  });

  var fEmp = document.getElementById("f-empleado");
  if(fEmp) fEmp.addEventListener("change", function(){ UI.histFilters.empleado=fEmp.value; render(); });
  var fSede = document.getElementById("f-sede");
  if(fSede) fSede.addEventListener("change", function(){ UI.histFilters.sede=fSede.value; render(); });
  var fDesde = document.getElementById("f-desde");
  if(fDesde) fDesde.addEventListener("change", function(){ UI.histFilters.desde=fDesde.value; render(); });
  var fHasta = document.getElementById("f-hasta");
  if(fHasta) fHasta.addEventListener("change", function(){ UI.histFilters.hasta=fHasta.value; render(); });
  var fQ = document.getElementById("f-q");
  if(fQ) fQ.addEventListener("input", function(){ UI.histFilters.q=fQ.value; render(); });
  var fClear = document.getElementById("f-clear");
  if(fClear) fClear.addEventListener("click", function(){ UI.histFilters={empleado:"",sede:"",desde:"",hasta:"",q:""}; render(); });
  var btnExport = document.getElementById("btn-export");
  if(btnExport) btnExport.addEventListener("click", exportCsv);
  document.querySelectorAll("[data-del-hist]").forEach(function(b){
    b.addEventListener("click", function(){
      UI.confirmAction = { title:"Eliminar registro", body:"Se eliminará este fichaje del historial. Esta acción no se puede deshacer.",
        run: function(){ deleteHistoryRecord(b.getAttribute("data-del-hist")); } };
      render();
    });
  });

  var btnAddEmp = document.getElementById("btn-add-emp");
  if(btnAddEmp) btnAddEmp.addEventListener("click", function(){ UI.editingEmployee="new"; render(); });
  document.querySelectorAll("[data-edit-emp]").forEach(function(b){
    b.addEventListener("click", function(){ UI.editingEmployee=b.getAttribute("data-edit-emp"); render(); });
  });
  document.querySelectorAll("[data-del-emp]").forEach(function(b){
    b.addEventListener("click", function(){
      var emp = employeeById(b.getAttribute("data-del-emp"));
      UI.confirmAction = { title:"Eliminar trabajador", body:'Se eliminará a "'+(emp?emp.name:"")+'" y no aparecerá más en la pantalla de fichaje (su historial se conserva).',
        run: function(){ deleteEmployee(b.getAttribute("data-del-emp")); } };
      render();
    });
  });

  var btnAddSede = document.getElementById("btn-add-sede");
  if(btnAddSede) btnAddSede.addEventListener("click", function(){
    var input = document.getElementById("new-sede-input");
    if(input && input.value.trim()) addSede(input.value);
  });
  document.querySelectorAll("[data-rename-sede]").forEach(function(b){
    b.addEventListener("click", function(){
      var old = b.getAttribute("data-rename-sede");
      var nv = prompt("Nuevo nombre para «"+old+"»:", old);
      if(nv!==null) renameSede(old, nv);
    });
  });
  document.querySelectorAll("[data-del-sede]").forEach(function(b){
    b.addEventListener("click", function(){
      var name = b.getAttribute("data-del-sede");
      UI.confirmAction = { title:"Eliminar sede", body:'Se eliminará «'+name+'». Los trabajadores asignados quedarán sin sede.',
        run: function(){ deleteSede(name); } };
      render();
    });
  });

  var backdrop = document.getElementById("modal-backdrop");
  if(backdrop){
    backdrop.addEventListener("click", function(ev){ if(ev.target===backdrop){ UI.editingEmployee=null; render(); } });
    var cancelBtn = document.getElementById("modal-cancel");
    if(cancelBtn) cancelBtn.addEventListener("click", function(){ UI.editingEmployee=null; render(); });
    var photoBtn = document.getElementById("emp-photo-btn");
    var photoInput = document.getElementById("emp-photo-input");
    var pendingPhoto = undefined;
    if(photoBtn && photoInput){
      photoBtn.addEventListener("click", function(){ photoInput.click(); });
      photoInput.addEventListener("change", function(){
        var f = photoInput.files && photoInput.files[0];
        if(!f) return;
        readFileAsCompressedDataUrl(f, function(dataUrl){
          pendingPhoto = dataUrl;
          var img = backdrop.querySelector(".photo-picker .avatar");
          if(img && dataUrl){
            var newImg = document.createElement("img");
            newImg.className="avatar"; newImg.src=dataUrl;
            img.replaceWith(newImg);
          }
        });
      });
    }
    var clearBtn0 = document.getElementById("emp-photo-clear");
    if(clearBtn0) clearBtn0.addEventListener("click", function(){ pendingPhoto = null; });
    var saveBtn = document.getElementById("modal-save");
    if(saveBtn){
      saveBtn.addEventListener("click", function(){
        var name = document.getElementById("emp-name-input").value.trim();
        var sede = document.getElementById("emp-sede-input").value;
        if(!name){ showToast("Escribe un nombre.", "out"); return; }
        var data = { id: UI.editingEmployee==="new"?null:UI.editingEmployee, name:name, sede:sede };
        if(pendingPhoto !== undefined) data.photo = pendingPhoto;
        UI.editingEmployee = null;
        saveEmployee(data);
      });
    }
  }

  var cbackdrop = document.getElementById("confirm-backdrop");
  if(cbackdrop){
    cbackdrop.addEventListener("click", function(ev){ if(ev.target===cbackdrop){ UI.confirmAction=null; render(); } });
    var cCancel = document.getElementById("confirm-cancel");
    if(cCancel) cCancel.addEventListener("click", function(){ UI.confirmAction=null; render(); });
    var cOk = document.getElementById("confirm-ok");
    if(cOk) cOk.addEventListener("click", function(){
      var action = UI.confirmAction; UI.confirmAction=null;
      if(action && action.run) action.run();
      render();
    });
  }

  var lbackdrop = document.getElementById("login-backdrop");
  if(lbackdrop){
    lbackdrop.addEventListener("click", function(ev){ if(ev.target===lbackdrop){ UI.loginPrompt=false; render(); } });
    var lCancel = document.getElementById("login-cancel");
    if(lCancel) lCancel.addEventListener("click", function(){ UI.loginPrompt=false; render(); });
    var lOk = document.getElementById("login-ok");
    var pwInput = document.getElementById("admin-pw-input");
    if(pwInput) setTimeout(function(){ pwInput.focus(); }, 30);
    if(lOk) lOk.addEventListener("click", function(){ tryAdminLogin(pwInput.value); });
    if(pwInput) pwInput.addEventListener("keydown", function(ev){ if(ev.key==="Enter"){ tryAdminLogin(pwInput.value); } });
  }
}

/* ---------------- ciclo de vida ---------------- */
function isUserTypingInFilter(){
  var el = document.activeElement;
  return el && (el.id==="f-q" || el.id==="new-sede-input" || el.id==="emp-name-input" || el.id==="admin-pw-input");
}

var tick = 0;
setInterval(function(){
  tick++;
  var timeEl = document.querySelector(".clock .time");
  if(timeEl){
    var t = new Date().toLocaleTimeString("es-ES", {hour:"2-digit", minute:"2-digit", second:"2-digit"});
    var dot = timeEl.querySelector(".conn-dot");
    timeEl.innerHTML = "";
    if(dot) timeEl.appendChild(dot);
    timeEl.appendChild(document.createTextNode(" " + t));
  }
  var modalOpen = UI.editingEmployee!==null || UI.confirmAction!==null || UI.loginPrompt;
  if(tick % 4 === 0){
    loadState().catch(function(){ connOk = false; }).then(function(){
      if(!modalOpen && !isUserTypingInFilter()) render();
    });
  } else if(UI.tab==="historial" && !modalOpen && !isUserTypingInFilter()){
    render(); // refresca los contadores "en curso"
  }
}, 1000);

loadState()
  .catch(function(e){ connOk=false; console.error(e); })
  .then(function(){ render(); });
})();
