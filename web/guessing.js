'use strict';

function isGuessingGame(config=currentConfig()) { return config?.game==='guessing'; }
function guessingDefaults() { return {game:'guessing',name:'Two-thirds game',population:5,seed:42,mode:'placeholder',provider_id:null,max_model_calls:500}; }
function guessingConfigName(config) { return `${config.population} participants · two-thirds of the average`; }
function guessingPlayers() {
  return state.run?.players||Array.from({length:state.draft.population},(_,i)=>({id:`A${String(i+1).padStart(2,'0')}`,status:'waiting',guess:null}));
}
function guessingResult() { return state.cursor===1?state.run?.result:null; }
function guessNumber(number) { return Number(number).toFixed(2).replace(/\.00$/,''); }
function renderGuessingStats() {
  const cfg=currentConfig(),result=guessingResult();
  return [['PARTICIPANTS',cfg.population,cfg.population===1?'person':'people'],['AVERAGE',result?guessNumber(result.average):'—',''],['2/3 TARGET',result?guessNumber(result.target):'—',''],['WINNERS',result?result.winner_ids.length:'—',result?.winner_ids.length===1?'person':'people']]
    .map(([label,value,suffix])=>`<div class="stat"><div class="stat-top"><span>${label}</span>${icon('chart')}</div><div class="stat-number">${value}${suffix?`<small>${suffix}</small>`:''}</div></div>`).join('');
}
function renderGuessingConfig() {
  const cfg=currentConfig(),disabled=state.run?'disabled':'';
  return `<div><section class="card config-card"><div class="config-title"><h2>Round setup</h2>${icon('settings')}</div><div class="button-config-form">
    <div class="field"><label for="guess-population">Participants <span class="label-value" id="guess-population-value">${cfg.population}</span></label><input id="guess-population" type="range" min="1" max="100" value="${cfg.population}" data-guess-config="population" ${disabled}><div class="range-labels"><span>1</span><span>100</span></div></div>
    <div class="field"><label>Allowed guesses</label><p class="field-hint">Whole numbers from 0 to 100. Closest to ⅔ of the average wins; ties share the win.</p></div>
    <div class="section-divider"></div><div class="field"><label for="guess-policy">Agent policy</label><select id="guess-policy" data-guess-config="mode" ${disabled}><option value="placeholder" ${cfg.mode==='placeholder'?'selected':''}>Seeded random guesses</option><option value="model" ${cfg.mode==='model'?'selected':''} ${!state.providers.length?'disabled':''}>Independent AI agents</option></select></div>
    ${cfg.mode==='model'?`<div class="field"><label for="guess-provider">Model connection</label><select id="guess-provider" data-guess-config="provider_id" ${disabled}>${providerOptions(cfg.provider_id)}</select></div>`:''}
  </div></section></div>`;
}
function renderGuessingRoom() {
  const players=guessingPlayers(),result=guessingResult();
  if(!players.some(p=>p.id===state.selected))state.selected=players[0]?.id;
  const shown=state.showAllBallots?players:players.slice(0,12);
  return `<div class="guess-rules"><div class="guess-rule-number">⅔</div><div><strong>Closest to two-thirds of the average wins</strong><p>Each participant privately chooses a whole number from 0 to 100. Their own guess also affects the average.</p></div></div>
    <div class="guess-scale"><span>0</span><div class="guess-track">${result?`<i class="guess-target" style="left:${result.target}%" title="Target: ${guessNumber(result.target)}"></i>`:''}</div><span>100</span></div>
    <div class="ballot-label"><span class="tiny-eyebrow">PRIVATE GUESSES</span><span>${players.length} participants</span></div>
    <div class="ballot-grid">${shown.map(p=>`<button type="button" class="ballot-agent ${p.id===state.selected?'selected':''} ${result?'guess-revealed':'sealed'} ${result?.winner_ids.includes(p.id)?'guess-winner':''}" data-action="select-prisoner" data-id="${p.id}" aria-label="Inspect participant ${p.id}" aria-pressed="${p.id===state.selected}"><span class="ballot-disc">${result?p.guess:icon('lock')}<span class="ballot-status"></span></span><span>${p.id}</span>${result?`<small>${result.winner_ids.includes(p.id)?'Winner':'Finished'}</small>`:''}</button>`).join('')}</div>
    ${players.length>12?`<div class="ballot-more">${button(state.showAllBallots?'Show fewer':`Show all ${players.length}`,'toggle-guesses','people','btn-small')}</div>`:''}`;
}
function renderGuessingControls() {
  const finished=terminal(state.run),resolved=state.run?.status==='completed';
  return `<div class="control-bar"><div class="control-actions">${button(state.busy?'Collecting guesses…':resolved?'Round resolved':finished?'Round interrupted':'Run the round','guess-round',state.busy?'clock':resolved?'check':finished?'info':'play','btn-primary',state.busy||finished)}${finished?button('New round','duplicate','plus','',state.busy):''}</div>${state.busy||finished&&!resolved?`<span class="control-status" id="decision-progress">${state.busy&&state.run?.config.mode==='model'?progressText():state.busy?'Guesses stay sealed until all return':'No partial round was applied'}</span>`:''}</div>`;
}
function renderGuessingInspector() {
  const players=guessingPlayers(),player=players.find(p=>p.id===state.selected)||players[0],result=guessingResult(),entry=result?state.run?.histories[player?.id]?.[0]:null;
  return `<div class="card-head"><div class="prisoner-switch"><span class="prisoner-avatar">${player?.id||'A01'}</span><div><h2>Participant</h2></div></div>${badge(result?result.winner_ids.includes(player.id)?'Winner':'Finished':'Sealed',result?.winner_ids.includes(player?.id)?'green':'gray')}</div>
    <div class="inspector-body"><div class="inspector-meta"><span>Other guesses</span><strong class="eye-hidden">${icon(result?'check':'hidden')} ${result?'Revealed after round':'Hidden until reveal'}</strong></div><div class="inspector-meta"><span>Knows</span><strong>0–100 · ⅔ target · ${currentConfig().population} players</strong></div>
    ${entry?`<div class="inspector-meta"><span>Guess</span><strong>${entry.decision.guess}</strong></div><span class="tiny-eyebrow" style="display:block;margin-top:14px">${currentConfig().mode==='placeholder'?'SCRIPTED ASSIGNMENT':'AGENT JUSTIFICATION'}</span><p class="thought-note">${esc(entry.decision.justification)}</p>`:''}
    <div class="inspector-bottom inspector-actions"><button class="text-button" type="button" data-action="inspect-log" ${!state.run?'disabled':''}>Full record ${icon('arrow')}</button></div></div>`;
}
function renderGuessingResult() {
  const result=guessingResult(),players=guessingPlayers();
  return `<div class="card-head"><div><h2>Result</h2><p>Target = average × ⅔</p></div>${icon('chart')}</div><div class="timeline-body">${result?`<div class="guess-equation">${guessNumber(result.average)} <span>× ⅔ =</span> <strong>${guessNumber(result.target)}</strong></div><p class="vote-outcome">${result.winner_ids.length===1?'Winner':'Winners'}: ${result.winner_ids.map(id=>`${id} (${result.winning_guesses[id]})`).join(', ')}. ${result.winner_ids.length>1?'Exact closest-distance tie.':''}</p><div class="guess-result-list">${[...players].sort((a,b)=>Math.abs(a.guess-result.target)-Math.abs(b.guess-result.target)).slice(0,8).map(p=>`<div><span>${p.id}</span><strong>${p.guess}</strong>${result.winner_ids.includes(p.id)?badge('Winner','green'):''}</div>`).join('')}</div>`:'<p class="thought-note empty">The average, target, and winners appear after every guess is submitted.</p>'}<div class="replay-row"><span>Replay</span><input id="guess-replay" type="range" min="0" max="1" value="${state.cursor}" ${!state.run?.result||state.busy?'disabled':''} aria-label="Replay guessing round"><span>${state.cursor?'After':'Before'}</span></div></div>`;
}
function renderGuessingExperiment() {
  const cfg=currentConfig(),run=state.run,result=guessingResult();
  const policy=cfg.mode==='placeholder'?'Seeded random guesses · no AI calls':`AI agents · ${esc(run?.provider?.name||state.providers.find(p=>p.id===cfg.provider_id)?.name||'your model')}`;
  return gamePicker('guessing')+heading('','Two-thirds game','',`${run?button('Export','export','download','btn-quiet'):''}${button('New experiment','new','plus','',state.busy)}`)+`${run?.error?`<div class="error-banner"><strong>Round interrupted.</strong> ${esc(run.error)}</div>`:''}<div class="notice">${icon('info')}<span>${policy}</span></div><div class="stat-grid" id="stat-container">${renderGuessingStats()}</div><div class="experiment-layout">${renderGuessingConfig()}<div class="right-stack"><section class="card"><div class="card-head"><div><h2>Guessing room</h2>${run?`<p>${esc(run.config.name)}</p>`:''}</div>${badge(result?'Resolved':'Sealed',result?'green':'gray')}</div><div id="guessing-room">${renderGuessingRoom()}</div><div id="control-area">${renderGuessingControls()}</div></section><div class="below-grid"><section class="card inspector" id="inspector-card">${renderGuessingInspector()}</section><section class="card" id="timeline-card">${renderGuessingResult()}</section></div></div></div>`;
}
function refreshGuessingPreview() {
  for(const [id,fn] of [['stat-container',renderGuessingStats],['guessing-room',renderGuessingRoom],['inspector-card',renderGuessingInspector],['timeline-card',renderGuessingResult]]){
    const el=document.getElementById(id);if(el)el.innerHTML=fn();
  }
}
function openGuessingExperimentDialog(duplicate=false) {
  if(state.busy)return;
  const cfg=duplicate?{...currentConfig()}:state.run?guessingDefaults():{...state.draft};
  const dialog=document.getElementById('experiment-dialog');
  dialog.innerHTML=`<form id="experiment-form"><input type="hidden" name="game" value="guessing"><div class="modal-head"><div><h2>${duplicate?'Repeat a guessing round':'New two-thirds experiment'}</h2><p>Everyone chooses once, in private.</p></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Close experiment dialog">${icon('close')}</button></div><div class="modal-body"><div class="form-error" role="alert"></div><div class="field"><label for="run-name">Experiment name</label><input id="run-name" name="name" maxlength="80" value="${esc(cfg.name==='Two-thirds game'?guessingConfigName(cfg):cfg.name)}" required></div><div class="field"><label for="run-population">Participants</label><input id="run-population" name="population" type="number" min="1" max="100" value="${cfg.population}" required></div><div class="field"><label for="run-policy">Agent policy</label><select id="run-policy" name="mode"><option value="placeholder" ${cfg.mode==='placeholder'?'selected':''}>Seeded random guesses · no model calls</option><option value="model" ${cfg.mode==='model'?'selected':''} ${!state.providers.length?'disabled':''}>Independent AI agents</option></select></div>${state.providers.length?`<div class="field"><label for="run-provider">AI model connection</label><select id="run-provider" name="provider_id">${providerOptions(cfg.provider_id)}</select></div>`:''}<details><summary>Request limit and reproducibility</summary><div class="field-row"><div class="field"><label for="run-seed">Random seed</label><input id="run-seed" name="seed" type="number" min="0" max="2147483647" value="${cfg.seed}" required></div><div class="field"><label for="run-calls">Maximum model requests</label><input id="run-calls" name="max_model_calls" type="number" min="1" max="50000" value="${cfg.max_model_calls}" required></div></div><p class="field-hint">The seed fixes scripted guesses. Model agents choose independently.</p></details></div><div class="modal-footer">${button('Cancel','close-dialog','close','btn-quiet')}<button class="btn btn-primary" type="submit">${icon('plus')}Create experiment</button></div></form>`;
  dialog.showModal();
}
function inspectGuessingLog() {
  const history=state.cursor===1?state.run?.histories[state.selected]||[]:[];
  const dialog=document.getElementById('experiment-dialog');
  dialog.innerHTML=`<div class="modal-head"><div><h2>${state.selected}'s private record</h2></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Close private record">${icon('close')}</button></div><div class="modal-body">${history.map(e=>`<div style="margin-bottom:19px">${badge(`Guess ${e.decision.guess}`,'green')}<p class="thought-note">${esc(e.decision.justification)}</p><details open><summary>Exact private observation</summary><pre class="dialog-log">${esc(JSON.stringify(e.observation,null,2))}</pre></details></div>`).join('')||'<p class="thought-note empty">No guess is visible at this replay position.</p>'}</div><div class="modal-footer">${button('Close','close-dialog','check')}</div>`;
  dialog.showModal();
}
function handleGuessingInput(el) {
  if(el.id==='guess-replay'){state.cursor=Number(el.value);refreshGuessingPreview();return true;}
  if(el.dataset.guessConfig==='population'&&!state.run){state.draft.population=Number(el.value);document.getElementById('guess-population-value').textContent=el.value;refreshGuessingPreview();return true;}
  return false;
}
function handleGuessingChange(el) {
  if(!el.dataset.guessConfig||state.run)return false;
  if(el.dataset.guessConfig==='mode'){state.draft.mode=el.value;if(el.value==='model')state.draft.provider_id=state.providers[0]?.id;render();return true;}
  if(el.dataset.guessConfig==='provider_id'){state.draft.provider_id=el.value;render();return true;}
  return el.dataset.guessConfig==='population';
}
function renderGuessingGuide() {
  return gamePicker('guessing',true)+heading('','Two-thirds game rules','')+`<div class="guide-grid"><section class="card guide-card"><h2>One private guess</h2><ol><li>Every participant chooses one whole number from 0 to 100.</li><li>All choices are made independently, without communication or seeing anyone else's guess.</li><li>Take the arithmetic average of all guesses, including your own, and multiply it by ⅔.</li><li>The guess closest to that target wins. If several guesses are equally close, they share the win.</li></ol><div class="quote">Target = ⅔ × average</div><p>For guesses 20, 40, and 60, the average is 40 and the target is 26⅔. The guess 20 wins.</p></section><div class="right-stack"><section class="card guide-card"><h2>Why guesses tend to fall</h2><p>The target can never exceed 66⅔, so a guess above that cannot be the closest against a lower alternative. If everyone reasons similarly, they may choose lower numbers again. Repeating that reasoning points toward 0.</p><p>Actual choices depend on what each participant expects others to do. The lab records those choices, the final target, and the winner without treating any one guess as a universal correct answer.</p></section><section class="card guide-card"><h2>Agent choices</h2><p>Seeded placeholders draw independent whole-number guesses uniformly from 0 to 100. They are a quick demonstration, not strategic agents.</p><p>AI agents each receive the rules and participant count, then answer separately. Their guesses stay sealed until the full round completes.</p></section></div></div>`;
}
