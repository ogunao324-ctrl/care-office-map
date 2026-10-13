set -x
mkdir -p out && cd out
UA="Mozilla/5.0 (care-office-map probe)"
curl -sSL -A "$UA" -o mhlw.html https://www.mhlw.go.jp/stf/kaigo-kouhyou_opendata.html; ls -la mhlw.html
curl -sSL -A "$UA" -o wam.html https://www.wam.go.jp/content/wamnet/pcpub/top/sfkopendata/; ls -la wam.html
grep -o 'href="[^"]*\.\(zip\|csv\)[^"]*"' wam.html | head -80
grep -n -i -E '時点|年度|過去|バックナンバー|アーカイブ' wam.html | head -40
# e-Stat boundary (2020 小地域, 千葉県, 世界測地系緯度経度, shape)
curl -sSL -A "$UA" -o b.zip "https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=A002005212020&code=12&coordSys=1&format=shape&downloadType=5&datum=2000"; ls -la b.zip; file b.zip; unzip -l b.zip | head -20
# e-Stat table T001102 (2020 小地域 年齢5歳階級)
curl -sSL -A "$UA" -o t.zip "https://www.e-stat.go.jp/gis/statmap-search/data?statsId=T001102&code=12&downloadType=2"; ls -la t.zip; file t.zip; unzip -l t.zip | head
mkdir -p t && (cd t && unzip -o -q ../t.zip) ; for f in t/*; do echo "== $f"; iconv -f CP932 -t UTF-8 "$f" | head -4 | cut -c1-1500; iconv -f CP932 -t UTF-8 "$f" | grep -n '浪花町' | head -3 | cut -c1-600; done
mkdir -p b && (cd b && unzip -o -q ../b.zip); ls -la b
python3 - <<'PY'
import struct,glob
for f in glob.glob('b/*.dbf'):
    d=open(f,'rb').read()
    n=struct.unpack('<I',d[4:8])[0]; hl=struct.unpack('<H',d[8:10])[0]; rl=struct.unpack('<H',d[10:12])[0]
    fields=[]; i=32
    while d[i]!=0x0d:
        name=d[i:i+11].split(b'\0')[0].decode(); t=chr(d[i+11]); ln=d[i+16]; fields.append((name,t,ln)); i+=32
    print(f,n,'records',fields)
    off=hl
    for r in range(3):
        rec=d[off+r*rl:off+(r+1)*rl]; pos=1; vals=[]
        for name,t,ln in fields:
            vals.append(rec[pos:pos+ln].decode('cp932','replace').strip()); pos+=ln
        print(vals)
for f in glob.glob('b/*.prj'): print(open(f).read())
PY
rm -rf b t b.zip t.zip
# old MHLW zip (2020-12 110)
curl -sSL -A "$UA" -o old.zip https://www.mhlw.go.jp/content/12300000/2020.12jigyosho_110_all_20210122205653.zip; ls -la old.zip; unzip -l old.zip | head; mkdir -p o && (cd o && unzip -o -q ../old.zip); for f in o/*; do echo "== $f"; head -c 600 "$f" | iconv -f UTF-8 -t UTF-8 2>&1 | head -3; file "$f"; done; rm -rf o old.zip
curl -sSL -A "$UA" -o new.csv https://www.mhlw.go.jp/content/12300000/jigyosho_130_all_20260709180342.csv; head -2 new.csv | cut -c1-800; rm -f new.csv
