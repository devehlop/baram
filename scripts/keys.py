#!/usr/bin/env python3
"""Сверка текстов: какие ключи t('...') есть в коде и каких нет в locales/ru.ftl (и наоборот)."""
import re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
used = {}
dyn = set()
for f in list((root / 'src').rglob('*.ts')) + list((root / 'miniapp').rglob('*.ts*')):
    if 'node_modules' in f.parts: continue
    src = f.read_text(encoding='utf-8')
    for m in re.finditer(r"""\bt\(\s*'([A-Za-z0-9_-]+)'(\s*,\s*\{([^}]*)\})?""", src):
        args = set(re.findall(r'(\w+)\s*(?::|,|$)', m.group(3) or ''))
        used.setdefault(m.group(1), set()).update(args)
    for m in re.finditer(r"'((?:[a-z]+-)+[a-z0-9_-]+)'", src):
        used.setdefault(m.group(1), set()) if m.group(1) in used else None
    for m in re.finditer(r"\bt\(\s*`([A-Za-z0-9_-]+)\$\{", src):
        dyn.add(m.group(1))
ftl = (root / 'locales' / 'ru.ftl')
have = set(re.findall(r'^([A-Za-z][A-Za-z0-9_-]*)\s*=', ftl.read_text(encoding='utf-8'), re.M)) if ftl.exists() else set()
missing = sorted(k for k in used if k not in have)
if '--args' in sys.argv:
    for k in missing: print(k, sorted(used[k]))
else:
    print('MISSING:', len(missing)); [print(' ', k, sorted(used[k])) for k in missing]
print('DYNAMIC PREFIXES:', sorted(dyn))
for p in sorted(dyn):
    print('  ', p, sorted(k for k in have if k.startswith(p)))
