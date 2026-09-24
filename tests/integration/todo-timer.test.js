"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openDatabase}=require('../../scripts/database/connection.js');
const {SqliteRepository}=require('../../scripts/repositories/sqlite-repository.js');
const {startAction,timerState}=require('../../scripts/services/timer-service.js');
const {validateDailyAction}=require('../../scripts/services/daily-action-service.js');
test('Todoを時間割へ取り込み、100%で完了履歴を残して非表示にする',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ticktocktome-todo-')),db=openDatabase(path.join(directory,'test.sqlite3'),path.resolve(__dirname,'../..'));
 try{
  const repo=new SqliteRepository(db),todo=repo.saveTodo({title:'読む',tagIds:[],dueDate:'2026-09-17',progress:34});
  assert.equal(todo.dueDate,'2026-09-17');assert.equal(todo.progress,34);
  const now=new Date(2026,8,16,10,0,0),action=startAction(repo,{todoId:todo.id,durationMinutes:30},now);
  assert.equal(action.todoId,todo.id);assert.equal(action.startTime,'10:00');assert.equal(timerState(repo,now).active.id,action.id);
  const done=repo.completeDailyAction(action.id,100,action.revision,new Date(2026,8,16,10,12,0));
  assert.equal(done.endTime,'10:30');assert.equal(done.actualStartTime,'10:00');assert.equal(done.actualEndTime,'10:12');assert.equal(done.executionStatus,'completed');assert.equal(done.progress,100);assert.ok(done.finishedAt);assert.equal(repo.listTodos().length,0);assert.ok(repo.listTodos(true)[0].completedAt);assert.equal(repo.listTodos(true)[0].progress,100);
  assert.equal(timerState(repo,new Date(2026,8,16,10,13,0)).active,null);
 }finally{db.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('複数の期限超過アクションを予定順に確認し、実績時刻を個別に保存できる',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ticktocktome-actual-times-')),db=openDatabase(path.join(directory,'test.sqlite3'),path.resolve(__dirname,'../..'));
 try{
  const repo=new SqliteRepository(db),base={actionDate:'2026-09-17',action:'A',progress:0,tagIds:[],completions:[],fileIds:[],managedFileIds:[],libraryIds:[],uploadIds:[],displayOrder:1};
  const a=repo.createDailyAction(validateDailyAction({...base,startTime:'12:00',endTime:'14:00'}));
  const b=repo.createDailyAction(validateDailyAction({...base,action:'B',startTime:'14:15',endTime:'16:00',displayOrder:2}));
  const overdue=repo.listOverdueActions(new Date(2026,8,17,17,0));assert.deepEqual(overdue.map(item=>item.id),[a.id,b.id]);
  const doneA=repo.resolveDailyAction(a.id,{outcome:'completed',progress:100,actualStartTime:'12:00',actualEndTime:'14:30'},a.revision,new Date(2026,8,17,17,0));
  const doneB=repo.resolveDailyAction(b.id,{outcome:'completed',progress:100,actualStartTime:'14:30',actualEndTime:'16:00'},b.revision,new Date(2026,8,17,17,1));
  assert.equal(doneA.endTime,'14:00');assert.equal(doneA.actualEndTime,'14:30');assert.equal(doneB.startTime,'14:15');assert.equal(doneB.actualStartTime,'14:30');assert.deepEqual(repo.listOverdueActions(new Date(2026,8,17,17,2)),[]);
  const analysis=repo.saveDailyAnalysis('2026-09-17',{sourceFingerprint:'sample-fingerprint',llmSummary:'集中して取り組めた日です。',llmInsights:['予定超過がありました。'],llmSuggestions:['翌日の時間割に余白を追加する'],modelPath:'local.gguf'});
  assert.equal(analysis.llmSummary,'集中して取り組めた日です。');assert.deepEqual(analysis.llmSuggestions,['翌日の時間割に余白を追加する']);
 }finally{db.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('予定済みアクションを遅れて開始しても当初の時間割を保持する',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ticktocktome-start-late-')),db=openDatabase(path.join(directory,'test.sqlite3'),path.resolve(__dirname,'../..'));
 try{
  const repo=new SqliteRepository(db),action=repo.createDailyAction(validateDailyAction({actionDate:'2026-09-17',startTime:'12:00',endTime:'14:00',action:'予定作業',progress:0,tagIds:[],completions:[],fileIds:[],managedFileIds:[],libraryIds:[],uploadIds:[]}));
  const started=startAction(repo,{actionId:action.id,revision:action.revision,durationMinutes:60},new Date(2026,8,17,12,30));
  assert.equal(started.startTime,'12:00');assert.equal(started.endTime,'14:00');assert.equal(started.plannedStartTime,'12:00');assert.equal(started.plannedEndTime,'14:00');
  assert.equal(started.actualStartTime,'12:30');assert.equal(started.targetEndTime,'13:30');assert.equal(started.executionStatus,'in_progress');
  assert.equal(timerState(repo,new Date(2026,8,17,12,45)).active.targetEndTime,'13:30');
  assert.equal(repo.listOverdueActions(new Date(2026,8,17,13,31))[0].id,started.id);
 }finally{db.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('37%の達成度を保存でき、PDF参照は本体なしで保管する',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ticktocktome-reference-')),db=openDatabase(path.join(directory,'test.sqlite3'),path.resolve(__dirname,'../..'));
 try{
  const repo=new SqliteRepository(db),todo=repo.saveTodo({title:'書く',tagIds:[]});
  const action=repo.createDailyAction(validateDailyAction({actionDate:'2026-09-16',startTime:'09:00',endTime:'10:00',action:'書く',progress:37,todoId:todo.id}));
  assert.equal(action.progress,37);assert.equal(repo.listTodos().length,1);
  const item=repo.createReferencedLibraryItem('paper','documents','papers/large.pdf');
  assert.equal(item.sourceRootId,'documents');assert.equal(item.sourceRelativePath,'papers/large.pdf');assert.equal(item.sourceUploadId,null);
  assert.equal(repo.listLibraryItems('paper')[0].sourceRelativePath,'papers/large.pdf');
 }finally{db.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('未完了アクションは確認結果に応じてTodoへ引き継ぐ',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ticktocktome-carry-')),db=openDatabase(path.join(directory,'test.sqlite3'),path.resolve(__dirname,'../..'));
 try{
  const repo=new SqliteRepository(db),base={actionDate:'2026-09-17',startTime:'09:00',endTime:'10:00',action:'資料を整理',progress:0,tagIds:[],completions:[],fileIds:[],managedFileIds:[],libraryIds:[],uploadIds:[],displayOrder:1};
  const first=repo.createDailyAction(validateDailyAction(base));
  repo.completeDailyAction(first.id,{progress:45,continueAsTodo:false,dueDate:'2026-09-17'},first.revision,new Date(2026,8,17,9,30));
  assert.equal(repo.listTodos().length,0);
  const second=repo.createDailyAction(validateDailyAction({...base,startTime:'10:00',endTime:'11:00'}));
  const done=repo.completeDailyAction(second.id,{progress:62,continueAsTodo:true,dueDate:'2026-09-18',note:'残りを確認する'},second.revision,new Date(2026,8,17,10,30));
  const todo=repo.listTodos()[0];
  assert.equal(todo.title,'資料を整理');assert.equal(todo.progress,62);assert.equal(todo.dueDate,'2026-09-18');assert.equal(done.todoId,todo.id);assert.deepEqual(done.completions,['残りを確認する']);
 }finally{db.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('終了時間を過ぎた未処理アクションだけを確認対象にする',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ticktocktome-overdue-')),db=openDatabase(path.join(directory,'test.sqlite3'),path.resolve(__dirname,'../..'));
 try{
  const repo=new SqliteRepository(db),base={actionDate:'2026-09-17',startTime:'09:00',endTime:'10:00',action:'確認対象',progress:0,tagIds:[],completions:[],fileIds:[],managedFileIds:[],libraryIds:[],uploadIds:[],displayOrder:1};
  const action=repo.createDailyAction(validateDailyAction(base));
  assert.equal(timerState(repo,new Date(2026,8,17,9,30)).active.id,action.id);
  assert.deepEqual(repo.listOverdueActions(new Date(2026,8,17,9,59)),[]);
  assert.equal(repo.listOverdueActions(new Date(2026,8,17,10,1))[0].id,action.id);
  repo.completeDailyAction(action.id,{progress:100,continueAsTodo:false},action.revision,new Date(2026,8,17,10,2));
  assert.deepEqual(repo.listOverdueActions(new Date(2026,8,17,10,3)),[]);
 }finally{db.close();fs.rmSync(directory,{recursive:true,force:true});}
});
