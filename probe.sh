set -x
mkdir -p out && cd out
UA="Mozilla/5.0 (care-office-map probe)"
B=https://www.kaigokensaku.mhlw.go.jp
curl -sSL -A "$UA" -o copyright.html $B/copyright/
# 最近更新している事業所（ニチイ・SOMPOなど）の概要ページ
curl -sSL -A "$UA" -o kani_a.html "$B/12/index.php?action_kouhyou_detail_001_kani=true&JigyosyoCd=1270200874-00&ServiceCd=110"
curl -sSL -A "$UA" -o kani_b.html "$B/12/index.php?action_kouhyou_detail_023_kani=true&JigyosyoCd=1270101148-00&ServiceCd=430"
curl -sSL -A "$UA" -o kani_c.html "$B/12/index.php?action_kouhyou_detail_004_kani=true&JigyosyoCd=1260191924-00&ServiceCd=130"
curl -sSL -A "$UA" -o kihon_a.html "$B/12/index.php?action_kouhyou_detail_001_kihon=true&JigyosyoCd=1270200874-00&ServiceCd=110"
for f in copyright kani_a kani_b kani_c kihon_a; do python3 - "$f" <<'PY'
import sys,re,html
f=sys.argv[1]
s=open(f+'.html',encoding='utf-8',errors='replace').read()
s=re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>',' ',s)
s=re.sub(r'<img[^>]*alt="([^"]*)"[^>]*>',r' [\1] ',s)
s=re.sub(r'(?i)<br\s*/?>','\n',s)
s=re.sub(r'(?i)</(p|div|tr|li|h\d|table|th|td)>','\n',s)
t=html.unescape(re.sub(r'<[^>]+>',' ',s))
t=re.sub(r'[ \t　]+',' ',t)
t=re.sub(r'\n\s*\n+','\n',t)
open(f+'.txt','w').write(t)
print('==',f,len(t))
PY
done
rm -f *.html
