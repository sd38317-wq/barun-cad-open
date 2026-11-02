"""Index source OCR labels for type-number searches; never infer physical area."""
import json, sqlite3
from design_case_service import ROOT, raw_for

def build():
    db=sqlite3.connect(ROOT/'catalog.sqlite');db.row_factory=sqlite3.Row
    db.execute('CREATE TABLE IF NOT EXISTS case_text (id TEXT PRIMARY KEY, text TEXT)')
    db.execute('CREATE TABLE IF NOT EXISTS case_images (id TEXT PRIMARY KEY, sha256 TEXT)')
    columns={r[1] for r in db.execute('PRAGMA table_info(case_images)')}
    for column in ('width','height'):
        if column not in columns:db.execute('ALTER TABLE case_images ADD COLUMN '+column+' INTEGER')
    images=[]
    for line in (ROOT/'drawings.jsonl').open(encoding='utf8'):
        item=json.loads(line);im=item['sourceImage'];images.append((item['id'],im['sha256'],im['width'],im['height']))
    db.executemany('INSERT OR REPLACE INTO case_images(id,sha256,width,height) VALUES (?,?,?,?)',images)
    db.execute('CREATE INDEX IF NOT EXISTS case_image_hash ON case_images(sha256)')
    records=[]
    for row in db.execute("SELECT * FROM drawings WHERE task='OCR'").fetchall():
        raw=raw_for(dict(row))
        texts=[str(a.get('attributes',{}).get('OCR','')) for a in raw.get('annotations',[])]
        records.append((row['id'],'\n'.join(texts)))
    db.executemany('INSERT OR REPLACE INTO case_text VALUES (?,?)',records)
    db.commit();db.close();print(json.dumps({'indexed':len(records)}))
if __name__=='__main__':build()
