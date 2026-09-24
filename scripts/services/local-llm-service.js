"use strict";

const { spawn } = require("node:child_process");
const { statSync } = require("node:fs");

function run(command,args,input="",limit=2_000_000){return new Promise((resolve,reject)=>{const child=spawn(command,args,{shell:false,windowsHide:true,stdio:["pipe","pipe","pipe"]});let output="",error="",settled=false;const timer=setTimeout(()=>{if(settled)return;settled=true;child.kill("SIGTERM");reject(new Error("ローカルLLMの処理が120秒以内に完了しませんでした。"));},120_000);child.stdout.on("data",chunk=>{if(output.length<limit)output+=chunk});child.stderr.on("data",chunk=>{if(error.length<10000)error+=chunk});child.once("error",value=>{if(settled)return;settled=true;clearTimeout(timer);reject(value)});child.once("close",code=>{if(settled)return;settled=true;clearTimeout(timer);code===0?resolve(output):reject(new Error(`ローカル処理に失敗しました (${code}) ${error.slice(-500)}`))});if(input)child.stdin.end(input);else child.stdin.end();});}
function ensureFile(value,label){if(!value||!statSync(value).isFile())throw new Error(`${label}が見つかりません。設定画面を確認してください。`);}
async function extractLibraryMetadata(settings,pdfPath,itemType){
  const config=settings.localLlm||{};if(!config.enabled)throw new Error("ローカルLLMは未設定です。設定画面の手順を完了してください。");
  ensureFile(config.executablePath,"llama.cpp実行ファイル");ensureFile(config.modelPath,"GGUFモデル");ensureFile(config.pdfTextPath,"pdftotext実行ファイル");
  const text=(await run(config.pdfTextPath,[pdfPath,"-"])).slice(0,80_000);if(!text.trim())throw new Error("PDFから文字を抽出できませんでした。");
  const prompt=`次の${itemType==="paper"?"論文":"書籍"}PDF本文から書誌情報を抽出してください。推測できない項目は空にしてください。出力は説明なしのJSONだけにし、キーは title, authors(array), year(number|null), publication, keywords(array), doi, bibtexCode です。BibTeXはキーを別項目にせず、@article等から始まるコード全文をbibtexCodeへ入れてください。\n\n${text}`;
  const raw=await run(config.executablePath,["-m",config.modelPath,"-p",prompt,"-n","900","--temp","0.1"]);const match=raw.match(/\{[\s\S]*\}/);if(!match)throw new Error("ローカルLLMの回答から書誌情報を読み取れませんでした。");
  const value=JSON.parse(match[0]);return {title:String(value.title||"").slice(0,500),authors:Array.isArray(value.authors)?value.authors.map(String).slice(0,100):[],year:Number.isInteger(value.year)?value.year:null,publication:String(value.publication||"").slice(0,500),keywords:Array.isArray(value.keywords)?value.keywords.map(String).slice(0,100):[],doi:String(value.doi||"").slice(0,500),bibtexCode:String(value.bibtexCode||"").slice(0,100000)};
}
async function analyzeDailyActivity(settings,payload){
  const config=settings.localLlm||{};if(!config.enabled||config.analysisMode==='off')throw new Error("ローカルLLMの分析が無効です。設定画面で手動または自動を選んでください。");
  ensureFile(config.executablePath,"llama.cpp実行ファイル");ensureFile(config.modelPath,"GGUFモデル");
  const prompt=`あなたは個人用活動記録の振り返りを支援します。入力された事実だけを使い、断定しすぎず、短く実用的な日本語で分析してください。出力は説明なしのJSONだけにし、キーは summary(string), insights(array of string), suggestions(array of string) です。suggestionsは次のTodoや時間割へ追加できる具体的な行動候補にしてください。\n\n${JSON.stringify(payload)}`;
  const raw=await run(config.executablePath,["-m",config.modelPath,"-p",prompt,"-n","1000","--temp","0.2"]);const match=raw.match(/\{[\s\S]*\}/);if(!match)throw new Error("ローカルLLMの回答から分析結果を読み取れませんでした。");
  const value=JSON.parse(match[0]);return {summary:String(value.summary||"").slice(0,4000),insights:Array.isArray(value.insights)?value.insights.map(String).slice(0,20):[],suggestions:Array.isArray(value.suggestions)?value.suggestions.map(String).slice(0,20):[]};
}
module.exports={analyzeDailyActivity,extractLibraryMetadata};
