set -x
mkdir -p out && cd out
UA="Mozilla/5.0 (care-office-map probe)"
B=https://www.kaigokensaku.mhlw.go.jp
curl -sSL -A "$UA" -o robots.txt $B/robots.txt; cat robots.txt | head -40
curl -sSL -A "$UA" -o readme.html $B/readme/; ls -la readme.html
curl -sSL -A "$UA" -o top.html $B/; grep -o 'href="[^"]*"' top.html | grep -i -E "policy|kiyaku|riyou|readme|copyright|link|chosaku|sitemap" | head -20
curl -sSL -A "$UA" -c jar.txt -b jar.txt -o k110.html "$B/12/index.php?action_kouhyou_detail_001_kihon=true&JigyosyoCd=1270101148-00&ServiceCd=110"; ls -la k110.html
curl -sSL -A "$UA" -c jar.txt -b jar.txt -o k130.html "$B/12/index.php?action_kouhyou_detail_004_kihon=true&JigyosyoCd=1260191924-00&ServiceCd=130"; ls -la k130.html
curl -sSL -A "$UA" -c jar.txt -b jar.txt -o k430.html "$B/12/index.php?action_kouhyou_detail_023_kihon=true&JigyosyoCd=1270101148-00&ServiceCd=430"; ls -la k430.html
curl -sSL -A "$UA" -c jar.txt -b jar.txt -o u110.html "$B/12/index.php?action_kouhyou_detail_001_unei=true&JigyosyoCd=1270101148-00&ServiceCd=110"; ls -la u110.html
curl -sSL -A "$UA" -c jar.txt -b jar.txt -o kani110.html "$B/12/index.php?action_kouhyou_detail_001_kani=true&JigyosyoCd=1270101148-00&ServiceCd=110"; ls -la kani110.html
for f in readme k110 k130 k430 u110 kani110; do python3 - "$f" <<'PY'
import sys,re,html
f=sys.argv[1]
s=open(f+'.html',encoding='utf-8',errors='replace').read()
s=re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>',' ',s)
s=re.sub(r'(?i)<br\s*/?>','\n',s)
s=re.sub(r'(?i)</(p|div|tr|li|h\d|table|th|td)>','\n',s)
t=html.unescape(re.sub(r'<[^>]+>',' ',s))
t=re.sub(r'[ \t　]+',' ',t)
t=re.sub(r'\n\s*\n+','\n',t)
open(f+'.txt','w').write(t)
print('==',f,len(t))
PY
done
rm -f jar.txt
