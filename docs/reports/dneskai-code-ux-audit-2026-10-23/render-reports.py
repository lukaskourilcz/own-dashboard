"""Render the three authored Markdown reports as portable reading pages; stdlib only."""
from pathlib import Path
import re, html
root=Path(__file__).resolve().parent
BASE='https://github.com/lukaskourilcz/own-dashboard/blob/d6f60c7271c8078713fe2f56d63bc71fe10a5692/'
def inline(text):
 text=html.escape(text)
 text=re.sub(r'`([^`]+)`',lambda m:'<code>'+m[1]+'</code>',text)
 text=re.sub(r'\*\*([^*]+)\*\*',r'<strong>\1</strong>',text)
 text=re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)',r'<a href="\2">\1 ↗</a>',text)
 text=re.sub(r'<code>(src/[^<]+):(\d+)</code>',lambda m:f'<a href="{BASE}{m[1]}#L{m[2]}"><code>{m[1]}:{m[2]}</code></a>',text)
 return text
for name in ['code-review','ux-audit','validation']:
 path=root/(name+'.md')
 if not path.exists(): continue
 lines=path.read_text().splitlines();out=[];para=[];table=[];list_open=False
 def flush():
  if para:out.append('<p>'+inline(' '.join(para))+'</p>');para.clear()
 def flush_table():
  if table:
   rows=[]
   for n,line in enumerate(table):
    cells=line.strip().strip('|').split('|')
    if all(re.fullmatch(r'[\s:\-]+',c) for c in cells): continue
    tag='th' if n==0 else 'td'; rows.append('<tr>'+''.join(f'<{tag}>{inline(c.strip())}</{tag}>' for c in cells)+'</tr>')
   out.append('<div class="table-scroll"><table>'+''.join(rows)+'</table></div>');table.clear()
 def close_list():
  global list_open
  if list_open:out.append('</ul>');list_open=False
 for line in lines+['']:
  if line.startswith('|'):
   flush();close_list();table.append(line);continue
  flush_table()
  heading=re.match(r'^(#{1,6}) (.+)$',line)
  item=re.match(r'^(?:- |\d+\. )(.+)$',line)
  if heading:
   flush();close_list();level=len(heading[1]);text=heading[2];slug=re.match(r'(C\d\d)\b',text)
   ident=slug[1].lower() if slug else re.sub(r'[^a-z0-9]+','-',text.lower()).strip('-')
   out.append(f'<h{level} id="{ident}">{inline(text)}</h{level}>')
  elif item:
   flush()
   if not list_open:out.append('<ul>');list_open=True
   out.append('<li>'+inline(item[1])+'</li>')
  elif not line.strip():flush();close_list()
  else:close_list();para.append(line)
 title=next((l[2:] for l in lines if l.startswith('# ')),name)
 page='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'''+html.escape(title)+'''</title><link rel="stylesheet" href="plan.css"><style>main.report{max-width:1056px;padding:40px 28px 80px} .report h1{font-size:40px;margin:36px 0 24px}.report h2{font-size:27px;margin:44px 0 18px}.report h3{font-size:20px;margin:32px 0 16px;scroll-margin-top:20px}.report p,.report li{font-size:14px;line-height:1.8}.report a{color:var(--brand)}.report code{font:12px/1.6 ui-monospace,monospace;overflow-wrap:anywhere;background:#eaf0f5;padding:2px 4px;border-radius:4px}.report ul{padding-left:24px}.report li{margin:10px 0}.table-scroll{overflow:auto;border:1px solid var(--line);border-radius:10px;background:white;margin:24px 0}table{border-collapse:collapse;width:100%;min-width:700px;font-size:12px}th,td{text-align:left;padding:14px;border:1px solid var(--line);vertical-align:top}th{background:#edf1f5}td p{margin:0}@media(max-width:700px){.report h1{font-size:32px}.report p,.report li{font-size:14px}}</style></head><body><main class="report"><a href="index.html">← Back to visual plan</a>'''+''.join(out)+'''<p><a href="'''+name+'''.md">Markdown source ↗</a></p></main></body></html>'''
 (root/(name+'.html')).write_text(page)
 print(name+'.html')
