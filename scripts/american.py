# American spelling for the dataset's prose (James, 2026-10-10). Whole words only;
# Latin roots (caesius, aluminis) and proper names (Helmholtz Centre) are left alone.
import re

WORDS = {
    'grey': 'gray', 'greyish': 'grayish', 'colourless': 'colorless', 'odourless': 'odorless',
    'colour': 'color', 'coloured': 'colored', 'odour': 'odor', 'vapour': 'vapor', 'lustre': 'luster',
    'caesium': 'cesium', 'aluminium': 'aluminum', 'sulphur': 'sulfur', 'sulphate': 'sulfate',
    'sulphuric': 'sulfuric', 'sulphide': 'sulfide', 'sulphine': 'sulfide',
}

def american(text):
    if not isinstance(text, str):
        return text
    def swap(m):
        w = m.group(0)
        r = WORDS[w.lower()]
        return r.capitalize() if w[0].isupper() else r
    return re.sub(r'\b(' + '|'.join(WORDS) + r')\b', swap, text, flags=re.IGNORECASE)

if __name__ == '__main__':
    import json, sys
    for path in sys.argv[1:]:
        data = json.load(open(path))
        for e in data:
            for k, v in list(e.items()):
                if k not in ('file',) and isinstance(v, str):
                    e[k] = american(v)
        raw = open(path).read()
        compact = '\n' not in raw.strip()
        json.dump(data, open(path, 'w'), ensure_ascii=False, separators=(',', ':') if compact else None, indent=None if compact else 0)
