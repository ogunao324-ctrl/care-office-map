set -x
mkdir -p out && cd out
rm -f *.txt *.html
UA="Mozilla/5.0 (care-office-map probe)"
B=https://www.kaigokensaku.mhlw.go.jp
get() { # code form number
  curl -sSL -A "$UA" -w "%{http_code} %{size_download} %{time_total}\n" -o "raw_$1_$3.html" "$B/12/index.php?action_kouhyou_detail_$2_kihon=true&JigyosyoCd=$3-00&ServiceCd=$1"
  sleep 3
}
get 110 001 1270200874
get 110 001 1270200981
get 130 004 1260191239
get 130 004 1260191627
get 430 023 1270203969
get 430 023 1270200031
get 110 001 1270299999
for f in raw_*.html; do python3 - "$f" <<'PY'
import sys,re
f=sys.argv[1]
s=open(f,encoding='utf-8',errors='replace').read()
s=re.sub(r'(?is)<(script|style|svg|noscript)[^>]*>.*?</\1>','',s)
s=re.sub(r'(?is)<!--.*?-->','',s)
s=re.sub(r'[ \t]+',' ',s)
s=re.sub(r'\n\s*\n+','\n',s)
open(f.replace('raw_','kihon_'),'w').write(s)
print('==',f,len(s))
PY
done
rm -f raw_*.html
