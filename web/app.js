'use strict';

const icons = {
  flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M8 14h8"/>',
  archive: '<rect x="4" y="7" width="16" height="14" rx="2"/><path d="M3 3h18v4H3zM10 12h4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  book: '<path d="M12 5v15M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2Z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.7"/>',
  hidden: '<path d="m3 3 18 18M10.6 6.1C17.5 5.4 22 12 22 12s-1.5 2.5-4.3 4.2M6.4 6.4C3.5 8.3 2 12 2 12s3.6 6 10 6c1.5 0 2.9-.3 4.1-.8M10 10a3 3 0 0 0 4 4"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 20v-2a6 6 0 0 0-4-5.6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  exit: '<path d="M10 4H5v16h5M9 12h12m-4-4 4 4-4 4"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  step: '<path d="m5 5 10 7-10 7V5ZM19 5v14"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="10" cy="18" r="2" fill="currentColor" stroke="none"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  link: '<path d="m9 15 6-6M7.5 14l-2 2a3.5 3.5 0 0 0 5 5l4-4a3.5 3.5 0 0 0 0-5M16.5 10l2-2a3.5 3.5 0 0 0-5-5l-4 4a3.5 3.5 0 0 0 0 5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  terminal: '<path d="m5 7 5 5-5 5M13 17h6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  chart: '<path d="M4 3v17h17M8 15v-4M13 15V7M18 15v-6"/>',
  buttons: '<rect x="3" y="5" width="8" height="14" rx="4"/><rect x="13" y="5" width="8" height="14" rx="4"/><path d="M7 10v4M16 10h2l-2 4h2"/>',
  one: '<circle cx="12" cy="12" r="9"/><path d="m10 9 2-1v8m-2 0h4"/>',
  two: '<circle cx="12" cy="12" r="9"/><path d="M9 10a3 3 0 0 1 6 0c0 2-6 3-6 6h6"/>',
};
const icon = (name, cls='') => `<svg class="${cls}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.info}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const defaults = () => ({game:'island',name:'Island experiment',population:5,green_count:5,announcement:'public',minimum_green:1,announcement_delay:0,max_nights:20,max_model_calls:500,seed:42,mode:'reference',provider_id:null});
const state = {page:'experiment',draft:defaults(),run:null,runs:[],providers:[],selected:'P01',view:'observer',cursor:0,showAllBallots:false,autoplay:false,busy:false,loopActive:false,speed:650,search:'',compare:[],connections:{},progress:null};
const labels = {ready:'Ready to begin',paused:'Paused',completed:'Complete',limit_reached:'Limit reached',failed:'Run interrupted'};
const terminal = run => run && !['ready','paused'].includes(run.status);
let toastTimer;

async function api(path, body) {
  let response;
  try { response = await fetch(path, body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); }
  catch { throw new Error('Could not reach Common Ground. Run start.cmd from the project folder, then refresh this page.'); }
  let value;
  try { value = await response.json(); } catch { throw new Error('The local server did not return a response. Make sure it is still running.'); }
  if (!response.ok) throw new Error(value.error || `Request failed (${response.status}).`);
  return value;
}
function toast(message, error=false) {
  const element = document.getElementById('toast');
  element.textContent = message;
  element.className = 'toast visible' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'), error ? 7000 : 4000);
}
function progressText() {
  const p=state.progress;
  if(!p) return 'Starting agents…';
  const elapsed=Math.max(0,Math.floor(p.elapsed_seconds||0));
  const clock=`${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`;
  return `${p.completed}/${p.total} agents answered · ${clock} elapsed`;
}
function badge(text, tone='') { return `<span class="badge ${tone}">${esc(text)}</span>`; }
function button(text, action, symbol='arrow', cls='', disabled=false, extra='') {
  return `<button type="button" class="btn ${cls}" data-action="${action}" ${disabled ? 'disabled' : ''} ${extra}>${icon(symbol)}${esc(text)}</button>`;
}
function currentConfig() { return state.run?.config || state.draft; }
function configName(config) {
  if(isButtonGame(config)) return buttonConfigName(config);
  return `${config.population} prisoners · ${config.announcement === 'none' ? 'no announcement' : config.minimum_green > 1 ? 'stronger announcement' : config.green_count < config.population ? 'mixed eyes' : 'public announcement'}`;
}
function previewPrisoners() {
  const cfg = state.draft;
  // Preview is illustrative. The saved experiment uses the backend's seeded shuffle.
  return Array.from({length:cfg.population},(_,i)=>({id:`P${String(i+1).padStart(2,'0')}`,colour:i<cfg.green_count?'green':'not_green',status:'imprisoned',departed_night:null}));
}
function prisonersAtCursor() {
  return (state.run?.prisoners || previewPrisoners()).map(p=>({...p,status:p.departed_night !== null && p.departed_night<=state.cursor?p.status:'imprisoned'}));
}
function heading(eyebrow, title, subtitle, actions='') {
  return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function render() {
  document.querySelectorAll('[data-page]').forEach(el=>{
    if (el.classList.contains('nav-item')) {
      el.classList.toggle('active',el.dataset.page===state.page);
      if (el.dataset.page===state.page) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current');
    }
  });
  document.getElementById('page-breadcrumb').textContent = {experiment:'Experiment',archive:'Run archive',models:'Models',guide:'Game rules'}[state.page];
  document.getElementById('archive-count').textContent = state.runs.length;
  document.getElementById('workspace').innerHTML = ({experiment:renderExperiment,archive:renderArchive,models:renderModels,guide:renderGuide}[state.page])();
}

function renderStats() {
  const cfg=currentConfig(), ps=prisonersAtCursor();
  const released=ps.filter(p=>p.status==='released').length;
  const stats=[
    ['NIGHT',state.cursor,`/ ${cfg.max_nights}`,'clock'],
    ['PRISONERS',cfg.population,'','people'],
    ['GREEN EYES',state.view==='prisoner'?'?':cfg.green_count,'','eye'],
    ['RELEASED',released,`/ ${cfg.green_count}`,'exit'],
  ];
  return stats.map(([label,value,suffix,symbol])=>`<div class="stat"><div class="stat-top"><span>${label}</span>${icon(symbol)}</div><div class="stat-number">${value}${suffix?`<small>${suffix}</small>`:''}</div></div>`).join('');
}
function providerOptions(selected=null) {
  return state.providers.map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(p.name)} · ${esc(p.model)}</option>`).join('');
}
function renderConfig() {
  const cfg=currentConfig(), frozen=!!state.run, disabled=frozen?'disabled':'';
  return `<div><section class="card config-card" aria-label="Experiment configuration"><div class="config-title"><h2>Experiment setup</h2>${icon('settings')}</div><div class="config-form">
    <div class="field"><label for="scenario">Scenario</label><select id="scenario" data-config="scenario" ${disabled}><option value="classic" ${cfg.announcement==='public'&&cfg.green_count===cfg.population&&cfg.minimum_green===1?'selected':''}>The classic island</option><option value="mixed" ${cfg.announcement==='public'&&cfg.green_count<cfg.population&&cfg.minimum_green===1?'selected':''}>Mixed eye colours</option><option value="silent" ${cfg.announcement==='none'?'selected':''}>No announcement</option><option value="stronger" ${cfg.minimum_green>1&&cfg.announcement==='public'?'selected':''}>Stronger announcement</option></select></div>
    <div class="field"><label for="population">Prisoners <span class="label-value" id="population-value">${cfg.population}</span></label><input type="range" id="population" min="1" max="100" value="${cfg.population}" data-config="population" ${disabled}><div class="range-labels"><span>1 prisoner</span><span>100 prisoners</span></div></div>
    <div class="field"><label for="green-count">Green-eyed <span class="label-value" id="green-value">${cfg.green_count}</span></label><input type="range" id="green-count" min="${cfg.announcement==='public'?cfg.minimum_green:0}" max="${cfg.population}" value="${cfg.green_count}" data-config="green_count" ${disabled}></div>
    <div class="field"><label for="minimum-green">Public minimum</label><input id="minimum-green" type="number" min="1" max="${cfg.green_count||100}" value="${cfg.minimum_green}" data-config="minimum_green" ${disabled||cfg.announcement==='none'?'disabled':''}><p class="field-hint">${cfg.announcement==='none'?'No visitor speaks. The shared premise is absent.':`“At least ${cfg.minimum_green} of you ${cfg.minimum_green===1?'has':'have'} green eyes.”`}</p></div>
    <div class="section-divider"></div><div class="field" style="grid-column:1/-1"><label for="policy">Agent policy</label><select id="policy" data-config="mode" ${disabled}><option value="reference" ${cfg.mode==='reference'?'selected':''}>Logical reference</option><option value="model" ${cfg.mode==='model'?'selected':''} ${!state.providers.length?'disabled':''}>Independent AI agents</option></select></div>
    ${cfg.mode==='model'?`<div class="field" style="grid-column:1/-1"><label for="provider-select">Model connection</label><select id="provider-select" data-config="provider_id" ${disabled}>${providerOptions(cfg.provider_id)}</select></div>`:''}
    ${frozen?`<div class="config-action">${button('Duplicate setup','duplicate','settings','btn-wide',state.busy)}</div>`:''}
    </div></section></div>`;
}
function renderDeck() {
  const ps=prisonersAtCursor(), cfg=currentConfig(), many=ps.length>10;
  if (!ps.some(p=>p.id===state.selected)) state.selected=ps[0]?.id;
  const nodes=ps.map((p,i)=>{
    const angle=(-90+i*360/ps.length)*Math.PI/180;
    const x=50+Math.cos(angle)*31,y=50+Math.sin(angle)*35;
    const hidden=state.view==='prisoner'&&p.id===state.selected;
    const css=[p.colour==='not_green'?'not-green':'',p.status,hidden?'hidden-colour':'',p.id===state.selected?'selected':''].join(' ');
    return `<button type="button" class="prisoner ${css}" style="--x:${x}%;--y:${y}%" data-action="select-prisoner" data-id="${p.id}" aria-label="Inspect prisoner ${p.id}" aria-pressed="${p.id===state.selected}"><span class="prisoner-disc">${icon(hidden?'hidden':p.status==='released'?'check':p.status==='killed'?'close':'eye')}<span class="mini-state"></span></span><span class="prisoner-label">${p.id}</span></button>`;
  }).join('');
  return `<div class="deck ${many?'many-prisoners':''}" aria-label="Island population at night ${state.cursor}"><svg class="deck-bg" viewBox="0 0 600 300" preserveAspectRatio="none" aria-hidden="true"><ellipse class="contour" cx="300" cy="150" rx="237" ry="136"/><ellipse class="contour" cx="300" cy="150" rx="210" ry="121"/><ellipse class="contour inner" cx="300" cy="150" rx="181" ry="101"/><ellipse class="contour" cx="300" cy="150" rx="145" ry="80"/></svg><span class="island-label"><span class="status-dot"></span> THE ISLAND</span><div class="deck-center"><span class="eyebrow">NIGHT</span><div class="night-display">${String(state.cursor).padStart(2,'0')}</div></div>${nodes}</div>`;
}
function renderControls() {
  const run=state.run, ended=terminal(run);
  const text=state.autoplay?'Pause':ended?'Run complete':run?.night?'Continue':'Run experiment';
  return `<div class="control-bar"><div class="control-actions">${button(text,'play',state.autoplay?'pause':'play','btn-primary',ended||(!state.autoplay&&state.busy))}${button('Step a night','step','step','',state.busy||state.autoplay||ended)}</div><span class="control-status"><span class="status-dot ${state.busy?'pulse':''}"></span><span id="decision-progress">${state.busy&&run?.config.mode==='model'?progressText():state.busy?'Finishing this night…':run?labels[run.status]:'Ready'}</span></span><label class="control-speed" for="speed-select">Round pace <select id="speed-select" aria-label="Round pace"><option value="1300" ${state.speed===1300?'selected':''}>Slow</option><option value="650" ${state.speed===650?'selected':''}>Normal</option><option value="100" ${state.speed===100?'selected':''}>Fast</option></select></label></div>`;
}
function inspectorEntry() {
  const history=state.run?.histories[state.selected]||[];
  return history.filter(e=>e.observation.night<=state.cursor).slice(-1)[0];
}
function renderInspector() {
  const entry=inspectorEntry(), ps=prisonersAtCursor(), selected=ps.find(p=>p.id===state.selected);
  const visible=entry?.observation.visible_prisoners||ps.filter(p=>p.id!==state.selected&&p.status==='imprisoned').map(p=>({id:p.id,eye_colour:p.colour}));
  const seen=visible.filter(p=>p.eye_colour==='green').length;
  const chips=visible.slice(0,12).map(p=>`<span class="observation-chip ${p.eye_colour==='not_green'?'brown':''}">${p.id} ${p.eye_colour==='green'?'· green':'· other'}</span>`).join('');
  const action=entry?.decision.action;
  const note=entry?.decision.justification||'No decision yet.';
  return `<div class="card-head"><div class="prisoner-switch"><span class="prisoner-avatar">${state.selected}</span><div><h2>Prisoner perspective</h2><p>${entry?`Observation before night ${entry.observation.night}`:'Before night 1'}</p></div></div>${badge(action==='leave'?'Leave':action==='wait'?'Wait':'Not started',action==='leave'?'green':'gray')}</div><div class="inspector-body"><div class="inspector-meta"><span>Own eye colour</span><strong class="eye-hidden">${icon('hidden')} Never supplied</strong></div><div class="inspector-meta"><span>Visible green eyes</span><strong>${seen} of ${visible.length} others</strong></div><div class="observation-chips">${chips}${visible.length>12?`<span class="observation-chip">+${visible.length-12} more</span>`:''}</div>${entry?'<span class="tiny-eyebrow">STATED JUSTIFICATION</span>':''}<p class="thought-note ${entry?'':'empty'}">${esc(note)}</p><div class="inspector-bottom inspector-actions"><button class="text-button" type="button" data-action="inspect-log" ${!state.run?'disabled':''}>Full record ${icon('arrow')}</button></div>${selected?.status==='killed'?'<p class="field-hint">Observer outcome: an ineligible prisoner attempted to leave.</p>':''}</div>`;
}
function renderTimeline() {
  const cfg=currentConfig(), expected=state.run?.benchmark.expected_night??(cfg.announcement==='public'?cfg.announcement_delay+cfg.green_count-cfg.minimum_green+1:null);
  const horizon=Math.max(5,Math.min(cfg.max_nights,Math.max(state.run?.night||0,expected||0,10)));
  const columns=Math.min(60,horizon), group=Math.ceil(horizon/columns);
  const bars=Array.from({length:Math.ceil(horizon/group)},(_,i)=>{
    const first=i*group+1,last=Math.min(horizon,(i+1)*group);
    const count=(state.run?.rounds||[]).filter(r=>r.night>=first&&r.night<=last).reduce((n,r)=>n+r.departed_ids.length,0);
    return `<button class="timeline-col ${first>state.run?.night||!state.run?'future':''} ${state.cursor>=first&&state.cursor<=last?'active':''} ${expected>=first&&expected<=last?'expected':''}" style="--height:${Math.max(5,count/cfg.population*100)}%" data-action="seek" data-night="${Math.min(last,state.run?.night||0)}" ${!state.run?'disabled':''} aria-label="View night ${last}" title="Night ${first===last?first:`${first}–${last}`}: ${count} departure${count===1?'':'s'}"><span class="bar"></span></button>`;
  }).join('');
  const expectedText=expected===null?'No justified departure without an announcement.':`Ideal green-eyed departure: night ${expected}.`;
  return `<div class="card-head"><div><h2>Departure timeline</h2></div>${icon('chart')}</div><div class="timeline-body"><p class="timeline-description">${expectedText}${state.run?.benchmark.first_divergence?' The AI trajectory has diverged from the ideal benchmark.':''}</p><div class="timeline-bars">${bars}</div><div class="timeline-axis"><span>01</span><span>NIGHT</span><span>${String(horizon).padStart(2,'0')}</span></div><div class="replay-row"><span>Replay</span><input id="replay-slider" type="range" min="0" max="${state.run?.night||0}" value="${state.cursor}" ${!state.run?.night||state.autoplay||state.busy?'disabled':''} aria-label="Replay night"><span>${String(state.cursor).padStart(2,'0')}</span></div><div class="timeline-key"><span><i class="legend-dot"></i>Actual departures</span><span><i class="dashed"></i>Ideal departure</span></div></div>`;
}
function eventText() {
  const cfg=currentConfig(), run=state.run;
  if (run?.benchmark.first_divergence&&state.cursor>=run.benchmark.first_divergence.night) {
    const d=run.benchmark.first_divergence;
    return `<strong>First divergence · night ${d.night}</strong> ${d.prisoner_id} chose ${d.actual_action}; the ideal policy required ${d.expected_action}.`;
  }
  const round=run?.rounds.find(r=>r.night===state.cursor);
  if (round?.departed_ids.length) return `<strong>Night ${round.night}</strong> ${round.departed_ids.length} prisoner${round.departed_ids.length===1?'':'s'} departed. `;
  if (state.cursor>0) return `<strong>Night ${state.cursor}</strong> No one departed. `;
  if (cfg.announcement==='none') return '<strong>No public announcement.</strong> Each prisoner starts with only its own view of the island.';
  return `<strong>The visitor's announcement${cfg.announcement_delay?` · before night ${cfg.announcement_delay+1}`:''}</strong> “At least ${cfg.minimum_green} of you ${cfg.minimum_green===1?'has':'have'} green eyes.”`;
}
function renderExperiment() {
  if(isButtonGame()) return renderButtonsExperiment();
  const cfg=currentConfig(), run=state.run;
  const alert=run?.error?`<div class="error-banner"><strong>${run.status==='failed'?'This night was not committed.':'Experiment limit reached.'}</strong> ${esc(run.error)}${run.failed_round?` The last completed night is ${run.night}; partial decisions are retained in the full export.`:''}</div>`:'';
  const modeText=cfg.mode==='reference'?'Logical reference · scripted, no AI calls':`AI agents · ${esc(run?.provider?.name||state.providers.find(p=>p.id===cfg.provider_id)?.name||'your model')}`;
  return gamePicker('island')+heading('','Green-eyed island','',`${run?button('Export','export','download','btn-quiet'):''}${button('New experiment','new','plus','',state.busy)}`)+alert+`<div class="notice">${icon(cfg.mode==='reference'?'info':'layers')}<span>${modeText}</span></div><div class="stat-grid" id="stat-container">${renderStats()}</div><div class="experiment-layout">${renderConfig()}<div class="right-stack"><section class="card island-card"><div class="card-head"><div><h2>Observation deck</h2>${run?`<p>${esc(run.config.name)}</p>`:''}</div><div class="segmented" aria-label="Island view"><button type="button" data-action="view-observer" class="${state.view==='observer'?'selected':''}" aria-pressed="${state.view==='observer'}">Observer</button><button type="button" data-action="view-prisoner" class="${state.view==='prisoner'?'selected':''}" aria-pressed="${state.view==='prisoner'}">Prisoner</button></div></div><div id="deck-area">${renderDeck()}</div><div class="deck-legend"><span><i class="legend-dot"></i>Green eyes</span><span><i class="legend-dot brown"></i>Other eyes</span><span><i class="legend-dot outline"></i>${state.view==='prisoner'?'Own eyes hidden':'Click to inspect'}</span></div><div id="control-area">${renderControls()}</div></section><div class="below-grid"><section class="card inspector" id="inspector-card">${renderInspector()}</section><section class="card" id="timeline-card">${renderTimeline()}</section></div></div></div><div class="event-strip" id="event-strip">${icon('info')}<span>${eventText()}</span><span class="time">${run?`${run.usage.model_calls} model calls`:'No model required'}</span></div>`;
}
function refreshPreview(skipTimeline=false) {
  if (state.page!=='experiment') return;
  if(isButtonGame()){refreshButtonPreview(skipTimeline);return;}
  for (const [id,fn] of [['stat-container',renderStats],['deck-area',renderDeck],['inspector-card',renderInspector],['timeline-card',renderTimeline]]) {
    const el=document.getElementById(id); if(el&&!(skipTimeline&&id==='timeline-card')) el.innerHTML=fn();
  }
  const event=document.getElementById('event-strip');
  if(event) event.innerHTML=`${icon('info')}<span>${eventText()}</span><span class="time">${state.run?`${state.run.usage.model_calls} model calls`:'Not started'}</span>`;
}

function renderArchive() {
  const filtered=state.runs.filter(r=>`${r.name} ${r.provider_name} ${r.game||'island'}`.toLowerCase().includes(state.search.toLowerCase()));
  const top=heading('','Run archive','',button('New experiment','new','plus','',state.busy));
  if(!state.runs.length)return top+`<div class="empty-state"><div class="empty-icon">${icon('archive')}</div><h2>Your notebook starts here</h2><p>Run either experiment. Its settings, private observations, and decisions are saved automatically.</p>${button('Open the experiment','go-experiment','flask','btn-primary')}</div>`;
  return top+`<div class="archive-toolbar"><input type="search" class="search-input" id="archive-search" placeholder="Search experiments or models" value="${esc(state.search)}" aria-label="Search saved experiments">${button(`Compare ${state.compare.length} runs`,'compare','layers','',state.compare.length!==2)}</div><div class="card table-scroll"><table class="archive-table"><thead><tr><th aria-label="Select for comparison"></th><th>EXPERIMENT</th><th>POLICY</th><th>STEP</th><th>OUTCOME</th><th>STATUS</th><th></th></tr></thead><tbody>${filtered.map(r=>{
    const buttons=isButtonGame(r.config);
    return `<tr><td><input type="checkbox" data-compare="${r.id}" aria-label="Compare ${esc(r.name)}" ${state.compare.includes(r.id)?'checked':''}></td><td><span class="run-name">${esc(r.name)}<span class="game-label ${buttons?'buttons':''}">${buttons?'Button dilemma':'Green-eyed island'}</span></span><span class="run-date">${new Date(r.created_at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})} · ${r.config.population} ${buttons?'participants':'prisoners'}</span></td><td>${esc(r.provider_name)}<div class="run-date" style="margin-top:5px">${r.config.mode==='model'?'AI agents':buttons?'Scripted placeholders':'Scripted reference'}</div></td><td>${buttons?'Round':'Night'} ${r.night}</td><td>${buttons?(r.result?`${r.result.survivors} / ${r.config.population} survived`:'Vote pending'):`${r.released} / ${r.config.green_count} released`}${r.killed?`<div class="run-date" style="color:var(--red);margin-top:5px">${r.killed} died</div>`:''}</td><td>${badge(labels[r.status],r.status==='completed'?'green':r.status==='failed'?'red':'gray')}</td><td>${button('Open','open-run','arrow','btn-small',state.busy,`data-id="${r.id}"`)}</td></tr>`;
  }).join('')||'<tr><td colspan="7">No experiments match your search.</td></tr>'}</tbody></table></div><p class="field-hint" style="margin-top:16px">Compare two runs of the same game.</p>`;
}
function renderModels() {
  const top=heading('','Model connections','Choose a model for either experiment.',button('Add model','add-provider','plus'));
  const reference=`<section class="card model-card"><div class="model-card-header"><span class="provider-icon">${icon('flask')}</span><div><h3>Island reference</h3><p>Scripted logic · no model calls</p></div>${badge('Built in','green')}</div><div class="model-card-actions">${button('Use reference','use-reference','arrow','btn-small')}</div></section>`;
  const cards=state.providers.map(p=>{
    const tested=state.connections[p.id];
    return `<section class="card model-card"><div class="model-card-header"><span class="provider-icon">${icon('terminal')}</span><div><h3>${esc(p.name)}</h3><p>${p.kind==='ollama'?'Ollama':'Compatible chat server'}</p></div>${badge(tested?.reachable?'Connected':'Not checked',tested?.reachable?'green':'gray')}</div><div class="model-details"><div><span>Model</span><strong>${esc(p.model)}</strong></div><div><span>Server</span><strong>${esc(p.base_url)}</strong></div><div><span>Generation limit</span><strong>${p.max_output_tokens.toLocaleString()} tokens per decision</strong></div>${p.kind==='ollama'?'':`<div><span>API key</span><strong>${p.has_api_key?'Saved for this session':'Not set'}</strong></div>`}</div><div class="model-card-actions">${button('Use model','use-model','arrow','btn-small',false,`data-id="${p.id}"`)}${button('Test connection','test-provider','link','btn-small',false,`data-id="${p.id}"`)}${button('Edit','edit-provider','settings','btn-small',false,`data-id="${p.id}"`)}</div>${tested?`<p class="field-hint">${esc(tested.message)}</p>`:''}</section>`;
  }).join('');
  return top+`<div class="models-grid">${reference}${cards}${!state.providers.length?`<section class="empty-state" style="padding:38px 24px"><div class="empty-icon">${icon('layers')}</div><h2>No AI model connected</h2><p>Add Ollama or a compatible chat server to run AI agents.</p></section>`:''}</div>`;
}
function renderGuide() {
  if((state.guideGame||currentConfig().game)==='buttons') return renderButtonsGuide();
  return gamePicker(state.guideGame||'island',true)+heading('','The green-eyed puzzle','')+`<div class="guide-grid"><section class="card guide-card"><h2>The rules of the island</h2><ol><li>Each prisoner sees everyone else's eye colour, but cannot see their own. There are no mirrors, reflections, or conversations.</li><li>Each night, every prisoner independently chooses whether to request release. Green eyes mean freedom; any other colour means death.</li><li>All prisoners are perfect logicians. Everyone knows that everyone will leave at the first opportunity justified with certainty.</li><li>Decisions happen together. Departures become visible at the next morning's head count.</li><li>A truthful visitor makes one announcement in front of everyone.</li></ol><div class="quote">“At least one of you<br>has green eyes.”</div><p>One green-eyed prisoner sees none and can leave on the first night. Two each wait for the other; when neither leaves on night one, both deduce their colour and leave on night two. The same argument continues.</p><p>The classic 100-prisoner group leaves together on night 100.</p><a href="https://www.ted.com/talks/alex_gendler_can_you_solve_the_famously_difficult_green_eyed_logic_puzzle" target="_blank" rel="noreferrer">Watch the original TED-Ed puzzle ↗</a></section><div class="right-stack"><section class="card guide-card"><h2>Common knowledge</h2><p>Seeing a fact is different from knowing what everyone else knows about it. A publicly witnessed announcement establishes a premise that everyone knows, everyone knows everyone knows, and so on.</p><p>In the ideal model, each silent night eliminates another hypothetical situation. This is why the morning head count matters.</p><div class="formula">Departure night = G − q + 1</div><p>Here G is the actual number of green-eyed prisoners and q is the public lower bound. Count from the first night after the announcement. A delayed announcement shifts the departure night by the delay.</p></section><section class="card guide-card"><h2>What this lab measures</h2><p>Reference agents follow the proven policy. AI agents receive only their private observations and history; their reasoning can succeed or fail.</p><p>Survival alone is not a successful deduction. A green-eyed agent that guesses early survives, but departs before the shared information justifies it.</p><p>Once a run diverges, the original ideal history no longer applies. The lab records that first divergence and preserves what happens afterward.</p><p>Try different populations, mixed colours, stronger announcements, and the no-announcement control. A familiar answer alone does not establish independent reasoning.</p><a href="https://xkcd.com/solution.html" target="_blank" rel="noreferrer">Read the induction argument ↗</a></section></div></div>`;
}
function openExperimentDialog(duplicate=false) {
  if(isButtonGame()){openButtonExperimentDialog(duplicate);return;}
  if(state.busy) return;
  const cfg=duplicate?{...currentConfig()}:state.run?defaults():{...state.draft};
  const dialog=document.getElementById('experiment-dialog');
  dialog.innerHTML=`<form id="experiment-form"><div class="modal-head"><div><h2>${duplicate?'Repeat an experiment':'New experiment'}</h2></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Close experiment dialog">${icon('close')}</button></div><div class="modal-body"><div class="form-error" role="alert"></div><div class="field"><label for="run-name">Experiment name</label><input id="run-name" name="name" maxlength="80" value="${esc(cfg.name==='Island experiment'?configName(cfg):cfg.name)}" required></div><div class="field-row"><div class="field"><label for="run-population">Prisoners</label><input id="run-population" name="population" type="number" min="1" max="100" value="${cfg.population}" required></div><div class="field"><label for="run-green">Green-eyed prisoners</label><input id="run-green" name="green_count" type="number" min="0" max="100" value="${cfg.green_count}" required></div></div><div class="field"><label for="run-announcement">Visitor's announcement</label><select id="run-announcement" name="announcement"><option value="public" ${cfg.announcement==='public'?'selected':''}>Public, truthful announcement</option><option value="none" ${cfg.announcement==='none'?'selected':''}>No announcement</option></select></div><div class="field-row"><div class="field"><label for="run-minimum">At least this many green</label><input id="run-minimum" name="minimum_green" type="number" min="1" max="100" value="${cfg.minimum_green}" required></div><div class="field"><label for="run-delay">Nights before announcement</label><input id="run-delay" name="announcement_delay" type="number" min="0" max="200" value="${cfg.announcement_delay}" required></div></div><div class="field"><label for="run-policy">Agent policy</label><select id="run-policy" name="mode"><option value="reference" ${cfg.mode==='reference'?'selected':''}>Logical reference · scripted, no model required</option><option value="model" ${cfg.mode==='model'?'selected':''} ${!state.providers.length?'disabled':''}>Independent AI agents</option></select></div>${state.providers.length?`<div class="field"><label for="run-provider">AI model connection</label><select id="run-provider" name="provider_id">${providerOptions(cfg.provider_id)}</select></div>`:''}<details><summary>Run limits and reproducibility</summary><div class="field-row"><div class="field"><label for="run-nights">Maximum nights</label><input id="run-nights" name="max_nights" type="number" min="1" max="500" value="${cfg.max_nights}" required></div><div class="field"><label for="run-calls">Maximum model requests</label><input id="run-calls" name="max_model_calls" type="number" min="1" max="50000" value="${cfg.max_model_calls}" required></div></div><div class="field"><label for="run-seed">Population seed</label><input id="run-seed" name="seed" type="number" min="0" max="2147483647" value="${cfg.seed}" required></div></details></div><div class="modal-footer">${button('Cancel','close-dialog','close','btn-quiet')}<button class="btn btn-primary" type="submit">${icon('plus')}Create experiment</button></div></form>`;
  dialog.showModal();
}
function openProviderDialog(id=null) {
  const p=state.providers.find(p=>p.id===id)||{name:'Local Ollama',kind:'ollama',base_url:'http://localhost:11434',model:'',max_output_tokens:2048,context_length:8192,timeout:180,temperature:0,thinking:'default',output_format:'schema'};
  const dialog=document.getElementById('provider-dialog');
  dialog.innerHTML=`<form id="provider-form" data-id="${esc(id||'')}"><div class="modal-head"><div><h2>${id?'Edit model connection':'Connect a model'}</h2><p>One loaded model. A separate private history for every prisoner.</p></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Close model dialog">${icon('close')}</button></div><div class="modal-body"><div class="form-error" role="alert"></div><div class="field"><label for="provider-name">Connection name</label><input id="provider-name" name="name" value="${esc(p.name)}" maxlength="80" required></div><div class="field"><label for="provider-kind">Server type</label><select id="provider-kind" name="kind"><option value="ollama" ${p.kind==='ollama'?'selected':''}>Ollama</option><option value="compatible" ${p.kind==='compatible'?'selected':''}>OpenAI-compatible · LM Studio or another server</option></select></div><div class="field"><label for="provider-url">Server address</label><input id="provider-url" name="base_url" type="url" value="${esc(p.base_url)}" required><p class="field-hint">Use the server's base address. Compatible endpoints usually end in /v1.</p></div><div class="field"><label for="provider-model">Model name</label><input id="provider-model" name="model" value="${esc(p.model)}" placeholder="e.g. qwen3:4b" maxlength="200" required></div><div class="field"><label for="provider-key">API key <span class="muted">Optional for local servers</span></label><input id="provider-key" name="api_key" type="password" autocomplete="new-password" placeholder="${p.has_api_key?'A key is saved for this session. Leave blank to keep it.':'Enter only if your server requires one'}"><p class="field-hint">Keys stay in server memory and are cleared on restart. They are never written into run exports.</p>${p.has_api_key?'<label style="justify-content:flex-start;gap:8px;margin-top:9px"><input type="checkbox" name="clear_api_key" style="width:auto;min-height:0">Forget the saved key</label>':''}</div><details><summary>Generation settings and compatibility</summary><div class="field-row"><div class="field"><label for="provider-output">Maximum generated tokens</label><input id="provider-output" name="max_output_tokens" type="number" min="128" max="32000" value="${p.max_output_tokens}" required></div><div class="field"><label for="provider-timeout">Request timeout (seconds)</label><input id="provider-timeout" name="timeout" type="number" min="5" max="600" value="${p.timeout}" required></div></div><div class="field-row"><div class="field"><label for="provider-context">Ollama context length</label><input id="provider-context" name="context_length" type="number" min="1024" max="131072" value="${p.context_length}" required></div><div class="field"><label for="provider-temperature">Temperature</label><input id="provider-temperature" name="temperature" type="number" min="0" max="2" step="0.1" value="${p.temperature}" required></div></div><div class="field-row"><div class="field"><label for="provider-format">Output format</label><select id="provider-format" name="output_format"><option value="schema" ${p.output_format==='schema'?'selected':''}>Enforced JSON schema</option><option value="json" ${p.output_format==='json'?'selected':''}>JSON mode</option><option value="prompt" ${p.output_format==='prompt'?'selected':''}>Prompt only</option></select></div><div class="field"><label for="provider-thinking">Ollama thinking</label><select id="provider-thinking" name="thinking"><option value="default" ${p.thinking==='default'?'selected':''}>Model default</option><option value="on" ${p.thinking==='on'?'selected':''}>On (if supported)</option><option value="off" ${p.thinking==='off'?'selected':''}>Off (if supported)</option></select></div></div><p class="field-hint">Output tokens include any model thinking. An incomplete or invalid response interrupts the run; it never becomes an invented decision. Temperature and token settings must be supported by your chosen server.</p></details></div><div class="modal-footer">${button('Cancel','close-dialog','close','btn-quiet')}<button class="btn btn-primary" type="submit">${icon('check')}Save connection</button></div></form>`;
  dialog.showModal();
}
async function refreshData() {
  const [runs,providers]=await Promise.all([api('/api/runs'),api('/api/providers')]);
  state.runs=runs.runs;state.providers=providers.providers;
}
async function ensureRun() {
  if(state.run) return;
  const config={...state.draft,name:['Island experiment','Button dilemma'].includes(state.draft.name)?configName(state.draft):state.draft.name};
  state.run=await api('/api/runs',config);
  state.cursor=0;
  await refreshData();
}
async function stepRun() {
  if(state.busy||terminal(state.run)) return;
  state.busy=true;
  let progressTimer;
  try {
    await ensureRun();
    if(state.run.config.mode==='model') {
      state.progress={completed:0,total:isButtonGame()?state.run.players.length:state.run.prisoners.filter(p=>p.status==='imprisoned').length,elapsed_seconds:0};
      progressTimer=setInterval(async()=>{
        try {
          const progress=await api(`/api/runs/${state.run.id}/progress`);
          if(progress.active) {
            state.progress=progress;
            const element=document.getElementById('decision-progress');
            if(element) element.textContent=progressText();
          }
        } catch { /* The step request reports connection failures. */ }
      },1000);
    }
    render();
    state.run=await api(`/api/runs/${state.run.id}/step`,{});
    state.cursor=state.run.night;
    if(terminal(state.run)) state.autoplay=false;
    await refreshData();
    if(state.run.status==='failed') toast('The agent response interrupted this run. No partial decision round was committed.',true);
    else if(state.run.status==='completed') toast(isButtonGame()?(state.run.config.mode==='placeholder'?'Scripted vote complete. All ballots and outcomes are saved.':'AI vote complete. All ballots and outcomes are saved.'):(state.run.config.mode==='reference'?'Reference run complete. Every decision has been saved.':'AI run complete. Open the archive to compare results.'));
    else if(state.run.status==='limit_reached') toast('Run limit reached. Completed decisions are saved.');
  } catch(error) {state.autoplay=false;toast(error.message,true);}
  finally {clearInterval(progressTimer);state.progress=null;state.busy=false;render();}
}
async function play() {
  if(state.autoplay) {state.autoplay=false;render();return;}
  if(state.busy||terminal(state.run)||state.loopActive) return;
  state.autoplay=true;state.loopActive=true;
  try {
    while(state.autoplay&&!terminal(state.run)) {
      await stepRun();
      if(state.autoplay) await new Promise(resolve=>setTimeout(resolve,state.speed));
    }
  } finally {state.loopActive=false;state.autoplay=false;render();}
}
async function navigate(page) {
  if(page==='guide')state.guideGame=currentConfig().game||'island';
  state.page=page;location.hash=page;
  if(page==='archive'||page==='models') {
    try {await refreshData();} catch(error) {toast(error.message,true);}
  }
  render();
}
async function inspectLog() {
  if(isButtonGame()){inspectButtonLog();return;}
  const history=state.run?.histories[state.selected]||[];
  const dialog=document.getElementById('experiment-dialog');
  const current=history.filter(e=>e.observation.night<=state.cursor);
  dialog.innerHTML=`<div class="modal-head"><div><h2>${state.selected}'s private record</h2><p>Only observations and decisions supplied to this prisoner.</p></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Close private record">${icon('close')}</button></div><div class="modal-body"><p class="field-hint" style="margin:0 0 16px">${current.length} decision${current.length===1?'':'s'} through the selected replay night. The prisoner's own colour is absent from every observation.</p>${current.map(e=>`<div style="margin-bottom:19px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px"><strong style="font-size:12px">Night ${e.observation.night}</strong>${badge(e.decision.action,e.decision.action==='leave'?'green':'gray')}</div><p class="thought-note">${esc(e.decision.justification)}</p><details><summary>Exact private observation</summary><pre class="dialog-log">${esc(JSON.stringify(e.observation,null,2))}</pre></details></div>`).join('')||'<p class="thought-note empty">This prisoner has not made a decision at the selected night.</p>'}</div><div class="modal-footer">${button('Close','close-dialog','check')}</div>`;
  dialog.showModal();
}
function compareRuns() {
  const runs=state.compare.map(id=>state.runs.find(r=>r.id===id)).filter(Boolean);
  if(runs.length!==2)return;
  if(isButtonGame(runs[0].config)!==isButtonGame(runs[1].config)){toast('Choose two runs of the same experiment to compare.');return;}
  const buttons=isButtonGame(runs[0].config),dialog=document.getElementById('experiment-dialog');
  const rows=buttons?[['Policy',r=>r.provider_name],['Participants',r=>r.config.population],['Button 1 votes',r=>r.result?.button_1_votes??'Pending'],['Button 2 votes',r=>r.result?.button_2_votes??'Pending'],['Survivors',r=>r.result?.survivors??'Pending'],['Deaths',r=>r.result?.deaths??'Pending'],['Tie rule',r=>r.config.tie_rule==='button_2_loses'?'Button 2 loses':'Everyone survives'],['Exact tie',r=>r.result?(r.result.tied?'Yes':'No'):'Pending'],['Model calls',r=>r.usage.model_calls],['Run status',r=>labels[r.status]]]:[['Policy',r=>r.provider_name],['Population',r=>r.config.population],['Green-eyed',r=>r.config.green_count],['Completed nights',r=>r.night],['Released',r=>r.released],['Killed',r=>r.killed],['Model calls',r=>r.usage.model_calls],['Reported input tokens',r=>r.usage.input_tokens],['Reported output tokens',r=>r.usage.output_tokens],['Ideal departure night',r=>r.benchmark.expected_night??'None'],['First divergence',r=>r.benchmark.first_divergence?`Night ${r.benchmark.first_divergence.night} · ${r.benchmark.first_divergence.category.replaceAll('_',' ')}`:'None observed'],['Run status',r=>labels[r.status]]];
  dialog.innerHTML=`<div class="modal-head"><div><h2>Compare experiments</h2><p>${buttons?'Button dilemma · recorded votes and survival outcomes.':'Green-eyed island · recorded decisions and reference outcomes.'}</p></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Close comparison">${icon('close')}</button></div><div class="table-scroll"><table class="archive-table comparison-table"><thead><tr><th>MEASURE</th>${runs.map(r=>`<th>${esc(r.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(([name,fn])=>`<tr><td>${name}</td>${runs.map(r=>`<td>${esc(fn(r))}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="modal-footer">${button('Close','close-dialog','check')}</div>`;
  dialog.showModal();
}

document.addEventListener('click',async event=>{
  const target=event.target.closest('button,a');
  if(!target||target.disabled) return;
  if(target.dataset.page){event.preventDefault();await navigate(target.dataset.page);return;}
  const action=target.dataset.action;
  if(!action) return;
  event.preventDefault();
  try {
    if(action==='switch-game') switchGame(target.dataset.game);
    else if(action==='guide-game'){state.guideGame=target.dataset.game;render();}
    else if(action==='vote') await stepRun();
    else if(action==='play') await play();
    else if(action==='step') await stepRun();
    else if(action==='new'||action==='duplicate') openExperimentDialog(action==='duplicate');
    else if(action==='close-dialog') target.closest('dialog').close();
    else if(action==='select-prisoner'){state.selected=target.dataset.id;refreshPreview();}
    else if(action==='toggle-ballots'&&isButtonGame()){state.showAllBallots=!state.showAllBallots;document.getElementById('voting-room').innerHTML=renderVotingRoom();}
    else if(action==='view-observer'||action==='view-prisoner'){state.view=action==='view-observer'?'observer':'prisoner';render();}
    else if(action==='seek'&&!state.busy&&!state.autoplay){state.cursor=Number(target.dataset.night);render();}
    else if(action==='export'&&state.run){location.href=`/api/runs/${state.run.id}/export`;}
    else if(action==='go-experiment') await navigate('experiment');
    else if(action==='open-run'&&!state.busy){state.autoplay=false;state.run=await api(`/api/runs/${target.dataset.id}`);state.cursor=state.run.night;state.showAllBallots=false;state.selected=isButtonGame()?'A01':'P01';await navigate('experiment');}
    else if(action==='inspect-log') await inspectLog();
    else if(action==='add-provider') openProviderDialog();
    else if(action==='edit-provider') openProviderDialog(target.dataset.id);
    else if(action==='use-model'&&!state.busy){state.autoplay=false;state.draft={...currentConfig(),mode:'model',provider_id:target.dataset.id};state.run=null;state.cursor=0;state.selected=isButtonGame()?'A01':'P01';await navigate('experiment');}
    else if(action==='test-provider') {
      target.disabled=true;target.textContent='Connecting…';
      try {const result=await api(`/api/providers/${target.dataset.id}/test`,{});state.connections[target.dataset.id]=result;toast(result.message);}
      catch(error){state.connections[target.dataset.id]={reachable:false,message:error.message};toast(error.message,true);}
      finally {render();}
    }
    else if(action==='use-reference'&&!state.busy){state.autoplay=false;state.run=null;state.draft=defaults();state.cursor=0;state.selected='P01';await navigate('experiment');}
    else if(action==='use-placeholders'&&!state.busy){state.autoplay=false;state.run=null;state.draft=buttonDefaults();state.cursor=0;state.selected='A01';await navigate('experiment');}
    else if(action==='compare') compareRuns();
  } catch(error){toast(error.message,true);}
});
document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!['experiment-form','provider-form'].includes(form.id)) return;
  event.preventDefault();
  const submit=form.querySelector('[type=submit]'),errorElement=form.querySelector('.form-error');
  const values=Object.fromEntries(new FormData(form));
  errorElement.textContent='';submit.disabled=true;
  try {
    if(form.id==='experiment-form'){
      if(state.busy) throw new Error('Wait for the current decision round to finish first.');
      state.autoplay=false;
      const run=await api('/api/runs',values);
      state.run=run;state.draft={...run.config};state.cursor=0;state.showAllBallots=false;state.selected=isButtonGame()?'A01':'P01';
      form.closest('dialog').close();await refreshData();await navigate('experiment');toast(isButtonGame()?'Experiment created. Press Run the vote to resolve all choices together.':'Experiment created. Step a night or press Run experiment.');
    }else{
      if(form.dataset.id) values.id=form.dataset.id;
      values.clear_api_key=values.clear_api_key==='on';
      await api('/api/providers',values);
      form.closest('dialog').close();await refreshData();render();toast('Model connection saved. Use Test connection when your server is running.');
    }
  }catch(error){errorElement.textContent=error.message;submit.disabled=false;}
});
document.addEventListener('input',event=>{
  const el=event.target;
  if(handleButtonInput(el))return;
  if(el.id==='archive-search'){
    state.search=el.value;
    const start=el.selectionStart;render();
    const input=document.getElementById('archive-search');input.focus();input.setSelectionRange(start,start);return;
  }
  if(el.id==='replay-slider'){
    state.cursor=Number(el.value);refreshPreview(true);
    document.querySelector('.replay-row>span:last-child').textContent=String(state.cursor).padStart(2,'0');
    document.querySelectorAll('.timeline-col').forEach(bar=>bar.classList.toggle('active',Number(bar.dataset.night)===state.cursor));
    return;
  }
  if(!el.dataset.config||state.run) return;
  const key=el.dataset.config;
  if(['population','green_count','minimum_green'].includes(key)){
    if(!el.value) return;
    state.draft[key]=Number(el.value);
    state.draft.population=Math.min(100,Math.max(1,state.draft.population));
    state.draft.green_count=Math.max(0,Math.min(state.draft.population,state.draft.green_count));
    if(state.draft.announcement==='public'){
      state.draft.minimum_green=Math.max(1,Math.min(state.draft.population,state.draft.minimum_green));
      state.draft.green_count=Math.max(state.draft.minimum_green,state.draft.green_count);
    }
    const population=document.getElementById('population'),green=document.getElementById('green-count'),minimum=document.getElementById('minimum-green');
    population.value=state.draft.population;green.max=state.draft.population;green.min=state.draft.announcement==='public'?state.draft.minimum_green:0;green.value=state.draft.green_count;minimum.max=state.draft.green_count||100;minimum.value=state.draft.minimum_green;
    document.getElementById('population-value').textContent=state.draft.population;
    document.getElementById('green-value').textContent=state.draft.green_count;
    refreshPreview();
  }
});
document.addEventListener('change',event=>{
  const el=event.target;
  if(handleButtonChange(el))return;
  if(el.id==='speed-select'){state.speed=Number(el.value);return;}
  if(el.dataset.compare){
    if(el.checked&&state.compare.length>=2){el.checked=false;toast('Choose two runs to compare.');return;}
    state.compare=el.checked?[...state.compare,el.dataset.compare]:state.compare.filter(id=>id!==el.dataset.compare);render();return;
  }
  if(el.id==='provider-kind'){
    const address=document.getElementById('provider-url');
    if(['http://localhost:11434','http://localhost:1234/v1'].includes(address.value)) address.value=el.value==='ollama'?'http://localhost:11434':'http://localhost:1234/v1';return;
  }
  if(!el.dataset.config||state.run) return;
  if(el.dataset.config==='scenario'){
    const cfg=state.draft;
    cfg.announcement=el.value==='silent'?'none':'public';cfg.minimum_green=el.value==='stronger'?Math.min(2,cfg.population):1;
    cfg.green_count=el.value==='mixed'?Math.max(1,Math.floor(cfg.population*.6)):cfg.population;
    cfg.green_count=Math.max(cfg.green_count,cfg.minimum_green);render();
  }else if(el.dataset.config==='mode'){
    state.draft.mode=el.value;
    if(el.value==='model') state.draft.provider_id=state.providers[0]?.id;
    render();
  }else if(el.dataset.config==='provider_id'){state.draft.provider_id=el.value;render();}
});
for(const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
window.addEventListener('hashchange',()=>{const page=location.hash.slice(1);if(['experiment','archive','models','guide'].includes(page)&&page!==state.page){state.page=page;render();}});
async function init(){
  document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
  document.getElementById('workspace').innerHTML='<div class="loading-state">Opening your local workspace…</div>';
  try{
    await refreshData();
    const page=location.hash.slice(1);if(['experiment','archive','models','guide'].includes(page))state.page=page;
    render();
  }catch(error){document.getElementById('workspace').innerHTML=`<div class="error-banner">${esc(error.message)} Refresh the page after restarting the local server.</div>`;}
}
init();
