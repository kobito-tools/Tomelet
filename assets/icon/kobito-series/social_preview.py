import sys
apps = {
  "tomelet": ("Tomelet", "日記・時間割・Todo・関連ファイルを<br>一括管理", "Journal, timetable, todos and files in one place.", "#6F8D80", "#587366", "kobito-tomelet.svg"),
  "popnote": ("PopNote!", "押したらポンッと出てくる、クイックメモ。", "A memo that pops up when you need it.", "#C99185", "#B3776B", "kobito-popnote.svg"),
  "opensesame": ("OpenSesame!", "アプリ・フォルダ・画面分割の<br>ショートカットランチャー", "A shortcut launcher for apps, folders and window layouts.", "#D4AE66", "#BE954D", "kobito-opensesame.svg"),
}
for key, (name, ja, en, top, bottom, icon) in apps.items():
    open(f"og-{key}.html", "w").write(f"""<html><head><style>
@font-face{{font-family:Noto;src:url(file:///Users/taku/Git/DailyLog/assets/fonts/NotoSansJP.ttf)}}
html,body{{margin:0;width:1280px;height:640px;overflow:hidden}}
body{{background:linear-gradient(180deg,{top},{bottom});font-family:Noto,sans-serif;color:#F7F4EC;position:relative}}
img{{position:absolute;left:80px;top:100px;width:440px;height:440px}}
.text{{position:absolute;left:560px;right:64px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center}}
h1{{margin:0;font-weight:700;font-size:84px;letter-spacing:-.01em;line-height:1}}
.ja{{margin-top:30px;font-size:30px;white-space:nowrap;font-weight:500;line-height:1.5}}
.en{{margin-top:10px;font-size:24px;opacity:.78}}
.org{{position:absolute;right:64px;bottom:48px;font-size:22px;letter-spacing:.06em;opacity:.7}}
</style></head><body><img src="file://{__import__('os').path.abspath(icon)}"><div class="text"><h1>{name}</h1><div class="ja">{ja}</div><div class="en">{en}</div></div><div class="org">kobito-tools</div></body></html>""")
