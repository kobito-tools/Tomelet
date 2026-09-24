(function(){
"use strict";
const api=window.TickTockTomeApi,esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const secondsAt=time=>{const[h,m]=time.split(':').map(Number);return h*3600+m*60;};
const duration=s=>{s=Math.max(0,Math.floor(s));return[Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(v=>String(v).padStart(2,'0')).join(':');};
let windowOn=false,selected=null,overdueQueue=[],timerSnapshot=null;
const reviewedEndByDate=new Map();
const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
function update(){
 const host=document.querySelector('#sidebarTimer');if(!host)return;
 const now=new Date(),seconds=now.getHours()*3600+now.getMinutes()*60+now.getSeconds(),items=(window.__tickTockTomeTodayActions||[]).filter(t=>!t.finishedAt&&t.progress<100);
 const localActive=items.filter(t=>t.executionStatus==='in_progress'||(t.executionStatus==='planned'&&seconds>=secondsAt(t.startTime)&&seconds<secondsAt(t.endTime))).sort((a,b)=>(a.actualStartTime||a.startTime).localeCompare(b.actualStartTime||b.startTime))[0]||null;
 const active=timerSnapshot?.active||localActive,snapshotNext=timerSnapshot?.upcoming,next=(snapshotNext&&snapshotNext.id!==active?.id?snapshotNext:null)||items.filter(t=>t.id!==active?.id&&t.executionStatus==='planned'&&seconds<secondsAt(t.startTime)).sort((a,b)=>a.startTime.localeCompare(b.startTime))[0]||null;
 host.classList.toggle('is-countdown',Boolean(active||next));
 const activeTarget=active&&(active.executionStatus==='in_progress'?(active.targetEndTime||active.endTime):active.endTime),overtime=active&&seconds>=secondsAt(activeTarget);
 const clock=active?duration(overtime?seconds-secondsAt(activeTarget):secondsAt(activeTarget)-seconds):next?duration(secondsAt(next.startTime)-seconds):now.toLocaleTimeString('ja-JP',{hour12:false});
 const title=active?active.action:'休憩中',caption=active?(overtime?'終了予定を超過':'終了まで'):next?'次の開始まで':'現在時刻';
 const nextLine=next?'<small class="timer-next">次のアクション｜<b>'+esc(next.action)+'</b> <time>'+esc(next.startTime)+'</time></small>':'<small class="timer-next is-empty">次の予定はありません</small>';
 const content='<span class="timer-status">'+esc(title)+'</span><strong>'+clock+'</strong><em>'+caption+'</em><hr>'+nextLine+'<div class="timer-controls"><button data-timer-operation="'+(active?'complete':'start')+'">'+(active?'即時完了':'即時開始')+'</button><button data-timer-window>'+(windowOn?'常駐 ON':'常駐 OFF')+'</button></div>';
 if(host.innerHTML!==content)host.innerHTML=content;
}
function close(){document.querySelector('#timerDialog')?.remove();selected=null;}
function dialog(title,body){close();const host=document.createElement('div');host.id='timerDialog';host.className='timer-modal';host.innerHTML='<section><button class="close" data-timer-close>×</button><h2>'+esc(title)+'</h2>'+body+'<p class="timer-error" role="alert"></p></section>';document.body.append(host);host.querySelector('input,button')?.focus();}
async function openOperation(operation){
 const data=await api.timer();
 if(operation==='complete'&&data.active){await openCompletion(data.active);return;}
 const todos=(await api.todos()).items.filter(window.tickTockTomeVisibleByTags||(()=>true)),actions=(window.__tickTockTomeTodayActions||[]).filter(t=>!t.finishedAt&&t.progress<100&&t.startTime>new Date().toTimeString().slice(0,5)),tags=window.__tickTockTomeBootstrap?.tags||[];
 dialog('アクション開始','<form data-timer-new><label>アクション名<input name="action" maxlength="300" required placeholder="今からすること"></label><fieldset><legend>タグ</legend>'+tags.map(t=>'<label class="check-chip"><input name="tagIds" type="checkbox" value="'+esc(t.id)+'"><span>'+esc(t.name)+'</span></label>').join('')+'</fieldset><button class="primary">所要時間を選ぶ →</button></form><h3>予定・Todoから開始</h3><div class="timer-choice-list">'+actions.map(t=>'<button data-timer-action="'+esc(t.id)+'">'+esc(t.startTime)+'｜'+esc(t.action)+'</button>').join('')+todos.map(t=>'<button data-timer-todo="'+esc(t.id)+'">Todo｜'+esc(t.title)+'</button>').join('')+'</div>');
}
async function openCompletion(t,overdue=false){
 const todos=(await api.todos()).items,origin=t.todoId?todos.find(item=>item.id===t.todoId):null,due=origin?.dueDate||localDate(),keep=Boolean(origin);
 const previousEnd=reviewedEndByDate.get(t.actionDate)||'',start=[t.actualStartTime||t.startTime,previousEnd].sort().at(-1),nowTime=new Date().toTimeString().slice(0,5),end=t.actionDate===localDate()?nowTime:t.endTime;
 dialog(overdue?'終了時間を過ぎたアクション':'アクションを完了','<p><strong>'+esc(t.action)+'</strong></p><p class="timer-review-copy">予定 '+esc(t.startTime)+'〜'+esc(t.endTime)+(overdue?' は終了しています。実際の結果を確認してください。':'')+'</p><form data-timer-complete="'+esc(t.id)+'" data-action-date="'+esc(t.actionDate)+'" data-revision="'+t.revision+'" data-overdue="'+(overdue?'1':'0')+'"><fieldset class="action-outcome"><legend>実行結果</legend><label><input type="radio" name="outcome" value="completed" checked> 完了した</label><label><input type="radio" name="outcome" value="in_progress"> まだ実行中</label><label><input type="radio" name="outcome" value="skipped"> 実施しなかった</label></fieldset><div class="actual-time-fields"><label>実績開始<input type="time" name="actualStartTime" value="'+esc(start)+'" required></label><label data-actual-end>実績終了<input type="time" name="actualEndTime" value="'+esc(end)+'" required></label></div><p class="time-overlap-warning" hidden>ほかの実績時間と重なる場合は、並行作業として保存されます。</p><label>達成度<div class="progress-control"><input name="progress" type="range" min="0" max="100" step="1" value="'+t.progress+'"><output>'+t.progress+'%</output></div></label><label>メモ<textarea name="note" rows="3" placeholder="実施したこと、続きなど"></textarea></label><fieldset class="todo-carry" '+(t.progress>=100?'hidden':'')+'><legend>100%未満の作業をTodoに残しますか？</legend><label><input type="radio" name="continueAsTodo" value="yes" '+(keep?'checked':'')+'> はい</label><label><input type="radio" name="continueAsTodo" value="no" '+(!keep?'checked':'')+'> いいえ</label><label class="todo-carry-date" '+(!keep?'hidden':'')+'>期限日<input type="date" name="dueDate" value="'+esc(due)+'"></label></fieldset><div class="timer-dialog-actions">'+(overdue?'<button type="button" class="secondary" data-overdue-later>後で確認</button>':'')+'<button class="primary">結果を保存</button></div></form>');
}
async function reviewOverdue(){if(document.querySelector('#timerDialog')||!overdueQueue.length)return;await openCompletion(overdueQueue[0],true);}
function chooseDuration(value){dialog('目標所要時間','<p>開始時刻は現在時刻になります。</p><form data-timer-duration><label>所要時間（分）<input type="number" name="durationMinutes" min="1" max="720" value="30" required></label><div class="duration-presets">'+[5,15,25,30,45,60,90,120].map(m=>'<button type="button" data-duration="'+m+'">'+m+'分</button>').join('')+'</div><button class="primary">このアクションを開始</button></form>');selected=value;}
document.addEventListener('click',async event=>{
 const b=event.target.closest('[data-timer-operation],[data-timer-window],[data-timer-close],[data-timer-action],[data-timer-todo],[data-duration],[data-overdue-later]');if(!b)return;
 try{if(b.hasAttribute('data-timer-close'))close();else if(b.dataset.duration)document.querySelector('[name="durationMinutes"]').value=b.dataset.duration;
 else if(b.hasAttribute('data-overdue-later')){overdueQueue.shift();close();reviewOverdue();}
 else if(b.hasAttribute('data-timer-window')){windowOn=(await api.timerWindow(!windowOn)).on;update();}
 else if(b.dataset.timerOperation)await openOperation(b.dataset.timerOperation);
 else if(b.dataset.timerTodo)chooseDuration({todoId:b.dataset.timerTodo});
 else if(b.dataset.timerAction){const t=(window.__tickTockTomeTodayActions||[]).find(t=>t.id===b.dataset.timerAction);chooseDuration({actionId:t.id,revision:t.revision});}
 }catch(error){alert(error.message);}
});
document.addEventListener('submit',async event=>{
 const form=event.target.closest('[data-timer-new],[data-timer-complete],[data-timer-duration]');if(!form)return;event.preventDefault();const data=new FormData(form);
 try{if(form.hasAttribute('data-timer-new')){chooseDuration({action:data.get('action'),tagIds:data.getAll('tagIds')});return;}
 form.querySelector('.primary').disabled=true;
 if(form.hasAttribute('data-timer-complete')){const outcome=data.get('outcome')||'completed',result=await api.completeTimer({id:form.dataset.timerComplete,revision:Number(form.dataset.revision),outcome,actualStartTime:data.get('actualStartTime'),actualEndTime:data.get('actualEndTime'),progress:Number(data.get('progress')),note:data.get('note'),continueAsTodo:data.get('continueAsTodo')==='yes'&&Number(data.get('progress'))<100,dueDate:data.get('dueDate')||localDate()});if(result.item?.actualEndTime)reviewedEndByDate.set(form.dataset.actionDate,result.item.actualEndTime);}
 else await api.startTimer({...selected,durationMinutes:Number(data.get('durationMinutes'))});
 if(form.dataset.overdue==='1')overdueQueue.shift();close();await window.tickTockTomeTimerChanged();update();reviewOverdue();
 }catch(error){form.querySelector('.primary').disabled=false;document.querySelector('.timer-error').textContent=error.message;}
});
document.addEventListener('input',event=>{const form=event.target.closest('#timerDialog [data-timer-complete]');if(form&&event.target.name==='progress'){event.target.nextElementSibling.textContent=event.target.value+'%';const carry=form.querySelector('.todo-carry');if(carry)carry.hidden=Number(event.target.value)>=100;}if(form&&['actualStartTime','actualEndTime'].includes(event.target.name)){const start=form.elements.actualStartTime.value,end=form.elements.actualEndTime.value,warning=form.querySelector('.time-overlap-warning'),items=window.__tickTockTomeTodayActions||[];if(warning)warning.hidden=!items.some(item=>item.id!==form.dataset.timerComplete&&item.actualStartTime&&item.actualEndTime&&start<item.actualEndTime&&end>item.actualStartTime);}});
document.addEventListener('change',event=>{if(event.target.name==='continueAsTodo'){const date=event.target.closest('fieldset')?.querySelector('.todo-carry-date');if(date)date.hidden=event.target.value!=='yes';}if(event.target.name==='outcome'){const form=event.target.closest('form'),outcome=event.target.value,timeFields=form?.querySelector('.actual-time-fields'),end=form?.querySelector('[data-actual-end]');if(timeFields)timeFields.hidden=outcome==='skipped';if(end)end.hidden=outcome!=='completed';const start=form?.elements.actualStartTime,finish=form?.elements.actualEndTime;if(start)start.required=outcome!=='skipped';if(finish)finish.required=outcome==='completed';}});
document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
document.addEventListener('ticktocktome:navigation-rendered',update);document.addEventListener('ticktocktome:actions-changed',update);
window.TickTockTomeOpenTimerComplete=()=>openOperation('complete');
setInterval(update,1000);api.timer().then(data=>{timerSnapshot=data;windowOn=data.windowOn;update();}).catch(()=>{});
setInterval(()=>api.timer().then(data=>{timerSnapshot=data;windowOn=data.windowOn;update();}).catch(()=>{}),10000);
if(new URLSearchParams(location.search).get('timerComplete')==='1'){history.replaceState(null,'',location.pathname);setTimeout(()=>openOperation('complete'),300);}
setTimeout(()=>api.overdueActions().then(result=>{overdueQueue=result.items||[];reviewOverdue();}).catch(()=>{}),900);
})();
