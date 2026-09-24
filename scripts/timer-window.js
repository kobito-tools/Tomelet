"use strict";
const path=require('node:path'),fs=require('node:fs'),{spawn,spawnSync}=require('node:child_process');
const port=Number(process.argv[2]),runtime=process.argv[3];
if(!Number.isInteger(port)||port<1024||port>65535||!runtime||!path.isAbsolute(runtime))process.exit(1);
let command,args;
if(process.platform==='darwin'){
 const source=path.join(__dirname,'TimerWindow.swift'),binary=path.join(runtime,'TickTockTomeTimer');
 if(!fs.existsSync(binary)||fs.statSync(source).mtimeMs>fs.statSync(binary).mtimeMs){
  const build=spawnSync('/usr/bin/xcrun',['swiftc','-parse-as-library',source,'-o',binary],{stdio:'ignore',shell:false});
  if(build.status!==0)process.exit(1);
 }
 command=binary;args=[String(port)];
}else if(process.platform==='win32'){
 command=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const script=fs.readFileSync(path.join(__dirname,'TimerWindow.ps1'),'utf8').replace('param([int]$Port)',`$Port = ${port}`);
 args=['-NoProfile','-NonInteractive','-STA','-Command',script];
}else process.exit(1);
const child=spawn(command,args,{stdio:'ignore',shell:false,windowsHide:true});
child.once('exit',()=>process.exit(0));child.once('error',()=>process.exit(1));
function stop(){child.kill();setTimeout(()=>process.exit(0),500);}
process.once('SIGTERM',stop);process.once('SIGINT',stop);
