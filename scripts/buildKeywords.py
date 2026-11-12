"""Build data/keywords.json (the documented grandMA3 keywords) and data/object-trees/ma3_index.json
(command forms and creation commands, keyed by Lua expression) from the onPC help and the bundled trees.

    python scripts/buildKeywords.py "C:/ProgramData/MALightingTechnology/gma3_2.5.1/shared/language/HTML"
"""
import html
import json
import os
import re
import sys
from html.parser import HTMLParser

help_dir = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
BASE = 'https://help.malighting.com/grandMA3/2.5/HTML/'


class HTMLTextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self._skip_depth = 0
        self._chunks = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() in ('script', 'style'):
            self._skip_depth += 1

    def handle_endtag(self, tag):
        if tag.lower() in ('script', 'style') and self._skip_depth:
            self._skip_depth -= 1

    def handle_data(self, data):
        if not self._skip_depth:
            self._chunks.append(data)

    def handle_entityref(self, name):
        if not self._skip_depth:
            self._chunks.append(f"&{name};")

    def handle_charref(self, name):
        if not self._skip_depth:
            self._chunks.append(f"&#{name};")

    def get_text(self):
        return ''.join(self._chunks)


def clean(raw):
    parser = HTMLTextExtractor()
    parser.feed(raw)
    parser.close()
    return re.sub(r'\s+', ' ', html.unescape(parser.get_text())).replace('\ufeff', '').strip()


index = open(os.path.join(help_dir, 'csk_general_keywords.html'), encoding='utf-8', errors='replace').read()
files = sorted(set(re.findall(r'href="(keyword_[^"#?]+\.html)"', index)))
out = []
for f in files:
    path = os.path.join(help_dir, f)
    if not os.path.exists(path):
        continue
    t = clean(open(path, encoding='utf-8', errors='replace').read())
    m = re.search(r'grandMA3 User Manual Publication (.+?) grandMA3 User Manual', t)
    name = (m.group(1) if m else f[8:-5]).replace(' Keyword', '').strip()
    d = re.search(r'Description (.+?)(?: Syntax | Examples |$)', t)
    doc = d.group(1).strip() if d else ''
    doc = re.split(r'(?<=[.!?]) ', doc)[0][:240]
    sc = re.search(r'Type the shortcut (\S+)', t)
    out.append({'name': name, 'doc': doc, 'short': sc.group(1) if sc else '', 'url': BASE + f})
out.sort(key=lambda x: x['name'].lower())
open(os.path.join(root, 'data', 'keywords.json'), 'w', encoding='utf-8', newline='').write(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
print(len(out), 'keywords')

props = json.load(open(os.path.join(root, 'data', 'object-trees', 'ma3_props.json'), encoding='utf-8'))
idx = {}
for node in props['nodes'].values():
    if node['kw'] or node['create']:
        idx[node['lua']] = {'kw': node['kw'], 'create': node['create']}
open(os.path.join(root, 'data', 'object-trees', 'ma3_index.json'), 'w', encoding='utf-8', newline='').write(json.dumps(idx, ensure_ascii=False, separators=(',', ':')))
print(len(idx), 'indexed nodes')
