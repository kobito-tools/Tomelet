"use strict";
const dateKey=(date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const timeKey=(date)=>`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
function timerState(repository, now=new Date(), hiddenTagIds=[]) {
 const time=timeKey(now),items=repository.listDailyActions({date:dateKey(now),limit:2000}).filter(t=>!t.finishedAt&&t.progress<100&&!t.tagIds.some(id=>hiddenTagIds.includes(id)));
 const active=items.filter(t=>t.executionStatus==='in_progress'||(t.executionStatus==='planned'&&t.startTime<=time&&time<t.endTime)).sort((a,b)=>(a.actualStartTime||a.startTime).localeCompare(b.actualStartTime||b.startTime))[0]||null;
 const upcoming=items.filter(t=>t.id!==active?.id&&t.executionStatus==='planned'&&time<t.startTime).sort((a,b)=>a.startTime.localeCompare(b.startTime))[0]||null;
 return {active,upcoming,now:now.toISOString(),localTime:now.toLocaleTimeString('ja-JP',{hour12:false})};
}
function startAction(repository,input,now=new Date()) {
 const duration=Number(input.durationMinutes);
 if(!Number.isInteger(duration)||duration<1||duration>720)throw new Error('所要時間は1〜720分で指定してください。');
 const startTime=timeKey(now),minutes=now.getHours()*60+now.getMinutes();
 if(minutes>=1439)throw new Error('日付が変わってから開始してください。');
 const end=Math.min(1439,minutes+duration),endTime=`${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}`;
 const old=input.actionId?repository.dailyActionById(input.actionId):null;
 if(input.actionId&&(!old||old.finishedAt||old.progress===100))throw new Error('この予定は既に完了しています。');
 if(old&&old.actionDate!==dateKey(now))throw new Error('今日の予定だけを開始できます。');
 const todo=input.todoId?repository.listTodos().find(t=>t.id===input.todoId):null;
 if(input.todoId&&!todo)throw new Error('Todoは既に完了・削除されています。');
 if(old)return repository.startDailyAction(old.id,old.revision,startTime,endTime,now);
 const {validateDailyAction}=require('./daily-action-service.js');
 const value=validateDailyAction({actionDate:dateKey(now),startTime,endTime,action:todo?.title||input.action,tagIds:todo?.tagIds||input.tagIds||[],todoId:todo?.id||'',progress:Number(todo?.progress??0),revision:input.revision},false);
 const saved=repository.createDailyAction(value);
 return repository.startDailyAction(saved.id,saved.revision,startTime,endTime,now);
}
module.exports={timerState,startAction,dateKey,timeKey};
