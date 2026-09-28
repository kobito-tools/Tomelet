# kobito-tools シリーズのアイコンを、同じ小人（Tomeletのナビゲーションを走るキャラクター）で描く。
# 使い方: python3 kobito_icons.py → kobito-<名前>.svg を書き出す。各アプリのアイコン形式（icns・ico・png）への変換は各リポジトリで行う。
# 小人は元の座標系（viewBox 0 0 49 44）のまま、translate + scale で置く。線の太さも元の単位で書くので、どのアイコンでも同じ太さになる。
INK = "#3B4441"
BODY = "#E6E3D9"
SCREEN = "#F6F7F2"

def kobito(tx, ty, s=11, arms="", legs="stand", extra_back="", extra_front="", face="smile"):
    leg = {
        "stand": '<path d="M20 35.5 L19 45"/><path d="M28 35.5 L29 45"/>',
        "walk": '<path d="M19 33 l-2 5 l-3 5"/><path d="M29 33 l2 5 l3 5"/>',
    }[legs]
    mouth = {
        "smile": '<path d="M22 22c2 2 4 2 6 0" fill="none" stroke="%s" stroke-width="1.2" stroke-linecap="round"/>' % INK,
        "open": '<path d="M22.4 21.6c1.6 2.6 3.6 2.6 5.2 0Z" fill="%s" stroke="%s" stroke-width="1" stroke-linejoin="round"/>' % (INK, INK),
    }[face]
    return f'''<g transform="translate({tx} {ty}) scale({s})" stroke-linecap="round" stroke-linejoin="round">
    {extra_back}
    <g fill="none" stroke="{INK}" stroke-width="1.8">{leg}</g>
    <path d="M10 23C10 11 16 5 25 5c8 0 13 6 13 16 0 11-6 16-15 16-8 0-13-5-13-14Z" fill="{BODY}" stroke="{INK}" stroke-width="1.7"/>
    <path d="M15 13c5-4 13-4 18 0v12c-5 4-13 4-18 0Z" fill="{SCREEN}" stroke="{INK}" stroke-width="1.4"/>
    <circle cx="21" cy="18" r="1.4" fill="{INK}"/><circle cx="28" cy="18" r="1.4" fill="{INK}"/>
    {mouth}
    <g fill="none" stroke="{INK}" stroke-width="1.8">{arms}</g>
    {extra_front}
  </g>'''

def squircle(top, bottom, content, uid):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg-{uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient>
    <clipPath id="clip-{uid}"><rect x="100" y="100" width="824" height="824" rx="185"/></clipPath>
    <filter id="drop-{uid}" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000" flood-opacity=".22"/></filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg-{uid})" filter="url(#drop-{uid})"/>
  <g clip-path="url(#clip-{uid})">
{content}
  </g>
</svg>
'''

def ground(y=842, color="#000", opacity=".10", rx=210):
    return f'<ellipse cx="512" cy="{y}" rx="{rx}" ry="22" fill="{color}" opacity="{opacity}"/>'

# --- Tomelet：開いた本を両手で持って読む ---
def tomelet():
    s = 12.5
    tx, ty = 512 - 24 * s, 272
    arms = '<path d="M11 27 Q7.5 29.5 7.6 33.6"/><path d="M37 27 Q40.5 29.5 40.4 33.6"/>'
    book = f'''<g stroke="{INK}" stroke-linejoin="round" transform="translate(512 725) scale(1.17) translate(-512 -720)">
      <path d="M512 688 Q424 656 330 676 L338 790 Q428 770 512 800 Q596 770 686 790 L694 676 Q600 656 512 688 Z" fill="#A65A43" stroke-width="18"/>
      <path d="M512 676 Q430 642 348 660 L354 766 Q434 748 512 782 Z" fill="#F4EFE3" stroke-width="16"/>
      <path d="M512 676 Q594 642 676 660 L670 766 Q590 748 512 782 Z" fill="#F4EFE3" stroke-width="16"/>
      <path d="M512 676 L512 782" stroke-width="12"/>
      <g fill="none" stroke="#C7BFAE" stroke-width="9" stroke-linecap="round">
        <path d="M384 690 Q438 680 482 698"/><path d="M384 718 Q438 708 482 726"/>
        <path d="M640 690 Q586 680 542 698"/><path d="M640 718 Q586 708 542 726"/>
      </g>
      <path d="M586 790 L586 846 L602 832 L618 846 L618 784" fill="#D9B45E" stroke-width="10"/>
    </g>'''
    content = ground(862, rx=240) + kobito(tx, ty, s=s, arms=arms) + book
    return squircle("#6F8D80", "#587366", content, "tomelet")

# --- PopNote!：付箋を頭上へポンッと掲げる ---
def popnote():
    tx, ty = 430 - 24 * 11, 360
    arms = '<path d="M37 22 Q42.5 15 41.6 5"/><path d="M11.5 26 Q8 29 7 32.5"/>'
    note = f'''<g transform="rotate(8 668 300)" stroke="{INK}" stroke-linejoin="round">
      <path d="M548 180 L788 180 L788 372 L740 420 L548 420 Z" fill="#EACB74" stroke-width="18"/>
      <path d="M788 372 L740 372 L740 420" fill="#D3AF55" stroke-width="14"/>
      <g stroke="#B8974A" stroke-width="12" stroke-linecap="round"><path d="M588 248 L748 248"/><path d="M588 296 L748 296"/><path d="M588 344 L690 344"/></g>
    </g>'''
    pops = f'<g stroke="#F4E9E3" stroke-width="14" stroke-linecap="round" opacity=".9"><path d="M500 186 L530 206"/><path d="M478 250 L516 254"/><path d="M820 150 L806 180"/></g>'
    content = ground(870, rx=180) + pops + kobito(tx, ty, arms=arms, face="open") + note
    return squircle("#C99185", "#B3776B", content, "popnote")

# --- OpenSesame!：扉を押し開けると光がこぼれる ---
def opensesame():
    door = f'''<g stroke="{INK}" stroke-linejoin="round">
      <path d="M548 846 L812 846 L1000 1000 L380 1000 Z" fill="#F7E7BA" opacity=".8" stroke="none"/>
      <path d="M560 236 Q560 190 606 190 L760 190 Q806 190 806 236 L806 846 L560 846 Z" fill="#5B4535" stroke-width="18"/>
      <path d="M586 244 Q586 216 614 216 L752 216 Q780 216 780 244 L780 846 L586 846 Z" fill="#F7E9BF" stroke-width="12"/>
      <path d="M586 224 L500 176 L500 896 L586 846 Z" fill="#7A5B45" stroke-width="16"/>
      <circle cx="526" cy="540" r="11" fill="#D9B45E" stroke-width="7"/>
    </g>'''
    tx, ty = 330 - 24 * 11, 372
    arms = '<path d="M37 24 Q41 22 44.5 17"/><path d="M11.5 26 Q8.5 29 8 32.5"/>'
    content = door + kobito(tx, ty, arms=arms, legs="walk")
    return squircle("#D4AE66", "#BE954D", content, "opensesame")

# --- kobito-tools（組織のアイコン）：電球のリュックと電源プラグを持った、ナビゲーションの姿そのまま ---
def organization():
    back = f'''<path d="M7 12c-5 3-5 13-1 18h6V12Z" fill="#B7BDB4" stroke="{INK}" stroke-width="1.6"/>
    <path d="M3 8a5 5 0 1 1 8 4v3H6v-3A5 5 0 0 1 3 8Z" fill="#F2D98A" stroke="{INK}" stroke-width="1.5"/>
    <path d="M6 15h5v3H6z" fill="#8C938E" stroke="{INK}" stroke-width="1.2"/>
    <path d="M8 18C0 23 1 35 10 37c10 3 18-6 12-11-5-5-12 1-8 7 5 8 15-7 27-10" fill="none" stroke="{INK}" stroke-width="1.6"/>'''
    front = f'''<path d="M40 23h4" stroke="{INK}" stroke-width="1.8"/>
    <path d="M42 19h5v8h-5z" fill="#6E7571" stroke="{INK}" stroke-width="1.2"/>
    <path d="M47 21h2M47 25h2" stroke="{INK}" stroke-width="1.3"/>'''
    arms = '<path d="M33 25c4 0 5-2 9-2"/>'
    glow = '<circle cx="{0}" cy="{1}" r="120" fill="#F6E3A0" opacity=".45"/>'.format(512 - 26.5 * 13 + 7 * 13, 300 + 7 * 13)
    body = kobito(512 - 26.5 * 13, 300, s=13, arms=arms, legs="walk", extra_back=back, extra_front=front)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#ECE7DC"/>
  {glow}
  <ellipse cx="530" cy="880" rx="220" ry="22" fill="#000" opacity=".08"/>
  {body}
</svg>
'''

if __name__ == "__main__":
    for name, svg in [("tomelet", tomelet()), ("popnote", popnote()), ("opensesame", opensesame()), ("kobito-tools", organization())]:
        open(f"kobito-{name}.svg", "w").write(svg)
