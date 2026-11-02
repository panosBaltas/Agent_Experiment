'use strict';

function isButtonGame(config=currentConfig()) { return config?.game==='buttons'; }
function buttonDefaults() { return {game:'buttons',name:'Button dilemma',population:5,button_2_count:3,tie_rule:'button_2_loses',seed:42,mode:'placeholder',provider_id:null,max_model_calls:500}; }
function buttonConfigName(config) { return `${config.population} participants · ${config.mode==='placeholder'?`${config.button_2_count} choose Button 2`:'button dilemma'}`; }
function gamePicker(game='island',guide=false) {
  const action=guide?'guide-game':'switch-game';
  return `<div class="game-picker"><div class="game-tabs" role="group" aria-label="Choose experiment"><button type="button" class="game-tab ${game==='island'?'active':''}" data-action="${action}" data-game="island" aria-pressed="${game==='island'}" ${!guide&&(state.busy||state.autoplay)?'disabled':''}>${icon('eye')}Green-eyed island</button><button type="button" class="game-tab ${game==='buttons'?'active':''}" data-action="${action}" data-game="buttons" aria-pressed="${game==='buttons'}" ${!guide&&(state.busy||state.autoplay)?'disabled':''}>${icon('buttons')}Button dilemma</button><button type="button" class="game-tab ${game==='guessing'?'active':''}" data-action="${action}" data-game="guessing" aria-pressed="${game==='guessing'}" ${!guide&&(state.busy||state.autoplay)?'disabled':''}>${icon('chart')}Two-thirds game</button></div></div>`;
}
function switchGame(game) {
  if(state.busy||state.autoplay||!['island','buttons','guessing'].includes(game)) return;
  if((currentConfig().game||'island')===game&&state.page==='experiment') return;
  state.gameDrafts=state.gameDrafts||{};
  state.gameDrafts[currentConfig().game||'island']={...currentConfig()};
  state.run=null;state.draft={...(state.gameDrafts[game]||(game==='buttons'?buttonDefaults():game==='guessing'?guessingDefaults():defaults()))};
  state.cursor=0;state.showAllBallots=false;state.selected=game==='island'?'P01':'A01';state.view='observer';state.page='experiment';
  location.hash='experiment';render();
}
function buttonPlayers() {
  return state.run?.players||Array.from({length:state.draft.population},(_,i)=>({id:`A${String(i+1).padStart(2,'0')}`,status:'waiting',choice:null}));
}
function buttonResult() { return state.cursor===1?state.run?.result:null; }
function renderButtonStats() {
  const cfg=currentConfig(),result=buttonResult();
  const values=[
    ['PARTICIPANTS',cfg.population,'','people'],
    ['BUTTON 1',result?result.button_1_votes:'—','votes','one'],
    ['BUTTON 2',result?result.button_2_votes:'—','votes','two'],
    ['SURVIVORS',result?result.survivors:'—',`/ ${cfg.population}`,'people'],
  ];
  return values.map(([label,value,suffix,symbol])=>`<div class="stat"><div class="stat-top"><span>${label}</span>${icon(symbol)}</div><div class="stat-number">${value}${suffix?`<small>${suffix}</small>`:''}</div></div>`).join('');
}
function buttonOutcomeText(result) {
  if(!result) return 'Each choice stays private until every participant has submitted a vote.';
  if(result.button_2_majority) return `${result.button_2_votes} of ${result.population} chose Button 2. It won a strict majority, so everyone survived.`;
  if(result.tied) return result.tie_rule==='everyone_survives'?'The vote tied. The selected tie exception saved everyone.':'The vote tied. Button 2 did not win a strict majority: Button 1 voters survived and Button 2 voters died.';
  if(!result.button_2_votes) return 'Everyone chose Button 1. Each voter was guaranteed survival, so everyone survived.';
  return `Button 2 received ${result.button_2_votes} of ${result.population} votes. Button 1 voters survived; the ${result.button_2_votes} Button 2 voter${result.button_2_votes===1?'':'s'} died.`;
}
function buttonScenario(cfg) {
  if(cfg.mode==='model') return 'custom';
  const count=cfg.button_2_count,pop=cfg.population;
  if(count===0) return 'all-one';
  if(count===pop) return 'all-two';
  if(count*2===pop) return 'tie';
  if(count===Math.floor(pop/2)+1) return 'majority';
  if(count===Math.floor((pop-1)/2)) return 'minority';
  return 'custom';
}
function renderButtonConfig() {
  const cfg=currentConfig(),frozen=!!state.run,disabled=frozen?'disabled':'',scenario=buttonScenario(cfg);
  return `<div><section class="card config-card"><div class="config-title"><h2>Vote setup</h2>${icon('settings')}</div><div class="button-config-form">
    ${cfg.mode==='placeholder'?`<div class="field"><label for="button-scenario">Scenario</label><select id="button-scenario" data-button-config="scenario" ${disabled}>
      <option value="custom" ${scenario==='custom'?'selected':''}>Custom split</option>
      <option value="majority" ${scenario==='majority'?'selected':''}>Button 2 majority</option>
      <option value="minority" ${scenario==='minority'?'selected':''}>Button 2 minority</option>
      <option value="all-one" ${scenario==='all-one'?'selected':''}>All choose Button 1</option>
      <option value="all-two" ${scenario==='all-two'?'selected':''}>All choose Button 2</option>
      <option value="tie" ${scenario==='tie'?'selected':''}>Exact tie</option>
    </select></div>`:''}
    <div class="field"><label for="button-population">Participants <span class="label-value" id="button-population-value">${cfg.population}</span></label><input id="button-population" type="range" min="1" max="100" value="${cfg.population}" data-button-config="population" ${disabled}><div class="range-labels"><span>1</span><span>100</span></div></div>
    ${cfg.mode==='placeholder'?`<div class="field"><label for="button-two-count">Choose Button 2 <span class="label-value" id="button-two-value">${cfg.button_2_count}</span></label><input id="button-two-count" type="range" min="0" max="${cfg.population}" value="${cfg.button_2_count}" data-button-config="button_2_count" ${disabled}><p class="field-hint" id="button-split-hint">${cfg.population-cfg.button_2_count} choose Button 1</p></div>`:''}
    <div class="field"><label for="button-tie-rule">Exact tie</label><select id="button-tie-rule" data-button-config="tie_rule" ${disabled}><option value="button_2_loses" ${cfg.tie_rule==='button_2_loses'?'selected':''}>Button 2 voters die</option><option value="everyone_survives" ${cfg.tie_rule==='everyone_survives'?'selected':''}>Everyone survives</option></select></div>
    <div class="section-divider"></div>
    <div class="field"><label for="button-policy">Agent policy</label><select id="button-policy" data-button-config="mode" ${disabled}><option value="placeholder" ${cfg.mode==='placeholder'?'selected':''}>Scripted placeholders</option><option value="model" ${cfg.mode==='model'?'selected':''} ${!state.providers.length?'disabled':''}>Independent AI agents</option></select></div>
    ${cfg.mode==='model'?`<div class="field"><label for="button-provider">Model connection</label><select id="button-provider" data-button-config="provider_id" ${disabled}>${providerOptions(cfg.provider_id)}</select></div>`:''}
  </div></section></div>`;
}
function renderVotingRoom() {
  const result=buttonResult(),players=buttonPlayers();
  if(!players.some(p=>p.id===state.selected)) state.selected=players[0]?.id;
  const shown=state.showAllBallots?players:players.slice(0,12);
  return `<div class="button-options">
    <div class="choice-card choice-one"><div class="choice-orb"><span>1</span></div><div class="choice-copy"><h3>Guaranteed survival</h3><p>You survive whatever the tally.</p></div></div>
    <div class="choice-card choice-two"><div class="choice-orb"><span>2</span></div><div class="choice-copy"><h3>Shared risk</h3><p>${currentConfig().tie_rule==='everyone_survives'?'A majority or tie saves everyone. Otherwise Button 2 voters die.':'A majority saves everyone. Otherwise Button 2 voters die.'}</p></div></div>
  </div><div class="ballot-label"><span class="tiny-eyebrow">BALLOTS</span><span>${players.length} participants</span></div>
  <div class="ballot-grid">${shown.map(p=>`<button type="button" class="ballot-agent ${p.id===state.selected?'selected':''} ${result?p.choice==='button_1'?'vote-one':'vote-two':'sealed'} ${result&&p.status==='dead'?'dead':''}" data-action="select-prisoner" data-id="${p.id}" aria-label="Inspect participant ${p.id}" aria-pressed="${p.id===state.selected}"><span class="ballot-disc">${result?p.choice.slice(-1):icon('lock')}<span class="ballot-status"></span></span><span>${p.id}</span>${result?`<small>${p.status==='survived'?'Survived':'Died'}</small>`:''}</button>`).join('')}</div>
  ${players.length>12?`<div class="ballot-more">${button(state.showAllBallots?'Show fewer':`Show all ${players.length}`,'toggle-ballots','people','btn-small')}</div>`:''}`;
}
function renderVoteControls() {
  const finished=terminal(state.run),resolved=state.run?.status==='completed';
  return `<div class="control-bar"><div class="control-actions">${button(state.busy?'Collecting votes…':resolved?'Vote resolved':finished?'Vote interrupted':'Run the vote','vote',state.busy?'clock':resolved?'check':finished?'info':'play','btn-primary',state.busy||finished)}${finished?button('New vote','duplicate','plus','',state.busy):''}</div>${state.busy||finished&&!resolved?`<span class="control-status" id="decision-progress">${state.busy&&state.run?.config.mode==='model'?progressText():state.busy?'Votes stay sealed until all return':'No partial vote was applied'}</span>`:''}</div>`;
}
function renderButtonInspector() {
  const result=buttonResult(),player=buttonPlayers().find(p=>p.id===state.selected);
  const entry=result?state.run?.histories[state.selected]?.[0]:null;
  const cfg=currentConfig();
  return `<div class="card-head"><div class="prisoner-switch"><span class="prisoner-avatar">${state.selected}</span><div><h2>Participant</h2></div></div>${badge(entry?`Button ${entry.decision.action.slice(-1)}`:'Sealed',entry?'green':'gray')}</div>
    <div class="inspector-body"><div class="inspector-meta"><span>Other votes</span><strong class="eye-hidden">${icon('hidden')} Hidden</strong></div><div class="inspector-meta"><span>Knows</span><strong>${cfg.population} participants · ${cfg.tie_rule==='button_2_loses'?'strict majority':'tie saves all'}</strong></div>
    ${result?`<div class="inspector-meta"><span>Outcome</span><strong class="${player.status==='dead'?'death-text':''}">${player.status==='dead'?'Died':'Survived'}</strong></div>`:''}
    ${entry?`<span class="tiny-eyebrow" style="display:block;margin-top:14px">${cfg.mode==='placeholder'?'SCRIPTED ASSIGNMENT':'AGENT JUSTIFICATION'}</span><p class="thought-note">${esc(cfg.mode==='placeholder'?`Prepared Button ${entry.decision.action.slice(-1)} vote. No AI was used.`:entry.decision.justification)}</p>`:''}
    <div class="inspector-bottom inspector-actions"><button class="text-button" type="button" data-action="inspect-log" ${!state.run?'disabled':''}>Full record ${icon('arrow')}</button></div></div>`;
}
function renderVoteBreakdown() {
  const cfg=currentConfig(),result=buttonResult();
  const portion=result?result.button_2_votes/cfg.population*100:0;
  return `<div class="card-head"><div><h2>Vote breakdown</h2><p>Button 2 needs ${Math.floor(cfg.population/2)+1} of ${cfg.population} votes${cfg.tie_rule==='everyone_survives'?' · ties also save all':''}</p></div>${icon('chart')}</div><div class="timeline-body"><div class="vote-bar ${!result?'unresolved':''}" aria-label="${result?`${result.button_1_votes} Button 1 votes and ${result.button_2_votes} Button 2 votes`:'Vote not yet resolved'}"><div class="vote-bar-one" style="width:${result?100-portion:0}%"></div><div class="vote-bar-two" style="width:${portion}%"></div></div><div class="vote-key"><span><i class="vote-square one"></i>Button 1 <strong>${result?result.button_1_votes:'—'}</strong></span><span><i class="vote-square two"></i>Button 2 <strong>${result?result.button_2_votes:'—'}</strong></span></div><p class="vote-outcome ${result?.deaths?'has-deaths':''}" ${result?'':'hidden'}>${result?esc(buttonOutcomeText(result)):''}</p><div class="replay-row"><span>Replay</span><input id="button-replay" type="range" min="0" max="1" value="${state.cursor}" ${!state.run?.result||state.busy?'disabled':''} aria-label="Replay vote"><span>${state.cursor?'After':'Before'}</span></div></div>`;
}
function renderButtonsExperiment() {
  const cfg=currentConfig(),run=state.run,result=buttonResult();
  const policy=cfg.mode==='placeholder'?'Scripted placeholders · no AI calls':`AI agents · ${esc(run?.provider?.name||state.providers.find(p=>p.id===cfg.provider_id)?.name||'your model')}`;
  return gamePicker('buttons')+heading('','Button dilemma','',`${run?button('Export','export','download','btn-quiet'):''}${button('New experiment','new','plus','',state.busy)}`)+`${run?.error?`<div class="error-banner"><strong>Vote interrupted.</strong> ${esc(run.error)}</div>`:''}<div class="notice">${icon('info')}<span>${policy}</span></div><div class="stat-grid" id="stat-container">${renderButtonStats()}</div><div class="experiment-layout">${renderButtonConfig()}<div class="right-stack"><section class="card"><div class="card-head"><div><h2>Voting room</h2>${run?`<p>${esc(run.config.name)}</p>`:''}</div>${badge(result?'Resolved':'Sealed',result?'green':'gray')}</div><div id="voting-room">${renderVotingRoom()}</div><div id="control-area">${renderVoteControls()}</div></section><div class="below-grid"><section class="card inspector" id="inspector-card">${renderButtonInspector()}</section><section class="card" id="timeline-card">${renderVoteBreakdown()}</section></div></div></div>`;
}
function refreshButtonPreview(skipBreakdown=false) {
  for(const [id,fn] of [['stat-container',renderButtonStats],['voting-room',renderVotingRoom],['inspector-card',renderButtonInspector],['timeline-card',renderVoteBreakdown]]){
    const el=document.getElementById(id);if(el&&!(skipBreakdown&&id==='timeline-card'))el.innerHTML=fn();
  }
  if(skipBreakdown){
    const row=document.querySelector('.replay-row>span:last-child');if(row)row.textContent=state.cursor?'After':'Before';
    const breakdown=document.getElementById('timeline-card');
    const result=buttonResult(),fraction=result?result.button_2_votes/currentConfig().population*100:0;
    if(breakdown){
      breakdown.querySelector('.vote-bar').classList.toggle('unresolved',!result);
      breakdown.querySelector('.vote-bar').setAttribute('aria-label',result?`${result.button_1_votes} Button 1 votes and ${result.button_2_votes} Button 2 votes`:'Vote not yet resolved');
      breakdown.querySelector('.vote-bar-one').style.width=(result?100-fraction:0)+'%';
      breakdown.querySelector('.vote-bar-two').style.width=fraction+'%';
      const numbers=breakdown.querySelectorAll('.vote-key strong');numbers[0].textContent=result?result.button_1_votes:'—';numbers[1].textContent=result?result.button_2_votes:'—';
      const outcome=breakdown.querySelector('.vote-outcome');outcome.textContent=result?buttonOutcomeText(result):'';outcome.hidden=!result;outcome.classList.toggle('has-deaths',!!result?.deaths);
    }
  }
}
function openButtonExperimentDialog(duplicate=false) {
  if(state.busy)return;
  const cfg=duplicate?{...currentConfig()}:state.run?buttonDefaults():{...state.draft};
  const dialog=document.getElementById('experiment-dialog');
  dialog.innerHTML=`<form id="experiment-form"><input type="hidden" name="game" value="buttons"><div class="modal-head"><div><h2>${duplicate?'Repeat a button vote':'New button experiment'}</h2><p>Set the vote and tie rule.</p></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Close experiment dialog">${icon('close')}</button></div><div class="modal-body"><div class="form-error" role="alert"></div><div class="field"><label for="run-name">Experiment name</label><input id="run-name" name="name" maxlength="80" value="${esc(cfg.name==='Button dilemma'?buttonConfigName(cfg):cfg.name)}" required></div><div class="field-row"><div class="field"><label for="run-population">Participants</label><input id="run-population" name="population" type="number" min="1" max="100" value="${cfg.population}" required></div><div class="field" id="button-scripted-field"><label for="run-button-two">Scripted Button 2 voters</label><input id="run-button-two" name="button_2_count" type="number" min="0" max="100" value="${cfg.button_2_count??Math.floor(cfg.population/2)+1}" required></div></div><div class="field"><label for="run-tie-rule">If the vote ties exactly</label><select id="run-tie-rule" name="tie_rule"><option value="button_2_loses" ${cfg.tie_rule==='button_2_loses'?'selected':''}>Button 1 survives; Button 2 dies · strict majority</option><option value="everyone_survives" ${cfg.tie_rule==='everyone_survives'?'selected':''}>Everyone survives the tie</option></select></div><div class="field"><label for="run-policy">Agent policy</label><select id="run-policy" name="mode" data-button-dialog="mode"><option value="placeholder" ${cfg.mode==='placeholder'?'selected':''}>Scripted placeholders · no model calls</option><option value="model" ${cfg.mode==='model'?'selected':''} ${!state.providers.length?'disabled':''}>Independent AI agents · choose a connected model</option></select></div>${state.providers.length?`<div class="field"><label for="run-provider">AI model connection</label><select id="run-provider" name="provider_id">${providerOptions(cfg.provider_id)}</select></div>`:''}<details><summary>Request limits and reproducibility</summary><div class="field-row"><div class="field"><label for="run-seed">Assignment seed</label><input id="run-seed" name="seed" type="number" min="0" max="2147483647" value="${cfg.seed}" required></div><div class="field"><label for="run-calls">Maximum model requests</label><input id="run-calls" name="max_model_calls" type="number" min="1" max="50000" value="${cfg.max_model_calls}" required></div></div><p class="field-hint">The seed fixes placeholder assignments. Model votes are chosen independently.</p></details></div><div class="modal-footer">${button('Cancel','close-dialog','close','btn-quiet')}<button class="btn btn-primary" type="submit">${icon('plus')}Create experiment</button></div></form>`;
  const field=dialog.querySelector('#run-button-two');field.disabled=cfg.mode==='model';dialog.querySelector('#button-scripted-field').hidden=cfg.mode==='model';
  dialog.showModal();
}
function inspectButtonLog() {
  const history=state.cursor===1?state.run?.histories[state.selected]||[]:[];
  const dialog=document.getElementById('experiment-dialog');
  dialog.innerHTML=`<div class="modal-head"><div><h2>${state.selected}'s private record</h2></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Close private record">${icon('close')}</button></div><div class="modal-body">${history.map(e=>`<div style="margin-bottom:19px">${badge(`Button ${e.decision.action.slice(-1)}`,'green')}<p class="thought-note">${esc(e.decision.justification)}</p><details open><summary>Exact private observation</summary><pre class="dialog-log">${esc(JSON.stringify(e.observation,null,2))}</pre></details></div>`).join('')||'<p class="thought-note empty">No vote has been submitted at this replay position.</p>'}</div><div class="modal-footer">${button('Close','close-dialog','check')}</div>`;
  dialog.showModal();
}
function handleButtonInput(el) {
  if(el.id==='button-replay'){
    state.cursor=Number(el.value);refreshButtonPreview(true);return true;
  }
  if(!el.dataset.buttonConfig||state.run)return false;
  const key=el.dataset.buttonConfig;
  if(['population','button_2_count'].includes(key)){
    state.draft[key]=Number(el.value);
    state.draft.button_2_count=Math.min(state.draft.population,state.draft.button_2_count);
    const count=document.getElementById('button-two-count');
    document.getElementById('button-population-value').textContent=state.draft.population;
    if(count){count.max=state.draft.population;count.value=state.draft.button_2_count;document.getElementById('button-two-value').textContent=state.draft.button_2_count;document.getElementById('button-split-hint').textContent=`${state.draft.population-state.draft.button_2_count} choose Button 1`;document.getElementById('button-scenario').value=buttonScenario(state.draft);}
    refreshButtonPreview();return true;
  }
  return false;
}
function handleButtonChange(el) {
  if(el.dataset.buttonDialog==='mode'){
    const model=el.value==='model';const form=el.closest('form');form.querySelector('#run-button-two').disabled=model;form.querySelector('#button-scripted-field').hidden=model;return true;
  }
  if(!el.dataset.buttonConfig||state.run)return false;
  const cfg=state.draft,key=el.dataset.buttonConfig;
  if(key==='scenario'){
    if(el.value==='tie'){if(cfg.population%2)cfg.population=Math.min(100,cfg.population+1);cfg.button_2_count=cfg.population/2;}
    else if(el.value==='majority')cfg.button_2_count=Math.floor(cfg.population/2)+1;
    else if(el.value==='minority')cfg.button_2_count=Math.floor((cfg.population-1)/2);
    else if(el.value==='all-one')cfg.button_2_count=0;
    else if(el.value==='all-two')cfg.button_2_count=cfg.population;
    render();return true;
  }
  if(key==='mode'){cfg.mode=el.value;if(el.value==='model')cfg.provider_id=state.providers[0]?.id;render();return true;}
  if(key==='tie_rule'||key==='provider_id'){cfg[key]=el.value;render();return true;}
  return ['population','button_2_count'].includes(key);
}
function renderButtonsGuide() {
  return gamePicker('buttons',true)+heading('','Button dilemma rules','')+`<div class="guide-grid"><section class="card guide-card"><h2>The two choices</h2><div class="guide-choice"><span class="guide-button-number one">1</span><div><h3>Button 1</h3><p>You survive regardless of the result. If Button 2 wins a strict majority, its voters survive too.</p></div></div><div class="guide-choice"><span class="guide-button-number two">2</span><div><h3>Button 2</h3><p>If more than half of all participants choose Button 2, everyone survives. If fewer than half choose it, only Button 2 voters die.</p></div></div><h2 style="margin-top:25px">The exact tie</h2><p>By default, Button 2 loses an exact tie. You can change this in Vote setup.</p><p>Votes are private and simultaneous.</p></section><div class="right-stack"><section class="card guide-card"><h2>Five participants, three outcomes</h2><div class="vote-examples"><div><strong>3 pick Button 2</strong><span>A strict majority. All 5 survive.</span></div><div><strong>2 pick Button 2</strong><span>The 3 Button 1 voters survive. The 2 Button 2 voters die.</span></div><div><strong>Everyone picks Button 1</strong><span>All 5 survive. A Button 2 majority is not the only way for everyone to live.</span></div></div></section><section class="card guide-card"><h2>Agent choices</h2><p>Placeholders use the split you set. The seed determines individual assignments; no AI is called.</p><p>A connected model can choose each vote from the rules, tie rule, and population. It cannot see other votes.</p><p>The lab records choices and outcomes without grading a moral answer.</p></section></div></div>`;
}
