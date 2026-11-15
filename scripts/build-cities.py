"""Build the offline city index from GeoNames cities500.zip and admin1CodesASCII.txt."""
import sys, json, gzip, zipfile, pathlib
source = pathlib.Path(sys.argv[1])
regions = {p[0]: p[1] for line in (source / 'admin1CodesASCII.txt').read_text(encoding='utf-8').splitlines() if len(p := line.split('\t')) >= 2}
rows = []
with zipfile.ZipFile(source / 'cities500.zip') as archive:
    for line in archive.read('cities500.txt').decode('utf-8').splitlines():
        p = line.split('\t')
        if len(p) < 18 or not p[17]: continue
        rows.append([p[0], p[1], p[2], p[3], p[8], regions.get(p[8]+'.'+p[10], ''), p[17], int(p[14] or 0)])
target = pathlib.Path(__file__).resolve().parents[1] / 'server' / 'locations'
target.mkdir(exist_ok=True)
(target / 'cities.json.gz').write_bytes(gzip.compress(json.dumps(rows, ensure_ascii=False, separators=(',', ':')).encode(), mtime=0))
print(f'Indexed {len(rows)} cities')
